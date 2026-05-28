import React, { useState, useEffect, useCallback } from 'react';
import { Building2, Plus, Search, Globe, Phone, Mail, Users, TrendingUp, X, Edit2, Trash2, ChevronRight, DollarSign, Link, MessageSquare, PhoneCall, Calendar, FileText, Clock, ArrowUpRight, ArrowDownLeft, RefreshCw, Loader2 } from 'lucide-react';

const API = '/api/crm';
const tok = () => localStorage.getItem('auth_token') ?? '';
const authHeaders = () => ({ Authorization: `Bearer ${tok()}` });
const jsonHeaders = () => ({ 'Content-Type': 'application/json', Authorization: `Bearer ${tok()}` });

interface Company {
  id: string;
  name: string;
  domain: string | null;
  industry: string | null;
  size: string | null;
  website: string | null;
  phone: string | null;
  email: string | null;
  city: string | null;
  country: string | null;
  description: string | null;
  logo_url: string | null;
  contact_count: number;
  open_deals_count: number;
  open_deals_value: number;
  created_at: string;
}

interface Contact {
  id: string;
  email: string;
  first_name: string | null;
  last_name: string | null;
  phone: string | null;
  role: string | null;
  is_primary: boolean;
}

interface Deal {
  id: string;
  title: string;
  value: number;
  currency: string;
  status: string;
  stage_name: string | null;
  stage_color: string | null;
}

interface Activity {
  id: string;
  type: 'note' | 'call' | 'email' | 'meeting' | 'task' | 'whatsapp' | 'sms';
  title: string | null;
  body: string | null;
  outcome: string | null;
  duration: number | null;
  scheduled_at: string | null;
  completed_at: string | null;
  created_at: string;
  contact_email: string | null;
  contact_first_name: string | null;
  contact_last_name: string | null;
  gmail_message_id: string | null;
}

const INDUSTRY_OPTIONS = ['Technology','Finance','Healthcare','Retail','Manufacturing','Education','Media','Real Estate','Consulting','Other'];
const SIZE_OPTIONS = ['1-10','11-50','51-200','201-500','501-1000','1000+'];

function ActivityIcon({ type }: { type: Activity['type'] }) {
  const cfg: Record<Activity['type'], { icon: React.ReactNode; bg: string; color: string }> = {
    email:    { icon: <Mail className="w-3.5 h-3.5" />,        bg: 'bg-blue-50',   color: 'text-blue-500' },
    call:     { icon: <PhoneCall className="w-3.5 h-3.5" />,   bg: 'bg-green-50',  color: 'text-green-500' },
    note:     { icon: <FileText className="w-3.5 h-3.5" />,    bg: 'bg-yellow-50', color: 'text-yellow-600' },
    meeting:  { icon: <Calendar className="w-3.5 h-3.5" />,    bg: 'bg-purple-50', color: 'text-purple-500' },
    task:     { icon: <Clock className="w-3.5 h-3.5" />,       bg: 'bg-gray-100',  color: 'text-gray-500' },
    whatsapp: { icon: <MessageSquare className="w-3.5 h-3.5" />,bg: 'bg-emerald-50',color: 'text-emerald-500' },
    sms:      { icon: <MessageSquare className="w-3.5 h-3.5" />,bg: 'bg-gray-100',  color: 'text-gray-500' },
  };
  const { icon, bg, color } = cfg[type] ?? cfg.note;
  return <div className={`w-7 h-7 rounded-full ${bg} ${color} flex items-center justify-center flex-shrink-0`}>{icon}</div>;
}

