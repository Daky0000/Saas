import { useCallback, useEffect, useRef, useState } from 'react';
import {
  Clock,
  GitBranch,
  GitMerge,
  Loader2,
  Mail,
  MessageSquare,
  MoreHorizontal,
  Percent,
  Play,
  Plus,
  Settings,
  Shuffle,
  Tag,
  Trash2,
  UserMinus,
  UserX,
  Users,
  Webhook,
  X,
  Zap,
} from 'lucide-react';
import { API_BASE_URL } from '../utils/apiBase';

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────

type FlowStatus = 'draft' | 'active' | 'paused';

type AutomationFlow = {
  id: string;
  name: string;
  description: string;
  status: FlowStatus;
  steps: FlowStep[];
  created_at: string;
  updated_at: string;
  contact_count?: number;
};

type StepType =
  | 'trigger'
  | 'delay'
  | 'wait_trigger'
  | 'if_else'
  | 'split'
  | 'send_email'
  | 'send_sms'
  | 'send_survey'
  | 'tag'
  | 'untag'
  | 'group'
  | 'ungroup'
  | 'update_contact'
  | 'unsubscribe'
  | 'archive'
  | 'webhook';

type FlowStep = {
  id: string;
  type: StepType;
  config: Record<string, unknown>;
  yes_steps?: FlowStep[];
  no_steps?: FlowStep[];
  a_steps?: FlowStep[];
  b_steps?: FlowStep[];
};

// ─────────────────────────────────────────────────────────────────────────────
// Config
// ─────────────────────────────────────────────────────────────────────────────

const TRIGGER_OPTIONS = [
  { value: 'tag_added', label: 'Tag is added' },
  { value: 'tag_removed', label: 'Tag is removed' },
  { value: 'email_signup', label: 'Signs up for email' },
  { value: 'sms_signup', label: 'Signs up for SMS' },
  { value: 'group_change', label: 'Group is changed' },
  { value: 'page_view', label: 'Views a page' },
  { value: 'link_click', label: 'Clicks a link' },
  { value: 'manual', label: 'Manual entry' },
  { value: 'birthday', label: 'Birthday' },
  { value: 'specific_date', label: 'Specific date' },
  { value: 'purchase', label: 'Makes a purchase' },
  { value: 'cart_abandonment', label: 'Abandons cart' },
  { value: 'email_opened', label: 'Opens an email' },
  { value: 'email_unopened', label: 'Doesn\'t open email (30 days)' },
  { value: 'survey_response', label: 'Responds to survey' },
  { value: 'api', label: 'API / Webhook trigger' },
];

type NodeMeta = {
  label: string;
  color: string;
  bg: string;
  icon: React.ReactNode;
  category: 'trigger' | 'rule' | 'action';
};

const NODE_META: Record<StepType, NodeMeta> = {
  trigger:        { label: 'Starting Point',   color: '#6366f1', bg: '#eef2ff', icon: <Zap size={14} />,            category: 'trigger' },
  delay:          { label: 'Time Delay',        color: '#f59e0b', bg: '#fffbeb', icon: <Clock size={14} />,          category: 'rule'    },
  wait_trigger:   { label: 'Wait for Trigger',  color: '#8b5cf6', bg: '#f5f3ff', icon: <Play size={14} />,           category: 'rule'    },
  if_else:        { label: 'If / Else',          color: '#06b6d4', bg: '#ecfeff', icon: <GitBranch size={14} />,     category: 'rule'    },
  split:          { label: 'Percentage Split',   color: '#10b981', bg: '#ecfdf5', icon: <Percent size={14} />,       category: 'rule'    },
  send_email:     { label: 'Send Email',         color: '#6366f1', bg: '#eef2ff', icon: <Mail size={14} />,          category: 'action'  },
  send_sms:       { label: 'Send SMS',           color: '#f59e0b', bg: '#fffbeb', icon: <MessageSquare size={14} />, category: 'action'  },
  send_survey:    { label: 'Send Survey',        color: '#8b5cf6', bg: '#f5f3ff', icon: <Settings size={14} />,      category: 'action'  },
  tag:            { label: 'Add Tag',            color: '#10b981', bg: '#ecfdf5', icon: <Tag size={14} />,           category: 'action'  },
  untag:          { label: 'Remove Tag',         color: '#ef4444', bg: '#fef2f2', icon: <Tag size={14} />,           category: 'action'  },
  group:          { label: 'Add to Group',       color: '#06b6d4', bg: '#ecfeff', icon: <Users size={14} />,         category: 'action'  },
  ungroup:        { label: 'Remove from Group',  color: '#f97316', bg: '#fff7ed', icon: <Users size={14} />,         category: 'action'  },
  update_contact: { label: 'Update Contact',     color: '#6366f1', bg: '#eef2ff', icon: <Settings size={14} />,      category: 'action'  },
  unsubscribe:    { label: 'Unsubscribe',        color: '#ef4444', bg: '#fef2f2', icon: <UserMinus size={14} />,     category: 'action'  },
  archive:        { label: 'Archive Contact',    color: '#6b7280', bg: '#f9fafb', icon: <UserX size={14} />,         category: 'action'  },
  webhook:        { label: 'Webhook',            color: '#f97316', bg: '#fff7ed', icon: <Webhook size={14} />,       category: 'action'  },
};

const RULE_TYPES: StepType[] = ['delay', 'wait_trigger', 'if_else', 'split'];
const ACTION_TYPES: StepType[] = [
  'send_email', 'send_sms', 'send_survey',
  'tag', 'untag', 'group', 'ungroup',
  'update_contact', 'unsubscribe', 'archive', 'webhook',
];

// ─────────────────────────────────────────────────────────────────────────────
// API helpers
// ─────────────────────────────────────────────────────────────────────────────

const authHeader = () => ({ Authorization: `Bearer ${localStorage.getItem('auth_token') ?? ''}` });

async function apiGet<T>(path: string): Promise<T> {
  const r = await fetch(`${API_BASE_URL}${path}`, { headers: authHeader() });
  const j = await r.json();
  if (!j.success) throw new Error(j.error ?? 'Request failed');
  return j.data as T;
}

async function apiPost<T>(path: string, body: unknown): Promise<T> {
  const r = await fetch(`${API_BASE_URL}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...authHeader() },
    body: JSON.stringify(body),
  });
  const j = await r.json();
  if (!j.success) throw new Error(j.error ?? 'Request failed');
  return j.data as T;
}

async function apiPut<T>(path: string, body: unknown): Promise<T> {
  const r = await fetch(`${API_BASE_URL}${path}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json', ...authHeader() },
    body: JSON.stringify(body),
  });
  const j = await r.json();
  if (!j.success) throw new Error(j.error ?? 'Request failed');
  return j.data as T;
}

