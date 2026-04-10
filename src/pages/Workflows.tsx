import { useCallback, useEffect, useMemo, useState } from 'react';
import { Loader2, Plus, RefreshCw, X } from 'lucide-react';
import {
  workflowService,
  type Workflow,
  type WorkflowAction,
  type WorkflowCondition,
  type WorkflowRun,
  type WorkflowRunStep,
  type WorkflowTrigger,
} from '../services/workflowService';
import { WorkflowBuilder, createEmptyWorkflowDraft, type WorkflowDraft } from '../components/workflows/WorkflowBuilder';
import WorkflowHistory from '../components/workflows/WorkflowHistory';

function badge(status?: string | null) {
  const s = String(status || '').toLowerCase();
  if (s === 'success') return 'bg-emerald-50 text-emerald-700';
  if (s === 'failed') return 'bg-red-50 text-red-600';
  if (s === 'partially_failed') return 'bg-amber-50 text-amber-700';
  if (s === 'running') return 'bg-blue-50 text-blue-700';
  return 'bg-slate-100 text-slate-600';
}

function normalizeConditionValue(operator: string, value: any) {
  const op = String(operator || '').toLowerCase();
  if (['gt', 'gte', 'lt', 'lte'].includes(op)) {
    const n = Number(value);
    return Number.isFinite(n) ? n : 0;
  }
  if (op === 'in') {
    if (Array.isArray(value)) return value;
    return String(value || '')
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);
  }
  const raw = String(value ?? '');
  if (raw.trim() !== '' && !Number.isNaN(Number(raw))) return Number(raw);
  return value;
}

function normalizeDraftForSave(draft: WorkflowDraft) {
  const conditions: WorkflowCondition[] = (draft.conditions || []).map((c, idx) => ({
    field: String(c.field || '').trim(),
    operator: String(c.operator || '').trim(),
    value: normalizeConditionValue(String(c.operator || ''), c.value),
    sort_order: idx,
  })).filter((c) => c.field && c.operator);

  const actions = (draft.actions || []).map((a, idx) => ({
    action_type: String(a.action_type || '').trim(),
    action_config: a.action_config || {},
    delay_seconds: Number(a.delay_seconds || 0),
    sort_order: idx,
  })).filter((a) => a.action_type);

  return {
    name: String(draft.name || '').trim(),
    description: String(draft.description || '').trim(),
    trigger_type: String(draft.trigger_type || '').trim(),
    trigger_config: draft.trigger_config || {},
    condition_mode: draft.condition_mode,
    enabled: Boolean(draft.enabled),
    conditions,
    actions,
  };
}

