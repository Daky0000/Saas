import { useEffect, useState } from 'react';
import {
  BarChart2, Calendar, Clock, Loader2, Mail, Plus, Send, Star, Trash2,
  TrendingUp, Users, X, Zap,
} from 'lucide-react';
import {
  mailingService,
  type MailingAutomation,
  type MailingCampaign,
  type MailingContact,
  type MailingSegment,
  type MailingAnalytics,
} from '../services/mailingService';

type Tab = 'campaigns' | 'automations' | 'analytics' | 'leads';

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
  { id: 'leads', label: 'Lead Scores', icon: Star },
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
  const [form, setForm] = useState({ name: '', subject: '', subjectB: '', preview_text: '', segment_id: '', content: '', goal: '', tone: '', abMode: false, scheduleDate: '' });
  const [saving, setSaving] = useState(false);
  const [sending, setSending] = useState<string | null>(null);
  const [sendResult, setSendResult] = useState<string | null>(null);
  const [schedulingId, setSchedulingId] = useState<string | null>(null);
  const [scheduleDateTime, setScheduleDateTime] = useState('');

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
      const base = { preview_text: form.preview_text || undefined, segment_id: form.segment_id || undefined, content: metaPrefix + form.content, scheduled_at: form.scheduleDate || undefined };
      if (form.abMode && form.subjectB.trim()) {
        await Promise.all([
          mailingService.createCampaign({ name: `${form.name} [A]`, subject: form.subject, ...base }),
          mailingService.createCampaign({ name: `${form.name} [B]`, subject: form.subjectB, ...base }),
        ]);
      } else {
        await mailingService.createCampaign({ name: form.name, subject: form.subject, ...base });
      }
      setForm({ name: '', subject: '', subjectB: '', preview_text: '', segment_id: '', content: '', goal: '', tone: '', abMode: false, scheduleDate: '' });
      setShowAdd(false); await load();
    } catch { /* silent */ } finally { setSaving(false); }
  };

  const handleDelete = async (id: string) => {
    if (!confirm('Delete this campaign?')) return;
    await mailingService.deleteCampaign(id); await load();
  };

  const handleSend = async (id: string, name: string) => {
    if (!confirm(`Send "${name}" to all subscribed contacts now?`)) return;
    setSending(id); setSendResult(null);
    try {
      const result = await mailingService.sendCampaign(id);
      setSendResult(`Sent to ${result.sent} contact${result.sent !== 1 ? 's' : ''}${result.failed ? `, ${result.failed} failed` : ''}.`);
      await load();
    } catch (err) {
      setSendResult(err instanceof Error ? err.message : 'Send failed');
    } finally { setSending(null); }
  };

  const handleSchedule = async () => {
    if (!schedulingId || !scheduleDateTime) return;
    try {
      await mailingService.updateCampaign(schedulingId, { scheduled_at: new Date(scheduleDateTime).toISOString() });
      setSchedulingId(null); setScheduleDateTime(''); await load();
    } catch { /* */ }
  };

  const isAB = (c: MailingCampaign) => /\s\[A\]$/.test(c.name) || /\s\[B\]$/.test(c.name);

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <p className="text-sm text-slate-500">Create and send email campaigns to your contacts.</p>
        <button data-tour-id="btn-new-email-campaign" onClick={() => setShowAdd(true)} className="flex items-center gap-2 rounded-xl bg-slate-950 px-4 py-2 text-sm font-semibold text-white hover:bg-slate-800">
          <Plus size={14} /> New Campaign
        </button>
      </div>

      {/* Schedule modal */}
      {schedulingId && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 px-4">
          <div className="w-full max-w-sm rounded-2xl border border-slate-200 bg-white shadow-xl p-6">
            <div className="flex items-center justify-between mb-4">
              <h3 className="font-bold text-slate-900">Schedule Send</h3>
              <button onClick={() => setSchedulingId(null)}><X size={16} className="text-slate-400" /></button>
            </div>
            <label className="block text-xs font-bold uppercase tracking-wide text-slate-500 mb-1.5">Send Date & Time</label>
            <input type="datetime-local" value={scheduleDateTime} onChange={e => setScheduleDateTime(e.target.value)} className="w-full rounded-xl border border-slate-200 px-4 py-2.5 text-sm outline-none focus:border-slate-400 mb-4" />
            <div className="flex gap-2 justify-end">
              <button onClick={() => setSchedulingId(null)} className="rounded-xl border border-slate-200 px-4 py-2 text-sm font-semibold text-slate-600">Cancel</button>
              <button disabled={!scheduleDateTime} onClick={() => void handleSchedule()} className="rounded-xl bg-amber-500 text-white px-4 py-2 text-sm font-semibold disabled:opacity-50 hover:bg-amber-600">Schedule</button>
            </div>
          </div>
        </div>
      )}

      {showAdd && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 px-4">
          <div className="w-full max-w-lg rounded-2xl border border-slate-200 bg-white shadow-xl">
            <div className="flex items-center justify-between border-b border-slate-100 px-5 py-4">
              <span className="text-sm font-bold">New Campaign</span>
              <button onClick={() => setShowAdd(false)}><X size={18} className="text-slate-400" /></button>
            </div>
            <div className="space-y-3 px-5 py-4 max-h-[70vh] overflow-y-auto">
              <input value={form.name} onChange={e => setForm(f => ({...f, name: e.target.value}))} placeholder="Campaign name *" className="w-full rounded-xl border border-slate-200 px-4 py-2 text-sm outline-none focus:border-slate-400" />
              {/* A/B toggle */}
              <div className="flex items-center gap-3">
                <button type="button" onClick={() => setForm(f => ({...f, abMode: !f.abMode}))} className={`flex items-center gap-1.5 rounded-xl border px-3 py-1.5 text-xs font-semibold transition-all ${form.abMode ? 'border-indigo-500 bg-indigo-50 text-indigo-700' : 'border-slate-200 text-slate-500 hover:border-slate-300'}`}>
                  A/B Test {form.abMode ? '✓' : ''}
                </button>
                <span className="text-xs text-slate-400">Test two subject lines to find the winner</span>
              </div>
              {form.abMode ? (
                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <label className="block text-xs font-semibold text-slate-400 mb-1">Subject A *</label>
                    <input value={form.subject} onChange={e => setForm(f => ({...f, subject: e.target.value}))} placeholder="Variant A subject" className="w-full rounded-xl border border-indigo-200 bg-indigo-50 px-3 py-2 text-sm outline-none focus:border-indigo-400" />
                  </div>
                  <div>
                    <label className="block text-xs font-semibold text-slate-400 mb-1">Subject B *</label>
                    <input value={form.subjectB} onChange={e => setForm(f => ({...f, subjectB: e.target.value}))} placeholder="Variant B subject" className="w-full rounded-xl border border-purple-200 bg-purple-50 px-3 py-2 text-sm outline-none focus:border-purple-400" />
                  </div>
                </div>
              ) : (
                <input value={form.subject} onChange={e => setForm(f => ({...f, subject: e.target.value}))} placeholder="Email subject *" className="w-full rounded-xl border border-slate-200 px-4 py-2 text-sm outline-none focus:border-slate-400" />
              )}
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
              {/* Schedule */}
              <div className="rounded-xl border border-amber-100 bg-amber-50 p-3 space-y-2">
                <div className="flex items-center gap-2">
                  <Clock size={13} className="text-amber-500" />
                  <span className="text-xs font-bold text-amber-700">Schedule (optional)</span>
                </div>
                <input type="datetime-local" value={form.scheduleDate} onChange={e => setForm(f => ({...f, scheduleDate: e.target.value}))} className="w-full rounded-xl border border-amber-200 bg-white px-4 py-2 text-sm outline-none focus:border-amber-400" />
                {form.scheduleDate && <p className="text-xs text-amber-600">Will send at {new Date(form.scheduleDate).toLocaleString()}</p>}
              </div>
            </div>
            <div className="flex justify-end gap-2 border-t border-slate-100 px-5 py-4">
              <button onClick={() => setShowAdd(false)} className="rounded-xl border border-slate-200 px-4 py-2 text-sm font-semibold text-slate-600">Cancel</button>
              <button onClick={() => void handleAdd()} disabled={saving || !form.name || !form.subject || (form.abMode && !form.subjectB)} className="rounded-xl bg-slate-950 px-4 py-2 text-sm font-bold text-white disabled:opacity-40">
                {saving ? <Loader2 size={14} className="animate-spin" /> : form.abMode ? 'Create A/B Test' : form.scheduleDate ? 'Schedule' : 'Create'}
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
                    <div className="flex items-center gap-1.5">
                      {c.name}
                      {isAB(c) && <span className="rounded-full bg-purple-50 px-2 py-0.5 text-[10px] font-bold text-purple-700">A/B</span>}
                    </div>
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
                    <div className="space-y-1">
                      <span className={`rounded-full px-2 py-0.5 text-xs font-semibold ${STATUS_BADGE[c.status] || 'bg-slate-100 text-slate-600'}`}>{c.status}</span>
                      {c.scheduled_at && c.status !== 'sent' && <div className="flex items-center gap-1 text-[10px] text-amber-600"><Calendar size={9} /> {new Date(c.scheduled_at).toLocaleString()}</div>}
                    </div>
                  </td>
                  <td className="px-4 py-3 text-slate-500">{formatDate(c.created_at)}</td>
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-1 justify-end">
                      {c.status !== 'sent' && (
                        <>
                          <button onClick={() => { setSchedulingId(c.id); setScheduleDateTime(''); }} title="Schedule send" className="flex h-8 w-8 items-center justify-center rounded-lg text-slate-400 hover:bg-amber-50 hover:text-amber-600">
                            <Clock size={13} />
                          </button>
                          <button onClick={() => void handleSend(c.id, c.name)} disabled={sending === c.id} title="Send now" className="flex h-8 w-8 items-center justify-center rounded-lg text-slate-400 hover:bg-indigo-50 hover:text-indigo-600 disabled:opacity-40">
                            {sending === c.id ? <Loader2 size={13} className="animate-spin" /> : <Send size={13} />}
                          </button>
                        </>
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

// ─── Lead Scores Tab ─────────────────────────────────────────────────────────

function LeadsTab() {
  const [contacts, setContacts] = useState<MailingContact[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    mailingService.listContacts()
      .then(all => {
        const sorted = [...all].sort((a, b) => {
          const sa = parseInt((a.custom_data as Record<string, string>)?.lead_score || '0', 10);
          const sb = parseInt((b.custom_data as Record<string, string>)?.lead_score || '0', 10);
          return sb - sa;
        });
        setContacts(sorted);
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  const withScore = contacts.filter(c => parseInt(c.custom_data?.lead_score || '0', 10) > 0);
  const maxScore = withScore.length > 0 ? parseInt((withScore[0].custom_data as Record<string, string>)?.lead_score || '1', 10) : 1;

  const getTier = (score: number) => {
    if (score >= 80) return { label: 'Hot', color: 'text-red-600 bg-red-50', bar: 'bg-red-400' };
    if (score >= 50) return { label: 'Warm', color: 'text-amber-600 bg-amber-50', bar: 'bg-amber-400' };
    if (score >= 20) return { label: 'Cool', color: 'text-blue-600 bg-blue-50', bar: 'bg-blue-400' };
    return { label: 'Cold', color: 'text-slate-500 bg-slate-100', bar: 'bg-slate-300' };
  };

  const avgScore = withScore.length > 0
    ? Math.round(withScore.reduce((sum, c) => sum + parseInt(c.custom_data?.lead_score || '0', 10), 0) / withScore.length)
    : 0;

  return (
    <div className="space-y-5">
      {/* Summary KPIs */}
      <div className="grid gap-4 sm:grid-cols-3">
        {[
          { label: 'Scored Leads', value: withScore.length, sub: `of ${contacts.length} total contacts`, icon: <TrendingUp size={16} /> },
          { label: 'Hot Leads (80+)', value: withScore.filter(c => parseInt(c.custom_data?.lead_score || '0', 10) >= 80).length, sub: 'ready to convert', icon: <Star size={16} className="text-red-500" /> },
          { label: 'Avg Lead Score', value: avgScore, sub: 'across scored contacts', icon: <Users size={16} /> },
        ].map(k => (
          <div key={k.label} className="rounded-2xl border border-slate-200 bg-white p-5 flex items-start gap-3">
            <div className="mt-0.5 text-slate-400">{k.icon}</div>
            <div>
              <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">{k.label}</div>
              <div className="mt-1 text-3xl font-black text-slate-950">{k.value}</div>
              <div className="mt-0.5 text-xs text-slate-400">{k.sub}</div>
            </div>
          </div>
        ))}
      </div>

      {/* Leaderboard */}
      <div className="rounded-2xl border border-slate-200 bg-white overflow-hidden">
        <div className="border-b border-slate-100 px-5 py-4">
          <h3 className="text-sm font-bold text-slate-900">Lead Score Leaderboard</h3>
          <p className="text-xs text-slate-500 mt-0.5">Contacts ranked by engagement score. Scores increase via automations (UTM clicks, survey responses, email opens).</p>
        </div>
        {loading ? (
          <div className="flex justify-center py-12 text-slate-400"><Loader2 size={20} className="animate-spin" /></div>
        ) : withScore.length === 0 ? (
          <div className="flex flex-col items-center py-16 text-slate-400">
            <Star size={32} className="mb-3 opacity-30" />
            <p className="text-sm font-semibold">No lead scores yet</p>
            <p className="mt-1 text-xs text-center max-w-xs">Use the "Score Lead" action in Automations to assign points when contacts engage — e.g. click a UTM link or complete a survey.</p>
          </div>
        ) : (
          <table className="w-full text-sm">
            <thead className="border-b border-slate-100">
              <tr className="text-xs font-semibold text-slate-500">
                <th className="px-4 py-3 text-left w-10">#</th>
                <th className="px-4 py-3 text-left">Contact</th>
                <th className="px-4 py-3 text-left">Tags</th>
                <th className="px-4 py-3 text-left">Tier</th>
                <th className="px-4 py-3 text-left w-48">Score</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-50">
              {withScore.map((c, i) => {
                const score = parseInt(c.custom_data?.lead_score || '0', 10);
                const pct = Math.round((score / maxScore) * 100);
                const tier = getTier(score);
                return (
                  <tr key={c.id} className="hover:bg-slate-50">
                    <td className="px-4 py-3 text-slate-400 font-mono text-xs">{i + 1}</td>
                    <td className="px-4 py-3">
                      <div className="font-medium text-slate-900">{c.first_name || c.last_name ? `${c.first_name ?? ''} ${c.last_name ?? ''}`.trim() : c.email}</div>
                      {(c.first_name || c.last_name) && <div className="text-xs text-slate-400">{c.email}</div>}
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex flex-wrap gap-1">
                        {(c.tags ?? []).slice(0, 3).map(t => (
                          <span key={t} className="rounded-full bg-indigo-50 px-2 py-0.5 text-[10px] font-semibold text-indigo-700">{t}</span>
                        ))}
                        {(c.tags ?? []).length > 3 && <span className="text-[10px] text-slate-400">+{(c.tags ?? []).length - 3}</span>}
                      </div>
                    </td>
                    <td className="px-4 py-3">
                      <span className={`rounded-full px-2 py-0.5 text-xs font-bold ${tier.color}`}>{tier.label}</span>
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-2">
                        <div className="flex-1 h-1.5 rounded-full bg-slate-100 overflow-hidden">
                          <div className={`h-full rounded-full ${tier.bar} transition-all`} style={{ width: `${pct}%` }} />
                        </div>
                        <span className="text-xs font-bold text-slate-700 w-8 text-right">{score}</span>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
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
        {tab === 'leads' && <LeadsTab />}
      </div>
    </div>
  );
}