async function apiDelete(path: string): Promise<void> {
  const r = await fetch(`${API_BASE_URL}${path}`, { method: 'DELETE', headers: authHeader() });
  const j = await r.json();
  if (!j.success) throw new Error(j.error ?? 'Request failed');
}

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

function uid() { return Math.random().toString(36).slice(2, 10); }

function defaultStep(type: StepType): FlowStep {
  const base: FlowStep = { id: uid(), type, config: {} };
  if (type === 'delay') base.config = { unit: 'days', amount: 1 };
  if (type === 'if_else') { base.yes_steps = []; base.no_steps = []; }
  if (type === 'split') { base.config = { percent_a: 50 }; base.a_steps = []; base.b_steps = []; }
  return base;
}

function labelForStep(step: FlowStep): string {
  const meta = NODE_META[step.type];
  const c = step.config;
  if (step.type === 'trigger') return TRIGGER_OPTIONS.find(t => t.value === c.trigger)?.label ?? 'Choose starting point';
  if (step.type === 'delay') return `Wait ${c.amount ?? 1} ${c.unit ?? 'days'}`;
  if (step.type === 'send_email') return c.subject ? `Send: "${c.subject}"` : 'Configure email';
  if (step.type === 'send_sms') return c.message ? `SMS: ${String(c.message).slice(0, 30)}…` : 'Configure SMS';
  if (step.type === 'tag' || step.type === 'untag') return c.tag ? `${meta.label}: "${c.tag}"` : `${meta.label} — choose tag`;
  if (step.type === 'group' || step.type === 'ungroup') return c.group ? `${meta.label}: "${c.group}"` : `${meta.label} — choose group`;
  if (step.type === 'split') return `Split ${c.percent_a ?? 50}% / ${100 - Number(c.percent_a ?? 50)}%`;
  if (step.type === 'if_else') return c.condition ? `If ${c.condition}` : 'Configure condition';
  if (step.type === 'wait_trigger') return c.trigger ? `Wait until: ${c.trigger}` : 'Wait for trigger';
  if (step.type === 'webhook') return c.url ? `POST → ${String(c.url).slice(0, 28)}…` : 'Configure webhook';
  if (step.type === 'update_contact') return c.field ? `Update: ${c.field}` : 'Configure field update';
  return meta.label;
}

function statusColor(s: FlowStatus) {
  if (s === 'active') return { bg: '#dcfce7', text: '#16a34a' };
  if (s === 'paused') return { bg: '#fef9c3', text: '#ca8a04' };
  return { bg: '#f3f4f6', text: '#6b7280' };
}

// ─────────────────────────────────────────────────────────────────────────────
// Step config panel
// ─────────────────────────────────────────────────────────────────────────────

