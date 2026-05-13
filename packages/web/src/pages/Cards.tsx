import { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import {
  Plus, Sparkles, Wand2,
  CheckCircle2, Loader2, RefreshCw, ChevronDown, Download, Edit3,
  AlertCircle, Layers, Trash2, Clock, Image, LayoutTemplate,
  Heart, Eye, Copy, Play, X, Video, Maximize2,
  RotateCcw, Lock, Share2, Languages,
} from 'lucide-react';
import { UserDesign, designService } from '../services/designService';
import { getApiBaseUrl } from '../utils/apiBase';

// ── Discover types & constants ────────────────────────────────────────────────

type ModelFilter = 'all' | 'flux' | 'seedream' | 'mystic' | 'google';
type SortMode    = 'featured' | 'newest' | 'popular';
type UseMode     = 'prompt' | 'ref';

const MODEL_TABS: { id: ModelFilter; label: string; badge?: string }[] = [
  { id: 'all',      label: 'All' },
  { id: 'flux',     label: 'Flux' },
  { id: 'seedream', label: 'Seedream', badge: 'NEW' },
  { id: 'mystic',   label: 'Mystic' },
  { id: 'google',   label: 'Google' },
];

const ASPECT_RATIOS = ['1:1', '3:4', '4:5', '2:3', '9:16', '4:3', '5:4', '3:2', '16:9', '21:9', '9:21'] as const;

function timeAgo(iso: string) {
  const diff = Date.now() - new Date(iso).getTime();
  const h = Math.floor(diff / 3_600_000);
  if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24);
  if (d < 30) return `${d}d ago`;
  return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

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
  { id: 'flux-2-turbo',     label: 'Flux 2 Turbo',     desc: 'Fastest, great for drafts',       creditCost: 3 },
  { id: 'flux-2-klein',     label: 'Flux 2 Klein',     desc: 'Fast with reference images',      creditCost: 3 },
  { id: 'seedream-v5-lite', label: 'Seedream 5 Lite',  desc: 'New — high coherence',            creditCost: 4, badge: 'NEW' },
  { id: 'flux-kontext-pro', label: 'Flux Kontext Pro', desc: 'Best for context-aware edits',    creditCost: 5, badge: 'Popular' },
  { id: 'flux-2-pro',       label: 'Flux 2 Pro',       desc: 'High quality text-to-image',      creditCost: 5 },
  { id: 'mystic',           label: 'Mystic',            desc: "Magnific's flagship model",       creditCost: 8 },
];

const VIDEO_MODELS: AIModel[] = [
  { id: 'happy-horse-i2v',  label: 'Happy Horse',      desc: 'Image-to-video, smooth motion',   creditCost: 20 },
  { id: 'wan-2-7-t2v',      label: 'WAN 2.7',          desc: 'Text-to-video, cinematic quality', creditCost: 25 },
  { id: 'kling-3-pro',      label: 'Kling 3 Pro',      desc: 'Premium video, long duration',    creditCost: 35 },
];

// ── AI Studio tab ─────────────────────────────────────────────────────────────

