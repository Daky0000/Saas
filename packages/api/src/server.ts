import Anthropic from '@anthropic-ai/sdk';
import { GoogleGenerativeAI } from '@google/generative-ai';
import { Resend } from 'resend';
import Stripe from 'stripe';
import express from 'express';
import type { Request, Response, NextFunction } from 'express';
import cors from 'cors';
import helmet from 'helmet';
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
import { existsSync } from 'fs';
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
import { registerBlogRoutes } from './server/blogRoutes.ts';
import { registerBillingRoutes, registerAdminBillingRoutes } from './server/billingRoutes.ts';
import { registerSurveyRoutes, registerPublicSurveyRoutes } from './server/surveyRoutes.ts';
import { registerLeadsRoutes, registerGoogleSheetsRoutes } from './server/leadsRoutes.ts';
import { registerPagesRoutes } from './server/pagesRoutes.ts';
import { registerMailingRoutes } from './server/mailingRoutes.ts';
import { registerNotificationRoutes } from './server/notificationsRoutes.ts';
import { registerCampaignRoutes, registerTrackingRoutes, registerShortLinkRoutes } from './server/campaignRoutes.ts';
import { registerOrgRoutes } from './server/orgRoutes.ts';
import { registerCreditsRoutes } from './server/creditsRoutes.ts';
import { registerApifyRoutes } from './server/apifyRoutes.ts';
import { registerHiggsfieldRoutes } from './server/higgsfieldRoutes.ts';
import { registerKlingRoutes } from './server/klingRoutes.ts';
import { registerGoogleRoutes } from './server/googleRoutes.ts';
import { registerOpenAIRoutes } from './server/openaiRoutes.ts';
import { registerAutomationRoutes } from './server/automationRoutes.ts';
import { registerHubtelRoutes } from './server/hubtelRoutes.ts';
import { registerAISkillsRoutes } from './server/aiSkillsRoutes.ts';
import { registerUserDesignRoutes } from './server/userDesignRoutes.ts';
import { registerDbAuditRoutes } from './server/dbAuditRoutes.ts';
import { registerSocialAuthRoutes } from './server/socialAuthRoutes.ts';
import { registerMemoryAgentRoutes } from './server/memoryAgentRoutes.ts';
import { registerDakyLearnRoutes } from './server/dakyLearnRoutes.ts';
import { config } from './config.ts';
import { logger } from './logger.ts';
import { requestIdMiddleware } from './middleware/requestId.ts';
import { errorHandler } from './middleware/errorHandler.ts';
import { validateBody } from './middleware/validate.ts';
import { authLimiter, passwordLimiter } from './middleware/rateLimiter.ts';
import { buildWorkflowEngine } from './server/workflowRoutes.ts';
import { registerAIChatRoutes } from './server/aiChatRoutes.ts';
import { registerMagnificRoutes, getMagnificApiKey, getFreepikApiKey, magnificPost, pollMagnificTask, magnificGenerateImage, freepikGenerateImage, MAGNIFIC_BASE, FREEPIK_BASE, ASPECT_TO_WH, MAGNIFIC_IMAGE_MODELS, MAGNIFIC_VIDEO_MODELS, ASPECT_RATIO_MAP, FREEPIK_IMAGE_MODELS, proxyHeaders, sanitizeMagnificError } from './server/magnificRoutes.ts';
import { buildNovaModule } from './server/novaRoutes.ts';

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
  } catch (err) {
    logger.error('Unhandled error:', err);
    // DB not ready yet — ignore, keep current value
  }
}

const app = express();
const PORT = config.port;
app.use(requestIdMiddleware);

// ── Security & parsing middleware — must be before ALL routes ─────────────────
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
app.use(
  helmet({
    crossOriginEmbedderPolicy: false,
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        scriptSrc: [
          "'self'",
          'https://connect.facebook.net',
          'https://www.googletagmanager.com',
          'https://www.google-analytics.com',
        ],
        styleSrc: ["'self'", "'unsafe-inline'", 'https://fonts.googleapis.com'],
        fontSrc: ["'self'", 'https://fonts.gstatic.com', 'data:'],
        imgSrc: ["'self'", 'data:', 'blob:', 'https:'],
        connectSrc: [
          "'self'",
          'https://contentflow-api-production.up.railway.app',
          'https://www.google-analytics.com',
        ],
        frameSrc: ["'self'", 'https://www.youtube.com', 'https://www.facebook.com'],
        objectSrc: ["'none'"],
        baseUri: ["'self'"],
        formAction: ["'self'"],
        upgradeInsecureRequests: config.nodeEnv === 'production' ? [] : null,
      },
    },
  })
);
// Raw body capture for Stripe webhook signature verification
app.use(express.json({ limit: '20mb', verify: (req, _res, buf) => { (req as any).rawBody = buf; } }));
app.use(express.urlencoded({ extended: true, limit: '20mb' }));

