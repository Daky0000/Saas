import React from "react";
import { StatusBadge } from "../Common/StatusBadge";
import { Post } from "../../hooks/usePosts";

interface PostQueueProps {
  posts: Post[];
  onRetry?: (id: string) => void;
}

export const PostQueue: React.FC<PostQueueProps> = ({ posts, onRetry }) => {
  if (!posts.length) {
    return (
      <div className="rounded-lg border border-slate-800 bg-slate-950/40 p-4 text-sm text-slate-400">
        No posts yet.
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {posts.map((post) => (
        <div
          key={post.id}
          className="flex flex-col gap-2 rounded-lg border border-slate-800 bg-slate-950/40 p-4"
        >
          <div className="flex items-center justify-between">
            <p className="text-sm font-semibold">{post.title}</p>
            <StatusBadge status={post.status} />
          </div>
          <p className="text-xs text-slate-400">
            {post.scheduledAt
              ? `Scheduled: ${new Date(post.scheduledAt).toLocaleString()}`
              : `Created: ${new Date(post.createdAt).toLocaleString()}`}
          </p>
          {post.status === "FAILED" && onRetry && (
            <button
              onClick={() => onRetry(post.id)}
              className="self-start rounded-lg border border-red-400/40 px-3 py-1 text-xs text-red-200"
            >
              Retry
            </button>
          )}
        </div>
      ))}
    </div>
  );
};
