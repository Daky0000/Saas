import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { CheckCircle, ExternalLink, Loader2, Plug, Settings2, Unplug } from 'lucide-react';
import { integrationService, type IntegrationCatalogItem } from '../services/integrationService';
import { sanitizeApiErrorText } from '../utils/apiRequest';
import { wordpressService } from '../services/wordpressService';
import { socialPostService } from '../services/socialPostService';
import { PlatformLogo } from '../components/PlatformLogo';

type Props = {
  onNavigateSettings?: () => void;
};

type ModalState =
  | { type: 'none' }
  | { type: 'wordpress' }
  | { type: 'facebook-type' }
  | { type: 'facebook-select'; accountType: 'page' | 'group' }
  | { type: 'instagram' }
  | { type: 'linkedin' }
  | { type: 'pinterest' }
  | { type: 'mailchimp' };

const PLATFORM_BADGE: Record<string, { bg: string; text: string }> = {
  connected: { bg: 'bg-emerald-50', text: 'text-emerald-700' },
  disconnected: { bg: 'bg-slate-100', text: 'text-slate-600' },
  disabled: { bg: 'bg-amber-50', text: 'text-amber-700' },
};


const formatDate = (value?: string | null) => {
  if (!value) return '';
  const dt = new Date(value);
  if (Number.isNaN(dt.getTime())) return '';
  return dt.toLocaleDateString();
};

const PRIMARY_ACTION =
  'inline-flex items-center gap-2 rounded-full bg-slate-900 px-3 py-1.5 text-xs font-semibold text-white hover:bg-slate-800 disabled:opacity-60';
const SECONDARY_ACTION =
  'inline-flex items-center gap-2 rounded-full border border-slate-200 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-60';

function Card({
  title,
  description,
  statusLabel,
  statusTone,
  icon,
  meta,
  disabledReason,
  children,
}: {
  title: string;
  description: string;
  statusLabel: string;
  statusTone: keyof typeof PLATFORM_BADGE;
  icon: React.ReactNode;
  meta?: string | null;
  disabledReason?: string | null;
  children: React.ReactNode;
}) {
  const badge = PLATFORM_BADGE[statusTone];
  return (
    <div className="group rounded-[24px] border-2 border-slate-200 bg-white p-5 shadow-sm transition hover:-translate-y-0.5 hover:border-slate-300 hover:shadow-lg">
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-center gap-3">
          <div className="flex h-12 w-12 items-center justify-center rounded-2xl overflow-hidden shadow-sm">
            {icon}
          </div>
          <div className="min-w-0">
            <div className="text-base font-black text-slate-950">{title}</div>
            {meta ? <div className="mt-1 text-xs text-slate-500">{meta}</div> : null}
          </div>
        </div>
        <span className={`rounded-full px-2.5 py-1 text-[11px] font-semibold ${badge.bg} ${badge.text}`}>{statusLabel}</span>
      </div>
      <p className="mt-3 text-sm leading-6 text-slate-500">{description}</p>
      {disabledReason ? <p className="mt-3 text-xs text-amber-700">{disabledReason}</p> : null}
      <div className="mt-4 flex flex-wrap gap-2">{children}</div>
    </div>
  );
}

