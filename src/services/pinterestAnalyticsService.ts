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

export type PinterestPin = {
  id: string;
  user_id: string;
  social_account_id: string;
  platform_post_id: string;

  impressions: number;
  clicks: number;
  saves: number;
  likes: number;
  comments: number;
  engagement: number;

  posted_at: string | null;
  fetched_at: string;

  account_name: string | null;
  handle: string | null;

  // Enriched from raw pin object
  pin_id: string;
  title: string | null;
  description: string | null;
  link: string | null;
  board_id: string | null;
  creative_type: string | null;
  media_url: string | null;
  pin_clicks: number | null;
  outbound_clicks: number | null;
  saves_count: number | null;
  created_at: string | null;
};

export type PinterestPinsSummary = {
  total_pins: number;
  total_impressions: number;
  total_outbound_clicks: number;
  total_saves: number;
  total_reactions: number;
  total_comments: number;
  total_engagement: number;
  total_pin_clicks: number;
  avg_engagement_rate: number;
};

export type PinterestPinsResponse = {
  success: boolean;
  pins: PinterestPin[];
  total: number;
  summary: PinterestPinsSummary;
  days: number;
};

export type PinterestSyncResult = {
  synced: number;
  errors?: string[];
};

export type PinterestProfileResponse = {
  hasData: boolean;
  followers: number | null;
  following: number | null;
  posts_count: number | null;
  bio: string | null;
  account_name: string | null;
  handle: string | null;
  picture_url: string | null;
  website: string | null;
  monthly_views: number | null;
  synced_at: string | null;
};

export const pinterestAnalyticsService = {
  async sync(): Promise<PinterestSyncResult> {
    const result = await apiFetch<{ success: boolean; synced: number; errors?: string[] }>(
      '/api/social/pinterest/sync',
      { method: 'POST', headers: { 'Content-Type': 'application/json' } }
    );
    return { synced: result.synced, errors: result.errors };
  },

  async getProfile(): Promise<PinterestProfileResponse> {
    return apiFetch('/api/social/pinterest/profile');
  },

  async getPins(
    options: { days?: number; limit?: number; offset?: number; accountId?: string } = {}
  ): Promise<PinterestPinsResponse> {
    const params = new URLSearchParams();
    if (options.days) params.set('days', String(options.days));
    if (options.limit) params.set('limit', String(options.limit));
    if (options.offset) params.set('offset', String(options.offset));
    if (options.accountId) params.set('account_id', options.accountId);
    return apiFetch(`/api/social/pinterest/pins?${params.toString()}`);
  },
};

