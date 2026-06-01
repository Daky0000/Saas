import express from 'express';
import type { Router, Request, Response } from 'express';
import axios from 'axios';
import { randomBytes, randomUUID } from 'crypto';
import type { Pool } from 'pg';
import { logger } from '../logger.ts';

const GOOGLE_AUTH_URL = 'https://accounts.google.com/o/oauth2/v2/auth';
const GOOGLE_TOKEN_URL = 'https://oauth2.googleapis.com/token';
const GOOGLE_CALENDAR_API = 'https://www.googleapis.com/calendar/v3';
const CALENDAR_SCOPE = 'https://www.googleapis.com/auth/calendar.events https://www.googleapis.com/auth/calendar.readonly';

// In-memory state store keyed by random state param
const calendarStateStore = new Map<string, { userId: string; redirectUri: string; expiry: number }>();

// Prune expired states every 10 minutes
setInterval(() => {
  const now = Date.now();
  for (const [key, val] of calendarStateStore) {
    if (val.expiry < now) calendarStateStore.delete(key);
  }
}, 600_000);

interface CalendarDeps {
  requireAuth: (req: Request, res: Response) => { userId: string } | null;
  pool: Pool;
  getPlatformConfig: (platform: string) => Promise<Record<string, string>>;
  encryptIntegrationSecret: (plain: string) => string;
  decryptIntegrationSecret: (enc: string) => string;
  frontendUrl: string;
}