// Health check — registered first so Railway can reach it immediately on startup
app.get('/health', (_req: Request, res: Response) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});
app.get('/api/health', (_req: Request, res: Response) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// Diagnostics — admin-only so deployment internals aren't public.
app.get('/api/debug/db', async (req: Request, res: Response) => {
  const admin = await requireAdmin(req, res);
  if (!admin) return;
  res.json({
    hasDatabase: hasDatabase(),
    dbReady,
    databaseUrlConfigured: Boolean(DATABASE_URL && DATABASE_URL.trim()),
  });
});

// ── Global session-revocation guard ──────────────────────────────────────────
// Every /api request carrying a JWT has its tokenVersion checked against the DB.
// This makes logout-all-devices actually revoke access on all subsequent requests.
// Skips if no auth header (public routes) or if DB is unavailable (fail-open).
app.use('/api', async (req: Request, res: Response, next: NextFunction) => {
  if (!req.headers.authorization) return next();
  const auth = getAuthUser(req);
  if (!auth || auth.tokenVersion === null || !hasDatabase()) return next();
  try {
    const { rows } = await dbQuery<{ token_version: number }>(
      'SELECT token_version FROM users WHERE id = $1',
      [auth.userId]
    );
    if (rows[0] && rows[0].token_version !== auth.tokenVersion) {
      res.status(401).json({ success: false, error: 'Session has been revoked. Please log in again.' });
      return;
    }
  } catch (err) {
    logger.error('Unhandled error:', err);
    // DB error — fail open so a transient hiccup doesn't lock everyone out
  }
  next();
});

// Serve frontend static assets when built files are present (copied by Dockerfile)
const publicDir = path.join(__dirname, 'public');
const hasStaticFiles = existsSync(path.join(publicDir, 'index.html'));
if (hasStaticFiles) {
  app.use(
    express.static(publicDir, {
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
const REDIS_URL = config.redisUrl;
const TWITTER_MONTHLY_WRITE_LIMIT = config.twitterMonthlyWriteLimit;
const SOCIAL_TOKEN_SAFETY_MARGIN_DAYS = config.socialTokenSafetyMarginDays;
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
  } catch (err) {
    logger.error('Unhandled error:', err);
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
    logger.warn('Failed to read link metadata cache:', err);
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
    logger.warn('Failed to save link metadata cache:', err);
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
    logger.warn(`Failed to fetch link metadata for ${url}:`, err);
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
    logger.warn('Failed to record audit log:', err);
  }
}
const extraOrigins = config.frontendOrigins ?? [];

const allowedOrigins = new Set([
  config.appUrl,   // set VITE_APP_URL in env — defaults to https://marketing.dakyworld.com
  ...extraOrigins, // set FRONTEND_ORIGINS (comma-separated) for additional frontend domains
]);
if (config.nodeEnv !== 'production') {
  allowedOrigins.add('http://localhost:3000');
  allowedOrigins.add('http://localhost:3001');
  allowedOrigins.add('http://127.0.0.1:3000');
  allowedOrigins.add('http://127.0.0.1:3001');
}

let pool: Pool | null = null;
try {
  pool = DATABASE_URL ? new Pool({
    connectionString: DATABASE_URL,
    max: 20,
    connectionTimeoutMillis: 5000,
    idleTimeoutMillis: 30000,
    statement_timeout: 30000,
  }) : null;
} catch (err) {
  logger.error('Failed to create database pool, running in in-memory mode:', err);
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
    if (config.nodeEnv === 'production') {
      logger.fatal({ event: 'db_missing_in_production' }, 'DATABASE_URL is not configured. Refusing to start in production without a database.');
      process.exit(1);
    }
    logger.warn('DATABASE_URL is not set; running in in-memory mode (development only).');
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

  // token_version: increment to invalidate all sessions for a user (logout-all-devices)
  await pool.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS token_version INTEGER NOT NULL DEFAULT 1;`);
  // email_verified: set to true after the user confirms their email
  await pool.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS email_verified BOOLEAN NOT NULL DEFAULT false;`);
  // account lockout: track consecutive failures and lock after threshold
  await pool.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS failed_login_attempts INTEGER NOT NULL DEFAULT 0;`);
  await pool.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS locked_until TIMESTAMPTZ;`);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS password_reset_tokens (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      token_hash TEXT NOT NULL UNIQUE,
      expires_at TIMESTAMPTZ NOT NULL,
      used_at TIMESTAMPTZ,
      created_at TIMESTAMPTZ DEFAULT NOW()
    );
    CREATE INDEX IF NOT EXISTS pwd_reset_user_idx ON password_reset_tokens(user_id);
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS email_verification_tokens (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      token_hash TEXT NOT NULL UNIQUE,
      expires_at TIMESTAMPTZ NOT NULL,
      used_at TIMESTAMPTZ,
      created_at TIMESTAMPTZ DEFAULT NOW()
    );
    CREATE INDEX IF NOT EXISTS email_verif_user_idx ON email_verification_tokens(user_id);
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

  // ── Credits & Likes (additive migrations) ────────────────────────────────────
  await pool.query(`
    CREATE TABLE IF NOT EXISTS user_credits (
      user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
      credits INTEGER NOT NULL DEFAULT 0,
      reset_date TIMESTAMPTZ NOT NULL DEFAULT (date_trunc('month', NOW()) + INTERVAL '1 month'),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `).catch(() => undefined);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS design_likes (
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      design_id TEXT NOT NULL,
      design_type TEXT NOT NULL DEFAULT 'user',
      created_at TIMESTAMPTZ DEFAULT NOW(),
      PRIMARY KEY (user_id, design_id)
    )
  `).catch(() => undefined);

  await pool.query(`ALTER TABLE card_templates ADD COLUMN IF NOT EXISTS view_count INTEGER NOT NULL DEFAULT 0`).catch(() => undefined);
  await pool.query(`ALTER TABLE card_templates ADD COLUMN IF NOT EXISTS like_count INTEGER NOT NULL DEFAULT 0`).catch(() => undefined);
  await pool.query(`ALTER TABLE pricing_plans ADD COLUMN IF NOT EXISTS credits_per_month INTEGER NOT NULL DEFAULT 0`).catch(() => undefined);
  await pool.query(`ALTER TABLE user_designs ADD COLUMN IF NOT EXISTS like_count INTEGER NOT NULL DEFAULT 0`).catch(() => undefined);
  await pool.query(`ALTER TABLE user_designs ADD COLUMN IF NOT EXISTS media_type TEXT NOT NULL DEFAULT 'image'`).catch(() => undefined);

  // Update existing pricing plans with credit allocations (idempotent — only sets if 0)
  await pool.query(`UPDATE pricing_plans SET credits_per_month = 100  WHERE name ILIKE '%free%'    AND credits_per_month = 0`).catch(() => undefined);
  await pool.query(`UPDATE pricing_plans SET credits_per_month = 100  WHERE name ILIKE '%starter%' AND credits_per_month = 0`).catch(() => undefined);
  await pool.query(`UPDATE pricing_plans SET credits_per_month = 2000 WHERE name ILIKE '%pro%'     AND credits_per_month = 0`).catch(() => undefined);
  await pool.query(`UPDATE pricing_plans SET credits_per_month = 2000 WHERE name ILIKE '%growth%'  AND credits_per_month = 0`).catch(() => undefined);
  await pool.query(`UPDATE pricing_plans SET credits_per_month = 6000 WHERE name ILIKE '%agency%'  AND credits_per_month = 0`).catch(() => undefined);
  await pool.query(`UPDATE pricing_plans SET credits_per_month = 6000 WHERE name ILIKE '%scale%'   AND credits_per_month = 0`).catch(() => undefined);
  // ── end Credits & Likes ───────────────────────────────────────────────────────

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
    logger.warn('ai_skills seed skipped:', e);
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
      // logger.info(`Seeded ${SAMPLE_TEMPLATES.length} card templates.`);
    }
  } catch (e) {
    logger.warn('Card template seed skipped:', e);
  }

  // ─── Seed: Solo Leveling promotional poster template ──────────────────────
  try {
    const SOLO_LEVELING_ID = 'a1b2c3d4-0001-4000-8000-solo1eveling1';
    // Always upsert so a previously wrong-format row gets corrected
    {
      const now = new Date().toISOString();
      const imageUrl = 'https://d8j0ntlcm91z4.cloudfront.net/user_3DSPVF70hppaORlPqQfWVzMK0VX/hf_20260509_180211_c9c8fcf9-10fd-4e0e-9bfa-c6254a39fa8f.png';
      // Must use FabricDesignData wrapper so isFabricDesign() returns true in the frontend
      const fabricJson = {
        version: '5.3.0',
        background: '#050510',
        width: 1080,
        height: 1350,
        objects: [
          {
            type: 'image', version: '5.3.0',
            originX: 'left', originY: 'top',
            left: 0, top: 0,
            width: 1856, height: 2304,
            scaleX: 1080 / 1856, scaleY: 1350 / 2304,
            angle: 0, flipX: false, flipY: false, opacity: 1,
            fill: 'rgb(0,0,0)', stroke: null, strokeWidth: 0,
            strokeDashArray: null, strokeLineCap: 'butt', strokeDashOffset: 0,
            strokeLineJoin: 'miter', strokeUniform: false, strokeMiterLimit: 4,
            shadow: null, visible: true, backgroundColor: '',
            fillRule: 'nonzero', paintFirst: 'fill',
            globalCompositeOperation: 'source-over', skewX: 0, skewY: 0,
            cropX: 0, cropY: 0,
            src: imageUrl,
            crossOrigin: 'anonymous', filters: [],
          },
          {
            type: 'rect', version: '5.3.0',
            originX: 'left', originY: 'top',
            left: 0, top: 900, width: 1080, height: 450,
            fill: 'rgba(5,5,16,0.72)', stroke: null, strokeWidth: 0,
            strokeDashArray: null, strokeLineCap: 'butt', strokeDashOffset: 0,
            strokeLineJoin: 'miter', strokeUniform: false, strokeMiterLimit: 4,
            angle: 0, flipX: false, flipY: false, opacity: 1,
            shadow: null, visible: true, backgroundColor: '',
            fillRule: 'nonzero', paintFirst: 'fill',
            globalCompositeOperation: 'source-over', skewX: 0, skewY: 0, rx: 0, ry: 0,
          },
          {
            type: 'textbox', version: '5.3.0',
            originX: 'center', originY: 'center',
            left: 540, top: 990, width: 960,
            text: 'SOLO LEVELING',
            fontSize: 88, fontFamily: 'Inter', fontWeight: '900', fontStyle: 'normal',
            fill: '#ffffff', stroke: null, strokeWidth: 1,
            strokeDashArray: null, strokeLineCap: 'butt', strokeDashOffset: 0,
            strokeLineJoin: 'miter', strokeUniform: false, strokeMiterLimit: 4,
            angle: 0, flipX: false, flipY: false, opacity: 1,
            shadow: { color: 'rgba(120,80,255,0.7)', blur: 28, offsetX: 0, offsetY: 0 },
            visible: true, backgroundColor: '',
            fillRule: 'nonzero', paintFirst: 'fill',
            globalCompositeOperation: 'source-over', skewX: 0, skewY: 0,
            textAlign: 'center', lineHeight: 1.16, charSpacing: 320,
            styles: [], direction: 'ltr', pathStartOffset: 0,
            pathSide: 'left', pathAlign: 'baseline',
            overline: false, underline: false, linethrough: false,
            textBackgroundColor: '', splitByGrapheme: false,
          },
          {
            type: 'textbox', version: '5.3.0',
            originX: 'center', originY: 'center',
            left: 540, top: 1100, width: 760,
            text: 'ARISE',
            fontSize: 52, fontFamily: 'Inter', fontWeight: '300', fontStyle: 'italic',
            fill: '#a78bfa', stroke: null, strokeWidth: 1,
            strokeDashArray: null, strokeLineCap: 'butt', strokeDashOffset: 0,
            strokeLineJoin: 'miter', strokeUniform: false, strokeMiterLimit: 4,
            angle: 0, flipX: false, flipY: false, opacity: 1,
            shadow: { color: 'rgba(120,80,255,0.5)', blur: 18, offsetX: 0, offsetY: 0 },
            visible: true, backgroundColor: '',
            fillRule: 'nonzero', paintFirst: 'fill',
            globalCompositeOperation: 'source-over', skewX: 0, skewY: 0,
            textAlign: 'center', lineHeight: 1.16, charSpacing: 600,
            styles: [], direction: 'ltr', pathStartOffset: 0,
            pathSide: 'left', pathAlign: 'baseline',
            overline: false, underline: false, linethrough: false,
            textBackgroundColor: '', splitByGrapheme: false,
          },
          {
            type: 'textbox', version: '5.3.0',
            originX: 'center', originY: 'center',
            left: 540, top: 1280, width: 900,
            text: 'Edit your promotional text here',
            fontSize: 28, fontFamily: 'Inter', fontWeight: '400', fontStyle: 'normal',
            fill: 'rgba(200,180,255,0.7)', stroke: null, strokeWidth: 1,
            strokeDashArray: null, strokeLineCap: 'butt', strokeDashOffset: 0,
            strokeLineJoin: 'miter', strokeUniform: false, strokeMiterLimit: 4,
            angle: 0, flipX: false, flipY: false, opacity: 1,
            shadow: null, visible: true, backgroundColor: '',
            fillRule: 'nonzero', paintFirst: 'fill',
            globalCompositeOperation: 'source-over', skewX: 0, skewY: 0,
            textAlign: 'center', lineHeight: 1.4, charSpacing: 80,
            styles: [], direction: 'ltr', pathStartOffset: 0,
            pathSide: 'left', pathAlign: 'baseline',
            overline: false, underline: false, linethrough: false,
            textBackgroundColor: '', splitByGrapheme: false,
          },
        ],
      };
      const designData = {
        fabricVersion: true as const,
        canvasWidth: 1080,
        canvasHeight: 1350,
        fabricJson,
      };
      await pool.query(
        `INSERT INTO card_templates (id, name, description, design_data, cover_image_url, is_published, created_at, updated_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
         ON CONFLICT (id) DO UPDATE SET design_data = EXCLUDED.design_data, cover_image_url = EXCLUDED.cover_image_url, updated_at = EXCLUDED.updated_at`,
        [
          SOLO_LEVELING_ID,
          'Solo Leveling — Shadow Monarch',
          'Dark fantasy promotional poster (1080×1350 · 4:5 Facebook portrait). Shadow Monarch silhouette with glowing purple eyes and cinematic lighting. Generated with Higgsfield Nano Banana Pro 2K.',
          JSON.stringify(designData),
          imageUrl,
          true,
          now, now,
        ]
      );
      logger.info('Solo Leveling card template upserted.');
    }
  } catch (e) {
    logger.warn('Solo Leveling template seed skipped:', e);
  }
  // ── end Solo Leveling seed ─────────────────────────────────────────────────

  // ── Verdant Dark Studio card templates (Card 03 + Card 04) ────────────────
  try {
    const now = new Date().toISOString();
    const VBG = '#0E1F2A';
    const VACC = '#6DFF5B';
    const VINK = '#FFFFFF';
    const VMUT = '#8FA5B0';

    const mkRings = (cx: number, cy: number) =>
      [200, 350, 500, 650].map((r, i) => ({
        type: 'circle', radius: r, left: cx - r, top: cy - r,
        fill: '', stroke: `rgba(255,255,255,${(0.12 - i * 0.02).toFixed(2)})`,
        strokeWidth: 1.5, selectable: false, evented: false,
        originX: 'left', originY: 'top', scaleX: 1, scaleY: 1, angle: 0,
        opacity: 1, shadow: null, visible: true, strokeDashArray: null,
        strokeLineCap: 'butt', strokeDashOffset: 0, strokeLineJoin: 'miter',
        strokeUniform: false, strokeMiterLimit: 4, flipX: false, flipY: false,
        skewX: 0, skewY: 0, rx: 0, ry: 0,
      }));

    const mkStamp = (cx: number, cy: number, label: string) => [
      { type: 'circle', radius: 58, left: cx - 58, top: cy - 58, fill: '', stroke: VACC, strokeWidth: 2, strokeDashArray: [6, 4], selectable: false, evented: false, originX: 'left', originY: 'top', scaleX: 1, scaleY: 1, angle: 0, opacity: 1, shadow: null, visible: true, strokeLineCap: 'butt', strokeDashOffset: 0, strokeLineJoin: 'miter', strokeUniform: false, strokeMiterLimit: 4, flipX: false, flipY: false, skewX: 0, skewY: 0, rx: 0, ry: 0 },
      { type: 'circle', radius: 45, left: cx - 45, top: cy - 45, fill: VACC, stroke: VBG, strokeWidth: 6, strokeDashArray: null, selectable: false, evented: false, originX: 'left', originY: 'top', scaleX: 1, scaleY: 1, angle: 0, opacity: 1, shadow: null, visible: true, strokeLineCap: 'butt', strokeDashOffset: 0, strokeLineJoin: 'miter', strokeUniform: false, strokeMiterLimit: 4, flipX: false, flipY: false, skewX: 0, skewY: 0, rx: 0, ry: 0 },
      { type: 'textbox', text: '✦', left: cx - 20, top: cy - 18, width: 40, fontSize: 28, fontFamily: 'Arial', fontWeight: 'bold', fill: VBG, textAlign: 'center', selectable: false, evented: false, originX: 'left', originY: 'top', scaleX: 1, scaleY: 1, angle: 0, opacity: 1, shadow: null, visible: true, underline: false, overline: false, linethrough: false, charSpacing: 0, lineHeight: 1.16, splitByGrapheme: false, styles: {}, strokeWidth: 0, stroke: null, backgroundColor: '', textBackgroundColor: '' },
      { type: 'textbox', text: label, left: cx - 55, top: cy + 52, width: 110, fontSize: 10, fontFamily: 'Arial', fontWeight: 'normal', fill: VMUT, textAlign: 'center', selectable: false, evented: false, originX: 'left', originY: 'top', scaleX: 1, scaleY: 1, angle: 0, opacity: 1, shadow: null, visible: true, underline: false, overline: false, linethrough: false, charSpacing: 100, lineHeight: 1.16, splitByGrapheme: false, styles: {}, strokeWidth: 0, stroke: null, backgroundColor: '', textBackgroundColor: '' },
    ];

    const mkRect = (left: number, top: number, width: number, height: number, fill: string, extra: Record<string, unknown> = {}) => ({
      type: 'rect', left, top, width, height, fill,
      stroke: null, strokeWidth: 0, strokeDashArray: null, strokeLineCap: 'butt',
      strokeDashOffset: 0, strokeLineJoin: 'miter', strokeUniform: false, strokeMiterLimit: 4,
      selectable: false, evented: false, originX: 'left', originY: 'top',
      scaleX: 1, scaleY: 1, angle: 0, opacity: 1, shadow: null, visible: true,
      flipX: false, flipY: false, skewX: 0, skewY: 0, rx: 0, ry: 0, ...extra,
    });

    const mkText = (text: string, left: number, top: number, width: number, fontSize: number, extra: Record<string, unknown> = {}) => ({
      type: 'textbox', text, left, top, width, fontSize,
      fontFamily: 'Arial', fontWeight: 'normal', fill: VINK, textAlign: 'left',
      selectable: false, evented: false, originX: 'left', originY: 'top',
      scaleX: 1, scaleY: 1, angle: 0, opacity: 1, shadow: null, visible: true,
      underline: false, overline: false, linethrough: false,
      charSpacing: 0, lineHeight: 1.16, splitByGrapheme: false, styles: {},
      strokeWidth: 0, stroke: null, backgroundColor: '', textBackgroundColor: '', ...extra,
    });

    // ── Card 03 — Agency Hero ──────────────────────────────────────────────────
    const card03Fabric = {
      version: '5.3.0',
      background: VBG,
      objects: [
        mkRect(0, 0, 1080, 1350, VBG),
        ...mkRings(1080, 0),
        ...mkRings(0, 1350),
        // S-curve swoosh
        { type: 'path', path: [['M', 0, 680], ['C', 270, 560, 810, 800, 1080, 680]], left: 0, top: 560, fill: '', stroke: 'rgba(109,255,91,0.25)', strokeWidth: 2.5, strokeDashArray: null, strokeLineCap: 'round', strokeDashOffset: 0, strokeLineJoin: 'round', strokeUniform: false, strokeMiterLimit: 4, selectable: false, evented: false, originX: 'left', originY: 'top', scaleX: 1, scaleY: 1, angle: 0, opacity: 1, shadow: null, visible: true, flipX: false, flipY: false, skewX: 0, skewY: 0 },
        // Nav logo
        mkText('✦ VERDANT', 60, 60, 200, 20, { fontWeight: 'bold', charSpacing: 200 }),
        // Nav links
        mkText('Work    About    Services    Contact', 520, 64, 500, 15, { fill: VMUT, textAlign: 'right' }),
        // Eyebrow
        mkText('CREATIVE AGENCY', 60, 360, 400, 13, { fill: VACC, fontWeight: 'bold', charSpacing: 260 }),
        // Accent bar
        mkRect(60, 388, 60, 3, VACC),
        // Headline (lines 0 & 2 in accent)
        mkText('Custom\nDesigns,\nJust for You!', 60, 420, 700, 108, {
          fontFamily: 'Arial Black', fontWeight: 'bold', charSpacing: -20, lineHeight: 1.0,
          styles: {
            '0': { '0': { fill: VACC }, '1': { fill: VACC }, '2': { fill: VACC }, '3': { fill: VACC }, '4': { fill: VACC }, '5': { fill: VACC } },
            '2': { '0': { fill: VACC }, '1': { fill: VACC }, '2': { fill: VACC }, '3': { fill: VACC }, '4': { fill: VACC }, '5': { fill: VACC }, '6': { fill: VACC }, '7': { fill: VACC }, '8': { fill: VACC }, '9': { fill: VACC }, '10': { fill: VACC }, '11': { fill: VACC }, '12': { fill: VACC } },
          },
        }),
        // Body text
        mkText('We craft purposeful identities, digital experiences,\nand brand strategies that move people.', 60, 850, 680, 24, { fill: VMUT, lineHeight: 1.5 }),
        // CTA button
        mkRect(60, 948, 380, 64, VACC, { rx: 8, ry: 8 }),
        mkText('— Connect With Us Today', 60, 964, 380, 20, { fill: VBG, fontWeight: 'bold', textAlign: 'center' }),
        // Stamp badge mid-right
        ...mkStamp(900, 810, 'VERDANT STUDIO'),
        // Footer divider + text
        mkRect(60, 1290, 960, 1, 'rgba(255,255,255,0.15)'),
        mkText('verdant.studio  ·  @verdantagency  ·  2026', 60, 1305, 960, 13, { fill: VMUT, textAlign: 'center', charSpacing: 80 }),
      ],
    };

    // ── Card 04 — Carousel Cover ───────────────────────────────────────────────
    const card04Fabric = {
      version: '5.3.0',
      background: VBG,
      objects: [
        mkRect(0, 0, 1080, 1350, VBG),
        ...mkRings(1080, 0),
        ...mkRings(0, 1350),
        // Loop swoosh (bottom half, behind content)
        { type: 'path', path: [['M', 80, 1000], ['C', 300, 900, 700, 1150, 950, 950], ['C', 1100, 830, 1050, 1100, 900, 1200]], left: 0, top: 830, fill: '', stroke: 'rgba(109,255,91,0.20)', strokeWidth: 2, strokeDashArray: null, strokeLineCap: 'round', strokeDashOffset: 0, strokeLineJoin: 'round', strokeUniform: false, strokeMiterLimit: 4, selectable: false, evented: false, originX: 'left', originY: 'top', scaleX: 1, scaleY: 1, angle: 0, opacity: 1, shadow: null, visible: true, flipX: false, flipY: false, skewX: 0, skewY: 0 },
        // Nav logo
        mkText('✦ VERDANT', 60, 60, 200, 20, { fontWeight: 'bold', charSpacing: 200 }),
        // Nav links ("Discover" chars 11–18 in accent)
        mkText('Process    Discover    Results    Contact', 440, 64, 580, 15, {
          fill: VMUT, textAlign: 'right',
          styles: { '0': { '11': { fill: VACC }, '12': { fill: VACC }, '13': { fill: VACC }, '14': { fill: VACC }, '15': { fill: VACC }, '16': { fill: VACC }, '17': { fill: VACC }, '18': { fill: VACC } } },
        }),
        // Eyebrow
        mkText('BRAND CASE STUDY', 60, 320, 500, 13, { fill: VACC, fontWeight: 'bold', charSpacing: 260 }),
        // Accent bar
        mkRect(60, 346, 60, 3, VACC),
        // "Before" outline accent box (behind headline line 0)
        { type: 'rect', left: 58, top: 378, width: 330, height: 108, fill: '', stroke: VACC, strokeWidth: 2, strokeDashArray: null, strokeLineCap: 'butt', strokeDashOffset: 0, strokeLineJoin: 'miter', strokeUniform: false, strokeMiterLimit: 4, selectable: false, evented: false, originX: 'left', originY: 'top', scaleX: 1, scaleY: 1, angle: 0, opacity: 1, shadow: null, visible: true, flipX: false, flipY: false, skewX: 0, skewY: 0, rx: 4, ry: 4 },
        // Headline ("After" chars 0–4 on line 1 in accent)
        mkText('Before and\nAfter Brand\nTransformation', 60, 380, 800, 100, {
          fontFamily: 'Arial Black', fontWeight: 'bold', charSpacing: -20, lineHeight: 1.0,
          styles: {
            '1': { '0': { fill: VACC }, '1': { fill: VACC }, '2': { fill: VACC }, '3': { fill: VACC }, '4': { fill: VACC } },
          },
        }),
        // Body text
        mkText('See how we transformed a struggling brand\ninto a market leader in 90 days.', 60, 780, 680, 24, { fill: VMUT, lineHeight: 1.5 }),
        // Swipe pill
        { type: 'rect', left: 60, top: 870, width: 160, height: 46, fill: 'rgba(109,255,91,0.12)', stroke: VACC, strokeWidth: 1.5, strokeDashArray: null, strokeLineCap: 'butt', strokeDashOffset: 0, strokeLineJoin: 'miter', strokeUniform: false, strokeMiterLimit: 4, selectable: false, evented: false, originX: 'left', originY: 'top', scaleX: 1, scaleY: 1, angle: 0, opacity: 1, shadow: null, visible: true, flipX: false, flipY: false, skewX: 0, skewY: 0, rx: 23, ry: 23 },
        mkText('Swipe →', 60, 882, 160, 17, { fill: VACC, fontWeight: 'bold', textAlign: 'center' }),
        // Stamp badge lower-right
        ...mkStamp(920, 1080, 'CASE STUDY'),
        // Corner caption
        mkText('Brand Lessons\nfor StartUp Owners', 60, 1180, 340, 20, { fontWeight: 'bold', lineHeight: 1.3 }),
        // Footer divider + text
        mkRect(60, 1290, 960, 1, 'rgba(255,255,255,0.15)'),
        mkText('verdant.studio  ·  @verdantagency  ·  2026', 60, 1305, 960, 13, { fill: VMUT, textAlign: 'center', charSpacing: 80 }),
      ],
    };

    const c03data = { fabricVersion: true as const, canvasWidth: 1080, canvasHeight: 1350, fabricJson: card03Fabric };
    const c04data = { fabricVersion: true as const, canvasWidth: 1080, canvasHeight: 1350, fabricJson: card04Fabric };

    await pool.query(
      `INSERT INTO card_templates (id, name, description, design_data, is_published, created_at, updated_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7)
       ON CONFLICT (id) DO UPDATE SET design_data=EXCLUDED.design_data, name=EXCLUDED.name, updated_at=EXCLUDED.updated_at`,
      ['verdant03-dark-studio-agency-hero-2026', 'Verdant Dark Studio — Agency Hero', 'Dark teal + neon green agency card. Concentric rings, mixed-colour headline, S-curve swoosh, stamp badge, CTA. Fully editable.', JSON.stringify(c03data), true, now, now]
    );
    await pool.query(
      `INSERT INTO card_templates (id, name, description, design_data, is_published, created_at, updated_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7)
       ON CONFLICT (id) DO UPDATE SET design_data=EXCLUDED.design_data, name=EXCLUDED.name, updated_at=EXCLUDED.updated_at`,
      ['verdant04-dark-studio-carousel-cover-2026', 'Verdant Dark Studio — Carousel Cover', 'Before-and-after brand transformation carousel cover. Swipe pill, loop swoosh, stamp badge, accent outline box on "Before". Fully editable.', JSON.stringify(c04data), true, now, now]
    );
    logger.info('Verdant Dark Studio card templates upserted.');
  } catch (e) {
    logger.warn('Verdant Dark Studio template seed skipped:', e);
  }
  // ── end Verdant Dark Studio seed ────────────────────────────────────────────

  // ── Social Media Templates (5 editable templates) ─────────────────────────
  try {
    const now = new Date().toISOString();
    const R = (left: number, top: number, w: number, h: number, fill: string, ex: Record<string, unknown> = {}) => ({
      type: 'rect', left, top, width: w, height: h, fill,
      stroke: null, strokeWidth: 1, strokeDashArray: null, strokeLineCap: 'butt',
      strokeDashOffset: 0, strokeLineJoin: 'miter', strokeUniform: false, strokeMiterLimit: 4,
      selectable: false, evented: false, originX: 'left', originY: 'top',
      scaleX: 1, scaleY: 1, angle: 0, opacity: 1, shadow: null, visible: true,
      flipX: false, flipY: false, skewX: 0, skewY: 0, rx: 0, ry: 0, ...ex,
    });
    const T = (text: string, left: number, top: number, w: number, size: number, ex: Record<string, unknown> = {}) => ({
      type: 'textbox', text, left, top, width: w, fontSize: size,
      fontFamily: 'Arial', fontWeight: 'normal', fill: '#FFFFFF', textAlign: 'left',
      selectable: false, evented: false, originX: 'left', originY: 'top',
      scaleX: 1, scaleY: 1, angle: 0, opacity: 1, shadow: null, visible: true,
      underline: false, overline: false, linethrough: false,
      charSpacing: 0, lineHeight: 1.2, splitByGrapheme: false, styles: {},
      strokeWidth: 0, stroke: null, backgroundColor: '', textBackgroundColor: '', ...ex,
    });
    const C = (cx: number, cy: number, radius: number, ex: Record<string, unknown> = {}) => ({
      type: 'circle', radius, left: cx - radius, top: cy - radius,
      fill: '#3AE53A', stroke: null, strokeWidth: 1, strokeDashArray: null,
      strokeLineCap: 'butt', strokeDashOffset: 0, strokeLineJoin: 'miter',
      strokeUniform: false, strokeMiterLimit: 4,
      selectable: false, evented: false, originX: 'left', originY: 'top',
      scaleX: 1, scaleY: 1, angle: 0, opacity: 1, shadow: null, visible: true,
      flipX: false, flipY: false, skewX: 0, skewY: 0, ...ex,
    });
    const PT = (path: unknown[][], stroke: string, sw: number, ex: Record<string, unknown> = {}) => ({
      type: 'path', path, fill: '', stroke, strokeWidth: sw, strokeDashArray: null,
      strokeLineCap: 'round', strokeDashOffset: 0, strokeLineJoin: 'round',
      strokeUniform: false, strokeMiterLimit: 4, left: 0, top: 0,
      selectable: false, evented: false, originX: 'left', originY: 'top',
      scaleX: 1, scaleY: 1, angle: 0, opacity: 1, shadow: null, visible: true,
      flipX: false, flipY: false, skewX: 0, skewY: 0, ...ex,
    });
    const wrapFab = (json: unknown, h = 1350) => ({ fabricVersion: true as const, canvasWidth: 1080, canvasHeight: h, fabricJson: json });

    // ── 1. Finance Hero (Avante Capital style) ────────────────────────────────
    const finance_hero = {
      version: '5.3.0', background: '#0D4A2C',
      objects: [
        R(0, 0, 1080, 1350, '#0D4A2C'),
        // Photo placeholder right
        R(540, 130, 500, 620, '#0A3D22', { rx: 20, ry: 20 }),
        T('PHOTO\nAREA', 668, 390, 260, 18, { fill: '#1A6B3C', textAlign: 'center', charSpacing: 200, fontWeight: 'bold', lineHeight: 1.6 }),
        // Top header
        T('@avantecapital', 60, 52, 300, 16, { fill: 'rgba(255,255,255,0.45)', charSpacing: 50 }),
        T('consultoria financeira', 680, 52, 340, 16, { fill: 'rgba(255,255,255,0.45)', textAlign: 'right', charSpacing: 30 }),
        // White content card
        R(40, 650, 760, 620, '#FFFFFF', { rx: 24, ry: 24, stroke: null, strokeWidth: 0 }),
        // Headline inside card
        T('Seu futuro\nfinanceiro\nmais perto!', 80, 690, 620, 56, { fill: '#0D2E1A', fontFamily: 'Arial Black', fontWeight: 'bold', lineHeight: 1.05, charSpacing: -10 }),
        // Body
        T('Com planejamento e estratégia, você conquista estabilidade e realiza seus sonhos.', 80, 900, 620, 22, { fill: '#4A6B55', lineHeight: 1.55 }),
        // Gold check badge
        C(754, 860, 50, { fill: '#F5C518', stroke: '#FFFFFF', strokeWidth: 4, strokeDashArray: null }),
        T('✓', 730, 840, 48, 34, { fill: '#0D4A2C', fontWeight: 'bold', textAlign: 'center' }),
        // CTA button
        R(80, 1000, 268, 58, '#0D4A2C', { rx: 29, ry: 29, stroke: null, strokeWidth: 0 }),
        T('Saiba mais →', 80, 1017, 268, 18, { fill: '#FFFFFF', fontWeight: 'bold', textAlign: 'center' }),
        // Brand logo bottom
        T('▶  avante capital', 80, 1272, 340, 22, { fill: '#FFFFFF', fontWeight: 'bold' }),
        T('@avantecapital', 80, 1302, 340, 14, { fill: 'rgba(255,255,255,0.4)' }),
      ],
    };

    // ── 2. Creator Dark (Slyso style) ────────────────────────────────────────
    const creator_dark = {
      version: '5.3.0', background: '#0B1F18',
      objects: [
        R(0, 0, 1080, 1350, '#0B1F18'),
        // Subtle dot grid
        ...Array.from({ length: 16 }, (_, i) => C(100 + (i % 4) * 260, 100 + Math.floor(i / 4) * 320, 3, { fill: 'rgba(58,229,58,0.12)', stroke: null })),
        // Inner bordered card
        R(65, 145, 950, 1060, '#0F2A20', { rx: 28, ry: 28, stroke: 'rgba(255,255,255,0.18)', strokeWidth: 2, strokeDashArray: null }),
        // Logo circle + symbol
        C(138, 234, 30, { fill: '#3AE53A', stroke: null }),
        T('✦', 120, 217, 36, 21, { fill: '#0B1F18', fontWeight: 'bold', textAlign: 'center' }),
        T('Slyso', 182, 218, 200, 22, { fill: '#FFFFFF', fontWeight: 'bold' }),
        T('• • •', 870, 220, 110, 20, { fill: 'rgba(255,255,255,0.4)', textAlign: 'right', charSpacing: 80 }),
        T('terilapfinance.com', 740, 254, 280, 14, { fill: 'rgba(255,255,255,0.3)', textAlign: 'right' }),
        // Headline with "Creators," in accent on line 1
        T('Empowering\nCreators,\nMaximizing\nEarnings.', 110, 348, 800, 88, {
          fill: '#FFFFFF', fontFamily: 'Arial Black', fontWeight: 'bold', lineHeight: 1.05, charSpacing: -15,
          styles: { '1': { '0': { fill: '#3AE53A' }, '1': { fill: '#3AE53A' }, '2': { fill: '#3AE53A' }, '3': { fill: '#3AE53A' }, '4': { fill: '#3AE53A' }, '5': { fill: '#3AE53A' }, '6': { fill: '#3AE53A' }, '7': { fill: '#3AE53A' } } },
        }),
        // Body paragraph
        T('Provides a streamlined ecosystem where creators can manage brand partnerships, exclusive memberships, merchandise sales, and content licensing all in one place.', 110, 820, 800, 22, { fill: 'rgba(255,255,255,0.5)', lineHeight: 1.6 }),
        // Slide indicators
        R(110, 1140, 145, 4, '#FFFFFF', { rx: 2, ry: 2, stroke: null, strokeWidth: 0 }),
        R(265, 1142, 52, 2, 'rgba(255,255,255,0.25)', { rx: 1, ry: 1, stroke: null, strokeWidth: 0 }),
        R(327, 1142, 52, 2, 'rgba(255,255,255,0.25)', { rx: 1, ry: 1, stroke: null, strokeWidth: 0 }),
        R(825, 1140, 64, 4, 'rgba(255,255,255,0.25)', { rx: 2, ry: 2, stroke: null, strokeWidth: 0 }),
        R(899, 1140, 22, 4, 'rgba(255,255,255,0.25)', { rx: 2, ry: 2, stroke: null, strokeWidth: 0 }),
        R(931, 1140, 22, 4, 'rgba(255,255,255,0.25)', { rx: 2, ry: 2, stroke: null, strokeWidth: 0 }),
      ],
    };

    // ── 3. VS Comparison (Wishtree style, 1080×1080) ─────────────────────────
    const vs_comparison = {
      version: '5.3.0', background: '#39FF14',
      objects: [
        R(0, 0, 1080, 1080, '#39FF14'),
        // Black left trapezoid
        { type: 'path', path: [['M', 0, 0], ['L', 560, 0], ['L', 460, 1080], ['L', 0, 1080], ['Z']], fill: '#111111', stroke: null, strokeWidth: 0, strokeDashArray: null, strokeLineCap: 'butt', strokeDashOffset: 0, strokeLineJoin: 'miter', strokeUniform: false, strokeMiterLimit: 4, selectable: false, evented: false, originX: 'left', originY: 'top', scaleX: 1, scaleY: 1, angle: 0, opacity: 1, shadow: null, visible: true, flipX: false, flipY: false, skewX: 0, skewY: 0, left: 0, top: 0 },
        // Logo top-left
        T('W  wishtree', 40, 38, 280, 28, { fill: '#39FF14', fontWeight: 'bold' }),
        // URL top-right
        T('www.wishtreeinfosolution.com', 570, 40, 470, 18, { fill: '#111111', textAlign: 'right' }),
        // "SEO" tag (pill, rotated, neon green)
        R(490, 95, 110, 200, '#39FF14', { rx: 55, ry: 55, stroke: '#111111', strokeWidth: 3, strokeDashArray: null, angle: 0 }),
        T('SEO', 500, 148, 90, 30, { fill: '#111111', fontWeight: 'bold', textAlign: 'center' }),
        // "PPC" tag
        R(490, 735, 110, 200, '#111111', { rx: 55, ry: 55, stroke: '#39FF14', strokeWidth: 2, strokeDashArray: null, angle: 0 }),
        T('PPC', 500, 788, 90, 30, { fill: '#39FF14', fontWeight: 'bold', textAlign: 'center' }),
        // VS divider line
        R(534, 285, 2, 430, 'rgba(255,255,255,0.25)', { stroke: null, strokeWidth: 0 }),
        // VS text
        T('VS', 492, 458, 100, 38, { fill: '#FFFFFF', fontWeight: 'bold', textAlign: 'center' }),
        // Left SEO bullets
        T('• Organic Positions\n• Traffic Over Time\n• Long-Term Results\n• Ongoing Process\n• Improves Visibility\n• Free / Lower Cost', 36, 248, 430, 24, { fill: '#FFFFFF', lineHeight: 1.88 }),
        // Right PPC bullets
        T('• Paid Positions\n• Immediate Traffic\n• Immediate Results\n• One-Time Setup\n• Improves Sales\n• Only Paid', 580, 248, 460, 24, { fill: '#111111', lineHeight: 1.88 }),
        // Bottom left contact
        T('✉ info@wishtreeweb.com\n☎ +971 58 681 6054', 36, 940, 400, 18, { fill: 'rgba(255,255,255,0.55)', lineHeight: 1.7 }),
        // Bottom right social
        T('Follow us on #wishtree_dubai', 610, 982, 430, 17, { fill: '#111111', textAlign: 'right' }),
      ],
    };

    // ── 4. Feature Cards Dark (Service Points style) ──────────────────────────
    const feature_cards = {
      version: '5.3.0', background: '#0A1F18',
      objects: [
        R(0, 0, 1080, 1350, '#0A1F18'),
        // Soft arc background decoration
        PT([['M', -80, 820], ['C', 200, 620, 840, 1060, 1200, 740]], 'rgba(58,229,58,0.07)', 70, { strokeLineCap: 'round', strokeLineJoin: 'round' }),
        // Logo top-left
        C(76, 76, 26, { fill: '#3AE53A', stroke: null }),
        T('✦', 59, 59, 34, 20, { fill: '#0A1F18', fontWeight: 'bold', textAlign: 'center' }),
        T('ServicePoints', 116, 58, 280, 22, { fill: '#FFFFFF', fontWeight: 'bold' }),
        T('30 September 2024', 750, 60, 290, 17, { fill: 'rgba(255,255,255,0.35)', textAlign: 'right' }),
        // Headline
        T('What did we\nimplement?', 60, 190, 760, 92, { fill: '#FFFFFF', fontFamily: 'Arial Black', fontWeight: 'bold', lineHeight: 1.05, charSpacing: -15 }),
        // Card 1
        R(60, 500, 960, 162, 'rgba(58,229,58,0.07)', { rx: 20, ry: 20, stroke: 'rgba(58,229,58,0.18)', strokeWidth: 1, strokeDashArray: null }),
        C(120, 581, 28, { fill: '#3AE53A', stroke: null }),
        T('✓', 101, 562, 38, 24, { fill: '#0A1F18', fontWeight: 'bold', textAlign: 'center' }),
        T('Improve delivery time', 168, 544, 700, 26, { fill: '#FFFFFF', fontWeight: 'bold' }),
        T('We changed to another supplier for your underperforming product', 168, 576, 800, 21, { fill: 'rgba(255,255,255,0.45)', lineHeight: 1.4 }),
        // Card 2
        R(60, 682, 960, 162, 'rgba(58,229,58,0.07)', { rx: 20, ry: 20, stroke: 'rgba(58,229,58,0.18)', strokeWidth: 1, strokeDashArray: null }),
        C(120, 763, 28, { fill: '#3AE53A', stroke: null }),
        T('✓', 101, 744, 38, 24, { fill: '#0A1F18', fontWeight: 'bold', textAlign: 'center' }),
        T('Improve processing time', 168, 726, 700, 26, { fill: '#FFFFFF', fontWeight: 'bold' }),
        T('We changed to another supplier for your underperforming product', 168, 758, 800, 21, { fill: 'rgba(255,255,255,0.45)', lineHeight: 1.4 }),
        // Card 3
        R(60, 864, 960, 162, 'rgba(58,229,58,0.07)', { rx: 20, ry: 20, stroke: 'rgba(58,229,58,0.18)', strokeWidth: 1, strokeDashArray: null }),
        C(120, 945, 28, { fill: '#3AE53A', stroke: null }),
        T('✓', 101, 926, 38, 24, { fill: '#0A1F18', fontWeight: 'bold', textAlign: 'center' }),
        T('Improve price', 168, 908, 700, 26, { fill: '#FFFFFF', fontWeight: 'bold' }),
        T('We changed to another supplier for your underperforming product', 168, 940, 800, 21, { fill: 'rgba(255,255,255,0.45)', lineHeight: 1.4 }),
        // Mockup placeholder card (right decoration)
        R(680, 220, 360, 480, 'rgba(58,229,58,0.04)', { rx: 18, ry: 18, stroke: 'rgba(58,229,58,0.10)', strokeWidth: 1, strokeDashArray: null }),
        T('Report\nMockup', 760, 410, 200, 22, { fill: 'rgba(58,229,58,0.18)', textAlign: 'center', fontWeight: 'bold', lineHeight: 1.5 }),
        // Arrow circle button bottom-right
        C(990, 1285, 46, { fill: '', stroke: 'rgba(255,255,255,0.28)', strokeWidth: 2, strokeDashArray: null }),
        T('→', 968, 1265, 44, 30, { fill: '#FFFFFF', textAlign: 'center' }),
      ],
    };

    // ── 5. Agency Diagonal Tape (UpDraft style) ────────────────────────────────
    const agency_tape = {
      version: '5.3.0', background: '#0B1E15',
      objects: [
        R(0, 0, 1080, 1350, '#0B1E15'),
        // Tape 1
        R(-140, 318, 1440, 88, '#00E8A2', { angle: -15, rx: 0, ry: 0, stroke: null, strokeWidth: 0 }),
        T('UpDraft  ✦  Design & Product Agency  ✦  UpDraft  ✦  Design & Product Agency  ✦', -100, 342, 1380, 22, { fill: '#0B1E15', fontWeight: 'bold', charSpacing: 20, angle: -15 }),
        // Tape 2
        R(-140, 498, 1440, 88, '#00E8A2', { angle: -15, rx: 0, ry: 0, stroke: null, strokeWidth: 0 }),
        T('Open for Projects  ✦  Open for Projects  ✦  Open for Projects  ✦  Open for Projects  ✦', -100, 521, 1380, 22, { fill: '#0B1E15', fontWeight: 'bold', charSpacing: 20, angle: -15 }),
        // Tape 3
        R(-140, 678, 1440, 88, '#00E8A2', { angle: -15, rx: 0, ry: 0, stroke: null, strokeWidth: 0 }),
        T('UpDraft  ✦  Design & Product Agency  ✦  UpDraft  ✦  Design & Product Agency  ✦', -100, 701, 1380, 22, { fill: '#0B1E15', fontWeight: 'bold', charSpacing: 20, angle: -15 }),
        // Shield icon top-center
        T('⬡', 510, 108, 60, 54, { fill: '#FFFFFF', textAlign: 'center', fontWeight: 'bold' }),
        // Headline below tapes
        T('We Design\nWe Build\nWe Scale', 60, 810, 860, 112, { fill: '#FFFFFF', fontFamily: 'Arial Black', fontWeight: 'bold', lineHeight: 1.0, charSpacing: -15 }),
        // URL bottom-left
        T('updraft.agency', 60, 1276, 300, 22, { fill: 'rgba(255,255,255,0.45)' }),
        // Arrow bottom-right
        T('→', 978, 1268, 62, 38, { fill: '#00E8A2', fontWeight: 'bold', textAlign: 'center' }),
      ],
    };

    const socialTemplates = [
      { id: 'social-finance-hero-2026',      name: 'Finance — Green Hero',         desc: 'Dark forest green finance post. White content card, photo placeholder, gold check badge, CTA button. Fully editable.', data: wrapFab(finance_hero) },
      { id: 'social-creator-dark-2026',      name: 'Creator — Dark Card',          desc: 'Very dark green creator brand card with inner bordered panel. Mixed-colour headline, body text, slide indicators. Fully editable.', data: wrapFab(creator_dark) },
      { id: 'social-vs-comparison-2026',     name: 'Comparison — VS Split',        desc: '1080×1080 black + neon green diagonal split. Comparison-style with bullet lists and category label pills. Fully editable.', data: wrapFab(vs_comparison, 1080) },
      { id: 'social-feature-cards-2026',     name: 'Features — Dark Checklist',    desc: 'Dark green feature showcase. Bold headline, 3 rounded feature cards with green check circles, arrow button. Fully editable.', data: wrapFab(feature_cards) },
      { id: 'social-agency-tape-2026',       name: 'Agency — Diagonal Tape',       desc: 'Dark forest green agency poster. Three diagonal mint-green tape banners, bold 3-line headline, footer URL. Fully editable.', data: wrapFab(agency_tape) },
    ];

    for (const tmpl of socialTemplates) {
      await pool.query(
        `INSERT INTO card_templates (id, name, description, design_data, is_published, created_at, updated_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7)
         ON CONFLICT (id) DO UPDATE SET design_data=EXCLUDED.design_data, name=EXCLUDED.name, updated_at=EXCLUDED.updated_at`,
        [tmpl.id, tmpl.name, tmpl.desc, JSON.stringify(tmpl.data), true, now, now]
      );
    }
    logger.info('Social media card templates upserted (5 templates).');
  } catch (e) {
    logger.warn('Social media template seed skipped:', e);
  }
  // ── end Social Media Templates seed ────────────────────────────────────────

  // ── 10 Editable Card Templates ─────────────────────────────────────────────
  try {
    const now = new Date().toISOString();
    const _r = (l:number,t:number,w:number,h:number,fill:string,ex:Record<string,unknown>={})=>({type:'rect',left:l,top:t,width:w,height:h,fill,stroke:null,strokeWidth:1,strokeDashArray:null,strokeLineCap:'butt',strokeDashOffset:0,strokeLineJoin:'miter',strokeUniform:false,strokeMiterLimit:4,selectable:false,evented:false,originX:'left',originY:'top',scaleX:1,scaleY:1,angle:0,opacity:1,shadow:null,visible:true,flipX:false,flipY:false,skewX:0,skewY:0,rx:0,ry:0,...ex});
    const _t = (text:string,l:number,t:number,w:number,sz:number,ex:Record<string,unknown>={})=>({type:'textbox',text,left:l,top:t,width:w,fontSize:sz,fontFamily:'Arial',fontWeight:'normal',fill:'#FFFFFF',textAlign:'left',selectable:false,evented:false,originX:'left',originY:'top',scaleX:1,scaleY:1,angle:0,opacity:1,shadow:null,visible:true,underline:false,overline:false,linethrough:false,charSpacing:0,lineHeight:1.2,splitByGrapheme:false,styles:{},strokeWidth:0,stroke:null,backgroundColor:'',textBackgroundColor:'',...ex});
    const _c = (cx:number,cy:number,r:number,ex:Record<string,unknown>={})=>({type:'circle',radius:r,left:cx-r,top:cy-r,fill:'#FFFFFF',stroke:null,strokeWidth:1,strokeDashArray:null,strokeLineCap:'butt',strokeDashOffset:0,strokeLineJoin:'miter',strokeUniform:false,strokeMiterLimit:4,selectable:false,evented:false,originX:'left',originY:'top',scaleX:1,scaleY:1,angle:0,opacity:1,shadow:null,visible:true,flipX:false,flipY:false,skewX:0,skewY:0,...ex});
    const _p = (path:unknown[][],stroke:string,sw:number,ex:Record<string,unknown>={})=>({type:'path',path,fill:'',stroke,strokeWidth:sw,strokeDashArray:null,strokeLineCap:'round',strokeDashOffset:0,strokeLineJoin:'round',strokeUniform:false,strokeMiterLimit:4,left:0,top:0,selectable:false,evented:false,originX:'left',originY:'top',scaleX:1,scaleY:1,angle:0,opacity:1,shadow:null,visible:true,flipX:false,flipY:false,skewX:0,skewY:0,...ex});
    const _w=(j:unknown,h=1350)=>({fabricVersion:true as const,canvasWidth:1080,canvasHeight:h,fabricJson:j});

    // ── T1: Finance — Dark Hero ───────────────────────────────────────────────
    const t01={version:'5.3.0',background:'#0D4A2C',objects:[
      _r(0,0,1080,1350,'#0D4A2C'),
      _r(560,120,480,700,'#0A3D22',{rx:20,ry:20}),
      _t('PHOTO AREA',650,430,280,18,{fill:'#1A6B3C',textAlign:'center',fontWeight:'bold',charSpacing:200}),
      _t('@yourbrand',60,52,260,15,{fill:'rgba(255,255,255,0.45)',charSpacing:80}),
      _t('financial consulting',720,52,300,15,{fill:'rgba(255,255,255,0.4)',textAlign:'right'}),
      _r(40,850,720,440,'#FFFFFF',{rx:24,ry:24,stroke:null,strokeWidth:0}),
      _t('Seu futuro\nfinanceiro\nmais perto!',80,892,640,52,{fill:'#0D2E1A',fontFamily:'Arial Black',fontWeight:'bold',lineHeight:1.05,charSpacing:-10}),
      _t('Com planejamento e estratégia, você conquista estabilidade e realiza seus sonhos.',80,1072,640,20,{fill:'#4A6B55',lineHeight:1.55}),
      _c(722,910,44,{fill:'#F5C518',stroke:'#FFFFFF',strokeWidth:4,strokeDashArray:null}),
      _t('✓',700,891,44,32,{fill:'#0D4A2C',fontWeight:'bold',textAlign:'center'}),
      _r(80,1150,250,54,'#0D4A2C',{rx:27,ry:27,stroke:null,strokeWidth:0}),
      _t('Saiba mais →',80,1164,250,17,{fill:'#FFFFFF',fontWeight:'bold',textAlign:'center'}),
      _t('▶  avante capital',80,1298,300,20,{fill:'#FFFFFF',fontWeight:'bold'}),
    ]};

    // ── T2: Finance — Financial Freedom (Light BG) ────────────────────────────
    const t02={version:'5.3.0',background:'#F5F0E8',objects:[
      _r(0,0,1080,1350,'#F5F0E8'),
      _p([['M',0,0],['L',1080,0],['L',1080,700],['L',0,900],['Z']],'',0,{fill:'#0D4A2C',stroke:null}),
      _t('@yourbrand',60,48,240,15,{fill:'rgba(255,255,255,0.6)',charSpacing:80}),
      _t('financial consulting',720,48,300,15,{fill:'rgba(255,255,255,0.55)',textAlign:'right'}),
      _r(60,180,180,36,'#F5C518',{rx:18,ry:18,stroke:null,strokeWidth:0}),
      _t('DESTAQUE',68,189,164,14,{fill:'#0D4A2C',fontWeight:'bold',textAlign:'center',charSpacing:150}),
      _t('Independência\nfinanceira\nao seu alcance!',60,250,820,96,{fill:'#FFFFFF',fontFamily:'Arial Black',fontWeight:'bold',lineHeight:1.0,charSpacing:-15}),
      _t('Comece agora a construir um patrimônio sólido\ne seguro para o futuro.',60,560,680,24,{fill:'rgba(255,255,255,0.75)',lineHeight:1.55}),
      _r(60,900,820,360,'#FFFFFF',{rx:24,ry:24,stroke:null,strokeWidth:0}),
      _t('Comece agora a construir um patrimônio sólido e seguro para o futuro. Nossa equipe está pronta para te ajudar.',100,940,740,22,{fill:'#0D2E1A',lineHeight:1.6}),
      _t('▶  avante capital',100,1180,280,22,{fill:'#0D4A2C',fontWeight:'bold'}),
      _t('consultoria financeira',100,1210,360,15,{fill:'#4A6B55'}),
    ]};

    // ── T3: Finance — Smart Money Bold ────────────────────────────────────────
    const t03={version:'5.3.0',background:'#0D4A2C',objects:[
      _r(0,0,1080,1350,'#0D4A2C'),
      _r(0,0,1080,1350,'rgba(0,50,20,0.4)',{angle:0}),
      _t('@yourbrand',60,52,260,15,{fill:'rgba(255,255,255,0.45)',charSpacing:80}),
      _t('financial consulting',720,52,300,15,{fill:'rgba(255,255,255,0.4)',textAlign:'right'}),
      _r(60,220,8,180,'#F5C518',{rx:4,ry:4,stroke:null,strokeWidth:0}),
      _t('Seu dinheiro\nmerece uma\ngestão\ninteligente!',90,220,820,96,{fill:'#FFFFFF',fontFamily:'Arial Black',fontWeight:'bold',lineHeight:1.0,charSpacing:-15,
        styles:{'1':{'0':{fill:'#F5C518'},'1':{fill:'#F5C518'},'2':{fill:'#F5C518'},'3':{fill:'#F5C518'},'4':{fill:'#F5C518'},'5':{fill:'#F5C518'}}}}),
      _r(60,660,960,3,'rgba(255,255,255,0.15)',{stroke:null,strokeWidth:0}),
      _r(60,700,820,200,'rgba(255,255,255,0.06)',{rx:20,ry:20,stroke:'rgba(255,255,255,0.1)',strokeWidth:1,strokeDashArray:null}),
      _t('Controle, organize e multiplique seus recursos com um planejamento eficiente. Nossa consultoria te guia em cada passo.',100,730,740,22,{fill:'rgba(255,255,255,0.75)',lineHeight:1.6}),
      _t('▶  avante capital',60,1300,300,20,{fill:'#F5C518',fontWeight:'bold'}),
    ]};

    // ── T4: Finance — Business Question Card ─────────────────────────────────
    const t04={version:'5.3.0',background:'#F0EDE4',objects:[
      _r(0,0,1080,1350,'#F0EDE4'),
      _r(0,0,1080,1350,'rgba(13,74,44,0.04)'),
      _t('@yourbrand',60,52,260,15,{fill:'rgba(13,46,26,0.4)',charSpacing:80}),
      _t('financial consulting',720,52,300,15,{fill:'rgba(13,46,26,0.35)',textAlign:'right'}),
      _r(60,160,960,880,'#FFFFFF',{rx:28,ry:28,stroke:'rgba(13,74,44,0.08)',strokeWidth:1,strokeDashArray:null}),
      _t('MEI, Simples\nNacional ou\nLucro\nPresumido?',100,220,760,76,{fill:'#0D2E1A',fontFamily:'Arial Black',fontWeight:'bold',lineHeight:1.05,charSpacing:-10}),
      _r(100,590,56,56,'#F5C518',{rx:28,ry:28,stroke:null,strokeWidth:0}),
      _t('▼',100,600,56,28,{fill:'#0D4A2C',fontWeight:'bold',textAlign:'center'}),
      _r(100,680,760,290,'rgba(13,74,44,0.04)',{rx:16,ry:16,stroke:'rgba(13,74,44,0.08)',strokeWidth:1,strokeDashArray:null}),
      _t('Escolher o regime tributário certo pode fazer toda a diferença nos seus ganhos. Fale com um especialista.',140,710,690,22,{fill:'#4A6B55',lineHeight:1.6}),
      _t('▶  avante capital',100,1090,280,22,{fill:'#0D4A2C',fontWeight:'bold'}),
      _t('consultoria financeira',100,1122,360,15,{fill:'rgba(13,46,26,0.4)'}),
    ]};

    // ── T5: Finance — CTA / Formalize ────────────────────────────────────────
    const t05={version:'5.3.0',background:'#0D4A2C',objects:[
      _r(0,0,1080,1350,'#0D4A2C'),
      _p([['M',600,0],['C',800,200,1100,100,1080,400],['L',1080,0],['Z']],'',0,{fill:'rgba(255,255,255,0.04)',stroke:null}),
      _t('@yourbrand',60,52,260,15,{fill:'rgba(255,255,255,0.45)',charSpacing:80}),
      _t('financial consulting',720,52,300,15,{fill:'rgba(255,255,255,0.4)',textAlign:'right'}),
      _r(60,200,60,60,'#F5C518',{rx:30,ry:30,stroke:null,strokeWidth:0}),
      _t('▶',60,213,60,30,{fill:'#0D4A2C',fontWeight:'bold',textAlign:'center'}),
      _t('Formalize seu\nnegócio com\nsegurança!',60,290,820,96,{fill:'#FFFFFF',fontFamily:'Arial Black',fontWeight:'bold',lineHeight:1.0,charSpacing:-15}),
      _t('A nossa consultoria cuida de toda a burocracia para você focar no crescimento da sua empresa.',60,610,760,24,{fill:'rgba(255,255,255,0.72)',lineHeight:1.55}),
      _r(60,720,320,3,'rgba(255,255,255,0.2)',{stroke:null,strokeWidth:0}),
      _r(60,760,280,62,'#F5C518',{rx:31,ry:31,stroke:null,strokeWidth:0}),
      _t('Saiba mais',60,776,280,20,{fill:'#0D4A2C',fontWeight:'bold',textAlign:'center'}),
      _t('▶  avante capital',60,1300,300,20,{fill:'#FFFFFF',fontWeight:'bold'}),
    ]};

    // ── T6: Creator — Inner Card Dark ─────────────────────────────────────────
    const t06={version:'5.3.0',background:'#0B1F18',objects:[
      _r(0,0,1080,1350,'#0B1F18'),
      _r(70,140,940,1060,'#0F2A1E',{rx:28,ry:28,stroke:'rgba(255,255,255,0.15)',strokeWidth:2,strokeDashArray:null}),
      _c(138,232,28,{fill:'#3AE53A',stroke:null}),
      _t('✦',121,215,34,20,{fill:'#0B1F18',fontWeight:'bold',textAlign:'center'}),
      _t('YourBrand',184,216,240,22,{fill:'#FFFFFF',fontWeight:'bold'}),
      _t('• • •',868,218,108,20,{fill:'rgba(255,255,255,0.4)',textAlign:'right',charSpacing:80}),
      _t('yourbrand.com',740,252,278,14,{fill:'rgba(255,255,255,0.28)',textAlign:'right'}),
      _t('Empowering\nCreators,\nMaximizing\nEarnings.',110,345,800,88,{fill:'#FFFFFF',fontFamily:'Arial Black',fontWeight:'bold',lineHeight:1.05,charSpacing:-15,
        styles:{'1':{'0':{fill:'#3AE53A'},'1':{fill:'#3AE53A'},'2':{fill:'#3AE53A'},'3':{fill:'#3AE53A'},'4':{fill:'#3AE53A'},'5':{fill:'#3AE53A'},'6':{fill:'#3AE53A'},'7':{fill:'#3AE53A'}}}}),
      _t('Provides a streamlined ecosystem where creators can manage brand partnerships, exclusive memberships, and content licensing — all in one place.',110,820,800,22,{fill:'rgba(255,255,255,0.48)',lineHeight:1.6}),
      _r(110,1138,148,4,'#FFFFFF',{rx:2,ry:2,stroke:null,strokeWidth:0}),
      _r(268,1140,54,2,'rgba(255,255,255,0.22)',{rx:1,ry:1,stroke:null,strokeWidth:0}),
      _r(332,1140,54,2,'rgba(255,255,255,0.22)',{rx:1,ry:1,stroke:null,strokeWidth:0}),
      _r(826,1138,66,4,'rgba(255,255,255,0.22)',{rx:2,ry:2,stroke:null,strokeWidth:0}),
      _r(902,1138,24,4,'rgba(255,255,255,0.22)',{rx:2,ry:2,stroke:null,strokeWidth:0}),
    ]};

    // ── T7: Stats Showcase — Big Number ──────────────────────────────────────
    const t07={version:'5.3.0',background:'#0A1A12',objects:[
      _r(0,0,1080,1350,'#0A1A12'),
      _p([['M',0,600],['C',300,400,780,800,1080,600]],'rgba(58,229,58,0.12)',80,{strokeLineCap:'round',strokeLineJoin:'round'}),
      _t('@yourbrand',60,52,260,15,{fill:'rgba(255,255,255,0.4)',charSpacing:80}),
      _t('brand.com',780,52,260,15,{fill:'rgba(255,255,255,0.35)',textAlign:'right'}),
      _t('DID YOU\nKNOW?',60,200,700,22,{fill:'#3AE53A',fontWeight:'bold',charSpacing:300,lineHeight:1.4}),
      _t('%70',60,320,800,260,{fill:'#FFFFFF',fontFamily:'Arial Black',fontWeight:'bold',charSpacing:-30,lineHeight:1.0}),
      _t('of businesses that invest in financial\nplanning grow 3× faster in 5 years.',60,620,760,28,{fill:'rgba(255,255,255,0.65)',lineHeight:1.5}),
      _r(60,730,960,2,'rgba(58,229,58,0.2)',{stroke:null,strokeWidth:0}),
      _r(60,770,280,100,'rgba(58,229,58,0.08)',{rx:16,ry:16,stroke:'rgba(58,229,58,0.2)',strokeWidth:1,strokeDashArray:null}),
      _t('3× Growth',80,800,240,22,{fill:'#3AE53A',fontWeight:'bold',textAlign:'center'}),
      _r(380,770,280,100,'rgba(58,229,58,0.08)',{rx:16,ry:16,stroke:'rgba(58,229,58,0.2)',strokeWidth:1,strokeDashArray:null}),
      _t('5 Year Plan',400,800,240,22,{fill:'#3AE53A',fontWeight:'bold',textAlign:'center'}),
      _r(700,770,280,100,'rgba(58,229,58,0.08)',{rx:16,ry:16,stroke:'rgba(58,229,58,0.2)',strokeWidth:1,strokeDashArray:null}),
      _t('Proven ROI',720,800,240,22,{fill:'#3AE53A',fontWeight:'bold',textAlign:'center'}),
      _t('Source: Global Business Finance Report 2024',60,1298,960,14,{fill:'rgba(255,255,255,0.3)',textAlign:'center'}),
    ]};

    // ── T8: VS Comparison Split (1080×1080) ───────────────────────────────────
    const t08={version:'5.3.0',background:'#39FF14',objects:[
      _r(0,0,1080,1080,'#39FF14'),
      {type:'path',path:[['M',0,0],['L',560,0],['L',460,1080],['L',0,1080],['Z']],fill:'#111111',stroke:null,strokeWidth:0,strokeDashArray:null,strokeLineCap:'butt',strokeDashOffset:0,strokeLineJoin:'miter',strokeUniform:false,strokeMiterLimit:4,selectable:false,evented:false,originX:'left',originY:'top',scaleX:1,scaleY:1,angle:0,opacity:1,shadow:null,visible:true,flipX:false,flipY:false,skewX:0,skewY:0,left:0,top:0},
      _t('W yourbrand',40,38,260,26,{fill:'#39FF14',fontWeight:'bold'}),
      _t('www.yourbrand.com',600,40,440,17,{fill:'#111111',textAlign:'right'}),
      _r(490,90,112,210,'#39FF14',{rx:56,ry:56,stroke:'#111111',strokeWidth:3,strokeDashArray:null}),
      _t('SEO',494,148,104,30,{fill:'#111111',fontWeight:'bold',textAlign:'center'}),
      _r(490,730,112,210,'#111111',{rx:56,ry:56,stroke:'#39FF14',strokeWidth:2,strokeDashArray:null}),
      _t('PPC',494,788,104,30,{fill:'#39FF14',fontWeight:'bold',textAlign:'center'}),
      _r(535,295,2,420,'rgba(255,255,255,0.2)',{stroke:null,strokeWidth:0}),
      _t('VS',490,450,102,38,{fill:'#FFFFFF',fontWeight:'bold',textAlign:'center'}),
      _t('• Organic Positions\n• Traffic Over Time\n• Long-Term Results\n• Ongoing Process\n• Improves Visibility\n• Free / Lower Cost',36,252,420,24,{fill:'#FFFFFF',lineHeight:1.88}),
      _t('• Paid Positions\n• Immediate Traffic\n• Immediate Results\n• One-Time Setup\n• Improves Sales\n• Only Paid',588,252,450,24,{fill:'#111111',lineHeight:1.88}),
      _t('✉ info@yourbrand.com\n☎ +971 00 000 0000',36,942,380,18,{fill:'rgba(255,255,255,0.5)',lineHeight:1.7}),
      _t('Follow us @yourbrand',610,982,430,17,{fill:'#111111',textAlign:'right'}),
    ]};

    // ── T9: Feature Checklist Dark ────────────────────────────────────────────
    const t09={version:'5.3.0',background:'#0A1F18',objects:[
      _r(0,0,1080,1350,'#0A1F18'),
      _p([['M',-80,820],['C',220,630,860,1060,1200,750]],'rgba(58,229,58,0.07)',70,{strokeLineCap:'round',strokeLineJoin:'round'}),
      _c(76,76,26,{fill:'#3AE53A',stroke:null}),
      _t('✦',59,59,34,20,{fill:'#0A1F18',fontWeight:'bold',textAlign:'center'}),
      _t('YourBrand',116,58,280,22,{fill:'#FFFFFF',fontWeight:'bold'}),
      _t('30 September 2024',750,60,290,17,{fill:'rgba(255,255,255,0.3)',textAlign:'right'}),
      _t('What did we\nimplement?',60,195,760,88,{fill:'#FFFFFF',fontFamily:'Arial Black',fontWeight:'bold',lineHeight:1.05,charSpacing:-15}),
      _r(60,500,960,158,'rgba(58,229,58,0.07)',{rx:20,ry:20,stroke:'rgba(58,229,58,0.16)',strokeWidth:1,strokeDashArray:null}),
      _c(120,579,28,{fill:'#3AE53A',stroke:null}),
      _t('✓',102,561,36,22,{fill:'#0A1F18',fontWeight:'bold',textAlign:'center'}),
      _t('Improve delivery time',168,542,660,26,{fill:'#FFFFFF',fontWeight:'bold'}),
      _t('We changed to another supplier for your underperforming product.',168,574,780,21,{fill:'rgba(255,255,255,0.44)',lineHeight:1.4}),
      _r(60,678,960,158,'rgba(58,229,58,0.07)',{rx:20,ry:20,stroke:'rgba(58,229,58,0.16)',strokeWidth:1,strokeDashArray:null}),
      _c(120,757,28,{fill:'#3AE53A',stroke:null}),
      _t('✓',102,739,36,22,{fill:'#0A1F18',fontWeight:'bold',textAlign:'center'}),
      _t('Improve processing time',168,720,660,26,{fill:'#FFFFFF',fontWeight:'bold'}),
      _t('We changed to another supplier for your underperforming product.',168,752,780,21,{fill:'rgba(255,255,255,0.44)',lineHeight:1.4}),
      _r(60,856,960,158,'rgba(58,229,58,0.07)',{rx:20,ry:20,stroke:'rgba(58,229,58,0.16)',strokeWidth:1,strokeDashArray:null}),
      _c(120,935,28,{fill:'#3AE53A',stroke:null}),
      _t('✓',102,917,36,22,{fill:'#0A1F18',fontWeight:'bold',textAlign:'center'}),
      _t('Improve price & margins',168,898,660,26,{fill:'#FFFFFF',fontWeight:'bold'}),
      _t('We changed to another supplier for your underperforming product.',168,930,780,21,{fill:'rgba(255,255,255,0.44)',lineHeight:1.4}),
      _c(990,1285,46,{fill:'',stroke:'rgba(255,255,255,0.25)',strokeWidth:2,strokeDashArray:null}),
      _t('→',968,1265,44,28,{fill:'#FFFFFF',textAlign:'center'}),
    ]};

    // ── T10: Agency — Diagonal Tape ───────────────────────────────────────────
    const t10={version:'5.3.0',background:'#0B1E15',objects:[
      _r(0,0,1080,1350,'#0B1E15'),
      _r(-140,320,1440,90,'#00E8A2',{angle:-15,rx:0,ry:0,stroke:null,strokeWidth:0}),
      _t('YourAgency  ✦  Design & Product Agency  ✦  YourAgency  ✦  Design & Products',-96,342,1380,22,{fill:'#0B1E15',fontWeight:'bold',charSpacing:18,angle:-15}),
      _r(-140,502,1440,90,'#00E8A2',{angle:-15,rx:0,ry:0,stroke:null,strokeWidth:0}),
      _t('Open for Projects  ✦  Open for Projects  ✦  Open for Projects  ✦  Open',-96,524,1380,22,{fill:'#0B1E15',fontWeight:'bold',charSpacing:18,angle:-15}),
      _r(-140,684,1440,90,'#00E8A2',{angle:-15,rx:0,ry:0,stroke:null,strokeWidth:0}),
      _t('YourAgency  ✦  Design & Product Agency  ✦  YourAgency  ✦  Design & Products',-96,706,1380,22,{fill:'#0B1E15',fontWeight:'bold',charSpacing:18,angle:-15}),
      _t('⬡',510,112,62,56,{fill:'#FFFFFF',textAlign:'center',fontWeight:'bold'}),
      _t('We Design\nWe Build\nWe Scale',60,810,880,112,{fill:'#FFFFFF',fontFamily:'Arial Black',fontWeight:'bold',lineHeight:1.0,charSpacing:-15}),
      _t('youragency.com',60,1278,300,22,{fill:'rgba(255,255,255,0.42)'}),
      _t('→',978,1270,62,38,{fill:'#00E8A2',fontWeight:'bold',textAlign:'center'}),
    ]};

    const ten = [
      {id:'tpl-finance-hero-v3',         name:'Finance — Dark Hero',            desc:'Dark forest green with white content card, photo area placeholder, gold badge, and CTA button.', data:_w(t01)},
      {id:'tpl-finance-freedom-v3',      name:'Finance — Financial Freedom',    desc:'Light cream background with dark green diagonal sweep, bold headline, and content panel.', data:_w(t02)},
      {id:'tpl-finance-smart-v3',        name:'Finance — Smart Money Bold',     desc:'Dark green with large mixed-colour bold headline, accent side bar, and body quote box.', data:_w(t03)},
      {id:'tpl-finance-question-v3',     name:'Finance — Business Question',    desc:'Light cream background with floating white card, bold question headline, and icon badge.', data:_w(t04)},
      {id:'tpl-finance-cta-v3',          name:'Finance — Formalize CTA',        desc:'Dark green with bold white headline, yellow arrow badge, CTA button, and brand footer.', data:_w(t05)},
      {id:'tpl-creator-inner-card-v3',   name:'Creator — Dark Inner Card',      desc:'Very dark green with inner bordered card panel, accent-colour headline word, slide indicators.', data:_w(t06)},
      {id:'tpl-stats-big-number-v3',     name:'Stats — Big Number Showcase',    desc:'Dark background with large %70 stat, three metric chips, and supporting body text.', data:_w(t07)},
      {id:'tpl-comparison-split-v3',     name:'Comparison — VS Split',          desc:'1080×1080 black + neon green diagonal split. SEO vs PPC comparison with bullet lists.', data:_w(t08,1080)},
      {id:'tpl-feature-checklist-v3',    name:'Features — Dark Checklist',      desc:'Dark green with bold headline, three rounded feature rows with green check circles.', data:_w(t09)},
      {id:'tpl-agency-tape-v3',          name:'Agency — Diagonal Tape',         desc:'Dark green with three diagonal mint tape banners, bold 3-line headline, footer URL.', data:_w(t10)},
    ];
    for(const tmpl of ten){
      await pool.query(
        `INSERT INTO card_templates(id,name,description,design_data,is_published,created_at,updated_at)
         VALUES($1,$2,$3,$4,$5,$6,$7)
         ON CONFLICT(id) DO UPDATE SET design_data=EXCLUDED.design_data,name=EXCLUDED.name,updated_at=EXCLUDED.updated_at`,
        [tmpl.id,tmpl.name,tmpl.desc,JSON.stringify(tmpl.data),true,now,now]
      );
    }
    logger.info('10 editable card templates upserted.');
  } catch(e){ logger.warn('10 templates seed skipped:',e); }
  // ── end 10 Editable Card Templates ─────────────────────────────────────────

  // ── UpDraft Agency Tape poster template ────────────────────────────────────
  try {
    const now = new Date().toISOString();
    const UPDRAFT_ID = 'updraft-agency-tape-poster-2026';
    const imageUrl = 'https://d8j0ntlcm91z4.cloudfront.net/user_3DSPVF70hppaORlPqQfWVzMK0VX/hf_20260509_203119_2849b11d-891a-4b0e-9837-cb67927f4904.png';
    const fabricJson = {
      version: '5.3.0',
      background: '#07120E',
      width: 1080,
      height: 1350,
      objects: [
        // Full-bleed background image
        {
          type: 'image', version: '5.3.0',
          originX: 'left', originY: 'top',
          left: 0, top: 0,
          width: 928, height: 1152,
          scaleX: 1080 / 928, scaleY: 1350 / 1152,
          angle: 0, flipX: false, flipY: false, opacity: 1,
          fill: 'rgb(0,0,0)', stroke: null, strokeWidth: 0,
          strokeDashArray: null, strokeLineCap: 'butt', strokeDashOffset: 0,
          strokeLineJoin: 'miter', strokeUniform: false, strokeMiterLimit: 4,
          shadow: null, visible: true, backgroundColor: '',
          fillRule: 'nonzero', paintFirst: 'fill',
          globalCompositeOperation: 'source-over', skewX: 0, skewY: 0,
          cropX: 0, cropY: 0,
          src: imageUrl,
          crossOrigin: 'anonymous', filters: [],
        },
        // Editable headline overlay (users can change the three lines)
        {
          type: 'textbox', version: '5.3.0',
          originX: 'left', originY: 'top',
          left: 64, top: 490, width: 900,
          text: 'We Design\nWe Build\nWe Scale',
          fontSize: 120, fontFamily: 'Inter', fontWeight: '800', fontStyle: 'normal',
          fill: '#DFFFEC', stroke: null, strokeWidth: 0,
          strokeDashArray: null, strokeLineCap: 'butt', strokeDashOffset: 0,
          strokeLineJoin: 'miter', strokeUniform: false, strokeMiterLimit: 4,
          angle: 0, flipX: false, flipY: false, opacity: 0,
          shadow: null, visible: true, backgroundColor: '',
          fillRule: 'nonzero', paintFirst: 'fill',
          globalCompositeOperation: 'source-over', skewX: 0, skewY: 0,
          textAlign: 'left', lineHeight: 0.96, charSpacing: -20,
          styles: [], direction: 'ltr', pathStartOffset: 0,
          pathSide: 'left', pathAlign: 'baseline',
          overline: false, underline: false, linethrough: false,
          textBackgroundColor: '', splitByGrapheme: false,
        },
        // Brand name (editable)
        {
          type: 'textbox', version: '5.3.0',
          originX: 'left', originY: 'top',
          left: 64, top: 1290, width: 600,
          text: 'updraft.agency',
          fontSize: 28, fontFamily: 'Inter', fontWeight: '500', fontStyle: 'normal',
          fill: '#DFFFEC', stroke: null, strokeWidth: 0,
          strokeDashArray: null, strokeLineCap: 'butt', strokeDashOffset: 0,
          strokeLineJoin: 'miter', strokeUniform: false, strokeMiterLimit: 4,
          angle: 0, flipX: false, flipY: false, opacity: 0,
          shadow: null, visible: true, backgroundColor: '',
          fillRule: 'nonzero', paintFirst: 'fill',
          globalCompositeOperation: 'source-over', skewX: 0, skewY: 0,
          textAlign: 'left', lineHeight: 1.2, charSpacing: 0,
          styles: [], direction: 'ltr', pathStartOffset: 0,
          pathSide: 'left', pathAlign: 'baseline',
          overline: false, underline: false, linethrough: false,
          textBackgroundColor: '', splitByGrapheme: false,
        },
      ],
    };
    const designData = { fabricVersion: true as const, canvasWidth: 1080, canvasHeight: 1350, fabricJson };
    await pool.query(
      `INSERT INTO card_templates (id, name, description, design_data, cover_image_url, is_published, created_at, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
       ON CONFLICT (id) DO UPDATE SET design_data=EXCLUDED.design_data, cover_image_url=EXCLUDED.cover_image_url, updated_at=EXCLUDED.updated_at`,
      [
        UPDRAFT_ID,
        'UpDraft — Agency Tape Poster',
        'Brutalist vinyl-tape agency poster (1080×1350). Deep green palette with neon #2BE38B tape bands, bold headline, and editorial layout. Open in canvas to customise headline and brand name.',
        JSON.stringify(designData),
        imageUrl,
        true,
        now, now,
      ]
    );
    logger.info('UpDraft Agency Tape template upserted.');
  } catch (e) { logger.warn('UpDraft template seed skipped:', e); }
  // ── end UpDraft Agency Tape seed ────────────────────────────────────────────

  // ── arcgraphix Before/After carousel cover template ───────────────────────
  try {
    const now = new Date().toISOString();
    const ARCGRAPHIX_ID = 'arcgraphix-before-after-carousel-2026';
    const imageUrl = 'https://d8j0ntlcm91z4.cloudfront.net/user_3DSPVF70hppaORlPqQfWVzMK0VX/hf_20260509_203530_37c2b6b3-c838-4a5f-b57e-b0bd335ad9c7.png';
    const fabricJson = {
      version: '5.3.0',
      background: '#0B1B2A',
      width: 1080,
      height: 1350,
      objects: [
        // Full-bleed background image
        {
          type: 'image', version: '5.3.0',
          originX: 'left', originY: 'top',
          left: 0, top: 0,
          width: 928, height: 1152,
          scaleX: 1080 / 928, scaleY: 1350 / 1152,
          angle: 0, flipX: false, flipY: false, opacity: 1,
          fill: 'rgb(0,0,0)', stroke: null, strokeWidth: 0,
          strokeDashArray: null, strokeLineCap: 'butt', strokeDashOffset: 0,
          strokeLineJoin: 'miter', strokeUniform: false, strokeMiterLimit: 4,
          shadow: null, visible: true, backgroundColor: '',
          fillRule: 'nonzero', paintFirst: 'fill',
          globalCompositeOperation: 'source-over', skewX: 0, skewY: 0,
          cropX: 0, cropY: 0,
          src: imageUrl,
          crossOrigin: 'anonymous', filters: [],
        },
        // Editable headline
        {
          type: 'textbox', version: '5.3.0',
          originX: 'left', originY: 'top',
          left: 64, top: 340, width: 950,
          text: 'Before and\nAfter Brand\nTransformation',
          fontSize: 110, fontFamily: 'Inter', fontWeight: '800', fontStyle: 'normal',
          fill: '#ffffff', stroke: null, strokeWidth: 0,
          strokeDashArray: null, strokeLineCap: 'butt', strokeDashOffset: 0,
          strokeLineJoin: 'miter', strokeUniform: false, strokeMiterLimit: 4,
          angle: 0, flipX: false, flipY: false, opacity: 0,
          shadow: null, visible: true, backgroundColor: '',
          fillRule: 'nonzero', paintFirst: 'fill',
          globalCompositeOperation: 'source-over', skewX: 0, skewY: 0,
          textAlign: 'left', lineHeight: 1.0, charSpacing: -30,
          styles: [], direction: 'ltr', pathStartOffset: 0,
          pathSide: 'left', pathAlign: 'baseline',
          overline: false, underline: false, linethrough: false,
          textBackgroundColor: '', splitByGrapheme: false,
        },
        // Editable body copy
        {
          type: 'textbox', version: '5.3.0',
          originX: 'left', originY: 'top',
          left: 64, top: 910, width: 780,
          text: 'This is how I helped Venyls Feast transform their look from confusing & outdated to clean, professional, and consistent.',
          fontSize: 26, fontFamily: 'Inter', fontWeight: '400', fontStyle: 'normal',
          fill: '#B7C2CD', stroke: null, strokeWidth: 0,
          strokeDashArray: null, strokeLineCap: 'butt', strokeDashOffset: 0,
          strokeLineJoin: 'miter', strokeUniform: false, strokeMiterLimit: 4,
          angle: 0, flipX: false, flipY: false, opacity: 0,
          shadow: null, visible: true, backgroundColor: '',
          fillRule: 'nonzero', paintFirst: 'fill',
          globalCompositeOperation: 'source-over', skewX: 0, skewY: 0,
          textAlign: 'left', lineHeight: 1.45, charSpacing: 0,
          styles: [], direction: 'ltr', pathStartOffset: 0,
          pathSide: 'left', pathAlign: 'baseline',
          overline: false, underline: false, linethrough: false,
          textBackgroundColor: '', splitByGrapheme: false,
        },
        // Handle / footer
        {
          type: 'textbox', version: '5.3.0',
          originX: 'left', originY: 'top',
          left: 64, top: 1290, width: 400,
          text: '@arcgraphix',
          fontSize: 24, fontFamily: 'Inter', fontWeight: '500', fontStyle: 'normal',
          fill: '#B7C2CD', stroke: null, strokeWidth: 0,
          strokeDashArray: null, strokeLineCap: 'butt', strokeDashOffset: 0,
          strokeLineJoin: 'miter', strokeUniform: false, strokeMiterLimit: 4,
          angle: 0, flipX: false, flipY: false, opacity: 0,
          shadow: null, visible: true, backgroundColor: '',
          fillRule: 'nonzero', paintFirst: 'fill',
          globalCompositeOperation: 'source-over', skewX: 0, skewY: 0,
          textAlign: 'left', lineHeight: 1.2, charSpacing: 0,
          styles: [], direction: 'ltr', pathStartOffset: 0,
          pathSide: 'left', pathAlign: 'baseline',
          overline: false, underline: false, linethrough: false,
          textBackgroundColor: '', splitByGrapheme: false,
        },
      ],
    };
    const designData = { fabricVersion: true as const, canvasWidth: 1080, canvasHeight: 1350, fabricJson };
    await pool.query(
      `INSERT INTO card_templates (id, name, description, design_data, cover_image_url, is_published, created_at, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
       ON CONFLICT (id) DO UPDATE SET design_data=EXCLUDED.design_data, cover_image_url=EXCLUDED.cover_image_url, updated_at=EXCLUDED.updated_at`,
      [
        ARCGRAPHIX_ID,
        'arcgraphix — Before/After Carousel Cover',
        'Editorial dark-portfolio Instagram carousel cover (1080×1350). Deep navy #0B1B2A, neon-green #22E06B accent, concentric arc background. Framed headline, stamp badge, decorative squiggle. Open in canvas to customise headline and body copy.',
        JSON.stringify(designData),
        imageUrl,
        true,
        now, now,
      ]
    );
    logger.info('arcgraphix Before/After template upserted.');
  } catch (e) { logger.warn('arcgraphix template seed skipped:', e); }
  // ── end arcgraphix seed ─────────────────────────────────────────────────────

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
  await pool.query(`ALTER TABLE mailing_contacts ADD COLUMN IF NOT EXISTS phone TEXT;`).catch(() => undefined);
  await pool.query(`ALTER TABLE mailing_contacts ADD COLUMN IF NOT EXISTS custom_data JSONB DEFAULT '{}';`).catch(() => undefined);
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

  // ── Surveys Module Tables ────────────────────────────────────────────────────
  await pool.query(`
    CREATE TABLE IF NOT EXISTS surveys (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      title TEXT NOT NULL,
      description TEXT,
      status TEXT NOT NULL DEFAULT 'draft',
      thank_you_message TEXT DEFAULT 'Thank you for your response!',
      settings JSONB DEFAULT '{}',
      created_at TIMESTAMPTZ DEFAULT NOW(),
      updated_at TIMESTAMPTZ DEFAULT NOW()
    );
  `).catch(() => undefined);
  await pool.query(`CREATE INDEX IF NOT EXISTS surveys_user_idx ON surveys (user_id);`).catch(() => undefined);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS survey_questions (
      id TEXT PRIMARY KEY,
      survey_id TEXT NOT NULL REFERENCES surveys(id) ON DELETE CASCADE,
      type TEXT NOT NULL,
      question TEXT NOT NULL,
      options JSONB DEFAULT '[]',
      required BOOLEAN DEFAULT FALSE,
      order_idx INTEGER DEFAULT 0,
      settings JSONB DEFAULT '{}'
    );
  `).catch(() => undefined);
  await pool.query(`CREATE INDEX IF NOT EXISTS survey_questions_survey_idx ON survey_questions (survey_id);`).catch(() => undefined);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS survey_responses (
      id TEXT PRIMARY KEY,
      survey_id TEXT NOT NULL REFERENCES surveys(id) ON DELETE CASCADE,
      contact_id TEXT REFERENCES mailing_contacts(id) ON DELETE SET NULL,
      respondent_email TEXT,
      answers JSONB NOT NULL DEFAULT '[]',
      ip_address TEXT,
      created_at TIMESTAMPTZ DEFAULT NOW()
    );
  `).catch(() => undefined);
  await pool.query(`CREATE INDEX IF NOT EXISTS survey_responses_survey_idx ON survey_responses (survey_id);`).catch(() => undefined);
  // ── End Surveys Module ───────────────────────────────────────────────────────

  // ── Leads Module Tables ──────────────────────────────────────────────────────
  await pool.query(`
    CREATE TABLE IF NOT EXISTS lead_groups (
      id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      name TEXT NOT NULL,
      fields TEXT[] DEFAULT '{}',
      lead_count INTEGER DEFAULT 0,
      created_at TIMESTAMPTZ DEFAULT NOW()
    );
  `).catch(() => undefined);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS leads (
      id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
      group_id TEXT NOT NULL REFERENCES lead_groups(id) ON DELETE CASCADE,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      data JSONB NOT NULL DEFAULT '{}',
      sync_key TEXT,
      created_at TIMESTAMPTZ DEFAULT NOW(),
      updated_at TIMESTAMPTZ DEFAULT NOW()
    );
  `).catch(() => undefined);
  await pool.query(`ALTER TABLE leads ADD COLUMN IF NOT EXISTS sync_key TEXT;`).catch(() => undefined);
  await pool.query(`ALTER TABLE leads ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT NOW();`).catch(() => undefined);
  await pool.query(`CREATE INDEX IF NOT EXISTS leads_group_idx ON leads (group_id);`).catch(() => undefined);
  await pool.query(`CREATE INDEX IF NOT EXISTS leads_user_idx ON leads (user_id);`).catch(() => undefined);
  await pool.query(`CREATE INDEX IF NOT EXISTS leads_sync_key_idx ON leads (group_id, sync_key);`).catch(() => undefined);
  // Google Sheets integration columns
  await pool.query(`ALTER TABLE lead_groups ADD COLUMN IF NOT EXISTS linked_sheet_id TEXT;`).catch(() => undefined);
  await pool.query(`ALTER TABLE lead_groups ADD COLUMN IF NOT EXISTS linked_sheet_tab TEXT;`).catch(() => undefined);
  await pool.query(`ALTER TABLE lead_groups ADD COLUMN IF NOT EXISTS linked_sheet_name TEXT;`).catch(() => undefined);
  await pool.query(`ALTER TABLE lead_groups ADD COLUMN IF NOT EXISTS sheet_key_field TEXT;`).catch(() => undefined);
  await pool.query(`ALTER TABLE lead_groups ADD COLUMN IF NOT EXISTS last_synced_at TIMESTAMPTZ;`).catch(() => undefined);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS google_sheets_tokens (
      user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
      access_token TEXT NOT NULL,
      refresh_token TEXT NOT NULL,
      token_expiry TIMESTAMPTZ NOT NULL,
      google_email TEXT,
      created_at TIMESTAMPTZ DEFAULT NOW(),
      updated_at TIMESTAMPTZ DEFAULT NOW()
    );
  `).catch(() => undefined);
  // ── End Leads Module ─────────────────────────────────────────────────────────

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
  await pool.query(`ALTER TABLE campaigns ADD COLUMN IF NOT EXISTS launched_at TIMESTAMPTZ;`).catch(() => undefined);
  await pool.query(`ALTER TABLE mailing_campaigns ADD COLUMN IF NOT EXISTS campaign_id TEXT REFERENCES campaigns(id) ON DELETE SET NULL;`).catch(() => undefined);
  // ── Campaign KPIs & Content ───────────────────────────────────────────────────
  await pool.query(`
    CREATE TABLE IF NOT EXISTS campaign_kpis (
      id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
      campaign_id TEXT NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      name TEXT NOT NULL,
      metric_type TEXT NOT NULL DEFAULT 'number',
      target_value NUMERIC(12,2) NOT NULL DEFAULT 0,
      current_value NUMERIC(12,2) NOT NULL DEFAULT 0,
      unit TEXT NOT NULL DEFAULT '',
      source TEXT NOT NULL DEFAULT 'manual',
      sort_order INTEGER NOT NULL DEFAULT 0,
      created_at TIMESTAMPTZ DEFAULT NOW(),
      updated_at TIMESTAMPTZ DEFAULT NOW()
    );
  `).catch(() => undefined);
  await pool.query(`CREATE INDEX IF NOT EXISTS campaign_kpis_campaign_idx ON campaign_kpis (campaign_id);`).catch(() => undefined);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS campaign_content (
      id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
      campaign_id TEXT NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      content_type TEXT NOT NULL DEFAULT 'post',
      title TEXT NOT NULL DEFAULT '',
      description TEXT NOT NULL DEFAULT '',
      status TEXT NOT NULL DEFAULT 'draft',
      channel TEXT NOT NULL DEFAULT '',
      external_id TEXT,
      metrics JSONB DEFAULT '{}'::jsonb,
      created_at TIMESTAMPTZ DEFAULT NOW()
    );
  `).catch(() => undefined);
  await pool.query(`CREATE INDEX IF NOT EXISTS campaign_content_campaign_idx ON campaign_content (campaign_id);`).catch(() => undefined);
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

  // ── Credits System ────────────────────────────────────────────────────────────
  await pool.query(`
    CREATE TABLE IF NOT EXISTS user_credits (
      user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
      credits INTEGER NOT NULL DEFAULT 0,
      reset_date TIMESTAMPTZ NOT NULL DEFAULT (date_trunc('month', NOW()) + INTERVAL '1 month'),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `).catch(() => undefined);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS design_likes (
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      design_id TEXT NOT NULL,
      design_type TEXT NOT NULL DEFAULT 'user',
      created_at TIMESTAMPTZ DEFAULT NOW(),
      PRIMARY KEY (user_id, design_id)
    );
  `).catch(() => undefined);

  await pool.query(`ALTER TABLE card_templates ADD COLUMN IF NOT EXISTS view_count INTEGER NOT NULL DEFAULT 0;`).catch(() => undefined);
  await pool.query(`ALTER TABLE card_templates ADD COLUMN IF NOT EXISTS like_count INTEGER NOT NULL DEFAULT 0;`).catch(() => undefined);
  await pool.query(`ALTER TABLE pricing_plans ADD COLUMN IF NOT EXISTS credits_per_month INTEGER NOT NULL DEFAULT 0;`).catch(() => undefined);

  // Update existing plans with credits_per_month if not already set
  await pool.query(`UPDATE pricing_plans SET credits_per_month = 100  WHERE name ILIKE '%Free%'    AND credits_per_month = 0;`).catch(() => undefined);
  await pool.query(`UPDATE pricing_plans SET credits_per_month = 100  WHERE name ILIKE '%Starter%' AND credits_per_month = 0;`).catch(() => undefined);
  await pool.query(`UPDATE pricing_plans SET credits_per_month = 2000 WHERE name ILIKE '%Pro%'     AND credits_per_month = 0;`).catch(() => undefined);
  await pool.query(`UPDATE pricing_plans SET credits_per_month = 2000 WHERE name ILIKE '%Growth%'  AND credits_per_month = 0;`).catch(() => undefined);
  await pool.query(`UPDATE pricing_plans SET credits_per_month = 6000 WHERE name ILIKE '%Agency%'  AND credits_per_month = 0;`).catch(() => undefined);
  await pool.query(`UPDATE pricing_plans SET credits_per_month = 6000 WHERE name ILIKE '%Scale%'   AND credits_per_month = 0;`).catch(() => undefined);
  // ── End Credits System ────────────────────────────────────────────────────────

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

  // ── Higgsfield ────────────────────────────────────────────────────────────────
  await pool.query(`
    CREATE TABLE IF NOT EXISTS higgsfield_generations (
      id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      type         TEXT NOT NULL DEFAULT 'image',
      model        TEXT NOT NULL DEFAULT '',
      prompt       TEXT NOT NULL DEFAULT '',
      params       JSONB,
      status       TEXT NOT NULL DEFAULT 'pending',
      result_url   TEXT,
      error        TEXT,
      created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `).catch(() => undefined);
  // ── End Higgsfield ────────────────────────────────────────────────────────────

  // ── Magnific AI ────────────────────────────────────────────────────────────────
  await pool.query(`
    CREATE TABLE IF NOT EXISTS magnific_generations (
      id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      user_id      TEXT REFERENCES users(id) ON DELETE CASCADE,
      type         TEXT NOT NULL DEFAULT 'image',
      model        TEXT NOT NULL DEFAULT '',
      prompt       TEXT NOT NULL DEFAULT '',
      params       JSONB DEFAULT '{}',
      task_id      TEXT,
      status       TEXT NOT NULL DEFAULT 'pending',
      result_url   TEXT,
      error        TEXT,
      created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      completed_at TIMESTAMPTZ
    );
  `).catch(() => undefined);
  // ── Discover Feed ─────────────────────────────────────────────────────────────
  await pool.query(`
    CREATE TABLE IF NOT EXISTS discover_feed (
      id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      generation_id UUID NOT NULL REFERENCES magnific_generations(id) ON DELETE CASCADE,
      pushed_by     TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      pushed_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      visible       BOOLEAN NOT NULL DEFAULT true
    );
  `).catch(() => undefined);
  await pool.query(`CREATE UNIQUE INDEX IF NOT EXISTS discover_feed_gen_idx ON discover_feed (generation_id);`).catch(() => undefined);
  // ── End Discover Feed ──────────────────────────────────────────────────────────

  // ── End Magnific ────────────────────────────────────────────────────────────────

  // ── Kling AI ──────────────────────────────────────────────────────────────────
  await pool.query(`
    CREATE TABLE IF NOT EXISTS kling_generations (
      id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      user_id      TEXT REFERENCES users(id) ON DELETE CASCADE,
      type         TEXT NOT NULL DEFAULT 'video',
      model        TEXT NOT NULL DEFAULT '',
      prompt       TEXT NOT NULL DEFAULT '',
      params       JSONB NOT NULL DEFAULT '{}',
      task_id      TEXT,
      status       TEXT NOT NULL DEFAULT 'pending',
      result_url   TEXT,
      error        TEXT,
      credits_used INTEGER NOT NULL DEFAULT 0,
      created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      completed_at TIMESTAMPTZ
    );
  `).catch(() => undefined);
  // ── End Kling AI ──────────────────────────────────────────────────────────────

  // ── Google AI ─────────────────────────────────────────────────────────────────
  await pool.query(`
    CREATE TABLE IF NOT EXISTS google_generations (
      id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      user_id       TEXT REFERENCES users(id) ON DELETE CASCADE,
      type          TEXT NOT NULL DEFAULT 'image',
      model         TEXT NOT NULL DEFAULT '',
      prompt        TEXT NOT NULL DEFAULT '',
      params        JSONB NOT NULL DEFAULT '{}',
      operation_name TEXT,
      status        TEXT NOT NULL DEFAULT 'pending',
      result_url    TEXT,
      error         TEXT,
      credits_used  INTEGER NOT NULL DEFAULT 0,
      created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      completed_at  TIMESTAMPTZ
    );
  `).catch(() => undefined);
  // ── End Google AI ─────────────────────────────────────────────────────────────

  // ── OpenAI ────────────────────────────────────────────────────────────────────
  await pool.query(`
    CREATE TABLE IF NOT EXISTS openai_generations (
      id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      user_id       TEXT REFERENCES users(id) ON DELETE CASCADE,
      type          TEXT NOT NULL DEFAULT 'image',
      model         TEXT NOT NULL DEFAULT '',
      prompt        TEXT NOT NULL DEFAULT '',
      params        JSONB NOT NULL DEFAULT '{}',
      status        TEXT NOT NULL DEFAULT 'pending',
      result_url    TEXT,
      error         TEXT,
      credits_used  INTEGER NOT NULL DEFAULT 0,
      created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      completed_at  TIMESTAMPTZ
    );
  `).catch(() => undefined);
  // ── End OpenAI ────────────────────────────────────────────────────────────────

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
  // Seed specialized marketing agents (Phase 11)
  const _newAgents = [
    { key: 'trend_research',    name: 'Trend',   role: 'Trend Research',         icon: '◎', color: '#06B6D4',
      prompt: 'You are the Trend Research Agent for {brand.brand_name}. You detect emerging trends, viral topics, and timely content angles in the {brand.niche} space before competitors notice. Every trend you surface must have a clear relevance to the brand, an evidence signal (volume, growth, mentions), a suggested content angle, and a decay risk rating. You never invent metrics. If a metric cannot be verified, mark it "unverified".',
      keywords: '{trend,viral,topic,niche,platform,channel,tiktok,instagram}' },
    { key: 'audience_research', name: 'Persona', role: 'Audience Research',       icon: '◑', color: '#7C3AED',
      prompt: 'You are the Audience Research Agent for {brand.brand_name}. You deeply analyze the target audience: {brand.audience}. You extract their top pain points (with verbatim quotes when possible), desired outcomes, jobs-to-be-done, objections, the exact vocabulary they use, and what would make them buy or churn. You build 1–3 detailed persona profiles. You never fabricate quotes — if you cannot find a verbatim, mark the insight as "inferred, low confidence".',
      keywords: '{audience,persona,pain,buyer,customer,segment,icp}' },
    { key: 'seo_research',      name: 'SEO',     role: 'SEO Keyword Research',    icon: '⊗', color: '#059669',
      prompt: 'You are the SEO Keyword Research Agent for {brand.brand_name} in the {brand.niche} space. You find organic search opportunities — keywords with real buyer intent and achievable ranking difficulty. You cluster by intent (informational/commercial/transactional), map to funnel stage (TOFU/MOFU/BOFU), recommend content formats, and flag cannibalization risks. You never recommend black-hat tactics.',
      keywords: '{seo,keyword,search,organic,ranking,content,blog}' },
    { key: 'hook_writing',      name: 'Hook',    role: 'Hook Writing',            icon: '⚡', color: '#D97706',
      prompt: 'You are the Hook Writing Agent for {brand.brand_name}. Your sole job is to write the first 1–3 seconds of attention — scroll-stopping opening lines that make someone commit to reading or watching. You generate 8–12 hook variations across patterns: pattern interrupt, contrarian, stat-led, question, before/after, ICP callout, story cold-open, problem amplification. Every hook must be honest — it cannot promise a payoff the content cannot deliver. Tone: {brand.tone}.',
      keywords: '{hook,headline,opening,attention,scroll,viral,caption}' },
    { key: 'social_caption',    name: 'Caption', role: 'Social Caption',          icon: '✎', color: '#DB2777',
      prompt: 'You are the Social Caption Agent for {brand.brand_name}. You write platform-native captions for {brand.platforms} that respect each platform\'s culture, character limits, and engagement mechanics. You produce A/B variants. For LinkedIn: 1200–2000 chars, professional but human, 3–5 hashtags. For TikTok/Instagram: conversational, ≤150 chars, 3–5 hashtags. Always include one clear CTA aligned to the brand\'s conversion goal. Tone: {brand.tone}. Audience: {brand.audience}.',
      keywords: '{caption,social,post,instagram,linkedin,tiktok,hashtag}' },
    { key: 'video_script',      name: 'Script',  role: 'Video Script',            icon: '▶', color: '#DC2626',
      prompt: 'You are the Video Script Agent for {brand.brand_name}. You produce structured short-form (≤60s) and long-form (3–15 min) video scripts. Short-form structure: Hook → Problem amplification → Reveal/Proof → CTA (with second-by-second timing). Long-form: cold open → promise → 3–5 segments with retention beats every 60–90s → recap → CTA. You include on-screen text cues, b-roll/visual notes, voiceover lines, and timestamps. Brand voice: {brand.tone}.',
      keywords: '{video,script,reel,tiktok,youtube,voiceover,hook}' },
    { key: 'ad_copy',           name: 'Ads',     role: 'Ad Copy',                 icon: '◆', color: '#EA580C',
      prompt: 'You are the Ad Copy Agent for {brand.brand_name}. You write paid-traffic copy for Meta, Google, LinkedIn, and TikTok ads — optimized for CTR and post-click conversion. You produce 5–10 variations per placement, varied by angle: pain-led, outcome-led, social proof, contrarian, FOMO/urgency, identity, comparison. Each variation declares the hypothesis it tests. You never claim "guaranteed results" or fabricate testimonials. Audience: {brand.audience}. Tone: {brand.tone}.',
      keywords: '{ad,paid,meta,google,linkedin,ctr,copy,conversion}' },
    { key: 'thumbnail_design',  name: 'Thumb',   role: 'Thumbnail Design',        icon: '▣', color: '#9333EA',
      prompt: 'You are the Thumbnail Design Agent for {brand.brand_name}. You produce visual concept briefs for YouTube thumbnails, ad creatives, and social cards that maximize CTR. For each asset you produce 3 distinct concepts specifying: layout, focal element, dominant emotion, color palette (with hex codes), text overlay (≤4 words), background style, and what to avoid. You always provide A/B test pairs with a hypothesis. Principles: high contrast, single focal point, readable at thumbnail size.',
      keywords: '{thumbnail,visual,creative,design,youtube,banner,image}' },
    { key: 'meta_ads',          name: 'Meta',    role: 'Paid Social Manager',     icon: '⊛', color: '#1877F2',
      prompt: 'You are the Meta Ads Manager for {brand.brand_name}. You plan Facebook and Instagram paid campaign structures — objective → ad sets → audiences → creatives. You define decision rules: pause when CPA exceeds 1.5× target after 2× spend; scale when ROAS ≥ target for 2 consecutive days (≤20%/day increase); flag creative fatigue when frequency > 3 and CTR drops >30%. You produce daily performance reports with clear recommended actions. You never exceed pre-approved budget caps.',
      keywords: '{meta,facebook,instagram,ads,roas,cpa,budget,paid}' },
  ];
  for (const a of _newAgents) {
    await pool.query(
      `INSERT INTO agent_templates (agent_key, name, role, icon, color, base_prompt, memory_keywords)
       VALUES ($1,$2,$3,$4,$5,$6,$7) ON CONFLICT (agent_key) DO NOTHING`,
      [a.key, a.name, a.role, a.icon, a.color, a.prompt, `{${a.keywords.replace(/[{}]/g,'')}}`]
    ).catch(() => undefined);
  }
  // Update sage and aria with full-quality prompts (UPDATE overrides DO NOTHING)
  await pool.query(
    `UPDATE agent_templates SET base_prompt=$1 WHERE agent_key='sage'`,
    [`You are Sage, the Campaign Strategy Analyst for {brand.brand_name}. You hold 20+ years of strategic marketing expertise. When asked to build a campaign brief, always output your response in the following structured format:\n\n## SITUATION\nWhat is the current business/market context? Describe the starting point: current position of {brand.brand_name}, competitive pressure, opportunity window, or problem to solve. Be specific — no generic filler.\n\n## GOAL\nState 1 primary goal in measurable terms (e.g., "Grow email list from 0 to 500 subscribers in 30 days") and up to 2 secondary goals. Tie directly to {brand.goals}.\n\n## TARGET AUDIENCE\nName the primary persona. Include: demographics, top pain point, desired outcome, what they're currently using/doing instead. Base on {brand.audience}.\n\n## KEY MESSAGE\nOne sentence: what is the single idea you want this audience to walk away with? Then the proof point or reason-to-believe.\n\n## CHANNELS\nRecommend 2–4 channels from {brand.platforms}. For each, state: role in funnel (awareness/consideration/conversion/retention), content format, cadence (posts per week), KPI to watch.\n\n## CONTENT CADENCE\nWeek-by-week content plan for the campaign duration. Each week: theme, key pieces of content (format + topic + channel), one "hero" piece.\n\n## SUCCESS METRICS\nDefine 3–5 KPIs with specific targets. For each: metric name, target value with unit, measurement frequency, data source.\n\n## RISKS & MITIGATIONS\n2–3 execution risks. For each: what could go wrong, impact level (low/medium/high), mitigation action.\n\nRules:\n- Be specific, not generic. Use numbers when possible.\n- If you don't have enough information, ask one targeted clarifying question before building the brief.\n- Brand voice throughout must match: {brand.tone}\n- Always close with: "Strategy locked. Passing to Nova for creative direction and Aria for KPI baseline."`]
  ).catch(() => undefined);
  await pool.query(
    `UPDATE agent_templates SET base_prompt=$1 WHERE agent_key='aria'`,
    [`You are Aria, the Analytics & Performance Specialist for {brand.brand_name}. You turn raw numbers into decisions. When reviewing campaign performance, always structure your output as follows:\n\n## HEALTH CHECK\nScore the campaign out of 100 using this rubric:\n- Email open rate: <15% = 0pts, 15–25% = 10pts, 25–35% = 20pts, >35% = 30pts\n- Click rate: <1% = 0pts, 1–3% = 10pts, 3–5% = 15pts, >5% = 20pts\n- Conversion rate: <1% = 0pts, 1–3% = 10pts, 3–5% = 15pts, >5% = 20pts\n- Audience growth (week-over-week): <0% = 0pts, 0–2% = 5pts, >2% = 10pts\n- Engagement consistency: inconsistent = 0pts, consistent = 10pts\nTotal: 0–39 = Critical, 40–59 = Needs Work, 60–79 = On Track, 80–100 = Exceeding\n\n## BOTTLENECK\nIdentify the single biggest performance limiter this week. State it in one sentence. Cite the specific metric that reveals it.\n\n## CHANNEL RANKING\nRank all active channels from best to worst performing. For each: metric used to rank, score this period vs. last period, trend (↑↓→).\n\n## RECOMMENDATIONS\nExactly 3 actions, ordered by expected impact (highest first):\n1. [Action] — Expected impact: [metric change] — Effort: [low/medium/high] — Timeline: [days]\n2. [Action] — Expected impact: [metric change] — Effort: [low/medium/high] — Timeline: [days]\n3. [Action] — Expected impact: [metric change] — Effort: [low/medium/high] — Timeline: [days]\n\n## FORECAST\nBased on current trajectory, project end-of-campaign values for the top 3 KPIs. Show: current value, projected final value, % gap to target.\n\nBenchmarks to reference:\n- Email open rate: industry avg 20–25%, strong >35%\n- Email click rate: industry avg 2–3%, strong >5%\n- Social engagement rate: avg 1–3%, strong >5%\n- Landing page conversion: avg 2–5%, strong >10%\n- Ad CTR (Meta): avg 0.9–1.5%, strong >2.5%\n\nRules:\n- Always cite the specific data point behind each recommendation.\n- If data is insufficient, state: "Insufficient data — minimum X events needed for statistical significance."\n- Never recommend "post more content" without specifying what type, when, and why.\n- Close every analysis with the overall health score and one sentence summary.`]
  ).catch(() => undefined);
  // Seed campaign_brief agent
  await pool.query(
    `INSERT INTO agent_templates (agent_key, name, role, icon, color, base_prompt, memory_keywords)
     VALUES ($1,$2,$3,$4,$5,$6,$7) ON CONFLICT (agent_key) DO NOTHING`,
    [
      'campaign_brief', 'Brief', 'Campaign Brief Builder', '◫', '#0EA5E9',
      `You are the Campaign Brief Builder for {brand.brand_name}. You produce complete, ready-to-execute campaign briefs that every team member can act on immediately. When the user describes a campaign idea, goal, or event, you output a structured brief document.\n\nCAMPAIGN BRIEF FORMAT:\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\nCAMPAIGN: [Campaign Name]\nBrand: {brand.brand_name}\nDate: [Start] → [End]  |  Duration: [X weeks]\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n\n## 1. CAMPAIGN OVERVIEW\nOne paragraph: what this campaign is, why now, what it achieves for {brand.brand_name}.\n\n## 2. OBJECTIVE\nPrimary objective (one sentence, measurable).\nSuccess definition: what does "win" look like?\n\n## 3. TARGET AUDIENCE\nPrimary persona: [Name it]. Pain point: [...]. Trigger: what makes them act right now?\n\n## 4. CORE MESSAGE\nSingle headline: [...] (≤10 words)\nSupporting proof: [reason to believe]\nCTA: [specific action verb + outcome]\n\n## 5. CHANNEL PLAN\n| Channel | Role | Content Format | Frequency | Owner |\n|---------|------|----------------|-----------|-------|\n| [ch]    | [...] | [...]         | [...]     | [...]  |\n\n## 6. CONTENT CALENDAR\nWeek 1 — Theme: [...]\n- [Day]: [Platform] — [Content type] — [Topic/angle]\n(repeat for each week)\n\n## 7. EMAIL SEQUENCE\nEmail 1 — Subject: [...] — Send: Day [X] — Goal: [...]\nEmail 2 — Subject: [...] — Send: Day [X] — Goal: [...]\n\n## 8. UTM PARAMETERS\nCampaign slug: [brand-campaignname-YYYY-MM]\n| Channel | utm_source | utm_medium | utm_campaign |\n|---------|-----------|------------|--------------|\n\n## 9. KPIs\n| Metric | Baseline | Target | Measurement |\n|--------|----------|--------|-------------|\n\n## 10. DEPENDENCIES & RISKS\nRisk: [...] — Mitigation: [...]\n\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\nRules:\n- Fill every section. If data is missing, write [TBD: what you need].\n- Never leave a section blank.\n- Suggest specific post angles, email subjects, and CTAs — not generic placeholders.\n- All messaging tone must match: {brand.tone}. Audience: {brand.audience}.\n- After the brief, add: "Brief ready. Sage can refine strategy. Nova can develop creative. Aria will track KPIs."`,
      '{campaign,brief,launch,strategy,plan,timeline,kpi,channel}'
    ]
  ).catch(() => undefined);
  // ── End Agent System ──────────────────────────────────────────────────────────

  // ── Admin Platform Agents ──────────────────────────────────────────────────────
  await pool.query(`
    CREATE TABLE IF NOT EXISTS admin_agents (
      id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      key             TEXT NOT NULL UNIQUE,
      name            TEXT NOT NULL,
      role            TEXT NOT NULL,
      tier            TEXT NOT NULL DEFAULT 'strategic',
      model           TEXT NOT NULL DEFAULT 'claude-sonnet-4-6',
      icon            TEXT NOT NULL DEFAULT '◆',
      color           TEXT NOT NULL DEFAULT '#5B6CF9',
      system_prompt   TEXT NOT NULL DEFAULT '',
      autonomy_config JSONB NOT NULL DEFAULT '{}',
      status          TEXT NOT NULL DEFAULT 'idle',
      last_run_at     TIMESTAMPTZ,
      created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `).catch(() => undefined);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS admin_agent_runs (
      id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      agent_key      TEXT NOT NULL,
      trigger        TEXT NOT NULL DEFAULT 'scheduled',
      summary        TEXT NOT NULL DEFAULT '',
      decisions_made INTEGER NOT NULL DEFAULT 0,
      status         TEXT NOT NULL DEFAULT 'completed',
      metadata       JSONB NOT NULL DEFAULT '{}',
      created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `).catch(() => undefined);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS admin_agent_tasks (
      id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      agent_key    TEXT NOT NULL,
      action_type  TEXT NOT NULL,
      payload      JSONB NOT NULL DEFAULT '{}',
      status       TEXT NOT NULL DEFAULT 'pending',
      reasoning    TEXT NOT NULL DEFAULT '',
      severity     TEXT NOT NULL DEFAULT 'low',
      created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      executed_at  TIMESTAMPTZ
    );
  `).catch(() => undefined);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS admin_notifications (
      id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      agent_key  TEXT NOT NULL,
      title      TEXT NOT NULL,
      body       TEXT NOT NULL DEFAULT '',
      severity   TEXT NOT NULL DEFAULT 'info',
      is_read    BOOLEAN NOT NULL DEFAULT false,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `).catch(() => undefined);
  // Seed default admin platform agents
  await pool.query(`
    INSERT INTO admin_agents (key, name, role, tier, model, icon, color, system_prompt, autonomy_config) VALUES
    ('ceo', 'APEX', 'Chief Executive Officer', 'strategic', 'claude-opus-4-7', '◆', '#0f172a',
     'You are APEX, the AI Chief Executive Officer of Dakyworld Hub. You have full authority over platform strategy, revenue optimization, pricing decisions, and executive coordination. Your decisions are data-driven and focused on sustainable growth. You analyze platform metrics, user behavior, and market conditions to make autonomous executive decisions that maximize platform health and revenue.',
     '{"can_change_pricing": true, "pricing_range_pct": 15, "can_manage_users": true, "can_allocate_budget": true, "budget_limit_usd": 500, "requires_approval": false}'),
    ('coo', 'NEXUS', 'Chief Operations Officer', 'strategic', 'claude-sonnet-4-6', '⬡', '#1e3a5f',
     'You are NEXUS, the AI Chief Operations Officer of Dakyworld Hub. You oversee day-to-day platform operations, user experience quality, operational workflows, and inter-department coordination. You ensure seamless platform operation and resolve escalations from the operational tier autonomously.',
     '{"can_manage_users": true, "can_suspend_accounts": true, "can_process_refunds": true, "refund_limit_usd": 30, "requires_approval": false}'),
    ('cco', 'VERA', 'Chief Content Officer', 'operational', 'claude-sonnet-4-6', '◈', '#4c1d95',
     'You are VERA, the AI Chief Content Officer of Dakyworld Hub. You manage all content strategy, template quality standards, AI-generated content guidelines, and the platform content ecosystem. You ensure content quality meets brand standards and drives user engagement metrics.',
     '{"can_manage_templates": true, "can_feature_content": true, "can_moderate_content": true, "requires_approval": false}'),
    ('cto', 'FORGE', 'Chief Technology Officer', 'operational', 'claude-sonnet-4-6', '⟁', '#064e3b',
     'You are FORGE, the AI Chief Technology Officer of Dakyworld Hub. You monitor platform performance, API health, integration stability, and technical infrastructure. You identify bottlenecks, flag issues autonomously, and escalate critical technical decisions to APEX.',
     '{"can_flag_issues": true, "can_disable_integrations": true, "can_escalate_to_ceo": true, "requires_approval": false}'),
    ('cro', 'PULSE', 'Chief Revenue Officer', 'operational', 'claude-sonnet-4-6', '◎', '#7f1d1d',
     'You are PULSE, the AI Chief Revenue Officer of Dakyworld Hub. You optimize revenue streams, analyze conversion funnels, manage subscription retention, and identify growth opportunities. You make data-driven autonomous decisions to maximize ARR and reduce churn.',
     '{"can_offer_discounts": true, "discount_limit_pct": 20, "can_trigger_campaigns": true, "can_change_pricing": true, "pricing_range_pct": 10, "requires_approval": false}')
    ON CONFLICT (key) DO NOTHING;
  `).catch(() => undefined);
  // ── End Admin Platform Agents ─────────────────────────────────────────────────

  // ── Agent Workflow & Tools ────────────────────────────────────────────────────
  await pool.query(`
    CREATE TABLE IF NOT EXISTS agent_tools (
      id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      key         TEXT NOT NULL UNIQUE,
      name        TEXT NOT NULL,
      description TEXT NOT NULL DEFAULT '',
      type        TEXT NOT NULL DEFAULT 'builtin',
      config      JSONB NOT NULL DEFAULT '{}',
      enabled     BOOLEAN NOT NULL DEFAULT true,
      created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `).catch(() => undefined);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS agent_workflows (
      id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      agent_key   TEXT NOT NULL,
      name        TEXT NOT NULL DEFAULT 'Default Workflow',
      description TEXT NOT NULL DEFAULT '',
      steps       JSONB NOT NULL DEFAULT '[]',
      is_active   BOOLEAN NOT NULL DEFAULT true,
      updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      UNIQUE(agent_key, name)
    );
  `).catch(() => undefined);
  // Migrations: add name/description columns and move from per-agent UNIQUE to per-(agent_key, name) UNIQUE
  await pool.query(`ALTER TABLE agent_workflows ADD COLUMN IF NOT EXISTS name TEXT NOT NULL DEFAULT 'Default Workflow'`).catch(() => undefined);
  await pool.query(`ALTER TABLE agent_workflows ADD COLUMN IF NOT EXISTS description TEXT NOT NULL DEFAULT ''`).catch(() => undefined);
  // Drop any single-column unique constraint on agent_key (old schema), then add the composite one
  await pool.query(`
    DO $$
    DECLARE c TEXT;
    BEGIN
      FOR c IN
        SELECT conname FROM pg_constraint
        WHERE conrelid = 'agent_workflows'::regclass
          AND contype = 'u'
          AND conname != 'agent_workflows_agent_key_name_key'
          AND conname NOT LIKE '%pkey%'
      LOOP
        EXECUTE 'ALTER TABLE agent_workflows DROP CONSTRAINT IF EXISTS ' || quote_ident(c);
      END LOOP;
      IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'agent_workflows_agent_key_name_key') THEN
        ALTER TABLE agent_workflows ADD CONSTRAINT agent_workflows_agent_key_name_key UNIQUE (agent_key, name);
      END IF;
    END $$
  `).catch(() => undefined);
  await pool.query(`
    INSERT INTO agent_tools (key, name, description, type, config) VALUES
    ('meigen_search',          'MeiGen AI Search',          'Search MeiGen AI for design templates and extract generation prompts',         'mcp',     '{"mcp_server":"meigen","tool":"search_designs"}'),
    ('pinterest_search',       'Pinterest Search',          'Search Pinterest for visual design inspiration by keyword',                   'api',     '{"endpoint":"pinterest"}'),
    ('claude_synthesize',      'Claude Synthesize',         'Use Claude AI to craft a tailored prompt from designs and brand memory',      'builtin', '{"model":"claude-haiku-4-5-20251001"}'),
    ('draft_content',          'Draft Content',             'Draft marketing copy, captions, or strategic content using Claude AI',        'builtin', '{"model":"claude-haiku-4-5-20251001"}'),
    ('summarize_content',      'Claude Summarize',          'Summarize and analyze text, data, or reports using Claude AI',               'builtin', '{"model":"claude-haiku-4-5-20251001"}'),
    ('generate_image',         'Generate Image (Magnific)', 'Generate an image using Magnific AI with the selected model',                'builtin', '{"fallback_model":"flux-2-turbo"}'),
    ('freepik_generate_image', 'Generate Image (Freepik)',  'Generate a high-quality image via Freepik AI — uses credits per generation', 'api',     '{"provider":"freepik","fallback_model":"freepik-mystic","credits":5}'),
    ('generate_video',         'Generate Video (Magnific)', 'Generate a short branded video clip via Magnific AI video models',           'builtin', '{"fallback_model":"wan-2-7-t2v"}'),
    ('save_design',            'Save to Designs',           'Save the generated image to the user designs collection',                   'builtin', '{}')
    ON CONFLICT (key) DO UPDATE SET
      name        = EXCLUDED.name,
      description = EXCLUDED.description,
      type        = EXCLUDED.type,
      config      = EXCLUDED.config;
  `).catch(() => undefined);
  // ── Seed default named workflows for all 5 agents (UNIQUE agent_key+name = idempotent) ─
  {
    const _seeds: { agent_key: string; name: string; description: string; steps: any[] }[] = [
      // ── Nova — Creative Director ───────────────────────────────────────────
      {
        agent_key: 'nova', name: 'Brand Identity Visual',
        description: 'Search design concepts, tailor to brand memory, then generate a branded image via Freepik AI.',
        steps: [
          { id: 'step_search',   name: 'Search Designs',        tool: 'meigen_search',          description: 'Find design templates matching the request', prompt_template: 'Search for designs matching: {input}. Style niche: {brand.niche}', params: { top_n: 5 } },
          { id: 'step_extract',  name: 'Extract Style Prompts', tool: 'claude_synthesize',       description: 'Extract visual elements and generation prompts', prompt_template: 'From these design concepts, extract 3–5 key visual styles with image generation prompts.\n\nDesigns: {step_search.result}', params: {} },
          { id: 'step_tailor',   name: 'Tailor to Brand',       tool: 'claude_synthesize',       description: 'Blend design inspiration with brand memory', prompt_template: 'Create one optimized image prompt combining design concepts with this brand:\nNiche: {brand.niche}\nTone: {brand.tone}\nAudience: {brand.audience}\n\nDesigns: {step_extract.result}\n\nReturn ONLY JSON (no markdown): { "prompt": "...", "model": "freepik-mystic", "style_notes": "..." }', params: {} },
          { id: 'step_generate', name: 'Generate via Freepik',  tool: 'freepik_generate_image',  description: 'Generate the final brand image using Freepik AI', prompt_template: '{step_tailor.prompt}', params: { auto_if_memory: true } },
          { id: 'step_save',     name: 'Save Design',           tool: 'save_design',             description: 'Save generated image to designs collection', prompt_template: '', params: {} },
        ],
      },
      {
        agent_key: 'nova', name: 'Social Media Post Image',
        description: 'Generate a platform-optimized social media image tailored to brand tone and audience.',
        steps: [
          { id: 'step_brief',    name: 'Draft Visual Brief',    tool: 'claude_synthesize',       description: 'Write a detailed visual brief for the social post', prompt_template: 'Write a detailed image generation brief for a {input} social media post.\nBrand niche: {brand.niche}\nBrand tone: {brand.tone}\nAudience: {brand.audience}\n\nInclude: visual style, color scheme, composition, mood.\nReturn ONLY JSON: { "prompt": "...", "model": "freepik-mystic", "platform": "..." }', params: {} },
          { id: 'step_generate', name: 'Generate via Freepik',  tool: 'freepik_generate_image',  description: 'Generate social media image via Freepik', prompt_template: '{step_brief.prompt}', params: {} },
          { id: 'step_save',     name: 'Save Design',           tool: 'save_design',             description: 'Save to designs collection', prompt_template: '', params: {} },
        ],
      },
      {
        agent_key: 'nova', name: 'Product Promo Banner',
        description: 'Create a promotional banner image for a product or service using brand memory and Freepik.',
        steps: [
          { id: 'step_concept',  name: 'Build Promo Concept',   tool: 'claude_synthesize',       description: 'Generate a promo banner concept', prompt_template: 'Create a promotional banner concept for: {input}\nBrand niche: {brand.niche}\nTone: {brand.tone}\nAudience: {brand.audience}\n\nSpecify: layout, headline text, visual elements, brand colors.\nReturn ONLY JSON: { "prompt": "...", "model": "freepik-mystic", "headline": "...", "cta": "..." }', params: {} },
          { id: 'step_generate', name: 'Generate via Freepik',  tool: 'freepik_generate_image',  description: 'Generate promo banner via Freepik', prompt_template: '{step_concept.prompt}', params: {} },
          { id: 'step_save',     name: 'Save Design',           tool: 'save_design',             description: 'Save banner to designs collection', prompt_template: '', params: {} },
        ],
      },
      {
        agent_key: 'nova', name: 'AI Brand Video',
        description: 'Generate a short branded video clip using Magnific AI video generation.',
        steps: [
          { id: 'step_script',   name: 'Write Video Brief',     tool: 'claude_synthesize',       description: 'Draft a video concept brief', prompt_template: 'Write a text-to-video generation prompt for: {input}\nBrand niche: {brand.niche}\nTone: {brand.tone}\nAudience: {brand.audience}\n\nDescribe: scene, motion, style, colors, mood (max 120 words).\nReturn ONLY JSON: { "prompt": "...", "model": "wan-2-7-t2v" }', params: {} },
          { id: 'step_generate', name: 'Generate Video',        tool: 'generate_video',          description: 'Generate branded video via Magnific', prompt_template: '{step_script.prompt}', params: {} },
        ],
      },
      {
        agent_key: 'nova', name: 'Content Mood Board',
        description: 'Generate multiple visual concepts and image inspirations for a content campaign.',
        steps: [
          { id: 'step_concepts', name: 'Generate Visual Ideas', tool: 'claude_synthesize',       description: 'Create 5 visual mood board concepts', prompt_template: 'Generate 5 distinct visual mood board concepts for: {input}\nBrand: {brand.niche}, tone: {brand.tone}, audience: {brand.audience}\n\nFor each include: name, style, color palette, image prompt.\nReturn ONLY JSON array: [{ "name": "...", "style": "...", "colors": "...", "prompt": "..." }]', params: {} },
          { id: 'step_generate', name: 'Generate Hero Image',   tool: 'freepik_generate_image',  description: 'Generate the primary mood board image via Freepik', prompt_template: '{step_concepts.result}', params: { use_first_prompt: true } },
          { id: 'step_save',     name: 'Save Design',           tool: 'save_design',             description: 'Save mood board image to designs', prompt_template: '', params: {} },
        ],
      },
      // ── Sage — Strategy Analyst ────────────────────────────────────────────
      {
        agent_key: 'sage', name: 'Competitor Analysis',
        description: 'Analyze competitors in your niche and summarize their strengths, weaknesses, and market gaps.',
        steps: [
          { id: 'step_research', name: 'Research Competitors',  tool: 'claude_synthesize',       description: 'Generate competitor landscape analysis', prompt_template: 'Perform a competitor analysis for a business in: {brand.niche}\nUser request: {input}\nAudience: {brand.audience}\n\nAnalyze: top 3–5 competitors, their positioning, content strategy, strengths/weaknesses, and market gaps. Format as a structured report with actionable insights.', params: {} },
          { id: 'step_summary',  name: 'Strategic Summary',    tool: 'claude_synthesize',        description: 'Distill into strategic recommendations', prompt_template: 'Based on this competitor analysis:\n{step_research.result}\n\nWrite a concise strategic recommendation covering:\n1. Key differentiation opportunities\n2. Content gaps to exploit\n3. Positioning angle for {brand.niche}\n4. Top 3 immediate action items', params: {} },
        ],
      },
      {
        agent_key: 'sage', name: 'Content Strategy Plan',
        description: 'Build a comprehensive 30-day content strategy aligned to brand goals and audience.',
        steps: [
          { id: 'step_audit',    name: 'Audit Brand Positioning', tool: 'claude_synthesize',     description: 'Assess current brand positioning and content gaps', prompt_template: 'Audit the content positioning for a {brand.niche} brand.\nTone: {brand.tone}\nAudience: {brand.audience}\nRequest: {input}\n\nAssess: content gaps, audience pain points, content pillars to establish, platforms to prioritize.', params: {} },
          { id: 'step_plan',     name: 'Build 30-Day Plan',     tool: 'claude_synthesize',       description: 'Create a detailed monthly content plan', prompt_template: 'Using this positioning audit:\n{step_audit.result}\n\nBuild a 30-day content strategy for {brand.niche}:\n- 4 weekly themes\n- Daily post types (educational, promotional, engagement, behind-scenes)\n- Platform mix\n- KPIs to track\n\nFormat as a structured calendar plan.', params: {} },
        ],
      },
      {
        agent_key: 'sage', name: 'Audience Persona Builder',
        description: 'Create detailed target audience personas based on brand niche and market insights.',
        steps: [
          { id: 'step_research', name: 'Research Audience',    tool: 'claude_synthesize',        description: 'Research target audience characteristics', prompt_template: 'Research the ideal target audience for: {brand.niche}\nCurrent audience info: {brand.audience}\nUser request: {input}\n\nIdentify: demographics, psychographics, pain points, goals, preferred platforms, content habits, purchasing triggers.', params: {} },
          { id: 'step_personas', name: 'Build 3 Personas',    tool: 'claude_synthesize',         description: 'Create detailed persona profiles', prompt_template: 'Based on this audience research:\n{step_research.result}\n\nCreate 3 detailed audience personas for {brand.niche}. Each persona: name, age/role, goals, pain points, preferred content types, platforms used, and how this brand helps them.', params: {} },
        ],
      },
      {
        agent_key: 'sage', name: 'Campaign Brief Writer',
        description: 'Write a complete marketing campaign brief from objectives to execution details.',
        steps: [
          { id: 'step_objectives', name: 'Define Objectives',  tool: 'claude_synthesize',        description: 'Clarify campaign goals and success metrics', prompt_template: 'Define campaign objectives for: {input}\nBrand: {brand.niche}\nTone: {brand.tone}\nAudience: {brand.audience}\n\nSpecify: primary goal, secondary goals, target segment, KPIs, timeline, and budget framework.', params: {} },
          { id: 'step_brief',      name: 'Write Full Brief',   tool: 'claude_synthesize',        description: 'Write the comprehensive campaign brief', prompt_template: 'Write a complete marketing campaign brief from these objectives:\n{step_objectives.result}\n\nInclude: campaign concept, messaging framework, content mix, channel strategy, creative direction, timeline milestones, and success criteria.', params: {} },
        ],
      },
      {
        agent_key: 'sage', name: 'Brand Positioning Statement',
        description: 'Craft a clear and compelling brand positioning statement that differentiates in the market.',
        steps: [
          { id: 'step_analysis',  name: 'Positioning Analysis', tool: 'claude_synthesize',       description: 'Analyze brand differentiators and unique value', prompt_template: 'Analyze positioning potential for {brand.niche}.\nTone: {brand.tone}\nAudience: {brand.audience}\nInput: {input}\n\nIdentify: unique value propositions, key differentiators, emotional benefits, functional benefits, and competitive positioning gaps.', params: {} },
          { id: 'step_statement', name: 'Write Positioning',    tool: 'claude_synthesize',       description: 'Draft 3 positioning statement options with taglines', prompt_template: 'Based on this analysis:\n{step_analysis.result}\n\nWrite 3 alternative brand positioning statements for {brand.niche}. Each should be clear, compelling, and differentiated. Include a one-sentence brand tagline for each option.', params: {} },
        ],
      },
      // ── Aria — Analytics & Performance ────────────────────────────────────
      {
        agent_key: 'aria', name: 'Performance Summary',
        description: 'Analyze platform KPIs and surface actionable performance insights for your brand.',
        steps: [
          { id: 'step_kpis',     name: 'Define Key Metrics',   tool: 'claude_synthesize',        description: 'Identify and explain the most important KPIs', prompt_template: 'For a {brand.niche} brand, identify and explain the 5 most critical performance KPIs.\nRequest: {input}\nAudience: {brand.audience}\n\nFor each KPI: what it measures, why it matters, benchmark targets, and how to improve it.', params: {} },
          { id: 'step_insights', name: 'Synthesize Insights',  tool: 'claude_synthesize',        description: 'Distill into actionable performance insights', prompt_template: 'Based on these KPIs:\n{step_kpis.result}\n\nWrite a performance summary for {brand.niche}: overall health score (1–10), top performing areas, underperforming areas, and 3 immediate optimization recommendations.', params: {} },
        ],
      },
      {
        agent_key: 'aria', name: 'Engagement Analysis',
        description: 'Break down content engagement patterns to identify what resonates with your audience.',
        steps: [
          { id: 'step_patterns', name: 'Analyze Patterns',    tool: 'claude_synthesize',         description: 'Identify engagement patterns and trends', prompt_template: 'Analyze content engagement patterns for a {brand.niche} brand targeting {brand.audience}.\nRequest: {input}\n\nBreak down: best performing content types, optimal posting times, engagement rate benchmarks by platform, and content format performance.', params: {} },
          { id: 'step_recs',     name: 'Engagement Playbook', tool: 'claude_synthesize',         description: 'Create engagement optimization recommendations', prompt_template: 'Based on these patterns:\n{step_patterns.result}\n\nCreate an engagement optimization playbook for {brand.niche}:\n1. Top 3 content formats to prioritize\n2. Posting schedule recommendations\n3. Caption and CTA strategies\n4. Community interaction tactics\n5. A/B test ideas to run this month', params: {} },
        ],
      },
      {
        agent_key: 'aria', name: 'Growth Opportunity Report',
        description: 'Identify the highest-impact growth opportunities based on brand data and market analysis.',
        steps: [
          { id: 'step_gaps',    name: 'Find Growth Gaps',      tool: 'claude_synthesize',        description: 'Identify underexplored growth channels and tactics', prompt_template: 'Identify growth opportunities for a {brand.niche} brand.\nAudience: {brand.audience}\nTone: {brand.tone}\nRequest: {input}\n\nAnalyze: untapped content formats, underutilized platforms, audience segments to target, SEO/hashtag gaps, partnership opportunities.', params: {} },
          { id: 'step_report',  name: 'Prioritize & Plan',     tool: 'claude_synthesize',        description: 'Prioritize opportunities by impact and effort', prompt_template: 'Based on these growth opportunities:\n{step_gaps.result}\n\nCreate a prioritized growth plan for {brand.niche}:\n- Quick wins (this week)\n- Medium-term plays (this month)\n- Long-term investments (this quarter)\n\nFor each: opportunity, expected impact, effort required, first action step.', params: {} },
        ],
      },
      {
        agent_key: 'aria', name: 'Monthly Insights Report',
        description: 'Compile a comprehensive monthly performance report with insights and next-month recommendations.',
        steps: [
          { id: 'step_review',  name: 'Monthly Review',        tool: 'claude_synthesize',        description: 'Review the month across all performance metrics', prompt_template: 'Write a monthly performance review for a {brand.niche} brand.\nRequest: {input}\nAudience: {brand.audience}\n\nCover: content volume, engagement trends, audience growth, top performing content, biggest misses, revenue/lead impact.', params: {} },
          { id: 'step_forward', name: 'Next Month Strategy',   tool: 'claude_synthesize',        description: 'Draft next month strategic recommendations', prompt_template: 'Based on this monthly review:\n{step_review.result}\n\nWrite a next-month strategy for {brand.niche}:\n1. Double down: what to do more of\n2. Stop/fix: what to change\n3. Test: new experiments to run\n4. Focus KPIs\n5. Content themes and campaign ideas', params: {} },
        ],
      },
      // ── Flux — Automation & Workflows ─────────────────────────────────────
      {
        agent_key: 'flux', name: 'Content Repurposer',
        description: 'Adapt a single piece of content into multiple formats optimized for different platforms.',
        steps: [
          { id: 'step_analyze',   name: 'Analyze Source Content',    tool: 'claude_synthesize',  description: 'Understand content intent and extract key messages', prompt_template: 'Analyze this content for repurposing: {input}\nBrand: {brand.niche}\nTone: {brand.tone}\nAudience: {brand.audience}\n\nExtract: core message, key quotes, supporting points, target emotion, and content type.', params: {} },
          { id: 'step_repurpose', name: 'Generate Platform Variants', tool: 'draft_content',     description: 'Create platform-specific content variations', prompt_template: 'Based on this content analysis:\n{step_analyze.result}\n\nRepurpose for these platforms:\n1. Instagram caption (150 chars + hashtags)\n2. LinkedIn post (professional, 200 words)\n3. Twitter/X thread (3–5 tweets)\n4. TikTok script (30-second hook + body)\n5. Email newsletter intro (100 words)\n\nMaintain brand tone: {brand.tone}', params: {} },
        ],
      },
      {
        agent_key: 'flux', name: 'Caption & Hashtag Generator',
        description: 'Write engaging captions and build a tiered hashtag strategy for any post topic.',
        steps: [
          { id: 'step_caption',   name: 'Write Caption Options', tool: 'draft_content',          description: 'Generate 3 caption variations', prompt_template: 'Write 3 caption variations for: {input}\nBrand niche: {brand.niche}\nTone: {brand.tone}\nAudience: {brand.audience}\n\nVariation 1: Hook-driven (question or bold statement)\nVariation 2: Storytelling (personal or relatable)\nVariation 3: Value-first (educational or tip-based)\n\nEach 80–150 characters. Include a CTA.', params: {} },
          { id: 'step_hashtags',  name: 'Hashtag Strategy',      tool: 'draft_content',          description: 'Research and categorize hashtags by reach', prompt_template: 'Generate a hashtag strategy for: {input}\nNiche: {brand.niche}\n\nProvide 30 hashtags across 3 tiers:\n- 10 High-reach (1M+ posts) — broad awareness\n- 10 Mid-reach (100K–1M posts) — discoverability\n- 10 Niche (10K–100K posts) — targeted engagement\n\nAlso suggest 5 brand-specific hashtags.', params: {} },
        ],
      },
      {
        agent_key: 'flux', name: 'Weekly Content Plan',
        description: 'Plan a complete 7-day posting schedule with content types, themes, and captions.',
        steps: [
          { id: 'step_themes',   name: 'Define Weekly Themes',    tool: 'draft_content',          description: 'Establish 7-day content themes and pillars', prompt_template: 'Define a content theme framework for the week for {brand.niche}.\nTone: {brand.tone}\nAudience: {brand.audience}\nGoal: {input}\n\nCreate 7 daily themes using content pillars: educational, entertaining, promotional, engagement, behind-the-scenes, user stories, trending.', params: {} },
          { id: 'step_schedule', name: 'Build Posting Schedule',  tool: 'draft_content',          description: 'Create the full 7-day posting schedule', prompt_template: 'Using these weekly themes:\n{step_themes.result}\n\nBuild a complete 7-day posting plan for {brand.niche}:\n- Day 1–7: time to post, platform, content type, caption idea, visual direction\n- Include 2 reels/videos, 3 static posts, 1 carousel, 1 story series\n- Optimize for {brand.audience} behavior patterns', params: {} },
        ],
      },
      {
        agent_key: 'flux', name: 'Post Batch Generator',
        description: 'Generate 10 ready-to-use post ideas with captions and visual direction for bulk scheduling.',
        steps: [
          { id: 'step_ideas',    name: 'Generate Post Ideas',  tool: 'draft_content',             description: 'Brainstorm 10 high-quality post concepts', prompt_template: 'Generate 10 post ideas for {brand.niche}.\nTone: {brand.tone}\nAudience: {brand.audience}\nCampaign/topic: {input}\n\nFor each post: title, format (reel/image/carousel/story), hook, main message, platform recommendation, and content angle.', params: {} },
          { id: 'step_captions', name: 'Write All Captions',   tool: 'draft_content',             description: 'Write full captions for each post', prompt_template: 'Write full captions for all 10 posts:\n{step_ideas.result}\n\nFor each: complete caption (100–200 chars), 3 relevant emojis, CTA, and 5–10 hashtags. Maintain {brand.tone} tone throughout.', params: {} },
        ],
      },
      // ── Daky — Orchestrator & Strategist ──────────────────────────────────
      {
        agent_key: 'daky', name: 'Full Campaign Launch',
        description: 'Orchestrate a complete marketing campaign — strategy, content plan, creative brief, and launch checklist.',
        steps: [
          { id: 'step_strategy', name: 'Campaign Strategy',    tool: 'claude_synthesize',         description: 'Define strategy and objectives', prompt_template: 'Build a full campaign strategy for: {input}\nBrand: {brand.niche}\nTone: {brand.tone}\nAudience: {brand.audience}\n\nDefine: campaign name, objective, key message, target segment, channels, timeline, content mix, and success metrics.', params: {} },
          { id: 'step_content',  name: 'Content Framework',    tool: 'draft_content',             description: 'Create the content execution plan for the campaign', prompt_template: 'Based on this campaign strategy:\n{step_strategy.result}\n\nCreate a content execution framework for {brand.niche}:\n- Launch week content plan (7 posts)\n- Visual direction brief for Nova\n- Copy tone guide for Flux\n- KPIs for Aria to track\n- Automation setup notes for Flux', params: {} },
          { id: 'step_brief',    name: 'Master Campaign Brief', tool: 'claude_synthesize',        description: 'Compile the master brief for all agents', prompt_template: 'Compile a master campaign brief from:\nStrategy: {step_strategy.result}\nContent plan: {step_content.result}\n\nFormat as an actionable brief each team member (creative, content, analytics) can execute independently. Include: campaign overview, role briefs, timeline, dependencies, and launch checklist.', params: {} },
        ],
      },
      {
        agent_key: 'daky', name: 'Brand Onboarding',
        description: 'Guide a new user through setting up their brand identity and preparing all agents for first use.',
        steps: [
          { id: 'step_collect', name: 'Brand Discovery',       tool: 'claude_synthesize',         description: 'Extract and organize core brand information', prompt_template: 'You are onboarding a new brand to Dakyworld Hub.\nInput: {input}\n\nExtract and organize:\n1. Business name and industry\n2. Target audience\n3. Brand tone and personality\n4. Products/services\n5. Competitors\n6. Main marketing goals\n7. Current social media presence\n\nFormat as a structured brand profile.', params: {} },
          { id: 'step_memory',  name: 'Memory Setup Guide',    tool: 'claude_synthesize',         description: 'Create a memory setup guide for the user', prompt_template: 'Based on this brand profile:\n{step_collect.result}\n\nWrite a memory setup guide explaining:\n1. What to save in Brand Memory\n2. Suggested brand keywords (niche, tone, audience, products)\n3. Which agent handles which task (Nova/Sage/Aria/Flux)\n4. Recommended first workflows to run\n5. Quick-start action plan (first 7 days)', params: {} },
        ],
      },
      {
        agent_key: 'daky', name: 'Weekly Marketing Review',
        description: 'Compile a weekly cross-team review covering performance, content output, and next-week priorities.',
        steps: [
          { id: 'step_review',  name: 'Weekly Review',         tool: 'claude_synthesize',         description: 'Analyze the week across all marketing dimensions', prompt_template: 'Write a comprehensive weekly marketing review for {brand.niche}.\nContext: {input}\nAudience: {brand.audience}\n\nCover: content performance highlights, engagement trends, top and bottom posts, audience growth, campaign progress, what worked and what did not.', params: {} },
          { id: 'step_plan',    name: 'Next Week Action Plan', tool: 'claude_synthesize',          description: 'Draft next week priorities for each agent', prompt_template: 'Based on this weekly review:\n{step_review.result}\n\nCreate next week\'s action plan for {brand.niche}:\n- Nova: visual content to create\n- Sage: strategy adjustment needed\n- Flux: automation and scheduling tasks\n- Aria: metrics to focus on\n- Key decisions to make and team tasks', params: {} },
        ],
      },
      // ── Trend Research ────────────────────────────────────────────────────────
      {
        agent_key: 'trend_research', name: 'Niche Trend Scan',
        description: 'Scan for emerging trends in your niche, cluster signals by relevance and decay risk, and surface 3–5 content angles your brand can act on now.',
        steps: [
          { id: 'step_scan',    name: 'Scan Trend Signals',    tool: 'claude_synthesize', description: 'Surface trending topics and signals in the niche', prompt_template: 'You are the Trend Research Agent. Scan for emerging trends relevant to a {brand.niche} brand targeting {brand.audience}.\n\nInput context: {input}\n\nIdentify 5–7 trend candidates. For each: trend name, why it is relevant to this brand, suggested content angle, channel fit (Instagram/TikTok/LinkedIn/YouTube), and decay risk (low/medium/high).', params: {} },
          { id: 'step_rank',    name: 'Rank & Filter',         tool: 'claude_synthesize', description: 'Rank trends by opportunity score and brand fit', prompt_template: 'From these trend candidates:\n{step_scan.result}\n\nRank them by opportunity score (relevance × volume × brand fit ÷ decay risk). Select the top 3. For each, write: opportunity summary (2 sentences), recommended content format, and the single most important angle to lead with. Audience: {brand.audience}. Tone: {brand.tone}.', params: {} },
          { id: 'step_brief',   name: 'Create Content Angles', tool: 'draft_content',     description: 'Turn top trends into actionable content angle proposals', prompt_template: 'Turn these top trend opportunities into 3 ready-to-brief content angles for {brand.brand_name}:\n{step_rank.result}\n\nFor each angle: working title, format (reel/post/carousel/thread), platform, hook idea, and key message. Tone: {brand.tone}.', params: {} },
        ],
      },
      {
        agent_key: 'trend_research', name: 'Viral Content Autopsy',
        description: 'Analyze what is going viral in your space, reverse-engineer the formula, and extract repeatable patterns for your brand.',
        steps: [
          { id: 'step_autopsy', name: 'Viral Pattern Analysis', tool: 'claude_synthesize', description: 'Reverse-engineer viral content patterns', prompt_template: 'Analyze viral content patterns in the {brand.niche} space.\nAudience: {brand.audience}\nContext/example: {input}\n\nIdentify: the hook formula used, emotional driver (curiosity/fear/status/relief), format type, posting time pattern, engagement mechanic (debate/save/share trigger), and what made it spread.', params: {} },
          { id: 'step_adapt',   name: 'Brand-Fit Adaptation',   tool: 'draft_content',     description: 'Adapt viral formula to brand voice', prompt_template: 'Using these viral patterns:\n{step_autopsy.result}\n\nCreate 2 content ideas adapted to {brand.brand_name} (niche: {brand.niche}, tone: {brand.tone}, audience: {brand.audience}) that use the same formula but fit the brand authentically. Include: format, hook, key message, CTA.', params: {} },
        ],
      },
      // ── Audience Research ─────────────────────────────────────────────────────
      {
        agent_key: 'audience_research', name: 'Audience Persona Builder',
        description: 'Build 2–3 detailed audience personas from real pain points, vocabulary, buying triggers, and objections — ready to hand to every other agent.',
        steps: [
          { id: 'step_pains',   name: 'Extract Pain Points',   tool: 'claude_synthesize', description: 'Surface top pains, desires, and vocabulary', prompt_template: 'You are the Audience Research Agent for {brand.brand_name} ({brand.niche}).\nTarget audience: {brand.audience}\nAdditional context: {input}\n\nExtract the top 5 pain points (with plausible verbatim quotes), top 5 desired outcomes, 3 main objections to buying, and the exact vocabulary this audience uses (jargon, phrases, metaphors they favour). Cite the type of source each insight likely comes from (reviews/forums/support).', params: {} },
          { id: 'step_persona', name: 'Build Personas',        tool: 'claude_synthesize', description: 'Create 2 detailed buyer personas', prompt_template: 'Using this audience intelligence:\n{step_pains.result}\n\nBuild 2 distinct buyer personas for {brand.brand_name}. For each: name, role/demographic, daily friction, success metric, where they spend time online, what would make them switch to this brand, what would make them churn, and their decision-making style.', params: {} },
          { id: 'step_hooks',   name: 'Messaging Hooks',       tool: 'draft_content',     description: 'Generate messaging hooks from persona insights', prompt_template: 'From these personas:\n{step_persona.result}\n\nCreate 5 messaging hooks for {brand.brand_name} that speak directly to this audience\'s vocabulary and pain. Each hook should be ≤12 words. Tone: {brand.tone}.', params: {} },
        ],
      },
      // ── SEO Research ──────────────────────────────────────────────────────────
      {
        agent_key: 'seo_research', name: 'Keyword Cluster Report',
        description: 'Generate keyword clusters by search intent and funnel stage, with content format recommendations and quick-win opportunities.',
        steps: [
          { id: 'step_seeds',   name: 'Generate Seed Keywords', tool: 'claude_synthesize', description: 'Generate seed and long-tail keywords', prompt_template: 'You are the SEO Keyword Research Agent for {brand.brand_name} ({brand.niche}).\nAudience: {brand.audience}\nSeed topic: {input}\n\nGenerate 20–30 keyword ideas across: head terms (high volume, high competition), mid-tail (specific, moderate), and long-tail (low competition, high intent). Group by search intent: informational | commercial | transactional.', params: {} },
          { id: 'step_cluster', name: 'Cluster & Prioritise',   tool: 'claude_synthesize', description: 'Cluster keywords and prioritize by opportunity', prompt_template: 'From these keywords:\n{step_seeds.result}\n\nCluster them into 5–8 topic clusters. For each cluster: cluster name, primary keyword, estimated intent (TOFU/MOFU/BOFU), competition level (low/medium/high), recommended content format (blog/landing page/comparison/tool), and why this cluster matters for {brand.niche}. Flag the top 3 quick-win clusters (low competition + commercial intent).', params: {} },
          { id: 'step_briefs',  name: 'Content Briefs',         tool: 'draft_content',     description: 'Create content briefs for top clusters', prompt_template: 'For the top 3 quick-win keyword clusters:\n{step_cluster.result}\n\nWrite a content brief for each: target keyword, title, audience ({brand.audience}), 5 key sections to cover, 3 competitor angles to beat, and the CTA. Tone: {brand.tone}.', params: {} },
        ],
      },
      // ── Hook Writing ──────────────────────────────────────────────────────────
      {
        agent_key: 'hook_writing', name: 'Hook Generator',
        description: 'Generate 10 scroll-stopping hooks for a topic across 5 distinct patterns — ready for captions, scripts, and ad copy.',
        steps: [
          { id: 'step_hooks',   name: 'Generate Hook Variants', tool: 'claude_synthesize', description: 'Generate 10 hook variations', prompt_template: 'You are the Hook Writing Agent for {brand.brand_name} ({brand.niche}).\nAudience: {brand.audience}\nTone: {brand.tone}\nTopic/angle: {input}\n\nGenerate 10 hook variations (each ≤12 words for video, ≤80 chars for text) across these patterns:\n1. Pattern interrupt\n2. Contrarian\n3. Stat-led\n4. Direct question\n5. Before/after\n6. ICP callout\n7. Story cold open\n8. Problem amplification\n9. FOMO/urgency\n10. Bold claim\n\nFor each: the hook text, pattern type, emotional driver (curiosity/status/fear/relief), and best channel fit.', params: {} },
          { id: 'step_top3',    name: 'Select & Justify Top 3', tool: 'draft_content',     description: 'Select the 3 strongest hooks with reasoning', prompt_template: 'From these hooks:\n{step_hooks.result}\n\nSelect the 3 strongest for {brand.brand_name} targeting {brand.audience}. For each: the hook, why it works for this audience, which platform it fits best, and a suggested follow-up sentence to build on it.', params: {} },
        ],
      },
      // ── Social Caption ────────────────────────────────────────────────────────
      {
        agent_key: 'social_caption', name: 'Multi-Platform Captions',
        description: 'Write A/B caption variants for your top 3 platforms — platform-native tone, right hashtags, one clear CTA each.',
        steps: [
          { id: 'step_draft',   name: 'Draft Captions',         tool: 'claude_synthesize', description: 'Write platform-native captions', prompt_template: 'You are the Social Caption Agent for {brand.brand_name}.\nTone: {brand.tone}\nAudience: {brand.audience}\nPlatforms: {brand.platforms}\nContent topic/hook: {input}\n\nWrite 2 caption variants (A and B) for each of the top 3 platforms in the list. Platform rules:\n- LinkedIn: 800–1500 chars, professional-human, 3–5 hashtags, no hashtag spam\n- Instagram: 150–400 chars, emojis if tone permits, 5–8 hashtags\n- TikTok: ≤150 chars, conversational, 2–4 hashtags\n- Twitter/X: ≤280 chars, punchy, no hashtags unless campaign-tagged\n\nEach caption must end with one clear CTA.', params: {} },
          { id: 'step_refine',  name: 'Refine & Schedule Hint', tool: 'draft_content',     description: 'Add scheduling hints and finalize', prompt_template: 'Review these captions for {brand.brand_name}:\n{step_draft.result}\n\nFor each platform pair: select the stronger variant with justification, add a posting-time recommendation (best window for each platform), and note any hashtags to refine. Produce final ready-to-post captions.', params: {} },
        ],
      },
      // ── Video Script ──────────────────────────────────────────────────────────
      {
        agent_key: 'video_script', name: 'Short-Form Script (≤60s)',
        description: 'Write a timed short-form video script with hook, on-screen text, b-roll notes, voiceover, and CTA placement.',
        steps: [
          { id: 'step_outline', name: 'Script Outline',          tool: 'claude_synthesize', description: 'Create structure and timing outline', prompt_template: 'You are the Video Script Agent for {brand.brand_name} ({brand.niche}).\nAudience: {brand.audience}\nTone: {brand.tone}\nTopic/brief: {input}\n\nCreate a short-form video outline (≤60 seconds):\n- 0:00–0:03: Hook (from Hook Writing Agent if available)\n- 0:03–0:15: Problem amplification\n- 0:15–0:45: Reveal / proof / key message\n- 0:45–0:60: CTA\n\nFor each segment: timing, voiceover script, on-screen text, b-roll/visual direction.', params: {} },
          { id: 'step_script',  name: 'Full Script',              tool: 'draft_content',     description: 'Write the complete timestamped script', prompt_template: 'Expand this outline into a complete short-form video script for {brand.brand_name}:\n{step_outline.result}\n\nDeliver: final VO lines (natural speech rhythm, {brand.tone} tone), on-screen text overlays (≤5 words each), b-roll descriptions, and a thumbnail concept (1 sentence visual direction).', params: {} },
        ],
      },
      {
        agent_key: 'video_script', name: 'Long-Form Script (5–10 min)',
        description: 'Write a structured long-form video script with retention beats every 90 seconds, timestamps, and a dual CTA.',
        steps: [
          { id: 'step_frame',   name: 'Framework & Segments',    tool: 'claude_synthesize', description: 'Define segments, retention beats, and CTA placements', prompt_template: 'You are the Video Script Agent for {brand.brand_name} ({brand.niche}).\nAudience: {brand.audience}\nTone: {brand.tone}\nTopic: {input}\n\nDesign a long-form video framework (5–10 min):\n- Cold open (0:00–0:30): hook + promise\n- 3–5 main segments with re-engagement beats every 60–90s\n- Recap (last 60s)\n- CTA: mid-point + end\n\nFor each segment: title, key message, duration, retention hook.', params: {} },
          { id: 'step_full',    name: 'Full Script Draft',        tool: 'draft_content',     description: 'Write complete long-form script', prompt_template: 'Write the complete long-form script for {brand.brand_name} based on this framework:\n{step_frame.result}\n\nInclude: VO lines, on-screen text, b-roll notes, timestamps, chapter titles for YouTube chapters, and thumbnail concept.', params: {} },
        ],
      },
      // ── Ad Copy ───────────────────────────────────────────────────────────────
      {
        agent_key: 'ad_copy', name: 'Meta Ad Copy Pack',
        description: 'Generate 8 Meta ad copy variations across 4 angles — pain-led, outcome-led, social proof, and FOMO — with A/B hypothesis for each.',
        steps: [
          { id: 'step_angles',  name: 'Define Angles & Strategy', tool: 'claude_synthesize', description: 'Plan ad angles and messaging strategy', prompt_template: 'You are the Ad Copy Agent for {brand.brand_name} ({brand.niche}).\nAudience: {brand.audience}\nOffer/campaign: {input}\nConversion goal: sign-up or purchase\n\nDefine 4 distinct ad angles:\n1. Pain-led (amplify the problem)\n2. Outcome-led (paint the result)\n3. Social proof (credibility-first)\n4. FOMO/urgency (scarcity or time)\n\nFor each angle: headline direction (≤40 chars), primary text direction (≤125 chars), hypothesis to test.', params: {} },
          { id: 'step_copy',    name: 'Write All Variations',     tool: 'claude_synthesize', description: 'Write complete ad copy for all angles', prompt_template: 'Write 2 complete Meta ad copy variants per angle for {brand.brand_name}:\n{step_angles.result}\n\nFor each variant:\n- Primary text (125 chars ideal)\n- Headline (40 chars max)\n- Description (30 chars)\n- CTA button label\n- Hypothesis being tested\n\nTone: {brand.tone}. Audience: {brand.audience}. Never fabricate testimonials.', params: {} },
          { id: 'step_google',  name: 'Google Search Ads',        tool: 'draft_content',     description: 'Write Google Search ad headlines and descriptions', prompt_template: 'Using the ad strategy:\n{step_angles.result}\n\nWrite Google Search ad assets for {brand.brand_name}:\n- 10 headlines (30 chars each, varied by angle)\n- 4 descriptions (90 chars each)\n- 3 sitelink text options\n\nFocus on search intent keywords for {brand.niche}.', params: {} },
        ],
      },
      // ── Thumbnail Design ──────────────────────────────────────────────────────
      {
        agent_key: 'thumbnail_design', name: 'YouTube Thumbnail Pack',
        description: 'Design 3 CTR-optimized YouTube thumbnail concepts with layout, focal element, palette, overlay text, and A/B test hypothesis.',
        steps: [
          { id: 'step_concepts', name: 'Generate 3 Concepts',    tool: 'claude_synthesize', description: 'Create 3 distinct thumbnail visual concepts', prompt_template: 'You are the Thumbnail Design Agent for {brand.brand_name} ({brand.niche}).\nVideo title/hook: {input}\nBrand tone: {brand.tone}\n\nCreate 3 distinct thumbnail concepts. For each:\n- Layout (describe where focal element and text sit)\n- Focal element (face emotion / product / graphic)\n- Dominant emotion to convey\n- Color palette (2–3 hex codes, high contrast)\n- Overlay text (≤4 words, must be readable at 200px wide)\n- What NOT to include\n- CTR hypothesis (why this will outperform average)', params: {} },
          { id: 'step_ab',       name: 'A/B Test Brief',          tool: 'draft_content',     description: 'Define the A/B test pair and rationale', prompt_template: 'From these 3 thumbnail concepts for {brand.brand_name}:\n{step_concepts.result}\n\nSelect the 2 strongest as the A/B test pair. Write the test brief:\n- Concept A (full spec)\n- Concept B (full spec)\n- What variable is being tested\n- Success metric (CTR target)\n- Recommended design tools (Canva/Figma) and how to execute each concept.', params: {} },
        ],
      },
      {
        agent_key: 'thumbnail_design', name: 'Social Ad Creative Brief',
        description: 'Write a visual creative brief for Meta/LinkedIn/TikTok ad creatives — single image and carousel formats.',
        steps: [
          { id: 'step_brief',    name: 'Creative Brief',          tool: 'claude_synthesize', description: 'Write full creative brief for ad visuals', prompt_template: 'You are the Thumbnail Design Agent for {brand.brand_name} ({brand.niche}).\nCampaign/offer: {input}\nAudience: {brand.audience}\nTone: {brand.tone}\n\nWrite a visual creative brief for social ad creatives covering:\n1. Single image ad: layout, focal element, copy placement, palette, emotion\n2. Carousel (3 frames): frame 1 hook visual, frame 2 proof/feature, frame 3 CTA\n3. Video cover frame: 1-sentence visual direction\n\nFor each: what to avoid, design notes, and the brand rule that must be maintained.', params: {} },
          { id: 'step_deliver',  name: 'Production Checklist',    tool: 'draft_content',     description: 'Produce a delivery-ready creative checklist', prompt_template: 'From this creative brief for {brand.brand_name}:\n{step_brief.result}\n\nCreate a production-ready checklist:\n- Asset dimensions for each format (Meta: 1080×1080, 1200×628, etc.)\n- File format requirements\n- Text safe zones\n- Brand elements required (logo placement, color, font)\n- QA checklist (text legibility, contrast ratio, CTA visibility)', params: {} },
        ],
      },
      // ── Meta Ads ──────────────────────────────────────────────────────────────
      {
        agent_key: 'meta_ads', name: 'Campaign Structure Plan',
        description: 'Design a complete Meta campaign structure — objective, ad sets, audiences, budget allocation, and decision rules for scaling.',
        steps: [
          { id: 'step_structure', name: 'Campaign Architecture',  tool: 'claude_synthesize', description: 'Design the full campaign structure', prompt_template: 'You are the Meta Ads Manager for {brand.brand_name} ({brand.niche}).\nAudience: {brand.audience}\nCampaign goal: {input}\n\nDesign a Meta campaign structure:\n1. Campaign objective (awareness/traffic/leads/sales)\n2. 3 ad set audience types: cold (broad/LAL), warm (retargeting), hot (CRM/custom)\n3. Budget allocation % across cold/warm/hot\n4. Placement recommendation (Reels/Feed/Stories)\n5. Conversion event to optimise for\n6. Exclusion audiences', params: {} },
          { id: 'step_rules',     name: 'Decision Rules & KPIs',  tool: 'claude_synthesize', description: 'Define performance thresholds and scaling rules', prompt_template: 'For this campaign structure:\n{step_structure.result}\n\nDefine operational rules for {brand.brand_name}:\n- Target CPA: set based on average LTV assumption\n- Target ROAS: set based on margin assumption\n- Pause rule: CPA > 1.5× target after 2× spend, OR CTR < 0.8% after 24h\n- Scale rule: ROAS ≥ target 2 consecutive days → increase budget ≤20%/day\n- Creative fatigue rule: frequency > 3 + CTR drop >30% → request new creative\n- Frequency cap recommendation', params: {} },
          { id: 'step_launch',    name: 'Launch Checklist',       tool: 'draft_content',     description: 'Create a pre-launch QA checklist', prompt_template: 'Create a complete Meta ads launch checklist for {brand.brand_name}:\n{step_rules.result}\n\nCover: pixel verification, conversion event test, audience sizes, creative specs, UTM parameters, brand safety exclusions, budget approval, and post-launch monitoring schedule (24h, 72h, 7d checkpoints).', params: {} },
        ],
      },
      {
        agent_key: 'meta_ads', name: 'Daily Performance Report',
        description: 'Generate a structured daily performance report with spend summary, KPI status, decisions made, and next recommended actions.',
        steps: [
          { id: 'step_report',    name: 'Performance Summary',    tool: 'claude_synthesize', description: 'Write a structured daily performance report', prompt_template: 'You are the Meta Ads Manager for {brand.brand_name} ({brand.niche}).\nPerformance data or context: {input}\n\nWrite a structured daily Meta ads report:\n- Spend summary\n- CPA vs target (green/amber/red)\n- ROAS vs target\n- Top performing ad set and creative\n- Decisions made today (paused/scaled/iterated)\n- Requests to other agents (new creative needed?)\n- Tomorrow\'s focus', params: {} },
          { id: 'step_actions',   name: 'Action Items',           tool: 'draft_content',     description: 'List specific actions for each team member', prompt_template: 'From this performance report for {brand.brand_name}:\n{step_report.result}\n\nList specific action items:\n- Ad Copy Agent: any new variations needed\n- Thumbnail Design Agent: any creative refreshes\n- Analytics Agent: what to monitor\n- Campaign Manager: any budget decisions needed\n\nPrioritize by urgency (do today / do this week / monitor).', params: {} },
        ],
      },
    ];
    for (const wf of _seeds) {
      await pool.query(
        `INSERT INTO agent_workflows (agent_key, name, description, steps) VALUES ($1, $2, $3, $4) ON CONFLICT (agent_key, name) DO NOTHING`,
        [wf.agent_key, wf.name, wf.description, JSON.stringify(wf.steps)]
      ).catch(() => undefined);
    }
  }
  // ── End Agent Workflow & Tools ────────────────────────────────────────────────

  // ── User Agent Foundation (Phase 4) ──────────────────────────────────────────
  await pool.query(`
    CREATE TABLE IF NOT EXISTS brand_profiles (
      id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      user_id     TEXT NOT NULL UNIQUE REFERENCES users(id) ON DELETE CASCADE,
      brand_name  TEXT NOT NULL DEFAULT '',
      niche       TEXT NOT NULL DEFAULT '',
      tone        TEXT NOT NULL DEFAULT 'professional',
      audience    TEXT NOT NULL DEFAULT '',
      goals       TEXT[] NOT NULL DEFAULT '{}',
      platforms   TEXT[] NOT NULL DEFAULT '{}',
      website     TEXT NOT NULL DEFAULT '',
      extra_notes TEXT NOT NULL DEFAULT '',
      setup_done  BOOLEAN NOT NULL DEFAULT false,
      created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `).catch(() => undefined);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS user_agent_memory (
      id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      user_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      agent_key  TEXT NOT NULL DEFAULT 'global',
      mem_type   TEXT NOT NULL DEFAULT 'general',
      key        TEXT NOT NULL,
      value      TEXT NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      UNIQUE(user_id, agent_key, key)
    );
  `).catch(() => undefined);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS user_agent_tasks (
      id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      user_id     TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      agent_key   TEXT NOT NULL,
      task_type   TEXT NOT NULL DEFAULT 'proposal',
      title       TEXT NOT NULL,
      body        TEXT NOT NULL DEFAULT '',
      payload     JSONB NOT NULL DEFAULT '{}',
      status      TEXT NOT NULL DEFAULT 'pending',
      expires_at  TIMESTAMPTZ NOT NULL DEFAULT NOW() + INTERVAL '48 hours',
      decided_at  TIMESTAMPTZ,
      created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `).catch(() => undefined);
  // Phase 9 — agent_drafts: executed proposals (blog drafts + other content artifacts)
  await pool.query(`
    CREATE TABLE IF NOT EXISTS agent_drafts (
      id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      user_id      TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      agent_key    TEXT NOT NULL,
      task_id      UUID REFERENCES user_agent_tasks(id) ON DELETE SET NULL,
      task_type    TEXT NOT NULL DEFAULT 'content_post',
      title        TEXT NOT NULL,
      content      TEXT NOT NULL DEFAULT '',
      payload      JSONB NOT NULL DEFAULT '{}',
      blog_post_id TEXT,
      created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `).catch(() => undefined);
  await pool.query(`CREATE INDEX IF NOT EXISTS agent_drafts_user_idx ON agent_drafts (user_id, created_at DESC);`).catch(() => undefined);

  // Phase 10 — scheduled auto-runs per user per agent
  await pool.query(`
    CREATE TABLE IF NOT EXISTS user_agent_schedules (
      id                   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      user_id              TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      agent_key            TEXT NOT NULL,
      frequency            TEXT NOT NULL DEFAULT 'off',
      run_hour             INT  NOT NULL DEFAULT 9,
      run_day              INT  NOT NULL DEFAULT 1,
      enabled              BOOLEAN NOT NULL DEFAULT false,
      last_scheduled_run_at TIMESTAMPTZ,
      created_at           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      UNIQUE(user_id, agent_key)
    );
  `).catch(() => undefined);
  // ── End User Agent Foundation ─────────────────────────────────────────────────

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
  // Migrate due_date from DATE to TIMESTAMPTZ to support time-of-day
  await pool.query(`ALTER TABLE tasks ALTER COLUMN due_date TYPE TIMESTAMPTZ USING due_date::TIMESTAMPTZ;`).catch(() => undefined);

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

  // ── Workflows ─────────────────────────────────────────────────────────────────
  await pool.query(`
    CREATE TABLE IF NOT EXISTS workflows (
      id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      user_id     TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      org_id      TEXT REFERENCES organizations(id) ON DELETE CASCADE,
      name        TEXT NOT NULL,
      description TEXT,
      status      TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','active','inactive')),
      nodes       JSONB NOT NULL DEFAULT '[]',
      edges       JSONB NOT NULL DEFAULT '[]',
      created_at  TIMESTAMPTZ DEFAULT NOW(),
      updated_at  TIMESTAMPTZ DEFAULT NOW()
    );
  `).catch(() => undefined);
  await pool.query(`CREATE INDEX IF NOT EXISTS workflows_user_idx ON workflows (user_id, created_at DESC);`).catch(() => undefined);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS workflow_runs (
      id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      workflow_id  UUID NOT NULL REFERENCES workflows(id) ON DELETE CASCADE,
      user_id      TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      status       TEXT NOT NULL DEFAULT 'running' CHECK (status IN ('running','completed','failed','cancelled')),
      trigger_data JSONB DEFAULT '{}',
      logs         JSONB DEFAULT '[]',
      started_at   TIMESTAMPTZ DEFAULT NOW(),
      completed_at TIMESTAMPTZ
    );
  `).catch(() => undefined);
  await pool.query(`CREATE INDEX IF NOT EXISTS workflow_runs_workflow_idx ON workflow_runs (workflow_id, started_at DESC);`).catch(() => undefined);
  // ── End Workflows ─────────────────────────────────────────────────────────────

  dbReady = true;
}

// ── Stripe Webhook ──
app.post('/webhooks/stripe', async (req: Request, res: Response) => {
  if (!stripe) return res.status(503).json({ error: 'Stripe not configured' });
  const sig = req.headers['stripe-signature'] as string;
  const rawBody = (req as any).rawBody as Buffer;
  if (!sig || !rawBody) return res.status(400).json({ error: 'Missing signature or body' });

  let event: Stripe.Event;
  try {
    event = stripe.webhooks.constructEvent(rawBody, sig, STRIPE_WEBHOOK_SECRET);
  } catch (err: any) {
    logger.error('Stripe webhook signature error:', err.message);
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
    logger.error('Stripe webhook handler error:', e);
  }

  res.json({ received: true });
});

function verifyMetaWebhookSignature(req: Request, appSecret: string) {
  if (!appSecret) {
    // Require a configured secret in production; skip check only in dev/staging
    return config.nodeEnv !== 'production';
  }
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
  const verifyToken = config.metaWebhookVerifyToken;

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
  const verifyToken = config.metaWebhookVerifyToken;

  if (mode === 'subscribe' && verifyToken && token === verifyToken) {
    return res.status(200).send(challenge);
  }
  return res.status(403).send('Forbidden');
});

app.post('/webhooks/meta', async (req: Request, res: Response) => {
  // Always respond 200 quickly so Facebook doesn't retry
  res.status(200).json({ ok: true });

  try {
    const appSecret = config.facebookAppSecret;
    if (!verifyMetaWebhookSignature(req, appSecret)) {
      logger.warn('Meta webhook: invalid or missing signature — discarding');
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
    logger.error('Meta webhook processing error:', err);
  }
});

// Mirror POST webhook to the v1 alias path as well
app.post('/api/v1/webhooks/facebook', async (req: Request, res: Response) => {
  res.status(200).json({ ok: true });
  try {
    const appSecret = config.facebookAppSecret;
    if (!verifyMetaWebhookSignature(req, appSecret)) {
      logger.warn('Facebook v1 webhook: invalid or missing signature — discarding');
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
    logger.error('Facebook v1 webhook error:', err);
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
      try { pageToken = decryptIntegrationSecret(String(row.access_token_encrypted)); } catch (_err) { /* ignore */ }
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
    logger.error('v1 facebook webhook-subscribe error:', err);
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
  token_version: number;
  email_verified: boolean;
  failed_login_attempts: number;
  locked_until: string | null;
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
const inMemoryPlatformConfigs = new Map<string, PlatformConfigRow>();

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

// Returns { apiKey, fromEmail, fromName } for Resend, reading platform_configs first then env-var fallback.
async function getResendConfig(): Promise<{ apiKey: string; fromEmail: string; fromName: string }> {
  const cfg = await getPlatformConfig('resend').catch(() => ({} as Record<string, string>));
  const apiKey    = String(cfg.apiKey    || process.env.RESEND_API_KEY    || '').trim();
  const fromEmail = String(cfg.fromEmail || process.env.RESEND_FROM_EMAIL || 'noreply@resend.dev').trim();
  const fromName  = String(cfg.fromName  || process.env.RESEND_FROM_NAME  || '').trim();
  return { apiKey, fromEmail, fromName };
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
      : bcrypt.hashSync(input.password, 12);

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
    token_version: existing?.token_version ?? 1,
    email_verified: existing?.email_verified ?? false,
    failed_login_attempts: existing?.failed_login_attempts ?? 0,
    locked_until: existing?.locked_until ?? null,
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
    logger.error('Database initialization failed:', err);
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

async function getUserPlanName(userId: string): Promise<string> {
  if (!hasDatabase()) return 'Free';
  try {
    const { rows } = await dbQuery<{ name: string }>(
      `SELECT pp.name FROM subscriptions s
       JOIN pricing_plans pp ON pp.id = s.plan_id
       WHERE s.user_id = $1 AND s.status IN ('active','trialing')
       ORDER BY s.created_at DESC LIMIT 1`,
      [userId]
    );
    return rows[0]?.name ?? 'Free';
  } catch (err) {
    logger.error('Unhandled error:', err);
    return 'Free';
  }
}

function userToAuthPayload(user: DbUserRow, planName?: string) {
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
    planName: planName ?? 'Free',
    emailVerified: user.email_verified ?? false,
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

const JWT_EXPIRES_IN = '7d';

function signToken(userId: string, email: string, tokenVersion = 1) {
  return jwt.sign({ userId, email, tokenVersion }, JWT_SECRET, { expiresIn: JWT_EXPIRES_IN });
}

function getAuthUser(req: Request) {
  const token = req.headers.authorization?.split(' ')[1];
  if (!token) return null;
  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    if (
      typeof decoded !== 'object' ||
      decoded === null ||
      typeof (decoded as Record<string, unknown>).userId !== 'string' ||
      !(decoded as Record<string, unknown>).userId
    ) {
      return null;
    }
    const payload = decoded as Record<string, unknown>;
    return {
      userId: payload.userId as string,
      email: typeof payload.email === 'string' ? payload.email : '',
      tokenVersion: typeof payload.tokenVersion === 'number' ? payload.tokenVersion : null,
    };
  } catch (err) {
    logger.error('Unhandled error:', err);
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
  const hash = await bcrypt.hash(password, 12);
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
      token_version: 1,
      email_verified: false,
      failed_login_attempts: 0,
      locked_until: null,
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
      name: 'Free',
      description: 'For creators exploring AI content with no commitment.',
      monthlyPrice: 0,
      yearlyPrice: 0,
      monthlyFeatures: [
        '100 AI credits per month',
        '2 social accounts',
        'AI text generation (✦1 per post)',
        'Content calendar',
        '20+ card templates',
        'Basic analytics',
        '1 team seat',
      ],
      yearlyFeatures: [
        '100 AI credits per month',
        '2 social accounts',
        'AI text generation (✦1 per post)',
        'Content calendar',
        '20+ card templates',
        'Basic analytics',
        '1 team seat',
      ],
    },
    {
      name: 'Pro',
      description: 'For active brands and creators that need real AI power to publish at scale.',
      monthlyPrice: 29,
      yearlyPrice: 276,
      featured: true,
      monthlyFeatures: [
        '2,000 AI credits per month',
        '8 social accounts',
        'AI image generation — 6 models (✦3–8)',
        'Improve Prompt AI feature',
        'Custom brand voice',
        'Bulk scheduling & auto-republish',
        'Advanced analytics & audience insights',
        '200+ card templates + custom templates',
        '3 team seats',
        'Priority support',
      ],
      yearlyFeatures: [
        '2,000 AI credits per month',
        '8 social accounts',
        'AI image generation — 6 models (✦3–8)',
        'Improve Prompt AI feature',
        'Custom brand voice',
        'Bulk scheduling & auto-republish',
        'Advanced analytics & audience insights',
        '200+ card templates + custom templates',
        '3 team seats',
        'Priority support',
        'Save ~20% vs monthly billing',
      ],
    },
    {
      name: 'Agency',
      description: 'For agencies and power users running full-stack content operations.',
      monthlyPrice: 79,
      yearlyPrice: 756,
      monthlyFeatures: [
        '6,000 AI credits per month',
        'Unlimited social accounts',
        'AI video generation — 3 models (✦20–35)',
        'Full image editing suite (✦1–5)',
        'Premium AI models — Mystic (✦8)',
        'White-label exports',
        'Client workspaces (up to 10)',
        'API access',
        'Dedicated support',
        '10 team seats',
      ],
      yearlyFeatures: [
        '6,000 AI credits per month',
        'Unlimited social accounts',
        'AI video generation — 3 models (✦20–35)',
        'Full image editing suite (✦1–5)',
        'Premium AI models — Mystic (✦8)',
        'White-label exports',
        'Client workspaces (up to 10)',
        'API access',
        'Dedicated support',
        '10 team seats',
        'Save ~20% vs monthly billing',
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
    logger.info(`Seeded ${inMemoryPricingPlansById.size} pricing plans in-memory`);
    return;
  }

  // Check if plans already exist
  const existing = await dbQuery<{ count: number }>(
    'SELECT COUNT(*) as count FROM pricing_plans'
  );

  if (existing.rows[0]?.count > 0) {
    logger.info('Pricing plans already seeded in database');
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
  logger.info(`Seeded 6 pricing plans in database (${plans.length} plan types)`);
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

// Validates that the token_version embedded in the JWT matches the DB.
// Returns false and sends 401 if mismatched (user ran logout-all-devices).
async function checkTokenVersion(auth: { userId: string; tokenVersion: number | null }, res: Response): Promise<boolean> {
  if (auth.tokenVersion === null || !hasDatabase()) return true; // old tokens without version — allow through
  try {
    const { rows } = await dbQuery<{ token_version: number }>(
      `SELECT token_version FROM users WHERE id = $1`,
      [auth.userId]
    );
    if (!rows[0]) { res.status(401).json({ success: false, error: 'Unauthorized' }); return false; }
    if (rows[0].token_version !== auth.tokenVersion) {
      res.status(401).json({ success: false, error: 'Session has been revoked. Please log in again.' });
      return false;
    }
    return true;
  } catch (err) {
    logger.error('Unhandled error:', err);
    return true; // DB error — fail open to avoid blocking all requests
  }
}

async function requireAdmin(req: Request, res: Response): Promise<DbUserRow | null> {
  const auth = requireAuth(req, res);
  if (!auth) return null;
  // Admin routes require DB access — fail-closed if DB is unavailable so a
  // revoked session can't slip through when the DB is down.
  if (!hasDatabase()) {
    res.status(503).json({ success: false, error: 'Admin operations require a database connection.' });
    return null;
  }
  const user = await getUserById(auth.userId);
  if (!user || user.role !== 'admin') {
    res.status(403).json({ success: false, error: 'Admin access required' });
    return null;
  }
  // Always validate token_version for admin operations.
  if (auth.tokenVersion !== null && user.token_version !== auth.tokenVersion) {
    res.status(401).json({ success: false, error: 'Session has been revoked. Please log in again.' });
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
  daky:             { name: 'Daky',    role: 'Content Writer',        icon: '✦', color: '#5B6CF9', memoryKeywords: [] },
  nova:             { name: 'Nova',    role: 'Creative Director',     icon: '◉', color: '#EC4899', memoryKeywords: ['brand','voice','visual','content','product','audience'] },
  sage:             { name: 'Sage',    role: 'Strategy Analyst',      icon: '◈', color: '#10B981', memoryKeywords: ['goal','competit','strategy','industry','market','target','campaign'] },
  aria:             { name: 'Aria',    role: 'Analytics & Perf.',     icon: '⊕', color: '#F59E0B', memoryKeywords: ['analytic','performance','kpi','metric','business'] },
  flux:             { name: 'Flux',    role: 'Automation',            icon: '⟳', color: '#8B5CF6', memoryKeywords: ['automat','workflow','platform','social','schedule'] },
  trend_research:   { name: 'Trend',   role: 'Trend Research',        icon: '◎', color: '#06B6D4', memoryKeywords: ['trend','viral','niche','topic','content','platform'] },
  audience_research:{ name: 'Persona', role: 'Audience Research',    icon: '◑', color: '#7C3AED', memoryKeywords: ['audience','persona','pain','objection','customer','demographic'] },
  seo_research:     { name: 'SEO',     role: 'SEO Keyword Research',  icon: '⊗', color: '#059669', memoryKeywords: ['seo','keyword','search','organic','traffic','content'] },
  hook_writing:     { name: 'Hook',    role: 'Hook Writing',          icon: '⚡', color: '#D97706', memoryKeywords: ['hook','headline','attention','opening','subject','ad'] },
  social_caption:   { name: 'Caption', role: 'Social Caption',        icon: '✎', color: '#DB2777', memoryKeywords: ['caption','social','instagram','tiktok','linkedin','hashtag'] },
  video_script:     { name: 'Script',  role: 'Video Script',          icon: '▶', color: '#DC2626', memoryKeywords: ['video','script','youtube','reels','tiktok','short','long'] },
  ad_copy:          { name: 'Ads',     role: 'Ad Copy',               icon: '◆', color: '#EA580C', memoryKeywords: ['ad','copy','meta','google','facebook','conversion','cta'] },
  thumbnail_design: { name: 'Thumb',   role: 'Thumbnail Design',      icon: '▣', color: '#9333EA', memoryKeywords: ['thumbnail','youtube','visual','design','creative','click'] },
  meta_ads:         { name: 'Meta',    role: 'Paid Social Manager',   icon: '⊛', color: '#1877F2', memoryKeywords: ['meta','facebook','instagram','paid','campaign','budget','roas'] },
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
  } catch (_err) { /* non-fatal */ }
}

async function triggerAgentCompilation(userId: string): Promise<void> {
  for (const key of Object.keys(AGENT_DEFS)) {
    compileAgentSkill(userId, key).catch(() => undefined);
  }
}

// ── End Agent Helpers ─────────────────────────────────────────────────────────

const authRegisterSchema = z.object({
  email: z.string().email(),
  password: z.string().min(8).max(72, { message: 'Password must be at most 72 characters (bcrypt limitation)' }),
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
app.post('/api/auth/register', authLimiter, validateBody(authRegisterSchema), async (req: Request, res: Response) => {
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
    sendEmailVerification(user.id, user.email).catch(() => undefined);
    const token = signToken(user.id, user.email, user.token_version ?? 1);

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

app.post('/api/auth/login', authLimiter, validateBody(authLoginSchema), async (req: Request, res: Response) => {
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

    // Check account lockout
    if (user.locked_until && new Date(user.locked_until) > new Date()) {
      const minutesLeft = Math.ceil((new Date(user.locked_until).getTime() - Date.now()) / 60000);
      return res.status(429).json({
        success: false,
        error: `Account temporarily locked due to too many failed attempts. Try again in ${minutesLeft} minute${minutesLeft === 1 ? '' : 's'}.`,
      });
    }

    const valid = await bcrypt.compare(password, user.password_hash);
    if (!valid) {
      if (hasDatabase()) {
        const newAttempts = (user.failed_login_attempts || 0) + 1;
        const lockUntil = newAttempts >= 5 ? new Date(Date.now() + 30 * 60 * 1000) : null;
        await dbQuery(
          'UPDATE users SET failed_login_attempts = $1, locked_until = $2 WHERE id = $3',
          [newAttempts, lockUntil, user.id]
        );
        if (lockUntil) {
          logger.warn({ userId: user.id, ip: req.ip }, 'auth:account_locked');
        }
      }
      return res.status(400).json({ success: false, error: 'Invalid credentials' });
    }

    // Reset lockout counters on successful login
    if (hasDatabase()) {
      await dbQuery('UPDATE users SET failed_login_attempts = 0, locked_until = NULL WHERE id = $1', [user.id]);
    }
    await updateLastLogin(user.id);
    logger.info({ userId: user.id, ip: req.ip, ua: req.headers['user-agent'] }, 'auth:login');
    const refreshedUser = (await getUserById(user.id)) || user;
    const token = signToken(user.id, user.email, refreshedUser.token_version ?? 1);
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

    const planName = await getUserPlanName(auth.userId);
    return res.json({
      success: true,
      user: userToAuthPayload(user, planName),
    });
  } catch (error) {
    logger.error('Me error:', error);
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
      logger.error('Profile media sync error:', error);
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

app.post('/api/auth/change-password', passwordLimiter, async (req: Request, res: Response) => {
  const auth = requireAuth(req, res);
  if (!auth) return;
  const { currentPassword, newPassword } = req.body as Record<string, string>;
  if (!currentPassword || !newPassword) {
    return res.status(400).json({ success: false, error: 'currentPassword and newPassword are required' });
  }
  if (newPassword.length < 8) {
    return res.status(400).json({ success: false, error: 'New password must be at least 8 characters' });
  }
  if (newPassword.length > 72) {
    return res.status(400).json({ success: false, error: 'New password must be at most 72 characters (bcrypt limitation)' });
  }
  try {
    const { rows } = await dbQuery<{ password_hash: string }>(
      'SELECT password_hash FROM users WHERE id = $1', [auth.userId]
    );
    if (!rows[0]) return res.status(404).json({ success: false, error: 'User not found' });
    const valid = await bcrypt.compare(currentPassword, rows[0].password_hash);
    if (!valid) return res.status(400).json({ success: false, error: 'Current password is incorrect' });
    const newHash = await bcrypt.hash(newPassword, 12);
    await dbQuery('UPDATE users SET password_hash = $1 WHERE id = $2', [newHash, auth.userId]);
    return res.json({ success: true });
  } catch (e) {
    logger.error({ e }, 'change_password_failed');
    return res.status(500).json({ success: false, error: 'Failed to change password' });
  }
});

// ── Password reset helpers ────────────────────────────────────────────────────

async function sendPasswordResetEmail(email: string, resetUrl: string): Promise<void> {
  const { apiKey, fromEmail, fromName } = await getResendConfig();
  if (!apiKey) {
    logger.warn('Resend not configured — password reset email not sent');
    return;
  }
  const resend = new Resend(apiKey);
  await resend.emails.send({
    from: fromName ? `${fromName} <${fromEmail}>` : fromEmail,
    to: email,
    subject: 'Reset your password',
    html: `
      <p>You requested a password reset. Click the link below to set a new password. This link expires in 1 hour.</p>
      <p><a href="${resetUrl}">${resetUrl}</a></p>
      <p>If you did not request this, you can safely ignore this email.</p>
    `,
  });
}

async function sendEmailVerification(userId: string, email: string): Promise<void> {
  if (!hasDatabase()) return;
  const rawToken = randomBytes(32).toString('hex');
  const tokenHash = createHmac('sha256', JWT_SECRET).update(rawToken).digest('hex');
  await dbQuery(
    `INSERT INTO email_verification_tokens (id, user_id, token_hash, expires_at)
     VALUES ($1, $2, $3, NOW() + INTERVAL '24 hours')
     ON CONFLICT DO NOTHING`,
    [randomUUID(), userId, tokenHash]
  );
  const { apiKey, fromEmail, fromName } = await getResendConfig();
  if (!apiKey) return;
  const appUrl = (process.env.VITE_APP_URL || 'https://marketing.dakyworld.com').replace(/\/$/, '');
  const verifyUrl = `${appUrl}/verify-email#token=${rawToken}`;
  const resend = new Resend(apiKey);
  await resend.emails.send({
    from: fromName ? `${fromName} <${fromEmail}>` : fromEmail,
    to: email,
    subject: 'Verify your email address',
    html: `
      <p>Thanks for signing up! Please verify your email address by clicking the link below. This link expires in 24 hours.</p>
      <p><a href="${verifyUrl}">${verifyUrl}</a></p>
    `,
  });
}

// POST /api/auth/forgot-password
app.post('/api/auth/forgot-password', authLimiter, async (req: Request, res: Response) => {
  // Always return 200 regardless — don't reveal if email exists.
  // MIN_RESPONSE_MS pads every code path to the same wall-clock time so an
  // attacker cannot enumerate registered emails via response timing.
  const SAFE_RESPONSE = { success: true, message: 'If that email exists, a reset link has been sent.' };
  const MIN_RESPONSE_MS = 600;
  const t0 = Date.now();
  const safeReturn = async () => {
    const elapsed = Date.now() - t0;
    if (elapsed < MIN_RESPONSE_MS) await new Promise(r => setTimeout(r, MIN_RESPONSE_MS - elapsed));
    return res.json(SAFE_RESPONSE);
  };

  try {
    const email = String(req.body.email || '').trim().toLowerCase();
    if (!email || !email.includes('@')) return safeReturn();
    if (!hasDatabase()) return safeReturn();

    const user = await findUserByEmail(email);
    if (!user) return safeReturn();

    // Invalidate existing unused tokens for this user
    await dbQuery(
      `UPDATE password_reset_tokens SET used_at = NOW() WHERE user_id = $1 AND used_at IS NULL`,
      [user.id]
    );

    const rawToken = randomBytes(32).toString('hex');
    const tokenHash = createHmac('sha256', JWT_SECRET).update(rawToken).digest('hex');
    await dbQuery(
      `INSERT INTO password_reset_tokens (id, user_id, token_hash, expires_at)
       VALUES ($1, $2, $3, NOW() + INTERVAL '1 hour')`,
      [randomUUID(), user.id, tokenHash]
    );

    const appUrl = config.appUrl;
    const resetUrl = `${appUrl}/reset-password#token=${rawToken}`;
    await sendPasswordResetEmail(user.email, resetUrl);
    logger.info({ userId: user.id }, 'password_reset_requested');
    return safeReturn();
  } catch (error) {
    logger.error({ error }, 'forgot_password_failed');
    return safeReturn();
  }
});

// POST /api/auth/reset-password
app.post('/api/auth/reset-password', authLimiter, async (req: Request, res: Response) => {
  try {
    const token = String(req.body.token || '').trim();
    const newPassword = String(req.body.newPassword || '');
    if (!token || !newPassword) {
      return res.status(400).json({ success: false, error: 'Token and newPassword are required' });
    }
    if (newPassword.length < 8) {
      return res.status(400).json({ success: false, error: 'Password must be at least 8 characters' });
    }
    if (newPassword.length > 72) {
      return res.status(400).json({ success: false, error: 'Password must be at most 72 characters (bcrypt limitation)' });
    }
    if (!hasDatabase()) {
      return res.status(503).json({ success: false, error: 'Service unavailable' });
    }

    const tokenHash = createHmac('sha256', JWT_SECRET).update(token).digest('hex');
    const { rows } = await dbQuery<{ id: string; user_id: string; expires_at: string; used_at: string | null }>(
      `SELECT id, user_id, expires_at, used_at FROM password_reset_tokens WHERE token_hash = $1`,
      [tokenHash]
    );
    const record = rows[0];
    if (!record || record.used_at || new Date(record.expires_at) < new Date()) {
      return res.status(400).json({ success: false, error: 'Invalid or expired reset link' });
    }

    const newHash = await bcrypt.hash(newPassword, 12);
    // Mark token used, update password, and bump token_version to invalidate all existing sessions
    await dbQuery(
      `UPDATE password_reset_tokens SET used_at = NOW() WHERE id = $1`,
      [record.id]
    );
    await dbQuery(
      `UPDATE users SET password_hash = $1, token_version = COALESCE(token_version, 1) + 1 WHERE id = $2`,
      [newHash, record.user_id]
    );
    logger.info({ userId: record.user_id }, 'password_reset_completed');
    return res.json({ success: true, message: 'Password has been reset. Please log in with your new password.' });
  } catch (error) {
    logger.error({ error }, 'reset_password_failed');
    return res.status(500).json({ success: false, error: 'Failed to reset password' });
  }
});

// POST /api/auth/verify-email
app.post('/api/auth/verify-email', async (req: Request, res: Response) => {
  try {
    const token = String(req.body.token || '').trim();
    if (!token) return res.status(400).json({ success: false, error: 'Token is required' });
    if (!hasDatabase()) return res.status(503).json({ success: false, error: 'Service unavailable' });

    const tokenHash = createHmac('sha256', JWT_SECRET).update(token).digest('hex');
    const { rows } = await dbQuery<{ id: string; user_id: string; expires_at: string; used_at: string | null }>(
      `SELECT id, user_id, expires_at, used_at FROM email_verification_tokens WHERE token_hash = $1`,
      [tokenHash]
    );
    const record = rows[0];
    if (!record || record.used_at || new Date(record.expires_at) < new Date()) {
      return res.status(400).json({ success: false, error: 'Invalid or expired verification link' });
    }

    await dbQuery(`UPDATE email_verification_tokens SET used_at = NOW() WHERE id = $1`, [record.id]);
    await dbQuery(`UPDATE users SET email_verified = true WHERE id = $1`, [record.user_id]);
    logger.info({ userId: record.user_id }, 'email_verified');
    return res.json({ success: true, message: 'Email verified successfully.' });
  } catch (error) {
    logger.error({ error }, 'verify_email_failed');
    return res.status(500).json({ success: false, error: 'Failed to verify email' });
  }
});

// POST /api/auth/resend-verification
app.post('/api/auth/resend-verification', authLimiter, async (req: Request, res: Response) => {
  try {
    const auth = requireAuth(req, res);
    if (!auth) return;
    if (!hasDatabase()) return res.status(503).json({ success: false, error: 'Service unavailable' });
    const user = await getUserById(auth.userId);
    if (!user) return res.status(404).json({ success: false, error: 'User not found' });
    if (user.email_verified) return res.json({ success: true, message: 'Email already verified' });
    await sendEmailVerification(user.id, user.email);
    return res.json({ success: true, message: 'Verification email sent' });
  } catch (error) {
    logger.error({ error }, 'resend_verification_failed');
    return res.status(500).json({ success: false, error: 'Failed to resend verification email' });
  }
});

// POST /api/auth/logout-all-devices
app.post('/api/auth/logout-all-devices', async (req: Request, res: Response) => {
  try {
    const auth = requireAuth(req, res);
    if (!auth) return;
    if (!(await checkTokenVersion(auth, res))) return;
    if (!hasDatabase()) return res.status(503).json({ success: false, error: 'Service unavailable' });
    await dbQuery(
      `UPDATE users SET token_version = COALESCE(token_version, 1) + 1 WHERE id = $1`,
      [auth.userId]
    );
    logger.info({ userId: auth.userId }, 'logout_all_devices');
    return res.json({ success: true, message: 'All sessions have been invalidated' });
  } catch (error) {
    logger.error({ error }, 'logout_all_devices_failed');
    return res.status(500).json({ success: false, error: 'Failed to invalidate sessions' });
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
    logger.error('List users error:', error);
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
    logger.error('Create user error:', error);
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
    logger.error('Update user error:', error);
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
    logger.error('Delete user error:', error);
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
    logger.error('Patch user status error:', error);
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
    logger.error('Patch user role error:', error);
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
    logger.error('OAuth state error:', error);
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
    logger.error('Get user setting error:', error);
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
    logger.error('Save user setting error:', error);
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
    logger.error('OAuth callback error:', error);
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
    logger.error('Accounts error:', error);
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
    } catch (err) {
    logger.error('Unhandled error:', err);
      warnings.push('Facebook groups lookup failed');
    }

    return res.json({ success: true, pages, groups, warnings });
  } catch (error) {
    logger.error('Facebook targets error:', error);
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
    logger.error('Instagram targets error:', error);
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
    logger.error('Instagram connect error:', error);
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
    logger.error('Pinterest boards error:', error);
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
    logger.error('Pinterest create board error:', error);
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
    logger.error('Mailchimp connect error:', error);
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
    logger.error('Mailchimp disconnect error:', error);
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
    logger.error('Disconnect error:', error);
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
    logger.error('Test connection error:', error);
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
    logger.error('Publish error:', error);
    return res.status(500).json({ success: false, error: 'Failed to publish post' });
  }
});

