import axios from 'axios';
import type {
  PlatformContext,
  PlatformPostResult,
  PostObject,
  ValidationResult,
  SocialPlatform,
} from './types.js';

type ResolvePageTokenResult = {
  pageId: string;
  pageToken: string;
  pageName?: string;
};

type FacebookHelpers = {
  resolvePageToken?: (destination?: { type?: string; id?: string; name?: string }) => Promise<ResolvePageTokenResult | null>;
  graphBase?: string;
};

const FACEBOOK_MAX_TEXT = 63206;
const FACEBOOK_SUPPORTED_MEDIA = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/gif', 'video/mp4']);

const isRetryableStatus = (status?: number) =>
  status === 429 || (typeof status === 'number' && status >= 500);

export class FacebookPagesPlatform implements SocialPlatform {
  id = 'facebook';
  name = 'Facebook Pages';

  validate(post: PostObject): ValidationResult {
    const text = String(post?.content?.text || '').trim();
    const link = String(post?.content?.link || '').trim();

    if (!text && !link) {
      return { ok: false, error: 'Facebook post requires text or a link.' };
    }

    if (text.length > FACEBOOK_MAX_TEXT) {
      return { ok: false, error: 'Facebook text exceeds max 63,206 characters.' };
    }

    const media = Array.isArray(post.media) ? post.media : [];
    if (media.length > 1) {
      return { ok: false, error: 'Facebook multi-media posts are not supported yet.' };
    }

    if (media.length === 1) {
      const item = media[0];
      const mime = String(item?.mimeType || '').toLowerCase();
      if (mime && !FACEBOOK_SUPPORTED_MEDIA.has(mime)) {
        return { ok: false, error: 'Unsupported media type for Facebook.' };
      }
    }

    return { ok: true };
  }

  async post(post: PostObject, ctx: PlatformContext): Promise<PlatformPostResult> {
    try {
      const helpers = (ctx.helpers || {}) as FacebookHelpers;
      const resolvePageToken = helpers.resolvePageToken;
      if (!resolvePageToken) {
        return { status: 'failed', error: 'Facebook resolver not configured.' };
      }

      const destination = post?.destination || undefined;
      if (destination?.type && destination.type !== 'page') {
        return { status: 'failed', error: 'Facebook Pages only. Groups and profiles are not supported.' };
      }

      const page = await resolvePageToken(destination);
      if (!page?.pageId || !page.pageToken) {
        return { status: 'failed', error: 'Facebook Page access not available.' };
      }

      const graphBase = helpers.graphBase || 'https://graph.facebook.com/v19.0';
      const text = String(post?.content?.text || '').trim();
      const link = String(post?.content?.link || '').trim();
      const media = Array.isArray(post.media) ? post.media : [];

      if (media.length === 1) {
        const item = media[0];
        const mime = String(item?.mimeType || '').toLowerCase();
        const isImage = item?.type === 'image' || mime.startsWith('image/');
        if (isImage && item?.url) {
          const body = new URLSearchParams({
            url: item.url,
            caption: text,
            access_token: page.pageToken,
            published: 'true',
          });
          const resp = await axios.post(
            `${graphBase}/${encodeURIComponent(page.pageId)}/photos`,
            body.toString(),
            {
              headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
              validateStatus: () => true,
              timeout: 20000,
            }
          );
          const respData: any = resp.data || {};
          if (resp.status >= 400) {
            return {
              status: 'failed',
              error: respData?.error?.message || `Facebook API error ${resp.status}`,
              code: respData?.error?.code ? String(respData.error.code) : undefined,
              retryable: isRetryableStatus(resp.status),
              raw: respData,
            };
          }
          return { status: 'published', platformPostId: String(respData?.id || ''), raw: respData };
        }

        if (mime && mime.startsWith('video/')) {
          return { status: 'failed', error: 'Facebook video uploads are not implemented in this pipeline yet.' };
        }
      }

      const body = new URLSearchParams({
        message: text,
        ...(link ? { link } : {}),
        access_token: page.pageToken,
      });
      const resp = await axios.post(
        `${graphBase}/${encodeURIComponent(page.pageId)}/feed`,
        body.toString(),
        {
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
          validateStatus: () => true,
          timeout: 15000,
        }
      );
      const respData: any = resp.data || {};
      if (resp.status >= 400) {
        return {
          status: 'failed',
          error: respData?.error?.message || `Facebook API error ${resp.status}`,
          code: respData?.error?.code ? String(respData.error.code) : undefined,
          retryable: isRetryableStatus(resp.status),
          raw: respData,
        };
      }
      return { status: 'published', platformPostId: String(respData?.id || ''), raw: respData };
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Facebook post failed.';
      return { status: 'failed', error: msg, retryable: /timeout|ECONN|network/i.test(msg) };
    }
  }
}