function StepConfigPanel({
  step,
  onChange,
  onClose,
}: {
  step: FlowStep;
  onChange: (updated: FlowStep) => void;
  onClose: () => void;
}) {
  const meta = NODE_META[step.type];
  const set = (key: string, val: unknown) => onChange({ ...step, config: { ...step.config, [key]: val } });

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="flex items-center gap-2 px-4 py-3 border-b border-slate-100">
        <div className="flex h-7 w-7 items-center justify-center rounded-lg" style={{ background: meta.bg, color: meta.color }}>
          {meta.icon}
        </div>
        <span className="flex-1 text-sm font-semibold text-slate-900">{meta.label}</span>
        <button type="button" onClick={onClose} className="flex h-6 w-6 items-center justify-center rounded-md text-slate-400 hover:bg-slate-100">
          <X size={13} />
        </button>
      </div>

      {/* Body */}
      <div className="flex-1 overflow-y-auto p-4 space-y-4">
        {step.type === 'trigger' && (
          <Field label="Starting point">
            <select value={String(step.config.trigger ?? '')} onChange={e => set('trigger', e.target.value)} className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm text-slate-900 focus:border-indigo-400 focus:outline-none">
              <option value="">Choose a trigger…</option>
              {TRIGGER_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
            </select>
          </Field>
        )}

        {step.type === 'delay' && (
          <>
            <Field label="Wait for">
              <div className="flex gap-2">
                <input type="number" min={1} value={Number(step.config.amount ?? 1)} onChange={e => set('amount', parseInt(e.target.value, 10) || 1)} className="w-20 rounded-lg border border-slate-200 px-3 py-2 text-sm focus:border-indigo-400 focus:outline-none" />
                <select value={String(step.config.unit ?? 'days')} onChange={e => set('unit', e.target.value)} className="flex-1 rounded-lg border border-slate-200 px-3 py-2 text-sm focus:border-indigo-400 focus:outline-none">
                  <option value="minutes">Minutes</option>
                  <option value="hours">Hours</option>
                  <option value="days">Days</option>
                  <option value="weeks">Weeks</option>
                </select>
              </div>
            </Field>
          </>
        )}

        {step.type === 'wait_trigger' && (
          <Field label="Wait until">
            <select value={String(step.config.trigger ?? '')} onChange={e => set('trigger', e.target.value)} className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm focus:border-indigo-400 focus:outline-none">
              <option value="">Choose condition…</option>
              {TRIGGER_OPTIONS.filter(t => !['api', 'manual', 'birthday', 'specific_date'].includes(t.value)).map(o => (
                <option key={o.value} value={o.value}>{o.label}</option>
              ))}
            </select>
          </Field>
        )}

        {step.type === 'if_else' && (
          <>
            <Field label="Condition type">
              <select value={String(step.config.condition_type ?? 'tag')} onChange={e => set('condition_type', e.target.value)} className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm focus:border-indigo-400 focus:outline-none">
                <option value="tag">Has tag</option>
                <option value="email_opened">Opened last email</option>
                <option value="link_clicked">Clicked a link</option>
                <option value="purchase">Made a purchase</option>
                <option value="field">Contact field value</option>
                <option value="group">In a group</option>
              </select>
            </Field>
            <Field label="Value">
              <input type="text" value={String(step.config.condition ?? '')} onChange={e => set('condition', e.target.value)} placeholder="e.g. vip" className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm focus:border-indigo-400 focus:outline-none" />
            </Field>
          </>
        )}

        {step.type === 'split' && (
          <Field label={`Path A — ${step.config.percent_a ?? 50}%`}>
            <input
              type="range" min={1} max={99}
              value={Number(step.config.percent_a ?? 50)}
              onChange={e => set('percent_a', parseInt(e.target.value, 10))}
              className="w-full accent-indigo-500"
            />
            <div className="mt-1 flex justify-between text-xs text-slate-400">
              <span>Path A: {String(step.config.percent_a ?? 50)}%</span>
              <span>Path B: {100 - Number(step.config.percent_a ?? 50)}%</span>
            </div>
          </Field>
        )}

        {step.type === 'send_email' && (
          <>
            <Field label="Subject line">
              <input type="text" value={String(step.config.subject ?? '')} onChange={e => set('subject', e.target.value)} placeholder="Your subject line…" className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm focus:border-indigo-400 focus:outline-none" />
            </Field>
            <Field label="Preview text">
              <input type="text" value={String(step.config.preview ?? '')} onChange={e => set('preview', e.target.value)} placeholder="Short preview shown in inbox…" className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm focus:border-indigo-400 focus:outline-none" />
            </Field>
            <Field label="From name">
              <input type="text" value={String(step.config.from_name ?? '')} onChange={e => set('from_name', e.target.value)} placeholder="Your Name" className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm focus:border-indigo-400 focus:outline-none" />
            </Field>
            <Field label="From email">
              <input type="email" value={String(step.config.from_email ?? '')} onChange={e => set('from_email', e.target.value)} placeholder="you@example.com" className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm focus:border-indigo-400 focus:outline-none" />
            </Field>
          </>
        )}

        {step.type === 'send_sms' && (
          <Field label="Message">
            <textarea rows={4} value={String(step.config.message ?? '')} onChange={e => set('message', e.target.value)} placeholder="Type your SMS message…" className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm focus:border-indigo-400 focus:outline-none resize-none" />
            <div className="mt-1 text-right text-xs text-slate-400">{String(step.config.message ?? '').length} / 160</div>
          </Field>
        )}

        {step.type === 'send_survey' && (
          <>
            <Field label="Survey subject">
              <input type="text" value={String(step.config.subject ?? '')} onChange={e => set('subject', e.target.value)} placeholder="What do you think of us?" className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm focus:border-indigo-400 focus:outline-none" />
            </Field>
            <Field label="Survey ID">
              <input type="text" value={String(step.config.survey_id ?? '')} onChange={e => set('survey_id', e.target.value)} placeholder="Select or paste survey ID" className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm focus:border-indigo-400 focus:outline-none" />
            </Field>
          </>
        )}

        {(step.type === 'tag' || step.type === 'untag') && (
          <Field label="Tag name">
            <input type="text" value={String(step.config.tag ?? '')} onChange={e => set('tag', e.target.value)} placeholder="e.g. vip, customer, trial" className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm focus:border-indigo-400 focus:outline-none" />
          </Field>
        )}

        {(step.type === 'group' || step.type === 'ungroup') && (
          <Field label="Group name">
            <input type="text" value={String(step.config.group ?? '')} onChange={e => set('group', e.target.value)} placeholder="e.g. Premium Members" className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm focus:border-indigo-400 focus:outline-none" />
          </Field>
        )}

        {step.type === 'update_contact' && (
          <>
            <Field label="Field to update">
              <input type="text" value={String(step.config.field ?? '')} onChange={e => set('field', e.target.value)} placeholder="e.g. Phone, Birthday" className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm focus:border-indigo-400 focus:outline-none" />
            </Field>
            <Field label="New value">
              <input type="text" value={String(step.config.value ?? '')} onChange={e => set('value', e.target.value)} placeholder="New field value" className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm focus:border-indigo-400 focus:outline-none" />
            </Field>
          </>
        )}

        {step.type === 'webhook' && (
          <>
            <Field label="Endpoint URL">
              <input type="url" value={String(step.config.url ?? '')} onChange={e => set('url', e.target.value)} placeholder="https://your-app.com/webhook" className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm focus:border-indigo-400 focus:outline-none" />
            </Field>
            <p className="text-xs text-slate-400 leading-relaxed">A POST request with contact data will be sent to this URL when a contact reaches this step.</p>
          </>
        )}

        {(step.type === 'unsubscribe' || step.type === 'archive') && (
          <p className="text-sm text-slate-500 leading-relaxed">
            {step.type === 'unsubscribe'
              ? 'Contacts that reach this step will be automatically unsubscribed from the audience.'
              : 'Contacts that reach this step will be archived from the audience (data is retained).'}
          </p>
        )}
      </div>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1.5">
      <label className="text-xs font-semibold text-slate-600 uppercase tracking-wide">{label}</label>
      {children}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Add-step picker
// ─────────────────────────────────────────────────────────────────────────────

function AddStepMenu({ onSelect, onClose }: { onSelect: (type: StepType) => void; onClose: () => void }) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const h = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) onClose(); };
    document.addEventListener('mousedown', h);
    return () => document.removeEventListener('mousedown', h);
  }, [onClose]);

  const Section = ({ title, types }: { title: string; types: StepType[] }) => (
    <div>
      <div className="px-3 py-1.5 text-[10px] font-bold uppercase tracking-widest text-slate-400">{title}</div>
      {types.map(t => {
        const m = NODE_META[t];
        return (
          <button key={t} type="button" onClick={() => onSelect(t)}
            className="flex w-full items-center gap-2.5 px-3 py-2 hover:bg-slate-50 text-left transition-colors">
            <div className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md" style={{ background: m.bg, color: m.color }}>{m.icon}</div>
            <span className="text-sm text-slate-700">{m.label}</span>
          </button>
        );
      })}
    </div>
  );

  return (
    <div ref={ref} className="absolute z-50 mt-1 w-52 rounded-xl border border-slate-200 bg-white shadow-xl overflow-hidden" style={{ left: '50%', transform: 'translateX(-50%)' }}>
      <Section title="Rules" types={RULE_TYPES} />
      <div className="border-t border-slate-100" />
      <Section title="Actions" types={ACTION_TYPES} />
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Flow step node
// ─────────────────────────────────────────────────────────────────────────────

function AddButton({ onAdd }: { onAdd: (type: StepType) => void }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="relative flex flex-col items-center">
      <div className="w-px h-5 bg-slate-200" />
      <button type="button" onClick={() => setOpen(v => !v)}
        className="flex h-6 w-6 items-center justify-center rounded-full border border-dashed border-slate-300 bg-white text-slate-400 hover:border-indigo-400 hover:text-indigo-500 transition-colors">
        <Plus size={12} />
      </button>
      {open && <AddStepMenu onSelect={t => { onAdd(t); setOpen(false); }} onClose={() => setOpen(false)} />}
      <div className="w-px h-5 bg-slate-200" />
    </div>
  );
}

