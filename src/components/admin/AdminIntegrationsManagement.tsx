import { FormEvent, ReactNode, useCallback, useEffect, useMemo, useState } from 'react';
import {
  Bot,
  Box,
  CheckCircle,
  CreditCard,
  Globe,
  LayoutTemplate,
  Loader2,
  Mail,
  Power,
  SlidersHorizontal,
  Webhook,
  X,
  Search,
} from 'lucide-react';

// ── Types ──────────────────────────────────────────────────────────────────────

interface IntegrationField {
  id: string;
  label: string;
  placeholder: string;
  type: 'text' | 'password' | 'url' | 'textarea';
  helpText: string;
}

interface IntegrationDef {
  id: string;
  name: string;
  description: string;
  category: string;
  accentClass: string;
  icon: ReactNode;
  fields: IntegrationField[];
  isOAuth?: boolean;
}

interface PlatformRow {
  platform: string;
  config: Record<string, string>;
  enabled: boolean;
}

// ── All integrations the admin can manage ──────────────────────────────────────

const ALL_INTEGRATIONS: IntegrationDef[] = [
  {
    id: 'wordpress',
    name: 'WordPress',
    description: 'Publish posts, pages, and media into WordPress sites.',
    category: 'Developer tools',
    accentClass: 'bg-[#1d2327] text-white',
    icon: <Globe size={20} />,
    fields: [
      { id: 'siteUrl', label: 'Site URL', placeholder: 'https://your-site.com', type: 'url', helpText: 'Full URL of the WordPress installation.' },
      { id: 'username', label: 'Username', placeholder: 'Admin username', type: 'text', helpText: 'A WordPress user with permission to publish.' },
      { id: 'applicationPassword', label: 'Application password', placeholder: 'xxxx xxxx xxxx xxxx xxxx xxxx', type: 'password', helpText: 'Generate under Users → Profile → Application Passwords.' },
    ],
  },
  {
    id: 'instagram',
    name: 'Instagram',
    description: 'OAuth — users connect their Instagram via your Meta app.',
    category: 'Communication',
    accentClass: 'bg-gradient-to-br from-pink-500 via-fuchsia-500 to-orange-400 text-white',
    icon: <Globe size={20} />,
    isOAuth: true,
    fields: [
      { id: 'appId', label: 'App ID', placeholder: 'Instagram app ID', type: 'text', helpText: 'Meta app identifier for your project.' },
      { id: 'appSecret', label: 'App secret', placeholder: 'Instagram app secret', type: 'password', helpText: 'Keep secure — use the production secret when live.' },
      { id: 'redirectUri', label: 'Redirect URI', placeholder: 'https://marketing.dakyworld.com/auth/instagram/callback', type: 'url', helpText: 'Must match the callback URL in your Meta app settings.' },
    ],
  },
  {
    id: 'facebook',
    name: 'Facebook',
    description: 'OAuth — users connect their Facebook pages via your Meta app.',
    category: 'Communication',
    accentClass: 'bg-[#1877f2] text-white',
    icon: <Globe size={20} />,
    isOAuth: true,
    fields: [
      { id: 'appId', label: 'App ID', placeholder: 'Facebook app ID', type: 'text', helpText: 'Meta app ID tied to your Facebook page.' },
      { id: 'appSecret', label: 'App secret', placeholder: 'Facebook app secret', type: 'password', helpText: 'Required to exchange authorization codes securely.' },
      { id: 'redirectUri', label: 'Redirect URI', placeholder: 'https://marketing.dakyworld.com/auth/facebook/callback', type: 'url', helpText: 'Must match the redirect URI registered in your Facebook app.' },
    ],
  },
  {
    id: 'linkedin',
    name: 'LinkedIn',
    description: 'OAuth — users connect their LinkedIn via your developer app.',
    category: 'Communication',
    accentClass: 'bg-[#0a66c2] text-white',
    icon: <Globe size={20} />,
    isOAuth: true,
    fields: [
      { id: 'clientId', label: 'Client ID', placeholder: 'LinkedIn client ID', type: 'text', helpText: 'Client ID from your LinkedIn developer app.' },
      { id: 'clientSecret', label: 'Client secret', placeholder: 'LinkedIn client secret', type: 'password', helpText: 'Used to exchange the OAuth authorization code.' },
      { id: 'redirectUri', label: 'Redirect URI', placeholder: 'https://marketing.dakyworld.com/auth/linkedin/callback', type: 'url', helpText: 'Same callback URI configured inside LinkedIn.' },
    ],
  },
  {
    id: 'tiktok',
    name: 'TikTok',
    description: 'OAuth — users connect their TikTok creator accounts.',
    category: 'Communication',
    accentClass: 'bg-[#111111] text-white',
    icon: <Globe size={20} />,
    isOAuth: true,
    fields: [
      { id: 'clientKey', label: 'Client key', placeholder: 'TikTok client key', type: 'text', helpText: 'Client key issued by TikTok developers.' },
      { id: 'clientSecret', label: 'Client secret', placeholder: 'TikTok client secret', type: 'password', helpText: 'Required for exchanging codes and refreshing tokens.' },
      { id: 'redirectUri', label: 'Redirect URI', placeholder: 'https://marketing.dakyworld.com/auth/tiktok/callback', type: 'url', helpText: 'Must match the URI registered in TikTok developer settings.' },
    ],
  },
  {
    id: 'twitter',
    name: 'Twitter / X',
    description: 'OAuth — users connect their X accounts via your developer app.',
    category: 'Communication',
    accentClass: 'bg-black text-white',
    icon: <Globe size={20} />,
    isOAuth: true,
    fields: [
      { id: 'clientId', label: 'Client ID', placeholder: 'Twitter or X client ID', type: 'text', helpText: 'OAuth 2 client ID from your X developer app.' },
      { id: 'clientSecret', label: 'Client secret', placeholder: 'Twitter or X client secret', type: 'password', helpText: 'Required for secure authorization code exchange.' },
      { id: 'redirectUri', label: 'Redirect URI', placeholder: 'https://marketing.dakyworld.com/auth/twitter/callback', type: 'url', helpText: 'This redirect URI must match your X developer setup.' },
    ],
  },
  {
    id: 'mailchimp',
    name: 'Mailchimp',
    description: 'Email marketing and automation for your users.',
    category: 'Communication',
    accentClass: 'bg-[#f5df4d] text-[#1f1f1f]',
    icon: <Mail size={20} />,
    fields: [
      { id: 'apiKey', label: 'API key', placeholder: 'Mailchimp API key', type: 'password', helpText: 'Found under Account → Extras → API keys.' },
      { id: 'serverPrefix', label: 'Server prefix', placeholder: 'us21', type: 'text', helpText: 'Data center prefix from your Mailchimp account.' },
      { id: 'audienceId', label: 'Audience ID', placeholder: 'Primary audience ID', type: 'text', helpText: 'The audience new leads should sync into.' },
    ],
  },
  {
    id: 'square',
    name: 'Square',
    description: 'Payments processing and POS solutions.',
    category: 'Productivity',
    accentClass: 'bg-black text-white',
    icon: <Box size={20} />,
    fields: [
      { id: 'applicationId', label: 'Application ID', placeholder: 'Square application ID', type: 'text', helpText: 'Application identifier from your Square developer dashboard.' },
      { id: 'accessToken', label: 'Access token', placeholder: 'Production access token', type: 'password', helpText: 'Use a production token for live charges.' },
      { id: 'locationId', label: 'Location ID', placeholder: 'Main Square location ID', type: 'text', helpText: 'Which Square business location to use.' },
    ],
  },
  {
    id: 'brave',
    name: 'Brave',
    description: 'Privacy-first browser integration for previews and QA.',
    category: 'Browser tools',
    accentClass: 'bg-[#fff2eb] text-[#dc5a2f]',
    icon: <Globe size={20} />,
    fields: [
      { id: 'profileName', label: 'Profile name', placeholder: 'Marketing QA', type: 'text', helpText: 'Name of the Brave profile your team uses for review.' },
      { id: 'launchUrl', label: 'Launch URL', placeholder: 'https://your-site.com', type: 'url', helpText: 'URL to open by default when launching.' },
      { id: 'extensionId', label: 'Extension ID', placeholder: 'Optional extension ID', type: 'text', helpText: 'Only needed if your flow depends on a specific Brave extension.' },
    ],
  },
  {
    id: 'zapier',
    name: 'Zapier',
    description: 'Build custom automations and integrations.',
    category: 'Productivity',
    accentClass: 'bg-[#ff6a2a] text-white',
    icon: <Webhook size={20} />,
    fields: [
      { id: 'webhookUrl', label: 'Webhook URL', placeholder: 'https://hooks.zapier.com/hooks/catch/...', type: 'url', helpText: 'Paste the Zapier webhook that should receive events.' },
      { id: 'zapName', label: 'Zap name', placeholder: 'New lead sync', type: 'text', helpText: 'Descriptive name so teammates know which automation is connected.' },
      { id: 'secretKey', label: 'Secret key', placeholder: 'Optional verification secret', type: 'password', helpText: 'Add this if your Zap validates inbound requests.' },
    ],
  },
  {
    id: 'linear',
    name: 'Linear',
    description: 'Streamline software projects, sprints, tasks, and bug tracking.',
    category: 'Developer tools',
    accentClass: 'bg-[#4050b5] text-white',
    icon: <SlidersHorizontal size={20} />,
    fields: [
      { id: 'apiKey', label: 'API key', placeholder: 'lin_api_...', type: 'password', helpText: 'Generate in Linear Settings → API.' },
      { id: 'teamKey', label: 'Team key', placeholder: 'ENG', type: 'text', helpText: 'Linear team key where issues should be created.' },
      { id: 'projectId', label: 'Project or label', placeholder: 'Launch operations', type: 'text', helpText: 'Optional default project or label for new tickets.' },
    ],
  },
  {
    id: 'framer',
    name: 'Framer',
    description: 'Design and publish polished marketing pages with CMS.',
    category: 'Developer tools',
    accentClass: 'bg-black text-white',
    icon: <LayoutTemplate size={20} />,
    fields: [
      { id: 'siteId', label: 'Site ID', placeholder: 'Framer site ID', type: 'text', helpText: 'Site or workspace identifier from Framer.' },
      { id: 'publishToken', label: 'Publishing token', placeholder: 'Framer API token', type: 'password', helpText: 'Allows content pushes into Framer.' },
      { id: 'collection', label: 'Target collection', placeholder: 'Blog posts', type: 'text', helpText: 'CMS collection that should receive updates.' },
    ],
  },
  {
    id: 'chatgpt',
    name: 'ChatGPT',
    description: 'AI drafting, editing, summarizing, and automation support.',
    category: 'Productivity',
    accentClass: 'bg-black text-white',
    icon: <Bot size={20} />,
    fields: [
      { id: 'apiKey', label: 'API key', placeholder: 'sk-...', type: 'password', helpText: 'API key from platform.openai.com.' },
      { id: 'model', label: 'Model', placeholder: 'gpt-4o-mini', type: 'text', helpText: 'Model used for your workflow (e.g. gpt-4o, gpt-4o-mini).' },
      { id: 'systemPrompt', label: 'System prompt', placeholder: 'You are a brand voice assistant...', type: 'textarea', helpText: 'Optional base prompt for every generated request.' },
    ],
  },
  {
    id: 'webflow',
    name: 'Webflow',
    description: 'Visual canvas website builder with CMS support.',
    category: 'Developer tools',
    accentClass: 'bg-[#4f67ff] text-white',
    icon: <LayoutTemplate size={20} />,
    fields: [
      { id: 'apiToken', label: 'API token', placeholder: 'Webflow API token', type: 'password', helpText: 'Generate in Webflow Workspace Settings → Integrations → API.' },
      { id: 'siteId', label: 'Site ID', placeholder: 'Primary Webflow site ID', type: 'text', helpText: 'Site where content should be published.' },
      { id: 'collectionId', label: 'Collection ID', placeholder: 'Blog collection ID', type: 'text', helpText: 'CMS collection used for new content.' },
    ],
  },
  {
    id: 'stripe',
    name: 'Stripe',
    description: 'Payments API for subscriptions, checkout, and billing.',
    category: 'Productivity',
    accentClass: 'bg-[#6658ff] text-white',
    icon: <CreditCard size={20} />,
    fields: [
      { id: 'publishableKey', label: 'Publishable key', placeholder: 'pk_live_...', type: 'text', helpText: 'Use your live key for production payments.' },
      { id: 'secretKey', label: 'Secret key', placeholder: 'sk_live_...', type: 'password', helpText: 'Used server-side. Never expose this key to the browser.' },
      { id: 'signingSecret', label: 'Webhook secret', placeholder: 'whsec_...', type: 'password', helpText: 'Needed if Stripe events post back into your backend.' },
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

const AdminIntegrationsManagement = () => {
  const [platformRows, setPlatformRows] = useState<Record<string, PlatformRow>>({});
  const [loading, setLoading] = useState(true);
  const [toggling, setToggling] = useState<string | null>(null);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [draftValues, setDraftValues] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [saveSuccess, setSaveSuccess] = useState<string | null>(null);
  const [search, setSearch] = useState('');

  const fetchConfigs = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(`${API_BASE_URL}/api/admin/platform-configs`, { headers: authHeaders() });
      if (!res.ok) throw new Error('Failed to load');
      const data = await res.json() as { success: boolean; configs: PlatformRow[] };
      if (data.success) {
        const map: Record<string, PlatformRow> = {};
        for (const row of data.configs) map[row.platform] = row;
        setPlatformRows(map);
      }
    } catch { /* ignore */ }
    setLoading(false);
  }, []);

  useEffect(() => { void fetchConfigs(); }, [fetchConfigs]);

  const handleToggle = async (integrationId: string, currentEnabled: boolean) => {
    setToggling(integrationId);
    try {
      const res = await fetch(`${API_BASE_URL}/api/admin/platform-configs/${integrationId}/toggle`, {
        method: 'PATCH',
        headers: authHeaders(),
        body: JSON.stringify({ enabled: !currentEnabled }),
      });
      const data = await res.json() as { success: boolean; enabled: boolean };
      if (data.success) {
        setPlatformRows((prev) => ({
          ...prev,
          [integrationId]: { ...(prev[integrationId] ?? { platform: integrationId, config: {} }), enabled: data.enabled },
        }));
      }
    } catch { /* ignore */ }
    setToggling(null);
  };

  const openConfigure = (id: string) => {
    const existing = platformRows[id]?.config ?? {};
    setDraftValues(existing);
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
      const currentEnabled = platformRows[activeId]?.enabled ?? false;
      const res = await fetch(`${API_BASE_URL}/api/admin/platform-configs/${activeId}`, {
        method: 'PUT',
        headers: authHeaders(),
        body: JSON.stringify({ config: draftValues, enabled: currentEnabled }),
      });
      const data = await res.json() as { success: boolean; error?: string };
      if (!data.success) throw new Error(data.error || 'Save failed');
      setPlatformRows((prev) => ({
        ...prev,
        [activeId]: { platform: activeId, config: draftValues, enabled: prev[activeId]?.enabled ?? false },
      }));
      setSaveSuccess('Configuration saved successfully.');
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : 'Save failed');
    }
    setSaving(false);
  };

  const activeDef = useMemo(() => ALL_INTEGRATIONS.find((i) => i.id === activeId) ?? null, [activeId]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return ALL_INTEGRATIONS;
    return ALL_INTEGRATIONS.filter((i) => `${i.name} ${i.description} ${i.category}`.toLowerCase().includes(q));
  }, [search]);

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="rounded-[24px] border border-slate-200 bg-white px-6 py-6">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h2 className="text-2xl font-black tracking-[-0.03em] text-slate-950">Integration Management</h2>
            <p className="mt-1 text-sm text-slate-500">
              Configure credentials and control which integrations users can connect to.
              Only <strong>enabled</strong> integrations appear in the user dashboard.
            </p>
          </div>
          <div className="relative w-full max-w-xs">
            <Search className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" size={16} />
            <input
              type="search"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search integrations…"
              className="h-10 w-full rounded-xl border border-slate-200 bg-slate-50 pl-9 pr-3 text-sm outline-none focus:border-slate-400"
            />
          </div>
        </div>
      </div>

      {/* Grid */}
      {loading ? (
        <div className="flex items-center justify-center py-16">
          <Loader2 size={28} className="animate-spin text-slate-400" />
        </div>
      ) : (
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {filtered.map((integration) => {
            const row = platformRows[integration.id];
            const isEnabled = row?.enabled ?? false;
            const isConfigured = row !== undefined && Object.keys(row.config).length > 0;
            const isToggling = toggling === integration.id;

            return (
              <div
                key={integration.id}
                className={`rounded-[20px] border bg-white p-4 transition-all ${isEnabled ? 'border-emerald-200 shadow-sm' : 'border-slate-200'}`}
              >
                <div className="flex items-start justify-between gap-3">
                  <div className={`flex h-12 w-12 items-center justify-center rounded-xl ${integration.accentClass}`}>
                    {integration.icon}
                  </div>
                  {/* Enable/Disable toggle */}
                  <button
                    type="button"
                    onClick={() => void handleToggle(integration.id, isEnabled)}
                    disabled={isToggling}
                    title={isEnabled ? 'Disable for users' : 'Enable for users'}
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
                  <div className="flex items-center gap-2">
                    <h3 className="font-black text-slate-900">{integration.name}</h3>
                    {integration.isOAuth && (
                      <span className="rounded-full bg-violet-100 px-2 py-0.5 text-[10px] font-bold text-violet-700">OAuth</span>
                    )}
                  </div>
                  <p className="mt-1 text-xs leading-5 text-slate-500">{integration.description}</p>
                  <div className="mt-2 text-[11px] font-medium text-slate-400">{integration.category}</div>
                </div>

                <div className="mt-4 flex items-center justify-between border-t border-slate-100 pt-3">
                  <span className={`text-xs font-semibold ${isConfigured ? 'text-emerald-600' : 'text-amber-500'}`}>
                    {isConfigured ? 'Configured' : 'Not configured'}
                  </span>
                  <button
                    type="button"
                    onClick={() => openConfigure(integration.id)}
                    className="inline-flex items-center gap-1.5 rounded-xl border border-slate-200 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 transition-colors hover:bg-slate-50"
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
                <div className="text-xs font-semibold uppercase tracking-[0.2em] text-slate-400">Admin Configuration</div>
                <h3 className="mt-1 text-xl font-black tracking-[-0.03em] text-slate-950">{activeDef.name}</h3>
                {activeDef.isOAuth && (
                  <p className="mt-1 text-xs text-violet-700 bg-violet-50 rounded-lg px-2 py-1 inline-block">
                    These credentials are used when users click "Connect with {activeDef.name}"
                  </p>
                )}
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
                    {field.type === 'textarea' ? (
                      <textarea
                        value={draftValues[field.id] ?? ''}
                        onChange={(e) => setDraftValues((c) => ({ ...c, [field.id]: e.target.value }))}
                        placeholder={field.placeholder}
                        rows={3}
                        className="w-full resize-y rounded-xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm outline-none focus:border-slate-400"
                      />
                    ) : (
                      <input
                        type={field.type}
                        value={draftValues[field.id] ?? ''}
                        onChange={(e) => setDraftValues((c) => ({ ...c, [field.id]: e.target.value }))}
                        placeholder={field.placeholder}
                        className="h-11 w-full rounded-xl border border-slate-200 bg-slate-50 px-4 text-sm outline-none focus:border-slate-400"
                      />
                    )}
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
                    {saving ? 'Saving…' : 'Save configuration'}
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

export default AdminIntegrationsManagement;
