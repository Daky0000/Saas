import { useCallback, useEffect, useRef, useState } from 'react';
import {
  BarChart2,
  Loader2,
  Mail,
  MoreHorizontal,
  Plus,
  Search,
  Tag,
  Trash2,
  Upload,
  Users,
  X,
  Zap,
} from 'lucide-react';
import {
  mailingService,
  type MailingAutomation,
  type MailingCampaign,
  type MailingContact,
  type MailingSegment,
  type MailingAnalytics,
} from '../services/mailingService';

type Tab = 'contacts' | 'segments' | 'campaigns' | 'automations' | 'analytics';

const TABS: { id: Tab; label: string; icon: React.ElementType }[] = [
  { id: 'contacts', label: 'Contacts', icon: Users },
  { id: 'segments', label: 'Segments', icon: Tag },
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

function formatDate(s?: string | null) {
  if (!s) return '—';
  return new Date(s).toLocaleDateString();
}

// ─── Contacts Tab ────────────────────────────────────────────────────────────

function ContactsTab() {
  const [contacts, setContacts] = useState<MailingContact[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [showAdd, setShowAdd] = useState(false);
  const [showImport, setShowImport] = useState(false);
  const [form, setForm] = useState({ email: '', first_name: '', last_name: '', tags: '' });
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [menuOpen, setMenuOpen] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try { setContacts(await mailingService.listContacts({ search: search || undefined })); }
    catch { /* silent */ } finally { setLoading(false); }
  }, [search]);

  useEffect(() => { void load(); }, [load]);

  const handleAdd = async () => {
    if (!form.email) return;
    setSaving(true);
    try {
      await mailingService.createContact({ email: form.email, first_name: form.first_name || undefined, last_name: form.last_name || undefined, tags: form.tags ? form.tags.split(',').map(t => t.trim()).filter(Boolean) : [] });
      setForm({ email: '', first_name: '', last_name: '', tags: '' });
      setShowAdd(false);
      setMessage('Contact added.');
      await load();
    } catch (e) { setMessage(e instanceof Error ? e.message : 'Failed'); }
    finally { setSaving(false); }
  };

  const handleDelete = async (id: string) => {
    if (!confirm('Delete this contact?')) return;
    await mailingService.deleteContact(id);
    await load();
  };

  const handleUnsubscribe = async (c: MailingContact) => {
    await mailingService.updateContact(c.id, { subscribed: false });
    await load();
  };

  const handleCsvImport = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const text = await file.text();
    const lines = text.split('\n').filter(Boolean);
    const headers = lines[0].split(',').map(h => h.trim().toLowerCase().replace(/"/g, ''));
    const emailIdx = headers.indexOf('email');
    const firstIdx = headers.indexOf('first_name');
    const lastIdx = headers.indexOf('last_name');
    if (emailIdx === -1) { setMessage('CSV must have an "email" column'); return; }
    const rows = lines.slice(1).map(l => {
      const cols = l.split(',').map(c => c.trim().replace(/"/g, ''));
      return { email: cols[emailIdx] || '', first_name: cols[firstIdx] || undefined, last_name: cols[lastIdx] || undefined };
    }).filter(r => r.email);
    try {
      const result = await mailingService.importContacts(rows);
      setMessage(`Imported ${result.imported}, skipped ${result.skipped}.`);
      setShowImport(false);
      await load();
    } catch (e) { setMessage(e instanceof Error ? e.message : 'Import failed'); }
    if (fileRef.current) fileRef.current.value = '';
  };

  return (
    <div className="space-y-4">
      {message && (
        <div className="flex items-center justify-between rounded-xl bg-slate-950 px-4 py-3 text-sm text-white">
          <span>{message}</span>
          <button onClick={() => setMessage(null)}><X size={14} /></button>
        </div>
      )}
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div className="relative flex-1 min-w-48">
          <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
          <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search contacts…" className="w-full rounded-xl border border-slate-200 bg-white pl-9 pr-4 py-2 text-sm outline-none focus:border-slate-400" />
        </div>
        <div className="flex gap-2">
          <button onClick={() => setShowImport(true)} className="flex items-center gap-2 rounded-xl border border-slate-200 bg-white px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50">
            <Upload size={14} /> Import CSV
          </button>
          <button onClick={() => setShowAdd(true)} className="flex items-center gap-2 rounded-xl bg-slate-950 px-4 py-2 text-sm font-semibold text-white hover:bg-slate-800">
            <Plus size={14} /> Add Contact
          </button>
        </div>
      </div>

      {showAdd && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 px-4">
          <div className="w-full max-w-md rounded-2xl border border-slate-200 bg-white shadow-xl">
            <div className="flex items-center justify-between border-b border-slate-100 px-5 py-4">
              <span className="text-sm font-bold text-slate-900">Add Contact</span>
              <button onClick={() => setShowAdd(false)}><X size={18} className="text-slate-400" /></button>
            </div>
            <div className="space-y-3 px-5 py-4">
              <input value={form.email} onChange={e => setForm(f => ({...f, email: e.target.value}))} placeholder="Email *" className="w-full rounded-xl border border-slate-200 px-4 py-2 text-sm outline-none focus:border-slate-400" />
              <div className="grid grid-cols-2 gap-3">
                <input value={form.first_name} onChange={e => setForm(f => ({...f, first_name: e.target.value}))} placeholder="First name" className="rounded-xl border border-slate-200 px-4 py-2 text-sm outline-none focus:border-slate-400" />
                <input value={form.last_name} onChange={e => setForm(f => ({...f, last_name: e.target.value}))} placeholder="Last name" className="rounded-xl border border-slate-200 px-4 py-2 text-sm outline-none focus:border-slate-400" />
              </div>
              <input value={form.tags} onChange={e => setForm(f => ({...f, tags: e.target.value}))} placeholder="Tags (comma separated)" className="w-full rounded-xl border border-slate-200 px-4 py-2 text-sm outline-none focus:border-slate-400" />
            </div>
            <div className="flex justify-end gap-2 border-t border-slate-100 px-5 py-4">
              <button onClick={() => setShowAdd(false)} className="rounded-xl border border-slate-200 px-4 py-2 text-sm font-semibold text-slate-600">Cancel</button>
              <button onClick={() => void handleAdd()} disabled={saving || !form.email} className="rounded-xl bg-slate-950 px-4 py-2 text-sm font-bold text-white hover:bg-slate-800 disabled:opacity-40">
                {saving ? <Loader2 size={14} className="animate-spin" /> : 'Add'}
              </button>
            </div>
          </div>
        </div>
      )}

      {showImport && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 px-4">
          <div className="w-full max-w-sm rounded-2xl border border-slate-200 bg-white shadow-xl">
            <div className="flex items-center justify-between border-b border-slate-100 px-5 py-4">
              <span className="text-sm font-bold text-slate-900">Import Contacts (CSV)</span>
              <button onClick={() => setShowImport(false)}><X size={18} className="text-slate-400" /></button>
            </div>
            <div className="px-5 py-4 space-y-3">
              <p className="text-xs text-slate-500">CSV must have an <code className="bg-slate-100 px-1 rounded">email</code> column. Optional: <code className="bg-slate-100 px-1 rounded">first_name</code>, <code className="bg-slate-100 px-1 rounded">last_name</code>.</p>
              <input ref={fileRef} type="file" accept=".csv,text/csv" onChange={e => void handleCsvImport(e)} className="w-full text-sm text-slate-600 file:mr-3 file:rounded-lg file:border-0 file:bg-slate-100 file:px-3 file:py-1.5 file:text-xs file:font-semibold hover:file:bg-slate-200" />
            </div>
            <div className="flex justify-end border-t border-slate-100 px-5 py-4">
              <button onClick={() => setShowImport(false)} className="rounded-xl border border-slate-200 px-4 py-2 text-sm font-semibold text-slate-600">Cancel</button>
            </div>
          </div>
        </div>
      )}

      <div className="rounded-2xl border border-slate-200 bg-white overflow-hidden">
        {loading ? (
          <div className="flex items-center justify-center py-16 text-slate-400"><Loader2 size={20} className="animate-spin mr-2" /> Loading…</div>
        ) : contacts.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-16 text-slate-400">
            <Users size={32} className="mb-3 opacity-30" />
            <p className="text-sm font-semibold">No contacts yet</p>
            <p className="text-xs mt-1">Add your first contact or import a CSV</p>
          </div>
        ) : (
          <table className="w-full text-sm">
            <thead className="border-b border-slate-100">
              <tr className="text-xs font-semibold text-slate-500">
                <th className="px-4 py-3 text-left">Email</th>
                <th className="px-4 py-3 text-left">Name</th>
                <th className="px-4 py-3 text-left">Tags</th>
                <th className="px-4 py-3 text-left">Status</th>
                <th className="px-4 py-3 text-left">Added</th>
                <th className="px-4 py-3" />
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-50">
              {contacts.map(c => (
                <tr key={c.id} className="hover:bg-slate-50">
                  <td className="px-4 py-3 font-medium text-slate-800">{c.email}</td>
                  <td className="px-4 py-3 text-slate-600">{[c.first_name, c.last_name].filter(Boolean).join(' ') || '—'}</td>
                  <td className="px-4 py-3">
                    <div className="flex flex-wrap gap-1">
                      {c.tags?.map(t => <span key={t} className="rounded-full bg-slate-100 px-2 py-0.5 text-xs text-slate-600">{t}</span>)}
                    </div>
                  </td>
                  <td className="px-4 py-3">
                    <span className={`rounded-full px-2 py-0.5 text-xs font-semibold ${c.subscribed ? 'bg-emerald-50 text-emerald-700' : 'bg-red-50 text-red-600'}`}>
                      {c.subscribed ? 'Subscribed' : 'Unsubscribed'}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-slate-500">{formatDate(c.created_at)}</td>
                  <td className="px-4 py-3">
                    <div className="relative">
                      <button onClick={() => setMenuOpen(menuOpen === c.id ? null : c.id)} className="flex h-8 w-8 items-center justify-center rounded-lg text-slate-400 hover:bg-slate-100">
                        <MoreHorizontal size={14} />
                      </button>
                      {menuOpen === c.id && (
                        <div className="absolute right-0 top-full z-10 mt-1 w-40 rounded-xl border border-slate-200 bg-white py-1 shadow-lg">
                          {c.subscribed && (
                            <button onClick={() => { setMenuOpen(null); void handleUnsubscribe(c); }} className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm text-slate-700 hover:bg-slate-50">
                              <X size={13} /> Unsubscribe
                            </button>
                          )}
                          <button onClick={() => { setMenuOpen(null); void handleDelete(c.id); }} className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm text-red-600 hover:bg-red-50">
                            <Trash2 size={13} /> Delete
                          </button>
                        </div>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
      <p className="text-xs text-slate-400">{contacts.length} contact{contacts.length !== 1 ? 's' : ''}</p>
    </div>
  );
}

// ─── Segments Tab ────────────────────────────────────────────────────────────

function SegmentsTab() {
  const [segments, setSegments] = useState<MailingSegment[]>([]);
  const [loading, setLoading] = useState(true);
  const [showAdd, setShowAdd] = useState(false);
  const [name, setName] = useState('');
  const [saving, setSaving] = useState(false);

  const load = async () => {
    setLoading(true);
    try { setSegments(await mailingService.listSegments()); } catch { /* silent */ } finally { setLoading(false); }
  };

  useEffect(() => { void load(); }, []);

  const handleAdd = async () => {
    if (!name.trim()) return;
    setSaving(true);
    try { await mailingService.createSegment({ name: name.trim() }); setName(''); setShowAdd(false); await load(); }
    catch { /* silent */ } finally { setSaving(false); }
  };

  const handleDelete = async (id: string) => {
    if (!confirm('Delete this segment?')) return;
    await mailingService.deleteSegment(id); await load();
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <p className="text-sm text-slate-500">Group your contacts by shared properties.</p>
        <button onClick={() => setShowAdd(true)} className="flex items-center gap-2 rounded-xl bg-slate-950 px-4 py-2 text-sm font-semibold text-white hover:bg-slate-800">
          <Plus size={14} /> New Segment
        </button>
      </div>

      {showAdd && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 px-4">
          <div className="w-full max-w-sm rounded-2xl border border-slate-200 bg-white shadow-xl">
            <div className="flex items-center justify-between border-b border-slate-100 px-5 py-4">
              <span className="text-sm font-bold">New Segment</span>
              <button onClick={() => setShowAdd(false)}><X size={18} className="text-slate-400" /></button>
            </div>
            <div className="px-5 py-4">
              <input value={name} onChange={e => setName(e.target.value)} placeholder="Segment name" className="w-full rounded-xl border border-slate-200 px-4 py-2 text-sm outline-none focus:border-slate-400" />
            </div>
            <div className="flex justify-end gap-2 border-t border-slate-100 px-5 py-4">
              <button onClick={() => setShowAdd(false)} className="rounded-xl border border-slate-200 px-4 py-2 text-sm font-semibold text-slate-600">Cancel</button>
              <button onClick={() => void handleAdd()} disabled={saving || !name.trim()} className="rounded-xl bg-slate-950 px-4 py-2 text-sm font-bold text-white disabled:opacity-40">
                {saving ? <Loader2 size={14} className="animate-spin" /> : 'Create'}
              </button>
            </div>
          </div>
        </div>
      )}

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {loading ? (
          <div className="col-span-full flex justify-center py-12 text-slate-400"><Loader2 size={20} className="animate-spin" /></div>
        ) : segments.length === 0 ? (
          <div className="col-span-full flex flex-col items-center py-16 text-slate-400">
            <Tag size={32} className="mb-3 opacity-30" />
            <p className="text-sm font-semibold">No segments yet</p>
          </div>
        ) : segments.map(s => (
          <div key={s.id} className="rounded-2xl border border-slate-200 bg-white p-5">
            <div className="flex items-start justify-between gap-2">
              <div>
                <div className="text-sm font-bold text-slate-900">{s.name}</div>
                <div className="text-xs text-slate-400 mt-1">{formatDate(s.created_at)}</div>
              </div>
              <button onClick={() => void handleDelete(s.id)} className="text-slate-400 hover:text-red-500"><Trash2 size={14} /></button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

// ─── Campaigns Tab ───────────────────────────────────────────────────────────

function CampaignsTab() {
  const [campaigns, setCampaigns] = useState<MailingCampaign[]>([]);
  const [segments, setSegments] = useState<MailingSegment[]>([]);
  const [loading, setLoading] = useState(true);
  const [showAdd, setShowAdd] = useState(false);
  const [form, setForm] = useState({ name: '', subject: '', preview_text: '', segment_id: '', content: '' });
  const [saving, setSaving] = useState(false);

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
      await mailingService.createCampaign({ ...form, segment_id: form.segment_id || undefined });
      setForm({ name: '', subject: '', preview_text: '', segment_id: '', content: '' });
      setShowAdd(false); await load();
    } catch { /* silent */ } finally { setSaving(false); }
  };

  const handleDelete = async (id: string) => {
    if (!confirm('Delete this campaign?')) return;
    await mailingService.deleteCampaign(id); await load();
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <p className="text-sm text-slate-500">Create and send email campaigns to your contacts.</p>
        <button onClick={() => setShowAdd(true)} className="flex items-center gap-2 rounded-xl bg-slate-950 px-4 py-2 text-sm font-semibold text-white hover:bg-slate-800">
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
            <div className="space-y-3 px-5 py-4">
              <input value={form.name} onChange={e => setForm(f => ({...f, name: e.target.value}))} placeholder="Campaign name *" className="w-full rounded-xl border border-slate-200 px-4 py-2 text-sm outline-none focus:border-slate-400" />
              <input value={form.subject} onChange={e => setForm(f => ({...f, subject: e.target.value}))} placeholder="Email subject *" className="w-full rounded-xl border border-slate-200 px-4 py-2 text-sm outline-none focus:border-slate-400" />
              <input value={form.preview_text} onChange={e => setForm(f => ({...f, preview_text: e.target.value}))} placeholder="Preview text (optional)" className="w-full rounded-xl border border-slate-200 px-4 py-2 text-sm outline-none focus:border-slate-400" />
              <select value={form.segment_id} onChange={e => setForm(f => ({...f, segment_id: e.target.value}))} className="w-full rounded-xl border border-slate-200 px-4 py-2 text-sm outline-none focus:border-slate-400 bg-white">
                <option value="">All contacts (no segment)</option>
                {segments.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
              </select>
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
                  <td className="px-4 py-3 font-medium text-slate-800">{c.name}</td>
                  <td className="px-4 py-3 text-slate-600 max-w-xs truncate">{c.subject}</td>
                  <td className="px-4 py-3 text-slate-500">{c.segment_name || 'All contacts'}</td>
                  <td className="px-4 py-3">
                    <span className={`rounded-full px-2 py-0.5 text-xs font-semibold ${STATUS_BADGE[c.status] || 'bg-slate-100 text-slate-600'}`}>{c.status}</span>
                  </td>
                  <td className="px-4 py-3 text-slate-500">{formatDate(c.created_at)}</td>
                  <td className="px-4 py-3">
                    <button onClick={() => void handleDelete(c.id)} className="flex h-8 w-8 items-center justify-center rounded-lg text-slate-400 hover:bg-red-50 hover:text-red-500"><Trash2 size={14} /></button>
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

const TRIGGER_LABELS: Record<string, string> = {
  signup: 'New signup',
  unsubscribe: 'Unsubscribe',
  tag_added: 'Tag added',
  campaign_open: 'Email opened',
  campaign_click: 'Link clicked',
  date: 'Specific date',
};

function AutomationsTab() {
  const [automations, setAutomations] = useState<MailingAutomation[]>([]);
  const [loading, setLoading] = useState(true);
  const [showAdd, setShowAdd] = useState(false);
  const [form, setForm] = useState({ name: '', trigger_type: 'signup' });
  const [saving, setSaving] = useState(false);

  const load = async () => {
    setLoading(true);
    try { setAutomations(await mailingService.listAutomations()); } catch { /* silent */ } finally { setLoading(false); }
  };

  useEffect(() => { void load(); }, []);

  const handleAdd = async () => {
    if (!form.name) return;
    setSaving(true);
    try { await mailingService.createAutomation(form); setForm({ name: '', trigger_type: 'signup' }); setShowAdd(false); await load(); }
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
          <div className="w-full max-w-sm rounded-2xl border border-slate-200 bg-white shadow-xl">
            <div className="flex items-center justify-between border-b border-slate-100 px-5 py-4">
              <span className="text-sm font-bold">New Automation</span>
              <button onClick={() => setShowAdd(false)}><X size={18} className="text-slate-400" /></button>
            </div>
            <div className="space-y-3 px-5 py-4">
              <input value={form.name} onChange={e => setForm(f => ({...f, name: e.target.value}))} placeholder="Automation name *" className="w-full rounded-xl border border-slate-200 px-4 py-2 text-sm outline-none focus:border-slate-400" />
              <select value={form.trigger_type} onChange={e => setForm(f => ({...f, trigger_type: e.target.value}))} className="w-full rounded-xl border border-slate-200 px-4 py-2 text-sm outline-none focus:border-slate-400 bg-white">
                {Object.entries(TRIGGER_LABELS).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
              </select>
            </div>
            <div className="flex justify-end gap-2 border-t border-slate-100 px-5 py-4">
              <button onClick={() => setShowAdd(false)} className="rounded-xl border border-slate-200 px-4 py-2 text-sm font-semibold text-slate-600">Cancel</button>
              <button onClick={() => void handleAdd()} disabled={saving || !form.name} className="rounded-xl bg-slate-950 px-4 py-2 text-sm font-bold text-white disabled:opacity-40">
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

// ─── Main Mailing Page ───────────────────────────────────────────────────────

export default function Mailing() {
  const [tab, setTab] = useState<Tab>('contacts');

  return (
    <div className="space-y-6 pb-8">
      <div>
        <h1 className="text-4xl font-black tracking-[-0.04em] text-slate-950">Mailing</h1>
        <p className="mt-2 text-base text-slate-500">Manage contacts, build campaigns, and automate your email marketing.</p>
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
        {tab === 'contacts' && <ContactsTab />}
        {tab === 'segments' && <SegmentsTab />}
        {tab === 'campaigns' && <CampaignsTab />}
        {tab === 'automations' && <AutomationsTab />}
        {tab === 'analytics' && <AnalyticsTab />}
      </div>
    </div>
  );
}
