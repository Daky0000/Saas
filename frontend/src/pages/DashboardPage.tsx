import React from "react";
import { Link } from "react-router-dom";
import { useAuthStore } from "../store/authStore";

export const DashboardPage: React.FC = () => {
  const user = useAuthStore((state) => state.user);
  const logout = useAuthStore((state) => state.logout);

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100">
      <div className="mx-auto max-w-5xl px-6 py-16">
        <div className="flex flex-col gap-4 rounded-2xl border border-slate-800 bg-slate-900/60 p-8">
          <p className="text-xs uppercase tracking-[0.4em] text-slate-500">
            Dashboard
          </p>
          <h1 className="text-3xl font-semibold sm:text-4xl">
            Welcome back{user?.email ? `, ${user.email}` : ""}.
          </h1>
          <p className="text-base text-slate-300">
            Your workspace is ready for approvals, scheduled posts, and
            integrations.
          </p>
          <div className="flex flex-wrap gap-3 text-sm text-slate-300">
            <span className="rounded-full border border-slate-700 px-3 py-1">
              OAuth Connections
            </span>
            <span className="rounded-full border border-slate-700 px-3 py-1">
              Approval Flow
            </span>
            <span className="rounded-full border border-slate-700 px-3 py-1">
              Analytics Snapshot
            </span>
          </div>
          <div className="flex flex-wrap gap-3">
            <Link
              to="/posts"
              className="mt-6 rounded-lg bg-indigo-500 px-4 py-2 text-sm font-semibold text-white transition hover:bg-indigo-400"
            >
              Open Posts
            </Link>
            <Link
              to="/integrations"
              className="mt-6 rounded-lg border border-slate-700 px-4 py-2 text-sm text-slate-200 transition hover:border-slate-500"
            >
              Manage Integrations
            </Link>
            <button
              onClick={logout}
              className="mt-6 rounded-lg border border-slate-700 px-4 py-2 text-sm text-slate-200 transition hover:border-slate-500"
            >
              Log out
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
