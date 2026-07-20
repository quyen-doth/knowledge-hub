import { Hono } from 'hono';
import { secureHeaders } from 'hono/secure-headers';

import { createAdminApp } from './admin/routes';
import type { AppEnv } from './config';
import { runWatcher } from './watcher';

const app = new Hono<{ Bindings: AppEnv }>();

app.use('*', secureHeaders());
app.get('/health', (context) =>
  context.json({
    status: 'ok',
    service: 'knowledge-hub',
  }),
);
app.route('/admin', createAdminApp());
app.notFound((context) => context.json({ error: 'Not found' }, 404));

export async function handleScheduledCron(
  cron: string,
  env: AppEnv,
  watcher: typeof runWatcher = runWatcher,
): Promise<void> {
  if (cron === '0 * * * *') {
    await watcher(env);
    return;
  }

  throw new Error(`Scheduled job is not implemented yet: ${cron}`);
}

const worker = {
  fetch: app.fetch,
  async scheduled(
    controller: ScheduledController,
    env: AppEnv,
  ): Promise<void> {
    await handleScheduledCron(controller.cron, env);
  },
} satisfies ExportedHandler<AppEnv>;

export { app };
export default worker;
