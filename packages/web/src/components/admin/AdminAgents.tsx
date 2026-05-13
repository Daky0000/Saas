import { useEffect, useState, useCallback } from 'react';
import {
  CheckCircle, Loader2, RefreshCw, Save, Settings, Wrench,
  GitBranch, Plus, Trash2, ChevronUp, ChevronDown, X, Info,
  ArrowLeft, ToggleLeft, ToggleRight, Edit2,
} from 'lucide-react';
import { getApiBaseUrl } from '../../utils/apiBase';

// ── Types ──────────────────────────────────────────────────────────────────────

type AgentTemplate = {
  id: string;
  agent_key: string;
  name: string;
  role: string;
  icon: string;
  color: string;
  base_prompt: string;
  memory_keywords: string[];
  updated_at: string;
};

type AgentTool = {
  id: string;
  key: string;
  name: string;
  description: string;
  type: 'builtin' | 'mcp' | 'api';
  config: Record<string, any>;
  enabled: boolean;
};

type WorkflowStep = {
  id: string;
  name: string;
  tool: string;
  description: string;
  prompt_template: string;
  params: Record<string, any>;
};

type AgentWorkflow = {
  id: string;
  agent_key: string;
  name: string;
  description: string;
  steps: WorkflowStep[];
  is_active: boolean;
  updated_at: string;
};

type TabKey = 'prompt' | 'tools' | 'workflow';

function tok() { return localStorage.getItem('auth_token') ?? ''; }
const BASE = () => getApiBaseUrl();

const TOOL_TYPE_BADGE: Record<string, string> = {
  builtin: 'bg-indigo-50 text-indigo-600',
  mcp:     'bg-purple-50 text-purple-600',
  api:     'bg-emerald-50 text-emerald-600',
};

// ── Step editor row ────────────────────────────────────────────────────────────

