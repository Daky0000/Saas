import { Router, type Request, type Response } from 'express';
import axios from 'axios';
import { randomUUID } from 'crypto';
import type { Pool } from 'pg';
import { logger } from '../logger.ts';

// ── Local constants ────────────────────────────────────────────────────────────

const X_API_BASE = 'https://api.x.com';
const X_OAUTH_TOKEN_URL = `${X_API_BASE}/2/oauth2/token`;
const X_USERS_ME_API = `${X_API_BASE}/2/users/me`;

const META_GRAPH_BASE_LOCAL = 'https://graph.facebook.com/v19.0';
const INSTAGRAM_TARGET_REQUIRED_PERMISSIONS = ['pages_show_list', 'instagram_basic'];
const INSTAGRAM_RECOMMENDED_PERMISSIONS = ['instagram_content_publish', 'instagram_manage_insights'];
const INSTAGRAM_PROFILE_FIELDS = 'id,username,name,account_type,biography,followers_count,follows_count,media_count,profile_picture_url,website,is_verified';
const META_PAGE_PUBLISH_TASKS = new Set(['CREATE_CONTENT', 'MANAGE']);
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
const LINKEDIN_DEFAULT_OAUTH_SCOPES_LOCAL = [
  'r_liteprofile',
  'r_emailaddress',
  'w_member_social',
  'r_organization_admin',
  'rw_organization_admin',
  'r_organization_social',
  'w_organization_social',
];

// ── Deps interface ─────────────────────────────────────────────────────────────

export interface SocialConnectDeps {
  requireAuth: (req: Request, res: Response) => { userId: string } | null;
  hasDatabase: () => boolean;
  pool: Pool | null;
  dbQuery: <T = any>(sql: string, params?: any[]) => Promise<{ rows: T[]; rowCount?: number | null }>;
  getPublishableSocialConnection: (userId: string, platformId: string) => Promise<any>;
  normalizePlatformId: (value: string) => string;
  getPlatformConfig: (platform: string) => Promise<Record<string, string>>;
  resolveOAuthRedirectUri: (platform: string, redirectUri?: string, req?: Request) => string;
  getLinkedInOAuthScopeString: () => string;
  shouldEnableLinkedInExtendedLogin: () => boolean;
  parseLinkedInScopeList: (value: unknown) => string[];
  computeIsoFromTtlSeconds: (seconds: unknown) => string | null;
  encryptIntegrationSecret: (plain: string) => string;
  upsertUserIntegration: (params: {
    userId: string;
    integrationSlug: string;
    accessTokenEncrypted?: string | null;
    refreshTokenEncrypted?: string | null;
    tokenExpiry?: string | null;
    accountId?: string | null;
    accountName?: string | null;
    status: 'connected' | 'disconnected' | 'error';
  }) => Promise<void>;
  logIntegrationEvent: (params: {
    userId: string | null;
    integrationSlug: string | null;
    eventType: string;
    status: 'success' | 'failed' | 'info';
    response?: any;
  }) => Promise<void>;
  getUserConnectedAccounts: (userId: string) => Promise<any[]>;
  createNotification: (userId: string, type: string, title: string, message: string, data?: Record<string, any>, pinned?: boolean) => Promise<void>;
  checkTaskActions: (userId: string, actionType: string) => Promise<any[]>;
  getAIConfig: () => Promise<any>;
  resolveActiveKey: (cfg: any) => string | null;
  GEMINI_MODELS: string[];
  callAINonStreaming: (provider: string, apiKey: string, model: string, system: string, user: string, maxTokens?: number) => Promise<string>;
  publishToplatform: (userId: string, post: any, platformId: string) => Promise<any>;
}

