import { parseHTML } from 'linkedom';

import { InvalidUrlError, normalizeHttpUrl } from '../../url';
import { WatcherError } from '../errors';
import { fetchSourceText, WATCHER_USER_AGENT } from '../fetch';
import {
  normalizeOptionalText,
  parseHtmlListSourceConfig,
  type DiscoveredItem,
  type SourceAdapter,
} from './types';

function isExcluded(url: URL, excludePaths: string[]): boolean {
  return excludePaths.some((path) => url.pathname === path);
}

export function createHtmlListAdapter(fetcher: typeof fetch = fetch): SourceAdapter {
  return {
    async discover(source) {
      const config = parseHtmlListSourceConfig(source);
      let sourceUrl: string;
      try {
        sourceUrl = normalizeHttpUrl(source.url);
      } catch (error) {
        throw new WatcherError('SOURCE_URL_INVALID', { cause: error });
      }

      let baseUrl: string;
      try {
        baseUrl = normalizeHttpUrl(config.base_url ?? sourceUrl);
      } catch (error) {
        throw new WatcherError('SOURCE_CONFIG_INVALID', { cause: error });
      }
      const html = await fetchSourceText(sourceUrl, {
        fetcher,
        accept: 'text/html, application/xhtml+xml',
        userAgent: WATCHER_USER_AGENT,
      });
      const { document } = parseHTML(html);

      let elements: NodeListOf<Element>;
      try {
        elements = document.querySelectorAll(config.item_selector);
      } catch (error) {
        throw new WatcherError('SOURCE_SELECTOR_INVALID', { cause: error });
      }

      const byUrl = new Map<string, DiscoveredItem>();
      for (const element of elements) {
        const href = element.getAttribute(config.link_attr);
        if (!href) {
          continue;
        }

        let normalized: string;
        try {
          normalized = normalizeHttpUrl(href, baseUrl);
        } catch (error) {
          if (error instanceof InvalidUrlError) {
            continue;
          }
          throw error;
        }

        if (isExcluded(new URL(normalized), config.exclude_paths) || byUrl.has(normalized)) {
          continue;
        }

        const title = normalizeOptionalText(element.textContent);
        byUrl.set(normalized, {
          url: normalized,
          ...(title ? { title } : {}),
        });
      }

      return [...byUrl.values()];
    },
  };
}
