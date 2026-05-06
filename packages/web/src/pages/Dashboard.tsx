import { useEffect, useMemo, useState } from 'react';
import {
  ArrowRight,
  Calendar,
  CheckCircle2,
  Clock,
  Edit3,
  FileText,
  ImageIcon,
  LayoutGrid,
  Link2,
  Loader2,
  Palette,
  Plus,
  Sparkles,
  TrendingUp,
  Users,
} from 'lucide-react';
import { BarChart, Bar, XAxis, YAxis, ResponsiveContainer, Tooltip } from 'recharts';
import { blogService, type BlogPost } from '../services/blogService';
import { socialPostService, type SocialAccount } from '../services/socialPostService';
import { designService, type UserDesign } from '../services/designService';
import { useWorkspace } from '../contexts/WorkspaceContext';
import { API_BASE_URL } from '../utils/apiBase';
import type { AppUser } from '../utils/userSession';

type DashboardProps = {
  currentUser: AppUser | null;
};

function tok() {
  return localStorage.getItem('auth_token') ?? '';
}

function formatDate(value?: string | null) {
  if (!value) return 'N/A';
  const dt = new Date(value);
  if (Number.isNaN(dt.getTime())) return 'N/A';
  return dt.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

function relativeDate(value?: string | null) {
  if (!value) return '';
  const dt = new Date(value);
  const now = new Date();
  const diff = Math.floor((now.getTime() - dt.getTime()) / 1000);
  if (diff < 60) return 'just now';
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
  if (diff < 604800) return `${Math.floor(diff / 86400)}d ago`;
  return formatDate(value);
}

// ── Stat card ────────────────────────────────────────────────────────────────

function StatCard({
  label,
  value,
  helper,
  icon: Icon,
  accent,
  onClick,
}: {
  label: string;
  value: number | string | null | undefined;
  helper?: string;
  icon: React.ElementType;
  accent: string;
  onClick?: () => void;
}) {
  const display =
    value === null || value === undefined ? '—' : typeof value === 'number' ? value.toLocaleString() : value;
  return (
    <button
      type="button"
      onClick={onClick}
      className={`rounded-2xl border border-slate-200 bg-white p-5 shadow-sm text-left transition-all hover:shadow-md hover:-translate-y-0.5 ${onClick ? 'cursor-pointer' : 'cursor-default'}`}
    >
      <div
        className="flex h-10 w-10 items-center justify-center rounded-xl"
        style={{ background: `${accent}18` }}
      >
        <Icon size={18} style={{ color: accent }} />
      </div>
      <div className="mt-3">
        <p className="text-2xl font-black text-slate-900">{display}</p>
        <p className="mt-0.5 text-sm font-medium text-slate-600">{label}</p>
        {helper && <p className="mt-0.5 text-xs text-slate-400">{helper}</p>}
      </div>
    </button>
  );
}

// ── Status badge ─────────────────────────────────────────────────────────────

function StatusBadge({ status }: { status: string }) {
  const map: Record<string, string> = {
    published: 'bg-emerald-50 text-emerald-700',
    scheduled: 'bg-blue-50 text-blue-700',
    draft: 'bg-slate-100 text-slate-500',
    todo: 'bg-slate-100 text-slate-500',
    in_progress: 'bg-amber-50 text-amber-700',
    in_review: 'bg-purple-50 text-purple-700',
    done: 'bg-emerald-50 text-emerald-700',
  };
  return (
    <span className={`rounded-full px-2 py-0.5 text-[11px] font-semibold capitalize shrink-0 ${map[status] ?? 'bg-slate-100 text-slate-500'}`}>
      {status.replace('_', ' ')}
    </span>
  );
}

// ── Quick actions ─────────────────────────────────────────────────────────────

function QuickAction({
  icon: Icon,
  label,
  color,
  onClick,
}: {
  icon: React.ElementType;
  label: string;
  color: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex flex-col items-center gap-2 rounded-2xl border border-slate-200 bg-white px-4 py-4 text-center hover:border-indigo-200 hover:shadow-md transition-all group"
    >
      <div
        className="flex h-10 w-10 items-center justify-center rounded-xl group-hover:scale-110 transition-transform"
        style={{ background: `${color}18` }}
      >
        <Icon size={18} style={{ color }} />
      </div>
      <span className="text-[12px] font-semibold text-slate-700">{label}</span>
    </button>
  );
}

// ── Custom tooltip for chart ──────────────────────────────────────────────────

function ChartTooltip({ active, payload, label }: any) {
  if (!active || !payload?.length) return null;
  return (
    <div className="rounded-lg border border-slate-200 bg-white px-3 py-2 shadow-lg text-xs">
      <p className="font-semibold text-slate-700">{label}</p>
      <p className="text-indigo-600">{payload[0]?.value} posts</p>
    </div>
  );
}

// ── Main Dashboard ────────────────────────────────────────────────────────────

export default function Dashboard({ currentUser }: DashboardProps) {
  const { currentProject } = useWorkspace();
  const [posts, setPosts] = useState<BlogPost[]>([]);
  const [accounts, setAccounts] = useState<SocialAccount[]>([]);
  const [designs, setDesigns] = useState<UserDesign[]>([]);
  const [tasks, setTasks] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    setLoading(true);
    setError(null);

    const fetchAll = async () => {
      const [postData, accountData, designData] = await Promise.all([
        blogService.listPosts(),
        socialPostService.listAccounts(),
        designService.list().catch(() => [] as UserDesign[]),
      ]);
      if (!active) return;
      setPosts(postData);
      setAccounts(accountData);
      setDesigns(designData);
    };

    fetchAll()
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

  // Fetch tasks for current project
  useEffect(() => {
    if (!currentProject?.id) return;
    fetch(`${API_BASE_URL}/api/projects/${currentProject.id}/tasks`, {
      headers: { Authorization: `Bearer ${tok()}` },
    })
      .then((r) => r.json())
      .then((d) => setTasks(d.tasks ?? []))
      .catch(() => undefined);
  }, [currentProject?.id]);

  const greetingName =
    currentUser?.name?.trim() ||
    currentUser?.username?.trim() ||
    currentUser?.email.split('@')[0] ||
    'there';
  const now = new Date();
  const hour = now.getHours();
  const greeting = hour < 12 ? 'Good morning' : hour < 17 ? 'Good afternoon' : 'Good evening';
  const dateStr = now.toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' });

  const publishedPosts = useMemo(() => posts.filter((p) => p.status === 'published'), [posts]);
  const scheduledPosts = useMemo(() => posts.filter((p) => p.status === 'scheduled'), [posts]);
  const draftPosts = useMemo(() => posts.filter((p) => p.status === 'draft'), [posts]);
  const recentPosts = useMemo(
    () => [...posts].sort((a, b) => new Date(b.updated_at).getTime() - new Date(a.updated_at).getTime()).slice(0, 6),
    [posts],
  );

  const tasksDone = useMemo(() => tasks.filter((t) => t.status === 'done'), [tasks]);
  const tasksInProgress = useMemo(() => tasks.filter((t) => t.status === 'in_progress'), [tasks]);

  // Post activity chart — last 7 days
  const chartData = useMemo(() => {
    const days = Array.from({ length: 7 }, (_, i) => {
      const d = new Date();
      d.setDate(d.getDate() - (6 - i));
      return {
        day: d.toLocaleDateString(undefined, { weekday: 'short' }),
        date: d.toDateString(),
        posts: 0,
      };
    });
    posts.forEach((p) => {
      const created = new Date(p.created_at ?? p.updated_at).toDateString();
      const slot = days.find((d) => d.date === created);
      if (slot) slot.posts++;
    });
    return days;
  }, [posts]);

  const navigate = (path: string) => {
    window.history.pushState({}, '', path);
    window.dispatchEvent(new PopStateEvent('popstate'));
  };

  return (
    <div className="space-y-7 pb-10">
      {/* ── Greeting + CTA ── */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h1 className="text-3xl font-black text-slate-900">
            {greeting},{' '}
            <span
              className="bg-clip-text text-transparent"
              style={{ backgroundImage: 'linear-gradient(135deg, #6366f1, #818cf8)' }}
            >
              {greetingName}
            </span>{' '}
            👋
          </h1>
          <p className="mt-1 text-sm text-slate-500">{dateStr} — here is your workspace at a glance.</p>
        </div>
        <button
          type="button"
          onClick={() => navigate('/posts')}
          className="inline-flex shrink-0 items-center gap-2 rounded-2xl bg-slate-950 px-5 py-2.5 text-sm font-bold text-white hover:bg-slate-800 transition-colors"
        >
          <Plus size={16} />
          Create a post
        </button>
      </div>

      {loading && (
        <div className="rounded-2xl border border-slate-200 bg-white p-5 flex items-center gap-3 text-sm text-slate-500">
          <Loader2 size={16} className="animate-spin shrink-0" />
          Loading your workspace data…
        </div>
      )}

      {error && (
        <div className="rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{error}</div>
      )}

      {!loading && !error && (
        <>
          {/* ── Quick actions ── */}
          <div>
            <p className="mb-3 text-[11px] font-bold uppercase tracking-widest text-slate-400">Quick Actions</p>
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
              <QuickAction icon={Edit3} label="New Post" color="#6366f1" onClick={() => navigate('/posts')} />
              <QuickAction icon={LayoutGrid} label="All Tasks" color="#f59e0b" onClick={() => navigate('/tasks')} />
              <QuickAction icon={Palette} label="New Design" color="#8b5cf6" onClick={() => navigate('/cards')} />
              <QuickAction icon={Link2} label="Integrations" color="#10b981" onClick={() => navigate('/integrations')} />
            </div>
          </div>

          {/* ── Stat cards ── */}
          <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
            <StatCard
              label="Total Posts"
              value={posts.length}
              helper={`${publishedPosts.length} live`}
              icon={FileText}
              accent="#6366f1"
              onClick={() => navigate('/posts')}
            />
            <StatCard
              label="Published"
              value={publishedPosts.length}
              helper="Live content"
              icon={CheckCircle2}
              accent="#10b981"
              onClick={() => navigate('/posts')}
            />
            <StatCard
              label="Scheduled"
              value={scheduledPosts.length}
              helper="Queued posts"
              icon={Clock}
              accent="#f59e0b"
              onClick={() => navigate('/posts')}
            />
            <StatCard
              label="Drafts"
              value={draftPosts.length}
              helper="In progress"
              icon={Edit3}
              accent="#64748b"
              onClick={() => navigate('/posts')}
            />
            <StatCard
              label="Designs"
              value={designs.length}
              helper="Canvas designs"
              icon={Palette}
              accent="#8b5cf6"
              onClick={() => navigate('/cards')}
            />
            <StatCard
              label="Platforms"
              value={accounts.length}
              helper="Connected"
              icon={Link2}
              accent="#0ea5e9"
              onClick={() => navigate('/integrations')}
            />
          </div>

          {/* ── Tasks row (if project selected) ── */}
          {currentProject && (
            <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
              <div className="flex items-center justify-between mb-4">
                <div className="flex items-center gap-2">
                  <span
                    className="inline-flex h-6 w-6 items-center justify-center rounded-lg text-[11px] font-black text-white"
                    style={{ background: currentProject.color }}
                  >
                    {currentProject.name[0].toUpperCase()}
                  </span>
                  <div>
                    <p className="text-[11px] font-semibold uppercase tracking-widest text-slate-400">Current Project</p>
                    <p className="text-base font-black text-slate-900">{currentProject.name}</p>
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => navigate('/tasks')}
                  className="flex items-center gap-1 text-xs font-semibold text-slate-500 hover:text-slate-900"
                >
                  View all <ArrowRight size={12} />
                </button>
              </div>
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                {[
                  { label: 'Total Tasks', value: tasks.length, color: '#6366f1', bg: '#6366f118' },
                  { label: 'In Progress', value: tasksInProgress.length, color: '#f59e0b', bg: '#f59e0b18' },
                  { label: 'Completed', value: tasksDone.length, color: '#10b981', bg: '#10b98118' },
                  {
                    label: 'Completion',
                    value: tasks.length ? `${Math.round((tasksDone.length / tasks.length) * 100)}%` : '—',
                    color: '#8b5cf6',
                    bg: '#8b5cf618',
                  },
                ].map((s) => (
                  <div key={s.label} className="rounded-xl p-4" style={{ background: s.bg }}>
                    <p className="text-2xl font-black" style={{ color: s.color }}>
                      {typeof s.value === 'number' ? s.value.toLocaleString() : s.value}
                    </p>
                    <p className="mt-0.5 text-xs font-medium text-slate-600">{s.label}</p>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* ── Main 2-col grid ── */}
          <div className="grid grid-cols-1 gap-6 xl:grid-cols-5">
            {/* Left: Activity chart + Recent posts */}
            <div className="xl:col-span-3 space-y-5">
              {/* Activity chart */}
              <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
                <div className="flex items-center justify-between mb-5">
                  <div>
                    <p className="text-[11px] font-bold uppercase tracking-widest text-slate-400">Content</p>
                    <h3 className="text-base font-black text-slate-900">Post Activity (7 days)</h3>
                  </div>
                  <TrendingUp size={16} className="text-slate-400" />
                </div>
                {chartData.every((d) => d.posts === 0) ? (
                  <div className="flex h-24 items-center justify-center text-sm text-slate-400">
                    No posts created in the last 7 days
                  </div>
                ) : (
                  <ResponsiveContainer width="100%" height={120}>
                    <BarChart data={chartData} barSize={16}>
                      <XAxis dataKey="day" tick={{ fontSize: 11, fill: '#94a3b8' }} axisLine={false} tickLine={false} />
                      <YAxis hide allowDecimals={false} />
                      <Tooltip content={<ChartTooltip />} cursor={{ fill: 'rgba(99,102,241,0.06)' }} />
                      <Bar dataKey="posts" fill="#6366f1" radius={[4, 4, 0, 0]} />
                    </BarChart>
                  </ResponsiveContainer>
                )}
              </div>

              {/* Recent posts */}
              <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
                <div className="flex items-center justify-between mb-4">
                  <div>
                    <p className="text-[11px] font-bold uppercase tracking-widest text-slate-400">Posts</p>
                    <h3 className="text-base font-black text-slate-900">Recent Activity</h3>
                  </div>
                  <button
                    type="button"
                    onClick={() => navigate('/posts')}
                    className="flex items-center gap-1 text-xs font-semibold text-slate-500 hover:text-slate-900"
                  >
                    New post <ArrowRight size={12} />
                  </button>
                </div>
                {recentPosts.length === 0 ? (
                  <div className="flex flex-col items-center gap-3 py-8 text-center">
                    <FileText size={32} className="text-slate-200" />
                    <p className="text-sm text-slate-400">No posts yet. Create your first post.</p>
                    <button
                      type="button"
                      onClick={() => navigate('/posts')}
                      className="rounded-xl bg-indigo-600 px-4 py-2 text-xs font-semibold text-white hover:bg-indigo-700"
                    >
                      Create a post
                    </button>
                  </div>
                ) : (
                  <ul className="space-y-2">
                    {recentPosts.map((post) => (
                      <li
                        key={post.id}
                        className="flex items-center justify-between gap-3 rounded-xl px-3 py-2.5 hover:bg-slate-50 transition-colors"
                      >
                        <div className="flex items-center gap-3 min-w-0">
                          <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-slate-100">
                            <FileText size={13} className="text-slate-500" />
                          </div>
                          <div className="min-w-0">
                            <p className="truncate text-sm font-semibold text-slate-900">{post.title || '(Untitled)'}</p>
                            <p className="text-xs text-slate-400">{relativeDate(post.updated_at)}</p>
                          </div>
                        </div>
                        <StatusBadge status={post.status} />
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            </div>

            {/* Right: Platforms + Designs + Scheduled */}
            <div className="xl:col-span-2 space-y-5">
              {/* Connected platforms */}
              <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
                <div className="flex items-center justify-between mb-4">
                  <div>
                    <p className="text-[11px] font-bold uppercase tracking-widest text-slate-400">Platforms</p>
                    <h3 className="text-base font-black text-slate-900">Connected Accounts</h3>
                  </div>
                  <button
                    type="button"
                    onClick={() => navigate('/integrations')}
                    className="flex items-center gap-1 text-xs font-semibold text-slate-500 hover:text-slate-900"
                  >
                    Manage <ArrowRight size={12} />
                  </button>
                </div>
                {accounts.length === 0 ? (
                  <div className="rounded-xl border border-dashed border-slate-200 p-4 text-center">
                    <Link2 size={20} className="mx-auto mb-2 text-slate-300" />
                    <p className="text-xs text-slate-400">No platforms connected yet.</p>
                    <button
                      type="button"
                      onClick={() => navigate('/integrations')}
                      className="mt-2 rounded-lg bg-indigo-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-indigo-700"
                    >
                      Connect now
                    </button>
                  </div>
                ) : (
                  <ul className="space-y-2">
                    {accounts.map((account) => (
                      <li key={account.id} className="flex items-center gap-3 rounded-xl px-3 py-2.5 hover:bg-slate-50">
                        <div className="flex h-8 w-8 items-center justify-center rounded-xl bg-indigo-50">
                          <Users size={13} className="text-indigo-500" />
                        </div>
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-semibold capitalize text-slate-900">{account.platform}</p>
                          <p className="truncate text-xs text-slate-400">
                            {account.account_name || account.account_id}
                          </p>
                        </div>
                        <span className="text-[10px] rounded-full bg-emerald-50 px-2 py-0.5 font-semibold text-emerald-700">
                          Active
                        </span>
                      </li>
                    ))}
                  </ul>
                )}
              </div>

              {/* Designs */}
              <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
                <div className="flex items-center justify-between mb-4">
                  <div>
                    <p className="text-[11px] font-bold uppercase tracking-widest text-slate-400">Cards</p>
                    <h3 className="text-base font-black text-slate-900">Recent Designs</h3>
                  </div>
                  <button
                    type="button"
                    onClick={() => navigate('/cards')}
                    className="flex items-center gap-1 text-xs font-semibold text-slate-500 hover:text-slate-900"
                  >
                    View all <ArrowRight size={12} />
                  </button>
                </div>
                {designs.length === 0 ? (
                  <div className="rounded-xl border border-dashed border-slate-200 p-4 text-center">
                    <ImageIcon size={20} className="mx-auto mb-2 text-slate-300" />
                    <p className="text-xs text-slate-400">No designs yet.</p>
                    <button
                      type="button"
                      onClick={() => navigate('/cards')}
                      className="mt-2 rounded-lg bg-indigo-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-indigo-700"
                    >
                      Create design
                    </button>
                  </div>
                ) : (
                  <div className="grid grid-cols-3 gap-2">
                    {designs.slice(0, 6).map((d) => (
                      <div
                        key={d.id}
                        onClick={() => navigate('/cards')}
                        className="aspect-square cursor-pointer overflow-hidden rounded-xl border border-slate-100 bg-slate-50 hover:border-indigo-200 transition-colors"
                      >
                        {d.thumbnail_url ? (
                          <img src={d.thumbnail_url} alt={d.name} className="h-full w-full object-cover" />
                        ) : (
                          <div className="flex h-full w-full items-center justify-center">
                            <Palette size={18} className="text-slate-300" />
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                )}
              </div>

              {/* Upcoming scheduled */}
              {scheduledPosts.length > 0 && (
                <div className="rounded-2xl border border-blue-100 bg-blue-50 p-5">
                  <div className="flex items-center gap-2 mb-3">
                    <Calendar size={14} className="text-blue-600" />
                    <p className="text-sm font-black text-blue-800">Upcoming Posts</p>
                  </div>
                  <ul className="space-y-2">
                    {scheduledPosts.slice(0, 3).map((p) => (
                      <li key={p.id} className="flex items-center justify-between gap-2">
                        <p className="truncate text-xs font-medium text-blue-800">{p.title || '(Untitled)'}</p>
                        <span className="shrink-0 text-[11px] text-blue-500">
                          {formatDate((p as any).scheduled_at || p.updated_at)}
                        </span>
                      </li>
                    ))}
                  </ul>
                  {scheduledPosts.length > 3 && (
                    <p className="mt-2 text-[11px] text-blue-500">+{scheduledPosts.length - 3} more scheduled</p>
                  )}
                </div>
              )}
            </div>
          </div>

          {/* ── Empty state ── */}
          {posts.length === 0 && accounts.length === 0 && designs.length === 0 && (
            <div className="rounded-2xl border border-dashed border-slate-200 bg-white p-10 text-center">
              <div
                className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-2xl"
                style={{ background: 'linear-gradient(135deg, #eef2ff, #e0e7ff)' }}
              >
                <Sparkles size={28} className="text-indigo-500" />
              </div>
              <h3 className="text-lg font-black text-slate-900">Welcome to your workspace!</h3>
              <p className="mt-2 text-sm text-slate-500">
                Connect a platform, create a post, or start designing to unlock your analytics.
              </p>
              <div className="mt-5 flex flex-wrap justify-center gap-3">
                <button
                  type="button"
                  onClick={() => navigate('/integrations')}
                  className="flex items-center gap-2 rounded-xl border border-slate-200 px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50"
                >
                  <Link2 size={14} /> Connect platform
                </button>
                <button
                  type="button"
                  onClick={() => navigate('/posts')}
                  className="flex items-center gap-2 rounded-xl bg-indigo-600 px-4 py-2 text-sm font-semibold text-white hover:bg-indigo-700"
                >
                  <Plus size={14} /> Create first post
                </button>
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}