// ── Meta Instagram helpers ─────────────────────────────────────────────────────

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
    const permsResp = await axios.get(`${META_GRAPH_BASE_LOCAL}/me/permissions`, {
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
    const resp = await axios.get(`${META_GRAPH_BASE_LOCAL}/${encodeURIComponent(igUserId)}`, {
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

  const pagesResp = await axios.get(`${META_GRAPH_BASE_LOCAL}/me/accounts`, {
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

// ── OAuth helper functions ─────────────────────────────────────────────────────

function platformDisplayName(platformId: string) {
  switch ((platformId || '').trim().toLowerCase()) {
    case 'instagram': return 'Instagram';
    case 'facebook': return 'Facebook';
    case 'linkedin': return 'LinkedIn';
    case 'twitter': return 'Twitter';
    case 'pinterest': return 'Pinterest';
    case 'tiktok': return 'TikTok';
    case 'threads': return 'Threads';
    default: return platformId;
  }
}

async function getOAuthStateRow(
  dbQuery: SocialConnectDeps['dbQuery'],
  state: string,
): Promise<{ user_id: string; platform: string; return_to?: string | null; code_verifier?: string | null } | null> {
  const result = await dbQuery<{ user_id: string; platform: string; return_to: string | null; code_verifier: string | null }>(
    'SELECT user_id, platform, return_to, code_verifier FROM oauth_states WHERE state = $1 AND expires_at > NOW()',
    [state]
  );
  return result.rows[0] ?? null;
}

function computeIsoFromUnixTimestamp(seconds: unknown): string | null {
  const value = Number(seconds);
  if (!Number.isFinite(value) || value <= 0) return null;
  return new Date(value * 1000).toISOString();
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

// ── LinkedIn OAuth helpers ─────────────────────────────────────────────────────

async function getLinkedInOAuthCredentials(
  getPlatformConfig: SocialConnectDeps['getPlatformConfig'],
  resolveOAuthRedirectUri: SocialConnectDeps['resolveOAuthRedirectUri'],
  req?: Request,
): Promise<{ clientId: string; redirectUri: string; clientSecrets: string[] }> {
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

async function introspectLinkedInAccessToken(
  getPlatformConfig: SocialConnectDeps['getPlatformConfig'],
  resolveOAuthRedirectUri: SocialConnectDeps['resolveOAuthRedirectUri'],
  accessToken: string,
  req?: Request,
): Promise<any | null> {
  const token = String(accessToken || '').trim();
  if (!token) return null;

  try {
    const credentials = await getLinkedInOAuthCredentials(getPlatformConfig, resolveOAuthRedirectUri, req);
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

function mergeLinkedInTokenMetadata(
  parseLinkedInScopeList: SocialConnectDeps['parseLinkedInScopeList'],
  computeIsoFromTtlSeconds: SocialConnectDeps['computeIsoFromTtlSeconds'],
  tokenData: any,
  introspection?: any,
) {
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

async function enrichLinkedInTokenData(
  getPlatformConfig: SocialConnectDeps['getPlatformConfig'],
  resolveOAuthRedirectUri: SocialConnectDeps['resolveOAuthRedirectUri'],
  parseLinkedInScopeList: SocialConnectDeps['parseLinkedInScopeList'],
  computeIsoFromTtlSeconds: SocialConnectDeps['computeIsoFromTtlSeconds'],
  tokenData: any,
  req?: Request,
) {
  const accessToken = String(tokenData?.access_token || '').trim();
  let enriched = tokenData && typeof tokenData === 'object' ? { ...tokenData } : {};

  if (accessToken) {
    const introspection = await introspectLinkedInAccessToken(getPlatformConfig, resolveOAuthRedirectUri, accessToken, req);
    enriched = mergeLinkedInTokenMetadata(parseLinkedInScopeList, computeIsoFromTtlSeconds, enriched, introspection);

    try {
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
    }
  }

  return enriched;
}

// ── Exchange functions ─────────────────────────────────────────────────────────

async function exchangePinterestCode(
  getPlatformConfig: SocialConnectDeps['getPlatformConfig'],
  resolveOAuthRedirectUri: SocialConnectDeps['resolveOAuthRedirectUri'],
  code: string,
  req?: Request,
) {
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
        if (me?.id) { tokenData.user_id = String(me.id); tokenData.id = String(me.id); }
        if (me?.username) tokenData.username = String(me.username);
        if (me?.profile_image) tokenData.avatar_url = String(me.profile_image);
        if (me?.follower_count != null) tokenData.followers_count = me.follower_count;
        if (me?.following_count != null) tokenData.following_count = me.following_count;
        if (me?.pin_count != null) tokenData.pin_count = me.pin_count;
        if (me?.board_count != null) tokenData.board_count = me.board_count;
        if (me?.monthly_views != null) tokenData.monthly_views = me.monthly_views;
        if (me?.website_url != null) tokenData.website_url = me.website_url;
        if (me?.about != null) tokenData.about = me.about;
        tokenData.name = String(me?.business_name || me?.username || tokenData?.name || '').trim() || tokenData?.name || null;
      }
    } catch (err) {
      logger.error('Unhandled error:', err);
    }
  }

  return tokenData;
}

async function exchangeInstagramCode(
  getPlatformConfig: SocialConnectDeps['getPlatformConfig'],
  resolveOAuthRedirectUri: SocialConnectDeps['resolveOAuthRedirectUri'],
  code: string,
) {
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

async function exchangeTwitterCode(
  getPlatformConfig: SocialConnectDeps['getPlatformConfig'],
  resolveOAuthRedirectUri: SocialConnectDeps['resolveOAuthRedirectUri'],
  code: string,
  codeVerifier?: string,
  req?: Request,
) {
  const cfg = await getPlatformConfig('twitter');
  const clientId = (cfg.clientId || process.env.VITE_TWITTER_CLIENT_ID || '').trim();
  const clientSecret = (cfg.clientSecret || process.env.TWITTER_CLIENT_SECRET || '').trim();
  const redirectUri = resolveOAuthRedirectUri('twitter', cfg.redirectUri || process.env.VITE_TWITTER_REDIRECT_URI, req);

  if (!clientId) throw new Error('Twitter Client ID is not configured. Set it in Admin → Integrations → X.');
  if (!clientSecret) throw new Error('Twitter Client Secret is not configured. Set it in Admin → Integrations → X.');

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
        tokenData.name = u.name || (u.username ? `@${u.username}` : null);
        if (u.profile_image_url) tokenData.avatar_url = u.profile_image_url;
      }
    } catch (err) {
      if (err instanceof Error && err.message.includes('X app is not attached to a Project')) {
        throw err;
      }
    }
  }
  return tokenData;
}

async function exchangeLinkedInCode(
  getPlatformConfig: SocialConnectDeps['getPlatformConfig'],
  resolveOAuthRedirectUri: SocialConnectDeps['resolveOAuthRedirectUri'],
  parseLinkedInScopeList: SocialConnectDeps['parseLinkedInScopeList'],
  computeIsoFromTtlSeconds: SocialConnectDeps['computeIsoFromTtlSeconds'],
  code: string,
  req?: Request,
) {
  const credentials = await getLinkedInOAuthCredentials(getPlatformConfig, resolveOAuthRedirectUri, req);
  const response = await postLinkedInOAuthForm({ grant_type: 'authorization_code', code }, credentials);
  if (response.status >= 400) {
    const errBody: any = response.data || {};
    const detail = errBody?.error_description || errBody?.error || '';
    throw new Error(`LinkedIn token exchange failed (${response.status})${detail ? `: ${detail}` : ''}`);
  }
  return enrichLinkedInTokenData(getPlatformConfig, resolveOAuthRedirectUri, parseLinkedInScopeList, computeIsoFromTtlSeconds, response.data || {}, req);
}

async function exchangeFacebookCode(
  getPlatformConfig: SocialConnectDeps['getPlatformConfig'],
  resolveOAuthRedirectUri: SocialConnectDeps['resolveOAuthRedirectUri'],
  code: string,
  redirectUriOverride?: string,
) {
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
        params: { fields: 'id,name,picture.width(256).height(256)', access_token: accessToken },
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
    }
  }

  return tokenData;
}

async function exchangeThreadsCode(
  getPlatformConfig: SocialConnectDeps['getPlatformConfig'],
  resolveOAuthRedirectUri: SocialConnectDeps['resolveOAuthRedirectUri'],
  code: string,
) {
  const cfg = await getPlatformConfig('threads');
  const clientId = cfg.appId || process.env.VITE_THREADS_APP_ID || process.env.VITE_THREADS_CLIENT_ID || process.env.VITE_INSTAGRAM_APP_ID || '';
  const clientSecret = cfg.appSecret || process.env.THREADS_APP_SECRET || process.env.VITE_THREADS_APP_SECRET || process.env.INSTAGRAM_APP_SECRET || '';
  const redirectUri = resolveOAuthRedirectUri('threads', cfg.redirectUri || process.env.VITE_THREADS_REDIRECT_URI);

  if (!clientId || !clientSecret || !redirectUri) throw new Error('Threads credentials not configured');

  const tokenBody = new URLSearchParams({ client_id: clientId, client_secret: clientSecret, grant_type: 'authorization_code', redirect_uri: redirectUri, code });
  const tokenRes = await axios.post('https://graph.threads.net/oauth/access_token', tokenBody.toString(), {
    headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' },
    validateStatus: () => true,
    timeout: 15000,
  });

  if (tokenRes.status >= 400) throw new Error(`Threads token exchange failed (${tokenRes.status})`);

  const tokenData: any = tokenRes.data || {};
  const shortLived = String(tokenData?.access_token || '').trim();
  if (!shortLived) return tokenData;

  let finalTokenData: any = tokenData;

  try {
    const longRes = await axios.get('https://graph.threads.net/access_token', {
      params: { grant_type: 'th_exchange_token', client_secret: clientSecret, access_token: shortLived },
      headers: { Authorization: `Bearer ${shortLived}` },
      validateStatus: () => true,
      timeout: 15000,
    });
    if (longRes.status < 400 && (longRes.data as any)?.access_token) {
      finalTokenData = { ...(tokenData || {}), ...(longRes.data || {}), short_lived_access_token: shortLived, access_token: String((longRes.data as any).access_token || '').trim() || shortLived };
    }
  } catch (err) {
    logger.error('Unhandled error:', err);
    finalTokenData = tokenData;
  }

  const accessToken = String(finalTokenData?.access_token || '').trim();
  if (accessToken) {
    try {
      const meResp = await axios.get('https://graph.threads.net/v1.0/me', {
        params: { fields: 'id,username,name,is_verified,threads_profile_picture_url,threads_biography', access_token: accessToken },
        validateStatus: () => true,
        timeout: 15000,
      });
      if (meResp.status < 400) {
        const me: any = meResp.data || {};
        const meId = me?.id ? String(me.id).trim() : '';
        if (meId) { finalTokenData.user_id = meId; finalTokenData.id = meId; finalTokenData.sub = meId; }
        if (me?.username) finalTokenData.username = String(me.username);
        if (me?.name) finalTokenData.name = String(me.name);
        if (me?.is_verified !== undefined) finalTokenData.is_verified = Boolean(me.is_verified);
        if (me?.threads_profile_picture_url) finalTokenData.avatar_url = String(me.threads_profile_picture_url);
        if (me?.threads_biography) finalTokenData.about = String(me.threads_biography);
      }
    } catch (err) {
      logger.error('Unhandled error:', err);
    }
  }

  return finalTokenData;
}

async function exchangeTikTokCode(
  getPlatformConfig: SocialConnectDeps['getPlatformConfig'],
  resolveOAuthRedirectUri: SocialConnectDeps['resolveOAuthRedirectUri'],
  code: string,
  codeVerifier?: string,
) {
  const cfg = await getPlatformConfig('tiktok');
  const clientKey = (cfg.clientKey || process.env.VITE_TIKTOK_CLIENT_ID || '').trim();
  const clientSecret = (cfg.clientSecret || process.env.TIKTOK_CLIENT_SECRET || '').trim();
  const redirectUri = resolveOAuthRedirectUri('tiktok', cfg.redirectUri || process.env.VITE_TIKTOK_REDIRECT_URI);

  const data = new URLSearchParams({ client_key: clientKey, client_secret: clientSecret, code, grant_type: 'authorization_code', redirect_uri: redirectUri });
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
    }
  }
  if (openId && !tokenData.user_id) tokenData.user_id = openId;
  return tokenData;
}

async function exchangeGmailCode(
  getPlatformConfig: SocialConnectDeps['getPlatformConfig'],
  resolveOAuthRedirectUri: SocialConnectDeps['resolveOAuthRedirectUri'],
  code: string,
  req?: Request,
) {
  const cfg = await getPlatformConfig('gmail');
  const clientId = String(cfg.clientId || '').trim();
  const clientSecret = String(cfg.clientSecret || '').trim();
  const redirectUri = resolveOAuthRedirectUri('gmail', cfg.redirectUri, req);
  if (!clientId || !clientSecret) throw new Error('Gmail client credentials not configured');

  const data = new URLSearchParams({ code, client_id: clientId, client_secret: clientSecret, redirect_uri: redirectUri, grant_type: 'authorization_code' });
  const resp = await axios.post('https://oauth2.googleapis.com/token', data.toString(), {
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    validateStatus: () => true,
    timeout: 15000,
  });
  if (resp.status >= 400) {
    const msg = (resp.data as any)?.error_description || (resp.data as any)?.error || `Gmail token exchange failed (${resp.status})`;
    throw new Error(msg);
  }
  const tokenData: any = resp.data || {};

  const accessToken = String(tokenData?.access_token || '').trim();
  if (accessToken) {
    try {
      const meResp = await axios.get('https://www.googleapis.com/oauth2/v2/userinfo', {
        headers: { Authorization: `Bearer ${accessToken}` },
        validateStatus: () => true,
        timeout: 10000,
      });
      if (meResp.status < 400) {
        const me: any = meResp.data || {};
        if (me?.id) tokenData.user_id = String(me.id);
        if (me?.email) { tokenData.email = String(me.email); tokenData.username = String(me.email); }
        if (me?.name) tokenData.name = String(me.name);
        if (me?.picture) tokenData.avatar_url = String(me.picture);
      }
    } catch (err) {
      logger.error('Gmail userinfo error:', err);
    }
  }

  return tokenData;
}

async function exchangeSlackCode(
  getPlatformConfig: SocialConnectDeps['getPlatformConfig'],
  resolveOAuthRedirectUri: SocialConnectDeps['resolveOAuthRedirectUri'],
  code: string,
  req?: Request,
) {
  const cfg = await getPlatformConfig('slack');
  const clientId = String(cfg.clientId || '').trim();
  const clientSecret = String(cfg.clientSecret || '').trim();
  const redirectUri = resolveOAuthRedirectUri('slack', cfg.redirectUri, req);
  if (!clientId || !clientSecret) throw new Error('Slack client credentials not configured');

  const basic = Buffer.from(`${clientId}:${clientSecret}`).toString('base64');
  const data = new URLSearchParams({ code, redirect_uri: redirectUri, grant_type: 'authorization_code' });
  const resp = await axios.post('https://slack.com/api/oauth.v2.access', data.toString(), {
    headers: { 'Content-Type': 'application/x-www-form-urlencoded', Authorization: `Basic ${basic}` },
    validateStatus: () => true,
    timeout: 15000,
  });
  if (resp.status >= 400 || (resp.data as any)?.ok === false) {
    const msg = (resp.data as any)?.error || `Slack token exchange failed (${resp.status})`;
    throw new Error(msg);
  }
  const tokenData: any = resp.data || {};

  const teamId = String(tokenData?.team?.id || '').trim();
  const teamName = String(tokenData?.team?.name || '').trim();
  const userId = String(tokenData?.authed_user?.id || '').trim();
  if (teamId) tokenData.user_id = teamId;
  if (teamName) tokenData.name = teamName;
  if (userId) tokenData.authed_user_id = userId;
  tokenData.username = teamName || teamId;

  return tokenData;
}

async function exchangeZoomCode(
  getPlatformConfig: SocialConnectDeps['getPlatformConfig'],
  resolveOAuthRedirectUri: SocialConnectDeps['resolveOAuthRedirectUri'],
  code: string,
  req?: Request,
) {
  const cfg = await getPlatformConfig('zoom');
  const clientId = String(cfg.clientId || '').trim();
  const clientSecret = String(cfg.clientSecret || '').trim();
  const redirectUri = resolveOAuthRedirectUri('zoom', cfg.redirectUri, req);
  if (!clientId || !clientSecret) throw new Error('Zoom client credentials not configured');

  const basic = Buffer.from(`${clientId}:${clientSecret}`).toString('base64');
  const data = new URLSearchParams({ code, redirect_uri: redirectUri, grant_type: 'authorization_code' });
  const resp = await axios.post('https://zoom.us/oauth/token', data.toString(), {
    headers: { 'Content-Type': 'application/x-www-form-urlencoded', Authorization: `Basic ${basic}` },
    validateStatus: () => true,
    timeout: 15000,
  });
  if (resp.status >= 400) {
    const msg = (resp.data as any)?.reason || (resp.data as any)?.error || `Zoom token exchange failed (${resp.status})`;
    throw new Error(msg);
  }
  const tokenData: any = resp.data || {};

  const accessToken = String(tokenData?.access_token || '').trim();
  if (accessToken) {
    try {
      const meResp = await axios.get('https://api.zoom.us/v2/users/me', {
        headers: { Authorization: `Bearer ${accessToken}` },
        validateStatus: () => true,
        timeout: 10000,
      });
      if (meResp.status < 400) {
        const me: any = meResp.data || {};
        if (me?.id) tokenData.user_id = String(me.id);
        if (me?.email) { tokenData.email = String(me.email); tokenData.username = String(me.email); }
        const fullName = [String(me?.first_name || ''), String(me?.last_name || '')].filter(Boolean).join(' ').trim();
        if (fullName) tokenData.name = fullName;
        if (me?.pic_url) tokenData.avatar_url = String(me.pic_url);
      }
    } catch (err) {
      logger.error('Zoom userinfo error:', err);
    }
  }

  return tokenData;
}

async function exchangeOAuthCode(
  getPlatformConfig: SocialConnectDeps['getPlatformConfig'],
  resolveOAuthRedirectUri: SocialConnectDeps['resolveOAuthRedirectUri'],
  parseLinkedInScopeList: SocialConnectDeps['parseLinkedInScopeList'],
  computeIsoFromTtlSeconds: SocialConnectDeps['computeIsoFromTtlSeconds'],
  platformId: string,
  code: string,
  codeVerifier?: string,
  req?: Request,
) {
  switch ((platformId || '').trim().toLowerCase()) {
    case 'instagram':
      return exchangeInstagramCode(getPlatformConfig, resolveOAuthRedirectUri, code);
    case 'twitter':
      return exchangeTwitterCode(getPlatformConfig, resolveOAuthRedirectUri, code, codeVerifier, req);
    case 'linkedin':
      return exchangeLinkedInCode(getPlatformConfig, resolveOAuthRedirectUri, parseLinkedInScopeList, computeIsoFromTtlSeconds, code, req);
    case 'facebook':
      return exchangeFacebookCode(getPlatformConfig, resolveOAuthRedirectUri, code);
    case 'pinterest':
      return exchangePinterestCode(getPlatformConfig, resolveOAuthRedirectUri, code, req);
    case 'threads':
      return exchangeThreadsCode(getPlatformConfig, resolveOAuthRedirectUri, code);
    case 'tiktok':
      return exchangeTikTokCode(getPlatformConfig, resolveOAuthRedirectUri, code, codeVerifier);
    case 'gmail':
      return exchangeGmailCode(getPlatformConfig, resolveOAuthRedirectUri, code, req);
    case 'slack':
      return exchangeSlackCode(getPlatformConfig, resolveOAuthRedirectUri, code, req);
    case 'zoom':
      return exchangeZoomCode(getPlatformConfig, resolveOAuthRedirectUri, code, req);
    default:
      throw new Error('Unsupported platform');
  }
}

// ── Social connection helpers ──────────────────────────────────────────────────

async function seedSocialMemory(
  deps: Pick<SocialConnectDeps, 'dbQuery' | 'getAIConfig' | 'resolveActiveKey' | 'GEMINI_MODELS' | 'callAINonStreaming'>,
  userId: string,
  platform: string,
  profile: { handle: string; accountName: string | null; followers: number; bio?: string },
): Promise<void> {
  const { dbQuery, getAIConfig, resolveActiveKey, GEMINI_MODELS, callAINonStreaming } = deps;
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
        [`${platformLabel} social account`, content, (existing.rows[0] as any).id],
      );
    } else {
      await dbQuery(
        `INSERT INTO user_memories (id, user_id, title, content, source, created_at, updated_at)
         VALUES ($1, $2, $3, $4, $5, NOW(), NOW())`,
        [randomUUID(), userId, `${platformLabel} social account`, content, `social:${platform}`],
      );
    }
  } catch (err) {
    logger.error('seedSocialMemory DB error:', err);
  }
}