export function registerCalendarRoutes(deps: CalendarDeps): Router {
  const router = express.Router();
  const { requireAuth, pool, getPlatformConfig, encryptIntegrationSecret, decryptIntegrationSecret, frontendUrl } = deps;
  const FRONTEND = frontendUrl.replace(/\/$/, '');

  async function getCalendarCredentials(): Promise<Record<string, string>> {
    const calCfg = await getPlatformConfig('google_calendar').catch(() => ({}));
    if (calCfg.clientId && calCfg.clientSecret) return calCfg;
    // Fallback to Gmail credentials (same Google app, different scope)
    return getPlatformConfig('gmail').catch(() => ({}));
  }

  async function getValidToken(userId: string): Promise<string | null> {
    const { rows } = await pool.query(
      `SELECT access_token_encrypted, refresh_token_encrypted, token_expires_at
       FROM social_accounts WHERE user_id=$1 AND platform='google_calendar' AND connected=true LIMIT 1`,
      [userId]
    );
    if (!rows.length) return null;
    const row = rows[0] as any;

    const decrypt = (enc: string | null) => {
      try { return enc ? decryptIntegrationSecret(enc) : null; } catch { return null; }
    };
    const accessToken = decrypt(row.access_token_encrypted);
    const refreshToken = decrypt(row.refresh_token_encrypted);
    const expiresAt = row.token_expires_at ? new Date(row.token_expires_at) : null;

    if (!accessToken) return null;

    // Refresh if expiring within 5 minutes
    const needsRefresh = !expiresAt || expiresAt.getTime() < Date.now() + 5 * 60 * 1000;
    if (!needsRefresh || !refreshToken) return accessToken;

    try {
      const cfg = await getCalendarCredentials();
      const resp = await axios.post(
        GOOGLE_TOKEN_URL,
        new URLSearchParams({ grant_type: 'refresh_token', refresh_token: refreshToken, client_id: cfg.clientId, client_secret: cfg.clientSecret }).toString(),
        { headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, validateStatus: () => true }
      );
      if (resp.status < 400 && resp.data?.access_token) {
        const newToken = String(resp.data.access_token);
        const ttl = Number(resp.data.expires_in || 3600);
        await pool.query(
          `UPDATE social_accounts SET access_token_encrypted=$1, token_expires_at=$2 WHERE user_id=$3 AND platform='google_calendar'`,
          [encryptIntegrationSecret(newToken), new Date(Date.now() + ttl * 1000).toISOString(), userId]
        );
        return newToken;
      }
    } catch (e) { logger.error('[calendarRoutes] token refresh error:', e); }
    return accessToken;
  }

  // ── GET /api/calendar/google/status ──────────────────────────────────────────
  router.get('/google/status', async (req: Request, res: Response) => {
    const auth = requireAuth(req, res); if (!auth) return;
    const { rows } = await pool.query(
      `SELECT id FROM social_accounts WHERE user_id=$1 AND platform='google_calendar' AND connected=true LIMIT 1`,
      [auth.userId]
    );
    res.json({ connected: rows.length > 0 });
  });

  // ── POST /api/calendar/google/connect-url ─────────────────────────────────────
  router.post('/google/connect-url', async (req: Request, res: Response) => {
    const auth = requireAuth(req, res); if (!auth) return;
    try {
      const cfg = await getCalendarCredentials();
      if (!cfg.clientId || !cfg.clientSecret) {
        return void res.status(400).json({ error: 'Google Calendar not configured. Ask your admin to set up Google OAuth credentials.' });
      }

      const state = randomBytes(16).toString('hex');
      const apiOrigin = `${req.protocol}://${req.get('host')}`;
      const redirectUri = cfg.calendarRedirectUri || `${apiOrigin}/api/calendar/google/callback`;

      calendarStateStore.set(state, { userId: auth.userId, redirectUri, expiry: Date.now() + 600_000 });

      const params = new URLSearchParams({
        client_id: cfg.clientId,
        redirect_uri: redirectUri,
        response_type: 'code',
        scope: CALENDAR_SCOPE,
        state,
        access_type: 'offline',
        prompt: 'consent',
      });

      res.json({ url: `${GOOGLE_AUTH_URL}?${params.toString()}` });
    } catch (e: any) {
      res.status(500).json({ error: e.message || 'Failed to generate auth URL' });
    }
  });

  // ── GET /api/calendar/google/callback ─────────────────────────────────────────
  router.get('/google/callback', async (req: Request, res: Response) => {
    try {
      const { code, state, error: oauthError } = req.query as Record<string, string>;
      if (oauthError) return void res.redirect(`${FRONTEND}/?calendar_error=${encodeURIComponent(oauthError)}`);
      if (!code || !state) return void res.redirect(`${FRONTEND}/?calendar_error=missing_params`);

      const stateData = calendarStateStore.get(state);
      if (!stateData || stateData.expiry < Date.now()) {
        calendarStateStore.delete(state);
        return void res.redirect(`${FRONTEND}/?calendar_error=invalid_state`);
      }
      calendarStateStore.delete(state);

      const cfg = await getCalendarCredentials();
      const tokenResp = await axios.post(
        GOOGLE_TOKEN_URL,
        new URLSearchParams({
          grant_type: 'authorization_code',
          code,
          redirect_uri: stateData.redirectUri,
          client_id: cfg.clientId,
          client_secret: cfg.clientSecret,
        }).toString(),
        { headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, validateStatus: () => true }
      );

      if (tokenResp.status >= 400) {
        logger.error('[calendarRoutes] token exchange failed:', tokenResp.data);
        return void res.redirect(`${FRONTEND}/?calendar_error=token_exchange_failed`);
      }

      const { access_token, refresh_token, expires_in } = tokenResp.data as any;
      if (!access_token) return void res.redirect(`${FRONTEND}/?calendar_error=no_token`);

      const ttl = Number(expires_in || 3600);
      const expiry = new Date(Date.now() + ttl * 1000).toISOString();

      const { rows: existing } = await pool.query(
        `SELECT id FROM social_accounts WHERE user_id=$1 AND platform='google_calendar' LIMIT 1`,
        [stateData.userId]
      );

      if (existing.length > 0) {
        const sets: string[] = ['access_token_encrypted=$1', 'token_expires_at=$2', 'connected=true', 'updated_at=NOW()'];
        const params: unknown[] = [encryptIntegrationSecret(access_token), expiry];
        if (refresh_token) { params.push(encryptIntegrationSecret(refresh_token)); sets.push(`refresh_token_encrypted=$${params.length}`); }
        params.push(stateData.userId);
        await pool.query(
          `UPDATE social_accounts SET ${sets.join(', ')} WHERE user_id=$${params.length} AND platform='google_calendar'`,
          params
        );
      } else {
        await pool.query(
          `INSERT INTO social_accounts (id, user_id, platform, account_type, access_token_encrypted, refresh_token_encrypted, token_expires_at, connected)
           VALUES ($1, $2, 'google_calendar', 'profile', $3, $4, $5, true)`,
          [randomUUID(), stateData.userId, encryptIntegrationSecret(access_token), refresh_token ? encryptIntegrationSecret(refresh_token) : null, expiry]
        );
      }

      res.redirect(`${FRONTEND}/?calendar_connected=1`);
    } catch (e: any) {
      logger.error('[calendarRoutes] callback error:', e);
      res.redirect(`${FRONTEND}/?calendar_error=server_error`);
    }
  });

  // ── DELETE /api/calendar/google/disconnect ────────────────────────────────────
  router.delete('/google/disconnect', async (req: Request, res: Response) => {
    const auth = requireAuth(req, res); if (!auth) return;
    await pool.query(`UPDATE social_accounts SET connected=false WHERE user_id=$1 AND platform='google_calendar'`, [auth.userId]);
    res.json({ ok: true });
  });

  // ── GET /api/calendar/events?start=ISO&end=ISO ────────────────────────────────
  router.get('/events', async (req: Request, res: Response) => {
    const auth = requireAuth(req, res); if (!auth) return;
    const token = await getValidToken(auth.userId);
    if (!token) return void res.status(401).json({ error: 'Google Calendar not connected', notConnected: true });

    const { start, end } = req.query as { start?: string; end?: string };
    const now = new Date();
    const timeMin = start || new Date(now.getFullYear(), now.getMonth(), 1).toISOString();
    const timeMax = end || new Date(now.getFullYear(), now.getMonth() + 2, 0).toISOString();

    try {
      const resp = await axios.get(`${GOOGLE_CALENDAR_API}/calendars/primary/events`, {
        headers: { Authorization: `Bearer ${token}` },
        params: { timeMin, timeMax, singleEvents: true, orderBy: 'startTime', maxResults: 200 },
        validateStatus: () => true,
      });
      if (resp.status === 401) return void res.status(401).json({ error: 'Token expired', notConnected: true });
      if (resp.status >= 400) return void res.status(500).json({ error: 'Google Calendar API error' });
      res.json({ events: (resp.data as any).items ?? [] });
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  // ── POST /api/calendar/events — create Google Calendar event ──────────────────
  router.post('/events', async (req: Request, res: Response) => {
    const auth = requireAuth(req, res); if (!auth) return;
    const token = await getValidToken(auth.userId);
    if (!token) return void res.status(401).json({ error: 'Google Calendar not connected', notConnected: true });

    const { summary, description, start, end, attendees, recurrence, reminders } = req.body;
    if (!summary?.trim()) return void res.status(400).json({ error: 'summary required' });
    if (!start?.dateTime) return void res.status(400).json({ error: 'start.dateTime required' });

    const eventBody: Record<string, any> = {
      summary: summary.trim(),
      description: description || '',
      start: { dateTime: start.dateTime, timeZone: start.timeZone || 'UTC' },
      end: { dateTime: end?.dateTime || start.dateTime, timeZone: end?.timeZone || 'UTC' },
    };

    if (Array.isArray(attendees) && attendees.length > 0) {
      eventBody.attendees = attendees.map((a: any) => ({ email: a.email, displayName: a.name || a.email }));
    }

    if (Array.isArray(recurrence) && recurrence.length > 0) {
      eventBody.recurrence = recurrence;
    }

    if (reminders) {
      eventBody.reminders = reminders;
    }

    try {
      const resp = await axios.post(`${GOOGLE_CALENDAR_API}/calendars/primary/events`, eventBody, {
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        validateStatus: () => true,
      });
      if (resp.status === 401) return void res.status(401).json({ error: 'Token expired', notConnected: true });
      if (resp.status >= 400) {
        logger.error('[calendarRoutes] create event failed:', resp.data);
        return void res.status(resp.status).json({ error: 'Failed to create Google Calendar event', details: resp.data });
      }
      res.status(201).json({ event: resp.data });
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  // ── DELETE /api/calendar/events/:id ──────────────────────────────────────────
  router.delete('/events/:id', async (req: Request, res: Response) => {
    const auth = requireAuth(req, res); if (!auth) return;
    const token = await getValidToken(auth.userId);
    if (!token) return void res.status(401).json({ error: 'Not connected', notConnected: true });

    await axios.delete(`${GOOGLE_CALENDAR_API}/calendars/primary/events/${req.params.id}`, {
      headers: { Authorization: `Bearer ${token}` },
      validateStatus: () => true,
    });
    res.json({ ok: true });
  });

  return router;
}
