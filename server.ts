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
// import { TwitterXPlatform } from './backend/platforms/twitter_x.js';
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

app.use(express.static(path.join(__dirname, 'docs')));
const JWT_SECRET = process.env.JWT_SECRET || 'your-secret-key';
const DATABASE_URL = process.env.DATABASE_URL;
const REDIS_URL = process.env.REDIS_URL || process.env.BULLMQ_REDIS_URL || '';
const TWITTER_MONTHLY_WRITE_LIMIT = Number(process.env.TWITTER_MONTHLY_WRITE_LIMIT || process.env.X_MONTHLY_WRITE_LIMIT || 0);
const SOCIAL_TOKEN_SAFETY_MARGIN_DAYS = Number(process.env.SOCIAL_TOKEN_SAFETY_MARGIN_DAYS || 10);

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
  'http://127.0.0.1:3000',
  'https://marketing.dakyworld.com',
  'https://daky0000.github.io',
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
const SOCIAL_AUTOMATION_QUEUE_NAME = 'social-publish';
const facebookPagesPlatform = new FacebookPagesPlatform();
// const instagramBusinessPlatform = new InstagramBusinessPlatform();
const linkedInPlatform = new LinkedInPlatform();
// const twitterXPlatform = new TwitterXPlatform();

let socialAutomationQueue: Queue | null = null;
let socialAutomationWorker: Worker | null = null;
let socialAutomationRedis: IORedis | null = null;

function isBullMqEnabled() {
  return Boolean(REDIS_URL && REDIS_URL.trim());
}

