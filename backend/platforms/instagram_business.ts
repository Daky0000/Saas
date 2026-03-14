import axios from 'axios';
import type {
  PlatformContext,
  PlatformPostResult,
  PostObject,
  ValidationResult,
  SocialPlatform,
} from './types.js';

type InstagramHelpers = {
  graphBase?: string;
};

const INSTAGRAM_MAX_CAPTION = 2200;

const isRetryableStatus = (status?: number) =>
  status === 429 || (typeof status === 'number' && status >= 500);

export class InstagramBusinessPlatform implements SocialPlatform {
  id = 'instagram';
  name = 'Instagram Business';

  validate(post: PostObject): ValidationResult {
    const text = String(post?.content?.text || '').trim();
    if (text.length > INSTAGRAM_MAX_CAPTION) {
      return { ok: false, error: 'Instagram caption exceeds max 2,200 characters.' };
    }

    const media = Array.isArray(post.media) ? post.media : [];
    if (!media.length) {
      return { ok: false, error: 'Instagram publishing requires at least one image.' };
    }

    if (media.length > 1) {
      return { ok: false, error: 'Instagram multi-image posts are not supported in this pipeline yet.' };
    }

    const item = media[0];
    const mime = String(item?.mimeType || '').toLowerCase();
    const isImage = item?.type === 'image' || mime.startsWith('image/');
    if (!isImage) {
      return { ok: false, error: 'Instagram publishing currently supports images only.' };
    }

    return { ok: true };
  }

  async post(post: PostObject, ctx: PlatformContext): Promise<PlatformPostResult> {
    try {
      const igUserId = String(ctx.accountId || '').trim();
      if (!igUserId) {
        return { status: 'failed', error: 'Instagram account id is missing.' };
      }

      const helpers = (ctx.helpers || {}) as InstagramHelpers;
      const graphBase = helpers.graphBase || 'https://graph.facebook.com/v19.0';
      const media = Array.isArray(post.media) ? post.media : [];
      const item = media[0];
      if (!item?.url) {
        return { status: 'failed', error: 'Instagram image URL is missing.' };
      }

      const caption = String(post?.content?.text || '').trim();
      const createBody = new URLSearchParams({
        image_url: item.url,
        caption,
        access_token: ctx.accessToken,
      });
      const createResp = await axios.post(
        `${graphBase}/${encodeURIComponent(igUserId)}/media`,
        createBody.toString(),
        {
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
          validateStatus: () => true,
          timeout: 20000,
        }
      );
      const createData: any = createResp.data || {};
      if (createResp.status >= 400) {
        const msg = createData?.error?.message || `Instagram create media failed (${createResp.status})`;
        return {
          status: 'failed',
          error: msg,
          code: createData?.error?.code ? String(createData.error.code) : undefined,
          retryable: isRetryableStatus(createResp.status),
          raw: createData,
        };
      }

      const creationId = String(createData?.id || '').trim();
      if (!creationId) {
        return { status: 'failed', error: 'Instagram create media did not return a creation id.' };
      }

      const publishBody = new URLSearchParams({
        creation_id: creationId,
        access_token: ctx.accessToken,
      });
      const pubResp = await axios.post(
        `${graphBase}/${encodeURIComponent(igUserId)}/media_publish`,
        publishBody.toString(),
        {
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
          validateStatus: () => true,
          timeout: 20000,
        }
      );
      const pubData: any = pubResp.data || {};
      if (pubResp.status >= 400) {
        const msg = pubData?.error?.message || `Instagram publish failed (${pubResp.status})`;
        return {
          status: 'failed',
          error: msg,
          code: pubData?.error?.code ? String(pubData.error.code) : undefined,
          retryable: isRetryableStatus(pubResp.status),
          raw: pubData,
        };
      }

      const igPostId = String(pubData?.id || '').trim();
      return { status: 'published', platformPostId: igPostId || creationId, raw: pubData };
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Instagram post failed.';
      return { status: 'failed', error: msg, retryable: /timeout|ECONN|network/i.test(msg) };
    }
  }
}
