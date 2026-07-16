import { z } from 'zod';

export interface AppEnv {
  DB: D1Database;
  ADMIN_PASSWORD?: string;
  SESSION_SECRET?: string;
  ANTHROPIC_API_KEY?: string;
  LLM_MODEL?: string;
  GITHUB_TOKEN?: string;
  GITHUB_REPO?: string;
  GITHUB_BRANCH?: string;
  OBSIDIAN_INBOX_PATH?: string;
  LINE_CHANNEL_SECRET?: string;
  LINE_CHANNEL_ACCESS_TOKEN?: string;
  LINE_USER_ID?: string;
  ANKIFLOW_API_URL?: string;
  ANKIFLOW_INTEGRATION_TOKEN?: string;
  INGEST_TOKEN?: string;
}

const adminConfigSchema = z.object({
  ADMIN_PASSWORD: z.string().min(12),
  SESSION_SECRET: z.string().min(32),
});

export interface AdminConfig {
  password: string;
  sessionSecret: string;
}

export class ConfigurationError extends Error {
  readonly code = 'CONFIGURATION_ERROR';

  constructor(message: string) {
    super(message);
    this.name = 'ConfigurationError';
  }
}

export function getAdminConfig(env: AppEnv): AdminConfig {
  const result = adminConfigSchema.safeParse(env);
  if (!result.success) {
    throw new ConfigurationError('Admin authentication is not configured.');
  }

  return {
    password: result.data.ADMIN_PASSWORD,
    sessionSecret: result.data.SESSION_SECRET,
  };
}
