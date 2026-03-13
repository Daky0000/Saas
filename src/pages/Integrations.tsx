import { useCallback, useEffect, useMemo, useState } from 'react';
import { CheckCircle, ExternalLink, Loader2, Plug, Settings2, Unplug } from 'lucide-react';
import { integrationService, type IntegrationCatalogItem } from '../services/integrationService';
import { wordpressService } from '../services/wordpressService';

type Props = {
  onNavigateSettings?: () => void;
};

type ModalState =
  | { type: 'none' }
  | { type: 'wordpress' }
  | { type: 'facebook-pages' }
  | { type: 'instagram' }
  | { type: 'pinterest' }
  | { type: 'mailchimp' };

const PLATFORM_BADGE: Record<string, { bg: string; text: string }> = {
  connected: { bg: 'bg-emerald-50', text: 'text-emerald-700' },
  disconnected: { bg: 'bg-slate-100', text: 'text-slate-600' },
  disabled: { bg: 'bg-amber-50', text: 'text-amber-700' },
};

function Card({
  title,
  description,
  statusLabel,
  statusTone,
  disabledReason,
  children,
}: {
  title: string;
  description: string;
  statusLabel: string;
  statusTone: keyof typeof PLATFORM_BADGE;
  disabledReason?: string | null;
  children: React.ReactNode;
}) {
  const badge = PLATFORM_BADGE[statusTone];
  return (
    <div className="rounded-[20px] border border-slate-200 bg-white p-5 shadow-sm">
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <div className="text-base font-black text-slate-950">{title}</div>
            <span className={`rounded-full px-2.5 py-1 text-[11px] font-semibold ${badge.bg} ${badge.text}`}>{statusLabel}</span>
          </div>
          <p className="mt-2 text-sm leading-6 text-slate-500">{description}</p>
          {disabledReason ? <p className="mt-2 text-xs text-amber-700">{disabledReason}</p> : null}
        </div>
      </div>
      <div className="mt-4 flex flex-wrap gap-2">{children}</div>
    </div>
  );
}

