import axios, { AxiosResponse } from 'axios';
import FormData from 'form-data';
import type {
  AnalyticsResult,
  PlatformContext,
  PlatformPostResult,
  PostMedia,
  PostObject,
  SocialPlatform,
  TokenRefreshResult,
  ValidationResult,
} from './types.js';

// ─── Constants ───────────────────────────────────────────────────────────────

const TWITTER_MAX_TEXT = 280;
const TWEET_API = 'https://api.twitter.com/2/tweets';
const USERS_ME_API = 'https://api.twitter.com/2/users/me';
const MEDIA_UPLOAD_URL = 'https://upload.twitter.com/1.1/media/upload.json';
// Chunked upload for files above this threshold (5 MB)
const CHUNKED_THRESHOLD_BYTES = 5 * 1024 * 1024;
const CHUNK_SIZE_BYTES = 5 * 1024 * 1024;

const ALLOWED_IMAGE_TYPES = new Set(['image/jpeg', 'image/png', 'image/gif', 'image/webp']);
const ALLOWED_VIDEO_TYPES = new Set(['video/mp4', 'video/quicktime']);
const MAX_IMAGE_BYTES = 5 * 1024 * 1024;    // 5 MB
const MAX_VIDEO_BYTES = 512 * 1024 * 1024;  // 512 MB
const TRANSIENT_X_HTTP_STATUSES = new Set([429, 500, 502, 503, 504]);

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

// ─── X API error code helpers ────────────────────────────────────────────────

/** Parse the most useful message from an X API error response */
function parseXError(data: any, httpStatus: number): { message: string; code?: number; retryable: boolean } {
  const errors: any[] = data?.errors || [];
  const firstErr = errors[0] || {};
  const code: number | undefined = firstErr.code ?? data?.status;
  const title: string = data?.title || firstErr.title || '';
  const detail: string = data?.detail || firstErr.message || firstErr.detail || '';

  // Known X API v2 error codes
  const codeMessages: Record<number, string> = {
    32:  'Could not authenticate. Please reconnect your X account.',
    64:  'Your X account is suspended.',
    88:  'Rate limit reached. Try again in a few minutes.',
    89:  'Access token expired or invalid. Please reconnect your X account.',
    93:  'App is not allowed to access this resource.',
    135: 'Timestamp is out of bounds. Check server time.',
    161: 'Follow limit reached.',
    179: 'X post not found or not visible.',
    185: 'Daily post limit reached for this account.',
    186: 'Tweet text is too long.',
    187: 'Duplicate tweet — this exact text was posted recently.',
    215: 'Bad authentication data.',
    226: 'This tweet appears automated. Vary content to avoid detection.',
    261: 'Application cannot perform write actions.',
    326: 'X account locked. Please unlock at x.com.',
  };

  const authErrors = new Set([32, 64, 89, 215]);
  const retryable = httpStatus === 429 || httpStatus >= 500 || code === 88;

  let message = codeMessages[code!] || detail || title || `X API error (HTTP ${httpStatus})`;
  if (code && !codeMessages[code]) message = `X API error ${code}: ${message}`;

  return { message, code, retryable };
}

// ─── Media upload helpers ────────────────────────────────────────────────────

type UploadResult = { mediaId: string } | { error: string };

/** Simple (non-chunked) multipart upload — best for images < 5 MB */
async function uploadSimple(
  buffer: Buffer,
  mimeType: string,
  mediaCategory: string,
  authHeader: Record<string, string>,
  log: (msg: string) => void
): Promise<UploadResult> {
  const form = new FormData();
  form.append('media', buffer, { filename: 'upload', contentType: mimeType });
  form.append('media_category', mediaCategory);

  log(`[X] Simple media upload (${Math.round(buffer.byteLength / 1024)} KB)`);
  const resp: AxiosResponse = await axios.post(MEDIA_UPLOAD_URL, form, {
    headers: { ...authHeader, ...form.getHeaders() },
    validateStatus: () => true,
    timeout: 60_000,
  });

  if (resp.status >= 400) {
    return { error: `Media upload failed (${resp.status}): ${(resp.data as any)?.error || ''}` };
  }
  const mediaId = String((resp.data as any)?.media_id_string || '');
  if (!mediaId) return { error: 'No media_id in upload response' };
  log(`[X] Simple upload OK, media_id=${mediaId}`);
  return { mediaId };
}

