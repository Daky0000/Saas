import { useState, useRef, useCallback, useEffect } from 'react';
import { Pipette, Plus } from 'lucide-react';

// ── Color math ─────────────────────────────────────────────────────────────────
function hsvToRgb(h: number, s: number, v: number): [number, number, number] {
  const f = (n: number) => {
    const k = (n + h / 60) % 6;
    return v - v * s * Math.max(0, Math.min(k, 4 - k, 1));
  };
  return [Math.round(f(5) * 255), Math.round(f(3) * 255), Math.round(f(1) * 255)];
}

function rgbToHsv(r: number, g: number, b: number): [number, number, number] {
  const rr = r / 255, gg = g / 255, bb = b / 255;
  const max = Math.max(rr, gg, bb), min = Math.min(rr, gg, bb), d = max - min;
  let h = 0;
  if (d !== 0) {
    if (max === rr) h = ((gg - bb) / d) % 6;
    else if (max === gg) h = (bb - rr) / d + 2;
    else h = (rr - gg) / d + 4;
    h = Math.round(h * 60);
    if (h < 0) h += 360;
  }
  return [h, max === 0 ? 0 : d / max, max];
}

export function hexToRgb(hex: string): [number, number, number] | null {
  const clean = hex.replace('#', '');
  if (clean.length !== 6) return null;
  const r = parseInt(clean.slice(0, 2), 16);
  const g = parseInt(clean.slice(2, 4), 16);
  const b = parseInt(clean.slice(4, 6), 16);
  if (isNaN(r) || isNaN(g) || isNaN(b)) return null;
  return [r, g, b];
}

export function rgbToHex(r: number, g: number, b: number): string {
  return '#' + [r, g, b].map((v) => Math.max(0, Math.min(255, v)).toString(16).padStart(2, '0')).join('');
}

// ── Defaults ──────────────────────────────────────────────────────────────────
const SAVED_DEFAULTS = [
  '#6b7280', '#3b82f6', '#22c55e', '#f97316',
  '#ef4444', '#eab308', '#14b8a6', '#8b5cf6',
];

// ── Props ─────────────────────────────────────────────────────────────────────
export interface ColorPickerProps {
  value: string;
  onChange: (hex: string) => void;
  alpha?: number;
  onAlphaChange?: (a: number) => void;
}

