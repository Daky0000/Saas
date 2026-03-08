import { useState, useEffect, useRef, useCallback } from 'react';
import { fabric } from 'fabric';
import {
  AlignLeft, AlignCenter, AlignRight, AlignJustify,
  Trash2, Copy, ArrowUp, ArrowDown, Eye, EyeOff,
  ChevronDown, ChevronUp, ImagePlus, Layers, X,
} from 'lucide-react';
import ColorPicker from './ColorPicker';

// ── Types ─────────────────────────────────────────────────────────────────────
interface PropsPanelProps {
  canvas: fabric.Canvas | null;
  selectedObjects: fabric.Object[];
  onDelete: () => void;
  onDuplicate: () => void;
  onBringForward: () => void;
  onSendBackward: () => void;
  onFlipH: () => void;
  onFlipV: () => void;
  onSetBgSolid: (color: string) => void;
  onSetBgGradient: (from: string, to: string, angle: number) => void;
  onSetBgImage: (url: string) => void;
  bgColor?: string;
  artboardW?: number;
  artboardH?: number;
}

const FONTS = [
  'Inter', 'Arial', 'Helvetica', 'Georgia', 'Times New Roman',
  'Verdana', 'Trebuchet MS', 'Impact', 'Courier New',
];

const FONT_WEIGHTS: { value: string; label: string }[] = [
  { value: '100', label: '100 – Thin' },
  { value: '200', label: '200 – ExtraLight' },
  { value: '300', label: '300 – Light' },
  { value: '400', label: '400 – Normal' },
  { value: '500', label: '500 – Medium' },
  { value: '600', label: '600 – SemiBold' },
  { value: '700', label: '700 – Bold' },
  { value: '800', label: '800 – ExtraBold' },
  { value: '900', label: '900 – Black' },
];

// ── Helpers ───────────────────────────────────────────────────────────────────
function clamp(n: number, min: number, max: number) { return Math.max(min, Math.min(max, n)); }

// ── Color swatch + picker popover — smart positioning ────────────────────────
function ColorSwatch({ value, onChange, label }: { value: string; onChange: (v: string) => void; label?: string }) {
  const [open, setOpen] = useState(false);
  const [openUp, setOpenUp] = useState(false);
  const [openLeft, setOpenLeft] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [open]);

  const handleToggle = () => {
    if (!open && ref.current) {
      const rect = ref.current.getBoundingClientRect();
      const pw = 244, ph = 380;
      setOpenLeft(rect.left + pw > window.innerWidth - 8);
      setOpenUp(rect.bottom + ph > window.innerHeight - 8);
    }
    setOpen((o) => !o);
  };

  const displayColor = value?.startsWith('rgba') ? value : (value || '#000000');

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={handleToggle}
        className="flex w-full items-center gap-2 rounded-lg border border-zinc-200 px-2.5 py-1.5 text-xs font-medium text-zinc-700 transition hover:bg-zinc-50"
      >
        <span
          className="h-4 w-4 shrink-0 rounded-full border border-zinc-300"
          style={{ background: displayColor }}
        />
        <span className="flex-1 truncate text-left">{label || value}</span>
      </button>
      {open && (
        <div
          className={`absolute z-[9999] ${openUp ? 'bottom-full mb-1.5' : 'top-full mt-1.5'} ${openLeft ? 'right-0' : 'left-0'}`}
        >
          <ColorPicker value={value || '#000000'} onChange={onChange} />
        </div>
      )}
    </div>
  );
}

// ── Number input ──────────────────────────────────────────────────────────────
function Num({ value, onChange, min, max, step = 1, unit }: {
  value: number; onChange: (v: number) => void; min?: number; max?: number; step?: number; unit?: string;
}) {
  return (
    <div className="relative flex items-center">
      <input
        type="number"
        value={isNaN(value) ? '' : Math.round(value * 100) / 100}
        min={min} max={max} step={step}
        onChange={(e) => { const v = parseFloat(e.target.value); if (!isNaN(v)) onChange(clamp(v, min ?? -Infinity, max ?? Infinity)); }}
        className="w-full rounded-lg border border-zinc-200 bg-white py-1.5 pl-2.5 pr-8 text-xs text-zinc-800 focus:outline-none focus:ring-2 focus:ring-slate-300"
      />
      {unit && <span className="pointer-events-none absolute right-2 text-[10px] text-zinc-400">{unit}</span>}
    </div>
  );
}

