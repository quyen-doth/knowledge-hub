import { env } from 'cloudflare:workers';
import { beforeEach, describe, expect, it } from 'vitest';

import { insertDiscoveredArticle, listSources } from '../src/db/queries';
import type { WatcherRunStats } from '../src/db/types';
import { handleScheduledCron } from '../src/index';
import type { DiscoveredItem, SourceAdapter } from '../src/watcher/adapters/types';
import { runWatcher } from '../src/watcher';

const fixedNow = () => new Date('2026-07-16T12:00:00.000Z');

function discoveries(count: number, prefix = 'article'): DiscoveredItem[] {
  return Array.from({ length: count }, (_, index) => ({
    url: `https://example.com/${prefix}-${index + 1}`,
    title: `${prefix} ${index + 1}`,
    published_at: new Date(Date.UTC(2026, 6, 16 - index)).toISOString(),
  }));
}

async function resetWatcherTables(): Promise<void> {
  await env.DB.batch([
    env.DB.prepare('DELETE FROM runs'),
    env.DB.prepare('DELETE FROM articles'),
    env.DB.prepare('DELETE FROM sources WHERE id > 2'),
    env.DB.prepare(
      `UPDATE sources
       SET enabled = 1,
           last_checked_at = NULL,
           last_error = NULL,
           consecutive_empty_count = 0`,
    ),
    env.DB.prepare("UPDATE settings SET value = '10' WHERE key = 'backfill_limit'"),
  ]);
}

async function enableOnlySource(sourceId: number): Promise<void> {
  await env.DB
    .prepare('UPDATE sources SET enabled = CASE WHEN id = ?1 THEN 1 ELSE 0 END')
    .bind(sourceId)
    .run();
}

