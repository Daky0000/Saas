import { useMemo } from 'react';
import { AlertCircle, CheckCheck, Clock, Loader2, RefreshCw } from 'lucide-react';
import type { WorkflowRun } from '../../services/workflowService';

function statusBadge(status: string) {
  const s = String(status || '').toLowerCase();
  if (s === 'success') return 'bg-emerald-50 text-emerald-700';
  if (s === 'failed') return 'bg-red-50 text-red-600';
  if (s === 'partially_failed') return 'bg-amber-50 text-amber-700';
  if (s === 'running') return 'bg-blue-50 text-blue-700';
  return 'bg-slate-100 text-slate-600';
}

function StatusIcon({ status }: { status: string }) {
  const s = String(status || '').toLowerCase();
  if (s === 'success') return <CheckCheck size={13} className="text-emerald-600" />;
  if (s === 'failed') return <AlertCircle size={13} className="text-red-500" />;
  if (s === 'partially_failed') return <AlertCircle size={13} className="text-amber-600" />;
  if (s === 'queued' || s === 'running') return <Clock size={13} className="text-blue-600" />;
  return null;
}

function fmt(iso: string) {
  try {
    return new Date(iso).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
  } catch {
    return iso;
  }
}

export default function WorkflowHistory({
  runs,
  total,
  loading,
  error,
  onRefresh,
  onSelectRun,
}: {
  runs: WorkflowRun[];
  total: number;
  loading: boolean;
  error: string | null;
  onRefresh: () => void;
  onSelectRun?: (run: WorkflowRun) => void;
}) {
  const emptyText = useMemo(() => {
    if (loading) return '';
    if (error) return '';
    if (runs.length === 0) return 'No runs yet. Use “Test” to execute once.';
    return '';
  }, [runs.length, loading, error]);

  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-5">
      <div className="flex items-center justify-between gap-3">
        <div>
          <div className="text-sm font-bold text-slate-900">History</div>
          <div className="text-xs text-slate-500">{total} run{total === 1 ? '' : 's'}</div>
        </div>
        <button
          type="button"
          onClick={onRefresh}
          disabled={loading}
          className="inline-flex items-center gap-1.5 rounded-full border border-slate-200 bg-white px-3 py-1 text-xs font-semibold text-slate-600 hover:bg-slate-50 disabled:opacity-50"
        >
          <RefreshCw size={12} className={loading ? 'animate-spin' : ''} /> Refresh
        </button>
      </div>

      {loading ? (
        <div className="mt-6 flex items-center justify-center py-10 text-slate-400">
          <Loader2 size={18} className="animate-spin mr-2" /> Loading history…
        </div>
      ) : error ? (
        <div className="mt-6 rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-700">{error}</div>
      ) : runs.length === 0 ? (
        <div className="mt-6 text-xs text-slate-500">{emptyText}</div>
      ) : (
        <div className="mt-4 space-y-2">
          {runs.map((r) => (
            <button
              key={r.id}
              type="button"
              onClick={() => onSelectRun?.(r)}
              className="w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-left hover:bg-slate-100 transition"
            >
              <div className="flex items-center justify-between gap-3">
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <StatusIcon status={r.status} />
                    <span className={`rounded-full px-2 py-0.5 text-xs font-semibold ${statusBadge(r.status)}`}>{r.status}</span>
                    {r.trigger_event_id && <span className="text-xs text-slate-500 truncate">#{r.trigger_event_id}</span>}
                  </div>
                  <div className="mt-1 text-xs text-slate-500">{fmt(r.triggered_at)}</div>
                </div>
                <div className="text-right text-xs text-slate-500">
                  {typeof r.duration_seconds === 'number' ? `${r.duration_seconds}s` : ''}
                </div>
              </div>
              <div className="mt-2 flex flex-wrap gap-2 text-xs text-slate-500">
                {typeof r.steps_completed === 'number' && (
                  <span className="rounded-full bg-white px-2 py-0.5 border border-slate-200">
                    {r.steps_completed} ok
                  </span>
                )}
                {typeof r.steps_failed === 'number' && (
                  <span className="rounded-full bg-white px-2 py-0.5 border border-slate-200">
                    {r.steps_failed} failed
                  </span>
                )}
              </div>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

