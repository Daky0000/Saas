import { useState, useEffect, useRef } from 'react';
import {
  Plus, Pencil, Trash2, Clock, Sparkles, Wand2, Image, LayoutTemplate,
  CheckCircle2, Loader2, RefreshCw, ChevronRight, Download, Edit3,
  AlertCircle, ExternalLink, Layers,
} from 'lucide-react';
import AdvancedTemplateCard from '../components/AdvancedTemplateCard';
import { cloneCardTemplate } from '../data/cardTemplates';
import { CardTemplate, AdminCardTemplate, isFabricDesign, FabricDesignData } from '../types/cardTemplate';
import { cardTemplateService } from '../services/cardTemplateService';
import { designService, UserDesign } from '../services/designService';
import CardBuilderModal from '../components/cards/builder/CardBuilderModal';
import { getApiBaseUrl } from '../utils/apiBase';

// ── Helpers ───────────────────────────────────────────────────────────────────

function tok() { return localStorage.getItem('auth_token') ?? ''; }

function formatDate(iso: string) {
  try {
    return new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
  } catch { return iso; }
}

function isAiImage(design: UserDesign): boolean {
  return (design.canvas_data as any)?.type === 'ai_image';
}

// ── Design card thumbnail ─────────────────────────────────────────────────────

function DesignThumb({
  design,
  onOpen,
  onDelete,
}: {
  design: UserDesign;
  onOpen: () => void;
  onDelete: () => void;
}) {
  const [deleting, setDeleting] = useState(false);
  const ai = isAiImage(design);

  const handleDelete = async (e: React.MouseEvent) => {
    e.stopPropagation();
    if (!confirm(`Delete "${design.name}"? This cannot be undone.`)) return;
    setDeleting(true);
    try { await designService.delete(design.id); onDelete(); }
    catch { setDeleting(false); }
  };

  return (
    <div className="group relative overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm transition hover:shadow-md">
      <div className="relative aspect-square overflow-hidden bg-zinc-100 cursor-pointer" onClick={onOpen}>
        {design.thumbnail_url ? (
          <img src={design.thumbnail_url} alt={design.name} className="h-full w-full object-cover transition duration-300 group-hover:scale-105" />
        ) : (
          <div className="flex h-full items-center justify-center">
            <span className="text-sm text-zinc-400">No preview</span>
          </div>
        )}
        <div className="absolute inset-0 bg-black/0 group-hover:bg-black/20 transition-colors flex items-center justify-center opacity-0 group-hover:opacity-100">
          <div className="rounded-xl bg-white/90 px-4 py-2 text-sm font-semibold text-zinc-900 shadow">
            {ai ? 'View Image' : 'Open in Builder'}
          </div>
        </div>
        {ai && (
          <div className="absolute top-2 left-2 flex items-center gap-1 rounded-full bg-[#5b6cf9]/90 px-2 py-0.5 text-[10px] font-bold text-white">
            <Sparkles size={8} /> AI
          </div>
        )}
      </div>
      <div className="flex items-center justify-between p-3">
        <div className="min-w-0">
          <p className="truncate text-sm font-semibold text-slate-900">{design.name}</p>
          <p className="flex items-center gap-1 text-xs text-slate-400 mt-0.5">
            <Clock size={10} /> {formatDate(design.updated_at)}
          </p>
        </div>
        <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
          <button type="button" onClick={onOpen} className="flex h-7 w-7 items-center justify-center rounded-lg border border-zinc-200 text-zinc-500 hover:bg-zinc-50 transition" title={ai ? 'View' : 'Edit'}>
            {ai ? <ExternalLink size={12} /> : <Pencil size={13} />}
          </button>
          <button type="button" onClick={handleDelete} disabled={deleting} className="flex h-7 w-7 items-center justify-center rounded-lg border border-red-200 text-red-400 hover:bg-red-50 transition disabled:opacity-50" title="Delete">
            <Trash2 size={13} />
          </button>
        </div>
      </div>
    </div>
  );
}

// ── AI Image Preview modal ────────────────────────────────────────────────────

