import { useCallback, useEffect, useState } from 'react';
import {
  CheckCircle, ChevronRight, Loader2, RefreshCw, Sparkles,
  Target, Users, Globe, MessageSquare, BarChart2, Zap,
  CheckSquare, Square, Clock, ThumbsUp, ThumbsDown, X,
  Pencil, Bot, Play, PlayCircle, ArrowRight, Network,
  FileText, ExternalLink, Lightbulb, LayoutList,
  type LucideIcon,
} from 'lucide-react';
import { getApiBaseUrl } from '../utils/apiBase';

function tok() { return localStorage.getItem('auth_token') ?? ''; }
const BASE = () => getApiBaseUrl();

// ── Types ──────────────────────────────────────────────────────────────────────

type BrandProfile = {
  id: string;
  user_id: string;
  brand_name: string;
  niche: string;
  tone: string;
  audience: string;
  goals: string[];
  platforms: string[];
  website: string;
  extra_notes: string;
  setup_done: boolean;
  updated_at: string;
};

type AgentTask = {
  id: string;
  agent_key: string;
  task_type: string;
  title: string;
  body: string;
  payload: Record<string, any>;
  status: 'pending' | 'approved' | 'rejected' | 'expired';
  expires_at: string;
  decided_at: string | null;
  created_at: string;
};

type AgentDraft = {
  id: string;
  agent_key: string;
  task_id: string | null;
  task_type: string;
  title: string;
  content: string;
  payload: Record<string, any>;
  blog_post_id: string | null;
  created_at: string;
};

type ExecToast = {
  message: string;
  blog_post_id?: string | null;
};

// ── Constants ──────────────────────────────────────────────────────────────────

const AGENT_DEFS = [
  {
    key: 'daky', name: 'Daky', role: 'Content Writer', icon: '✦', color: '#5b6cf9',
    description: 'Crafts social media captions, blog posts, and marketing copy tailored to your brand voice.',
  },
  {
    key: 'nova', name: 'Nova', role: 'Creative Director', icon: '◉', color: '#EC4899',
    description: 'Generates branded visuals, images, and video concepts using AI image generators.',
  },
  {
    key: 'sage', name: 'Sage', role: 'Strategy Analyst', icon: '◈', color: '#10B981',
    description: 'Builds marketing strategies, competitor analyses, and 30-day content roadmaps.',
  },
  {
    key: 'aria', name: 'Aria', role: 'Analytics & Performance', icon: '⊕', color: '#F59E0B',
    description: 'Tracks KPIs, surfaces performance insights, and recommends data-driven optimisations.',
  },
  {
    key: 'flux', name: 'Flux', role: 'Automation & Workflows', icon: '⟳', color: '#8B5CF6',
    description: 'Automates post scheduling, platform integrations, and workflow orchestration.',
  },
];

const NICHES = [
  'E-commerce', 'SaaS / Tech', 'Coaching & Consulting', 'Health & Wellness',
  'Fashion & Beauty', 'Food & Beverage', 'Real Estate', 'Finance',
  'Education', 'Fitness', 'Travel', 'Gaming', 'Entertainment', 'Non-profit', 'Other',
];

const TONES = [
  'Professional', 'Casual & Friendly', 'Bold & Confident', 'Inspirational',
  'Humorous', 'Educational', 'Luxury & Premium', 'Minimalist',
];

const GOAL_OPTIONS = [
  'Grow followers', 'Increase engagement', 'Drive website traffic',
  'Generate leads', 'Boost sales', 'Build brand awareness',
  'Launch a product', 'Nurture existing audience',
];

const PLATFORM_OPTIONS = [
  'Instagram', 'Facebook', 'Twitter / X', 'LinkedIn',
  'TikTok', 'YouTube', 'Pinterest', 'Threads',
];

// ── Brand Wizard ───────────────────────────────────────────────────────────────

type WizardStep = 1 | 2 | 3 | 4;