// NOTE: analytics routes are at /api/analytics/social/* and /api/blog/analytics/*
// The legacy /api/analytics/:platform route was removed (it returned null and was unused)
app.get('/api/analytics/:platform', async (req: Request, res: Response) => {
  return res.status(410).json({ success: false, error: 'Use /api/analytics/social/accounts or /api/blog/analytics/dashboard' });
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
  } catch (err) {
    logger.error('Unhandled error:', err);
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
  } catch (err) {
    logger.error('Unhandled error:', err);
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
    } catch (err) {
    logger.error('Unhandled error:', err);
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
    logger.error('Pinterest token exchange error:', { status: resp.status, body: resp.data, redirectUri });
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
    } catch (err) {
    logger.error('Unhandled error:', err);
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
    } catch (err) {
    logger.error('Unhandled error:', err);
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
  } catch (err) {
    logger.error('Unhandled error:', err);
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
    } catch (err) {
    logger.error('Unhandled error:', err);
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
    } catch (err) {
    logger.error('Unhandled error:', err);
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
    logger.warn('DATABASE_URL not set; cannot persist social connection');
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
    } catch (err) {
    logger.error('Unhandled error:', err);
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
    void checkTaskActions(userId, 'connect_social');
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
  } catch (_err) { /* fall through to plain text */ }

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
    logger.error('seedSocialMemory DB error:', e);
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
    logger.error('createNotification error:', e);
  }
}

