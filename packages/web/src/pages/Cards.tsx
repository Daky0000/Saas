import { useState, useEffect, useRef, useCallback } from 'react';
import {
  Plus, Sparkles, Wand2,
  CheckCircle2, Loader2, RefreshCw, ChevronRight, ChevronDown, Download, Edit3,
  AlertCircle, Layers, Trash2, Clock, Image, LayoutTemplate,
  Heart, Eye, Copy, Play, X, Video, Maximize2, Undo2, Redo2,
} from 'lucide-react';
import { UserDesign, designService } from '../services/designService';
import { getApiBaseUrl } from '../utils/apiBase';

// ── Helpers ───────────────────────────────────────────────────────────────────

function tok() { return localStorage.getItem('auth_token') ?? ''; }

// ── Credit badge ──────────────────────────────────────────────────────────────

function CreditBadge() {
  const [credits, setCredits] = useState<number | null>(null);

  useEffect(() => {
    fetch(`${getApiBaseUrl()}/api/credits/balance`, {
      headers: { Authorization: `Bearer ${tok()}` },
    })
      .then((r) => r.json())
      .then((d) => { if (d.success) setCredits(d.credits); })
      .catch(() => {});
  }, []);

  if (credits === null) return null;

  return (
    <div className="flex items-center gap-1.5 rounded-full border border-indigo-200 bg-indigo-50 px-3 py-1 text-xs font-bold text-[#5b6cf9]">
      <span className="text-sm">✦</span>
      <span>{credits} credits</span>
    </div>
  );
}

// ── Inspiration card ──────────────────────────────────────────────────────────

function InspirationCard({ design }: { design: { title: string; style: string; colors: string; prompt: string; model: string; thumbnail_description: string } }) {
  return (
    <div className="rounded-xl border border-slate-200 bg-white p-3 space-y-1.5">
      <div className="aspect-square rounded-lg bg-gradient-to-br from-slate-100 to-slate-200 flex items-center justify-center overflow-hidden">
        <div className="p-3 text-center">
          <Layers size={20} className="text-slate-400 mx-auto mb-1" />
          <p className="text-[10px] text-slate-400 leading-tight">{design.thumbnail_description}</p>
        </div>
      </div>
      <p className="text-xs font-semibold text-slate-800 truncate">{design.title}</p>
      <p className="text-[10px] text-slate-500 truncate">{design.style}</p>
      <span className="inline-block rounded-full bg-slate-100 px-1.5 py-0.5 text-[9px] font-mono text-slate-500">{design.model}</span>
    </div>
  );
}

// ── Workflow step indicator ────────────────────────────────────────────────────

function StepIndicator({ steps }: { steps: { id: string; name: string; status: 'pending' | 'running' | 'done' | 'error' }[] }) {
  return (
    <div className="space-y-1.5">
      {steps.map((s) => (
        <div key={s.id} className="flex items-center gap-2.5 text-sm">
          <div className="shrink-0 w-5 h-5 flex items-center justify-center">
            {s.status === 'done'    && <CheckCircle2 size={16} className="text-emerald-500" />}
            {s.status === 'running' && <Loader2      size={16} className="animate-spin text-[#5b6cf9]" />}
            {s.status === 'error'   && <AlertCircle  size={16} className="text-red-400" />}
            {s.status === 'pending' && <div className="w-4 h-4 rounded-full border-2 border-slate-200" />}
          </div>
          <span className={
            s.status === 'running' ? 'font-semibold text-[#5b6cf9]' :
            s.status === 'done'    ? 'text-slate-700' :
            s.status === 'error'   ? 'text-red-500' :
            'text-slate-400'
          }>{s.name}</span>
        </div>
      ))}
    </div>
  );
}

// ── Model definitions ─────────────────────────────────────────────────────────

type GenMode = 'image' | 'video';

interface AIModel {
  id: string;
  label: string;
  desc: string;
  creditCost: number;
  badge?: string;
}

const IMAGE_MODELS: AIModel[] = [
  { id: 'nano_banana_2',     label: 'Nano Banana 2',    desc: 'Fast & affordable',    creditCost: 3 },
  { id: 'flux-1.1-pro',     label: 'Flux 1.1 Pro',     desc: 'High quality',         creditCost: 5, badge: 'Popular' },
  { id: 'nano_banana_pro',  label: 'Nano Banana Pro',  desc: "Google's flagship",    creditCost: 8 },
];

const VIDEO_MODELS: AIModel[] = [
  { id: 'seedance-1-lite',   label: 'Seedance Lite',   desc: 'Fast motion video',   creditCost: 20 },
  { id: 'higgsfield-video',  label: 'Higgsfield Pro',  desc: 'Cinematic quality',   creditCost: 35 },
];

// ── AI Studio tab ─────────────────────────────────────────────────────────────

type UIStep = { id: string; name: string; status: 'pending' | 'running' | 'done' | 'error' };
type StudioPhase = 'idle' | 'running' | 'prompt_review' | 'generating' | 'done' | 'error';

const DEFAULT_STEPS: UIStep[] = [
  { id: 'step_search',  name: 'Search Designs',        status: 'pending' },
  { id: 'step_extract', name: 'Extract Style Prompts',  status: 'pending' },
  { id: 'step_tailor',  name: 'Tailor to Brand',        status: 'pending' },
  { id: 'step_generate',name: 'Generate Image',         status: 'pending' },
  { id: 'step_save',    name: 'Save Design',            status: 'pending' },
];

type Suggestion = { id: string; title: string; description: string; hint: string };

