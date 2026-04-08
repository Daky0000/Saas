import { useState, useEffect, useCallback } from 'react';
import { CheckCircle2, Sparkles, Sliders, RefreshCw, AlertCircle, CheckCheck, Clock, Loader2 } from 'lucide-react';
import ScheduleCalendar from '../components/calendar/ScheduleCalendar';
import SocialTemplatesTab from '../components/automation/SocialTemplatesTab';
import { API_BASE_URL } from '../utils/apiBase';

type PublishLog = {
  id: string;
  post_id: string;
  platform: string;
  status: string;
  account: string | null;
  error_message: string | null;
  platform_post_id: string | null;
  scheduled_for: string | null;
  created_at: string;
  post_title?: string | null;
};

function statusStyle(status: string) {
  if (status === 'published') return 'bg-green-100 text-green-700';
  if (status === 'failed') return 'bg-red-100 text-red-600';
  if (status === 'scheduled') return 'bg-blue-100 text-blue-700';
  return 'bg-slate-100 text-slate-500';
}

function StatusIcon({ status }: { status: string }) {
  if (status === 'published') return <CheckCheck size={13} className="text-green-600" />;
  if (status === 'failed') return <AlertCircle size={13} className="text-red-500" />;
  if (status === 'scheduled' || status === 'pending') return <Clock size={13} className="text-blue-500" />;
  return null;
}

function fmtDate(iso: string) {
  return new Date(iso).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
}

