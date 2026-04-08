import { API_BASE_URL } from '../utils/apiBase';

function getToken() {
  return localStorage.getItem('auth_token') || '';
}

function authHeaders() {
  return { Authorization: `Bearer ${getToken()}` };
}

async function apiFetch<T>(path: string, options?: RequestInit): Promise<T> {
  const res = await fetch(`${API_BASE_URL}${path}`, {
    ...options,
    headers: { ...authHeaders(), ...(options?.headers || {}) },
  });
  const text = await res.text();
  let json: any;
  try {
    json = JSON.parse(text);
  } catch {
    throw new Error('Invalid server response');
  }
  if (!res.ok) throw new Error(json?.error || json?.message || 'Request failed');
  return json as T;
}

export type ThreadsPost = {
  id: string;
  user_id: string;
  social_account_id: string;
  platform_post_id: string;

  impressions: number;
  reach: number;
  likes: number;
  comments: number;
  shares: number;
  engagement: number;

  posted_at: string | null;
  fetched_at: string;

  account_name: string | null;
  handle: string | null;

  // Enriched from raw thread object (stored in social_metrics.raw_data)
  thread_id: string;
  text: string | null;
  permalink: string | null;
  username: string | null;
  media_type: string | null;
  media_url: string | null;
  thumbnail_url: string | null;
  link_attachment_url: string | null;
  is_quote_post: boolean;
  has_replies: boolean;

  // Convenience analytics fields
  views: number;
  replies: number;
  reposts: number;
  quotes: number;
};

export type ThreadsPostsSummary = {
  total_posts: number;
  total_views: number;
  total_likes: number;
  total_replies: number;
  total_reposts: number;
  total_quotes: number;
  total_shares: number;
  total_engagement: number;
  avg_engagement_rate: number;
};

export type ThreadsPostsResponse = {
  success: boolean;
  posts: ThreadsPost[];
  total: number;
  summary: ThreadsPostsSummary;
  days: number;
};

export type ThreadsSyncResult = {
  synced: number;
  errors?: string[];
};

export type ThreadsProfileResponse = {
  hasData: boolean;
  followers: number | null;
  posts_count: number | null;
  total_likes: number | null;
  bio: string | null;
  is_verified: boolean | null;
  account_name: string | null;
  handle: string | null;
  picture_url: string | null;
  synced_at: string | null;
};

export const threadsAnalyticsService = {
  async sync(): Promise<ThreadsSyncResult> {
    const result = await apiFetch<{ success: boolean; synced: number; errors?: string[] }>(
      '/api/social/threads/sync',
      { method: 'POST', headers: { 'Content-Type': 'application/json' } }
    );
    return { synced: result.synced, errors: result.errors };
  },

  async getProfile(): Promise<ThreadsProfileResponse> {
    return apiFetch('/api/social/threads/profile');
  },

  async getPosts(options: { days?: number; limit?: number; offset?: number; accountId?: string } = {}): Promise<ThreadsPostsResponse> {
    const params = new URLSearchParams();
    if (options.days) params.set('days', String(options.days));
    if (options.limit) params.set('limit', String(options.limit));
    if (options.offset) params.set('offset', String(options.offset));
    if (options.accountId) params.set('account_id', options.accountId);
    return apiFetch(`/api/social/threads/posts?${params.toString()}`);
  },
};