async function storeUserConnection(deps: SocialConnectDeps, userId: string, platform: string, tokenData: any): Promise<void> {
  const { pool, dbQuery, normalizePlatformId, encryptIntegrationSecret, upsertUserIntegration, logIntegrationEvent, createNotification, checkTaskActions, getAIConfig, resolveActiveKey, GEMINI_MODELS, callAINonStreaming } = deps;
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
    }
  }

  const handle = normalizedTokenData?.username || accountId || normalizedTokenData?.handle || `${platformId}_account`;
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
    [randomUUID(), userId, platformId, platformDbId, accountId, accountName, profileImage, String(handle), followers, expiresAt, tokenExpiresAt, null, null, accessTokenEncrypted, refreshTokenEncrypted, normalizedTokenData || {}]
  );

  await upsertUserIntegration({ userId, integrationSlug: platformId, accessTokenEncrypted, refreshTokenEncrypted, tokenExpiry: expiresAt, accountId, accountName, status: 'connected' });
  await logIntegrationEvent({ userId, integrationSlug: platformId, eventType: 'connection_attempt', status: 'success', response: { platform: platformId, accountId, accountName } });

  const platformLabel = platformId.charAt(0).toUpperCase() + platformId.slice(1);
  if (isFirstConnect) {
    seedSocialMemory({ dbQuery, getAIConfig, resolveActiveKey, GEMINI_MODELS, callAINonStreaming }, userId, platformId, {
      handle: String(handle),
      accountName: accountName || null,
      followers: Number(normalizedTokenData?.followers_count ?? followers),
      bio: normalizedTokenData?.bio ? String(normalizedTokenData.bio) : undefined,
    }).catch(() => undefined);
    createNotification(userId, 'social_connected', `${platformLabel} connected`, `Your ${platformLabel} account (@${handle}) has been connected successfully.`, { platform: platformId, handle: String(handle) }).catch(() => undefined);
    void checkTaskActions(userId, 'connect_social');
  } else {
    createNotification(userId, 'social_reconnected', `${platformLabel} reconnected`, `Your ${platformLabel} account (@${handle}) token has been refreshed.`, { platform: platformId, handle: String(handle) }).catch(() => undefined);
  }
}

