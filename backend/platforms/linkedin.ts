import axios from 'axios';
import type {
  AnalyticsResult,
  PlatformContext,
  PlatformPostResult,
  PostObject,
  SocialPlatform,
  TokenRefreshResult,
  ValidationResult,
} from './types.js';

type LinkedInHelpers = {
  resolveAuthorUrn?: (ctx: PlatformContext) => Promise<string | null>;
  clientId?: string;
  clientSecret?: string;
};

const LINKEDIN_MAX_TEXT = 3000;
const LINKEDIN_MAX_TITLE = 200;
const LINKEDIN_API = 'https://api.linkedin.com';

const isRetryableStatus = (status?: number) =>
  status === 429 || (typeof status === 'number' && status >= 500);

export class LinkedInPlatform implements SocialPlatform {
  id = 'linkedin';
  name = 'LinkedIn';

  handleError(error: any): { retryable: boolean; message: string } {
    const status = error?.response?.status;
    const msg = error?.response?.data?.message
      || (error instanceof Error ? error.message : 'LinkedIn error');
    return { retryable: isRetryableStatus(status), message: msg };
  }

  validate(post: PostObject): ValidationResult {
    const text = String(post?.content?.text || '').trim();
    const title = String(post?.content?.title || '').trim();
    if (!text) return { ok: false, error: 'LinkedIn post requires text.' };
    if (text.length > LINKEDIN_MAX_TEXT) {
      return { ok: false, error: `LinkedIn text exceeds max ${LINKEDIN_MAX_TEXT} characters.` };
    }
    if (title && title.length > LINKEDIN_MAX_TITLE) {
      return { ok: false, error: `LinkedIn title exceeds max ${LINKEDIN_MAX_TITLE} characters.` };
    }
    const media = Array.isArray(post.media) ? post.media : [];
    if (media.length > 9) return { ok: false, error: 'LinkedIn supports up to 9 images per post.' };
    for (const item of media) {
      const mime = String(item?.mimeType || '').toLowerCase();
      if (mime && !mime.startsWith('image/') && !mime.startsWith('video/')) {
        return { ok: false, error: 'LinkedIn supports images and videos only.' };
      }
    }
    return { ok: true };
  }

  async post(post: PostObject, ctx: PlatformContext): Promise<PlatformPostResult> {
    try {
      const authorUrn = await this._resolveAuthorUrn(ctx);
      if (!authorUrn) return { status: 'failed', error: 'LinkedIn author URN could not be resolved.' };
      const text = String(post?.content?.text || '').trim();
      const media = Array.isArray(post.media) ? post.media : [];
      if (media.length === 0) return await this._postText(authorUrn, text, ctx);
      if (media.length === 1) {
        const mime = String(media[0]?.mimeType || '').toLowerCase();
        if (mime.startsWith('video/') || media[0]?.type === 'video') return await this._postVideo(authorUrn, media[0], text, ctx);
        return await this._postImage(authorUrn, media[0], text, ctx);
      }
      return await this._postMultiImage(authorUrn, media, text, ctx);
    } catch (err) {
      const { retryable, message } = this.handleError(err);
      return { status: 'failed', error: message, retryable };
    }
  }

  private async _resolveAuthorUrn(ctx: PlatformContext): Promise<string | null> {
    if (ctx.tokenData?.sub) return `urn:li:person:${ctx.tokenData.sub}`;
    const helpers = (ctx.helpers || {}) as LinkedInHelpers;
    if (helpers.resolveAuthorUrn) return helpers.resolveAuthorUrn(ctx);
    const resp = await axios.get(`${LINKEDIN_API}/v2/me`, {
      headers: { Authorization: `Bearer ${ctx.accessToken}` },
      validateStatus: () => true,
      timeout: 15000,
    });
    if (resp.status >= 400) return null;
    const id = String((resp.data as any)?.id || '').trim();
    return id ? `urn:li:person:${id}` : null;
  }

  private async _postText(authorUrn: string, text: string, ctx: PlatformContext): Promise<PlatformPostResult> {
    const body = {
      author: authorUrn,
      lifecycleState: 'PUBLISHED',
      specificContent: {
        'com.linkedin.ugc.ShareContent': { shareCommentary: { text }, shareMediaCategory: 'NONE' },
      },
      visibility: { 'com.linkedin.ugc.MemberNetworkVisibility': 'PUBLIC' },
    };
    const resp = await axios.post(`${LINKEDIN_API}/v2/ugcPosts`, body, {
      headers: { Authorization: `Bearer ${ctx.accessToken}`, 'Content-Type': 'application/json', 'X-Restli-Protocol-Version': '2.0.0' },
      validateStatus: () => true,
      timeout: 15000,
    });
    if (resp.status >= 400) {
      const e: any = resp.data || {};
      return { status: 'failed', error: e?.message || `LinkedIn error ${resp.status}`, retryable: isRetryableStatus(resp.status), raw: e };
    }
    return { status: 'published', platformPostId: String((resp.data as any)?.id || ''), raw: resp.data };
  }

