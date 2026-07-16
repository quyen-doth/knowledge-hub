import { Hono } from 'hono';
import { deleteCookie, getCookie, setCookie } from 'hono/cookie';

import { ConfigurationError, getAdminConfig, type AppEnv } from '../config';
import { getSetting } from '../db/queries';
import { DashboardView } from './dashboard';
import { LoginView } from './login';
import {
  ADMIN_SESSION_COOKIE,
  ADMIN_SESSION_TTL_SECONDS,
  createAdminSession,
  verifyAdminPassword,
  verifyAdminSession,
} from './session';

function configurationUnavailable(error: unknown): Response {
  if (error instanceof ConfigurationError) {
    return new Response('Admin authentication is not configured.', { status: 503 });
  }
  throw error;
}

export function createAdminApp() {
  const admin = new Hono<{ Bindings: AppEnv }>();

  admin.use('*', async (context, next) => {
    context.header('Cache-Control', 'no-store');
    if (new URL(context.req.url).pathname === '/admin/login') return next();

    try {
      const config = getAdminConfig(context.env);
      const authenticated = await verifyAdminSession(
        getCookie(context, ADMIN_SESSION_COOKIE),
        config.sessionSecret,
      );
      if (!authenticated) return context.redirect('/admin/login', 303);
      return next();
    } catch (error) {
      return configurationUnavailable(error);
    }
  });

  admin.get('/login', (context) => context.html(<LoginView />));

  admin.post('/login', async (context) => {
    let config;
    try {
      config = getAdminConfig(context.env);
    } catch (error) {
      return configurationUnavailable(error);
    }

    const body = await context.req.parseBody();
    const password = typeof body.password === 'string' ? body.password : '';
    if (!(await verifyAdminPassword(password, config.password))) {
      return context.html(<LoginView error="Mật khẩu không đúng." />, 401);
    }

    const secure = new URL(context.req.url).protocol === 'https:';
    setCookie(
      context,
      ADMIN_SESSION_COOKIE,
      await createAdminSession(config.sessionSecret),
      {
        path: '/admin',
        httpOnly: true,
        secure,
        sameSite: 'Lax',
        maxAge: ADMIN_SESSION_TTL_SECONDS,
      },
    );
    return context.redirect('/admin', 303);
  });

  admin.post('/logout', (context) => {
    deleteCookie(context, ADMIN_SESSION_COOKIE, { path: '/admin' });
    return context.redirect('/admin/login', 303);
  });

  admin.get('/', async (context) => {
    const model = (await getSetting(context.env.DB, 'llm_model')) ?? 'not configured';
    return context.html(<DashboardView model={model} />);
  });

  return admin;
}
