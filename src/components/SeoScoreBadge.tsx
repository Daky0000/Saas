import type { CSSProperties } from 'react';

interface SeoScoreBadgeProps {
  score: number;
  size?: number;
  label?: string;
  className?: string;
}

const clamp = (value: number, min: number, max: number) => Math.min(Math.max(value, min), max);

export default function SeoScoreBadge({
  score,
  size = 90,
  label = 'SEO',
  className = '',
}: SeoScoreBadgeProps) {
  const pct = clamp(score, 0, 100);
  const palette = (() => {
    if (pct >= 80) return { main: '#047857', pale: '#d1fae5', textClass: 'text-emerald-800', border: '#a7f3d0' };
    if (pct >= 60) return { main: '#22c55e', pale: '#dcfce7', textClass: 'text-emerald-600', border: '#bbf7d0' };
    if (pct >= 40) return { main: '#f59e0b', pale: '#ffedd5', textClass: 'text-amber-600', border: '#fed7aa' };
    return { main: '#ef4444', pale: '#fee2e2', textClass: 'text-red-600', border: '#fecaca' };
  })();
  const gradientStyle: CSSProperties = {
    background: `conic-gradient(${palette.main} ${pct}%, ${palette.pale} ${pct}%)`,
  };
  const innerSize = size * 0.78;

  return (
    <div className={`inline-flex flex-col items-center gap-1 ${className}`}>
      <div
        className="relative flex items-center justify-center rounded-full"
        style={{ width: size, height: size }}
      >
        <div
          className="absolute inset-0 rounded-full border border-[#d1fae5]"
          style={{ ...gradientStyle, borderColor: palette.border }}
        />
        <div
          className="flex items-center justify-center rounded-full bg-white shadow-sm"
          style={{ width: innerSize, height: innerSize }}
        >
          <span className={`text-lg font-black ${palette.textClass}`}>{Math.round(pct)}</span>
        </div>
      </div>
      <span className="text-xs font-semibold uppercase tracking-[0.15em] text-slate-500">{label}</span>
    </div>
  );
}
