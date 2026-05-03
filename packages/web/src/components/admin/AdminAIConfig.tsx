import { FormEvent, useEffect, useState } from 'react';
import { Bot, Check, Eye, EyeOff, Loader2, Save } from 'lucide-react';
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
};

export default function AdminAIConfig() {
  const [config, setConfig] = useState<Config | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<{ ok: boolean; message: string } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  const [model, setModel] = useState('claude-haiku-4-5-20251001');
  const [apiKey, setApiKey] = useState('');
  const [showKey, setShowKey] = useState(false);

  useEffect(() => {
    setLoading(true);
    fetch(`${API_BASE_URL}/api/admin/ai-config`, { headers: authHeaders() })
      .then((r) => r.json())
      .then((data) => {
        if (data.config) {
          setConfig(data.config);
          setModel(data.config.model || 'claude-haiku-4-5-20251001');
          setApiKey(data.config.apiKeyMasked || '');
        }
      })
      .catch(() => setError('Failed to load AI config'))
      .finally(() => setLoading(false));
  }, []);

  const save = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    setSaved(false);
    setSaving(true);
    try {
      const body: Record<string, string> = { model };
      // Only send the key if it's a real new key (not the masked placeholder)
      if (apiKey && !apiKey.startsWith('••')) {
        body.apiKey = apiKey;
      }
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

  if (loading) {
    return (
      <div className="flex items-center justify-center py-16">
        <Loader2 className="h-6 w-6 animate-spin text-slate-400" />
      </div>
    );
  }

  const hasKey = Boolean(config?.apiKeyMasked);

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

      <form onSubmit={save} className="rounded-2xl border border-slate-200 bg-white p-6 space-y-5">
        {/* API Key */}
        <div>
          <label className="mb-1.5 block text-sm font-semibold text-slate-700">
            Anthropic API Key
          </label>
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
                  model === m.id
                    ? 'border-purple-400 bg-purple-50'
                    : 'border-slate-200 bg-white hover:border-slate-300'
                }`}
              >
                <input
                  type="radio"
                  name="model"
                  value={m.id}
                  checked={model === m.id}
                  onChange={() => setModel(m.id)}
                  className="accent-purple-500"
                />
                <div className="flex-1">
                  <div className="text-sm font-semibold text-slate-900">{m.label}</div>
                  <div className="text-xs text-slate-500">{m.note}</div>
                </div>
                {model === m.id && <Check size={16} className="text-purple-500" />}
              </label>
            ))}
          </div>
        </div>

        {error && (
          <p className="rounded-xl bg-red-50 px-3 py-2 text-sm text-red-600">{error}</p>
        )}

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

      {/* Info box */}
      <div className="rounded-2xl border border-slate-200 bg-slate-50 px-5 py-4 text-sm text-slate-600 space-y-1.5">
        <p className="font-semibold text-slate-800">How it works</p>
        <ul className="list-disc list-inside space-y-1 text-slate-500">
          <li>The sparkle chat widget appears for all logged-in users</li>
          <li>Every message goes through your Anthropic API key — you control costs</li>
          <li>The API key is AES-256-GCM encrypted before being stored in the database</li>
          <li>Change the model any time; the current chat sessions will use the new model immediately</li>
        </ul>
      </div>
    </div>
  );
}
