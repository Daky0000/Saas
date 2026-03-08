import { useEffect, useState } from 'react';
import {
  BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer,
  LineChart, Line, CartesianGrid,
} from 'recharts';
import {
  FileText, Link2, Palette, TrendingUp, TrendingDown,
  Calendar, BarChart3, ArrowRight, Zap, Instagram,
  Twitter, Linkedin, Facebook, Globe, CheckCircle2,
} from 'lucide-react';
import { AppUser } from '../utils/userSession';

type DashboardProps = {
  currentUser: AppUser | null;
};

// ── Static mock data (replace with real API calls as features expand) ─────────

const weeklyPostsData = [
  { day: 'Mon', posts: 4 },
  { day: 'Tue', posts: 7 },
  { day: 'Wed', posts: 5 },
  { day: 'Thu', posts: 9 },
  { day: 'Fri', posts: 6 },
  { day: 'Sat', posts: 3 },
  { day: 'Sun', posts: 8 },
];

const engagementData = [
  { day: 'Mon', rate: 3.2 },
  { day: 'Tue', rate: 4.1 },
  { day: 'Wed', rate: 3.8 },
  { day: 'Thu', rate: 5.2 },
  { day: 'Fri', rate: 4.6 },
  { day: 'Sat', rate: 2.9 },
  { day: 'Sun', rate: 5.8 },
];

const connectedPlatforms = [
  { name: 'Instagram', icon: Instagram, color: 'bg-gradient-to-br from-purple-500 to-pink-500', followers: '12.4K', status: 'active' },
  { name: 'LinkedIn',  icon: Linkedin,  color: 'bg-[#0077b5]',                                  followers: '3.1K',  status: 'active' },
  { name: 'Twitter/X', icon: Twitter,   color: 'bg-zinc-900',                                   followers: '8.7K',  status: 'active' },
  { name: 'Facebook',  icon: Facebook,  color: 'bg-[#1877f2]',                                  followers: '5.2K',  status: 'inactive' },
];

const recentActivity = [
  { action: 'Post published', detail: 'Instagram — "5 tips for better engagement"', time: '2h ago', icon: CheckCircle2, color: 'text-emerald-500' },
  { action: 'Card designed',  detail: 'LinkedIn banner — Q4 Campaign',              time: '5h ago', icon: Palette,       color: 'text-purple-500' },
  { action: 'Post scheduled', detail: 'Twitter/X — Product launch thread',          time: '1d ago', icon: Calendar,      color: 'text-blue-500'   },
  { action: 'Analytics peak', detail: 'Instagram engagement up 8.4% this week',     time: '2d ago', icon: TrendingUp,    color: 'text-[#e6332a]'  },
];

// ── Sub-components ─────────────────────────────────────────────────────────────

interface StatCardProps {
  label: string;
  value: string;
  change: string;
  positive: boolean;
  icon: React.ElementType;
  iconBg: string;
  iconColor: string;
}

function StatCard({ label, value, change, positive, icon: Icon, iconBg, iconColor }: StatCardProps) {
  return (
    <div className="group flex flex-col justify-between rounded-3xl border border-slate-200 bg-white p-5 shadow-md transition hover:shadow-md">
      <div className="flex items-start justify-between">
        <div className={`flex h-11 w-11 items-center justify-center rounded-2xl ${iconBg}`}>
          <Icon size={20} className={iconColor} />
        </div>
        <div className={`flex items-center gap-1 rounded-full px-2.5 py-1 text-xs font-bold ${positive ? 'bg-emerald-50 text-emerald-600' : 'bg-red-50 text-red-500'}`}>
          {positive ? <TrendingUp size={11} /> : <TrendingDown size={11} />}
          {change}
        </div>
      </div>
      <div className="mt-4">
        <p className="text-3xl font-black tracking-[-0.03em] text-slate-900">{value}</p>
        <p className="mt-1 text-sm text-slate-500">{label}</p>
      </div>
    </div>
  );
}

// ── Custom tooltip for charts ─────────────────────────────────────────────────
function ChartTooltip({ active, payload, label }: { active?: boolean; payload?: Array<{value: number}>; label?: string }) {
  if (!active || !payload?.length) return null;
  return (
    <div className="rounded-xl border border-slate-200 bg-white px-3 py-2 shadow-lg text-xs">
      <p className="font-bold text-slate-700">{label}</p>
      <p className="text-slate-500">{payload[0].value}</p>
    </div>
  );
}

// ── Main ──────────────────────────────────────────────────────────────────────

