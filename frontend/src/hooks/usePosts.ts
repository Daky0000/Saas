import { useCallback, useEffect, useState } from "react";
import api from "../utils/api";

export interface Post {
  id: string;
  title: string;
  content: unknown;
  status: string;
  scheduledAt?: string | null;
  createdAt: string;
}

export const usePosts = () => {
  const [posts, setPosts] = useState<Post[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchPosts = useCallback(async () => {
    setIsLoading(true);
    try {
      const response = await api.get("/posts");
      setPosts(response.data || []);
      setError(null);
    } catch (err: any) {
      setError(err.response?.data?.error || "Failed to load posts");
    } finally {
      setIsLoading(false);
    }
  }, []);

  const createPostWithIntegrations = useCallback(
    async (payload: {
      title: string;
      content: string;
      integrationIds: string[];
      scheduledAt?: string | null;
    }) => {
      const response = await api.post("/posts", payload);
      await fetchPosts();
      return response.data;
    },
    [fetchPosts]
  );

  const getPendingPosts = useCallback(async () => {
    const response = await api.get("/posts/pending");
    setPosts(response.data || []);
  }, []);

  const getPostedPosts = useCallback(async () => {
    const response = await api.get("/posts/posted");
    setPosts(response.data || []);
  }, []);

  const getFailedPosts = useCallback(async () => {
    const response = await api.get("/posts/failed");
    setPosts(response.data || []);
  }, []);

  const retryFailedPost = useCallback(async (postId: string) => {
    await api.post(`/automation/posts/${postId}/retry`);
  }, []);

  const reschedulePost = useCallback(async (postId: string, newTime: string) => {
    await api.post(`/automation/posts/${postId}/schedule`, {
      scheduledAt: newTime,
    });
    await fetchPosts();
  }, [fetchPosts]);

  useEffect(() => {
    fetchPosts();
  }, [fetchPosts]);

  return {
    posts,
    isLoading,
    error,
    fetchPosts,
    createPostWithIntegrations,
    getPendingPosts,
    getPostedPosts,
    getFailedPosts,
    retryFailedPost,
    reschedulePost,
  };
};