function getRetryDelayMs(attemptNumber: number) {
  const n = Math.max(1, Number(attemptNumber || 1));
  return SOCIAL_AUTOMATION_RETRY_BASE_DELAY_MS * Math.pow(2, n - 1);
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
  await pool.query(`ALTER TABLE media_images ADD COLUMN IF NOT EXISTS alt_text TEXT DEFAULT ''`).catch(() => undefined);
  await pool.query(`ALTER TABLE media_images ADD COLUMN IF NOT EXISTS caption TEXT DEFAULT ''`).catch(() => undefined);
  await pool.query(`ALTER TABLE media_images ADD COLUMN IF NOT EXISTS description TEXT DEFAULT ''`).catch(() => undefined);

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
      return exchangeTwitterCode(code, codeVerifier);
    case 'linkedin':
      return exchangeLinkedInCode(code, req);
    case 'facebook':
      return exchangeFacebookCode(code);
    case 'pinterest':
      return exchangePinterestCode(code);
    case 'threads':
      return exchangeThreadsCode(code);
    case 'tiktok':
      return exchangeTikTokCode(code);
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

async function exchangeTwitterCode(code: string, codeVerifier?: string) {
  const cfg = await getPlatformConfig('twitter');
  const clientId = cfg.clientId || process.env.VITE_TWITTER_CLIENT_ID || '';
  const clientSecret = cfg.clientSecret || process.env.TWITTER_CLIENT_SECRET || '';
  const redirectUri = resolveOAuthRedirectUri('twitter', cfg.redirectUri || process.env.VITE_TWITTER_REDIRECT_URI);

  const data = new URLSearchParams({
    client_id: clientId,
    ...(clientSecret ? { client_secret: clientSecret } : {}),
    code,
    grant_type: 'authorization_code',
    redirect_uri: redirectUri,
    code_verifier: (codeVerifier || cfg.codeVerifier || '').trim() || 'challenge',
  });

  const response = await axios.post('https://api.twitter.com/2/oauth2/token', data.toString(), {
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    validateStatus: () => true,
    timeout: 15000,
  });
  if (response.status >= 400) {
    throw new Error(`Twitter token exchange failed (${response.status})`);
  }
  return response.data;
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

async function exchangeTikTokCode(code: string) {
  const cfg = await getPlatformConfig('tiktok');
  const data = new URLSearchParams({
    client_key: cfg.clientKey || process.env.VITE_TIKTOK_CLIENT_ID || '',
    client_secret: cfg.clientSecret || process.env.TIKTOK_CLIENT_SECRET || '',
    code,
    grant_type: 'authorization_code',
    redirect_uri: resolveOAuthRedirectUri('tiktok', cfg.redirectUri || process.env.VITE_TIKTOK_REDIRECT_URI),
  });
  const response = await axios.post('https://open.tiktokapis.com/v2/oauth/token/', data.toString(), {
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    validateStatus: () => true,
    timeout: 15000,
  });
  if (response.status >= 400) {
    throw new Error(`TikTok token exchange failed (${response.status})`);
  }
  return response.data;
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
  const handle =
    tokenData?.user_id || tokenData?.username || tokenData?.handle || `${platformId}_account`;
  const followers = Number(tokenData?.followers || tokenData?.followers_count || 0);
  const expiresAt = tokenData?.expires_in
    ? new Date(Date.now() + Number(tokenData.expires_in) * 1000).toISOString()
    : null;
  const tokenExpiresAt = expiresAt;

  const accountId = String(tokenData?.user_id || tokenData?.id || '').trim() || null;
  const accountName = tokenData?.name ? String(tokenData.name) : null;
  const profileImage = tokenData?.avatar_url ? String(tokenData.avatar_url) : null;

  const platRow = await dbQuery<{ id: number }>('SELECT id FROM social_platforms WHERE slug=$1', [platformId]).catch(() => ({ rows: [] } as any));
  const platformDbId = platRow?.rows?.[0]?.id ?? null;

  const accessTokenRaw = String(tokenData?.access_token ?? tokenData?.accessToken ?? '').trim();
  const refreshTokenRaw = String(tokenData?.refresh_token ?? tokenData?.refreshToken ?? '').trim();
  const accessTokenEncrypted = accessTokenRaw ? encryptIntegrationSecret(accessTokenRaw) : null;
  const refreshTokenEncrypted = refreshTokenRaw ? encryptIntegrationSecret(refreshTokenRaw) : null;

  await dbQuery(
    `
    INSERT INTO social_accounts
      (id, user_id, platform, platform_id, account_type, account_id, account_name, profile_image, handle, followers, connected, connected_at, expires_at, token_expires_at, access_token, refresh_token, access_token_encrypted, refresh_token_encrypted, token_data, needs_reapproval)
    VALUES ($1, $2, $3, $4, 'profile', $5, $6, $7, $8, $9, true, NOW(), $10, $11, $12, $13, $14, $15, $16, false)
    ON CONFLICT (user_id, platform) WHERE account_type = 'profile' DO UPDATE
      SET platform_id = EXCLUDED.platform_id,
          account_id = EXCLUDED.account_id,
          account_name = EXCLUDED.account_name,
          profile_image = EXCLUDED.profile_image,
          handle = EXCLUDED.handle,
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
      tokenData || {},
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
    const secretRequired = slug === 'facebook' || slug === 'twitter' || slug === 'linkedin' || slug === 'tiktok' || slug === 'threads' || slug === 'pinterest';
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
      const secretRequired = platform === 'facebook' || platform === 'twitter' || platform === 'linkedin' || platform === 'tiktok' || platform === 'threads' || platform === 'pinterest';
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
  twitter:   { authUrl: 'https://twitter.com/i/oauth2/authorize', scopes: 'tweet.read tweet.write users.read offline.access', idField: 'clientId' },
  pinterest: { authUrl: 'https://www.pinterest.com/oauth/', scopes: 'boards:read,pins:read,pins:write', idField: 'clientId' },
  tiktok:    { authUrl: 'https://www.tiktok.com/v2/auth/authorize/', scopes: 'user.info.basic,video.upload', idField: 'clientKey' },
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
    const secretRequired =
      platform === 'instagram' ||
      platform === 'facebook' ||
      platform === 'threads' ||
      platform === 'twitter' ||
      platform === 'linkedin' ||
      platform === 'tiktok' ||
      platform === 'pinterest';
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

    // Treat platforms as enabled if they are explicitly enabled OR if they have a non-empty config record.
    const platformResult = await dbQuery(
      `SELECT platform
       FROM platform_configs
       WHERE enabled = true OR (config IS NOT NULL AND config <> '{}'::jsonb)`
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

    const SUPPORTED_SLUGS = ['wordpress', 'facebook', 'instagram', 'linkedin', 'twitter', 'pinterest', 'mailchimp'] as const;

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
          type: slug === 'wordpress' ? 'cms' : slug === 'mailchimp' ? 'marketing' : 'social',
          adminEnabled: configRow ? Boolean(configRow.enabled) : slug === 'wordpress' || slug === 'mailchimp',
          configured:
            slug === 'wordpress' || slug === 'mailchimp'
              ? true
              : Boolean(configRow?.config && Object.keys(configRow.config || {}).length > 0),
          connected: false,
          connection: null,
        };
        const isAlwaysVisible = slug === 'wordpress' || slug === 'mailchimp';
        if (isAlwaysVisible || (item.adminEnabled && item.configured)) {
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
      `SELECT platform, account_type, account_id, account_name, connected, created_at
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
      const adminEnabled = adminEnabledRaw || (hasConfig && slug !== 'wordpress' && slug !== 'mailchimp');

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
          const secretRequired = slug === 'facebook' || slug === 'twitter' || slug === 'linkedin' || slug === 'tiktok' || slug === 'threads' || slug === 'pinterest';
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

      const isAlwaysVisible = slug === 'wordpress' || slug === 'mailchimp';
      if (isAlwaysVisible || (adminEnabled && configured)) {
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

    const visiblePlatforms = await getVisibleUserPlatformSlugs();
    const publishablePlatforms = new Set(['linkedin', 'pinterest', 'threads']);
    const selectedRows = await pool.query(
      `SELECT a.platform, a.account_type, a.account_id, a.account_name, s.template
       FROM social_post_settings s
       JOIN social_post_targets t ON t.social_post_id = s.id AND t.enabled = true
       JOIN social_accounts a ON a.id = t.social_account_id
       WHERE s.post_id = $1 AND a.connected = true`,
      [String(postId)]
    );

    const template = String(selectedRows.rows[0]?.template || '').trim();
    const sourceRows =
      selectedRows.rows.length > 0
        ? selectedRows.rows
        : (
            await pool.query(
              `SELECT platform, account_type, account_id, account_name
               FROM social_accounts
               WHERE user_id=$1 AND connected=true`,
              [auth.userId]
            )
          ).rows;

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
    const imgCategory = category === 'admin' ? 'admin' : 'user';
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
    const params: unknown[] = [user.userId];
    let query = 'SELECT * FROM media_images WHERE user_id = $1';
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

// TikTok domain verification
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
    if (aclResp.status === 403) {
      warning = 'Reconnect LinkedIn to grant company page permissions before selecting a page.';
    } else if (aclResp.status >= 400) {
      warning = aclData?.message || `LinkedIn pages lookup failed (${aclResp.status})`;
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

  const updates: string[] = [
    "needs_reapproval = true",
    "token_data = COALESCE(token_data, '{}'::jsonb) || $4::jsonb",
  ];
  if (disconnect) updates.push('connected = false');

  const whereClauses: string[] = ["LOWER(platform)=LOWER($1)"];
  const values: any[] = [platformId, accountId, userId, JSON.stringify(meta)];
  if (accountId) whereClauses.push('account_id = $2');
  if (userId) whereClauses.push('user_id = $3');

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
    client_id: clientId,
    grant_type: 'refresh_token',
    refresh_token: refreshToken,
  });
  if (clientSecret) data.set('client_secret', clientSecret);

  const resp = await axios.post('https://api.twitter.com/2/oauth2/token', data.toString(), {
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    validateStatus: () => true,
    timeout: 15000,
  });
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
  const supportsTokenRefresh = platformId === 'twitter' || platformId === 'linkedin';
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

async function enqueueBullMqJob(taskId: string, runAtIso: string) {
  if (!isBullMqEnabled()) return;
  await ensureBullMqSocialAutomationQueue();
  if (!socialAutomationQueue) return;

  const runAt = new Date(runAtIso);
  const delay = Math.max(0, runAt.getTime() - Date.now());
  try {
    await socialAutomationQueue.add('social-publish', { taskId }, { jobId: taskId, delay });
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
    const retryAt = new Date(Date.now() + getRetryDelayMs(attemptNumber));
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
          'INSERT INTO publishing_logs (id,post_id,user_id,platform,status,platform_post_id,error_message,response) VALUES ($1,$2,$3,$4,$5,$6,$7,$8::jsonb)',
          [randomUUID(), postId, userId, platform, result.status, result.platformPostId || null, result.error || null, JSON.stringify(result as any)]
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

  await enqueueBullMqJob(taskId, runAtIso);
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
      await processSocialAutomationTaskById(taskId, attemptNumber, SOCIAL_AUTOMATION_MAX_ATTEMPTS);
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
          `SELECT id, run_at FROM social_automation_tasks
           WHERE status IN ('scheduled','pending')
           ORDER BY run_at ASC
           LIMIT 200`
        );
        for (const r of rows as any[]) {
          await enqueueBullMqJob(String(r.id), String(r.run_at));
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
      };

      // const validation = twitterXPlatform.validate(twitterPost);
      // if (!validation.ok) {
      //   return { status: 'failed', error: validation.error };
      // }

      await acquirePlatformSlot('twitter');
      // const result = await twitterXPlatform.post(twitterPost, {
      //   accessToken: access_token,
      //   accountId: conn.account_id,
      //   accountName: conn.account_name,
      //   tokenData: token_data,
      // });

      // if (result.status === 'published') {
      //   await logIntegrationEvent({
      //     userId,
      //     integrationSlug: 'twitter',
      //     eventType: 'post_published',
      //     status: 'success',
      //     response: { platformPostId: result.platformPostId || null },
      //   });
      // }

      // return { status: result.status, platformPostId: result.platformPostId, error: result.error, retryable: result.retryable };
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
        'INSERT INTO publishing_logs (id,post_id,user_id,platform,status,platform_post_id,error_message) VALUES ($1,$2,$3,$4,$5,$6,$7)',
        [logId, postId, auth.userId, platformId, result.status, result.platformPostId || null, result.error || null]
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

// SPA fallback
app.use((req, res) => {
  res.sendFile(path.join(__dirname, 'docs', 'index.html'));
});

// Start server
app.listen(PORT, () => {
  console.log(`OAuth server running on port ${PORT}`);
});

export default app;























































