import type { SettingRow, SourceRow, WatcherRunStats } from './types';

export interface DiscoveredArticleInput {
  sourceId: number;
  url: string;
  title?: string;
  publishedAt?: string;
  status: 'new' | 'skipped';
}

export async function getSetting(
  db: D1Database,
  key: string,
): Promise<string | null> {
  const row = await db
    .prepare('SELECT key, value FROM settings WHERE key = ?1')
    .bind(key)
    .first<SettingRow>();

  return row?.value ?? null;
}

export async function listSettings(db: D1Database): Promise<SettingRow[]> {
  const result = await db
    .prepare('SELECT key, value FROM settings ORDER BY key')
    .all<SettingRow>();

  return result.results;
}

export async function listSources(db: D1Database): Promise<SourceRow[]> {
  const result = await db
    .prepare(
      `SELECT
        id, name, type, url, config, enabled,
        last_checked_at, last_error, consecutive_empty_count, created_at
      FROM sources
      ORDER BY id`,
    )
    .all<SourceRow>();

  return result.results;
}

export async function listEnabledSources(db: D1Database): Promise<SourceRow[]> {
  const result = await db
    .prepare(
      `SELECT
        id, name, type, url, config, enabled,
        last_checked_at, last_error, consecutive_empty_count, created_at
      FROM sources
      WHERE enabled = 1
      ORDER BY id`,
    )
    .all<SourceRow>();

  return result.results;
}

export async function createWatcherRun(
  db: D1Database,
  startedAt: string,
): Promise<number> {
  const row = await db
    .prepare(
      `INSERT INTO runs (kind, started_at)
       VALUES ('watcher', ?1)
       RETURNING id`,
    )
    .bind(startedAt)
    .first<{ id: number }>();

  if (!row) {
    throw new Error('Failed to create watcher run.');
  }

  return row.id;
}

export async function finishWatcherRun(
  db: D1Database,
  runId: number,
  finishedAt: string,
  stats: WatcherRunStats,
  error: string | null = null,
): Promise<void> {
  await db
    .prepare(
      `UPDATE runs
       SET finished_at = ?1, stats = ?2, error = ?3
       WHERE id = ?4 AND kind = 'watcher'`,
    )
    .bind(finishedAt, JSON.stringify(stats), error, runId)
    .run();
}

export async function insertDiscoveredArticle(
  db: D1Database,
  input: DiscoveredArticleInput,
): Promise<boolean> {
  const result = await db
    .prepare(
      `INSERT OR IGNORE INTO articles (
        source_id, ingest_channel, url, title, published_at, status
      ) VALUES (?1, 'watcher', ?2, ?3, ?4, ?5)`,
    )
    .bind(
      input.sourceId,
      input.url,
      input.title ?? null,
      input.publishedAt ?? null,
      input.status,
    )
    .run();

  return result.meta.changes === 1;
}

export async function sourceHasArticles(
  db: D1Database,
  sourceId: number,
): Promise<boolean> {
  const row = await db
    .prepare(
      `SELECT EXISTS(
        SELECT 1 FROM articles WHERE source_id = ?1 LIMIT 1
      ) AS has_articles`,
    )
    .bind(sourceId)
    .first<{ has_articles: number }>();

  return row?.has_articles === 1;
}

export async function countSourceNonSkippedArticles(
  db: D1Database,
  sourceId: number,
): Promise<number> {
  const row = await db
    .prepare(
      `SELECT COUNT(*) AS article_count
       FROM articles
       WHERE source_id = ?1 AND status <> 'skipped'`,
    )
    .bind(sourceId)
    .first<{ article_count: number }>();

  return row?.article_count ?? 0;
}

export async function markSourceDiscoverySuccess(
  db: D1Database,
  sourceId: number,
  checkedAt: string,
): Promise<void> {
  await db
    .prepare(
      `UPDATE sources
       SET last_checked_at = ?1,
           last_error = NULL,
           consecutive_empty_count = 0
       WHERE id = ?2`,
    )
    .bind(checkedAt, sourceId)
    .run();
}

export async function markSourceEmptyDiscovery(
  db: D1Database,
  sourceId: number,
  checkedAt: string,
  previouslyProductive: boolean,
): Promise<void> {
  await db
    .prepare(
      `UPDATE sources
       SET last_checked_at = ?1,
           consecutive_empty_count = consecutive_empty_count + 1,
           last_error = CASE
             WHEN ?2 = 1 AND consecutive_empty_count + 1 >= 3
               THEN 'SELECTOR_SUSPECT'
             ELSE NULL
           END
       WHERE id = ?3`,
    )
    .bind(checkedAt, previouslyProductive ? 1 : 0, sourceId)
    .run();
}

export async function markSourceDiscoveryFailure(
  db: D1Database,
  sourceId: number,
  error: string,
): Promise<void> {
  await db
    .prepare('UPDATE sources SET last_error = ?1 WHERE id = ?2')
    .bind(error, sourceId)
    .run();
}