// ── Toggle button ─────────────────────────────────────────────────────────────
function Tog({ active, onClick, children, title }: { active?: boolean; onClick: () => void; children: React.ReactNode; title?: string }) {
  return (
    <button
      type="button" title={title} onClick={onClick}
      className={`flex h-8 items-center justify-center rounded-lg border px-2.5 text-sm transition ${
        active ? 'border-zinc-900 bg-zinc-900 text-white' : 'border-zinc-200 text-zinc-600 hover:bg-zinc-50'
      }`}
    >
      {children}
    </button>
  );
}

// ── Section header ────────────────────────────────────────────────────────────
function SectionHead({ label }: { label: string }) {
  return <p className="text-[10px] font-bold uppercase tracking-widest text-zinc-400">{label}</p>;
}

// ── Artboard background panel ─────────────────────────────────────────────────
function ArtboardPanel({ bgColor, onSetBgSolid, onSetBgGradient, onSetBgImage }: {
  bgColor: string;
  onSetBgSolid: (c: string) => void;
  onSetBgGradient: (from: string, to: string, angle: number) => void;
  onSetBgImage: (url: string) => void;
}) {
  const [tab, setTab] = useState<'solid' | 'gradient' | 'image'>('solid');
  const [gradFrom, setGradFrom] = useState('#e6332a');
  const [gradTo, setGradTo] = useState('#1e293b');
  const [gradAngle, setGradAngle] = useState(90);
  const [bgImagePreview, setBgImagePreview] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleFileChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => {
      const url = ev.target?.result as string;
      setBgImagePreview(url);
      onSetBgImage(url);
    };
    reader.readAsDataURL(file);
    e.target.value = '';
  }, [onSetBgImage]);

  const clearBgImage = useCallback(() => {
    setBgImagePreview(null);
    onSetBgImage('');
  }, [onSetBgImage]);

  return (
    <div className="flex flex-col gap-4 p-4">
      <SectionHead label="Artboard Background" />
      <div className="flex rounded-xl border border-zinc-200 bg-zinc-50 p-0.5">
        {(['solid', 'gradient', 'image'] as const).map((t) => (
          <button key={t} type="button" onClick={() => setTab(t)}
            className={`flex-1 rounded-lg py-1.5 text-[11px] font-semibold capitalize transition ${
              tab === t ? 'bg-white text-zinc-900 shadow-sm' : 'text-zinc-500 hover:text-zinc-700'
            }`}>
            {t}
          </button>
        ))}
      </div>

      {tab === 'solid' && (
        <div>
          <p className="mb-2 text-[10px] text-zinc-400">Background Color</p>
          <ColorSwatch value={bgColor} onChange={onSetBgSolid} label="Pick color" />
        </div>
      )}

      {tab === 'gradient' && (
        <div className="flex flex-col gap-3">
          <div>
            <p className="mb-1.5 text-[10px] text-zinc-400">From</p>
            <ColorSwatch value={gradFrom} onChange={(c) => { setGradFrom(c); onSetBgGradient(c, gradTo, gradAngle); }} />
          </div>
          <div>
            <p className="mb-1.5 text-[10px] text-zinc-400">To</p>
            <ColorSwatch value={gradTo} onChange={(c) => { setGradTo(c); onSetBgGradient(gradFrom, c, gradAngle); }} />
          </div>
          <div>
            <p className="mb-1.5 text-[10px] text-zinc-400">Angle (°)</p>
            <Num value={gradAngle} onChange={(v) => { setGradAngle(v); onSetBgGradient(gradFrom, gradTo, v); }} min={0} max={360} unit="°" />
          </div>
        </div>
      )}

      {tab === 'image' && (
        <div>
          <input ref={fileInputRef} type="file" accept="image/*" className="hidden" onChange={handleFileChange} />
          {bgImagePreview ? (
            <div className="relative overflow-hidden rounded-2xl border border-zinc-200">
              <img src={bgImagePreview} alt="Background" className="h-32 w-full object-cover" />
              <div className="absolute inset-0 flex items-end justify-between bg-gradient-to-t from-black/50 to-transparent p-3">
                <span className="text-[11px] font-semibold text-white/80">Background image</span>
                <div className="flex gap-1.5">
                  <button type="button" onClick={() => fileInputRef.current?.click()}
                    className="rounded-lg bg-white/20 px-2.5 py-1 text-[11px] font-semibold text-white backdrop-blur-sm transition hover:bg-white/30">
                    Change
                  </button>
                  <button type="button" onClick={clearBgImage} title="Remove"
                    className="flex h-6 w-6 items-center justify-center rounded-lg bg-white/20 text-white backdrop-blur-sm transition hover:bg-red-500/70">
                    <X size={11} />
                  </button>
                </div>
              </div>
            </div>
          ) : (
            <button type="button" onClick={() => fileInputRef.current?.click()}
              className="flex w-full flex-col items-center justify-center gap-2 rounded-2xl border-2 border-dashed border-zinc-200 py-8 transition hover:border-zinc-300 hover:bg-zinc-50">
              <ImagePlus size={20} className="text-zinc-400" />
              <span className="text-xs font-semibold text-zinc-500">Upload background image</span>
              <span className="text-[10px] text-zinc-300">PNG, JPG, WEBP</span>
            </button>
          )}
        </div>
      )}
    </div>
  );
}