async function removeUserConnection(deps: Pick<SocialConnectDeps, 'pool' | 'dbQuery' | 'normalizePlatformId' | 'upsertUserIntegration' | 'logIntegrationEvent'>, userId: string, platform: string): Promise<void> {
  if (!deps.pool) return;
  await deps.dbQuery('DELETE FROM social_accounts WHERE user_id = $1 AND LOWER(platform) = LOWER($2)', [userId, platform]);

  const platformId = deps.normalizePlatformId(platform);
  if (platformId) {
    await deps.upsertUserIntegration({ userId, integrationSlug: platformId, accessTokenEncrypted: null, refreshTokenEncrypted: null, tokenExpiry: null, accountId: null, accountName: null, status: 'disconnected' });
    await deps.logIntegrationEvent({ userId, integrationSlug: platformId, eventType: 'disconnect', status: 'info', response: {} });
  }
}

// ── Factory ────────────────────────────────────────────────────────────────────

export function registerSocialConnectRoutes(deps: SocialConnectDeps): Router {
  const router = Router();
  const { requireAuth, hasDatabase, pool, dbQuery, getPublishableSocialConnection, encryptIntegrationSecret, upsertUserIntegration, logIntegrationEvent, getUserConnectedAccounts, normalizePlatformId, getPlatformConfig, resolveOAuthRedirectUri, parseLinkedInScopeList, computeIsoFromTtlSeconds, publishToplatform } = deps;

  // POST /api/oauth/state
  router.post('/oauth/state', async (req: Request, res: Response) => {
    try {
      const auth = requireAuth(req, res);
      if (!auth) return;

      const { state, platform, returnTo, codeVerifier } = req.body as { state?: string; platform?: string; returnTo?: string; codeVerifier?: string };
      if (!state || !platform) return res.status(400).json({ success: false, error: 'Missing state or platform' });

      if (!pool) return res.status(503).json({ success: false, error: 'Database not configured' });

      await dbQuery(
        `INSERT INTO oauth_states (state, user_id, platform, return_to, code_verifier, expires_at)
         VALUES ($1, $2, $3, $4, $5, NOW() + INTERVAL '15 minutes')
         ON CONFLICT (state) DO NOTHING`,
        [state, auth.userId, platform, typeof returnTo === 'string' ? returnTo.slice(0, 500) : null, typeof codeVerifier === 'string' ? codeVerifier.slice(0, 2048) : null]
      );

      return res.json({ success: true });
    } catch (error) {
      logger.error('OAuth state error:', error);
      return res.status(500).json({ success: false, error: 'Failed to store state' });
    }
  });

  // GET /api/user-settings/:key
  router.get('/user-settings/:key', async (req: Request, res: Response) => {
    try {
      const auth = requireAuth(req, res);
      if (!auth) return;
      if (!hasDatabase()) return res.status(503).json({ success: false, error: 'Database not configured' });

      const key = String(req.params.key || '').trim();
      if (!/^[a-z0-9._:-]{1,80}$/i.test(key)) return res.status(400).json({ success: false, error: 'Invalid key' });

      const result = await dbQuery<{ value: any }>('SELECT value FROM user_settings WHERE user_id = $1 AND key = $2', [auth.userId, key]);
      return res.json({ success: true, value: result.rows[0]?.value ?? null });
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
      if (!/^[a-z0-9._:-]{1,80}$/i.test(key)) return res.status(400).json({ success: false, error: 'Invalid key' });

      const value = (req.body as any)?.value;
      if (typeof value === 'undefined') return res.status(400).json({ success: false, error: 'value is required' });

      await dbQuery(
        `INSERT INTO user_settings (user_id, key, value, created_at, updated_at) VALUES ($1, $2, $3::jsonb, NOW(), NOW())
         ON CONFLICT (user_id, key) DO UPDATE SET value = EXCLUDED.value, updated_at = NOW()`,
        [auth.userId, key, JSON.stringify(value)],
      );

      return res.json({ success: true });
    } catch (error) {
      logger.error('Save user setting error:', error);
      return res.status(500).json({ success: false, error: 'Failed to save setting' });
    }
  };

  router.put('/user-settings/:key', saveUserSetting);
  router.post('/user-settings/:key', saveUserSetting);

  // POST /api/oauth/callback
  router.post('/oauth/callback', async (req: Request, res: Response) => {
    try {
      const auth = requireAuth(req, res);
      if (!auth) return;

      const { platform, code, state } = req.body;

      if (!code || !state) return res.status(400).json({ success: false, error: 'Missing code or state' });

      const platformId = String(platform || '').trim().toLowerCase();
      const stateRow = await getOAuthStateRow(dbQuery, String(state));
      if (!stateRow) return res.status(400).json({ success: false, error: 'Invalid or expired state parameter' });
      if (String(stateRow.user_id) !== auth.userId) return res.status(400).json({ success: false, error: 'State does not match user' });
      if (String(stateRow.platform || '').trim().toLowerCase() !== platformId) return res.status(400).json({ success: false, error: 'State does not match platform' });

      const tokenData = await exchangeOAuthCode(getPlatformConfig, resolveOAuthRedirectUri, parseLinkedInScopeList, computeIsoFromTtlSeconds, platformId, String(code), stateRow.code_verifier || undefined, req);
      await storeUserConnection(deps, auth.userId, platformDisplayName(platformId), tokenData);
      await dbQuery('DELETE FROM oauth_states WHERE state = $1', [String(state)]).catch(() => undefined);

      return res.json({ success: true, data: tokenData, returnTo: (stateRow as any).return_to || null });
    } catch (error) {
      logger.error('OAuth callback error:', error);
      return res.status(500).json({ success: false, error: error instanceof Error ? error.message : 'OAuth callback failed' });
    }
  });

  // GET /api/accounts
  router.get('/accounts', async (req: Request, res: Response) => {
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

  // GET /api/facebook/targets
  router.get('/facebook/targets', async (req: Request, res: Response) => {
    try {
      const auth = requireAuth(req, res);
      if (!auth) return;
      if (!hasDatabase()) return res.status(503).json({ success: false, error: 'Database not configured' });

      const conn = await getPublishableSocialConnection(auth.userId, 'facebook');
      const accessToken = String(conn?.access_token || '').trim();
      if (!accessToken) return res.status(400).json({ success: false, error: 'Facebook access token missing or expired — please reconnect' });

      const graphBase = 'https://graph.facebook.com/v19.0';
      const warnings: string[] = [];

      const pagesResp = await axios.get(
        `${graphBase}/me/accounts?fields=id,name&limit=200&access_token=${encodeURIComponent(accessToken)}`,
        { validateStatus: () => true, timeout: 15000 }
      );
      const pagesData: any = pagesResp.data || {};
      if (pagesResp.status >= 400) {
        const msg = pagesData?.error?.message || `Facebook API error ${pagesResp.status}`;
        return res.status(400).json({ success: false, error: msg });
      }
      const pages = Array.isArray(pagesData?.data)
        ? pagesData.data.map((p: any) => ({ id: String(p?.id || '').trim(), name: String(p?.name || '').trim() })).filter((p: any) => p.id)
        : [];

      let groups: Array<{ id: string; name: string }> = [];
      try {
        const groupsResp = await axios.get(
          `${graphBase}/me/groups?fields=id,name&limit=200&access_token=${encodeURIComponent(accessToken)}`,
          { validateStatus: () => true, timeout: 15000 }
        );
        const groupsData: any = groupsResp.data || {};
        if (groupsResp.status >= 400) {
          warnings.push(groupsData?.error?.message || `Facebook groups lookup failed (${groupsResp.status})`);
        } else {
          groups = Array.isArray(groupsData?.data)
            ? groupsData.data.map((g: any) => ({ id: String(g?.id || '').trim(), name: String(g?.name || '').trim() })).filter((g: any) => g.id)
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

  // GET /api/instagram/targets
  router.get('/instagram/targets', async (req: Request, res: Response) => {
    try {
      const auth = requireAuth(req, res);
      if (!auth) return;
      if (!pool) return res.status(503).json({ success: false, error: 'Database not configured' });

      const fbConn = await getPublishableSocialConnection(auth.userId, 'facebook');
      const accessToken = String(fbConn?.access_token || '').trim();
      if (!accessToken) return res.status(400).json({ success: false, error: 'Meta access token missing or expired — reconnect Facebook to load Instagram business accounts' });

      const result = await listInstagramPageTargets(accessToken);
      return res.json({
        success: true,
        targets: result.targets.map(({ pageAccessToken, ...target }: any) => target),
        missingPermissions: result.missingPermissions,
        warnings: result.warnings,
      });
    } catch (error) {
      logger.error('Instagram targets error:', error);
      return res.status(500).json({ success: false, error: 'Failed to fetch Instagram targets' });
    }
  });

  // POST /api/instagram/connect
  router.post('/instagram/connect', async (req: Request, res: Response) => {
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
      if (!accessToken) return res.status(400).json({ success: false, error: 'Meta access token missing or expired — reconnect Facebook before linking Instagram' });

      const targetResult = await listInstagramPageTargets(accessToken);
      const match = (targetResult.targets || []).find((target: any) => target.pageId === pid);
      if (!match) return res.status(400).json({ success: false, error: 'Selected Facebook Page was not found in your Meta account list' });
      if (!match.instagramId || match.instagramId !== igId) return res.status(400).json({ success: false, error: 'Selected page is not linked to the requested Instagram professional account' });

      const pageToken = String((match as any).pageAccessToken || '').trim();
      if (!pageToken) return res.status(400).json({ success: false, error: 'Facebook Page access token not available for this Instagram account. Save the Page under Facebook first or reconnect Meta.' });

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
           SET account_id=EXCLUDED.account_id, account_name=EXCLUDED.account_name, handle=EXCLUDED.handle,
               profile_image=COALESCE(EXCLUDED.profile_image, social_accounts.profile_image),
               followers=CASE WHEN EXCLUDED.followers > 0 THEN EXCLUDED.followers ELSE social_accounts.followers END,
               connected=true, connected_at=NOW(),
               token_expires_at=COALESCE(EXCLUDED.token_expires_at, social_accounts.token_expires_at),
               access_token=EXCLUDED.access_token, access_token_encrypted=EXCLUDED.access_token_encrypted,
               token_data=EXCLUDED.token_data, needs_reapproval=false`,
        [randomUUID(), auth.userId, igId, displayName, handle, profileImage, followers, pageTokenExpiry, null, pageTokenEncrypted,
          JSON.stringify({ pageId: pid, pageName: (match as any).pageName || null, pagePicture: (match as any).pagePicture || null, pageTasks: (match as any).pageTasks || [], instagramUsername: handle, instagramName: displayName, accountType: profile?.account_type || (match as any).instagramAccountType || null, mediaCount: Number(profile?.media_count ?? (match as any).instagramMediaCount ?? 0), website: profile?.website || (match as any).instagramWebsite || null, biography: profile?.biography || (match as any).instagramBio || null, profilePictureUrl: profileImage || (match as any).instagramProfilePicture || null, canPublish: Boolean((match as any).canPublish), canInsights: Boolean((match as any).canInsights) })]
      );

      await upsertUserIntegration({ userId: auth.userId, integrationSlug: 'instagram', accessTokenEncrypted: pageTokenEncrypted, refreshTokenEncrypted: null, tokenExpiry: pageTokenExpiry, accountId: igId, accountName: displayName, status: 'connected' });
      await logIntegrationEvent({ userId: auth.userId, integrationSlug: 'instagram', eventType: 'connection_attempt', status: 'success', response: { pageId: pid, instagramId: igId, instagramUsername: handle, pageName: (match as any).pageName || null } });

      return res.json({ success: true });
    } catch (error) {
      logger.error('Instagram connect error:', error);
      await logIntegrationEvent({ userId: null, integrationSlug: 'instagram', eventType: 'connection_attempt', status: 'failed', response: { error: error instanceof Error ? error.message : 'Unknown error' } });
      return res.status(500).json({ success: false, error: 'Failed to connect Instagram' });
    }
  });

  // GET /api/pinterest/boards
  router.get('/pinterest/boards', async (req: Request, res: Response) => {
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
      if (resp.status >= 400) return res.status(400).json({ success: false, error: data?.message || data?.error || `Pinterest API error ${resp.status}` });
      const boards = Array.isArray(data?.items)
        ? data.items.map((b: any) => ({ id: String(b?.id || '').trim(), name: String(b?.name || '').trim() })).filter((b: any) => b.id)
        : [];

      return res.json({ success: true, boards });
    } catch (error) {
      logger.error('Pinterest boards error:', error);
      return res.status(500).json({ success: false, error: 'Failed to fetch Pinterest boards' });
    }
  });

  // POST /api/pinterest/boards
  router.post('/pinterest/boards', async (req: Request, res: Response) => {
    try {
      const auth = requireAuth(req, res);
      if (!auth) return;
      if (!pool) return res.status(503).json({ success: false, error: 'Database not configured' });

      const conn = await getPublishableSocialConnection(auth.userId, 'pinterest');
      const accessToken = String(conn?.access_token || '').trim();
      if (!accessToken) return res.status(400).json({ success: false, error: 'Pinterest access token missing or expired — please connect Pinterest' });

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
        if (typeof msg === 'string' && msg.includes('boards:write')) msg = 'Pinterest permission missing: boards:write. Reconnect Pinterest in Integrations, then try again.';
        return res.status(400).json({ success: false, error: msg });
      }

      const boardId = String(data?.id || '').trim();
      const boardName = String(data?.name || '').trim() || name;
      if (!boardId) return res.status(500).json({ success: false, error: 'Pinterest returned an invalid board id' });

      return res.json({ success: true, board: { id: boardId, name: boardName } });
    } catch (error) {
      logger.error('Pinterest create board error:', error);
      return res.status(500).json({ success: false, error: 'Failed to create Pinterest board' });
    }
  });

  // POST /api/integrations/mailchimp/connect
  router.post('/integrations/mailchimp/connect', async (req: Request, res: Response) => {
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
      await upsertUserIntegration({ userId: auth.userId, integrationSlug: 'mailchimp', accessTokenEncrypted: tokenEncrypted, refreshTokenEncrypted: null, tokenExpiry: null, accountId: prefix, accountName: 'Mailchimp', status: 'connected' });
      await logIntegrationEvent({ userId: auth.userId, integrationSlug: 'mailchimp', eventType: 'connection_attempt', status: 'success', response: { serverPrefix: prefix } });

      return res.json({ success: true });
    } catch (error) {
      logger.error('Mailchimp connect error:', error);
      await logIntegrationEvent({ userId: null, integrationSlug: 'mailchimp', eventType: 'connection_attempt', status: 'failed', response: { error: error instanceof Error ? error.message : 'Connect failed' } });
      return res.status(500).json({ success: false, error: 'Failed to connect Mailchimp' });
    }
  });

  // DELETE /api/integrations/mailchimp/disconnect
  router.delete('/integrations/mailchimp/disconnect', async (req: Request, res: Response) => {
    try {
      const auth = requireAuth(req, res);
      if (!auth) return;
      if (!pool) return res.json({ success: true });

      await upsertUserIntegration({ userId: auth.userId, integrationSlug: 'mailchimp', accessTokenEncrypted: null, refreshTokenEncrypted: null, tokenExpiry: null, accountId: null, accountName: null, status: 'disconnected' });
      await logIntegrationEvent({ userId: auth.userId, integrationSlug: 'mailchimp', eventType: 'disconnect', status: 'info', response: {} });

      return res.json({ success: true });
    } catch (error) {
      logger.error('Mailchimp disconnect error:', error);
      return res.status(500).json({ success: false, error: 'Failed to disconnect Mailchimp' });
    }
  });

  // POST /api/integrations/whatsapp/connect — manual WhatsApp Business Cloud API connection
  router.post('/integrations/whatsapp/connect', async (req: Request, res: Response) => {
    try {
      const auth = requireAuth(req, res);
      if (!auth) return;
      if (!pool) return res.status(503).json({ success: false, error: 'Database not configured' });

      const { phoneNumberId, accessToken, displayName } = req.body as { phoneNumberId?: string; accessToken?: string; displayName?: string };
      const pid = String(phoneNumberId || '').trim();
      const tok = String(accessToken || '').trim();
      if (!pid || !tok) return res.status(400).json({ success: false, error: 'phoneNumberId and accessToken are required' });

      const verifyResp = await axios.get(`https://graph.facebook.com/v19.0/${pid}?fields=id,display_phone_number,verified_name`, {
        headers: { Authorization: `Bearer ${tok}` },
        validateStatus: () => true,
        timeout: 10000,
      });
      if (verifyResp.status >= 400) {
        const msg = (verifyResp.data as any)?.error?.message || `WhatsApp API error (${verifyResp.status}). Check phone number ID and access token.`;
        return res.status(400).json({ success: false, error: msg });
      }
      const waData: any = verifyResp.data || {};
      const verifiedName = String(waData?.verified_name || displayName || 'WhatsApp Business').trim();
      const phoneDisplay = String(waData?.display_phone_number || pid).trim();

      const tokenEncrypted = encryptIntegrationSecret(JSON.stringify({ phoneNumberId: pid, accessToken: tok }));
      await upsertUserIntegration({ userId: auth.userId, integrationSlug: 'whatsapp', accessTokenEncrypted: tokenEncrypted, refreshTokenEncrypted: null, tokenExpiry: null, accountId: pid, accountName: `${verifiedName} (${phoneDisplay})`, status: 'connected' });
      await logIntegrationEvent({ userId: auth.userId, integrationSlug: 'whatsapp', eventType: 'connection_attempt', status: 'success', response: { phoneNumberId: pid, verifiedName } });

      return res.json({ success: true, accountName: `${verifiedName} (${phoneDisplay})` });
    } catch (error) {
      logger.error('WhatsApp connect error:', error);
      await logIntegrationEvent({ userId: null, integrationSlug: 'whatsapp', eventType: 'connection_attempt', status: 'failed', response: { error: error instanceof Error ? error.message : 'Connect failed' } });
      return res.status(500).json({ success: false, error: 'Failed to connect WhatsApp' });
    }
  });

  // DELETE /api/integrations/whatsapp/disconnect
  router.delete('/integrations/whatsapp/disconnect', async (req: Request, res: Response) => {
    try {
      const auth = requireAuth(req, res);
      if (!auth) return;
      if (!pool) return res.json({ success: true });

      await upsertUserIntegration({ userId: auth.userId, integrationSlug: 'whatsapp', accessTokenEncrypted: null, refreshTokenEncrypted: null, tokenExpiry: null, accountId: null, accountName: null, status: 'disconnected' });
      await logIntegrationEvent({ userId: auth.userId, integrationSlug: 'whatsapp', eventType: 'disconnect', status: 'info', response: {} });

      return res.json({ success: true });
    } catch (error) {
      logger.error('WhatsApp disconnect error:', error);
      return res.status(500).json({ success: false, error: 'Failed to disconnect WhatsApp' });
    }
  });

  // DELETE /api/accounts/:platform
  router.delete('/accounts/:platform', async (req: Request, res: Response) => {
    try {
      const auth = requireAuth(req, res);
      if (!auth) return;

      await removeUserConnection({ pool, dbQuery, normalizePlatformId, upsertUserIntegration, logIntegrationEvent }, auth.userId, req.params.platform);
      return res.json({ success: true });
    } catch (error) {
      logger.error('Disconnect error:', error);
      return res.status(500).json({ success: false, error: 'Failed to disconnect' });
    }
  });

  // GET /api/accounts/:platform/test
  router.get('/accounts/:platform/test', async (req: Request, res: Response) => {
    try {
      const auth = requireAuth(req, res);
      if (!auth) return;

      return res.json({ success: true, data: { status: 'ok', platform: req.params.platform, userId: auth.userId } });
    } catch (error) {
      logger.error('Test connection error:', error);
      return res.status(500).json({ success: false, error: 'Connection test failed' });
    }
  });

  // POST /api/posts/:platform/publish
  router.post('/posts/:platform/publish', async (req: Request, res: Response) => {
    try {
      const auth = requireAuth(req, res);
      if (!auth) return;

      const { platform } = req.params;
      const { text, media, hashtags } = req.body;
      const platformId = normalizePlatformId(platform);
      const fakePost = { id: randomUUID(), title: text || '', content: text || '', excerpt: text || '', tag_names: hashtags || [] };
      const result = await publishToplatform(auth.userId, fakePost, platformId);
      return res.json({ success: true, data: { postId: result.platformPostId || 'unknown', platform, status: result.status, error: result.error } });
    } catch (error) {
      logger.error('Publish error:', error);
      return res.status(500).json({ success: false, error: 'Failed to publish post' });
    }
  });

  // GET /api/analytics/:platform (deprecated 410 stub)
  router.get('/analytics/:platform', (_req: Request, res: Response) => {
    return res.status(410).json({ success: false, error: 'Use /api/analytics/social/accounts or /api/blog/analytics/dashboard' });
  });

  return router;
}