  private async _registerAsset(authorUrn: string, recipe: string, ctx: PlatformContext): Promise<{ uploadUrl: string; assetId: string } | null> {
    const resp = await axios.post(
      `${LINKEDIN_API}/v2/assets?action=registerUpload`,
      {
        registerUploadRequest: {
          recipes: [recipe],
          owner: authorUrn,
          serviceRelationships: [{ relationshipType: 'OWNER', identifier: 'urn:li:userGeneratedContent' }],
        },
      },
      { headers: { Authorization: `Bearer ${ctx.accessToken}`, 'Content-Type': 'application/json' }, validateStatus: () => true, timeout: 15000 }
    );
    const data: any = resp.data || {};
    const uploadUrl = data?.value?.uploadMechanism?.['com.linkedin.digitalmedia.uploading.MediaUploadHttpRequest']?.uploadUrl || '';
    const assetId = data?.value?.asset || '';
    if (!uploadUrl || !assetId) return null;
    return { uploadUrl, assetId };
  }

  private async _postImage(authorUrn: string, item: any, text: string, ctx: PlatformContext): Promise<PlatformPostResult> {
    const reg = await this._registerAsset(authorUrn, 'urn:li:digitalmediaRecipe:feedshare-image', ctx);
    if (!reg) return { status: 'failed', error: 'LinkedIn image asset registration failed.' };
    const imgResp = await axios.get(item.url, { responseType: 'arraybuffer', timeout: 30000 });
    await axios.put(reg.uploadUrl, imgResp.data, {
      headers: { Authorization: `Bearer ${ctx.accessToken}`, 'Content-Type': item.mimeType || 'image/jpeg' },
      validateStatus: () => true,
      timeout: 30000,
    });
    const body = {
      author: authorUrn,
      lifecycleState: 'PUBLISHED',
      specificContent: {
        'com.linkedin.ugc.ShareContent': {
          shareCommentary: { text },
          shareMediaCategory: 'IMAGE',
          media: [{ status: 'READY', media: reg.assetId }],
        },
      },
      visibility: { 'com.linkedin.ugc.MemberNetworkVisibility': 'PUBLIC' },
    };
    const resp = await axios.post(`${LINKEDIN_API}/v2/ugcPosts`, body, {
      headers: { Authorization: `Bearer ${ctx.accessToken}`, 'Content-Type': 'application/json', 'X-Restli-Protocol-Version': '2.0.0' },
      validateStatus: () => true,
      timeout: 15000,
    });
    if (resp.status >= 400) {
      const e: any = resp.data || {};
      return { status: 'failed', error: e?.message || `LinkedIn image post failed (${resp.status})`, retryable: isRetryableStatus(resp.status) };
    }
    return { status: 'published', platformPostId: String((resp.data as any)?.id || ''), raw: resp.data };
  }

  private async _postMultiImage(authorUrn: string, media: any[], text: string, ctx: PlatformContext): Promise<PlatformPostResult> {
    const assetIds: string[] = [];
    for (const item of media) {
      const reg = await this._registerAsset(authorUrn, 'urn:li:digitalmediaRecipe:feedshare-image', ctx);
      if (!reg) continue;
      const imgResp = await axios.get(item.url, { responseType: 'arraybuffer', timeout: 30000 });
      await axios.put(reg.uploadUrl, imgResp.data, {
        headers: { Authorization: `Bearer ${ctx.accessToken}`, 'Content-Type': item.mimeType || 'image/jpeg' },
        validateStatus: () => true,
        timeout: 30000,
      });
      assetIds.push(reg.assetId);
    }
    if (!assetIds.length) return { status: 'failed', error: 'No LinkedIn images uploaded successfully.' };
    const body = {
      author: authorUrn,
      lifecycleState: 'PUBLISHED',
      specificContent: {
        'com.linkedin.ugc.ShareContent': {
          shareCommentary: { text },
          shareMediaCategory: 'IMAGE',
          media: assetIds.map(id => ({ status: 'READY', media: id })),
        },
      },
      visibility: { 'com.linkedin.ugc.MemberNetworkVisibility': 'PUBLIC' },
    };
    const resp = await axios.post(`${LINKEDIN_API}/v2/ugcPosts`, body, {
      headers: { Authorization: `Bearer ${ctx.accessToken}`, 'Content-Type': 'application/json', 'X-Restli-Protocol-Version': '2.0.0' },
      validateStatus: () => true,
      timeout: 15000,
    });
    if (resp.status >= 400) {
      const e: any = resp.data || {};
      return { status: 'failed', error: e?.message || `LinkedIn multi-image failed (${resp.status})`, retryable: isRetryableStatus(resp.status) };
    }
    return { status: 'published', platformPostId: String((resp.data as any)?.id || ''), raw: resp.data };
  }