export default function Integrations({ onNavigateSettings }: Props) {
  const [loading, setLoading] = useState(true);
  const [items, setItems] = useState<IntegrationCatalogItem[]>([]);
  const [error, setError] = useState<string | null>(null);

  const [modal, setModal] = useState<ModalState>({ type: 'none' });

  const [busy, setBusy] = useState<string | null>(null);

  // WordPress form
  const [wpSiteUrl, setWpSiteUrl] = useState('');
  const [wpUsername, setWpUsername] = useState('');
  const [wpAppPassword, setWpAppPassword] = useState('');

  // Facebook pages
  const [fbPages, setFbPages] = useState<Array<{ id: string; name: string; picture?: string | null }>>([]);
  const [fbLoading, setFbLoading] = useState(false);

  // Instagram targets
  const [igTargets, setIgTargets] = useState<Array<{ pageId: string; pageName: string; instagramId: string | null; instagramUsername: string | null }>>([]);
  const [igLoading, setIgLoading] = useState(false);

  // Pinterest boards
  const [pinBoards, setPinBoards] = useState<Array<{ id: string; name: string }>>([]);
  const [pinLoading, setPinLoading] = useState(false);

  // Mailchimp
  const [mcApiKey, setMcApiKey] = useState('');
  const [mcServerPrefix, setMcServerPrefix] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await integrationService.getCatalog();
      if (!res.success) throw new Error(res.error || 'Failed to load integrations');
      setItems(res.integrations || []);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load integrations');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const cms = useMemo(() => items.filter((i) => i.type === 'cms'), [items]);
  const social = useMemo(() => items.filter((i) => i.type === 'social'), [items]);
  const marketing = useMemo(() => items.filter((i) => i.type === 'marketing'), [items]);

  const startOAuth = async (slug: string) => {
    setBusy(slug);
    try {
      const res = await integrationService.startOAuth(slug, '/integrations');
      if (!res.success) throw new Error(res.error || 'OAuth failed');
    } catch (e) {
      alert(e instanceof Error ? e.message : 'OAuth failed');
      setBusy(null);
    }
  };

  const disconnectOAuth = async (slug: string) => {
    if (!confirm(`Disconnect ${slug}?`)) return;
    setBusy(slug);
    try {
      const res = await integrationService.disconnectOAuth(slug);
      if (!res.success) throw new Error(res.error || 'Failed to disconnect');
      await load();
    } catch (e) {
      alert(e instanceof Error ? e.message : 'Failed to disconnect');
    } finally {
      setBusy(null);
    }
  };

  const openFacebookPages = async () => {
    setModal({ type: 'facebook-pages' });
    setFbLoading(true);
    try {
      const res = await integrationService.listFacebookPages();
      if (!res.success) throw new Error(res.error || 'Failed to load pages');
      setFbPages(res.pages || []);
    } catch (e) {
      alert(e instanceof Error ? e.message : 'Failed to load pages');
      setFbPages([]);
    } finally {
      setFbLoading(false);
    }
  };

  const openInstagramTargets = async () => {
    setModal({ type: 'instagram' });
    setIgLoading(true);
    try {
      const res = await integrationService.listInstagramTargets();
      if (!res.success) throw new Error(res.error || 'Failed to load Instagram targets');
      setIgTargets(res.targets || []);
    } catch (e) {
      alert(e instanceof Error ? e.message : 'Failed to load Instagram targets');
      setIgTargets([]);
    } finally {
      setIgLoading(false);
    }
  };

  const openPinterestBoards = async () => {
    setModal({ type: 'pinterest' });
    setPinLoading(true);
    try {
      const res = await integrationService.listPinterestBoards();
      if (!res.success) throw new Error(res.error || 'Failed to load boards');
      setPinBoards(res.boards || []);
    } catch (e) {
      alert(e instanceof Error ? e.message : 'Failed to load boards');
      setPinBoards([]);
    } finally {
      setPinLoading(false);
    }
  };

  const connectWordPress = async () => {
    setBusy('wordpress');
    try {
      const res = await wordpressService.connect({
        siteUrl: wpSiteUrl,
        username: wpUsername,
        applicationPassword: wpAppPassword,
      });
      if (!res.success) throw new Error(res.error || 'WordPress connection failed');
      await load();
      setModal({ type: 'none' });
      setWpAppPassword('');
    } catch (e) {
      alert(e instanceof Error ? e.message : 'WordPress connection failed');
    } finally {
      setBusy(null);
    }
  };

  const disconnectWordPress = async () => {
    if (!confirm('Disconnect WordPress?')) return;
    setBusy('wordpress');
    try {
      const res = await wordpressService.disconnect();
      if (!res.success) throw new Error(res.error || 'Failed to disconnect WordPress');
      await load();
    } catch (e) {
      alert(e instanceof Error ? e.message : 'Failed to disconnect WordPress');
    } finally {
      setBusy(null);
    }
  };

  const renderActions = (item: IntegrationCatalogItem) => {
    const slug = item.slug;
    const isOauth = ['facebook', 'linkedin', 'twitter', 'pinterest'].includes(slug);

    const disabledReason = !item.adminEnabled
      ? 'Disabled by admin.'
      : !item.configured && isOauth
        ? 'Not configured by admin (missing client credentials / redirect URL).'
        : null;

    const canConnect = item.adminEnabled && (item.configured || !isOauth);

    if (slug === 'wordpress') {
      return (
        <Card
          title={item.name}
          description="Connect your WordPress site using Application Passwords. Publish, update, import posts and sync categories/tags."
          statusLabel={item.connected ? 'Connected' : 'Disconnected'}
          statusTone={item.connected ? 'connected' : 'disconnected'}
        >
          {!item.connected ? (
            <button
              type="button"
              onClick={() => setModal({ type: 'wordpress' })}
              className="inline-flex items-center gap-2 rounded-xl bg-slate-950 px-4 py-2.5 text-sm font-bold text-white hover:bg-slate-800"
            >
              <Plug size={16} /> Connect
            </button>
          ) : (
            <>
              <button
                type="button"
                onClick={disconnectWordPress}
                disabled={busy === 'wordpress'}
                className="inline-flex items-center gap-2 rounded-xl border border-slate-200 bg-white px-4 py-2.5 text-sm font-bold text-slate-700 hover:bg-slate-50 disabled:opacity-60"
              >
                {busy === 'wordpress' ? <Loader2 size={16} className="animate-spin" /> : <Unplug size={16} />} Disconnect
              </button>
              <button
                type="button"
                onClick={() => setModal({ type: 'wordpress' })}
                className="inline-flex items-center gap-2 rounded-xl border border-slate-200 bg-white px-4 py-2.5 text-sm font-bold text-slate-700 hover:bg-slate-50"
              >
                <Settings2 size={16} /> Settings
              </button>
            </>
          )}
        </Card>
      );
    }

    if (slug === 'mailchimp') {
      return (
        <Card
          title={item.name}
          description="Connect Mailchimp using an API key + server prefix (e.g. us19)."
          statusLabel={item.connected ? 'Connected' : 'Disconnected'}
          statusTone={item.connected ? 'connected' : 'disconnected'}
        >
          {!item.connected ? (
            <button
              type="button"
              onClick={() => setModal({ type: 'mailchimp' })}
              className="inline-flex items-center gap-2 rounded-xl bg-slate-950 px-4 py-2.5 text-sm font-bold text-white hover:bg-slate-800"
            >
              <Plug size={16} /> Connect
            </button>
          ) : (
            <button
              type="button"
              onClick={async () => {
                if (!confirm('Disconnect Mailchimp?')) return;
                setBusy('mailchimp');
                try {
                  const res = await integrationService.disconnectMailchimp();
                  if (!res.success) throw new Error(res.error || 'Failed to disconnect');
                  await load();
                } catch (e) {
                  alert(e instanceof Error ? e.message : 'Failed to disconnect');
                } finally {
                  setBusy(null);
                }
              }}
              disabled={busy === 'mailchimp'}
              className="inline-flex items-center gap-2 rounded-xl border border-slate-200 bg-white px-4 py-2.5 text-sm font-bold text-slate-700 hover:bg-slate-50 disabled:opacity-60"
            >
              {busy === 'mailchimp' ? <Loader2 size={16} className="animate-spin" /> : <Unplug size={16} />} Disconnect
            </button>
          )}
        </Card>
      );
    }

    const statusTone: keyof typeof PLATFORM_BADGE =
      disabledReason ? 'disabled' : item.connected ? 'connected' : 'disconnected';

    const connectLabel = item.connected ? 'Reconnect' : 'Connect';

    return (
      <Card
        title={item.name}
        description={
          slug === 'facebook'
            ? 'Connect Facebook to publish to your profile or Pages. Save a Page token for automated posting.'
            : slug === 'instagram'
              ? 'Publish images via Instagram Graph API (Business/Creator account linked to a Facebook Page).'
              : slug === 'linkedin'
                ? 'Publish posts and retrieve analytics via LinkedIn.'
                : slug === 'twitter'
                  ? 'Publish tweets with X API v2 (supports token refresh).'
                  : slug === 'pinterest'
                    ? 'Create Pins on selected boards using the Pinterest API.'
                    : 'Connect using OAuth.'
        }
        statusLabel={disabledReason ? 'Admin disabled' : item.connected ? 'Connected' : 'Disconnected'}
        statusTone={statusTone}
        disabledReason={disabledReason}
      >
        {slug === 'instagram' ? (
          <>
            <button
              type="button"
              onClick={() => void openInstagramTargets()}
              disabled={!items.find((i) => i.slug === 'facebook')?.connected}
              className="inline-flex items-center gap-2 rounded-xl bg-slate-950 px-4 py-2.5 text-sm font-bold text-white hover:bg-slate-800 disabled:opacity-60"
              title={!items.find((i) => i.slug === 'facebook')?.connected ? 'Connect Facebook first' : ''}
            >
              <Plug size={16} /> Connect
            </button>
            {item.connected ? (
              <button
                type="button"
                onClick={() => void disconnectOAuth('instagram')}
                disabled={busy === 'instagram'}
                className="inline-flex items-center gap-2 rounded-xl border border-slate-200 bg-white px-4 py-2.5 text-sm font-bold text-slate-700 hover:bg-slate-50 disabled:opacity-60"
              >
                {busy === 'instagram' ? <Loader2 size={16} className="animate-spin" /> : <Unplug size={16} />} Disconnect
              </button>
            ) : null}
          </>
        ) : (
          <>
            <button
              type="button"
              onClick={() => void startOAuth(slug)}
              disabled={!canConnect || busy === slug}
              className="inline-flex items-center gap-2 rounded-xl bg-slate-950 px-4 py-2.5 text-sm font-bold text-white hover:bg-slate-800 disabled:opacity-60"
            >
              {busy === slug ? <Loader2 size={16} className="animate-spin" /> : <Plug size={16} />} {connectLabel}
            </button>

            {item.connected ? (
              <button
                type="button"
                onClick={() => void disconnectOAuth(slug)}
                disabled={busy === slug}
                className="inline-flex items-center gap-2 rounded-xl border border-slate-200 bg-white px-4 py-2.5 text-sm font-bold text-slate-700 hover:bg-slate-50 disabled:opacity-60"
              >
                {busy === slug ? <Loader2 size={16} className="animate-spin" /> : <Unplug size={16} />} Disconnect
              </button>
            ) : null}
          </>
        )}

        {slug === 'facebook' ? (
          <button
            type="button"
            onClick={() => void openFacebookPages()}
            disabled={!item.connected}
            className="inline-flex items-center gap-2 rounded-xl border border-slate-200 bg-white px-4 py-2.5 text-sm font-bold text-slate-700 hover:bg-slate-50 disabled:opacity-60"
            title={!item.connected ? 'Connect Facebook first' : ''}
          >
            <Settings2 size={16} /> Manage
          </button>
        ) : null}

        {slug === 'pinterest' ? (
          <button
            type="button"
            onClick={() => void openPinterestBoards()}
            disabled={!item.connected}
            className="inline-flex items-center gap-2 rounded-xl border border-slate-200 bg-white px-4 py-2.5 text-sm font-bold text-slate-700 hover:bg-slate-50 disabled:opacity-60"
            title={!item.connected ? 'Connect Pinterest first' : ''}
          >
            <Settings2 size={16} /> Manage
          </button>
        ) : null}
      </Card>
    );
  };

  return (
    <div className="space-y-6">
      <div className="rounded-[24px] border border-slate-200 bg-white px-6 py-6">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h2 className="text-2xl font-black tracking-[-0.03em] text-slate-950">Integrations</h2>
            <p className="mt-1 text-sm text-slate-500">
              Connect external services using official APIs and OAuth. Admins control developer credentials; you connect your accounts.
            </p>
          </div>
          {onNavigateSettings ? (
            <button
              type="button"
              onClick={onNavigateSettings}
              className="inline-flex items-center justify-center gap-2 rounded-xl border border-slate-200 bg-white px-4 py-2.5 text-sm font-semibold text-slate-700 hover:bg-slate-50"
            >
              <ExternalLink size={16} /> Admin settings
            </button>
          ) : null}
        </div>
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-16">
          <Loader2 size={28} className="animate-spin text-slate-400" />
        </div>
      ) : error ? (
        <div className="rounded-2xl border border-red-200 bg-red-50 p-5 text-sm text-red-700">{error}</div>
      ) : (
        <>
          <section className="space-y-3">
            <div className="text-sm font-black text-slate-900">CMS Platforms</div>
            <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">{cms.map(renderActions)}</div>
          </section>

          <section className="space-y-3">
            <div className="text-sm font-black text-slate-900">Social Media Platforms</div>
            <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">{social.map(renderActions)}</div>
          </section>

          <section className="space-y-3">
            <div className="text-sm font-black text-slate-900">Marketing Platforms</div>
            <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
              {marketing.length ? marketing.map(renderActions) : <div className="text-sm text-slate-400">No marketing integrations enabled.</div>}
            </div>
          </section>

          <div className="rounded-2xl border border-slate-200 bg-white p-5">
            <div className="flex items-center gap-2 text-sm font-bold text-slate-900">
              <CheckCircle size={16} className="text-emerald-600" />
              Tip
            </div>
            <p className="mt-2 text-sm text-slate-500">
              For automated publishing, connect a platform and then publish from Posts → Distribution.
            </p>
          </div>
        </>
      )}

      {/* Modal shell */}
      {modal.type !== 'none' ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/40 px-4 py-10">
          <div className="w-full max-w-2xl rounded-[24px] bg-white shadow-2xl">
            <div className="flex items-center justify-between border-b border-slate-100 px-6 py-4">
              <div className="text-sm font-black text-slate-900">
                {modal.type === 'wordpress'
                  ? 'WordPress settings'
                  : modal.type === 'facebook-pages'
                    ? 'Facebook Pages'
                    : modal.type === 'instagram'
                      ? 'Instagram (Business accounts)'
                      : modal.type === 'pinterest'
                        ? 'Pinterest boards'
                        : 'Mailchimp'}
              </div>
              <button
                type="button"
                onClick={() => setModal({ type: 'none' })}
                className="rounded-xl border border-slate-200 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-50"
              >
                Close
              </button>
            </div>

            <div className="px-6 py-5">
              {modal.type === 'wordpress' ? (
                <div className="space-y-4">
                  <div className="grid gap-3 sm:grid-cols-2">
                    <div className="sm:col-span-2">
                      <label className="text-xs font-semibold text-slate-600">Website URL</label>
                      <input
                        value={wpSiteUrl}
                        onChange={(e) => setWpSiteUrl(e.target.value)}
                        placeholder="https://example.com"
                        className="mt-1 w-full rounded-xl border border-slate-200 bg-slate-50 px-4 py-2.5 text-sm outline-none focus:border-slate-400"
                      />
                    </div>
                    <div>
                      <label className="text-xs font-semibold text-slate-600">Username</label>
                      <input
                        value={wpUsername}
                        onChange={(e) => setWpUsername(e.target.value)}
                        placeholder="admin"
                        className="mt-1 w-full rounded-xl border border-slate-200 bg-slate-50 px-4 py-2.5 text-sm outline-none focus:border-slate-400"
                      />
                    </div>
                    <div>
                      <label className="text-xs font-semibold text-slate-600">Application Password</label>
                      <input
                        value={wpAppPassword}
                        onChange={(e) => setWpAppPassword(e.target.value)}
                        placeholder="xxxx xxxx xxxx xxxx xxxx xxxx"
                        className="mt-1 w-full rounded-xl border border-slate-200 bg-slate-50 px-4 py-2.5 text-sm outline-none focus:border-slate-400"
                      />
                    </div>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <button
                      type="button"
                      onClick={() => void connectWordPress()}
                      disabled={busy === 'wordpress' || !wpSiteUrl.trim() || !wpUsername.trim() || !wpAppPassword.trim()}
                      className="inline-flex items-center gap-2 rounded-xl bg-slate-950 px-4 py-2.5 text-sm font-bold text-white hover:bg-slate-800 disabled:opacity-60"
                    >
                      {busy === 'wordpress' ? <Loader2 size={16} className="animate-spin" /> : <Plug size={16} />} Save & Verify
                    </button>
                    <button
                      type="button"
                      onClick={() => void disconnectWordPress()}
                      className="inline-flex items-center gap-2 rounded-xl border border-slate-200 bg-white px-4 py-2.5 text-sm font-bold text-slate-700 hover:bg-slate-50"
                    >
                      <Unplug size={16} /> Disconnect
                    </button>
                  </div>
                  <p className="text-xs text-slate-500">
                    Create an Application Password in WordPress: Users → Profile → Application Passwords.
                  </p>
                </div>
              ) : null}

              {modal.type === 'facebook-pages' ? (
                <div className="space-y-3">
                  {fbLoading ? (
                    <div className="flex items-center justify-center py-10">
                      <Loader2 size={22} className="animate-spin text-slate-400" />
                    </div>
                  ) : fbPages.length === 0 ? (
                    <div className="text-sm text-slate-500">No Pages found. Make sure you have Pages and the app has `pages_show_list` permission.</div>
                  ) : (
                    <div className="grid gap-2">
                      {fbPages.map((p) => (
                        <button
                          key={p.id}
                          type="button"
                          onClick={async () => {
                            setBusy(`fb-page-${p.id}`);
                            try {
                              const res = await integrationService.saveSocialTarget({
                                platform: 'facebook',
                                account_type: 'page',
                                account_id: p.id,
                                account_name: p.name,
                              });
                              if (!res.success) throw new Error(res.error || 'Failed to save Page');
                              alert('Page saved. Automated posting will use this Page token when selected.');
                              await load();
                              setModal({ type: 'none' });
                            } catch (e) {
                              alert(e instanceof Error ? e.message : 'Failed to save Page');
                            } finally {
                              setBusy(null);
                            }
                          }}
                          className="flex items-center justify-between gap-3 rounded-2xl border border-slate-200 bg-white px-4 py-3 text-left hover:bg-slate-50"
                        >
                          <div className="min-w-0">
                            <div className="truncate text-sm font-semibold text-slate-900">{p.name}</div>
                            <div className="text-xs text-slate-500">{p.id}</div>
                          </div>
                          <span className="text-xs font-semibold text-slate-600">Save</span>
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              ) : null}

              {modal.type === 'instagram' ? (
                <div className="space-y-3">
                  {igLoading ? (
                    <div className="flex items-center justify-center py-10">
                      <Loader2 size={22} className="animate-spin text-slate-400" />
                    </div>
                  ) : igTargets.filter((t) => t.instagramId).length === 0 ? (
                    <div className="text-sm text-slate-500">
                      No Instagram Business accounts found on your Pages. Link an Instagram Business/Creator account to a Facebook Page first.
                    </div>
                  ) : (
                    <div className="grid gap-2">
                      {igTargets
                        .filter((t) => t.instagramId)
                        .map((t) => (
                          <button
                            key={`${t.pageId}:${t.instagramId}`}
                            type="button"
                            onClick={async () => {
                              if (!t.instagramId) return;
                              setBusy(`ig-${t.instagramId}`);
                              try {
                                const res = await integrationService.connectInstagram(t.pageId, t.instagramId, t.instagramUsername);
                                if (!res.success) throw new Error(res.error || 'Failed to connect Instagram');
                                alert('Instagram connected.');
                                await load();
                                setModal({ type: 'none' });
                              } catch (e) {
                                alert(e instanceof Error ? e.message : 'Failed to connect Instagram');
                              } finally {
                                setBusy(null);
                              }
                            }}
                            className="flex items-center justify-between gap-3 rounded-2xl border border-slate-200 bg-white px-4 py-3 text-left hover:bg-slate-50"
                          >
                            <div className="min-w-0">
                              <div className="truncate text-sm font-semibold text-slate-900">
                                @{t.instagramUsername || t.instagramId}
                              </div>
                              <div className="text-xs text-slate-500">From Page: {t.pageName}</div>
                            </div>
                            <span className="text-xs font-semibold text-slate-600">Connect</span>
                          </button>
                        ))}
                    </div>
                  )}
                </div>
              ) : null}

              {modal.type === 'pinterest' ? (
                <div className="space-y-3">
                  {pinLoading ? (
                    <div className="flex items-center justify-center py-10">
                      <Loader2 size={22} className="animate-spin text-slate-400" />
                    </div>
                  ) : pinBoards.length === 0 ? (
                    <div className="text-sm text-slate-500">No boards found.</div>
                  ) : (
                    <div className="grid gap-2">
                      {pinBoards.map((b) => (
                        <button
                          key={b.id}
                          type="button"
                          onClick={async () => {
                            setBusy(`pin-${b.id}`);
                            try {
                              const res = await integrationService.saveSocialTarget({
                                platform: 'pinterest',
                                account_type: 'board',
                                account_id: b.id,
                                account_name: b.name,
                              });
                              if (!res.success) throw new Error(res.error || 'Failed to save board');
                              alert('Board saved.');
                              await load();
                              setModal({ type: 'none' });
                            } catch (e) {
                              alert(e instanceof Error ? e.message : 'Failed to save board');
                            } finally {
                              setBusy(null);
                            }
                          }}
                          className="flex items-center justify-between gap-3 rounded-2xl border border-slate-200 bg-white px-4 py-3 text-left hover:bg-slate-50"
                        >
                          <div className="min-w-0">
                            <div className="truncate text-sm font-semibold text-slate-900">{b.name}</div>
                            <div className="text-xs text-slate-500">{b.id}</div>
                          </div>
                          <span className="text-xs font-semibold text-slate-600">Save</span>
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              ) : null}

              {modal.type === 'mailchimp' ? (
                <div className="space-y-4">
                  <div className="grid gap-3 sm:grid-cols-2">
                    <div className="sm:col-span-2">
                      <label className="text-xs font-semibold text-slate-600">API key</label>
                      <input
                        value={mcApiKey}
                        onChange={(e) => setMcApiKey(e.target.value)}
                        placeholder="xxxxxxxxxxxxxxxx-us19"
                        className="mt-1 w-full rounded-xl border border-slate-200 bg-slate-50 px-4 py-2.5 text-sm outline-none focus:border-slate-400"
                      />
                    </div>
                    <div>
                      <label className="text-xs font-semibold text-slate-600">Server prefix</label>
                      <input
                        value={mcServerPrefix}
                        onChange={(e) => setMcServerPrefix(e.target.value)}
                        placeholder="us19"
                        className="mt-1 w-full rounded-xl border border-slate-200 bg-slate-50 px-4 py-2.5 text-sm outline-none focus:border-slate-400"
                      />
                    </div>
                  </div>

                  <button
                    type="button"
                    onClick={async () => {
                      setBusy('mailchimp');
                      try {
                        const res = await integrationService.connectMailchimp({ apiKey: mcApiKey, serverPrefix: mcServerPrefix });
                        if (!res.success) throw new Error(res.error || 'Failed to connect Mailchimp');
                        alert('Mailchimp connected.');
                        await load();
                        setModal({ type: 'none' });
                        setMcApiKey('');
                      } catch (e) {
                        alert(e instanceof Error ? e.message : 'Failed to connect Mailchimp');
                      } finally {
                        setBusy(null);
                      }
                    }}
                    disabled={busy === 'mailchimp' || !mcApiKey.trim() || !mcServerPrefix.trim()}
                    className="inline-flex items-center gap-2 rounded-xl bg-slate-950 px-4 py-2.5 text-sm font-bold text-white hover:bg-slate-800 disabled:opacity-60"
                  >
                    {busy === 'mailchimp' ? <Loader2 size={16} className="animate-spin" /> : <Plug size={16} />} Connect
                  </button>

                  <p className="text-xs text-slate-500">We validate the key server-side and store it encrypted.</p>
                </div>
              ) : null}
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
