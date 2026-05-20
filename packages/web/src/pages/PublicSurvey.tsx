import { useState, useEffect } from 'react';
import { Star } from 'lucide-react';
import { surveysService, Survey, SurveyQuestion } from '../services/surveysService';

function StarRating({ value, onChange }: { value: number; onChange: (v: number) => void }) {
  const [hover, setHover] = useState(0);
  return (
    <div className="flex gap-1">
      {[1, 2, 3, 4, 5].map(n => (
        <button key={n} type="button" onMouseEnter={() => setHover(n)} onMouseLeave={() => setHover(0)} onClick={() => onChange(n)} className="focus:outline-none">
          <Star size={28} className={n <= (hover || value) ? 'text-amber-400 fill-amber-400' : 'text-gray-300'} />
        </button>
      ))}
    </div>
  );
}

function NpsSelector({ value, onChange }: { value: number | null; onChange: (v: number) => void }) {
  return (
    <div>
      <div className="flex gap-1 flex-wrap">
        {Array.from({ length: 11 }, (_, i) => (
          <button
            key={i} type="button" onClick={() => onChange(i)}
            className={`w-10 h-10 rounded-lg text-sm font-medium border transition-all ${value === i ? 'bg-blue-600 text-white border-blue-600' : i <= 6 ? 'border-red-200 text-red-500 hover:bg-red-50' : i <= 8 ? 'border-yellow-200 text-yellow-600 hover:bg-yellow-50' : 'border-green-200 text-green-600 hover:bg-green-50'}`}
          >{i}</button>
        ))}
      </div>
      <div className="flex justify-between mt-1 text-xs text-gray-400">
        <span>Not at all likely</span><span>Extremely likely</span>
      </div>
    </div>
  );
}

function QuestionField({
  q, value, onChange,
}: {
  q: SurveyQuestion;
  value: unknown;
  onChange: (v: unknown) => void;
}) {
  return (
    <div className="mb-6">
      <label className="block text-sm font-semibold text-gray-900 mb-2">
        {q.question}
        {q.required && <span className="text-red-400 ml-1">*</span>}
      </label>

      {q.type === 'radio' && (
        <div className="space-y-2">
          {q.options.map((opt, i) => (
            <label key={i} className="flex items-center gap-3 cursor-pointer group">
              <div className={`w-5 h-5 rounded-full border-2 flex items-center justify-center transition-all ${value === opt ? 'border-blue-600 bg-blue-600' : 'border-gray-300 group-hover:border-blue-400'}`}>
                {value === opt && <div className="w-2 h-2 bg-white rounded-full" />}
              </div>
              <input type="radio" className="sr-only" name={q.id} value={opt} checked={value === opt} onChange={() => onChange(opt)} />
              <span className="text-sm text-gray-700">{opt}</span>
            </label>
          ))}
        </div>
      )}

      {q.type === 'checkbox' && (
        <div className="space-y-2">
          {q.options.map((opt, i) => {
            const checked = Array.isArray(value) && (value as string[]).includes(opt);
            return (
              <label key={i} className="flex items-center gap-3 cursor-pointer group">
                <div className={`w-5 h-5 rounded border-2 flex items-center justify-center transition-all ${checked ? 'border-blue-600 bg-blue-600' : 'border-gray-300 group-hover:border-blue-400'}`}>
                  {checked && <svg className="w-3 h-3 text-white" fill="none" viewBox="0 0 12 12"><path d="M2 6l3 3 5-5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" /></svg>}
                </div>
                <input type="checkbox" className="sr-only" checked={checked} onChange={() => {
                  const arr = Array.isArray(value) ? [...(value as string[])] : [];
                  onChange(checked ? arr.filter(v => v !== opt) : [...arr, opt]);
                }} />
                <span className="text-sm text-gray-700">{opt}</span>
              </label>
            );
          })}
        </div>
      )}

      {q.type === 'rating' && (
        <StarRating value={typeof value === 'number' ? value : 0} onChange={onChange} />
      )}

      {q.type === 'nps' && (
        <NpsSelector value={typeof value === 'number' ? value : null} onChange={onChange} />
      )}

      {q.type === 'text' && (
        <textarea
          value={typeof value === 'string' ? value : ''}
          onChange={e => onChange(e.target.value)}
          rows={4}
          className="w-full px-4 py-3 border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 resize-none"
          placeholder="Your answer…"
        />
      )}
    </div>
  );
}

