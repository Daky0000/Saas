import express from 'express';
import type { Request, Response } from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import axios from 'axios';
import jwt from 'jsonwebtoken';
import bcrypt from 'bcryptjs';
import { Pool } from 'pg';
import { Queue, Worker } from 'bullmq';
import IORedis from 'ioredis';
import {
  randomUUID,
  randomBytes,
  createCipheriv,
  createDecipheriv,
  scryptSync,
  createHmac,
  timingSafeEqual,
} from 'crypto';
import { FacebookPagesPlatform } from './backend/platforms/facebook_pages.ts';
// import { InstagramBusinessPlatform } from './backend/platforms/instagram_business.js';
import { LinkedInPlatform } from './backend/platforms/linkedin.ts';
import { TwitterXPlatform } from './backend/platforms/twitter_x.ts';
import { TikTokAdapter } from './backend/src/services/platform-adapters/tiktok.adapter.ts';
import type { PostObject } from './backend/platforms/types.ts';
// import { SAMPLE_TEMPLATES } from './src/data/sampleFabricTemplates.ts';
import path from 'path';
import { fileURLToPath } from 'url';
import { dirname } from 'path';
import { registerBlogAnalyticsRoutes } from './src/server/blogAnalyticsRoutes.ts';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

dotenv.config();

const WORDPRESS_ENCRYPTION_KEY = (() => {
  const raw = process.env.WORDPRESS_ENCRYPTION_KEY || process.env.JWT_SECRET || 'default-wp-key';
  return scryptSync(raw, 'salt', 32);
})();

const INTEGRATIONS_ENCRYPTION_KEY = (() => {
  const raw = process.env.INTEGRATIONS_ENCRYPTION_KEY || process.env.JWT_SECRET || 'default-integrations-key';
  return scryptSync(raw, 'salt', 32);
})();

const app = express();
const PORT = process.env.PORT || process.env.BACKEND_PORT || 5000;

