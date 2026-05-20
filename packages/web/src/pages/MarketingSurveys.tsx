import { useState, useEffect, useCallback } from 'react';
import {
  ClipboardList, Plus, Trash2, BarChart2, ChevronRight,
  Star, ArrowLeft, Copy, ExternalLink, CheckSquare, AlignLeft,
  Radio, Hash, ChevronUp, ChevronDown, X, Check, TrendingUp, Users, Eye,
} from 'lucide-react';
import { surveysService, Survey, SurveyQuestion, SurveyAnalytics, QuestionAnalytics } from '../services/surveysService';

const STATUS_BADGE: Record<string, string> = {
  draft: 'bg-gray-100 text-gray-600',
  active: 'bg-green-100 text-green-700',
  closed: 'bg-red-100 text-red-600',
};

const Q_ICONS: Record<string, React.ReactNode> = {
  radio: <Radio size={14} />,
  checkbox: <CheckSquare size={14} />,
  rating: <Star size={14} />,
  nps: <Hash size={14} />,
  text: <AlignLeft size={14} />,
};

const Q_LABELS: Record<string, string> = {
  radio: 'Multiple Choice',
  checkbox: 'Checkboxes',
  rating: 'Star Rating',
  nps: 'NPS Score',
  text: 'Open Text',
};

// ── Survey List ──────────────────────────────────────────────────────────────

