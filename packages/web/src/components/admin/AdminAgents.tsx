import { useEffect, useState } from 'react';
import { CheckCircle, Loader2, RefreshCw, Save } from 'lucide-react';
import { getApiBaseUrl } from '../../utils/apiBase';

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

function tok() {
  return localStorage.getItem('auth_token') ?? '';
}

export default function AdminAgents() {
  const [templates, setTemplates] = useState<AgentTemplate[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState<Record<string, boolean>>({});
  const [saved, setSaved] = useState<Record<string, boolean>>({});
  const [prompts, setPrompts] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetch(`${getApiBaseUrl()}/api/admin/agent-templates`, {
      headers: { Authorization: `Bearer ${tok()}` },
    })
      .then((r) => r.json())
      .then((d) => {
        if (!d.success) throw new Error(d.error || 'Failed to load');
        setTemplates(d.templates);
        const map: Record<string, string> = {};
        for (const t of d.templates) map[t.agent_key] = t.base_prompt;
        setPrompts(map);
      })
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }, []);

  const save = async (key: string) => {
    setSaving((p) => ({ ...p, [key]: true }));
    setSaved((p) => ({ ...p, [key]: false }));
    try {
      const res = await fetch(`${getApiBaseUrl()}/api/admin/agent-templates/${key}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${tok()}` },
        body: JSON.stringify({ base_prompt: prompts[key] }),
      });
      const d = await res.json();
      if (!d.success) throw new Error(d.error || 'Save failed');
      setTemplates((prev) => prev.map((t) => t.agent_key === key ? d.template : t));
      setSaved((p) => ({ ...p, [key]: true }));
      setTimeout(() => setSaved((p) => ({ ...p, [key]: false })), 2000);
    } catch (e: any) {
      setError(e.message);
    } finally {
      setSaving((p) => ({ ...p, [key]: false }));
    }
  };

  if (loading) {
    return (
      <div className="flex items-center gap-3 py-12 justify-center text-slate-500">
        <Loader2 size={18} className="animate-spin" /> Loading agent templates…
      </div>
    );
  }

  if (error) {
    return (
      <div className="rounded-2xl border border-red-200 bg-red-50 p-6 text-sm text-red-700">{error}</div>
    );
  }

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl font-black tracking-[-0.03em] text-slate-950">Agent Team</h2>
        <p className="mt-1.5 text-sm text-slate-500">
          Edit the base system prompt for each agent. These are injected on every team analysis and execution.
          User-specific compiled skills are layered on top at runtime.
        </p>
      </div>

      <div className="grid gap-5 sm:grid-cols-1 xl:grid-cols-2">
        {templates.map((t) => (
          <div key={t.agent_key} className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
            {/* Header */}
            <div className="flex items-center gap-3 mb-4">
              <div
                className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl text-xl font-bold"
                style={{ background: `${t.color}18`, color: t.color }}
              >
                {t.icon}
              </div>
              <div className="flex-1 min-w-0">
                <p className="font-black text-slate-900" style={{ color: t.color }}>{t.name}</p>
                <p className="text-xs text-slate-500">{t.role}</p>
              </div>
              {t.memory_keywords.length > 0 && (
                <div className="flex flex-wrap gap-1">
                  {t.memory_keywords.slice(0, 3).map((k) => (
                    <span key={k} className="rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-semibold text-slate-500">
                      {k}
                    </span>
                  ))}
                </div>
              )}
            </div>

            {/* Prompt editor */}
            <textarea
              value={prompts[t.agent_key] ?? ''}
              onChange={(e) => setPrompts((p) => ({ ...p, [t.agent_key]: e.target.value }))}
              rows={7}
              className="w-full resize-none rounded-xl border border-slate-200 bg-slate-50 px-3.5 py-3 text-sm text-slate-800 leading-relaxed outline-none focus:border-indigo-300 focus:ring-1 focus:ring-indigo-300 font-mono"
              placeholder="Enter agent system prompt…"
            />

            {/* Actions */}
            <div className="mt-3 flex items-center justify-between">
              <p className="text-[11px] text-slate-400">
                Last updated: {new Date(t.updated_at).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })}
              </p>
              <button
                type="button"
                disabled={saving[t.agent_key]}
                onClick={() => save(t.agent_key)}
                className="flex items-center gap-1.5 rounded-xl px-4 py-2 text-xs font-bold transition-colors disabled:opacity-50"
                style={{ background: saved[t.agent_key] ? '#10B981' : t.color, color: '#fff' }}
              >
                {saving[t.agent_key] ? (
                  <><RefreshCw size={12} className="animate-spin" /> Saving…</>
                ) : saved[t.agent_key] ? (
                  <><CheckCircle size={12} /> Saved</>
                ) : (
                  <><Save size={12} /> Save Prompt</>
                )}
              </button>
            </div>
          </div>
        ))}
      </div>

      <div className="rounded-2xl border border-slate-200 bg-slate-50 p-5">
        <p className="text-xs font-bold text-slate-600 mb-2">How agent compilation works</p>
        <ul className="space-y-1.5 text-xs text-slate-500">
          <li>• When a user saves or updates their memory, all 5 agents are recompiled in the background.</li>
          <li>• Each agent uses Haiku to extract the most relevant memory items for their specialty.</li>
          <li>• The compiled skill is injected into the agent's system prompt at execution time.</li>
          <li>• Daky (orchestrator) sees all memory; Nova, Sage, Aria, Flux filter by keyword relevance.</li>
        </ul>
      </div>
    </div>
  );
}
