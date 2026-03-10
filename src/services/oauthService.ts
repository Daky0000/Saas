import { ApiResponse, ConnectedAccount, SocialPlatform } from '../types/oauth';

const rawApiBaseUrl = (import.meta.env.VITE_API_BASE_URL || '').trim();
const API_BASE_URL = rawApiBaseUrl.includes('api.yourdomain.com')
  ? ''
  : rawApiBaseUrl.replace(/\/$/, '');
const APP_URL =
  typeof window !== 'undefined'
    ? window.location.origin
    : import.meta.env.VITE_APP_URL || '';

const resolveRedirectUri = (envKeyValue?: string): string => {
  if (!envKeyValue) return APP_URL;
  if (envKeyValue.startsWith('http://') || envKeyValue.startsWith('https://')) {
    return envKeyValue;
  }
  return `${APP_URL}${envKeyValue}`;
};

const authHeaders = () => {
  if (typeof window === 'undefined') return {} as Record<string, string>;
  const token = localStorage.getItem('auth_token');
  return token ? { Authorization: `Bearer ${token}` } : {};
};

// Platform OAuth Configuration
export const oauthConfigs = {
  Instagram: {
    clientId: import.meta.env.VITE_INSTAGRAM_APP_ID,
    redirectUri: resolveRedirectUri(import.meta.env.VITE_INSTAGRAM_REDIRECT_URI),
    authUrl: 'https://api.instagram.com/oauth/authorize',
    scopes: ['user_profile', 'user_media'],
  },
  Twitter: {
    clientId: import.meta.env.VITE_TWITTER_CLIENT_ID,
    redirectUri: resolveRedirectUri(import.meta.env.VITE_TWITTER_REDIRECT_URI),
    authUrl: 'https://twitter.com/i/oauth2/authorize',
    scopes: ['tweet.read', 'tweet.write', 'users.read', 'follows.read', 'follows.write'],
  },
  LinkedIn: {
    clientId: import.meta.env.VITE_LINKEDIN_CLIENT_ID,
    redirectUri: resolveRedirectUri(import.meta.env.VITE_LINKEDIN_REDIRECT_URI),
    authUrl: 'https://www.linkedin.com/oauth/v2/authorization',
    scopes: ['r_liteprofile', 'w_member_social', 'r_basicprofile', 'r_emailaddress'],
  },
  Facebook: {
    clientId: import.meta.env.VITE_FACEBOOK_APP_ID,
    redirectUri: resolveRedirectUri(import.meta.env.VITE_FACEBOOK_REDIRECT_URI),
    authUrl: 'https://www.facebook.com/v18.0/dialog/oauth',
    scopes: ['pages_manage_posts', 'pages_read_user_content', 'pages_manage_metadata'],
  },
  TikTok: {
    clientId: import.meta.env.VITE_TIKTOK_CLIENT_ID,
    redirectUri: resolveRedirectUri(import.meta.env.VITE_TIKTOK_REDIRECT_URI),
    // TikTok Login Kit Web authorize endpoint
    authUrl: 'https://www.tiktok.com/v2/auth/authorize/',
    scopes: ['user.info.basic', 'video.upload'],
  },
};

