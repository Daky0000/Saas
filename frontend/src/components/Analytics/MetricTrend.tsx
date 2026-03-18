import React from "react";

type Props = {
  value: number;
  percentageChange: number;
  label: string;
};

export const MetricTrend: React.FC<Props> = ({
  value,
  percentageChange,
  label,
}) => {
  const color =
    percentageChange > 0
      ? "text-emerald-300"
      : percentageChange < 0
        ? "text-red-300"
        : "text-slate-400";
  const symbol = percentageChange > 0 ? "↑" : percentageChange < 0 ? "↓" : "–";

  return (
    <div className="rounded-2xl border border-slate-800 bg-slate-900/60 p-4">
      <p className="text-xs uppercase tracking-[0.3em] text-slate-500">
        {label}
      </p>
      <div className="mt-2 flex items-end justify-between">
        <p className="text-xl font-semibold text-slate-100">
          {value.toLocaleString()}
        </p>
        <span className={`text-xs font-semibold ${color}`}>
          {symbol} {percentageChange.toFixed(1)}%
        </span>
      </div>
    </div>
  );
};