function StepRow({
  step, index, total, tools, onChange, onDelete, onMoveUp, onMoveDown,
}: {
  step: WorkflowStep; index: number; total: number; tools: AgentTool[];
  onChange: (u: WorkflowStep) => void; onDelete: () => void;
  onMoveUp: () => void; onMoveDown: () => void;
}) {
  const [expanded, setExpanded] = useState(index === 0);
  const set = (patch: Partial<WorkflowStep>) => onChange({ ...step, ...patch });

  return (
    <div className="rounded-xl border border-slate-200 bg-white overflow-hidden">
      <div
        className="flex items-center gap-3 px-4 py-3 cursor-pointer select-none hover:bg-slate-50 transition"
        onClick={() => setExpanded((p) => !p)}
      >
        <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-slate-100 text-[11px] font-bold text-slate-500">
          {index + 1}
        </span>
        <div className="flex-1 min-w-0">
          <p className="text-sm font-semibold text-slate-900 truncate">{step.name || 'Unnamed step'}</p>
          <p className="text-xs text-slate-400 truncate">{tools.find((t) => t.key === step.tool)?.name ?? step.tool}</p>
        </div>
        <div className="flex items-center gap-1 shrink-0">
          <button type="button" disabled={index === 0} onClick={(e) => { e.stopPropagation(); onMoveUp(); }}
            className="p-1 rounded text-slate-400 hover:text-slate-700 hover:bg-slate-100 disabled:opacity-25 transition">
            <ChevronUp size={14} />
          </button>
          <button type="button" disabled={index === total - 1} onClick={(e) => { e.stopPropagation(); onMoveDown(); }}
            className="p-1 rounded text-slate-400 hover:text-slate-700 hover:bg-slate-100 disabled:opacity-25 transition">
            <ChevronDown size={14} />
          </button>
          <button type="button" onClick={(e) => { e.stopPropagation(); onDelete(); }}
            className="p-1 rounded text-red-400 hover:text-red-600 hover:bg-red-50 transition">
            <Trash2 size={14} />
          </button>
        </div>
      </div>

      {expanded && (
        <div className="border-t border-slate-100 px-4 py-4 space-y-3 bg-slate-50/50">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-[11px] font-semibold text-slate-500 mb-1">Step Name</label>
              <input value={step.name} onChange={(e) => set({ name: e.target.value })}
                className="w-full rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-sm text-slate-800 outline-none focus:border-indigo-300 focus:ring-1 focus:ring-indigo-300"
                placeholder="e.g. Search Designs" />
            </div>
            <div>
              <label className="block text-[11px] font-semibold text-slate-500 mb-1">Tool</label>
              <select value={step.tool} onChange={(e) => set({ tool: e.target.value })}
                className="w-full rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-sm text-slate-800 outline-none focus:border-indigo-300 focus:ring-1 focus:ring-indigo-300">
                <option value="">— select tool —</option>
                {tools.filter((t) => t.enabled).map((t) => (
                  <option key={t.key} value={t.key}>{t.name}</option>
                ))}
              </select>
            </div>
          </div>
          <div>
            <label className="block text-[11px] font-semibold text-slate-500 mb-1">Description</label>
            <input value={step.description} onChange={(e) => set({ description: e.target.value })}
              className="w-full rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-sm text-slate-800 outline-none focus:border-indigo-300 focus:ring-1 focus:ring-indigo-300"
              placeholder="What this step does…" />
          </div>
          <div>
            <label className="block text-[11px] font-semibold text-slate-500 mb-1">
              Prompt Template
              <span className="ml-2 font-normal text-slate-400">
                Variables: {'{input}'} {'{brand.niche}'} {'{brand.tone}'} {'{brand.audience}'} {'{step_X.result}'}
              </span>
            </label>
            <textarea value={step.prompt_template} onChange={(e) => set({ prompt_template: e.target.value })}
              rows={4}
              className="w-full resize-none rounded-lg border border-slate-200 bg-white px-3 py-2 font-mono text-xs text-slate-700 outline-none focus:border-indigo-300 focus:ring-1 focus:ring-indigo-300 leading-relaxed"
              placeholder="Claude instruction or query template…" />
          </div>
          <div>
            <label className="block text-[11px] font-semibold text-slate-500 mb-1">Params (JSON)</label>
            <textarea
              value={JSON.stringify(step.params, null, 2)}
              onChange={(e) => { try { set({ params: JSON.parse(e.target.value) }); } catch { /* ignore */ } }}
              rows={2}
              className="w-full resize-none rounded-lg border border-slate-200 bg-white px-3 py-2 font-mono text-xs text-slate-600 outline-none focus:border-indigo-300 focus:ring-1 focus:ring-indigo-300" />
          </div>
        </div>
      )}
    </div>
  );
}

// ── Workflow step editor (for a single named workflow) ─────────────────────────

