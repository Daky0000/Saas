import { ApiResponse } from '../types/oauth';

type WordPressStatus = {
  connected: boolean;
  siteUrl?: string;
  username?: string;
  userId?: number | null;
  displayName?: string | null;
  connectedAt?: string;
  updatedAt?: string;
};

type WordPressTerm = {
  id: number;
  name: string;
  slug: string;
};

type WordPressConnectInput = {
  siteUrl: string;
  username: string;
  appPassword: string;
};

type FeaturedImagePayload = {
  fileName: string;
  mimeType: string;
  dataBase64: string;
};

type WordPressPublishInput = {
  title: string;
  content: string;
  excerpt?: string;
  slug?: string;
  status: 'draft' | 'publish';
  categories?: number[];
  tags?: number[];
  author?: number;
  seoTitle?: string;
  seoDescription?: string;
  focusKeyword?: string;
  featuredImage?: FeaturedImagePayload;
};

const rawApiBaseUrl = (import.meta.env.VITE_API_BASE_URL || '').trim();
const API_BASE_URL = rawApiBaseUrl.includes('api.yourdomain.com')
  ? ''
  : rawApiBaseUrl.replace(/\/$/, '');

const authHeaders = () => {
  const token = localStorage.getItem('auth_token');
  return token ? { Authorization: `Bearer ${token}` } : {};
};

async function parseResponse<T>(response: Response): Promise<ApiResponse<T>> {
  let payload: ApiResponse<T>;
  try {
    payload = (await response.json()) as ApiResponse<T>;
  } catch {
    payload = { success: false, error: 'Invalid server response' };
  }

  if (!response.ok && payload.success) {
    return { success: false, error: 'Request failed' };
  }
  return payload;
}

export const wordpressService = {
  async connect(input: WordPressConnectInput): Promise<ApiResponse<WordPressStatus>> {
    try {
      const response = await fetch(`${API_BASE_URL}/api/wordpress/connect`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...authHeaders(),
        },
        body: JSON.stringify(input),
      });

      return parseResponse<WordPressStatus>(response);
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to connect WordPress',
      };
    }
  },

  async getStatus(): Promise<ApiResponse<WordPressStatus>> {
    try {
      const response = await fetch(`${API_BASE_URL}/api/wordpress/status`, {
        method: 'GET',
        headers: {
          ...authHeaders(),
        },
      });
      return parseResponse<WordPressStatus>(response);
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to fetch WordPress status',
      };
    }
  },

  async disconnect(): Promise<ApiResponse<void>> {
    try {
      const response = await fetch(`${API_BASE_URL}/api/wordpress/disconnect`, {
        method: 'DELETE',
        headers: {
          ...authHeaders(),
        },
      });
      return parseResponse<void>(response);
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to disconnect WordPress',
      };
    }
  },

  async getCategories(): Promise<ApiResponse<WordPressTerm[]>> {
    try {
      const response = await fetch(`${API_BASE_URL}/api/wordpress/categories`, {
        method: 'GET',
        headers: {
          ...authHeaders(),
        },
      });
      return parseResponse<WordPressTerm[]>(response);
    } catch (error) {
      return {
        success: false,
        data: [],
        error: error instanceof Error ? error.message : 'Failed to fetch categories',
      };
    }
  },

  async getTags(): Promise<ApiResponse<WordPressTerm[]>> {
    try {
      const response = await fetch(`${API_BASE_URL}/api/wordpress/tags`, {
        method: 'GET',
        headers: {
          ...authHeaders(),
        },
      });
      return parseResponse<WordPressTerm[]>(response);
    } catch (error) {
      return {
        success: false,
        data: [],
        error: error instanceof Error ? error.message : 'Failed to fetch tags',
      };
    }
  },

  async publishPost(input: WordPressPublishInput): Promise<ApiResponse<{ id: number; status: string; link?: string }>> {
    try {
      const response = await fetch(`${API_BASE_URL}/api/wordpress/publish`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...authHeaders(),
        },
        body: JSON.stringify(input),
      });
      return parseResponse<{ id: number; status: string; link?: string }>(response);
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to publish to WordPress',
      };
    }
  },
};

export type { FeaturedImagePayload, WordPressPublishInput, WordPressStatus, WordPressTerm };
