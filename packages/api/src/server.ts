// Sentry first: its uncaught-exception / unhandled-rejection integrations
// must register before anything else runs. No-op unless SENTRY_DSN is set.
import { Sentry, sentryEnabled } from './instrument.ts';
import { Resend } from 'resend';
import Stripe from 'stripe';
import express from 'express';
import type { Request, Response, NextFunction } from 'express';
import cors from 'cors';
import helmet from 'helmet';
import jwt from 'jsonwebtoken';
import bcrypt from 'bcryptjs';
import { Queue, Worker } from 'bullmq';
import IORedis from 'ioredis';
import { z } from 'zod';
import {
  randomBytes,
  createCipheriv,
  createDecipheriv,
  scryptSync,
  createHmac,
  timingSafeEqual,
} from 'crypto';
import { existsSync, readFileSync } from 'fs';
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
import { registerCRMCompaniesRoutes } from './server/crmCompaniesRoutes.ts';
import { registerCRMDealsRoutes } from './server/crmDealsRoutes.ts';
import { registerCRMActivitiesRoutes } from './server/crmActivitiesRoutes.ts';
import { registerCalendarRoutes } from './server/calendarRoutes.ts';
import { registerConnectorRegistryRoutes } from './server/connectorRegistryRoutes.ts';
import { registerConnectorPreferencesRoutes } from './server/connectorPreferencesRoutes.ts';
import { registerConnectorSyncRoutes, processDueConnectorSyncJobs } from './server/connectorSyncRoutes.ts';
import { registerCreditsRoutes } from './server/creditsRoutes.ts';
import { registerApifyRoutes } from './server/apifyRoutes.ts';
import { registerHiggsfieldRoutes } from './server/higgsfieldRoutes.ts';
import { registerKlingRoutes } from './server/klingRoutes.ts';
import { registerGmailInboxRoutes, buildGmailAutoSync } from './server/gmailInboxRoutes.ts';
import { registerGoogleRoutes } from './server/googleRoutes.ts';
import { registerOpenAIRoutes } from './server/openaiRoutes.ts';
import { registerAutomationRoutes } from './server/automationRoutes.ts';
import { buildAutomationEngine } from './server/automationEngine.ts';
import { recalcLeadScore } from './server/leadScoring.ts';
import { registerApiKeyRoutes, registerPublicTriggerRoutes } from './server/publicApiRoutes.ts';
import { registerFormsRoutes, registerPublicFormRoutes } from './server/formsRoutes.ts';
import { registerSiteTrackingRoutes } from './server/trackingRoutes.ts';
import { processStaleAgentCompilations } from './server/agentSharedContext.ts';
import { registerMcpAdminRoutes, registerMcpMediaRoutes, seedDefaultMcpServers, processMcpMediaSync } from './server/mcpRoutes.ts';
import { buildMailer } from './server/mailer.ts';
import { buildContentPlanEngine, registerContentPlanRoutes } from './server/contentPlanRoutes.ts';
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
import { registerAnalyticsRoutes, buildAnalyticsAutoSync } from './server/analyticsRoutes.ts';
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
import { pool, dbReady, setDbReady, setDbInitError, dbInitError, hasDatabase, dbQuery, normalizeEmail, normalizeUsername } from './db.ts';
import type {
  DbUserRow, AdminDbRole, AdminDbStatus, DbPricingPlan, DbCardTemplate, PlatformConfigRow,
} from './user-auth.ts';
import {
  inMemoryUsersById, inMemoryUserIdByEmail, inMemoryUserIdByUsername,
  inMemoryPricingPlansById, inMemoryCardTemplatesById, inMemoryPlatformConfigs,
  getPlatformConfig, isPlatformEnabled, getResendConfig,
  upsertInMemoryUser, seedInMemoryUsers,
  getUserPlanName, userToAuthPayload, JWT_EXPIRES_IN, signToken, getAuthUser,
  findUserByEmail, findUserByUsername, findUserByIdentifier, getUserById,
  createUser, updateLastLogin, ensureSeedUser, ensureSeedUsers, ensureSeedPricingPlans,
  updateUserProfile,
  requireAuth, checkTokenVersion, requireAdmin, requireOrgMembership,
} from './user-auth.ts';
import {
  encryptIntegrationSecret, decryptIntegrationSecret, getIntegrationRowBySlug,
  logIntegrationEvent, upsertUserIntegration,
  encryptWordPressPassword, decryptWordPressPassword, normalizeWordPressSiteUrl,
  getWordPressConnection, getMakeWebhookConnection,
  ensureWordPressSocialAccount, removeWordPressSocialAccount, isValidWebhookUrl, wpRequest,
} from './integration-helpers.ts';
import {
  LINKEDIN_DEFAULT_OAUTH_SCOPES, LINKEDIN_ORG_ADMIN_SCOPE_OPTIONS,
  getLinkedInOAuthScopeString, parseLinkedInScopeList,
  getLinkedInScopeSet, hasAnyLinkedInScope, hasAllLinkedInScopes,
  getLinkedInOrganizationScopeError, shouldEnableLinkedInExtendedLogin,
  computeIsoFromTtlSeconds,
  createNotification, logTaskActivity, checkTaskActions,
} from './social-helpers.ts';
import {
  AI_CONFIG_PLATFORM, GEMINI_MODELS, ANTHROPIC_TO_GEMINI,
  getAIConfig, resolveActiveKey, callAINonStreaming, decryptAIKey,
} from './ai-helpers.ts';
import {
  AGENT_DEFS, provisionUserAgents, compileAgentSkill, triggerAgentCompilation,
} from './agent-helpers.ts';
import {
  getCalendarCache, setCalendarCache, clearCalendarCacheForUser,
  getClientIp, checkLinkMetadataRateLimit, fetchLinkMetadata,
  recordAuditLog,
} from './link-metadata.ts';
import {
  getUserSaaSContext, getEnabledPlatformSlugs, isOAuthClientSecretRequired,
  getVisibleUserPlatformSlugs, formatSocialAccountLabel, getUserConnectedAccounts,
  OAUTH_AUTH_URLS, resolveOAuthRedirectUri,
} from './platform-helpers.ts';
import { runDueDateAlerts, publishDuePosts, runTaskReminders } from './scheduler.ts';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);



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

