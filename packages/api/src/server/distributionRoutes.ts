import axios from 'axios';
import type { Request, Response } from 'express';
import { Router } from 'express';
import type { Pool } from 'pg';
import { Queue, Worker } from 'bullmq';
import IORedis from 'ioredis';
import { FacebookPagesPlatform } from '../../backend/platforms/facebook_pages.ts';
import { InstagramBusinessPlatform } from '../../backend/platforms/instagram_business.ts';
import { LinkedInPlatform } from '../../backend/platforms/linkedin.ts';
import { TwitterXPlatform } from '../../backend/platforms/twitter_x.ts';
import { TikTokAdapter } from '../../backend/src/services/platform-adapters/tiktok.adapter.ts';
import type { PostObject } from '../../backend/platforms/types.ts';
import { config } from '../config.ts';
import { logger } from '../logger.ts';
import {
  getLinkedInRestHeaders,
  parseLinkedInOrganizationId as _parseLinkedInOrganizationId,
  fetchLinkedInOrganizationsByIds,
  fetchLinkedInOrganizationNetworkSize,
  fetchLinkedInPostsByAuthor,
  fetchLinkedInSocialMetadataBatch,
  sumLinkedInReactionCounts,
  fetchLinkedInShareStatisticsForPosts,
  listLinkedInAdminOrganizations,
  resolveLinkedInProfileIdentity,
  extractLinkedInOrganizationDescription,
  extractLinkedInPostText,
  extractLinkedInPostMediaType,
} from './distribution/linkedinHelpers.ts';

// 鈹€鈹€鈹€ Deps 鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€

export interface DistributionDeps {
  requireAuth: (req: Request, res: Response) => { userId: string; role: string; tokenVersion: number | null } | null;
  pool: Pool | null;
  dbQuery: <T = any>(sql: string, params?: any[]) => Promise<{ rows: T[] }>;
  decryptIntegrationSecret: (encrypted: string) => string;
  getIntegrationRowBySlug: (slug: string) => Promise<{ id: number; slug: string; name: string | null; type: string | null } | null>;
  logIntegrationEvent: (params: { userId: string | null; integrationSlug: string | null; eventType: string; status: 'success' | 'failed' | 'info'; response?: any }) => Promise<void>;
  getPlatformConfig: (platform: string) => Promise<Record<string, string>>;
  getWordPressConnection: (userId: string) => Promise<any>;
  decryptWordPressPassword: (encrypted: string) => string;
  wpRequest: (siteUrl: string, username: string, password: string, method: string, path: string, opts?: any) => Promise<any>;
}

export type PublishableSocialConnection = {
  platform: string;
  access_token: string;
  refresh_token?: string | null;
  token_data: any;
  account_id?: string | null;
  account_name?: string | null;
  needs_reapproval?: boolean;
  token_expires_at?: string | null;
};

// 鈹€鈹€鈹€ Platform instances (singletons) 鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€

const facebookPagesPlatform = new FacebookPagesPlatform();
const instagramBusinessPlatform = new InstagramBusinessPlatform();
const linkedInPlatform = new LinkedInPlatform();
const twitterXPlatform = new TwitterXPlatform();

const REDIS_URL = config.redisUrl;
function isBullMqEnabled() {
  return Boolean(REDIS_URL && REDIS_URL.trim());
}

// 鈹€鈹€鈹€ Factory 鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€