function AIStudio({ onDesignSaved }: { onDesignSaved: (d: UserDesign) => void }) {
  const [phase, setPhase]             = useState<StudioPhase>('idle');
  const [description, setDescription] = useState('');
  const [steps, setSteps]             = useState<UIStep[]>(DEFAULT_STEPS);
  const [inspirations, setInspirations] = useState<any[]>([]);
  const [promptText, setPromptText]   = useState('');
  const [promptModel, setPromptModel] = useState('flux-1.1-pro');
  const [, setHasMemory]              = useState(true);
  const [imageUrl, setImageUrl]       = useState<string | null>(null);
  const [savedDesignId, setSavedDesignId] = useState<string | null>(null);
  const [errorMsg, setErrorMsg]       = useState<string | null>(null);
  const [generating, setGenerating]   = useState(false);
  const readerRef = useRef<ReadableStreamDefaultReader | null>(null);

  // GenMode & model picker
  const [genMode, setGenMode]         = useState<GenMode>('image');
  const [selectedImageModel, setSelectedImageModel] = useState<AIModel>(IMAGE_MODELS[1]);
  const [selectedVideoModel, setSelectedVideoModel] = useState<AIModel>(VIDEO_MODELS[0]);
  const [videoPrompt, setVideoPrompt] = useState('');
  const [generatingVideo, setGeneratingVideo] = useState(false);
  const [videoUrl, setVideoUrl]       = useState<string | null>(null);

  // Suggestions
  const [suggestions, setSuggestions]         = useState<Suggestion[]>([]);
  const [loadingSuggestions, setLoadingSugg]  = useState(false);
  const [suggHasMemory, setSuggHasMemory]     = useState(false);

  const currentModel = genMode === 'image' ? selectedImageModel : selectedVideoModel;

  useEffect(() => {
    setLoadingSugg(true);
    fetch(`${getApiBaseUrl()}/api/nova/suggestions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${tok()}` },
      body: JSON.stringify({}),
    })
      .then((r) => r.json())
      .then((d) => {
        if (d.success) {
          setSuggestions(d.suggestions ?? []);
          setSuggHasMemory(!!d.has_memory);
        }
      })
      .catch(() => {})
      .finally(() => setLoadingSugg(false));
  }, []);

  const resetState = () => {
    setPhase('idle');
    setSteps(DEFAULT_STEPS.map((s) => ({ ...s, status: 'pending' })));
    setInspirations([]);
    setPromptText('');
    setImageUrl(null);
    setSavedDesignId(null);
    setErrorMsg(null);
    setVideoUrl(null);
  };

  const updateStep = (id: string, status: UIStep['status']) => {
    setSteps((prev) => prev.map((s) => s.id === id ? { ...s, status } : s));
  };

  const generate = async (autoMode = true) => {
    if (!description.trim()) return;
    resetState();
    setPhase('running');

    try {
      const resp = await fetch(`${getApiBaseUrl()}/api/nova/design`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${tok()}` },
        body: JSON.stringify({ description: description.trim(), auto: autoMode }),
      });

      if (!resp.ok || !resp.body) {
        const err = await resp.json().catch(() => ({ error: 'Request failed' }));
        setErrorMsg(err.error ?? 'Request failed');
        setPhase('error');
        return;
      }

      const reader = resp.body.getReader();
      readerRef.current = reader;
      const decoder = new TextDecoder();
      let buffer = '';

      const processEvent = (_event: string, raw: string) => {
        let data: any;
        try { data = JSON.parse(raw); } catch { return; }

        switch (data.type) {
          case 'step_start':
            updateStep(data.step_id, 'running');
            break;
          case 'step_done':
            updateStep(data.step_id, data.error ? 'error' : 'done');
            break;
          case 'inspirations':
            setInspirations(data.designs ?? []);
            break;
          case 'prompt_ready':
            setPromptText(data.prompt ?? '');
            setPromptModel(data.model ?? 'flux-1.1-pro');
            setHasMemory(!!data.has_memory);
            if (data.needs_input) {
              setPhase('prompt_review');
            }
            break;
          case 'step_progress':
            if (data.step_id === 'step_generate') setPhase('generating');
            break;
          case 'image_ready':
            setImageUrl(data.url ?? null);
            break;
          case 'saved':
            setSavedDesignId(data.design_id ?? null);
            break;
          case 'error':
            setErrorMsg(data.message ?? 'An error occurred');
            setPhase('error');
            break;
          case 'done':
            if (phase !== 'error' && phase !== 'prompt_review') {
              setPhase('done');
            }
            break;
        }
      };

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() ?? '';
        let currentData = '';
        for (const line of lines) {
          if (line.startsWith('data: ')) {
            currentData = line.slice(6);
          } else if (line === '') {
            if (currentData) processEvent('data', currentData);
            currentData = '';
          }
        }
      }

      setPhase((prev) => prev === 'running' || prev === 'generating' ? 'done' : prev);

    } catch (err: any) {
      if (err.name !== 'AbortError') {
        setErrorMsg(err.message ?? 'Workflow failed');
        setPhase('error');
      }
    }
  };

  const generateFromPrompt = async () => {
    if (!promptText.trim()) return;
    setGenerating(true);
    setPhase('generating');
    try {
      const res = await fetch(`${getApiBaseUrl()}/api/nova/generate-image`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${tok()}` },
        body: JSON.stringify({ prompt: promptText.trim(), model: promptModel, save: true }),
      });
      const d = await res.json();
      if (!d.success) throw new Error(d.error ?? 'Generation failed');
      setImageUrl(d.url ?? null);
      setSavedDesignId(d.design_id ?? null);
      setPhase('done');
    } catch (err: any) {
      setErrorMsg(err.message ?? 'Generation failed');
      setPhase('error');
    } finally {
      setGenerating(false);
    }
  };

  const generateVideo = async () => {
    if (!videoPrompt.trim()) return;
    setGeneratingVideo(true);
    setVideoUrl(null);
    setErrorMsg(null);
    try {
      const res = await fetch(`${getApiBaseUrl()}/api/nova/generate-video`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${tok()}` },
        body: JSON.stringify({ prompt: videoPrompt.trim(), model: selectedVideoModel.id }),
      });
      const d = await res.json();
      if (!d.success) throw new Error(d.error ?? 'Video generation failed');
      setVideoUrl(d.url ?? null);
    } catch (err: any) {
      setErrorMsg(err.message ?? 'Video generation failed');
    } finally {
      setGeneratingVideo(false);
    }
  };

  const handleSaveAndRefresh = async () => {
    if (!savedDesignId) return;
    try {
      const design = await designService.get(savedDesignId);
      onDesignSaved(design);
    } catch { /* best effort */ }
  };

  // ── Idle state ────────────────────────────────────────────────────────────

  if (phase === 'idle') {
    return (
      <div className="space-y-6">
        {/* GenMode + Model picker card */}
        <div className="rounded-2xl border border-slate-200 bg-white p-6 md:p-8">
          <div className="flex items-center gap-3 mb-5">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-[#5b6cf9]/10">
              <Wand2 size={20} className="text-[#5b6cf9]" />
            </div>
            <div className="flex-1">
              <h2 className="text-lg font-black text-slate-900">AI Design Studio</h2>
              <p className="text-sm text-slate-500">Describe what you want — Nova researches, styles it to your brand, and generates the output.</p>
            </div>
          </div>

          {/* GenMode toggle */}
          <div className="flex gap-1 rounded-xl border border-slate-200 bg-slate-50 p-1 w-fit mb-4">
            {([{ id: 'image' as GenMode, label: 'Image', icon: <Image size={13} /> }, { id: 'video' as GenMode, label: 'Video', icon: <Video size={13} /> }]).map((m) => (
              <button
                key={m.id}
                type="button"
                onClick={() => setGenMode(m.id)}
                className={`flex items-center gap-1.5 rounded-lg px-4 py-1.5 text-sm font-semibold transition ${
                  genMode === m.id ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500 hover:text-slate-700'
                }`}
              >
                {m.icon} {m.label}
              </button>
            ))}
          </div>

          {/* Model picker */}
          <div className="mb-5">
            <label className="block text-xs font-bold text-slate-500 uppercase tracking-wide mb-2">Model</label>
            <div className="flex flex-wrap gap-2">
              {(genMode === 'image' ? IMAGE_MODELS : VIDEO_MODELS).map((m) => (
                <button
                  key={m.id}
                  type="button"
                  onClick={() => genMode === 'image' ? setSelectedImageModel(m) : setSelectedVideoModel(m)}
                  className={`relative flex flex-col rounded-xl border px-3 py-2 text-left transition min-w-[130px] ${
                    currentModel.id === m.id
                      ? 'border-[#5b6cf9] bg-indigo-50 text-[#5b6cf9]'
                      : 'border-slate-200 bg-white text-slate-700 hover:border-slate-300'
                  }`}
                >
                  {m.badge && (
                    <span className="absolute -top-2 -right-2 rounded-full bg-[#5b6cf9] px-1.5 py-0.5 text-[9px] font-bold text-white">{m.badge}</span>
                  )}
                  <span className="text-xs font-bold">{m.label}</span>
                  <span className="text-[10px] text-slate-400 mt-0.5">{m.desc}</span>
                  <span className="mt-1 text-[10px] font-bold text-[#5b6cf9]">✦{m.creditCost} credits</span>
                </button>
              ))}
            </div>
          </div>

          {/* Video mode form */}
          {genMode === 'video' ? (
            <div className="space-y-3">
              <textarea
                value={videoPrompt}
                onChange={(e) => setVideoPrompt(e.target.value)}
                rows={3}
                placeholder="Describe your video… e.g. a slow-motion ocean wave at sunset with cinematic lighting"
                className="w-full resize-none rounded-xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-800 placeholder-slate-400 outline-none focus:border-[#5b6cf9] focus:ring-1 focus:ring-[#5b6cf9] transition"
              />
              <button
                type="button"
                disabled={!videoPrompt.trim() || generatingVideo}
                onClick={generateVideo}
                className="flex items-center gap-2 rounded-xl bg-[#5b6cf9] px-5 py-2.5 text-sm font-bold text-white shadow-sm hover:bg-indigo-600 disabled:opacity-40 transition active:scale-[0.98]"
              >
                {generatingVideo ? <><Loader2 size={14} className="animate-spin" /> Generating…</> : <><Play size={14} /> Generate Video ✦{selectedVideoModel.creditCost}</>}
              </button>
              {errorMsg && <p className="text-xs text-red-500">{errorMsg}</p>}
              {videoUrl && (
                <div className="rounded-2xl overflow-hidden border border-slate-200">
                  <video src={videoUrl} controls className="w-full" />
                  <div className="p-3 flex gap-2">
                    <a href={videoUrl} download target="_blank" rel="noreferrer"
                      className="flex items-center gap-1.5 rounded-xl border border-slate-200 px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-50 transition">
                      <Download size={12} /> Download
                    </a>
                  </div>
                </div>
              )}
            </div>
          ) : (
            /* Image mode form */
            <div className="space-y-3">
              <textarea
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) generate(true); }}
                rows={3}
                placeholder="e.g. a modern business card, a minimalist Instagram post, a bold promotional banner…"
                className="w-full resize-none rounded-xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-800 placeholder-slate-400 outline-none focus:border-[#5b6cf9] focus:ring-1 focus:ring-[#5b6cf9] transition"
              />
              <div className="flex gap-3">
                <button
                  type="button"
                  disabled={!description.trim()}
                  onClick={() => generate(true)}
                  className="flex items-center gap-2 rounded-xl bg-[#5b6cf9] px-5 py-2.5 text-sm font-bold text-white shadow-sm hover:bg-indigo-600 disabled:opacity-40 transition active:scale-[0.98]"
                >
                  <Sparkles size={15} /> Generate ✦{selectedImageModel.creditCost}
                </button>
                <button
                  type="button"
                  disabled={!description.trim()}
                  onClick={() => generate(false)}
                  className="flex items-center gap-2 rounded-xl border border-slate-200 px-4 py-2.5 text-sm font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-40 transition"
                >
                  <Edit3 size={14} /> Review Prompt First
                </button>
              </div>
              <p className="text-xs text-slate-400">
                "Generate" uses your saved brand memory to auto-fill everything.
                "Review Prompt First" lets you edit before generating.
              </p>
            </div>
          )}
        </div>

        {/* Suggestions */}
        {genMode === 'image' && (loadingSuggestions || suggestions.length > 0) && (
          <div className="rounded-2xl border border-slate-200 bg-white p-5 md:p-6">
            <div className="flex items-center justify-between mb-3">
              <div>
                <p className="text-sm font-bold text-slate-900">
                  {suggHasMemory ? 'Suggested for your brand' : 'Try one of these'}
                </p>
                <p className="text-xs text-slate-400 mt-0.5">
                  {suggHasMemory ? 'Based on your saved brand memory' : 'Add brand memory for personalised suggestions'}
                </p>
              </div>
              {!suggHasMemory && (
                <span className="rounded-full border border-amber-200 bg-amber-50 px-2.5 py-0.5 text-[10px] font-semibold text-amber-600">
                  No memory saved
                </span>
              )}
            </div>

            {loadingSuggestions ? (
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                {[1,2,3,4].map((n) => (
                  <div key={n} className="rounded-xl border border-slate-100 p-3 space-y-2">
                    <div className="h-3 w-3/4 animate-pulse rounded bg-slate-100" />
                    <div className="h-2.5 w-full animate-pulse rounded bg-slate-100" />
                    <div className="h-2.5 w-2/3 animate-pulse rounded bg-slate-100" />
                  </div>
                ))}
              </div>
            ) : (
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                {suggestions.map((s) => (
                  <button
                    key={s.id}
                    type="button"
                    onClick={() => setDescription(s.hint)}
                    className="group text-left rounded-xl border border-slate-200 bg-slate-50 hover:border-[#5b6cf9] hover:bg-indigo-50 p-3 transition"
                  >
                    <p className="text-xs font-bold text-slate-800 group-hover:text-[#5b6cf9] mb-1">{s.title}</p>
                    <p className="text-[11px] text-slate-500 leading-snug line-clamp-2">{s.description}</p>
                    <div className="mt-2 flex items-center gap-1 text-[10px] font-semibold text-[#5b6cf9] opacity-0 group-hover:opacity-100 transition">
                      <Plus size={10} /> Use this
                    </div>
                  </button>
                ))}
              </div>
            )}
          </div>
        )}

        {/* How it works */}
        <div className="rounded-2xl border border-slate-100 bg-slate-50 p-5">
          <p className="text-xs font-bold text-slate-600 mb-3">How Nova works</p>
          <div className="grid grid-cols-1 sm:grid-cols-5 gap-3">
            {[
              { icon: '🔍', label: 'Search designs', desc: 'MeiGen AI finds matching templates' },
              { icon: '✦', label: 'Extract prompts', desc: 'Pulls the generation prompts used' },
              { icon: '◉', label: 'Brand-tailor', desc: 'Adapts to your colors, tone & niche' },
              { icon: '🎨', label: 'Generate image', desc: 'Creates your unique design' },
              { icon: '💾', label: 'Save to history', desc: 'Auto-saved to History' },
            ].map((item, i) => (
              <div key={i} className="flex flex-col items-center text-center gap-1">
                <span className="text-xl">{item.icon}</span>
                <p className="text-xs font-semibold text-slate-700">{item.label}</p>
                <p className="text-[10px] text-slate-400">{item.desc}</p>
                {i < 4 && <ChevronRight size={12} className="text-slate-300 hidden sm:block mt-1" />}
              </div>
            ))}
          </div>
        </div>
      </div>
    );
  }

  // ── Running / Generating states ───────────────────────────────────────────

  if (phase === 'running' || phase === 'generating') {
    return (
      <div className="rounded-2xl border border-slate-200 bg-white p-6 md:p-8">
        <div className="flex items-center gap-3 mb-6">
          <Loader2 size={20} className="animate-spin text-[#5b6cf9]" />
          <div>
            <h2 className="text-lg font-black text-slate-900">
              {phase === 'generating' ? 'Generating image…' : 'Nova is working…'}
            </h2>
            <p className="text-sm text-slate-500 truncate max-w-md">"{description}"</p>
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
          {/* Workflow progress */}
          <div>
            <p className="text-xs font-bold text-slate-500 uppercase tracking-wide mb-3">Workflow</p>
            <StepIndicator steps={steps} />
          </div>

          {/* Inspirations */}
          {inspirations.length > 0 && (
            <div>
              <p className="text-xs font-bold text-slate-500 uppercase tracking-wide mb-3">Design Inspirations</p>
              <div className="grid grid-cols-2 gap-2">
                {inspirations.slice(0, 4).map((d, i) => (
                  <InspirationCard key={i} design={d} />
                ))}
              </div>
            </div>
          )}
        </div>

        <button type="button" onClick={resetState} className="mt-6 text-xs text-slate-400 hover:text-slate-600 transition">
          Cancel
        </button>
      </div>
    );
  }

  // ── Prompt review state ───────────────────────────────────────────────────

  if (phase === 'prompt_review') {
    return (
      <div className="rounded-2xl border border-slate-200 bg-white p-6 md:p-8 space-y-5">
        <div>
          <h2 className="text-lg font-black text-slate-900">Review & edit your prompt</h2>
          <p className="text-sm text-slate-500 mt-1">
            No brand memory found yet — edit the prompt below to personalise it, then generate your image.
            Fill in the <code className="bg-slate-100 px-1 rounded text-xs">[brackets]</code> with your details.
          </p>
        </div>

        {inspirations.length > 0 && (
          <div>
            <p className="text-xs font-bold text-slate-500 uppercase tracking-wide mb-2">Design Inspirations</p>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
              {inspirations.slice(0, 4).map((d, i) => <InspirationCard key={i} design={d} />)}
            </div>
          </div>
        )}

        <div>
          <label className="block text-xs font-bold text-slate-600 mb-2">Image Generation Prompt</label>
          <textarea
            value={promptText}
            onChange={(e) => setPromptText(e.target.value)}
            rows={6}
            className="w-full resize-none rounded-xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-800 outline-none focus:border-[#5b6cf9] focus:ring-1 focus:ring-[#5b6cf9] font-mono leading-relaxed"
          />
          <p className="mt-1.5 text-xs text-slate-400">
            Model: <span className="font-semibold text-slate-600">{promptModel}</span>
          </p>
        </div>

        <div className="flex gap-3">
          <button
            type="button"
            disabled={generating || !promptText.trim()}
            onClick={generateFromPrompt}
            className="flex items-center gap-2 rounded-xl bg-[#5b6cf9] px-5 py-2.5 text-sm font-bold text-white hover:bg-indigo-600 disabled:opacity-40 transition active:scale-[0.98]"
          >
            {generating ? <><Loader2 size={14} className="animate-spin" /> Generating…</> : <><Sparkles size={14} /> Generate Image</>}
          </button>
          <button type="button" onClick={resetState} className="rounded-xl border border-slate-200 px-4 py-2.5 text-sm font-semibold text-slate-600 hover:bg-slate-50 transition">
            Start over
          </button>
        </div>
      </div>
    );
  }

  // ── Done state ────────────────────────────────────────────────────────────

  if (phase === 'done') {
    return (
      <div className="rounded-2xl border border-slate-200 bg-white p-6 md:p-8 space-y-5">
        <div className="flex items-center gap-3">
          <CheckCircle2 size={22} className="text-emerald-500 shrink-0" />
          <div>
            <h2 className="text-lg font-black text-slate-900">Design ready!</h2>
            <p className="text-sm text-slate-500">Generated for: "{description}"</p>
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          {/* Generated image */}
          <div>
            {imageUrl ? (
              <div className="rounded-2xl overflow-hidden border border-slate-200 shadow-sm">
                <img src={imageUrl} alt="Generated design" className="w-full object-cover" />
              </div>
            ) : (
              <div className="aspect-square rounded-2xl border-2 border-dashed border-slate-200 flex items-center justify-center">
                <p className="text-sm text-slate-400">Image not available</p>
              </div>
            )}
          </div>

          {/* Details + actions */}
          <div className="space-y-4">
            <div>
              <p className="text-xs font-bold text-slate-500 uppercase tracking-wide mb-2">Workflow completed</p>
              <StepIndicator steps={steps} />
            </div>

            {promptText && (
              <div className="rounded-xl bg-slate-50 border border-slate-100 p-3">
                <p className="text-[11px] font-bold text-slate-500 mb-1">Prompt used</p>
                <p className="text-xs text-slate-600 leading-relaxed line-clamp-4">{promptText}</p>
              </div>
            )}

            <div className="flex flex-wrap gap-2">
              {savedDesignId && (
                <button
                  type="button"
                  onClick={handleSaveAndRefresh}
                  className="flex items-center gap-1.5 rounded-xl bg-emerald-500 px-4 py-2 text-xs font-bold text-white hover:bg-emerald-600 transition"
                >
                  <CheckCircle2 size={13} /> Saved to History
                </button>
              )}
              {imageUrl && (
                <a href={imageUrl} download target="_blank" rel="noreferrer"
                  className="flex items-center gap-1.5 rounded-xl border border-slate-200 px-4 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50 transition">
                  <Download size={13} /> Download
                </a>
              )}
              <button
                type="button"
                onClick={resetState}
                className="flex items-center gap-1.5 rounded-xl border border-[#5b6cf9] px-4 py-2 text-xs font-bold text-[#5b6cf9] hover:bg-indigo-50 transition"
              >
                <RefreshCw size={13} /> New Design
              </button>
            </div>
          </div>
        </div>

        {/* Inspirations reference */}
        {inspirations.length > 0 && (
          <div>
            <p className="text-xs font-bold text-slate-500 uppercase tracking-wide mb-2">Design References Used</p>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
              {inspirations.slice(0, 4).map((d, i) => <InspirationCard key={i} design={d} />)}
            </div>
          </div>
        )}
      </div>
    );
  }

  // ── Error state ───────────────────────────────────────────────────────────

  return (
    <div className="rounded-2xl border border-red-200 bg-red-50 p-6 space-y-3">
      <div className="flex items-center gap-2 text-red-700">
        <AlertCircle size={18} />
        <p className="font-bold text-sm">Something went wrong</p>
      </div>
      <p className="text-sm text-red-600">{errorMsg ?? 'An unexpected error occurred.'}</p>
      <button type="button" onClick={resetState} className="rounded-xl bg-white border border-red-200 px-4 py-2 text-sm font-semibold text-red-700 hover:bg-red-50 transition">
        Try again
      </button>
    </div>
  );
}

// ── Types ─────────────────────────────────────────────────────────────────────

interface CardTemplate {
  id: string;
  name: string;
  description: string;
  designData: object;
  coverImageUrl: string | null;
  isPublished: boolean;
  createdAt: string;
  updatedAt: string;
  view_count?: number;
  like_count?: number;
}

// ── Preview modal ─────────────────────────────────────────────────────────────

function PreviewModal({
  tpl,
  onClose,
  onUse,
}: {
  tpl: CardTemplate;
  onClose: () => void;
  onUse: () => void;
}) {
  const [liked, setLiked] = useState(false);
  const [likeCount, setLikeCount] = useState(tpl.like_count ?? 0);
  const [viewCount, setViewCount] = useState(tpl.view_count ?? 0);

  // Track view on mount
  useEffect(() => {
    fetch(`${getApiBaseUrl()}/api/card-templates/${tpl.id}/view`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${tok()}` },
    })
      .then((r) => r.json())
      .then((d) => { if (d.success) setViewCount(d.view_count ?? viewCount); })
      .catch(() => {});
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tpl.id]);

  // Close on ESC
  useEffect(() => {
    const handler = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [onClose]);

  const toggleLike = () => {
    fetch(`${getApiBaseUrl()}/api/card-templates/${tpl.id}/like`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${tok()}` },
    })
      .then((r) => r.json())
      .then((d) => {
        if (d.success) {
          setLiked(d.liked);
          setLikeCount(d.like_count);
        }
      })
      .catch(() => {});
    setLiked((p) => !p);
    setLikeCount((p) => liked ? p - 1 : p + 1);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm p-4" onClick={onClose}>
      <div
        className="relative bg-white rounded-3xl overflow-hidden shadow-2xl max-w-4xl w-full max-h-[90vh] flex flex-col md:flex-row"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Close button */}
        <button
          type="button"
          onClick={onClose}
          className="absolute top-4 right-4 z-10 flex h-8 w-8 items-center justify-center rounded-full bg-black/20 text-white hover:bg-black/40 transition"
        >
          <X size={16} />
        </button>

        {/* Left: image */}
        <div className="md:w-1/2 bg-slate-900 flex items-center justify-center min-h-[260px]">
          {tpl.coverImageUrl ? (
            <img src={tpl.coverImageUrl} alt={tpl.name} className="w-full h-full object-contain max-h-[70vh]" />
          ) : (
            <div className="flex flex-col items-center gap-3 text-white/30 p-8">
              <LayoutTemplate size={48} />
              <p className="text-sm">No preview</p>
            </div>
          )}
        </div>

        {/* Right: details */}
        <div className="md:w-1/2 p-6 md:p-8 flex flex-col gap-4 overflow-y-auto">
          <div>
            <h2 className="text-2xl font-black text-slate-900">{tpl.name}</h2>
            {tpl.description && (
              <p className="mt-2 text-sm text-slate-500 leading-relaxed">{tpl.description}</p>
            )}
          </div>

          {/* Stats */}
          <div className="flex items-center gap-4 text-sm text-slate-500">
            <span className="flex items-center gap-1.5">
              <Eye size={14} /> {viewCount.toLocaleString()} views
            </span>
            <span className="flex items-center gap-1.5">
              <Heart size={14} className={liked ? 'fill-red-500 text-red-500' : ''} />
              {likeCount.toLocaleString()} likes
            </span>
          </div>

          {/* Actions */}
          <div className="flex flex-wrap gap-3 mt-auto">
            <button
              type="button"
              onClick={toggleLike}
              className={`flex items-center gap-2 rounded-xl border px-4 py-2.5 text-sm font-bold transition ${
                liked
                  ? 'border-red-300 bg-red-50 text-red-500 hover:bg-red-100'
                  : 'border-slate-200 text-slate-700 hover:bg-slate-50'
              }`}
            >
              <Heart size={15} className={liked ? 'fill-red-500 text-red-500' : ''} />
              {liked ? 'Liked' : 'Like'}
            </button>
            <button
              type="button"
              onClick={() => { onUse(); onClose(); }}
              className="flex-1 flex items-center justify-center gap-2 rounded-xl bg-[#5b6cf9] px-5 py-2.5 text-sm font-bold text-white hover:bg-indigo-600 transition"
            >
              <Plus size={14} /> Use Template
            </button>
          </div>

          {tpl.coverImageUrl && (
            <a
              href={tpl.coverImageUrl}
              download
              target="_blank"
              rel="noreferrer"
              className="flex items-center justify-center gap-1.5 text-xs text-slate-400 hover:text-slate-600 transition"
            >
              <Download size={12} /> Download preview image
            </a>
          )}
        </div>
      </div>
    </div>
  );
}

// ── Discover card (masonry) ───────────────────────────────────────────────────

function DiscoverCard({ tpl, onClick }: { tpl: CardTemplate; onClick: () => void }) {
  return (
    <div
      className="group relative cursor-pointer overflow-hidden rounded-2xl bg-slate-900 shadow-sm hover:shadow-xl transition-all duration-200"
      onClick={onClick}
    >
      {tpl.coverImageUrl ? (
        <img
          src={tpl.coverImageUrl}
          alt={tpl.name}
          className="w-full h-auto block transition-transform duration-300 group-hover:scale-105"
        />
      ) : (
        <div className="aspect-[4/5] flex items-center justify-center bg-gradient-to-br from-slate-700 to-slate-900">
          <LayoutTemplate size={36} className="text-white/20" />
        </div>
      )}

      {/* Hover overlay */}
      <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-transparent to-transparent opacity-0 group-hover:opacity-100 transition-opacity duration-200" />

      <div className="absolute inset-x-0 bottom-0 p-3 translate-y-4 group-hover:translate-y-0 opacity-0 group-hover:opacity-100 transition-all duration-200">
        <p className="text-sm font-bold text-white leading-snug truncate">{tpl.name}</p>
        <div className="flex items-center justify-between mt-2">
          <div className="flex items-center gap-3 text-[11px] text-white/70">
            {(tpl.like_count ?? 0) > 0 && (
              <span className="flex items-center gap-1">
                <Heart size={10} /> {tpl.like_count}
              </span>
            )}
            {(tpl.view_count ?? 0) > 0 && (
              <span className="flex items-center gap-1">
                <Eye size={10} /> {tpl.view_count}
              </span>
            )}
          </div>
          <div className="flex items-center gap-1 rounded-full bg-[#5b6cf9] px-2.5 py-1 text-[10px] font-bold text-white">
            <Plus size={9} /> Use Idea
          </div>
        </div>
      </div>
    </div>
  );
}

// ── History card (masonry) ────────────────────────────────────────────────────

type MainTab = 'studio' | 'discover' | 'history';

function HistoryCard({ design, onDelete }: { design: UserDesign; onDelete: () => void }) {
  const [deleting, setDeleting] = useState(false);
  const [copied, setCopied] = useState(false);
  const formatDate = (iso: string) =>
    new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });

  const handleDelete = async (e: React.MouseEvent) => {
    e.stopPropagation();
    if (!confirm(`Delete "${design.name}"?`)) return;
    setDeleting(true);
    try {
      await designService.delete(design.id);
      onDelete();
    } catch {
      setDeleting(false);
    }
  };

  const handleCopy = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (design.thumbnail_url) {
      navigator.clipboard.writeText(design.thumbnail_url).then(() => {
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
      }).catch(() => {});
    }
  };

  return (
    <div
      className="group relative cursor-pointer overflow-hidden rounded-2xl bg-slate-900 shadow-sm hover:shadow-xl transition-all duration-200"

    >
      {design.thumbnail_url ? (
        <img
          src={design.thumbnail_url}
          alt={design.name}
          className="w-full h-auto block transition-transform duration-300 group-hover:scale-105"
        />
      ) : (
        <div className="aspect-[4/5] bg-gradient-to-br from-indigo-600 to-purple-700 flex items-center justify-center">
          <Image size={36} className="text-white/30" />
        </div>
      )}

      {/* Hover overlay */}
      <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-black/20 to-transparent opacity-0 group-hover:opacity-100 transition-opacity duration-200" />

      {/* Top action buttons */}
      <div className="absolute top-3 right-3 flex gap-1.5 opacity-0 group-hover:opacity-100 transition-opacity">
        {/* Copy URL */}
        {design.thumbnail_url && (
          <button
            type="button"
            onClick={handleCopy}
            className="flex h-7 w-7 items-center justify-center rounded-full bg-white/90 text-slate-700 shadow hover:bg-white transition"
            title={copied ? 'Copied!' : 'Copy URL'}
          >
            {copied ? <CheckCircle2 size={12} className="text-emerald-500" /> : <Copy size={12} />}
          </button>
        )}
        {/* Download */}
        {design.thumbnail_url && (
          <a
            href={design.thumbnail_url}
            download
            target="_blank"
            rel="noreferrer"
            onClick={(e) => e.stopPropagation()}
            className="flex h-7 w-7 items-center justify-center rounded-full bg-white/90 text-slate-700 shadow hover:bg-white transition"
            title="Download"
          >
            <Download size={12} />
          </a>
        )}
        {/* Delete */}
        <button
          type="button"
          onClick={handleDelete}
          disabled={deleting}
          className="flex h-7 w-7 items-center justify-center rounded-full bg-white/90 text-red-500 shadow hover:bg-white transition"
          title="Delete"
        >
          {deleting ? <Loader2 size={12} className="animate-spin" /> : <Trash2 size={13} />}
        </button>
      </div>

      {/* Bottom info */}
      <div className="absolute bottom-0 inset-x-0 p-3 translate-y-2 group-hover:translate-y-0 opacity-0 group-hover:opacity-100 transition-all duration-200">
        <p className="text-sm font-bold text-white leading-snug truncate">{design.name}</p>
        <div className="flex items-center gap-1 mt-1">
          <Clock size={10} className="text-white/50" />
          <span className="text-[10px] text-white/50">{formatDate(design.updated_at)}</span>
        </div>
      </div>
    </div>
  );
}

// ── Template Generator Modal ──────────────────────────────────────────────────

const QUALITY_MODEL_MAP = {
  standard: { model: 'flux-1.1-pro',   credits: 5  },
  medium:   { model: 'nano_banana_pro', credits: 8  },
  high:     { model: 'nano_banana_pro', credits: 12 },
} as const;

function TemplateGeneratorModal({
  tpl,
  onClose,
  onGenerated,
}: {
  tpl: CardTemplate;
  onClose: () => void;
  onGenerated?: () => void;
}) {
  const imgToPromptRef = useRef<HTMLInputElement>(null);
  const refUploadRef   = useRef<HTMLInputElement>(null);

  const [prompt, setPrompt]         = useState(tpl.description || '');
  const [imgPreview, setImgPreview] = useState<string | null>(tpl.coverImageUrl);
  const [quality, setQuality]       = useState<'standard' | 'medium' | 'high'>('standard');
  const [generating, setGenerating] = useState(false);
  const [resultUrl, setResultUrl]   = useState<string | null>(null);
  const [errorMsg, setErrorMsg]     = useState<string | null>(null);

  const promptRef = useRef(prompt);
  promptRef.current = prompt;
  const qualityRef = useRef(quality);
  qualityRef.current = quality;

  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { onClose(); return; }
      if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') doGenerate();
    };
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleImgToPromptUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => setImgPreview(reader.result as string);
    reader.readAsDataURL(file);
  };

  const doGenerate = async () => {
    const p = promptRef.current;
    const q = qualityRef.current;
    if (!p.trim() || generating) return;
    setGenerating(true);
    setErrorMsg(null);
    setResultUrl(null);
    try {
      const { model } = QUALITY_MODEL_MAP[q];
      const res = await fetch(`${getApiBaseUrl()}/api/nova/generate-image`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${tok()}` },
        body: JSON.stringify({ prompt: p.trim(), model, save: true }),
      });
      const d = await res.json();
      if (!d.success) throw new Error(d.error ?? 'Generation failed');
      setResultUrl(d.url ?? null);
      onGenerated?.();
    } catch (err: any) {
      setErrorMsg(err.message ?? 'Generation failed');
    } finally {
      setGenerating(false);
    }
  };

  const { credits } = QUALITY_MODEL_MAP[quality];

  return (
    <div className="fixed inset-0 z-50 flex flex-col" style={{ background: '#ebebeb', fontFamily: 'Inter, sans-serif' }}>

      {/* ── Top bar ─────────────────────────────────────────────────────────── */}
      <div className="flex items-center gap-2 bg-white border-b border-slate-200 px-4 h-12 shrink-0">
        <button type="button" onClick={onClose}
          className="flex h-7 w-7 items-center justify-center rounded-md hover:bg-slate-100 transition text-slate-500">
          <X size={16} />
        </button>
        <span className="text-sm font-semibold text-slate-800 truncate max-w-[180px]">{tpl.name}</span>
        <div className="flex items-center gap-1 rounded-md border border-slate-200 bg-white px-2.5 py-1 text-xs text-slate-600 font-medium">
          Instagram Square <span className="text-slate-400 ml-1">1080×1080</span>
          <ChevronDown size={11} className="ml-1 text-slate-400" />
        </div>
        <div className="flex items-center gap-0.5 ml-1">
          <button type="button" className="flex h-7 w-7 items-center justify-center rounded-md hover:bg-slate-100 transition text-slate-400">
            <Undo2 size={14} />
          </button>
          <button type="button" className="flex h-7 w-7 items-center justify-center rounded-md hover:bg-slate-100 transition text-slate-400">
            <Redo2 size={14} />
          </button>
        </div>
        <div className="flex-1" />
        {resultUrl && (
          <a href={resultUrl} download target="_blank" rel="noreferrer"
            className="flex items-center gap-1.5 rounded-lg border border-slate-200 px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-50 transition">
            <Download size={12} /> PNG
          </a>
        )}
        <button type="button"
          className="flex items-center gap-1.5 rounded-lg bg-slate-900 px-4 py-1.5 text-xs font-bold text-white hover:bg-slate-800 transition">
          Save
        </button>
      </div>

      <div className="flex flex-1 overflow-hidden">

        {/* ── Left: Layers ────────────────────────────────────────────────── */}
        <div className="w-44 bg-white border-r border-slate-200 flex flex-col shrink-0">
          <div className="px-4 py-2.5 border-b border-slate-100">
            <span className="text-[11px] font-bold text-slate-400 uppercase tracking-wider">Layers</span>
          </div>
          {tpl.coverImageUrl ? (
            <div className="p-2">
              <div className="flex items-center gap-2 rounded-lg bg-slate-50 border border-slate-200 px-2.5 py-2">
                <Image size={11} className="text-slate-400 shrink-0" />
                <span className="truncate text-[11px] font-medium text-slate-600">Cover Image</span>
              </div>
            </div>
          ) : (
            <div className="flex flex-col items-center justify-center flex-1 gap-2 text-slate-300 p-4 text-center">
              <Layers size={22} />
              <p className="text-[10px]">No layers yet</p>
              <p className="text-[10px] leading-tight">Add elements using the toolbar below</p>
            </div>
          )}
        </div>

        {/* ── Center: Artboard ────────────────────────────────────────────── */}
        <div className="flex-1 relative flex flex-col items-center justify-center overflow-auto"
          style={{ backgroundImage: 'radial-gradient(circle, #c8c8c8 1px, transparent 1px)', backgroundSize: '24px 24px' }}>
          <p className="absolute top-4 text-[11px] text-slate-400 pointer-events-none select-none">
            {tpl.name} — 1080×1080.
          </p>

          {/* Artboard */}
          <div className="relative bg-white shadow-xl" style={{ width: 440, height: 440 }}>
            {resultUrl ? (
              <img src={resultUrl} alt="Generated" className="w-full h-full object-cover" />
            ) : tpl.coverImageUrl ? (
              <img src={tpl.coverImageUrl} alt={tpl.name} className="w-full h-full object-contain" />
            ) : (
              <div className="w-full h-full flex items-center justify-center text-slate-200">
                <LayoutTemplate size={56} />
              </div>
            )}
            {generating && (
              <div className="absolute inset-0 flex items-center justify-center bg-white/70 backdrop-blur-sm">
                <div className="flex flex-col items-center gap-3">
                  <Loader2 size={28} className="animate-spin text-[#5b6cf9]" />
                  <p className="text-xs font-bold text-slate-700">Generating…</p>
                </div>
              </div>
            )}
          </div>

          {/* Floating toolbar */}
          <div className="absolute bottom-12 flex items-center gap-0.5 rounded-2xl bg-white border border-slate-200 shadow-lg px-2.5 py-1.5">
            {[
              { label: '↖', title: 'Select' },
              { label: 'T', title: 'Text', bold: true },
              { icon: <Image size={14} />, title: 'Image' },
              { icon: <div className="w-3 h-3 rounded-sm border-2 border-current" />, title: 'Shape' },
            ].map((t, i) => (
              <button key={i} type="button" title={t.title}
                className={`flex h-8 w-8 items-center justify-center rounded-xl text-slate-500 hover:bg-slate-100 transition text-sm ${(t as any).bold ? 'font-bold' : ''}`}>
                {(t as any).icon ?? t.label}
              </button>
            ))}
          </div>
        </div>

        {/* ── Right: Properties + Generate ────────────────────────────────── */}
        <div className="w-72 bg-white border-l border-slate-200 flex flex-col shrink-0 overflow-y-auto">
          <div className="px-4 py-2.5 border-b border-slate-100">
            <span className="text-[11px] font-bold text-slate-400 uppercase tracking-wider">Properties</span>
          </div>

          {/* Artboard background (decorative) */}
          <div className="px-4 py-3 border-b border-slate-100">
            <p className="text-[10px] font-bold text-slate-400 uppercase tracking-wide mb-2">Artboard Background</p>
            <div className="flex gap-1 mb-3">
              {['Solid', 'Gradient', 'Image'].map((t) => (
                <button key={t} type="button"
                  className={`flex-1 rounded-lg border py-1 text-[10px] font-semibold transition ${
                    t === 'Solid'
                      ? 'border-slate-300 bg-white text-slate-700 shadow-sm'
                      : 'border-transparent text-slate-400 hover:text-slate-600'
                  }`}>
                  {t}
                </button>
              ))}
            </div>
            <p className="text-[10px] text-slate-400 mb-1.5">Background Color</p>
            <div className="flex items-center gap-2 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 cursor-pointer hover:border-slate-300 transition">
              <div className="h-4 w-4 rounded-sm border border-slate-200 bg-white" />
              <span className="text-[11px] text-slate-500">Pick color</span>
            </div>
          </div>

          {/* Generate module */}
          <div className="px-4 py-4 space-y-3">
            <div className="flex items-center justify-between">
              <span className="text-sm font-bold text-slate-800">Generate</span>
              <button type="button" className="text-slate-400 hover:text-slate-600 transition">
                <Maximize2 size={13} />
              </button>
            </div>

            {/* Image to Prompt */}
            <div
              className="flex items-center gap-3 rounded-xl border border-slate-200 bg-slate-50 px-3 py-2.5 cursor-pointer hover:border-slate-300 transition"
              onClick={() => imgToPromptRef.current?.click()}
            >
              <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-slate-200 text-slate-500">
                <Image size={14} />
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-[11px] font-semibold text-slate-700">Image to Prompt</p>
                <p className="text-[10px] text-slate-400 truncate">Upload image to generate a prompt</p>
              </div>
              {imgPreview && (
                <img src={imgPreview} alt="" className="h-9 w-9 shrink-0 rounded-lg object-cover border border-slate-200" />
              )}
            </div>
            <input ref={imgToPromptRef} type="file" accept="image/*" className="hidden" onChange={handleImgToPromptUpload} />

            {/* Drop or upload reference */}
            <div
              className="flex items-center gap-3 rounded-xl border border-dashed border-slate-200 bg-slate-50 px-3 py-2.5 cursor-pointer hover:border-slate-300 transition"
              onClick={() => refUploadRef.current?.click()}
            >
              <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-slate-100 text-slate-400">
                <Image size={14} />
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-[11px] font-semibold text-slate-500">Drop or upload reference</p>
                <p className="text-[10px] text-slate-400">optional</p>
              </div>
              <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg border border-slate-200 bg-white text-slate-400">
                <Plus size={12} />
              </div>
            </div>
            <input ref={refUploadRef} type="file" accept="image/*" className="hidden" />

            {/* Prompt */}
            <div>
              <div className="flex items-center justify-between mb-1.5">
                <span className="text-[11px] font-bold text-slate-600">Prompt</span>
                <button type="button" className="text-[10px] text-slate-400 hover:text-slate-600 transition font-medium">Aₐ</button>
              </div>
              <textarea
                value={prompt}
                onChange={(e) => setPrompt(e.target.value)}
                rows={7}
                placeholder="Describe what you want to generate…"
                className="w-full resize-none rounded-xl border border-slate-200 bg-slate-50 px-3 py-2.5 text-[11px] text-slate-800 placeholder-slate-400 outline-none focus:border-[#5b6cf9] focus:ring-1 focus:ring-[#5b6cf9]/20 transition leading-relaxed"
              />
              <div className="flex items-center justify-between mt-1.5">
                <button type="button" className="flex items-center gap-1 text-[10px] text-slate-400 hover:text-slate-600 transition">
                  <Sparkles size={9} /> Enhance
                </button>
                <div className="flex items-center gap-2 text-[10px] text-slate-400 font-medium">
                  <span>- 1/4</span>
                  <span className="flex items-center gap-0.5"><Maximize2 size={8} /> Auto</span>
                  <span>2K</span>
                </div>
              </div>
            </div>

            {/* Select quality */}
            <div>
              <p className="text-[10px] text-slate-400 mb-1.5">Select quality</p>
              <div className="flex gap-1.5">
                {(['standard', 'medium', 'high'] as const).map((q) => (
                  <button key={q} type="button" onClick={() => setQuality(q)}
                    className={`flex-1 rounded-full border py-1 text-[10px] font-semibold capitalize transition ${
                      quality === q
                        ? 'border-slate-800 bg-slate-900 text-white'
                        : 'border-slate-200 text-slate-500 hover:border-slate-300 hover:text-slate-700'
                    }`}>
                    {q.charAt(0).toUpperCase() + q.slice(1)}
                  </button>
                ))}
              </div>
            </div>

            {/* Model info */}
            <div className="space-y-2 pt-1">
              <button type="button" className="text-[10px] text-slate-400 hover:text-slate-600 transition flex items-center gap-1">
                <span className="flex h-3.5 w-3.5 items-center justify-center rounded-full border border-current text-[8px]">?</span>
                FAQ · Model features &amp; pricing ↗
              </button>
              <div className="flex items-center gap-2 rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 cursor-pointer hover:border-slate-300 transition">
                <Sparkles size={12} className="text-slate-500 shrink-0" />
                <span className="flex-1 text-[11px] font-semibold text-slate-700">
                  {QUALITY_MODEL_MAP[quality].model === 'flux-1.1-pro' ? 'Flux 1.1 Pro' : 'Nano Banana Pro'}
                </span>
                <ChevronDown size={12} className="text-slate-400 shrink-0" />
              </div>
            </div>

            {errorMsg && (
              <p className="rounded-xl bg-red-50 border border-red-200 px-3 py-2 text-[11px] text-red-600">{errorMsg}</p>
            )}

            {resultUrl && !generating && (
              <div className="space-y-2">
                <div className="rounded-xl overflow-hidden border border-slate-200">
                  <img src={resultUrl} alt="Generated" className="w-full" />
                </div>
                <div className="flex gap-1.5">
                  <a href={resultUrl} download target="_blank" rel="noreferrer"
                    className="flex items-center gap-1 rounded-lg border border-slate-200 px-2.5 py-1.5 text-[10px] font-semibold text-slate-600 hover:bg-slate-50 transition">
                    <Download size={10} /> Download
                  </a>
                  <button type="button" onClick={() => { setResultUrl(null); setErrorMsg(null); }}
                    className="flex items-center gap-1 rounded-lg border border-slate-200 px-2.5 py-1.5 text-[10px] font-semibold text-slate-600 hover:bg-slate-50 transition">
                    <RefreshCw size={10} /> New
                  </button>
                </div>
              </div>
            )}
          </div>

          {/* Generate button pinned to bottom */}
          <div className="flex-1" />
          <div className="p-4 border-t border-slate-100 bg-white sticky bottom-0">
            <button type="button" disabled={!prompt.trim() || generating} onClick={doGenerate}
              className="w-full flex items-center justify-center gap-2 rounded-xl bg-slate-900 py-3 text-sm font-bold text-white hover:bg-slate-800 disabled:opacity-40 disabled:cursor-not-allowed transition active:scale-[0.98]">
              {generating
                ? <><Loader2 size={14} className="animate-spin" /> Generating…</>
                : <><Sparkles size={14} /> Generate ✦{credits}</>
              }
            </button>
          </div>
        </div>
      </div>

      {/* ── Bottom shortcuts bar ─────────────────────────────────────────────── */}
      <div className="bg-white border-t border-slate-100 h-7 flex items-center gap-6 px-4 text-[10px] text-slate-400 shrink-0 select-none">
        <span><span className="font-semibold text-slate-500">Esc</span> Close</span>
        <span><span className="font-semibold text-slate-500">Ctrl+Enter</span> Generate</span>
      </div>
    </div>
  );
}

