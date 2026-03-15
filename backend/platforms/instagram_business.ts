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

type InstagramHelpers = {
  graphBase?: string;
  appId?: string;
  appSecret?: string;
};

const INSTAGRAM_MAX_CAPTION = 2200;
const GRAPH_BASE = 'https://graph.facebook.com/v19.0';

const isRetryableStatus = (status?: number) =>
  status === 429 || (typeof status === 'number' && status >= 500);

export class InstagramBusinessPlatform implements SocialPlatform {
  id = 'instagram';
  name = 'Instagram Business';

  handleError(error: any): { retryable: boolean; message: string } {
    const msg = error?.response?.data?.error?.message
      || (error instanceof Error ? error.message : 'Instagram error');
    const status = error?.response?.status;
    const code = error?.response?.data?.error?.code;
    // Code 190 = token expired; 10/200/341 = permission/rate errors
    const retryable = status === 429 || status >= 500 || code === 341;
    return { retryable, message: msg };
  }

  validate(post: PostObject): ValidationResult {
    const text = String(post?.content?.text || '').trim();
    if (text.length > INSTAGRAM_MAX_CAPTION) {
      return { ok: false, error: `Instagram caption exceeds max ${INSTAGRAM_MAX_CAPTION} characters.` };
    }

    const media = Array.isArray(post.media) ? post.media : [];
    const postType = String(post?.type || 'FEED_POST').toUpperCase();

    if (postType === 'STORY') {
      if (!media.length) return { ok: false, error: 'Instagram Stories require at least one image or video.' };
      return { ok: true };
    }

    if (postType === 'REEL') {
      if (!media.length) return { ok: false, error: 'Instagram Reels require a video.' };
      const mime = String(media[0]?.mimeType || '').toLowerCase();
      if (!mime.startsWith('video/') && media[0]?.type !== 'video') {
        return { ok: false, error: 'Instagram Reels require a video file.' };
      }
      return { ok: true };
    }

    // Feed post
    if (!media.length) {
      return { ok: false, error: 'Instagram feed posts require at least one image.' };
    }
    if (media.length > 10) {
      return { ok: false, error: 'Instagram carousel supports up to 10 images.' };
    }
    for (const item of media) {
      const mime = String(item?.mimeType || '').toLowerCase();
      if (mime && !mime.startsWith('image/') && !mime.startsWith('video/')) {
        return { ok: false, error: 'Instagram supports images and videos only.' };
      }
    }

    return { ok: true };
  }

