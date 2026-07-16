import { exports } from 'cloudflare:workers';
import { describe, expect, it } from 'vitest';

describe('Knowledge Hub worker', () => {
  it('exposes a health endpoint without requiring integration secrets', async () => {
    const response = await exports.default.fetch('https://knowledge-hub.test/health');
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      status: 'ok',
      service: 'knowledge-hub',
    });
  });

  it('redirects unauthenticated admin requests to login', async () => {
    const response = await exports.default.fetch('https://knowledge-hub.test/admin', {
      redirect: 'manual',
    });
    expect(response.status).toBe(303);
    expect(response.headers.get('location')).toBe('/admin/login');
  });

  it('rejects an invalid password without creating a session', async () => {
    const response = await exports.default.fetch(
      new Request('https://knowledge-hub.test/admin/login', {
        method: 'POST',
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({ password: 'wrong password' }),
      }),
    );
    expect(response.status).toBe(401);
    expect(response.headers.get('set-cookie')).toBeNull();
  });

  it('creates a secure session and renders the seeded model', async () => {
    const loginResponse = await exports.default.fetch(
      new Request('https://knowledge-hub.test/admin/login', {
        method: 'POST',
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({ password: 'test-admin-password' }),
        redirect: 'manual',
      }),
    );
    expect(loginResponse.status).toBe(303);
    expect(loginResponse.headers.get('location')).toBe('/admin');

    const setCookie = loginResponse.headers.get('set-cookie');
    expect(setCookie).toContain('HttpOnly');
    expect(setCookie).toContain('Secure');
    expect(setCookie).toContain('SameSite=Lax');

    const cookie = setCookie?.split(';', 1)[0];
    const dashboardResponse = await exports.default.fetch(
      new Request('https://knowledge-hub.test/admin', {
        headers: { cookie: cookie ?? '' },
      }),
    );
    expect(dashboardResponse.status).toBe(200);
    expect(await dashboardResponse.text()).toContain('claude-haiku-4-5');
  });
});
