import React from "react";

const statusStyles: Record<string, string> = {
  PENDING: "bg-yellow-500/10 text-yellow-200 border-yellow-400/40",
  QUEUED: "bg-blue-500/10 text-blue-200 border-blue-400/40",
  SCHEDULED: "bg-purple-500/10 text-purple-200 border-purple-400/40",
  POSTED: "bg-emerald-500/10 text-emerald-200 border-emerald-400/40",
  FAILED: "bg-red-500/10 text-red-200 border-red-400/40",
  DRAFT: "bg-slate-700/40 text-slate-200 border-slate-600/40",
};

export const StatusBadge: React.FC<{ status: string }> = ({ status }) => {
  const style = statusStyles[status] || statusStyles.DRAFT;
  return (
    <span
      className={`rounded-full border px-3 py-1 text-xs font-semibold ${style}`}
    >
      {status}
    </span>
  );
};