/** Chunked INIT/APPEND/FINALIZE/STATUS — for large files and videos/GIFs */
async function uploadChunked(
  buffer: Buffer,
  mimeType: string,
  mediaCategory: string,
  authHeader: Record<string, string>,
  log: (msg: string) => void
): Promise<UploadResult> {
  const totalBytes = buffer.byteLength;
  log(`[X] Chunked upload start (${Math.round(totalBytes / 1024 / 1024 * 10) / 10} MB, ${mimeType})`);

  // INIT
  const initForm = new URLSearchParams({
    command: 'INIT',
    total_bytes: String(totalBytes),
    media_type: mimeType,
    media_category: mediaCategory,
  });
  const initResp: AxiosResponse = await axios.post(MEDIA_UPLOAD_URL, initForm.toString(), {
    headers: { ...authHeader, 'Content-Type': 'application/x-www-form-urlencoded' },
    validateStatus: () => true,
    timeout: 15_000,
  });
  if (initResp.status >= 400) {
    return { error: `Media INIT failed (${initResp.status})` };
  }
  const mediaId = String((initResp.data as any)?.media_id_string || '');
  if (!mediaId) return { error: 'No media_id from INIT' };
  log(`[X] INIT OK, media_id=${mediaId}`);

  // APPEND
  let segmentIndex = 0;
  for (let offset = 0; offset < totalBytes; offset += CHUNK_SIZE_BYTES) {
    const chunk = buffer.slice(offset, offset + CHUNK_SIZE_BYTES);
    const appendForm = new FormData();
    appendForm.append('command', 'APPEND');
    appendForm.append('media_id', mediaId);
    appendForm.append('segment_index', String(segmentIndex));
    appendForm.append('media', chunk, { filename: `seg_${segmentIndex}`, contentType: mimeType });

    const appendResp: AxiosResponse = await axios.post(MEDIA_UPLOAD_URL, appendForm, {
      headers: { ...authHeader, ...appendForm.getHeaders() },
      validateStatus: () => true,
      timeout: 120_000,
    });
    if (appendResp.status >= 400) {
      return { error: `Media APPEND failed at segment ${segmentIndex} (${appendResp.status})` };
    }
    log(`[X] APPEND segment ${segmentIndex} OK`);
    segmentIndex++;
  }

  // FINALIZE
  const finalizeForm = new URLSearchParams({ command: 'FINALIZE', media_id: mediaId });
  const finalizeResp: AxiosResponse = await axios.post(MEDIA_UPLOAD_URL, finalizeForm.toString(), {
    headers: { ...authHeader, 'Content-Type': 'application/x-www-form-urlencoded' },
    validateStatus: () => true,
    timeout: 15_000,
  });
  if (finalizeResp.status >= 400) {
    return { error: `Media FINALIZE failed (${finalizeResp.status})` };
  }
  log(`[X] FINALIZE OK`);

  // STATUS polling (async processing for video/GIF)
  const finalData: any = finalizeResp.data || {};
  if (finalData?.processing_info) {
    let waitSecs = finalData.processing_info.check_after_secs ?? 3;
    for (let attempt = 0; attempt < 30; attempt++) {
      await new Promise((r) => setTimeout(r, waitSecs * 1000));
      const statusResp: AxiosResponse = await axios.get(MEDIA_UPLOAD_URL, {
        params: { command: 'STATUS', media_id: mediaId },
        headers: authHeader,
        validateStatus: () => true,
        timeout: 15_000,
      });
      const statusData: any = statusResp.data || {};
      const state: string = statusData?.processing_info?.state || '';
      log(`[X] STATUS poll #${attempt + 1}: ${state}`);
      if (state === 'succeeded') break;
      if (state === 'failed') {
        const reason = statusData?.processing_info?.error?.message || 'Processing failed';
        return { error: `Media processing failed: ${reason}` };
      }
      waitSecs = statusData?.processing_info?.check_after_secs ?? 3;
    }
  }

  return { mediaId };
}

