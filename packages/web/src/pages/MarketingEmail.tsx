import { useEffect, useState } from 'react';
import {
  BarChart2,
  Loader2,
  Mail,
  Plus,
  Send,
  Trash2,
  X,
  Zap,
} from 'lucide-react';
import {
  mailingService,
  type MailingAutomation,
  type MailingCampaign,
  type MailingSegment,
  type MailingAnalytics,
} from '../services/mailingService';

type Tab = 'campaigns' | 'automations' | 'analytics';

const EMAIL_GOAL_OPTIONS = [
  { value: 'awareness', label: 'Brand Awareness' },
  { value: 'leads', label: 'Generate Leads' },
  { value: 'sales', label: 'Drive Sales' },
  { value: 'traffic', label: 'Drive Traffic' },
  { value: 'engagement', label: 'Boost Engagement' },
  { value: 'retention', label: 'Retain Customers' },
  { value: 'announcement', label: 'Announcement' },
];

const EMAIL_TONE_OPTIONS = [
  { value: 'professional', label: 'Professional', emoji: '👔' },
  { value: 'friendly', label: 'Friendly', emoji: '😊' },
  { value: 'urgent', label: 'Urgent', emoji: '⚡' },
  { value: 'playful', label: 'Playful', emoji: '🎉' },
  { value: 'inspirational', label: 'Inspirational', emoji: '✨' },
];

function parseCampaignMeta(content: string): { goal?: string; tone?: string; cleanContent: string } {
  const match = content.match(/^<!--campaign-meta:(\{[^}]+\})-->\n?/);
  if (!match) return { cleanContent: content };
  try {
    const meta = JSON.parse(match[1]);
    return { goal: meta.goal, tone: meta.tone, cleanContent: content.slice(match[0].length) };
  } catch { return { cleanContent: content }; }
}

const TABS: { id: Tab; label: string; icon: React.ElementType }[] = [
  { id: 'campaigns', label: 'Campaigns', icon: Mail },
  { id: 'automations', label: 'Automations', icon: Zap },
  { id: 'analytics', label: 'Analytics', icon: BarChart2 },
];

const STATUS_BADGE: Record<string, string> = {
  draft: 'bg-slate-100 text-slate-600',
  scheduled: 'bg-amber-50 text-amber-700',
  sent: 'bg-emerald-50 text-emerald-700',
  active: 'bg-emerald-50 text-emerald-700',
  paused: 'bg-amber-50 text-amber-700',
};

const TRIGGER_LABELS: Record<string, string> = {
  signup: 'New signup',
  unsubscribe: 'Unsubscribe',
  tag_added: 'Tag added',
  campaign_open: 'Email opened',
  campaign_click: 'Link clicked',
  date: 'Specific date',
};

function formatDate(s?: string | null) {
  if (!s) return '—';
  return new Date(s).toLocaleDateString();
}

// ─── Campaigns Tab ───────────────────────────────────────────────────────────

