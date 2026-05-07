import Anthropic from '@anthropic-ai/sdk';
import { GoogleGenerativeAI } from '@google/generative-ai';
import Stripe from 'stripe';
import express from 'express';
import type { Request, Response } from 'express';
import cors from 'cors';
import axios from 'axios';
import jwt from 'jsonwebtoken';
import bcrypt from 'bcryptjs';
import { Pool } from 'pg';
import { Queue, Worker } from 'bullmq';
import IORedis from 'ioredis';
import { z } from 'zod';
import {
  randomUUID,
  randomBytes,
  createCipheriv,
  createDecipheriv,
  scryptSync,
  createHmac,
  timingSafeEqual,
} from 'crypto';
import { FacebookPagesPlatform } from '../backend/platforms/facebook_pages.ts';
import { InstagramBusinessPlatform } from '../backend/platforms/instagram_business.ts';
import { LinkedInPlatform } from '../backend/platforms/linkedin.ts';
import { TwitterXPlatform } from '../backend/platforms/twitter_x.ts';
import { TikTokAdapter } from '../backend/src/services/platform-adapters/tiktok.adapter.ts';
import type { PostObject } from '../backend/platforms/types.ts';
// import { SAMPLE_TEMPLATES } from './src/data/sampleFabricTemplates.ts';
import path from 'path';
import { fileURLToPath } from 'url';
import { dirname } from 'path';
import { registerBlogAnalyticsRoutes } from './server/blogAnalyticsRoutes.ts';
import { config } from './config.ts';
import { logger } from './logger.ts';
import { requestIdMiddleware } from './middleware/requestId.ts';
import { errorHandler } from './middleware/errorHandler.ts';
import { validateBody } from './middleware/validate.ts';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const WORDPRESS_ENCRYPTION_KEY = (() => {
  return scryptSync(config.wordpressEncryptionKey, 'wordpress', 32);
})();

const INTEGRATIONS_ENCRYPTION_KEY = (() => {
  return scryptSync(config.integrationsEncryptionKey, 'integrations', 32);
})();

// ── Stripe — initialized from DB platform_configs; env vars are fallback only ─
let stripe: Stripe | null = process.env.STRIPE_SECRET_KEY
  ? new Stripe(process.env.STRIPE_SECRET_KEY, { apiVersion: '2025-05-28.basil' as any })
  : null;
let STRIPE_WEBHOOK_SECRET = process.env.STRIPE_WEBHOOK_SECRET || '';

async function refreshStripe(): Promise<void> {
  try {
    const r = await dbQuery<{ config: Record<string, string>; enabled: boolean }>(
      `SELECT config, enabled FROM platform_configs WHERE platform = 'stripe' LIMIT 1`
    );
    const row = r.rows[0];
    if (!row) return; // no admin config yet — keep env var fallback
    if (row.enabled && row.config?.secretKey) {
      stripe = new Stripe(row.config.secretKey, { apiVersion: '2025-05-28.basil' as any });
      STRIPE_WEBHOOK_SECRET = row.config.webhookSecret || '';
    } else if (!row.enabled) {
      stripe = null;
      STRIPE_WEBHOOK_SECRET = '';
    }
  } catch {
    // DB not ready yet — ignore, keep current value
  }
}

const app = express();
const PORT = config.port;
app.use(requestIdMiddleware);

// Health check — registered first so Railway can reach it immediately on startup
app.get('/health', (_req: Request, res: Response) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});
app.get('/api/health', (_req: Request, res: Response) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// Lightweight diagnostics to debug Railway DB/CORS issues (no secrets).
app.get('/api/debug/db', (_req: Request, res: Response) => {
  res.json({
    hasDatabase: hasDatabase(),
    dbReady,
    databaseUrlConfigured: Boolean(DATABASE_URL && DATABASE_URL.trim()),
  });
});

// Serve static assets — no caching on any file so deploys take effect immediately
if (process.env.SERVE_STATIC === 'true') {
  app.use(
    express.static(path.join(__dirname, 'docs'), {
      setHeaders(res) {
        res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
        res.setHeader('Pragma', 'no-cache');
        res.setHeader('Expires', '0');
      },
    })
  );
}
const JWT_SECRET = config.jwtSecret;
const DATABASE_URL = config.databaseUrl;
const REDIS_URL = process.env.REDIS_URL || process.env.BULLMQ_REDIS_URL || '';
const TWITTER_MONTHLY_WRITE_LIMIT = Number(process.env.TWITTER_MONTHLY_WRITE_LIMIT || process.env.X_MONTHLY_WRITE_LIMIT || 0);
const SOCIAL_TOKEN_SAFETY_MARGIN_DAYS = Number(process.env.SOCIAL_TOKEN_SAFETY_MARGIN_DAYS || 10);
const X_API_BASE = 'https://api.x.com';
const X_OAUTH_TOKEN_URL = `${X_API_BASE}/2/oauth2/token`;
const X_USERS_ME_API = `${X_API_BASE}/2/users/me`;

const CALENDAR_CACHE_TTL_MS = 60 * 60 * 1000;
const calendarCache = new Map<string, { expiresAt: number; value: any }>();
const LINK_METADATA_TTL_MS = 30 * 24 * 60 * 60 * 1000;
const LINK_METADATA_TIMEOUT_MS = 5_000;
const LINK_METADATA_RATE_LIMIT = { windowMs: 60 * 60 * 1000, max: 100 };

type LinkMetadataRecord = {
  url: string;
  title: string;
  description: string;
  image: string | null;
  fetchedAt: string;
  expiresAt: string;
};

const linkMetadataCache = new Map<string, { expiresAt: number; value: LinkMetadataRecord }>();
const linkMetadataRate = new Map<string, { windowStart: number; count: number }>();

function getCalendarCache(key: string) {
  const entry = calendarCache.get(key);
  if (!entry) return null;
  if (Date.now() > entry.expiresAt) {
    calendarCache.delete(key);
    return null;
  }
  return entry.value;
}

function setCalendarCache(key: string, value: any) {
  calendarCache.set(key, { value, expiresAt: Date.now() + CALENDAR_CACHE_TTL_MS });
}

function clearCalendarCacheForUser(userId: string) {
  const prefix = `calendar:${userId}:`;
  for (const key of calendarCache.keys()) {
    if (key.startsWith(prefix)) calendarCache.delete(key);
  }
}

function getLinkMetadataCache(url: string) {
  const entry = linkMetadataCache.get(url);
  if (!entry) return null;
  if (Date.now() > entry.expiresAt) {
    linkMetadataCache.delete(url);
    return null;
  }
  return entry.value;
}

function setLinkMetadataCache(url: string, value: LinkMetadataRecord) {
  linkMetadataCache.set(url, { value, expiresAt: Date.now() + LINK_METADATA_TTL_MS });
}

function getClientIp(req: Request) {
  const forwarded = String(req.headers['x-forwarded-for'] || '').split(',')[0]?.trim();
  return forwarded || req.ip || 'unknown';
}

function checkLinkMetadataRateLimit(ip: string) {
  const now = Date.now();
  const current = linkMetadataRate.get(ip);
  if (!current || now - current.windowStart > LINK_METADATA_RATE_LIMIT.windowMs) {
    linkMetadataRate.set(ip, { windowStart: now, count: 1 });
    return true;
  }
  if (current.count >= LINK_METADATA_RATE_LIMIT.max) {
    return false;
  }
  current.count += 1;
  return true;
}

function decodeHtmlEntities(value: string) {
  return value
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'");
}

function extractMetaContent(html: string, attr: 'property' | 'name', value: string) {
  const tagRegex = new RegExp(`<meta[^>]+${attr}=["']${value}["'][^>]*>`, 'i');
  const tagMatch = html.match(tagRegex);
  if (!tagMatch) return '';
  const tag = tagMatch[0];
  const contentMatch = tag.match(/content=["']([^"']+)["']/i);
  return contentMatch ? decodeHtmlEntities(contentMatch[1]) : '';
}

function extractTitle(html: string) {
  const match = html.match(/<title[^>]*>([^<]*)<\/title>/i);
  return match ? decodeHtmlEntities(match[1]).trim() : '';
}

function resolveMetaUrl(base: string, value: string) {
  if (!value) return '';
  try {
    return new URL(value, base).toString();
  } catch {
    return value;
  }
}

async function loadLinkMetadataFromDb(url: string): Promise<LinkMetadataRecord | null> {
  if (!hasDatabase()) return null;
  try {
    const { rows } = await pool!.query(
      'SELECT url, title, description, image, fetched_at, expires_at FROM link_metadata WHERE url=$1 AND expires_at > NOW() LIMIT 1',
      [url]
    );
    if (!rows.length) return null;
    const row = rows[0];
    return {
      url: row.url,
      title: row.title || 'Link',
      description: row.description || '',
      image: row.image || null,
      fetchedAt: new Date(row.fetched_at).toISOString(),
      expiresAt: new Date(row.expires_at).toISOString(),
    };
  } catch (err) {
    console.warn('Failed to read link metadata cache:', err);
    return null;
  }
}

async function saveLinkMetadataToDb(data: LinkMetadataRecord) {
  if (!hasDatabase()) return;
  try {
    await pool!.query(
      `INSERT INTO link_metadata (id, url, title, description, image, fetched_at, expires_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7)
       ON CONFLICT (url)
       DO UPDATE SET title=EXCLUDED.title, description=EXCLUDED.description, image=EXCLUDED.image,
       fetched_at=EXCLUDED.fetched_at, expires_at=EXCLUDED.expires_at`,
      [randomUUID(), data.url, data.title, data.description, data.image, data.fetchedAt, data.expiresAt]
    );
  } catch (err) {
    console.warn('Failed to save link metadata cache:', err);
  }
}

async function fetchLinkMetadata(url: string): Promise<LinkMetadataRecord | null> {
  const cached = getLinkMetadataCache(url);
  if (cached) return cached;

  const dbRecord = await loadLinkMetadataFromDb(url);
  if (dbRecord) {
    setLinkMetadataCache(url, dbRecord);
    return dbRecord;
  }

  try {
    const response = await axios.get(url, {
      timeout: LINK_METADATA_TIMEOUT_MS,
      headers: { 'User-Agent': 'ContentflowBot/1.0' },
    });
    if (typeof response.data !== 'string') return null;
    const html = response.data as string;

    const ogTitle = extractMetaContent(html, 'property', 'og:title');
    const ogDescription = extractMetaContent(html, 'property', 'og:description');
    const ogImage = extractMetaContent(html, 'property', 'og:image');
    const twitterDescription =
      extractMetaContent(html, 'name', 'twitter:description') || extractMetaContent(html, 'property', 'twitter:description');
    const twitterImage =
      extractMetaContent(html, 'name', 'twitter:image') || extractMetaContent(html, 'property', 'twitter:image');
    const title = ogTitle || extractTitle(html) || 'Link';
    const description =
      ogDescription || extractMetaContent(html, 'name', 'description') || twitterDescription;
    const image = resolveMetaUrl(url, ogImage || twitterImage);

    const now = new Date();
    const record: LinkMetadataRecord = {
      url,
      title: title.slice(0, 80),
      description: description.slice(0, 160),
      image: image || null,
      fetchedAt: now.toISOString(),
      expiresAt: new Date(now.getTime() + LINK_METADATA_TTL_MS).toISOString(),
    };

    setLinkMetadataCache(url, record);
    await saveLinkMetadataToDb(record);
    return record;
  } catch (err) {
    console.warn(`Failed to fetch link metadata for ${url}:`, err);
    return null;
  }
}

async function recordAuditLog(userId: string, action: string, postIds: string[], changes: Record<string, any> = {}) {
  if (!hasDatabase()) return;
  try {
    await pool!.query(
      'INSERT INTO audit_logs (id, user_id, action, post_ids, changes) VALUES ($1,$2,$3,$4::jsonb,$5::jsonb)',
      [randomUUID(), userId, action, JSON.stringify(postIds), JSON.stringify(changes)]
    );
  } catch (err) {
    console.warn('Failed to record audit log:', err);
  }
}
const extraOrigins = (process.env.FRONTEND_ORIGINS || '')
  .split(',')
  .map((origin) => origin.trim())
  .filter(Boolean);

const allowedOrigins = new Set([
  process.env.VITE_APP_URL || 'http://localhost:3000',
  'http://localhost:3000',
  'http://localhost:3001',
  'http://127.0.0.1:3000',
  'http://127.0.0.1:3001',
  'https://marketing.dakyworld.com',
  'https://daky0000.github.io',
  'https://contentflow-api-production.up.railway.app',
  ...extraOrigins,
]);

let pool: Pool | null = null;
try {
  pool = DATABASE_URL ? new Pool({ connectionString: DATABASE_URL }) : null;
} catch (err) {
  console.error('Failed to create database pool, running in in-memory mode:', err);
  pool = null;
}
let dbReady = false;

const SOCIAL_AUTOMATION_MAX_ATTEMPTS = 3;
const SOCIAL_AUTOMATION_RETRY_BASE_DELAY_MS = 30_000;
const TWITTER_AUTOMATION_MAX_ATTEMPTS = 6;
const TWITTER_AUTOMATION_RETRY_BASE_DELAY_MS = 60_000;
const SOCIAL_AUTOMATION_QUEUE_NAME = 'social-publish';
const facebookPagesPlatform = new FacebookPagesPlatform();
const instagramBusinessPlatform = new InstagramBusinessPlatform();
const linkedInPlatform = new LinkedInPlatform();
const twitterXPlatform = new TwitterXPlatform();

let socialAutomationQueue: Queue | null = null;
let socialAutomationWorker: Worker | null = null;
let socialAutomationRedis: IORedis | null = null;

const CAMPAIGN_QUEUE_NAME = 'campaign-jobs';
let campaignQueue: Queue | null = null;
let campaignWorker: Worker | null = null;

function isBullMqEnabled() {
  return Boolean(REDIS_URL && REDIS_URL.trim());
}

function getSocialAutomationMaxAttempts(platform?: string) {
  return normalizePlatformId(String(platform || '')) === 'twitter'
    ? TWITTER_AUTOMATION_MAX_ATTEMPTS
    : SOCIAL_AUTOMATION_MAX_ATTEMPTS;
}

function getRetryDelayMs(attemptNumber: number, platform?: string) {
  const n = Math.max(1, Number(attemptNumber || 1));
  const baseDelay =
    normalizePlatformId(String(platform || '')) === 'twitter'
      ? TWITTER_AUTOMATION_RETRY_BASE_DELAY_MS
      : SOCIAL_AUTOMATION_RETRY_BASE_DELAY_MS;
  return baseDelay * Math.pow(2, n - 1);
}

function hasDatabase() {
  // Consider the database "available" only after schema initialization succeeds.
  // If `DATABASE_URL` is set but the role can't run DDL (CREATE/ALTER), we fall back to in-memory mode
  // to avoid throwing 500s across endpoints that expect tables to exist.
  return Boolean(pool && dbReady);
}

type DataDeletionStatus = 'received' | 'completed' | 'unknown';
type DataDeletionRecord = {
  code: string;
  metaUserId: string | null;
  status: DataDeletionStatus;
  createdAt: string;
  completedAt: string | null;
};

const inMemoryDataDeletionRequests = new Map<string, DataDeletionRecord>();

async function ensureDatabase() {
  if (!pool) {
    console.warn('DATABASE_URL is not set; running in in-memory mode.');
    dbReady = false;
    seedInMemoryUsers();
    return;
  }

  await pool.query(`
    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY,
      email TEXT UNIQUE NOT NULL,
      username TEXT,
      password_hash TEXT NOT NULL,
      full_name TEXT,
      website TEXT,
      phone TEXT,
      country TEXT,
      created_at TIMESTAMPTZ DEFAULT NOW()
    );
  `);

  await pool.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS username TEXT;`);
  await pool.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS website TEXT;`);
  await pool.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS phone TEXT;`);
  await pool.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS country TEXT;`);
  await pool.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS role TEXT NOT NULL DEFAULT 'user';`);
  await pool.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'active';`);
  await pool.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS avatar_url TEXT;`);
  await pool.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS cover_url TEXT;`);
  await pool.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS last_login_at TIMESTAMPTZ;`);
  await pool.query(`
    CREATE UNIQUE INDEX IF NOT EXISTS users_username_unique_idx
    ON users (LOWER(username))
    WHERE username IS NOT NULL;
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS oauth_states (
      state TEXT PRIMARY KEY,
      user_id TEXT,
      platform TEXT NOT NULL,
      return_to TEXT,
      created_at TIMESTAMPTZ DEFAULT NOW(),
      expires_at TIMESTAMPTZ DEFAULT (NOW() + INTERVAL '15 minutes')
    );
  `);

  await pool.query(`ALTER TABLE oauth_states ADD COLUMN IF NOT EXISTS return_to TEXT;`).catch(() => undefined);
  await pool.query(`ALTER TABLE oauth_states ADD COLUMN IF NOT EXISTS code_verifier TEXT;`).catch(() => undefined);

  // Social Automation v2 schema (platform registry + richer account metadata)
  // CREATE social_platforms FIRST before social_accounts (which has a FK to it)
  await pool.query(`
    CREATE TABLE IF NOT EXISTS social_platforms (
      id BIGSERIAL PRIMARY KEY,
      name TEXT NOT NULL,
      slug TEXT UNIQUE NOT NULL,
      api_base_url TEXT,
      enabled BOOLEAN NOT NULL DEFAULT true,
      created_at TIMESTAMPTZ DEFAULT NOW()
    );
  `);
  await pool.query(
    `INSERT INTO social_platforms (name, slug, api_base_url, enabled)
     VALUES 
      ('Facebook', 'facebook', 'https://graph.facebook.com', true),
      ('Instagram', 'instagram', 'https://graph.instagram.com', true),
      ('LinkedIn', 'linkedin', 'https://api.linkedin.com', true),
      ('X (Twitter)', 'twitter', 'https://api.twitter.com', true),
      ('Pinterest', 'pinterest', 'https://api.pinterest.com', true),
      ('TikTok', 'tiktok', 'https://api.tiktok.com', true),
      ('Threads', 'threads', 'https://graph.threads.net', true)
     ON CONFLICT (slug) DO UPDATE SET name=EXCLUDED.name, api_base_url=EXCLUDED.api_base_url;`
  ).catch(() => undefined);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS social_accounts (
      id TEXT PRIMARY KEY,
      user_id TEXT REFERENCES users(id) ON DELETE CASCADE,
      platform TEXT NOT NULL,
      platform_id BIGINT REFERENCES social_platforms(id) ON DELETE SET NULL,
      account_type TEXT,
      account_id TEXT,
      account_name TEXT,
      profile_image TEXT,
      handle TEXT,
      followers INTEGER DEFAULT 0,
      connected BOOLEAN DEFAULT TRUE,
      connected_at TIMESTAMPTZ DEFAULT NOW(),
      expires_at TIMESTAMPTZ,
      token_expires_at TIMESTAMPTZ,
      access_token TEXT,
      refresh_token TEXT,
      access_token_encrypted TEXT,
      refresh_token_encrypted TEXT,
      token_data JSONB DEFAULT '{}'::jsonb,
      created_at TIMESTAMPTZ DEFAULT NOW()
    );
  `);

  // Migrate: remove legacy uniqueness constraint so users can save multiple accounts per platform.
  await pool.query(`ALTER TABLE social_accounts DROP CONSTRAINT IF EXISTS social_accounts_user_id_platform_key;`).catch(() => undefined);
  // Ensure a single OAuth profile token row per (user, platform).
  await pool.query(
    `CREATE UNIQUE INDEX IF NOT EXISTS social_accounts_user_platform_profile_unique_idx
     ON social_accounts (user_id, platform)
     WHERE account_type = 'profile';`
  ).catch(() => undefined);
  // Prevent duplicate saved targets per (user, platform, type, id).
  await pool.query(
    `CREATE UNIQUE INDEX IF NOT EXISTS social_accounts_user_platform_account_unique_idx
     ON social_accounts (user_id, platform, account_type, account_id)
     WHERE account_id IS NOT NULL AND account_type IS NOT NULL;`
  ).catch(() => undefined);

  // social_platforms and platform_id columns already created above, now just handle migrations
  await pool.query(`ALTER TABLE social_accounts ADD COLUMN IF NOT EXISTS platform_id BIGINT REFERENCES social_platforms(id) ON DELETE SET NULL;`).catch(() => undefined);
  await pool.query(`ALTER TABLE social_accounts ADD COLUMN IF NOT EXISTS account_type TEXT;`).catch(() => undefined);
  await pool.query(`ALTER TABLE social_accounts ADD COLUMN IF NOT EXISTS account_id TEXT;`).catch(() => undefined);
  await pool.query(`ALTER TABLE social_accounts ADD COLUMN IF NOT EXISTS account_name TEXT;`).catch(() => undefined);
  await pool.query(`ALTER TABLE social_accounts ADD COLUMN IF NOT EXISTS profile_image TEXT;`).catch(() => undefined);
  await pool.query(`ALTER TABLE social_accounts ADD COLUMN IF NOT EXISTS token_expires_at TIMESTAMPTZ;`).catch(() => undefined);
  await pool.query(`ALTER TABLE social_accounts ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ DEFAULT NOW();`).catch(() => undefined);
  await pool.query(`ALTER TABLE social_accounts ADD COLUMN IF NOT EXISTS access_token_encrypted TEXT;`).catch(() => undefined);
  await pool.query(`ALTER TABLE social_accounts ADD COLUMN IF NOT EXISTS refresh_token_encrypted TEXT;`).catch(() => undefined);
  await pool.query(`ALTER TABLE social_accounts ADD COLUMN IF NOT EXISTS needs_reapproval BOOLEAN DEFAULT FALSE;`).catch(() => undefined);
  await pool.query(`CREATE INDEX IF NOT EXISTS social_accounts_user_platform_idx ON social_accounts (user_id, platform_id);`).catch(() => undefined);

  // Best-effort backfill of `platform_id` for existing connections.
  await pool.query(
    `UPDATE social_accounts sa
     SET platform_id = sp.id
     FROM social_platforms sp
     WHERE sa.platform_id IS NULL
       AND LOWER(sa.platform) = sp.slug;`
  ).catch(() => undefined);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS social_connections (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      social_account_id TEXT NOT NULL REFERENCES social_accounts(id) ON DELETE CASCADE,
      active BOOLEAN NOT NULL DEFAULT true,
      created_at TIMESTAMPTZ DEFAULT NOW()
    );
  `);
  await pool.query(`CREATE INDEX IF NOT EXISTS social_connections_user_idx ON social_connections (user_id);`).catch(() => undefined);
  await pool.query(`CREATE UNIQUE INDEX IF NOT EXISTS social_connections_user_account_unique_idx ON social_connections (user_id, social_account_id);`).catch(() => undefined);

  // Admin OAuth/app credentials (separate from platform_configs/auth_providers legacy tables)
  await pool.query(`
    CREATE TABLE IF NOT EXISTS integrations (
      id BIGSERIAL PRIMARY KEY,
      provider TEXT NOT NULL,
      name TEXT,
      slug TEXT,
      type TEXT,
      client_id TEXT,
      client_secret TEXT,
      redirect_url TEXT,
      enabled BOOLEAN NOT NULL DEFAULT true,
      created_at TIMESTAMPTZ DEFAULT NOW()
    );
  `);
  await pool.query(`CREATE UNIQUE INDEX IF NOT EXISTS integrations_provider_unique_idx ON integrations (LOWER(provider));`).catch(() => undefined);
  await pool.query(`ALTER TABLE integrations ADD COLUMN IF NOT EXISTS name TEXT;`).catch(() => undefined);
  await pool.query(`ALTER TABLE integrations ADD COLUMN IF NOT EXISTS slug TEXT;`).catch(() => undefined);
  await pool.query(`ALTER TABLE integrations ADD COLUMN IF NOT EXISTS type TEXT;`).catch(() => undefined);
  await pool.query(`CREATE UNIQUE INDEX IF NOT EXISTS integrations_slug_unique_idx ON integrations (slug);`).catch(() => undefined);
  await pool.query(`UPDATE integrations SET slug = LOWER(COALESCE(slug, provider)) WHERE slug IS NOT NULL OR provider IS NOT NULL;`).catch(() => undefined);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS user_integrations (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      integration_id BIGINT NOT NULL REFERENCES integrations(id) ON DELETE CASCADE,
      access_token TEXT,
      refresh_token TEXT,
      token_expiry TIMESTAMPTZ,
      account_id TEXT,
      account_name TEXT,
      status TEXT NOT NULL DEFAULT 'connected',
      created_at TIMESTAMPTZ DEFAULT NOW()
    );
  `);
  await pool.query(`CREATE INDEX IF NOT EXISTS user_integrations_user_id_idx ON user_integrations (user_id);`).catch(() => undefined);
  await pool.query(`CREATE UNIQUE INDEX IF NOT EXISTS user_integrations_user_integration_unique_idx ON user_integrations (user_id, integration_id);`).catch(() => undefined);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS integration_logs (
      id TEXT PRIMARY KEY,
      user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
      integration_id BIGINT REFERENCES integrations(id) ON DELETE SET NULL,
      event_type TEXT NOT NULL,
      status TEXT NOT NULL,
      response JSONB DEFAULT '{}'::jsonb,
      created_at TIMESTAMPTZ DEFAULT NOW()
    );
  `);
  await pool.query(`CREATE INDEX IF NOT EXISTS integration_logs_user_idx ON integration_logs (user_id);`).catch(() => undefined);
  await pool.query(`CREATE INDEX IF NOT EXISTS integration_logs_integration_idx ON integration_logs (integration_id);`).catch(() => undefined);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS data_deletion_requests (
      code TEXT PRIMARY KEY,
      platform TEXT NOT NULL DEFAULT 'meta',
      meta_user_id TEXT,
      status TEXT NOT NULL DEFAULT 'received',
      payload JSONB DEFAULT '{}'::jsonb,
      created_at TIMESTAMPTZ DEFAULT NOW(),
      completed_at TIMESTAMPTZ
    );
  `);
  await pool.query(`
    CREATE INDEX IF NOT EXISTS data_deletion_requests_meta_user_id_idx
    ON data_deletion_requests (meta_user_id);
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS wordpress_connections (
      id TEXT PRIMARY KEY,
      user_id TEXT REFERENCES users(id) ON DELETE CASCADE,
      site_url TEXT NOT NULL,
      username TEXT NOT NULL,
      app_password_encrypted TEXT NOT NULL,
      created_at TIMESTAMPTZ DEFAULT NOW(),
      UNIQUE (user_id)
    );
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS make_webhook_connections (
      id TEXT PRIMARY KEY,
      user_id TEXT REFERENCES users(id) ON DELETE CASCADE,
      webhook_url_encrypted TEXT NOT NULL,
      created_at TIMESTAMPTZ DEFAULT NOW(),
      UNIQUE (user_id)
    );
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS pricing_plans (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      description TEXT NOT NULL,
      price DECIMAL(10, 2) NOT NULL,
      billing_period TEXT NOT NULL DEFAULT 'monthly',
      features TEXT[] DEFAULT '{}',
      is_active BOOLEAN DEFAULT TRUE,
      discount_percentage DECIMAL(5,2) DEFAULT 0,
      is_on_sale BOOLEAN DEFAULT FALSE,
      created_at TIMESTAMPTZ DEFAULT NOW(),
      updated_at TIMESTAMPTZ DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS card_templates (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      description TEXT,
      design_data JSON NOT NULL,
      cover_image_url TEXT,
      is_published BOOLEAN DEFAULT FALSE,
      created_at TIMESTAMPTZ DEFAULT NOW(),
      updated_at TIMESTAMPTZ DEFAULT NOW()
    );
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS platform_configs (
      platform TEXT PRIMARY KEY,
      config JSONB NOT NULL DEFAULT '{}',
      enabled BOOLEAN NOT NULL DEFAULT false,
      updated_at TIMESTAMPTZ DEFAULT NOW()
    );
  `);
  await pool.query(`CREATE UNIQUE INDEX IF NOT EXISTS platform_configs_platform_unique_idx ON platform_configs (platform);`).catch(() => undefined);
  await pool.query(`
    DO $$
    BEGIN
      IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conrelid = 'platform_configs'::regclass
          AND contype = 'u'
          AND conname = 'platform_configs_platform_key'
      ) THEN
        ALTER TABLE platform_configs ADD CONSTRAINT platform_configs_platform_key UNIQUE (platform);
      END IF;
    END
    $$;
  `).catch(() => undefined);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS user_settings (
      user_id TEXT REFERENCES users(id) ON DELETE CASCADE,
      key TEXT NOT NULL,
      value JSONB NOT NULL DEFAULT '{}'::jsonb,
      created_at TIMESTAMPTZ DEFAULT NOW(),
      updated_at TIMESTAMPTZ DEFAULT NOW(),
      PRIMARY KEY (user_id, key)
    );
    CREATE INDEX IF NOT EXISTS user_settings_user_id_idx ON user_settings (user_id);

    CREATE TABLE IF NOT EXISTS auth_providers (
      provider TEXT PRIMARY KEY,
      config JSONB NOT NULL DEFAULT '{}',
      enabled BOOLEAN NOT NULL DEFAULT false,
      updated_at TIMESTAMPTZ DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS payment_transactions (
      id TEXT PRIMARY KEY,
      amount NUMERIC(12,2) NOT NULL,
      currency TEXT NOT NULL DEFAULT 'GHS',
      description TEXT,
      status TEXT NOT NULL DEFAULT 'pending',
      provider TEXT NOT NULL DEFAULT 'hubtel',
      client_reference TEXT UNIQUE,
      provider_reference TEXT,
      customer_name TEXT,
      customer_email TEXT,
      customer_phone TEXT,
      checkout_url TEXT,
      metadata JSONB,
      created_at TIMESTAMPTZ DEFAULT NOW(),
      updated_at TIMESTAMPTZ DEFAULT NOW()
    );
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS page_content (
      slug TEXT PRIMARY KEY,
      content JSONB NOT NULL DEFAULT '{}',
      updated_at TIMESTAMPTZ DEFAULT NOW()
    );
  `);

  // Migrate: add discount columns to existing pricing_plans tables
  await pool.query(`
    ALTER TABLE pricing_plans ADD COLUMN IF NOT EXISTS discount_percentage DECIMAL(5,2) DEFAULT 0;
    ALTER TABLE pricing_plans ADD COLUMN IF NOT EXISTS is_on_sale BOOLEAN DEFAULT FALSE;
  `).catch(() => { /* ignore if columns already exist or table doesn't exist yet */ });

  await pool.query(`
    CREATE TABLE IF NOT EXISTS user_designs (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      name TEXT NOT NULL DEFAULT 'Untitled Design',
      canvas_width INTEGER NOT NULL DEFAULT 1080,
      canvas_height INTEGER NOT NULL DEFAULT 1080,
      canvas_data JSONB NOT NULL DEFAULT '{}',
      thumbnail_url TEXT,
      created_at TIMESTAMPTZ DEFAULT NOW(),
      updated_at TIMESTAMPTZ DEFAULT NOW()
    );
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS media_images (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      file_name TEXT NOT NULL,
      original_name TEXT NOT NULL,
      file_size INTEGER NOT NULL DEFAULT 0,
      file_type TEXT NOT NULL DEFAULT 'image/jpeg',
      width INTEGER,
      height INTEGER,
      upload_date TIMESTAMPTZ DEFAULT NOW(),
      url TEXT NOT NULL,
      thumbnail_url TEXT,
      alt_text TEXT DEFAULT '',
      caption TEXT DEFAULT '',
      description TEXT DEFAULT '',
      tags TEXT[] DEFAULT '{}',
      used_in JSONB DEFAULT '[]',
      category TEXT DEFAULT 'user'
    );
  `);
  await pool.query(`ALTER TABLE media_images ADD COLUMN IF NOT EXISTS category TEXT DEFAULT 'user'`);
  // Fix: non-admin users could previously self-assign category='admin' via upload body.
  // Reset all non-admin-owned rows that were incorrectly marked as 'admin' shared assets.
  await pool.query(
    `UPDATE media_images SET category='user' WHERE category='admin' AND user_id NOT IN (SELECT id FROM users WHERE role='admin')`
  ).catch(() => undefined);
  await pool.query(`ALTER TABLE media_images ADD COLUMN IF NOT EXISTS alt_text TEXT DEFAULT ''`).catch(() => undefined);
  await pool.query(`ALTER TABLE media_images ADD COLUMN IF NOT EXISTS caption TEXT DEFAULT ''`).catch(() => undefined);
  await pool.query(`ALTER TABLE media_images ADD COLUMN IF NOT EXISTS description TEXT DEFAULT ''`).catch(() => undefined);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS media_image_links (
      id TEXT PRIMARY KEY,
      media_image_id TEXT NOT NULL REFERENCES media_images(id) ON DELETE CASCADE,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      source_table TEXT NOT NULL,
      source_id TEXT NOT NULL,
      source_field TEXT NOT NULL,
      created_at TIMESTAMPTZ DEFAULT NOW(),
      updated_at TIMESTAMPTZ DEFAULT NOW(),
      UNIQUE (user_id, media_image_id, source_table, source_id, source_field)
    );
  `).catch(() => undefined);
  await pool.query(`CREATE INDEX IF NOT EXISTS media_images_user_upload_idx ON media_images (user_id, upload_date DESC)`).catch(() => undefined);
  await pool.query(`CREATE INDEX IF NOT EXISTS media_images_category_upload_idx ON media_images (category, upload_date DESC)`).catch(() => undefined);
  await pool.query(`CREATE INDEX IF NOT EXISTS media_images_user_url_idx ON media_images (user_id, url)`).catch(() => undefined);
  await pool.query(`CREATE INDEX IF NOT EXISTS media_image_links_user_source_idx ON media_image_links (user_id, source_table, source_id, source_field)`).catch(() => undefined);
  await pool.query(`CREATE INDEX IF NOT EXISTS media_image_links_media_idx ON media_image_links (media_image_id)`).catch(() => undefined);

  // Seed integrations registry (best-effort; idempotent)
  await pool.query(
    `INSERT INTO integrations (provider, name, slug, type, enabled)
     VALUES
      ('wordpress','WordPress','wordpress','cms', true),
      ('facebook','Facebook','facebook','social', true),
      ('instagram','Instagram','instagram','social', true),
      ('linkedin','LinkedIn','linkedin','social', true),
      ('twitter','X (Twitter)','twitter','social', true),
      ('pinterest','Pinterest','pinterest','social', true),
      ('mailchimp','Mailchimp','mailchimp','marketing', true)
     ON CONFLICT (slug) DO UPDATE
      SET name = EXCLUDED.name, provider = EXCLUDED.provider, type = EXCLUDED.type;`
  ).catch(() => undefined);

  // Blog post management tables
  await pool.query(`
    CREATE TABLE IF NOT EXISTS blog_categories (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      name TEXT NOT NULL,
      slug TEXT NOT NULL,
      created_at TIMESTAMPTZ DEFAULT NOW()
    );
  `);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS blog_tags (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      name TEXT NOT NULL,
      slug TEXT NOT NULL,
      created_at TIMESTAMPTZ DEFAULT NOW()
    );
  `);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS blog_posts (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      title TEXT NOT NULL DEFAULT '',
      slug TEXT NOT NULL DEFAULT '',
      content TEXT NOT NULL DEFAULT '',
      excerpt TEXT DEFAULT '',
      featured_image TEXT DEFAULT '',
      status TEXT NOT NULL DEFAULT 'draft',
      category_id TEXT REFERENCES blog_categories(id) ON DELETE SET NULL,
      meta_title TEXT DEFAULT '',
      meta_description TEXT DEFAULT '',
      focus_keyword TEXT DEFAULT '',
      social_title TEXT DEFAULT '',
      social_description TEXT DEFAULT '',
      social_image TEXT DEFAULT '',
      scheduled_at TIMESTAMPTZ,
      published_at TIMESTAMPTZ,
      created_at TIMESTAMPTZ DEFAULT NOW(),
      updated_at TIMESTAMPTZ DEFAULT NOW()
    );
  `);

  await pool.query(`ALTER TABLE blog_posts ADD COLUMN IF NOT EXISTS social_automation JSONB DEFAULT '{}'::jsonb;`).catch(() => undefined);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS link_metadata (
      id TEXT PRIMARY KEY,
      url TEXT UNIQUE NOT NULL,
      title TEXT DEFAULT '',
      description TEXT DEFAULT '',
      image TEXT,
      fetched_at TIMESTAMPTZ DEFAULT NOW(),
      expires_at TIMESTAMPTZ NOT NULL
    );
  `);
  await pool.query(`CREATE INDEX IF NOT EXISTS link_metadata_url_idx ON link_metadata (url);`).catch(() => undefined);
  await pool.query(`CREATE INDEX IF NOT EXISTS link_metadata_expires_idx ON link_metadata (expires_at);`).catch(() => undefined);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS audit_logs (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      action TEXT NOT NULL,
      post_ids JSONB DEFAULT '[]'::jsonb,
      changes JSONB DEFAULT '{}'::jsonb,
      created_at TIMESTAMPTZ DEFAULT NOW()
    );
  `);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS blog_post_tags (
      post_id TEXT NOT NULL REFERENCES blog_posts(id) ON DELETE CASCADE,
      tag_id TEXT NOT NULL REFERENCES blog_tags(id) ON DELETE CASCADE,
      PRIMARY KEY (post_id, tag_id)
    );
  `);

  // Social Templates: per-user per-platform template settings + share frequency tracking
  await pool.query(`
    CREATE TABLE IF NOT EXISTS social_template_settings (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      platform TEXT NOT NULL,
      content_source TEXT NOT NULL DEFAULT 'EXCERPT',
      template_string TEXT NOT NULL DEFAULT '{title}\n\n{content}\n\n{url}\n\n{tags}',
      status_limit INTEGER NOT NULL DEFAULT 280,
      max_status_limit INTEGER NOT NULL DEFAULT 280,
      share_limit_per_post INTEGER NOT NULL DEFAULT 0,
      add_categories_as_tags BOOLEAN NOT NULL DEFAULT false,
      remove_css BOOLEAN NOT NULL DEFAULT false,
      show_thumbnail BOOLEAN NOT NULL DEFAULT false,
      add_image_link BOOLEAN NOT NULL DEFAULT false,
      content_type TEXT,
      enabled BOOLEAN NOT NULL DEFAULT true,
      created_at TIMESTAMPTZ DEFAULT NOW(),
      updated_at TIMESTAMPTZ DEFAULT NOW(),
      UNIQUE (user_id, platform)
    );
  `);
  await pool.query(`CREATE INDEX IF NOT EXISTS social_template_settings_user_idx ON social_template_settings (user_id);`).catch(() => undefined);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS post_share_counts (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      post_id TEXT NOT NULL REFERENCES blog_posts(id) ON DELETE CASCADE,
      platform TEXT NOT NULL,
      share_count INTEGER NOT NULL DEFAULT 0,
      last_shared_at TIMESTAMPTZ,
      UNIQUE (user_id, post_id, platform)
    );
  `);
  await pool.query(
    `CREATE INDEX IF NOT EXISTS post_share_counts_user_post_platform_idx ON post_share_counts (user_id, post_id, platform);`
  ).catch(() => undefined);

  // Social Automation v2: per-post settings + targets + logs
  await pool.query(`
    CREATE TABLE IF NOT EXISTS social_post_settings (
      id TEXT PRIMARY KEY,
      post_id TEXT NOT NULL REFERENCES blog_posts(id) ON DELETE CASCADE,
      template TEXT DEFAULT '',
      publish_type TEXT NOT NULL DEFAULT 'immediate',
      scheduled_at TIMESTAMPTZ,
      created_at TIMESTAMPTZ DEFAULT NOW()
    );
  `);
  await pool.query(
    `ALTER TABLE social_post_settings
     ADD CONSTRAINT social_post_settings_publish_type_chk
     CHECK (publish_type IN ('immediate','scheduled','delayed'))`
  ).catch(() => undefined);
  await pool.query(`CREATE UNIQUE INDEX IF NOT EXISTS social_post_settings_post_unique_idx ON social_post_settings (post_id);`).catch(() => undefined);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS social_post_targets (
      id TEXT PRIMARY KEY,
      social_post_id TEXT NOT NULL REFERENCES social_post_settings(id) ON DELETE CASCADE,
      social_account_id TEXT NOT NULL REFERENCES social_accounts(id) ON DELETE CASCADE,
      enabled BOOLEAN NOT NULL DEFAULT true
    );
  `);
  await pool.query(`CREATE INDEX IF NOT EXISTS social_post_targets_post_idx ON social_post_targets (social_post_id);`).catch(() => undefined);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS social_post_logs (
      id TEXT PRIMARY KEY,
      post_id TEXT NOT NULL REFERENCES blog_posts(id) ON DELETE CASCADE,
      social_account_id TEXT REFERENCES social_accounts(id) ON DELETE SET NULL,
      platform TEXT NOT NULL,
      status TEXT NOT NULL,
      api_response JSONB,
      posted_at TIMESTAMPTZ,
      created_at TIMESTAMPTZ DEFAULT NOW()
    );
  `);
  await pool.query(`CREATE INDEX IF NOT EXISTS social_post_logs_post_idx ON social_post_logs (post_id);`).catch(() => undefined);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS publishing_logs (
      id TEXT PRIMARY KEY,
      post_id TEXT NOT NULL,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      platform TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'pending',
      platform_post_id TEXT,
      account TEXT,
      error_message TEXT,
      response JSONB,
      scheduled_for TIMESTAMPTZ,
      created_at TIMESTAMPTZ DEFAULT NOW()
    );
  `);

  await pool.query(`ALTER TABLE publishing_logs ADD COLUMN IF NOT EXISTS account TEXT;`).catch(() => undefined);
  await pool.query(`ALTER TABLE publishing_logs ADD COLUMN IF NOT EXISTS response JSONB;`).catch(() => undefined);
  await pool.query(`ALTER TABLE publishing_logs ADD COLUMN IF NOT EXISTS scheduled_for TIMESTAMPTZ;`).catch(() => undefined);
  await pool.query(`ALTER TABLE publishing_logs ADD COLUMN IF NOT EXISTS posted_at TIMESTAMPTZ;`).catch(() => undefined);
  // Ensure post_id FK exists so deleting a blog post cascades to its publishing logs
  await pool.query(`
    ALTER TABLE publishing_logs
    ADD CONSTRAINT publishing_logs_post_fk
    FOREIGN KEY (post_id) REFERENCES blog_posts(id) ON DELETE CASCADE
    NOT VALID;
  `).catch(() => undefined);
  await pool.query(`CREATE INDEX IF NOT EXISTS publishing_logs_post_idx ON publishing_logs (post_id);`).catch(() => undefined);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS social_automation_tasks (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      post_id TEXT NOT NULL REFERENCES blog_posts(id) ON DELETE CASCADE,
      platform TEXT NOT NULL,
      run_at TIMESTAMPTZ NOT NULL,
      status TEXT NOT NULL DEFAULT 'scheduled',
      payload JSONB DEFAULT '{}'::jsonb,
      log_id TEXT,
      attempts INTEGER DEFAULT 0,
      last_error TEXT,
      created_at TIMESTAMPTZ DEFAULT NOW(),
      updated_at TIMESTAMPTZ DEFAULT NOW()
    );
  `);
  await pool.query(`CREATE INDEX IF NOT EXISTS social_automation_tasks_due_idx ON social_automation_tasks (status, run_at);`).catch(() => undefined);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS platform_rate_counters (
      id BIGSERIAL PRIMARY KEY,
      platform TEXT NOT NULL,
      period_start DATE NOT NULL,
      period_end DATE NOT NULL,
      counter INTEGER NOT NULL DEFAULT 0,
      updated_at TIMESTAMPTZ DEFAULT NOW()
    );
  `);
  await pool.query(
    `CREATE UNIQUE INDEX IF NOT EXISTS platform_rate_counters_unique_idx
     ON platform_rate_counters (platform, period_start, period_end);`
  ).catch(() => undefined);

  // ─── AI Skills ────────────────────────────────────────────────────────────────
  await pool.query(`
    CREATE TABLE IF NOT EXISTS ai_skills (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      description TEXT NOT NULL DEFAULT '',
      system_prompt TEXT NOT NULL DEFAULT '',
      scope TEXT NOT NULL DEFAULT 'all',
      enabled BOOLEAN NOT NULL DEFAULT true,
      sort_order INTEGER NOT NULL DEFAULT 0,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `).catch(() => undefined);

  // Seed the built-in Content Generator skill (ON CONFLICT = skip if already exists)
  try {
    const cgId = 'skill-content-generator-v1';
    const cgPrompt = `## CONTENT GENERATION SKILL — THREE-STAGE PIPELINE

When a user asks you to generate content, write an article, create SEO content, or produce a blog post about a topic, activate this three-stage pipeline and execute all three stages in sequence before presenting output.

---

### STAGE 1 — IDEA INSPIRATION RESEARCHER

Analyze how the topic is commonly covered. Extract structured insights, angles, gaps, and opportunities using your training knowledge. For every insight you derive, note the type of source that would typically cover it.

Deliver these sections:

1. Topic Overview — Summarize the core job readers want done. What questions are they asking? What outcomes do they want?
2. Common Angles in Existing Content — List the angles other writers commonly use.
3. High-Performing Themes — Identify content patterns and structures that appear frequently and perform well.
4. Identified Gaps — Highlight areas that are often ignored, weakly explained, or missing depth.
5. Unique Angles to Explore — Recommend angles not commonly used.
6. Must-Cover Subtopics — List subtopics essential for comprehensive coverage.
7. Reader Questions — List real questions readers expect answered but remain underserved.
8. Format Recommendations — Suggest formats based on what performs well (how-to guides, checklists, templates, comparisons, case examples).
9. Overused or Weak Ideas — Identify repetitive or saturated angles to avoid.
10. Final Inspiration Summary — A brief original synthesis of the strongest opportunities discovered.

Rules:
- Never reproduce external text. All insights must be original.
- No summaries of external content. Every insight must be your own synthesis.

---

### STAGE 2 — KEYWORD AND POWER WORD EXTRACTION

Pull structured keyword data from the Stage 1 research output to fuel the article.

Deliver the following:

Main Keyword or Keyphrase — The single strongest keyword to anchor the article.
Alternative Keywords or Keyphrases — Secondary terms closely related to the main keyword.
Long-Tail Keyphrases — Specific multi-word phrases that reflect precise reader intent. These must later appear in article body content or FAQs.
Matched Power Words — Select the most relevant power words from this list to use in the SEO title and throughout the article:

Power Word Reference: Absolute, Accurate, Achieve, Actionable, Adaptable, Advantage, Affordable, Amazing, Approved, Assured, Astonishing, Astounding, Authentic, Authoritative, Authority, Awesome, Backed, Badass, Balanced, Bargain, Genius, Genuine, Gift, Giveaway, Glamorous, Glorious, Guaranteed, Growth, Hack, Happiness, Healthy, Hero, Hidden, Highly Effective, Hilarious, Honest, Hope, Hopeful, How To, Huge, Ignite, Important, Improved, Increase, Incredible, Indulgent, Inexpensive, Fundamentals, Funny, Greatest, Greatness, Grit, Grounded.

Output format (use plain text, no markdown code fences):
Main Keyword: [keyword]
Alternative Keywords: [keyword 1], [keyword 2], [keyword 3]
Long-Tail Keyphrases:
- [phrase 1]
- [phrase 2]
- [phrase 3]
Power Words Selected: [word 1], [word 2], [word 3]

---

### STAGE 3 — SEO ARTICLE GENERATION

Produce a complete, fully optimized HTML article using all outputs from Stages 1 and 2.

Output must follow this exact order:
1. Keyword or Keyphrase
2. SEO Title
3. Meta Description
4. Full HTML Content
5. FAQs (numbered)
6. Conclusion
7. Internal Link Placement notes
8. External Link Placement notes
9. Call to Action

STRICT RULES:

SEO Title: Must be under 60 characters. Must contain the main keyword. Must include positive or negative sentiment. Must contain a power word from Stage 2.

Meta Description: Must be under 160 characters. Must contain the main keyword.

Main Keyword Usage: Must appear in title, meta description, first sentence, and at least one heading. Natural placement only. Target density 1.5% to 3.5%.

Word Count: Minimum 900 words.

Sentence Limit: No sentence may exceed 20 words.

Paragraph Limit: Short paragraphs only — 2 to 4 lines maximum.

Structure: Use one h1 only (the article title). Use h2 for major sections. Use h3 for subsections.

FAQs: Must be numbered. Must be derived from the long-tail keyphrases in Stage 2.

Conclusion: Include a clear summary. Include a CTA with an internal link embedded in a relevant phrase.

Skimmability: Use lists, bullets, and bold text. Bold text must use HTML b tags only. No Markdown asterisks anywhere in the output.

Internal Links: Insert only where they genuinely help the reader. Use short anchor text of six words maximum. Use exact URLs only — never place a bare URL in the text.

External Links: Include at least 3 external links sourced from Stage 1 research. Link to relevant words or phrases inside body content. Do not place external links at the end of paragraphs in isolation.

No Asterisks: Remove all asterisks from output. Bold any cleaned phrase using b tags instead.

All output must be valid HTML. No plain text, no Markdown.

---

### FINAL INSTRUCTION

Execute all three stages in sequence for the topic provided. Do not skip stages. Do not present partial output. Deliver the complete three-stage result as one unified response, clearly labeled by stage.`;

    await pool.query(
      `INSERT INTO ai_skills (id, name, description, system_prompt, scope, enabled, sort_order)
       VALUES ($1, $2, $3, $4, 'all', true, 0)
       ON CONFLICT (id) DO NOTHING`,
      [cgId, 'Content Generator', 'Three-stage content pipeline: research inspiration, keyword extraction, and full SEO article generation.', cgPrompt]
    );
  } catch (e) {
    console.warn('ai_skills seed skipped:', e);
  }

  // Ensure cover_image_url exists on card_templates (added in v6.4)
  await pool.query(`ALTER TABLE card_templates ADD COLUMN IF NOT EXISTS cover_image_url TEXT`);

  // Seed card templates once if the table is empty
  try {
    const { rows: existingRows } = await pool.query<{ id: string }>('SELECT id FROM card_templates LIMIT 1');
    if (existingRows.length === 0) {
      // const now = new Date().toISOString();
      // for (const t of SAMPLE_TEMPLATES) {
      //   const tid = randomUUID();
      //   await pool.query(
      //     'INSERT INTO card_templates (id, name, description, design_data, cover_image_url, is_published, created_at, updated_at) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)',
      //     [tid, t.name, t.description, JSON.stringify(t.designData), '', true, now, now],
      //   );
      // }
      // console.log(`Seeded ${SAMPLE_TEMPLATES.length} card templates.`);
    }
  } catch (e) {
    console.warn('Card template seed skipped:', e);
  }

  // ─── Mailing Module (additive only) ────────────────────────────────────────

  await pool.query(`
    CREATE TABLE IF NOT EXISTS mailing_contacts (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      email TEXT NOT NULL,
      first_name TEXT,
      last_name TEXT,
      source TEXT DEFAULT 'manual',
      subscribed BOOLEAN NOT NULL DEFAULT true,
      email_marketing_consent BOOLEAN NOT NULL DEFAULT false,
      unsubscribe_token TEXT,
      unsubscribed_at TIMESTAMPTZ,
      created_at TIMESTAMPTZ DEFAULT NOW(),
      updated_at TIMESTAMPTZ DEFAULT NOW(),
      UNIQUE(user_id, email)
    );
  `).catch(() => undefined);
  await pool.query(`ALTER TABLE mailing_contacts ADD COLUMN IF NOT EXISTS unsubscribe_token TEXT;`).catch(() => undefined);
  await pool.query(`CREATE INDEX IF NOT EXISTS mailing_contacts_user_idx ON mailing_contacts (user_id);`).catch(() => undefined);
  await pool.query(`CREATE INDEX IF NOT EXISTS mailing_contacts_email_idx ON mailing_contacts (email);`).catch(() => undefined);
  await pool.query(`CREATE UNIQUE INDEX IF NOT EXISTS mailing_contacts_unsubscribe_token_unique_idx ON mailing_contacts (unsubscribe_token) WHERE unsubscribe_token IS NOT NULL;`).catch(() => undefined);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS mailing_contact_tags (
      id TEXT PRIMARY KEY,
      contact_id TEXT NOT NULL REFERENCES mailing_contacts(id) ON DELETE CASCADE,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      tag TEXT NOT NULL,
      created_at TIMESTAMPTZ DEFAULT NOW(),
      UNIQUE(contact_id, tag)
    );
  `).catch(() => undefined);
  await pool.query(`CREATE INDEX IF NOT EXISTS mailing_contact_tags_contact_idx ON mailing_contact_tags (contact_id);`).catch(() => undefined);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS mailing_segments (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      name TEXT NOT NULL,
      rules JSONB NOT NULL DEFAULT '[]'::jsonb,
      created_at TIMESTAMPTZ DEFAULT NOW(),
      updated_at TIMESTAMPTZ DEFAULT NOW()
    );
  `).catch(() => undefined);
  await pool.query(`CREATE INDEX IF NOT EXISTS mailing_segments_user_idx ON mailing_segments (user_id);`).catch(() => undefined);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS mailing_campaigns (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      name TEXT NOT NULL,
      subject TEXT NOT NULL,
      preview_text TEXT,
      content TEXT NOT NULL DEFAULT '',
      segment_id TEXT REFERENCES mailing_segments(id) ON DELETE SET NULL,
      status TEXT NOT NULL DEFAULT 'draft',
      scheduled_at TIMESTAMPTZ,
      sent_at TIMESTAMPTZ,
      recipient_count INTEGER DEFAULT 0,
      sent_count INTEGER DEFAULT 0,
      failed_count INTEGER DEFAULT 0,
      created_at TIMESTAMPTZ DEFAULT NOW(),
      updated_at TIMESTAMPTZ DEFAULT NOW()
    );
  `).catch(() => undefined);
  await pool.query(`ALTER TABLE mailing_campaigns ADD COLUMN IF NOT EXISTS sent_count INTEGER DEFAULT 0;`).catch(() => undefined);
  await pool.query(`ALTER TABLE mailing_campaigns ADD COLUMN IF NOT EXISTS failed_count INTEGER DEFAULT 0;`).catch(() => undefined);
  await pool.query(`CREATE INDEX IF NOT EXISTS mailing_campaigns_user_idx ON mailing_campaigns (user_id);`).catch(() => undefined);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS mailing_automations (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      name TEXT NOT NULL,
      trigger_type TEXT NOT NULL DEFAULT 'signup',
      conditions JSONB NOT NULL DEFAULT '[]'::jsonb,
      actions JSONB NOT NULL DEFAULT '[]'::jsonb,
      status TEXT NOT NULL DEFAULT 'draft',
      created_at TIMESTAMPTZ DEFAULT NOW(),
      updated_at TIMESTAMPTZ DEFAULT NOW()
    );
  `).catch(() => undefined);
  await pool.query(`CREATE INDEX IF NOT EXISTS mailing_automations_user_idx ON mailing_automations (user_id);`).catch(() => undefined);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS mailing_email_events (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      campaign_id TEXT REFERENCES mailing_campaigns(id) ON DELETE CASCADE,
      contact_id TEXT REFERENCES mailing_contacts(id) ON DELETE CASCADE,
      event_type TEXT NOT NULL,
      metadata JSONB DEFAULT '{}'::jsonb,
      created_at TIMESTAMPTZ DEFAULT NOW()
    );
  `).catch(() => undefined);
  await pool.query(`CREATE INDEX IF NOT EXISTS mailing_email_events_campaign_idx ON mailing_email_events (campaign_id);`).catch(() => undefined);
  await pool.query(`CREATE INDEX IF NOT EXISTS mailing_email_events_contact_idx ON mailing_email_events (contact_id);`).catch(() => undefined);

  // ── End Mailing Module ──────────────────────────────────────────────────────

  // ── Analytics & Insights Engine Tables ──────────────────────────────────────
  await pool.query(`
    CREATE TABLE IF NOT EXISTS social_metrics (
      id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      platform TEXT NOT NULL,
      platform_post_id TEXT NOT NULL,
      post_id TEXT,
      social_account_id TEXT,
      likes INTEGER DEFAULT 0,
      comments INTEGER DEFAULT 0,
      shares INTEGER DEFAULT 0,
      impressions INTEGER DEFAULT 0,
      reach INTEGER DEFAULT 0,
      engagement INTEGER DEFAULT 0,
      clicks INTEGER DEFAULT 0,
      saves INTEGER DEFAULT 0,
      raw_data JSONB DEFAULT '{}'::jsonb,
      posted_at TIMESTAMPTZ,
      fetched_at TIMESTAMPTZ DEFAULT NOW(),
      created_at TIMESTAMPTZ DEFAULT NOW(),
      UNIQUE(user_id, platform, platform_post_id)
    );
  `);
  await pool.query(`CREATE INDEX IF NOT EXISTS social_metrics_user_idx ON social_metrics (user_id);`).catch(() => undefined);
  await pool.query(`CREATE INDEX IF NOT EXISTS social_metrics_platform_idx ON social_metrics (user_id, platform);`).catch(() => undefined);
  await pool.query(`CREATE INDEX IF NOT EXISTS social_metrics_posted_idx ON social_metrics (posted_at);`).catch(() => undefined);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS account_metrics (
      id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      platform TEXT NOT NULL,
      social_account_id TEXT NOT NULL DEFAULT '',
      date DATE NOT NULL,
      followers INTEGER DEFAULT 0,
      impressions INTEGER DEFAULT 0,
      reach INTEGER DEFAULT 0,
      profile_views INTEGER DEFAULT 0,
      raw_data JSONB DEFAULT '{}'::jsonb,
      created_at TIMESTAMPTZ DEFAULT NOW(),
      UNIQUE(user_id, platform, social_account_id, date)
    );
  `);
  await pool.query(`CREATE INDEX IF NOT EXISTS account_metrics_user_idx ON account_metrics (user_id);`).catch(() => undefined);

  // One row per connected social account — upserted on every Sync click.
  // Stores the latest profile snapshot returned by the platform API.
  await pool.query(`
    CREATE TABLE IF NOT EXISTS social_profile_stats (
      id                TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
      user_id           TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      social_account_id TEXT NOT NULL,
      platform          TEXT NOT NULL,
      followers         BIGINT  DEFAULT 0,
      following         BIGINT  DEFAULT 0,
      posts_count       BIGINT  DEFAULT 0,
      total_likes       BIGINT  DEFAULT 0,
      bio               TEXT,
      is_verified       BOOLEAN DEFAULT FALSE,
      raw_response      JSONB   DEFAULT '{}'::jsonb,
      synced_at         TIMESTAMPTZ DEFAULT NOW(),
      UNIQUE(social_account_id)
    );
  `);
  await pool.query(`CREATE INDEX IF NOT EXISTS sps_user_idx ON social_profile_stats (user_id);`).catch(() => undefined);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS tiktok_video_insights (
      id                TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
      user_id           TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      social_account_id TEXT NOT NULL,
      video_id          TEXT NOT NULL,
      title             TEXT,
      cover_url         TEXT,
      share_url         TEXT,
      likes             BIGINT DEFAULT 0,
      comments          BIGINT DEFAULT 0,
      shares            BIGINT DEFAULT 0,
      views             BIGINT DEFAULT 0,
      engagement        BIGINT DEFAULT 0,
      duration_seconds  INTEGER DEFAULT 0,
      posted_at         TIMESTAMPTZ,
      fetched_at        TIMESTAMPTZ DEFAULT NOW(),
      raw_data          JSONB DEFAULT '{}'::jsonb,
      UNIQUE(social_account_id, video_id)
    );
  `);
  await pool.query(`CREATE INDEX IF NOT EXISTS tvi_user_idx ON tiktok_video_insights (user_id);`).catch(() => undefined);
  await pool.query(`CREATE INDEX IF NOT EXISTS tvi_account_idx ON tiktok_video_insights (social_account_id);`).catch(() => undefined);
  // Migrate: add enriched fields from video/query API
  await pool.query(`ALTER TABLE tiktok_video_insights ADD COLUMN IF NOT EXISTS video_description TEXT`).catch(() => undefined);
  await pool.query(`ALTER TABLE tiktok_video_insights ADD COLUMN IF NOT EXISTS embed_html TEXT`).catch(() => undefined);
  await pool.query(`ALTER TABLE tiktok_video_insights ADD COLUMN IF NOT EXISTS embed_link TEXT`).catch(() => undefined);
  await pool.query(`ALTER TABLE tiktok_video_insights ADD COLUMN IF NOT EXISTS height INTEGER DEFAULT 0`).catch(() => undefined);
  await pool.query(`ALTER TABLE tiktok_video_insights ADD COLUMN IF NOT EXISTS width INTEGER DEFAULT 0`).catch(() => undefined);

  // Facebook Pages Analytics Tables
  await pool.query(`
    CREATE TABLE IF NOT EXISTS facebook_page_stats (
      id                TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
      user_id           TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      social_account_id TEXT NOT NULL,
      platform          TEXT NOT NULL DEFAULT 'facebook',
      followers         BIGINT  DEFAULT 0,
      page_likes        BIGINT  DEFAULT 0,
      posts_count       BIGINT  DEFAULT 0,
      engagement_rate   FLOAT   DEFAULT 0.0,
      bio               TEXT,
      picture_url       TEXT,
      raw_response      JSONB   DEFAULT '{}'::jsonb,
      synced_at         TIMESTAMPTZ DEFAULT NOW(),
      UNIQUE(social_account_id)
    );
  `);
  await pool.query(`CREATE INDEX IF NOT EXISTS fps_user_idx ON facebook_page_stats (user_id);`).catch(() => undefined);
  await pool.query(`CREATE INDEX IF NOT EXISTS fps_account_idx ON facebook_page_stats (social_account_id);`).catch(() => undefined);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS facebook_post_insights (
      id                TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
      user_id           TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      social_account_id TEXT NOT NULL,
      post_id           TEXT NOT NULL,
      message           TEXT,
      picture           TEXT,
      story             TEXT,
      type              TEXT,
      permalink_url     TEXT,
      shares            BIGINT DEFAULT 0,
      likes_count       BIGINT DEFAULT 0,
      comments_count    BIGINT DEFAULT 0,
      engagement        BIGINT DEFAULT 0,
      created_at        TIMESTAMPTZ,
      fetched_at        TIMESTAMPTZ DEFAULT NOW(),
      raw_data          JSONB DEFAULT '{}'::jsonb,
      UNIQUE(social_account_id, post_id)
    );
  `);
  await pool.query(`CREATE INDEX IF NOT EXISTS fpi_user_idx ON facebook_post_insights (user_id);`).catch(() => undefined);
  await pool.query(`CREATE INDEX IF NOT EXISTS fpi_account_idx ON facebook_post_insights (social_account_id);`).catch(() => undefined);

  // LinkedIn Analytics Tables
  await pool.query(`
    CREATE TABLE IF NOT EXISTS linkedin_profile_stats (
      id                TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
      user_id           TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      social_account_id TEXT NOT NULL,
      platform          TEXT NOT NULL DEFAULT 'linkedin',
      first_name        TEXT,
      last_name         TEXT,
      headline          TEXT,
      connections_count BIGINT DEFAULT 0,
      profile_picture_url TEXT,
      raw_response      JSONB DEFAULT '{}'::jsonb,
      synced_at         TIMESTAMPTZ DEFAULT NOW(),
      UNIQUE(social_account_id)
    );
  `);
  await pool.query(`CREATE INDEX IF NOT EXISTS lps_user_idx ON linkedin_profile_stats (user_id);`).catch(() => undefined);
  await pool.query(`CREATE INDEX IF NOT EXISTS lps_account_idx ON linkedin_profile_stats (social_account_id);`).catch(() => undefined);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS linkedin_post_metrics (
      id                TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
      user_id           TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      social_account_id TEXT NOT NULL,
      post_id           TEXT NOT NULL,
      text              TEXT,
      post_url          TEXT,
      media_type        TEXT,
      created_at        TIMESTAMPTZ,
      fetched_at        TIMESTAMPTZ DEFAULT NOW(),
      raw_data          JSONB DEFAULT '{}'::jsonb,
      UNIQUE(social_account_id, post_id)
    );
  `);
  await pool.query(`CREATE INDEX IF NOT EXISTS lpm_user_idx ON linkedin_post_metrics (user_id);`).catch(() => undefined);
  await pool.query(`CREATE INDEX IF NOT EXISTS lpm_account_idx ON linkedin_post_metrics (social_account_id);`).catch(() => undefined);

  // LinkedIn Company Page Analytics Tables
  await pool.query(`
    CREATE TABLE IF NOT EXISTS linkedin_company_stats (
      id                TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
      user_id           TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      social_account_id TEXT NOT NULL,
      organization_id   TEXT NOT NULL,
      organization_name TEXT,
      follower_count    BIGINT DEFAULT 0,
      engagement_rate   FLOAT DEFAULT 0.0,
      posts_created     BIGINT DEFAULT 0,
      logo_url          TEXT,
      description       TEXT,
      raw_response      JSONB DEFAULT '{}'::jsonb,
      synced_at         TIMESTAMPTZ DEFAULT NOW(),
      UNIQUE(social_account_id, organization_id)
    );
  `);
  await pool.query(`CREATE INDEX IF NOT EXISTS lcs_user_idx ON linkedin_company_stats (user_id);`).catch(() => undefined);
  await pool.query(`CREATE INDEX IF NOT EXISTS lcs_org_idx ON linkedin_company_stats (organization_id);`).catch(() => undefined);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS linkedin_company_posts (
      id                 TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
      user_id            TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      social_account_id  TEXT NOT NULL,
      post_id            TEXT NOT NULL,
      organization_id    TEXT NOT NULL,
      text               TEXT,
      media_type         TEXT,
      impressions        BIGINT DEFAULT 0,
      likes              BIGINT DEFAULT 0,
      comments           BIGINT DEFAULT 0,
      reposts            BIGINT DEFAULT 0,
      clicks             BIGINT DEFAULT 0,
      engagement_rate    FLOAT DEFAULT 0.0,
      created_at         TIMESTAMPTZ,
      fetched_at         TIMESTAMPTZ DEFAULT NOW(),
      raw_data           JSONB DEFAULT '{}'::jsonb,
      UNIQUE(social_account_id, post_id)
    );
  `);
  await pool.query(`CREATE INDEX IF NOT EXISTS lcp_user_idx ON linkedin_company_posts (user_id);`).catch(() => undefined);
  await pool.query(`CREATE INDEX IF NOT EXISTS lcp_org_idx ON linkedin_company_posts (organization_id);`).catch(() => undefined);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS insights_cache (
      id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      cache_key TEXT NOT NULL,
      data JSONB NOT NULL,
      expires_at TIMESTAMPTZ NOT NULL,
      created_at TIMESTAMPTZ DEFAULT NOW(),
      UNIQUE(user_id, cache_key)
    );
  `);
  await pool.query(`CREATE INDEX IF NOT EXISTS insights_cache_user_idx ON insights_cache (user_id);`).catch(() => undefined);
  // ── End Analytics Tables ─────────────────────────────────────────────────────

  // ── Campaign & Funnel Builder Tables ─────────────────────────────────────────
  await pool.query(`
    CREATE TABLE IF NOT EXISTS campaigns (
      id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      name TEXT NOT NULL,
      description TEXT DEFAULT '',
      goal TEXT NOT NULL DEFAULT 'awareness',
      status TEXT NOT NULL DEFAULT 'draft',
      start_date DATE,
      end_date DATE,
      budget NUMERIC(12,2),
      currency TEXT DEFAULT 'USD',
      target_url TEXT DEFAULT '',
      tags TEXT[] DEFAULT '{}',
      settings JSONB DEFAULT '{}'::jsonb,
      created_at TIMESTAMPTZ DEFAULT NOW(),
      updated_at TIMESTAMPTZ DEFAULT NOW()
    );
  `);
  await pool.query(`CREATE INDEX IF NOT EXISTS campaigns_user_idx ON campaigns (user_id);`).catch(() => undefined);
  await pool.query(`CREATE INDEX IF NOT EXISTS campaigns_status_idx ON campaigns (user_id, status);`).catch(() => undefined);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS campaign_channels (
      id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
      campaign_id TEXT NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      channel_type TEXT NOT NULL,
      social_account_id TEXT REFERENCES social_accounts(id) ON DELETE SET NULL,
      config JSONB DEFAULT '{}'::jsonb,
      status TEXT NOT NULL DEFAULT 'active',
      created_at TIMESTAMPTZ DEFAULT NOW()
    );
  `);
  await pool.query(`CREATE INDEX IF NOT EXISTS campaign_channels_campaign_idx ON campaign_channels (campaign_id);`).catch(() => undefined);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS funnels (
      id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
      campaign_id TEXT NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      name TEXT NOT NULL,
      description TEXT DEFAULT '',
      created_at TIMESTAMPTZ DEFAULT NOW(),
      updated_at TIMESTAMPTZ DEFAULT NOW()
    );
  `);
  await pool.query(`CREATE INDEX IF NOT EXISTS funnels_campaign_idx ON funnels (campaign_id);`).catch(() => undefined);
  await pool.query(`CREATE INDEX IF NOT EXISTS funnels_user_idx ON funnels (user_id);`).catch(() => undefined);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS funnel_steps (
      id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
      funnel_id TEXT NOT NULL REFERENCES funnels(id) ON DELETE CASCADE,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      name TEXT NOT NULL,
      step_order INTEGER NOT NULL DEFAULT 0,
      step_type TEXT NOT NULL DEFAULT 'page_view',
      target_url TEXT DEFAULT '',
      goal_count INTEGER DEFAULT 0,
      created_at TIMESTAMPTZ DEFAULT NOW()
    );
  `);
  await pool.query(`CREATE INDEX IF NOT EXISTS funnel_steps_funnel_idx ON funnel_steps (funnel_id, step_order);`).catch(() => undefined);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS funnel_events (
      id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
      funnel_id TEXT,
      funnel_step_id TEXT,
      campaign_id TEXT,
      owner_user_id TEXT,
      session_id TEXT,
      visitor_id TEXT,
      event_type TEXT NOT NULL,
      event_name TEXT,
      url TEXT,
      referrer TEXT,
      utm_source TEXT,
      utm_medium TEXT,
      utm_campaign TEXT,
      utm_term TEXT,
      utm_content TEXT,
      properties JSONB DEFAULT '{}'::jsonb,
      ip TEXT,
      user_agent TEXT,
      created_at TIMESTAMPTZ DEFAULT NOW()
    );
  `);
  await pool.query(`CREATE INDEX IF NOT EXISTS funnel_events_funnel_idx ON funnel_events (funnel_id);`).catch(() => undefined);
  await pool.query(`CREATE INDEX IF NOT EXISTS funnel_events_campaign_idx ON funnel_events (campaign_id);`).catch(() => undefined);
  await pool.query(`CREATE INDEX IF NOT EXISTS funnel_events_created_idx ON funnel_events (created_at);`).catch(() => undefined);
  await pool.query(`CREATE INDEX IF NOT EXISTS funnel_events_utm_idx ON funnel_events (utm_campaign, utm_source);`).catch(() => undefined);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS utm_links (
      id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
      campaign_id TEXT NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      label TEXT NOT NULL,
      base_url TEXT NOT NULL,
      utm_source TEXT NOT NULL,
      utm_medium TEXT NOT NULL,
      utm_campaign TEXT NOT NULL,
      utm_term TEXT DEFAULT '',
      utm_content TEXT DEFAULT '',
      short_code TEXT,
      full_url TEXT NOT NULL,
      clicks INTEGER DEFAULT 0,
      conversions INTEGER DEFAULT 0,
      created_at TIMESTAMPTZ DEFAULT NOW(),
      UNIQUE(short_code)
    );
  `);
  await pool.query(`CREATE INDEX IF NOT EXISTS utm_links_campaign_idx ON utm_links (campaign_id);`).catch(() => undefined);
  await pool.query(`CREATE INDEX IF NOT EXISTS utm_links_user_idx ON utm_links (user_id);`).catch(() => undefined);
  // ── Campaign Execution Tables ────────────────────────────────────────────────
  await pool.query(`
    CREATE TABLE IF NOT EXISTS campaign_jobs (
      id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
      campaign_id TEXT NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      job_type TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'queued',
      job_id TEXT,
      payload JSONB DEFAULT '{}'::jsonb,
      error TEXT,
      created_at TIMESTAMPTZ DEFAULT NOW(),
      updated_at TIMESTAMPTZ DEFAULT NOW()
    );
  `);
  await pool.query(`CREATE INDEX IF NOT EXISTS campaign_jobs_campaign_idx ON campaign_jobs (campaign_id);`).catch(() => undefined);
  await pool.query(`CREATE INDEX IF NOT EXISTS campaign_jobs_status_idx ON campaign_jobs (user_id, status);`).catch(() => undefined);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS campaign_attribution (
      id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
      campaign_id TEXT NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      model TEXT NOT NULL DEFAULT 'last_touch',
      visitor_id TEXT,
      session_id TEXT,
      first_touch_source TEXT,
      first_touch_medium TEXT,
      first_touch_at TIMESTAMPTZ,
      last_touch_source TEXT,
      last_touch_medium TEXT,
      last_touch_at TIMESTAMPTZ,
      converted BOOLEAN DEFAULT FALSE,
      converted_at TIMESTAMPTZ,
      revenue NUMERIC(12,2),
      created_at TIMESTAMPTZ DEFAULT NOW()
    );
  `);
  await pool.query(`CREATE INDEX IF NOT EXISTS campaign_attribution_campaign_idx ON campaign_attribution (campaign_id);`).catch(() => undefined);
  await pool.query(`CREATE INDEX IF NOT EXISTS campaign_attribution_visitor_idx ON campaign_attribution (campaign_id, visitor_id);`).catch(() => undefined);

  await pool.query(`ALTER TABLE campaigns ADD COLUMN IF NOT EXISTS mailing_campaign_id TEXT;`).catch(() => undefined);
  await pool.query(`ALTER TABLE campaigns ADD COLUMN IF NOT EXISTS attribution_model TEXT NOT NULL DEFAULT 'last_touch';`).catch(() => undefined);
  // ── End Campaign Tables ───────────────────────────────────────────────────────

  // ─── Billing / Subscriptions ─────────────────────────────────────────────────
  // Extend pricing_plans with Stripe price IDs and feature limits
  await pool.query(`ALTER TABLE pricing_plans ADD COLUMN IF NOT EXISTS stripe_price_id TEXT;`).catch(() => undefined);
  await pool.query(`ALTER TABLE pricing_plans ADD COLUMN IF NOT EXISTS stripe_annual_price_id TEXT;`).catch(() => undefined);
  await pool.query(`ALTER TABLE pricing_plans ADD COLUMN IF NOT EXISTS post_limit INT;`).catch(() => undefined);
  await pool.query(`ALTER TABLE pricing_plans ADD COLUMN IF NOT EXISTS user_limit INT;`).catch(() => undefined);
  await pool.query(`ALTER TABLE pricing_plans ADD COLUMN IF NOT EXISTS sort_order INT NOT NULL DEFAULT 0;`).catch(() => undefined);

  // Extend users with Stripe customer ID + current plan reference
  await pool.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS stripe_customer_id TEXT;`).catch(() => undefined);
  await pool.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS plan_id TEXT REFERENCES pricing_plans(id) ON DELETE SET NULL;`).catch(() => undefined);
  await pool.query(`CREATE UNIQUE INDEX IF NOT EXISTS users_stripe_customer_id_idx ON users (stripe_customer_id) WHERE stripe_customer_id IS NOT NULL;`).catch(() => undefined);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS subscriptions (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      plan_id TEXT REFERENCES pricing_plans(id) ON DELETE SET NULL,
      stripe_customer_id TEXT,
      stripe_subscription_id TEXT,
      stripe_price_id TEXT,
      status TEXT NOT NULL DEFAULT 'free',
      current_period_start TIMESTAMPTZ,
      current_period_end TIMESTAMPTZ,
      cancel_at_period_end BOOLEAN DEFAULT FALSE,
      canceled_at TIMESTAMPTZ,
      created_at TIMESTAMPTZ DEFAULT NOW(),
      updated_at TIMESTAMPTZ DEFAULT NOW(),
      UNIQUE(user_id)
    );
  `).catch(() => undefined);
  await pool.query(`CREATE INDEX IF NOT EXISTS subscriptions_user_idx ON subscriptions (user_id);`).catch(() => undefined);
  await pool.query(`CREATE INDEX IF NOT EXISTS subscriptions_status_idx ON subscriptions (status);`).catch(() => undefined);
  await pool.query(`CREATE UNIQUE INDEX IF NOT EXISTS subscriptions_stripe_sub_idx ON subscriptions (stripe_subscription_id) WHERE stripe_subscription_id IS NOT NULL;`).catch(() => undefined);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS user_payment_methods (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      stripe_payment_method_id TEXT UNIQUE,
      card_brand TEXT,
      card_last_four TEXT,
      card_exp_month INT,
      card_exp_year INT,
      is_default BOOLEAN DEFAULT FALSE,
      created_at TIMESTAMPTZ DEFAULT NOW()
    );
  `).catch(() => undefined);
  await pool.query(`CREATE INDEX IF NOT EXISTS upm_user_idx ON user_payment_methods (user_id);`).catch(() => undefined);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS billing_invoices (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      subscription_id TEXT REFERENCES subscriptions(id) ON DELETE SET NULL,
      stripe_invoice_id TEXT UNIQUE,
      invoice_number TEXT,
      status TEXT NOT NULL DEFAULT 'draft',
      subtotal_cents INT NOT NULL DEFAULT 0,
      tax_cents INT NOT NULL DEFAULT 0,
      total_cents INT NOT NULL DEFAULT 0,
      currency TEXT NOT NULL DEFAULT 'usd',
      hosted_invoice_url TEXT,
      invoice_pdf TEXT,
      period_start TIMESTAMPTZ,
      period_end TIMESTAMPTZ,
      paid_at TIMESTAMPTZ,
      created_at TIMESTAMPTZ DEFAULT NOW()
    );
  `).catch(() => undefined);
  await pool.query(`CREATE INDEX IF NOT EXISTS billing_invoices_user_idx ON billing_invoices (user_id);`).catch(() => undefined);
  await pool.query(`CREATE INDEX IF NOT EXISTS billing_invoices_status_idx ON billing_invoices (status);`).catch(() => undefined);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS billing_events (
      id TEXT PRIMARY KEY,
      user_id TEXT,
      event_type TEXT NOT NULL,
      stripe_event_id TEXT,
      data JSONB DEFAULT '{}'::jsonb,
      created_at TIMESTAMPTZ DEFAULT NOW()
    );
  `).catch(() => undefined);
  await pool.query(`CREATE UNIQUE INDEX IF NOT EXISTS billing_events_stripe_evt_idx ON billing_events (stripe_event_id) WHERE stripe_event_id IS NOT NULL;`).catch(() => undefined);
  await pool.query(`CREATE INDEX IF NOT EXISTS billing_events_user_idx ON billing_events (user_id);`).catch(() => undefined);
  // ── End Billing Tables ────────────────────────────────────────────────────────

  // ── User Memory ───────────────────────────────────────────────────────────────
  await pool.query(`
    CREATE TABLE IF NOT EXISTS user_memories (
      id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      user_id     TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      category    TEXT NOT NULL DEFAULT 'custom',
      title       TEXT NOT NULL,
      content     TEXT NOT NULL,
      source      TEXT NOT NULL DEFAULT 'manual',
      sort_order  INT NOT NULL DEFAULT 0,
      created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `).catch(() => undefined);
  await pool.query(`CREATE INDEX IF NOT EXISTS user_memories_user_id_idx ON user_memories (user_id);`).catch(() => undefined);

  // ── Notifications ─────────────────────────────────────────────────────────────
  await pool.query(`
    CREATE TABLE IF NOT EXISTS notifications (
      id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      user_id     TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      type        TEXT NOT NULL DEFAULT 'info',
      title       TEXT NOT NULL,
      message     TEXT NOT NULL DEFAULT '',
      data        JSONB NOT NULL DEFAULT '{}',
      is_read     BOOLEAN NOT NULL DEFAULT false,
      pinned      BOOLEAN NOT NULL DEFAULT false,
      created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `).catch(() => undefined);
  await pool.query(`CREATE INDEX IF NOT EXISTS notifications_user_id_idx ON notifications (user_id, created_at DESC);`).catch(() => undefined);
  await pool.query(`ALTER TABLE notifications ADD COLUMN IF NOT EXISTS pinned BOOLEAN NOT NULL DEFAULT false;`).catch(() => undefined);
  // ── End Notifications ─────────────────────────────────────────────────────────

  // ── Apify ─────────────────────────────────────────────────────────────────────
  await pool.query(`
    CREATE TABLE IF NOT EXISTS apify_actors (
      id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      actor_id    TEXT NOT NULL UNIQUE,
      name        TEXT NOT NULL,
      description TEXT NOT NULL DEFAULT '',
      tag         TEXT NOT NULL DEFAULT 'Custom',
      created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `).catch(() => undefined);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS apify_runs (
      id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      actor_db_id   UUID REFERENCES apify_actors(id) ON DELETE SET NULL,
      actor_name    TEXT NOT NULL,
      apify_run_id  TEXT NOT NULL,
      status        TEXT NOT NULL DEFAULT 'READY',
      input         JSONB,
      dataset_id    TEXT,
      started_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      finished_at   TIMESTAMPTZ
    );
  `).catch(() => undefined);
  // ── End Apify ─────────────────────────────────────────────────────────────────

  // ── Daky Learn ────────────────────────────────────────────────────────────────
  await pool.query(`
    CREATE TABLE IF NOT EXISTS learned_items (
      id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      title       TEXT NOT NULL,
      url         TEXT NOT NULL,
      source_type TEXT NOT NULL DEFAULT 'article',
      summary     TEXT NOT NULL DEFAULT '',
      key_points  TEXT[] NOT NULL DEFAULT '{}',
      category    TEXT NOT NULL DEFAULT 'General',
      labels      TEXT[] NOT NULL DEFAULT '{}',
      raw_content TEXT NOT NULL DEFAULT '',
      created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `).catch(() => undefined);
  await pool.query(`CREATE INDEX IF NOT EXISTS learned_items_category_idx ON learned_items (category);`).catch(() => undefined);
  await pool.query(`ALTER TABLE learned_items ADD COLUMN IF NOT EXISTS saas_application TEXT NOT NULL DEFAULT ''`).catch(() => undefined);
  // ── End Daky Learn ────────────────────────────────────────────────────────────

  // ── Agent System ──────────────────────────────────────────────────────────────
  await pool.query(`
    CREATE TABLE IF NOT EXISTS agent_templates (
      id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      agent_key       TEXT NOT NULL UNIQUE,
      name            TEXT NOT NULL,
      role            TEXT NOT NULL,
      icon            TEXT NOT NULL DEFAULT '✦',
      color           TEXT NOT NULL DEFAULT '#5B6CF9',
      base_prompt     TEXT NOT NULL DEFAULT '',
      memory_keywords TEXT[] NOT NULL DEFAULT '{}',
      updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `).catch(() => undefined);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS user_agents (
      id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      user_id          UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      agent_key        TEXT NOT NULL,
      compiled_skill   TEXT NOT NULL DEFAULT '',
      last_compiled_at TIMESTAMPTZ,
      created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      UNIQUE(user_id, agent_key)
    );
  `).catch(() => undefined);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS agent_activity (
      id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      user_id       UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      agent_key     TEXT NOT NULL,
      agent_name    TEXT NOT NULL DEFAULT '',
      activity_type TEXT NOT NULL DEFAULT 'report',
      title         TEXT NOT NULL,
      content       TEXT NOT NULL,
      is_read       BOOLEAN NOT NULL DEFAULT false,
      created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `).catch(() => undefined);
  await pool.query(`CREATE INDEX IF NOT EXISTS agent_activity_user_idx ON agent_activity (user_id, created_at DESC);`).catch(() => undefined);
  // Seed default agent templates (skip if already exist)
  await pool.query(`
    INSERT INTO agent_templates (agent_key, name, role, icon, color, base_prompt, memory_keywords) VALUES
    ('daky', 'Daky', 'Orchestrator & Strategist', '✦', '#5B6CF9',
     'You are Daky, the orchestrating AI strategist of the Dakyworld Hub marketing team. You have 55 years of expertise across all marketing disciplines. You synthesize insights from your specialist team into clear, actionable guidance. When given team analyses, weave them into a unified, decisive recommendation.',
     '{}'),
    ('nova', 'Nova', 'Creative Director', '◉', '#EC4899',
     'You are Nova, the Creative Director of the Dakyworld Hub marketing team. You specialize in brand voice, visual direction, content ideation, and audience engagement. You see every piece of content as an opportunity to reinforce identity and create emotional connection.',
     '{brand,voice,visual,content,product,audience}'),
    ('sage', 'Sage', 'Strategy Analyst', '◈', '#10B981',
     'You are Sage, the Strategy Analyst of the Dakyworld Hub marketing team. You specialize in market positioning, competitive analysis, campaign strategy, and goal-setting. You translate business goals into winning marketing strategies.',
     '{goal,competit,strategy,industry,market,target,campaign}'),
    ('aria', 'Aria', 'Analytics & Performance', '⊕', '#F59E0B',
     'You are Aria, the Analytics & Performance specialist of the Dakyworld Hub marketing team. You specialize in KPI tracking, performance insights, business metrics, and ROI analysis. Every recommendation you make is grounded in data.',
     '{analytic,performance,kpi,metric,business}'),
    ('flux', 'Flux', 'Automation & Workflows', '⟳', '#8B5CF6',
     'You are Flux, the Automation & Workflow specialist of the Dakyworld Hub marketing team. You specialize in platform integrations, scheduling automation, workflow optimization, and tool orchestration across social channels.',
     '{automat,workflow,platform,social,schedule}')
    ON CONFLICT (agent_key) DO NOTHING;
  `).catch(() => undefined);
  // ── End Agent System ──────────────────────────────────────────────────────────

  // ── End User Memory ───────────────────────────────────────────────────────────

  // ─── Workspace & Organizations ────────────────────────────────────────────────
  await pool.query(`
    CREATE TABLE IF NOT EXISTS organizations (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      slug TEXT NOT NULL,
      description TEXT NOT NULL DEFAULT '',
      logo_url TEXT,
      owner_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      created_at TIMESTAMPTZ DEFAULT NOW(),
      updated_at TIMESTAMPTZ DEFAULT NOW()
    );
  `).catch(() => undefined);
  await pool.query(`CREATE UNIQUE INDEX IF NOT EXISTS organizations_slug_unique_idx ON organizations (LOWER(slug));`).catch(() => undefined);
  await pool.query(`CREATE INDEX IF NOT EXISTS organizations_owner_idx ON organizations (owner_id);`).catch(() => undefined);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS organization_memberships (
      id TEXT PRIMARY KEY,
      org_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      role TEXT NOT NULL DEFAULT 'viewer',
      created_at TIMESTAMPTZ DEFAULT NOW(),
      UNIQUE(org_id, user_id)
    );
  `).catch(() => undefined);
  await pool.query(`CREATE INDEX IF NOT EXISTS org_memberships_user_idx ON organization_memberships (user_id);`).catch(() => undefined);
  await pool.query(`CREATE INDEX IF NOT EXISTS org_memberships_org_idx ON organization_memberships (org_id);`).catch(() => undefined);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS organization_invitations (
      id TEXT PRIMARY KEY,
      org_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
      email TEXT NOT NULL,
      role TEXT NOT NULL DEFAULT 'editor',
      token TEXT NOT NULL,
      invited_by_user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      accepted_at TIMESTAMPTZ,
      expires_at TIMESTAMPTZ NOT NULL,
      created_at TIMESTAMPTZ DEFAULT NOW()
    );
  `).catch(() => undefined);
  await pool.query(`CREATE UNIQUE INDEX IF NOT EXISTS org_invitations_token_idx ON organization_invitations (token);`).catch(() => undefined);
  await pool.query(`CREATE INDEX IF NOT EXISTS org_invitations_org_idx ON organization_invitations (org_id);`).catch(() => undefined);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS projects (
      id TEXT PRIMARY KEY,
      org_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
      name TEXT NOT NULL,
      description TEXT NOT NULL DEFAULT '',
      color TEXT NOT NULL DEFAULT '#5b6cf9',
      created_by_user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
      created_at TIMESTAMPTZ DEFAULT NOW(),
      updated_at TIMESTAMPTZ DEFAULT NOW()
    );
  `).catch(() => undefined);
  await pool.query(`CREATE INDEX IF NOT EXISTS projects_org_idx ON projects (org_id);`).catch(() => undefined);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS organization_audit_logs (
      id TEXT PRIMARY KEY,
      org_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
      user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
      action TEXT NOT NULL,
      target_type TEXT,
      target_id TEXT,
      metadata JSONB DEFAULT '{}'::jsonb,
      created_at TIMESTAMPTZ DEFAULT NOW()
    );
  `).catch(() => undefined);
  await pool.query(`CREATE INDEX IF NOT EXISTS org_audit_logs_org_idx ON organization_audit_logs (org_id, created_at DESC);`).catch(() => undefined);

  // ── Task Management ───────────────────────────────────────────────────────────
  await pool.query(`
    CREATE TABLE IF NOT EXISTS tasks (
      id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      project_id    TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
      title         TEXT NOT NULL,
      description   TEXT NOT NULL DEFAULT '',
      status        TEXT NOT NULL DEFAULT 'todo',
      priority      TEXT NOT NULL DEFAULT 'medium',
      position      INT  NOT NULL DEFAULT 0,
      due_date      DATE,
      supervisor_id TEXT REFERENCES users(id) ON DELETE SET NULL,
      created_by    TEXT NOT NULL REFERENCES users(id),
      created_at    TIMESTAMPTZ DEFAULT NOW(),
      updated_at    TIMESTAMPTZ DEFAULT NOW()
    );
  `).catch(() => undefined);
  await pool.query(`CREATE INDEX IF NOT EXISTS tasks_project_status_idx ON tasks (project_id, status, position);`).catch(() => undefined);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS task_assignees (
      task_id     UUID NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
      user_id     TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      assigned_at TIMESTAMPTZ DEFAULT NOW(),
      PRIMARY KEY (task_id, user_id)
    );
  `).catch(() => undefined);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS task_labels (
      id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
      name       TEXT NOT NULL,
      color      TEXT NOT NULL DEFAULT '#6366f1',
      created_at TIMESTAMPTZ DEFAULT NOW()
    );
  `).catch(() => undefined);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS task_label_assignments (
      task_id  UUID NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
      label_id UUID NOT NULL REFERENCES task_labels(id) ON DELETE CASCADE,
      PRIMARY KEY (task_id, label_id)
    );
  `).catch(() => undefined);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS subtasks (
      id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      task_id    UUID NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
      title      TEXT NOT NULL,
      completed  BOOLEAN NOT NULL DEFAULT FALSE,
      position   INT NOT NULL DEFAULT 0,
      created_by TEXT REFERENCES users(id),
      created_at TIMESTAMPTZ DEFAULT NOW()
    );
  `).catch(() => undefined);
  await pool.query(`CREATE INDEX IF NOT EXISTS subtasks_task_idx ON subtasks (task_id, position);`).catch(() => undefined);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS task_attachments (
      id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      task_id     UUID NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
      name        TEXT NOT NULL,
      url         TEXT NOT NULL,
      size        INT,
      mime_type   TEXT,
      uploaded_by TEXT REFERENCES users(id),
      created_at  TIMESTAMPTZ DEFAULT NOW()
    );
  `).catch(() => undefined);
  await pool.query(`CREATE INDEX IF NOT EXISTS task_attachments_task_idx ON task_attachments (task_id);`).catch(() => undefined);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS task_comments (
      id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      task_id    UUID NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
      user_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      content    TEXT NOT NULL,
      parent_id  UUID REFERENCES task_comments(id) ON DELETE CASCADE,
      created_at TIMESTAMPTZ DEFAULT NOW(),
      updated_at TIMESTAMPTZ DEFAULT NOW()
    );
  `).catch(() => undefined);
  await pool.query(`CREATE INDEX IF NOT EXISTS task_comments_task_idx ON task_comments (task_id, created_at);`).catch(() => undefined);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS task_comment_reactions (
      comment_id UUID NOT NULL REFERENCES task_comments(id) ON DELETE CASCADE,
      user_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      emoji      TEXT NOT NULL,
      PRIMARY KEY (comment_id, user_id, emoji)
    );
  `).catch(() => undefined);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS task_activity (
      id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      task_id    UUID REFERENCES tasks(id) ON DELETE CASCADE,
      project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
      user_id    TEXT REFERENCES users(id),
      action     TEXT NOT NULL,
      metadata   JSONB,
      created_at TIMESTAMPTZ DEFAULT NOW()
    );
  `).catch(() => undefined);
  await pool.query(`CREATE INDEX IF NOT EXISTS task_activity_project_idx ON task_activity (project_id, created_at DESC);`).catch(() => undefined);
  await pool.query(`CREATE INDEX IF NOT EXISTS task_activity_task_idx ON task_activity (task_id, created_at DESC);`).catch(() => undefined);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS task_actions (
      id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      task_id       UUID NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
      action_type   TEXT NOT NULL,
      label         TEXT NOT NULL,
      target_count  INT NOT NULL DEFAULT 1,
      current_count INT NOT NULL DEFAULT 0,
      created_at    TIMESTAMPTZ DEFAULT NOW()
    );
  `).catch(() => undefined);
  await pool.query(`CREATE INDEX IF NOT EXISTS task_actions_task_idx ON task_actions (task_id);`).catch(() => undefined);
  // ── End Task Management ───────────────────────────────────────────────────────

  // ── End Workspace Tables ──────────────────────────────────────────────────────

  dbReady = true;
}

app.use(
  cors({
    origin: (origin, callback) => {
      if (!origin || allowedOrigins.has(origin)) {
        callback(null, true);
        return;
      }
      callback(new Error(`Origin not allowed by CORS: ${origin}`));
    },
    credentials: true,
  })
);
app.use(express.json({ limit: '20mb', verify: (req, _res, buf) => { (req as any).rawBody = buf; } }));
app.use(express.urlencoded({ extended: true, limit: '20mb' }));

// ── Stripe Webhook (must be after raw-body capture, before nothing else needs raw) ──
app.post('/webhooks/stripe', async (req: Request, res: Response) => {
  if (!stripe) return res.status(503).json({ error: 'Stripe not configured' });
  const sig = req.headers['stripe-signature'] as string;
  const rawBody = (req as any).rawBody as Buffer;
  if (!sig || !rawBody) return res.status(400).json({ error: 'Missing signature or body' });

  let event: Stripe.Event;
  try {
    event = stripe.webhooks.constructEvent(rawBody, sig, STRIPE_WEBHOOK_SECRET);
  } catch (err: any) {
    console.error('Stripe webhook signature error:', err.message);
    return res.status(400).json({ error: `Webhook Error: ${err.message}` });
  }

  // Idempotency check
  if (hasDatabase()) {
    const { rows: existing } = await dbQuery(
      `SELECT id FROM billing_events WHERE stripe_event_id = $1`,
      [event.id]
    ).catch(() => ({ rows: [] }));
    if (existing.length) { res.json({ received: true }); return; }
  }

  try {
    switch (event.type) {
      case 'checkout.session.completed': {
        const session = event.data.object as Stripe.Checkout.Session;
        if (session.mode === 'subscription' && session.subscription) {
          const sub = await stripe.subscriptions.retrieve(session.subscription as string, {
            expand: ['items.data.price.product'],
          });
          const userId = session.metadata?.user_id;
          if (userId && hasDatabase()) {
            await syncStripeSubscription(userId, sub);
          }
        }
        break;
      }
      case 'customer.subscription.updated': {
        const sub = event.data.object as Stripe.Subscription;
        const userId = sub.metadata?.user_id;
        if (userId && hasDatabase()) {
          await syncStripeSubscription(userId, sub);
        }
        break;
      }
      case 'customer.subscription.deleted': {
        const sub = event.data.object as Stripe.Subscription;
        const userId = sub.metadata?.user_id;
        if (userId && hasDatabase()) {
          await dbQuery(
            `UPDATE subscriptions SET status='canceled', canceled_at=NOW(), updated_at=NOW() WHERE stripe_subscription_id=$1`,
            [sub.id]
          );
          await dbQuery(`UPDATE users SET plan_id=NULL WHERE id=$1`, [userId]);
        }
        break;
      }
      case 'invoice.payment_succeeded': {
        const inv = event.data.object as Stripe.Invoice;
        if (hasDatabase()) await upsertBillingInvoice(inv);
        break;
      }
      case 'invoice.payment_failed': {
        const inv = event.data.object as Stripe.Invoice;
        if (hasDatabase()) {
          await upsertBillingInvoice(inv);
          const subId = typeof inv.subscription === 'string' ? inv.subscription : inv.subscription?.id;
          if (subId) {
            await dbQuery(
              `UPDATE subscriptions SET status='past_due', updated_at=NOW() WHERE stripe_subscription_id=$1`,
              [subId]
            );
          }
        }
        break;
      }
      default:
        break;
    }

    if (hasDatabase()) {
      const userId = (event.data.object as any).metadata?.user_id || null;
      await dbQuery(
        `INSERT INTO billing_events (id, user_id, event_type, stripe_event_id, data) VALUES ($1,$2,$3,$4,$5)`,
        [randomUUID(), userId, event.type, event.id, JSON.stringify(event.data.object)]
      ).catch(() => undefined);
    }
  } catch (e) {
    console.error('Stripe webhook handler error:', e);
  }

  res.json({ received: true });
});

function verifyMetaWebhookSignature(req: Request, appSecret: string) {
  if (!appSecret) return true;
  const signature = String(req.headers['x-hub-signature-256'] || req.headers['x-hub-signature'] || '').trim();
  if (!signature) return false;
  const raw = (req as any).rawBody as Buffer | undefined;
  if (!raw) return false;

  const provided = signature.includes('=') ? signature.split('=')[1] : signature;
  const expected = createHmac('sha256', appSecret).update(raw).digest('hex');
  if (provided.length !== expected.length) return false;
  return timingSafeEqual(Buffer.from(provided), Buffer.from(expected));
}

// Meta Webhooks (Facebook/Instagram) — GET verifies the endpoint with Facebook
app.get('/webhooks/meta', (req: Request, res: Response) => {
  const mode = String(req.query['hub.mode'] || '').trim();
  const token = String(req.query['hub.verify_token'] || '').trim();
  const challenge = String(req.query['hub.challenge'] || '').trim();
  const verifyToken = String(process.env.META_WEBHOOK_VERIFY_TOKEN || process.env.FACEBOOK_WEBHOOK_VERIFY_TOKEN || '').trim();

  if (mode === 'subscribe' && verifyToken && token === verifyToken) {
    return res.status(200).send(challenge);
  }
  return res.status(403).send('Forbidden');
});

// Also accept the alias used by the App Review subscription setup
app.get('/api/v1/webhooks/facebook', (req: Request, res: Response) => {
  const mode = String(req.query['hub.mode'] || '').trim();
  const token = String(req.query['hub.verify_token'] || '').trim();
  const challenge = String(req.query['hub.challenge'] || '').trim();
  const verifyToken = String(process.env.META_WEBHOOK_VERIFY_TOKEN || process.env.FACEBOOK_WEBHOOK_VERIFY_TOKEN || '').trim();

  if (mode === 'subscribe' && verifyToken && token === verifyToken) {
    return res.status(200).send(challenge);
  }
  return res.status(403).send('Forbidden');
});

app.post('/webhooks/meta', async (req: Request, res: Response) => {
  // Always respond 200 quickly so Facebook doesn't retry
  res.status(200).json({ ok: true });

  try {
    const appSecret = String(process.env.FACEBOOK_APP_SECRET || process.env.META_APP_SECRET || '').trim();
    if (appSecret && !verifyMetaWebhookSignature(req, appSecret)) {
      console.warn('Meta webhook: invalid signature — discarding');
      return;
    }

    const payload = req.body || {};
    const objectType = String(payload?.object || '').toLowerCase();
    const eventType = String(payload?.event?.type || payload?.type || '').toLowerCase();
    const eventUserId = String(payload?.event?.user_id || payload?.user_id || payload?.event?.userId || '').trim();
    const eventPlatform = objectType === 'instagram' ? 'instagram' : 'facebook';

    // Handle deauth / permission revocation at top-level
    if (eventUserId && (eventType === 'permissions_revoked' || eventType === 'deauthorized' || eventType === 'user_deauthorized')) {
      await markSocialAccountNeedsReapproval({
        platformId: eventPlatform,
        accountId: eventUserId,
        reason: eventType,
        disconnect: true,
      });
      return;
    }

    // Process entry array (standard Graph API webhook format)
    if (Array.isArray(payload?.entry)) {
      for (const entry of payload.entry) {
        const entryId = String(entry?.id || '').trim();
        const changes = Array.isArray(entry?.changes) ? entry.changes : [];
        const messaging = Array.isArray(entry?.messaging) ? entry.messaging : [];

        for (const change of changes) {
          const field = String(change?.field || '').toLowerCase();
          const value = change?.value || {};

          // Deauth / permission revocation
          const isDeauth = field === 'permissions' && (value?.verb === 'remove' || value?.verb === 'revoke' || value?.is_enabled === false);
          if (isDeauth && entryId) {
            await markSocialAccountNeedsReapproval({
              platformId: eventPlatform,
              accountId: entryId,
              reason: 'permissions_revoked',
              disconnect: true,
            });
            continue;
          }

          // Page feed events (new posts, comments, reactions on page posts)
          if (field === 'feed' && pool) {
            const verb = String(value?.verb || '').toLowerCase();
            const itemType = String(value?.item || '').toLowerCase();
            const postId = String(value?.post_id || value?.video_id || '').trim();
            const commentId = String(value?.comment_id || '').trim();

            if (postId) {
              await logIntegrationEvent({
                userId: null as any,
                integrationSlug: 'facebook',
                eventType: `page_feed_${itemType}_${verb}`,
                status: 'success',
                response: { pageId: entryId, postId, commentId: commentId || null, raw: value },
              }).catch(() => undefined);
            }
          }

          // Page mention events
          if (field === 'mention' && pool) {
            await logIntegrationEvent({
              userId: null as any,
              integrationSlug: 'facebook',
              eventType: 'page_mention',
              status: 'success',
              response: { pageId: entryId, raw: value },
            }).catch(() => undefined);
          }

          // Page rating / recommendation events
          if (field === 'ratings' && pool) {
            await logIntegrationEvent({
              userId: null as any,
              integrationSlug: 'facebook',
              eventType: 'page_rating',
              status: 'success',
              response: { pageId: entryId, raw: value },
            }).catch(() => undefined);
          }
        }

        // Messaging (page inbox — future use)
        for (const msg of messaging) {
          if (msg?.message && pool) {
            await logIntegrationEvent({
              userId: null as any,
              integrationSlug: 'facebook',
              eventType: 'page_message',
              status: 'success',
              response: { pageId: entryId, senderId: String(msg?.sender?.id || ''), raw: msg },
            }).catch(() => undefined);
          }
        }
      }
    }
  } catch (err) {
    console.error('Meta webhook processing error:', err);
  }
});

// Mirror POST webhook to the v1 alias path as well
app.post('/api/v1/webhooks/facebook', async (req: Request, res: Response) => {
  res.status(200).json({ ok: true });
  try {
    const appSecret = String(process.env.FACEBOOK_APP_SECRET || process.env.META_APP_SECRET || '').trim();
    if (appSecret && !verifyMetaWebhookSignature(req, appSecret)) {
      console.warn('Facebook v1 webhook: invalid signature — discarding');
      return;
    }
    // Delegate processing — re-emit to the shared handler by forwarding the body
    const payload = req.body || {};
    if (Array.isArray(payload?.entry)) {
      for (const entry of payload.entry) {
        const entryId = String(entry?.id || '').trim();
        const changes = Array.isArray(entry?.changes) ? entry.changes : [];
        for (const change of changes) {
          const field = String(change?.field || '').toLowerCase();
          const value = change?.value || {};
          const isDeauth = field === 'permissions' && (value?.verb === 'remove' || value?.verb === 'revoke' || value?.is_enabled === false);
          if (isDeauth && entryId) {
            await markSocialAccountNeedsReapproval({
              platformId: 'facebook',
              accountId: entryId,
              reason: 'permissions_revoked',
              disconnect: true,
            });
          }
        }
      }
    }
  } catch (err) {
    console.error('Facebook v1 webhook error:', err);
  }
});

// POST /api/v1/social/facebook/webhook-subscribe — subscribe a Facebook Page to real-time webhooks
app.post('/api/v1/social/facebook/webhook-subscribe', async (req: Request, res: Response) => {
  try {
    const auth = requireAuth(req, res);
    if (!auth) return;
    if (!pool) return res.status(503).json({ success: false, error: 'Database not configured' });

    const pageId = String(req.body?.page_id || '').trim();
    if (!pageId) return res.status(400).json({ success: false, error: 'page_id is required' });

    // Resolve page token
    const pageResult = await pool.query(
      `SELECT access_token, access_token_encrypted
       FROM social_accounts
       WHERE user_id=$1 AND platform='facebook' AND account_type='page' AND account_id=$2 AND connected=true
       LIMIT 1`,
      [auth.userId, pageId]
    );
    const row: any = pageResult.rows[0] || {};
    let pageToken = '';
    if (row.access_token_encrypted) {
      try { pageToken = decryptIntegrationSecret(String(row.access_token_encrypted)); } catch { /* ignore */ }
    }
    if (!pageToken) pageToken = String(row.access_token || '').trim();
    if (!pageToken) return res.status(400).json({ success: false, error: 'Page token not available — save the page first' });

    // Subscribe the page to webhook fields
    const subscribeResp = await axios.post(
      `https://graph.facebook.com/v19.0/${encodeURIComponent(pageId)}/subscribed_apps`,
      new URLSearchParams({
        subscribed_fields: 'feed,mention,ratings,messages',
        access_token: pageToken,
      }).toString(),
      {
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        validateStatus: () => true,
        timeout: 15000,
      }
    );
    const subData: any = subscribeResp.data || {};
    if (subscribeResp.status >= 400) {
      const msg = subData?.error?.message || `Facebook subscription failed (${subscribeResp.status})`;
      return res.status(400).json({ success: false, error: msg });
    }

    await logIntegrationEvent({
      userId: auth.userId,
      integrationSlug: 'facebook',
      eventType: 'webhook_subscribe',
      status: 'success',
      response: { pageId, fields: 'feed,mention,ratings,messages' },
    });

    return res.json({ success: true, pageId, subscribed: subData?.success ?? true });
  } catch (err) {
    console.error('v1 facebook webhook-subscribe error:', err);
    return res.status(500).json({ success: false, error: 'Failed to subscribe page to webhooks' });
  }
});

// Types
interface OAuthState {
  platform: string;
  userId: string;
  code: string;
  state: string;
}

interface StoredConnection {
  id: string;
  userId: string;
  platform: string;
  handle: string;
  followers: string;
  connected: boolean;
  connectedAt: string;
  expiresAt?: string;
}

type DbUserRow = {
  id: string;
  email: string;
  username: string | null;
  full_name: string | null;
  website: string | null;
  phone: string | null;
  country: string | null;
  role: string;
  status: string;
  avatar_url: string | null;
  cover_url: string | null;
  last_login_at: string | null;
  password_hash: string;
  created_at: string;
};

type AdminDbRole = 'admin' | 'user';
type AdminDbStatus = 'active' | 'suspended' | 'pending' | 'banned';

type DbPricingPlan = {
  id: string;
  name: string;
  description: string;
  price: number;
  billing_period: 'monthly' | 'yearly';
  features: string[];
  is_active: boolean;
  discount_percentage: number;
  is_on_sale: boolean;
  created_at: string;
  updated_at: string;
};

type DbCardTemplate = {
  id: string;
  name: string;
  description?: string;
  design_data: any;
  cover_image_url?: string;
  is_published: boolean;
  created_at: string;
  updated_at: string;
};

const inMemoryUsersById = new Map<string, DbUserRow>();
const inMemoryUserIdByEmail = new Map<string, string>();
const inMemoryUserIdByUsername = new Map<string, string>();
const inMemoryPricingPlansById = new Map<string, DbPricingPlan>();
const inMemoryCardTemplatesById = new Map<string, DbCardTemplate>();

type PlatformConfigRow = { platform: string; config: Record<string, string>; enabled: boolean; updated_at: string };
type PaymentTransactionRow = {
  id: string; amount: number; currency: string; description: string | null;
  status: string; provider: string; client_reference: string | null;
  provider_reference: string | null; customer_name: string | null;
  customer_email: string | null; customer_phone: string | null;
  checkout_url: string | null; metadata: Record<string, unknown> | null;
  created_at: string; updated_at: string;
};
const inMemoryPlatformConfigs = new Map<string, PlatformConfigRow>();
const inMemoryPaymentTransactions: PaymentTransactionRow[] = [];

async function getPlatformConfig(platform: string): Promise<Record<string, string>> {
  if (hasDatabase()) {
    const result = await dbQuery('SELECT config FROM platform_configs WHERE platform = $1', [platform]);
    if (result.rows.length > 0) return result.rows[0].config as Record<string, string>;
    return {};
  }
  return inMemoryPlatformConfigs.get(platform)?.config ?? {};
}

async function isPlatformEnabled(platform: string): Promise<boolean> {
  if (hasDatabase()) {
    const result = await dbQuery('SELECT enabled FROM platform_configs WHERE platform = $1', [platform]);
    return result.rows.length > 0 ? Boolean(result.rows[0].enabled) : false;
  }
  return inMemoryPlatformConfigs.get(platform)?.enabled ?? false;
}

function upsertInMemoryUser(input: {
  id: string;
  name: string;
  username: string;
  email: string;
  password: string;
  role: AdminDbRole;
  status?: AdminDbStatus;
}) {
  const normalizedEmail = normalizeEmail(input.email);
  const normalizedUsername = normalizeUsername(input.username);
  const existingId = inMemoryUserIdByUsername.get(normalizedUsername) || inMemoryUserIdByEmail.get(normalizedEmail);
  const id = existingId || input.id;
  const existing = inMemoryUsersById.get(id);
  const passwordHash =
    existing && bcrypt.compareSync(input.password, existing.password_hash)
      ? existing.password_hash
      : bcrypt.hashSync(input.password, 10);

  const nextUser: DbUserRow = {
    id,
    email: normalizedEmail,
    username: normalizedUsername,
    full_name: input.name,
    website: existing?.website || null,
    phone: existing?.phone || null,
    country: existing?.country || null,
    role: input.role,
    status: input.status || 'active',
    avatar_url: existing?.avatar_url || null,
    cover_url: existing?.cover_url || null,
    last_login_at: existing?.last_login_at || null,
    password_hash: passwordHash,
    created_at: existing?.created_at || new Date().toISOString(),
  };

  inMemoryUsersById.set(id, nextUser);
  inMemoryUserIdByEmail.set(normalizedEmail, id);
  inMemoryUserIdByUsername.set(normalizedUsername, id);
}

function seedInMemoryUsers() {
  upsertInMemoryUser({
    id: 'admin-1',
    name: 'Dan Ayipah',
    username: 'daky',
    email: 'danayipah@gmail.com',
    password: 'DanAyipah#1',
    role: 'admin',
  });
  upsertInMemoryUser({
    id: 'platform-user-1',
    name: 'User One',
    username: 'user',
    email: 'dakyayipah@gmail.com',
    password: 'User',
    role: 'user',
  });
}

// Helpers
async function dbQuery<T = any>(sql: string, params: any[] = []) {
  if (!pool) {
    throw new Error('DATABASE_URL is not configured. Please set it to enable persistence.');
  }
  return pool!.query<T>(sql, params);
}

function normalizeEmail(value: string) {
  return value.trim().toLowerCase();
}

function normalizeUsername(value: string) {
  return value.trim().toLowerCase();
}

ensureDatabase()
  .then(() => ensureSeedUsers())
  .then(() => ensureSeedPricingPlans())
  .then(() => refreshStripe())
  .then(() => startSocialAutomationProcessor())
  .then(() => startTokenHealthMonitor())
  .catch((err) => {
    dbReady = false;
    // Even when a Pool exists, schema init can fail (permissions, missing extensions, etc).
    // Fall back to in-memory users so auth endpoints still work.
    seedInMemoryUsers();
    console.error('Database initialization failed:', err);
  });

function titleRole(role: string) {
  switch (role) {
    case 'admin':
      return 'Admin';
    default:
      return 'User';
  }
}

function titleStatus(status: string) {
  switch (status) {
    case 'active':
      return 'Active';
    case 'suspended':
      return 'Suspended';
    case 'pending':
      return 'Pending';
    case 'banned':
      return 'Banned';
    default:
      return 'Active';
  }
}

function parseAdminRole(role: string | undefined): AdminDbRole {
  switch ((role || '').trim().toLowerCase()) {
    case 'admin':
      return 'admin';
    default:
      return 'user';
  }
}

function parseAdminStatus(status: string | undefined): AdminDbStatus {
  switch ((status || '').trim().toLowerCase()) {
    case 'suspended':
      return 'suspended';
    case 'pending':
      return 'pending';
    case 'banned':
      return 'banned';
    default:
      return 'active';
  }
}

function userToAuthPayload(user: DbUserRow) {
  return {
    id: user.id,
    email: user.email,
    username: user.username,
    name: user.full_name,
    website: user.website,
    phone: user.phone,
    country: user.country,
    role: user.role === 'admin' ? 'admin' : 'user',
    avatar: user.avatar_url,
    cover: user.cover_url,
  };
}

function userToManagedUser(user: DbUserRow) {
  return {
    id: user.id,
    name: user.full_name || user.username || user.email.split('@')[0],
    email: user.email,
    username: user.username || '',
    role: titleRole(user.role),
    status: titleStatus(user.status),
    avatar: user.avatar_url || `https://ui-avatars.com/api/?background=eff6ff&color=1d4ed8&name=${encodeURIComponent(user.full_name || user.username || user.email)}`,
    dateJoined: user.created_at ? new Date(user.created_at).toISOString().slice(0, 10) : new Date().toISOString().slice(0, 10),
    lastLogin: user.last_login_at ? new Date(user.last_login_at).toISOString().slice(0, 16).replace('T', ' ') : 'Never',
    recentActions: ['User record synced from database'],
  };
}

function signToken(userId: string, email: string) {
  return jwt.sign({ userId, email }, JWT_SECRET, { expiresIn: '7d' });
}

function getAuthUser(req: Request) {
  const token = req.headers.authorization?.split(' ')[1];
  if (!token) return null;
  try {
    const decoded = jwt.verify(token, JWT_SECRET) as any;
    return { userId: decoded.userId as string, email: decoded.email as string };
  } catch {
    return null;
  }
}

async function findUserByEmail(email: string): Promise<DbUserRow | undefined> {
  const normalizedEmail = normalizeEmail(email);
  if (!hasDatabase()) {
    const userId = inMemoryUserIdByEmail.get(normalizedEmail);
    return userId ? inMemoryUsersById.get(userId) : undefined;
  }
  const result = await dbQuery<DbUserRow>('SELECT * FROM users WHERE email = $1', [normalizedEmail]);
  return result.rows[0];
}

async function findUserByUsername(username: string): Promise<DbUserRow | undefined> {
  const normalizedUsername = normalizeUsername(username);
  if (!hasDatabase()) {
    const userId = inMemoryUserIdByUsername.get(normalizedUsername);
    return userId ? inMemoryUsersById.get(userId) : undefined;
  }
  const result = await dbQuery<DbUserRow>('SELECT * FROM users WHERE LOWER(username) = $1', [normalizedUsername]);
  return result.rows[0];
}

async function findUserByIdentifier(identifier: string): Promise<DbUserRow | undefined> {
  const normalized = identifier.trim();
  if (!normalized) return undefined;
  if (normalized.includes('@')) {
    return findUserByEmail(normalized);
  }
  return findUserByUsername(normalized);
}

async function getUserById(id: string): Promise<DbUserRow | undefined> {
  if (!hasDatabase()) {
    return inMemoryUsersById.get(id);
  }
  const result = await dbQuery<DbUserRow>('SELECT * FROM users WHERE id = $1', [id]);
  return result.rows[0];
}

async function createUser(
  name: string,
  username: string,
  email: string,
  password: string,
  options?: { role?: AdminDbRole; status?: AdminDbStatus; avatarUrl?: string | null; coverUrl?: string | null }
): Promise<DbUserRow> {
  const hash = await bcrypt.hash(password, 10);
  const id = randomUUID();
  const normalizedEmail = normalizeEmail(email);
  const normalizedUsername = normalizeUsername(username);

  if (!hasDatabase()) {
    const user: DbUserRow = {
      id,
      email: normalizedEmail,
      username: normalizedUsername,
      full_name: name || null,
      website: null,
      phone: null,
      country: null,
      role: options?.role || 'user',
      status: options?.status || 'active',
      avatar_url: options?.avatarUrl || null,
      cover_url: options?.coverUrl || null,
      last_login_at: null,
      password_hash: hash,
      created_at: new Date().toISOString(),
    };
    inMemoryUsersById.set(id, user);
    inMemoryUserIdByEmail.set(normalizedEmail, id);
    inMemoryUserIdByUsername.set(normalizedUsername, id);
    return user;
  }

  const result = await dbQuery<DbUserRow>(
    'INSERT INTO users (id, email, username, password_hash, full_name, phone, country, role, status, avatar_url, cover_url, last_login_at) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12) RETURNING *',
    [id, normalizedEmail, normalizedUsername, hash, name || null, null, null, options?.role || 'user', options?.status || 'active', options?.avatarUrl || null, options?.coverUrl || null, null]
  );
  return result.rows[0];
}

async function updateLastLogin(userId: string) {
  if (!hasDatabase()) {
    const user = inMemoryUsersById.get(userId);
    if (!user) return;
    inMemoryUsersById.set(userId, { ...user, last_login_at: new Date().toISOString() });
    return;
  }
  await dbQuery('UPDATE users SET last_login_at = NOW() WHERE id = $1', [userId]);
}

async function ensureSeedUser(input: {
  name: string;
  username: string;
  email: string;
  password: string;
  role: AdminDbRole;
  status?: AdminDbStatus;
}) {
  const existing = await findUserByUsername(input.username);
  if (existing) {
    return existing;
  }
  return createUser(input.name, input.username, input.email, input.password, {
    role: input.role,
    status: input.status || 'active',
  });
}

async function ensureSeedUsers() {
  if (!hasDatabase()) {
    seedInMemoryUsers();
    return;
  }

  await ensureSeedUser({
    name: 'Dan Ayipah',
    username: 'daky',
    email: 'danayipah@gmail.com',
    password: 'DanAyipah#1',
    role: 'admin',
  });
  await ensureSeedUser({
    name: 'User One',
    username: 'user',
    email: 'dakyayipah@gmail.com',
    password: 'User',
    role: 'user',
  });
}

async function ensureSeedPricingPlans() {
  const plans = [
    {
      name: 'Starter',
      description: 'For solo creators building posts, cards, and a lean publishing workflow.',
      monthlyPrice: 19,
      yearlyPrice: 190,
      monthlyFeatures: [
        'Up to 60 social posts per month',
        'Access to the social card template editor',
        'JPG export for final cards',
        'Up to 3 connected integrations',
        'Basic analytics overview',
        '1 team member',
      ],
      yearlyFeatures: [
        'Everything in Starter monthly',
        'Save about 2 months each year',
        '60 social posts per month',
        '3 connected integrations',
        'Basic analytics overview',
        '1 team member',
      ],
    },
    {
      name: 'Growth',
      description: 'For active brands that need more output, more templates, and more connected tools.',
      monthlyPrice: 49,
      yearlyPrice: 490,
      featured: true,
      monthlyFeatures: [
        'Up to 250 social posts per month',
        'Unlimited card edits and exports',
        'Advanced template customization',
        'Up to 10 connected integrations',
        'Full analytics dashboard and insights',
        'Up to 5 team members',
      ],
      yearlyFeatures: [
        'Everything in Growth monthly',
        'Save about 2 months each year',
        '250 social posts per month',
        '10 connected integrations',
        'Advanced editor and analytics access',
        'Up to 5 team members',
      ],
    },
    {
      name: 'Scale',
      description: 'For teams running multi-channel content operations with heavier collaboration needs.',
      monthlyPrice: 99,
      yearlyPrice: 990,
      monthlyFeatures: [
        'Unlimited social posts',
        'Unlimited card templates and exports',
        'Priority access to new editor features',
        'Unlimited integrations',
        'Advanced analytics and export workflows',
        'Up to 15 team members',
      ],
      yearlyFeatures: [
        'Everything in Scale monthly',
        'Save about 2 months each year',
        'Unlimited posts and exports',
        'Unlimited integrations',
        'Advanced analytics and exports',
        'Up to 15 team members',
      ],
    },
  ];

  if (!hasDatabase()) {
    // Seed in-memory pricing plans
    const now = new Date().toISOString();
    plans.forEach((plan) => {
      const monthlyId = randomUUID();
      const yearlyId = randomUUID();

      inMemoryPricingPlansById.set(monthlyId, {
        id: monthlyId,
        name: `${plan.name} (Monthly)`,
        description: plan.description,
        price: plan.monthlyPrice,
        billing_period: 'monthly',
        features: plan.monthlyFeatures,
        is_active: true,
        created_at: now,
        updated_at: now,
      });

      inMemoryPricingPlansById.set(yearlyId, {
        id: yearlyId,
        name: `${plan.name} (Yearly)`,
        description: plan.description,
        price: plan.yearlyPrice,
        billing_period: 'yearly',
        features: plan.yearlyFeatures,
        is_active: true,
        created_at: now,
        updated_at: now,
      });
    });
    console.log(`Seeded ${inMemoryPricingPlansById.size} pricing plans in-memory`);
    return;
  }

  // Check if plans already exist
  const existing = await dbQuery<{ count: number }>(
    'SELECT COUNT(*) as count FROM pricing_plans'
  );

  if (existing.rows[0]?.count > 0) {
    console.log('Pricing plans already seeded in database');
    return; // Plans already seeded
  }

  const now = new Date().toISOString();

  for (const plan of plans) {
    const monthlyId = randomUUID();
    const yearlyId = randomUUID();

    await dbQuery(
      'INSERT INTO pricing_plans (id, name, description, price, billing_period, features, is_active, created_at, updated_at) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)',
      [
        monthlyId,
        `${plan.name} (Monthly)`,
        plan.description,
        plan.monthlyPrice,
        'monthly',
        plan.monthlyFeatures,
        true,
        now,
        now,
      ]
    );

    await dbQuery(
      'INSERT INTO pricing_plans (id, name, description, price, billing_period, features, is_active, created_at, updated_at) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)',
      [
        yearlyId,
        `${plan.name} (Yearly)`,
        plan.description,
        plan.yearlyPrice,
        'yearly',
        plan.yearlyFeatures,
        true,
        now,
        now,
      ]
    );
  }
  console.log(`Seeded 6 pricing plans in database (${plans.length} plan types)`);
}

async function updateUserProfile(
  userId: string,
  updates: {
    name: string;
    username: string;
    email: string;
    phone: string;
    country: string;
    website: string;
    avatar?: string;
    cover?: string;
  }
): Promise<DbUserRow | undefined> {
  const normalizedEmail = normalizeEmail(updates.email);
  const normalizedUsername = normalizeUsername(updates.username);
  const normalizedPhone = updates.phone.trim();
  const normalizedCountry = updates.country.trim();
  const normalizedName = updates.name.trim();
  const normalizedWebsite = updates.website.trim();

  if (!hasDatabase()) {
    const existing = inMemoryUsersById.get(userId);
    if (!existing) return undefined;

    const byEmail = inMemoryUserIdByEmail.get(normalizedEmail);
    if (byEmail && byEmail !== userId) {
      throw new Error('Email is already in use');
    }
    const byUsername = inMemoryUserIdByUsername.get(normalizedUsername);
    if (byUsername && byUsername !== userId) {
      throw new Error('Username is already in use');
    }

    inMemoryUserIdByEmail.delete(normalizeEmail(existing.email));
    if (existing.username) {
      inMemoryUserIdByUsername.delete(normalizeUsername(existing.username));
    }

    const nextUser: DbUserRow = {
      ...existing,
      email: normalizedEmail,
      username: normalizedUsername,
      full_name: normalizedName || null,
      website: normalizedWebsite || null,
      phone: normalizedPhone || null,
      country: normalizedCountry || null,
      avatar_url: typeof updates.avatar === 'string' ? updates.avatar || null : existing.avatar_url,
      cover_url: typeof updates.cover === 'string' ? updates.cover || null : existing.cover_url,
    };

    inMemoryUsersById.set(userId, nextUser);
    inMemoryUserIdByEmail.set(normalizedEmail, userId);
    inMemoryUserIdByUsername.set(normalizedUsername, userId);
    return nextUser;
  }

  const duplicateEmail = await dbQuery<{ id: string }>('SELECT id FROM users WHERE email = $1 AND id <> $2', [
    normalizedEmail,
    userId,
  ]);
  if (duplicateEmail.rowCount) {
    throw new Error('Email is already in use');
  }

  const duplicateUsername = await dbQuery<{ id: string }>(
    'SELECT id FROM users WHERE LOWER(username) = $1 AND id <> $2',
    [normalizedUsername, userId]
  );
  if (duplicateUsername.rowCount) {
    throw new Error('Username is already in use');
  }

  const result = await dbQuery<DbUserRow>(
    `
    UPDATE users
    SET email = $1,
        username = $2,
        full_name = $3,
        website = $4,
        phone = $5,
        country = $6,
        avatar_url = COALESCE($7, avatar_url),
        cover_url = COALESCE($8, cover_url)
    WHERE id = $9
    RETURNING *;
  `,
    [
      normalizedEmail,
      normalizedUsername,
      normalizedName || null,
      normalizedWebsite || null,
      normalizedPhone || null,
      normalizedCountry || null,
      typeof updates.avatar === 'string' ? updates.avatar || null : null,
      typeof updates.cover === 'string' ? updates.cover || null : null,
      userId,
    ]
  );

  return result.rows[0];
}

// ── Stripe helpers ────────────────────────────────────────────────────────────

async function getOrCreateStripeCustomer(userId: string, email: string, name: string | null): Promise<string> {
  if (!stripe) throw new Error('Stripe not configured');
  // Check DB first
  const { rows } = await dbQuery(`SELECT stripe_customer_id FROM users WHERE id=$1`, [userId]);
  if (rows[0]?.stripe_customer_id) return rows[0].stripe_customer_id as string;
  // Create new customer
  const customer = await stripe.customers.create({
    email,
    name: name || undefined,
    metadata: { user_id: userId },
  });
  await dbQuery(`UPDATE users SET stripe_customer_id=$1 WHERE id=$2`, [customer.id, userId]);
  return customer.id;
}

async function syncStripeSubscription(userId: string, sub: Stripe.Subscription): Promise<void> {
  const priceId = sub.items.data[0]?.price?.id;
  const periodStart = new Date((sub.current_period_start) * 1000).toISOString();
  const periodEnd = new Date((sub.current_period_end) * 1000).toISOString();
  // Find matching plan by stripe_price_id
  const { rows: plans } = await dbQuery(
    `SELECT id FROM pricing_plans WHERE stripe_price_id=$1 OR stripe_annual_price_id=$1 LIMIT 1`,
    [priceId]
  );
  const planId = plans[0]?.id || null;
  await dbQuery(
    `INSERT INTO subscriptions (id, user_id, plan_id, stripe_customer_id, stripe_subscription_id, stripe_price_id, status, current_period_start, current_period_end, cancel_at_period_end, updated_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,NOW())
     ON CONFLICT (user_id) DO UPDATE SET
       plan_id=EXCLUDED.plan_id, stripe_subscription_id=EXCLUDED.stripe_subscription_id,
       stripe_price_id=EXCLUDED.stripe_price_id, status=EXCLUDED.status,
       current_period_start=EXCLUDED.current_period_start, current_period_end=EXCLUDED.current_period_end,
       cancel_at_period_end=EXCLUDED.cancel_at_period_end, updated_at=NOW()`,
    [randomUUID(), userId, planId, sub.customer, sub.id, priceId, sub.status, periodStart, periodEnd, sub.cancel_at_period_end]
  );
  if (planId) await dbQuery(`UPDATE users SET plan_id=$1, stripe_customer_id=$2 WHERE id=$3`, [planId, sub.customer, userId]);
}

async function upsertBillingInvoice(inv: Stripe.Invoice): Promise<void> {
  const userId: string | null = (inv.metadata as any)?.user_id || null;
  if (!userId) return;
  const { rows: subRows } = await dbQuery(
    `SELECT id FROM subscriptions WHERE stripe_subscription_id=$1 LIMIT 1`,
    [typeof inv.subscription === 'string' ? inv.subscription : inv.subscription?.id]
  );
  const subId = subRows[0]?.id || null;
  await dbQuery(
    `INSERT INTO billing_invoices (id, user_id, subscription_id, stripe_invoice_id, invoice_number, status, subtotal_cents, tax_cents, total_cents, currency, hosted_invoice_url, invoice_pdf, period_start, period_end, paid_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)
     ON CONFLICT (stripe_invoice_id) DO UPDATE SET
       status=EXCLUDED.status, paid_at=EXCLUDED.paid_at, hosted_invoice_url=EXCLUDED.hosted_invoice_url, invoice_pdf=EXCLUDED.invoice_pdf`,
    [
      randomUUID(), userId, subId, inv.id, inv.number, inv.status,
      inv.subtotal || 0, inv.tax || 0, inv.total || 0, inv.currency || 'usd',
      inv.hosted_invoice_url || null, inv.invoice_pdf || null,
      inv.period_start ? new Date(inv.period_start * 1000).toISOString() : null,
      inv.period_end ? new Date(inv.period_end * 1000).toISOString() : null,
      inv.status_transitions?.paid_at ? new Date(inv.status_transitions.paid_at * 1000).toISOString() : null,
    ]
  ).catch(() => undefined);
}

// ── End Stripe helpers ─────────────────────────────────────────────────────────

function requireAuth(req: Request, res: Response): { userId: string; email?: string } | null {
  const auth = getAuthUser(req);
  if (!auth) {
    res.status(401).json({ success: false, error: 'Unauthorized' });
    return null;
  }
  return auth;
}

async function requireAdmin(req: Request, res: Response): Promise<DbUserRow | null> {
  const auth = requireAuth(req, res);
  if (!auth) return null;
  const user = await getUserById(auth.userId);
  if (!user || user.role !== 'admin') {
    res.status(403).json({ success: false, error: 'Admin access required' });
    return null;
  }
  return user;
}

const ORG_ROLE_RANK: Record<string, number> = { owner: 4, admin: 3, editor: 2, viewer: 1 };

async function requireOrgMembership(
  req: Request,
  res: Response,
  orgId: string,
  minRole: 'viewer' | 'editor' | 'admin' | 'owner' = 'viewer'
): Promise<{ userId: string; role: string } | null> {
  const auth = requireAuth(req, res);
  if (!auth) return null;
  if (!hasDatabase()) { res.status(503).json({ success: false, error: 'Database unavailable' }); return null; }
  const { rows } = await dbQuery(
    `SELECT role FROM organization_memberships WHERE org_id = $1 AND user_id = $2`,
    [orgId, auth.userId]
  );
  if (!rows.length || (ORG_ROLE_RANK[rows[0].role] ?? 0) < (ORG_ROLE_RANK[minRole] ?? 0)) {
    res.status(403).json({ success: false, error: 'Not authorized for this organization' });
    return null;
  }
  return { userId: auth.userId, role: rows[0].role as string };
}

// ── Agent System Definitions & Helpers ───────────────────────────────────────

const AGENT_DEFS: Record<string, { name: string; role: string; icon: string; color: string; memoryKeywords: string[] }> = {
  daky: { name: 'Daky', role: 'Orchestrator & Strategist',  icon: '✦', color: '#5B6CF9', memoryKeywords: [] },
  nova: { name: 'Nova', role: 'Creative Director',          icon: '◉', color: '#EC4899', memoryKeywords: ['brand','voice','visual','content','product','audience'] },
  sage: { name: 'Sage', role: 'Strategy Analyst',           icon: '◈', color: '#10B981', memoryKeywords: ['goal','competit','strategy','industry','market','target','campaign'] },
  aria: { name: 'Aria', role: 'Analytics & Performance',    icon: '⊕', color: '#F59E0B', memoryKeywords: ['analytic','performance','kpi','metric','business'] },
  flux: { name: 'Flux', role: 'Automation & Workflows',     icon: '⟳', color: '#8B5CF6', memoryKeywords: ['automat','workflow','platform','social','schedule'] },
};

async function provisionUserAgents(userId: string): Promise<void> {
  if (!pool) return;
  for (const key of Object.keys(AGENT_DEFS)) {
    await dbQuery(
      `INSERT INTO user_agents (user_id, agent_key, compiled_skill) VALUES ($1, $2, '') ON CONFLICT (user_id, agent_key) DO NOTHING`,
      [userId, key]
    ).catch(() => undefined);
  }
}

async function compileAgentSkill(userId: string, agentKey: string): Promise<void> {
  if (!pool) return;
  const def = AGENT_DEFS[agentKey];
  if (!def) return;
  try {
    const { encryptedKey } = await getAIConfig();
    const apiKey = (encryptedKey ? decryptAIKey(encryptedKey) : null) || process.env.ANTHROPIC_API_KEY || '';
    if (!apiKey) return;

    let memoryRows: any[] = [];
    if (def.memoryKeywords.length > 0) {
      const conditions = def.memoryKeywords.map((_, i) => `(category ILIKE $${i + 2} OR title ILIKE $${i + 2} OR content ILIKE $${i + 2})`).join(' OR ');
      const { rows } = await dbQuery(
        `SELECT category, title, content FROM user_memories WHERE user_id=$1 AND (${conditions}) ORDER BY category, sort_order, created_at LIMIT 30`,
        [userId, ...def.memoryKeywords.map((k) => `%${k}%`)]
      );
      memoryRows = rows;
    } else {
      const { rows } = await dbQuery(
        `SELECT category, title, content FROM user_memories WHERE user_id=$1 ORDER BY category, sort_order, created_at LIMIT 60`,
        [userId]
      );
      memoryRows = rows;
    }

    if (memoryRows.length === 0) {
      await dbQuery(`UPDATE user_agents SET compiled_skill='', last_compiled_at=NOW() WHERE user_id=$1 AND agent_key=$2`, [userId, agentKey]);
      return;
    }

    const memText = memoryRows.map((r: any) => `[${r.category}] ${r.title}: ${r.content}`).join('\n');
    const aiCfgCompile = await getAIConfig();
    const compileKey = resolveActiveKey(aiCfgCompile);
    const compileFastModel = aiCfgCompile.provider === 'google'
      ? (GEMINI_MODELS.includes(aiCfgCompile.model) ? aiCfgCompile.model : 'gemini-2.0-flash')
      : 'claude-haiku-4-5-20251001';
    const skill = await callAINonStreaming(
      aiCfgCompile.provider, compileKey, compileFastModel,
      `You are ${def.name} (${def.role}) on a marketing team.`,
      `Below is the user's brand/business memory. Write a concise 3-5 sentence "agent skill brief" summarizing what you know about this user that is most relevant to your specialty. Be specific and useful — this will be injected into your system prompt.\n\nUser memory:\n${memText}\n\nSkill brief:`,
      512
    );
    await dbQuery(`UPDATE user_agents SET compiled_skill=$1, last_compiled_at=NOW() WHERE user_id=$2 AND agent_key=$3`, [skill, userId, agentKey]);
  } catch { /* non-fatal */ }
}

async function triggerAgentCompilation(userId: string): Promise<void> {
  for (const key of Object.keys(AGENT_DEFS)) {
    compileAgentSkill(userId, key).catch(() => undefined);
  }
}

// ── End Agent Helpers ─────────────────────────────────────────────────────────

const authRegisterSchema = z.object({
  email: z.string().email(),
  password: z.string().min(8),
  name: z.string().min(1).max(100),
  username: z.string().min(3).max(32).regex(/^[a-zA-Z0-9_-]+$/),
});

const authLoginSchema = z
  .object({
    identifier: z.string().optional(),
    email: z.string().email().optional(),
    password: z.string().min(1),
  })
  .refine((v) => Boolean((v.identifier || '').trim() || (v.email || '').trim()), {
    message: 'Username or email is required',
    path: ['identifier'],
  });

const authProfileSchema = z.object({
  name: z.string().min(1).max(100),
  username: z.string().min(3).max(32).regex(/^[a-zA-Z0-9_-]+$/),
  email: z.string().email(),
  phone: z.string().optional(),
  country: z.string().optional(),
  website: z.string().optional(),
  avatar: z.string().url().optional(),
  cover: z.string().url().optional(),
});

// Auth routes
app.post('/api/auth/register', validateBody(authRegisterSchema), async (req: Request, res: Response) => {
  try {
    const { email, password, name, username } = req.body;
    if (!email || !password || !name || !username) {
      return res
        .status(400)
        .json({ success: false, error: 'Name, username, email, and password are required' });
    }

    const existing = await findUserByEmail(email);
    if (existing) {
      return res.status(400).json({ success: false, error: 'Account already exists' });
    }

    const existingUsername = await findUserByUsername(username);
    if (existingUsername) {
      return res.status(400).json({ success: false, error: 'Username is already in use' });
    }

    const user = await createUser(name, username, email, password);
    provisionUserAgents(user.id).catch(() => undefined);
    createNotification(user.id, 'welcome',
      'Welcome to Dakyworld Hub!',
      'Your account is ready. Connect a social account and start chatting with Daky.',
      {},
    ).catch(() => undefined);
    const token = signToken(user.id, user.email);

    return res.json({
      success: true,
      token,
      user: userToAuthPayload(user),
    });
  } catch (error) {
    logger.error({ error, errorId: req.id }, 'auth_register_failed');
    return res.status(500).json({ success: false, error: 'Registration failed' });
  }
});

app.post('/api/auth/login', validateBody(authLoginSchema), async (req: Request, res: Response) => {
  try {
    const { identifier, email, password } = req.body;
    const loginIdentifier = (identifier || email || '').trim();
    if (!loginIdentifier || !password) {
      return res
        .status(400)
        .json({ success: false, error: 'Username or email and password are required' });
    }

    const user = await findUserByIdentifier(loginIdentifier);
    if (!user) {
      return res.status(400).json({ success: false, error: 'Invalid credentials' });
    }

    const valid = await bcrypt.compare(password, user.password_hash);
    if (!valid) {
      return res.status(400).json({ success: false, error: 'Invalid credentials' });
    }

    await updateLastLogin(user.id);
    const refreshedUser = (await getUserById(user.id)) || user;
    const token = signToken(user.id, user.email);
    return res.json({
      success: true,
      token,
      user: userToAuthPayload(refreshedUser),
    });
  } catch (error) {
    logger.error({ error, errorId: req.id }, 'auth_login_failed');
    return res.status(500).json({ success: false, error: 'Login failed' });
  }
});

app.get('/api/auth/me', async (req: Request, res: Response) => {
  try {
    const auth = requireAuth(req, res);
    if (!auth) return;

    const user = await getUserById(auth.userId);
    if (!user) {
      return res.status(404).json({ success: false, error: 'User not found' });
    }

    return res.json({
      success: true,
      user: userToAuthPayload(user),
    });
  } catch (error) {
    console.error('Me error:', error);
    return res.status(500).json({ success: false, error: 'Failed to fetch user' });
  }
});

app.put('/api/auth/profile', validateBody(authProfileSchema), async (req: Request, res: Response) => {
  try {
    const auth = requireAuth(req, res);
    if (!auth) return;

    const { name, username, email, phone, country, website, avatar, cover } = req.body;
    if (!name || !username || !email) {
      return res.status(400).json({ success: false, error: 'Name, username, and email are required' });
    }

    const updated = await updateUserProfile(auth.userId, {
      name: String(name),
      username: String(username),
      email: String(email),
      phone: String(phone || ''),
      country: String(country || ''),
      website: String(website || ''),
      avatar: typeof avatar === 'string' ? avatar : undefined,
      cover: typeof cover === 'string' ? cover : undefined,
    });

    if (!updated) {
      return res.status(404).json({ success: false, error: 'User not found' });
    }

    await syncProfileMedia({
      id: updated.id,
      avatar_url: updated.avatar_url,
      cover_url: updated.cover_url,
    }).catch((error) => {
      console.error('Profile media sync error:', error);
    });

    return res.json({
      success: true,
      user: userToAuthPayload(updated),
    });
  } catch (error) {
    logger.error({ error, errorId: req.id }, 'auth_profile_update_failed');
    const message = error instanceof Error ? error.message : 'Failed to update profile';
    const statusCode = message.includes('already in use') ? 400 : 500;
    return res.status(statusCode).json({ success: false, error: message });
  }
});

app.get('/api/users', async (req: Request, res: Response) => {
  try {
    const admin = await requireAdmin(req, res);
    if (!admin) return;

    const search = String(req.query.search || '').trim().toLowerCase();
    const role = String(req.query.role || 'All');
    const status = String(req.query.status || 'All');
    const joined = String(req.query.joined || 'all');
    const page = Math.max(1, Number(req.query.page || 1));
    const perPage = Math.max(1, Number(req.query.perPage || 25));

    const users = hasDatabase()
      ? (await dbQuery<DbUserRow>('SELECT * FROM users ORDER BY created_at DESC')).rows
      : Array.from(inMemoryUsersById.values()).sort((a, b) => (a.created_at < b.created_at ? 1 : -1));

    const now = new Date('2026-03-07T00:00:00Z').getTime();
    const filtered = users.filter((user) => {
      const matchesSearch =
        !search ||
        [user.id, user.email, user.username || '', user.full_name || '']
          .some((value) => value.toLowerCase().includes(search));
      const matchesRole = role === 'All' || titleRole(user.role) === role;
      const matchesStatus = status === 'All' || titleStatus(user.status) === status;
      const joinedMs = new Date(user.created_at).getTime();
      const diffDays = Math.floor((now - joinedMs) / (1000 * 60 * 60 * 24));
      const matchesJoined =
        joined === 'all' ||
        (joined === '7days' && diffDays <= 7) ||
        (joined === '30days' && diffDays <= 30) ||
        (joined === '1year' && diffDays <= 365);
      return matchesSearch && matchesRole && matchesStatus && matchesJoined;
    });

    const start = (page - 1) * perPage;
    const items = filtered.slice(start, start + perPage).map(userToManagedUser);

    return res.json({
      items,
      total: filtered.length,
      page,
      perPage,
    });
  } catch (error) {
    console.error('List users error:', error);
    return res.status(500).json({ success: false, error: 'Failed to fetch users' });
  }
});

app.post('/api/users', async (req: Request, res: Response) => {
  try {
    const admin = await requireAdmin(req, res);
    if (!admin) return;

    const { name, email, username, password, role, status } = req.body;
    if (!name || !email || !username || !password) {
      return res.status(400).json({ success: false, error: 'Name, email, username, and password are required' });
    }

    const existingEmail = await findUserByEmail(String(email));
    if (existingEmail) {
      return res.status(400).json({ success: false, error: 'Email is already in use' });
    }
    const existingUsername = await findUserByUsername(String(username));
    if (existingUsername) {
      return res.status(400).json({ success: false, error: 'Username is already in use' });
    }

    const created = await createUser(String(name), String(username), String(email), String(password), {
      role: parseAdminRole(role),
      status: parseAdminStatus(status),
    });
    return res.status(201).json(userToManagedUser(created));
  } catch (error) {
    console.error('Create user error:', error);
    const message = error instanceof Error ? error.message : 'Failed to create user';
    return res.status(500).json({ success: false, error: message });
  }
});

app.put('/api/users/:id', async (req: Request, res: Response) => {
  try {
    const admin = await requireAdmin(req, res);
    if (!admin) return;

    const { id } = req.params;
    const existing = await getUserById(id);
    if (!existing) {
      return res.status(404).json({ success: false, error: 'User not found' });
    }

    const normalizedEmail = normalizeEmail(String(req.body.email || existing.email));
    const normalizedUsername = normalizeUsername(String(req.body.username || existing.username || ''));
    const duplicateEmail = await findUserByEmail(normalizedEmail);
    if (duplicateEmail && duplicateEmail.id !== id) {
      return res.status(400).json({ success: false, error: 'Email is already in use' });
    }
    const duplicateUsername = await findUserByUsername(normalizedUsername);
    if (duplicateUsername && duplicateUsername.id !== id) {
      return res.status(400).json({ success: false, error: 'Username is already in use' });
    }

    const nextRole = parseAdminRole(req.body.role);
    const nextStatus = parseAdminStatus(req.body.status);
    const nextAvatar = typeof req.body.avatar === 'string' ? req.body.avatar.trim() : existing.avatar_url;
    const nextName = String(req.body.name || existing.full_name || '').trim();

    let updated: DbUserRow | undefined;
    if (!hasDatabase()) {
      const nextUser: DbUserRow = {
        ...existing,
        full_name: nextName || null,
        email: normalizedEmail,
        username: normalizedUsername || null,
        role: nextRole,
        status: nextStatus,
        avatar_url: nextAvatar || null,
      };
      inMemoryUsersById.set(id, nextUser);
      inMemoryUserIdByEmail.set(normalizedEmail, id);
      if (normalizedUsername) {
        inMemoryUserIdByUsername.set(normalizedUsername, id);
      }
      updated = nextUser;
    } else {
      updated = (
        await dbQuery<DbUserRow>(
          `UPDATE users
           SET full_name = $1, email = $2, username = $3, role = $4, status = $5, avatar_url = $6
           WHERE id = $7
           RETURNING *`,
          [nextName || null, normalizedEmail, normalizedUsername || null, nextRole, nextStatus, nextAvatar || null, id],
        )
      ).rows[0];
    }

    return res.json(userToManagedUser(updated!));
  } catch (error) {
    console.error('Update user error:', error);
    return res.status(500).json({ success: false, error: 'Failed to update user' });
  }
});

app.delete('/api/users/:id', async (req: Request, res: Response) => {
  try {
    const admin = await requireAdmin(req, res);
    if (!admin) return;

    const { id } = req.params;
    if (admin.id === id) {
      return res.status(400).json({ success: false, error: 'Admin cannot delete the active admin account' });
    }

    if (!hasDatabase()) {
      const existing = inMemoryUsersById.get(id);
      if (existing?.username) {
        inMemoryUserIdByUsername.delete(normalizeUsername(existing.username));
      }
      if (existing) {
        inMemoryUserIdByEmail.delete(normalizeEmail(existing.email));
      }
      inMemoryUsersById.delete(id);
    } else {
      await dbQuery('DELETE FROM users WHERE id = $1', [id]);
    }

    return res.json({ success: true });
  } catch (error) {
    console.error('Delete user error:', error);
    return res.status(500).json({ success: false, error: 'Failed to delete user' });
  }
});

app.patch('/api/users/:id/status', async (req: Request, res: Response) => {
  try {
    const admin = await requireAdmin(req, res);
    if (!admin) return;

    const { id } = req.params;
    const nextStatus = parseAdminStatus(req.body.status);
    if (!hasDatabase()) {
      const existing = inMemoryUsersById.get(id);
      if (!existing) {
        return res.status(404).json({ success: false, error: 'User not found' });
      }
      inMemoryUsersById.set(id, { ...existing, status: nextStatus });
    } else {
      await dbQuery('UPDATE users SET status = $1 WHERE id = $2', [nextStatus, id]);
    }
    return res.json({ success: true });
  } catch (error) {
    console.error('Patch user status error:', error);
    return res.status(500).json({ success: false, error: 'Failed to update status' });
  }
});

app.patch('/api/users/:id/role', async (req: Request, res: Response) => {
  try {
    const admin = await requireAdmin(req, res);
    if (!admin) return;

    const { id } = req.params;
    const nextRole = parseAdminRole(req.body.role);
    if (!hasDatabase()) {
      const existing = inMemoryUsersById.get(id);
      if (!existing) {
        return res.status(404).json({ success: false, error: 'User not found' });
      }
      inMemoryUsersById.set(id, { ...existing, role: nextRole });
    } else {
      await dbQuery('UPDATE users SET role = $1 WHERE id = $2', [nextRole, id]);
    }
    return res.json({ success: true });
  } catch (error) {
    console.error('Patch user role error:', error);
    return res.status(500).json({ success: false, error: 'Failed to update role' });
  }
});

// OAuth state registration (for CSRF protection)
app.post('/api/oauth/state', async (req: Request, res: Response) => {
  try {
    const auth = requireAuth(req, res);
    if (!auth) return;

    const { state, platform, returnTo, codeVerifier } = req.body as {
      state?: string;
      platform?: string;
      returnTo?: string;
      codeVerifier?: string;
    };
    if (!state || !platform) {
      return res.status(400).json({ success: false, error: 'Missing state or platform' });
    }

    if (!pool) {
      return res.status(503).json({ success: false, error: 'Database not configured' });
    }

    await dbQuery(
      `INSERT INTO oauth_states (state, user_id, platform, return_to, code_verifier, expires_at)
       VALUES ($1, $2, $3, $4, $5, NOW() + INTERVAL '15 minutes')
       ON CONFLICT (state) DO NOTHING`,
      [
        state,
        auth.userId,
        platform,
        typeof returnTo === 'string' ? returnTo.slice(0, 500) : null,
        typeof codeVerifier === 'string' ? codeVerifier.slice(0, 2048) : null,
      ]
    );

    return res.json({ success: true });
  } catch (error) {
    console.error('OAuth state error:', error);
    return res.status(500).json({ success: false, error: 'Failed to store state' });
  }
});

// User settings (persist UI settings server-side)
app.get('/api/user-settings/:key', async (req: Request, res: Response) => {
  try {
    const auth = requireAuth(req, res);
    if (!auth) return;
    if (!hasDatabase()) return res.status(503).json({ success: false, error: 'Database not configured' });

    const key = String(req.params.key || '').trim();
    if (!/^[a-z0-9._:-]{1,80}$/i.test(key)) {
      return res.status(400).json({ success: false, error: 'Invalid key' });
    }

    const result = await dbQuery<{ value: any }>('SELECT value FROM user_settings WHERE user_id = $1 AND key = $2', [auth.userId, key]);
    const value = result.rows[0]?.value ?? null;
    return res.json({ success: true, value });
  } catch (error) {
    console.error('Get user setting error:', error);
    return res.status(500).json({ success: false, error: 'Failed to load setting' });
  }
});

const saveUserSetting = async (req: Request, res: Response) => {
  try {
    const auth = requireAuth(req, res);
    if (!auth) return;
    if (!hasDatabase()) return res.status(503).json({ success: false, error: 'Database not configured' });

    const key = String(req.params.key || '').trim();
    if (!/^[a-z0-9._:-]{1,80}$/i.test(key)) {
      return res.status(400).json({ success: false, error: 'Invalid key' });
    }

    const value = (req.body as any)?.value;
    if (typeof value === 'undefined') {
      return res.status(400).json({ success: false, error: 'value is required' });
    }

    await dbQuery(
      `INSERT INTO user_settings (user_id, key, value, created_at, updated_at)
       VALUES ($1, $2, $3::jsonb, NOW(), NOW())
       ON CONFLICT (user_id, key) DO UPDATE
         SET value = EXCLUDED.value, updated_at = NOW()`,
      [auth.userId, key, JSON.stringify(value)],
    );

    return res.json({ success: true });
  } catch (error) {
    console.error('Save user setting error:', error);
    return res.status(500).json({ success: false, error: 'Failed to save setting' });
  }
};

app.put('/api/user-settings/:key', saveUserSetting);
app.post('/api/user-settings/:key', saveUserSetting);

// OAuth Handler for Instagram and others
app.post('/api/oauth/callback', async (req: Request, res: Response) => {
  try {
    const auth = requireAuth(req, res);
    if (!auth) return;

    const { platform, code, state } = req.body;

    if (!code || !state) {
      return res.status(400).json({ success: false, error: 'Missing code or state' });
    }

    const platformId = String(platform || '').trim().toLowerCase();
    const stateRow = await getOAuthStateRow(String(state));
    if (!stateRow) return res.status(400).json({ success: false, error: 'Invalid or expired state parameter' });
    if (String(stateRow.user_id) !== auth.userId) return res.status(400).json({ success: false, error: 'State does not match user' });
    if (String(stateRow.platform || '').trim().toLowerCase() !== platformId) {
      return res.status(400).json({ success: false, error: 'State does not match platform' });
    }

    const tokenData = await exchangeOAuthCode(platformId, String(code), stateRow.code_verifier || undefined, req);
    await storeUserConnection(auth.userId, platformDisplayName(platformId), tokenData);
    await dbQuery('DELETE FROM oauth_states WHERE state = $1', [String(state)]).catch(() => undefined);

    return res.json({ success: true, data: tokenData, returnTo: (stateRow as any).return_to || null });
  } catch (error) {
    console.error('OAuth callback error:', error);
    return res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : 'OAuth callback failed',
    });
  }
});

// Get connected accounts
app.get('/api/accounts', async (req: Request, res: Response) => {
  try {
    const auth = requireAuth(req, res);
    if (!auth) return;

    const accounts = await getUserConnectedAccounts(auth.userId);
    return res.json({ success: true, data: accounts });
  } catch (error) {
    console.error('Accounts error:', error);
    return res.status(500).json({ success: false, error: 'Failed to fetch accounts' });
  }
});

// Get Facebook publish targets (Pages; Groups best-effort)
app.get('/api/facebook/targets', async (req: Request, res: Response) => {
  try {
    const auth = requireAuth(req, res);
    if (!auth) return;
    if (!hasDatabase()) return res.status(503).json({ success: false, error: 'Database not configured' });

    const conn = await getPublishableSocialConnection(auth.userId, 'facebook');
    const accessToken = String(conn?.access_token || '').trim();
    if (!accessToken) {
      return res.status(400).json({ success: false, error: 'Facebook access token missing or expired — please reconnect' });
    }

    const graphBase = 'https://graph.facebook.com/v19.0';
    const warnings: string[] = [];

    const pagesResp = await axios.get(
      `${graphBase}/me/accounts?fields=id,name&limit=200&access_token=${encodeURIComponent(accessToken)}`,
      { validateStatus: () => true, timeout: 15000 }
    );
    const pagesData: any = pagesResp.data || {};
    if (pagesResp.status >= 400) {
      const msg = pagesData?.error?.message || `Facebook API error ${pagesResp.status}`;
      if (missingPermissions.length > 0) {
        return res.json({ success: true, pages: [], missingPermissions, warning: msg });
      }
      return res.status(400).json({ success: false, error: msg });
    }
    const pages = Array.isArray(pagesData?.data)
      ? pagesData.data
          .map((p: any) => ({ id: String(p?.id || '').trim(), name: String(p?.name || '').trim() }))
          .filter((p: any) => p.id)
      : [];

    // Groups listing is often restricted by permissions/app review; try, but don't fail the request.
    let groups: Array<{ id: string; name: string }> = [];
    try {
      const groupsResp = await axios.get(
        `${graphBase}/me/groups?fields=id,name&limit=200&access_token=${encodeURIComponent(accessToken)}`,
        { validateStatus: () => true, timeout: 15000 }
      );
      const groupsData: any = groupsResp.data || {};
      if (groupsResp.status >= 400) {
        const msg = groupsData?.error?.message || `Facebook groups lookup failed (${groupsResp.status})`;
        warnings.push(msg);
      } else {
        groups = Array.isArray(groupsData?.data)
          ? groupsData.data
              .map((g: any) => ({ id: String(g?.id || '').trim(), name: String(g?.name || '').trim() }))
              .filter((g: any) => g.id)
          : [];
      }
    } catch {
      warnings.push('Facebook groups lookup failed');
    }

    return res.json({ success: true, pages, groups, warnings });
  } catch (error) {
    console.error('Facebook targets error:', error);
    return res.status(500).json({ success: false, error: 'Failed to fetch Facebook targets' });
  }
});

// Instagram (Graph API) targets via Facebook Pages
// GET /api/instagram/targets — list pages with connected Instagram Business accounts
app.get('/api/instagram/targets', async (req: Request, res: Response) => {
  try {
    const auth = requireAuth(req, res);
    if (!auth) return;
    if (!pool) return res.status(503).json({ success: false, error: 'Database not configured' });

    const fbConn = await getPublishableSocialConnection(auth.userId, 'facebook');
    const accessToken = String(fbConn?.access_token || '').trim();
    if (!accessToken) {
      return res.status(400).json({ success: false, error: 'Meta access token missing or expired — reconnect Facebook to load Instagram business accounts' });
    }

    const result = await listInstagramPageTargets(accessToken);
    return res.json({
      success: true,
      targets: result.targets.map(({ pageAccessToken, ...target }) => target),
      missingPermissions: result.missingPermissions,
      warnings: result.warnings,
    });
  } catch (error) {
    console.error('Instagram targets error:', error);
    return res.status(500).json({ success: false, error: 'Failed to fetch Instagram targets' });
  }
});

// POST /api/instagram/connect — save a selected Instagram Business account (stores Page token for publishing)
app.post('/api/instagram/connect', async (req: Request, res: Response) => {
  try {
    const auth = requireAuth(req, res);
    if (!auth) return;
    if (!pool) return res.status(503).json({ success: false, error: 'Database not configured' });

    const { pageId, instagramId, instagramUsername } = req.body as { pageId?: string; instagramId?: string; instagramUsername?: string };
    const pid = String(pageId || '').trim();
    const igId = String(instagramId || '').trim();
    if (!pid || !igId) return res.status(400).json({ success: false, error: 'pageId and instagramId are required' });

    const fbConn = await getPublishableSocialConnection(auth.userId, 'facebook');
    const accessToken = String(fbConn?.access_token || '').trim();
    if (!accessToken) {
      return res.status(400).json({ success: false, error: 'Meta access token missing or expired — reconnect Facebook before linking Instagram' });
    }

    const targetResult = await listInstagramPageTargets(accessToken);
    const match = (targetResult.targets || []).find((target: any) => target.pageId === pid);
    if (!match) {
      return res.status(400).json({ success: false, error: 'Selected Facebook Page was not found in your Meta account list' });
    }
    if (!match.instagramId || match.instagramId !== igId) {
      return res.status(400).json({ success: false, error: 'Selected page is not linked to the requested Instagram professional account' });
    }

    const pageToken = String(match.pageAccessToken || '').trim();
    if (!pageToken) {
      return res.status(400).json({ success: false, error: 'Facebook Page access token not available for this Instagram account. Save the Page under Facebook first or reconnect Meta.' });
    }

    const profileResult = await fetchInstagramBusinessProfile(igId, pageToken);
    const profile = profileResult.profile || {};
    const displayName = String(profile?.name || profile?.username || instagramUsername || '').trim() || null;
    const handle = String(profile?.username || instagramUsername || '').trim() || null;
    const followers = Number(profile?.followers_count ?? 0);
    const profileImage = typeof profile?.profile_picture_url === 'string' ? profile.profile_picture_url : null;
    const pageTokenExpiry = fbConn?.token_expires_at || null;

    const pageTokenEncrypted = encryptIntegrationSecret(pageToken);

    await pool.query(
      `INSERT INTO social_accounts
        (id, user_id, platform, account_type, account_id, account_name, handle, profile_image, followers, connected, connected_at, token_expires_at, access_token, access_token_encrypted, token_data, needs_reapproval, created_at)
       VALUES ($1,$2,'instagram','profile',$3,$4,$5,$6,$7,true,NOW(),$8,$9,$10,$11::jsonb,false,NOW())
       ON CONFLICT (user_id, platform) WHERE account_type = 'profile' DO UPDATE
         SET account_id=EXCLUDED.account_id,
             account_name=EXCLUDED.account_name,
             handle=EXCLUDED.handle,
             profile_image=COALESCE(EXCLUDED.profile_image, social_accounts.profile_image),
             followers=CASE WHEN EXCLUDED.followers > 0 THEN EXCLUDED.followers ELSE social_accounts.followers END,
             connected=true,
             connected_at=NOW(),
             token_expires_at=COALESCE(EXCLUDED.token_expires_at, social_accounts.token_expires_at),
             access_token=EXCLUDED.access_token,
             access_token_encrypted=EXCLUDED.access_token_encrypted,
             token_data=EXCLUDED.token_data,
             needs_reapproval=false`,
      [
        randomUUID(),
        auth.userId,
        igId,
        displayName,
        handle,
        profileImage,
        followers,
        pageTokenExpiry,
        null,
        pageTokenEncrypted,
        JSON.stringify({
          pageId: pid,
          pageName: match.pageName || null,
          pagePicture: match.pagePicture || null,
          pageTasks: match.pageTasks || [],
          instagramUsername: handle,
          instagramName: displayName,
          accountType: profile?.account_type || match.instagramAccountType || null,
          mediaCount: Number(profile?.media_count ?? match.instagramMediaCount ?? 0),
          website: profile?.website || match.instagramWebsite || null,
          biography: profile?.biography || match.instagramBio || null,
          profilePictureUrl: profileImage || match.instagramProfilePicture || null,
          canPublish: Boolean(match.canPublish),
          canInsights: Boolean(match.canInsights),
        }),
      ]
    );

    await upsertUserIntegration({
      userId: auth.userId,
      integrationSlug: 'instagram',
      accessTokenEncrypted: pageTokenEncrypted,
      refreshTokenEncrypted: null,
      tokenExpiry: pageTokenExpiry,
      accountId: igId,
      accountName: displayName,
      status: 'connected',
    });

    await logIntegrationEvent({
      userId: auth.userId,
      integrationSlug: 'instagram',
      eventType: 'connection_attempt',
      status: 'success',
      response: { pageId: pid, instagramId: igId, instagramUsername: handle, pageName: match.pageName || null },
    });

    return res.json({ success: true });
  } catch (error) {
    console.error('Instagram connect error:', error);
    await logIntegrationEvent({
      userId: null,
      integrationSlug: 'instagram',
      eventType: 'connection_attempt',
      status: 'failed',
      response: { error: error instanceof Error ? error.message : 'Unknown error' },
    });
    return res.status(500).json({ success: false, error: 'Failed to connect Instagram' });
  }
});

// Pinterest
// GET /api/pinterest/boards — list boards for the connected Pinterest user
app.get('/api/pinterest/boards', async (req: Request, res: Response) => {
  try {
    const auth = requireAuth(req, res);
    if (!auth) return;
    if (!pool) return res.status(503).json({ success: false, error: 'Database not configured' });

    const conn = await getPublishableSocialConnection(auth.userId, 'pinterest');
    const accessToken = String(conn?.access_token || '').trim();
    if (!accessToken) return res.status(400).json({ success: false, error: 'Pinterest access token missing or expired — please connect Pinterest' });

    const resp = await axios.get('https://api.pinterest.com/v5/boards?page_size=100', {
      headers: { Authorization: `Bearer ${accessToken}` },
      validateStatus: () => true,
      timeout: 15000,
    });
    const data: any = resp.data || {};
    if (resp.status >= 400) {
      const msg = data?.message || data?.error || `Pinterest API error ${resp.status}`;
      return res.status(400).json({ success: false, error: msg });
    }
    const boards = Array.isArray(data?.items)
      ? data.items.map((b: any) => ({ id: String(b?.id || '').trim(), name: String(b?.name || '').trim() })).filter((b: any) => b.id)
      : [];

    return res.json({ success: true, boards });
  } catch (error) {
    console.error('Pinterest boards error:', error);
    return res.status(500).json({ success: false, error: 'Failed to fetch Pinterest boards' });
  }
});

// POST /api/pinterest/boards — create a board for the connected Pinterest user
app.post('/api/pinterest/boards', async (req: Request, res: Response) => {
  try {
    const auth = requireAuth(req, res);
    if (!auth) return;
    if (!pool) return res.status(503).json({ success: false, error: 'Database not configured' });

    const conn = await getPublishableSocialConnection(auth.userId, 'pinterest');
    const accessToken = String(conn?.access_token || '').trim();
    if (!accessToken) {
      return res.status(400).json({ success: false, error: 'Pinterest access token missing or expired — please connect Pinterest' });
    }

    const input = (req.body || {}) as any;
    const name = typeof input?.name === 'string' ? input.name.trim() : '';
    const description = typeof input?.description === 'string' ? input.description.trim() : '';
    const privacyRaw = typeof input?.privacy === 'string' ? input.privacy.trim().toUpperCase() : '';
    const privacy = privacyRaw === 'SECRET' ? 'SECRET' : 'PUBLIC';

    if (!name) return res.status(400).json({ success: false, error: 'Board name is required' });

    const createBody: any = { name, is_ads_only: false, privacy };
    if (description) createBody.description = description;

    const resp = await axios.post('https://api.pinterest.com/v5/boards', createBody, {
      headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
      validateStatus: () => true,
      timeout: 15000,
    });
    const data: any = resp.data || {};
    if (resp.status >= 400) {
      let msg = data?.message || data?.error || `Pinterest API error ${resp.status}`;
      if (typeof msg === 'string' && msg.includes('boards:write')) {
        msg = 'Pinterest permission missing: boards:write. Reconnect Pinterest in Integrations, then try again.';
      }
      return res.status(400).json({ success: false, error: msg });
    }

    const boardId = String(data?.id || '').trim();
    const boardName = String(data?.name || '').trim() || name;
    if (!boardId) {
      return res.status(500).json({ success: false, error: 'Pinterest returned an invalid board id' });
    }

    return res.json({ success: true, board: { id: boardId, name: boardName } });
  } catch (error) {
    console.error('Pinterest create board error:', error);
    return res.status(500).json({ success: false, error: 'Failed to create Pinterest board' });
  }
});

// Mailchimp (API key)
app.post('/api/integrations/mailchimp/connect', async (req: Request, res: Response) => {
  try {
    const auth = requireAuth(req, res);
    if (!auth) return;
    if (!pool) return res.status(503).json({ success: false, error: 'Database not configured' });

    const { apiKey, serverPrefix } = req.body as { apiKey?: string; serverPrefix?: string };
    const key = String(apiKey || '').trim();
    const prefix = String(serverPrefix || '').trim();
    if (!key || !prefix) return res.status(400).json({ success: false, error: 'apiKey and serverPrefix are required' });

    const resp = await axios.get(`https://${prefix}.api.mailchimp.com/3.0/`, {
      auth: { username: 'anystring', password: key },
      validateStatus: () => true,
      timeout: 8000,
    });
    if (resp.status !== 200) return res.status(400).json({ success: false, error: 'Invalid Mailchimp API key or server prefix' });

    const tokenEncrypted = encryptIntegrationSecret(JSON.stringify({ apiKey: key, serverPrefix: prefix }));
    await upsertUserIntegration({
      userId: auth.userId,
      integrationSlug: 'mailchimp',
      accessTokenEncrypted: tokenEncrypted,
      refreshTokenEncrypted: null,
      tokenExpiry: null,
      accountId: prefix,
      accountName: 'Mailchimp',
      status: 'connected',
    });

    await logIntegrationEvent({
      userId: auth.userId,
      integrationSlug: 'mailchimp',
      eventType: 'connection_attempt',
      status: 'success',
      response: { serverPrefix: prefix },
    });

    return res.json({ success: true });
  } catch (error) {
    console.error('Mailchimp connect error:', error);
    await logIntegrationEvent({
      userId: null,
      integrationSlug: 'mailchimp',
      eventType: 'connection_attempt',
      status: 'failed',
      response: { error: error instanceof Error ? error.message : 'Connect failed' },
    });
    return res.status(500).json({ success: false, error: 'Failed to connect Mailchimp' });
  }
});

app.delete('/api/integrations/mailchimp/disconnect', async (req: Request, res: Response) => {
  try {
    const auth = requireAuth(req, res);
    if (!auth) return;
    if (!pool) return res.json({ success: true });

    await upsertUserIntegration({
      userId: auth.userId,
      integrationSlug: 'mailchimp',
      accessTokenEncrypted: null,
      refreshTokenEncrypted: null,
      tokenExpiry: null,
      accountId: null,
      accountName: null,
      status: 'disconnected',
    });

    await logIntegrationEvent({
      userId: auth.userId,
      integrationSlug: 'mailchimp',
      eventType: 'disconnect',
      status: 'info',
      response: {},
    });

    return res.json({ success: true });
  } catch (error) {
    console.error('Mailchimp disconnect error:', error);
    return res.status(500).json({ success: false, error: 'Failed to disconnect Mailchimp' });
  }
});

// Disconnect account
app.delete('/api/accounts/:platform', async (req: Request, res: Response) => {
  try {
    const auth = requireAuth(req, res);
    if (!auth) return;

    const { platform } = req.params;
    await removeUserConnection(auth.userId, platform);
    return res.json({ success: true });
  } catch (error) {
    console.error('Disconnect error:', error);
    return res.status(500).json({ success: false, error: 'Failed to disconnect' });
  }
});

// Test connection
app.get('/api/accounts/:platform/test', async (req: Request, res: Response) => {
  try {
    const auth = requireAuth(req, res);
    if (!auth) return;

    const { platform } = req.params;
    const result = await testPlatformConnection(auth.userId, platform);
    return res.json({ success: true, data: result });
  } catch (error) {
    console.error('Test connection error:', error);
    return res.status(500).json({ success: false, error: 'Connection test failed' });
  }
});

// Publish post
app.post('/api/posts/:platform/publish', async (req: Request, res: Response) => {
  try {
    const auth = requireAuth(req, res);
    if (!auth) return;

    const { platform } = req.params;
    const { text, media, hashtags } = req.body;

    const result = await publishToPlatform(auth.userId, platform, {
      text,
      media,
      hashtags,
    });

    return res.json({ success: true, data: result });
  } catch (error) {
    console.error('Publish error:', error);
    return res.status(500).json({ success: false, error: 'Failed to publish post' });
  }
});

// Get analytics
app.get('/api/analytics/:platform', async (req: Request, res: Response) => {
  try {
    const auth = requireAuth(req, res);
    if (!auth) return;

    const { platform } = req.params;
    const analytics = await getPlatformAnalytics(auth.userId, platform);
    return res.json({ success: true, data: analytics });
  } catch (error) {
    console.error('Analytics error:', error);
    return res.status(500).json({ success: false, error: 'Failed to fetch analytics' });
  }
});

// OAuth Exchange Functions — credentials read from DB first, then env vars
function platformDisplayName(platformId: string) {
  switch ((platformId || '').trim().toLowerCase()) {
    case 'instagram':
      return 'Instagram';
    case 'facebook':
      return 'Facebook';
    case 'linkedin':
      return 'LinkedIn';
    case 'twitter':
      return 'Twitter';
    case 'pinterest':
      return 'Pinterest';
    case 'tiktok':
      return 'TikTok';
    case 'threads':
      return 'Threads';
    default:
      return platformId;
  }
}

async function getOAuthStateRow(state: string): Promise<{ user_id: string; platform: string; return_to?: string | null; code_verifier?: string | null } | null> {
  if (!hasDatabase()) return null;
  const result = await dbQuery<{ user_id: string; platform: string; return_to: string | null; code_verifier: string | null }>(
    'SELECT user_id, platform, return_to, code_verifier FROM oauth_states WHERE state = $1 AND expires_at > NOW()',
    [state]
  );
  return result.rows[0] ?? null;
}

const LINKEDIN_DEFAULT_OAUTH_SCOPES = [
  'r_liteprofile',
  'r_emailaddress',
  'w_member_social',
  'r_organization_admin',
  'rw_organization_admin',
  'r_organization_social',
  'w_organization_social',
];

const LINKEDIN_ORG_ADMIN_SCOPE_OPTIONS = ['r_organization_admin', 'rw_organization_admin'];

function getLinkedInOAuthScopeString(): string {
  return String(process.env.LINKEDIN_OAUTH_SCOPES || LINKEDIN_DEFAULT_OAUTH_SCOPES.join(' ')).trim();
}

function parseLinkedInScopeList(value: unknown): string[] {
  const raw = String(value || '').trim();
  if (!raw) return [];
  let decoded = raw;
  try {
    decoded = decodeURIComponent(raw);
  } catch {
    decoded = raw;
  }
  return Array.from(new Set(decoded.split(/[\s,]+/).map((scope) => scope.trim()).filter(Boolean)));
}

function getLinkedInScopeSet(tokenData: any): Set<string> {
  const fromString = parseLinkedInScopeList(tokenData?.scope);
  const fromArray = Array.isArray(tokenData?.scopes)
    ? tokenData.scopes.map((scope: unknown) => String(scope || '').trim()).filter(Boolean)
    : [];
  return new Set([...fromString, ...fromArray]);
}

function hasAnyLinkedInScope(tokenData: any, scopes: string[]): boolean {
  const granted = getLinkedInScopeSet(tokenData);
  return scopes.some((scope) => granted.has(scope));
}

function hasAllLinkedInScopes(tokenData: any, scopes: string[]): boolean {
  const granted = getLinkedInScopeSet(tokenData);
  return scopes.every((scope) => granted.has(scope));
}

function getLinkedInOrganizationScopeError(
  tokenData: any,
  options?: { requireSocialRead?: boolean; requireSocialWrite?: boolean },
): string | null {
  const granted = getLinkedInScopeSet(tokenData);
  if (granted.size === 0) return null;

  if (!LINKEDIN_ORG_ADMIN_SCOPE_OPTIONS.some((scope) => granted.has(scope))) {
    return 'LinkedIn connection is missing organization admin scopes — reconnect LinkedIn and approve company page access';
  }
  if (options?.requireSocialRead && !granted.has('r_organization_social')) {
    return 'LinkedIn connection is missing r_organization_social — reconnect LinkedIn to load company page analytics';
  }
  if (options?.requireSocialWrite && !granted.has('w_organization_social')) {
    return 'LinkedIn connection is missing w_organization_social — reconnect LinkedIn to publish to company pages';
  }
  return null;
}

function shouldEnableLinkedInExtendedLogin(): boolean {
  const raw = String(process.env.LINKEDIN_ENABLE_EXTENDED_LOGIN || 'true').trim().toLowerCase();
  return raw !== '0' && raw !== 'false' && raw !== 'no' && raw !== 'off';
}

function computeIsoFromUnixTimestamp(seconds: unknown): string | null {
  const value = Number(seconds);
  if (!Number.isFinite(value) || value <= 0) return null;
  return new Date(value * 1000).toISOString();
}

function computeIsoFromTtlSeconds(seconds: unknown): string | null {
  const value = Number(seconds);
  if (!Number.isFinite(value) || value <= 0) return null;
  return new Date(Date.now() + value * 1000).toISOString();
}

async function getLinkedInOAuthCredentials(req?: Request): Promise<{
  clientId: string;
  redirectUri: string;
  clientSecrets: string[];
}> {
  const cfg = await getPlatformConfig('linkedin');
  const clientId = String(cfg.clientId || process.env.VITE_LINKEDIN_CLIENT_ID || process.env.LINKEDIN_CLIENT_ID || '').trim();
  const redirectUri = resolveOAuthRedirectUri('linkedin', cfg.redirectUri || process.env.VITE_LINKEDIN_REDIRECT_URI || process.env.LINKEDIN_REDIRECT_URI, req);
  const clientSecrets = Array.from(
    new Set(
      [
        cfg.clientSecret,
        process.env.LINKEDIN_CLIENT_SECRET,
        process.env.LINKEDIN_CLIENT_SECRET_PREVIOUS,
        process.env.LINKEDIN_CLIENT_SECRET_ALT,
      ]
        .map((value) => String(value || '').trim())
        .filter(Boolean)
    )
  );

  if (!clientId || !redirectUri || clientSecrets.length === 0) {
    throw new Error('LinkedIn client credentials not configured');
  }

  return { clientId, redirectUri, clientSecrets };
}

function shouldRetryLinkedInSecret(status: number, payload: any): boolean {
  const errorCode = String(payload?.error || payload?.code || '').trim().toLowerCase();
  return status === 401 || errorCode === 'invalid_client' || errorCode === 'unauthorized_client';
}

async function postLinkedInOAuthForm(
  baseParams: Record<string, string>,
  credentials: { clientId: string; redirectUri: string; clientSecrets: string[] },
): Promise<any> {
  let lastResponse: any = null;

  for (let index = 0; index < credentials.clientSecrets.length; index += 1) {
    const clientSecret = credentials.clientSecrets[index];
    const body = new URLSearchParams({
      ...baseParams,
      client_id: credentials.clientId,
      client_secret: clientSecret,
      redirect_uri: credentials.redirectUri,
    });
    const response = await axios.post('https://www.linkedin.com/oauth/v2/accessToken', body.toString(), {
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      validateStatus: () => true,
      timeout: 15000,
    });

    if (response.status < 400) return response;

    lastResponse = response;
    if (index === credentials.clientSecrets.length - 1 || !shouldRetryLinkedInSecret(response.status, response.data)) {
      return response;
    }
  }

  return lastResponse;
}

async function introspectLinkedInAccessToken(accessToken: string, req?: Request): Promise<any | null> {
  const token = String(accessToken || '').trim();
  if (!token) return null;

  try {
    const credentials = await getLinkedInOAuthCredentials(req);
    let lastResponse: any = null;

    for (let index = 0; index < credentials.clientSecrets.length; index += 1) {
      const body = new URLSearchParams({
        client_id: credentials.clientId,
        client_secret: credentials.clientSecrets[index],
        token,
      });
      const response = await axios.post('https://www.linkedin.com/oauth/v2/introspectToken', body.toString(), {
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        validateStatus: () => true,
        timeout: 15000,
      });

      if (response.status < 400) return response.data || null;

      lastResponse = response;
      if (index === credentials.clientSecrets.length - 1 || !shouldRetryLinkedInSecret(response.status, response.data)) {
        break;
      }
    }

    return lastResponse?.data || null;
  } catch {
    return null;
  }
}

function mergeLinkedInTokenMetadata(tokenData: any, introspection?: any) {
  const next = tokenData && typeof tokenData === 'object' ? { ...tokenData } : {};
  const scopes = parseLinkedInScopeList(next?.scope || introspection?.scope);
  if (scopes.length > 0) {
    next.scope = scopes.join(' ');
    next.scopes = scopes;
  }

  if (typeof introspection?.active === 'boolean') next.access_token_active = introspection.active;
  if (introspection?.status) next.access_token_status = String(introspection.status);
  if (introspection?.authorized_at != null) next.access_token_authorized_at = Number(introspection.authorized_at);
  if (introspection?.created_at != null) next.access_token_created_at = Number(introspection.created_at);
  if (introspection?.expires_at != null) {
    next.access_token_expires_at_unix = Number(introspection.expires_at);
    const accessTokenExpiresAt = computeIsoFromUnixTimestamp(introspection.expires_at);
    if (accessTokenExpiresAt) next.access_token_expires_at = accessTokenExpiresAt;
  }

  const refreshTokenExpiresAt = computeIsoFromTtlSeconds(next?.refresh_token_expires_in);
  if (refreshTokenExpiresAt) next.refresh_token_expires_at = refreshTokenExpiresAt;

  return next;
}

async function enrichLinkedInTokenData(tokenData: any, req?: Request) {
  const accessToken = String(tokenData?.access_token || '').trim();
  let enriched = tokenData && typeof tokenData === 'object' ? { ...tokenData } : {};

  if (accessToken) {
    const introspection = await introspectLinkedInAccessToken(accessToken, req);
    enriched = mergeLinkedInTokenMetadata(enriched, introspection);

    try {
      // Primary: /v2/me (works with r_liteprofile — standard "Share on LinkedIn" scope)
      // Fallback: /v2/userinfo (OpenID Connect, for apps with openid/profile scopes)
      let linkedInId = '';
      let fullName = '';
      const meResp = await axios.get('https://api.linkedin.com/v2/me', {
        headers: { Authorization: `Bearer ${accessToken}` },
        validateStatus: () => true,
        timeout: 15000,
      });
      if (meResp.status < 400) {
        const meData: any = meResp.data || {};
        linkedInId = String(meData?.id || '').trim();
        fullName = [String(meData?.localizedFirstName || ''), String(meData?.localizedLastName || '')].filter(Boolean).join(' ').trim();
      }
      if (!linkedInId) {
        const userinfoResp = await axios.get('https://api.linkedin.com/v2/userinfo', {
          headers: { Authorization: `Bearer ${accessToken}` },
          validateStatus: () => true,
          timeout: 15000,
        });
        if (userinfoResp.status < 400) {
          const userData: any = userinfoResp.data || {};
          linkedInId = String(userData?.sub || '').trim();
          fullName = fullName || String(userData?.name || '').trim() || [String(userData?.given_name || ''), String(userData?.family_name || '')].filter(Boolean).join(' ').trim();
        }
      }
      if (linkedInId) {
        enriched.user_id = linkedInId;
        enriched.id = linkedInId;
        enriched.sub = linkedInId;
      }
      if (fullName) enriched.name = fullName;
    } catch {
      // best-effort enrichment; token can still be stored without profile data
    }
  }

  return enriched;
}

async function exchangeOAuthCode(platformId: string, code: string, codeVerifier?: string, req?: Request) {
  switch ((platformId || '').trim().toLowerCase()) {
    case 'instagram':
      return exchangeInstagramCode(code);
    case 'twitter':
      return exchangeTwitterCode(code, codeVerifier, req);
    case 'linkedin':
      return exchangeLinkedInCode(code, req);
    case 'facebook':
      return exchangeFacebookCode(code);
    case 'pinterest':
      return exchangePinterestCode(code, req);
    case 'threads':
      return exchangeThreadsCode(code);
    case 'tiktok':
      return exchangeTikTokCode(code, codeVerifier);
    default:
      throw new Error('Unsupported platform');
  }
}

async function exchangePinterestCode(code: string, req?: Request) {
  const cfg = await getPlatformConfig('pinterest');
  const clientId = String(cfg.clientId || process.env.VITE_PINTEREST_CLIENT_ID || '').trim();
  const clientSecret = String(cfg.clientSecret || process.env.PINTEREST_CLIENT_SECRET || '').trim();
  const redirectUri = resolveOAuthRedirectUri('pinterest', cfg.redirectUri, req);
  if (!clientId || !clientSecret) throw new Error('Pinterest client credentials not configured');

  const data = new URLSearchParams({
    grant_type: 'authorization_code',
    code,
    redirect_uri: redirectUri,
  });

  const basic = Buffer.from(`${clientId}:${clientSecret}`).toString('base64');
  const resp = await axios.post('https://api.pinterest.com/v5/oauth/token', data.toString(), {
    headers: { 'Content-Type': 'application/x-www-form-urlencoded', Authorization: `Basic ${basic}` },
    validateStatus: () => true,
    timeout: 15000,
  });
  if (resp.status >= 400) {
    const msg = (resp.data as any)?.message || (resp.data as any)?.error || `Pinterest token exchange failed (${resp.status})`;
    console.error('Pinterest token exchange error:', { status: resp.status, body: resp.data, redirectUri });
    throw new Error(msg);
  }
  const tokenData: any = resp.data || {};

  // Best-effort enrichment: store user_id/username/profile_image so the integration UI is nicer
  // and downstream analytics can work even if token response omits identity fields.
  const accessToken = String(tokenData?.access_token || '').trim();
  if (accessToken) {
    try {
      const meResp = await axios.get('https://api.pinterest.com/v5/user_account', {
        headers: { Authorization: `Bearer ${accessToken}` },
        validateStatus: () => true,
        timeout: 15000,
      });
      if (meResp.status < 400) {
        const me: any = meResp.data || {};
        if (me?.id) {
          tokenData.user_id = String(me.id);
          tokenData.id = String(me.id);
        }
        if (me?.username) tokenData.username = String(me.username);
        if (me?.profile_image) tokenData.avatar_url = String(me.profile_image);
        if (me?.follower_count != null) tokenData.followers_count = me.follower_count;
        if (me?.following_count != null) tokenData.following_count = me.following_count;
        if (me?.pin_count != null) tokenData.pin_count = me.pin_count;
        if (me?.board_count != null) tokenData.board_count = me.board_count;
        if (me?.monthly_views != null) tokenData.monthly_views = me.monthly_views;
        if (me?.website_url != null) tokenData.website_url = me.website_url;
        if (me?.about != null) tokenData.about = me.about;
        tokenData.name =
          String(me?.business_name || me?.username || tokenData?.name || '').trim() ||
          tokenData?.name ||
          null;
      }
    } catch {
      // Ignore identity enrichment failures; token exchange still succeeds.
    }
  }

  return tokenData;
}

async function exchangeInstagramCode(code: string) {
  const cfg = await getPlatformConfig('instagram');
  const data = new URLSearchParams({
    client_id: cfg.appId || process.env.VITE_INSTAGRAM_APP_ID || '',
    client_secret: cfg.appSecret || process.env.INSTAGRAM_APP_SECRET || '',
    grant_type: 'authorization_code',
    redirect_uri: resolveOAuthRedirectUri('instagram', cfg.redirectUri || process.env.VITE_INSTAGRAM_REDIRECT_URI),
    code,
  });
  const response = await axios.post('https://api.instagram.com/oauth/access_token', data, {
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
  });
  return response.data;
}

async function exchangeTwitterCode(code: string, codeVerifier?: string, req?: Request) {
  const cfg = await getPlatformConfig('twitter');
  const clientId = (cfg.clientId || process.env.VITE_TWITTER_CLIENT_ID || '').trim();
  const clientSecret = (cfg.clientSecret || process.env.TWITTER_CLIENT_SECRET || '').trim();
  const redirectUri = resolveOAuthRedirectUri('twitter', cfg.redirectUri || process.env.VITE_TWITTER_REDIRECT_URI, req);

  if (!clientId) throw new Error('Twitter Client ID is not configured. Set it in Admin → Integrations → X.');
  if (!clientSecret) throw new Error('Twitter Client Secret is not configured. Set it in Admin → Integrations → X.');

  // Confidential clients: send credentials via HTTP Basic auth only (NOT in body)
  // Public clients (no secret): send client_id in body — but Twitter apps with a secret must use Basic auth
  const body = new URLSearchParams({
    code,
    grant_type: 'authorization_code',
    redirect_uri: redirectUri,
    code_verifier: (codeVerifier || cfg.codeVerifier || '').trim() || 'challenge',
  });

  const response = await axios.post(X_OAUTH_TOKEN_URL, body.toString(), {
    auth: { username: clientId, password: clientSecret },
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    validateStatus: () => true,
    timeout: 15000,
  });
  if (response.status >= 400) {
    const errBody: any = response.data || {};
    const detail = errBody?.error_description || errBody?.error || '';
    throw new Error(`Twitter token exchange failed (${response.status})${detail ? `: ${detail}` : ''}`);
  }
  const tokenData: any = response.data || {};

  // Enrich with profile info so user_id and name are stored
  const accessToken = String(tokenData?.access_token || '').trim();
  if (accessToken) {
    try {
      const meResp = await axios.get(X_USERS_ME_API, {
        params: { 'user.fields': 'id,name,username,profile_image_url' },
        headers: { Authorization: `Bearer ${accessToken}` },
        validateStatus: () => true,
        timeout: 10000,
      });
      if (meResp.status >= 400) {
        const meErr: any = meResp.data || {};
        if (String(meErr?.reason || '') === 'client-not-enrolled') {
          throw new Error('X app is not attached to a Project or lacks API access. Fix it in the X developer portal, then reconnect X.');
        }
      } else {
        const u: any = meResp.data?.data || {};
        if (u.id) { tokenData.user_id = u.id; tokenData.id = u.id; tokenData.sub = u.id; }
        if (u.username) tokenData.username = u.username;
        // Display name falls back to @username so account_name is never blank in the UI
        tokenData.name = u.name || (u.username ? `@${u.username}` : null);
        if (u.profile_image_url) tokenData.avatar_url = u.profile_image_url;
      }
    } catch (err) {
      if (err instanceof Error && err.message.includes('X app is not attached to a Project')) {
        throw err;
      }
      // best-effort; token stored even without profile data
    }
  }
  return tokenData;
}

async function exchangeLinkedInCode(code: string, req?: Request) {
  const credentials = await getLinkedInOAuthCredentials(req);
  const response = await postLinkedInOAuthForm(
    {
      grant_type: 'authorization_code',
      code,
    },
    credentials
  );
  if (response.status >= 400) {
    const errBody: any = response.data || {};
    const detail = errBody?.error_description || errBody?.error || '';
    throw new Error(`LinkedIn token exchange failed (${response.status})${detail ? `: ${detail}` : ''}`);
  }
  return enrichLinkedInTokenData(response.data || {}, req);
}

async function exchangeFacebookCode(code: string, redirectUriOverride?: string) {
  const cfg = await getPlatformConfig('facebook');
  const redirectUri = resolveOAuthRedirectUri('facebook', redirectUriOverride || cfg.redirectUri || process.env.VITE_FACEBOOK_REDIRECT_URI);
  const response = await axios.get('https://graph.facebook.com/v18.0/oauth/access_token', {
    params: {
      client_id: cfg.appId || process.env.VITE_FACEBOOK_APP_ID,
      client_secret: cfg.appSecret || process.env.FACEBOOK_APP_SECRET,
      redirect_uri: redirectUri,
      code,
    },
  });
  const tokenData: any = response.data || {};

  const accessToken = String(tokenData?.access_token || '').trim();
  if (accessToken) {
    try {
      const meResp = await axios.get('https://graph.facebook.com/v19.0/me', {
        params: {
          fields: 'id,name,picture.width(256).height(256)',
          access_token: accessToken,
        },
        validateStatus: () => true,
        timeout: 15000,
      });
      if (meResp.status < 400) {
        const meData: any = meResp.data || {};
        if (meData?.id) tokenData.user_id = String(meData.id);
        if (meData?.id) tokenData.id = String(meData.id);
        if (meData?.name) tokenData.name = String(meData.name);
        if (meData?.picture) tokenData.picture = meData.picture;
        if (meData?.picture?.data?.url) tokenData.avatar_url = String(meData.picture.data.url);
      }
    } catch {
      // best-effort; token still valid even if profile lookup fails
    }
  }

  return tokenData;
}

async function exchangeThreadsCode(code: string) {
  const cfg = await getPlatformConfig('threads');
  const clientId =
    cfg.appId ||
    process.env.VITE_THREADS_APP_ID ||
    process.env.VITE_THREADS_CLIENT_ID ||
    process.env.VITE_INSTAGRAM_APP_ID ||
    '';
  const clientSecret =
    cfg.appSecret ||
    process.env.THREADS_APP_SECRET ||
    process.env.VITE_THREADS_APP_SECRET ||
    process.env.INSTAGRAM_APP_SECRET ||
    '';
  const redirectUri = resolveOAuthRedirectUri('threads', cfg.redirectUri || process.env.VITE_THREADS_REDIRECT_URI);

  if (!clientId || !clientSecret || !redirectUri) {
    throw new Error('Threads credentials not configured');
  }

  const tokenBody = new URLSearchParams({
    client_id: clientId,
    client_secret: clientSecret,
    grant_type: 'authorization_code',
    redirect_uri: redirectUri,
    code,
  });
  const tokenRes = await axios.post('https://graph.threads.net/oauth/access_token', tokenBody.toString(), {
    headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' },
    validateStatus: () => true,
    timeout: 15000,
  });

  if (tokenRes.status >= 400) {
    throw new Error(`Threads token exchange failed (${tokenRes.status})`);
  }

  const tokenData: any = tokenRes.data || {};
  const shortLived = String(tokenData?.access_token || '').trim();
  if (!shortLived) return tokenData;

  let finalTokenData: any = tokenData;

  // Best-effort: exchange short-lived token for long-lived token.
  try {
    const longRes = await axios.get('https://graph.threads.net/access_token', {
      params: {
        grant_type: 'th_exchange_token',
        client_secret: clientSecret,
        access_token: shortLived,
      },
      headers: { Authorization: `Bearer ${shortLived}` },
      validateStatus: () => true,
      timeout: 15000,
    });

    if (longRes.status < 400 && (longRes.data as any)?.access_token) {
      finalTokenData = {
        ...(tokenData || {}),
        ...(longRes.data || {}),
        short_lived_access_token: shortLived,
        access_token: String((longRes.data as any).access_token || '').trim() || shortLived,
      };
    }
  } catch {
    // ignore - keep short-lived token if exchange fails
    finalTokenData = tokenData;
  }

  // Best-effort enrichment: store id/username/picture/bio so the integration UI and analytics are nicer.
  const accessToken = String(finalTokenData?.access_token || '').trim();
  if (accessToken) {
    try {
      const meResp = await axios.get('https://graph.threads.net/v1.0/me', {
        params: {
          fields: 'id,username,name,is_verified,threads_profile_picture_url,threads_biography',
          access_token: accessToken,
        },
        validateStatus: () => true,
        timeout: 15000,
      });
      if (meResp.status < 400) {
        const me: any = meResp.data || {};
        const meId = me?.id ? String(me.id).trim() : '';
        if (meId) {
          finalTokenData.user_id = meId;
          finalTokenData.id = meId;
          finalTokenData.sub = meId;
        }
        if (me?.username) finalTokenData.username = String(me.username);
        if (me?.name) finalTokenData.name = String(me.name);
        if (me?.is_verified !== undefined) finalTokenData.is_verified = Boolean(me.is_verified);
        if (me?.threads_profile_picture_url) finalTokenData.avatar_url = String(me.threads_profile_picture_url);
        if (me?.threads_biography) finalTokenData.about = String(me.threads_biography);
      }
    } catch {
      // ignore — token is still valid even if enrichment fails
    }
  }

  return finalTokenData;
}

async function exchangeTikTokCode(code: string, codeVerifier?: string) {
  const cfg = await getPlatformConfig('tiktok');
  const clientKey = (cfg.clientKey || process.env.VITE_TIKTOK_CLIENT_ID || '').trim();
  const clientSecret = (cfg.clientSecret || process.env.TIKTOK_CLIENT_SECRET || '').trim();
  const redirectUri = resolveOAuthRedirectUri('tiktok', cfg.redirectUri || process.env.VITE_TIKTOK_REDIRECT_URI);

  const data = new URLSearchParams({
    client_key: clientKey,
    client_secret: clientSecret,
    code,
    grant_type: 'authorization_code',
    redirect_uri: redirectUri,
  });
  if (codeVerifier) data.set('code_verifier', codeVerifier);
  const response = await axios.post('https://open.tiktokapis.com/v2/oauth/token/', data.toString(), {
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    validateStatus: () => true,
    timeout: 15000,
  });
  if (response.status >= 400) {
    const errBody: any = response.data || {};
    const detail = errBody?.error_description || errBody?.error || '';
    throw new Error(`TikTok token exchange failed (${response.status})${detail ? `: ${detail}` : ''}`);
  }
  const tokenData: any = response.data || {};

  // Enrich with user profile — TikTok returns open_id which we use as user identity
  const accessToken = String(tokenData?.access_token || '').trim();
  const openId = String(tokenData?.open_id || '').trim();
  if (accessToken) {
    try {
      const userResp = await axios.get('https://open.tiktokapis.com/v2/user/info/', {
        params: { fields: 'open_id,union_id,avatar_url,display_name,username' },
        headers: { Authorization: `Bearer ${accessToken}` },
        validateStatus: () => true,
        timeout: 10000,
      });
      const u: any = userResp.data?.data?.user || {};
      // If scope error or empty response, try with minimal fields (always permitted)
      let finalUser = u;
      if (userResp.status >= 400 || (!u.display_name && !u.open_id)) {
        const fallbackResp = await axios.get('https://open.tiktokapis.com/v2/user/info/', {
          params: { fields: 'open_id,display_name' },
          headers: { Authorization: `Bearer ${accessToken}` },
          validateStatus: () => true,
          timeout: 10000,
        });
        finalUser = fallbackResp.data?.data?.user || u;
      }
      if (finalUser.open_id) tokenData.user_id = finalUser.open_id;
      if (finalUser.display_name) tokenData.name = finalUser.display_name;
      if (finalUser.username) tokenData.username = finalUser.username;
      if (finalUser.avatar_url) tokenData.avatar_url = finalUser.avatar_url;
    } catch {
      // best-effort enrichment
    }
  }
  // Always store open_id as user_id so storeUserConnection can use it as account_id
  if (openId && !tokenData.user_id) tokenData.user_id = openId;

  return tokenData;
}

// Database/Storage Functions
async function getStoredState(state: string): Promise<boolean> {
  if (!hasDatabase()) return true;
  const result = await dbQuery('SELECT 1 FROM oauth_states WHERE state = $1 AND expires_at > NOW()', [state]);
  return result.rowCount > 0;
}

async function storeUserConnection(userId: string, platform: string, tokenData: any): Promise<void> {
  if (!pool) {
    console.warn('DATABASE_URL not set; cannot persist social connection');
    return;
  }

  const platformId = normalizePlatformId(platform);
  const accessTokenRaw = String(tokenData?.access_token ?? tokenData?.accessToken ?? '').trim();
  const refreshTokenRaw = String(tokenData?.refresh_token ?? tokenData?.refreshToken ?? '').trim();
  let normalizedTokenData = tokenData && typeof tokenData === 'object' ? { ...tokenData } : {};

  let accountId = String(normalizedTokenData?.user_id || normalizedTokenData?.id || '').trim() || null;
  let accountName = normalizedTokenData?.name ? String(normalizedTokenData.name) : null;
  let profileImage = normalizedTokenData?.avatar_url ? String(normalizedTokenData.avatar_url) : null;

  if (platformId === 'twitter' && accessTokenRaw && (!accountId || !accountName || !profileImage)) {
    try {
      const meResp = await axios.get(X_USERS_ME_API, {
        params: { 'user.fields': 'id,name,username,profile_image_url,description,public_metrics' },
        headers: { Authorization: `Bearer ${accessTokenRaw}` },
        validateStatus: () => true,
        timeout: 10000,
      });
      if (meResp.status < 400) {
        const meData: any = meResp.data?.data || {};
        accountId = String(meData?.id || accountId || '').trim() || accountId;
        accountName = meData?.name ? String(meData.name) : accountName;
        profileImage = meData?.profile_image_url ? String(meData.profile_image_url) : profileImage;
        normalizedTokenData = {
          ...normalizedTokenData,
          ...(accountId ? { user_id: accountId, id: accountId, sub: accountId } : {}),
          ...(accountName ? { name: accountName } : {}),
          ...(meData?.username ? { username: String(meData.username) } : {}),
          ...(profileImage ? { avatar_url: profileImage } : {}),
          ...(meData?.description ? { bio: String(meData.description) } : {}),
          ...(meData?.public_metrics?.followers_count != null
            ? { followers_count: Number(meData.public_metrics.followers_count) }
            : {}),
        };
      }
    } catch {
      // Best-effort enrichment only; posting can still proceed with the token alone.
    }
  }

  const handle =
    normalizedTokenData?.username || accountId || normalizedTokenData?.handle || `${platformId}_account`;
  const followers = Number(normalizedTokenData?.followers || normalizedTokenData?.followers_count || 0);
  const expiresAt =
    (platformId === 'linkedin' && String(normalizedTokenData?.access_token_expires_at || '').trim()) ||
    (normalizedTokenData?.expires_in
      ? new Date(Date.now() + Number(normalizedTokenData.expires_in) * 1000).toISOString()
      : null);
  const tokenExpiresAt = expiresAt;

  const platRow = await dbQuery<{ id: number }>('SELECT id FROM social_platforms WHERE slug=$1', [platformId]).catch(() => ({ rows: [] } as any));
  const platformDbId = platRow?.rows?.[0]?.id ?? null;
  const accessTokenEncrypted = accessTokenRaw ? encryptIntegrationSecret(accessTokenRaw) : null;
  const refreshTokenEncrypted = refreshTokenRaw ? encryptIntegrationSecret(refreshTokenRaw) : null;

  // Detect first-time connection before the upsert
  const existingConn = await dbQuery(
    `SELECT id FROM social_accounts WHERE user_id = $1 AND platform = $2 AND account_type = 'profile'`,
    [userId, platformId],
  ).catch(() => ({ rows: [] } as any));
  const isFirstConnect = (existingConn?.rows?.length ?? 0) === 0;

  await dbQuery(
    `
    INSERT INTO social_accounts
      (id, user_id, platform, platform_id, account_type, account_id, account_name, profile_image, handle, followers, connected, connected_at, expires_at, token_expires_at, access_token, refresh_token, access_token_encrypted, refresh_token_encrypted, token_data, needs_reapproval)
    VALUES ($1, $2, $3, $4, 'profile', $5, $6, $7, $8, $9, true, NOW(), $10, $11, $12, $13, $14, $15, $16, false)
    ON CONFLICT (user_id, platform) WHERE account_type = 'profile' DO UPDATE
      SET platform_id = EXCLUDED.platform_id,
          account_id = COALESCE(EXCLUDED.account_id, social_accounts.account_id),
          account_name = COALESCE(EXCLUDED.account_name, social_accounts.account_name),
          profile_image = COALESCE(EXCLUDED.profile_image, social_accounts.profile_image),
          handle = COALESCE(NULLIF(EXCLUDED.handle, ''), social_accounts.handle),
          followers = EXCLUDED.followers,
          connected = true,
          connected_at = NOW(),
          expires_at = EXCLUDED.expires_at,
          token_expires_at = EXCLUDED.token_expires_at,
          access_token = EXCLUDED.access_token,
          refresh_token = EXCLUDED.refresh_token,
          access_token_encrypted = EXCLUDED.access_token_encrypted,
          refresh_token_encrypted = EXCLUDED.refresh_token_encrypted,
          needs_reapproval = false,
          token_data = EXCLUDED.token_data;
  `,
    [
      randomUUID(),
      userId,
      platformId,
      platformDbId,
      accountId,
      accountName,
      profileImage,
      String(handle),
      followers,
      expiresAt,
      tokenExpiresAt,
      null,
      null,
      accessTokenEncrypted,
      refreshTokenEncrypted,
      normalizedTokenData || {},
    ]
  );

  await upsertUserIntegration({
    userId,
    integrationSlug: platformId,
    accessTokenEncrypted,
    refreshTokenEncrypted,
    tokenExpiry: expiresAt,
    accountId,
    accountName,
    status: 'connected',
  });

  await logIntegrationEvent({
    userId,
    integrationSlug: platformId,
    eventType: 'connection_attempt',
    status: 'success',
    response: { platform: platformId, accountId, accountName },
  });

  const platformLabel = platformId.charAt(0).toUpperCase() + platformId.slice(1);
  if (isFirstConnect) {
    seedSocialMemory(userId, platformId, {
      handle: String(handle),
      accountName: accountName || null,
      followers: Number(normalizedTokenData?.followers_count ?? followers),
      bio: normalizedTokenData?.bio ? String(normalizedTokenData.bio) : undefined,
    }).catch(() => undefined);
    createNotification(userId, 'social_connected',
      `${platformLabel} connected`,
      `Your ${platformLabel} account (@${handle}) has been connected successfully.`,
      { platform: platformId, handle: String(handle) },
    ).catch(() => undefined);
  } else {
    createNotification(userId, 'social_reconnected',
      `${platformLabel} reconnected`,
      `Your ${platformLabel} account (@${handle}) token has been refreshed.`,
      { platform: platformId, handle: String(handle) },
    ).catch(() => undefined);
  }
}

async function seedSocialMemory(
  userId: string,
  platform: string,
  profile: { handle: string; accountName: string | null; followers: number; bio?: string },
): Promise<void> {
  const platformLabel = platform.charAt(0).toUpperCase() + platform.slice(1);
  const handleDisplay = profile.handle && !profile.handle.includes('_account')
    ? `@${profile.handle}` : profile.accountName || platform;

  let content = '';
  try {
    const cfg = await getAIConfig();
    const apiKey = resolveActiveKey(cfg);
    if (apiKey) {
      const fastModel = cfg.provider === 'google'
        ? (GEMINI_MODELS.includes(cfg.model) ? cfg.model : 'gemini-2.0-flash')
        : 'claude-haiku-4-5-20251001';
      content = await callAINonStreaming(
        cfg.provider, apiKey, fastModel,
        'You write concise memory entries for a marketing AI assistant. Be factual and useful. 2-3 sentences max.',
        `Write a memory entry about this user's newly connected social account:\n\nPlatform: ${platformLabel}\nHandle: ${handleDisplay}\nDisplay name: ${profile.accountName || ''}\nFollowers: ${profile.followers}\n${profile.bio ? `Bio: "${profile.bio}"` : 'No bio available.'}\n\nInclude the platform, handle, audience size, and a note about what this means for their content strategy.`,
        200,
      );
    }
  } catch { /* fall through to plain text */ }

  if (!content) {
    content = `${platformLabel} account ${handleDisplay}${profile.accountName ? ` (${profile.accountName})` : ''} — ${profile.followers.toLocaleString()} followers.${profile.bio ? ` Bio: "${profile.bio}"` : ''}`;
  }

  try {
    const existing = await dbQuery(
      `SELECT id FROM user_memories WHERE user_id = $1 AND source = $2`,
      [userId, `social:${platform}`],
    );
    if (existing.rows.length > 0) {
      await dbQuery(
        `UPDATE user_memories SET title = $1, content = $2, updated_at = NOW() WHERE id = $3`,
        [`${platformLabel} social account`, content, existing.rows[0].id],
      );
    } else {
      await dbQuery(
        `INSERT INTO user_memories (user_id, category, title, content, source) VALUES ($1, $2, $3, $4, $5)`,
        [userId, 'social', `${platformLabel} social account`, content, `social:${platform}`],
      );
    }
    await triggerAgentCompilation(userId).catch(() => undefined);
  } catch (e) {
    console.error('seedSocialMemory DB error:', e);
  }
}

async function createNotification(
  userId: string,
  type: string,
  title: string,
  message: string,
  data: Record<string, any> = {},
  pinned = false,
): Promise<void> {
  if (!pool) return;
  try {
    await dbQuery(
      `INSERT INTO notifications (user_id, type, title, message, data, pinned) VALUES ($1,$2,$3,$4,$5,$6)`,
      [userId, type, title, message, data, pinned],
    );
  } catch (e) {
    console.error('createNotification error:', e);
  }
}

async function getEnabledPlatformSlugs(): Promise<string[]> {
  if (!pool) return [];
  const result = await dbQuery(`SELECT platform FROM platform_configs WHERE enabled = true`);
  return result.rows.map((row: any) => String(row.platform || '').toLowerCase()).filter(Boolean);
}

function isOAuthClientSecretRequired(platform: string): boolean {
  const slug = String(platform || '').trim().toLowerCase();
  return (
    slug === 'instagram' ||
    slug === 'facebook' ||
    slug === 'threads' ||
    slug === 'linkedin' ||
    slug === 'tiktok' ||
    slug === 'pinterest'
  );
}

async function getVisibleUserPlatformSlugs(): Promise<string[]> {
  if (!pool) return ['wordpress', 'mailchimp'];

  const result = await dbQuery(`SELECT platform, config, enabled FROM platform_configs`);
  const visible = new Set<string>(['wordpress', 'mailchimp']);

  for (const row of result.rows as any[]) {
    const slug = String(row.platform || '').toLowerCase();
    if (!slug) continue;
    const cfg = row.config || {};
    const meta = OAUTH_AUTH_URLS[slug];
    if (!meta) {
      if (Boolean(row.enabled) || Object.keys(cfg).length > 0) {
        visible.add(slug);
      }
      continue;
    }

    const clientId = String(cfg?.[meta.idField] || '').trim();
    const secretRequired = isOAuthClientSecretRequired(slug);
    const secretValue = String(cfg?.clientSecret || cfg?.appSecret || '').trim();
    const configured = Boolean(clientId && (!secretRequired || secretValue));
    if ((Boolean(row.enabled) || configured) && configured) {
      visible.add(slug);
    }
  }

  return Array.from(visible);
}

function formatSocialAccountLabel(
  platform: string,
  accountType?: string | null,
  accountName?: string | null,
  accountId?: string | null,
) {
  const platformId = normalizePlatformId(platform);
  const type = String(accountType || '').trim().toLowerCase();
  const name = String(accountName || '').trim();
  const id = String(accountId || '').trim();

  if (platformId === 'facebook') {
    if (type === 'group') return name ? `Group: ${name}` : (id ? `Group: ${id}` : null);
    if (type === 'page') return name ? `Page: ${name}` : (id ? `Page: ${id}` : null);
    return 'Profile';
  }

  if (platformId === 'linkedin') {
    if (type === 'page') return name ? `Page: ${name}` : (id ? `Page: ${id}` : 'LinkedIn Page');
    return name ? `Profile: ${name}` : 'Profile';
  }

  if (platformId === 'pinterest') {
    if (type === 'board') return name ? `Board: ${name}` : (id ? `Board: ${id}` : 'Board');
    return name ? `Profile: ${name}` : 'Profile';
  }

  if (platformId === 'wordpress') {
    return name ? `Site: ${name}` : 'WordPress';
  }

  if (type === 'profile' || !type) {
    return name ? `Profile: ${name}` : 'Profile';
  }

  return name ? `${type}: ${name}` : (id ? `${type}: ${id}` : type || null);
}

async function getUserConnectedAccounts(userId: string): Promise<any[]> {
  if (!pool) return [];

  const visiblePlatforms = await getVisibleUserPlatformSlugs();

  let query = `
    SELECT
      id,
      user_id AS "userId",
      platform,
      handle,
      account_name AS "accountName",
      followers::text AS followers,
      connected,
      connected_at AS "connectedAt",
      expires_at AS "expiresAt",
      token_data AS "token_data"
    FROM social_accounts
    WHERE user_id = $1`;
  const params: any[] = [userId];

  if (visiblePlatforms.length > 0) {
    query += ` AND LOWER(platform) = ANY($2)`;
    params.push(visiblePlatforms);
  }

  query += ` ORDER BY platform;`;
  
  const result = await dbQuery(query, params);
  return result.rows;
}

async function removeUserConnection(userId: string, platform: string): Promise<void> {
  if (!pool) return;
  // Platform values are stored in display-case (e.g. "Twitter") but callers may send lowercase (e.g. "twitter").
  await dbQuery('DELETE FROM social_accounts WHERE user_id = $1 AND LOWER(platform) = LOWER($2)', [userId, platform]);

  const platformId = normalizePlatformId(platform);
  if (platformId) {
    await upsertUserIntegration({
      userId,
      integrationSlug: platformId,
      accessTokenEncrypted: null,
      refreshTokenEncrypted: null,
      tokenExpiry: null,
      accountId: null,
      accountName: null,
      status: 'disconnected',
    });
    await logIntegrationEvent({
      userId,
      integrationSlug: platformId,
      eventType: 'disconnect',
      status: 'info',
      response: {},
    });
  }
}

async function testPlatformConnection(userId: string, platform: string): Promise<any> {
  // Implement testing connection
  return { status: 'ok', platform, userId };
}

async function publishToPlatform(userId: string, platform: string, content: any): Promise<any> {
  // Implement publishing to platform
  return { postId: 'test', platform, userId, content };
}

async function getPlatformAnalytics(userId: string, platform: string): Promise<any> {
  // Implement fetching analytics
  return null;
}

function resolveRedirectUri(uri: string | undefined): string {
  if (!uri) return '';
  if (uri.startsWith('http://') || uri.startsWith('https://')) return uri;
  const appUrl = process.env.VITE_APP_URL || 'http://localhost:3000';
  return `${appUrl}${uri}`;
}

function getBackendPublicUrl(req?: Request): string {
  const fromEnv = String(
    process.env.BACKEND_PUBLIC_URL ||
    process.env.PUBLIC_API_URL ||
    process.env.API_PUBLIC_URL ||
    process.env.VITE_API_BASE_URL ||
    ''
  ).trim();
  if (fromEnv) return fromEnv.replace(/\/$/, '');

  if (!req) return '';
  const protoHeader = String(req.headers['x-forwarded-proto'] || '').split(',')[0].trim();
  const proto = protoHeader || req.protocol || 'http';
  const hostHeader = String(req.headers['x-forwarded-host'] || req.get('host') || '').split(',')[0].trim();
  return hostHeader ? `${proto}://${hostHeader}` : '';
}

function resolveBackendRedirectUri(uri: string | undefined, req?: Request): string {
  const raw = String(uri || '').trim();
  if (!raw) return '';
  if (raw.startsWith('http://') || raw.startsWith('https://')) return raw;
  const base = getBackendPublicUrl(req);
  if (!base) return raw.startsWith('/') ? raw : `/${raw}`;
  return raw.startsWith('/') ? `${base}${raw}` : `${base}/${raw}`;
}

// --- Integrations: encryption + logs ---
function encryptIntegrationSecret(plain: string): string {
  const iv = randomBytes(16);
  const cipher = createCipheriv('aes-256-gcm', INTEGRATIONS_ENCRYPTION_KEY, iv);
  const enc = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
  const authTag = cipher.getAuthTag();
  return Buffer.concat([iv, authTag, enc]).toString('base64');
}

function decryptIntegrationSecret(encrypted: string): string {
  const buf = Buffer.from(String(encrypted || ''), 'base64');
  const iv = buf.subarray(0, 16);
  const authTag = buf.subarray(16, 32);
  const data = buf.subarray(32);
  const decipher = createDecipheriv('aes-256-gcm', INTEGRATIONS_ENCRYPTION_KEY, iv);
  decipher.setAuthTag(authTag);
  return decipher.update(data).toString('utf8') + decipher.final('utf8');
}

async function getIntegrationRowBySlug(slug: string): Promise<{ id: number; slug: string; name: string | null; type: string | null } | null> {
  if (!pool) return null;
  const s = String(slug || '').trim().toLowerCase();
  if (!s) return null;
  const result = await dbQuery<{ id: number; slug: string; name: string | null; type: string | null }>(
    `SELECT id, slug, name, type FROM integrations WHERE slug = $1 LIMIT 1`,
    [s]
  ).catch(() => ({ rows: [] } as any));
  return result.rows[0] ?? null;
}

async function logIntegrationEvent(params: {
  userId: string | null;
  integrationSlug: string | null;
  eventType: string;
  status: 'success' | 'failed' | 'info';
  response?: any;
}) {
  if (!pool) return;
  const integration = params.integrationSlug ? await getIntegrationRowBySlug(params.integrationSlug) : null;
  await dbQuery(
    `INSERT INTO integration_logs (id, user_id, integration_id, event_type, status, response, created_at)
     VALUES ($1, $2, $3, $4, $5, $6::jsonb, NOW())`,
    [
      randomUUID(),
      params.userId,
      integration?.id ?? null,
      String(params.eventType || '').slice(0, 80),
      params.status,
      JSON.stringify(params.response ?? {}),
    ]
  ).catch(() => undefined);
}

async function upsertUserIntegration(params: {
  userId: string;
  integrationSlug: string;
  accessTokenEncrypted?: string | null;
  refreshTokenEncrypted?: string | null;
  tokenExpiry?: string | null;
  accountId?: string | null;
  accountName?: string | null;
  status: 'connected' | 'disconnected' | 'error';
}) {
  if (!pool) return;
  const integration = await getIntegrationRowBySlug(params.integrationSlug);
  if (!integration) return;
  await dbQuery(
    `INSERT INTO user_integrations
      (id, user_id, integration_id, access_token, refresh_token, token_expiry, account_id, account_name, status, created_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,NOW())
     ON CONFLICT (user_id, integration_id) DO UPDATE
       SET access_token = EXCLUDED.access_token,
           refresh_token = EXCLUDED.refresh_token,
           token_expiry = EXCLUDED.token_expiry,
           account_id = EXCLUDED.account_id,
           account_name = EXCLUDED.account_name,
           status = EXCLUDED.status`,
    [
      randomUUID(),
      params.userId,
      integration.id,
      params.accessTokenEncrypted ?? null,
      params.refreshTokenEncrypted ?? null,
      params.tokenExpiry ?? null,
      params.accountId ?? null,
      params.accountName ?? null,
      params.status,
    ]
  ).catch(() => undefined);
}

// --- WordPress: encryption and storage (credentials never logged) ---
function encryptWordPressPassword(plain: string): string {
  const iv = randomBytes(16);
  const cipher = createCipheriv('aes-256-gcm', WORDPRESS_ENCRYPTION_KEY, iv);
  const enc = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
  const authTag = cipher.getAuthTag();
  return Buffer.concat([iv, authTag, enc]).toString('base64');
}

function decryptWordPressPassword(encrypted: string): string {
  const buf = Buffer.from(encrypted, 'base64');
  const iv = buf.subarray(0, 16);
  const authTag = buf.subarray(16, 32);
  const data = buf.subarray(32);
  const decipher = createDecipheriv('aes-256-gcm', WORDPRESS_ENCRYPTION_KEY, iv);
  decipher.setAuthTag(authTag);
  return decipher.update(data).toString('utf8') + decipher.final('utf8');
}

function normalizeWordPressSiteUrl(url: string): string {
  const u = url.trim().replace(/\/+$/, '');
  return u.startsWith('http') ? u : `https://${u}`;
}

interface WordPressConnection {
  id: string;
  userId: string;
  siteUrl: string;
  username: string;
  appPasswordEncrypted: string;
}

async function getWordPressConnection(userId: string): Promise<WordPressConnection | null> {
  if (!pool) return null;
  const result = await dbQuery<{
    id: string;
    user_id: string;
    site_url: string;
    username: string;
    app_password_encrypted: string;
  }>('SELECT id, user_id, site_url, username, app_password_encrypted FROM wordpress_connections WHERE user_id = $1', [
    userId,
  ]);
  const row = result.rows[0];
  if (!row) return null;
  return {
    id: row.id,
    userId: row.user_id,
    siteUrl: row.site_url,
    username: row.username,
    appPasswordEncrypted: row.app_password_encrypted,
  };
}

// --- Make webhook connection (store webhook URL encrypted; never log URL) ---
async function getMakeWebhookConnection(userId: string): Promise<{ webhookUrlEncrypted: string } | null> {
  if (!pool) return null;
  const result = await dbQuery<{ webhook_url_encrypted: string }>(
    'SELECT webhook_url_encrypted FROM make_webhook_connections WHERE user_id = $1',
    [userId]
  );
  const row = result.rows[0];
  return row ? { webhookUrlEncrypted: row.webhook_url_encrypted } : null;
}

async function ensureWordPressSocialAccount(userId: string) {
  if (!pool) return;
  const conn = await getWordPressConnection(userId);
  const webhookConn = await getMakeWebhookConnection(userId);
  if (!conn && !webhookConn) return;

  const accountId = conn?.siteUrl ? String(conn.siteUrl).trim() : 'wordpress';
  const accountName = conn?.username ? String(conn.username).trim() : 'WordPress';

  const updateRes = await dbQuery(
    `UPDATE social_accounts
     SET account_name = $3,
         connected = true,
         connected_at = NOW()
     WHERE user_id = $1 AND platform = 'wordpress' AND account_type = 'site' AND account_id = $2`,
    [userId, accountId, accountName]
  );
  if (updateRes.rowCount === 0) {
    await dbQuery(
      `INSERT INTO social_accounts (id, user_id, platform, platform_id, account_type, account_id, account_name, connected, connected_at, created_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,true,NOW(),NOW())`,
      [randomUUID(), userId, 'wordpress', null, 'site', accountId, accountName]
    );
  }
}

async function removeWordPressSocialAccount(userId: string) {
  if (!pool) return;
  await dbQuery('DELETE FROM social_accounts WHERE user_id = $1 AND platform = $2', [userId, 'wordpress']);
}

function isValidWebhookUrl(url: string): boolean {
  const u = url.trim();
  return u.startsWith('https://') || u.startsWith('http://');
}

async function wpRequest(
  siteUrl: string,
  username: string,
  appPassword: string,
  method: string,
  path: string,
  options: { data?: any; formData?: FormData; responseType?: 'json' } = {}
): Promise<{ data?: any; status: number; error?: string }> {
  const base = normalizeWordPressSiteUrl(siteUrl);
  const url = `${base.replace(/\/+$/, '')}/wp-json${path.startsWith('/') ? path : `/${path}`}`;
  const auth = Buffer.from(`${username}:${appPassword}`, 'utf8').toString('base64');
  const headers: Record<string, string> = {
    Authorization: `Basic ${auth}`,
  };
  if (options.formData) {
    // Let axios set Content-Type for FormData
    try {
      const res = await axios.request({
        method,
        url,
        data: options.formData,
        headers: { ...headers, ...(options.formData.getHeaders?.() || {}) },
        maxRedirects: 2,
        validateStatus: () => true,
        maxBodyLength: Infinity,
        maxContentLength: Infinity,
      });
      return { data: res.data, status: res.status, error: res.status >= 400 ? (res.data?.message || res.statusText) : undefined };
    } catch (err: any) {
      const msg = err?.response?.data?.message || err?.message || 'Request failed';
      return { status: err?.response?.status || 500, error: msg };
    }
  }
  if (options.data !== undefined) headers['Content-Type'] = 'application/json';
  try {
    const res = await axios.request({
      method,
      url,
      data: options.data,
      headers,
      maxRedirects: 2,
      validateStatus: () => true,
    });
    const error = res.status >= 400 ? (res.data?.message || res.data?.code || res.statusText) : undefined;
    return { data: res.data, status: res.status, error };
  } catch (err: any) {
    const msg = err?.response?.data?.message || err?.message || 'Request failed';
    return { status: err?.response?.status || 500, error: msg };
  }
}

// POST /api/wordpress/connect 뿯붿?validate and store connection (tries Application Password first, then login password)
app.post('/api/wordpress/connect', async (req: Request, res: Response) => {
  try {
    const auth = requireAuth(req, res);
    if (!auth) return;

    const { siteUrl, username, applicationPassword, password } = req.body;
    if (!siteUrl || !username) {
      return res.status(400).json({ success: false, error: 'WordPress Site URL and Username are required' });
    }
    const hasAppPassword = applicationPassword && String(applicationPassword).trim();
    const hasLoginPassword = password && String(password).trim();
    if (!hasAppPassword && !hasLoginPassword) {
      return res.status(400).json({
        success: false,
        error: 'Provide either your WordPress login password or an Application Password (Users 뿯붿?Profile 뿯붿?Application Passwords).',
      });
    }

    const site = normalizeWordPressSiteUrl(siteUrl);
    let credentialToStore: string | undefined;
    let lastError: string | undefined;
    let lastStatus: number | undefined;

    // Try Application Password first (recommended)
    if (hasAppPassword) {
      const res = await wpRequest(site, username, String(applicationPassword).trim(), 'GET', '/wp/v2/users/me');
      lastStatus = res.status;
      if (res.status === 200 && res.data?.id) {
        credentialToStore = String(applicationPassword).trim();
      } else {
        lastError = res.error;
      }
    }

    // If Application Password failed or not provided, try login password (works with many hosts/plugins)
    if (credentialToStore === undefined && hasLoginPassword) {
      const res = await wpRequest(site, username, String(password).trim(), 'GET', '/wp/v2/users/me');
      lastStatus = res.status;
      if (res.status === 200 && res.data?.id) {
        credentialToStore = String(password).trim();
      } else {
        lastError = lastError || res.error;
      }
    }

    if (typeof credentialToStore === 'undefined') {
      const err = lastError ? String(lastError).toLowerCase() : '';
      const isNotFound = lastStatus === 404 || err.includes('not found');
      const isNotLoggedIn = err.includes('not currently logged in') || err.includes('not logged in') || err.includes('rest_forbidden');
      const urlHint = 'Use the full site URL only (e.g. https://yoursite.com), no trailing slash. If WordPress is in a subfolder use https://yoursite.com/folder.';
      let message: string;
      if (isNotFound) {
        message = `Site not found. ${urlHint}`;
      } else if (isNotLoggedIn) {
        message = 'WordPress REST API requires an Application Password, not your normal login password. In your WordPress admin go to Users 뿯붿?your profile 뿯붿?Application Passwords, create a new one, and paste it in the "Application Password" field above. Some hosts disable this; if you don’t see it, check your host’s docs or use a plugin that enables REST API auth.';
      } else {
        message = lastError || 'WordPress authentication failed. Try an Application Password (Users 뿯붿?Profile 뿯붿?Application Passwords).';
      }
      return res.status(400).json({ success: false, error: message });
    }

    if (!pool) {
      return res.status(503).json({ success: false, error: 'Database not configured' });
    }

    const encrypted = encryptWordPressPassword(credentialToStore);
    const id = randomUUID();
    await dbQuery(
      `INSERT INTO wordpress_connections (id, user_id, site_url, username, app_password_encrypted)
       VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (user_id) DO UPDATE
         SET site_url = EXCLUDED.site_url, username = EXCLUDED.username, app_password_encrypted = EXCLUDED.app_password_encrypted`,
      [id, auth.userId, site, username, encrypted]
    );

    await upsertUserIntegration({
      userId: auth.userId,
      integrationSlug: 'wordpress',
      accessTokenEncrypted: null,
      refreshTokenEncrypted: null,
      tokenExpiry: null,
      accountId: site,
      accountName: String(username || '').trim() || null,
      status: 'connected',
    });
    await logIntegrationEvent({
      userId: auth.userId,
      integrationSlug: 'wordpress',
      eventType: 'connection_attempt',
      status: 'success',
      response: { siteUrl: site },
    });

    await ensureWordPressSocialAccount(auth.userId);

    return res.json({ success: true, message: 'WordPress Connected Successfully' });
  } catch (err) {
    if (err instanceof Error && !err.message.includes('password')) {
      console.error('WordPress connect error:', err.message);
    }
    await logIntegrationEvent({
      userId: null,
      integrationSlug: 'wordpress',
      eventType: 'connection_attempt',
      status: 'failed',
      response: { error: err instanceof Error ? err.message : 'Connection failed' },
    });
    return res.status(500).json({ success: false, error: 'Connection failed' });
  }
});

// GET /api/wordpress/status (checks Make webhook first, then direct WordPress API)
app.get('/api/wordpress/status', async (req: Request, res: Response) => {
  try {
    const auth = requireAuth(req, res);
    if (!auth) return;

    const webhookConn = await getMakeWebhookConnection(auth.userId);
    if (webhookConn) {
      return res.json({ success: true, connected: true, connectionType: 'make_webhook' });
    }
    const conn = await getWordPressConnection(auth.userId);
    if (!conn) {
      return res.json({ success: true, connected: false });
    }
    return res.json({ success: true, connected: true, connectionType: 'wordpress_api', siteUrl: conn.siteUrl });
  } catch (err) {
    console.error('WordPress status error:', err);
    return res.status(500).json({ success: false, error: 'Failed to get status' });
  }
});

// DELETE /api/wordpress/disconnect (removes both Make webhook and direct API connection)
app.delete('/api/wordpress/disconnect', async (req: Request, res: Response) => {
  try {
    const auth = requireAuth(req, res);
    if (!auth) return;

    if (!pool) {
      return res.json({ success: true });
    }
    await dbQuery('DELETE FROM make_webhook_connections WHERE user_id = $1', [auth.userId]);
    await dbQuery('DELETE FROM wordpress_connections WHERE user_id = $1', [auth.userId]);
    await removeWordPressSocialAccount(auth.userId);

    await upsertUserIntegration({
      userId: auth.userId,
      integrationSlug: 'wordpress',
      accessTokenEncrypted: null,
      refreshTokenEncrypted: null,
      tokenExpiry: null,
      accountId: null,
      accountName: null,
      status: 'disconnected',
    });
    await logIntegrationEvent({
      userId: auth.userId,
      integrationSlug: 'wordpress',
      eventType: 'disconnect',
      status: 'info',
      response: {},
    });

    return res.json({ success: true });
  } catch (err) {
    console.error('WordPress disconnect error:', err);
    return res.status(500).json({ success: false, error: 'Failed to disconnect' });
  }
});

// POST /api/wordpress/connect-webhook 뿯붿?validate and store Make webhook URL
const MAKE_TEST_PAYLOAD = {
  title: 'Connection Test',
  content: 'This is a test post from the web app.',
  status: 'draft',
};

app.post('/api/wordpress/connect-webhook', async (req: Request, res: Response) => {
  try {
    const auth = requireAuth(req, res);
    if (!auth) return;

    const { webhookUrl } = req.body;
    const url = typeof webhookUrl === 'string' ? webhookUrl.trim() : '';
    if (!url || !isValidWebhookUrl(url)) {
      return res.status(400).json({ success: false, error: 'A valid webhook URL (https:// or http://) is required.' });
    }

    // Validate webhook by sending test request (do not log URL)
    let responseStatus: number;
    try {
      const axRes = await axios.post(url, MAKE_TEST_PAYLOAD, {
        headers: { 'Content-Type': 'application/json' },
        timeout: 15000,
        validateStatus: () => true,
      });
      responseStatus = axRes.status;
    } catch (err: any) {
      return res.status(400).json({
        success: false,
        error: err?.message || 'Webhook request failed. Check the URL and that your Make scenario is running.',
      });
    }

    if (responseStatus < 200 || responseStatus >= 300) {
      return res.status(400).json({
        success: false,
        error: 'Webhook did not respond successfully. Ensure your Make scenario is active and the webhook URL is correct.',
      });
    }

    if (!pool) {
      return res.status(503).json({ success: false, error: 'Database not configured' });
    }

    const encrypted = encryptWordPressPassword(url);
    const id = randomUUID();
    await dbQuery(
      `INSERT INTO make_webhook_connections (id, user_id, webhook_url_encrypted)
       VALUES ($1, $2, $3)
       ON CONFLICT (user_id) DO UPDATE SET webhook_url_encrypted = EXCLUDED.webhook_url_encrypted`,
      [id, auth.userId, encrypted]
    );

    await ensureWordPressSocialAccount(auth.userId);

    return res.json({ success: true, message: 'WordPress (Make) connected successfully' });
  } catch (err) {
    if (err instanceof Error && !err.message.includes('webhook')) {
      console.error('Connect webhook error:', err.message);
    }
    return res.status(500).json({ success: false, error: 'Connection failed' });
  }
});

// DELETE /api/wordpress/disconnect-webhook
app.delete('/api/wordpress/disconnect-webhook', async (req: Request, res: Response) => {
  try {
    const auth = requireAuth(req, res);
    if (!auth) return;
    if (pool) {
      await dbQuery('DELETE FROM make_webhook_connections WHERE user_id = $1', [auth.userId]);
      await removeWordPressSocialAccount(auth.userId);
    }
    return res.json({ success: true });
  } catch (err) {
    return res.status(500).json({ success: false, error: 'Failed to disconnect' });
  }
});

// POST /api/wordpress/publish-webhook 뿯붿?send payload to stored Make webhook
app.post('/api/wordpress/publish-webhook', async (req: Request, res: Response) => {
  try {
    const auth = requireAuth(req, res);
    if (!auth) return;

    const webhookConn = await getMakeWebhookConnection(auth.userId);
    if (!webhookConn) {
      return res.status(400).json({ success: false, error: 'WordPress (Make webhook) not connected' });
    }

    const webhookUrl = decryptWordPressPassword(webhookConn.webhookUrlEncrypted);
    const raw = req.body;

    const payload: Record<string, unknown> = {};
    if (typeof raw.title === 'string') payload.title = raw.title;
    if (typeof raw.content === 'string') payload.content = raw.content;
    if (typeof raw.excerpt === 'string') payload.excerpt = raw.excerpt;
    if (raw.status === 'draft' || raw.status === 'publish') payload.status = raw.status;
    if (typeof raw.featured_image === 'string') payload.featured_image = raw.featured_image;
    if (Array.isArray(raw.categories)) payload.categories = raw.categories.filter((c: unknown) => typeof c === 'string');
    if (Array.isArray(raw.tags)) payload.tags = raw.tags.filter((t: unknown) => typeof t === 'string');

    if (!payload.title && !payload.content) {
      return res.status(400).json({ success: false, error: 'Title or content is required' });
    }

    const axiosRes = await axios.post(webhookUrl, payload, {
      headers: { 'Content-Type': 'application/json' },
      timeout: 30000,
      validateStatus: () => true,
    });

    if (axiosRes.status < 200 || axiosRes.status >= 300) {
      return res.status(502).json({
        success: false,
        error: 'Failed to publish to WordPress. Make scenario may have failed.',
      });
    }

    return res.json({ success: true, message: 'Post sent to WordPress successfully.' });
  } catch (err) {
    if (err instanceof Error && !err.message.includes('webhook')) {
      console.error('Publish webhook error:', err.message);
    }
    return res.status(500).json({ success: false, error: 'Failed to publish to WordPress.' });
  }
});

// GET /api/wordpress/categories
app.get('/api/wordpress/categories', async (req: Request, res: Response) => {
  try {
    const auth = requireAuth(req, res);
    if (!auth) return;

    const conn = await getWordPressConnection(auth.userId);
    if (!conn) {
      return res.status(400).json({ success: false, error: 'WordPress not connected' });
    }
    const appPassword = decryptWordPressPassword(conn.appPasswordEncrypted);
    const { data, status, error } = await wpRequest(conn.siteUrl, conn.username, appPassword, 'GET', '/wp/v2/categories?per_page=100');
    if (status !== 200) {
      return res.status(400).json({ success: false, error: error || 'Failed to fetch categories' });
    }
    return res.json({ success: true, data: Array.isArray(data) ? data : [] });
  } catch (err) {
    if (err instanceof Error && !err.message.includes('password')) {
      console.error('WordPress categories error:', err.message);
    }
    return res.status(500).json({ success: false, error: 'Failed to fetch categories' });
  }
});

// GET /api/wordpress/tags
app.get('/api/wordpress/tags', async (req: Request, res: Response) => {
  try {
    const auth = requireAuth(req, res);
    if (!auth) return;

    const conn = await getWordPressConnection(auth.userId);
    if (!conn) {
      return res.status(400).json({ success: false, error: 'WordPress not connected' });
    }
    const appPassword = decryptWordPressPassword(conn.appPasswordEncrypted);
    const { data, status, error } = await wpRequest(conn.siteUrl, conn.username, appPassword, 'GET', '/wp/v2/tags?per_page=100');
    if (status !== 200) {
      return res.status(400).json({ success: false, error: error || 'Failed to fetch tags' });
    }
    return res.json({ success: true, data: Array.isArray(data) ? data : [] });
  } catch (err) {
    if (err instanceof Error && !err.message.includes('password')) {
      console.error('WordPress tags error:', err.message);
    }
    return res.status(500).json({ success: false, error: 'Failed to fetch tags' });
  }
});

// POST /api/wordpress/publish 뿯붿?create post (optionally upload featured image, set meta)
// GET /api/wordpress/posts — import/list posts from WordPress
app.get('/api/wordpress/posts', async (req: Request, res: Response) => {
  try {
    const auth = requireAuth(req, res);
    if (!auth) return;

    const conn = await getWordPressConnection(auth.userId);
    if (!conn) return res.status(400).json({ success: false, error: 'WordPress not connected' });

    const page = Math.max(1, Number((req.query as any).page || 1));
    const perPage = Math.min(100, Math.max(1, Number((req.query as any).per_page || 20)));
    const status = String((req.query as any).status || '').trim();

    const appPassword = decryptWordPressPassword(conn.appPasswordEncrypted);
    const path = `/wp/v2/posts?per_page=${perPage}&page=${page}${status ? `&status=${encodeURIComponent(status)}` : ''}`;
    const { data, status: s, error } = await wpRequest(conn.siteUrl, conn.username, appPassword, 'GET', path);
    if (s !== 200) return res.status(400).json({ success: false, error: error || 'Failed to fetch posts' });
    return res.json({ success: true, data: Array.isArray(data) ? data : [] });
  } catch (err) {
    console.error('WordPress list posts error:', err);
    return res.status(500).json({ success: false, error: 'Failed to fetch posts' });
  }
});

// GET /api/wordpress/posts/:id — fetch a single post
app.get('/api/wordpress/posts/:id', async (req: Request, res: Response) => {
  try {
    const auth = requireAuth(req, res);
    if (!auth) return;

    const conn = await getWordPressConnection(auth.userId);
    if (!conn) return res.status(400).json({ success: false, error: 'WordPress not connected' });

    const postId = String(req.params.id || '').trim();
    if (!/^[0-9]+$/.test(postId)) return res.status(400).json({ success: false, error: 'Invalid post id' });

    const appPassword = decryptWordPressPassword(conn.appPasswordEncrypted);
    const { data, status: s, error } = await wpRequest(conn.siteUrl, conn.username, appPassword, 'GET', `/wp/v2/posts/${postId}`);
    if (s !== 200) return res.status(400).json({ success: false, error: error || 'Failed to fetch post' });
    return res.json({ success: true, data });
  } catch (err) {
    console.error('WordPress get post error:', err);
    return res.status(500).json({ success: false, error: 'Failed to fetch post' });
  }
});

// PATCH /api/wordpress/posts/:id — update a post
app.patch('/api/wordpress/posts/:id', async (req: Request, res: Response) => {
  try {
    const auth = requireAuth(req, res);
    if (!auth) return;

    const conn = await getWordPressConnection(auth.userId);
    if (!conn) return res.status(400).json({ success: false, error: 'WordPress not connected' });

    const postId = String(req.params.id || '').trim();
    if (!/^[0-9]+$/.test(postId)) return res.status(400).json({ success: false, error: 'Invalid post id' });

    const appPassword = decryptWordPressPassword(conn.appPasswordEncrypted);
    const payload = req.body && typeof req.body === 'object' ? req.body : {};
    const { data, status: s, error } = await wpRequest(conn.siteUrl, conn.username, appPassword, 'POST', `/wp/v2/posts/${postId}`, { data: payload });
    if (s !== 200) return res.status(400).json({ success: false, error: error || 'Failed to update post' });

    await logIntegrationEvent({
      userId: auth.userId,
      integrationSlug: 'wordpress',
      eventType: 'post_updated',
      status: 'success',
      response: { postId: Number(postId) },
    });

    return res.json({ success: true, data });
  } catch (err) {
    console.error('WordPress update post error:', err);
    return res.status(500).json({ success: false, error: 'Failed to update post' });
  }
});

// POST /api/wordpress/media/upload — upload media to WordPress
app.post('/api/wordpress/media/upload', async (req: Request, res: Response) => {
  try {
    const auth = requireAuth(req, res);
    if (!auth) return;

    const conn = await getWordPressConnection(auth.userId);
    if (!conn) return res.status(400).json({ success: false, error: 'WordPress not connected' });

    const { fileBase64, filename } = req.body as { fileBase64?: string; filename?: string };
    const base64 = typeof fileBase64 === 'string' ? fileBase64.replace(/^data:.*;base64,/, '') : '';
    if (!base64) return res.status(400).json({ success: false, error: 'fileBase64 is required' });

    let buffer: Buffer;
    try {
      buffer = Buffer.from(base64, 'base64');
    } catch {
      return res.status(400).json({ success: false, error: 'Invalid fileBase64' });
    }

    const safeName = typeof filename === 'string' && filename.trim() ? filename.trim() : 'upload.jpg';

    const FormData = (await import('form-data')).default;
    const form = new FormData();
    form.append('file', buffer, { filename: safeName, contentType: 'image/jpeg' });

    const appPassword = decryptWordPressPassword(conn.appPasswordEncrypted);
    const { data, status: s, error } = await wpRequest(conn.siteUrl, conn.username, appPassword, 'POST', '/wp/v2/media', { formData: form });
    if (s !== 201 && s !== 200) return res.status(400).json({ success: false, error: error || 'Failed to upload media' });

    await logIntegrationEvent({
      userId: auth.userId,
      integrationSlug: 'wordpress',
      eventType: 'media_uploaded',
      status: 'success',
      response: { mediaId: data?.id || null },
    });

    return res.json({ success: true, data });
  } catch (err) {
    console.error('WordPress media upload error:', err);
    return res.status(500).json({ success: false, error: 'Failed to upload media' });
  }
});

// POST /api/wordpress/publish 붿?create post (optionally upload featured image, set meta)
app.post('/api/wordpress/publish', async (req: Request, res: Response) => {
  try {
    const auth = requireAuth(req, res);
    if (!auth) return;

    const conn = await getWordPressConnection(auth.userId);
    if (!conn) {
      return res.status(400).json({ success: false, error: 'WordPress not connected' });
    }
    const appPassword = decryptWordPressPassword(conn.appPasswordEncrypted);

    const {
      title,
      content,
      excerpt,
      slug,
      status,
      categories,
      tags,
      author,
      featuredImageBase64,
      featuredImageFilename,
      seoTitle,
      seoDescription,
      focusKeyword,
    } = req.body;

    if (!title && !content) {
      return res.status(400).json({ success: false, error: 'Title or content is required' });
    }

    let featuredMediaId: number | undefined;
    if (featuredImageBase64 && typeof featuredImageBase64 === 'string') {
      const base64 = featuredImageBase64.replace(/^data:image\/\w+;base64,/, '');
      let buffer: Buffer;
      try {
        buffer = Buffer.from(base64, 'base64');
      } catch {
        return res.status(400).json({ success: false, error: 'Invalid featured image data' });
      }
      const filename = featuredImageFilename && typeof featuredImageFilename === 'string'
        ? featuredImageFilename
        : 'featured.jpg';
      const FormData = (await import('form-data')).default;
      const form = new FormData();
      form.append('file', buffer, { filename, contentType: 'image/jpeg' });
      const { data: mediaData, status: mediaStatus, error: mediaError } = await wpRequest(
        conn.siteUrl,
        conn.username,
        appPassword,
        'POST',
        '/wp/v2/media',
        { formData: form as any }
      );
      if (mediaStatus !== 201 || !mediaData?.id) {
        return res.status(400).json({
          success: false,
          error: mediaError || 'Failed to upload featured image',
        });
      }
      featuredMediaId = mediaData.id;
    }

    const postPayload: Record<string, any> = {
      title: title || '',
      content: content || '',
      status: status === 'draft' ? 'draft' : 'publish',
    };
    if (excerpt !== undefined && excerpt !== '') postPayload.excerpt = excerpt;
    if (slug !== undefined && slug !== '') postPayload.slug = slug;
    if (Array.isArray(categories) && categories.length) postPayload.categories = categories;
    if (Array.isArray(tags) && tags.length) postPayload.tags = tags;
    if (author !== undefined && author !== '') postPayload.author = Number(author);
    if (featuredMediaId !== undefined) postPayload.featured_media = featuredMediaId;

    const { data: postData, status: postStatus, error: postError } = await wpRequest(
      conn.siteUrl,
      conn.username,
      appPassword,
      'POST',
      '/wp/v2/posts',
      { data: postPayload }
    );

    if (postStatus !== 201 && postStatus !== 200) {
      return res.status(400).json({ success: false, error: postError || 'Failed to create post' });
    }

    const postId = postData?.id;
    if (postId && (seoTitle || seoDescription || focusKeyword)) {
      const meta: Record<string, string> = {};
      if (seoTitle) {
        meta._yoast_wpseo_title = seoTitle;
        meta.rank_math_title = seoTitle;
      }
      if (seoDescription) {
        meta._yoast_wpseo_metadesc = seoDescription;
        meta.rank_math_description = seoDescription;
      }
      if (focusKeyword) {
        meta._yoast_wpseo_focuskw = focusKeyword;
        meta.rank_math_focus_keyword = focusKeyword;
      }
      await wpRequest(conn.siteUrl, conn.username, appPassword, 'POST', `/wp/v2/posts/${postId}`, {
        data: { meta },
      });
    }

    const isDraft = postPayload.status === 'draft';

    await logIntegrationEvent({
      userId: auth.userId,
      integrationSlug: 'wordpress',
      eventType: 'post_published',
      status: 'success',
      response: { postId: postId || null, status: postPayload.status },
    });

    return res.json({
      success: true,
      message: isDraft ? 'Post Saved as Draft' : 'Post Published Successfully',
      data: { postId, link: postData?.link, status: postPayload.status },
    });
  } catch (err) {
    if (err instanceof Error && !err.message.includes('password')) {
      console.error('WordPress publish error:', err.message);
    }
    return res.status(500).json({ success: false, error: 'Failed to publish post' });
  }
});

// Pricing Plans Routes
app.get('/api/pricing/plans', async (req: Request, res: Response) => {
  try {
    let plans: DbPricingPlan[] = [];

    if (!hasDatabase()) {
      plans = Array.from(inMemoryPricingPlansById.values());
      console.log(`GET /api/pricing/plans - Returning ${plans.length} in-memory plans`);
    } else {
      const result = await dbQuery<DbPricingPlan>(
        'SELECT id, name, description, price, billing_period, features, is_active, discount_percentage, is_on_sale, created_at, updated_at FROM pricing_plans ORDER BY created_at DESC'
      );
      plans = result.rows;
      console.log(`GET /api/pricing/plans - Returning ${plans.length} database plans`);
    }

    console.log('Plans to return:', plans.length > 0 ? plans[0] : 'No plans');

    return res.json({
      success: true,
      plans: plans.map((p) => ({
        id: p.id,
        name: p.name,
        description: p.description,
        price: parseFloat(String(p.price)),
        billingPeriod: p.billing_period,
        features: Array.isArray(p.features) ? p.features : [],
        isActive: p.is_active,
        discountPercentage: parseFloat(String(p.discount_percentage ?? 0)),
        isOnSale: p.is_on_sale ?? false,
        createdAt: p.created_at,
        updatedAt: p.updated_at,
      })),
    });
  } catch (error) {
    console.error('Get pricing plans error:', error);
    return res.status(500).json({ success: false, error: 'Failed to fetch pricing plans' });
  }
});

app.post('/api/pricing/plans', async (req: Request, res: Response) => {
  try {
    const admin = await requireAdmin(req, res);
    if (!admin) return;

    const { name, description, price, billingPeriod, features, discountPercentage, isOnSale } = req.body;
    if (!name || !description || price === undefined) {
      return res
        .status(400)
        .json({ success: false, error: 'Name, description, and price are required' });
    }

    const id = randomUUID();
    const now = new Date().toISOString();
    const discPct = Number(discountPercentage ?? 0);
    const onSale = Boolean(isOnSale ?? false);

    if (!hasDatabase()) {
      const plan: DbPricingPlan = {
        id,
        name,
        description,
        price: Number(price),
        billing_period: (billingPeriod || 'monthly') as 'monthly' | 'yearly',
        features: Array.isArray(features) ? features : [],
        is_active: true,
        discount_percentage: discPct,
        is_on_sale: onSale,
        created_at: now,
        updated_at: now,
      };
      inMemoryPricingPlansById.set(id, plan);

      return res.status(201).json({
        success: true,
        plan: {
          id: plan.id,
          name: plan.name,
          description: plan.description,
          price: plan.price,
          billingPeriod: plan.billing_period,
          features: plan.features,
          isActive: plan.is_active,
          discountPercentage: plan.discount_percentage,
          isOnSale: plan.is_on_sale,
          createdAt: plan.created_at,
          updatedAt: plan.updated_at,
        },
      });
    } else {
      const result = await dbQuery<DbPricingPlan>(
        'INSERT INTO pricing_plans (id, name, description, price, billing_period, features, is_active, discount_percentage, is_on_sale, created_at, updated_at) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $10) RETURNING *',
        [
          id,
          name,
          description,
          Number(price),
          billingPeriod || 'monthly',
          features || [],
          true,
          discPct,
          onSale,
          now,
        ]
      );
      const plan = result.rows[0];

      return res.status(201).json({
        success: true,
        plan: {
          id: plan.id,
          name: plan.name,
          description: plan.description,
          price: parseFloat(String(plan.price)),
          billingPeriod: plan.billing_period,
          features: Array.isArray(plan.features) ? plan.features : [],
          isActive: plan.is_active,
          discountPercentage: parseFloat(String(plan.discount_percentage ?? 0)),
          isOnSale: plan.is_on_sale ?? false,
          createdAt: plan.created_at,
          updatedAt: plan.updated_at,
        },
      });
    }
  } catch (error) {
    console.error('Create pricing plan error:', error);
    return res.status(500).json({ success: false, error: 'Failed to create pricing plan' });
  }
});

app.put('/api/pricing/plans/:id', async (req: Request, res: Response) => {
  try {
    const admin = await requireAdmin(req, res);
    if (!admin) return;

    const { id } = req.params;
    const { name, description, price, billingPeriod, features, isActive, discountPercentage, isOnSale } = req.body;

    if (!name || !description || price === undefined) {
      return res
        .status(400)
        .json({ success: false, error: 'Name, description, and price are required' });
    }

    const now = new Date().toISOString();
    const discPct = Number(discountPercentage ?? 0);
    const onSale = Boolean(isOnSale ?? false);

    if (!hasDatabase()) {
      const existing = inMemoryPricingPlansById.get(id);
      if (!existing) {
        return res.status(404).json({ success: false, error: 'Pricing plan not found' });
      }

      const updated: DbPricingPlan = {
        ...existing,
        name,
        description,
        price: Number(price),
        billing_period: (billingPeriod || 'monthly') as 'monthly' | 'yearly',
        features: Array.isArray(features) ? features : [],
        is_active: isActive !== undefined ? isActive : existing.is_active,
        discount_percentage: discPct,
        is_on_sale: onSale,
        updated_at: now,
      };
      inMemoryPricingPlansById.set(id, updated);

      return res.json({
        success: true,
        plan: {
          id: updated.id,
          name: updated.name,
          description: updated.description,
          price: updated.price,
          billingPeriod: updated.billing_period,
          features: updated.features,
          isActive: updated.is_active,
          discountPercentage: updated.discount_percentage,
          isOnSale: updated.is_on_sale,
          createdAt: updated.created_at,
          updatedAt: updated.updated_at,
        },
      });
    } else {
      const result = await dbQuery<DbPricingPlan>(
        'UPDATE pricing_plans SET name = $1, description = $2, price = $3, billing_period = $4, features = $5, is_active = $6, discount_percentage = $7, is_on_sale = $8, updated_at = $9 WHERE id = $10 RETURNING *',
        [
          name,
          description,
          Number(price),
          billingPeriod || 'monthly',
          features || [],
          isActive !== undefined ? isActive : true,
          discPct,
          onSale,
          now,
          id,
        ]
      );

      if (result.rows.length === 0) {
        return res.status(404).json({ success: false, error: 'Pricing plan not found' });
      }

      const plan = result.rows[0];
      return res.json({
        success: true,
        plan: {
          id: plan.id,
          name: plan.name,
          description: plan.description,
          price: parseFloat(String(plan.price)),
          billingPeriod: plan.billing_period,
          features: Array.isArray(plan.features) ? plan.features : [],
          isActive: plan.is_active,
          discountPercentage: parseFloat(String(plan.discount_percentage ?? 0)),
          isOnSale: plan.is_on_sale ?? false,
          createdAt: plan.created_at,
          updatedAt: plan.updated_at,
        },
      });
    }
  } catch (error) {
    console.error('Update pricing plan error:', error);
    return res.status(500).json({ success: false, error: 'Failed to update pricing plan' });
  }
});

app.delete('/api/pricing/plans/:id', async (req: Request, res: Response) => {
  try {
    const admin = await requireAdmin(req, res);
    if (!admin) return;

    const { id } = req.params;

    if (!hasDatabase()) {
      if (!inMemoryPricingPlansById.has(id)) {
        return res.status(404).json({ success: false, error: 'Pricing plan not found' });
      }
      inMemoryPricingPlansById.delete(id);
    } else {
      const result = await dbQuery('DELETE FROM pricing_plans WHERE id = $1', [id]);
      if (result.rowCount === 0) {
        return res.status(404).json({ success: false, error: 'Pricing plan not found' });
      }
    }

    return res.json({ success: true });
  } catch (error) {
    console.error('Delete pricing plan error:', error);
    return res.status(500).json({ success: false, error: 'Failed to delete pricing plan' });
  }
});

app.patch('/api/pricing/plans/:id/status', async (req: Request, res: Response) => {
  try {
    const admin = await requireAdmin(req, res);
    if (!admin) return;

    const { id } = req.params;
    const { isActive } = req.body;

    if (isActive === undefined) {
      return res.status(400).json({ success: false, error: 'isActive is required' });
    }

    const now = new Date().toISOString();

    if (!hasDatabase()) {
      const existing = inMemoryPricingPlansById.get(id);
      if (!existing) {
        return res.status(404).json({ success: false, error: 'Pricing plan not found' });
      }

      const updated: DbPricingPlan = {
        ...existing,
        is_active: isActive,
        updated_at: now,
      };
      inMemoryPricingPlansById.set(id, updated);

      return res.json({
        success: true,
        plan: {
          id: updated.id,
          name: updated.name,
          description: updated.description,
          price: updated.price,
          billingPeriod: updated.billing_period,
          features: updated.features,
          isActive: updated.is_active,
          createdAt: updated.created_at,
          updatedAt: updated.updated_at,
        },
      });
    } else {
      const result = await dbQuery<DbPricingPlan>(
        'UPDATE pricing_plans SET is_active = $1, updated_at = $2 WHERE id = $3 RETURNING *',
        [isActive, now, id]
      );

      if (result.rows.length === 0) {
        return res.status(404).json({ success: false, error: 'Pricing plan not found' });
      }

      const plan = result.rows[0];
      return res.json({
        success: true,
        plan: {
          id: plan.id,
          name: plan.name,
          description: plan.description,
          price: parseFloat(String(plan.price)),
          billingPeriod: plan.billing_period,
          features: Array.isArray(plan.features) ? plan.features : [],
          isActive: plan.is_active,
          createdAt: plan.created_at,
          updatedAt: plan.updated_at,
        },
      });
    }
  } catch (error) {
    console.error('Update pricing plan status error:', error);
    return res.status(500).json({ success: false, error: 'Failed to update pricing plan status' });
  }
});

// Card Templates Routes
app.get('/api/card-templates', async (req: Request, res: Response) => {
  try {
    const admin = await requireAdmin(req, res);
    if (!admin) return;

    let templates: DbCardTemplate[] = [];

    if (!hasDatabase()) {
      templates = Array.from(inMemoryCardTemplatesById.values());
    } else {
      const result = await dbQuery<DbCardTemplate>(
        'SELECT id, name, description, design_data, cover_image_url, is_published, created_at, updated_at FROM card_templates ORDER BY created_at DESC'
      );
      templates = result.rows;
    }

    return res.json({
      success: true,
      templates: templates.map((t) => ({
        id: t.id,
        name: t.name,
        description: t.description || '',
        designData: typeof t.design_data === 'string' ? JSON.parse(t.design_data) : t.design_data,
        coverImageUrl: t.cover_image_url,
        isPublished: t.is_published,
        createdAt: t.created_at,
        updatedAt: t.updated_at,
      })),
    });
  } catch (error) {
    console.error('Get card templates error:', error);
    return res.status(500).json({ success: false, error: 'Failed to fetch card templates' });
  }
});

app.get('/api/card-templates/published', async (req: Request, res: Response) => {
  try {
    let templates: DbCardTemplate[] = [];

    if (!hasDatabase()) {
      templates = Array.from(inMemoryCardTemplatesById.values()).filter((t) => t.is_published);
    } else {
      const result = await dbQuery<DbCardTemplate>(
        'SELECT id, name, description, design_data, cover_image_url, is_published, created_at, updated_at FROM card_templates WHERE is_published = true ORDER BY created_at DESC'
      );
      templates = result.rows;
    }

    return res.json({
      success: true,
      templates: templates.map((t) => ({
        id: t.id,
        name: t.name,
        description: t.description || '',
        designData: typeof t.design_data === 'string' ? JSON.parse(t.design_data) : t.design_data,
        coverImageUrl: t.cover_image_url,
        isPublished: t.is_published,
        createdAt: t.created_at,
        updatedAt: t.updated_at,
      })),
    });
  } catch (error) {
    console.error('Get published card templates error:', error);
    return res.status(500).json({ success: false, error: 'Failed to fetch published card templates' });
  }
});

app.post('/api/card-templates', async (req: Request, res: Response) => {
  try {
    const admin = await requireAdmin(req, res);
    if (!admin) return;

    const { name, description, designData } = req.body;
    if (!name || !designData) {
      return res.status(400).json({ success: false, error: 'Name and designData are required' });
    }

    const id = randomUUID();
    const now = new Date().toISOString();

    const template: DbCardTemplate = {
      id,
      name,
      description: description || '',
      design_data: designData,
      is_published: false,
      created_at: now,
      updated_at: now,
    };

    if (!hasDatabase()) {
      inMemoryCardTemplatesById.set(id, template);
    } else {
      await dbQuery(
        'INSERT INTO card_templates (id, name, description, design_data, is_published, created_at, updated_at) VALUES ($1, $2, $3, $4, $5, $6, $7)',
        [id, name, description || '', JSON.stringify(designData), false, now, now]
      );
    }

    return res.json({
      success: true,
      template: {
        id: template.id,
        name: template.name,
        description: template.description,
        designData: template.design_data,
        coverImageUrl: template.cover_image_url,
        isPublished: template.is_published,
        createdAt: template.created_at,
        updatedAt: template.updated_at,
      },
    });
  } catch (error) {
    console.error('Create card template error:', error);
    return res.status(500).json({ success: false, error: 'Failed to create card template' });
  }
});

app.put('/api/card-templates/:id', async (req: Request, res: Response) => {
  try {
    const admin = await requireAdmin(req, res);
    if (!admin) return;

    const { id } = req.params;
    const { name, description, designData, coverImageUrl } = req.body;

    if (!name || !designData) {
      return res.status(400).json({ success: false, error: 'Name and designData are required' });
    }

    const now = new Date().toISOString();
    const hasCover = coverImageUrl !== undefined && coverImageUrl !== null;

    if (!hasDatabase()) {
      const existing = inMemoryCardTemplatesById.get(id);
      if (!existing) {
        return res.status(404).json({ success: false, error: 'Card template not found' });
      }

      const updated: DbCardTemplate = {
        ...existing,
        name,
        description: description || '',
        design_data: designData,
        ...(hasCover && { cover_image_url: coverImageUrl as string }),
        updated_at: now,
      };
      inMemoryCardTemplatesById.set(id, updated);

      await syncCardTemplateMedia(admin.id, updated).catch((error) => {
        console.error('Card template media sync error:', error);
      });

      return res.json({
        success: true,
        template: {
          id: updated.id,
          name: updated.name,
          description: updated.description,
          designData: updated.design_data,
          coverImageUrl: updated.cover_image_url,
          isPublished: updated.is_published,
          createdAt: updated.created_at,
          updatedAt: updated.updated_at,
        },
      });
    } else {
      if (hasCover) {
        await dbQuery(
          'UPDATE card_templates SET name = $1, description = $2, design_data = $3, cover_image_url = $4, updated_at = $5 WHERE id = $6',
          [name, description || '', JSON.stringify(designData), coverImageUrl, now, id]
        );
      } else {
        await dbQuery(
          'UPDATE card_templates SET name = $1, description = $2, design_data = $3, updated_at = $4 WHERE id = $5',
          [name, description || '', JSON.stringify(designData), now, id]
        );
      }

      const result = await dbQuery<DbCardTemplate>(
        'SELECT id, name, description, design_data, cover_image_url, is_published, created_at, updated_at FROM card_templates WHERE id = $1',
        [id]
      );

      if (result.rows.length === 0) {
        return res.status(404).json({ success: false, error: 'Card template not found' });
      }

      const template = result.rows[0];
      await syncCardTemplateMedia(admin.id, template).catch((error) => {
        console.error('Card template media sync error:', error);
      });
      return res.json({
        success: true,
        template: {
          id: template.id,
          name: template.name,
          description: template.description,
          designData: typeof template.design_data === 'string' ? JSON.parse(template.design_data) : template.design_data,
          coverImageUrl: template.cover_image_url,
          isPublished: template.is_published,
          createdAt: template.created_at,
          updatedAt: template.updated_at,
        },
      });
    }
  } catch (error) {
    console.error('Update card template error:', error);
    return res.status(500).json({ success: false, error: 'Failed to update card template' });
  }
});

app.post('/api/card-templates/:id/publish', async (req: Request, res: Response) => {
  try {
    const admin = await requireAdmin(req, res);
    if (!admin) return;

    const { id } = req.params;
    const { coverImageUrl } = req.body;
    const coverUrl = typeof coverImageUrl === 'string' ? coverImageUrl : '';

    const now = new Date().toISOString();

    if (!hasDatabase()) {
      const existing = inMemoryCardTemplatesById.get(id);
      if (!existing) {
        return res.status(404).json({ success: false, error: 'Card template not found' });
      }

      const updated: DbCardTemplate = {
        ...existing,
        ...(coverUrl ? { cover_image_url: coverUrl } : {}),
        is_published: true,
        updated_at: now,
      };
      inMemoryCardTemplatesById.set(id, updated);

      await syncCardTemplateMedia(admin.id, updated).catch((error) => {
        console.error('Card template media sync error:', error);
      });

      return res.json({
        success: true,
        template: {
          id: updated.id,
          name: updated.name,
          description: updated.description,
          designData: updated.design_data,
          coverImageUrl: updated.cover_image_url,
          isPublished: updated.is_published,
          createdAt: updated.created_at,
          updatedAt: updated.updated_at,
        },
      });
    } else {
      await dbQuery(
        'UPDATE card_templates SET cover_image_url = COALESCE(NULLIF($1, \'\'), cover_image_url), is_published = true, updated_at = $2 WHERE id = $3',
        [coverUrl, now, id]
      );

      const result = await dbQuery<DbCardTemplate>(
        'SELECT id, name, description, design_data, cover_image_url, is_published, created_at, updated_at FROM card_templates WHERE id = $1',
        [id]
      );

      if (result.rows.length === 0) {
        return res.status(404).json({ success: false, error: 'Card template not found' });
      }

      const template = result.rows[0];
      await syncCardTemplateMedia(admin.id, template).catch((error) => {
        console.error('Card template media sync error:', error);
      });
      return res.json({
        success: true,
        template: {
          id: template.id,
          name: template.name,
          description: template.description,
          designData: typeof template.design_data === 'string' ? JSON.parse(template.design_data) : template.design_data,
          coverImageUrl: template.cover_image_url,
          isPublished: template.is_published,
          createdAt: template.created_at,
          updatedAt: template.updated_at,
        },
      });
    }
  } catch (error) {
    console.error('Publish card template error:', error);
    return res.status(500).json({ success: false, error: 'Failed to publish card template' });
  }
});

app.post('/api/card-templates/:id/unpublish', async (req: Request, res: Response) => {
  try {
    const admin = await requireAdmin(req, res);
    if (!admin) return;

    const { id } = req.params;
    const now = new Date().toISOString();

    if (!hasDatabase()) {
      const existing = inMemoryCardTemplatesById.get(id);
      if (!existing) {
        return res.status(404).json({ success: false, error: 'Card template not found' });
      }
      inMemoryCardTemplatesById.set(id, { ...existing, is_published: false, updated_at: now });
      return res.json({ success: true });
    } else {
      await dbQuery(
        'UPDATE card_templates SET is_published = false, updated_at = $1 WHERE id = $2',
        [now, id]
      );
      return res.json({ success: true });
    }
  } catch (error) {
    console.error('Unpublish card template error:', error);
    return res.status(500).json({ success: false, error: 'Failed to unpublish card template' });
  }
});

app.delete('/api/card-templates/:id', async (req: Request, res: Response) => {
  try {
    const admin = await requireAdmin(req, res);
    if (!admin) return;

    const { id } = req.params;

    if (!hasDatabase()) {
      const existing = inMemoryCardTemplatesById.get(id);
      if (!existing) {
        return res.status(404).json({ success: false, error: 'Card template not found' });
      }
      inMemoryCardTemplatesById.delete(id);
      return res.json({ success: true, message: 'Card template deleted' });
    } else {
      await dbQuery('DELETE FROM card_templates WHERE id = $1', [id]);
      return res.json({ success: true, message: 'Card template deleted' });
    }
  } catch (error) {
    console.error('Delete card template error:', error);
    return res.status(500).json({ success: false, error: 'Failed to delete card template' });
  }
});

// ─── User Designs Routes ──────────────────────────────────────────────────────

interface DbDesign {
  id: string;
  user_id: string;
  name: string;
  canvas_width: number;
  canvas_height: number;
  canvas_data: object;
  thumbnail_url: string | null;
  created_at: string;
  updated_at: string;
}

const inMemoryDesigns = new Map<string, DbDesign>();

// GET /api/designs — list current user's designs
app.get('/api/designs', async (req: Request, res: Response) => {
  try {
    const auth = requireAuth(req, res);
    if (!auth) return;

    if (hasDatabase()) {
      const result = await dbQuery(
        'SELECT * FROM user_designs WHERE user_id = $1 ORDER BY updated_at DESC',
        [auth.userId],
      );
      return res.json({ success: true, designs: result.rows });
    } else {
      const designs = Array.from(inMemoryDesigns.values())
        .filter((d) => d.user_id === auth.userId)
        .sort((a, b) => b.updated_at.localeCompare(a.updated_at));
      return res.json({ success: true, designs });
    }
  } catch (error) {
    console.error('Get designs error:', error);
    return res.status(500).json({ success: false, error: 'Failed to fetch designs' });
  }
});

// GET /api/designs/:id — get a single design
app.get('/api/designs/:id', async (req: Request, res: Response) => {
  try {
    const auth = requireAuth(req, res);
    if (!auth) return;
    const { id } = req.params;

    if (hasDatabase()) {
      const result = await dbQuery(
        'SELECT * FROM user_designs WHERE id = $1 AND user_id = $2',
        [id, auth.userId],
      );
      if (result.rows.length === 0)
        return res.status(404).json({ success: false, error: 'Design not found' });
      return res.json({ success: true, design: result.rows[0] });
    } else {
      const design = inMemoryDesigns.get(id);
      if (!design || design.user_id !== auth.userId)
        return res.status(404).json({ success: false, error: 'Design not found' });
      return res.json({ success: true, design });
    }
  } catch (error) {
    console.error('Get design error:', error);
    return res.status(500).json({ success: false, error: 'Failed to fetch design' });
  }
});

// POST /api/designs — create a new design
app.post('/api/designs', async (req: Request, res: Response) => {
  try {
    const auth = requireAuth(req, res);
    if (!auth) return;
    const { name, canvas_width, canvas_height, canvas_data, thumbnail_url } = req.body;
    const id = crypto.randomUUID();
    const now = new Date().toISOString();

    const design: DbDesign = {
      id,
      user_id: auth.userId,
      name: name || 'Untitled Design',
      canvas_width: canvas_width || 1080,
      canvas_height: canvas_height || 1080,
      canvas_data: canvas_data || {},
      thumbnail_url: thumbnail_url || null,
      created_at: now,
      updated_at: now,
    };

    if (hasDatabase()) {
      await dbQuery(
        `INSERT INTO user_designs (id, user_id, name, canvas_width, canvas_height, canvas_data, thumbnail_url, created_at, updated_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $8)`,
        [id, auth.userId, design.name, design.canvas_width, design.canvas_height, JSON.stringify(design.canvas_data), design.thumbnail_url, now],
      );
    } else {
      inMemoryDesigns.set(id, design);
    }

    await syncUserDesignMedia(auth.userId, design).catch((error) => {
      console.error('Design media sync error:', error);
    });

    void checkTaskActions(auth.userId, 'create_card');

    return res.status(201).json({ success: true, design });
  } catch (error) {
    console.error('Create design error:', error);
    return res.status(500).json({ success: false, error: 'Failed to create design' });
  }
});

// PUT /api/designs/:id — update a design
app.put('/api/designs/:id', async (req: Request, res: Response) => {
  try {
    const auth = requireAuth(req, res);
    if (!auth) return;
    const { id } = req.params;
    const { name, canvas_width, canvas_height, canvas_data, thumbnail_url } = req.body;
    const now = new Date().toISOString();

    if (hasDatabase()) {
      const result = await dbQuery(
        `UPDATE user_designs
         SET name = COALESCE($1, name),
             canvas_width = COALESCE($2, canvas_width),
             canvas_height = COALESCE($3, canvas_height),
             canvas_data = COALESCE($4, canvas_data),
             thumbnail_url = COALESCE($5, thumbnail_url),
             updated_at = $6
         WHERE id = $7 AND user_id = $8
         RETURNING *`,
        [name, canvas_width, canvas_height, canvas_data ? JSON.stringify(canvas_data) : null, thumbnail_url, now, id, auth.userId],
      );
      if (result.rows.length === 0)
        return res.status(404).json({ success: false, error: 'Design not found' });
      await syncUserDesignMedia(auth.userId, result.rows[0] as DbDesign).catch((error) => {
        console.error('Design media sync error:', error);
      });
      return res.json({ success: true, design: result.rows[0] });
    } else {
      const design = inMemoryDesigns.get(id);
      if (!design || design.user_id !== auth.userId)
        return res.status(404).json({ success: false, error: 'Design not found' });
      const updated: DbDesign = {
        ...design,
        ...(name !== undefined && { name }),
        ...(canvas_width !== undefined && { canvas_width }),
        ...(canvas_height !== undefined && { canvas_height }),
        ...(canvas_data !== undefined && { canvas_data }),
        ...(thumbnail_url !== undefined && { thumbnail_url }),
        updated_at: now,
      };
      inMemoryDesigns.set(id, updated);
      await syncUserDesignMedia(auth.userId, updated).catch((error) => {
        console.error('Design media sync error:', error);
      });
      return res.json({ success: true, design: updated });
    }
  } catch (error) {
    console.error('Update design error:', error);
    return res.status(500).json({ success: false, error: 'Failed to update design' });
  }
});

// DELETE /api/designs/:id — delete a design
app.delete('/api/designs/:id', async (req: Request, res: Response) => {
  try {
    const auth = requireAuth(req, res);
    if (!auth) return;
    const { id } = req.params;

    if (hasDatabase()) {
      await dbQuery('DELETE FROM user_designs WHERE id = $1 AND user_id = $2', [id, auth.userId]);
    } else {
      const design = inMemoryDesigns.get(id);
      if (design && design.user_id === auth.userId) inMemoryDesigns.delete(id);
    }
    return res.json({ success: true });
  } catch (error) {
    console.error('Delete design error:', error);
    return res.status(500).json({ success: false, error: 'Failed to delete design' });
  }
});

// ─── Platform Config Routes (Admin) ───────────────────────────────────────────

// GET /api/admin/platform-configs  — returns all configs with secrets masked
app.get('/api/admin/platform-configs', async (req: Request, res: Response) => {
  try {
    const admin = await requireAdmin(req, res);
    if (!admin) return;

    const mask = (v: string | undefined) => (v && v.length > 4 ? '••••' + v.slice(-4) : v ? '••••' : '');

    const SECRET_FIELDS = ['appSecret', 'clientSecret', 'apiKey', 'accessToken', 'signingSecret', 'applicationPassword'];

    const maskConfig = (cfg: Record<string, string>) => {
      const out: Record<string, string> = {};
      for (const [k, v] of Object.entries(cfg)) {
        out[k] = SECRET_FIELDS.includes(k) ? mask(v) : v;
      }
      return out;
    };

    if (hasDatabase()) {
      const result = await dbQuery('SELECT platform, config, enabled, updated_at FROM platform_configs ORDER BY platform');
      const rows = result.rows.map((r: any) => ({ ...r, config: maskConfig(r.config) }));
      return res.json({ success: true, configs: rows });
    }

    const configs = Array.from(inMemoryPlatformConfigs.values()).map((r) => ({
      ...r,
      config: maskConfig(r.config),
    }));
    return res.json({ success: true, configs });
  } catch (error) {
    console.error('Get platform configs error:', error);
    return res.status(500).json({ success: false, error: 'Failed to fetch platform configs' });
  }
});

// GET /api/admin/platform-configs/:platform — returns raw config including secrets (admin only)
app.get('/api/admin/platform-configs/:platform', async (req: Request, res: Response) => {
  try {
    const admin = await requireAdmin(req, res);
    if (!admin) return;

    const { platform } = req.params;

    if (hasDatabase()) {
      const result = await dbQuery('SELECT platform, config, enabled, updated_at FROM platform_configs WHERE platform = $1', [platform]);
      if (result.rows.length === 0) return res.json({ success: true, config: null });
      return res.json({ success: true, config: result.rows[0] });
    }

    const cfg = inMemoryPlatformConfigs.get(platform);
    return res.json({ success: true, config: cfg ?? null });
  } catch (error) {
    console.error('Get platform config error:', error);
    return res.status(500).json({ success: false, error: 'Failed to fetch platform config' });
  }
});

// PUT /api/admin/platform-configs/:platform — save/update platform config
 app.put('/api/admin/platform-configs/:platform', async (req: Request, res: Response) => {
  try {
    const admin = await requireAdmin(req, res);
    if (!admin) return;

    const platform = String(req.params.platform || '').trim().toLowerCase();
    const { config, enabled } = req.body as { config: Record<string, string>; enabled: boolean };

    if (!config || typeof config !== 'object') {
      return res.status(400).json({ success: false, error: 'config object is required' });
    }

    const now = new Date().toISOString();

    const normalizedConfig: Record<string, string> = { ...(config as any) };
    const meta = OAUTH_AUTH_URLS[platform];
    if (meta) {
      const incomingRedirect = typeof normalizedConfig.redirectUri === 'string' ? normalizedConfig.redirectUri : '';
      normalizedConfig.redirectUri = resolveOAuthRedirectUri(platform, incomingRedirect, req);
    }

    // Auto-enable integration when valid credentials are configured
    let finalEnabled = Boolean(enabled);
    if (meta) {
      const clientId = String((normalizedConfig as any)[meta.idField] || '').trim();
      const redirectUri = String((normalizedConfig as any).redirectUri || '').trim();
      const secretRequired = isOAuthClientSecretRequired(platform);
      const secretValue = String((normalizedConfig as any).clientSecret || (normalizedConfig as any).appSecret || '').trim();
      const isFullyConfigured = Boolean(clientId && redirectUri && (!secretRequired || secretValue));
      // If credentials are now valid, auto-enable regardless of request
      if (isFullyConfigured) {
        finalEnabled = true;
      }
    }

    if (hasDatabase()) {
      // Use update-then-insert to avoid requiring an existing unique constraint/index.
      const updateRes = await dbQuery(
        `UPDATE platform_configs
         SET config = $2, enabled = $3, updated_at = NOW()
         WHERE platform = $1`,
        [platform, JSON.stringify(normalizedConfig), finalEnabled]
      );
      if (updateRes.rowCount === 0) {
        await dbQuery(
          `INSERT INTO platform_configs (platform, config, enabled, updated_at)
           VALUES ($1, $2, $3, NOW())`,
          [platform, JSON.stringify(normalizedConfig), finalEnabled]
        );
      }
    } else {
      inMemoryPlatformConfigs.set(platform, { platform, config: normalizedConfig, enabled: finalEnabled, updated_at: now });
    }

    // Reload Stripe client immediately when admin saves Stripe credentials
    if (platform === 'stripe') void refreshStripe();

    return res.json({ success: true, message: 'Platform config saved' });
  } catch (error) {
    console.error('Save platform config error:', error);
    return res.status(500).json({ success: false, error: 'Failed to save platform config' });
  }
});

// ─── Hubtel Payment Routes ─────────────────────────────────────────────────────

async function getHubtelConfig(): Promise<{ clientId: string; clientSecret: string; merchantAccountNumber: string } | null> {
  const cfg = await getPlatformConfig('hubtel');
  const clientId = cfg.clientId || process.env.HUBTEL_CLIENT_ID || '';
  const clientSecret = cfg.clientSecret || process.env.HUBTEL_CLIENT_SECRET || '';
  const merchantAccountNumber = cfg.merchantAccountNumber || process.env.HUBTEL_MERCHANT_ACCOUNT_NUMBER || '';
  if (!clientId || !clientSecret) return null;
  return { clientId, clientSecret, merchantAccountNumber };
}

// POST /api/payments/hubtel/initiate — start a Hubtel checkout
app.post('/api/payments/hubtel/initiate', async (req: Request, res: Response) => {
  try {
    const auth = requireAuth(req, res);
    if (!auth) return;

    const {
      amount,
      description,
      customerName,
      customerEmail,
      customerMsisdn,
    } = req.body as {
      amount: number;
      description: string;
      customerName: string;
      customerEmail: string;
      customerMsisdn: string;
    };

    if (!amount || !customerName || !customerMsisdn) {
      return res.status(400).json({ success: false, error: 'amount, customerName, and customerMsisdn are required' });
    }

    const hubtel = await getHubtelConfig();
    if (!hubtel) {
      return res.status(503).json({ success: false, error: 'Hubtel is not configured. Add credentials in Admin > Payments.' });
    }

    const clientReference = randomUUID();
    const backendUrl = process.env.BACKEND_PUBLIC_URL || `https://contentflow-api.onrender.com`;

    const payload = {
      totalAmount: Number(amount),
      description: description || 'Payment',
      callbackUrl: `${backendUrl}/api/payments/hubtel/callback`,
      returnUrl: `${process.env.FRONTEND_ORIGIN || 'https://marketing.dakyworld.com'}/payments/success`,
      cancellationUrl: `${process.env.FRONTEND_ORIGIN || 'https://marketing.dakyworld.com'}/payments/cancel`,
      merchantAccountNumber: hubtel.merchantAccountNumber,
      clientReference,
    };

    const response = await axios.post('https://payproxyapi.hubtel.com/items/initiate', payload, {
      auth: { username: hubtel.clientId, password: hubtel.clientSecret },
      headers: { 'Content-Type': 'application/json' },
    });

    const checkoutUrl: string = response.data?.data?.checkoutUrl || response.data?.checkoutUrl || '';

    const txn: PaymentTransactionRow = {
      id: randomUUID(),
      amount: Number(amount),
      currency: 'GHS',
      description: description || null,
      status: 'pending',
      provider: 'hubtel',
      client_reference: clientReference,
      provider_reference: null,
      customer_name: customerName,
      customer_email: customerEmail || null,
      customer_phone: customerMsisdn,
      checkout_url: checkoutUrl,
      metadata: response.data || null,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };

    if (hasDatabase()) {
      await dbQuery(
        `INSERT INTO payment_transactions
           (id, amount, currency, description, status, provider, client_reference, customer_name, customer_email, customer_phone, checkout_url, metadata)
         VALUES ($1,$2,$3,$4,'pending','hubtel',$5,$6,$7,$8,$9,$10)`,
        [txn.id, txn.amount, txn.currency, txn.description, clientReference, customerName, customerEmail || null, customerMsisdn, checkoutUrl, JSON.stringify(txn.metadata)]
      );
    } else {
      inMemoryPaymentTransactions.unshift(txn);
    }

    return res.json({ success: true, checkoutUrl, clientReference });
  } catch (error: any) {
    console.error('Hubtel initiate error:', error?.response?.data || error);
    return res.status(502).json({ success: false, error: error?.response?.data?.message || 'Failed to initiate payment' });
  }
});

// POST /api/payments/hubtel/callback — Hubtel posts here after payment
app.post('/api/payments/hubtel/callback', async (req: Request, res: Response) => {
  try {
    const body = req.body as any;
    const clientReference: string = body?.Data?.ClientReference || body?.clientReference || '';
    const status: string = (body?.Data?.Status || body?.status || 'failed').toLowerCase();
    const providerRef: string = body?.Data?.TransactionId || body?.transactionId || '';

    const mappedStatus = status === 'successful' || status === 'success' ? 'successful' : status === 'pending' ? 'pending' : 'failed';

    if (clientReference) {
      if (hasDatabase()) {
        await dbQuery(
          `UPDATE payment_transactions SET status = $1, provider_reference = $2, updated_at = NOW(), metadata = metadata || $3::jsonb
           WHERE client_reference = $4`,
          [mappedStatus, providerRef, JSON.stringify({ hubtelCallback: body }), clientReference]
        );
      } else {
        const txn = inMemoryPaymentTransactions.find((t) => t.client_reference === clientReference);
        if (txn) { txn.status = mappedStatus; txn.provider_reference = providerRef; txn.updated_at = new Date().toISOString(); }
      }
    }

    return res.json({ success: true });
  } catch (error) {
    console.error('Hubtel callback error:', error);
    return res.status(500).json({ success: false, error: 'Callback processing failed' });
  }
});

// GET /api/payments/hubtel/verify/:clientReference — verify a payment status
app.get('/api/payments/hubtel/verify/:clientReference', async (req: Request, res: Response) => {
  try {
    const auth = requireAuth(req, res);
    if (!auth) return;

    const { clientReference } = req.params;
    const hubtel = await getHubtelConfig();

    if (hubtel) {
      try {
        const response = await axios.get(`https://api.hubtel.com/checkout/v1.1/merchant/transactions/status?clientReference=${clientReference}`, {
          auth: { username: hubtel.clientId, password: hubtel.clientSecret },
        });
        const remoteStatus = (response.data?.data?.status || '').toLowerCase();
        const mappedStatus = remoteStatus === 'successful' || remoteStatus === 'success' ? 'successful' : remoteStatus === 'pending' ? 'pending' : 'failed';

        if (hasDatabase()) {
          await dbQuery(`UPDATE payment_transactions SET status = $1, updated_at = NOW() WHERE client_reference = $2`, [mappedStatus, clientReference]);
        } else {
          const txn = inMemoryPaymentTransactions.find((t) => t.client_reference === clientReference);
          if (txn) txn.status = mappedStatus;
        }
        return res.json({ success: true, status: mappedStatus, data: response.data });
      } catch {
        // fall through to DB lookup
      }
    }

    // Fallback: return local status
    if (hasDatabase()) {
      const result = await dbQuery('SELECT status FROM payment_transactions WHERE client_reference = $1', [clientReference]);
      if (result.rows.length === 0) return res.status(404).json({ success: false, error: 'Transaction not found' });
      return res.json({ success: true, status: result.rows[0].status });
    }

    const txn = inMemoryPaymentTransactions.find((t) => t.client_reference === clientReference);
    if (!txn) return res.status(404).json({ success: false, error: 'Transaction not found' });
    return res.json({ success: true, status: txn.status });
  } catch (error) {
    console.error('Verify payment error:', error);
    return res.status(500).json({ success: false, error: 'Failed to verify payment' });
  }
});

// GET /api/admin/payments — list all transactions
app.get('/api/admin/payments', async (req: Request, res: Response) => {
  try {
    const admin = await requireAdmin(req, res);
    if (!admin) return;

    if (hasDatabase()) {
      const result = await dbQuery(
        `SELECT id, amount, currency, description, status, provider, client_reference, provider_reference,
                customer_name, customer_email, customer_phone, created_at, updated_at
         FROM payment_transactions ORDER BY created_at DESC LIMIT 200`
      );
      return res.json({ success: true, transactions: result.rows });
    }

    return res.json({ success: true, transactions: inMemoryPaymentTransactions.slice(0, 200) });
  } catch (error) {
    console.error('List payments error:', error);
    return res.status(500).json({ success: false, error: 'Failed to fetch transactions' });
  }
});

// GET /api/admin/payments/stats — revenue stats
app.get('/api/admin/payments/stats', async (req: Request, res: Response) => {
  try {
    const admin = await requireAdmin(req, res);
    if (!admin) return;

    if (hasDatabase()) {
      const result = await dbQuery(`
        SELECT
          COUNT(*)::int AS total,
          COUNT(*) FILTER (WHERE status = 'successful')::int AS successful,
          COUNT(*) FILTER (WHERE status = 'pending')::int AS pending,
          COUNT(*) FILTER (WHERE status = 'failed')::int AS failed,
          COALESCE(SUM(amount) FILTER (WHERE status = 'successful'), 0)::numeric AS revenue
        FROM payment_transactions
      `);
      return res.json({ success: true, stats: result.rows[0] });
    }

    const all = inMemoryPaymentTransactions;
    return res.json({
      success: true,
      stats: {
        total: all.length,
        successful: all.filter((t) => t.status === 'successful').length,
        pending: all.filter((t) => t.status === 'pending').length,
        failed: all.filter((t) => t.status === 'failed').length,
        revenue: all.filter((t) => t.status === 'successful').reduce((s, t) => s + t.amount, 0),
      },
    });
  } catch (error) {
    console.error('Payment stats error:', error);
    return res.status(500).json({ success: false, error: 'Failed to fetch payment stats' });
  }
});

// ── Integration helpers ────────────────────────────────────────────────────────

const META_GRAPH_BASE = 'https://graph.facebook.com/v19.0';

const META_BASE_SCOPES = [
  'public_profile',
  'email',
  'pages_show_list',
  'pages_read_engagement',
  'pages_manage_posts',
  'pages_manage_metadata',
  'read_insights',
];

const META_INSTAGRAM_SCOPES = [
  'instagram_basic',
  'instagram_content_publish',
  'instagram_manage_insights',
];

const META_PERMISSION_ALIASES: Record<string, string[]> = {
  instagram_basic: ['instagram_basic', 'instagram_business_basic'],
  instagram_content_publish: ['instagram_content_publish', 'instagram_business_content_publish'],
  instagram_manage_insights: ['instagram_manage_insights', 'instagram_business_manage_insights'],
  pages_show_list: ['pages_show_list'],
  pages_read_engagement: ['pages_read_engagement'],
  pages_manage_posts: ['pages_manage_posts'],
  pages_manage_metadata: ['pages_manage_metadata'],
  read_insights: ['read_insights'],
};

const INSTAGRAM_TARGET_REQUIRED_PERMISSIONS = ['pages_show_list', 'instagram_basic'];
const INSTAGRAM_RECOMMENDED_PERMISSIONS = ['instagram_content_publish', 'instagram_manage_insights'];
const INSTAGRAM_PROFILE_FIELDS = 'id,username,name,account_type,biography,followers_count,follows_count,media_count,profile_picture_url,website,is_verified';
const INSTAGRAM_MEDIA_FIELDS = 'id,caption,media_type,media_product_type,media_url,thumbnail_url,permalink,timestamp,like_count,comments_count';
const META_PAGE_PUBLISH_TASKS = new Set(['CREATE_CONTENT', 'MANAGE']);

function getMetaOAuthScopeString(extraScopes: string[] = []): string {
  return Array.from(new Set([...META_BASE_SCOPES, ...META_INSTAGRAM_SCOPES, ...extraScopes])).join(',');
}

function getGrantedMetaPermissionSet(permsData: any): Set<string> {
  const perms = Array.isArray(permsData?.data) ? permsData.data : [];
  return new Set(
    perms
      .filter((p: any) => String(p?.status || '').toLowerCase() === 'granted')
      .map((p: any) => String(p?.permission || '').toLowerCase())
      .filter(Boolean)
  );
}

function missingMetaPermissions(granted: Set<string>, required: string[]): string[] {
  return required.filter((permission) => {
    const aliases = META_PERMISSION_ALIASES[permission] || [permission];
    return !aliases.some((alias) => granted.has(String(alias).toLowerCase()));
  });
}

async function fetchMetaPermissionSet(accessToken: string): Promise<Set<string>> {
  if (!accessToken) return new Set();
  try {
    const permsResp = await axios.get(`${META_GRAPH_BASE}/me/permissions`, {
      params: { access_token: accessToken },
      validateStatus: () => true,
      timeout: 15000,
    });
    if (permsResp.status >= 400) return new Set();
    return getGrantedMetaPermissionSet(permsResp.data || {});
  } catch {
    return new Set();
  }
}

function hasInstagramPagePublishAccess(tasks: unknown): boolean {
  const values = Array.isArray(tasks)
    ? tasks.map((task) => String(task || '').trim().toUpperCase()).filter(Boolean)
    : [];
  return values.some((task) => META_PAGE_PUBLISH_TASKS.has(task));
}

async function fetchInstagramBusinessProfile(igUserId: string, accessToken: string): Promise<{ profile: any | null; error?: string }> {
  try {
    const resp = await axios.get(`${META_GRAPH_BASE}/${encodeURIComponent(igUserId)}`, {
      params: {
        fields: INSTAGRAM_PROFILE_FIELDS,
        access_token: accessToken,
      },
      validateStatus: () => true,
      timeout: 15000,
    });
    const data: any = resp.data || {};
    if (resp.status >= 400) {
      return { profile: null, error: data?.error?.message || `Instagram API error ${resp.status}` };
    }
    return { profile: data };
  } catch (error) {
    return { profile: null, error: error instanceof Error ? error.message : 'Instagram profile lookup failed' };
  }
}

async function listInstagramPageTargets(userAccessToken: string): Promise<{
  targets: any[];
  missingPermissions: string[];
  warnings: string[];
}> {
  const grantedPermissions = await fetchMetaPermissionSet(userAccessToken);
  const missingPermissions = missingMetaPermissions(grantedPermissions, INSTAGRAM_TARGET_REQUIRED_PERMISSIONS);
  const missingRecommended = missingMetaPermissions(grantedPermissions, INSTAGRAM_RECOMMENDED_PERMISSIONS);
  const warnings: string[] = [];

  if (missingRecommended.length > 0) {
    warnings.push(
      `Missing recommended Instagram permissions: ${missingRecommended.join(', ')}. Reconnect Meta/Facebook and approve them to enable Instagram publishing and insights.`
    );
  }

  if (missingPermissions.includes('pages_show_list')) {
    warnings.push('Meta page access is missing `pages_show_list`, so Instagram business accounts cannot be discovered yet.');
    return { targets: [], missingPermissions, warnings };
  }

  const pagesResp = await axios.get(`${META_GRAPH_BASE}/me/accounts`, {
    params: {
      fields: 'id,name,access_token,tasks,picture.width(128).height(128),instagram_business_account{id,username}',
      limit: 200,
      access_token: userAccessToken,
    },
    validateStatus: () => true,
    timeout: 15000,
  });
  const pagesData: any = pagesResp.data || {};
  if (pagesResp.status >= 400) {
    throw new Error(pagesData?.error?.message || `Meta API error ${pagesResp.status}`);
  }

  const pages: any[] = Array.isArray(pagesData?.data) ? pagesData.data : [];
  const targets = await Promise.all(
    pages.map(async (page: any) => {
      const pageId = String(page?.id || '').trim();
      const pageName = String(page?.name || '').trim();
      const pageAccessToken = String(page?.access_token || '').trim();
      const pageTasks = Array.isArray(page?.tasks)
        ? page.tasks.map((task: any) => String(task || '').trim()).filter(Boolean)
        : [];
      const pagePicture = page?.picture?.data?.url ? String(page.picture.data.url) : null;
      const ig = page?.instagram_business_account || null;
      const instagramId = String(ig?.id || '').trim() || null;
      let profile: any = null;

      if (instagramId && pageAccessToken) {
        const profileResult = await fetchInstagramBusinessProfile(instagramId, pageAccessToken);
        profile = profileResult.profile;
      }

      return {
        pageId,
        pageName,
        pagePicture,
        pageTasks,
        pageAccessToken,
        instagramId,
        instagramUsername: String(profile?.username || ig?.username || '').trim() || null,
        instagramName: String(profile?.name || '').trim() || null,
        instagramAccountType: String(profile?.account_type || '').trim() || null,
        instagramFollowers: profile?.followers_count !== undefined ? Number(profile.followers_count) : null,
        instagramFollowing: profile?.follows_count !== undefined ? Number(profile.follows_count) : null,
        instagramMediaCount: profile?.media_count !== undefined ? Number(profile.media_count) : null,
        instagramBio: typeof profile?.biography === 'string' ? profile.biography : null,
        instagramProfilePicture: typeof profile?.profile_picture_url === 'string' ? profile.profile_picture_url : null,
        instagramWebsite: typeof profile?.website === 'string' ? profile.website : null,
        instagramVerified: profile?.is_verified === true,
        canPublish:
          Boolean(pageAccessToken) &&
          hasInstagramPagePublishAccess(pageTasks) &&
          missingMetaPermissions(grantedPermissions, ['instagram_content_publish']).length === 0,
        canInsights:
          Boolean(pageAccessToken) &&
          missingMetaPermissions(grantedPermissions, ['instagram_manage_insights']).length === 0,
      };
    })
  );

  return { targets: targets.filter((target) => target.pageId), missingPermissions, warnings };
}

async function syncInstagramAnalyticsAccount(params: {
  userId: string;
  account: any;
  days?: number;
}): Promise<{ synced: number; errors: string[] }> {
  const { userId, account } = params;
  const days = Math.max(1, Number(params.days || 30));
  const errors: string[] = [];
  let synced = 0;

  let accessToken = decodeStoredIntegrationSecret(account?.access_token_encrypted);
  if (!accessToken) accessToken = String(account?.access_token || '').trim();
  const instagramId = String(account?.account_id || '').trim();
  const accountTokenData = account?.token_data || {};

  if (!accessToken) return { synced, errors: ['Instagram access token missing or expired — reconnect Instagram.'] };
  if (!instagramId) return { synced, errors: ['Instagram account ID missing from saved connection.'] };

  let profile: any = null;
  try {
    const profileResp = await axios.get(`${META_GRAPH_BASE}/${encodeURIComponent(instagramId)}`, {
      params: {
        fields: INSTAGRAM_PROFILE_FIELDS,
        access_token: accessToken,
      },
      validateStatus: () => true,
      timeout: 15000,
    });
    const profileData: any = profileResp.data || {};
    if (profileResp.status >= 400) {
      errors.push(profileData?.error?.message || `Instagram profile lookup failed (${profileResp.status})`);
    } else {
      profile = profileData;
      const followers = Number(profile.followers_count ?? account?.followers ?? 0);
      const following = Number(profile.follows_count ?? 0);
      const postsCount = Number(profile.media_count ?? 0);
      const bio = typeof profile.biography === 'string' ? profile.biography : null;
      const isVerified = profile.is_verified === true;
      const displayName = String(profile.name || profile.username || account?.account_name || '').trim() || null;
      const handle = String(profile.username || account?.handle || '').trim() || null;
      const profileImage = typeof profile.profile_picture_url === 'string' ? profile.profile_picture_url : null;

      await pool!.query(
        `INSERT INTO social_profile_stats
           (id, user_id, social_account_id, platform, followers, following, posts_count, bio, is_verified, raw_response, synced_at)
         VALUES (gen_random_uuid()::text, $1, $2, 'instagram', $3, $4, $5, $6, $7, $8::jsonb, NOW())
         ON CONFLICT (social_account_id) DO UPDATE SET
           followers = CASE WHEN EXCLUDED.followers > 0 THEN EXCLUDED.followers ELSE social_profile_stats.followers END,
           following = CASE WHEN EXCLUDED.following > 0 THEN EXCLUDED.following ELSE social_profile_stats.following END,
           posts_count = CASE WHEN EXCLUDED.posts_count > 0 THEN EXCLUDED.posts_count ELSE social_profile_stats.posts_count END,
           bio = COALESCE(EXCLUDED.bio, social_profile_stats.bio),
           is_verified = EXCLUDED.is_verified,
           raw_response = EXCLUDED.raw_response,
           synced_at = NOW()`,
        [userId, account.id, followers, following, postsCount, bio, isVerified, JSON.stringify(profile)]
      );

      await pool!.query(
        `UPDATE social_accounts
         SET account_name = COALESCE($1, account_name),
             handle = COALESCE($2, handle),
             profile_image = COALESCE($3, profile_image),
             followers = CASE WHEN $4 > 0 THEN $4 ELSE followers END,
             token_data = COALESCE(token_data, '{}'::jsonb) || $5::jsonb
         WHERE id = $6`,
        [
          displayName,
          handle,
          profileImage,
          followers,
          JSON.stringify({
            instagramUsername: handle,
            instagramName: displayName,
            accountType: profile.account_type || null,
            mediaCount: postsCount,
            website: profile.website || null,
            profilePictureUrl: profileImage,
            pageId: accountTokenData?.pageId || null,
            pageName: accountTokenData?.pageName || null,
          }),
          account.id,
        ]
      );
      synced++;
    }
  } catch (error) {
    errors.push(error instanceof Error ? error.message : 'Instagram profile sync failed');
  }

  try {
    const since = Math.floor((Date.now() - days * 24 * 60 * 60 * 1000) / 1000);
    const until = Math.floor(Date.now() / 1000);
    const insightsResp = await axios.get(`${META_GRAPH_BASE}/${encodeURIComponent(instagramId)}/insights`, {
      params: {
        metric: 'impressions,reach,profile_views',
        period: 'day',
        since,
        until,
        access_token: accessToken,
      },
      validateStatus: () => true,
      timeout: 20000,
    });
    const insightsData: any = insightsResp.data || {};
    if (insightsResp.status < 400 && Array.isArray(insightsData?.data)) {
      const dateMetrics = new Map<string, Record<string, number>>();
      for (const metric of insightsData.data) {
        const metricName = String(metric?.name || '').trim();
        for (const valueRow of Array.isArray(metric?.values) ? metric.values : []) {
          const dateKey = String(valueRow?.end_time || valueRow?.endTime || '').slice(0, 10);
          if (!dateKey) continue;
          const current = dateMetrics.get(dateKey) || {};
          current[metricName] = Number(valueRow?.value ?? 0);
          dateMetrics.set(dateKey, current);
        }
      }

      for (const [date, metrics] of dateMetrics.entries()) {
        await pool!.query(
          `INSERT INTO account_metrics
             (id, user_id, platform, social_account_id, date, followers, impressions, reach, profile_views, raw_data)
           VALUES (gen_random_uuid()::text, $1, 'instagram', $2, $3::date, $4, $5, $6, $7, $8::jsonb)
           ON CONFLICT (user_id, platform, social_account_id, date) DO UPDATE SET
             followers = EXCLUDED.followers,
             impressions = EXCLUDED.impressions,
             reach = EXCLUDED.reach,
             profile_views = EXCLUDED.profile_views,
             raw_data = EXCLUDED.raw_data`,
          [
            userId,
            account.id,
            date,
            Number(profile?.followers_count ?? account?.followers ?? 0),
            Number(metrics.impressions ?? 0),
            Number(metrics.reach ?? 0),
            Number(metrics.profile_views ?? 0),
            JSON.stringify({ metrics, source: insightsData.data }),
          ]
        );
        synced++;
      }
    } else if (insightsResp.status >= 400) {
      const message = insightsData?.error?.message || `Instagram insights lookup failed (${insightsResp.status})`;
      errors.push(message);
    }
  } catch (error) {
    errors.push(error instanceof Error ? error.message : 'Instagram account insights sync failed');
  }

  try {
    const mediaResp = await axios.get(`${META_GRAPH_BASE}/${encodeURIComponent(instagramId)}/media`, {
      params: {
        fields: INSTAGRAM_MEDIA_FIELDS,
        limit: 50,
        access_token: accessToken,
      },
      validateStatus: () => true,
      timeout: 20000,
    });
    const mediaData: any = mediaResp.data || {};
    if (mediaResp.status >= 400) {
      errors.push(mediaData?.error?.message || `Instagram media lookup failed (${mediaResp.status})`);
    } else {
      const mediaItems: any[] = Array.isArray(mediaData?.data) ? mediaData.data : [];
      for (const media of mediaItems) {
        const mediaId = String(media?.id || '').trim();
        if (!mediaId) continue;

        const analytics = await instagramBusinessPlatform.getPostAnalytics(mediaId, {
          accessToken,
          accountId: instagramId,
          accountName: account?.account_name || profile?.name || profile?.username || null,
          tokenData: accountTokenData,
          helpers: { graphBase: META_GRAPH_BASE },
        });

        const likes = Number(analytics.likes ?? media?.like_count ?? 0);
        const comments = Number(analytics.comments ?? media?.comments_count ?? 0);
        const shares = Number(analytics.shares ?? 0);
        const impressions = Number(analytics.impressions ?? 0);
        const reach = Number(analytics.reach ?? 0);
        const saves = Number(analytics.saves ?? 0);
        const totalInteractions = Number((analytics.raw as any)?.total_interactions ?? 0);
        const engagement = totalInteractions > 0 ? totalInteractions : likes + comments + shares + saves;
        const postedAt = media?.timestamp ? new Date(media.timestamp).toISOString() : null;

        await pool!.query(
          `INSERT INTO social_metrics
             (id, user_id, platform, platform_post_id, social_account_id, likes, comments, shares, impressions, reach, engagement, saves, raw_data, posted_at, fetched_at)
           VALUES (gen_random_uuid()::text, $1, 'instagram', $2, $3, $4, $5, $6, $7, $8, $9, $10, $11::jsonb, $12, NOW())
           ON CONFLICT (user_id, platform, platform_post_id) DO UPDATE SET
             likes = EXCLUDED.likes,
             comments = EXCLUDED.comments,
             shares = EXCLUDED.shares,
             impressions = EXCLUDED.impressions,
             reach = EXCLUDED.reach,
             engagement = EXCLUDED.engagement,
             saves = EXCLUDED.saves,
             raw_data = EXCLUDED.raw_data,
             posted_at = COALESCE(EXCLUDED.posted_at, social_metrics.posted_at),
             fetched_at = NOW()`,
          [
            userId,
            mediaId,
            account.id,
            likes,
            comments,
            shares,
            impressions,
            reach,
            engagement,
            saves,
            JSON.stringify({
              media,
              analytics: analytics.raw || null,
              account: {
                instagramId,
                instagramUsername: profile?.username || accountTokenData?.instagramUsername || null,
                instagramName: profile?.name || accountTokenData?.instagramName || null,
                pageId: accountTokenData?.pageId || null,
                pageName: accountTokenData?.pageName || null,
              },
            }),
            postedAt,
          ]
        );
        synced++;
      }
    }
  } catch (error) {
    errors.push(error instanceof Error ? error.message : 'Instagram media sync failed');
  }

  return { synced, errors };
}

async function syncThreadsAnalyticsAccount(params: {
  userId: string;
  account: any;
  days?: number;
  maxPosts?: number;
}): Promise<{ synced: number; errors: string[] }> {
  const { userId, account } = params;
  const days = Math.max(1, Number(params.days || 30));
  const maxPosts = Math.max(1, Math.min(200, Number(params.maxPosts || 50)));

  const errors: string[] = [];
  let synced = 0;

  if (!pool) return { synced, errors: ['DB not ready'] };

  let accessToken = decodeStoredIntegrationSecret(account?.access_token_encrypted);
  if (!accessToken) accessToken = String(account?.access_token || '').trim();
  if (!accessToken) return { synced, errors: ['Threads access token missing or expired — reconnect Threads.'] };

  const threadsBase = 'https://graph.threads.net/v1.0';
  const sinceDate = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
  const sinceMs = sinceDate.getTime();

  const extractMetric = (insightsResp: any, name: string) => {
    const data = Array.isArray(insightsResp?.data) ? insightsResp.data : [];
    const match = data.find((m: any) => String(m?.name || '').toLowerCase() === name.toLowerCase());
    const values = Array.isArray(match?.values) ? match.values : [];
    if (values.length === 0) return 0;
    const raw = values[values.length - 1]?.value;
    const num = typeof raw === 'number' ? raw : parseFloat(String(raw ?? '0'));
    return Number.isFinite(num) ? num : 0;
  };

  // ── Profile + account insights ──────────────────────────────────────────
  let profile: any = null;
  try {
    const meResp = await axios.get(`${threadsBase}/me`, {
      params: {
        fields: 'id,username,name,is_verified,threads_profile_picture_url,threads_biography',
        access_token: accessToken,
      },
      validateStatus: () => true,
      timeout: 15000,
    });
    const meData: any = meResp.data || {};
    if (meResp.status >= 400) {
      const msg = meData?.error?.message || `Threads profile lookup failed (${meResp.status})`;
      errors.push(msg);
    } else {
      profile = meData;
    }
  } catch (err: any) {
    errors.push(`Threads profile lookup failed: ${err?.message || 'Failed'}`);
  }

  let accountInsights: any = null;
  try {
    const metricList = 'views,likes,replies,reposts,quotes,clicks,followers_count';
    const insResp = await axios.get(`${threadsBase}/me/threads_insights`, {
      params: {
        metric: metricList,
        access_token: accessToken,
      },
      validateStatus: () => true,
      timeout: 15000,
    });
    const insData: any = insResp.data || {};
    if (insResp.status === 403) {
      errors.push('Threads insights scope not granted (threads_manage_insights) — reconnect Threads to enable analytics.');
    } else if (insResp.status >= 400) {
      const msg = insData?.error?.message || `Threads account insights failed (${insResp.status})`;
      errors.push(msg);
    } else {
      accountInsights = insData;
    }
  } catch (err: any) {
    errors.push(`Threads account insights failed: ${err?.message || 'Failed'}`);
  }

  const followerDemographics: Record<string, any> = {};
  if (accountInsights) {
    for (const breakdown of ['country', 'city', 'age', 'gender'] as const) {
      try {
        const demoResp = await axios.get(`${threadsBase}/me/threads_insights`, {
          params: {
            metric: 'follower_demographics',
            breakdown,
            access_token: accessToken,
          },
          validateStatus: () => true,
          timeout: 15000,
        });
        const demoData: any = demoResp.data || {};
        if (demoResp.status === 403) {
          // Only include the warning once; base insights call already records the scope error.
          if (!errors.some((e) => e.includes('threads_manage_insights'))) {
            errors.push('Threads insights scope not granted (threads_manage_insights) — reconnect Threads to enable analytics.');
          }
          break;
        }
        if (demoResp.status >= 400) {
          const msg = demoData?.error?.message || `Threads follower demographics failed (${demoResp.status})`;
          errors.push(msg);
          continue;
        }
        followerDemographics[breakdown] = demoData;
      } catch (err: any) {
        errors.push(`Threads follower demographics failed: ${err?.message || 'Failed'}`);
      }
    }
  }

  const followers = Math.round(extractMetric(accountInsights, 'followers_count'));
  const totalLikes = Math.round(extractMetric(accountInsights, 'likes'));
  const accountMetrics = {
    views: Math.round(extractMetric(accountInsights, 'views')),
    likes: totalLikes,
    replies: Math.round(extractMetric(accountInsights, 'replies')),
    reposts: Math.round(extractMetric(accountInsights, 'reposts')),
    quotes: Math.round(extractMetric(accountInsights, 'quotes')),
    clicks: Math.round(extractMetric(accountInsights, 'clicks')),
    followers_count: followers,
  };

  // ── Posts sync ──────────────────────────────────────────────────────────
  let postsSynced = 0;
  try {
    const fields =
      'id,media_product_type,media_type,media_url,gif_url,permalink,owner,username,text,timestamp,shortcode,thumbnail_url,children,is_quote_post,quoted_post,reposted_post,has_replies,alt_text,link_attachment_url,poll_attachment{option_a,option_b,option_c,option_d,option_a_votes_percentage,option_b_votes_percentage,option_c_votes_percentage,option_d_votes_percentage,expiration_timestamp},location_id,topic_tag,is_verified,profile_picture_url';
    const metricList = 'views,likes,replies,reposts,quotes,shares';

    let after: string | null = null;
    let fetched = 0;
    let page = 0;
    const MAX_PAGES = 10;

    while (fetched < maxPosts && page < MAX_PAGES) {
      const pageSize = Math.min(50, Math.max(1, maxPosts - fetched));
      const listResp = await axios.get(`${threadsBase}/me/threads`, {
        params: {
          fields,
          limit: pageSize,
          ...(after ? { after } : {}),
          access_token: accessToken,
        },
        validateStatus: () => true,
        timeout: 20000,
      });
      const listData: any = listResp.data || {};
      if (listResp.status >= 400) {
        const msg = listData?.error?.message || `Threads posts fetch failed (${listResp.status})`;
        errors.push(msg);
        break;
      }

      const items: any[] =
        Array.isArray(listData?.data) ? listData.data :
        Array.isArray(listData?.items) ? listData.items :
        [];

      if (items.length === 0) break;

      let hitOldPost = false;
      for (const post of items) {
        if (fetched >= maxPosts) break;
        const threadId = String(post?.id || '').trim();
        if (!threadId) continue;

        let postedAt: string | null = null;
        let postedAtMs = NaN;
        try {
          const dt = post?.timestamp ? new Date(post.timestamp) : null;
          postedAt = dt && !Number.isNaN(dt.getTime()) ? dt.toISOString() : null;
          postedAtMs = dt ? dt.getTime() : NaN;
        } catch {
          postedAt = null;
          postedAtMs = NaN;
        }

        if (Number.isFinite(postedAtMs) && postedAtMs < sinceMs) {
          hitOldPost = true;
          break;
        }

        let insights: any = null;
        try {
          const insResp = await axios.get(`${threadsBase}/${encodeURIComponent(threadId)}/insights`, {
            params: { metric: metricList, access_token: accessToken },
            validateStatus: () => true,
            timeout: 15000,
          });
          const insData: any = insResp.data || {};
          if (insResp.status >= 400) {
            const msg = insData?.error?.message || `Threads post insights failed (${insResp.status})`;
            errors.push(msg);
          } else {
            insights = insData;
          }
        } catch (err: any) {
          errors.push(`Threads post insights failed: ${err?.message || 'Failed'}`);
        }

        const views = Math.round(extractMetric(insights, 'views'));
        const likes = Math.round(extractMetric(insights, 'likes'));
        const replies = Math.round(extractMetric(insights, 'replies'));
        const reposts = Math.round(extractMetric(insights, 'reposts'));
        const quotes = Math.round(extractMetric(insights, 'quotes'));
        const shares = Math.round(extractMetric(insights, 'shares'));
        const engagement = likes + replies + reposts + quotes + shares;

        const mediaUrl =
          typeof post?.media_url === 'string'
            ? post.media_url
            : typeof post?.gif_url === 'string'
              ? post.gif_url
              : null;

        const raw = {
          post: {
            id: threadId,
            text: post?.text ?? null,
            permalink: post?.permalink ?? null,
            timestamp: post?.timestamp ?? null,
            media_product_type: post?.media_product_type ?? null,
            media_type: post?.media_type ?? null,
            media_url: mediaUrl,
            gif_url: post?.gif_url ?? null,
            thumbnail_url: post?.thumbnail_url ?? null,
            username: post?.username ?? null,
            shortcode: post?.shortcode ?? null,
            children: post?.children ?? null,
            is_quote_post: post?.is_quote_post ?? null,
            quoted_post: post?.quoted_post ?? null,
            reposted_post: post?.reposted_post ?? null,
            has_replies: post?.has_replies ?? null,
            alt_text: post?.alt_text ?? null,
            link_attachment_url: post?.link_attachment_url ?? null,
            poll_attachment: post?.poll_attachment ?? null,
            location_id: post?.location_id ?? null,
            topic_tag: post?.topic_tag ?? null,
            owner: post?.owner ?? null,
            is_verified: post?.is_verified ?? null,
            profile_picture_url: post?.profile_picture_url ?? null,
          },
          metrics: { views, likes, replies, reposts, quotes, shares },
          insights: insights?.data ?? null,
        };

        await pool.query(
          `INSERT INTO social_metrics
             (id, user_id, platform, platform_post_id, social_account_id,
              likes, comments, shares, impressions, reach, engagement,
              raw_data, posted_at, fetched_at)
           VALUES (gen_random_uuid()::text, $1, 'threads', $2, $3,
                   $4, $5, $6, $7, $8, $9,
                   $10::jsonb, $11, NOW())
           ON CONFLICT (user_id, platform, platform_post_id) DO UPDATE SET
             social_account_id = EXCLUDED.social_account_id,
             likes       = EXCLUDED.likes,
             comments    = EXCLUDED.comments,
             shares      = EXCLUDED.shares,
             impressions = EXCLUDED.impressions,
             reach       = EXCLUDED.reach,
             engagement  = EXCLUDED.engagement,
             raw_data    = EXCLUDED.raw_data,
             posted_at   = COALESCE(EXCLUDED.posted_at, social_metrics.posted_at),
             fetched_at  = NOW()`,
          [userId, threadId, account.id, likes, replies, shares, views, views, engagement, JSON.stringify(raw), postedAt]
        );

        synced++;
        postsSynced++;
        fetched++;
      }

      after =
        (listData?.paging?.cursors?.after ? String(listData.paging.cursors.after) : null) ||
        (listData?.paging?.after ? String(listData.paging.after) : null) ||
        null;

      if (hitOldPost || !after) break;
      page++;
    }
  } catch (err: any) {
    errors.push(`Threads posts sync failed: ${err?.message || 'Failed'}`);
  }

  // ── Persist profile snapshot ────────────────────────────────────────────
  try {
    const bio = typeof profile?.threads_biography === 'string' ? profile.threads_biography : (typeof profile?.about === 'string' ? profile.about : null);
    const isVerified = profile?.is_verified === true;
    const handle = typeof profile?.username === 'string' ? profile.username : null;
    const accountName = String(profile?.name || profile?.username || account?.account_name || '').trim() || null;
    const profileImage =
      typeof profile?.threads_profile_picture_url === 'string'
        ? profile.threads_profile_picture_url
        : typeof profile?.profile_picture_url === 'string'
          ? profile.profile_picture_url
          : null;
    const accountId = profile?.id ? String(profile.id).trim() : null;

    await pool.query(
      `INSERT INTO social_profile_stats
         (id, user_id, social_account_id, platform,
          followers, following, posts_count, total_likes,
          bio, is_verified, raw_response, synced_at)
       VALUES (gen_random_uuid()::text, $1, $2, 'threads',
               $3, 0, $4, $5,
               $6, $7, $8::jsonb, NOW())
       ON CONFLICT (social_account_id) DO UPDATE SET
         followers   = CASE WHEN EXCLUDED.followers > 0 THEN EXCLUDED.followers ELSE social_profile_stats.followers END,
         posts_count = CASE WHEN EXCLUDED.posts_count > 0 THEN EXCLUDED.posts_count ELSE social_profile_stats.posts_count END,
         total_likes = CASE WHEN EXCLUDED.total_likes > 0 THEN EXCLUDED.total_likes ELSE social_profile_stats.total_likes END,
         bio         = COALESCE(EXCLUDED.bio, social_profile_stats.bio),
         is_verified = EXCLUDED.is_verified,
         raw_response= EXCLUDED.raw_response,
         synced_at   = NOW()`,
      [
        userId,
        account.id,
        followers,
        postsSynced,
        totalLikes,
        bio,
        isVerified,
        JSON.stringify({ profile, insights: accountInsights, account_metrics: accountMetrics, follower_demographics: followerDemographics }),
      ]
    );

    await pool.query(
      `UPDATE social_accounts SET
         account_id    = COALESCE($1, account_id),
         account_name  = COALESCE($2, account_name),
         handle        = COALESCE($3, handle),
         profile_image = COALESCE($4, profile_image),
         followers     = CASE WHEN $5 > 0 THEN $5 ELSE followers END
       WHERE id = $6`,
      [accountId, accountName, handle, profileImage, followers, account.id]
    );

    synced++;
  } catch (err: any) {
    errors.push(`Threads profile sync failed: ${err?.message || 'Failed'}`);
  }

  return { synced, errors };
}

async function syncPinterestAnalyticsAccount(params: {
  userId: string;
  account: any;
  days?: number;
  maxPins?: number;
}): Promise<{ synced: number; errors: string[] }> {
  const { userId, account } = params;
  const days = Math.max(1, Number(params.days || 30));
  const maxPins = Math.max(1, Math.min(250, Number(params.maxPins || 50)));

  const errors: string[] = [];
  let synced = 0;

  if (!pool) return { synced, errors: ['DB not ready'] };

  let accessToken = decodeStoredIntegrationSecret(account?.access_token_encrypted);
  if (!accessToken) accessToken = String(account?.access_token || '').trim();
  if (!accessToken) return { synced, errors: ['Pinterest access token missing or expired — reconnect Pinterest.'] };

  const headers = { Authorization: `Bearer ${accessToken}` };

  // ── Profile sync ────────────────────────────────────────────────────────
  try {
    const meResp = await axios.get('https://api.pinterest.com/v5/user_account', {
      headers,
      validateStatus: () => true,
      timeout: 15000,
    });
    const me: any = meResp.data || {};

    if (meResp.status === 403) {
      errors.push('Profile scope not granted (user_accounts:read) — reconnect Pinterest to enable follower and profile stats.');
    } else if (meResp.status >= 400) {
      const msg = me?.message || me?.error || `Pinterest profile fetch failed (${meResp.status})`;
      errors.push(typeof msg === 'string' ? msg : `Pinterest profile fetch failed (${meResp.status})`);
    } else {
      const followers = Number(me?.follower_count ?? 0);
      const following = Number(me?.following_count ?? 0);
      const pinsCount = Number(me?.pin_count ?? 0);
      const bio = typeof me?.about === 'string' ? me.about : null;
      const handle = typeof me?.username === 'string' ? me.username : null;
      const accountName = String(me?.business_name || me?.username || account?.account_name || '').trim() || null;
      const profileImage = typeof me?.profile_image === 'string' ? me.profile_image : null;
      const accountId = me?.id ? String(me.id).trim() : null;

      await pool.query(
        `INSERT INTO social_profile_stats
           (id, user_id, social_account_id, platform,
            followers, following, posts_count, total_likes,
            bio, is_verified, raw_response, synced_at)
         VALUES (gen_random_uuid()::text, $1, $2, 'pinterest',
                 $3, $4, $5, 0,
                 $6, false, $7::jsonb, NOW())
         ON CONFLICT (social_account_id) DO UPDATE SET
           followers   = CASE WHEN EXCLUDED.followers > 0 THEN EXCLUDED.followers ELSE social_profile_stats.followers END,
           following   = CASE WHEN EXCLUDED.following > 0 THEN EXCLUDED.following ELSE social_profile_stats.following END,
           posts_count = CASE WHEN EXCLUDED.posts_count > 0 THEN EXCLUDED.posts_count ELSE social_profile_stats.posts_count END,
           bio         = COALESCE(EXCLUDED.bio, social_profile_stats.bio),
           raw_response= EXCLUDED.raw_response,
           synced_at   = NOW()`,
        [userId, account.id, followers, following, pinsCount, bio, JSON.stringify(me)]
      );

      await pool.query(
        `UPDATE social_accounts SET
           account_id    = COALESCE($1, account_id),
           account_name  = COALESCE($2, account_name),
           handle        = COALESCE($3, handle),
           profile_image = COALESCE($4, profile_image),
           followers     = CASE WHEN $5 > 0 THEN $5 ELSE followers END
         WHERE id = $6`,
        [accountId, accountName, handle, profileImage, followers, account.id]
      );

      synced++;
    }
  } catch (err: any) {
    errors.push(`Pinterest profile sync failed: ${err?.message || 'Failed'}`);
  }

  // ── Pins sync ───────────────────────────────────────────────────────────
  try {
    const metricNumber = (value: any) => {
      const num = typeof value === 'number' ? value : parseFloat(String(value || '0'));
      return Number.isFinite(num) ? num : 0;
    };

    const pickMetric = (metrics: any, keys: string[]) => {
      for (const key of keys) {
        if (metrics && metrics[key] !== undefined && metrics[key] !== null) return metricNumber(metrics[key]);
      }
      return 0;
    };

    let bookmark: string | null = null;
    let fetchedPins = 0;
    let page = 0;
    const MAX_PAGES = 10;

    while (fetchedPins < maxPins && page < MAX_PAGES) {
      const pageSize = Math.min(250, Math.max(1, maxPins - fetchedPins));
      const pinsResp = await axios.get('https://api.pinterest.com/v5/pins', {
        headers,
        params: {
          page_size: pageSize,
          pin_metrics: true,
          ...(bookmark ? { bookmark } : {}),
        },
        validateStatus: () => true,
        timeout: 20000,
      });
      const pinsData: any = pinsResp.data || {};

      if (pinsResp.status >= 400) {
        const msg = pinsData?.message || pinsData?.error || `Pinterest pins fetch failed (${pinsResp.status})`;
        errors.push(typeof msg === 'string' ? msg : `Pinterest pins fetch failed (${pinsResp.status})`);
        break;
      }

      const items: any[] = Array.isArray(pinsData?.items) ? pinsData.items : [];
      for (const pin of items) {
        if (fetchedPins >= maxPins) break;
        const pinId = String(pin?.id || '').trim();
        if (!pinId) continue;

        const pinMetrics = pin?.pin_metrics || null;
        const metricsSource = pinMetrics?.lifetime_metrics ? 'lifetime' : pinMetrics?.['90d'] ? '90d' : null;
        const metrics =
          (metricsSource === 'lifetime' ? pinMetrics?.lifetime_metrics : null) ||
          (metricsSource === '90d' ? pinMetrics?.['90d'] : null) ||
          {};

        const impressions = pickMetric(metrics, ['impression', 'impressions']);
        const outboundClicks = pickMetric(metrics, ['clickthrough', 'outbound_click', 'outbound_clicks']);
        const pinClicks = pickMetric(metrics, ['pin_click', 'pin_clicks']);
        const saves = pickMetric(metrics, ['save', 'saves']);
        const reactions = pickMetric(metrics, ['reaction', 'total_reactions']);
        const comments = pickMetric(metrics, ['comment', 'total_comments']);

        const engagement = saves + pinClicks + reactions + comments;

        let postedAt: string | null = null;
        try {
          const dt = pin?.created_at ? new Date(pin.created_at) : null;
          postedAt = dt && !Number.isNaN(dt.getTime()) ? dt.toISOString() : null;
        } catch {
          postedAt = null;
        }

        const raw = {
          pin: {
            id: pinId,
            title: pin?.title ?? null,
            description: pin?.description ?? null,
            link: pin?.link ?? null,
            board_id: pin?.board_id ?? null,
            board_section_id: pin?.board_section_id ?? null,
            creative_type: pin?.creative_type ?? null,
            media: pin?.media ?? null,
            created_at: pin?.created_at ?? null,
          },
          metrics: {
            impressions,
            outbound_clicks: outboundClicks,
            pin_click: pinClicks,
            saves,
            reactions,
            comments,
            source: metricsSource,
          },
        };

        await pool.query(
          `INSERT INTO social_metrics
             (id, user_id, platform, platform_post_id, social_account_id,
              likes, comments, shares, impressions, reach, engagement, clicks, saves,
              raw_data, posted_at, fetched_at)
           VALUES (gen_random_uuid()::text, $1, 'pinterest', $2, $3,
                   $4, $5, 0, $6, $7, $8, $9, $10,
                   $11::jsonb, $12, NOW())
           ON CONFLICT (user_id, platform, platform_post_id) DO UPDATE SET
             social_account_id = EXCLUDED.social_account_id,
             likes       = EXCLUDED.likes,
             comments    = EXCLUDED.comments,
             impressions = EXCLUDED.impressions,
             reach       = EXCLUDED.reach,
             engagement  = EXCLUDED.engagement,
             clicks      = EXCLUDED.clicks,
             saves       = EXCLUDED.saves,
             raw_data    = EXCLUDED.raw_data,
             posted_at   = COALESCE(EXCLUDED.posted_at, social_metrics.posted_at),
             fetched_at  = NOW()`,
          [
            userId,
            pinId,
            account.id,
            Math.round(reactions),
            Math.round(comments),
            Math.round(impressions),
            Math.round(impressions), // Pinterest has no "reach"; use impressions as a reasonable proxy.
            Math.round(engagement),
            Math.round(outboundClicks),
            Math.round(saves),
            JSON.stringify(raw),
            postedAt,
          ]
        );

        synced++;
        fetchedPins++;
      }

      bookmark = pinsData?.bookmark ? String(pinsData.bookmark) : null;
      if (!bookmark) break;
      page++;
    }
  } catch (err: any) {
    errors.push(`Pinterest pins sync failed: ${err?.message || 'Failed'}`);
  }

  return { synced, errors };
}

const OAUTH_AUTH_URLS: Record<string, { authUrl: string; scopes: string; idField: 'appId' | 'clientId' | 'clientKey' }> = {
  // Instagram Basic Display OAuth (scopes are comma-separated)
  instagram: { authUrl: 'https://api.instagram.com/oauth/authorize', scopes: 'user_profile,user_media', idField: 'appId' },
  facebook:  { authUrl: 'https://www.facebook.com/v19.0/dialog/oauth', scopes: getMetaOAuthScopeString(), idField: 'appId' },
  // LinkedIn scopes are space-separated.
  // These defaults align with the LinkedIn Marketing APIs we use for profile posting,
  // organization posting, organization lookup, and organization analytics. Apps that need
  // a narrower or broader scope set can override this via LINKEDIN_OAUTH_SCOPES.
  linkedin:  {
    authUrl: 'https://www.linkedin.com/oauth/v2/authorization',
    scopes: getLinkedInOAuthScopeString(),
    idField: 'clientId',
  },
  // media.write is NOT a standard OAuth 2.0 scope — requesting it causes Twitter to reject the auth URL entirely.
  // tweet.write is sufficient for posting tweets and uploading media via the v1.1 media upload endpoint.
  twitter:   { authUrl: 'https://twitter.com/i/oauth2/authorize', scopes: 'tweet.read tweet.write users.read offline.access', idField: 'clientId' },
  pinterest: { authUrl: 'https://www.pinterest.com/oauth/', scopes: 'boards:read,boards:write,pins:read,pins:write,user_accounts:read', idField: 'clientId' },
  tiktok:    { authUrl: 'https://www.tiktok.com/v2/auth/authorize/', scopes: 'user.info.basic,user.info.profile,user.info.stats,video.list,video.upload,video.publish', idField: 'clientKey' },
  threads:   { authUrl: 'https://www.threads.net/oauth/authorize', scopes: 'threads_basic,threads_content_publish,threads_manage_insights,threads_read_replies,threads_manage_replies,threads_location_tagging', idField: 'appId' },
};

const DEFAULT_OAUTH_REDIRECTS: Record<string, string> = {
  instagram: '/auth/instagram/callback',
  facebook: '/auth/facebook/callback',
  linkedin: '/auth/linkedin/callback',
  twitter: '/auth/twitter/callback',
  pinterest: '/auth/pinterest/callback',
  tiktok: '/auth/tiktok/callback',
  threads: '/auth/threads/callback',
};

function getDefaultOAuthRedirectPath(platform: string): string {
  const key = String(platform || '').trim().toLowerCase();
  return DEFAULT_OAUTH_REDIRECTS[key] || `/auth/${key}/callback`;
}

function resolveOAuthRedirectUri(platform: string, redirectUri?: string, req?: Request): string {
  if (!OAUTH_AUTH_URLS[platform]) return '';
  const raw = String(redirectUri || '').trim() || getDefaultOAuthRedirectPath(platform);
  return resolveBackendRedirectUri(raw, req);
}

// GET /api/oauth/:platform/authorize-url — build OAuth URL from DB-configured credentials
  app.get('/api/oauth/:platform/authorize-url', async (req: Request, res: Response) => {
  try {
    const auth = requireAuth(req, res);
    if (!auth) return;

    const platform = req.params.platform.toLowerCase();
    const { state } = req.query as { state?: string };
    if (!state) return res.status(400).json({ success: false, error: 'Missing state' });

    const meta = OAUTH_AUTH_URLS[platform];
    if (!meta) return res.status(400).json({ success: false, error: 'Unsupported platform' });

    const cfg = await getPlatformConfig(platform);
    const clientId = cfg[meta.idField];
    const redirectUri = resolveOAuthRedirectUri(platform, cfg.redirectUri, req);

    if (!clientId || !redirectUri) {
      return res.status(400).json({ success: false, error: 'Platform credentials not configured by admin' });
    }

    const scopeParam = meta.scopes;
    const params =
      platform === 'tiktok'
        ? new URLSearchParams({
            // TikTok uses `client_key` (not `client_id`)
            client_key: clientId,
            redirect_uri: redirectUri,
            response_type: 'code',
            state,
            // TikTok expects comma-separated scopes
            scope: scopeParam,
          })
        : new URLSearchParams({
            client_id: clientId,
            redirect_uri: redirectUri,
            response_type: 'code',
            state,
            scope: scopeParam,
          });

    if (platform === 'twitter') {
      const { code_challenge, code_challenge_method } = req.query as { code_challenge?: string; code_challenge_method?: string };
      const challenge = String(code_challenge || '').trim();
      const method = String(code_challenge_method || 'S256').trim();
      if (!challenge) {
        return res.status(400).json({ success: false, error: 'Missing code_challenge (PKCE) for Twitter' });
      }
      params.set('code_challenge', challenge);
      params.set('code_challenge_method', method || 'S256');
    }

    if (platform === 'linkedin' && shouldEnableLinkedInExtendedLogin()) {
      params.set('enable_extended_login', 'true');
    }

    if (platform === 'tiktok') {
      const { code_challenge, code_challenge_method } = req.query as { code_challenge?: string; code_challenge_method?: string };
      const challenge = String(code_challenge || '').trim();
      if (challenge) {
        params.set('code_challenge', challenge);
        params.set('code_challenge_method', String(code_challenge_method || 'S256').trim() || 'S256');
      }
    }

    return res.json({ success: true, url: `${meta.authUrl}?${params.toString()}` });
  } catch (err) {
    console.error('Authorize URL error:', err);
    return res.status(500).json({ success: false, error: 'Failed to build authorization URL' });
  }
});

// GET /api/oauth/:platform/configured — check if admin has configured platform credentials (public)
app.get('/api/oauth/:platform/configured', async (req: Request, res: Response) => {
  try {
    const platform = req.params.platform.toLowerCase();
    const meta = OAUTH_AUTH_URLS[platform];
    if (!meta) return res.json({ success: true, configured: false });

    const cfg = await getPlatformConfig(platform);
    const clientId = cfg[meta.idField];
    const secretRequired = isOAuthClientSecretRequired(platform);
    const secretValue =
      platform === 'instagram' || platform === 'facebook' || platform === 'threads'
        ? cfg.appSecret
        : cfg.clientSecret;
    const redirectUri = resolveOAuthRedirectUri(platform, cfg.redirectUri, req);
    const configured = Boolean(clientId && redirectUri && (!secretRequired || secretValue));

    return res.json({ success: true, configured });
  } catch {
    return res.json({ success: true, configured: false });
  }
});

// POST /api/integrations/validate — server-side credential validation
app.post('/api/integrations/validate', async (req: Request, res: Response) => {
  try {
    const auth = requireAuth(req, res);
    if (!auth) return;

    const { platform, credentials } = req.body as { platform: string; credentials: Record<string, string> };

    switch (platform) {
      case 'wordpress': {
        const { siteUrl, username, applicationPassword } = credentials;
        const base = siteUrl.replace(/\/$/, '');
        const resp = await axios.get(`${base}/wp-json/wp/v2/users/me`, {
          auth: { username, password: applicationPassword },
          validateStatus: () => true,
          timeout: 8000,
        });
        if (resp.status === 200) return res.json({ success: true, handle: resp.data?.name || username });
        if (resp.status === 401) throw new Error('Invalid WordPress credentials');
        throw new Error(`WordPress site returned ${resp.status}`);
      }
      case 'mailchimp': {
        const { apiKey, serverPrefix } = credentials;
        const resp = await axios.get(`https://${serverPrefix}.api.mailchimp.com/3.0/`, {
          auth: { username: 'anystring', password: apiKey },
          validateStatus: () => true,
          timeout: 8000,
        });
        if (resp.status === 200) return res.json({ success: true });
        throw new Error('Invalid Mailchimp API key or server prefix');
      }
      case 'chatgpt': {
        const { apiKey } = credentials;
        const resp = await axios.get('https://api.openai.com/v1/models', {
          headers: { Authorization: `Bearer ${apiKey}` },
          validateStatus: () => true,
          timeout: 8000,
        });
        if (resp.status === 200) return res.json({ success: true });
        throw new Error('Invalid OpenAI API key');
      }
      case 'webflow': {
        const { apiToken } = credentials;
        const resp = await axios.get('https://api.webflow.com/v2/sites', {
          headers: { Authorization: `Bearer ${apiToken}` },
          validateStatus: () => true,
          timeout: 8000,
        });
        if (resp.status === 200) return res.json({ success: true });
        throw new Error('Invalid Webflow API token');
      }
      case 'stripe': {
        const { secretKey } = credentials;
        const resp = await axios.get('https://api.stripe.com/v1/account', {
          headers: { Authorization: `Bearer ${secretKey}` },
          validateStatus: () => true,
          timeout: 8000,
        });
        if (resp.status === 200) return res.json({ success: true });
        throw new Error('Invalid Stripe secret key');
      }
      case 'linear': {
        const { apiKey } = credentials;
        const resp = await axios.post(
          'https://api.linear.app/graphql',
          { query: '{ viewer { id name } }' },
          { headers: { Authorization: apiKey, 'Content-Type': 'application/json' }, validateStatus: () => true, timeout: 8000 }
        );
        if (resp.status === 200 && !resp.data?.errors) return res.json({ success: true });
        throw new Error('Invalid Linear API key');
      }
      case 'square': {
        const { accessToken } = credentials;
        const resp = await axios.get('https://connect.squareup.com/v2/locations', {
          headers: { Authorization: `Bearer ${accessToken}`, 'Square-Version': '2024-01-18' },
          validateStatus: () => true,
          timeout: 8000,
        });
        if (resp.status === 200) return res.json({ success: true });
        throw new Error('Invalid Square access token');
      }
      case 'zapier': {
        const { webhookUrl } = credentials;
        if (!webhookUrl?.startsWith('https://')) throw new Error('Invalid webhook URL');
        const resp = await axios.post(webhookUrl, { test: true, source: 'ContentFlow' }, { validateStatus: () => true, timeout: 8000 });
        if (resp.status < 400) return res.json({ success: true });
        throw new Error(`Webhook returned status ${resp.status}`);
      }
      case 'apify': {
        const apiToken = String(credentials.apiToken || credentials.token || '').trim();
        if (!apiToken) throw new Error('Missing Apify API token');
        const resp = await axios.get('https://api.apify.com/v2/users/me', {
          headers: { Authorization: `Bearer ${apiToken}` },
          validateStatus: () => true,
          timeout: 8000,
        });
        if (resp.status === 200) return res.json({ success: true, handle: resp.data?.data?.username || resp.data?.data?.email || 'Apify' });
        if (resp.status === 401 || resp.status === 403) throw new Error('Invalid Apify API token');
        throw new Error(`Apify returned ${resp.status}`);
      }
      default:
        // No validation available (Framer, Brave, etc.) — accept as-is
        return res.json({ success: true });
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Validation failed';
    return res.status(400).json({ success: false, error: message });
  }
});

// ─── Social Login OAuth Flow ───────────────────────────────────────────────────

const SOCIAL_PROVIDER_CONFIG: Record<string, { authUrl: string; tokenUrl: string; userInfoUrl: string; scopes: string }> = {
  google: {
    authUrl: 'https://accounts.google.com/o/oauth2/v2/auth',
    tokenUrl: 'https://oauth2.googleapis.com/token',
    userInfoUrl: 'https://www.googleapis.com/oauth2/v3/userinfo',
    scopes: 'openid email profile',
  },
  github: {
    authUrl: 'https://github.com/login/oauth/authorize',
    tokenUrl: 'https://github.com/login/oauth/access_token',
    userInfoUrl: 'https://api.github.com/user',
    scopes: 'read:user user:email',
  },
  microsoft: {
    authUrl: 'https://login.microsoftonline.com/{tenantId}/oauth2/v2.0/authorize',
    tokenUrl: 'https://login.microsoftonline.com/{tenantId}/oauth2/v2.0/token',
    userInfoUrl: 'https://graph.microsoft.com/v1.0/me',
    scopes: 'openid email profile',
  },
};

// GET /api/auth/:provider/start — redirect to provider's OAuth page
app.get('/api/auth/:provider/start', async (req: Request, res: Response) => {
  try {
    const { provider } = req.params as { provider: string };
    const cfg = SOCIAL_PROVIDER_CONFIG[provider];
    if (!cfg) return res.status(404).json({ success: false, error: 'Unknown provider' });

    const providerRow = await dbQuery('SELECT config, enabled FROM auth_providers WHERE provider = $1', [provider]).catch(() => ({ rows: [] }));
    if (!providerRow.rows.length || !providerRow.rows[0].enabled) {
      return res.status(403).json({ success: false, error: 'Provider not enabled' });
    }
    const config = providerRow.rows[0].config as Record<string, string>;
    const clientId = config.clientId || '';
    const redirectUri = config.redirectUri || '';
    if (!clientId || !redirectUri) return res.status(400).json({ success: false, error: 'Provider not configured' });

    const state = randomBytes(16).toString('hex');
    // Store state temporarily (10 min TTL) in DB or a small in-memory map
    (app.locals as Record<string, unknown>)[`oauth_state_${state}`] = { provider, expiry: Date.now() + 600_000 };

    let authUrl = cfg.authUrl.replace('{tenantId}', config.tenantId || 'common');
    const params = new URLSearchParams({
      client_id: clientId,
      redirect_uri: redirectUri,
      response_type: 'code',
      scope: cfg.scopes,
      state,
      access_type: 'offline',
      prompt: 'select_account',
    });
    return res.redirect(`${authUrl}?${params.toString()}`);
  } catch (error) {
    console.error('Social auth start error:', error);
    return res.status(500).json({ success: false, error: 'Failed to start social login' });
  }
});

// GET /auth/:provider/callback — handle social login (auth providers) and pass through integration callbacks to frontend SPA
app.get('/auth/:provider/callback', async (req: Request, res: Response, next) => {
  const FRONTEND_URL = process.env.VITE_APP_URL || process.env.FRONTEND_URL || 'https://marketing.dakyworld.com';
  try {
    const { provider } = req.params as { provider: string };
    const providerKey = String(provider || '').trim().toLowerCase();

    // Integration callbacks (LinkedIn/Twitter/Facebook/Instagram/Pinterest/Threads) belong to the frontend SPA path.
    if (!SOCIAL_PROVIDER_CONFIG[providerKey]) {
      const hasError = req.query['error'] || req.query['error_description'];
      if (hasError) console.error(`OAuth callback error for ${providerKey}:`, req.query);
      const query = new URLSearchParams(req.query as Record<string, string>).toString();
      const target = `${FRONTEND_URL}/auth/${encodeURIComponent(providerKey)}/callback${query ? `?${query}` : ''}`;
      return res.redirect(target);
    }

    const { code, state, error: oauthError } = req.query as Record<string, string>;
    if (oauthError) return res.redirect(`${FRONTEND_URL}/?auth_error=${encodeURIComponent(oauthError)}`);

    // Validate state
    const stateKey = `oauth_state_${state}`;
    const storedState = (app.locals as Record<string, unknown>)[stateKey] as { provider: string; expiry: number } | undefined;
    if (!storedState || storedState.provider !== provider || Date.now() > storedState.expiry) {
      return res.redirect(`${FRONTEND_URL}/?auth_error=${encodeURIComponent('Invalid or expired state')}`);
    }
    delete (app.locals as Record<string, unknown>)[stateKey];

    const cfg = SOCIAL_PROVIDER_CONFIG[provider];
    if (!cfg) return res.redirect(`${FRONTEND_URL}/?auth_error=unknown_provider`);

    const providerRow = await dbQuery('SELECT config FROM auth_providers WHERE provider = $1', [provider]).catch(() => ({ rows: [] }));
    if (!providerRow.rows.length) return res.redirect(`${FRONTEND_URL}/?auth_error=provider_not_configured`);
    const config = providerRow.rows[0].config as Record<string, string>;

    // Exchange code for token
    const tokenUrl = cfg.tokenUrl.replace('{tenantId}', config.tenantId || 'common');
    const tokenRes = await axios.post<Record<string, string>>(tokenUrl, new URLSearchParams({
      client_id: config.clientId || '',
      client_secret: config.clientSecret || '',
      code: code || '',
      redirect_uri: config.redirectUri || '',
      grant_type: 'authorization_code',
    }).toString(), {
      headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' },
    });

    const accessToken = tokenRes.data.access_token;
    if (!accessToken) throw new Error('No access token received');

    // Fetch user info
    const userInfoUrl = cfg.userInfoUrl;
    const userRes = await axios.get<Record<string, string>>(userInfoUrl, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    const userInfo = userRes.data;
    const email = userInfo.email || userInfo.mail || `${userInfo.login || 'user'}@${provider}.social`;
    const name = userInfo.name || userInfo.displayName || email.split('@')[0];
    const socialId = userInfo.sub || userInfo.id || email;

    if (!email) return res.redirect(`${FRONTEND_URL}/?auth_error=no_email`);

    // Find or create user in DB
    let userId: string;
    let userRole = 'user';
    if (hasDatabase()) {
      const existing = await dbQuery('SELECT id, role FROM users WHERE email = $1', [email]);
      if (existing.rows.length > 0) {
        userId = existing.rows[0].id as string;
        userRole = existing.rows[0].role as string;
        await dbQuery('UPDATE users SET last_login_at = NOW() WHERE id = $1', [userId]);
      } else {
        userId = randomUUID();
        const username = `${provider}_${(socialId as string).slice(0, 8)}`;
        await dbQuery(
          `INSERT INTO users (id, name, username, email, password_hash, role, status, created_at, last_login_at)
           VALUES ($1, $2, $3, $4, $5, 'user', 'active', NOW(), NOW())`,
          [userId, name, username, email, await bcrypt.hash(randomBytes(16).toString('hex'), 10)],
        );
      }
    } else {
      // In-memory fallback
      userId = randomUUID();
    }

    const token = jwt.sign({ userId, email, role: userRole }, JWT_SECRET, { expiresIn: '24h' });
    return res.redirect(`${FRONTEND_URL}/?auth_token=${token}&auth_provider=${provider}`);
  } catch (error) {
    console.error('Social auth callback error:', error);
    const FRONTEND_URL = process.env.VITE_APP_URL || process.env.FRONTEND_URL || 'https://marketing.dakyworld.com';
    return res.redirect(`${FRONTEND_URL}/?auth_error=${encodeURIComponent('Social login failed')}`);
  }
});

// ─── Auth Providers Routes ─────────────────────────────────────────────────────

// GET /api/auth/providers — public: returns only enabled providers (for login page)
app.get('/api/auth/providers', async (req: Request, res: Response) => {
  try {
    if (hasDatabase()) {
      const result = await dbQuery('SELECT provider, config FROM auth_providers WHERE enabled = true ORDER BY provider').catch((error) => {
        console.error('Auth providers query failed; falling back to empty list:', error);
        return { rows: [] as any[] } as any;
      });
      return res.json({
        success: true,
        providers: result.rows.map((r: any) => ({
          provider: r.provider as string,
          // Only return public-safe fields (client_id / app_id, not secret)
          clientId: ((r.config || {}) as Record<string, string>).clientId || '',
        })),
      });
    }
    return res.json({ success: true, providers: [] });
  } catch (error) {
    console.error('Get auth providers error:', error);
    // Never block the login page just because providers are misconfigured.
    return res.json({ success: true, providers: [] });
  }
});

// POST /api/auth/facebook/token — verify FB JS SDK access token, sign in / register user
app.post('/api/auth/facebook/token', async (req: Request, res: Response) => {
  try {
    const { accessToken } = req.body as { accessToken?: string };
    if (!accessToken) return res.status(400).json({ success: false, error: 'Access token required' });

    // Verify token and fetch profile via Graph API
    const graphRes = await axios.get<{ id: string; name?: string; email?: string }>(
      'https://graph.facebook.com/me',
      { params: { fields: 'id,name,email', access_token: accessToken } },
    );
    const { id: fbId, name: fbName, email: fbEmail } = graphRes.data;
    if (!fbId) return res.status(401).json({ success: false, error: 'Could not verify Facebook token' });

    const email = fbEmail || `fb_${fbId}@facebook.social`;
    const name  = fbName  || email.split('@')[0];

    let userId: string;
    let userRole = 'user';

    if (hasDatabase()) {
      const existing = await dbQuery('SELECT id, role FROM users WHERE email = $1', [email]);
      if (existing.rows.length > 0) {
        userId   = existing.rows[0].id as string;
        userRole = existing.rows[0].role as string;
        await dbQuery('UPDATE users SET last_login_at = NOW() WHERE id = $1', [userId]);
      } else {
        userId = randomUUID();
        const username = `fb_${fbId.slice(0, 8)}`;
        await dbQuery(
          `INSERT INTO users (id, name, username, email, password_hash, role, status, created_at, last_login_at)
           VALUES ($1, $2, $3, $4, $5, 'user', 'active', NOW(), NOW())`,
          [userId, name, username, email, await bcrypt.hash(randomBytes(16).toString('hex'), 10)],
        );
      }
    } else {
      userId = randomUUID();
    }

    const token = jwt.sign({ userId, email, role: userRole }, JWT_SECRET, { expiresIn: '7d' });
    return res.json({ success: true, token, user: { id: userId, email, name, role: userRole } });
  } catch (error) {
    console.error('Facebook token auth error:', error);
    return res.status(401).json({ success: false, error: 'Facebook authentication failed' });
  }
});

// GET /api/admin/auth-providers — admin: returns all providers with full config
app.get('/api/admin/auth-providers', async (req: Request, res: Response) => {
  try {
    const admin = await requireAdmin(req, res);
    if (!admin) return;
    if (hasDatabase()) {
      const result = await dbQuery('SELECT provider, config, enabled, updated_at FROM auth_providers ORDER BY provider');
      return res.json({ success: true, providers: result.rows });
    }
    return res.json({ success: true, providers: [] });
  } catch (error) {
    console.error('Get admin auth providers error:', error);
    return res.status(500).json({ success: false, error: 'Failed to fetch auth providers' });
  }
});

// PUT /api/admin/auth-providers/:provider — save/update provider config + enabled toggle
app.put('/api/admin/auth-providers/:provider', async (req: Request, res: Response) => {
  try {
    const admin = await requireAdmin(req, res);
    if (!admin) return;
    const { provider } = req.params as { provider: string };
    const { config, enabled } = req.body as { config: Record<string, string>; enabled: boolean };
    if (!provider) return res.status(400).json({ success: false, error: 'Provider required' });
    if (hasDatabase()) {
      await dbQuery(
        `INSERT INTO auth_providers (provider, config, enabled, updated_at)
         VALUES ($1, $2, $3, NOW())
         ON CONFLICT (provider) DO UPDATE
           SET config = EXCLUDED.config, enabled = EXCLUDED.enabled, updated_at = NOW()`,
        [provider, JSON.stringify(config ?? {}), Boolean(enabled)],
      );
      return res.json({ success: true });
    }
    return res.json({ success: true });
  } catch (error) {
    console.error('Save auth provider error:', error);
    return res.status(500).json({ success: false, error: 'Failed to save auth provider' });
  }
});

// ─── Integration Enabled List ──────────────────────────────────────────────────

// GET /api/integrations/enabled — returns list of integration IDs admin has enabled
app.get('/api/integrations/enabled', async (req: Request, res: Response) => {
  try {
    const auth = requireAuth(req, res);
    if (!auth) return;

    if (!hasDatabase()) {
      const enabled = Array.from(inMemoryPlatformConfigs.values())
        .filter((r) => r.enabled)
        .map((r) => String(r.platform || '').toLowerCase())
        .filter(Boolean);
      return res.json({ success: true, enabled });
    }

    const platformResult = await dbQuery(
      `SELECT platform
       FROM platform_configs
       WHERE enabled = true`
    );
    const providerResult = await dbQuery(
      `SELECT provider
       FROM auth_providers
       WHERE enabled = true`
    );

    const enabled = Array.from(
      new Set<string>([
        // Treat platforms as enabled if they are explicitly enabled OR if they have a non-empty config record (meaning admin configured them)
        ...platformResult.rows
          .map((r: any) => String(r.platform || '').toLowerCase())
          .filter(Boolean),
        ...providerResult.rows
          .map((r: any) => String(r.provider || '').toLowerCase())
          .filter(Boolean),
      ])
    );

    return res.json({ success: true, enabled });
  } catch (error) {
    console.error('Get enabled integrations error:', error);
    return res.status(500).json({ success: false, error: 'Failed to fetch enabled integrations' });
  }
});

// GET /api/integrations/catalog — supported integrations + admin/user status (auth required)
app.get('/api/integrations/catalog', async (req: Request, res: Response) => {
  try {
    const auth = requireAuth(req, res);
    if (!auth) return;

    const SUPPORTED_SLUGS = ['wordpress', 'facebook', 'instagram', 'linkedin', 'twitter', 'pinterest', 'mailchimp', 'tiktok', 'threads'] as const;

    const integrations: Array<{
      slug: string;
      name: string;
      type: 'cms' | 'social' | 'marketing' | 'other';
      adminEnabled: boolean;
      configured: boolean;
      connected: boolean;
      connection: Record<string, any> | null;
    }> = [];

    if (!pool) {
      for (const slug of SUPPORTED_SLUGS) {
        const configRow = inMemoryPlatformConfigs.get(slug);
        const item = {
          slug,
          name: slug === 'twitter' ? 'X (Twitter)' : slug === 'wordpress' ? 'WordPress' : slug[0].toUpperCase() + slug.slice(1),
          type: (slug === 'wordpress' ? 'cms' : slug === 'mailchimp' ? 'marketing' : 'social') as 'cms' | 'social' | 'marketing' | 'other',
          adminEnabled: configRow ? Boolean(configRow.enabled) : false,
          configured:
            slug === 'wordpress' || slug === 'mailchimp'
              ? true
              : Boolean(configRow?.config && Object.keys(configRow.config || {}).length > 0),
          connected: false,
          connection: null,
        };
        if (item.adminEnabled && item.configured) {
          integrations.push(item);
        }
      }
      return res.json({ success: true, integrations });
    }

    const configRows = await pool.query('SELECT platform, config, enabled FROM platform_configs');
    const cfgMap = new Map<string, { config: Record<string, any>; enabled: boolean }>();
    for (const r of configRows.rows as any[]) {
      const platform = String(r.platform || '').toLowerCase();
      cfgMap.set(platform, { config: r.config || {}, enabled: Boolean(r.enabled) });
    }
    const facebookPlatformConfig = cfgMap.get('facebook')?.config || {};

    const wpConnRows = await pool.query('SELECT site_url, username, created_at FROM wordpress_connections WHERE user_id=$1 LIMIT 1', [auth.userId]);
    const wpConn = wpConnRows.rows[0] || null;

    const socialRows = await pool.query(
      `SELECT platform, account_type, account_id, account_name, handle, connected, created_at
       FROM social_accounts
       WHERE user_id=$1 AND connected=true`,
      [auth.userId]
    );

    const userIntegrationRows = await pool.query(
      `SELECT i.slug, ui.status, ui.account_id, ui.account_name, ui.created_at
       FROM user_integrations ui
       JOIN integrations i ON i.id = ui.integration_id
       WHERE ui.user_id = $1`,
      [auth.userId]
    );
    const userIntegrationMap = new Map<string, any>();
    for (const r of userIntegrationRows.rows as any[]) {
      userIntegrationMap.set(String(r.slug || '').toLowerCase(), r);
    }

    const hasPlatformProfile = (slug: string) =>
      (socialRows.rows as any[]).some((r) => normalizePlatformId(r.platform) === slug && (r.account_type === 'profile' || !r.account_type));

    const getPrimaryAccount = (slug: string) => {
      const match = (socialRows.rows as any[]).find((r) => normalizePlatformId(r.platform) === slug);
      if (!match) return null;
      return {
        accountType: match.account_type || 'profile',
        accountId: match.account_id || null,
        accountName: match.account_name || null,
        username: match.handle || null,
        connectedAt: match.created_at || null,
      };
    };

    for (const slug of SUPPORTED_SLUGS) {
      const registry = await getIntegrationRowBySlug(slug);
      const name =
        registry?.name ||
        (slug === 'twitter' ? 'X (Twitter)' : slug === 'wordpress' ? 'WordPress' : slug[0].toUpperCase() + slug.slice(1));
      const type = (registry?.type as any) || (slug === 'wordpress' ? 'cms' : 'social');

      const cfg = cfgMap.get(slug)?.config || {};
      const adminEnabledRaw = cfgMap.has(slug) ? Boolean(cfgMap.get(slug)?.enabled) : slug === 'wordpress' || slug === 'mailchimp';
      const hasConfig = Object.keys(cfg || {}).length > 0;
      const adminEnabled = adminEnabledRaw;

      let configured = false;
      if (slug === 'wordpress') {
        configured = true;
      } else if (slug === 'mailchimp') {
        configured = true;
      } else if (slug === 'instagram') {
        const metaConfig = Object.keys(cfg || {}).length > 0 ? cfg : facebookPlatformConfig;
        const clientId = String((metaConfig as any).appId || '').trim();
        const redirectUri = resolveOAuthRedirectUri('facebook', String((facebookPlatformConfig as any).redirectUri || (metaConfig as any).redirectUri || ''), req);
        const secretValue = String((metaConfig as any).appSecret || (facebookPlatformConfig as any).appSecret || '').trim();
        configured = Boolean(clientId && redirectUri && secretValue);
      } else {
        const meta = OAUTH_AUTH_URLS[slug];
        if (meta) {
          const clientId = String((cfg as any)[meta.idField] || '').trim();
          const redirectUri = resolveOAuthRedirectUri(slug, String((cfg as any).redirectUri || ''), req);
          const secretRequired = isOAuthClientSecretRequired(slug);
          const secretValue = String((cfg as any).clientSecret || (cfg as any).appSecret || '').trim();
          configured = Boolean(clientId && redirectUri && (!secretRequired || secretValue));
        }
      }

      const connected =
        slug === 'wordpress'
          ? Boolean(wpConn)
          : slug === 'mailchimp'
            ? String(userIntegrationMap.get('mailchimp')?.status || '').toLowerCase() === 'connected'
            : slug === 'instagram'
              ? Boolean(getPrimaryAccount('instagram'))
              : hasPlatformProfile(slug);

      const connection =
        slug === 'wordpress'
          ? wpConn
            ? { siteUrl: wpConn.site_url, username: wpConn.username, connectedAt: wpConn.created_at }
            : null
          : slug === 'mailchimp'
            ? userIntegrationMap.get('mailchimp')
              ? {
                  accountId: userIntegrationMap.get('mailchimp')?.account_id ?? null,
                  accountName: userIntegrationMap.get('mailchimp')?.account_name ?? null,
                  connectedAt: userIntegrationMap.get('mailchimp')?.created_at ?? null,
                }
              : null
            : getPrimaryAccount(slug);

      if (adminEnabled && configured) {
        integrations.push({ slug, name, type, adminEnabled, configured, connected, connection });
      }
    }

    return res.json({ success: true, integrations });
  } catch (error) {
    console.error('Get integration catalog error:', error);
    return res.status(500).json({ success: false, error: 'Failed to fetch integrations' });
  }
});

// ── API v1: Social Automation endpoints ─────────────────────────────────────────

// GET /api/v1/social/facebook/connect — start OAuth and redirect to Facebook
app.get('/api/v1/social/facebook/connect', async (req: Request, res: Response) => {
  try {
    const auth = requireAuth(req, res);
    if (!auth) return;
    if (!pool) return res.status(503).send('Database not configured');

    const cfg = await getPlatformConfig('facebook');
    const clientId = String(cfg.appId || process.env.VITE_FACEBOOK_APP_ID || '').trim();
    const clientSecret = String(cfg.appSecret || process.env.FACEBOOK_APP_SECRET || '').trim();
    if (!clientId || !clientSecret) return res.status(400).send('Facebook integration not configured');

    const state = randomUUID();
    const returnTo = String((req.query as any)?.returnTo || '').trim() || '/posts?view=automation&subtab=connections';

    await dbQuery(
      `INSERT INTO oauth_states (state, user_id, platform, return_to, created_at, expires_at)
       VALUES ($1, $2, 'facebook', $3, NOW(), NOW() + INTERVAL '15 minutes')
       ON CONFLICT (state) DO NOTHING`,
      [state, auth.userId, returnTo]
    );

    const redirectUri = resolveBackendRedirectUri('/api/v1/social/facebook/callback', req);
    const scope = getMetaOAuthScopeString();

    const oauthUrl = new URL('https://www.facebook.com/v19.0/dialog/oauth');
    oauthUrl.searchParams.set('client_id', clientId);
    oauthUrl.searchParams.set('redirect_uri', redirectUri);
    oauthUrl.searchParams.set('state', state);
    oauthUrl.searchParams.set('response_type', 'code');
    oauthUrl.searchParams.set('scope', scope);

    return res.redirect(oauthUrl.toString());
  } catch (err) {
    console.error('v1 facebook connect error:', err);
    return res.status(500).send('Failed to start Facebook connection');
  }
});

// GET /api/v1/social/facebook/authorize-url — build OAuth URL (for SPAs using Bearer auth)
app.get('/api/v1/social/facebook/authorize-url', async (req: Request, res: Response) => {
  try {
    const auth = requireAuth(req, res);
    if (!auth) return;
    if (!pool) return res.status(503).json({ success: false, error: 'Database not configured' });

    const cfg = await getPlatformConfig('facebook');
    const clientId = String(cfg.appId || process.env.VITE_FACEBOOK_APP_ID || '').trim();
    const clientSecret = String(cfg.appSecret || process.env.FACEBOOK_APP_SECRET || '').trim();
    if (!clientId || !clientSecret) return res.status(400).json({ success: false, error: 'Facebook integration not configured' });

    const state = randomUUID();
    const returnTo = String((req.query as any)?.returnTo || '').trim() || '/posts?view=automation&subtab=connections';

    await dbQuery(
      `INSERT INTO oauth_states (state, user_id, platform, return_to, created_at, expires_at)
       VALUES ($1, $2, 'facebook', $3, NOW(), NOW() + INTERVAL '15 minutes')
       ON CONFLICT (state) DO NOTHING`,
      [state, auth.userId, returnTo]
    );

    const redirectUri = resolveBackendRedirectUri('/api/v1/social/facebook/callback', req);
    const scope = [
      'public_profile',
      'email',
      'pages_show_list',
      'pages_read_engagement',
      'pages_manage_posts',
      'pages_manage_metadata',
      'read_insights',
    ].join(',');

    const oauthUrl = new URL('https://www.facebook.com/v19.0/dialog/oauth');
    oauthUrl.searchParams.set('client_id', clientId);
    oauthUrl.searchParams.set('redirect_uri', redirectUri);
    oauthUrl.searchParams.set('state', state);
    oauthUrl.searchParams.set('response_type', 'code');
    oauthUrl.searchParams.set('scope', scope);

    return res.json({ success: true, url: oauthUrl.toString() });
  } catch (err) {
    console.error('v1 facebook authorize-url error:', err);
    return res.status(500).json({ success: false, error: 'Failed to build authorize URL' });
  }
});

// GET /api/v1/social/facebook/callback — OAuth redirect URI
app.get('/api/v1/social/facebook/callback', async (req: Request, res: Response) => {
  const FRONTEND_URL = process.env.VITE_APP_URL || process.env.FRONTEND_URL || 'https://marketing.dakyworld.com';
  const fallbackOk = `${FRONTEND_URL}/posts?view=automation&subtab=connections`;
  const fallbackErr = (msg: string) => `${FRONTEND_URL}/posts?view=automation&subtab=connections&error=${encodeURIComponent(msg)}`;

  try {
    const oauthError = String((req.query as any).error || '').trim();
    const oauthErrorDesc = String((req.query as any).error_description || '').trim();
    if (oauthError) return res.redirect(fallbackErr(oauthErrorDesc || oauthError));

    const code = String((req.query as any).code || '').trim();
    const state = String((req.query as any).state || '').trim();
    if (!code || !state) return res.redirect(fallbackErr('Missing code or state'));
    if (!pool) return res.redirect(fallbackErr('Database not configured'));

    const stateRow = await getOAuthStateRow(state);
    if (!stateRow) return res.redirect(fallbackErr('Invalid or expired state'));
    if (String(stateRow.platform || '').trim().toLowerCase() !== 'facebook') return res.redirect(fallbackErr('State/platform mismatch'));

    const redirectUri = resolveBackendRedirectUri('/api/v1/social/facebook/callback', req);
    const tokenData = await exchangeFacebookCode(code, redirectUri);

    // Exchange short-lived user token for a long-lived one (~60 days)
    const shortToken = String(tokenData?.access_token || '').trim();
    if (shortToken) {
      try {
        const cfg2 = await getPlatformConfig('facebook');
        const appId = String(cfg2.appId || process.env.VITE_FACEBOOK_APP_ID || '').trim();
        const appSecret = String(cfg2.appSecret || process.env.FACEBOOK_APP_SECRET || '').trim();
        if (appId && appSecret) {
          const llResp = await axios.get('https://graph.facebook.com/v19.0/oauth/access_token', {
            params: {
              grant_type: 'fb_exchange_token',
              client_id: appId,
              client_secret: appSecret,
              fb_exchange_token: shortToken,
            },
            validateStatus: () => true,
            timeout: 15000,
          });
          const llData: any = llResp.data || {};
          if (llResp.status < 400 && llData.access_token) {
            tokenData.access_token = llData.access_token;
            tokenData.expires_in = llData.expires_in || 60 * 24 * 3600;
          }
        }
      } catch {
        // best-effort; use short-lived token if exchange fails
      }
    }

    await storeUserConnection(stateRow.user_id, 'facebook', tokenData);
    await dbQuery('DELETE FROM oauth_states WHERE state = $1', [state]).catch(() => undefined);

    const returnTo = (stateRow as any).return_to as string | null | undefined;
    const dest = returnTo && returnTo.startsWith('/') ? `${FRONTEND_URL}${returnTo}` : fallbackOk;
    return res.redirect(dest);
  } catch (err) {
    console.error('v1 facebook callback error:', err);
    const msg = err instanceof Error ? err.message : 'Facebook OAuth failed';
    return res.redirect(fallbackErr(msg));
  }
});

// GET /api/v1/social/facebook/pages — list managed pages (Graph API /me/accounts)
app.get('/api/v1/social/facebook/pages', async (req: Request, res: Response) => {
  try {
    const auth = requireAuth(req, res);
    if (!auth) return;
    if (!pool) return res.status(503).json({ success: false, error: 'Database not configured' });

    const conn = await getPublishableSocialConnection(auth.userId, 'facebook');
    const accessToken = String(conn?.access_token || '').trim();
    if (!accessToken) return res.status(400).json({ success: false, error: 'Facebook access token missing or expired — please reconnect' });

    const graphBase = 'https://graph.facebook.com/v19.0';
    const requiredPermissions = ['pages_show_list', 'pages_manage_posts'];
    let missingPermissions: string[] = [];
    try {
      const permsResp = await axios.get(
        `${graphBase}/me/permissions?access_token=${encodeURIComponent(accessToken)}`,
        { validateStatus: () => true, timeout: 15000 }
      );
      if (permsResp.status < 400) {
        const perms = Array.isArray((permsResp.data as any)?.data) ? (permsResp.data as any).data : [];
        const granted = new Set(
          perms
            .filter((p: any) => String(p?.status || '').toLowerCase() === 'granted')
            .map((p: any) => String(p?.permission || '').toLowerCase())
            .filter(Boolean)
        );
        missingPermissions = requiredPermissions.filter((perm) => !granted.has(perm));
      }
    } catch {
      missingPermissions = [];
    }

    const pagesResp = await axios.get(
      `${graphBase}/me/accounts?fields=id,name,tasks,picture.width(128).height(128)&limit=200&access_token=${encodeURIComponent(accessToken)}`,
      { validateStatus: () => true, timeout: 15000 }
    );
    const pagesData: any = pagesResp.data || {};
    if (pagesResp.status >= 400) {
      const msg = pagesData?.error?.message || `Facebook API error ${pagesResp.status}`;
      return res.status(400).json({ success: false, error: msg });
    }
    const pages = Array.isArray(pagesData?.data)
      ? pagesData.data
          .map((p: any) => {
            const tasks = Array.isArray(p?.tasks) ? p.tasks.map((t: any) => String(t)) : [];
            const canPublish = tasks.includes('CREATE_CONTENT') || tasks.includes('MANAGE');
            return {
              id: String(p?.id || '').trim(),
              name: String(p?.name || '').trim(),
              picture: p?.picture?.data?.url ? String(p.picture.data.url) : null,
              tasks,
              can_publish: canPublish,
            };
          })
          .filter((p: any) => p.id)
      : [];

    return res.json({ success: true, pages, missingPermissions });
  } catch (err) {
    console.error('v1 facebook pages error:', err);
    return res.status(500).json({ success: false, error: 'Failed to fetch Facebook pages' });
  }
});

// GET /api/v1/social/facebook/targets — list Pages + Groups (best-effort)
app.get('/api/v1/social/facebook/targets', async (req: Request, res: Response) => {
  try {
    const auth = requireAuth(req, res);
    if (!auth) return;
    if (!pool) return res.status(503).json({ success: false, error: 'Database not configured' });

    const conn = await getPublishableSocialConnection(auth.userId, 'facebook');
    const accessToken = String(conn?.access_token || '').trim();
    if (!accessToken) return res.status(400).json({ success: false, error: 'Facebook access token missing or expired — please reconnect' });

    const graphBase = 'https://graph.facebook.com/v19.0';
    const requiredPermissions = ['pages_show_list', 'pages_manage_posts'];
    let missingPermissions: string[] = [];
    const warnings: string[] = [];

    try {
      const permsResp = await axios.get(
        `${graphBase}/me/permissions?access_token=${encodeURIComponent(accessToken)}`,
        { validateStatus: () => true, timeout: 15000 }
      );
      if (permsResp.status < 400) {
        const perms = Array.isArray((permsResp.data as any)?.data) ? (permsResp.data as any).data : [];
        const granted = new Set(
          perms
            .filter((p: any) => String(p?.status || '').toLowerCase() === 'granted')
            .map((p: any) => String(p?.permission || '').toLowerCase())
            .filter(Boolean)
        );
        missingPermissions = requiredPermissions.filter((perm) => !granted.has(perm));
      }
    } catch {
      missingPermissions = [];
    }

    const pagesResp = await axios.get(
      `${graphBase}/me/accounts?fields=id,name,tasks,picture.width(128).height(128)&limit=200&access_token=${encodeURIComponent(accessToken)}`,
      { validateStatus: () => true, timeout: 15000 }
    );
    const pagesData: any = pagesResp.data || {};
    if (pagesResp.status >= 400) {
      const msg = pagesData?.error?.message || `Facebook API error ${pagesResp.status}`;
      return res.status(400).json({ success: false, error: msg });
    }
    const pages = Array.isArray(pagesData?.data)
      ? pagesData.data
          .map((p: any) => {
            const tasks = Array.isArray(p?.tasks) ? p.tasks.map((t: any) => String(t)) : [];
            const canPublish = tasks.includes('CREATE_CONTENT') || tasks.includes('MANAGE');
            return {
              id: String(p?.id || '').trim(),
              name: String(p?.name || '').trim(),
              picture: p?.picture?.data?.url ? String(p.picture.data.url) : null,
              tasks,
              can_publish: canPublish,
            };
          })
          .filter((p: any) => p.id)
      : [];

    let groups: Array<{ id: string; name: string }> = [];
    try {
      const groupsResp = await axios.get(
        `${graphBase}/me/groups?fields=id,name&limit=200&access_token=${encodeURIComponent(accessToken)}`,
        { validateStatus: () => true, timeout: 15000 }
      );
      const groupsData: any = groupsResp.data || {};
      if (groupsResp.status >= 400) {
        const msg = groupsData?.error?.message || `Facebook groups lookup failed (${groupsResp.status})`;
        warnings.push(msg);
      } else {
        groups = Array.isArray(groupsData?.data)
          ? groupsData.data
              .map((g: any) => ({ id: String(g?.id || '').trim(), name: String(g?.name || '').trim() }))
              .filter((g: any) => g.id)
          : [];
      }
    } catch {
      warnings.push('Facebook groups lookup failed');
    }

    return res.json({ success: true, pages, groups, missingPermissions, warnings });
  } catch (err) {
    console.error('v1 facebook targets error:', err);
    return res.status(500).json({ success: false, error: 'Failed to fetch Facebook targets' });
  }
});

// GET /api/v1/social/facebook/page-insights — page-level metrics for a specific date range
app.get('/api/v1/social/facebook/page-insights', async (req: Request, res: Response) => {
  try {
    const auth = requireAuth(req, res);
    if (!auth) return;
    if (!pool) return res.status(503).json({ success: false, error: 'Database not configured' });

    const pageId = String((req.query as any).page_id || '').trim();
    const since = String((req.query as any).since || '').trim(); // YYYY-MM-DD
    const until = String((req.query as any).until || '').trim(); // YYYY-MM-DD
    const period = String((req.query as any).period || 'day').trim(); // day | week | days_28 | month

    if (!pageId) return res.status(400).json({ success: false, error: 'page_id is required' });

    // Get page token from stored social_accounts or fall back to user token
    const pageResult = await pool.query(
      `SELECT access_token, access_token_encrypted
       FROM social_accounts
       WHERE user_id=$1 AND platform='facebook' AND account_type='page' AND account_id=$2 AND connected=true
       LIMIT 1`,
      [auth.userId, pageId]
    );
    const pageRow: any = pageResult.rows[0] || {};
    let pageToken = '';
    if (pageRow.access_token_encrypted) {
      try { pageToken = decryptIntegrationSecret(String(pageRow.access_token_encrypted)); } catch { /* ignore */ }
    }
    if (!pageToken) pageToken = String(pageRow.access_token || '').trim();
    if (!pageToken) {
      const conn = await getPublishableSocialConnection(auth.userId, 'facebook');
      pageToken = String(conn?.access_token || '').trim();
    }
    if (!pageToken) return res.status(400).json({ success: false, error: 'Facebook page token not available — reconnect the page' });

    const graphBase = 'https://graph.facebook.com/v19.0';
    const metrics = [
      'page_impressions',
      'page_impressions_unique',
      'page_engaged_users',
      'page_post_engagements',
      'page_fan_adds',
      'page_fan_removes',
      'page_views_total',
      'page_actions_post_reactions_total',
    ].join(',');

    const params: Record<string, string> = { metric: metrics, period, access_token: pageToken };
    if (since) params.since = since;
    if (until) params.until = until;

    const insightsResp = await axios.get(`${graphBase}/${encodeURIComponent(pageId)}/insights`, {
      params,
      validateStatus: () => true,
      timeout: 20000,
    });
    const insightsData: any = insightsResp.data || {};
    if (insightsResp.status >= 400) {
      const msg = insightsData?.error?.message || `Facebook Insights API error ${insightsResp.status}`;
      return res.status(400).json({ success: false, error: msg });
    }

    // Also fetch page fans total (lifetime metric)
    const fansResp = await axios.get(`${graphBase}/${encodeURIComponent(pageId)}/insights`, {
      params: { metric: 'page_fans', period: 'lifetime', access_token: pageToken },
      validateStatus: () => true,
      timeout: 15000,
    });
    const fansData: any = fansResp.data || {};
    const totalFans = fansData?.data?.[0]?.values?.[0]?.value ?? null;

    return res.json({
      success: true,
      pageId,
      period,
      totalFans,
      insights: insightsData.data || [],
      paging: insightsData.paging || null,
    });
  } catch (err) {
    console.error('v1 facebook page-insights error:', err);
    return res.status(500).json({ success: false, error: 'Failed to fetch page insights' });
  }
});

// GET /api/v1/social/facebook/post-insights — per-post metrics (reactions, reach, engagement)
app.get('/api/v1/social/facebook/post-insights', async (req: Request, res: Response) => {
  try {
    const auth = requireAuth(req, res);
    if (!auth) return;
    if (!pool) return res.status(503).json({ success: false, error: 'Database not configured' });

    const postId = String((req.query as any).post_id || '').trim();
    if (!postId) return res.status(400).json({ success: false, error: 'post_id is required' });

    // Derive page ID from post_id (format: pageId_postId)
    const pageId = postId.includes('_') ? postId.split('_')[0] : '';

    // Resolve page token
    let pageToken = '';
    if (pageId && pool) {
      const pr = await pool.query(
        `SELECT access_token, access_token_encrypted
         FROM social_accounts
         WHERE user_id=$1 AND platform='facebook' AND account_type='page' AND account_id=$2 AND connected=true
         LIMIT 1`,
        [auth.userId, pageId]
      );
      const row: any = pr.rows[0] || {};
      if (row.access_token_encrypted) {
        try { pageToken = decryptIntegrationSecret(String(row.access_token_encrypted)); } catch { /* ignore */ }
      }
      if (!pageToken) pageToken = String(row.access_token || '').trim();
    }
    if (!pageToken) {
      const conn = await getPublishableSocialConnection(auth.userId, 'facebook');
      pageToken = String(conn?.access_token || '').trim();
    }
    if (!pageToken) return res.status(400).json({ success: false, error: 'Facebook token not available — reconnect' });

    const graphBase = 'https://graph.facebook.com/v19.0';

    // Fetch post insights metrics
    const insightsResp = await axios.get(`${graphBase}/${encodeURIComponent(postId)}/insights`, {
      params: {
        metric: 'post_impressions,post_impressions_unique,post_engaged_users,post_clicks,post_reactions_by_type_total',
        access_token: pageToken,
      },
      validateStatus: () => true,
      timeout: 15000,
    });
    const insightsData: any = insightsResp.data || {};

    // Fetch reactions/comments/shares from post object
    const postResp = await axios.get(`${graphBase}/${encodeURIComponent(postId)}`, {
      params: {
        fields: 'message,created_time,reactions.summary(true),comments.summary(true),shares,full_picture',
        access_token: pageToken,
      },
      validateStatus: () => true,
      timeout: 15000,
    });
    const postData: any = postResp.data || {};
    if (postResp.status >= 400) {
      const msg = postData?.error?.message || `Facebook post lookup failed (${postResp.status})`;
      return res.status(400).json({ success: false, error: msg });
    }

    const metrics: Record<string, number> = {};
    for (const item of insightsData?.data || []) {
      metrics[item.name] = item.values?.[0]?.value ?? 0;
    }

    return res.json({
      success: true,
      postId,
      post: {
        message: postData.message || null,
        createdTime: postData.created_time || null,
        picture: postData.full_picture || null,
      },
      metrics: {
        impressions: metrics['post_impressions'] ?? null,
        reach: metrics['post_impressions_unique'] ?? null,
        engagedUsers: metrics['post_engaged_users'] ?? null,
        clicks: metrics['post_clicks'] ?? null,
        reactions: postData?.reactions?.summary?.total_count ?? null,
        comments: postData?.comments?.summary?.total_count ?? null,
        shares: postData?.shares?.count ?? null,
      },
      rawInsights: insightsData.data || [],
    });
  } catch (err) {
    console.error('v1 facebook post-insights error:', err);
    return res.status(500).json({ success: false, error: 'Failed to fetch post insights' });
  }
});

// POST /api/v1/social/facebook/token-refresh — manually exchange token for a fresh long-lived one
app.post('/api/v1/social/facebook/token-refresh', async (req: Request, res: Response) => {
  try {
    const auth = requireAuth(req, res);
    if (!auth) return;
    if (!pool) return res.status(503).json({ success: false, error: 'Database not configured' });

    const conn = await getPublishableSocialConnection(auth.userId, 'facebook');
    const currentToken = String(conn?.access_token || '').trim();
    if (!currentToken) return res.status(400).json({ success: false, error: 'Facebook not connected' });

    const cfg = await getPlatformConfig('facebook');
    const appId = String(cfg.appId || process.env.VITE_FACEBOOK_APP_ID || '').trim();
    const appSecret = String(cfg.appSecret || process.env.FACEBOOK_APP_SECRET || '').trim();
    if (!appId || !appSecret) return res.status(500).json({ success: false, error: 'Facebook app credentials not configured' });

    const resp = await axios.get('https://graph.facebook.com/v19.0/oauth/access_token', {
      params: {
        grant_type: 'fb_exchange_token',
        client_id: appId,
        client_secret: appSecret,
        fb_exchange_token: currentToken,
      },
      validateStatus: () => true,
      timeout: 15000,
    });
    const data: any = resp.data || {};
    if (resp.status >= 400 || !data.access_token) {
      const msg = data?.error?.message || 'Facebook token refresh failed';
      return res.status(400).json({ success: false, error: msg });
    }

    const expiresIn = Number(data.expires_in || 60 * 24 * 3600);
    const expiresAt = new Date(Date.now() + expiresIn * 1000).toISOString();
    const newToken = String(data.access_token).trim();
    const encryptedToken = encryptIntegrationSecret(newToken);

    await pool.query(
      `UPDATE social_accounts
       SET access_token = NULL,
           access_token_encrypted = $2,
           token_expires_at = $3,
           expires_at = $3,
           needs_reapproval = false,
           updated_at = NOW()
       WHERE user_id = $1 AND platform = 'facebook' AND account_type = 'profile'`,
      [auth.userId, encryptedToken, expiresAt]
    );

    await logIntegrationEvent({
      userId: auth.userId,
      integrationSlug: 'facebook',
      eventType: 'token_refresh',
      status: 'success',
      response: { expiresAt },
    });

    return res.json({ success: true, expiresAt, message: 'Facebook token refreshed successfully' });
  } catch (err) {
    console.error('v1 facebook token-refresh error:', err);
    return res.status(500).json({ success: false, error: 'Failed to refresh Facebook token' });
  }
});

// POST /api/v1/social/accounts — save an account target (page/profile/etc)
app.post('/api/v1/social/accounts', async (req: Request, res: Response) => {
  try {
    const auth = requireAuth(req, res);
    if (!auth) return;
    if (!pool) return res.status(503).json({ success: false, error: 'Database not configured' });

    const { platform, account_type, account_id, account_name } = req.body as {
      platform: string;
      account_type: string;
      account_id: string;
      account_name: string;
    };

    const platformSlug = normalizePlatformId(String(platform || ''));
    const accountType = String(account_type || '').trim().toLowerCase();
    const accountId = String(account_id || '').trim();
    const accountName = String(account_name || '').trim();

    if (!platformSlug) return res.status(400).json({ success: false, error: 'platform is required' });
    if (!accountType) return res.status(400).json({ success: false, error: 'account_type is required' });
    if (!accountId) return res.status(400).json({ success: false, error: 'account_id is required' });
    if (!accountName) return res.status(400).json({ success: false, error: 'account_name is required' });

    const plat = await pool.query<{ id: number }>('SELECT id FROM social_platforms WHERE slug=$1', [platformSlug]);
    const platformDbId = plat.rows[0]?.id ?? null;

    let profileImage: string | null = null;
    let accessTokenToStore: string | null = null;
    let tokenExpiresAtToStore: string | null = null;
    let accessTokenEncryptedToStore: string | null = null;

    // Facebook: when saving a Page target, fetch the Page access_token from /me/accounts using the user's profile token.
    if (platformSlug === 'facebook' && accountType === 'page') {
      const conn = await getPublishableSocialConnection(auth.userId, 'facebook');
      const profileToken = String(conn?.access_token || '').trim();
      if (!profileToken) return res.status(400).json({ success: false, error: 'Facebook access token missing or expired — please reconnect' });

      const graphBase = 'https://graph.facebook.com/v19.0';
      const pagesResp = await axios.get(
        `${graphBase}/me/accounts?fields=id,name,access_token,tasks,picture.width(128).height(128)&limit=200&access_token=${encodeURIComponent(profileToken)}`,
        { validateStatus: () => true, timeout: 15000 }
      );
      const pagesData: any = pagesResp.data || {};
      if (pagesResp.status >= 400) {
        const msg = pagesData?.error?.message || `Facebook API error ${pagesResp.status}`;
        return res.status(400).json({ success: false, error: msg });
      }
      const pages: any[] = Array.isArray(pagesData?.data) ? pagesData.data : [];
      const match = pages.find((p: any) => String(p?.id || '').trim() === accountId);
      if (!match) return res.status(400).json({ success: false, error: 'Selected Facebook Page not found or access not available' });
      const tasks = Array.isArray(match?.tasks) ? match.tasks.map((t: any) => String(t)) : [];
      const canPublish = tasks.includes('CREATE_CONTENT') || tasks.includes('MANAGE');
      if (!canPublish) {
        return res.status(400).json({
          success: false,
          error: 'You do not have permission to publish to this Facebook Page. Ask for Editor/Admin access.',
        });
      }
      accessTokenToStore = String(match?.access_token || '').trim() || null;
      profileImage = match?.picture?.data?.url ? String(match.picture.data.url) : null;
      tokenExpiresAtToStore = null;
      if (!accessTokenToStore) return res.status(400).json({ success: false, error: 'Facebook Page access token not available' });
      accessTokenEncryptedToStore = encryptIntegrationSecret(accessTokenToStore);
      accessTokenToStore = null;
    }

    const id = randomUUID();
    let existingUpdate;
    if (accountType === 'profile') {
      existingUpdate = await pool.query(
        `UPDATE social_accounts
         SET account_name = $5,
             account_id = $6,
             platform_id = $3,
             profile_image = COALESCE($7, profile_image),
             token_expires_at = COALESCE($8, token_expires_at),
             access_token = COALESCE($9, access_token),
             access_token_encrypted = COALESCE($10, access_token_encrypted),
             connected = true,
             connected_at = NOW()
         WHERE user_id = $1 AND platform = $2 AND account_type = $4`,
        [auth.userId, platformSlug, platformDbId, accountType, accountName, accountId, profileImage, tokenExpiresAtToStore, accessTokenToStore, accessTokenEncryptedToStore]
      );
    } else {
      existingUpdate = await pool.query(
        `UPDATE social_accounts
         SET account_name = $5,
             platform_id = $3,
             profile_image = COALESCE($7, profile_image),
             token_expires_at = COALESCE($8, token_expires_at),
             access_token = COALESCE($9, access_token),
             access_token_encrypted = COALESCE($10, access_token_encrypted),
             connected = true,
             connected_at = NOW()
         WHERE user_id = $1 AND platform = $2 AND account_type = $4 AND account_id = $6`,
        [auth.userId, platformSlug, platformDbId, accountType, accountName, accountId, profileImage, tokenExpiresAtToStore, accessTokenToStore, accessTokenEncryptedToStore]
      );
    }
    if (existingUpdate.rowCount === 0) {
      await pool.query(
        `INSERT INTO social_accounts (id, user_id, platform, platform_id, account_type, account_id, account_name, profile_image, token_expires_at, access_token, access_token_encrypted, connected, connected_at, created_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,true,NOW(),NOW())`,
        [id, auth.userId, platformSlug, platformDbId, accountType, accountId, accountName, profileImage, tokenExpiresAtToStore, accessTokenToStore, accessTokenEncryptedToStore]
      );
    }

    const row = await pool.query(
      `SELECT id, platform, account_type, account_id, account_name, profile_image, created_at
       FROM social_accounts
       WHERE user_id=$1 AND platform=$2 AND account_type=$3
         ${accountType === 'profile' ? '' : 'AND account_id=$4'}`,
      accountType === 'profile'
        ? [auth.userId, platformSlug, accountType]
        : [auth.userId, platformSlug, accountType, accountId]
    );

    const saved = row.rows[0];
    if (saved?.id) {
      const upsertConn = await pool.query(
        `UPDATE social_connections
         SET active = true
         WHERE user_id = $1 AND social_account_id = $2`,
        [auth.userId, saved.id]
      );
      if (upsertConn.rowCount === 0) {
        await pool.query(
          `INSERT INTO social_connections (id, user_id, social_account_id, active, created_at)
           VALUES ($1,$2,$3,true,NOW())`,
          [randomUUID(), auth.userId, saved.id]
        ).catch(() => undefined);
      }
    }

    if (platformSlug === 'facebook' && accountType === 'page') {
      try {
        const current = (await getUserSettingValue(auth.userId, 'posts-automation-settings')) || {};
        const next = {
          ...(current || {}),
          facebookTarget: 'page',
          selectedAccountMap: {
            ...(current?.selectedAccountMap || {}),
            facebook: `page:${accountId}`,
          },
        };
        await dbQuery(
          `INSERT INTO user_settings (user_id, key, value, created_at, updated_at)
           VALUES ($1, $2, $3::jsonb, NOW(), NOW())
           ON CONFLICT (user_id, key) DO UPDATE SET value = EXCLUDED.value, updated_at = NOW()`,
          [auth.userId, 'posts-automation-settings', JSON.stringify(next)]
        );
      } catch {
        // ignore settings persistence failures
      }
    }

    return res.json({ success: true, account: saved });
  } catch (err) {
    console.error('v1 save social account error:', {error: String(err instanceof Error ? err.message : err), stack: err instanceof Error ? err.stack : undefined});
    return res.status(500).json({ success: false, error: err instanceof Error ? err.message : 'Failed to save account' });
  }
});

// GET /api/v1/social/accounts — list saved accounts (only admin-enabled platforms)
app.get('/api/v1/social/accounts', async (req: Request, res: Response) => {
  try {
    const auth = requireAuth(req, res);
    if (!auth) return;
    if (!hasDatabase()) return res.status(503).json({ success: false, error: 'Database not configured' });

    // Ensure WordPress is represented as a social account so it can be selected in the post automation flow.
    await ensureWordPressSocialAccount(auth.userId);
    const visiblePlatforms = await getVisibleUserPlatformSlugs();

    let query = `SELECT id, platform, platform_id, account_type, account_id, account_name, profile_image, connected, created_at
       FROM social_accounts
       WHERE user_id=$1 AND connected=true`;
    const params: any[] = [auth.userId];
    
    if (visiblePlatforms.length > 0) {
      query += ` AND LOWER(platform) = ANY($2)`;
      params.push(visiblePlatforms);
    }
    
    query += ` ORDER BY created_at DESC`;
    
    const { rows } = await pool!.query(query, params);
    return res.json({ success: true, accounts: rows });
  } catch (err) {
    console.error('v1 list social accounts error:', err);
    return res.status(500).json({ success: false, error: 'Failed to list accounts' });
  }
});

// DELETE /api/v1/social/accounts/:id — delete a saved account
app.delete('/api/v1/social/accounts/:id', async (req: Request, res: Response) => {
  try {
    const auth = requireAuth(req, res);
    if (!auth) return;
    if (!hasDatabase()) return res.status(503).json({ success: false, error: 'Database not configured' });

    const { id } = req.params;
    const result = await pool!.query('DELETE FROM social_accounts WHERE id=$1 AND user_id=$2', [String(id), auth.userId]);
    if (result.rowCount === 0) return res.status(404).json({ success: false, error: 'Not found' });
    return res.json({ success: true });
  } catch (err) {
    console.error('v1 delete social account error:', err);
    return res.status(500).json({ success: false, error: 'Failed to delete account' });
  }
});

// POST /api/v1/posts/:postId/social-repost — queue an immediate repost (async worker)
app.post('/api/v1/posts/:postId/social-repost', async (req: Request, res: Response) => {
  try {
    const auth = requireAuth(req, res);
    if (!auth) return;
    if (!pool) return res.status(503).json({ success: false, error: 'Database not configured' });

    const { postId } = req.params;
    const postRows = await pool.query('SELECT * FROM blog_posts WHERE id=$1 AND user_id=$2', [String(postId), auth.userId]);
    if (!postRows.rows.length) return res.status(404).json({ success: false, error: 'Post not found' });

    // Optional: caller can pass specific account IDs to restrict which accounts are posted to
    const requestedAccountIds: string[] | null = Array.isArray(req.body?.accountIds) && req.body.accountIds.length > 0
      ? (req.body.accountIds as string[]).map(String).filter(Boolean)
      : null;

    const visiblePlatforms = await getVisibleUserPlatformSlugs();
    const publishablePlatforms = new Set(['linkedin', 'pinterest', 'threads', 'twitter', 'tiktok']);

    let sourceRows: any[];
    if (requestedAccountIds) {
      // Post only to the explicitly selected accounts (must belong to this user and be connected)
      const { rows } = await pool.query(
        `SELECT id, platform, account_type, account_id, account_name
         FROM social_accounts
         WHERE user_id=$1 AND connected=true AND id = ANY($2::text[])`,
        [auth.userId, requestedAccountIds]
      );
      sourceRows = rows;
    } else {
      const selectedRows = await pool.query(
        `SELECT a.id, a.platform, a.account_type, a.account_id, a.account_name, s.template
         FROM social_post_settings s
         JOIN social_post_targets t ON t.social_post_id = s.id AND t.enabled = true
         JOIN social_accounts a ON a.id = t.social_account_id
         WHERE s.post_id = $1 AND a.connected = true`,
        [String(postId)]
      );
      sourceRows = selectedRows.rows.length > 0
        ? selectedRows.rows
        : (await pool.query(
            `SELECT id, platform, account_type, account_id, account_name
             FROM social_accounts WHERE user_id=$1 AND connected=true`,
            [auth.userId]
          )).rows;
    }

    const template = String(sourceRows[0]?.template || '').trim();

    const queuedKeys = new Set<string>();
    const skipped = new Set<string>();
    let queued = 0;

    for (const row of sourceRows as any[]) {
      const platform = normalizePlatformId(String(row.platform || ''));
      if (!platform) continue;
      if (visiblePlatforms.length > 0 && !visiblePlatforms.includes(platform)) {
        skipped.add(platform);
        continue;
      }
      if (!publishablePlatforms.has(platform)) {
        skipped.add(platform);
        continue;
      }

      const accountType = String(row.account_type || 'profile').trim().toLowerCase() || 'profile';
      const accountId = String(row.account_id || '').trim();
      const accountName = String(row.account_name || '').trim();
      const dedupeKey = `${platform}:${accountType}:${accountId}`;
      if (queuedKeys.has(dedupeKey)) continue;
      queuedKeys.add(dedupeKey);

      await enqueueSocialAutomationTask({
        userId: auth.userId,
        postId: String(postId),
        platform,
        runAt: new Date(),
        payload: {
          destination: { type: accountType, id: accountId, name: accountName },
          template,
        },
        accountLabel: formatSocialAccountLabel(platform, accountType, accountName, accountId),
      });
      queued += 1;
    }

    if (queued === 0) {
      const skippedList = Array.from(skipped);
      return res.status(400).json({
        success: false,
        error: skippedList.length
          ? `No publish-ready connected platforms were found for this post. Skipped: ${skippedList.join(', ')}.`
          : 'No publish-ready connected platforms were found for this post.',
        skipped: skippedList,
      });
    }

    return res.json({ success: true, queued, skipped: Array.from(skipped) });
  } catch (err) {
    console.error('v1 social repost error:', err);
    return res.status(500).json({ success: false, error: 'Failed to queue repost' });
  }
});

// POST /api/v1/posts/:postId/social-settings — save settings + targets
app.post('/api/v1/posts/:postId/social-settings', async (req: Request, res: Response) => {
  try {
    const auth = await requireAuth(req, res);
    if (!auth) return;
    if (!pool) return res.status(503).json({ success: false, error: 'Database not configured' });

    const { postId } = req.params;
    const { template = '', publish_type = 'immediate', scheduled_at = null, accounts = [] } = req.body as {
      template?: string;
      publish_type?: 'immediate' | 'scheduled' | 'delayed';
      scheduled_at?: string | null;
      accounts?: string[];
    };

    const publishType = (publish_type === 'scheduled' || publish_type === 'delayed') ? publish_type : 'immediate';
    const scheduledAt = scheduled_at ? new Date(String(scheduled_at)) : null;
    if (publishType !== 'immediate' && (!scheduledAt || Number.isNaN(scheduledAt.getTime()))) {
      return res.status(400).json({ success: false, error: 'scheduled_at is required for scheduled/delayed publish_type' });
    }

    const postRows = await pool.query('SELECT id FROM blog_posts WHERE id=$1 AND user_id=$2', [String(postId), auth.userId]);
    if (!postRows.rows.length) return res.status(404).json({ success: false, error: 'Post not found' });

    const visiblePlatforms = await getVisibleUserPlatformSlugs();

    let settingId = randomUUID();
    const client = await pool.connect();
    try {
      await client.query('BEGIN');

      const existing = await client.query('SELECT id FROM social_post_settings WHERE post_id=$1', [String(postId)]);
      settingId = existing.rows[0]?.id ? String(existing.rows[0].id) : settingId;

      if (existing.rows.length) {
        await client.query(
          `UPDATE social_post_settings SET template=$1, publish_type=$2, scheduled_at=$3 WHERE post_id=$4`,
          [String(template), publishType, publishType !== 'immediate' ? scheduledAt!.toISOString() : null, String(postId)]
        );
      } else {
        await client.query(
          `INSERT INTO social_post_settings (id, post_id, template, publish_type, scheduled_at)
           VALUES ($1,$2,$3,$4,$5)`,
          [settingId, String(postId), String(template), publishType, publishType !== 'immediate' ? scheduledAt!.toISOString() : null]
        );
      }

      await client.query('DELETE FROM social_post_targets WHERE social_post_id=$1', [settingId]);
      const ids = Array.isArray(accounts) ? accounts.map((x) => String(x)).filter(Boolean) : [];
      
      // Validate that all accounts belong to integrations visible to this user
      if (ids.length > 0) {
        const accountRows = await client.query(
          `SELECT id, platform FROM social_accounts WHERE id = ANY($1) AND user_id = $2`,
          [ids, auth.userId]
        );
        const validAccounts =
          visiblePlatforms.length > 0
            ? accountRows.rows.filter((acc: any) => visiblePlatforms.includes(String(acc.platform || '').toLowerCase()))
            : accountRows.rows;
        
        if (validAccounts.length !== ids.length) {
          throw new Error('Some selected accounts are from integrations that are not available in this workspace');
        }

        for (const accountId of ids) {
          await client.query(
            `INSERT INTO social_post_targets (id, social_post_id, social_account_id, enabled)
             VALUES ($1,$2,$3,true)`,
            [randomUUID(), settingId, accountId]
          );
        }
      }

      await client.query('COMMIT');
    } catch (e) {
      await client.query('ROLLBACK').catch(() => undefined);
      throw e;
    } finally {
      client.release();
    }

    await syncSocialAutomationForPost(auth.userId, String(postId));
    return res.json({ success: true, id: settingId });
  } catch (err) {
    console.error('v1 save social settings error:', err);
    return res.status(500).json({ success: false, error: 'Failed to save social settings' });
  }
});

// GET /api/v1/posts/:postId/social-settings — fetch settings + targets
app.get('/api/v1/posts/:postId/social-settings', async (req: Request, res: Response) => {
  try {
    const auth = await requireAuth(req, res);
    if (!auth) return;
    if (!pool) return res.status(503).json({ success: false, error: 'Database not configured' });

    const { postId } = req.params;
    const postRows = await pool.query('SELECT id FROM blog_posts WHERE id=$1 AND user_id=$2', [String(postId), auth.userId]);
    if (!postRows.rows.length) return res.status(404).json({ success: false, error: 'Post not found' });

    const settingsRows = await pool.query(
      'SELECT id, post_id, template, publish_type, scheduled_at, created_at FROM social_post_settings WHERE post_id=$1',
      [String(postId)]
    );
    const setting = settingsRows.rows[0] || null;
    if (!setting) {
      return res.json({ success: true, settings: null });
    }

    const targetRows = await pool.query(
      `SELECT t.id, t.enabled, a.id as social_account_id, a.platform, a.account_type, a.account_id, a.account_name, a.profile_image
       FROM social_post_targets t
       JOIN social_accounts a ON a.id = t.social_account_id
       WHERE t.social_post_id=$1
       ORDER BY a.created_at DESC`,
      [String(setting.id)]
    );

    return res.json({
      success: true,
      settings: {
        ...setting,
        accounts: targetRows.rows,
      },
    });
  } catch (err) {
    console.error('v1 fetch social settings error:', err);
    return res.status(500).json({ success: false, error: 'Failed to fetch social settings' });
  }
});

// ── Social Templates (Automation → Social Templates tab) ──────────────────────

// GET /api/social-templates/:platform — fetch per-platform template settings for current user
app.get('/api/social-templates/:platform', async (req: Request, res: Response) => {
  try {
    const auth = requireAuth(req, res);
    if (!auth) return;
    if (!pool) return res.status(503).json({ success: false, error: 'Database not configured' });

    const platformId = normalizePlatformId(req.params.platform);
    const defaults = getSocialTemplateDefaults(platformId);
    if (!defaults) return res.status(404).json({ success: false, error: 'Unknown platform' });

    const { rows } = await pool.query(
      `SELECT content_source, template_string, status_limit, max_status_limit, share_limit_per_post,
              add_categories_as_tags, remove_css, show_thumbnail, add_image_link, content_type, enabled
       FROM social_template_settings
       WHERE user_id=$1 AND platform=$2
       LIMIT 1`,
      [auth.userId, platformId]
    );

    const settings = rows.length
      ? mergeSocialTemplateSettings(platformId, rows[0])
      : defaults;

    return res.json({ success: true, settings });
  } catch (err) {
    console.error('social templates get error:', err);
    return res.status(500).json({ success: false, error: 'Failed to load social template settings' });
  }
});

// PUT /api/social-templates/:platform — upsert per-platform template settings for current user
app.put('/api/social-templates/:platform', async (req: Request, res: Response) => {
  try {
    const auth = requireAuth(req, res);
    if (!auth) return;
    if (!pool) return res.status(503).json({ success: false, error: 'Database not configured' });

    const platformId = normalizePlatformId(req.params.platform);
    const defaults = getSocialTemplateDefaults(platformId);
    if (!defaults) return res.status(404).json({ success: false, error: 'Unknown platform' });

    const next = mergeSocialTemplateSettings(platformId, req.body);
    if (!next.template_string.trim()) {
      return res.status(400).json({ success: false, error: 'template_string is required' });
    }

    const id = randomUUID();
    const { rows } = await pool.query(
      `INSERT INTO social_template_settings
        (id, user_id, platform, content_source, template_string, status_limit, max_status_limit,
         share_limit_per_post, add_categories_as_tags, remove_css, show_thumbnail, add_image_link,
         content_type, enabled, updated_at)
       VALUES
        ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,NOW())
       ON CONFLICT (user_id, platform) DO UPDATE SET
         content_source = EXCLUDED.content_source,
         template_string = EXCLUDED.template_string,
         status_limit = EXCLUDED.status_limit,
         max_status_limit = EXCLUDED.max_status_limit,
         share_limit_per_post = EXCLUDED.share_limit_per_post,
         add_categories_as_tags = EXCLUDED.add_categories_as_tags,
         remove_css = EXCLUDED.remove_css,
         show_thumbnail = EXCLUDED.show_thumbnail,
         add_image_link = EXCLUDED.add_image_link,
         content_type = EXCLUDED.content_type,
         enabled = EXCLUDED.enabled,
         updated_at = NOW()
       RETURNING content_source, template_string, status_limit, max_status_limit, share_limit_per_post,
                 add_categories_as_tags, remove_css, show_thumbnail, add_image_link, content_type, enabled`,
      [
        id,
        auth.userId,
        platformId,
        next.content_source,
        next.template_string,
        next.status_limit,
        next.max_status_limit,
        next.share_limit_per_post,
        next.add_categories_as_tags,
        next.remove_css,
        next.show_thumbnail,
        next.add_image_link,
        next.content_type,
        next.enabled,
      ]
    );

    const settings = rows.length ? mergeSocialTemplateSettings(platformId, rows[0]) : next;
    return res.json({ success: true, settings });
  } catch (err) {
    console.error('social templates save error:', err);
    return res.status(500).json({ success: false, error: 'Failed to save social template settings' });
  }
});

// POST /api/social-templates/:platform/preview — preview rendered template for a post (uses unsaved draft settings if provided)
app.post('/api/social-templates/:platform/preview', async (req: Request, res: Response) => {
  try {
    const auth = requireAuth(req, res);
    if (!auth) return;
    if (!pool) return res.status(503).json({ success: false, error: 'Database not configured' });

    const platformId = normalizePlatformId(req.params.platform);
    const defaults = getSocialTemplateDefaults(platformId);
    if (!defaults) return res.status(404).json({ success: false, error: 'Unknown platform' });

    const postId = String((req.body as any)?.postId || '').trim();
    if (!postId) return res.status(400).json({ success: false, error: 'postId is required' });

    const { rows } = await pool.query(
      `SELECT p.*, c.name AS category_name,
        ARRAY(
          SELECT t.name
          FROM blog_tags t
          JOIN blog_post_tags pt ON pt.tag_id=t.id
          WHERE pt.post_id=p.id
        ) AS tag_names
       FROM blog_posts p
       LEFT JOIN blog_categories c ON c.id=p.category_id
       WHERE p.id=$1 AND p.user_id=$2
       LIMIT 1`,
      [postId, auth.userId]
    );
    if (!rows.length) return res.status(404).json({ success: false, error: 'Post not found' });

    const post = rows[0];
    const draft = (req.body as any)?.settings;
    const settings = draft
      ? mergeSocialTemplateSettings(platformId, draft)
      : await loadSocialTemplateSettings(auth.userId, platformId);
    if (!settings) return res.status(404).json({ success: false, error: 'Unknown platform' });

    const preview = await renderSocialTemplatePreview(auth.userId, post, settings);
    return res.json({ success: true, ...preview });
  } catch (err) {
    console.error('social templates preview error:', err);
    return res.status(500).json({ success: false, error: 'Failed to generate preview' });
  }
});

// DELETE /api/admin/platform-configs/:platform — reset config + disable (admin only)
app.delete('/api/admin/platform-configs/:platform', async (req: Request, res: Response) => {
  try {
    const admin = await requireAdmin(req, res);
    if (!admin) return;

    const { platform } = req.params;
    const normalized = String(platform || '').trim().toLowerCase();
    if (!normalized) return res.status(400).json({ success: false, error: 'platform is required' });

    const now = new Date().toISOString();

    if (hasDatabase()) {
      const updateRes = await dbQuery(
        `UPDATE platform_configs
         SET config = '{}'::jsonb, enabled = false, updated_at = NOW()
         WHERE platform = $1`,
        [normalized]
      );
      if (updateRes.rowCount === 0) {
        await dbQuery(
          `INSERT INTO platform_configs (platform, config, enabled, updated_at)
           VALUES ($1, '{}'::jsonb, false, NOW())`,
          [normalized]
        );
      }
    } else {
      inMemoryPlatformConfigs.set(normalized, { platform: normalized, config: {}, enabled: false, updated_at: now });
    }

    return res.json({ success: true, message: 'Platform config reset' });
  } catch (error) {
    console.error('Reset platform config error:', error);
    return res.status(500).json({ success: false, error: 'Failed to reset platform config' });
  }
});

// GET /auth/:platform/callback — OAuth redirect URI for platform integrations (Instagram/Facebook/LinkedIn/etc.)
// Uses stored `state` (bound to user + platform) to persist tokens, then redirects back to the SPA.
app.get('/auth/:platform/callback', async (req: Request, res: Response) => {
  const FRONTEND_URL = process.env.VITE_APP_URL || process.env.FRONTEND_URL || 'https://marketing.dakyworld.com';
  const platformId = String(req.params.platform || '').trim().toLowerCase();

  const fallbackOk = `${FRONTEND_URL}/integrations?success=true`;
  const fallbackErr = (msg: string) => `${FRONTEND_URL}/integrations?error=${encodeURIComponent(msg)}`;

  try {
    const oauthError = String((req.query as any).error || '').trim();
    const oauthErrorDesc = String((req.query as any).error_description || '').trim();
    if (oauthError) return res.redirect(fallbackErr(oauthErrorDesc || oauthError));

    const code = String((req.query as any).code || '').trim();
    const state = String((req.query as any).state || '').trim();
    if (!code || !state) return res.redirect(fallbackErr('Missing code or state'));

    if (!pool) return res.redirect(fallbackErr('Database not configured'));

    const stateRow = await getOAuthStateRow(state);
    if (!stateRow) return res.redirect(fallbackErr('Invalid or expired state'));
    if (String(stateRow.platform || '').trim().toLowerCase() !== platformId) return res.redirect(fallbackErr('State/platform mismatch'));

    const tokenData = await exchangeOAuthCode(platformId, code, stateRow.code_verifier || undefined, req);
    await storeUserConnection(stateRow.user_id, platformDisplayName(platformId), tokenData);
    await dbQuery('DELETE FROM oauth_states WHERE state = $1', [state]).catch(() => undefined);

    const returnTo = (stateRow as any).return_to as string | null | undefined;
    const dest = returnTo && returnTo.startsWith('/') ? `${FRONTEND_URL}${returnTo}` : fallbackOk;
    return res.redirect(dest);
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'OAuth connection failed';
    console.error('Platform OAuth callback error:', err);
    return res.redirect(fallbackErr(msg));
  }
});

// PATCH /api/admin/platform-configs/:platform/toggle — toggle enabled without changing config
app.patch('/api/admin/platform-configs/:platform/toggle', async (req: Request, res: Response) => {
  try {
    const admin = await requireAdmin(req, res);
    if (!admin) return;
    const platform = String(req.params.platform || '').trim().toLowerCase();
    const { enabled } = req.body as { enabled: boolean };
    if (!platform) return res.status(400).json({ success: false, error: 'Platform required' });
    if (hasDatabase()) {
      const updateRes = await dbQuery(
        `UPDATE platform_configs
         SET enabled = $2, updated_at = NOW()
         WHERE platform = $1`,
        [platform, Boolean(enabled)]
      );
      if (updateRes.rowCount === 0) {
        await dbQuery(
          `INSERT INTO platform_configs (platform, config, enabled, updated_at)
           VALUES ($1, '{}', $2, NOW())`,
          [platform, Boolean(enabled)]
        );
      }
      return res.json({ success: true, enabled: Boolean(enabled) });
    }
    return res.json({ success: true, enabled: Boolean(enabled) });
  } catch (error) {
    console.error('Toggle platform config error:', error);
    return res.status(500).json({ success: false, error: 'Failed to toggle integration' });
  }
});

// GET /api/admin/platform-configs/:platform/test — test/validate platform credentials
app.get('/api/admin/platform-configs/:platform/test', async (req: Request, res: Response) => {
  try {
    const admin = await requireAdmin(req, res);
    if (!admin) return;
    const platform = req.params.platform.toLowerCase();
    const cfg = await getPlatformConfig(platform);

    switch (platform) {
      case 'wordpress': {
        const { siteUrl, username, applicationPassword } = cfg;
        if (!siteUrl || !username || !applicationPassword) {
          return res.json({ success: false, error: 'Missing WordPress credentials' });
        }
        const base = siteUrl.replace(/\/$/, '');
        const resp = await axios.get(`${base}/wp-json/wp/v2/users/me`, {
          auth: { username, password: applicationPassword },
          validateStatus: () => true,
          timeout: 8000,
        });
        if (resp.status === 200) return res.json({ success: true, message: `Connected as ${resp.data?.name || username}` });
        return res.json({ success: false, error: `WordPress returned ${resp.status}` });
      }
      case 'mailchimp': {
        const { apiKey, serverPrefix } = cfg;
        if (!apiKey || !serverPrefix) return res.json({ success: false, error: 'Missing Mailchimp credentials' });
        const resp = await axios.get(`https://${serverPrefix}.api.mailchimp.com/3.0/`, {
          auth: { username: 'anystring', password: apiKey },
          validateStatus: () => true,
          timeout: 8000,
        });
        if (resp.status === 200) return res.json({ success: true, message: 'Mailchimp credentials valid' });
        return res.json({ success: false, error: 'Invalid Mailchimp API key or server prefix' });
      }
      case 'chatgpt': {
        const { apiKey } = cfg;
        if (!apiKey) return res.json({ success: false, error: 'Missing OpenAI API key' });
        const resp = await axios.get('https://api.openai.com/v1/models', {
          headers: { Authorization: `Bearer ${apiKey}` },
          validateStatus: () => true,
          timeout: 8000,
        });
        if (resp.status === 200) return res.json({ success: true, message: 'OpenAI credentials valid' });
        return res.json({ success: false, error: 'Invalid OpenAI API key' });
      }
      case 'webflow': {
        const { apiToken } = cfg;
        if (!apiToken) return res.json({ success: false, error: 'Missing Webflow API token' });
        const resp = await axios.get('https://api.webflow.com/v2/sites', {
          headers: { Authorization: `Bearer ${apiToken}`, 'accept-version': '1.0.0' },
          validateStatus: () => true,
          timeout: 8000,
        });
        if (resp.status === 200) return res.json({ success: true, message: 'Webflow credentials valid' });
        return res.json({ success: false, error: 'Invalid Webflow API token' });
      }
      case 'stripe': {
        const { secretKey } = cfg;
        if (!secretKey) return res.json({ success: false, error: 'Missing Stripe secret key' });
        const resp = await axios.get('https://api.stripe.com/v1/balance', {
          headers: { Authorization: `Bearer ${secretKey}` },
          validateStatus: () => true,
          timeout: 8000,
        });
        if (resp.status === 200) return res.json({ success: true, message: 'Stripe credentials valid' });
        return res.json({ success: false, error: 'Invalid Stripe secret key' });
      }
      case 'linear': {
        const { apiKey } = cfg;
        if (!apiKey) return res.json({ success: false, error: 'Missing Linear API key' });
        const resp = await axios.post('https://api.linear.app/graphql', { query: '{ viewer { id name } }' }, {
          headers: { Authorization: apiKey, 'Content-Type': 'application/json' },
          validateStatus: () => true,
          timeout: 8000,
        });
        if (resp.status === 200 && resp.data?.data?.viewer) return res.json({ success: true, message: `Connected as ${resp.data.data.viewer.name}` });
        return res.json({ success: false, error: 'Invalid Linear API key' });
      }
      default: {
        // For OAuth platforms (instagram, facebook, etc.) — check credentials are set
        const meta = OAUTH_AUTH_URLS[platform];
        if (!meta) return res.json({ success: false, error: 'Unsupported platform' });
        const clientId = cfg[meta.idField];
        const redirectUri = resolveOAuthRedirectUri(platform, cfg.redirectUri, req);
        if (!clientId || !redirectUri) return res.json({ success: false, error: 'Credentials not configured' });
        return res.json({ success: true, message: 'Credentials are saved. Test the OAuth flow by clicking "Test OAuth" on the user page.' });
      }
    }
  } catch (err) {
    console.error('Platform test error:', err);
    return res.status(500).json({ success: false, error: 'Test failed' });
  }
});

// ─── AI Config (admin) ───────────────────────────────────────────────────────

const AI_CONFIG_PLATFORM = 'ai_assistant';

// Gemini model names — used for model selection UI + provider-aware calls
const GEMINI_MODELS = ['gemini-2.0-flash', 'gemini-1.5-flash', 'gemini-1.5-pro', 'gemini-2.5-pro'];
// Map from Anthropic model IDs → equivalent Gemini models for background/agent calls
const ANTHROPIC_TO_GEMINI: Record<string, string> = {
  'claude-haiku-4-5-20251001': 'gemini-2.0-flash',
  'claude-sonnet-4-6': 'gemini-1.5-pro',
  'claude-opus-4-7': 'gemini-2.5-pro',
};

async function getAIConfig(): Promise<{
  model: string;
  provider: 'anthropic' | 'google';
  encryptedKey: string | null;
  googleEncryptedKey: string | null;
  systemPrompt: string | null;
}> {
  const cfg = await getPlatformConfig(AI_CONFIG_PLATFORM);
  return {
    model: String(cfg.model || 'claude-haiku-4-5-20251001'),
    provider: (cfg.provider as 'anthropic' | 'google') || 'anthropic',
    encryptedKey: cfg.apiKeyEncrypted ? String(cfg.apiKeyEncrypted) : null,
    googleEncryptedKey: cfg.googleApiKeyEncrypted ? String(cfg.googleApiKeyEncrypted) : null,
    systemPrompt: cfg.systemPrompt ? String(cfg.systemPrompt) : null,
  };
}

function resolveActiveKey(config: { provider: 'anthropic' | 'google'; encryptedKey: string | null; googleEncryptedKey: string | null }): string {
  if (config.provider === 'google') {
    return (config.googleEncryptedKey ? decryptAIKey(config.googleEncryptedKey) : null) || process.env.GOOGLE_AI_API_KEY || '';
  }
  return (config.encryptedKey ? decryptAIKey(config.encryptedKey) : null) || process.env.ANTHROPIC_API_KEY || '';
}

async function callAINonStreaming(
  provider: 'anthropic' | 'google',
  apiKey: string,
  model: string,
  systemPrompt: string,
  userMessage: string,
  maxTokens = 400,
): Promise<string> {
  try {
    if (provider === 'google') {
      const effectiveModel = GEMINI_MODELS.includes(model) ? model : (ANTHROPIC_TO_GEMINI[model] ?? 'gemini-2.0-flash');
      const genAI = new GoogleGenerativeAI(apiKey);
      const gModel = genAI.getGenerativeModel({ model: effectiveModel, systemInstruction: systemPrompt });
      const result = await gModel.generateContent(userMessage);
      return result.response.text();
    } else {
      const client = new Anthropic({ apiKey });
      const resp = await client.messages.create({
        model,
        max_tokens: maxTokens,
        system: systemPrompt,
        messages: [{ role: 'user', content: userMessage }],
      });
      return resp.content[0]?.type === 'text' ? resp.content[0].text : '';
    }
  } catch (err: any) {
    const msg: string = err?.message || String(err);
    if (msg.includes('429') || msg.toLowerCase().includes('quota') || msg.toLowerCase().includes('rate limit') || msg.toLowerCase().includes('too many requests')) {
      if (provider === 'google') {
        throw new Error('Google API quota exceeded. The free tier has a limit of 0 for this project — enable billing at aistudio.google.com to use Gemini.');
      } else {
        throw new Error('Anthropic rate limit exceeded. Check your usage limits at console.anthropic.com.');
      }
    }
    if (msg.includes('401') || msg.toLowerCase().includes('invalid') || msg.toLowerCase().includes('unauthorized')) {
      throw new Error(`Invalid ${provider === 'google' ? 'Google' : 'Anthropic'} API key. Please check your key and try again.`);
    }
    throw err;
  }
}

function decryptAIKey(encryptedKey: string): string {
  try { return decryptIntegrationSecret(encryptedKey); } catch { return ''; }
}

function maskKey(raw: string): string {
  if (!raw || raw.length < 8) return '••••';
  return '••••' + raw.slice(-4);
}

// GET /api/admin/ai-config
app.get('/api/admin/ai-config', async (req: Request, res: Response) => {
  try {
    const admin = await requireAdmin(req, res);
    if (!admin) return;
    const { model, provider, encryptedKey, googleEncryptedKey, systemPrompt } = await getAIConfig();
    const rawAnthropicKey = encryptedKey ? decryptAIKey(encryptedKey) : (process.env.ANTHROPIC_API_KEY || '');
    const rawGoogleKey = googleEncryptedKey ? decryptAIKey(googleEncryptedKey) : (process.env.GOOGLE_AI_API_KEY || '');
    const activeKey = provider === 'google' ? rawGoogleKey : rawAnthropicKey;
    return res.json({
      success: true,
      config: {
        model,
        provider,
        apiKeyMasked: rawAnthropicKey ? maskKey(rawAnthropicKey) : '',
        googleApiKeyMasked: rawGoogleKey ? maskKey(rawGoogleKey) : '',
        enabled: Boolean(activeKey),
        systemPrompt: systemPrompt || null,
        defaultSystemPrompt: AI_SYSTEM_PROMPT_DEFAULT,
      },
    });
  } catch (err) {
    console.error('AI config GET error:', err);
    return res.status(500).json({ success: false, error: 'Failed to fetch AI config' });
  }
});

// PUT /api/admin/ai-config
app.put('/api/admin/ai-config', async (req: Request, res: Response) => {
  try {
    const admin = await requireAdmin(req, res);
    if (!admin) return;
    const { apiKey, googleApiKey, model, provider, systemPrompt } = req.body as {
      apiKey?: string; googleApiKey?: string; model?: string; provider?: string; systemPrompt?: string;
    };

    const existing = await getAIConfig();
    const newModel = String(model || existing.model).trim();
    const newProvider = (provider === 'google' || provider === 'anthropic') ? provider : existing.provider;

    let newEncryptedKey = existing.encryptedKey;
    if (apiKey && !String(apiKey).startsWith('••')) {
      newEncryptedKey = encryptIntegrationSecret(String(apiKey).trim());
    }

    let newGoogleEncryptedKey = existing.googleEncryptedKey;
    if (googleApiKey && !String(googleApiKey).startsWith('••')) {
      newGoogleEncryptedKey = encryptIntegrationSecret(String(googleApiKey).trim());
    }

    const finalSystemPrompt = 'systemPrompt' in req.body
      ? (systemPrompt ? String(systemPrompt).trim() : null)
      : existing.systemPrompt;

    const configObj: Record<string, any> = { model: newModel, provider: newProvider };
    if (newEncryptedKey) configObj.apiKeyEncrypted = newEncryptedKey;
    if (newGoogleEncryptedKey) configObj.googleApiKeyEncrypted = newGoogleEncryptedKey;
    if (finalSystemPrompt) configObj.systemPrompt = finalSystemPrompt;

    if (hasDatabase()) {
      const updateRes = await dbQuery(
        `UPDATE platform_configs SET config = $2, enabled = true, updated_at = NOW() WHERE platform = $1`,
        [AI_CONFIG_PLATFORM, JSON.stringify(configObj)]
      );
      if (updateRes.rowCount === 0) {
        await dbQuery(
          `INSERT INTO platform_configs (platform, config, enabled, updated_at) VALUES ($1, $2, true, NOW())`,
          [AI_CONFIG_PLATFORM, JSON.stringify(configObj)]
        );
      }
    } else {
      inMemoryPlatformConfigs.set(AI_CONFIG_PLATFORM, {
        platform: AI_CONFIG_PLATFORM,
        config: configObj as any,
        enabled: true,
        updated_at: new Date().toISOString(),
      });
    }

    const rawAnthropicKey = newEncryptedKey ? decryptAIKey(newEncryptedKey) : (process.env.ANTHROPIC_API_KEY || '');
    const rawGoogleKey = newGoogleEncryptedKey ? decryptAIKey(newGoogleEncryptedKey) : (process.env.GOOGLE_AI_API_KEY || '');
    const activeKey = newProvider === 'google' ? rawGoogleKey : rawAnthropicKey;
    return res.json({
      success: true,
      config: {
        model: newModel,
        provider: newProvider,
        apiKeyMasked: rawAnthropicKey ? maskKey(rawAnthropicKey) : '',
        googleApiKeyMasked: rawGoogleKey ? maskKey(rawGoogleKey) : '',
        enabled: Boolean(activeKey),
        systemPrompt: finalSystemPrompt || null,
        defaultSystemPrompt: AI_SYSTEM_PROMPT_DEFAULT,
      },
    });
  } catch (err) {
    console.error('AI config PUT error:', err);
    return res.status(500).json({ success: false, error: 'Failed to save AI config' });
  }
});

// POST /api/admin/ai-config/test
app.post('/api/admin/ai-config/test', async (req: Request, res: Response) => {
  try {
    const admin = await requireAdmin(req, res);
    if (!admin) return;
    const aiCfg = await getAIConfig();
    const rawKey = resolveActiveKey(aiCfg);
    if (!rawKey) return res.status(400).json({ success: false, message: 'No API key configured for the active provider' });

    const reply = await callAINonStreaming(aiCfg.provider, rawKey, aiCfg.model, 'You are a test assistant.', 'Reply with just: ok', 16);
    return res.json({ success: true, message: `Connected — ${aiCfg.provider === 'google' ? 'Google Gemini' : 'Anthropic'} model ${aiCfg.model} is responding` });
  } catch (err: any) {
    const msg = err?.message || 'Connection failed';
    return res.status(400).json({ success: false, message: msg });
  }
});

// ─── End AI Config ────────────────────────────────────────────────────────────

// ─── AI Skills ────────────────────────────────────────────────────────────────

async function getSkillsPromptForScope(page: string): Promise<string> {
  if (!pool) return '';
  try {
    const { rows } = await dbQuery(
      `SELECT name, description, system_prompt, scope FROM ai_skills WHERE enabled = true ORDER BY sort_order ASC, created_at ASC`,
      []
    );
    const pageLower = (page || '').toLowerCase();
    const matching = rows.filter((skill: any) => {
      const scope = String(skill.scope || 'all').toLowerCase();
      if (scope === 'all') return true;
      if (scope === 'posts' && pageLower.includes('/posts')) return true;
      if (scope === 'cards' && pageLower.includes('/cards')) return true;
      if (scope === 'dashboard' && (pageLower === '/dashboard' || pageLower === '/')) return true;
      if (scope === 'analytics' && pageLower.includes('/analytics')) return true;
      return false;
    });
    if (matching.length === 0) return '';
    return matching
      .map((skill: any) =>
        `---\n\nSKILL: ${skill.name}${skill.description ? `\nPurpose: ${skill.description}` : ''}\n\n${skill.system_prompt}`
      )
      .join('\n\n');
  } catch (e) {
    console.error('getSkillsPromptForScope error:', e);
    return '';
  }
}

// GET /api/admin/ai-skills
app.get('/api/admin/ai-skills', async (req: Request, res: Response) => {
  try {
    const admin = await requireAdmin(req, res);
    if (!admin) return;
    if (!pool) return res.json({ success: true, skills: [] });
    const { rows } = await dbQuery(
      `SELECT id, name, description, system_prompt, scope, enabled, sort_order, created_at, updated_at
       FROM ai_skills ORDER BY sort_order ASC, created_at ASC`,
      []
    );
    return res.json({ success: true, skills: rows });
  } catch (err) {
    console.error('ai-skills GET error:', err);
    return res.status(500).json({ success: false, error: 'Failed to fetch skills' });
  }
});

// POST /api/admin/ai-skills
app.post('/api/admin/ai-skills', async (req: Request, res: Response) => {
  try {
    const admin = await requireAdmin(req, res);
    if (!admin) return;
    if (!pool) return res.status(503).json({ success: false, error: 'Database not configured' });
    const { name, description, system_prompt, scope, enabled, sort_order } = req.body as {
      name: string; description?: string; system_prompt: string; scope?: string; enabled?: boolean; sort_order?: number;
    };
    if (!name?.trim()) return res.status(400).json({ success: false, error: 'name is required' });
    if (!system_prompt?.trim()) return res.status(400).json({ success: false, error: 'system_prompt is required' });
    const id = randomUUID();
    const { rows } = await dbQuery(
      `INSERT INTO ai_skills (id, name, description, system_prompt, scope, enabled, sort_order)
       VALUES ($1,$2,$3,$4,$5,$6,$7)
       RETURNING id, name, description, system_prompt, scope, enabled, sort_order, created_at, updated_at`,
      [id, name.trim(), (description || '').trim(), system_prompt.trim(),
       (scope || 'all').trim(), enabled !== false, Number(sort_order) || 0]
    );
    return res.status(201).json({ success: true, skill: rows[0] });
  } catch (err) {
    console.error('ai-skills POST error:', err);
    return res.status(500).json({ success: false, error: 'Failed to create skill' });
  }
});

// PUT /api/admin/ai-skills/:id
app.put('/api/admin/ai-skills/:id', async (req: Request, res: Response) => {
  try {
    const admin = await requireAdmin(req, res);
    if (!admin) return;
    if (!pool) return res.status(503).json({ success: false, error: 'Database not configured' });
    const { id } = req.params;
    const { name, description, system_prompt, scope, enabled, sort_order } = req.body as {
      name?: string; description?: string; system_prompt?: string; scope?: string; enabled?: boolean; sort_order?: number;
    };
    const existing = await dbQuery('SELECT id FROM ai_skills WHERE id=$1', [id]);
    if (!existing.rows.length) return res.status(404).json({ success: false, error: 'Skill not found' });
    const { rows } = await dbQuery(
      `UPDATE ai_skills SET
         name = COALESCE($2, name),
         description = COALESCE($3, description),
         system_prompt = COALESCE($4, system_prompt),
         scope = COALESCE($5, scope),
         enabled = COALESCE($6, enabled),
         sort_order = COALESCE($7, sort_order),
         updated_at = NOW()
       WHERE id = $1
       RETURNING id, name, description, system_prompt, scope, enabled, sort_order, created_at, updated_at`,
      [id,
       name !== undefined ? name.trim() : null,
       description !== undefined ? description.trim() : null,
       system_prompt !== undefined ? system_prompt.trim() : null,
       scope !== undefined ? scope.trim() : null,
       enabled !== undefined ? enabled : null,
       sort_order !== undefined ? Number(sort_order) : null]
    );
    return res.json({ success: true, skill: rows[0] });
  } catch (err) {
    console.error('ai-skills PUT error:', err);
    return res.status(500).json({ success: false, error: 'Failed to update skill' });
  }
});

// DELETE /api/admin/ai-skills/:id
app.delete('/api/admin/ai-skills/:id', async (req: Request, res: Response) => {
  try {
    const admin = await requireAdmin(req, res);
    if (!admin) return;
    if (!pool) return res.status(503).json({ success: false, error: 'Database not configured' });
    const { id } = req.params;
    const result = await dbQuery('DELETE FROM ai_skills WHERE id=$1', [id]);
    if (result.rowCount === 0) return res.status(404).json({ success: false, error: 'Skill not found' });
    return res.json({ success: true });
  } catch (err) {
    console.error('ai-skills DELETE error:', err);
    return res.status(500).json({ success: false, error: 'Failed to delete skill' });
  }
});

// ─── End AI Skills ────────────────────────────────────────────────────────────

// ─── Page Content ────────────────────────────────────────────────────────────
app.get('/api/pages/:slug', async (req: Request, res: Response) => {
  const { slug } = req.params;
  if (!hasDatabase()) return res.json({ success: true, content: null });
  try {
    const { rows } = await pool!.query('SELECT content FROM page_content WHERE slug = $1', [slug]);
    return res.json({ success: true, content: rows[0]?.content ?? null });
  } catch (err) {
    console.error('page_content GET error:', err);
    return res.status(500).json({ success: false, error: 'Failed to fetch page content' });
  }
});

app.put('/api/pages/:slug', async (req: Request, res: Response) => {
  const admin = await requireAdmin(req, res);
  if (!admin) return;
  const { slug } = req.params;
  const { content } = req.body as { content: unknown };
  if (!content || typeof content !== 'object') return res.status(400).json({ success: false, error: 'content must be an object' });
  if (!hasDatabase()) return res.json({ success: true });
  try {
    await pool!.query(
      `INSERT INTO page_content (slug, content, updated_at) VALUES ($1, $2, NOW())
       ON CONFLICT (slug) DO UPDATE SET content = EXCLUDED.content, updated_at = NOW()`,
      [slug, JSON.stringify(content)]
    );
    return res.json({ success: true });
  } catch (err) {
    console.error('page_content PUT error:', err);
    return res.status(500).json({ success: false, error: 'Failed to save page content' });
  }
});

// ─── Media Library ───────────────────────────────────────────────────────────

function sanitizeFileName(name: string): string {
  return name.replace(/[^a-zA-Z0-9.\-_]/g, '-').replace(/-{2,}/g, '-').replace(/^-|-$/g, '');
}

function getMediaServerBase(): string {
  return String(
    process.env.BACKEND_PUBLIC_URL ||
    process.env.PUBLIC_API_URL ||
    process.env.VITE_API_BASE_URL ||
    'https://contentflow-api-production.up.railway.app'
  ).replace(/\/$/, '');
}

function buildMediaServeUrl(id: string, fileName: string): string {
  return `${getMediaServerBase()}/media/${encodeURIComponent(id)}/${encodeURIComponent(fileName)}`;
}

type DbMediaImageRow = {
  id: string;
  user_id: string;
  file_name: string;
  original_name: string;
  file_size: number;
  file_type: string;
  width: number | null;
  height: number | null;
  upload_date: string | null;
  url: string;
  thumbnail_url: string | null;
  alt_text: string | null;
  caption: string | null;
  description: string | null;
  tags: string[] | null;
  used_in: unknown;
  category: string | null;
};

type MediaSourceTable = 'users' | 'blog_posts' | 'user_designs' | 'card_templates';

type EnsureMediaRecordOptions = {
  userId: string;
  sourceTable: MediaSourceTable;
  sourceId: string;
  sourceField: string;
  url: string | null | undefined;
  thumbnailUrl?: string | null;
  fileName?: string;
  fileType?: string;
  tags?: string[];
  category?: 'user' | 'admin';
};

function transformMediaRow(row: any): any {
  if (!row) return row;
  const rawUrl = String(row.url || '');
  const rawThumb = String(row.thumbnail_url || '');
  const serveUrl = buildMediaServeUrl(row.id, row.file_name);
  return {
    ...row,
    url: rawUrl.startsWith('data:') ? serveUrl : rawUrl,
    thumbnail_url: rawThumb.startsWith('data:') ? serveUrl : rawThumb,
  };
}

function uniqueStrings(values: Iterable<string>): string[] {
  return Array.from(new Set(Array.from(values).map((value) => String(value || '').trim()).filter(Boolean)));
}

function parseTextArray(raw: unknown): string[] {
  if (Array.isArray(raw)) return uniqueStrings(raw.map((value) => String(value)));
  if (typeof raw === 'string') {
    try {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) return uniqueStrings(parsed.map((value) => String(value)));
    } catch {
      return raw.trim() ? [raw.trim()] : [];
    }
  }
  return [];
}

function parseUsedInList(raw: unknown): string[] {
  if (Array.isArray(raw)) {
    return uniqueStrings(raw.map((value) => (typeof value === 'string' ? value : JSON.stringify(value))));
  }
  if (typeof raw === 'string') {
    try {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) {
        return uniqueStrings(parsed.map((value) => (typeof value === 'string' ? value : JSON.stringify(value))));
      }
    } catch {
      return raw.trim() ? [raw.trim()] : [];
    }
  }
  return [];
}

function isPersistableImageUrl(value: string): boolean {
  const normalized = String(value || '').trim();
  return (
    normalized.startsWith('data:image/') ||
    /^https?:\/\//i.test(normalized) ||
    normalized.startsWith('/media/') ||
    normalized.startsWith('/api/media/') ||
    normalized.startsWith(`${getMediaServerBase()}/media/`)
  );
}

function inferMimeTypeFromUrl(url: string, fallback = 'image/jpeg'): string {
  const normalized = String(url || '').trim();
  if (normalized.startsWith('data:image/')) {
    const commaIdx = normalized.indexOf(',');
    if (commaIdx > 5) {
      return normalized.slice(5, commaIdx).replace(';base64', '') || fallback;
    }
  }

  const lower = normalized.toLowerCase();
  if (lower.includes('.png')) return 'image/png';
  if (lower.includes('.webp')) return 'image/webp';
  if (lower.includes('.svg')) return 'image/svg+xml';
  if (lower.includes('.jpg') || lower.includes('.jpeg')) return 'image/jpeg';
  return fallback;
}

function extFromMime(fileType: string): string {
  switch (String(fileType || '').toLowerCase()) {
    case 'image/png':
      return '.png';
    case 'image/webp':
      return '.webp';
    case 'image/svg+xml':
      return '.svg';
    default:
      return '.jpg';
  }
}

function guessFileNameFromUrl(url: string, fallbackBase: string, fallbackType = 'image/jpeg'): string {
  const normalized = String(url || '').trim();
  if (normalized.startsWith('data:image/')) {
    return sanitizeFileName(`${fallbackBase}${extFromMime(inferMimeTypeFromUrl(normalized, fallbackType))}`);
  }

  try {
    const parsed = new URL(normalized, getMediaServerBase());
    const candidate = path.posix.basename(parsed.pathname || '');
    if (candidate && candidate.includes('.')) return sanitizeFileName(candidate);
  } catch {
    // Ignore malformed URLs and fall back to a synthetic filename.
  }

  return sanitizeFileName(`${fallbackBase}${extFromMime(fallbackType)}`);
}

function extractImageUrlsFromHtml(html: string): string[] {
  const matches = html.matchAll(/<img[^>]+src=["']([^"']+)["']/gi);
  const urls = Array.from(matches, (match) => String(match[1] || '').trim());
  return uniqueStrings(urls.filter(isPersistableImageUrl));
}

function extractImageUrlsFromCanvasData(input: unknown): string[] {
  const urls = new Set<string>();
  const visit = (value: unknown, keyHint = '') => {
    if (typeof value === 'string') {
      const normalized = value.trim();
      const key = keyHint.toLowerCase();
      const likelyImageKey =
        key === 'src' ||
        key === 'url' ||
        key === 'thumbnail_url' ||
        key === 'backgroundimage' ||
        key === 'imageurl' ||
        key.includes('image') ||
        key.includes('thumbnail') ||
        key.includes('cover');
      if ((likelyImageKey || normalized.startsWith('data:image/')) && isPersistableImageUrl(normalized)) {
        urls.add(normalized);
      }
      return;
    }

    if (Array.isArray(value)) {
      value.forEach((entry) => visit(entry, keyHint));
      return;
    }

    if (value && typeof value === 'object') {
      for (const [nextKey, nextValue] of Object.entries(value as Record<string, unknown>)) {
        visit(nextValue, nextKey);
      }
    }
  };

  visit(input);
  return Array.from(urls);
}

async function upsertMediaImageLink(
  mediaImageId: string,
  userId: string,
  sourceTable: MediaSourceTable,
  sourceId: string,
  sourceField: string,
) {
  if (!hasDatabase()) return;
  await pool!.query(
    `INSERT INTO media_image_links (id, media_image_id, user_id, source_table, source_id, source_field, created_at, updated_at)
     VALUES ($1, $2, $3, $4, $5, $6, NOW(), NOW())
     ON CONFLICT (user_id, media_image_id, source_table, source_id, source_field)
     DO UPDATE SET updated_at = NOW()`,
    [randomUUID(), mediaImageId, userId, sourceTable, sourceId, sourceField],
  );
}

async function pruneMediaLinksForSource(
  userId: string,
  sourceTable: MediaSourceTable,
  sourceId: string,
  sourceField: string,
  mediaImageIds: string[],
) {
  if (!hasDatabase()) return;
  const params: unknown[] = [userId, sourceTable, sourceId, sourceField];
  let sql =
    'DELETE FROM media_image_links WHERE user_id = $1 AND source_table = $2 AND source_id = $3 AND source_field = $4';
  if (mediaImageIds.length) {
    sql += ' AND NOT (media_image_id = ANY($5::text[]))';
    params.push(mediaImageIds);
  }
  await pool!.query(sql, params);
}

async function ensureMediaRecordForSource(
  options: EnsureMediaRecordOptions,
): Promise<{ row: DbMediaImageRow; created: boolean } | null> {
  if (!hasDatabase()) return null;

  const normalizedUrl = String(options.url || '').trim();
  if (!normalizedUrl || !isPersistableImageUrl(normalizedUrl)) return null;

  const usageKey = `${options.sourceTable}:${options.sourceId}:${options.sourceField}`;
  const normalizedTags = uniqueStrings(options.tags ?? []);
  const nextCategory = options.category === 'admin' ? 'admin' : 'user';
  const nextFileType = options.fileType || inferMimeTypeFromUrl(normalizedUrl);
  const fallbackBase = `${options.sourceTable}-${options.sourceId}-${options.sourceField}`;
  const nextFileName = sanitizeFileName(
    options.fileName || guessFileNameFromUrl(normalizedUrl, fallbackBase, nextFileType),
  );
  const nextThumbnailUrl = String(options.thumbnailUrl || normalizedUrl).trim() || normalizedUrl;

  const existingResult = await pool!.query<DbMediaImageRow>(
    'SELECT * FROM media_images WHERE user_id = $1 AND url = $2 LIMIT 1',
    [options.userId, normalizedUrl],
  );

  if (existingResult.rows.length) {
    const existing = existingResult.rows[0];
    const mergedTags = uniqueStrings([...(parseTextArray(existing.tags) ?? []), ...normalizedTags]);
    const mergedUsedIn = uniqueStrings([...parseUsedInList(existing.used_in), usageKey]);
    const category = existing.category === 'admin' || nextCategory === 'admin' ? 'admin' : 'user';
    const thumbnailUrl = String(existing.thumbnail_url || nextThumbnailUrl || normalizedUrl);

    const updatedResult = await pool!.query<DbMediaImageRow>(
      `UPDATE media_images
       SET tags = $3,
           used_in = $4::jsonb,
           thumbnail_url = $5,
           category = $6
       WHERE id = $1 AND user_id = $2
       RETURNING *`,
      [existing.id, options.userId, mergedTags, JSON.stringify(mergedUsedIn), thumbnailUrl, category],
    );

    const row = updatedResult.rows[0] || existing;
    await upsertMediaImageLink(row.id, options.userId, options.sourceTable, options.sourceId, options.sourceField);
    return { row, created: false };
  }

  const inserted = await pool!.query<DbMediaImageRow>(
    `INSERT INTO media_images (
       id, user_id, file_name, original_name, file_size, file_type, width, height, url, thumbnail_url, tags, used_in, category
     ) VALUES (
       $1, $2, $3, $4, $5, $6, NULL, NULL, $7, $8, $9, $10::jsonb, $11
     )
     RETURNING *`,
    [
      randomUUID(),
      options.userId,
      nextFileName,
      nextFileName,
      0,
      nextFileType,
      normalizedUrl,
      nextThumbnailUrl,
      normalizedTags,
      JSON.stringify([usageKey]),
      nextCategory,
    ],
  );

  const row = inserted.rows[0];
  await upsertMediaImageLink(row.id, options.userId, options.sourceTable, options.sourceId, options.sourceField);
  return { row, created: true };
}

async function syncProfileMedia(user: Pick<DbUserRow, 'id' | 'avatar_url' | 'cover_url'>): Promise<number> {
  let created = 0;
  const avatarResult = await ensureMediaRecordForSource({
    userId: user.id,
    sourceTable: 'users',
    sourceId: user.id,
    sourceField: 'avatar_url',
    url: user.avatar_url,
    fileName: `profile-avatar-${user.id}.jpg`,
    tags: ['profile', 'avatar'],
    category: 'user',
  });
  if (avatarResult?.created) created += 1;
  await pruneMediaLinksForSource(user.id, 'users', user.id, 'avatar_url', avatarResult ? [avatarResult.row.id] : []);

  const coverResult = await ensureMediaRecordForSource({
    userId: user.id,
    sourceTable: 'users',
    sourceId: user.id,
    sourceField: 'cover_url',
    url: user.cover_url,
    fileName: `profile-cover-${user.id}.jpg`,
    tags: ['profile', 'cover'],
    category: 'user',
  });
  if (coverResult?.created) created += 1;
  await pruneMediaLinksForSource(user.id, 'users', user.id, 'cover_url', coverResult ? [coverResult.row.id] : []);

  return created;
}

async function syncBlogPostMedia(
  userId: string,
  post: { id: string; title?: string | null; featured_image?: string | null; social_image?: string | null; content?: string | null },
): Promise<number> {
  let created = 0;

  const featured = await ensureMediaRecordForSource({
    userId,
    sourceTable: 'blog_posts',
    sourceId: post.id,
    sourceField: 'featured_image',
    url: post.featured_image,
    fileName: `post-featured-${post.id}.jpg`,
    tags: ['post', 'featured'],
    category: 'user',
  });
  if (featured?.created) created += 1;
  await pruneMediaLinksForSource(userId, 'blog_posts', post.id, 'featured_image', featured ? [featured.row.id] : []);

  const social = await ensureMediaRecordForSource({
    userId,
    sourceTable: 'blog_posts',
    sourceId: post.id,
    sourceField: 'social_image',
    url: post.social_image,
    fileName: `post-social-${post.id}.jpg`,
    tags: ['post', 'social'],
    category: 'user',
  });
  if (social?.created) created += 1;
  await pruneMediaLinksForSource(userId, 'blog_posts', post.id, 'social_image', social ? [social.row.id] : []);

  const contentUrls = extractImageUrlsFromHtml(String(post.content || ''));
  const contentMediaIds: string[] = [];
  for (const [index, contentUrl] of contentUrls.entries()) {
    const synced = await ensureMediaRecordForSource({
      userId,
      sourceTable: 'blog_posts',
      sourceId: post.id,
      sourceField: 'content',
      url: contentUrl,
      fileName: `post-inline-${post.id}-${index + 1}.jpg`,
      tags: ['post', 'content'],
      category: 'user',
    });
    if (synced) {
      contentMediaIds.push(synced.row.id);
      if (synced.created) created += 1;
    }
  }
  await pruneMediaLinksForSource(userId, 'blog_posts', post.id, 'content', uniqueStrings(contentMediaIds));

  return created;
}

async function syncUserDesignMedia(
  userId: string,
  design: { id: string; name?: string | null; thumbnail_url?: string | null; canvas_data?: unknown },
): Promise<number> {
  let created = 0;

  const thumbnail = await ensureMediaRecordForSource({
    userId,
    sourceTable: 'user_designs',
    sourceId: design.id,
    sourceField: 'thumbnail_url',
    url: design.thumbnail_url,
    fileName: `${sanitizeFileName(design.name || 'design') || 'design'}-thumb.jpg`,
    tags: ['design', 'thumbnail'],
    category: 'user',
  });
  if (thumbnail?.created) created += 1;
  await pruneMediaLinksForSource(userId, 'user_designs', design.id, 'thumbnail_url', thumbnail ? [thumbnail.row.id] : []);

  const canvasMediaIds: string[] = [];
  const canvasUrls = extractImageUrlsFromCanvasData(design.canvas_data);
  for (const [index, canvasUrl] of canvasUrls.entries()) {
    const synced = await ensureMediaRecordForSource({
      userId,
      sourceTable: 'user_designs',
      sourceId: design.id,
      sourceField: 'canvas_data',
      url: canvasUrl,
      fileName: `${sanitizeFileName(design.name || 'design') || 'design'}-asset-${index + 1}.jpg`,
      tags: ['design', 'asset'],
      category: 'user',
    });
    if (synced) {
      canvasMediaIds.push(synced.row.id);
      if (synced.created) created += 1;
    }
  }
  await pruneMediaLinksForSource(userId, 'user_designs', design.id, 'canvas_data', uniqueStrings(canvasMediaIds));

  return created;
}

async function syncCardTemplateMedia(
  adminUserId: string,
  template: { id: string; name?: string | null; cover_image_url?: string | null },
): Promise<number> {
  const cover = await ensureMediaRecordForSource({
    userId: adminUserId,
    sourceTable: 'card_templates',
    sourceId: template.id,
    sourceField: 'cover_image_url',
    url: template.cover_image_url,
    fileName: `${sanitizeFileName(template.name || 'card-template') || 'card-template'}-cover.jpg`,
    tags: ['card-template', 'cover'],
    category: 'admin',
  });
  await pruneMediaLinksForSource(
    adminUserId,
    'card_templates',
    template.id,
    'cover_image_url',
    cover ? [cover.row.id] : [],
  );
  return cover?.created ? 1 : 0;
}

async function syncAllPersistedMediaForUser(userId: string): Promise<{ created: number; scanned: number }> {
  if (!hasDatabase()) return { created: 0, scanned: 0 };

  let created = 0;
  let scanned = 0;

  const userResult = await pool!.query<Pick<DbUserRow, 'id' | 'avatar_url' | 'cover_url'>>(
    'SELECT id, avatar_url, cover_url FROM users WHERE id = $1 LIMIT 1',
    [userId],
  );
  const userRow = userResult.rows[0];
  if (userRow) {
    scanned += [userRow.avatar_url, userRow.cover_url].filter(Boolean).length;
    created += await syncProfileMedia(userRow);
  }

  const postsResult = await pool!.query<{ id: string; title: string | null; featured_image: string | null; social_image: string | null; content: string | null }>(
    'SELECT id, title, featured_image, social_image, content FROM blog_posts WHERE user_id = $1',
    [userId],
  );
  for (const post of postsResult.rows) {
    scanned += [post.featured_image, post.social_image].filter(Boolean).length;
    scanned += extractImageUrlsFromHtml(String(post.content || '')).length;
    created += await syncBlogPostMedia(userId, post);
  }

  const designsResult = await pool!.query<DbDesign>(
    'SELECT id, name, canvas_data, thumbnail_url, created_at, updated_at, user_id, canvas_width, canvas_height FROM user_designs WHERE user_id = $1',
    [userId],
  );
  for (const design of designsResult.rows) {
    scanned += design.thumbnail_url ? 1 : 0;
    scanned += extractImageUrlsFromCanvasData(design.canvas_data).length;
    created += await syncUserDesignMedia(userId, design);
  }

  return { created, scanned };
}

// GET /media/:id/:filename — public binary image serve (no auth, for external embeds & featured images)
app.get('/media/:id/:filename', async (req: Request, res: Response) => {
  if (!hasDatabase()) return res.status(503).send('Database not configured');
  try {
    const { rows } = await pool!.query(
      'SELECT url, file_type, file_name FROM media_images WHERE id = $1',
      [req.params.id]
    );
    if (!rows.length) return res.status(404).send('Not found');
    const row = rows[0] as { url: string; file_type: string; file_name: string };
    const dataUrl = String(row.url || '');
    if (!dataUrl) return res.status(404).send('Image data missing');
    if (!dataUrl.startsWith('data:')) return res.redirect(dataUrl);
    const commaIdx = dataUrl.indexOf(',');
    if (commaIdx === -1) return res.status(500).send('Invalid image format');
    const mime = dataUrl.slice(5, commaIdx).replace(';base64', '') || row.file_type || 'image/jpeg';
    const buffer = Buffer.from(dataUrl.slice(commaIdx + 1), 'base64');
    res.setHeader('Content-Type', mime);
    res.setHeader('Content-Length', buffer.length);
    res.setHeader('Cache-Control', 'public, max-age=86400');
    return res.send(buffer);
  } catch (err) {
    console.error('media serve error:', err);
    return res.status(500).send('Failed to serve image');
  }
});

// Upload image to media library
app.post('/api/media/upload', async (req: Request, res: Response) => {
  const user = await requireAuth(req, res);
  if (!user) return;
  const { url, thumbnail_url, file_name, original_name, file_size, file_type, width, height, category, force } =
    req.body as {
      url: string; thumbnail_url?: string; file_name: string; original_name: string;
      file_size: number; file_type: string; width?: number; height?: number; category?: string; force?: boolean;
    };
  if (!url || !file_name || !original_name || !file_type)
    return res.status(400).json({ success: false, error: 'Missing required fields' });
  const allowedTypes = ['image/jpeg', 'image/png', 'image/webp', 'image/svg+xml'];
  if (!allowedTypes.includes(file_type))
    return res.status(400).json({ success: false, error: 'Unsupported image type' });
  const MAX_SIZE = 10 * 1024 * 1024;
  if (file_size > MAX_SIZE)
    return res.status(400).json({ success: false, error: 'Image exceeds the maximum upload size of 10MB.' });
  if (!hasDatabase()) return res.status(503).json({ success: false, error: 'No database' });
  try {
    const safeName = sanitizeFileName(file_name);
    // Duplicate check
    if (!force) {
      const dup = await pool!.query(
        'SELECT id, file_name, file_size, upload_date FROM media_images WHERE user_id = $1 AND file_name = $2 LIMIT 1',
        [user.userId, safeName]
      );
      if (dup.rows.length) {
        // Find next available name: base(1).ext, base(2).ext, ...
        const dotIdx = safeName.lastIndexOf('.');
        const base = dotIdx !== -1 ? safeName.slice(0, dotIdx) : safeName;
        const ext = dotIdx !== -1 ? safeName.slice(dotIdx) : '';
        const existingNames = await pool!.query(
          `SELECT file_name FROM media_images WHERE user_id = $1 AND file_name LIKE $2`,
          [user.userId, `${base}(%${ext}`]
        );
        const existingSet = new Set(existingNames.rows.map((r: any) => r.file_name));
        let n = 1;
        while (existingSet.has(`${base}(${n})${ext}`)) n++;
        const suggestedName = `${base}(${n})${ext}`;
        return res.status(409).json({
          success: false,
          error: 'duplicate',
          existingImage: transformMediaRow(dup.rows[0]),
          suggestedName,
        });
      }
    }
    const id = randomUUID();
    // Only admins may upload directly as category='admin' (shared library).
    // For all other callers — including admins uploading personal images — default to 'user'.
    let imgCategory = 'user';
    if (category === 'admin' && hasDatabase()) {
      const roleRow = await pool!.query('SELECT role FROM users WHERE id=$1', [user.userId]).catch(() => ({ rows: [] as any[] }));
      if (roleRow.rows[0]?.role === 'admin') imgCategory = 'admin';
    }
    const { rows } = await pool!.query(
      `INSERT INTO media_images (id, user_id, file_name, original_name, file_size, file_type, width, height, url, thumbnail_url, tags, used_in, category)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,'{}','[]',$11) RETURNING *`,
      [id, user.userId, safeName, original_name, file_size ?? 0, file_type, width ?? null, height ?? null, url, thumbnail_url ?? url, imgCategory]
    );
    return res.json({ success: true, image: transformMediaRow(rows[0]) });
  } catch (err) {
    console.error('media upload error:', err);
    return res.status(500).json({ success: false, error: 'Upload failed' });
  }
});

// List user's media images
app.get('/api/media', async (req: Request, res: Response) => {
  const user = await requireAuth(req, res);
  if (!user) return;
  if (!hasDatabase()) return res.json({ success: true, images: [] });
  const { search, tag } = req.query as { search?: string; tag?: string };
  try {
    await syncAllPersistedMediaForUser(user.userId).catch((error) => {
      console.error('Media list sync error:', error);
    });

    const params: unknown[] = [user.userId];
    // Strict user isolation — only return the requesting user's own images.
    // Admin-shared library assets are served separately via GET /api/media/admin-assets.
    let query = `SELECT * FROM media_images WHERE user_id = $1 AND COALESCE(category, 'user') = 'user'`;
    if (search) { query += ` AND (file_name ILIKE $${params.length + 1} OR original_name ILIKE $${params.length + 1})`; params.push(`%${search}%`); }
    if (tag) { query += ` AND $${params.length + 1} = ANY(tags)`; params.push(tag); }
    query += ' ORDER BY upload_date DESC';
    const { rows } = await pool!.query(query, params);
    return res.json({ success: true, images: rows.map(transformMediaRow) });
  } catch (err) {
    console.error('media list error:', err);
    return res.status(500).json({ success: false, error: 'Failed to fetch images' });
  }
});

// GET /api/media/:id/image — serve the raw image as binary (used by external platforms like Facebook)
app.get('/api/media/:id/image', async (req: Request, res: Response) => {
  if (!hasDatabase()) return res.status(503).send('Database not configured');
  try {
    const { rows } = await pool!.query(
      'SELECT url, file_type, file_name FROM media_images WHERE id = $1',
      [req.params.id]
    );
    if (!rows.length) return res.status(404).send('Not found');
    const row = rows[0] as { url: string; file_type: string; file_name: string };
    const dataUrl = String(row.url || '');
    if (!dataUrl) return res.status(404).send('Image data missing');

    // data URL format: "data:<mime>;base64,<data>"
    const commaIdx = dataUrl.indexOf(',');
    if (commaIdx === -1 || !dataUrl.startsWith('data:')) {
      // Already a plain HTTP URL — redirect to it
      return res.redirect(dataUrl);
    }
    const mimeMatch = dataUrl.slice(5, commaIdx).replace(';base64', '');
    const mime = mimeMatch || row.file_type || 'image/jpeg';
    const base64Data = dataUrl.slice(commaIdx + 1);
    const buffer = Buffer.from(base64Data, 'base64');

    res.setHeader('Content-Type', mime);
    res.setHeader('Content-Length', buffer.length);
    res.setHeader('Cache-Control', 'public, max-age=86400');
    return res.send(buffer);
  } catch (err) {
    console.error('media serve error:', err);
    return res.status(500).send('Failed to serve image');
  }
});

// Update image metadata (rename / tags / alt text / caption / description)
app.put('/api/media/:id', async (req: Request, res: Response) => {
  const user = await requireAuth(req, res);
  if (!user) return;
  const { id } = req.params;
  const { file_name, tags, alt_text, caption, description } = req.body as {
    file_name?: string;
    tags?: string[];
    alt_text?: string;
    caption?: string;
    description?: string;
  };
  if (!hasDatabase()) return res.status(503).json({ success: false, error: 'No database' });
  try {
    const updates: string[] = [];
    const params: unknown[] = [id, user.userId];
    if (file_name !== undefined) { updates.push(`file_name = $${params.length + 1}`); params.push(sanitizeFileName(file_name)); }
    if (tags !== undefined) { updates.push(`tags = $${params.length + 1}`); params.push(tags); }
    if (alt_text !== undefined) { updates.push(`alt_text = $${params.length + 1}`); params.push(String(alt_text).slice(0, 1000)); }
    if (caption !== undefined) { updates.push(`caption = $${params.length + 1}`); params.push(String(caption).slice(0, 2000)); }
    if (description !== undefined) { updates.push(`description = $${params.length + 1}`); params.push(String(description).slice(0, 5000)); }
    if (!updates.length) return res.status(400).json({ success: false, error: 'Nothing to update' });
    const { rows } = await pool!.query(
      `UPDATE media_images SET ${updates.join(', ')} WHERE id = $1 AND user_id = $2 RETURNING *`,
      params
    );
    if (!rows.length) return res.status(404).json({ success: false, error: 'Image not found' });
    return res.json({ success: true, image: transformMediaRow(rows[0]) });
  } catch (err) {
    console.error('media update error:', err);
    return res.status(500).json({ success: false, error: 'Update failed' });
  }
});

// Delete single image
app.delete('/api/media/:id', async (req: Request, res: Response) => {
  const user = await requireAuth(req, res);
  if (!user) return;
  const { id } = req.params;
  if (!hasDatabase()) return res.status(503).json({ success: false, error: 'No database' });
  try {
    await pool!.query('DELETE FROM media_images WHERE id = $1 AND user_id = $2', [id, user.userId]);
    return res.json({ success: true });
  } catch (err) {
    console.error('media delete error:', err);
    return res.status(500).json({ success: false, error: 'Delete failed' });
  }
});

// Bulk delete
app.post('/api/media/bulk-delete', async (req: Request, res: Response) => {
  const user = await requireAuth(req, res);
  if (!user) return;
  const { ids } = req.body as { ids: string[] };
  if (!Array.isArray(ids) || !ids.length) return res.status(400).json({ success: false, error: 'ids required' });
  if (!hasDatabase()) return res.status(503).json({ success: false, error: 'No database' });
  try {
    await pool!.query('DELETE FROM media_images WHERE id = ANY($1) AND user_id = $2', [ids, user.userId]);
    return res.json({ success: true });
  } catch (err) {
    console.error('media bulk delete error:', err);
    return res.status(500).json({ success: false, error: 'Bulk delete failed' });
  }
});

// Admin: list all images
app.get('/api/admin/media', async (req: Request, res: Response) => {
  const admin = await requireAdmin(req, res);
  if (!admin) return;
  if (!hasDatabase()) return res.json({ success: true, images: [] });
  const { search, userId } = req.query as { search?: string; userId?: string };
  try {
    if (userId) {
      await syncAllPersistedMediaForUser(userId).catch((error) => {
        console.error('Admin media list sync error:', error);
      });
    }

    const params: unknown[] = [];
    const where: string[] = [];
    if (userId) { where.push(`m.user_id = $${params.length + 1}`); params.push(userId); }
    if (search) { where.push(`(m.file_name ILIKE $${params.length + 1} OR u.username ILIKE $${params.length + 1})`); params.push(`%${search}%`); }
    const whereClause = where.length ? `WHERE ${where.join(' AND ')}` : '';
    const { rows } = await pool!.query(
      `SELECT m.*, u.username, u.email as user_email
       FROM media_images m JOIN users u ON m.user_id = u.id
       ${whereClause} ORDER BY m.upload_date DESC LIMIT 500`,
      params
    );
    return res.json({ success: true, images: rows.map(transformMediaRow) });
  } catch (err) {
    console.error('admin media list error:', err);
    return res.status(500).json({ success: false, error: 'Failed to fetch images' });
  }
});

// Admin: stats
app.get('/api/admin/media/stats', async (req: Request, res: Response) => {
  const admin = await requireAdmin(req, res);
  if (!admin) return;
  if (!hasDatabase()) return res.json({ success: true, stats: { total_images: 0, total_size: 0, users_count: 0 } });
  try {
    const { rows } = await pool!.query(
      `SELECT COUNT(*) as total_images, COALESCE(SUM(file_size),0) as total_size, COUNT(DISTINCT user_id) as users_count FROM media_images`
    );
    return res.json({ success: true, stats: rows[0] });
  } catch (err) {
    console.error('admin media stats error:', err);
    return res.status(500).json({ success: false, error: 'Failed to fetch stats' });
  }
});

// Admin: delete any image
app.delete('/api/admin/media/:id', async (req: Request, res: Response) => {
  const admin = await requireAdmin(req, res);
  if (!admin) return;
  const { id } = req.params;
  if (!hasDatabase()) return res.status(503).json({ success: false, error: 'No database' });
  try {
    await pool!.query('DELETE FROM media_images WHERE id = $1', [id]);
    return res.json({ success: true });
  } catch (err) {
    console.error('admin media delete error:', err);
    return res.status(500).json({ success: false, error: 'Delete failed' });
  }
});

// Get admin-category assets (accessible to authenticated users for template suggestions)
app.get('/api/media/admin-assets', async (req: Request, res: Response) => {
  const user = await requireAuth(req, res);
  if (!user) return;
  if (!hasDatabase()) return res.status(503).json({ success: false, error: 'No database' });
  try {
    const { rows } = await pool!.query(
      `SELECT id, file_name, file_type, width, height, url, thumbnail_url, tags, upload_date
       FROM media_images WHERE category = 'admin' ORDER BY upload_date DESC LIMIT 200`
    );
    return res.json({ success: true, images: rows.map(transformMediaRow) });
  } catch (err) {
    console.error('admin assets error:', err);
    return res.status(500).json({ success: false, error: 'Failed to load admin assets' });
  }
});

// Admin: update media category
app.patch('/api/admin/media/:id/category', async (req: Request, res: Response) => {
  const admin = await requireAdmin(req, res);
  if (!admin) return;
  const { id } = req.params;
  const { category } = req.body as { category: string };
  const allowed = ['user', 'admin'];
  if (!allowed.includes(category)) return res.status(400).json({ success: false, error: 'Invalid category' });
  if (!hasDatabase()) return res.status(503).json({ success: false, error: 'No database' });
  try {
    const { rows } = await pool!.query('UPDATE media_images SET category=$1 WHERE id=$2 RETURNING *', [category, id]);
    return res.json({ success: true, image: transformMediaRow(rows[0]) });
  } catch (err) {
    console.error('admin media category error:', err);
    return res.status(500).json({ success: false, error: 'Update failed' });
  }
});

// User: Audit images - shows all images and identifies missing registrations
app.get('/api/media/audit', async (req: Request, res: Response) => {
  const user = await requireAuth(req, res);
  if (!user) return;
  if (!hasDatabase()) return res.json({ success: true, audit: { media_images: 0, featured_images: 0, unregistered: [] } });
  try {
    // 1. Count images in media_images (should only show user's images)
    const mediaCount = await pool!.query(
      'SELECT COUNT(*) as count FROM media_images WHERE user_id = $1 AND category = $2',
      [user.userId, 'user']
    );
    
    // 2. Find all featured images in blog posts for this user
    const featuredImages = await pool!.query(
      'SELECT id, featured_image FROM blog_posts WHERE user_id = $1 AND featured_image IS NOT NULL AND featured_image != $2',
      [user.userId, '']
    );

    // 3. Check which featured images are NOT in media_images table
    const unregistered: any[] = [];
    for (const post of featuredImages.rows) {
      if (!post.featured_image) continue;
      const found = await pool!.query(
        'SELECT id FROM media_images WHERE url = $1 AND user_id = $2',
        [post.featured_image, user.userId]
      );
      if (!found.rows.length) {
        unregistered.push({
          post_id: post.id,
          featured_image: post.featured_image,
          in_media_images: false
        });
      }
    }

    // 4. Get user avatar/cover if they exist
    const userProfile = await pool!.query(
      'SELECT avatar_url, cover_url FROM users WHERE id = $1',
      [user.userId]
    );
    const profileImages: any[] = [];
    if (userProfile.rows[0]?.avatar_url) {
      profileImages.push({ type: 'avatar', url: userProfile.rows[0].avatar_url });
    }
    if (userProfile.rows[0]?.cover_url) {
      profileImages.push({ type: 'cover', url: userProfile.rows[0].cover_url });
    }

    return res.json({
      success: true,
      audit: {
        media_images_count: mediaCount.rows[0].count,
        featured_images_count: featuredImages.rows.length,
        unregistered_featured: unregistered,
        profile_images: profileImages,
        summary: `Total media: ${mediaCount.rows[0].count}, Featured posts: ${featuredImages.rows.length}, Unregistered featured: ${unregistered.length}`
      }
    });
  } catch (err) {
    console.error('media audit error:', err);
    return res.status(500).json({ success: false, error: 'Audit failed' });
  }
});

// User: Sync all images - registers missing featured images to media_images table
app.post('/api/media/sync-all-images', async (req: Request, res: Response) => {
  const user = await requireAuth(req, res);
  if (!user) return;
  if (!hasDatabase()) return res.json({ success: true, synced: 0 });
  try {
    const sync = await syncAllPersistedMediaForUser(user.userId);
    return res.json({
      success: true,
      synced: sync.created,
      scanned: sync.scanned,
      message: `Synced ${sync.created} missing image(s) from ${sync.scanned} persisted source reference(s)`,
    });
  } catch (err) {
    console.error('media sync error:', err);
    return res.status(500).json({ success: false, error: 'Sync failed' });
  }
});

// Admin: Verify media database integrity and clean up
app.post('/api/admin/media/verify-integrity', async (req: Request, res: Response) => {
  const admin = await requireAdmin(req, res);
  if (!admin) return;
  if (!hasDatabase()) return res.json({ success: true, issues: [] });
  try {
    const issues: any[] = [];

    // Check 1: Find admin images that belong to regular users
    const adminOwnedByUsers = await pool!.query(
      `SELECT m.id, m.user_id, u.role FROM media_images m
       JOIN users u ON m.user_id = u.id
       WHERE m.category = 'admin' AND u.role != 'admin'`
    );
    if (adminOwnedByUsers.rows.length) {
      issues.push({
        type: 'category_mismatch',
        count: adminOwnedByUsers.rows.length,
        description: 'Found admin-category images owned by non-admin users',
        ids: adminOwnedByUsers.rows.map((r: any) => r.id)
      });
    }

    // Check 2: Find users with images where user_id doesn't match
    const orphanedImages = await pool!.query(
      `SELECT m.id, m.user_id FROM media_images m
       WHERE m.user_id NOT IN (SELECT id FROM users)`
    );
    if (orphanedImages.rows.length) {
      issues.push({
        type: 'orphaned_images',
        count: orphanedImages.rows.length,
        description: 'Found images with non-existent user_id',
        ids: orphanedImages.rows.map((r: any) => r.id)
      });
    }

    // Check 3: Count images per user
    const userImageStats = await pool!.query(
      `SELECT u.id, u.username, COUNT(m.id) as image_count
       FROM users u LEFT JOIN media_images m ON u.id = m.user_id AND COALESCE(m.category, 'user') = 'user'
       GROUP BY u.id, u.username
       HAVING COUNT(m.id) > 0
       ORDER BY COUNT(m.id) DESC`
    );

    // Check 4: Find featured images not registered in media_images
    const unregisteredFeatured = await pool!.query(
      `SELECT DISTINCT bp.user_id, COUNT(*) as unregistered_count
       FROM blog_posts bp
       WHERE bp.featured_image IS NOT NULL AND bp.featured_image != ''
       AND NOT EXISTS (
         SELECT 1 FROM media_images m
         WHERE m.url = bp.featured_image AND m.user_id = bp.user_id
       )
       GROUP BY bp.user_id`
    );
    if (unregisteredFeatured.rows.length) {
      issues.push({
        type: 'unregistered_featured_images',
        count: unregisteredFeatured.rows.length,
        description: 'Found featured images not registered in media_images',
        details: unregisteredFeatured.rows
      });
    }

    return res.json({
      success: true,
      integrity_check: {
        timestamp: new Date().toISOString(),
        total_users_with_images: userImageStats.rows.length,
        user_image_stats: userImageStats.rows,
        issues: issues.length > 0 ? issues : null,
        summary: issues.length === 0 
          ? 'No integrity issues found' 
          : `Found ${issues.length} integrity issue(s)`
      }
    });
  } catch (err) {
    console.error('media integrity check error:', err);
    return res.status(500).json({ success: false, error: 'Verification failed' });
  }
});

// Admin: Auto-fix media database issues
app.post('/api/admin/media/fix-integrity', async (req: Request, res: Response) => {
  const admin = await requireAdmin(req, res);
  if (!admin) return;
  if (!hasDatabase()) return res.json({ success: true, fixed: 0 });
  try {
    let fixed = 0;

    // Fix 1: Change admin-category images to user-category if owned by non-admins
    const fixCategoryResult = await pool!.query(
      `UPDATE media_images SET category = 'user'
       WHERE category = 'admin' AND user_id NOT IN (SELECT id FROM users WHERE role = 'admin')
       RETURNING id`
    );
    fixed += fixCategoryResult.rows.length;
    if (fixCategoryResult.rows.length > 0) {
      console.log(`[media-fix] Fixed category for ${fixCategoryResult.rows.length} images`);
    }

    // Fix 2: Delete orphaned images
    const deleteOrphanResult = await pool!.query(
      `DELETE FROM media_images WHERE user_id NOT IN (SELECT id FROM users) RETURNING id`
    );
    fixed += deleteOrphanResult.rows.length;
    if (deleteOrphanResult.rows.length > 0) {
      console.log(`[media-fix] Deleted ${deleteOrphanResult.rows.length} orphaned images`);
    }

    // Fix 3: Re-scan persisted image sources for every user and register anything missing.
    const usersResult = await pool!.query<{ id: string }>('SELECT id FROM users');
    for (const row of usersResult.rows) {
      const sync = await syncAllPersistedMediaForUser(row.id);
      fixed += sync.created;
    }
    if (usersResult.rows.length > 0) {
      console.log(`[media-fix] Re-scanned persisted media sources for ${usersResult.rows.length} user(s)`);
    }

    return res.json({ 
      success: true, 
      fixed,
      message: `Fixed ${fixed} media integrity issues`
    });
  } catch (err) {
    console.error('media fix integrity error:', err);
    return res.status(500).json({ success: false, error: 'Fix failed' });
  }
});

// ── DB Audit & Cleanup (admin-only, one-shot) ──────────────────────────────
app.get('/api/admin/db-audit', async (req: Request, res: Response) => {
  const admin = await requireAdmin(req, res);
  if (!admin) return;
  if (!pool) return res.status(503).json({ success: false, error: 'DB not ready' });
  try {
    // ── Table list ────────────────────────────────────────────────────────
    const tablesRes = await pool.query(`
      SELECT t.tablename,
             pg_size_pretty(pg_total_relation_size(quote_ident('public') || '.' || quote_ident(t.tablename))) AS size_pretty,
             pg_total_relation_size(quote_ident('public') || '.' || quote_ident(t.tablename)) AS size_bytes,
             COALESCE(s.n_live_tup, 0) AS row_count
      FROM pg_tables t
      LEFT JOIN pg_stat_user_tables s ON s.relname = t.tablename AND s.schemaname = 'public'
      WHERE t.schemaname = 'public'
      ORDER BY size_bytes DESC
    `);

    // ── Duplicate tables (case-insensitive) ───────────────────────────────
    const dupsRes = await pool.query(`
      SELECT LOWER(tablename) AS normalized_name,
             STRING_AGG(tablename, ',') AS variants,
             COUNT(*)::int AS count
      FROM pg_tables WHERE schemaname = 'public'
      GROUP BY LOWER(tablename) HAVING COUNT(*) > 1
    `);

    // ── Empty tables ──────────────────────────────────────────────────────
    const emptyRes = await pool.query(`
      SELECT t.tablename
      FROM pg_tables t
      LEFT JOIN pg_stat_user_tables s ON s.relname = t.tablename AND s.schemaname = 'public'
      WHERE t.schemaname = 'public' AND COALESCE(s.n_live_tup, 0) = 0
      ORDER BY t.tablename
    `);

    // ── Unused indexes ────────────────────────────────────────────────────
    const idxRes = await pool.query(`
      SELECT s.relname AS table_name, s.indexrelname AS index_name,
             s.idx_scan AS scans,
             pg_size_pretty(pg_relation_size(s.indexrelid)) AS size_pretty,
             pg_relation_size(s.indexrelid) AS size_bytes
      FROM pg_stat_user_indexes s
      JOIN pg_index ix ON ix.indexrelid = s.indexrelid
      WHERE s.schemaname = 'public' AND s.idx_scan = 0 AND NOT ix.indisprimary
      ORDER BY size_bytes DESC
    `);

    // ── Orphaned FK rows ──────────────────────────────────────────────────
    const fkRes = await pool.query(`
      SELECT kcu.table_name AS child_table, kcu.column_name AS fk_column, ccu.table_name AS parent_table
      FROM information_schema.table_constraints tc
      JOIN information_schema.key_column_usage kcu
        ON tc.constraint_name = kcu.constraint_name AND tc.table_schema = kcu.table_schema
      JOIN information_schema.constraint_column_usage ccu
        ON ccu.constraint_name = tc.constraint_name AND ccu.table_schema = tc.table_schema
      WHERE tc.constraint_type = 'FOREIGN KEY' AND tc.table_schema = 'public'
    `);
    const orphans: { child_table: string; fk_column: string; parent_table: string; count: number }[] = [];
    for (const fk of fkRes.rows as any[]) {
      try {
        const cnt = await pool.query(
          `SELECT COUNT(*)::int AS c FROM "${fk.child_table}"
           WHERE "${fk.fk_column}" IS NOT NULL
             AND "${fk.fk_column}" NOT IN (SELECT id FROM "${fk.parent_table}")`
        );
        if ((cnt.rows[0]?.c ?? 0) > 0)
          orphans.push({ child_table: fk.child_table, fk_column: fk.fk_column, parent_table: fk.parent_table, count: cnt.rows[0].c });
      } catch { /* skip complex FKs */ }
    }

    // ── Cache hit ratio ───────────────────────────────────────────────────
    const cacheRes = await pool.query(`
      SELECT ROUND(SUM(heap_blks_hit)::numeric / NULLIF(SUM(heap_blks_hit)+SUM(heap_blks_read),0)*100,2) AS ratio
      FROM pg_statio_user_tables
    `);

    const issues = {
      duplicate_tables: dupsRes.rows.length,
      empty_tables: emptyRes.rows.length,
      unused_indexes: idxRes.rows.length,
      orphaned_fk_rows: orphans.length,
    };

    return res.json({
      success: true,
      issues,
      tables: tablesRes.rows,
      duplicates: dupsRes.rows.map((r: any) => ({ normalizedName: r.normalized_name, variants: r.variants.split(','), count: r.count })),
      empty_tables: emptyRes.rows.map((r: any) => r.tablename),
      unused_indexes: idxRes.rows,
      orphaned_records: orphans,
      cache_hit_ratio_pct: cacheRes.rows[0]?.ratio ?? null,
    });
  } catch (err: any) {
    console.error('[db-audit]', err);
    return res.status(500).json({ success: false, error: err.message });
  }
});

app.post('/api/admin/db-cleanup', async (req: Request, res: Response) => {
  const admin = await requireAdmin(req, res);
  if (!admin) return;
  if (!pool) return res.status(503).json({ success: false, error: 'DB not ready' });

  const { drop_empty, drop_unused_indexes, delete_orphans } = req.body as {
    drop_empty?: string[];
    drop_unused_indexes?: string[];
    delete_orphans?: { child_table: string; fk_column: string; parent_table: string }[];
  };

  const log: string[] = [];
  let errors: string[] = [];

  try {
    // Drop empty tables
    if (drop_empty?.length) {
      for (const t of drop_empty) {
        try {
          await pool.query(`DROP TABLE IF EXISTS "${t}" CASCADE`);
          log.push(`Dropped empty table: ${t}`);
        } catch (e: any) { errors.push(`drop ${t}: ${e.message}`); }
      }
    }

    // Drop unused indexes
    if (drop_unused_indexes?.length) {
      for (const idx of drop_unused_indexes) {
        try {
          await pool.query(`DROP INDEX IF EXISTS "${idx}"`);
          log.push(`Dropped unused index: ${idx}`);
        } catch (e: any) { errors.push(`drop index ${idx}: ${e.message}`); }
      }
    }

    // Delete orphaned records
    if (delete_orphans?.length) {
      for (const o of delete_orphans) {
        try {
          const r = await pool.query(
            `DELETE FROM "${o.child_table}" WHERE "${o.fk_column}" IS NOT NULL AND "${o.fk_column}" NOT IN (SELECT id FROM "${o.parent_table}")`
          );
          log.push(`Deleted ${r.rowCount} orphaned rows from ${o.child_table}.${o.fk_column}`);
        } catch (e: any) { errors.push(`orphan ${o.child_table}: ${e.message}`); }
      }
    }

    // Refresh planner stats
    await pool.query('ANALYZE');
    log.push('ANALYZE complete');

    return res.json({ success: errors.length === 0, log, errors });
  } catch (err: any) {
    console.error('[db-cleanup]', err);
    return res.status(500).json({ success: false, error: err.message, log, errors });
  }
});

app.get('/tiktokGuHuKYUdxb13mmRk5PkdrDFlLEBosnIF.txt', (req: Request, res: Response) => {
  res.setHeader('Content-Type', 'text/plain');
  res.send('tiktok-developers-site-verification=GuHuKYUdxb13mmRk5PkdrDFlLEBosnIF');
});

// GET /api/linkedin/targets — list the connected profile and administrable LinkedIn Pages
app.get('/api/linkedin/targets', async (req: Request, res: Response) => {
  try {
    const auth = requireAuth(req, res);
    if (!auth) return;
    if (!pool) return res.status(503).json({ success: false, error: 'Database not configured' });

    const visiblePlatforms = await getVisibleUserPlatformSlugs();
    if (visiblePlatforms.length > 0 && !visiblePlatforms.includes('linkedin')) {
      return res.status(404).json({ success: false, error: 'LinkedIn is not enabled for this workspace' });
    }

    const conn = await getPublishableSocialConnection(auth.userId, 'linkedin');
    const accessToken = String(conn?.access_token || '').trim();
    if (!accessToken) {
      return res.status(400).json({ success: false, error: 'LinkedIn access token missing or expired — please reconnect' });
    }

    const savedRows = await pool.query(
      `SELECT account_type, account_id
       FROM social_accounts
       WHERE user_id=$1 AND platform='linkedin' AND connected=true`,
      [auth.userId]
    );
    const savedKeys = new Set(
      savedRows.rows.map((row: any) => `${String(row.account_type || '').toLowerCase()}:${String(row.account_id || '').trim()}`)
    );

    let personId =
      String(conn?.account_id || '').trim() ||
      String(conn?.token_data?.sub || conn?.token_data?.user_id || conn?.token_data?.id || '').trim();
    let profileName = String(conn?.account_name || conn?.token_data?.name || '').trim();

    if (!personId || !profileName) {
      // Primary: /v2/me (r_liteprofile — standard "Share on LinkedIn" scope)
      // Fallback: /v2/userinfo (OpenID Connect, for apps with openid/profile scopes)
      const meResp = await axios.get('https://api.linkedin.com/v2/me', {
        headers: { Authorization: `Bearer ${accessToken}` },
        validateStatus: () => true,
        timeout: 15000,
      });
      if (meResp.status < 400) {
        const meData: any = meResp.data || {};
        personId = personId || String(meData?.id || '').trim();
        profileName = profileName ||
          [String(meData?.localizedFirstName || '').trim(), String(meData?.localizedLastName || '').trim()]
            .filter(Boolean)
            .join(' ')
            .trim();
      }
      if (!personId) {
        const userinfoResp = await axios.get('https://api.linkedin.com/v2/userinfo', {
          headers: { Authorization: `Bearer ${accessToken}` },
          validateStatus: () => true,
          timeout: 15000,
        });
        if (userinfoResp.status >= 400) {
          return res.status(400).json({ success: false, error: 'LinkedIn profile lookup failed — please reconnect' });
        }
        const ud: any = userinfoResp.data || {};
        personId = String(ud?.sub || '').trim();
        profileName = profileName || String(ud?.name || '').trim() || [String(ud?.given_name || ''), String(ud?.family_name || '')].filter(Boolean).join(' ').trim();
      }
    }

    if (!personId) {
      return res.status(400).json({ success: false, error: 'Unable to resolve your LinkedIn profile id' });
    }

    const targets: Array<{ id: string; name: string; accountType: 'profile' | 'page'; saved: boolean }> = [
      {
        id: personId,
        name: profileName || 'Personal profile',
        accountType: 'profile',
        saved: savedKeys.has(`profile:${personId}`),
      },
    ];

    const organizationScopeError = getLinkedInOrganizationScopeError(conn?.token_data);
    if (organizationScopeError) {
      return res.json({ success: true, targets, warning: organizationScopeError });
    }

    const { organizations: adminOrganizations, warning } = await listLinkedInAdminOrganizations(accessToken, personId);
    for (const organization of adminOrganizations) {
      targets.push({
        id: organization.id,
        name: organization.name,
        accountType: 'page',
        saved: savedKeys.has(`page:${organization.id}`),
      });
    }

    return res.json({ success: true, targets, warning });
  } catch (error) {
    console.error('LinkedIn targets error:', error);
    return res.status(500).json({ success: false, error: 'Failed to fetch LinkedIn targets' });
  }
});

// POST /api/v1/social/linkedin/token-refresh — manually refresh a LinkedIn access token
app.post('/api/v1/social/linkedin/token-refresh', async (req: Request, res: Response) => {
  const user = await requireAuth(req, res);
  if (!user) return;
  if (!pool) return res.status(503).json({ success: false, error: 'Database not configured' });
  try {
    const conn = await getPublishableSocialConnection(user.userId, 'linkedin');
    if (!conn) return res.status(400).json({ success: false, error: 'LinkedIn not connected' });
    const refreshToken = String(conn.refresh_token || conn.token_data?.refresh_token || '').trim();
    if (!refreshToken) return res.status(400).json({ success: false, error: 'No refresh token stored — reconnect LinkedIn' });

    const refreshed = await refreshLinkedInAccessToken(refreshToken, req);
    const newToken = String(refreshed?.access_token || '').trim();
    if (!newToken) return res.status(400).json({ success: false, error: 'LinkedIn token refresh returned no token' });
    const nextRefreshToken = String(refreshed?.refresh_token || refreshToken || '').trim() || null;

    const expiresAt = String(refreshed?.access_token_expires_at || '').trim() || computeIsoFromTtlSeconds(refreshed?.expires_in);
    const accessTokenEncrypted = encryptIntegrationSecret(newToken);
    const refreshTokenEncrypted = nextRefreshToken ? encryptIntegrationSecret(nextRefreshToken) : null;
    await pool.query(
      `UPDATE social_accounts
       SET access_token=$1,
           refresh_token=$2,
           access_token_encrypted=$3,
           refresh_token_encrypted=$4,
           token_expires_at=$5,
           expires_at=$5,
           needs_reapproval=false,
           token_data = COALESCE(token_data, '{}'::jsonb) || $6::jsonb
       WHERE user_id=$7 AND LOWER(platform)='linkedin'`,
      [null, null, accessTokenEncrypted, refreshTokenEncrypted, expiresAt, JSON.stringify(refreshed || {}), user.userId]
    );
    await upsertUserIntegration({
      userId: user.userId,
      integrationSlug: 'linkedin',
      accessTokenEncrypted,
      refreshTokenEncrypted,
      tokenExpiry: expiresAt,
      accountId: conn.account_id ?? null,
      accountName: conn.account_name ?? null,
      status: 'connected',
    });
    return res.json({ success: true, message: 'LinkedIn access token refreshed', expiresAt });
  } catch (err) {
    console.error('LinkedIn token refresh error:', err);
    return res.status(500).json({ success: false, error: err instanceof Error ? err.message : 'Refresh failed' });
  }
});

// GET /api/v1/social/linkedin/post-insights/:postId — social metadata + share stats for a post
app.get('/api/v1/social/linkedin/post-insights/:postId', async (req: Request, res: Response) => {
  const user = await requireAuth(req, res);
  if (!user) return;
  if (!pool) return res.status(503).json({ success: false, error: 'Database not configured' });
  try {
    const conn = await getPublishableSocialConnection(user.userId, 'linkedin');
    const accessToken = String(conn?.access_token || '').trim();
    if (!accessToken) return res.status(400).json({ success: false, error: 'LinkedIn not connected' });

    const postId = String(req.params.postId || '').trim();
    let orgId = String((req.query as any)?.orgId || '').trim();
    if (!orgId) {
      const pageRow = await pool.query(
        `SELECT account_id FROM social_accounts WHERE user_id=$1 AND platform='linkedin' AND account_type='page' AND connected=true ORDER BY created_at DESC LIMIT 1`,
        [user.userId],
      );
      orgId = pageRow.rows[0]?.account_id ? String(pageRow.rows[0].account_id).trim() : '';
    }

    const [socialMetadataById, shareStatsByPostId] = await Promise.all([
      fetchLinkedInSocialMetadataBatch(accessToken, [postId]),
      orgId
        ? fetchLinkedInShareStatisticsForPosts(accessToken, `urn:li:organization:${orgId}`, [postId])
        : Promise.resolve(new Map<string, any>()),
    ]);
    const socialMetadata: any = socialMetadataById[postId] || {};
    const stats: any = shareStatsByPostId.get(postId) || {};

    return res.json({
      success: true,
      insights: {
        likes: stats?.likeCount ?? sumLinkedInReactionCounts(socialMetadata) ?? null,
        comments: stats?.commentCount ?? socialMetadata?.commentSummary?.count ?? socialMetadata?.commentSummary?.totalCount ?? null,
        shares: stats?.shareCount ?? socialMetadata?.repostSummary?.count ?? socialMetadata?.repostSummary?.totalCount ?? null,
        impressions: stats.impressionCount ?? null,
        clicks: stats.clickCount ?? null,
        uniqueImpressionsCount: stats.uniqueImpressionsCount ?? null,
        engagement: stats.engagement ?? null,
      },
    });
  } catch (err) {
    return res.status(500).json({ success: false, error: err instanceof Error ? err.message : 'Failed to fetch post insights' });
  }
});

// GET /api/v1/social/linkedin/org-analytics — organization follower + visitor/share statistics
app.get('/api/v1/social/linkedin/org-analytics', async (req: Request, res: Response) => {
  const user = await requireAuth(req, res);
  if (!user) return;
  if (!pool) return res.status(503).json({ success: false, error: 'Database not configured' });
  try {
    const conn = await getPublishableSocialConnection(user.userId, 'linkedin');
    const accessToken = String(conn?.access_token || '').trim();
    if (!accessToken) return res.status(400).json({ success: false, error: 'LinkedIn not connected' });
    const organizationScopeError = getLinkedInOrganizationScopeError(conn?.token_data, { requireSocialRead: true });
    if (organizationScopeError) return res.status(400).json({ success: false, error: organizationScopeError });

    // Get org ID from query or stored page accounts
    let orgId = String((req.query as any)?.orgId || '').trim();
    if (!orgId) {
      const pageRow = await pool.query(
        `SELECT account_id FROM social_accounts WHERE user_id=$1 AND platform='linkedin' AND account_type='page' AND connected=true ORDER BY created_at DESC LIMIT 1`,
        [user.userId]
      );
      orgId = pageRow.rows[0]?.account_id ? String(pageRow.rows[0].account_id).trim() : '';
    }
    if (!orgId) return res.status(400).json({ success: false, error: 'No LinkedIn organization page found. Connect a company page first.' });

    const orgUrn = `urn:li:organization:${orgId}`;
    const since = String((req.query as any)?.since || '').trim();
    const until = String((req.query as any)?.until || '').trim();
    const timeGranularity = String((req.query as any)?.granularity || 'MONTH').toUpperCase();

    const params: Record<string, string> = {
      q: 'organizationalEntity',
      organizationalEntity: orgUrn,
      'timeIntervals.timeGranularityType': timeGranularity,
      'timeIntervals.timeRange.start': since || String(Date.now() - 30 * 24 * 60 * 60 * 1000),
      'timeIntervals.timeRange.end': until || String(Date.now()),
    };

    const [networkSize, followerResp, visitorResp, shareResp] = await Promise.all([
      fetchLinkedInOrganizationNetworkSize(accessToken, orgUrn),
      axios.get('https://api.linkedin.com/rest/organizationalEntityFollowerStatistics', { params, headers: getLinkedInRestHeaders(accessToken), validateStatus: () => true, timeout: 15000 }),
      axios.get('https://api.linkedin.com/rest/organizationPageStatistics', {
        params: {
          q: 'organization',
          organization: orgUrn,
          'timeIntervals.timeGranularityType': timeGranularity,
          'timeIntervals.timeRange.start': since || String(Date.now() - 30 * 24 * 60 * 60 * 1000),
          'timeIntervals.timeRange.end': until || String(Date.now()),
        },
        headers: getLinkedInRestHeaders(accessToken),
        validateStatus: () => true,
        timeout: 15000,
      }),
      axios.get('https://api.linkedin.com/rest/organizationalEntityShareStatistics', { params, headers: getLinkedInRestHeaders(accessToken), validateStatus: () => true, timeout: 15000 }),
    ]);

    return res.json({
      success: true,
      orgId,
      followerCount: networkSize,
      followers: followerResp.status < 400 ? (followerResp.data as any)?.elements || [] : null,
      visitors: visitorResp.status < 400 ? (visitorResp.data as any)?.elements || [] : null,
      shares: shareResp.status < 400 ? (shareResp.data as any)?.elements || [] : null,
    });
  } catch (err) {
    return res.status(500).json({ success: false, error: err instanceof Error ? err.message : 'Failed to fetch org analytics' });
  }
});

// Link metadata preview (no auth, rate-limited by IP)
app.get('/api/link-metadata', async (req: Request, res: Response) => {
  const url = String((req.query as any)?.url || '').trim();
  if (!url) return res.status(400).json({ error: 'URL is required' });

  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return res.status(400).json({ error: 'Invalid URL' });
  }

  if (!['http:', 'https:'].includes(parsed.protocol)) {
    return res.status(400).json({ error: 'Invalid URL protocol' });
  }

  const ip = getClientIp(req);
  if (!checkLinkMetadataRateLimit(ip)) {
    return res.status(429).json({ error: 'Rate limit exceeded' });
  }

  const metadata = await fetchLinkMetadata(url);
  if (!metadata) {
    return res.status(404).json({ error: 'Unable to fetch link metadata', url });
  }

  return res.json(metadata);
});

// ── Blog Post Management ───────────────────────────────────────────────────────

function slugify(text: string): string {
  return text.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');
}

// Ensure blog endpoints never run without a DB connection.
app.use('/api/blog', (req: Request, res: Response, next) => {
  if (!hasDatabase()) {
    return res.status(503).json({ success: false, error: 'Database not configured' });
  }
  return next();
});

registerBlogAnalyticsRoutes({
  app,
  getPool: () => pool,
  requireAuth,
});

// GET /api/blog/categories
app.get('/api/blog/categories', async (req: Request, res: Response) => {
  const user = await requireAuth(req, res);
  if (!user) return;
  const { rows } = await pool!.query(
    'SELECT * FROM blog_categories WHERE user_id=$1 ORDER BY name',
    [user.userId]
  );
  return res.json({ success: true, categories: rows });
});

// POST /api/blog/categories
app.post('/api/blog/categories', async (req: Request, res: Response) => {
  const user = await requireAuth(req, res);
  if (!user) return;
  const { name } = req.body as { name: string };
  if (!name?.trim()) return res.status(400).json({ success: false, error: 'Name required' });
  const id = randomUUID();
  const slug = slugify(name);
  const { rows } = await pool!.query(
    'INSERT INTO blog_categories (id, user_id, name, slug) VALUES ($1,$2,$3,$4) RETURNING *',
    [id, user.userId, name.trim(), slug]
  );
  return res.json({ success: true, category: rows[0] });
});

// PUT /api/blog/categories/:id
app.put('/api/blog/categories/:id', async (req: Request, res: Response) => {
  const user = await requireAuth(req, res);
  if (!user) return;
  const { id } = req.params;
  const { name } = req.body as { name: string };
  if (!name?.trim()) return res.status(400).json({ success: false, error: 'Name required' });
  const slug = slugify(name);
  const { rows } = await pool!.query(
    'UPDATE blog_categories SET name=$1, slug=$2 WHERE id=$3 AND user_id=$4 RETURNING *',
    [name.trim(), slug, id, user.userId]
  );
  if (!rows.length) return res.status(404).json({ success: false, error: 'Not found' });
  return res.json({ success: true, category: rows[0] });
});

// DELETE /api/blog/categories/:id
app.delete('/api/blog/categories/:id', async (req: Request, res: Response) => {
  const user = await requireAuth(req, res);
  if (!user) return;
  const { id } = req.params;
  await pool!.query('DELETE FROM blog_categories WHERE id=$1 AND user_id=$2', [id, user.userId]);
  return res.json({ success: true });
});

// GET /api/blog/tags
app.get('/api/blog/tags', async (req: Request, res: Response) => {
  const user = await requireAuth(req, res);
  if (!user) return;
  const { rows } = await pool!.query(
    'SELECT * FROM blog_tags WHERE user_id=$1 ORDER BY name',
    [user.userId]
  );
  return res.json({ success: true, tags: rows });
});

// POST /api/blog/tags
app.post('/api/blog/tags', async (req: Request, res: Response) => {
  const user = await requireAuth(req, res);
  if (!user) return;
  const { name } = req.body as { name: string };
  if (!name?.trim()) return res.status(400).json({ success: false, error: 'Name required' });
  const id = randomUUID();
  const slug = slugify(name);
  const { rows } = await pool!.query(
    'INSERT INTO blog_tags (id, user_id, name, slug) VALUES ($1,$2,$3,$4) RETURNING *',
    [id, user.userId, name.trim(), slug]
  );
  return res.json({ success: true, tag: rows[0] });
});

// DELETE /api/blog/tags/:id
app.delete('/api/blog/tags/:id', async (req: Request, res: Response) => {
  const user = await requireAuth(req, res);
  if (!user) return;
  const { id } = req.params;
  await pool!.query('DELETE FROM blog_tags WHERE id=$1 AND user_id=$2', [id, user.userId]);
  return res.json({ success: true });
});

// GET /api/blog/posts
app.get('/api/blog/posts', async (req: Request, res: Response) => {
  const user = await requireAuth(req, res);
  if (!user) return;
  const { status, search } = req.query as { status?: string; search?: string };
  let q = `SELECT p.*, c.name AS category_name,
    ARRAY(SELECT t.id FROM blog_tags t JOIN blog_post_tags pt ON pt.tag_id=t.id WHERE pt.post_id=p.id) AS tag_ids,
    ARRAY(SELECT t.name FROM blog_tags t JOIN blog_post_tags pt ON pt.tag_id=t.id WHERE pt.post_id=p.id) AS tag_names
    FROM blog_posts p LEFT JOIN blog_categories c ON c.id=p.category_id
    WHERE p.user_id=$1`;
  const params: (string | number)[] = [user.userId];
  if (status && status !== 'all') {
    params.push(status);
    q += ` AND p.status=$${params.length}`;
  } else {
    q += ` AND p.status NOT IN ('archived','deleted')`;
  }
  if (search) { params.push(`%${search}%`); q += ` AND p.title ILIKE $${params.length}`; }
  q += ' ORDER BY p.updated_at DESC';
  const { rows } = await pool!.query(q, params);
  return res.json({ success: true, posts: rows });
});

// GET /api/blog/posts/:id
app.get('/api/blog/posts/:id', async (req: Request, res: Response) => {
  const user = await requireAuth(req, res);
  if (!user) return;
  const { id } = req.params;
  const { rows } = await pool!.query(
    `SELECT p.*, c.name AS category_name,
      ARRAY(SELECT t.id FROM blog_tags t JOIN blog_post_tags pt ON pt.tag_id=t.id WHERE pt.post_id=p.id) AS tag_ids,
      ARRAY(SELECT t.name FROM blog_tags t JOIN blog_post_tags pt ON pt.tag_id=t.id WHERE pt.post_id=p.id) AS tag_names
     FROM blog_posts p LEFT JOIN blog_categories c ON c.id=p.category_id
     WHERE p.id=$1 AND p.user_id=$2`,
    [id, user.userId]
  );
  if (!rows.length) return res.status(404).json({ success: false, error: 'Not found' });
  return res.json({ success: true, post: rows[0] });
});

// POST /api/blog/posts
app.post('/api/blog/posts', async (req: Request, res: Response) => {
  const user = await requireAuth(req, res);
  if (!user) return;
  const { title = '', slug: rawSlug, content = '', excerpt = '', featured_image = '',
    status = 'draft', category_id, meta_title = '', meta_description = '', focus_keyword = '',
    social_title = '', social_description = '', social_image = '', social_automation = {}, scheduled_at, tag_ids = [] } = req.body as {
    title?: string; slug?: string; content?: string; excerpt?: string; featured_image?: string;
    status?: string; category_id?: string; meta_title?: string; meta_description?: string;
    focus_keyword?: string; social_title?: string; social_description?: string; social_image?: string;
    social_automation?: any;
    scheduled_at?: string; tag_ids?: string[];
  };
  const id = randomUUID();
  const slug = rawSlug?.trim() || slugify(title) || id;
  const published_at = status === 'published' ? new Date().toISOString() : null;
  const { rows } = await pool!.query(
    `INSERT INTO blog_posts (id,user_id,title,slug,content,excerpt,featured_image,status,category_id,
      meta_title,meta_description,focus_keyword,social_title,social_description,social_image,social_automation,scheduled_at,published_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18) RETURNING *`,
    [id, user.userId, title, slug, content, excerpt, featured_image, status,
     category_id || null, meta_title, meta_description, focus_keyword,
     social_title, social_description, social_image, JSON.stringify(social_automation || {}), scheduled_at || null, published_at]
  );
  if (tag_ids.length) {
    await Promise.all(tag_ids.map((tid: string) =>
      pool!.query('INSERT INTO blog_post_tags (post_id,tag_id) VALUES ($1,$2) ON CONFLICT DO NOTHING', [id, tid])
    ));
  }

  await syncBlogPostMedia(user.userId, rows[0]).catch((error) => {
    console.error('Blog post media sync error:', error);
  });

  void checkTaskActions(user.userId, 'create_post');

  if (status === 'published') {
    try {
      await queueSocialAutomationForPublishedPost(user.userId, rows[0]);
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Social Automation queue failed';
      console.error('Social Automation queue error:', err);
      await pool!.query(
        'INSERT INTO publishing_logs (id,post_id,user_id,platform,status,error_message) VALUES ($1,$2,$3,$4,$5,$6)',
        [randomUUID(), id, user.userId, 'facebook', 'failed', msg]
      ).catch(() => undefined);
    }
  }
  clearCalendarCacheForUser(user.userId);
  return res.json({ success: true, post: rows[0] });
});

// PUT /api/blog/posts/:id
app.put('/api/blog/posts/:id', async (req: Request, res: Response) => {
  const user = await requireAuth(req, res);
  if (!user) return;
  const { id } = req.params;
  const { title, slug: rawSlug, content, excerpt, featured_image, status,
    category_id, meta_title, meta_description, focus_keyword,
    social_title, social_description, social_image, social_automation, scheduled_at, tag_ids } = req.body as {
    title?: string; slug?: string; content?: string; excerpt?: string; featured_image?: string;
    status?: string; category_id?: string; meta_title?: string; meta_description?: string;
    focus_keyword?: string; social_title?: string; social_description?: string; social_image?: string;
    social_automation?: any;
    scheduled_at?: string; tag_ids?: string[];
  };
  const existing = await pool!.query('SELECT * FROM blog_posts WHERE id=$1 AND user_id=$2', [id, user.userId]);
  if (!existing.rows.length) return res.status(404).json({ success: false, error: 'Not found' });
  const cur = existing.rows[0];
  const newTitle = title ?? cur.title;
  const newSlug = rawSlug?.trim() || (title ? slugify(title) : cur.slug);
  const newStatus = status ?? cur.status;
  const willPublish = newStatus === 'published' && String(cur.status || '') !== 'published';
  const published_at = newStatus === 'published' && !cur.published_at ? new Date().toISOString() : cur.published_at;
  const { rows } = await pool!.query(
    `UPDATE blog_posts SET title=$1,slug=$2,content=$3,excerpt=$4,featured_image=$5,status=$6,
      category_id=$7,meta_title=$8,meta_description=$9,focus_keyword=$10,social_title=$11,
      social_description=$12,social_image=$13,social_automation=$14,scheduled_at=$15,published_at=$16,updated_at=NOW()
     WHERE id=$17 AND user_id=$18 RETURNING *`,
    [newTitle, newSlug, content ?? cur.content, excerpt ?? cur.excerpt, featured_image ?? cur.featured_image,
     newStatus, category_id !== undefined ? (category_id || null) : cur.category_id,
     meta_title ?? cur.meta_title, meta_description ?? cur.meta_description,
     focus_keyword ?? cur.focus_keyword, social_title ?? cur.social_title,
      social_description ?? cur.social_description, social_image ?? cur.social_image,
      social_automation !== undefined ? JSON.stringify(social_automation || {}) : JSON.stringify(cur.social_automation || {}),
      scheduled_at !== undefined ? (scheduled_at || null) : cur.scheduled_at,
      published_at, id, user.userId]
  );
  if (tag_ids !== undefined) {
    await pool!.query('DELETE FROM blog_post_tags WHERE post_id=$1', [id]);
    if (tag_ids.length) {
      await Promise.all(tag_ids.map((tid: string) =>
        pool!.query('INSERT INTO blog_post_tags (post_id,tag_id) VALUES ($1,$2) ON CONFLICT DO NOTHING', [id, tid])
      ));
    }
  }

  await syncBlogPostMedia(user.userId, rows[0]).catch((error) => {
    console.error('Blog post media sync error:', error);
  });

  if (willPublish) {
    try {
      await queueSocialAutomationForPublishedPost(user.userId, rows[0]);
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Social Automation queue failed';
      console.error('Social Automation queue error:', err);
      await pool!.query(
        'INSERT INTO publishing_logs (id,post_id,user_id,platform,status,error_message) VALUES ($1,$2,$3,$4,$5,$6)',
        [randomUUID(), id, user.userId, 'facebook', 'failed', msg]
      ).catch(() => undefined);
    }
  }
  clearCalendarCacheForUser(user.userId);
  return res.json({ success: true, post: rows[0] });
});

// DELETE /api/blog/posts/:id
app.delete('/api/blog/posts/:id', async (req: Request, res: Response) => {
  const user = await requireAuth(req, res);
  if (!user) return;
  const { id } = req.params;
  await pool!.query('DELETE FROM blog_posts WHERE id=$1 AND user_id=$2', [id, user.userId]);
  clearCalendarCacheForUser(user.userId);
  return res.json({ success: true });
});

// PATCH /api/blog/posts/batch/reschedule
app.patch('/api/blog/posts/batch/reschedule', async (req: Request, res: Response) => {
  const user = await requireAuth(req, res);
  if (!user) return;
  const { postIds = [], scheduled_at } = req.body as { postIds?: string[]; scheduled_at?: string };
  const ids = Array.isArray(postIds) ? postIds.map((id) => String(id)).filter(Boolean) : [];
  if (!ids.length || !scheduled_at) return res.status(400).json({ success: false, error: 'Invalid payload' });

  const scheduledAt = new Date(String(scheduled_at));
  if (Number.isNaN(scheduledAt.getTime())) {
    return res.status(400).json({ success: false, error: 'Invalid scheduled_at' });
  }

  const owned = await pool!.query('SELECT id FROM blog_posts WHERE id = ANY($1) AND user_id=$2', [ids, user.userId]);
  if (owned.rows.length !== ids.length) return res.status(403).json({ success: false, error: 'Not authorized' });

    const result = await pool!.query(
      `UPDATE blog_posts SET scheduled_at=$1, status='scheduled', updated_at=NOW() WHERE id = ANY($2) AND user_id=$3`,
      [scheduledAt.toISOString(), ids, user.userId]
    );

  clearCalendarCacheForUser(user.userId);
  await recordAuditLog(user.userId, 'batch_reschedule', ids, { scheduled_at: scheduledAt.toISOString() });
  return res.json({ success: true, updated: result.rowCount });
});

// PATCH /api/blog/posts/batch/tag
app.patch('/api/blog/posts/batch/tag', async (req: Request, res: Response) => {
  const user = await requireAuth(req, res);
  if (!user) return;
  const { postIds = [], tagIds = [] } = req.body as { postIds?: string[]; tagIds?: string[] };
  const ids = Array.isArray(postIds) ? postIds.map((id) => String(id)).filter(Boolean) : [];
  const tags = Array.isArray(tagIds) ? tagIds.map((id) => String(id)).filter(Boolean) : [];
  if (!ids.length || !tags.length) return res.status(400).json({ success: false, error: 'Invalid payload' });

  const owned = await pool!.query('SELECT id FROM blog_posts WHERE id = ANY($1) AND user_id=$2', [ids, user.userId]);
  if (owned.rows.length !== ids.length) return res.status(403).json({ success: false, error: 'Not authorized' });

  const tagRows = await pool!.query('SELECT id FROM blog_tags WHERE id = ANY($1) AND user_id=$2', [tags, user.userId]);
  if (tagRows.rows.length !== tags.length) {
    return res.status(403).json({ success: false, error: 'Some tags are not available for this user' });
  }

  await pool!.query(
    `INSERT INTO blog_post_tags (post_id, tag_id)
     SELECT p, t FROM UNNEST($1::text[]) AS p CROSS JOIN UNNEST($2::text[]) AS t
     ON CONFLICT DO NOTHING`,
    [ids, tags]
  );

  const result = await pool!.query('UPDATE blog_posts SET updated_at=NOW() WHERE id = ANY($1) AND user_id=$2', [ids, user.userId]);
  await recordAuditLog(user.userId, 'batch_tag', ids, { tag_ids: tags });
  return res.json({ success: true, updated: result.rowCount });
});

// PATCH /api/blog/posts/batch/archive
app.patch('/api/blog/posts/batch/archive', async (req: Request, res: Response) => {
  const user = await requireAuth(req, res);
  if (!user) return;
  const { postIds = [] } = req.body as { postIds?: string[] };
  const ids = Array.isArray(postIds) ? postIds.map((id) => String(id)).filter(Boolean) : [];
  if (!ids.length) return res.status(400).json({ success: false, error: 'Invalid postIds' });

  const owned = await pool!.query('SELECT id FROM blog_posts WHERE id = ANY($1) AND user_id=$2', [ids, user.userId]);
  if (owned.rows.length !== ids.length) return res.status(403).json({ success: false, error: 'Not authorized' });

  const result = await pool!.query(
    `UPDATE blog_posts SET status='archived', updated_at=NOW() WHERE id = ANY($1) AND user_id=$2`,
    [ids, user.userId]
  );
  clearCalendarCacheForUser(user.userId);
  await recordAuditLog(user.userId, 'batch_archive', ids, {});
  return res.json({ success: true, updated: result.rowCount });
});

// PATCH /api/blog/posts/batch/delete
app.patch('/api/blog/posts/batch/delete', async (req: Request, res: Response) => {
  const user = await requireAuth(req, res);
  if (!user) return;
  const { postIds = [] } = req.body as { postIds?: string[] };
  const ids = Array.isArray(postIds) ? postIds.map((id) => String(id)).filter(Boolean) : [];
  if (!ids.length) return res.status(400).json({ success: false, error: 'Invalid postIds' });

  const owned = await pool!.query('SELECT id FROM blog_posts WHERE id = ANY($1) AND user_id=$2', [ids, user.userId]);
  if (owned.rows.length !== ids.length) return res.status(403).json({ success: false, error: 'Not authorized' });

  const result = await pool!.query(
    `UPDATE blog_posts SET status='deleted', updated_at=NOW() WHERE id = ANY($1) AND user_id=$2`,
    [ids, user.userId]
  );
  clearCalendarCacheForUser(user.userId);
  await recordAuditLog(user.userId, 'batch_delete', ids, {});
  return res.json({ success: true, updated: result.rowCount });
});

// POST /api/blog/posts/batch/duplicate
app.post('/api/blog/posts/batch/duplicate', async (req: Request, res: Response) => {
  const user = await requireAuth(req, res);
  if (!user) return;
  const { postIds = [] } = req.body as { postIds?: string[] };
  const ids = Array.isArray(postIds) ? postIds.map((id) => String(id)).filter(Boolean) : [];
  if (!ids.length) return res.status(400).json({ success: false, error: 'Invalid postIds' });

  const { rows } = await pool!.query('SELECT * FROM blog_posts WHERE id = ANY($1) AND user_id=$2', [ids, user.userId]);
  if (!rows.length) return res.status(404).json({ success: false, error: 'No posts found' });

  let created = 0;
  for (const src of rows) {
    const newId = randomUUID();
    const { rows: newRows } = await pool!.query(
      `INSERT INTO blog_posts (id,user_id,title,slug,content,excerpt,featured_image,status,category_id,
        meta_title,meta_description,focus_keyword,social_title,social_description,social_image)
       VALUES ($1,$2,$3,$4,$5,$6,$7,'draft',$8,$9,$10,$11,$12,$13,$14) RETURNING *`,
      [
        newId,
        user.userId,
        `${src.title} (Copy)`,
        `${src.slug}-copy`,
        src.content,
        src.excerpt,
        src.featured_image,
        src.category_id,
        src.meta_title,
        src.meta_description,
        src.focus_keyword,
        src.social_title,
        src.social_description,
        src.social_image,
      ]
    );
    const tagRows = await pool!.query('SELECT tag_id FROM blog_post_tags WHERE post_id=$1', [src.id]);
    if (tagRows.rows.length) {
      await Promise.all(
        tagRows.rows.map((r: { tag_id: string }) =>
          pool!.query('INSERT INTO blog_post_tags (post_id,tag_id) VALUES ($1,$2)', [newId, r.tag_id])
        )
      );
    }
    if (newRows.length) created += 1;
  }

  clearCalendarCacheForUser(user.userId);
  await recordAuditLog(user.userId, 'batch_duplicate', ids, { created });
  return res.json({ success: true, created });
});

// PATCH /api/blog/posts/batch/platforms
app.patch('/api/blog/posts/batch/platforms', async (req: Request, res: Response) => {
  const user = await requireAuth(req, res);
  if (!user) return;
  const { postIds = [], accountIds = [] } = req.body as { postIds?: string[]; accountIds?: string[] };
  const ids = Array.isArray(postIds) ? postIds.map((id) => String(id)).filter(Boolean) : [];
  const accounts = Array.isArray(accountIds) ? accountIds.map((id) => String(id)).filter(Boolean) : [];
  if (!ids.length) return res.status(400).json({ success: false, error: 'Invalid postIds' });

  const owned = await pool!.query('SELECT id FROM blog_posts WHERE id = ANY($1) AND user_id=$2', [ids, user.userId]);
  if (owned.rows.length !== ids.length) return res.status(403).json({ success: false, error: 'Not authorized' });

  const visiblePlatforms = await getVisibleUserPlatformSlugs();

  if (accounts.length > 0) {
    const accountRows = await pool!.query(
      `SELECT id, platform FROM social_accounts WHERE id = ANY($1) AND user_id = $2`,
      [accounts, user.userId]
    );
    const validAccounts =
      visiblePlatforms.length > 0
        ? accountRows.rows.filter((acc: any) => visiblePlatforms.includes(String(acc.platform || '').toLowerCase()))
        : accountRows.rows;
    if (validAccounts.length !== accounts.length) {
      return res.status(400).json({ success: false, error: 'Some selected accounts are from integrations that are not available in this workspace' });
    }
  }

  const client = await pool!.connect();
  try {
    await client.query('BEGIN');
    const settingsRows = await client.query(
      'SELECT id, post_id FROM social_post_settings WHERE post_id = ANY($1)',
      [ids]
    );
    const map = new Map<string, string>();
    settingsRows.rows.forEach((row: any) => map.set(String(row.post_id), String(row.id)));

    for (const postId of ids) {
      let settingId = map.get(postId);
      if (!settingId) {
        settingId = randomUUID();
        await client.query(
          `INSERT INTO social_post_settings (id, post_id, template, publish_type, scheduled_at)
           VALUES ($1,$2,'','immediate',NULL)`,
          [settingId, postId]
        );
      }

      await client.query('DELETE FROM social_post_targets WHERE social_post_id=$1', [settingId]);
      for (const accountId of accounts) {
        await client.query(
          `INSERT INTO social_post_targets (id, social_post_id, social_account_id, enabled)
           VALUES ($1,$2,$3,true)`,
          [randomUUID(), settingId, accountId]
        );
      }
    }

    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK').catch(() => undefined);
    console.error('batch platform update error:', err);
    return res.status(500).json({ success: false, error: 'Failed to update platforms' });
  } finally {
    client.release();
  }

  const publishedRows = await pool!.query(
    `SELECT id
     FROM blog_posts
     WHERE id = ANY($1) AND user_id=$2 AND status='published'`,
    [ids, user.userId]
  );

  for (const row of publishedRows.rows as Array<{ id: string }>) {
    await syncSocialAutomationForPost(user.userId, String(row.id));
  }

  await recordAuditLog(user.userId, 'batch_platforms', ids, { accountIds: accounts });
  return res.json({ success: true, updated: ids.length });
});

// GET /api/blog/posts/batch/export
app.get('/api/blog/posts/batch/export', async (req: Request, res: Response) => {
  const user = await requireAuth(req, res);
  if (!user) return;
  const postIds = req.query.postIds;
  const ids = Array.isArray(postIds)
    ? postIds.map((id) => String(id)).filter(Boolean)
    : typeof postIds === 'string'
      ? [String(postIds)]
      : [];
  if (!ids.length) return res.status(400).json({ success: false, error: 'Invalid postIds' });

  const { rows } = await pool!.query(
    `SELECT p.*, ARRAY(SELECT t.name FROM blog_tags t JOIN blog_post_tags pt ON pt.tag_id=t.id WHERE pt.post_id=p.id) AS tag_names
     FROM blog_posts p WHERE p.id = ANY($1) AND p.user_id=$2`,
    [ids, user.userId]
  );
  if (!rows.length) return res.status(404).json({ success: false, error: 'Posts not found' });

  const header = ['Title', 'Status', 'Scheduled At', 'Published At', 'Updated At', 'Tags'];
  const csv = [
    header.join(','),
    ...rows.map((row: any) => {
      const tags = Array.isArray(row.tag_names) ? row.tag_names.join(';') : '';
      return [
        `"${String(row.title || '').replace(/"/g, '""')}"`,
        row.status || '',
        row.scheduled_at ? new Date(row.scheduled_at).toISOString() : '',
        row.published_at ? new Date(row.published_at).toISOString() : '',
        row.updated_at ? new Date(row.updated_at).toISOString() : '',
        `"${String(tags).replace(/"/g, '""')}"`,
      ].join(',');
    }),
  ].join('\n');

  res.setHeader('Content-Type', 'text/csv');
  res.setHeader('Content-Disposition', 'attachment; filename=posts.csv');
  return res.send(csv);
});

// POST /api/blog/posts/batch/restore
app.post('/api/blog/posts/batch/restore', async (req: Request, res: Response) => {
  const user = await requireAuth(req, res);
  if (!user) return;
  const { previousState = [] } = req.body as { previousState?: any[] };
  if (!Array.isArray(previousState) || previousState.length === 0) {
    return res.status(400).json({ success: false, error: 'Invalid previousState' });
  }
  const ids = previousState.map((p) => String(p.id)).filter(Boolean);
  const owned = await pool!.query('SELECT id FROM blog_posts WHERE id = ANY($1) AND user_id=$2', [ids, user.userId]);
  if (owned.rows.length !== ids.length) return res.status(403).json({ success: false, error: 'Not authorized' });

  for (const state of previousState) {
    const postId = String(state.id);
    await pool!.query(
      `UPDATE blog_posts SET title=$1, slug=$2, content=$3, excerpt=$4, featured_image=$5, status=$6, category_id=$7,
        meta_title=$8, meta_description=$9, focus_keyword=$10, social_title=$11, social_description=$12, social_image=$13,
        social_automation=$14, scheduled_at=$15, published_at=$16, updated_at=NOW()
       WHERE id=$17 AND user_id=$18`,
      [
        state.title || '',
        state.slug || '',
        state.content || '',
        state.excerpt || '',
        state.featured_image || '',
        state.status || 'draft',
        state.category_id || null,
        state.meta_title || '',
        state.meta_description || '',
        state.focus_keyword || '',
        state.social_title || '',
        state.social_description || '',
        state.social_image || '',
        JSON.stringify(state.social_automation || {}),
        state.scheduled_at || null,
        state.published_at || null,
        postId,
        user.userId,
      ]
    );

    const tagIds = Array.isArray(state.tag_ids) ? state.tag_ids.map((id: string) => String(id)) : [];
    await pool!.query('DELETE FROM blog_post_tags WHERE post_id=$1', [postId]);
    if (tagIds.length) {
      await pool!.query(
        `INSERT INTO blog_post_tags (post_id, tag_id)
         SELECT $1, t FROM UNNEST($2::text[]) AS t`,
        [postId, tagIds]
      );
    }
  }

  clearCalendarCacheForUser(user.userId);
  await recordAuditLog(user.userId, 'batch_restore', ids, {});
  return res.json({ success: true, restored: ids.length });
});

// POST /api/blog/posts/:id/duplicate
app.post('/api/blog/posts/:id/duplicate', async (req: Request, res: Response) => {
  const user = await requireAuth(req, res);
  if (!user) return;
  const { id } = req.params;
  const { rows } = await pool!.query('SELECT * FROM blog_posts WHERE id=$1 AND user_id=$2', [id, user.userId]);
  if (!rows.length) return res.status(404).json({ success: false, error: 'Not found' });
  const src = rows[0];
  const newId = randomUUID();
  const { rows: newRows } = await pool!.query(
    `INSERT INTO blog_posts (id,user_id,title,slug,content,excerpt,featured_image,status,category_id,
      meta_title,meta_description,focus_keyword,social_title,social_description,social_image)
     VALUES ($1,$2,$3,$4,$5,$6,$7,'draft',$8,$9,$10,$11,$12,$13,$14) RETURNING *`,
    [
      newId,
      user.userId,
      `${src.title} (Copy)`,
      `${src.slug}-copy`,
      src.content,
      src.excerpt,
      src.featured_image,
      src.category_id,
      src.meta_title,
      src.meta_description,
      src.focus_keyword,
      src.social_title,
      src.social_description,
      src.social_image,
    ]
  );
  const tagRows = await pool!.query('SELECT tag_id FROM blog_post_tags WHERE post_id=$1', [id]);
  if (tagRows.rows.length) {
    await Promise.all(
      tagRows.rows.map((r: { tag_id: string }) =>
        pool!.query('INSERT INTO blog_post_tags (post_id,tag_id) VALUES ($1,$2)', [newId, r.tag_id])
      )
    );
  }
  clearCalendarCacheForUser(user.userId);
  return res.json({ success: true, post: newRows[0] });
});

// ── Schedule Calendar (v1) ──────────────────────────────────────────────────

app.get('/api/v1/calendar', async (req: Request, res: Response) => {
  const user = await requireAuth(req, res);
  if (!user) return;
  const year = Number.parseInt(String(req.query.year || ''), 10);
  const month = Number.parseInt(String(req.query.month || ''), 10);
  if (!Number.isFinite(year) || !Number.isFinite(month) || month < 1 || month > 12) {
    return res.status(400).json({ success: false, error: 'Invalid year or month' });
  }

  if (!hasDatabase()) {
    return res.json({ success: true, year, month, posts_by_date: {}, total_posts: 0 });
  }

  const cacheKey = `calendar:${user.userId}:${year}:${month}`;
  const cached = getCalendarCache(cacheKey);
  if (cached) return res.json({ success: true, ...cached });

  try {
    const start = new Date(Date.UTC(year, month - 1, 1));
    const end = new Date(Date.UTC(year, month, 0, 23, 59, 59, 999));
    const { rows } = await pool!.query(
      `SELECT id, title, status, scheduled_at, published_at, created_at, updated_at,
              COALESCE(scheduled_at, CASE WHEN status = 'published' THEN published_at END, created_at) AS calendar_at
       FROM blog_posts
       WHERE user_id=$1
         AND status IN ('draft','scheduled','published')
         AND COALESCE(scheduled_at, CASE WHEN status = 'published' THEN published_at END, created_at) BETWEEN $2 AND $3
       ORDER BY calendar_at ASC, updated_at DESC`,
      [user.userId, start.toISOString(), end.toISOString()]
    );

    const postsByDate: Record<string, any[]> = {};
    rows.forEach((post) => {
      const calendarAt = post.calendar_at ? new Date(post.calendar_at) : null;
      if (!calendarAt || Number.isNaN(calendarAt.getTime())) return;
      const dateKey = calendarAt.toISOString().slice(0, 10);
      if (!postsByDate[dateKey]) postsByDate[dateKey] = [];
      postsByDate[dateKey].push(post);
    });

    const payload = { year, month, posts_by_date: postsByDate, total_posts: rows.length };
    setCalendarCache(cacheKey, payload);
    return res.json({ success: true, ...payload });
  } catch (err) {
    console.error('calendar fetch error:', err);
    return res.status(500).json({ success: false, error: 'Failed to load calendar' });
  }
});

app.get('/api/v1/posts', async (req: Request, res: Response) => {
  const user = await requireAuth(req, res);
  if (!user) return;
  const rawStatus = String(req.query.status || 'draft').toLowerCase();
  const allowed = new Set(['draft', 'scheduled', 'published']);
  if (!allowed.has(rawStatus)) {
    return res.status(400).json({ success: false, error: 'Invalid status' });
  }
  if (!hasDatabase()) return res.json({ success: true, posts: [] });
  try {
    let q = `SELECT id, title, status, scheduled_at, created_at, updated_at FROM blog_posts WHERE user_id=$1 AND status=$2`;
    const params: (string | number)[] = [user.userId, rawStatus];
    if (rawStatus === 'draft') q += ' AND scheduled_at IS NULL';
    q += ' ORDER BY created_at DESC';
    const { rows } = await pool!.query(q, params);
    return res.json({ success: true, posts: rows });
  } catch (err) {
    console.error('posts list error:', err);
    return res.status(500).json({ success: false, error: 'Failed to load posts' });
  }
});

app.post('/api/v1/posts', async (req: Request, res: Response) => {
  const user = await requireAuth(req, res);
  if (!user) return;
  if (!hasDatabase()) return res.status(503).json({ success: false, error: 'Database not configured' });
  const { title, content = '', scheduled_at, status } = req.body as {
    title?: string;
    content?: string;
    scheduled_at?: string | null;
    status?: string;
  };
  if (!title || !title.trim()) {
    return res.status(400).json({ success: false, error: 'Title is required' });
  }

  let scheduledAt: string | null = null;
  if (scheduled_at) {
    const dt = new Date(scheduled_at);
    if (Number.isNaN(dt.getTime())) {
      return res.status(400).json({ success: false, error: 'Invalid scheduled_at value' });
    }
    if (dt.getTime() < Date.now()) {
      return res.status(400).json({ success: false, error: 'Cannot schedule to a past date' });
    }
    scheduledAt = dt.toISOString();
  }

  const normalizedStatus = ['draft', 'scheduled', 'published'].includes(String(status || ''))
    ? String(status).toLowerCase()
    : scheduledAt
      ? 'scheduled'
      : 'draft';
  const publishedAt = normalizedStatus === 'published' ? new Date().toISOString() : null;
  const id = randomUUID();
  const slug = slugify(title) || id;

  try {
    const { rows } = await pool!.query(
      `INSERT INTO blog_posts (id, user_id, title, slug, content, status, scheduled_at, published_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *`,
      [id, user.userId, title.trim(), slug, content || '', normalizedStatus, scheduledAt, publishedAt]
    );
    clearCalendarCacheForUser(user.userId);
    return res.status(201).json({ success: true, post: rows[0] });
  } catch (err) {
    console.error('post create error:', err);
    return res.status(500).json({ success: false, error: 'Failed to create post' });
  }
});

app.put('/api/v1/posts/:id', async (req: Request, res: Response) => {
  const user = await requireAuth(req, res);
  if (!user) return;
  if (!hasDatabase()) return res.status(503).json({ success: false, error: 'Database not configured' });
  const { id } = req.params;
  const { title, content, scheduled_at, status } = req.body as {
    title?: string;
    content?: string;
    scheduled_at?: string | null;
    status?: string;
  };
  try {
    const existing = await pool!.query('SELECT * FROM blog_posts WHERE id=$1 AND user_id=$2', [id, user.userId]);
    if (!existing.rows.length) return res.status(404).json({ success: false, error: 'Post not found' });
    const current = existing.rows[0];

    let scheduledAtValue: string | null | undefined = undefined;
    if (scheduled_at !== undefined) {
      if (scheduled_at === null || scheduled_at === '') {
        scheduledAtValue = null;
      } else {
        const dt = new Date(scheduled_at);
        if (Number.isNaN(dt.getTime())) {
          return res.status(400).json({ success: false, error: 'Invalid scheduled_at value' });
        }
        if (dt.getTime() < Date.now()) {
          return res.status(400).json({ success: false, error: 'Cannot schedule to a past date' });
        }
        scheduledAtValue = dt.toISOString();
      }
    }

    let nextStatus = status ? String(status).toLowerCase() : String(current.status || '').toLowerCase();
    if (scheduledAtValue !== undefined && !status) {
      nextStatus = scheduledAtValue ? 'scheduled' : 'draft';
    }
    if (!['draft', 'scheduled', 'published'].includes(nextStatus)) {
      return res.status(400).json({ success: false, error: 'Invalid status' });
    }

    const updates: string[] = [];
    const params: (string | number | null)[] = [];
    if (title !== undefined) {
      updates.push(`title = $${params.length + 1}`);
      params.push(title.trim());
    }
    if (content !== undefined) {
      updates.push(`content = $${params.length + 1}`);
      params.push(content ?? '');
    }
    if (scheduledAtValue !== undefined) {
      updates.push(`scheduled_at = $${params.length + 1}`);
      params.push(scheduledAtValue);
    }
    updates.push(`status = $${params.length + 1}`);
    params.push(nextStatus);

    let publishedAtValue: string | null = current.published_at;
    if (nextStatus === 'published' && !current.published_at) {
      publishedAtValue = new Date().toISOString();
    }
    updates.push(`published_at = $${params.length + 1}`);
    params.push(publishedAtValue);

    updates.push('updated_at = NOW()');
    params.push(id, user.userId);

    const { rows } = await pool!.query(
      `UPDATE blog_posts SET ${updates.join(', ')} WHERE id=$${params.length - 1} AND user_id=$${params.length} RETURNING *`,
      params
    );
    clearCalendarCacheForUser(user.userId);
    return res.json({ success: true, post: rows[0] });
  } catch (err) {
    console.error('post update error:', err);
    return res.status(500).json({ success: false, error: 'Failed to update post' });
  }
});

app.delete('/api/v1/posts/:id', async (req: Request, res: Response) => {
  const user = await requireAuth(req, res);
  if (!user) return;
  if (!hasDatabase()) return res.status(503).json({ success: false, error: 'Database not configured' });
  const { id } = req.params;
  try {
    const existing = await pool!.query('SELECT id FROM blog_posts WHERE id=$1 AND user_id=$2', [id, user.userId]);
    if (!existing.rows.length) return res.status(404).json({ success: false, error: 'Post not found' });
    await pool!.query('DELETE FROM blog_posts WHERE id=$1 AND user_id=$2', [id, user.userId]);
    clearCalendarCacheForUser(user.userId);
    return res.json({ success: true });
  } catch (err) {
    console.error('post delete error:', err);
    return res.status(500).json({ success: false, error: 'Failed to delete post' });
  }
});

// ── Distribution / Automation ────────────────────────────────────────────────

function normalizePlatformId(value: string): string {
  const raw = String(value || '').trim().toLowerCase();
  if (!raw) return '';
  if (raw === 'twitter / x' || raw === 'twitter/x' || raw === 'x') return 'twitter';
  if (raw === 'twitter') return 'twitter';
  if (raw === 'linkedin') return 'linkedin';
  if (raw === 'facebook') return 'facebook';
  if (raw === 'instagram') return 'instagram';
  if (raw === 'pinterest') return 'pinterest';
  if (raw === 'tiktok') return 'tiktok';
  if (raw === 'threads') return 'threads';
  if (raw === 'wordpress') return 'wordpress';
  return raw;
}

function toHashtags(tags: unknown): string {
  const list = Array.isArray(tags) ? tags : [];
  const tagsText = list
    .map((t) => String(t || '').trim())
    .filter(Boolean)
    .map((t) => `#${t.replace(/\\s+/g, '').replace(/^#/, '')}`);
  return tagsText.join(' ');
}

function buildPostUrl(post: Record<string, any>): string {
  const base = (process.env.VITE_APP_URL || process.env.FRONTEND_URL || 'https://marketing.dakyworld.com').replace(/\/$/, '');
  const slug = String(post.slug || '').trim();
  if (!slug) return base;
  return `${base}/blog/${encodeURIComponent(slug)}`;
}

type SocialTemplateContentSource = 'EXCERPT' | 'CONTENT';
type SocialTemplateFacebookContentType = 'STATUS' | 'LINK' | 'STATUS_PLUS_LINK';

type SocialTemplateSettings = {
  platform: string;
  content_source: SocialTemplateContentSource;
  template_string: string;
  status_limit: number;
  max_status_limit: number;
  share_limit_per_post: number;
  add_categories_as_tags: boolean;
  remove_css: boolean;
  show_thumbnail: boolean;
  add_image_link: boolean;
  content_type: SocialTemplateFacebookContentType | null;
  enabled: boolean;
};

const SOCIAL_TEMPLATE_DEFAULTS: Record<string, SocialTemplateSettings> = {
  facebook: {
    platform: 'facebook',
    content_source: 'EXCERPT',
    template_string: '{title}\n\n{content}\n\n{url}\n\n{tags}',
    status_limit: 5000,
    max_status_limit: 63206,
    share_limit_per_post: 0,
    add_categories_as_tags: false,
    remove_css: false,
    show_thumbnail: false,
    add_image_link: false,
    content_type: 'STATUS_PLUS_LINK',
    enabled: true,
  },
  twitter: {
    platform: 'twitter',
    content_source: 'EXCERPT',
    template_string: '{title} {url} {tags}',
    status_limit: 280,
    max_status_limit: 280,
    share_limit_per_post: 0,
    add_categories_as_tags: false,
    remove_css: false,
    show_thumbnail: true,
    add_image_link: false,
    content_type: null,
    enabled: true,
  },
  instagram: {
    platform: 'instagram',
    content_source: 'EXCERPT',
    template_string: '{title}\n\n{content}\n\n{tags}',
    status_limit: 2200,
    max_status_limit: 2200,
    share_limit_per_post: 0,
    add_categories_as_tags: false,
    remove_css: true,
    show_thumbnail: false,
    add_image_link: false,
    content_type: null,
    enabled: true,
  },
  linkedin: {
    platform: 'linkedin',
    content_source: 'EXCERPT',
    template_string: '{title}\n\n{content}\n\n{url}\n\n{tags}',
    status_limit: 3000,
    max_status_limit: 3000,
    share_limit_per_post: 0,
    add_categories_as_tags: false,
    remove_css: false,
    show_thumbnail: false,
    add_image_link: false,
    content_type: null,
    enabled: true,
  },
  pinterest: {
    platform: 'pinterest',
    content_source: 'EXCERPT',
    template_string: '{title}: {url} {tags}',
    status_limit: 500,
    max_status_limit: 500,
    share_limit_per_post: 0,
    add_categories_as_tags: false,
    remove_css: true,
    show_thumbnail: false,
    add_image_link: true,
    content_type: null,
    enabled: true,
  },
  threads: {
    platform: 'threads',
    content_source: 'EXCERPT',
    template_string: '{title} {url} {tags}',
    status_limit: 500,
    max_status_limit: 500,
    share_limit_per_post: 0,
    add_categories_as_tags: false,
    remove_css: true,
    show_thumbnail: false,
    add_image_link: false,
    content_type: null,
    enabled: true,
  },
  tiktok: {
    platform: 'tiktok',
    content_source: 'EXCERPT',
    template_string: '{title}\n\n{content}\n\n{tags}',
    status_limit: 2200,
    max_status_limit: 2200,
    share_limit_per_post: 0,
    add_categories_as_tags: false,
    remove_css: true,
    show_thumbnail: false,
    add_image_link: false,
    content_type: null,
    enabled: true,
  },
  wordpress: {
    platform: 'wordpress',
    content_source: 'EXCERPT',
    template_string: '{title}\n\n{content}\n\n{url}',
    status_limit: 5000,
    max_status_limit: 10000,
    share_limit_per_post: 0,
    add_categories_as_tags: false,
    remove_css: true,
    show_thumbnail: false,
    add_image_link: false,
    content_type: null,
    enabled: true,
  },
};

function getSocialTemplateDefaults(platformId: string): SocialTemplateSettings | null {
  const normalized = normalizePlatformId(platformId);
  const defaults = SOCIAL_TEMPLATE_DEFAULTS[normalized];
  if (!defaults) return null;
  return { ...defaults };
}

function clampInt(value: unknown, fallback: number, min: number, max: number) {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, Math.round(n)));
}

function parseFacebookContentType(
  value: unknown
): SocialTemplateFacebookContentType | null {
  const candidate = String(value || '')
    .trim()
    .toUpperCase()
    .replace(/\s+/g, '_');
  if (
    candidate === 'STATUS' ||
    candidate === 'LINK' ||
    candidate === 'STATUS_PLUS_LINK'
  ) {
    return candidate as SocialTemplateFacebookContentType;
  }
  return null;
}

function mergeSocialTemplateSettings(platformId: string, input: any): SocialTemplateSettings {
  const defaults = getSocialTemplateDefaults(platformId);
  if (!defaults) {
    throw new Error(`Unsupported platform: ${platformId}`);
  }

  const content_source: SocialTemplateContentSource =
    input?.content_source === 'CONTENT' ? 'CONTENT' : 'EXCERPT';
  const template_string =
    typeof input?.template_string === 'string'
      ? String(input.template_string)
      : defaults.template_string;

  const status_limit = clampInt(
    input?.status_limit,
    defaults.status_limit,
    1,
    defaults.max_status_limit
  );

  const share_limit_per_post = clampInt(
    input?.share_limit_per_post,
    defaults.share_limit_per_post,
    0,
    1_000_000
  );

  const add_categories_as_tags =
    typeof input?.add_categories_as_tags === 'boolean'
      ? input.add_categories_as_tags
      : defaults.add_categories_as_tags;

  const remove_css =
    typeof input?.remove_css === 'boolean' ? input.remove_css : defaults.remove_css;

  const show_thumbnail =
    typeof input?.show_thumbnail === 'boolean'
      ? input.show_thumbnail
      : defaults.show_thumbnail;

  const add_image_link =
    typeof input?.add_image_link === 'boolean'
      ? input.add_image_link
      : defaults.add_image_link;

  const enabled =
    typeof input?.enabled === 'boolean' ? input.enabled : defaults.enabled;

  const content_type =
    platformId === 'facebook'
      ? parseFacebookContentType(input?.content_type) ?? defaults.content_type
      : null;

  return {
    platform: defaults.platform,
    content_source,
    template_string,
    status_limit,
    max_status_limit: defaults.max_status_limit,
    share_limit_per_post,
    add_categories_as_tags,
    remove_css,
    show_thumbnail,
    add_image_link,
    content_type,
    enabled,
  };
}

async function loadSocialTemplateSettings(userId: string, platformId: string): Promise<SocialTemplateSettings | null> {
  if (!pool) return null;
  const defaults = getSocialTemplateDefaults(platformId);
  if (!defaults) return null;

  const { rows } = await pool.query(
    `SELECT content_source, template_string, status_limit, max_status_limit, share_limit_per_post,
            add_categories_as_tags, remove_css, show_thumbnail, add_image_link, content_type, enabled
     FROM social_template_settings
     WHERE user_id=$1 AND platform=$2
     LIMIT 1`,
    [userId, defaults.platform]
  );

  if (!rows.length) return defaults;
  return mergeSocialTemplateSettings(platformId, rows[0]);
}

function stripHtmlContent(html: string) {
  if (!html) return '';
  const stripped = String(html)
    // Remove script/style blocks entirely
    .replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, '')
    .replace(/<style\b[^<]*(?:(?!<\/style>)<[^<]*)*<\/style>/gi, '')
    // Replace tags with spaces so words don't glue together
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  return decodeHtmlEntities(stripped);
}

function safeTruncateToLimit(text: string, limit: number): { text: string; truncated: boolean; originalLength: number } {
  const original = String(text || '');
  const originalLength = original.length;
  const max = Math.max(0, Math.floor(limit));

  if (originalLength <= max) return { text: original, truncated: false, originalLength };
  if (max === 0) return { text: '', truncated: true, originalLength };
  if (max <= 3) {
    let slice = original.slice(0, max);
    const last = slice.charCodeAt(slice.length - 1);
    if (last >= 0xd800 && last <= 0xdbff) slice = slice.slice(0, -1);
    return { text: slice, truncated: true, originalLength };
  }

  let slice = original.slice(0, max - 3);
  const last = slice.charCodeAt(slice.length - 1);
  if (last >= 0xd800 && last <= 0xdbff) slice = slice.slice(0, -1);
  return { text: `${slice}...`, truncated: true, originalLength };
}

async function resolveBlogPostFeaturedImageUrl(userId: string, post: Record<string, any>): Promise<string> {
  const postId = String(post?.id || '').trim();
  const rawSocialImage = String(post?.social_image || '').trim();
  const rawFeaturedImage = String(post?.featured_image || '').trim();
  const chosen = rawSocialImage || rawFeaturedImage;
  if (!chosen) return '';

  if (chosen.startsWith('data:image/')) {
    if (!hasDatabase() || !postId) return chosen;
    const sourceField = rawSocialImage ? 'social_image' : 'featured_image';
    const fileName = sourceField === 'social_image' ? `post-social-${postId}.jpg` : `post-featured-${postId}.jpg`;
    const tags = sourceField === 'social_image' ? ['post', 'social'] : ['post', 'featured'];
    try {
      const ensured = await ensureMediaRecordForSource({
        userId,
        sourceTable: 'blog_posts',
        sourceId: postId,
        sourceField,
        url: chosen,
        fileName,
        tags,
        category: 'user',
      });
      if (!ensured?.row) return chosen;
      return buildMediaServeUrl(ensured.row.id, ensured.row.file_name);
    } catch (err) {
      console.error('Failed to resolve blog post featured image URL:', err);
      return chosen;
    }
  }

  if (/^https?:\/\//i.test(chosen)) return chosen;
  const base = getMediaServerBase();
  return `${base}${chosen.startsWith('/') ? '' : '/'}${chosen}`;
}

async function renderSocialTemplatePreview(userId: string, post: Record<string, any>, settings: SocialTemplateSettings) {
  const title = String(post?.title || '').trim();
  const url = buildPostUrl(post || {});
  const featuredImage = await resolveBlogPostFeaturedImageUrl(userId, post);

  let contentText = '';
  if (settings.content_source === 'CONTENT') {
    contentText = String(post?.content || '');
  } else {
    contentText = String(post?.excerpt || '');
    if (!contentText && post?.content) {
      contentText = String(post.content).slice(0, 160);
    }
  }

  const cleanContent = settings.remove_css ? stripHtmlContent(contentText) : contentText;

  const tagsList: string[] = [];
  if (settings.add_categories_as_tags) {
    const category = String(post?.category_name || '').trim();
    if (category) tagsList.push(category);
    if (Array.isArray(post?.tag_names)) tagsList.push(...post.tag_names.map((t: any) => String(t || '').trim()).filter(Boolean));
  }
  const tags = settings.add_categories_as_tags ? toHashtags(tagsList) : '';

  const raw = String(settings.template_string || '')
    .replace(/{title}/g, title)
    .replace(/{content}/g, cleanContent)
    .replace(/{url}/g, url)
    .replace(/{featured_image}/g, featuredImage)
    .replace(/{tags}/g, tags)
    .trim();

  const truncated = safeTruncateToLimit(raw, settings.status_limit);
  const warning = truncated.truncated ? `Exceeded ${settings.status_limit} characters; preview truncated.` : null;

  return {
    rendered: truncated.text,
    characterCount: truncated.text.length,
    originalCharacterCount: truncated.originalLength,
    limit: settings.status_limit,
    featuredImage,
    warning,
    truncated: truncated.truncated,
  };
}

const PLATFORM_RATE_LIMITS: Record<string, { max: number; perMs: number }> = {
  facebook: { max: 5, perMs: 1000 },
  instagram: { max: 2, perMs: 1000 },
  linkedin: { max: 1, perMs: 1000 },
  twitter: { max: 2, perMs: 1000 },
};

const platformRateHistory = new Map<string, number[]>();

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

async function acquirePlatformSlot(platformId: string) {
  const rule = PLATFORM_RATE_LIMITS[platformId];
  if (!rule) return;
  const now = Date.now();
  const history = platformRateHistory.get(platformId) || [];
  const cutoff = now - rule.perMs;
  const fresh = history.filter((t) => t > cutoff);
  if (fresh.length >= rule.max) {
    const wait = rule.perMs - (now - fresh[0]);
    await sleep(wait);
    return acquirePlatformSlot(platformId);
  }
  fresh.push(now);
  platformRateHistory.set(platformId, fresh);
}
function getMonthlyWindowUtc(date = new Date()) {
  const start = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), 1));
  const end = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 1));
  return { start, end };
}

async function incrementPlatformMonthlyCounter(platformId: string, limit: number) {
  if (!pool || !Number.isFinite(limit) || limit <= 0) {
    return { allowed: true, remaining: null, counter: null };
  }
  const { start, end } = getMonthlyWindowUtc();
  const startDate = start.toISOString().slice(0, 10);
  const endDate = end.toISOString().slice(0, 10);

  try {
    await pool.query('BEGIN');
    const existing = await pool.query(
      `SELECT counter FROM platform_rate_counters
       WHERE platform=$1 AND period_start=$2 AND period_end=$3
       FOR UPDATE`,
      [platformId, startDate, endDate]
    );
    let counter = existing.rows[0]?.counter ?? 0;
    if (!existing.rows.length) {
      await pool.query(
        `INSERT INTO platform_rate_counters (platform, period_start, period_end, counter)
         VALUES ($1,$2,$3,0)`,
        [platformId, startDate, endDate]
      );
      counter = 0;
    }
    if (counter >= limit) {
      await pool.query('ROLLBACK');
      return { allowed: false, remaining: 0, counter };
    }
    const nextCounter = counter + 1;
    await pool.query(
      `UPDATE platform_rate_counters
       SET counter=$4, updated_at=NOW()
       WHERE platform=$1 AND period_start=$2 AND period_end=$3`,
      [platformId, startDate, endDate, nextCounter]
    );
    await pool.query('COMMIT');
    return { allowed: true, remaining: Math.max(0, limit - nextCounter), counter: nextCounter };
  } catch (err) {
    try {
      await pool.query('ROLLBACK');
    } catch {
      // ignore rollback failures
    }
    return { allowed: true, remaining: null, counter: null };
  }
}

async function markSocialAccountNeedsReapproval(params: {
  platformId: string;
  accountId?: string | null;
  userId?: string | null;
  reason?: string;
  disconnect?: boolean;
}) {
  if (!pool) return;
  const { platformId, accountId, userId, reason, disconnect } = params;
  const meta = {
    needs_reapproval_at: new Date().toISOString(),
    reason: reason || 'needs_reapproval',
  };

  const values: any[] = [];
  const pushValue = (value: any) => {
    values.push(value);
    return `$${values.length}`;
  };

  const platformRef = pushValue(platformId);
  const metaRef = pushValue(JSON.stringify(meta));
  const updates: string[] = [
    "needs_reapproval = true",
    `token_data = COALESCE(token_data, '{}'::jsonb) || ${metaRef}::jsonb`,
  ];
  if (disconnect) updates.push('connected = false');

  const whereClauses: string[] = [`LOWER(platform)=LOWER(${platformRef})`];
  if (accountId) whereClauses.push(`account_id = ${pushValue(accountId)}`);
  if (userId) whereClauses.push(`user_id = ${pushValue(userId)}`);

  const { rows } = await pool.query(
    `UPDATE social_accounts
     SET ${updates.join(', ')}
     WHERE ${whereClauses.join(' AND ')}
     RETURNING user_id`,
    values
  );

  for (const row of rows) {
    const uid = String(row.user_id || '').trim();
    if (!uid) continue;
    await pool
      .query(
        `UPDATE user_integrations ui
         SET status='needs_reapproval'
         FROM integrations i
         WHERE ui.user_id=$1 AND ui.integration_id=i.id AND i.slug=$2`,
        [uid, platformId]
      )
      .catch(() => undefined);

    await logIntegrationEvent({
      userId: uid,
      integrationSlug: platformId,
      eventType: disconnect ? 'deauthorized' : 'token_attention',
      status: 'warning',
      response: { reason: meta.reason },
    });
  }
}

async function resolveLinkedInAuthorUrn(params: { userId: string; accessToken: string }) {
  if (!pool) return null;
  // Primary: /v2/me (r_liteprofile — standard "Share on LinkedIn" scope)
  const meResp = await axios.get('https://api.linkedin.com/v2/me', {
    headers: { Authorization: `Bearer ${params.accessToken}` },
    validateStatus: () => true,
    timeout: 15000,
  });
  let meId = '';
  if (meResp.status < 400) {
    meId = String((meResp.data as any)?.id || '').trim();
  }
  if (!meId) {
    // Fallback: /v2/userinfo (OpenID Connect, for apps with openid/profile scopes)
    const userinfoResp = await axios.get('https://api.linkedin.com/v2/userinfo', {
      headers: { Authorization: `Bearer ${params.accessToken}` },
      validateStatus: () => true,
      timeout: 15000,
    });
    if (userinfoResp.status >= 400) return null;
    meId = String((userinfoResp.data as any)?.sub || '').trim();
  }
  if (!meId) return null;

  try {
    await pool.query(
      `UPDATE social_accounts
       SET token_data = COALESCE(token_data, '{}'::jsonb) || $3::jsonb
       WHERE user_id = $1 AND LOWER(platform) = LOWER($2)`,
      [params.userId, 'linkedin', JSON.stringify({ sub: meId })]
    );
  } catch {
    // ignore persistence errors
  }
  return `urn:li:person:${meId}`;
}

async function flagExpiringSocialAccounts() {
  if (!pool) return;
  const windowMs = Math.max(1, SOCIAL_TOKEN_SAFETY_MARGIN_DAYS) * 24 * 60 * 60 * 1000;
  const cutoff = new Date(Date.now() + windowMs).toISOString();

  const { rows } = await pool.query(
    `SELECT id, user_id, platform, account_id
     FROM social_accounts
     WHERE connected=true
       AND needs_reapproval=false
       AND COALESCE(token_expires_at, expires_at) IS NOT NULL
       AND COALESCE(token_expires_at, expires_at) <= $1`,
    [cutoff]
  );

  for (const row of rows) {
    await markSocialAccountNeedsReapproval({
      platformId: String(row.platform),
      accountId: String(row.account_id || ''),
      userId: String(row.user_id || ''),
      reason: 'token_expiring',
      disconnect: false,
    });
  }
}

function startTokenHealthMonitor() {
  if (!pool) return;
  const run = async () => {
    try {
      await flagExpiringSocialAccounts();
    } catch (err) {
      console.warn('[SocialAutomation] Token health scan failed:', err);
    }
  };
  void run();
  setInterval(run, 6 * 60 * 60 * 1000);
}

type PublishableSocialConnection = {
  platform: string;
  access_token: string;
  refresh_token?: string | null;
  token_data: any;
  account_id?: string | null;
  account_name?: string | null;
  needs_reapproval?: boolean;
  token_expires_at?: string | null;
};

function computeExpiresAtIso(expiresInSeconds: unknown): string | null {
  const seconds = Number(expiresInSeconds);
  if (!Number.isFinite(seconds) || seconds <= 0) return null;
  return new Date(Date.now() + seconds * 1000).toISOString();
}

function decodeStoredIntegrationSecret(value: string | null | undefined): string {
  const raw = String(value || '').trim();
  if (!raw) return '';
  try {
    return decryptIntegrationSecret(raw);
  } catch {
    return '';
  }
}

async function getUserIntegrationTokenFallback(userId: string, platformId: string) {
  if (!pool) return null;
  const integration = await getIntegrationRowBySlug(platformId);
  if (!integration) return null;

  const result = await pool.query(
    `SELECT access_token, refresh_token, token_expiry, account_id, account_name, status
     FROM user_integrations
     WHERE user_id=$1 AND integration_id=$2
     LIMIT 1`,
    [userId, integration.id]
  );
  const row = result.rows[0] as
    | {
        access_token: string | null;
        refresh_token: string | null;
        token_expiry: string | null;
        account_id: string | null;
        account_name: string | null;
        status: string | null;
      }
    | undefined;
  if (!row || String(row.status || '').toLowerCase() === 'disconnected') return null;

  const accessToken = decodeStoredIntegrationSecret(row.access_token);
  const refreshToken = decodeStoredIntegrationSecret(row.refresh_token);
  if (!accessToken && !refreshToken) return null;

  return {
    accessToken,
    refreshToken,
    tokenExpiry: row.token_expiry || null,
    accountId: row.account_id || null,
    accountName: row.account_name || null,
  };
}

async function refreshTwitterAccessToken(refreshToken: string) {
  const cfg = await getPlatformConfig('twitter');
  const clientId = (cfg.clientId || process.env.VITE_TWITTER_CLIENT_ID || '').trim();
  const clientSecret = (cfg.clientSecret || process.env.TWITTER_CLIENT_SECRET || '').trim();
  if (!clientId) throw new Error('Twitter client_id not configured');

  const data = new URLSearchParams({
    grant_type: 'refresh_token',
    refresh_token: refreshToken,
  });
  // Confidential clients: credentials via Basic auth only (not in body)
  const axiosCfg: any = {
    auth: { username: clientId, password: clientSecret || '' },
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    validateStatus: () => true,
    timeout: 15000,
  };

  const resp = await axios.post(X_OAUTH_TOKEN_URL, data.toString(), axiosCfg);
  if (resp.status >= 400) throw new Error(`Twitter token refresh failed (${resp.status})`);
  return resp.data;
}

async function refreshLinkedInAccessToken(refreshToken: string, req?: Request) {
  const credentials = await getLinkedInOAuthCredentials(req);
  const resp = await postLinkedInOAuthForm(
    {
      grant_type: 'refresh_token',
      refresh_token: refreshToken,
    },
    credentials
  );
  if (resp.status >= 400) throw new Error(`LinkedIn token refresh failed (${resp.status})`);
  return enrichLinkedInTokenData(resp.data || {}, req);
}

async function refreshTikTokAccessToken(refreshToken: string) {
  const cfg = await getPlatformConfig('tiktok');
  const clientKey = (cfg.clientKey || process.env.VITE_TIKTOK_CLIENT_ID || '').trim();
  const clientSecret = (cfg.clientSecret || process.env.TIKTOK_CLIENT_SECRET || '').trim();
  if (!clientKey || !clientSecret) throw new Error('TikTok client credentials not configured');

  const data = new URLSearchParams({
    client_key: clientKey,
    client_secret: clientSecret,
    grant_type: 'refresh_token',
    refresh_token: refreshToken,
  });
  const resp = await axios.post('https://open.tiktokapis.com/v2/oauth/token/', data.toString(), {
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    validateStatus: () => true,
    timeout: 15000,
  });
  if (resp.status >= 400) throw new Error(`TikTok token refresh failed (${resp.status})`);
  return resp.data;
}

async function refreshThreadsAccessToken(accessToken: string) {
  const token = String(accessToken || '').trim();
  if (!token) throw new Error('Threads access token missing');

  const resp = await axios.get('https://graph.threads.net/refresh_access_token', {
    params: {
      grant_type: 'th_refresh_token',
      access_token: token,
    },
    headers: { Authorization: `Bearer ${token}` },
    validateStatus: () => true,
    timeout: 15000,
  });

  const data: any = resp.data || {};
  if (resp.status >= 400) {
    const msg =
      data?.error?.message ||
      data?.error_description ||
      data?.error ||
      `Threads token refresh failed (${resp.status})`;
    throw new Error(msg);
  }

  return data;
}

// Fetch TikTok user profile with graceful scope fallback.
// Fetch TikTok user profile using two independent requests so a missing
// user.info.stats scope never blocks the basic profile from being saved.
// Call 1 (always): basic identity fields — always works with user.info.basic
// Call 2 (optional): stats fields — silently skipped if scope not approved
async function fetchTikTokUserProfile(token: string): Promise<{ user: any; scopeLimited: boolean }> {
  const ttGet = (fields: string) =>
    axios.get('https://open.tiktokapis.com/v2/user/info/', {
      headers: { Authorization: `Bearer ${token}` },
      params: { fields },
      validateStatus: () => true,
      timeout: 15000,
    });

  // ── Call 1: user.info.basic fields only — always required ─────────────────
  // IMPORTANT: only request fields covered by user.info.basic here.
  // TikTok rejects the entire request if any field requires a scope the token
  // doesn't have. Fields like username/bio_description/is_verified need
  // user.info.profile and must NOT be mixed into this call.
  const basicResp = await ttGet('open_id,display_name');
  const basicErr  = basicResp.data?.error?.code;
  if (basicResp.status !== 200 || (basicErr && basicErr !== 'ok') || !basicResp.data?.data?.user) {
    const msg = basicResp.data?.error?.message || basicErr || `HTTP ${basicResp.status}`;
    throw new Error(msg || 'TikTok user info unavailable');
  }
  const user: any = { ...basicResp.data.data.user };

  // ── Call 2: user.info.profile fields — optional ───────────────────────────
  // username, bio_description, is_verified require the user.info.profile scope.
  try {
    const profileResp = await ttGet('username,bio_description,is_verified');
    const profileErr  = profileResp.data?.error?.code;
    if (profileResp.status === 200 && (!profileErr || profileErr === 'ok') && profileResp.data?.data?.user) {
      const p = profileResp.data.data.user;
      if (p.username        != null) user.username        = p.username;
      if (p.bio_description != null) user.bio_description = p.bio_description;
      if (p.is_verified     != null) user.is_verified     = p.is_verified;
    }
  } catch (profileErr: any) {
    console.log('[TikTok profile] user.info.profile exception:', profileErr?.message);
  }

  // ── Call 3: user.info.stats fields — optional ─────────────────────────────
  // TikTok hard-rejects the whole request if stats scope isn't approved,
  // so we ask for stats separately and silently ignore any error.
  try {
    const statsResp = await ttGet('follower_count,following_count,likes_count,video_count');
    const statsErr  = statsResp.data?.error?.code;
    console.log('[TikTok stats] status:', statsResp.status, 'error:', statsErr, 'user:', JSON.stringify(statsResp.data?.data?.user));
    if (statsResp.status === 200 && (!statsErr || statsErr === 'ok') && statsResp.data?.data?.user) {
      const s = statsResp.data.data.user;
      if (s.follower_count  != null) user.follower_count  = s.follower_count;
      if (s.following_count != null) user.following_count = s.following_count;
      if (s.likes_count     != null) user.likes_count     = s.likes_count;
      if (s.video_count     != null) user.video_count     = s.video_count;
    }
  } catch (statsErr: any) {
    console.log('[TikTok stats] exception:', statsErr?.message);
  }

  console.log('[TikTok profile] final user object:', JSON.stringify(user));
  const hasStats = user.follower_count != null;
  return { user, scopeLimited: !hasStats };
}

async function getPublishableSocialConnection(userId: string, platformId: string): Promise<PublishableSocialConnection | null> {
  if (!pool) return null;
  const rows = await pool.query(
    `SELECT platform, account_type, account_id, account_name, access_token, refresh_token, access_token_encrypted, refresh_token_encrypted, token_data, expires_at, token_expires_at, needs_reapproval, connected_at, created_at
     FROM social_accounts
     WHERE user_id=$1
       AND connected=true
       AND LOWER(platform)=LOWER($2)
       AND (account_type = 'profile' OR account_type IS NULL)
     ORDER BY
       CASE WHEN account_type = 'profile' THEN 0 ELSE 1 END,
       CASE WHEN needs_reapproval THEN 1 ELSE 0 END,
       CASE WHEN COALESCE(access_token_encrypted,'') <> '' OR COALESCE(access_token,'') <> '' THEN 0 ELSE 1 END,
       COALESCE(connected_at, created_at) DESC,
       created_at DESC`,
    [userId, platformId]
  );
  const match = rows.rows[0] as
    | {
        platform: string;
        account_type: string | null;
        account_id: string | null;
        account_name: string | null;
        access_token: string | null;
        refresh_token: string | null;
        access_token_encrypted: string | null;
        refresh_token_encrypted: string | null;
        token_data: any;
        expires_at: string | null;
        token_expires_at: string | null;
        needs_reapproval: boolean | null;
        connected_at: string | null;
        created_at: string | null;
      }
    | undefined;

  const integrationFallback = await getUserIntegrationTokenFallback(userId, platformId);
  if (!match && !integrationFallback) return null;

  const decryptedAccess = decodeStoredIntegrationSecret(match?.access_token_encrypted);
  const decryptedRefresh = decodeStoredIntegrationSecret(match?.refresh_token_encrypted);

  const accessToken = String(
    decryptedAccess ||
    match?.access_token ||
    integrationFallback?.accessToken ||
    ''
  ).trim();
  const refreshToken = String(
    decryptedRefresh ||
    match?.refresh_token ||
    integrationFallback?.refreshToken ||
    ''
  ).trim();
  let tokenData = {
    ...(match?.token_data || {}),
    ...(refreshToken ? { refresh_token: refreshToken } : {}),
  };
  let rawExpiry =
    match?.token_expires_at ||
    match?.expires_at ||
    String(tokenData?.access_token_expires_at || '').trim() ||
    integrationFallback?.tokenExpiry ||
    null;

  if (platformId === 'linkedin' && accessToken) {
    const needsMetadataHydration =
      getLinkedInScopeSet(tokenData).size === 0 ||
      !String(tokenData?.access_token_expires_at || '').trim() ||
      (refreshToken && !String(tokenData?.refresh_token_expires_at || '').trim());

    if (needsMetadataHydration) {
      try {
        const enrichedTokenData = await enrichLinkedInTokenData(
          {
            ...tokenData,
            access_token: accessToken,
            ...(refreshToken ? { refresh_token: refreshToken } : {}),
          }
        );
        const enrichedExpiry =
          String(enrichedTokenData?.access_token_expires_at || '').trim() ||
          rawExpiry;

        tokenData = enrichedTokenData;
        rawExpiry = enrichedExpiry;

        await pool.query(
          `UPDATE social_accounts
           SET token_data = COALESCE(token_data, '{}'::jsonb) || $3::jsonb,
               expires_at = COALESCE($4, expires_at),
               token_expires_at = COALESCE($4, token_expires_at)
           WHERE user_id=$1 AND LOWER(platform)=LOWER($2)`,
          [userId, platformId, JSON.stringify(enrichedTokenData || {}), enrichedExpiry]
        );

        if (enrichedTokenData?.access_token_active === false) {
          await markSocialAccountNeedsReapproval({
            platformId,
            userId,
            reason: 'token_inactive',
            disconnect: false,
          });
          return {
            platform: match?.platform || platformId,
            access_token: '',
            refresh_token: refreshToken || null,
            token_data: enrichedTokenData,
            account_id: match?.account_id || integrationFallback?.accountId || null,
            account_name: match?.account_name || integrationFallback?.accountName || null,
            needs_reapproval: true,
            token_expires_at: enrichedExpiry,
          };
        }
      } catch {
        // Metadata hydration is best-effort; keep the token usable if LinkedIn inspection fails.
      }
    }
  }

  const expiresAtMs = rawExpiry ? new Date(rawExpiry).getTime() : NaN;
  const hasUsableToken = Boolean(accessToken) && (!Number.isFinite(expiresAtMs) || expiresAtMs > Date.now());

  if (match?.needs_reapproval && !hasUsableToken) {
    return {
      platform: match.platform,
      access_token: '',
      refresh_token: refreshToken || null,
      token_data: tokenData,
      account_id: match.account_id || integrationFallback?.accountId || null,
      account_name: match.account_name || integrationFallback?.accountName || null,
      needs_reapproval: true,
      token_expires_at: rawExpiry,
    };
  }

  const linkedInRefreshExpiry =
    platformId === 'linkedin'
      ? String(tokenData?.refresh_token_expires_at || '').trim()
      : '';
  const linkedInRefreshExpiryMs = linkedInRefreshExpiry ? new Date(linkedInRefreshExpiry).getTime() : NaN;
  if (platformId === 'linkedin' && refreshToken && Number.isFinite(linkedInRefreshExpiryMs) && linkedInRefreshExpiryMs <= Date.now()) {
    await markSocialAccountNeedsReapproval({
      platformId,
      userId,
      reason: 'refresh_token_expired',
      disconnect: false,
    });
    return {
      platform: match?.platform || platformId,
      access_token: '',
      refresh_token: refreshToken || null,
      token_data: tokenData,
      account_id: match?.account_id || integrationFallback?.accountId || null,
      account_name: match?.account_name || integrationFallback?.accountName || null,
      needs_reapproval: true,
      token_expires_at: rawExpiry,
    };
  }

  const refreshMarginMs = Math.max(1, SOCIAL_TOKEN_SAFETY_MARGIN_DAYS) * 24 * 60 * 60 * 1000;
  const refreshMode: 'none' | 'refresh_token' | 'threads_access_token' =
    platformId === 'threads'
      ? 'threads_access_token'
      : platformId === 'twitter' || platformId === 'tiktok' || (platformId === 'linkedin' && !!refreshToken)
        ? 'refresh_token'
        : 'none';
  const isExpired = Number.isFinite(expiresAtMs) ? expiresAtMs <= Date.now() : false;
  const shouldRefreshSoon =
    refreshMode !== 'none' && Number.isFinite(expiresAtMs) ? expiresAtMs <= Date.now() + refreshMarginMs : false;

  if (!Number.isFinite(expiresAtMs) || (refreshMode === 'none' && !isExpired) || (refreshMode !== 'none' && !shouldRefreshSoon)) {
    return {
      platform: match?.platform || platformId,
      access_token: accessToken,
      refresh_token: refreshToken || null,
      token_data: tokenData,
      account_id: match?.account_id || integrationFallback?.accountId || null,
      account_name: match?.account_name || integrationFallback?.accountName || null,
      needs_reapproval: false,
      token_expires_at: rawExpiry,
    };
  }

  if (refreshMode === 'none') {
    await markSocialAccountNeedsReapproval({
      platformId,
      userId,
      reason: 'token_expired',
      disconnect: false,
    });
    return {
      platform: match?.platform || platformId,
      access_token: '',
      refresh_token: refreshToken || null,
      token_data: tokenData,
      account_id: match?.account_id || integrationFallback?.accountId || null,
      account_name: match?.account_name || integrationFallback?.accountName || null,
      needs_reapproval: true,
      token_expires_at: rawExpiry,
    };
  }

  if (refreshMode === 'refresh_token' && !refreshToken) {
    await markSocialAccountNeedsReapproval({
      platformId,
      userId,
      reason: 'token_missing_refresh',
      disconnect: false,
    });
    return {
      platform: match?.platform || platformId,
      access_token: '',
      refresh_token: null,
      token_data: tokenData,
      account_id: match?.account_id || integrationFallback?.accountId || null,
      account_name: match?.account_name || integrationFallback?.accountName || null,
      needs_reapproval: true,
      token_expires_at: rawExpiry,
    };
  }

  let refreshed: any = null;
  try {
    if (platformId === 'threads') {
      refreshed = await refreshThreadsAccessToken(accessToken);
    } else if (platformId === 'twitter') {
      refreshed = await refreshTwitterAccessToken(refreshToken);
    } else if (platformId === 'linkedin') {
      refreshed = await refreshLinkedInAccessToken(refreshToken);
    } else if (platformId === 'tiktok') {
      refreshed = await refreshTikTokAccessToken(refreshToken);
    }
  } catch {
    await markSocialAccountNeedsReapproval({
      platformId,
      userId,
      reason: 'token_refresh_failed',
      disconnect: false,
    });
    return {
      platform: match?.platform || platformId,
      access_token: '',
      refresh_token: refreshToken || null,
      token_data: tokenData,
      account_id: match?.account_id || integrationFallback?.accountId || null,
      account_name: match?.account_name || integrationFallback?.accountName || null,
      needs_reapproval: true,
      token_expires_at: rawExpiry,
    };
  }

  const nextAccess = String(refreshed?.access_token || '').trim();
  const nextRefresh = String(refreshed?.refresh_token || refreshToken || '').trim() || null;
  const nextExpiresAt = String(refreshed?.access_token_expires_at || '').trim() || computeExpiresAtIso(refreshed?.expires_in) || rawExpiry;
  const mergedTokenData = { ...(tokenData || {}), ...(refreshed || {}) };

  if (nextAccess) {
    const nextAccessEncrypted = encryptIntegrationSecret(nextAccess);
    const nextRefreshEncrypted = nextRefresh ? encryptIntegrationSecret(nextRefresh) : null;
    try {
      await pool.query(
        `UPDATE social_accounts
         SET access_token=$3,
             refresh_token=$4,
             access_token_encrypted=$5,
             refresh_token_encrypted=$6,
             expires_at=$7,
             token_expires_at=$7,
             needs_reapproval=false,
             token_data = COALESCE(token_data, '{}'::jsonb) || $8::jsonb
         WHERE user_id=$1 AND LOWER(platform)=LOWER($2)`,
        [userId, match?.platform || platformId, null, null, nextAccessEncrypted, nextRefreshEncrypted, nextExpiresAt, JSON.stringify(refreshed || {})]
      );
      await upsertUserIntegration({
        userId,
        integrationSlug: platformId,
        accessTokenEncrypted: nextAccessEncrypted,
        refreshTokenEncrypted: nextRefreshEncrypted,
        tokenExpiry: nextExpiresAt,
        accountId: match?.account_id ?? integrationFallback?.accountId ?? null,
        accountName: match?.account_name ?? integrationFallback?.accountName ?? null,
        status: 'connected',
      });
      await logIntegrationEvent({
        userId,
        integrationSlug: platformId,
        eventType: 'token_refresh',
        status: 'success',
        response: { expiresAt: nextExpiresAt },
      });
    } catch {
      // ignore persistence issues; still return refreshed token for this request
    }
    return {
      platform: match?.platform || platformId,
      access_token: nextAccess,
      refresh_token: nextRefresh,
      token_data: mergedTokenData,
      account_id: match?.account_id || integrationFallback?.accountId || null,
      account_name: match?.account_name || integrationFallback?.accountName || null,
      needs_reapproval: false,
      token_expires_at: nextExpiresAt,
    };
  }

  return {
    platform: match?.platform || platformId,
    access_token: '',
    refresh_token: refreshToken || null,
    token_data: tokenData,
    account_id: match?.account_id || integrationFallback?.accountId || null,
    account_name: match?.account_name || integrationFallback?.accountName || null,
    needs_reapproval: true,
    token_expires_at: rawExpiry,
  };
}

const LINKEDIN_MARKETING_VERSION = String(process.env.LINKEDIN_API_VERSION || '202603').trim() || '202603';

function getLinkedInRestHeaders(accessToken: string, contentType = 'application/json'): Record<string, string> {
  const headers: Record<string, string> = {
    Authorization: `Bearer ${accessToken}`,
    'X-Restli-Protocol-Version': '2.0.0',
    'LinkedIn-Version': LINKEDIN_MARKETING_VERSION,
  };
  if (contentType) headers['Content-Type'] = contentType;
  return headers;
}

function parseLinkedInOrganizationId(value: unknown): string {
  const raw = String(value || '').trim();
  if (!raw) return '';
  const urnMatch = raw.match(/organization:(\d+)/i);
  if (urnMatch?.[1]) return urnMatch[1];
  return /^\d+$/.test(raw) ? raw : '';
}

function buildLinkedInRestliList(values: string[]): string {
  return `List(${values.map((value) => encodeURIComponent(value)).join(',')})`;
}

function buildLinkedInRestliListValue(values: string[]): string {
  return `List(${values.join(',')})`;
}

function normalizeLinkedInOrganization(org: any, idFallback = ''): {
  id: string;
  name: string;
  picture_url?: string | null;
  raw: any;
} {
  const id = parseLinkedInOrganizationId(org?.id) || idFallback;
  const localizedName = String(org?.localizedName || org?.name || '').trim();
  return {
    id,
    name: localizedName || `LinkedIn Page ${id || idFallback}`,
    picture_url:
      (typeof org?.logoV2?.displayedPicture === 'string' && org.logoV2.displayedPicture) ||
      (typeof org?.logoV2?.original === 'string' && org.logoV2.original) ||
      null,
    raw: org,
  };
}

async function fetchLinkedInOrganizationsByIds(
  accessToken: string,
  organizationIds: string[],
): Promise<Array<{ id: string; name: string; picture_url?: string | null; raw: any }>> {
  const uniqueIds = Array.from(new Set(organizationIds.map((id) => String(id || '').trim()).filter(Boolean)));
  if (uniqueIds.length === 0) return [];

  const batchResp = await axios.get(
    `https://api.linkedin.com/rest/organizations?ids=${buildLinkedInRestliList(uniqueIds)}`,
    {
      headers: getLinkedInRestHeaders(accessToken),
      validateStatus: () => true,
      timeout: 15000,
    },
  );

  const batchData: any = batchResp.data || {};
  if (batchResp.status < 400 && batchData?.results && typeof batchData.results === 'object') {
    return uniqueIds
      .map((id) => {
        const status = Number(batchData?.statuses?.[id] ?? 200);
        if (status >= 400) return null;
        const org = batchData.results[id];
        if (!org) return null;
        return normalizeLinkedInOrganization(org, id);
      })
      .filter(Boolean) as Array<{ id: string; name: string; picture_url?: string | null; raw: any }>;
  }

  const organizations: Array<{ id: string; name: string; picture_url?: string | null; raw: any }> = [];
  for (const organizationId of uniqueIds) {
    const orgResp = await axios.get(`https://api.linkedin.com/rest/organizations/${encodeURIComponent(organizationId)}`, {
      headers: getLinkedInRestHeaders(accessToken),
      validateStatus: () => true,
      timeout: 15000,
    });
    if (orgResp.status >= 400 || !orgResp.data) continue;
    organizations.push(normalizeLinkedInOrganization(orgResp.data, organizationId));
  }
  return organizations;
}

async function fetchLinkedInOrganizationNetworkSize(accessToken: string, organizationUrn: string): Promise<number | null> {
  const resp = await axios.get(
    `https://api.linkedin.com/rest/networkSizes/${encodeURIComponent(organizationUrn)}`,
    {
      params: { edgeType: 'COMPANY_FOLLOWED_BY_MEMBER' },
      headers: getLinkedInRestHeaders(accessToken),
      validateStatus: () => true,
      timeout: 15000,
    },
  );
  if (resp.status >= 400) return null;
  const firstDegreeSize = Number((resp.data as any)?.firstDegreeSize);
  return Number.isFinite(firstDegreeSize) ? firstDegreeSize : null;
}

async function fetchLinkedInPostsByAuthor(accessToken: string, authorUrn: string, maxCount = 100): Promise<any[]> {
  const posts: any[] = [];
  let start = 0;

  while (posts.length < maxCount) {
    const count = Math.min(100, maxCount - posts.length);
    const resp = await axios.get('https://api.linkedin.com/rest/posts', {
      params: {
        q: 'author',
        author: authorUrn,
        viewContext: 'AUTHOR',
        count,
        start,
      },
      headers: getLinkedInRestHeaders(accessToken),
      validateStatus: () => true,
      timeout: 15000,
    });
    if (resp.status >= 400) break;

    const elements = Array.isArray((resp.data as any)?.elements) ? (resp.data as any).elements : [];
    posts.push(...elements);
    if (elements.length < count) break;
    start += elements.length;
  }

  return posts;
}

async function fetchLinkedInSocialMetadataBatch(accessToken: string, entityUrns: string[]): Promise<Record<string, any>> {
  const uniqueUrns = Array.from(new Set(entityUrns.map((urn) => String(urn || '').trim()).filter(Boolean)));
  if (uniqueUrns.length === 0) return {};

  const resp = await axios.get(
    `https://api.linkedin.com/rest/socialMetadata?ids=${buildLinkedInRestliList(uniqueUrns)}`,
    {
      headers: getLinkedInRestHeaders(accessToken),
      validateStatus: () => true,
      timeout: 15000,
    },
  );
  if (resp.status >= 400) return {};
  const data: any = resp.data || {};
  return data?.results && typeof data.results === 'object' ? data.results : {};
}

function sumLinkedInReactionCounts(metadata: any): number {
  const summaries = metadata?.reactionSummaries;
  if (!summaries || typeof summaries !== 'object') return 0;
  return Object.values(summaries).reduce((sum, summary: any) => sum + Number(summary?.count || 0), 0);
}

async function fetchLinkedInShareStatisticsForPosts(
  accessToken: string,
  organizationUrn: string,
  postUrns: string[],
): Promise<Map<string, any>> {
  const uniquePostUrns = Array.from(new Set(postUrns.map((urn) => String(urn || '').trim()).filter(Boolean)));
  if (uniquePostUrns.length === 0) return new Map();

  const params = new URLSearchParams({
    q: 'organizationalEntity',
    organizationalEntity: organizationUrn,
  });

  const shareUrns = uniquePostUrns.filter((urn) => /^urn:li:share:/i.test(urn));
  const ugcPostUrns = uniquePostUrns.filter((urn) => /^urn:li:ugcPost:/i.test(urn));
  if (shareUrns.length > 0) params.set('shares', buildLinkedInRestliListValue(shareUrns));
  if (ugcPostUrns.length > 0) params.set('ugcPosts', buildLinkedInRestliListValue(ugcPostUrns));

  const resp = await axios.get(
    `https://api.linkedin.com/rest/organizationalEntityShareStatistics?${params.toString()}`,
    {
      headers: getLinkedInRestHeaders(accessToken),
      validateStatus: () => true,
      timeout: 15000,
    },
  );

  const statsByPost = new Map<string, any>();
  if (resp.status >= 400) return statsByPost;

  const elements = Array.isArray((resp.data as any)?.elements) ? (resp.data as any).elements : [];
  for (const element of elements) {
    const key = String(element?.share || element?.ugcPost || '').trim();
    if (!key) continue;
    statsByPost.set(key, element?.totalShareStatistics || {});
  }
  return statsByPost;
}

async function getLinkedInAuthContext(userId: string): Promise<{
  accessToken: string;
  socialAccountId: string | null;
  hasConnection: boolean;
  accountId: string | null;
  accountName: string | null;
  tokenData: any;
}> {
  const conn = await getPublishableSocialConnection(userId, 'linkedin');
  const preferredAccountId = String(conn?.account_id || '').trim();
  let socialAccountId: string | null = null;

  if (pool) {
    const accountRes = await pool.query(
      `SELECT id
       FROM social_accounts
       WHERE user_id=$1
         AND platform='linkedin'
         AND connected=true
       ORDER BY
         CASE WHEN account_type='profile' OR account_type IS NULL THEN 0 ELSE 1 END,
         CASE WHEN $2 <> '' AND account_id=$2 THEN 0 ELSE 1 END,
         CASE WHEN COALESCE(access_token_encrypted, '') <> '' OR COALESCE(access_token, '') <> '' THEN 0 ELSE 1 END,
         COALESCE(connected_at, created_at) DESC,
         created_at DESC
       LIMIT 1`,
      [userId, preferredAccountId]
    );
    socialAccountId = accountRes.rows[0]?.id ? String(accountRes.rows[0].id) : null;
  }

  return {
    accessToken: String(conn?.access_token || '').trim(),
    socialAccountId,
    hasConnection: Boolean(conn || socialAccountId),
    accountId: conn?.account_id || null,
    accountName: conn?.account_name || null,
    tokenData: conn?.token_data || {},
  };
}

async function resolveLinkedInProfileIdentity(accessToken: string, fallback?: {
  accountId?: string | null;
  accountName?: string | null;
  tokenData?: any;
}): Promise<{ personId: string; profileName: string }> {
  let personId =
    String(fallback?.accountId || '').trim() ||
    String(fallback?.tokenData?.sub || fallback?.tokenData?.user_id || fallback?.tokenData?.id || '').trim();
  let profileName = String(fallback?.accountName || fallback?.tokenData?.name || '').trim();

  if (!personId || !profileName) {
    const meResp = await axios.get('https://api.linkedin.com/v2/me', {
      headers: { Authorization: `Bearer ${accessToken}` },
      validateStatus: () => true,
      timeout: 15000,
    });
    if (meResp.status < 400) {
      const meData: any = meResp.data || {};
      personId = personId || String(meData?.id || '').trim();
      profileName = profileName ||
        [String(meData?.localizedFirstName || '').trim(), String(meData?.localizedLastName || '').trim()]
          .filter(Boolean)
          .join(' ')
          .trim();
    }
    if (!personId) {
      const userinfoResp = await axios.get('https://api.linkedin.com/v2/userinfo', {
        headers: { Authorization: `Bearer ${accessToken}` },
        validateStatus: () => true,
        timeout: 15000,
      });
      if (userinfoResp.status >= 400) {
        throw new Error('LinkedIn profile lookup failed — please reconnect');
      }
      const userData: any = userinfoResp.data || {};
      personId = String(userData?.sub || '').trim();
      profileName = profileName ||
        String(userData?.name || '').trim() ||
        [String(userData?.given_name || '').trim(), String(userData?.family_name || '').trim()]
          .filter(Boolean)
          .join(' ')
          .trim();
    }
  }

  return { personId, profileName };
}

async function listLinkedInAdminOrganizations(
  accessToken: string,
  _personId: string,
  options?: { allowedRoles?: string[] },
): Promise<{
  organizations: Array<{ id: string; name: string; picture_url?: string | null; roles?: string[] }>;
  warning: string | null;
}> {
  const allowedRoles = new Set((options?.allowedRoles || []).map((role) => String(role || '').trim().toUpperCase()).filter(Boolean));
  const aclRequests = [
    {
      url: 'https://api.linkedin.com/rest/organizationAcls',
      headers: getLinkedInRestHeaders(accessToken),
    },
    {
      url: 'https://api.linkedin.com/v2/organizationAcls',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'X-Restli-Protocol-Version': '2.0.0',
      },
    },
  ];

  let aclWarning: string | null = null;
  const organizationRoles = new Map<string, Set<string>>();
  let requestIndex = 0;
  let start = 0;
  const count = 100;

  while (requestIndex < aclRequests.length) {
    const request = aclRequests[requestIndex];
    const params: Record<string, string | number> = {
      q: 'roleAssignee',
      count,
      start,
    };

    const aclResp = await axios.get(
      request.url,
      {
        params,
        headers: request.headers,
        validateStatus: () => true,
        timeout: 15000,
      },
    );
    const aclData: any = aclResp.data || {};

    if (aclResp.status >= 400) {
      aclWarning = aclData?.message || `LinkedIn organization ACL lookup failed (${aclResp.status})`;
      if (requestIndex === 0 && [400, 401, 404, 410, 426].includes(aclResp.status)) {
        requestIndex += 1;
        start = 0;
        continue;
      }
      return { organizations: [], warning: aclWarning };
    }

    const elements = Array.isArray(aclData?.elements) ? aclData.elements : [];
    for (const row of elements) {
      const state = String(row?.state || '').trim().toUpperCase();
      if (state && state !== 'APPROVED') continue;
      const role = String(row?.role || '').trim().toUpperCase();
      if (allowedRoles.size > 0 && role && !allowedRoles.has(role)) continue;
      const organizationId = parseLinkedInOrganizationId(row?.organizationTarget || row?.organization);
      if (!organizationId) continue;
      const roles = organizationRoles.get(organizationId) || new Set<string>();
      if (role) roles.add(role);
      organizationRoles.set(organizationId, roles);
    }

    if (elements.length < count) {
      const organizationDetails = await fetchLinkedInOrganizationsByIds(accessToken, Array.from(organizationRoles.keys()));
      return {
        organizations: organizationDetails.map((org) => ({
          id: org.id,
          name: org.name,
          picture_url: org.picture_url,
          roles: Array.from(organizationRoles.get(org.id) || []),
        })),
        warning: aclWarning,
      };
    }

    start += count;
  }

  return { organizations: [], warning: aclWarning };
}

function extractLinkedInOrganizationDescription(org: any): string | null {
  const direct = String(org?.description || '').trim();
  if (direct) return direct;

  const localized = org?.description?.localized;
  if (localized && typeof localized === 'object') {
    const first = Object.values(localized).find((value) => typeof value === 'string' && String(value).trim());
    if (typeof first === 'string' && first.trim()) return first.trim();
  }

  return null;
}

function extractLinkedInPostText(post: any): string | null {
  const commentary = String(post?.commentary || '').trim();
  if (commentary) return commentary.slice(0, 5000);
  const articleTitle = String(post?.content?.article?.title || '').trim();
  if (articleTitle) return articleTitle.slice(0, 5000);
  return null;
}

function extractLinkedInPostMediaType(post: any): string {
  const mediaId = String(post?.content?.media?.id || '').trim().toLowerCase();
  if (post?.content?.multiImage?.images?.length) return 'multi_image';
  if (post?.content?.article?.source) return 'article';
  if (mediaId.includes(':video:')) return 'video';
  if (mediaId.includes(':image:')) return 'image';
  if (mediaId.includes(':document:')) return 'document';
  return 'text';
}

async function getUserSettingValue(userId: string, key: string): Promise<any | null> {
  if (!pool) return null;
  try {
    const result = await pool.query('SELECT value FROM user_settings WHERE user_id = $1 AND key = $2', [userId, key]);
    return result.rows[0]?.value ?? null;
  } catch {
    return null;
  }
}

function safeJsonObject(value: any): Record<string, any> {
  if (!value) return {};
  if (typeof value === 'object') return value as Record<string, any>;
  if (typeof value === 'string') {
    try {
      const parsed = JSON.parse(value);
      return parsed && typeof parsed === 'object' ? (parsed as Record<string, any>) : {};
    } catch {
      return {};
    }
  }
  return {};
}

function extractSocialAutomationSettings(post: Record<string, any>) {
  const raw = safeJsonObject((post as any).social_automation);
  const fb = raw?.platforms?.facebook ?? raw?.facebook ?? {};
  const enabled = Boolean(fb?.enabled);
  const destination = fb?.destination ?? {};
  const destType: 'page' | 'group' | 'profile' = destination?.type === 'group' ? 'group' : destination?.type === 'profile' ? 'profile' : 'page';
  const destId = String(destination?.id || '').trim();
  const destName = destination?.name ? String(destination.name) : '';
  const template = String(raw?.postFormat?.template || raw?.template || '').trim();
  const scheduling = raw?.scheduling ?? {};
  const mode: 'immediate' | 'schedule' | 'delay' =
    scheduling?.mode === 'schedule' || scheduling?.mode === 'delay' ? scheduling.mode : 'immediate';
  const scheduledFor = scheduling?.scheduledFor ? String(scheduling.scheduledFor) : null;
  const delayMinutes = typeof scheduling?.delayMinutes === 'number' ? scheduling.delayMinutes : null;
  const timezone = scheduling?.timezone ? String(scheduling.timezone) : null;
  return {
    enabled,
    template,
    scheduling: { mode, scheduledFor, delayMinutes, timezone },
    facebook: { destination: { type: destType, id: destId, name: destName } },
  };
}

async function ensureBullMqSocialAutomationQueue() {
  if (socialAutomationQueue && socialAutomationWorker && socialAutomationRedis) return;
  if (!isBullMqEnabled()) return;
  if (!pool) throw new Error('BullMQ is enabled but DATABASE_URL is not configured');

  socialAutomationRedis = new IORedis(REDIS_URL, {
    maxRetriesPerRequest: null,
    enableReadyCheck: true,
  });

  socialAutomationQueue = new Queue(SOCIAL_AUTOMATION_QUEUE_NAME, {
    connection: socialAutomationRedis as any,
    defaultJobOptions: {
      attempts: SOCIAL_AUTOMATION_MAX_ATTEMPTS,
      backoff: { type: 'exponential', delay: SOCIAL_AUTOMATION_RETRY_BASE_DELAY_MS },
      removeOnComplete: { count: 500 },
      removeOnFail: { count: 500 },
    },
  });

  socialAutomationWorker = new Worker(
    SOCIAL_AUTOMATION_QUEUE_NAME,
    async (job) => {
      const taskId = String((job.data as any)?.taskId || '');
      if (!taskId) return { ok: false, error: 'Missing taskId' };
      const attemptNumber = (job.attemptsMade || 0) + 1;
      const maxAttempts = typeof (job.opts as any)?.attempts === 'number' ? (job.opts as any).attempts : SOCIAL_AUTOMATION_MAX_ATTEMPTS;
      return await processSocialAutomationTaskById(taskId, attemptNumber, maxAttempts);
    },
    { connection: socialAutomationRedis as any, concurrency: 5 }
  );

  socialAutomationWorker.on('error', (err) => {
    console.error('[SocialAutomation] BullMQ worker error:', err);
  });
}

async function enqueueBullMqJob(taskId: string, runAtIso: string, platform?: string) {
  if (!isBullMqEnabled()) return;
  await ensureBullMqSocialAutomationQueue();
  if (!socialAutomationQueue) return;

  const runAt = new Date(runAtIso);
  const delay = Math.max(0, runAt.getTime() - Date.now());
  const attempts = getSocialAutomationMaxAttempts(platform);
  const backoffDelay = getRetryDelayMs(1, platform);
  try {
    await socialAutomationQueue.add('social-publish', { taskId }, {
      jobId: taskId,
      delay,
      attempts,
      backoff: { type: 'exponential', delay: backoffDelay },
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err || '');
    if (/Job.*already exists/i.test(msg)) return;
    throw err;
  }
}

async function resolveSocialAccountIdForLog(userId: string, platform: string, destination: any) {
  if (!pool) return null;
  const dest = destination || {};
  const accountType = String(dest.type || '').trim().toLowerCase();
  const accountId = String(dest.id || '').trim();
  if (!accountType || !accountId) return null;
  const { rows } = await pool.query(
    `SELECT id FROM social_accounts WHERE user_id=$1 AND LOWER(platform)=LOWER($2) AND account_type=$3 AND account_id=$4 LIMIT 1`,
    [userId, platform, accountType, accountId]
  );
  return rows.length ? String(rows[0].id) : null;
}

async function cancelPendingSocialAutomationForPost(userId: string, postId: string, reason: string) {
  if (!pool) return;

  await pool
    .query(
      `UPDATE social_automation_tasks
       SET status='cancelled', last_error=$3, updated_at=NOW()
       WHERE user_id=$1 AND post_id=$2 AND status IN ('scheduled','pending')`,
      [userId, postId, reason]
    )
    .catch(() => undefined);

  await pool
    .query(
      `UPDATE publishing_logs
       SET status='cancelled', error_message=$3
       WHERE user_id=$1 AND post_id=$2 AND status IN ('scheduled','pending')`,
      [userId, postId, reason]
    )
    .catch(() => undefined);
}

async function syncSocialAutomationForPost(userId: string, postId: string) {
  if (!pool) return;

  const postRows = await pool.query(
    `SELECT p.*,
      ARRAY(SELECT t.name FROM blog_tags t JOIN blog_post_tags pt ON pt.tag_id=t.id WHERE pt.post_id=p.id) AS tag_names
     FROM blog_posts p
     WHERE p.id=$1 AND p.user_id=$2
     LIMIT 1`,
    [postId, userId]
  );

  if (!postRows.rows.length) return;

  const post = postRows.rows[0] as any;
  const isPublished = String(post.status || '').toLowerCase() === 'published';

  await cancelPendingSocialAutomationForPost(
    userId,
    postId,
    isPublished ? 'Replaced by updated social settings' : 'Social automation disabled for this post'
  );

  if (!isPublished) return;

  await queueSocialAutomationForPublishedPost(userId, post);
}

async function insertSocialPostLog(params: {
  userId: string;
  postId: string;
  platform: string;
  destination: any;
  status: string;
  apiResponse: any;
  postedAtIso: string | null;
}) {
  if (!pool) return;
  const socialAccountId = await resolveSocialAccountIdForLog(params.userId, params.platform, params.destination).catch(() => null);
  await pool
    .query(
      `INSERT INTO social_post_logs (id, post_id, social_account_id, platform, status, api_response, posted_at)
       VALUES ($1,$2,$3,$4,$5,$6::jsonb,$7)`,
      [
        randomUUID(),
        params.postId,
        socialAccountId,
        params.platform,
        params.status,
        JSON.stringify(params.apiResponse ?? null),
        params.postedAtIso,
      ]
    )
    .catch(() => undefined);
}

async function processSocialAutomationTaskById(taskId: string, attemptNumber: number, maxAttempts: number) {
  if (!pool) throw new Error('DATABASE_URL is not configured');

  const taskRows = await pool.query(`SELECT * FROM social_automation_tasks WHERE id=$1 LIMIT 1`, [taskId]);
  if (!taskRows.rows.length) return { ok: false, error: 'Task not found' };
  const task = taskRows.rows[0] as any;

  const userId = String(task.user_id);
  const postId = String(task.post_id);
  const platform = String(task.platform || 'facebook');
  const logId = task.log_id ? String(task.log_id) : null;
  const payload = safeJsonObject(task.payload);
  const destination = payload?.destination || null;
  const template = payload?.template ? String(payload.template) : '';

  await pool.query(
    `UPDATE social_automation_tasks SET status='pending', attempts=attempts+1, updated_at=NOW() WHERE id=$1`,
    [taskId]
  );

  const scheduleRetry = async (msg: string) => {
    const retryAt = new Date(Date.now() + getRetryDelayMs(attemptNumber, platform));
    await pool
      .query(
        `UPDATE social_automation_tasks
         SET status='scheduled', run_at=$2, last_error=$3, updated_at=NOW()
         WHERE id=$1`,
        [taskId, retryAt.toISOString(), msg]
      )
      .catch(() => undefined);
    if (logId) {
      await pool
        .query(`UPDATE publishing_logs SET status='scheduled', error_message=$1 WHERE id=$2 AND user_id=$3`, [
          msg,
          logId,
          userId,
        ])
        .catch(() => undefined);
    }
    const err: any = new Error(msg);
    err.retryScheduled = true;
    throw err;
  };

  try {
    const postRows = await pool.query(
      `SELECT p.*,
        ARRAY(SELECT t.name FROM blog_tags t JOIN blog_post_tags pt ON pt.tag_id=t.id WHERE pt.post_id=p.id) AS tag_names
       FROM blog_posts p
       WHERE p.id=$1 AND p.user_id=$2`,
      [postId, userId]
    );
    if (!postRows.rows.length) throw new Error('Post not found');

    const result = await publishToplatform(userId, postRows.rows[0], platform, {
      template,
      destination,
    });

    if (result.status === 'failed' && result.retryable && attemptNumber < maxAttempts) {
      await insertSocialPostLog({
        userId,
        postId,
        platform,
        destination,
        status: 'failed',
        apiResponse: result,
        postedAtIso: null,
      });
      await scheduleRetry(result.error || 'Automation failed');
    }

    await pool.query(
      `UPDATE social_automation_tasks SET status=$2, last_error=$3, updated_at=NOW() WHERE id=$1`,
      [taskId, result.status, result.error || null]
    );

    if (logId) {
      await pool.query(
        `UPDATE publishing_logs
         SET status=$1, platform_post_id=$2, error_message=$3, response=$4
         WHERE id=$5 AND user_id=$6`,
        [result.status, result.platformPostId || null, result.error || null, result as any, logId, userId]
      );
    } else {
      await pool
        .query(
          'INSERT INTO publishing_logs (id,post_id,user_id,platform,status,platform_post_id,error_message,response,posted_at) VALUES ($1,$2,$3,$4,$5,$6,$7,$8::jsonb,$9)',
          [randomUUID(), postId, userId, platform, result.status, result.platformPostId || null, result.error || null, JSON.stringify(result as any), result.status === 'published' ? new Date().toISOString() : null]
        )
        .catch(() => undefined);
    }

    await insertSocialPostLog({
      userId,
      postId,
      platform,
      destination,
      status: result.status,
      apiResponse: result,
      postedAtIso: result.status === 'published' ? new Date().toISOString() : null,
    });

    return { ok: result.status !== 'failed', ...result };
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Automation failed';
    if ((err as any)?.retryScheduled) {
      throw err;
    }

    if (attemptNumber < maxAttempts) {
      await scheduleRetry(msg);
    }

    await pool
      .query(
        `UPDATE social_automation_tasks
         SET status='failed', last_error=$2, updated_at=NOW()
         WHERE id=$1`,
        [taskId, msg]
      )
      .catch(() => undefined);

    if (logId) {
      await pool
        .query(`UPDATE publishing_logs SET status='failed', error_message=$1 WHERE id=$2 AND user_id=$3`, [
          msg,
          logId,
          userId,
        ])
        .catch(() => undefined);
    } else {
      await pool
        .query('INSERT INTO publishing_logs (id,post_id,user_id,platform,status,error_message,response) VALUES ($1,$2,$3,$4,$5,$6,$7::jsonb)', [
          randomUUID(),
          postId,
          userId,
          platform,
          'failed',
          msg,
          JSON.stringify({ error: msg }),
        ])
        .catch(() => undefined);
    }

    await insertSocialPostLog({
      userId,
      postId,
      platform,
      destination,
      status: 'failed',
      apiResponse: { error: msg },
      postedAtIso: null,
    });

    return { ok: false, status: 'failed', error: msg };
  }
}

async function enqueueSocialAutomationTask(params: {
  userId: string;
  postId: string;
  platform: string;
  runAt: Date;
  payload: any;
  accountLabel: string | null;
}) {
  if (!pool) return;
  const now = Date.now();
  const runAtIso = params.runAt.toISOString();
  const initialStatus = params.runAt.getTime() > (now + 2000) ? 'scheduled' : 'pending';
  const dest = safeJsonObject(params.payload)?.destination || {};
  const destId = String(dest?.id || '').trim();
  const destType = String(dest?.type || '').trim();

  const existing = await pool.query(
    `SELECT 1 FROM social_automation_tasks
     WHERE user_id=$1 AND post_id=$2 AND LOWER(platform)=LOWER($3)
       AND status IN ('scheduled','pending')
       AND COALESCE(payload->'destination'->>'id','') = $4
       AND COALESCE(payload->'destination'->>'type','') = $5
     LIMIT 1`,
    [params.userId, params.postId, params.platform, destId, destType]
  );
  if (existing.rows.length) return;

  const logId = randomUUID();
  await pool.query(
    'INSERT INTO publishing_logs (id,post_id,user_id,platform,status,account,scheduled_for) VALUES ($1,$2,$3,$4,$5,$6,$7)',
    [
      logId,
      params.postId,
      params.userId,
      params.platform,
      initialStatus,
      params.accountLabel,
      initialStatus === 'scheduled' ? runAtIso : null,
    ]
  );

  const taskId = randomUUID();
  await pool.query(
    `INSERT INTO social_automation_tasks (id,user_id,post_id,platform,run_at,status,payload,log_id,attempts,updated_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7::jsonb,$8,0,NOW())`,
    [taskId, params.userId, params.postId, params.platform, runAtIso, initialStatus, JSON.stringify(params.payload || {}), logId]
  );

  await enqueueBullMqJob(taskId, runAtIso, params.platform);
}

async function queueSocialAutomationForPublishedPost(userId: string, post: Record<string, any>) {
  if (!pool) return;

  const postId = String((post as any).id);

  const v2 = await pool.query(
    `SELECT s.*, t.id AS target_id, t.enabled AS target_enabled,
      a.id AS social_account_id, a.platform AS account_platform, a.account_type, a.account_id, a.account_name
     FROM social_post_settings s
     JOIN social_post_targets t ON t.social_post_id=s.id
     JOIN social_accounts a ON a.id=t.social_account_id
     WHERE s.post_id=$1 AND t.enabled=true`,
    [postId]
  );

  if (v2.rows.length) {
    for (const row of v2.rows as any[]) {
      const publishType = String(row.publish_type || 'immediate');
      let runAt = new Date();
      if (publishType === 'scheduled' || publishType === 'delayed') {
        if (!row.scheduled_at) throw new Error(`Social Automation publish_type is '${publishType}' but scheduled_at is missing`);
        const dt = new Date(String(row.scheduled_at));
        if (Number.isNaN(dt.getTime())) throw new Error('Invalid Social Automation scheduled_at');
        runAt = dt;
      }

      const destType = String(row.account_type || 'profile').toLowerCase() || 'profile';
      const destination = { type: destType, id: String(row.account_id || ''), name: String(row.account_name || '') };
      const accountLabel = formatSocialAccountLabel(String(row.account_platform || 'facebook'), destType, destination.name, destination.id);

      await enqueueSocialAutomationTask({
        userId,
        postId,
        platform: String(row.account_platform || 'facebook'),
        runAt,
        payload: { destination, template: String(row.template || '') },
        accountLabel,
      });
    }
    return;
  }

  const s = extractSocialAutomationSettings(post);
  if (!s.enabled) return;

  const now = Date.now();
  let runAt = new Date(now);
  if (s.scheduling.mode === 'delay') {
    const mins = Math.max(1, Number(s.scheduling.delayMinutes || 10));
    runAt = new Date(now + mins * 60_000);
  } else if (s.scheduling.mode === 'schedule') {
    if (!s.scheduling.scheduledFor) throw new Error('Social Automation is set to schedule but no scheduled time was provided');
    const dt = new Date(s.scheduling.scheduledFor);
    if (Number.isNaN(dt.getTime())) throw new Error('Invalid Social Automation scheduled time');
    runAt = dt;
  }

  const accountLabel = formatSocialAccountLabel(
    'facebook',
    s.facebook.destination.type,
    s.facebook.destination.name,
    s.facebook.destination.id,
  );

  await enqueueSocialAutomationTask({
    userId,
    postId,
    platform: 'facebook',
    runAt,
    payload: { destination: s.facebook.destination, template: s.template },
    accountLabel,
  });
}

let socialAutomationWorkerStarted = false;

async function processDueSocialAutomationTasks() {
  if (!pool) return;

  const { rows: tasks } = await pool.query(
    `SELECT * FROM social_automation_tasks
     WHERE status IN ('scheduled','pending') AND run_at <= NOW()
     ORDER BY run_at ASC
     LIMIT 10`
  );

  for (const task of tasks) {
    const taskId = String((task as any).id);
    try {
      const attemptNumber = Number((task as any).attempts || 0) + 1;
      await processSocialAutomationTaskById(
        taskId,
        attemptNumber,
        getSocialAutomationMaxAttempts(String((task as any).platform || ''))
      );
    } catch (err) {
      void err;
    }
  }
}

function startSocialAutomationWorker() {
  if (socialAutomationWorkerStarted) return;
  socialAutomationWorkerStarted = true;

  setInterval(() => {
    void processDueSocialAutomationTasks().catch(() => undefined);
  }, 5000);
}

function startSocialAutomationProcessor() {
  if (!pool) return;
  if (isBullMqEnabled()) {
    void (async () => {
      try {
        await ensureBullMqSocialAutomationQueue();
        const { rows } = await pool.query(
          `SELECT id, run_at, platform FROM social_automation_tasks
           WHERE status IN ('scheduled','pending')
           ORDER BY run_at ASC
           LIMIT 200`
        );
        for (const r of rows as any[]) {
          await enqueueBullMqJob(String(r.id), String(r.run_at), String(r.platform || ''));
        }
      } catch (err) {
        console.error('[SocialAutomation] BullMQ init failed, falling back to DB worker:', err);
        startSocialAutomationWorker();
      }
    })();
    return;
  }
  startSocialAutomationWorker();
}

function renderMessageTemplate(template: string, vars: Record<string, string>) {
  const tpl = String(template || '');
  return tpl.replace(/\{([a-zA-Z0-9_]+)\}/g, (m, key) => {
    if (Object.prototype.hasOwnProperty.call(vars, key)) return vars[key] ?? '';
    return m;
  });
}

async function resolveFacebookPageToken(params: {
  userId: string;
  userAccessToken: string;
  destination?: { type?: string; id?: string; name?: string };
}) {
  const dest = params.destination || {};
  const destType = String(dest.type || '').toLowerCase();
  if (destType && destType !== 'page') {
    return null;
  }

  let desiredId = String(dest.id || '').trim();
  const desiredName = dest.name ? String(dest.name) : '';

  if (!desiredId) {
    const settings = (await getUserSettingValue(params.userId, 'posts-automation-settings')) || {};
    const rawSelected = String(settings?.selectedAccountMap?.facebook || '').trim();
    if (rawSelected.startsWith('page:')) {
      desiredId = rawSelected.slice('page:'.length).trim();
    } else if (rawSelected && !rawSelected.startsWith('group:')) {
      desiredId = rawSelected;
    }
  }

  if (pool) {
    try {
      const stored = await pool.query(
        `SELECT account_id, account_name, access_token, access_token_encrypted
         FROM social_accounts
         WHERE user_id=$1 AND platform='facebook' AND account_type='page' AND connected=true
         ${desiredId ? 'AND account_id=$2' : ''}
         ORDER BY created_at DESC
         LIMIT 1`,
        desiredId ? [params.userId, desiredId] : [params.userId]
      );
      const storedRow: any = stored.rows[0] || {};
      let decrypted = '';
      if (storedRow?.access_token_encrypted) {
        try {
          decrypted = decryptIntegrationSecret(String(storedRow.access_token_encrypted));
        } catch {
          decrypted = '';
        }
      }
      const pageToken = String(decrypted || storedRow?.access_token || '').trim();
      const pageId = String(storedRow?.account_id || '').trim();
      const pageName = String(storedRow?.account_name || '').trim();
      if (pageId && pageToken) {
        return { pageId, pageToken, pageName: pageName || desiredName || undefined };
      }
    } catch {
      // ignore; fallback to /me/accounts lookup
    }
  }

  const graphBase = 'https://graph.facebook.com/v19.0';
  const pagesResp = await axios.get(`${graphBase}/me/accounts?access_token=${encodeURIComponent(params.userAccessToken)}`, {
    validateStatus: () => true,
    timeout: 15000,
  });
  const pagesData: any = pagesResp.data || {};
  if (pagesResp.status >= 400) {
    throw new Error(pagesData?.error?.message || `Facebook API error ${pagesResp.status}`);
  }
  const pages: any[] = Array.isArray(pagesData?.data) ? pagesData.data : [];
  const page = desiredId ? pages.find((p: any) => String(p?.id || '').trim() === desiredId) : pages[0];
  const pageId = String(page?.id || '').trim();
  const pageToken = String(page?.access_token || '').trim();
  if (!pageId || !pageToken) return null;
  return { pageId, pageToken, pageName: String(page?.name || '').trim() || desiredName || undefined };
}

// Helper: publish a blog post to a single platform, return result
async function publishToplatform(
  userId: string,
  post: Record<string, any>,
  platform: string,
  options?: { template?: string; destination?: any }
): Promise<{ status: string; platformPostId?: string; error?: string; retryable?: boolean }> {
  try {
    const platformId = normalizePlatformId(platform);
    if (platformId === 'wordpress') {
      const conn = await getWordPressConnection(userId);
      if (!conn) throw new Error('WordPress not connected');
      const appPassword = decryptWordPressPassword(conn.appPasswordEncrypted);
      const postPayload: Record<string, any> = {
        title: post.title || '',
        content: post.content || '',
        status: post.status === 'published' ? 'publish' : 'draft',
        excerpt: post.excerpt || '',
        slug: post.slug || '',
      };
      const { data: wpData, status: wpStatus, error: wpError } = await wpRequest(
        conn.siteUrl, conn.username, appPassword, 'POST', '/wp/v2/posts', { data: postPayload }
      );
      if (wpStatus !== 201 && wpStatus !== 200) throw new Error(wpError || 'WordPress publish failed');
      const postId = wpData?.id;
      if (postId && (post.meta_title || post.meta_description || post.focus_keyword)) {
        const meta: Record<string, string> = {};
        if (post.meta_title) { meta._yoast_wpseo_title = post.meta_title; meta.rank_math_title = post.meta_title; }
        if (post.meta_description) { meta._yoast_wpseo_metadesc = post.meta_description; meta.rank_math_description = post.meta_description; }
        if (post.focus_keyword) { meta._yoast_wpseo_focuskw = post.focus_keyword; meta.rank_math_focus_keyword = post.focus_keyword; }
        await wpRequest(conn.siteUrl, conn.username, appPassword, 'POST', `/wp/v2/posts/${postId}`, { data: { meta } });
      }
      await logIntegrationEvent({
        userId,
        integrationSlug: 'wordpress',
        eventType: 'post_published',
        status: 'success',
        response: { postId: postId || null },
      });
      return { status: 'published', platformPostId: String(wpData?.id || '') };
    }

    const conn = await getPublishableSocialConnection(userId, platformId);
    if (!conn) throw new Error(`${platform} is not connected`);
    if (conn.needs_reapproval) {
      return { status: 'failed', error: `${platform} connection needs re-approval. Please reconnect.`, retryable: false };
    }
    const { access_token, token_data } = conn;
    if (!access_token) throw new Error(`${platform} access token missing - please reconnect`);

    const PLATFORM_NAMES: Record<string, string> = {
      linkedin: 'LinkedIn', twitter: 'Twitter / X', facebook: 'Facebook',
      instagram: 'Instagram', threads: 'Threads', tiktok: 'TikTok',
      pinterest: 'Pinterest',
    };
    const platformName = PLATFORM_NAMES[platformId] || platformId;

    const postUrl = buildPostUrl(post);
    const featuredImage = await resolveBlogPostFeaturedImageUrl(userId, post);

    let author = '';
    try {
      if (pool) {
        const u = await pool.query('SELECT full_name, username FROM users WHERE id=$1', [userId]);
        const row: any = u.rows[0] || {};
        author = String(row.full_name || row.username || '').trim();
      }
    } catch {
      author = '';
    }

    const maxLenByPlatform: Record<string, number> = {
      twitter: 280,
      instagram: 2200,
      linkedin: 3000,
      facebook: 63206,
    };
    const maxLen = maxLenByPlatform[platformId] || 3000;
    const customTemplate = String(options?.template || '').trim();
    const title = String(post.title || '').trim();
    // Truncate excerpt to a concise social-friendly length; avoid dumping the full post body
    const rawExcerpt = String(post.excerpt || '').trim();
    const socialExcerpt = rawExcerpt.length > 280
      ? rawExcerpt.slice(0, 277) + '…'
      : rawExcerpt;
    // Don't duplicate: only include excerpt if it differs from the title
    const fallbackCaption = socialExcerpt && socialExcerpt !== title ? socialExcerpt : '';
    const fallbackHashtags = toHashtags((post as any).tag_names);
    const fallbackTextParts = [
      title,
      fallbackCaption,
      fallbackHashtags,
      postUrl,
      // Note: featuredImage is passed as media, NOT embedded in the caption text
    ].filter(Boolean);

    const text =
      (customTemplate
        ? renderMessageTemplate(customTemplate, {
            title: String(post.title || ''),
            excerpt: String(post.excerpt || ''),
            url: postUrl,
            featured_image: featuredImage,
            author: author,
          })
        : fallbackTextParts.join('\n\n')
      ).trim().slice(0, maxLen);

    if (platformId === 'instagram') {
      const igUserId = String(conn.account_id || '').trim();
      if (!igUserId) {
        return { status: 'failed', error: 'Instagram is not connected. Select an Instagram Business account under Integrations -> Instagram.' };
      }
      if (!featuredImage || !/^https?:\/\//i.test(featuredImage)) {
        return { status: 'failed', error: 'Instagram publishing requires a public image URL. Set a featured image first.' };
      }

      const instagramPost: PostObject = {
        type: 'FEED_POST',
        content: { text },
        media: [{ url: featuredImage, type: 'image' }],
      };
      const validation = instagramBusinessPlatform.validate(instagramPost);
      if (!validation.ok) {
        return { status: 'failed', error: validation.error };
      }

      await acquirePlatformSlot('instagram');
      const instagramCfg = await getPlatformConfig('instagram');
      const facebookCfg = await getPlatformConfig('facebook');
      const result = await instagramBusinessPlatform.post(instagramPost, {
        accessToken: access_token,
        accountId: conn.account_id,
        accountName: conn.account_name,
        tokenData: token_data,
        helpers: {
          graphBase: META_GRAPH_BASE,
          appId: String(instagramCfg.appId || facebookCfg.appId || process.env.VITE_FACEBOOK_APP_ID || '').trim() || undefined,
          appSecret: String(instagramCfg.appSecret || facebookCfg.appSecret || process.env.FACEBOOK_APP_SECRET || '').trim() || undefined,
        },
      });

      if (result.status === 'published') {
        await logIntegrationEvent({
          userId,
          integrationSlug: 'instagram',
          eventType: 'post_published',
          status: 'success',
          response: {
            platformPostId: result.platformPostId || null,
            instagramId: conn.account_id || null,
            pageId: token_data?.pageId || null,
          },
        });
      }

      return {
        status: result.status,
        platformPostId: result.platformPostId,
        error: result.error,
        retryable: result.retryable,
      };
    }

    if (platformId === 'pinterest') {
      if (!featuredImage || !/^https?:\/\//i.test(featuredImage)) {
        return { status: 'failed', error: 'Pinterest publishing requires a public image URL. Set a featured image first.' };
      }

      const destination = options?.destination && typeof options.destination === 'object'
        ? (options.destination as any)
        : undefined;

      let boardId = destination?.type === 'board' ? String(destination.id || '').trim() || null : null;

      // Preferred: user-configured default board (set from Analytics -> Pinterest)
      if (!boardId) {
        try {
          const defaultBoardSetting = await getUserSettingValue(userId, 'pinterest.default_board');
          const obj = safeJsonObject(defaultBoardSetting);
          const savedBoardId = String(obj?.id || obj?.board_id || '').trim();
          if (savedBoardId) boardId = savedBoardId;
        } catch {
          // ignore
        }
      }

      // Back-compat: previously saved boards (Integrations -> Pinterest -> Manage)
      if (!boardId && pool) {
        const boardRows = await pool.query(
          `SELECT account_id
           FROM social_accounts
           WHERE user_id=$1 AND platform='pinterest' AND account_type='board' AND connected=true
           ORDER BY created_at DESC
           LIMIT 1`,
          [userId]
        );
        boardId = boardRows.rows[0]?.account_id ? String(boardRows.rows[0].account_id).trim() : null;
      }

      // Last resort: pick the first available board from the Pinterest API (and store it as default)
      if (!boardId) {
        try {
          const boardsResp = await axios.get('https://api.pinterest.com/v5/boards', {
            headers: { Authorization: `Bearer ${access_token}` },
            params: { page_size: 1 },
            validateStatus: () => true,
            timeout: 15000,
          });
          const boardsData: any = boardsResp.data || {};
          if (boardsResp.status < 400) {
            const first = Array.isArray(boardsData?.items) ? boardsData.items[0] : null;
            const firstId = first?.id ? String(first.id).trim() : '';
            const firstName = first?.name ? String(first.name).trim() : '';
            if (firstId) {
              boardId = firstId;
              if (pool) {
                await pool
                  .query(
                    `INSERT INTO user_settings (user_id, key, value, created_at, updated_at)
                     VALUES ($1, 'pinterest.default_board', $2::jsonb, NOW(), NOW())
                     ON CONFLICT (user_id, key) DO UPDATE SET
                       value = EXCLUDED.value,
                       updated_at = NOW()`,
                    [userId, JSON.stringify({ id: firstId, name: firstName || null })]
                  )
                  .catch(() => undefined);
              }
            }
          }
        } catch {
          // ignore
        }
      }

      if (!boardId) {
        return {
          status: 'failed',
          error: 'No Pinterest board selected. Pick a default board in Analytics → Pinterest, or create a board on Pinterest first.',
        };
      }

      const pinBody: any = {
        board_id: boardId,
        title: String(post.title || '').trim().slice(0, 100) || 'New post',
        description: String(post.excerpt || '').trim().slice(0, 500),
        link: postUrl || undefined,
        media_source: { source_type: 'image_url', url: featuredImage },
      };

      const pinResp = await axios.post('https://api.pinterest.com/v5/pins', pinBody, {
        headers: { Authorization: `Bearer ${access_token}` },
        validateStatus: () => true,
        timeout: 20000,
      });
      const pinData: any = pinResp.data || {};
      if (pinResp.status >= 400) {
        let msg = pinData?.message || pinData?.error || `Pinterest API error ${pinResp.status}`;
        if (typeof msg === 'string' && msg.includes('boards:write')) {
          msg = 'Pinterest permission missing: boards:write. Reconnect Pinterest in Integrations, then try again.';
        }
        return { status: 'failed', error: msg };
      }
      const pinId = String(pinData?.id || '').trim();
      await logIntegrationEvent({
        userId,
        integrationSlug: 'pinterest',
        eventType: 'post_published',
        status: 'success',
        response: { platformPostId: pinId || null, boardId },
      });
      return { status: 'published', platformPostId: pinId || '' };
    }

    if (platformId === 'linkedin') {
      const destination = options?.destination && typeof options.destination === 'object'
        ? (options.destination as any)
        : undefined;
      const linkedinPost: PostObject = {
        type: 'UGC_POST',
        content: { text },
        destination: destination ? {
          type: destination.type,
          id: destination.id,
          name: destination.name,
        } : undefined,
        media: featuredImage && (/^https?:\/\//i.test(featuredImage) || featuredImage.startsWith('data:'))
          ? [{ url: featuredImage, type: 'image' }]
          : undefined,
      };

      const validation = linkedInPlatform.validate(linkedinPost);
      if (!validation.ok) {
        return { status: 'failed', error: validation.error };
      }

      await acquirePlatformSlot('linkedin');
      const result = await linkedInPlatform.post(linkedinPost, {
        accessToken: access_token,
        accountId: conn.account_id,
        accountName: conn.account_name,
        tokenData: token_data,
        helpers: {
          resolveAuthorUrn: async (ctx: any) => {
            if (destination?.type === 'page') {
              const organizationId = String(destination.id || '').trim();
              if (!organizationId) return null;
              return `urn:li:organization:${organizationId}`;
            }
            return resolveLinkedInAuthorUrn({ userId, accessToken: ctx.accessToken });
          },
        },
      });

      if (result.status === 'published') {
        await logIntegrationEvent({
          userId,
          integrationSlug: 'linkedin',
          eventType: 'post_published',
          status: 'success',
          response: {
            platformPostId: result.platformPostId || null,
            destinationType: destination?.type || 'profile',
            destinationId: destination?.id || null,
          },
        });
      }

      return { status: result.status, platformPostId: result.platformPostId, error: result.error, retryable: result.retryable };
    }

    if (platformId === 'twitter') {
      if (TWITTER_MONTHLY_WRITE_LIMIT > 0) {
        const counter = await incrementPlatformMonthlyCounter('twitter', TWITTER_MONTHLY_WRITE_LIMIT);
        if (!counter.allowed) {
          return { status: 'failed', error: 'X posting paused: global monthly limit reached.', retryable: false };
        }
      }

      const twitterPost: PostObject = {
        type: 'TWEET',
        content: { text: text.slice(0, 280) },
        ...(featuredImage ? { media: [{ url: featuredImage, type: 'image' }] } : {}),
      };

      const validation = twitterXPlatform.validate(twitterPost);
      if (!validation.ok) {
        return { status: 'failed', error: validation.error };
      }

      await acquirePlatformSlot('twitter');
      const result = await twitterXPlatform.post(twitterPost, {
        accessToken: access_token,
        accountId: conn.account_id,
        accountName: conn.account_name,
        tokenData: token_data,
      });

      if (result.status === 'published') {
        await logIntegrationEvent({
          userId,
          integrationSlug: 'twitter',
          eventType: 'post_published',
          status: 'success',
          response: { platformPostId: result.platformPostId || null },
        });
      } else {
        await logIntegrationEvent({
          userId,
          integrationSlug: 'twitter',
          eventType: 'post_publish_failed',
          status: 'error',
          response: { error: result.error || 'Twitter publish failed' },
        });
      }

      return { status: result.status, platformPostId: result.platformPostId, error: result.error, retryable: result.retryable };
    }

    if (platformId === 'facebook') {
      const destination = options?.destination && typeof options.destination === 'object'
        ? (options.destination as any)
        : undefined;

      if (destination?.type && destination.type !== 'page') {
        return { status: 'failed', error: 'Facebook Pages only. Groups and profiles are not supported.', retryable: false };
      }

      const media = featuredImage && (/^https?:\/\//i.test(featuredImage) || featuredImage.startsWith('data:'))
        ? [{ url: featuredImage, type: 'image' as const }]
        : undefined;

      const facebookPost: PostObject = {
        type: 'FEED_POST',
        content: { text, link: postUrl || undefined },
        destination: destination ? {
          type: destination.type,
          id: destination.id,
          name: destination.name,
        } : undefined,
        media,
      };

      await acquirePlatformSlot('facebook');
      const result = await facebookPagesPlatform.post(facebookPost, {
        accessToken: access_token,
        accountId: conn.account_id,
        accountName: conn.account_name,
        tokenData: token_data,
        helpers: {
          graphBase: 'https://graph.facebook.com/v19.0',
          resolvePageToken: async (dest: any) => resolveFacebookPageToken({
            userId,
            userAccessToken: access_token,
            destination: dest,
          }),
        },
      });

      if (result.status === 'published') {
        await logIntegrationEvent({
          userId,
          integrationSlug: 'facebook',
          eventType: 'post_published',
          status: 'success',
          response: { platformPostId: result.platformPostId || null },
        });
      }

      return { status: result.status, platformPostId: result.platformPostId, error: result.error, retryable: result.retryable };
    }

    if (platformId === 'threads') {
      const threadsBase = 'https://graph.threads.net/v1.0';
      let threadsUserId = String(token_data?.user_id || token_data?.userId || token_data?.id || '').trim();
      if (!threadsUserId) {
        const meResp = await axios.get(`${threadsBase}/me?fields=id&access_token=${encodeURIComponent(access_token)}`, {
          validateStatus: () => true,
          timeout: 15000,
        });
        const meData: any = meResp.data || {};
        if (meResp.status >= 400) {
          throw new Error(meData?.error?.message || `Threads profile lookup failed (${meResp.status})`);
        }
        threadsUserId = String(meData?.id || '').trim();
      }
      if (!threadsUserId) throw new Error('Threads user id not available');

      const createParams = new URLSearchParams({
        media_type: featuredImage ? 'IMAGE' : 'TEXT',
        text,
        ...(featuredImage ? { image_url: featuredImage } : {}),
        access_token: access_token,
      });
      const createResp = await axios.post(
        `${threadsBase}/${encodeURIComponent(threadsUserId)}/threads`,
        createParams.toString(),
        {
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
          validateStatus: () => true,
          timeout: 15000,
        }
      );
      const createData: any = createResp.data || {};
      if (createResp.status >= 400) {
        throw new Error(createData?.error?.message || `Threads create error ${createResp.status}`);
      }
      const creationId = String(createData?.id || '').trim();
      if (!creationId) throw new Error('Threads creation id missing');

      const publishParams = new URLSearchParams({
        creation_id: creationId,
        access_token: access_token,
      });
      const pubResp = await axios.post(
        `${threadsBase}/${encodeURIComponent(threadsUserId)}/threads_publish`,
        publishParams.toString(),
        {
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
          validateStatus: () => true,
          timeout: 15000,
        }
      );
      const pubData: any = pubResp.data || {};
      if (pubResp.status >= 400) {
        const msg = pubData?.error?.message || `Threads publish error ${pubResp.status}`;
        return { status: 'pending', error: msg };
      }
      return { status: 'published', platformPostId: String(pubData?.id || '') };
    }

    if (platformId === 'tiktok') {
      // Step 1: Query creator info to get posting capabilities
      const creatorResp = await axios.get(
        'https://open.tiktokapis.com/v2/post/publish/creator_info/query/',
        {
          headers: { Authorization: `Bearer ${access_token}`, 'Content-Type': 'application/json; charset=UTF-8' },
          validateStatus: () => true,
          timeout: 15000,
        }
      );
      const creatorData: any = creatorResp.data || {};
      if (creatorResp.status >= 400) {
        const msg = creatorData?.error?.message || `TikTok creator info failed (${creatorResp.status})`;
        return { status: 'failed', error: msg, retryable: creatorResp.status >= 500 };
      }
      const creatorInfo = creatorData?.data || {};
      const privacyOptions: string[] = Array.isArray(creatorInfo?.privacy_level_options)
        ? creatorInfo.privacy_level_options
        : ['PUBLIC_TO_EVERYONE'];
      const privacyLevel = privacyOptions.includes('PUBLIC_TO_EVERYONE')
        ? 'PUBLIC_TO_EVERYONE'
        : privacyOptions[0] || 'PUBLIC_TO_EVERYONE';
      const duetDisabled  = creatorInfo?.duet_disabled  ?? false;
      const stitchDisabled = creatorInfo?.stitch_disabled ?? false;
      const commentDisabled = creatorInfo?.comment_disabled ?? false;
      const maxVideoDuration = Number(creatorInfo?.max_video_post_duration_sec || 60);

      // Step 2: Initialize post — photo post if image available, otherwise text-to-video (draft)
      const postCaption = text.slice(0, 2200); // TikTok caption limit

      if (featuredImage) {
        // Photo post flow
        const initBody = {
          post_info: {
            title: postCaption,
            privacy_level: privacyLevel,
            disable_duet: duetDisabled,
            disable_stitch: stitchDisabled,
            disable_comment: commentDisabled,
          },
          source_info: {
            source: 'PULL_FROM_URL',
            photo_images: [featuredImage],
            photo_cover_index: 0,
          },
          post_mode: 'DIRECT_POST',
          media_type: 'PHOTO',
        };
        const initResp = await axios.post(
          'https://open.tiktokapis.com/v2/post/publish/content/init/',
          initBody,
          {
            headers: { Authorization: `Bearer ${access_token}`, 'Content-Type': 'application/json; charset=UTF-8' },
            validateStatus: () => true,
            timeout: 20000,
          }
        );
        const initData: any = initResp.data || {};
        if (initResp.status >= 400) {
          const msg = initData?.error?.message || `TikTok photo post init failed (${initResp.status})`;
          return { status: 'failed', error: msg, retryable: initResp.status >= 500 };
        }
        const publishId = String(initData?.data?.publish_id || '').trim();
        if (!publishId) return { status: 'failed', error: 'TikTok did not return a publish_id' };
        await logIntegrationEvent({ userId, integrationSlug: 'tiktok', eventType: 'post_published', status: 'success', response: { publishId } });
        return { status: 'published', platformPostId: publishId };
      }

      // No image — send as draft video so user can finish in TikTok app
      const draftBody = {
        post_info: {
          title: postCaption,
          privacy_level: 'SELF_ONLY', // draft always goes to self
          disable_duet: true,
          disable_stitch: true,
          disable_comment: false,
        },
        source_info: { source: 'FILE_UPLOAD', video_size: 0, chunk_size: 0, total_chunk_count: 1 },
        post_mode: 'UPLOAD_TO_DRAFT',
        media_type: 'VIDEO',
      };
      const draftResp = await axios.post(
        'https://open.tiktokapis.com/v2/post/publish/inbox/video/init/',
        draftBody,
        {
          headers: { Authorization: `Bearer ${access_token}`, 'Content-Type': 'application/json; charset=UTF-8' },
          validateStatus: () => true,
          timeout: 20000,
        }
      );
      const draftData: any = draftResp.data || {};
      if (draftResp.status >= 400) {
        const msg = draftData?.error?.message || `TikTok draft init failed (${draftResp.status})`;
        return { status: 'failed', error: msg, retryable: draftResp.status >= 500 };
      }
      const draftPublishId = String(draftData?.data?.publish_id || '').trim();
      await logIntegrationEvent({ userId, integrationSlug: 'tiktok', eventType: 'post_drafted', status: 'success', response: { publishId: draftPublishId, note: 'Text-only post sent as TikTok draft — open TikTok app to finish and post' } });
      // Return as published with a note so the user knows to check their TikTok drafts
      return {
        status: 'published',
        platformPostId: draftPublishId,
        error: 'Sent to TikTok drafts (text-only posts must be completed in the TikTok app)',
      };
    }

    console.log(`[Distribution] ${platformName}: token available, platform publishing not yet implemented`);
    return { status: 'failed', error: `${platformName} publishing is not implemented yet` };
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Unknown error';
    return { status: 'failed', error: msg, retryable: /timeout|ECONN|network/i.test(msg) };
  }
}

// GET /api/distribution/connected
app.get('/api/distribution/connected', async (req: Request, res: Response) => {
  try {
    const auth = await requireAuth(req, res);
    if (!auth) return;
    const visiblePlatforms = await getVisibleUserPlatformSlugs();

    const platforms: { id: string; name: string }[] = [];

    const wpRows = await pool!.query('SELECT id FROM wordpress_connections WHERE user_id=$1', [auth.userId]);
    if (wpRows.rows.length > 0) platforms.push({ id: 'wordpress', name: 'WordPress' });

    const socialRows = await pool!.query(
      'SELECT platform FROM social_accounts WHERE user_id=$1 AND connected=true', [auth.userId]
    );
    const SOCIAL_NAMES: Record<string, string> = {
      instagram: 'Instagram', facebook: 'Facebook', linkedin: 'LinkedIn',
      twitter: 'Twitter / X', tiktok: 'TikTok', threads: 'Threads',
      pinterest: 'Pinterest',
    };
    const seen = new Set<string>();
    for (const row of socialRows.rows) {
      const id = normalizePlatformId(row.platform);
      if (!id || !SOCIAL_NAMES[id] || seen.has(id)) continue;
      if (visiblePlatforms.length > 0 && !visiblePlatforms.includes(id)) continue;
      seen.add(id);
      platforms.push({ id, name: SOCIAL_NAMES[id] });
    }

    return res.json({ success: true, platforms });
  } catch {
    return res.status(500).json({ success: false, error: 'Failed to fetch connected platforms' });
  }
});

// POST /api/distribution/publish
app.post('/api/distribution/publish', async (req: Request, res: Response) => {
  try {
    const auth = await requireAuth(req, res);
    if (!auth) return;

    const { postId, platforms } = req.body as { postId: string; platforms: string[] };
    if (!postId || !Array.isArray(platforms) || platforms.length === 0) {
      return res.status(400).json({ success: false, error: 'postId and platforms required' });
    }

    const postRows = await pool!.query(
      `SELECT p.*,
        ARRAY(SELECT t.name FROM blog_tags t JOIN blog_post_tags pt ON pt.tag_id=t.id WHERE pt.post_id=p.id) AS tag_names
       FROM blog_posts p
       WHERE p.id=$1 AND p.user_id=$2`,
      [postId, auth.userId]
    );
    if (!postRows.rows.length) return res.status(404).json({ success: false, error: 'Post not found' });
    const post = postRows.rows[0];

    const results: { platform: string; status: string; error?: string; platformPostId?: string }[] = [];
    for (const platform of platforms) {
      const platformId = normalizePlatformId(platform);
      if (!platformId) {
        results.push({ platform: String(platform), status: 'failed', error: 'Invalid platform' });
        continue;
      }
      const result = await publishToplatform(auth.userId, post, platformId);
      const logId = randomUUID();
      await pool!.query(
        'INSERT INTO publishing_logs (id,post_id,user_id,platform,status,platform_post_id,error_message,posted_at) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)',
        [logId, postId, auth.userId, platformId, result.status, result.platformPostId || null, result.error || null, result.status === 'published' ? new Date().toISOString() : null]
      );
      results.push({ platform: platformId, ...result });
    }

    return res.json({ success: true, results });
  } catch {
    return res.status(500).json({ success: false, error: 'Distribution failed' });
  }
});

// GET /api/distribution/status/:postId
app.get('/api/distribution/status/:postId', async (req: Request, res: Response) => {
  try {
    const auth = await requireAuth(req, res);
    if (!auth) return;
    const { postId } = req.params;
    const { rows } = await pool!.query(
      'SELECT * FROM publishing_logs WHERE post_id=$1 AND user_id=$2 ORDER BY created_at DESC',
      [postId, auth.userId]
    );
    return res.json({ success: true, logs: rows });
  } catch {
    return res.status(500).json({ success: false, error: 'Failed to fetch status' });
  }
});

// GET /api/automation/logs
app.get('/api/automation/logs', async (req: Request, res: Response) => {
  try {
    const auth = await requireAuth(req, res);
    if (!auth) return;
    const { rows } = await pool!.query(
      `SELECT l.*, p.title as post_title FROM publishing_logs l
       LEFT JOIN blog_posts p ON p.id = l.post_id
       WHERE l.user_id=$1 ORDER BY l.created_at DESC LIMIT 200`,
      [auth.userId]
    );
    return res.json({ success: true, logs: rows });
  } catch {
    return res.status(500).json({ success: false, error: 'Failed to fetch logs' });
  }
});

// POST /api/automation/retry/:logId
app.post('/api/automation/retry/:logId', async (req: Request, res: Response) => {
  try {
    const auth = await requireAuth(req, res);
    if (!auth) return;
    const { logId } = req.params;
    const logRows = await pool!.query('SELECT * FROM publishing_logs WHERE id=$1 AND user_id=$2', [logId, auth.userId]);
    if (!logRows.rows.length) return res.status(404).json({ success: false, error: 'Log not found' });
    const log = logRows.rows[0];
    const postRows = await pool!.query(
      `SELECT p.*,
        ARRAY(SELECT t.name FROM blog_tags t JOIN blog_post_tags pt ON pt.tag_id=t.id WHERE pt.post_id=p.id) AS tag_names
       FROM blog_posts p
       WHERE p.id=$1 AND p.user_id=$2`,
      [log.post_id, auth.userId]
    );
    if (!postRows.rows.length) return res.status(404).json({ success: false, error: 'Post not found' });
    const platformId = normalizePlatformId(log.platform);
    const result = await publishToplatform(auth.userId, postRows.rows[0], platformId);
    await pool!.query(
      'UPDATE publishing_logs SET status=$1, platform_post_id=$2, error_message=$3 WHERE id=$4',
      [result.status, result.platformPostId || null, result.error || null, logId]
    );
    return res.json({ success: true, result });
  } catch {
    return res.status(500).json({ success: false, error: 'Retry failed' });
  }
});

// ═════════ Meta Data Deletion (Facebook requirement) ═════════

const base64UrlToBuffer = (value: string): Buffer => {
  const normalized = value.replace(/-/g, '+').replace(/_/g, '/');
  const padded = normalized.padEnd(normalized.length + ((4 - (normalized.length % 4)) % 4), '=');
  return Buffer.from(padded, 'base64');
};

const parseSignedRequest = (signedRequest: string, appSecret: string): Record<string, unknown> => {
  const parts = String(signedRequest || '').split('.');
  if (parts.length !== 2) throw new Error('Invalid signed_request');
  const [encodedSig, encodedPayload] = parts;

  const sig = base64UrlToBuffer(encodedSig);
  const expected = createHmac('sha256', appSecret).update(encodedPayload).digest();

  if (sig.length !== expected.length || !timingSafeEqual(sig, expected)) {
    throw new Error('Invalid signed_request signature');
  }

  const payloadJson = base64UrlToBuffer(encodedPayload).toString('utf8');
  const payload = JSON.parse(payloadJson) as Record<string, unknown>;
  return payload;
};

const getMetaAppSecretForDeletion = async (): Promise<string> => {
  const envSecret =
    (process.env.FACEBOOK_APP_SECRET || '').trim() ||
    (process.env.META_APP_SECRET || '').trim();
  if (envSecret) return envSecret;
  const cfg = await getPlatformConfig('facebook').catch(() => ({} as any));
  return String((cfg as any)?.appSecret || '').trim();
};

const createDeletionRequestRecord = async (
  code: string,
  metaUserId: string | null,
  payload: Record<string, unknown>,
): Promise<DataDeletionRecord> => {
  const record: DataDeletionRecord = {
    code,
    metaUserId,
    status: 'received',
    createdAt: new Date().toISOString(),
    completedAt: null,
  };

  if (!hasDatabase()) {
    inMemoryDataDeletionRequests.set(code, record);
    return record;
  }

  await dbQuery(
    `INSERT INTO data_deletion_requests (code, platform, meta_user_id, status, payload, created_at)
     VALUES ($1, 'meta', $2, 'received', $3::jsonb, NOW())
     ON CONFLICT (code) DO NOTHING`,
    [code, metaUserId, JSON.stringify(payload ?? {})],
  );

  return record;
};

const updateDeletionRequestStatus = async (code: string, status: DataDeletionStatus) => {
  if (!hasDatabase()) {
    const existing = inMemoryDataDeletionRequests.get(code);
    if (!existing) return;
    const completedAt = status === 'completed' ? new Date().toISOString() : null;
    inMemoryDataDeletionRequests.set(code, { ...existing, status, completedAt });
    return;
  }

  if (status === 'completed') {
    await dbQuery(
      `UPDATE data_deletion_requests
       SET status = $2, completed_at = NOW()
       WHERE code = $1`,
      [code, status],
    );
    return;
  }

  await dbQuery('UPDATE data_deletion_requests SET status = $2 WHERE code = $1', [code, status]);
};

const getDeletionRequest = async (code: string): Promise<DataDeletionRecord | null> => {
  if (!code) return null;
  if (!hasDatabase()) return inMemoryDataDeletionRequests.get(code) ?? null;
  const result = await dbQuery(
    `SELECT code, meta_user_id, status, created_at, completed_at
     FROM data_deletion_requests
     WHERE code = $1`,
    [code],
  );
  const row = result.rows[0] as any;
  if (!row) return null;
  return {
    code: String(row.code),
    metaUserId: row.meta_user_id ? String(row.meta_user_id) : null,
    status: (String(row.status || 'received') as DataDeletionStatus) || 'received',
    createdAt: new Date(row.created_at).toISOString(),
    completedAt: row.completed_at ? new Date(row.completed_at).toISOString() : null,
  };
};

const deleteBestEffortUserDataByMetaUserId = async (metaUserId: string): Promise<boolean> => {
  if (!metaUserId || !hasDatabase()) return false;

  let deleted = false;

  // 1) If the user originally logged in via Facebook without email, we created a synthetic email.
  const syntheticEmail = `fb_${metaUserId}@facebook.social`;
  const userRows = await dbQuery('SELECT id FROM users WHERE email = $1', [syntheticEmail]);
  if (userRows.rows.length > 0) {
    const userId = String((userRows.rows[0] as any).id);
    const delUser = await dbQuery('DELETE FROM users WHERE id = $1', [userId]);
    deleted = deleted || delUser.rowCount > 0;
  }

  // 2) Also remove any connected accounts where token payload contains a matching user_id.
  const delAccounts = await dbQuery(
    `DELETE FROM social_accounts
     WHERE token_data->>'user_id' = $1`,
    [metaUserId],
  );
  deleted = deleted || delAccounts.rowCount > 0;

  return deleted;
};

// POST /api/meta/data-deletion — Meta "Data Deletion Request URL"
app.post('/api/meta/data-deletion', async (req: Request, res: Response) => {
  try {
    const signedRequest = String((req.body as any)?.signed_request || '').trim();
    if (!signedRequest) return res.status(400).json({ success: false, error: 'signed_request required' });

    const appSecret = await getMetaAppSecretForDeletion();
    if (!appSecret) return res.status(500).json({ success: false, error: 'Meta app secret not configured' });

    const payload = parseSignedRequest(signedRequest, appSecret);
    const metaUserId = typeof payload.user_id === 'string' ? payload.user_id : null;

    const confirmationCode = randomUUID();
    await createDeletionRequestRecord(confirmationCode, metaUserId, payload);

    if (metaUserId) {
      const deleted = await deleteBestEffortUserDataByMetaUserId(metaUserId).catch(() => false);
      if (deleted) await updateDeletionRequestStatus(confirmationCode, 'completed');
    }

    const FRONTEND_URL = process.env.VITE_APP_URL || process.env.FRONTEND_URL || 'https://marketing.dakyworld.com';
    const statusUrl = `${FRONTEND_URL.replace(/\/$/, '')}/data-deletion?code=${encodeURIComponent(confirmationCode)}`;

    // Meta expects: { url, confirmation_code }
    return res.json({ url: statusUrl, confirmation_code: confirmationCode });
  } catch (error) {
    console.error('Meta data deletion error:', error);
    return res.status(400).json({ success: false, error: error instanceof Error ? error.message : 'Invalid request' });
  }
});

// GET /api/meta/data-deletion/status?code=... — used by our public status page
app.get('/api/meta/data-deletion/status', async (req: Request, res: Response) => {
  try {
    const code = String((req.query as any)?.code || '').trim();
    if (!code) return res.status(400).json({ success: false, error: 'code required' });

    const record = await getDeletionRequest(code);
    if (!record) return res.status(404).json({ success: false, error: 'Not found' });

    return res.json({
      success: true,
      data: {
        code: record.code,
        status: record.status,
        createdAt: record.createdAt,
        completedAt: record.completedAt,
      },
    });
  } catch (error) {
    console.error('Meta deletion status error:', error);
    return res.status(500).json({ success: false, error: 'Failed to load status' });
  }
});

// Meta Deauthorize Callback (uninstall)

// POST /api/meta/deauthorize — Meta "Deauthorize Callback URL"
app.post('/api/meta/deauthorize', async (req: Request, res: Response) => {
  try {
    const signedRequest = String((req.body as any)?.signed_request || '').trim();
    if (!signedRequest) return res.status(400).json({ success: false, error: 'signed_request required' });

    const appSecret = await getMetaAppSecretForDeletion();
    if (!appSecret) return res.status(500).json({ success: false, error: 'Meta app secret not configured' });

    const payload = parseSignedRequest(signedRequest, appSecret);
    const metaUserId = typeof payload.user_id === 'string' ? payload.user_id : null;

    if (metaUserId) {
      await deleteBestEffortUserDataByMetaUserId(metaUserId).catch(() => false);
    }

    return res.json({ success: true });
  } catch (error) {
    console.error('Meta deauthorize error:', error);
    return res.status(400).json({ success: false, error: error instanceof Error ? error.message : 'Invalid request' });
  }
});

// Root route
app.get('/', (req: Request, res: Response) => {
  res.json({ message: 'OAuth Backend Server Running', version: '1.0.0' });
});

// Last-resort JSON error handler for API routes (prevents Express HTML error pages)
app.use((err: any, req: Request, res: Response, next: Function) => {
  if (res.headersSent) return next(err);
  const path = (req.originalUrl || req.url || '').toString();
  const isApi = path.startsWith('/api/');
  const accept = String(req.headers.accept || '');
  if (!isApi && !accept.includes('application/json')) return next(err);

  const status =
    err?.type === 'entity.too.large' ? 413 :
    err?.type === 'entity.parse.failed' ? 400 :
    (typeof err?.status === 'number' ? err.status : (typeof err?.statusCode === 'number' ? err.statusCode : 500));

  const message =
    status === 413 ? 'Request too large' :
    status === 400 ? 'Invalid JSON payload' :
    (err instanceof Error ? err.message : 'Internal Server Error');

  console.error('Unhandled API error:', err);
  return res.status(status).json({ success: false, error: message });
});

// ─── Mailing API Routes ───────────────────────────────────────────────────────

// GET /api/mailing/contacts
app.get('/api/mailing/contacts', async (req: Request, res: Response) => {
  try {
    const auth = requireAuth(req, res);
    if (!auth) return;
    const search = String(req.query.search || '').trim();
    const tag = String(req.query.tag || '').trim();
    let q = `SELECT c.*, COALESCE(array_agg(t.tag) FILTER (WHERE t.tag IS NOT NULL), '{}') AS tags
             FROM mailing_contacts c
             LEFT JOIN mailing_contact_tags t ON t.contact_id = c.id
             WHERE c.user_id = $1`;
    const params: any[] = [auth.userId];
    if (search) { params.push(`%${search}%`); q += ` AND (c.email ILIKE $${params.length} OR c.first_name ILIKE $${params.length} OR c.last_name ILIKE $${params.length})`; }
    if (tag) { params.push(tag); q += ` AND c.id IN (SELECT contact_id FROM mailing_contact_tags WHERE tag = $${params.length} AND user_id = $1)`; }
    q += ` GROUP BY c.id ORDER BY c.created_at DESC LIMIT 500`;
    const { rows } = await pool!.query(q, params);
    return res.json({ success: true, contacts: rows });
  } catch (err) { return res.status(500).json({ success: false, error: 'Failed to fetch contacts' }); }
});

// POST /api/mailing/contacts
app.post('/api/mailing/contacts', async (req: Request, res: Response) => {
  try {
    const auth = requireAuth(req, res);
    if (!auth) return;
    const { email, first_name, last_name, source, tags, email_marketing_consent } = req.body;
    if (!email || !String(email).includes('@')) return res.status(400).json({ success: false, error: 'Valid email required' });
    const id = randomUUID();
    const { rows } = await pool!.query(
      `INSERT INTO mailing_contacts (id, user_id, email, first_name, last_name, source, email_marketing_consent)
       VALUES ($1,$2,$3,$4,$5,$6,$7)
       ON CONFLICT (user_id, email) DO UPDATE SET first_name=EXCLUDED.first_name, last_name=EXCLUDED.last_name, updated_at=NOW()
       RETURNING *`,
      [id, auth.userId, String(email).toLowerCase().trim(), first_name || null, last_name || null, source || 'manual', !!email_marketing_consent]
    );
    const contact = rows[0];
    if (Array.isArray(tags) && tags.length) {
      for (const tag of tags) {
        await pool!.query(
          `INSERT INTO mailing_contact_tags (id, contact_id, user_id, tag) VALUES ($1,$2,$3,$4) ON CONFLICT DO NOTHING`,
          [randomUUID(), contact.id, auth.userId, String(tag).trim()]
        ).catch(() => undefined);
      }
    }
    return res.json({ success: true, contact });
  } catch (err) { return res.status(500).json({ success: false, error: 'Failed to create contact' }); }
});

// PATCH /api/mailing/contacts/:id
app.patch('/api/mailing/contacts/:id', async (req: Request, res: Response) => {
  try {
    const auth = requireAuth(req, res);
    if (!auth) return;
    const { first_name, last_name, subscribed, email_marketing_consent } = req.body;
    const { rows } = await pool!.query(
      `UPDATE mailing_contacts SET first_name=$1, last_name=$2, subscribed=$3, email_marketing_consent=$4,
       unsubscribed_at = CASE WHEN $3=false THEN NOW() ELSE NULL END, updated_at=NOW()
       WHERE id=$5 AND user_id=$6 RETURNING *`,
      [first_name || null, last_name || null, subscribed !== false, !!email_marketing_consent, req.params.id, auth.userId]
    );
    if (!rows.length) return res.status(404).json({ success: false, error: 'Contact not found' });
    return res.json({ success: true, contact: rows[0] });
  } catch (err) { return res.status(500).json({ success: false, error: 'Failed to update contact' }); }
});

// DELETE /api/mailing/contacts/:id
app.delete('/api/mailing/contacts/:id', async (req: Request, res: Response) => {
  try {
    const auth = requireAuth(req, res);
    if (!auth) return;
    await pool!.query('DELETE FROM mailing_contacts WHERE id=$1 AND user_id=$2', [req.params.id, auth.userId]);
    return res.json({ success: true });
  } catch (err) { return res.status(500).json({ success: false, error: 'Failed to delete contact' }); }
});

// GET /api/mailing/contacts/tags — list all unique tags for user
app.get('/api/mailing/contacts/tags', async (req: Request, res: Response) => {
  try {
    const auth = requireAuth(req, res);
    if (!auth) return;
    const { rows } = await pool!.query(
      `SELECT DISTINCT tag FROM mailing_contact_tags WHERE user_id=$1 ORDER BY tag`, [auth.userId]
    );
    return res.json({ success: true, tags: rows.map((r: any) => r.tag) });
  } catch (err) { return res.status(500).json({ success: false, error: 'Failed to fetch tags' }); }
});

// POST /api/mailing/contacts/import — bulk CSV import
app.post('/api/mailing/contacts/import', async (req: Request, res: Response) => {
  try {
    const auth = requireAuth(req, res);
    if (!auth) return;
    const { contacts } = req.body; // [{ email, first_name, last_name }]
    if (!Array.isArray(contacts) || !contacts.length) return res.status(400).json({ success: false, error: 'contacts array required' });
    let imported = 0, skipped = 0;
    for (const c of contacts.slice(0, 5000)) {
      if (!c.email || !String(c.email).includes('@')) { skipped++; continue; }
      await pool!.query(
        `INSERT INTO mailing_contacts (id, user_id, email, first_name, last_name)
         VALUES ($1,$2,$3,$4,$5) ON CONFLICT (user_id, email) DO NOTHING`,
        [randomUUID(), auth.userId, String(c.email).toLowerCase().trim(), c.first_name || null, c.last_name || null]
      ).then(() => imported++).catch(() => { skipped++; });
    }
    return res.json({ success: true, imported, skipped });
  } catch (err) { return res.status(500).json({ success: false, error: 'Import failed' }); }
});

// GET /api/mailing/segments
app.get('/api/mailing/segments', async (req: Request, res: Response) => {
  try {
    const auth = requireAuth(req, res);
    if (!auth) return;
    const { rows } = await pool!.query('SELECT * FROM mailing_segments WHERE user_id=$1 ORDER BY created_at DESC', [auth.userId]);
    return res.json({ success: true, segments: rows });
  } catch (err) { return res.status(500).json({ success: false, error: 'Failed to fetch segments' }); }
});

// POST /api/mailing/segments
app.post('/api/mailing/segments', async (req: Request, res: Response) => {
  try {
    const auth = requireAuth(req, res);
    if (!auth) return;
    const { name, rules } = req.body;
    if (!name) return res.status(400).json({ success: false, error: 'Name required' });
    const id = randomUUID();
    const { rows } = await pool!.query(
      `INSERT INTO mailing_segments (id, user_id, name, rules) VALUES ($1,$2,$3,$4) RETURNING *`,
      [id, auth.userId, name, JSON.stringify(rules || [])]
    );
    return res.json({ success: true, segment: rows[0] });
  } catch (err) { return res.status(500).json({ success: false, error: 'Failed to create segment' }); }
});

// PATCH /api/mailing/segments/:id
app.patch('/api/mailing/segments/:id', async (req: Request, res: Response) => {
  try {
    const auth = requireAuth(req, res);
    if (!auth) return;
    const { name, rules } = req.body;
    const { rows } = await pool!.query(
      `UPDATE mailing_segments SET name=COALESCE($1,name), rules=COALESCE($2::jsonb,rules), updated_at=NOW()
       WHERE id=$3 AND user_id=$4 RETURNING *`,
      [name || null, rules ? JSON.stringify(rules) : null, req.params.id, auth.userId]
    );
    if (!rows.length) return res.status(404).json({ success: false, error: 'Segment not found' });
    return res.json({ success: true, segment: rows[0] });
  } catch (err) { return res.status(500).json({ success: false, error: 'Failed to update segment' }); }
});

// DELETE /api/mailing/segments/:id
app.delete('/api/mailing/segments/:id', async (req: Request, res: Response) => {
  try {
    const auth = requireAuth(req, res);
    if (!auth) return;
    await pool!.query('DELETE FROM mailing_segments WHERE id=$1 AND user_id=$2', [req.params.id, auth.userId]);
    return res.json({ success: true });
  } catch (err) { return res.status(500).json({ success: false, error: 'Failed to delete segment' }); }
});

// GET /api/mailing/campaigns
app.get('/api/mailing/campaigns', async (req: Request, res: Response) => {
  try {
    const auth = requireAuth(req, res);
    if (!auth) return;
    const { rows } = await pool!.query(
      `SELECT c.*, s.name as segment_name FROM mailing_campaigns c
       LEFT JOIN mailing_segments s ON s.id = c.segment_id
       WHERE c.user_id=$1 ORDER BY c.created_at DESC`,
      [auth.userId]
    );
    return res.json({ success: true, campaigns: rows });
  } catch (err) { return res.status(500).json({ success: false, error: 'Failed to fetch campaigns' }); }
});

// POST /api/mailing/campaigns
app.post('/api/mailing/campaigns', async (req: Request, res: Response) => {
  try {
    const auth = requireAuth(req, res);
    if (!auth) return;
    const { name, subject, preview_text, content, segment_id, status, scheduled_at } = req.body;
    if (!name || !subject) return res.status(400).json({ success: false, error: 'Name and subject required' });
    const id = randomUUID();
    const { rows } = await pool!.query(
      `INSERT INTO mailing_campaigns (id, user_id, name, subject, preview_text, content, segment_id, status, scheduled_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING *`,
      [id, auth.userId, name, subject, preview_text || null, content || '', segment_id || null, status || 'draft', scheduled_at || null]
    );
    return res.json({ success: true, campaign: rows[0] });
  } catch (err) { return res.status(500).json({ success: false, error: 'Failed to create campaign' }); }
});

// PATCH /api/mailing/campaigns/:id
app.patch('/api/mailing/campaigns/:id', async (req: Request, res: Response) => {
  try {
    const auth = requireAuth(req, res);
    if (!auth) return;
    const { name, subject, preview_text, content, segment_id, status, scheduled_at } = req.body;
    const { rows } = await pool!.query(
      `UPDATE mailing_campaigns SET
         name=COALESCE($1,name), subject=COALESCE($2,subject), preview_text=$3,
         content=COALESCE($4,content), segment_id=$5, status=COALESCE($6,status),
         scheduled_at=$7, updated_at=NOW()
       WHERE id=$8 AND user_id=$9 RETURNING *`,
      [name||null, subject||null, preview_text||null, content||null, segment_id||null, status||null, scheduled_at||null, req.params.id, auth.userId]
    );
    if (!rows.length) return res.status(404).json({ success: false, error: 'Campaign not found' });
    return res.json({ success: true, campaign: rows[0] });
  } catch (err) { return res.status(500).json({ success: false, error: 'Failed to update campaign' }); }
});

// DELETE /api/mailing/campaigns/:id
app.delete('/api/mailing/campaigns/:id', async (req: Request, res: Response) => {
  try {
    const auth = requireAuth(req, res);
    if (!auth) return;
    await pool!.query('DELETE FROM mailing_campaigns WHERE id=$1 AND user_id=$2', [req.params.id, auth.userId]);
    return res.json({ success: true });
  } catch (err) { return res.status(500).json({ success: false, error: 'Failed to delete campaign' }); }
});

// GET /api/mailing/automations
app.get('/api/mailing/automations', async (req: Request, res: Response) => {
  try {
    const auth = requireAuth(req, res);
    if (!auth) return;
    const { rows } = await pool!.query('SELECT * FROM mailing_automations WHERE user_id=$1 ORDER BY created_at DESC', [auth.userId]);
    return res.json({ success: true, automations: rows });
  } catch (err) { return res.status(500).json({ success: false, error: 'Failed to fetch automations' }); }
});

// POST /api/mailing/automations
app.post('/api/mailing/automations', async (req: Request, res: Response) => {
  try {
    const auth = requireAuth(req, res);
    if (!auth) return;
    const { name, trigger_type, conditions, actions, status } = req.body;
    if (!name || !trigger_type) return res.status(400).json({ success: false, error: 'Name and trigger_type required' });
    const id = randomUUID();
    const { rows } = await pool!.query(
      `INSERT INTO mailing_automations (id, user_id, name, trigger_type, conditions, actions, status)
       VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING *`,
      [id, auth.userId, name, trigger_type, JSON.stringify(conditions||[]), JSON.stringify(actions||[]), status||'draft']
    );
    return res.json({ success: true, automation: rows[0] });
  } catch (err) { return res.status(500).json({ success: false, error: 'Failed to create automation' }); }
});

// PATCH /api/mailing/automations/:id
app.patch('/api/mailing/automations/:id', async (req: Request, res: Response) => {
  try {
    const auth = requireAuth(req, res);
    if (!auth) return;
    const { name, trigger_type, conditions, actions, status } = req.body;
    const { rows } = await pool!.query(
      `UPDATE mailing_automations SET
         name=COALESCE($1,name), trigger_type=COALESCE($2,trigger_type),
         conditions=COALESCE($3::jsonb,conditions), actions=COALESCE($4::jsonb,actions),
         status=COALESCE($5,status), updated_at=NOW()
       WHERE id=$6 AND user_id=$7 RETURNING *`,
      [name||null, trigger_type||null, conditions?JSON.stringify(conditions):null, actions?JSON.stringify(actions):null, status||null, req.params.id, auth.userId]
    );
    if (!rows.length) return res.status(404).json({ success: false, error: 'Automation not found' });
    return res.json({ success: true, automation: rows[0] });
  } catch (err) { return res.status(500).json({ success: false, error: 'Failed to update automation' }); }
});

// DELETE /api/mailing/automations/:id
app.delete('/api/mailing/automations/:id', async (req: Request, res: Response) => {
  try {
    const auth = requireAuth(req, res);
    if (!auth) return;
    await pool!.query('DELETE FROM mailing_automations WHERE id=$1 AND user_id=$2', [req.params.id, auth.userId]);
    return res.json({ success: true });
  } catch (err) { return res.status(500).json({ success: false, error: 'Failed to delete automation' }); }
});

// GET /api/mailing/analytics
app.get('/api/mailing/analytics', async (req: Request, res: Response) => {
  try {
    const auth = requireAuth(req, res);
    if (!auth) return;
    const [contactsRes, campaignsRes, eventsRes] = await Promise.all([
      pool!.query(`SELECT COUNT(*) as total, COUNT(*) FILTER (WHERE subscribed=true) as subscribed, COUNT(*) FILTER (WHERE subscribed=false) as unsubscribed FROM mailing_contacts WHERE user_id=$1`, [auth.userId]),
      pool!.query(`SELECT COUNT(*) as total, COUNT(*) FILTER (WHERE status='sent') as sent, COUNT(*) FILTER (WHERE status='draft') as draft, COUNT(*) FILTER (WHERE status='scheduled') as scheduled FROM mailing_campaigns WHERE user_id=$1`, [auth.userId]),
      pool!.query(`SELECT event_type, COUNT(*) as count FROM mailing_email_events WHERE user_id=$1 GROUP BY event_type`, [auth.userId]),
    ]);
    const eventCounts: Record<string, number> = {};
    for (const row of eventsRes.rows) eventCounts[row.event_type] = Number(row.count);
    const delivered = eventCounts['delivered'] || 0;
    return res.json({
      success: true,
      contacts: { total: Number(contactsRes.rows[0].total), subscribed: Number(contactsRes.rows[0].subscribed), unsubscribed: Number(contactsRes.rows[0].unsubscribed) },
      campaigns: { total: Number(campaignsRes.rows[0].total), sent: Number(campaignsRes.rows[0].sent), draft: Number(campaignsRes.rows[0].draft), scheduled: Number(campaignsRes.rows[0].scheduled) },
      events: eventCounts,
      rates: {
        openRate: delivered > 0 ? Math.round(((eventCounts['open'] || 0) / delivered) * 100) : 0,
        clickRate: delivered > 0 ? Math.round(((eventCounts['click'] || 0) / delivered) * 100) : 0,
        bounceRate: delivered > 0 ? Math.round(((eventCounts['bounced'] || 0) / delivered) * 100) : 0,
      },
    });
  } catch (err) { return res.status(500).json({ success: false, error: 'Failed to fetch analytics' }); }
});

// ─── End Mailing API Routes ───────────────────────────────────────────────────

// ─── Analytics & Insights Engine ─────────────────────────────────────────────

function parseAnalyticsRange(preset: string | undefined, startStr: string | undefined, endStr: string | undefined) {
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  let start: Date, end: Date, label: string;
  const p = preset || '30d';
  if (p === 'custom' && startStr && endStr) {
    start = new Date(startStr);
    end = new Date(endStr);
    label = `${startStr} – ${endStr}`;
  } else if (p === '7d') {
    start = new Date(today); start.setDate(start.getDate() - 6);
    end = today; label = 'Last 7 days';
  } else if (p === '90d') {
    start = new Date(today); start.setDate(start.getDate() - 89);
    end = today; label = 'Last 90 days';
  } else {
    start = new Date(today); start.setDate(start.getDate() - 29);
    end = today; label = 'Last 30 days';
  }
  const days = Math.round((end.getTime() - start.getTime()) / 86400000) + 1;
  const prevEnd = new Date(start); prevEnd.setDate(prevEnd.getDate() - 1);
  const prevStart = new Date(prevEnd); prevStart.setDate(prevStart.getDate() - days + 1);
  return {
    preset: p as '7d' | '30d' | '90d' | 'custom',
    start, end, label, days, prevStart, prevEnd,
    startIso: start.toISOString(),
    endIso: new Date(end.getTime() + 86399999).toISOString(),
    prevStartIso: prevStart.toISOString(),
    prevEndIso: new Date(prevEnd.getTime() + 86399999).toISOString(),
  };
}

function analyticsPlatformLabel(platform: string): string {
  const map: Record<string, string> = {
    facebook: 'Facebook', instagram: 'Instagram', twitter: 'X (Twitter)',
    linkedin: 'LinkedIn', pinterest: 'Pinterest', threads: 'Threads',
    tiktok: 'TikTok', wordpress: 'WordPress',
  };
  return map[platform?.toLowerCase()] || platform;
}

function analyticsFmtDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

// GET /api/blog/analytics/dashboard
app.get('/api/blog/analytics/dashboard', async (req: Request, res: Response) => {
  try {
    const auth = requireAuth(req, res);
    if (!auth) return;
    if (!pool) return res.status(503).json({ success: false, error: 'DB not ready' });

    const q = req.query as any;
    const range = parseAnalyticsRange(q.preset, q.start, q.end);

    const [pubRes, prevRes, metricsRes, scheduledRes, accountRes, lastSyncRes] = await Promise.all([
      pool.query(
        `SELECT platform, status, created_at, post_id, platform_post_id FROM publishing_logs
         WHERE user_id=$1 AND created_at >= $2 AND created_at <= $3`,
        [auth.userId, range.startIso, range.endIso]
      ),
      pool.query(
        `SELECT platform, status FROM publishing_logs
         WHERE user_id=$1 AND created_at >= $2 AND created_at <= $3`,
        [auth.userId, range.prevStartIso, range.prevEndIso]
      ),
      pool.query(
        `SELECT platform, platform_post_id, post_id, likes, comments, shares, impressions, reach, engagement, posted_at
         FROM social_metrics WHERE user_id=$1 AND (posted_at IS NULL OR (posted_at >= $2 AND posted_at <= $3))`,
        [auth.userId, range.startIso, range.endIso]
      ),
      pool.query(
        `SELECT COUNT(*) as cnt FROM publishing_logs WHERE user_id=$1 AND status='scheduled' AND scheduled_for > NOW()`,
        [auth.userId]
      ),
      pool.query(
        `SELECT platform, COUNT(*) as cnt, COALESCE(SUM(followers), 0) as total_followers
         FROM social_accounts WHERE user_id=$1 AND connected=true GROUP BY platform`,
        [auth.userId]
      ),
      pool.query(
        `SELECT data->>'lastSyncedAt' as ts FROM insights_cache WHERE user_id=$1 AND cache_key='last_synced' LIMIT 1`,
        [auth.userId]
      ),
    ]);

    const logs: any[] = pubRes.rows;
    const prevLogs: any[] = prevRes.rows;
    const metrics: any[] = metricsRes.rows;
    const futureScheduledCount = parseInt(scheduledRes.rows[0]?.cnt || '0');
    const lastSyncedAt: string | null = lastSyncRes.rows[0]?.ts || null;

    const accountsByPlatform = new Map<string, { count: number; followers: number }>();
    for (const r of accountRes.rows as any[]) {
      accountsByPlatform.set(r.platform.toLowerCase(), { count: parseInt(r.cnt), followers: parseInt(r.total_followers || '0') });
    }

    // Fetch post titles for top posts
    const postIds = [...new Set([...logs.map((l: any) => l.post_id), ...metrics.map((m: any) => m.post_id)].filter(Boolean))];
    const postTitles = new Map<string, { title: string; tags: string[]; hasImage: boolean }>();
    if (postIds.length > 0) {
      const postRes = await pool.query(
        `SELECT p.id, p.title, p.featured_image,
                ARRAY(SELECT t.name FROM blog_tags t JOIN blog_post_tags pt ON pt.tag_id=t.id WHERE pt.post_id=p.id) AS tags
         FROM blog_posts p WHERE p.id = ANY($1::text[])`,
        [postIds]
      );
      for (const r of postRes.rows as any[]) {
        postTitles.set(r.id, { title: r.title || '', tags: r.tags || [], hasImage: !!(r.featured_image) });
      }
    }

    // KPIs
    const published = logs.filter((l: any) => l.status === 'success' || l.status === 'published').length;
    const failed = logs.filter((l: any) => l.status === 'failed' || l.status === 'error').length;
    const total = logs.length;
    const publishSuccessRate = total > 0 ? Math.round((published / total) * 100) : null;
    const prevPublished = prevLogs.filter((l: any) => l.status === 'success' || l.status === 'published').length;
    const prevTotal = prevLogs.length;
    const prevSuccessRate = prevTotal > 0 ? Math.round((prevPublished / prevTotal) * 100) : null;

    const totalReach = metrics.reduce((s: number, m: any) => s + (m.reach || 0), 0) || null;
    const totalEngagement = metrics.reduce((s: number, m: any) => s + (m.engagement || (parseInt(m.likes || 0) + parseInt(m.comments || 0) + parseInt(m.shares || 0))), 0) || null;
    const engagementRate = totalReach && totalEngagement ? parseFloat(((totalEngagement / totalReach) * 100).toFixed(2)) : null;

    // Top platform
    const platformCounts = new Map<string, number>();
    for (const l of logs as any[]) {
      const p = (l.platform || '').toLowerCase();
      if (p) platformCounts.set(p, (platformCounts.get(p) || 0) + 1);
    }
    let topPlatform: { platform: string; label: string; published: number; share: number } | null = null;
    if (platformCounts.size > 0) {
      const [tp, tpCount] = [...platformCounts.entries()].sort((a, b) => b[1] - a[1])[0];
      topPlatform = { platform: tp, label: analyticsPlatformLabel(tp), published: tpCount, share: total > 0 ? Math.round((tpCount / total) * 100) : 0 };
    }

    // Best posting time
    const hourCounts = new Map<number, number>();
    for (const l of logs as any[]) {
      if (l.status === 'success' || l.status === 'published') {
        const h = new Date(l.created_at).getHours();
        hourCounts.set(h, (hourCounts.get(h) || 0) + 1);
      }
    }
    let bestTimeWindow: { label: string; supportingValue: string } | null = null;
    if (hourCounts.size > 0) {
      const bestHour = [...hourCounts.entries()].sort((a, b) => b[1] - a[1])[0][0];
      const endHour = (bestHour + 2) % 24;
      const fmt = (h: number) => `${h === 0 ? 12 : h > 12 ? h - 12 : h}${h < 12 ? 'am' : 'pm'}`;
      bestTimeWindow = { label: `${fmt(bestHour)}–${fmt(endHour)}`, supportingValue: 'Most posts published in this window' };
    }

    // Trend by date
    const trendMap = new Map<string, { publishedPosts: number; successfulPublishes: number; failedPublishes: number; scheduledPublishes: number; reach: number; engagement: number }>();
    const cur = new Date(range.start);
    while (cur <= range.end) {
      trendMap.set(analyticsFmtDate(cur), { publishedPosts: 0, successfulPublishes: 0, failedPublishes: 0, scheduledPublishes: 0, reach: 0, engagement: 0 });
      cur.setDate(cur.getDate() + 1);
    }
    for (const l of logs as any[]) {
      const d = analyticsFmtDate(new Date(l.created_at));
      const e = trendMap.get(d);
      if (e) {
        e.publishedPosts++;
        if (l.status === 'success' || l.status === 'published') e.successfulPublishes++;
        else if (l.status === 'failed' || l.status === 'error') e.failedPublishes++;
        else if (l.status === 'scheduled') e.scheduledPublishes++;
      }
    }
    for (const m of metrics as any[]) {
      if (!m.posted_at) continue;
      const d = analyticsFmtDate(new Date(m.posted_at));
      const e = trendMap.get(d);
      if (e) {
        e.reach += parseInt(m.reach || 0);
        e.engagement += parseInt(m.engagement || 0) || (parseInt(m.likes || 0) + parseInt(m.comments || 0) + parseInt(m.shares || 0));
      }
    }
    const trend = [...trendMap.entries()].sort().map(([date, v]) => ({
      date, ...v,
      reach: v.reach || null, engagement: v.engagement || null,
      engagementRate: v.reach && v.engagement ? parseFloat(((v.engagement / v.reach) * 100).toFixed(2)) : null,
    }));

    // Platform breakdown
    const platformStats = new Map<string, { published: number; failed: number; scheduled: number; reach: number; engagement: number }>();
    for (const l of logs as any[]) {
      const p = (l.platform || 'unknown').toLowerCase();
      if (!platformStats.has(p)) platformStats.set(p, { published: 0, failed: 0, scheduled: 0, reach: 0, engagement: 0 });
      const ps = platformStats.get(p)!;
      if (l.status === 'success' || l.status === 'published') ps.published++;
      else if (l.status === 'failed' || l.status === 'error') ps.failed++;
      else if (l.status === 'scheduled') ps.scheduled++;
    }
    for (const m of metrics as any[]) {
      const p = (m.platform || 'unknown').toLowerCase();
      if (!platformStats.has(p)) platformStats.set(p, { published: 0, failed: 0, scheduled: 0, reach: 0, engagement: 0 });
      const ps = platformStats.get(p)!;
      ps.reach += parseInt(m.reach || 0);
      ps.engagement += parseInt(m.engagement || 0) || (parseInt(m.likes || 0) + parseInt(m.comments || 0) + parseInt(m.shares || 0));
    }
    const platformBreakdown = [...platformStats.entries()].map(([platform, ps]) => {
      const t2 = ps.published + ps.failed;
      const acc = accountsByPlatform.get(platform);
      return {
        platform, label: analyticsPlatformLabel(platform),
        published: ps.published, failed: ps.failed, scheduled: ps.scheduled,
        successRate: t2 > 0 ? Math.round((ps.published / t2) * 100) : null,
        reach: ps.reach || null, engagement: ps.engagement || null,
        engagementRate: ps.reach && ps.engagement ? parseFloat(((ps.engagement / ps.reach) * 100).toFixed(2)) : null,
        accounts: acc?.count || 0, followerReach: acc?.followers || null,
      };
    }).sort((a, b) => b.published - a.published);

    // Top posts
    const postStats = new Map<string, { platforms: string[]; success: number; fail: number; reach: number; engagement: number; publishedAt: string | null }>();
    for (const l of logs as any[]) {
      const pid = l.post_id; if (!pid) continue;
      if (!postStats.has(pid)) postStats.set(pid, { platforms: [], success: 0, fail: 0, reach: 0, engagement: 0, publishedAt: null });
      const ps = postStats.get(pid)!;
      if (l.platform && !ps.platforms.includes(l.platform)) ps.platforms.push(l.platform);
      if (l.status === 'success' || l.status === 'published') { ps.success++; if (!ps.publishedAt) ps.publishedAt = l.created_at; }
      else if (l.status === 'failed' || l.status === 'error') ps.fail++;
    }
    for (const m of metrics as any[]) {
      const pid = m.post_id; if (!pid) continue;
      if (!postStats.has(pid)) postStats.set(pid, { platforms: [], success: 0, fail: 0, reach: 0, engagement: 0, publishedAt: null });
      const ps = postStats.get(pid)!;
      ps.reach += parseInt(m.reach || 0);
      ps.engagement += parseInt(m.engagement || 0) || (parseInt(m.likes || 0) + parseInt(m.comments || 0) + parseInt(m.shares || 0));
    }
    const topPosts = [...postStats.entries()]
      .map(([pid, ps]) => {
        const score = ps.success * 2 + (ps.reach > 0 ? Math.log10(ps.reach + 1) : 0) + (ps.engagement > 0 ? Math.log10(ps.engagement + 1) * 2 : 0);
        const info = postTitles.get(pid);
        return {
          id: pid, title: info?.title || 'Untitled', publishedAt: ps.publishedAt,
          platforms: ps.platforms, type: (info?.hasImage ? 'image' : 'text') as 'image' | 'text',
          hashtags: [], tagNames: info?.tags || [],
          successfulPublishes: ps.success, failedPublishes: ps.fail,
          reach: ps.reach || null, engagement: ps.engagement || null,
          engagementRate: ps.reach && ps.engagement ? parseFloat(((ps.engagement / ps.reach) * 100).toFixed(2)) : null,
          score: Math.round(score * 10) / 10,
          scoreLabel: score > 10 ? 'Top Performer' : score > 5 ? 'Good' : score > 2 ? 'Average' : 'Low',
        };
      })
      .sort((a, b) => b.score - a.score)
      .slice(0, 10);

    // Insights
    const insights: Array<{ type: string; title: string; description: string; actionLabel?: string; actionHref?: string }> = [];
    if (published === 0 && total === 0) {
      insights.push({ type: 'warning', title: 'No publishing activity yet', description: 'Start publishing posts to see analytics data.', actionLabel: 'Create Post', actionHref: '/posts' });
    }
    if (publishSuccessRate !== null && publishSuccessRate < 70) {
      insights.push({ type: 'warning', title: 'Low publish success rate', description: `Only ${publishSuccessRate}% of attempts succeeded. Check your social account connections.`, actionLabel: 'Check Integrations', actionHref: '/integrations' });
    } else if (publishSuccessRate !== null && publishSuccessRate >= 90) {
      insights.push({ type: 'positive', title: 'Excellent publish success rate', description: `${publishSuccessRate}% success rate — your integrations are working great.` });
    }
    if (bestTimeWindow && published >= 5) {
      insights.push({ type: 'suggestion', title: `Best posting time: ${bestTimeWindow.label}`, description: 'Schedule future posts in this window for maximum visibility.' });
    }
    if (accountsByPlatform.size === 0) {
      insights.push({ type: 'suggestion', title: 'Connect social accounts', description: 'Connect your social media accounts to start publishing and tracking analytics.', actionLabel: 'Connect Accounts', actionHref: '/integrations' });
    }
    if (prevPublished > 0) {
      const growthPct = Math.round(((published - prevPublished) / prevPublished) * 100);
      if (growthPct > 20) insights.push({ type: 'positive', title: 'Publishing frequency increased', description: `${growthPct}% more posts than the previous period.` });
      else if (growthPct < -20) insights.push({ type: 'warning', title: 'Publishing frequency decreased', description: `${Math.abs(growthPct)}% fewer posts compared to the previous period.` });
    }
    if (metrics.length === 0 && total > 0) {
      insights.push({ type: 'suggestion', title: 'Sync for reach & engagement data', description: 'Click "Sync Analytics" to fetch reach and engagement data from your connected platforms.' });
    }

    return res.json({
      success: true,
      data: {
        lastSyncedAt,
        range: { preset: range.preset, start: analyticsFmtDate(range.start), end: analyticsFmtDate(range.end), label: range.label, days: range.days },
        metricsAvailability: { performance: metrics.length > 0 },
        summaryNote: metrics.length === 0 && total > 0 ? 'Sync analytics to see reach and engagement data from your platforms.' : null,
        kpis: {
          publishedPosts: published,
          publishedPostsChange: prevPublished > 0 ? Math.round(((published - prevPublished) / prevPublished) * 100) : null,
          totalReach, totalReachChange: null,
          totalEngagement, totalEngagementChange: null,
          engagementRate, engagementRateChange: null,
          publishSuccessRate,
          publishSuccessRateChange: prevSuccessRate !== null && publishSuccessRate !== null ? publishSuccessRate - prevSuccessRate : null,
          topPlatform, bestTimeWindow, futureScheduledCount,
        },
        trend, platformBreakdown, topPosts, insights,
      },
    });
  } catch (err) {
    console.error('Analytics dashboard error:', err);
    return res.status(500).json({ success: false, error: 'Failed to fetch analytics dashboard' });
  }
});

// POST /api/blog/analytics/refresh — sync social metrics from platform APIs
app.post('/api/blog/analytics/refresh', async (req: Request, res: Response) => {
  try {
    const auth = requireAuth(req, res);
    if (!auth) return;
    if (!pool) return res.status(503).json({ success: false, error: 'DB not ready' });

    const accountRes = await pool.query(
      `SELECT id, platform, account_id, account_name, access_token, access_token_encrypted, refresh_token, token_data, followers
       FROM social_accounts WHERE user_id=$1 AND connected=true`,
      [auth.userId]
    );

    let synced = 0;
    const errors: string[] = [];

    for (const acct of accountRes.rows as any[]) {
      const platform = (acct.platform || '').toLowerCase();
      let token = '';
      if (acct.access_token_encrypted) {
        try { token = decryptIntegrationSecret(String(acct.access_token_encrypted)); } catch { /* */ }
      }
      if (!token) token = String(acct.access_token || '').trim();
      if (!token) continue;

      try {
        if (platform === 'facebook') {
          const fbPageId = acct.account_id || 'me';

          // ── Fetch page profile (followers, post count, bio) ───────────────────
          try {
            const pageResp = await axios.get(`https://graph.facebook.com/v19.0/${fbPageId}`, {
              params: {
                access_token: token,
                fields: 'id,name,about,fan_count,followers_count,posts.summary(total_count).limit(0)',
              },
              validateStatus: () => true, timeout: 10000,
            });
            if (pageResp.status === 200 && pageResp.data) {
              const pd = pageResp.data;
              const followers  = parseInt(String(pd.fan_count ?? pd.followers_count ?? 0)) || 0;
              const postsCount = parseInt(String(pd.posts?.summary?.total_count ?? 0)) || 0;
              const bio        = typeof pd.about === 'string' && pd.about.trim() ? pd.about.trim() : null;
              const pageName   = typeof pd.name  === 'string' && pd.name.trim()  ? pd.name.trim()  : null;
              console.log('[Facebook sync] page:', pageName, 'followers:', followers, 'posts:', postsCount);
              await pool!.query(
                `INSERT INTO social_profile_stats
                   (id, user_id, social_account_id, platform,
                    followers, posts_count, bio, raw_response, synced_at)
                 VALUES (gen_random_uuid()::text, $1, $2, 'facebook',
                         $3, $4, $5, $6::jsonb, NOW())
                 ON CONFLICT (social_account_id) DO UPDATE SET
                   followers   = CASE WHEN EXCLUDED.followers   > 0 THEN EXCLUDED.followers   ELSE social_profile_stats.followers   END,
                   posts_count = CASE WHEN EXCLUDED.posts_count > 0 THEN EXCLUDED.posts_count ELSE social_profile_stats.posts_count END,
                   bio         = COALESCE(EXCLUDED.bio, social_profile_stats.bio),
                   raw_response= EXCLUDED.raw_response,
                   synced_at   = NOW()`,
                [auth.userId, acct.id, followers, postsCount, bio, JSON.stringify(pd)]
              );
              await pool!.query(
                `UPDATE social_accounts SET
                   account_name = COALESCE($1, account_name),
                   followers    = CASE WHEN $2 > 0 THEN $2 ELSE followers END
                 WHERE id = $3`,
                [pageName, followers, acct.id]
              );
              synced++;
            }
          } catch (profileErr: any) {
            errors.push(`facebook profile: ${profileErr.message}`);
          }

          // ── Fetch post metrics ────────────────────────────────────────────────
          const feedResp = await axios.get(`https://graph.facebook.com/v19.0/${fbPageId}/posts`, {
            params: { access_token: token, fields: 'id,message,created_time,full_picture', limit: 25 },
            validateStatus: () => true, timeout: 15000,
          });
          if (feedResp.status === 200) {
            const posts: any[] = feedResp.data?.data || [];
            for (const post of posts) {
              try {
                const insResp = await axios.get(`https://graph.facebook.com/v19.0/${post.id}/insights`, {
                  params: { access_token: token, metric: 'post_impressions,post_impressions_unique,post_engaged_users,post_clicks,post_reactions_by_type_total' },
                  validateStatus: () => true, timeout: 10000,
                });
                const insData: any[] = insResp.data?.data || [];
                const getM = (name: string) => insData.find((m: any) => m.name === name)?.values?.[0]?.value;
                const reactions: Record<string, number> = getM('post_reactions_by_type_total') || {};
                const likes = Object.values(reactions).reduce((s, v) => s + (parseInt(String(v)) || 0), 0);
                const impressions = parseInt(getM('post_impressions') || 0);
                const reach = parseInt(getM('post_impressions_unique') || 0);
                const engagement = parseInt(getM('post_engaged_users') || 0);
                await pool!.query(
                  `INSERT INTO social_metrics (id, user_id, platform, platform_post_id, social_account_id, likes, impressions, reach, engagement, raw_data, posted_at)
                   VALUES (gen_random_uuid()::text, $1, 'facebook', $2, $3, $4, $5, $6, $7, $8::jsonb, $9)
                   ON CONFLICT (user_id, platform, platform_post_id) DO UPDATE SET
                     likes=EXCLUDED.likes, impressions=EXCLUDED.impressions, reach=EXCLUDED.reach,
                     engagement=EXCLUDED.engagement, raw_data=EXCLUDED.raw_data, fetched_at=NOW()`,
                  [auth.userId, post.id, acct.id, likes, impressions, reach, engagement,
                   JSON.stringify({ post, insights: insData }),
                   post.created_time ? new Date(post.created_time).toISOString() : null]
                );
                synced++;
              } catch { /* skip individual post errors */ }
            }
          }
        } else if (platform === 'twitter' || platform === 'x') {
          const twitterUserId = acct.token_data?.userId || acct.token_data?.user_id || acct.account_id;
          if (twitterUserId) {
            const tweetsResp = await axios.get(`https://api.x.com/2/users/${twitterUserId}/tweets`, {
              headers: { Authorization: `Bearer ${token}` },
              params: { max_results: 25, 'tweet.fields': 'public_metrics,created_at' },
              validateStatus: () => true, timeout: 15000,
            });
            if (tweetsResp.status === 200) {
              const tweets: any[] = tweetsResp.data?.data || [];
              for (const tweet of tweets) {
                const m = tweet.public_metrics || {};
                const engagement = (m.like_count || 0) + (m.reply_count || 0) + (m.retweet_count || 0);
                await pool!.query(
                  `INSERT INTO social_metrics (id, user_id, platform, platform_post_id, social_account_id, likes, comments, shares, impressions, engagement, raw_data, posted_at)
                   VALUES (gen_random_uuid()::text, $1, 'twitter', $2, $3, $4, $5, $6, $7, $8, $9::jsonb, $10)
                   ON CONFLICT (user_id, platform, platform_post_id) DO UPDATE SET
                     likes=EXCLUDED.likes, comments=EXCLUDED.comments, shares=EXCLUDED.shares,
                     impressions=EXCLUDED.impressions, engagement=EXCLUDED.engagement,
                     raw_data=EXCLUDED.raw_data, fetched_at=NOW()`,
                  [auth.userId, tweet.id, acct.id, m.like_count || 0, m.reply_count || 0,
                   m.retweet_count || 0, m.impression_count || 0, engagement, JSON.stringify(tweet),
                   tweet.created_at ? new Date(tweet.created_at).toISOString() : null]
                );
                synced++;
              }
              const userResp = await axios.get(`https://api.x.com/2/users/${twitterUserId}`, {
                headers: { Authorization: `Bearer ${token}` },
                params: { 'user.fields': 'public_metrics' },
                validateStatus: () => true, timeout: 10000,
              });
              if (userResp.status === 200 && userResp.data?.data?.public_metrics?.followers_count) {
                await pool!.query(`UPDATE social_accounts SET followers=$1 WHERE id=$2`,
                  [userResp.data.data.public_metrics.followers_count, acct.id]);
              }
            }
          }
        } else if (platform === 'tiktok') {
          // ── Fetch TikTok user profile (with scope fallback) ────────────────────
          try {
            const { user: u, scopeLimited } = await fetchTikTokUserProfile(token);
            if (u) {
              const followers  = Number(u.follower_count  ?? 0);
              const following  = Number(u.following_count ?? 0);
              const postsCount = Number(u.video_count     ?? 0);
              const totalLikes = Number(u.likes_count     ?? 0);
              console.log('[TikTok sync] followers:', followers, 'following:', following, 'posts:', postsCount, 'likes:', totalLikes, 'scopeLimited:', scopeLimited);
              const bio        = typeof u.bio_description === 'string' ? u.bio_description : null;
              const isVerified = Boolean(u.is_verified ?? false);

              await pool!.query(
                `INSERT INTO social_profile_stats
                   (id, user_id, social_account_id, platform,
                    followers, following, posts_count, total_likes,
                    bio, is_verified, raw_response, synced_at)
                 VALUES (gen_random_uuid()::text, $1, $2, 'tiktok',
                         $3, $4, $5, $6, $7, $8, $9::jsonb, NOW())
                 ON CONFLICT (social_account_id) DO UPDATE SET
                   followers   = CASE WHEN EXCLUDED.followers > 0 THEN EXCLUDED.followers ELSE social_profile_stats.followers END,
                   following   = CASE WHEN EXCLUDED.following   > 0 THEN EXCLUDED.following   ELSE social_profile_stats.following   END,
                   posts_count = CASE WHEN EXCLUDED.posts_count > 0 THEN EXCLUDED.posts_count ELSE social_profile_stats.posts_count END,
                   total_likes = CASE WHEN EXCLUDED.total_likes > 0 THEN EXCLUDED.total_likes ELSE social_profile_stats.total_likes END,
                   bio         = COALESCE(EXCLUDED.bio,         social_profile_stats.bio),
                   is_verified = EXCLUDED.is_verified,
                   raw_response= EXCLUDED.raw_response,
                   synced_at   = NOW()`,
                [auth.userId, acct.id,
                 followers, following, postsCount, totalLikes,
                 bio, isVerified, JSON.stringify(u)]
              );
              // Update account_name and handle in social_accounts from live profile data
              const displayName = typeof u.display_name === 'string' && u.display_name.trim() ? u.display_name.trim() : null;
              const username    = typeof u.username    === 'string' && u.username.trim()    ? u.username.trim()    : null;
              await pool!.query(
                `UPDATE social_accounts SET
                   account_name = COALESCE($1, account_name),
                   handle       = COALESCE($2, handle),
                   followers    = CASE WHEN $3 > 0 THEN $3 ELSE followers END
                 WHERE id = $4`,
                [displayName, username, followers, acct.id]
              );
              // Verify what actually landed in the DB
              const verify = await pool!.query(`SELECT followers FROM social_profile_stats WHERE social_account_id=$1`, [acct.id]);
              console.log('[TikTok sync] DB followers after upsert:', verify.rows[0]?.followers);
              synced++;
              if (scopeLimited) {
                errors.push('tiktok: stats scope not granted — reconnect TikTok to enable follower/video counts');
              }
            }
          } catch (profileErr: any) {
            errors.push(`tiktok: ${profileErr.message}`);
          }

          // ── Fetch TikTok videos and metrics ───────────────────────────────────
          // video/list is POST, cursor-based, max 20/page, all fields in one call.
          try {
            const TT_VIDEO_FIELDS = 'id,title,cover_image_url,share_url,video_description,create_time,duration,height,width,embed_html,embed_link,like_count,comment_count,share_count,view_count';
            let ttCursor: number | undefined;
            let ttHasMore = true;
            let ttPage = 0;
            const TT_MAX_PAGES = 10;

            while (ttHasMore && ttPage < TT_MAX_PAGES) {
              const ttBody: Record<string, any> = { max_count: 20 };
              if (ttCursor !== undefined) ttBody.cursor = ttCursor;

              const videosResp = await axios.post(
                'https://open.tiktokapis.com/v2/video/list/',
                ttBody,
                {
                  headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
                  params: { fields: TT_VIDEO_FIELDS },
                  validateStatus: () => true,
                  timeout: 15000,
                }
              );

              const vidErrCode = videosResp.data?.error?.code;
              if (vidErrCode && vidErrCode !== 'ok') {
                if (ttPage === 0) console.log(`TikTok video.list scope not available (${vidErrCode}) — skipping`);
                break;
              }
              if (videosResp.status !== 200) break;

              const videos: any[] = videosResp.data?.data?.videos || [];
              ttHasMore = videosResp.data?.data?.has_more === true;
              ttCursor  = videosResp.data?.data?.cursor;
              ttPage++;

              for (const v of videos) {
                if (!v.id) continue;
                const videoId    = String(v.id);
                const likes      = Number(v.like_count    ?? 0);
                const comments   = Number(v.comment_count ?? 0);
                const shares     = Number(v.share_count   ?? 0);
                const views      = Number(v.view_count    ?? 0);
                const engagement = likes + comments + shares;
                const duration   = Number(v.duration ?? 0);
                const postedAt   = v.create_time ? new Date(v.create_time * 1000).toISOString() : null;

                await pool!.query(
                  `INSERT INTO tiktok_video_insights
                     (id, user_id, social_account_id, video_id, title, cover_url, share_url,
                      likes, comments, shares, views, engagement, duration_seconds, posted_at,
                      video_description, embed_html, embed_link, height, width,
                      fetched_at, raw_data)
                   VALUES (gen_random_uuid()::text, $1, $2, $3, $4, $5, $6,
                           $7, $8, $9, $10, $11, $12, $13,
                           $14, $15, $16, $17, $18,
                           NOW(), $19::jsonb)
                   ON CONFLICT (social_account_id, video_id) DO UPDATE SET
                     title=EXCLUDED.title, cover_url=EXCLUDED.cover_url, share_url=EXCLUDED.share_url,
                     likes=EXCLUDED.likes, comments=EXCLUDED.comments, shares=EXCLUDED.shares,
                     views=EXCLUDED.views, engagement=EXCLUDED.engagement,
                     duration_seconds=EXCLUDED.duration_seconds,
                     video_description=EXCLUDED.video_description,
                     embed_html=EXCLUDED.embed_html, embed_link=EXCLUDED.embed_link,
                     height=EXCLUDED.height, width=EXCLUDED.width,
                     fetched_at=NOW(), raw_data=EXCLUDED.raw_data`,
                  [
                    auth.userId, acct.id, videoId,
                    typeof v.title === 'string' ? v.title.slice(0, 500) : null,
                    typeof v.cover_image_url === 'string' ? v.cover_image_url : null,
                    typeof v.share_url === 'string' ? v.share_url : null,
                    likes, comments, shares, views, engagement, duration, postedAt,
                    typeof v.video_description === 'string' ? v.video_description.slice(0, 2000) : null,
                    typeof v.embed_html === 'string' ? v.embed_html : null,
                    typeof v.embed_link === 'string' ? v.embed_link : null,
                    Number(v.height ?? 0), Number(v.width ?? 0),
                    JSON.stringify(v),
                  ]
                );

                // Also keep social_metrics for cross-platform aggregations
                await pool!.query(
                  `INSERT INTO social_metrics (id, user_id, platform, platform_post_id, social_account_id, likes, comments, shares, impressions, reach, engagement, raw_data, posted_at, fetched_at)
                   VALUES (gen_random_uuid()::text, $1, 'tiktok', $2, $3, $4, $5, $6, $7, $8, $9, $10::jsonb, $11, NOW())
                   ON CONFLICT (user_id, platform, platform_post_id) DO UPDATE SET
                     likes=EXCLUDED.likes, comments=EXCLUDED.comments, shares=EXCLUDED.shares,
                     impressions=EXCLUDED.impressions, reach=EXCLUDED.reach, engagement=EXCLUDED.engagement,
                     raw_data=EXCLUDED.raw_data, fetched_at=NOW()`,
                  [auth.userId, videoId, acct.id, likes, comments, shares, views, views, engagement, JSON.stringify(v), postedAt]
                );
                synced++;
              }

              if (!ttHasMore || ttCursor === undefined) break;
            }
          } catch (vidErr: any) {
            console.error('TikTok video fetch error:', vidErr.message);
          }
        } else if (platform === 'pinterest') {
          const pinterestResult = await syncPinterestAnalyticsAccount({
            userId: auth.userId,
            account: acct,
            days: 30,
            maxPins: 50,
          });
          synced += pinterestResult.synced;
          errors.push(...pinterestResult.errors.map((message) => `pinterest: ${message}`));
        } else if (platform === 'instagram') {
          const instagramResult = await syncInstagramAnalyticsAccount({
            userId: auth.userId,
            account: acct,
            days: 30,
          });
          synced += instagramResult.synced;
          errors.push(...instagramResult.errors.map((message) => `instagram: ${message}`));
        } else if (platform === 'linkedin') {
          const tokenData = acct.token_data || {};
          const personUrn = tokenData.personUrn || tokenData.urn || tokenData.sub;
          if (personUrn) {
            const sharesResp = await axios.get('https://api.linkedin.com/v2/shares', {
              headers: { Authorization: `Bearer ${token}`, 'X-Restli-Protocol-Version': '2.0.0' },
              params: { q: 'owners', owners: personUrn, count: 20 },
              validateStatus: () => true, timeout: 15000,
            });
            if (sharesResp.status === 200) {
              const shares: any[] = sharesResp.data?.elements || [];
              for (const share of shares) {
                const shareId = share.activity || share.id;
                if (!shareId) continue;
                let stats: any = {};
                try {
                  const statsResp = await axios.get('https://api.linkedin.com/v2/socialActions/' + encodeURIComponent(shareId), {
                    headers: { Authorization: `Bearer ${token}`, 'X-Restli-Protocol-Version': '2.0.0' },
                    validateStatus: () => true, timeout: 10000,
                  });
                  stats = statsResp.data || {};
                } catch { /* optional */ }
                const likeCount = stats.likesSummary?.totalLikes || 0;
                const commentCount = stats.commentsSummary?.totalFirstLevelComments || 0;
                await pool!.query(
                  `INSERT INTO social_metrics (id, user_id, platform, platform_post_id, social_account_id, likes, comments, engagement, raw_data, posted_at)
                   VALUES (gen_random_uuid()::text, $1, 'linkedin', $2, $3, $4, $5, $6, $7::jsonb, $8)
                   ON CONFLICT (user_id, platform, platform_post_id) DO UPDATE SET
                     likes=EXCLUDED.likes, comments=EXCLUDED.comments, engagement=EXCLUDED.engagement,
                     raw_data=EXCLUDED.raw_data, fetched_at=NOW()`,
                  [auth.userId, shareId, acct.id, likeCount, commentCount,
                   likeCount + commentCount, JSON.stringify({ share, stats }),
                   share.created?.time ? new Date(share.created.time).toISOString() : null]
                );
                synced++;
              }
            }
          }
        }
      } catch (platformErr: any) {
        const msg = platformErr?.response?.data?.error?.message || platformErr?.message || 'Failed';
        errors.push(`${platform}: ${msg}`);
        console.error(`Analytics sync error for ${platform}:`, msg);
      }
    }

    // Store last synced timestamp
    await pool.query(
      `INSERT INTO insights_cache (id, user_id, cache_key, data, expires_at)
       VALUES (gen_random_uuid()::text, $1, 'last_synced', $2::jsonb, NOW() + INTERVAL '1 year')
       ON CONFLICT (user_id, cache_key) DO UPDATE SET data=EXCLUDED.data, expires_at=EXCLUDED.expires_at`,
      [auth.userId, JSON.stringify({ lastSyncedAt: new Date().toISOString() })]
    );

    return res.json({ success: true, synced, errors: errors.length > 0 ? errors : undefined });
  } catch (err) {
    console.error('Analytics refresh error:', err);
    return res.status(500).json({ success: false, error: 'Failed to sync analytics' });
  }
});

// GET /api/blog/analytics/export — CSV export
app.get('/api/blog/analytics/export', async (req: Request, res: Response) => {
  try {
    const auth = requireAuth(req, res);
    if (!auth) return;
    if (!pool) return res.status(503).json({ success: false, error: 'DB not ready' });

    const q = req.query as any;
    const range = parseAnalyticsRange(q.preset, q.start, q.end);

    const rows = await pool.query(
      `SELECT pl.platform, pl.status, pl.created_at, pl.error_message,
              bp.title as post_title,
              sm.likes, sm.comments, sm.shares, sm.impressions, sm.reach, sm.engagement
       FROM publishing_logs pl
       LEFT JOIN blog_posts bp ON bp.id = pl.post_id
       LEFT JOIN social_metrics sm ON sm.user_id = pl.user_id AND sm.platform = pl.platform
         AND sm.platform_post_id = COALESCE(pl.platform_post_id, '')
       WHERE pl.user_id=$1 AND pl.created_at >= $2 AND pl.created_at <= $3
       ORDER BY pl.created_at DESC`,
      [auth.userId, range.startIso, range.endIso]
    );

    const headers = ['Date', 'Platform', 'Post Title', 'Status', 'Likes', 'Comments', 'Shares', 'Impressions', 'Reach', 'Engagement', 'Error'];
    const csvLines = [headers.join(',')];
    for (const row of rows.rows as any[]) {
      csvLines.push([
        new Date(row.created_at).toISOString().slice(0, 10),
        row.platform || '',
        `"${(row.post_title || 'Untitled').replace(/"/g, '""')}"`,
        row.status || '',
        row.likes ?? '', row.comments ?? '', row.shares ?? '',
        row.impressions ?? '', row.reach ?? '', row.engagement ?? '',
        `"${(row.error_message || '').replace(/"/g, '""')}"`,
      ].join(','));
    }

    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', `attachment; filename="analytics-${range.preset}-${analyticsFmtDate(new Date())}.csv"`);
    return res.send(csvLines.join('\n'));
  } catch (err) {
    console.error('Analytics export error:', err);
    return res.status(500).json({ success: false, error: 'Failed to export analytics' });
  }
});

// ─── Social Account Analytics ────────────────────────────────────────────────

// GET /api/analytics/social/accounts — all connected accounts with aggregated metrics
app.get('/api/analytics/social/accounts', async (req: Request, res: Response) => {
  try {
    const auth = requireAuth(req, res);
    if (!auth) return;
    if (!pool) return res.status(503).json({ success: false, error: 'DB not ready' });

    const days = Math.max(1, Math.min(365, parseInt(String(req.query.days || '30'))));
    const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();

    const result = await pool.query(
      `SELECT
         sa.id,
         sa.platform,
         COALESCE(sa.account_name, sa.handle, sa.platform) AS account_name,
         sa.handle,
         sa.connected_at,
         -- followers: prefer live value from social_profile_stats, fall back to social_accounts
         COALESCE(sps.followers, sa.followers, 0)::bigint  AS followers,
         COALESCE(sps.following,    0)::bigint             AS following_count,
         COALESCE(sps.posts_count,  0)::bigint             AS video_count,
         COALESCE(sps.total_likes,  0)::bigint             AS total_likes_count,
         sps.bio,
         sps.is_verified,
         sps.synced_at,
         -- aggregated post-level metrics from social_metrics
         COALESCE(SUM(sm.reach),       0)::bigint AS total_reach,
         COALESCE(SUM(sm.impressions), 0)::bigint AS total_impressions,
         COALESCE(SUM(sm.engagement),  0)::bigint AS total_engagement,
         COALESCE(SUM(sm.likes),       0)::bigint AS total_likes,
         COALESCE(SUM(sm.comments),    0)::bigint AS total_comments,
         COALESCE(SUM(sm.shares),      0)::bigint AS total_shares,
         COUNT(sm.id)::int AS posts_synced,
         CASE WHEN SUM(sm.impressions) > 0
           THEN ROUND(SUM(sm.engagement)::numeric / NULLIF(SUM(sm.impressions), 0) * 100, 2)
           ELSE 0 END AS engagement_rate
       FROM social_accounts sa
       LEFT JOIN social_profile_stats sps ON sps.social_account_id = sa.id
       LEFT JOIN social_metrics sm ON sm.social_account_id = sa.id
         AND sm.user_id = $1
         AND (sm.posted_at >= $2 OR sm.posted_at IS NULL)
       WHERE sa.user_id = $1 AND sa.connected = true
       GROUP BY sa.id, sa.platform, sa.account_name, sa.handle, sa.followers, sa.connected_at,
                sps.followers, sps.following, sps.posts_count, sps.total_likes,
                sps.bio, sps.is_verified, sps.synced_at
       ORDER BY sa.platform`,
      [auth.userId, since]
    );

    return res.json({ success: true, accounts: result.rows, days });
  } catch (err) {
    console.error('Social accounts analytics error:', err);
    return res.status(500).json({ success: false, error: 'Failed to fetch account analytics' });
  }
});

// GET /api/analytics/social/account/:accountId — per-account dashboard
app.get('/api/analytics/social/account/:accountId', async (req: Request, res: Response) => {
  try {
    const auth = requireAuth(req, res);
    if (!auth) return;
    if (!pool) return res.status(503).json({ success: false, error: 'DB not ready' });

    const { accountId } = req.params;
    const days = Math.max(1, Math.min(365, parseInt(String(req.query.days || '30'))));
    const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();

    const acctResult = await pool.query(
      `SELECT sa.id, sa.platform,
         COALESCE(sa.account_name, sa.handle, sa.platform) AS account_name,
         sa.handle, sa.connected_at,
         COALESCE(sps.followers, sa.followers, 0)::bigint AS followers,
         COALESCE(sps.following,   0)::bigint AS following_count,
         COALESCE(sps.posts_count, 0)::bigint AS video_count,
         COALESCE(sps.total_likes, 0)::bigint AS total_likes_count,
         sps.bio, sps.is_verified, sps.synced_at
       FROM social_accounts sa
       LEFT JOIN social_profile_stats sps ON sps.social_account_id = sa.id
       WHERE sa.id = $1 AND sa.user_id = $2 AND sa.connected = true`,
      [accountId, auth.userId]
    );
    if (acctResult.rows.length === 0) {
      return res.status(404).json({ success: false, error: 'Account not found' });
    }
    const account = acctResult.rows[0];

    const [summaryResult, trendResult, topPostsResult] = await Promise.all([
      pool.query(
        `SELECT
           COALESCE(SUM(reach), 0)::bigint AS total_reach,
           COALESCE(SUM(impressions), 0)::bigint AS total_impressions,
           COALESCE(SUM(engagement), 0)::bigint AS total_engagement,
           COALESCE(SUM(likes), 0)::bigint AS total_likes,
           COALESCE(SUM(comments), 0)::bigint AS total_comments,
           COALESCE(SUM(shares), 0)::bigint AS total_shares,
           COUNT(*)::int AS posts_count,
           CASE WHEN SUM(impressions) > 0
             THEN ROUND(SUM(engagement)::numeric / NULLIF(SUM(impressions), 0) * 100, 2)
             ELSE 0 END AS engagement_rate
         FROM social_metrics
         WHERE social_account_id = $1 AND user_id = $2
           AND (posted_at >= $3 OR posted_at IS NULL)`,
        [accountId, auth.userId, since]
      ),
      pool.query(
        `SELECT
           DATE(posted_at) AS date,
           COALESCE(SUM(reach), 0)::bigint AS reach,
           COALESCE(SUM(impressions), 0)::bigint AS impressions,
           COALESCE(SUM(engagement), 0)::bigint AS engagement,
           COALESCE(SUM(likes), 0)::bigint AS likes,
           COALESCE(SUM(comments), 0)::bigint AS comments,
           COUNT(*)::int AS posts,
           CASE WHEN SUM(impressions) > 0
             THEN ROUND(SUM(engagement)::numeric / NULLIF(SUM(impressions), 0) * 100, 2)
             ELSE 0 END AS engagement_rate
         FROM social_metrics
         WHERE social_account_id = $1 AND user_id = $2
           AND posted_at IS NOT NULL AND posted_at >= $3
         GROUP BY DATE(posted_at)
         ORDER BY date`,
        [accountId, auth.userId, since]
      ),
      pool.query(
        `SELECT
           sm.platform_post_id,
           sm.post_id,
           COALESCE(bp.title, sm.raw_data->>'title', 'Post ' || LEFT(sm.platform_post_id, 8)) AS title,
           COALESCE(sm.likes, 0)::bigint AS likes,
           COALESCE(sm.comments, 0)::bigint AS comments,
           COALESCE(sm.shares, 0)::bigint AS shares,
           COALESCE(sm.impressions, 0)::bigint AS impressions,
           COALESCE(sm.reach, 0)::bigint AS reach,
           COALESCE(sm.engagement, 0)::bigint AS engagement,
           sm.posted_at,
           CASE WHEN sm.impressions > 0
             THEN ROUND(sm.engagement::numeric / NULLIF(sm.impressions, 0) * 100, 2)
             ELSE 0 END AS engagement_rate
         FROM social_metrics sm
         LEFT JOIN blog_posts bp ON bp.id = sm.post_id
         WHERE sm.social_account_id = $1 AND sm.user_id = $2
           AND (sm.posted_at >= $3 OR sm.posted_at IS NULL)
         ORDER BY sm.engagement DESC NULLS LAST, sm.likes DESC NULLS LAST
         LIMIT 10`,
        [accountId, auth.userId, since]
      ),
    ]);

    console.log('[TikTok dashboard] account row followers:', account.followers, 'following_count:', account.following_count, 'video_count:', account.video_count);
    return res.json({
      success: true,
      account: {
        id: account.id,
        platform: account.platform,
        account_name: account.account_name,
        handle: account.handle,
        followers: parseInt(String(account.followers || '0')),
        following_count: parseInt(String(account.following_count || '0')),
        video_count: parseInt(String(account.video_count || '0')),
        total_likes_count: parseInt(String(account.total_likes_count || '0')),
        bio: account.bio || null,
        is_verified: Boolean(account.is_verified),
        connected_at: account.connected_at,
      },
      summary: summaryResult.rows[0] || {},
      trend: trendResult.rows,
      top_posts: topPostsResult.rows,
      days,
    });
  } catch (err) {
    console.error('Account analytics error:', err);
    return res.status(500).json({ success: false, error: 'Failed to fetch account analytics' });
  }
});

// GET /api/analytics/social/comparison — multi-account comparison with rankings
app.get('/api/analytics/social/comparison', async (req: Request, res: Response) => {
  try {
    const auth = requireAuth(req, res);
    if (!auth) return;
    if (!pool) return res.status(503).json({ success: false, error: 'DB not ready' });

    const days = Math.max(1, Math.min(365, parseInt(String(req.query.days || '30'))));
    const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();

    const result = await pool.query(
      `SELECT
         sa.id,
         sa.platform,
         COALESCE(sa.account_name, sa.handle, sa.platform) AS account_name,
         sa.handle,
         COALESCE(sa.followers, 0)::bigint AS followers,
         COALESCE(SUM(sm.reach), 0)::bigint AS total_reach,
         COALESCE(SUM(sm.impressions), 0)::bigint AS total_impressions,
         COALESCE(SUM(sm.engagement), 0)::bigint AS total_engagement,
         COALESCE(SUM(sm.likes), 0)::bigint AS total_likes,
         COUNT(sm.id)::int AS posts_synced,
         CASE WHEN SUM(sm.impressions) > 0
           THEN ROUND(SUM(sm.engagement)::numeric / NULLIF(SUM(sm.impressions), 0) * 100, 2)
           ELSE 0 END AS engagement_rate
       FROM social_accounts sa
       LEFT JOIN social_metrics sm ON sm.social_account_id = sa.id
         AND sm.user_id = $1
         AND (sm.posted_at >= $2 OR sm.posted_at IS NULL)
       WHERE sa.user_id = $1 AND sa.connected = true
       GROUP BY sa.id, sa.platform, sa.account_name, sa.handle, sa.followers
       ORDER BY SUM(sm.engagement) DESC NULLS LAST`,
      [auth.userId, since]
    );

    const accounts: any[] = result.rows;
    const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

    const byFollowers = [...accounts].sort((a, b) => parseInt(b.followers) - parseInt(a.followers));
    const byEngagement = [...accounts].sort((a, b) => parseFloat(b.engagement_rate) - parseFloat(a.engagement_rate));
    const byReach = [...accounts].sort((a, b) => parseInt(b.total_reach) - parseInt(a.total_reach));

    const insights: Array<{ type: string; title: string; description: string; winner: string }> = [];
    if (accounts.length >= 2) {
      const topF = byFollowers[0];
      if (parseInt(topF.followers) > 0) {
        insights.push({ type: 'followers_leader', title: 'Largest Audience', winner: topF.platform,
          description: `${cap(topF.platform)} has your largest audience with ${Number(topF.followers).toLocaleString()} followers.` });
      }
      const topE = byEngagement[0];
      if (parseFloat(topE.engagement_rate) > 0) {
        insights.push({ type: 'engagement_leader', title: 'Highest Engagement', winner: topE.platform,
          description: `${cap(topE.platform)} leads engagement at ${parseFloat(topE.engagement_rate).toFixed(2)}% over the last ${days} days.` });
      }
      const topR = byReach[0];
      if (parseInt(topR.total_reach) > 0) {
        insights.push({ type: 'reach_leader', title: 'Top Reach', winner: topR.platform,
          description: `${cap(topR.platform)} reached the most people — ${Number(topR.total_reach).toLocaleString()} in the last ${days} days.` });
      }
    }

    return res.json({
      success: true,
      accounts,
      rankings: {
        by_followers: byFollowers.map((a, i) => ({ id: a.id, platform: a.platform, account_name: a.account_name, value: parseInt(a.followers), rank: i + 1 })),
        by_engagement: byEngagement.map((a, i) => ({ id: a.id, platform: a.platform, account_name: a.account_name, value: parseFloat(a.engagement_rate), rank: i + 1 })),
        by_reach: byReach.map((a, i) => ({ id: a.id, platform: a.platform, account_name: a.account_name, value: parseInt(a.total_reach), rank: i + 1 })),
      },
      insights,
      days,
    });
  } catch (err) {
    console.error('Comparison analytics error:', err);
    return res.status(500).json({ success: false, error: 'Failed to fetch comparison analytics' });
  }
});

// ─── TikTok-specific analytics routes ────────────────────────────────────────

// POST /api/social/tiktok/sync — manual sync of TikTok profile + video data
app.post('/api/social/tiktok/sync', async (req: Request, res: Response) => {
  try {
    const auth = requireAuth(req, res);
    if (!auth) return;
    if (!pool) return res.status(503).json({ success: false, error: 'DB not ready' });

    const accountRes = await pool.query(
      `SELECT id, account_id, access_token, access_token_encrypted, refresh_token, refresh_token_encrypted, token_data
       FROM social_accounts WHERE user_id=$1 AND platform='tiktok' AND connected=true`,
      [auth.userId]
    );
    if (accountRes.rows.length === 0) {
      return res.status(404).json({ success: false, error: 'No connected TikTok account found' });
    }

    let synced = 0;
    const errors: string[] = [];

    for (const acct of accountRes.rows as any[]) {
      let token = '';
      if (acct.access_token_encrypted) {
        try { token = decryptIntegrationSecret(String(acct.access_token_encrypted)); } catch { /* */ }
      }
      if (!token) token = String(acct.access_token || '').trim();
      if (!token) { errors.push('No access token available'); continue; }

      // ── Profile sync (with scope fallback) ────────────────────────────────
      try {
        const { user: u, scopeLimited } = await fetchTikTokUserProfile(token);
        if (u) {
          const followers  = Number(u.follower_count  ?? 0);
          const following  = Number(u.following_count ?? 0);
          const postsCount = Number(u.video_count     ?? 0);
          const totalLikes = Number(u.likes_count     ?? 0);
          const bio        = typeof u.bio_description === 'string' ? u.bio_description : null;
          const isVerified = Boolean(u.is_verified ?? false);
          await pool.query(
            `INSERT INTO social_profile_stats
               (id, user_id, social_account_id, platform,
                followers, following, posts_count, total_likes,
                bio, is_verified, raw_response, synced_at)
             VALUES (gen_random_uuid()::text, $1, $2, 'tiktok', $3, $4, $5, $6, $7, $8, $9::jsonb, NOW())
             ON CONFLICT (social_account_id) DO UPDATE SET
               followers   = CASE WHEN EXCLUDED.followers   > 0 THEN EXCLUDED.followers   ELSE social_profile_stats.followers   END,
               following   = CASE WHEN EXCLUDED.following   > 0 THEN EXCLUDED.following   ELSE social_profile_stats.following   END,
               posts_count = CASE WHEN EXCLUDED.posts_count > 0 THEN EXCLUDED.posts_count ELSE social_profile_stats.posts_count END,
               total_likes = CASE WHEN EXCLUDED.total_likes > 0 THEN EXCLUDED.total_likes ELSE social_profile_stats.total_likes END,
               bio         = COALESCE(EXCLUDED.bio, social_profile_stats.bio),
               is_verified = EXCLUDED.is_verified,
               raw_response= EXCLUDED.raw_response,
               synced_at   = NOW()`,
            [auth.userId, acct.id,
             followers, following, postsCount, totalLikes,
             bio, isVerified, JSON.stringify(u)]
          );
          const displayName = typeof u.display_name === 'string' && u.display_name.trim() ? u.display_name.trim() : null;
          const username    = typeof u.username    === 'string' && u.username.trim()    ? u.username.trim()    : null;
          await pool.query(
            `UPDATE social_accounts SET
               account_name = COALESCE($1, account_name),
               handle       = COALESCE($2, handle),
               followers    = CASE WHEN $3 > 0 THEN $3 ELSE followers END
             WHERE id = $4`,
            [displayName, username, followers, acct.id]
          );
          synced++;
          if (scopeLimited) {
            errors.push('Stats scope not granted — reconnect TikTok to enable follower/video counts');
          }
        }
      } catch (profileErr: any) {
        errors.push(`Profile sync failed: ${profileErr.message}`);
      }

      // ── Video insights sync ────────────────────────────────────────────────
      // video/list is a POST endpoint (not GET). All fields — including
      // video_description, embed_html, embed_link, height, width — are
      // available directly. No separate video/query call needed.
      // Pagination: cursor-based, max 20/page, loop until has_more = false.
      // cover_image_url has a 6-hour CDN TTL — always update on sync.
      try {
        const VIDEO_FIELDS = 'id,title,cover_image_url,share_url,video_description,create_time,duration,height,width,embed_html,embed_link,like_count,comment_count,share_count,view_count';
        let cursor: number | undefined;
        let hasMore = true;
        let pageCount = 0;
        const MAX_PAGES = 10; // safety cap — 10 pages × 20 = 200 videos

        while (hasMore && pageCount < MAX_PAGES) {
          const body: Record<string, any> = { max_count: 20 };
          if (cursor !== undefined) body.cursor = cursor;

          const listResp = await axios.post(
            'https://open.tiktokapis.com/v2/video/list/',
            body,
            {
              headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
              params: { fields: VIDEO_FIELDS },
              validateStatus: () => true,
              timeout: 15000,
            }
          );

          const listErrCode = listResp.data?.error?.code;
          if (listErrCode && listErrCode !== 'ok') {
            if (pageCount === 0) {
              console.log(`TikTok video.list scope not available (${listErrCode}) — skipping video sync`);
            }
            break;
          }
          if (listResp.status !== 200) break;

          const pageVideos: any[] = listResp.data?.data?.videos || [];
          hasMore = listResp.data?.data?.has_more === true;
          cursor  = listResp.data?.data?.cursor;
          pageCount++;

          for (const v of pageVideos) {
            if (!v.id) continue;
            const likes    = Number(v.like_count    ?? 0);
            const comments = Number(v.comment_count ?? 0);
            const shares   = Number(v.share_count   ?? 0);
            const views    = Number(v.view_count    ?? 0);
            const engagement = likes + comments + shares;

            await pool!.query(
              `INSERT INTO tiktok_video_insights
                 (id, user_id, social_account_id, video_id, title, cover_url, share_url,
                  likes, comments, shares, views, engagement, duration_seconds, posted_at,
                  video_description, embed_html, embed_link, height, width,
                  fetched_at, raw_data)
               VALUES (gen_random_uuid()::text, $1, $2, $3, $4, $5, $6,
                       $7, $8, $9, $10, $11, $12, $13,
                       $14, $15, $16, $17, $18,
                       NOW(), $19::jsonb)
               ON CONFLICT (social_account_id, video_id) DO UPDATE SET
                 title             = EXCLUDED.title,
                 cover_url         = EXCLUDED.cover_url,
                 share_url         = EXCLUDED.share_url,
                 likes             = EXCLUDED.likes,
                 comments          = EXCLUDED.comments,
                 shares            = EXCLUDED.shares,
                 views             = EXCLUDED.views,
                 engagement        = EXCLUDED.engagement,
                 duration_seconds  = EXCLUDED.duration_seconds,
                 video_description = EXCLUDED.video_description,
                 embed_html        = EXCLUDED.embed_html,
                 embed_link        = EXCLUDED.embed_link,
                 height            = EXCLUDED.height,
                 width             = EXCLUDED.width,
                 fetched_at        = NOW(),
                 raw_data          = EXCLUDED.raw_data`,
              [
                auth.userId, acct.id, String(v.id),
                typeof v.title === 'string' ? v.title.slice(0, 500) : null,
                typeof v.cover_image_url === 'string' ? v.cover_image_url : null,
                typeof v.share_url === 'string' ? v.share_url : null,
                likes, comments, shares, views, engagement,
                Number(v.duration ?? 0),
                v.create_time ? new Date(v.create_time * 1000).toISOString() : null,
                typeof v.video_description === 'string' ? v.video_description.slice(0, 2000) : null,
                typeof v.embed_html === 'string' ? v.embed_html : null,
                typeof v.embed_link === 'string' ? v.embed_link : null,
                Number(v.height ?? 0),
                Number(v.width  ?? 0),
                JSON.stringify(v),
              ]
            );
            synced++;
          }

          // No more results or no cursor to continue
          if (!hasMore || cursor === undefined) break;
        }
      } catch (vidErr: any) {
        errors.push(`Video sync failed: ${vidErr.message}`);
      }
    }

    return res.json({ success: true, synced, errors: errors.length > 0 ? errors : undefined });
  } catch (err) {
    console.error('TikTok sync error:', err);
    return res.status(500).json({ success: false, error: 'TikTok sync failed' });
  }
});

// GET /api/social/tiktok/videos — all synced video insights for the authenticated user
// No days filter — returns all videos ever synced, sorted by posted_at DESC.
// The `days` param (if provided) is used only to label the summary, not to filter.
app.get('/api/social/tiktok/videos', async (req: Request, res: Response) => {
  try {
    const auth = requireAuth(req, res);
    if (!auth) return;
    if (!pool) return res.status(503).json({ success: false, error: 'DB not ready' });

    const q = req.query as any;
    const days = Math.min(365, Math.max(1, parseInt(q.days || '30', 10)));
    const limit = Math.min(200, Math.max(1, parseInt(q.limit || '100', 10)));
    const offset = Math.max(0, parseInt(q.offset || '0', 10));
    const accountId = q.account_id ? String(q.account_id) : null;

    const params: any[] = [auth.userId];
    let accountFilter = '';
    if (accountId) {
      params.push(accountId);
      accountFilter = `AND tvi.social_account_id = $${params.length}`;
    }
    params.push(limit, offset);

    const videosRes = await pool.query(
      `SELECT tvi.*, sa.account_name, sa.handle
       FROM tiktok_video_insights tvi
       JOIN social_accounts sa ON sa.id = tvi.social_account_id
       WHERE tvi.user_id = $1
         ${accountFilter}
       ORDER BY COALESCE(tvi.posted_at, tvi.fetched_at) DESC
       LIMIT $${params.length - 1} OFFSET $${params.length}`,
      params
    );

    const countRes = await pool.query(
      `SELECT COUNT(*) FROM tiktok_video_insights tvi
       WHERE tvi.user_id = $1 ${accountFilter}`,
      params.slice(0, params.length - 2)
    );

    const summaryRes = await pool.query(
      `SELECT
         COUNT(*) AS total_videos,
         COALESCE(SUM(likes), 0) AS total_likes,
         COALESCE(SUM(comments), 0) AS total_comments,
         COALESCE(SUM(shares), 0) AS total_shares,
         COALESCE(SUM(views), 0) AS total_views,
         COALESCE(SUM(engagement), 0) AS total_engagement,
         CASE WHEN COALESCE(SUM(views), 0) > 0
              THEN ROUND((SUM(engagement)::numeric / NULLIF(SUM(views), 0)) * 100, 2)
              ELSE 0 END AS avg_engagement_rate
       FROM tiktok_video_insights tvi
       WHERE tvi.user_id = $1 ${accountFilter}`,
      params.slice(0, params.length - 2)
    );

    return res.json({
      success: true,
      videos: videosRes.rows,
      total: parseInt(countRes.rows[0]?.count || '0', 10),
      summary: summaryRes.rows[0] || {},
      days,
    });
  } catch (err) {
    console.error('TikTok videos error:', err);
    return res.status(500).json({ success: false, error: 'Failed to fetch TikTok videos' });
  }
});

// GET /api/social/tiktok/followers — get full profile snapshot for authenticated user
app.get('/api/social/tiktok/followers', async (req: Request, res: Response) => {
  try {
    const auth = requireAuth(req, res);
    if (!auth) return;
    if (!pool) return res.json({ followers: null, hasData: false });

    // TikTok is connected via OAuth → stored in social_accounts.
    // The sync writes all profile stats to social_profile_stats.
    const { rows: accounts } = await pool.query(
      `SELECT
         sa.id, sa.account_name, sa.handle, sa.followers AS sa_followers,
         sps.followers, sps.following, sps.posts_count,
         sps.total_likes, sps.bio, sps.is_verified, sps.synced_at
       FROM social_accounts sa
       LEFT JOIN social_profile_stats sps ON sps.social_account_id = sa.id
       WHERE sa.user_id = $1
         AND sa.connected = true
         AND (sa.platform = 'tiktok' OR sa.platform ILIKE 'tiktok')
       ORDER BY sps.synced_at DESC NULLS LAST
       LIMIT 1`,
      [auth.userId]
    );

    if (!accounts.length) {
      return res.json({ followers: null, hasData: false });
    }

    const row = accounts[0];
    const followers = row.followers ?? row.sa_followers ?? null;
    const hasData = followers !== null || row.following !== null || row.posts_count !== null;

    return res.json({
      hasData,
      followers:    followers    !== null ? Number(followers)         : null,
      following:    row.following    !== null ? Number(row.following)    : null,
      posts_count:  row.posts_count  !== null ? Number(row.posts_count)  : null,
      total_likes:  row.total_likes  !== null ? Number(row.total_likes)  : null,
      bio:          row.bio          ?? null,
      is_verified:  row.is_verified  ?? null,
      display_name: row.account_name ?? null,
      handle:       row.handle       ?? null,
      synced_at:    row.synced_at    ?? null,
    });
  } catch (err) {
    console.error('TikTok followers error:', err);
    return res.json({ followers: null, hasData: false });
  }
});

// ─── Facebook Pages Analytics routes ───────────────────────────────────────────

// POST /api/social/facebook/sync — manual sync of Facebook page data + posts
app.post('/api/social/facebook/sync', async (req: Request, res: Response) => {
  try {
    const auth = requireAuth(req, res);
    if (!auth) return;
    if (!pool) return res.status(503).json({ success: false, error: 'DB not ready' });

    const accountRes = await pool.query(
      `SELECT id, account_id, access_token, access_token_encrypted, refresh_token, refresh_token_encrypted, token_data
       FROM social_accounts WHERE user_id=$1 AND platform='facebook' AND connected=true`,
      [auth.userId]
    );
    if (accountRes.rows.length === 0) {
      return res.status(404).json({ success: false, error: 'No connected Facebook account found' });
    }

    let synced = 0;
    const errors: string[] = [];

    for (const acct of accountRes.rows as any[]) {
      let token = '';
      if (acct.access_token_encrypted) {
        try { token = decryptIntegrationSecret(String(acct.access_token_encrypted)); } catch { /* */ }
      }
      if (!token) token = String(acct.access_token || '').trim();
      if (!token) { errors.push('No access token available'); continue; }

      const pageId = String(acct.account_id);
      const GRAPH_BASE = 'https://graph.facebook.com/v19.0';

      // ── Page Profile Sync ─────────────────────────────────────────────────
      try {
        const pageResp = await axios.get(
          `${GRAPH_BASE}/${pageId}`,
          {
            params: {
              fields: 'id,name,followers_count,fan_count,picture.type(large),bio',
              access_token: token,
            },
            validateStatus: () => true,
            timeout: 15000,
          }
        );

        if (pageResp.status === 200 && pageResp.data?.id) {
          const p = pageResp.data;
          const followers = Number(p.followers_count ?? 0);
          const pageLikes = Number(p.fan_count ?? 0);
          const bio = typeof p.bio === 'string' ? p.bio : null;
          const pictureUrl = typeof p.picture?.data?.url === 'string' ? p.picture.data.url : null;

          await pool.query(
            `INSERT INTO facebook_page_stats
               (id, user_id, social_account_id, platform, followers, page_likes, bio, picture_url, raw_response, synced_at)
             VALUES (gen_random_uuid()::text, $1, $2, 'facebook', $3, $4, $5, $6, $7::jsonb, NOW())
             ON CONFLICT (social_account_id) DO UPDATE SET
               followers    = CASE WHEN EXCLUDED.followers > 0 THEN EXCLUDED.followers ELSE facebook_page_stats.followers END,
               page_likes   = CASE WHEN EXCLUDED.page_likes > 0 THEN EXCLUDED.page_likes ELSE facebook_page_stats.page_likes END,
               bio          = COALESCE(EXCLUDED.bio, facebook_page_stats.bio),
               picture_url  = COALESCE(EXCLUDED.picture_url, facebook_page_stats.picture_url),
               raw_response = EXCLUDED.raw_response,
               synced_at    = NOW()`,
            [auth.userId, acct.id, followers, pageLikes, bio, pictureUrl, JSON.stringify(p)]
          );

          // Update account name if not already set
          const displayName = typeof p.name === 'string' && p.name.trim() ? p.name.trim() : null;
          await pool.query(
            `UPDATE social_accounts SET
               account_name = COALESCE($1, account_name),
               followers    = CASE WHEN $2 > 0 THEN $2 ELSE followers END
             WHERE id = $3`,
            [displayName, followers, acct.id]
          );
          synced++;
        }
      } catch (profileErr: any) {
        errors.push(`Profile sync failed: ${profileErr.message}`);
      }

      // ── Page Posts Sync ──────────────────────────────────────────────────────
      // Use cursor-based pagination to fetch all posts
      try {
        const POST_FIELDS = 'id,message,picture,story,type,created_time,shares.summary(total_count).as(shares_summary),likes.summary(total_count).as(likes_summary),comments.summary(total_count).as(comments_summary),permalink_url';
        let cursor: string | null | undefined;
        let hasMore = true;
        let pageCount = 0;
        const MAX_PAGES = 10; // safety cap — 10 pages × 100 = 1000 posts

        while (hasMore && pageCount < MAX_PAGES) {
          const params: Record<string, any> = {
            fields: POST_FIELDS,
            limit: 100,
            access_token: token,
          };
          if (cursor) params.after = cursor;

          const postsResp = await axios.get(
            `${GRAPH_BASE}/${pageId}/posts`,
            {
              params,
              validateStatus: () => true,
              timeout: 15000,
            }
          );

          if (postsResp.status !== 200) {
            if (pageCount === 0) {
              console.log(`Facebook posts endpoint error (${postsResp.status}) — skipping posts sync`);
            }
            break;
          }

          const pageData = postsResp.data?.data || [];
          const paging = postsResp.data?.paging || {};
          hasMore = !!paging.cursors?.after;
          cursor = paging.cursors?.after;
          pageCount++;

          for (const post of pageData) {
            if (!post.id) continue;

            const likes = Number(post.likes_summary?.summary?.total_count ?? 0);
            const comments = Number(post.comments_summary?.summary?.total_count ?? 0);
            const shares = Number(post.shares_summary?.summary?.total_count ?? 0);
            const engagement = likes + comments + shares;
            const createdAt = post.created_time ? new Date(post.created_time).toISOString() : null;

            await pool!.query(
              `INSERT INTO facebook_post_insights
                 (id, user_id, social_account_id, post_id, message, picture, story, type,
                  permalink_url, shares, likes_count, comments_count, engagement, created_at,
                  fetched_at, raw_data)
               VALUES (gen_random_uuid()::text, $1, $2, $3, $4, $5, $6, $7,
                       $8, $9, $10, $11, $12, $13,
                       NOW(), $14::jsonb)
               ON CONFLICT (social_account_id, post_id) DO UPDATE SET
                 message       = EXCLUDED.message,
                 picture       = EXCLUDED.picture,
                 story         = EXCLUDED.story,
                 type          = EXCLUDED.type,
                 permalink_url = EXCLUDED.permalink_url,
                 shares        = EXCLUDED.shares,
                 likes_count   = EXCLUDED.likes_count,
                 comments_count= EXCLUDED.comments_count,
                 engagement    = EXCLUDED.engagement,
                 fetched_at    = NOW(),
                 raw_data      = EXCLUDED.raw_data`,
              [
                auth.userId, acct.id, String(post.id),
                typeof post.message === 'string' ? post.message.slice(0, 5000) : null,
                typeof post.picture === 'string' ? post.picture : null,
                typeof post.story === 'string' ? post.story : null,
                typeof post.type === 'string' ? post.type : null,
                typeof post.permalink_url === 'string' ? post.permalink_url : null,
                shares, likes, comments, engagement,
                createdAt,
                JSON.stringify(post),
              ]
            );
            synced++;
          }

          // No more pages
          if (!hasMore) break;
        }
      } catch (postsErr: any) {
        errors.push(`Posts sync failed: ${postsErr.message}`);
      }
    }

    return res.json({ success: true, synced, errors: errors.length > 0 ? errors : undefined });
  } catch (err) {
    console.error('Facebook sync error:', err);
    return res.status(500).json({ success: false, error: 'Facebook sync failed' });
  }
});

// GET /api/social/facebook/posts — all synced post insights for the authenticated user
app.get('/api/social/facebook/posts', async (req: Request, res: Response) => {
  try {
    const auth = requireAuth(req, res);
    if (!auth) return;
    if (!pool) return res.status(503).json({ success: false, error: 'DB not ready' });

    const q = req.query as any;
    const days = Math.min(365, Math.max(1, parseInt(q.days || '30', 10)));
    const limit = Math.min(200, Math.max(1, parseInt(q.limit || '100', 10)));
    const offset = Math.max(0, parseInt(q.offset || '0', 10));
    const accountId = q.account_id ? String(q.account_id) : null;

    const params: any[] = [auth.userId];
    let accountFilter = '';
    if (accountId) {
      params.push(accountId);
      accountFilter = `AND fpi.social_account_id = $${params.length}`;
    }
    params.push(limit, offset);

    const postsRes = await pool.query(
      `SELECT fpi.*, sa.account_name
       FROM facebook_post_insights fpi
       JOIN social_accounts sa ON sa.id = fpi.social_account_id
       WHERE fpi.user_id = $1
         ${accountFilter}
       ORDER BY COALESCE(fpi.created_at, fpi.fetched_at) DESC
       LIMIT $${params.length - 1} OFFSET $${params.length}`,
      params
    );

    const countRes = await pool.query(
      `SELECT COUNT(*) FROM facebook_post_insights fpi
       WHERE fpi.user_id = $1 ${accountFilter}`,
      params.slice(0, params.length - 2)
    );

    const summaryRes = await pool.query(
      `SELECT
         COUNT(*) AS total_posts,
         COALESCE(SUM(likes_count), 0) AS total_likes,
         COALESCE(SUM(comments_count), 0) AS total_comments,
         COALESCE(SUM(shares), 0) AS total_shares,
         COALESCE(SUM(engagement), 0) AS total_engagement,
         CASE WHEN COUNT(*) > 0
              THEN ROUND((SUM(engagement)::numeric / NULLIF(COUNT(*), 0)), 2)
              ELSE 0 END AS avg_engagement_per_post
       FROM facebook_post_insights fpi
       WHERE fpi.user_id = $1 ${accountFilter}`,
      params.slice(0, params.length - 2)
    );

    return res.json({
      success: true,
      posts: postsRes.rows,
      total: parseInt(countRes.rows[0]?.count || '0', 10),
      summary: summaryRes.rows[0] || {},
      days,
    });
  } catch (err) {
    console.error('Facebook posts error:', err);
    return res.status(500).json({ success: false, error: 'Failed to fetch Facebook posts' });
  }
});

// GET /api/social/facebook/stats — get full page snapshot for authenticated user
app.get('/api/social/facebook/stats', async (req: Request, res: Response) => {
  try {
    const auth = requireAuth(req, res);
    if (!auth) return;
    if (!pool) return res.json({ stats: null, hasData: false });

    const { rows: pages } = await pool.query(
      `SELECT
         sa.id, sa.account_name, sa.handle, sa.followers AS sa_followers,
         fps.followers, fps.page_likes, fps.posts_count,
         fps.engagement_rate, fps.bio, fps.picture_url, fps.synced_at
       FROM social_accounts sa
       LEFT JOIN facebook_page_stats fps ON fps.social_account_id = sa.id
       WHERE sa.user_id = $1
         AND sa.connected = true
         AND (sa.platform = 'facebook' OR sa.platform ILIKE 'facebook')
       ORDER BY fps.synced_at DESC NULLS LAST
       LIMIT 1`,
      [auth.userId]
    );

    if (!pages.length) {
      return res.json({ stats: null, hasData: false });
    }

    const row = pages[0];
    const followers = row.followers ?? row.sa_followers ?? null;
    const hasData = followers !== null || row.page_likes !== null;

    return res.json({
      hasData,
      followers:      followers      !== null ? Number(followers)       : null,
      page_likes:     row.page_likes  !== null ? Number(row.page_likes)  : null,
      posts_count:    row.posts_count !== null ? Number(row.posts_count) : null,
      engagement_rate:row.engagement_rate !== null ? Number(row.engagement_rate) : null,
      bio:            row.bio          ?? null,
      picture_url:    row.picture_url  ?? null,
      account_name:   row.account_name ?? null,
      synced_at:      row.synced_at    ?? null,
    });
  } catch (err) {
    console.error('Facebook stats error:', err);
    return res.json({ stats: null, hasData: false });
  }
});

// GET /api/social/facebook/accounts — list all connected Facebook pages and groups
app.get('/api/social/facebook/accounts', async (req: Request, res: Response) => {
  try {
    const auth = requireAuth(req, res);
    if (!auth) return;
    if (!pool) return res.status(503).json({ success: false, error: 'DB not ready' });

    const { rows: accounts } = await pool.query(
      `SELECT 
         sa.id, sa.account_id, sa.account_name, sa.account_type,
         sa.followers, sa.profile_image, sa.handle,
         fps.followers as page_followers, fps.page_likes
       FROM social_accounts sa
       LEFT JOIN facebook_page_stats fps ON fps.social_account_id = sa.id
       WHERE sa.user_id = $1
         AND sa.platform = 'facebook'
         AND sa.connected = true
       ORDER BY sa.account_type DESC, sa.account_name ASC`,
      [auth.userId]
    );

    const pages = accounts.filter((a: any) => a.account_type === 'page');
    const groups = accounts.filter((a: any) => a.account_type === 'group');

    return res.json({
      success: true,
      pages: pages.map((p: any) => ({
        id: p.id,
        account_id: p.account_id,
        name: p.account_name,
        type: p.account_type,
        followers: p.page_followers || p.followers || 0,
        likes: p.page_likes || 0,
        picture_url: p.profile_image,
      })),
      groups: groups.map((g: any) => ({
        id: g.id,
        account_id: g.account_id,
        name: g.account_name,
        type: g.account_type,
        members: g.followers || 0,
        picture_url: g.profile_image,
      })),
      total_pages: pages.length,
      total_groups: groups.length,
    });
  } catch (err) {
    console.error('Facebook accounts error:', err);
    return res.status(500).json({ success: false, error: 'Failed to fetch Facebook accounts' });
  }
});

// ─── Instagram Analytics Endpoints ────────────────────────────────────────────

// POST /api/social/instagram/sync — sync Instagram profile, insights, and media
app.post('/api/social/instagram/sync', async (req: Request, res: Response) => {
  try {
    const auth = requireAuth(req, res);
    if (!auth) return;
    if (!pool) return res.status(503).json({ success: false, error: 'DB not ready' });

    const accountRes = await pool.query(
      `SELECT id, account_id, account_name, handle, followers, profile_image, access_token, access_token_encrypted, token_data
       FROM social_accounts
       WHERE user_id=$1 AND platform='instagram' AND connected=true`,
      [auth.userId]
    );
    if (accountRes.rows.length === 0) {
      return res.status(404).json({ success: false, error: 'No connected Instagram account found' });
    }

    let synced = 0;
    const errors: string[] = [];

    for (const acct of accountRes.rows as any[]) {
      const result = await syncInstagramAnalyticsAccount({
        userId: auth.userId,
        account: acct,
        days: 30,
      });
      synced += result.synced;
      errors.push(...result.errors);
    }

    return res.json({ success: true, synced, errors: errors.length > 0 ? errors : undefined });
  } catch (err) {
    console.error('Instagram sync error:', err);
    return res.status(500).json({ success: false, error: 'Instagram sync failed' });
  }
});

// GET /api/social/instagram/profile — get Instagram profile snapshot for authenticated user
app.get('/api/social/instagram/profile', async (req: Request, res: Response) => {
  try {
    const auth = requireAuth(req, res);
    if (!auth) return;
    if (!pool) return res.json({ profile: null, hasData: false });

    const { rows } = await pool.query(
      `SELECT
         sa.id,
         sa.account_name,
         sa.handle,
         sa.followers AS sa_followers,
         sa.profile_image,
         sa.token_data,
         sps.followers,
         sps.following,
         sps.posts_count,
         sps.bio,
         sps.is_verified,
         sps.synced_at
       FROM social_accounts sa
       LEFT JOIN social_profile_stats sps ON sps.social_account_id = sa.id
       WHERE sa.user_id = $1
         AND sa.platform = 'instagram'
         AND sa.connected = true
       ORDER BY sps.synced_at DESC NULLS LAST, sa.connected_at DESC NULLS LAST
       LIMIT 1`,
      [auth.userId]
    );

    if (!rows.length) {
      return res.json({ profile: null, hasData: false });
    }

    const row: any = rows[0];
    const tokenData = row.token_data || {};
    const followers = row.followers ?? row.sa_followers ?? null;
    const hasData = followers !== null || row.posts_count !== null || Boolean(row.account_name);

    return res.json({
      hasData,
      followers: followers !== null ? Number(followers) : null,
      following: row.following !== null ? Number(row.following) : null,
      posts_count: row.posts_count !== null ? Number(row.posts_count) : null,
      bio: row.bio ?? null,
      is_verified: row.is_verified === true,
      account_name: row.account_name ?? tokenData?.instagramName ?? null,
      handle: row.handle ?? tokenData?.instagramUsername ?? null,
      picture_url: row.profile_image ?? tokenData?.profilePictureUrl ?? null,
      account_type: tokenData?.accountType ?? null,
      page_name: tokenData?.pageName ?? null,
      page_id: tokenData?.pageId ?? null,
      website: tokenData?.website ?? null,
      synced_at: row.synced_at ?? null,
    });
  } catch (err) {
    console.error('Instagram profile error:', err);
    return res.json({ profile: null, hasData: false });
  }
});

// GET /api/social/instagram/posts — all synced Instagram media for the authenticated user
app.get('/api/social/instagram/posts', async (req: Request, res: Response) => {
  try {
    const auth = requireAuth(req, res);
    if (!auth) return;
    if (!pool) return res.status(503).json({ success: false, error: 'DB not ready' });

    const q = req.query as any;
    const days = Math.min(365, Math.max(1, parseInt(q.days || '30', 10)));
    const limit = Math.min(200, Math.max(1, parseInt(q.limit || '100', 10)));
    const offset = Math.max(0, parseInt(q.offset || '0', 10));
    const accountId = q.account_id ? String(q.account_id).trim() : '';
    const sinceDate = new Date(Date.now() - days * 24 * 60 * 60 * 1000);

    const params: any[] = [auth.userId, sinceDate];
    let accountFilter = '';
    if (accountId) {
      params.push(accountId);
      accountFilter = `AND sm.social_account_id = $${params.length}`;
    }
    params.push(limit, offset);

    const postsRes = await pool.query(
      `SELECT sm.*, sa.account_name, sa.handle
       FROM social_metrics sm
       JOIN social_accounts sa ON sa.id = sm.social_account_id
       WHERE sm.user_id = $1
         AND sm.platform = 'instagram'
         AND (sm.posted_at IS NULL OR sm.posted_at >= $2)
         ${accountFilter}
       ORDER BY COALESCE(sm.posted_at, sm.fetched_at) DESC
       LIMIT $${params.length - 1} OFFSET $${params.length}`,
      params
    );

    const countRes = await pool.query(
      `SELECT COUNT(*)
       FROM social_metrics sm
       WHERE sm.user_id = $1
         AND sm.platform = 'instagram'
         AND (sm.posted_at IS NULL OR sm.posted_at >= $2)
         ${accountFilter}`,
      params.slice(0, params.length - 2)
    );

    const summaryRes = await pool.query(
      `SELECT
         COUNT(*) AS total_posts,
         COALESCE(SUM(likes), 0) AS total_likes,
         COALESCE(SUM(comments), 0) AS total_comments,
         COALESCE(SUM(shares), 0) AS total_shares,
         COALESCE(SUM(saves), 0) AS total_saves,
         COALESCE(SUM(impressions), 0) AS total_impressions,
         COALESCE(SUM(reach), 0) AS total_reach,
         COALESCE(SUM(engagement), 0) AS total_engagement,
         CASE WHEN COALESCE(SUM(impressions), 0) > 0
              THEN ROUND((SUM(engagement)::numeric / NULLIF(SUM(impressions), 0)) * 100, 2)
              ELSE 0 END AS avg_engagement_rate
       FROM social_metrics sm
       WHERE sm.user_id = $1
         AND sm.platform = 'instagram'
         AND (sm.posted_at IS NULL OR sm.posted_at >= $2)
         ${accountFilter}`,
      params.slice(0, params.length - 2)
    );

    const posts = postsRes.rows.map((row: any) => {
      const raw = row.raw_data || {};
      const media = raw?.media || {};
      const account = raw?.account || {};
      return {
        ...row,
        media_id: row.platform_post_id,
        caption: media?.caption || null,
        media_type: media?.media_type || null,
        media_product_type: media?.media_product_type || null,
        media_url: media?.media_url || null,
        thumbnail_url: media?.thumbnail_url || null,
        permalink: media?.permalink || null,
        instagram_username: account?.instagramUsername || row.handle || null,
      };
    });

    return res.json({
      success: true,
      posts,
      total: parseInt(countRes.rows[0]?.count || '0', 10),
      summary: summaryRes.rows[0] || {
        total_posts: 0,
        total_likes: 0,
        total_comments: 0,
        total_shares: 0,
        total_saves: 0,
        total_impressions: 0,
        total_reach: 0,
        total_engagement: 0,
        avg_engagement_rate: 0,
      },
      days,
    });
  } catch (err) {
    console.error('Instagram posts error:', err);
    return res.status(500).json({ success: false, error: 'Failed to fetch Instagram posts' });
  }
});

// ─── Pinterest Analytics Endpoints ───────────────────────────────────────────

// POST /api/social/pinterest/sync — sync Pinterest profile and pins (with metrics)
app.post('/api/social/pinterest/sync', async (req: Request, res: Response) => {
  try {
    const auth = requireAuth(req, res);
    if (!auth) return;
    if (!pool) return res.status(503).json({ success: false, error: 'DB not ready' });

    const accountRes = await pool.query(
      `SELECT id, account_id, account_name, handle, followers, profile_image, access_token, access_token_encrypted, token_data
       FROM social_accounts
       WHERE user_id=$1 AND platform='pinterest' AND connected=true AND account_type='profile'
       ORDER BY connected_at DESC NULLS LAST, created_at DESC NULLS LAST
       LIMIT 1`,
      [auth.userId]
    );

    if (accountRes.rows.length === 0) {
      return res.status(404).json({ success: false, error: 'No connected Pinterest account found' });
    }

    const result = await syncPinterestAnalyticsAccount({
      userId: auth.userId,
      account: accountRes.rows[0],
      days: 30,
      maxPins: 250,
    });

    return res.json({
      success: true,
      synced: result.synced,
      errors: result.errors.length > 0 ? result.errors : undefined,
    });
  } catch (err) {
    console.error('Pinterest sync error:', err);
    return res.status(500).json({ success: false, error: 'Pinterest sync failed' });
  }
});

// GET /api/social/pinterest/profile — get Pinterest profile snapshot for authenticated user
app.get('/api/social/pinterest/profile', async (req: Request, res: Response) => {
  try {
    const auth = requireAuth(req, res);
    if (!auth) return;
    if (!pool) {
      return res.json({
        hasData: false,
        followers: null,
        following: null,
        posts_count: null,
        bio: null,
        account_name: null,
        handle: null,
        picture_url: null,
        website: null,
        monthly_views: null,
        synced_at: null,
      });
    }

    const { rows } = await pool.query(
      `SELECT
         sa.id,
         sa.account_id,
         sa.account_name,
         sa.handle,
         sa.followers AS sa_followers,
         sa.profile_image,
         sps.followers,
         sps.following,
         sps.posts_count,
         sps.bio,
         sps.raw_response,
         sps.synced_at
       FROM social_accounts sa
       LEFT JOIN social_profile_stats sps ON sps.social_account_id = sa.id
       WHERE sa.user_id = $1
         AND sa.platform = 'pinterest'
         AND sa.account_type = 'profile'
         AND sa.connected = true
       ORDER BY sps.synced_at DESC NULLS LAST, sa.connected_at DESC NULLS LAST
       LIMIT 1`,
      [auth.userId]
    );

    if (!rows.length) {
      return res.json({
        hasData: false,
        followers: null,
        following: null,
        posts_count: null,
        bio: null,
        account_name: null,
        handle: null,
        picture_url: null,
        website: null,
        monthly_views: null,
        synced_at: null,
      });
    }

    const row: any = rows[0];
    const raw = row.raw_response || {};

    const followers = row.followers ?? row.sa_followers ?? null;
    const hasData = followers !== null || row.posts_count !== null || Boolean(row.account_name) || Boolean(row.handle);

    return res.json({
      hasData,
      followers: followers !== null ? Number(followers) : null,
      following: row.following !== null ? Number(row.following) : null,
      posts_count: row.posts_count !== null ? Number(row.posts_count) : raw?.pin_count != null ? Number(raw.pin_count) : null,
      bio: row.bio ?? null,
      account_name: row.account_name ?? raw?.business_name ?? raw?.username ?? null,
      handle: row.handle ?? raw?.username ?? null,
      picture_url: row.profile_image ?? raw?.profile_image ?? null,
      website: raw?.website_url ?? null,
      monthly_views: raw?.monthly_views != null ? Number(raw.monthly_views) : null,
      synced_at: row.synced_at ?? null,
    });
  } catch (err) {
    console.error('Pinterest profile error:', err);
    return res.json({
      hasData: false,
      followers: null,
      following: null,
      posts_count: null,
      bio: null,
      account_name: null,
      handle: null,
      picture_url: null,
      website: null,
      monthly_views: null,
      synced_at: null,
    });
  }
});

// GET /api/social/pinterest/pins — all synced Pinterest pins for the authenticated user
app.get('/api/social/pinterest/pins', async (req: Request, res: Response) => {
  try {
    const auth = requireAuth(req, res);
    if (!auth) return;
    if (!pool) return res.status(503).json({ success: false, error: 'DB not ready' });

    const q = req.query as any;
    const days = Math.min(365, Math.max(1, parseInt(q.days || '90', 10)));
    const limit = Math.min(200, Math.max(1, parseInt(q.limit || '100', 10)));
    const offset = Math.max(0, parseInt(q.offset || '0', 10));
    const accountId = q.account_id ? String(q.account_id).trim() : '';
    const boardId = q.board_id ? String(q.board_id).trim() : '';
    const sinceDate = new Date(Date.now() - days * 24 * 60 * 60 * 1000);

    const params: any[] = [auth.userId, sinceDate];
    let extraFilter = '';
    if (accountId) {
      params.push(accountId);
      extraFilter += `AND sm.social_account_id = $${params.length}\n`;
    }
    if (boardId) {
      params.push(boardId);
      extraFilter += `AND (sm.raw_data->'pin'->>'board_id') = $${params.length}\n`;
    }
    const baseParams = params.slice();
    params.push(limit, offset);

    const pinsRes = await pool.query(
      `SELECT sm.*, sa.account_name, sa.handle
       FROM social_metrics sm
       JOIN social_accounts sa ON sa.id = sm.social_account_id
       WHERE sm.user_id = $1
         AND sm.platform = 'pinterest'
         AND (sm.posted_at IS NULL OR sm.posted_at >= $2)
         ${extraFilter}
       ORDER BY COALESCE(sm.posted_at, sm.fetched_at) DESC
       LIMIT $${params.length - 1} OFFSET $${params.length}`,
      params
    );

    const countRes = await pool.query(
      `SELECT COUNT(*)
       FROM social_metrics sm
       WHERE sm.user_id = $1
         AND sm.platform = 'pinterest'
         AND (sm.posted_at IS NULL OR sm.posted_at >= $2)
         ${extraFilter}`,
      baseParams
    );

    const summaryRes = await pool.query(
      `SELECT
         COUNT(*) AS total_pins,
         COALESCE(SUM(impressions), 0) AS total_impressions,
         COALESCE(SUM(clicks), 0) AS total_outbound_clicks,
         COALESCE(SUM(saves), 0) AS total_saves,
         COALESCE(SUM(likes), 0) AS total_reactions,
         COALESCE(SUM(comments), 0) AS total_comments,
         COALESCE(SUM(engagement), 0) AS total_engagement,
         COALESCE(SUM(
           CASE
             WHEN (raw_data->'metrics'->>'pin_click') ~ '^\\d+(\\.\\d+)?$'
             THEN (raw_data->'metrics'->>'pin_click')::numeric
             ELSE 0
           END
         ), 0) AS total_pin_clicks,
         CASE WHEN COALESCE(SUM(impressions), 0) > 0
              THEN ROUND((SUM(engagement)::numeric / NULLIF(SUM(impressions), 0)) * 100, 2)
              ELSE 0 END AS avg_engagement_rate
       FROM social_metrics sm
       WHERE sm.user_id = $1
         AND sm.platform = 'pinterest'
         AND (sm.posted_at IS NULL OR sm.posted_at >= $2)
         ${extraFilter}`,
      baseParams
    );

    const pins = pinsRes.rows.map((row: any) => {
      const raw = row.raw_data || {};
      const pin = raw?.pin || {};
      const metrics = raw?.metrics || {};
      const media = pin?.media || {};
      const images = media?.images || {};

      const imageUrl =
        images?.['400x300']?.url ||
        images?.['150x150']?.url ||
        images?.['600x']?.url ||
        null;

      return {
        ...row,
        pin_id: row.platform_post_id,
        title: pin?.title ?? null,
        description: pin?.description ?? null,
        link: pin?.link ?? null,
        board_id: pin?.board_id ?? null,
        creative_type: pin?.creative_type ?? null,
        media_url: imageUrl,
        pin_clicks: metrics?.pin_click ?? null,
        outbound_clicks: metrics?.outbound_clicks ?? row.clicks ?? null,
        saves_count: metrics?.saves ?? row.saves ?? null,
        created_at: row.posted_at ?? pin?.created_at ?? null,
      };
    });

    return res.json({
      success: true,
      pins,
      total: parseInt(countRes.rows[0]?.count || '0', 10),
      summary: summaryRes.rows[0] || {
        total_pins: 0,
        total_impressions: 0,
        total_outbound_clicks: 0,
        total_saves: 0,
        total_reactions: 0,
        total_comments: 0,
        total_engagement: 0,
        total_pin_clicks: 0,
        avg_engagement_rate: 0,
      },
      days,
    });
  } catch (err) {
    console.error('Pinterest pins error:', err);
    return res.status(500).json({ success: false, error: 'Failed to fetch Pinterest pins' });
  }
});

// GET /api/social/pinterest/boards-performance — aggregated board performance from synced pins
app.get('/api/social/pinterest/boards-performance', async (req: Request, res: Response) => {
  try {
    const auth = requireAuth(req, res);
    if (!auth) return;
    if (!pool) return res.status(503).json({ success: false, error: 'DB not ready' });

    const q = req.query as any;
    const days = Math.min(365, Math.max(1, parseInt(q.days || '90', 10)));
    const sinceDate = new Date(Date.now() - days * 24 * 60 * 60 * 1000);

    const { rows } = await pool.query(
      `SELECT
         COALESCE(sm.raw_data->'pin'->>'board_id', '') AS board_id,
         MAX(sa_board.account_name) AS board_name,
         COUNT(*)::int AS total_pins,
         COALESCE(SUM(sm.impressions), 0) AS total_impressions,
         COALESCE(SUM(sm.clicks), 0) AS total_outbound_clicks,
         COALESCE(SUM(sm.saves), 0) AS total_saves,
         COALESCE(SUM(sm.likes), 0) AS total_reactions,
         COALESCE(SUM(sm.comments), 0) AS total_comments,
         COALESCE(SUM(sm.engagement), 0) AS total_engagement,
         MAX(COALESCE(sm.posted_at, sm.fetched_at)) AS last_activity,
         CASE WHEN COALESCE(SUM(sm.impressions), 0) > 0
              THEN ROUND((SUM(sm.engagement)::numeric / NULLIF(SUM(sm.impressions), 0)) * 100, 2)
              ELSE 0 END AS engagement_rate
       FROM social_metrics sm
       LEFT JOIN social_accounts sa_board
         ON sa_board.user_id = sm.user_id
        AND sa_board.platform = 'pinterest'
        AND sa_board.account_type = 'board'
        AND sa_board.account_id = (sm.raw_data->'pin'->>'board_id')
       WHERE sm.user_id = $1
         AND sm.platform = 'pinterest'
         AND (sm.posted_at IS NULL OR sm.posted_at >= $2)
         AND COALESCE(sm.raw_data->'pin'->>'board_id', '') <> ''
       GROUP BY board_id
       ORDER BY COALESCE(SUM(sm.impressions), 0) DESC, COALESCE(SUM(sm.engagement), 0) DESC, COUNT(*) DESC
       LIMIT 200`,
      [auth.userId, sinceDate]
    );

    const boards = rows.map((row: any) => ({
      board_id: String(row.board_id || '').trim(),
      board_name: row.board_name ? String(row.board_name) : null,
      total_pins: Number(row.total_pins || 0),
      total_impressions: Number(row.total_impressions || 0),
      total_outbound_clicks: Number(row.total_outbound_clicks || 0),
      total_saves: Number(row.total_saves || 0),
      total_reactions: Number(row.total_reactions || 0),
      total_comments: Number(row.total_comments || 0),
      total_engagement: Number(row.total_engagement || 0),
      engagement_rate: Number(row.engagement_rate || 0),
      last_activity: row.last_activity ? new Date(row.last_activity).toISOString() : null,
    })).filter((b: any) => b.board_id);

    return res.json({ success: true, boards, days });
  } catch (err) {
    console.error('Pinterest boards performance error:', err);
    return res.status(500).json({ success: false, error: 'Failed to fetch Pinterest board performance' });
  }
});

// ─── Threads Analytics Endpoints ───────────────────────────────────────────

// POST /api/social/threads/sync — sync Threads profile + post insights
app.post('/api/social/threads/sync', async (req: Request, res: Response) => {
  try {
    const auth = requireAuth(req, res);
    if (!auth) return;
    if (!pool) return res.status(503).json({ success: false, error: 'DB not ready' });

    const accountRes = await pool.query(
      `SELECT id, account_id, account_name, handle, followers, profile_image, access_token, access_token_encrypted, token_data
       FROM social_accounts
       WHERE user_id=$1 AND platform='threads' AND connected=true AND account_type='profile'
       ORDER BY connected_at DESC NULLS LAST, created_at DESC NULLS LAST
       LIMIT 1`,
      [auth.userId]
    );

    if (accountRes.rows.length === 0) {
      return res.status(404).json({ success: false, error: 'No connected Threads account found' });
    }

    const tokenConn = await getPublishableSocialConnection(auth.userId, 'threads');
    if (!tokenConn || tokenConn.needs_reapproval || !tokenConn.access_token) {
      return res.status(400).json({ success: false, error: 'Threads access token missing or expired — reconnect Threads.' });
    }

    const result = await syncThreadsAnalyticsAccount({
      userId: auth.userId,
      account: { ...accountRes.rows[0], access_token: tokenConn.access_token, access_token_encrypted: null },
      days: 30,
      maxPosts: 120,
    });

    return res.json({
      success: true,
      synced: result.synced,
      errors: result.errors.length > 0 ? result.errors : undefined,
    });
  } catch (err) {
    console.error('Threads sync error:', err);
    return res.status(500).json({ success: false, error: 'Threads sync failed' });
  }
});

// GET /api/social/threads/profile — get Threads profile snapshot for authenticated user
app.get('/api/social/threads/profile', async (req: Request, res: Response) => {
  try {
    const auth = requireAuth(req, res);
    if (!auth) return;
    if (!pool) {
      return res.json({
        hasData: false,
        followers: null,
        posts_count: null,
        total_likes: null,
        total_views: null,
        total_replies: null,
        total_reposts: null,
        total_quotes: null,
        total_clicks: null,
        follower_demographics: null,
        bio: null,
        is_verified: null,
        account_name: null,
        handle: null,
        picture_url: null,
        synced_at: null,
      });
    }

    const { rows } = await pool.query(
      `SELECT
         sa.id,
         sa.account_id,
         sa.account_name,
         sa.handle,
         sa.followers AS sa_followers,
         sa.profile_image,
         sa.token_data,
         sps.followers,
         sps.posts_count,
         sps.total_likes,
         sps.bio,
         sps.is_verified,
         sps.raw_response,
         sps.synced_at
       FROM social_accounts sa
       LEFT JOIN social_profile_stats sps ON sps.social_account_id = sa.id
       WHERE sa.user_id = $1
         AND sa.platform = 'threads'
         AND sa.account_type = 'profile'
         AND sa.connected = true
       ORDER BY sps.synced_at DESC NULLS LAST, sa.connected_at DESC NULLS LAST
       LIMIT 1`,
      [auth.userId]
    );

    if (!rows.length) {
      return res.json({
        hasData: false,
        followers: null,
        posts_count: null,
        total_likes: null,
        total_views: null,
        total_replies: null,
        total_reposts: null,
        total_quotes: null,
        total_clicks: null,
        follower_demographics: null,
        bio: null,
        is_verified: null,
        account_name: null,
        handle: null,
        picture_url: null,
        synced_at: null,
      });
    }

    const row: any = rows[0];
    const tokenData = row.token_data || {};
    const raw = row.raw_response || {};
    const rawProfile = raw?.profile || {};

    const followers = row.followers ?? row.sa_followers ?? null;
    const hasData =
      followers !== null ||
      row.posts_count !== null ||
      Boolean(row.account_name) ||
      Boolean(row.handle);

    const bio =
      row.bio ??
      (typeof rawProfile?.threads_biography === 'string' ? rawProfile.threads_biography : null) ??
      (typeof tokenData?.about === 'string' ? tokenData.about : null) ??
      null;

    const pictureUrl =
      row.profile_image ??
      (typeof rawProfile?.threads_profile_picture_url === 'string' ? rawProfile.threads_profile_picture_url : null) ??
      (typeof tokenData?.avatar_url === 'string' ? tokenData.avatar_url : null) ??
      null;

    const handle =
      row.handle ??
      (typeof rawProfile?.username === 'string' ? rawProfile.username : null) ??
      (typeof tokenData?.username === 'string' ? tokenData.username : null) ??
      null;

    const accountName =
      row.account_name ??
      (typeof rawProfile?.name === 'string' ? rawProfile.name : null) ??
      (typeof tokenData?.name === 'string' ? tokenData.name : null) ??
      null;

    const isVerified =
      row.is_verified === true ||
      rawProfile?.is_verified === true ||
      tokenData?.is_verified === true;

    const metricNumOrNull = (value: any): number | null => {
      if (value === null || value === undefined) return null;
      const n = typeof value === 'number' ? value : parseFloat(String(value));
      return Number.isFinite(n) ? n : null;
    };

    const accountMetrics = raw?.account_metrics || {};
    const followerDemographics = raw?.follower_demographics || null;

    return res.json({
      hasData,
      followers: followers !== null ? Number(followers) : null,
      posts_count: row.posts_count !== null ? Number(row.posts_count) : null,
      total_likes: row.total_likes !== null ? Number(row.total_likes) : null,
      total_views: metricNumOrNull(accountMetrics?.views),
      total_replies: metricNumOrNull(accountMetrics?.replies),
      total_reposts: metricNumOrNull(accountMetrics?.reposts),
      total_quotes: metricNumOrNull(accountMetrics?.quotes),
      total_clicks: metricNumOrNull(accountMetrics?.clicks),
      follower_demographics: followerDemographics,
      bio,
      is_verified: isVerified,
      account_name: accountName,
      handle,
      picture_url: pictureUrl,
      synced_at: row.synced_at ?? null,
    });
  } catch (err) {
    console.error('Threads profile error:', err);
    return res.json({
      hasData: false,
      followers: null,
      posts_count: null,
      total_likes: null,
      total_views: null,
      total_replies: null,
      total_reposts: null,
      total_quotes: null,
      total_clicks: null,
      follower_demographics: null,
      bio: null,
      is_verified: null,
      account_name: null,
      handle: null,
      picture_url: null,
      synced_at: null,
    });
  }
});

// GET /api/social/threads/posts — all synced Threads posts for the authenticated user
app.get('/api/social/threads/posts', async (req: Request, res: Response) => {
  try {
    const auth = requireAuth(req, res);
    if (!auth) return;
    if (!pool) return res.status(503).json({ success: false, error: 'DB not ready' });

    const q = req.query as any;
    const days = Math.min(365, Math.max(1, parseInt(q.days || '30', 10)));
    const limit = Math.min(200, Math.max(1, parseInt(q.limit || '100', 10)));
    const offset = Math.max(0, parseInt(q.offset || '0', 10));
    const accountId = q.account_id ? String(q.account_id).trim() : '';
    const sinceDate = new Date(Date.now() - days * 24 * 60 * 60 * 1000);

    const params: any[] = [auth.userId, sinceDate];
    let accountFilter = '';
    if (accountId) {
      params.push(accountId);
      accountFilter = `AND sm.social_account_id = $${params.length}`;
    }
    params.push(limit, offset);

    const postsRes = await pool.query(
      `SELECT sm.*, sa.account_name, sa.handle
       FROM social_metrics sm
       JOIN social_accounts sa ON sa.id = sm.social_account_id
       WHERE sm.user_id = $1
         AND sm.platform = 'threads'
         AND (sm.posted_at IS NULL OR sm.posted_at >= $2)
         ${accountFilter}
       ORDER BY COALESCE(sm.posted_at, sm.fetched_at) DESC
       LIMIT $${params.length - 1} OFFSET $${params.length}`,
      params
    );

    const countRes = await pool.query(
      `SELECT COUNT(*)
       FROM social_metrics sm
       WHERE sm.user_id = $1
         AND sm.platform = 'threads'
         AND (sm.posted_at IS NULL OR sm.posted_at >= $2)
         ${accountFilter}`,
      params.slice(0, params.length - 2)
    );

    const summaryRes = await pool.query(
      `SELECT
         COUNT(*) AS total_posts,
         COALESCE(SUM(impressions), 0) AS total_views,
         COALESCE(SUM(likes), 0) AS total_likes,
         COALESCE(SUM(comments), 0) AS total_replies,
         COALESCE(SUM(shares), 0) AS total_shares,
         COALESCE(SUM(engagement), 0) AS total_engagement,
         COALESCE(SUM(COALESCE(NULLIF(sm.raw_data->'metrics'->>'reposts', '')::numeric, 0)), 0) AS total_reposts,
         COALESCE(SUM(COALESCE(NULLIF(sm.raw_data->'metrics'->>'quotes', '')::numeric, 0)), 0) AS total_quotes,
         CASE WHEN COALESCE(SUM(impressions), 0) > 0
              THEN ROUND((SUM(engagement)::numeric / NULLIF(SUM(impressions), 0)) * 100, 2)
              ELSE 0 END AS avg_engagement_rate
       FROM social_metrics sm
       WHERE sm.user_id = $1
         AND sm.platform = 'threads'
         AND (sm.posted_at IS NULL OR sm.posted_at >= $2)
         ${accountFilter}`,
      params.slice(0, params.length - 2)
    );

    const posts = postsRes.rows.map((row: any) => {
      const raw = row.raw_data || {};
      const post = raw?.post || {};
      const metrics = raw?.metrics || {};
      const metricNum = (value: any) => {
        const n = typeof value === 'number' ? value : parseFloat(String(value ?? '0'));
        return Number.isFinite(n) ? n : 0;
      };

      const mediaUrl = typeof post?.media_url === 'string' ? post.media_url : null;
      const gifUrl = typeof post?.gif_url === 'string' ? post.gif_url : null;
      return {
        ...row,
        thread_id: row.platform_post_id,
        text: typeof post?.text === 'string' ? post.text : null,
        permalink: typeof post?.permalink === 'string' ? post.permalink : null,
        username: typeof post?.username === 'string' ? post.username : (row.handle || null),
        media_product_type: typeof post?.media_product_type === 'string' ? post.media_product_type : null,
        media_type: typeof post?.media_type === 'string' ? post.media_type : null,
        media_url: mediaUrl || gifUrl,
        gif_url: gifUrl,
        thumbnail_url: typeof post?.thumbnail_url === 'string' ? post.thumbnail_url : null,
        alt_text: typeof post?.alt_text === 'string' ? post.alt_text : null,
        link_attachment_url: typeof post?.link_attachment_url === 'string' ? post.link_attachment_url : null,
        poll_attachment: post?.poll_attachment ?? null,
        location_id: post?.location_id !== undefined && post?.location_id !== null ? String(post.location_id) : null,
        topic_tag: typeof post?.topic_tag === 'string' ? post.topic_tag : null,
        is_quote_post: post?.is_quote_post === true,
        has_replies: post?.has_replies === true,
        views: row.impressions !== null && row.impressions !== undefined ? Number(row.impressions) : metricNum(metrics?.views),
        replies: row.comments !== null && row.comments !== undefined ? Number(row.comments) : metricNum(metrics?.replies),
        reposts: metricNum(metrics?.reposts),
        quotes: metricNum(metrics?.quotes),
      };
    });

    return res.json({
      success: true,
      posts,
      total: parseInt(countRes.rows[0]?.count || '0', 10),
      summary: summaryRes.rows[0] || {
        total_posts: 0,
        total_views: 0,
        total_likes: 0,
        total_replies: 0,
        total_shares: 0,
        total_engagement: 0,
        total_reposts: 0,
        total_quotes: 0,
        avg_engagement_rate: 0,
      },
      days,
    });
  } catch (err) {
    console.error('Threads posts error:', err);
    return res.status(500).json({ success: false, error: 'Failed to fetch Threads posts' });
  }
});

// GET /api/social/threads/debug-token — inspect the current Threads access token (scopes/expiry)
app.get('/api/social/threads/debug-token', async (req: Request, res: Response) => {
  try {
    const auth = requireAuth(req, res);
    if (!auth) return;

    const conn = await getPublishableSocialConnection(auth.userId, 'threads');
    if (!conn || conn.needs_reapproval || !conn.access_token) {
      return res.status(400).json({ success: false, error: 'Threads access token missing or expired — reconnect Threads.' });
    }

    const cfg = await getPlatformConfig('threads');
    const appId = String(cfg.appId || process.env.VITE_THREADS_APP_ID || process.env.VITE_THREADS_CLIENT_ID || '').trim();
    const appSecret = String(cfg.appSecret || process.env.THREADS_APP_SECRET || process.env.VITE_THREADS_APP_SECRET || '').trim();
    const appToken = appId && appSecret ? `${appId}|${appSecret}` : '';
    if (!appToken) {
      return res.status(400).json({ success: false, error: 'Threads app credentials not configured by admin' });
    }

    const resp = await axios.get('https://graph.threads.net/debug_token', {
      params: {
        input_token: conn.access_token,
        access_token: appToken,
      },
      validateStatus: () => true,
      timeout: 15000,
    });

    const data: any = resp.data || {};
    if (resp.status >= 400) {
      const msg = data?.error?.message || `Threads debug_token failed (${resp.status})`;
      return res.status(400).json({ success: false, error: msg });
    }

    return res.json({ success: true, data });
  } catch (err) {
    console.error('Threads debug-token error:', err);
    return res.status(500).json({ success: false, error: 'Failed to debug Threads token' });
  }
});

// GET /api/social/threads/replies?thread_id=... — list top-level replies for a thread
app.get('/api/social/threads/replies', async (req: Request, res: Response) => {
  try {
    const auth = requireAuth(req, res);
    if (!auth) return;

    const threadId = String((req.query as any).thread_id || '').trim();
    if (!threadId) return res.status(400).json({ success: false, error: 'thread_id is required' });

    const conn = await getPublishableSocialConnection(auth.userId, 'threads');
    if (!conn || conn.needs_reapproval || !conn.access_token) {
      return res.status(400).json({ success: false, error: 'Threads access token missing or expired — reconnect Threads.' });
    }

    const fields =
      String((req.query as any).fields || '').trim() ||
      'id,text,timestamp,media_product_type,media_type,media_url,gif_url,permalink,shortcode,thumbnail_url,username,children,is_quote_post,quoted_post,reposted_post,alt_text,link_attachment_url,has_replies,is_reply,is_reply_owned_by_me,root_post,replied_to,hide_status,reply_audience,location_id,topic_tag,is_verified,profile_picture_url,reply_approval_status';
    const limit = Math.min(100, Math.max(1, parseInt(String((req.query as any).limit || '50'), 10)));
    const after = String((req.query as any).after || '').trim();
    const reverseRaw = String((req.query as any).reverse || '').trim().toLowerCase();
    const reverse = reverseRaw === '1' || reverseRaw === 'true' || reverseRaw === 'yes';

    const threadsBase = 'https://graph.threads.net/v1.0';
    const resp = await axios.get(`${threadsBase}/${encodeURIComponent(threadId)}/replies`, {
      params: {
        fields,
        limit,
        reverse,
        ...(after ? { after } : {}),
        access_token: conn.access_token,
      },
      validateStatus: () => true,
      timeout: 20000,
    });

    const data: any = resp.data || {};
    if (resp.status >= 400) {
      const msg = data?.error?.message || `Threads replies fetch failed (${resp.status})`;
      return res.status(400).json({ success: false, error: msg });
    }

    return res.json({ success: true, data });
  } catch (err) {
    console.error('Threads replies error:', err);
    return res.status(500).json({ success: false, error: 'Failed to fetch Threads replies' });
  }
});

// POST /api/social/threads/replies/hide — hide/unhide a reply (top-level)
app.post('/api/social/threads/replies/hide', async (req: Request, res: Response) => {
  try {
    const auth = requireAuth(req, res);
    if (!auth) return;

    const { replyId, hide } = req.body as { replyId?: string; hide?: boolean };
    const rid = String(replyId || '').trim();
    if (!rid) return res.status(400).json({ success: false, error: 'replyId is required' });

    const conn = await getPublishableSocialConnection(auth.userId, 'threads');
    if (!conn || conn.needs_reapproval || !conn.access_token) {
      return res.status(400).json({ success: false, error: 'Threads access token missing or expired — reconnect Threads.' });
    }

    const threadsBase = 'https://graph.threads.net/v1.0';
    const resp = await axios.post(
      `${threadsBase}/${encodeURIComponent(rid)}/manage_reply`,
      null,
      {
        params: {
          hide: hide === false ? 'false' : 'true',
          access_token: conn.access_token,
        },
        validateStatus: () => true,
        timeout: 15000,
      }
    );
    const data: any = resp.data || {};
    if (resp.status >= 400) {
      const msg = data?.error?.message || `Threads manage_reply failed (${resp.status})`;
      return res.status(400).json({ success: false, error: msg });
    }

    return res.json({ success: true, data });
  } catch (err) {
    console.error('Threads manage-reply error:', err);
    return res.status(500).json({ success: false, error: 'Failed to manage Threads reply' });
  }
});

// POST /api/social/threads/replies/respond — create and publish a reply
app.post('/api/social/threads/replies/respond', async (req: Request, res: Response) => {
  try {
    const auth = requireAuth(req, res);
    if (!auth) return;

    const { replyToId, text } = req.body as { replyToId?: string; text?: string };
    const rid = String(replyToId || '').trim();
    const bodyText = String(text || '').trim();
    if (!rid || !bodyText) return res.status(400).json({ success: false, error: 'replyToId and text are required' });

    const conn = await getPublishableSocialConnection(auth.userId, 'threads');
    if (!conn || conn.needs_reapproval || !conn.access_token) {
      return res.status(400).json({ success: false, error: 'Threads access token missing or expired — reconnect Threads.' });
    }

    const threadsBase = 'https://graph.threads.net/v1.0';
    let threadsUserId = String(conn.token_data?.user_id || conn.token_data?.userId || conn.token_data?.id || '').trim();
    if (!threadsUserId) {
      const meResp = await axios.get(`${threadsBase}/me`, {
        params: { fields: 'id', access_token: conn.access_token },
        validateStatus: () => true,
        timeout: 15000,
      });
      const meData: any = meResp.data || {};
      if (meResp.status >= 400) {
        throw new Error(meData?.error?.message || `Threads profile lookup failed (${meResp.status})`);
      }
      threadsUserId = String(meData?.id || '').trim();
    }
    if (!threadsUserId) return res.status(400).json({ success: false, error: 'Threads user id not available' });

    const createParams = new URLSearchParams({
      media_type: 'TEXT',
      text: bodyText,
      reply_to_id: rid,
      access_token: conn.access_token,
    });
    const createResp = await axios.post(
      `${threadsBase}/${encodeURIComponent(threadsUserId)}/threads`,
      createParams.toString(),
      {
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        validateStatus: () => true,
        timeout: 15000,
      }
    );
    const createData: any = createResp.data || {};
    if (createResp.status >= 400) {
      const msg = createData?.error?.message || `Threads create reply error ${createResp.status}`;
      return res.status(400).json({ success: false, error: msg });
    }
    const creationId = String(createData?.id || '').trim();
    if (!creationId) return res.status(400).json({ success: false, error: 'Threads creation id missing' });

    const publishParams = new URLSearchParams({
      creation_id: creationId,
      access_token: conn.access_token,
    });
    const pubResp = await axios.post(
      `${threadsBase}/${encodeURIComponent(threadsUserId)}/threads_publish`,
      publishParams.toString(),
      {
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        validateStatus: () => true,
        timeout: 15000,
      }
    );
    const pubData: any = pubResp.data || {};
    if (pubResp.status >= 400) {
      const msg = pubData?.error?.message || `Threads publish reply error ${pubResp.status}`;
      return res.status(400).json({ success: false, error: msg });
    }

    const platformPostId = String(pubData?.id || '').trim();
    return res.json({ success: true, platformPostId });
  } catch (err) {
    console.error('Threads reply publish error:', err);
    return res.status(500).json({ success: false, error: err instanceof Error ? err.message : 'Failed to publish Threads reply' });
  }
});

// GET /api/social/threads/locations/search?q=... — search for locations to tag
app.get('/api/social/threads/locations/search', async (req: Request, res: Response) => {
  try {
    const auth = requireAuth(req, res);
    if (!auth) return;

    const q = String((req.query as any).q || '').trim();
    if (!q) return res.status(400).json({ success: false, error: 'q is required' });

    const conn = await getPublishableSocialConnection(auth.userId, 'threads');
    if (!conn || conn.needs_reapproval || !conn.access_token) {
      return res.status(400).json({ success: false, error: 'Threads access token missing or expired — reconnect Threads.' });
    }

    const latitude = String((req.query as any).latitude || '').trim();
    const longitude = String((req.query as any).longitude || '').trim();
    const fields =
      String((req.query as any).fields || '').trim() ||
      'id,address,city,country,name,latitude,longitude,postal_code';

    const resp = await axios.get('https://graph.threads.net/location_search', {
      params: {
        q,
        ...(latitude ? { latitude } : {}),
        ...(longitude ? { longitude } : {}),
        fields,
        access_token: conn.access_token,
      },
      validateStatus: () => true,
      timeout: 15000,
    });

    const data: any = resp.data || {};
    if (resp.status >= 400) {
      const msg = data?.error?.message || `Threads location_search failed (${resp.status})`;
      return res.status(400).json({ success: false, error: msg });
    }

    return res.json({ success: true, data });
  } catch (err) {
    console.error('Threads location search error:', err);
    return res.status(500).json({ success: false, error: 'Failed to search Threads locations' });
  }
});

// GET /api/social/threads/locations/:locationId — retrieve a location by id
app.get('/api/social/threads/locations/:locationId', async (req: Request, res: Response) => {
  try {
    const auth = requireAuth(req, res);
    if (!auth) return;

    const locationId = String(req.params.locationId || '').trim();
    if (!locationId) return res.status(400).json({ success: false, error: 'locationId is required' });

    const conn = await getPublishableSocialConnection(auth.userId, 'threads');
    if (!conn || conn.needs_reapproval || !conn.access_token) {
      return res.status(400).json({ success: false, error: 'Threads access token missing or expired — reconnect Threads.' });
    }

    const fields =
      String((req.query as any).fields || '').trim() ||
      'id,address,city,country,name,latitude,longitude,postal_code';

    const resp = await axios.get(`https://graph.threads.net/${encodeURIComponent(locationId)}`, {
      params: { fields, access_token: conn.access_token },
      validateStatus: () => true,
      timeout: 15000,
    });

    const data: any = resp.data || {};
    if (resp.status >= 400) {
      const msg = data?.error?.message || `Threads location lookup failed (${resp.status})`;
      return res.status(400).json({ success: false, error: msg });
    }

    return res.json({ success: true, data });
  } catch (err) {
    console.error('Threads location lookup error:', err);
    return res.status(500).json({ success: false, error: 'Failed to fetch Threads location' });
  }
});

// ─── LinkedIn Analytics Endpoints ──────────────────────────────────────────────

// POST /api/social/linkedin/sync — sync LinkedIn profile and posts
app.post('/api/social/linkedin/sync', async (req: Request, res: Response) => {
  try {
    const auth = requireAuth(req, res);
    if (!auth) return;
    if (!pool) return res.status(503).json({ success: false, error: 'DB not ready' });

    const accountRes = await pool.query(
      `SELECT id, account_id, access_token, access_token_encrypted, refresh_token, refresh_token_encrypted, token_data
       FROM social_accounts WHERE user_id=$1 AND platform='linkedin' AND connected=true`,
      [auth.userId]
    );
    if (accountRes.rows.length === 0) {
      return res.status(404).json({ success: false, error: 'No connected LinkedIn account found' });
    }

    let synced = 0;
    const errors: string[] = [];

    for (const acct of accountRes.rows as any[]) {
      let token = '';
      if (acct.access_token_encrypted) {
        try { token = decryptIntegrationSecret(String(acct.access_token_encrypted)); } catch { /* */ }
      }
      if (!token) token = String(acct.access_token || '').trim();
      if (!token) { errors.push('No access token available'); continue; }

      const API_BASE = 'https://api.linkedin.com/v2';

      // ── Profile Sync ─────────────────────────────────────────────────────
      try {
        const profileResp = await axios.get(
          `${API_BASE}/me`,
          {
            headers: { Authorization: `Bearer ${token}` },
            validateStatus: () => true,
            timeout: 15000,
          }
        );

        if (profileResp.status === 200 && profileResp.data?.id) {
          const profile = profileResp.data;
          const firstName = profile.localizedFirstName || profile.firstName?.localized?.[Object.keys(profile.firstName?.localized || {})[0]] || '';
          const lastName = profile.localizedLastName || profile.lastName?.localized?.[Object.keys(profile.lastName?.localized || {})[0]] || '';

          await pool.query(
            `INSERT INTO linkedin_profile_stats
               (id, user_id, social_account_id, platform, first_name, last_name, headline, profile_picture_url, raw_response, synced_at)
             VALUES (gen_random_uuid()::text, $1, $2, 'linkedin', $3, $4, $5, $6, $7::jsonb, NOW())
             ON CONFLICT (social_account_id) DO UPDATE SET
               first_name = COALESCE(EXCLUDED.first_name, linkedin_profile_stats.first_name),
               last_name = COALESCE(EXCLUDED.last_name, linkedin_profile_stats.last_name),
               headline = COALESCE(EXCLUDED.headline, linkedin_profile_stats.headline),
               profile_picture_url = COALESCE(EXCLUDED.profile_picture_url, linkedin_profile_stats.profile_picture_url),
               raw_response = EXCLUDED.raw_response,
               synced_at = NOW()`,
            [auth.userId, acct.id, firstName, lastName, profile.headline?.localized?.[Object.keys(profile.headline?.localized || {})[0]] || null, 
             profile.profilePicture?.displayImage || null, JSON.stringify(profile)]
          );

          // Update account name
          const displayName = `${firstName} ${lastName}`.trim();
          await pool.query(
            `UPDATE social_accounts SET account_name = \$1 WHERE id = \$2`,
            [displayName, acct.id]
          );
          synced++;
        }
      } catch (profileErr: any) {
        errors.push(`Profile sync failed: ${profileErr.message}`);
      }

      // ── Posts Sync (UGC Posts) ────────────────────────────────────────────
      try {
        const postsResp = await axios.get(
          `${API_BASE}/ugcPosts`,
          {
            params: {
              q: 'authors',
              authors: `urn:li:person:${acct.account_id}`,
              count: 100,
            },
            headers: { Authorization: `Bearer ${token}` },
            validateStatus: () => true,
            timeout: 15000,
          }
        );

        if (postsResp.status === 200 && postsResp.data?.elements) {
          for (const post of postsResp.data.elements) {
            if (!post.id) continue;

            const createdAt = post.created?.time ? new Date(post.created.time).toISOString() : null;

            await pool.query(
              `INSERT INTO linkedin_post_metrics
                 (id, user_id, social_account_id, post_id, text, post_url, media_type, created_at, fetched_at, raw_data)
                VALUES (gen_random_uuid()::text, \$1, \$2, \$3, \$4, \$5, \$6, \$7, NOW(), \$8::jsonb)
                ON CONFLICT (social_account_id, post_id) DO UPDATE SET
                  text = EXCLUDED.text,
                  post_url = EXCLUDED.post_url,
                  media_type = EXCLUDED.media_type,
                  fetched_at = NOW(),
                  raw_data = EXCLUDED.raw_data`,
              [
                auth.userId, acct.id, String(post.id),
                post.specificContent?.com?.linkedin?.ugcPost?.content?.com?.linkedin?.ugcPost?.shareCommentary?.text?.slice(0, 5000) || null,
                `https://www.linkedin.com/feed/update/${post.id}` || null,
                post.specificContent?.com?.linkedin?.ugcPost?.content?.media?.length > 0 ? 'media' : 'text',
                createdAt,
                JSON.stringify(post),
              ]
            );
            synced++;
          }
        }
      } catch (postsErr: any) {
        errors.push(`Posts sync failed: ${postsErr.message}`);
      }
    }

    return res.json({ success: true, synced, errors: errors.length > 0 ? errors : undefined });
  } catch (err) {
    console.error('LinkedIn sync error:', err);
    return res.status(500).json({ success: false, error: 'LinkedIn sync failed' });
  }
});

// GET /api/social/linkedin/profile — get LinkedIn profile snapshot for authenticated user
app.get('/api/social/linkedin/profile', async (req: Request, res: Response) => {
  try {
    const auth = requireAuth(req, res);
    if (!auth) return;
    if (!pool) return res.json({ profile: null, hasData: false });

    const { rows: profile } = await pool.query(
      `SELECT
         sa.id, sa.account_name, sa.handle, sa.followers,
         lps.first_name, lps.last_name, lps.headline, lps.connections_count, 
         lps.profile_picture_url, lps.synced_at
       FROM social_accounts sa
       LEFT JOIN linkedin_profile_stats lps ON lps.social_account_id = sa.id
       WHERE sa.user_id = \$1
         AND sa.connected = true
         AND sa.platform = 'linkedin'
       ORDER BY lps.synced_at DESC NULLS LAST
       LIMIT 1`,
      [auth.userId]
    );

    if (!profile.length) {
      return res.json({ profile: null, hasData: false });
    }

    const row = profile[0];
    const hasData = row.first_name !== null || row.headline !== null;

    return res.json({
      hasData,
      first_name: row.first_name ?? null,
      last_name: row.last_name ?? null,
      headline: row.headline ?? null,
      connections_count: row.connections_count !== null ? Number(row.connections_count) : 0,
      profile_picture_url: row.profile_picture_url ?? null,
      account_name: row.account_name ?? null,
      synced_at: row.synced_at ?? null,
    });
  } catch (err) {
    console.error('LinkedIn profile error:', err);
    return res.json({ profile: null, hasData: false });
  }
});

// GET /api/social/linkedin/posts — all synced posts for the authenticated user
app.get('/api/social/linkedin/posts', async (req: Request, res: Response) => {
  try {
    const auth = requireAuth(req, res);
    if (!auth) return;
    if (!pool) return res.status(503).json({ success: false, error: 'DB not ready' });

    const q = req.query as any;
    const limit = Math.min(200, Math.max(1, parseInt(q.limit || '100', 10)));
    const offset = Math.max(0, parseInt(q.offset || '0', 10));

    const postsRes = await pool.query(
      `SELECT lpm.*, sa.account_name
       FROM linkedin_post_metrics lpm
       JOIN social_accounts sa ON sa.id = lpm.social_account_id
       WHERE lpm.user_id = \$1
       ORDER BY COALESCE(lpm.created_at, lpm.fetched_at) DESC
       LIMIT \$2 OFFSET \$3`,
      [auth.userId, limit, offset]
    );

    const countRes = await pool.query(
      `SELECT COUNT(*) FROM linkedin_post_metrics WHERE user_id = \$1`,
      [auth.userId]
    );

    const summaryRes = await pool.query(
      `SELECT
         COUNT(*) AS total_posts
       FROM linkedin_post_metrics
       WHERE user_id = \$1`,
      [auth.userId]
    );

    return res.json({
      success: true,
      posts: postsRes.rows,
      total: parseInt(countRes.rows[0]?.count || '0', 10),
      summary: summaryRes.rows[0] || { total_posts: 0 },
    });
  } catch (err) {
    console.error('LinkedIn posts error:', err);
    return res.status(500).json({ success: false, error: 'Failed to fetch LinkedIn posts' });
  }
});

// GET /api/social/linkedin/organizations — list admin organizations available to user
app.get('/api/social/linkedin/organizations', async (req: Request, res: Response) => {
  try {
    const auth = requireAuth(req, res);
    if (!auth) return;
    if (!pool) return res.status(503).json({ success: false, error: 'DB not ready' });

    const linkedInAuth = await getLinkedInAuthContext(auth.userId);
    if (!linkedInAuth.hasConnection) {
      return res.status(404).json({ success: false, error: 'No connected LinkedIn account found' });
    }
    const token = linkedInAuth.accessToken;
    if (!token) {
      return res.status(401).json({ success: false, error: 'LinkedIn access token missing or expired — please reconnect' });
    }
    const organizationScopeError = getLinkedInOrganizationScopeError(linkedInAuth.tokenData);
    if (organizationScopeError) {
      return res.status(400).json({ success: false, error: organizationScopeError });
    }

    try {
      const { personId } = await resolveLinkedInProfileIdentity(token, {
        accountId: linkedInAuth.accountId,
        accountName: linkedInAuth.accountName,
        tokenData: linkedInAuth.tokenData,
      });
      if (!personId) {
        return res.status(400).json({ success: false, error: 'Unable to resolve your LinkedIn profile id' });
      }

      const { organizations } = await listLinkedInAdminOrganizations(token, personId, {
        allowedRoles: ['ADMINISTRATOR', 'CONTENT_ADMINISTRATOR', 'ANALYST', 'CURATOR'],
      });
      return res.json({ success: true, organizations });
    } catch (err: any) {
      console.error('LinkedIn organizations error:', err.message);
      return res.status(500).json({ success: false, error: err?.message || 'Failed to fetch organizations' });
    }
  } catch (err) {
    console.error('LinkedIn organizations list error:', err);
    return res.status(500).json({ success: false, error: 'Failed to fetch organizations' });
  }
});

// POST /api/social/linkedin/company-sync — sync LinkedIn company page analytics
app.post('/api/social/linkedin/company-sync', async (req: Request, res: Response) => {
  try {
    const auth = requireAuth(req, res);
    if (!auth) return;
    if (!pool) return res.status(503).json({ success: false, error: 'DB not ready' });

    const { organizationId } = req.body as any;
    if (!organizationId) {
      return res.status(400).json({ success: false, error: 'organizationId required' });
    }

    const linkedInAuth = await getLinkedInAuthContext(auth.userId);
    if (!linkedInAuth.hasConnection || !linkedInAuth.socialAccountId) {
      return res.status(404).json({ success: false, error: 'No connected LinkedIn account found' });
    }
    const token = linkedInAuth.accessToken;
    if (!token) {
      return res.status(401).json({ success: false, error: 'LinkedIn access token missing or expired — please reconnect' });
    }
    const organizationScopeError = getLinkedInOrganizationScopeError(linkedInAuth.tokenData, { requireSocialRead: true });
    if (organizationScopeError) {
      return res.status(400).json({ success: false, error: organizationScopeError });
    }

    let synced = 0;
    const errors: string[] = [];
    const organizationUrn = `urn:li:organization:${organizationId}`;

    try {
      const [organizationDetails, followerCount, pageStatsResp, shareStatsResp, posts] = await Promise.all([
        fetchLinkedInOrganizationsByIds(token, [organizationId]),
        fetchLinkedInOrganizationNetworkSize(token, organizationUrn),
        axios.get('https://api.linkedin.com/rest/organizationPageStatistics', {
          params: {
            q: 'organization',
            organization: organizationUrn,
          },
          headers: getLinkedInRestHeaders(token),
          validateStatus: () => true,
          timeout: 15000,
        }),
        axios.get('https://api.linkedin.com/rest/organizationalEntityShareStatistics', {
          params: {
            q: 'organizationalEntity',
            organizationalEntity: organizationUrn,
          },
          headers: getLinkedInRestHeaders(token),
          validateStatus: () => true,
          timeout: 15000,
        }),
        fetchLinkedInPostsByAuthor(token, organizationUrn, 100),
      ]);

      const org = organizationDetails[0]?.raw || null;
      const orgName = organizationDetails[0]?.name || `LinkedIn Page ${organizationId}`;
      const logoUrl = organizationDetails[0]?.picture_url || null;
      const description = extractLinkedInOrganizationDescription(org);
      const shareElements = Array.isArray((shareStatsResp.data as any)?.elements) ? (shareStatsResp.data as any).elements : [];
      const aggregateShareStats = (shareElements[0]?.totalShareStatistics || {}) as Record<string, any>;
      const engagementRate = Number(aggregateShareStats?.engagement || 0) || 0;
      const postsCreated = posts.length;

      await pool.query(
        `INSERT INTO linkedin_company_stats
           (id, user_id, social_account_id, organization_id, organization_name, follower_count, engagement_rate, posts_created, logo_url, description, raw_response, synced_at)
         VALUES (gen_random_uuid()::text, $1, $2, $3, $4, $5, $6, $7, $8, $9, $10::jsonb, NOW())
         ON CONFLICT (social_account_id, organization_id) DO UPDATE SET
           organization_name = COALESCE(EXCLUDED.organization_name, linkedin_company_stats.organization_name),
           follower_count = COALESCE(EXCLUDED.follower_count, linkedin_company_stats.follower_count),
           engagement_rate = COALESCE(EXCLUDED.engagement_rate, linkedin_company_stats.engagement_rate),
           posts_created = COALESCE(EXCLUDED.posts_created, linkedin_company_stats.posts_created),
           logo_url = COALESCE(EXCLUDED.logo_url, linkedin_company_stats.logo_url),
           description = COALESCE(EXCLUDED.description, linkedin_company_stats.description),
           raw_response = EXCLUDED.raw_response,
           synced_at = NOW()`,
        [
          auth.userId,
          linkedInAuth.socialAccountId,
          organizationId,
          orgName,
          followerCount ?? 0,
          engagementRate,
          postsCreated,
          logoUrl,
          description,
          JSON.stringify({
            organization: org,
            followerCount,
            pageStatistics: pageStatsResp.status < 400 ? pageStatsResp.data : null,
            shareStatistics: shareStatsResp.status < 400 ? shareStatsResp.data : null,
          }),
        ],
      );
      synced++;

      const postUrns = posts
        .map((post) => String(post?.id || '').trim())
        .filter(Boolean);
      const [socialMetadataByPostId, shareStatsByPostId] = await Promise.all([
        fetchLinkedInSocialMetadataBatch(token, postUrns),
        fetchLinkedInShareStatisticsForPosts(token, organizationUrn, postUrns),
      ]);

      for (const post of posts) {
        const postId = String(post?.id || '').trim();
        if (!postId) continue;

        const socialMetadata = socialMetadataByPostId[postId] || {};
        const postStats = shareStatsByPostId.get(postId) || {};
        const impressions = Number(postStats?.impressionCount || 0) || 0;
        const clicks = Number(postStats?.clickCount || 0) || 0;
        const likes = Number(postStats?.likeCount || sumLinkedInReactionCounts(socialMetadata) || 0) || 0;
        const comments = Number(postStats?.commentCount || socialMetadata?.commentSummary?.count || 0) || 0;
        const reposts = Number(postStats?.shareCount || socialMetadata?.repostSummary?.count || 0) || 0;
        const postEngagementRate = Number(postStats?.engagement || 0) || 0;
        const createdAtRaw = post?.publishedAt || post?.createdAt || null;
        const createdAt = createdAtRaw ? new Date(createdAtRaw).toISOString() : null;

        await pool.query(
          `INSERT INTO linkedin_company_posts
             (id, user_id, social_account_id, post_id, organization_id, text, media_type, impressions, likes, comments, reposts, clicks, engagement_rate, created_at, fetched_at, raw_data)
           VALUES (gen_random_uuid()::text, $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, NOW(), $14::jsonb)
           ON CONFLICT (social_account_id, post_id) DO UPDATE SET
             text = EXCLUDED.text,
             media_type = EXCLUDED.media_type,
             impressions = EXCLUDED.impressions,
             likes = EXCLUDED.likes,
             comments = EXCLUDED.comments,
             reposts = EXCLUDED.reposts,
             clicks = EXCLUDED.clicks,
             engagement_rate = EXCLUDED.engagement_rate,
             created_at = COALESCE(EXCLUDED.created_at, linkedin_company_posts.created_at),
             fetched_at = NOW(),
             raw_data = EXCLUDED.raw_data`,
          [
            auth.userId,
            linkedInAuth.socialAccountId,
            postId,
            organizationId,
            extractLinkedInPostText(post),
            extractLinkedInPostMediaType(post),
            impressions,
            likes,
            comments,
            reposts,
            clicks,
            postEngagementRate,
            createdAt,
            JSON.stringify({
              post,
              socialMetadata,
              shareStatistics: postStats,
            }),
          ],
        );
        synced++;
      }
    } catch (syncErr: any) {
      errors.push(`Company analytics sync failed: ${syncErr.message}`);
    }

    return res.json({ success: true, synced, errors: errors.length > 0 ? errors : undefined });
  } catch (err) {
    console.error('LinkedIn company sync error:', err);
    return res.status(500).json({ success: false, error: 'LinkedIn company sync failed' });
  }
});

// GET /api/social/linkedin/company-stats — get company page analytics snapshot
app.get('/api/social/linkedin/company-stats', async (req: Request, res: Response) => {
  try {
    const auth = requireAuth(req, res);
    if (!auth) return;
    if (!pool) return res.json({ stats: null, hasData: false });

    const { organization_id } = req.query as any;
    if (!organization_id) {
      return res.json({ stats: null, hasData: false });
    }

    const { rows: stats } = await pool.query(
      `SELECT
         sa.id, sa.account_name,
         lcs.organization_id, lcs.organization_name, lcs.follower_count,
         lcs.posts_created, lcs.engagement_rate, lcs.logo_url, lcs.synced_at
       FROM social_accounts sa
       LEFT JOIN linkedin_company_stats lcs ON lcs.social_account_id = sa.id
       WHERE sa.user_id = $1
         AND lcs.organization_id = $2
         AND sa.connected = true
         AND sa.platform = 'linkedin'
       LIMIT 1`,
      [auth.userId, organization_id]
    );

    if (!stats.length) {
      return res.json({ stats: null, hasData: false });
    }

    const row = stats[0];
    const hasData = row.follower_count !== null || row.posts_created !== null;

    return res.json({
      hasData,
      organization_id: row.organization_id,
      organization_name: row.organization_name ?? null,
      follower_count: row.follower_count !== null ? Number(row.follower_count) : 0,
      posts_created: row.posts_created !== null ? Number(row.posts_created) : 0,
      engagement_rate: row.engagement_rate !== null ? Number(row.engagement_rate) : 0,
      logo_url: row.logo_url ?? null,
      synced_at: row.synced_at ?? null,
    });
  } catch (err) {
    console.error('LinkedIn company stats error:', err);
    return res.json({ stats: null, hasData: false });
  }
});

// GET /api/social/linkedin/company-posts — get company page posts analytics
app.get('/api/social/linkedin/company-posts', async (req: Request, res: Response) => {
  try {
    const auth = requireAuth(req, res);
    if (!auth) return;
    if (!pool) return res.status(503).json({ success: false, error: 'DB not ready' });

    const { organization_id, limit = '50', offset = '0' } = req.query as any;
    if (!organization_id) {
      return res.status(400).json({ success: false, error: 'organization_id required' });
    }

    const pageLimit = Math.min(500, Math.max(1, parseInt(limit, 10)));
    const pageOffset = Math.max(0, parseInt(offset, 10));

    const postsRes = await pool.query(
      `SELECT lcp.*, sa.account_name
       FROM linkedin_company_posts lcp
       JOIN social_accounts sa ON sa.id = lcp.social_account_id
       WHERE lcp.user_id = $1 AND lcp.organization_id = $2
       ORDER BY lcp.created_at DESC NULLS LAST
       LIMIT $3 OFFSET $4`,
      [auth.userId, organization_id, pageLimit, pageOffset]
    );

    const countRes = await pool.query(
      `SELECT COUNT(*) FROM linkedin_company_posts WHERE user_id = $1 AND organization_id = $2`,
      [auth.userId, organization_id]
    );

    const summaryRes = await pool.query(
      `SELECT
         COUNT(*) AS total_posts,
         COALESCE(SUM(impressions), 0) AS total_impressions,
         COALESCE(SUM(likes), 0) AS total_likes,
         COALESCE(SUM(comments), 0) AS total_comments,
         COALESCE(SUM(clicks), 0) AS total_clicks,
         CASE WHEN COUNT(*) > 0
              THEN ROUND((SUM(likes + comments)::numeric / NULLIF(SUM(impressions), 0)) * 100, 2)
              ELSE 0 END AS avg_engagement_rate
       FROM linkedin_company_posts
       WHERE user_id = $1 AND organization_id = $2`,
      [auth.userId, organization_id]
    );

    return res.json({
      success: true,
      posts: postsRes.rows,
      total: parseInt(countRes.rows[0]?.count || '0', 10),
      summary: summaryRes.rows[0] || {},
    });
  } catch (err) {
    console.error('LinkedIn company posts error:', err);
    return res.status(500).json({ success: false, error: 'Failed to fetch company posts' });
  }
});

// ─── End Analytics & Insights Engine ─────────────────────────────────────────

// ─── Campaign & Funnel Builder ────────────────────────────────────────────────

function buildUtmUrl(base: string, utm: { source: string; medium: string; campaign: string; term?: string; content?: string }): string {
  try {
    const url = new URL(base.startsWith('http') ? base : `https://${base}`);
    url.searchParams.set('utm_source', utm.source);
    url.searchParams.set('utm_medium', utm.medium);
    url.searchParams.set('utm_campaign', utm.campaign);
    if (utm.term) url.searchParams.set('utm_term', utm.term);
    if (utm.content) url.searchParams.set('utm_content', utm.content);
    return url.toString();
  } catch {
    return base;
  }
}

function campaignShortCode(): string {
  return randomBytes(4).toString('hex'); // 8 hex chars
}

// ── Campaign Queue & Worker ───────────────────────────────────────────────────

async function ensureCampaignQueue() {
  if (campaignQueue || !isBullMqEnabled() || !pool) return;
  try {
    const redis = new IORedis(REDIS_URL, { maxRetriesPerRequest: null, enableReadyCheck: false });
    campaignQueue = new Queue(CAMPAIGN_QUEUE_NAME, {
      connection: redis as any,
      defaultJobOptions: { attempts: 3, backoff: { type: 'exponential', delay: 5000 }, removeOnComplete: { count: 200 }, removeOnFail: { count: 200 } },
    });
    campaignWorker = new Worker(CAMPAIGN_QUEUE_NAME, async (job) => {
      const { jobRowId } = job.data as { jobRowId: string };
      if (!jobRowId || !pool) return;
      try {
        await pool.query(`UPDATE campaign_jobs SET status='running', updated_at=NOW() WHERE id=$1`, [jobRowId]);
        const jRes = await pool.query('SELECT * FROM campaign_jobs WHERE id=$1', [jobRowId]);
        const jRow: any = jRes.rows[0];
        if (!jRow) return;
        const payload: any = jRow.payload || {};

        if (jRow.job_type === 'analytics_init') {
          // Register campaign creation in insights_cache for analytics
          await pool.query(
            `INSERT INTO insights_cache (id, user_id, cache_key, data, expires_at)
             VALUES (gen_random_uuid()::text, $1, $2, $3::jsonb, NOW() + INTERVAL '90 days')
             ON CONFLICT (user_id, cache_key) DO UPDATE SET data=EXCLUDED.data, expires_at=EXCLUDED.expires_at`,
            [jRow.user_id, `campaign_created_${jRow.campaign_id}`, JSON.stringify({ campaignId: jRow.campaign_id, createdAt: new Date().toISOString(), channels: payload.channels || [], utmCount: payload.utmCount || 0 })]
          ).catch(() => undefined);
        }

        if (jRow.job_type === 'attribution_init') {
          // Attribution is ready on-demand via funnel_events; just mark initialized
          await pool.query(`UPDATE campaigns SET attribution_model=$1, updated_at=NOW() WHERE id=$2`, [payload.model || 'last_touch', jRow.campaign_id]).catch(() => undefined);
        }

        if (jRow.job_type === 'mailing_link') {
          // Link to mailing campaign if one was created alongside
          if (payload.mailing_campaign_id) {
            await pool.query(`UPDATE campaigns SET mailing_campaign_id=$1, updated_at=NOW() WHERE id=$2`, [payload.mailing_campaign_id, jRow.campaign_id]).catch(() => undefined);
          }
        }

        await pool.query(`UPDATE campaign_jobs SET status='done', updated_at=NOW() WHERE id=$1`, [jobRowId]);
      } catch (err: any) {
        await pool!.query(`UPDATE campaign_jobs SET status='failed', error=$1, updated_at=NOW() WHERE id=$2`, [err?.message || 'Unknown error', jobRowId]).catch(() => undefined);
        throw err;
      }
    }, { connection: new IORedis(REDIS_URL, { maxRetriesPerRequest: null, enableReadyCheck: false }) as any, concurrency: 5 });
    campaignWorker.on('error', (err) => console.error('[CampaignQueue] Worker error:', err));
  } catch (err) {
    console.error('[CampaignQueue] Init failed:', err);
    campaignQueue = null;
  }
}

async function enqueueCampaignJob(jobRowId: string): Promise<string | null> {
  if (!isBullMqEnabled()) return null;
  try {
    await ensureCampaignQueue();
    if (!campaignQueue) return null;
    const job = await campaignQueue.add('campaign-job', { jobRowId }, { jobId: jobRowId });
    return String(job.id);
  } catch (err: any) {
    if (/Job.*already exists/i.test(String(err?.message || ''))) return jobRowId;
    console.error('[CampaignQueue] Enqueue error:', err);
    return null;
  }
}

// If no Redis, process campaign job inline (fire-and-forget)
async function processCampaignJobInline(jobRowId: string) {
  if (!pool) return;
  try {
    const jRes = await pool.query('SELECT * FROM campaign_jobs WHERE id=$1', [jobRowId]);
    const jRow: any = jRes.rows[0];
    if (!jRow) return;
    const payload: any = jRow.payload || {};
    await pool.query(`UPDATE campaign_jobs SET status='running', updated_at=NOW() WHERE id=$1`, [jobRowId]);
    if (jRow.job_type === 'analytics_init') {
      await pool.query(
        `INSERT INTO insights_cache (id, user_id, cache_key, data, expires_at) VALUES (gen_random_uuid()::text, $1, $2, $3::jsonb, NOW() + INTERVAL '90 days') ON CONFLICT (user_id, cache_key) DO UPDATE SET data=EXCLUDED.data, expires_at=EXCLUDED.expires_at`,
        [jRow.user_id, `campaign_created_${jRow.campaign_id}`, JSON.stringify({ campaignId: jRow.campaign_id, createdAt: new Date().toISOString(), channels: payload.channels || [], utmCount: payload.utmCount || 0 })]
      ).catch(() => undefined);
    }
    if (jRow.job_type === 'attribution_init') {
      await pool.query(`UPDATE campaigns SET attribution_model=$1, updated_at=NOW() WHERE id=$2`, [payload.model || 'last_touch', jRow.campaign_id]).catch(() => undefined);
    }
    if (jRow.job_type === 'mailing_link' && payload.mailing_campaign_id) {
      await pool.query(`UPDATE campaigns SET mailing_campaign_id=$1, updated_at=NOW() WHERE id=$2`, [payload.mailing_campaign_id, jRow.campaign_id]).catch(() => undefined);
    }
    await pool.query(`UPDATE campaign_jobs SET status='done', updated_at=NOW() WHERE id=$1`, [jobRowId]);
  } catch (err: any) {
    pool.query(`UPDATE campaign_jobs SET status='failed', error=$1, updated_at=NOW() WHERE id=$2`, [err?.message || 'Unknown', jobRowId]).catch(() => undefined);
  }
}

// ── POST /api/campaign/campaigns/create — atomic campaign creation ────────────
// Must be registered BEFORE /api/campaign/campaigns/:id to avoid route shadowing
app.post('/api/campaign/campaigns/create', async (req: Request, res: Response) => {
  const auth = requireAuth(req, res);
  if (!auth) return;
  if (!pool) return res.status(503).json({ success: false, error: 'DB not ready' });

  const {
    name, description, goal, start_date, end_date, budget, currency, target_url,
    tags, channels = [], attribution_model = 'last_touch',
    create_funnel = true, funnel_name, utm_auto_generate = true,
    mailing_subject, mailing_segment_id,
  } = req.body as any;

  // ── Step 0: Input validation ──────────────────────────────────────────────
  const validationErrors: string[] = [];
  if (!name || !String(name).trim()) validationErrors.push('Campaign name is required.');
  if (String(name || '').trim().length > 120) validationErrors.push('Campaign name must be 120 characters or fewer.');

  const validGoals = ['awareness', 'traffic', 'leads', 'engagement', 'sales'];
  if (goal && !validGoals.includes(goal)) validationErrors.push(`Goal must be one of: ${validGoals.join(', ')}.`);

  if (start_date && end_date) {
    const sd = new Date(start_date), ed = new Date(end_date);
    if (isNaN(sd.getTime())) validationErrors.push('Invalid start_date.');
    else if (isNaN(ed.getTime())) validationErrors.push('Invalid end_date.');
    else if (sd >= ed) validationErrors.push('start_date must be before end_date.');
  }

  // Sanitize URLs
  let sanitizedTargetUrl = '';
  if (target_url) {
    try {
      const u = new URL(String(target_url).startsWith('http') ? target_url : `https://${target_url}`);
      if (!['http:', 'https:'].includes(u.protocol)) validationErrors.push('target_url must be http or https.');
      else sanitizedTargetUrl = u.toString();
    } catch { validationErrors.push('Invalid target_url.'); }
  }

  if (budget !== undefined && budget !== null && budget !== '') {
    const b = parseFloat(String(budget));
    if (isNaN(b) || b < 0) validationErrors.push('Budget must be a positive number.');
  }

  // Validate channel ownership
  const socialChannels = (channels as string[]).filter(c => !['email', 'landing_page'].includes(c));
  if (socialChannels.length > 0) {
    const acctRes = await pool.query(
      `SELECT platform FROM social_accounts WHERE user_id=$1 AND connected=true AND platform = ANY($2::text[])`,
      [auth.userId, socialChannels]
    ).catch(() => ({ rows: [] as any[] }));
    const connectedPlatforms = acctRes.rows.map((r: any) => r.platform.toLowerCase());
    for (const ch of socialChannels) {
      if (!connectedPlatforms.includes(ch.toLowerCase()) && ch !== 'email' && ch !== 'landing_page') {
        validationErrors.push(`Channel "${ch}" is not connected. Please connect it in Integrations first.`);
      }
    }
  }

  if (validationErrors.length > 0) {
    return res.status(400).json({ success: false, validationErrors, error: validationErrors[0] });
  }

  // Check name uniqueness for this user
  const dupCheck = await pool.query('SELECT id FROM campaigns WHERE user_id=$1 AND LOWER(name)=LOWER($2)', [auth.userId, String(name).trim()]);
  if (dupCheck.rows.length > 0) {
    return res.status(409).json({ success: false, error: `A campaign named "${name}" already exists. Choose a unique name.`, validationErrors: [`A campaign named "${name}" already exists.`] });
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // ── Step 1: Create campaign ───────────────────────────────────────────────
    const campaignRes = await client.query(
      `INSERT INTO campaigns (id, user_id, name, description, goal, status, start_date, end_date, budget, currency, target_url, tags, attribution_model)
       VALUES (gen_random_uuid()::text,$1,$2,$3,$4,'active',$5,$6,$7,$8,$9,$10,$11) RETURNING *`,
      [auth.userId, String(name).trim(), description || '', goal || 'awareness',
       start_date || null, end_date || null,
       budget ? parseFloat(String(budget)) : null, currency || 'USD',
       sanitizedTargetUrl, Array.isArray(tags) ? tags : [],
       attribution_model]
    );
    const campaign = campaignRes.rows[0];
    const campaignId: string = campaign.id;
    const utmCampaignSlug = String(name).toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 40);

    // ── Step 2: Create channels ───────────────────────────────────────────────
    const createdChannels: any[] = [];
    for (const ch of channels as string[]) {
      const saRes = await client.query(
        `SELECT id FROM social_accounts WHERE user_id=$1 AND LOWER(platform)=LOWER($2) AND connected=true LIMIT 1`,
        [auth.userId, ch]
      );
      const socialAccountId: string | null = saRes.rows[0]?.id || null;
      const chRes = await client.query(
        `INSERT INTO campaign_channels (id, campaign_id, user_id, channel_type, social_account_id, status)
         VALUES (gen_random_uuid()::text,$1,$2,$3,$4,'active') RETURNING *`,
        [campaignId, auth.userId, ch, socialAccountId]
      );
      createdChannels.push(chRes.rows[0]);
    }

    // ── Step 3: Create funnel with default AIDA steps ────────────────────────
    let createdFunnel: any = null;
    let createdSteps: any[] = [];
    if (create_funnel) {
      const funnelRes = await client.query(
        `INSERT INTO funnels (id, campaign_id, user_id, name, description)
         VALUES (gen_random_uuid()::text,$1,$2,$3,$4) RETURNING *`,
        [campaignId, auth.userId, funnel_name || `${String(name).trim()} Funnel`, 'Auto-created AIDA funnel']
      );
      createdFunnel = funnelRes.rows[0];
      const defaultSteps = [
        { name: 'Impression', step_type: 'page_view', order: 0 },
        { name: 'Click', step_type: 'click', order: 1 },
        { name: 'Lead', step_type: 'form_submit', order: 2 },
        { name: 'Conversion', step_type: 'purchase', order: 3 },
      ];
      for (const s of defaultSteps) {
        const sRes = await client.query(
          `INSERT INTO funnel_steps (id, funnel_id, user_id, name, step_order, step_type, target_url)
           VALUES (gen_random_uuid()::text,$1,$2,$3,$4,$5,$6) RETURNING *`,
          [createdFunnel.id, auth.userId, s.name, s.order, s.step_type, sanitizedTargetUrl]
        );
        createdSteps.push(sRes.rows[0]);
      }
    }

    // ── Step 4: Generate UTM links per channel ────────────────────────────────
    const createdLinks: any[] = [];
    if (utm_auto_generate && sanitizedTargetUrl && channels.length > 0) {
      const channelMediumMap: Record<string, string> = {
        facebook: 'social', instagram: 'social', twitter: 'social', linkedin: 'social',
        email: 'email', landing_page: 'referral',
      };
      for (const ch of channels as string[]) {
        const medium = channelMediumMap[ch] || 'social';
        const full_url = buildUtmUrl(sanitizedTargetUrl, { source: ch, medium, campaign: utmCampaignSlug });
        const short_code = campaignShortCode();
        const lRes = await client.query(
          `INSERT INTO utm_links (id, campaign_id, user_id, label, base_url, utm_source, utm_medium, utm_campaign, short_code, full_url)
           VALUES (gen_random_uuid()::text,$1,$2,$3,$4,$5,$6,$7,$8,$9)
           ON CONFLICT (short_code) DO NOTHING RETURNING *`,
          [campaignId, auth.userId, `${ch.charAt(0).toUpperCase() + ch.slice(1)} — ${String(name).trim()}`,
           sanitizedTargetUrl, ch, medium, utmCampaignSlug, short_code, full_url]
        );
        if (lRes.rows[0]) createdLinks.push(lRes.rows[0]);
      }
    }

    // ── Step 5: Create mailing campaign if email channel + subject provided ──
    let mailingCampaign: any = null;
    if (channels.includes('email') && mailing_subject) {
      const mcRes = await client.query(
        `INSERT INTO mailing_campaigns (id, user_id, name, subject, content, segment_id, status)
         VALUES (gen_random_uuid()::text, $1, $2, $3, '', $4, 'draft') RETURNING *`,
        [auth.userId, `${String(name).trim()} — Email`, mailing_subject, mailing_segment_id || null]
      ).catch(() => ({ rows: [] as any[] }));
      if (mcRes.rows[0]) {
        mailingCampaign = mcRes.rows[0];
        await client.query(`UPDATE campaigns SET mailing_campaign_id=$1 WHERE id=$2`, [mailingCampaign.id, campaignId]).catch(() => undefined);
      }
    }

    // ── Step 6: Queue background jobs ────────────────────────────────────────
    const jobsToQueue = [
      { job_type: 'analytics_init', payload: { channels, utmCount: createdLinks.length, utmCampaign: utmCampaignSlug } },
      { job_type: 'attribution_init', payload: { model: attribution_model } },
      ...(mailingCampaign ? [{ job_type: 'mailing_link', payload: { mailing_campaign_id: mailingCampaign.id } }] : []),
    ];
    const jobRows: any[] = [];
    for (const j of jobsToQueue) {
      const jRes = await client.query(
        `INSERT INTO campaign_jobs (id, campaign_id, user_id, job_type, status, payload)
         VALUES (gen_random_uuid()::text, $1, $2, $3, 'queued', $4::jsonb) RETURNING *`,
        [campaignId, auth.userId, j.job_type, JSON.stringify(j.payload)]
      );
      jobRows.push(jRes.rows[0]);
    }

    // ── Commit transaction ────────────────────────────────────────────────────
    await client.query('COMMIT');

    // ── Step 7: Dispatch jobs (outside transaction) ───────────────────────────
    const jobIds: string[] = [];
    for (const jRow of jobRows) {
      if (isBullMqEnabled()) {
        const jid = await enqueueCampaignJob(jRow.id).catch(() => null);
        if (jid) {
          await pool.query(`UPDATE campaign_jobs SET job_id=$1, updated_at=NOW() WHERE id=$2`, [jid, jRow.id]).catch(() => undefined);
          jobIds.push(jid);
        }
      } else {
        // Process inline when no Redis
        processCampaignJobInline(jRow.id).catch(() => undefined);
        jobIds.push(jRow.id);
      }
    }

    // ── Step 8: Return complete payload ──────────────────────────────────────
    return res.status(201).json({
      success: true,
      campaign: { ...campaign, mailing_campaign_id: mailingCampaign?.id || null },
      channels: createdChannels,
      funnel: createdFunnel,
      funnel_steps: createdSteps,
      utm_links: createdLinks,
      mailing_campaign: mailingCampaign,
      job_ids: jobIds,
      summary: {
        channels_created: createdChannels.length,
        funnel_steps_created: createdSteps.length,
        utm_links_created: createdLinks.length,
        jobs_queued: jobIds.length,
      },
    });
  } catch (err: any) {
    await client.query('ROLLBACK').catch(() => undefined);
    console.error('[Campaign Create] Transaction failed:', err?.message || err);
    // Log error context for debugging
    pool.query(
      `INSERT INTO funnel_events (id, owner_user_id, event_type, event_name, properties)
       VALUES (gen_random_uuid()::text, $1, 'error', 'campaign_create_failed', $2::jsonb)`,
      [auth.userId, JSON.stringify({ error: err?.message, ts: new Date().toISOString() })]
    ).catch(() => undefined);
    return res.status(500).json({ success: false, error: 'Campaign creation failed. All changes were rolled back.' });
  } finally {
    client.release();
  }
});

// GET /api/campaign/campaigns
app.get('/api/campaign/campaigns', async (req: Request, res: Response) => {
  try {
    const auth = requireAuth(req, res); if (!auth) return;
    if (!pool) return res.status(503).json({ success: false, error: 'DB not ready' });
    const { rows } = await pool.query(
      `SELECT c.*,
        (SELECT COUNT(*) FROM campaign_channels cc WHERE cc.campaign_id=c.id) as channel_count,
        (SELECT COUNT(*) FROM funnels f WHERE f.campaign_id=c.id) as funnel_count,
        (SELECT COUNT(*) FROM utm_links ul WHERE ul.campaign_id=c.id) as link_count,
        (SELECT COALESCE(SUM(ul.clicks),0) FROM utm_links ul WHERE ul.campaign_id=c.id) as total_clicks,
        (SELECT COALESCE(SUM(ul.conversions),0) FROM utm_links ul WHERE ul.campaign_id=c.id) as total_conversions
       FROM campaigns c WHERE c.user_id=$1 ORDER BY c.updated_at DESC`,
      [auth.userId]
    );
    return res.json({ success: true, campaigns: rows });
  } catch (err) {
    console.error('list campaigns error:', err);
    return res.status(500).json({ success: false, error: 'Failed to list campaigns' });
  }
});

// POST /api/campaign/campaigns
app.post('/api/campaign/campaigns', async (req: Request, res: Response) => {
  try {
    const auth = requireAuth(req, res); if (!auth) return;
    if (!pool) return res.status(503).json({ success: false, error: 'DB not ready' });
    const { name, description, goal, status, start_date, end_date, budget, currency, target_url, tags } = req.body as any;
    if (!name) return res.status(400).json({ success: false, error: 'name is required' });
    const { rows } = await pool.query(
      `INSERT INTO campaigns (id,user_id,name,description,goal,status,start_date,end_date,budget,currency,target_url,tags)
       VALUES (gen_random_uuid()::text,$1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) RETURNING *`,
      [auth.userId, name, description||'', goal||'awareness', status||'draft',
       start_date||null, end_date||null, budget||null, currency||'USD', target_url||'', tags||[]]
    );
    return res.status(201).json({ success: true, campaign: rows[0] });
  } catch (err) {
    console.error('create campaign error:', err);
    return res.status(500).json({ success: false, error: 'Failed to create campaign' });
  }
});

// GET /api/campaign/campaigns/:id
app.get('/api/campaign/campaigns/:id', async (req: Request, res: Response) => {
  try {
    const auth = requireAuth(req, res); if (!auth) return;
    if (!pool) return res.status(503).json({ success: false, error: 'DB not ready' });
    const { rows } = await pool.query(
      'SELECT * FROM campaigns WHERE id=$1 AND user_id=$2', [req.params.id, auth.userId]
    );
    if (!rows[0]) return res.status(404).json({ success: false, error: 'Not found' });
    return res.json({ success: true, campaign: rows[0] });
  } catch (err) {
    return res.status(500).json({ success: false, error: 'Failed to fetch campaign' });
  }
});

// PUT /api/campaign/campaigns/:id
app.put('/api/campaign/campaigns/:id', async (req: Request, res: Response) => {
  try {
    const auth = requireAuth(req, res); if (!auth) return;
    if (!pool) return res.status(503).json({ success: false, error: 'DB not ready' });
    const { name, description, goal, status, start_date, end_date, budget, currency, target_url, tags } = req.body as any;
    const { rows } = await pool.query(
      `UPDATE campaigns SET name=COALESCE($3,name), description=COALESCE($4,description),
        goal=COALESCE($5,goal), status=COALESCE($6,status), start_date=COALESCE($7,start_date),
        end_date=COALESCE($8,end_date), budget=COALESCE($9,budget), currency=COALESCE($10,currency),
        target_url=COALESCE($11,target_url), tags=COALESCE($12,tags), updated_at=NOW()
       WHERE id=$1 AND user_id=$2 RETURNING *`,
      [req.params.id, auth.userId, name||null, description||null, goal||null, status||null,
       start_date||null, end_date||null, budget||null, currency||null, target_url||null, tags||null]
    );
    if (!rows[0]) return res.status(404).json({ success: false, error: 'Not found' });
    return res.json({ success: true, campaign: rows[0] });
  } catch (err) {
    return res.status(500).json({ success: false, error: 'Failed to update campaign' });
  }
});

// DELETE /api/campaign/campaigns/:id
app.delete('/api/campaign/campaigns/:id', async (req: Request, res: Response) => {
  try {
    const auth = requireAuth(req, res); if (!auth) return;
    if (!pool) return res.status(503).json({ success: false, error: 'DB not ready' });
    await pool.query('DELETE FROM campaigns WHERE id=$1 AND user_id=$2', [req.params.id, auth.userId]);
    return res.json({ success: true });
  } catch (err) {
    return res.status(500).json({ success: false, error: 'Failed to delete campaign' });
  }
});

// GET /api/campaign/campaigns/:id/channels
app.get('/api/campaign/campaigns/:id/channels', async (req: Request, res: Response) => {
  try {
    const auth = requireAuth(req, res); if (!auth) return;
    if (!pool) return res.status(503).json({ success: false, error: 'DB not ready' });
    const { rows } = await pool.query(
      `SELECT cc.*, sa.account_name, sa.handle, sa.profile_image, sa.followers
       FROM campaign_channels cc
       LEFT JOIN social_accounts sa ON sa.id=cc.social_account_id
       WHERE cc.campaign_id=$1 AND cc.user_id=$2 ORDER BY cc.created_at`,
      [req.params.id, auth.userId]
    );
    return res.json({ success: true, channels: rows });
  } catch (err) {
    return res.status(500).json({ success: false, error: 'Failed to fetch channels' });
  }
});

// POST /api/campaign/campaigns/:id/channels
app.post('/api/campaign/campaigns/:id/channels', async (req: Request, res: Response) => {
  try {
    const auth = requireAuth(req, res); if (!auth) return;
    if (!pool) return res.status(503).json({ success: false, error: 'DB not ready' });
    const { channel_type, social_account_id, config } = req.body as any;
    if (!channel_type) return res.status(400).json({ success: false, error: 'channel_type required' });
    const campaignCheck = await pool.query('SELECT id FROM campaigns WHERE id=$1 AND user_id=$2', [req.params.id, auth.userId]);
    if (!campaignCheck.rows[0]) return res.status(404).json({ success: false, error: 'Campaign not found' });
    const { rows } = await pool.query(
      `INSERT INTO campaign_channels (id,campaign_id,user_id,channel_type,social_account_id,config)
       VALUES (gen_random_uuid()::text,$1,$2,$3,$4,$5::jsonb) RETURNING *`,
      [req.params.id, auth.userId, channel_type, social_account_id||null, JSON.stringify(config||{})]
    );
    return res.status(201).json({ success: true, channel: rows[0] });
  } catch (err) {
    return res.status(500).json({ success: false, error: 'Failed to add channel' });
  }
});

// DELETE /api/campaign/channels/:channelId
app.delete('/api/campaign/channels/:channelId', async (req: Request, res: Response) => {
  try {
    const auth = requireAuth(req, res); if (!auth) return;
    if (!pool) return res.status(503).json({ success: false, error: 'DB not ready' });
    await pool.query('DELETE FROM campaign_channels WHERE id=$1 AND user_id=$2', [req.params.channelId, auth.userId]);
    return res.json({ success: true });
  } catch (err) {
    return res.status(500).json({ success: false, error: 'Failed to delete channel' });
  }
});

// GET /api/campaign/campaigns/:id/funnels
app.get('/api/campaign/campaigns/:id/funnels', async (req: Request, res: Response) => {
  try {
    const auth = requireAuth(req, res); if (!auth) return;
    if (!pool) return res.status(503).json({ success: false, error: 'DB not ready' });
    const { rows } = await pool.query(
      `SELECT f.*,
        (SELECT COUNT(*) FROM funnel_steps fs WHERE fs.funnel_id=f.id) as step_count,
        (SELECT COUNT(*) FROM funnel_events fe WHERE fe.funnel_id=f.id) as event_count
       FROM funnels f WHERE f.campaign_id=$1 AND f.user_id=$2 ORDER BY f.created_at`,
      [req.params.id, auth.userId]
    );
    return res.json({ success: true, funnels: rows });
  } catch (err) {
    return res.status(500).json({ success: false, error: 'Failed to fetch funnels' });
  }
});

// POST /api/campaign/campaigns/:id/funnels
app.post('/api/campaign/campaigns/:id/funnels', async (req: Request, res: Response) => {
  try {
    const auth = requireAuth(req, res); if (!auth) return;
    if (!pool) return res.status(503).json({ success: false, error: 'DB not ready' });
    const { name, description, steps } = req.body as any;
    if (!name) return res.status(400).json({ success: false, error: 'name required' });
    const campaignCheck = await pool.query('SELECT id FROM campaigns WHERE id=$1 AND user_id=$2', [req.params.id, auth.userId]);
    if (!campaignCheck.rows[0]) return res.status(404).json({ success: false, error: 'Campaign not found' });
    const { rows } = await pool.query(
      `INSERT INTO funnels (id,campaign_id,user_id,name,description) VALUES (gen_random_uuid()::text,$1,$2,$3,$4) RETURNING *`,
      [req.params.id, auth.userId, name, description||'']
    );
    const funnel = rows[0];
    // Insert default steps if provided
    if (Array.isArray(steps) && steps.length > 0) {
      for (let i = 0; i < steps.length; i++) {
        const s = steps[i];
        await pool.query(
          `INSERT INTO funnel_steps (id,funnel_id,user_id,name,step_order,step_type,target_url,goal_count)
           VALUES (gen_random_uuid()::text,$1,$2,$3,$4,$5,$6,$7)`,
          [funnel.id, auth.userId, s.name||`Step ${i+1}`, i, s.step_type||'page_view', s.target_url||'', s.goal_count||0]
        );
      }
    }
    return res.status(201).json({ success: true, funnel });
  } catch (err) {
    return res.status(500).json({ success: false, error: 'Failed to create funnel' });
  }
});

// GET /api/campaign/funnels/:id
app.get('/api/campaign/funnels/:id', async (req: Request, res: Response) => {
  try {
    const auth = requireAuth(req, res); if (!auth) return;
    if (!pool) return res.status(503).json({ success: false, error: 'DB not ready' });
    const { rows } = await pool.query('SELECT * FROM funnels WHERE id=$1 AND user_id=$2', [req.params.id, auth.userId]);
    if (!rows[0]) return res.status(404).json({ success: false, error: 'Not found' });
    const steps = await pool.query('SELECT * FROM funnel_steps WHERE funnel_id=$1 ORDER BY step_order', [req.params.id]);
    return res.json({ success: true, funnel: rows[0], steps: steps.rows });
  } catch (err) {
    return res.status(500).json({ success: false, error: 'Failed to fetch funnel' });
  }
});

// DELETE /api/campaign/funnels/:id
app.delete('/api/campaign/funnels/:id', async (req: Request, res: Response) => {
  try {
    const auth = requireAuth(req, res); if (!auth) return;
    if (!pool) return res.status(503).json({ success: false, error: 'DB not ready' });
    await pool.query('DELETE FROM funnels WHERE id=$1 AND user_id=$2', [req.params.id, auth.userId]);
    return res.json({ success: true });
  } catch (err) {
    return res.status(500).json({ success: false, error: 'Failed to delete funnel' });
  }
});

// GET /api/campaign/funnels/:id/steps
app.get('/api/campaign/funnels/:id/steps', async (req: Request, res: Response) => {
  try {
    const auth = requireAuth(req, res); if (!auth) return;
    if (!pool) return res.status(503).json({ success: false, error: 'DB not ready' });
    const fCheck = await pool.query('SELECT id FROM funnels WHERE id=$1 AND user_id=$2', [req.params.id, auth.userId]);
    if (!fCheck.rows[0]) return res.status(404).json({ success: false, error: 'Not found' });
    // Get steps with event counts
    const { rows } = await pool.query(
      `SELECT fs.*,
        (SELECT COUNT(*) FROM funnel_events fe WHERE fe.funnel_step_id=fs.id) as event_count
       FROM funnel_steps fs WHERE fs.funnel_id=$1 ORDER BY fs.step_order`,
      [req.params.id]
    );
    return res.json({ success: true, steps: rows });
  } catch (err) {
    return res.status(500).json({ success: false, error: 'Failed to fetch steps' });
  }
});

// PUT /api/campaign/funnels/:id/steps — bulk replace steps
app.put('/api/campaign/funnels/:id/steps', async (req: Request, res: Response) => {
  try {
    const auth = requireAuth(req, res); if (!auth) return;
    if (!pool) return res.status(503).json({ success: false, error: 'DB not ready' });
    const fCheck = await pool.query('SELECT id FROM funnels WHERE id=$1 AND user_id=$2', [req.params.id, auth.userId]);
    if (!fCheck.rows[0]) return res.status(404).json({ success: false, error: 'Not found' });
    const { steps } = req.body as { steps: Array<{ id?: string; name: string; step_type: string; target_url?: string; goal_count?: number }> };
    if (!Array.isArray(steps)) return res.status(400).json({ success: false, error: 'steps array required' });
    // Delete existing steps (cascade will handle events by step_id)
    await pool.query('DELETE FROM funnel_steps WHERE funnel_id=$1', [req.params.id]);
    const inserted = [];
    for (let i = 0; i < steps.length; i++) {
      const s = steps[i];
      const { rows } = await pool.query(
        `INSERT INTO funnel_steps (id,funnel_id,user_id,name,step_order,step_type,target_url,goal_count)
         VALUES (gen_random_uuid()::text,$1,$2,$3,$4,$5,$6,$7) RETURNING *`,
        [req.params.id, auth.userId, s.name||`Step ${i+1}`, i, s.step_type||'page_view', s.target_url||'', s.goal_count||0]
      );
      inserted.push(rows[0]);
    }
    return res.json({ success: true, steps: inserted });
  } catch (err) {
    return res.status(500).json({ success: false, error: 'Failed to update steps' });
  }
});

// GET /api/campaign/campaigns/:id/utmlinks
app.get('/api/campaign/campaigns/:id/utmlinks', async (req: Request, res: Response) => {
  try {
    const auth = requireAuth(req, res); if (!auth) return;
    if (!pool) return res.status(503).json({ success: false, error: 'DB not ready' });
    const { rows } = await pool.query(
      'SELECT * FROM utm_links WHERE campaign_id=$1 AND user_id=$2 ORDER BY created_at DESC',
      [req.params.id, auth.userId]
    );
    return res.json({ success: true, links: rows });
  } catch (err) {
    return res.status(500).json({ success: false, error: 'Failed to fetch UTM links' });
  }
});

// POST /api/campaign/campaigns/:id/utmlinks
app.post('/api/campaign/campaigns/:id/utmlinks', async (req: Request, res: Response) => {
  try {
    const auth = requireAuth(req, res); if (!auth) return;
    if (!pool) return res.status(503).json({ success: false, error: 'DB not ready' });
    const { label, base_url, utm_source, utm_medium, utm_campaign, utm_term, utm_content } = req.body as any;
    if (!label || !base_url || !utm_source || !utm_medium || !utm_campaign) {
      return res.status(400).json({ success: false, error: 'label, base_url, utm_source, utm_medium, utm_campaign required' });
    }
    const campaignCheck = await pool.query('SELECT id FROM campaigns WHERE id=$1 AND user_id=$2', [req.params.id, auth.userId]);
    if (!campaignCheck.rows[0]) return res.status(404).json({ success: false, error: 'Campaign not found' });
    const full_url = buildUtmUrl(base_url, { source: utm_source, medium: utm_medium, campaign: utm_campaign, term: utm_term, content: utm_content });
    const short_code = campaignShortCode();
    const { rows } = await pool.query(
      `INSERT INTO utm_links (id,campaign_id,user_id,label,base_url,utm_source,utm_medium,utm_campaign,utm_term,utm_content,short_code,full_url)
       VALUES (gen_random_uuid()::text,$1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) RETURNING *`,
      [req.params.id, auth.userId, label, base_url, utm_source, utm_medium, utm_campaign, utm_term||'', utm_content||'', short_code, full_url]
    );
    return res.status(201).json({ success: true, link: rows[0] });
  } catch (err) {
    console.error('create utm link error:', err);
    return res.status(500).json({ success: false, error: 'Failed to create UTM link' });
  }
});

// DELETE /api/campaign/utmlinks/:linkId
app.delete('/api/campaign/utmlinks/:linkId', async (req: Request, res: Response) => {
  try {
    const auth = requireAuth(req, res); if (!auth) return;
    if (!pool) return res.status(503).json({ success: false, error: 'DB not ready' });
    await pool.query('DELETE FROM utm_links WHERE id=$1 AND user_id=$2', [req.params.linkId, auth.userId]);
    return res.json({ success: true });
  } catch (err) {
    return res.status(500).json({ success: false, error: 'Failed to delete link' });
  }
});

// GET /api/campaign/campaigns/:id/metrics
app.get('/api/campaign/campaigns/:id/metrics', async (req: Request, res: Response) => {
  try {
    const auth = requireAuth(req, res); if (!auth) return;
    if (!pool) return res.status(503).json({ success: false, error: 'DB not ready' });
    const campaignCheck = await pool.query('SELECT * FROM campaigns WHERE id=$1 AND user_id=$2', [req.params.id, auth.userId]);
    if (!campaignCheck.rows[0]) return res.status(404).json({ success: false, error: 'Not found' });
    const campaign = campaignCheck.rows[0];

    const [linksRes, eventsRes, channelsRes, funnelsRes] = await Promise.all([
      pool.query(`SELECT utm_source, utm_medium, SUM(clicks) as clicks, SUM(conversions) as conversions FROM utm_links WHERE campaign_id=$1 GROUP BY utm_source, utm_medium ORDER BY clicks DESC`, [req.params.id]),
      pool.query(`SELECT event_type, DATE_TRUNC('day', created_at) as day, COUNT(*) as cnt FROM funnel_events WHERE campaign_id=$1 GROUP BY event_type, day ORDER BY day`, [req.params.id]),
      pool.query(`SELECT channel_type, status FROM campaign_channels WHERE campaign_id=$1 AND user_id=$2`, [req.params.id, auth.userId]),
      pool.query(`SELECT f.id, f.name, (SELECT COUNT(*) FROM funnel_events fe WHERE fe.funnel_id=f.id) as total_events FROM funnels f WHERE f.campaign_id=$1`, [req.params.id]),
    ]);

    const totalClicks = linksRes.rows.reduce((s: number, r: any) => s + parseInt(r.clicks||0), 0);
    const totalConversions = linksRes.rows.reduce((s: number, r: any) => s + parseInt(r.conversions||0), 0);
    const conversionRate = totalClicks > 0 ? parseFloat(((totalConversions / totalClicks) * 100).toFixed(2)) : 0;

    return res.json({
      success: true,
      campaign,
      metrics: {
        totalClicks,
        totalConversions,
        conversionRate,
        clicksBySource: linksRes.rows,
        eventTimeline: eventsRes.rows,
        channels: channelsRes.rows,
        funnels: funnelsRes.rows,
      },
    });
  } catch (err) {
    console.error('campaign metrics error:', err);
    return res.status(500).json({ success: false, error: 'Failed to fetch metrics' });
  }
});

// POST /api/track/click — public, no auth (tracking pixel / redirect log)
app.post('/api/track/click', async (req: Request, res: Response) => {
  try {
    if (!pool) return res.json({ success: true });
    const { campaign_id, funnel_id, funnel_step_id, session_id, visitor_id, url, referrer, utm_source, utm_medium, utm_campaign, utm_term, utm_content, properties } = req.body as any;
    const ip = String(req.headers['x-forwarded-for'] || req.socket.remoteAddress || '').split(',')[0].trim();
    await pool.query(
      `INSERT INTO funnel_events (id,funnel_id,funnel_step_id,campaign_id,session_id,visitor_id,event_type,url,referrer,utm_source,utm_medium,utm_campaign,utm_term,utm_content,properties,ip,user_agent)
       VALUES (gen_random_uuid()::text,$1,$2,$3,$4,$5,'click',$6,$7,$8,$9,$10,$11,$12,$13::jsonb,$14,$15)`,
      [funnel_id||null, funnel_step_id||null, campaign_id||null, session_id||null, visitor_id||null,
       url||null, referrer||null, utm_source||null, utm_medium||null, utm_campaign||null, utm_term||null, utm_content||null,
       JSON.stringify(properties||{}), ip, req.headers['user-agent']||null]
    );
    return res.json({ success: true });
  } catch (err) {
    return res.json({ success: true }); // never fail tracking
  }
});

// POST /api/track/event — public
app.post('/api/track/event', async (req: Request, res: Response) => {
  try {
    if (!pool) return res.json({ success: true });
    const { campaign_id, funnel_id, funnel_step_id, event_type, event_name, session_id, visitor_id, url, referrer, utm_source, utm_medium, utm_campaign, utm_term, utm_content, properties } = req.body as any;
    const ip = String(req.headers['x-forwarded-for'] || req.socket.remoteAddress || '').split(',')[0].trim();
    // If this is a conversion event, increment utm_links conversions
    if ((event_type === 'conversion' || event_type === 'purchase') && campaign_id && utm_campaign) {
      await pool.query(
        `UPDATE utm_links SET conversions=conversions+1 WHERE campaign_id=$1 AND utm_campaign=$2`,
        [campaign_id, utm_campaign]
      ).catch(() => undefined);
    }
    await pool.query(
      `INSERT INTO funnel_events (id,funnel_id,funnel_step_id,campaign_id,session_id,visitor_id,event_type,event_name,url,referrer,utm_source,utm_medium,utm_campaign,utm_term,utm_content,properties,ip,user_agent)
       VALUES (gen_random_uuid()::text,$1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15::jsonb,$16,$17)`,
      [funnel_id||null, funnel_step_id||null, campaign_id||null, session_id||null, visitor_id||null,
       event_type||'custom', event_name||null, url||null, referrer||null,
       utm_source||null, utm_medium||null, utm_campaign||null, utm_term||null, utm_content||null,
       JSON.stringify(properties||{}), ip, req.headers['user-agent']||null]
    );
    return res.json({ success: true });
  } catch (err) {
    return res.json({ success: true });
  }
});

// GET /r/:shortCode — public UTM link redirect
app.get('/r/:shortCode', async (req: Request, res: Response) => {
  try {
    if (!pool) return res.redirect('/');
    const { rows } = await pool.query('SELECT * FROM utm_links WHERE short_code=$1 LIMIT 1', [req.params.shortCode]);
    if (!rows[0]) return res.status(404).send('Link not found');
    // Increment clicks asynchronously
    pool.query('UPDATE utm_links SET clicks=clicks+1 WHERE id=$1', [rows[0].id]).catch(() => undefined);
    // Log tracking event
    const ip = String(req.headers['x-forwarded-for'] || req.socket.remoteAddress || '').split(',')[0].trim();
    pool.query(
      `INSERT INTO funnel_events (id,campaign_id,event_type,url,referrer,utm_source,utm_medium,utm_campaign,utm_term,utm_content,ip,user_agent)
       VALUES (gen_random_uuid()::text,$1,'click',$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
      [rows[0].campaign_id, rows[0].full_url, req.headers.referer||null,
       rows[0].utm_source, rows[0].utm_medium, rows[0].utm_campaign, rows[0].utm_term||null, rows[0].utm_content||null,
       ip, req.headers['user-agent']||null]
    ).catch(() => undefined);
    return res.redirect(302, rows[0].full_url);
  } catch (err) {
    return res.redirect('/');
  }
});

// ─── End Campaign & Funnel Builder ────────────────────────────────────────────

// ─── AI Chat (Agentic) ────────────────────────────────────────────────────────

// These rules are ALWAYS appended after any system prompt (default or admin-saved).
// Admin prompt changes take effect immediately, but these UI formatting rules can never be removed.
const AI_CORE_RULES = `
---
## UI INTERACTION RULES — ALWAYS ENFORCED (do not remove)

### Question format
Whenever you present a question with multiple options, you MUST use this exact numbered format:

1. [Your question here]
   - Option A
   - Option B
   - Option C
   - Custom

NEVER write plain dash lists or paragraph options. Always number each question. The UI converts this format into interactive click-chips automatically.

### After a post is drafted
Output ONLY this — nothing else:
Done! Your [platform] post is ready.

1. What would you like to do next?
   - Schedule it
   - Explain why this works
   - Add an image
   - Edit something
   - Custom

No coaching text. No breakdowns. No extra paragraphs.

### "Let AI decide" / "Let AI suggest"
When any answer says "Let AI decide", make the creative decision yourself and proceed immediately without asking a follow-up question.

### "Schedule it"
Output nothing. The UI shows a calendar automatically. Wait for "Schedule for [ISO datetime]", then call schedule_post.

### "Explain why this works"
Reply with 2–3 bullet points only. Each bullet under 12 words. No intro sentence.
`;

const AI_SYSTEM_PROMPT_DEFAULT = `You are Daky — the user's dedicated personal social media butler with 55 years of deep, battle-tested expertise in social media marketing, brand strategy, content creation, audience psychology, and platform algorithms. You have guided Fortune 500 brands, solo creators, and everything in between. You know what works, what flops, and exactly why.

You operate exclusively within this SaaS platform. You do NOT give advice that requires tools, apps, or workflows outside this platform. Every recommendation you make is something the user can act on directly here, right now.

You are not a chatbot. You are the user's personal butler — proactive, precise, discreet, and deeply invested in their success. You speak with quiet authority: no fluff, no filler, no generic advice. Every word you say is earned.

---

## YOUR PERSONALITY
- Address the user by their first name when you know it (from their profile below)
- Speak like a trusted advisor who knows their brand inside-out
- Confident but never arrogant; warm but never sycophantic
- When you know what's best, recommend it with conviction — don't hedge
- When you genuinely need input, ask cleanly and precisely
- Never say "Great question!" or "Absolutely!" — just answer

---

## USER CONTEXT — READ THIS FIRST, ALWAYS
{USER_MEMORY}

Use this context to make every response feel personally crafted for this user. Reference their brand, industry, tone, audience, or goals when relevant. If no memory is provided, ask 1 focused question to understand who they are before drafting anything.

---

## PLATFORM SCOPE — HARD BOUNDARIES
You ONLY help with tasks achievable inside this platform:
✓ Drafting posts, captions, threads, and content
✓ Scheduling posts to connected social accounts
✓ Analyzing post performance and suggesting improvements
✓ Creating visual content cards (via the card builder)
✓ Managing content calendars and pipelines
✓ Social media strategy scoped to the user's brand
✓ Platform-specific best practices (LinkedIn, Instagram, Twitter/X, Facebook, TikTok)

✗ NEVER suggest third-party tools, external apps, or workflows outside this platform
✗ NEVER advise on paid advertising, ad budgets, or media buying
✗ NEVER give legal, financial, or medical advice
✗ NEVER draft content that is political, hateful, deceptive, or off-brand for the user

---

## TOOLS
Act immediately when intent is clear — never just describe what you could do:
- "draft / write / create a post" → create_draft
- "schedule / post at / publish on [date]" → schedule_post
- "show my posts / list drafts / what have I written" → get_recent_posts
- "what platforms / accounts connected" → get_connected_platforms

Platform pre-selection: when the user names a platform (e.g. "LinkedIn post", "Instagram caption", "Twitter thread"), set the lowercase platform name in the platforms field. No platform mentioned → omit the field.

After every tool use, confirm in one sentence and offer a clear next step.

---

## CONTENT CREATION — HOW DAKY WORKS

When a request is vague (no topic, platform, or tone stated), present a focused question set FIRST. When the request is specific enough, draft immediately — do not ask unnecessary questions.

### Question format (ALWAYS use this — never plain text lists):

[One-sentence butler intro ending with a colon:]

1. [Question]
   - [Specific option tailored to this user's brand/industry]
   - [Specific option]
   - [Specific option]
   - Custom

2. [Question]
   - [Option]
   - [Option]
   - Custom

Rules:
- Maximum 3 questions. Stop at 3. Never ask a 4th.
- Every option must be under 55 characters
- ALWAYS include "- Custom" as the last sub-bullet under every question
- Use numbered items (1. 2. 3.) and indented sub-bullets (- ) — never plain text
- Options must be tailored to this specific user's known brand/industry — never generic filler

### EXAMPLE for a user who runs a fitness coaching brand:

Let's craft the perfect post for you:

1. What would you like to focus on?
   - Client transformation story
   - Morning routine that doubles energy
   - The biggest fitness myth debunked
   - Nutrition tip most coaches get wrong
   - Custom

2. Which platform is this for?
   - Instagram
   - LinkedIn
   - Twitter/X
   - Facebook
   - Custom

3. What tone should it have?
   - Motivational and direct
   - Educational and credible
   - Relatable and conversational
   - Custom

---

## AFTER USER SUBMITS CHOICES

Read ALL their answers and immediately call the tool with a complete, high-quality draft. Do NOT ask follow-up questions. Just execute.

**"Let AI decide"** — make the best creative choice yourself and proceed immediately. Never ask what "Let AI decide" means.

Write real, engaging content — never placeholder text. Use platform-appropriate length, formatting, and voice aligned to the user's brand personality.

---

## AFTER A DRAFT IS CREATED

Output EXACTLY this — nothing else:

Done! Your [platform] post is ready.

1. What would you like to do next?
   - Schedule it
   - Explain why this works
   - Add an image
   - Edit something
   - Custom

No coaching paragraphs. No breakdowns. No extra sentences. The user picks their next step.

---

## WHEN USER SELECTS "Explain why this works"

Reply with ONLY 2–3 bullet points. Each bullet under 12 words. No intro sentence.

• [Reason 1]
• [Reason 2]
• [Reason 3]

If user says "explain in detail" — then write more.

---

## WHEN USER SELECTS "Schedule it"

Output nothing. The frontend shows an inline calendar automatically. Wait for "Schedule for [ISO datetime] ([label])", then call schedule_post with the most recent draft's title and content.

---

## WHEN USER SELECTS "Add an image"

1. What style works best for this post?
   - Abstract artistic background
   - Professional lifestyle photo
   - Quote text overlay
   - Infographic or data visual
   - Custom

2. What mood should it convey?
   - Energetic and motivating
   - Calm and professional
   - Fun and vibrant
   - Custom

---

## BUTLER STANDARDS
- Every response must feel personally crafted, not templated
- Use the user's brand data to make topic suggestions feel inevitable, not random
- When you sense the user is stuck or frustrated, gently guide — don't interrogate
- Short, decisive responses win over long explanations — the user is busy
- If something is outside platform scope, say so once, briefly, then redirect to what you CAN do here`;


const AI_TOOLS: Anthropic.Tool[] = [
  {
    name: 'create_draft',
    description: 'Create a new blog/content post saved as a draft. Use when user asks to draft, write, or create a post/article.',
    input_schema: {
      type: 'object',
      properties: {
        title: { type: 'string', description: 'Post title' },
        content: { type: 'string', description: 'Full post content (can be markdown or plain text)' },
        excerpt: { type: 'string', description: 'Short summary (1-2 sentences)' },
        platforms: { type: 'array', items: { type: 'string' }, description: 'Lowercase social platform names to pre-select for automation (e.g. ["linkedin","instagram"]). Only include when user explicitly mentions specific platforms.' },
      },
      required: ['title', 'content'],
    },
  },
  {
    name: 'schedule_post',
    description: 'Create a post and schedule it to publish at a specific date/time. Use when user specifies a date or time to publish.',
    input_schema: {
      type: 'object',
      properties: {
        title: { type: 'string', description: 'Post title' },
        content: { type: 'string', description: 'Full post content' },
        scheduled_at: { type: 'string', description: 'ISO 8601 datetime string (e.g. "2025-06-01T09:00:00Z"). Convert relative times like "tomorrow at 9am" to absolute UTC.' },
        excerpt: { type: 'string', description: 'Short summary' },
        platforms: { type: 'array', items: { type: 'string' }, description: 'Lowercase social platform names to pre-select for automation (e.g. ["linkedin","twitter"]). Only include when user explicitly mentions specific platforms.' },
      },
      required: ['title', 'content', 'scheduled_at'],
    },
  },
  {
    name: 'get_recent_posts',
    description: "Fetch the user's recent posts to show them or reference them.",
    input_schema: {
      type: 'object',
      properties: {
        limit: { type: 'number', description: 'Max number to return (default 5, max 10)' },
        status: { type: 'string', description: 'Filter: draft | published | scheduled | all' },
      },
    },
  },
  {
    name: 'get_connected_platforms',
    description: "Get which social media platforms the user has connected so you can give relevant advice.",
    input_schema: {
      type: 'object',
      properties: {},
    },
  },
];

function aiToolLabel(name: string, input: any): string {
  switch (name) {
    case 'create_draft': return `Creating draft: "${input?.title || 'untitled'}"`;
    case 'schedule_post': return `Scheduling post: "${input?.title || 'untitled'}"`;
    case 'get_recent_posts': return 'Fetching your posts…';
    case 'get_connected_platforms': return 'Checking connected platforms…';
    default: return `Running ${name}…`;
  }
}

async function preselectPlatformsForPost(postId: string, userId: string, platforms: string[]): Promise<void> {
  if (!pool || platforms.length === 0) return;
  try {
    const normalized = platforms.map((p) => p.toLowerCase().trim());
    const expanded = Array.from(new Set(normalized.flatMap((p) => (p === 'x' ? ['twitter', 'x'] : p === 'twitter' ? ['twitter', 'x'] : [p]))));
    const { rows: accounts } = await dbQuery(
      `SELECT id FROM social_accounts WHERE user_id=$1 AND LOWER(platform) = ANY($2::text[])`,
      [userId, expanded]
    );
    if (accounts.length === 0) return;
    const settingId = randomUUID();
    const existing = await dbQuery('SELECT id FROM social_post_settings WHERE post_id=$1', [postId]);
    const settId: string = existing.rows[0]?.id ? String(existing.rows[0].id) : settingId;
    if (!existing.rows.length) {
      await dbQuery(
        `INSERT INTO social_post_settings (id, post_id, template, publish_type, scheduled_at) VALUES ($1,$2,'','immediate',NULL)`,
        [settId, postId]
      );
    }
    for (const acc of accounts) {
      await dbQuery(
        `INSERT INTO social_post_targets (id, social_post_id, social_account_id, enabled) VALUES ($1,$2,$3,true)`,
        [randomUUID(), settId, acc.id]
      );
    }
  } catch (e) {
    console.error('preselectPlatformsForPost error:', e);
  }
}

async function executeAITool(name: string, input: any, userId: string): Promise<any> {
  switch (name) {
    case 'create_draft': {
      const title = String(input?.title || 'Untitled').slice(0, 255);
      const content = String(input?.content || '');
      const excerpt = String(input?.excerpt || '').slice(0, 500);
      const platforms: string[] = Array.isArray(input?.platforms) ? input.platforms.map(String) : [];
      const id = randomUUID();
      const slug = slugify(title) || id;
      const { rows } = await dbQuery(
        `INSERT INTO blog_posts (id, user_id, title, slug, content, excerpt, status, created_at, updated_at)
         VALUES ($1, $2, $3, $4, $5, $6, 'draft', NOW(), NOW()) RETURNING id, title, status`,
        [id, userId, title, slug, content, excerpt]
      );
      await preselectPlatformsForPost(id, userId, platforms);
      createNotification(userId, 'draft_created',
        'Draft created',
        `"${title}" has been saved as a draft.`,
        { postId: id },
      ).catch(() => undefined);
      return { success: true, action: 'created_draft', post: rows[0] };
    }
    case 'schedule_post': {
      const title = String(input?.title || 'Untitled').slice(0, 255);
      const content = String(input?.content || '');
      const excerpt = String(input?.excerpt || '').slice(0, 500);
      const scheduled_at = input?.scheduled_at ? new Date(input.scheduled_at).toISOString() : null;
      if (!scheduled_at) throw new Error('Invalid scheduled_at datetime');
      const platforms: string[] = Array.isArray(input?.platforms) ? input.platforms.map(String) : [];
      const id = randomUUID();
      const slug = slugify(title) || id;
      const { rows } = await dbQuery(
        `INSERT INTO blog_posts (id, user_id, title, slug, content, excerpt, status, scheduled_at, created_at, updated_at)
         VALUES ($1, $2, $3, $4, $5, $6, 'scheduled', $7, NOW(), NOW()) RETURNING id, title, status, scheduled_at`,
        [id, userId, title, slug, content, excerpt, scheduled_at]
      );
      await preselectPlatformsForPost(id, userId, platforms);
      const schedDate = scheduled_at ? new Date(scheduled_at).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }) : '';
      createNotification(userId, 'post_scheduled',
        'Post scheduled',
        `"${title}" is scheduled for ${schedDate}.`,
        { postId: id, scheduled_at },
      ).catch(() => undefined);
      return { success: true, action: 'scheduled_post', post: rows[0] };
    }
    case 'get_recent_posts': {
      const limit = Math.min(Number(input?.limit) || 5, 10);
      const status = String(input?.status || '').trim().toLowerCase();
      const params: any[] = [userId];
      let q = `SELECT id, title, status, scheduled_at, published_at, updated_at
               FROM blog_posts WHERE user_id = $1`;
      if (status && status !== 'all') {
        params.push(status);
        q += ` AND status = $${params.length}`;
      } else {
        q += ` AND status NOT IN ('archived','deleted')`;
      }
      q += ` ORDER BY updated_at DESC LIMIT $${params.length + 1}`;
      params.push(limit);
      const { rows } = await dbQuery(q, params);
      return { posts: rows };
    }
    case 'get_connected_platforms': {
      const accounts = await getUserConnectedAccounts(userId);
      const connected = accounts.filter((a: any) => a.connected !== false).map((a: any) => ({
        platform: a.platform,
        name: a.account_name || a.handle || a.platform,
      }));
      return { connected };
    }
    default:
      throw new Error(`Unknown tool: ${name}`);
  }
}

app.post('/api/ai/chat', async (req: Request, res: Response) => {
  try {
    const auth = requireAuth(req, res);
    if (!auth) return;

    const { messages, page } = req.body as {
      messages: Array<{ role: 'user' | 'assistant'; content: string }>;
      page?: string;
    };

    if (!Array.isArray(messages) || messages.length === 0) {
      return res.status(400).json({ success: false, error: 'messages array is required' });
    }

    const aiCfg = await getAIConfig();
    const apiKey = resolveActiveKey(aiCfg);
    if (!apiKey) {
      return res.status(503).json({ success: false, error: 'AI service not configured — add your API key in Admin → AI Assistant' });
    }

    const skillsPrompt = await getSkillsPromptForScope(page || '');

    // Fetch user's personalization memory to inject as context into every call
    let userMemoryBlock = '';
    if (pool) {
      try {
        const { rows: memRows } = await dbQuery(
          `SELECT category, title, content FROM user_memories WHERE user_id = $1 AND title != '🌐 Full Scraped Memory' ORDER BY category, sort_order, created_at LIMIT 60`,
          [auth.userId]
        );
        if (memRows.length > 0) {
          const grouped: Record<string, string[]> = {};
          for (const row of memRows) {
            if (!grouped[row.category]) grouped[row.category] = [];
            grouped[row.category].push(`  • ${row.title}: ${row.content}`);
          }
          const sections = Object.entries(grouped)
            .map(([cat, lines]) => `### ${cat}\n${lines.join('\n')}`)
            .join('\n\n');
          userMemoryBlock = `## ABOUT THIS USER\n${sections}`;
        } else {
          userMemoryBlock = '## ABOUT THIS USER\nNo personalization data yet. Ask one focused question to understand their brand before drafting.';
        }
      } catch { /* non-fatal */ }
    }

    const basePrompt = (aiCfg.systemPrompt || AI_SYSTEM_PROMPT_DEFAULT).replace('{USER_MEMORY}', userMemoryBlock);
    const activeSystemPrompt = [basePrompt, AI_CORE_RULES, skillsPrompt].filter(Boolean).join('\n\n');

    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');

    const send = (data: object) => res.write(`data: ${JSON.stringify(data)}\n\n`);

    // ── Google Gemini path — direct streaming, no tool use ────────────────────
    if (aiCfg.provider === 'google') {
      const effectiveModel = GEMINI_MODELS.includes(aiCfg.model) ? aiCfg.model : (ANTHROPIC_TO_GEMINI[aiCfg.model] ?? 'gemini-2.0-flash');
      const genAI = new GoogleGenerativeAI(apiKey);
      const gModel = genAI.getGenerativeModel({ model: effectiveModel, systemInstruction: activeSystemPrompt });

      const allMessages = messages.slice(-20).map((m) => ({
        role: m.role === 'assistant' ? 'model' : 'user',
        parts: [{ text: String(m.content || '').slice(0, 4000) }],
      }));
      const history = allMessages.slice(0, -1);
      const lastPart = allMessages[allMessages.length - 1]?.parts[0]?.text ?? '';

      const chat = gModel.startChat({ history });
      const stream = await chat.sendMessageStream(lastPart);
      for await (const chunk of stream.stream) {
        const text = chunk.text();
        if (text) send({ type: 'text', text });
      }
      res.write('data: [DONE]\n\n');
      res.end();
      return;
    }

    // ── Anthropic path — full agentic loop with tools ─────────────────────────
    const client = new Anthropic({ apiKey });

    // Build conversation — keep last 20, serialize assistant tool-use turns as text
    const conversationMessages: Anthropic.MessageParam[] = messages.slice(-20).map((m) => ({
      role: m.role as 'user' | 'assistant',
      content: String(m.content || '').slice(0, 4000),
    }));

    // Agentic loop — max 3 tool-use iterations then always stream final text
    let loopMessages = [...conversationMessages];
    for (let iteration = 0; iteration < 4; iteration++) {
      const isLastIteration = iteration >= 3;

      // Non-streaming call for tool detection
      const response = await client.messages.create({
        model: aiCfg.model,
        max_tokens: 2048,
        system: activeSystemPrompt,
        tools: isLastIteration ? [] : AI_TOOLS,
        messages: loopMessages,
      });

      if (response.stop_reason === 'tool_use' && !isLastIteration) {
        // Send any text blocks before tool calls
        for (const block of response.content) {
          if (block.type === 'text' && block.text.trim()) {
            send({ type: 'text', text: block.text });
          }
        }

        // Execute each tool call
        const toolResultContents: Anthropic.ToolResultBlockParam[] = [];
        for (const block of response.content) {
          if (block.type !== 'tool_use') continue;
          send({ type: 'tool_start', name: block.name, label: aiToolLabel(block.name, block.input) });
          try {
            const result = await executeAITool(block.name, block.input, auth.userId);
            send({ type: 'tool_done', name: block.name, success: true, result });
            toolResultContents.push({ type: 'tool_result', tool_use_id: block.id, content: JSON.stringify(result) });
          } catch (err: any) {
            const errMsg = err?.message || 'Tool failed';
            send({ type: 'tool_done', name: block.name, success: false, error: errMsg });
            toolResultContents.push({ type: 'tool_result', tool_use_id: block.id, content: `Error: ${errMsg}`, is_error: true });
          }
        }

        // Append assistant turn + tool results and continue loop
        loopMessages = [
          ...loopMessages,
          { role: 'assistant', content: response.content },
          { role: 'user', content: toolResultContents },
        ];
      } else {
        // Final response — stream it
        const finalStream = await client.messages.stream({
          model: aiCfg.model,
          max_tokens: 1024,
          system: activeSystemPrompt,
          messages: loopMessages,
        });
        for await (const chunk of finalStream) {
          if (chunk.type === 'content_block_delta' && chunk.delta.type === 'text_delta') {
            send({ type: 'text', text: chunk.delta.text });
          }
        }
        break;
      }
    }

    res.write('data: [DONE]\n\n');
    res.end();
  } catch (error: any) {
    console.error('AI chat error:', error);
    if (!res.headersSent) {
      return res.status(500).json({ success: false, error: error?.message || 'AI request failed' });
    }
    res.write(`data: ${JSON.stringify({ error: error?.message || 'AI request failed' })}\n\n`);
    res.end();
  }
});

// ─── End AI Chat ───────────────────────────────────────────────────────────────

// ── Multi-Agent Orchestration ─────────────────────────────────────────────────

// POST /api/ai/orchestrate — classify intent, return direct or plan
app.post('/api/ai/orchestrate', async (req: Request, res: Response) => {
  try {
    const auth = requireAuth(req, res);
    if (!auth) return;

    const { messages } = req.body as { messages: Array<{ role: 'user' | 'assistant'; content: string }> };
    if (!Array.isArray(messages) || messages.length === 0) {
      return res.status(400).json({ success: false, error: 'messages required' });
    }

    const aiCfgOrch = await getAIConfig();
    const apiKey = resolveActiveKey(aiCfgOrch);
    if (!apiKey) return res.json({ type: 'direct' });

    const lastUserMsg = [...messages].reverse().find((m) => m.role === 'user')?.content || '';
    const orchFastModel = aiCfgOrch.provider === 'google'
      ? (GEMINI_MODELS.includes(aiCfgOrch.model) ? aiCfgOrch.model : 'gemini-2.0-flash')
      : 'claude-haiku-4-5-20251001';

    const orchSystemPrompt = `You are a routing assistant for a marketing AI team. Decide if a user message requires a coordinated multi-agent response from specialist agents (Nova=creative director, Sage=strategy analyst, Aria=analytics, Flux=automation) or can be handled directly by the main assistant.

Return ONLY valid JSON. No markdown fences, no explanation.

If single agent: {"type":"direct"}

If multi-agent (complex campaign, brand strategy, platform automation, multi-domain analysis): {"type":"plan","summary":"one sentence describing the overall task","agents":[{"key":"nova","name":"Nova","icon":"◉","color":"#EC4899","task":"what Nova should focus on"},{"key":"sage","name":"Sage","icon":"◈","color":"#10B981","task":"..."}]}

Rules:
- Include only genuinely relevant agents (2-4 max)
- Simple post requests, quick questions, single-domain tasks → direct
- Brand + strategy + analytics + automation tasks → plan`;

    const raw = await callAINonStreaming(aiCfgOrch.provider, apiKey, orchFastModel, orchSystemPrompt, `User request: "${lastUserMsg.slice(0, 600)}"`, 400);
    try {
      const parsed = JSON.parse(raw);
      if (parsed.type === 'plan' && Array.isArray(parsed.agents) && parsed.agents.length >= 2) {
        return res.json(parsed);
      }
    } catch { /* fall through */ }
    return res.json({ type: 'direct' });
  } catch {
    return res.json({ type: 'direct' });
  }
});

// POST /api/ai/execute-plan — SSE: run enabled agents in parallel, Daky synthesizes
app.post('/api/ai/execute-plan', async (req: Request, res: Response) => {
  try {
    const auth = requireAuth(req, res);
    if (!auth) return;

    const { messages, plan } = req.body as {
      messages: Array<{ role: 'user' | 'assistant'; content: string }>;
      plan: { summary: string; agents: Array<{ key: string; name: string; icon: string; color: string; task: string; enabled: boolean }> };
    };

    if (!Array.isArray(messages) || !plan?.agents) {
      return res.status(400).json({ success: false, error: 'messages and plan required' });
    }

    const aiCfg = await getAIConfig();
    const apiKey = resolveActiveKey(aiCfg);
    if (!apiKey) return res.status(503).json({ success: false, error: 'AI not configured' });

    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    const send = (data: object) => res.write(`data: ${JSON.stringify(data)}\n\n`);

    const enabledAgents = plan.agents.filter((a) => a.enabled);
    const conversationHistory = messages.slice(-10).map((m) => ({
      role: m.role as 'user' | 'assistant',
      content: String(m.content || '').slice(0, 3000),
    }));
    const lastUserMsg = [...messages].reverse().find((m) => m.role === 'user')?.content || '';

    // Fetch user memory
    let allMemory: any[] = [];
    if (pool) {
      const { rows } = await dbQuery(
        `SELECT category, title, content FROM user_memories WHERE user_id=$1 ORDER BY category, sort_order, created_at LIMIT 60`,
        [auth.userId]
      );
      allMemory = rows;
    }

    // Fetch compiled agent skills + templates
    const [{ rows: agentRows }, { rows: templateRows }] = await Promise.all([
      dbQuery(`SELECT agent_key, compiled_skill FROM user_agents WHERE user_id=$1`, [auth.userId]),
      dbQuery(`SELECT agent_key, base_prompt FROM agent_templates WHERE agent_key = ANY($1)`, [enabledAgents.map((a) => a.key)]),
    ]);
    const skillMap: Record<string, string> = {};
    for (const r of agentRows) skillMap[r.agent_key] = r.compiled_skill;
    const templateMap: Record<string, string> = {};
    for (const r of templateRows) templateMap[r.agent_key] = r.base_prompt;

    // Run agents in parallel
    send({ type: 'agents_start', count: enabledAgents.length });
    const agentResults: Array<{ key: string; name: string; icon: string; color: string; task: string; analysis: string }> = [];

    const agentFastModel = aiCfg.provider === 'google'
      ? (GEMINI_MODELS.includes(aiCfg.model) ? aiCfg.model : 'gemini-2.0-flash')
      : 'claude-haiku-4-5-20251001';

    await Promise.all(enabledAgents.map(async (agent) => {
      send({ type: 'agent_start', key: agent.key, name: agent.name, icon: agent.icon, color: agent.color });
      try {
        const def = AGENT_DEFS[agent.key];
        const basePrompt = templateMap[agent.key] || (def ? `You are ${def.name}, ${def.role} on the Dakyworld Hub marketing team.` : `You are ${agent.name}.`);
        const skill = skillMap[agent.key] || '';
        const agentSystem = `${basePrompt}${skill ? `\n\nWhat you know about this user:\n${skill}` : ''}\n\nYour specific task: ${agent.task}\n\nGive a concise expert analysis (3-5 sentences or a brief bullet list). No intros or sign-offs. Pure insight.`;

        const analysis = await callAINonStreaming(aiCfg.provider, apiKey, agentFastModel, agentSystem, lastUserMsg.slice(0, 1000), 350);
        agentResults.push({ key: agent.key, name: agent.name, icon: agent.icon, color: agent.color, task: agent.task, analysis });
        send({ type: 'agent_done', key: agent.key, name: agent.name, icon: agent.icon, color: agent.color, analysis });
      } catch {
        send({ type: 'agent_done', key: agent.key, name: agent.name, icon: agent.icon, color: agent.color, analysis: '' });
      }
    }));

    // Daky synthesizes
    send({ type: 'synthesis_start' });
    const userMemBlock = allMemory.length > 0
      ? '## ABOUT THIS USER\n' + allMemory.map((r: any) => `[${r.category}] ${r.title}: ${r.content}`).slice(0, 30).join('\n')
      : '## ABOUT THIS USER\nNo personalization data yet.';

    const teamContext = agentResults
      .filter((r) => r.analysis)
      .map((r) => `**${r.name}:** ${r.analysis}`)
      .join('\n\n');

    const synthSystem = `${AI_SYSTEM_PROMPT_DEFAULT.replace('{USER_MEMORY}', userMemBlock)}\n\n${AI_CORE_RULES}`;
    const synthPrompt = `${lastUserMsg}\n\n---\nYour specialist team has analyzed this:\n\n${teamContext}\n\nSynthesize their insights into one unified, decisive recommendation. Be the orchestrator — build on their analyses, don't just repeat them.`;

    if (aiCfg.provider === 'google') {
      const effectiveModel = GEMINI_MODELS.includes(aiCfg.model) ? aiCfg.model : (ANTHROPIC_TO_GEMINI[aiCfg.model] ?? 'gemini-1.5-pro');
      const genAI = new GoogleGenerativeAI(apiKey);
      const gModel = genAI.getGenerativeModel({ model: effectiveModel, systemInstruction: synthSystem });
      const gStream = await gModel.generateContentStream(synthPrompt);
      for await (const chunk of gStream.stream) {
        const text = chunk.text();
        if (text) send({ type: 'text', text });
      }
    } else {
      const anthropicClient = new Anthropic({ apiKey });
      const synthMessages: Anthropic.MessageParam[] = [
        ...conversationHistory.slice(0, -1),
        { role: 'user', content: synthPrompt }
      ];
      const finalStream = await anthropicClient.messages.stream({
        model: aiCfg.model,
        max_tokens: 1024,
        system: synthSystem,
        messages: synthMessages,
      });
      for await (const chunk of finalStream) {
        if (chunk.type === 'content_block_delta' && chunk.delta.type === 'text_delta') {
          send({ type: 'text', text: chunk.delta.text });
        }
      }
    }

    send({ type: 'done' });
    const agentNames = enabledAgents.map((a: any) => a.name).join(', ');
    createNotification(auth.userId, 'plan_executed',
      'Agent team finished',
      `Your marketing team (${agentNames}) completed their analysis.`,
      { agentCount: enabledAgents.length },
    ).catch(() => undefined);
    res.end();
  } catch (e: any) {
    if (!res.headersSent) return res.status(500).json({ success: false, error: e?.message || 'Execute plan failed' });
    res.end();
  }
});

// ── End Multi-Agent Orchestration ─────────────────────────────────────────────

// ─── Billing Routes ────────────────────────────────────────────────────────────

// GET /api/billing/subscription — current plan + usage + subscription status
app.get('/api/billing/subscription', async (req: Request, res: Response) => {
  const auth = requireAuth(req, res);
  if (!auth) return;
  if (!hasDatabase()) return res.json({ success: true, subscription: null, plan: null, usage: null });
  try {
    const { rows: subRows } = await dbQuery(
      `SELECT s.*, p.name AS plan_name, p.price, p.billing_period, p.features, p.post_limit, p.user_limit
       FROM subscriptions s
       LEFT JOIN pricing_plans p ON p.id = s.plan_id
       WHERE s.user_id = $1`,
      [auth.userId]
    );
    const { rows: userRows } = await dbQuery(
      `SELECT u.id, u.stripe_customer_id, p.name AS plan_name, p.price, p.billing_period, p.features, p.post_limit, p.user_limit, p.id AS plan_id
       FROM users u LEFT JOIN pricing_plans p ON p.id = u.plan_id WHERE u.id=$1`,
      [auth.userId]
    );
    const user = userRows[0];
    const sub = subRows[0] || null;

    // Usage: count posts this period
    const { rows: usageRows } = await dbQuery(
      `SELECT COUNT(*)::int AS posts_this_period FROM social_posts WHERE user_id=$1 AND created_at >= date_trunc('month', NOW())`,
      [auth.userId]
    ).catch(() => ({ rows: [{ posts_this_period: 0 }] }));

    const postLimit = sub?.post_limit ?? user?.post_limit ?? null;
    const usage = {
      posts_this_period: usageRows[0]?.posts_this_period ?? 0,
      posts_limit: postLimit,
    };

    res.json({
      success: true,
      subscription: sub,
      plan: sub ? {
        id: sub.plan_id,
        name: sub.plan_name,
        price: sub.price,
        billing_period: sub.billing_period,
        features: sub.features,
        post_limit: sub.post_limit,
        user_limit: sub.user_limit,
      } : (user?.plan_id ? { id: user.plan_id, name: user.plan_name, price: user.price, billing_period: user.billing_period, features: user.features, post_limit: user.post_limit, user_limit: user.user_limit } : null),
      usage,
      stripeConfigured: Boolean(stripe),
    });
  } catch (e) {
    res.status(500).json({ success: false, error: 'Failed to load subscription' });
  }
});

// GET /api/billing/invoices
app.get('/api/billing/invoices', async (req: Request, res: Response) => {
  const auth = requireAuth(req, res);
  if (!auth) return;
  if (!hasDatabase()) return res.json({ success: true, invoices: [] });
  try {
    const { rows } = await dbQuery(
      `SELECT id, stripe_invoice_id, invoice_number, status, total_cents, currency, hosted_invoice_url, invoice_pdf, paid_at, period_start, period_end, created_at
       FROM billing_invoices WHERE user_id=$1 ORDER BY created_at DESC LIMIT 50`,
      [auth.userId]
    );
    res.json({ success: true, invoices: rows });
  } catch (e) {
    res.status(500).json({ success: false, error: 'Failed to load invoices' });
  }
});

// POST /api/billing/checkout — create Stripe Checkout session for a plan
app.post('/api/billing/checkout', async (req: Request, res: Response) => {
  const auth = requireAuth(req, res);
  if (!auth) return;
  if (!stripe) return res.status(503).json({ success: false, error: 'Stripe is not configured on this server.' });
  const { planId, period = 'monthly' } = req.body as { planId: string; period?: 'monthly' | 'yearly' };
  if (!planId) return res.status(400).json({ success: false, error: 'planId is required' });
  if (!hasDatabase()) return res.status(503).json({ success: false, error: 'Database unavailable' });
  try {
    const { rows: planRows } = await dbQuery(
      `SELECT * FROM pricing_plans WHERE id=$1 AND is_active=true`,
      [planId]
    );
    if (!planRows.length) return res.status(404).json({ success: false, error: 'Plan not found' });
    const plan = planRows[0];
    const stripePriceId = period === 'yearly' ? (plan.stripe_annual_price_id || plan.stripe_price_id) : plan.stripe_price_id;
    if (!stripePriceId) return res.status(400).json({ success: false, error: 'This plan is not yet configured for Stripe payments. Please contact support.' });

    const { rows: userRows } = await dbQuery(`SELECT email, full_name FROM users WHERE id=$1`, [auth.userId]);
    if (!userRows.length) return res.status(404).json({ success: false, error: 'User not found' });

    const stripeCustomerId = await getOrCreateStripeCustomer(auth.userId, userRows[0].email, userRows[0].full_name);
    const appUrl = process.env.FRONTEND_ORIGIN || 'https://marketing.dakyworld.com';

    const session = await stripe.checkout.sessions.create({
      customer: stripeCustomerId,
      mode: 'subscription',
      line_items: [{ price: stripePriceId, quantity: 1 }],
      success_url: `${appUrl}/billing?session_id={CHECKOUT_SESSION_ID}&success=1`,
      cancel_url: `${appUrl}/pricing`,
      metadata: { user_id: auth.userId, plan_id: planId },
      subscription_data: { metadata: { user_id: auth.userId, plan_id: planId } },
      allow_promotion_codes: true,
    });

    res.json({ success: true, url: session.url });
  } catch (e: any) {
    console.error('Stripe checkout error:', e);
    res.status(500).json({ success: false, error: e.message || 'Failed to create checkout session' });
  }
});

// POST /api/billing/portal — open Stripe Customer Portal for self-service
app.post('/api/billing/portal', async (req: Request, res: Response) => {
  const auth = requireAuth(req, res);
  if (!auth) return;
  if (!stripe) return res.status(503).json({ success: false, error: 'Stripe is not configured.' });
  if (!hasDatabase()) return res.status(503).json({ success: false, error: 'Database unavailable' });
  try {
    const { rows: userRows } = await dbQuery(`SELECT email, full_name, stripe_customer_id FROM users WHERE id=$1`, [auth.userId]);
    if (!userRows.length) return res.status(404).json({ success: false, error: 'User not found' });
    const stripeCustomerId = userRows[0].stripe_customer_id || await getOrCreateStripeCustomer(auth.userId, userRows[0].email, userRows[0].full_name);
    const appUrl = process.env.FRONTEND_ORIGIN || 'https://marketing.dakyworld.com';
    const session = await stripe.billingPortal.sessions.create({
      customer: stripeCustomerId,
      return_url: `${appUrl}/billing`,
    });
    res.json({ success: true, url: session.url });
  } catch (e: any) {
    console.error('Stripe portal error:', e);
    res.status(500).json({ success: false, error: e.message || 'Failed to open billing portal' });
  }
});

// POST /api/billing/cancel — cancel subscription at period end
app.post('/api/billing/cancel', async (req: Request, res: Response) => {
  const auth = requireAuth(req, res);
  if (!auth) return;
  if (!stripe || !hasDatabase()) return res.status(503).json({ success: false, error: 'Stripe not configured' });
  try {
    const { rows } = await dbQuery(`SELECT stripe_subscription_id FROM subscriptions WHERE user_id=$1 AND status='active'`, [auth.userId]);
    if (!rows.length || !rows[0].stripe_subscription_id) return res.status(404).json({ success: false, error: 'No active subscription' });
    await stripe.subscriptions.update(rows[0].stripe_subscription_id, { cancel_at_period_end: true });
    await dbQuery(`UPDATE subscriptions SET cancel_at_period_end=true, updated_at=NOW() WHERE user_id=$1`, [auth.userId]);
    res.json({ success: true, message: 'Subscription will be canceled at the end of the billing period.' });
  } catch (e: any) {
    res.status(500).json({ success: false, error: e.message || 'Failed to cancel subscription' });
  }
});

// POST /api/billing/reactivate — undo cancel
app.post('/api/billing/reactivate', async (req: Request, res: Response) => {
  const auth = requireAuth(req, res);
  if (!auth) return;
  if (!stripe || !hasDatabase()) return res.status(503).json({ success: false, error: 'Stripe not configured' });
  try {
    const { rows } = await dbQuery(`SELECT stripe_subscription_id FROM subscriptions WHERE user_id=$1`, [auth.userId]);
    if (!rows.length || !rows[0].stripe_subscription_id) return res.status(404).json({ success: false, error: 'No subscription found' });
    await stripe.subscriptions.update(rows[0].stripe_subscription_id, { cancel_at_period_end: false });
    await dbQuery(`UPDATE subscriptions SET cancel_at_period_end=false, updated_at=NOW() WHERE user_id=$1`, [auth.userId]);
    res.json({ success: true, message: 'Subscription reactivated.' });
  } catch (e: any) {
    res.status(500).json({ success: false, error: e.message || 'Failed to reactivate subscription' });
  }
});

// ── User Memory Routes ────────────────────────────────────────────────────────

// GET /api/memory — all memories for authenticated user
app.get('/api/memory', async (req: Request, res: Response) => {
  const auth = await requireAuth(req, res);
  if (!auth) return;
  try {
    const rows = await dbQuery<{ id: string; category: string; title: string; content: string; source: string; sort_order: number; created_at: string }>(
      `SELECT id, category, title, content, source, sort_order, created_at FROM user_memories WHERE user_id = $1 ORDER BY category, sort_order, created_at`,
      [auth.userId]
    );
    return res.json({ success: true, memories: rows.rows });
  } catch (e: any) {
    return res.status(500).json({ success: false, error: e.message });
  }
});

// POST /api/memory — create a memory field
app.post('/api/memory', async (req: Request, res: Response) => {
  const auth = await requireAuth(req, res);
  if (!auth) return;
  const { category = 'custom', title, content, source = 'manual' } = req.body as Record<string, string>;
  if (!title?.trim() || !content?.trim()) return res.status(400).json({ success: false, error: 'title and content are required' });
  try {
    const row = await dbQuery<{ id: string; category: string; title: string; content: string; source: string; created_at: string }>(
      `INSERT INTO user_memories (user_id, category, title, content, source) VALUES ($1,$2,$3,$4,$5)
       RETURNING id, category, title, content, source, created_at`,
      [auth.userId, category.trim(), title.trim(), content.trim(), source]
    );
    triggerAgentCompilation(auth.userId).catch(() => undefined);
    createNotification(auth.userId, 'memory_saved',
      'Memory saved',
      `"${title.trim()}" added to your personalization memory.`,
      { memoryId: row.rows[0]?.id },
    ).catch(() => undefined);
    return res.json({ success: true, memory: row.rows[0] });
  } catch (e: any) {
    return res.status(500).json({ success: false, error: e.message });
  }
});

// PUT /api/memory/:id — update a memory field
app.put('/api/memory/:id', async (req: Request, res: Response) => {
  const auth = await requireAuth(req, res);
  if (!auth) return;
  const { id } = req.params;
  const { title, content } = req.body as Record<string, string>;
  if (!title?.trim() || !content?.trim()) return res.status(400).json({ success: false, error: 'title and content are required' });
  try {
    const row = await dbQuery<{ id: string; category: string; title: string; content: string; source: string; created_at: string }>(
      `UPDATE user_memories SET title=$1, content=$2, updated_at=NOW() WHERE id=$3 AND user_id=$4
       RETURNING id, category, title, content, source, created_at`,
      [title.trim(), content.trim(), id, auth.userId]
    );
    if (!row.rows[0]) return res.status(404).json({ success: false, error: 'Memory not found' });
    triggerAgentCompilation(auth.userId).catch(() => undefined);
    return res.json({ success: true, memory: row.rows[0] });
  } catch (e: any) {
    return res.status(500).json({ success: false, error: e.message });
  }
});

// DELETE /api/memory/:id — delete a memory field
app.delete('/api/memory/:id', async (req: Request, res: Response) => {
  const auth = await requireAuth(req, res);
  if (!auth) return;
  const { id } = req.params;
  try {
    await dbQuery(`DELETE FROM user_memories WHERE id=$1 AND user_id=$2`, [id, auth.userId]);
    triggerAgentCompilation(auth.userId).catch(() => undefined);
    return res.json({ success: true });
  } catch (e: any) {
    return res.status(500).json({ success: false, error: e.message });
  }
});

// ── Agent Routes ──────────────────────────────────────────────────────────────

// GET /api/agents — list user's agents with compiled skills
app.get('/api/agents', async (req: Request, res: Response) => {
  const auth = requireAuth(req, res);
  if (!auth) return;
  try {
    await provisionUserAgents(auth.userId);
    const { rows: agentRows } = await dbQuery(
      `SELECT ua.agent_key, ua.compiled_skill, ua.last_compiled_at,
              at2.name, at2.role, at2.icon, at2.color, at2.base_prompt, at2.memory_keywords
       FROM user_agents ua
       LEFT JOIN agent_templates at2 ON at2.agent_key = ua.agent_key
       WHERE ua.user_id = $1 ORDER BY ua.created_at`,
      [auth.userId]
    );
    return res.json({ success: true, agents: agentRows });
  } catch (e: any) {
    return res.status(500).json({ success: false, error: e.message });
  }
});

// POST /api/agents/compile — force recompile all agents for user
app.post('/api/agents/compile', async (req: Request, res: Response) => {
  const auth = requireAuth(req, res);
  if (!auth) return;
  triggerAgentCompilation(auth.userId).catch(() => undefined);
  return res.json({ success: true, message: 'Compilation started' });
});

// GET /api/agent-activity — activity feed for dashboard
app.get('/api/agent-activity', async (req: Request, res: Response) => {
  const auth = requireAuth(req, res);
  if (!auth) return;
  try {
    const { rows } = await dbQuery(
      `SELECT id, agent_key, agent_name, activity_type, title, content, is_read, created_at
       FROM agent_activity WHERE user_id=$1 ORDER BY created_at DESC LIMIT 20`,
      [auth.userId]
    );
    const unread = rows.filter((r: any) => !r.is_read).length;
    return res.json({ success: true, activities: rows, unread });
  } catch (e: any) {
    return res.status(500).json({ success: false, error: e.message });
  }
});

// PATCH /api/agent-activity/:id/read — mark as read
app.patch('/api/agent-activity/:id/read', async (req: Request, res: Response) => {
  const auth = requireAuth(req, res);
  if (!auth) return;
  await dbQuery(`UPDATE agent_activity SET is_read=true WHERE id=$1 AND user_id=$2`, [req.params.id, auth.userId]).catch(() => undefined);
  return res.json({ success: true });
});

// DELETE /api/agent-activity/:id — delete activity item
app.delete('/api/agent-activity/:id', async (req: Request, res: Response) => {
  const auth = requireAuth(req, res);
  if (!auth) return;
  await dbQuery(`DELETE FROM agent_activity WHERE id=$1 AND user_id=$2`, [req.params.id, auth.userId]).catch(() => undefined);
  return res.json({ success: true });
});

// GET /api/admin/agent-templates — list all 5 templates (admin only)
app.get('/api/admin/agent-templates', async (req: Request, res: Response) => {
  const auth = requireAdmin(req, res);
  if (!auth) return;
  try {
    const { rows } = await dbQuery(`SELECT * FROM agent_templates ORDER BY agent_key`, []);
    return res.json({ success: true, templates: rows });
  } catch (e: any) {
    return res.status(500).json({ success: false, error: e.message });
  }
});

// PUT /api/admin/agent-templates/:key — update a template's prompt (admin only)
app.put('/api/admin/agent-templates/:key', async (req: Request, res: Response) => {
  const auth = requireAdmin(req, res);
  if (!auth) return;
  const { key } = req.params;
  const { base_prompt } = req.body as { base_prompt: string };
  if (!base_prompt?.trim()) return res.status(400).json({ success: false, error: 'base_prompt required' });
  if (!AGENT_DEFS[key]) return res.status(404).json({ success: false, error: 'Unknown agent key' });
  try {
    const { rows } = await dbQuery(
      `UPDATE agent_templates SET base_prompt=$1, updated_at=NOW() WHERE agent_key=$2 RETURNING *`,
      [base_prompt.trim(), key]
    );
    return res.json({ success: true, template: rows[0] });
  } catch (e: any) {
    return res.status(500).json({ success: false, error: e.message });
  }
});

// ── End Agent Routes ──────────────────────────────────────────────────────────

// POST /api/memory/generate — AI-generate memories from wizard input
app.post('/api/memory/generate', async (req: Request, res: Response) => {
  const auth = await requireAuth(req, res);
  if (!auth) return;
  const { brandName, industry, offerings, audience, voiceTones = [], goals = [] } = req.body as Record<string, any>;
  if (!brandName?.trim()) return res.status(400).json({ success: false, error: 'brandName is required' });

  const { encryptedKey } = await getAIConfig();
  const apiKey = (encryptedKey ? decryptAIKey(encryptedKey) : null) || process.env.ANTHROPIC_API_KEY || '';
  if (!apiKey) return res.status(503).json({ success: false, error: 'AI not configured — add Anthropic API key in Admin → AI Assistant' });

  const prompt = `You are a brand strategist AI. Generate a structured memory profile for a brand based on the following info.

Brand: ${brandName}
Industry: ${industry || 'Not specified'}
Products/Services: ${offerings || 'Not specified'}
Target Audience: ${audience || 'Not specified'}
Brand Voice/Tone: ${Array.isArray(voiceTones) ? voiceTones.join(', ') : voiceTones || 'Not specified'}
Content Goals: ${Array.isArray(goals) ? goals.join(', ') : goals || 'Not specified'}

Output ONLY a valid JSON array of memory objects. Each object must have exactly these keys:
- "category": one of: brand, business, audience, content, social, website, custom
- "title": short descriptive title (max 50 chars)
- "content": detailed, useful content (1-4 sentences)

Generate 20-35 diverse, specific memories covering all categories. No markdown, no explanation — pure JSON array only.`;

  try {
    const client = new Anthropic({ apiKey });
    const msg = await client.messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 4096,
      messages: [{ role: 'user', content: prompt }],
    });

    const text = msg.content.find((b) => b.type === 'text')?.text ?? '';
    const jsonMatch = text.match(/\[[\s\S]*\]/);
    if (!jsonMatch) throw new Error('AI did not return valid JSON');

    const items = JSON.parse(jsonMatch[0]) as { category: string; title: string; content: string }[];
    const validCategories = new Set(['brand', 'business', 'audience', 'content', 'social', 'website', 'custom']);

    let count = 0;
    for (const item of items) {
      if (!item.title?.trim() || !item.content?.trim()) continue;
      const cat = validCategories.has(item.category) ? item.category : 'custom';
      await dbQuery(
        `INSERT INTO user_memories (user_id, category, title, content, source)
         VALUES ($1,$2,$3,$4,'generated')
         ON CONFLICT DO NOTHING`,
        [auth.userId, cat, item.title.trim().slice(0, 100), item.content.trim().slice(0, 2000)]
      );
      count++;
    }

    return res.json({ success: true, count });
  } catch (e: any) {
    return res.status(500).json({ success: false, error: e.message });
  }
});

// POST /api/memory/scrape — trigger Apify actors for provided URLs, extract & store memories
app.post('/api/memory/scrape', async (req: Request, res: Response) => {
  const auth = requireAuth(req, res);
  if (!auth) return;
  if (!hasDatabase()) return res.status(503).json({ error: 'Database unavailable' });

  const { website, instagram, linkedin, twitter, facebook } = req.body as {
    website?: string; instagram?: string; linkedin?: string; twitter?: string; facebook?: string;
  };

  type ScrapeJob = { url: string; type: string; actorMatches: string[] };
  const jobs: ScrapeJob[] = [
    { url: website ?? '',   type: 'website',   actorMatches: ['website-content-crawler'] },
    { url: instagram ?? '', type: 'instagram', actorMatches: ['instagram-scraper', 'instagram'] },
    { url: linkedin ?? '',  type: 'linkedin',  actorMatches: ['linkedin-profile-scraper', 'linkedin'] },
    { url: twitter ?? '',   type: 'twitter',   actorMatches: ['twitter-scraper', 'x-scraper', 'twitter'] },
    { url: facebook ?? '',  type: 'facebook',  actorMatches: ['facebook-pages-scraper', 'facebook'] },
  ].filter((j): j is ScrapeJob => Boolean(j.url.trim()));

  if (jobs.length === 0) return res.status(400).json({ error: 'Please provide at least one URL to scrape' });

  const apiToken = await getApifyToken();
  if (!apiToken) return res.status(503).json({ error: 'Apify not configured — ask your admin to add the API key in Admin → Integrations → Apify' });

  let savedActors: any[] = [];
  try {
    const r = await dbQuery('SELECT * FROM apify_actors');
    savedActors = r.rows;
  } catch { /* ignore */ }
  if (savedActors.length === 0) return res.status(503).json({ error: 'No Apify actors set up — ask your admin to add actors in Admin → Integrations → Apify' });

  function buildActorInput(url: string, actorId: string): Record<string, unknown> {
    if (actorId.includes('website-content-crawler')) return { startUrls: [{ url }], maxCrawlPages: 5, maxCrawlDepth: 1 };
    if (actorId.includes('instagram')) return { directUrls: [url], resultsLimit: 10 };
    if (actorId.includes('linkedin')) return { profileUrls: [url] };
    if (actorId.includes('twitter') || actorId.includes('x-scraper')) return { startUrls: [{ url }], maxItems: 20 };
    if (actorId.includes('facebook')) return { startUrls: [{ url }], maxPosts: 10 };
    return { startUrls: [{ url }] };
  }

  const scrapedSections: string[] = [];

  for (const job of jobs) {
    const actor = savedActors.find((a: any) =>
      job.actorMatches.some((m) => a.actor_id.toLowerCase().includes(m)),
    );
    if (!actor) continue;

    try {
      const apifyActorId = (actor.actor_id as string).replace('/', '~');
      const input = buildActorInput(job.url, actor.actor_id as string);
      const runResp = await axios.post(
        `https://api.apify.com/v2/acts/${apifyActorId}/runs`,
        input,
        { headers: { Authorization: `Bearer ${apiToken}`, 'Content-Type': 'application/json' },
          params: { token: apiToken, waitForFinish: 60 },
          timeout: 70000 },
      );
      const run = runResp.data?.data ?? {};
      if (run.defaultDatasetId) {
        const dsResp = await axios.get(
          `https://api.apify.com/v2/datasets/${run.defaultDatasetId}/items`,
          { headers: { Authorization: `Bearer ${apiToken}` }, params: { token: apiToken, limit: 10, clean: true }, timeout: 30000 },
        );
        const items: unknown[] = Array.isArray(dsResp.data) ? dsResp.data : [];
        if (items.length > 0) {
          const text = items.slice(0, 5).map((item) => JSON.stringify(item).slice(0, 1500)).join('\n---\n');
          scrapedSections.push(`=== ${job.type.toUpperCase()}: ${job.url} ===\n${text}`);
        }
      }
    } catch (e) {
      console.error(`Apify scrape error for ${job.type}:`, (e as any)?.message);
    }
  }

  if (scrapedSections.length === 0) {
    return res.status(400).json({ error: 'Scraping finished but no data was returned. Check that your Apify actors are configured and the URLs are accessible.' });
  }

  const fullRaw = scrapedSections.join('\n\n').slice(0, 12000);

  // Save raw "Full Scraped Memory" entry — shown pinned at top of Memory page
  await dbQuery(
    `INSERT INTO user_memories (user_id, category, title, content, source) VALUES ($1,$2,$3,$4,$5)`,
    [auth.userId, 'custom', '🌐 Full Scraped Memory', fullRaw, 'scraped'],
  );
  let memoriesCreated = 1;

  // Use AI to extract structured memory fields from the raw data
  const { encryptedKey } = await getAIConfig();
  const aiKey = (encryptedKey ? decryptAIKey(encryptedKey) : null) || process.env.ANTHROPIC_API_KEY || '';
  if (aiKey) {
    try {
      const client = new Anthropic({ apiKey: aiKey });
      const resp = await client.messages.create({
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 2500,
        messages: [{
          role: 'user',
          content: `Analyse this scraped brand data and extract structured memory fields as a JSON array.

SCRAPED DATA:
${fullRaw.slice(0, 6000)}

Return ONLY a valid JSON array, no markdown fences:
[
  { "category": "brand", "title": "Brand Name", "content": "..." },
  ...
]

Valid categories: brand, business, audience, content, social, website, custom

Extract 8–15 fields covering: brand name, tagline/description, mission, products/services, target audience, brand voice/tone, social media handles, website purpose, key messages, contact details, unique value proposition, competitors, pricing (if visible). Only include fields that have real data from the scraped content. Skip anything empty or irrelevant.`,
        }],
      });
      const raw = resp.content[0]?.type === 'text' ? resp.content[0].text : '';
      const match = raw.match(/\[[\s\S]*\]/);
      if (match) {
        const fields = JSON.parse(match[0]) as { category?: string; title?: string; content?: string }[];
        for (const f of fields) {
          if (f.title?.trim() && f.content?.trim()) {
            await dbQuery(
              `INSERT INTO user_memories (user_id, category, title, content, source) VALUES ($1,$2,$3,$4,$5) ON CONFLICT DO NOTHING`,
              [auth.userId, f.category ?? 'custom', f.title.trim().slice(0, 200), f.content.trim().slice(0, 2000), 'scraped'],
            );
            memoriesCreated++;
          }
        }
      }
    } catch (e) {
      console.error('AI memory extraction error:', (e as any)?.message);
    }
  }

  return res.json({ success: true, count: memoriesCreated });
});

// ── End User Memory Routes ────────────────────────────────────────────────────

// ── Daky Learn Routes ─────────────────────────────────────────────────────────

// GET /api/learn — list all learned items (admin only) with optional filters
app.get('/api/learn', async (req: Request, res: Response) => {
  try {
    const admin = await requireAdmin(req, res);
    if (!admin) return;
    if (!pool) return res.json({ success: true, items: [] });
    const { search, category, label, from, to } = req.query as Record<string, string>;
    const conditions: string[] = [];
    const params: any[] = [];
    let idx = 1;
    if (search) { conditions.push(`(title ILIKE $${idx} OR summary ILIKE $${idx})`); params.push(`%${search}%`); idx++; }
    if (category) { conditions.push(`category = $${idx}`); params.push(category); idx++; }
    if (label) { conditions.push(`$${idx} = ANY(labels)`); params.push(label); idx++; }
    if (from) { conditions.push(`created_at >= $${idx}`); params.push(from); idx++; }
    if (to) { conditions.push(`created_at <= $${idx}`); params.push(to); idx++; }
    const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
    const { rows } = await dbQuery(
      `SELECT id, title, url, source_type, summary, key_points, saas_application, category, labels, created_at FROM learned_items ${where} ORDER BY created_at DESC`,
      params
    );
    return res.json({ success: true, items: rows });
  } catch (e: any) {
    return res.status(500).json({ success: false, error: e.message });
  }
});

// GET /api/learn/meta — distinct categories and labels (for filter dropdowns)
app.get('/api/learn/meta', async (req: Request, res: Response) => {
  try {
    const admin = await requireAdmin(req, res);
    if (!admin) return;
    if (!pool) return res.json({ success: true, categories: [], labels: [] });
    const { rows: catRows } = await dbQuery(`SELECT DISTINCT category FROM learned_items ORDER BY category`, []);
    const { rows: lblRows } = await dbQuery(`SELECT DISTINCT unnest(labels) AS label FROM learned_items ORDER BY label`, []);
    return res.json({
      success: true,
      categories: catRows.map((r: any) => r.category),
      labels: lblRows.map((r: any) => r.label),
    });
  } catch (e: any) {
    return res.status(500).json({ success: false, error: e.message });
  }
});

// POST /api/learn — add a URL, scrape content, extract learnings
app.post('/api/learn', async (req: Request, res: Response) => {
  try {
    const admin = await requireAdmin(req, res);
    if (!admin) return;
    const { url, category, labels } = req.body as { url: string; category?: string; labels?: string[] };
    if (!url || !url.startsWith('http')) return res.status(400).json({ success: false, error: 'Valid URL required' });

    const learnCfg = await getAIConfig();
    const apiKey = resolveActiveKey(learnCfg);
    if (!apiKey) return res.status(503).json({ success: false, error: 'AI not configured' });

    const isYouTube = /youtube\.com|youtu\.be/.test(url);
    const source_type = isYouTube ? 'video' : 'article';

    // Fetch clean content via Jina reader (works for both articles and YouTube pages)
    let rawContent = '';
    try {
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), 20000);
      const jinaRes = await fetch(`https://r.jina.ai/${url}`, {
        signal: ctrl.signal,
        headers: { Accept: 'text/plain', 'X-No-Cache': 'true' },
      });
      clearTimeout(timer);
      rawContent = (await jinaRes.text()).slice(0, 15000);
    } catch { /* non-fatal */ }

    const LEARN_EXTRACT_PROMPT = `You are an expert marketing analyst. Analyze this content FULLY and return ONLY a valid JSON object — no markdown, no explanation, no extra text.

JSON shape:
{
  "title": "Specific, descriptive title of what this content covers (under 80 chars)",
  "summary": "3-4 sentences summarizing exactly what this content covers. Be specific to THIS content, not generic.",
  "key_points": [
    "Specific insight 1 extracted from this content",
    "Specific insight 2 extracted from this content",
    "Specific insight 3 extracted from this content",
    "Specific insight 4",
    "Specific insight 5",
    "Specific insight 6"
  ],
  "saas_application": "3-4 sentences on HOW SPECIFICALLY the insights from this content apply to marketing a SaaS product. Reference actual tactics, platforms, or strategies mentioned in the content. Be concrete — name what the SaaS should do differently.",
  "category": "one of: Content Strategy | Audience Growth | Platform Algorithms | Brand Voice | Analytics | Engagement | Copywriting | Visual Design | Scheduling | General",
  "labels": ["specific-tag-1", "specific-tag-2", "specific-tag-3"]
}`;

    let extracted: any = {};

    // For YouTube + Google provider: use Gemini's native video understanding
    if (isYouTube && learnCfg.provider === 'google') {
      try {
        const videoModel = GEMINI_MODELS.includes(learnCfg.model) ? learnCfg.model : 'gemini-2.0-flash';
        const genAI = new GoogleGenerativeAI(apiKey);
        const gModel = genAI.getGenerativeModel({ model: videoModel });
        const result = await gModel.generateContent([
          { fileData: { fileUri: url } },
          { text: `${LEARN_EXTRACT_PROMPT}\n\nAnalyze this YouTube video and return the JSON:` },
        ]);
        const raw = result.response.text();
        const jsonMatch = raw.match(/\{[\s\S]*\}/);
        if (jsonMatch) extracted = JSON.parse(jsonMatch[0]);
      } catch {
        // fall through to text-based extraction
      }
    }

    // For articles or as fallback: use text content via callAINonStreaming
    if (!extracted.title) {
      try {
        const learnFastModel = learnCfg.provider === 'google'
          ? (GEMINI_MODELS.includes(learnCfg.model) ? learnCfg.model : 'gemini-2.0-flash')
          : 'claude-haiku-4-5-20251001';
        const raw = await callAINonStreaming(
          learnCfg.provider,
          apiKey,
          learnFastModel,
          LEARN_EXTRACT_PROMPT,
          `URL: ${url}\n\nContent:\n${rawContent || '(could not fetch content)'}`,
          1500,
        );
        const jsonMatch = raw.match(/\{[\s\S]*\}/);
        if (jsonMatch) extracted = JSON.parse(jsonMatch[0]);
      } catch { /* use defaults */ }
    }

    const finalCategory = category || extracted.category || 'General';
    const finalLabels = labels?.length ? labels : (extracted.labels || []);

    const { rows: [item] } = await dbQuery(
      `INSERT INTO learned_items (title, url, source_type, summary, key_points, saas_application, category, labels, raw_content)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING id, title, url, source_type, summary, key_points, saas_application, category, labels, created_at`,
      [
        extracted.title || url,
        url,
        source_type,
        extracted.summary || '',
        extracted.key_points || [],
        extracted.saas_application || '',
        finalCategory,
        finalLabels,
        rawContent.slice(0, 8000),
      ]
    );

    return res.json({ success: true, item });
  } catch (e: any) {
    return res.status(500).json({ success: false, error: e.message });
  }
});

// DELETE /api/learn/:id
app.delete('/api/learn/:id', async (req: Request, res: Response) => {
  try {
    const admin = await requireAdmin(req, res);
    if (!admin) return;
    await dbQuery(`DELETE FROM learned_items WHERE id = $1`, [req.params.id]);
    return res.json({ success: true });
  } catch (e: any) {
    return res.status(500).json({ success: false, error: e.message });
  }
});

// POST /api/learn/:id/analyze — deep-analyze an existing item and fill in saas_application
app.post('/api/learn/:id/analyze', async (req: Request, res: Response) => {
  try {
    const admin = await requireAdmin(req, res);
    if (!admin) return;
    const { rows } = await dbQuery(
      `SELECT id, title, url, summary, key_points, raw_content FROM learned_items WHERE id = $1`,
      [req.params.id],
    );
    if (!rows.length) return res.status(404).json({ success: false, error: 'Item not found' });
    const item = rows[0];

    const cfg = await getAIConfig();
    const apiKey = resolveActiveKey(cfg);
    if (!apiKey) return res.status(503).json({ success: false, error: 'AI not configured' });

    const fastModel = cfg.provider === 'google'
      ? (GEMINI_MODELS.includes(cfg.model) ? cfg.model : 'gemini-2.0-flash')
      : 'claude-haiku-4-5-20251001';

    const isYouTubeItem = /youtube\.com|youtu\.be/.test(item.url || '');

    // Re-fetch fresh content via Jina if raw_content is sparse
    let freshContent = (item.raw_content || '').slice(0, 12000);
    if (!freshContent || freshContent.length < 500) {
      try {
        const ctrl = new AbortController();
        const timer = setTimeout(() => ctrl.abort(), 20000);
        const jinaRes = await fetch(`https://r.jina.ai/${item.url}`, {
          signal: ctrl.signal,
          headers: { Accept: 'text/plain', 'X-No-Cache': 'true' },
        });
        clearTimeout(timer);
        freshContent = (await jinaRes.text()).slice(0, 12000);
      } catch { /* use stored content */ }
    }

    const analyzeJsonShape = `{
  "title": "Specific descriptive title (under 80 chars)",
  "summary": "3-4 sentences summarizing exactly what this content covers. Be specific.",
  "key_points": ["Specific insight 1 from this content", "Specific insight 2", "Specific insight 3", "insight 4", "insight 5", "insight 6"],
  "saas_application": "3-4 sentences: HOW SPECIFICALLY do the insights from this content apply to marketing a SaaS? Reference actual tactics or strategies from the content. Name what the SaaS should do."
}`;

    let parsed: any = {};

    // For YouTube + Google: use Gemini native video understanding
    if (isYouTubeItem && cfg.provider === 'google') {
      try {
        const genAI = new GoogleGenerativeAI(apiKey);
        const gModel = genAI.getGenerativeModel({ model: fastModel });
        const result = await gModel.generateContent([
          { fileData: { fileUri: item.url } },
          { text: `You are a SaaS marketing analyst. Watch this video fully and return ONLY a valid JSON object — no markdown, no extra text.\n\nJSON shape:\n${analyzeJsonShape}` },
        ]);
        const raw = result.response.text();
        const match = raw.match(/\{[\s\S]*\}/);
        if (match) parsed = JSON.parse(match[0]);
      } catch { /* fall through to text */ }
    }

    // Fallback: text-based analysis
    if (!parsed.saas_application) {
      try {
        const raw = await callAINonStreaming(
          cfg.provider, apiKey, fastModel,
          'You are a SaaS marketing analyst. Return only valid JSON — no markdown, no extra text.',
          `Analyze this content and return the JSON:\n\nURL: ${item.url}\nTitle: ${item.title}\n\nContent:\n${freshContent || '(none)'}\n\nJSON shape:\n${analyzeJsonShape}`,
          1200,
        );
        const match = raw.match(/\{[\s\S]*\}/);
        if (match) parsed = JSON.parse(match[0]);
      } catch { /* fallback */ }
    }

    const newTitle = parsed.title || item.title;
    const newSummary = parsed.summary || item.summary;
    const newKeyPoints = Array.isArray(parsed.key_points) && parsed.key_points.length > 0
      ? parsed.key_points : item.key_points;
    const newSaasApplication = parsed.saas_application || '';
    const newRawContent = freshContent || item.raw_content || '';

    const { rows: [updated] } = await dbQuery(
      `UPDATE learned_items
         SET title = $1, summary = $2, key_points = $3, saas_application = $4, raw_content = $5
       WHERE id = $6
       RETURNING id, title, url, source_type, summary, key_points, saas_application, category, labels, created_at`,
      [newTitle, newSummary, newKeyPoints, newSaasApplication, newRawContent.slice(0, 8000), item.id],
    );

    return res.json({ success: true, item: updated });
  } catch (e: any) {
    return res.status(500).json({ success: false, error: e.message });
  }
});

// POST /api/learn/compile — compile all items in a category into an AI skill
app.post('/api/learn/compile', async (req: Request, res: Response) => {
  try {
    const admin = await requireAdmin(req, res);
    if (!admin) return;
    const { category } = req.body as { category: string };
    if (!category) return res.status(400).json({ success: false, error: 'Category required' });

    if (!pool) return res.status(503).json({ success: false, error: 'No database' });
    const { rows } = await dbQuery(
      `SELECT title, summary, key_points FROM learned_items WHERE category = $1 ORDER BY created_at ASC`,
      [category]
    );
    if (rows.length === 0) return res.status(400).json({ success: false, error: 'No items in this category' });

    const aiCfgCompile = await getAIConfig();
    const compileKey = resolveActiveKey(aiCfgCompile);
    if (!compileKey) return res.status(503).json({ success: false, error: 'AI not configured' });

    // Compile all key points into a single skill prompt
    const knowledgeBlob = rows.map((r: any) => {
      const pts = (r.key_points as string[]).map((p: string) => `  - ${p}`).join('\n');
      return `### ${r.title}\n${r.summary}\n${pts}`;
    }).join('\n\n');

    const fastModel = aiCfgCompile.provider === 'google'
      ? (GEMINI_MODELS.includes(aiCfgCompile.model) ? aiCfgCompile.model : 'gemini-2.0-flash')
      : 'claude-haiku-4-5-20251001';

    const compiledPrompt = await callAINonStreaming(
      aiCfgCompile.provider,
      compileKey,
      fastModel,
      'You are a system prompt engineer. Given a collection of marketing learnings in a category, write a concise, expert skill block that Daky (an AI social media marketing butler) should internalize and apply. Write in directive second-person ("When you..."). Be specific, not generic. Output ONLY the skill prompt text — no JSON, no headers.',
      `Category: ${category}\n\nLearnings:\n${knowledgeBlob}`,
      1500,
    );

    // Upsert as an AI skill (replace existing compiled skill for this category)
    const skillName = `Learned: ${category}`;
    const existing = await dbQuery(`SELECT id FROM ai_skills WHERE name = $1`, [skillName]);
    if (existing.rows.length > 0) {
      await dbQuery(
        `UPDATE ai_skills SET system_prompt = $1, description = $2, updated_at = NOW() WHERE name = $3`,
        [compiledPrompt, `Auto-compiled from ${rows.length} learned item(s) in "${category}"`, skillName]
      );
    } else {
      await dbQuery(
        `INSERT INTO ai_skills (id, name, description, system_prompt, scope, enabled, sort_order) VALUES ($1,$2,$3,$4,'all',true,100)`,
        [randomUUID(), skillName, `Auto-compiled from ${rows.length} learned item(s) in "${category}"`, compiledPrompt]
      );
    }

    createNotification(admin.userId, 'skill_compiled',
      'Skill compiled',
      `"${skillName}" was built from ${rows.length} item(s) in "${category}" and is now active.`,
      { category, itemCount: rows.length },
    ).catch(() => undefined);
    return res.json({ success: true, skillName, itemCount: rows.length });
  } catch (e: any) {
    return res.status(500).json({ success: false, error: e.message });
  }
});

// ── End Daky Learn Routes ─────────────────────────────────────────────────────

// ── Notifications ─────────────────────────────────────────────────────────────

// GET /api/notifications — list recent notifications with unread count
app.get('/api/notifications', async (req: Request, res: Response) => {
  const auth = await requireAuth(req, res);
  if (!auth) return;
  if (!pool) return res.json({ success: true, notifications: [], unreadCount: 0 });
  try {
    const { rows } = await dbQuery(
      `SELECT id, type, title, message, data, is_read, pinned, created_at
       FROM notifications WHERE user_id = $1
       ORDER BY pinned DESC, created_at DESC LIMIT 50`,
      [auth.userId],
    );
    const unreadCount = rows.filter((n: any) => !n.is_read).length;
    return res.json({ success: true, notifications: rows, unreadCount });
  } catch (e: any) {
    return res.status(500).json({ success: false, error: e.message });
  }
});

// PATCH /api/notifications/read-all — mark all as read
app.patch('/api/notifications/read-all', async (req: Request, res: Response) => {
  const auth = await requireAuth(req, res);
  if (!auth) return;
  try {
    await dbQuery(`UPDATE notifications SET is_read = true WHERE user_id = $1`, [auth.userId]);
    return res.json({ success: true });
  } catch (e: any) {
    return res.status(500).json({ success: false, error: e.message });
  }
});

// PATCH /api/notifications/:id/read — mark one as read
app.patch('/api/notifications/:id/read', async (req: Request, res: Response) => {
  const auth = await requireAuth(req, res);
  if (!auth) return;
  try {
    await dbQuery(`UPDATE notifications SET is_read = true WHERE id = $1 AND user_id = $2`, [req.params.id, auth.userId]);
    return res.json({ success: true });
  } catch (e: any) {
    return res.status(500).json({ success: false, error: e.message });
  }
});

// DELETE /api/notifications/:id — dismiss one
app.delete('/api/notifications/:id', async (req: Request, res: Response) => {
  const auth = await requireAuth(req, res);
  if (!auth) return;
  try {
    await dbQuery(`DELETE FROM notifications WHERE id = $1 AND user_id = $2`, [req.params.id, auth.userId]);
    return res.json({ success: true });
  } catch (e: any) {
    return res.status(500).json({ success: false, error: e.message });
  }
});

// DELETE /api/notifications — clear all
app.delete('/api/notifications', async (req: Request, res: Response) => {
  const auth = await requireAuth(req, res);
  if (!auth) return;
  try {
    await dbQuery(`DELETE FROM notifications WHERE user_id = $1 AND pinned = false`, [auth.userId]);
    return res.json({ success: true });
  } catch (e: any) {
    return res.status(500).json({ success: false, error: e.message });
  }
});

// POST /api/invitations/:token/decline — decline an invitation
app.post('/api/invitations/:token/decline', async (req: Request, res: Response) => {
  const auth = requireAuth(req, res);
  if (!auth) return;
  if (!hasDatabase()) return res.status(503).json({ success: false, error: 'Database unavailable' });
  const { token } = req.params;
  try {
    const { rows } = await dbQuery(
      `SELECT oi.*, o.name AS org_name FROM organization_invitations oi
       JOIN organizations o ON o.id = oi.org_id WHERE oi.token = $1`,
      [token]
    );
    if (!rows.length) return res.status(404).json({ success: false, error: 'Invitation not found' });
    const inv = rows[0];
    if (inv.accepted_at) return res.status(409).json({ success: false, error: 'Invitation already accepted' });
    // Mark as declined by setting accepted_at to a sentinel value (null keeps it pending, so we delete it)
    await dbQuery(`DELETE FROM organization_invitations WHERE token = $1`, [token]);
    // Remove the pinned notification for this user
    await dbQuery(
      `DELETE FROM notifications WHERE user_id = $1 AND type = 'team_invite' AND data->>'token' = $2`,
      [auth.userId, token]
    );
    // Notify the inviter of the decline
    const { rows: declinerRows } = await dbQuery(`SELECT full_name, email FROM users WHERE id = $1`, [auth.userId]);
    const declinerName = declinerRows[0]?.full_name || declinerRows[0]?.email || 'Someone';
    createNotification(
      inv.invited_by_user_id,
      'invite_declined',
      `${declinerName} declined your invitation`,
      `${declinerName} declined the invitation to join ${inv.org_name}. You can invite them again any time.`,
      { orgId: inv.org_id },
    );
    return res.json({ success: true });
  } catch (e: any) {
    return res.status(500).json({ success: false, error: e.message });
  }
});

// ── End Notifications ─────────────────────────────────────────────────────────

// GET /api/admin/billing/metrics — MRR, ARR, customer counts
app.get('/api/admin/billing/metrics', async (req: Request, res: Response) => {
  const admin = await requireAdmin(req, res);
  if (!admin) return;
  if (!hasDatabase()) return res.json({ success: true, metrics: {} });
  try {
    const { rows: subStats } = await dbQuery(`
      SELECT
        COUNT(*)::int AS total_subscriptions,
        COUNT(*) FILTER (WHERE s.status = 'active')::int AS active_subscriptions,
        COUNT(*) FILTER (WHERE s.status = 'past_due')::int AS past_due_subscriptions,
        COUNT(*) FILTER (WHERE s.status = 'canceled')::int AS canceled_subscriptions,
        SUM(p.price) FILTER (WHERE s.status = 'active' AND p.billing_period = 'monthly') AS monthly_revenue,
        SUM(p.price / 12) FILTER (WHERE s.status = 'active' AND p.billing_period = 'yearly') AS yearly_revenue_monthly
      FROM subscriptions s
      LEFT JOIN pricing_plans p ON p.id = s.plan_id
    `);
    const { rows: totalUsers } = await dbQuery(`SELECT COUNT(*)::int AS cnt FROM users`);
    const { rows: planBreakdown } = await dbQuery(`
      SELECT p.name AS plan_name, p.price, p.billing_period,
        COUNT(s.id)::int AS subscriber_count,
        SUM(CASE WHEN p.billing_period='monthly' THEN p.price WHEN p.billing_period='yearly' THEN p.price/12 ELSE 0 END) AS mrr_contribution
      FROM subscriptions s
      JOIN pricing_plans p ON p.id = s.plan_id
      WHERE s.status = 'active'
      GROUP BY p.id, p.name, p.price, p.billing_period
      ORDER BY mrr_contribution DESC NULLS LAST
    `);
    const { rows: recentTxn } = await dbQuery(`
      SELECT bi.invoice_number, bi.total_cents, bi.currency, bi.paid_at, bi.status, u.email
      FROM billing_invoices bi JOIN users u ON u.id=bi.user_id
      ORDER BY bi.created_at DESC LIMIT 10
    `);

    const s = subStats[0] || {};
    const monthlyMRR = parseFloat(s.monthly_revenue || '0');
    const yearlyMRR = parseFloat(s.yearly_revenue_monthly || '0');
    const mrr = monthlyMRR + yearlyMRR;
    const arr = mrr * 12;
    const activeCount = s.active_subscriptions || 0;
    const arpu = activeCount > 0 ? mrr / activeCount : 0;

    res.json({
      success: true,
      metrics: {
        mrr: Math.round(mrr * 100) / 100,
        arr: Math.round(arr * 100) / 100,
        arpu: Math.round(arpu * 100) / 100,
        total_users: totalUsers[0]?.cnt || 0,
        active_subscriptions: activeCount,
        past_due: s.past_due_subscriptions || 0,
        canceled: s.canceled_subscriptions || 0,
      },
      plan_breakdown: planBreakdown,
      recent_invoices: recentTxn,
      stripe_configured: Boolean(stripe),
    });
  } catch (e) {
    res.status(500).json({ success: false, error: 'Failed to load billing metrics' });
  }
});

// GET /api/admin/billing/customers — paginated customer list with billing info
app.get('/api/admin/billing/customers', async (req: Request, res: Response) => {
  const admin = await requireAdmin(req, res);
  if (!admin) return;
  if (!hasDatabase()) return res.json({ success: true, customers: [], total: 0 });
  const limit = Math.min(parseInt(String(req.query.limit || '50')), 100);
  const offset = parseInt(String(req.query.offset || '0'));
  const search = String(req.query.search || '').trim();
  try {
    const searchClause = search ? `AND (u.email ILIKE $3 OR u.full_name ILIKE $3)` : '';
    const params: unknown[] = [limit, offset];
    if (search) params.push(`%${search}%`);
    const { rows: customers } = await dbQuery(
      `SELECT u.id, u.email, u.full_name, u.created_at,
        p.name AS plan_name, p.price, p.billing_period,
        s.status AS subscription_status, s.current_period_end, s.cancel_at_period_end
       FROM users u
       LEFT JOIN pricing_plans p ON p.id = u.plan_id
       LEFT JOIN subscriptions s ON s.user_id = u.id
       WHERE u.role != 'admin' ${searchClause}
       ORDER BY u.created_at DESC
       LIMIT $1 OFFSET $2`,
      params
    );
    const { rows: countRow } = await dbQuery(
      `SELECT COUNT(*)::int AS total FROM users u WHERE u.role != 'admin' ${search ? "AND (u.email ILIKE $1 OR u.full_name ILIKE $1)" : ''}`,
      search ? [`%${search}%`] : []
    );
    res.json({ success: true, customers, total: countRow[0]?.total || 0 });
  } catch (e) {
    res.status(500).json({ success: false, error: 'Failed to load customers' });
  }
});

// PUT /api/admin/billing/customers/:userId/plan — manually assign plan
app.put('/api/admin/billing/customers/:userId/plan', async (req: Request, res: Response) => {
  const admin = await requireAdmin(req, res);
  if (!admin) return;
  if (!hasDatabase()) return res.status(503).json({ success: false, error: 'Database unavailable' });
  const { userId } = req.params;
  const { planId } = req.body as { planId: string | null };
  try {
    await dbQuery(`UPDATE users SET plan_id=$1 WHERE id=$2`, [planId || null, userId]);
    if (planId) {
      await dbQuery(
        `INSERT INTO subscriptions (id, user_id, plan_id, status, updated_at) VALUES ($1,$2,$3,'active',NOW())
         ON CONFLICT (user_id) DO UPDATE SET plan_id=EXCLUDED.plan_id, status='active', updated_at=NOW()`,
        [randomUUID(), userId, planId]
      );
    } else {
      await dbQuery(`UPDATE subscriptions SET status='canceled', canceled_at=NOW(), updated_at=NOW() WHERE user_id=$1`, [userId]);
    }
    res.json({ success: true });
  } catch (e) {
    res.status(500).json({ success: false, error: 'Failed to update plan' });
  }
});

// ── End Billing Routes ─────────────────────────────────────────────────────────

// ─── Apify Admin Routes ────────────────────────────────────────────────────────

async function getApifyToken(): Promise<string | null> {
  try {
    const r = await dbQuery<{ config: Record<string, string> }>(
      `SELECT config FROM platform_configs WHERE platform = 'apify' AND enabled = true LIMIT 1`
    );
    return r.rows[0]?.config?.apiKey ?? null;
  } catch { return null; }
}

// GET /api/admin/apify/status — check Apify connection
app.get('/api/admin/apify/status', async (req: Request, res: Response) => {
  const admin = await requireAdmin(req, res);
  if (!admin) return;
  const token = await getApifyToken();
  if (!token) return res.json({ connected: false });
  try {
    const resp = await axios.get('https://api.apify.com/v2/users/me', {
      headers: { Authorization: `Bearer ${token}` },
      params: { token },
      validateStatus: () => true,
      timeout: 8000,
    });
    if (resp.status !== 200) return res.json({ connected: false });
    const d = resp.data?.data ?? {};
    return res.json({
      connected: true,
      username: d.username || d.email || '',
      plan: d.plan?.id ?? '',
      creditBalance: d.limits?.monthlyUsageUsd ?? null,
    });
  } catch {
    return res.json({ connected: false });
  }
});

// GET /api/admin/apify/actors — list saved actors
app.get('/api/admin/apify/actors', async (req: Request, res: Response) => {
  const admin = await requireAdmin(req, res);
  if (!admin) return;
  if (!hasDatabase()) return res.json({ actors: [] });
  try {
    const { rows } = await dbQuery(`SELECT * FROM apify_actors ORDER BY created_at DESC`);
    return res.json({ actors: rows });
  } catch {
    return res.status(500).json({ error: 'Failed to fetch actors' });
  }
});

// POST /api/admin/apify/actors — save an actor
app.post('/api/admin/apify/actors', async (req: Request, res: Response) => {
  const admin = await requireAdmin(req, res);
  if (!admin) return;
  if (!hasDatabase()) return res.status(503).json({ error: 'Database unavailable' });
  const { actor_id, name, description = '', tag = 'Custom' } = req.body as { actor_id: string; name: string; description?: string; tag?: string };
  if (!actor_id?.trim() || !name?.trim()) return res.status(400).json({ error: 'actor_id and name required' });
  try {
    const { rows } = await dbQuery(
      `INSERT INTO apify_actors (actor_id, name, description, tag)
       VALUES ($1,$2,$3,$4)
       ON CONFLICT (actor_id) DO UPDATE SET name=EXCLUDED.name, description=EXCLUDED.description, tag=EXCLUDED.tag
       RETURNING *`,
      [actor_id.trim(), name.trim(), description.trim(), tag.trim()]
    );
    return res.json({ actor: rows[0] });
  } catch {
    return res.status(500).json({ error: 'Failed to save actor' });
  }
});

// DELETE /api/admin/apify/actors/:id — remove an actor
app.delete('/api/admin/apify/actors/:id', async (req: Request, res: Response) => {
  const admin = await requireAdmin(req, res);
  if (!admin) return;
  if (!hasDatabase()) return res.status(503).json({ error: 'Database unavailable' });
  await dbQuery(`DELETE FROM apify_actors WHERE id=$1`, [req.params.id]);
  return res.json({ success: true });
});

// POST /api/admin/apify/actors/:id/run — trigger an actor run
app.post('/api/admin/apify/actors/:id/run', async (req: Request, res: Response) => {
  const admin = await requireAdmin(req, res);
  if (!admin) return;
  if (!hasDatabase()) return res.status(503).json({ error: 'Database unavailable' });
  const apiToken = await getApifyToken();
  if (!apiToken) return res.status(400).json({ error: 'Apify API key not configured' });
  try {
    const { rows } = await dbQuery(`SELECT * FROM apify_actors WHERE id=$1`, [req.params.id]);
    const actor = rows[0];
    if (!actor) return res.status(404).json({ error: 'Actor not found' });

    const input = (req.body as { input?: Record<string, unknown> }).input ?? {};
    // Apify REST API uses '~' as username/actor-name separator in URL paths.
    // 'apify/instagram-scraper' → 'apify~instagram-scraper'
    const apifyActorId = actor.actor_id.replace('/', '~');
    const resp = await axios.post(
      `https://api.apify.com/v2/acts/${apifyActorId}/runs`,
      input,
      {
        headers: { Authorization: `Bearer ${apiToken}`, 'Content-Type': 'application/json' },
        params: { token: apiToken },
        validateStatus: () => true,
        timeout: 15000,
      }
    );
    if (resp.status >= 400) return res.status(400).json({ error: `Apify error ${resp.status}: ${JSON.stringify(resp.data)}` });

    const run = resp.data?.data ?? {};
    await dbQuery(
      `INSERT INTO apify_runs (actor_db_id, actor_name, apify_run_id, status, input)
       VALUES ($1,$2,$3,$4,$5)`,
      [actor.id, actor.name, run.id ?? 'unknown', run.status ?? 'READY', JSON.stringify(input)]
    );
    return res.json({ success: true, runId: run.id });
  } catch (e) {
    return res.status(500).json({ error: 'Failed to start run' });
  }
});

// GET /api/admin/apify/runs — list recent runs (merged DB + live Apify status)
app.get('/api/admin/apify/runs', async (req: Request, res: Response) => {
  const admin = await requireAdmin(req, res);
  if (!admin) return;
  if (!hasDatabase()) return res.json({ runs: [] });
  try {
    const { rows } = await dbQuery(
      `SELECT r.*, a.actor_id FROM apify_runs r LEFT JOIN apify_actors a ON a.id = r.actor_db_id ORDER BY r.started_at DESC LIMIT 50`
    );

    // Attempt live status refresh from Apify for RUNNING/READY rows
    const apiToken = await getApifyToken();
    if (apiToken && rows.length) {
      const pending = rows.filter((r) => r.status === 'RUNNING' || r.status === 'READY');
      await Promise.allSettled(pending.map(async (run) => {
        try {
          const resp = await axios.get(`https://api.apify.com/v2/actor-runs/${run.apify_run_id}`, {
            headers: { Authorization: `Bearer ${apiToken}` },
            params: { token: apiToken },
            validateStatus: () => true,
            timeout: 5000,
          });
          if (resp.status === 200) {
            const d = resp.data?.data ?? {};
            await dbQuery(
              `UPDATE apify_runs SET status=$1, dataset_id=$2, finished_at=$3 WHERE id=$4`,
              [d.status ?? run.status, d.defaultDatasetId ?? run.dataset_id, d.finishedAt ?? run.finished_at, run.id]
            );
            run.status = d.status ?? run.status;
            run.dataset_id = d.defaultDatasetId ?? run.dataset_id;
            run.finished_at = d.finishedAt ?? run.finished_at;
          }
        } catch { /* skip */ }
      }));
    }

    return res.json({ runs: rows });
  } catch {
    return res.status(500).json({ error: 'Failed to fetch runs' });
  }
});

// ── End Apify Admin Routes ─────────────────────────────────────────────────────

// ─── Workspace / Organization Routes ───────────────────────────────────────────

// GET /api/workspace/summary — returns user's orgs with role + member_count
app.get('/api/workspace/summary', async (req: Request, res: Response) => {
  const auth = requireAuth(req, res);
  if (!auth) return;
  if (!hasDatabase()) return res.json({ success: true, organizations: [] });
  try {
    const { rows: orgs } = await dbQuery(
      `SELECT o.id, o.name, o.slug, o.description, o.logo_url, o.owner_id, o.created_at, o.updated_at, om.role,
        (SELECT COUNT(*)::int FROM organization_memberships WHERE org_id = o.id) AS member_count
       FROM organizations o
       JOIN organization_memberships om ON om.org_id = o.id AND om.user_id = $1
       ORDER BY o.created_at ASC`,
      [auth.userId]
    );
    res.json({ success: true, organizations: orgs });
  } catch (e) {
    res.status(500).json({ success: false, error: 'Failed to load workspace summary' });
  }
});

// POST /api/organizations — create a new organization
app.post('/api/organizations', async (req: Request, res: Response) => {
  const auth = requireAuth(req, res);
  if (!auth) return;
  if (!hasDatabase()) return res.status(503).json({ success: false, error: 'Database unavailable' });
  const { name, description = '', slug: rawSlug } = req.body as { name: string; description?: string; slug?: string };
  if (!name?.trim()) return res.status(400).json({ success: false, error: 'Name is required' });
  try {
    const orgId = randomUUID();
    const slug = rawSlug?.trim()
      ? rawSlug.toLowerCase().replace(/[^a-z0-9-]+/g, '-').replace(/^-|-$/g, '').substring(0, 60)
      : `${name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').substring(0, 40)}-${orgId.substring(0, 6)}`;
    await dbQuery(
      `INSERT INTO organizations (id, name, slug, description, owner_id) VALUES ($1, $2, $3, $4, $5)`,
      [orgId, name.trim(), slug, description.trim(), auth.userId]
    );
    await dbQuery(
      `INSERT INTO organization_memberships (id, org_id, user_id, role) VALUES ($1, $2, $3, 'owner')`,
      [randomUUID(), orgId, auth.userId]
    );
    const { rows } = await dbQuery(
      `SELECT o.*, om.role FROM organizations o JOIN organization_memberships om ON om.org_id = o.id AND om.user_id = $1 WHERE o.id = $2`,
      [auth.userId, orgId]
    );
    res.json({ success: true, organization: rows[0] });
  } catch (e: any) {
    if (e?.code === '23505') return res.status(409).json({ success: false, error: 'Slug already taken' });
    res.status(500).json({ success: false, error: 'Failed to create organization' });
  }
});

// GET /api/organizations/:orgId
app.get('/api/organizations/:orgId', async (req: Request, res: Response) => {
  const { orgId } = req.params;
  const membership = await requireOrgMembership(req, res, orgId);
  if (!membership) return;
  try {
    const { rows } = await dbQuery(
      `SELECT o.*, om.role, (SELECT COUNT(*)::int FROM organization_memberships WHERE org_id = o.id) AS member_count
       FROM organizations o JOIN organization_memberships om ON om.org_id = o.id AND om.user_id = $1 WHERE o.id = $2`,
      [membership.userId, orgId]
    );
    if (!rows.length) return res.status(404).json({ success: false, error: 'Organization not found' });
    res.json({ success: true, organization: rows[0] });
  } catch (e) {
    res.status(500).json({ success: false, error: 'Failed to load organization' });
  }
});

// PUT /api/organizations/:orgId
app.put('/api/organizations/:orgId', async (req: Request, res: Response) => {
  const { orgId } = req.params;
  const membership = await requireOrgMembership(req, res, orgId, 'admin');
  if (!membership) return;
  const { name, description, slug: rawSlug } = req.body as { name?: string; description?: string; slug?: string };
  try {
    const updates: string[] = [];
    const vals: unknown[] = [];
    let i = 1;
    if (name !== undefined) { updates.push(`name = $${i++}`); vals.push(name.trim()); }
    if (description !== undefined) { updates.push(`description = $${i++}`); vals.push(description.trim()); }
    if (rawSlug !== undefined) {
      const slug = rawSlug.toLowerCase().replace(/[^a-z0-9-]+/g, '-').replace(/^-|-$/g, '').substring(0, 60);
      updates.push(`slug = $${i++}`); vals.push(slug);
    }
    if (updates.length === 0) return res.status(400).json({ success: false, error: 'Nothing to update' });
    updates.push(`updated_at = NOW()`);
    vals.push(orgId);
    await dbQuery(`UPDATE organizations SET ${updates.join(', ')} WHERE id = $${i}`, vals);
    const { rows } = await dbQuery(
      `SELECT o.*, om.role FROM organizations o JOIN organization_memberships om ON om.org_id = o.id AND om.user_id = $1 WHERE o.id = $2`,
      [membership.userId, orgId]
    );
    res.json({ success: true, organization: rows[0] });
  } catch (e: any) {
    if (e?.code === '23505') return res.status(409).json({ success: false, error: 'Slug already taken' });
    res.status(500).json({ success: false, error: 'Failed to update organization' });
  }
});

// DELETE /api/organizations/:orgId
app.delete('/api/organizations/:orgId', async (req: Request, res: Response) => {
  const { orgId } = req.params;
  const membership = await requireOrgMembership(req, res, orgId, 'owner');
  if (!membership) return;
  try {
    await dbQuery(`DELETE FROM organizations WHERE id = $1`, [orgId]);
    res.json({ success: true });
  } catch (e) {
    res.status(500).json({ success: false, error: 'Failed to delete organization' });
  }
});

// GET /api/organizations/:orgId/members
app.get('/api/organizations/:orgId/members', async (req: Request, res: Response) => {
  const { orgId } = req.params;
  const membership = await requireOrgMembership(req, res, orgId);
  if (!membership) return;
  try {
    const { rows } = await dbQuery(
      `SELECT om.id, om.role, om.created_at,
        u.id AS user_id, u.full_name, u.email, u.username, u.avatar_url
       FROM organization_memberships om
       JOIN users u ON u.id = om.user_id
       WHERE om.org_id = $1
       ORDER BY CASE om.role WHEN 'owner' THEN 0 WHEN 'admin' THEN 1 WHEN 'editor' THEN 2 ELSE 3 END, om.created_at ASC`,
      [orgId]
    );
    res.json({ success: true, members: rows });
  } catch (e) {
    res.status(500).json({ success: false, error: 'Failed to load members' });
  }
});

// PUT /api/organizations/:orgId/members/:targetUserId — update member role
app.put('/api/organizations/:orgId/members/:targetUserId', async (req: Request, res: Response) => {
  const { orgId, targetUserId } = req.params;
  const membership = await requireOrgMembership(req, res, orgId, 'admin');
  if (!membership) return;
  const { role } = req.body as { role: string };
  if (!['admin', 'editor', 'viewer'].includes(role)) {
    return res.status(400).json({ success: false, error: 'Invalid role. Allowed: admin, editor, viewer' });
  }
  if (targetUserId === membership.userId) {
    return res.status(400).json({ success: false, error: 'Cannot change your own role' });
  }
  try {
    const { rows: target } = await dbQuery(
      `SELECT role FROM organization_memberships WHERE org_id = $1 AND user_id = $2`,
      [orgId, targetUserId]
    );
    if (!target.length) return res.status(404).json({ success: false, error: 'Member not found' });
    if (target[0].role === 'owner') return res.status(403).json({ success: false, error: 'Cannot change the owner role' });
    await dbQuery(
      `UPDATE organization_memberships SET role = $1 WHERE org_id = $2 AND user_id = $3`,
      [role, orgId, targetUserId]
    );
    res.json({ success: true });
  } catch (e) {
    res.status(500).json({ success: false, error: 'Failed to update member role' });
  }
});

// DELETE /api/organizations/:orgId/members/:targetUserId — remove member
app.delete('/api/organizations/:orgId/members/:targetUserId', async (req: Request, res: Response) => {
  const { orgId, targetUserId } = req.params;
  const membership = await requireOrgMembership(req, res, orgId, 'admin');
  if (!membership) return;
  if (targetUserId === membership.userId) {
    return res.status(400).json({ success: false, error: 'Cannot remove yourself' });
  }
  try {
    const { rows: target } = await dbQuery(
      `SELECT role FROM organization_memberships WHERE org_id = $1 AND user_id = $2`,
      [orgId, targetUserId]
    );
    if (!target.length) return res.status(404).json({ success: false, error: 'Member not found' });
    if (target[0].role === 'owner') return res.status(403).json({ success: false, error: 'Cannot remove the owner' });
    await dbQuery(`DELETE FROM organization_memberships WHERE org_id = $1 AND user_id = $2`, [orgId, targetUserId]);
    res.json({ success: true });
  } catch (e) {
    res.status(500).json({ success: false, error: 'Failed to remove member' });
  }
});

// POST /api/organizations/:orgId/invite — invite a user by email
app.post('/api/organizations/:orgId/invite', async (req: Request, res: Response) => {
  const { orgId } = req.params;
  const membership = await requireOrgMembership(req, res, orgId, 'admin');
  if (!membership) return;
  const { email, role = 'editor' } = req.body as { email: string; role?: string };
  if (!email?.trim()) return res.status(400).json({ success: false, error: 'Email is required' });
  if (!['admin', 'editor', 'viewer'].includes(role)) {
    return res.status(400).json({ success: false, error: 'Invalid role' });
  }
  try {
    const { rows: existing } = await dbQuery(
      `SELECT u.id FROM users u JOIN organization_memberships om ON om.user_id = u.id
       WHERE LOWER(u.email) = LOWER($1) AND om.org_id = $2`,
      [email.trim(), orgId]
    );
    if (existing.length) return res.status(409).json({ success: false, error: 'User is already a member' });
    await dbQuery(
      `DELETE FROM organization_invitations WHERE org_id = $1 AND LOWER(email) = LOWER($2) AND accepted_at IS NULL`,
      [orgId, email.trim()]
    );
    const invId = randomUUID();
    const token = randomBytes(32).toString('hex');
    const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();
    await dbQuery(
      `INSERT INTO organization_invitations (id, org_id, email, role, token, invited_by_user_id, expires_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [invId, orgId, email.trim().toLowerCase(), role, token, membership.userId, expiresAt]
    );

    // Fetch org + inviter names for the notification
    const { rows: orgRows } = await dbQuery(
      `SELECT o.name AS org_name, u.full_name AS inviter_name
       FROM organizations o, users u
       WHERE o.id = $1 AND u.id = $2`,
      [orgId, membership.userId]
    );
    const orgName = orgRows[0]?.org_name ?? 'an organisation';
    const inviterName = orgRows[0]?.inviter_name ?? 'Someone';

    // If the invited email already has an account, send an in-app notification
    const { rows: invitedUser } = await dbQuery(
      `SELECT id FROM users WHERE LOWER(email) = LOWER($1) LIMIT 1`,
      [email.trim()]
    );
    if (invitedUser.length) {
      createNotification(
        invitedUser[0].id,
        'team_invite',
        `You've been invited to ${orgName}`,
        `${inviterName} invited you to join ${orgName} as ${role}.`,
        { token, orgId, role, expiresAt },
        true, // pinned — stays at top until accepted/declined/expired
      );
    }

    res.json({ success: true, inviteToken: token, inviteLink: `/invite/${token}` });
  } catch (e) {
    res.status(500).json({ success: false, error: 'Failed to send invitation' });
  }
});

// GET /api/organizations/:orgId/invitations — list pending invitations
app.get('/api/organizations/:orgId/invitations', async (req: Request, res: Response) => {
  const { orgId } = req.params;
  const membership = await requireOrgMembership(req, res, orgId, 'admin');
  if (!membership) return;
  try {
    const { rows } = await dbQuery(
      `SELECT oi.id, oi.email, oi.role, oi.expires_at, oi.created_at, oi.token,
        u.full_name AS invited_by_name
       FROM organization_invitations oi
       JOIN users u ON u.id = oi.invited_by_user_id
       WHERE oi.org_id = $1 AND oi.accepted_at IS NULL AND oi.expires_at > NOW()
       ORDER BY oi.created_at DESC`,
      [orgId]
    );
    res.json({ success: true, invitations: rows });
  } catch (e) {
    res.status(500).json({ success: false, error: 'Failed to load invitations' });
  }
});

// DELETE /api/organizations/:orgId/invitations/:invId — cancel invitation
app.delete('/api/organizations/:orgId/invitations/:invId', async (req: Request, res: Response) => {
  const { orgId, invId } = req.params;
  const membership = await requireOrgMembership(req, res, orgId, 'admin');
  if (!membership) return;
  try {
    await dbQuery(`DELETE FROM organization_invitations WHERE id = $1 AND org_id = $2`, [invId, orgId]);
    res.json({ success: true });
  } catch (e) {
    res.status(500).json({ success: false, error: 'Failed to cancel invitation' });
  }
});

// GET /api/invitations/:token — public: get invite details for accept page
app.get('/api/invitations/:token', async (req: Request, res: Response) => {
  const { token } = req.params;
  if (!hasDatabase()) return res.status(503).json({ success: false, error: 'Database unavailable' });
  try {
    const { rows } = await dbQuery(
      `SELECT oi.id, oi.email, oi.role, oi.expires_at, oi.accepted_at,
        o.name AS org_name, o.id AS org_id, u.full_name AS invited_by_name
       FROM organization_invitations oi
       JOIN organizations o ON o.id = oi.org_id
       JOIN users u ON u.id = oi.invited_by_user_id
       WHERE oi.token = $1`,
      [token]
    );
    if (!rows.length) return res.status(404).json({ success: false, error: 'Invitation not found' });
    const inv = rows[0];
    if (inv.accepted_at) return res.status(409).json({ success: false, error: 'Invitation already accepted' });
    if (new Date(inv.expires_at) < new Date()) return res.status(410).json({ success: false, error: 'Invitation expired' });
    res.json({ success: true, invitation: inv });
  } catch (e) {
    res.status(500).json({ success: false, error: 'Failed to load invitation' });
  }
});

// POST /api/invitations/:token/accept — accept invite (requires auth)
app.post('/api/invitations/:token/accept', async (req: Request, res: Response) => {
  const auth = requireAuth(req, res);
  if (!auth) return;
  if (!hasDatabase()) return res.status(503).json({ success: false, error: 'Database unavailable' });
  const { token } = req.params;
  try {
    const { rows } = await dbQuery(
      `SELECT oi.*, o.id AS org_id FROM organization_invitations oi JOIN organizations o ON o.id = oi.org_id WHERE oi.token = $1`,
      [token]
    );
    if (!rows.length) return res.status(404).json({ success: false, error: 'Invitation not found' });
    const inv = rows[0];
    if (inv.accepted_at) return res.status(409).json({ success: false, error: 'Invitation already accepted' });
    if (new Date(inv.expires_at) < new Date()) return res.status(410).json({ success: false, error: 'Invitation expired' });
    const { rows: userRows } = await dbQuery(`SELECT email FROM users WHERE id = $1`, [auth.userId]);
    if (!userRows.length) return res.status(401).json({ success: false, error: 'User not found' });
    if (userRows[0].email.toLowerCase() !== (inv.email as string).toLowerCase()) {
      return res.status(403).json({ success: false, error: `This invitation was sent to ${inv.email}` });
    }
    await dbQuery(
      `INSERT INTO organization_memberships (id, org_id, user_id, role) VALUES ($1, $2, $3, $4)
       ON CONFLICT (org_id, user_id) DO UPDATE SET role = EXCLUDED.role`,
      [randomUUID(), inv.org_id, auth.userId, inv.role]
    );
    await dbQuery(`UPDATE organization_invitations SET accepted_at = NOW() WHERE token = $1`, [token]);
    // Remove the pinned invite notification now that it's resolved
    await dbQuery(
      `DELETE FROM notifications WHERE user_id = $1 AND type = 'team_invite' AND data->>'token' = $2`,
      [auth.userId, token]
    );

    // Notify the inviter that the user accepted
    const { rows: joinedRows } = await dbQuery(
      `SELECT full_name, email FROM users WHERE id = $1`, [auth.userId]
    );
    const { rows: orgNameRows } = await dbQuery(
      `SELECT name FROM organizations WHERE id = $1`, [inv.org_id]
    );
    const joinedName = joinedRows[0]?.full_name || joinedRows[0]?.email || 'Someone';
    const orgName = orgNameRows[0]?.name ?? 'your organisation';
    createNotification(
      inv.invited_by_user_id,
      'member_joined',
      `${joinedName} joined ${orgName}`,
      `${joinedName} accepted your invitation and is now a ${inv.role} in ${orgName}.`,
      { userId: auth.userId, orgId: inv.org_id },
    );

    res.json({ success: true, orgId: inv.org_id });
  } catch (e) {
    res.status(500).json({ success: false, error: 'Failed to accept invitation' });
  }
});

// GET /api/organizations/:orgId/projects — list projects
app.get('/api/organizations/:orgId/projects', async (req: Request, res: Response) => {
  const { orgId } = req.params;
  const membership = await requireOrgMembership(req, res, orgId);
  if (!membership) return;
  try {
    const { rows } = await dbQuery(
      `SELECT p.*, u.full_name AS created_by_name
       FROM projects p LEFT JOIN users u ON u.id = p.created_by_user_id
       WHERE p.org_id = $1 ORDER BY p.created_at ASC`,
      [orgId]
    );
    res.json({ success: true, projects: rows });
  } catch (e) {
    res.status(500).json({ success: false, error: 'Failed to load projects' });
  }
});

// POST /api/organizations/:orgId/projects — create project
app.post('/api/organizations/:orgId/projects', async (req: Request, res: Response) => {
  const { orgId } = req.params;
  const membership = await requireOrgMembership(req, res, orgId, 'editor');
  if (!membership) return;
  const { name, description = '', color = '#5b6cf9' } = req.body as { name: string; description?: string; color?: string };
  if (!name?.trim()) return res.status(400).json({ success: false, error: 'Name is required' });
  try {
    const projId = randomUUID();
    await dbQuery(
      `INSERT INTO projects (id, org_id, name, description, color, created_by_user_id) VALUES ($1, $2, $3, $4, $5, $6)`,
      [projId, orgId, name.trim(), description.trim(), color, membership.userId]
    );
    const { rows } = await dbQuery(`SELECT * FROM projects WHERE id = $1`, [projId]);
    res.json({ success: true, project: rows[0] });
  } catch (e) {
    res.status(500).json({ success: false, error: 'Failed to create project' });
  }
});

// PUT /api/organizations/:orgId/projects/:projectId
app.put('/api/organizations/:orgId/projects/:projectId', async (req: Request, res: Response) => {
  const { orgId, projectId } = req.params;
  const membership = await requireOrgMembership(req, res, orgId, 'editor');
  if (!membership) return;
  const { name, description, color } = req.body as { name?: string; description?: string; color?: string };
  try {
    const updates: string[] = [];
    const vals: unknown[] = [];
    let i = 1;
    if (name !== undefined) { updates.push(`name = $${i++}`); vals.push(name.trim()); }
    if (description !== undefined) { updates.push(`description = $${i++}`); vals.push(description.trim()); }
    if (color !== undefined) { updates.push(`color = $${i++}`); vals.push(color); }
    if (updates.length === 0) return res.status(400).json({ success: false, error: 'Nothing to update' });
    updates.push(`updated_at = NOW()`);
    vals.push(projectId, orgId);
    await dbQuery(`UPDATE projects SET ${updates.join(', ')} WHERE id = $${i} AND org_id = $${i + 1}`, vals);
    const { rows } = await dbQuery(`SELECT * FROM projects WHERE id = $1`, [projectId]);
    res.json({ success: true, project: rows[0] });
  } catch (e) {
    res.status(500).json({ success: false, error: 'Failed to update project' });
  }
});

// DELETE /api/organizations/:orgId/projects/:projectId
app.delete('/api/organizations/:orgId/projects/:projectId', async (req: Request, res: Response) => {
  const { orgId, projectId } = req.params;
  const membership = await requireOrgMembership(req, res, orgId, 'admin');
  if (!membership) return;
  try {
    const { rows: cnt } = await dbQuery(`SELECT COUNT(*)::int AS n FROM projects WHERE org_id = $1`, [orgId]);
    if (cnt[0].n <= 1) {
      return res.status(409).json({ success: false, error: 'Cannot delete the last project in an organization' });
    }
    await dbQuery(`DELETE FROM projects WHERE id = $1 AND org_id = $2`, [projectId, orgId]);
    res.json({ success: true });
  } catch (e) {
    res.status(500).json({ success: false, error: 'Failed to delete project' });
  }
});

// ── End Workspace Routes ──────────────────────────────────────────────────────

// ─── Task Management Routes ───────────────────────────────────────────────────

async function requireProjectAccess(
  req: Request, res: Response, projectId: string
): Promise<{ userId: string; orgRole: string } | null> {
  const auth = requireAuth(req, res);
  if (!auth) return null;
  if (!hasDatabase()) { res.status(503).json({ error: 'Database unavailable' }); return null; }
  const { rows } = await dbQuery(
    `SELECT om.role FROM projects p
     JOIN organization_memberships om ON om.org_id = p.org_id AND om.user_id = $1
     WHERE p.id = $2`,
    [auth.userId, projectId]
  );
  if (!rows[0]) { res.status(403).json({ error: 'Not a project member' }); return null; }
  return { userId: auth.userId, orgRole: rows[0].role };
}

async function logTaskActivity(
  projectId: string, userId: string, action: string, taskId?: string, metadata?: Record<string, unknown>
) {
  try {
    await dbQuery(
      `INSERT INTO task_activity (project_id, user_id, action, task_id, metadata) VALUES ($1,$2,$3,$4,$5)`,
      [projectId, userId, action, taskId ?? null, metadata ? JSON.stringify(metadata) : null]
    );
  } catch { /* non-fatal */ }
}

async function checkTaskActions(userId: string, actionType: string) {
  if (!hasDatabase()) return;
  try {
    // Match tasks where user is either a direct assignee OR the supervisor
    const { rows } = await dbQuery(
      `SELECT DISTINCT ta.id, ta.current_count, ta.target_count, ta.task_id, t.project_id, t.status
       FROM task_actions ta
       JOIN tasks t ON t.id = ta.task_id
       WHERE ta.action_type = $2
         AND ta.current_count < ta.target_count
         AND t.status != 'done'
         AND (
           EXISTS (SELECT 1 FROM task_assignees tass WHERE tass.task_id = t.id AND tass.user_id = $1)
           OR t.supervisor_id = $1
         )`,
      [userId, actionType]
    );
    for (const row of rows) {
      const newCount = row.current_count + 1;
      await dbQuery(`UPDATE task_actions SET current_count = $1 WHERE id = $2`, [newCount, row.id]);
      const { rows: totals } = await dbQuery(
        `SELECT COALESCE(SUM(target_count),0) AS tgt, COALESCE(SUM(LEAST(current_count, target_count)),0) AS cur FROM task_actions WHERE task_id = $1`,
        [row.task_id]
      );
      if (Number(totals[0].cur) >= Number(totals[0].tgt)) {
        await dbQuery(`UPDATE tasks SET status = 'done', updated_at = NOW() WHERE id = $1`, [row.task_id]);
        void logTaskActivity(row.project_id, userId, 'status_changed', row.task_id, { from: row.status, to: 'done' });
      }
    }
  } catch (err) {
    console.error('[checkTaskActions] error:', err);
  }
}

// GET /api/projects/:projectId/tasks
app.get('/api/projects/:projectId/tasks', async (req: Request, res: Response) => {
  const { projectId } = req.params;
  const access = await requireProjectAccess(req, res, projectId);
  if (!access) return;
  const { status, assignee, q } = req.query as Record<string, string>;
  try {
    let sql = `
      SELECT t.*,
        COALESCE(json_agg(DISTINCT jsonb_build_object('user_id', u.id, 'name', COALESCE(u.full_name, u.username, u.email), 'avatar', u.avatar_url))
          FILTER (WHERE u.id IS NOT NULL), '[]') AS assignees,
        COALESCE(json_agg(DISTINCT jsonb_build_object('id', tl.id, 'name', tl.name, 'color', tl.color))
          FILTER (WHERE tl.id IS NOT NULL), '[]') AS labels,
        (SELECT COUNT(*)::int FROM subtasks s WHERE s.task_id = t.id) AS subtask_count,
        (SELECT COUNT(*)::int FROM subtasks s WHERE s.task_id = t.id AND s.completed) AS subtask_done,
        (SELECT COUNT(*)::int FROM task_comments c WHERE c.task_id = t.id AND c.parent_id IS NULL) AS comment_count,
        COALESCE(su.full_name, su.username, su.email) AS supervisor_name,
        COALESCE((SELECT json_agg(a ORDER BY a.created_at) FROM task_actions a WHERE a.task_id = t.id), '[]') AS actions
      FROM tasks t
      LEFT JOIN task_assignees ta ON ta.task_id = t.id
      LEFT JOIN users u ON u.id = ta.user_id
      LEFT JOIN task_label_assignments tla ON tla.task_id = t.id
      LEFT JOIN task_labels tl ON tl.id = tla.label_id
      LEFT JOIN users su ON su.id = t.supervisor_id
      WHERE t.project_id = $1`;
    const vals: unknown[] = [projectId];
    let i = 2;
    if (status) { sql += ` AND t.status = $${i++}`; vals.push(status); }
    if (assignee) { sql += ` AND ta.user_id = $${i++}`; vals.push(assignee); }
    if (q) { sql += ` AND t.title ILIKE $${i++}`; vals.push(`%${q}%`); }
    sql += ` GROUP BY t.id, su.full_name, su.username, su.email ORDER BY t.status, t.position, t.created_at`;
    const { rows } = await dbQuery(sql, vals);
    return res.json({ tasks: rows });
  } catch (e) {
    return res.status(500).json({ error: 'Failed to load tasks' });
  }
});

// POST /api/projects/:projectId/tasks
app.post('/api/projects/:projectId/tasks', async (req: Request, res: Response) => {
  const { projectId } = req.params;
  const access = await requireProjectAccess(req, res, projectId);
  if (!access) return;
  const { title, description = '', status = 'todo', priority = 'medium', due_date, supervisor_id, assignee_ids = [], label_ids = [], actions = [] } =
    req.body as { title: string; description?: string; status?: string; priority?: string; due_date?: string; supervisor_id?: string; assignee_ids?: string[]; label_ids?: string[]; actions?: { action_type: string; label: string; target_count: number }[] };
  if (!title?.trim()) return res.status(400).json({ error: 'Title required' });
  try {
    const { rows: pos } = await dbQuery(
      `SELECT COALESCE(MAX(position),0)+1 AS next FROM tasks WHERE project_id=$1 AND status=$2`,
      [projectId, status]
    );
    const { rows } = await dbQuery(
      `INSERT INTO tasks (project_id, title, description, status, priority, position, due_date, supervisor_id, created_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING *`,
      [projectId, title.trim(), description, status, priority, pos[0].next, due_date || null, supervisor_id || null, access.userId]
    );
    const task = rows[0];
    await Promise.all([
      ...assignee_ids.map((uid) =>
        dbQuery(`INSERT INTO task_assignees (task_id, user_id) VALUES ($1,$2) ON CONFLICT DO NOTHING`, [task.id, uid])
      ),
      ...label_ids.map((lid) =>
        dbQuery(`INSERT INTO task_label_assignments (task_id, label_id) VALUES ($1,$2) ON CONFLICT DO NOTHING`, [task.id, lid])
      ),
    ]);
    let savedActions: Record<string, unknown>[] = [];
    if (actions.length) {
      const actRows = await Promise.all(actions.map((a) =>
        dbQuery(
          `INSERT INTO task_actions (id, task_id, action_type, label, target_count, current_count) VALUES ($1,$2,$3,$4,$5,0) RETURNING *`,
          [randomUUID(), task.id, a.action_type, a.label, Math.max(1, a.target_count || 1)]
        ).then((r) => r.rows[0])
      ));
      savedActions = actRows;
    }
    await logTaskActivity(projectId, access.userId, 'task_created', task.id, { title: task.title });
    return res.json({ task: { ...task, assignees: [], labels: [], subtask_count: 0, subtask_done: 0, comment_count: 0, actions: savedActions } });
  } catch (e) {
    return res.status(500).json({ error: 'Failed to create task' });
  }
});

// GET /api/projects/:projectId/tasks/:taskId
app.get('/api/projects/:projectId/tasks/:taskId', async (req: Request, res: Response) => {
  const { projectId, taskId } = req.params;
  const access = await requireProjectAccess(req, res, projectId);
  if (!access) return;
  try {
    const { rows } = await dbQuery(
      `SELECT t.*,
        COALESCE(json_agg(DISTINCT jsonb_build_object('user_id', u.id, 'name', COALESCE(u.full_name, u.username, u.email), 'avatar', u.avatar_url))
          FILTER (WHERE u.id IS NOT NULL), '[]') AS assignees,
        COALESCE(json_agg(DISTINCT jsonb_build_object('id', tl.id, 'name', tl.name, 'color', tl.color))
          FILTER (WHERE tl.id IS NOT NULL), '[]') AS labels,
        COALESCE(su.full_name, su.username, su.email) AS supervisor_name, su.avatar_url AS supervisor_avatar
       FROM tasks t
       LEFT JOIN task_assignees ta ON ta.task_id = t.id
       LEFT JOIN users u ON u.id = ta.user_id
       LEFT JOIN task_label_assignments tla ON tla.task_id = t.id
       LEFT JOIN task_labels tl ON tl.id = tla.label_id
       LEFT JOIN users su ON su.id = t.supervisor_id
       WHERE t.id = $1 AND t.project_id = $2
       GROUP BY t.id, su.full_name, su.username, su.email, su.avatar_url`,
      [taskId, projectId]
    );
    if (!rows[0]) return res.status(404).json({ error: 'Task not found' });
    const [subtasks, attachments, actionsRes] = await Promise.all([
      dbQuery(`SELECT * FROM subtasks WHERE task_id=$1 ORDER BY position, created_at`, [taskId]),
      dbQuery(`SELECT a.*, COALESCE(u.full_name, u.username) AS uploader_name FROM task_attachments a LEFT JOIN users u ON u.id=a.uploaded_by WHERE a.task_id=$1 ORDER BY a.created_at DESC`, [taskId]),
      dbQuery(`SELECT * FROM task_actions WHERE task_id=$1 ORDER BY created_at`, [taskId]),
    ]);
    return res.json({ task: { ...rows[0], subtasks: subtasks.rows, attachments: attachments.rows, actions: actionsRes.rows } });
  } catch (e) {
    return res.status(500).json({ error: 'Failed to load task' });
  }
});

// PUT /api/projects/:projectId/tasks/:taskId
app.put('/api/projects/:projectId/tasks/:taskId', async (req: Request, res: Response) => {
  const { projectId, taskId } = req.params;
  const access = await requireProjectAccess(req, res, projectId);
  if (!access) return;
  const { title, description, priority, due_date, supervisor_id } =
    req.body as { title?: string; description?: string; priority?: string; due_date?: string | null; supervisor_id?: string | null };
  try {
    const sets: string[] = ['updated_at=NOW()'];
    const vals: unknown[] = [];
    let i = 1;
    if (title !== undefined) { sets.push(`title=$${i++}`); vals.push(title.trim()); }
    if (description !== undefined) { sets.push(`description=$${i++}`); vals.push(description); }
    if (priority !== undefined) { sets.push(`priority=$${i++}`); vals.push(priority); }
    if (due_date !== undefined) { sets.push(`due_date=$${i++}`); vals.push(due_date || null); }
    if (supervisor_id !== undefined) { sets.push(`supervisor_id=$${i++}`); vals.push(supervisor_id || null); }
    vals.push(taskId); vals.push(projectId);
    const { rows } = await dbQuery(
      `UPDATE tasks SET ${sets.join(',')} WHERE id=$${i++} AND project_id=$${i} RETURNING *`, vals
    );
    return res.json({ task: rows[0] });
  } catch (e) {
    return res.status(500).json({ error: 'Failed to update task' });
  }
});

// PATCH /api/projects/:projectId/tasks/:taskId/status
app.patch('/api/projects/:projectId/tasks/:taskId/status', async (req: Request, res: Response) => {
  const { projectId, taskId } = req.params;
  const access = await requireProjectAccess(req, res, projectId);
  if (!access) return;
  const { status } = req.body as { status: string };
  const validStatuses = ['todo', 'in_progress', 'in_review', 'done'];
  if (!validStatuses.includes(status)) return res.status(400).json({ error: 'Invalid status' });
  try {
    const { rows: task } = await dbQuery(`SELECT status, supervisor_id FROM tasks WHERE id=$1`, [taskId]);
    if (!task[0]) return res.status(404).json({ error: 'Task not found' });
    const isAdmin = ['owner', 'admin'].includes(access.orgRole);
    const isSupervisor = task[0].supervisor_id === access.userId;
    if (!isAdmin && !isSupervisor) return res.status(403).json({ error: 'Only admins and supervisors can change task status' });
    const { rows: pos } = await dbQuery(
      `SELECT COALESCE(MAX(position),0)+1 AS next FROM tasks WHERE project_id=$1 AND status=$2`,
      [projectId, status]
    );
    await dbQuery(
      `UPDATE tasks SET status=$1, position=$2, updated_at=NOW() WHERE id=$3`,
      [status, pos[0].next, taskId]
    );
    await logTaskActivity(projectId, access.userId, 'status_changed', taskId, { from: task[0].status, to: status });
    return res.json({ success: true });
  } catch (e) {
    return res.status(500).json({ error: 'Failed to update status' });
  }
});

// PATCH /api/projects/:projectId/tasks/reorder
app.patch('/api/projects/:projectId/tasks/reorder', async (req: Request, res: Response) => {
  const { projectId } = req.params;
  const access = await requireProjectAccess(req, res, projectId);
  if (!access) return;
  const isAdmin = ['owner', 'admin'].includes(access.orgRole);
  if (!isAdmin) return res.status(403).json({ error: 'Only admins can reorder tasks' });
  const { updates } = req.body as { updates: { id: string; status: string; position: number }[] };
  try {
    await Promise.all(updates.map(({ id, status, position }) =>
      dbQuery(`UPDATE tasks SET status=$1, position=$2, updated_at=NOW() WHERE id=$3 AND project_id=$4`, [status, position, id, projectId])
    ));
    return res.json({ success: true });
  } catch {
    return res.status(500).json({ error: 'Failed to reorder tasks' });
  }
});

// DELETE /api/projects/:projectId/tasks/:taskId
app.delete('/api/projects/:projectId/tasks/:taskId', async (req: Request, res: Response) => {
  const { projectId, taskId } = req.params;
  const access = await requireProjectAccess(req, res, projectId);
  if (!access) return;
  const isAdmin = ['owner', 'admin'].includes(access.orgRole);
  if (!isAdmin) return res.status(403).json({ error: 'Only admins can delete tasks' });
  await dbQuery(`DELETE FROM tasks WHERE id=$1 AND project_id=$2`, [taskId, projectId]);
  return res.json({ success: true });
});

// GET /api/projects/:projectId/task-stats
app.get('/api/projects/:projectId/task-stats', async (req: Request, res: Response) => {
  const { projectId } = req.params;
  const access = await requireProjectAccess(req, res, projectId);
  if (!access) return;
  try {
    const [statusCounts, overdue, memberLoad, recent] = await Promise.all([
      dbQuery(`SELECT status, COUNT(*)::int AS count FROM tasks WHERE project_id=$1 GROUP BY status`, [projectId]),
      dbQuery(`SELECT COUNT(*)::int AS count FROM tasks WHERE project_id=$1 AND due_date < CURRENT_DATE AND status != 'done'`, [projectId]),
      dbQuery(
        `SELECT COALESCE(u.full_name, u.username, u.email) AS name, u.avatar_url AS avatar, COUNT(*)::int AS task_count
         FROM task_assignees ta JOIN tasks t ON t.id=ta.task_id JOIN users u ON u.id=ta.user_id
         WHERE t.project_id=$1 AND t.status != 'done' GROUP BY u.id, u.full_name, u.username, u.email, u.avatar_url
         ORDER BY task_count DESC LIMIT 8`, [projectId]
      ),
      dbQuery(
        `SELECT a.action, a.created_at, a.metadata, COALESCE(u.full_name, u.username, u.email) AS user_name, t.title AS task_title
         FROM task_activity a LEFT JOIN users u ON u.id=a.user_id LEFT JOIN tasks t ON t.id=a.task_id
         WHERE a.project_id=$1 ORDER BY a.created_at DESC LIMIT 10`, [projectId]
      ),
    ]);
    const byStatus = Object.fromEntries(statusCounts.rows.map((r) => [r.status, r.count]));
    const total = statusCounts.rows.reduce((s, r) => s + r.count, 0);
    return res.json({ byStatus, total, overdue: overdue.rows[0]?.count ?? 0, memberLoad: memberLoad.rows, recentActivity: recent.rows });
  } catch {
    return res.status(500).json({ error: 'Failed to load stats' });
  }
});

// GET /api/projects/:projectId/labels
app.get('/api/projects/:projectId/labels', async (req: Request, res: Response) => {
  const { projectId } = req.params;
  const access = await requireProjectAccess(req, res, projectId);
  if (!access) return;
  const { rows } = await dbQuery(`SELECT * FROM task_labels WHERE project_id=$1 ORDER BY name`, [projectId]);
  return res.json({ labels: rows });
});

// POST /api/projects/:projectId/labels
app.post('/api/projects/:projectId/labels', async (req: Request, res: Response) => {
  const { projectId } = req.params;
  const access = await requireProjectAccess(req, res, projectId);
  if (!access) return;
  const { name, color = '#6366f1' } = req.body as { name: string; color?: string };
  if (!name?.trim()) return res.status(400).json({ error: 'Name required' });
  const { rows } = await dbQuery(
    `INSERT INTO task_labels (project_id, name, color) VALUES ($1,$2,$3) RETURNING *`,
    [projectId, name.trim(), color]
  );
  return res.json({ label: rows[0] });
});

// DELETE /api/projects/:projectId/labels/:labelId
app.delete('/api/projects/:projectId/labels/:labelId', async (req: Request, res: Response) => {
  const { projectId, labelId } = req.params;
  const access = await requireProjectAccess(req, res, projectId);
  if (!access) return;
  await dbQuery(`DELETE FROM task_labels WHERE id=$1 AND project_id=$2`, [labelId, projectId]);
  return res.json({ success: true });
});

// POST /api/tasks/:taskId/labels/:labelId
app.post('/api/tasks/:taskId/labels/:labelId', async (req: Request, res: Response) => {
  const auth = requireAuth(req, res);
  if (!auth) return;
  const { taskId, labelId } = req.params;
  await dbQuery(`INSERT INTO task_label_assignments (task_id, label_id) VALUES ($1,$2) ON CONFLICT DO NOTHING`, [taskId, labelId]);
  return res.json({ success: true });
});

// DELETE /api/tasks/:taskId/labels/:labelId
app.delete('/api/tasks/:taskId/labels/:labelId', async (req: Request, res: Response) => {
  const auth = requireAuth(req, res);
  if (!auth) return;
  const { taskId, labelId } = req.params;
  await dbQuery(`DELETE FROM task_label_assignments WHERE task_id=$1 AND label_id=$2`, [taskId, labelId]);
  return res.json({ success: true });
});

// POST /api/tasks/:taskId/assignees
app.post('/api/tasks/:taskId/assignees', async (req: Request, res: Response) => {
  const auth = requireAuth(req, res);
  if (!auth) return;
  const { taskId } = req.params;
  const { user_id } = req.body as { user_id: string };
  await dbQuery(`INSERT INTO task_assignees (task_id, user_id) VALUES ($1,$2) ON CONFLICT DO NOTHING`, [taskId, user_id]);
  return res.json({ success: true });
});

// DELETE /api/tasks/:taskId/assignees/:userId
app.delete('/api/tasks/:taskId/assignees/:userId', async (req: Request, res: Response) => {
  const auth = requireAuth(req, res);
  if (!auth) return;
  const { taskId, userId } = req.params;
  await dbQuery(`DELETE FROM task_assignees WHERE task_id=$1 AND user_id=$2`, [taskId, userId]);
  return res.json({ success: true });
});

// POST /api/tasks/:taskId/subtasks
app.post('/api/tasks/:taskId/subtasks', async (req: Request, res: Response) => {
  const auth = requireAuth(req, res);
  if (!auth) return;
  const { taskId } = req.params;
  const { title } = req.body as { title: string };
  if (!title?.trim()) return res.status(400).json({ error: 'Title required' });
  const { rows: pos } = await dbQuery(`SELECT COALESCE(MAX(position),0)+1 AS next FROM subtasks WHERE task_id=$1`, [taskId]);
  const { rows } = await dbQuery(
    `INSERT INTO subtasks (task_id, title, position, created_by) VALUES ($1,$2,$3,$4) RETURNING *`,
    [taskId, title.trim(), pos[0].next, auth.userId]
  );
  return res.json({ subtask: rows[0] });
});

// PATCH /api/tasks/:taskId/subtasks/:subtaskId
app.patch('/api/tasks/:taskId/subtasks/:subtaskId', async (req: Request, res: Response) => {
  const auth = requireAuth(req, res);
  if (!auth) return;
  const { taskId, subtaskId } = req.params;
  const { title, completed } = req.body as { title?: string; completed?: boolean };
  const sets: string[] = [];
  const vals: unknown[] = [];
  let i = 1;
  if (title !== undefined) { sets.push(`title=$${i++}`); vals.push(title.trim()); }
  if (completed !== undefined) { sets.push(`completed=$${i++}`); vals.push(completed); }
  if (!sets.length) return res.status(400).json({ error: 'Nothing to update' });
  vals.push(subtaskId); vals.push(taskId);
  const { rows } = await dbQuery(`UPDATE subtasks SET ${sets.join(',')} WHERE id=$${i++} AND task_id=$${i} RETURNING *`, vals);
  return res.json({ subtask: rows[0] });
});

// DELETE /api/tasks/:taskId/subtasks/:subtaskId
app.delete('/api/tasks/:taskId/subtasks/:subtaskId', async (req: Request, res: Response) => {
  const auth = requireAuth(req, res);
  if (!auth) return;
  await dbQuery(`DELETE FROM subtasks WHERE id=$1 AND task_id=$2`, [req.params.subtaskId, req.params.taskId]);
  return res.json({ success: true });
});

// POST /api/tasks/:taskId/attachments
app.post('/api/tasks/:taskId/attachments', async (req: Request, res: Response) => {
  const auth = requireAuth(req, res);
  if (!auth) return;
  const { taskId } = req.params;
  const { name, url, size, mime_type } = req.body as { name: string; url: string; size?: number; mime_type?: string };
  if (!name || !url) return res.status(400).json({ error: 'name and url required' });
  const { rows } = await dbQuery(
    `INSERT INTO task_attachments (task_id, name, url, size, mime_type, uploaded_by) VALUES ($1,$2,$3,$4,$5,$6) RETURNING *`,
    [taskId, name, url, size ?? null, mime_type ?? null, auth.userId]
  );
  return res.json({ attachment: rows[0] });
});

// DELETE /api/tasks/:taskId/attachments/:attachmentId
app.delete('/api/tasks/:taskId/attachments/:attachmentId', async (req: Request, res: Response) => {
  const auth = requireAuth(req, res);
  if (!auth) return;
  await dbQuery(`DELETE FROM task_attachments WHERE id=$1 AND task_id=$2`, [req.params.attachmentId, req.params.taskId]);
  return res.json({ success: true });
});

// GET /api/tasks/:taskId/comments
app.get('/api/tasks/:taskId/comments', async (req: Request, res: Response) => {
  const auth = requireAuth(req, res);
  if (!auth) return;
  const { taskId } = req.params;
  try {
    const { rows: comments } = await dbQuery(
      `SELECT c.*, COALESCE(u.full_name, u.username, u.email) AS author_name, u.avatar_url AS author_avatar,
        COALESCE(
          (SELECT json_agg(json_build_object('emoji', r.emoji, 'count', r.cnt, 'reacted', r.reacted))
           FROM (
             SELECT r2.emoji, COUNT(*)::int AS cnt, MAX(CASE WHEN r2.user_id=$1 THEN 1 ELSE 0 END)::boolean AS reacted
             FROM task_comment_reactions r2 WHERE r2.comment_id=c.id GROUP BY r2.emoji
           ) r
          ), '[]'
        ) AS reactions
       FROM task_comments c JOIN users u ON u.id=c.user_id
       WHERE c.task_id=$2 AND c.parent_id IS NULL
       ORDER BY c.created_at`,
      [auth.userId, taskId]
    );
    const { rows: replies } = await dbQuery(
      `SELECT c.*, COALESCE(u.full_name, u.username, u.email) AS author_name, u.avatar_url AS author_avatar
       FROM task_comments c JOIN users u ON u.id=c.user_id
       WHERE c.task_id=$1 AND c.parent_id IS NOT NULL ORDER BY c.created_at`,
      [taskId]
    );
    const replyMap: Record<string, typeof replies> = {};
    for (const r of replies) {
      if (!replyMap[r.parent_id]) replyMap[r.parent_id] = [];
      replyMap[r.parent_id].push(r);
    }
    return res.json({ comments: comments.map((c) => ({ ...c, replies: replyMap[c.id] ?? [] })) });
  } catch {
    return res.status(500).json({ error: 'Failed to load comments' });
  }
});

// POST /api/tasks/:taskId/comments
app.post('/api/tasks/:taskId/comments', async (req: Request, res: Response) => {
  const auth = requireAuth(req, res);
  if (!auth) return;
  const { taskId } = req.params;
  const { content, parent_id } = req.body as { content: string; parent_id?: string };
  if (!content?.trim()) return res.status(400).json({ error: 'Content required' });
  const { rows } = await dbQuery(
    `INSERT INTO task_comments (task_id, user_id, content, parent_id) VALUES ($1,$2,$3,$4)
     RETURNING *, (SELECT COALESCE(full_name, username, email) FROM users WHERE id=$2) AS author_name,
                  (SELECT avatar_url FROM users WHERE id=$2) AS author_avatar`,
    [taskId, auth.userId, content.trim(), parent_id || null]
  );
  const { rows: task } = await dbQuery(`SELECT project_id FROM tasks WHERE id=$1`, [taskId]);
  if (task?.[0]) await logTaskActivity(task[0].project_id, auth.userId, 'comment_added', taskId, {});
  return res.json({ comment: { ...rows[0], reactions: [], replies: [] } });
});

// PUT /api/tasks/:taskId/comments/:commentId
app.put('/api/tasks/:taskId/comments/:commentId', async (req: Request, res: Response) => {
  const auth = requireAuth(req, res);
  if (!auth) return;
  const { content } = req.body as { content: string };
  if (!content?.trim()) return res.status(400).json({ error: 'Content required' });
  const { rows } = await dbQuery(
    `UPDATE task_comments SET content=$1, updated_at=NOW() WHERE id=$2 AND user_id=$3 RETURNING *`,
    [content.trim(), req.params.commentId, auth.userId]
  );
  if (!rows[0]) return res.status(403).json({ error: 'Not your comment' });
  return res.json({ comment: rows[0] });
});

// DELETE /api/tasks/:taskId/comments/:commentId
app.delete('/api/tasks/:taskId/comments/:commentId', async (req: Request, res: Response) => {
  const auth = requireAuth(req, res);
  if (!auth) return;
  await dbQuery(`DELETE FROM task_comments WHERE id=$1 AND user_id=$2`, [req.params.commentId, auth.userId]);
  return res.json({ success: true });
});

// POST /api/tasks/:taskId/comments/:commentId/reactions
app.post('/api/tasks/:taskId/comments/:commentId/reactions', async (req: Request, res: Response) => {
  const auth = requireAuth(req, res);
  if (!auth) return;
  const { emoji } = req.body as { emoji: string };
  if (!emoji) return res.status(400).json({ error: 'Emoji required' });
  const existing = await dbQuery(
    `SELECT 1 FROM task_comment_reactions WHERE comment_id=$1 AND user_id=$2 AND emoji=$3`,
    [req.params.commentId, auth.userId, emoji]
  );
  if (existing.rows.length) {
    await dbQuery(`DELETE FROM task_comment_reactions WHERE comment_id=$1 AND user_id=$2 AND emoji=$3`, [req.params.commentId, auth.userId, emoji]);
  } else {
    await dbQuery(`INSERT INTO task_comment_reactions (comment_id, user_id, emoji) VALUES ($1,$2,$3) ON CONFLICT DO NOTHING`, [req.params.commentId, auth.userId, emoji]);
  }
  return res.json({ success: true, toggled: !existing.rows.length });
});

// GET /api/projects/:projectId/activity
app.get('/api/projects/:projectId/activity', async (req: Request, res: Response) => {
  const { projectId } = req.params;
  const access = await requireProjectAccess(req, res, projectId);
  if (!access) return;
  const { rows } = await dbQuery(
    `SELECT a.*, COALESCE(u.full_name, u.username, u.email) AS user_name, u.avatar_url,
       t.title AS task_title
     FROM task_activity a
     LEFT JOIN users u ON u.id=a.user_id
     LEFT JOIN tasks t ON t.id=a.task_id
     WHERE a.project_id=$1 ORDER BY a.created_at DESC LIMIT 50`,
    [projectId]
  );
  return res.json({ activity: rows });
});

// GET /api/projects/:projectId/files
app.get('/api/projects/:projectId/files', async (req: Request, res: Response) => {
  const { projectId } = req.params;
  const access = await requireProjectAccess(req, res, projectId);
  if (!access) return;
  const { rows } = await dbQuery(
    `SELECT a.*, t.title AS task_title, t.id AS task_id, COALESCE(u.full_name, u.username, u.email) AS uploader_name
     FROM task_attachments a
     JOIN tasks t ON t.id=a.task_id
     LEFT JOIN users u ON u.id=a.uploaded_by
     WHERE t.project_id=$1 ORDER BY a.created_at DESC`,
    [projectId]
  );
  return res.json({ files: rows });
});

// GET /api/projects/:projectId/members  — project members (org members)
app.get('/api/projects/:projectId/members', async (req: Request, res: Response) => {
  const { projectId } = req.params;
  const access = await requireProjectAccess(req, res, projectId);
  if (!access) return;
  const { rows } = await dbQuery(
    `SELECT u.id, COALESCE(u.full_name, u.username, u.email) AS name, u.email, u.avatar_url, om.role,
       (SELECT COUNT(*)::int FROM task_assignees ta JOIN tasks t ON t.id=ta.task_id
        WHERE ta.user_id=u.id AND t.project_id=$1) AS task_count
     FROM projects p
     JOIN organization_memberships om ON om.org_id=p.org_id
     JOIN users u ON u.id=om.user_id
     WHERE p.id=$1 ORDER BY om.role, u.full_name`,
    [projectId]
  );
  return res.json({ members: rows });
});

// ── End Task Management Routes ─────────────────────────────────────────────────

// Not found
app.use((req, res) => {
  res.status(404).json({ success: false, error: 'Not found' });
});

// Centralized error handling (must be last)
app.use(errorHandler);

// Start server
if (config.nodeEnv !== 'test') {
  app.listen(PORT, () => {
    logger.info({ port: PORT }, 'api_listening');
  });
}

export default app;