/** Fetch, validate, and upload a single PostMedia item. Returns media_id or null. */
async function uploadMediaItem(
  item: PostMedia,
  accessToken: string,
  log: (msg: string) => void
): Promise<string | null> {
  const url = item.url || '';
  if (!url) return null;

  // Fetch the file
  let buffer: Buffer;
  let detectedMime: string;
  try {
    const fetchResp: AxiosResponse = await axios.get(url, {
      responseType: 'arraybuffer',
      validateStatus: () => true,
      timeout: 60_000,
    });
    if (fetchResp.status >= 400) {
      log(`[X] Failed to fetch media (${fetchResp.status}): ${url}`);
      return null;
    }
    buffer = Buffer.from(fetchResp.data as ArrayBuffer);
    // Prefer explicit mimeType, fall back to Content-Type header
    detectedMime = item.mimeType || String(fetchResp.headers['content-type'] || '').split(';')[0].trim() || 'image/jpeg';
  } catch (err) {
    log(`[X] Media fetch error: ${err instanceof Error ? err.message : err}`);
    return null;
  }

  // Validate type and size
  const isVideo = ALLOWED_VIDEO_TYPES.has(detectedMime) || item.type === 'video';
  const isGif = detectedMime === 'image/gif' || item.type === 'gif';
  const isImage = !isVideo && !isGif;

  if (isImage && !ALLOWED_IMAGE_TYPES.has(detectedMime)) {
    log(`[X] Unsupported image MIME type: ${detectedMime} — skipping`);
    return null;
  }
  if (isVideo && !ALLOWED_VIDEO_TYPES.has(detectedMime)) {
    log(`[X] Unsupported video MIME type: ${detectedMime} — skipping`);
    return null;
  }
  if (isImage && buffer.byteLength > MAX_IMAGE_BYTES) {
    log(`[X] Image too large (${Math.round(buffer.byteLength / 1024 / 1024 * 10) / 10} MB > 5 MB) — skipping`);
    return null;
  }
  if (isVideo && buffer.byteLength > MAX_VIDEO_BYTES) {
    log(`[X] Video too large (> 512 MB) — skipping`);
    return null;
  }

  const mediaCategory = isVideo ? 'tweet_video' : isGif ? 'tweet_gif' : 'tweet_image';
  const authHeader = { Authorization: `Bearer ${accessToken}` };

  // Use simple upload for small images, chunked for everything else
  const useChunked = isVideo || isGif || buffer.byteLength > CHUNKED_THRESHOLD_BYTES;
  const result: UploadResult = useChunked
    ? await uploadChunked(buffer, detectedMime, mediaCategory, authHeader, log)
    : await uploadSimple(buffer, detectedMime, mediaCategory, authHeader, log);

  if ('error' in result) {
    log(`[X] Media upload failed: ${result.error}`);
    return null;
  }
  return result.mediaId;
}

// ─── TwitterHelpers type ─────────────────────────────────────────────────────

type TwitterHelpers = {
  getGlobalWriteCount?: () => number;
  incrementGlobalWriteCount?: () => void;
  monthlyWriteLimit?: number;
  clientId?: string;
  clientSecret?: string;
};

// ─── Platform implementation ─────────────────────────────────────────────────

export class TwitterXPlatform implements SocialPlatform {
  id = 'twitter';
  name = 'Twitter / X';