function AiImagePreview({ design, onClose, onOpenCanvas }: { design: UserDesign; onClose: () => void; onOpenCanvas: () => void }) {
  const data = design.canvas_data as any;
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4" onClick={onClose}>
      <div className="relative max-w-2xl w-full rounded-2xl bg-white shadow-2xl overflow-hidden" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between px-5 py-3 border-b border-slate-100">
          <p className="font-bold text-slate-900 text-sm">{design.name}</p>
          <button type="button" onClick={onClose} className="text-slate-400 hover:text-slate-700">✕</button>
        </div>
        {design.thumbnail_url && (
          <img src={design.thumbnail_url} alt={design.name} className="w-full object-contain max-h-[60vh]" />
        )}
        {data?.prompt && (
          <div className="px-5 py-3 bg-slate-50 border-t border-slate-100">
            <p className="text-[11px] font-semibold text-slate-500 mb-1">Prompt used</p>
            <p className="text-xs text-slate-600 line-clamp-3">{data.prompt}</p>
          </div>
        )}
        <div className="flex gap-2 px-5 py-3 border-t border-slate-100">
          {design.thumbnail_url && (
            <a href={design.thumbnail_url} download target="_blank" rel="noreferrer"
              className="flex items-center gap-1.5 rounded-xl border border-slate-200 px-3 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50 transition">
              <Download size={12} /> Download
            </a>
          )}
          <button type="button" onClick={onOpenCanvas}
            className="flex items-center gap-1.5 rounded-xl bg-[#5b6cf9] px-3 py-2 text-xs font-semibold text-white hover:bg-indigo-600 transition">
            <Edit3 size={12} /> Open in Canvas
          </button>
        </div>
      </div>
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

  const resetState = () => {
    setPhase('idle');
    setSteps(DEFAULT_STEPS.map((s) => ({ ...s, status: 'pending' })));
    setInspirations([]);
    setPromptText('');
    setImageUrl(null);
    setSavedDesignId(null);
    setErrorMsg(null);
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

      // Final phase if we never hit 'done' event explicitly
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
        <div className="rounded-2xl border border-slate-200 bg-white p-6 md:p-8">
          <div className="flex items-center gap-3 mb-5">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-[#5b6cf9]/10">
              <Wand2 size={20} className="text-[#5b6cf9]" />
            </div>
            <div>
              <h2 className="text-lg font-black text-slate-900">AI Design Studio</h2>
              <p className="text-sm text-slate-500">Describe what you want — Nova researches, styles it to your brand, and generates the image.</p>
            </div>
          </div>

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
                <Sparkles size={15} /> Generate from My Brand
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
              "Generate from My Brand" uses your saved brand memory to auto-fill everything.
              "Review Prompt First" lets you edit before generating.
            </p>
          </div>
        </div>

        {/* How it works */}
        <div className="rounded-2xl border border-slate-100 bg-slate-50 p-5">
          <p className="text-xs font-bold text-slate-600 mb-3">How Nova works</p>
          <div className="grid grid-cols-1 sm:grid-cols-5 gap-3">
            {[
              { icon: '🔍', label: 'Search designs', desc: 'MeiGen AI finds matching templates' },
              { icon: '✦', label: 'Extract prompts', desc: 'Pulls the generation prompts used' },
              { icon: '◉', label: 'Brand-tailor', desc: 'Adapts to your colors, tone & niche' },
              { icon: '🎨', label: 'Generate image', desc: 'Creates your unique design' },
              { icon: '💾', label: 'Save to designs', desc: 'Auto-saved to My Designs' },
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
                  <CheckCircle2 size={13} /> Saved to My Designs
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

// ── Main page ─────────────────────────────────────────────────────────────────

type MainTab = 'studio' | 'designs' | 'templates';

const Cards = () => {
  const [tab, setTab] = useState<MainTab>('studio');

  const [selectedTemplate, setSelectedTemplate] = useState<CardTemplate | null>(null);
  const [publishedTemplates, setPublishedTemplates] = useState<AdminCardTemplate[]>([]);
  const [isLoadingTemplates, setIsLoadingTemplates] = useState(true);

  const [myDesigns, setMyDesigns] = useState<UserDesign[]>([]);
  const [isLoadingDesigns, setIsLoadingDesigns] = useState(true);

  const [builderOpen, setBuilderOpen] = useState(false);
  const [editingDesign, setEditingDesign] = useState<UserDesign | null>(null);
  const [templateInitData, setTemplateInitData] = useState<{ fabricData: FabricDesignData; name: string } | null>(null);

  const [previewDesign, setPreviewDesign] = useState<UserDesign | null>(null);

  useEffect(() => {
    cardTemplateService.getPublishedTemplates()
      .then((t) => setPublishedTemplates(t))
      .catch(() => setPublishedTemplates([]))
      .finally(() => setIsLoadingTemplates(false));
  }, []);

  const fetchDesigns = () => {
    setIsLoadingDesigns(true);
    designService.list()
      .then((d) => setMyDesigns(d))
      .catch(() => setMyDesigns([]))
      .finally(() => setIsLoadingDesigns(false));
  };

  useEffect(() => { fetchDesigns(); }, []);

  const openDesign = (design: UserDesign) => {
    if (isAiImage(design)) {
      setPreviewDesign(design);
    } else {
      setEditingDesign(design);
      setBuilderOpen(true);
    }
  };

  const openNewDesign = () => { setEditingDesign(null); setBuilderOpen(true); };

  const handleBuilderClose = () => { setBuilderOpen(false); setEditingDesign(null); setTemplateInitData(null); };

  const handleDesignSaved = (saved: UserDesign) => {
    setMyDesigns((prev) => {
      const idx = prev.findIndex((d) => d.id === saved.id);
      if (idx >= 0) { const next = [...prev]; next[idx] = saved; return next; }
      return [saved, ...prev];
    });
  };

  const handleDeleteDesign = (id: string) => setMyDesigns((prev) => prev.filter((d) => d.id !== id));

  const handleSelectPublishedTemplate = (template: AdminCardTemplate) => {
    if (isFabricDesign(template.designData)) {
      setTemplateInitData({ fabricData: template.designData, name: template.name });
      setEditingDesign(null);
      setBuilderOpen(true);
    } else {
      setSelectedTemplate(cloneCardTemplate(template.designData as CardTemplate));
    }
  };

  // ── Builder full-screen ───────────────────────────────────────────────────
  if (builderOpen) {
    return (
      <CardBuilderModal
        existingDesign={editingDesign}
        initialCanvasData={templateInitData
          ? { fabricJson: templateInitData.fabricData.fabricJson, canvasWidth: templateInitData.fabricData.canvasWidth, canvasHeight: templateInitData.fabricData.canvasHeight }
          : null}
        initialDesignName={templateInitData?.name}
        onClose={handleBuilderClose}
        onSaved={handleDesignSaved}
      />
    );
  }

  if (selectedTemplate) {
    return (
      <div className="space-y-6">
        <div className="rounded-[32px] border border-slate-200 bg-white p-6 md:p-8">
          <div className="flex flex-wrap items-center justify-between gap-4">
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.22em] text-slate-500">Template Editor</p>
              <h2 className="mt-1 text-2xl font-black text-slate-900">{selectedTemplate.name}</h2>
            </div>
            <button type="button" onClick={() => setSelectedTemplate(null)} className="rounded-xl border border-slate-200 bg-white px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50 transition">
              Back to Cards
            </button>
          </div>
          <div className="mt-6">
            <AdvancedTemplateCard template={selectedTemplate} onTemplateChange={(t) => setSelectedTemplate(t)} />
          </div>
        </div>
      </div>
    );
  }

  // ── Tab navigation ────────────────────────────────────────────────────────
  const TABS: { key: MainTab; label: string; icon: React.ReactNode }[] = [
    { key: 'studio',    label: 'AI Studio',    icon: <Sparkles size={14} /> },
    { key: 'designs',   label: 'My Designs',   icon: <Image size={14} /> },
    { key: 'templates', label: 'Templates',    icon: <LayoutTemplate size={14} /> },
  ];

  return (
    <div className="space-y-6">
      {/* Header */}
      <header className="flex items-start justify-between gap-4">
        <div className="max-w-2xl">
          <h1 className="text-4xl font-black text-slate-900">Design Studio</h1>
          <p className="mt-2 text-base text-slate-600">
            Generate AI-powered designs tailored to your brand, or build from scratch.
          </p>
        </div>
        <button
          type="button"
          onClick={openNewDesign}
          className="flex shrink-0 items-center gap-2 rounded-2xl bg-[#5b6cf9] px-5 py-3 text-sm font-bold text-white shadow-md shadow-indigo-100 transition hover:bg-indigo-600 active:scale-[0.98]"
        >
          <Plus size={16} /> New Canvas
        </button>
      </header>

      {/* Tab bar */}
      <div className="flex gap-1 rounded-2xl border border-slate-200 bg-white p-1 w-fit">
        {TABS.map((t) => (
          <button
            key={t.key}
            type="button"
            onClick={() => setTab(t.key)}
            className={`flex items-center gap-1.5 rounded-xl px-4 py-2 text-sm font-semibold transition ${
              tab === t.key
                ? 'bg-[#5b6cf9] text-white shadow-sm'
                : 'text-slate-500 hover:text-slate-800 hover:bg-slate-50'
            }`}
          >
            {t.icon} {t.label}
          </button>
        ))}
      </div>

      {/* Tab content */}
      {tab === 'studio' && (
        <AIStudio onDesignSaved={(d) => { handleDesignSaved(d); }} />
      )}

      {tab === 'designs' && (
        <div className="rounded-[32px] border border-slate-200 bg-white p-6 md:p-8">
          <div className="mb-5 flex items-center justify-between">
            <div>
              <h2 className="text-lg font-bold text-slate-900">My Designs</h2>
              <p className="mt-0.5 text-sm text-slate-500">Your saved canvas and AI-generated designs</p>
            </div>
            {myDesigns.length > 0 && (
              <button type="button" onClick={openNewDesign} className="flex items-center gap-1.5 rounded-xl border border-slate-200 px-3 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50 transition">
                <Plus size={13} /> New Canvas
              </button>
            )}
          </div>

          {isLoadingDesigns ? (
            <div className="grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-3">
              {[1, 2, 3].map((n) => (
                <div key={n} className="overflow-hidden rounded-2xl border border-slate-200">
                  <div className="aspect-square animate-pulse bg-slate-100" />
                  <div className="space-y-2 p-3">
                    <div className="h-4 w-3/4 animate-pulse rounded bg-slate-200" />
                    <div className="h-3 w-1/2 animate-pulse rounded bg-slate-100" />
                  </div>
                </div>
              ))}
            </div>
          ) : myDesigns.length === 0 ? (
            <div className="flex flex-col items-center justify-center gap-4 py-16 text-center">
              <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-indigo-50 text-[#5b6cf9]">
                <Sparkles size={26} />
              </div>
              <div>
                <p className="text-sm font-bold text-slate-700">No designs yet</p>
                <p className="text-xs text-slate-400 mt-1">Use AI Studio to generate your first design, or create a canvas from scratch.</p>
              </div>
              <div className="flex gap-2">
                <button type="button" onClick={() => setTab('studio')} className="rounded-xl bg-[#5b6cf9] px-4 py-2 text-sm font-bold text-white hover:bg-indigo-600 transition">
                  Open AI Studio
                </button>
                <button type="button" onClick={openNewDesign} className="rounded-xl border border-slate-200 px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50 transition">
                  Blank Canvas
                </button>
              </div>
            </div>
          ) : (
            <div className="grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
              {myDesigns.map((design) => (
                <DesignThumb
                  key={design.id}
                  design={design}
                  onOpen={() => openDesign(design)}
                  onDelete={() => handleDeleteDesign(design.id)}
                />
              ))}
            </div>
          )}
        </div>
      )}

      {tab === 'templates' && (
        <div className="rounded-[32px] border border-slate-200 bg-white p-6 md:p-8">
          <div className="mb-5">
            <h2 className="text-lg font-bold text-slate-900">Featured Templates</h2>
            <p className="mt-0.5 text-sm text-slate-500">Curated templates ready to customize in the canvas editor</p>
          </div>

          {isLoadingTemplates ? (
            <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4">
              {[1, 2, 3, 4].map((n) => (
                <div key={n}>
                  <div className="aspect-square animate-pulse rounded-2xl bg-slate-100" />
                  <div className="mt-2.5 space-y-1.5 px-0.5">
                    <div className="h-4 w-3/4 animate-pulse rounded bg-slate-200" />
                    <div className="h-3 w-1/2 animate-pulse rounded bg-slate-100" />
                  </div>
                </div>
              ))}
            </div>
          ) : publishedTemplates.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-16 gap-2 text-center">
              <LayoutTemplate size={28} className="text-slate-300" />
              <p className="text-sm font-bold text-slate-500">No templates published yet</p>
              <p className="text-xs text-slate-400">Admin can publish templates from Admin → Cards.</p>
            </div>
          ) : (
            <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4">
              {publishedTemplates.map((template) => (
                <button key={template.id} type="button" onClick={() => handleSelectPublishedTemplate(template)} className="group text-left focus:outline-none">
                  <div className="relative aspect-square overflow-hidden rounded-2xl bg-slate-100 shadow-sm transition duration-300 group-hover:shadow-lg">
                    {template.coverImageUrl ? (
                      <img src={template.coverImageUrl} alt={template.name} className="h-full w-full object-cover transition duration-300 group-hover:scale-105" />
                    ) : (
                      <div className="flex h-full items-center justify-center text-slate-400"><span className="text-sm">No preview</span></div>
                    )}
                    <div className="absolute inset-0 flex items-center justify-center bg-black/0 opacity-0 transition-all duration-200 group-hover:bg-black/40 group-hover:opacity-100">
                      <span className="rounded-full bg-white px-5 py-2 text-sm font-bold text-slate-900 shadow-md">Use Template</span>
                    </div>
                  </div>
                  <div className="mt-2.5 px-0.5">
                    <p className="truncate text-sm font-semibold text-slate-900">{template.name}</p>
                    {template.description && <p className="mt-0.5 line-clamp-2 text-xs text-slate-500">{template.description}</p>}
                  </div>
                </button>
              ))}
            </div>
          )}
        </div>
      )}

      {/* AI image preview modal */}
      {previewDesign && (
        <AiImagePreview
          design={previewDesign}
          onClose={() => setPreviewDesign(null)}
          onOpenCanvas={() => { setPreviewDesign(null); openNewDesign(); }}
        />
      )}
    </div>
  );
};

export default Cards;
