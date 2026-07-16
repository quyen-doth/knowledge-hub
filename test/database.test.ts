import { env } from 'cloudflare:workers';
import { describe, expect, it } from 'vitest';

import { getSetting, listSettings, listSources } from '../src/db/queries';

describe('initial D1 migration', () => {
  it('seeds the four phase-one settings', async () => {
    expect(await getSetting(env.DB, 'llm_model')).toBe('claude-haiku-4-5');
    expect(await listSettings(env.DB)).toEqual([
      { key: 'backfill_limit', value: '10' },
      { key: 'llm_model', value: 'claude-haiku-4-5' },
      { key: 'max_terms_per_article', value: '5' },
      { key: 'notify_mode', value: 'immediate' },
    ]);
  });

  it('seeds the Anthropic sources with validated starting configuration', async () => {
    const sources = await listSources(env.DB);
    expect(sources).toHaveLength(2);
    expect(sources.map((source) => source.url)).toEqual([
      'https://www.anthropic.com/research',
      'https://www.anthropic.com/news',
    ]);
    expect(sources.every((source) => source.enabled === 1)).toBe(true);
  });
});
