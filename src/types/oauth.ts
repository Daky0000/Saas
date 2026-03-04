export type SocialPlatform = 'Instagram' | 'Twitter' | 'LinkedIn' | 'Facebook' | 'TikTok';

export interface ConnectedAccount {
  id: string;
  userId: string;
  platform: SocialPlatform;
  handle: string;
  email?: string;
  accessToken?: string;
  refreshToken?: string;
  followers: string;
  connected: boolean;
  connectedAt: string;
  expiresAt?: string;
}

export interface OAuthConfig {
  platform: SocialPlatform;
  clientId: string;
  redirectUri: string;
  scopes: string[];
  authUrl: string;
}

export interface OAuthResponse {
  code: string;
  state: string;
  error?: string;
}

export interface AutoPostingConfig {
  id: string;
  platform: SocialPlatform;
  enabled: boolean;
  carbonCopy: string;
  format: string;
  autoHashtags: boolean;
  maxLength: number;
}

export interface ContentVariation {
  platform: SocialPlatform;
  type: string;
  format: string;
  adaptations: string[];
}

export interface RepostingSchedule {
  id: string;
  title: string;
  frequency: string;
  platforms: SocialPlatform[];
  lastRepost: string;
  nextRepost: string;
  performance: 'Excellent' | 'Good' | 'Fair' | 'Poor';
}

export interface ErrorLog {
  id: string;
  timestamp: string;
  platform: SocialPlatform;
  error: string;
  type: 'auth' | 'file' | 'rate-limit' | 'api' | 'other';
  status: 'active' | 'resolved';
}

export interface ApiResponse<T> {
  success: boolean;
  data?: T;
  error?: string;
  message?: string;
}
