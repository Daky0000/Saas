import axios from 'axios';
import type { Request, Response } from 'express';
import { Router } from 'express';
import type { Pool } from 'pg';
import { Resend } from 'resend';
import { logger } from '../logger.ts';

// ─── Local helpers ─────────────────────────────────────────────────────────────

function normalizePlatformId(value: string): string {
  const raw = String(value || '').trim().toLowerCase();
  if (!raw) return '';
  if (raw === 'twitter / x' || raw === 'twitter/x' || raw === 'x') return 'twitter';
  if (raw === 'twitter') return 'twitter';
  if (['linkedin', 'facebook', 'instagram', 'pinterest', 'tiktok', 'threads', 'mailchimp', 'wordpress'].includes(raw)) return raw;
  return raw;
}

// ─── Deps ─────────────────────────────────────────────────────────────────────

export interface PlatformConfigDeps {
  requireAuth: (req: Request, res: Response) => { userId: string; role: string; tokenVersion: number | null } | null;
  requireAdmin: (req: Request, res: Response) => Promise<any>;
  hasDatabase: () => boolean;
  dbQuery: <T = any>(sql: string, params?: any[]) => Promise<{ rows: T[]; rowCount?: number | null }>;
  pool: Pool | null;
  inMemoryPlatformConfigs: Map<string, any>;
  getPlatformConfig: (platform: string) => Promise<Record<string, string>>;
  getIntegrationRowBySlug: (slug: string) => Promise<{ id: number; slug: string; name: string | null; type: string | null } | null>;
  getResendConfig: () => Promise<{ apiKey: string; fromEmail: string; fromName: string }>;
  refreshStripe: () => Promise<void>;
  oauthAuthUrls: Record<string, { authUrl: string; scopes: string; idField: 'appId' | 'clientId' | 'clientKey' }>;
  resolveOAuthRedirectUri: (platform: string, redirectUri?: string, req?: Request) => string;
  isOAuthClientSecretRequired: (platform: string) => boolean;
}

// ─── Router ───────────────────────────────────────────────────────────────────

