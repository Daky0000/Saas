import { useCallback, useEffect, useRef, useState } from 'react';
import {
  Loader2,
  MoreHorizontal,
  Plus,
  Search,
  Tag,
  Trash2,
  Upload,
  Users,
  X,
} from 'lucide-react';
import {
  mailingService,
  type MailingContact,
  type MailingSegment,
} from '../services/mailingService';

type Tab = 'contacts' | 'segments';

const TABS: { id: Tab; label: string; icon: React.ElementType }[] = [
  { id: 'contacts', label: 'Contacts', icon: Users },
  { id: 'segments', label: 'Segments', icon: Tag },
];

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
  const [csvFile, setCsvFile] = useState<File | null>(null);
  const [importing, setImporting] = useState(false);
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

  const handleCsvImport = async () => {
    if (!csvFile) return;
    setImporting(true);
    try {
      const text = await csvFile.text();
      const lines = text.split('\n').filter(Boolean);
      const headers = lines[0].split(',').map(h => h.trim().toLowerCase().replace(/"/g, ''));
      const emailIdx = headers.indexOf('email');
      const firstIdx = headers.indexOf('first_name');
      const lastIdx = headers.indexOf('last_name');
      if (emailIdx === -1) { setMessage('CSV must have an "email" column'); setImporting(false); return; }
      const rows = lines.slice(1).map(l => {
        const cols = l.split(',').map(c => c.trim().replace(/"/g, ''));
        return { email: cols[emailIdx] || '', first_name: cols[firstIdx] || undefined, last_name: cols[lastIdx] || undefined };
      }).filter(r => r.email);
      const result = await mailingService.importContacts(rows);
      setMessage(`Imported ${result.imported}, skipped ${result.skipped}.`);
      setShowImport(false);
      setCsvFile(null);
      if (fileRef.current) fileRef.current.value = '';
      await load();
    } catch (e) { setMessage(e instanceof Error ? e.message : 'Import failed'); }
    finally { setImporting(false); }
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
              <button onClick={() => { setShowImport(false); setCsvFile(null); if (fileRef.current) fileRef.current.value = ''; }}><X size={18} className="text-slate-400" /></button>
            </div>
            <div className="px-5 py-4 space-y-3">
              <p className="text-xs text-slate-500">CSV must have an <code className="bg-slate-100 px-1 rounded">email</code> column. Optional: <code className="bg-slate-100 px-1 rounded">first_name</code>, <code className="bg-slate-100 px-1 rounded">last_name</code>.</p>
              <label className="flex flex-col items-center gap-2 rounded-xl border-2 border-dashed border-slate-200 px-4 py-6 cursor-pointer hover:border-slate-400 hover:bg-slate-50 transition-colors">
                <Upload size={20} className="text-slate-400" />
                <span className="text-sm font-semibold text-slate-700">{csvFile ? csvFile.name : 'Choose CSV file'}</span>
                <span className="text-xs text-slate-400">{csvFile ? `${(csvFile.size / 1024).toFixed(1)} KB` : 'Click to browse'}</span>
                <input ref={fileRef} type="file" accept=".csv,text/csv" className="hidden" onChange={e => setCsvFile(e.target.files?.[0] ?? null)} />
              </label>
            </div>
            <div className="flex justify-end gap-2 border-t border-slate-100 px-5 py-4">
              <button onClick={() => { setShowImport(false); setCsvFile(null); if (fileRef.current) fileRef.current.value = ''; }} className="rounded-xl border border-slate-200 px-4 py-2 text-sm font-semibold text-slate-600">Cancel</button>
              <button onClick={() => void handleCsvImport()} disabled={!csvFile || importing} className="flex items-center gap-2 rounded-xl bg-slate-950 px-4 py-2 text-sm font-bold text-white hover:bg-slate-800 disabled:opacity-40">
                {importing ? <Loader2 size={14} className="animate-spin" /> : <Upload size={14} />}
                Import
              </button>
            </div>
          </div>
        </div>
      )}

      <div data-tour-id="mailing-contacts" className="rounded-2xl border border-slate-200 bg-white overflow-hidden">
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

// ─── Main Page ───────────────────────────────────────────────────────────────

export default function MarketingContacts() {
  const [tab, setTab] = useState<Tab>('contacts');

  return (
    <div className="space-y-6 pb-8">
      <div>
        <h1 className="text-4xl font-black tracking-[-0.04em] text-slate-950">Contacts</h1>
        <p className="mt-2 text-base text-slate-500">Manage your audience — subscribers, segments, and tags.</p>
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
      </div>
    </div>
  );
}