function ActivityItem({ act }: { act: Activity }) {
  const [expanded, setExpanded] = useState(false);
  const isGmail = Boolean(act.gmail_message_id);
  const isSent = act.title?.startsWith('Sent: ');
  const displayTitle = act.title?.replace(/^(Sent|Received): /, '') ?? `${act.type.charAt(0).toUpperCase() + act.type.slice(1)} activity`;
  const when = new Date(act.created_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
  const contactName = [act.contact_first_name, act.contact_last_name].filter(Boolean).join(' ') || act.contact_email || '';
  return (
    <div className="flex gap-3 group">
      <ActivityIcon type={act.type} />
      <div className="flex-1 min-w-0 pb-4 border-b border-gray-50 last:border-0">
        <div className="flex items-start justify-between gap-2">
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-1.5 flex-wrap">
              <span className="text-sm font-medium text-gray-800 truncate">{displayTitle}</span>
              {isGmail && (
                <span className={`inline-flex items-center gap-0.5 text-xs px-1.5 py-0.5 rounded-full font-medium ${isSent ? 'bg-indigo-50 text-indigo-600' : 'bg-sky-50 text-sky-600'}`}>
                  {isSent ? <ArrowUpRight className="w-3 h-3" /> : <ArrowDownLeft className="w-3 h-3" />}
                  {isSent ? 'Sent' : 'Received'}
                </span>
              )}
            </div>
            {contactName && <p className="text-xs text-gray-400 mt-0.5">{contactName}</p>}
          </div>
          <span className="text-xs text-gray-400 flex-shrink-0 mt-0.5">{when}</span>
        </div>
        {act.body && (
          <div className="mt-1">
            <p className={`text-xs text-gray-500 ${!expanded ? 'line-clamp-2' : ''}`}>{act.body}</p>
            {act.body.length > 120 && (
              <button onClick={() => setExpanded(e => !e)} className="text-xs text-[#5b6cf9] mt-0.5 hover:underline">
                {expanded ? 'Show less' : 'Show more'}
              </button>
            )}
          </div>
        )}
        {act.outcome && <p className="text-xs text-gray-400 mt-1">Outcome: {act.outcome}</p>}
      </div>
    </div>
  );
}

function CompanyInitials({ name }: { name: string }) {
  const parts = name.trim().split(' ');
  const initials = parts.length >= 2 ? parts[0][0] + parts[1][0] : parts[0].slice(0, 2);
  return (
    <div className="w-10 h-10 rounded-lg bg-indigo-100 flex items-center justify-center flex-shrink-0">
      <span className="text-sm font-semibold text-indigo-600">{initials.toUpperCase()}</span>
    </div>
  );
}

function formatCurrency(value: number, currency = 'USD') {
  return new Intl.NumberFormat('en-US', { style: 'currency', currency, maximumFractionDigits: 0 }).format(value);
}

export default function CRMCompanies() {
  const [companies, setCompanies] = useState<Company[]>([]);
  const [total, setTotal] = useState(0);
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState<Company & { contacts?: Contact[]; deals?: Deal[]; activities?: Activity[] } | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [editingCompany, setEditingCompany] = useState<Company | null>(null);
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState('');
  const [form, setForm] = useState({ name: '', domain: '', industry: '', size: '', website: '', phone: '', email: '', city: '', country: '', description: '' });

  const [gmailConnected, setGmailConnected] = useState(false);
  const [gmailSync, setGmailSync] = useState<{ status: string; totalFetched: number; lastSyncedAt: string | null; errorMessage?: string | null; messageCount?: number } | null>(null);
  const [gmailSyncing, setGmailSyncing] = useState(false);

  useEffect(() => {
    fetch('/api/accounts', { headers: authHeaders() })
      .then(r => r.json()).catch(() => ({ data: [] }))
      .then(data => {
        const accounts: any[] = Array.isArray(data?.data) ? data.data : [];
        setGmailConnected(accounts.some((a: any) => a.platform === 'gmail' && a.connected));
      });
    fetch('/api/gmail/sync/status', { headers: authHeaders() })
      .then(r => r.json()).catch(() => null)
      .then(data => { if (data && data.status) setGmailSync(data); });
  }, []);

  const triggerGmailSync = async () => {
    setGmailSyncing(true);
    await fetch('/api/gmail/sync', { method: 'POST', headers: authHeaders() }).catch(() => {});
    const poll = async () => {
      const data = await fetch('/api/gmail/sync/status', { headers: authHeaders() }).then(r => r.json()).catch(() => null);
      if (!data) { setGmailSyncing(false); return; }
      setGmailSync(data);
      if (data.status === 'running') {
        setTimeout(poll, 2500);
      } else {
        setGmailSyncing(false);
        if (data.status === 'done') load();
      }
    };
    await poll();
  };

  const load = useCallback(async (q = search) => {
    setLoading(true);
    try {
      const params = new URLSearchParams({ limit: '50' });
      if (q) params.set('search', q);
      const r = await fetch(`${API}/companies?${params}`, { headers: authHeaders() });
      const data = await r.json();
      setCompanies(data.companies || []);
      setTotal(data.total || 0);
    } finally {
      setLoading(false);
    }
  }, [search]);

  useEffect(() => { load(); }, []);

  useEffect(() => {
    const t = setTimeout(() => load(search), 300);
    return () => clearTimeout(t);
  }, [search]);

  const openDetail = async (company: Company) => {
    setSelected(company as any);
    const [detailRes, activityRes] = await Promise.all([
      fetch(`${API}/companies/${company.id}`, { headers: authHeaders() }),
      fetch(`${API}/activities?company_id=${company.id}&limit=100`, { headers: authHeaders() }),
    ]);
    const detail = detailRes.ok ? await detailRes.json() : company;
    const activities = activityRes.ok ? await activityRes.json() : [];
    setSelected({ ...detail, activities });
  };

  const openCreate = () => {
    setEditingCompany(null);
    setForm({ name: '', domain: '', industry: '', size: '', website: '', phone: '', email: '', city: '', country: '', description: '' });
    setFormError('');
    setShowForm(true);
  };

  const openEdit = (company: Company) => {
    setEditingCompany(company);
    setForm({
      name: company.name,
      domain: company.domain || '',
      industry: company.industry || '',
      size: company.size || '',
      website: company.website || '',
      phone: company.phone || '',
      email: company.email || '',
      city: company.city || '',
      country: company.country || '',
      description: company.description || '',
    });
    setFormError('');
    setShowForm(true);
  };

  const saveCompany = async () => {
    if (!form.name.trim()) { setFormError('Company name is required'); return; }
    setSaving(true); setFormError('');
    try {
      const url = editingCompany ? `${API}/companies/${editingCompany.id}` : `${API}/companies`;
      const method = editingCompany ? 'PATCH' : 'POST';
      const r = await fetch(url, { method, headers: jsonHeaders(), body: JSON.stringify(form) });
      if (!r.ok) { setFormError((await r.json()).error || 'Save failed'); return; }
      setShowForm(false);
      load();
    } finally {
      setSaving(false);
    }
  };

  const deleteCompany = async (id: string) => {
    if (!confirm('Delete this company? This cannot be undone.')) return;
    await fetch(`${API}/companies/${id}`, { method: 'DELETE', headers: authHeaders() });
    if (selected?.id === id) setSelected(null);
    load();
  };

  return (
    <div className="flex h-full bg-gray-50">
      {/* Left: List */}
      <div className={`flex flex-col ${selected ? 'w-[420px] border-r border-gray-200' : 'flex-1'} bg-white`}>
        {/* Header */}
        <div className="px-6 py-5 border-b border-gray-100">
          <div className="flex items-center justify-between mb-4">
            <div>
              <h1 className="text-xl font-semibold text-gray-900">Companies</h1>
              <p className="text-sm text-gray-500 mt-0.5">{total} {total === 1 ? 'company' : 'companies'}</p>
            </div>
            <div className="flex items-center gap-2">
              {gmailConnected && (
                <div className="flex flex-col items-end gap-0.5">
                  <button
                    onClick={() => void triggerGmailSync()}
                    disabled={gmailSyncing || gmailSync?.status === 'running'}
                    className="flex items-center gap-1.5 px-3 py-2 border border-gray-200 text-gray-700 rounded-lg text-sm font-medium hover:bg-gray-50 transition-colors disabled:opacity-60"
                  >
                    {(gmailSyncing || gmailSync?.status === 'running')
                      ? <><Loader2 className="w-4 h-4 animate-spin" /> Syncing…</>
                      : <><RefreshCw className="w-4 h-4" /> Sync Gmail</>
                    }
                  </button>
                  {gmailSync && (
                    <span className="text-[10px] text-gray-400">
                      {(gmailSync.messageCount ?? 0) > 0
                        ? `${(gmailSync.messageCount ?? 0).toLocaleString()} emails in DB`
                        : gmailSync.status === 'done' ? 'No emails stored — re-sync' : ''}
                    </span>
                  )}
                </div>
              )}
              <button onClick={openCreate} className="flex items-center gap-2 px-4 py-2 bg-[#5b6cf9] text-white rounded-lg text-sm font-medium hover:bg-[#4a5be8] transition-colors">
                <Plus className="w-4 h-4" />
                Add Company
              </button>
            </div>
          </div>
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
            <input
              className="w-full pl-9 pr-4 py-2 bg-gray-50 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-[#5b6cf9]/20 focus:border-[#5b6cf9]"
              placeholder="Search companies..."
              value={search}
              onChange={e => setSearch(e.target.value)}
            />
          </div>
        </div>

        {/* Gmail sync progress / error banner */}
        {gmailConnected && (gmailSyncing || gmailSync?.status === 'running' || gmailSync?.status === 'error') && (() => {
          const isRunning = gmailSyncing || gmailSync?.status === 'running';
          const pct = Math.min(Math.round(((gmailSync?.totalFetched ?? 0) / 2000) * 100), 100);
          return (
            <div className={`shrink-0 border-b px-5 py-3 ${isRunning ? 'bg-indigo-50 border-indigo-100' : 'bg-red-50 border-red-100'}`}>
              {isRunning ? (
                <div className="flex items-center gap-3">
                  <Loader2 className="w-4 h-4 text-[#5b6cf9] animate-spin flex-shrink-0" />
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-gray-800">Scanning Gmail for companies…</p>
                    <div className="flex items-center gap-2 mt-1">
                      <div className="flex-1 h-1.5 rounded-full bg-indigo-100 overflow-hidden">
                        <div className="h-full rounded-full bg-[#5b6cf9] transition-all" style={{ width: `${pct}%` }} />
                      </div>
                      <span className="text-xs text-gray-400 flex-shrink-0">{gmailSync?.totalFetched ?? 0} / 2,000</span>
                    </div>
                  </div>
                </div>
              ) : (
                <div className="flex items-center justify-between gap-3">
                  <div className="flex items-center gap-2 min-w-0">
                    <Mail className="w-4 h-4 flex-shrink-0 text-red-500" />
                    <p className="text-sm text-gray-700 truncate">
                      <span className="font-medium text-red-700">Sync failed</span>
                      <span className="text-red-600"> — {gmailSync?.errorMessage || 'unknown error'}</span>
                    </p>
                  </div>
                  <button
                    onClick={() => void triggerGmailSync()}
                    className="flex items-center gap-1.5 px-3 py-1.5 text-white text-xs font-medium rounded-lg flex-shrink-0 bg-red-500 hover:bg-red-600 transition-colors"
                  >
                    <RefreshCw className="w-3 h-3" /> Retry
                  </button>
                </div>
              )}
            </div>
          );
        })()}

        {/* List */}
        <div className="flex-1 overflow-y-auto">
          {loading ? (
            <div className="flex items-center justify-center py-16 text-gray-400 text-sm">Loading...</div>
          ) : companies.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-16 px-6 text-center">
              <Building2 className="w-12 h-12 text-gray-200 mb-3" />
              <p className="text-gray-500 font-medium">No companies yet</p>
              <p className="text-gray-400 text-sm mt-1">Add your first company to start tracking deals and contacts</p>
              <button onClick={openCreate} className="mt-4 px-4 py-2 bg-[#5b6cf9] text-white rounded-lg text-sm font-medium hover:bg-[#4a5be8]">Add Company</button>
            </div>
          ) : (
            <div className="divide-y divide-gray-50">
              {companies.map(company => (
                <div
                  key={company.id}
                  onClick={() => openDetail(company)}
                  className={`flex items-center gap-3 px-6 py-4 cursor-pointer hover:bg-gray-50 transition-colors ${selected?.id === company.id ? 'bg-indigo-50' : ''}`}
                >
                  {company.logo_url
                    ? <img src={company.logo_url} alt="" className="w-10 h-10 rounded-lg object-cover flex-shrink-0" />
                    : <CompanyInitials name={company.name} />
                  }
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="font-medium text-gray-900 text-sm truncate">{company.name}</span>
                      {company.industry && <span className="text-xs text-gray-400 bg-gray-100 px-1.5 py-0.5 rounded">{company.industry}</span>}
                    </div>
                    <div className="flex items-center gap-3 mt-0.5">
                      {company.domain && <span className="text-xs text-gray-400 flex items-center gap-1"><Globe className="w-3 h-3" />{company.domain}</span>}
                      {company.city && <span className="text-xs text-gray-400">{company.city}{company.country ? `, ${company.country}` : ''}</span>}
                    </div>
                  </div>
                  <div className="flex items-center gap-4 flex-shrink-0 text-right">
                    <div>
                      <p className="text-xs text-gray-400">Contacts</p>
                      <p className="text-sm font-medium text-gray-700">{company.contact_count}</p>
                    </div>
                    {company.open_deals_value > 0 && (
                      <div>
                        <p className="text-xs text-gray-400">Pipeline</p>
                        <p className="text-sm font-medium text-emerald-600">{formatCurrency(company.open_deals_value)}</p>
                      </div>
                    )}
                    <ChevronRight className="w-4 h-4 text-gray-300" />
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Right: Detail panel */}
      {selected && (
        <div className="flex-1 flex flex-col overflow-hidden">
          <div className="px-8 py-6 border-b border-gray-100 bg-white">
            <div className="flex items-start justify-between">
              <div className="flex items-center gap-4">
                {selected.logo_url
                  ? <img src={selected.logo_url} alt="" className="w-14 h-14 rounded-xl object-cover" />
                  : <div className="w-14 h-14 rounded-xl bg-indigo-100 flex items-center justify-center"><span className="text-lg font-bold text-indigo-600">{selected.name.slice(0,2).toUpperCase()}</span></div>
                }
                <div>
                  <h2 className="text-xl font-semibold text-gray-900">{selected.name}</h2>
                  <div className="flex items-center gap-3 mt-1 flex-wrap">
                    {selected.industry && <span className="text-xs bg-indigo-50 text-indigo-600 px-2 py-0.5 rounded-full font-medium">{selected.industry}</span>}
                    {selected.size && <span className="text-xs text-gray-500">{selected.size} employees</span>}
                    {selected.city && <span className="text-xs text-gray-500">{selected.city}{selected.country ? `, ${selected.country}` : ''}</span>}
                  </div>
                </div>
              </div>
              <div className="flex items-center gap-2">
                <button onClick={() => openEdit(selected)} className="p-2 text-gray-400 hover:text-gray-600 hover:bg-gray-100 rounded-lg transition-colors"><Edit2 className="w-4 h-4" /></button>
                <button onClick={() => deleteCompany(selected.id)} className="p-2 text-gray-400 hover:text-red-500 hover:bg-red-50 rounded-lg transition-colors"><Trash2 className="w-4 h-4" /></button>
                <button onClick={() => setSelected(null)} className="p-2 text-gray-400 hover:text-gray-600 hover:bg-gray-100 rounded-lg transition-colors"><X className="w-4 h-4" /></button>
              </div>
            </div>

            {/* Stats row */}
            <div className="grid grid-cols-3 gap-4 mt-6">
              {[
                { icon: Users, label: 'Contacts', value: selected.contact_count || 0, color: 'text-blue-600 bg-blue-50' },
                { icon: TrendingUp, label: 'Open Deals', value: selected.open_deals_count || 0, color: 'text-violet-600 bg-violet-50' },
                { icon: DollarSign, label: 'Pipeline Value', value: formatCurrency(selected.open_deals_value || 0), color: 'text-emerald-600 bg-emerald-50' },
              ].map(({ icon: Icon, label, value, color }) => (
                <div key={label} className="bg-gray-50 rounded-xl p-4">
                  <div className={`w-8 h-8 rounded-lg ${color} flex items-center justify-center mb-2`}><Icon className="w-4 h-4" /></div>
                  <p className="text-xl font-semibold text-gray-900">{value}</p>
                  <p className="text-xs text-gray-500 mt-0.5">{label}</p>
                </div>
              ))}
            </div>
          </div>

          <div className="flex-1 overflow-y-auto p-8 space-y-6">
            {/* Contact info */}
            <div className="bg-white rounded-xl border border-gray-100 p-5">
              <h3 className="text-sm font-semibold text-gray-900 mb-4">Contact Information</h3>
              <div className="grid grid-cols-2 gap-4">
                {selected.website && <a href={selected.website} target="_blank" rel="noreferrer" className="flex items-center gap-2 text-sm text-[#5b6cf9] hover:underline"><Globe className="w-4 h-4" />{selected.website}</a>}
                {selected.email && <a href={`mailto:${selected.email}`} className="flex items-center gap-2 text-sm text-gray-600"><Mail className="w-4 h-4" />{selected.email}</a>}
                {selected.phone && <span className="flex items-center gap-2 text-sm text-gray-600"><Phone className="w-4 h-4" />{selected.phone}</span>}
                {selected.domain && <span className="flex items-center gap-2 text-sm text-gray-600"><Link className="w-4 h-4" />{selected.domain}</span>}
              </div>
              {selected.description && <p className="text-sm text-gray-500 mt-4 border-t border-gray-50 pt-4">{selected.description}</p>}
            </div>

            {/* Contacts */}
            {(selected.contacts?.length ?? 0) > 0 && (
              <div className="bg-white rounded-xl border border-gray-100 p-5">
                <h3 className="text-sm font-semibold text-gray-900 mb-3">People ({selected.contacts!.length})</h3>
                <div className="space-y-2">
                  {selected.contacts!.map(c => (
                    <div key={c.id} className="flex items-center gap-3 py-2 border-b border-gray-50 last:border-0">
                      <div className="w-8 h-8 rounded-full bg-gray-100 flex items-center justify-center flex-shrink-0">
                        <span className="text-xs font-medium text-gray-600">{(c.first_name?.[0] || c.email[0]).toUpperCase()}</span>
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium text-gray-800">{[c.first_name, c.last_name].filter(Boolean).join(' ') || c.email}</p>
                        <p className="text-xs text-gray-400">{c.email}{c.role ? ` · ${c.role}` : ''}</p>
                      </div>
                      {c.is_primary && <span className="text-xs bg-indigo-50 text-indigo-600 px-1.5 py-0.5 rounded">Primary</span>}
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Deals */}
            {(selected.deals?.length ?? 0) > 0 && (
              <div className="bg-white rounded-xl border border-gray-100 p-5">
                <h3 className="text-sm font-semibold text-gray-900 mb-3">Deals ({selected.deals!.length})</h3>
                <div className="space-y-2">
                  {selected.deals!.map(d => (
                    <div key={d.id} className="flex items-center gap-3 py-2 border-b border-gray-50 last:border-0">
                      {d.stage_color && <div className="w-2.5 h-2.5 rounded-full flex-shrink-0" style={{ background: d.stage_color }} />}
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium text-gray-800">{d.title}</p>
                        {d.stage_name && <p className="text-xs text-gray-400">{d.stage_name}</p>}
                      </div>
                      <div className="text-right flex-shrink-0">
                        <p className="text-sm font-medium text-gray-800">{formatCurrency(d.value, d.currency)}</p>
                        <span className={`text-xs px-1.5 py-0.5 rounded-full ${d.status === 'won' ? 'bg-emerald-50 text-emerald-600' : d.status === 'lost' ? 'bg-red-50 text-red-500' : 'bg-gray-100 text-gray-500'}`}>{d.status}</span>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Activity Timeline */}
            <div className="bg-white rounded-xl border border-gray-100 p-5">
              <div className="flex items-center justify-between mb-4">
                <h3 className="text-sm font-semibold text-gray-900">
                  Activity
                  {(selected.activities?.length ?? 0) > 0 && <span className="ml-1.5 text-xs text-gray-400 font-normal">({selected.activities!.length})</span>}
                </h3>
                {(selected.activities?.filter(a => a.type === 'email').length ?? 0) > 0 && (
                  <span className="text-xs text-gray-400 flex items-center gap-1">
                    <Mail className="w-3 h-3" />
                    {selected.activities!.filter(a => a.type === 'email').length} email{selected.activities!.filter(a => a.type === 'email').length !== 1 ? 's' : ''} from Gmail
                  </span>
                )}
              </div>
              {(selected.activities?.length ?? 0) === 0 ? (
                <p className="text-sm text-gray-400 text-center py-4">No activity yet. Sync your Gmail to see email history here.</p>
              ) : (
                <div className="space-y-0">
                  {selected.activities!.map(act => <ActivityItem key={act.id} act={act} />)}
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Create / Edit modal */}
      {showForm && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-lg max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between px-6 py-5 border-b border-gray-100">
              <h2 className="text-lg font-semibold text-gray-900">{editingCompany ? 'Edit Company' : 'New Company'}</h2>
              <button onClick={() => setShowForm(false)} className="p-1.5 text-gray-400 hover:text-gray-600 rounded-lg hover:bg-gray-100"><X className="w-5 h-5" /></button>
            </div>
            <div className="p-6 space-y-4">
              {formError && <p className="text-sm text-red-500 bg-red-50 px-3 py-2 rounded-lg">{formError}</p>}
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1.5">Company Name *</label>
                <input className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-[#5b6cf9]/20 focus:border-[#5b6cf9]" value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} placeholder="Acme Inc." />
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-medium text-gray-600 mb-1.5">Domain</label>
                  <input className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-[#5b6cf9]/20 focus:border-[#5b6cf9]" value={form.domain} onChange={e => setForm(f => ({ ...f, domain: e.target.value }))} placeholder="acme.com" />
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-600 mb-1.5">Website</label>
                  <input className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-[#5b6cf9]/20 focus:border-[#5b6cf9]" value={form.website} onChange={e => setForm(f => ({ ...f, website: e.target.value }))} placeholder="https://acme.com" />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-medium text-gray-600 mb-1.5">Industry</label>
                  <select className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-[#5b6cf9]/20 focus:border-[#5b6cf9] bg-white" value={form.industry} onChange={e => setForm(f => ({ ...f, industry: e.target.value }))}>
                    <option value="">Select...</option>
                    {INDUSTRY_OPTIONS.map(i => <option key={i} value={i}>{i}</option>)}
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-600 mb-1.5">Company Size</label>
                  <select className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-[#5b6cf9]/20 focus:border-[#5b6cf9] bg-white" value={form.size} onChange={e => setForm(f => ({ ...f, size: e.target.value }))}>
                    <option value="">Select...</option>
                    {SIZE_OPTIONS.map(s => <option key={s} value={s}>{s} employees</option>)}
                  </select>
                </div>
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-medium text-gray-600 mb-1.5">Email</label>
                  <input className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-[#5b6cf9]/20 focus:border-[#5b6cf9]" value={form.email} onChange={e => setForm(f => ({ ...f, email: e.target.value }))} placeholder="info@acme.com" />
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-600 mb-1.5">Phone</label>
                  <input className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-[#5b6cf9]/20 focus:border-[#5b6cf9]" value={form.phone} onChange={e => setForm(f => ({ ...f, phone: e.target.value }))} placeholder="+1 555 000 0000" />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-medium text-gray-600 mb-1.5">City</label>
                  <input className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-[#5b6cf9]/20 focus:border-[#5b6cf9]" value={form.city} onChange={e => setForm(f => ({ ...f, city: e.target.value }))} placeholder="New York" />
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-600 mb-1.5">Country</label>
                  <input className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-[#5b6cf9]/20 focus:border-[#5b6cf9]" value={form.country} onChange={e => setForm(f => ({ ...f, country: e.target.value }))} placeholder="United States" />
                </div>
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1.5">Description</label>
                <textarea className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-[#5b6cf9]/20 focus:border-[#5b6cf9] resize-none" rows={3} value={form.description} onChange={e => setForm(f => ({ ...f, description: e.target.value }))} placeholder="Brief description..." />
              </div>
            </div>
            <div className="flex items-center justify-end gap-3 px-6 py-4 border-t border-gray-100">
              <button onClick={() => setShowForm(false)} className="px-4 py-2 text-sm text-gray-600 hover:text-gray-800 hover:bg-gray-100 rounded-lg transition-colors">Cancel</button>
              <button onClick={saveCompany} disabled={saving} className="px-5 py-2 bg-[#5b6cf9] text-white text-sm font-medium rounded-lg hover:bg-[#4a5be8] disabled:opacity-50 transition-colors">
                {saving ? 'Saving...' : editingCompany ? 'Update Company' : 'Create Company'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
