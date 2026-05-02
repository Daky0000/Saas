import dotenv from 'dotenv';
import { z } from 'zod';

// Load `.env` for local development only.
dotenv.config();

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().positive().default(5000),
  DATABASE_URL: z.string().optional(),
  JWT_SECRET: z.string().min(1),
  INTEGRATIONS_ENCRYPTION_KEY: z.string().min(1),
  WORDPRESS_ENCRYPTION_KEY: z.string().min(1),
  FRONTEND_ORIGINS: z.string().optional(),
});

function assertStrongSecret(name: string, value: string, nodeEnv: string) {
  if (nodeEnv !== 'production') return;
  if (value.length < 32) {
    throw new Error(`${name} must be at least 32 characters in production`);
  }
}

const parsed = envSchema.safeParse(process.env);
if (!parsed.success) {
  const message = parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('\n');
  throw new Error(`Invalid environment:\n${message}`);
}

const env = parsed.data;
assertStrongSecret('JWT_SECRET', env.JWT_SECRET, env.NODE_ENV);
assertStrongSecret('INTEGRATIONS_ENCRYPTION_KEY', env.INTEGRATIONS_ENCRYPTION_KEY, env.NODE_ENV);
assertStrongSecret('WORDPRESS_ENCRYPTION_KEY', env.WORDPRESS_ENCRYPTION_KEY, env.NODE_ENV);

export const config = {
  nodeEnv: env.NODE_ENV,
  port: env.PORT,
  databaseUrl: env.DATABASE_URL,
  jwtSecret: env.JWT_SECRET,
  integrationsEncryptionKey: env.INTEGRATIONS_ENCRYPTION_KEY,
  wordpressEncryptionKey: env.WORDPRESS_ENCRYPTION_KEY,
  frontendOrigins: env.FRONTEND_ORIGINS
    ? env.FRONTEND_ORIGINS.split(',').map((o) => o.trim()).filter(Boolean)
    : undefined,
} as const;

