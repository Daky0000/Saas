import { FormEvent, useCallback, useEffect, useState } from 'react';
import { CheckCircle, Loader2, Power, SlidersHorizontal, X } from 'lucide-react';

// ── Types ──────────────────────────────────────────────────────────────────────

interface ProviderField {
  id: string;
  label: string;
  placeholder: string;
  type: 'text' | 'password';
  helpText: string;
}

interface AuthProviderDef {
  id: string;
  name: string;
  description: string;
  icon: string; // emoji or short text
  accentClass: string;
  fields: ProviderField[];
  loginButtonLabel: string;
}

interface ProviderRow {
  provider: string;
  config: Record<string, string>;
  enabled: boolean;
}

// ── Supported auth providers ───────────────────────────────────────────────────

const AUTH_PROVIDERS: AuthProviderDef[] = [
  {
    id: 'google',
    name: 'Google',
    description: 'Let users sign in with their Google account via OAuth 2.0. Requires a Google Cloud project with OAuth credentials.',
    icon: 'G',
    accentClass: 'bg-white border border-slate-200 text-slate-800 font-bold',
    loginButtonLabel: 'Continue with Google',
    fields: [
      { id: 'clientId', label: 'Client ID', placeholder: 'xxxx.apps.googleusercontent.com', type: 'text', helpText: 'OAuth 2.0 Client ID from Google Cloud Console → APIs & Services → Credentials.' },
      { id: 'clientSecret', label: 'Client secret', placeholder: 'GOCSPX-...', type: 'password', helpText: 'Keep this secret. Never expose it to the browser.' },
      { id: 'redirectUri', label: 'Redirect URI', placeholder: 'https://contentflow-api-production.up.railway.app/auth/google/callback', type: 'text', helpText: 'Must be added to the authorised redirect URIs in your Google Cloud app.' },
    ],
  },
  {
    id: 'github',
    name: 'GitHub',
    description: 'Let users sign in with their GitHub account. Requires a GitHub OAuth App.',
    icon: '⬡',
    accentClass: 'bg-[#24292e] text-white font-bold',
    loginButtonLabel: 'Continue with GitHub',
    fields: [
      { id: 'clientId', label: 'Client ID', placeholder: 'Ov23li...', type: 'text', helpText: 'Client ID from your GitHub OAuth App settings.' },
      { id: 'clientSecret', label: 'Client secret', placeholder: 'GitHub client secret', type: 'password', helpText: 'Used server-side to exchange the authorization code.' },
      { id: 'redirectUri', label: 'Callback URL', placeholder: 'https://contentflow-api-production.up.railway.app/auth/github/callback', type: 'text', helpText: 'Must match the callback URL registered in your GitHub OAuth App.' },
    ],
  },
  {
    id: 'microsoft',
    name: 'Microsoft',
    description: 'Let users sign in with their Microsoft / Azure AD account.',
    icon: '⊞',
    accentClass: 'bg-[#0078d4] text-white font-bold',
    loginButtonLabel: 'Continue with Microsoft',
    fields: [
      { id: 'clientId', label: 'Application (client) ID', placeholder: 'xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx', type: 'text', helpText: 'Found in Azure Portal → App registrations.' },
      { id: 'clientSecret', label: 'Client secret value', placeholder: 'Azure client secret', type: 'password', helpText: 'Generate under Certificates & secrets → New client secret.' },
      { id: 'tenantId', label: 'Tenant ID', placeholder: 'common', type: 'text', helpText: 'Use "common" for personal + work accounts, or your Azure tenant GUID.' },
      { id: 'redirectUri', label: 'Redirect URI', placeholder: 'https://contentflow-api-production.up.railway.app/auth/microsoft/callback', type: 'text', helpText: 'Must be added to the Redirect URIs in Azure App registration.' },
    ],
  },
];

// ── Config ─────────────────────────────────────────────────────────────────────

const rawApiBaseUrl = (import.meta.env.VITE_API_BASE_URL || '').trim();
const API_BASE_URL = rawApiBaseUrl.includes('api.yourdomain.com') ? '' : rawApiBaseUrl.replace(/\/$/, '');

