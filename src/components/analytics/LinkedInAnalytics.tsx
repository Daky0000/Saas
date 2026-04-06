import { useEffect, useState } from 'react';
import { Loader2, RefreshCcw, MessageCircle, ExternalLink, Users, Briefcase } from 'lucide-react';
import { linkedInAnalyticsService, type LinkedInPost, type LinkedInProfileResponse } from '../../services/linkedInAnalyticsService';
import { formatCompactNumber, formatShortDate } from './analyticsUtils';

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

export default function LinkedInAnalytics() {
  const [posts, setPosts] = useState<LinkedInPost[]>([]);
  const [profile, setProfile] = useState<LinkedInProfileResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const [syncResult, setSyncResult] = useState<{ synced: number; errors?: string[] } | null>(null);

  // Load profile and posts data
  const fetchData = async () => {
    setLoading(true);
    try {
      const [postsResult, profileResult] = await Promise.all([
        linkedInAnalyticsService.getPosts({ limit: 50 }),
        linkedInAnalyticsService.getProfile(),
      ]);
      setPosts(postsResult.posts);
      setProfile(profileResult);
    } catch (err) {
      console.error('Failed to load LinkedIn data:', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { fetchData(); }, []);

  const handleSync = async () => {
    setSyncing(true);
    setSyncResult(null);
    try {
      const result = await linkedInAnalyticsService.sync();
      setSyncResult(result);
      // Reload data
      await fetchData();
    } catch (err) {
      setSyncResult({ synced: 0, errors: [err instanceof Error ? err.message : 'Sync failed'] });
    } finally {
      setSyncing(false);
    }
  };

  if (loading && !profile) {
    return (
      <div className="flex items-center justify-center py-20 text-slate-400">
        <Loader2 size={20} className="animate-spin mr-2" /> Loading LinkedIn profile…
      </div>
    );
  }

  if (profile && !profile.hasData) {
    return (
      <div className="rounded-2xl border border-dashed border-slate-200 bg-white p-8 text-center text-sm text-slate-500">
        <MessageCircle size={32} className="mx-auto mb-3 text-slate-300" />
        <div className="font-semibold text-slate-700">No LinkedIn profile data found</div>
        <div className="mt-1 text-xs">Connect your LinkedIn account to view analytics here.</div>
      </div>
    );
  }

  const hasData = posts.length > 0;

  return (
    <div className="space-y-6">
      {/* Header row */}
      <div className="flex items-center justify-between gap-4">
        <div>
          <div className="text-base font-bold text-slate-950">LinkedIn Analytics</div>
          <div className="text-xs text-slate-500 mt-0.5">{posts.length} posts synced</div>
        </div>
        <button
          type="button"
          onClick={handleSync}
          disabled={syncing}
          className="inline-flex items-center gap-2 rounded-xl bg-slate-950 px-4 py-2.5 text-sm font-semibold text-white hover:bg-slate-800 disabled:opacity-50"
        >
          <RefreshCcw size={14} className={syncing ? 'animate-spin' : ''} />
          {syncing ? 'Syncing…' : 'Sync LinkedIn'}
        </button>
      </div>

      {/* Note about personal profile limitations */}
      <div className="rounded-2xl border border-blue-200 bg-blue-50 px-4 py-3 text-sm text-blue-800">
        <div className="font-semibold">Note: Personal Profile Analytics</div>
        <div className="text-xs mt-1">
          LinkedIn restricts detailed analytics APIs for personal profiles. We track your posts and basic profile info. 
          <span className="block mt-1">For full analytics, please connect a LinkedIn Company Page (future enhancement).</span>
        </div>
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

      {/* Profile snapshot */}
      {profile && profile.hasData && (
        <div>
          <div className="mb-2 text-xs font-semibold uppercase tracking-[0.18em] text-slate-400">Profile</div>
          <div className="mb-3 flex items-start gap-4">
            {profile.profile_picture_url && (
              <img src={profile.profile_picture_url} alt="" className="h-12 w-12 rounded-full object-cover" />
            )}
            <div>
              <div className="text-base font-bold text-slate-900">
                {profile.first_name} {profile.last_name}
              </div>
              {profile.headline && (
                <div className="text-sm text-slate-600 mt-0.5">{profile.headline}</div>
              )}
            </div>
          </div>

          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            <StatCard 
              label="Connections" 
              value={fmt(profile.connections_count)} 
              icon={<Users size={16} />} 
            />
            <StatCard 
              label="Posts" 
              value={formatCompactNumber(posts.length)} 
              icon={<MessageCircle size={16} />} 
            />
            <StatCard 
              label="Account Type" 
              value="Personal" 
              icon={<Briefcase size={16} />} 
            />
          </div>

          {profile.synced_at && (
            <div className="mt-1.5 text-xs text-slate-400">
              Last synced {new Date(profile.synced_at).toLocaleString()}
            </div>
          )}
        </div>
      )}

      {!hasData ? (
        <div className="rounded-2xl border border-dashed border-slate-200 bg-white p-8 text-center text-sm text-slate-500">
          <MessageCircle size={32} className="mx-auto mb-3 text-slate-300" />
          <div className="font-semibold text-slate-700">No LinkedIn posts synced yet</div>
          <div className="mt-1 text-xs">Click <span className="font-semibold">Sync LinkedIn</span> to pull your posts.</div>
        </div>
      ) : (
        <>
          {/* Per-post cards */}
          <div>
            <div className="mb-3 text-xs font-semibold uppercase tracking-[0.18em] text-slate-400">
              Posts · {posts.length} synced
            </div>
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {[...posts]
                .sort((a, b) => {
                  const dateA = a.created_at ? new Date(a.created_at).getTime() : 0;
                  const dateB = b.created_at ? new Date(b.created_at).getTime() : 0;
                  return dateB - dateA;
                })
                .map((post) => {
                  return (
                    <div key={post.post_id} className="rounded-2xl border border-slate-200 bg-white overflow-hidden shadow-sm">
                      {/* Content */}
                      <div className="p-4 space-y-3">
                        {/* Text content */}
                        <div>
                          <div className="font-semibold text-sm text-slate-900 leading-snug line-clamp-4">
                            {post.text || `Post · ${post.post_id.slice(0, 8)}`}
                          </div>
                        </div>

                        {/* Media type badge */}
                        {post.media_type && (
                          <div className="inline-block">
                            <span className="rounded-md bg-slate-100 px-2 py-1 text-[10px] text-slate-600 font-medium capitalize">
                              {post.media_type}
                            </span>
                          </div>
                        )}

                        {/* Metadata grid */}
                        <div className="grid grid-cols-2 gap-2">
                          <div className="rounded-xl bg-slate-50 px-3 py-2">
                            <div className="text-[10px] font-semibold uppercase tracking-wide text-slate-400 mb-0.5">
                              Post Type
                            </div>
                            <div className="text-sm font-semibold text-slate-600">{post.media_type || 'Text'}</div>
                          </div>
                          <div className="rounded-xl bg-slate-50 px-3 py-2 col-span-2">
                            <div className="text-[10px] font-semibold uppercase tracking-wide text-slate-400 mb-0.5">Created</div>
                            <div className="text-sm font-semibold text-slate-700">{formatShortDate(post.created_at)}</div>
                          </div>
                        </div>

                        {/* Links */}
                        {post.post_url && (
                          <div className="flex items-center pt-2 border-t border-slate-100">
                            <a href={post.post_url} target="_blank" rel="noopener noreferrer"
                              className="inline-flex items-center gap-1 text-xs font-semibold text-blue-600 hover:underline">
                              <ExternalLink size={11} /> View on LinkedIn
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
