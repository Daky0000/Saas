import { FormEvent, useEffect, useState } from 'react';
import { Bot, Check, ChevronDown, ChevronRight, Eye, EyeOff, Loader2, RotateCcw, Save } from 'lucide-react';
import { API_BASE_URL } from '../../utils/apiBase';

const authHeaders = (): Record<string, string> => {
  const token = typeof window !== 'undefined' ? localStorage.getItem('auth_token') : null;
  return token ? { Authorization: `Bearer ${token}` } : {};
};

const ANTHROPIC_MODELS = [
  { id: 'claude-haiku-4-5-20251001', label: 'Claude Haiku 4.5', note: 'Fastest · lowest cost' },
  { id: 'claude-sonnet-4-6', label: 'Claude Sonnet 4.6', note: 'Balanced · recommended' },
  { id: 'claude-opus-4-7', label: 'Claude Opus 4.7', note: 'Most capable · highest cost' },
];

type Config = {
  model: string;
  apiKeyMasked: string;
  enabled: boolean;
  systemPrompt: string | null;
  defaultSystemPrompt: string;
};

type Tab = 'general' | 'bots';

export default function AdminAIConfig() {
  const [config, setConfig] = useState<Config | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<Tab>('general');

  // General tab state
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<{ ok: boolean; message: string } | null>(null);
  const [saved, setSaved] = useState(false);
  const [model, setModel] = useState('claude-haiku-4-5-20251001');
  const [apiKey, setApiKey] = useState('');
  const [showKey, setShowKey] = useState(false);

  // AI Bots tab state
  const [promptText, setPromptText] = useState('');
  const [promptSaving, setPromptSaving] = useState(false);
  const [promptSaved, setPromptSaved] = useState(false);
  const [promptError, setPromptError] = useState<string | null>(null);
  const [showFormatGuide, setShowFormatGuide] = useState(false);

  useEffect(() => {
    setLoading(true);
    fetch(`${API_BASE_URL}/api/admin/ai-config`, { headers: authHeaders() })
      .then((r) => r.json())
      .then((data) => {
        if (data.config) {
          setConfig(data.config);
          setModel(data.config.model || 'claude-haiku-4-5-20251001');
          setApiKey(data.config.apiKeyMasked || '');
          setPromptText(data.config.systemPrompt || data.config.defaultSystemPrompt || '');
        }
      })
      .catch(() => setError('Failed to load AI config'))
      .finally(() => setLoading(false));
  }, []);

  const saveGeneral = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    setSaved(false);
    setSaving(true);
    try {
      const body: Record<string, string> = { model };
      if (apiKey && !apiKey.startsWith('••')) body.apiKey = apiKey;
      const res = await fetch(`${API_BASE_URL}/api/admin/ai-config`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', ...authHeaders() },
        body: JSON.stringify(body),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error((data as any).error || 'Save failed');
      setConfig(data.config);
      setApiKey(data.config.apiKeyMasked || '');
      setSaved(true);
      setTimeout(() => setSaved(false), 2500);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Save failed');
    } finally {
      setSaving(false);
    }
  };

  const testConnection = async () => {
    setTesting(true);
    setTestResult(null);
    try {
      const res = await fetch(`${API_BASE_URL}/api/admin/ai-config/test`, {
        method: 'POST',
        headers: authHeaders(),
      });
      const data = await res.json().catch(() => ({}));
      setTestResult({ ok: res.ok && (data as any).success, message: (data as any).message || (res.ok ? 'Connection successful' : 'Test failed') });
    } catch {
      setTestResult({ ok: false, message: 'Test request failed' });
    } finally {
      setTesting(false);
    }
  };

  const savePrompt = async () => {
    setPromptError(null);
    setPromptSaved(false);
    setPromptSaving(true);
    try {
      const res = await fetch(`${API_BASE_URL}/api/admin/ai-config`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', ...authHeaders() },
        body: JSON.stringify({ systemPrompt: promptText }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error((data as any).error || 'Save failed');
      setConfig(data.config);
      setPromptSaved(true);
      setTimeout(() => setPromptSaved(false), 2500);
    } catch (err) {
      setPromptError(err instanceof Error ? err.message : 'Save failed');
    } finally {
      setPromptSaving(false);
    }
  };

  const resetPrompt = () => {
    if (config?.defaultSystemPrompt) setPromptText(config.defaultSystemPrompt);
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-16">
        <Loader2 className="h-6 w-6 animate-spin text-slate-400" />
      </div>
    );
  }

  const hasKey = Boolean(config?.apiKeyMasked);
  const isCustomPrompt = config?.systemPrompt !== null && config?.systemPrompt !== undefined;

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      {/* Header */}
      <div className="flex items-center gap-3">
        <div className="flex h-10 w-10 items-center justify-center rounded-xl" style={{ background: 'linear-gradient(135deg,#a855f7,#22d3ee)' }}>
          <Bot className="h-5 w-5 text-white" />
        </div>
        <div>
          <h2 className="text-lg font-bold text-slate-900">AI Assistant</h2>
          <p className="text-sm text-slate-500">Configure the LLM that powers the chat widget</p>
        </div>
        <div className="ml-auto">
          <span className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-semibold ${hasKey ? 'bg-emerald-50 text-emerald-700' : 'bg-slate-100 text-slate-500'}`}>
            <span className={`h-1.5 w-1.5 rounded-full ${hasKey ? 'bg-emerald-500' : 'bg-slate-400'}`} />
            {hasKey ? 'Configured' : 'Not configured'}
          </span>
        </div>
      </div>

      {/* Tabs */}
      <div className="flex border-b border-slate-200">
        {(['general', 'bots'] as Tab[]).map((tab) => (
          <button
            key={tab}
            type="button"
            onClick={() => setActiveTab(tab)}
            className={`px-5 py-3 text-sm font-semibold border-b-2 -mb-px transition-colors capitalize ${
              activeTab === tab
                ? 'border-slate-950 text-slate-950'
                : 'border-transparent text-slate-500 hover:text-slate-800'
            }`}
          >
            {tab === 'general' ? 'General' : 'AI Bots'}
          </button>
        ))}
      </div>

      {/* ── General Tab ── */}
      {activeTab === 'general' && (
        <>
          <form onSubmit={saveGeneral} className="rounded-2xl border border-slate-200 bg-white p-6 space-y-5">
            {/* API Key */}
            <div>
              <label className="mb-1.5 block text-sm font-semibold text-slate-700">Anthropic API Key</label>
              <div className="relative">
                <input
                  type={showKey ? 'text' : 'password'}
                  value={apiKey}
                  onChange={(e) => setApiKey(e.target.value)}
                  placeholder={hasKey ? 'Leave unchanged or enter a new key' : 'sk-ant-…'}
                  className="w-full rounded-xl border border-slate-200 bg-slate-50 py-2.5 pl-3 pr-10 text-sm font-mono text-slate-900 placeholder-slate-400 outline-none focus:border-purple-400 focus:ring-1 focus:ring-purple-400"
                  autoComplete="off"
                />
                <button
                  type="button"
                  onClick={() => setShowKey((v) => !v)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600"
                >
                  {showKey ? <EyeOff size={16} /> : <Eye size={16} />}
                </button>
              </div>
              <p className="mt-1 text-xs text-slate-400">
                Get your key at{' '}
                <a href="https://console.anthropic.com" target="_blank" rel="noreferrer" className="text-purple-500 hover:underline">
                  console.anthropic.com
                </a>
                . Stored encrypted — never exposed in API responses.
              </p>
            </div>

            {/* Model selector */}
            <div>
              <label className="mb-2 block text-sm font-semibold text-slate-700">Model</label>
              <div className="grid gap-2">
                {ANTHROPIC_MODELS.map((m) => (
                  <label
                    key={m.id}
                    className={`flex cursor-pointer items-center gap-3 rounded-xl border px-4 py-3 transition-colors ${
                      model === m.id ? 'border-purple-400 bg-purple-50' : 'border-slate-200 bg-white hover:border-slate-300'
                    }`}
                  >
                    <input type="radio" name="model" value={m.id} checked={model === m.id} onChange={() => setModel(m.id)} className="accent-purple-500" />
                    <div className="flex-1">
                      <div className="text-sm font-semibold text-slate-900">{m.label}</div>
                      <div className="text-xs text-slate-500">{m.note}</div>
                    </div>
                    {model === m.id && <Check size={16} className="text-purple-500" />}
                  </label>
                ))}
              </div>
            </div>

            {error && <p className="rounded-xl bg-red-50 px-3 py-2 text-sm text-red-600">{error}</p>}

            <div className="flex items-center gap-3 pt-1">
              <button
                type="submit"
                disabled={saving}
                className="flex items-center gap-2 rounded-xl bg-slate-900 px-4 py-2.5 text-sm font-semibold text-white hover:bg-slate-700 disabled:opacity-50"
              >
                {saving ? <Loader2 size={15} className="animate-spin" /> : saved ? <Check size={15} /> : <Save size={15} />}
                {saving ? 'Saving…' : saved ? 'Saved!' : 'Save Changes'}
              </button>
              {hasKey && (
                <button
                  type="button"
                  onClick={testConnection}
                  disabled={testing}
                  className="flex items-center gap-2 rounded-xl border border-slate-200 px-4 py-2.5 text-sm font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-50"
                >
                  {testing ? <Loader2 size={15} className="animate-spin" /> : <Bot size={15} />}
                  {testing ? 'Testing…' : 'Test Connection'}
                </button>
              )}
            </div>

            {testResult && (
              <div className={`rounded-xl px-3 py-2 text-sm font-medium ${testResult.ok ? 'bg-emerald-50 text-emerald-700' : 'bg-red-50 text-red-600'}`}>
                {testResult.message}
              </div>
            )}
          </form>

          <div className="rounded-2xl border border-slate-200 bg-slate-50 px-5 py-4 text-sm text-slate-600 space-y-1.5">
            <p className="font-semibold text-slate-800">How it works</p>
            <ul className="list-disc list-inside space-y-1 text-slate-500">
              <li>The sparkle chat widget appears for all logged-in users</li>
              <li>Every message goes through your Anthropic API key — you control costs</li>
              <li>The API key is AES-256-GCM encrypted before being stored in the database</li>
              <li>Change the model any time; active chat sessions will use the new model immediately</li>
            </ul>
          </div>
        </>
      )}

      {/* ── AI Bots Tab ── */}
      {activeTab === 'bots' && (
        <div className="space-y-5">
          {/* Bot card */}
          <div className="rounded-2xl border border-slate-200 bg-white p-6 space-y-4">
            <div className="flex items-start justify-between gap-3">
              <div className="flex items-center gap-3">
                <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl" style={{ background: 'linear-gradient(135deg,#a855f7,#22d3ee)' }}>
                  <Bot className="h-4 w-4 text-white" />
                </div>
                <div>
                  <p className="text-sm font-bold text-slate-900">ContentFlow Chat Bot</p>
                  <p className="text-xs text-slate-500">Floating assistant visible to all logged-in users</p>
                </div>
              </div>
              {isCustomPrompt && (
                <span className="shrink-0 rounded-full bg-purple-50 px-2.5 py-1 text-xs font-semibold text-purple-700">Custom prompt</span>
              )}
            </div>

            <div>
              <div className="mb-1.5 flex items-center justify-between">
                <label className="text-sm font-semibold text-slate-700">System Prompt</label>
                <button
                  type="button"
                  onClick={resetPrompt}
                  className="flex items-center gap-1 text-xs text-slate-500 hover:text-slate-800"
                >
                  <RotateCcw size={12} />
                  Reset to default
                </button>
              </div>
              <textarea
                value={promptText}
                onChange={(e) => setPromptText(e.target.value)}
                rows={14}
                className="w-full resize-y rounded-xl border border-slate-200 bg-slate-50 px-3 py-2.5 text-sm text-slate-900 outline-none focus:border-purple-400 focus:ring-1 focus:ring-purple-400 font-mono leading-relaxed"
                placeholder="Enter the system prompt for the chat bot…"
              />
              <p className="mt-1 text-xs text-slate-400">
                Changes take effect immediately — no restart required. Clear the field and save to revert to the built-in default.
              </p>
            </div>

            {promptError && <p className="rounded-xl bg-red-50 px-3 py-2 text-sm text-red-600">{promptError}</p>}

            <div className="flex items-center gap-3 pt-1">
              <button
                type="button"
                onClick={savePrompt}
                disabled={promptSaving}
                className="flex items-center gap-2 rounded-xl bg-slate-900 px-4 py-2.5 text-sm font-semibold text-white hover:bg-slate-700 disabled:opacity-50"
              >
                {promptSaving ? <Loader2 size={15} className="animate-spin" /> : promptSaved ? <Check size={15} /> : <Save size={15} />}
                {promptSaving ? 'Saving…' : promptSaved ? 'Saved!' : 'Save Prompt'}
              </button>
            </div>
          </div>

          {/* Format guide — collapsible */}
          <div className="rounded-2xl border border-slate-200 bg-white overflow-hidden">
            <button
              type="button"
              onClick={() => setShowFormatGuide((v) => !v)}
              className="flex w-full items-center justify-between px-5 py-4 text-sm font-semibold text-slate-800 hover:bg-slate-50 transition-colors"
            >
              <span className="flex items-center gap-2">
                {showFormatGuide ? <ChevronDown size={15} className="text-slate-400" /> : <ChevronRight size={15} className="text-slate-400" />}
                Interactive Form Format Guide
              </span>
              <span className="text-[11px] font-normal text-slate-400">How the chat form cards work</span>
            </button>

            {showFormatGuide && (
              <div className="border-t border-slate-100 px-5 py-4 space-y-4 text-sm text-slate-600">
                <p className="text-slate-700">
                  When the AI responds with a numbered list of questions (each with sub-bullet options), the chat widget automatically renders them as an <strong>interactive form card</strong> — users click chips to answer instead of typing.
                </p>

                <div>
                  <p className="mb-2 text-xs font-bold uppercase tracking-widest text-slate-400">Required format in the prompt response:</p>
                  <pre className="rounded-xl bg-slate-50 border border-slate-200 px-4 py-3 text-xs text-slate-700 whitespace-pre-wrap font-mono leading-relaxed">{`[One short intro sentence:]

1. Question about topic or subject?
   - Suggestion A
   - Suggestion B
   - Suggestion C
   - Custom

2. Question about platform or format?
   - Option A
   - Option B
   - Custom

3. Question about tone or goal?
   - Option A
   - Option B
   - Custom`}</pre>
                </div>

                <div className="space-y-1.5">
                  <p className="text-xs font-bold uppercase tracking-widest text-slate-400">Rules that must be in your prompt:</p>
                  <ul className="list-disc list-inside space-y-1 text-xs text-slate-500">
                    <li>Use <code className="bg-slate-100 px-1 rounded">1. 2. 3.</code> for questions and <code className="bg-slate-100 px-1 rounded">- </code> for sub-options</li>
                    <li>Always include <code className="bg-slate-100 px-1 rounded">- Custom</code> as the final sub-bullet under every question</li>
                    <li>Keep each option under 55 characters</li>
                    <li>Max 4 questions per response</li>
                    <li>After user submits, AI must call the tool immediately — no more questions</li>
                  </ul>
                </div>

                <div className="rounded-xl bg-amber-50 border border-amber-200 px-4 py-3 text-xs text-amber-800">
                  <strong>Keep the TOOLS section</strong> in your prompt — removing it disables create_draft, schedule_post and other agentic actions.
                </div>
              </div>
            )}
          </div>

          <div className="rounded-2xl border border-slate-200 bg-slate-50 px-5 py-4 text-sm text-slate-600 space-y-1.5">
            <p className="font-semibold text-slate-800">Prompt tips</p>
            <ul className="list-disc list-inside space-y-1 text-slate-500">
              <li>Add your brand name, tone of voice, or content guidelines in a new section</li>
              <li>The bot uses this prompt on every message in real-time — no restart needed</li>
              <li>Reset to default restores the full built-in prompt (including interactive form rules)</li>
              <li>Clear the field and save to revert to the built-in default</li>
            </ul>
          </div>
        </div>
      )}
    </div>
  );
}