function Dashboard({ currentUser }: DashboardProps) {
  const [currentTime, setCurrentTime] = useState(new Date());

  useEffect(() => {
    const timer = setInterval(() => setCurrentTime(new Date()), 60_000);
    return () => clearInterval(timer);
  }, []);

  const preferredName =
    currentUser?.name?.trim() || currentUser?.username?.trim() || currentUser?.email.split('@')[0] || 'there';

  const hour = currentTime.getHours();
  const greeting = hour < 12 ? 'Good morning' : hour < 17 ? 'Good afternoon' : 'Good evening';

  const dateStr = currentTime.toLocaleDateString(undefined, {
    weekday: 'long', month: 'long', day: 'numeric',
  });

  return (
    <div className="space-y-6 pb-8">

      {/* ── Greeting banner ── */}
      <div className="flex flex-col gap-1 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-3xl font-black tracking-[-0.03em] text-slate-900">
            {greeting}, {preferredName} 👋
          </h1>
          <p className="mt-1 text-sm text-slate-500">{dateStr} — here's your workspace overview.</p>
        </div>
        <button
          type="button"
          className="mt-3 flex shrink-0 items-center gap-2 rounded-2xl bg-[#e6332a] px-5 py-2.5 text-sm font-bold text-white shadow-md shadow-red-100 transition hover:bg-[#cc2921] sm:mt-0"
        >
          <Zap size={15} />
          Create a post
        </button>
      </div>

      {/* ── Overview hero card ── */}
      <div className="rounded-[28px] bg-slate-950 p-6 md:p-8 text-white overflow-hidden relative shadow-xl">
        <div className="pointer-events-none absolute -top-12 -right-12 h-48 w-48 rounded-full bg-[#e6332a]/20 blur-3xl" />
        <div className="pointer-events-none absolute top-10 right-32 h-32 w-32 rounded-full bg-blue-500/10 blur-2xl" />
        <div className="flex flex-col gap-6 md:flex-row md:items-center md:justify-between">
          <div>
            <p className="text-xs font-bold uppercase tracking-widest text-slate-400">Platform Overview</p>
            <p className="mt-2 text-4xl font-black tracking-[-0.03em]">42 posts</p>
            <p className="mt-1 text-slate-400 text-sm">published this month across all platforms</p>
          </div>
          <div className="flex flex-wrap gap-8">
            {[
              { label: 'Scheduled',  value: '8',   sub: 'pending publish' },
              { label: 'Reach',      value: '29K',  sub: 'estimated this month' },
              { label: 'Engagement', value: '4.3%', sub: 'avg rate this week' },
            ].map(({ label, value, sub }) => (
              <div key={label} className="flex flex-col">
                <p className="text-2xl font-black tracking-[-0.03em]">{value}</p>
                <p className="text-xs font-semibold text-slate-300">{label}</p>
                <p className="text-[10px] text-slate-500">{sub}</p>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* ── Stat cards row ── */}
      <div className="grid grid-cols-2 gap-4 xl:grid-cols-4">
        <StatCard
          label="Total Posts"
          value="847"
          change="+12%"
          positive
          icon={FileText}
          iconBg="bg-blue-50"
          iconColor="text-blue-600"
        />
        <StatCard
          label="Connected Accounts"
          value="5"
          change="+1"
          positive
          icon={Link2}
          iconBg="bg-emerald-50"
          iconColor="text-emerald-600"
        />
        <StatCard
          label="Card Designs"
          value="112"
          change="+8"
          positive
          icon={Palette}
          iconBg="bg-purple-50"
          iconColor="text-purple-600"
        />
        <StatCard
          label="Weekly Growth"
          value="+12%"
          change="vs last wk"
          positive
          icon={TrendingUp}
          iconBg="bg-orange-50"
          iconColor="text-orange-500"
        />
      </div>

      {/* ── Charts row ── */}
      <div className="grid grid-cols-1 gap-6 xl:grid-cols-5">

        {/* Posts this week bar chart (3/5) */}
        <div className="xl:col-span-3 rounded-[24px] border border-slate-200 bg-white p-6 shadow-md">
          <div className="flex items-center justify-between mb-6">
            <div>
              <p className="text-xs font-bold uppercase tracking-widest text-slate-400">Posts Published</p>
              <h3 className="mt-0.5 text-lg font-black text-slate-900">This Week</h3>
            </div>
            <div className="flex items-center gap-1.5 rounded-xl bg-slate-50 px-3 py-1.5 text-xs font-semibold text-slate-500">
              <BarChart3 size={13} />
              7 days
            </div>
          </div>
          <ResponsiveContainer width="100%" height={200}>
            <BarChart data={weeklyPostsData} barSize={28}>
              <XAxis dataKey="day" axisLine={false} tickLine={false} tick={{ fontSize: 11, fill: '#94a3b8' }} />
              <YAxis hide />
              <Tooltip content={<ChartTooltip />} cursor={{ fill: '#f1f5f9', radius: 8 }} />
              <Bar dataKey="posts" fill="#e6332a" radius={[6, 6, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>

        {/* Engagement rate line chart (2/5) */}
        <div className="xl:col-span-2 rounded-[24px] border border-slate-200 bg-white p-6 shadow-md">
          <div className="mb-6">
            <p className="text-xs font-bold uppercase tracking-widest text-slate-400">Engagement Rate</p>
            <h3 className="mt-0.5 text-lg font-black text-slate-900">This Week</h3>
          </div>
          <ResponsiveContainer width="100%" height={200}>
            <LineChart data={engagementData}>
              <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
              <XAxis dataKey="day" axisLine={false} tickLine={false} tick={{ fontSize: 11, fill: '#94a3b8' }} />
              <YAxis hide />
              <Tooltip content={<ChartTooltip />} />
              <Line
                type="monotone"
                dataKey="rate"
                stroke="#e6332a"
                strokeWidth={2.5}
                dot={{ r: 4, fill: '#e6332a', strokeWidth: 0 }}
                activeDot={{ r: 6 }}
              />
            </LineChart>
          </ResponsiveContainer>
        </div>
      </div>

      {/* ── Bottom row ── */}
      <div className="grid grid-cols-1 gap-6 xl:grid-cols-5">

        {/* Connected platforms (2/5) */}
        <div className="xl:col-span-2 rounded-[24px] border border-slate-200 bg-white p-6 shadow-md">
          <div className="flex items-center justify-between mb-5">
            <div>
              <p className="text-xs font-bold uppercase tracking-widest text-slate-400">Platforms</p>
              <h3 className="mt-0.5 text-base font-black text-slate-900">Connected Accounts</h3>
            </div>
            <button
              type="button"
              className="flex items-center gap-1 text-xs font-semibold text-[#e6332a] hover:text-[#cc2921] transition"
            >
              Manage <ArrowRight size={12} />
            </button>
          </div>
          <ul className="space-y-3">
            {connectedPlatforms.map((p) => (
              <li key={p.name} className="flex items-center gap-3">
                <div className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-xl ${p.color} text-white`}>
                  <p.icon size={16} />
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-bold text-slate-800">{p.name}</p>
                  <p className="text-xs text-slate-400">{p.followers} followers</p>
                </div>
                <span className={`text-[10px] font-bold uppercase rounded-full px-2 py-0.5 ${p.status === 'active' ? 'bg-emerald-50 text-emerald-600' : 'bg-slate-100 text-slate-400'}`}>
                  {p.status}
                </span>
              </li>
            ))}
          </ul>
          <button
            type="button"
            className="mt-5 flex w-full items-center justify-center gap-2 rounded-2xl border border-dashed border-slate-200 py-3 text-xs font-semibold text-slate-400 transition hover:border-slate-300 hover:text-slate-600"
          >
            <Globe size={13} />
            Connect new platform
          </button>
        </div>

        {/* Recent activity (3/5) */}
        <div className="xl:col-span-3 rounded-[24px] border border-slate-200 bg-white p-6 shadow-md">
          <div className="flex items-center justify-between mb-5">
            <div>
              <p className="text-xs font-bold uppercase tracking-widest text-slate-400">Activity</p>
              <h3 className="mt-0.5 text-base font-black text-slate-900">Recent Actions</h3>
            </div>
          </div>
          <ul className="space-y-4">
            {recentActivity.map((item, i) => (
              <li key={i} className="flex items-start gap-3">
                <div className={`mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-xl bg-slate-50 ${item.color}`}>
                  <item.icon size={15} />
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-bold text-slate-800">{item.action}</p>
                  <p className="text-xs text-slate-400 mt-0.5 truncate">{item.detail}</p>
                </div>
                <span className="shrink-0 text-[10px] text-slate-400 mt-0.5">{item.time}</span>
              </li>
            ))}
          </ul>
          <div className="mt-5 flex items-center justify-between rounded-2xl bg-slate-50 px-4 py-3">
            <div className="flex items-center gap-2 text-sm text-slate-600">
              <Zap size={14} className="text-[#e6332a]" />
              <span className="font-semibold">Next scheduled post</span>
              <span className="text-slate-400">in 3 hours</span>
            </div>
            <button
              type="button"
              className="flex items-center gap-1 text-xs font-bold text-[#e6332a] hover:text-[#cc2921] transition"
            >
              View <ArrowRight size={12} />
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

export default Dashboard;
