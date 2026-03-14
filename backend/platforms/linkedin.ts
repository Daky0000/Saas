import axios from 'axios';
import type {
  PlatformContext,
  PlatformPostResult,
  PostObject,
  ValidationResult,
  SocialPlatform,
} from './types.js';

type LinkedInHelpers = {
  resolveAuthorUrn?: (ctx: PlatformContext) => Promise<string | null>;
};

const LINKEDIN_MAX_TEXT = 3000;

const isRetryableStatus = (status?: number) =>
  status === 429 || (typeof status === 'number' && status >= 500);

export class LinkedInPlatform implements SocialPlatform {
  id = 'linkedin';
  name = 'LinkedIn';

  validate(post: PostObject): ValidationResult {
    const text = String(post?.content?.text || '').trim();
    if (text.length > LINKEDIN_MAX_TEXT) {
      return { ok: false, error: 'LinkedIn text exceeds max 3,000 characters.' };
    }

    const media = Array.isArray(post.media) ? post.media : [];
    if (media.length > 0) {
      return { ok: false, error: 'LinkedIn media posts are not supported in this pipeline yet.' };
    }

    if (!text) {
      return { ok: false, error: 'LinkedIn post requires text.' };
    }

    return { ok: true };
  }

  async post(post: PostObject, ctx: PlatformContext): Promise<PlatformPostResult> {
    try {
      const helpers = (ctx.helpers || {}) as LinkedInHelpers;
      let authorUrn: string | null = null;

      if (ctx.tokenData?.sub) {
        authorUrn = `urn:li:person:${ctx.tokenData.sub}`;
      }

      if (!authorUrn && helpers.resolveAuthorUrn) {
        authorUrn = await helpers.resolveAuthorUrn(ctx);
      }

      if (!authorUrn) {
        const meResp = await axios.get('https://api.linkedin.com/v2/me', {
          headers: { Authorization: `Bearer ${ctx.accessToken}` },
          validateStatus: () => true,
          timeout: 15000,
        });
        if (meResp.status >= 400) {
          return {
            status: 'failed',
            error: `LinkedIn profile lookup failed (${meResp.status})`,
            retryable: isRetryableStatus(meResp.status),
            raw: meResp.data,
          };
        }
        const meData: any = meResp.data || {};
        const meId = String(meData?.id || '').trim();
        if (!meId) {
          return { status: 'failed', error: 'LinkedIn profile ID not available.' };
        }
        authorUrn = `urn:li:person:${meId}`;
      }

      const text = String(post?.content?.text || '').trim();
      const body = {
        author: authorUrn,
        lifecycleState: 'PUBLISHED',
        specificContent: {
          'com.linkedin.ugc.ShareContent': {
            shareCommentary: { text },
            shareMediaCategory: 'NONE',
          },
        },
        visibility: { 'com.linkedin.ugc.MemberNetworkVisibility': 'PUBLIC' },
      };

      const resp = await axios.post('https://api.linkedin.com/v2/ugcPosts', body, {
        headers: {
          Authorization: `Bearer ${ctx.accessToken}`,
          'Content-Type': 'application/json',
          'X-Restli-Protocol-Version': '2.0.0',
        },
        validateStatus: () => true,
        timeout: 15000,
      });

      if (resp.status >= 400) {
        const errData: any = resp.data || {};
        return {
          status: 'failed',
          error: errData?.message || `LinkedIn API error ${resp.status}`,
          retryable: isRetryableStatus(resp.status),
          raw: errData,
        };
      }

      const data: any = resp.data || {};
      return { status: 'published', platformPostId: data?.id, raw: data };
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'LinkedIn post failed.';
      return { status: 'failed', error: msg, retryable: /timeout|ECONN|network/i.test(msg) };
    }
  }
}