// API Service Functions
export const oauthService = {
  /** Generate OAuth authorization URL */
  getAuthorizationUrl: (platform: SocialPlatform, state: string): string => {
    const config = oauthConfigs[platform];
    const params =
      platform === 'TikTok'
        ? new URLSearchParams({
            // TikTok uses `client_key` (not `client_id`)
            client_key: config.clientId,
            redirect_uri: config.redirectUri,
            response_type: 'code',
            state,
            scope: config.scopes.join(','),
          })
        : new URLSearchParams({
            client_id: config.clientId,
            redirect_uri: config.redirectUri,
            response_type: 'code',
            state,
            scope: config.scopes.join(' '),
          });
    return `${config.authUrl}?${params.toString()}`;
  },

  /** Persist OAuth state on the backend */
  registerState: async (platform: SocialPlatform, state: string): Promise<ApiResponse<void>> => {
    try {
      const response = await fetch(`${API_BASE_URL}/api/oauth/state`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...authHeaders(),
        },
        body: JSON.stringify({ platform, state }),
      });

      if (!response.ok) {
        throw new Error('Failed to store OAuth state');
      }

      return await response.json();
    } catch (error) {
      console.error('Error storing OAuth state:', error);
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to store OAuth state',
      };
    }
  },

  /** Exchange authorization code for access token */
  exchangeCodeForToken: async (
    platform: SocialPlatform,
    code: string,
    state: string
  ): Promise<ApiResponse<any>> => {
    try {
      const response = await fetch(`${API_BASE_URL}/api/oauth/callback`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...authHeaders(),
        },
        credentials: 'include',
        body: JSON.stringify({
          platform,
          code,
          state,
        }),
      });

      if (!response.ok) {
        throw new Error(`OAuth callback failed: ${response.statusText}`);
      }

      return await response.json();
    } catch (error) {
      console.error(`OAuth exchange error for ${platform}:`, error);
      return {
        success: false,
        error: error instanceof Error ? error.message : 'OAuth exchange failed',
      };
    }
  },

  /** Get connected accounts for user */
  getConnectedAccounts: async (): Promise<ApiResponse<ConnectedAccount[]>> => {
    try {
      const response = await fetch(`${API_BASE_URL}/api/accounts`, {
        method: 'GET',
        credentials: 'include',
        headers: {
          ...authHeaders(),
        },
      });

      if (!response.ok) {
        throw new Error('Failed to fetch connected accounts');
      }

      return await response.json();
    } catch (error) {
      console.error('Error fetching connected accounts:', error);
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to fetch accounts',
        data: [],
      };
    }
  },

  /** Disconnect account */
  disconnectAccount: async (platform: SocialPlatform): Promise<ApiResponse<void>> => {
    try {
      const response = await fetch(`${API_BASE_URL}/api/accounts/${platform}`, {
        method: 'DELETE',
        credentials: 'include',
        headers: {
          ...authHeaders(),
        },
      });

      if (!response.ok) {
        throw new Error('Failed to disconnect account');
      }

      return await response.json();
    } catch (error) {
      console.error(`Error disconnecting ${platform}:`, error);
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to disconnect',
      };
    }
  },

  /** Test platform connection */
  testConnection: async (platform: SocialPlatform): Promise<ApiResponse<any>> => {
    try {
      const response = await fetch(`${API_BASE_URL}/api/accounts/${platform}/test`, {
        method: 'GET',
        credentials: 'include',
        headers: {
          ...authHeaders(),
        },
      });

      if (!response.ok) {
        throw new Error('Connection test failed');
      }

      return await response.json();
    } catch (error) {
      console.error(`Connection test failed for ${platform}:`, error);
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Connection test failed',
      };
    }
  },

  /** Publish post to platform */
  publishPost: async (
    platform: SocialPlatform,
    content: { text: string; media?: string[]; hashtags?: string[] }
  ): Promise<ApiResponse<any>> => {
    try {
      const response = await fetch(`${API_BASE_URL}/api/posts/${platform}/publish`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...authHeaders(),
        },
        credentials: 'include',
        body: JSON.stringify(content),
      });

      if (!response.ok) {
        throw new Error('Failed to publish post');
      }

      return await response.json();
    } catch (error) {
      console.error(`Error publishing to ${platform}:`, error);
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to publish',
      };
    }
  },

  /** Get platform analytics */
  getAnalytics: async (platform: SocialPlatform): Promise<ApiResponse<any>> => {
    try {
      const response = await fetch(`${API_BASE_URL}/api/analytics/${platform}`, {
        method: 'GET',
        credentials: 'include',
        headers: {
          ...authHeaders(),
        },
      });

      if (!response.ok) {
        throw new Error('Failed to fetch analytics');
      }

      return await response.json();
    } catch (error) {
      console.error(`Error fetching analytics for ${platform}:`, error);
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to fetch analytics',
      };
    }
  },
};

export default oauthService;