function AIStudio({ onDesignSaved }: { onDesignSaved: (d: UserDesign) => void }) {
  const [genMode, setGenMode]                   = useState<GenMode>('image');
  const [selectedImageModel, setSelectedImageModel] = useState<AIModel>(IMAGE_MODELS[3]);
  const [selectedVideoModel, setSelectedVideoModel] = useState<AIModel>(VIDEO_MODELS[0]);

  // Image generation state
  const [prompt, setPrompt]         = useState('');
  const [imageUrl, setImageUrl]     = useState<string | null>(null);
  const [designId, setDesignId]     = useState<string | null>(null);
  const [generating, setGenerating] = useState(false);
  const [errorMsg, setErrorMsg]     = useState<string | null>(null);

  // Video generation state
  const [videoPrompt, setVideoPrompt]       = useState('');
  const [videoUrl, setVideoUrl]             = useState<string | null>(null);
  const [generatingVideo, setGeneratingVideo] = useState(false);
  const [videoError, setVideoError]         = useState<string | null>(null);

  const currentModel = genMode === 'image' ? selectedImageModel : selectedVideoModel;

  const generateImage = async () => {
    if (!prompt.trim()) return;
    setGenerating(true);
    setImageUrl(null);
    setDesignId(null);
    setErrorMsg(null);
    try {
      const res = await fetch(`${getApiBaseUrl()}/api/nova/generate-image`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${tok()}` },
        body: JSON.stringify({ prompt: prompt.trim(), model: selectedImageModel.id, save: true }),
      });
      const d = await res.json();
      if (!d.success) throw new Error(d.error ?? 'Generation failed');
      setImageUrl(d.url ?? null);
      setDesignId(d.design_id ?? null);
      if (d.design_id) {
        // Trigger history refresh — pass a minimal stub so the tab knows to reload
        onDesignSaved({ id: d.design_id } as UserDesign);
      }
    } catch (e: any) {
      setErrorMsg(e.message ?? 'Generation failed');
    } finally {
      setGenerating(false);
    }
  };

  const generateVideo = async () => {
    if (!videoPrompt.trim()) return;
    setGeneratingVideo(true);
    setVideoUrl(null);
    setVideoError(null);
    try {
      const res = await fetch(`${getApiBaseUrl()}/api/nova/generate-video`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${tok()}` },
        body: JSON.stringify({ prompt: videoPrompt.trim(), model: selectedVideoModel.id }),
      });
      const d = await res.json();
      if (!d.success) throw new Error(d.error ?? 'Video generation failed');
      setVideoUrl(d.url ?? null);
    } catch (e: any) {
      setVideoError(e.message ?? 'Video generation failed');
    } finally {
      setGeneratingVideo(false);
    }
  };

  return (
    <div className="space-y-5">
      {/* Mode + model picker */}
      <div className="rounded-2xl border border-slate-200 bg-white p-6">
        <div className="flex items-center gap-3 mb-5">
          <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-[#5b6cf9]/10">
            <Wand2 size={20} className="text-[#5b6cf9]" />
          </div>
          <div>
            <h2 className="text-lg font-black text-slate-900">AI Design Studio</h2>
            <p className="text-sm text-slate-500">Write a prompt — your image is generated exactly as described.</p>
          </div>
        </div>

        {/* Mode toggle */}
        <div className="flex gap-1 rounded-xl border border-slate-200 bg-slate-50 p-1 w-fit mb-5">
          {([{ id: 'image' as GenMode, label: 'Image', icon: <Image size={13} /> }, { id: 'video' as GenMode, label: 'Video', icon: <Video size={13} /> }]).map((m) => (
            <button key={m.id} type="button" onClick={() => setGenMode(m.id)}
              className={`flex items-center gap-1.5 rounded-lg px-4 py-1.5 text-sm font-semibold transition ${genMode === m.id ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500 hover:text-slate-700'}`}>
              {m.icon} {m.label}
            </button>
          ))}
        </div>

        {/* Model picker */}
        <div className="mb-5">
          <label className="block text-xs font-bold text-slate-500 uppercase tracking-wide mb-2">Model</label>
          <div className="flex flex-wrap gap-2">
            {(genMode === 'image' ? IMAGE_MODELS : VIDEO_MODELS).map((m) => (
              <button key={m.id} type="button"
                onClick={() => genMode === 'image' ? setSelectedImageModel(m) : setSelectedVideoModel(m)}
                className={`relative flex flex-col rounded-xl border px-3 py-2 text-left transition min-w-[130px] ${
                  currentModel.id === m.id ? 'border-[#5b6cf9] bg-indigo-50 text-[#5b6cf9]' : 'border-slate-200 bg-white text-slate-700 hover:border-slate-300'
                }`}
              >
                {m.badge && <span className="absolute -top-2 -right-2 rounded-full bg-[#5b6cf9] px-1.5 py-0.5 text-[9px] font-bold text-white">{m.badge}</span>}
                <span className="text-xs font-bold">{m.label}</span>
                <span className="text-[10px] text-slate-400 mt-0.5">{m.desc}</span>
                <span className="mt-1 text-[10px] font-bold text-[#5b6cf9]">✦{m.creditCost} credits</span>
              </button>
            ))}
          </div>
        </div>

        {/* Image form */}
        {genMode === 'image' ? (
          <div className="space-y-3">
            <textarea
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey) && !generating) generateImage(); }}
              rows={4}
              placeholder="Describe exactly what you want to generate…"
              className="w-full resize-none rounded-xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-800 placeholder-slate-400 outline-none focus:border-[#5b6cf9] focus:ring-1 focus:ring-[#5b6cf9] transition"
            />
            <button type="button" disabled={!prompt.trim() || generating} onClick={generateImage}
              className="flex items-center gap-2 rounded-xl bg-[#5b6cf9] px-5 py-2.5 text-sm font-bold text-white shadow-sm hover:bg-indigo-600 disabled:opacity-40 transition active:scale-[0.98]">
              {generating ? <><Loader2 size={14} className="animate-spin" /> Generating…</> : <><Sparkles size={15} /> Generate ✦{selectedImageModel.creditCost}</>}
            </button>
            {errorMsg && (
              <div className="flex items-start gap-2 rounded-xl border border-red-200 bg-red-50 px-4 py-3">
                <AlertCircle size={14} className="text-red-500 mt-0.5 shrink-0" />
                <p className="text-sm text-red-700">{errorMsg}</p>
              </div>
            )}
          </div>
        ) : (
          /* Video form */
          <div className="space-y-3">
            <textarea
              value={videoPrompt}
              onChange={(e) => setVideoPrompt(e.target.value)}
              rows={3}
              placeholder="Describe your video… e.g. a slow-motion ocean wave at sunset with cinematic lighting"
              className="w-full resize-none rounded-xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-800 placeholder-slate-400 outline-none focus:border-[#5b6cf9] focus:ring-1 focus:ring-[#5b6cf9] transition"
            />
            <button type="button" disabled={!videoPrompt.trim() || generatingVideo} onClick={generateVideo}
              className="flex items-center gap-2 rounded-xl bg-[#5b6cf9] px-5 py-2.5 text-sm font-bold text-white shadow-sm hover:bg-indigo-600 disabled:opacity-40 transition active:scale-[0.98]">
              {generatingVideo ? <><Loader2 size={14} className="animate-spin" /> Generating…</> : <><Play size={14} /> Generate Video ✦{selectedVideoModel.creditCost}</>}
            </button>
            {videoError && <p className="text-xs text-red-500">{videoError}</p>}
          </div>
        )}
      </div>

      {/* Generating overlay */}
      {generating && (
        <div className="rounded-2xl border border-slate-200 bg-white p-8 flex flex-col items-center gap-4">
          <div className="relative w-14 h-14">
            <div className="absolute inset-0 rounded-full border-4 border-indigo-100" />
            <div className="absolute inset-0 rounded-full border-4 border-transparent border-t-[#5b6cf9] animate-spin" />
            <div className="absolute inset-0 flex items-center justify-center">
              <Sparkles size={18} className="text-[#5b6cf9]" />
            </div>
          </div>
          <div className="text-center">
            <p className="font-black text-slate-900">Generating your image…</p>
            <p className="text-sm text-slate-400 mt-1 max-w-xs truncate">"{prompt}"</p>
          </div>
          <p className="text-xs text-slate-400">This may take 15–60 seconds depending on the model.</p>
        </div>
      )}

      {/* Result */}
      {imageUrl && !generating && (
        <div className="rounded-2xl border border-slate-200 bg-white overflow-hidden">
          <img src={imageUrl} alt="Generated" className="w-full object-cover" />
          <div className="p-4 flex items-center gap-3">
            <a href={imageUrl} download target="_blank" rel="noreferrer"
              className="flex items-center gap-1.5 rounded-xl border border-slate-200 px-4 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50 transition">
              <Download size={13} /> Download
            </a>
            {designId && (
              <span className="flex items-center gap-1.5 text-xs text-emerald-600 font-semibold">
                <CheckCircle2 size={13} /> Saved to History
              </span>
            )}
            <button type="button" onClick={() => { setImageUrl(null); setDesignId(null); setErrorMsg(null); }}
              className="ml-auto flex items-center gap-1.5 rounded-xl border border-slate-200 px-4 py-2 text-xs font-semibold text-slate-600 hover:bg-slate-50 transition">
              <RefreshCw size={13} /> New Image
            </button>
          </div>
        </div>
      )}

      {/* Video result */}
      {videoUrl && !generatingVideo && (
        <div className="rounded-2xl overflow-hidden border border-slate-200 bg-white">
          <video src={videoUrl} controls className="w-full" />
          <div className="p-4 flex gap-2">
            <a href={videoUrl} download target="_blank" rel="noreferrer"
              className="flex items-center gap-1.5 rounded-xl border border-slate-200 px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-50 transition">
              <Download size={12} /> Download
            </a>
          </div>
        </div>
      )}
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

// ── Image preview modal ───────────────────────────────────────────────────────