describe('watcher orchestration', () => {
  beforeEach(resetWatcherTables);

  it('applies first-run backfill, deduplicates reruns and records every run', async () => {
    const research = (await listSources(env.DB))[0];
    if (!research) {
      throw new Error('Research source is missing.');
    }
    await enableOnlySource(research.id);
    await env.DB
      .prepare("UPDATE settings SET value = '2' WHERE key = 'backfill_limit'")
      .run();

    let items = discoveries(4, 'research');
    const adapter: SourceAdapter = {
      async discover() {
        return items;
      },
    };

    await expect(
      runWatcher(env, { adapters: { html_list: adapter }, now: fixedNow }),
    ).resolves.toEqual({
      sources_checked: 1,
      new_articles: 2,
      skipped: 2,
      failed: 0,
    });

    const firstArticles = await env.DB
      .prepare('SELECT url, status FROM articles ORDER BY id')
      .all<{ url: string; status: string }>();
    expect(firstArticles.results.map((article) => article.status)).toEqual([
      'new',
      'new',
      'skipped',
      'skipped',
    ]);

    await expect(
      runWatcher(env, { adapters: { html_list: adapter }, now: fixedNow }),
    ).resolves.toMatchObject({ new_articles: 0, skipped: 0, failed: 0 });

    items = discoveries(5, 'research');
    await expect(
      runWatcher(env, { adapters: { html_list: adapter }, now: fixedNow }),
    ).resolves.toMatchObject({ new_articles: 1, skipped: 0, failed: 0 });

    const runs = await env.DB
      .prepare(
        `SELECT kind, finished_at, stats, error
         FROM runs
         ORDER BY id`,
      )
      .all<{
        kind: string;
        finished_at: string | null;
        stats: string;
        error: string | null;
      }>();
    expect(runs.results).toHaveLength(3);
    expect(runs.results.every((run) => run.kind === 'watcher')).toBe(true);
    expect(runs.results.every((run) => run.finished_at !== null)).toBe(true);
    expect(JSON.parse(runs.results[0]?.stats ?? '{}')).toEqual({
      sources_checked: 1,
      new_articles: 2,
      skipped: 2,
      failed: 0,
    });
  });

  it('isolates a failing source and redacts unknown errors', async () => {
    const adapter: SourceAdapter = {
      async discover(source) {
        if (source.name === 'Anthropic Research') {
          throw new Error('private upstream response must not be persisted');
        }
        return discoveries(1, 'news');
      },
    };

    await expect(
      runWatcher(env, { adapters: { html_list: adapter }, now: fixedNow }),
    ).resolves.toEqual({
      sources_checked: 2,
      new_articles: 1,
      skipped: 0,
      failed: 1,
    });

    const sources = await listSources(env.DB);
    expect(sources[0]?.last_error).toBe('WATCHER_SOURCE_FAILED');
    expect(sources[0]?.last_error).not.toContain('private upstream');
    expect(sources[0]?.last_checked_at).toBeNull();
    expect(sources[1]?.last_error).toBeNull();
    expect(sources[1]?.last_checked_at).toBe('2026-07-16T12:00:00.000Z');
  });

  it('flags three empty discoveries for a productive source and resets on success', async () => {
    const research = (await listSources(env.DB))[0];
    if (!research) {
      throw new Error('Research source is missing.');
    }
    await enableOnlySource(research.id);
    await insertDiscoveredArticle(env.DB, {
      sourceId: research.id,
      url: 'https://example.com/existing',
      status: 'new',
    });
    await env.DB
      .prepare('UPDATE sources SET last_checked_at = ?1 WHERE id = ?2')
      .bind('2026-07-15T12:00:00.000Z', research.id)
      .run();

    let items: DiscoveredItem[] = [];
    const adapter: SourceAdapter = {
      async discover() {
        return items;
      },
    };

    for (let attempt = 0; attempt < 3; attempt += 1) {
      await runWatcher(env, { adapters: { html_list: adapter }, now: fixedNow });
    }

    let refreshed = (await listSources(env.DB)).find(
      (source) => source.id === research.id,
    );
    expect(refreshed?.consecutive_empty_count).toBe(3);
    expect(refreshed?.last_error).toBe('SELECTOR_SUSPECT');

    items = discoveries(1, 'recovered');
    await runWatcher(env, { adapters: { html_list: adapter }, now: fixedNow });

    refreshed = (await listSources(env.DB)).find((source) => source.id === research.id);
    expect(refreshed?.consecutive_empty_count).toBe(0);
    expect(refreshed?.last_error).toBeNull();
  });

  it('finishes the run with a safe invocation error when settings are invalid', async () => {
    await env.DB
      .prepare("UPDATE settings SET value = 'invalid' WHERE key = 'backfill_limit'")
      .run();

    await expect(runWatcher(env, { now: fixedNow })).rejects.toMatchObject({
      code: 'BACKFILL_LIMIT_INVALID',
    });

    const run = await env.DB
      .prepare('SELECT finished_at, stats, error FROM runs ORDER BY id DESC LIMIT 1')
      .first<{ finished_at: string | null; stats: string; error: string | null }>();
    expect(run?.finished_at).toBe('2026-07-16T12:00:00.000Z');
    expect(run?.error).toBe('BACKFILL_LIMIT_INVALID');
    expect(JSON.parse(run?.stats ?? '{}')).toEqual({
      sources_checked: 0,
      new_articles: 0,
      skipped: 0,
      failed: 0,
    });
  });
});

describe('scheduled routing', () => {
  it('routes only the hourly cron to the watcher', async () => {
    let calls = 0;
    const watcher = async (): Promise<WatcherRunStats> => {
      calls += 1;
      return { sources_checked: 0, new_articles: 0, skipped: 0, failed: 0 };
    };

    await handleScheduledCron('0 * * * *', env, watcher);
    expect(calls).toBe(1);
    await expect(handleScheduledCron('*/5 * * * *', env, watcher)).rejects.toThrow(
      'Scheduled job is not implemented yet',
    );
  });
});