function WorkflowStepEditor({
  workflow, tools, agentColor, onBack, onSaved, onDeleted,
}: {
  workflow: AgentWorkflow; tools: AgentTool[]; agentColor: string;
  onBack: () => void;
  onSaved: (updated: AgentWorkflow) => void;
  onDeleted: (id: string) => void;
}) {
  const [steps, setSteps] = useState<WorkflowStep[]>(workflow.steps);
  const [name, setName] = useState(workflow.name);
  const [description, setDescription] = useState(workflow.description);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const save = async () => {
    setSaving(true); setSaved(false); setError(null);
    try {
      const res = await fetch(
        `${BASE()}/api/admin/agent-workflows/${workflow.agent_key}/${workflow.id}`,
        {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${tok()}` },
          body: JSON.stringify({ name, description, steps, is_active: workflow.is_active }),
        }
      );
      const d = await res.json();
      if (!d.success) throw new Error(d.error ?? 'Save failed');
      onSaved(d.workflow);
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    } catch (e: any) {
      setError(e.message);
    } finally {
      setSaving(false);
    }
  };

  const deleteWorkflow = async () => {
    if (!confirm(`Delete workflow "${workflow.name}"? This cannot be undone.`)) return;
    setDeleting(true);
    try {
      await fetch(`${BASE()}/api/admin/agent-workflows/${workflow.agent_key}/${workflow.id}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${tok()}` },
      });
      onDeleted(workflow.id);
    } catch (e: any) {
      setError(e.message);
      setDeleting(false);
    }
  };

  const addStep = () => {
    setSteps((prev) => [
      ...prev,
      { id: `step_${Date.now()}`, name: 'New Step', tool: 'claude_synthesize', description: '', prompt_template: '', params: {} },
    ]);
  };

  const updateStep = (i: number, u: WorkflowStep) =>
    setSteps((prev) => { const next = [...prev]; next[i] = u; return next; });
  const deleteStep = (i: number) => setSteps((prev) => prev.filter((_, j) => j !== i));
  const moveStep = (i: number, dir: -1 | 1) =>
    setSteps((prev) => {
      const next = [...prev]; const t = i + dir;
      if (t < 0 || t >= next.length) return next;
      [next[i], next[t]] = [next[t], next[i]]; return next;
    });

  return (
    <div className="space-y-3">
      {/* Back + heading */}
      <div className="flex items-center gap-2">
        <button type="button" onClick={onBack}
          className="flex items-center gap-1 text-xs font-semibold text-slate-500 hover:text-slate-800 transition">
          <ArrowLeft size={13} /> All Workflows
        </button>
      </div>

      {/* Workflow name + description */}
      <div className="space-y-2">
        <div>
          <label className="block text-[11px] font-semibold text-slate-500 mb-1">Workflow Name</label>
          <input value={name} onChange={(e) => setName(e.target.value)}
            className="w-full rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-sm font-semibold text-slate-800 outline-none focus:border-indigo-300 focus:ring-1 focus:ring-indigo-300" />
        </div>
        <div>
          <label className="block text-[11px] font-semibold text-slate-500 mb-1">Description</label>
          <input value={description} onChange={(e) => setDescription(e.target.value)}
            className="w-full rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-sm text-slate-600 outline-none focus:border-indigo-300 focus:ring-1 focus:ring-indigo-300"
            placeholder="What this workflow accomplishes…" />
        </div>
      </div>

      <div className="flex items-start gap-2 rounded-xl bg-slate-50 border border-slate-200 p-3">
        <Info size={14} className="text-slate-400 mt-0.5 shrink-0" />
        <p className="text-xs text-slate-500">
          Steps run top-to-bottom. Results from earlier steps are available as{' '}
          <code className="bg-slate-200 px-1 rounded">{'{step_id.result}'}</code> in later templates.
          Credit-consuming tools (Freepik, Video) check balance before generating.
        </p>
      </div>

      {error && (
        <div className="rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">{error}</div>
      )}

      <div className="space-y-2">
        {steps.map((step, i) => (
          <StepRow key={step.id} step={step} index={i} total={steps.length} tools={tools}
            onChange={(u) => updateStep(i, u)} onDelete={() => deleteStep(i)}
            onMoveUp={() => moveStep(i, -1)} onMoveDown={() => moveStep(i, 1)} />
        ))}
      </div>

      <button type="button" onClick={addStep}
        className="flex w-full items-center justify-center gap-2 rounded-xl border-2 border-dashed border-slate-200 py-3 text-xs font-semibold text-slate-500 hover:border-indigo-300 hover:text-indigo-600 transition">
        <Plus size={14} /> Add Step
      </button>

      <div className="flex items-center justify-between pt-1">
        <button type="button" disabled={deleting} onClick={deleteWorkflow}
          className="flex items-center gap-1.5 rounded-xl border border-red-200 px-3 py-2 text-xs font-semibold text-red-500 hover:bg-red-50 transition disabled:opacity-50">
          {deleting ? <><Loader2 size={12} className="animate-spin" /> Deleting…</> : <><Trash2 size={12} /> Delete Workflow</>}
        </button>
        <button type="button" disabled={saving} onClick={save}
          className="flex items-center gap-1.5 rounded-xl px-4 py-2 text-xs font-bold text-white transition disabled:opacity-50"
          style={{ background: saved ? '#10B981' : agentColor }}>
          {saving ? <><RefreshCw size={12} className="animate-spin" /> Saving…</> :
           saved   ? <><CheckCircle size={12} /> Saved</> :
                     <><Save size={12} /> Save Workflow</>}
        </button>
      </div>
    </div>
  );
}

// ── Workflow list view ─────────────────────────────────────────────────────────

function WorkflowListView({
  agentKey, agentColor, tools,
}: {
  agentKey: string; agentColor: string; tools: AgentTool[];
}) {
  const [workflows, setWorkflows] = useState<AgentWorkflow[]>([]);
  const [loading, setLoading] = useState(true);
  const [resetting, setResetting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState<AgentWorkflow | null>(null);
  const [creating, setCreating] = useState(false);
  const [newName, setNewName] = useState('');
  const [newDesc, setNewDesc] = useState('');
  const [creatingBusy, setCreatingBusy] = useState(false);

  const load = useCallback(() => {
    setLoading(true);
    fetch(`${BASE()}/api/admin/agent-workflows/${agentKey}`, {
      headers: { Authorization: `Bearer ${tok()}` },
    })
      .then((r) => r.json())
      .then((d) => { if (d.success) setWorkflows(d.workflows ?? []); else setError(d.error); })
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }, [agentKey]);

  useEffect(() => { load(); }, [load]);

  const toggleActive = async (wf: AgentWorkflow) => {
    try {
      const res = await fetch(`${BASE()}/api/admin/agent-workflows/${agentKey}/${wf.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${tok()}` },
        body: JSON.stringify({ is_active: !wf.is_active }),
      });
      const d = await res.json();
      if (d.success) setWorkflows((prev) => prev.map((w) => w.id === wf.id ? d.workflow : w));
    } catch { /* ignore */ }
  };

  const createWorkflow = async () => {
    if (!newName.trim()) return;
    setCreatingBusy(true);
    try {
      const res = await fetch(`${BASE()}/api/admin/agent-workflows/${agentKey}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${tok()}` },
        body: JSON.stringify({ name: newName.trim(), description: newDesc.trim(), steps: [] }),
      });
      const d = await res.json();
      if (!d.success) throw new Error(d.error);
      setWorkflows((prev) => [...prev, d.workflow]);
      setNewName(''); setNewDesc(''); setCreating(false);
      setEditing(d.workflow); // open editor immediately
    } catch (e: any) {
      setError(e.message);
    } finally {
      setCreatingBusy(false);
    }
  };

  const resetDefaults = async () => {
    if (!confirm('Reset all workflows for this agent to defaults? This will delete any custom workflows.')) return;
    setResetting(true); setError(null);
    try {
      const res = await fetch(`${BASE()}/api/admin/agent-workflows/${agentKey}/reset`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${tok()}` },
      });
      const d = await res.json();
      if (!d.success) throw new Error(d.error ?? 'Reset failed');
      setWorkflows(d.workflows ?? []);
    } catch (e: any) {
      setError(e.message);
    } finally {
      setResetting(false);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-10 text-slate-400">
        <Loader2 size={18} className="animate-spin mr-2" /> Loading workflows…
      </div>
    );
  }

  if (editing) {
    return (
      <WorkflowStepEditor
        workflow={editing}
        tools={tools}
        agentColor={agentColor}
        onBack={() => setEditing(null)}
        onSaved={(updated) => {
          setWorkflows((prev) => prev.map((w) => w.id === updated.id ? updated : w));
          setEditing(updated);
        }}
        onDeleted={(id) => {
          setWorkflows((prev) => prev.filter((w) => w.id !== id));
          setEditing(null);
        }}
      />
    );
  }

  return (
    <div className="space-y-3">
      <div className="flex items-start gap-2 rounded-xl bg-slate-50 border border-slate-200 p-3">
        <Info size={14} className="text-slate-400 mt-0.5 shrink-0" />
        <p className="text-xs text-slate-500">
          Each workflow is a named sequence of steps this agent follows for a specific task.
          Add, edit, or remove workflows. Toggle active/inactive to control which workflows are available.
        </p>
      </div>

      {error && (
        <div className="rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">{error}</div>
      )}

      {/* Workflow cards */}
      {workflows.length === 0 && !creating ? (
        <div className="rounded-xl border border-dashed border-slate-200 py-8 text-center">
          <p className="text-sm text-slate-400">No workflows yet.</p>
          <p className="text-xs text-slate-400 mt-1">Add a workflow or reset to defaults.</p>
        </div>
      ) : (
        <div className="space-y-2">
          {workflows.map((wf) => (
            <div key={wf.id} className="flex items-center gap-3 rounded-xl border border-slate-200 bg-white px-4 py-3 hover:shadow-sm transition">
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <p className="text-sm font-semibold text-slate-800 truncate">{wf.name}</p>
                  <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded-full ${wf.is_active ? 'bg-emerald-50 text-emerald-600' : 'bg-slate-100 text-slate-400'}`}>
                    {wf.is_active ? 'Active' : 'Off'}
                  </span>
                </div>
                {wf.description && (
                  <p className="text-xs text-slate-500 truncate mt-0.5">{wf.description}</p>
                )}
                <p className="text-[10px] text-slate-400 mt-0.5">{wf.steps.length} step{wf.steps.length !== 1 ? 's' : ''}</p>
              </div>
              <div className="flex items-center gap-1 shrink-0">
                <button type="button" onClick={() => toggleActive(wf)}
                  className="p-1.5 rounded-lg text-slate-400 hover:text-slate-700 hover:bg-slate-100 transition" title={wf.is_active ? 'Deactivate' : 'Activate'}>
                  {wf.is_active ? <ToggleRight size={16} className="text-emerald-500" /> : <ToggleLeft size={16} />}
                </button>
                <button type="button" onClick={() => setEditing(wf)}
                  className="flex items-center gap-1 rounded-lg border border-slate-200 px-2.5 py-1.5 text-xs font-semibold text-slate-600 hover:bg-slate-50 transition">
                  <Edit2 size={11} /> Edit
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* New workflow form */}
      {creating ? (
        <div className="rounded-xl border border-indigo-200 bg-indigo-50/30 p-4 space-y-3">
          <p className="text-xs font-bold text-slate-700">New Workflow</p>
          <div>
            <label className="block text-[11px] font-semibold text-slate-500 mb-1">Workflow Name <span className="text-red-400">*</span></label>
            <input value={newName} onChange={(e) => setNewName(e.target.value)}
              className="w-full rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-sm text-slate-800 outline-none focus:border-indigo-300 focus:ring-1 focus:ring-indigo-300"
              placeholder="e.g. Brand Identity Visual" autoFocus />
          </div>
          <div>
            <label className="block text-[11px] font-semibold text-slate-500 mb-1">Description</label>
            <input value={newDesc} onChange={(e) => setNewDesc(e.target.value)}
              className="w-full rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-sm text-slate-600 outline-none focus:border-indigo-300 focus:ring-1 focus:ring-indigo-300"
              placeholder="What this workflow accomplishes…" />
          </div>
          <div className="flex items-center justify-end gap-2">
            <button type="button" onClick={() => { setCreating(false); setNewName(''); setNewDesc(''); }}
              className="rounded-xl border border-slate-200 px-3 py-1.5 text-xs font-semibold text-slate-600 hover:bg-slate-50 transition">
              Cancel
            </button>
            <button type="button" disabled={!newName.trim() || creatingBusy} onClick={createWorkflow}
              className="flex items-center gap-1.5 rounded-xl px-4 py-1.5 text-xs font-bold text-white transition disabled:opacity-50"
              style={{ background: agentColor }}>
              {creatingBusy ? <><Loader2 size={11} className="animate-spin" /> Creating…</> : 'Create & Edit Steps'}
            </button>
          </div>
        </div>
      ) : (
        <button type="button" onClick={() => setCreating(true)}
          className="flex w-full items-center justify-center gap-2 rounded-xl border-2 border-dashed border-slate-200 py-3 text-xs font-semibold text-slate-500 hover:border-indigo-300 hover:text-indigo-600 transition">
          <Plus size={14} /> Add Workflow
        </button>
      )}

      <div className="flex justify-start pt-1">
        <button type="button" disabled={resetting} onClick={resetDefaults}
          className="flex items-center gap-1.5 rounded-xl border border-slate-200 px-3 py-2 text-xs font-semibold text-slate-600 hover:border-slate-300 hover:bg-slate-50 transition disabled:opacity-50">
          {resetting ? <><RefreshCw size={12} className="animate-spin" /> Resetting…</> : <><RefreshCw size={12} /> Reset to Defaults</>}
        </button>
      </div>
    </div>
  );
}

// ── Agent modal ────────────────────────────────────────────────────────────────

function AgentModal({
  template, tools, onClose, onTemplateUpdated,
}: {
  template: AgentTemplate; tools: AgentTool[];
  onClose: () => void; onTemplateUpdated: (t: AgentTemplate) => void;
}) {
  const [tab, setTab] = useState<TabKey>('prompt');
  const [promptText, setPromptText] = useState(template.base_prompt);
  const [savingPrompt, setSavingPrompt] = useState(false);
  const [savedPrompt, setSavedPrompt] = useState(false);
  const [promptError, setPromptError] = useState<string | null>(null);

  const savePrompt = async () => {
    setSavingPrompt(true); setSavedPrompt(false); setPromptError(null);
    try {
      const res = await fetch(`${BASE()}/api/admin/agent-templates/${template.agent_key}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${tok()}` },
        body: JSON.stringify({ base_prompt: promptText }),
      });
      const d = await res.json();
      if (!d.success) throw new Error(d.error ?? 'Save failed');
      onTemplateUpdated(d.template);
      setSavedPrompt(true);
      setTimeout(() => setSavedPrompt(false), 2000);
    } catch (e: any) {
      setPromptError(e.message);
    } finally {
      setSavingPrompt(false);
    }
  };

  const TABS: { key: TabKey; label: string; icon: React.ReactNode }[] = [
    { key: 'prompt',   label: 'Prompt',   icon: <Settings size={14} /> },
    { key: 'tools',    label: 'Tools',    icon: <Wrench size={14} /> },
    { key: 'workflow', label: 'Workflows', icon: <GitBranch size={14} /> },
  ];

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className="relative flex w-full max-w-2xl flex-col rounded-2xl bg-white shadow-xl max-h-[90vh]">
        {/* Header */}
        <div className="flex items-center gap-3 border-b border-slate-100 px-5 py-4 shrink-0">
          <div className="flex h-9 w-9 items-center justify-center rounded-xl text-lg"
            style={{ background: `${template.color}18`, color: template.color }}>
            {template.icon}
          </div>
          <div className="flex-1 min-w-0">
            <p className="font-black text-slate-900" style={{ color: template.color }}>{template.name}</p>
            <p className="text-xs text-slate-500">{template.role}</p>
          </div>
          <button type="button" onClick={onClose}
            className="rounded-lg p-1.5 text-slate-400 hover:text-slate-700 hover:bg-slate-100 transition">
            <X size={16} />
          </button>
        </div>

        {/* Tabs */}
        <div className="flex gap-1 border-b border-slate-100 px-5 pt-3 shrink-0">
          {TABS.map((t) => (
            <button key={t.key} type="button" onClick={() => setTab(t.key)}
              className={`flex items-center gap-1.5 rounded-t-lg px-3 py-2 text-xs font-semibold transition ${
                tab === t.key ? 'border-b-2 text-indigo-600' : 'text-slate-500 hover:text-slate-800'
              }`}
              style={tab === t.key ? { borderColor: template.color, color: template.color } : {}}>
              {t.icon} {t.label}
            </button>
          ))}
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto px-5 py-4">

          {tab === 'prompt' && (
            <div className="space-y-3">
              <p className="text-xs text-slate-500">
                This system prompt is injected every time the agent responds. User-specific compiled skills are layered on top at runtime.
              </p>
              <textarea value={promptText} onChange={(e) => setPromptText(e.target.value)} rows={10}
                className="w-full resize-none rounded-xl border border-slate-200 bg-slate-50 px-3.5 py-3 text-sm text-slate-800 leading-relaxed outline-none focus:border-indigo-300 focus:ring-1 focus:ring-indigo-300 font-mono"
                placeholder="Enter agent system prompt…" />
              {promptError && (
                <p className="text-xs text-red-600">{promptError}</p>
              )}
              <div className="flex justify-end">
                <button type="button" disabled={savingPrompt} onClick={savePrompt}
                  className="flex items-center gap-1.5 rounded-xl px-4 py-2 text-xs font-bold text-white transition disabled:opacity-50"
                  style={{ background: savedPrompt ? '#10B981' : template.color }}>
                  {savingPrompt ? <><RefreshCw size={12} className="animate-spin" /> Saving…</> :
                   savedPrompt  ? <><CheckCircle size={12} /> Saved</> :
                                  <><Save size={12} /> Save Prompt</>}
                </button>
              </div>
            </div>
          )}

          {tab === 'tools' && (
            <div className="space-y-3">
              <div className="flex items-start gap-2 rounded-xl bg-slate-50 border border-slate-200 p-3">
                <Info size={14} className="text-slate-400 mt-0.5 shrink-0" />
                <p className="text-xs text-slate-500">
                  These are the tools available to <strong>{template.name}</strong> during workflow execution.
                  Tools marked <span className="font-semibold text-emerald-600">api</span> consume credits per call.
                </p>
              </div>
              {tools.length === 0 ? (
                <p className="text-sm text-slate-400 py-4 text-center">No tools registered.</p>
              ) : (
                <div className="space-y-2">
                  {tools.map((tool) => (
                    <div key={tool.key} className="flex items-start gap-3 rounded-xl border border-slate-200 bg-white p-3">
                      <div className="mt-0.5">
                        <span className={`inline-block rounded-full px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide ${TOOL_TYPE_BADGE[tool.type] ?? 'bg-slate-100 text-slate-500'}`}>
                          {tool.type}
                        </span>
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-semibold text-slate-800">{tool.name}</p>
                        <p className="text-xs text-slate-500 mt-0.5">{tool.description}</p>
                        <p className="text-[10px] text-slate-400 font-mono mt-1">key: {tool.key}</p>
                        {tool.config?.credits && (
                          <p className="text-[10px] text-amber-600 font-semibold mt-0.5">{tool.config.credits} credits/call</p>
                        )}
                      </div>
                      <div className={`mt-1 h-2 w-2 rounded-full shrink-0 ${tool.enabled ? 'bg-emerald-400' : 'bg-slate-300'}`}
                        title={tool.enabled ? 'Enabled' : 'Disabled'} />
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {tab === 'workflow' && (
            <WorkflowListView
              agentKey={template.agent_key}
              agentColor={template.color}
              tools={tools}
            />
          )}
        </div>
      </div>
    </div>
  );
}

// ── Main page ──────────────────────────────────────────────────────────────────

export default function AdminAgents() {
  const [templates, setTemplates] = useState<AgentTemplate[]>([]);
  const [tools, setTools] = useState<AgentTool[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<AgentTemplate | null>(null);

  const load = useCallback(() => {
    setLoading(true);
    Promise.all([
      fetch(`${BASE()}/api/admin/agent-templates`, { headers: { Authorization: `Bearer ${tok()}` } }).then((r) => r.json()),
      fetch(`${BASE()}/api/admin/agent-tools`,     { headers: { Authorization: `Bearer ${tok()}` } }).then((r) => r.json()),
    ])
      .then(([td, tl]) => {
        if (!td.success) throw new Error(td.error ?? 'Failed to load');
        setTemplates(td.templates);
        setTools(tl.success ? tl.tools : []);
      })
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => { load(); }, [load]);

  if (loading) {
    return (
      <div className="flex items-center gap-3 py-12 justify-center text-slate-500">
        <Loader2 size={18} className="animate-spin" /> Loading agent templates…
      </div>
    );
  }

  if (error) {
    return <div className="rounded-2xl border border-red-200 bg-red-50 p-6 text-sm text-red-700">{error}</div>;
  }

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl font-black tracking-[-0.03em] text-slate-950">Agent Team</h2>
        <p className="mt-1.5 text-sm text-slate-500">
          Configure each agent's system prompt, available tools, and named workflows.
        </p>
      </div>

      <div className="grid gap-5 sm:grid-cols-1 xl:grid-cols-2">
        {templates.map((t) => (
          <div key={t.agent_key} className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm hover:shadow-md transition">
            <div className="flex items-center gap-3 mb-4">
              <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl text-xl font-bold"
                style={{ background: `${t.color}18`, color: t.color }}>
                {t.icon}
              </div>
              <div className="flex-1 min-w-0">
                <p className="font-black text-slate-900" style={{ color: t.color }}>{t.name}</p>
                <p className="text-xs text-slate-500">{t.role}</p>
              </div>
              {t.memory_keywords.length > 0 && (
                <div className="flex flex-wrap gap-1">
                  {t.memory_keywords.slice(0, 3).map((k) => (
                    <span key={k} className="rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-semibold text-slate-500">{k}</span>
                  ))}
                </div>
              )}
            </div>
            <p className="text-xs text-slate-500 line-clamp-2 mb-4">{t.base_prompt.slice(0, 160)}…</p>
            <div className="flex items-center justify-between">
              <p className="text-[11px] text-slate-400">
                Updated {new Date(t.updated_at).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })}
              </p>
              <button type="button" onClick={() => setSelected(t)}
                className="flex items-center gap-1.5 rounded-xl border border-slate-200 px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-50 transition">
                <Settings size={12} /> Configure
              </button>
            </div>
          </div>
        ))}
      </div>

      <div className="rounded-2xl border border-slate-200 bg-slate-50 p-5">
        <p className="text-xs font-bold text-slate-600 mb-2">How agents and workflows work</p>
        <ul className="space-y-1.5 text-xs text-slate-500">
          <li>• Each agent has named workflows — ordered step sequences it follows for specific tasks.</li>
          <li>• Nova uses Freepik AI (5 credits/image) and Magnific AI for image and video generation.</li>
          <li>• Credit balance is checked before any generation step — insufficient credits halt the workflow.</li>
          <li>• Agents are recompiled automatically when users update their brand memory.</li>
        </ul>
      </div>

      {selected && (
        <AgentModal
          template={selected}
          tools={tools}
          onClose={() => setSelected(null)}
          onTemplateUpdated={(updated) => {
            setTemplates((prev) => prev.map((t) => t.agent_key === updated.agent_key ? updated : t));
            setSelected(updated);
          }}
        />
      )}
    </div>
  );
}