  async post(post: PostObject, ctx: PlatformContext): Promise<PlatformPostResult> {
    try {
      const igUserId = String(ctx.accountId || '').trim();
      if (!igUserId) return { status: 'failed', error: 'Instagram account ID is missing.' };

      // Pre-flight: verify this is a Business/Creator account
      const accountCheck = await this._verifyBusinessAccount(igUserId, ctx.accessToken, ctx.helpers as InstagramHelpers);
      if (!accountCheck.ok) return { status: 'failed', error: accountCheck.error };

      const postType = String(post?.type || 'FEED_POST').toUpperCase();
      const helpers = (ctx.helpers || {}) as InstagramHelpers;
      const graphBase = helpers.graphBase || GRAPH_BASE;
      const media = Array.isArray(post.media) ? post.media : [];
      const caption = String(post?.content?.text || '').trim();

      if (postType === 'REEL') {
        return await this._postReel(graphBase, igUserId, ctx.accessToken, media[0]?.url || '', caption);
      }
      if (postType === 'STORY') {
        return await this._postStory(graphBase, igUserId, ctx.accessToken, media[0], caption);
      }
      if (media.length > 1) {
        return await this._postCarousel(graphBase, igUserId, ctx.accessToken, media, caption);
      }

      // Single image/video feed post
      const item = media[0];
      if (!item?.url) return { status: 'failed', error: 'Instagram image URL is missing.' };

      const mime = String(item?.mimeType || '').toLowerCase();
      const isVideo = mime.startsWith('video/') || item?.type === 'video';

      const createParams: Record<string, string> = {
        caption,
        access_token: ctx.accessToken,
      };
      if (isVideo) {
        createParams.media_type = 'VIDEO';
        createParams.video_url = item.url;
      } else {
        createParams.image_url = item.url;
      }

      const createResp = await axios.post(
        `${graphBase}/${encodeURIComponent(igUserId)}/media`,
        new URLSearchParams(createParams).toString(),
        { headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, validateStatus: () => true, timeout: 30000 }
      );
      const createData: any = createResp.data || {};
      if (createResp.status >= 400) {
        return {
          status: 'failed',
          error: createData?.error?.message || `Instagram media create failed (${createResp.status})`,
          code: createData?.error?.code ? String(createData.error.code) : undefined,
          retryable: isRetryableStatus(createResp.status),
          raw: createData,
        };
      }

      const creationId = String(createData?.id || '').trim();
      if (!creationId) return { status: 'failed', error: 'Instagram did not return a creation ID.' };

      // For videos: poll until ready before publishing
      if (isVideo) {
        const ready = await this._pollMediaReady(graphBase, creationId, ctx.accessToken);
        if (!ready) return { status: 'failed', error: 'Instagram video processing timed out.', retryable: true };
      }

      const pubResp = await axios.post(
        `${graphBase}/${encodeURIComponent(igUserId)}/media_publish`,
        new URLSearchParams({ creation_id: creationId, access_token: ctx.accessToken }).toString(),
        { headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, validateStatus: () => true, timeout: 20000 }
      );
      const pubData: any = pubResp.data || {};
      if (pubResp.status >= 400) {
        return {
          status: 'failed',
          error: pubData?.error?.message || `Instagram publish failed (${pubResp.status})`,
          retryable: isRetryableStatus(pubResp.status),
          raw: pubData,
        };
      }

      return { status: 'published', platformPostId: String(pubData?.id || creationId), raw: pubData };
    } catch (err) {
      const { retryable, message } = this.handleError(err);
      return { status: 'failed', error: message, retryable };
    }
  }

  private async _verifyBusinessAccount(
    igUserId: string,
    accessToken: string,
    helpers: InstagramHelpers,
  ): Promise<{ ok: boolean; error?: string }> {
    try {
      const graphBase = helpers?.graphBase || GRAPH_BASE;
      const resp = await axios.get(`${graphBase}/${encodeURIComponent(igUserId)}`, {
        params: { fields: 'account_type,username', access_token: accessToken },
        validateStatus: () => true,
        timeout: 10000,
      });
      const data: any = resp.data || {};
      if (resp.status >= 400) return { ok: true }; // Don't block posting on lookup failure
      const accountType: string = String(data?.account_type || '').toUpperCase();
      if (accountType && accountType !== 'BUSINESS' && accountType !== 'MEDIA_CREATOR') {
        return {
          ok: false,
          error: 'Instagram publishing requires a Business or Creator account. Go to Instagram Settings → Account → Switch to Professional Account.',
        };
      }
      return { ok: true };
    } catch {
      return { ok: true }; // Don't block on network error during check
    }
  }