function BrandWizard({
  initial,
  onSaved,
}: {
  initial: BrandProfile | null;
  onSaved: (p: BrandProfile) => void;
}) {
  const [step, setStep] = useState<WizardStep>(1);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [brandName, setBrandName] = useState(initial?.brand_name ?? '');
  const [niche, setNiche]         = useState(initial?.niche ?? '');
  const [website, setWebsite]     = useState(initial?.website ?? '');
  const [tone, setTone]           = useState(initial?.tone ?? '');
  const [audience, setAudience]   = useState(initial?.audience ?? '');
  const [goals, setGoals]         = useState<string[]>(initial?.goals ?? []);
  const [platforms, setPlatforms] = useState<string[]>(initial?.platforms ?? []);
  const [extraNotes, setExtraNotes] = useState(initial?.extra_notes ?? '');

  const toggleGoal = (g: string) =>
    setGoals((prev) => prev.includes(g) ? prev.filter((x) => x !== g) : [...prev, g]);

  const togglePlatform = (p: string) =>
    setPlatforms((prev) => prev.includes(p) ? prev.filter((x) => x !== p) : [...prev, p]);

  const save = async (done: boolean) => {
    setSaving(true); setError(null);
    try {
      const res = await fetch(`${BASE()}/api/user/brand-profile`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${tok()}` },
        body: JSON.stringify({
          brand_name: brandName, niche, tone, audience, goals, platforms,
          website, extra_notes: extraNotes, setup_done: done,
        }),
      });
      const d = await res.json();
      if (!d.success) throw new Error(d.error ?? 'Save failed');
      onSaved(d.profile);
      if (done) return;
      setStep((s) => (s < 4 ? ((s + 1) as WizardStep) : s));
    } catch (e: any) {
      setError(e.message);
    } finally {
      setSaving(false);
    }
  };

  const STEPS = [
    { num: 1, label: 'Brand' },
    { num: 2, label: 'Audience' },
    { num: 3, label: 'Goals' },
    { num: 4, label: 'Confirm' },
  ];

  return (
    <div className="rounded-2xl border border-emerald-200 bg-gradient-to-br from-emerald-50 to-white p-6 shadow-sm">
      {/* Header */}
      <div className="flex items-start gap-3 mb-6">
        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl text-xl"
          style={{ background: '#10B98118', color: '#10B981' }}>
          ◈
        </div>
        <div>
          <p className="font-black text-slate-950 tracking-tight">
            {initial?.setup_done ? 'Edit Brand Profile' : 'Set up your brand with Sage'}
          </p>
          <p className="text-xs text-slate-500 mt-0.5">
            Your AI team reads this profile to tailor every piece of content to your brand.
          </p>
        </div>
      </div>

      {/* Step progress */}
      <div className="flex items-center gap-1 mb-6">
        {STEPS.map((s, i) => (
          <div key={s.num} className="flex items-center gap-1">
            <button
              type="button"
              onClick={() => setStep(s.num as WizardStep)}
              className={`flex h-6 w-6 items-center justify-center rounded-full text-[11px] font-bold transition ${
                step === s.num
                  ? 'bg-emerald-500 text-white'
                  : step > s.num
                  ? 'bg-emerald-200 text-emerald-700'
                  : 'bg-slate-100 text-slate-400'
              }`}
            >
              {step > s.num ? <CheckCircle size={12} /> : s.num}
            </button>
            <span className={`text-[11px] font-medium ${step === s.num ? 'text-emerald-700' : 'text-slate-400'}`}>
              {s.label}
            </span>
            {i < STEPS.length - 1 && <div className="w-4 h-px bg-slate-200 mx-1" />}
          </div>
        ))}
      </div>

      {/* Step 1 — Brand basics */}
      {step === 1 && (
        <div className="space-y-4">
          <div>
            <label className="block text-xs font-semibold text-slate-600 mb-1">Brand / Business Name</label>
            <input value={brandName} onChange={(e) => setBrandName(e.target.value)}
              className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-sm text-slate-800 outline-none focus:border-emerald-400 focus:ring-1 focus:ring-emerald-300"
              placeholder="e.g. Dakyworld Studio" />
          </div>
          <div>
            <label className="block text-xs font-semibold text-slate-600 mb-1">Industry / Niche</label>
            <div className="flex flex-wrap gap-1.5">
              {NICHES.map((n) => (
                <button key={n} type="button" onClick={() => setNiche(n)}
                  className={`rounded-full px-3 py-1 text-xs font-semibold transition ${
                    niche === n
                      ? 'bg-emerald-500 text-white'
                      : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
                  }`}>
                  {n}
                </button>
              ))}
            </div>
          </div>
          <div>
            <label className="block text-xs font-semibold text-slate-600 mb-1">Website (optional)</label>
            <input value={website} onChange={(e) => setWebsite(e.target.value)}
              className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-sm text-slate-800 outline-none focus:border-emerald-400 focus:ring-1 focus:ring-emerald-300"
              placeholder="https://yourwebsite.com" type="url" />
          </div>
        </div>
      )}

      {/* Step 2 — Audience & tone */}
      {step === 2 && (
        <div className="space-y-4">
          <div>
            <label className="block text-xs font-semibold text-slate-600 mb-1">Target Audience</label>
            <textarea value={audience} onChange={(e) => setAudience(e.target.value)} rows={3}
              className="w-full resize-none rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-sm text-slate-800 outline-none focus:border-emerald-400 focus:ring-1 focus:ring-emerald-300"
              placeholder="e.g. Entrepreneurs aged 25–40 who want to grow their online presence…" />
          </div>
          <div>
            <label className="block text-xs font-semibold text-slate-600 mb-1">Brand Tone</label>
            <div className="flex flex-wrap gap-1.5">
              {TONES.map((t) => (
                <button key={t} type="button" onClick={() => setTone(t)}
                  className={`rounded-full px-3 py-1 text-xs font-semibold transition ${
                    tone === t
                      ? 'bg-emerald-500 text-white'
                      : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
                  }`}>
                  {t}
                </button>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* Step 3 — Goals & platforms */}
      {step === 3 && (
        <div className="space-y-4">
          <div>
            <label className="block text-xs font-semibold text-slate-600 mb-2">Marketing Goals (select all that apply)</label>
            <div className="grid grid-cols-2 gap-1.5">
              {GOAL_OPTIONS.map((g) => (
                <button key={g} type="button" onClick={() => toggleGoal(g)}
                  className={`flex items-center gap-2 rounded-xl border px-3 py-2 text-xs font-medium text-left transition ${
                    goals.includes(g)
                      ? 'border-emerald-300 bg-emerald-50 text-emerald-700'
                      : 'border-slate-200 bg-white text-slate-600 hover:border-slate-300'
                  }`}>
                  {goals.includes(g) ? <CheckSquare size={12} className="text-emerald-500 shrink-0" /> : <Square size={12} className="text-slate-300 shrink-0" />}
                  {g}
                </button>
              ))}
            </div>
          </div>
          <div>
            <label className="block text-xs font-semibold text-slate-600 mb-2">Active Platforms</label>
            <div className="flex flex-wrap gap-1.5">
              {PLATFORM_OPTIONS.map((p) => (
                <button key={p} type="button" onClick={() => togglePlatform(p)}
                  className={`rounded-full px-3 py-1 text-xs font-semibold transition ${
                    platforms.includes(p)
                      ? 'bg-emerald-500 text-white'
                      : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
                  }`}>
                  {p}
                </button>
              ))}
            </div>
          </div>
          <div>
            <label className="block text-xs font-semibold text-slate-600 mb-1">Additional Notes (optional)</label>
            <textarea value={extraNotes} onChange={(e) => setExtraNotes(e.target.value)} rows={2}
              className="w-full resize-none rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-sm text-slate-800 outline-none focus:border-emerald-400 focus:ring-1 focus:ring-emerald-300"
              placeholder="Anything else your AI team should know about your brand…" />
          </div>
        </div>
      )}

      {/* Step 4 — Confirm */}
      {step === 4 && (
        <div className="space-y-3">
          <div className="rounded-xl border border-slate-200 bg-white divide-y divide-slate-100">
            {[
              { label: 'Brand', value: brandName || '—' },
              { label: 'Niche', value: niche || '—' },
              { label: 'Tone', value: tone || '—' },
              { label: 'Audience', value: audience.slice(0, 80) + (audience.length > 80 ? '…' : '') || '—' },
              { label: 'Goals', value: goals.length ? goals.join(', ') : '—' },
              { label: 'Platforms', value: platforms.length ? platforms.join(', ') : '—' },
              { label: 'Website', value: website || '—' },
            ].map((row) => (
              <div key={row.label} className="flex items-start gap-3 px-4 py-2.5">
                <span className="w-20 shrink-0 text-[11px] font-bold uppercase tracking-wide text-slate-400">{row.label}</span>
                <span className="text-sm text-slate-700">{row.value}</span>
              </div>
            ))}
          </div>
          {extraNotes && (
            <p className="text-xs text-slate-500 italic px-1">{extraNotes}</p>
          )}
        </div>
      )}

      {error && (
        <p className="mt-3 text-xs text-red-600">{error}</p>
      )}

      {/* Footer buttons */}
      <div className="flex items-center justify-between mt-5">
        <button type="button" onClick={() => setStep((s) => (s > 1 ? ((s - 1) as WizardStep) : s))}
          disabled={step === 1}
          className="rounded-xl border border-slate-200 px-4 py-2 text-xs font-semibold text-slate-600 hover:bg-slate-50 transition disabled:opacity-40">
          Back
        </button>
        {step < 4 ? (
          <button type="button" onClick={() => save(false)} disabled={saving}
            className="flex items-center gap-1.5 rounded-xl px-5 py-2 text-xs font-bold text-white transition disabled:opacity-50"
            style={{ background: '#10B981' }}>
            {saving ? <Loader2 size={12} className="animate-spin" /> : null}
            Save & Continue <ChevronRight size={13} />
          </button>
        ) : (
          <button type="button" onClick={() => save(true)} disabled={saving}
            className="flex items-center gap-1.5 rounded-xl px-5 py-2 text-xs font-bold text-white transition disabled:opacity-50"
            style={{ background: '#10B981' }}>
            {saving ? <Loader2 size={12} className="animate-spin" /> : <CheckCircle size={13} />}
            Complete Setup
          </button>
        )}
      </div>
    </div>
  );
}

// ── Agent Cards ────────────────────────────────────────────────────────────────

function AgentCard({
  agent, ready, lastRunAt, onRun, running,
}: {
  agent: typeof AGENT_DEFS[number];
  ready: boolean;
  lastRunAt: string | null;
  onRun: (key: string) => void;
  running: boolean;
}) {
  const lastRunLabel = lastRunAt
    ? (() => {
        const diff = Date.now() - new Date(lastRunAt).getTime();
        const mins = Math.floor(diff / 60000);
        if (mins < 1) return 'Just now';
        if (mins < 60) return `${mins}m ago`;
        const hrs = Math.floor(mins / 60);
        if (hrs < 24) return `${hrs}h ago`;
        return `${Math.floor(hrs / 24)}d ago`;
      })()
    : null;

  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm hover:shadow-md transition flex flex-col">
      <div className="flex items-start gap-3 mb-3">
        <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl text-2xl font-black select-none"
          style={{ background: `${agent.color}18`, color: agent.color }}>
          {running ? <Loader2 size={20} className="animate-spin" style={{ color: agent.color }} /> : agent.icon}
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="font-black text-lg tracking-tight" style={{ color: agent.color }}>{agent.name}</span>
            <span className={`inline-block rounded-full px-2 py-0.5 text-[10px] font-bold ${
              running ? 'bg-blue-100 text-blue-600' :
              ready   ? 'bg-emerald-100 text-emerald-600' : 'bg-amber-100 text-amber-600'
            }`}>
              {running ? 'Running…' : ready ? 'Ready' : 'Setup needed'}
            </span>
          </div>
          <p className="text-xs text-slate-500">{agent.role}</p>
        </div>
      </div>
      <p className="text-xs text-slate-500 leading-relaxed flex-1">{agent.description}</p>
      <div className="flex items-center justify-between mt-4 pt-3 border-t border-slate-100">
        <span className="text-[11px] text-slate-400">
          {lastRunLabel ? `Last run: ${lastRunLabel}` : 'Never run'}
        </span>
        <button
          type="button"
          disabled={!ready || running}
          onClick={() => onRun(agent.key)}
          className="flex items-center gap-1.5 rounded-xl px-3 py-1.5 text-xs font-bold text-white transition disabled:opacity-40 disabled:cursor-not-allowed"
          style={{ background: ready && !running ? agent.color : '#94a3b8' }}
          title={!ready ? 'Complete brand setup to run this agent' : `Run ${agent.name}`}
        >
          {running ? <Loader2 size={11} className="animate-spin" /> : <Play size={11} />}
          {running ? 'Running…' : 'Run'}
        </button>
      </div>
      {!ready && (
        <p className="mt-2 text-[11px] text-amber-600 font-medium">
          Complete your brand profile to activate this agent.
        </p>
      )}
    </div>
  );
}

// ── Approval Queue ─────────────────────────────────────────────────────────────

const AGENT_COLORS: Record<string, string> = {
  daky: '#5b6cf9', nova: '#EC4899', sage: '#10B981', aria: '#F59E0B', flux: '#8B5CF6',
};
const AGENT_ICONS: Record<string, string> = {
  daky: '✦', nova: '◉', sage: '◈', aria: '⊕', flux: '⟳',
};

const STATUS_STYLES: Record<AgentTask['status'], string> = {
  pending:  'bg-amber-100 text-amber-700',
  approved: 'bg-emerald-100 text-emerald-700',
  rejected: 'bg-red-100 text-red-600',
  expired:  'bg-slate-100 text-slate-500',
};

function ApprovalQueue({
  tasks,
  onDecide,
}: {
  tasks: AgentTask[];
  onDecide: (id: string, decision: 'approved' | 'rejected') => Promise<void>;
}) {
  const [deciding, setDeciding] = useState<Record<string, boolean>>({});

  const decide = async (id: string, decision: 'approved' | 'rejected') => {
    setDeciding((d) => ({ ...d, [id]: true }));
    await onDecide(id, decision);
    setDeciding((d) => ({ ...d, [id]: false }));
  };

  const pending = tasks.filter((t) => t.status === 'pending');
  const history = tasks.filter((t) => t.status !== 'pending').slice(0, 10);

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="text-base font-black text-slate-950 tracking-tight">Approval Queue</h3>
        {pending.length > 0 && (
          <span className="rounded-full bg-amber-500 text-white text-[11px] font-bold px-2 py-0.5">
            {pending.length} pending
          </span>
        )}
      </div>

      {pending.length === 0 && history.length === 0 && (
        <div className="rounded-2xl border border-dashed border-slate-200 bg-slate-50 py-12 text-center">
          <Bot size={28} className="mx-auto text-slate-300 mb-2" />
          <p className="text-sm font-semibold text-slate-400">No proposals yet</p>
          <p className="text-xs text-slate-400 mt-1">Your agents will surface proposals here once active.</p>
        </div>
      )}

      {pending.map((task) => {
        const color = AGENT_COLORS[task.agent_key] ?? '#5b6cf9';
        const icon  = AGENT_ICONS[task.agent_key] ?? '◆';
        const expiresIn = Math.max(0, Math.round((new Date(task.expires_at).getTime() - Date.now()) / 3600000));
        return (
          <div key={task.id} className="rounded-2xl border border-amber-200 bg-white p-5 shadow-sm">
            <div className="flex items-start gap-3">
              <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl text-lg font-black select-none"
                style={{ background: `${color}18`, color }}>
                {icon}
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 flex-wrap mb-1">
                  <span className="text-xs font-bold uppercase tracking-wide" style={{ color }}>
                    {task.agent_key}
                  </span>
                  <span className="text-[10px] font-semibold text-slate-400 bg-slate-100 rounded-full px-2 py-0.5">
                    {task.task_type}
                  </span>
                  <span className="flex items-center gap-1 text-[10px] text-amber-600 font-semibold">
                    <Clock size={10} /> {expiresIn}h left
                  </span>
                </div>
                <p className="text-sm font-semibold text-slate-900 mb-1">{task.title}</p>
                {task.body && (
                  <p className="text-xs text-slate-500 leading-relaxed">{task.body}</p>
                )}
              </div>
            </div>
            <div className="flex items-center gap-2 mt-4 justify-end">
              <button type="button"
                disabled={deciding[task.id]}
                onClick={() => decide(task.id, 'rejected')}
                className="flex items-center gap-1.5 rounded-xl border border-red-200 px-3 py-1.5 text-xs font-bold text-red-600 hover:bg-red-50 transition disabled:opacity-50">
                {deciding[task.id] ? <Loader2 size={11} className="animate-spin" /> : <ThumbsDown size={11} />}
                Reject
              </button>
              <button type="button"
                disabled={deciding[task.id]}
                onClick={() => decide(task.id, 'approved')}
                className="flex items-center gap-1.5 rounded-xl px-4 py-1.5 text-xs font-bold text-white transition disabled:opacity-50"
                style={{ background: '#10B981' }}>
                {deciding[task.id] ? <Loader2 size={11} className="animate-spin" /> : <ThumbsUp size={11} />}
                Approve
              </button>
            </div>
          </div>
        );
      })}

      {history.length > 0 && (
        <div>
          <p className="text-[11px] font-bold uppercase tracking-wide text-slate-400 mb-2">Recent Decisions</p>
          <div className="space-y-2">
            {history.map((task) => {
              const color = AGENT_COLORS[task.agent_key] ?? '#5b6cf9';
              const icon  = AGENT_ICONS[task.agent_key] ?? '◆';
              return (
                <div key={task.id} className="flex items-center gap-3 rounded-xl border border-slate-100 bg-white px-4 py-2.5">
                  <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg text-sm"
                    style={{ background: `${color}18`, color }}>
                    {icon}
                  </div>
                  <p className="flex-1 text-xs text-slate-700 truncate">{task.title}</p>
                  <span className={`rounded-full px-2 py-0.5 text-[10px] font-bold ${STATUS_STYLES[task.status]}`}>
                    {task.status}
                  </span>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}

// ── Brand Profile Summary Card ─────────────────────────────────────────────────

function BrandCard({
  profile,
  onEdit,
}: {
  profile: BrandProfile;
  onEdit: () => void;
}) {
  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2">
          <div className="flex h-8 w-8 items-center justify-center rounded-xl text-base"
            style={{ background: '#10B98118', color: '#10B981' }}>◈</div>
          <div>
            <p className="font-black text-slate-950 tracking-tight">{profile.brand_name || 'Your Brand'}</p>
            <p className="text-[11px] text-slate-400">{profile.niche || 'No niche set'}</p>
          </div>
        </div>
        <button type="button" onClick={onEdit}
          className="flex items-center gap-1.5 rounded-xl border border-slate-200 px-3 py-1.5 text-xs font-semibold text-slate-600 hover:bg-slate-50 transition">
          <Pencil size={11} /> Edit
        </button>
      </div>
      <div className="grid grid-cols-2 gap-2 text-xs">
        {profile.tone && (
          <div className="flex items-center gap-1.5 rounded-lg bg-slate-50 px-2.5 py-1.5">
            <MessageSquare size={11} className="text-slate-400" />
            <span className="text-slate-600 font-medium">{profile.tone}</span>
          </div>
        )}
        {profile.audience && (
          <div className="flex items-center gap-1.5 rounded-lg bg-slate-50 px-2.5 py-1.5">
            <Users size={11} className="text-slate-400" />
            <span className="text-slate-600 font-medium truncate">{profile.audience.slice(0, 35)}</span>
          </div>
        )}
        {profile.website && (
          <div className="flex items-center gap-1.5 rounded-lg bg-slate-50 px-2.5 py-1.5">
            <Globe size={11} className="text-slate-400" />
            <span className="text-slate-600 font-medium truncate">{profile.website.replace(/^https?:\/\//, '')}</span>
          </div>
        )}
        {profile.platforms.length > 0 && (
          <div className="flex items-center gap-1.5 rounded-lg bg-slate-50 px-2.5 py-1.5">
            <BarChart2 size={11} className="text-slate-400" />
            <span className="text-slate-600 font-medium">{profile.platforms.slice(0, 3).join(', ')}{profile.platforms.length > 3 ? '…' : ''}</span>
          </div>
        )}
      </div>
      {profile.goals.length > 0 && (
        <div className="flex flex-wrap gap-1 mt-3">
          {profile.goals.map((g) => (
            <span key={g} className="rounded-full bg-emerald-50 text-emerald-700 text-[10px] font-semibold px-2 py-0.5">
              {g}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}

function navigateToPosts() {
  window.history.pushState({}, '', '/posts');
  window.dispatchEvent(new PopStateEvent('popstate'));
}

const DRAFT_TYPE_LABELS: Record<string, string> = {
  content_post:       'Blog Draft',
  strategy_proposal:  'Strategy',
  analysis_report:    'Analysis',
  visual_concept:     'Visual Brief',
  workflow_setup:     'Workflow',
};

const DRAFT_TYPE_ICONS: Record<string, LucideIcon> = {
  content_post:      FileText,
  strategy_proposal: Lightbulb,
  analysis_report:   BarChart2,
  visual_concept:    Sparkles,
  workflow_setup:    LayoutList,
};

function AgentDraftsPanel({ drafts }: { drafts: AgentDraft[] }) {
  const [expanded, setExpanded] = useState<string | null>(null);

  if (drafts.length === 0) return null;

  return (
    <div>
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-base font-black text-slate-950 tracking-tight">Executed Drafts</h3>
        <span className="rounded-full bg-indigo-100 text-indigo-700 text-[11px] font-bold px-2 py-0.5">
          {drafts.length}
        </span>
      </div>
      <div className="space-y-2">
        {drafts.map((draft) => {
          const color   = AGENT_COLORS[draft.agent_key] ?? '#5b6cf9';
          const icon    = AGENT_ICONS[draft.agent_key]  ?? '◆';
          const DraftIcon = DRAFT_TYPE_ICONS[draft.task_type] ?? FileText;
          const isOpen  = expanded === draft.id;
          return (
            <div key={draft.id}
              className="rounded-2xl border border-slate-200 bg-white overflow-hidden shadow-sm">
              <button
                type="button"
                onClick={() => setExpanded(isOpen ? null : draft.id)}
                className="w-full flex items-center gap-3 px-4 py-3 text-left hover:bg-slate-50 transition">
                <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-xl text-base"
                  style={{ background: `${color}18`, color }}>
                  {icon}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="text-xs font-bold" style={{ color }}>
                      {AGENT_NAMES[draft.agent_key] ?? draft.agent_key}
                    </span>
                    <span className="flex items-center gap-1 text-[10px] font-semibold text-slate-500 bg-slate-100 rounded-full px-2 py-0.5">
                      <DraftIcon size={9} />
                      {DRAFT_TYPE_LABELS[draft.task_type] ?? draft.task_type}
                    </span>
                    {draft.blog_post_id && (
                      <span className="text-[10px] font-semibold text-emerald-700 bg-emerald-50 rounded-full px-2 py-0.5">
                        blog draft
                      </span>
                    )}
                  </div>
                  <p className="text-sm font-semibold text-slate-800 truncate mt-0.5">{draft.title}</p>
                </div>
                <ChevronRight size={14} className={`shrink-0 text-slate-400 transition-transform ${isOpen ? 'rotate-90' : ''}`} />
              </button>

              {isOpen && (
                <div className="px-4 pb-4 border-t border-slate-100 pt-3">
                  {draft.content && (
                    <p className="text-sm text-slate-600 leading-relaxed whitespace-pre-wrap mb-3">
                      {draft.content}
                    </p>
                  )}
                  {draft.blog_post_id && (
                    <button
                      type="button"
                      onClick={navigateToPosts}
                      className="flex items-center gap-1.5 rounded-xl border border-indigo-200 bg-indigo-50 px-3 py-1.5 text-xs font-bold text-indigo-700 hover:bg-indigo-100 transition">
                      <ExternalLink size={11} /> Open in Posts
                    </button>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ── Types ────────────────────────────────────────────────────────────────────

type RunResult = { agent_key: string; proposals_created: number; error?: string };

// ── Orchestration pipeline step ───────────────────────────────────────────────

type OrchStep = {
  key: string;
  name: string;
  role: string;
  color: string;
  icon: string;
  status: 'idle' | 'running' | 'done' | 'error';
  count?: number;
};

const ORCH_PIPELINE: Omit<OrchStep, 'status'>[] = [
  { key: 'sage', name: 'Sage', role: 'Strategy', color: '#10B981', icon: '◈' },
  { key: 'daky', name: 'Daky', role: 'Content', color: '#5b6cf9', icon: '✦' },
  { key: 'nova', name: 'Nova', role: 'Visuals', color: '#EC4899', icon: '◉' },
  { key: 'aria', name: 'Aria', role: 'Analytics', color: '#F59E0B', icon: '⊕' },
  { key: 'flux', name: 'Flux', role: 'Automation', color: '#8B5CF6', icon: '⟳' },
];

function OrchestrationPanel({
  steps,
  running,
  result,
  onRun,
  onDismiss,
}: {
  steps: OrchStep[];
  running: boolean;
  result: { proposals_by_agent: Record<string, number>; total: number } | null;
  onRun: () => void;
  onDismiss: () => void;
}) {
  return (
    <div className="rounded-2xl border border-indigo-200 bg-gradient-to-br from-indigo-50 to-white p-6 shadow-sm">
      <div className="flex items-start justify-between mb-5">
        <div className="flex items-start gap-3">
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-indigo-100 text-indigo-600">
            <Network size={18} />
          </div>
          <div>
            <p className="font-black text-slate-950 tracking-tight">Orchestrate Full Campaign</p>
            <p className="text-xs text-slate-500 mt-0.5">
              Sage sets strategy → Daky writes content → Nova designs visuals → Aria tracks → Flux automates
            </p>
          </div>
        </div>
        <button type="button" onClick={onDismiss}
          className="rounded-lg p-1.5 text-slate-400 hover:text-slate-600 hover:bg-slate-100 transition">
          <X size={14} />
        </button>
      </div>

      {/* Pipeline steps */}
      <div className="flex items-center gap-1 flex-wrap mb-5">
        {steps.map((step, i) => (
          <div key={step.key} className="flex items-center gap-1">
            <div className={`flex items-center gap-1.5 rounded-xl px-3 py-2 transition ${
              step.status === 'done'    ? 'bg-white border border-emerald-200' :
              step.status === 'running' ? 'bg-white border-2 shadow-sm' :
              step.status === 'error'   ? 'bg-red-50 border border-red-200' :
              'bg-slate-50 border border-slate-200'
            }`}
              style={step.status === 'running' ? { borderColor: step.color } : {}}>
              <span className="text-sm" style={{ color: step.color }}>{step.icon}</span>
              <span className="text-xs font-bold text-slate-700">{step.name}</span>
              {step.status === 'running' && <Loader2 size={11} className="animate-spin" style={{ color: step.color }} />}
              {step.status === 'done'    && <CheckCircle size={11} className="text-emerald-500" />}
              {step.status === 'done' && step.count != null && (
                <span className="text-[10px] font-bold" style={{ color: step.color }}>{step.count}</span>
              )}
            </div>
            {i < steps.length - 1 && (
              <ArrowRight size={12} className={`shrink-0 ${
                step.status === 'done' && (steps[i+1].status === 'running' || steps[i+1].status === 'done')
                  ? 'text-emerald-400' : 'text-slate-300'
              }`} />
            )}
          </div>
        ))}
      </div>

      {result && (
        <div className="rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 mb-4">
          <div className="flex items-center gap-2 mb-1">
            <CheckCircle size={14} className="text-emerald-600" />
            <span className="text-sm font-bold text-emerald-800">Orchestration complete — {result.total} proposals created</span>
          </div>
          <div className="flex flex-wrap gap-2">
            {Object.entries(result.proposals_by_agent).map(([k, n]) => (
              <span key={k} className="text-[11px] font-semibold text-emerald-700 bg-white border border-emerald-200 rounded-full px-2 py-0.5">
                {AGENT_NAMES[k] ?? k}: {n}
              </span>
            ))}
          </div>
        </div>
      )}

      <button
        type="button"
        disabled={running}
        onClick={onRun}
        className="flex w-full items-center justify-center gap-2 rounded-xl py-3 text-sm font-bold text-white transition disabled:opacity-50"
        style={{ background: '#5b6cf9' }}
      >
        {running
          ? <><Loader2 size={14} className="animate-spin" /> Orchestrating…</>
          : result
          ? <><Network size={14} /> Run Again</>
          : <><Network size={14} /> Launch Full Orchestration</>
        }
      </button>
    </div>
  );
}

const AGENT_NAMES: Record<string, string> = { daky: 'Daky', nova: 'Nova', sage: 'Sage', aria: 'Aria', flux: 'Flux' };

// ── Main Page ──────────────────────────────────────────────────────────────────

export default function AITeam() {
  const [profile, setProfile]   = useState<BrandProfile | null>(null);
  const [tasks, setTasks]       = useState<AgentTask[]>([]);
  const [drafts, setDrafts]     = useState<AgentDraft[]>([]);
  const [loading, setLoading]   = useState(true);
  const [error, setError]       = useState<string | null>(null);
  const [showWizard, setShowWizard] = useState(false);
  const [runningAgents, setRunningAgents]   = useState<Set<string>>(new Set());
  const [runningAll, setRunningAll]         = useState(false);
  const [runAllStatus, setRunAllStatus]     = useState('');
  const [lastRunAt, setLastRunAt]           = useState<Record<string, string>>({});
  const [runToasts, setRunToasts]           = useState<RunResult[]>([]);
  const [execToasts, setExecToasts]         = useState<ExecToast[]>([]);

  // Phase 8 — orchestration state
  const [showOrch, setShowOrch]             = useState(false);
  const [orchRunning, setOrchRunning]       = useState(false);
  const [orchSteps, setOrchSteps]           = useState<OrchStep[]>(
    ORCH_PIPELINE.map((s) => ({ ...s, status: 'idle' as const }))
  );
  const [orchResult, setOrchResult]         = useState<{ proposals_by_agent: Record<string, number>; total: number } | null>(null);

  const load = useCallback(async () => {
    setLoading(true); setError(null);
    try {
      const [pr, tr, sr, dr] = await Promise.all([
        fetch(`${BASE()}/api/user/brand-profile`,  { headers: { Authorization: `Bearer ${tok()}` } }).then((r) => r.json()),
        fetch(`${BASE()}/api/user/agent-tasks`,    { headers: { Authorization: `Bearer ${tok()}` } }).then((r) => r.json()),
        fetch(`${BASE()}/api/user/agents/status`,  { headers: { Authorization: `Bearer ${tok()}` } }).then((r) => r.json()),
        fetch(`${BASE()}/api/user/agent-drafts`,   { headers: { Authorization: `Bearer ${tok()}` } }).then((r) => r.json()),
      ]);
      setProfile(pr.success ? pr.profile : null);
      setTasks(tr.success ? tr.tasks : []);
      if (sr.success) setLastRunAt(sr.status ?? {});
      if (dr.success) setDrafts(dr.drafts ?? []);
      if (!pr.profile?.setup_done) setShowWizard(true);
    } catch (e: any) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const handleDecide = async (id: string, decision: 'approved' | 'rejected') => {
    const res = await fetch(`${BASE()}/api/user/agent-tasks/${id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${tok()}` },
      body: JSON.stringify({ decision }),
    });
    const d = await res.json();
    if (d.success) {
      setTasks((prev) => prev.map((t) => t.id === id ? d.task : t));
      if (decision === 'approved' && d.execution) {
        const exec = d.execution as { type: string; blog_post_id?: string; draft_id?: string };
        const toast: ExecToast = exec.type === 'blog_draft'
          ? { message: 'Blog draft created!', blog_post_id: exec.blog_post_id }
          : { message: 'Draft saved to your team!' };
        setExecToasts((prev) => [...prev, toast]);
        setTimeout(() => setExecToasts((prev) => prev.filter((t) => t !== toast)), 7000);
        // Reload drafts list
        fetch(`${BASE()}/api/user/agent-drafts`, { headers: { Authorization: `Bearer ${tok()}` } })
          .then((r) => r.json())
          .then((dr) => { if (dr.success) setDrafts(dr.drafts ?? []); })
          .catch(() => {});
      }
    }
  };

  const runAgent = async (key: string) => {
    setRunningAgents((s) => new Set(s).add(key));
    try {
      const res = await fetch(`${BASE()}/api/user/agents/${key}/run`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${tok()}` },
      });
      const d = await res.json();
      const result: RunResult = d.success
        ? { agent_key: key, proposals_created: d.proposals_created }
        : { agent_key: key, proposals_created: 0, error: d.error };
      setRunToasts((prev) => [...prev, result]);
      setTimeout(() => setRunToasts((prev) => prev.filter((r) => r !== result)), 5000);
      if (d.success) {
        setLastRunAt((prev) => ({ ...prev, [key]: new Date().toISOString() }));
        // Reload tasks to show new proposals
        const tr = await fetch(`${BASE()}/api/user/agent-tasks`, { headers: { Authorization: `Bearer ${tok()}` } }).then((r) => r.json());
        if (tr.success) setTasks(tr.tasks);
      }
    } catch (e: any) {
      const result: RunResult = { agent_key: key, proposals_created: 0, error: e.message };
      setRunToasts((prev) => [...prev, result]);
      setTimeout(() => setRunToasts((prev) => prev.filter((r) => r !== result)), 5000);
    } finally {
      setRunningAgents((s) => { const ns = new Set(s); ns.delete(key); return ns; });
    }
  };

  const runAll = async () => {
    if (runningAll) return;
    setRunningAll(true);
    const keys = AGENT_DEFS.map((a) => a.key);
    for (let i = 0; i < keys.length; i++) {
      const key = keys[i];
      const name = AGENT_DEFS[i].name;
      setRunAllStatus(`Running ${name} (${i + 1}/${keys.length})…`);
      await runAgent(key);
    }
    setRunningAll(false);
    setRunAllStatus('');
  };

  // Phase 8 — orchestration: streams step-by-step UI updates then calls backend
  const runOrchestrate = async () => {
    if (orchRunning) return;
    setOrchRunning(true);
    setOrchResult(null);
    // Reset all steps to idle
    setOrchSteps(ORCH_PIPELINE.map((s) => ({ ...s, status: 'idle' as const })));

    // Mark steps running one-by-one to show progress (visual only — server does the real sequencing)
    const DELAYS = [0, 3500, 7000, 10500, 10500]; // approx Haiku latency per step
    const timeouts: ReturnType<typeof setTimeout>[] = [];

    ORCH_PIPELINE.forEach((_step, i) => {
      timeouts.push(setTimeout(() => {
        setOrchSteps((prev) =>
          prev.map((s, j) =>
            j === i ? { ...s, status: 'running' }
            : j < i  ? { ...s, status: 'done' }
            : s
          )
        );
      }, DELAYS[i]));
    });

    try {
      const res = await fetch(`${BASE()}/api/user/agents/orchestrate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${tok()}` },
      });
      const d = await res.json();
      timeouts.forEach(clearTimeout);

      if (d.success) {
        setOrchSteps(ORCH_PIPELINE.map((s) => ({
          ...s,
          status: 'done' as const,
          count: d.proposals_by_agent?.[s.key] ?? 0,
        })));
        setOrchResult({ proposals_by_agent: d.proposals_by_agent, total: d.total });
        setLastRunAt((prev) => {
          const now = new Date().toISOString();
          const next = { ...prev };
          for (const k of ['sage','daky','nova','aria','flux']) next[k] = now;
          return next;
        });
        // Reload tasks
        const tr = await fetch(`${BASE()}/api/user/agent-tasks`, { headers: { Authorization: `Bearer ${tok()}` } }).then((r) => r.json());
        if (tr.success) setTasks(tr.tasks);
      } else {
        setOrchSteps((prev) => prev.map((s) => s.status === 'running' ? { ...s, status: 'error' as const } : s));
        const toast: RunResult = { agent_key: 'orchestration', proposals_created: 0, error: d.error };
        setRunToasts((prev) => [...prev, toast]);
        setTimeout(() => setRunToasts((prev) => prev.filter((r) => r !== toast)), 5000);
      }
    } catch (e: any) {
      timeouts.forEach(clearTimeout);
      setOrchSteps((prev) => prev.map((s) => s.status === 'running' ? { ...s, status: 'error' as const } : s));
    } finally {
      setOrchRunning(false);
    }
  };

  const pendingCount = tasks.filter((t) => t.status === 'pending').length;
  const profileReady = Boolean(profile?.setup_done);

  if (loading) {
    return (
      <div className="flex items-center gap-3 py-16 justify-center text-slate-500">
        <Loader2 size={18} className="animate-spin" /> Loading AI Team…
      </div>
    );
  }

  if (error) {
    return (
      <div className="rounded-2xl border border-red-200 bg-red-50 p-6 text-sm text-red-700 flex items-center gap-3">
        <X size={16} className="shrink-0" /> {error}
        <button type="button" onClick={load} className="ml-auto text-xs font-semibold hover:underline">Retry</button>
      </div>
    );
  }

  return (
    <div className="space-y-8 max-w-5xl">
      {/* Run toasts */}
      {(runToasts.length > 0 || execToasts.length > 0) && (
        <div className="fixed top-5 right-5 z-50 space-y-2">
          {runToasts.map((r, i) => (
            <div key={i} className={`flex items-center gap-2.5 rounded-2xl border px-4 py-3 shadow-lg text-sm font-semibold ${
              r.error ? 'border-red-200 bg-white text-red-600' : 'border-emerald-200 bg-white text-emerald-700'
            }`}>
              {r.error
                ? <><X size={14} className="shrink-0" /> {r.agent_key}: {r.error}</>
                : <><CheckCircle size={14} className="shrink-0" /> {r.agent_key} created {r.proposals_created} proposal{r.proposals_created !== 1 ? 's' : ''}</>
              }
            </div>
          ))}
          {execToasts.map((t, i) => (
            <div key={`exec-${i}`}
              className="flex items-center gap-2.5 rounded-2xl border border-indigo-200 bg-white px-4 py-3 shadow-lg text-sm font-semibold text-indigo-700">
              <CheckCircle size={14} className="shrink-0 text-indigo-500" />
              <span>{t.message}</span>
              {t.blog_post_id && (
                <button
                  type="button"
                  onClick={navigateToPosts}
                  className="ml-2 flex items-center gap-1 text-xs font-bold text-indigo-600 hover:underline">
                  Open in Posts <ExternalLink size={10} />
                </button>
              )}
            </div>
          ))}
        </div>
      )}

      {/* Page header */}
      <div className="flex items-start justify-between flex-wrap gap-3">
        <div>
          <h2 className="text-2xl font-black tracking-[-0.03em] text-slate-950">AI Team</h2>
          <p className="mt-1 text-sm text-slate-500">
            Your personal AI marketing team. Set your brand profile and run agents to get content, strategies, and insights.
          </p>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          {pendingCount > 0 && (
            <span className="rounded-full bg-amber-500 text-white text-xs font-bold px-2.5 py-1">
              {pendingCount} pending
            </span>
          )}
          {profileReady && (
            <>
              <button
                type="button"
                disabled={orchRunning || runningAll || runningAgents.size > 0}
                onClick={() => setShowOrch((v) => !v)}
                className="flex items-center gap-1.5 rounded-xl border border-indigo-300 bg-indigo-50 px-3 py-2 text-xs font-bold text-indigo-700 hover:bg-indigo-100 transition disabled:opacity-50"
              >
                <Network size={13} /> Orchestrate
              </button>
              <button
                type="button"
                disabled={runningAll || runningAgents.size > 0 || orchRunning}
                onClick={runAll}
                className="flex items-center gap-1.5 rounded-xl px-4 py-2 text-xs font-bold text-white transition disabled:opacity-50"
                style={{ background: '#5b6cf9' }}
              >
                {runningAll
                  ? <><Loader2 size={12} className="animate-spin" /> {runAllStatus || 'Running…'}</>
                  : <><PlayCircle size={13} /> Run All</>
                }
              </button>
            </>
          )}
          <button type="button" onClick={load}
            className="rounded-xl border border-slate-200 p-2 text-slate-500 hover:bg-slate-50 transition">
            <RefreshCw size={14} />
          </button>
        </div>
      </div>

      {/* Phase 8 — Orchestration panel */}
      {showOrch && profileReady && (
        <OrchestrationPanel
          steps={orchSteps}
          running={orchRunning}
          result={orchResult}
          onRun={runOrchestrate}
          onDismiss={() => setShowOrch(false)}
        />
      )}

      {/* Brand Wizard / Profile */}
      {showWizard ? (
        <BrandWizard
          initial={profile}
          onSaved={(p) => {
            setProfile(p);
            if (p.setup_done) setShowWizard(false);
          }}
        />
      ) : (
        profile && (
          <div className="flex items-start gap-3 flex-wrap">
            <div className="flex-1 min-w-0">
              <BrandCard profile={profile} onEdit={() => setShowWizard(true)} />
            </div>
            {!profileReady && (
              <button type="button" onClick={() => setShowWizard(true)}
                className="flex items-center gap-1.5 rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-2 text-xs font-bold text-emerald-700 hover:bg-emerald-100 transition shrink-0">
                <Sparkles size={12} /> Complete Setup
              </button>
            )}
          </div>
        )
      )}

      {/* Setup prompt if no profile yet */}
      {!showWizard && !profile && (
        <div className="rounded-2xl border border-dashed border-emerald-300 bg-emerald-50/50 p-8 text-center">
          <div className="flex h-12 w-12 items-center justify-center rounded-2xl mx-auto mb-3 text-2xl"
            style={{ background: '#10B98118', color: '#10B981' }}>◈</div>
          <p className="font-black text-slate-950 mb-1">Start with Sage</p>
          <p className="text-sm text-slate-500 mb-4">Tell your AI team about your brand so they can create content that actually fits.</p>
          <button type="button" onClick={() => setShowWizard(true)}
            className="inline-flex items-center gap-2 rounded-xl px-5 py-2.5 text-sm font-bold text-white"
            style={{ background: '#10B981' }}>
            <Sparkles size={14} /> Set Up Brand Profile
          </button>
        </div>
      )}

      {/* Agent grid */}
      <div>
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-base font-black text-slate-950 tracking-tight">Your Marketing Team</h3>
          {profileReady && (
            <span className="flex items-center gap-1.5 text-xs font-semibold text-emerald-600">
              <Zap size={12} /> All agents ready
            </span>
          )}
        </div>
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {AGENT_DEFS.map((agent) => (
            <AgentCard
              key={agent.key}
              agent={agent}
              ready={profileReady}
              lastRunAt={lastRunAt[agent.key] ?? null}
              running={runningAgents.has(agent.key)}
              onRun={runAgent}
            />
          ))}
        </div>
      </div>

      {/* Approval queue */}
      <ApprovalQueue tasks={tasks} onDecide={handleDecide} />

      {/* Executed Drafts */}
      <AgentDraftsPanel drafts={drafts} />

      {/* Info panel */}
      <div className="rounded-2xl border border-slate-200 bg-slate-50 p-5">
        <p className="text-xs font-bold text-slate-600 mb-2">How your AI team works</p>
        <ul className="space-y-1.5 text-xs text-slate-500">
          <li>• <strong>Brand Profile</strong> — Complete setup so agents know your niche, tone, and goals.</li>
          <li>• <strong>Run individual agents</strong> — Each generates 2-3 proposals in seconds (10-min cooldown).</li>
          <li>• <strong>Orchestrate</strong> — Full campaign pipeline: Sage sets strategy → Daky writes content → Nova designs visuals → Aria tracks performance → Flux automates distribution.</li>
          <li>• <strong>Approve or reject</strong> — Your decisions are remembered. Agents adapt their future proposals based on what you approve.</li>
          <li>• <strong>Executed Drafts</strong> — Approving a <em>content post</em> auto-creates a blog draft you can edit and publish. Other approved proposals are saved as drafts for your reference.</li>
          <li>• <strong>Memory</strong> — The more you interact, the more your team learns your preferences.</li>
          <li>• Proposals expire after 48 hours if not actioned.</li>
        </ul>
      </div>

      {/* Target & Goals summary */}
      {profileReady && profile && profile.goals.length > 0 && (
        <div className="rounded-2xl border border-indigo-100 bg-indigo-50/40 p-5">
          <div className="flex items-center gap-2 mb-3">
            <Target size={14} className="text-indigo-500" />
            <p className="text-xs font-bold text-indigo-700">Active Goals</p>
          </div>
          <div className="flex flex-wrap gap-1.5">
            {profile.goals.map((g) => (
              <span key={g} className="rounded-full bg-white border border-indigo-200 text-indigo-700 text-[11px] font-semibold px-3 py-1">
                {g}
              </span>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
