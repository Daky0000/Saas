import { useCallback, useEffect, useRef, useState } from 'react';
import {
  BarChart2,
  Calendar,
  CheckCircle,
  ChevronDown,
  Clock,
  Edit2,
  ExternalLink,
  Mic,
  MicOff,
  Loader2,
  History,
  Paperclip,
  Plus,
  RotateCcw,
  Send,
  Sparkles,
  Trash2,
  X,
} from 'lucide-react';
import { getApiBaseUrl } from '../utils/apiBase';
import { notifyCreditsChanged } from './CreditBadge';

// ── Types ────────────────────────────────────────────────────────────────────

type AttachedImg = { id: string; name: string; dataUrl: string };

type TextMessage = {
  kind: 'text';
  id: string;
  role: 'user' | 'assistant';
  content: string;
  images?: AttachedImg[];
  /** The text as typed (user messages), so a failed turn can be sent again. */
  raw?: string;
  /** The reply failed; the bubble shows the error and a Retry button. */
  failed?: boolean;
};
/** What the assistant is doing this turn: steps, thinking, posts made. */
type ActivityMessage = {
  kind: 'activity';
  id: string;
  status: 'working' | 'done' | 'failed';
  steps: string[];
  thinking: string;
  startedAt: number;
  endedAt?: number;
  postsDone: number;
  postsTotal?: number;
};
type ToolMessage = {
  kind: 'tool';
  id: string;
  name: string;
  label: string;
  status: 'running' | 'done' | 'error';
  result?: any;
  error?: string;
};
type FormQuestion = {
  id: string;
  text: string;
  options: string[];
  answer: string | null;
  customText: string;
};
type FormMessage = {
  kind: 'form';
  id: string;
  intro: string;
  questions: FormQuestion[];
  submitted: boolean;
};
type SchedulerMessage = {
  kind: 'scheduler';
  id: string;
  postTitle?: string;
  postContent?: string;
  submitted: boolean;
};
type PlanAgent = {
  key: string;
  name: string;
  icon: string;
  color: string;
  task: string;
  enabled: boolean;
};
type PlanMessage = {
  kind: 'plan';
  id: string;
  summary: string;
  agents: PlanAgent[];
  status: 'pending' | 'executing' | 'done';
  agentStatuses?: Record<string, { running: boolean; analysis: string }>;
};
/** A credit estimate the user must accept before a paid action runs. */
type EstimateMessage = {
  kind: 'estimate';
  id: string;
  actionId: string;
  label: string;
  credits: number;
  lines: string[];
  balance: number | null;
  status: 'pending' | 'running' | 'done' | 'cancelled' | 'failed';
  error?: string;
};
type BatchItem = { index: number; topic: string; status: 'queued' | 'writing' | 'done' | 'failed'; post?: any; error?: string };
/** Posts being written one by one; each lands on the calendar as soon as it is done. */
type BatchMessage = {
  kind: 'batch';
  id: string;
  total: number;
  items: BatchItem[];
  creditsUsed: number;
  status: 'running' | 'done';
  stopped?: string;
};
type Message = TextMessage | ToolMessage | FormMessage | SchedulerMessage | PlanMessage | ActivityMessage | EstimateMessage | BatchMessage;
type SessionMeta = { id: string; title: string; updated_at: string };
const NO_MESSAGES: Message[] = [];

function sessionTitle(msgs: Message[]): string {
  const first = msgs.find((m): m is TextMessage => m.kind === 'text' && m.role === 'user');
  const text = (first?.raw || first?.content || 'New chat').replace(/\s+/g, ' ').trim();
  return text.length > 60 ? `${text.slice(0, 57)}…` : text || 'New chat';
}

