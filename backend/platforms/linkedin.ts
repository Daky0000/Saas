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
// Current stable Marketing API version
const LINKEDIN_VERSION = '202501';

const isRetryableStatus = (status?: number) =>
  status === 429 || (typeof status === 'number' && status >= 500);

/** Fetch image bytes from an HTTPS URL or decode a base64 data: URI inline. */
async function fetchImageBuffer(url: string): Promise<{ buffer: Buffer; mimeType: string }> {
  if (url.startsWith('data:')) {
    const match = url.match(/^data:(image\/[^;]+);base64,(.+)$/s);
    if (!match) throw new Error('Invalid base64 image data URL');
    return { buffer: Buffer.from(match[2], 'base64'), mimeType: match[1] };
  }
  const resp = await axios.get(url, { responseType: 'arraybuffer', timeout: 30000 });
  const ct = String(resp.headers['content-type'] || '').split(';')[0].trim() || 'image/jpeg';
  return { buffer: Buffer.from(resp.data), mimeType: ct };
}

export class LinkedInPlatform implements SocialPlatform {
  id = 'linkedin';
  name = 'LinkedIn';

  handleError(error: any): { retryable: boolean; message: string } {
    const status = error?.response?.status;
    const msg =
      error?.response?.data?.message ||
      error?.response?.data?.error_description ||
      (error instanceof Error ? error.message : 'LinkedIn error');
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
      const link = String(post?.content?.link || '').trim();
      const media = Array.isArray(post.media) ? post.media : [];
      if (media.length === 0) return await this._postText(authorUrn, text, link || undefined, ctx);
      if (media.length === 1) {
        const mime = String(media[0]?.mimeType || '').toLowerCase();
        if (mime.startsWith('video/') || media[0]?.type === 'video') {
          return await this._postVideo(authorUrn, media[0], text, ctx);
        }
        return await this._postImage(authorUrn, media[0], text, ctx);
      }
      return await this._postMultiImage(authorUrn, media, text, ctx);
    } catch (err) {
      const { retryable, message } = this.handleError(err);
      return { status: 'failed', error: message, retryable };
    }
  }

  private async _resolveAuthorUrn(ctx: PlatformContext): Promise<string | null> {
    // 1. Fastest: cached sub/user_id in token_data
    const cached = String(ctx.tokenData?.sub || ctx.tokenData?.user_id || ctx.tokenData?.id || '').trim();
    if (cached) return `urn:li:person:${cached}`;

    const helpers = (ctx.helpers || {}) as LinkedInHelpers;
    if (helpers.resolveAuthorUrn) return helpers.resolveAuthorUrn(ctx);

    // 2. Fetch from /v2/me (works with r_liteprofile scope)
    const meResp = await axios.get(`${LINKEDIN_API}/v2/me`, {
      headers: { Authorization: `Bearer ${ctx.accessToken}` },
      validateStatus: () => true,
      timeout: 15000,
    });
    if (meResp.status >= 400) return null;
    const id = String((meResp.data as any)?.id || '').trim();
    return id ? `urn:li:person:${id}` : null;
  }

  // ── Text / link post ────────────────────────────────────────────────────────

  private async _postText(
    authorUrn: string,
    text: string,
    link: string | undefined,
    ctx: PlatformContext,
  ): Promise<PlatformPostResult> {
    const body: any = {
      author: authorUrn,
      lifecycleState: 'PUBLISHED',
      specificContent: {
        'com.linkedin.ugc.ShareContent': {
          shareCommentary: { text },
          shareMediaCategory: link ? 'ARTICLE' : 'NONE',
          ...(link ? { media: [{ status: 'READY', originalUrl: link }] } : {}),
        },
      },
      visibility: { 'com.linkedin.ugc.MemberNetworkVisibility': 'PUBLIC' },
    };
    const resp = await axios.post(`${LINKEDIN_API}/v2/ugcPosts`, body, {
      headers: this._ugcHeaders(ctx.accessToken),
      validateStatus: () => true,
      timeout: 15000,
    });
    if (resp.status >= 400) {
      const e: any = resp.data || {};
      return { status: 'failed', error: e?.message || `LinkedIn error ${resp.status}`, retryable: isRetryableStatus(resp.status), raw: e };
    }
    return { status: 'published', platformPostId: String((resp.data as any)?.id || ''), raw: resp.data };
  }

  // ── Image upload (new LinkedIn Images API) ──────────────────────────────────

  private async _initializeImageUpload(
    ownerUrn: string,
    ctx: PlatformContext,
  ): Promise<{ uploadUrl: string; imageUrn: string } | null> {
    const resp = await axios.post(
      `${LINKEDIN_API}/rest/images?action=initializeUpload`,
      { initializeUploadRequest: { owner: ownerUrn } },
      {
        headers: {
          Authorization: `Bearer ${ctx.accessToken}`,
          'Content-Type': 'application/json',
          'LinkedIn-Version': LINKEDIN_VERSION,
          'X-Restli-Protocol-Version': '2.0.0',
        },
        validateStatus: () => true,
        timeout: 15000,
      },
    );
    const data: any = resp.data || {};
    const uploadUrl = String(data?.value?.uploadUrl || '').trim();
    const imageUrn = String(data?.value?.image || '').trim();
    if (!uploadUrl || !imageUrn) return null;
    return { uploadUrl, imageUrn };
  }

  private async _uploadImageBuffer(
    uploadUrl: string,
    buffer: Buffer,
    mimeType: string,
    ctx: PlatformContext,
  ): Promise<boolean> {
    const resp = await axios.put(uploadUrl, buffer, {
      headers: {
        Authorization: `Bearer ${ctx.accessToken}`,
        'Content-Type': mimeType,
        'LinkedIn-Version': LINKEDIN_VERSION,
      },
      validateStatus: () => true,
      timeout: 30000,
      maxBodyLength: Infinity,
    });
    return resp.status < 400;
  }

  private async _postImage(authorUrn: string, item: any, text: string, ctx: PlatformContext): Promise<PlatformPostResult> {
    const init = await this._initializeImageUpload(authorUrn, ctx);
    if (!init) return { status: 'failed', error: 'LinkedIn image upload initialization failed.' };

    let buffer: Buffer;
    let mimeType: string;
    try {
      ({ buffer, mimeType } = await fetchImageBuffer(item.url));
    } catch (err) {
      return { status: 'failed', error: `Could not load image for LinkedIn: ${err instanceof Error ? err.message : 'fetch error'}` };
    }

    const uploaded = await this._uploadImageBuffer(init.uploadUrl, buffer, mimeType, ctx);
    if (!uploaded) return { status: 'failed', error: 'LinkedIn image binary upload failed.' };

    const body = {
      author: authorUrn,
      lifecycleState: 'PUBLISHED',
      specificContent: {
        'com.linkedin.ugc.ShareContent': {
          shareCommentary: { text },
          shareMediaCategory: 'IMAGE',
          media: [{ status: 'READY', media: init.imageUrn }],
        },
      },
      visibility: { 'com.linkedin.ugc.MemberNetworkVisibility': 'PUBLIC' },
    };
    const resp = await axios.post(`${LINKEDIN_API}/v2/ugcPosts`, body, {
      headers: this._ugcHeaders(ctx.accessToken),
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
    const imageUrns: string[] = [];
    for (const item of media) {
      const init = await this._initializeImageUpload(authorUrn, ctx);
      if (!init) continue;
      try {
        const { buffer, mimeType } = await fetchImageBuffer(item.url);
        const ok = await this._uploadImageBuffer(init.uploadUrl, buffer, mimeType, ctx);
        if (ok) imageUrns.push(init.imageUrn);
      } catch {
        // skip failed images; publish with whatever succeeded
      }
    }
    if (!imageUrns.length) return { status: 'failed', error: 'No LinkedIn images uploaded successfully.' };

    const body = {
      author: authorUrn,
      lifecycleState: 'PUBLISHED',
      specificContent: {
        'com.linkedin.ugc.ShareContent': {
          shareCommentary: { text },
          shareMediaCategory: 'IMAGE',
          media: imageUrns.map(urn => ({ status: 'READY', media: urn })),
        },
      },
      visibility: { 'com.linkedin.ugc.MemberNetworkVisibility': 'PUBLIC' },
    };
    const resp = await axios.post(`${LINKEDIN_API}/v2/ugcPosts`, body, {
      headers: this._ugcHeaders(ctx.accessToken),
      validateStatus: () => true,
      timeout: 15000,
    });
    if (resp.status >= 400) {
      const e: any = resp.data || {};
      return { status: 'failed', error: e?.message || `LinkedIn multi-image failed (${resp.status})`, retryable: isRetryableStatus(resp.status) };
    }
    return { status: 'published', platformPostId: String((resp.data as any)?.id || ''), raw: resp.data };
  }

  // ── Video upload (new LinkedIn Videos API) ─────────────────────────────────

  private async _postVideo(authorUrn: string, item: any, text: string, ctx: PlatformContext): Promise<PlatformPostResult> {
    let videoBuffer: Buffer;
    try {
      const resp = await axios.get(item.url, { responseType: 'arraybuffer', timeout: 120000 });
      videoBuffer = Buffer.from(resp.data);
    } catch (err) {
      return { status: 'failed', error: `Could not load video for LinkedIn: ${err instanceof Error ? err.message : 'fetch error'}` };
    }

    // Initialize upload via new Videos API
    const initResp = await axios.post(
      `${LINKEDIN_API}/rest/videos?action=initializeUpload`,
      {
        initializeUploadRequest: {
          owner: authorUrn,
          fileSizeBytes: videoBuffer.length,
          uploadCaptions: false,
          uploadThumbnail: false,
        },
      },
      {
        headers: {
          Authorization: `Bearer ${ctx.accessToken}`,
          'Content-Type': 'application/json',
          'LinkedIn-Version': LINKEDIN_VERSION,
          'X-Restli-Protocol-Version': '2.0.0',
        },
        validateStatus: () => true,
        timeout: 15000,
      },
    );
    const initData: any = initResp.data || {};
    if (initResp.status >= 400 || !initData?.value?.uploadInstructions?.length) {
      return {
        status: 'failed',
        error: initData?.message || `LinkedIn video upload init failed (${initResp.status})`,
        retryable: isRetryableStatus(initResp.status),
      };
    }
    const videoUrn = String(initData.value.video || '').trim();
    const uploadToken = String(initData.value.uploadToken || '').trim();
    const instructions: Array<{ uploadUrl: string; firstByte: number; lastByte: number }> =
      initData.value.uploadInstructions || [];

    // Upload each chunk (single-chunk for most files; multi-chunk for large files)
    for (const instruction of instructions) {
      const chunk = videoBuffer.slice(instruction.firstByte, instruction.lastByte + 1);
      const uploadResp = await axios.put(instruction.uploadUrl, chunk, {
        headers: {
          Authorization: `Bearer ${ctx.accessToken}`,
          'Content-Type': 'application/octet-stream',
          'LinkedIn-Version': LINKEDIN_VERSION,
        },
        validateStatus: () => true,
        timeout: 120000,
        maxBodyLength: Infinity,
      });
      if (uploadResp.status >= 400) {
        return { status: 'failed', error: `LinkedIn video chunk upload failed (${uploadResp.status})` };
      }
    }

    // Finalize upload
    if (uploadToken) {
      const finalResp = await axios.post(
        `${LINKEDIN_API}/rest/videos?action=finalizeUpload`,
        { finalizeUploadRequest: { video: videoUrn, uploadToken } },
        {
          headers: {
            Authorization: `Bearer ${ctx.accessToken}`,
            'Content-Type': 'application/json',
            'LinkedIn-Version': LINKEDIN_VERSION,
            'X-Restli-Protocol-Version': '2.0.0',
          },
          validateStatus: () => true,
          timeout: 15000,
        },
      );
      if (finalResp.status >= 400) {
        return { status: 'failed', error: `LinkedIn video finalize failed (${finalResp.status})` };
      }
    }

    // Post with video URN
    const body = {
      author: authorUrn,
      lifecycleState: 'PUBLISHED',
      specificContent: {
        'com.linkedin.ugc.ShareContent': {
          shareCommentary: { text },
          shareMediaCategory: 'VIDEO',
          media: [{ status: 'READY', media: videoUrn }],
        },
      },
      visibility: { 'com.linkedin.ugc.MemberNetworkVisibility': 'PUBLIC' },
    };
    const resp = await axios.post(`${LINKEDIN_API}/v2/ugcPosts`, body, {
      headers: this._ugcHeaders(ctx.accessToken),
      validateStatus: () => true,
      timeout: 15000,
    });
    if (resp.status >= 400) {
      const e: any = resp.data || {};
      return { status: 'failed', error: e?.message || `LinkedIn video post failed (${resp.status})`, retryable: isRetryableStatus(resp.status) };
    }
    return { status: 'published', platformPostId: String((resp.data as any)?.id || ''), raw: resp.data };
  }

  // ── Analytics ──────────────────────────────────────────────────────────────

  async getPostAnalytics(postId: string, ctx: PlatformContext): Promise<AnalyticsResult> {
    try {
      const encodedId = encodeURIComponent(postId);
      const [actionsResp, statsResp] = await Promise.all([
        axios.get(`${LINKEDIN_API}/v2/socialActions/${encodedId}`, {
          headers: { Authorization: `Bearer ${ctx.accessToken}`, 'X-Restli-Protocol-Version': '2.0.0' },
          validateStatus: () => true,
          timeout: 15000,
        }),
        axios.get(`${LINKEDIN_API}/v2/organizationalEntityShareStatistics`, {
          params: { q: 'organizationalEntity&organizationalEntity', ugcPost: encodedId },
          headers: { Authorization: `Bearer ${ctx.accessToken}`, 'X-Restli-Protocol-Version': '2.0.0' },
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

  // ── Token refresh ──────────────────────────────────────────────────────────

  async refreshToken(ctx: PlatformContext): Promise<TokenRefreshResult> {
    try {
      const helpers = (ctx.helpers || {}) as LinkedInHelpers;
      const clientId = helpers.clientId || process.env.LINKEDIN_CLIENT_ID || process.env.VITE_LINKEDIN_CLIENT_ID || '';
      const clientSecret = helpers.clientSecret || process.env.LINKEDIN_CLIENT_SECRET || '';
      if (!clientId || !clientSecret) return { ok: false, error: 'LinkedIn credentials not configured.' };
      if (!ctx.refreshToken) return { ok: false, error: 'No LinkedIn refresh token available.' };

      const resp = await axios.post(
        'https://www.linkedin.com/oauth/v2/accessToken',
        new URLSearchParams({
          grant_type: 'refresh_token',
          refresh_token: ctx.refreshToken,
          client_id: clientId,
          client_secret: clientSecret,
        }).toString(),
        { headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, validateStatus: () => true, timeout: 15000 },
      );
      const data: any = resp.data || {};
      if (resp.status >= 400 || !data.access_token) {
        return { ok: false, error: data?.error_description || data?.message || 'LinkedIn refresh failed.' };
      }
      const expiresAt = data.expires_in ? new Date(Date.now() + data.expires_in * 1000) : undefined;
      return {
        ok: true,
        accessToken: data.access_token,
        refreshToken: data.refresh_token || ctx.refreshToken,
        expiresAt,
      };
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : 'LinkedIn refresh failed.' };
    }
  }

  // ── Helpers ────────────────────────────────────────────────────────────────

  private _ugcHeaders(accessToken: string): Record<string, string> {
    return {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
      'X-Restli-Protocol-Version': '2.0.0',
    };
  }
}
