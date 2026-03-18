import React from "react";

export const AnalyticsPage: React.FC = () => {
  return (
    <div className="min-h-screen bg-slate-950 text-slate-100">
      <div className="mx-auto max-w-5xl px-6 py-16">
        <div className="rounded-2xl border border-slate-800 bg-slate-900/60 p-8">
          <p className="text-xs uppercase tracking-[0.4em] text-slate-500">
            Analytics
          </p>
          <h1 className="mt-3 text-3xl font-semibold sm:text-4xl">
            Insights are loading in the next sprint.
          </h1>
          <p className="mt-2 text-base text-slate-300">
            Connect platforms to start pulling engagement metrics.
          </p>
        </div>
      </div>
    </div>
  );
};