function SurveyList({ onSelect, onNew, onAnalytics }: { onSelect: (s: Survey) => void; onNew: () => void; onAnalytics: (s: Survey) => void }) {
  const [surveys, setSurveys] = useState<Survey[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try { setSurveys(await surveysService.listSurveys()); } catch (e) { setError(String(e)); }
    setLoading(false);
  }, []);

  useEffect(() => { load(); }, [load]);

  async function deleteSurvey(id: string) {
    if (!confirm('Delete this survey and all its responses?')) return;
    await surveysService.deleteSurvey(id);
    setSurveys(prev => prev.filter(s => s.id !== id));
  }

  async function duplicate(s: Survey) {
    const created = await surveysService.createSurvey({ title: `${s.title} (copy)`, description: s.description ?? undefined });
    const full = await surveysService.getSurvey(s.id);
    for (const q of (full.questions ?? [])) {
      await surveysService.addQuestion(created.id, { type: q.type, question: q.question, options: q.options, required: q.required, order_idx: q.order_idx, settings: q.settings });
    }
    load();
  }

  if (loading) return <div className="flex items-center justify-center py-24 text-gray-400 text-sm">Loading surveys…</div>;
  if (error) return <div className="py-8 text-center text-red-500 text-sm">{error}</div>;

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-xl font-semibold text-gray-900">Surveys</h1>
          <p className="text-sm text-gray-500 mt-0.5">Collect feedback from your audience with shareable surveys.</p>
        </div>
        <button onClick={onNew} className="flex items-center gap-1.5 px-4 py-2 bg-blue-600 text-white rounded-lg text-sm font-medium hover:bg-blue-700 transition-colors">
          <Plus size={15} /> New Survey
        </button>
      </div>

      {surveys.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-24 text-center">
          <ClipboardList size={40} className="text-gray-300 mb-3" />
          <p className="text-gray-500 text-sm font-medium">No surveys yet</p>
          <p className="text-gray-400 text-xs mt-1 mb-4">Create your first survey to start collecting responses.</p>
          <button onClick={onNew} className="px-4 py-2 bg-blue-600 text-white rounded-lg text-sm font-medium hover:bg-blue-700">Create survey</button>
        </div>
      ) : (
        <div className="grid gap-4">
          {surveys.map(s => (
            <div key={s.id} className="bg-white border border-gray-200 rounded-xl p-5 hover:shadow-sm transition-shadow">
              <div className="flex items-start justify-between gap-4">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-1">
                    <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${STATUS_BADGE[s.status]}`}>{s.status}</span>
                    <span className="text-xs text-gray-400">{s.response_count ?? 0} responses</span>
                  </div>
                  <h3 className="font-semibold text-gray-900 truncate">{s.title}</h3>
                  {s.description && <p className="text-sm text-gray-500 mt-0.5 truncate">{s.description}</p>}
                </div>
                <div className="flex items-center gap-1.5 shrink-0">
                  <button onClick={() => duplicate(s)} title="Duplicate" className="p-1.5 text-gray-400 hover:text-gray-600 rounded transition-colors"><Copy size={14} /></button>
                  <button onClick={() => onAnalytics(s)} title="Analytics" className="flex items-center gap-1 px-3 py-1.5 text-sm text-gray-600 font-medium border border-gray-200 rounded-lg hover:bg-gray-50 transition-colors">
                    <BarChart2 size={14} /> Results
                  </button>
                  <button onClick={() => deleteSurvey(s.id)} title="Delete" className="p-1.5 text-gray-400 hover:text-red-500 rounded transition-colors"><Trash2 size={14} /></button>
                  <button onClick={() => onSelect(s)} className="flex items-center gap-1 px-3 py-1.5 text-sm text-blue-600 font-medium border border-blue-200 rounded-lg hover:bg-blue-50 transition-colors">
                    Edit <ChevronRight size={14} />
                  </button>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ── New Survey Modal ─────────────────────────────────────────────────────────

function NewSurveyModal({ onClose, onCreate }: { onClose: () => void; onCreate: (s: Survey) => void }) {
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!title.trim()) return;
    setSaving(true);
    setError('');
    try {
      const s = await surveysService.createSurvey({ title: title.trim(), description: description.trim() || undefined });
      onCreate(s);
    } catch (e) { setError(String(e)); setSaving(false); }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
      <form onSubmit={submit} className="bg-white rounded-xl shadow-xl w-full max-w-md p-6">
        <h2 className="text-lg font-semibold text-gray-900 mb-4">Create survey</h2>
        <div className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Survey name <span className="text-red-400">*</span></label>
            <input value={title} onChange={e => setTitle(e.target.value)} className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" placeholder="e.g. Customer satisfaction survey" autoFocus />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Description <span className="text-gray-400 font-normal">(optional)</span></label>
            <textarea value={description} onChange={e => setDescription(e.target.value)} rows={2} className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 resize-none" placeholder="What is this survey about?" />
          </div>
        </div>
        {error && <p className="text-red-500 text-xs mt-3">{error}</p>}
        <div className="flex justify-end gap-2 mt-6">
          <button type="button" onClick={onClose} className="px-4 py-2 text-sm text-gray-600 hover:text-gray-800">Cancel</button>
          <button type="submit" disabled={!title.trim() || saving} className="px-4 py-2 bg-blue-600 text-white rounded-lg text-sm font-medium hover:bg-blue-700 disabled:opacity-50">
            {saving ? 'Creating…' : 'Create survey'}
          </button>
        </div>
      </form>
    </div>
  );
}

// ── Question Editor ──────────────────────────────────────────────────────────

function QuestionEditor({
  q, index, total, onChange, onDelete, onMoveUp, onMoveDown,
}: {
  q: SurveyQuestion; index: number; total: number;
  onChange: (updated: SurveyQuestion) => void;
  onDelete: () => void;
  onMoveUp: () => void;
  onMoveDown: () => void;
}) {
  const [newOption, setNewOption] = useState('');

  function addOption() {
    const v = newOption.trim();
    if (!v) return;
    onChange({ ...q, options: [...q.options, v] });
    setNewOption('');
  }

  function removeOption(i: number) {
    onChange({ ...q, options: q.options.filter((_, idx) => idx !== i) });
  }

  return (
    <div className="bg-white border border-gray-200 rounded-xl p-4 mb-3">
      <div className="flex items-center gap-2 mb-3">
        <span className="text-xs text-gray-400 font-medium w-5 text-center">{index + 1}</span>
        <div className="flex items-center gap-1.5 px-2 py-1 bg-gray-50 rounded-lg text-xs text-gray-600 border border-gray-100">
          {Q_ICONS[q.type]} {Q_LABELS[q.type]}
        </div>
        <div className="flex-1" />
        <label className="flex items-center gap-1.5 text-xs text-gray-500 cursor-pointer">
          <input type="checkbox" checked={q.required} onChange={e => onChange({ ...q, required: e.target.checked })} className="rounded" />
          Required
        </label>
        <button onClick={onMoveUp} disabled={index === 0} className="p-1 text-gray-300 hover:text-gray-500 disabled:opacity-30"><ChevronUp size={14} /></button>
        <button onClick={onMoveDown} disabled={index === total - 1} className="p-1 text-gray-300 hover:text-gray-500 disabled:opacity-30"><ChevronDown size={14} /></button>
        <button onClick={onDelete} className="p-1 text-gray-300 hover:text-red-400"><X size={14} /></button>
      </div>

      <input
        value={q.question}
        onChange={e => onChange({ ...q, question: e.target.value })}
        className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 mb-3"
        placeholder="Enter your question…"
      />

      {(q.type === 'radio' || q.type === 'checkbox') && (
        <div className="space-y-2">
          {q.options.map((opt, i) => (
            <div key={i} className="flex items-center gap-2">
              <div className="w-4 h-4 rounded-full border-2 border-gray-300 shrink-0" />
              <span className="flex-1 text-sm text-gray-700">{opt}</span>
              <button onClick={() => removeOption(i)} className="text-gray-300 hover:text-red-400"><X size={12} /></button>
            </div>
          ))}
          <div className="flex items-center gap-2 mt-1">
            <input
              value={newOption}
              onChange={e => setNewOption(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); addOption(); } }}
              className="flex-1 px-3 py-1.5 border border-dashed border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              placeholder="Add option…"
            />
            <button onClick={addOption} className="px-3 py-1.5 text-sm text-blue-600 hover:text-blue-700 font-medium">Add</button>
          </div>
        </div>
      )}

      {q.type === 'rating' && (
        <div className="flex items-center gap-2">
          {[1, 2, 3, 4, 5].map(n => <Star key={n} size={20} className="text-amber-400 fill-amber-400" />)}
          <span className="text-xs text-gray-400 ml-2">1 – 5 star scale</span>
        </div>
      )}

      {q.type === 'nps' && (
        <div className="flex gap-1">
          {Array.from({ length: 11 }, (_, i) => (
            <div key={i} className={`w-8 h-8 rounded text-xs font-medium flex items-center justify-center border ${i <= 6 ? 'bg-red-50 border-red-200 text-red-500' : i <= 8 ? 'bg-yellow-50 border-yellow-200 text-yellow-600' : 'bg-green-50 border-green-200 text-green-600'}`}>
              {i}
            </div>
          ))}
        </div>
      )}

      {q.type === 'text' && (
        <div className="px-3 py-2 border border-gray-100 rounded-lg bg-gray-50 text-sm text-gray-400 italic">Open-ended text answer</div>
      )}
    </div>
  );
}

// ── Add Question Button ──────────────────────────────────────────────────────

function AddQuestionMenu({ onAdd }: { onAdd: (type: SurveyQuestion['type']) => void }) {
  const [open, setOpen] = useState(false);
  const types: SurveyQuestion['type'][] = ['radio', 'checkbox', 'rating', 'nps', 'text'];

  return (
    <div className="relative">
      <button onClick={() => setOpen(p => !p)} className="flex items-center gap-2 w-full px-4 py-3 border-2 border-dashed border-gray-200 rounded-xl text-sm text-gray-500 hover:border-blue-400 hover:text-blue-600 transition-colors">
        <Plus size={16} /> Add question
      </button>
      {open && (
        <div className="absolute left-0 mt-1 w-48 bg-white border border-gray-200 rounded-xl shadow-lg z-10 py-1">
          {types.map(t => (
            <button key={t} onClick={() => { onAdd(t); setOpen(false); }} className="flex items-center gap-2.5 w-full px-4 py-2.5 text-sm text-gray-700 hover:bg-gray-50">
              <span className="text-gray-400">{Q_ICONS[t]}</span> {Q_LABELS[t]}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

// ── Survey Builder ───────────────────────────────────────────────────────────

function SurveyBuilder({ survey: initial, onBack, onSaved }: { survey: Survey; onBack: () => void; onSaved: (s: Survey) => void }) {
  const [survey, setSurvey] = useState<Survey>(initial);
  const [questions, setQuestions] = useState<SurveyQuestion[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState('');
  const [tab, setTab] = useState<'build' | 'settings' | 'share'>('build');
  const [linkCopied, setLinkCopied] = useState(false);

  const publicUrl = `${window.location.origin}/survey/${survey.id}`;

  useEffect(() => {
    surveysService.getSurvey(survey.id).then(s => {
      setSurvey(s);
      setQuestions(s.questions ?? []);
      setLoading(false);
    });
  }, [survey.id]);

  async function saveSurvey() {
    setSaving(true);
    setError('');
    try {
      const updated = await surveysService.updateSurvey(survey.id, { title: survey.title, description: survey.description, thank_you_message: survey.thank_you_message, status: survey.status });
      setSurvey(updated);

      // sync questions: delete removed, add new, update existing
      const orig = (initial.questions ?? []);
      const origIds = new Set(orig.map(q => q.id));
      const curIds = new Set(questions.map(q => q.id));

      for (const id of origIds) { if (!curIds.has(id)) await surveysService.deleteQuestion(survey.id, id); }
      for (const q of questions) {
        if (!origIds.has(q.id)) {
          await surveysService.addQuestion(survey.id, { type: q.type, question: q.question, options: q.options, required: q.required, order_idx: q.order_idx, settings: q.settings });
        } else {
          await surveysService.updateQuestion(survey.id, q.id, { question: q.question, options: q.options, required: q.required, order_idx: q.order_idx });
        }
      }

      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
      onSaved(updated);
    } catch (e) { setError(String(e)); }
    setSaving(false);
  }

  function addQuestion(type: SurveyQuestion['type']) {
    const tempId = `new-${Date.now()}`;
    setQuestions(prev => [...prev, {
      id: tempId, survey_id: survey.id, type, question: '', options: type === 'radio' || type === 'checkbox' ? ['Option 1', 'Option 2'] : [],
      required: false, order_idx: prev.length, settings: {},
    }]);
  }

  function updateQuestion(idx: number, updated: SurveyQuestion) {
    setQuestions(prev => prev.map((q, i) => i === idx ? updated : q));
  }

  function deleteQuestion(idx: number) {
    setQuestions(prev => prev.filter((_, i) => i !== idx));
  }

  function moveUp(idx: number) {
    if (idx === 0) return;
    setQuestions(prev => { const a = [...prev]; [a[idx - 1], a[idx]] = [a[idx], a[idx - 1]]; return a; });
  }

  function moveDown(idx: number) {
    if (idx === questions.length - 1) return;
    setQuestions(prev => { const a = [...prev]; [a[idx], a[idx + 1]] = [a[idx + 1], a[idx]]; return a; });
  }

  function copyLink() {
    navigator.clipboard.writeText(publicUrl);
    setLinkCopied(true);
    setTimeout(() => setLinkCopied(false), 2000);
  }

  if (loading) return <div className="flex items-center justify-center py-24 text-gray-400 text-sm">Loading survey…</div>;

  return (
    <div>
      {/* Header */}
      <div className="flex items-center gap-3 mb-6">
        <button onClick={onBack} className="p-1.5 text-gray-400 hover:text-gray-700 rounded-lg hover:bg-gray-100 transition-colors"><ArrowLeft size={18} /></button>
        <div className="flex-1 min-w-0">
          <input
            value={survey.title}
            onChange={e => setSurvey(s => ({ ...s, title: e.target.value }))}
            className="text-xl font-semibold text-gray-900 bg-transparent border-b border-transparent hover:border-gray-300 focus:border-blue-500 focus:outline-none w-full pb-0.5"
          />
        </div>
        <div className="flex items-center gap-2">
          <select
            value={survey.status}
            onChange={e => setSurvey(s => ({ ...s, status: e.target.value as Survey['status'] }))}
            className="text-sm border border-gray-200 rounded-lg px-3 py-1.5 focus:outline-none focus:ring-2 focus:ring-blue-500"
          >
            <option value="draft">Draft</option>
            <option value="active">Active</option>
            <option value="closed">Closed</option>
          </select>
          {error && <span className="text-red-500 text-xs">{error}</span>}
          <button onClick={saveSurvey} disabled={saving} className="flex items-center gap-1.5 px-4 py-2 bg-blue-600 text-white rounded-lg text-sm font-medium hover:bg-blue-700 disabled:opacity-60 transition-colors">
            {saving ? 'Saving…' : saved ? <><Check size={14} /> Saved</> : 'Save'}
          </button>
        </div>
      </div>

      {/* Tabs */}
      <div className="flex gap-1 border-b border-gray-200 mb-6">
        {(['build', 'settings', 'share'] as const).map(t => (
          <button key={t} onClick={() => setTab(t)} className={`px-4 py-2 text-sm font-medium capitalize border-b-2 transition-colors ${tab === t ? 'border-blue-600 text-blue-600' : 'border-transparent text-gray-500 hover:text-gray-700'}`}>
            {t}
          </button>
        ))}
      </div>

      {/* Build tab */}
      {tab === 'build' && (
        <div className="max-w-2xl">
          {questions.length === 0 && (
            <div className="text-center py-10 text-gray-400 text-sm mb-4">
              No questions yet. Add your first question below.
            </div>
          )}
          {questions.map((q, i) => (
            <QuestionEditor key={q.id} q={q} index={i} total={questions.length} onChange={u => updateQuestion(i, u)} onDelete={() => deleteQuestion(i)} onMoveUp={() => moveUp(i)} onMoveDown={() => moveDown(i)} />
          ))}
          <AddQuestionMenu onAdd={addQuestion} />
        </div>
      )}

      {/* Settings tab */}
      {tab === 'settings' && (
        <div className="max-w-xl space-y-6">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Survey description</label>
            <textarea value={survey.description ?? ''} onChange={e => setSurvey(s => ({ ...s, description: e.target.value }))} rows={3} className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 resize-none" placeholder="Describe the purpose of your survey…" />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Thank you message</label>
            <textarea value={survey.thank_you_message} onChange={e => setSurvey(s => ({ ...s, thank_you_message: e.target.value }))} rows={2} className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 resize-none" />
          </div>
        </div>
      )}

      {/* Share tab */}
      {tab === 'share' && (
        <div className="max-w-xl">
          <div className="bg-blue-50 border border-blue-100 rounded-xl p-5 mb-4">
            <p className="text-sm font-medium text-blue-800 mb-1">Public survey link</p>
            <p className="text-xs text-blue-600 mb-3">Anyone with this link can fill out your survey. Make sure the survey is set to <strong>Active</strong>.</p>
            <div className="flex items-center gap-2">
              <input readOnly value={publicUrl} className="flex-1 px-3 py-2 bg-white border border-blue-200 rounded-lg text-sm text-gray-700 focus:outline-none" />
              <button onClick={copyLink} className="flex items-center gap-1.5 px-3 py-2 bg-blue-600 text-white rounded-lg text-sm font-medium hover:bg-blue-700 transition-colors">
                {linkCopied ? <><Check size={14} /> Copied</> : <><Copy size={14} /> Copy</>}
              </button>
              <a href={publicUrl} target="_blank" rel="noopener noreferrer" className="p-2 text-blue-600 hover:text-blue-800"><ExternalLink size={16} /></a>
            </div>
          </div>
          <div className="bg-gray-50 border border-gray-200 rounded-xl p-5">
            <p className="text-sm font-medium text-gray-700 mb-2">Embed code</p>
            <pre className="bg-white border border-gray-200 rounded-lg p-3 text-xs text-gray-600 overflow-x-auto whitespace-pre-wrap">{`<iframe src="${publicUrl}" width="100%" height="600" frameborder="0" style="border:none;"></iframe>`}</pre>
            <button onClick={() => { navigator.clipboard.writeText(`<iframe src="${publicUrl}" width="100%" height="600" frameborder="0" style="border:none;"></iframe>`); }} className="mt-2 text-xs text-blue-600 hover:underline">Copy embed code</button>
          </div>
        </div>
      )}
    </div>
  );
}

// ── Survey Analytics ─────────────────────────────────────────────────────────

function NpsBar({ score }: { score: number }) {
  const pct = ((score + 100) / 200) * 100;
  return (
    <div className="mt-2">
      <div className="flex justify-between text-xs text-gray-400 mb-1"><span>-100</span><span>0</span><span>+100</span></div>
      <div className="relative h-3 rounded-full bg-gradient-to-r from-red-400 via-yellow-300 to-green-400">
        <div className="absolute top-1/2 -translate-y-1/2 -translate-x-1/2 w-4 h-4 bg-white border-2 border-gray-700 rounded-full shadow" style={{ left: `${pct}%` }} />
      </div>
      <p className="text-2xl font-bold text-center mt-2 text-gray-900">{score > 0 ? `+${score}` : score}</p>
    </div>
  );
}

function QuestionAnalyticsCard({ q, analytics }: { q: SurveyQuestion; analytics: QuestionAnalytics }) {
  return (
    <div className="bg-white border border-gray-200 rounded-xl p-5">
      <div className="flex items-center gap-2 mb-3">
        <span className="text-gray-400">{Q_ICONS[q.type]}</span>
        <p className="font-medium text-gray-900 text-sm">{q.question || <em className="text-gray-400">Untitled question</em>}</p>
      </div>

      {(analytics.type === 'radio' || analytics.type === 'checkbox') && (
        <div className="space-y-2">
          {Object.entries(analytics.counts).sort((a, b) => b[1] - a[1]).map(([opt, cnt]) => {
            const pct = analytics.total > 0 ? (cnt / analytics.total) * 100 : 0;
            return (
              <div key={opt}>
                <div className="flex justify-between text-sm mb-1">
                  <span className="text-gray-700">{opt}</span>
                  <span className="text-gray-500 font-medium">{cnt} ({pct.toFixed(0)}%)</span>
                </div>
                <div className="h-2 bg-gray-100 rounded-full overflow-hidden">
                  <div className="h-full bg-blue-500 rounded-full" style={{ width: `${pct}%` }} />
                </div>
              </div>
            );
          })}
          <p className="text-xs text-gray-400 mt-2">{analytics.total} responses</p>
        </div>
      )}

      {analytics.type === 'rating' && (
        <div>
          <div className="flex items-center gap-2 mb-3">
            <span className="text-3xl font-bold text-gray-900">{analytics.average.toFixed(1)}</span>
            <div className="flex">{[1, 2, 3, 4, 5].map(n => <Star key={n} size={18} className={n <= Math.round(analytics.average) ? 'text-amber-400 fill-amber-400' : 'text-gray-200'} />)}</div>
          </div>
          <div className="space-y-1">
            {[5, 4, 3, 2, 1].map(n => {
              const cnt = analytics.distribution[String(n)] ?? 0;
              const pct = analytics.total > 0 ? (cnt / analytics.total) * 100 : 0;
              return (
                <div key={n} className="flex items-center gap-2 text-xs">
                  <span className="w-4 text-gray-500">{n}</span>
                  <div className="flex-1 h-2 bg-gray-100 rounded-full overflow-hidden">
                    <div className="h-full bg-amber-400 rounded-full" style={{ width: `${pct}%` }} />
                  </div>
                  <span className="w-6 text-right text-gray-400">{cnt}</span>
                </div>
              );
            })}
          </div>
          <p className="text-xs text-gray-400 mt-2">{analytics.total} responses</p>
        </div>
      )}

      {analytics.type === 'nps' && (
        <div>
          <NpsBar score={Math.round(analytics.score)} />
          <div className="flex justify-around mt-4 text-center">
            <div><p className="text-xl font-bold text-green-600">{analytics.promoters}</p><p className="text-xs text-gray-400">Promoters (9-10)</p></div>
            <div><p className="text-xl font-bold text-yellow-500">{analytics.passives}</p><p className="text-xs text-gray-400">Passives (7-8)</p></div>
            <div><p className="text-xl font-bold text-red-500">{analytics.detractors}</p><p className="text-xs text-gray-400">Detractors (0-6)</p></div>
          </div>
        </div>
      )}

      {analytics.type === 'text' && (
        <div className="space-y-2 max-h-40 overflow-y-auto">
          {analytics.responses.length === 0 ? (
            <p className="text-sm text-gray-400">No text responses yet.</p>
          ) : analytics.responses.map((r, i) => (
            <div key={i} className="px-3 py-2 bg-gray-50 rounded-lg text-sm text-gray-700">"{r}"</div>
          ))}
          <p className="text-xs text-gray-400">{analytics.total} responses</p>
        </div>
      )}
    </div>
  );
}

function SurveyAnalyticsView({ survey, onBack }: { survey: Survey; onBack: () => void }) {
  const [analytics, setAnalytics] = useState<SurveyAnalytics | null>(null);
  const [questions, setQuestions] = useState<SurveyQuestion[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    Promise.all([surveysService.getAnalytics(survey.id), surveysService.getSurvey(survey.id)]).then(([a, s]) => {
      setAnalytics(a);
      setQuestions(s.questions ?? []);
      setLoading(false);
    }).catch(e => { setError(String(e)); setLoading(false); });
  }, [survey.id]);

  if (loading) return <div className="flex items-center justify-center py-24 text-gray-400 text-sm">Loading analytics…</div>;
  if (error) return <div className="py-8 text-center text-red-500 text-sm">{error}</div>;
  if (!analytics) return null;

  return (
    <div>
      <div className="flex items-center gap-3 mb-6">
        <button onClick={onBack} className="p-1.5 text-gray-400 hover:text-gray-700 rounded-lg hover:bg-gray-100 transition-colors"><ArrowLeft size={18} /></button>
        <div>
          <h1 className="text-xl font-semibold text-gray-900">{survey.title}</h1>
          <p className="text-sm text-gray-500">Survey analytics</p>
        </div>
      </div>

      <div className="grid grid-cols-3 gap-4 mb-8">
        <div className="bg-white border border-gray-200 rounded-xl p-5 flex items-center gap-4">
          <div className="w-10 h-10 rounded-lg bg-blue-50 flex items-center justify-center"><Users size={18} className="text-blue-600" /></div>
          <div><p className="text-2xl font-bold text-gray-900">{analytics.total_responses}</p><p className="text-xs text-gray-500">Total responses</p></div>
        </div>
        <div className="bg-white border border-gray-200 rounded-xl p-5 flex items-center gap-4">
          <div className="w-10 h-10 rounded-lg bg-green-50 flex items-center justify-center"><TrendingUp size={18} className="text-green-600" /></div>
          <div><p className="text-2xl font-bold text-gray-900">{analytics.completion_rate.toFixed(0)}%</p><p className="text-xs text-gray-500">Completion rate</p></div>
        </div>
        <div className="bg-white border border-gray-200 rounded-xl p-5 flex items-center gap-4">
          <div className="w-10 h-10 rounded-lg bg-purple-50 flex items-center justify-center"><Eye size={18} className="text-purple-600" /></div>
          <div><p className="text-2xl font-bold text-gray-900">{questions.length}</p><p className="text-xs text-gray-500">Questions</p></div>
        </div>
      </div>

      <div className="grid gap-4">
        {questions.map(q => {
          const qa = analytics.questions[q.id];
          if (!qa) return null;
          return <QuestionAnalyticsCard key={q.id} q={q} analytics={qa} />;
        })}
        {questions.length === 0 && <p className="text-center text-gray-400 text-sm py-8">No questions in this survey.</p>}
      </div>
    </div>
  );
}

// ── Main export ──────────────────────────────────────────────────────────────

type View = { mode: 'list' } | { mode: 'builder'; survey: Survey } | { mode: 'analytics'; survey: Survey };

export default function MarketingSurveys() {
  const [view, setView] = useState<View>({ mode: 'list' });
  const [newOpen, setNewOpen] = useState(false);

  function handleNew() { setNewOpen(true); }
  function handleCreated(s: Survey) { setNewOpen(false); setView({ mode: 'builder', survey: s }); }

  return (
    <div className="p-6 max-w-4xl mx-auto">
      {view.mode === 'list' && (
        <SurveyList
          onSelect={s => setView({ mode: 'builder', survey: s })}
          onNew={handleNew}
          onAnalytics={s => setView({ mode: 'analytics', survey: s })}
        />
      )}

      {view.mode === 'builder' && (
        <SurveyBuilder
          survey={view.survey}
          onBack={() => setView({ mode: 'list' })}
          onSaved={s => setView({ mode: 'builder', survey: s })}
        />
      )}

      {view.mode === 'analytics' && (
        <SurveyAnalyticsView
          survey={view.survey}
          onBack={() => setView({ mode: 'list' })}
        />
      )}

      {newOpen && <NewSurveyModal onClose={() => setNewOpen(false)} onCreate={handleCreated} />}
    </div>
  );
}
