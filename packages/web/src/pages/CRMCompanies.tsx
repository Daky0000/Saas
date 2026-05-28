import React, { useState, useEffect, useCallback } from 'react';
import {
  Building2, Plus, Search, Globe, Mail, Users, X, Trash2,
  MessageSquare, PhoneCall, Calendar, FileText, Clock,
  ArrowUpRight, ArrowDownLeft, RefreshCw, Loader2, MoreHorizontal,
  ChevronDown, ChevronRight, StickyNote,
} from 'lucide-react';

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

const AVATAR_PALETTE = [
  { bg: 'bg-violet-100', text: 'text-violet-700' },
  { bg: 'bg-sky-100',    text: 'text-sky-700'    },
  { bg: 'bg-emerald-100',text: 'text-emerald-700' },
  { bg: 'bg-amber-100',  text: 'text-amber-700'  },
  { bg: 'bg-rose-100',   text: 'text-rose-700'   },
  { bg: 'bg-indigo-100', text: 'text-indigo-700' },
  { bg: 'bg-teal-100',   text: 'text-teal-700'   },
  { bg: 'bg-orange-100', text: 'text-orange-700' },
];

function paletteFor(name: string) {
  let h = 0;
  for (const c of name) h = (h * 31 + c.charCodeAt(0)) & 0xffff;
  return AVATAR_PALETTE[h % AVATAR_PALETTE.length];
}

function initials(name: string) {
  const parts = name.trim().split(/\s+/);
  return (parts.length >= 2 ? parts[0][0] + parts[1][0] : parts[0].slice(0, 2)).toUpperCase();
}

function Avatar({ name, round = false, size = 'w-9 h-9', textSize = 'text-sm' }: { name: string; round?: boolean; size?: string; textSize?: string }) {
  const { bg, text } = paletteFor(name);
  return (
    <div className={`${size} ${round ? 'rounded-full' : 'rounded-lg'} ${bg} ${text} flex items-center justify-center flex-shrink-0 font-semibold ${textSize}`}>
      {initials(name)}
    </div>
  );
}

function CompanyLogo({ name, domain, size = 'w-9 h-9', round = false }: { name: string; domain: string | null; size?: string; round?: boolean }) {
  const [state, setState] = React.useState<'try' | 'ok' | 'fallback'>('try');
  const url = domain ? `https://www.google.com/s2/favicons?domain=${encodeURIComponent(domain)}&sz=64` : null;

  React.useEffect(() => { setState(url ? 'try' : 'fallback'); }, [url]);

  if (!url || state === 'fallback') return <Avatar name={name} round={round} size={size} />;

  return (
    <>
      <img
        src={url}
        alt=""
        className={`${size} ${round ? 'rounded-full' : 'rounded-lg'} object-contain bg-white border border-gray-100 p-0.5 flex-shrink-0 ${state === 'ok' ? '' : 'hidden'}`}
        onLoad={e => {
          const img = e.currentTarget;
          if (img.naturalWidth < 20) setState('fallback');
          else setState('ok');
        }}
        onError={() => setState('fallback')}
      />
      {state === 'try' && <Avatar name={name} round={round} size={size} />}
    </>
  );
}

function formatCurrency(value: number, currency = 'USD') {
  return new Intl.NumberFormat('en-US', { style: 'currency', currency, maximumFractionDigits: 0 }).format(value);
}