  handleError(error: any): { retryable: boolean; message: string } {
    const status: number | undefined = error?.response?.status;
    const data = error?.response?.data;
    if (data) {
      const parsed = parseXError(data, status ?? 0);
      return { retryable: parsed.retryable, message: parsed.message };
    }
    const msg = error instanceof Error ? error.message : 'Twitter / X error';
    const retryable = status === 429 || (typeof status === 'number' && status >= 500);
    return { retryable, message: msg };
  }

  validate(post: PostObject): ValidationResult {
    const text = String(post?.content?.text || '').trim();
    if (!text) return { ok: false, error: 'X post requires text.', code: 'TEXT_REQUIRED' };
    if (text.length > TWITTER_MAX_TEXT) {
      return { ok: false, error: `X text exceeds ${TWITTER_MAX_TEXT} characters (${text.length}).`, code: 'TEXT_TOO_LONG' };
    }
    const media = Array.isArray(post.media) ? post.media : [];
    if (media.length > 4) {
      return { ok: false, error: 'X supports up to 4 images or 1 video per tweet.', code: 'MEDIA_LIMIT' };
    }
    return { ok: true };
  }

  async post(post: PostObject, ctx: PlatformContext): Promise<PlatformPostResult> {
    const log = ctx.logger?.info.bind(ctx.logger) ?? ((...args: any[]) => console.log('[TwitterXPlatform]', ...args));

    try {
      const helpers = (ctx.helpers || {}) as TwitterHelpers;

      // Global write counter guard
      const limit = helpers.monthlyWriteLimit ?? Number(process.env.TWITTER_MONTHLY_WRITE_LIMIT || 0);
      if (limit > 0) {
        const count = helpers.getGlobalWriteCount?.() ?? 0;
        if (count >= limit) {
          return {
            status: 'failed',
            error: `X posting paused: monthly write limit of ${limit} reached.`,
            retryable: false,
          };
        }
      }

      const text = String(post?.content?.text || '').trim().slice(0, TWITTER_MAX_TEXT);
      const body: Record<string, any> = { text };

      // Upload media (failures are non-fatal — tweet posts without media rather than failing)
      const mediaItems = Array.isArray(post.media) ? post.media.slice(0, 4) : [];
      if (mediaItems.length > 0) {
        log(`[X] Uploading ${mediaItems.length} media item(s)…`);
        const mediaIds: string[] = [];
        for (const item of mediaItems) {
          const mediaId = await uploadMediaItem(item, ctx.accessToken, log);
          if (mediaId) mediaIds.push(mediaId);
        }
        if (mediaIds.length > 0) {
          body.media = { media_ids: mediaIds };
          log(`[X] Attached media_ids: ${mediaIds.join(', ')}`);
        } else {
          log('[X] All media uploads failed — posting text only');
        }
      }

      log(`[X] POST /2/tweets text="${text.slice(0, 60)}…"`);
      for (let attempt = 1; attempt <= 2; attempt++) {
        try {
          const resp: AxiosResponse = await axios.post(TWEET_API, body, {
            headers: {
              Authorization: `Bearer ${ctx.accessToken}`,
              'Content-Type': 'application/json',
            },
            validateStatus: () => true,
            timeout: 20_000,
          });

          const rateMeta = {
            limit: resp.headers?.['x-rate-limit-limit'],
            remaining: resp.headers?.['x-rate-limit-remaining'],
            reset: resp.headers?.['x-rate-limit-reset'],
          };

          if (resp.status >= 400) {
            const { message, retryable } = parseXError(resp.data, resp.status);
            const shouldRetryNow =
              retryable && attempt < 2 && TRANSIENT_X_HTTP_STATUSES.has(resp.status);
            log(`[X] Tweet failed (${resp.status}): ${message}`);
            if (shouldRetryNow) {
              log('[X] Retrying transient failure in 2s');
              await wait(2000);
              continue;
            }
            return { status: 'failed', error: message, retryable, raw: { ...resp.data, rateLimit: rateMeta } };
          }

          helpers.incrementGlobalWriteCount?.();
          const data: any = resp.data || {};
          const tweetId: string = data?.data?.id || '';
          log(`[X] Tweet published, id=${tweetId}`);
          return { status: 'published', platformPostId: tweetId, raw: { ...data, rateLimit: rateMeta } };
        } catch (err: any) {
          const { retryable, message } = this.handleError(err);
          const status = Number(err?.response?.status);
          const shouldRetryNow =
            retryable && attempt < 2 && TRANSIENT_X_HTTP_STATUSES.has(status);
          if (shouldRetryNow) {
            log(`[X] Request error on attempt ${attempt}: ${message}. Retrying in 2s`);
            await wait(2000);
            continue;
          }
          return { status: 'failed', error: message, retryable };
        }
      }

      return { status: 'failed', error: 'X publish failed after retry', retryable: true };
    } catch (err) {
      const { retryable, message } = this.handleError(err);
      return { status: 'failed', error: message, retryable };
    }
  }