// Health check — registered first so Railway can reach it immediately on startup
app.get('/health', (_req: Request, res: Response) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});
app.get('/api/health', (_req: Request, res: Response) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// Serve static assets — no caching on any file so deploys take effect immediately
app.use(express.static(path.join(__dirname, 'docs'), {
  setHeaders(res) {
    res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
    res.setHeader('Pragma', 'no-cache');
    res.setHeader('Expires', '0');
  },
}));
const JWT_SECRET = process.env.JWT_SECRET || 'your-secret-key';
const DATABASE_URL = process.env.DATABASE_URL;
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
// const instagramBusinessPlatform = new InstagramBusinessPlatform();
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
  // Treat the database as "available" if a Pool is configured.
  // Schema initialization can fail in restricted DB roles (no CREATE/ALTER),
  // but reads/writes to existing tables may still succeed.
  return Boolean(pool);
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

  // Social Automation v2 schema (platform registry + richer account metadata)
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
      unsubscribed_at TIMESTAMPTZ,
      created_at TIMESTAMPTZ DEFAULT NOW(),
      updated_at TIMESTAMPTZ DEFAULT NOW(),
      UNIQUE(user_id, email)
    );
  `).catch(() => undefined);
  await pool.query(`CREATE INDEX IF NOT EXISTS mailing_contacts_user_idx ON mailing_contacts (user_id);`).catch(() => undefined);
  await pool.query(`CREATE INDEX IF NOT EXISTS mailing_contacts_email_idx ON mailing_contacts (email);`).catch(() => undefined);

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
      created_at TIMESTAMPTZ DEFAULT NOW(),
      updated_at TIMESTAMPTZ DEFAULT NOW()
    );
  `).catch(() => undefined);
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
  .then(() => startSocialAutomationProcessor())
  .then(() => startTokenHealthMonitor())
  .catch((err) => {
    dbReady = false;
    if (!pool) seedInMemoryUsers();
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

// Auth routes
app.post('/api/auth/register', async (req: Request, res: Response) => {
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
    const token = signToken(user.id, user.email);

    return res.json({
      success: true,
      token,
      user: userToAuthPayload(user),
    });
  } catch (error) {
    console.error('Register error:', error);
    return res.status(500).json({ success: false, error: 'Registration failed' });
  }
});

app.post('/api/auth/login', async (req: Request, res: Response) => {
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
    console.error('Login error:', error);
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

app.put('/api/auth/profile', async (req: Request, res: Response) => {
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
    console.error('Profile update error:', error);
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
    if (!pool) return res.status(503).json({ success: false, error: 'Database not configured' });

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
      return res.status(400).json({ success: false, error: 'Facebook access token missing or expired — please connect Facebook first' });
    }

    const graphBase = 'https://graph.facebook.com/v19.0';
    const resp = await axios.get(
      `${graphBase}/me/accounts?fields=id,name,instagram_business_account{id,username}&limit=200&access_token=${encodeURIComponent(accessToken)}`,
      { validateStatus: () => true, timeout: 15000 }
    );
    const data: any = resp.data || {};
    if (resp.status >= 400) {
      const msg = data?.error?.message || `Meta API error ${resp.status}`;
      return res.status(400).json({ success: false, error: msg });
    }

    const pages = Array.isArray(data?.data) ? data.data : [];
    const targets = pages
      .map((p: any) => {
        const ig = p?.instagram_business_account || null;
        const igId = ig?.id ? String(ig.id).trim() : '';
        return {
          pageId: String(p?.id || '').trim(),
          pageName: String(p?.name || '').trim(),
          instagramId: igId || null,
          instagramUsername: ig?.username ? String(ig.username).trim() : null,
        };
      })
      .filter((t: any) => t.pageId);

    return res.json({ success: true, targets });
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

    // Prefer stored Page token if present
    let pageToken = '';
    const stored = await pool.query(
      `SELECT access_token, access_token_encrypted
       FROM social_accounts
       WHERE user_id=$1 AND platform='facebook' AND account_type='page' AND account_id=$2 AND connected=true
       LIMIT 1`,
      [auth.userId, pid]
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
    pageToken = String(decrypted || storedRow?.access_token || '').trim();

    if (!pageToken) {
      // Fallback: fetch /me/accounts to retrieve the Page access_token
      const fbConn = await getPublishableSocialConnection(auth.userId, 'facebook');
      const accessToken = String(fbConn?.access_token || '').trim();
      if (!accessToken) return res.status(400).json({ success: false, error: 'Facebook access token missing or expired — please reconnect' });

      const graphBase = 'https://graph.facebook.com/v19.0';
      const pagesResp = await axios.get(
        `${graphBase}/me/accounts?fields=id,access_token&limit=200&access_token=${encodeURIComponent(accessToken)}`,
        { validateStatus: () => true, timeout: 15000 }
      );
      const pagesData: any = pagesResp.data || {};
      if (pagesResp.status >= 400) {
        const msg = pagesData?.error?.message || `Meta API error ${pagesResp.status}`;
        return res.status(400).json({ success: false, error: msg });
      }
      const pages: any[] = Array.isArray(pagesData?.data) ? pagesData.data : [];
      const match = pages.find((p: any) => String(p?.id || '').trim() === pid);
      pageToken = String(match?.access_token || '').trim();
    }

    if (!pageToken) return res.status(400).json({ success: false, error: 'Facebook Page access token not available. Save a Page under Facebook first.' });

    const pageTokenEncrypted = encryptIntegrationSecret(pageToken);

    await pool.query(
      `INSERT INTO social_accounts
        (id, user_id, platform, account_type, account_id, account_name, connected, connected_at, access_token, access_token_encrypted, token_data, created_at)
       VALUES ($1,$2,'instagram','profile',$3,$4,true,NOW(),$5,$6,$7::jsonb,NOW())
       ON CONFLICT (user_id, platform) WHERE account_type = 'profile' DO UPDATE
         SET account_id=EXCLUDED.account_id,
             account_name=EXCLUDED.account_name,
             connected=true,
             connected_at=NOW(),
             access_token=EXCLUDED.access_token,
             access_token_encrypted=EXCLUDED.access_token_encrypted,
             token_data=EXCLUDED.token_data`,
      [
        randomUUID(),
        auth.userId,
        igId,
        String(instagramUsername || '').trim() || null,
        null,
        pageTokenEncrypted,
        JSON.stringify({ pageId: pid }),
      ]
    );

    await upsertUserIntegration({
      userId: auth.userId,
      integrationSlug: 'instagram',
      accessTokenEncrypted: pageTokenEncrypted,
      refreshTokenEncrypted: null,
      tokenExpiry: null,
      accountId: igId,
      accountName: String(instagramUsername || '').trim() || null,
      status: 'connected',
    });

    await logIntegrationEvent({
      userId: auth.userId,
      integrationSlug: 'instagram',
      eventType: 'connection_attempt',
      status: 'success',
      response: { pageId: pid, instagramId: igId },
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
  if (!pool) return null;
  const result = await dbQuery<{ user_id: string; platform: string; return_to: string | null; code_verifier: string | null }>(
    'SELECT user_id, platform, return_to, code_verifier FROM oauth_states WHERE state = $1 AND expires_at > NOW()',
    [state]
  );
  return result.rows[0] ?? null;
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
      return exchangePinterestCode(code);
    case 'threads':
      return exchangeThreadsCode(code);
    case 'tiktok':
      return exchangeTikTokCode(code, codeVerifier);
    default:
      throw new Error('Unsupported platform');
  }
}

async function exchangePinterestCode(code: string) {
  const cfg = await getPlatformConfig('pinterest');
  const clientId = String(cfg.clientId || process.env.VITE_PINTEREST_CLIENT_ID || '').trim();
  const clientSecret = String(cfg.clientSecret || process.env.PINTEREST_CLIENT_SECRET || '').trim();
  const redirectUri = resolveOAuthRedirectUri('pinterest', cfg.redirectUri || process.env.VITE_PINTEREST_REDIRECT_URI);
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
    throw new Error(msg);
  }
  return resp.data;
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
  const cfg = await getPlatformConfig('linkedin');
  const data = new URLSearchParams({
    grant_type: 'authorization_code',
    code,
    redirect_uri: resolveOAuthRedirectUri('linkedin', cfg.redirectUri || process.env.VITE_LINKEDIN_REDIRECT_URI, req),
    client_id: cfg.clientId || process.env.VITE_LINKEDIN_CLIENT_ID || '',
    client_secret: cfg.clientSecret || process.env.LINKEDIN_CLIENT_SECRET || '',
  });
  const response = await axios.post('https://www.linkedin.com/oauth/v2/accessToken', data.toString(), {
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    validateStatus: () => true,
    timeout: 15000,
  });
  if (response.status >= 400) {
    const errBody: any = response.data || {};
    const detail = errBody?.error_description || errBody?.error || '';
    throw new Error(`LinkedIn token exchange failed (${response.status})${detail ? `: ${detail}` : ''}`);
  }
  const tokenData: any = response.data || {};
  const accessToken = String(tokenData?.access_token || '').trim();
  if (accessToken) {
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
          const ud: any = userinfoResp.data || {};
          linkedInId = String(ud?.sub || '').trim();
          fullName = fullName || String(ud?.name || '').trim() || [String(ud?.given_name || ''), String(ud?.family_name || '')].filter(Boolean).join(' ').trim();
        }
      }
      if (linkedInId) { tokenData.user_id = linkedInId; tokenData.id = linkedInId; tokenData.sub = linkedInId; }
      if (fullName) tokenData.name = fullName;
    } catch {
      // best-effort enrichment; token can still be stored without profile data
    }
  }
  return tokenData;
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

  const shortLived = (tokenRes.data as any)?.access_token;
  if (!shortLived) return tokenRes.data;

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
      return {
        ...(tokenRes.data || {}),
        ...(longRes.data || {}),
        short_lived_access_token: shortLived,
        access_token: (longRes.data as any).access_token,
      };
    }
  } catch {
    // ignore - return short-lived token if exchange fails
  }

  return tokenRes.data;
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
  if (!pool) return true;
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
        params: { 'user.fields': 'id,name,username,profile_image_url' },
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
        };
      }
    } catch {
      // Best-effort enrichment only; posting can still proceed with the token alone.
    }
  }

  const handle =
    normalizedTokenData?.username || accountId || normalizedTokenData?.handle || `${platformId}_account`;
  const followers = Number(normalizedTokenData?.followers || normalizedTokenData?.followers_count || 0);
  const expiresAt = normalizedTokenData?.expires_in
    ? new Date(Date.now() + Number(normalizedTokenData.expires_in) * 1000).toISOString()
    : null;
  const tokenExpiresAt = expiresAt;

  const platRow = await dbQuery<{ id: number }>('SELECT id FROM social_platforms WHERE slug=$1', [platformId]).catch(() => ({ rows: [] } as any));
  const platformDbId = platRow?.rows?.[0]?.id ?? null;
  const accessTokenEncrypted = accessTokenRaw ? encryptIntegrationSecret(accessTokenRaw) : null;
  const refreshTokenEncrypted = refreshTokenRaw ? encryptIntegrationSecret(refreshTokenRaw) : null;

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
    return name ? `Board: ${name}` : (id ? `Board: ${id}` : 'Board');
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

