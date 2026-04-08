import { useCallback, useEffect, useState } from 'react';
import {
  Bookmark,
  ExternalLink,
  Eye,
  Heart,
  Loader2,
  MessageCircle,
  MousePointerClick,
  Pin,
  RefreshCcw,
  TrendingUp,
  UserCheck,
  Users,
} from 'lucide-react';
import {
  pinterestAnalyticsService,
  type PinterestPin,
  type PinterestPinsSummary,
  type PinterestProfileResponse,
} from '../../services/pinterestAnalyticsService';
import { formatCompactNumber, formatPercent, formatShortDate } from './analyticsUtils';

type Props = {
  days: number;
};

function StatCard({ label, value, icon }: { label: string; value: string; icon: React.ReactNode }) {
  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
      <div className="flex items-start justify-between gap-2">
        <div>
          <div className="text-xs font-semibold uppercase tracking-[0.22em] text-slate-400">{label}</div>
          <div className="mt-2 text-2xl font-black tracking-tight text-slate-950">{value}</div>
        </div>
        <div className="flex h-10 w-10 items-center justify-center rounded-2xl bg-slate-100 text-slate-700">{icon}</div>
      </div>
    </div>
  );
}

const fmt = (value: number | string | null | undefined) =>
  value !== null && value !== undefined && value !== '' ? formatCompactNumber(value) : 'N/A';

function guessPinterestPinUrl(pinId: string) {
  // Pinterest pin URLs are typically https://www.pinterest.com/pin/<id>/
  return `https://www.pinterest.com/pin/${encodeURIComponent(pinId)}/`;
}