// ── Main component ─────────────────────────────────────────────────────────────
export default function PropertiesPanel({
  canvas, selectedObjects, onDelete, onDuplicate, onBringForward, onSendBackward,
  onFlipH, onFlipV, onSetBgSolid, onSetBgGradient, onSetBgImage,
  bgColor = '#ffffff', artboardW = 1080, artboardH = 1080,
}: PropsPanelProps) {
  const [, refresh] = useState(0);
  const [typoExpanded, setTypoExpanded] = useState(false);
  const [strokeExpanded, setStrokeExpanded] = useState(false);

  useEffect(() => {
    if (!canvas) return;
    const h = () => refresh((n) => n + 1);
    const evts = ['object:modified', 'object:scaling', 'object:moving', 'object:rotating'] as const;
    evts.forEach((ev) => canvas.on(ev, h));
    return () => evts.forEach((ev) => canvas.off(ev, h));
  }, [canvas]);

  // ── Empty / artboard state ────────────────────────────────────────────────
  if (!canvas || selectedObjects.length === 0) {
    return (
      <div className="h-full overflow-y-auto">
        <ArtboardPanel bgColor={bgColor} onSetBgSolid={onSetBgSolid} onSetBgGradient={onSetBgGradient} onSetBgImage={onSetBgImage} />
        <div className="flex flex-col items-center justify-center px-6 py-8 text-center">
          <Layers size={26} className="mb-3 text-zinc-200" />
          <p className="text-sm text-zinc-400">Select an element to edit properties</p>
        </div>
      </div>
    );
  }

  const obj = selectedObjects[0];
  const isText = obj instanceof fabric.IText || obj instanceof fabric.Text;
  const isImage = obj instanceof fabric.Image;
  const isShape = !isText && !isImage && (obj instanceof fabric.Rect || obj instanceof fabric.Circle || obj instanceof fabric.Line || obj instanceof fabric.Ellipse);
  const zoom = canvas.getZoom();

  const set = (key: string, value: unknown) => {
    selectedObjects.forEach((o) => (o as fabric.Object & Record<string, unknown>).set(key, value));
    canvas.requestRenderAll();
    refresh((n) => n + 1);
  };

  const setPos = (axis: 'left' | 'top', value: number) => {
    obj.set(axis, value / zoom); canvas.requestRenderAll(); refresh((n) => n + 1);
  };
  const setSize = (dim: 'scaleX' | 'scaleY', px: number) => {
    const orig = dim === 'scaleX' ? (obj.width ?? 1) : (obj.height ?? 1);
    obj.set(dim, px / orig); canvas.requestRenderAll(); refresh((n) => n + 1);
  };

  // Canvas logical dimensions (unscaled)
  const cw = (canvas.width ?? artboardW) / zoom;
  const ch = (canvas.height ?? artboardH) / zoom;

  // Image fit to artboard
  const applyFit = (fit: 'auto' | 'fill' | 'cover' | 'contain') => {
    if (!isImage) return;
    const img = obj as fabric.Image;
    const iw = img.width ?? 1;
    const ih = img.height ?? 1;
    if (fit === 'auto') {
      img.set({ scaleX: 1, scaleY: 1 });
    } else if (fit === 'fill') {
      img.set({ scaleX: cw / iw, scaleY: ch / ih, left: 0, top: 0 });
    } else if (fit === 'cover') {
      const scale = Math.max(cw / iw, ch / ih);
      img.set({ scaleX: scale, scaleY: scale, left: (cw - iw * scale) / 2, top: (ch - ih * scale) / 2 });
    } else if (fit === 'contain') {
      const scale = Math.min(cw / iw, ch / ih);
      img.set({ scaleX: scale, scaleY: scale, left: (cw - iw * scale) / 2, top: (ch - ih * scale) / 2 });
    }
    canvas.requestRenderAll();
    refresh((n) => n + 1);
  };

  // Image position alignment
  const alignImage = (hAlign: 'left' | 'center' | 'right' | null, vAlign: 'top' | 'center' | 'bottom' | null) => {
    if (!isImage) return;
    const img = obj as fabric.Image;
    const sw = img.getScaledWidth();
    const sh = img.getScaledHeight();
    if (hAlign === 'left') img.set('left', 0);
    else if (hAlign === 'center') img.set('left', (cw - sw) / 2);
    else if (hAlign === 'right') img.set('left', cw - sw);
    if (vAlign === 'top') img.set('top', 0);
    else if (vAlign === 'center') img.set('top', (ch - sh) / 2);
    else if (vAlign === 'bottom') img.set('top', ch - sh);
    canvas.requestRenderAll();
    refresh((n) => n + 1);
  };

  const displayLeft = Math.round((obj.left ?? 0) * zoom);
  const displayTop = Math.round((obj.top ?? 0) * zoom);
  const displayW = Math.round((obj.getScaledWidth?.() ?? obj.width ?? 0) * zoom);
  const displayH = Math.round((obj.getScaledHeight?.() ?? obj.height ?? 0) * zoom);
  const txt = obj as fabric.IText;

  return (
    <div className="h-full overflow-y-auto">
      <div className="flex flex-col gap-5 p-4">

        {/* ── Actions ── */}
        <div className="flex flex-wrap gap-1.5">
          <button type="button" onClick={onDuplicate} title="Duplicate"
            className="flex items-center gap-1.5 rounded-lg border border-zinc-200 px-2.5 py-1.5 text-xs font-medium text-zinc-600 transition hover:bg-zinc-50">
            <Copy size={12} /> Copy
          </button>
          <button type="button" onClick={() => { obj.set('visible', !obj.visible); canvas.requestRenderAll(); refresh((n) => n + 1); }}
            title={obj.visible ? 'Hide' : 'Show'}
            className="flex items-center gap-1.5 rounded-lg border border-zinc-200 px-2.5 py-1.5 text-xs font-medium text-zinc-600 transition hover:bg-zinc-50">
            {obj.visible !== false ? <Eye size={12} /> : <EyeOff size={12} />}
          </button>
          <button type="button" onClick={onBringForward} title="Bring Forward"
            className="flex items-center gap-1.5 rounded-lg border border-zinc-200 px-2.5 py-1.5 text-xs font-medium text-zinc-600 transition hover:bg-zinc-50">
            <ArrowUp size={12} />
          </button>
          <button type="button" onClick={onSendBackward} title="Send Backward"
            className="flex items-center gap-1.5 rounded-lg border border-zinc-200 px-2.5 py-1.5 text-xs font-medium text-zinc-600 transition hover:bg-zinc-50">
            <ArrowDown size={12} />
          </button>
          <button type="button" onClick={onDelete} title="Delete"
            className="ml-auto flex items-center gap-1.5 rounded-lg border border-red-200 px-2.5 py-1.5 text-xs font-medium text-red-500 transition hover:bg-red-50">
            <Trash2 size={12} />
          </button>
        </div>

        {/* ── Position & Size ── */}
        <div>
          <SectionHead label="Position & Size" />
          <div className="mt-2 grid grid-cols-2 gap-2">
            <div><p className="mb-1 text-[10px] text-zinc-400">X</p><Num value={displayLeft} onChange={(v) => setPos('left', v)} /></div>
            <div><p className="mb-1 text-[10px] text-zinc-400">Y</p><Num value={displayTop} onChange={(v) => setPos('top', v)} /></div>
            <div><p className="mb-1 text-[10px] text-zinc-400">W</p><Num value={displayW} onChange={(v) => setSize('scaleX', v)} min={1} /></div>
            <div><p className="mb-1 text-[10px] text-zinc-400">H</p><Num value={displayH} onChange={(v) => setSize('scaleY', v)} min={1} /></div>
          </div>
          <div className="mt-2">
            <p className="mb-1 text-[10px] text-zinc-400">Rotation</p>
            <Num value={obj.angle ?? 0} onChange={(v) => set('angle', v)} min={0} max={360} unit="°" />
          </div>
        </div>

        {/* ── Opacity ── */}
        <div>
          <div className="mb-2 flex items-center justify-between">
            <SectionHead label="Opacity" />
            <span className="text-xs font-semibold text-zinc-500">{Math.round((obj.opacity ?? 1) * 100)}%</span>
          </div>
          <input type="range" min={0} max={1} step={0.01} value={obj.opacity ?? 1}
            onChange={(e) => set('opacity', parseFloat(e.target.value))}
            className="w-full accent-slate-900" />
        </div>

        {/* ── Typography ── */}
        {isText && (
          <div className="rounded-xl border border-zinc-200 bg-zinc-50/50 p-3">
            <button type="button" onClick={() => setTypoExpanded((e) => !e)}
              className="flex w-full items-center justify-between">
              <span className="text-xs font-bold text-zinc-700">Typography</span>
              {typoExpanded ? <ChevronUp size={14} className="text-zinc-400" /> : <ChevronDown size={14} className="text-zinc-400" />}
            </button>

            <div className="mt-3 flex flex-col gap-2.5">
              {/* Font family */}
              <div>
                <p className="mb-1 flex items-center gap-1 text-[10px] text-zinc-500">
                  <span className="inline-block h-1.5 w-1.5 rounded-full bg-zinc-400" /> Font family
                </p>
                <select value={txt.fontFamily ?? 'Inter'} onChange={(e) => set('fontFamily', e.target.value)}
                  className="w-full rounded-lg border border-zinc-200 bg-white px-2.5 py-1.5 text-xs text-zinc-800 focus:outline-none focus:ring-2 focus:ring-slate-300">
                  {FONTS.map((f) => <option key={f} value={f}>{f}</option>)}
                </select>
              </div>

              {/* Font weight */}
              <div>
                <p className="mb-1 flex items-center gap-1 text-[10px] text-zinc-500">
                  <span className="inline-block h-1.5 w-1.5 rounded-full bg-zinc-400" /> Font weight
                </p>
                <select value={txt.fontWeight?.toString() ?? '400'} onChange={(e) => set('fontWeight', e.target.value)}
                  className="w-full rounded-lg border border-zinc-200 bg-white px-2.5 py-1.5 text-xs text-zinc-800 focus:outline-none focus:ring-2 focus:ring-slate-300">
                  {FONT_WEIGHTS.map((w) => <option key={w.value} value={w.value}>{w.label}</option>)}
                </select>
              </div>

              {/* Font size */}
              <div>
                <p className="mb-1 flex items-center gap-1 text-[10px] text-zinc-500">
                  <span className="inline-block h-1.5 w-1.5 rounded-full bg-zinc-400" /> Font size
                </p>
                <Num value={txt.fontSize ?? 24} onChange={(v) => set('fontSize', v)} min={6} max={400} unit="PX" />
              </div>

              {/* Text align */}
              <div>
                <p className="mb-1 flex items-center gap-1 text-[10px] text-zinc-500">
                  <span className="inline-block h-1.5 w-1.5 rounded-full bg-zinc-400" /> Text align
                </p>
                <div className="flex gap-1">
                  {[
                    { align: 'left', icon: <AlignLeft size={13} /> },
                    { align: 'center', icon: <AlignCenter size={13} /> },
                    { align: 'right', icon: <AlignRight size={13} /> },
                    { align: 'justify', icon: <AlignJustify size={13} /> },
                  ].map(({ align, icon }) => (
                    <Tog key={align} active={txt.textAlign === align} onClick={() => set('textAlign', align)}>{icon}</Tog>
                  ))}
                </div>
              </div>

              {/* Text color */}
              <div>
                <p className="mb-1 flex items-center gap-1 text-[10px] text-zinc-500">
                  <span className="inline-block h-1.5 w-1.5 rounded-full bg-zinc-400" /> Text color
                </p>
                <ColorSwatch
                  value={(txt.fill as string) ?? '#000000'}
                  onChange={(v) => set('fill', v)}
                  label={(txt.fill as string)?.slice(0, 14) ?? '#000000'}
                />
              </div>

              {/* Show more / less toggle */}
              <button type="button" onClick={() => setTypoExpanded((e) => !e)}
                className="flex items-center justify-center gap-1 rounded-lg border border-zinc-200 py-1.5 text-[11px] font-semibold text-zinc-500 transition hover:bg-zinc-50">
                {typoExpanded ? <><ChevronUp size={12} /> Show less</> : <><ChevronDown size={12} /> Show more</>}
              </button>

              {/* Expanded */}
              {typoExpanded && (
                <div className="flex flex-col gap-2.5 border-t border-zinc-200 pt-2.5">
                  <div>
                    <p className="mb-1 text-[10px] text-zinc-500">Line height</p>
                    <Num value={txt.lineHeight ?? 1.2} onChange={(v) => set('lineHeight', v)} min={0.5} max={5} step={0.05} unit="PX" />
                  </div>
                  <div>
                    <p className="mb-1 text-[10px] text-zinc-500">Letter spacing</p>
                    <Num value={txt.charSpacing ?? 0} onChange={(v) => set('charSpacing', v)} min={-200} max={800} unit="PX" />
                  </div>
                  <div>
                    <p className="mb-1 text-[10px] text-zinc-500">Word spacing</p>
                    <Num value={0} onChange={() => {}} unit="PX" />
                  </div>

                  {/* Line decoration */}
                  <div>
                    <p className="mb-1 text-[10px] text-zinc-500">Line decoration</p>
                    <div className="flex gap-1">
                      <Tog active={!txt.underline && !txt.overline && !txt.linethrough}
                        onClick={() => { set('underline', false); set('overline', false); set('linethrough', false); }} title="None">
                        <span className="text-[11px] font-bold">—</span>
                      </Tog>
                      <Tog active={!!txt.underline} onClick={() => set('underline', !txt.underline)} title="Underline">
                        <span className="text-[11px] underline font-bold">T</span>
                      </Tog>
                      <Tog active={!!txt.overline} onClick={() => set('overline', !txt.overline)} title="Overline">
                        <span className="text-[11px] overline font-bold">T</span>
                      </Tog>
                      <Tog active={!!txt.linethrough} onClick={() => set('linethrough', !txt.linethrough)} title="Strikethrough">
                        <span className="text-[11px] line-through font-bold">T</span>
                      </Tog>
                    </div>
                  </div>

                  {/* Text transform */}
                  <div>
                    <p className="mb-1 text-[10px] text-zinc-500">Text transform</p>
                    <div className="flex gap-1">
                      {[{ label: '—', title: 'None' }, { label: 'Aa', title: 'Capitalize' }, { label: 'AA', title: 'Uppercase' }, { label: 'aa', title: 'Lowercase' }].map(({ label, title }) => (
                        <Tog key={label} onClick={() => {}} title={title}>
                          <span className="text-[10px] font-bold">{label}</span>
                        </Tog>
                      ))}
                    </div>
                  </div>

                  {/* Font style */}
                  <div>
                    <p className="mb-1 text-[10px] text-zinc-500">Font style</p>
                    <div className="flex gap-1">
                      <Tog active={txt.fontStyle !== 'italic'} onClick={() => set('fontStyle', 'normal')} title="Normal">
                        <span className="text-[11px] font-bold">—</span>
                      </Tog>
                      <Tog active={txt.fontStyle === 'italic'} onClick={() => set('fontStyle', txt.fontStyle === 'italic' ? 'normal' : 'italic')} title="Italic">
                        <span className="text-[11px] italic font-bold">I</span>
                      </Tog>
                    </div>
                  </div>

                  {/* Text stroke */}
                  <div>
                    <button type="button" onClick={() => setStrokeExpanded((e) => !e)}
                      className="flex w-full items-center justify-between text-[10px] text-zinc-500">
                      <span>Text stroke</span>
                      {strokeExpanded ? <ChevronUp size={11} /> : <span className="text-zinc-400">+</span>}
                    </button>
                    {strokeExpanded && (
                      <div className="mt-2 flex flex-col gap-2">
                        <div>
                          <p className="mb-1 text-[10px] text-zinc-400">Stroke color</p>
                          <ColorSwatch value={(txt.stroke as string) ?? '#000000'} onChange={(v) => set('stroke', v)} />
                        </div>
                        <div>
                          <p className="mb-1 text-[10px] text-zinc-400">Stroke width</p>
                          <Num value={txt.strokeWidth ?? 0} onChange={(v) => set('strokeWidth', v)} min={0} max={20} unit="PX" />
                        </div>
                      </div>
                    )}
                  </div>
                </div>
              )}
            </div>
          </div>
        )}

        {/* ── Fill & Stroke (shapes) ── */}
        {isShape && (
          <div>
            <SectionHead label="Fill & Stroke" />
            <div className="mt-2 flex flex-col gap-2.5">
              <div>
                <p className="mb-1 text-[10px] text-zinc-400">Fill color</p>
                <ColorSwatch value={((obj as fabric.Rect).fill as string) ?? '#cccccc'} onChange={(v) => set('fill', v)} />
              </div>
              <div>
                <p className="mb-1 text-[10px] text-zinc-400">Stroke color</p>
                <ColorSwatch value={((obj as fabric.Rect).stroke as string) ?? '#000000'} onChange={(v) => set('stroke', v)} />
              </div>
              <div>
                <p className="mb-1 text-[10px] text-zinc-400">Stroke width</p>
                <Num value={(obj as fabric.Rect).strokeWidth ?? 0} onChange={(v) => set('strokeWidth', v)} min={0} max={50} unit="PX" />
              </div>
              {obj instanceof fabric.Rect && (
                <div>
                  <p className="mb-1 text-[10px] text-zinc-400">Corner radius</p>
                  <Num value={(obj as fabric.Rect).rx ?? 0} onChange={(v) => { set('rx', v); set('ry', v); }} min={0} max={500} unit="PX" />
                </div>
              )}
            </div>
          </div>
        )}

        {/* ── Image ── */}
        {isImage && (
          <div>
            <SectionHead label="Image" />
            <div className="mt-2 flex flex-col gap-3">

              {/* Fit to artboard */}
              <div>
                <p className="mb-1.5 text-[10px] text-zinc-400">Fit to canvas</p>
                <div className="grid grid-cols-4 gap-1">
                  {(['auto', 'fill', 'cover', 'contain'] as const).map((fit) => (
                    <button key={fit} type="button" onClick={() => applyFit(fit)}
                      className="rounded-lg border border-zinc-200 py-1.5 text-[10px] font-semibold capitalize text-zinc-600 transition hover:border-zinc-400 hover:bg-zinc-50">
                      {fit}
                    </button>
                  ))}
                </div>
              </div>

              {/* Position alignment */}
              <div>
                <p className="mb-1.5 text-[10px] text-zinc-400">Align to canvas</p>
                <div className="grid grid-cols-3 gap-1">
                  {[
                    { label: '↖', h: 'left' as const,   v: 'top' as const,    title: 'Top Left' },
                    { label: '↑', h: 'center' as const, v: 'top' as const,    title: 'Top Center' },
                    { label: '↗', h: 'right' as const,  v: 'top' as const,    title: 'Top Right' },
                    { label: '←', h: 'left' as const,   v: 'center' as const, title: 'Middle Left' },
                    { label: '⊙', h: 'center' as const, v: 'center' as const, title: 'Center' },
                    { label: '→', h: 'right' as const,  v: 'center' as const, title: 'Middle Right' },
                    { label: '↙', h: 'left' as const,   v: 'bottom' as const, title: 'Bottom Left' },
                    { label: '↓', h: 'center' as const, v: 'bottom' as const, title: 'Bottom Center' },
                    { label: '↘', h: 'right' as const,  v: 'bottom' as const, title: 'Bottom Right' },
                  ].map(({ label, h, v, title }) => (
                    <button key={title} type="button" title={title} onClick={() => alignImage(h, v)}
                      className="flex h-7 items-center justify-center rounded-lg border border-zinc-200 text-xs text-zinc-500 transition hover:bg-zinc-50 hover:border-zinc-400">
                      {label}
                    </button>
                  ))}
                </div>
              </div>

              {/* Flip */}
              <div className="flex gap-2">
                <button type="button" onClick={onFlipH} className="flex-1 rounded-lg border border-zinc-200 py-2 text-xs font-medium text-zinc-600 transition hover:bg-zinc-50">Flip H</button>
                <button type="button" onClick={onFlipV} className="flex-1 rounded-lg border border-zinc-200 py-2 text-xs font-medium text-zinc-600 transition hover:bg-zinc-50">Flip V</button>
              </div>
            </div>
          </div>
        )}

        {selectedObjects.length > 1 && (
          <p className="text-center text-xs text-zinc-400">{selectedObjects.length} objects selected</p>
        )}
      </div>
    </div>
  );
}
