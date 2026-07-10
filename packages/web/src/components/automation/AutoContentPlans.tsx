import { useCallback, useEffect, useState } from 'react';
import { Check, Image as ImageIcon, Loader2, Pause, Play, Plus, Sparkles, Trash2, Wand2, X } from 'lucide-react';
import { API_BASE_URL } from '../../utils/apiBase';

// ─────────────────────────────────────────────────────────────────────────────
// Auto-Content plans — "generate promo content with featured images 3× a day
// for a month". Runs in the background; each piece lands as a draft blog
// post and fires an in-app notification. Completion sends an email.
// ─────────────────────────────────────────────────────────────────────────────

type Plan = {
  id: string;
  name: string;
  topic: string;
  tone: string;
  per_day: number;
  ends_at: string | null;
  use_liked_style: boolean;
  generate_image: boolean;
  status: 'active' | 'paused' | 'completed';
  runs_count: number;
  next_run_at: string | null;
  pieces_created: number;
  pieces_failed: number;
};

const hdrs = () => ({ Authorization: `Bearer ${localStorage.getItem('auth_token') ?? ''}`, 'Content-Type': 'application/json' });

const STATUS_CLS: Record<Plan['status'], string> = {
  active: 'bg-emerald-50 text-emerald-600',
  paused: 'bg-amber-50 text-amber-600',
  completed: 'bg-slate-100 text-slate-500',
};