function relativeTime(iso: string): string {
  const ms = Date.now() - new Date(iso).getTime();
  if (!Number.isFinite(ms) || ms < 60_000) return 'now';
  const m = Math.round(ms / 60_000);
  if (m < 60) return `${m}m`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h}h`;
  return `${Math.round(h / 24)}d`;
}

/** Reads an SSE response, calling onEvent per JSON event. True when the server sent [DONE]. */
async function readEventStream(res: Response, onEvent: (ev: any) => void): Promise<boolean> {
  const reader = res.body!.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  for (;;) {
    const { done, value } = await reader.read();
    if (done) return false;
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split('\n');
    buffer = lines.pop() ?? '';
    for (const line of lines) {
      if (!line.startsWith('data: ')) continue;
      const payload = line.slice(6).trim();
      if (payload === '[DONE]') return true;
      let ev: any;
      try { ev = JSON.parse(payload); } catch { continue; }
      // Only a stream-level error stops it; a failed tool or post carries its own `error`.
      if (ev?.error && (!ev.type || ev.type === 'error')) throw new Error(ev.error);
      onEvent(ev);
    }
  }
}

const NUMBER_WORDS: Record<string, number> = {
  two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10,
  eleven: 11, twelve: 12, fifteen: 15, twenty: 20, thirty: 30,
};

/** "Write 5 LinkedIn posts" → 5: how many posts the person asked for, when they said. */
export function requestedPostCount(text: string): number | undefined {
  const m = text.toLowerCase().match(/\b(\d{1,2}|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|fifteen|twenty|thirty)\s+(?:[a-z-]+\s+){0,3}?(?:posts?|drafts?|captions?|tweets?|threads?)\b/);
  if (!m) return undefined;
  const n = /^\d+$/.test(m[1]) ? Number(m[1]) : NUMBER_WORDS[m[1]];
  return n && n > 1 && n <= 60 ? n : undefined;
}

const POST_TOOLS = new Set(['create_draft', 'schedule_post']);

// ── Form parsing ─────────────────────────────────────────────────────────────

function formatQuestion(text: string): string {
  const clean = text.trim().replace(/[?!.,]*$/, '').replace(/^(?:please\s+)?(?:let me know|tell me|specify|provide|upload|attach)\s+/i, '');
  return clean.charAt(0).toUpperCase() + clean.slice(1) + '?';
}

function getSmartOptions(question: string): string[] {
  const q = question.toLowerCase();
  let options: string[];
  if (/how many|number of|quantity/.test(q))
    options = ['1', '2–3', '5–10', '10+'];
  else if (/platform|channel|network|social|where/.test(q))
    options = ['LinkedIn', 'Instagram', 'Twitter/X', 'Facebook', 'All platforms'];
  else if (/purpose|goal|objective|want to|trying/.test(q))
    options = ['Engagement', 'Promotion', 'Education', 'Brand awareness'];
  else if (/message|cta|call to action|copy|text/.test(q))
    options = ['Let AI suggest', 'Promotional', 'Informational', 'Inspirational'];
  else if (/dimension|size|format|resolution|ratio/.test(q))
    options = ['Square 1:1', 'Portrait 4:5', 'Landscape 16:9', 'Story 9:16'];
  else if (/style|design|look|feel|aesthetic/.test(q))
    options = ['Modern', 'Minimal', 'Bold', 'Professional'];
  else if (/color|colour|palette|theme/.test(q))
    options = ['Brand colors', 'Monochrome', 'Vibrant', 'Muted/Pastel'];
  else if (/upload|attach|share|image|photo/.test(q))
    options = ['Already attached', "I'll describe it", 'Use a template'];
  else
    options = ['Yes', 'No', 'Let AI decide'];
  options.push('Custom');
  return options;
}

function parseFormFromText(text: string): { intro: string; questions: FormQuestion[] } | null {
  const lines = text.split('\n').map((l) => l.trim()).filter(Boolean);

  type Block = { header: string; bullets: string[] };
  const blocks: Block[] = [];
  let cur: Block | null = null;
  const introLines: string[] = [];
  let inForm = false;

  for (const line of lines) {
    const num = line.match(/^(\d+)\.\s+(.+)$/);
    const bul = line.match(/^[-•*]\s+(.+)$/);
    if (num) {
      if (cur) blocks.push(cur);
      cur = { header: num[2], bullets: [] };
      inForm = true;
    } else if (bul && cur) {
      cur.bullets.push(bul[1].replace(/[?!]$/, '').trim());
    } else if (!inForm) {
      introLines.push(line);
    }
  }
  if (cur) blocks.push(cur);
  // Fallback: catch unnumbered "Did you mean:" / "Which option?" + bullet list pattern
  if (blocks.length === 0) {
    let qIdx = -1;
    for (let i = 0; i < lines.length; i++) {
      const l = lines[i];
      if (!l.match(/^[-•*\d]/) && (l.endsWith('?') || l.endsWith(':'))) qIdx = i;
    }
    if (qIdx >= 0) {
      const bullets: string[] = [];
      for (let i = qIdx + 1; i < lines.length; i++) {
        const bm = lines[i].match(/^[-•*]\s+(.+)$/);
        if (bm) bullets.push(bm[1].replace(/[?!,]$/, '').trim());
      }
      if (bullets.length >= 2) {
        blocks.push({ header: lines[qIdx].replace(/:$/, '').trim(), bullets });
      }
    }
  }

  if (blocks.length === 0) return null;
  // Allow single-block forms only when the block has 3+ clear option bullets
  if (blocks.length < 2 && blocks[0].bullets.length < 2) return null;

  const questions: FormQuestion[] = [];

  for (const block of blocks) {
    const bulletIsSubQ = block.bullets.some((b) => b.includes('?') || b.length > 40);

    if (block.bullets.length >= 2 && !bulletIsSubQ) {
      const opts = block.bullets
        .map((b) => b.replace(/\s*\(.*?\)\s*$/, '').trim())
        .filter(Boolean);
      // Add Custom only if no option already implies it
      const hasCustomLike = opts.some((o) => /^custom$|^other$|^my own|^i'll type|^type your/i.test(o));
      if (!hasCustomLike) opts.push('Custom');
      questions.push({ id: `q${questions.length}`, text: formatQuestion(block.header), options: opts, answer: null, customText: '' });
    } else if (block.bullets.length >= 2 && bulletIsSubQ) {
      for (const bullet of block.bullets) {
        const opts = getSmartOptions(bullet);
        const hasC = opts.some((o) => /^custom$|^other$|^my own|^i'll type|^type your/i.test(o));
        if (!hasC) opts.push('Custom');
        questions.push({ id: `q${questions.length}`, text: formatQuestion(bullet), options: opts, answer: null, customText: '' });
      }
    } else {
      const opts = getSmartOptions(block.header);
      const hasC = opts.some((o) => /^custom$|^other$|^my own|^i'll type|^type your/i.test(o));
      if (!hasC) opts.push('Custom');
      questions.push({ id: `q${questions.length}`, text: formatQuestion(block.header), options: opts, answer: null, customText: '' });
    }
  }

  const intro =
    introLines.filter((l) => l.length > 20).slice(0, 2).join(' ').trim() ||
    "To create exactly what you need, answer these quick questions:";

  return { intro, questions };
}

// ── Sparkle logo ──────────────────────────────────────────────────────────────

function SparkleAvatar({ size = 32 }: { size?: number }) {
  return (
    <div
      className="flex shrink-0 items-center justify-center rounded-[10px] bg-navy text-white overflow-hidden"
      style={{ width: size, height: size }}
    >
      <img src="/brand/mark-on-dark-96.png" alt="Daky" className="h-[68%] w-[68%] object-contain" />
    </div>
  );
}

// ── Waveform ──────────────────────────────────────────────────────────────────

function WaveformBars() {
  return (
    <span className="flex items-end gap-0.5" aria-hidden>
      {[3, 5, 8, 5, 3, 7, 4, 6, 3].map((h, i) => (
        <span key={i} className="w-0.5 rounded-full bg-indigo-500 animate-pulse"
          style={{ height: `${h}px`, animationDelay: `${i * 0.07}s`, animationDuration: '0.6s' }} />
      ))}
    </span>
  );
}

// ── Markdown-lite ─────────────────────────────────────────────────────────────

function renderText(text: string) {
  return text.split('\n').map((line, i) => {
    const parts = line.split(/(\*\*[^*]+\*\*)/g).map((p, j) =>
      p.startsWith('**') && p.endsWith('**') ? <strong key={j}>{p.slice(2, -2)}</strong> : <span key={j}>{p}</span>,
    );
    return <p key={i} className={i > 0 ? 'mt-1' : ''}>{parts}</p>;
  });
}

// ── Form card ────────────────────────────────────────────────────────────────

function FormCard({ msg, onSubmit }: { msg: FormMessage; onSubmit: (formatted: string) => void }) {
  const [answers, setAnswers] = useState<Record<string, { selected: string | null; custom: string }>>({});

  const pick = (qId: string, opt: string) =>
    setAnswers((prev) => ({ ...prev, [qId]: { selected: opt, custom: '' } }));
  const setCustomText = (qId: string, txt: string) =>
    setAnswers((prev) => ({ ...prev, [qId]: { selected: 'Custom', custom: txt } }));

  const canSubmit =
    !msg.submitted &&
    msg.questions.every((q) => {
      const a = answers[q.id];
      if (!a?.selected) return false;
      if (a.selected === 'Custom' && !a.custom.trim()) return false;
      return true;
    });

  const handleSubmit = () => {
    const parts = msg.questions.map((q) => {
      const a = answers[q.id];
      const ans = a?.selected === 'Custom' ? a.custom.trim() : (a?.selected ?? 'Not specified');
      return `${q.text} → ${ans}`;
    });
    onSubmit(parts.join('\n'));
  };

  return (
    <div className="rounded-xl border border-indigo-100 bg-white overflow-hidden shadow-sm text-xs">
      {/* Header */}
      <div className="px-3.5 py-2.5 border-b border-indigo-50" style={{ background: 'linear-gradient(135deg,#EAF1FF,#EAF1FF)' }}>
        <div className="flex items-center gap-2">
          <div className="flex h-6 w-6 shrink-0 items-center justify-center rounded-lg bg-indigo-100">
            <Sparkles size={12} className="text-indigo-600" />
          </div>
          <div>
            <p className="text-[11px] font-bold text-indigo-800">Quick Setup</p>
            <p className="text-[10px] text-indigo-500 leading-snug">{msg.intro}</p>
          </div>
        </div>
      </div>

      {/* Questions */}
      <div className="px-3.5 py-3 space-y-4 max-h-64 overflow-y-auto">
        {msg.questions.map((q, i) => {
          const a = answers[q.id];
          const isCustom = a?.selected === 'Custom';
          return (
            <div key={q.id}>
              <p className="font-bold text-slate-600 mb-1.5">
                <span className="mr-1.5 text-indigo-400">{i + 1}.</span>
                {q.text}
              </p>
              <div className="flex flex-wrap gap-1.5">
                {q.options.map((opt) => {
                  const picked = a?.selected === opt;
                  const isC = opt === 'Custom';
                  return (
                    <button
                      key={opt}
                      type="button"
                      disabled={msg.submitted}
                      onClick={() => pick(q.id, opt)}
                      className={`rounded-full border px-2.5 py-1 font-semibold transition-all disabled:opacity-60 ${
                        picked
                          ? isC
                            ? 'border-slate-600 bg-slate-700 text-white'
                            : 'border-indigo-600 bg-indigo-600 text-white'
                          : isC
                          ? 'border-slate-300 bg-white text-slate-500 hover:border-slate-400'
                          : 'border-slate-200 bg-slate-50 text-slate-700 hover:border-indigo-300 hover:bg-indigo-50 hover:text-indigo-700'
                      }`}
                    >
                      {opt}
                    </button>
                  );
                })}
              </div>
              {isCustom && (
                <input
                  type="text"
                  placeholder="Type your answer…"
                  value={a?.custom ?? ''}
                  onChange={(e) => setCustomText(q.id, e.target.value)}
                  onKeyDown={(e) => { if (e.key === 'Enter' && canSubmit) handleSubmit(); }}
                  disabled={msg.submitted}
                  autoFocus
                  className="mt-2 w-full rounded-lg border border-indigo-200 bg-indigo-50/40 px-2.5 py-1.5 text-xs text-slate-800 placeholder-slate-400 focus:outline-none focus:ring-1 focus:ring-indigo-300"
                />
              )}
            </div>
          );
        })}
      </div>

      {/* Footer */}
      <div className="px-3.5 py-2.5 border-t border-slate-100">
        {msg.submitted ? (
          <div className="flex items-center gap-2">
            <CheckCircle size={13} className="text-emerald-500 shrink-0" />
            <p className="text-[11px] text-emerald-600 font-semibold">Generating your content…</p>
          </div>
        ) : (
          <button
            type="button"
            onClick={handleSubmit}
            disabled={!canSubmit}
            className="flex w-full items-center justify-center gap-1.5 rounded-xl bg-indigo-600 py-2 font-bold text-white hover:bg-indigo-700 disabled:opacity-40 transition-colors"
          >
            Generate <Send size={11} />
          </button>
        )}
      </div>
    </div>
  );
}

// ── Scheduler card ───────────────────────────────────────────────────────────

function SchedulerCard({
  msg,
  onSchedule,
}: {
  msg: SchedulerMessage;
  onSchedule: (isoDate: string, label: string) => void;
}) {
  const [date, setDate] = useState('');
  const [time, setTime] = useState('09:00');
  const [quickPicked, setQuickPicked] = useState<string | null>(null);

  const pad = (n: number) => String(n).padStart(2, '0');

  const quickOptions = (() => {
    const now = new Date();
    const tomorrow = new Date(now);
    tomorrow.setDate(now.getDate() + 1);
    const saturday = new Date(now);
    saturday.setDate(now.getDate() + ((6 - now.getDay() + 7) % 7 || 7));
    const nextMonday = new Date(now);
    nextMonday.setDate(now.getDate() + ((1 - now.getDay() + 7) % 7 || 7));

    const fmt = (d: Date) =>
      `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

    return [
      { label: 'Tonight 8 PM', date: fmt(now), time: '20:00' },
      { label: 'Tomorrow 9 AM', date: fmt(tomorrow), time: '09:00' },
      { label: 'This weekend', date: fmt(saturday), time: '10:00' },
      { label: 'Next Monday', date: fmt(nextMonday), time: '09:00' },
    ];
  })();

  const pickQuick = (opt: (typeof quickOptions)[0]) => {
    setDate(opt.date);
    setTime(opt.time);
    setQuickPicked(opt.label);
  };

  const previewLabel = (() => {
    if (!date) return null;
    const dt = new Date(`${date}T${time}`);
    return dt.toLocaleString(undefined, {
      weekday: 'short',
      month: 'short',
      day: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
    });
  })();

  const handleSchedule = () => {
    const iso = new Date(`${date}T${time}`).toISOString();
    onSchedule(iso, previewLabel ?? date);
  };

  return (
    <div className="rounded-xl border border-blue-100 bg-white overflow-hidden shadow-sm text-xs">
      {/* Header */}
      <div className="px-3.5 py-2.5 border-b border-blue-50" style={{ background: 'linear-gradient(135deg,#eff6ff,#EAF1FF)' }}>
        <div className="flex items-center gap-2">
          <div className="flex h-6 w-6 shrink-0 items-center justify-center rounded-lg bg-blue-100">
            <Calendar size={12} className="text-blue-600" />
          </div>
          <div>
            <p className="text-[11px] font-bold text-blue-800">Schedule Post</p>
            {msg.postTitle && (
              <p className="text-[10px] text-blue-400 truncate max-w-[220px]">"{msg.postTitle}"</p>
            )}
          </div>
        </div>
      </div>

      {msg.submitted ? (
        <div className="px-3.5 py-4 flex items-center gap-2">
          <CheckCircle size={14} className="text-emerald-500 shrink-0" />
          <p className="text-[11px] text-emerald-700 font-semibold">Post scheduled!</p>
        </div>
      ) : (
        <>
          {/* Quick presets */}
          <div className="px-3.5 pt-3 pb-2">
            <p className="mb-1.5 text-[10px] font-bold uppercase tracking-widest text-slate-400">Quick pick</p>
            <div className="grid grid-cols-2 gap-1.5">
              {quickOptions.map((opt) => (
                <button
                  key={opt.label}
                  type="button"
                  onClick={() => pickQuick(opt)}
                  className={`flex items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-[11px] font-semibold transition-all text-left ${
                    quickPicked === opt.label
                      ? 'border-blue-500 bg-blue-50 text-blue-700'
                      : 'border-slate-200 bg-slate-50 text-slate-600 hover:border-blue-300 hover:bg-blue-50/60'
                  }`}
                >
                  <Clock size={10} className="shrink-0" />
                  {opt.label}
                </button>
              ))}
            </div>
          </div>

          {/* Custom date + time */}
          <div className="px-3.5 pb-2">
            <p className="mb-1.5 text-[10px] font-bold uppercase tracking-widest text-slate-400">Or pick a date</p>
            <div className="flex gap-2">
              <input
                type="date"
                value={date}
                min={new Date().toISOString().slice(0, 10)}
                onChange={(e) => { setDate(e.target.value); setQuickPicked(null); }}
                className="flex-1 rounded-lg border border-slate-200 px-2 py-1.5 text-[11px] text-slate-800 focus:outline-none focus:ring-1 focus:ring-blue-300"
              />
              <input
                type="time"
                value={time}
                onChange={(e) => { setTime(e.target.value); setQuickPicked(null); }}
                className="w-24 rounded-lg border border-slate-200 px-2 py-1.5 text-[11px] text-slate-800 focus:outline-none focus:ring-1 focus:ring-blue-300"
              />
            </div>
          </div>

          {/* Preview */}
          {previewLabel && (
            <div className="mx-3.5 mb-2 rounded-lg bg-blue-50 border border-blue-100 px-3 py-2 flex items-center gap-2">
              <Calendar size={11} className="text-blue-500 shrink-0" />
              <span className="text-[11px] text-blue-700 font-semibold">{previewLabel}</span>
            </div>
          )}

          {/* Confirm button */}
          <div className="px-3.5 pb-3">
            <button
              type="button"
              disabled={!date}
              onClick={handleSchedule}
              className="flex w-full items-center justify-center gap-1.5 rounded-xl bg-blue-600 py-2 text-[11px] font-bold text-white hover:bg-blue-700 disabled:opacity-40 transition-colors"
            >
              <Calendar size={11} /> Confirm Schedule
            </button>
          </div>
        </>
      )}
    </div>
  );
}

