import React, { useState } from "react";
import { useNavigate } from "react-router-dom";
import { useAuthStore } from "../store/authStore";

export const SignupPage: React.FC = () => {
  const navigate = useNavigate();
  const signup = useAuthStore((state) => state.signup);
  const isLoading = useAuthStore((state) => state.isLoading);

  const [formData, setFormData] = useState({
    email: "",
    username: "",
    password: "",
    agencyName: "",
  });
  const [error, setError] = useState("");

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setFormData({
      ...formData,
      [e.target.name]: e.target.value,
    });
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");

    try {
      await signup(
        formData.email,
        formData.password,
        formData.agencyName,
        formData.username || undefined
      );
      navigate("/dashboard");
    } catch (err: any) {
      setError(err.response?.data?.error || "Signup failed");
    }
  };

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100">
      <div className="mx-auto flex min-h-screen max-w-5xl items-center px-6">
        <div className="grid w-full gap-10 lg:grid-cols-[1.1fr_0.9fr]">
          <div className="space-y-4">
            <p className="text-xs uppercase tracking-[0.4em] text-slate-500">
              Week 5 ? Authentication
            </p>
            <h1 className="text-3xl font-semibold sm:text-4xl">
              Create your agency workspace in minutes.
            </h1>
            <p className="text-base text-slate-300">
              Keep campaigns moving with a shared content pipeline, approvals,
              and social integrations ready to connect.
            </p>
          </div>

          <div className="rounded-2xl border border-slate-800 bg-slate-900/60 p-8 shadow-xl">
            <h2 className="text-2xl font-semibold">Sign Up</h2>
            <p className="mt-2 text-sm text-slate-400">
              Use your work email to get started.
            </p>

            {error && (
              <div className="mt-4 rounded-lg border border-red-500/40 bg-red-500/10 p-3 text-sm text-red-200">
                {error}
              </div>
            )}

            <form onSubmit={handleSubmit} className="mt-6 space-y-4">
              <input
                type="text"
                name="agencyName"
                placeholder="Agency Name"
                value={formData.agencyName}
                onChange={handleChange}
                className="w-full rounded-lg border border-slate-700 bg-slate-950/40 px-4 py-2 text-slate-100 placeholder:text-slate-500 focus:border-slate-500 focus:outline-none"
                required
              />
              <input
                type="text"
                name="username"
                placeholder="Username (optional)"
                value={formData.username}
                onChange={handleChange}
                className="w-full rounded-lg border border-slate-700 bg-slate-950/40 px-4 py-2 text-slate-100 placeholder:text-slate-500 focus:border-slate-500 focus:outline-none"
              />
              <input
                type="email"
                name="email"
                placeholder="Email"
                value={formData.email}
                onChange={handleChange}
                className="w-full rounded-lg border border-slate-700 bg-slate-950/40 px-4 py-2 text-slate-100 placeholder:text-slate-500 focus:border-slate-500 focus:outline-none"
                required
              />
              <input
                type="password"
                name="password"
                placeholder="Password"
                value={formData.password}
                onChange={handleChange}
                className="w-full rounded-lg border border-slate-700 bg-slate-950/40 px-4 py-2 text-slate-100 placeholder:text-slate-500 focus:border-slate-500 focus:outline-none"
                required
              />
              <button
                type="submit"
                disabled={isLoading}
                className="w-full rounded-lg bg-indigo-500 py-2 text-sm font-semibold text-white transition hover:bg-indigo-400 disabled:cursor-not-allowed disabled:opacity-60"
              >
                {isLoading ? "Loading..." : "Sign Up"}
              </button>
            </form>

            <p className="mt-4 text-center text-sm text-slate-400">
              Already have an account?{" "}
              <a href="/login" className="text-indigo-300 hover:underline">
                Login
              </a>
            </p>
          </div>
        </div>
      </div>
    </div>
  );
};
