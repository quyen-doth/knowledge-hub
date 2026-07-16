import { z } from 'zod';

import {
  countSourceNonSkippedArticles,
  createWatcherRun,
  finishWatcherRun,
  getSetting,
  insertDiscoveredArticle,
  listEnabledSources,
  markSourceDiscoveryFailure,
  markSourceDiscoverySuccess,
  markSourceEmptyDiscovery,
  sourceHasArticles,
} from '../db/queries';
import type { SourceRow, SourceType, WatcherRunStats } from '../db/types';
import { InvalidUrlError, normalizeHttpUrl } from '../url';
import { browserAdapter } from './adapters/browser';
import { createHtmlListAdapter } from './adapters/html-list';
import { createRssAdapter } from './adapters/rss';
import type { DiscoveredItem, SourceAdapter } from './adapters/types';
import { getSafeWatcherError, WatcherError } from './errors';

const backfillLimitSchema = z.coerce.number().int().min(0).max(1_000);

type AdapterRegistry = Record<SourceType, SourceAdapter>;

export interface RunWatcherOptions {
  fetcher?: typeof fetch;
  now?: () => Date;
  adapters?: Partial<AdapterRegistry>;
}

function createAdapterRegistry(options: RunWatcherOptions): AdapterRegistry {
  const fetcher = options.fetcher ?? fetch;
  return {
    rss: createRssAdapter(fetcher),
    html_list: createHtmlListAdapter(fetcher),
    browser: browserAdapter,
    ...options.adapters,
  };
}

function parseBackfillLimit(value: string | null): number {
  const result = backfillLimitSchema.safeParse(value ?? '10');
  if (!result.success) {
    throw new WatcherError('BACKFILL_LIMIT_INVALID', { cause: result.error });
  }
  return result.data;
}

function normalizeDiscoveries(items: DiscoveredItem[]): DiscoveredItem[] {
  const byUrl = new Map<string, DiscoveredItem>();
  for (const item of items) {
    try {
      const url = normalizeHttpUrl(item.url);
      if (!byUrl.has(url)) {
        byUrl.set(url, { ...item, url });
      }
    } catch (error) {
      if (!(error instanceof InvalidUrlError)) {
        throw error;
      }
    }
  }
  return [...byUrl.values()];
}

async function persistDiscoveries(
  db: D1Database,
  source: SourceRow,
  items: DiscoveredItem[],
  backfillLimit: number,
  stats: WatcherRunStats,
): Promise<void> {
  const isFirstSuccessfulRun = source.last_checked_at === null;
  const alreadyAccepted = isFirstSuccessfulRun
    ? await countSourceNonSkippedArticles(db, source.id)
    : 0;
  let remainingBackfill = Math.max(0, backfillLimit - alreadyAccepted);

  for (const item of items) {
    const status = isFirstSuccessfulRun && remainingBackfill === 0 ? 'skipped' : 'new';
    const inserted = await insertDiscoveredArticle(db, {
      sourceId: source.id,
      url: item.url,
      ...(item.title ? { title: item.title } : {}),
      ...(item.published_at ? { publishedAt: item.published_at } : {}),
      status,
    });

    if (!inserted) {
      continue;
    }

    if (status === 'new') {
      stats.new_articles += 1;
      if (isFirstSuccessfulRun) {
        remainingBackfill -= 1;
      }
    } else {
      stats.skipped += 1;
    }
  }
}

async function runSource(
  db: D1Database,
  source: SourceRow,
  adapter: SourceAdapter,
  env: import('../config').AppEnv,
  checkedAt: string,
  backfillLimit: number,
  stats: WatcherRunStats,
): Promise<void> {
  try {
    const items = normalizeDiscoveries(await adapter.discover(source, env));
    if (items.length === 0) {
      await markSourceEmptyDiscovery(
        db,
        source.id,
        checkedAt,
        await sourceHasArticles(db, source.id),
      );
      return;
    }

    await persistDiscoveries(db, source, items, backfillLimit, stats);
    await markSourceDiscoverySuccess(db, source.id, checkedAt);
  } catch (error) {
    stats.failed += 1;
    await markSourceDiscoveryFailure(db, source.id, getSafeWatcherError(error));
  }
}

export async function runWatcher(
  env: import('../config').AppEnv,
  options: RunWatcherOptions = {},
): Promise<WatcherRunStats> {
  const now = options.now ?? (() => new Date());
  const startedAt = now().toISOString();
  const runId = await createWatcherRun(env.DB, startedAt);
  const stats: WatcherRunStats = {
    sources_checked: 0,
    new_articles: 0,
    skipped: 0,
    failed: 0,
  };
  let invocationError: string | null = null;

  try {
    const backfillLimit = parseBackfillLimit(await getSetting(env.DB, 'backfill_limit'));
    const adapters = createAdapterRegistry(options);
    const sources = await listEnabledSources(env.DB);

    for (const source of sources) {
      stats.sources_checked += 1;
      await runSource(
        env.DB,
        source,
        adapters[source.type],
        env,
        now().toISOString(),
        backfillLimit,
        stats,
      );
    }
  } catch (error) {
    invocationError = getSafeWatcherError(error);
    throw error;
  } finally {
    await finishWatcherRun(env.DB, runId, now().toISOString(), stats, invocationError);
  }

  return stats;
}
