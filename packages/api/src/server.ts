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
import { registerAnalyticsRoutes } from './server/analyticsRoutes.ts';
import { buildDistributionModule } from './server/distributionRoutes.ts';
import { registerAuthRoutes } from './server/authRoutes.ts';
import { registerUserRoutes } from './server/userRoutes.ts';
import { registerAIConfigRoutes } from './server/aiConfigRoutes.ts';
import { registerSocialRoutes } from './server/socialRoutes.ts';
import { buildMediaModule } from './server/mediaRoutes.ts';
import { registerCardTemplateRoutes } from './server/cardRoutes.ts';
import { registerPricingRoutes } from './server/pricingRoutes.ts';
import { registerWordPressRoutes } from './server/wordpressRoutes.ts';

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

// These are assigned after buildDistributionModule is called (synchronous, before DB resolves)
let startSocialAutomationProcessor: () => void = () => {};
let startTokenHealthMonitor: () => void = () => {};
// These are assigned after buildMediaModule is called (handlers run after startup completes)
let syncProfileMedia: (user: any) => Promise<number> = async () => 0;
let syncCardTemplateMedia: (adminId: string, template: any) => Promise<number> = async () => 0;
let syncUserDesignMedia: (userId: string, design: any) => Promise<number> = async () => 0;
// Wrappers that read the let-variable at call time so route modules get the real function after startup
const syncProfileMediaFn = (user: any) => syncProfileMedia(user);
const syncCardTemplateMediaFn = (adminId: string, template: any) => syncCardTemplateMedia(adminId, template);
const syncUserDesignMediaFn = (userId: string, design: any) => syncUserDesignMedia(userId, design);

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

// ─── Auth Routes ─────────────────────────────────────────────────────────────
app.use('/api', registerAuthRoutes({
  requireAuth, hasDatabase, dbQuery,
  getUserById, findUserByEmail, findUserByUsername, findUserByIdentifier,
  createUser, updateUserProfile, updateLastLogin,
  getUserPlanName, signToken, userToAuthPayload, checkTokenVersion,
  provisionUserAgents, createNotification, getResendConfig,
  jwtSecret: JWT_SECRET,
  appUrl: config.appUrl,
  syncProfileMedia: syncProfileMediaFn,
}));
// ─── User Management Routes ───────────────────────────────────────────────────
app.use('/api', registerUserRoutes({
  requireAdmin, hasDatabase, dbQuery,
  getUserById, findUserByEmail, findUserByUsername, createUser,
  normalizeEmail, normalizeUsername,
  inMemoryUsersById, inMemoryUserIdByEmail, inMemoryUserIdByUsername,
}));

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
// ─── WordPress Routes ────────────────────────────────────────────────────────
app.use('/api', registerWordPressRoutes({
  requireAuth, hasDatabase, dbQuery, pool,
  encryptWordPressPassword, decryptWordPressPassword, getWordPressConnection, wpRequest,
  upsertUserIntegration, logIntegrationEvent, ensureWordPressSocialAccount,
}));

// ─── Pricing Routes ──────────────────────────────────────────────────────────
app.use('/api', registerPricingRoutes({ requireAdmin, hasDatabase, dbQuery, stripe, inMemoryPricingPlansById }));

// ─── Card Template Routes ────────────────────────────────────────────────────
app.use('/api', registerCardTemplateRoutes({
  requireAuth, requireAdmin, hasDatabase, dbQuery, pool,
  inMemoryCardTemplatesById,
  syncCardTemplateMedia: syncCardTemplateMediaFn,
}));

app.use('/api', registerCreditsRoutes({ requireAuth, requireAdmin, hasDatabase, pool: pool! }));
// ─── User Designs Routes ──────────────────────────────────────────────────────
app.use('/api', registerUserDesignRoutes({ requireAuth, hasDatabase, dbQuery, syncUserDesignMedia: syncUserDesignMediaFn, checkTaskActions }));
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

// ─── AI Config Routes ─────────────────────────────────────────────────────────
app.use('/api', registerAIConfigRoutes({
  requireAdmin, hasDatabase, dbQuery,
  getAIConfig, encryptIntegrationSecret, decryptAIKey,
  resolveActiveKey, callAINonStreaming, inMemoryPlatformConfigs,
}));

// ─── AI Skills ────────────────────────────────────────────────────────────────
app.use('/api/admin', registerAISkillsRoutes({ requireAdmin, hasDatabase, dbQuery }));
// ─── End AI Skills ────────────────────────────────────────────────────────────

// ─── Page Content ──────────────────────────────────────────────────────────
app.use('/api/pages', registerPagesRoutes({ requireAdmin, hasDatabase, pool: pool! }));


// ─── Media Library ─────────────────────────────────────────────────────────────
const mediaModule = buildMediaModule({ requireAuth, requireAdmin, hasDatabase, pool });
app.use('/', mediaModule.router);
syncProfileMedia = mediaModule.syncProfileMedia;
syncCardTemplateMedia = mediaModule.syncCardTemplateMedia;
syncUserDesignMedia = mediaModule.syncUserDesignMedia;
const syncBlogPostMedia = mediaModule.syncBlogPostMedia;


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

const LINKEDIN_MARKETING_VERSION_LOCAL = String(process.env.LINKEDIN_API_VERSION || '202603').trim() || '202603';
function getLinkedInRestHeaders(accessToken: string, contentType = 'application/json'): Record<string, string> {
  const headers: Record<string, string> = {
    Authorization: `Bearer ${accessToken}`,
    'X-Restli-Protocol-Version': '2.0.0',
    'LinkedIn-Version': LINKEDIN_MARKETING_VERSION_LOCAL,
  };
  if (contentType) headers['Content-Type'] = contentType;
  return headers;
}

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

// ── Distribution / Automation ────────────────────────────────────────────────
// ── Distribution Module ─────────────────────────────────────────────────────

const distModule = buildDistributionModule({
  requireAuth, pool, dbQuery,
  decryptIntegrationSecret, getIntegrationRowBySlug, logIntegrationEvent,
  getPlatformConfig, getWordPressConnection, decryptWordPressPassword, wpRequest,
});
app.use('/api', distModule.router);
const getPublishableSocialConnection = distModule.getPublishableSocialConnection;
startSocialAutomationProcessor = distModule.startSocialAutomationProcessor;
startTokenHealthMonitor = distModule.startTokenHealthMonitor;

// ── Social Routes (automation + templates) ──────────────────────────────────
app.use('/api', registerSocialRoutes({
  requireAuth, requireAdmin, hasDatabase, pool, dbQuery,
  getPlatformConfig, getPublishableSocialConnection,
  normalizePlatformId: distModule.normalizePlatformId,
  getSocialTemplateDefaults: distModule.getSocialTemplateDefaults,
  mergeSocialTemplateSettings: distModule.mergeSocialTemplateSettings,
  renderSocialTemplatePreview: distModule.renderSocialTemplatePreview,
  loadSocialTemplateSettings: distModule.loadSocialTemplateSettings,
  enqueueSocialAutomationTask: distModule.enqueueSocialAutomationTask,
  syncSocialAutomationForPost: distModule.syncSocialAutomationForPost,
}));

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

// ─── Analytics Routes ───────────────────────────────────────────────────────
app.use('/api', registerAnalyticsRoutes({ requireAuth, pool, decryptIntegrationSecret, getPublishableSocialConnection }));
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