// ── Poll card ─────────────────────────────────────────────────────────────────

function PollCard({ title }: { title?: string }) {
  const [voted, setVoted] = useState<number | null>(null);
  const options = ['Option A', 'Option B', 'Option C'];
  const votes = [42, 35, 23];
  const total = votes.reduce((a, b) => a + b, 0);
  return (
    <div className="rounded-xl border border-indigo-100 bg-white overflow-hidden shadow-sm text-xs">
      <div className="px-3 py-2 border-b border-indigo-50 bg-indigo-50 flex items-center gap-2">
        <BarChart2 size={13} className="text-indigo-500" />
        <span className="font-semibold text-indigo-700">{title ?? 'Poll Preview'}</span>
      </div>
      <div className="px-3 py-2 space-y-2">
        {options.map((opt, i) => {
          const pct = Math.round((votes[i] / total) * 100);
          return (
            <button key={i} type="button" onClick={() => setVoted(i)}
              className={`w-full rounded-lg overflow-hidden border text-left transition-all ${voted === i ? 'border-indigo-400' : 'border-slate-200 hover:border-indigo-200'}`}>
              <div className="relative px-2.5 py-1.5">
                <div className="absolute inset-0 rounded-lg" style={{ width: `${pct}%`, background: voted === i ? 'rgba(37, 99, 235,0.15)' : 'rgba(148,163,184,0.1)' }} />
                <div className="relative flex items-center justify-between">
                  <span className={voted === i ? 'font-semibold text-indigo-700' : 'text-slate-700'}>{opt}</span>
                  <span className="text-slate-400">{pct}%</span>
                </div>
              </div>
            </button>
          );
        })}
      </div>
      <div className="px-3 pb-3 flex gap-2">
        <button type="button" className="flex-1 rounded-lg bg-indigo-600 py-1.5 text-center text-xs font-semibold text-white hover:bg-indigo-700">Create Poll</button>
        <button type="button" className="flex-1 rounded-lg border border-slate-200 py-1.5 text-center text-xs font-semibold text-slate-600 hover:bg-slate-50">Share with Team</button>
      </div>
    </div>
  );
}

// ── Post preview cards ────────────────────────────────────────────────────────

function PostPreviewCard({ content, title }: { content: string; title?: string }) {
  return (
    <div className="rounded-xl border border-slate-200 bg-white overflow-hidden shadow-sm text-xs">
      <div className="px-3 py-2 border-b border-slate-100 bg-slate-50 flex items-center justify-between">
        <span className="font-semibold text-slate-700">Post Preview</span>
        <span className="rounded-full bg-indigo-50 px-2 py-0.5 text-indigo-600 font-medium">Draft</span>
      </div>
      {title && <p className="px-3 pt-2 font-semibold text-slate-800">{title}</p>}
      <p className="px-3 py-2 text-slate-700 leading-relaxed whitespace-pre-wrap">{content}</p>
      <div className="px-3 pb-3 flex gap-2">
        <a href="/posts" className="flex items-center gap-1 rounded-lg border border-slate-200 px-2.5 py-1.5 text-xs font-semibold text-slate-600 hover:bg-slate-50">
          <Edit2 size={11} /> Edit
        </a>
        <a href="/posts" className="flex items-center gap-1 rounded-lg bg-indigo-600 px-2.5 py-1.5 text-xs font-semibold text-white hover:bg-indigo-700">Post</a>
      </div>
    </div>
  );
}

function PostDraftedCard({ title, multiple }: { title?: string; multiple?: boolean }) {
  return (
    <div className="rounded-xl border border-emerald-200 bg-emerald-50 px-3 py-2.5">
      <div className="flex items-center gap-2">
        <CheckCircle size={15} className="text-emerald-600 shrink-0" />
        <div className="flex-1 min-w-0">
          <p className="text-xs font-semibold text-emerald-800">{multiple ? 'Posts Drafted' : 'Post Drafted'}</p>
          {title && <p className="truncate text-xs text-emerald-700">"{title}"</p>}
        </div>
        <a href="/posts" className="shrink-0 flex items-center gap-1 rounded-lg bg-emerald-600 px-2.5 py-1 text-xs font-semibold text-white hover:bg-emerald-700">
          {multiple ? 'Visit Posts' : 'View Post'} <ExternalLink size={10} />
        </a>
      </div>
    </div>
  );
}

// ── Tool card ─────────────────────────────────────────────────────────────────

function fmtElapsed(ms: number): string {
  const s = Math.max(0, Math.round(ms / 1000));
  return s < 60 ? `${s}s` : `${Math.floor(s / 60)}m ${String(s % 60).padStart(2, '0')}s`;
}

