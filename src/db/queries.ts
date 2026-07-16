import type { SettingRow, SourceRow } from './types';

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
        last_checked_at, last_error, created_at
      FROM sources
      ORDER BY id`,
    )
    .all<SourceRow>();

  return result.results;
}