export default function PublicSurvey({ surveyId }: { surveyId: string }) {
  const [survey, setSurvey] = useState<Survey | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [answers, setAnswers] = useState<Record<string, unknown>>({});
  const [email, setEmail] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [validationErrors, setValidationErrors] = useState<Record<string, string>>({});

  useEffect(() => {
    surveysService.getPublicSurvey(surveyId).then(s => {
      setSurvey(s);
      setLoading(false);
    }).catch(e => { setError(String(e)); setLoading(false); });
  }, [surveyId]);

  function validate() {
    const errs: Record<string, string> = {};
    for (const q of (survey?.questions ?? [])) {
      if (!q.required) continue;
      const v = answers[q.id];
      if (v === undefined || v === '' || v === null) errs[q.id] = 'This question is required.';
      if (Array.isArray(v) && v.length === 0) errs[q.id] = 'Please select at least one option.';
    }
    return errs;
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const errs = validate();
    if (Object.keys(errs).length > 0) { setValidationErrors(errs); return; }
    setSubmitting(true);
    try {
      await surveysService.submitResponse(surveyId, {
        respondent_email: email.trim() || undefined,
        answers: Object.entries(answers).map(([question_id, value]) => ({ question_id, value })),
      });
      setSubmitted(true);
    } catch (e) { setError(String(e)); }
    setSubmitting(false);
  }

  if (loading) return (
    <div className="min-h-screen bg-gray-50 flex items-center justify-center">
      <div className="text-gray-400 text-sm">Loading survey…</div>
    </div>
  );

  if (error || !survey) return (
    <div className="min-h-screen bg-gray-50 flex items-center justify-center">
      <div className="text-center">
        <p className="text-gray-500 text-lg font-medium mb-2">Survey not found</p>
        <p className="text-gray-400 text-sm">{error || 'This survey may have been removed or is no longer active.'}</p>
      </div>
    </div>
  );

  if (survey.status !== 'active') return (
    <div className="min-h-screen bg-gray-50 flex items-center justify-center">
      <div className="text-center">
        <p className="text-gray-500 text-lg font-medium mb-2">Survey closed</p>
        <p className="text-gray-400 text-sm">This survey is no longer accepting responses.</p>
      </div>
    </div>
  );

  if (submitted) return (
    <div className="min-h-screen bg-gray-50 flex items-center justify-center">
      <div className="text-center max-w-md">
        <div className="w-16 h-16 bg-green-100 rounded-full flex items-center justify-center mx-auto mb-4">
          <svg className="w-8 h-8 text-green-600" fill="none" viewBox="0 0 24 24"><path d="M5 13l4 4L19 7" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" /></svg>
        </div>
        <h2 className="text-2xl font-bold text-gray-900 mb-2">Thank you!</h2>
        <p className="text-gray-500">{survey.thank_you_message}</p>
      </div>
    </div>
  );

  return (
    <div className="min-h-screen bg-gray-50 py-12 px-4">
      <div className="max-w-xl mx-auto">
        <div className="bg-white rounded-2xl shadow-sm border border-gray-200 overflow-hidden">
          {/* Header */}
          <div className="bg-gradient-to-r from-blue-600 to-indigo-600 px-8 py-8">
            <h1 className="text-2xl font-bold text-white mb-2">{survey.title}</h1>
            {survey.description && <p className="text-blue-100 text-sm">{survey.description}</p>}
          </div>

          <form onSubmit={handleSubmit} className="px-8 py-8">
            {/* Optional email */}
            <div className="mb-6 pb-6 border-b border-gray-100">
              <label className="block text-sm font-medium text-gray-700 mb-1">Your email <span className="text-gray-400 font-normal">(optional)</span></label>
              <input type="email" value={email} onChange={e => setEmail(e.target.value)} className="w-full px-4 py-2.5 border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" placeholder="you@example.com" />
            </div>

            {/* Questions */}
            {(survey.questions ?? []).sort((a, b) => a.order_idx - b.order_idx).map(q => (
              <div key={q.id}>
                <QuestionField
                  q={q}
                  value={answers[q.id]}
                  onChange={v => {
                    setAnswers(prev => ({ ...prev, [q.id]: v }));
                    setValidationErrors(prev => { const n = { ...prev }; delete n[q.id]; return n; });
                  }}
                />
                {validationErrors[q.id] && <p className="text-red-500 text-xs -mt-4 mb-4">{validationErrors[q.id]}</p>}
              </div>
            ))}

            {error && <p className="text-red-500 text-sm mb-4">{error}</p>}

            <button type="submit" disabled={submitting} className="w-full py-3 bg-blue-600 text-white rounded-xl font-semibold hover:bg-blue-700 disabled:opacity-60 transition-colors">
              {submitting ? 'Submitting…' : 'Submit'}
            </button>
          </form>
        </div>
      </div>
    </div>
  );
}
