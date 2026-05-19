import { useCallback, useEffect, useRef, useState } from 'react';
import {
  ChevronLeft,
  FileSpreadsheet,
  Link2,
  Link2Off,
  Loader2,
  MoreHorizontal,
  Plus,
  RefreshCw,
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
import { googleSheetsService, leadService, type Lead, type LeadGroup } from '../services/leadService';

type Tab = 'contacts' | 'segments' | 'leads';

const TABS: { id: Tab; label: string; icon: React.ElementType }[] = [
  { id: 'contacts', label: 'Contacts', icon: Users },
  { id: 'segments', label: 'Segments', icon: Tag },
  { id: 'leads', label: 'Leads', icon: FileSpreadsheet },
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
  const [message, setMessage] = useState<{ text: string; ok: boolean } | null>(null);
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
      await mailingService.createContact({
        email: form.email,
        first_name: form.first_name || undefined,
        last_name: form.last_name || undefined,
        tags: form.tags ? form.tags.split(',').map(t => t.trim()).filter(Boolean) : [],
      });
      setForm({ email: '', first_name: '', last_name: '', tags: '' });
      setShowAdd(false);
      setMessage({ text: 'Contact added.', ok: true });
      await load();
    } catch (e) { setMessage({ text: e instanceof Error ? e.message : 'Failed', ok: false }); }
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

  const closeImport = () => {
    setShowImport(false);
    setCsvFile(null);
    if (fileRef.current) fileRef.current.value = '';
  };

  const handleCsvImport = async () => {
    if (!csvFile) return;
    setImporting(true);
    try {
      const text = await csvFile.text();
      const lines = text.split(/\r?\n/).filter(l => l.trim());
      if (lines.length < 2) { setMessage({ text: 'CSV appears to be empty.', ok: false }); setImporting(false); return; }
      const headers = lines[0].split(',').map(h => h.trim().toLowerCase().replace(/"/g, ''));
      const emailIdx = headers.indexOf('email');
      const firstIdx = headers.indexOf('first_name');
      const lastIdx = headers.indexOf('last_name');
      if (emailIdx === -1) { setMessage({ text: 'CSV must have an "email" column.', ok: false }); setImporting(false); return; }
      if (firstIdx === -1) { setMessage({ text: 'CSV must have a "first_name" column.', ok: false }); setImporting(false); return; }
      if (lastIdx === -1) { setMessage({ text: 'CSV must have a "last_name" column.', ok: false }); setImporting(false); return; }
      const rows = lines.slice(1).map(l => {
        const cols = l.split(',').map(c => c.trim().replace(/"/g, ''));
        return {
          email: cols[emailIdx] || '',
          first_name: cols[firstIdx] || undefined,
          last_name: cols[lastIdx] || undefined,
        };
      }).filter(r => r.email && r.email.includes('@'));
      if (!rows.length) { setMessage({ text: 'No valid rows found in CSV.', ok: false }); setImporting(false); return; }
      const result = await mailingService.importContacts(rows);
      setMessage({ text: `Imported ${result.imported} contacts, skipped ${result.skipped}.`, ok: true });
      closeImport();
      await load();
    } catch (e) {
      setMessage({ text: e instanceof Error ? e.message : 'Import failed', ok: false });
    } finally { setImporting(false); }
  };

  return (
    <div className="space-y-4">
      {message && (
        <div className={`flex items-center justify-between rounded-xl px-4 py-3 text-sm ${message.ok ? 'bg-emerald-50 text-emerald-800 border border-emerald-200' : 'bg-red-50 text-red-800 border border-red-200'}`}>
          <span>{message.text}</span>
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
              <button onClick={closeImport}><X size={18} className="text-slate-400" /></button>
            </div>
            <div className="px-5 py-4 space-y-3">
              <div className="rounded-xl bg-amber-50 border border-amber-200 px-3 py-2 text-xs text-amber-800">
                CSV must have columns: <strong>email</strong>, <strong>first_name</strong>, <strong>last_name</strong>
              </div>
              <label className="flex flex-col items-center gap-2 rounded-xl border-2 border-dashed border-slate-200 px-4 py-6 cursor-pointer hover:border-slate-400 hover:bg-slate-50 transition-colors">
                <Upload size={20} className="text-slate-400" />
                <span className="text-sm font-semibold text-slate-700">{csvFile ? csvFile.name : 'Choose CSV file'}</span>
                <span className="text-xs text-slate-400">{csvFile ? `${(csvFile.size / 1024).toFixed(1)} KB` : 'Click to browse'}</span>
                <input ref={fileRef} type="file" accept=".csv,text/csv" className="hidden" onChange={e => setCsvFile(e.target.files?.[0] ?? null)} />
              </label>
            </div>
            <div className="flex justify-end gap-2 border-t border-slate-100 px-5 py-4">
              <button onClick={closeImport} className="rounded-xl border border-slate-200 px-4 py-2 text-sm font-semibold text-slate-600">Cancel</button>
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

// ─── Leads Tab ───────────────────────────────────────────────────────────────

type LeadView = { type: 'groups' } | { type: 'detail'; group: LeadGroup };

function LeadsTab() {
  const [view, setView] = useState<LeadView>({ type: 'groups' });

  return view.type === 'groups'
    ? <LeadGroupsList onOpen={g => setView({ type: 'detail', group: g })} />
    : <LeadGroupDetail group={view.group} onBack={() => setView({ type: 'groups' })} />;
}

function LeadGroupsList({ onOpen }: { onOpen: (g: LeadGroup) => void }) {
  const [groups, setGroups] = useState<LeadGroup[]>([]);
  const [loading, setLoading] = useState(true);
  const [showNew, setShowNew] = useState(false);
  const [newName, setNewName] = useState('');
  const [saving, setSaving] = useState(false);
  const [bulkImporting, setBulkImporting] = useState(false);
  const [message, setMessage] = useState<{ text: string; ok: boolean } | null>(null);
  const xlsxRef = useRef<HTMLInputElement>(null);

  const load = async () => {
    setLoading(true);
    try { setGroups(await leadService.listGroups()); } catch { /* silent */ } finally { setLoading(false); }
  };

  useEffect(() => { void load(); }, []);

  const handleCreate = async () => {
    if (!newName.trim()) return;
    setSaving(true);
    try {
      const g = await leadService.createGroup(newName.trim());
      setNewName(''); setShowNew(false);
      setGroups(prev => [g, ...prev]);
    } catch (e) { setMessage({ text: e instanceof Error ? e.message : 'Failed', ok: false }); }
    finally { setSaving(false); }
  };

  const handleDelete = async (id: string) => {
    if (!confirm('Delete this lead group and all its leads?')) return;
    await leadService.deleteGroup(id);
    setGroups(prev => prev.filter(g => g.id !== id));
  };

  const handleBulkExcel = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (xlsxRef.current) xlsxRef.current.value = '';
    setBulkImporting(true);
    try {
      const sheets = await leadService.parseExcelFile(file);
      if (!sheets.length) { setMessage({ text: 'No data found in the file.', ok: false }); return; }
      const results = await leadService.bulkImportSheets(sheets);
      const total = results.reduce((s, r) => s + r.imported, 0);
      setMessage({ text: `Created ${results.length} lead group${results.length !== 1 ? 's' : ''} with ${total} leads total.`, ok: true });
      await load();
    } catch (err) { setMessage({ text: err instanceof Error ? err.message : 'Import failed', ok: false }); }
    finally { setBulkImporting(false); }
  };

  return (
    <div className="space-y-4">
      {message && (
        <div className={`flex items-center justify-between rounded-xl px-4 py-3 text-sm ${message.ok ? 'bg-emerald-50 text-emerald-800 border border-emerald-200' : 'bg-red-50 text-red-800 border border-red-200'}`}>
          <span>{message.text}</span><button onClick={() => setMessage(null)}><X size={14} /></button>
        </div>
      )}
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <p className="text-sm text-slate-500">Organize prospects into lead groups. Each Excel sheet becomes a group.</p>
        <div className="flex gap-2">
          <label className={`flex items-center gap-2 rounded-xl border border-slate-200 bg-white px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50 cursor-pointer ${bulkImporting ? 'opacity-60 pointer-events-none' : ''}`}>
            {bulkImporting ? <Loader2 size={14} className="animate-spin" /> : <FileSpreadsheet size={14} />}
            Import Excel
            <input ref={xlsxRef} type="file" accept=".xlsx,.xls,.csv" className="hidden" onChange={e => void handleBulkExcel(e)} />
          </label>
          <button onClick={() => setShowNew(true)} className="flex items-center gap-2 rounded-xl bg-slate-950 px-4 py-2 text-sm font-semibold text-white hover:bg-slate-800">
            <Plus size={14} /> New Lead Group
          </button>
        </div>
      </div>

      {showNew && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 px-4">
          <div className="w-full max-w-sm rounded-2xl border border-slate-200 bg-white shadow-xl">
            <div className="flex items-center justify-between border-b border-slate-100 px-5 py-4">
              <span className="text-sm font-bold">New Lead Group</span>
              <button onClick={() => setShowNew(false)}><X size={18} className="text-slate-400" /></button>
            </div>
            <div className="px-5 py-4">
              <input value={newName} onChange={e => setNewName(e.target.value)} onKeyDown={e => e.key === 'Enter' && void handleCreate()} placeholder="Group name (e.g. Trade Show Q2)" className="w-full rounded-xl border border-slate-200 px-4 py-2 text-sm outline-none focus:border-slate-400" autoFocus />
            </div>
            <div className="flex justify-end gap-2 border-t border-slate-100 px-5 py-4">
              <button onClick={() => setShowNew(false)} className="rounded-xl border border-slate-200 px-4 py-2 text-sm font-semibold text-slate-600">Cancel</button>
              <button onClick={() => void handleCreate()} disabled={saving || !newName.trim()} className="rounded-xl bg-slate-950 px-4 py-2 text-sm font-bold text-white disabled:opacity-40">
                {saving ? <Loader2 size={14} className="animate-spin" /> : 'Create'}
              </button>
            </div>
          </div>
        </div>
      )}

      {loading ? (
        <div className="flex justify-center py-16 text-slate-400"><Loader2 size={20} className="animate-spin" /></div>
      ) : groups.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-20 text-slate-400">
          <FileSpreadsheet size={36} className="mb-3 opacity-30" />
          <p className="text-sm font-semibold">No lead groups yet</p>
          <p className="text-xs mt-1">Create a group and import a CSV or add leads manually</p>
        </div>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {groups.map(g => (
            <div key={g.id} onClick={() => onOpen(g)} className="relative rounded-2xl border border-slate-200 bg-white p-5 cursor-pointer hover:border-indigo-200 hover:bg-indigo-50/20 transition-all group">
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <div className="text-sm font-bold text-slate-900 truncate">{g.name}</div>
                  <div className="mt-1 flex items-center gap-3 text-xs text-slate-500">
                    <span className="font-semibold text-slate-800">{g.lead_count} lead{g.lead_count !== 1 ? 's' : ''}</span>
                    <span>·</span>
                    <span>{formatDate(g.created_at)}</span>
                  </div>
                  {g.fields?.length > 0 && (
                    <div className="mt-2 flex flex-wrap gap-1">
                      {g.fields.slice(0, 4).map(f => (
                        <span key={f} className="rounded-full bg-slate-100 px-2 py-0.5 text-xs text-slate-600">{f}</span>
                      ))}
                      {g.fields.length > 4 && <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs text-slate-500">+{g.fields.length - 4}</span>}
                    </div>
                  )}
                </div>
                <button
                  onClick={e => { e.stopPropagation(); void handleDelete(g.id); }}
                  className="shrink-0 text-slate-300 hover:text-red-500 opacity-0 group-hover:opacity-100 transition-opacity"
                >
                  <Trash2 size={14} />
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function LeadGroupDetail({ group: initialGroup, onBack }: { group: LeadGroup; onBack: () => void }) {
  const [group, setGroup] = useState(initialGroup);
  const [leads, setLeads] = useState<Lead[]>([]);
  const [loading, setLoading] = useState(true);
  const [showAddLead, setShowAddLead] = useState(false);
  const [showImport, setShowImport] = useState(false);
  const [showSync, setShowSync] = useState(false);
  const [syncFile, setSyncFile] = useState<File | null>(null);
  const [syncKeyField, setSyncKeyField] = useState('');
  const [syncing, setSyncing] = useState(false);
  const [showLinkSheet, setShowLinkSheet] = useState(false);
  const [gsConnected, setGsConnected] = useState<{ connected: boolean; email?: string } | null>(null);
  const [gsFiles, setGsFiles] = useState<{ id: string; name: string }[]>([]);
  const [gsSheets, setGsSheets] = useState<{ id: number; title: string }[]>([]);
  const [selectedFile, setSelectedFile] = useState('');
  const [selectedSheet, setSelectedSheet] = useState('');
  const [selectedSheetName, setSelectedSheetName] = useState('');
  const [linkKeyField, setLinkKeyField] = useState('');
  const [loadingGs, setLoadingGs] = useState(false);
  const [sheetSyncing, setSheetSyncing] = useState(false);
  const [csvFile, setCsvFile] = useState<File | null>(null);
  const [importing, setImporting] = useState(false);
  const [customFields, setCustomFields] = useState<string[]>(initialGroup.fields?.length ? initialGroup.fields : ['first_name', 'last_name', 'email']);
  const [newFieldName, setNewFieldName] = useState('');
  const [leadForm, setLeadForm] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<{ text: string; ok: boolean } | null>(null);
  const [search, setSearch] = useState('');
  const fileRef = useRef<HTMLInputElement>(null);
  const syncFileRef = useRef<HTMLInputElement>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const { group: g, leads: l } = await leadService.getGroupLeads(group.id);
      setGroup(g);
      setLeads(l);
      if (g.fields?.length) setCustomFields(g.fields);
    } catch { /* silent */ } finally { setLoading(false); }
  }, [group.id]);

  useEffect(() => { void load(); }, [load]);

  const closeImport = () => { setShowImport(false); setCsvFile(null); if (fileRef.current) fileRef.current.value = ''; };
  const closeSync = () => { setShowSync(false); setSyncFile(null); setSyncKeyField(''); if (syncFileRef.current) syncFileRef.current.value = ''; };

  const parseFileToRows = async (file: File): Promise<{ rows: Record<string, string>[]; fields: string[] }> => {
    if (file.name.match(/\.xlsx?$/i)) {
      const sheets = await leadService.parseExcelFile(file);
      if (!sheets.length) return { rows: [], fields: [] };
      return { rows: sheets[0].leads, fields: sheets[0].fields };
    }
    const text = await file.text();
    const lines = text.split(/\r?\n/).filter(l => l.trim());
    if (lines.length < 2) return { rows: [], fields: [] };
    const headers = lines[0].split(',').map(h => h.trim().replace(/"/g, ''));
    const rows: Record<string, string>[] = lines.slice(1).map(l => {
      const cols = l.split(',').map(c => c.trim().replace(/"/g, ''));
      const obj: Record<string, string> = {};
      headers.forEach((h, i) => { if (h) obj[h] = cols[i] || ''; });
      return obj;
    }).filter(r => Object.values(r).some(v => v));
    return { rows, fields: headers.filter(Boolean) };
  };

  const handleCsvImport = async () => {
    if (!csvFile) return;
    setImporting(true);
    try {
      const { rows } = await parseFileToRows(csvFile);
      if (!rows.length) { setMessage({ text: 'No valid rows found.', ok: false }); setImporting(false); return; }
      const imported = await leadService.importLeads(group.id, rows);
      setMessage({ text: `Imported ${imported} leads.`, ok: true });
      closeImport();
      await load();
    } catch (e) { setMessage({ text: e instanceof Error ? e.message : 'Import failed', ok: false }); }
    finally { setImporting(false); }
  };

  const handleSync = async () => {
    if (!syncFile || !syncKeyField) return;
    setSyncing(true);
    try {
      const { rows } = await parseFileToRows(syncFile);
      if (!rows.length) { setMessage({ text: 'No valid rows found.', ok: false }); setSyncing(false); return; }
      const { updated, added } = await leadService.syncLeads(group.id, rows, syncKeyField);
      setMessage({ text: `Sync complete — ${updated} updated, ${added} new leads added.`, ok: true });
      closeSync();
      await load();
    } catch (e) { setMessage({ text: e instanceof Error ? e.message : 'Sync failed', ok: false }); }
    finally { setSyncing(false); }
  };

  const addField = () => {
    const f = newFieldName.trim().toLowerCase().replace(/\s+/g, '_');
    if (!f || customFields.includes(f)) return;
    setCustomFields(prev => [...prev, f]);
    setNewFieldName('');
  };

  const openLinkSheet = async () => {
    setShowLinkSheet(true);
    setLoadingGs(true);
    try {
      const status = await googleSheetsService.getStatus();
      setGsConnected(status);
      if (status.connected) {
        const files = await googleSheetsService.listFiles();
        setGsFiles(files);
      }
    } catch { /* silent */ }
    finally { setLoadingGs(false); }
  };

  const handleConnectGoogle = async () => {
    try {
      const url = await googleSheetsService.getConnectUrl();
      window.open(url, 'gs_oauth', 'width=560,height=660,left=200,top=100');
      const onMessage = async (evt: MessageEvent) => {
        if (evt.data?.type === 'gs_success') {
          window.removeEventListener('message', onMessage);
          setLoadingGs(true);
          try {
            const status = await googleSheetsService.getStatus();
            setGsConnected(status);
            if (status.connected) {
              const files = await googleSheetsService.listFiles();
              setGsFiles(files);
            }
          } catch { /* silent */ }
          finally { setLoadingGs(false); }
        } else if (evt.data?.type === 'gs_error') {
          window.removeEventListener('message', onMessage);
          setMessage({ text: `Google sign-in failed: ${evt.data.payload}`, ok: false });
        }
      };
      window.addEventListener('message', onMessage);
      setTimeout(() => window.removeEventListener('message', onMessage), 300_000);
    } catch (e) { setMessage({ text: e instanceof Error ? e.message : 'Failed to connect', ok: false }); }
  };

  const handleSelectFile = async (fileId: string) => {
    setSelectedFile(fileId);
    setSelectedSheet('');
    setGsSheets([]);
    if (!fileId) return;
    try {
      const sheets = await googleSheetsService.listSheets(fileId);
      setGsSheets(sheets);
      if (sheets.length === 1) { setSelectedSheet(sheets[0].title); setSelectedSheetName(sheets[0].title); }
    } catch { /* silent */ }
  };

  const handleLinkSheet = async () => {
    if (!selectedFile || !selectedSheet) return;
    setLoadingGs(true);
    try {
      const fname = gsFiles.find(f => f.id === selectedFile)?.name || selectedFile;
      await googleSheetsService.linkSheet(group.id, selectedFile, selectedSheet, `${fname} › ${selectedSheetName || selectedSheet}`, linkKeyField);
      setGroup(prev => ({ ...prev, linked_sheet_id: selectedFile, linked_sheet_tab: selectedSheet, linked_sheet_name: `${fname} › ${selectedSheetName || selectedSheet}`, sheet_key_field: linkKeyField || null }));
      setShowLinkSheet(false);
      setMessage({ text: 'Google Sheet linked. Click "Sync Sheet" to import data.', ok: true });
    } catch (e) { setMessage({ text: e instanceof Error ? e.message : 'Failed to link', ok: false }); }
    finally { setLoadingGs(false); }
  };

  const handleSyncSheet = async () => {
    setSheetSyncing(true);
    try {
      const { updated, added } = await googleSheetsService.syncSheet(group.id);
      setMessage({ text: `Sync complete — ${updated} updated, ${added} new leads added.`, ok: true });
      await load();
    } catch (e) { setMessage({ text: e instanceof Error ? e.message : 'Sync failed', ok: false }); }
    finally { setSheetSyncing(false); }
  };

  const handleAddLead = async () => {
    setSaving(true);
    try {
      await leadService.addLead(group.id, leadForm);
      setLeadForm({});
      setShowAddLead(false);
      setMessage({ text: 'Lead added.', ok: true });
      await load();
    } catch (e) { setMessage({ text: e instanceof Error ? e.message : 'Failed', ok: false }); }
    finally { setSaving(false); }
  };

  const handleDelete = async (id: string) => {
    await leadService.deleteLead(id);
    setLeads(prev => prev.filter(l => l.id !== id));
  };

  const filtered = leads.filter(l =>
    !search || Object.values(l.data).some(v => String(v).toLowerCase().includes(search.toLowerCase()))
  );

  const displayFields = group.fields?.length ? group.fields : customFields;

  return (
    <div className="space-y-4">
      {message && (
        <div className={`flex items-center justify-between rounded-xl px-4 py-3 text-sm ${message.ok ? 'bg-emerald-50 text-emerald-800 border border-emerald-200' : 'bg-red-50 text-red-800 border border-red-200'}`}>
          <span>{message.text}</span><button onClick={() => setMessage(null)}><X size={14} /></button>
        </div>
      )}

      <div className="flex items-center gap-3 flex-wrap">
        <button onClick={onBack} className="flex items-center gap-1 text-sm text-slate-500 hover:text-slate-800 transition-colors">
          <ChevronLeft size={16} /> Back
        </button>
        <span className="text-slate-300">/</span>
        <span className="text-sm font-bold text-slate-900">{group.name}</span>
        <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs text-slate-600">{group.lead_count} leads</span>
        {group.linked_sheet_id ? (
          <div className="flex items-center gap-2 rounded-full bg-emerald-50 border border-emerald-200 px-3 py-1">
            <svg viewBox="0 0 24 24" className="h-3.5 w-3.5 shrink-0" fill="none"><rect width="24" height="24" rx="4" fill="#34A853"/><path d="M7 8h10M7 12h10M7 16h6" stroke="white" strokeWidth="1.8" strokeLinecap="round"/></svg>
            <span className="text-xs font-semibold text-emerald-800 truncate max-w-[160px]">{group.linked_sheet_name || group.linked_sheet_tab}</span>
            <button onClick={() => setShowLinkSheet(true)} className="text-emerald-500 hover:text-emerald-700"><Link2 size={12} /></button>
            {group.last_synced_at && <span className="text-xs text-emerald-600">· {formatDate(group.last_synced_at)}</span>}
          </div>
        ) : (
          <button onClick={() => void openLinkSheet()} className="flex items-center gap-1.5 rounded-full border border-slate-200 bg-white px-3 py-1 text-xs font-semibold text-slate-600 hover:border-emerald-300 hover:text-emerald-700 transition-colors">
            <svg viewBox="0 0 24 24" className="h-3.5 w-3.5 shrink-0" fill="none"><rect width="24" height="24" rx="4" fill="#34A853"/><path d="M7 8h10M7 12h10M7 16h6" stroke="white" strokeWidth="1.8" strokeLinecap="round"/></svg>
            Link Google Sheet
          </button>
        )}
      </div>

      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div className="relative flex-1 min-w-48">
          <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
          <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search leads…" className="w-full rounded-xl border border-slate-200 bg-white pl-9 pr-4 py-2 text-sm outline-none focus:border-slate-400" />
        </div>
        <div className="flex gap-2 flex-wrap">
          {group.linked_sheet_id && (
            <button onClick={() => void handleSyncSheet()} disabled={sheetSyncing} className="flex items-center gap-2 rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-2 text-sm font-semibold text-emerald-700 hover:bg-emerald-100 disabled:opacity-60">
              {sheetSyncing ? <Loader2 size={14} className="animate-spin" /> : <svg viewBox="0 0 24 24" className="h-3.5 w-3.5" fill="none"><rect width="24" height="24" rx="4" fill="#34A853"/><path d="M7 8h10M7 12h10M7 16h6" stroke="white" strokeWidth="1.8" strokeLinecap="round"/></svg>}
              Sync Sheet
            </button>
          )}
          <button onClick={() => setShowSync(true)} className="flex items-center gap-2 rounded-xl border border-slate-200 bg-white px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50">
            <RefreshCw size={14} /> Re-sync File
          </button>
          <button onClick={() => setShowImport(true)} className="flex items-center gap-2 rounded-xl border border-slate-200 bg-white px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50">
            <Upload size={14} /> Import
          </button>
          <button onClick={() => setShowAddLead(true)} className="flex items-center gap-2 rounded-xl bg-slate-950 px-4 py-2 text-sm font-semibold text-white hover:bg-slate-800">
            <Plus size={14} /> Add Lead
          </button>
        </div>
      </div>

      {/* Link Google Sheet modal */}
      {showLinkSheet && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 px-4">
          <div className="w-full max-w-md rounded-2xl border border-slate-200 bg-white shadow-xl">
            <div className="flex items-center justify-between border-b border-slate-100 px-5 py-4">
              <div className="flex items-center gap-2">
                <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none"><rect width="24" height="24" rx="4" fill="#34A853"/><path d="M7 8h10M7 12h10M7 16h6" stroke="white" strokeWidth="1.8" strokeLinecap="round"/></svg>
                <span className="text-sm font-bold">Link Google Sheet</span>
              </div>
              <button onClick={() => setShowLinkSheet(false)}><X size={18} className="text-slate-400" /></button>
            </div>
            <div className="px-5 py-4 space-y-4">
              {loadingGs && !gsConnected ? (
                <div className="flex justify-center py-6"><Loader2 size={20} className="animate-spin text-slate-400" /></div>
              ) : !gsConnected?.connected ? (
                <div className="space-y-3 text-center py-2">
                  <p className="text-sm text-slate-600">Connect your Google account to access your spreadsheets.</p>
                  <button onClick={() => void handleConnectGoogle()} className="flex items-center gap-2 mx-auto rounded-xl border border-slate-200 bg-white px-5 py-2.5 text-sm font-semibold text-slate-800 hover:bg-slate-50 shadow-sm">
                    <svg viewBox="0 0 24 24" className="h-4 w-4"><path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"/><path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"/><path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l3.66-2.84z"/><path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"/></svg>
                    Sign in with Google
                  </button>
                  <p className="text-xs text-slate-400">Complete sign-in in the popup window — the list will appear automatically.</p>
                </div>
              ) : (
                <div className="space-y-4">
                  <div className="flex items-center justify-between rounded-xl bg-emerald-50 border border-emerald-200 px-3 py-2">
                    <div className="text-xs text-emerald-700">Connected as <strong>{gsConnected.email}</strong></div>
                    <button onClick={async () => { await googleSheetsService.disconnect(); setGsConnected({ connected: false }); }} className="text-xs text-slate-400 hover:text-red-500 flex items-center gap-1"><Link2Off size={11} /> Disconnect</button>
                  </div>
                  <div>
                    <label className="mb-1.5 block text-xs font-semibold text-slate-500">Spreadsheet</label>
                    <select value={selectedFile} onChange={e => void handleSelectFile(e.target.value)} className="w-full rounded-xl border border-slate-200 px-3 py-2 text-sm outline-none focus:border-slate-400 bg-white">
                      <option value="">Choose a spreadsheet…</option>
                      {gsFiles.map(f => <option key={f.id} value={f.id}>{f.name}</option>)}
                    </select>
                  </div>
                  {gsSheets.length > 0 && (
                    <div>
                      <label className="mb-1.5 block text-xs font-semibold text-slate-500">Sheet / Tab</label>
                      <select value={selectedSheet} onChange={e => { setSelectedSheet(e.target.value); setSelectedSheetName(gsSheets.find(s => s.title === e.target.value)?.title || ''); }} className="w-full rounded-xl border border-slate-200 px-3 py-2 text-sm outline-none focus:border-slate-400 bg-white">
                        <option value="">Choose a tab…</option>
                        {gsSheets.map(s => <option key={s.id} value={s.title}>{s.title}</option>)}
                      </select>
                    </div>
                  )}
                  <div>
                    <label className="mb-1.5 block text-xs font-semibold text-slate-500">Key field for sync (unique column, e.g. email)</label>
                    <input value={linkKeyField} onChange={e => setLinkKeyField(e.target.value)} placeholder="e.g. email" list="link-fields" className="w-full rounded-xl border border-slate-200 px-3 py-2 text-sm outline-none focus:border-slate-400" />
                    <datalist id="link-fields">{group.fields?.map(f => <option key={f} value={f} />)}</datalist>
                    <p className="mt-1 text-xs text-slate-400">Used to update existing leads on each sync instead of creating duplicates. Leave blank to always append.</p>
                  </div>
                </div>
              )}
            </div>
            <div className="flex justify-end gap-2 border-t border-slate-100 px-5 py-4">
              <button onClick={() => setShowLinkSheet(false)} className="rounded-xl border border-slate-200 px-4 py-2 text-sm font-semibold text-slate-600">Cancel</button>
              {gsConnected?.connected && (
                <button onClick={() => void handleLinkSheet()} disabled={!selectedFile || !selectedSheet || loadingGs} className="flex items-center gap-2 rounded-xl bg-slate-950 px-4 py-2 text-sm font-bold text-white hover:bg-slate-800 disabled:opacity-40">
                  {loadingGs ? <Loader2 size={14} className="animate-spin" /> : <Link2 size={14} />}
                  Link Sheet
                </button>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Sync modal */}
      {showSync && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 px-4">
          <div className="w-full max-w-sm rounded-2xl border border-slate-200 bg-white shadow-xl">
            <div className="flex items-center justify-between border-b border-slate-100 px-5 py-4">
              <span className="text-sm font-bold">Re-sync from File</span>
              <button onClick={closeSync}><X size={18} className="text-slate-400" /></button>
            </div>
            <div className="px-5 py-4 space-y-4">
              <p className="text-xs text-slate-500">Upload the updated Excel or CSV file. Existing leads are updated by matching on a key field. New rows are added.</p>
              <label className="flex flex-col items-center gap-2 rounded-xl border-2 border-dashed border-slate-200 px-4 py-5 cursor-pointer hover:border-slate-400 hover:bg-slate-50 transition-colors">
                <FileSpreadsheet size={20} className="text-slate-400" />
                <span className="text-sm font-semibold text-slate-700">{syncFile ? syncFile.name : 'Choose Excel or CSV file'}</span>
                <span className="text-xs text-slate-400">{syncFile ? `${(syncFile.size / 1024).toFixed(1)} KB` : 'Click to browse'}</span>
                <input ref={syncFileRef} type="file" accept=".xlsx,.xls,.csv" className="hidden" onChange={e => { setSyncFile(e.target.files?.[0] ?? null); }} />
              </label>
              <div>
                <label className="mb-1 block text-xs font-semibold text-slate-500">Key field (unique column to match on)</label>
                <input
                  value={syncKeyField}
                  onChange={e => setSyncKeyField(e.target.value)}
                  placeholder="e.g. email or id"
                  list="sync-fields"
                  className="w-full rounded-xl border border-slate-200 px-4 py-2 text-sm outline-none focus:border-slate-400"
                />
                <datalist id="sync-fields">
                  {group.fields?.map(f => <option key={f} value={f} />)}
                </datalist>
                <p className="mt-1 text-xs text-slate-400">Rows matching this field value will be updated. Non-matching rows are added as new leads.</p>
              </div>
            </div>
            <div className="flex justify-end gap-2 border-t border-slate-100 px-5 py-4">
              <button onClick={closeSync} className="rounded-xl border border-slate-200 px-4 py-2 text-sm font-semibold text-slate-600">Cancel</button>
              <button onClick={() => void handleSync()} disabled={!syncFile || !syncKeyField || syncing} className="flex items-center gap-2 rounded-xl bg-slate-950 px-4 py-2 text-sm font-bold text-white hover:bg-slate-800 disabled:opacity-40">
                {syncing ? <Loader2 size={14} className="animate-spin" /> : <RefreshCw size={14} />}
                Sync
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Import modal */}
      {showImport && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 px-4">
          <div className="w-full max-w-sm rounded-2xl border border-slate-200 bg-white shadow-xl">
            <div className="flex items-center justify-between border-b border-slate-100 px-5 py-4">
              <span className="text-sm font-bold">Import Leads (CSV)</span>
              <button onClick={closeImport}><X size={18} className="text-slate-400" /></button>
            </div>
            <div className="px-5 py-4 space-y-3">
              <p className="text-xs text-slate-500">Any CSV format works — all column headers become fields. Existing fields in this group will be preserved.</p>
              <label className="flex flex-col items-center gap-2 rounded-xl border-2 border-dashed border-slate-200 px-4 py-6 cursor-pointer hover:border-slate-400 hover:bg-slate-50 transition-colors">
                <FileSpreadsheet size={20} className="text-slate-400" />
                <span className="text-sm font-semibold text-slate-700">{csvFile ? csvFile.name : 'Choose Excel or CSV file'}</span>
                <span className="text-xs text-slate-400">{csvFile ? `${(csvFile.size / 1024).toFixed(1)} KB` : 'Click to browse'}</span>
                <input ref={fileRef} type="file" accept=".xlsx,.xls,.csv" className="hidden" onChange={e => setCsvFile(e.target.files?.[0] ?? null)} />
              </label>
            </div>
            <div className="flex justify-end gap-2 border-t border-slate-100 px-5 py-4">
              <button onClick={closeImport} className="rounded-xl border border-slate-200 px-4 py-2 text-sm font-semibold text-slate-600">Cancel</button>
              <button onClick={() => void handleCsvImport()} disabled={!csvFile || importing} className="flex items-center gap-2 rounded-xl bg-slate-950 px-4 py-2 text-sm font-bold text-white hover:bg-slate-800 disabled:opacity-40">
                {importing ? <Loader2 size={14} className="animate-spin" /> : <Upload size={14} />}
                Import
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Add lead modal */}
      {showAddLead && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 px-4">
          <div className="w-full max-w-md rounded-2xl border border-slate-200 bg-white shadow-xl max-h-[90vh] flex flex-col">
            <div className="flex items-center justify-between border-b border-slate-100 px-5 py-4 shrink-0">
              <span className="text-sm font-bold">Add Lead</span>
              <button onClick={() => setShowAddLead(false)}><X size={18} className="text-slate-400" /></button>
            </div>
            <div className="overflow-y-auto px-5 py-4 space-y-3 flex-1">
              {customFields.map(f => (
                <div key={f}>
                  <label className="mb-1 block text-xs font-semibold text-slate-500 capitalize">{f.replace(/_/g, ' ')}</label>
                  <input
                    value={leadForm[f] || ''}
                    onChange={e => setLeadForm(prev => ({ ...prev, [f]: e.target.value }))}
                    placeholder={f.replace(/_/g, ' ')}
                    className="w-full rounded-xl border border-slate-200 px-4 py-2 text-sm outline-none focus:border-slate-400"
                  />
                </div>
              ))}
              <div className="pt-2 border-t border-slate-100">
                <p className="text-xs text-slate-400 mb-2">Add a custom field</p>
                <div className="flex gap-2">
                  <input
                    value={newFieldName}
                    onChange={e => setNewFieldName(e.target.value)}
                    onKeyDown={e => e.key === 'Enter' && addField()}
                    placeholder="field_name"
                    className="flex-1 rounded-xl border border-slate-200 px-3 py-1.5 text-xs outline-none focus:border-slate-400"
                  />
                  <button onClick={addField} className="rounded-xl border border-slate-200 px-3 py-1.5 text-xs font-semibold hover:bg-slate-50">Add</button>
                </div>
              </div>
            </div>
            <div className="flex justify-end gap-2 border-t border-slate-100 px-5 py-4 shrink-0">
              <button onClick={() => setShowAddLead(false)} className="rounded-xl border border-slate-200 px-4 py-2 text-sm font-semibold text-slate-600">Cancel</button>
              <button onClick={() => void handleAddLead()} disabled={saving} className="rounded-xl bg-slate-950 px-4 py-2 text-sm font-bold text-white disabled:opacity-40">
                {saving ? <Loader2 size={14} className="animate-spin" /> : 'Save Lead'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Leads table */}
      <div className="rounded-2xl border border-slate-200 bg-white overflow-auto">
        {loading ? (
          <div className="flex justify-center py-16 text-slate-400"><Loader2 size={20} className="animate-spin" /></div>
        ) : filtered.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-16 text-slate-400">
            <FileSpreadsheet size={32} className="mb-3 opacity-30" />
            <p className="text-sm font-semibold">{search ? 'No matching leads' : 'No leads yet'}</p>
            <p className="text-xs mt-1">{search ? 'Try a different search term' : 'Import a CSV or add leads manually'}</p>
          </div>
        ) : (
          <table className="w-full text-sm">
            <thead className="border-b border-slate-100">
              <tr className="text-xs font-semibold text-slate-500">
                {displayFields.map(f => (
                  <th key={f} className="px-4 py-3 text-left capitalize whitespace-nowrap">{f.replace(/_/g, ' ')}</th>
                ))}
                <th className="px-4 py-3 text-left">Added</th>
                <th className="px-4 py-3" />
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-50">
              {filtered.map(l => (
                <tr key={l.id} className="hover:bg-slate-50">
                  {displayFields.map(f => (
                    <td key={f} className="px-4 py-3 text-slate-700 max-w-[180px] truncate">{l.data[f] || '—'}</td>
                  ))}
                  <td className="px-4 py-3 text-slate-400 whitespace-nowrap">{formatDate(l.created_at)}</td>
                  <td className="px-4 py-3">
                    <button onClick={() => void handleDelete(l.id)} className="text-slate-300 hover:text-red-500"><Trash2 size={13} /></button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
      <p className="text-xs text-slate-400">{filtered.length} lead{filtered.length !== 1 ? 's' : ''}</p>
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
        <p className="mt-2 text-base text-slate-500">Manage your audience — subscribers, segments, and leads.</p>
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
        {tab === 'leads' && <LeadsTab />}
      </div>
    </div>
  );
}
