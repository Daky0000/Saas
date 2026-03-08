import { useState, useEffect } from 'react';
import { fabric } from 'fabric';
import {
  AlignLeft, AlignCenter, AlignRight,
  Bold, Italic, Underline,
  Layers, Eye, EyeOff, Trash2, Copy, ArrowUp, ArrowDown,
} from 'lucide-react';

interface PropsPanelProps {
  canvas: fabric.Canvas | null;
  selectedObjects: fabric.Object[];
  onDelete: () => void;
  onDuplicate: () => void;
  onBringForward: () => void;
  onSendBackward: () => void;
  onFlipH: () => void;
  onFlipV: () => void;
}

const FONTS = [
  'Inter', 'Georgia', 'Times New Roman', 'Arial', 'Helvetica',
  'Courier New', 'Verdana', 'Trebuchet MS', 'Impact',
];

interface FieldProps { label: string; children: React.ReactNode }
function Field({ label, children }: FieldProps) {
  return (
    <div className="flex flex-col gap-1">
      <label className="text-[10px] font-semibold uppercase tracking-wider text-zinc-400">{label}</label>
      {children}
    </div>
  );
}

function NumberInput({
  value,
  onChange,
  min,
  max,
  step = 1,
}: {
  value: number;
  onChange: (v: number) => void;
  min?: number;
  max?: number;
  step?: number;
}) {
  return (
    <input
      type="number"
      value={Math.round(value)}
      min={min}
      max={max}
      step={step}
      onChange={(e) => onChange(parseFloat(e.target.value))}
      className="w-full rounded-lg border border-zinc-200 bg-white px-2.5 py-1.5 text-sm text-zinc-800 focus:outline-none focus:ring-2 focus:ring-slate-300"
    />
  );
}

