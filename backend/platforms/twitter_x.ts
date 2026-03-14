import axios from 'axios';
import type {
  PlatformContext,
  PlatformPostResult,
  PostObject,
  ValidationResult,
  SocialPlatform,
} from './types.js';

const TWITTER_MAX_TEXT = 280;

const isRetryableStatus = (status?: number) =>
  status === 429 || (typeof status === 'number' && status >= 500);

export class TwitterXPlatform implements SocialPlatform {
  id = 'twitter';
  name = 'Twitter / X';

  validate(post: PostObject): ValidationResult {
    const text = String(post?.content?.text || '').trim();
    if (!text) {
      return { ok: false, error: 'Twitter / X post requires text.' };
    }
    if (text.length > TWITTER_MAX_TEXT) {
      return { ok: false, error: 'Twitter / X text exceeds 280 characters.' };
    }
    const media = Array.isArray(post.media) ? post.media : [];
    if (media.length > 0) {
      return { ok: false, error: 'Twitter / X media uploads are not supported in this pipeline yet.' };
    }
    return { ok: true };
  }

  async post(post: PostObject, ctx: PlatformContext): Promise<PlatformPostResult> {
    try {
      const text = String(post?.content?.text || '').trim().slice(0, TWITTER_MAX_TEXT);
      const resp = await axios.post(
        'https://api.twitter.com/2/tweets',
        { text },
        {
          headers: { Authorization: `Bearer ${ctx.accessToken}`, 'Content-Type': 'application/json' },
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
          error: errData?.detail || `Twitter API error ${resp.status}`,
          retryable: isRetryableStatus(resp.status),
          raw: { ...errData, rateLimit: rateMeta },
        };
      }

      const data: any = resp.data || {};
      return { status: 'published', platformPostId: data?.data?.id, raw: { ...data, rateLimit: rateMeta } };
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Twitter / X post failed.';
      return { status: 'failed', error: msg, retryable: /timeout|ECONN|network/i.test(msg) };
    }
  }
}