// ── Main page ─────────────────────────────────────────────────────────────────

const Cards = () => {
  const [tab, setTab]               = useState<MainTab>('studio');
  const [generatorTpl, setGeneratorTpl] = useState<CardTemplate | null>(null);
  const [myDesigns, setMyDesigns]   = useState<UserDesign[]>([]);
  const [loadingDesigns, setLoadingDesigns] = useState(false);
  const [templates, setTemplates]   = useState<CardTemplate[]>([]);
  const [loadingTemplates, setLoadingTemplates] = useState(false);
  const [previewTpl, setPreviewTpl] = useState<CardTemplate | null>(null);

  const fetchDesigns = useCallback(async () => {
    setLoadingDesigns(true);
    try {
      const list = await designService.list();
      setMyDesigns(list);
    } catch { /* ignore */ }
    finally { setLoadingDesigns(false); }
  }, []);

  const fetchTemplates = useCallback(async () => {
    setLoadingTemplates(true);
    try {
      const r = await fetch(`${getApiBaseUrl()}/api/card-templates/published`, {
        headers: { Authorization: `Bearer ${tok()}` },
      });
      const d = await r.json();
      if (d.success) setTemplates(d.templates ?? []);
    } catch { /* ignore */ }
    finally { setLoadingTemplates(false); }
  }, []);

  useEffect(() => { fetchDesigns(); fetchTemplates(); }, [fetchDesigns, fetchTemplates]);

  const handleDesignSaved = (_saved?: UserDesign) => { fetchDesigns(); };

  if (generatorTpl) {
    return (
      <TemplateGeneratorModal
        tpl={generatorTpl}
        onClose={() => { setGeneratorTpl(null); fetchDesigns(); }}
        onGenerated={fetchDesigns}
      />
    );
  }

  return (
    <div className="space-y-6">
      <header>
        <div className="flex items-start justify-between gap-4">
          <div className="max-w-2xl">
            <h1 className="text-4xl font-black text-slate-900">My Studio</h1>
            <p className="mt-2 text-base text-slate-600">
              Generate AI-powered designs tailored to your brand, or build from scratch.
            </p>
          </div>
          <CreditBadge />
        </div>
      </header>

      {/* Tab bar */}
      <div className="flex gap-1 rounded-xl border border-slate-200 bg-slate-50 p-1 w-fit">
        {([
          { id: 'studio'   as const, label: 'AI Studio', icon: <Sparkles      size={14} /> },
          { id: 'discover' as const, label: 'Discover',  icon: <LayoutTemplate size={14} /> },
          { id: 'history'  as const, label: 'History',   icon: <Image          size={14} /> },
        ]).map((t) => (
          <button
            key={t.id}
            type="button"
            onClick={() => setTab(t.id)}
            className={`flex items-center gap-2 rounded-lg px-4 py-2 text-sm font-semibold transition ${
              tab === t.id
                ? 'bg-white text-slate-900 shadow-sm'
                : 'text-slate-500 hover:text-slate-700'
            }`}
          >
            {t.icon} {t.label}
          </button>
        ))}
      </div>

      {/* Tab content */}
      {tab === 'studio' ? (
        <AIStudio onDesignSaved={handleDesignSaved} />
      ) : tab === 'discover' ? (
        <div>
          {loadingTemplates ? (
            <div className="flex items-center gap-2 text-sm text-slate-500 py-8">
              <Loader2 size={16} className="animate-spin" /> Loading templates…
            </div>
          ) : templates.length === 0 ? (
            <div className="rounded-2xl border-2 border-dashed border-slate-200 flex flex-col items-center justify-center py-16 gap-3">
              <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-slate-100">
                <LayoutTemplate size={24} className="text-slate-400" />
              </div>
              <p className="font-bold text-slate-700">No templates yet</p>
              <p className="text-sm text-slate-400">Admin-published templates will appear here.</p>
            </div>
          ) : (
            <div className="columns-2 sm:columns-3 lg:columns-4 xl:columns-5 gap-4">
              {templates.map((tpl) => (
                <div key={tpl.id} className="break-inside-avoid mb-4">
                  <DiscoverCard tpl={tpl} onClick={() => setPreviewTpl(tpl)} />
                </div>
              ))}
            </div>
          )}
        </div>
      ) : (
        <div>
          {loadingDesigns ? (
            <div className="flex items-center gap-2 text-sm text-slate-500 py-8">
              <Loader2 size={16} className="animate-spin" /> Loading your designs…
            </div>
          ) : myDesigns.length === 0 ? (
            <div className="rounded-2xl border-2 border-dashed border-slate-200 flex flex-col items-center justify-center py-16 gap-4">
              <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-slate-100">
                <Image size={24} className="text-slate-400" />
              </div>
              <div className="text-center">
                <p className="font-bold text-slate-700">No designs yet</p>
                <p className="text-sm text-slate-400 mt-1">Generate an AI design or start with a blank canvas.</p>
              </div>
              <div className="flex gap-3">
                <button
                  type="button"
                  onClick={() => setTab('studio')}
                  className="flex items-center gap-2 rounded-xl bg-[#5b6cf9] px-4 py-2 text-sm font-bold text-white hover:bg-indigo-600 transition"
                >
                  <Sparkles size={14} /> AI Studio
                </button>
              </div>
            </div>
          ) : (
            <div className="columns-2 sm:columns-3 lg:columns-4 xl:columns-5 gap-4">
              {myDesigns.map((d) => (
                <div key={d.id} className="break-inside-avoid mb-4">
                  <HistoryCard
                    design={d}
                    onDelete={() => setMyDesigns((prev) => prev.filter((x) => x.id !== d.id))}
                  />
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Preview modal */}
      {previewTpl && (
        <PreviewModal
          tpl={previewTpl}
          onClose={() => setPreviewTpl(null)}
          onUse={() => { setGeneratorTpl(previewTpl); setPreviewTpl(null); }}
        />
      )}
    </div>
  );
};

export default Cards;
