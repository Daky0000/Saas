import { useCallback, useState } from "react";
import api from "../utils/api";

export type PlatformStatus = {
  platform: string;
  accountName?: string | null;
  status: string;
  platformPostId?: string | null;
  postedAt?: string | null;
  error?: string | null;
};

export type Post = {
  id: string;
  title: string;
  content: any;
  status: string;
  scheduledAt?: string | null;
  postedAt?: string | null;
  createdAt?: string;
  platformStatuses?: PlatformStatus[];
  analytics?: any;
};

const getErrorMessage = (error: any) =>
  error?.response?.data?.error || error?.message || "Something went wrong";

export const usePosts = () => {
  const [posts, setPosts] = useState<Post[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const run = useCallback(async <T,>(fn: () => Promise<T>) => {
    setLoading(true);
    setError(null);
    try {
      return await fn();
    } catch (err: any) {
      const message = getErrorMessage(err);
      setError(message);
      throw err;
    } finally {
      setLoading(false);
    }
  }, []);

  const createPostWithIntegrations = useCallback(
    async (
      title: string,
      content: string,
      integrationIds: string[],
      scheduledAt?: Date
    ) => {
      const payload = {
        title,
        content,
        integrationIds,
        scheduledAt: scheduledAt ? scheduledAt.toISOString() : undefined,
      };
      const data = await run(async () => {
        const response = await api.post<Post>("/posts", payload);
        return response.data;
      });
      setPosts((prev) => [data, ...prev]);
      return data;
    },
    [run]
  );

  const getPosts = useCallback(
    async (filters?: { status?: string; limit?: number; offset?: number }) => {
      const data = await run(async () => {
        const response = await api.get<Post[]>("/posts", {
          params: filters,
        });
        return response.data;
      });
      setPosts(data);
      return data;
    },
    [run]
  );

  const getPendingPosts = useCallback(() => {
    return getPosts({ status: "SCHEDULED" });
  }, [getPosts]);

  const getPostedPosts = useCallback(() => {
    return getPosts({ status: "POSTED" });
  }, [getPosts]);

  const getFailedPosts = useCallback(() => {
    return getPosts({ status: "FAILED" });
  }, [getPosts]);

  const getPostStatus = useCallback(
    async (postId: string) => {
      const data = await run(async () => {
        const response = await api.get<Post>(`/posts/${postId}/status`);
        return response.data as any;
      });
      setPosts((prev) =>
        prev.map((post) => (post.id === postId ? { ...post, ...data } : post))
      );
      return data;
    },
    [run]
  );

  const postNow = useCallback(
    async (postId: string) => {
      const data = await run(async () => {
        const response = await api.post(`/posts/${postId}/post-now`);
        return response.data;
      });
      setPosts((prev) =>
        prev.map((post) =>
          post.id === postId
            ? { ...post, status: "APPROVED", scheduledAt: null }
            : post
        )
      );
      return data;
    },
    [run]
  );

  const cancelPost = useCallback(
    async (postId: string) => {
      const data = await run(async () => {
        const response = await api.post(`/posts/${postId}/cancel`);
        return response.data;
      });
      setPosts((prev) =>
        prev.map((post) =>
          post.id === postId
            ? { ...post, status: "APPROVED", scheduledAt: null }
            : post
        )
      );
      return data;
    },
    [run]
  );

  const retryPost = useCallback(
    async (postId: string) => {
      const data = await run(async () => {
        const response = await api.post(`/posts/${postId}/retry`);
        return response.data;
      });
      setPosts((prev) =>
        prev.map((post) =>
          post.id === postId ? { ...post, status: "APPROVED" } : post
        )
      );
      return data;
    },
    [run]
  );

  const reschedulePost = useCallback(
    async (postId: string, newTime: Date) => {
      const data = await run(async () => {
        const response = await api.post(`/posts/${postId}/schedule`, {
          scheduledAt: newTime.toISOString(),
        });
        return response.data;
      });
      setPosts((prev) =>
        prev.map((post) =>
          post.id === postId
            ? { ...post, status: "SCHEDULED", scheduledAt: newTime.toISOString() }
            : post
        )
      );
      return data;
    },
    [run]
  );

  const deletePost = useCallback(
    async (postId: string) => {
      const data = await run(async () => {
        const response = await api.delete(`/posts/${postId}`);
        return response.data;
      });
      setPosts((prev) => prev.filter((post) => post.id !== postId));
      return data;
    },
    [run]
  );

  return {
    posts,
    loading,
    error,
    createPostWithIntegrations,
    getPosts,
    getPendingPosts,
    getPostedPosts,
    getFailedPosts,
    getPostStatus,
    postNow,
    cancelPost,
    retryPost,
    reschedulePost,
    deletePost,
  };
};