async function logTaskActivity(
  projectId: string, userId: string, action: string, taskId?: string, metadata?: Record<string, unknown>
) {
  try {
    await dbQuery(
      `INSERT INTO task_activity (project_id, user_id, action, task_id, metadata) VALUES ($1,$2,$3,$4,$5)`,
      [projectId, userId, action, taskId ?? null, metadata ? JSON.stringify(metadata) : null]
    );
  } catch (_err) { /* non-fatal */ }
}

async function checkTaskActions(
  userId: string,
  actionType: string,
): Promise<Array<{ task_id: string; title: string; new_status: string; progress: string }>> {
  if (!hasDatabase()) return [];
  const progressed: Array<{ task_id: string; title: string; new_status: string; progress: string }> = [];
  try {
    const { rows } = await dbQuery(
      `SELECT DISTINCT ta.id, ta.current_count, ta.target_count, ta.task_id, t.project_id, t.status, t.title
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
      const r = row as any;
      const newCount = r.current_count + 1;
      await dbQuery(`UPDATE task_actions SET current_count = $1 WHERE id = $2`, [newCount, r.id]);
      const { rows: totals } = await dbQuery(
        `SELECT COALESCE(SUM(target_count),0) AS tgt, COALESCE(SUM(LEAST(current_count, target_count)),0) AS cur FROM task_actions WHERE task_id = $1`,
        [r.task_id]
      );
      const t0 = totals[0] as any;
      const isDone = Number(t0.cur) >= Number(t0.tgt);
      if (isDone) {
        await dbQuery(`UPDATE tasks SET status = 'done', updated_at = NOW() WHERE id = $1`, [r.task_id]);
        void logTaskActivity(r.project_id, userId, 'status_changed', r.task_id, { from: r.status, to: 'done' });
        createNotification(userId, 'agent_activity',
          `Task completed: "${r.title}"`,
          `Your action automatically completed the task "${r.title}".`,
          { taskId: r.task_id },
        ).catch(() => undefined);
      }
      progressed.push({
        task_id: r.task_id,
        title: r.title,
        new_status: isDone ? 'done' : r.status,
        progress: `${newCount}/${r.target_count}`,
      });
    }
  } catch (err) {
    logger.error('[checkTaskActions] error:', err);
  }
  return progressed;
}

async function getUserSaaSContext(userId: string): Promise<string> {
  if (!pool) return '';
  const parts: string[] = [];
  try {
    // Social connections
    const { rows: socials } = await dbQuery(
      `SELECT platform, account_name, handle, followers, connected
       FROM social_accounts WHERE user_id = $1 ORDER BY platform`,
      [userId]
    );
    if (socials.length > 0) {
      const lines = socials.map((s: any) => {
        const label = s.account_name || s.handle || s.platform;
        const fol = s.followers ? ` (${s.followers.toLocaleString()} followers)` : '';
        return `  ${s.connected ? '✅' : '❌'} ${s.platform}: ${label}${fol}${s.connected ? '' : ' — DISCONNECTED'}`;
      });
      parts.push(`### Social Accounts\n${lines.join('\n')}`);
    } else {
      parts.push('### Social Accounts\nNone connected yet.');
    }

    // Projects & orgs the user belongs to
    const { rows: projects } = await dbQuery(
      `SELECT p.id, p.name AS project_name, o.name AS org_name, om.role
       FROM projects p
       JOIN organizations o ON o.id = p.org_id
       JOIN organization_memberships om ON om.org_id = p.org_id AND om.user_id = $1
       ORDER BY p.created_at`,
      [userId]
    );
    if (projects.length > 0) {
      const lines = projects.map((p: any) => `  • ${p.org_name} / ${p.project_name} (${p.role}) [project_id:${p.id}]`);
      parts.push(`### Workspaces & Projects\n${lines.join('\n')}`);
    } else {
      parts.push('### Workspaces & Projects\nNo projects yet.');
    }

    // Open tasks assigned to the user
    const { rows: tasks } = await dbQuery(
      `SELECT t.id, t.title, t.status, t.priority, t.due_date, p.name AS project_name
       FROM tasks t
       JOIN task_assignees ta ON ta.task_id = t.id AND ta.user_id = $1
       JOIN projects p ON p.id = t.project_id
       WHERE t.status != 'done'
       ORDER BY t.due_date ASC NULLS LAST, t.priority DESC
       LIMIT 20`,
      [userId]
    );
    if (tasks.length > 0) {
      const lines = tasks.map((t: any) => {
        const due = t.due_date ? ` due:${new Date(t.due_date).toLocaleDateString('en-GB')}` : '';
        return `  • [${t.status.toUpperCase()}][${t.priority}]${due} "${t.title}" — ${t.project_name} [task_id:${t.id}]`;
      });
      parts.push(`### My Open Tasks (${tasks.length})\n${lines.join('\n')}`);
    } else {
      parts.push('### My Open Tasks\nNo open tasks assigned.');
    }

    // Upcoming scheduled posts
    const { rows: scheduled } = await dbQuery(
      `SELECT title, scheduled_at FROM blog_posts
       WHERE user_id = $1 AND status = 'scheduled' AND scheduled_at > NOW()
       ORDER BY scheduled_at ASC LIMIT 5`,
      [userId]
    );
    if (scheduled.length > 0) {
      const lines = scheduled.map((p: any) => `  • "${p.title}" — ${new Date(p.scheduled_at).toLocaleString('en-GB', { day:'2-digit', month:'short', hour:'2-digit', minute:'2-digit' })}`);
      parts.push(`### Upcoming Scheduled Posts\n${lines.join('\n')}`);
    }

    // Recent draft count
    const { rows: draftCount } = await dbQuery(
      `SELECT COUNT(*)::int AS n FROM blog_posts WHERE user_id=$1 AND status='draft'`,
      [userId]
    );
    if (draftCount[0]?.n > 0) {
      parts.push(`### Drafts\n  ${draftCount[0].n} draft(s) saved.`);
    }

  } catch (e) {
    logger.error('getUserSaaSContext error:', e);
  }
  if (parts.length === 0) return '';
  return `## YOUR LIVE SAAS STATE (as of this message)\n${parts.join('\n\n')}`;
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
  const platformId = normalizePlatformId(platform);
  const fakePost = {
    id: randomUUID(),
    title: content.text || '',
    content: content.text || '',
    excerpt: content.text || '',
    tag_names: content.hashtags || [],
  };
  const result = await publishToplatform(userId, fakePost, platformId);
  return { postId: result.platformPostId || 'unknown', platform, status: result.status, error: result.error };
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
      logger.error('WordPress connect error:', err.message);
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
    logger.error('WordPress status error:', err);
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
    logger.error('WordPress disconnect error:', err);
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
      logger.error('Connect webhook error:', err.message);
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
      logger.error('Publish webhook error:', err.message);
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
      logger.error('WordPress categories error:', err.message);
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
      logger.error('WordPress tags error:', err.message);
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
    logger.error('WordPress list posts error:', err);
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
    logger.error('WordPress get post error:', err);
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
    logger.error('WordPress update post error:', err);
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
    } catch (err) {
    logger.error('Unhandled error:', err);
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
    logger.error('WordPress media upload error:', err);
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
      } catch (err) {
    logger.error('Unhandled error:', err);
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
      logger.error('WordPress publish error:', err.message);
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
      logger.info(`GET /api/pricing/plans - Returning ${plans.length} in-memory plans`);
    } else {
      const result = await dbQuery<DbPricingPlan>(
        'SELECT id, name, description, price, billing_period, features, is_active, discount_percentage, is_on_sale, created_at, updated_at FROM pricing_plans ORDER BY created_at DESC'
      );
      plans = result.rows;
      logger.info(`GET /api/pricing/plans - Returning ${plans.length} database plans`);
    }

    logger.info('Plans to return:', plans.length > 0 ? plans[0] : 'No plans');

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
    logger.error('Get pricing plans error:', error);
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
    logger.error('Create pricing plan error:', error);
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
    logger.error('Update pricing plan error:', error);
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
    logger.error('Delete pricing plan error:', error);
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
    logger.error('Update pricing plan status error:', error);
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
    logger.error('Get card templates error:', error);
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
        'SELECT id, name, description, design_data, cover_image_url, is_published, created_at, updated_at, COALESCE(view_count,0) as view_count, COALESCE(like_count,0) as like_count FROM card_templates WHERE is_published = true ORDER BY created_at DESC'
      );
      templates = result.rows;
    }

    return res.json({
      success: true,
      templates: templates.map((t: any) => ({
        id: t.id,
        name: t.name,
        description: t.description || '',
        designData: typeof t.design_data === 'string' ? JSON.parse(t.design_data) : t.design_data,
        coverImageUrl: t.cover_image_url,
        isPublished: t.is_published,
        createdAt: t.created_at,
        updatedAt: t.updated_at,
        viewCount: t.view_count ?? 0,
        likeCount: t.like_count ?? 0,
      })),
    });
  } catch (error) {
    logger.error('Get published card templates error:', error);
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
    logger.error('Create card template error:', error);
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
        logger.error('Card template media sync error:', error);
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
        logger.error('Card template media sync error:', error);
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
    logger.error('Update card template error:', error);
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
        logger.error('Card template media sync error:', error);
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
        logger.error('Card template media sync error:', error);
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
    logger.error('Publish card template error:', error);
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
    logger.error('Unpublish card template error:', error);
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
    logger.error('Delete card template error:', error);
    return res.status(500).json({ success: false, error: 'Failed to delete card template' });
  }
});

