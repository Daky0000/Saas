import type { Request } from 'express';
import { logger } from './logger.ts';
import { pool, dbQuery } from './db.ts';
import { getPlatformConfig } from './user-auth.ts';
import { getLinkedInOAuthScopeString } from './social-helpers.ts';

// normalizePlatformId is defined locally in platformConfigRoutes.ts.
// resolveBackendRedirectUri is defined here to avoid the broken declare pattern.
function normalizePlatformId(platform: string): string {
  const raw = String(platform || '').trim().toLowerCase();
  if (!raw) return '';
  if (raw === 'twitter / x' || raw === 'twitter/x' || raw === 'x') return 'twitter';
  return raw;
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

function resolveBackendRedirectUri(raw: string, req?: Request): string {
  const r = String(raw || '').trim();
  if (!r) return '';
  if (r.startsWith('http://') || r.startsWith('https://')) return r;
  const base = getBackendPublicUrl(req);
  if (!base) return r.startsWith('/') ? r : `/${r}`;
  return r.startsWith('/') ? `${base}${r}` : `${base}/${r}`;
}

export async function getUserSaaSContext(userId: string): Promise<string> {
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

export async function getEnabledPlatformSlugs(): Promise<string[]> {
  if (!pool) return [];
  const result = await dbQuery(`SELECT platform FROM platform_configs WHERE enabled = true`);
  return result.rows.map((row: any) => String(row.platform || '').toLowerCase()).filter(Boolean);
}

export function isOAuthClientSecretRequired(platform: string): boolean {
  const slug = String(platform || '').trim().toLowerCase();
  return slug === 'instagram' || slug === 'facebook' || slug === 'threads' || slug === 'linkedin' || slug === 'tiktok' || slug === 'pinterest' || slug === 'gmail' || slug === 'slack' || slug === 'zoom';
}

export async function getVisibleUserPlatformSlugs(): Promise<string[]> {
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

export function formatSocialAccountLabel(
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

export async function getUserConnectedAccounts(userId: string): Promise<any[]> {
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

const META_BASE_SCOPES = ['public_profile', 'email', 'pages_show_list', 'pages_read_engagement', 'pages_manage_posts', 'pages_manage_metadata', 'read_insights'];
const META_INSTAGRAM_SCOPES = ['instagram_basic', 'instagram_content_publish', 'instagram_manage_insights'];
function getMetaOAuthScopeString(extraScopes: string[] = []): string {
  return Array.from(new Set([...META_BASE_SCOPES, ...META_INSTAGRAM_SCOPES, ...extraScopes])).join(',');
}

export const OAUTH_AUTH_URLS: Record<string, { authUrl: string; scopes: string; idField: 'appId' | 'clientId' | 'clientKey' }> = {
  instagram: { authUrl: 'https://api.instagram.com/oauth/authorize', scopes: 'user_profile,user_media', idField: 'appId' },
  facebook:  { authUrl: 'https://www.facebook.com/v19.0/dialog/oauth', scopes: getMetaOAuthScopeString(), idField: 'appId' },
  linkedin:  {
    authUrl: 'https://www.linkedin.com/oauth/v2/authorization',
    scopes: getLinkedInOAuthScopeString(),
    idField: 'clientId',
  },
  // tweet.write is sufficient for posting tweets; media.write is not a standard OAuth 2.0 scope.
  twitter:   { authUrl: 'https://twitter.com/i/oauth2/authorize', scopes: 'tweet.read tweet.write users.read offline.access', idField: 'clientId' },
  pinterest: { authUrl: 'https://www.pinterest.com/oauth/', scopes: 'boards:read,boards:write,pins:read,pins:write,user_accounts:read', idField: 'clientId' },
  tiktok:    { authUrl: 'https://www.tiktok.com/v2/auth/authorize/', scopes: 'user.info.basic,user.info.profile,user.info.stats,video.list,video.upload,video.publish', idField: 'clientKey' },
  threads:   { authUrl: 'https://www.threads.net/oauth/authorize', scopes: 'threads_basic,threads_content_publish,threads_manage_insights,threads_read_replies,threads_manage_replies,threads_location_tagging', idField: 'appId' },
  gmail:     { authUrl: 'https://accounts.google.com/o/oauth2/v2/auth', scopes: 'https://www.googleapis.com/auth/gmail.send https://www.googleapis.com/auth/userinfo.email https://www.googleapis.com/auth/userinfo.profile', idField: 'clientId' },
  slack:     { authUrl: 'https://slack.com/oauth/v2/authorize', scopes: 'chat:write,channels:read,users:read,team:read', idField: 'clientId' },
  zoom:      { authUrl: 'https://zoom.us/oauth/authorize', scopes: 'meeting:read:list_meetings meeting:write:meeting user:read:user', idField: 'clientId' },
};

const DEFAULT_OAUTH_REDIRECTS: Record<string, string> = {
  instagram: '/auth/instagram/callback',
  facebook: '/auth/facebook/callback',
  linkedin: '/auth/linkedin/callback',
  twitter: '/auth/twitter/callback',
  pinterest: '/auth/pinterest/callback',
  tiktok: '/auth/tiktok/callback',
  threads: '/auth/threads/callback',
  gmail: '/auth/gmail/callback',
  slack: '/auth/slack/callback',
  zoom: '/auth/zoom/callback',
};

function getDefaultOAuthRedirectPath(platform: string): string {
  const key = String(platform || '').trim().toLowerCase();
  return DEFAULT_OAUTH_REDIRECTS[key] || `/auth/${key}/callback`;
}

export function resolveOAuthRedirectUri(platform: string, redirectUri?: string, req?: Request): string {
  if (!OAUTH_AUTH_URLS[platform]) return '';
  const raw = String(redirectUri || '').trim() || getDefaultOAuthRedirectPath(platform);
  return resolveBackendRedirectUri(raw, req);
}
