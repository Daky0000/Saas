import { useState, useRef, useCallback } from 'react';
import { X, HelpCircle, Pause, XCircle, CheckCircle2 } from 'lucide-react';

interface ImageUploadModalProps {
  onConfirm: (url: string) => void;
  onClose: () => void;
}

type UploadState = 'idle' | 'dragging' | 'uploading' | 'complete';

interface FileInfo {
  name: string;
  size: string;
  preview: string;
  dataUrl: string;
}

function fmtSize(bytes: number) {
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export default function ImageUploadModal({ onConfirm, onClose }: ImageUploadModalProps) {
  const [state, setState] = useState<UploadState>('idle');
  const [progress, setProgress] = useState(0);
  const [fileInfo, setFileInfo] = useState<FileInfo | null>(null);
  const [urlInput, setUrlInput] = useState('');
  const [urlLoading, setUrlLoading] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const clearTimer = () => { if (timerRef.current) { clearInterval(timerRef.current); timerRef.current = null; } };

  const processFile = useCallback((file: File) => {
    if (!file.type.match(/image\/(png|jpe?g|webp|gif|svg)/i)) return;
    setState('uploading');
    setProgress(0);

    // Animate progress bar
    let prog = 0;
    timerRef.current = setInterval(() => {
      prog += Math.random() * 18 + 8;
      if (prog >= 92) { prog = 92; clearTimer(); }
      setProgress(Math.round(prog));
    }, 60);

    const reader = new FileReader();
    reader.onload = (ev) => {
      const dataUrl = ev.target?.result as string;
      clearTimer();

      // Generate small thumbnail via an offscreen canvas
      const img = new Image();
      img.onload = () => {
        const c = document.createElement('canvas');
        const sz = 44;
        c.width = sz; c.height = sz;
        const ctx = c.getContext('2d');
        if (ctx) {
          const scale = Math.max(sz / img.width, sz / img.height);
          const sw = img.width * scale, sh = img.height * scale;
          ctx.drawImage(img, (sz - sw) / 2, (sz - sh) / 2, sw, sh);
        }
        setFileInfo({ name: file.name, size: fmtSize(file.size), preview: c.toDataURL('image/jpeg', 0.6), dataUrl });
        setProgress(100);
        setState('complete');
      };
      img.onerror = () => {
        setFileInfo({ name: file.name, size: fmtSize(file.size), preview: '', dataUrl });
        setProgress(100);
        setState('complete');
      };
      img.src = dataUrl;
    };
    reader.readAsDataURL(file);
  }, []);

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setState('idle');
    const file = e.dataTransfer.files[0];
    if (file) processFile(file);
  };

  const handleUrlUpload = async () => {
    if (!urlInput.trim()) return;
    setUrlLoading(true);
    try {
      // Attempt to validate the image loads (best-effort)
      await new Promise<void>((resolve) => {
        const img = new Image();
        img.crossOrigin = 'anonymous';
        img.onload = () => resolve();
        img.onerror = () => resolve(); // use URL anyway
        img.src = urlInput.trim();
        setTimeout(resolve, 3000); // timeout fallback
      });
      onConfirm(urlInput.trim());
    } finally {
      setUrlLoading(false);
    }
  };

  const cancelUpload = () => {
    clearTimer();
    setState('idle');
    setFileInfo(null);
    setProgress(0);
  };

  return (
    <div className="fixed inset-0 z-[99999] flex items-center justify-center bg-black/40 backdrop-blur-sm">
      <div className="w-[500px] rounded-2xl bg-white shadow-2xl" style={{ fontFamily: 'Inter, system-ui, sans-serif' }}>

        {/* Header */}
        <div className="flex items-center justify-between border-b border-zinc-100 px-6 py-4">
          <h2 className="text-sm font-bold text-zinc-900">Upload Photos</h2>
          <button type="button" onClick={onClose}
            className="flex h-7 w-7 items-center justify-center rounded-lg text-zinc-400 transition hover:bg-zinc-100">
            <X size={15} />
          </button>
        </div>

        <div className="space-y-4 p-6">
          {/* Drop zone */}
          <div
            onDragEnter={(e) => { e.preventDefault(); setState('dragging'); }}
            onDragLeave={(e) => { e.preventDefault(); if (!e.currentTarget.contains(e.relatedTarget as Node)) setState((s) => s === 'dragging' ? 'idle' : s); }}
            onDragOver={(e) => e.preventDefault()}
            onDrop={handleDrop}
            onClick={() => { if (state === 'idle' || state === 'dragging') fileInputRef.current?.click(); }}
            className={`relative flex min-h-[140px] cursor-pointer flex-col items-center justify-center rounded-xl border-2 border-dashed transition ${
              state === 'dragging' ? 'border-blue-400 bg-blue-50/60' : 'border-zinc-200 bg-zinc-50/40 hover:border-zinc-300'
            }`}
          >
            <input ref={fileInputRef} type="file" accept="image/*" className="hidden"
              onChange={(e) => { const f = e.target.files?.[0]; if (f) processFile(f); e.target.value = ''; }} />

            {state === 'dragging' ? (
              <div className="flex items-center gap-1.5 text-sm font-semibold text-blue-500">
                <span className="text-blue-300">›</span>
                <span className="text-blue-300">›</span>
                Drop your files here
                <span className="text-blue-300">‹</span>
                <span className="text-blue-300">‹</span>
              </div>
            ) : (
              <div className="flex flex-col items-center gap-3 text-center">
                {/* Photo icon */}
                <svg width="52" height="52" viewBox="0 0 52 52" fill="none">
                  <rect width="52" height="52" rx="14" fill="#EEF2FF" />
                  <path d="M14 38v-2a6 6 0 0 1 6-6h12a6 6 0 0 1 6 6v2" stroke="#6366F1" strokeWidth="2" strokeLinecap="round" />
                  <circle cx="26" cy="22" r="6" stroke="#6366F1" strokeWidth="2" />
                  <path d="M22 19c.6-.7 1.8-2 3.2-1.4" stroke="#6366F1" strokeWidth="1.5" strokeLinecap="round" />
                  <circle cx="35" cy="17" r="4" fill="#818CF8" />
                  <path d="M35 15v4M33 17h4" stroke="white" strokeWidth="1.5" strokeLinecap="round" />
                </svg>
                <div>
                  <p className="text-sm text-zinc-600">
                    Drop your image here, or{' '}
                    <span className="font-semibold text-blue-600">browse</span>
                  </p>
                  <p className="mt-0.5 text-xs text-zinc-400">Supports: PNG, JPG, JPEG, WEBP</p>
                </div>
              </div>
            )}
          </div>

          {/* Progress / complete row */}
          {(state === 'uploading' || state === 'complete') && fileInfo && (
            <div className="flex items-center gap-3 rounded-xl border border-zinc-100 bg-zinc-50 p-3">
              {fileInfo.preview ? (
                <img src={fileInfo.preview} alt="" className="h-11 w-11 shrink-0 rounded-lg object-cover" />
              ) : (
                <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-lg bg-zinc-200 text-zinc-400 text-xs">IMG</div>
              )}
              <div className="flex-1 min-w-0">
                <div className="mb-1.5 flex items-center justify-between gap-2">
                  <p className="truncate text-xs font-semibold text-zinc-800">{fileInfo.name}</p>
                  <div className="flex shrink-0 items-center gap-2">
                    <span className="text-[11px] text-zinc-400">{fileInfo.size}</span>
                    {state === 'uploading' ? (
                      <>
                        <span className="text-[11px] font-semibold text-zinc-600">{progress}%</span>
                        <button type="button" title="Pause" className="text-zinc-400 transition hover:text-zinc-600"><Pause size={12} /></button>
                        <button type="button" title="Cancel" onClick={cancelUpload} className="text-zinc-400 transition hover:text-red-500"><XCircle size={12} /></button>
                      </>
                    ) : (
                      <CheckCircle2 size={15} className="text-emerald-500" />
                    )}
                  </div>
                </div>
                <div className="h-1.5 w-full overflow-hidden rounded-full bg-zinc-200">
                  <div
                    className="h-full rounded-full bg-blue-500 transition-all duration-100"
                    style={{ width: `${progress}%` }}
                  />
                </div>
              </div>
            </div>
          )}

          {/* Divider */}
          <div className="flex items-center gap-3">
            <div className="h-px flex-1 bg-zinc-100" />
            <span className="text-xs text-zinc-400">or</span>
            <div className="h-px flex-1 bg-zinc-100" />
          </div>

          {/* URL import */}
          <div>
            <p className="mb-2 text-sm font-semibold text-zinc-700">Import from URL</p>
            <div className="flex gap-2">
              <input
                type="url"
                value={urlInput}
                onChange={(e) => setUrlInput(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter') void handleUrlUpload(); }}
                placeholder="Add file URL"
                className="flex-1 rounded-xl border border-zinc-200 px-3 py-2 text-sm text-zinc-700 placeholder:text-zinc-300 focus:outline-none focus:ring-2 focus:ring-blue-100"
              />
              <button
                type="button"
                onClick={() => void handleUrlUpload()}
                disabled={!urlInput.trim() || urlLoading}
                className="rounded-xl border border-zinc-200 px-4 py-2 text-sm font-semibold text-zinc-700 transition hover:bg-zinc-50 disabled:opacity-50"
              >
                {urlLoading ? '…' : 'Upload'}
              </button>
            </div>
          </div>
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between border-t border-zinc-100 px-6 py-3">
          <button type="button" className="flex items-center gap-1.5 text-xs text-zinc-400 transition hover:text-zinc-600">
            <HelpCircle size={12} /> Help Centre
          </button>
          <div className="flex gap-2">
            <button type="button" onClick={onClose}
              className="rounded-xl border border-zinc-200 px-4 py-2 text-sm font-semibold text-zinc-700 transition hover:bg-zinc-50">
              Cancel
            </button>
            <button
              type="button"
              onClick={() => { if (fileInfo) onConfirm(fileInfo.dataUrl); }}
              disabled={state !== 'complete'}
              className="rounded-xl bg-blue-600 px-5 py-2 text-sm font-bold text-white transition hover:bg-blue-700 disabled:opacity-40"
            >
              Import
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