  private async _postReel(
    graphBase: string,
    igUserId: string,
    accessToken: string,
    videoUrl: string,
    caption: string,
  ): Promise<PlatformPostResult> {
    const createResp = await axios.post(
      `${graphBase}/${encodeURIComponent(igUserId)}/media`,
      new URLSearchParams({ media_type: 'REELS', video_url: videoUrl, caption, access_token: accessToken }).toString(),
      { headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, validateStatus: () => true, timeout: 30000 }
    );
    const createData: any = createResp.data || {};
    if (createResp.status >= 400) {
      return { status: 'failed', error: createData?.error?.message || 'Instagram Reel create failed.', retryable: isRetryableStatus(createResp.status) };
    }
    const creationId = String(createData?.id || '');
    if (!creationId) return { status: 'failed', error: 'Instagram Reel creation ID missing.' };

    const ready = await this._pollMediaReady(graphBase, creationId, accessToken);
    if (!ready) return { status: 'failed', error: 'Instagram Reel processing timed out.', retryable: true };

    const pubResp = await axios.post(
      `${graphBase}/${encodeURIComponent(igUserId)}/media_publish`,
      new URLSearchParams({ creation_id: creationId, access_token: accessToken }).toString(),
      { headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, validateStatus: () => true, timeout: 20000 }
    );
    const pubData: any = pubResp.data || {};
    if (pubResp.status >= 400) {
      return { status: 'failed', error: pubData?.error?.message || 'Instagram Reel publish failed.', retryable: isRetryableStatus(pubResp.status) };
    }
    return { status: 'published', platformPostId: String(pubData?.id || creationId), raw: pubData };
  }

  private async _postStory(
    graphBase: string,
    igUserId: string,
    accessToken: string,
    item: any,
    caption: string,
  ): Promise<PlatformPostResult> {
    const mime = String(item?.mimeType || '').toLowerCase();
    const isVideo = mime.startsWith('video/') || item?.type === 'video';
    const params: Record<string, string> = {
      media_type: isVideo ? 'VIDEO' : 'IMAGE',
      caption,
      access_token: accessToken,
    };
    if (isVideo) params.video_url = item.url;
    else params.image_url = item.url;

    const createResp = await axios.post(
      `${graphBase}/${encodeURIComponent(igUserId)}/media`,
      new URLSearchParams(params).toString(),
      { headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, validateStatus: () => true, timeout: 30000 }
    );
    const createData: any = createResp.data || {};
    if (createResp.status >= 400) {
      return { status: 'failed', error: createData?.error?.message || 'Instagram Story create failed.', retryable: isRetryableStatus(createResp.status) };
    }
    const creationId = String(createData?.id || '');

    const pubResp = await axios.post(
      `${graphBase}/${encodeURIComponent(igUserId)}/media_publish`,
      new URLSearchParams({ creation_id: creationId, access_token: accessToken }).toString(),
      { headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, validateStatus: () => true, timeout: 20000 }
    );
    const pubData: any = pubResp.data || {};
    if (pubResp.status >= 400) {
      return { status: 'failed', error: pubData?.error?.message || 'Instagram Story publish failed.', retryable: isRetryableStatus(pubResp.status) };
    }
    return { status: 'published', platformPostId: String(pubData?.id || creationId), raw: pubData };
  }

  private async _postCarousel(
    graphBase: string,
    igUserId: string,
    accessToken: string,
    media: any[],
    caption: string,
  ): Promise<PlatformPostResult> {
    const childIds: string[] = [];
    for (const item of media) {
      const mime = String(item?.mimeType || '').toLowerCase();
      const isVideo = mime.startsWith('video/') || item?.type === 'video';
      const params: Record<string, string> = {
        is_carousel_item: 'true',
        access_token: accessToken,
      };
      if (isVideo) { params.media_type = 'VIDEO'; params.video_url = item.url; }
      else params.image_url = item.url;

      const resp = await axios.post(
        `${graphBase}/${encodeURIComponent(igUserId)}/media`,
        new URLSearchParams(params).toString(),
        { headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, validateStatus: () => true, timeout: 20000 }
      );
      const data: any = resp.data || {};
      if (resp.status >= 400 || !data?.id) {
        return { status: 'failed', error: data?.error?.message || 'Instagram carousel item failed.', retryable: isRetryableStatus(resp.status) };
      }
      childIds.push(String(data.id));
    }

    const carResp = await axios.post(
      `${graphBase}/${encodeURIComponent(igUserId)}/media`,
      new URLSearchParams({
        media_type: 'CAROUSEL',
        children: childIds.join(','),
        caption,
        access_token: accessToken,
      }).toString(),
      { headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, validateStatus: () => true, timeout: 20000 }
    );
    const carData: any = carResp.data || {};
    if (carResp.status >= 400 || !carData?.id) {
      return { status: 'failed', error: carData?.error?.message || 'Instagram carousel create failed.', retryable: isRetryableStatus(carResp.status) };
    }

    const pubResp = await axios.post(
      `${graphBase}/${encodeURIComponent(igUserId)}/media_publish`,
      new URLSearchParams({ creation_id: String(carData.id), access_token: accessToken }).toString(),
      { headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, validateStatus: () => true, timeout: 20000 }
    );
    const pubData: any = pubResp.data || {};
    if (pubResp.status >= 400) {
      return { status: 'failed', error: pubData?.error?.message || 'Instagram carousel publish failed.', retryable: isRetryableStatus(pubResp.status) };
    }
    return { status: 'published', platformPostId: String(pubData?.id || carData.id), raw: pubData };
  }

