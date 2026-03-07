/**
 * WordPress connection and publishing via app backend (credentials never sent to frontend).
 */

const rawApiBaseUrl = (import.meta.env.VITE_API_BASE_URL || '').trim();
const API_BASE_URL = rawApiBaseUrl.includes('api.yourdomain.com')
  ? ''
  : rawApiBaseUrl.replace(/\/$/, '');

const authHeaders = (): Record<string, string> => {
  if (typeof window === 'undefined') return {};
  const token = localStorage.getItem('auth_token');
  return token ? { Authorization: `Bearer ${token}` } : {};
};

export interface WordPressConnectPayload {
  siteUrl: string;
  username: string;
  /** WordPress login password (your account password) */
  password?: string;
  /** Application Password from Users → Profile → Application Passwords (optional) */
  applicationPassword?: string;
}

export interface WordPressStatus {
  connected: boolean;
  siteUrl?: string;
  connectionType?: 'make_webhook' | 'wordpress_api';
}

export interface MakeWebhookPublishPayload {
  title: string;
  content: string;
  excerpt?: string;
  status: 'draft' | 'publish';
  featured_image?: string;
  categories?: string[];
  tags?: string[];
}

export interface WordPressPublishPayload {
  title: string;
  content: string;
  excerpt?: string;
  slug?: string;
  status: 'draft' | 'publish';
  categories?: number[];
  tags?: number[];
  author?: number;
  featuredImageBase64?: string;
  featuredImageFilename?: string;
  seoTitle?: string;
  seoDescription?: string;
  focusKeyword?: string;
}

export interface WpCategory {
  id: number;
  name: string;
  slug: string;
  count?: number;
}

export interface WpTag {
  id: number;
  name: string;
  slug: string;
  count?: number;
}

export const wordpressService = {
  async connect(payload: WordPressConnectPayload): Promise<{ success: boolean; message?: string; error?: string }> {
    const res = await fetch(`${API_BASE_URL}/api/wordpress/connect`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...authHeaders() },
      body: JSON.stringify({
        siteUrl: payload.siteUrl.trim(),
        username: payload.username.trim(),
        password: payload.password || undefined,
        applicationPassword: payload.applicationPassword || undefined,
      }),
    });
    const data = await res.json();
    if (!res.ok) {
      return { success: false, error: data.error || 'Connection failed' };
    }
    return { success: true, message: data.message };
  },

  async getStatus(): Promise<{ success: boolean; connected?: boolean; siteUrl?: string; connectionType?: 'make_webhook' | 'wordpress_api'; error?: string }> {
    const res = await fetch(`${API_BASE_URL}/api/wordpress/status`, {
      headers: authHeaders(),
    });
    const data = await res.json();
    if (!res.ok) {
      return { success: false, error: data.error || 'Failed to get status' };
    }
    return {
      success: true,
      connected: data.connected,
      siteUrl: data.siteUrl,
      connectionType: data.connectionType,
    };
  },

  async connectWebhook(webhookUrl: string): Promise<{ success: boolean; message?: string; error?: string }> {
    const res = await fetch(`${API_BASE_URL}/api/wordpress/connect-webhook`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...authHeaders() },
      body: JSON.stringify({ webhookUrl: webhookUrl.trim() }),
    });
    const data = await res.json();
    if (!res.ok) {
      return { success: false, error: data.error || 'Connection failed' };
    }
    return { success: true, message: data.message };
  },

  async publishViaWebhook(payload: MakeWebhookPublishPayload): Promise<{ success: boolean; message?: string; error?: string }> {
    const res = await fetch(`${API_BASE_URL}/api/wordpress/publish-webhook`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...authHeaders() },
      body: JSON.stringify(payload),
    });
    const data = await res.json();
    if (!res.ok) {
      return { success: false, error: data.error || 'Failed to publish to WordPress.' };
    }
    return { success: true, message: data.message || 'Post sent to WordPress successfully.' };
  },

  async disconnect(): Promise<{ success: boolean; error?: string }> {
    const res = await fetch(`${API_BASE_URL}/api/wordpress/disconnect`, {
      method: 'DELETE',
      headers: authHeaders(),
    });
    const data = await res.json();
    if (!res.ok) {
      return { success: false, error: data.error || 'Failed to disconnect' };
    }
    return { success: true };
  },

  async getCategories(): Promise<{ success: boolean; data?: WpCategory[]; error?: string }> {
    const res = await fetch(`${API_BASE_URL}/api/wordpress/categories`, {
      headers: authHeaders(),
    });
    const data = await res.json();
    if (!res.ok) {
      return { success: false, error: data.error || 'Failed to fetch categories' };
    }
    return { success: true, data: data.data || [] };
  },

  async getTags(): Promise<{ success: boolean; data?: WpTag[]; error?: string }> {
    const res = await fetch(`${API_BASE_URL}/api/wordpress/tags`, {
      headers: authHeaders(),
    });
    const data = await res.json();
    if (!res.ok) {
      return { success: false, error: data.error || 'Failed to fetch tags' };
    }
    return { success: true, data: data.data || [] };
  },

  async publish(payload: WordPressPublishPayload): Promise<{ success: boolean; message?: string; data?: { postId: number; link?: string; status: string }; error?: string }> {
    const res = await fetch(`${API_BASE_URL}/api/wordpress/publish`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...authHeaders() },
      body: JSON.stringify(payload),
    });
    const data = await res.json();
    if (!res.ok) {
      return { success: false, error: data.error || 'Failed to publish' };
    }
    return { success: true, message: data.message, data: data.data };
  },
};
