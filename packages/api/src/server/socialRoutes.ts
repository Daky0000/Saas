import axios from 'axios';
import type { Request, Response } from 'express';
import { Router } from 'express';
import type { Pool } from 'pg';
import { logger } from '../logger.ts';

// ─── Deps ─────────────────────────────────────────────────────────────────────

export interface SocialDeps {
  requireAuth: (req: Request, res: Response) => { userId: string; role: string; tokenVersion: number | null } | null;
  requireAdmin: (req: Request, res: Response) => Promise<{ userId: string } | null>;
  hasDatabase: () => boolean;
  pool: Pool | null;
  dbQuery: <T = any>(sql: string, params?: any[]) => Promise<{ rows: T[] }>;
  getPlatformConfig: (platform: string) => Promise<Record<string, string>>;
  getPublishableSocialConnection: (userId: string, platformId: string) => Promise<any>;
  normalizePlatformId: (value: string) => string;
  getSocialTemplateDefaults: (platformId: string) => any;
  mergeSocialTemplateSettings: (platformId: string, input: any) => any;
  renderSocialTemplatePreview: (userId: string, post: any, settings: any) => Promise<any>;
  loadSocialTemplateSettings: (userId: string, platformId: string) => Promise<any>;
  enqueueSocialAutomationTask: (params: any) => Promise<void>;
  syncSocialAutomationForPost: (userId: string, postId: string) => Promise<void>;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

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

// ─── Factory ──────────────────────────────────────────────────────────────────

export function registerSocialRoutes(deps: SocialDeps): Router {
  const {
    requireAuth, requireAdmin, hasDatabase, pool, dbQuery,
    getPlatformConfig, getPublishableSocialConnection,
    normalizePlatformId, getSocialTemplateDefaults, mergeSocialTemplateSettings,
    renderSocialTemplatePreview, loadSocialTemplateSettings,
    enqueueSocialAutomationTask, syncSocialAutomationForPost,
  } = deps;
  const router = Router();


// GET /api/v1/social/facebook/connect — start OAuth and redirect to Facebook
router.get('/v1/social/facebook/connect', async (req: Request, res: Response) => {
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

    const redirectUri = resolveBackendRedirectUri('/v1/social/facebook/callback', req);
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
router.get('/v1/social/facebook/authorize-url', async (req: Request, res: Response) => {
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

    const redirectUri = resolveBackendRedirectUri('/v1/social/facebook/callback', req);
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
router.get('/v1/social/facebook/callback', async (req: Request, res: Response) => {
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

    const redirectUri = resolveBackendRedirectUri('/v1/social/facebook/callback', req);
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
router.get('/v1/social/facebook/pages', async (req: Request, res: Response) => {
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
router.get('/v1/social/facebook/targets', async (req: Request, res: Response) => {
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
router.get('/v1/social/facebook/page-insights', async (req: Request, res: Response) => {
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
router.get('/v1/social/facebook/post-insights', async (req: Request, res: Response) => {
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
router.post('/v1/social/facebook/token-refresh', async (req: Request, res: Response) => {
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
router.post('/v1/social/accounts', async (req: Request, res: Response) => {
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
router.get('/v1/social/accounts', async (req: Request, res: Response) => {
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
router.delete('/v1/social/accounts/:id', async (req: Request, res: Response) => {
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
router.post('/v1/posts/:postId/social-repost', async (req: Request, res: Response) => {
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
router.post('/v1/posts/:postId/social-settings', async (req: Request, res: Response) => {
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
router.get('/v1/posts/:postId/social-settings', async (req: Request, res: Response) => {
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
router.get('/social-templates/:platform', async (req: Request, res: Response) => {
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
router.put('/social-templates/:platform', async (req: Request, res: Response) => {
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
router.post('/social-templates/:platform/preview', async (req: Request, res: Response) => {
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
router.delete('/admin/platform-configs/:platform', async (req: Request, res: Response) => {
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
router.get('/auth/:platform/callback', async (req: Request, res: Response) => {
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
router.patch('/admin/platform-configs/:platform/toggle', async (req: Request, res: Response) => {
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
router.get('/admin/platform-configs/:platform/test', async (req: Request, res: Response) => {
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

  return router;
}
