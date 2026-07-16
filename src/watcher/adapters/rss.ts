import { XMLParser, XMLValidator } from 'fast-xml-parser';

import { InvalidUrlError, normalizeHttpUrl } from '../../url';
import { WatcherError } from '../errors';
import { fetchSourceText } from '../fetch';
import {
  normalizeOptionalText,
  normalizePublishedAt,
  parseRssSourceConfig,
  type DiscoveredItem,
  type SourceAdapter,
} from './types';

type UnknownRecord = Record<string, unknown>;

function asRecord(value: unknown): UnknownRecord | undefined {
  return typeof value === 'object' && value !== null
    ? (value as UnknownRecord)
    : undefined;
}

function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : value === undefined ? [] : [value];
}

function getString(record: UnknownRecord, key: string): string | undefined {
  return normalizeOptionalText(record[key]);
}

function normalizeItem(
  urlValue: unknown,
  titleValue: unknown,
  publishedValue: unknown,
  sourceUrl: string,
): DiscoveredItem | undefined {
  const link = normalizeOptionalText(urlValue);
  if (!link) {
    return undefined;
  }

  try {
    const title = normalizeOptionalText(titleValue);
    const publishedAt = normalizePublishedAt(publishedValue);
    return {
      url: normalizeHttpUrl(link, sourceUrl),
      ...(title ? { title } : {}),
      ...(publishedAt ? { published_at: publishedAt } : {}),
    };
  } catch (error) {
    if (error instanceof InvalidUrlError) {
      return undefined;
    }
    throw error;
  }
}

function parseRssItems(root: UnknownRecord, sourceUrl: string): DiscoveredItem[] | undefined {
  const rss = asRecord(root.rss);
  const channel = rss ? asRecord(rss.channel) : undefined;
  if (!channel) {
    return undefined;
  }

  return asArray(channel.item)
    .map((value) => asRecord(value))
    .filter((value): value is UnknownRecord => value !== undefined)
    .map((item) =>
      normalizeItem(item.link, item.title, item.pubDate ?? item['dc:date'], sourceUrl),
    )
    .filter((item): item is DiscoveredItem => item !== undefined);
}

function getAtomLink(value: unknown): string | undefined {
  const links = asArray(value);
  for (const link of links) {
    if (typeof link === 'string') {
      return normalizeOptionalText(link);
    }

    const record = asRecord(link);
    if (!record) {
      continue;
    }

    const relation = getString(record, '@_rel');
    if (!relation || relation === 'alternate') {
      const href = getString(record, '@_href');
      if (href) {
        return href;
      }
    }
  }

  return undefined;
}

function parseAtomItems(root: UnknownRecord, sourceUrl: string): DiscoveredItem[] | undefined {
  const feed = asRecord(root.feed);
  if (!feed) {
    return undefined;
  }

  return asArray(feed.entry)
    .map((value) => asRecord(value))
    .filter((value): value is UnknownRecord => value !== undefined)
    .map((entry) =>
      normalizeItem(
        getAtomLink(entry.link),
        entry.title,
        entry.published ?? entry.updated,
        sourceUrl,
      ),
    )
    .filter((item): item is DiscoveredItem => item !== undefined);
}

function deduplicate(items: DiscoveredItem[]): DiscoveredItem[] {
  const byUrl = new Map<string, DiscoveredItem>();
  for (const item of items) {
    if (!byUrl.has(item.url)) {
      byUrl.set(item.url, item);
    }
  }
  return [...byUrl.values()];
}

export function createRssAdapter(fetcher: typeof fetch = fetch): SourceAdapter {
  return {
    async discover(source) {
      parseRssSourceConfig(source);
      let sourceUrl: string;
      try {
        sourceUrl = normalizeHttpUrl(source.url);
      } catch (error) {
        throw new WatcherError('SOURCE_URL_INVALID', { cause: error });
      }
      const xml = await fetchSourceText(sourceUrl, {
        fetcher,
        accept: 'application/atom+xml, application/rss+xml, application/xml, text/xml',
      });

      if (xml.trim().length === 0 || XMLValidator.validate(xml) !== true) {
        throw new WatcherError('FEED_XML_INVALID');
      }

      let parsed: unknown;
      try {
        parsed = new XMLParser({
          attributeNamePrefix: '@_',
          ignoreAttributes: false,
          parseTagValue: false,
          trimValues: true,
        }).parse(xml) as unknown;
      } catch (error) {
        throw new WatcherError('FEED_XML_INVALID', { cause: error });
      }

      const root = asRecord(parsed);
      if (!root) {
        throw new WatcherError('FEED_FORMAT_UNSUPPORTED');
      }

      const items = parseRssItems(root, sourceUrl) ?? parseAtomItems(root, sourceUrl);
      if (!items) {
        throw new WatcherError('FEED_FORMAT_UNSUPPORTED');
      }

      return deduplicate(items);
    },
  };
}