export function registerPlatformConfigRoutes(deps: PlatformConfigDeps): Router {
  const {
    requireAuth, requireAdmin, hasDatabase, dbQuery, pool,
    inMemoryPlatformConfigs, getPlatformConfig, getIntegrationRowBySlug,
    getResendConfig, refreshStripe,
    oauthAuthUrls, resolveOAuthRedirectUri, isOAuthClientSecretRequired,
  } = deps;

  const router = Router();

  // ── Platform Configs ─────────────────────────────────────────────────────────

  router.get('/admin/platform-configs', async (req: Request, res: Response) => {
    try {
      const admin = await requireAdmin(req, res);
      if (!admin) return;

      const mask = (v: string | undefined) => (v && v.length > 4 ? '••••' + v.slice(-4) : v ? '••••' : '');
      const SECRET_FIELDS = ['appSecret', 'clientSecret', 'apiKey', 'accessToken', 'signingSecret', 'applicationPassword'];
      const maskConfig = (cfg: Record<string, string>) => {
        const out: Record<string, string> = {};
        for (const [k, v] of Object.entries(cfg)) out[k] = SECRET_FIELDS.includes(k) ? mask(v) : v;
        return out;
      };

      if (hasDatabase()) {
        const result = await dbQuery('SELECT platform, config, enabled, updated_at FROM platform_configs ORDER BY platform');
        return res.json({ success: true, configs: result.rows.map((r: any) => ({ ...r, config: maskConfig(r.config) })) });
      }
      return res.json({
        success: true,
        configs: Array.from(inMemoryPlatformConfigs.values()).map((r) => ({ ...r, config: maskConfig(r.config) })),
      });
    } catch (error) {
      logger.error('Get platform configs error:', error);
      return res.status(500).json({ success: false, error: 'Failed to fetch platform configs' });
    }
  });

  router.get('/admin/platform-configs/:platform', async (req: Request, res: Response) => {
    try {
      const admin = await requireAdmin(req, res);
      if (!admin) return;
      const { platform } = req.params;
      if (hasDatabase()) {
        const result = await dbQuery('SELECT platform, config, enabled, updated_at FROM platform_configs WHERE platform = $1', [platform]);
        if (result.rows.length === 0) return res.json({ success: true, config: null });
        return res.json({ success: true, config: result.rows[0] });
      }
      return res.json({ success: true, config: inMemoryPlatformConfigs.get(platform) ?? null });
    } catch (error) {
      logger.error('Get platform config error:', error);
      return res.status(500).json({ success: false, error: 'Failed to fetch platform config' });
    }
  });

  router.put('/admin/platform-configs/:platform', async (req: Request, res: Response) => {
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
      const meta = oauthAuthUrls[platform];
      if (meta) {
        const incomingRedirect = typeof normalizedConfig.redirectUri === 'string' ? normalizedConfig.redirectUri : '';
        normalizedConfig.redirectUri = resolveOAuthRedirectUri(platform, incomingRedirect, req);
      }

      let finalEnabled = Boolean(enabled);
      if (meta) {
        const clientId = String((normalizedConfig as any)[meta.idField] || '').trim();
        const redirectUri = String((normalizedConfig as any).redirectUri || '').trim();
        const secretRequired = isOAuthClientSecretRequired(platform);
        const secretValue = String((normalizedConfig as any).clientSecret || (normalizedConfig as any).appSecret || '').trim();
        if (Boolean(clientId && redirectUri && (!secretRequired || secretValue))) finalEnabled = true;
      }

      if (hasDatabase()) {
        const updateRes = await dbQuery(
          `UPDATE platform_configs SET config = $2, enabled = $3, updated_at = NOW() WHERE platform = $1`,
          [platform, JSON.stringify(normalizedConfig), finalEnabled]
        );
        if (updateRes.rowCount === 0) {
          await dbQuery(
            `INSERT INTO platform_configs (platform, config, enabled, updated_at) VALUES ($1, $2, $3, NOW())`,
            [platform, JSON.stringify(normalizedConfig), finalEnabled]
          );
        }
      } else {
        inMemoryPlatformConfigs.set(platform, { platform, config: normalizedConfig, enabled: finalEnabled, updated_at: now });
      }

      if (platform === 'stripe') void refreshStripe();
      return res.json({ success: true, message: 'Platform config saved' });
    } catch (error) {
      logger.error('Save platform config error:', error);
      return res.status(500).json({ success: false, error: 'Failed to save platform config' });
    }
  });

  router.post('/admin/platform-configs/resend/test', async (req: Request, res: Response) => {
    try {
      const admin = await requireAdmin(req, res);
      if (!admin) return;
      const saved = await getResendConfig();
      const resendKey = String(req.body.apiKey || saved.apiKey || '').trim();
      const fromEmail = String(req.body.fromEmail || saved.fromEmail || '').trim();
      const fromName = String(req.body.fromName || saved.fromName || '').trim();
      if (!resendKey) return res.status(400).json({ success: false, error: 'No Resend API key configured — save your key first' });
      if (!fromEmail) return res.status(400).json({ success: false, error: 'From Email is required — enter it in the form above' });
      const toEmail = String(req.body.to || '').trim();
      if (!toEmail) return res.status(400).json({ success: false, error: 'Recipient email required' });
      const resend = new Resend(resendKey);
      const fromField = fromName ? `${fromName} <${fromEmail}>` : fromEmail;
      await resend.emails.send({
        from: fromField, to: toEmail,
        subject: 'Resend configuration test ✓',
        html: `<p>Your Resend integration is working correctly.</p><p>From: <strong>${fromField}</strong></p>`,
      });
      return res.json({ success: true, message: `Test email sent to ${toEmail}` });
    } catch (err: any) {
      return res.status(400).json({ success: false, error: err.message || 'Failed to send test email' });
    }
  });

  router.get('/admin/audit-logs', async (req: Request, res: Response) => {
    try {
      const admin = await requireAdmin(req, res);
      if (!admin) return;
      const limit = Math.min(Number(req.query.limit ?? 200), 500);
      const offset = Number(req.query.offset ?? 0);
      const type = String(req.query.type ?? '').trim();
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

  // ── OAuth / Integrations ─────────────────────────────────────────────────────

  router.get('/oauth/:platform/configured', async (req: Request, res: Response) => {
    try {
      const platform = req.params.platform.toLowerCase();
      const meta = oauthAuthUrls[platform];
      if (!meta) return res.json({ success: true, configured: false });
      const cfg = await getPlatformConfig(platform);
      const clientId = cfg[meta.idField];
      const secretRequired = isOAuthClientSecretRequired(platform);
      const secretValue = platform === 'instagram' || platform === 'facebook' || platform === 'threads' ? cfg.appSecret : cfg.clientSecret;
      const redirectUri = resolveOAuthRedirectUri(platform, cfg.redirectUri, req);
      return res.json({ success: true, configured: Boolean(clientId && redirectUri && (!secretRequired || secretValue)) });
    } catch (e) {
      logger.warn({ e }, 'integration_config_check_failed');
      return res.json({ success: true, configured: false });
    }
  });

  router.post('/integrations/validate', async (req: Request, res: Response) => {
    try {
      const auth = requireAuth(req, res);
      if (!auth) return;
      const { platform, credentials } = req.body as { platform: string; credentials: Record<string, string> };
      switch (platform) {
        case 'wordpress': {
          const { siteUrl, username, applicationPassword } = credentials;
          const base = siteUrl.replace(/\/$/, '');
          const resp = await axios.get(`${base}/wp-json/wp/v2/users/me`, {
            auth: { username, password: applicationPassword }, validateStatus: () => true, timeout: 8000,
          });
          if (resp.status === 200) return res.json({ success: true, handle: resp.data?.name || username });
          if (resp.status === 401) throw new Error('Invalid WordPress credentials');
          throw new Error(`WordPress site returned ${resp.status}`);
        }
        case 'mailchimp': {
          const { apiKey, serverPrefix } = credentials;
          const resp = await axios.get(`https://${serverPrefix}.api.mailchimp.com/3.0/`, {
            auth: { username: 'anystring', password: apiKey }, validateStatus: () => true, timeout: 8000,
          });
          if (resp.status === 200) return res.json({ success: true });
          throw new Error('Invalid Mailchimp API key or server prefix');
        }
        case 'chatgpt': {
          const { apiKey } = credentials;
          const resp = await axios.get('https://api.openai.com/v1/models', {
            headers: { Authorization: `Bearer ${apiKey}` }, validateStatus: () => true, timeout: 8000,
          });
          if (resp.status === 200) return res.json({ success: true });
          throw new Error('Invalid OpenAI API key');
        }
        case 'webflow': {
          const { apiToken } = credentials;
          const resp = await axios.get('https://api.webflow.com/v2/sites', {
            headers: { Authorization: `Bearer ${apiToken}` }, validateStatus: () => true, timeout: 8000,
          });
          if (resp.status === 200) return res.json({ success: true });
          throw new Error('Invalid Webflow API token');
        }
        case 'stripe': {
          const { secretKey } = credentials;
          const resp = await axios.get('https://api.stripe.com/v1/account', {
            headers: { Authorization: `Bearer ${secretKey}` }, validateStatus: () => true, timeout: 8000,
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
            validateStatus: () => true, timeout: 8000,
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
            headers: { Authorization: `Bearer ${apiToken}` }, validateStatus: () => true, timeout: 8000,
          });
          if (resp.status === 200) return res.json({ success: true, handle: resp.data?.data?.username || resp.data?.data?.email || 'Apify' });
          if (resp.status === 401 || resp.status === 403) throw new Error('Invalid Apify API token');
          throw new Error(`Apify returned ${resp.status}`);
        }
        default:
          return res.json({ success: true });
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Validation failed';
      return res.status(400).json({ success: false, error: message });
    }
  });

  router.get('/integrations/enabled', async (req: Request, res: Response) => {
    try {
      const auth = requireAuth(req, res);
      if (!auth) return;
      if (!hasDatabase()) {
        return res.json({
          success: true,
          enabled: Array.from(inMemoryPlatformConfigs.values())
            .filter((r) => r.enabled)
            .map((r) => String(r.platform || '').toLowerCase())
            .filter(Boolean),
        });
      }
      const platformResult = await dbQuery(`SELECT platform FROM platform_configs WHERE enabled = true`);
      const providerResult = await dbQuery(`SELECT provider FROM auth_providers WHERE enabled = true`);
      const enabled = Array.from(new Set<string>([
        ...platformResult.rows.map((r: any) => String(r.platform || '').toLowerCase()).filter(Boolean),
        ...providerResult.rows.map((r: any) => String(r.provider || '').toLowerCase()).filter(Boolean),
      ]));
      return res.json({ success: true, enabled });
    } catch (error) {
      logger.error('Get enabled integrations error:', error);
      return res.status(500).json({ success: false, error: 'Failed to fetch enabled integrations' });
    }
  });

  router.get('/integrations/catalog', async (req: Request, res: Response) => {
    try {
      const auth = requireAuth(req, res);
      if (!auth) return;

      const SUPPORTED_SLUGS = ['wordpress', 'facebook', 'instagram', 'linkedin', 'twitter', 'pinterest', 'mailchimp', 'tiktok', 'threads'] as const;
      const integrations: Array<{
        slug: string; name: string; type: 'cms' | 'social' | 'marketing' | 'other';
        adminEnabled: boolean; configured: boolean; connected: boolean; connection: Record<string, any> | null;
      }> = [];

      if (!pool) {
        for (const slug of SUPPORTED_SLUGS) {
          const configRow = inMemoryPlatformConfigs.get(slug);
          const item = {
            slug,
            name: slug === 'twitter' ? 'X (Twitter)' : slug === 'wordpress' ? 'WordPress' : slug[0].toUpperCase() + slug.slice(1),
            type: (slug === 'wordpress' ? 'cms' : slug === 'mailchimp' ? 'marketing' : 'social') as 'cms' | 'social' | 'marketing' | 'other',
            adminEnabled: configRow ? Boolean(configRow.enabled) : false,
            configured: slug === 'wordpress' || slug === 'mailchimp' ? true : Boolean(configRow?.config && Object.keys(configRow.config || {}).length > 0),
            connected: false, connection: null,
          };
          if (item.adminEnabled && item.configured) integrations.push(item);
        }
        return res.json({ success: true, integrations });
      }

      const configRows = await pool.query('SELECT platform, config, enabled FROM platform_configs');
      const cfgMap = new Map<string, { config: Record<string, any>; enabled: boolean }>();
      for (const r of configRows.rows as any[]) {
        cfgMap.set(String(r.platform || '').toLowerCase(), { config: r.config || {}, enabled: Boolean(r.enabled) });
      }
      const facebookPlatformConfig = cfgMap.get('facebook')?.config || {};

      const wpConnRows = await pool.query('SELECT site_url, username, created_at FROM wordpress_connections WHERE user_id=$1 LIMIT 1', [auth.userId]);
      const wpConn = wpConnRows.rows[0] || null;

      const socialRows = await pool.query(
        `SELECT platform, account_type, account_id, account_name, handle, connected, created_at
         FROM social_accounts WHERE user_id=$1 AND connected=true`,
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
        return { accountType: match.account_type || 'profile', accountId: match.account_id || null, accountName: match.account_name || null, username: match.handle || null, connectedAt: match.created_at || null };
      };

      for (const slug of SUPPORTED_SLUGS) {
        const registry = await getIntegrationRowBySlug(slug);
        const name = registry?.name || (slug === 'twitter' ? 'X (Twitter)' : slug === 'wordpress' ? 'WordPress' : slug[0].toUpperCase() + slug.slice(1));
        const type = (registry?.type as any) || (slug === 'wordpress' ? 'cms' : 'social');
        const cfg = cfgMap.get(slug)?.config || {};
        const adminEnabled = cfgMap.has(slug) ? Boolean(cfgMap.get(slug)?.enabled) : slug === 'wordpress' || slug === 'mailchimp';

        let configured = false;
        if (slug === 'wordpress' || slug === 'mailchimp') {
          configured = true;
        } else if (slug === 'instagram') {
          const metaConfig = Object.keys(cfg || {}).length > 0 ? cfg : facebookPlatformConfig;
          const clientId = String((metaConfig as any).appId || '').trim();
          const redirectUri = resolveOAuthRedirectUri('facebook', String((facebookPlatformConfig as any).redirectUri || (metaConfig as any).redirectUri || ''), req);
          const secretValue = String((metaConfig as any).appSecret || (facebookPlatformConfig as any).appSecret || '').trim();
          configured = Boolean(clientId && redirectUri && secretValue);
        } else {
          const meta = oauthAuthUrls[slug];
          if (meta) {
            const clientId = String((cfg as any)[meta.idField] || '').trim();
            const redirectUri = resolveOAuthRedirectUri(slug, String((cfg as any).redirectUri || ''), req);
            const secretRequired = isOAuthClientSecretRequired(slug);
            const secretValue = String((cfg as any).clientSecret || (cfg as any).appSecret || '').trim();
            configured = Boolean(clientId && redirectUri && (!secretRequired || secretValue));
          }
        }

        const connected = slug === 'wordpress' ? Boolean(wpConn)
          : slug === 'mailchimp' ? String(userIntegrationMap.get('mailchimp')?.status || '').toLowerCase() === 'connected'
          : slug === 'instagram' ? Boolean(getPrimaryAccount('instagram'))
          : hasPlatformProfile(slug);

        const connection = slug === 'wordpress'
          ? (wpConn ? { siteUrl: wpConn.site_url, username: wpConn.username, connectedAt: wpConn.created_at } : null)
          : slug === 'mailchimp'
            ? (userIntegrationMap.get('mailchimp')
              ? { accountId: userIntegrationMap.get('mailchimp')?.account_id ?? null, accountName: userIntegrationMap.get('mailchimp')?.account_name ?? null, connectedAt: userIntegrationMap.get('mailchimp')?.created_at ?? null }
              : null)
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

  return router;
}