const OAUTH_AUTH_URLS: Record<string, { authUrl: string; scopes: string; idField: 'appId' | 'clientId' | 'clientKey' }> = {
  // Instagram Basic Display OAuth (scopes are comma-separated)
  instagram: { authUrl: 'https://api.instagram.com/oauth/authorize', scopes: 'user_profile,user_media', idField: 'appId' },
  facebook:  { authUrl: 'https://www.facebook.com/v19.0/dialog/oauth', scopes: 'public_profile,email,pages_show_list,pages_read_engagement,pages_manage_posts,pages_manage_metadata,read_insights', idField: 'appId' },
  // LinkedIn scopes are space-separated.
  // w_member_social + r_liteprofile + r_emailaddress are what the "Share on LinkedIn" product grants.
  // Do NOT add openid/profile/email (OpenID Connect) or org scopes — those require separate LinkedIn
  // product approvals and will cause unauthorized_scope_error on standard apps.
  linkedin:  { authUrl: 'https://www.linkedin.com/oauth/v2/authorization', scopes: 'w_member_social r_liteprofile r_emailaddress', idField: 'clientId' },
  // media.write is NOT a standard OAuth 2.0 scope — requesting it causes Twitter to reject the auth URL entirely.
  // tweet.write is sufficient for posting tweets and uploading media via the v1.1 media upload endpoint.
  twitter:   { authUrl: 'https://twitter.com/i/oauth2/authorize', scopes: 'tweet.read tweet.write users.read offline.access', idField: 'clientId' },
  pinterest: { authUrl: 'https://www.pinterest.com/oauth/', scopes: 'boards:read,pins:read,pins:write', idField: 'clientId' },
  tiktok:    { authUrl: 'https://www.tiktok.com/v2/auth/authorize/', scopes: 'user.info.basic,user.info.stats,video.list,video.upload,video.publish', idField: 'clientKey' },
  threads:   { authUrl: 'https://www.threads.net/oauth/authorize', scopes: 'threads_basic,threads_content_publish', idField: 'appId' },
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
      const result = await dbQuery('SELECT provider, config FROM auth_providers WHERE enabled = true ORDER BY provider');
      return res.json({
        success: true,
        providers: result.rows.map((r: any) => ({
          provider: r.provider as string,
          // Only return public-safe fields (client_id / app_id, not secret)
          clientId: (r.config as Record<string, string>).clientId || '',
        })),
      });
    }
    return res.json({ success: true, providers: [] });
  } catch (error) {
    console.error('Get auth providers error:', error);
    return res.status(500).json({ success: false, error: 'Failed to fetch providers' });
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
    if (!pool) return res.status(503).json({ success: false, error: 'Database not configured' });

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
    
    const { rows } = await pool.query(query, params);
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
    if (!pool) return res.status(503).json({ success: false, error: 'Database not configured' });

    const { id } = req.params;
    const result = await pool.query('DELETE FROM social_accounts WHERE id=$1 AND user_id=$2', [String(id), auth.userId]);
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

    let warning: string | null = null;
    const aclResp = await axios.get(
      'https://api.linkedin.com/v2/organizationAcls',
      {
        params: {
          q: 'roleAssignee',
          roleAssignee: `urn:li:person:${personId}`,
          state: 'APPROVED',
        },
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'X-Restli-Protocol-Version': '2.0.0',
        },
        validateStatus: () => true,
        timeout: 15000,
      }
    );
    const aclData: any = aclResp.data || {};
    if (aclResp.status >= 400) {
      // Any error (403 = no org scope, 400 = invalid params for scope) means the token
      // doesn't have organization permissions. Silently skip — standard "Share on LinkedIn"
      // apps don't include org scopes, so this is expected and not an error to surface.
    } else {
      const organizationIds = Array.from(
        new Set(
          (Array.isArray(aclData?.elements) ? aclData.elements : [])
            .map((row: any) => String(row?.organization || '').trim())
            .filter(Boolean)
            .map((urn: string) => {
              const match = urn.match(/organization:(\d+)/i);
              return match?.[1] || '';
            })
            .filter(Boolean)
        )
      );

      for (const organizationId of organizationIds) {
        const orgResp = await axios.get(`https://api.linkedin.com/rest/organizations/${encodeURIComponent(organizationId)}`, {
          headers: {
            Authorization: `Bearer ${accessToken}`,
            'X-Restli-Protocol-Version': '2.0.0',
            'LinkedIn-Version': '202511',
          },
          validateStatus: () => true,
          timeout: 15000,
        });
        const orgData: any = orgResp.data || {};
        if (orgResp.status >= 400) {
          warning = warning || orgData?.message || `LinkedIn organization lookup failed (${orgResp.status})`;
          continue;
        }
        const localizedName = String(orgData?.localizedName || orgData?.name || '').trim();
        targets.push({
          id: organizationId,
          name: localizedName || `LinkedIn Page ${organizationId}`,
          accountType: 'page',
          saved: savedKeys.has(`page:${organizationId}`),
        });
      }
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
    const refreshToken = String(conn.token_data?.refresh_token || '').trim();
    if (!refreshToken) return res.status(400).json({ success: false, error: 'No refresh token stored — reconnect LinkedIn' });

    const refreshed = await refreshLinkedInAccessToken(refreshToken);
    const newToken = String(refreshed?.access_token || '').trim();
    if (!newToken) return res.status(400).json({ success: false, error: 'LinkedIn token refresh returned no token' });

    const expiresAt = refreshed?.expires_in
      ? new Date(Date.now() + Number(refreshed.expires_in) * 1000).toISOString()
      : null;
    await pool.query(
      `UPDATE social_accounts
       SET access_token=$1, token_expires_at=$2, needs_reapproval=false, updated_at=NOW()
       WHERE user_id=$3 AND LOWER(platform)='linkedin'`,
      [newToken, expiresAt, user.userId]
    );
    return res.json({ success: true, message: 'LinkedIn access token refreshed', expiresAt });
  } catch (err) {
    console.error('LinkedIn token refresh error:', err);
    return res.status(500).json({ success: false, error: err instanceof Error ? err.message : 'Refresh failed' });
  }
});