// Logged once at boot in production: flags configuration gaps that won't
// break startup but will silently degrade a live deployment.
async function runProductionReadinessChecks(): Promise<void> {
  if (config.nodeEnv !== 'production') return;
  if (!sentryEnabled) {
    logger.warn({ check: 'sentry' }, 'launch_check: SENTRY_DSN is not set — production errors will only reach the logs');
  }
  if (stripe && !STRIPE_WEBHOOK_SECRET) {
    logger.warn({ check: 'stripe_webhook' }, 'launch_check: Stripe is configured without a webhook secret — subscription lifecycle events will be rejected');
  }
  const resendCfg = await getResendConfig().catch(() => null);
  if (resendCfg?.apiKey && !(await getPlatformConfig('resend').catch(() => ({} as Record<string, string>))).webhookSecret && !process.env.RESEND_WEBHOOK_SECRET) {
    logger.warn({ check: 'resend_webhook' }, 'launch_check: Resend is configured without a webhook signing secret — engagement events (opens/clicks/bounces) will be discarded');
  }
  if (process.env.ENABLE_TEST_USER_CREDITS === 'true') {
    logger.warn({ check: 'test_credits' }, 'launch_check: ENABLE_TEST_USER_CREDITS is on — the "User One" account is granted 1,000,000 credits on every deploy');
  }
}

const app = express();
const PORT = config.port;

// Behind Railway's proxy: without this, req.ip is the proxy for every
// request, so per-IP rate limits (login, public API, pixel) would be shared
// globally instead of per client.
app.set('trust proxy', 1);

// Automation engine executes the flows built in Marketing → Automations.
// Built before all routes so public forms, webhooks, and mailing can fire triggers.
const automationEngine = buildAutomationEngine({ pool, getResendConfig, getPlatformConfig, appUrl: config.appUrl });

// Unified platform mailer: switch between the hosting provider's SMTP inbox
// (Admin → Platform Settings → smtp) and Resend via the `email` config.
const mailer = buildMailer({ getPlatformConfig, getResendConfig });

// Auto-content plans: background generation of promo content + featured images.
const contentPlanEngine = buildContentPlanEngine({ pool: pool!, createNotification, sendPlatformEmail: mailer.sendPlatformEmail });

// Request IDs first so even health checks carry x-request-id
app.use(requestIdMiddleware);

