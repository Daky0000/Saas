import { useCallback, useEffect, useMemo, useState } from 'react';
import { AlertCircle, Check, ExternalLink, Loader2, Pencil, Plus, RefreshCw, Trash2 } from 'lucide-react';
import type { PublishingLog } from '../services/distributionService';
import { distributionService } from '../services/distributionService';

export type SocialAutomationSubTab = 'connections' | 'post_format' | 'scheduling' | 'preview' | 'logs';

export type SocialAutomationFacebookDestination =
  | { type: 'page'; id: string; name?: string }
  | { type: 'group'; id: string; name?: string }
  | { type: 'profile'; id?: string; name?: string };

export type SocialAutomationSettings = {
  platforms: {
    facebook: {
      enabled: boolean;
      destination: SocialAutomationFacebookDestination;
    };
  };
  postFormat: {
    template: string;
  };
  scheduling: {
    mode: 'immediate' | 'schedule' | 'delay';
    scheduledFor?: string | null;
    timezone?: string | null;
    delayMinutes?: number | null;
  };
};

export const DEFAULT_SOCIAL_AUTOMATION_TEMPLATE = `{title}

{excerpt}

Read more
{url}

#blog`;

export function getDefaultSocialAutomationSettings(): SocialAutomationSettings {
  return {
    platforms: {
      facebook: {
        enabled: false,
        destination: { type: 'page', id: '', name: '' },
      },
    },
    postFormat: { template: DEFAULT_SOCIAL_AUTOMATION_TEMPLATE },
    scheduling: {
      mode: 'immediate',
      scheduledFor: null,
      timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC',
      delayMinutes: 10,
    },
  };
}

