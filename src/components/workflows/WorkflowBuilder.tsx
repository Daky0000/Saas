import type { Dispatch, SetStateAction } from 'react';
import { Plus, Trash2 } from 'lucide-react';
import type { WorkflowAction, WorkflowTrigger } from '../../services/workflowService';

export type WorkflowDraft = {
  id?: string;
  name: string;
  description: string;
  trigger_type: string;
  trigger_config: Record<string, any>;
  condition_mode: 'AND' | 'OR';
  enabled: boolean;
  conditions: Array<{ field: string; operator: string; value: any }>;
  actions: Array<{ action_type: string; action_config: Record<string, any>; delay_seconds?: number }>;
};

export function createEmptyWorkflowDraft(defaultTriggerType = 'post_published'): WorkflowDraft {
  return {
    name: '',
    description: '',
    trigger_type: defaultTriggerType,
    trigger_config: { platform: 'all' },
    condition_mode: 'AND',
    enabled: false,
    conditions: [],
    actions: [
      { action_type: 'send_email', action_config: { to: 'admin', subject: 'Workflow triggered' }, delay_seconds: 0 },
    ],
  };
}

const CONDITION_OPERATORS = [
  { id: 'equals', label: '=' },
  { id: 'not_equals', label: '≠' },
  { id: 'gt', label: '>' },
  { id: 'gte', label: '≥' },
  { id: 'lt', label: '<' },
  { id: 'lte', label: '≤' },
  { id: 'contains', label: 'contains' },
  { id: 'in', label: 'in' },
] as const;

const CAMPAIGN_CHANNELS = ['facebook', 'instagram', 'twitter', 'linkedin', 'pinterest', 'email'] as const;

function defaultActionConfig(actionType: string): Record<string, any> {
  const t = String(actionType || '').trim().toLowerCase();
  if (t === 'send_email') return { to: 'admin', subject: 'Workflow triggered', template_id: '' };
  if (t === 'create_campaign') return { name_prefix: 'Auto-', channels: ['facebook'] };
  if (t === 'create_post') return { title: 'Auto post', content: '' };
  if (t === 'tag_contact') return { tags: 'vip' };
  return {};
}