function CampaignsTab() {
  const [campaigns, setCampaigns] = useState<MailingCampaign[]>([]);
  const [segments, setSegments] = useState<MailingSegment[]>([]);
  const [loading, setLoading] = useState(true);
  const [showAdd, setShowAdd] = useState(false);
  const [form, setForm] = useState({ name: '', subject: '', preview_text: '', segment_id: '', content: '', goal: '', tone: '' });
  const [saving, setSaving] = useState(false);
  const [sending, setSending] = useState<string | null>(null);
  const [sendResult, setSendResult] = useState<string | null>(null);

  const load = async () => {
    setLoading(true);
    try {
      const [c, s] = await Promise.all([mailingService.listCampaigns(), mailingService.listSegments()]);
      setCampaigns(c); setSegments(s);
    } catch { /* silent */ } finally { setLoading(false); }
  };

  useEffect(() => { void load(); }, []);

  const handleAdd = async () => {
    if (!form.name || !form.subject) return;
    setSaving(true);
    try {
      const metaPrefix = (form.goal || form.tone)
        ? `<!--campaign-meta:${JSON.stringify({ goal: form.goal || undefined, tone: form.tone || undefined })}-->\n`
        : '';
      await mailingService.createCampaign({ name: form.name, subject: form.subject, preview_text: form.preview_text || undefined, segment_id: form.segment_id || undefined, content: metaPrefix + form.content });
      setForm({ name: '', subject: '', preview_text: '', segment_id: '', content: '', goal: '', tone: '' });
      setShowAdd(false); await load();
    } catch { /* silent */ } finally { setSaving(false); }
  };

  const handleDelete = async (id: string) => {
    if (!confirm('Delete this campaign?')) return;
    await mailingService.deleteCampaign(id); await load();
  };

  const handleSend = async (id: string, name: string) => {
    if (!confirm(`Send "${name}" to all subscribed contacts now?`)) return;
    setSending(id);
    setSendResult(null);
    try {
      const result = await mailingService.sendCampaign(id);
      setSendResult(`Sent to ${result.sent} contact${result.sent !== 1 ? 's' : ''}${result.failed ? `, ${result.failed} failed` : ''}.`);
      await load();
    } catch (err) {
      setSendResult(err instanceof Error ? err.message : 'Send failed');
    } finally {
      setSending(null);
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <p className="text-sm text-slate-500">Create and send email campaigns to your contacts.</p>
        <button data-tour-id="btn-new-email-campaign" onClick={() => setShowAdd(true)} className="flex items-center gap-2 rounded-xl bg-slate-950 px-4 py-2 text-sm font-semibold text-white hover:bg-slate-800">
          <Plus size={14} /> New Campaign
        </button>
      </div>

      {showAdd && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 px-4">
          <div className="w-full max-w-lg rounded-2xl border border-slate-200 bg-white shadow-xl">
            <div className="flex items-center justify-between border-b border-slate-100 px-5 py-4">
              <span className="text-sm font-bold">New Campaign</span>
              <button onClick={() => setShowAdd(false)}><X size={18} className="text-slate-400" /></button>
            </div>
            <div className="space-y-3 px-5 py-4 max-h-[70vh] overflow-y-auto">
              <input value={form.name} onChange={e => setForm(f => ({...f, name: e.target.value}))} placeholder="Campaign name *" className="w-full rounded-xl border border-slate-200 px-4 py-2 text-sm outline-none focus:border-slate-400" />
              <input value={form.subject} onChange={e => setForm(f => ({...f, subject: e.target.value}))} placeholder="Email subject *" className="w-full rounded-xl border border-slate-200 px-4 py-2 text-sm outline-none focus:border-slate-400" />
              <input value={form.preview_text} onChange={e => setForm(f => ({...f, preview_text: e.target.value}))} placeholder="Preview text (optional)" className="w-full rounded-xl border border-slate-200 px-4 py-2 text-sm outline-none focus:border-slate-400" />
              <select value={form.segment_id} onChange={e => setForm(f => ({...f, segment_id: e.target.value}))} className="w-full rounded-xl border border-slate-200 px-4 py-2 text-sm outline-none focus:border-slate-400 bg-white">
                <option value="">All contacts (no segment)</option>
                {segments.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
              </select>
              {/* Strategy section */}
              <div className="rounded-xl border border-slate-100 bg-slate-50 p-3 space-y-2.5">
                <p className="text-xs font-bold uppercase tracking-widest text-slate-400">Strategy (optional)</p>
                <select value={form.goal} onChange={e => setForm(f => ({...f, goal: e.target.value}))} className="w-full rounded-xl border border-slate-200 px-4 py-2 text-sm outline-none focus:border-slate-400 bg-white">
                  <option value="">Goal — what should this campaign achieve?</option>
                  {EMAIL_GOAL_OPTIONS.map(g => <option key={g.value} value={g.value}>{g.label}</option>)}
                </select>
                <div className="flex flex-wrap gap-1.5">
                  {EMAIL_TONE_OPTIONS.map(t => (
                    <button key={t.value} type="button" onClick={() => setForm(f => ({...f, tone: f.tone === t.value ? '' : t.value}))} className={`inline-flex items-center gap-1 rounded-xl border px-2.5 py-1 text-xs font-semibold transition-all ${form.tone === t.value ? 'border-slate-950 bg-slate-950 text-white' : 'border-slate-200 bg-white text-slate-600 hover:border-slate-300'}`}>
                      {t.emoji} {t.label}
                    </button>
                  ))}
                </div>
              </div>
              <textarea value={form.content} onChange={e => setForm(f => ({...f, content: e.target.value}))} placeholder="Email content…" rows={4} className="w-full rounded-xl border border-slate-200 px-4 py-2 text-sm outline-none focus:border-slate-400 resize-none" />
            </div>
            <div className="flex justify-end gap-2 border-t border-slate-100 px-5 py-4">
              <button onClick={() => setShowAdd(false)} className="rounded-xl border border-slate-200 px-4 py-2 text-sm font-semibold text-slate-600">Cancel</button>
              <button onClick={() => void handleAdd()} disabled={saving || !form.name || !form.subject} className="rounded-xl bg-slate-950 px-4 py-2 text-sm font-bold text-white disabled:opacity-40">
                {saving ? <Loader2 size={14} className="animate-spin" /> : 'Create'}
              </button>
            </div>
          </div>
        </div>
      )}

      {sendResult && (
        <div className="rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-2.5 text-sm font-medium text-emerald-700">
          {sendResult}
          <button onClick={() => setSendResult(null)} className="ml-2 text-emerald-500 hover:text-emerald-700">✕</button>
        </div>
      )}

      <div className="rounded-2xl border border-slate-200 bg-white overflow-hidden">
        {loading ? (
          <div className="flex justify-center py-12 text-slate-400"><Loader2 size={20} className="animate-spin" /></div>
        ) : campaigns.length === 0 ? (
          <div className="flex flex-col items-center py-16 text-slate-400">
            <Mail size={32} className="mb-3 opacity-30" />
            <p className="text-sm font-semibold">No campaigns yet</p>
          </div>
        ) : (
          <table className="w-full text-sm">
            <thead className="border-b border-slate-100">
              <tr className="text-xs font-semibold text-slate-500">
                <th className="px-4 py-3 text-left">Campaign</th>
                <th className="px-4 py-3 text-left">Subject</th>
                <th className="px-4 py-3 text-left">Segment</th>
                <th className="px-4 py-3 text-left">Status</th>
                <th className="px-4 py-3 text-left">Created</th>
                <th className="px-4 py-3" />
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-50">
              {campaigns.map(c => (
                <tr key={c.id} className="hover:bg-slate-50">
                  <td className="px-4 py-3 font-medium text-slate-800">
                    <div>{c.name}</div>
                    {(() => {
                      const { goal, tone } = parseCampaignMeta(c.content ?? '');
                      return (goal || tone) ? (
                        <div className="flex gap-1 mt-0.5">
                          {goal && <span className="rounded-full bg-indigo-50 px-2 py-0.5 text-[10px] font-semibold text-indigo-700">{EMAIL_GOAL_OPTIONS.find(g => g.value === goal)?.label ?? goal}</span>}
                          {tone && <span className="rounded-full bg-amber-50 px-2 py-0.5 text-[10px] font-semibold text-amber-700">{EMAIL_TONE_OPTIONS.find(t => t.value === tone)?.emoji} {tone}</span>}
                        </div>
                      ) : null;
                    })()}
                  </td>
                  <td className="px-4 py-3 text-slate-600 max-w-xs truncate">{c.subject}</td>
                  <td className="px-4 py-3 text-slate-500">{c.segment_name || 'All contacts'}</td>
                  <td className="px-4 py-3">
                    <span className={`rounded-full px-2 py-0.5 text-xs font-semibold ${STATUS_BADGE[c.status] || 'bg-slate-100 text-slate-600'}`}>{c.status}</span>
                  </td>
                  <td className="px-4 py-3 text-slate-500">{formatDate(c.created_at)}</td>
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-1 justify-end">
                      {c.status !== 'sent' && (
                        <button
                          onClick={() => void handleSend(c.id, c.name)}
                          disabled={sending === c.id}
                          title="Send campaign"
                          className="flex h-8 w-8 items-center justify-center rounded-lg text-slate-400 hover:bg-indigo-50 hover:text-indigo-600 disabled:opacity-40"
                        >
                          {sending === c.id ? <Loader2 size={13} className="animate-spin" /> : <Send size={13} />}
                        </button>
                      )}
                      <button onClick={() => void handleDelete(c.id)} className="flex h-8 w-8 items-center justify-center rounded-lg text-slate-400 hover:bg-red-50 hover:text-red-500"><Trash2 size={14} /></button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}

// ─── Automations Tab ─────────────────────────────────────────────────────────

function AutomationsTab() {
  const [automations, setAutomations] = useState<MailingAutomation[]>([]);
  const [loading, setLoading] = useState(true);
  const [showAdd, setShowAdd] = useState(false);
  const [form, setForm] = useState({ name: '', trigger_type: 'signup', email_subject: '', email_body: '' });
  const [saving, setSaving] = useState(false);

  const load = async () => {
    setLoading(true);
    try { setAutomations(await mailingService.listAutomations()); } catch { /* silent */ } finally { setLoading(false); }
  };

  useEffect(() => { void load(); }, []);

  const handleAdd = async () => {
    if (!form.name || !form.email_subject) return;
    setSaving(true);
    try {
      await mailingService.createAutomation({
        name: form.name,
        trigger_type: form.trigger_type,
        actions: [{ subject: form.email_subject, content: form.email_body }],
      });
      setForm({ name: '', trigger_type: 'signup', email_subject: '', email_body: '' });
      setShowAdd(false);
      await load();
    }
    catch { /* silent */ } finally { setSaving(false); }
  };

  const handleToggle = async (a: MailingAutomation) => {
    const next = a.status === 'active' ? 'paused' : 'active';
    await mailingService.updateAutomation(a.id, { status: next }); await load();
  };

  const handleDelete = async (id: string) => {
    if (!confirm('Delete this automation?')) return;
    await mailingService.deleteAutomation(id); await load();
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <p className="text-sm text-slate-500">Automate emails based on contact activity.</p>
        <button onClick={() => setShowAdd(true)} className="flex items-center gap-2 rounded-xl bg-slate-950 px-4 py-2 text-sm font-semibold text-white hover:bg-slate-800">
          <Plus size={14} /> New Automation
        </button>
      </div>

      {showAdd && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 px-4">
          <div className="w-full max-w-lg rounded-2xl border border-slate-200 bg-white shadow-xl">
            <div className="flex items-center justify-between border-b border-slate-100 px-5 py-4">
              <span className="text-sm font-bold">New Automation</span>
              <button onClick={() => setShowAdd(false)}><X size={18} className="text-slate-400" /></button>
            </div>
            <div className="space-y-3 px-5 py-4">
              <div>
                <label className="mb-1 block text-xs font-semibold text-slate-500">Automation name *</label>
                <input value={form.name} onChange={e => setForm(f => ({...f, name: e.target.value}))} placeholder="e.g. Welcome Email" className="w-full rounded-xl border border-slate-200 px-4 py-2 text-sm outline-none focus:border-slate-400" />
              </div>
              <div>
                <label className="mb-1 block text-xs font-semibold text-slate-500">Trigger</label>
                <select value={form.trigger_type} onChange={e => setForm(f => ({...f, trigger_type: e.target.value}))} className="w-full rounded-xl border border-slate-200 px-4 py-2 text-sm outline-none focus:border-slate-400 bg-white">
                  {Object.entries(TRIGGER_LABELS).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
                </select>
              </div>
              <div className="border-t border-slate-100 pt-3">
                <p className="mb-2 text-xs font-semibold text-slate-500">Email to send</p>
                <input value={form.email_subject} onChange={e => setForm(f => ({...f, email_subject: e.target.value}))} placeholder="Subject line *" className="w-full rounded-xl border border-slate-200 px-4 py-2 text-sm outline-none focus:border-slate-400 mb-2" />
                <textarea value={form.email_body} onChange={e => setForm(f => ({...f, email_body: e.target.value}))} placeholder="Email body (HTML or plain text)" rows={4} className="w-full resize-none rounded-xl border border-slate-200 px-4 py-2 text-sm outline-none focus:border-slate-400" />
              </div>
            </div>
            <div className="flex justify-end gap-2 border-t border-slate-100 px-5 py-4">
              <button onClick={() => setShowAdd(false)} className="rounded-xl border border-slate-200 px-4 py-2 text-sm font-semibold text-slate-600">Cancel</button>
              <button onClick={() => void handleAdd()} disabled={saving || !form.name || !form.email_subject} className="rounded-xl bg-slate-950 px-4 py-2 text-sm font-bold text-white disabled:opacity-40">
                {saving ? <Loader2 size={14} className="animate-spin" /> : 'Create'}
              </button>
            </div>
          </div>
        </div>
      )}

      <div className="grid gap-3 sm:grid-cols-2">
        {loading ? (
          <div className="col-span-full flex justify-center py-12 text-slate-400"><Loader2 size={20} className="animate-spin" /></div>
        ) : automations.length === 0 ? (
          <div className="col-span-full flex flex-col items-center py-16 text-slate-400">
            <Zap size={32} className="mb-3 opacity-30" />
            <p className="text-sm font-semibold">No automations yet</p>
          </div>
        ) : automations.map(a => (
          <div key={a.id} className="rounded-2xl border border-slate-200 bg-white p-5 space-y-3">
            <div className="flex items-start justify-between gap-2">
              <div>
                <div className="text-sm font-bold text-slate-900">{a.name}</div>
                <div className="text-xs text-slate-500 mt-0.5">Trigger: {TRIGGER_LABELS[a.trigger_type] || a.trigger_type}</div>
                {Array.isArray(a.actions) && (a.actions as any[])[0]?.subject && (
                  <div className="text-xs text-slate-400 mt-0.5 truncate">Email: {(a.actions as any[])[0].subject}</div>
                )}
              </div>
              <span className={`rounded-full px-2 py-0.5 text-xs font-semibold ${STATUS_BADGE[a.status] || 'bg-slate-100 text-slate-600'}`}>{a.status}</span>
            </div>
            <div className="flex items-center gap-2 border-t border-slate-100 pt-3">
              <button onClick={() => void handleToggle(a)} className="flex-1 rounded-lg border border-slate-200 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-50">
                {a.status === 'active' ? 'Pause' : 'Activate'}
              </button>
              <button onClick={() => void handleDelete(a.id)} className="flex h-8 w-8 items-center justify-center rounded-lg text-slate-400 hover:bg-red-50 hover:text-red-500"><Trash2 size={13} /></button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

// ─── Analytics Tab ───────────────────────────────────────────────────────────

function AnalyticsTab() {
  const [data, setData] = useState<MailingAnalytics | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    mailingService.getAnalytics().then(setData).catch(() => undefined).finally(() => setLoading(false));
  }, []);

  if (loading) return <div className="flex justify-center py-20 text-slate-400"><Loader2 size={20} className="animate-spin" /></div>;
  if (!data) return <div className="py-12 text-center text-sm text-slate-400">Failed to load analytics.</div>;

  const kpis = [
    { label: 'Total Contacts', value: data.contacts.total, sub: `${data.contacts.subscribed} subscribed` },
    { label: 'Unsubscribed', value: data.contacts.unsubscribed, sub: 'all time' },
    { label: 'Campaigns Sent', value: data.campaigns.sent, sub: `${data.campaigns.draft} drafts` },
    { label: 'Open Rate', value: `${data.rates.openRate}%`, sub: 'of delivered' },
    { label: 'Click Rate', value: `${data.rates.clickRate}%`, sub: 'of delivered' },
    { label: 'Bounce Rate', value: `${data.rates.bounceRate}%`, sub: 'of delivered' },
  ];

  return (
    <div className="space-y-6">
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {kpis.map(k => (
          <div key={k.label} className="rounded-2xl border border-slate-200 bg-white p-5">
            <div className="text-xs font-semibold text-slate-500 uppercase tracking-wide">{k.label}</div>
            <div className="mt-2 text-3xl font-black text-slate-950">{k.value}</div>
            <div className="mt-1 text-xs text-slate-400">{k.sub}</div>
          </div>
        ))}
      </div>

      <div className="rounded-2xl border border-slate-200 bg-white p-5">
        <div className="text-sm font-bold text-slate-900 mb-4">Email Events</div>
        {Object.keys(data.events).length === 0 ? (
          <p className="text-sm text-slate-400">No events recorded yet. Send a campaign to start tracking.</p>
        ) : (
          <div className="space-y-3">
            {Object.entries(data.events).map(([type, count]) => (
              <div key={type} className="flex items-center justify-between">
                <span className="text-sm capitalize text-slate-700">{type}</span>
                <span className="text-sm font-bold text-slate-900">{count.toLocaleString()}</span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

// ─── Main Page ───────────────────────────────────────────────────────────────

export default function MarketingEmail() {
  const [tab, setTab] = useState<Tab>('campaigns');

  return (
    <div className="space-y-6 pb-8">
      <div>
        <h1 className="text-4xl font-black tracking-[-0.04em] text-slate-950">Email Marketing</h1>
        <p className="mt-2 text-base text-slate-500">Create campaigns, automate sequences, and track performance.</p>
      </div>

      <div className="flex items-center gap-1 border-b border-slate-200">
        {TABS.map(({ id, label, icon: Icon }) => (
          <button
            key={id}
            type="button"
            onClick={() => setTab(id)}
            className={`flex items-center gap-2 px-4 py-3 text-sm font-semibold border-b-2 transition-colors -mb-px ${
              tab === id ? 'border-slate-950 text-slate-950' : 'border-transparent text-slate-500 hover:text-slate-800'
            }`}
          >
            <Icon size={15} />
            {label}
          </button>
        ))}
      </div>

      <div>
        {tab === 'campaigns' && <CampaignsTab />}
        {tab === 'automations' && <AutomationsTab />}
        {tab === 'analytics' && <AnalyticsTab />}
      </div>
    </div>
  );
}