// ─── Credits Routes ───────────────────────────────────────────────────────────
app.use('/api', registerCreditsRoutes({ requireAuth, requireAdmin, hasDatabase, pool: pool! }));
// ─── User Designs Routes ──────────────────────────────────────────────────────
app.use('/api', registerUserDesignRoutes({ requireAuth, hasDatabase, dbQuery, syncUserDesignMedia, checkTaskActions }));
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
    logger.error('Get platform configs error:', error);
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
    logger.error('Get platform config error:', error);
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
    logger.error('Save platform config error:', error);
    return res.status(500).json({ success: false, error: 'Failed to save platform config' });
  }
});

// POST /api/admin/platform-configs/resend/test — send a test email to verify Resend config
app.post('/api/admin/platform-configs/resend/test', async (req: Request, res: Response) => {
  try {
    const admin = await requireAdmin(req, res);
    if (!admin) return;
    // Allow caller to pass credentials directly (e.g. before saving); fall back to DB/env
    const saved = await getResendConfig();
    const resendKey  = String(req.body.apiKey    || saved.apiKey    || '').trim();
    const fromEmail  = String(req.body.fromEmail || saved.fromEmail || '').trim();
    const fromName   = String(req.body.fromName  || saved.fromName  || '').trim();
    if (!resendKey) return res.status(400).json({ success: false, error: 'No Resend API key configured — save your key first' });
    if (!fromEmail) return res.status(400).json({ success: false, error: 'From Email is required — enter it in the form above' });
    const toEmail = String(req.body.to || '').trim();
    if (!toEmail) return res.status(400).json({ success: false, error: 'Recipient email required' });
    const resend = new Resend(resendKey);
    const fromField = fromName ? `${fromName} <${fromEmail}>` : fromEmail;
    await resend.emails.send({
      from: fromField,
      to: toEmail,
      subject: 'Resend configuration test ✓',
      html: `<p>Your Resend integration is working correctly.</p><p>From: <strong>${fromField}</strong></p>`,
    });
    return res.json({ success: true, message: `Test email sent to ${toEmail}` });
  } catch (err: any) {
    return res.status(400).json({ success: false, error: err.message || 'Failed to send test email' });
  }
});