// GET /api/v1/social/linkedin/post-insights/:postId — social actions + share stats for a post
app.get('/api/v1/social/linkedin/post-insights/:postId', async (req: Request, res: Response) => {
  const user = await requireAuth(req, res);
  if (!user) return;
  try {
    const conn = await getPublishableSocialConnection(user.userId, 'linkedin');
    const accessToken = String(conn?.access_token || '').trim();
    if (!accessToken) return res.status(400).json({ success: false, error: 'LinkedIn not connected' });

    const encodedId = encodeURIComponent(req.params.postId);
    const [actionsResp, statsResp] = await Promise.all([
      axios.get(`https://api.linkedin.com/v2/socialActions/${encodedId}`, {
        headers: { Authorization: `Bearer ${accessToken}`, 'X-Restli-Protocol-Version': '2.0.0' },
        validateStatus: () => true, timeout: 15000,
      }),
      axios.get(`https://api.linkedin.com/v2/organizationalEntityShareStatistics`, {
        params: { q: 'organizationalEntity&organizationalEntity', ugcPost: encodedId },
        headers: { Authorization: `Bearer ${accessToken}`, 'X-Restli-Protocol-Version': '2.0.0' },
        validateStatus: () => true, timeout: 15000,
      }),
    ]);
    const actions: any = actionsResp.data || {};
    const stats: any = statsResp.data?.elements?.[0]?.totalShareStatistics || {};
    return res.json({
      success: true,
      insights: {
        likes: actions?.likesSummary?.totalLikes ?? null,
        comments: actions?.commentsSummary?.totalFirstLevelComments ?? null,
        shares: stats.shareCount ?? null,
        impressions: stats.impressionCount ?? null,
        clicks: stats.clickCount ?? null,
        uniqueImpressionsCount: stats.uniqueImpressionsCount ?? null,
      },
    });
  } catch (err) {
    return res.status(500).json({ success: false, error: err instanceof Error ? err.message : 'Failed to fetch post insights' });
  }
});

