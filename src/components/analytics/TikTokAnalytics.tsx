import { useEffect, useState, useCallback } from 'react';
import { Loader2, RefreshCcw, Eye, Heart, MessageCircle, Share2, TrendingUp, Play, Users } from 'lucide-react';
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
} from 'recharts';
import { tiktokAnalyticsService, type TikTokVideo, type TikTokVideoSummary } from '../../services/tiktokAnalyticsService';
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

export default function TikTokAnalytics({ days }: Props) {
  const [videos, setVideos] = useState<TikTokVideo[]>([]);
  const [summary, setSummary] = useState<TikTokVideoSummary | null>(null);
  const [followers, setFollowers] = useState<number | null>(null);
  const [followersHasData, setFollowersHasData] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [syncing, setSyncing] = useState(false);
  const [syncResult, setSyncResult] = useState<{ synced: number; errors?: string[] } | null>(null);

  const fetchData = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [videosResult, followersResult] = await Promise.all([
        tiktokAnalyticsService.getVideos({ days, limit: 50 }),
        tiktokAnalyticsService.getFollowers(),
      ]);
      setVideos(videosResult.videos);
      setSummary(videosResult.summary);
      setFollowers(followersResult.followers);
      setFollowersHasData(followersResult.hasData ?? false);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load TikTok data');
    } finally {
      setLoading(false);
    }
  }, [days]);

  useEffect(() => { fetchData(); }, [fetchData]);

  const handleSync = async () => {
    setSyncing(true);
    setSyncResult(null);
    try {
      const result = await tiktokAnalyticsService.sync();
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
        <Loader2 size={20} className="animate-spin mr-2" /> Loading TikTok analytics…
      </div>
    );
  }

  if (error) {
    return (
      <div className="rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">{error}</div>
    );
  }

  // Chart data — top 10 by views for the bar chart
  const chartData = [...videos]
    .sort((a, b) => Number(b.views) - Number(a.views))
    .slice(0, 10)
    .map((v, i) => ({
      name: v.title ? v.title.slice(0, 20) + (v.title.length > 20 ? '…' : '') : `Video ${i + 1}`,
      views: Number(v.views),
      likes: Number(v.likes),
      engagement: Number(v.engagement),
    }))
    .reverse();

  const hasData = videos.length > 0;

  return (
    <div className="space-y-6">
      {/* Header row */}
      <div className="flex items-center justify-between gap-4">
        <div>
          <div className="text-base font-bold text-slate-950">TikTok Video Insights</div>
          <div className="text-xs text-slate-500 mt-0.5">Last {days} days · {videos.length} videos synced</div>
        </div>
        <button
          type="button"
          onClick={handleSync}
          disabled={syncing}
          className="inline-flex items-center gap-2 rounded-xl bg-slate-950 px-4 py-2.5 text-sm font-semibold text-white hover:bg-slate-800 disabled:opacity-50"
        >
          <RefreshCcw size={14} className={syncing ? 'animate-spin' : ''} />
          {syncing ? 'Syncing…' : 'Sync TikTok'}
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

      {/* Followers Snapshot */}
      <div className="grid gap-3">
        <StatCard label="Followers" value={followersHasData && followers !== null ? formatCompactNumber(followers) : '–'} icon={<Users size={16} />} />
      </div>

      {/* Summary KPIs */}
      {summary && (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6">
          <StatCard label="Videos" value={formatCompactNumber(summary.total_videos)} icon={<Play size={16} />} />
          <StatCard label="Total Views" value={formatCompactNumber(summary.total_views)} icon={<Eye size={16} />} />
          <StatCard label="Total Likes" value={formatCompactNumber(summary.total_likes)} icon={<Heart size={16} />} />
          <StatCard label="Comments" value={formatCompactNumber(summary.total_comments)} icon={<MessageCircle size={16} />} />
          <StatCard label="Shares" value={formatCompactNumber(summary.total_shares)} icon={<Share2 size={16} />} />
          <StatCard label="Avg Eng. Rate" value={formatPercent(summary.avg_engagement_rate)} icon={<TrendingUp size={16} />} />
        </div>
      )}

      {!hasData ? (
        <div className="rounded-2xl border border-dashed border-slate-200 bg-white p-8 text-center text-sm text-slate-500">
          <Play size={32} className="mx-auto mb-3 text-slate-300" />
          <div className="font-semibold text-slate-700">No TikTok videos synced yet</div>
          <div className="mt-1 text-xs">Click <span className="font-semibold">Sync TikTok</span> to pull your video insights.</div>
        </div>
      ) : (
        <>
          {/* Top videos chart */}
          {chartData.length > 0 && (
            <div className="rounded-2xl border border-slate-200 bg-white p-6">
              <div className="text-base font-bold text-slate-950">Top Videos by Views</div>
              <div className="text-xs text-slate-500 mt-1">Top 10 videos ranked by views</div>
              <div className="mt-5 h-[260px]">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={chartData} layout="vertical">
                    <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                    <XAxis type="number" tick={{ fill: '#64748b', fontSize: 10 }} />
                    <YAxis type="category" dataKey="name" tick={{ fill: '#64748b', fontSize: 10 }} width={100} />
                    <Tooltip
                      formatter={(value: number, name: string) => [formatCompactNumber(value), name === 'views' ? 'Views' : name === 'likes' ? 'Likes' : 'Engagement']}
                    />
                    <Bar dataKey="views" fill="#e2e8f0" radius={[0, 4, 4, 0]} name="Views" />
                    <Bar dataKey="likes" fill="#0f172a" radius={[0, 4, 4, 0]} name="Likes" />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </div>
          )}

          {/* Videos table */}
          <div className="rounded-2xl border border-slate-200 bg-white p-6">
            <div className="text-base font-bold text-slate-950">All Videos</div>
            <div className="text-xs text-slate-500 mt-1">Ranked by engagement</div>
            <div className="mt-4 overflow-x-auto">
              <table className="min-w-full text-sm">
                <thead className="border-b border-slate-200 text-xs uppercase tracking-[0.18em] text-slate-400">
                  <tr>
                    <th className="pb-3 text-left font-semibold">Video</th>
                    <th className="pb-3 text-right font-semibold">Views</th>
                    <th className="pb-3 text-right font-semibold">Likes</th>
                    <th className="pb-3 text-right font-semibold">Comments</th>
                    <th className="pb-3 text-right font-semibold">Shares</th>
                    <th className="pb-3 text-right font-semibold">Eng. Rate</th>
                    <th className="pb-3 text-right font-semibold">Date</th>
                  </tr>
                </thead>
                <tbody>
                  {[...videos]
                    .sort((a, b) => Number(b.engagement) - Number(a.engagement))
                    .map((video) => {
                      const engRate = Number(video.views) > 0
                        ? (Number(video.engagement) / Number(video.views)) * 100
                        : 0;
                      return (
                        <tr key={video.video_id} className="border-b border-slate-100 hover:bg-slate-50">
                          <td className="py-2.5 pr-4 max-w-[240px]">
                            <div className="flex items-center gap-2.5">
                              {video.cover_url ? (
                                <img
                                  src={video.cover_url}
                                  alt=""
                                  className="h-9 w-6 rounded object-cover flex-shrink-0 bg-slate-100"
                                />
                              ) : (
                                <div className="h-9 w-6 rounded bg-slate-100 flex-shrink-0 flex items-center justify-center">
                                  <Play size={10} className="text-slate-400" />
                                </div>
                              )}
                              <div className="min-w-0">
                                <div className="truncate font-medium text-slate-900 max-w-[180px]">
                                  {video.title || `Video ${video.video_id.slice(0, 8)}`}
                                </div>
                                {video.share_url && (
                                  <a
                                    href={video.share_url}
                                    target="_blank"
                                    rel="noopener noreferrer"
                                    className="text-xs text-blue-500 hover:underline"
                                  >
                                    View on TikTok
                                  </a>
                                )}
                              </div>
                            </div>
                          </td>
                          <td className="py-2.5 pr-4 text-right text-slate-600">{formatCompactNumber(video.views)}</td>
                          <td className="py-2.5 pr-4 text-right text-slate-600">{formatCompactNumber(video.likes)}</td>
                          <td className="py-2.5 pr-4 text-right text-slate-600">{formatCompactNumber(video.comments)}</td>
                          <td className="py-2.5 pr-4 text-right text-slate-600">{formatCompactNumber(video.shares)}</td>
                          <td className="py-2.5 pr-4 text-right font-semibold text-slate-900">{formatPercent(engRate)}</td>
                          <td className="py-2.5 text-right text-slate-400">{formatShortDate(video.posted_at)}</td>
                        </tr>
                      );
                    })}
                </tbody>
              </table>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
