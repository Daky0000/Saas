import { useEffect, useMemo, useState } from 'react';
import { ArrowRight, Calendar, FileText, Link2, Loader2, Plus } from 'lucide-react';
import { blogService, type BlogPost } from '../services/blogService';
import { socialPostService, type SocialAccount } from '../services/socialPostService';
import type { AppUser } from '../utils/userSession';

type DashboardProps = {
  currentUser: AppUser | null;
};

function formatDate(value?: string | null) {
  if (!value) return 'N/A';
  const dt = new Date(value);
  if (Number.isNaN(dt.getTime())) return 'N/A';
  return dt.toLocaleDateString();
}

function StatCard({
  label,
  value,
  helper,
  icon: Icon,
}: {
  label: string;
  value: number | string | null | undefined;
  helper?: string;
  icon: React.ElementType;
}) {
  const display = value === null || value === undefined ? 'N/A' : typeof value === 'number' ? value.toLocaleString() : value;
  const muted = value === null || value === undefined;
  return (
    <div className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm">
      <div className="flex items-center justify-between">
        <div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-slate-100 text-slate-600">
          <Icon size={18} />
        </div>
      </div>
      <div className="mt-4">
        <p className={`text-3xl font-black ${muted ? 'text-slate-400' : 'text-slate-900'}`}>{display}</p>
        <p className="mt-1 text-sm text-slate-500">{label}</p>
        {helper ? <p className="mt-1 text-xs text-slate-400">{helper}</p> : null}
      </div>
    </div>
  );
}