// GET /api/v1/social/linkedin/org-analytics — organization follower + visitor statistics
app.get('/api/v1/social/linkedin/org-analytics', async (req: Request, res: Response) => {
  const user = await requireAuth(req, res);
  if (!user) return;
  if (!pool) return res.status(503).json({ success: false, error: 'Database not configured' });
  try {
    const conn = await getPublishableSocialConnection(user.userId, 'linkedin');
    const accessToken = String(conn?.access_token || '').trim();
    if (!accessToken) return res.status(400).json({ success: false, error: 'LinkedIn not connected' });

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
      timeGranularityType: timeGranularity,
      'timeRange.start': since || String(Date.now() - 30 * 24 * 60 * 60 * 1000),
      'timeRange.end': until || String(Date.now()),
    };
    const headers = { Authorization: `Bearer ${accessToken}`, 'X-Restli-Protocol-Version': '2.0.0' };

    const [followerResp, visitorResp, shareResp] = await Promise.all([
      axios.get('https://api.linkedin.com/v2/organizationalEntityFollowerStatistics', { params, headers, validateStatus: () => true, timeout: 15000 }),
      axios.get('https://api.linkedin.com/v2/organizationalEntityPageStatistics', { params, headers, validateStatus: () => true, timeout: 15000 }),
      axios.get('https://api.linkedin.com/v2/organizationalEntityShareStatistics', { params, headers, validateStatus: () => true, timeout: 15000 }),
    ]);

    return res.json({
      success: true,
      orgId,
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

async function refreshLinkedInAccessToken(refreshToken: string) {
  const cfg = await getPlatformConfig('linkedin');
  const clientId = (cfg.clientId || process.env.VITE_LINKEDIN_CLIENT_ID || '').trim();
  const clientSecret = (cfg.clientSecret || process.env.LINKEDIN_CLIENT_SECRET || '').trim();
  if (!clientId || !clientSecret) throw new Error('LinkedIn client credentials not configured');

  const data = new URLSearchParams({
    grant_type: 'refresh_token',
    refresh_token: refreshToken,
    client_id: clientId,
    client_secret: clientSecret,
  });
  const resp = await axios.post('https://www.linkedin.com/oauth/v2/accessToken', data.toString(), {
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    validateStatus: () => true,
    timeout: 15000,
  });
  if (resp.status >= 400) throw new Error(`LinkedIn token refresh failed (${resp.status})`);
  return resp.data;
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

  // ── Call 1: identity fields (user.info.basic) — required ──────────────────
  const basicResp = await ttGet('open_id,display_name,username,bio_description,is_verified');
  const basicErr  = basicResp.data?.error?.code;
  if (basicResp.status !== 200 || (basicErr && basicErr !== 'ok') || !basicResp.data?.data?.user) {
    const msg = basicResp.data?.error?.message || basicErr || `HTTP ${basicResp.status}`;
    throw new Error(msg || 'TikTok user info unavailable');
  }
  const user: any = { ...basicResp.data.data.user };

  // ── Call 2: stats fields (user.info.stats) — optional ────────────────────
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
    `SELECT platform, account_id, account_name, access_token, refresh_token, access_token_encrypted, refresh_token_encrypted, token_data, expires_at, token_expires_at, needs_reapproval
     FROM social_accounts
     WHERE user_id=$1 AND connected=true AND (COALESCE(access_token,'') <> '' OR COALESCE(access_token_encrypted,'') <> '')
       AND (account_type = 'profile' OR account_type IS NULL)`,
    [userId]
  );
  const match = rows.rows.find((r: any) => normalizePlatformId(r.platform) === platformId) as
    | {
        platform: string;
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
      }
    | undefined;
  if (!match) return null;

  let decryptedAccess = '';
  if (match.access_token_encrypted) {
    try {
      decryptedAccess = decryptIntegrationSecret(match.access_token_encrypted);
    } catch {
      decryptedAccess = '';
    }
  }
  let decryptedRefresh = '';
  if (match.refresh_token_encrypted) {
    try {
      decryptedRefresh = decryptIntegrationSecret(match.refresh_token_encrypted);
    } catch {
      decryptedRefresh = '';
    }
  }

  const accessToken = String(decryptedAccess || match.access_token || '').trim();
  const refreshToken = String(decryptedRefresh || match.refresh_token || '').trim();
  const tokenData = match.token_data || {};

  if (match.needs_reapproval) {
    return {
      platform: match.platform,
      access_token: '',
      token_data: tokenData,
      account_id: match.account_id,
      account_name: match.account_name,
      needs_reapproval: true,
      token_expires_at: match.token_expires_at || match.expires_at,
    };
  }

  const rawExpiry = match.token_expires_at || match.expires_at;
  const expiresAtMs = rawExpiry ? new Date(rawExpiry).getTime() : NaN;
  const refreshMarginMs = Math.max(1, SOCIAL_TOKEN_SAFETY_MARGIN_DAYS) * 24 * 60 * 60 * 1000;
  const supportsTokenRefresh = platformId === 'twitter' || platformId === 'linkedin' || platformId === 'tiktok';
  const isExpired = Number.isFinite(expiresAtMs) ? expiresAtMs <= Date.now() : false;
  const shouldRefreshSoon =
    supportsTokenRefresh && Number.isFinite(expiresAtMs) ? expiresAtMs <= Date.now() + refreshMarginMs : false;

  if (!Number.isFinite(expiresAtMs) || (!supportsTokenRefresh && !isExpired) || (supportsTokenRefresh && !shouldRefreshSoon)) {
    return {
      platform: match.platform,
      access_token: accessToken,
      token_data: tokenData,
      account_id: match.account_id,
      account_name: match.account_name,
      needs_reapproval: false,
      token_expires_at: rawExpiry,
    };
  }

  if (!supportsTokenRefresh) {
    await markSocialAccountNeedsReapproval({
      platformId,
      userId,
      reason: 'token_expired',
      disconnect: false,
    });
    return {
      platform: match.platform,
      access_token: '',
      token_data: tokenData,
      account_id: match.account_id,
      account_name: match.account_name,
      needs_reapproval: true,
      token_expires_at: rawExpiry,
    };
  }

  if (!refreshToken) {
    await markSocialAccountNeedsReapproval({
      platformId,
      userId,
      reason: 'token_missing_refresh',
      disconnect: false,
    });
    return {
      platform: match.platform,
      access_token: '',
      token_data: tokenData,
      account_id: match.account_id,
      account_name: match.account_name,
      needs_reapproval: true,
      token_expires_at: rawExpiry,
    };
  }

  let refreshed: any = null;
  try {
    if (platformId === 'twitter') {
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
      platform: match.platform,
      access_token: '',
      token_data: tokenData,
      account_id: match.account_id,
      account_name: match.account_name,
      needs_reapproval: true,
      token_expires_at: rawExpiry,
    };
  }

  const nextAccess = String(refreshed?.access_token || '').trim();
  const nextRefresh = String(refreshed?.refresh_token || refreshToken || '').trim() || null;
  const nextExpiresAt = computeExpiresAtIso(refreshed?.expires_in) || rawExpiry;
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
        [userId, match.platform, null, null, nextAccessEncrypted, nextRefreshEncrypted, nextExpiresAt, JSON.stringify(refreshed || {})]
      );
      await upsertUserIntegration({
        userId,
        integrationSlug: platformId,
        accessTokenEncrypted: nextAccessEncrypted,
        refreshTokenEncrypted: nextRefreshEncrypted,
        tokenExpiry: nextExpiresAt,
        accountId: match.account_id ?? null,
        accountName: match.account_name ?? null,
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
      platform: match.platform,
      access_token: nextAccess,
      token_data: mergedTokenData,
      account_id: match.account_id,
      account_name: match.account_name,
      needs_reapproval: false,
      token_expires_at: nextExpiresAt,
    };
  }

  return {
    platform: match.platform,
    access_token: '',
    token_data: tokenData,
    account_id: match.account_id,
    account_name: match.account_name,
    needs_reapproval: true,
    token_expires_at: rawExpiry,
  };
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
    const rawFeaturedImage = String(post.social_image || post.featured_image || '').trim();
    // Resolve relative image paths to absolute so external platforms (Facebook, etc.) can fetch them
    const featuredImage = (() => {
      if (!rawFeaturedImage) return '';
      if (/^https?:\/\//i.test(rawFeaturedImage)) return rawFeaturedImage;
      // Base64 data URL — pass through as-is (handled by platform publishers)
      if (rawFeaturedImage.startsWith('data:')) return rawFeaturedImage;
      // Relative URL — prepend the server's public base URL
      const serverBase = String(
        process.env.BACKEND_PUBLIC_URL ||
        process.env.PUBLIC_API_URL ||
        process.env.VITE_API_BASE_URL ||
        'https://contentflow-api-production.up.railway.app'
      ).replace(/\/$/, '');
      return `${serverBase}${rawFeaturedImage.startsWith('/') ? '' : '/'}${rawFeaturedImage}`;
    })();

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
      // const validation = instagramBusinessPlatform.validate(instagramPost);
      // if (!validation.ok) {
      //   return { status: 'failed', error: validation.error };
      // }

      await acquirePlatformSlot('instagram');
      // const result = await instagramBusinessPlatform.post(instagramPost, {
      //   accessToken: access_token,
      //   accountId: conn.account_id,
      //   accountName: conn.account_name,
      //   tokenData: token_data,
      //   helpers: { graphBase: 'https://graph.facebook.com/v19.0' },
      // });

      // if (result.status === 'published') {
      //   await logIntegrationEvent({
      //     userId,
      //     integrationSlug: 'instagram',
      //     eventType: 'post_published',
      //     status: 'success',
      //     response: { platformPostId: result.platformPostId || null },
      //   });
      // }

      // return { status: result.status, platformPostId: result.platformPostId, error: result.error, retryable: result.retryable };
      return { status: 'failed', error: 'Instagram publishing temporarily disabled' };
    }

    if (platformId === 'pinterest') {
      if (!featuredImage || !/^https?:\/\//i.test(featuredImage)) {
        return { status: 'failed', error: 'Pinterest publishing requires a public image URL. Set a featured image first.' };
      }

      const destination = options?.destination && typeof options.destination === 'object'
        ? (options.destination as any)
        : undefined;

      let boardId = destination?.type === 'board' ? String(destination.id || '').trim() || null : null;
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
      if (!boardId) return { status: 'failed', error: 'Select a Pinterest board under Integrations -> Pinterest -> Manage.' };

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
        const msg = pinData?.message || pinData?.error || `Pinterest API error ${pinResp.status}`;
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

          // ── Fetch TikTok videos and metrics (skip if video.list scope missing) ─
          try {
            const videosResp = await axios.get('https://open.tiktokapis.com/v2/video/list/', {
              headers: { Authorization: `Bearer ${token}` },
              params: {
                fields: 'id,title,cover_image_url,share_url,create_time,duration,like_count,comment_count,share_count,view_count',
                max_count: 100,
              },
              validateStatus: () => true,
              timeout: 15000,
            });

            const vidErr = videosResp.data?.error?.code;
            // Silently skip if video.list scope not granted — don't surface as error
            if (vidErr && vidErr !== 'ok') {
              console.log(`TikTok video.list scope not available (${vidErr}) — skipping video sync`);
            } else if (videosResp.status === 200 && !vidErr) {
              const videos: any[] = videosResp.data?.data?.videos || [];
              for (const v of videos) {
                if (!v.id) continue;
                const videoId = String(v.id);
                const likes = Number(v.like_count || 0);
                const comments = Number(v.comment_count || 0);
                const shares = Number(v.share_count || 0);
                const views = Number(v.view_count || 0);
                const engagement = likes + comments + shares;
                const duration = Number(v.duration || 0);
                const postedAt = v.create_time ? new Date(v.create_time * 1000).toISOString() : null;
                const videoTitle = typeof v.title === 'string' ? v.title.slice(0, 500) : null;
                const coverUrl = typeof v.cover_image_url === 'string' ? v.cover_image_url : null;
                const shareUrl = typeof v.share_url === 'string' ? v.share_url : null;

                // Upsert into dedicated tiktok_video_insights table
                await pool!.query(
                  `INSERT INTO tiktok_video_insights
                     (id, user_id, social_account_id, video_id, title, cover_url, share_url,
                      likes, comments, shares, views, engagement, duration_seconds, posted_at, fetched_at, raw_data)
                   VALUES (gen_random_uuid()::text, $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, NOW(), $14::jsonb)
                   ON CONFLICT (social_account_id, video_id) DO UPDATE SET
                     title=EXCLUDED.title, cover_url=EXCLUDED.cover_url, share_url=EXCLUDED.share_url,
                     likes=EXCLUDED.likes, comments=EXCLUDED.comments, shares=EXCLUDED.shares,
                     views=EXCLUDED.views, engagement=EXCLUDED.engagement,
                     duration_seconds=EXCLUDED.duration_seconds, fetched_at=NOW(), raw_data=EXCLUDED.raw_data`,
                  [auth.userId, acct.id, videoId, videoTitle, coverUrl, shareUrl,
                   likes, comments, shares, views, engagement, duration, postedAt, JSON.stringify(v)]
                );

                // Also upsert into generic social_metrics for cross-platform aggregations
                await pool!.query(
                  `INSERT INTO social_metrics (id, user_id, platform, platform_post_id, social_account_id, likes, comments, shares, impressions, reach, engagement, raw_data, posted_at, fetched_at)
                   VALUES (gen_random_uuid()::text, $1, 'tiktok', $2, $3, $4, $5, $6, $7, $8, $9, $10::jsonb, $11, NOW())
                   ON CONFLICT (user_id, platform, platform_post_id) DO UPDATE SET
                     likes=EXCLUDED.likes, comments=EXCLUDED.comments, shares=EXCLUDED.shares,
                     impressions=EXCLUDED.impressions, reach=EXCLUDED.reach, engagement=EXCLUDED.engagement,
                     raw_data=EXCLUDED.raw_data, fetched_at=NOW()`,
                  [auth.userId, videoId, acct.id,
                   likes, comments, shares, views, views, engagement,
                   JSON.stringify(v), postedAt]
                );
                synced++;
              }
            }
          } catch (vidErr: any) {
            console.error('TikTok video fetch error:', vidErr.message);
            // Don't block sync on video fetch failure
          }
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

      // ── Video insights sync (skip silently if video.list scope missing) ───
      try {
        const videosResp = await axios.get('https://open.tiktokapis.com/v2/video/list/', {
          headers: { Authorization: `Bearer ${token}` },
          params: {
            fields: 'id,title,cover_image_url,share_url,create_time,duration,like_count,comment_count,share_count,view_count',
            max_count: 100,
          },
          validateStatus: () => true, timeout: 15000,
        });
        const vidErrCode = videosResp.data?.error?.code;
        if (vidErrCode && vidErrCode !== 'ok') {
          // video.list scope not granted — skip without surfacing as user-facing error
          console.log(`TikTok video.list scope not available (${vidErrCode}) — skipping`);
        } else if (videosResp.status === 200 && !vidErrCode) {
          const videos: any[] = videosResp.data?.data?.videos || [];
          for (const v of videos) {
            if (!v.id) continue;
            const likes = Number(v.like_count || 0);
            const comments = Number(v.comment_count || 0);
            const shares = Number(v.share_count || 0);
            const views = Number(v.view_count || 0);
            const engagement = likes + comments + shares;
            await pool.query(
              `INSERT INTO tiktok_video_insights
                 (id, user_id, social_account_id, video_id, title, cover_url, share_url,
                  likes, comments, shares, views, engagement, duration_seconds, posted_at, fetched_at, raw_data)
               VALUES (gen_random_uuid()::text, $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, NOW(), $14::jsonb)
               ON CONFLICT (social_account_id, video_id) DO UPDATE SET
                 title=EXCLUDED.title, cover_url=EXCLUDED.cover_url, share_url=EXCLUDED.share_url,
                 likes=EXCLUDED.likes, comments=EXCLUDED.comments, shares=EXCLUDED.shares,
                 views=EXCLUDED.views, engagement=EXCLUDED.engagement,
                 duration_seconds=EXCLUDED.duration_seconds, fetched_at=NOW(), raw_data=EXCLUDED.raw_data`,
              [auth.userId, acct.id, String(v.id),
               typeof v.title === 'string' ? v.title.slice(0, 500) : null,
               typeof v.cover_image_url === 'string' ? v.cover_image_url : null,
               typeof v.share_url === 'string' ? v.share_url : null,
               likes, comments, shares, views, engagement,
               Number(v.duration || 0),
               v.create_time ? new Date(v.create_time * 1000).toISOString() : null,
               JSON.stringify(v)]
            );
            synced++;
          }
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

// GET /api/social/tiktok/videos — paginated video insights for the authenticated user
app.get('/api/social/tiktok/videos', async (req: Request, res: Response) => {
  try {
    const auth = requireAuth(req, res);
    if (!auth) return;
    if (!pool) return res.status(503).json({ success: false, error: 'DB not ready' });

    const q = req.query as any;
    const days = Math.min(365, Math.max(1, parseInt(q.days || '30', 10)));
    const limit = Math.min(100, Math.max(1, parseInt(q.limit || '50', 10)));
    const offset = Math.max(0, parseInt(q.offset || '0', 10));
    const accountId = q.account_id ? String(q.account_id) : null;

    const since = new Date();
    since.setDate(since.getDate() - days);

    const params: any[] = [auth.userId, since.toISOString()];
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
         AND (tvi.posted_at >= $2 OR tvi.posted_at IS NULL)
         ${accountFilter}
       ORDER BY COALESCE(tvi.posted_at, tvi.fetched_at) DESC
       LIMIT $${params.length - 1} OFFSET $${params.length}`,
      params
    );

    const countRes = await pool.query(
      `SELECT COUNT(*) FROM tiktok_video_insights tvi
       WHERE tvi.user_id = $1 AND (tvi.posted_at >= $2 OR tvi.posted_at IS NULL) ${accountFilter}`,
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
       WHERE tvi.user_id = $1 AND (tvi.posted_at >= $2 OR tvi.posted_at IS NULL) ${accountFilter}`,
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

// GET /api/social/tiktok/followers — get current follower count for authenticated user
app.get('/api/social/tiktok/followers', async (req: Request, res: Response) => {
  try {
    const auth = requireAuth(req, res);
    if (!auth) return;
    if (!pool) return res.json({ followers: null, hasData: false });

    // TikTok is connected via OAuth → stored in social_accounts.
    // The sync writes follower counts to social_profile_stats (primary) and
    // social_accounts.followers (secondary). Read from there, not user_integrations.
    const { rows: accounts } = await pool.query(
      `SELECT sa.id, sa.followers,
              sps.followers AS sps_followers, sps.synced_at
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
    // Prefer the profile-stats snapshot; fall back to the social_accounts column
    const followers = row.sps_followers ?? row.followers ?? null;
    if (followers !== null) {
      return res.json({ followers: Number(followers), hasData: true });
    }

    return res.json({ followers: null, hasData: false });
  } catch (err) {
    console.error('TikTok followers error:', err);
    return res.json({ followers: null, hasData: false });
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

// SPA fallback
app.use((req, res) => {
  res.sendFile(path.join(__dirname, 'docs', 'index.html'));
});

// Start server
app.listen(PORT, () => {
  console.log(`OAuth server running on port ${PORT}`);
});

export default app;


