function ImagePreviewModal({
  tpl,
  onClose,
  onUseAsPrompt,
  onUseAsRef,
}: {
  tpl: CardTemplate;
  onClose: () => void;
  onUseAsPrompt: () => void;
  onUseAsRef: () => void;
}) {
  const [liked, setLiked]       = useState(false);
  const [likeCount, setLikeCount] = useState(tpl.like_count ?? 0);
  const [viewCount, setViewCount] = useState(tpl.view_count ?? 0);
  const [copied, setCopied]     = useState(false);

  useEffect(() => {
    fetch(`${getApiBaseUrl()}/api/card-templates/${tpl.id}/view`, {
      method: 'POST', headers: { Authorization: `Bearer ${tok()}` },
    }).then(r => r.json()).then(d => { if (d.success) setViewCount(d.view_count ?? viewCount); }).catch(() => {});
    const h = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tpl.id]);

  const toggleLike = () => {
    fetch(`${getApiBaseUrl()}/api/card-templates/${tpl.id}/like`, {
      method: 'POST', headers: { Authorization: `Bearer ${tok()}` },
    }).then(r => r.json()).then(d => {
      if (d.success) { setLiked(d.liked); setLikeCount(d.like_count); }
    }).catch(() => {});
    setLiked(p => !p);
    setLikeCount(p => liked ? p - 1 : p + 1);
  };

  const copyPrompt = () => {
    navigator.clipboard.writeText(tpl.description || '').then(() => {
      setCopied(true); setTimeout(() => setCopied(false), 2000);
    }).catch(() => {});
  };

  const avatarColor = `hsl(${tpl.name.charCodeAt(0) * 37 % 360}, 55%, 45%)`;

  return (
    <div className="fixed inset-0 z-50 flex bg-black/85 backdrop-blur-xl" onClick={onClose}>

      {/* Top-right controls (over the image area) */}
      <div className="absolute top-4 z-20 flex items-center gap-2" style={{ right: 'calc(288px + 16px)' }}>
        <button type="button"
          className="flex items-center gap-1.5 rounded-lg bg-white/10 hover:bg-white/20 px-3 py-1.5 text-xs font-semibold text-white transition">
          <Download size={12} /> Save
        </button>
        {tpl.coverImageUrl && (
          <a href={tpl.coverImageUrl} download target="_blank" rel="noreferrer"
            onClick={e => e.stopPropagation()}
            className="flex h-7 w-7 items-center justify-center rounded-lg bg-white/10 hover:bg-white/20 text-white transition">
            <Download size={13} />
          </a>
        )}
        <span className="flex items-center rounded-lg bg-white/10 px-2 py-1 text-[11px] text-white/60">esc</span>
        <button type="button" onClick={onClose}
          className="flex h-7 w-7 items-center justify-center rounded-lg bg-white/10 hover:bg-white/20 text-white transition">
          <X size={14} />
        </button>
      </div>

      {/* Left: image */}
      <div className="flex-1 flex items-center justify-center p-8 md:p-16" onClick={e => e.stopPropagation()}>
        {tpl.coverImageUrl ? (
          <img src={tpl.coverImageUrl} alt={tpl.name}
            className="max-h-[85vh] max-w-full object-contain rounded-2xl shadow-2xl" />
        ) : (
          <div className="w-64 aspect-[3/4] rounded-2xl bg-slate-800 flex items-center justify-center text-white/20">
            <LayoutTemplate size={48} />
          </div>
        )}
      </div>

      {/* Right: info panel */}
      <div className="w-72 bg-white flex flex-col shrink-0 overflow-hidden" onClick={e => e.stopPropagation()}>

        {/* Creator header */}
        <div className="flex items-center gap-3 px-4 py-3 border-b border-slate-100">
          <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-white text-sm font-bold"
            style={{ background: avatarColor }}>
            {tpl.name.charAt(0).toUpperCase()}
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-sm font-bold text-slate-900 truncate">{tpl.name}</p>
            <p className="text-[11px] text-slate-400 truncate">@{tpl.name.toLowerCase().replace(/\s+/g, '')}</p>
          </div>
          <span className="shrink-0 rounded-md bg-slate-100 px-2 py-0.5 text-[10px] font-semibold text-slate-500">
            GPT Image
          </span>
        </div>

        {/* Stats */}
        <div className="flex items-center gap-4 px-4 py-2.5 border-b border-slate-100 text-xs text-slate-500">
          <button type="button" onClick={toggleLike}
            className={`flex items-center gap-1 transition ${liked ? 'text-red-500' : 'hover:text-red-400'}`}>
            <Heart size={12} className={liked ? 'fill-red-500' : ''} />
            {likeCount.toLocaleString()}
          </button>
          <span className="flex items-center gap-1"><Eye size={12} /> {viewCount.toLocaleString()}</span>
          <span className="ml-auto text-[10px] text-slate-400">{timeAgo(tpl.createdAt)}</span>
        </div>

        {/* Scrollable prompt */}
        <div className="flex-1 overflow-y-auto px-4 py-3 text-[12px] text-slate-700 leading-relaxed">
          {tpl.description
            ? tpl.description
            : <span className="text-slate-400 italic">No prompt available.</span>
          }
        </div>

        {/* Translate + Copy */}
        <div className="flex items-center gap-1 px-3 py-2 border-t border-slate-100">
          <button type="button"
            className="flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-[11px] font-medium text-slate-500 hover:bg-slate-50 transition">
            <Languages size={11} /> Translate
          </button>
          <button type="button" onClick={copyPrompt}
            className="flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-[11px] font-medium text-slate-500 hover:bg-slate-50 transition">
            {copied ? <CheckCircle2 size={11} className="text-emerald-500" /> : <Copy size={11} />}
            {copied ? 'Copied' : 'Copy'}
          </button>
        </div>

        {/* Action buttons */}
        <div className="flex gap-2 px-4 py-3 border-t border-slate-100">
          <button type="button"
            onClick={() => { onUseAsPrompt(); onClose(); }}
            className="flex-1 flex items-center justify-center gap-1.5 rounded-xl bg-slate-900 py-2.5 text-[11px] font-bold text-white hover:bg-slate-800 transition">
            <RotateCcw size={11} /> Use as Prompt
          </button>
          <button type="button"
            onClick={() => { onUseAsRef(); onClose(); }}
            className="flex-1 flex items-center justify-center gap-1.5 rounded-xl bg-slate-900 py-2.5 text-[11px] font-bold text-white hover:bg-slate-800 transition">
            Use as Ref
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Discover card (masonry) ───────────────────────────────────────────────────

function DiscoverCard({
  tpl,
  onPreview,
  onUseIdea,
}: {
  tpl: CardTemplate;
  onPreview: () => void;
  onUseIdea: (e: React.MouseEvent) => void;
}) {
  const avatarColor = `hsl(${tpl.name.charCodeAt(0) * 37 % 360}, 55%, 45%)`;

  return (
    <div
      className="group relative cursor-pointer overflow-hidden rounded-xl bg-slate-900"
      onClick={onPreview}
    >
      {tpl.coverImageUrl ? (
        <img
          src={tpl.coverImageUrl}
          alt={tpl.name}
          className="w-full h-auto block transition-transform duration-300 group-hover:scale-[1.02]"
        />
      ) : (
        <div className="aspect-[4/5] flex items-center justify-center bg-gradient-to-br from-slate-700 to-slate-900">
          <LayoutTemplate size={36} className="text-white/20" />
        </div>
      )}

      {/* Bottom info — slides up on hover */}
      <div className="absolute inset-x-0 bottom-0 translate-y-full group-hover:translate-y-0 transition-transform duration-200 bg-gradient-to-t from-black/95 via-black/70 to-transparent pt-10 pb-3 px-3">
        {/* Creator row */}
        <div className="flex items-center gap-2 mb-1.5">
          <div className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-white text-[10px] font-bold"
            style={{ background: avatarColor }}>
            {tpl.name.charAt(0).toUpperCase()}
          </div>
          <div className="min-w-0">
            <p className="text-white text-[11px] font-bold leading-none truncate">{tpl.name}</p>
            <p className="text-white/60 text-[10px] mt-0.5 truncate">@{tpl.name.toLowerCase().replace(/\s+/g, '')}</p>
          </div>
        </div>

        {/* Stats */}
        <div className="flex items-center gap-3 text-white/60 text-[10px] mb-2.5">
          <span className="flex items-center gap-0.5"><Heart size={9} /> {(tpl.like_count ?? 0).toLocaleString()}</span>
          <span className="flex items-center gap-0.5"><Eye size={9} /> {(tpl.view_count ?? 0).toLocaleString()}</span>
          <span>{timeAgo(tpl.createdAt)}</span>
        </div>

        {/* Actions */}
        <div className="flex items-center justify-between">
          <button type="button" onClick={onUseIdea}
            className="flex items-center gap-1.5 rounded-full bg-white/90 hover:bg-white px-3 py-1.5 text-[11px] font-bold text-slate-900 transition">
            <RotateCcw size={10} /> Use Idea
          </button>
          <div className="flex items-center gap-1.5">
            <button type="button" onClick={e => e.stopPropagation()}
              className="flex h-7 w-7 items-center justify-center rounded-full bg-white/10 hover:bg-white/20 text-white transition">
              <Layers size={12} />
            </button>
            <button type="button" onClick={e => e.stopPropagation()}
              className="flex h-7 w-7 items-center justify-center rounded-full bg-white/10 hover:bg-white/20 text-white transition">
              <Share2 size={12} />
            </button>
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

// ── Generate panel (inline right sidebar) ────────────────────────────────────

const PANEL_IMAGE_MODELS = [
  { id: 'flux-2-turbo',     label: 'Flux 2 Turbo',     tier: 'Fast',    credits: 3,  desc: 'Fastest, great for drafts' },
  { id: 'flux-2-klein',     label: 'Flux 2 Klein',     tier: 'Fast',    credits: 3,  desc: 'Fast with reference images' },
  { id: 'seedream-v5-lite', label: 'Seedream 5 Lite',  tier: 'Fast',    credits: 4,  desc: 'New — high coherence', badge: 'NEW' },
  { id: 'flux-kontext-pro', label: 'Flux Kontext Pro', tier: 'Quality', credits: 5,  desc: 'Best for context-aware edits', badge: 'Popular' },
  { id: 'flux-2-pro',       label: 'Flux 2 Pro',       tier: 'Quality', credits: 5,  desc: 'High quality text-to-image' },
  { id: 'mystic',           label: 'Mystic',            tier: 'Premium', credits: 8,  desc: "Magnific's flagship model" },
] as const;

const EDIT_TOOLS = [
  { id: 'upscale',          label: 'Upscale',          credits: 5,  desc: 'Increase image resolution up to 16×' },
  { id: 'relight',          label: 'Relight',          credits: 4,  desc: 'Change lighting and atmosphere' },
  { id: 'style-transfer',   label: 'Style Transfer',   credits: 5,  desc: 'Apply style from a reference image' },
  { id: 'remove-background',label: 'Remove Background',credits: 1,  desc: 'Remove background instantly' },
] as const;

type PanelMode = 'generate' | 'edit';
type EditTool  = typeof EDIT_TOOLS[number]['id'];
type ScaleFactor = '2x' | '4x' | '8x';

function GeneratePanel({
  tpl,
  useMode,
  onClose,
  onGenerated,
}: {
  tpl: CardTemplate;
  useMode: UseMode;
  onClose: () => void;
  onGenerated?: () => void;
}) {
  const imgToPromptRef   = useRef<HTMLInputElement>(null);
  const refUploadRef     = useRef<HTMLInputElement>(null);
  const editSourceRef    = useRef<HTMLInputElement>(null);
  const editRefRef       = useRef<HTMLInputElement>(null);

  // Generate mode state
  const [panelMode, setPanelMode]       = useState<PanelMode>('generate');
  const [prompt, setPrompt]             = useState(tpl.description || '');
  const [imgToPrompt, setImgToPrompt]   = useState<string | null>(useMode === 'prompt' ? tpl.coverImageUrl : null);
  const [refImage, setRefImage]         = useState<string | null>(useMode === 'ref'    ? tpl.coverImageUrl : null);
  const [selectedModel, setSelectedModel] = useState<string>(PANEL_IMAGE_MODELS[3].id); // flux-kontext-pro default
  const [modelOpen, setModelOpen]       = useState(false);
  const [aspectRatio, setAspectRatio]   = useState('auto');
  const [resolution, setResolution]     = useState<'1k' | '2k' | '4k'>('2k');
  const [batchCount]                    = useState(1);
  const [aspectOpen, setAspectOpen]     = useState(false);
  const [resOpen, setResOpen]           = useState(false);
  const [improvingPrompt, setImprovingPrompt] = useState(false);
  const [generating, setGenerating]     = useState(false);
  const [resultUrls, setResultUrls]     = useState<string[]>([]);
  const [errorMsg, setErrorMsg]         = useState<string | null>(null);

  // Edit mode state
  const [editTool, setEditTool]         = useState<EditTool>('upscale');
  const [editSource, setEditSource]     = useState<string | null>(null);
  const [editRef, setEditRef]           = useState<string | null>(null);
  const [editPrompt, setEditPrompt]     = useState('');
  const [scaleFactor, setScaleFactor]   = useState<ScaleFactor>('2x');
  const [relightStyle, setRelightStyle] = useState('standard');
  const [styleStrength, setStyleStrength] = useState(80);
  const [structureStrength, setStructureStrength] = useState(50);
  const [editResult, setEditResult]     = useState<string | null>(null);
  const [editGenerating, setEditGenerating] = useState(false);
  const [editError, setEditError]       = useState<string | null>(null);

  const currentModelInfo = PANEL_IMAGE_MODELS.find(m => m.id === selectedModel) ?? PANEL_IMAGE_MODELS[3];
  const currentEditTool  = EDIT_TOOLS.find(t => t.id === editTool) ?? EDIT_TOOLS[0];

  const handleImgToPromptUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]; if (!file) return;
    const r = new FileReader(); r.onload = () => setImgToPrompt(r.result as string); r.readAsDataURL(file);
  };
  const handleRefUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]; if (!file) return;
    const r = new FileReader(); r.onload = () => setRefImage(r.result as string); r.readAsDataURL(file);
  };
  const handleEditSourceUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]; if (!file) return;
    const r = new FileReader(); r.onload = () => setEditSource(r.result as string); r.readAsDataURL(file);
  };
  const handleEditRefUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]; if (!file) return;
    const r = new FileReader(); r.onload = () => setEditRef(r.result as string); r.readAsDataURL(file);
  };

  const doImprovePrompt = async () => {
    if (!prompt.trim() || improvingPrompt) return;
    setImprovingPrompt(true);
    try {
      const res = await fetch(`${getApiBaseUrl()}/api/magnific/improve-prompt`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${tok()}` },
        body: JSON.stringify({ prompt: prompt.trim() }),
      });
      const d = await res.json();
      if (d.success && d.prompt) setPrompt(d.prompt);
    } catch { /* silent */ } finally { setImprovingPrompt(false); }
  };

  const doGenerate = async () => {
    if (!prompt.trim() || generating) return;
    setGenerating(true); setErrorMsg(null); setResultUrls([]);
    try {
      const ar = aspectRatio === 'auto' ? '1:1' : aspectRatio;
      const res = await fetch(`${getApiBaseUrl()}/api/nova/generate-image`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${tok()}` },
        body: JSON.stringify({ prompt: prompt.trim(), model: selectedModel, aspect_ratio: ar, save: true }),
      });
      const d = await res.json();
      if (!d.success) throw new Error(d.error ?? 'Generation failed');
      if (d.url) setResultUrls([d.url]);
      onGenerated?.();
    } catch (err: any) {
      setErrorMsg(err.message ?? 'Generation failed');
    } finally { setGenerating(false); }
  };

  const doEdit = async () => {
    if (!editSource || editGenerating) return;
    setEditGenerating(true); setEditError(null); setEditResult(null);
    try {
      const body: Record<string, any> = { type: editTool };
      if (editTool === 'remove-background') {
        body.image_url = editSource;
      } else {
        body.image = editSource;
        if (editPrompt) body.prompt = editPrompt;
        if (editTool === 'upscale') body.scale_factor = scaleFactor;
        if (editTool === 'relight') body.style = relightStyle;
        if (editTool === 'style-transfer') {
          if (!editRef) { setEditError('Reference image is required for Style Transfer'); setEditGenerating(false); return; }
          body.reference_image = editRef;
          body.style_strength = styleStrength;
          body.structure_strength = structureStrength;
        }
      }
      const res = await fetch(`${getApiBaseUrl()}/api/magnific/edit`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${tok()}` },
        body: JSON.stringify(body),
      });
      const d = await res.json();
      if (!d.success) throw new Error(d.error ?? 'Edit failed');
      setEditResult(d.url);
    } catch (err: any) {
      setEditError(err.message ?? 'Edit failed');
    } finally { setEditGenerating(false); }
  };

  return (
    <div className="flex flex-col h-full bg-white border-l border-slate-200 overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-slate-100 shrink-0">
        {/* Mode toggle */}
        <div className="flex items-center gap-0.5 bg-slate-100 rounded-lg p-0.5">
          {(['generate', 'edit'] as PanelMode[]).map(m => (
            <button key={m} type="button" onClick={() => setPanelMode(m)}
              className={`px-2.5 py-1 rounded-md text-[10px] font-semibold capitalize transition ${
                panelMode === m ? 'bg-white text-slate-800 shadow-sm' : 'text-slate-500 hover:text-slate-700'
              }`}>
              {m}
            </button>
          ))}
        </div>
        <div className="flex items-center gap-1">
          <button type="button" className="flex h-6 w-6 items-center justify-center rounded text-slate-400 hover:bg-slate-100 transition">
            <Maximize2 size={13} />
          </button>
          <button type="button" onClick={onClose} className="flex h-6 w-6 items-center justify-center rounded text-slate-400 hover:bg-slate-100 transition">
            <X size={13} />
          </button>
        </div>
      </div>

      {panelMode === 'generate' ? (
        <>
          <div className="flex-1 overflow-y-auto">
            {/* Image to Prompt */}
            <div className="flex items-center gap-3 px-4 py-3 border-b border-slate-100 cursor-pointer hover:bg-slate-50 transition"
              onClick={() => imgToPromptRef.current?.click()}>
              <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-slate-100 text-slate-400">
                <Image size={14} />
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-[11px] font-semibold text-slate-700">Image to Prompt</p>
                <p className="text-[10px] text-slate-400">Upload image to generate a prompt</p>
              </div>
              {imgToPrompt && (
                <div className="relative">
                  <img src={imgToPrompt} alt="" className="h-9 w-9 shrink-0 rounded-lg object-cover border border-slate-200" />
                  <button type="button" onClick={e => { e.stopPropagation(); setImgToPrompt(null); }}
                    className="absolute -top-1.5 -right-1.5 flex h-4 w-4 items-center justify-center rounded-full bg-slate-800 text-white text-[8px]">✕</button>
                </div>
              )}
            </div>
            <input ref={imgToPromptRef} type="file" accept="image/*" className="hidden" onChange={handleImgToPromptUpload} />

            {/* Drop or upload reference */}
            <div className="flex items-center gap-3 px-4 py-3 border-b border-slate-100 cursor-pointer hover:bg-slate-50 transition"
              onClick={() => refUploadRef.current?.click()}>
              <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-slate-100 text-slate-400">
                <Image size={14} />
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-[11px] font-semibold text-slate-500">Drop or upload reference</p>
                <p className="text-[10px] text-slate-400">optional</p>
              </div>
              {refImage ? (
                <div className="relative">
                  <img src={refImage} alt="" className="h-9 w-9 shrink-0 rounded-lg object-cover border border-slate-200" />
                  <button type="button" onClick={e => { e.stopPropagation(); setRefImage(null); }}
                    className="absolute -top-1.5 -right-1.5 flex h-4 w-4 items-center justify-center rounded-full bg-slate-800 text-white text-[8px]">✕</button>
                </div>
              ) : (
                <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg border border-slate-200 bg-white text-slate-400">
                  <Plus size={12} />
                </div>
              )}
            </div>
            <input ref={refUploadRef} type="file" accept="image/*" className="hidden" onChange={handleRefUpload} />

            {/* Prompt + Improve */}
            <div className="px-4 pt-3">
              <div className="flex items-center justify-between mb-1.5">
                <span className="text-[11px] font-bold text-slate-700">Prompt</span>
                <button type="button" disabled={!prompt.trim() || improvingPrompt} onClick={doImprovePrompt}
                  title="Improve prompt with Magnific AI"
                  className="flex items-center gap-1 text-[10px] text-[#5b6cf9] hover:text-[#4a5ae0] disabled:opacity-40 disabled:cursor-not-allowed transition font-semibold">
                  {improvingPrompt ? <Loader2 size={10} className="animate-spin" /> : <Wand2 size={10} />}
                  Improve
                </button>
              </div>
              <textarea value={prompt} onChange={e => setPrompt(e.target.value)} rows={8}
                placeholder="Describe what you want to generate…"
                className="w-full resize-none border-0 bg-transparent text-[11px] text-slate-800 placeholder-slate-300 outline-none leading-relaxed" />
            </div>

            {/* Controls row: batch / lock / aspect / resolution */}
            <div className="flex items-center gap-2 px-4 py-2.5 border-t border-slate-100">
              <button type="button" className="text-slate-400 hover:text-slate-700 text-xs font-bold px-0.5">−</button>
              <span className="text-[11px] font-semibold text-slate-600">{batchCount}/4</span>
              <div className="relative group/lock">
                <button type="button" className="flex h-6 w-6 items-center justify-center rounded text-slate-400 hover:bg-slate-100 transition">
                  <Lock size={11} />
                </button>
                <div className="absolute bottom-full left-1/2 -translate-x-1/2 mb-1 hidden group-hover/lock:block whitespace-nowrap rounded-lg bg-slate-800 px-2 py-1 text-[10px] text-white shadow-lg z-50 pointer-events-none">
                  Upgrade to unlock batch generation
                </div>
              </div>

              {/* Aspect ratio */}
              <div className="relative">
                <button type="button" onClick={() => { setAspectOpen(o => !o); setResOpen(false); }}
                  className="flex items-center gap-1 rounded-lg border border-slate-200 bg-slate-50 px-2 py-1 text-[10px] font-semibold text-slate-600 hover:border-slate-300 transition">
                  <Maximize2 size={9} /> {aspectRatio === 'auto' ? 'Auto' : aspectRatio}
                </button>
                {aspectOpen && (
                  <div className="absolute top-full left-0 mt-1 z-50 w-24 rounded-xl border border-slate-200 bg-white shadow-xl overflow-auto max-h-64">
                    {['auto', ...ASPECT_RATIOS].map(r => (
                      <button key={r} type="button" onClick={() => { setAspectRatio(r); setAspectOpen(false); }}
                        className={`w-full flex items-center gap-2 px-3 py-1.5 text-[11px] text-left hover:bg-slate-50 transition ${aspectRatio === r ? 'font-bold text-slate-900' : 'text-slate-600'}`}>
                        {r === 'auto' ? 'Auto' : r}
                      </button>
                    ))}
                  </div>
                )}
              </div>

              {/* Resolution */}
              <div className="relative">
                <button type="button" onClick={() => { setResOpen(o => !o); setAspectOpen(false); }}
                  className="flex items-center gap-1 rounded-lg border border-slate-200 bg-slate-50 px-2 py-1 text-[10px] font-semibold text-slate-600 hover:border-slate-300 transition">
                  ↔ {resolution.toUpperCase()}
                </button>
                {resOpen && (
                  <div className="absolute top-full left-0 mt-1 z-50 w-52 rounded-xl border border-slate-200 bg-white shadow-xl overflow-hidden">
                    {[
                      { key: '1k', label: '1K', desc: 'Recommended For Most Use Cases', locked: false },
                      { key: '2k', label: '2K', desc: 'Higher Detail, Balanced',         locked: false },
                      { key: '4k', label: '4K', desc: 'Upgrade to unlock 4K resolution', locked: true  },
                    ].map(r => (
                      <button key={r.key} type="button" disabled={r.locked}
                        onClick={() => { if (!r.locked) { setResolution(r.key as any); setResOpen(false); } }}
                        className={`w-full flex flex-col text-left px-3 py-2.5 hover:bg-slate-50 transition disabled:cursor-not-allowed ${resolution === r.key ? 'bg-slate-50' : ''}`}>
                        <span className="flex items-center gap-1.5 text-[11px] font-bold text-slate-800">
                          {r.label} {r.locked && <Lock size={9} className="text-slate-400" />}
                        </span>
                        <span className="text-[10px] text-slate-400 mt-0.5">{r.desc}</span>
                      </button>
                    ))}
                  </div>
                )}
              </div>
            </div>

            {/* Model selector */}
            <div className="px-4 py-3 border-t border-slate-100">
              <p className="text-[10px] text-slate-400 mb-2">Model</p>
              <div className="relative">
                <button type="button" onClick={() => setModelOpen(o => !o)}
                  className="w-full flex items-center gap-2 rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 hover:border-slate-300 transition">
                  <Sparkles size={12} className="text-[#5b6cf9] shrink-0" />
                  <div className="flex-1 text-left">
                    <div className="flex items-center gap-1.5">
                      <span className="text-[11px] font-semibold text-slate-800">{currentModelInfo.label}</span>
                      {'badge' in currentModelInfo && currentModelInfo.badge && (
                        <span className="rounded-full bg-[#5b6cf9]/10 px-1.5 py-0.5 text-[9px] font-bold text-[#5b6cf9]">{currentModelInfo.badge}</span>
                      )}
                    </div>
                    <span className="text-[9px] text-slate-400">{currentModelInfo.desc}</span>
                  </div>
                  <div className="flex items-center gap-1">
                    <span className="text-[10px] font-bold text-[#5b6cf9]">✦{currentModelInfo.credits}</span>
                    <ChevronDown size={12} className="text-slate-400" />
                  </div>
                </button>
                {modelOpen && (
                  <div className="absolute top-full left-0 right-0 mt-1 z-50 rounded-xl border border-slate-200 bg-white shadow-xl overflow-hidden">
                    {(['Fast', 'Quality', 'Premium'] as const).map(tier => {
                      const tierModels = PANEL_IMAGE_MODELS.filter(m => m.tier === tier);
                      return (
                        <div key={tier}>
                          <div className="px-3 py-1.5 bg-slate-50 border-b border-slate-100">
                            <span className="text-[9px] font-bold text-slate-400 uppercase tracking-wider">{tier}</span>
                          </div>
                          {tierModels.map(m => (
                            <button key={m.id} type="button" onClick={() => { setSelectedModel(m.id); setModelOpen(false); }}
                              className={`w-full flex items-center gap-2 px-3 py-2 text-left hover:bg-slate-50 transition ${selectedModel === m.id ? 'bg-[#5b6cf9]/5' : ''}`}>
                              <div className="flex-1">
                                <div className="flex items-center gap-1.5">
                                  <span className="text-[11px] font-semibold text-slate-800">{m.label}</span>
                                  {'badge' in m && m.badge && (
                                    <span className="rounded-full bg-[#5b6cf9]/10 px-1.5 py-0.5 text-[9px] font-bold text-[#5b6cf9]">{m.badge}</span>
                                  )}
                                </div>
                                <span className="text-[9px] text-slate-400">{m.desc}</span>
                              </div>
                              <span className="text-[10px] font-bold text-[#5b6cf9]">✦{m.credits}</span>
                            </button>
                          ))}
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            </div>

            {errorMsg && (
              <div className="mx-4 mb-3 rounded-xl bg-red-50 border border-red-200 px-3 py-2 text-[11px] text-red-600">{errorMsg}</div>
            )}

            {resultUrls.length > 0 && (
              <div className="px-4 pb-3 space-y-2">
                {resultUrls.map((url, i) => (
                  <div key={i} className="rounded-xl overflow-hidden border border-slate-200">
                    <img src={url} alt="Generated" className="w-full" />
                    <div className="p-2 flex gap-1.5">
                      <a href={url} download target="_blank" rel="noreferrer"
                        className="flex items-center gap-1 rounded-lg border border-slate-200 px-2.5 py-1 text-[10px] font-semibold text-slate-600 hover:bg-slate-50 transition">
                        <Download size={10} /> Download
                      </a>
                      <button type="button" onClick={() => setResultUrls([])}
                        className="flex items-center gap-1 rounded-lg border border-slate-200 px-2.5 py-1 text-[10px] font-semibold text-slate-600 hover:bg-slate-50 transition">
                        <RefreshCw size={10} /> New
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
          {/* Generate button */}
          <div className="px-4 py-3 border-t border-slate-100 shrink-0">
            <button type="button" disabled={!prompt.trim() || generating} onClick={doGenerate}
              className="w-full flex items-center justify-center gap-2 rounded-xl bg-slate-900 py-3 text-sm font-bold text-white hover:bg-slate-800 disabled:opacity-40 disabled:cursor-not-allowed transition active:scale-[0.98]">
              {generating ? <><Loader2 size={14} className="animate-spin" /> Generating…</> : <><Sparkles size={14} /> Generate ✦{currentModelInfo.credits}</>}
            </button>
          </div>
        </>
      ) : (
        /* ── Edit mode ── */
        <>
          <div className="flex-1 overflow-y-auto">
            {/* Tool selector */}
            <div className="px-4 py-3 border-b border-slate-100">
              <p className="text-[10px] text-slate-400 mb-2">Edit Tool</p>
              <div className="grid grid-cols-2 gap-1.5">
                {EDIT_TOOLS.map(t => (
                  <button key={t.id} type="button" onClick={() => { setEditTool(t.id); setEditResult(null); setEditError(null); }}
                    className={`flex flex-col items-start rounded-xl border px-2.5 py-2 text-left transition ${
                      editTool === t.id ? 'border-[#5b6cf9] bg-[#5b6cf9]/5' : 'border-slate-200 hover:border-slate-300'
                    }`}>
                    <span className="text-[10px] font-bold text-slate-800">{t.label}</span>
                    <span className="text-[9px] text-slate-400 mt-0.5 leading-tight">{t.desc}</span>
                    <span className="mt-1 text-[9px] font-bold text-[#5b6cf9]">✦{t.credits}</span>
                  </button>
                ))}
              </div>
            </div>

            {/* Source image upload */}
            <div className="flex items-center gap-3 px-4 py-3 border-b border-slate-100 cursor-pointer hover:bg-slate-50 transition"
              onClick={() => editSourceRef.current?.click()}>
              <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-slate-100 text-slate-400">
                <Image size={14} />
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-[11px] font-semibold text-slate-700">Source Image</p>
                <p className="text-[10px] text-slate-400">Required — tap to upload</p>
              </div>
              {editSource ? (
                <div className="relative">
                  <img src={editSource} alt="" className="h-9 w-9 shrink-0 rounded-lg object-cover border border-slate-200" />
                  <button type="button" onClick={e => { e.stopPropagation(); setEditSource(null); }}
                    className="absolute -top-1.5 -right-1.5 flex h-4 w-4 items-center justify-center rounded-full bg-slate-800 text-white text-[8px]">✕</button>
                </div>
              ) : (
                <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg border-2 border-dashed border-slate-300 bg-white text-slate-400">
                  <Plus size={12} />
                </div>
              )}
            </div>
            <input ref={editSourceRef} type="file" accept="image/*" className="hidden" onChange={handleEditSourceUpload} />

            {/* Reference image (style-transfer only) */}
            {editTool === 'style-transfer' && (
              <>
                <div className="flex items-center gap-3 px-4 py-3 border-b border-slate-100 cursor-pointer hover:bg-slate-50 transition"
                  onClick={() => editRefRef.current?.click()}>
                  <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-slate-100 text-slate-400">
                    <Layers size={14} />
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-[11px] font-semibold text-slate-700">Style Reference</p>
                    <p className="text-[10px] text-slate-400">Required for style transfer</p>
                  </div>
                  {editRef ? (
                    <div className="relative">
                      <img src={editRef} alt="" className="h-9 w-9 shrink-0 rounded-lg object-cover border border-slate-200" />
                      <button type="button" onClick={e => { e.stopPropagation(); setEditRef(null); }}
                        className="absolute -top-1.5 -right-1.5 flex h-4 w-4 items-center justify-center rounded-full bg-slate-800 text-white text-[8px]">✕</button>
                    </div>
                  ) : (
                    <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg border-2 border-dashed border-slate-300 bg-white text-slate-400">
                      <Plus size={12} />
                    </div>
                  )}
                </div>
                <input ref={editRefRef} type="file" accept="image/*" className="hidden" onChange={handleEditRefUpload} />
              </>
            )}

            {/* Tool-specific controls */}
            <div className="px-4 py-3 border-b border-slate-100 space-y-3">
              {editTool === 'upscale' && (
                <div>
                  <p className="text-[10px] text-slate-400 mb-1.5">Scale factor</p>
                  <div className="flex gap-1.5">
                    {(['2x', '4x', '8x'] as ScaleFactor[]).map(s => (
                      <button key={s} type="button" onClick={() => setScaleFactor(s)}
                        className={`flex-1 rounded-lg border py-1.5 text-[10px] font-bold transition ${
                          scaleFactor === s ? 'border-slate-800 bg-slate-900 text-white' : 'border-slate-200 text-slate-600 hover:border-slate-300'
                        }`}>{s}</button>
                    ))}
                  </div>
                </div>
              )}
              {editTool === 'relight' && (
                <div>
                  <p className="text-[10px] text-slate-400 mb-1.5">Lighting style</p>
                  <select value={relightStyle} onChange={e => setRelightStyle(e.target.value)}
                    className="w-full rounded-lg border border-slate-200 bg-slate-50 px-2 py-1.5 text-[11px] text-slate-700 outline-none focus:border-[#5b6cf9]">
                    {['standard','smooth','brighter','contrasted_n_hdr','warm','cool','dramatic','golden_hour','neon'].map(s => (
                      <option key={s} value={s}>{s.replace(/_/g,' ').replace(/\b\w/g,c=>c.toUpperCase())}</option>
                    ))}
                  </select>
                </div>
              )}
              {editTool === 'style-transfer' && (
                <div className="space-y-2">
                  <div>
                    <div className="flex justify-between mb-1">
                      <p className="text-[10px] text-slate-400">Style strength</p>
                      <span className="text-[10px] font-bold text-slate-600">{styleStrength}%</span>
                    </div>
                    <input type="range" min={0} max={100} value={styleStrength} onChange={e => setStyleStrength(+e.target.value)}
                      className="w-full accent-[#5b6cf9]" />
                  </div>
                  <div>
                    <div className="flex justify-between mb-1">
                      <p className="text-[10px] text-slate-400">Structure strength</p>
                      <span className="text-[10px] font-bold text-slate-600">{structureStrength}%</span>
                    </div>
                    <input type="range" min={0} max={100} value={structureStrength} onChange={e => setStructureStrength(+e.target.value)}
                      className="w-full accent-[#5b6cf9]" />
                  </div>
                </div>
              )}
              {editTool !== 'remove-background' && (
                <div>
                  <p className="text-[10px] text-slate-400 mb-1.5">Guidance prompt (optional)</p>
                  <textarea value={editPrompt} onChange={e => setEditPrompt(e.target.value)} rows={3}
                    placeholder="Describe the desired result…"
                    className="w-full resize-none rounded-lg border border-slate-200 bg-slate-50 px-2 py-1.5 text-[11px] text-slate-800 placeholder-slate-300 outline-none focus:border-[#5b6cf9]" />
                </div>
              )}
            </div>

            {editError && (
              <div className="mx-4 mt-3 rounded-xl bg-red-50 border border-red-200 px-3 py-2 text-[11px] text-red-600">{editError}</div>
            )}

            {editResult && (
              <div className="px-4 py-3 space-y-2">
                <div className="rounded-xl overflow-hidden border border-slate-200">
                  <img src={editResult} alt="Result" className="w-full" />
                  <div className="p-2 flex gap-1.5">
                    <a href={editResult} download target="_blank" rel="noreferrer"
                      className="flex items-center gap-1 rounded-lg border border-slate-200 px-2.5 py-1 text-[10px] font-semibold text-slate-600 hover:bg-slate-50 transition">
                      <Download size={10} /> Download
                    </a>
                    <button type="button" onClick={() => setEditResult(null)}
                      className="flex items-center gap-1 rounded-lg border border-slate-200 px-2.5 py-1 text-[10px] font-semibold text-slate-600 hover:bg-slate-50 transition">
                      <RefreshCw size={10} /> New
                    </button>
                  </div>
                </div>
              </div>
            )}
          </div>
          {/* Apply button */}
          <div className="px-4 py-3 border-t border-slate-100 shrink-0">
            <button type="button" disabled={!editSource || editGenerating} onClick={doEdit}
              className="w-full flex items-center justify-center gap-2 rounded-xl bg-slate-900 py-3 text-sm font-bold text-white hover:bg-slate-800 disabled:opacity-40 disabled:cursor-not-allowed transition active:scale-[0.98]">
              {editGenerating ? <><Loader2 size={14} className="animate-spin" /> Processing…</> : <><Edit3 size={14} /> Apply {currentEditTool.label} ✦{currentEditTool.credits}</>}
            </button>
          </div>
        </>
      )}
    </div>
  );
}

// ── Main page ─────────────────────────────────────────────────────────────────

const Cards = () => {
  const [tab, setTab]               = useState<MainTab>('studio');
  const [modelFilter, setModelFilter] = useState<ModelFilter>('all');
  const [sortBy, setSortBy]         = useState<SortMode>('featured');
  const [generateTpl, setGenerateTpl] = useState<CardTemplate | null>(null);
  const [generateMode, setGenerateMode] = useState<UseMode>('prompt');
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

  const filteredTemplates = useMemo(() => {
    let list = [...templates];
    if (modelFilter !== 'all') {
      const labelMap: Record<ModelFilter, string> = {
        all: '', flux: 'flux', seedream: 'seedream', mystic: 'mystic', google: 'google',
      };
      const key = labelMap[modelFilter];
      list = list.filter((t) =>
        (t.name + ' ' + (t.description ?? '')).toLowerCase().includes(key)
      );
    }
    if (sortBy === 'newest') list.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
    else if (sortBy === 'popular') list.sort((a, b) => ((b.view_count ?? 0) + (b.like_count ?? 0)) - ((a.view_count ?? 0) + (a.like_count ?? 0)));
    return list;
  }, [templates, modelFilter, sortBy]);

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
        <div className="space-y-4">
          {/* Model filter tabs */}
          <div className="flex items-center gap-2 flex-wrap">
            {MODEL_TABS.map((m) => (
              <button
                key={m.id}
                type="button"
                onClick={() => setModelFilter(m.id)}
                className={`flex items-center gap-1.5 rounded-full px-4 py-1.5 text-sm font-semibold transition ${
                  modelFilter === m.id
                    ? 'bg-slate-900 text-white'
                    : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
                }`}
              >
                {m.label}
                {m.badge && (
                  <span className="rounded-full bg-[#5b6cf9] px-1.5 py-0.5 text-[9px] font-bold text-white leading-none">
                    {m.badge}
                  </span>
                )}
              </button>
            ))}
            <div className="ml-auto flex items-center gap-1">
              {(['featured', 'newest', 'popular'] as SortMode[]).map((s) => (
                <button
                  key={s}
                  type="button"
                  onClick={() => setSortBy(s)}
                  className={`rounded-full px-3 py-1.5 text-xs font-semibold capitalize transition ${
                    sortBy === s
                      ? 'bg-slate-900 text-white'
                      : 'text-slate-500 hover:text-slate-700'
                  }`}
                >
                  {s}
                </button>
              ))}
            </div>
          </div>

          {/* Gallery + inline generate panel */}
          <div className="flex gap-4 items-start">
            {/* Masonry gallery */}
            <div className="flex-1 min-w-0">
              {loadingTemplates ? (
                <div className="flex items-center gap-2 text-sm text-slate-500 py-8">
                  <Loader2 size={16} className="animate-spin" /> Loading templates…
                </div>
              ) : filteredTemplates.length === 0 ? (
                <div className="rounded-2xl border-2 border-dashed border-slate-200 flex flex-col items-center justify-center py-16 gap-3">
                  <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-slate-100">
                    <LayoutTemplate size={24} className="text-slate-400" />
                  </div>
                  <p className="font-bold text-slate-700">No templates yet</p>
                  <p className="text-sm text-slate-400">Admin-published templates will appear here.</p>
                </div>
              ) : (
                <div className={`gap-4 ${generateTpl ? 'columns-2 sm:columns-2 lg:columns-3' : 'columns-2 sm:columns-3 lg:columns-4 xl:columns-5'}`}>
                  {filteredTemplates.map((tpl) => (
                    <div key={tpl.id} className="break-inside-avoid mb-4">
                      <DiscoverCard
                        tpl={tpl}
                        onPreview={() => setPreviewTpl(tpl)}
                        onUseIdea={(e) => {
                          e.stopPropagation();
                          setGenerateTpl(tpl);
                          setGenerateMode('prompt');
                        }}
                      />
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* Inline generate panel */}
            {generateTpl && (
              <div className="w-80 shrink-0 sticky top-4">
                <GeneratePanel
                  tpl={generateTpl}
                  useMode={generateMode}
                  onClose={() => setGenerateTpl(null)}
                  onGenerated={() => { fetchDesigns(); }}
                />
              </div>
            )}
          </div>
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
        <ImagePreviewModal
          tpl={previewTpl}
          onClose={() => setPreviewTpl(null)}
          onUseAsPrompt={() => {
            setGenerateTpl(previewTpl);
            setGenerateMode('prompt');
            setPreviewTpl(null);
            setTab('discover');
          }}
          onUseAsRef={() => {
            setGenerateTpl(previewTpl);
            setGenerateMode('ref');
            setPreviewTpl(null);
            setTab('discover');
          }}
        />
      )}
    </div>
  );
};

export default Cards;