export interface DistributionModule {
  router: Router;
  getPublishableSocialConnection: (userId: string, platformId: string) => Promise<PublishableSocialConnection | null>;
  markSocialAccountNeedsReapproval: (params: { platformId: string; accountId?: string | null; userId?: string | null; reason?: string; disconnect?: boolean }) => Promise<void>;
  listLinkedInAdminOrganizations: (accessToken: string, personId: string, options?: { allowedRoles?: string[] }) => Promise<{ organizations: Array<{ id: string; name: string; picture_url?: string | null; roles?: string[] }>; warning: string | null }>;
  fetchLinkedInOrganizationNetworkSize: (accessToken: string, organizationUrn: string) => Promise<number | null>;
  refreshLinkedInAccessToken: (refreshToken: string, req?: Request) => Promise<any>;
  fetchLinkedInSocialMetadataBatch: (accessToken: string, entityUrns: string[]) => Promise<Record<string, any>>;
  fetchLinkedInShareStatisticsForPosts: (accessToken: string, authorUrn: string, postIds: string[]) => Promise<Map<string, any>>;
  sumLinkedInReactionCounts: (metadata: any) => number;
  startSocialAutomationProcessor: () => void;
  startTokenHealthMonitor: () => void;
  normalizePlatformId: (value: string) => string;
  getSocialTemplateDefaults: (platformId: string) => any;
  mergeSocialTemplateSettings: (platformId: string, input: any) => any;
  renderSocialTemplatePreview: (userId: string, post: any, settings: any) => Promise<any>;
  loadSocialTemplateSettings: (userId: string, platformId: string) => Promise<any>;
  enqueueSocialAutomationTask: (params: any) => Promise<void>;
  syncSocialAutomationForPost: (userId: string, postId: string) => Promise<void>;
}

export function buildDistributionModule(deps: DistributionDeps): DistributionModule {
  const {
    requireAuth, pool, dbQuery,
    decryptIntegrationSecret, getIntegrationRowBySlug, logIntegrationEvent,
    getPlatformConfig, getWordPressConnection, decryptWordPressPassword, wpRequest,
  } = deps;
  const router = Router();


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
  // Primary: /v2/me (r_liteprofile 鈥?standard "Share on LinkedIn" scope)
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
  ).catch(() => ({ rows: [] as any[] }));

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
// Call 1 (always): basic identity fields 鈥?always works with user.info.basic
// Call 2 (optional): stats fields 鈥?silently skipped if scope not approved

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
          error: 'No Pinterest board selected. Pick a default board in Analytics 鈫?Pinterest, or create a board on Pinterest first.',
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

      // Step 2: Initialize post 鈥?photo post if image available, otherwise text-to-video (draft)
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

      // No image 鈥?send as draft video so user can finish in TikTok app
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
      await logIntegrationEvent({ userId, integrationSlug: 'tiktok', eventType: 'post_drafted', status: 'success', response: { publishId: draftPublishId, note: 'Text-only post sent as TikTok draft 鈥?open TikTok app to finish and post' } });
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
router.get('/api/distribution/connected', async (req: Request, res: Response) => {
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
router.post('/api/distribution/publish', async (req: Request, res: Response) => {
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
router.get('/api/distribution/status/:postId', async (req: Request, res: Response) => {
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
router.get('/api/automation/logs', async (req: Request, res: Response) => {
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
router.post('/api/automation/retry/:logId', async (req: Request, res: Response) => {
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

// 鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺?Meta Data Deletion (Facebook requirement) 鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺?
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

// POST /api/meta/data-deletion 鈥?Meta "Data Deletion Request URL"
router.post('/api/meta/data-deletion', async (req: Request, res: Response) => {
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

// GET /api/meta/data-deletion/status?code=... 鈥?used by our public status page
router.get('/api/meta/data-deletion/status', async (req: Request, res: Response) => {
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

// POST /api/meta/deauthorize 鈥?Meta "Deauthorize Callback URL"
router.post('/api/meta/deauthorize', async (req: Request, res: Response) => {
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
router.get('/', (req: Request, res: Response) => {
  if (hasStaticFiles) {
    res.sendFile(path.join(publicDir, 'index.html'));
    return;
  }
  res.json({ message: 'OAuth Backend Server Running', version: '1.0.0' });
});


  return {
    router,
    getPublishableSocialConnection,
    markSocialAccountNeedsReapproval,
    listLinkedInAdminOrganizations,
    fetchLinkedInOrganizationNetworkSize,
    refreshLinkedInAccessToken,
    fetchLinkedInSocialMetadataBatch,
    fetchLinkedInShareStatisticsForPosts,
    sumLinkedInReactionCounts,
    startSocialAutomationProcessor,
    startTokenHealthMonitor,
    normalizePlatformId,
    getSocialTemplateDefaults,
    mergeSocialTemplateSettings,
    renderSocialTemplatePreview,
    loadSocialTemplateSettings,
    enqueueSocialAutomationTask,
    syncSocialAutomationForPost,
    queueSocialAutomationForPublishedPost,
  };
}