// GET /api/admin/audit-logs — recent audit log entries (admin only)
app.get('/api/admin/audit-logs', async (req: Request, res: Response) => {
  try {
    const admin = await requireAdmin(req, res);
    if (!admin) return;
    const limit = Math.min(Number(req.query.limit ?? 200), 500);
    const offset = Number(req.query.offset ?? 0);
    const type = String(req.query.type ?? '').trim(); // 'audit' | 'integration' | ''
    if (type === 'integration') {
      const { rows, rowCount } = await dbQuery(
        `SELECT il.id, il.event_type, il.status, il.response, il.created_at,
                i.slug AS integration, u.email AS user_email
         FROM integration_logs il
         LEFT JOIN integrations i ON i.id = il.integration_id
         LEFT JOIN users u ON u.id = il.user_id
         ORDER BY il.created_at DESC LIMIT $1 OFFSET $2`,
        [limit, offset]
      );
      return res.json({ success: true, logs: rows, total: rowCount });
    }
    // Default: content audit logs
    const { rows, rowCount } = await dbQuery(
      `SELECT al.id, al.action, al.post_ids, al.changes, al.created_at,
              u.email AS user_email, u.full_name AS user_name
       FROM audit_logs al
       LEFT JOIN users u ON u.id = al.user_id
       ORDER BY al.created_at DESC LIMIT $1 OFFSET $2`,
      [limit, offset]
    );
    return res.json({ success: true, logs: rows, total: rowCount });
  } catch (e: any) {
    return res.status(500).json({ success: false, error: e.message });
  }
});

