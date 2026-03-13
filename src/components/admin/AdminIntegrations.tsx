import { FormEvent, useCallback, useEffect, useMemo, useState } from 'react';
import { CheckCircle, ExternalLink, Loader2, Power, SlidersHorizontal, TestTube2, X } from 'lucide-react';

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
  icon: string;
  accentClass: string;
  fields: PlatformField[];
  docsUrl: string;
  redirectHint: string;
};

type PlatformRow = {
  platform: string;
  config: Record<string, any>;
  enabled: boolean;
};

const rawApiBaseUrl = (import.meta.env.VITE_API_BASE_URL || '').trim();
const API_BASE_URL = rawApiBaseUrl.includes('api.yourdomain.com') ? '' : rawApiBaseUrl.replace(/\/$/, '');

const authHeaders = (): Record<string, string> => {
  if (typeof window === 'undefined') return {};
  const token = localStorage.getItem('auth_token');
  return token ? { Authorization: `Bearer ${token}` } : {};
};

const PLATFORMS: PlatformDef[] = [
  {
    id: 'wordpress',
    name: 'WordPress',
    description: 'Enable or disable WordPress connections. Users connect with Application Passwords.',
    icon: 'WP',
    accentClass: 'bg-slate-100 text-slate-800 font-black',
    fields: [],
    docsUrl: 'https://developer.wordpress.org/rest-api/reference/',
    redirectHint: 'No OAuth redirect needed (Application Password).',
  },
  {
    id: 'facebook',
    name: 'Facebook (Meta)',
    description: 'OAuth credentials for Facebook Graph API and Instagram Graph API publishing.',
    icon: 'f',
    accentClass: 'bg-[#1877F2] text-white font-black',
    fields: [
      { id: 'appId', label: 'App ID', placeholder: 'Meta App ID', type: 'text', helpText: 'From Meta for Developers → App settings.' },
      { id: 'appSecret', label: 'App Secret', placeholder: 'Meta App Secret', type: 'password', helpText: 'Keep this secret. Used server-side for token exchange.' },
      { id: 'redirectUri', label: 'Redirect URL', placeholder: 'https://YOUR-BACKEND/auth/facebook/callback', type: 'text', helpText: 'Must match the Valid OAuth Redirect URI in Meta app settings.' },
    ],
    docsUrl: 'https://developers.facebook.com/',
    redirectHint: 'Use `/auth/facebook/callback` on the backend.',
  },
  {
    id: 'linkedin',
    name: 'LinkedIn',
    description: 'OAuth credentials for publishing UGC posts and analytics.',
    icon: 'in',
    accentClass: 'bg-[#0A66C2] text-white font-black',
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
    icon: 'X',
    accentClass: 'bg-black text-white font-black',
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
    icon: 'P',
    accentClass: 'bg-[#E60023] text-white font-black',
    fields: [
      { id: 'clientId', label: 'App ID', placeholder: 'Pinterest App ID', type: 'text', helpText: 'From developers.pinterest.com app settings.' },
      { id: 'clientSecret', label: 'App Secret', placeholder: 'Pinterest App Secret', type: 'password', helpText: 'Keep this secret. Used server-side for token exchange.' },
      { id: 'redirectUri', label: 'Redirect URL', placeholder: 'https://YOUR-BACKEND/auth/pinterest/callback', type: 'text', helpText: 'Must match the redirect URI registered in your Pinterest app.' },
    ],
    docsUrl: 'https://developers.pinterest.com/docs/api/v5/',
    redirectHint: 'Use `/auth/pinterest/callback` on the backend.',
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
    try {
      const res = await fetch(`${API_BASE_URL}/api/admin/platform-configs/${encodeURIComponent(id)}`, { headers: authHeaders() });
      const data = await res.json().catch(() => ({} as any));
      if (!res.ok) throw new Error(data.error || 'Failed to load config');
      const cfg = data.config?.config || data.config || {};
      const row = rows[id] || { platform: id, config: {}, enabled: false };
      setForm(Object.fromEntries(Object.entries({ ...row.config, ...cfg }).map(([k, v]) => [k, String(v ?? '')])));
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
                  <div className={`flex h-12 w-12 items-center justify-center rounded-xl text-sm ${p.accentClass}`}>{p.icon}</div>
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
                      <div className="mt-1 text-[11px] leading-5 text-slate-500">{f.helpText}</div>
                    </div>
                  ))}
                </div>
              )}

              {saveError ? <div className="mt-4 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{saveError}</div> : null}

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