export default function Workflows() {
  const [triggers, setTriggers] = useState<WorkflowTrigger[]>([]);
  const [actions, setActions] = useState<WorkflowAction[]>([]);
  const [workflows, setWorkflows] = useState<Workflow[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const [loading, setLoading] = useState(true);
  const [loadingDetail, setLoadingDetail] = useState(false);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<{ kind: 'success' | 'error'; text: string } | null>(null);

  const [draft, setDraft] = useState<WorkflowDraft>(() => createEmptyWorkflowDraft());

  const [runs, setRuns] = useState<WorkflowRun[]>([]);
  const [runsTotal, setRunsTotal] = useState(0);
  const [runsLoading, setRunsLoading] = useState(false);
  const [runsError, setRunsError] = useState<string | null>(null);

  const [runDetails, setRunDetails] = useState<{ run: WorkflowRun; steps: WorkflowRunStep[] } | null>(null);
  const [runDetailsLoading, setRunDetailsLoading] = useState(false);

  const defaultTriggerId = useMemo(() => triggers[0]?.id || 'post_published', [triggers]);

  const loadBase = useCallback(async () => {
    setLoading(true);
    setMessage(null);
    try {
      const [ts, as, ws] = await Promise.all([
        workflowService.listTriggers(),
        workflowService.listActions(),
        workflowService.listWorkflows(),
      ]);
      setTriggers(ts);
      setActions(as);
      setWorkflows(ws);
      if (!selectedId && ws.length === 0) {
        setDraft(createEmptyWorkflowDraft(ts[0]?.id || 'post_published'));
      }
    } catch (e) {
      setMessage({ kind: 'error', text: e instanceof Error ? e.message : 'Failed to load workflows' });
    } finally {
      setLoading(false);
    }
  }, [selectedId]);

  const loadWorkflow = useCallback(async (id: string) => {
    setLoadingDetail(true);
    setMessage(null);
    try {
      const wf = await workflowService.getWorkflow(id);
      setDraft({
        id: wf.id,
        name: wf.name || '',
        description: wf.description || '',
        trigger_type: wf.trigger_type,
        trigger_config: wf.trigger_config || {},
        condition_mode: wf.condition_mode === 'OR' ? 'OR' : 'AND',
        enabled: Boolean(wf.enabled),
        conditions: (wf.conditions || []).map((c) => ({ field: c.field, operator: c.operator, value: c.value })),
        actions: (wf.actions || []).map((a) => ({
          action_type: a.action_type,
          action_config: a.action_config || {},
          delay_seconds: Number(a.delay_seconds || 0),
        })),
      });
    } catch (e) {
      setMessage({ kind: 'error', text: e instanceof Error ? e.message : 'Failed to load workflow' });
    } finally {
      setLoadingDetail(false);
    }
  }, []);

  const refreshRuns = useCallback(async (workflowId: string) => {
    setRunsLoading(true);
    setRunsError(null);
    try {
      const { runs: r, total } = await workflowService.listRuns(workflowId);
      setRuns(r);
      setRunsTotal(total);
    } catch (e) {
      setRunsError(e instanceof Error ? e.message : 'Failed to load history');
    } finally {
      setRunsLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadBase();
  }, [loadBase]);

  useEffect(() => {
    if (selectedId) void refreshRuns(selectedId);
  }, [selectedId, refreshRuns]);

  const handleNew = () => {
    setSelectedId(null);
    setRunDetails(null);
    setRuns([]);
    setRunsTotal(0);
    setDraft(createEmptyWorkflowDraft(defaultTriggerId));
  };

  const handleSave = async () => {
    const payload = normalizeDraftForSave(draft);
    if (!payload.name) {
      setMessage({ kind: 'error', text: 'Workflow name is required.' });
      return;
    }
    if (!payload.trigger_type) {
      setMessage({ kind: 'error', text: 'Trigger type is required.' });
      return;
    }
    if (!payload.actions.length) {
      setMessage({ kind: 'error', text: 'Add at least one action.' });
      return;
    }

    setSaving(true);
    setMessage(null);
    try {
      let saved: Workflow;
      if (draft.id) {
        saved = await workflowService.updateWorkflow(draft.id, { ...payload, enabled: payload.enabled });
      } else {
        saved = await workflowService.createWorkflow({ ...payload, enabled: payload.enabled } as any);
      }
      setMessage({ kind: 'success', text: 'Workflow saved.' });
      setSelectedId(saved.id);
      await loadBase();
      await loadWorkflow(saved.id);
      await refreshRuns(saved.id);
    } catch (e) {
      setMessage({ kind: 'error', text: e instanceof Error ? e.message : 'Failed to save workflow' });
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async () => {
    if (!draft.id) return;
    if (!confirm('Delete this workflow and its history?')) return;
    setSaving(true);
    setMessage(null);
    try {
      await workflowService.deleteWorkflow(draft.id);
      setMessage({ kind: 'success', text: 'Workflow deleted.' });
      handleNew();
      await loadBase();
    } catch (e) {
      setMessage({ kind: 'error', text: e instanceof Error ? e.message : 'Failed to delete workflow' });
    } finally {
      setSaving(false);
    }
  };

  const handleTest = async () => {
    if (!draft.id) return;
    setSaving(true);
    setMessage(null);
    try {
      const resp = await workflowService.testWorkflow(draft.id);
      if ((resp as any)?.skipped) {
        setMessage({ kind: 'success', text: `Test skipped: ${(resp as any).reason || 'Conditions not met'}` });
      } else {
        setMessage({ kind: 'success', text: `Test run: ${(resp as any).status || 'done'}` });
      }
      await refreshRuns(draft.id);
    } catch (e) {
      setMessage({ kind: 'error', text: e instanceof Error ? e.message : 'Test failed' });
    } finally {
      setSaving(false);
    }
  };

  const handleToggleEnabled = async (wf: Workflow, enabled: boolean) => {
    setMessage(null);
    try {
      const next = await workflowService.setEnabled(wf.id, enabled);
      setWorkflows((prev) => prev.map((x) => (x.id === wf.id ? { ...x, enabled: next } : x)));
      if (draft.id === wf.id) {
        setDraft((prev) => ({ ...prev, enabled: next }));
      }
    } catch (e) {
      setMessage({ kind: 'error', text: e instanceof Error ? e.message : 'Failed to toggle workflow' });
    }
  };

  const handleSelect = async (wf: Workflow) => {
    setSelectedId(wf.id);
    setRunDetails(null);
    await loadWorkflow(wf.id);
  };

  const handleSelectRun = async (run: WorkflowRun) => {
    if (!draft.id) return;
    setRunDetailsLoading(true);
    try {
      const detail = await workflowService.getRun(draft.id, run.id);
      setRunDetails(detail);
    } catch (e) {
      setMessage({ kind: 'error', text: e instanceof Error ? e.message : 'Failed to load run details' });
    } finally {
      setRunDetailsLoading(false);
    }
  };

  return (
    <div className="space-y-6 pb-8">
      <div className="flex flex-col gap-2">
        <h1 className="text-4xl font-black tracking-[-0.04em] text-slate-950">Workflows</h1>
        <p className="text-base text-slate-500">Automate actions based on triggers like posts, campaigns, and mailing events.</p>
      </div>

      {message && (
        <div className={`flex items-center justify-between rounded-xl px-4 py-3 text-sm ${message.kind === 'error' ? 'bg-red-50 text-red-700 border border-red-200' : 'bg-slate-950 text-white'}`}>
          <span>{message.text}</span>
          <button type="button" onClick={() => setMessage(null)} className={message.kind === 'error' ? 'text-red-700' : 'text-white'}>
            <X size={14} />
          </button>
        </div>
      )}

      <div className="grid gap-6 lg:grid-cols-[0.9fr_1.1fr]">
        <div className="space-y-4">
          <div className="flex items-center justify-between gap-3">
            <div className="text-sm font-bold text-slate-900">Your workflows</div>
            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => void loadBase()}
                disabled={loading}
                className="inline-flex items-center gap-1.5 rounded-full border border-slate-200 bg-white px-3 py-1 text-xs font-semibold text-slate-600 hover:bg-slate-50 disabled:opacity-50"
              >
                <RefreshCw size={12} className={loading ? 'animate-spin' : ''} /> Refresh
              </button>
              <button
                type="button"
                onClick={handleNew}
                className="inline-flex items-center gap-1.5 rounded-full bg-slate-950 px-3 py-1 text-xs font-semibold text-white hover:bg-slate-800"
              >
                <Plus size={12} /> New
              </button>
            </div>
          </div>

          {loading ? (
            <div className="flex items-center justify-center rounded-2xl border border-slate-200 bg-white py-16 text-slate-400">
              <Loader2 size={18} className="animate-spin mr-2" /> Loading…
            </div>
          ) : workflows.length === 0 ? (
            <div className="rounded-2xl border border-slate-200 bg-white p-6 text-sm text-slate-600">
              No workflows yet. Click <span className="font-semibold">New</span> to create one.
            </div>
          ) : (
            <div className="space-y-2">
              {workflows.map((wf) => {
                const active = wf.id === selectedId;
                return (
                  <button
                    key={wf.id}
                    type="button"
                    onClick={() => void handleSelect(wf)}
                    className={`w-full rounded-2xl border px-4 py-3 text-left transition ${
                      active ? 'border-slate-300 bg-slate-50' : 'border-slate-200 bg-white hover:bg-slate-50'
                    }`}
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <div className="truncate text-sm font-semibold text-slate-900">{wf.name}</div>
                        <div className="mt-1 flex flex-wrap gap-2 text-xs text-slate-500">
                          <span className="rounded-full bg-white px-2 py-0.5 border border-slate-200">{wf.trigger_type}</span>
                          {wf.last_run_status && (
                            <span className={`rounded-full px-2 py-0.5 border border-slate-200 ${badge(wf.last_run_status)}`}>
                              {wf.last_run_status}
                            </span>
                          )}
                        </div>
                      </div>
                      <label
                        className="flex items-center gap-2 text-xs font-semibold text-slate-600"
                        onClick={(e) => e.stopPropagation()}
                      >
                        <input
                          type="checkbox"
                          checked={Boolean(wf.enabled)}
                          onChange={(e) => void handleToggleEnabled(wf, e.target.checked)}
                        />
                        On
                      </label>
                    </div>
                    <div className="mt-2 flex flex-wrap gap-2 text-xs text-slate-500">
                      {typeof wf.total_runs === 'number' && (
                        <span className="rounded-full bg-white px-2 py-0.5 border border-slate-200">{wf.total_runs} runs</span>
                      )}
                      {typeof wf.action_count === 'number' && (
                        <span className="rounded-full bg-white px-2 py-0.5 border border-slate-200">{wf.action_count} actions</span>
                      )}
                      {typeof wf.condition_count === 'number' && (
                        <span className="rounded-full bg-white px-2 py-0.5 border border-slate-200">{wf.condition_count} conditions</span>
                      )}
                    </div>
                  </button>
                );
              })}
            </div>
          )}
        </div>

        <div className="space-y-4">
          {loadingDetail ? (
            <div className="flex items-center justify-center rounded-2xl border border-slate-200 bg-white py-16 text-slate-400">
              <Loader2 size={18} className="animate-spin mr-2" /> Loading workflow…
            </div>
          ) : (
            <WorkflowBuilder
              draft={draft}
              setDraft={setDraft}
              triggers={triggers}
              actions={actions}
              saving={saving}
              onSave={handleSave}
              onTest={handleTest}
              onDelete={handleDelete}
            />
          )}

          {draft.id && (
            <WorkflowHistory
              runs={runs}
              total={runsTotal}
              loading={runsLoading}
              error={runsError}
              onRefresh={() => void refreshRuns(draft.id!)}
              onSelectRun={(r) => void handleSelectRun(r)}
            />
          )}
        </div>
      </div>

      {runDetails && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 p-4">
          <div className="w-full max-w-2xl rounded-2xl border border-slate-200 bg-white shadow-xl">
            <div className="flex items-start justify-between gap-3 border-b border-slate-100 px-5 py-4">
              <div>
                <div className="text-sm font-bold text-slate-900">Run details</div>
                <div className="mt-1 flex flex-wrap gap-2 text-xs text-slate-500">
                  <span className={`rounded-full px-2 py-0.5 border border-slate-200 ${badge(runDetails.run.status)}`}>{runDetails.run.status}</span>
                  {runDetails.run.trigger_event_id && <span className="rounded-full bg-slate-50 px-2 py-0.5 border border-slate-200">#{runDetails.run.trigger_event_id}</span>}
                </div>
              </div>
              <button type="button" onClick={() => setRunDetails(null)} className="text-slate-500 hover:text-slate-700">
                <X size={16} />
              </button>
            </div>

            <div className="px-5 py-4">
              {runDetailsLoading ? (
                <div className="flex items-center justify-center py-12 text-slate-400">
                  <Loader2 size={18} className="animate-spin mr-2" /> Loading…
                </div>
              ) : (
                <div className="space-y-3">
                  {runDetails.steps.map((s, idx) => (
                    <div key={idx} className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3">
                      <div className="flex items-center justify-between gap-3">
                        <div className="text-sm font-semibold text-slate-800">{idx + 1}. {s.action_type}</div>
                        <span className={`rounded-full px-2 py-0.5 text-xs font-semibold ${badge(s.status)}`}>{s.status}</span>
                      </div>
                      {s.error && <div className="mt-2 text-xs text-red-600">{s.error}</div>}
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