export default function SocialAutomationTab(_props: {
  postId: string | null;
  postUrl: string;
  postTitle: string;
  postExcerpt: string;
  featuredImage: string;
  authorName: string;
  settings: SocialAutomationSettings;
  onChange: (next: SocialAutomationSettings) => void;
  initialSubTab?: SocialAutomationSubTab;
}) {
  const { postId, postUrl, postTitle, postExcerpt, featuredImage, authorName, settings, onChange } = _props;
  const [subTab, setSubTab] = useState<SocialAutomationSubTab>(_props.initialSubTab || 'connections');

  useEffect(() => {
    if (!_props.initialSubTab) return;
    setSubTab(_props.initialSubTab);
  }, [_props.initialSubTab]);

  type SocialAccountRow = {
    id: string;
    platform: string;
    account_type: 'profile' | 'page' | 'group' | string;
    account_id: string;
    account_name: string;
    profile_image?: string | null;
    connected: boolean;
    created_at?: string;
  };

  type FacebookTarget = { id: string; name: string; type: 'page' };

  const rawApiBaseUrl = (import.meta.env.VITE_API_BASE_URL || '').trim();
  const API_BASE_URL = rawApiBaseUrl.includes('api.yourdomain.com') ? '' : rawApiBaseUrl.replace(/\/$/, '');
  const authHeaders = (): Record<string, string> => {
    const token = localStorage.getItem('auth_token');
    return token ? { Authorization: `Bearer ${token}` } : {};
  };

  const [accounts, setAccounts] = useState<SocialAccountRow[]>([]);
  const [loadingAccounts, setLoadingAccounts] = useState(false);
  const [facebookTargets, setFacebookTargets] = useState<{ loading: boolean; pages: FacebookTarget[]; groups: FacebookTarget[]; error: string | null }>({
    loading: false,
    pages: [],
    groups: [],
    error: null,
  });
  const [connecting, setConnecting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [logs, setLogs] = useState<PublishingLog[]>([]);
  const [loadingLogs, setLoadingLogs] = useState(false);

  const facebookAccount = useMemo(() => {
    return accounts.find((a) =>
      String(a.platform || '').toLowerCase() === 'facebook'
      && String(a.account_type || '').toLowerCase() === 'profile'
      && a.connected
    ) || null;
  }, [accounts]);

  const facebookProfile = useMemo(() => {
    const name = String(facebookAccount?.account_name || '').trim() || 'Facebook Profile';
    const avatar = String(facebookAccount?.profile_image || '').trim();
    const id = String(facebookAccount?.account_id || '').trim();
    return { id, name, avatar };
  }, [facebookAccount]);

  const clampText = (value: string, maxLen: number) => {
    const s = String(value || '');
    return s.length > maxLen ? `${s.slice(0, maxLen - 1)}…` : s;
  };

  const renderTemplate = (template: string, vars: Record<string, string>) => {
    return String(template || '').replace(/\{([a-zA-Z0-9_]+)\}/g, (m, key) => {
      if (Object.prototype.hasOwnProperty.call(vars, key)) return vars[key] ?? '';
      return m;
    });
  };

  const setFacebookEnabled = (enabled: boolean) => {
    onChange({
      ...settings,
      platforms: {
        ...settings.platforms,
        facebook: { ...settings.platforms.facebook, enabled },
      },
    });
  };

  const setFacebookDestination = (dest: SocialAutomationFacebookDestination) => {
    onChange({
      ...settings,
      platforms: {
        ...settings.platforms,
        facebook: { ...settings.platforms.facebook, destination: dest },
      },
    });
  };

  const setTemplate = (template: string) => {
    onChange({ ...settings, postFormat: { ...settings.postFormat, template } });
  };

  const setScheduling = (patch: Partial<SocialAutomationSettings['scheduling']>) => {
    onChange({ ...settings, scheduling: { ...settings.scheduling, ...patch } });
  };

  const loadAccounts = useCallback(async () => {
    setLoadingAccounts(true);
    setError(null);
    try {
      const res = await fetch(`${API_BASE_URL}/api/v1/social/accounts`, { headers: authHeaders() });
      const text = await res.text();
      let parsed: any = null;
      try { parsed = text ? JSON.parse(text) : null; } catch { parsed = null; }
      if (!res.ok) throw new Error(parsed?.error || 'Failed to load accounts');
      if (!parsed?.success) throw new Error(parsed?.error || 'Failed to load accounts');
      setAccounts(Array.isArray(parsed?.accounts) ? parsed.accounts : []);
    } catch (e) {
      setAccounts([]);
      setError(e instanceof Error ? e.message : 'Failed to load accounts');
    } finally {
      setLoadingAccounts(false);
    }
  }, [API_BASE_URL]);

  const loadFacebookTargets = useCallback(async () => {
    if (!facebookAccount) {
      setFacebookTargets({ loading: false, pages: [], groups: [], error: null });
      return;
    }
    setFacebookTargets((p) => ({ ...p, loading: true, error: null }));
    try {
      const res = await fetch(`${API_BASE_URL}/api/v1/social/facebook/pages`, { headers: authHeaders() });
      const data = res.ok
        ? (await res.json() as { success: boolean; pages?: Array<{ id: string; name: string }>; error?: string })
        : { success: false, error: 'Failed to load Facebook pages' };
      if (!data.success) throw new Error(data.error || 'Failed to load Facebook pages');
      const pages = (data.pages || []).map((p) => ({ id: String(p.id), name: String(p.name || 'Facebook Page'), type: 'page' as const }));
      setFacebookTargets({ loading: false, pages, groups: [], error: null });
    } catch (e) {
      setFacebookTargets({ loading: false, pages: [], groups: [], error: e instanceof Error ? e.message : 'Failed to load Facebook pages' });
    }
  }, [API_BASE_URL, facebookAccount]);

  const beginFacebookOAuth = useCallback(async () => {
    setError(null);
    setConnecting(true);
    try {
      const returnTo =
        postId
          ? `/posts?view=automation&postId=${encodeURIComponent(postId)}&subtab=connections`
          : '/posts?view=automation&subtab=connections';
      const authorizeUrl = new URL(`${API_BASE_URL}/api/v1/social/facebook/authorize-url`);
      authorizeUrl.searchParams.set('returnTo', returnTo);
      const urlRes = await fetch(authorizeUrl.toString(), { headers: authHeaders() });
      const text = await urlRes.text();
      let data: { success: boolean; url?: string; error?: string };
      try { data = JSON.parse(text) as any; }
      catch {
        const preview = text.slice(0, 160).replace(/\s+/g, ' ').trim();
        data = { success: false, error: preview ? `Invalid server response. ${preview}` : 'Invalid server response.' };
      }
      if (!data.success || !data.url) throw new Error(data.error || 'Failed to build authorize URL');
      window.location.href = data.url;
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Connection failed');
      setConnecting(false);
    }
  }, [API_BASE_URL, postId]);

  const disconnectFacebook = useCallback(async () => {
    if (!confirm('Disconnect Facebook?')) return;
    setError(null);
    try {
      const profile = accounts.find((a) => String(a.platform || '').toLowerCase() === 'facebook' && String(a.account_type || '').toLowerCase() === 'profile') || null;
      if (!profile) throw new Error('No Facebook connection found');
      const res = await fetch(`${API_BASE_URL}/api/v1/social/accounts/${encodeURIComponent(profile.id)}`, { method: 'DELETE', headers: authHeaders() });
      const data = res.ok ? (await res.json() as { success: boolean; error?: string }) : { success: false, error: 'Failed to disconnect' };
      if (!data.success) throw new Error(data.error || 'Failed to disconnect');
      await loadAccounts();
      setFacebookTargets({ loading: false, pages: [], groups: [], error: null });
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to disconnect');
    }
  }, [API_BASE_URL, accounts, loadAccounts]);

  const refreshLogs = useCallback(async () => {
    if (!postId) return;
    setLoadingLogs(true);
    try {
      const all = await distributionService.getStatus(postId);
      setLogs(all.filter((l) => String(l.platform || '').toLowerCase() === 'facebook'));
    } catch {
      setLogs([]);
    } finally {
      setLoadingLogs(false);
    }
  }, [postId]);

  useEffect(() => { void loadAccounts(); }, [loadAccounts]);
  useEffect(() => { void loadFacebookTargets(); }, [loadFacebookTargets]);
  useEffect(() => { if (subTab === 'logs') void refreshLogs(); }, [refreshLogs, subTab]);

  const renderedText = useMemo(() => {
    const template = settings.postFormat.template || DEFAULT_SOCIAL_AUTOMATION_TEMPLATE;
    return renderTemplate(template, {
      title: postTitle || '',
      excerpt: postExcerpt || '',
      url: postUrl || '',
      featured_image: featuredImage || '',
      author: authorName || '',
    }).trim();
  }, [authorName, featuredImage, postExcerpt, postTitle, postUrl, settings.postFormat.template]);

  const destinationLabel = useMemo(() => {
    const dest = settings.platforms.facebook.destination;
    if (dest.type === 'page') return dest.name ? `Page: ${dest.name}` : 'Page';
    if (dest.type === 'group') return dest.name ? `Group: ${dest.name}` : 'Group';
    return 'Profile';
  }, [settings.platforms.facebook.destination]);

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-1 border-b border-slate-200">
        {(['connections', 'post_format', 'scheduling', 'preview', 'logs'] as SocialAutomationSubTab[]).map((id) => (
          <button
            key={id}
            type="button"
            onClick={() => setSubTab(id)}
            className={`px-4 py-3 text-sm font-semibold border-b-2 -mb-px transition-colors ${
              subTab === id ? 'border-slate-950 text-slate-950' : 'border-transparent text-slate-500 hover:text-slate-800'
            }`}
          >
            {id === 'post_format' ? 'Post Format' : id === 'logs' ? 'Logs' : id[0].toUpperCase() + id.slice(1)}
          </button>
        ))}
      </div>

      {error && (
        <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{error}</div>
      )}

      {!postId && (
        <div className="rounded-2xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-800">
          Select/Create a post first to enable to proceed.
        </div>
      )}

      {subTab === 'connections' && (
        <div className="grid gap-6 lg:grid-cols-2">
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-bold text-slate-900">Connected Accounts</h3>
              <button
                type="button"
                onClick={() => void loadAccounts()}
                disabled={loadingAccounts}
                className="inline-flex items-center gap-1 rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-xs font-bold text-slate-700 hover:bg-slate-50 disabled:opacity-60"
              >
                {loadingAccounts ? <Loader2 size={12} className="animate-spin" /> : <RefreshCw size={12} />}
                Refresh
              </button>
            </div>

            <div className="rounded-2xl border border-slate-200 bg-white p-4">
              <div className="flex items-start justify-between gap-4">
                <div className="flex items-start gap-3 min-w-0">
                  <div className="h-11 w-11 rounded-2xl border border-slate-200 bg-slate-50 overflow-hidden flex items-center justify-center shrink-0">
                    {facebookProfile.avatar
                      ? <img src={facebookProfile.avatar} alt="" className="h-full w-full object-cover" />
                      : <span className="text-sm font-black text-slate-600">f</span>
                    }
                  </div>
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <div className="truncate text-sm font-black text-slate-900">{facebookProfile.name}</div>
                      <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[11px] font-bold text-slate-600">Facebook</span>
                      <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[11px] font-bold text-slate-600">Profile</span>
                    </div>
                    <div className="mt-1 text-xs text-slate-500">
                      {facebookAccount ? 'Connected' : 'Not connected'}
                    </div>
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => setFacebookEnabled(!settings.platforms.facebook.enabled)}
                  className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${
                    settings.platforms.facebook.enabled ? 'bg-emerald-500' : 'bg-slate-200'
                  }`}
                  disabled={!facebookAccount}
                  title={facebookAccount ? 'Enable/disable for this post' : 'Connect Facebook first'}
                >
                  <span className={`inline-block h-5 w-5 transform rounded-full bg-white transition-transform ${
                    settings.platforms.facebook.enabled ? 'translate-x-5' : 'translate-x-1'
                  }`} />
                </button>
              </div>

              <div className="mt-4 flex items-center justify-between gap-2">
                <div className="text-xs text-slate-500 min-w-0 truncate">
                  Destination: <span className="font-semibold text-slate-700">{destinationLabel}</span>
                </div>
                {facebookAccount && (
                  <button
                    type="button"
                    onClick={() => setSubTab('scheduling')}
                    className="inline-flex items-center gap-1 rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-xs font-bold text-slate-700 hover:bg-slate-50"
                  >
                    <Pencil size={12} /> Edit
                  </button>
                )}
                {facebookAccount && (
                  <button
                    type="button"
                    onClick={() => void disconnectFacebook()}
                    className="inline-flex items-center gap-1 rounded-lg border border-red-200 bg-white px-2.5 py-1.5 text-xs font-bold text-red-600 hover:bg-red-50"
                  >
                    <Trash2 size={12} /> Delete
                  </button>
                )}
              </div>
            </div>

            {facebookAccount && (
              <div className="rounded-2xl border border-slate-200 bg-white p-4">
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <div className="text-sm font-bold text-slate-900">Destination</div>
                    <div className="text-xs text-slate-500 mt-0.5">Choose whether to post to a Page or your Profile.</div>
                  </div>
                  <button
                    type="button"
                    onClick={() => void loadFacebookTargets()}
                    className="inline-flex items-center gap-1 rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-xs font-bold text-slate-700 hover:bg-slate-50"
                  >
                    <RefreshCw size={12} /> Refresh
                  </button>
                </div>

                <div className="mt-3">
                  <label className="block text-[11px] font-bold text-slate-500 mb-1.5">Post to</label>
                  <select
                    value={settings.platforms.facebook.destination.type === 'profile' ? 'profile' : 'page'}
                    onChange={(e) => {
                      const nextType = e.target.value === 'profile' ? 'profile' : 'page';
                      if (nextType === 'profile') {
                        setFacebookDestination({ type: 'profile', id: facebookProfile.id || '', name: facebookProfile.name });
                        return;
                      }
                      const cur = settings.platforms.facebook.destination;
                      if (cur.type === 'page' && String(cur.id || '').trim()) return;
                      const first = facebookTargets.pages[0];
                      setFacebookDestination({ type: 'page', id: first?.id || '', name: first?.name || '' });
                    }}
                    className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-sm font-semibold text-slate-800 outline-none focus:border-slate-400"
                  >
                    <option value="page">Facebook Page</option>
                    <option value="profile">Facebook Profile</option>
                  </select>
                </div>

                {facebookTargets.loading && (
                  <div className="flex items-center gap-2 py-3 text-xs text-slate-500">
                    <Loader2 size={14} className="animate-spin text-slate-300" /> Loading...
                  </div>
                )}
                {facebookTargets.error && (
                  <div className="flex items-center gap-2 py-3 text-xs text-red-600">
                    <AlertCircle size={14} /> {facebookTargets.error}
                  </div>
                )}

                {!facebookTargets.loading && !facebookTargets.error && (
                  <div className="mt-3 space-y-2">
                    {settings.platforms.facebook.destination.type === 'profile' && (
                      <div className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-600">
                        Will attempt to publish to your Facebook Profile. If Facebook blocks profile publishing for your app, this will fail and be logged.
                      </div>
                    )}
                    {settings.platforms.facebook.destination.type !== 'profile' && (
                      <>
                        {facebookTargets.pages.length === 0 && (
                          <div className="text-xs text-slate-400">No Pages available for this account.</div>
                        )}
                        {facebookTargets.pages.map((t) => {
                          const active = (settings.platforms.facebook.destination.type === 'page' && (settings.platforms.facebook.destination as any).id === t.id);
                          return (
                            <button
                              key={`page:${t.id}`}
                              type="button"
                              onClick={() => setFacebookDestination({ type: 'page', id: t.id, name: t.name })}
                              className={`w-full flex items-center justify-between gap-3 rounded-xl border px-3 py-2 text-left transition ${
                                active ? 'border-emerald-200 bg-emerald-50' : 'border-slate-200 bg-white hover:bg-slate-50'
                              }`}
                            >
                              <div className="min-w-0">
                                <div className="truncate text-sm font-semibold text-slate-900">{t.name}</div>
                                <div className="text-xs text-slate-500">Page</div>
                              </div>
                              <div className={`h-5 w-5 rounded-full border flex items-center justify-center ${active ? 'border-emerald-400 bg-emerald-500 text-white' : 'border-slate-300 text-transparent'}`}>
                                <Check size={12} />
                              </div>
                            </button>
                          );
                        })}
                      </>
                    )}
                  </div>
                )}
              </div>
            )}
          </div>

          <div className="space-y-4">
            <h3 className="text-sm font-bold text-slate-900">Add Connection</h3>
            <div className="rounded-2xl border border-slate-200 bg-white p-4">
              <div className="flex items-start justify-between gap-4">
                <div>
                  <div className="text-sm font-black text-slate-900">Facebook</div>
                  <div className="text-sm text-slate-500 mt-1">Connect via Facebook Login (Graph API).</div>
                </div>
                <button
                  type="button"
                  onClick={() => void beginFacebookOAuth()}
                  disabled={connecting || !postId}
                  className="inline-flex items-center gap-2 rounded-xl bg-slate-950 px-4 py-2 text-sm font-bold text-white hover:bg-slate-800 disabled:opacity-60"
                >
                  {connecting ? <Loader2 size={16} className="animate-spin" /> : <Plus size={16} />}
                  Connect
                </button>
              </div>
              <div className="mt-3 text-xs text-slate-400">
                You’ll be redirected to Facebook for authorization.
              </div>
            </div>
          </div>
        </div>
      )}

      {subTab === 'post_format' && (
        <div className="grid gap-6 lg:grid-cols-[1fr_360px]">
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-bold text-slate-900">Post Template</h3>
              <button
                type="button"
                onClick={() => setTemplate(DEFAULT_SOCIAL_AUTOMATION_TEMPLATE)}
                className="inline-flex items-center gap-1 rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-xs font-bold text-slate-700 hover:bg-slate-50"
              >
                Reset
              </button>
            </div>
            <textarea
              rows={10}
              value={settings.postFormat.template}
              onChange={(e) => setTemplate(e.target.value)}
              className="w-full rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm text-slate-900 outline-none focus:border-slate-400"
              placeholder={DEFAULT_SOCIAL_AUTOMATION_TEMPLATE}
            />
            <div className="text-xs text-slate-500">
              Tip: Use variables like <span className="font-semibold text-slate-700">{'{title}'}</span> and <span className="font-semibold text-slate-700">{'{url}'}</span>.
            </div>
          </div>

          <div className="rounded-2xl border border-slate-200 bg-white p-4">
            <div className="text-sm font-bold text-slate-900">Supported Template Variables</div>
            <div className="mt-3 space-y-2 text-sm">
              {([
                ['{title}', 'post title'],
                ['{excerpt}', 'short description'],
                ['{url}', 'post link'],
                ['{featured_image}', 'post image'],
                ['{author}', 'author name'],
              ] as Array<[string, string]>).map(([v, d]) => (
                <div key={v} className="flex items-center justify-between gap-2 rounded-xl border border-slate-200 bg-slate-50 px-3 py-2">
                  <code className="text-xs font-bold text-slate-700">{v}</code>
                  <span className="text-xs text-slate-500">{d}</span>
                </div>
              ))}
            </div>
            <div className="mt-4 rounded-xl border border-slate-200 bg-white p-3">
              <div className="text-xs font-bold text-slate-600 uppercase tracking-wide">Preview Text</div>
              <pre className="mt-2 whitespace-pre-wrap text-xs text-slate-700 leading-relaxed">{clampText(renderedText, 1200)}</pre>
            </div>
          </div>
        </div>
      )}

      {subTab === 'scheduling' && (
        <div className="rounded-2xl border border-slate-200 bg-white p-5 space-y-4">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-bold text-slate-900">Scheduling</h3>
            <div className="text-xs text-slate-500">
              Mode: <span className="font-semibold text-slate-700">{settings.scheduling.mode}</span>
            </div>
          </div>

          <div className="grid gap-3 sm:grid-cols-3">
            {([
              { id: 'immediate', label: 'Post Immediately' },
              { id: 'schedule', label: 'Schedule Post' },
              { id: 'delay', label: 'Delay Post' },
            ] as Array<{ id: SocialAutomationSettings['scheduling']['mode']; label: string }>).map((o) => (
              <button
                key={o.id}
                type="button"
                onClick={() => setScheduling({ mode: o.id })}
                className={`rounded-2xl border px-4 py-3 text-left transition ${
                  settings.scheduling.mode === o.id ? 'border-slate-950 bg-slate-950 text-white' : 'border-slate-200 bg-white text-slate-700 hover:bg-slate-50'
                }`}
              >
                <div className="text-sm font-black">{o.label}</div>
              </button>
            ))}
          </div>

          {settings.scheduling.mode === 'schedule' && (
            <div className="grid gap-4 sm:grid-cols-3">
              <div>
                <label className="block text-xs font-semibold text-slate-500 mb-1.5">Date</label>
                <input
                  type="date"
                  value={settings.scheduling.scheduledFor ? new Date(settings.scheduling.scheduledFor).toISOString().slice(0, 10) : ''}
                  onChange={(e) => {
                    const cur = settings.scheduling.scheduledFor ? new Date(settings.scheduling.scheduledFor) : new Date();
                    const [y, m, d] = e.target.value.split('-').map((x) => Number(x));
                    if (!y || !m || !d) return;
                    cur.setUTCFullYear(y, m - 1, d);
                    setScheduling({ scheduledFor: cur.toISOString() });
                  }}
                  className="w-full rounded-xl border border-slate-200 bg-slate-50 px-3 py-2.5 text-sm outline-none focus:border-slate-400"
                />
              </div>
              <div>
                <label className="block text-xs font-semibold text-slate-500 mb-1.5">Time (UTC)</label>
                <input
                  type="time"
                  value={settings.scheduling.scheduledFor ? new Date(settings.scheduling.scheduledFor).toISOString().slice(11, 16) : ''}
                  onChange={(e) => {
                    const cur = settings.scheduling.scheduledFor ? new Date(settings.scheduling.scheduledFor) : new Date();
                    const [hh, mm] = e.target.value.split(':').map((x) => Number(x));
                    if (Number.isNaN(hh) || Number.isNaN(mm)) return;
                    cur.setUTCHours(hh, mm, 0, 0);
                    setScheduling({ scheduledFor: cur.toISOString() });
                  }}
                  className="w-full rounded-xl border border-slate-200 bg-slate-50 px-3 py-2.5 text-sm outline-none focus:border-slate-400"
                />
              </div>
              <div>
                <label className="block text-xs font-semibold text-slate-500 mb-1.5">Timezone</label>
                <input
                  type="text"
                  value={settings.scheduling.timezone || ''}
                  onChange={(e) => setScheduling({ timezone: e.target.value })}
                  className="w-full rounded-xl border border-slate-200 bg-slate-50 px-3 py-2.5 text-sm outline-none focus:border-slate-400"
                />
              </div>
            </div>
          )}

          {settings.scheduling.mode === 'delay' && (
            <div className="max-w-sm">
              <label className="block text-xs font-semibold text-slate-500 mb-1.5">Delay (minutes)</label>
              <input
                type="number"
                min={1}
                value={settings.scheduling.delayMinutes ?? 10}
                onChange={(e) => setScheduling({ delayMinutes: Number(e.target.value) || 10 })}
                className="w-full rounded-xl border border-slate-200 bg-slate-50 px-3 py-2.5 text-sm outline-none focus:border-slate-400"
              />
            </div>
          )}

          <div className="rounded-xl border border-slate-200 bg-slate-50 p-3 text-xs text-slate-600">
            When you publish the blog post, Social Automation will queue a Facebook post based on these settings.
          </div>
        </div>
      )}

      {subTab === 'preview' && (
        <div className="grid gap-6 lg:grid-cols-[1fr_420px]">
          <div className="rounded-2xl border border-slate-200 bg-white p-5">
            <div className="text-sm font-bold text-slate-900 mb-3">Post Text</div>
            <pre className="whitespace-pre-wrap text-sm text-slate-800 leading-relaxed">{renderedText || '—'}</pre>
          </div>

          <div className="rounded-2xl border border-slate-200 bg-white overflow-hidden">
            <div className="p-4 border-b border-slate-100 flex items-center gap-3">
              <div className="h-10 w-10 rounded-full bg-slate-200 overflow-hidden flex items-center justify-center">
                {facebookProfile.avatar ? <img src={facebookProfile.avatar} className="h-full w-full object-cover" alt="" /> : <span className="text-xs font-black text-slate-600">FB</span>}
              </div>
              <div className="min-w-0">
                <div className="truncate text-sm font-black text-slate-900">{facebookProfile.name}</div>
                <div className="text-xs text-slate-500">Facebook • Preview</div>
              </div>
            </div>
            <div className="p-4 space-y-3">
              <div className="text-sm text-slate-800 whitespace-pre-wrap leading-relaxed">{clampText(renderedText, 560)}</div>
              <div className="rounded-xl border border-slate-200 overflow-hidden">
                {featuredImage && (
                  <div className="bg-slate-100">
                    <img src={featuredImage} alt="" className="h-48 w-full object-cover" />
                  </div>
                )}
                <div className="p-3">
                  <div className="text-xs uppercase tracking-wide text-slate-400">{(new URL(postUrl, window.location.origin)).hostname}</div>
                  <div className="mt-1 text-sm font-bold text-slate-900">{postTitle || '(Untitled)'}</div>
                  <div className="mt-1 text-xs text-slate-500">{clampText(postExcerpt || '', 140) || '—'}</div>
                  <div className="mt-2 inline-flex items-center gap-1 text-xs font-bold text-slate-700">
                    {postUrl}
                    <ExternalLink size={12} className="text-slate-400" />
                  </div>
                </div>
              </div>
              <div className="text-xs text-slate-500">
                Destination: <span className="font-semibold text-slate-700">{destinationLabel}</span>
              </div>
            </div>
          </div>
        </div>
      )}

      {subTab === 'logs' && (
        <div className="rounded-2xl border border-slate-200 bg-white overflow-hidden">
          <div className="flex items-center justify-between px-5 py-4 border-b border-slate-100">
            <div>
              <div className="text-sm font-bold text-slate-900">Posting History</div>
              <div className="text-xs text-slate-500 mt-0.5">Per-post logs (Facebook only).</div>
            </div>
            <button
              type="button"
              onClick={() => void refreshLogs()}
              disabled={loadingLogs || !postId}
              className="inline-flex items-center gap-1 rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-xs font-bold text-slate-700 hover:bg-slate-50 disabled:opacity-60"
            >
              {loadingLogs ? <Loader2 size={12} className="animate-spin" /> : <RefreshCw size={12} />}
              Refresh
            </button>
          </div>

          <div className="hidden sm:grid grid-cols-[auto_1fr_1fr_1fr_2fr] gap-4 px-5 py-3 text-xs font-semibold uppercase tracking-wide text-slate-500 bg-slate-50">
            <span>Date</span>
            <span>Platform</span>
            <span>Account</span>
            <span>Status</span>
            <span>Response</span>
          </div>
          <div className="divide-y divide-slate-100">
            {loadingLogs && (
              <div className="flex items-center justify-center py-10"><Loader2 className="animate-spin text-slate-300" size={22} /></div>
            )}
            {!loadingLogs && logs.length === 0 && (
              <div className="px-5 py-10 text-center text-sm text-slate-400">No logs yet.</div>
            )}
            {!loadingLogs && logs.map((l: any) => (
              <div key={l.id} className="px-5 py-4 grid gap-2 sm:grid-cols-[auto_1fr_1fr_1fr_2fr] items-start sm:items-center">
                <div className="text-xs text-slate-500 whitespace-nowrap">{new Date(l.scheduled_for || l.created_at).toLocaleString()}</div>
                <div className="text-xs font-semibold text-slate-700 capitalize">facebook</div>
                <div className="text-xs text-slate-600">{l.account || '—'}</div>
                <div className="text-xs font-semibold text-slate-700">{String(l.status)}</div>
                <div className="text-xs text-slate-500">
                  {l.error_message ? <span className="text-red-600">{clampText(l.error_message, 200)}</span> : (l.platform_post_id ? `Post ID: ${l.platform_post_id}` : '—')}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