// ─── Hubtel Payment Routes ─────────────────────────────────────────────────────
app.use('/api', registerHubtelRoutes({ requireAuth, requireAdmin, hasDatabase, dbQuery, getPlatformConfig }));
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
  } catch (err) {
    logger.error('Unhandled error:', err);
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
        } catch (err) {
    logger.error('Unhandled error:', err);
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
        } catch (err) {
    logger.error('Unhandled error:', err);
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
    logger.error('Authorize URL error:', err);
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
  } catch (e) {
    logger.warn({ e }, 'integration_config_check_failed');
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

// ─── Social Auth: OAuth login + auth provider management ────────────────────
app.use(registerSocialAuthRoutes({ requireAuth, requireAdmin, hasDatabase, dbQuery, jwtSecret: JWT_SECRET, jwtExpiresIn: JWT_EXPIRES_IN }));

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
    logger.error('Get enabled integrations error:', error);
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
    logger.error('Get integration catalog error:', error);
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
    logger.error('v1 facebook connect error:', err);
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
    logger.error('v1 facebook authorize-url error:', err);
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
      } catch (e) {
        logger.warn({ e }, 'linkedin_long_lived_token_exchange_failed — using short-lived token');
      }
    }

    await storeUserConnection(stateRow.user_id, 'facebook', tokenData);
    await dbQuery('DELETE FROM oauth_states WHERE state = $1', [state]).catch(() => undefined);

    const returnTo = (stateRow as any).return_to as string | null | undefined;
    const dest = returnTo && returnTo.startsWith('/') ? `${FRONTEND_URL}${returnTo}` : fallbackOk;
    return res.redirect(dest);
  } catch (err) {
    logger.error('v1 facebook callback error:', err);
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
    } catch (e) {
      logger.warn({ e }, 'facebook_permissions_check_failed');
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
    logger.error('v1 facebook pages error:', err);
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
    } catch (err) {
    logger.error('Unhandled error:', err);
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
    } catch (err) {
    logger.error('Unhandled error:', err);
      warnings.push('Facebook groups lookup failed');
    }

    return res.json({ success: true, pages, groups, missingPermissions, warnings });
  } catch (err) {
    logger.error('v1 facebook targets error:', err);
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
      try { pageToken = decryptIntegrationSecret(String(pageRow.access_token_encrypted)); } catch (_err) { /* ignore */ }
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
    logger.error('v1 facebook page-insights error:', err);
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
        try { pageToken = decryptIntegrationSecret(String(row.access_token_encrypted)); } catch (_err) { /* ignore */ }
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
    logger.error('v1 facebook post-insights error:', err);
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
    logger.error('v1 facebook token-refresh error:', err);
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
      } catch (err) {
    logger.error('Unhandled error:', err);
        // ignore settings persistence failures
      }
    }

    return res.json({ success: true, account: saved });
  } catch (err) {
    logger.error('v1 save social account error:', {error: String(err instanceof Error ? err.message : err), stack: err instanceof Error ? err.stack : undefined});
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
    logger.error('v1 list social accounts error:', err);
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
    logger.error('v1 delete social account error:', err);
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
    const publishablePlatforms = new Set(['linkedin', 'pinterest', 'threads', 'twitter', 'tiktok', 'facebook', 'instagram']);

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
    logger.error('v1 social repost error:', err);
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
    logger.error('v1 save social settings error:', err);
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
    logger.error('v1 fetch social settings error:', err);
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
    logger.error('social templates get error:', err);
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
    logger.error('social templates save error:', err);
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
    logger.error('social templates preview error:', err);
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
    logger.error('Reset platform config error:', error);
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
    logger.error('Platform OAuth callback error:', err);
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
    logger.error('Toggle platform config error:', error);
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
      case 'resend': {
        const { apiKey } = cfg;
        if (!apiKey) return res.json({ success: false, error: 'No Resend API key saved — configure it first' });
        const resp = await axios.get('https://api.resend.com/domains', {
          headers: { Authorization: `Bearer ${apiKey}` },
          validateStatus: () => true,
          timeout: 8000,
        });
        if (resp.status === 200) {
          const domainCount = resp.data?.data?.length ?? 0;
          return res.json({ success: true, message: `Resend API key valid${domainCount > 0 ? ` — ${domainCount} domain(s) registered` : ' — no verified domains yet'}` });
        }
        if (resp.status === 401 || resp.status === 403) return res.json({ success: false, error: 'Invalid Resend API key' });
        return res.json({ success: false, error: `Resend returned status ${resp.status}` });
      }
      case 'smtp': {
        const { host, port } = cfg;
        if (!host || !port) return res.json({ success: false, error: 'SMTP host and port are required' });
        return res.json({ success: true, message: 'SMTP credentials saved. Send a test email to verify delivery.' });
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
    logger.error('Platform test error:', err);
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
  try { return decryptIntegrationSecret(encryptedKey); } catch (_err) { return ''; }
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
    logger.error('AI config GET error:', err);
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
    logger.error('AI config PUT error:', err);
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
app.use('/api/admin', registerAISkillsRoutes({ requireAdmin, hasDatabase, dbQuery }));
// ─── End AI Skills ────────────────────────────────────────────────────────────

// ─── Page Content ──────────────────────────────────────────────────────────
app.use('/api/pages', registerPagesRoutes({ requireAdmin, hasDatabase, pool: pool! }));


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
    } catch (err) {
    logger.error('Unhandled error:', err);
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
    } catch (err) {
    logger.error('Unhandled error:', err);
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
  } catch (err) {
    logger.error('Unhandled error:', err);
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
    logger.error('media serve error:', err);
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
    logger.error('media upload error:', err);
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
      logger.error('Media list sync error:', error);
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
    logger.error('media list error:', err);
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
    logger.error('media serve error:', err);
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
    logger.error('media update error:', err);
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
    logger.error('media delete error:', err);
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
    logger.error('media bulk delete error:', err);
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
        logger.error('Admin media list sync error:', error);
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
    logger.error('admin media list error:', err);
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
    logger.error('admin media stats error:', err);
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
    logger.error('admin media delete error:', err);
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
    logger.error('admin assets error:', err);
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
    logger.error('admin media category error:', err);
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
    logger.error('media audit error:', err);
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
    logger.error('media sync error:', err);
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
    logger.error('media integrity check error:', err);
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
      logger.info(`[media-fix] Fixed category for ${fixCategoryResult.rows.length} images`);
    }

    // Fix 2: Delete orphaned images
    const deleteOrphanResult = await pool!.query(
      `DELETE FROM media_images WHERE user_id NOT IN (SELECT id FROM users) RETURNING id`
    );
    fixed += deleteOrphanResult.rows.length;
    if (deleteOrphanResult.rows.length > 0) {
      logger.info(`[media-fix] Deleted ${deleteOrphanResult.rows.length} orphaned images`);
    }

    // Fix 3: Re-scan persisted image sources for every user and register anything missing.
    const usersResult = await pool!.query<{ id: string }>('SELECT id FROM users');
    for (const row of usersResult.rows) {
      const sync = await syncAllPersistedMediaForUser(row.id);
      fixed += sync.created;
    }
    if (usersResult.rows.length > 0) {
      logger.info(`[media-fix] Re-scanned persisted media sources for ${usersResult.rows.length} user(s)`);
    }

    return res.json({ 
      success: true, 
      fixed,
      message: `Fixed ${fixed} media integrity issues`
    });
  } catch (err) {
    logger.error('media fix integrity error:', err);
    return res.status(500).json({ success: false, error: 'Fix failed' });
  }
});

