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
import { registerPlatformConfigRoutes } from './server/platformConfigRoutes.ts';
import { registerWebhookRoutes } from './server/webhookRoutes.ts';
import { registerLinkedInRoutes } from './server/linkedinRoutes.ts';
import { registerSocialConnectRoutes } from './server/socialConnectRoutes.ts';
import { registerSocialRoutes } from './server/socialRoutes.ts';
import { buildMediaModule } from './server/mediaRoutes.ts';
import { registerCardTemplateRoutes } from './server/cardRoutes.ts';
import { registerPricingRoutes } from './server/pricingRoutes.ts';
import { registerWordPressRoutes } from './server/wordpressRoutes.ts';
import { runDatabaseMigrations } from './db-migrations.ts';

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

  await runDatabaseMigrations(pool);
  dbReady = true;

}

// ── Stripe Webhook ──
// markSocialAccountNeedsReapproval is const from distModule (defined later) — use wrapper so it's read at call time
app.use(registerWebhookRoutes({
  stripe, hasDatabase, dbQuery, pool, requireAuth,
  getStripeWebhookSecret: () => STRIPE_WEBHOOK_SECRET,
  markSocialAccountNeedsReapproval: (...args) => markSocialAccountNeedsReapproval(...args),
  logIntegrationEvent,
  decryptIntegrationSecret,
}));


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

app.use('/api', registerSocialConnectRoutes({
  requireAuth, hasDatabase, pool, dbQuery,
  getPublishableSocialConnection: (...a) => getPublishableSocialConnection(...a),
  normalizePlatformId: (...a) => normalizePlatformId(...a),
  getPlatformConfig,
  resolveOAuthRedirectUri,
  getLinkedInOAuthScopeString,
  shouldEnableLinkedInExtendedLogin,
  parseLinkedInScopeList,
  computeIsoFromTtlSeconds,
  encryptIntegrationSecret,
  upsertUserIntegration,
  logIntegrationEvent,
  getUserConnectedAccounts,
  createNotification,
  checkTaskActions,
  getAIConfig, resolveActiveKey, GEMINI_MODELS, callAINonStreaming,
  publishToplatform: (...a) => publishToplatform(...a),
}));

// ── LinkedIn scope helpers (also used by linkedinRoutes + platformConfigRoutes) ──

const LINKEDIN_DEFAULT_OAUTH_SCOPES = [
  'r_liteprofile', 'r_emailaddress', 'w_member_social',
  'r_organization_admin', 'rw_organization_admin',
  'r_organization_social', 'w_organization_social',
];

const LINKEDIN_ORG_ADMIN_SCOPE_OPTIONS = ['r_organization_admin', 'rw_organization_admin'];

function getLinkedInOAuthScopeString(): string {
  return String(process.env.LINKEDIN_OAUTH_SCOPES || LINKEDIN_DEFAULT_OAUTH_SCOPES.join(' ')).trim();
}

function parseLinkedInScopeList(value: unknown): string[] {
  const raw = String(value || '').trim();
  if (!raw) return [];
  let decoded = raw;
  try { decoded = decodeURIComponent(raw); } catch (err) { logger.error('Unhandled error:', err); decoded = raw; }
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

function computeIsoFromTtlSeconds(seconds: unknown): string | null {
  const value = Number(seconds);
  if (!Number.isFinite(value) || value <= 0) return null;
  return new Date(Date.now() + value * 1000).toISOString();
}

// ── Notification & task helpers ────────────────────────────────────────────────

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
    const { rows: socials } = await dbQuery(
      `SELECT platform, account_name, handle, followers, connected
       FROM social_accounts WHERE user_id = $1 ORDER BY platform`,
      [userId]
    );
    if (socials.length > 0) {
      parts.push('Connected social accounts: ' + socials.map((s: any) => `${s.platform}${s.handle ? ` (@${s.handle})` : ''}${s.followers ? ` — ${Number(s.followers).toLocaleString()} followers` : ''}`).join(', '));
    }

    const { rows: planRows } = await dbQuery(
      `SELECT pp.name FROM subscriptions s JOIN pricing_plans pp ON pp.id = s.plan_id WHERE s.user_id = $1 AND s.status IN ('active','trialing') ORDER BY s.created_at DESC LIMIT 1`,
      [userId]
    );
    if (planRows[0]) parts.push(`Subscription plan: ${(planRows[0] as any).name}`);

    const { rows: creditRows } = await dbQuery(
      `SELECT balance FROM user_credits WHERE user_id = $1 LIMIT 1`,
      [userId]
    );
    if (creditRows[0]) parts.push(`AI credits remaining: ${(creditRows[0] as any).balance}`);
  } catch (e) {
    logger.error('getUserSaaSContext error:', e);
  }
  return parts.join('\n');
}