function TriggerConfigFields({
  draft,
  setDraft,
}: {
  draft: WorkflowDraft;
  setDraft: Dispatch<SetStateAction<WorkflowDraft>>;
}) {
  const type = draft.trigger_type;
  const cfg = draft.trigger_config || {};

  if (type === 'post_created' || type === 'post_published') {
    return (
      <div className="grid gap-3 md:grid-cols-2">
        <label className="text-sm">
          <div className="text-xs font-semibold text-slate-500 mb-1">Platform</div>
          <select
            value={String(cfg.platform || 'all')}
            onChange={(e) => setDraft((prev) => ({ ...prev, trigger_config: { ...prev.trigger_config, platform: e.target.value } }))}
            className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm outline-none focus:border-slate-400"
          >
            {['all', 'facebook', 'instagram', 'twitter', 'linkedin', 'pinterest'].map((p) => (
              <option key={p} value={p}>
                {p}
              </option>
            ))}
          </select>
        </label>
      </div>
    );
  }

  if (type === 'engagement_threshold') {
    return (
      <div className="grid gap-3 md:grid-cols-3">
        <label className="text-sm">
          <div className="text-xs font-semibold text-slate-500 mb-1">Metric</div>
          <select
            value={String(cfg.metric || 'total_engagement')}
            onChange={(e) => setDraft((prev) => ({ ...prev, trigger_config: { ...prev.trigger_config, metric: e.target.value } }))}
            className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm outline-none focus:border-slate-400"
          >
            {['total_engagement', 'likes', 'comments', 'shares'].map((m) => (
              <option key={m} value={m}>
                {m}
              </option>
            ))}
          </select>
        </label>

        <label className="text-sm">
          <div className="text-xs font-semibold text-slate-500 mb-1">Min value</div>
          <input
            type="number"
            value={String(cfg.min_value ?? 100)}
            onChange={(e) => setDraft((prev) => ({ ...prev, trigger_config: { ...prev.trigger_config, min_value: Number(e.target.value || 0) } }))}
            className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm outline-none focus:border-slate-400"
          />
        </label>

        <label className="text-sm">
          <div className="text-xs font-semibold text-slate-500 mb-1">Platform</div>
          <select
            value={String(cfg.platform || 'linkedin')}
            onChange={(e) => setDraft((prev) => ({ ...prev, trigger_config: { ...prev.trigger_config, platform: e.target.value } }))}
            className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm outline-none focus:border-slate-400"
          >
            {['facebook', 'instagram', 'twitter', 'linkedin', 'pinterest'].map((p) => (
              <option key={p} value={p}>
                {p}
              </option>
            ))}
          </select>
        </label>
      </div>
    );
  }

  if (type === 'scheduled') {
    return (
      <div className="grid gap-3 md:grid-cols-2">
        <label className="text-sm">
          <div className="text-xs font-semibold text-slate-500 mb-1">Schedule</div>
          <select
            value={String(cfg.schedule || 'daily')}
            onChange={(e) => setDraft((prev) => ({ ...prev, trigger_config: { ...prev.trigger_config, schedule: e.target.value } }))}
            className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm outline-none focus:border-slate-400"
          >
            {['daily', 'weekly_monday', 'weekly_friday', 'monthly_first', 'monthly_last'].map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
        </label>

        <label className="text-sm">
          <div className="text-xs font-semibold text-slate-500 mb-1">Time</div>
          <input
            type="time"
            value={String(cfg.time || '09:00')}
            onChange={(e) => setDraft((prev) => ({ ...prev, trigger_config: { ...prev.trigger_config, time: e.target.value } }))}
            className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm outline-none focus:border-slate-400"
          />
        </label>
      </div>
    );
  }

  return (
    <div className="text-xs text-slate-500">
      No extra configuration for this trigger.
    </div>
  );
}

export function WorkflowBuilder({
  draft,
  setDraft,
  triggers,
  actions,
  saving,
  onSave,
  onTest,
  onDelete,
}: {
  draft: WorkflowDraft;
  setDraft: Dispatch<SetStateAction<WorkflowDraft>>;
  triggers: WorkflowTrigger[];
  actions: WorkflowAction[];
  saving: boolean;
  onSave: () => void;
  onTest: () => void;
  onDelete?: () => void;
}) {
  const triggerOptions = triggers.length ? triggers : [{ id: 'post_published', name: 'Post is published', description: '', fields: [] }];

  const updateCondition = (idx: number, patch: Partial<WorkflowDraft['conditions'][number]>) => {
    setDraft((prev) => {
      const next = [...prev.conditions];
      next[idx] = { ...next[idx], ...patch };
      return { ...prev, conditions: next };
    });
  };

  const updateAction = (idx: number, patch: Partial<WorkflowDraft['actions'][number]>) => {
    setDraft((prev) => {
      const next = [...prev.actions];
      next[idx] = { ...next[idx], ...patch };
      return { ...prev, actions: next };
    });
  };

  const updateActionConfig = (idx: number, patch: Record<string, any>) => {
    setDraft((prev) => {
      const next = [...prev.actions];
      const cur = next[idx];
      next[idx] = { ...cur, action_config: { ...(cur.action_config || {}), ...patch } };
      return { ...prev, actions: next };
    });
  };

  const addCondition = () => {
    setDraft((prev) => ({
      ...prev,
      conditions: [...prev.conditions, { field: 'platform', operator: 'equals', value: 'linkedin' }],
    }));
  };

  const addAction = () => {
    setDraft((prev) => ({
      ...prev,
      actions: [...prev.actions, { action_type: 'send_email', action_config: defaultActionConfig('send_email'), delay_seconds: 0 }],
    }));
  };

  return (
    <div className="space-y-6">
      <div className="rounded-2xl border border-slate-200 bg-white p-5">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0 flex-1">
            <div className="text-sm font-bold text-slate-900">Workflow</div>
            <div className="text-xs text-slate-500">Triggers, conditions, and actions.</div>
          </div>

          <label className="flex items-center gap-2 text-xs font-semibold text-slate-600">
            <input
              type="checkbox"
              checked={draft.enabled}
              onChange={(e) => setDraft((prev) => ({ ...prev, enabled: e.target.checked }))}
            />
            Enabled
          </label>
        </div>

        <div className="mt-5 grid gap-3 md:grid-cols-2">
          <label className="text-sm">
            <div className="text-xs font-semibold text-slate-500 mb-1">Name *</div>
            <input
              value={draft.name}
              onChange={(e) => setDraft((prev) => ({ ...prev, name: e.target.value }))}
              placeholder="Auto-amplify high engagement"
              className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm outline-none focus:border-slate-400"
            />
          </label>

          <label className="text-sm">
            <div className="text-xs font-semibold text-slate-500 mb-1">Description</div>
            <input
              value={draft.description}
              onChange={(e) => setDraft((prev) => ({ ...prev, description: e.target.value }))}
              placeholder="Optional"
              className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm outline-none focus:border-slate-400"
            />
          </label>
        </div>
      </div>

      <div className="rounded-2xl border border-slate-200 bg-white p-5">
        <div className="text-sm font-bold text-slate-900">Trigger</div>
        <div className="text-xs text-slate-500 mt-1">Choose what starts the workflow.</div>

        <div className="mt-4 grid gap-3 md:grid-cols-2">
          <label className="text-sm">
            <div className="text-xs font-semibold text-slate-500 mb-1">Trigger type</div>
            <select
              value={draft.trigger_type}
              onChange={(e) =>
                setDraft((prev) => ({
                  ...prev,
                  trigger_type: e.target.value,
                  trigger_config: {},
                }))
              }
              className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm outline-none focus:border-slate-400"
            >
              {triggerOptions.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.name}
                </option>
              ))}
            </select>
          </label>
        </div>

        <div className="mt-4">
          <TriggerConfigFields draft={draft} setDraft={setDraft} />
        </div>
      </div>

      <div className="rounded-2xl border border-slate-200 bg-white p-5">
        <div className="flex items-center justify-between gap-3">
          <div>
            <div className="text-sm font-bold text-slate-900">Conditions</div>
            <div className="text-xs text-slate-500 mt-1">Optional filters before actions run.</div>
          </div>

          <div className="flex gap-2">
            {(['AND', 'OR'] as const).map((m) => (
              <button
                key={m}
                type="button"
                onClick={() => setDraft((prev) => ({ ...prev, condition_mode: m }))}
                className={`rounded-full px-3 py-1 text-xs font-semibold transition ${
                  draft.condition_mode === m ? 'bg-slate-900 text-white' : 'border border-slate-200 bg-white text-slate-600 hover:bg-slate-50'
                }`}
              >
                {m}
              </button>
            ))}
          </div>
        </div>

        {draft.conditions.length === 0 ? (
          <div className="mt-4 text-xs text-slate-500">No conditions. Workflow will run every time the trigger fires.</div>
        ) : (
          <div className="mt-4 space-y-2">
            {draft.conditions.map((c, idx) => (
              <div key={idx} className="grid gap-2 md:grid-cols-[1.2fr_0.8fr_1fr_auto]">
                <input
                  value={c.field}
                  onChange={(e) => updateCondition(idx, { field: e.target.value })}
                  placeholder="field (e.g. platform, engagement_count)"
                  className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm outline-none focus:border-slate-400"
                />
                <select
                  value={c.operator}
                  onChange={(e) => updateCondition(idx, { operator: e.target.value })}
                  className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm outline-none focus:border-slate-400"
                >
                  {CONDITION_OPERATORS.map((op) => (
                    <option key={op.id} value={op.id}>
                      {op.label}
                    </option>
                  ))}
                </select>
                <input
                  type={['gt', 'gte', 'lt', 'lte'].includes(String(c.operator || '').toLowerCase()) ? 'number' : 'text'}
                  value={String(c.value ?? '')}
                  onChange={(e) => updateCondition(idx, { value: e.target.value })}
                  placeholder={c.operator === 'in' ? 'a,b,c' : 'value'}
                  className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm outline-none focus:border-slate-400"
                />
                <button
                  type="button"
                  onClick={() => setDraft((prev) => ({ ...prev, conditions: prev.conditions.filter((_, i) => i !== idx) }))}
                  className="inline-flex h-10 w-10 items-center justify-center rounded-xl border border-slate-200 text-slate-500 hover:bg-slate-50"
                  aria-label="Delete condition"
                >
                  <Trash2 size={14} />
                </button>
              </div>
            ))}
          </div>
        )}

        <button
          type="button"
          onClick={addCondition}
          className="mt-4 inline-flex items-center gap-2 rounded-xl border border-slate-200 bg-white px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50"
        >
          <Plus size={14} /> Add condition
        </button>
      </div>

      <div className="rounded-2xl border border-slate-200 bg-white p-5">
        <div className="text-sm font-bold text-slate-900">Actions</div>
        <div className="text-xs text-slate-500 mt-1">Run these in order when conditions match.</div>

        <div className="mt-4 space-y-3">
          {draft.actions.map((a, idx) => {
            const type = String(a.action_type || '');
            const cfg = a.action_config || {};
            const actionLabel = actions.find((x) => x.id === type)?.name || type;
            return (
              <div key={idx} className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div className="flex items-center gap-2">
                    <div className="text-xs font-bold text-slate-500">Step {idx + 1}</div>
                    <div className="text-sm font-semibold text-slate-800">{actionLabel}</div>
                  </div>
                  <button
                    type="button"
                    onClick={() => setDraft((prev) => ({ ...prev, actions: prev.actions.filter((_, i) => i !== idx) }))}
                    className="inline-flex items-center gap-2 rounded-full border border-slate-200 bg-white px-3 py-1 text-xs font-semibold text-slate-600 hover:bg-slate-50"
                  >
                    <Trash2 size={12} /> Delete
                  </button>
                </div>

                <div className="mt-3 grid gap-3 md:grid-cols-3">
                  <label className="text-sm">
                    <div className="text-xs font-semibold text-slate-500 mb-1">Action</div>
                    <select
                      value={type}
                      onChange={(e) =>
                        updateAction(idx, {
                          action_type: e.target.value,
                          action_config: defaultActionConfig(e.target.value),
                        })
                      }
                      className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm outline-none focus:border-slate-400"
                    >
                      {actions.map((opt) => (
                        <option key={opt.id} value={opt.id}>
                          {opt.name}
                        </option>
                      ))}
                    </select>
                  </label>

                  <label className="text-sm">
                    <div className="text-xs font-semibold text-slate-500 mb-1">Delay (seconds)</div>
                    <input
                      type="number"
                      value={String(a.delay_seconds || 0)}
                      onChange={(e) => updateAction(idx, { delay_seconds: Number(e.target.value || 0) })}
                      className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm outline-none focus:border-slate-400"
                    />
                  </label>
                </div>

                {type === 'send_email' && (
                  <div className="mt-3 grid gap-3 md:grid-cols-3">
                    <label className="text-sm">
                      <div className="text-xs font-semibold text-slate-500 mb-1">To</div>
                      <select
                        value={String(cfg.to || 'admin')}
                        onChange={(e) => updateActionConfig(idx, { to: e.target.value })}
                        className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm outline-none focus:border-slate-400"
                      >
                        {['admin', 'contact_email', 'post_creator'].map((v) => (
                          <option key={v} value={v}>
                            {v}
                          </option>
                        ))}
                      </select>
                    </label>
                    <label className="text-sm md:col-span-2">
                      <div className="text-xs font-semibold text-slate-500 mb-1">Subject</div>
                      <input
                        value={String(cfg.subject || '')}
                        onChange={(e) => updateActionConfig(idx, { subject: e.target.value })}
                        placeholder="High engagement post!"
                        className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm outline-none focus:border-slate-400"
                      />
                    </label>
                    <label className="text-sm md:col-span-3">
                      <div className="text-xs font-semibold text-slate-500 mb-1">Template id (optional)</div>
                      <input
                        value={String(cfg.template_id || '')}
                        onChange={(e) => updateActionConfig(idx, { template_id: e.target.value })}
                        placeholder="engagement_alert"
                        className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm outline-none focus:border-slate-400"
                      />
                    </label>
                  </div>
                )}

                {type === 'create_campaign' && (
                  <div className="mt-3 grid gap-3 md:grid-cols-2">
                    <label className="text-sm">
                      <div className="text-xs font-semibold text-slate-500 mb-1">Name prefix</div>
                      <input
                        value={String(cfg.name_prefix || '')}
                        onChange={(e) => updateActionConfig(idx, { name_prefix: e.target.value })}
                        placeholder="Auto-"
                        className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm outline-none focus:border-slate-400"
                      />
                    </label>
                    <div className="text-sm">
                      <div className="text-xs font-semibold text-slate-500 mb-1">Channels</div>
                      <div className="flex flex-wrap gap-2">
                        {CAMPAIGN_CHANNELS.map((ch) => {
                          const current = Array.isArray(cfg.channels) ? (cfg.channels as string[]) : [];
                          const checked = current.includes(ch);
                          return (
                            <label key={ch} className="inline-flex items-center gap-2 rounded-full border border-slate-200 bg-white px-3 py-1 text-xs font-semibold text-slate-600">
                              <input
                                type="checkbox"
                                checked={checked}
                                onChange={(e) => {
                                  const next = e.target.checked ? Array.from(new Set([...current, ch])) : current.filter((x) => x !== ch);
                                  updateActionConfig(idx, { channels: next });
                                }}
                              />
                              {ch}
                            </label>
                          );
                        })}
                      </div>
                    </div>
                  </div>
                )}

                {type === 'create_post' && (
                  <div className="mt-3 grid gap-3">
                    <label className="text-sm">
                      <div className="text-xs font-semibold text-slate-500 mb-1">Title</div>
                      <input
                        value={String(cfg.title || '')}
                        onChange={(e) => updateActionConfig(idx, { title: e.target.value })}
                        placeholder="Auto post"
                        className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm outline-none focus:border-slate-400"
                      />
                    </label>
                    <label className="text-sm">
                      <div className="text-xs font-semibold text-slate-500 mb-1">Content</div>
                      <textarea
                        value={String(cfg.content || '')}
                        onChange={(e) => updateActionConfig(idx, { content: e.target.value })}
                        rows={3}
                        placeholder="Draft content..."
                        className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm outline-none focus:border-slate-400 resize-none"
                      />
                    </label>
                  </div>
                )}

                {type === 'tag_contact' && (
                  <div className="mt-3">
                    <label className="text-sm">
                      <div className="text-xs font-semibold text-slate-500 mb-1">Tags (comma-separated)</div>
                      <input
                        value={String(cfg.tags || '')}
                        onChange={(e) => updateActionConfig(idx, { tags: e.target.value })}
                        placeholder="high_performer,vip"
                        className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm outline-none focus:border-slate-400"
                      />
                    </label>
                  </div>
                )}

                {type === 'delay' && (
                  <div className="mt-3 text-xs text-slate-500">
                    This step does nothing besides waiting. Use the Delay (seconds) field.
                  </div>
                )}
              </div>
            );
          })}
        </div>

        <button
          type="button"
          onClick={addAction}
          className="mt-4 inline-flex items-center gap-2 rounded-xl border border-slate-200 bg-white px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50"
        >
          <Plus size={14} /> Add action
        </button>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex gap-2">
          <button
            type="button"
            onClick={onSave}
            disabled={saving}
            className="inline-flex items-center gap-2 rounded-2xl bg-slate-950 px-5 py-2.5 text-sm font-semibold text-white hover:bg-slate-800 disabled:opacity-50"
          >
            Save
          </button>
          <button
            type="button"
            onClick={onTest}
            disabled={saving || !draft.id}
            className="inline-flex items-center gap-2 rounded-2xl border border-slate-200 bg-white px-5 py-2.5 text-sm font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-50"
          >
            Test
          </button>
        </div>

        {draft.id && onDelete && (
          <button
            type="button"
            onClick={onDelete}
            className="inline-flex items-center gap-2 rounded-2xl border border-red-200 bg-white px-5 py-2.5 text-sm font-semibold text-red-600 hover:bg-red-50"
          >
            <Trash2 size={14} /> Delete workflow
          </button>
        )}
      </div>
    </div>
  );
}

