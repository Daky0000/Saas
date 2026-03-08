import { useRef, useEffect, useState, useCallback, useLayoutEffect } from 'react';
import { fabric } from 'fabric';
import {
  X, Save, Undo2, Redo2, Download, ChevronDown, Loader2,
  MousePointer2, ZoomIn, ZoomOut, Maximize2,
} from 'lucide-react';
import ElementsPanel from './ElementsPanel';
import PropertiesPanel from './PropertiesPanel';
import { CANVAS_PRESETS, CanvasPreset } from './canvasPresets';
import { designService, UserDesign } from '../../../services/designService';

// ─── Keyboard shortcut map ────────────────────────────────────────────────────
const isMac = typeof navigator !== 'undefined' && /Mac/.test(navigator.platform);
const mod = isMac ? '⌘' : 'Ctrl';

// ─── History helpers ──────────────────────────────────────────────────────────
const MAX_HISTORY = 60;

// ─── Props ────────────────────────────────────────────────────────────────────
interface CardBuilderModalProps {
  existingDesign?: UserDesign | null;
  onClose: () => void;
  onSaved?: (design: UserDesign) => void;
}

// ─── Zoom level display ───────────────────────────────────────────────────────
function fmtZoom(z: number) {
  return `${Math.round(z * 100)}%`;
}