// ── Component ─────────────────────────────────────────────────────────────────
export default function ColorPicker({ value, onChange, alpha = 1, onAlphaChange }: ColorPickerProps) {
  const parsed = hexToRgb(value) ?? [0, 0, 0];
  const [hsvH, hsvS, hsvV] = rgbToHsv(...parsed);

  const [hue, setHue] = useState(hsvH);
  const [sat, setSat] = useState(hsvS);
  const [bri, setBri] = useState(hsvV);
  const [alphaVal, setAlphaVal] = useState(alpha);
  const [format, setFormat] = useState<'RGB' | 'HEX'>('RGB');
  const [hexInput, setHexInput] = useState(value.replace('#', ''));
  const [savedColors, setSavedColors] = useState<string[]>(SAVED_DEFAULTS);

  const gradRef = useRef<HTMLDivElement>(null);
  const hueRef = useRef<HTMLDivElement>(null);
  const alphaRef = useRef<HTMLDivElement>(null);

  // Sync when value changes externally
  useEffect(() => {
    const rgb = hexToRgb(value);
    if (rgb) {
      const [h, s, v] = rgbToHsv(...rgb);
      setHue(h); setSat(s); setBri(v);
      setHexInput(value.replace('#', ''));
    }
  }, [value]);

  useEffect(() => { setAlphaVal(alpha); }, [alpha]);

  const emit = useCallback((h: number, s: number, v: number) => {
    onChange(rgbToHex(...hsvToRgb(h, s, v)));
  }, [onChange]);

  // Generic pointer drag helper
  const useDrag = (fn: (e: PointerEvent) => void) => (e: React.PointerEvent) => {
    e.preventDefault();
    fn(e as unknown as PointerEvent);
    const move = (ev: PointerEvent) => fn(ev);
    const up = () => { window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', up); };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  };

  const handleGrad = useDrag((e) => {
    const el = gradRef.current; if (!el) return;
    const r = el.getBoundingClientRect();
    const s = Math.max(0, Math.min(1, (e.clientX - r.left) / r.width));
    const v = Math.max(0, Math.min(1, 1 - (e.clientY - r.top) / r.height));
    setSat(s); setBri(v); emit(hue, s, v);
  });

  const handleHue = useDrag((e) => {
    const el = hueRef.current; if (!el) return;
    const r = el.getBoundingClientRect();
    const h = Math.max(0, Math.min(360, ((e.clientX - r.left) / r.width) * 360));
    setHue(h); emit(h, sat, bri);
  });

  const handleAlpha = useDrag((e) => {
    const el = alphaRef.current; if (!el) return;
    const r = el.getBoundingClientRect();
    const a = Math.max(0, Math.min(1, (e.clientX - r.left) / r.width));
    setAlphaVal(a); onAlphaChange?.(a);
  });

  const [r, g, b] = hsvToRgb(hue, sat, bri);
  const currentHex = rgbToHex(r, g, b);
  const pureHue = rgbToHex(...hsvToRgb(hue, 1, 1));

  const tryEyedropper = async () => {
    if (!('EyeDropper' in window)) return;
    try {
      // @ts-ignore
      const ed = new window.EyeDropper();
      const { sRGBHex } = await ed.open();
      const rgb2 = hexToRgb(sRGBHex);
      if (rgb2) { const [h, s, v] = rgbToHsv(...rgb2); setHue(h); setSat(s); setBri(v); onChange(sRGBHex); }
    } catch { /* cancelled */ }
  };

  return (
    <div className="w-[272px] rounded-2xl border border-zinc-200 bg-white p-4 shadow-2xl select-none" style={{ fontFamily: 'Inter, system-ui, sans-serif' }}>

      {/* Gradient square */}
      <div
        ref={gradRef}
        onPointerDown={handleGrad}
        className="relative mb-3 h-[180px] w-full cursor-crosshair overflow-hidden rounded-xl"
        style={{ background: pureHue }}
      >
        <div className="absolute inset-0" style={{ background: 'linear-gradient(to right, #fff, transparent)' }} />
        <div className="absolute inset-0" style={{ background: 'linear-gradient(to bottom, transparent, #000)' }} />
        {/* Handle */}
        <div
          className="pointer-events-none absolute h-[14px] w-[14px] -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-white shadow-md"
          style={{ left: `${sat * 100}%`, top: `${(1 - bri) * 100}%`, background: currentHex }}
        />
      </div>

      {/* Sliders */}
      <div className="mb-3 flex items-center gap-2">
        <button
          type="button"
          onClick={() => void tryEyedropper()}
          title="Eyedropper"
          className="flex h-8 w-8 shrink-0 items-center justify-center rounded-xl border border-zinc-200 text-zinc-500 transition hover:bg-zinc-50"
        >
          <Pipette size={14} />
        </button>

        <div className="flex flex-1 flex-col gap-2">
          {/* Hue */}
          <div
            ref={hueRef}
            onPointerDown={handleHue}
            className="relative h-3 w-full cursor-pointer rounded-full"
            style={{ background: 'linear-gradient(to right,#f00,#ff0,#0f0,#0ff,#00f,#f0f,#f00)' }}
          >
            <div
              className="pointer-events-none absolute top-1/2 h-[18px] w-[18px] -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-white shadow-md"
              style={{ left: `${(hue / 360) * 100}%`, background: pureHue }}
            />
          </div>
          {/* Alpha */}
          <div
            ref={alphaRef}
            onPointerDown={handleAlpha}
            className="relative h-3 w-full cursor-pointer overflow-hidden rounded-full"
          >
            <div className="absolute inset-0" style={{ backgroundImage: 'linear-gradient(45deg,#ccc 25%,transparent 25%),linear-gradient(-45deg,#ccc 25%,transparent 25%),linear-gradient(45deg,transparent 75%,#ccc 75%),linear-gradient(-45deg,transparent 75%,#ccc 75%)', backgroundSize: '8px 8px', backgroundPosition: '0 0,0 4px,4px -4px,-4px 0' }} />
            <div className="absolute inset-0 rounded-full" style={{ background: `linear-gradient(to right,transparent,${currentHex})` }} />
            <div
              className="pointer-events-none absolute top-1/2 h-[18px] w-[18px] -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-white shadow-md"
              style={{ left: `${alphaVal * 100}%`, background: currentHex }}
            />
          </div>
        </div>
      </div>

      {/* Format + inputs */}
      <div className="mb-3 flex items-center gap-2">
        <button
          type="button"
          onClick={() => setFormat((f) => (f === 'RGB' ? 'HEX' : 'RGB'))}
          className="flex shrink-0 items-center gap-1 rounded-lg border border-zinc-200 px-2.5 py-1.5 text-xs font-semibold text-zinc-600 transition hover:bg-zinc-50"
        >
          {format} <span className="text-zinc-400">▾</span>
        </button>

        {format === 'RGB' ? (
          <div className="grid flex-1 grid-cols-4 gap-1">
            {([['R', r, 0], ['G', g, 1], ['B', b, 2]] as [string, number, number][]).map(([lbl, val, idx]) => (
              <div key={lbl} className="flex flex-col items-center">
                <input
                  type="number" min={0} max={255} value={val}
                  onChange={(e) => {
                    const n = Math.max(0, Math.min(255, parseInt(e.target.value) || 0));
                    const nr = idx === 0 ? n : r, ng = idx === 1 ? n : g, nb = idx === 2 ? n : b;
                    const [h, s, v] = rgbToHsv(nr, ng, nb);
                    setHue(h); setSat(s); setBri(v); onChange(rgbToHex(nr, ng, nb));
                  }}
                  className="w-full rounded border border-zinc-200 py-1 text-center text-xs text-zinc-800 focus:outline-none focus:ring-1 focus:ring-slate-300"
                />
                <span className="mt-0.5 text-[9px] text-zinc-400">{lbl}</span>
              </div>
            ))}
            <div className="flex flex-col items-center">
              <input
                type="number" min={0} max={100} value={Math.round(alphaVal * 100)}
                onChange={(e) => { const a = Math.max(0, Math.min(100, parseInt(e.target.value) || 0)) / 100; setAlphaVal(a); onAlphaChange?.(a); }}
                className="w-full rounded border border-zinc-200 py-1 text-center text-xs text-zinc-800 focus:outline-none focus:ring-1 focus:ring-slate-300"
              />
              <span className="mt-0.5 text-[9px] text-zinc-400">A%</span>
            </div>
          </div>
        ) : (
          <div className="flex flex-1 items-center gap-1">
            <span className="text-sm text-zinc-400">#</span>
            <input
              type="text" maxLength={6} value={hexInput}
              onChange={(e) => {
                setHexInput(e.target.value);
                const rgb2 = hexToRgb('#' + e.target.value);
                if (rgb2) { const [h, s, v] = rgbToHsv(...rgb2); setHue(h); setSat(s); setBri(v); onChange('#' + e.target.value); }
              }}
              className="flex-1 rounded-lg border border-zinc-200 px-2.5 py-1.5 text-sm uppercase text-zinc-800 focus:outline-none focus:ring-2 focus:ring-slate-300"
            />
          </div>
        )}
      </div>

      {/* Saved colors */}
      <div>
        <div className="mb-2 flex items-center justify-between">
          <span className="text-xs font-semibold text-zinc-600">Saved Colors</span>
          <button
            type="button"
            onClick={() => { if (!savedColors.includes(currentHex)) setSavedColors((p) => [currentHex, ...p].slice(0, 16)); }}
            className="flex h-5 w-5 items-center justify-center rounded text-zinc-400 transition hover:bg-zinc-100 hover:text-zinc-600"
          >
            <Plus size={12} />
          </button>
        </div>
        <div className="flex flex-wrap gap-1.5">
          {savedColors.map((c) => (
            <button
              key={c}
              type="button"
              onClick={() => { const rgb2 = hexToRgb(c); if (rgb2) { const [h, s, v] = rgbToHsv(...rgb2); setHue(h); setSat(s); setBri(v); onChange(c); } }}
              className="h-6 w-6 rounded-full border-2 transition hover:scale-110"
              style={{ background: c, borderColor: c === currentHex ? '#1e293b' : 'transparent', outline: c === currentHex ? '1px solid #1e293b' : 'none' }}
            />
          ))}
        </div>
      </div>
    </div>
  );
}
