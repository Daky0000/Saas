import { FormEvent, useCallback, useEffect, useMemo, useState } from 'react';
import { CheckCircle, ExternalLink, Loader2, Power, Send, SlidersHorizontal, TestTube2, X } from 'lucide-react';
import { API_BASE_URL } from '../../utils/apiBase';
import { PlatformLogo } from '../PlatformLogo';

type PlatformField = {
  id: string;
  label: string;
  placeholder: string;
  type: 'text' | 'password';
  helpText: string;
};

type PlatformDef = {
  id: string;
  name: string;
  description: string;
  fields: PlatformField[];
  docsUrl: string;
  redirectHint: string;
};

type PlatformRow = {
  platform: string;
  config: Record<string, any>;
  enabled: boolean;
};

const authHeaders = (): Record<string, string> => {
  if (typeof window === 'undefined') return {};
  const token = localStorage.getItem('auth_token');
  return token ? { Authorization: `Bearer ${token}` } : {};
};

const getBackendBase = () => {
  if (typeof window === 'undefined') return API_BASE_URL;
  return API_BASE_URL || window.location.origin;
};

const buildRedirectUri = (platformId: string) => `${getBackendBase()}/auth/${platformId}/callback`;

const PLATFORMS: PlatformDef[] = [
  {
    id: 'wordpress',
    name: 'WordPress',
    description: 'Enable or disable WordPress connections. Users connect with Application Passwords.',
    fields: [],
    docsUrl: 'https://developer.wordpress.org/rest-api/reference/',
    redirectHint: 'No OAuth redirect needed (Application Password).',
  },
  {
    id: 'facebook',
    name: 'Facebook (Meta)',
    description: 'OAuth credentials for Facebook Graph API — pages, publishing, and webhooks.',
    fields: [
      { id: 'appId', label: 'App ID', placeholder: 'Meta App ID', type: 'text', helpText: 'From Meta for Developers → App settings.' },
      { id: 'appSecret', label: 'App Secret', placeholder: 'Meta App Secret', type: 'password', helpText: 'Keep this secret. Used server-side for token exchange.' },
      { id: 'redirectUri', label: 'Redirect URL', placeholder: 'https://YOUR-BACKEND/auth/facebook/callback', type: 'text', helpText: 'Must match the Valid OAuth Redirect URI in Meta app settings.' },
    ],
    docsUrl: 'https://developers.facebook.com/',
    redirectHint: 'Use `/auth/facebook/callback` on the backend.',
  },
  {
    id: 'instagram',
    name: 'Instagram',
    description: 'OAuth credentials for Instagram Basic Display API — publishing and engagement metrics.',
    fields: [
      { id: 'appId', label: 'App ID', placeholder: 'Instagram / Meta App ID', type: 'text', helpText: 'From Meta for Developers. Can be the same app as Facebook.' },
      { id: 'appSecret', label: 'App Secret', placeholder: 'Instagram / Meta App Secret', type: 'password', helpText: 'Keep this secret. Used server-side for token exchange.' },
      { id: 'redirectUri', label: 'Redirect URL', placeholder: 'https://YOUR-BACKEND/auth/instagram/callback', type: 'text', helpText: 'Must match the Valid OAuth Redirect URI in your Meta app settings.' },
    ],
    docsUrl: 'https://developers.facebook.com/docs/instagram-platform/',
    redirectHint: 'Instagram uses the Meta app flow. Keep Facebook and Instagram permissions aligned for publishing and insights.',
  },
  {
    id: 'linkedin',
    name: 'LinkedIn',
    description: 'OAuth credentials for publishing UGC posts and analytics.',
    fields: [
      { id: 'clientId', label: 'Client ID', placeholder: 'LinkedIn Client ID', type: 'text', helpText: 'From LinkedIn Developer Portal.' },
      { id: 'clientSecret', label: 'Client Secret', placeholder: 'LinkedIn Client Secret', type: 'password', helpText: 'Keep this secret. Used server-side for token exchange.' },
      { id: 'redirectUri', label: 'Redirect URL', placeholder: 'https://YOUR-BACKEND/auth/linkedin/callback', type: 'text', helpText: 'Must match the Authorized redirect URLs in your LinkedIn app.' },
    ],
    docsUrl: 'https://learn.microsoft.com/en-us/linkedin/',
    redirectHint: 'Use `/auth/linkedin/callback` on the backend.',
  },
  {
    id: 'twitter',
    name: 'X (Twitter)',
    description: 'OAuth 2.0 + PKCE credentials for posting tweets via API v2.',
    fields: [
      { id: 'clientId', label: 'Client ID', placeholder: 'X OAuth Client ID', type: 'text', helpText: 'From developer.x.com project/app settings.' },
      { id: 'clientSecret', label: 'Client Secret', placeholder: 'X OAuth Client Secret (optional)', type: 'password', helpText: 'Some setups use PKCE without client secret; include if required by your app.' },
      { id: 'redirectUri', label: 'Redirect URL', placeholder: 'https://YOUR-BACKEND/auth/twitter/callback', type: 'text', helpText: 'Must match your app callback/redirect URL.' },
    ],
    docsUrl: 'https://developer.x.com/',
    redirectHint: 'Use `/auth/twitter/callback` on the backend.',
  },
  {
    id: 'pinterest',
    name: 'Pinterest',
    description: 'OAuth credentials for creating Pins and listing boards.',
    fields: [
      { id: 'clientId', label: 'App ID', placeholder: 'Pinterest App ID', type: 'text', helpText: 'From developers.pinterest.com app settings.' },
      { id: 'clientSecret', label: 'App Secret', placeholder: 'Pinterest App Secret', type: 'password', helpText: 'Keep this secret. Used server-side for token exchange.' },
      { id: 'redirectUri', label: 'Redirect URL', placeholder: 'https://YOUR-BACKEND/auth/pinterest/callback', type: 'text', helpText: 'Must match the redirect URI registered in your Pinterest app.' },
    ],
    docsUrl: 'https://developers.pinterest.com/docs/api/v5/',
    redirectHint: 'Use `/auth/pinterest/callback` on the backend.',
  },
  {
    id: 'tiktok',
    name: 'TikTok',
    description: 'OAuth credentials for publishing photo posts and video drafts via Content Posting API.',
    fields: [
      { id: 'clientKey', label: 'Client Key', placeholder: 'TikTok Client Key', type: 'text', helpText: 'From developers.tiktok.com → your app → App info. This is the "Client Key" (not Client ID).' },
      { id: 'clientSecret', label: 'Client Secret', placeholder: 'TikTok Client Secret', type: 'password', helpText: 'Keep this secret. From developers.tiktok.com → your app → App info.' },
      { id: 'redirectUri', label: 'Redirect URL', placeholder: 'https://YOUR-BACKEND/auth/tiktok/callback', type: 'text', helpText: 'Must match the redirect URI registered in your TikTok app settings.' },
    ],
    docsUrl: 'https://developers.tiktok.com/doc/login-kit-web/',
    redirectHint: 'Use `/auth/tiktok/callback` on the backend. Required scopes: user.info.basic, video.upload, video.publish.',
  },
  {
    id: 'threads',
    name: 'Threads',
    description: 'OAuth credentials for publishing posts to Threads and syncing insights (Meta Graph API).',
    fields: [
      { id: 'appId', label: 'App ID', placeholder: 'Meta / Threads App ID', type: 'text', helpText: 'From Meta for Developers. Same app can cover Facebook + Instagram + Threads.' },
      { id: 'appSecret', label: 'App Secret', placeholder: 'Meta / Threads App Secret', type: 'password', helpText: 'Keep this secret. Used server-side for token exchange.' },
      { id: 'redirectUri', label: 'Redirect URL', placeholder: 'https://YOUR-BACKEND/auth/threads/callback', type: 'text', helpText: 'Must match the redirect URI in your Meta app. Required scopes: threads_basic, threads_content_publish, threads_manage_insights.' },
    ],
    docsUrl: 'https://developers.facebook.com/docs/threads/',
    redirectHint: 'Use `/auth/threads/callback` on the backend.',
  },
  {
    id: 'mailchimp',
    name: 'Mailchimp',
    description: 'API key for connecting user Mailchimp accounts to sync contacts and campaigns.',
    fields: [],
    docsUrl: 'https://mailchimp.com/developer/',
    redirectHint: 'No OAuth needed — users connect with their own Mailchimp API key in the Integrations page.',
  },
  {
    id: 'gmail',
    name: 'Gmail',
    description: 'OAuth credentials for sending emails from users\' Gmail or Google Workspace address via the Gmail API.',
    fields: [
      { id: 'clientId', label: 'Client ID', placeholder: 'Google OAuth Client ID', type: 'text', helpText: 'From Google Cloud Console → APIs & Services → Credentials → OAuth 2.0 Client ID.' },
      { id: 'clientSecret', label: 'Client Secret', placeholder: 'Google OAuth Client Secret', type: 'password', helpText: 'Keep this secret. Used server-side for token exchange.' },
      { id: 'redirectUri', label: 'Redirect URL', placeholder: 'https://YOUR-BACKEND/auth/gmail/callback', type: 'text', helpText: 'Must match the Authorized redirect URI in your Google OAuth app. Enable Gmail API in Google Cloud Console.' },
    ],
    docsUrl: 'https://developers.google.com/gmail/api',
    redirectHint: 'Use `/auth/gmail/callback` on the backend. Enable Gmail API in Google Cloud Console before testing.',
  },
  {
    id: 'google_calendar',
    name: 'Google Calendar',
    description: 'OAuth credentials for syncing meetings to Google Calendar. Users connect their calendar to schedule meetings from the CRM.',
    fields: [
      { id: 'clientId', label: 'Client ID', placeholder: 'Google OAuth Client ID', type: 'text', helpText: 'Same Client ID as Gmail if using the same Google Cloud project. From Google Cloud Console → APIs & Services → Credentials.' },
      { id: 'clientSecret', label: 'Client Secret', placeholder: 'Google OAuth Client Secret', type: 'password', helpText: 'Same Client Secret as Gmail if using the same Google Cloud project. Keep this secret.' },
      { id: 'calendarRedirectUri', label: 'Redirect URL', placeholder: 'https://YOUR-BACKEND/api/calendar/google/callback', type: 'text', helpText: 'Must be added to Authorized redirect URIs in Google Cloud Console. Enable the Google Calendar API in your project.' },
    ],
    docsUrl: 'https://developers.google.com/calendar/api/guides/overview',
    redirectHint: 'Use `/api/calendar/google/callback` on the backend. Enable Google Calendar API in Google Cloud Console. You can reuse the same OAuth client as Gmail — just add this redirect URI.',
  },
  {
    id: 'slack',
    name: 'Slack',
    description: 'OAuth credentials for sending workflow notifications and agent alerts to Slack workspaces.',
    fields: [
      { id: 'clientId', label: 'Client ID', placeholder: 'Slack App Client ID', type: 'text', helpText: 'From api.slack.com → Your Apps → Basic Information.' },
      { id: 'clientSecret', label: 'Client Secret', placeholder: 'Slack App Client Secret', type: 'password', helpText: 'Keep this secret. Used server-side for token exchange.' },
      { id: 'redirectUri', label: 'Redirect URL', placeholder: 'https://YOUR-BACKEND/auth/slack/callback', type: 'text', helpText: 'Must match the redirect URL in your Slack app OAuth & Permissions settings.' },
    ],
    docsUrl: 'https://api.slack.com/authentication/oauth-v2',
    redirectHint: 'Use `/auth/slack/callback` on the backend. Required scopes: chat:write, channels:read.',
  },
  {
    id: 'whatsapp',
    name: 'WhatsApp Business',
    description: 'Enable WhatsApp Business Cloud API. Users connect with their own phone number ID and access token from Meta Developer Console.',
    fields: [],
    docsUrl: 'https://developers.facebook.com/docs/whatsapp/cloud-api/',
    redirectHint: 'No admin OAuth needed — users connect with their Meta phone number ID and system user access token directly in the Integrations page.',
  },
  {
    id: 'zoom',
    name: 'Zoom',
    description: 'OAuth credentials for creating and managing Zoom meetings from content workflows.',
    fields: [
      { id: 'clientId', label: 'Client ID', placeholder: 'Zoom App Client ID', type: 'text', helpText: 'From marketplace.zoom.us → Build App → App Credentials.' },
      { id: 'clientSecret', label: 'Client Secret', placeholder: 'Zoom App Client Secret', type: 'password', helpText: 'Keep this secret. Used server-side for token exchange.' },
      { id: 'redirectUri', label: 'Redirect URL', placeholder: 'https://YOUR-BACKEND/auth/zoom/callback', type: 'text', helpText: 'Must match the redirect URL in your Zoom app settings. Create a User-managed OAuth app in Zoom Marketplace.' },
    ],
    docsUrl: 'https://marketplace.zoom.us/develop/create',
    redirectHint: 'Use `/auth/zoom/callback` on the backend. Create a User-managed OAuth app in Zoom Marketplace.',
  },
  {
    id: 'hubtel',
    name: 'Hubtel (Payments)',
    description: 'Hubtel payment gateway credentials for processing GHS subscription payments.',
    fields: [
      { id: 'clientId', label: 'Client ID', placeholder: 'Hubtel Client ID', type: 'text', helpText: 'From Hubtel merchant dashboard → API credentials.' },
      { id: 'clientSecret', label: 'Client Secret', placeholder: 'Hubtel Client Secret', type: 'password', helpText: 'Keep this secret. Used server-side for payment initiation.' },
      { id: 'merchantAccountNumber', label: 'Merchant Account Number', placeholder: 'e.g. 2024XXX', type: 'text', helpText: 'Your Hubtel merchant account number from the dashboard.' },
    ],
    docsUrl: 'https://developers.hubtel.com/',
    redirectHint: 'Callback URL is handled automatically at `/api/payments/hubtel/callback`.',
  },
  {
    id: 'stripe',
    name: 'Stripe (Subscriptions)',
    description: 'Stripe credentials for SaaS subscription billing, checkout, and the customer portal.',
    fields: [
      { id: 'secretKey', label: 'Secret Key', placeholder: 'sk_live_... or sk_test_...', type: 'password', helpText: 'From Stripe Dashboard → Developers → API keys. Never expose this to the browser.' },
      { id: 'publishableKey', label: 'Publishable Key', placeholder: 'pk_live_... or pk_test_...', type: 'text', helpText: 'Safe to expose client-side. Used if you add Stripe.js elements in future.' },
      { id: 'webhookSecret', label: 'Webhook Secret', placeholder: 'whsec_...', type: 'password', helpText: 'From Stripe Dashboard → Developers → Webhooks → your endpoint → Signing secret. Required for subscription sync.' },
    ],
    docsUrl: 'https://stripe.com/docs/api',
    redirectHint: 'Webhook endpoint: POST /webhooks/stripe on your backend URL. Register it in Stripe Dashboard → Developers → Webhooks.',
  },
  {
    id: 'resend',
    name: 'Resend (Transactional Email)',
    description: 'API key and sender details for all outgoing emails — campaigns, automations, password resets, and notifications.',
    fields: [
      { id: 'apiKey', label: 'API Key', placeholder: 're_...', type: 'password', helpText: 'From resend.com → API Keys. Create a key with full access.' },
      { id: 'fromEmail', label: 'From Email', placeholder: 'noreply@yourdomain.com', type: 'text', helpText: 'Must be a verified domain or address in your Resend account.' },
      { id: 'fromName', label: 'From Name', placeholder: 'Your App Name', type: 'text', helpText: 'Display name shown to recipients in the From field.' },
    ],
    docsUrl: 'https://resend.com/docs',
    redirectHint: 'Verify your sending domain in the Resend dashboard before going live.',
  },
  {
    id: 'smtp',
    name: 'SMTP (Email Fallback)',
    description: 'SMTP server details as a fallback email provider if Resend is not configured.',
    fields: [
      { id: 'host', label: 'SMTP Host', placeholder: 'smtp.mailgun.org', type: 'text', helpText: 'Hostname of your SMTP server.' },
      { id: 'port', label: 'Port', placeholder: '587', type: 'text', helpText: 'Common ports: 587 (STARTTLS), 465 (SSL), 25 (unencrypted).' },
      { id: 'username', label: 'Username', placeholder: 'postmaster@yourdomain.com', type: 'text', helpText: 'SMTP authentication username.' },
      { id: 'password', label: 'Password', placeholder: '', type: 'password', helpText: 'SMTP authentication password. Keep this secret.' },
      { id: 'fromEmail', label: 'From Email', placeholder: 'noreply@yourdomain.com', type: 'text', helpText: 'Default sender address for outgoing mail.' },
    ],
    docsUrl: 'https://en.wikipedia.org/wiki/SMTP',
    redirectHint: 'SMTP is used only when no Resend API key is configured.',
  },
];

