import React, { useMemo, useState } from "react";
import { usePosts } from "../../hooks/usePosts";
import { useIntegrations } from "../../hooks/useIntegrations";
import { PlatformSelector } from "./PlatformSelector";
import { ScheduleSelector } from "./ScheduleSelector";
import { PostPreview } from "./PostPreview";

export const PostCreator: React.FC = () => {
  const { createPostWithIntegrations } = usePosts();
  const { myIntegrations } = useIntegrations();
  const [title, setTitle] = useState("");
  const [content, setContent] = useState("");
  const [selected, setSelected] = useState<string[]>([]);
  const [mode, setMode] = useState<"now" | "schedule">("now");
  const [scheduledAt, setScheduledAt] = useState<string>("");
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const toggleAccount = (id: string) => {
    setSelected((prev) =>
      prev.includes(id) ? prev.filter((item) => item !== id) : [...prev, id]
    );
  };

  const selectedCount = useMemo(() => selected.length, [selected]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    if (!selectedCount) {
      setError("Select at least one integration.");
      return;
    }


    if (mode === "schedule" && !scheduledAt) {
      setError("Pick a schedule time.");
      return;
    }

    setIsLoading(true);
    try {
      await createPostWithIntegrations({
        title,
        content,
        integrationIds: selected,
        scheduledAt: mode === "schedule" ? scheduledAt : null,
      });
      setTitle("");
      setContent("");
      setSelected([]);
      setScheduledAt("");
    } catch (err: any) {
      setError(err.response?.data?.error || "Failed to create post");
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="grid gap-6 lg:grid-cols-[1.1fr_0.9fr]">
      <form
        onSubmit={handleSubmit}
        className="space-y-4 rounded-2xl border border-slate-800 bg-slate-900/60 p-6"
      >
        <div>
          <label className="text-xs uppercase tracking-[0.3em] text-slate-500">
            Title
          </label>
          <input
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            className="mt-2 w-full rounded-lg border border-slate-700 bg-slate-950/40 px-4 py-2 text-slate-100 placeholder:text-slate-500 focus:border-slate-500 focus:outline-none"
            placeholder="Campaign launch update"
            required
          />
        </div>
        <div>
          <label className="text-xs uppercase tracking-[0.3em] text-slate-500">
            Content
          </label>
          <textarea
            value={content}
            onChange={(e) => setContent(e.target.value)}
            className="mt-2 min-h-[160px] w-full rounded-lg border border-slate-700 bg-slate-950/40 px-4 py-3 text-slate-100 placeholder:text-slate-500 focus:border-slate-500 focus:outline-none"
            placeholder="Share the story behind your campaign..."
            required
          />
        </div>

        <PlatformSelector
          integrations={myIntegrations}
          selected={selected}
          onToggle={toggleAccount}
          onSelectAll={() =>
            setSelected(myIntegrations.map((integration) => integration.id))
          }
        />

        <ScheduleSelector
          mode={mode}
          scheduledAt={scheduledAt}
          onModeChange={setMode}
          onScheduledAtChange={setScheduledAt}
        />

        {error && (
          <div className="rounded-lg border border-red-500/40 bg-red-500/10 p-3 text-sm text-red-200">
            {error}
          </div>
        )}

        <button
          type="submit"
          disabled={isLoading}
          className="w-full rounded-lg bg-indigo-500 py-2 text-sm font-semibold text-white transition hover:bg-indigo-400 disabled:cursor-not-allowed disabled:opacity-60"
        >
          {isLoading ? "Creating..." : "Create Post"}
        </button>
      </form>

      <div className="space-y-4 rounded-2xl border border-slate-800 bg-slate-900/60 p-6">
        <p className="text-sm font-semibold">Preview</p>
        <PostPreview
          content={content}
          selected={selected}
          integrations={myIntegrations}
        />
      </div>
    </div>
  );
};
