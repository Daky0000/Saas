import express from 'express';
import type { Router, Request, Response } from 'express';
import axios from 'axios';
import { randomBytes, randomUUID } from 'crypto';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { logger } from '../logger.ts';

type AuthResult = { userId: string; role?: string } | null;

interface SocialAuthDeps {
  requireAuth: (req: Request, res: Response) => AuthResult;
  requireAdmin: (req: Request, res: Response) => Promise<AuthResult>;
  hasDatabase: () => boolean;
  dbQuery: <T = any>(sql: string, params?: unknown[]) => Promise<{ rows: T[] }>;
  jwtSecret: string;
  jwtExpiresIn: string;
}

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

// Module-level OAuth state store (replaces app.locals usage; auto-expires entries)
const oauthStateStore = new Map<string, { provider: string; expiry: number }>();

export function registerSocialAuthRoutes({ requireAuth, requireAdmin, hasDatabase, dbQuery, jwtSecret, jwtExpiresIn }: SocialAuthDeps): Router {
  const router = express.Router();

  // GET /api/auth/:provider/start — redirect to provider's OAuth page
  router.get('/api/auth/:provider/start', async (req: Request, res: Response) => {
    try {
      const { provider } = req.params as { provider: string };
      const cfg = SOCIAL_PROVIDER_CONFIG[provider];
      if (!cfg) return res.status(404).json({ success: false, error: 'Unknown provider' });

      const providerRow = await dbQuery('SELECT config, enabled FROM auth_providers WHERE provider = $1', [provider]).catch(() => ({ rows: [] }));
      if (!providerRow.rows.length || !(providerRow.rows[0] as any).enabled) {
        return res.status(403).json({ success: false, error: 'Provider not enabled' });
      }
      const config = (providerRow.rows[0] as any).config as Record<string, string>;
      const clientId = config.clientId || '';
      const redirectUri = config.redirectUri || '';
      if (!clientId || !redirectUri) return res.status(400).json({ success: false, error: 'Provider not configured' });

      const state = randomBytes(16).toString('hex');
      oauthStateStore.set(`oauth_state_${state}`, { provider, expiry: Date.now() + 600_000 });

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
      logger.error('Social auth start error:', error);
      return res.status(500).json({ success: false, error: 'Failed to start social login' });
    }
  });

  // GET /auth/:provider/callback — handle social login; pass-through integration callbacks to frontend SPA
  router.get('/auth/:provider/callback', async (req: Request, res: Response) => {
    const FRONTEND_URL = process.env.VITE_APP_URL || process.env.FRONTEND_URL || 'https://marketing.dakyworld.com';
    try {
      const { provider } = req.params as { provider: string };
      const providerKey = String(provider || '').trim().toLowerCase();

      // Integration callbacks (LinkedIn/Twitter/Facebook/Instagram/Pinterest/Threads) belong to the frontend SPA path.
      if (!SOCIAL_PROVIDER_CONFIG[providerKey]) {
        const hasError = req.query['error'] || req.query['error_description'];
        if (hasError) logger.error(`OAuth callback error for ${providerKey}:`, req.query);
        const query = new URLSearchParams(req.query as Record<string, string>).toString();
        const target = `${FRONTEND_URL}/auth/${encodeURIComponent(providerKey)}/callback${query ? `?${query}` : ''}`;
        return res.redirect(target);
      }

      const { code, state, error: oauthError } = req.query as Record<string, string>;
      if (oauthError) return res.redirect(`${FRONTEND_URL}/?auth_error=${encodeURIComponent(oauthError)}`);

      // Validate state
      const stateKey = `oauth_state_${state}`;
      const storedState = oauthStateStore.get(stateKey);
      if (!storedState || storedState.provider !== provider || Date.now() > storedState.expiry) {
        return res.redirect(`${FRONTEND_URL}/?auth_error=${encodeURIComponent('Invalid or expired state')}`);
      }
      oauthStateStore.delete(stateKey);

      const cfg = SOCIAL_PROVIDER_CONFIG[provider];
      if (!cfg) return res.redirect(`${FRONTEND_URL}/?auth_error=unknown_provider`);

      const providerRow = await dbQuery('SELECT config FROM auth_providers WHERE provider = $1', [provider]).catch(() => ({ rows: [] }));
      if (!providerRow.rows.length) return res.redirect(`${FRONTEND_URL}/?auth_error=provider_not_configured`);
      const config = (providerRow.rows[0] as any).config as Record<string, string>;

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
          userId = (existing.rows[0] as any).id as string;
          userRole = (existing.rows[0] as any).role as string;
          await dbQuery('UPDATE users SET last_login_at = NOW() WHERE id = $1', [userId]);
        } else {
          userId = randomUUID();
          const username = `${provider}_${(socialId as string).slice(0, 8)}`;
          await dbQuery(
            `INSERT INTO users (id, name, username, email, password_hash, role, status, created_at, last_login_at)
             VALUES ($1, $2, $3, $4, $5, 'user', 'active', NOW(), NOW())`,
            [userId, name, username, email, await bcrypt.hash(randomBytes(16).toString('hex'), 12)],
          );
        }
      } else {
        userId = randomUUID();
      }

      const token = jwt.sign({ userId, email, role: userRole }, jwtSecret, { expiresIn: jwtExpiresIn });
      return res.redirect(`${FRONTEND_URL}/?auth_token=${token}&auth_provider=${provider}`);
    } catch (error) {
      logger.error('Social auth callback error:', error);
      const FRONTEND_URL = process.env.VITE_APP_URL || process.env.FRONTEND_URL || 'https://marketing.dakyworld.com';
      return res.redirect(`${FRONTEND_URL}/?auth_error=${encodeURIComponent('Social login failed')}`);
    }
  });

  // GET /api/auth/providers — public: returns only enabled providers (for login page)
  router.get('/api/auth/providers', async (req: Request, res: Response) => {
    try {
      if (hasDatabase()) {
        const result = await dbQuery('SELECT provider, config FROM auth_providers WHERE enabled = true ORDER BY provider').catch((error) => {
          logger.error('Auth providers query failed; falling back to empty list:', error);
          return { rows: [] as any[] } as any;
        });
        return res.json({
          success: true,
          providers: result.rows.map((r: any) => ({
            provider: r.provider as string,
            clientId: ((r.config || {}) as Record<string, string>).clientId || '',
          })),
        });
      }
      return res.json({ success: true, providers: [] });
    } catch (error) {
      logger.error('Get auth providers error:', error);
      return res.json({ success: true, providers: [] });
    }
  });

  // POST /api/auth/facebook/token — verify FB JS SDK access token, sign in / register user
  router.post('/api/auth/facebook/token', async (req: Request, res: Response) => {
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
          userId   = (existing.rows[0] as any).id as string;
          userRole = (existing.rows[0] as any).role as string;
          await dbQuery('UPDATE users SET last_login_at = NOW() WHERE id = $1', [userId]);
        } else {
          userId = randomUUID();
          const username = `fb_${fbId.slice(0, 8)}`;
          await dbQuery(
            `INSERT INTO users (id, name, username, email, password_hash, role, status, created_at, last_login_at)
             VALUES ($1, $2, $3, $4, $5, 'user', 'active', NOW(), NOW())`,
            [userId, name, username, email, await bcrypt.hash(randomBytes(16).toString('hex'), 12)],
          );
        }
      } else {
        userId = randomUUID();
      }

      const token = jwt.sign({ userId, email, role: userRole }, jwtSecret, { expiresIn: jwtExpiresIn });
      return res.json({ success: true, token, user: { id: userId, email, name, role: userRole } });
    } catch (error) {
      logger.error('Facebook token auth error:', error);
      return res.status(401).json({ success: false, error: 'Facebook authentication failed' });
    }
  });

  // GET /api/admin/auth-providers — admin: returns all providers with full config
  router.get('/api/admin/auth-providers', async (req: Request, res: Response) => {
    try {
      const admin = await requireAdmin(req, res);
      if (!admin) return;
      if (hasDatabase()) {
        const result = await dbQuery('SELECT provider, config, enabled, updated_at FROM auth_providers ORDER BY provider');
        return res.json({ success: true, providers: result.rows });
      }
      return res.json({ success: true, providers: [] });
    } catch (error) {
      logger.error('Get admin auth providers error:', error);
      return res.status(500).json({ success: false, error: 'Failed to fetch auth providers' });
    }
  });

  // PUT /api/admin/auth-providers/:provider — save/update provider config + enabled toggle
  router.put('/api/admin/auth-providers/:provider', async (req: Request, res: Response) => {
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
      logger.error('Save auth provider error:', error);
      return res.status(500).json({ success: false, error: 'Failed to save auth provider' });
    }
  });

  return router;
}