// Registered BEFORE all other middleware so nothing can intercept it
app.get('/ping', (_req, res) => res.send('pong'));
app.get('/health', (_req, res) => res.json({ status: 'ok', timestamp: new Date().toISOString() }));
app.get('/api/health', (_req, res) => res.json({
  status: 'ok',
  timestamp: new Date().toISOString(),
  db: { configured: Boolean(config.databaseUrl), ready: dbReady, error: dbInitError },
}));

// Public hosted lead-capture forms (/f/:id). Mounted BEFORE the CORS and
// helmet middleware on purpose: the page must be embeddable in iframes on
// customers' external sites (helmet's frame-ancestors/X-Frame-Options would
// block that, and cross-origin form POSTs would fail the CORS allowlist).
app.use('/f', registerPublicFormRoutes({ pool, fireAutomationTrigger: automationEngine.fireAutomationTrigger }));

// Website tracking snippet (/t.js) + pixel (/px.gif). Also mounted BEFORE
// cors/helmet: both are loaded cross-origin from customers' sites and
// helmet's Cross-Origin-Resource-Policy would block them.
app.use(registerSiteTrackingRoutes({ pool, appUrl: config.appUrl, fireAutomationTrigger: automationEngine.fireAutomationTrigger }));

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
          config.appUrl,
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