function LogTab() {
  const [logs, setLogs] = useState<PublishLog[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [filter, setFilter] = useState<'all' | 'published' | 'failed' | 'scheduled'>('all');

  const load = useCallback(async () => {
    setLoading(true); setError('');
    try {
      const res = await fetch(`${API_BASE_URL}/api/automation/logs`, {
        headers: { Authorization: `Bearer ${localStorage.getItem('auth_token') || ''}` },
      });
      const data = await res.json();
      if (!data.success) throw new Error(data.error || 'Failed to load logs');
      setLogs(data.logs || []);
    } catch (e: any) {
      setError(e.message || 'Failed to load logs');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  const filtered = filter === 'all' ? logs : logs.filter(l => l.status === filter);

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div className="flex gap-2 flex-wrap">
          {(['all', 'published', 'failed', 'scheduled'] as const).map(f => (
            <button key={f} onClick={() => setFilter(f)}
              className={`rounded-full px-3 py-1 text-xs font-semibold capitalize transition ${filter === f ? 'bg-slate-900 text-white' : 'border border-slate-200 bg-white text-slate-600 hover:bg-slate-50'}`}>
              {f}
            </button>
          ))}
        </div>
        <button onClick={load} disabled={loading}
          className="inline-flex items-center gap-1.5 rounded-full border border-slate-200 bg-white px-3 py-1 text-xs font-semibold text-slate-600 hover:bg-slate-50 disabled:opacity-50">
          <RefreshCw size={12} className={loading ? 'animate-spin' : ''} /> Refresh
        </button>
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-16 text-slate-400">
          <Loader2 size={20} className="animate-spin mr-2" /> Loading logs…
        </div>
      ) : error ? (
        <div className="rounded-2xl border border-red-200 bg-red-50 p-5 text-sm text-red-700">{error}</div>
      ) : filtered.length === 0 ? (
        <div className="flex flex-col items-center py-16 text-center text-slate-400">
          <CheckCircle2 size={32} className="mb-3 opacity-40" />
          <p className="text-sm font-semibold">No logs yet</p>
          <p className="text-xs mt-1">Publishing activity will appear here.</p>
        </div>
      ) : (
        <div className="rounded-2xl border border-slate-200 bg-white overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-slate-100 bg-slate-50 text-xs font-bold uppercase tracking-widest text-slate-400">
                <th className="px-4 py-3 text-left">Post</th>
                <th className="px-4 py-3 text-left">Platform</th>
                <th className="px-4 py-3 text-left">Status</th>
                <th className="px-4 py-3 text-left">Error</th>
                <th className="px-4 py-3 text-left">Time</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {filtered.map(log => (
                <tr key={log.id} className="hover:bg-slate-50 transition-colors">
                  <td className="px-4 py-3 max-w-[180px]">
                    <span className="block truncate font-medium text-slate-800 text-xs">
                      {log.post_title || log.post_id.slice(0, 8) + '…'}
                    </span>
                    {log.account && <span className="text-xs text-slate-400">{log.account}</span>}
                  </td>
                  <td className="px-4 py-3">
                    <span className="capitalize text-xs font-semibold text-slate-700">{log.platform}</span>
                  </td>
                  <td className="px-4 py-3">
                    <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-semibold ${statusStyle(log.status)}`}>
                      <StatusIcon status={log.status} />
                      {log.status}
                    </span>
                  </td>
                  <td className="px-4 py-3 max-w-[260px]">
                    {log.error_message
                      ? <span className="text-xs text-red-600 break-words">{log.error_message}</span>
                      : log.platform_post_id
                        ? <span className="text-xs text-slate-400 font-mono">{log.platform_post_id}</span>
                        : <span className="text-xs text-slate-300">—</span>}
                  </td>
                  <td className="px-4 py-3 whitespace-nowrap text-xs text-slate-400">
                    {fmtDate(log.created_at)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

export default function PostAutomation() {
  const [autoQueue, setAutoQueue] = useState(true);
  const [bestTime, setBestTime] = useState(true);
  const [approvalRequired, setApprovalRequired] = useState(false);
  const [dailySummary, setDailySummary] = useState(true);
  const [activeTab, setActiveTab] = useState<'general' | 'calendar' | 'social' | 'log'>('general');

  return (
    <div className="space-y-6 pb-8">
      <div className="flex flex-col gap-2">
        <h1 className="text-4xl font-black tracking-[-0.04em] text-slate-950">Post Automation</h1>
        <p className="text-base text-slate-500">
          Configure automation defaults before publishing. These settings keep your posts consistent and scheduled the
          way you want.
        </p>
      </div>

      <div className="flex flex-wrap gap-2" role="tablist" aria-label="Automation sections">
        {[
          { id: 'general' as const, label: 'General' },
          { id: 'calendar' as const, label: 'Calendar' },
          { id: 'social' as const, label: 'Social Templates' },
          { id: 'log' as const, label: 'Log' },
        ].map((tab) => {
          const isActive = tab.id === activeTab;
          return (
            <button
              key={tab.id}
              type="button"
              role="tab"
              aria-selected={isActive}
              onClick={() => setActiveTab(tab.id)}
              className={`rounded-full px-3 py-1 text-xs font-semibold transition ${
                isActive
                  ? 'bg-slate-900 text-white shadow-sm'
                  : 'border border-slate-200 bg-white text-slate-600 hover:bg-slate-50'
              }`}
            >
              {tab.label}
            </button>
          );
        })}
      </div>

      {activeTab === 'general' ? (
        <div className="grid gap-6 lg:grid-cols-[1.2fr_0.8fr]">
          <div className="space-y-6">
            <div className="rounded-2xl border border-slate-200 bg-white p-5">
              <div className="flex items-center gap-3">
                <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-slate-950 text-white">
                  <Sparkles size={18} />
                </div>
                <div>
                  <div className="text-sm font-bold text-slate-900">Automation Defaults</div>
                  <div className="text-xs text-slate-500">Apply these whenever you create a new post.</div>
                </div>
              </div>

              <div className="mt-5 grid gap-4 md:grid-cols-2">
                <label className="flex items-start gap-3 rounded-xl border border-slate-200 bg-slate-50 p-4">
                  <input type="checkbox" checked={autoQueue} onChange={(e) => setAutoQueue(e.target.checked)} />
                  <div>
                    <div className="text-sm font-semibold text-slate-800">Auto-queue new posts</div>
                    <div className="text-xs text-slate-500">Place drafts into the scheduling queue immediately.</div>
                  </div>
                </label>

                <label className="flex items-start gap-3 rounded-xl border border-slate-200 bg-slate-50 p-4">
                  <input type="checkbox" checked={bestTime} onChange={(e) => setBestTime(e.target.checked)} />
                  <div>
                    <div className="text-sm font-semibold text-slate-800">Use best-time suggestions</div>
                    <div className="text-xs text-slate-500">Apply AI-recommended posting windows.</div>
                  </div>
                </label>

                <label className="flex items-start gap-3 rounded-xl border border-slate-200 bg-slate-50 p-4">
                  <input type="checkbox" checked={approvalRequired} onChange={(e) => setApprovalRequired(e.target.checked)} />
                  <div>
                    <div className="text-sm font-semibold text-slate-800">Require approval before post</div>
                    <div className="text-xs text-slate-500">Keep posts in review until you approve.</div>
                  </div>
                </label>

                <label className="flex items-start gap-3 rounded-xl border border-slate-200 bg-slate-50 p-4">
                  <input type="checkbox" checked={dailySummary} onChange={(e) => setDailySummary(e.target.checked)} />
                  <div>
                    <div className="text-sm font-semibold text-slate-800">Daily automation summary</div>
                    <div className="text-xs text-slate-500">Receive a recap of scheduled and published posts.</div>
                  </div>
                </label>
              </div>
            </div>
          </div>

          <div className="space-y-6">
            <div className="rounded-2xl border border-slate-200 bg-white p-5">
              <div className="flex items-center gap-3">
                <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-slate-950 text-white">
                  <Sliders size={18} />
                </div>
                <div>
                  <div className="text-sm font-bold text-slate-900">Automation Checklist</div>
                  <div className="text-xs text-slate-500">Use this before every scheduled post.</div>
                </div>
              </div>

              <div className="mt-4 space-y-3 text-sm text-slate-600">
                {[
                  'Connect at least one integration.',
                  'Confirm your default scheduling window.',
                  'Review automation rules for this week.',
                  'Preview content for each platform.',
                ].map((item) => (
                  <div key={item} className="flex items-start gap-2">
                    <CheckCircle2 size={16} className="text-emerald-500 mt-0.5" />
                    <span>{item}</span>
                  </div>
                ))}
              </div>
            </div>

            <div className="rounded-2xl border border-slate-200 bg-blue-50 p-5">
              <div className="text-sm font-bold text-blue-900">Next step</div>
              <p className="mt-2 text-sm text-blue-800">
                When you are ready, head back to Posts to create or schedule your next automation-ready post.
              </p>
            </div>
          </div>
        </div>
      ) : null}

      {activeTab === 'calendar' ? <ScheduleCalendar /> : null}

      {activeTab === 'log' ? <LogTab /> : null}

      {activeTab === 'social' ? <SocialTemplatesTab /> : null}
    </div>
  );
}