export default function PinterestAnalytics({ days }: Props) {
  const [pins, setPins] = useState<PinterestPin[]>([]);
  const [summary, setSummary] = useState<PinterestPinsSummary | null>(null);
  const [profile, setProfile] = useState<PinterestProfileResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [syncing, setSyncing] = useState(false);
  const [syncResult, setSyncResult] = useState<{ synced: number; errors?: string[] } | null>(null);

  const fetchData = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [pinsResult, profileResult] = await Promise.all([
        pinterestAnalyticsService.getPins({ days, limit: 50 }),
        pinterestAnalyticsService.getProfile(),
      ]);
      setPins(pinsResult.pins);
      setSummary(pinsResult.summary);
      setProfile(profileResult);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load Pinterest analytics');
    } finally {
      setLoading(false);
    }
  }, [days]);

  useEffect(() => {
    void fetchData();
  }, [fetchData]);

  const handleSync = async () => {
    setSyncing(true);
    setSyncResult(null);
    try {
      const result = await pinterestAnalyticsService.sync();
      setSyncResult(result);
      await fetchData();
    } catch (err) {
      setSyncResult({ synced: 0, errors: [err instanceof Error ? err.message : 'Sync failed'] });
    } finally {
      setSyncing(false);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20 text-slate-400">
        <Loader2 size={20} className="animate-spin mr-2" /> Loading Pinterest analytics...
      </div>
    );
  }

  if (error) {
    return (
      <div className="rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">{error}</div>
    );
  }

  const handleText =
    profile?.handle && profile.handle.trim()
      ? profile.handle.trim().startsWith('@')
        ? profile.handle.trim()
        : `@${profile.handle.trim()}`
      : null;

  const displayName = profile?.account_name || handleText || 'Pinterest';
  const hasPins = pins.length > 0;

  return (
    <div className="space-y-6">
      {/* Header row */}
      <div className="flex items-center justify-between gap-4">
        <div>
          <div className="text-base font-bold text-slate-950">Pinterest Analytics</div>
          <div className="text-xs text-slate-500 mt-0.5">{pins.length} pins synced</div>
        </div>
        <button
          type="button"
          onClick={handleSync}
          disabled={syncing}
          className="inline-flex items-center gap-2 rounded-xl bg-slate-950 px-4 py-2.5 text-sm font-semibold text-white hover:bg-slate-800 disabled:opacity-50"
        >
          <RefreshCcw size={14} className={syncing ? 'animate-spin' : ''} />
          {syncing ? 'Syncing...' : 'Sync Pinterest'}
        </button>
      </div>

      {/* Sync result banner */}
      {syncResult && (
        <div
          className={`rounded-2xl border px-4 py-3 text-sm ${
            syncResult.errors?.length
              ? 'border-amber-200 bg-amber-50 text-amber-800'
              : 'border-emerald-200 bg-emerald-50 text-emerald-800'
          }`}
        >
          {syncResult.errors?.length ? (
            <>
              <span className="font-semibold">Sync completed with issues.</span> {syncResult.synced} items synced.
              {syncResult.errors.map((message, index) => (
                <span key={index} className="block mt-1 text-xs">
                  {message}
                </span>
              ))}
            </>
          ) : (
            <>
              <span className="font-semibold">Sync successful!</span> {syncResult.synced} items updated.
            </>
          )}
        </div>
      )}

      {/* Profile */}
      <div>
        <div className="mb-2 text-xs font-semibold uppercase tracking-[0.18em] text-slate-400">Profile</div>
        {profile && profile.hasData ? (
          <div>
            <div className="mb-3 flex items-start gap-4">
              {profile.picture_url ? (
                <img src={profile.picture_url} alt="" className="h-12 w-12 rounded-full object-cover" />
              ) : (
                <div className="flex h-12 w-12 items-center justify-center rounded-full bg-slate-100 text-slate-600">
                  <Pin size={18} />
                </div>
              )}
              <div className="min-w-0">
                <div className="text-base font-bold text-slate-900">{displayName}</div>
                {profile.account_name && handleText ? (
                  <div className="text-sm text-slate-600 mt-0.5">{handleText}</div>
                ) : null}
                {profile.bio ? (
                  <div className="mt-1 text-xs text-slate-500 line-clamp-2">{profile.bio}</div>
                ) : null}
                {profile.website ? (
                  <a
                    href={profile.website}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="mt-1 inline-flex items-center gap-1 text-xs font-semibold text-rose-600 hover:underline"
                  >
                    <ExternalLink size={11} /> Website
                  </a>
                ) : null}
              </div>
            </div>

            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              <StatCard label="Followers" value={fmt(profile.followers)} icon={<Users size={16} />} />
              <StatCard label="Monthly Views" value={fmt(profile.monthly_views)} icon={<Eye size={16} />} />
              <StatCard label="Pins" value={fmt(profile.posts_count)} icon={<Pin size={16} />} />
              <StatCard label="Following" value={fmt(profile.following)} icon={<UserCheck size={16} />} />
            </div>

            {profile.synced_at ? (
              <div className="mt-1.5 text-xs text-slate-400">Last synced {new Date(profile.synced_at).toLocaleString()}</div>
            ) : null}
          </div>
        ) : (
          <div className="rounded-2xl border border-dashed border-slate-200 bg-white p-8 text-center text-sm text-slate-500">
            <Pin size={32} className="mx-auto mb-3 text-slate-300" />
            <div className="font-semibold text-slate-700">No Pinterest profile data yet</div>
            <div className="mt-1 text-xs">
              Click <span className="font-semibold">Sync Pinterest</span> to pull your account stats.
            </div>
          </div>
        )}
      </div>

      {/* Performance summary */}
      {summary ? (
        <div>
          <div className="mb-2 text-xs font-semibold uppercase tracking-[0.18em] text-slate-400">Pin Performance</div>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6">
            <StatCard label="Pins" value={formatCompactNumber(summary.total_pins)} icon={<Pin size={16} />} />
            <StatCard label="Impressions" value={formatCompactNumber(summary.total_impressions)} icon={<TrendingUp size={16} />} />
            <StatCard label="Outbound Clicks" value={formatCompactNumber(summary.total_outbound_clicks)} icon={<MousePointerClick size={16} />} />
            <StatCard label="Saves" value={formatCompactNumber(summary.total_saves)} icon={<Bookmark size={16} />} />
            <StatCard label="Reactions" value={formatCompactNumber(summary.total_reactions)} icon={<Heart size={16} />} />
            <StatCard label="Avg Eng. Rate" value={formatPercent(summary.avg_engagement_rate)} icon={<TrendingUp size={16} />} />
          </div>
        </div>
      ) : null}

      {/* Pins list */}
      {!hasPins ? (
        <div className="rounded-2xl border border-dashed border-slate-200 bg-white p-8 text-center text-sm text-slate-500">
          <Pin size={32} className="mx-auto mb-3 text-slate-300" />
          <div className="font-semibold text-slate-700">No Pinterest pins synced yet</div>
          <div className="mt-1 text-xs">
            Click <span className="font-semibold">Sync Pinterest</span> to pull your pin insights.
          </div>
        </div>
      ) : (
        <div>
          <div className="mb-3 text-xs font-semibold uppercase tracking-[0.18em] text-slate-400">
            Pins · {pins.length} synced
          </div>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {pins.map((pin) => {
              const impressions = Number(pin.impressions || 0);
              const engagement = Number(pin.engagement || 0);
              const engagementRate = impressions > 0 ? (engagement / impressions) * 100 : 0;

              const outboundClicks = pin.outbound_clicks ?? pin.clicks ?? null;
              const saves = pin.saves_count ?? pin.saves ?? null;

              const title = pin.title || pin.description || `Pin ${pin.pin_id.slice(0, 8)}`;
              const createdAt = pin.created_at || pin.posted_at;

              const pinUrl = pin.pin_id ? guessPinterestPinUrl(pin.pin_id) : null;

              return (
                <div key={pin.pin_id} className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
                  <div className="aspect-[4/3] bg-slate-100 overflow-hidden">
                    {pin.media_url ? (
                      <img src={pin.media_url} alt="" className="h-full w-full object-cover" />
                    ) : (
                      <div className="flex h-full w-full items-center justify-center">
                        <Pin size={28} className="text-slate-300" />
                      </div>
                    )}
                  </div>
                  <div className="space-y-3 p-4">
                    <div>
                      <div className="line-clamp-3 text-sm font-semibold leading-snug text-slate-900">{title}</div>
                      <div className="mt-1 text-xs text-slate-400">
                        {pin.creative_type ? pin.creative_type.replace(/_/g, ' ') : 'PIN'} · {formatShortDate(createdAt)}
                      </div>
                    </div>

                    <div className="grid grid-cols-2 gap-2 text-xs text-slate-500">
                      <div className="rounded-xl bg-slate-50 px-3 py-2">
                        Impressions: <span className="font-semibold text-slate-700">{formatCompactNumber(pin.impressions)}</span>
                      </div>
                      <div className="rounded-xl bg-slate-50 px-3 py-2">
                        Saves: <span className="font-semibold text-slate-700">{formatCompactNumber(saves)}</span>
                      </div>
                      <div className="rounded-xl bg-slate-50 px-3 py-2">
                        Outbound: <span className="font-semibold text-slate-700">{formatCompactNumber(outboundClicks)}</span>
                      </div>
                      <div className="rounded-xl bg-slate-50 px-3 py-2">
                        Reactions: <span className="font-semibold text-slate-700">{formatCompactNumber(pin.likes)}</span>
                      </div>
                      <div className="rounded-xl bg-slate-50 px-3 py-2">
                        Comments: <span className="font-semibold text-slate-700">{formatCompactNumber(pin.comments)}</span>
                      </div>
                      <div className="rounded-xl bg-slate-50 px-3 py-2">
                        Eng. rate: <span className="font-semibold text-slate-700">{formatPercent(engagementRate)}</span>
                      </div>
                    </div>

                    <div className="flex items-center justify-between gap-2 text-xs text-slate-500">
                      <div className="inline-flex items-center gap-1">
                        <MessageCircle size={12} /> Engagement {formatCompactNumber(pin.engagement)}
                      </div>
                      <div className="flex items-center gap-3">
                        {pin.link ? (
                          <a
                            href={pin.link}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="inline-flex items-center gap-1 font-semibold text-slate-700 hover:underline"
                            title="Open destination link"
                          >
                            <ExternalLink size={11} /> Link
                          </a>
                        ) : null}
                        {pinUrl ? (
                          <a
                            href={pinUrl}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="inline-flex items-center gap-1 font-semibold text-rose-600 hover:underline"
                            title="View on Pinterest"
                          >
                            <ExternalLink size={11} /> View
                          </a>
                        ) : null}
                      </div>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