export default function AutoContentPlans() {
  const [plans, setPlans] = useState<Plan[] | null>(null);
  const [showCreate, setShowCreate] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  const load = useCallback(async () => {
    try {
      const r = await fetch(`${API_BASE_URL}/api/content-plans`, { headers: hdrs() });
      const d = await r.json();
      if (d.success) setPlans(d.plans ?? []);
    } catch { /* ignore */ }
  }, []);

  useEffect(() => { void load(); }, [load]);

  const act = async (plan: Plan, action: 'toggle' | 'delete' | 'run') => {
    setBusy(`${action}:${plan.id}`);
    setMsg(null);
    try {
      if (action === 'delete') {
        if (!window.confirm(`Delete plan "${plan.name}"? Already-generated drafts stay in Content → Posts.`)) { setBusy(null); return; }
        await fetch(`${API_BASE_URL}/api/content-plans/${plan.id}`, { method: 'DELETE', headers: hdrs() });
      } else if (action === 'toggle') {
        await fetch(`${API_BASE_URL}/api/content-plans/${plan.id}`, {
          method: 'PATCH', headers: hdrs(),
          body: JSON.stringify({ status: plan.status === 'active' ? 'paused' : 'active' }),
        });
      } else {
        const r = await fetch(`${API_BASE_URL}/api/content-plans/${plan.id}/run`, { method: 'POST', headers: hdrs() });
        const d = await r.json();
        setMsg({ ok: Boolean(d.success), text: d.message || d.error || 'Started' });
      }
      await load();
    } catch (e) {
      setMsg({ ok: false, text: e instanceof Error ? e.message : 'Action failed' });
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="flex items-center gap-2">
            <Wand2 size={16} className="text-indigo-500" />
            <h2 className="text-lg font-black text-slate-950">Auto-Content plans</h2>
          </div>
          <p className="mt-1 text-sm text-slate-500 max-w-xl">
            Your AI team creates promotional content with featured images on a schedule — e.g. 3 pieces a day for a month.
            Everything runs in the background; each piece lands as a draft in Content → Posts and you get a notification.
          </p>
        </div>
        <button type="button" onClick={() => setShowCreate(true)}
          className="inline-flex shrink-0 items-center gap-2 rounded-xl bg-slate-950 px-4 py-2.5 text-sm font-bold text-white hover:bg-slate-800">
          <Plus size={14} /> New plan
        </button>
      </div>

      {msg && (
        <div className={`rounded-xl border px-4 py-2.5 text-sm ${msg.ok ? 'border-emerald-200 bg-emerald-50 text-emerald-700' : 'border-red-200 bg-red-50 text-red-700'}`}>
          {msg.text}
        </div>
      )}

      {plans === null ? (
        <div className="flex justify-center py-12"><Loader2 size={20} className="animate-spin text-slate-300" /></div>
      ) : plans.length === 0 ? (
        <div className="rounded-2xl border-2 border-dashed border-slate-200 flex flex-col items-center justify-center py-14 gap-3">
          <Sparkles size={24} className="text-slate-300" />
          <p className="text-sm font-bold text-slate-600">No content plans yet</p>
          <p className="text-xs text-slate-400">Create one and your AI team starts producing on schedule.</p>
        </div>
      ) : (
        <div className="grid gap-3">
          {plans.map((p) => (
            <div key={p.id} className="rounded-2xl border border-slate-200 bg-white p-5">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="text-base font-black text-slate-950 truncate">{p.name}</span>
                    <span className={`shrink-0 rounded-full px-2 py-0.5 text-[10px] font-bold uppercase ${STATUS_CLS[p.status]}`}>{p.status}</span>
                  </div>
                  <p className="mt-0.5 text-xs text-slate-500 truncate">{p.topic || 'General brand promotion'}</p>
                  <p className="mt-1.5 text-[11px] text-slate-400">
                    {p.per_day}×/day{p.ends_at ? ` until ${new Date(p.ends_at).toLocaleDateString()}` : ''} ·{' '}
                    {p.pieces_created} piece{Number(p.pieces_created) === 1 ? '' : 's'} created
                    {Number(p.pieces_failed) > 0 ? ` · ${p.pieces_failed} failed` : ''}
                    {p.generate_image ? ' · with featured images' : ''}
                    {p.status === 'active' && p.next_run_at ? ` · next: ${new Date(p.next_run_at).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}` : ''}
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  {p.status !== 'completed' && (
                    <>
                      <button type="button" onClick={() => void act(p, 'run')} disabled={busy !== null}
                        className="inline-flex items-center gap-1.5 rounded-lg border border-indigo-200 px-3 py-1.5 text-xs font-bold text-indigo-600 hover:bg-indigo-50">
                        {busy === `run:${p.id}` ? <Loader2 size={12} className="animate-spin" /> : <Sparkles size={12} />} Generate now
                      </button>
                      <button type="button" onClick={() => void act(p, 'toggle')} disabled={busy !== null}
                        className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 px-3 py-1.5 text-xs font-bold text-slate-600 hover:bg-slate-50">
                        {busy === `toggle:${p.id}` ? <Loader2 size={12} className="animate-spin" /> : p.status === 'active' ? <Pause size={12} /> : <Play size={12} />}
                        {p.status === 'active' ? 'Pause' : 'Resume'}
                      </button>
                    </>
                  )}
                  <button type="button" onClick={() => void act(p, 'delete')} disabled={busy !== null}
                    className="flex h-8 w-8 items-center justify-center rounded-lg text-slate-400 hover:bg-red-50 hover:text-red-500">
                    <Trash2 size={13} />
                  </button>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {showCreate && <CreatePlanModal onClose={() => setShowCreate(false)} onCreated={() => { setShowCreate(false); void load(); }} />}
    </div>
  );
}

function CreatePlanModal({ onClose, onCreated }: { onClose: () => void; onCreated: () => void }) {
  const [name, setName] = useState('Monthly promo push');
  const [topic, setTopic] = useState('');
  const [tone, setTone] = useState('engaging');
  const [perDay, setPerDay] = useState(3);
  const [durationDays, setDurationDays] = useState(30);
  const [useLikedStyle, setUseLikedStyle] = useState(true);
  const [genImage, setGenImage] = useState(true);
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const create = async () => {
    setSaving(true);
    setErr(null);
    try {
      const r = await fetch(`${API_BASE_URL}/api/content-plans`, {
        method: 'POST', headers: hdrs(),
        body: JSON.stringify({ name, topic, tone, per_day: perDay, duration_days: durationDays, use_liked_style: useLikedStyle, generate_image: genImage }),
      });
      const d = await r.json();
      if (!d.success) throw new Error(d.error || 'Failed to create plan');
      onCreated();
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Failed to create plan');
    } finally {
      setSaving(false);
    }
  };

  const inputCls = 'w-full rounded-xl border border-slate-200 bg-slate-50 px-3 py-2.5 text-sm text-slate-900 outline-none focus:border-indigo-400';
  const labelCls = 'text-xs font-semibold uppercase tracking-wide text-slate-500';

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className="w-full max-w-md max-h-[90vh] overflow-y-auto rounded-2xl bg-white shadow-2xl">
        <div className="flex items-center justify-between border-b border-slate-100 px-6 py-4">
          <h3 className="text-lg font-black text-slate-950">New Auto-Content plan</h3>
          <button type="button" onClick={onClose} className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-100"><X size={18} /></button>
        </div>
        <div className="space-y-4 px-6 py-5">
          {err && <div className="rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{err}</div>}
          <label className={`block ${labelCls}`}>Plan name
            <input value={name} onChange={e => setName(e.target.value)} className={`${inputCls} mt-1.5 normal-case font-normal tracking-normal`} />
          </label>
          <label className={`block ${labelCls}`}>What to promote
            <textarea rows={2} value={topic} onChange={e => setTopic(e.target.value)}
              placeholder="e.g. Our summer collection launch, weekly offers, brand awareness…"
              className={`${inputCls} mt-1.5 normal-case font-normal tracking-normal resize-none`} />
          </label>
          <div className="grid grid-cols-3 gap-3">
            <label className={`block ${labelCls}`}>Per day
              <select value={perDay} onChange={e => setPerDay(Number(e.target.value))} className={`${inputCls} mt-1.5 normal-case font-normal tracking-normal`}>
                {[1, 2, 3, 4, 5, 6].map(n => <option key={n} value={n}>{n}×</option>)}
              </select>
            </label>
            <label className={`block ${labelCls}`}>For
              <select value={durationDays} onChange={e => setDurationDays(Number(e.target.value))} className={`${inputCls} mt-1.5 normal-case font-normal tracking-normal`}>
                <option value={7}>1 week</option>
                <option value={14}>2 weeks</option>
                <option value={30}>1 month</option>
                <option value={60}>2 months</option>
                <option value={90}>3 months</option>
              </select>
            </label>
            <label className={`block ${labelCls}`}>Tone
              <select value={tone} onChange={e => setTone(e.target.value)} className={`${inputCls} mt-1.5 normal-case font-normal tracking-normal`}>
                {['engaging', 'professional', 'playful', 'bold', 'friendly'].map(t => <option key={t} value={t}>{t}</option>)}
              </select>
            </label>
          </div>
          <label className="flex items-center gap-3 rounded-xl border border-slate-200 bg-slate-50 px-4 py-3 cursor-pointer">
            <input type="checkbox" checked={genImage} onChange={e => setGenImage(e.target.checked)} className="accent-indigo-500" />
            <span className="flex items-center gap-2 text-sm font-semibold text-slate-700"><ImageIcon size={14} className="text-slate-400" /> Generate a featured image for each piece</span>
          </label>
          <label className="flex items-center gap-3 rounded-xl border border-slate-200 bg-slate-50 px-4 py-3 cursor-pointer">
            <input type="checkbox" checked={useLikedStyle} onChange={e => setUseLikedStyle(e.target.checked)} className="accent-indigo-500" />
            <span className="text-sm font-semibold text-slate-700">Match my liked images' visual style</span>
          </label>
          <p className="text-[11px] text-slate-400 leading-relaxed">
            Uses your AI credits (roughly 1-2 for copy + 3 per image). Pieces land as drafts in Content → Posts;
            you'll get a notification for each one and an email when the plan completes.
          </p>
        </div>
        <div className="flex justify-end gap-2 border-t border-slate-100 px-6 py-4">
          <button type="button" onClick={onClose} className="rounded-xl border border-slate-200 px-4 py-2 text-sm font-semibold text-slate-600">Cancel</button>
          <button type="button" onClick={() => void create()} disabled={saving || !name.trim()}
            className="inline-flex items-center gap-2 rounded-xl bg-slate-950 px-5 py-2 text-sm font-bold text-white disabled:opacity-40">
            {saving ? <Loader2 size={14} className="animate-spin" /> : <Check size={14} />} Start plan
          </button>
        </div>
      </div>
    </div>
  );
}
