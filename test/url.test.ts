import { describe, expect, it } from 'vitest';

import { normalizeHttpUrl } from '../src/url';

describe('normalizeHttpUrl', () => {
  it('resolves relative URLs and removes fragments without merging paths', () => {
    expect(normalizeHttpUrl('../article#section', 'https://Example.com/news/')).toBe(
      'https://example.com/article',
    );
    expect(normalizeHttpUrl('https://example.com/path')).not.toBe(
      normalizeHttpUrl('https://example.com/path/'),
    );
  });

  it.each([
    'javascript:alert(1)',
    'file:///tmp/article',
    'https://user:password@example.com/article',
    '',
  ])('rejects unsafe URL %s', (url) => {
    expect(() => normalizeHttpUrl(url)).toThrow('INVALID_URL');
  });
});