const authHeaders = (): Record<string, string> => {
  const token = localStorage.getItem('auth_token');
  return token ? { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' } : { 'Content-Type': 'application/json' };
};

// ── Component ─────────────────────────────────────────────────────────────────

const AdminAuthProviders = () => {
  const [providerRows, setProviderRows] = useState<Record<string, ProviderRow>>({});
  const [loading, setLoading] = useState(true);
  const [toggling, setToggling] = useState<string | null>(null);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [draftValues, setDraftValues] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [saveSuccess, setSaveSuccess] = useState<string | null>(null);

  const fetchProviders = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(`${API_BASE_URL}/api/admin/auth-providers`, { headers: authHeaders() });
      if (!res.ok) throw new Error('Failed');
      const data = await res.json() as { success: boolean; providers: ProviderRow[] };
      if (data.success) {
        const map: Record<string, ProviderRow> = {};
        for (const row of data.providers) map[row.provider] = row;
        setProviderRows(map);
      }
    } catch { /* ignore */ }
    setLoading(false);
  }, []);

  useEffect(() => { void fetchProviders(); }, [fetchProviders]);

  const handleToggle = async (providerId: string, currentEnabled: boolean) => {
    setToggling(providerId);
    const row = providerRows[providerId];
    try {
      const res = await fetch(`${API_BASE_URL}/api/admin/auth-providers/${providerId}`, {
        method: 'PUT',
        headers: authHeaders(),
        body: JSON.stringify({ config: row?.config ?? {}, enabled: !currentEnabled }),
      });
      const data = await res.json() as { success: boolean };
      if (data.success) {
        setProviderRows((prev) => ({
          ...prev,
          [providerId]: { provider: providerId, config: row?.config ?? {}, enabled: !currentEnabled },
        }));
      }
    } catch { /* ignore */ }
    setToggling(null);
  };

  const openConfigure = (id: string) => {
    setDraftValues(providerRows[id]?.config ?? {});
    setActiveId(id);
    setSaveError(null);
    setSaveSuccess(null);
  };

  const handleSave = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (!activeId) return;
    setSaving(true);
    setSaveError(null);
    setSaveSuccess(null);
    try {
      const currentEnabled = providerRows[activeId]?.enabled ?? false;
      const res = await fetch(`${API_BASE_URL}/api/admin/auth-providers/${activeId}`, {
        method: 'PUT',
        headers: authHeaders(),
        body: JSON.stringify({ config: draftValues, enabled: currentEnabled }),
      });
      const data = await res.json() as { success: boolean; error?: string };
      if (!data.success) throw new Error(data.error || 'Save failed');
      setProviderRows((prev) => ({
        ...prev,
        [activeId]: { provider: activeId, config: draftValues, enabled: prev[activeId]?.enabled ?? false },
      }));
      setSaveSuccess('Provider configuration saved.');
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : 'Save failed');
    }
    setSaving(false);
  };

  const activeDef = AUTH_PROVIDERS.find((p) => p.id === activeId) ?? null;

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="rounded-[24px] border border-slate-200 bg-white px-6 py-6">
        <h2 className="text-2xl font-black tracking-[-0.03em] text-slate-950">Login Providers</h2>
        <p className="mt-1 text-sm text-slate-500">
          Configure social login options for the login and sign-up pages. Only <strong>enabled</strong> providers are shown to users.
          You must configure credentials before enabling a provider.
        </p>
      </div>

      {/* Preview banner */}
      <div className="rounded-[20px] border border-violet-100 bg-violet-50 px-5 py-4">
        <div className="text-sm font-semibold text-violet-800">What users will see on the login page</div>
        <div className="mt-3 flex flex-wrap gap-3">
          {AUTH_PROVIDERS.filter((p) => providerRows[p.id]?.enabled).map((p) => (
            <div key={p.id} className={`flex items-center gap-2 rounded-xl px-4 py-2 text-sm shadow-sm ${p.accentClass}`}>
              <span className="text-base">{p.icon}</span>
              {p.loginButtonLabel}
            </div>
          ))}
          {AUTH_PROVIDERS.every((p) => !providerRows[p.id]?.enabled) && (
            <span className="text-sm text-slate-400 italic">No providers enabled — only email/password login is shown.</span>
          )}
        </div>
      </div>

      {/* Provider cards */}
      {loading ? (
        <div className="flex items-center justify-center py-16">
          <Loader2 size={28} className="animate-spin text-slate-400" />
        </div>
      ) : (
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {AUTH_PROVIDERS.map((provider) => {
            const row = providerRows[provider.id];
            const isEnabled = row?.enabled ?? false;
            const isConfigured = row !== undefined && Object.keys(row.config).length > 0;
            const isToggling = toggling === provider.id;

            return (
              <div
                key={provider.id}
                className={`rounded-[20px] border bg-white p-5 transition-all ${isEnabled ? 'border-emerald-200 shadow-sm' : 'border-slate-200'}`}
              >
                <div className="flex items-start justify-between gap-3">
                  <div className={`flex h-12 w-12 items-center justify-center rounded-xl text-lg ${provider.accentClass}`}>
                    {provider.icon}
                  </div>
                  <button
                    type="button"
                    onClick={() => void handleToggle(provider.id, isEnabled)}
                    disabled={isToggling || (!isConfigured && !isEnabled)}
                    title={!isConfigured && !isEnabled ? 'Configure credentials first' : isEnabled ? 'Disable for users' : 'Enable for users'}
                    className={`flex items-center gap-1.5 rounded-xl px-3 py-1.5 text-xs font-semibold transition-colors disabled:opacity-50 ${
                      isEnabled
                        ? 'bg-emerald-50 text-emerald-700 hover:bg-emerald-100'
                        : 'bg-slate-100 text-slate-500 hover:bg-slate-200'
                    }`}
                  >
                    {isToggling ? <Loader2 size={12} className="animate-spin" /> : <Power size={12} />}
                    {isEnabled ? 'Enabled' : 'Disabled'}
                  </button>
                </div>

                <div className="mt-3">
                  <h3 className="font-black text-slate-900">{provider.name}</h3>
                  <p className="mt-1 text-xs leading-5 text-slate-500">{provider.description}</p>
                </div>

                <div className="mt-4 flex items-center justify-between border-t border-slate-100 pt-3">
                  <span className={`text-xs font-semibold ${isConfigured ? 'text-emerald-600' : 'text-amber-500'}`}>
                    {isConfigured ? 'Credentials saved' : 'Not configured'}
                  </span>
                  <button
                    type="button"
                    onClick={() => openConfigure(provider.id)}
                    className="inline-flex items-center gap-1.5 rounded-xl border border-slate-200 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-50"
                  >
                    <SlidersHorizontal size={12} />
                    {isConfigured ? 'Reconfigure' : 'Configure'}
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Configure modal */}
      {activeDef && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/40 px-4 py-8">
          <div className="max-h-[90vh] w-full max-w-xl overflow-hidden rounded-[28px] border border-slate-200 bg-white">
            <div className="flex items-start justify-between gap-4 border-b border-slate-200 px-6 py-5">
              <div>
                <div className="text-xs font-semibold uppercase tracking-[0.2em] text-slate-400">OAuth App Credentials</div>
                <h3 className="mt-1 text-xl font-black tracking-[-0.03em] text-slate-950">{activeDef.name} Login</h3>
                <p className="mt-1 text-xs text-slate-500">
                  After saving, toggle the provider <strong>Enabled</strong> to show the "{activeDef.loginButtonLabel}" button on the login page.
                </p>
              </div>
              <button
                type="button"
                onClick={() => { setActiveId(null); setSaveError(null); setSaveSuccess(null); }}
                className="rounded-xl p-2 text-slate-400 hover:bg-slate-100 hover:text-slate-700"
              >
                <X size={18} />
              </button>
            </div>

            <form onSubmit={handleSave} className="max-h-[70vh] overflow-y-auto px-6 py-6">
              <div className="space-y-4">
                {activeDef.fields.map((field) => (
                  <label key={field.id} className="block space-y-1.5">
                    <span className="text-sm font-semibold text-slate-800">{field.label}</span>
                    <input
                      type={field.type}
                      value={draftValues[field.id] ?? ''}
                      onChange={(e) => setDraftValues((c) => ({ ...c, [field.id]: e.target.value }))}
                      placeholder={field.placeholder}
                      className="h-11 w-full rounded-xl border border-slate-200 bg-slate-50 px-4 text-sm outline-none focus:border-slate-400"
                    />
                    <p className="text-xs text-slate-400">{field.helpText}</p>
                  </label>
                ))}
              </div>

              <div className="mt-6 space-y-3 border-t border-slate-200 pt-5">
                {saveError && <p className="rounded-xl bg-red-50 px-4 py-2.5 text-xs text-red-600">{saveError}</p>}
                {saveSuccess && (
                  <p className="flex items-center gap-2 rounded-xl bg-emerald-50 px-4 py-2.5 text-xs text-emerald-700">
                    <CheckCircle size={13} /> {saveSuccess}
                  </p>
                )}
                <div className="flex items-center justify-end gap-3">
                  <button
                    type="button"
                    onClick={() => { setActiveId(null); setSaveError(null); setSaveSuccess(null); }}
                    className="rounded-xl border border-slate-200 px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50"
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    disabled={saving}
                    className="inline-flex items-center gap-2 rounded-xl bg-slate-950 px-5 py-2 text-sm font-semibold text-white hover:bg-slate-800 disabled:opacity-60"
                  >
                    {saving && <Loader2 size={13} className="animate-spin" />}
                    {saving ? 'Saving…' : 'Save credentials'}
                  </button>
                </div>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};

export default AdminAuthProviders;
