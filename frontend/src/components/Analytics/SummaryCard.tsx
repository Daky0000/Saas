import React from "react";

type Props = {
  title: string;
  value: number;
  trend: number;
  icon: React.ReactNode;
  unit?: string;
};

const formatTrend = (trend: number) => {
  if (trend === 0) return "0%";
  return `${trend > 0 ? "+" : ""}${trend.toFixed(1)}%`;
};

export const SummaryCard: React.FC<Props> = ({
  title,
  value,
  trend,
  icon,
  unit,
}) => {
  const trendColor = trend > 0 ? "text-emerald-300" : trend < 0 ? "text-red-300" : "text-slate-400";
  const trendSymbol = trend > 0 ? "↑" : trend < 0 ? "↓" : "–";

  return (
    <div className="rounded-2xl border border-slate-800 bg-slate-900/60 p-5 shadow-sm">
      <div className="flex items-center justify-between">
        <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-slate-800 text-slate-200">
          {icon}
        </div>
        <span className={`text-xs font-semibold ${trendColor}`}>
          {trendSymbol} {formatTrend(trend)}
        </span>
      </div>
      <p className="mt-4 text-xs uppercase tracking-[0.3em] text-slate-500">
        {title}
      </p>
      <p className="mt-2 text-2xl font-semibold text-slate-100">
        {value.toLocaleString()}
        {unit ? <span className="text-sm text-slate-400"> {unit}</span> : null}
      </p>
    </div>
  );
};