// ─── Main component ───────────────────────────────────────────────────────────
export default function CardBuilderModal({
  existingDesign,
  onClose,
  onSaved,
}: CardBuilderModalProps) {
  // ── Canvas DOM ref ──────────────────────────────────────────────────────────
  const canvasElRef = useRef<HTMLCanvasElement>(null);
  const fabricRef = useRef<fabric.Canvas | null>(null);
  const wrapperRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // ── Design metadata ─────────────────────────────────────────────────────────
  const [designId, setDesignId] = useState<string | null>(existingDesign?.id ?? null);
  const [designName, setDesignName] = useState(existingDesign?.name ?? 'Untitled Design');
  const [preset, setPreset] = useState<CanvasPreset>(() => {
    if (existingDesign) {
      return (
        CANVAS_PRESETS.find(
          (p) => p.w === existingDesign.canvas_width && p.h === existingDesign.canvas_height,
        ) ?? { id: 'custom', label: 'Custom', w: existingDesign.canvas_width, h: existingDesign.canvas_height }
      );
    }
    return CANVAS_PRESETS[0];
  });
  const [showPresets, setShowPresets] = useState(false);

  // ── History ─────────────────────────────────────────────────────────────────
  const undoStack = useRef<string[]>([]);
  const redoStack = useRef<string[]>([]);
  const [canUndo, setCanUndo] = useState(false);
  const [canRedo, setCanRedo] = useState(false);

  // ── Selection ───────────────────────────────────────────────────────────────
  const [selectedObjects, setSelectedObjects] = useState<fabric.Object[]>([]);

  // ── UI state ─────────────────────────────────────────────────────────────────
  const [saving, setSaving] = useState(false);
  const [savedPulse, setSavedPulse] = useState(false);
  const [zoomLevel, setZoomLevel] = useState(1);
  const [canvasScale, setCanvasScale] = useState(1);

  // ── Snapshot / history helpers ──────────────────────────────────────────────
  const snapshot = useCallback(() => {
    const c = fabricRef.current;
    if (!c) return;
    const json = JSON.stringify(c.toJSON(['data']));
    if (undoStack.current[undoStack.current.length - 1] === json) return; // no change
    undoStack.current.push(json);
    if (undoStack.current.length > MAX_HISTORY) undoStack.current.shift();
    redoStack.current = [];
    setCanUndo(undoStack.current.length > 1);
    setCanRedo(false);
  }, []);

  const undo = useCallback(() => {
    const c = fabricRef.current;
    if (!c || undoStack.current.length <= 1) return;
    const current = undoStack.current.pop()!;
    redoStack.current.push(current);
    const prev = undoStack.current[undoStack.current.length - 1];
    c.loadFromJSON(JSON.parse(prev), () => {
      c.requestRenderAll();
      setCanUndo(undoStack.current.length > 1);
      setCanRedo(redoStack.current.length > 0);
      setSelectedObjects([]);
    });
  }, []);

  const redo = useCallback(() => {
    const c = fabricRef.current;
    if (!c || redoStack.current.length === 0) return;
    const next = redoStack.current.pop()!;
    undoStack.current.push(next);
    c.loadFromJSON(JSON.parse(next), () => {
      c.requestRenderAll();
      setCanUndo(undoStack.current.length > 1);
      setCanRedo(redoStack.current.length > 0);
      setSelectedObjects([]);
    });
  }, []);

  // ── Scale canvas to fit the center panel ────────────────────────────────────
  const scaleCanvasToFit = useCallback(() => {
    const c = fabricRef.current;
    const wrap = wrapperRef.current;
    if (!c || !wrap) return;

    const padding = 64;
    const availW = wrap.clientWidth - padding;
    const availH = wrap.clientHeight - padding;
    const scale = Math.min(availW / preset.w, availH / preset.h, 1);

    c.setZoom(scale);
    c.setWidth(preset.w * scale);
    c.setHeight(preset.h * scale);
    setCanvasScale(scale);
    setZoomLevel(scale);
    c.requestRenderAll();
  }, [preset]);

  // ── Init canvas ─────────────────────────────────────────────────────────────
  useEffect(() => {
    const el = canvasElRef.current;
    if (!el) return;

    const canvas = new fabric.Canvas(el, {
      backgroundColor: '#ffffff',
      preserveObjectStacking: true,
      selection: true,
      stopContextMenu: true,
      fireRightClick: true,
    });

    fabricRef.current = canvas;

    // Selection events
    const onSelect = () => {
      const active = canvas.getActiveObjects();
      setSelectedObjects([...active]);
    };
    const onClear = () => setSelectedObjects([]);
    canvas.on('selection:created', onSelect);
    canvas.on('selection:updated', onSelect);
    canvas.on('selection:cleared', onClear);

    // History events
    canvas.on('object:added', snapshot);
    canvas.on('object:modified', snapshot);
    canvas.on('object:removed', snapshot);

    // Load existing design or snapshot initial state
    if (existingDesign?.canvas_data && Object.keys(existingDesign.canvas_data).length > 0) {
      canvas.loadFromJSON(existingDesign.canvas_data, () => {
        canvas.requestRenderAll();
        // Initial snapshot after load
        const json = JSON.stringify(canvas.toJSON(['data']));
        undoStack.current = [json];
        setCanUndo(false);
      });
    } else {
      // fresh canvas — take initial snapshot
      const json = JSON.stringify(canvas.toJSON(['data']));
      undoStack.current = [json];
    }

    return () => {
      canvas.off('selection:created', onSelect);
      canvas.off('selection:updated', onSelect);
      canvas.off('selection:cleared', onClear);
      canvas.off('object:added', snapshot);
      canvas.off('object:modified', snapshot);
      canvas.off('object:removed', snapshot);
      canvas.dispose();
      fabricRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Scale on mount & resize
  useLayoutEffect(() => {
    scaleCanvasToFit();
  }, [scaleCanvasToFit]);

  useEffect(() => {
    const ro = new ResizeObserver(() => scaleCanvasToFit());
    if (wrapperRef.current) ro.observe(wrapperRef.current);
    return () => ro.disconnect();
  }, [scaleCanvasToFit]);

  // ── Keyboard shortcuts ──────────────────────────────────────────────────────
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      const c = fabricRef.current;
      if (!c) return;
      const active = document.activeElement;
      if (active && (active.tagName === 'INPUT' || active.tagName === 'TEXTAREA' || active.tagName === 'SELECT')) return;

      const ctrl = e.ctrlKey || e.metaKey;

      if (ctrl && e.key === 'z') { e.preventDefault(); undo(); }
      if (ctrl && (e.key === 'y' || (e.shiftKey && e.key === 'z'))) { e.preventDefault(); redo(); }
      if (ctrl && e.key === 's') { e.preventDefault(); void handleSave(); }
      if (ctrl && e.key === 'c') { e.preventDefault(); copySelection(); }
      if (ctrl && e.key === 'v') { e.preventDefault(); paste(); }
      if (ctrl && e.key === 'd') { e.preventDefault(); duplicateSelection(); }
      if (e.key === 'Delete' || e.key === 'Backspace') {
        const objs = c.getActiveObjects();
        if (objs.length) {
          objs.forEach((o) => c.remove(o));
          c.discardActiveObject();
          c.requestRenderAll();
          setSelectedObjects([]);
        }
      }
      // Arrow keys nudge
      const nudge = e.shiftKey ? 10 : 1;
      const obj = c.getActiveObject();
      if (obj) {
        if (e.key === 'ArrowLeft')  { obj.set('left', (obj.left ?? 0) - nudge); c.requestRenderAll(); }
        if (e.key === 'ArrowRight') { obj.set('left', (obj.left ?? 0) + nudge); c.requestRenderAll(); }
        if (e.key === 'ArrowUp')    { obj.set('top',  (obj.top  ?? 0) - nudge); c.requestRenderAll(); }
        if (e.key === 'ArrowDown')  { obj.set('top',  (obj.top  ?? 0) + nudge); c.requestRenderAll(); }
        if (['ArrowLeft','ArrowRight','ArrowUp','ArrowDown'].includes(e.key)) {
          e.preventDefault();
          snapshot();
        }
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [undo, redo]);

  // ── Clipboard ───────────────────────────────────────────────────────────────
  const clipboardRef = useRef<fabric.Object | null>(null);

  const copySelection = useCallback(() => {
    const c = fabricRef.current;
    if (!c) return;
    const obj = c.getActiveObject();
    if (!obj) return;
    obj.clone((cloned: fabric.Object) => { clipboardRef.current = cloned; });
  }, []);

  const paste = useCallback(() => {
    const c = fabricRef.current;
    if (!c || !clipboardRef.current) return;
    clipboardRef.current.clone((cloned: fabric.Object) => {
      c.discardActiveObject();
      cloned.set({ left: (cloned.left ?? 0) + 20, top: (cloned.top ?? 0) + 20, evented: true });
      if (cloned instanceof fabric.ActiveSelection) {
        cloned.canvas = c;
        cloned.forEachObject((obj) => c.add(obj));
        cloned.setCoords();
      } else {
        c.add(cloned);
      }
      c.setActiveObject(cloned);
      c.requestRenderAll();
    });
  }, []);

  // ── Add elements ─────────────────────────────────────────────────────────────
  const canvasCenter = useCallback(
    (w: number, h: number) => {
      const c = fabricRef.current;
      if (!c) return { left: 100, top: 100 };
      const vp = c.viewportTransform ?? [1, 0, 0, 1, 0, 0];
      const cx = (preset.w * canvasScale) / 2;
      const cy = (preset.h * canvasScale) / 2;
      return {
        left: (cx - vp[4]) / (vp[0] || 1) - w / 2,
        top: (cy - vp[5]) / (vp[3] || 1) - h / 2,
      };
    },
    [preset, canvasScale],
  );

  const addText = useCallback(
    (style: 'heading' | 'body' = 'body') => {
      const c = fabricRef.current;
      if (!c) return;
      const isHeading = style === 'heading';
      const pos = canvasCenter(300, 60);
      const text = new fabric.IText(isHeading ? 'Heading Text' : 'Body text here', {
        ...pos,
        fontFamily: 'Inter',
        fontSize: isHeading ? 72 : 36,
        fontWeight: isHeading ? 'bold' : 'normal',
        fill: '#1e293b',
        textAlign: 'left',
        lineHeight: 1.2,
        editable: true,
      });
      c.add(text);
      c.setActiveObject(text);
      c.requestRenderAll();
    },
    [canvasCenter],
  );

  const addRect = useCallback(() => {
    const c = fabricRef.current;
    if (!c) return;
    const pos = canvasCenter(200, 120);
    const rect = new fabric.Rect({
      ...pos,
      width: 200,
      height: 120,
      fill: '#e6332a',
      rx: 12,
      ry: 12,
      stroke: 'transparent',
      strokeWidth: 0,
    });
    c.add(rect);
    c.setActiveObject(rect);
    c.requestRenderAll();
  }, [canvasCenter]);

  const addCircle = useCallback(() => {
    const c = fabricRef.current;
    if (!c) return;
    const pos = canvasCenter(120, 120);
    const circle = new fabric.Ellipse({
      ...pos,
      rx: 60,
      ry: 60,
      fill: '#2563eb',
      stroke: 'transparent',
      strokeWidth: 0,
    });
    c.add(circle);
    c.setActiveObject(circle);
    c.requestRenderAll();
  }, [canvasCenter]);

  const addLine = useCallback(() => {
    const c = fabricRef.current;
    if (!c) return;
    const cx = (preset.w * canvasScale) / 2;
    const line = new fabric.Line(
      [cx - 150, preset.h * canvasScale * 0.5, cx + 150, preset.h * canvasScale * 0.5],
      { stroke: '#1e293b', strokeWidth: 3, selectable: true },
    );
    c.add(line);
    c.setActiveObject(line);
    c.requestRenderAll();
  }, [preset, canvasScale]);

  const handleUploadImage = useCallback(() => {
    fileInputRef.current?.click();
  }, []);

  const onFileChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      if (!file || !fabricRef.current) return;
      const reader = new FileReader();
      reader.onload = (ev) => {
        const url = ev.target?.result as string;
        fabric.Image.fromURL(url, (img) => {
          const c = fabricRef.current!;
          // Scale to max 400px wide
          const maxW = Math.min(preset.w * canvasScale * 0.5, 400);
          if ((img.width ?? 1) > maxW) {
            img.scale(maxW / (img.width ?? maxW));
          }
          const pos = canvasCenter(img.getScaledWidth(), img.getScaledHeight());
          img.set(pos);
          c.add(img);
          c.setActiveObject(img);
          c.requestRenderAll();
        });
      };
      reader.readAsDataURL(file);
      // Reset so same file can be re-selected
      e.target.value = '';
    },
    [canvasCenter, preset, canvasScale],
  );

  const setBackground = useCallback((color: string) => {
    const c = fabricRef.current;
    if (!c) return;
    c.setBackgroundColor(color, () => {
      c.requestRenderAll();
      snapshot();
    });
  }, [snapshot]);

  // ── Zoom controls ───────────────────────────────────────────────────────────
  const zoomIn = useCallback(() => {
    const c = fabricRef.current;
    if (!c) return;
    const newZ = Math.min(c.getZoom() * 1.25, 4);
    c.setZoom(newZ);
    c.setWidth(preset.w * newZ);
    c.setHeight(preset.h * newZ);
    setZoomLevel(newZ);
    c.requestRenderAll();
  }, [preset]);

  const zoomOut = useCallback(() => {
    const c = fabricRef.current;
    if (!c) return;
    const newZ = Math.max(c.getZoom() / 1.25, 0.1);
    c.setZoom(newZ);
    c.setWidth(preset.w * newZ);
    c.setHeight(preset.h * newZ);
    setZoomLevel(newZ);
    c.requestRenderAll();
  }, [preset]);

  const zoomFit = useCallback(() => scaleCanvasToFit(), [scaleCanvasToFit]);

  // ── Object manipulation ─────────────────────────────────────────────────────
  const deleteSelected = useCallback(() => {
    const c = fabricRef.current;
    if (!c) return;
    c.getActiveObjects().forEach((o) => c.remove(o));
    c.discardActiveObject();
    c.requestRenderAll();
    setSelectedObjects([]);
  }, []);

  const duplicateSelection = useCallback(() => {
    const c = fabricRef.current;
    if (!c) return;
    const obj = c.getActiveObject();
    if (!obj) return;
    obj.clone((cloned: fabric.Object) => {
      cloned.set({ left: (cloned.left ?? 0) + 20, top: (cloned.top ?? 0) + 20 });
      c.add(cloned);
      c.setActiveObject(cloned);
      c.requestRenderAll();
    });
  }, []);

  const bringForward = useCallback(() => {
    const c = fabricRef.current;
    if (!c) return;
    const obj = c.getActiveObject();
    if (obj) { c.bringForward(obj); c.requestRenderAll(); }
  }, []);

  const sendBackward = useCallback(() => {
    const c = fabricRef.current;
    if (!c) return;
    const obj = c.getActiveObject();
    if (obj) { c.sendBackwards(obj); c.requestRenderAll(); }
  }, []);

  const flipH = useCallback(() => {
    const c = fabricRef.current;
    if (!c) return;
    const obj = c.getActiveObject() as fabric.Image;
    if (obj) { obj.set('flipX', !obj.flipX); c.requestRenderAll(); snapshot(); }
  }, [snapshot]);

  const flipV = useCallback(() => {
    const c = fabricRef.current;
    if (!c) return;
    const obj = c.getActiveObject() as fabric.Image;
    if (obj) { obj.set('flipY', !obj.flipY); c.requestRenderAll(); snapshot(); }
  }, [snapshot]);

  // ── Export ─────────────────────────────────────────────────────────────────
  const exportPNG = useCallback(() => {
    const c = fabricRef.current;
    if (!c) return;
    const multiplier = preset.w / (preset.w * canvasScale);
    const dataUrl = c.toDataURL({ format: 'png', quality: 1, multiplier });
    const link = document.createElement('a');
    link.href = dataUrl;
    link.download = `${designName.replace(/[^a-z0-9]/gi, '_')}.png`;
    link.click();
  }, [designName, preset, canvasScale]);

  const exportJPG = useCallback(() => {
    const c = fabricRef.current;
    if (!c) return;
    const multiplier = preset.w / (preset.w * canvasScale);
    const dataUrl = c.toDataURL({ format: 'jpeg', quality: 0.95, multiplier });
    const link = document.createElement('a');
    link.href = dataUrl;
    link.download = `${designName.replace(/[^a-z0-9]/gi, '_')}.jpg`;
    link.click();
  }, [designName, preset, canvasScale]);

  // ── Save ────────────────────────────────────────────────────────────────────
  const handleSave = useCallback(async () => {
    const c = fabricRef.current;
    if (!c || saving) return;
    setSaving(true);
    try {
      const canvasData = c.toJSON(['data']);
      // Generate thumbnail
      const thumbnailUrl = c.toDataURL({ format: 'jpeg', quality: 0.5, multiplier: 0.3 });

      const payload = {
        name: designName,
        canvas_width: preset.w,
        canvas_height: preset.h,
        canvas_data: canvasData,
        thumbnail_url: thumbnailUrl,
      };

      let saved: UserDesign;
      if (designId) {
        saved = await designService.update(designId, payload);
      } else {
        saved = await designService.create(payload);
        setDesignId(saved.id);
      }
      setSavedPulse(true);
      setTimeout(() => setSavedPulse(false), 2000);
      onSaved?.(saved);
    } catch (err) {
      console.error('Save failed', err);
    } finally {
      setSaving(false);
    }
  }, [designId, designName, preset, saving, onSaved]);

  // ── Preset change ────────────────────────────────────────────────────────────
  const applyPreset = useCallback(
    (p: CanvasPreset) => {
      setPreset(p);
      setShowPresets(false);
      // Re-scale next tick (state needs to settle)
      setTimeout(() => scaleCanvasToFit(), 0);
    },
    [scaleCanvasToFit],
  );

  // ─────────────────────────────────────────────────────────────────────────────
  return (
    <div
      className="fixed inset-0 z-[9999] flex flex-col bg-zinc-100"
      style={{ fontFamily: 'Inter, system-ui, sans-serif' }}
    >
      {/* Hidden file input */}
      <input
        ref={fileInputRef}
        type="file"
        accept="image/*"
        className="hidden"
        onChange={onFileChange}
      />

      {/* ── Top Toolbar ──────────────────────────────────────────────────────── */}
      <header className="flex h-14 shrink-0 items-center gap-3 border-b border-zinc-200 bg-white px-4 shadow-sm">
        {/* Close */}
        <button
          type="button"
          onClick={onClose}
          className="flex h-8 w-8 items-center justify-center rounded-lg text-zinc-500 hover:bg-zinc-100 hover:text-zinc-900 transition"
          title="Exit builder"
        >
          <X size={18} />
        </button>

        {/* Divider */}
        <div className="h-6 w-px bg-zinc-200" />

        {/* Design name */}
        <input
          type="text"
          value={designName}
          onChange={(e) => setDesignName(e.target.value)}
          className="min-w-0 max-w-[200px] rounded-lg border border-transparent bg-transparent px-2 py-1 text-sm font-semibold text-zinc-800 focus:border-zinc-300 focus:bg-zinc-50 focus:outline-none"
          placeholder="Untitled Design"
        />

        {/* Canvas preset selector */}
        <div className="relative">
          <button
            type="button"
            onClick={() => setShowPresets((p) => !p)}
            className="flex items-center gap-1.5 rounded-lg border border-zinc-200 bg-zinc-50 px-3 py-1.5 text-xs font-semibold text-zinc-600 hover:bg-zinc-100 transition"
          >
            {preset.label}
            <span className="text-zinc-400">
              {preset.w}×{preset.h}
            </span>
            <ChevronDown size={12} />
          </button>
          {showPresets && (
            <div className="absolute left-0 top-full mt-1 z-50 min-w-[200px] rounded-2xl border border-zinc-200 bg-white shadow-xl p-1">
              {CANVAS_PRESETS.map((p) => (
                <button
                  key={p.id}
                  type="button"
                  onClick={() => applyPreset(p)}
                  className={`flex w-full items-center justify-between rounded-xl px-3 py-2 text-left text-sm transition hover:bg-zinc-50 ${
                    preset.id === p.id ? 'font-bold text-zinc-900' : 'text-zinc-700'
                  }`}
                >
                  <span>{p.label}</span>
                  <span className="text-xs text-zinc-400">
                    {p.w}×{p.h}
                  </span>
                </button>
              ))}
            </div>
          )}
        </div>

        {/* Divider */}
        <div className="h-6 w-px bg-zinc-200" />

        {/* Undo / Redo */}
        <button
          type="button"
          onClick={undo}
          disabled={!canUndo}
          title={`Undo (${mod}+Z)`}
          className="flex h-8 w-8 items-center justify-center rounded-lg text-zinc-500 hover:bg-zinc-100 disabled:opacity-30 transition"
        >
          <Undo2 size={16} />
        </button>
        <button
          type="button"
          onClick={redo}
          disabled={!canRedo}
          title={`Redo (${mod}+Y)`}
          className="flex h-8 w-8 items-center justify-center rounded-lg text-zinc-500 hover:bg-zinc-100 disabled:opacity-30 transition"
        >
          <Redo2 size={16} />
        </button>

        {/* Divider */}
        <div className="h-6 w-px bg-zinc-200" />

        {/* Zoom controls */}
        <button
          type="button"
          onClick={zoomOut}
          title="Zoom out"
          className="flex h-8 w-8 items-center justify-center rounded-lg text-zinc-500 hover:bg-zinc-100 transition"
        >
          <ZoomOut size={15} />
        </button>
        <span className="min-w-[44px] text-center text-xs font-semibold text-zinc-500">
          {fmtZoom(zoomLevel)}
        </span>
        <button
          type="button"
          onClick={zoomIn}
          title="Zoom in"
          className="flex h-8 w-8 items-center justify-center rounded-lg text-zinc-500 hover:bg-zinc-100 transition"
        >
          <ZoomIn size={15} />
        </button>
        <button
          type="button"
          onClick={zoomFit}
          title="Fit to screen"
          className="flex h-8 w-8 items-center justify-center rounded-lg text-zinc-500 hover:bg-zinc-100 transition"
        >
          <Maximize2 size={15} />
        </button>

        {/* Spacer */}
        <div className="flex-1" />

        {/* Cursor tool indicator */}
        <div className="hidden md:flex items-center gap-1.5 rounded-lg bg-zinc-100 px-3 py-1.5 text-xs text-zinc-500">
          <MousePointer2 size={12} />
          Select
        </div>

        {/* Export */}
        <div className="flex items-center gap-1">
          <button
            type="button"
            onClick={exportPNG}
            className="flex items-center gap-1.5 rounded-lg border border-zinc-200 px-3 py-1.5 text-xs font-semibold text-zinc-700 hover:bg-zinc-50 transition"
            title="Export as PNG"
          >
            <Download size={13} />
            PNG
          </button>
          <button
            type="button"
            onClick={exportJPG}
            className="flex items-center gap-1.5 rounded-lg border border-zinc-200 px-3 py-1.5 text-xs font-semibold text-zinc-700 hover:bg-zinc-50 transition"
            title="Export as JPG"
          >
            <Download size={13} />
            JPG
          </button>
        </div>

        {/* Save */}
        <button
          type="button"
          onClick={() => void handleSave()}
          disabled={saving}
          className={`flex items-center gap-2 rounded-xl px-5 py-2 text-sm font-bold transition ${
            savedPulse
              ? 'bg-emerald-500 text-white'
              : 'bg-slate-900 text-white hover:bg-slate-700'
          } disabled:opacity-60`}
          title={`Save (${mod}+S)`}
        >
          {saving ? (
            <Loader2 size={14} className="animate-spin" />
          ) : (
            <Save size={14} />
          )}
          {savedPulse ? 'Saved!' : 'Save'}
        </button>
      </header>

      {/* ── Body (3 columns) ─────────────────────────────────────────────────── */}
      <div className="flex min-h-0 flex-1">
        {/* Left sidebar — Elements */}
        <aside className="w-56 shrink-0 border-r border-zinc-200 bg-white">
          <div className="border-b border-zinc-100 px-4 py-3">
            <p className="text-xs font-bold uppercase tracking-widest text-zinc-400">Elements</p>
          </div>
          <ElementsPanel
            onAddText={addText}
            onAddRect={addRect}
            onAddCircle={addCircle}
            onAddLine={addLine}
            onUploadImage={handleUploadImage}
            onSetBackground={setBackground}
          />
        </aside>

        {/* Center — Canvas workspace */}
        <div
          ref={wrapperRef}
          className="flex flex-1 items-center justify-center overflow-auto bg-zinc-200"
          style={{ backgroundImage: 'radial-gradient(circle, #a1a1aa 1px, transparent 1px)', backgroundSize: '24px 24px' }}
          onClick={() => setShowPresets(false)}
        >
          <div
            className="relative shadow-2xl"
            style={{
              width: preset.w * canvasScale,
              height: preset.h * canvasScale,
            }}
          >
            <canvas ref={canvasElRef} />
          </div>
        </div>

        {/* Right sidebar — Properties */}
        <aside className="w-64 shrink-0 border-l border-zinc-200 bg-white">
          <div className="border-b border-zinc-100 px-4 py-3">
            <p className="text-xs font-bold uppercase tracking-widest text-zinc-400">Properties</p>
          </div>
          <PropertiesPanel
            canvas={fabricRef.current}
            selectedObjects={selectedObjects}
            onDelete={deleteSelected}
            onDuplicate={duplicateSelection}
            onBringForward={bringForward}
            onSendBackward={sendBackward}
            onFlipH={flipH}
            onFlipV={flipV}
          />
        </aside>
      </div>

      {/* ── Keyboard shortcut hint bar ───────────────────────────────────────── */}
      <div className="flex h-7 shrink-0 items-center gap-5 border-t border-zinc-200 bg-white px-4">
        {[
          [`${mod}+Z`, 'Undo'],
          [`${mod}+Y`, 'Redo'],
          [`${mod}+S`, 'Save'],
          [`${mod}+D`, 'Duplicate'],
          ['Delete', 'Remove'],
          ['Arrow keys', 'Nudge'],
          [`Shift+Arrow`, 'Nudge ×10'],
        ].map(([key, label]) => (
          <span key={key} className="flex items-center gap-1.5 text-[10px] text-zinc-400">
            <kbd className="rounded bg-zinc-100 px-1.5 py-0.5 font-mono text-[9px] text-zinc-500">
              {key}
            </kbd>
            {label}
          </span>
        ))}
      </div>
    </div>
  );
}