// ── DB Audit & Cleanup (admin-only, one-shot) ──────────────────────────────
app.use('/api/admin', registerDbAuditRoutes({ requireAdmin, pool: pool! }));
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
    logger.error('LinkedIn targets error:', error);
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
    logger.error('LinkedIn token refresh error:', err);
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
  } catch (err) {
    logger.error('Unhandled error:', err);
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

// ── API Versioning ─────────────────────────────────────────────────────────────
// All new routes live under /api/v1/. Old /api/<resource> paths are kept as
// deprecated shims (same Router, different mount point) so in-flight requests
// and older cached tabs keep working. Remove shims when launching v2.

app.use('/api/v1', (_req: Request, res: Response, next) => {
  res.setHeader('X-API-Version', '1');
  next();
});

function deprecatedApiPath(canonicalPath: string) {
  return (_req: Request, res: Response, next: () => void) => {
    res.setHeader('Deprecation', 'true');
    res.setHeader('X-Deprecated-Use', canonicalPath);
    next();
  };
}

const { fireWorkflowTriggers, workflowRouter } = buildWorkflowEngine({ requireAuth, hasDatabase, dbQuery, enqueueSocialAutomationTask, getAIConfig, resolveActiveKey });

const blogRouter = registerBlogRoutes({
  app,
  pool,
  requireAuth,
  hasDatabase,
  slugify,
  clearCalendarCacheForUser,
  getCalendarCache,
  setCalendarCache,
  syncBlogPostMedia,
  checkTaskActions,
  fireWorkflowTriggers,
  queueSocialAutomationForPublishedPost,
  recordAuditLog,
  getVisibleUserPlatformSlugs,
  syncSocialAutomationForPost,
});
app.use('/api/v1/blog', blogRouter);
app.use('/api/blog', deprecatedApiPath('/api/v1/blog'), blogRouter);

// GET /api/v1/calendar — schedule calendar view (outside /api/v1/blog namespace)
app.get('/api/v1/calendar', async (req: Request, res: Response) => {
  const user = requireAuth(req, res);
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
      [user.userId, start.toISOString(), end.toISOString()],
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
    logger.error('calendar fetch error:', err);
    return res.status(500).json({ success: false, error: 'Failed to load calendar' });
  }
});

// GET /api/v1/posts — list posts by status (lightweight, used by calendar sidebar)
app.get('/api/v1/posts', async (req: Request, res: Response) => {
  const user = requireAuth(req, res);
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
    logger.error('posts list error:', err);
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
    logger.error('post create error:', err);
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
    logger.error('post update error:', err);
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
    logger.error('post delete error:', err);
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
      logger.error('Failed to resolve blog post featured image URL:', err);
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
    } catch (err) {
    logger.error('Unhandled error:', err);
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
  } catch (err) {
    logger.error('Unhandled error:', err);
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
      logger.warn('[SocialAutomation] Token health scan failed:', err);
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
  } catch (err) {
    logger.error('Unhandled error:', err);
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
    logger.info('[TikTok profile] user.info.profile exception:', profileErr?.message);
  }

  // ── Call 3: user.info.stats fields — optional ─────────────────────────────
  // TikTok hard-rejects the whole request if stats scope isn't approved,
  // so we ask for stats separately and silently ignore any error.
  try {
    const statsResp = await ttGet('follower_count,following_count,likes_count,video_count');
    const statsErr  = statsResp.data?.error?.code;
    logger.info('[TikTok stats] status:', statsResp.status, 'error:', statsErr, 'user:', JSON.stringify(statsResp.data?.data?.user));
    if (statsResp.status === 200 && (!statsErr || statsErr === 'ok') && statsResp.data?.data?.user) {
      const s = statsResp.data.data.user;
      if (s.follower_count  != null) user.follower_count  = s.follower_count;
      if (s.following_count != null) user.following_count = s.following_count;
      if (s.likes_count     != null) user.likes_count     = s.likes_count;
      if (s.video_count     != null) user.video_count     = s.video_count;
    }
  } catch (statsErr: any) {
    logger.info('[TikTok stats] exception:', statsErr?.message);
  }

  logger.info('[TikTok profile] final user object:', JSON.stringify(user));
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
      } catch (err) {
    logger.error('Unhandled error:', err);
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
  } catch (err) {
    logger.error('Unhandled error:', err);
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
    } catch (err) {
    logger.error('Unhandled error:', err);
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
  } catch (err) {
    logger.error('Unhandled error:', err);
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
    } catch (err) {
    logger.error('Unhandled error:', err);
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
    logger.error('[SocialAutomation] BullMQ worker error:', err);
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
        logger.error('[SocialAutomation] BullMQ init failed, falling back to DB worker:', err);
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
        } catch (err) {
    logger.error('Unhandled error:', err);
          decrypted = '';
        }
      }
      const pageToken = String(decrypted || storedRow?.access_token || '').trim();
      const pageId = String(storedRow?.account_id || '').trim();
      const pageName = String(storedRow?.account_name || '').trim();
      if (pageId && pageToken) {
        return { pageId, pageToken, pageName: pageName || desiredName || undefined };
      }
    } catch (err) {
    logger.error('Unhandled error:', err);
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
    } catch (err) {
    logger.error('Unhandled error:', err);
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
        } catch (err) {
    logger.error('Unhandled error:', err);
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
        } catch (err) {
    logger.error('Unhandled error:', err);
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

    logger.info(`[Distribution] ${platformName}: token available, platform publishing not yet implemented`);
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
  } catch (err) {
    logger.error('Unhandled error:', err);
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
  } catch (err) {
    logger.error('Unhandled error:', err);
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
  } catch (err) {
    logger.error('Unhandled error:', err);
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
  } catch (err) {
    logger.error('Unhandled error:', err);
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
  } catch (err) {
    logger.error('Unhandled error:', err);
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
    logger.error('Meta data deletion error:', error);
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
    logger.error('Meta deletion status error:', error);
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
    logger.error('Meta deauthorize error:', error);
    return res.status(400).json({ success: false, error: error instanceof Error ? error.message : 'Invalid request' });
  }
});

// Root route
app.get('/', (req: Request, res: Response) => {
  if (hasStaticFiles) {
    res.sendFile(path.join(publicDir, 'index.html'));
    return;
  }
  res.json({ message: 'OAuth Backend Server Running', version: '1.0.0' });
});


// ─── Mailing ────────────────────────────────────────────────────────────────
app.use('/api/mailing', registerMailingRoutes({ requireAuth, pool: pool!, getResendConfig }));

// ─── Surveys ──────────────────────────────────────────────────────────────────
app.use('/api/surveys', registerSurveyRoutes({ requireAuth, pool: pool! }));
app.use('/api/public/surveys', registerPublicSurveyRoutes({ pool: pool! }));

// ─── Leads & Google Sheets ──────────────────────────────────────────────────
const GS_CLIENT_ID = process.env.GOOGLE_SHEETS_CLIENT_ID || '';
const GS_CLIENT_SECRET = process.env.GOOGLE_SHEETS_CLIENT_SECRET || '';
const GS_REDIRECT = (process.env.API_URL || 'https://contentflow-api-production.up.railway.app').replace(/\/$/, '') + '/api/google-sheets/callback';
const FRONTEND_URL = process.env.VITE_APP_URL || process.env.FRONTEND_URL || 'https://marketing.dakyworld.com';
const leadsDeps = { requireAuth, pool: pool!, frontendUrl: FRONTEND_URL, gsClientId: GS_CLIENT_ID, gsClientSecret: GS_CLIENT_SECRET, gsRedirect: GS_REDIRECT };
app.use('/api/leads', registerLeadsRoutes(leadsDeps));
app.use('/api/google-sheets', registerGoogleSheetsRoutes(leadsDeps));

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
    logger.error('Analytics dashboard error:', err);
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
        try { token = decryptIntegrationSecret(String(acct.access_token_encrypted)); } catch (_err) { /* */ }
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
              logger.info('[Facebook sync] page:', pageName, 'followers:', followers, 'posts:', postsCount);
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
              } catch (_err) { /* skip individual post errors */ }
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
              logger.info('[TikTok sync] followers:', followers, 'following:', following, 'posts:', postsCount, 'likes:', totalLikes, 'scopeLimited:', scopeLimited);
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
              logger.info('[TikTok sync] DB followers after upsert:', verify.rows[0]?.followers);
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
                if (ttPage === 0) logger.info(`TikTok video.list scope not available (${vidErrCode}) — skipping`);
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
            logger.error('TikTok video fetch error:', vidErr.message);
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
                } catch (_err) { /* optional */ }
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
        logger.error(`Analytics sync error for ${platform}:`, msg);
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
    logger.error('Analytics refresh error:', err);
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
    logger.error('Analytics export error:', err);
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
    logger.error('Social accounts analytics error:', err);
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

    logger.info('[TikTok dashboard] account row followers:', account.followers, 'following_count:', account.following_count, 'video_count:', account.video_count);
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
    logger.error('Account analytics error:', err);
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
    logger.error('Comparison analytics error:', err);
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
        try { token = decryptIntegrationSecret(String(acct.access_token_encrypted)); } catch (_err) { /* */ }
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
              logger.info(`TikTok video.list scope not available (${listErrCode}) — skipping video sync`);
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
    logger.error('TikTok sync error:', err);
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
    logger.error('TikTok videos error:', err);
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
    logger.error('TikTok followers error:', err);
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
        try { token = decryptIntegrationSecret(String(acct.access_token_encrypted)); } catch (_err) { /* */ }
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
              logger.info(`Facebook posts endpoint error (${postsResp.status}) — skipping posts sync`);
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
    logger.error('Facebook sync error:', err);
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
    logger.error('Facebook posts error:', err);
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
    logger.error('Facebook stats error:', err);
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
    logger.error('Facebook accounts error:', err);
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
    logger.error('Instagram sync error:', err);
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
    logger.error('Instagram profile error:', err);
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
    logger.error('Instagram posts error:', err);
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
    logger.error('Pinterest sync error:', err);
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
    logger.error('Pinterest profile error:', err);
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
    logger.error('Pinterest pins error:', err);
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
    logger.error('Pinterest boards performance error:', err);
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
    logger.error('Threads sync error:', err);
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
    logger.error('Threads profile error:', err);
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
    logger.error('Threads posts error:', err);
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
    logger.error('Threads debug-token error:', err);
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
    logger.error('Threads replies error:', err);
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
    logger.error('Threads manage-reply error:', err);
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
    logger.error('Threads reply publish error:', err);
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
    logger.error('Threads location search error:', err);
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
    logger.error('Threads location lookup error:', err);
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
        try { token = decryptIntegrationSecret(String(acct.access_token_encrypted)); } catch (_err) { /* */ }
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
    logger.error('LinkedIn sync error:', err);
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
    logger.error('LinkedIn profile error:', err);
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
    logger.error('LinkedIn posts error:', err);
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
      logger.error('LinkedIn organizations error:', err.message);
      return res.status(500).json({ success: false, error: err?.message || 'Failed to fetch organizations' });
    }
  } catch (err) {
    logger.error('LinkedIn organizations list error:', err);
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
    logger.error('LinkedIn company sync error:', err);
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
    logger.error('LinkedIn company stats error:', err);
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
    logger.error('LinkedIn company posts error:', err);
    return res.status(500).json({ success: false, error: 'Failed to fetch company posts' });
  }
});

// ─── End Analytics & Insights Engine ─────────────────────────────────────────

// ─── Campaign & Funnel Builder ────────────────────────────────────────────────
app.use('/api/campaign', registerCampaignRoutes({ requireAuth, pool: pool!, redisUrl: REDIS_URL }));
app.use('/api/track', registerTrackingRoutes({ pool: pool! }));
app.use('/r', registerShortLinkRoutes({ pool: pool! }));
// ─── End Campaign & Funnel Builder ────────────────────────────────────────────

// ── AI Chat & Multi-Agent Routes ───────────────────────────────────────────
app.use('/api', registerAIChatRoutes({ requireAuth, getAIConfig, resolveActiveKey, callAINonStreaming, GEMINI_MODELS, pool, dbQuery, createNotification, checkTaskActions, getUserConnectedAccounts, AGENT_DEFS }));


// ─── Billing Routes ────────────────────────────────────────────────────────────

const billingRouter = registerBillingRoutes({ requireAuth, hasDatabase, dbQuery, stripe, getOrCreateStripeCustomer });
app.use('/api/v1/billing', billingRouter);
app.use('/api/billing', deprecatedApiPath('/api/v1/billing'), billingRouter);
app.use('/api', registerAdminBillingRoutes({ requireAdmin, hasDatabase, dbQuery, stripe }));

// ── Memory + Agent Routes ───────────────────────────────────────────────────
app.use('/api', registerMemoryAgentRoutes({ requireAuth, requireAdmin, dbQuery, hasDatabase, triggerAgentCompilation, createNotification, checkTaskActions, provisionUserAgents, AGENT_DEFS, getAIConfig, decryptAIKey }));


// ── Daky Learn Routes ───────────────────────────────────────────────────────
app.use('/api', registerDakyLearnRoutes({ requireAdmin, dbQuery, pool, getAIConfig, resolveActiveKey, callAINonStreaming, GEMINI_MODELS, createNotification }));


// ── Notifications ─────────────────────────────────────────────────────────────

const { notifRouter, inviteRouter } = registerNotificationRoutes({ pool, requireAuth, dbQuery, hasDatabase, createNotification });
app.use('/api/v1/notifications', notifRouter);
app.use('/api/notifications', deprecatedApiPath('/api/v1/notifications'), notifRouter);
app.use('/api/v1/invitations', inviteRouter);
app.use('/api/invitations', deprecatedApiPath('/api/v1/invitations'), inviteRouter);

// ── End Notifications ─────────────────────────────────────────────────────────

// ── End Billing Routes ─────────────────────────────────────────────────────────

// ─── Apify Admin Routes ────────────────────────────────────────────────────────
app.use('/api/admin/apify', registerApifyRoutes({ requireAdmin, hasDatabase, dbQuery }));
// ── End Apify Admin Routes ─────────────────────────────────────────────────────

// ─── Higgsfield Admin Routes ───────────────────────────────────────────────────
app.use('/api/admin/higgsfield', registerHiggsfieldRoutes({ requireAdmin, hasDatabase, dbQuery }));
// ── End Higgsfield Admin Routes ────────────────────────────────────────────────

// ─── Magnific AI Routes ─────────────────────────────────────────────────────────
app.use('/api', registerMagnificRoutes({ requireAuth, requireAdmin, hasDatabase, pool }));

// ── Nova Design Agent Routes ───────────────────────────────────────────────────
const { router: novaRouter, runScheduledAgents } = buildNovaModule({ requireAuth, requireAdmin, hasDatabase, dbQuery, pool, getAIConfig, resolveActiveKey, decryptAIKey, AGENT_DEFS });
app.use('/api', novaRouter);


// ─── Kling AI Routes ───────────────────────────────────────────────────────────
app.use('/api', registerKlingRoutes({ requireAuth, requireAdmin, hasDatabase, pool: pool! }));
// ── End Kling AI Routes ────────────────────────────────────────────────────────

// ─── Google AI Routes ──────────────────────────────────────────────────────────
app.use('/api', registerGoogleRoutes({ requireAuth, requireAdmin, hasDatabase, dbQuery, pool: pool! }));
// ── End Google AI Routes ──────────────────────────────────────────────────────

// ─── OpenAI Routes ─────────────────────────────────────────────────────────────
app.use('/api', registerOpenAIRoutes({ requireAuth, requireAdmin, hasDatabase, dbQuery, pool: pool! }));
// ── End OpenAI Routes ─────────────────────────────────────────────────────────

// ─── Workspace / Organization Routes ───────────────────────────────────────────
app.use('/api', registerOrgRoutes({ requireAuth, hasDatabase, dbQuery, requireOrgMembership, createNotification, checkTaskActions, logTaskActivity }));
// ── End Task Management Routes ─────────────────────────────────────────────────

// ── Due-date alert scheduler ───────────────────────────────────────────────────
// Runs every hour. Sends a notification to each assignee of tasks due in ~24h.
async function runDueDateAlerts() {
  try {
    const { rows } = await pool.query<{
      task_id: string; title: string; due_date: string;
      user_id: string; project_id: string;
    }>(`
      SELECT t.id AS task_id, t.title, t.due_date, t.project_id,
             ta.user_id
      FROM tasks t
      JOIN task_assignees ta ON ta.task_id = t.id
      WHERE t.status != 'done'
        AND t.due_date IS NOT NULL
        AND t.due_date BETWEEN NOW() + INTERVAL '20 hours' AND NOW() + INTERVAL '28 hours'
        AND NOT EXISTS (
          SELECT 1 FROM notifications n
          WHERE n.user_id = ta.user_id
            AND n.type = 'task_due_soon'
            AND (n.data->>'task_id') = t.id::text
            AND n.created_at > NOW() - INTERVAL '24 hours'
        )
    `);
    for (const row of rows) {
      const due = new Date(row.due_date);
      const formatted = due.toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
      await pool.query(
        `INSERT INTO notifications (user_id, type, title, message, data)
         VALUES ($1, 'task_due_soon', $2, $3, $4)`,
        [
          row.user_id,
          `Due tomorrow: "${row.title}"`,
          `Your task is due on ${formatted}. Make sure to complete it in time.`,
          JSON.stringify({ task_id: row.task_id, project_id: row.project_id }),
        ]
      );
    }
    if (rows.length > 0) logger.info({ count: rows.length }, 'due_date_alerts_sent');
  } catch (err) {
    logger.error({ err }, 'due_date_alert_error');
  }
}

// ── Scheduled post auto-publisher ─────────────────────────────────────────────
// Runs every 2 minutes. Finds posts whose scheduled_at has passed, promotes them
// to published, fires social automation + workflow triggers for each.
async function publishDuePosts() {
  if (!hasDatabase()) return;
  try {
    const { rows } = await pool!.query<{ id: string; user_id: string; title: string }>(
      `UPDATE blog_posts
       SET status = 'published', published_at = NOW(), updated_at = NOW()
       WHERE status = 'scheduled'
         AND scheduled_at IS NOT NULL
         AND scheduled_at <= NOW()
       RETURNING id, user_id, title`
    );
    if (!rows.length) return;

    for (const post of rows) {
      // Fetch full post for social automation + workflow
      const { rows: full } = await pool!.query(
        `SELECT p.*,
          ARRAY(SELECT t.name FROM blog_tags t JOIN blog_post_tags pt ON pt.tag_id = t.id WHERE pt.post_id = p.id) AS tag_names
         FROM blog_posts p WHERE p.id = $1`,
        [post.id]
      ).catch(() => ({ rows: [] }));

      if (full.length) {
        await queueSocialAutomationForPublishedPost(post.user_id, full[0]).catch(() => undefined);
        void fireWorkflowTriggers(post.user_id, 'post_published', full[0]);
      }

      await dbQuery(
        `INSERT INTO notifications (user_id, type, title, message, data)
         VALUES ($1, 'post', 'Post published', $2, $3)`,
        [
          post.user_id,
          `"${post.title}" was automatically published as scheduled.`,
          JSON.stringify({ post_id: post.id }),
        ]
      ).catch(() => undefined);
    }

    logger.info({ count: rows.length }, 'scheduled_posts_published');
  } catch (err) {
    logger.error({ err }, 'scheduled_posts_publish_error');
  }
}




// ── Workflow Routes ─────────────────────────────────────────────────────────
app.use('/api', workflowRouter);


// ── Automation Flows API ─────────────────────────────────────────────────────
app.use('/api', registerAutomationRoutes({ requireAuth, pool: pool! }));

app.use((req: Request, res: Response) => {
  if (hasStaticFiles && !req.path.startsWith('/api/')) {
    res.sendFile(path.join(publicDir, 'index.html'));
    return;
  }
  res.status(404).json({ success: false, error: 'Not found' });
});

// Centralized error handling (must be last)
app.use(errorHandler);

// Start server
if (config.nodeEnv !== 'test') {
  app.listen(PORT, () => {
    logger.info({ port: PORT }, 'api_listening');
    // Run due-date alerts immediately, then every hour
    void runDueDateAlerts();
    setInterval(() => void runDueDateAlerts(), 60 * 60 * 1000);
    // Run scheduled agent auto-runs every hour
    void runScheduledAgents();
    setInterval(() => void runScheduledAgents(), 60 * 60 * 1000);
    // Publish due scheduled posts every 2 minutes
    void publishDuePosts();
    setInterval(() => void publishDuePosts(), 2 * 60 * 1000);
  });
}

export default app;