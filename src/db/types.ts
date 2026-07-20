import type { z } from 'zod';

export type SourceType = 'rss' | 'html_list' | 'browser';
export type IngestChannel = 'watcher' | 'line' | 'bookmarklet' | 'admin';
export type ArticleStatus =
  | 'new'
  | 'processing'
  | 'processed'
  | 'failed'
  | 'failed_retryable'
  | 'skipped';
export type RunKind = 'watcher' | 'processor';

export interface SourceRow {
  id: number;
  name: string;
  type: SourceType;
  url: string;
  config: string;
  enabled: 0 | 1;
  last_checked_at: string | null;
  last_error: string | null;
  consecutive_empty_count: number;
  created_at: string;
}

export interface WatcherRunStats {
  sources_checked: number;
  new_articles: number;
  skipped: number;
  failed: number;
}

export interface SettingRow {
  key: string;
  value: string;
}

export function parseJsonColumn<TSchema extends z.ZodType>(
  value: string,
  schema: TSchema,
): z.infer<TSchema> {
  return schema.parse(JSON.parse(value) as unknown);
}