function ColorInput({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  return (
    <div className="flex items-center gap-2">
      <input
        type="color"
        value={value || '#000000'}
        onChange={(e) => onChange(e.target.value)}
        className="h-8 w-10 cursor-pointer rounded-lg border border-zinc-200"
      />
      <input
        type="text"
        value={value || ''}
        onChange={(e) => onChange(e.target.value)}
        placeholder="#000000"
        className="w-full rounded-lg border border-zinc-200 bg-white px-2.5 py-1.5 text-sm text-zinc-800 focus:outline-none focus:ring-2 focus:ring-slate-300"
      />
    </div>
  );
}

export default function PropertiesPanel({
  canvas,
  selectedObjects,
  onDelete,
  onDuplicate,
  onBringForward,
  onSendBackward,
  onFlipH,
  onFlipV,
}: PropsPanelProps) {
  // Local state mirrors the selected object's properties, refreshes on selection change
  const [, forceUpdate] = useState(0);
  const refresh = () => forceUpdate((n) => n + 1);

  useEffect(() => {
    if (!canvas) return;
    const handler = () => refresh();
    canvas.on('object:modified', handler);
    canvas.on('object:scaling', handler);
    canvas.on('object:moving', handler);
    canvas.on('object:rotating', handler);
    return () => {
      canvas.off('object:modified', handler);
      canvas.off('object:scaling', handler);
      canvas.off('object:moving', handler);
      canvas.off('object:rotating', handler);
    };
  }, [canvas]);

  if (!canvas || selectedObjects.length === 0) {
    return (
      <div className="flex h-full items-center justify-center p-6 text-center">
        <div>
          <Layers size={28} className="mx-auto mb-3 text-zinc-300" />
          <p className="text-sm text-zinc-400">Select an element to edit its properties</p>
        </div>
      </div>
    );
  }

  const obj = selectedObjects[0];
  const isText = obj instanceof fabric.IText || obj instanceof fabric.Text;
  const isImage = obj instanceof fabric.Image;
  const isShape = obj instanceof fabric.Rect || obj instanceof fabric.Circle || obj instanceof fabric.Line || obj instanceof fabric.Ellipse;

  const zoom = canvas.getZoom();

  const set = (key: string, value: unknown) => {
    selectedObjects.forEach((o) => {
      (o as fabric.Object & Record<string, unknown>).set(key, value);
    });
    canvas.requestRenderAll();
    refresh();
  };

  const setPos = (axis: 'left' | 'top', value: number) => {
    obj.set(axis, value / zoom);
    canvas.requestRenderAll();
    refresh();
  };

  const setSize = (dim: 'scaleX' | 'scaleY', px: number) => {
    const orig = dim === 'scaleX' ? (obj.width ?? 1) : (obj.height ?? 1);
    obj.set(dim, px / orig);
    canvas.requestRenderAll();
    refresh();
  };

  const toggleVisible = () => {
    obj.set('visible', !obj.visible);
    canvas.requestRenderAll();
    refresh();
  };

  const displayLeft = Math.round((obj.left ?? 0) * zoom);
  const displayTop = Math.round((obj.top ?? 0) * zoom);
  const displayW = Math.round((obj.getScaledWidth?.() ?? obj.width ?? 0) * zoom);
  const displayH = Math.round((obj.getScaledHeight?.() ?? obj.height ?? 0) * zoom);

  return (
    <div className="h-full overflow-y-auto p-4 flex flex-col gap-5">
      {/* Object actions */}
      <div className="flex flex-wrap gap-1.5">
        <button
          type="button"
          onClick={onDuplicate}
          title="Duplicate"
          className="flex items-center gap-1.5 rounded-lg border border-zinc-200 px-2.5 py-1.5 text-xs font-medium text-zinc-600 hover:bg-zinc-50 transition"
        >
          <Copy size={13} /> Duplicate
        </button>
        <button
          type="button"
          onClick={toggleVisible}
          title={obj.visible ? 'Hide' : 'Show'}
          className="flex items-center gap-1.5 rounded-lg border border-zinc-200 px-2.5 py-1.5 text-xs font-medium text-zinc-600 hover:bg-zinc-50 transition"
        >
          {obj.visible ? <Eye size={13} /> : <EyeOff size={13} />}
        </button>
        <button
          type="button"
          onClick={onBringForward}
          title="Bring Forward"
          className="flex items-center gap-1.5 rounded-lg border border-zinc-200 px-2.5 py-1.5 text-xs font-medium text-zinc-600 hover:bg-zinc-50 transition"
        >
          <ArrowUp size={13} />
        </button>
        <button
          type="button"
          onClick={onSendBackward}
          title="Send Backward"
          className="flex items-center gap-1.5 rounded-lg border border-zinc-200 px-2.5 py-1.5 text-xs font-medium text-zinc-600 hover:bg-zinc-50 transition"
        >
          <ArrowDown size={13} />
        </button>
        <button
          type="button"
          onClick={onDelete}
          title="Delete"
          className="flex items-center gap-1.5 rounded-lg border border-red-200 px-2.5 py-1.5 text-xs font-medium text-red-500 hover:bg-red-50 transition ml-auto"
        >
          <Trash2 size={13} />
        </button>
      </div>

      {/* Position & Size */}
      <div>
        <p className="mb-2 text-[10px] font-bold uppercase tracking-widest text-zinc-400">Position & Size</p>
        <div className="grid grid-cols-2 gap-2">
          <Field label="X">
            <NumberInput value={displayLeft} onChange={(v) => setPos('left', v)} />
          </Field>
          <Field label="Y">
            <NumberInput value={displayTop} onChange={(v) => setPos('top', v)} />
          </Field>
          <Field label="W">
            <NumberInput value={displayW} onChange={(v) => setSize('scaleX', v)} min={1} />
          </Field>
          <Field label="H">
            <NumberInput value={displayH} onChange={(v) => setSize('scaleY', v)} min={1} />
          </Field>
        </div>
        <div className="mt-2">
          <Field label="Rotation (°)">
            <NumberInput value={obj.angle ?? 0} onChange={(v) => set('angle', v)} min={0} max={360} />
          </Field>
        </div>
      </div>

      {/* Opacity */}
      <div>
        <p className="mb-2 text-[10px] font-bold uppercase tracking-widest text-zinc-400">Opacity</p>
        <div className="flex items-center gap-3">
          <input
            type="range"
            min={0}
            max={1}
            step={0.01}
            value={obj.opacity ?? 1}
            onChange={(e) => set('opacity', parseFloat(e.target.value))}
            className="flex-1"
          />
          <span className="w-10 text-right text-xs text-zinc-500">
            {Math.round((obj.opacity ?? 1) * 100)}%
          </span>
        </div>
      </div>

      {/* Text properties */}
      {isText && (
        <div className="flex flex-col gap-3">
          <p className="text-[10px] font-bold uppercase tracking-widest text-zinc-400">Text</p>

          <Field label="Font Family">
            <select
              value={(obj as fabric.IText).fontFamily ?? 'Inter'}
              onChange={(e) => set('fontFamily', e.target.value)}
              className="w-full rounded-lg border border-zinc-200 bg-white px-2.5 py-2 text-sm text-zinc-800 focus:outline-none focus:ring-2 focus:ring-slate-300"
            >
              {FONTS.map((f) => (
                <option key={f} value={f} style={{ fontFamily: f }}>
                  {f}
                </option>
              ))}
            </select>
          </Field>

          <div className="grid grid-cols-2 gap-2">
            <Field label="Size">
              <NumberInput
                value={(obj as fabric.IText).fontSize ?? 24}
                onChange={(v) => set('fontSize', v)}
                min={6}
                max={400}
              />
            </Field>
            <Field label="Line Height">
              <NumberInput
                value={(obj as fabric.IText).lineHeight ?? 1.2}
                onChange={(v) => set('lineHeight', v)}
                min={0.5}
                max={4}
                step={0.05}
              />
            </Field>
          </div>

          <Field label="Letter Spacing">
            <NumberInput
              value={(obj as fabric.IText).charSpacing ?? 0}
              onChange={(v) => set('charSpacing', v)}
              min={-200}
              max={800}
            />
          </Field>

          <Field label="Text Color">
            <ColorInput
              value={((obj as fabric.IText).fill as string) ?? '#000000'}
              onChange={(v) => set('fill', v)}
            />
          </Field>

          {/* Style toggles */}
          <div className="flex gap-1.5">
            {[
              { icon: <Bold size={14} />, prop: 'fontWeight', on: 'bold', off: 'normal', tip: 'Bold' },
              { icon: <Italic size={14} />, prop: 'fontStyle', on: 'italic', off: 'normal', tip: 'Italic' },
              { icon: <Underline size={14} />, prop: 'underline', on: true, off: false, tip: 'Underline' },
            ].map(({ icon, prop, on, off, tip }) => {
              const active = (obj as fabric.IText & Record<string, unknown>)[prop] === on;
              return (
                <button
                  key={prop}
                  type="button"
                  title={tip}
                  onClick={() => set(prop, active ? off : on)}
                  className={`flex h-8 w-8 items-center justify-center rounded-lg border text-sm transition ${
                    active
                      ? 'border-slate-900 bg-slate-900 text-white'
                      : 'border-zinc-200 text-zinc-600 hover:bg-zinc-50'
                  }`}
                >
                  {icon}
                </button>
              );
            })}
          </div>

          {/* Alignment */}
          <div className="flex gap-1.5">
            {[
              { icon: <AlignLeft size={14} />, align: 'left' },
              { icon: <AlignCenter size={14} />, align: 'center' },
              { icon: <AlignRight size={14} />, align: 'right' },
            ].map(({ icon, align }) => {
              const active = (obj as fabric.IText).textAlign === align;
              return (
                <button
                  key={align}
                  type="button"
                  onClick={() => set('textAlign', align)}
                  className={`flex h-8 w-8 items-center justify-center rounded-lg border text-sm transition ${
                    active
                      ? 'border-slate-900 bg-slate-900 text-white'
                      : 'border-zinc-200 text-zinc-600 hover:bg-zinc-50'
                  }`}
                >
                  {icon}
                </button>
              );
            })}
          </div>
        </div>
      )}

      {/* Shape / Fill properties */}
      {isShape && (
        <div className="flex flex-col gap-3">
          <p className="text-[10px] font-bold uppercase tracking-widest text-zinc-400">Fill & Stroke</p>
          <Field label="Fill Color">
            <ColorInput
              value={((obj as fabric.Rect).fill as string) ?? '#cccccc'}
              onChange={(v) => set('fill', v)}
            />
          </Field>
          <Field label="Stroke Color">
            <ColorInput
              value={((obj as fabric.Rect).stroke as string) ?? '#000000'}
              onChange={(v) => set('stroke', v)}
            />
          </Field>
          <Field label="Stroke Width">
            <NumberInput
              value={(obj as fabric.Rect).strokeWidth ?? 0}
              onChange={(v) => set('strokeWidth', v)}
              min={0}
              max={50}
            />
          </Field>
          {(obj instanceof fabric.Rect) && (
            <Field label="Corner Radius">
              <NumberInput
                value={(obj as fabric.Rect).rx ?? 0}
                onChange={(v) => { set('rx', v); set('ry', v); }}
                min={0}
                max={500}
              />
            </Field>
          )}
        </div>
      )}

      {/* Image properties */}
      {isImage && (
        <div className="flex flex-col gap-3">
          <p className="text-[10px] font-bold uppercase tracking-widest text-zinc-400">Image</p>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={onFlipH}
              className="flex-1 rounded-lg border border-zinc-200 py-1.5 text-xs font-medium text-zinc-600 hover:bg-zinc-50 transition"
            >
              Flip H
            </button>
            <button
              type="button"
              onClick={onFlipV}
              className="flex-1 rounded-lg border border-zinc-200 py-1.5 text-xs font-medium text-zinc-600 hover:bg-zinc-50 transition"
            >
              Flip V
            </button>
          </div>
        </div>
      )}

      {/* Multi-selection note */}
      {selectedObjects.length > 1 && (
        <p className="text-xs text-zinc-400 text-center">
          {selectedObjects.length} objects selected
        </p>
      )}
    </div>
  );
}