function ActivityIcon({ type }: { type: Activity['type'] }) {
  const cfg: Record<Activity['type'], { icon: React.ReactNode; bg: string; color: string }> = {
    email:    { icon: <Mail className="w-3.5 h-3.5" />,         bg: 'bg-blue-50',    color: 'text-blue-500'   },
    call:     { icon: <PhoneCall className="w-3.5 h-3.5" />,    bg: 'bg-green-50',   color: 'text-green-500'  },
    note:     { icon: <FileText className="w-3.5 h-3.5" />,     bg: 'bg-yellow-50',  color: 'text-yellow-600' },
    meeting:  { icon: <Calendar className="w-3.5 h-3.5" />,     bg: 'bg-purple-50',  color: 'text-purple-500' },
    task:     { icon: <Clock className="w-3.5 h-3.5" />,        bg: 'bg-gray-100',   color: 'text-gray-500'   },
    whatsapp: { icon: <MessageSquare className="w-3.5 h-3.5" />,bg: 'bg-emerald-50', color: 'text-emerald-500'},
    sms:      { icon: <MessageSquare className="w-3.5 h-3.5" />,bg: 'bg-gray-100',   color: 'text-gray-500'   },
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
    <div className="flex gap-3 py-4 border-b border-gray-100 last:border-0">
      <ActivityIcon type={act.type} />
      <div className="flex-1 min-w-0">
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

type ActivityTab = 'All activities' | 'Notes' | 'Emails' | 'Calls' | 'Tasks' | 'Meetings';
const ACTIVITY_TABS: ActivityTab[] = ['All activities', 'Notes', 'Emails', 'Calls', 'Tasks', 'Meetings'];
const ACTIVITY_TAB_TYPE: Record<ActivityTab, Activity['type'] | null> = {
  'All activities': null,
  'Notes': 'note',
  'Emails': 'email',
  'Calls': 'call',
  'Tasks': 'task',
  'Meetings': 'meeting',
};

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

  const [tab, setTab] = useState<'companies' | 'contacts'>('companies');
  const [contacts, setContacts] = useState<{ id: string; email: string; first_name: string | null; last_name: string | null; domain: string }[]>([]);
  const [loadingContacts, setLoadingContacts] = useState(false);

  const [gmailConnected, setGmailConnected] = useState(false);
  const [gmailSync, setGmailSync] = useState<{ status: string; totalFetched: number; lastSyncedAt: string | null; errorMessage?: string | null; messageCount?: number } | null>(null);
  const [gmailSyncing, setGmailSyncing] = useState(false);

  const [activityTab, setActivityTab] = useState<ActivityTab>('All activities');
  const [contactsExpanded, setContactsExpanded] = useState(true);
  const [dealsExpanded, setDealsExpanded] = useState(true);

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

  const loadContacts = useCallback(async () => {
    setLoadingContacts(true);
    try {
      const r = await fetch('/api/gmail/contacts', { headers: authHeaders() });
      const data = await r.json();
      setContacts(data.contacts || []);
    } finally {
      setLoadingContacts(false);
    }
  }, []);

  useEffect(() => { if (tab === 'contacts') void loadContacts(); }, [tab, loadContacts]);
  useEffect(() => { load(); }, []);
  useEffect(() => {
    const t = setTimeout(() => load(search), 300);
    return () => clearTimeout(t);
  }, [search]);

  const openDetail = async (company: Company) => {
    setSelected(company as any);
    setActivityTab('All activities');
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

  const filteredActivities = (selected?.activities ?? []).filter(a => {
    const t = ACTIVITY_TAB_TYPE[activityTab];
    return t === null || a.type === t;
  });

  const isRunning = gmailSyncing || gmailSync?.status === 'running';
  const pct = Math.min(Math.round(((gmailSync?.totalFetched ?? 0) / 2000) * 100), 100);

  return (
    <div className="flex h-full bg-gray-50 overflow-hidden">

      {/* ── Left panel: list ── */}
      <div className={`flex flex-col ${selected ? 'w-[360px]' : 'flex-1'} bg-white border-r border-gray-100 flex-shrink-0`}>

        {/* Header */}
        <div className="px-5 py-4 border-b border-gray-100">
          <div className="flex items-center justify-between mb-3">
            {/* Tab switcher */}
            <div className="flex items-center gap-0 border border-gray-200 rounded-lg overflow-hidden">
              <button
                onClick={() => setTab('companies')}
                className={`px-3.5 py-1.5 text-sm font-medium transition-colors ${tab === 'companies' ? 'bg-[#5b6cf9] text-white' : 'text-gray-500 hover:text-gray-700 hover:bg-gray-50'}`}
              >
                Companies <span className={`ml-0.5 text-xs ${tab === 'companies' ? 'text-indigo-200' : 'text-gray-400'}`}>{total || ''}</span>
              </button>
              <button
                onClick={() => setTab('contacts')}
                className={`px-3.5 py-1.5 text-sm font-medium border-l border-gray-200 transition-colors ${tab === 'contacts' ? 'bg-[#5b6cf9] text-white' : 'text-gray-500 hover:text-gray-700 hover:bg-gray-50'}`}
              >
                Contacts <span className={`ml-0.5 text-xs ${tab === 'contacts' ? 'text-indigo-200' : 'text-gray-400'}`}>{contacts.length || ''}</span>
              </button>
            </div>

            {/* Actions */}
            <div className="flex items-center gap-1.5">
              {gmailConnected && (
                <button
                  onClick={() => void triggerGmailSync()}
                  disabled={isRunning}
                  className="flex items-center gap-1 px-2.5 py-1.5 border border-gray-200 text-gray-600 rounded-lg text-xs font-medium hover:bg-gray-50 transition-colors disabled:opacity-60"
                >
                  {isRunning ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <RefreshCw className="w-3.5 h-3.5" />}
                  {isRunning ? 'Syncing…' : 'Sync Gmail'}
                </button>
              )}
              <button
                onClick={openCreate}
                className="flex items-center gap-1 px-2.5 py-1.5 bg-[#5b6cf9] text-white rounded-lg text-xs font-medium hover:bg-[#4a5be8] transition-colors"
              >
                <Plus className="w-3.5 h-3.5" /> Add
              </button>
            </div>
          </div>

          {/* Search */}
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-gray-400" />
            <input
              className="w-full pl-8 pr-3 py-1.5 bg-gray-50 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-[#5b6cf9]/20 focus:border-[#5b6cf9]"
              placeholder={tab === 'companies' ? 'Search companies…' : 'Search contacts…'}
              value={search}
              onChange={e => setSearch(e.target.value)}
            />
          </div>
        </div>

        {/* Gmail sync banner */}
        {gmailConnected && (isRunning || gmailSync?.status === 'error') && (
          <div className={`shrink-0 border-b px-4 py-2.5 ${isRunning ? 'bg-indigo-50 border-indigo-100' : 'bg-red-50 border-red-100'}`}>
            {isRunning ? (
              <div className="flex items-center gap-2.5">
                <Loader2 className="w-3.5 h-3.5 text-[#5b6cf9] animate-spin flex-shrink-0" />
                <div className="flex-1 min-w-0">
                  <p className="text-xs font-medium text-gray-700">Scanning Gmail for companies…</p>
                  <div className="flex items-center gap-2 mt-1">
                    <div className="flex-1 h-1 rounded-full bg-indigo-100 overflow-hidden">
                      <div className="h-full rounded-full bg-[#5b6cf9] transition-all" style={{ width: `${pct}%` }} />
                    </div>
                    <span className="text-[10px] text-gray-400 flex-shrink-0">{pct}%</span>
                  </div>
                </div>
              </div>
            ) : (
              <div className="flex items-center justify-between gap-2">
                <p className="text-xs text-red-600 font-medium truncate">Sync failed — {gmailSync?.errorMessage || 'unknown error'}</p>
                <button onClick={() => void triggerGmailSync()} className="text-xs px-2 py-1 bg-red-500 text-white rounded-md flex-shrink-0 hover:bg-red-600">Retry</button>
              </div>
            )}
          </div>
        )}

        {/* List body */}
        <div className="flex-1 overflow-y-auto">
          {tab === 'companies' ? (
            <>
              {/* Table column headers (only when full-width) */}
              {!selected && (
                <div className="flex items-center px-5 py-2 border-b border-gray-100 bg-gray-50 sticky top-0 z-10">
                  <div className="flex-1 text-[11px] font-semibold text-gray-400 uppercase tracking-wide">Name</div>
                  <div className="w-32 text-[11px] font-semibold text-gray-400 uppercase tracking-wide hidden lg:block">Domain</div>
                  <div className="w-24 text-[11px] font-semibold text-gray-400 uppercase tracking-wide hidden xl:block">City</div>
                  <div className="w-20 text-[11px] font-semibold text-gray-400 uppercase tracking-wide text-right">Contacts</div>
                  <div className="w-24 text-[11px] font-semibold text-gray-400 uppercase tracking-wide text-right hidden lg:block">Pipeline</div>
                </div>
              )}

              {loading ? (
                <div className="flex items-center justify-center py-16 text-gray-400 text-sm gap-2"><Loader2 className="w-4 h-4 animate-spin" />Loading…</div>
              ) : companies.length === 0 ? (
                <div className="flex flex-col items-center justify-center py-16 px-6 text-center">
                  <Building2 className="w-10 h-10 text-gray-200 mb-3" />
                  <p className="text-gray-500 font-medium text-sm">No companies yet</p>
                  <p className="text-gray-400 text-xs mt-1">Sync Gmail to auto-create companies from business email domains</p>
                  <button onClick={openCreate} className="mt-4 px-4 py-2 bg-[#5b6cf9] text-white rounded-lg text-sm font-medium hover:bg-[#4a5be8]">Add Company</button>
                </div>
              ) : selected ? (
                /* Narrow list when detail open */
                <div className="divide-y divide-gray-50">
                  {companies.map(company => (
                    <div
                      key={company.id}
                      onClick={() => openDetail(company)}
                      className={`flex items-center gap-3 px-4 py-3 cursor-pointer hover:bg-gray-50 transition-colors ${selected?.id === company.id ? 'bg-indigo-50 border-r-2 border-[#5b6cf9]' : ''}`}
                    >
                      <CompanyLogo name={company.name} domain={company.domain} size="w-8 h-8" />
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium text-gray-900 truncate">{company.name}</p>
                        <p className="text-xs text-gray-400 truncate">{company.domain || company.industry || '—'}</p>
                      </div>
                      <span className="text-xs text-gray-400 flex-shrink-0">{company.contact_count}</span>
                    </div>
                  ))}
                </div>
              ) : (
                /* Full-width table rows */
                <div className="divide-y divide-gray-50">
                  {companies.map(company => (
                    <div
                      key={company.id}
                      onClick={() => openDetail(company)}
                      className="flex items-center px-5 py-3.5 cursor-pointer hover:bg-gray-50 transition-colors group"
                    >
                      <div className="flex-1 flex items-center gap-3 min-w-0">
                        <CompanyLogo name={company.name} domain={company.domain} size="w-8 h-8" />
                        <div className="min-w-0">
                          <p className="text-sm font-medium text-gray-900 truncate group-hover:text-[#5b6cf9] transition-colors">{company.name}</p>
                          {company.industry && <p className="text-xs text-gray-400 truncate">{company.industry}</p>}
                        </div>
                      </div>
                      <div className="w-32 hidden lg:block">
                        {company.domain && (
                          <span className="text-xs text-gray-500 flex items-center gap-1 truncate">
                            <Globe className="w-3 h-3 text-gray-300 flex-shrink-0" />{company.domain}
                          </span>
                        )}
                      </div>
                      <div className="w-24 hidden xl:block">
                        <span className="text-xs text-gray-500 truncate">{company.city || '—'}</span>
                      </div>
                      <div className="w-20 text-right">
                        <span className="text-sm text-gray-700 font-medium">{company.contact_count}</span>
                      </div>
                      <div className="w-24 text-right hidden lg:block">
                        {company.open_deals_value > 0
                          ? <span className="text-sm font-medium text-emerald-600">{formatCurrency(company.open_deals_value)}</span>
                          : <span className="text-sm text-gray-300">—</span>
                        }
                      </div>
                    </div>
                  ))}
                </div>
              )}

              {/* Footer */}
              {companies.length > 0 && (
                <div className="px-5 py-2 border-t border-gray-100 bg-gray-50 text-xs text-gray-400 sticky bottom-0">
                  {total} {total === 1 ? 'company' : 'companies'} in view
                </div>
              )}
            </>
          ) : (
            /* ── Contacts tab ── */
            <>
              {!selected && (
                <div className="flex items-center px-5 py-2 border-b border-gray-100 bg-gray-50 sticky top-0 z-10">
                  <div className="flex-1 text-[11px] font-semibold text-gray-400 uppercase tracking-wide">Name</div>
                  <div className="w-48 text-[11px] font-semibold text-gray-400 uppercase tracking-wide hidden lg:block">Email</div>
                  <div className="w-28 text-[11px] font-semibold text-gray-400 uppercase tracking-wide hidden xl:block">Domain</div>
                </div>
              )}
              {loadingContacts ? (
                <div className="flex items-center justify-center py-16 text-gray-400 text-sm gap-2"><Loader2 className="w-4 h-4 animate-spin" />Loading…</div>
              ) : contacts.length === 0 ? (
                <div className="flex flex-col items-center justify-center py-16 px-6 text-center">
                  <Users className="w-10 h-10 text-gray-200 mb-3" />
                  <p className="text-gray-500 font-medium text-sm">No contacts yet</p>
                  <p className="text-gray-400 text-xs mt-1">Sync Gmail to import personal contacts</p>
                </div>
              ) : (
                <div className="divide-y divide-gray-50">
                  {contacts.map(c => {
                    const name = [c.first_name, c.last_name].filter(Boolean).join(' ') || c.email.split('@')[0];
                    const { bg, text } = paletteFor(c.email);
                    const ini = initials(name);
                    return (
                      <div key={c.id} className={`flex items-center px-5 py-3.5 hover:bg-gray-50 transition-colors ${selected ? 'gap-3' : 'gap-3'}`}>
                        <div className={`w-8 h-8 rounded-full ${bg} ${text} flex items-center justify-center flex-shrink-0 font-semibold text-xs`}>{ini}</div>
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-medium text-gray-900 truncate">{name}</p>
                          {selected && <p className="text-xs text-gray-400 truncate">{c.email}</p>}
                        </div>
                        {!selected && (
                          <>
                            <div className="w-48 hidden lg:block">
                              <p className="text-xs text-gray-500 truncate">{c.email}</p>
                            </div>
                            <div className="w-28 hidden xl:block">
                              <span className="text-xs text-gray-400 bg-gray-100 px-2 py-0.5 rounded-full">{c.domain}</span>
                            </div>
                          </>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
              {contacts.length > 0 && (
                <div className="px-5 py-2 border-t border-gray-100 bg-gray-50 text-xs text-gray-400 sticky bottom-0">
                  {contacts.length} {contacts.length === 1 ? 'contact' : 'contacts'} in view
                </div>
              )}
            </>
          )}
        </div>
      </div>

      {/* ── Right: HubSpot-style 3-column detail ── */}
      {selected && (
        <div className="flex-1 flex overflow-hidden min-w-0">

          {/* Left sidebar */}
          <div className="w-64 flex-shrink-0 border-r border-gray-100 overflow-y-auto bg-white">
            <div className="p-5 space-y-5">
              {/* Logo + name + website */}
              <div className="flex flex-col items-center text-center">
                <CompanyLogo name={selected.name} domain={selected.domain} size="w-16 h-16" />
                <h2 className="mt-3 text-base font-semibold text-gray-900 leading-snug">{selected.name}</h2>
                {selected.website && (
                  <a href={selected.website} target="_blank" rel="noreferrer" className="text-xs text-[#5b6cf9] hover:underline mt-0.5 truncate max-w-full">
                    {selected.domain || selected.website}
                  </a>
                )}
                {!selected.website && selected.domain && (
                  <span className="text-xs text-gray-400 mt-0.5">{selected.domain}</span>
                )}
              </div>

              {/* Action buttons */}
              <div className="grid grid-cols-3 gap-1">
                {[
                  { icon: StickyNote, label: 'Note' },
                  { icon: Mail,       label: 'Email' },
                  { icon: PhoneCall,  label: 'Call' },
                  { icon: Clock,      label: 'Task' },
                  { icon: Calendar,   label: 'Meeting' },
                  { icon: MoreHorizontal, label: 'More' },
                ].map(({ icon: Icon, label }) => (
                  <button key={label} className="flex flex-col items-center gap-1 py-2 px-1 rounded-lg hover:bg-gray-50 text-gray-400 hover:text-gray-600 transition-colors">
                    <div className="w-8 h-8 rounded-full border border-gray-200 bg-white flex items-center justify-center">
                      <Icon className="w-3.5 h-3.5" />
                    </div>
                    <span className="text-[10px] font-medium">{label}</span>
                  </button>
                ))}
              </div>

              {/* Key Information */}
              <div className="border-t border-gray-100 pt-4 space-y-3">
                <div className="flex items-center justify-between">
                  <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide">Key Information</p>
                  <button onClick={() => openEdit(selected)} className="text-[11px] text-[#5b6cf9] hover:underline">Edit</button>
                </div>
                {[
                  { label: 'Industry',      value: selected.industry  },
                  { label: 'Company size',  value: selected.size ? `${selected.size} employees` : null },
                  { label: 'City',          value: selected.city      },
                  { label: 'Country',       value: selected.country   },
                  { label: 'Phone',         value: selected.phone     },
                  { label: 'Email',         value: selected.email     },
                  { label: 'Domain',        value: selected.domain    },
                ].map(({ label, value }) => (
                  <div key={label}>
                    <p className="text-[11px] text-gray-400">{label}</p>
                    <p className="text-xs text-gray-700 mt-0.5 truncate">{value || <span className="text-gray-300">—</span>}</p>
                  </div>
                ))}
                {selected.description && (
                  <div>
                    <p className="text-[11px] text-gray-400">Description</p>
                    <p className="text-xs text-gray-600 mt-0.5 leading-relaxed">{selected.description}</p>
                  </div>
                )}
              </div>

              {/* Delete */}
              <div className="border-t border-gray-100 pt-4 flex gap-2">
                <button
                  onClick={() => deleteCompany(selected.id)}
                  className="flex-1 flex items-center justify-center gap-1.5 py-1.5 border border-gray-200 text-red-400 text-xs font-medium rounded-lg hover:bg-red-50 hover:border-red-200 transition-colors"
                >
                  <Trash2 className="w-3.5 h-3.5" /> Delete
                </button>
                <button
                  onClick={() => setSelected(null)}
                  className="p-1.5 border border-gray-200 text-gray-400 rounded-lg hover:bg-gray-50"
                >
                  <X className="w-3.5 h-3.5" />
                </button>
              </div>
            </div>
          </div>

          {/* Center: Activity timeline */}
          <div className="flex-1 flex flex-col overflow-hidden bg-gray-50 min-w-0">
            {/* Activity tabs */}
            <div className="flex-shrink-0 bg-white border-b border-gray-100 px-4 overflow-x-auto">
              <div className="flex">
                {ACTIVITY_TABS.map(t => (
                  <button
                    key={t}
                    onClick={() => setActivityTab(t)}
                    className={`px-3 py-3.5 text-sm font-medium whitespace-nowrap border-b-2 transition-colors ${activityTab === t ? 'border-[#5b6cf9] text-[#5b6cf9]' : 'border-transparent text-gray-500 hover:text-gray-700'}`}
                  >
                    {t}
                    {t !== 'All activities' && (() => {
                      const typeKey = ACTIVITY_TAB_TYPE[t];
                      const cnt = typeKey ? (selected.activities?.filter(a => a.type === typeKey).length ?? 0) : 0;
                      return cnt > 0 ? <span className="ml-1 text-xs text-gray-400">({cnt})</span> : null;
                    })()}
                  </button>
                ))}
              </div>
            </div>

            {/* Activity list */}
            <div className="flex-1 overflow-y-auto px-6 py-2">
              {filteredActivities.length === 0 ? (
                <div className="flex flex-col items-center justify-center py-12 text-center">
                  <div className="w-10 h-10 rounded-full bg-gray-100 flex items-center justify-center mb-3">
                    <Clock className="w-5 h-5 text-gray-300" />
                  </div>
                  <p className="text-sm text-gray-400">No {activityTab === 'All activities' ? 'activity' : activityTab.toLowerCase()} yet</p>
                  {activityTab === 'All activities' && (
                    <p className="text-xs text-gray-300 mt-1">Sync Gmail to see email history here</p>
                  )}
                </div>
              ) : (
                <div>
                  {filteredActivities.map(act => <ActivityItem key={act.id} act={act} />)}
                </div>
              )}
            </div>
          </div>

          {/* Right panel: Contacts, Deals, etc. */}
          <div className="w-56 flex-shrink-0 border-l border-gray-100 overflow-y-auto bg-white">
            {/* Contacts */}
            <div className="border-b border-gray-100">
              <button
                onClick={() => setContactsExpanded(e => !e)}
                className="w-full flex items-center justify-between px-4 py-3 text-sm font-semibold text-gray-700 hover:bg-gray-50 transition-colors"
              >
                <span>Contacts ({selected.contacts?.length ?? selected.contact_count ?? 0})</span>
                {contactsExpanded ? <ChevronDown className="w-4 h-4 text-gray-400" /> : <ChevronRight className="w-4 h-4 text-gray-400" />}
              </button>
              {contactsExpanded && (
                <div className="px-4 pb-3 space-y-2">
                  {(selected.contacts?.length ?? 0) === 0 ? (
                    <p className="text-xs text-gray-400 py-1">No contacts yet</p>
                  ) : selected.contacts!.map(c => {
                    const name = [c.first_name, c.last_name].filter(Boolean).join(' ') || c.email;
                    const ini = (c.first_name?.[0] || c.email[0]).toUpperCase();
                    const { bg, text } = paletteFor(c.email);
                    return (
                      <div key={c.id} className="flex items-center gap-2 py-1">
                        <div className={`w-7 h-7 rounded-full ${bg} ${text} flex items-center justify-center text-xs font-semibold flex-shrink-0`}>{ini}</div>
                        <div className="flex-1 min-w-0">
                          <p className="text-xs font-medium text-gray-800 truncate">{name}</p>
                          {c.role && <p className="text-[10px] text-gray-400 truncate">{c.role}</p>}
                          {c.is_primary && <span className="text-[9px] bg-indigo-50 text-indigo-600 px-1 py-0.5 rounded">Primary</span>}
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>

            {/* Deals */}
            <div className="border-b border-gray-100">
              <button
                onClick={() => setDealsExpanded(e => !e)}
                className="w-full flex items-center justify-between px-4 py-3 text-sm font-semibold text-gray-700 hover:bg-gray-50 transition-colors"
              >
                <span>Deals ({selected.deals?.length ?? selected.open_deals_count ?? 0})</span>
                {dealsExpanded ? <ChevronDown className="w-4 h-4 text-gray-400" /> : <ChevronRight className="w-4 h-4 text-gray-400" />}
              </button>
              {dealsExpanded && (
                <div className="px-4 pb-3">
                  {(selected.deals?.length ?? 0) === 0 ? (
                    <p className="text-xs text-gray-400 py-1">No deals yet</p>
                  ) : selected.deals!.map(d => (
                    <div key={d.id} className="flex items-center gap-2 py-1.5">
                      {d.stage_color && <div className="w-2 h-2 rounded-full flex-shrink-0" style={{ background: d.stage_color }} />}
                      <div className="flex-1 min-w-0">
                        <p className="text-xs font-medium text-gray-800 truncate">{d.title}</p>
                        <p className="text-[10px] text-gray-400">{formatCurrency(d.value, d.currency)}</p>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* Tickets */}
            <div className="border-b border-gray-100 px-4 py-3 flex items-center justify-between">
              <span className="text-sm font-semibold text-gray-700">Tickets (0)</span>
              <span className="text-xs text-[#5b6cf9] cursor-pointer hover:underline">+ Add</span>
            </div>

            {/* Attachments */}
            <div className="border-b border-gray-100 px-4 py-3 flex items-center justify-between">
              <span className="text-sm font-semibold text-gray-700">Attachments (0)</span>
              <span className="text-xs text-[#5b6cf9] cursor-pointer hover:underline">+ Add</span>
            </div>
          </div>
        </div>
      )}

      {/* ── Create / Edit modal ── */}
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
                    <option value="">Select…</option>
                    {INDUSTRY_OPTIONS.map(i => <option key={i} value={i}>{i}</option>)}
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-600 mb-1.5">Company Size</label>
                  <select className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-[#5b6cf9]/20 focus:border-[#5b6cf9] bg-white" value={form.size} onChange={e => setForm(f => ({ ...f, size: e.target.value }))}>
                    <option value="">Select…</option>
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
                <textarea className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-[#5b6cf9]/20 focus:border-[#5b6cf9] resize-none" rows={3} value={form.description} onChange={e => setForm(f => ({ ...f, description: e.target.value }))} placeholder="Brief description…" />
              </div>
            </div>
            <div className="flex items-center justify-end gap-3 px-6 py-4 border-t border-gray-100">
              <button onClick={() => setShowForm(false)} className="px-4 py-2 text-sm text-gray-600 hover:text-gray-800 hover:bg-gray-100 rounded-lg transition-colors">Cancel</button>
              <button onClick={saveCompany} disabled={saving} className="px-5 py-2 bg-[#5b6cf9] text-white text-sm font-medium rounded-lg hover:bg-[#4a5be8] disabled:opacity-50 transition-colors">
                {saving ? 'Saving…' : editingCompany ? 'Update Company' : 'Create Company'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
