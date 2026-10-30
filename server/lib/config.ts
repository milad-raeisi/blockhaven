import { z } from 'zod';
import { MAX_RENDER_DISTANCE } from '../../src/game/world/constants';

const boolish = z
  .union([z.boolean(), z.string()])
  .transform((v) => v === true || v === 'true' || v === '1');

const configSchema = z.object({
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  HOST: z.string().default('0.0.0.0'),
  PORT: z.coerce.number().int().min(0).max(65535).default(3000),
  DATABASE_URL: z.string().min(1, 'DATABASE_URL is required (see .env.example)'),
  SESSION_SECRET: z.string().min(16, 'SESSION_SECRET must be at least 16 characters'),
  ALLOWED_ORIGINS: z.string().default(''),
  SECURE_COOKIES: boolish.default(false),
  TICK_RATE: z.coerce.number().int().min(5).max(60).default(20),
  SAVE_INTERVAL_MS: z.coerce.number().int().min(1000).max(600_000).default(10_000),
  MAX_RENDER_DISTANCE: z.coerce.number().int().min(2).max(MAX_RENDER_DISTANCE).default(MAX_RENDER_DISTANCE),
  ROOM_IDLE_UNLOAD_SECONDS: z.coerce.number().int().min(0).max(86_400).default(60),
  LOG_LEVEL: z.enum(['debug', 'info', 'warn', 'error']).default('info'),
});

export type ServerConfig = z.infer<typeof configSchema> & { allowedOrigins: string[] };

export function loadConfig(env: NodeJS.ProcessEnv = process.env, overrides: Partial<Record<string, string>> = {}): ServerConfig {
  const parsed = configSchema.safeParse({ ...env, ...overrides });
  if (!parsed.success) {
    const details = parsed.error.issues.map((i) => `  - ${i.path.join('.')}: ${i.message}`).join('\n');
    throw new Error(`Invalid server configuration:\n${details}`);
  }
  return {
    ...parsed.data,
    allowedOrigins: parsed.data.ALLOWED_ORIGINS.split(',')
      .map((o) => o.trim())
      .filter(Boolean),
  };
}