type StepProps = {
  step: FlowStep;
  onSelect: (step: FlowStep) => void;
  selectedId: string | null;
  onUpdate: (step: FlowStep) => void;
  onDelete: (id: string) => void;
  depth?: number;
};

function StepNode({ step, onSelect, selectedId, onUpdate, onDelete, depth = 0 }: StepProps) {
  const meta = NODE_META[step.type];
  const isSelected = step.id === selectedId;

  function renderBranch(label: string, color: string, steps: FlowStep[], setSteps: (s: FlowStep[]) => void) {
    return (
      <div className="flex-1 min-w-0">
        <div className="mb-2 flex items-center gap-1.5">
          <span className="rounded-full px-2 py-0.5 text-xs font-semibold" style={{ background: `${color}20`, color }}>{label}</span>
        </div>
        <div className="rounded-xl border border-dashed border-slate-200 bg-slate-50 px-3 py-3 min-h-[60px]">
          <StepList
            steps={steps}
            onSelect={onSelect}
            selectedId={selectedId}
            onUpdate={updated => setSteps(steps.map(s => s.id === updated.id ? updated : s))}
            onDelete={id => setSteps(steps.filter(s => s.id !== id))}
            onAddAfter={(afterId, type) => {
              const idx = steps.findIndex(s => s.id === afterId);
              const next = [...steps];
              next.splice(idx + 1, 0, defaultStep(type));
              setSteps(next);
            }}
            depth={depth + 1}
          />
          <AddButton onAdd={t => setSteps([...steps, defaultStep(t)])} />
        </div>
      </div>
    );
  }

  const isBranching = step.type === 'if_else' || step.type === 'split';

  return (
    <div className="flex flex-col items-center w-full">
      {/* Node card */}
      <div
        onClick={() => onSelect(step)}
        className={`relative w-full max-w-xs rounded-xl border px-4 py-3 cursor-pointer transition-all select-none ${isSelected ? 'ring-2 ring-indigo-500 border-indigo-300 shadow-md' : 'border-slate-200 bg-white hover:border-slate-300 hover:shadow-sm'}`}
        style={{ background: isSelected ? '#fafbff' : '#fff' }}
      >
        <div className="flex items-center gap-2.5">
          <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg" style={{ background: meta.bg, color: meta.color }}>
            {meta.icon}
          </div>
          <div className="min-w-0 flex-1">
            <div className="text-[10px] font-bold uppercase tracking-widest" style={{ color: meta.color }}>{meta.label}</div>
            <div className="mt-0.5 truncate text-xs font-medium text-slate-700">{labelForStep(step)}</div>
          </div>
          <button
            type="button"
            onClick={e => { e.stopPropagation(); onDelete(step.id); }}
            className="ml-1 flex h-5 w-5 shrink-0 items-center justify-center rounded text-slate-300 hover:bg-red-50 hover:text-red-400 transition-colors"
          >
            <Trash2 size={11} />
          </button>
        </div>
      </div>

      {/* Branch layout for if/else and split */}
      {isBranching && (
        <div className="mt-3 w-full flex gap-4">
          {step.type === 'if_else' && (
            <>
              {renderBranch('Yes', '#16a34a', step.yes_steps ?? [], s => onUpdate({ ...step, yes_steps: s }))}
              {renderBranch('No', '#ef4444', step.no_steps ?? [], s => onUpdate({ ...step, no_steps: s }))}
            </>
          )}
          {step.type === 'split' && (
            <>
              {renderBranch(`A — ${step.config.percent_a ?? 50}%`, '#6366f1', step.a_steps ?? [], s => onUpdate({ ...step, a_steps: s }))}
              {renderBranch(`B — ${100 - Number(step.config.percent_a ?? 50)}%`, '#10b981', step.b_steps ?? [], s => onUpdate({ ...step, b_steps: s }))}
            </>
          )}
        </div>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Step list (recursive)
// ─────────────────────────────────────────────────────────────────────────────

function StepList({
  steps,
  onSelect,
  selectedId,
  onUpdate,
  onDelete,
  onAddAfter,
  depth = 0,
}: {
  steps: FlowStep[];
  onSelect: (step: FlowStep) => void;
  selectedId: string | null;
  onUpdate: (step: FlowStep) => void;
  onDelete: (id: string) => void;
  onAddAfter: (afterId: string, type: StepType) => void;
  depth?: number;
}) {
  return (
    <div className="flex flex-col items-center w-full gap-0">
      {steps.map((step, i) => (
        <div key={step.id} className="flex flex-col items-center w-full">
          <StepNode
            step={step}
            onSelect={onSelect}
            selectedId={selectedId}
            onUpdate={onUpdate}
            onDelete={onDelete}
            depth={depth}
          />
          {i < steps.length - 1 && (
            <AddButton onAdd={t => onAddAfter(step.id, t)} />
          )}
          {i === steps.length - 1 && depth === 0 && <div className="w-px h-4 bg-slate-200" />}
        </div>
      ))}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Builder modal
// ─────────────────────────────────────────────────────────────────────────────

function FlowBuilder({
  flow,
  onSave,
  onClose,
}: {
  flow: AutomationFlow;
  onSave: (updated: AutomationFlow) => Promise<void>;
  onClose: () => void;
}) {
  const [name, setName] = useState(flow.name);
  const [steps, setSteps] = useState<FlowStep[]>(flow.steps.length ? flow.steps : [defaultStep('trigger')]);
  const [selectedStep, setSelectedStep] = useState<FlowStep | null>(null);
  const [saving, setSaving] = useState(false);

  const updateStep = useCallback((updated: FlowStep) => {
    function walk(list: FlowStep[]): FlowStep[] {
      return list.map(s => {
        if (s.id === updated.id) return updated;
        return {
          ...s,
          yes_steps: s.yes_steps ? walk(s.yes_steps) : undefined,
          no_steps:  s.no_steps  ? walk(s.no_steps)  : undefined,
          a_steps:   s.a_steps   ? walk(s.a_steps)   : undefined,
          b_steps:   s.b_steps   ? walk(s.b_steps)   : undefined,
        };
      });
    }
    setSteps(prev => walk(prev));
    setSelectedStep(updated);
  }, []);

  const deleteStep = useCallback((id: string) => {
    function walk(list: FlowStep[]): FlowStep[] {
      return list
        .filter(s => s.id !== id)
        .map(s => ({
          ...s,
          yes_steps: s.yes_steps ? walk(s.yes_steps) : undefined,
          no_steps:  s.no_steps  ? walk(s.no_steps)  : undefined,
          a_steps:   s.a_steps   ? walk(s.a_steps)   : undefined,
          b_steps:   s.b_steps   ? walk(s.b_steps)   : undefined,
        }));
    }
    setSteps(prev => walk(prev));
    setSelectedStep(prev => prev?.id === id ? null : prev);
  }, []);

  const addAfter = useCallback((afterId: string, type: StepType) => {
    function walk(list: FlowStep[]): FlowStep[] {
      const idx = list.findIndex(s => s.id === afterId);
      if (idx !== -1) {
        const next = [...list];
        next.splice(idx + 1, 0, defaultStep(type));
        return next;
      }
      return list.map(s => ({
        ...s,
        yes_steps: s.yes_steps ? walk(s.yes_steps) : undefined,
        no_steps:  s.no_steps  ? walk(s.no_steps)  : undefined,
        a_steps:   s.a_steps   ? walk(s.a_steps)   : undefined,
        b_steps:   s.b_steps   ? walk(s.b_steps)   : undefined,
      }));
    }
    setSteps(prev => walk(prev));
  }, []);

  async function handleSave() {
    setSaving(true);
    try {
      await onSave({ ...flow, name, steps });
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-slate-50" style={{ fontFamily: 'Inter, sans-serif' }}>
      {/* Top bar */}
      <div className="flex h-12 shrink-0 items-center gap-3 border-b border-slate-200 bg-white px-4">
        <button type="button" onClick={onClose} className="flex h-7 w-7 items-center justify-center rounded-md text-slate-400 hover:bg-slate-100">
          <X size={15} />
        </button>
        <input
          value={name}
          onChange={e => setName(e.target.value)}
          className="flex-1 bg-transparent text-sm font-semibold text-slate-900 focus:outline-none placeholder:text-slate-400"
          placeholder="Automation name…"
        />
        <button type="button" onClick={handleSave} disabled={saving}
          className="flex h-7 items-center gap-1.5 rounded-lg bg-indigo-600 px-3 text-xs font-semibold text-white hover:bg-indigo-700 disabled:opacity-60 transition-colors">
          {saving ? <Loader2 size={12} className="animate-spin" /> : null}
          {saving ? 'Saving…' : 'Save'}
        </button>
      </div>

      <div className="flex flex-1 overflow-hidden">
        {/* Canvas */}
        <div className="flex-1 overflow-auto px-6 py-8">
          <div className="mx-auto max-w-xs">
            <StepList
              steps={steps}
              onSelect={setSelectedStep}
              selectedId={selectedStep?.id ?? null}
              onUpdate={updateStep}
              onDelete={deleteStep}
              onAddAfter={addAfter}
            />
            <AddButton onAdd={t => setSteps(prev => [...prev, defaultStep(t)])} />
          </div>
        </div>

        {/* Config panel */}
        {selectedStep && (
          <div className="w-72 shrink-0 border-l border-slate-200 bg-white overflow-hidden flex flex-col">
            <StepConfigPanel
              step={selectedStep}
              onChange={updateStep}
              onClose={() => setSelectedStep(null)}
            />
          </div>
        )}
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Flow list card
// ─────────────────────────────────────────────────────────────────────────────

function FlowCard({
  flow,
  onEdit,
  onDelete,
  onToggle,
}: {
  flow: AutomationFlow;
  onEdit: () => void;
  onDelete: () => void;
  onToggle: () => void;
}) {
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  const sc = statusColor(flow.status);

  useEffect(() => {
    if (!menuOpen) return;
    const h = (e: MouseEvent) => { if (menuRef.current && !menuRef.current.contains(e.target as Node)) setMenuOpen(false); };
    document.addEventListener('mousedown', h);
    return () => document.removeEventListener('mousedown', h);
  }, [menuOpen]);

  const trigger = flow.steps[0];
  const triggerLabel = trigger ? labelForStep(trigger) : 'No trigger set';
  const stepCount = flow.steps.length;

  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-5 hover:border-slate-300 hover:shadow-sm transition-all">
      <div className="flex items-start gap-3">
        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl" style={{ background: '#eef2ff' }}>
          <Zap size={18} className="text-indigo-500" />
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <h3 className="font-semibold text-slate-900 truncate">{flow.name}</h3>
            <span className="shrink-0 rounded-full px-2 py-0.5 text-[10px] font-bold uppercase" style={{ background: sc.bg, color: sc.text }}>
              {flow.status}
            </span>
          </div>
          {flow.description && <p className="mt-0.5 text-xs text-slate-400 truncate">{flow.description}</p>}
          <div className="mt-2 flex items-center gap-4 text-xs text-slate-400">
            <span className="flex items-center gap-1"><Zap size={10} /> {triggerLabel}</span>
            <span>{stepCount} step{stepCount !== 1 ? 's' : ''}</span>
          </div>
        </div>

        {/* Actions */}
        <div className="flex items-center gap-1 shrink-0">
          <button type="button" onClick={onEdit}
            className="rounded-lg border border-slate-200 px-3 py-1.5 text-xs font-medium text-slate-600 hover:bg-slate-50 transition-colors">
            Edit
          </button>
          <div ref={menuRef} className="relative">
            <button type="button" onClick={() => setMenuOpen(v => !v)}
              className="flex h-7 w-7 items-center justify-center rounded-lg text-slate-400 hover:bg-slate-100 transition-colors">
              <MoreHorizontal size={14} />
            </button>
            {menuOpen && (
              <div className="absolute right-0 top-8 z-20 w-40 rounded-xl border border-slate-200 bg-white py-1 shadow-xl">
                <button type="button" onClick={() => { onToggle(); setMenuOpen(false); }}
                  className="flex w-full items-center gap-2 px-3 py-2 text-sm text-slate-700 hover:bg-slate-50">
                  {flow.status === 'active' ? <><GitMerge size={13} /> Pause</> : <><Play size={13} /> Activate</>}
                </button>
                <div className="my-1 border-t border-slate-100" />
                <button type="button" onClick={() => { onDelete(); setMenuOpen(false); }}
                  className="flex w-full items-center gap-2 px-3 py-2 text-sm text-red-500 hover:bg-red-50">
                  <Trash2 size={13} /> Delete
                </button>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Automation templates
// ─────────────────────────────────────────────────────────────────────────────

type AutomationTemplate = {
  id: string;
  name: string;
  description: string;
  emoji: string;
  color: string;
  bg: string;
  tags: string[];
  steps: FlowStep[];
};

function ts(type: StepType, config: Record<string, unknown> = {}, extra?: Partial<FlowStep>): FlowStep {
  return { id: uid(), type, config, ...extra };
}

const AUTOMATION_TEMPLATES: AutomationTemplate[] = [
  {
    id: 'welcome-contacts',
    name: 'Welcome new contacts',
    description: 'Send a warm welcome email as soon as someone joins your list.',
    emoji: '👋',
    color: '#6366f1',
    bg: '#eef2ff',
    tags: ['Email', 'Welcome'],
    steps: [
      ts('trigger', { trigger: 'email_signup' }),
      ts('delay', { amount: 1, unit: 'hours' }),
      ts('send_email', { subject: 'Welcome! We\'re glad you\'re here', from_name: 'Your Brand', preview: 'Here\'s what to expect from us…' }),
    ],
  },
  {
    id: 'exclusive-content-leads',
    name: 'Share exclusive content with new leads',
    description: 'Nurture new leads with a drip of valuable content over two weeks.',
    emoji: '🎁',
    color: '#8b5cf6',
    bg: '#f5f3ff',
    tags: ['Email', 'Leads', 'Nurture'],
    steps: [
      ts('trigger', { trigger: 'tag_added' }),
      ts('send_email', { subject: 'Your exclusive content is ready', preview: 'We handpicked this just for you…' }),
      ts('delay', { amount: 3, unit: 'days' }),
      ts('send_email', { subject: 'More insights just for you', preview: 'Continuing your journey with us…' }),
      ts('delay', { amount: 5, unit: 'days' }),
      ts('send_email', { subject: 'One last thing before you go…', preview: 'We want to make sure you get the most out of this' }),
      ts('tag', { tag: 'lead-nurtured' }),
    ],
  },
  {
    id: 'welcome-brand-subscribers',
    name: 'Welcome new subscribers to your brand',
    description: 'A three-part onboarding series introducing your brand, features, and tips.',
    emoji: '🌟',
    color: '#f59e0b',
    bg: '#fffbeb',
    tags: ['Email', 'Onboarding'],
    steps: [
      ts('trigger', { trigger: 'email_signup' }),
      ts('send_email', { subject: 'Welcome to the family! 🎉', preview: 'You\'re officially in. Here\'s what\'s next…' }),
      ts('delay', { amount: 2, unit: 'days' }),
      ts('send_email', { subject: 'Here\'s what you can do with us', preview: 'A quick tour of everything available to you…' }),
      ts('delay', { amount: 5, unit: 'days' }),
      ts('send_email', { subject: 'Tips to get the most out of your subscription', preview: 'Our top users do these 3 things…' }),
      ts('tag', { tag: 'onboarded' }),
    ],
  },
  {
    id: 'welcome-sms-email',
    name: 'Welcome new contacts with SMS & Email',
    description: 'Hit new contacts on two channels — a welcome email followed by a friendly SMS.',
    emoji: '📱',
    color: '#10b981',
    bg: '#ecfdf5',
    tags: ['Email', 'SMS', 'Welcome'],
    steps: [
      ts('trigger', { trigger: 'email_signup' }),
      ts('send_email', { subject: 'Welcome! You\'re officially in 🙌', preview: 'Thanks for joining us. Here\'s what\'s next…' }),
      ts('delay', { amount: 30, unit: 'minutes' }),
      ts('send_sms', { message: 'Hey! Thanks for joining us 🎉 We\'re so glad you\'re here. Keep an eye on your inbox for something special.' }),
    ],
  },
  {
    id: 'appointment-reminder',
    name: 'Remind users about appointments',
    description: 'Automated reminders before an upcoming appointment or reservation to reduce no-shows.',
    emoji: '📅',
    color: '#06b6d4',
    bg: '#ecfeff',
    tags: ['Email', 'SMS', 'Reminder'],
    steps: [
      ts('trigger', { trigger: 'specific_date' }),
      ts('send_email', { subject: 'Your appointment is 2 days away', preview: 'A quick reminder about your upcoming booking…' }),
      ts('delay', { amount: 1, unit: 'days' }),
      ts('send_email', { subject: 'See you tomorrow! Your booking details inside', preview: 'Everything you need for tomorrow…' }),
      ts('send_sms', { message: 'Reminder: your appointment is tomorrow! Reply HELP for assistance or STOP to unsubscribe.' }),
    ],
  },
  {
    id: 'target-email-openers',
    name: 'Target contacts based on emails they open',
    description: 'Branch contacts based on whether they opened your last email — reward engaged contacts, re-engage the rest.',
    emoji: '📬',
    color: '#f97316',
    bg: '#fff7ed',
    tags: ['Email', 'Segmentation', 'If/Else'],
    steps: [
      ts('trigger', { trigger: 'email_opened' }),
      ts('delay', { amount: 4, unit: 'hours' }),
      ts('if_else',
        { condition_type: 'email_opened', condition: 'last campaign' },
        {
          yes_steps: [
            ts('send_email', { subject: 'You\'re one of our most engaged readers 🙏', preview: 'We saved something special for you…' }),
            ts('tag', { tag: 'highly-engaged' }),
          ],
          no_steps: [
            ts('send_email', { subject: 'We miss you — here\'s something special', preview: 'It\'s been a while. Come back and see what\'s new…' }),
            ts('tag', { tag: 're-engagement' }),
          ],
        }
      ),
    ],
  },
  {
    id: 'welcome-confirm-registration',
    name: 'Welcome contacts & confirm registration',
    description: 'Send a confirmation email and follow up based on whether they clicked the confirmation link.',
    emoji: '✅',
    color: '#16a34a',
    bg: '#dcfce7',
    tags: ['Email', 'Registration', 'If/Else'],
    steps: [
      ts('trigger', { trigger: 'email_signup' }),
      ts('send_email', { subject: 'Please confirm your registration', preview: 'One click to verify your email address…' }),
      ts('delay', { amount: 1, unit: 'days' }),
      ts('if_else',
        { condition_type: 'link_clicked', condition: 'confirmation link' },
        {
          yes_steps: [
            ts('tag', { tag: 'confirmed' }),
            ts('send_email', { subject: 'You\'re confirmed — welcome aboard! 🎉', preview: 'Your account is active and ready to go…' }),
          ],
          no_steps: [
            ts('send_email', { subject: 'Reminder: please confirm your email address', preview: 'We still need you to verify your email…' }),
          ],
        }
      ),
    ],
  },
  {
    id: 'thank-you-booking',
    name: 'Thank you for the booking',
    description: 'Confirm a booking immediately, share details the next day, and send a same-day SMS reminder.',
    emoji: '🏷️',
    color: '#ec4899',
    bg: '#fdf2f8',
    tags: ['Email', 'SMS', 'Booking'],
    steps: [
      ts('trigger', { trigger: 'purchase' }),
      ts('send_email', { subject: 'Thank you for your booking! 🎉', preview: 'Your booking is confirmed. Here\'s what\'s next…' }),
      ts('delay', { amount: 1, unit: 'hours' }),
      ts('send_email', { subject: 'Your booking details and what to expect', preview: 'Everything you need to know before your visit…' }),
      ts('tag', { tag: 'booked' }),
      ts('delay', { amount: 1, unit: 'days' }),
      ts('send_sms', { message: 'Your booking is confirmed! We look forward to seeing you. Reply HELP for assistance.' }),
    ],
  },
  {
    id: 'payment-confirmation',
    name: 'Send payment confirmation',
    description: 'Instantly confirm a payment, tag the contact as a customer, and follow up with their receipt.',
    emoji: '💳',
    color: '#0ea5e9',
    bg: '#f0f9ff',
    tags: ['Email', 'Payment', 'Customer'],
    steps: [
      ts('trigger', { trigger: 'purchase' }),
      ts('send_email', { subject: 'Payment confirmed — thank you! 🙌', preview: 'Your payment was received successfully…' }),
      ts('tag', { tag: 'customer' }),
      ts('update_contact', { field: 'Status', value: 'Paid' }),
      ts('delay', { amount: 3, unit: 'days' }),
      ts('send_email', { subject: 'Your receipt and next steps', preview: 'Here\'s a summary of your purchase and what comes next…' }),
    ],
  },
];

// ─────────────────────────────────────────────────────────────────────────────
// Create modal (2-step: pick template → name it)
// ─────────────────────────────────────────────────────────────────────────────

type CreateStep = 'pick' | 'name';

function CreateModal({
  onCreate,
  onClose,
}: {
  onCreate: (name: string, desc: string, steps: FlowStep[]) => void;
  onClose: () => void;
}) {
  const [step, setStep] = useState<CreateStep>('pick');
  const [selected, setSelected] = useState<AutomationTemplate | null>(null);
  const [name, setName] = useState('');
  const [desc, setDesc] = useState('');
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const h = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) onClose(); };
    document.addEventListener('mousedown', h);
    return () => document.removeEventListener('mousedown', h);
  }, [onClose]);

  function pickTemplate(tpl: AutomationTemplate | null) {
    setSelected(tpl);
    setName(tpl?.name ?? '');
    setDesc(tpl?.description ?? '');
    setStep('name');
  }

  const initialSteps = selected
    ? selected.steps.map(s => ({ ...s, id: uid() }))
    : [defaultStep('trigger')];

  // ── Step 1: template picker ──────────────────────────────────────────────
  if (step === 'pick') {
    return (
      <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm p-4">
        <div ref={ref} className="flex w-full max-w-4xl flex-col rounded-2xl bg-white shadow-2xl" style={{ maxHeight: '90vh' }}>
          {/* Header */}
          <div className="flex items-center justify-between border-b border-slate-100 px-6 py-4">
            <div>
              <h2 className="text-lg font-bold text-slate-900">Choose a starting point</h2>
              <p className="mt-0.5 text-sm text-slate-500">Pick a template or start from scratch. You can customise everything in the builder.</p>
            </div>
            <button type="button" onClick={onClose} className="flex h-8 w-8 items-center justify-center rounded-lg text-slate-400 hover:bg-slate-100">
              <X size={15} />
            </button>
          </div>

          {/* Grid */}
          <div className="flex-1 overflow-y-auto p-6">
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {/* Scratch card */}
              <button type="button" onClick={() => pickTemplate(null)}
                className="group flex flex-col items-start gap-3 rounded-2xl border-2 border-dashed border-slate-200 p-5 text-left hover:border-indigo-300 hover:bg-indigo-50/40 transition-all">
                <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-slate-100 text-xl group-hover:bg-indigo-100">
                  ✨
                </div>
                <div>
                  <div className="font-semibold text-slate-900">Start from scratch</div>
                  <div className="mt-0.5 text-xs text-slate-400">Build your own custom journey from a blank canvas.</div>
                </div>
              </button>

              {/* Template cards */}
              {AUTOMATION_TEMPLATES.map(tpl => (
                <button key={tpl.id} type="button" onClick={() => pickTemplate(tpl)}
                  className="group flex flex-col items-start gap-3 rounded-2xl border border-slate-200 bg-white p-5 text-left hover:border-slate-300 hover:shadow-md transition-all">
                  <div className="flex w-full items-center justify-between">
                    <div className="flex h-10 w-10 items-center justify-center rounded-xl text-xl" style={{ background: tpl.bg }}>
                      {tpl.emoji}
                    </div>
                    <div className="flex flex-wrap gap-1 justify-end">
                      {tpl.tags.map(t => (
                        <span key={t} className="rounded-full px-2 py-0.5 text-[10px] font-semibold" style={{ background: tpl.bg, color: tpl.color }}>
                          {t}
                        </span>
                      ))}
                    </div>
                  </div>
                  <div>
                    <div className="font-semibold text-slate-900 leading-snug">{tpl.name}</div>
                    <div className="mt-1 text-xs text-slate-400 leading-relaxed">{tpl.description}</div>
                  </div>
                  <div className="mt-auto text-[10px] font-semibold uppercase tracking-wide" style={{ color: tpl.color }}>
                    {tpl.steps.length} steps pre-built
                  </div>
                </button>
              ))}
            </div>
          </div>
        </div>
      </div>
    );
  }

  // ── Step 2: name + confirm ───────────────────────────────────────────────
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm p-4">
      <div ref={ref} className="w-full max-w-md rounded-2xl bg-white shadow-2xl">
        {/* Header */}
        <div className="flex items-center gap-3 border-b border-slate-100 px-6 py-4">
          {selected && (
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl text-xl" style={{ background: selected.bg }}>
              {selected.emoji}
            </div>
          )}
          <div className="flex-1 min-w-0">
            <h2 className="font-bold text-slate-900">{selected ? 'Name your automation' : 'Start from scratch'}</h2>
            {selected && <p className="mt-0.5 text-xs text-slate-400 truncate">{selected.steps.length} steps pre-loaded from template</p>}
          </div>
          <button type="button" onClick={() => setStep('pick')} className="text-xs text-indigo-500 hover:underline shrink-0">
            ← Back
          </button>
        </div>

        <div className="p-6 space-y-4">
          <div>
            <label className="mb-1.5 block text-xs font-semibold uppercase tracking-wide text-slate-600">Automation name</label>
            <input
              autoFocus
              value={name}
              onChange={e => setName(e.target.value)}
              placeholder="e.g. Welcome series"
              className="w-full rounded-xl border border-slate-200 px-4 py-2.5 text-sm text-slate-900 focus:border-indigo-400 focus:outline-none"
            />
          </div>
          <div>
            <label className="mb-1.5 block text-xs font-semibold uppercase tracking-wide text-slate-600">Description (optional)</label>
            <input
              value={desc}
              onChange={e => setDesc(e.target.value)}
              placeholder="What does this automation do?"
              className="w-full rounded-xl border border-slate-200 px-4 py-2.5 text-sm text-slate-900 focus:border-indigo-400 focus:outline-none"
            />
          </div>
        </div>

        <div className="flex justify-end gap-2 border-t border-slate-100 px-6 py-4">
          <button type="button" onClick={onClose}
            className="rounded-xl border border-slate-200 px-4 py-2 text-sm font-medium text-slate-600 hover:bg-slate-50">
            Cancel
          </button>
          <button type="button" disabled={!name.trim()} onClick={() => onCreate(name.trim(), desc.trim(), initialSteps)}
            className="rounded-xl bg-indigo-600 px-4 py-2 text-sm font-semibold text-white hover:bg-indigo-700 disabled:opacity-50 transition-colors">
            {selected ? 'Open builder →' : 'Create & open builder'}
          </button>
        </div>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Main page
// ─────────────────────────────────────────────────────────────────────────────

export default function MarketingAutomations() {
  const [flows, setFlows] = useState<AutomationFlow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [showCreate, setShowCreate] = useState(false);
  const [editingFlow, setEditingFlow] = useState<AutomationFlow | null>(null);

  useEffect(() => {
    apiGet<AutomationFlow[]>('/api/automations')
      .then(setFlows)
      .catch(() => setError('Failed to load automations.'))
      .finally(() => setLoading(false));
  }, []);

  async function handleCreate(name: string, description: string, steps: FlowStep[]) {
    const created = await apiPost<AutomationFlow>('/api/automations', { name, description, steps });
    setFlows(prev => [created, ...prev]);
    setShowCreate(false);
    setEditingFlow(created);
  }

  async function handleSave(updated: AutomationFlow) {
    const saved = await apiPut<AutomationFlow>(`/api/automations/${updated.id}`, updated);
    setFlows(prev => prev.map(f => f.id === saved.id ? saved : f));
    setEditingFlow(saved);
  }

  async function handleDelete(id: string) {
    await apiDelete(`/api/automations/${id}`);
    setFlows(prev => prev.filter(f => f.id !== id));
  }

  async function handleToggle(flow: AutomationFlow) {
    const newStatus: FlowStatus = flow.status === 'active' ? 'paused' : 'active';
    const saved = await apiPut<AutomationFlow>(`/api/automations/${flow.id}`, { ...flow, status: newStatus });
    setFlows(prev => prev.map(f => f.id === saved.id ? saved : f));
  }

  if (editingFlow) {
    return (
      <FlowBuilder
        flow={editingFlow}
        onSave={handleSave}
        onClose={() => setEditingFlow(null)}
      />
    );
  }

  const activeCount = flows.filter(f => f.status === 'active').length;

  return (
    <div className="space-y-8 pb-12">
      {showCreate && <CreateModal onCreate={handleCreate} onClose={() => setShowCreate(false)} />}

      {/* Header */}
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-4xl font-black tracking-[-0.04em] text-slate-950">Automations</h1>
          <p className="mt-2 text-base text-slate-500">Build customer journeys — automated workflows that engage contacts at the right moment.</p>
        </div>
        <button type="button" onClick={() => setShowCreate(true)}
          className="flex shrink-0 items-center gap-1.5 rounded-xl bg-indigo-600 px-4 py-2.5 text-sm font-semibold text-white hover:bg-indigo-700 shadow-sm transition-colors">
          <Plus size={15} /> Create automation
        </button>
      </div>

      {/* Stats strip */}
      {flows.length > 0 && (
        <div className="flex gap-4">
          {[
            { label: 'Total', value: flows.length },
            { label: 'Active', value: activeCount },
            { label: 'Draft / Paused', value: flows.length - activeCount },
          ].map(s => (
            <div key={s.label} className="rounded-2xl border border-slate-200 bg-white px-5 py-4 min-w-[110px]">
              <div className="text-2xl font-black text-slate-950">{s.value}</div>
              <div className="mt-0.5 text-xs font-semibold uppercase tracking-wide text-slate-400">{s.label}</div>
            </div>
          ))}
        </div>
      )}

      {/* Node-type reference */}
      <div className="rounded-2xl border border-slate-200 bg-white p-5">
        <div className="mb-3 flex items-center gap-2">
          <Shuffle size={14} className="text-slate-400" />
          <span className="text-xs font-bold uppercase tracking-widest text-slate-400">Available steps</span>
        </div>
        <div className="flex flex-wrap gap-2">
          {(Object.entries(NODE_META) as [StepType, NodeMeta][]).filter(([t]) => t !== 'trigger').map(([t, m]) => (
            <span key={t} className="flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium" style={{ background: m.bg, color: m.color }}>
              {m.icon} {m.label}
            </span>
          ))}
        </div>
      </div>

      {/* Flow list */}
      {loading && (
        <div className="flex items-center justify-center py-16 text-slate-400">
          <Loader2 size={20} className="animate-spin mr-2" /> Loading automations…
        </div>
      )}

      {!loading && error && (
        <div className="rounded-2xl border border-red-100 bg-red-50 px-5 py-4 text-sm text-red-600">{error}</div>
      )}

      {!loading && !error && flows.length === 0 && (
        <div className="flex flex-col items-center justify-center rounded-2xl border-2 border-dashed border-slate-200 py-20 text-center">
          <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-indigo-50 mb-4">
            <Zap size={26} className="text-indigo-400" />
          </div>
          <h3 className="text-lg font-bold text-slate-800">No automations yet</h3>
          <p className="mt-1 text-sm text-slate-400 max-w-xs">Create a customer journey to automatically send emails, tag contacts, and more — triggered by real behaviour.</p>
          <button type="button" onClick={() => setShowCreate(true)}
            className="mt-5 flex items-center gap-1.5 rounded-xl bg-indigo-600 px-4 py-2.5 text-sm font-semibold text-white hover:bg-indigo-700 transition-colors">
            <Plus size={14} /> Create your first automation
          </button>
        </div>
      )}

      {!loading && !error && flows.length > 0 && (
        <div className="space-y-3">
          {flows.map(flow => (
            <FlowCard
              key={flow.id}
              flow={flow}
              onEdit={() => setEditingFlow(flow)}
              onDelete={() => handleDelete(flow.id)}
              onToggle={() => handleToggle(flow)}
            />
          ))}
        </div>
      )}
    </div>
  );
}