// Diagnostics — admin-only so deployment internals aren't public.
app.get('/api/debug/db', async (req: Request, res: Response) => {
  const admin = await requireAdmin(req, res);
  if (!admin) return;
  res.json({
    hasDatabase: hasDatabase(),
    dbReady,
    databaseUrlConfigured: Boolean(config.databaseUrl && config.databaseUrl.trim()),
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
const indexHtmlPath = path.join(publicDir, 'index.html');
const hasStaticFiles = existsSync(indexHtmlPath);
const indexHtmlContent = hasStaticFiles ? readFileSync(indexHtmlPath, 'utf-8') : null;
logger.info({ publicDir, hasStaticFiles }, 'static_files_check');
app.use(
  express.static(publicDir, {
    setHeaders(res) {
      res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
      res.setHeader('Pragma', 'no-cache');
      res.setHeader('Expires', '0');
    },
  })
);
const REDIS_URL = config.redisUrl;
const TWITTER_MONTHLY_WRITE_LIMIT = config.twitterMonthlyWriteLimit;
const SOCIAL_TOKEN_SAFETY_MARGIN_DAYS = config.socialTokenSafetyMarginDays;
const X_API_BASE = 'https://api.x.com';
const X_OAUTH_TOKEN_URL = `${X_API_BASE}/2/oauth2/token`;
const X_USERS_ME_API = `${X_API_BASE}/2/users/me`;

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
    setDbReady(false);
    seedInMemoryUsers();
    return;
  }

  await runDatabaseMigrations(pool);
  setDbReady(true);

}

// ── Stripe + Resend Webhooks ──
// markSocialAccountNeedsReapproval is const from distModule (defined later) — use wrapper so it's read at call time
app.use(registerWebhookRoutes({
  stripe, hasDatabase, dbQuery, pool, requireAuth,
  getStripeWebhookSecret: () => STRIPE_WEBHOOK_SECRET,
  markSocialAccountNeedsReapproval: (...args) => markSocialAccountNeedsReapproval(...args),
  logIntegrationEvent,
  decryptIntegrationSecret,
  getPlatformConfig,
  fireAutomationTrigger: automationEngine.fireAutomationTrigger,
  recalcLeadScore,
}));



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
  .then(() => seedDefaultMcpServers(pool))
  .then(() => refreshStripe())
  .then(() => runProductionReadinessChecks())
  .then(() => startSocialAutomationProcessor())
  .then(() => startTokenHealthMonitor())
  .catch((err) => {
    setDbReady(false);
    setDbInitError(err);
    seedInMemoryUsers();
    logger.error('Database initialization failed:', err);
  });


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


// ─── Auth Routes ─────────────────────────────────────────────────────────────
app.use('/api', registerAuthRoutes({
  requireAuth, hasDatabase, dbQuery,
  getUserById, findUserByEmail, findUserByUsername, findUserByIdentifier,
  createUser, updateUserProfile, updateLastLogin,
  getUserPlanName, signToken, userToAuthPayload, checkTokenVersion,
  provisionUserAgents, createNotification, getResendConfig,
  jwtSecret: config.jwtSecret,
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

    if (platform === 'gmail') {
      params.set('access_type', 'offline');
      params.set('prompt', 'consent');
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
app.use(registerSocialAuthRoutes({ requireAuth, requireAdmin, hasDatabase, dbQuery, jwtSecret: config.jwtSecret, jwtExpiresIn: JWT_EXPIRES_IN }));



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

// ── Platform nav settings ──────────────────────────────────────────────────
app.get('/api/platform/nav-settings', async (req: Request, res: Response) => {
  const auth = requireAuth(req, res);
  if (!auth) return;
  if (!hasDatabase) return res.json({ disabled: [] });
  try {
    const { rows } = await dbQuery<{ value: { disabled: string[] } }>(
      `SELECT value FROM platform_settings WHERE key='nav_disabled'`
    );
    res.json({ disabled: rows[0]?.value?.disabled ?? [] });
  } catch {
    res.json({ disabled: [] });
  }
});

app.put('/api/admin/nav-settings', async (req: Request, res: Response) => {
  const admin = await requireAdmin(req, res);
  if (!admin) return;
  const { disabled } = req.body;
  if (!Array.isArray(disabled)) return void res.status(400).json({ error: 'disabled must be array' });
  await dbQuery(
    `INSERT INTO platform_settings (key, value, updated_at) VALUES ('nav_disabled', $1, NOW())
     ON CONFLICT (key) DO UPDATE SET value=$1, updated_at=NOW()`,
    [JSON.stringify({ disabled })]
  );
  res.json({ ok: true, disabled });
});
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

function slugify(text: string): string {
  return text.toLowerCase().trim().replace(/[^\w\s-]/g, '').replace(/[\s_-]+/g, '-').replace(/^-+|-+$/g, '');
}

// ── Distribution Module ─────────────────────────────────────────────────────
const distModule = buildDistributionModule({
  requireAuth, pool, dbQuery,
  decryptIntegrationSecret, getIntegrationRowBySlug, logIntegrationEvent,
  getPlatformConfig, getWordPressConnection, decryptWordPressPassword, wpRequest,
});
app.use('/api', distModule.router);
const getPublishableSocialConnection = distModule.getPublishableSocialConnection;
const normalizePlatformId = distModule.normalizePlatformId;
const markSocialAccountNeedsReapproval = distModule.markSocialAccountNeedsReapproval;
const listLinkedInAdminOrganizations = distModule.listLinkedInAdminOrganizations;
const fetchLinkedInOrganizationNetworkSize = distModule.fetchLinkedInOrganizationNetworkSize;
const refreshLinkedInAccessToken = distModule.refreshLinkedInAccessToken;
const fetchLinkedInSocialMetadataBatch = distModule.fetchLinkedInSocialMetadataBatch;
const fetchLinkedInShareStatisticsForPosts = distModule.fetchLinkedInShareStatisticsForPosts;
const sumLinkedInReactionCounts = distModule.sumLinkedInReactionCounts;
startSocialAutomationProcessor = distModule.startSocialAutomationProcessor;
startTokenHealthMonitor = distModule.startTokenHealthMonitor;

const { fireWorkflowTriggers, workflowRouter } = buildWorkflowEngine({ requireAuth, hasDatabase, dbQuery, enqueueSocialAutomationTask: distModule.enqueueSocialAutomationTask, getAIConfig, resolveActiveKey });

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
  queueSocialAutomationForPublishedPost: distModule.queueSocialAutomationForPublishedPost,
  recordAuditLog,
  getVisibleUserPlatformSlugs,
  syncSocialAutomationForPost: distModule.syncSocialAutomationForPost,
});
app.use('/api/v1/blog', blogRouter);
app.use('/api/blog', deprecatedApiPath('/api/v1/blog'), blogRouter);

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
app.use('/api/mailing', registerMailingRoutes({ requireAuth, pool: pool!, getResendConfig, fireAutomationTrigger: automationEngine.fireAutomationTrigger }));

// ─── CRM ─────────────────────────────────────────────────────────────────────
app.use('/api/crm', registerCRMCompaniesRoutes({ requireAuth, pool: pool! }));
app.use('/api/crm', registerCRMDealsRoutes({ requireAuth, pool: pool! }));
app.use('/api/crm', registerCRMActivitiesRoutes({ requireAuth, pool: pool! }));

// ─── Connector Abstraction Layer ──────────────────────────────────────────────
app.use('/api/connectors', registerConnectorRegistryRoutes({ requireAuth, pool: pool! }));
app.use('/api/connectors', registerConnectorPreferencesRoutes({ requireAuth, pool: pool! }));
app.use('/api/connectors', registerConnectorSyncRoutes({ requireAuth, pool: pool! }));

// ─── Surveys ──────────────────────────────────────────────────────────────────
app.use('/api/surveys', registerSurveyRoutes({ requireAuth, pool: pool! }));
app.use('/api/public/surveys', registerPublicSurveyRoutes({ pool: pool!, fireAutomationTrigger: automationEngine.fireAutomationTrigger }));

// ─── Leads & Google Sheets ──────────────────────────────────────────────────
const GS_CLIENT_ID = process.env.GOOGLE_SHEETS_CLIENT_ID || '';
const GS_CLIENT_SECRET = process.env.GOOGLE_SHEETS_CLIENT_SECRET || '';
const GS_REDIRECT = (process.env.API_URL || config.appUrl).replace(/\/$/, '') + '/api/google-sheets/callback';
const FRONTEND_URL = process.env.VITE_APP_URL || process.env.FRONTEND_URL || 'https://marketing.dakyworld.com';
const leadsDeps = { requireAuth, pool: pool!, frontendUrl: FRONTEND_URL, gsClientId: GS_CLIENT_ID, gsClientSecret: GS_CLIENT_SECRET, gsRedirect: GS_REDIRECT };
app.use('/api/leads', registerLeadsRoutes(leadsDeps));
app.use('/api/google-sheets', registerGoogleSheetsRoutes(leadsDeps));

// ─── Calendar (Google Calendar OAuth + events) ────────────────────────────────
app.use('/api/calendar', registerCalendarRoutes({ requireAuth, pool: pool!, getPlatformConfig, encryptIntegrationSecret, decryptIntegrationSecret, frontendUrl: FRONTEND_URL }));

// ─── Analytics Routes ───────────────────────────────────────────────────────
app.use('/api', registerAnalyticsRoutes({ requireAuth, pool, decryptIntegrationSecret, getPublishableSocialConnection, getPlatformConfig }));
// ─── End Analytics & Insights Engine ─────────────────────────────────────────

// ─── Campaign & Funnel Builder ────────────────────────────────────────────────
app.use('/api/campaign', registerCampaignRoutes({ requireAuth, pool: pool!, redisUrl: REDIS_URL }));
app.use('/api/track', registerTrackingRoutes({ pool: pool! }));
app.use('/r', registerShortLinkRoutes({ pool: pool!, fireAutomationTrigger: automationEngine.fireAutomationTrigger }));
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

// ─── Gmail Inbox Routes ────────────────────────────────────────────────────────
app.use('/api', registerGmailInboxRoutes({ requireAuth, pool, getPlatformConfig, encryptIntegrationSecret, decryptIntegrationSecret, getAIConfig, resolveActiveKey, GEMINI_MODELS, callAINonStreaming }));
// ── End Gmail Inbox Routes ────────────────────────────────────────────────────

// ─── Google AI Routes ──────────────────────────────────────────────────────────
app.use('/api', registerGoogleRoutes({ requireAuth, requireAdmin, hasDatabase, dbQuery, pool: pool! }));
// ── End Google AI Routes ──────────────────────────────────────────────────────

// ─── OpenAI Routes ─────────────────────────────────────────────────────────────
app.use('/api', registerOpenAIRoutes({ requireAuth, requireAdmin, hasDatabase, dbQuery, pool: pool! }));
// ── End OpenAI Routes ─────────────────────────────────────────────────────────

// ─── Workspace / Organization Routes ───────────────────────────────────────────
app.use('/api', registerOrgRoutes({ requireAuth, hasDatabase, dbQuery, requireOrgMembership, createNotification, checkTaskActions, logTaskActivity }));
// ── End Task Management Routes ─────────────────────────────────────────────────

// ── Workflow Routes ─────────────────────────────────────────────────────────
app.use('/api', workflowRouter);


// ── Automation Flows API ─────────────────────────────────────────────────────
app.use('/api', registerAutomationRoutes({ requireAuth, pool: pool!, runAutomationForContact: automationEngine.runAutomationForContact }));

// ── Public API: key management (authenticated) + inbound trigger (API-key auth) ──
app.use('/api', registerApiKeyRoutes({ requireAuth, pool: pool! }));
app.use('/api/v1', registerPublicTriggerRoutes({ pool, fireAutomationTrigger: automationEngine.fireAutomationTrigger }));

// ── Lead-capture forms (authenticated CRUD; public form served at /f/:id) ──
app.use('/api', registerFormsRoutes({ requireAuth, pool: pool! }));

// ── MCP integrations: admin server management + user media feed ──
app.use('/api/admin/mcp', registerMcpAdminRoutes({ requireAdmin, pool: pool!, encryptIntegrationSecret, decryptIntegrationSecret }));
app.use('/api/mcp', registerMcpMediaRoutes({ requireAuth, pool: pool! }));

// ── Auto-content plans (background promo content generation) ──
app.use('/api', registerContentPlanRoutes({ requireAuth, pool: pool!, createNotification, runPlanOnce: contentPlanEngine.runPlanOnce, pricePlan: contentPlanEngine.pricePlan }));

app.use((req: Request, res: Response) => {
  if (req.path.startsWith('/api/')) {
    return res.status(404).json({ success: false, error: 'Not found' });
  }
  // Serve the SPA shell for all non-API paths (handles hard refresh / deep links)
  if (indexHtmlContent) {
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    return res.send(indexHtmlContent);
  }
  res.status(404).json({ success: false, error: 'Not found' });
});

// Centralized error handling (must be last).
// Manual Sentry capture instead of setupExpressErrorHandler: that helper
// expects OTel instrumentation, which can't hook a bundled express (we ship
// one esbuild file) and logs a boot warning. Capture-then-forward is all we
// need for errors-only monitoring.
if (sentryEnabled) {
  app.use((err: unknown, _req: Request, _res: Response, next: NextFunction) => {
    Sentry.captureException(err);
    next(err);
  });
}
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
    const schedulerDeps = { queueSocialAutomationForPublishedPost: distModule.queueSocialAutomationForPublishedPost, fireWorkflowTriggers };
    void publishDuePosts(schedulerDeps);
    setInterval(() => void publishDuePosts(schedulerDeps), 2 * 60 * 1000);

    // Fire task reminders every 2 minutes
    void runTaskReminders();
    setInterval(() => void runTaskReminders(), 2 * 60 * 1000);

    // Run due automation continuations (delay steps) every 2 minutes
    void automationEngine.processDueAutomationJobs();
    setInterval(() => void automationEngine.processDueAutomationJobs(), 2 * 60 * 1000);

    // Run due connector sync jobs (hourly/6h/daily/weekly schedules) every 5 minutes
    void processDueConnectorSyncJobs(pool);
    setInterval(() => void processDueConnectorSyncJobs(pool), 5 * 60 * 1000);

    // Periodic integration scans. First run is delayed so a deploy/restart
    // doesn't immediately hammer external APIs; then every 6 hours.
    const runAnalyticsAutoSync = buildAnalyticsAutoSync({ requireAuth, pool, decryptIntegrationSecret, getPublishableSocialConnection, getPlatformConfig });
    const runGmailAutoSync = buildGmailAutoSync({ pool, getPlatformConfig, encryptIntegrationSecret, decryptIntegrationSecret });
    setTimeout(() => void runAnalyticsAutoSync(), 10 * 60 * 1000);
    setInterval(() => void runAnalyticsAutoSync(), 6 * 60 * 60 * 1000);
    setTimeout(() => void runGmailAutoSync(), 15 * 60 * 1000);
    setInterval(() => void runGmailAutoSync(), 6 * 60 * 60 * 1000);

    // Recompile agent skill briefs for users whose memories/brand changed
    // since the last compile — keeps the 14 agents in sync with
    // personalization edits. Daily, first run 20 minutes after boot.
    setTimeout(() => void processStaleAgentCompilations(pool, triggerAgentCompilation), 20 * 60 * 1000);
    setInterval(() => void processStaleAgentCompilations(pool, triggerAgentCompilation), 24 * 60 * 60 * 1000);

    // Pull fresh media from enabled MCP servers (MeiGen gallery) every 6 hours.
    setTimeout(() => void processMcpMediaSync(pool, decryptIntegrationSecret), 5 * 60 * 1000);
    setInterval(() => void processMcpMediaSync(pool, decryptIntegrationSecret), 6 * 60 * 60 * 1000);

    // Run due auto-content plans (e.g. 3 promo pieces/day) every 10 minutes.
    void contentPlanEngine.processDueContentPlans();
    setInterval(() => void contentPlanEngine.processDueContentPlans(), 10 * 60 * 1000);
  });
}

export default app;
