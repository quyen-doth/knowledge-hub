import { z } from 'zod';

import type { AppEnv } from '../../config';
import { parseJsonColumn, type SourceRow } from '../../db/types';
import { WatcherError } from '../errors';

export interface DiscoveredItem {
  url: string;
  title?: string;
  published_at?: string;
}

export interface SourceAdapter {
  discover(source: SourceRow, env: AppEnv): Promise<DiscoveredItem[]>;
}

export const rssSourceConfigSchema = z.object({}).strict();

export const htmlListSourceConfigSchema = z
  .object({
    item_selector: z.string().trim().min(1).max(512),
    link_attr: z
      .string()
      .trim()
      .regex(/^[a-zA-Z_:][a-zA-Z0-9_.:-]*$/)
      .default('href'),
    base_url: z.string().trim().max(2_048).optional(),
    exclude_paths: z.array(z.string().startsWith('/').max(1_024)).max(100).default([]),
  })
  .strict();

export const browserSourceConfigSchema = z.object({}).strict();

export type HtmlListSourceConfig = z.infer<typeof htmlListSourceConfigSchema>;

export function parseRssSourceConfig(source: SourceRow): void {
  parseConfig(source.config, rssSourceConfigSchema);
}

export function parseHtmlListSourceConfig(source: SourceRow): HtmlListSourceConfig {
  return parseConfig(source.config, htmlListSourceConfigSchema);
}

export function parseBrowserSourceConfig(source: SourceRow): void {
  parseConfig(source.config, browserSourceConfigSchema);
}

function parseConfig<TSchema extends z.ZodType>(
  value: string,
  schema: TSchema,
): z.infer<TSchema> {
  try {
    return parseJsonColumn(value, schema);
  } catch (error) {
    throw new WatcherError('SOURCE_CONFIG_INVALID', { cause: error });
  }
}

export function normalizeOptionalText(value: unknown): string | undefined {
  if (typeof value !== 'string') {
    return undefined;
  }

  const normalized = value.replace(/\s+/g, ' ').trim();
  return normalized.length > 0 ? normalized : undefined;
}

export function normalizePublishedAt(value: unknown): string | undefined {
  const text = normalizeOptionalText(value);
  if (!text) {
    return undefined;
  }

  const timestamp = Date.parse(text);
  return Number.isNaN(timestamp) ? undefined : new Date(timestamp).toISOString();
}
