import { describe, expect, it } from 'vitest';

import {
  ADMIN_SESSION_TTL_SECONDS,
  createAdminSession,
  verifyAdminPassword,
  verifyAdminSession,
} from '../src/admin/session';

const secret = 'test-session-secret-with-at-least-32-characters';
const now = new Date('2026-07-16T00:00:00.000Z');

describe('admin session', () => {
  it('creates a valid session and rejects a different secret', async () => {
    const token = await createAdminSession(secret, now);
    expect(await verifyAdminSession(token, secret, now)).toBe(true);
    expect(await verifyAdminSession(token, `${secret}-wrong`, now)).toBe(false);
  });

  it('rejects tampered and expired sessions', async () => {
    const token = await createAdminSession(secret, now);
    const expiredAt = new Date(
      now.getTime() + (ADMIN_SESSION_TTL_SECONDS + 1) * 1000,
    );
    expect(await verifyAdminSession(`${token}x`, secret, now)).toBe(false);
    expect(await verifyAdminSession(token, secret, expiredAt)).toBe(false);
    expect(await verifyAdminSession(undefined, secret, now)).toBe(false);
  });

  it('compares passwords without relying on equal input length', async () => {
    expect(await verifyAdminPassword('correct password', 'correct password')).toBe(true);
    expect(await verifyAdminPassword('short', 'a much longer password')).toBe(false);
  });
});
