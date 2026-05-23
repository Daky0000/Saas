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
  // App URL used in password-reset / email-verification links
  VITE_APP_URL: z.string().optional(),
  // Redis
  REDIS_URL: z.string().optional(),
  BULLMQ_REDIS_URL: z.string().optional(),
  // Social rate-limit config
  TWITTER_MONTHLY_WRITE_LIMIT: z.coerce.number().default(0),
  X_MONTHLY_WRITE_LIMIT: z.coerce.number().default(0),
  SOCIAL_TOKEN_SAFETY_MARGIN_DAYS: z.coerce.number().default(10),
  // Serving static assets (e.g. on Railway combined deploy)
  SERVE_STATIC: z.string().optional(),
  // Facebook / Meta webhook
  META_WEBHOOK_VERIFY_TOKEN: z.string().optional(),
  FACEBOOK_WEBHOOK_VERIFY_TOKEN: z.string().optional(),
  FACEBOOK_APP_SECRET: z.string().optional(),
  META_APP_SECRET: z.string().optional(),
});

function assertProductionDatabase(nodeEnv: string, databaseUrl: string | undefined) {
  if (nodeEnv === 'production' && !databaseUrl) {
    throw new Error('DATABASE_URL must be set in production. Refusing to start without a database.');
  }
}

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
assertProductionDatabase(env.NODE_ENV, env.DATABASE_URL);

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
  appUrl: (env.VITE_APP_URL ?? 'https://marketing.dakyworld.com').replace(/\/$/, ''),
  redisUrl: env.REDIS_URL ?? env.BULLMQ_REDIS_URL ?? '',
  twitterMonthlyWriteLimit: Math.max(env.TWITTER_MONTHLY_WRITE_LIMIT, env.X_MONTHLY_WRITE_LIMIT),
  socialTokenSafetyMarginDays: env.SOCIAL_TOKEN_SAFETY_MARGIN_DAYS,
  serveStatic: env.SERVE_STATIC === 'true',
  metaWebhookVerifyToken: env.META_WEBHOOK_VERIFY_TOKEN ?? env.FACEBOOK_WEBHOOK_VERIFY_TOKEN ?? '',
  facebookAppSecret: env.FACEBOOK_APP_SECRET ?? env.META_APP_SECRET ?? '',
} as const;
