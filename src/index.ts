import { Hono } from 'hono';
import { secureHeaders } from 'hono/secure-headers';

import { createAdminApp } from './admin/routes';
import type { AppEnv } from './config';

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

const worker = {
  fetch: app.fetch,
  async scheduled(controller: ScheduledController): Promise<void> {
    throw new Error(`Scheduled job is not implemented yet: ${controller.cron}`);
  },
} satisfies ExportedHandler<AppEnv>;

export { app };
export default worker;