export default function Integrations({ onNavigateSettings }: Props) {
  const [loading, setLoading] = useState(true);
  const [items, setItems] = useState<IntegrationCatalogItem[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [redirectError, setRedirectError] = useState<string | null>(null);

  const [modal, setModal] = useState<ModalState>({ type: 'none' });
  const [activeTab, setActiveTab] = useState<'cms' | 'social' | 'marketing'>('cms');
  const [tabInitialized, setTabInitialized] = useState(false);

  const [busy, setBusy] = useState<string | null>(null);

  // WordPress form
  const [wpSiteUrl, setWpSiteUrl] = useState('');
  const [wpUsername, setWpUsername] = useState('');
  const [wpAppPassword, setWpAppPassword] = useState('');

  // Facebook pages
  const [fbPages, setFbPages] = useState<Array<{ id: string; name: string; picture?: string | null; can_publish?: boolean }>>([]);
  const [fbGroups, setFbGroups] = useState<Array<{ id: string; name: string }>>([]);
  const [fbLoading, setFbLoading] = useState(false);
  const [fbMissingPermissions, setFbMissingPermissions] = useState<string[]>([]);
  const [fbWarnings, setFbWarnings] = useState<string[]>([]);
  const [fbTargetType, setFbTargetType] = useState<'page' | 'group'>('page');
  const [fbSelectedTargets, setFbSelectedTargets] = useState<string[]>([]);
  const fbReturnHandled = useRef(false);

  // Instagram targets
  const [igTargets, setIgTargets] = useState<Array<{ pageId: string; pageName: string; instagramId: string | null; instagramUsername: string | null }>>([]);
  const [igLoading, setIgLoading] = useState(false);

  // LinkedIn targets
  const [linkedInTargets, setLinkedInTargets] = useState<Array<{ id: string; name: string; accountType: 'profile' | 'page'; saved?: boolean }>>([]);
  const [linkedInLoading, setLinkedInLoading] = useState(false);
  const [linkedInWarning, setLinkedInWarning] = useState<string | null>(null);
  const liReturnHandled = useRef(false);

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

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const rawError = params.get('error');
    if (!rawError) return;

    setRedirectError(
      sanitizeApiErrorText(
        rawError,
        'The integration callback returned the app shell instead of API data. Please try connecting again.'
      )
    );

    params.delete('error');
    params.delete('success');
    const nextQuery = params.toString();
    const nextUrl = `${window.location.pathname}${nextQuery ? `?${nextQuery}` : ''}`;
    window.history.replaceState({}, '', nextUrl);
  }, []);

  const cms = useMemo(() => items.filter((i) => i.type === 'cms'), [items]);
  const social = useMemo(() => items.filter((i) => i.type === 'social'), [items]);
  const marketing = useMemo(() => items.filter((i) => i.type === 'marketing'), [items]);
  const connectedCount = useMemo(() => items.filter((i) => i.connected).length, [items]);
  const totalCount = items.length;
  const facebookConnected = useMemo(
    () => items.some((item) => item.slug === 'facebook' && item.connected),
    [items]
  );
  const linkedInConnected = useMemo(
    () => items.some((item) => item.slug === 'linkedin' && item.connected),
    [items]
  );

  const tabs = useMemo(
    () => [
      { id: 'cms' as const, label: 'CMS', count: cms.length, title: 'CMS Platforms', subtitle: `${cms.length} apps available`, empty: 'No CMS integrations enabled.' },
      { id: 'social' as const, label: 'Social', count: social.length, title: 'Social Media Platforms', subtitle: `${social.length} channels supported`, empty: 'No social integrations enabled.' },
      { id: 'marketing' as const, label: 'Marketing', count: marketing.length, title: 'Marketing Platforms', subtitle: `${marketing.length} tools ready`, empty: 'No marketing integrations enabled.' },
    ],
    [cms.length, social.length, marketing.length],
  );

  useEffect(() => {
    if (tabInitialized || loading) return;
    const firstAvailable = cms.length ? 'cms' : social.length ? 'social' : marketing.length ? 'marketing' : 'cms';
    setActiveTab(firstAvailable);
    setTabInitialized(true);
  }, [cms.length, social.length, marketing.length, loading, tabInitialized]);

  const startOAuth = async (slug: string, returnTo = '/integrations') => {
    setBusy(slug);
    try {
      const res = await integrationService.startOAuth(slug, returnTo);
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

  const openFacebookType = () => {
    setFbTargetType('page');
    setFbSelectedTargets([]);
    setModal({ type: 'facebook-type' });
  };

  const openFacebookSelect = useCallback(async (accountType: 'page' | 'group') => {
    setFbTargetType(accountType);
    setFbSelectedTargets([]);
    setModal({ type: 'facebook-select', accountType });
    setFbLoading(true);
    try {
      const res = await integrationService.listFacebookTargets();
      if (!res.success) throw new Error(res.error || 'Failed to load Facebook targets');
      setFbPages(res.pages || []);
      setFbGroups(res.groups || []);
      setFbMissingPermissions(res.missingPermissions || []);
      setFbWarnings(res.warnings || []);
    } catch (e) {
      alert(e instanceof Error ? e.message : 'Failed to load Facebook targets');
      setFbPages([]);
      setFbGroups([]);
      setFbMissingPermissions([]);
      setFbWarnings([]);
    } finally {
      setFbLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!facebookConnected || fbReturnHandled.current) return;
    const params = new URLSearchParams(window.location.search);
    const fbType = params.get('fbType');
    if (fbType !== 'page' && fbType !== 'group') return;
    fbReturnHandled.current = true;
    void openFacebookSelect(fbType);
    params.delete('fbType');
    const nextQuery = params.toString();
    const nextUrl = `${window.location.pathname}${nextQuery ? `?${nextQuery}` : ''}`;
    window.history.replaceState({}, '', nextUrl);
  }, [facebookConnected, openFacebookSelect]);

  const openLinkedInTargets = useCallback(async () => {
    setModal({ type: 'linkedin' });
    setLinkedInLoading(true);
    setLinkedInWarning(null);
    try {
      const res = await integrationService.listLinkedInTargets();
      if (!res.success) throw new Error(res.error || 'Failed to load LinkedIn targets');
      setLinkedInTargets(res.targets || []);
      setLinkedInWarning(res.warning || null);
    } catch (e) {
      alert(e instanceof Error ? e.message : 'Failed to load LinkedIn targets');
      setLinkedInTargets([]);
      setLinkedInWarning(null);
    } finally {
      setLinkedInLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!linkedInConnected || liReturnHandled.current) return;
    const params = new URLSearchParams(window.location.search);
    if (params.get('liConnected') !== '1') return;
    liReturnHandled.current = true;
    void openLinkedInTargets();
    params.delete('liConnected');
    const nextQuery = params.toString();
    const nextUrl = `${window.location.pathname}${nextQuery ? `?${nextQuery}` : ''}`;
    window.history.replaceState({}, '', nextUrl);
  }, [linkedInConnected, openLinkedInTargets]);

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

  const toggleFacebookSelection = (id: string, disabled?: boolean) => {
    if (disabled) return;
    setFbSelectedTargets((prev) => (prev.includes(id) ? prev.filter((item) => item !== id) : [...prev, id]));
  };

  const toggleFacebookSelectAll = (ids: string[]) => {
    const allSelected = ids.every((id) => fbSelectedTargets.includes(id));
    setFbSelectedTargets(allSelected ? [] : ids);
  };

  const saveFacebookTargets = async (accountType: 'page' | 'group') => {
    const targets = accountType === 'group' ? fbGroups : fbPages;
    const pageTargets = targets as Array<{ id: string; name: string; can_publish?: boolean }>;
    const selectable = accountType === 'page' ? pageTargets.filter((t) => t.can_publish !== false) : targets;
    const selected = selectable.filter((t) => fbSelectedTargets.includes(t.id));
    if (!selected.length) {
      alert('Select at least one account to connect.');
      return;
    }
    setBusy('facebook-targets');
    try {
      for (const target of selected) {
        const res = await integrationService.saveSocialTarget({
          platform: 'facebook',
          account_type: accountType,
          account_id: target.id,
          account_name: target.name,
        });
        if (!res.success) throw new Error(res.error || 'Failed to save target');
      }
      await load();
      setModal({ type: 'none' });
    } catch (e) {
      alert(e instanceof Error ? e.message : 'Failed to save targets');
    } finally {
      setBusy(null);
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
    const isOauth = ['facebook', 'linkedin', 'twitter', 'pinterest', 'tiktok'].includes(slug);
    const connectedAt = item.connection?.connectedAt || item.connection?.createdAt || null;
    const connectedLabel = item.connection?.accountName || item.connection?.username || item.connection?.siteUrl || item.connection?.handle || '';
    const connectedMeta = item.connected
      ? [connectedLabel ? `Connected as ${connectedLabel}` : 'Connected', connectedAt ? formatDate(connectedAt) : '']
          .filter(Boolean)
          .join(' • ')
      : null;

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
        icon={<PlatformLogo platform="wordpress" size={48} />}
        meta={connectedMeta}
      >
          {!item.connected ? (
            <button
              type="button"
              onClick={() => setModal({ type: 'wordpress' })}
              className={PRIMARY_ACTION}
            >
              <Plug size={16} /> Connect
            </button>
          ) : (
            <>
              <button
                type="button"
                onClick={disconnectWordPress}
                disabled={busy === 'wordpress'}
                className={SECONDARY_ACTION}
              >
                {busy === 'wordpress' ? <Loader2 size={16} className="animate-spin" /> : <Unplug size={16} />} Disconnect
              </button>
              <button
                type="button"
                onClick={() => setModal({ type: 'wordpress' })}
                className={SECONDARY_ACTION}
              >
                <Settings2 size={16} /> Manage
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
          icon={<PlatformLogo platform="mailchimp" size={48} />}
          meta={connectedMeta}
        >
          {!item.connected ? (
            <button
              type="button"
              onClick={() => setModal({ type: 'mailchimp' })}
              className={PRIMARY_ACTION}
            >
              <Plug size={16} /> Connect
            </button>
          ) : (
            <>
              <button
                type="button"
                onClick={() => setModal({ type: 'mailchimp' })}
                className={SECONDARY_ACTION}
              >
                <Settings2 size={16} /> Manage
              </button>
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
                className={SECONDARY_ACTION}
              >
                {busy === 'mailchimp' ? <Loader2 size={16} className="animate-spin" /> : <Unplug size={16} />} Disconnect
              </button>
            </>
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
                ? 'Publish posts to your profile or LinkedIn Pages you administer.'
                : slug === 'twitter'
                  ? 'Publish tweets with X API v2 (supports token refresh).'
                  : slug === 'pinterest'
                    ? 'Create Pins on selected boards using the Pinterest API.'
                    : 'Connect using OAuth.'
        }
        statusLabel={disabledReason ? 'Admin disabled' : item.connected ? 'Connected' : 'Disconnected'}
        statusTone={statusTone}
        disabledReason={disabledReason}
        icon={<PlatformLogo platform={slug} size={48} />}
        meta={connectedMeta}
      >
        {slug === 'instagram' ? (
          <>
            <button
              type="button"
              onClick={() => void openInstagramTargets()}
              disabled={!items.find((i) => i.slug === 'facebook')?.connected}
              className={PRIMARY_ACTION}
              title={!items.find((i) => i.slug === 'facebook')?.connected ? 'Connect Facebook first' : ''}
            >
              <Settings2 size={16} /> {item.connected ? 'Manage' : 'Connect'}
            </button>
            {item.connected ? (
              <button
                type="button"
                onClick={() => void disconnectOAuth('instagram')}
                disabled={busy === 'instagram'}
                className={SECONDARY_ACTION}
              >
                {busy === 'instagram' ? <Loader2 size={16} className="animate-spin" /> : <Unplug size={16} />} Disconnect
              </button>
            ) : null}
          </>
        ) : (
          <>
            <button
              type="button"
              onClick={() => (slug === 'facebook' ? openFacebookType() : void startOAuth(slug, slug === 'linkedin' ? '/integrations?liConnected=1' : '/integrations'))}
              disabled={!canConnect || busy === slug}
              className={PRIMARY_ACTION}
            >
              {busy === slug ? <Loader2 size={16} className="animate-spin" /> : <Plug size={16} />} {connectLabel}
            </button>

            {item.connected ? (
              <button
                type="button"
                onClick={() => void disconnectOAuth(slug)}
                disabled={busy === slug}
                className={SECONDARY_ACTION}
              >
                {busy === slug ? <Loader2 size={16} className="animate-spin" /> : <Unplug size={16} />} Disconnect
              </button>
            ) : null}
          </>
        )}

        {slug === 'facebook' ? (
          <button
            type="button"
            onClick={() => openFacebookType()}
            disabled={!item.connected}
            className={SECONDARY_ACTION}
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
            className={SECONDARY_ACTION}
            title={!item.connected ? 'Connect Pinterest first' : ''}
          >
            <Settings2 size={16} /> Manage
          </button>
        ) : null}

        {slug === 'linkedin' ? (
          <button
            type="button"
            onClick={() => void openLinkedInTargets()}
            disabled={!item.connected}
            className={SECONDARY_ACTION}
            title={!item.connected ? 'Connect LinkedIn first' : ''}
          >
            <Settings2 size={16} /> Manage
          </button>
        ) : null}

      </Card>
    );
  };

  return (
    <div className="space-y-8">
      <section className="rounded-[28px] border border-slate-200 bg-white px-6 py-6 shadow-sm">
        <div className="flex flex-col gap-6 lg:flex-row lg:items-center lg:justify-between">
          <div className="max-w-2xl">
            <div className="text-[11px] font-semibold uppercase tracking-[0.3em] text-slate-400">Integrations & workflows</div>
            <h2 className="mt-2 text-3xl font-black tracking-[-0.03em] text-slate-950">Integrations & workflows</h2>
            <p className="mt-2 text-sm text-slate-500">
              Supercharge your workflow and connect the tools you and your team use every day. Admins configure the apps; you connect the accounts.
            </p>
            <div className="mt-4 flex flex-wrap gap-2" role="tablist" aria-label="Integration categories">
              {tabs.map((tab) => {
                const isActive = tab.id === activeTab;
                return (
                  <button
                    key={tab.id}
                    id={`integrations-tab-${tab.id}`}
                    type="button"
                    role="tab"
                    aria-selected={isActive}
                    aria-controls={`integrations-panel-${tab.id}`}
                    onClick={() => setActiveTab(tab.id)}
                    className={`rounded-full px-3 py-1 text-xs font-semibold transition ${
                      isActive
                        ? 'bg-slate-900 text-white shadow-sm'
                        : 'border border-slate-200 bg-white text-slate-600 hover:bg-slate-50'
                    }`}
                  >
                    {tab.label} ({tab.count})
                  </button>
                );
              })}
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-3">
            <div className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-center">
              <div className="text-[11px] font-semibold uppercase tracking-[0.2em] text-slate-400">Connected</div>
              <div className="text-2xl font-black text-slate-900">{connectedCount}</div>
            </div>
            <div className="rounded-2xl border border-slate-200 bg-white px-4 py-3 text-center">
              <div className="text-[11px] font-semibold uppercase tracking-[0.2em] text-slate-400">Total</div>
              <div className="text-2xl font-black text-slate-900">{totalCount}</div>
            </div>
            {onNavigateSettings ? (
              <button
                type="button"
                onClick={onNavigateSettings}
                className="inline-flex items-center justify-center gap-2 rounded-full border border-slate-200 bg-white px-4 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50"
              >
                <ExternalLink size={16} /> Admin settings
              </button>
            ) : null}
          </div>
        </div>
      </section>

      {loading ? (
        <div className="flex items-center justify-center py-16">
          <Loader2 size={28} className="animate-spin text-slate-400" />
        </div>
      ) : (error || redirectError) ? (
        <div className="rounded-2xl border border-red-200 bg-red-50 p-5 text-sm text-red-700">
          <div className="font-semibold">We couldn't load integrations.</div>
          <div className="mt-1">{error || redirectError}</div>
          <button
            type="button"
            onClick={() => {
              setRedirectError(null);
              void load();
            }}
            className="mt-3 inline-flex items-center gap-2 rounded-xl bg-red-600 px-3 py-2 text-xs font-semibold text-white hover:bg-red-700"
          >
            Retry
          </button>
        </div>
      ) : (
        <>
          {(() => {
            const activeConfig = tabs.find((tab) => tab.id === activeTab) || tabs[0];
            const activeItems = activeTab === 'cms' ? cms : activeTab === 'social' ? social : marketing;
            return (
              <section
                className="space-y-4"
                role="tabpanel"
                id={`integrations-panel-${activeConfig.id}`}
                aria-labelledby={`integrations-tab-${activeConfig.id}`}
              >
                <div className="flex items-center justify-between">
                  <div>
                    <div className="text-sm font-black text-slate-900">{activeConfig.title}</div>
                    <div className="text-xs text-slate-500">{activeConfig.subtitle}</div>
                  </div>
                </div>
                <div className="grid gap-5 md:grid-cols-2 xl:grid-cols-3">
                  {activeItems.length
                    ? activeItems.map(renderActions)
                    : <div className="text-sm text-slate-400">{activeConfig.empty}</div>}
                </div>
              </section>
            );
          })()}

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
                  : modal.type === 'facebook-type'
                    ? 'Select Facebook account type'
                    : modal.type === 'facebook-select'
                      ? modal.accountType === 'group'
                        ? 'Select Facebook Groups'
                        : 'Select Facebook Pages'
                    : modal.type === 'instagram'
                      ? 'Instagram (Business accounts)'
                      : modal.type === 'linkedin'
                        ? 'LinkedIn targets'
                      : modal.type === 'pinterest'
                      ? 'Pinterest boards'
                      : modal.type === 'mailchimp'
                        ? 'Mailchimp'
                        : 'Integration'}
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

              {modal.type === 'facebook-type' ? (
                <div className="space-y-4">
                  <div className="text-sm text-slate-600">
                    Choose what you want to connect. Pages support direct publishing, Groups are available for reminders.
                  </div>
                  <button
                    type="button"
                    onClick={() => setFbTargetType('page')}
                    className={`flex w-full items-center justify-between gap-4 rounded-2xl border px-4 py-4 text-left transition ${
                      fbTargetType === 'page' ? 'border-blue-500 bg-blue-50' : 'border-slate-200 bg-white hover:bg-slate-50'
                    }`}
                  >
                    <div className="flex items-center gap-3">
                      <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-slate-100 text-slate-600">P</div>
                      <div>
                        <div className="text-sm font-bold text-slate-900">Page</div>
                        <div className="text-xs text-slate-500">
                          Best for brands and businesses. Direct publishing is supported.
                        </div>
                      </div>
                    </div>
                    <div className={`h-5 w-5 rounded-full border ${fbTargetType === 'page' ? 'border-blue-500' : 'border-slate-300'}`}>
                      <div className={`h-full w-full rounded-full ${fbTargetType === 'page' ? 'bg-blue-500' : 'bg-transparent'}`} />
                    </div>
                  </button>
                  <button
                    type="button"
                    onClick={() => setFbTargetType('group')}
                    className={`flex w-full items-center justify-between gap-4 rounded-2xl border px-4 py-4 text-left transition ${
                      fbTargetType === 'group' ? 'border-blue-500 bg-blue-50' : 'border-slate-200 bg-white hover:bg-slate-50'
                    }`}
                  >
                    <div className="flex items-center gap-3">
                      <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-slate-100 text-slate-600">G</div>
                      <div>
                        <div className="text-sm font-bold text-slate-900">Group</div>
                        <div className="text-xs text-slate-500">
                          Use Groups for reminders or discussion posts. Availability depends on Meta permissions.
                        </div>
                      </div>
                    </div>
                    <div className={`h-5 w-5 rounded-full border ${fbTargetType === 'group' ? 'border-blue-500' : 'border-slate-300'}`}>
                      <div className={`h-full w-full rounded-full ${fbTargetType === 'group' ? 'bg-blue-500' : 'bg-transparent'}`} />
                    </div>
                  </button>
                  <div className="flex justify-end gap-2">
                    <button
                      type="button"
                      onClick={() => setModal({ type: 'none' })}
                      className="rounded-xl border border-slate-200 bg-white px-4 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50"
                    >
                      Cancel
                    </button>
                    <button
                      type="button"
                      onClick={() =>
                        facebookConnected
                          ? void openFacebookSelect(fbTargetType)
                          : void startOAuth('facebook', `/integrations?fbType=${fbTargetType}`)
                      }
                      className="rounded-xl bg-slate-950 px-4 py-2 text-xs font-semibold text-white hover:bg-slate-800"
                    >
                      Continue
                    </button>
                  </div>
                </div>
              ) : null}

              {modal.type === 'facebook-select' ? (
                <div className="space-y-3">
                  {fbLoading ? (
                    <div className="flex items-center justify-center py-10">
                      <Loader2 size={22} className="animate-spin text-slate-400" />
                    </div>
                  ) : (
                    <>
                      <div className="flex items-center justify-between text-xs text-slate-500">
                        <span>{fbSelectedTargets.length} selected</span>
                        {(() => {
                          const targets = modal.accountType === 'group' ? fbGroups : fbPages;
                          const pageTargets = targets as Array<{ id: string; name: string; can_publish?: boolean }>;
                          const selectable = modal.accountType === 'page' ? pageTargets.filter((t) => t.can_publish !== false) : targets;
                          const selectableIds = selectable.map((t) => t.id);
                          const allSelected = selectableIds.length > 0 && selectableIds.every((id) => fbSelectedTargets.includes(id));
                          return (
                            <label className="flex items-center gap-2">
                              <input
                                type="checkbox"
                                checked={allSelected}
                                onChange={() => toggleFacebookSelectAll(selectableIds)}
                              />
                              Select All
                            </label>
                          );
                        })()}
                      </div>

                      {fbMissingPermissions.length > 0 ? (
                        <div className="rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-xs text-amber-700">
                          Missing Facebook permissions: {fbMissingPermissions.join(', ')}. Reconnect Facebook and approve these permissions.
                        </div>
                      ) : null}

                      {fbWarnings.length > 0 ? (
                        <div className="rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-xs text-amber-700">
                          {fbWarnings.join(' ')}
                        </div>
                      ) : null}

                      {(() => {
                        const targets = modal.accountType === 'group' ? fbGroups : fbPages;
                        if (targets.length === 0) {
                          return (
                            <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4 text-sm text-slate-600">
                              No {modal.accountType === 'group' ? 'Groups' : 'Pages'} found. Try reconnecting Facebook.
                            </div>
                          );
                        }
                        return (
                          <div className="grid gap-2">
                            {targets.map((target) => {
                              const disabled =
                                modal.accountType === 'page' &&
                                (target as { can_publish?: boolean }).can_publish === false;
                              const selected = fbSelectedTargets.includes(target.id);
                              return (
                                <button
                                  key={target.id}
                                  type="button"
                                  onClick={() => toggleFacebookSelection(target.id, disabled)}
                                  className={`flex items-center justify-between gap-3 rounded-2xl border px-4 py-3 text-left ${
                                    disabled
                                      ? 'border-amber-200 bg-amber-50 text-amber-800'
                                      : 'border-slate-200 bg-white hover:bg-slate-50'
                                  }`}
                                >
                                  <div className="flex items-center gap-3">
                                    <div className="flex h-10 w-10 items-center justify-center rounded-full bg-slate-100 text-sm font-bold text-slate-600">
                                      {target.name?.[0]?.toUpperCase() || 'F'}
                                    </div>
                                    <div>
                                      <div className="text-sm font-semibold text-slate-900">{target.name}</div>
                                      <div className="text-xs text-slate-500">
                                        {modal.accountType === 'group' ? 'Group' : 'Page'}
                                      </div>
                                      {disabled ? (
                                        <div className="mt-1 text-xs text-amber-700">No publish access. Ask for Editor/Admin role.</div>
                                      ) : null}
                                    </div>
                                  </div>
                                  <input type="checkbox" checked={selected} readOnly />
                                </button>
                              );
                            })}
                          </div>
                        );
                      })()}

                      <div className="flex justify-end gap-2">
                        <button
                          type="button"
                          onClick={() => setModal({ type: 'facebook-type' })}
                          className="rounded-xl border border-slate-200 bg-white px-4 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50"
                        >
                          Back
                        </button>
                        <button
                          type="button"
                          onClick={() => void saveFacebookTargets(modal.accountType)}
                          disabled={busy === 'facebook-targets' || fbSelectedTargets.length === 0}
                          className="rounded-xl bg-slate-950 px-4 py-2 text-xs font-semibold text-white hover:bg-slate-800 disabled:opacity-60"
                        >
                          {busy === 'facebook-targets' ? 'Saving…' : 'Finish Connection'}
                        </button>
                      </div>
                    </>
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

              {modal.type === 'linkedin' ? (
                <div className="space-y-3">
                  {linkedInLoading ? (
                    <div className="flex items-center justify-center py-10">
                      <Loader2 size={22} className="animate-spin text-slate-400" />
                    </div>
                  ) : (
                    <>
                      <p className="text-xs text-slate-500">
                        Choose where to post on LinkedIn. Save your personal profile, a LinkedIn Page you admin, or both — each appears as a separate account in post distribution.
                      </p>

                      {linkedInWarning ? (
                        <div className="rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-xs text-amber-700">
                          {linkedInWarning}
                        </div>
                      ) : null}

                      {linkedInTargets.length === 0 ? (
                        <div className="text-sm text-slate-500">
                          No LinkedIn targets were found. Reconnect LinkedIn if you recently gained Page access.
                        </div>
                      ) : (
                        <div className="grid gap-2">
                          {linkedInTargets.map((target) => (
                            <div
                              key={`${target.accountType}:${target.id}`}
                              className={`flex items-center justify-between gap-3 rounded-2xl border px-4 py-3 ${target.saved ? 'border-indigo-200 bg-indigo-50' : 'border-slate-200 bg-white'}`}
                            >
                              <div className="min-w-0">
                                <div className="truncate text-sm font-semibold text-slate-900">{target.name}</div>
                                <div className="text-xs text-slate-500">
                                  {target.accountType === 'page' ? 'LinkedIn Page' : 'Personal profile'}
                                </div>
                              </div>
                              <button
                                type="button"
                                disabled={busy === `li-${target.accountType}-${target.id}`}
                                onClick={async () => {
                                  setBusy(`li-${target.accountType}-${target.id}`);
                                  try {
                                    if (target.saved) {
                                      const accts = await socialPostService.listAccounts();
                                      const match = accts.find(
                                        (a) => a.platform === 'linkedin' && a.account_type === target.accountType && a.account_id === target.id
                                      );
                                      if (match) await socialPostService.deleteAccount(match.id);
                                    } else {
                                      const res = await integrationService.saveSocialTarget({
                                        platform: 'linkedin',
                                        account_type: target.accountType,
                                        account_id: target.id,
                                        account_name: target.name,
                                      });
                                      if (!res.success) throw new Error(res.error || 'Failed to save LinkedIn target');
                                    }
                                    await load();
                                    await openLinkedInTargets();
                                  } catch (e) {
                                    alert(e instanceof Error ? e.message : 'Failed to update LinkedIn target');
                                  } finally {
                                    setBusy(null);
                                  }
                                }}
                                className={`shrink-0 rounded-xl px-3 py-1.5 text-xs font-semibold transition-colors ${
                                  target.saved
                                    ? 'bg-indigo-100 text-indigo-700 hover:bg-red-100 hover:text-red-700'
                                    : 'bg-slate-950 text-white hover:bg-slate-700'
                                }`}
                              >
                                {busy === `li-${target.accountType}-${target.id}` ? (
                                  <Loader2 size={12} className="animate-spin" />
                                ) : target.saved ? (
                                  'Saved ✓'
                                ) : (
                                  'Save'
                                )}
                              </button>
                            </div>
                          ))}
                        </div>
                      )}
                    </>
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
