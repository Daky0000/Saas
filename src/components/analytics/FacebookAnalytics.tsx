import { useEffect, useState, useCallback } from 'react';
import { Loader2, RefreshCcw, Heart, MessageCircle, Share2, TrendingUp, Users, ExternalLink } from 'lucide-react';
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
} from 'recharts';
import { facebookAnalyticsService, type FacebookPost, type FacebookPostSummary, type FacebookStatsResponse } from '../../services/facebookAnalyticsService';
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

const fmt = (val: number | null) => val !== null ? formatCompactNumber(val) : '–';

export default function FacebookAnalytics({ days }: Props) {
  const [posts, setPosts] = useState<FacebookPost[]>([]);
  const [summary, setSummary] = useState<FacebookPostSummary | null>(null);
  const [stats, setStats] = useState<FacebookStatsResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [syncing, setSyncing] = useState(false);
  const [syncResult, setSyncResult] = useState<{ synced: number; errors?: string[] } | null>(null);

  const fetchData = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [postsResult, statsResult] = await Promise.all([
        facebookAnalyticsService.getPosts({ days, limit: 50 }),
        facebookAnalyticsService.getStats(),
      ]);
      setPosts(postsResult.posts);
      setSummary(postsResult.summary);
      setStats(statsResult);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load Facebook data');
    } finally {
      setLoading(false);
    }
  }, [days]);

  useEffect(() => { fetchData(); }, [fetchData]);

  const handleSync = async () => {
    setSyncing(true);
    setSyncResult(null);
    try {
      const result = await facebookAnalyticsService.sync();
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
        <Loader2 size={20} className="animate-spin mr-2" /> Loading Facebook analytics…
      </div>
    );
  }

  if (error) {
    return (
      <div className="rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">{error}</div>
    );
  }

  // Chart data — top 10 by engagement for the bar chart
  const chartData = [...posts]
    .sort((a, b) => Number(b.engagement) - Number(a.engagement))
    .slice(0, 10)
    .map((p, i) => ({
      name: p.message ? p.message.slice(0, 20) + (p.message.length > 20 ? '…' : '') : `Post ${i + 1}`,
      engagement: Number(p.engagement),
      likes: Number(p.likes_count),
      comments: Number(p.comments_count),
    }))
    .reverse();

  const hasData = posts.length > 0;

  return (
    <div className="space-y-6">
      {/* Header row */}
      <div className="flex items-center justify-between gap-4">
        <div>
          <div className="text-base font-bold text-slate-950">Facebook Analytics</div>
          <div className="text-xs text-slate-500 mt-0.5">{posts.length} posts synced</div>
        </div>
        <button
          type="button"
          onClick={handleSync}
          disabled={syncing}
          className="inline-flex items-center gap-2 rounded-xl bg-slate-950 px-4 py-2.5 text-sm font-semibold text-white hover:bg-slate-800 disabled:opacity-50"
        >
          <RefreshCcw size={14} className={syncing ? 'animate-spin' : ''} />
          {syncing ? 'Syncing…' : 'Sync Facebook'}
        </button>
      </div>

      {/* Sync result banner */}
      {syncResult && (
        <div className={`rounded-2xl border px-4 py-3 text-sm ${
          syncResult.errors?.length
            ? 'border-amber-200 bg-amber-50 text-amber-800'
            : 'border-emerald-200 bg-emerald-50 text-emerald-800'
        }`}>
          {syncResult.errors?.length ? (
            <>
              <span className="font-semibold">Sync completed with issues.</span>{' '}
              {syncResult.synced} items synced.{' '}
              {syncResult.errors.map((e, i) => <span key={i} className="block mt-1 text-xs">{e}</span>)}
            </>
          ) : (
            <><span className="font-semibold">Sync successful!</span> {syncResult.synced} items updated.</>
          )}
        </div>
      )}

      {/* Page stats snapshot */}
      <div>
        <div className="mb-2 text-xs font-semibold uppercase tracking-[0.18em] text-slate-400">Page</div>
        {stats?.account_name && (
          <div className="mb-3 flex items-center gap-3">
            {stats.picture_url && (
              <img src={stats.picture_url} alt="" className="h-10 w-10 rounded-full object-cover" />
            )}
            <span className="text-sm font-bold text-slate-900">{stats.account_name}</span>
          </div>
        )}
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <StatCard label="Followers" value={fmt(stats?.followers ?? null)} icon={<Users size={16} />} />
          <StatCard label="Page Likes" value={fmt(stats?.page_likes ?? null)} icon={<Heart size={16} />} />
          <StatCard label="Posts" value={fmt(stats?.posts_count ?? null)} icon={<MessageCircle size={16} />} />
          <StatCard label="Engagement Rate" value={stats && stats.engagement_rate !== null ? formatPercent(stats.engagement_rate) : '–'} icon={<TrendingUp size={16} />} />
        </div>
        {stats?.bio && (
          <div className="mt-3 rounded-2xl border border-slate-100 bg-white px-4 py-3 text-sm text-slate-600">{stats.bio}</div>
        )}
        {stats?.synced_at && (
          <div className="mt-1.5 text-xs text-slate-400">
            Last synced {new Date(stats.synced_at).toLocaleString()}
          </div>
        )}
        {!stats?.hasData && (
          <div className="mt-2 rounded-2xl border border-dashed border-slate-200 bg-white px-4 py-3 text-xs text-slate-500">
            No page data yet — click <span className="font-semibold">Sync Facebook</span> to pull your page stats.
          </div>
        )}
      </div>

      {/* Post summary KPIs */}
      {summary && (
        <div>
          <div className="mb-2 text-xs font-semibold uppercase tracking-[0.18em] text-slate-400">Post Performance · All time</div>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5">
            <StatCard label="Posts" value={formatCompactNumber(summary.total_posts)} icon={<MessageCircle size={16} />} />
            <StatCard label="Total Likes" value={formatCompactNumber(summary.total_likes)} icon={<Heart size={16} />} />
            <StatCard label="Comments" value={formatCompactNumber(summary.total_comments)} icon={<MessageCircle size={16} />} />
            <StatCard label="Shares" value={formatCompactNumber(summary.total_shares)} icon={<Share2 size={16} />} />
            <StatCard label="Avg Engagement" value={formatCompactNumber(summary.avg_engagement_per_post)} icon={<TrendingUp size={16} />} />
          </div>
        </div>
      )}

      {!hasData ? (
        <div className="rounded-2xl border border-dashed border-slate-200 bg-white p-8 text-center text-sm text-slate-500">
          <MessageCircle size={32} className="mx-auto mb-3 text-slate-300" />
          <div className="font-semibold text-slate-700">No Facebook posts synced yet</div>
          <div className="mt-1 text-xs">Click <span className="font-semibold">Sync Facebook</span> to pull your post insights.</div>
        </div>
      ) : (
        <>
          {/* Top posts chart */}
          {chartData.length > 0 && (
            <div className="rounded-2xl border border-slate-200 bg-white p-6">
              <div className="text-base font-bold text-slate-950">Top Posts by Engagement</div>
              <div className="text-xs text-slate-500 mt-1">Top 10 posts ranked by total engagement</div>
              <div className="mt-5 h-[260px]">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={chartData} layout="vertical">
                    <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                    <XAxis type="number" tick={{ fill: '#64748b', fontSize: 10 }} />
                    <YAxis type="category" dataKey="name" tick={{ fill: '#64748b', fontSize: 10 }} width={100} />
                    <Tooltip
                      formatter={(value: number, name: string) => [formatCompactNumber(value), name === 'engagement' ? 'Engagement' : name === 'likes' ? 'Likes' : 'Comments']}
                    />
                    <Bar dataKey="engagement" fill="#e2e8f0" radius={[0, 4, 4, 0]} name="Engagement" />
                    <Bar dataKey="likes" fill="#0f172a" radius={[0, 4, 4, 0]} name="Likes" />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </div>
          )}

          {/* Per-post analytics cards */}
          <div>
            <div className="mb-3 text-xs font-semibold uppercase tracking-[0.18em] text-slate-400">
              Posts · {posts.length} synced
            </div>
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {[...posts]
                .sort((a, b) => Number(b.engagement) - Number(a.engagement))
                .map((post) => {
                  return (
                    <div key={post.post_id} className="rounded-2xl border border-slate-200 bg-white overflow-hidden shadow-sm">
                      {/* Thumbnail / Picture */}
                      <div className="relative bg-slate-100 aspect-[4/3] overflow-hidden">
                        {post.picture ? (
                          <img src={post.picture} alt="" className="w-full h-full object-cover" />
                        ) : (
                          <div className="w-full h-full flex items-center justify-center">
                            <MessageCircle size={28} className="text-slate-300" />
                          </div>
                        )}
                        {post.type && (
                          <span className="absolute top-2 left-2 rounded-md bg-black/50 px-2 py-1 text-[10px] text-white/80 font-medium capitalize">
                            {post.type}
                          </span>
                        )}
                      </div>

                      {/* Content */}
                      <div className="p-4 space-y-3">
                        {/* Message */}
                        <div>
                          <div className="font-semibold text-sm text-slate-900 leading-snug line-clamp-3">
                            {post.message || `Post ${post.post_id.slice(0, 8)}`}
                          </div>
                        </div>

                        {/* Metrics grid */}
                        <div className="grid grid-cols-2 gap-2">
                          <div className="rounded-xl bg-slate-50 px-3 py-2">
                            <div className="flex items-center gap-1 text-[10px] font-semibold uppercase tracking-wide text-slate-400 mb-0.5">
                              <Heart size={10} /> Likes
                            </div>
                            <div className="text-base font-black text-slate-900">{formatCompactNumber(post.likes_count)}</div>
                          </div>
                          <div className="rounded-xl bg-slate-50 px-3 py-2">
                            <div className="flex items-center gap-1 text-[10px] font-semibold uppercase tracking-wide text-slate-400 mb-0.5">
                              <MessageCircle size={10} /> Comments
                            </div>
                            <div className="text-base font-black text-slate-900">{formatCompactNumber(post.comments_count)}</div>
                          </div>
                          <div className="rounded-xl bg-slate-50 px-3 py-2">
                            <div className="flex items-center gap-1 text-[10px] font-semibold uppercase tracking-wide text-slate-400 mb-0.5">
                              <Share2 size={10} /> Shares
                            </div>
                            <div className="text-base font-black text-slate-900">{formatCompactNumber(post.shares)}</div>
                          </div>
                          <div className="rounded-xl bg-slate-50 px-3 py-2">
                            <div className="flex items-center gap-1 text-[10px] font-semibold uppercase tracking-wide text-slate-400 mb-0.5">
                              <TrendingUp size={10} /> Engagement
                            </div>
                            <div className="text-base font-black text-slate-900">{formatCompactNumber(post.engagement)}</div>
                          </div>
                          <div className="rounded-xl bg-slate-50 px-3 py-2 col-span-2">
                            <div className="text-[10px] font-semibold uppercase tracking-wide text-slate-400 mb-0.5">Created</div>
                            <div className="text-sm font-semibold text-slate-700">{formatShortDate(post.created_at)}</div>
                          </div>
                        </div>

                        {/* Links */}
                        {post.permalink_url && (
                          <div className="flex items-center pt-2 border-t border-slate-100">
                            <a href={post.permalink_url} target="_blank" rel="noopener noreferrer"
                              className="inline-flex items-center gap-1 text-xs font-semibold text-blue-600 hover:underline">
                              <ExternalLink size={11} /> View on Facebook
                            </a>
                          </div>
                        )}
                      </div>
                    </div>
                  );
                })}
            </div>
          </div>
        </>
      )}
    </div>
  );
}
