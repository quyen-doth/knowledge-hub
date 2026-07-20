import { describe, expect, it } from 'vitest';

import { ConfigurationError, getAdminConfig, type AppEnv } from '../src/config';

const dbStub = {} as D1Database;

describe('getAdminConfig', () => {
  it('returns validated admin configuration', () => {
    expect(
      getAdminConfig({
        DB: dbStub,
        ADMIN_PASSWORD: 'a-long-test-password',
        SESSION_SECRET: 'a-test-session-secret-with-32-characters',
      }),
    ).toEqual({
      password: 'a-long-test-password',
      sessionSecret: 'a-test-session-secret-with-32-characters',
    });
  });

  it('does not require integration secrets for admin configuration', () => {
    const env: AppEnv = {
      DB: dbStub,
      ADMIN_PASSWORD: 'a-long-test-password',
      SESSION_SECRET: 'a-test-session-secret-with-32-characters',
    };
    expect(() => getAdminConfig(env)).not.toThrow();
  });

  it('fails with a redacted configuration error', () => {
    expect(() => getAdminConfig({ DB: dbStub })).toThrow(ConfigurationError);
    expect(() => getAdminConfig({ DB: dbStub })).toThrow(
      'Admin authentication is not configured.',
    );
  });
});