async function getEnabledPlatformSlugs(): Promise<string[]> {
  if (!pool) return [];
  const result = await dbQuery(`SELECT platform FROM platform_configs WHERE enabled = true`);
  return result.rows.map((row: any) => String(row.platform || '').toLowerCase()).filter(Boolean);
}

function isOAuthClientSecretRequired(platform: string): boolean {
  const slug = String(platform || '').trim().toLowerCase();
  return slug === 'instagram' || slug === 'facebook' || slug === 'threads' || slug === 'linkedin' || slug === 'tiktok' || slug === 'pinterest';
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
      if (Boolean(row.enabled) || Object.keys(cfg).length > 0) visible.add(slug);
      continue;
    }
    const clientId = String(cfg?.[meta.idField] || '').trim();
    const secretRequired = isOAuthClientSecretRequired(slug);
    const secretValue = String(cfg?.clientSecret || cfg?.appSecret || '').trim();
    const configured = Boolean(clientId && (!secretRequired || secretValue));
    if ((Boolean(row.enabled) || configured) && configured) visible.add(slug);
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
  if (platformId === 'wordpress') return name ? `Site: ${name}` : 'WordPress';
  if (type === 'profile' || !type) return name ? `Profile: ${name}` : 'Profile';
  return name ? `${type}: ${name}` : (id ? `${type}: ${id}` : type || null);
}

async function getUserConnectedAccounts(userId: string): Promise<any[]> {
  if (!pool) return [];
  const visiblePlatforms = await getVisibleUserPlatformSlugs();
  let query = `
    SELECT id, user_id AS "userId", platform, handle, account_name AS "accountName",
           followers::text AS followers, connected, connected_at AS "connectedAt",
           expires_at AS "expiresAt", token_data AS "token_data"
    FROM social_accounts WHERE user_id = $1`;
  const params: any[] = [userId];
  if (visiblePlatforms.length > 0) {
    query += ` AND LOWER(platform) = ANY($2)`;
    params.push(visiblePlatforms);
  }
  query += ` ORDER BY platform;`;
  const result = await dbQuery(query, params);
  return result.rows;
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

// ─── Hubtel Payment Routes ─────────────────────────────────────────────────────
app.use('/api', registerHubtelRoutes({ requireAuth, requireAdmin, hasDatabase, dbQuery, getPlatformConfig }));
// ── Integration helpers ────────────────────────────────────────────────────────





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

app.use('/api', registerPlatformConfigRoutes({
  requireAuth, requireAdmin, hasDatabase, dbQuery, pool,
  inMemoryPlatformConfigs, getPlatformConfig, getIntegrationRowBySlug,
  getResendConfig, refreshStripe,
  oauthAuthUrls: OAUTH_AUTH_URLS,
  resolveOAuthRedirectUri,
  isOAuthClientSecretRequired,
}));


// ─── Social Auth: OAuth login + auth provider management ────────────────────
app.use(registerSocialAuthRoutes({ requireAuth, requireAdmin, hasDatabase, dbQuery, jwtSecret: JWT_SECRET, jwtExpiresIn: JWT_EXPIRES_IN }));



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

app.use(registerLinkedInRoutes({
  requireAuth, pool, encryptIntegrationSecret, computeIsoFromTtlSeconds,
  getLinkedInOrganizationScopeError, upsertUserIntegration,
  getPublishableSocialConnection: (...a) => getPublishableSocialConnection(...a),
  refreshLinkedInAccessToken: (...a) => refreshLinkedInAccessToken(...a),
  listLinkedInAdminOrganizations: (...a) => listLinkedInAdminOrganizations(...a),
  fetchLinkedInOrganizationNetworkSize: (...a) => fetchLinkedInOrganizationNetworkSize(...a),
  fetchLinkedInSocialMetadataBatch: (...a) => fetchLinkedInSocialMetadataBatch(...a),
  fetchLinkedInShareStatisticsForPosts: (...a) => fetchLinkedInShareStatisticsForPosts(...a),
  sumLinkedInReactionCounts: (m) => sumLinkedInReactionCounts(m),
  getClientIp, checkLinkMetadataRateLimit, fetchLinkMetadata,
}));


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
const markSocialAccountNeedsReapproval = distModule.markSocialAccountNeedsReapproval;
const listLinkedInAdminOrganizations = distModule.listLinkedInAdminOrganizations;
const fetchLinkedInOrganizationNetworkSize = distModule.fetchLinkedInOrganizationNetworkSize;
const refreshLinkedInAccessToken = distModule.refreshLinkedInAccessToken;
const fetchLinkedInSocialMetadataBatch = distModule.fetchLinkedInSocialMetadataBatch;
const fetchLinkedInShareStatisticsForPosts = distModule.fetchLinkedInShareStatisticsForPosts;
const sumLinkedInReactionCounts = distModule.sumLinkedInReactionCounts;
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