function ActivityCard({ msg }: { msg: ActivityMessage }) {
  const [open, setOpen] = useState(false);
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    if (msg.status !== 'working') return;
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [msg.status]);

  const elapsed = fmtElapsed((msg.endedAt ?? now) - msg.startedAt);
  const current = msg.steps[msg.steps.length - 1] ?? 'Starting';
  const working = msg.status === 'working';
  const hasDetail = msg.steps.length > 1 || Boolean(msg.thinking);
  // Only once a post exists: a batch reports its own progress in its card.
  const postLine = msg.postsDone === 0 ? ''
    : msg.postsTotal ? `${Math.min(msg.postsDone, msg.postsTotal)} of ${msg.postsTotal} posts`
      : `${msg.postsDone} post${msg.postsDone === 1 ? '' : 's'} saved`;

  return (
    <div className={`rounded-xl border px-3 py-2 text-xs ${msg.status === 'failed' ? 'border-red-100 bg-red-50/60' : 'border-slate-200 bg-white'}`}>
      <button type="button" onClick={() => hasDetail && setOpen((o) => !o)} className="flex w-full items-center gap-2 text-left" aria-expanded={open}>
        {working
          ? <Loader2 size={13} className="shrink-0 animate-spin text-indigo-500" />
          : msg.status === 'failed'
            ? <X size={13} className="shrink-0 text-red-500" />
            : <CheckCircle size={13} className="shrink-0 text-emerald-500" />}
        <span className={`min-w-0 flex-1 truncate ${working ? 'text-slate-700' : msg.status === 'failed' ? 'text-red-600' : 'text-slate-500'}`}>
          {working ? `${current}…` : msg.status === 'failed' ? `Stopped after ${elapsed}` : `Worked for ${elapsed}${postLine ? ` · ${postLine}` : ''}`}
        </span>
        {working && <span className="shrink-0 tabular-nums text-slate-400">{elapsed}</span>}
        {hasDetail && <ChevronDown size={13} className={`shrink-0 text-slate-400 transition-transform ${open ? 'rotate-180' : ''}`} />}
      </button>

      {working && postLine && (
        <div className="mt-2">
          <div className="mb-1 flex justify-between text-[10.5px] text-slate-500"><span>Posts</span><span className="tabular-nums">{postLine}</span></div>
          {msg.postsTotal && (
            <div className="h-1.5 overflow-hidden rounded-full bg-slate-100">
              <div className="h-full rounded-full bg-indigo-500 transition-all duration-500" style={{ width: `${Math.min(100, (msg.postsDone / msg.postsTotal) * 100)}%` }} />
            </div>
          )}
        </div>
      )}

      {open && hasDetail && (
        <div className="mt-2 space-y-1.5 border-t border-slate-100 pt-2">
          <ol className="space-y-1">
            {msg.steps.map((step, i) => {
              const live = working && i === msg.steps.length - 1;
              return (
                <li key={`${i}-${step}`} className="flex items-start gap-1.5 text-[11px] text-slate-600">
                  {live ? <Loader2 size={11} className="mt-0.5 shrink-0 animate-spin text-indigo-400" /> : <CheckCircle size={11} className="mt-0.5 shrink-0 text-slate-300" />}
                  <span>{step}</span>
                </li>
              );
            })}
          </ol>
          {msg.thinking && (
            <div className="max-h-40 overflow-y-auto whitespace-pre-wrap rounded-lg bg-slate-50 px-2 py-1.5 text-[11px] italic leading-relaxed text-slate-500">
              {msg.thinking}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function EstimateCard({ msg, busy, onProceed, onCancel }: { msg: EstimateMessage; busy: boolean; onProceed: () => void; onCancel: () => void }) {
  const short = msg.balance !== null && msg.balance < msg.credits;
  return (
    <div className="rounded-xl border border-amber-200 bg-amber-50/70 px-3 py-2.5 text-xs">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="font-semibold text-slate-800">{msg.label}</p>
          {msg.lines.map((l) => <p key={l} className="text-[11px] text-slate-500">{l}</p>)}
        </div>
        <div className="shrink-0 text-right">
          <p className="text-sm font-bold tabular-nums text-slate-900">{msg.credits}</p>
          <p className="text-[10px] uppercase tracking-wide text-slate-500">credits</p>
        </div>
      </div>
      {msg.balance !== null && (
        <p className={`mt-1 text-[11px] ${short ? 'text-red-600' : 'text-slate-500'}`}>
          Balance {msg.balance} → {Math.max(0, msg.balance - msg.credits)} after this{short ? ' — not enough credits to finish' : ''}
        </p>
      )}
      {msg.status === 'pending' ? (
        <div className="mt-2 flex gap-2">
          <button type="button" disabled={busy} onClick={onProceed}
            className="rounded-lg bg-indigo-600 px-3 py-1 text-[11px] font-semibold text-white hover:bg-indigo-700 disabled:opacity-50">Proceed</button>
          <button type="button" disabled={busy} onClick={onCancel}
            className="rounded-lg bg-white px-3 py-1 text-[11px] font-semibold text-slate-600 ring-1 ring-slate-200 hover:bg-slate-50 disabled:opacity-50">Cancel</button>
        </div>
      ) : (
        <p className={`mt-1.5 text-[11px] font-medium ${msg.status === 'failed' ? 'text-red-600' : msg.status === 'cancelled' ? 'text-slate-400' : 'text-emerald-700'}`}>
          {msg.status === 'running' ? 'Running…' : msg.status === 'done' ? '✓ Approved' : msg.status === 'cancelled' ? 'Cancelled — nothing was charged' : msg.error || 'Failed'}
        </p>
      )}
    </div>
  );
}

function BatchCard({ msg }: { msg: BatchMessage }) {
  const [openIdx, setOpenIdx] = useState<number | null>(null);
  const done = msg.items.filter((i) => i.status === 'done').length;
  const failed = msg.items.filter((i) => i.status === 'failed').length;
  return (
    <div className="overflow-hidden rounded-xl border border-slate-200 bg-white text-xs">
      <div className="border-b border-slate-100 px-3 py-2">
        <div className="flex items-center justify-between gap-2">
          <span className="font-semibold text-slate-700">
            {msg.status === 'running' ? 'Writing posts' : 'Posts on your calendar'} · {done} of {msg.total}
          </span>
          <span className="tabular-nums text-slate-500">{msg.creditsUsed} credits used</span>
        </div>
        <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-slate-100">
          <div className="h-full rounded-full bg-indigo-500 transition-all duration-500" style={{ width: `${msg.total ? ((done + failed) / msg.total) * 100 : 0}%` }} />
        </div>
        {msg.stopped && <p className="mt-1 text-[11px] text-red-600">{msg.stopped}</p>}
      </div>
      <ul className="max-h-64 divide-y divide-slate-100 overflow-y-auto">
        {msg.items.map((item) => (
          <li key={item.index} className="px-3 py-1.5">
            <button type="button" className="flex w-full items-center gap-2 text-left" disabled={item.status !== 'done'}
              onClick={() => setOpenIdx((o) => (o === item.index ? null : item.index))}>
              {item.status === 'writing' ? <Loader2 size={12} className="shrink-0 animate-spin text-indigo-500" />
                : item.status === 'done' ? <CheckCircle size={12} className="shrink-0 text-emerald-500" />
                  : item.status === 'failed' ? <X size={12} className="shrink-0 text-red-500" />
                    : <Clock size={12} className="shrink-0 text-slate-300" />}
              <span className={`min-w-0 flex-1 truncate ${item.status === 'done' ? 'font-medium text-slate-800' : 'text-slate-500'}`}>
                {item.post?.title || item.topic}
              </span>
              {item.post?.scheduled_at && (
                <span className="shrink-0 text-[10.5px] text-slate-400">
                  {new Date(item.post.scheduled_at).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}
                </span>
              )}
            </button>
            {item.status === 'failed' && item.error && <p className="pl-5 text-[10.5px] text-red-500">{item.error}</p>}
            {openIdx === item.index && item.post?.content && (
              <p className="mt-1 whitespace-pre-wrap rounded-lg bg-slate-50 px-2 py-1.5 pl-2 text-[11px] leading-relaxed text-slate-600">{item.post.content}</p>
            )}
          </li>
        ))}
      </ul>
      {done > 0 && (
        <div className="border-t border-slate-100 px-3 py-1.5 text-right">
          <a href="/posts" className="text-[11px] font-semibold text-indigo-600 hover:underline">Open in Posts →</a>
        </div>
      )}
    </div>
  );
}

function ToolCard({ msg }: { msg: ToolMessage }) {
  if (msg.status === 'running') {
    return (
      <div className="flex items-center gap-2 rounded-xl border border-purple-100 bg-purple-50 px-3 py-2 text-xs text-purple-700">
        <span className="flex gap-0.5">
          {[0, 1, 2].map((i) => (<span key={i} className="h-1.5 w-1.5 rounded-full bg-purple-400 animate-bounce" style={{ animationDelay: `${i * 0.15}s` }} />))}
        </span>
        {msg.label}
      </div>
    );
  }
  if (msg.status === 'error') {
    return <div className="rounded-xl border border-red-100 bg-red-50 px-3 py-2 text-xs text-red-600">✗ {msg.error || 'Action failed'}</div>;
  }
  if (msg.name === 'get_recent_posts') {
    const posts: any[] = msg.result?.posts ?? [];
    return (
      <div className="rounded-xl border border-slate-200 bg-white overflow-hidden text-xs">
        <div className="border-b border-slate-100 px-3 py-2 font-semibold text-slate-700">{posts.length} post{posts.length !== 1 ? 's' : ''} found</div>
        {posts.length === 0 ? <p className="px-3 py-2 text-slate-400">No posts yet.</p> : (
          <ul className="divide-y divide-slate-100">
            {posts.slice(0, 5).map((p: any) => (
              <li key={p.id} className="flex items-center justify-between gap-2 px-3 py-2">
                <span className="truncate text-slate-800 font-medium">{p.title || 'Untitled'}</span>
                <span className={`shrink-0 rounded-full px-2 py-0.5 font-semibold capitalize ${p.status === 'published' ? 'bg-emerald-50 text-emerald-700' : p.status === 'scheduled' ? 'bg-blue-50 text-blue-700' : 'bg-slate-100 text-slate-500'}`}>{p.status}</span>
              </li>
            ))}
          </ul>
        )}
      </div>
    );
  }
  if (msg.name === 'get_connected_platforms') {
    const platforms: any[] = msg.result?.connected ?? [];
    return (
      <div className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs">
        <span className="font-semibold text-slate-700">Connected: </span>
        {platforms.length === 0 ? <span className="text-slate-400">None connected</span> : platforms.map((p: any) => (
          <span key={p.platform} className="mr-1.5 inline-block rounded-full bg-slate-100 px-2 py-0.5 capitalize text-slate-700">{p.platform}</span>
        ))}
      </div>
    );
  }
  if (msg.name === 'create_draft') {
    const post = msg.result?.post;
    const posts: any[] = msg.result?.posts ?? (post ? [post] : []);
    const isMultiple = posts.length > 1;
    const content = post?.content ?? '';
    const title = post?.title;
    if (!isMultiple && content && content.length < 400) return <PostPreviewCard content={content} title={title} />;
    return <PostDraftedCard title={isMultiple ? undefined : title} multiple={isMultiple} />;
  }
  if (msg.name === 'schedule_post') {
    const post = msg.result?.post;
    const scheduledAt = post?.scheduled_at;
    return (
      <div className="rounded-xl border border-emerald-200 bg-emerald-50 px-3 py-2.5">
        <div className="flex items-center gap-2">
          <CheckCircle size={15} className="text-emerald-600 shrink-0" />
          <div className="flex-1 min-w-0">
            <p className="text-xs font-semibold text-emerald-800">Post scheduled</p>
            {post?.title && <p className="truncate text-xs text-emerald-700">"{post.title}"</p>}
            {scheduledAt && <p className="text-xs text-emerald-600 mt-0.5">{new Date(scheduledAt).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' })}</p>}
          </div>
          <a href="/posts" className="shrink-0 rounded-lg bg-emerald-600 px-2.5 py-1 text-xs font-semibold text-white hover:bg-emerald-700">View</a>
        </div>
      </div>
    );
  }
  if (msg.name === 'create_poll' || msg.label?.toLowerCase().includes('poll')) {
    return <PollCard title={msg.result?.poll?.title} />;
  }
  return null;
}

// ── Plan card ─────────────────────────────────────────────────────────────────

function PlanCard({
  msg,
  onExecute,
  onCancel,
}: {
  msg: PlanMessage;
  onExecute: (planId: string, agents: PlanAgent[]) => void;
  onCancel: (planId: string) => void;
}) {
  const [agents, setAgents] = useState<PlanAgent[]>(msg.agents);
  const enabledCount = agents.filter((a) => a.enabled).length;
  const isExecuting = msg.status === 'executing';
  const isDone = msg.status === 'done';

  const toggle = (key: string) => {
    if (isExecuting || isDone) return;
    setAgents((prev) => prev.map((a) => (a.key === key ? { ...a, enabled: !a.enabled } : a)));
  };

  return (
    <div className="rounded-xl border border-indigo-100 bg-white overflow-hidden shadow-sm text-xs">
      {/* Header */}
      <div className="px-3.5 py-2.5 border-b border-indigo-50" style={{ background: 'linear-gradient(135deg,#EAF1FF,#EAF1FF)' }}>
        <div className="flex items-center gap-2">
          <div className="flex h-6 w-6 shrink-0 items-center justify-center rounded-lg bg-indigo-100 text-base">✦</div>
          <div className="flex-1 min-w-0">
            <p className="text-[11px] font-bold text-indigo-800">Team Analysis</p>
            <p className="text-[10px] text-indigo-500 leading-snug">{msg.summary}</p>
          </div>
        </div>
      </div>

      {/* Agents */}
      <div className="px-3.5 py-3 space-y-2">
        {agents.map((agent) => {
          const status = msg.agentStatuses?.[agent.key];
          const isRunning = status?.running;
          const hasResult = status?.analysis;
          return (
            <div
              key={agent.key}
              className={`flex items-start gap-2.5 rounded-lg border p-2 transition-all ${
                agent.enabled ? 'border-slate-200 bg-white' : 'border-slate-100 bg-slate-50 opacity-50'
              }`}
            >
              <div
                className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-sm font-bold"
                style={{ background: `${agent.color}18`, color: agent.color }}
              >
                {agent.icon}
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-1.5">
                  <span className="text-[11px] font-bold" style={{ color: agent.color }}>{agent.name}</span>
                  {isRunning && (
                    <span className="flex gap-0.5">
                      {[0, 1, 2].map((i) => (
                        <span key={i} className="h-1 w-1 rounded-full animate-bounce"
                          style={{ background: agent.color, animationDelay: `${i * 0.15}s` }} />
                      ))}
                    </span>
                  )}
                  {hasResult && !isRunning && <span className="text-emerald-500 text-[10px]">✓</span>}
                </div>
                <p className="text-[10px] text-slate-500 leading-snug">{agent.task}</p>
                {hasResult && (
                  <p className="mt-1 text-[10px] text-slate-700 leading-snug line-clamp-2">{hasResult}</p>
                )}
              </div>
              {!isExecuting && !isDone && (
                <button
                  type="button"
                  onClick={() => toggle(agent.key)}
                  className={`shrink-0 flex h-4 w-7 items-center rounded-full transition-colors ${
                    agent.enabled ? 'bg-indigo-500' : 'bg-slate-300'
                  }`}
                >
                  <span
                    className={`h-3 w-3 rounded-full bg-white shadow-sm transition-transform ${
                      agent.enabled ? 'translate-x-3.5' : 'translate-x-0.5'
                    }`}
                  />
                </button>
              )}
            </div>
          );
        })}
      </div>

      {/* Actions */}
      {!isDone && (
        <div className="px-3.5 pb-3 flex gap-2">
          {isExecuting ? (
            <div className="flex items-center gap-2 text-[11px] text-indigo-600 font-medium">
              <span className="flex gap-0.5">
                {[0, 1, 2].map((i) => (
                  <span key={i} className="h-1.5 w-1.5 rounded-full bg-indigo-400 animate-bounce"
                    style={{ animationDelay: `${i * 0.15}s` }} />
                ))}
              </span>
              Team at work…
            </div>
          ) : (
            <>
              <button
                type="button"
                disabled={enabledCount === 0}
                onClick={() => onExecute(msg.id, agents)}
                className="flex-1 rounded-xl bg-indigo-600 py-2 text-[11px] font-bold text-white hover:bg-indigo-700 disabled:opacity-40 transition-colors"
              >
                Execute Plan
              </button>
              <button
                type="button"
                onClick={() => onCancel(msg.id)}
                className="rounded-xl border border-slate-200 px-3 py-2 text-[11px] font-semibold text-slate-600 hover:bg-slate-50 transition-colors"
              >
                Cancel
              </button>
            </>
          )}
        </div>
      )}
    </div>
  );
}

// ── Suggestion cards ──────────────────────────────────────────────────────────

const SUGGESTIONS = [
  { icon: '📢', title: 'Draft a social post', subtitle: 'Engaging content in seconds.', prompt: 'Draft an engaging social media post for my brand' },
  { icon: '🎤', title: 'Transcribe audio', subtitle: 'Voice to structured notes.', prompt: 'Help me transcribe and structure audio notes' },
  { icon: '📊', title: 'Create a poll', subtitle: 'Gather data quickly.', prompt: 'Create a poll to gather feedback from my audience' },
] as const;

// ── Main Widget ───────────────────────────────────────────────────────────────

export default function ChatWidget() {
  const [open, setOpen] = useState(false);
  // Every chat session's messages, keyed by session id; the open one is `activeId`.
  // A session keeps running (and updating its own messages) while another is open.
  const [activeId, setActiveId] = useState<string>(() => {
    try { return localStorage.getItem('daky_chat_active') || crypto.randomUUID(); } catch { return crypto.randomUUID(); }
  });
  const [store, setStore] = useState<Record<string, Message[]>>({});
  const [runningIds, setRunningIds] = useState<Record<string, boolean>>({});
  const [sessionList, setSessionList] = useState<SessionMeta[]>([]);
  const [showHistory, setShowHistory] = useState(false);
  const savedRef = useRef<Record<string, string>>({});
  const loadedRef = useRef<Record<string, boolean>>({});

  const setMessagesFor = useCallback((sid: string) => (u: Message[] | ((prev: Message[]) => Message[])) =>
    setStore((st) => ({ ...st, [sid]: typeof u === 'function' ? u(st[sid] ?? []) : u })), []);
  const setLoadingFor = useCallback((sid: string) => (v: boolean) => setRunningIds((r) => ({ ...r, [sid]: v })), []);
  const messages = store[activeId] ?? NO_MESSAGES;
  const setMessages = setMessagesFor(activeId);
  const loading = Boolean(runningIds[activeId]);
  const [input, setInput] = useState('');
  const [attachedImages, setAttachedImages] = useState<AttachedImg[]>([]);

  // recording: 'idle' | 'recording' | 'pending'
  const [recordingState, setRecordingState] = useState<'idle' | 'recording' | 'pending'>('idle');
  const [recordingSeconds, setRecordingSeconds] = useState(0);
  const recognitionRef = useRef<any>(null);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const bottomRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const abortRef = useRef<AbortController | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => { if (open) setTimeout(() => inputRef.current?.focus(), 80); }, [open]);
  useEffect(() => { bottomRef.current?.scrollIntoView({ behavior: 'smooth' }); }, [messages, loading]);

  // ── Send ──────────────────────────────────────────────────────────────────

  const send = useCallback(async (textOverride?: string, imgsOverride?: AttachedImg[], base?: Message[]) => {
    const rawText = (textOverride ?? input).trim();
    const imgs = imgsOverride ?? attachedImages;
    // A retry sends from the conversation as it was before the failed turn.
    const prior = base ?? messages;
    // Bound to the session this message was sent in, so switching chats mid-reply is safe.
    const sid = activeId;
    const setMessages = setMessagesFor(sid);
    const setLoading = setLoadingFor(sid);

    // Client-side intercept: if user manually types "schedule it/the post" and there's a draft, show scheduler
    if (/^schedule\b/i.test(rawText) && !imgsOverride) {
      const lastDraft = [...prior].reverse().find(
        (m): m is ToolMessage => m.kind === 'tool' && m.name === 'create_draft' && (m.status === 'done' || m.status === 'error'),
      );
      if (lastDraft) {
        setInput('');
        setAttachedImages([]);
        setMessages((prev) => [
          ...prev,
          { kind: 'text', id: crypto.randomUUID(), role: 'user', content: rawText } satisfies TextMessage,
          { kind: 'scheduler', id: `sched-${Date.now()}`, postTitle: lastDraft.result?.post?.title, submitted: false } satisfies SchedulerMessage,
        ]);
        return;
      }
    }

    // Build the text to show in the user bubble (clean)
    // Build the text to send to API (with image refs if any)
    const apiText = imgs.length
      ? `${rawText}${rawText ? '\n' : ''}[Attached images: ${imgs.map((i) => i.name).join(', ')}]`
      : rawText;

    if (!apiText || loading) return;

    const userMsg: TextMessage = {
      kind: 'text',
      id: crypto.randomUUID(),
      role: 'user',
      content: rawText || `[Attached: ${imgs.map((i) => i.name).join(', ')}]`,
      images: imgs.length > 0 ? imgs : undefined,
      raw: rawText,
    };
    const assistantId = crypto.randomUUID();
    const activityId = `activity-${assistantId}`;
    const activity: ActivityMessage = {
      kind: 'activity', id: activityId, status: 'working', steps: ['Understanding your request'], thinking: '',
      startedAt: Date.now(), postsDone: 0, postsTotal: requestedPostCount(rawText),
    };
    const updateActivity = (fn: (a: ActivityMessage) => ActivityMessage) =>
      setMessages((prev) => prev.map((m) => (m.id === activityId && m.kind === 'activity' ? fn(m) : m)));
    const addStep = (step: string) =>
      updateActivity((a) => (a.steps[a.steps.length - 1] === step ? a : { ...a, steps: [...a.steps, step].slice(-30) }));

    setMessages([...prior, userMsg, activity, { kind: 'text', id: assistantId, role: 'assistant', content: '' }]);
    setSessionList((list) => {
      const meta = { id: sid, title: sessionTitle([...prior, userMsg]), updated_at: new Date().toISOString() };
      return [meta, ...list.filter((x) => x.id !== sid)];
    });
    setInput('');
    setAttachedImages([]);
    setRecordingState('idle');
    setLoading(true);

    const token = localStorage.getItem('auth_token');
    // Build history with image refs included in content
    const history = [...prior, { ...userMsg, content: apiText }]
      .filter((m): m is TextMessage => m.kind === 'text')
      .map(({ role, content }) => ({ role, content }));

    try {
      const ctrl = new AbortController();
      abortRef.current = ctrl;

      // Quick intent check — haiku classifies in ~200ms
      let usePlan = false;
      let planData: any = null;
      try {
        const orchRes = await fetch(`${getApiBaseUrl()}/api/ai/orchestrate`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
          body: JSON.stringify({ messages: history }),
          signal: ctrl.signal,
        });
        if (orchRes.ok) {
          const orchJson = await orchRes.json();
          if (orchJson.type === 'plan' && Array.isArray(orchJson.agents) && orchJson.agents.length >= 2) {
            usePlan = true;
            planData = orchJson;
          }
        }
      } catch { /* proceed direct on any error */ }

      if (usePlan) {
        const planAgents: PlanAgent[] = planData.agents.map((a: any) => ({ ...a, enabled: true }));
        setMessages((prev) => [
          ...prev.filter((m) => m.id !== activityId && !(m.kind === 'text' && m.id === assistantId && m.content === '')),
          { kind: 'plan', id: assistantId, summary: planData.summary || '', agents: planAgents, status: 'pending' } satisfies PlanMessage,
        ]);
        setLoading(false);
        return;
      }

      const res = await fetch(`${getApiBaseUrl()}/api/ai/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ messages: history, page: window.location.pathname }),
        signal: ctrl.signal,
      });

      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error((data as any)?.error || 'Request failed');
      }

      const reader = res.body!.getReader();
      const decoder = new TextDecoder();
      let buffer = '';
      let finished = false;
      addStep('Connecting to the AI');

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() ?? '';

        for (const line of lines) {
          if (!line.startsWith('data: ')) continue;
          const payload = line.slice(6).trim();
          // The reply has been charged by now; the header badge re-reads the balance.
          if (payload === '[DONE]') { finished = true; notifyCreditsChanged(); break; }
          try {
            const ev = JSON.parse(payload) as any;
            if (ev.error && (!ev.type || ev.type === 'error')) throw new Error(ev.error);
            if (ev.type === 'status' && ev.text) {
              addStep(String(ev.text));
            } else if (ev.type === 'thinking' && ev.text) {
              updateActivity((a) => ({ ...a, thinking: `${a.thinking ? `${a.thinking}\n\n` : ''}${ev.text}`.slice(-6000) }));
            } else if (ev.type === 'text' && ev.text) {
              setMessages((prev) =>
                prev.map((m) => m.id === assistantId && m.kind === 'text' ? { ...m, content: m.content + ev.text } : m),
              );
            } else if (ev.type === 'estimate') {
              addStep(`Estimated ${ev.credits} credits — waiting for your OK`);
              setMessages((prev) => [
                ...prev.filter((m) => !(m.kind === 'text' && m.id === assistantId && m.content === '')),
                {
                  kind: 'estimate', id: `estimate-${ev.action_id}`, actionId: String(ev.action_id), label: String(ev.label || 'Paid action'),
                  credits: Number(ev.credits) || 0, lines: Array.isArray(ev.lines) ? ev.lines.map(String) : [],
                  balance: typeof ev.balance === 'number' ? ev.balance : null, status: 'pending',
                } satisfies EstimateMessage,
                { kind: 'text', id: assistantId, role: 'assistant', content: '' },
              ]);
            } else if (ev.type === 'tool_start') {
              addStep(String(ev.label || ev.name).replace(/…$/, ''));
              const toolId = `tool-${ev.name}-${Date.now()}`;
              setMessages((prev) => [
                ...prev.filter((m) => !(m.kind === 'text' && m.id === assistantId && m.content === '')),
                { kind: 'tool', id: toolId, name: ev.name, label: ev.label, status: 'running' },
                { kind: 'text', id: assistantId, role: 'assistant', content: '' },
              ]);
            } else if (ev.type === 'tool_done') {
              if (ev.success && POST_TOOLS.has(ev.name)) {
                const made = Array.isArray(ev.result?.posts) ? ev.result.posts.length : 1;
                updateActivity((a) => ({ ...a, postsDone: a.postsDone + made }));
              }
              setMessages((prev) =>
                prev.map((m) =>
                  m.kind === 'tool' && m.name === ev.name && m.status === 'running'
                    ? { ...m, status: ev.success ? 'done' : 'error', result: ev.result, error: ev.error }
                    : m,
                ),
              );
            }
          } catch (parseErr: any) {
            if (parseErr?.name !== 'SyntaxError') throw parseErr;
          }
        }
      }
      if (!finished) throw new Error('The connection dropped before the reply finished.');
      updateActivity((a) => ({ ...a, status: 'done', endedAt: Date.now() }));
    } catch (err: any) {
      if (err?.name === 'AbortError') { updateActivity((a) => (a.status === 'working' ? { ...a, status: 'done', endedAt: Date.now() } : a)); return; }
      updateActivity((a) => ({ ...a, status: 'failed', endedAt: Date.now() }));
      const message = err?.message === 'Failed to fetch' ? 'Could not reach the server.' : err?.message || 'Something went wrong.';
      setMessages((prev) => {
        const failed: TextMessage = { kind: 'text', id: assistantId, role: 'assistant', content: message, failed: true };
        return prev.some((m) => m.id === assistantId)
          ? prev.map((m) => (m.id === assistantId && m.kind === 'text' ? failed : m))
          : [...prev, failed];
      });
    } finally {
      setLoading(false);
      abortRef.current = null;
      // Detect form (3+ questions) in final AI text
      setTimeout(() => {
        setMessages((prev) => {
          const lastA = [...prev].reverse().find(
            (m): m is TextMessage => m.kind === 'text' && m.role === 'assistant' && !!m.content && !m.failed,
          );
          if (!lastA) return prev;
          const formId = `form-${lastA.id}`;
          if (prev.some((m) => m.id === formId)) return prev;
          const parsed = parseFormFromText(lastA.content);
          if (!parsed || parsed.questions.length < 1) return prev;
          // Trim the assistant text to just the intro
          return [
            ...prev.map((m) =>
              m.id === lastA.id && m.kind === 'text'
                ? { ...m, content: parsed.intro }
                : m,
            ),
            {
              kind: 'form',
              id: formId,
              intro: parsed.intro,
              questions: parsed.questions,
              submitted: false,
            } satisfies FormMessage,
          ];
        });
      }, 60);
    }
  }, [input, loading, messages, attachedImages, activeId, setMessagesFor, setLoadingFor]);

  /** Sends the user message behind a failed reply again, from the conversation as it was before it. */
  const retry = useCallback((failedId: string) => {
    if (loading) return;
    const idx = messages.findIndex((m) => m.id === failedId);
    let u = idx - 1;
    while (u >= 0 && !(messages[u].kind === 'text' && (messages[u] as TextMessage).role === 'user')) u--;
    if (u < 0) return;
    const original = messages[u] as TextMessage;
    void send(original.raw ?? original.content, original.images ?? [], messages.slice(0, u));
  }, [loading, messages, send]);

  const onKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); void send(); }
  };

  // ── Execute plan ──────────────────────────────────────────────────────────

  const executePlan = useCallback(async (planId: string, planAgents: PlanAgent[]) => {
    const planMsg = messages.find((m) => m.id === planId) as PlanMessage | undefined;
    if (!planMsg) return;
    const setMessages = setMessagesFor(activeId);
    const setLoading = setLoadingFor(activeId);
    const token = localStorage.getItem('auth_token');
    const history = messages.filter((m): m is TextMessage => m.kind === 'text').map(({ role, content }) => ({ role, content }));

    setMessages((prev) => prev.map((m) => m.id === planId && m.kind === 'plan' ? { ...m, status: 'executing', agents: planAgents } : m));
    setLoading(true);
    const synthId = crypto.randomUUID();
    setMessages((prev) => [...prev, { kind: 'text', id: synthId, role: 'assistant', content: '' } satisfies TextMessage]);

    try {
      const ctrl = new AbortController();
      abortRef.current = ctrl;
      const res = await fetch(`${getApiBaseUrl()}/api/ai/execute-plan`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ messages: history, plan: { summary: planMsg.summary, agents: planAgents } }),
        signal: ctrl.signal,
      });
      if (!res.ok) throw new Error('Execute plan failed');

      const reader = res.body!.getReader();
      const decoder = new TextDecoder();
      let buffer = '';
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() ?? '';
        for (const line of lines) {
          if (!line.startsWith('data: ')) continue;
          try {
            const ev = JSON.parse(line.slice(6).trim()) as any;
            if (ev.type === 'agent_start') {
              setMessages((prev) => prev.map((m) => m.id === planId && m.kind === 'plan'
                ? { ...m, agentStatuses: { ...(m.agentStatuses ?? {}), [ev.key]: { running: true, analysis: '' } } } : m));
            } else if (ev.type === 'agent_done') {
              setMessages((prev) => prev.map((m) => m.id === planId && m.kind === 'plan'
                ? { ...m, agentStatuses: { ...(m.agentStatuses ?? {}), [ev.key]: { running: false, analysis: ev.analysis || '' } } } : m));
            } else if (ev.type === 'text' && ev.text) {
              setMessages((prev) => prev.map((m) => m.id === synthId && m.kind === 'text' ? { ...m, content: m.content + ev.text } : m));
            } else if (ev.type === 'done') {
              setMessages((prev) => prev.map((m) => m.id === planId && m.kind === 'plan' ? { ...m, status: 'done' } : m));
            }
          } catch { /* skip */ }
        }
      }
    } catch (err: any) {
      if (err?.name !== 'AbortError') {
        setMessages((prev) => prev.map((m) => m.id === synthId && m.kind === 'text' ? { ...m, content: err?.message || 'Plan execution failed.' } : m));
      }
    } finally {
      setLoading(false);
      abortRef.current = null;
    }
  }, [messages, activeId, setMessagesFor, setLoadingFor]);

  const cancelPlan = useCallback((planId: string) => {
    setMessages((prev) => prev.filter((m) => m.id !== planId));
  }, [setMessages]);

  // ── Credit estimates: Proceed runs the parked action, Cancel drops it ───────

  const runAction = useCallback(async (estimateId: string) => {
    const est = messages.find((m): m is EstimateMessage => m.id === estimateId && m.kind === 'estimate');
    if (!est || est.status !== 'pending' || loading) return;
    const sid = activeId;
    const setMessages = setMessagesFor(sid);
    const setLoading = setLoadingFor(sid);
    const patchEstimate = (patch: Partial<EstimateMessage>) =>
      setMessages((prev) => prev.map((m) => (m.id === estimateId && m.kind === 'estimate' ? { ...m, ...patch } : m)));
    const batchId = `batch-${est.actionId}`;
    const patchBatch = (fn: (b: BatchMessage) => BatchMessage) =>
      setMessages((prev) => prev.map((m) => (m.id === batchId && m.kind === 'batch' ? fn(m) : m)));

    patchEstimate({ status: 'running' });
    setLoading(true);
    try {
      const res = await fetch(`${getApiBaseUrl()}/api/ai/chat/actions/${encodeURIComponent(est.actionId)}/run`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${localStorage.getItem('auth_token')}` },
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error((data as any)?.error || 'Could not start this action');
      }
      const finished = await readEventStream(res, (ev) => {
        if (ev.type === 'batch_start') {
          const total = Number(ev.total) || 0;
          setMessages((prev) => [...prev, {
            kind: 'batch', id: batchId, total, creditsUsed: 0, status: 'running',
            items: Array.from({ length: total }, (_, index) => ({ index, topic: '', status: 'queued' as const })),
          } satisfies BatchMessage]);
        } else if (ev.type === 'batch_item') {
          patchBatch((b) => ({
            ...b,
            creditsUsed: b.creditsUsed + (ev.status === 'done' ? Number(ev.credits_used) || 0 : 0),
            items: b.items.map((it) => (it.index === ev.index ? { ...it, topic: ev.topic || it.topic, status: ev.status, post: ev.post ?? it.post, error: ev.error } : it)),
          }));
          // Each post is charged as it is saved: the header balance follows along.
          if (ev.status === 'done') notifyCreditsChanged();
        } else if (ev.type === 'batch_done') {
          patchBatch((b) => ({ ...b, status: 'done', stopped: ev.stopped }));
        } else if (ev.type === 'tool_start') {
          setMessages((prev) => [...prev, { kind: 'tool', id: `tool-${ev.name}-${Date.now()}`, name: ev.name, label: ev.label, status: 'running' } satisfies ToolMessage]);
        } else if (ev.type === 'tool_done') {
          setMessages((prev) => prev.map((m) => (m.kind === 'tool' && m.name === ev.name && m.status === 'running'
            ? { ...m, status: ev.success ? 'done' : 'error', result: ev.result, error: ev.error } : m)));
        } else if (ev.type === 'credits_changed') {
          notifyCreditsChanged();
        }
      });
      if (!finished) throw new Error('The connection dropped — check Posts for what was already made.');
      patchEstimate({ status: 'done' });
    } catch (err: any) {
      patchEstimate({ status: 'failed', error: err?.message || 'Failed' });
      patchBatch((b) => ({ ...b, status: 'done' }));
    } finally {
      setLoading(false);
      notifyCreditsChanged();
    }
  }, [messages, loading, activeId, setMessagesFor, setLoadingFor]);

  const cancelAction = useCallback((estimateId: string) => {
    const est = messages.find((m): m is EstimateMessage => m.id === estimateId && m.kind === 'estimate');
    if (!est || est.status !== 'pending') return;
    setMessages((prev) => prev.map((m) => (m.id === estimateId && m.kind === 'estimate' ? { ...m, status: 'cancelled' } : m)));
    void fetch(`${getApiBaseUrl()}/api/ai/chat/actions/${encodeURIComponent(est.actionId)}/cancel`, {
      method: 'POST', headers: { Authorization: `Bearer ${localStorage.getItem('auth_token')}` },
    }).catch(() => undefined);
  }, [messages, setMessages]);

  // ── Sessions: history list, open, new, delete, autosave ──────────────────

  const authHeaders = () => ({ 'Content-Type': 'application/json', Authorization: `Bearer ${localStorage.getItem('auth_token')}` });

  const openSession = useCallback(async (sid: string) => {
    setActiveId(sid);
    setShowHistory(false);
    if (store[sid] || loadedRef.current[sid]) return;
    loadedRef.current[sid] = true;
    try {
      const r = await fetch(`${getApiBaseUrl()}/api/ai/chat/sessions/${encodeURIComponent(sid)}`, { headers: authHeaders() });
      if (!r.ok) return;
      const data = await r.json();
      const msgs: Message[] = Array.isArray(data?.session?.messages) ? data.session.messages : [];
      savedRef.current[sid] = JSON.stringify(msgs);
      setStore((st) => (st[sid] ? st : { ...st, [sid]: msgs }));
    } catch { loadedRef.current[sid] = false; }
  }, [store]);

  const newChat = useCallback(() => {
    setActiveId(crypto.randomUUID());
    setShowHistory(false);
    setInput('');
    setAttachedImages([]);
  }, []);

  const deleteSession = useCallback((sid: string) => {
    setSessionList((list) => list.filter((x) => x.id !== sid));
    setStore((st) => { const next = { ...st }; delete next[sid]; return next; });
    if (sid === activeId) setActiveId(crypto.randomUUID());
    void fetch(`${getApiBaseUrl()}/api/ai/chat/sessions/${encodeURIComponent(sid)}`, { method: 'DELETE', headers: authHeaders() }).catch(() => undefined);
  }, [activeId]);

  useEffect(() => { try { localStorage.setItem('daky_chat_active', activeId); } catch { /* private mode */ } }, [activeId]);

  // The history list loads once the chat is first opened; the last open chat is reopened.
  const listLoaded = useRef(false);
  useEffect(() => {
    if (!open || listLoaded.current) return;
    listLoaded.current = true;
    void openSession(activeId);
    fetch(`${getApiBaseUrl()}/api/ai/chat/sessions`, { headers: authHeaders() })
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => { if (Array.isArray(d?.sessions)) setSessionList((cur) => [...cur, ...d.sessions.filter((x: SessionMeta) => !cur.some((c) => c.id === x.id))]); })
      .catch(() => undefined);
  }, [open, activeId, openSession]);

  // Autosave: a session is saved shortly after it changes, once it is not mid-reply.
  useEffect(() => {
    const t = setTimeout(() => {
      for (const [sid, msgs] of Object.entries(store)) {
        if (runningIds[sid] || !msgs.length) continue;
        const json = JSON.stringify(msgs);
        if (savedRef.current[sid] === json) continue;
        savedRef.current[sid] = json;
        void fetch(`${getApiBaseUrl()}/api/ai/chat/sessions/${encodeURIComponent(sid)}`, {
          method: 'PUT', headers: authHeaders(), body: JSON.stringify({ title: sessionTitle(msgs), messages: msgs }),
        }).catch(() => { delete savedRef.current[sid]; });
      }
    }, 800);
    return () => clearTimeout(t);
  }, [store, runningIds]);

  // ── Form submit ───────────────────────────────────────────────────────────

  const submitForm = (formId: string, formatted: string) => {
    const isSchedule = /schedule it/i.test(formatted);
    if (isSchedule) {
      setMessages((prev) => {
        const lastDraft = [...prev].reverse().find(
          (m): m is ToolMessage => m.kind === 'tool' && m.name === 'create_draft' && m.status === 'done',
        );
        return [
          ...prev.map((m) => m.id === formId && m.kind === 'form' ? { ...m, submitted: true } : m),
          {
            kind: 'scheduler',
            id: `sched-${Date.now()}`,
            postTitle: lastDraft?.result?.post?.title,
            submitted: false,
          } satisfies SchedulerMessage,
        ];
      });
      return;
    }
    setMessages((prev) =>
      prev.map((m) => m.id === formId && m.kind === 'form' ? { ...m, submitted: true } : m),
    );
    void send(formatted);
  };

  // ── Audio recording ───────────────────────────────────────────────────────

  const startRecording = () => {
    const SR = (window as any).SpeechRecognition ?? (window as any).webkitSpeechRecognition;
    if (!SR) { alert('Speech recognition is not supported in this browser.'); return; }
    const recognition = new SR();
    recognition.continuous = true;
    recognition.interimResults = true;
    recognition.lang = 'en-US';
    let finalT = '';
    recognition.onresult = (event: any) => {
      let interim = '';
      for (let i = event.resultIndex; i < event.results.length; i++) {
        const t = event.results[i][0].transcript;
        if (event.results[i].isFinal) finalT += t; else interim += t;
      }
      setInput((finalT + interim).trim());
    };
    recognition.onend = () => stopRecording();
    recognition.onerror = () => stopRecording();
    recognitionRef.current = recognition;
    recognition.start();
    setRecordingState('recording');
    setRecordingSeconds(0);
    timerRef.current = setInterval(() => setRecordingSeconds((s) => s + 1), 1000);
  };

  const stopRecording = () => {
    recognitionRef.current?.stop();
    recognitionRef.current = null;
    if (timerRef.current) { clearInterval(timerRef.current); timerRef.current = null; }
    setRecordingSeconds(0);
    setRecordingState('pending');
  };

  const cancelVoice = () => { setInput(''); setRecordingState('idle'); };
  const sendVoice = () => {
    const t = input.trim();
    const imgs = [...attachedImages];
    if (t || imgs.length) void send(t || undefined, imgs);
    else setRecordingState('idle');
  };

  const fmtTime = (s: number) =>
    `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;

  // ── File attach ───────────────────────────────────────────────────────────

  const onFileAttach = (e: React.ChangeEvent<HTMLInputElement>) => {
    for (const file of Array.from(e.target.files ?? [])) {
      if (file.type.startsWith('image/')) {
        const reader = new FileReader();
        reader.onload = (ev) => setAttachedImages((p) => [...p, { id: crypto.randomUUID(), name: file.name, dataUrl: ev.target?.result as string }]);
        reader.readAsDataURL(file);
      } else {
        setInput((p) => p ? `${p} [File: ${file.name}]` : `[File: ${file.name}]`);
      }
    }
    e.target.value = '';
  };

  const hasMessages = messages.length > 0;

  return (
    <>
      {/* Floating button */}
      <button
        type="button"
        data-tour-id="chat-widget-button"
        onClick={() => setOpen((v) => !v)}
        className="fixed bottom-6 right-6 z-50 flex items-center justify-center rounded-[14px] bg-navy text-white shadow-menu transition-all hover:bg-blue focus:outline-none"
        style={{ width: 48, height: 48 }}
        aria-label="Open Daky AI assistant"
      >
        <Sparkles size={20} className="text-white" />
        {!open && Object.values(runningIds).some(Boolean) && (
          <span className="absolute -right-1 -top-1 flex h-4 w-4 items-center justify-center rounded-full bg-white shadow" aria-label="Daky is working">
            <Loader2 size={11} className="animate-spin text-indigo-600" />
          </span>
        )}
      </button>

      {/* Chat panel */}
      {open && (
        <div
          className="fixed bottom-[4.5rem] right-5 z-50 flex flex-col overflow-hidden rounded-[16px] border border-line bg-white shadow-menu"
          style={{ width: 340, height: 500, maxWidth: 'calc(100vw - 1.25rem)' }}
        >
          {/* Header */}
          <div className="flex shrink-0 items-center gap-2 border-b border-line px-3.5 py-2.5">
            <SparkleAvatar size={26} />
            <div className="flex-1 min-w-0">
              <div className="text-xs font-medium text-ink leading-none">Daky</div>
              <div className="flex items-center gap-1 text-[10px] font-mono text-muted mt-0.5">
                <span className="h-1.5 w-1.5 rounded-full bg-positive" /> ACTIVE
              </div>
            </div>
            <button type="button" onClick={() => setShowHistory((v) => !v)} title="Chat history"
              className={`relative flex h-6 w-6 items-center justify-center rounded-md hover:bg-soft hover:text-ink ${showHistory ? 'bg-soft text-ink' : 'text-faint'}`} aria-label="Chat history">
              <History size={13} />
              {Object.entries(runningIds).some(([id, on]) => on && id !== activeId) && (
                <span className="absolute right-0.5 top-0.5 h-1.5 w-1.5 animate-pulse rounded-full bg-indigo-500" />
              )}
            </button>
            <button type="button" onClick={newChat} title="New chat" className="flex h-6 w-6 items-center justify-center rounded-md text-faint hover:bg-soft hover:text-ink" aria-label="New chat">
              <Plus size={13} />
            </button>
            <button type="button" onClick={() => setOpen(false)} className="flex h-6 w-6 items-center justify-center rounded-md text-faint hover:bg-soft hover:text-ink" aria-label="Close">
              <X size={13} />
            </button>
          </div>

          {/* Body */}
          <div className="flex-1 overflow-y-auto">
            {showHistory ? (
              <div className="px-2 py-2">
                <button type="button" onClick={newChat}
                  className="mb-2 flex w-full items-center gap-2 rounded-[10px] border border-dashed border-line px-3 py-2 text-xs font-medium text-ink hover:border-blue hover:bg-pale/50">
                  <Plus size={13} /> New chat
                </button>
                {(() => {
                  const list = [...sessionList];
                  if (store[activeId]?.length && !list.some((x) => x.id === activeId)) list.unshift({ id: activeId, title: sessionTitle(store[activeId]), updated_at: new Date().toISOString() });
                  if (!list.length) return <p className="px-2 py-6 text-center text-xs text-muted">No chats yet.</p>;
                  return (
                    <ul className="space-y-0.5">
                      {list.map((x) => {
                        const running = Boolean(runningIds[x.id]);
                        return (
                          <li key={x.id} className={`group flex items-center gap-2 rounded-lg px-2 py-1.5 ${x.id === activeId ? 'bg-pale' : 'hover:bg-soft'}`}>
                            <button type="button" onClick={() => void openSession(x.id)} className="flex min-w-0 flex-1 items-center gap-2 text-left">
                              {running
                                ? <Loader2 size={12} className="shrink-0 animate-spin text-indigo-500" aria-label="Working" />
                                : <span className="h-3 w-3 shrink-0" />}
                              <span className="min-w-0 flex-1 truncate text-xs text-ink">{x.title}</span>
                              <span className="shrink-0 text-[10px] text-faint">{running ? 'working' : relativeTime(x.updated_at)}</span>
                            </button>
                            {!running && (
                              <button type="button" onClick={() => deleteSession(x.id)} aria-label="Delete chat"
                                className="hidden h-5 w-5 shrink-0 items-center justify-center rounded text-faint hover:text-red-500 group-hover:flex">
                                <Trash2 size={11} />
                              </button>
                            )}
                          </li>
                        );
                      })}
                    </ul>
                  );
                })()}
              </div>
            ) : !hasMessages ? (
              <div className="flex flex-col items-center px-4 pt-5 pb-3">
                <div className="flex h-10 w-10 items-center justify-center rounded-[12px] bg-pale mb-3">
                  <Sparkles size={18} className="text-blue" />
                </div>
                <h2 className="text-base font-medium text-ink mb-1">How can I help?</h2>
                <p className="text-center text-xs text-muted leading-relaxed mb-4">I'm Daky, your AI companion for writing, content, and brainstorming.</p>
                <div className="w-full space-y-1.5">
                  {SUGGESTIONS.map((s) => (
                    <button key={s.title} type="button"
                      onClick={() => { setInput(s.prompt); inputRef.current?.focus(); }}
                      className="flex w-full items-center gap-2.5 rounded-[10px] border border-line bg-soft px-3 py-2 text-left hover:border-blue hover:bg-pale/50 transition-colors">
                      <span className="text-base shrink-0">{s.icon}</span>
                      <div className="min-w-0">
                        <p className="text-[11.5px] font-medium text-ink">{s.title}</p>
                        <p className="text-[10.5px] text-muted">{s.subtitle}</p>
                      </div>
                    </button>
                  ))}
                </div>
              </div>
            ) : (
              <div className="px-3 py-2.5 space-y-2">
                {messages.map((msg) => (
                  <div key={msg.id}>
                    {msg.kind === 'activity' ? (
                      <div className="pl-8"><ActivityCard msg={msg} /></div>
                    ) : msg.kind === 'estimate' ? (
                      <div className="pl-8">
                        <EstimateCard msg={msg} busy={loading} onProceed={() => void runAction(msg.id)} onCancel={() => cancelAction(msg.id)} />
                      </div>
                    ) : msg.kind === 'batch' ? (
                      <div className="pl-8"><BatchCard msg={msg} /></div>
                    ) : msg.kind === 'tool' ? (
                      <div className="pl-8"><ToolCard msg={msg} /></div>
                    ) : msg.kind === 'form' ? (
                      <div className="pl-8">
                        <FormCard msg={msg} onSubmit={(f) => submitForm(msg.id, f)} />
                      </div>
                    ) : msg.kind === 'scheduler' ? (
                      <div className="pl-8">
                        <SchedulerCard
                          msg={msg}
                          onSchedule={(iso, label) => {
                            setMessages((prev) =>
                              prev.map((m) => m.id === msg.id ? { ...m, submitted: true } : m),
                            );
                            void send(`Schedule for ${iso} (${label})`);
                          }}
                        />
                      </div>
                    ) : msg.kind === 'plan' ? (
                      <div className="pl-8">
                        <PlanCard
                          msg={msg}
                          onExecute={(planId, agents) => void executePlan(planId, agents)}
                          onCancel={cancelPlan}
                        />
                      </div>
                    ) : msg.role === 'assistant' && msg.failed ? (
                      <div className="flex justify-start gap-1.5">
                        <SparkleAvatar size={22} />
                        <div className="max-w-[80%] space-y-2 rounded-2xl rounded-bl-sm border border-red-100 bg-red-50 px-3 py-2 text-xs leading-relaxed text-red-700">
                          <p>{msg.content}</p>
                          <button type="button" disabled={loading} onClick={() => retry(msg.id)}
                            className="inline-flex items-center gap-1.5 rounded-lg bg-white px-2.5 py-1 text-[11px] font-semibold text-red-700 shadow-sm ring-1 ring-red-200 hover:bg-red-100 disabled:opacity-50">
                            <RotateCcw size={11} /> Retry
                          </button>
                        </div>
                      </div>
                    ) : msg.role === 'assistant' && !msg.content && messages.some((m) => m.kind === 'activity' && m.id === `activity-${msg.id}`) ? null : (
                      <div className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'} gap-1.5`}>
                        {msg.role === 'assistant' && <SparkleAvatar size={22} />}
                        <div className={`max-w-[80%] rounded-2xl px-3 py-2 text-xs leading-relaxed ${
                          msg.role === 'user' ? 'rounded-br-sm bg-indigo-600 text-white' : 'rounded-bl-sm bg-slate-100 text-slate-800'
                        }`}>
                          {msg.role === 'user' && msg.images && msg.images.length > 0 && (
                            <div className="flex flex-wrap gap-1 mb-1.5">
                              {msg.images.map((img) => (
                                <div key={img.id} className="group/thumb relative">
                                  <img src={img.dataUrl} alt={img.name} className="h-12 w-12 rounded-lg object-cover border border-white/30" />
                                  <div className="pointer-events-none absolute bottom-full right-0 z-20 mb-1.5 hidden group-hover/thumb:block">
                                    <img src={img.dataUrl} alt={img.name} className="max-h-40 max-w-48 rounded-xl border border-slate-200 shadow-2xl object-contain bg-white p-1" />
                                  </div>
                                </div>
                              ))}
                            </div>
                          )}
                          {msg.content
                            ? renderText(msg.content)
                            : <span className="inline-block h-3 w-7 animate-pulse rounded bg-slate-300" />}
                        </div>
                      </div>
                    )}
                  </div>
                ))}

                {loading && messages.length > 0 &&
                  !messages.some((m) => m.kind === 'activity' && m.status === 'working') &&
                  messages[messages.length - 1]?.kind === 'text' &&
                  (messages[messages.length - 1] as TextMessage).content === '' && (
                    <div className="flex items-start gap-1.5">
                      <SparkleAvatar size={22} />
                      <div className="rounded-2xl rounded-bl-sm bg-slate-100 px-3 py-2">
                        <span className="flex gap-1 items-center">
                          {[0, 1, 2].map((i) => (<span key={i} className="h-1.5 w-1.5 rounded-full bg-slate-400 animate-bounce" style={{ animationDelay: `${i * 0.15}s` }} />))}
                        </span>
                      </div>
                    </div>
                  )}
                <div ref={bottomRef} />
              </div>
            )}
          </div>

          {/* Input bar */}
          <div className="shrink-0 border-t border-slate-100 px-2.5 py-2">
            {recordingState === 'recording' ? (
              <div className="flex items-center gap-2 rounded-xl border border-indigo-200 bg-indigo-50 px-2.5 py-2">
                <WaveformBars />
                <span className="flex-1 text-[11px] font-semibold text-indigo-600 tabular-nums">{fmtTime(recordingSeconds)}</span>
                <button type="button" onClick={stopRecording}
                  className="flex h-6 w-6 items-center justify-center rounded-full bg-indigo-600 text-white" aria-label="Stop recording">
                  <MicOff size={11} />
                </button>
              </div>
            ) : recordingState === 'pending' ? (
              <div className="space-y-1.5">
                {attachedImages.length > 0 && (
                  <div className="flex flex-wrap gap-1">
                    {attachedImages.map((img) => (
                      <div key={img.id} className="group/att relative">
                        <img src={img.dataUrl} alt={img.name} className="h-8 w-8 rounded-lg object-cover border border-indigo-200" />
                        <button type="button" onClick={() => setAttachedImages((p) => p.filter((x) => x.id !== img.id))}
                          className="absolute -top-1 -right-1 flex h-3.5 w-3.5 items-center justify-center rounded-full bg-slate-800 text-white text-[8px] opacity-0 group-hover/att:opacity-100 transition-opacity">×</button>
                      </div>
                    ))}
                  </div>
                )}
                <div className="flex items-center gap-1.5 rounded-lg border border-indigo-200 bg-indigo-50 px-2.5 py-1.5">
                  <Mic size={11} className="text-indigo-500 shrink-0" />
                  <p className="flex-1 text-[11px] text-indigo-800 leading-snug line-clamp-2">{input || '(no transcript)'}</p>
                </div>
                <div className="flex gap-1.5">
                  <button type="button" onClick={cancelVoice}
                    className="flex-1 rounded-lg border border-slate-200 py-1.5 text-[11px] font-semibold text-slate-600 hover:bg-slate-50">
                    Cancel
                  </button>
                  <button type="button" onClick={sendVoice} disabled={!input.trim() && attachedImages.length === 0}
                    className="flex-1 flex items-center justify-center gap-1 rounded-lg bg-indigo-600 py-1.5 text-[11px] font-semibold text-white hover:bg-indigo-700 disabled:opacity-40">
                    <Send size={10} /> Send
                  </button>
                </div>
              </div>
            ) : (
              <div className="space-y-1.5">
                {attachedImages.length > 0 && (
                  <div className="flex flex-wrap gap-1">
                    {attachedImages.map((img) => (
                      <div key={img.id} className="group/chip relative">
                        <div className="overflow-hidden rounded-lg border border-slate-200 bg-slate-50">
                          <img src={img.dataUrl} alt={img.name} className="h-8 w-8 object-cover" />
                          <button type="button"
                            onClick={() => setAttachedImages((p) => p.filter((x) => x.id !== img.id))}
                            className="absolute -top-1 -right-1 flex h-3.5 w-3.5 items-center justify-center rounded-full bg-slate-900 text-white text-[8px] opacity-0 group-hover/chip:opacity-100 transition-opacity">×</button>
                        </div>
                        <div className="pointer-events-none absolute bottom-full left-1/2 z-10 mb-2 hidden -translate-x-1/2 group-hover/chip:block">
                          <img src={img.dataUrl} alt={img.name} className="max-h-36 max-w-48 rounded-xl border border-slate-200 shadow-xl object-contain bg-white p-1" />
                        </div>
                      </div>
                    ))}
                  </div>
                )}
                <div className="flex items-end gap-1">
                  <button type="button" onClick={() => fileInputRef.current?.click()}
                    className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg text-slate-400 hover:bg-slate-100 hover:text-slate-600" aria-label="Attach file">
                    <Paperclip size={13} />
                  </button>
                  <input ref={fileInputRef} type="file" className="hidden" multiple accept="image/*,*" onChange={onFileAttach} />
                  <textarea ref={inputRef} rows={1} value={input}
                    onChange={(e) => setInput(e.target.value)} onKeyDown={onKeyDown}
                    disabled={loading} placeholder="Ask Daky anything..."
                    className="flex-1 resize-none rounded-xl border border-slate-200 bg-slate-50 px-2.5 py-1.5 text-xs text-slate-900 placeholder-slate-400 outline-none focus:border-indigo-300 focus:ring-1 focus:ring-indigo-300 disabled:opacity-50"
                    style={{ maxHeight: 72, overflowY: 'auto' }} />
                  <button type="button" onClick={startRecording}
                    className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg text-slate-400 hover:bg-slate-100 hover:text-indigo-500" aria-label="Voice input">
                    <Mic size={13} />
                  </button>
                  <button type="button" onClick={() => void send()} disabled={(!input.trim() && attachedImages.length === 0) || loading}
                    className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-indigo-600 text-white shadow-sm hover:bg-indigo-700 disabled:opacity-40"
                    aria-label="Send message">
                    <Send size={12} />
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </>
  );
}