  private async _pollMediaReady(graphBase: string, creationId: string, accessToken: string, maxAttempts = 15): Promise<boolean> {
    for (let i = 0; i < maxAttempts; i++) {
      await new Promise(r => setTimeout(r, 4000));
      const resp = await axios.get(`${graphBase}/${encodeURIComponent(creationId)}`, {
        params: { fields: 'status_code', access_token: accessToken },
        validateStatus: () => true,
        timeout: 10000,
      });
      const status = (resp.data as any)?.status_code;
      if (status === 'FINISHED') return true;
      if (status === 'ERROR') return false;
    }
    return false;
  }

  async getPostAnalytics(postId: string, ctx: PlatformContext): Promise<AnalyticsResult> {
    try {
      const helpers = (ctx.helpers || {}) as InstagramHelpers;
      const graphBase = helpers.graphBase || GRAPH_BASE;

      const resp = await axios.get(`${graphBase}/${encodeURIComponent(postId)}/insights`, {
        params: {
          metric: 'impressions,reach,likes,comments,shares,saved,total_interactions',
          access_token: ctx.accessToken,
        },
        validateStatus: () => true,
        timeout: 15000,
      });
      const raw: any = resp.data || {};
      if (resp.status >= 400) return { raw };

      const metrics: Record<string, number> = {};
      for (const item of raw.data || []) {
        metrics[item.name] = item.values?.[0]?.value ?? item.value ?? 0;
      }
      return {
        impressions: metrics['impressions'],
        reach: metrics['reach'],
        likes: metrics['likes'],
        comments: metrics['comments'],
        shares: metrics['shares'],
        saves: metrics['saved'],
        raw: metrics,
      };
    } catch (err) {
      return { raw: { error: err instanceof Error ? err.message : 'Analytics fetch failed' } };
    }
  }

  async refreshToken(ctx: PlatformContext): Promise<TokenRefreshResult> {
    try {
      // Instagram uses Facebook's long-lived token exchange
      const helpers = (ctx.helpers || {}) as InstagramHelpers;
      const appId = helpers.appId || process.env.FACEBOOK_APP_ID || '';
      const appSecret = helpers.appSecret || process.env.FACEBOOK_APP_SECRET || '';
      if (!appId || !appSecret) return { ok: false, error: 'Instagram/Facebook app credentials not configured.' };

      const resp = await axios.get(`${GRAPH_BASE}/oauth/access_token`, {
        params: { grant_type: 'fb_exchange_token', client_id: appId, client_secret: appSecret, fb_exchange_token: ctx.accessToken },
        validateStatus: () => true,
        timeout: 15000,
      });
      const data: any = resp.data || {};
      if (resp.status >= 400 || !data.access_token) {
        return { ok: false, error: data?.error?.message || 'Instagram token refresh failed.' };
      }
      const expiresAt = new Date(Date.now() + (data.expires_in || 60 * 24 * 3600) * 1000);
      return { ok: true, accessToken: data.access_token, expiresAt };
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : 'Instagram token refresh failed.' };
    }
  }
}
