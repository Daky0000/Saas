import React, { useMemo, useState } from "react";
import { PostCreator } from "../components/Posts/PostCreator";
import { PostQueue } from "../components/Posts/PostQueue";
import { usePosts } from "../hooks/usePosts";

const tabs = ["create", "scheduled", "posted", "failed"] as const;

export const PostsPage: React.FC = () => {
  const [activeTab, setActiveTab] = useState<(typeof tabs)[number]>("create");
  const { posts, retryFailedPost } = usePosts();

  const filteredPosts = useMemo(() => {
    if (activeTab === "scheduled") {
      return posts.filter((post) => post.status === "SCHEDULED");
    }
    if (activeTab === "posted") {
      return posts.filter((post) => post.status === "POSTED");
    }
    if (activeTab === "failed") {
      return posts.filter((post) => post.status === "FAILED");
    }
    return posts;
  }, [activeTab, posts]);

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100">
      <div className="mx-auto max-w-6xl px-6 py-16">
        <div className="flex flex-col gap-8">
          <div>
            <p className="text-xs uppercase tracking-[0.4em] text-slate-500">
              Posts
            </p>
            <h1 className="mt-3 text-3xl font-semibold sm:text-4xl">
              Create, schedule, and monitor every post.
            </h1>
            <p className="mt-2 text-base text-slate-300">
              Build a publishing queue that stays aligned across platforms.
            </p>
          </div>

          <div className="grid gap-8 lg:grid-cols-[0.25fr_0.75fr]">
            <div className="space-y-3 rounded-2xl border border-slate-800 bg-slate-900/60 p-4">
              {tabs.map((tab) => (
                <button
                  key={tab}
                  onClick={() => setActiveTab(tab)}
                  className={`w-full rounded-lg px-3 py-2 text-left text-sm transition ${
                    activeTab === tab
                      ? "bg-indigo-500/20 text-indigo-200"
                      : "text-slate-300 hover:bg-slate-800/60"
                  }`}
                >
                  {tab === "create" && "Create"}
                  {tab === "scheduled" && "Scheduled"}
                  {tab === "posted" && "Posted"}
                  {tab === "failed" && "Failed"}
                </button>
              ))}
            </div>

            <div className="space-y-6">
              {activeTab === "create" ? (
                <PostCreator />
              ) : (
                <PostQueue posts={filteredPosts} onRetry={retryFailedPost} />
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
