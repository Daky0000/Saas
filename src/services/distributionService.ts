const rawApiBaseUrl = (import.meta.env.VITE_API_BASE_URL || '').trim();
const API_BASE_URL = rawApiBaseUrl.includes('api.yourdomain.com')
  ? ''
  : rawApiBaseUrl.replace(/\/$/, '');

function getToken() {
  return localStorage.getItem('auth_token') || '';
}

async function parseApiResponse<T>(res: Response): Promise<T> {
  const text = await res.text();
  try {
    return JSON.parse(text) as T;
  } catch {
    const preview = text.slice(0, 120).replace(/\s+/g, ' ').trim();
    throw new Error(`Invalid server response (${res.status}). ${preview || 'Expected JSON.'}`);
  }
}

export interface ConnectedPlatform {
  id: string;
  name: string;
}

export interface PublishingLog {
  id: string;
  post_id: string;
  post_title?: string;
  user_id: string;
  platform: string;
  status: 'published' | 'failed' | 'pending' | 'scheduled';
  platform_post_id?: string;
  account?: string | null;
  error_message?: string;
  response?: any;
  scheduled_for?: string | null;
  created_at: string;
}

export interface PublishResult {
  platform: string;
  status: string;
  platformPostId?: string;
  error?: string;
}

export const distributionService = {
  async getConnectedPlatforms(): Promise<ConnectedPlatform[]> {
    const res = await fetch(`${API_BASE_URL}/api/distribution/connected`, {
      headers: { Authorization: `Bearer ${getToken()}` },
    });
    const data = await parseApiResponse<any>(res);
    return data.platforms ?? [];
  },

  async publish(postId: string, platforms: string[]): Promise<PublishResult[]> {
    const res = await fetch(`${API_BASE_URL}/api/distribution/publish`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${getToken()}` },
      body: JSON.stringify({ postId, platforms }),
    });
    const data = await parseApiResponse<any>(res);
    if (!data.success) throw new Error(data.error || 'Distribution failed');
    return data.results ?? [];
  },

  async getStatus(postId: string): Promise<PublishingLog[]> {
    const res = await fetch(`${API_BASE_URL}/api/distribution/status/${postId}`, {
      headers: { Authorization: `Bearer ${getToken()}` },
    });
    const data = await parseApiResponse<any>(res);
    return data.logs ?? [];
  },

  async getLogs(): Promise<PublishingLog[]> {
    const res = await fetch(`${API_BASE_URL}/api/automation/logs`, {
      headers: { Authorization: `Bearer ${getToken()}` },
    });
    const data = await parseApiResponse<any>(res);
    return data.logs ?? [];
  },

  async retry(logId: string): Promise<PublishResult> {
    const res = await fetch(`${API_BASE_URL}/api/automation/retry/${logId}`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${getToken()}` },
    });
    const data = await parseApiResponse<any>(res);
    if (!data.success) throw new Error(data.error || 'Retry failed');
    return data.result;
  },
};
