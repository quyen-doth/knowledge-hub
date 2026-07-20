import { env } from 'cloudflare:workers';
import { describe, expect, it } from 'vitest';

import type { AppEnv } from '../src/config';
import { listSources } from '../src/db/queries';
import type { SourceRow } from '../src/db/types';
import { browserAdapter } from '../src/watcher/adapters/browser';
import { createHtmlListAdapter } from '../src/watcher/adapters/html-list';
import { createRssAdapter } from '../src/watcher/adapters/rss';
import type { DiscoveredItem } from '../src/watcher/adapters/types';
import { fetchSourceText, MAX_SOURCE_RESPONSE_BYTES } from '../src/watcher/fetch';
import atomXml from './fixtures/atom.xml?raw';
import emptyRssXml from './fixtures/empty-rss.xml?raw';
import malformedXml from './fixtures/malformed.xml?raw';
import researchHtml from './fixtures/anthropic-research-2026-07-16.html?raw';
import newsHtml from './fixtures/anthropic-news-2026-07-16.html?raw';
import rssXml from './fixtures/rss-2.0.xml?raw';

function makeSource(overrides: Partial<SourceRow> = {}): SourceRow {
  return {
    id: 99,
    name: 'Test source',
    type: 'rss',
    url: 'https://example.com/feed.xml',
    config: '{}',
    enabled: 1,
    last_checked_at: null,
    last_error: null,
    consecutive_empty_count: 0,
    created_at: '2026-07-16T00:00:00.000Z',
    ...overrides,
  };
}

function responseFetcher(body: string, contentType: string): typeof fetch {
  return async () =>
    new Response(body, {
      headers: { 'content-type': contentType },
    });
}

const appEnv: AppEnv = { DB: env.DB };

describe('RSS adapter', () => {
  it('parses RSS 2.0, normalizes dates and removes duplicate URLs', async () => {
    const items = await createRssAdapter(
      responseFetcher(rssXml, 'application/rss+xml'),
    ).discover(makeSource(), appEnv);

    expect(items).toEqual<DiscoveredItem[]>([
      {
        url: 'https://example.com/articles/first',
        title: 'First article',
        published_at: '2026-07-15T10:00:00.000Z',
      },
      {
        url: 'https://example.com/articles/second',
        title: 'Second article',
        published_at: '2026-07-14T08:30:00.000Z',
      },
    ]);
  });

  it('parses Atom alternate links and ignores unsafe entry URLs', async () => {
    const items = await createRssAdapter(
      responseFetcher(atomXml, 'application/atom+xml'),
    ).discover(makeSource(), appEnv);

    expect(items).toEqual([
      {
        url: 'https://example.com/atom/article',
        title: 'Atom article',
        published_at: '2026-07-16T01:02:03.000Z',
      },
    ]);
  });

  it('returns no discoveries for a valid empty feed', async () => {
    await expect(
      createRssAdapter(responseFetcher(emptyRssXml, 'application/rss+xml')).discover(
        makeSource(),
        appEnv,
      ),
    ).resolves.toEqual([]);
  });

  it('rejects malformed XML with a safe error code', async () => {
    await expect(
      createRssAdapter(responseFetcher(malformedXml, 'application/rss+xml')).discover(
        makeSource(),
        appEnv,
      ),
    ).rejects.toMatchObject({ code: 'FEED_XML_INVALID' });
  });
});

describe('HTML-list adapter', () => {
  it('matches the dated Anthropic fixtures and excludes Research team pages', async () => {
    const sources = await listSources(env.DB);
    const research = sources.find((source) => source.name === 'Anthropic Research');
    const news = sources.find((source) => source.name === 'Anthropic News');
    if (!research || !news) {
      throw new Error('Seeded Anthropic sources are missing.');
    }

    const researchItems = await createHtmlListAdapter(
      responseFetcher(researchHtml, 'text/html'),
    ).discover(research, appEnv);
    const newsItems = await createHtmlListAdapter(
      responseFetcher(newsHtml, 'text/html'),
    ).discover(news, appEnv);

    expect(researchItems).toHaveLength(6);
    expect(researchItems[0]?.url).toBe(
      'https://www.anthropic.com/research/how-canada-uses-claude',
    );
    expect(researchItems.some((item) => item.url.includes('/research/team/'))).toBe(
      false,
    );
    expect(newsItems).toHaveLength(6);
    expect(newsItems[0]?.url).toBe(
      'https://www.anthropic.com/news/claude-for-teachers',
    );
  });

  it('sets the bot user agent and filters duplicate, excluded and unsafe links', async () => {
    let requestInit: RequestInit | undefined;
    const fetcher: typeof fetch = async (_input, init) => {
      requestInit = init;
      return new Response(
        `<a class="story" href="/first#intro"> First article </a>
         <a class="story" href="/first">Duplicate</a>
         <a class="story" href="/archive">Archive</a>
         <a class="story" href="mailto:test@example.com">Mail</a>
         <a class="story" href="https://user:secret@example.com/private">Private</a>`,
        { headers: { 'content-type': 'text/html' } },
      );
    };
    const source = makeSource({
      type: 'html_list',
      url: 'https://example.com/news',
      config: JSON.stringify({
        item_selector: 'a.story',
        base_url: 'https://example.com',
        exclude_paths: ['/archive'],
      }),
    });

    await expect(createHtmlListAdapter(fetcher).discover(source, appEnv)).resolves.toEqual([
      { url: 'https://example.com/first', title: 'First article' },
    ]);
    expect(new Headers(requestInit?.headers).get('user-agent')).toBe(
      'KnowledgeHubBot/1.0 (+contact)',
    );
  });
});

describe('browser adapter', () => {
  it('remains an explicit phase-two placeholder', async () => {
    await expect(
      browserAdapter.discover(makeSource({ type: 'browser' }), appEnv),
    ).rejects.toMatchObject({ code: 'BROWSER_ADAPTER_NOT_IMPLEMENTED' });
  });
});

describe('source fetch boundary', () => {
  it('rejects a declared response larger than the configured limit', async () => {
    const fetcher: typeof fetch = async () =>
      new Response('small test body', {
        headers: {
          'content-length': String(MAX_SOURCE_RESPONSE_BYTES + 1),
        },
      });

    await expect(
      fetchSourceText('https://example.com/source', {
        fetcher,
        accept: 'text/html',
      }),
    ).rejects.toMatchObject({ code: 'SOURCE_RESPONSE_TOO_LARGE' });
  });
});
