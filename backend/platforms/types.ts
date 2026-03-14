export type PostDestination = {
  type?: string;
  id?: string;
  name?: string;
};

export type PostMedia = {
  url: string;
  mimeType?: string;
  type?: 'image' | 'video' | 'gif' | 'other';
};

export type PostContent = {
  text: string;
  link?: string;
};

export type PostObject = {
  type?: string;
  content: PostContent;
  media?: PostMedia[];
  destination?: PostDestination;
};

export type ValidationResult =
  | { ok: true }
  | { ok: false; error: string; code?: string };

export type PlatformPostResult = {
  status: 'published' | 'failed' | 'pending';
  platformPostId?: string;
  error?: string;
  code?: string;
  retryable?: boolean;
  raw?: any;
};

export type PlatformContext = {
  accessToken: string;
  accountId?: string | null;
  accountName?: string | null;
  tokenData?: any;
  logger?: {
    info: (...args: any[]) => void;
    warn: (...args: any[]) => void;
    error: (...args: any[]) => void;
  };
  helpers?: Record<string, any>;
};

export interface SocialPlatform {
  id: string;
  name: string;
  validate(post: PostObject): ValidationResult;
  post(post: PostObject, ctx: PlatformContext): Promise<PlatformPostResult>;
  getPostAnalytics?(postId: string, ctx: PlatformContext): Promise<any>;
  refreshToken?(ctx: PlatformContext): Promise<any>;
}
