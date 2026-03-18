import React, { useMemo, useState } from "react";

type PostRow = {
  id: string;
  title: string;
  platforms: string[];
  engagement: number;
  reach: number;
  postedAt: string;
};

type Props = {
  posts: PostRow[];
  onView?: (id: string) => void;
};

const platformBadge = (platform: string) =>
  platform.slice(0, 2).toUpperCase();

export const TopPostsTable: React.FC<Props> = ({ posts, onView }) => {
  const [sortKey, setSortKey] = useState<"engagement" | "reach" | "date">(
    "engagement"
  );
  const [sortDir, setSortDir] = useState<"asc" | "desc">("desc");

  const sorted = useMemo(() => {
    const data = [...posts];
    data.sort((a, b) => {
      const delta =
        sortKey === "reach"
          ? a.reach - b.reach
          : sortKey === "date"
            ? new Date(a.postedAt).getTime() -
              new Date(b.postedAt).getTime()
            : a.engagement - b.engagement;
      return sortDir === "asc" ? delta : -delta;
    });
    return data;
  }, [posts, sortKey, sortDir]);

  const toggleSort = (key: typeof sortKey) => {
    if (sortKey === key) {
      setSortDir(sortDir === "asc" ? "desc" : "asc");
    } else {
      setSortKey(key);
      setSortDir("desc");
    }
  };

  if (!posts.length) {
    return (
      <div className="rounded-2xl border border-slate-800 bg-slate-900/60 p-5 text-sm text-slate-400">
        No posts available.
      </div>
    );
  }

  return (
    <div className="overflow-x-auto rounded-2xl border border-slate-800 bg-slate-900/60 p-5">
      <table className="min-w-full text-left text-xs text-slate-300">
        <thead>
          <tr className="border-b border-slate-800 text-slate-500">
            <th className="py-2 pr-4">Title</th>
            <th className="py-2 pr-4">Platforms</th>
            <th
              className="py-2 pr-4 cursor-pointer"
              onClick={() => toggleSort("engagement")}
            >
              Engagement
            </th>
            <th
              className="py-2 pr-4 cursor-pointer"
              onClick={() => toggleSort("reach")}
            >
              Reach
            </th>
            <th
              className="py-2 pr-4 cursor-pointer hidden md:table-cell"
              onClick={() => toggleSort("date")}
            >
              Posted
            </th>
            <th className="py-2">Actions</th>
          </tr>
        </thead>
        <tbody>
          {sorted.map((post, index) => (
            <tr
              key={post.id}
              className={`border-b border-slate-900 ${
                index === 0 ? "bg-indigo-500/10" : ""
              }`}
            >
              <td className="py-3 pr-4 font-semibold text-slate-100">
                {post.title.length > 40
                  ? `${post.title.slice(0, 40)}...`
                  : post.title}
              </td>
              <td className="py-3 pr-4">
                <div className="flex flex-wrap gap-2">
                  {post.platforms.map((platform) => (
                    <span
                      key={`${post.id}-${platform}`}
                      className="rounded-full bg-slate-800 px-2 py-1 text-[10px] text-slate-200"
                    >
                      {platformBadge(platform)}
                    </span>
                  ))}
                </div>
              </td>
              <td className="py-3 pr-4">{post.engagement}</td>
              <td className="py-3 pr-4">{post.reach}</td>
              <td className="py-3 pr-4 hidden md:table-cell">
                {new Date(post.postedAt).toLocaleDateString()}
              </td>
              <td className="py-3">
                <button
                  type="button"
                  onClick={() => onView?.(post.id)}
                  className="rounded-lg border border-slate-700 px-3 py-1 text-xs text-slate-200"
                >
                  View
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
};