export default function Dashboard({ currentUser }: DashboardProps) {
  const [posts, setPosts] = useState<BlogPost[]>([]);
  const [accounts, setAccounts] = useState<SocialAccount[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    setLoading(true);
    setError(null);

    Promise.all([blogService.listPosts(), socialPostService.listAccounts()])
      .then(([postData, accountData]) => {
        if (!active) return;
        setPosts(postData);
        setAccounts(accountData);
      })
      .catch((e) => {
        if (!active) return;
        setError(e instanceof Error ? e.message : 'Failed to load dashboard data');
      })
      .finally(() => {
        if (!active) return;
        setLoading(false);
      });

    return () => {
      active = false;
    };
  }, []);

  const greetingName = currentUser?.name?.trim() || currentUser?.username?.trim() || currentUser?.email.split('@')[0] || 'there';
  const now = new Date();
  const hour = now.getHours();
  const greeting = hour < 12 ? 'Good morning' : hour < 17 ? 'Good afternoon' : 'Good evening';
  const dateStr = now.toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' });

  const publishedPosts = useMemo(() => posts.filter((p) => p.status === 'published'), [posts]);
  const scheduledPosts = useMemo(() => posts.filter((p) => p.status === 'scheduled'), [posts]);
  const recentPosts = useMemo(
    () =>
      [...posts]
        .sort((a, b) => new Date(b.updated_at).getTime() - new Date(a.updated_at).getTime())
        .slice(0, 5),
    [posts]
  );

  const handleCreatePost = () => {
    window.history.pushState({}, '', '/posts');
    window.dispatchEvent(new PopStateEvent('popstate'));
  };

  const handleIntegrations = () => {
    window.history.pushState({}, '', '/integrations');
    window.dispatchEvent(new PopStateEvent('popstate'));
  };

  return (
    <div className="space-y-6 pb-8">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-3xl font-black text-slate-900">{greeting}, {greetingName}</h1>
          <p className="mt-1 text-sm text-slate-500">{dateStr} - here is your workspace overview.</p>
        </div>
        <button
          type="button"
          onClick={handleCreatePost}
          className="inline-flex items-center gap-2 rounded-2xl bg-slate-950 px-5 py-2.5 text-sm font-bold text-white hover:bg-slate-800"
        >
          <Plus size={16} /> Create a post
        </button>
      </div>

      {loading ? (
        <div className="rounded-2xl border border-slate-200 bg-white p-6 text-sm text-slate-500">
          <Loader2 size={18} className="inline-block animate-spin mr-2" /> Loading dashboard data...
        </div>
      ) : null}

      {error ? (
        <div className="rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{error}</div>
      ) : null}

      {!loading && !error && posts.length === 0 && accounts.length === 0 ? (
        <div className="rounded-2xl border border-slate-200 bg-white p-8 text-center">
          <div className="text-lg font-black text-slate-900">Welcome! Let us get started</div>
          <p className="mt-2 text-sm text-slate-500">Connect a platform or create your first post to unlock analytics.</p>
          <div className="mt-4 flex flex-col gap-2 sm:flex-row sm:justify-center">
            <button
              type="button"
              onClick={handleIntegrations}
              className="inline-flex items-center gap-2 rounded-xl border border-slate-200 px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50"
            >
              <Link2 size={14} /> Connect a platform
            </button>
            <button
              type="button"
              onClick={handleCreatePost}
              className="inline-flex items-center gap-2 rounded-xl bg-slate-950 px-4 py-2 text-sm font-semibold text-white hover:bg-slate-800"
            >
              <Plus size={14} /> Create first post
            </button>
          </div>
        </div>
      ) : null}

      <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-4">
        <StatCard label="Total Posts" value={posts.length} helper="All statuses" icon={FileText} />
        <StatCard label="Published Posts" value={publishedPosts.length} helper="Live content" icon={FileText} />
        <StatCard label="Scheduled Posts" value={scheduledPosts.length} helper="Queued" icon={Calendar} />
        <StatCard label="Connected Platforms" value={accounts.length} helper="Accounts linked" icon={Link2} />
      </div>

      <div className="grid grid-cols-1 gap-6 xl:grid-cols-2">
        <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
          <div className="flex items-center justify-between mb-4">
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.2em] text-slate-400">Platforms</p>
              <h3 className="mt-1 text-base font-black text-slate-900">Connected Accounts</h3>
            </div>
            <button
              type="button"
              onClick={handleIntegrations}
              className="inline-flex items-center gap-1 text-xs font-semibold text-slate-600 hover:text-slate-900"
            >
              Manage <ArrowRight size={12} />
            </button>
          </div>
          {accounts.length === 0 ? (
            <div className="text-sm text-slate-500">No platforms connected yet.</div>
          ) : (
            <ul className="space-y-3">
              {accounts.map((account) => (
                <li key={account.id} className="flex items-center justify-between gap-3">
                  <div>
                    <div className="text-sm font-semibold text-slate-900">
                      {account.platform.charAt(0).toUpperCase() + account.platform.slice(1)}
                    </div>
                    <div className="text-xs text-slate-500">{account.account_name || account.account_id}</div>
                  </div>
                  <div className="text-xs text-slate-400">Followers: N/A</div>
                </li>
              ))}
            </ul>
          )}
        </div>

        <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
          <div className="flex items-center justify-between mb-4">
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.2em] text-slate-400">Posts</p>
              <h3 className="mt-1 text-base font-black text-slate-900">Recent Activity</h3>
            </div>
            <button
              type="button"
              onClick={handleCreatePost}
              className="inline-flex items-center gap-1 text-xs font-semibold text-slate-600 hover:text-slate-900"
            >
              New post <ArrowRight size={12} />
            </button>
          </div>
          {recentPosts.length === 0 ? (
            <div className="text-sm text-slate-500">No posts yet. Create a post to see activity here.</div>
          ) : (
            <ul className="space-y-3">
              {recentPosts.map((post) => (
                <li key={post.id} className="flex items-center justify-between gap-3">
                  <div className="min-w-0">
                    <div className="truncate text-sm font-semibold text-slate-900">{post.title || '(Untitled)'}</div>
                    <div className="text-xs text-slate-500">{post.status} • {formatDate(post.updated_at)}</div>
                  </div>
                  <span className="text-xs text-slate-400">{post.status === 'scheduled' ? 'Scheduled' : 'Saved'}</span>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </div>
  );
}