  async getPostAnalytics(postId: string, ctx: PlatformContext): Promise<AnalyticsResult> {
    try {
      const resp: AxiosResponse = await axios.get(`https://api.twitter.com/2/tweets/${encodeURIComponent(postId)}`, {
        params: {
          'tweet.fields': 'public_metrics,non_public_metrics,organic_metrics,created_at',
        },
        headers: { Authorization: `Bearer ${ctx.accessToken}` },
        validateStatus: () => true,
        timeout: 15_000,
      });
      const raw: any = resp.data || {};
      if (resp.status >= 400) return { raw };

      const pub = raw?.data?.public_metrics || {};
      // organic_metrics only available for owned tweets with elevated access
      const organic = raw?.data?.organic_metrics || {};
      return {
        likes: pub.like_count,
        comments: pub.reply_count,
        shares: (pub.retweet_count || 0) + (pub.quote_count || 0),
        impressions: organic.impression_count ?? pub.impression_count,
        clicks: organic.url_link_clicks,
        raw: { public_metrics: pub, organic_metrics: organic },
      };
    } catch (err) {
      return { raw: { error: err instanceof Error ? err.message : 'Analytics fetch failed' } };
    }
  }

  async refreshToken(ctx: PlatformContext): Promise<TokenRefreshResult> {
    try {
      const helpers = (ctx.helpers || {}) as TwitterHelpers;
      const clientId = (helpers.clientId || process.env.TWITTER_CLIENT_ID || process.env.VITE_TWITTER_CLIENT_ID || '').trim();
      const clientSecret = (helpers.clientSecret || process.env.TWITTER_CLIENT_SECRET || '').trim();

      if (!clientId) return { ok: false, error: 'Twitter client_id not configured.' };
      if (!ctx.refreshToken) return { ok: false, error: 'No refresh token available. Please reconnect your X account.' };

      const data = new URLSearchParams({
        grant_type: 'refresh_token',
        refresh_token: ctx.refreshToken,
        client_id: clientId,
      });

      const axiosCfg: any = {
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        validateStatus: () => true,
        timeout: 15_000,
      };
      // Basic auth required when client_secret is present
      if (clientSecret) axiosCfg.auth = { username: clientId, password: clientSecret };

      const resp: AxiosResponse = await axios.post('https://api.twitter.com/2/oauth2/token', data.toString(), axiosCfg);
      const body: any = resp.data || {};

      if (resp.status >= 400 || !body.access_token) {
        return { ok: false, error: body?.error_description || body?.error || 'Token refresh failed.' };
      }

      const expiresAt = body.expires_in ? new Date(Date.now() + Number(body.expires_in) * 1000) : undefined;
      return { ok: true, accessToken: body.access_token, refreshToken: body.refresh_token, expiresAt };
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : 'Token refresh failed.' };
    }
  }
}
