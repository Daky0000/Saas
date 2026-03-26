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

const TWITTER_MAX_TEXT = 280;
const MEDIA_UPLOAD_URL = 'https://upload.twitter.com/1.1/media/upload.json';

type TwitterHelpers = {
  getGlobalWriteCount?: () => number;
  incrementGlobalWriteCount?: () => void;
  monthlyWriteLimit?: number;
  clientId?: string;
  clientSecret?: string;
};

const isRetryableStatus = (status?: number) =>
  status === 429 || (typeof status === 'number' && status >= 500);

export class TwitterXPlatform implements SocialPlatform {
  id = 'twitter';
  name = 'Twitter / X';

  handleError(error: any): { retryable: boolean; message: string } {
    const status = error?.response?.status;
    const detail = error?.response?.data?.detail || error?.response?.data?.title;
    const msg = detail || (error instanceof Error ? error.message : 'Twitter / X error');
    // 429 = rate limit; 503/500 = server errors
    const retryable = status === 429 || (typeof status === 'number' && status >= 500);
    return { retryable, message: msg };
  }

  validate(post: PostObject): ValidationResult {
    const text = String(post?.content?.text || '').trim();
    if (!text) return { ok: false, error: 'Twitter / X post requires text.' };
    if (text.length > TWITTER_MAX_TEXT) {
      return { ok: false, error: `Twitter / X text exceeds ${TWITTER_MAX_TEXT} characters.` };
    }
    const media = Array.isArray(post.media) ? post.media : [];
    if (media.length > 4) {
      return { ok: false, error: 'Twitter / X supports up to 4 images or 1 video per tweet.' };
    }
    return { ok: true };
  }

  // Upload a single media item using the chunked INIT/APPEND/FINALIZE flow
  private async _uploadMedia(
    mediaUrl: string,
    mimeType: string,
    accessToken: string
  ): Promise<string | null> {
    try {
      // Fetch the media as a buffer
      const fetchResp = await axios.get(mediaUrl, {
        responseType: 'arraybuffer',
        timeout: 60000,
        validateStatus: () => true,
      });
      if (fetchResp.status >= 400) return null;
      const buffer = Buffer.from(fetchResp.data as ArrayBuffer);
      const totalBytes = buffer.byteLength;

      // Determine media_category based on mime type
      const isVideo = mimeType.startsWith('video/');
      const isGif = mimeType === 'image/gif';
      const mediaCategory = isVideo ? 'tweet_video' : isGif ? 'tweet_gif' : 'tweet_image';

      const authHeader = { Authorization: `Bearer ${accessToken}` };

      // INIT
      const initForm = new URLSearchParams({
        command: 'INIT',
        total_bytes: String(totalBytes),
        media_type: mimeType,
        media_category: mediaCategory,
      });
      const initResp = await axios.post(MEDIA_UPLOAD_URL, initForm.toString(), {
        headers: { ...authHeader, 'Content-Type': 'application/x-www-form-urlencoded' },
        validateStatus: () => true,
        timeout: 15000,
      });
      if (initResp.status >= 400) return null;
      const mediaId: string = String((initResp.data as any)?.media_id_string || '');
      if (!mediaId) return null;

      // APPEND — upload in 5 MB chunks
      const chunkSize = 5 * 1024 * 1024;
      let segmentIndex = 0;
      for (let offset = 0; offset < totalBytes; offset += chunkSize) {
        const chunk = buffer.slice(offset, offset + chunkSize);
        const appendForm = new FormData();
        appendForm.append('command', 'APPEND');
        appendForm.append('media_id', mediaId);
        appendForm.append('segment_index', String(segmentIndex));
        appendForm.append(
          'media',
          new Blob([chunk], { type: mimeType }),
          `chunk_${segmentIndex}`
        );
        const appendResp = await axios.post(MEDIA_UPLOAD_URL, appendForm, {
          headers: authHeader,
          validateStatus: () => true,
          timeout: 60000,
        });
        if (appendResp.status >= 400) return null;
        segmentIndex++;
      }

      // FINALIZE
      const finalizeForm = new URLSearchParams({ command: 'FINALIZE', media_id: mediaId });
      const finalizeResp = await axios.post(MEDIA_UPLOAD_URL, finalizeForm.toString(), {
        headers: { ...authHeader, 'Content-Type': 'application/x-www-form-urlencoded' },
        validateStatus: () => true,
        timeout: 15000,
      });
      if (finalizeResp.status >= 400) return null;

      // Poll STATUS if processing is needed (video/gif)
      const finalData: any = finalizeResp.data || {};
      if (finalData?.processing_info?.state === 'pending' || finalData?.processing_info?.state === 'in_progress') {
        let checkAfterSecs = finalData.processing_info.check_after_secs ?? 2;
        for (let attempts = 0; attempts < 20; attempts++) {
          await new Promise((r) => setTimeout(r, checkAfterSecs * 1000));
          const statusResp = await axios.get(MEDIA_UPLOAD_URL, {
            params: { command: 'STATUS', media_id: mediaId },
            headers: authHeader,
            validateStatus: () => true,
            timeout: 15000,
          });
          const statusData: any = statusResp.data || {};
          const state = statusData?.processing_info?.state;
          if (state === 'succeeded') break;
          if (state === 'failed') return null;
          checkAfterSecs = statusData?.processing_info?.check_after_secs ?? 3;
        }
      }

      return mediaId;
    } catch {
      return null;
    }
  }