  private async _postVideo(authorUrn: string, item: any, text: string, ctx: PlatformContext): Promise<PlatformPostResult> {
    const reg = await this._registerAsset(authorUrn, 'urn:li:digitalmediaRecipe:feedshare-video', ctx);
    if (!reg) return { status: 'failed', error: 'LinkedIn video asset registration failed.' };
    const videoResp = await axios.get(item.url, { responseType: 'arraybuffer', timeout: 120000 });
    await axios.put(reg.uploadUrl, videoResp.data, {
      headers: { Authorization: `Bearer ${ctx.accessToken}`, 'Content-Type': 'video/mp4' },
      validateStatus: () => true,
      timeout: 120000,
    });
    const body = {
      author: authorUrn,
      lifecycleState: 'PUBLISHED',
      specificContent: {
        'com.linkedin.ugc.ShareContent': {
          shareCommentary: { text },
          shareMediaCategory: 'VIDEO',
          media: [{ status: 'READY', media: reg.assetId }],
        },
      },
      visibility: { 'com.linkedin.ugc.MemberNetworkVisibility': 'PUBLIC' },
    };
    const resp = await axios.post(`${LINKEDIN_API}/v2/ugcPosts`, body, {
      headers: { Authorization: `Bearer ${ctx.accessToken}`, 'Content-Type': 'application/json', 'X-Restli-Protocol-Version': '2.0.0' },
      validateStatus: () => true,
      timeout: 15000,
    });
    if (resp.status >= 400) {
      const e: any = resp.data || {};
      return { status: 'failed', error: e?.message || `LinkedIn video post failed (${resp.status})`, retryable: isRetryableStatus(resp.status) };
    }
    return { status: 'published', platformPostId: String((resp.data as any)?.id || ''), raw: resp.data };
  }

  async getPostAnalytics(postId: string, ctx: PlatformContext): Promise<AnalyticsResult> {
    try {
      const encodedId = encodeURIComponent(postId);
      const [actionsResp, statsResp] = await Promise.all([
        axios.get(`${LINKEDIN_API}/v2/socialActions/${encodedId}`, {
          headers: { Authorization: `Bearer ${ctx.accessToken}`, 'X-Restli-Protocol-Version': '2.0.0' },
          validateStatus: () => true,
          timeout: 15000,
        }),
        axios.get(`${LINKEDIN_API}/v2/organizationalEntityShareStatistics?q=organizationalEntity&organizationalEntity=${encodedId}`, {
          headers: { Authorization: `Bearer ${ctx.accessToken}` },
          validateStatus: () => true,
          timeout: 15000,
        }),
      ]);
      const actions: any = actionsResp.data || {};
      const stats: any = statsResp.data?.elements?.[0]?.totalShareStatistics || {};
      return {
        likes: actions?.likesSummary?.totalLikes,
        comments: actions?.commentsSummary?.totalFirstLevelComments,
        shares: stats.shareCount,
        impressions: stats.impressionCount,
        clicks: stats.clickCount,
        raw: { actions, stats },
      };
    } catch (err) {
      return { raw: { error: err instanceof Error ? err.message : 'Analytics fetch failed' } };
    }
  }

  async refreshToken(ctx: PlatformContext): Promise<TokenRefreshResult> {
    try {
      const helpers = (ctx.helpers || {}) as LinkedInHelpers;
      const clientId = helpers.clientId || process.env.LINKEDIN_CLIENT_ID || '';
      const clientSecret = helpers.clientSecret || process.env.LINKEDIN_CLIENT_SECRET || '';
      if (!clientId || !clientSecret) return { ok: false, error: 'LinkedIn credentials not configured.' };
      if (!ctx.refreshToken) return { ok: false, error: 'No LinkedIn refresh token available.' };
      const resp = await axios.post(
        'https://www.linkedin.com/oauth/v2/accessToken',
        new URLSearchParams({ grant_type: 'refresh_token', refresh_token: ctx.refreshToken, client_id: clientId, client_secret: clientSecret }).toString(),
        { headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, validateStatus: () => true, timeout: 15000 }
      );
      const data: any = resp.data || {};
      if (resp.status >= 400 || !data.access_token) return { ok: false, error: data?.error_description || 'LinkedIn refresh failed.' };
      const expiresAt = data.expires_in ? new Date(Date.now() + data.expires_in * 1000) : undefined;
      return { ok: true, accessToken: data.access_token, refreshToken: data.refresh_token, expiresAt };
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : 'LinkedIn refresh failed.' };
    }
  }
}
