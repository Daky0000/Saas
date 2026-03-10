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
  const gradientStyle: CSSProperties = {
    background: `conic-gradient(#34d399 ${pct}%, #d1fae5 ${pct}%)`,
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
          style={gradientStyle}
        />
        <div
          className="flex items-center justify-center rounded-full bg-white shadow-sm"
          style={{ width: innerSize, height: innerSize }}
        >
          <span className="text-lg font-black text-emerald-600">{Math.round(pct)}</span>
        </div>
      </div>
      <span className="text-xs font-semibold uppercase tracking-[0.15em] text-slate-500">{label}</span>
    </div>
  );
}
