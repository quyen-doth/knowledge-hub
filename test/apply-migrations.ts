import { env } from 'cloudflare:workers';
import { applyD1Migrations, type D1Migration } from 'cloudflare:test';

declare global {
  namespace Cloudflare {
    interface Env {
      ADMIN_PASSWORD: string;
      SESSION_SECRET: string;
      TEST_MIGRATIONS: D1Migration[];
    }
  }
}

await applyD1Migrations(env.DB, env.TEST_MIGRATIONS);