export default function AdminIntegrations() {
  const [loading, setLoading] = useState(true);
  const [rows, setRows] = useState<Record<string, PlatformRow>>({});
  const [activeId, setActiveId] = useState<string | null>(null);
  const [form, setForm] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  const [toggling, setToggling] = useState<string | null>(null);
  const [testing, setTesting] = useState<string | null>(null);

  const [saveError, setSaveError] = useState<string | null>(null);
  const [testMessage, setTestMessage] = useState<string | null>(null);

  const [resendTestTo, setResendTestTo] = useState('');
  const [resendTesting, setResendTesting] = useState(false);
  const [resendTestResult, setResendTestResult] = useState<{ ok: boolean; msg: string } | null>(null);

  const activeDef = useMemo(() => PLATFORMS.find((p) => p.id === activeId) ?? null, [activeId]);

  const loadAll = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(`${API_BASE_URL}/api/admin/platform-configs`, { headers: authHeaders() });
      const data = await res.json().catch(() => ({} as any));
      if (!res.ok) throw new Error(data.error || 'Failed to load configs');

      const next: Record<string, PlatformRow> = {};
      for (const r of data.configs || []) {
        next[String(r.platform || '').toLowerCase()] = {
          platform: String(r.platform || '').toLowerCase(),
          config: r.config || {},
          enabled: Boolean(r.enabled),
        };
      }
      setRows(next);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadAll();
  }, [loadAll]);

  const openConfigure = async (id: string) => {
    setActiveId(id);
    setSaveError(null);
    setTestMessage(null);
    setResendTestTo('');
    setResendTestResult(null);
    try {
      const def = PLATFORMS.find((p) => p.id === id) ?? null;
      const res = await fetch(`${API_BASE_URL}/api/admin/platform-configs/${encodeURIComponent(id)}`, { headers: authHeaders() });
      const data = await res.json().catch(() => ({} as any));
      if (!res.ok) throw new Error(data.error || 'Failed to load config');
      const cfg = data.config?.config || data.config || {};
      const row = rows[id] || { platform: id, config: {}, enabled: false };
      const merged = { ...row.config, ...cfg } as Record<string, unknown>;
      if (def?.fields.some((field) => field.id === 'redirectUri')) {
        const current = String(merged.redirectUri ?? '').trim();
        if (!current) {
          merged.redirectUri = buildRedirectUri(id);
        }
      }
      if (def?.fields.some((field) => field.id === 'calendarRedirectUri')) {
        const current = String(merged.calendarRedirectUri ?? '').trim();
        if (!current) {
          merged.calendarRedirectUri = `${getBackendBase()}/api/calendar/google/callback`;
        }
      }
      setForm(Object.fromEntries(Object.entries(merged).map(([k, v]) => [k, String(v ?? '')])));
    } catch (e) {
      setForm({});
      setSaveError(e instanceof Error ? e.message : 'Failed to load config');
    }
  };

  const save = async (e: FormEvent) => {
    e.preventDefault();
    if (!activeDef) return;
    setSaving(true);
    setSaveError(null);
    try {
      const enabled = rows[activeDef.id]?.enabled ?? false;
      const res = await fetch(`${API_BASE_URL}/api/admin/platform-configs/${encodeURIComponent(activeDef.id)}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', ...authHeaders() },
        body: JSON.stringify({ config: form, enabled }),
      });
      const data = await res.json().catch(() => ({} as any));
      if (!res.ok) throw new Error(data.error || 'Failed to save');
      await loadAll();
      setActiveId(null);
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : 'Save failed');
    } finally {
      setSaving(false);
    }
  };

  const toggle = async (id: string, nextEnabled: boolean) => {
    setToggling(id);
    try {
      const res = await fetch(`${API_BASE_URL}/api/admin/platform-configs/${encodeURIComponent(id)}/toggle`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', ...authHeaders() },
        body: JSON.stringify({ enabled: nextEnabled }),
      });
      const data = await res.json().catch(() => ({} as any));
      if (!res.ok) throw new Error(data.error || 'Failed to toggle');
      await loadAll();
    } catch (e) {
      alert(e instanceof Error ? e.message : 'Failed to toggle');
    } finally {
      setToggling(null);
    }
  };

  const test = async (id: string) => {
    setTesting(id);
    setTestMessage(null);
    try {
      const res = await fetch(`${API_BASE_URL}/api/admin/platform-configs/${encodeURIComponent(id)}/test`, { headers: authHeaders() });
      const data = await res.json().catch(() => ({} as any));
      if (!res.ok || data.success === false) throw new Error(data.error || 'Test failed');
      setTestMessage(data.message || 'Credentials look valid.');
    } catch (e) {
      setTestMessage(e instanceof Error ? e.message : 'Test failed');
    } finally {
      setTesting(null);
    }
  };

  const sendResendTest = async () => {
    if (!resendTestTo.trim()) return;
    setResendTesting(true);
    setResendTestResult(null);
    try {
      const res = await fetch(`${API_BASE_URL}/api/admin/platform-configs/resend/test`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...authHeaders() },
        body: JSON.stringify({
          to: resendTestTo.trim(),
          apiKey: form.apiKey || undefined,
          fromEmail: form.fromEmail || undefined,
          fromName: form.fromName || undefined,
        }),
      });
      const data = await res.json().catch(() => ({} as any));
      setResendTestResult({ ok: data.success === true, msg: data.message ?? data.error ?? 'Unknown response' });
    } catch {
      setResendTestResult({ ok: false, msg: 'Request failed' });
    } finally {
      setResendTesting(false);
    }
  };

  return (
    <div className="space-y-6">
      <div className="rounded-[24px] border border-slate-200 bg-white px-6 py-6">
        <h2 className="text-2xl font-black tracking-[-0.03em] text-slate-950">Integrations</h2>
        <p className="mt-1 text-sm text-slate-500">
          Configure developer credentials and enable integrations for users. Redirect URLs should point to the backend OAuth callback routes.
        </p>
      </div>

      {testMessage ? (
        <div className="rounded-2xl border border-emerald-200 bg-emerald-50 px-5 py-4 text-sm text-emerald-800">{testMessage}</div>
      ) : null}

      {loading ? (
        <div className="flex items-center justify-center py-16">
          <Loader2 size={28} className="animate-spin text-slate-400" />
        </div>
      ) : (
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {PLATFORMS.map((p) => {
            const row = rows[p.id] || { platform: p.id, config: {}, enabled: false };
            const isEnabled = Boolean(row.enabled);
            const isToggling = toggling === p.id;

            const isConfigured = p.fields.length === 0 ? true : p.fields.every((f) => String(row.config?.[f.id] || '').trim());

            return (
              <div
                key={p.id}
                className={`rounded-[20px] border bg-white p-5 transition-all ${isEnabled ? 'border-emerald-200 shadow-sm' : 'border-slate-200'}`}
              >
                <div className="flex items-start justify-between gap-3">
                  <PlatformLogo platform={p.id} size={44} />
                  <button
                    type="button"
                    onClick={() => void toggle(p.id, !isEnabled)}
                    disabled={isToggling || (!isConfigured && !isEnabled)}
                    title={!isConfigured && !isEnabled ? 'Configure credentials first' : isEnabled ? 'Disable for users' : 'Enable for users'}
                    className={`flex items-center gap-1.5 rounded-xl px-3 py-1.5 text-xs font-semibold transition-colors disabled:opacity-50 ${
                      isEnabled ? 'bg-emerald-50 text-emerald-700 hover:bg-emerald-100' : 'bg-slate-100 text-slate-500 hover:bg-slate-200'
                    }`}
                  >
                    {isToggling ? <Loader2 size={12} className="animate-spin" /> : <Power size={12} />}
                    {isEnabled ? 'Enabled' : 'Disabled'}
                  </button>
                </div>

                <div className="mt-3">
                  <h3 className="font-black text-slate-900">{p.name}</h3>
                  <p className="mt-1 text-xs leading-5 text-slate-500">{p.description}</p>
                </div>

                <div className="mt-4 space-y-2 rounded-2xl border border-slate-100 bg-slate-50 px-4 py-3">
                  <div className="text-[11px] font-bold uppercase tracking-[0.2em] text-slate-400">Setup</div>
                  <div className="text-xs text-slate-600">{p.redirectHint}</div>
                  <a
                    className="inline-flex items-center gap-1.5 text-xs font-semibold text-slate-700 hover:text-slate-900"
                    href={p.docsUrl}
                    target="_blank"
                    rel="noreferrer"
                  >
                    <ExternalLink size={12} />
                    Docs
                  </a>
                </div>

                <div className="mt-4 flex items-center justify-between">
                  <span className={`text-xs font-semibold ${isConfigured ? 'text-emerald-600' : 'text-amber-600'}`}>
                    {isConfigured ? 'Configured' : 'Not configured'}
                  </span>
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={() => void test(p.id)}
                      disabled={testing === p.id || (!isConfigured && p.fields.length > 0)}
                      className="inline-flex items-center gap-1.5 rounded-xl border border-slate-200 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-50"
                      title={!isConfigured && p.fields.length > 0 ? 'Configure credentials first' : 'Test credentials'}
                    >
                      {testing === p.id ? <Loader2 size={12} className="animate-spin" /> : <TestTube2 size={12} />}
                      Test
                    </button>
                    <button
                      type="button"
                      onClick={() => void openConfigure(p.id)}
                      className="inline-flex items-center gap-1.5 rounded-xl border border-slate-200 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-50"
                    >
                      <SlidersHorizontal size={12} />
                      Configure
                    </button>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {activeDef ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/40 px-4 py-10">
          <div className="w-full max-w-2xl rounded-[24px] bg-white shadow-2xl">
            <div className="flex items-center justify-between border-b border-slate-100 px-6 py-4">
              <div>
                <div className="text-xs font-semibold uppercase tracking-[0.2em] text-slate-400">Integration</div>
                <div className="text-lg font-black text-slate-950">{activeDef.name}</div>
              </div>
              <button
                type="button"
                onClick={() => setActiveId(null)}
                className="flex h-10 w-10 items-center justify-center rounded-xl border border-slate-200 bg-white text-slate-500 hover:bg-slate-50"
              >
                <X size={16} />
              </button>
            </div>

            <form onSubmit={save} className="px-6 py-5">
              {activeDef.fields.length === 0 ? (
                <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4 text-sm text-slate-600">
                  No credentials required for this integration.
                </div>
              ) : (
                <div className="grid gap-4 sm:grid-cols-2">
                  {activeDef.fields.map((f) => (
                    <div key={f.id} className={f.id === 'redirectUri' ? 'sm:col-span-2' : ''}>
                      <label className="text-xs font-semibold text-slate-600">{f.label}</label>
                      <input
                        type={f.type}
                        value={form[f.id] || ''}
                        onChange={(e) => setForm((prev) => ({ ...prev, [f.id]: e.target.value }))}
                        placeholder={f.placeholder}
                        className="mt-1 w-full rounded-xl border border-slate-200 bg-slate-50 px-4 py-2.5 text-sm outline-none focus:border-slate-400"
                      />
                      {f.id === 'redirectUri' ? (
                        <div className="mt-2 flex flex-wrap items-center gap-2">
                          <button
                            type="button"
                            onClick={() => setForm((prev) => ({ ...prev, [f.id]: buildRedirectUri(activeDef.id) }))}
                            className="rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-50"
                          >
                            Use default redirect
                          </button>
                          <button
                            type="button"
                            onClick={() => {
                              const value = buildRedirectUri(activeDef.id);
                              navigator.clipboard?.writeText(value);
                            }}
                            className="rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-50"
                          >
                            Copy default
                          </button>
                          <span className="text-[11px] text-slate-500">{buildRedirectUri(activeDef.id)}</span>
                        </div>
                      ) : null}
                      <div className="mt-1 text-[11px] leading-5 text-slate-500">{f.helpText}</div>
                    </div>
                  ))}
                </div>
              )}

              {saveError ? <div className="mt-4 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{saveError}</div> : null}

              {activeDef.id === 'resend' && (
                <div className="mt-5 border-t border-slate-100 pt-4 space-y-2">
                  <p className="text-xs font-semibold text-slate-500">Send a test email</p>
                  <div className="flex gap-2">
                    <input
                      type="email"
                      value={resendTestTo}
                      onChange={(e) => setResendTestTo(e.target.value)}
                      placeholder="your@email.com"
                      className="flex-1 rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-sm outline-none focus:border-slate-400"
                    />
                    <button
                      type="button"
                      onClick={() => void sendResendTest()}
                      disabled={resendTesting || !resendTestTo.trim()}
                      className="inline-flex items-center gap-1.5 rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-50"
                    >
                      {resendTesting ? <Loader2 size={13} className="animate-spin" /> : <Send size={13} />}
                      Test
                    </button>
                  </div>
                  {resendTestResult && (
                    <p className={`text-xs font-medium ${resendTestResult.ok ? 'text-emerald-600' : 'text-red-500'}`}>
                      {resendTestResult.ok ? '✓' : '✗'} {resendTestResult.msg}
                    </p>
                  )}
                </div>
              )}

              <div className="mt-5 flex items-center justify-between">
                <div className="text-xs text-slate-500">
                  <CheckCircle size={14} className="inline-block mr-1 text-emerald-600" />
                  Secrets are stored server-side. Users never see them.
                </div>
                <button
                  type="submit"
                  disabled={saving}
                  className="inline-flex items-center gap-2 rounded-xl bg-slate-950 px-5 py-2.5 text-sm font-bold text-white hover:bg-slate-800 disabled:opacity-60"
                >
                  {saving ? <Loader2 size={16} className="animate-spin" /> : <Power size={16} />}
                  Save
                </button>
              </div>
            </form>
          </div>
        </div>
      ) : null}
    </div>
  );
}