  async post(post: PostObject, ctx: PlatformContext): Promise<PlatformPostResult> {
    try {
      const helpers = (ctx.helpers || {}) as TwitterHelpers;

      // Global write counter guard — protects App ID across all SaaS users
      const limit = helpers.monthlyWriteLimit ?? Number(process.env.TWITTER_MONTHLY_WRITE_LIMIT || 0);
      if (limit > 0) {
        const count = helpers.getGlobalWriteCount?.() ?? 0;
        if (count >= limit) {
          return {
            status: 'failed',
            error: `Twitter / X posting paused: monthly write limit of ${limit} reached. Resets next billing cycle.`,
            retryable: false,
          };
        }
      }

      const text = String(post?.content?.text || '').trim().slice(0, TWITTER_MAX_TEXT);
      const body: Record<string, any> = { text };

      // Upload media if present (max 4 images or 1 video)
      const mediaItems = Array.isArray(post.media) ? post.media.slice(0, 4) : [];
      if (mediaItems.length > 0) {
        const mediaIds: string[] = [];
        for (const item of mediaItems) {
          const url = (item as any)?.url || (item as any)?.src || '';
          const mime = (item as any)?.mimeType || (item as any)?.mime_type || (item as any)?.type || 'image/jpeg';
          if (!url) continue;
          const mediaId = await this._uploadMedia(url, mime, ctx.accessToken);
          if (mediaId) mediaIds.push(mediaId);
        }
        if (mediaIds.length > 0) {
          body.media = { media_ids: mediaIds };
        }
      }

      const resp = await axios.post(
        'https://api.twitter.com/2/tweets',
        body,
        {
          headers: {
            Authorization: `Bearer ${ctx.accessToken}`,
            'Content-Type': 'application/json',
          },
          validateStatus: () => true,
          timeout: 15000,
        }
      );

      const rateMeta = {
        limit: resp.headers?.['x-rate-limit-limit'],
        remaining: resp.headers?.['x-rate-limit-remaining'],
        reset: resp.headers?.['x-rate-limit-reset'],
      };

      if (resp.status >= 400) {
        const errData: any = resp.data || {};
        return {
          status: 'failed',
          error: errData?.detail || errData?.title || `Twitter API error ${resp.status}`,
          retryable: isRetryableStatus(resp.status),
          raw: { ...errData, rateLimit: rateMeta },
        };
      }

      // Increment global write counter on success
      helpers.incrementGlobalWriteCount?.();

      const data: any = resp.data || {};
      return {
        status: 'published',
        platformPostId: data?.data?.id,
        raw: { ...data, rateLimit: rateMeta },
      };
    } catch (err) {
      const { retryable, message } = this.handleError(err);
      return { status: 'failed', error: message, retryable };
    }
  }

  async getPostAnalytics(postId: string, ctx: PlatformContext): Promise<AnalyticsResult> {
    try {
      const resp = await axios.get(
        `https://api.twitter.com/2/tweets/${encodeURIComponent(postId)}`,
        {
          params: {
            'tweet.fields': 'public_metrics,non_public_metrics,organic_metrics',
          },
          headers: { Authorization: `Bearer ${ctx.accessToken}` },
          validateStatus: () => true,
          timeout: 15000,
        }
      );
      const raw: any = resp.data || {};
      if (resp.status >= 400) return { raw };

      const pub = raw?.data?.public_metrics || {};
      const organic = raw?.data?.organic_metrics || {};
      return {
        likes: pub.like_count,
        comments: pub.reply_count,
        shares: pub.retweet_count + (pub.quote_count || 0),
        impressions: organic.impression_count ?? pub.impression_count,
        clicks: organic.url_link_clicks,
        raw: { public_metrics: pub, organic_metrics: organic },
      };
    } catch (err) {
      return { raw: { error: err instanceof Error ? err.message : 'Analytics fetch failed' } };
    }
  }

  // Twitter OAuth2 PKCE refresh token exchange
  async refreshToken(ctx: PlatformContext): Promise<TokenRefreshResult> {
    try {
      const helpers = (ctx.helpers || {}) as TwitterHelpers;
      const clientId = helpers.clientId || process.env.TWITTER_CLIENT_ID || '';
      const clientSecret = helpers.clientSecret || process.env.TWITTER_CLIENT_SECRET || '';
      if (!clientId || !clientSecret) return { ok: false, error: 'Twitter client credentials not configured.' };
      if (!ctx.refreshToken) return { ok: false, error: 'No refresh token available.' };

      const resp = await axios.post(
        'https://api.twitter.com/2/oauth2/token',
        new URLSearchParams({
          grant_type: 'refresh_token',
          refresh_token: ctx.refreshToken,
          client_id: clientId,
        }).toString(),
        {
          auth: { username: clientId, password: clientSecret },
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
          validateStatus: () => true,
          timeout: 15000,
        }
      );
      const data: any = resp.data || {};
      if (resp.status >= 400 || !data.access_token) {
        return { ok: false, error: data?.error_description || data?.error || 'Twitter token refresh failed.' };
      }
      const expiresAt = data.expires_in ? new Date(Date.now() + data.expires_in * 1000) : undefined;
      return { ok: true, accessToken: data.access_token, refreshToken: data.refresh_token, expiresAt };
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : 'Twitter token refresh failed.' };
    }
  }
}
