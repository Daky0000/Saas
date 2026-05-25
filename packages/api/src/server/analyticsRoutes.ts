import axios from 'axios';
import type { Request, Response } from 'express';
import { Router } from 'express';
import type { Pool } from 'pg';
import { logger } from '../logger.ts';

const LINKEDIN_MARKETING_VERSION = String(process.env.LINKEDIN_API_VERSION || '202603').trim() || '202603';
function getLinkedInRestHeaders(accessToken: string, contentType = 'application/json'): Record<string, string> {
  const headers: Record<string, string> = {
    Authorization: `Bearer ${accessToken}`,
    'X-Restli-Protocol-Version': '2.0.0',
    'LinkedIn-Version': LINKEDIN_MARKETING_VERSION,
  };
  if (contentType) headers['Content-Type'] = contentType;
  return headers;
}

// ─── Deps ─────────────────────────────────────────────────────────────────────

export interface AnalyticsDeps {
  requireAuth: (req: Request, res: Response) => { userId: string; role: string; tokenVersion: number | null } | null;
  pool: Pool | null;
  decryptIntegrationSecret: (encrypted: string) => string;
  getPublishableSocialConnection: (userId: string, platformId: string) => Promise<any>;
}

// ─── Module-level constants ───────────────────────────────────────────────────

const META_GRAPH_BASE = 'https://graph.facebook.com/v19.0';
const INSTAGRAM_PROFILE_FIELDS = 'id,username,name,account_type,biography,followers_count,follows_count,media_count,profile_picture_url,website,is_verified';

// ─── Pure helpers ─────────────────────────────────────────────────────────────

function parseAnalyticsRange(preset: string | undefined, startStr: string | undefined, endStr: string | undefined) {
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  let start: Date, end: Date, label: string;
  const p = preset || '30d';
  if (p === 'custom' && startStr && endStr) {
    start = new Date(startStr);
    end = new Date(endStr);
    label = `${startStr} – ${endStr}`;
  } else if (p === '7d') {
    start = new Date(today); start.setDate(start.getDate() - 6);
    end = today; label = 'Last 7 days';
  } else if (p === '90d') {
    start = new Date(today); start.setDate(start.getDate() - 89);
    end = today; label = 'Last 90 days';
  } else {
    start = new Date(today); start.setDate(start.getDate() - 29);
    end = today; label = 'Last 30 days';
  }
  const days = Math.round((end.getTime() - start.getTime()) / 86400000) + 1;
  const prevEnd = new Date(start); prevEnd.setDate(prevEnd.getDate() - 1);
  const prevStart = new Date(prevEnd); prevStart.setDate(prevStart.getDate() - days + 1);
  return {
    preset: p as '7d' | '30d' | '90d' | 'custom',
    start, end, label, days, prevStart, prevEnd,
    startIso: start.toISOString(),
    endIso: new Date(end.getTime() + 86399999).toISOString(),
    prevStartIso: prevStart.toISOString(),
    prevEndIso: new Date(prevEnd.getTime() + 86399999).toISOString(),
  };
}

function analyticsPlatformLabel(platform: string): string {
  const map: Record<string, string> = {
    facebook: 'Facebook', instagram: 'Instagram', twitter: 'X (Twitter)',
    linkedin: 'LinkedIn', pinterest: 'Pinterest', threads: 'Threads',
    tiktok: 'TikTok', wordpress: 'WordPress',
  };
  return map[platform?.toLowerCase()] || platform;
}

function analyticsFmtDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

// ─── TikTok profile fetcher ───────────────────────────────────────────────────

async function fetchTikTokUserProfile(token: string): Promise<{ user: any; scopeLimited: boolean }> {
  const ttGet = (fields: string) =>
    axios.get('https://open.tiktokapis.com/v2/user/info/', {
      headers: { Authorization: `Bearer ${token}` },
      params: { fields },
      validateStatus: () => true,
      timeout: 15000,
    });

  // ── Call 1: user.info.basic fields only — always required ─────────────────
  // IMPORTANT: only request fields covered by user.info.basic here.
  // TikTok rejects the entire request if any field requires a scope the token
  // doesn't have. Fields like username/bio_description/is_verified need
  // user.info.profile and must NOT be mixed into this call.
  const basicResp = await ttGet('open_id,display_name');
  const basicErr  = basicResp.data?.error?.code;
  if (basicResp.status !== 200 || (basicErr && basicErr !== 'ok') || !basicResp.data?.data?.user) {
    const msg = basicResp.data?.error?.message || basicErr || `HTTP ${basicResp.status}`;
    throw new Error(msg || 'TikTok user info unavailable');
  }
  const user: any = { ...basicResp.data.data.user };

  // ── Call 2: user.info.profile fields — optional ───────────────────────────
  // username, bio_description, is_verified require the user.info.profile scope.
  try {
    const profileResp = await ttGet('username,bio_description,is_verified');
    const profileErr  = profileResp.data?.error?.code;
    if (profileResp.status === 200 && (!profileErr || profileErr === 'ok') && profileResp.data?.data?.user) {
      const p = profileResp.data.data.user;
      if (p.username        != null) user.username        = p.username;
      if (p.bio_description != null) user.bio_description = p.bio_description;
      if (p.is_verified     != null) user.is_verified     = p.is_verified;
    }
  } catch (profileErr: any) {
    logger.info('[TikTok profile] user.info.profile exception:', profileErr?.message);
  }

  // ── Call 3: user.info.stats fields — optional ─────────────────────────────
  // TikTok hard-rejects the whole request if stats scope isn't approved,
  // so we ask for stats separately and silently ignore any error.
  try {
    const statsResp = await ttGet('follower_count,following_count,likes_count,video_count');
    const statsErr  = statsResp.data?.error?.code;
    logger.info('[TikTok stats] status:', statsResp.status, 'error:', statsErr, 'user:', JSON.stringify(statsResp.data?.data?.user));
    if (statsResp.status === 200 && (!statsErr || statsErr === 'ok') && statsResp.data?.data?.user) {
      const s = statsResp.data.data.user;
      if (s.follower_count  != null) user.follower_count  = s.follower_count;
      if (s.following_count != null) user.following_count = s.following_count;
      if (s.likes_count     != null) user.likes_count     = s.likes_count;
      if (s.video_count     != null) user.video_count     = s.video_count;
    }
  } catch (statsErr: any) {
    logger.info('[TikTok stats] exception:', statsErr?.message);
  }

  logger.info('[TikTok profile] final user object:', JSON.stringify(user));
  const hasStats = user.follower_count != null;
  return { user, scopeLimited: !hasStats };
}

// ─── Factory ──────────────────────────────────────────────────────────────────

export function registerAnalyticsRoutes(deps: AnalyticsDeps): Router {
  const { requireAuth, pool, decryptIntegrationSecret, getPublishableSocialConnection } = deps;
  const router = Router();

  // Tiny wrapper — silently returns '' on decrypt failure
  function decodeStoredIntegrationSecret(value: string | null | undefined): string {
    const raw = String(value || '').trim();
    if (!raw) return '';
    try { return decryptIntegrationSecret(raw); } catch (err) { logger.error('Unhandled error:', err); return ''; }
  }

  // ─── Sync helpers ──────────────────────────────────────────────────────────

async function syncInstagramAnalyticsAccount(params: {
  userId: string;
  account: any;
  days?: number;
}): Promise<{ synced: number; errors: string[] }> {
  const { userId, account } = params;
  const days = Math.max(1, Number(params.days || 30));
  const errors: string[] = [];
  let synced = 0;

  let accessToken = decodeStoredIntegrationSecret(account?.access_token_encrypted);
  if (!accessToken) accessToken = String(account?.access_token || '').trim();
  const instagramId = String(account?.account_id || '').trim();
  const accountTokenData = account?.token_data || {};

  if (!accessToken) return { synced, errors: ['Instagram access token missing or expired — reconnect Instagram.'] };
  if (!instagramId) return { synced, errors: ['Instagram account ID missing from saved connection.'] };

  let profile: any = null;
  try {
    const profileResp = await axios.get(`${META_GRAPH_BASE}/${encodeURIComponent(instagramId)}`, {
      params: {
        fields: INSTAGRAM_PROFILE_FIELDS,
        access_token: accessToken,
      },
      validateStatus: () => true,
      timeout: 15000,
    });
    const profileData: any = profileResp.data || {};
    if (profileResp.status >= 400) {
      errors.push(profileData?.error?.message || `Instagram profile lookup failed (${profileResp.status})`);
    } else {
      profile = profileData;
      const followers = Number(profile.followers_count ?? account?.followers ?? 0);
      const following = Number(profile.follows_count ?? 0);
      const postsCount = Number(profile.media_count ?? 0);
      const bio = typeof profile.biography === 'string' ? profile.biography : null;
      const isVerified = profile.is_verified === true;
      const displayName = String(profile.name || profile.username || account?.account_name || '').trim() || null;
      const handle = String(profile.username || account?.handle || '').trim() || null;
      const profileImage = typeof profile.profile_picture_url === 'string' ? profile.profile_picture_url : null;

      await pool!.query(
        `INSERT INTO social_profile_stats
           (id, user_id, social_account_id, platform, followers, following, posts_count, bio, is_verified, raw_response, synced_at)
         VALUES (gen_random_uuid()::text, $1, $2, 'instagram', $3, $4, $5, $6, $7, $8::jsonb, NOW())
         ON CONFLICT (social_account_id) DO UPDATE SET
           followers = CASE WHEN EXCLUDED.followers > 0 THEN EXCLUDED.followers ELSE social_profile_stats.followers END,
           following = CASE WHEN EXCLUDED.following > 0 THEN EXCLUDED.following ELSE social_profile_stats.following END,
           posts_count = CASE WHEN EXCLUDED.posts_count > 0 THEN EXCLUDED.posts_count ELSE social_profile_stats.posts_count END,
           bio = COALESCE(EXCLUDED.bio, social_profile_stats.bio),
           is_verified = EXCLUDED.is_verified,
           raw_response = EXCLUDED.raw_response,
           synced_at = NOW()`,
        [userId, account.id, followers, following, postsCount, bio, isVerified, JSON.stringify(profile)]
      );

      await pool!.query(
        `UPDATE social_accounts
         SET account_name = COALESCE($1, account_name),
             handle = COALESCE($2, handle),
             profile_image = COALESCE($3, profile_image),
             followers = CASE WHEN $4 > 0 THEN $4 ELSE followers END,
             token_data = COALESCE(token_data, '{}'::jsonb) || $5::jsonb
         WHERE id = $6`,
        [
          displayName,
          handle,
          profileImage,
          followers,
          JSON.stringify({
            instagramUsername: handle,
            instagramName: displayName,
            accountType: profile.account_type || null,
            mediaCount: postsCount,
            website: profile.website || null,
            profilePictureUrl: profileImage,
            pageId: accountTokenData?.pageId || null,
            pageName: accountTokenData?.pageName || null,
          }),
          account.id,
        ]
      );
      synced++;
    }
  } catch (error) {
    errors.push(error instanceof Error ? error.message : 'Instagram profile sync failed');
  }

  try {
    const since = Math.floor((Date.now() - days * 24 * 60 * 60 * 1000) / 1000);
    const until = Math.floor(Date.now() / 1000);
    const insightsResp = await axios.get(`${META_GRAPH_BASE}/${encodeURIComponent(instagramId)}/insights`, {
      params: {
        metric: 'impressions,reach,profile_views',
        period: 'day',
        since,
        until,
        access_token: accessToken,
      },
      validateStatus: () => true,
      timeout: 20000,
    });
    const insightsData: any = insightsResp.data || {};
    if (insightsResp.status < 400 && Array.isArray(insightsData?.data)) {
      const dateMetrics = new Map<string, Record<string, number>>();
      for (const metric of insightsData.data) {
        const metricName = String(metric?.name || '').trim();
        for (const valueRow of Array.isArray(metric?.values) ? metric.values : []) {
          const dateKey = String(valueRow?.end_time || valueRow?.endTime || '').slice(0, 10);
          if (!dateKey) continue;
          const current = dateMetrics.get(dateKey) || {};
          current[metricName] = Number(valueRow?.value ?? 0);
          dateMetrics.set(dateKey, current);
        }
      }

      for (const [date, metrics] of dateMetrics.entries()) {
        await pool!.query(
          `INSERT INTO account_metrics
             (id, user_id, platform, social_account_id, date, followers, impressions, reach, profile_views, raw_data)
           VALUES (gen_random_uuid()::text, $1, 'instagram', $2, $3::date, $4, $5, $6, $7, $8::jsonb)
           ON CONFLICT (user_id, platform, social_account_id, date) DO UPDATE SET
             followers = EXCLUDED.followers,
             impressions = EXCLUDED.impressions,
             reach = EXCLUDED.reach,
             profile_views = EXCLUDED.profile_views,
             raw_data = EXCLUDED.raw_data`,
          [
            userId,
            account.id,
            date,
            Number(profile?.followers_count ?? account?.followers ?? 0),
            Number(metrics.impressions ?? 0),
            Number(metrics.reach ?? 0),
            Number(metrics.profile_views ?? 0),
            JSON.stringify({ metrics, source: insightsData.data }),
          ]
        );
        synced++;
      }
    } else if (insightsResp.status >= 400) {
      const message = insightsData?.error?.message || `Instagram insights lookup failed (${insightsResp.status})`;
      errors.push(message);
    }
  } catch (error) {
    errors.push(error instanceof Error ? error.message : 'Instagram account insights sync failed');
  }

  try {
    const mediaResp = await axios.get(`${META_GRAPH_BASE}/${encodeURIComponent(instagramId)}/media`, {
      params: {
        fields: INSTAGRAM_MEDIA_FIELDS,
        limit: 50,
        access_token: accessToken,
      },
      validateStatus: () => true,
      timeout: 20000,
    });
    const mediaData: any = mediaResp.data || {};
    if (mediaResp.status >= 400) {
      errors.push(mediaData?.error?.message || `Instagram media lookup failed (${mediaResp.status})`);
    } else {
      const mediaItems: any[] = Array.isArray(mediaData?.data) ? mediaData.data : [];
      for (const media of mediaItems) {
        const mediaId = String(media?.id || '').trim();
        if (!mediaId) continue;

        const analytics = await instagramBusinessPlatform.getPostAnalytics(mediaId, {
          accessToken,
          accountId: instagramId,
          accountName: account?.account_name || profile?.name || profile?.username || null,
          tokenData: accountTokenData,
          helpers: { graphBase: META_GRAPH_BASE },
        });

        const likes = Number(analytics.likes ?? media?.like_count ?? 0);
        const comments = Number(analytics.comments ?? media?.comments_count ?? 0);
        const shares = Number(analytics.shares ?? 0);
        const impressions = Number(analytics.impressions ?? 0);
        const reach = Number(analytics.reach ?? 0);
        const saves = Number(analytics.saves ?? 0);
        const totalInteractions = Number((analytics.raw as any)?.total_interactions ?? 0);
        const engagement = totalInteractions > 0 ? totalInteractions : likes + comments + shares + saves;
        const postedAt = media?.timestamp ? new Date(media.timestamp).toISOString() : null;

        await pool!.query(
          `INSERT INTO social_metrics
             (id, user_id, platform, platform_post_id, social_account_id, likes, comments, shares, impressions, reach, engagement, saves, raw_data, posted_at, fetched_at)
           VALUES (gen_random_uuid()::text, $1, 'instagram', $2, $3, $4, $5, $6, $7, $8, $9, $10, $11::jsonb, $12, NOW())
           ON CONFLICT (user_id, platform, platform_post_id) DO UPDATE SET
             likes = EXCLUDED.likes,
             comments = EXCLUDED.comments,
             shares = EXCLUDED.shares,
             impressions = EXCLUDED.impressions,
             reach = EXCLUDED.reach,
             engagement = EXCLUDED.engagement,
             saves = EXCLUDED.saves,
             raw_data = EXCLUDED.raw_data,
             posted_at = COALESCE(EXCLUDED.posted_at, social_metrics.posted_at),
             fetched_at = NOW()`,
          [
            userId,
            mediaId,
            account.id,
            likes,
            comments,
            shares,
            impressions,
            reach,
            engagement,
            saves,
            JSON.stringify({
              media,
              analytics: analytics.raw || null,
              account: {
                instagramId,
                instagramUsername: profile?.username || accountTokenData?.instagramUsername || null,
                instagramName: profile?.name || accountTokenData?.instagramName || null,
                pageId: accountTokenData?.pageId || null,
                pageName: accountTokenData?.pageName || null,
              },
            }),
            postedAt,
          ]
        );
        synced++;
      }
    }
  } catch (error) {
    errors.push(error instanceof Error ? error.message : 'Instagram media sync failed');
  }

  return { synced, errors };
}



async function syncThreadsAnalyticsAccount(params: {
  userId: string;
  account: any;
  days?: number;
  maxPosts?: number;
}): Promise<{ synced: number; errors: string[] }> {
  const { userId, account } = params;
  const days = Math.max(1, Number(params.days || 30));
  const maxPosts = Math.max(1, Math.min(200, Number(params.maxPosts || 50)));

  const errors: string[] = [];
  let synced = 0;

  if (!pool) return { synced, errors: ['DB not ready'] };

  let accessToken = decodeStoredIntegrationSecret(account?.access_token_encrypted);
  if (!accessToken) accessToken = String(account?.access_token || '').trim();
  if (!accessToken) return { synced, errors: ['Threads access token missing or expired — reconnect Threads.'] };

  const threadsBase = 'https://graph.threads.net/v1.0';
  const sinceDate = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
  const sinceMs = sinceDate.getTime();

  const extractMetric = (insightsResp: any, name: string) => {
    const data = Array.isArray(insightsResp?.data) ? insightsResp.data : [];
    const match = data.find((m: any) => String(m?.name || '').toLowerCase() === name.toLowerCase());
    const values = Array.isArray(match?.values) ? match.values : [];
    if (values.length === 0) return 0;
    const raw = values[values.length - 1]?.value;
    const num = typeof raw === 'number' ? raw : parseFloat(String(raw ?? '0'));
    return Number.isFinite(num) ? num : 0;
  };

  // ── Profile + account insights ──────────────────────────────────────────
  let profile: any = null;
  try {
    const meResp = await axios.get(`${threadsBase}/me`, {
      params: {
        fields: 'id,username,name,is_verified,threads_profile_picture_url,threads_biography',
        access_token: accessToken,
      },
      validateStatus: () => true,
      timeout: 15000,
    });
    const meData: any = meResp.data || {};
    if (meResp.status >= 400) {
      const msg = meData?.error?.message || `Threads profile lookup failed (${meResp.status})`;
      errors.push(msg);
    } else {
      profile = meData;
    }
  } catch (err: any) {
    errors.push(`Threads profile lookup failed: ${err?.message || 'Failed'}`);
  }

  let accountInsights: any = null;
  try {
    const metricList = 'views,likes,replies,reposts,quotes,clicks,followers_count';
    const insResp = await axios.get(`${threadsBase}/me/threads_insights`, {
      params: {
        metric: metricList,
        access_token: accessToken,
      },
      validateStatus: () => true,
      timeout: 15000,
    });
    const insData: any = insResp.data || {};
    if (insResp.status === 403) {
      errors.push('Threads insights scope not granted (threads_manage_insights) — reconnect Threads to enable analytics.');
    } else if (insResp.status >= 400) {
      const msg = insData?.error?.message || `Threads account insights failed (${insResp.status})`;
      errors.push(msg);
    } else {
      accountInsights = insData;
    }
  } catch (err: any) {
    errors.push(`Threads account insights failed: ${err?.message || 'Failed'}`);
  }

  const followerDemographics: Record<string, any> = {};
  if (accountInsights) {
    for (const breakdown of ['country', 'city', 'age', 'gender'] as const) {
      try {
        const demoResp = await axios.get(`${threadsBase}/me/threads_insights`, {
          params: {
            metric: 'follower_demographics',
            breakdown,
            access_token: accessToken,
          },
          validateStatus: () => true,
          timeout: 15000,
        });
        const demoData: any = demoResp.data || {};
        if (demoResp.status === 403) {
          // Only include the warning once; base insights call already records the scope error.
          if (!errors.some((e) => e.includes('threads_manage_insights'))) {
            errors.push('Threads insights scope not granted (threads_manage_insights) — reconnect Threads to enable analytics.');
          }
          break;
        }
        if (demoResp.status >= 400) {
          const msg = demoData?.error?.message || `Threads follower demographics failed (${demoResp.status})`;
          errors.push(msg);
          continue;
        }
        followerDemographics[breakdown] = demoData;
      } catch (err: any) {
        errors.push(`Threads follower demographics failed: ${err?.message || 'Failed'}`);
      }
    }
  }

  const followers = Math.round(extractMetric(accountInsights, 'followers_count'));
  const totalLikes = Math.round(extractMetric(accountInsights, 'likes'));
  const accountMetrics = {
    views: Math.round(extractMetric(accountInsights, 'views')),
    likes: totalLikes,
    replies: Math.round(extractMetric(accountInsights, 'replies')),
    reposts: Math.round(extractMetric(accountInsights, 'reposts')),
    quotes: Math.round(extractMetric(accountInsights, 'quotes')),
    clicks: Math.round(extractMetric(accountInsights, 'clicks')),
    followers_count: followers,
  };

  // ── Posts sync ──────────────────────────────────────────────────────────
  let postsSynced = 0;
  try {
    const fields =
      'id,media_product_type,media_type,media_url,gif_url,permalink,owner,username,text,timestamp,shortcode,thumbnail_url,children,is_quote_post,quoted_post,reposted_post,has_replies,alt_text,link_attachment_url,poll_attachment{option_a,option_b,option_c,option_d,option_a_votes_percentage,option_b_votes_percentage,option_c_votes_percentage,option_d_votes_percentage,expiration_timestamp},location_id,topic_tag,is_verified,profile_picture_url';
    const metricList = 'views,likes,replies,reposts,quotes,shares';

    let after: string | null = null;
    let fetched = 0;
    let page = 0;
    const MAX_PAGES = 10;

    while (fetched < maxPosts && page < MAX_PAGES) {
      const pageSize = Math.min(50, Math.max(1, maxPosts - fetched));
      const listResp = await axios.get(`${threadsBase}/me/threads`, {
        params: {
          fields,
          limit: pageSize,
          ...(after ? { after } : {}),
          access_token: accessToken,
        },
        validateStatus: () => true,
        timeout: 20000,
      });
      const listData: any = listResp.data || {};
      if (listResp.status >= 400) {
        const msg = listData?.error?.message || `Threads posts fetch failed (${listResp.status})`;
        errors.push(msg);
        break;
      }

      const items: any[] =
        Array.isArray(listData?.data) ? listData.data :
        Array.isArray(listData?.items) ? listData.items :
        [];

      if (items.length === 0) break;

      let hitOldPost = false;
      for (const post of items) {
        if (fetched >= maxPosts) break;
        const threadId = String(post?.id || '').trim();
        if (!threadId) continue;

        let postedAt: string | null = null;
        let postedAtMs = NaN;
        try {
          const dt = post?.timestamp ? new Date(post.timestamp) : null;
          postedAt = dt && !Number.isNaN(dt.getTime()) ? dt.toISOString() : null;
          postedAtMs = dt ? dt.getTime() : NaN;
        } catch (err) {
    logger.error('Unhandled error:', err);
          postedAt = null;
          postedAtMs = NaN;
        }

        if (Number.isFinite(postedAtMs) && postedAtMs < sinceMs) {
          hitOldPost = true;
          break;
        }

        let insights: any = null;
        try {
          const insResp = await axios.get(`${threadsBase}/${encodeURIComponent(threadId)}/insights`, {
            params: { metric: metricList, access_token: accessToken },
            validateStatus: () => true,
            timeout: 15000,
          });
          const insData: any = insResp.data || {};
          if (insResp.status >= 400) {
            const msg = insData?.error?.message || `Threads post insights failed (${insResp.status})`;
            errors.push(msg);
          } else {
            insights = insData;
          }
        } catch (err: any) {
          errors.push(`Threads post insights failed: ${err?.message || 'Failed'}`);
        }

        const views = Math.round(extractMetric(insights, 'views'));
        const likes = Math.round(extractMetric(insights, 'likes'));
        const replies = Math.round(extractMetric(insights, 'replies'));
        const reposts = Math.round(extractMetric(insights, 'reposts'));
        const quotes = Math.round(extractMetric(insights, 'quotes'));
        const shares = Math.round(extractMetric(insights, 'shares'));
        const engagement = likes + replies + reposts + quotes + shares;

        const mediaUrl =
          typeof post?.media_url === 'string'
            ? post.media_url
            : typeof post?.gif_url === 'string'
              ? post.gif_url
              : null;

        const raw = {
          post: {
            id: threadId,
            text: post?.text ?? null,
            permalink: post?.permalink ?? null,
            timestamp: post?.timestamp ?? null,
            media_product_type: post?.media_product_type ?? null,
            media_type: post?.media_type ?? null,
            media_url: mediaUrl,
            gif_url: post?.gif_url ?? null,
            thumbnail_url: post?.thumbnail_url ?? null,
            username: post?.username ?? null,
            shortcode: post?.shortcode ?? null,
            children: post?.children ?? null,
            is_quote_post: post?.is_quote_post ?? null,
            quoted_post: post?.quoted_post ?? null,
            reposted_post: post?.reposted_post ?? null,
            has_replies: post?.has_replies ?? null,
            alt_text: post?.alt_text ?? null,
            link_attachment_url: post?.link_attachment_url ?? null,
            poll_attachment: post?.poll_attachment ?? null,
            location_id: post?.location_id ?? null,
            topic_tag: post?.topic_tag ?? null,
            owner: post?.owner ?? null,
            is_verified: post?.is_verified ?? null,
            profile_picture_url: post?.profile_picture_url ?? null,
          },
          metrics: { views, likes, replies, reposts, quotes, shares },
          insights: insights?.data ?? null,
        };

        await pool.query(
          `INSERT INTO social_metrics
             (id, user_id, platform, platform_post_id, social_account_id,
              likes, comments, shares, impressions, reach, engagement,
              raw_data, posted_at, fetched_at)
           VALUES (gen_random_uuid()::text, $1, 'threads', $2, $3,
                   $4, $5, $6, $7, $8, $9,
                   $10::jsonb, $11, NOW())
           ON CONFLICT (user_id, platform, platform_post_id) DO UPDATE SET
             social_account_id = EXCLUDED.social_account_id,
             likes       = EXCLUDED.likes,
             comments    = EXCLUDED.comments,
             shares      = EXCLUDED.shares,
             impressions = EXCLUDED.impressions,
             reach       = EXCLUDED.reach,
             engagement  = EXCLUDED.engagement,
             raw_data    = EXCLUDED.raw_data,
             posted_at   = COALESCE(EXCLUDED.posted_at, social_metrics.posted_at),
             fetched_at  = NOW()`,
          [userId, threadId, account.id, likes, replies, shares, views, views, engagement, JSON.stringify(raw), postedAt]
        );

        synced++;
        postsSynced++;
        fetched++;
      }

      after =
        (listData?.paging?.cursors?.after ? String(listData.paging.cursors.after) : null) ||
        (listData?.paging?.after ? String(listData.paging.after) : null) ||
        null;

      if (hitOldPost || !after) break;
      page++;
    }
  } catch (err: any) {
    errors.push(`Threads posts sync failed: ${err?.message || 'Failed'}`);
  }

  // ── Persist profile snapshot ────────────────────────────────────────────
  try {
    const bio = typeof profile?.threads_biography === 'string' ? profile.threads_biography : (typeof profile?.about === 'string' ? profile.about : null);
    const isVerified = profile?.is_verified === true;
    const handle = typeof profile?.username === 'string' ? profile.username : null;
    const accountName = String(profile?.name || profile?.username || account?.account_name || '').trim() || null;
    const profileImage =
      typeof profile?.threads_profile_picture_url === 'string'
        ? profile.threads_profile_picture_url
        : typeof profile?.profile_picture_url === 'string'
          ? profile.profile_picture_url
          : null;
    const accountId = profile?.id ? String(profile.id).trim() : null;

    await pool.query(
      `INSERT INTO social_profile_stats
         (id, user_id, social_account_id, platform,
          followers, following, posts_count, total_likes,
          bio, is_verified, raw_response, synced_at)
       VALUES (gen_random_uuid()::text, $1, $2, 'threads',
               $3, 0, $4, $5,
               $6, $7, $8::jsonb, NOW())
       ON CONFLICT (social_account_id) DO UPDATE SET
         followers   = CASE WHEN EXCLUDED.followers > 0 THEN EXCLUDED.followers ELSE social_profile_stats.followers END,
         posts_count = CASE WHEN EXCLUDED.posts_count > 0 THEN EXCLUDED.posts_count ELSE social_profile_stats.posts_count END,
         total_likes = CASE WHEN EXCLUDED.total_likes > 0 THEN EXCLUDED.total_likes ELSE social_profile_stats.total_likes END,
         bio         = COALESCE(EXCLUDED.bio, social_profile_stats.bio),
         is_verified = EXCLUDED.is_verified,
         raw_response= EXCLUDED.raw_response,
         synced_at   = NOW()`,
      [
        userId,
        account.id,
        followers,
        postsSynced,
        totalLikes,
        bio,
        isVerified,
        JSON.stringify({ profile, insights: accountInsights, account_metrics: accountMetrics, follower_demographics: followerDemographics }),
      ]
    );

    await pool.query(
      `UPDATE social_accounts SET
         account_id    = COALESCE($1, account_id),
         account_name  = COALESCE($2, account_name),
         handle        = COALESCE($3, handle),
         profile_image = COALESCE($4, profile_image),
         followers     = CASE WHEN $5 > 0 THEN $5 ELSE followers END
       WHERE id = $6`,
      [accountId, accountName, handle, profileImage, followers, account.id]
    );

    synced++;
  } catch (err: any) {
    errors.push(`Threads profile sync failed: ${err?.message || 'Failed'}`);
  }

  return { synced, errors };
}



async function syncPinterestAnalyticsAccount(params: {
  userId: string;
  account: any;
  days?: number;
  maxPins?: number;
}): Promise<{ synced: number; errors: string[] }> {
  const { userId, account } = params;
  const days = Math.max(1, Number(params.days || 30));
  const maxPins = Math.max(1, Math.min(250, Number(params.maxPins || 50)));

  const errors: string[] = [];
  let synced = 0;

  if (!pool) return { synced, errors: ['DB not ready'] };

  let accessToken = decodeStoredIntegrationSecret(account?.access_token_encrypted);
  if (!accessToken) accessToken = String(account?.access_token || '').trim();
  if (!accessToken) return { synced, errors: ['Pinterest access token missing or expired — reconnect Pinterest.'] };

  const headers = { Authorization: `Bearer ${accessToken}` };

  // ── Profile sync ────────────────────────────────────────────────────────
  try {
    const meResp = await axios.get('https://api.pinterest.com/v5/user_account', {
      headers,
      validateStatus: () => true,
      timeout: 15000,
    });
    const me: any = meResp.data || {};

    if (meResp.status === 403) {
      errors.push('Profile scope not granted (user_accounts:read) — reconnect Pinterest to enable follower and profile stats.');
    } else if (meResp.status >= 400) {
      const msg = me?.message || me?.error || `Pinterest profile fetch failed (${meResp.status})`;
      errors.push(typeof msg === 'string' ? msg : `Pinterest profile fetch failed (${meResp.status})`);
    } else {
      const followers = Number(me?.follower_count ?? 0);
      const following = Number(me?.following_count ?? 0);
      const pinsCount = Number(me?.pin_count ?? 0);
      const bio = typeof me?.about === 'string' ? me.about : null;
      const handle = typeof me?.username === 'string' ? me.username : null;
      const accountName = String(me?.business_name || me?.username || account?.account_name || '').trim() || null;
      const profileImage = typeof me?.profile_image === 'string' ? me.profile_image : null;
      const accountId = me?.id ? String(me.id).trim() : null;

      await pool.query(
        `INSERT INTO social_profile_stats
           (id, user_id, social_account_id, platform,
            followers, following, posts_count, total_likes,
            bio, is_verified, raw_response, synced_at)
         VALUES (gen_random_uuid()::text, $1, $2, 'pinterest',
                 $3, $4, $5, 0,
                 $6, false, $7::jsonb, NOW())
         ON CONFLICT (social_account_id) DO UPDATE SET
           followers   = CASE WHEN EXCLUDED.followers > 0 THEN EXCLUDED.followers ELSE social_profile_stats.followers END,
           following   = CASE WHEN EXCLUDED.following > 0 THEN EXCLUDED.following ELSE social_profile_stats.following END,
           posts_count = CASE WHEN EXCLUDED.posts_count > 0 THEN EXCLUDED.posts_count ELSE social_profile_stats.posts_count END,
           bio         = COALESCE(EXCLUDED.bio, social_profile_stats.bio),
           raw_response= EXCLUDED.raw_response,
           synced_at   = NOW()`,
        [userId, account.id, followers, following, pinsCount, bio, JSON.stringify(me)]
      );

      await pool.query(
        `UPDATE social_accounts SET
           account_id    = COALESCE($1, account_id),
           account_name  = COALESCE($2, account_name),
           handle        = COALESCE($3, handle),
           profile_image = COALESCE($4, profile_image),
           followers     = CASE WHEN $5 > 0 THEN $5 ELSE followers END
         WHERE id = $6`,
        [accountId, accountName, handle, profileImage, followers, account.id]
      );

      synced++;
    }
  } catch (err: any) {
    errors.push(`Pinterest profile sync failed: ${err?.message || 'Failed'}`);
  }

  // ── Pins sync ───────────────────────────────────────────────────────────
  try {
    const metricNumber = (value: any) => {
      const num = typeof value === 'number' ? value : parseFloat(String(value || '0'));
      return Number.isFinite(num) ? num : 0;
    };

    const pickMetric = (metrics: any, keys: string[]) => {
      for (const key of keys) {
        if (metrics && metrics[key] !== undefined && metrics[key] !== null) return metricNumber(metrics[key]);
      }
      return 0;
    };

    let bookmark: string | null = null;
    let fetchedPins = 0;
    let page = 0;
    const MAX_PAGES = 10;

    while (fetchedPins < maxPins && page < MAX_PAGES) {
      const pageSize = Math.min(250, Math.max(1, maxPins - fetchedPins));
      const pinsResp = await axios.get('https://api.pinterest.com/v5/pins', {
        headers,
        params: {
          page_size: pageSize,
          pin_metrics: true,
          ...(bookmark ? { bookmark } : {}),
        },
        validateStatus: () => true,
        timeout: 20000,
      });
      const pinsData: any = pinsResp.data || {};

      if (pinsResp.status >= 400) {
        const msg = pinsData?.message || pinsData?.error || `Pinterest pins fetch failed (${pinsResp.status})`;
        errors.push(typeof msg === 'string' ? msg : `Pinterest pins fetch failed (${pinsResp.status})`);
        break;
      }

      const items: any[] = Array.isArray(pinsData?.items) ? pinsData.items : [];
      for (const pin of items) {
        if (fetchedPins >= maxPins) break;
        const pinId = String(pin?.id || '').trim();
        if (!pinId) continue;

        const pinMetrics = pin?.pin_metrics || null;
        const metricsSource = pinMetrics?.lifetime_metrics ? 'lifetime' : pinMetrics?.['90d'] ? '90d' : null;
        const metrics =
          (metricsSource === 'lifetime' ? pinMetrics?.lifetime_metrics : null) ||
          (metricsSource === '90d' ? pinMetrics?.['90d'] : null) ||
          {};

        const impressions = pickMetric(metrics, ['impression', 'impressions']);
        const outboundClicks = pickMetric(metrics, ['clickthrough', 'outbound_click', 'outbound_clicks']);
        const pinClicks = pickMetric(metrics, ['pin_click', 'pin_clicks']);
        const saves = pickMetric(metrics, ['save', 'saves']);
        const reactions = pickMetric(metrics, ['reaction', 'total_reactions']);
        const comments = pickMetric(metrics, ['comment', 'total_comments']);

        const engagement = saves + pinClicks + reactions + comments;

        let postedAt: string | null = null;
        try {
          const dt = pin?.created_at ? new Date(pin.created_at) : null;
          postedAt = dt && !Number.isNaN(dt.getTime()) ? dt.toISOString() : null;
        } catch (err) {
    logger.error('Unhandled error:', err);
          postedAt = null;
        }

        const raw = {
          pin: {
            id: pinId,
            title: pin?.title ?? null,
            description: pin?.description ?? null,
            link: pin?.link ?? null,
            board_id: pin?.board_id ?? null,
            board_section_id: pin?.board_section_id ?? null,
            creative_type: pin?.creative_type ?? null,
            media: pin?.media ?? null,
            created_at: pin?.created_at ?? null,
          },
          metrics: {
            impressions,
            outbound_clicks: outboundClicks,
            pin_click: pinClicks,
            saves,
            reactions,
            comments,
            source: metricsSource,
          },
        };

        await pool.query(
          `INSERT INTO social_metrics
             (id, user_id, platform, platform_post_id, social_account_id,
              likes, comments, shares, impressions, reach, engagement, clicks, saves,
              raw_data, posted_at, fetched_at)
           VALUES (gen_random_uuid()::text, $1, 'pinterest', $2, $3,
                   $4, $5, 0, $6, $7, $8, $9, $10,
                   $11::jsonb, $12, NOW())
           ON CONFLICT (user_id, platform, platform_post_id) DO UPDATE SET
             social_account_id = EXCLUDED.social_account_id,
             likes       = EXCLUDED.likes,
             comments    = EXCLUDED.comments,
             impressions = EXCLUDED.impressions,
             reach       = EXCLUDED.reach,
             engagement  = EXCLUDED.engagement,
             clicks      = EXCLUDED.clicks,
             saves       = EXCLUDED.saves,
             raw_data    = EXCLUDED.raw_data,
             posted_at   = COALESCE(EXCLUDED.posted_at, social_metrics.posted_at),
             fetched_at  = NOW()`,
          [
            userId,
            pinId,
            account.id,
            Math.round(reactions),
            Math.round(comments),
            Math.round(impressions),
            Math.round(impressions), // Pinterest has no "reach"; use impressions as a reasonable proxy.
            Math.round(engagement),
            Math.round(outboundClicks),
            Math.round(saves),
            JSON.stringify(raw),
            postedAt,
          ]
        );

        synced++;
        fetchedPins++;
      }

      bookmark = pinsData?.bookmark ? String(pinsData.bookmark) : null;
      if (!bookmark) break;
      page++;
    }
  } catch (err: any) {
    errors.push(`Pinterest pins sync failed: ${err?.message || 'Failed'}`);
  }

  return { synced, errors };
}

  // ─── Routes ──────────────────────────────────────────────────────────────

// GET /api/blog/analytics/dashboard
router.get('/api/blog/analytics/dashboard', async (req: Request, res: Response) => {
  try {
    const auth = requireAuth(req, res);
    if (!auth) return;
    if (!pool) return res.status(503).json({ success: false, error: 'DB not ready' });

    const q = req.query as any;
    const range = parseAnalyticsRange(q.preset, q.start, q.end);

    const [pubRes, prevRes, metricsRes, scheduledRes, accountRes, lastSyncRes] = await Promise.all([
      pool.query(
        `SELECT platform, status, created_at, post_id, platform_post_id FROM publishing_logs
         WHERE user_id=$1 AND created_at >= $2 AND created_at <= $3`,
        [auth.userId, range.startIso, range.endIso]
      ),
      pool.query(
        `SELECT platform, status FROM publishing_logs
         WHERE user_id=$1 AND created_at >= $2 AND created_at <= $3`,
        [auth.userId, range.prevStartIso, range.prevEndIso]
      ),
      pool.query(
        `SELECT platform, platform_post_id, post_id, likes, comments, shares, impressions, reach, engagement, posted_at
         FROM social_metrics WHERE user_id=$1 AND (posted_at IS NULL OR (posted_at >= $2 AND posted_at <= $3))`,
        [auth.userId, range.startIso, range.endIso]
      ),
      pool.query(
        `SELECT COUNT(*) as cnt FROM publishing_logs WHERE user_id=$1 AND status='scheduled' AND scheduled_for > NOW()`,
        [auth.userId]
      ),
      pool.query(
        `SELECT platform, COUNT(*) as cnt, COALESCE(SUM(followers), 0) as total_followers
         FROM social_accounts WHERE user_id=$1 AND connected=true GROUP BY platform`,
        [auth.userId]
      ),
      pool.query(
        `SELECT data->>'lastSyncedAt' as ts FROM insights_cache WHERE user_id=$1 AND cache_key='last_synced' LIMIT 1`,
        [auth.userId]
      ),
    ]);

    const logs: any[] = pubRes.rows;
    const prevLogs: any[] = prevRes.rows;
    const metrics: any[] = metricsRes.rows;
    const futureScheduledCount = parseInt(scheduledRes.rows[0]?.cnt || '0');
    const lastSyncedAt: string | null = lastSyncRes.rows[0]?.ts || null;

    const accountsByPlatform = new Map<string, { count: number; followers: number }>();
    for (const r of accountRes.rows as any[]) {
      accountsByPlatform.set(r.platform.toLowerCase(), { count: parseInt(r.cnt), followers: parseInt(r.total_followers || '0') });
    }

    // Fetch post titles for top posts
    const postIds = [...new Set([...logs.map((l: any) => l.post_id), ...metrics.map((m: any) => m.post_id)].filter(Boolean))];
    const postTitles = new Map<string, { title: string; tags: string[]; hasImage: boolean }>();
    if (postIds.length > 0) {
      const postRes = await pool.query(
        `SELECT p.id, p.title, p.featured_image,
                ARRAY(SELECT t.name FROM blog_tags t JOIN blog_post_tags pt ON pt.tag_id=t.id WHERE pt.post_id=p.id) AS tags
         FROM blog_posts p WHERE p.id = ANY($1::text[])`,
        [postIds]
      );
      for (const r of postRes.rows as any[]) {
        postTitles.set(r.id, { title: r.title || '', tags: r.tags || [], hasImage: !!(r.featured_image) });
      }
    }

    // KPIs
    const published = logs.filter((l: any) => l.status === 'success' || l.status === 'published').length;
    const failed = logs.filter((l: any) => l.status === 'failed' || l.status === 'error').length;
    const total = logs.length;
    const publishSuccessRate = total > 0 ? Math.round((published / total) * 100) : null;
    const prevPublished = prevLogs.filter((l: any) => l.status === 'success' || l.status === 'published').length;
    const prevTotal = prevLogs.length;
    const prevSuccessRate = prevTotal > 0 ? Math.round((prevPublished / prevTotal) * 100) : null;

    const totalReach = metrics.reduce((s: number, m: any) => s + (m.reach || 0), 0) || null;
    const totalEngagement = metrics.reduce((s: number, m: any) => s + (m.engagement || (parseInt(m.likes || 0) + parseInt(m.comments || 0) + parseInt(m.shares || 0))), 0) || null;
    const engagementRate = totalReach && totalEngagement ? parseFloat(((totalEngagement / totalReach) * 100).toFixed(2)) : null;

    // Top platform
    const platformCounts = new Map<string, number>();
    for (const l of logs as any[]) {
      const p = (l.platform || '').toLowerCase();
      if (p) platformCounts.set(p, (platformCounts.get(p) || 0) + 1);
    }
    let topPlatform: { platform: string; label: string; published: number; share: number } | null = null;
    if (platformCounts.size > 0) {
      const [tp, tpCount] = [...platformCounts.entries()].sort((a, b) => b[1] - a[1])[0];
      topPlatform = { platform: tp, label: analyticsPlatformLabel(tp), published: tpCount, share: total > 0 ? Math.round((tpCount / total) * 100) : 0 };
    }

    // Best posting time
    const hourCounts = new Map<number, number>();
    for (const l of logs as any[]) {
      if (l.status === 'success' || l.status === 'published') {
        const h = new Date(l.created_at).getHours();
        hourCounts.set(h, (hourCounts.get(h) || 0) + 1);
      }
    }
    let bestTimeWindow: { label: string; supportingValue: string } | null = null;
    if (hourCounts.size > 0) {
      const bestHour = [...hourCounts.entries()].sort((a, b) => b[1] - a[1])[0][0];
      const endHour = (bestHour + 2) % 24;
      const fmt = (h: number) => `${h === 0 ? 12 : h > 12 ? h - 12 : h}${h < 12 ? 'am' : 'pm'}`;
      bestTimeWindow = { label: `${fmt(bestHour)}–${fmt(endHour)}`, supportingValue: 'Most posts published in this window' };
    }

    // Trend by date
    const trendMap = new Map<string, { publishedPosts: number; successfulPublishes: number; failedPublishes: number; scheduledPublishes: number; reach: number; engagement: number }>();
    const cur = new Date(range.start);
    while (cur <= range.end) {
      trendMap.set(analyticsFmtDate(cur), { publishedPosts: 0, successfulPublishes: 0, failedPublishes: 0, scheduledPublishes: 0, reach: 0, engagement: 0 });
      cur.setDate(cur.getDate() + 1);
    }
    for (const l of logs as any[]) {
      const d = analyticsFmtDate(new Date(l.created_at));
      const e = trendMap.get(d);
      if (e) {
        e.publishedPosts++;
        if (l.status === 'success' || l.status === 'published') e.successfulPublishes++;
        else if (l.status === 'failed' || l.status === 'error') e.failedPublishes++;
        else if (l.status === 'scheduled') e.scheduledPublishes++;
      }
    }
    for (const m of metrics as any[]) {
      if (!m.posted_at) continue;
      const d = analyticsFmtDate(new Date(m.posted_at));
      const e = trendMap.get(d);
      if (e) {
        e.reach += parseInt(m.reach || 0);
        e.engagement += parseInt(m.engagement || 0) || (parseInt(m.likes || 0) + parseInt(m.comments || 0) + parseInt(m.shares || 0));
      }
    }
    const trend = [...trendMap.entries()].sort().map(([date, v]) => ({
      date, ...v,
      reach: v.reach || null, engagement: v.engagement || null,
      engagementRate: v.reach && v.engagement ? parseFloat(((v.engagement / v.reach) * 100).toFixed(2)) : null,
    }));

    // Platform breakdown
    const platformStats = new Map<string, { published: number; failed: number; scheduled: number; reach: number; engagement: number }>();
    for (const l of logs as any[]) {
      const p = (l.platform || 'unknown').toLowerCase();
      if (!platformStats.has(p)) platformStats.set(p, { published: 0, failed: 0, scheduled: 0, reach: 0, engagement: 0 });
      const ps = platformStats.get(p)!;
      if (l.status === 'success' || l.status === 'published') ps.published++;
      else if (l.status === 'failed' || l.status === 'error') ps.failed++;
      else if (l.status === 'scheduled') ps.scheduled++;
    }
    for (const m of metrics as any[]) {
      const p = (m.platform || 'unknown').toLowerCase();
      if (!platformStats.has(p)) platformStats.set(p, { published: 0, failed: 0, scheduled: 0, reach: 0, engagement: 0 });
      const ps = platformStats.get(p)!;
      ps.reach += parseInt(m.reach || 0);
      ps.engagement += parseInt(m.engagement || 0) || (parseInt(m.likes || 0) + parseInt(m.comments || 0) + parseInt(m.shares || 0));
    }
    const platformBreakdown = [...platformStats.entries()].map(([platform, ps]) => {
      const t2 = ps.published + ps.failed;
      const acc = accountsByPlatform.get(platform);
      return {
        platform, label: analyticsPlatformLabel(platform),
        published: ps.published, failed: ps.failed, scheduled: ps.scheduled,
        successRate: t2 > 0 ? Math.round((ps.published / t2) * 100) : null,
        reach: ps.reach || null, engagement: ps.engagement || null,
        engagementRate: ps.reach && ps.engagement ? parseFloat(((ps.engagement / ps.reach) * 100).toFixed(2)) : null,
        accounts: acc?.count || 0, followerReach: acc?.followers || null,
      };
    }).sort((a, b) => b.published - a.published);

    // Top posts
    const postStats = new Map<string, { platforms: string[]; success: number; fail: number; reach: number; engagement: number; publishedAt: string | null }>();
    for (const l of logs as any[]) {
      const pid = l.post_id; if (!pid) continue;
      if (!postStats.has(pid)) postStats.set(pid, { platforms: [], success: 0, fail: 0, reach: 0, engagement: 0, publishedAt: null });
      const ps = postStats.get(pid)!;
      if (l.platform && !ps.platforms.includes(l.platform)) ps.platforms.push(l.platform);
      if (l.status === 'success' || l.status === 'published') { ps.success++; if (!ps.publishedAt) ps.publishedAt = l.created_at; }
      else if (l.status === 'failed' || l.status === 'error') ps.fail++;
    }
    for (const m of metrics as any[]) {
      const pid = m.post_id; if (!pid) continue;
      if (!postStats.has(pid)) postStats.set(pid, { platforms: [], success: 0, fail: 0, reach: 0, engagement: 0, publishedAt: null });
      const ps = postStats.get(pid)!;
      ps.reach += parseInt(m.reach || 0);
      ps.engagement += parseInt(m.engagement || 0) || (parseInt(m.likes || 0) + parseInt(m.comments || 0) + parseInt(m.shares || 0));
    }
    const topPosts = [...postStats.entries()]
      .map(([pid, ps]) => {
        const score = ps.success * 2 + (ps.reach > 0 ? Math.log10(ps.reach + 1) : 0) + (ps.engagement > 0 ? Math.log10(ps.engagement + 1) * 2 : 0);
        const info = postTitles.get(pid);
        return {
          id: pid, title: info?.title || 'Untitled', publishedAt: ps.publishedAt,
          platforms: ps.platforms, type: (info?.hasImage ? 'image' : 'text') as 'image' | 'text',
          hashtags: [], tagNames: info?.tags || [],
          successfulPublishes: ps.success, failedPublishes: ps.fail,
          reach: ps.reach || null, engagement: ps.engagement || null,
          engagementRate: ps.reach && ps.engagement ? parseFloat(((ps.engagement / ps.reach) * 100).toFixed(2)) : null,
          score: Math.round(score * 10) / 10,
          scoreLabel: score > 10 ? 'Top Performer' : score > 5 ? 'Good' : score > 2 ? 'Average' : 'Low',
        };
      })
      .sort((a, b) => b.score - a.score)
      .slice(0, 10);

    // Insights
    const insights: Array<{ type: string; title: string; description: string; actionLabel?: string; actionHref?: string }> = [];
    if (published === 0 && total === 0) {
      insights.push({ type: 'warning', title: 'No publishing activity yet', description: 'Start publishing posts to see analytics data.', actionLabel: 'Create Post', actionHref: '/posts' });
    }
    if (publishSuccessRate !== null && publishSuccessRate < 70) {
      insights.push({ type: 'warning', title: 'Low publish success rate', description: `Only ${publishSuccessRate}% of attempts succeeded. Check your social account connections.`, actionLabel: 'Check Integrations', actionHref: '/integrations' });
    } else if (publishSuccessRate !== null && publishSuccessRate >= 90) {
      insights.push({ type: 'positive', title: 'Excellent publish success rate', description: `${publishSuccessRate}% success rate — your integrations are working great.` });
    }
    if (bestTimeWindow && published >= 5) {
      insights.push({ type: 'suggestion', title: `Best posting time: ${bestTimeWindow.label}`, description: 'Schedule future posts in this window for maximum visibility.' });
    }
    if (accountsByPlatform.size === 0) {
      insights.push({ type: 'suggestion', title: 'Connect social accounts', description: 'Connect your social media accounts to start publishing and tracking analytics.', actionLabel: 'Connect Accounts', actionHref: '/integrations' });
    }
    if (prevPublished > 0) {
      const growthPct = Math.round(((published - prevPublished) / prevPublished) * 100);
      if (growthPct > 20) insights.push({ type: 'positive', title: 'Publishing frequency increased', description: `${growthPct}% more posts than the previous period.` });
      else if (growthPct < -20) insights.push({ type: 'warning', title: 'Publishing frequency decreased', description: `${Math.abs(growthPct)}% fewer posts compared to the previous period.` });
    }
    if (metrics.length === 0 && total > 0) {
      insights.push({ type: 'suggestion', title: 'Sync for reach & engagement data', description: 'Click "Sync Analytics" to fetch reach and engagement data from your connected platforms.' });
    }

    return res.json({
      success: true,
      data: {
        lastSyncedAt,
        range: { preset: range.preset, start: analyticsFmtDate(range.start), end: analyticsFmtDate(range.end), label: range.label, days: range.days },
        metricsAvailability: { performance: metrics.length > 0 },
        summaryNote: metrics.length === 0 && total > 0 ? 'Sync analytics to see reach and engagement data from your platforms.' : null,
        kpis: {
          publishedPosts: published,
          publishedPostsChange: prevPublished > 0 ? Math.round(((published - prevPublished) / prevPublished) * 100) : null,
          totalReach, totalReachChange: null,
          totalEngagement, totalEngagementChange: null,
          engagementRate, engagementRateChange: null,
          publishSuccessRate,
          publishSuccessRateChange: prevSuccessRate !== null && publishSuccessRate !== null ? publishSuccessRate - prevSuccessRate : null,
          topPlatform, bestTimeWindow, futureScheduledCount,
        },
        trend, platformBreakdown, topPosts, insights,
      },
    });
  } catch (err) {
    logger.error('Analytics dashboard error:', err);
    return res.status(500).json({ success: false, error: 'Failed to fetch analytics dashboard' });
  }
});

// POST /api/blog/analytics/refresh — sync social metrics from platform APIs
router.post('/api/blog/analytics/refresh', async (req: Request, res: Response) => {
  try {
    const auth = requireAuth(req, res);
    if (!auth) return;
    if (!pool) return res.status(503).json({ success: false, error: 'DB not ready' });

    const accountRes = await pool.query(
      `SELECT id, platform, account_id, account_name, access_token, access_token_encrypted, refresh_token, token_data, followers
       FROM social_accounts WHERE user_id=$1 AND connected=true`,
      [auth.userId]
    );

    let synced = 0;
    const errors: string[] = [];

    for (const acct of accountRes.rows as any[]) {
      const platform = (acct.platform || '').toLowerCase();
      let token = '';
      if (acct.access_token_encrypted) {
        try { token = decryptIntegrationSecret(String(acct.access_token_encrypted)); } catch (_err) { /* */ }
      }
      if (!token) token = String(acct.access_token || '').trim();
      if (!token) continue;

      try {
        if (platform === 'facebook') {
          const fbPageId = acct.account_id || 'me';

          // ── Fetch page profile (followers, post count, bio) ───────────────────
          try {
            const pageResp = await axios.get(`https://graph.facebook.com/v19.0/${fbPageId}`, {
              params: {
                access_token: token,
                fields: 'id,name,about,fan_count,followers_count,posts.summary(total_count).limit(0)',
              },
              validateStatus: () => true, timeout: 10000,
            });
            if (pageResp.status === 200 && pageResp.data) {
              const pd = pageResp.data;
              const followers  = parseInt(String(pd.fan_count ?? pd.followers_count ?? 0)) || 0;
              const postsCount = parseInt(String(pd.posts?.summary?.total_count ?? 0)) || 0;
              const bio        = typeof pd.about === 'string' && pd.about.trim() ? pd.about.trim() : null;
              const pageName   = typeof pd.name  === 'string' && pd.name.trim()  ? pd.name.trim()  : null;
              logger.info('[Facebook sync] page:', pageName, 'followers:', followers, 'posts:', postsCount);
              await pool!.query(
                `INSERT INTO social_profile_stats
                   (id, user_id, social_account_id, platform,
                    followers, posts_count, bio, raw_response, synced_at)
                 VALUES (gen_random_uuid()::text, $1, $2, 'facebook',
                         $3, $4, $5, $6::jsonb, NOW())
                 ON CONFLICT (social_account_id) DO UPDATE SET
                   followers   = CASE WHEN EXCLUDED.followers   > 0 THEN EXCLUDED.followers   ELSE social_profile_stats.followers   END,
                   posts_count = CASE WHEN EXCLUDED.posts_count > 0 THEN EXCLUDED.posts_count ELSE social_profile_stats.posts_count END,
                   bio         = COALESCE(EXCLUDED.bio, social_profile_stats.bio),
                   raw_response= EXCLUDED.raw_response,
                   synced_at   = NOW()`,
                [auth.userId, acct.id, followers, postsCount, bio, JSON.stringify(pd)]
              );
              await pool!.query(
                `UPDATE social_accounts SET
                   account_name = COALESCE($1, account_name),
                   followers    = CASE WHEN $2 > 0 THEN $2 ELSE followers END
                 WHERE id = $3`,
                [pageName, followers, acct.id]
              );
              synced++;
            }
          } catch (profileErr: any) {
            errors.push(`facebook profile: ${profileErr.message}`);
          }

          // ── Fetch post metrics ────────────────────────────────────────────────
          const feedResp = await axios.get(`https://graph.facebook.com/v19.0/${fbPageId}/posts`, {
            params: { access_token: token, fields: 'id,message,created_time,full_picture', limit: 25 },
            validateStatus: () => true, timeout: 15000,
          });
          if (feedResp.status === 200) {
            const posts: any[] = feedResp.data?.data || [];
            for (const post of posts) {
              try {
                const insResp = await axios.get(`https://graph.facebook.com/v19.0/${post.id}/insights`, {
                  params: { access_token: token, metric: 'post_impressions,post_impressions_unique,post_engaged_users,post_clicks,post_reactions_by_type_total' },
                  validateStatus: () => true, timeout: 10000,
                });
                const insData: any[] = insResp.data?.data || [];
                const getM = (name: string) => insData.find((m: any) => m.name === name)?.values?.[0]?.value;
                const reactions: Record<string, number> = getM('post_reactions_by_type_total') || {};
                const likes = Object.values(reactions).reduce((s, v) => s + (parseInt(String(v)) || 0), 0);
                const impressions = parseInt(getM('post_impressions') || 0);
                const reach = parseInt(getM('post_impressions_unique') || 0);
                const engagement = parseInt(getM('post_engaged_users') || 0);
                await pool!.query(
                  `INSERT INTO social_metrics (id, user_id, platform, platform_post_id, social_account_id, likes, impressions, reach, engagement, raw_data, posted_at)
                   VALUES (gen_random_uuid()::text, $1, 'facebook', $2, $3, $4, $5, $6, $7, $8::jsonb, $9)
                   ON CONFLICT (user_id, platform, platform_post_id) DO UPDATE SET
                     likes=EXCLUDED.likes, impressions=EXCLUDED.impressions, reach=EXCLUDED.reach,
                     engagement=EXCLUDED.engagement, raw_data=EXCLUDED.raw_data, fetched_at=NOW()`,
                  [auth.userId, post.id, acct.id, likes, impressions, reach, engagement,
                   JSON.stringify({ post, insights: insData }),
                   post.created_time ? new Date(post.created_time).toISOString() : null]
                );
                synced++;
              } catch (_err) { /* skip individual post errors */ }
            }
          }
        } else if (platform === 'twitter' || platform === 'x') {
          const twitterUserId = acct.token_data?.userId || acct.token_data?.user_id || acct.account_id;
          if (twitterUserId) {
            const tweetsResp = await axios.get(`https://api.x.com/2/users/${twitterUserId}/tweets`, {
              headers: { Authorization: `Bearer ${token}` },
              params: { max_results: 25, 'tweet.fields': 'public_metrics,created_at' },
              validateStatus: () => true, timeout: 15000,
            });
            if (tweetsResp.status === 200) {
              const tweets: any[] = tweetsResp.data?.data || [];
              for (const tweet of tweets) {
                const m = tweet.public_metrics || {};
                const engagement = (m.like_count || 0) + (m.reply_count || 0) + (m.retweet_count || 0);
                await pool!.query(
                  `INSERT INTO social_metrics (id, user_id, platform, platform_post_id, social_account_id, likes, comments, shares, impressions, engagement, raw_data, posted_at)
                   VALUES (gen_random_uuid()::text, $1, 'twitter', $2, $3, $4, $5, $6, $7, $8, $9::jsonb, $10)
                   ON CONFLICT (user_id, platform, platform_post_id) DO UPDATE SET
                     likes=EXCLUDED.likes, comments=EXCLUDED.comments, shares=EXCLUDED.shares,
                     impressions=EXCLUDED.impressions, engagement=EXCLUDED.engagement,
                     raw_data=EXCLUDED.raw_data, fetched_at=NOW()`,
                  [auth.userId, tweet.id, acct.id, m.like_count || 0, m.reply_count || 0,
                   m.retweet_count || 0, m.impression_count || 0, engagement, JSON.stringify(tweet),
                   tweet.created_at ? new Date(tweet.created_at).toISOString() : null]
                );
                synced++;
              }
              const userResp = await axios.get(`https://api.x.com/2/users/${twitterUserId}`, {
                headers: { Authorization: `Bearer ${token}` },
                params: { 'user.fields': 'public_metrics' },
                validateStatus: () => true, timeout: 10000,
              });
              if (userResp.status === 200 && userResp.data?.data?.public_metrics?.followers_count) {
                await pool!.query(`UPDATE social_accounts SET followers=$1 WHERE id=$2`,
                  [userResp.data.data.public_metrics.followers_count, acct.id]);
              }
            }
          }
        } else if (platform === 'tiktok') {
          // ── Fetch TikTok user profile (with scope fallback) ────────────────────
          try {
            const { user: u, scopeLimited } = await fetchTikTokUserProfile(token);
            if (u) {
              const followers  = Number(u.follower_count  ?? 0);
              const following  = Number(u.following_count ?? 0);
              const postsCount = Number(u.video_count     ?? 0);
              const totalLikes = Number(u.likes_count     ?? 0);
              logger.info('[TikTok sync] followers:', followers, 'following:', following, 'posts:', postsCount, 'likes:', totalLikes, 'scopeLimited:', scopeLimited);
              const bio        = typeof u.bio_description === 'string' ? u.bio_description : null;
              const isVerified = Boolean(u.is_verified ?? false);

              await pool!.query(
                `INSERT INTO social_profile_stats
                   (id, user_id, social_account_id, platform,
                    followers, following, posts_count, total_likes,
                    bio, is_verified, raw_response, synced_at)
                 VALUES (gen_random_uuid()::text, $1, $2, 'tiktok',
                         $3, $4, $5, $6, $7, $8, $9::jsonb, NOW())
                 ON CONFLICT (social_account_id) DO UPDATE SET
                   followers   = CASE WHEN EXCLUDED.followers > 0 THEN EXCLUDED.followers ELSE social_profile_stats.followers END,
                   following   = CASE WHEN EXCLUDED.following   > 0 THEN EXCLUDED.following   ELSE social_profile_stats.following   END,
                   posts_count = CASE WHEN EXCLUDED.posts_count > 0 THEN EXCLUDED.posts_count ELSE social_profile_stats.posts_count END,
                   total_likes = CASE WHEN EXCLUDED.total_likes > 0 THEN EXCLUDED.total_likes ELSE social_profile_stats.total_likes END,
                   bio         = COALESCE(EXCLUDED.bio,         social_profile_stats.bio),
                   is_verified = EXCLUDED.is_verified,
                   raw_response= EXCLUDED.raw_response,
                   synced_at   = NOW()`,
                [auth.userId, acct.id,
                 followers, following, postsCount, totalLikes,
                 bio, isVerified, JSON.stringify(u)]
              );
              // Update account_name and handle in social_accounts from live profile data
              const displayName = typeof u.display_name === 'string' && u.display_name.trim() ? u.display_name.trim() : null;
              const username    = typeof u.username    === 'string' && u.username.trim()    ? u.username.trim()    : null;
              await pool!.query(
                `UPDATE social_accounts SET
                   account_name = COALESCE($1, account_name),
                   handle       = COALESCE($2, handle),
                   followers    = CASE WHEN $3 > 0 THEN $3 ELSE followers END
                 WHERE id = $4`,
                [displayName, username, followers, acct.id]
              );
              // Verify what actually landed in the DB
              const verify = await pool!.query(`SELECT followers FROM social_profile_stats WHERE social_account_id=$1`, [acct.id]);
              logger.info('[TikTok sync] DB followers after upsert:', verify.rows[0]?.followers);
              synced++;
              if (scopeLimited) {
                errors.push('tiktok: stats scope not granted — reconnect TikTok to enable follower/video counts');
              }
            }
          } catch (profileErr: any) {
            errors.push(`tiktok: ${profileErr.message}`);
          }

          // ── Fetch TikTok videos and metrics ───────────────────────────────────
          // video/list is POST, cursor-based, max 20/page, all fields in one call.
          try {
            const TT_VIDEO_FIELDS = 'id,title,cover_image_url,share_url,video_description,create_time,duration,height,width,embed_html,embed_link,like_count,comment_count,share_count,view_count';
            let ttCursor: number | undefined;
            let ttHasMore = true;
            let ttPage = 0;
            const TT_MAX_PAGES = 10;

            while (ttHasMore && ttPage < TT_MAX_PAGES) {
              const ttBody: Record<string, any> = { max_count: 20 };
              if (ttCursor !== undefined) ttBody.cursor = ttCursor;

              const videosResp = await axios.post(
                'https://open.tiktokapis.com/v2/video/list/',
                ttBody,
                {
                  headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
                  params: { fields: TT_VIDEO_FIELDS },
                  validateStatus: () => true,
                  timeout: 15000,
                }
              );

              const vidErrCode = videosResp.data?.error?.code;
              if (vidErrCode && vidErrCode !== 'ok') {
                if (ttPage === 0) logger.info(`TikTok video.list scope not available (${vidErrCode}) — skipping`);
                break;
              }
              if (videosResp.status !== 200) break;

              const videos: any[] = videosResp.data?.data?.videos || [];
              ttHasMore = videosResp.data?.data?.has_more === true;
              ttCursor  = videosResp.data?.data?.cursor;
              ttPage++;

              for (const v of videos) {
                if (!v.id) continue;
                const videoId    = String(v.id);
                const likes      = Number(v.like_count    ?? 0);
                const comments   = Number(v.comment_count ?? 0);
                const shares     = Number(v.share_count   ?? 0);
                const views      = Number(v.view_count    ?? 0);
                const engagement = likes + comments + shares;
                const duration   = Number(v.duration ?? 0);
                const postedAt   = v.create_time ? new Date(v.create_time * 1000).toISOString() : null;

                await pool!.query(
                  `INSERT INTO tiktok_video_insights
                     (id, user_id, social_account_id, video_id, title, cover_url, share_url,
                      likes, comments, shares, views, engagement, duration_seconds, posted_at,
                      video_description, embed_html, embed_link, height, width,
                      fetched_at, raw_data)
                   VALUES (gen_random_uuid()::text, $1, $2, $3, $4, $5, $6,
                           $7, $8, $9, $10, $11, $12, $13,
                           $14, $15, $16, $17, $18,
                           NOW(), $19::jsonb)
                   ON CONFLICT (social_account_id, video_id) DO UPDATE SET
                     title=EXCLUDED.title, cover_url=EXCLUDED.cover_url, share_url=EXCLUDED.share_url,
                     likes=EXCLUDED.likes, comments=EXCLUDED.comments, shares=EXCLUDED.shares,
                     views=EXCLUDED.views, engagement=EXCLUDED.engagement,
                     duration_seconds=EXCLUDED.duration_seconds,
                     video_description=EXCLUDED.video_description,
                     embed_html=EXCLUDED.embed_html, embed_link=EXCLUDED.embed_link,
                     height=EXCLUDED.height, width=EXCLUDED.width,
                     fetched_at=NOW(), raw_data=EXCLUDED.raw_data`,
                  [
                    auth.userId, acct.id, videoId,
                    typeof v.title === 'string' ? v.title.slice(0, 500) : null,
                    typeof v.cover_image_url === 'string' ? v.cover_image_url : null,
                    typeof v.share_url === 'string' ? v.share_url : null,
                    likes, comments, shares, views, engagement, duration, postedAt,
                    typeof v.video_description === 'string' ? v.video_description.slice(0, 2000) : null,
                    typeof v.embed_html === 'string' ? v.embed_html : null,
                    typeof v.embed_link === 'string' ? v.embed_link : null,
                    Number(v.height ?? 0), Number(v.width ?? 0),
                    JSON.stringify(v),
                  ]
                );

                // Also keep social_metrics for cross-platform aggregations
                await pool!.query(
                  `INSERT INTO social_metrics (id, user_id, platform, platform_post_id, social_account_id, likes, comments, shares, impressions, reach, engagement, raw_data, posted_at, fetched_at)
                   VALUES (gen_random_uuid()::text, $1, 'tiktok', $2, $3, $4, $5, $6, $7, $8, $9, $10::jsonb, $11, NOW())
                   ON CONFLICT (user_id, platform, platform_post_id) DO UPDATE SET
                     likes=EXCLUDED.likes, comments=EXCLUDED.comments, shares=EXCLUDED.shares,
                     impressions=EXCLUDED.impressions, reach=EXCLUDED.reach, engagement=EXCLUDED.engagement,
                     raw_data=EXCLUDED.raw_data, fetched_at=NOW()`,
                  [auth.userId, videoId, acct.id, likes, comments, shares, views, views, engagement, JSON.stringify(v), postedAt]
                );
                synced++;
              }

              if (!ttHasMore || ttCursor === undefined) break;
            }
          } catch (vidErr: any) {
            logger.error('TikTok video fetch error:', vidErr.message);
          }
        } else if (platform === 'pinterest') {
          const pinterestResult = await syncPinterestAnalyticsAccount({
            userId: auth.userId,
            account: acct,
            days: 30,
            maxPins: 50,
          });
          synced += pinterestResult.synced;
          errors.push(...pinterestResult.errors.map((message) => `pinterest: ${message}`));
        } else if (platform === 'instagram') {
          const instagramResult = await syncInstagramAnalyticsAccount({
            userId: auth.userId,
            account: acct,
            days: 30,
          });
          synced += instagramResult.synced;
          errors.push(...instagramResult.errors.map((message) => `instagram: ${message}`));
        } else if (platform === 'linkedin') {
          const tokenData = acct.token_data || {};
          const personUrn = tokenData.personUrn || tokenData.urn || tokenData.sub;
          if (personUrn) {
            const sharesResp = await axios.get('https://api.linkedin.com/v2/shares', {
              headers: { Authorization: `Bearer ${token}`, 'X-Restli-Protocol-Version': '2.0.0' },
              params: { q: 'owners', owners: personUrn, count: 20 },
              validateStatus: () => true, timeout: 15000,
            });
            if (sharesResp.status === 200) {
              const shares: any[] = sharesResp.data?.elements || [];
              for (const share of shares) {
                const shareId = share.activity || share.id;
                if (!shareId) continue;
                let stats: any = {};
                try {
                  const statsResp = await axios.get('https://api.linkedin.com/v2/socialActions/' + encodeURIComponent(shareId), {
                    headers: { Authorization: `Bearer ${token}`, 'X-Restli-Protocol-Version': '2.0.0' },
                    validateStatus: () => true, timeout: 10000,
                  });
                  stats = statsResp.data || {};
                } catch (_err) { /* optional */ }
                const likeCount = stats.likesSummary?.totalLikes || 0;
                const commentCount = stats.commentsSummary?.totalFirstLevelComments || 0;
                await pool!.query(
                  `INSERT INTO social_metrics (id, user_id, platform, platform_post_id, social_account_id, likes, comments, engagement, raw_data, posted_at)
                   VALUES (gen_random_uuid()::text, $1, 'linkedin', $2, $3, $4, $5, $6, $7::jsonb, $8)
                   ON CONFLICT (user_id, platform, platform_post_id) DO UPDATE SET
                     likes=EXCLUDED.likes, comments=EXCLUDED.comments, engagement=EXCLUDED.engagement,
                     raw_data=EXCLUDED.raw_data, fetched_at=NOW()`,
                  [auth.userId, shareId, acct.id, likeCount, commentCount,
                   likeCount + commentCount, JSON.stringify({ share, stats }),
                   share.created?.time ? new Date(share.created.time).toISOString() : null]
                );
                synced++;
              }
            }
          }
        }
      } catch (platformErr: any) {
        const msg = platformErr?.response?.data?.error?.message || platformErr?.message || 'Failed';
        errors.push(`${platform}: ${msg}`);
        logger.error(`Analytics sync error for ${platform}:`, msg);
      }
    }

    // Store last synced timestamp
    await pool.query(
      `INSERT INTO insights_cache (id, user_id, cache_key, data, expires_at)
       VALUES (gen_random_uuid()::text, $1, 'last_synced', $2::jsonb, NOW() + INTERVAL '1 year')
       ON CONFLICT (user_id, cache_key) DO UPDATE SET data=EXCLUDED.data, expires_at=EXCLUDED.expires_at`,
      [auth.userId, JSON.stringify({ lastSyncedAt: new Date().toISOString() })]
    );

    return res.json({ success: true, synced, errors: errors.length > 0 ? errors : undefined });
  } catch (err) {
    logger.error('Analytics refresh error:', err);
    return res.status(500).json({ success: false, error: 'Failed to sync analytics' });
  }
});

// GET /api/blog/analytics/export — CSV export
router.get('/api/blog/analytics/export', async (req: Request, res: Response) => {
  try {
    const auth = requireAuth(req, res);
    if (!auth) return;
    if (!pool) return res.status(503).json({ success: false, error: 'DB not ready' });

    const q = req.query as any;
    const range = parseAnalyticsRange(q.preset, q.start, q.end);

    const rows = await pool.query(
      `SELECT pl.platform, pl.status, pl.created_at, pl.error_message,
              bp.title as post_title,
              sm.likes, sm.comments, sm.shares, sm.impressions, sm.reach, sm.engagement
       FROM publishing_logs pl
       LEFT JOIN blog_posts bp ON bp.id = pl.post_id
       LEFT JOIN social_metrics sm ON sm.user_id = pl.user_id AND sm.platform = pl.platform
         AND sm.platform_post_id = COALESCE(pl.platform_post_id, '')
       WHERE pl.user_id=$1 AND pl.created_at >= $2 AND pl.created_at <= $3
       ORDER BY pl.created_at DESC`,
      [auth.userId, range.startIso, range.endIso]
    );

    const headers = ['Date', 'Platform', 'Post Title', 'Status', 'Likes', 'Comments', 'Shares', 'Impressions', 'Reach', 'Engagement', 'Error'];
    const csvLines = [headers.join(',')];
    for (const row of rows.rows as any[]) {
      csvLines.push([
        new Date(row.created_at).toISOString().slice(0, 10),
        row.platform || '',
        `"${(row.post_title || 'Untitled').replace(/"/g, '""')}"`,
        row.status || '',
        row.likes ?? '', row.comments ?? '', row.shares ?? '',
        row.impressions ?? '', row.reach ?? '', row.engagement ?? '',
        `"${(row.error_message || '').replace(/"/g, '""')}"`,
      ].join(','));
    }

    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', `attachment; filename="analytics-${range.preset}-${analyticsFmtDate(new Date())}.csv"`);
    return res.send(csvLines.join('\n'));
  } catch (err) {
    logger.error('Analytics export error:', err);
    return res.status(500).json({ success: false, error: 'Failed to export analytics' });
  }
});

// ─── Social Account Analytics ────────────────────────────────────────────────

// GET /api/analytics/social/accounts — all connected accounts with aggregated metrics
router.get('/api/analytics/social/accounts', async (req: Request, res: Response) => {
  try {
    const auth = requireAuth(req, res);
    if (!auth) return;
    if (!pool) return res.status(503).json({ success: false, error: 'DB not ready' });

    const days = Math.max(1, Math.min(365, parseInt(String(req.query.days || '30'))));
    const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();

    const result = await pool.query(
      `SELECT
         sa.id,
         sa.platform,
         COALESCE(sa.account_name, sa.handle, sa.platform) AS account_name,
         sa.handle,
         sa.connected_at,
         -- followers: prefer live value from social_profile_stats, fall back to social_accounts
         COALESCE(sps.followers, sa.followers, 0)::bigint  AS followers,
         COALESCE(sps.following,    0)::bigint             AS following_count,
         COALESCE(sps.posts_count,  0)::bigint             AS video_count,
         COALESCE(sps.total_likes,  0)::bigint             AS total_likes_count,
         sps.bio,
         sps.is_verified,
         sps.synced_at,
         -- aggregated post-level metrics from social_metrics
         COALESCE(SUM(sm.reach),       0)::bigint AS total_reach,
         COALESCE(SUM(sm.impressions), 0)::bigint AS total_impressions,
         COALESCE(SUM(sm.engagement),  0)::bigint AS total_engagement,
         COALESCE(SUM(sm.likes),       0)::bigint AS total_likes,
         COALESCE(SUM(sm.comments),    0)::bigint AS total_comments,
         COALESCE(SUM(sm.shares),      0)::bigint AS total_shares,
         COUNT(sm.id)::int AS posts_synced,
         CASE WHEN SUM(sm.impressions) > 0
           THEN ROUND(SUM(sm.engagement)::numeric / NULLIF(SUM(sm.impressions), 0) * 100, 2)
           ELSE 0 END AS engagement_rate
       FROM social_accounts sa
       LEFT JOIN social_profile_stats sps ON sps.social_account_id = sa.id
       LEFT JOIN social_metrics sm ON sm.social_account_id = sa.id
         AND sm.user_id = $1
         AND (sm.posted_at >= $2 OR sm.posted_at IS NULL)
       WHERE sa.user_id = $1 AND sa.connected = true
       GROUP BY sa.id, sa.platform, sa.account_name, sa.handle, sa.followers, sa.connected_at,
                sps.followers, sps.following, sps.posts_count, sps.total_likes,
                sps.bio, sps.is_verified, sps.synced_at
       ORDER BY sa.platform`,
      [auth.userId, since]
    );

    return res.json({ success: true, accounts: result.rows, days });
  } catch (err) {
    logger.error('Social accounts analytics error:', err);
    return res.status(500).json({ success: false, error: 'Failed to fetch account analytics' });
  }
});

// GET /api/analytics/social/account/:accountId — per-account dashboard
router.get('/api/analytics/social/account/:accountId', async (req: Request, res: Response) => {
  try {
    const auth = requireAuth(req, res);
    if (!auth) return;
    if (!pool) return res.status(503).json({ success: false, error: 'DB not ready' });

    const { accountId } = req.params;
    const days = Math.max(1, Math.min(365, parseInt(String(req.query.days || '30'))));
    const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();

    const acctResult = await pool.query(
      `SELECT sa.id, sa.platform,
         COALESCE(sa.account_name, sa.handle, sa.platform) AS account_name,
         sa.handle, sa.connected_at,
         COALESCE(sps.followers, sa.followers, 0)::bigint AS followers,
         COALESCE(sps.following,   0)::bigint AS following_count,
         COALESCE(sps.posts_count, 0)::bigint AS video_count,
         COALESCE(sps.total_likes, 0)::bigint AS total_likes_count,
         sps.bio, sps.is_verified, sps.synced_at
       FROM social_accounts sa
       LEFT JOIN social_profile_stats sps ON sps.social_account_id = sa.id
       WHERE sa.id = $1 AND sa.user_id = $2 AND sa.connected = true`,
      [accountId, auth.userId]
    );
    if (acctResult.rows.length === 0) {
      return res.status(404).json({ success: false, error: 'Account not found' });
    }
    const account = acctResult.rows[0];

    const [summaryResult, trendResult, topPostsResult] = await Promise.all([
      pool.query(
        `SELECT
           COALESCE(SUM(reach), 0)::bigint AS total_reach,
           COALESCE(SUM(impressions), 0)::bigint AS total_impressions,
           COALESCE(SUM(engagement), 0)::bigint AS total_engagement,
           COALESCE(SUM(likes), 0)::bigint AS total_likes,
           COALESCE(SUM(comments), 0)::bigint AS total_comments,
           COALESCE(SUM(shares), 0)::bigint AS total_shares,
           COUNT(*)::int AS posts_count,
           CASE WHEN SUM(impressions) > 0
             THEN ROUND(SUM(engagement)::numeric / NULLIF(SUM(impressions), 0) * 100, 2)
             ELSE 0 END AS engagement_rate
         FROM social_metrics
         WHERE social_account_id = $1 AND user_id = $2
           AND (posted_at >= $3 OR posted_at IS NULL)`,
        [accountId, auth.userId, since]
      ),
      pool.query(
        `SELECT
           DATE(posted_at) AS date,
           COALESCE(SUM(reach), 0)::bigint AS reach,
           COALESCE(SUM(impressions), 0)::bigint AS impressions,
           COALESCE(SUM(engagement), 0)::bigint AS engagement,
           COALESCE(SUM(likes), 0)::bigint AS likes,
           COALESCE(SUM(comments), 0)::bigint AS comments,
           COUNT(*)::int AS posts,
           CASE WHEN SUM(impressions) > 0
             THEN ROUND(SUM(engagement)::numeric / NULLIF(SUM(impressions), 0) * 100, 2)
             ELSE 0 END AS engagement_rate
         FROM social_metrics
         WHERE social_account_id = $1 AND user_id = $2
           AND posted_at IS NOT NULL AND posted_at >= $3
         GROUP BY DATE(posted_at)
         ORDER BY date`,
        [accountId, auth.userId, since]
      ),
      pool.query(
        `SELECT
           sm.platform_post_id,
           sm.post_id,
           COALESCE(bp.title, sm.raw_data->>'title', 'Post ' || LEFT(sm.platform_post_id, 8)) AS title,
           COALESCE(sm.likes, 0)::bigint AS likes,
           COALESCE(sm.comments, 0)::bigint AS comments,
           COALESCE(sm.shares, 0)::bigint AS shares,
           COALESCE(sm.impressions, 0)::bigint AS impressions,
           COALESCE(sm.reach, 0)::bigint AS reach,
           COALESCE(sm.engagement, 0)::bigint AS engagement,
           sm.posted_at,
           CASE WHEN sm.impressions > 0
             THEN ROUND(sm.engagement::numeric / NULLIF(sm.impressions, 0) * 100, 2)
             ELSE 0 END AS engagement_rate
         FROM social_metrics sm
         LEFT JOIN blog_posts bp ON bp.id = sm.post_id
         WHERE sm.social_account_id = $1 AND sm.user_id = $2
           AND (sm.posted_at >= $3 OR sm.posted_at IS NULL)
         ORDER BY sm.engagement DESC NULLS LAST, sm.likes DESC NULLS LAST
         LIMIT 10`,
        [accountId, auth.userId, since]
      ),
    ]);

    logger.info('[TikTok dashboard] account row followers:', account.followers, 'following_count:', account.following_count, 'video_count:', account.video_count);
    return res.json({
      success: true,
      account: {
        id: account.id,
        platform: account.platform,
        account_name: account.account_name,
        handle: account.handle,
        followers: parseInt(String(account.followers || '0')),
        following_count: parseInt(String(account.following_count || '0')),
        video_count: parseInt(String(account.video_count || '0')),
        total_likes_count: parseInt(String(account.total_likes_count || '0')),
        bio: account.bio || null,
        is_verified: Boolean(account.is_verified),
        connected_at: account.connected_at,
      },
      summary: summaryResult.rows[0] || {},
      trend: trendResult.rows,
      top_posts: topPostsResult.rows,
      days,
    });
  } catch (err) {
    logger.error('Account analytics error:', err);
    return res.status(500).json({ success: false, error: 'Failed to fetch account analytics' });
  }
});

// GET /api/analytics/social/comparison — multi-account comparison with rankings
router.get('/api/analytics/social/comparison', async (req: Request, res: Response) => {
  try {
    const auth = requireAuth(req, res);
    if (!auth) return;
    if (!pool) return res.status(503).json({ success: false, error: 'DB not ready' });

    const days = Math.max(1, Math.min(365, parseInt(String(req.query.days || '30'))));
    const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();

    const result = await pool.query(
      `SELECT
         sa.id,
         sa.platform,
         COALESCE(sa.account_name, sa.handle, sa.platform) AS account_name,
         sa.handle,
         COALESCE(sa.followers, 0)::bigint AS followers,
         COALESCE(SUM(sm.reach), 0)::bigint AS total_reach,
         COALESCE(SUM(sm.impressions), 0)::bigint AS total_impressions,
         COALESCE(SUM(sm.engagement), 0)::bigint AS total_engagement,
         COALESCE(SUM(sm.likes), 0)::bigint AS total_likes,
         COUNT(sm.id)::int AS posts_synced,
         CASE WHEN SUM(sm.impressions) > 0
           THEN ROUND(SUM(sm.engagement)::numeric / NULLIF(SUM(sm.impressions), 0) * 100, 2)
           ELSE 0 END AS engagement_rate
       FROM social_accounts sa
       LEFT JOIN social_metrics sm ON sm.social_account_id = sa.id
         AND sm.user_id = $1
         AND (sm.posted_at >= $2 OR sm.posted_at IS NULL)
       WHERE sa.user_id = $1 AND sa.connected = true
       GROUP BY sa.id, sa.platform, sa.account_name, sa.handle, sa.followers
       ORDER BY SUM(sm.engagement) DESC NULLS LAST`,
      [auth.userId, since]
    );

    const accounts: any[] = result.rows;
    const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

    const byFollowers = [...accounts].sort((a, b) => parseInt(b.followers) - parseInt(a.followers));
    const byEngagement = [...accounts].sort((a, b) => parseFloat(b.engagement_rate) - parseFloat(a.engagement_rate));
    const byReach = [...accounts].sort((a, b) => parseInt(b.total_reach) - parseInt(a.total_reach));

    const insights: Array<{ type: string; title: string; description: string; winner: string }> = [];
    if (accounts.length >= 2) {
      const topF = byFollowers[0];
      if (parseInt(topF.followers) > 0) {
        insights.push({ type: 'followers_leader', title: 'Largest Audience', winner: topF.platform,
          description: `${cap(topF.platform)} has your largest audience with ${Number(topF.followers).toLocaleString()} followers.` });
      }
      const topE = byEngagement[0];
      if (parseFloat(topE.engagement_rate) > 0) {
        insights.push({ type: 'engagement_leader', title: 'Highest Engagement', winner: topE.platform,
          description: `${cap(topE.platform)} leads engagement at ${parseFloat(topE.engagement_rate).toFixed(2)}% over the last ${days} days.` });
      }
      const topR = byReach[0];
      if (parseInt(topR.total_reach) > 0) {
        insights.push({ type: 'reach_leader', title: 'Top Reach', winner: topR.platform,
          description: `${cap(topR.platform)} reached the most people — ${Number(topR.total_reach).toLocaleString()} in the last ${days} days.` });
      }
    }

    return res.json({
      success: true,
      accounts,
      rankings: {
        by_followers: byFollowers.map((a, i) => ({ id: a.id, platform: a.platform, account_name: a.account_name, value: parseInt(a.followers), rank: i + 1 })),
        by_engagement: byEngagement.map((a, i) => ({ id: a.id, platform: a.platform, account_name: a.account_name, value: parseFloat(a.engagement_rate), rank: i + 1 })),
        by_reach: byReach.map((a, i) => ({ id: a.id, platform: a.platform, account_name: a.account_name, value: parseInt(a.total_reach), rank: i + 1 })),
      },
      insights,
      days,
    });
  } catch (err) {
    logger.error('Comparison analytics error:', err);
    return res.status(500).json({ success: false, error: 'Failed to fetch comparison analytics' });
  }
});

// ─── TikTok-specific analytics routes ────────────────────────────────────────

// POST /api/social/tiktok/sync — manual sync of TikTok profile + video data
router.post('/api/social/tiktok/sync', async (req: Request, res: Response) => {
  try {
    const auth = requireAuth(req, res);
    if (!auth) return;
    if (!pool) return res.status(503).json({ success: false, error: 'DB not ready' });

    const accountRes = await pool.query(
      `SELECT id, account_id, access_token, access_token_encrypted, refresh_token, refresh_token_encrypted, token_data
       FROM social_accounts WHERE user_id=$1 AND platform='tiktok' AND connected=true`,
      [auth.userId]
    );
    if (accountRes.rows.length === 0) {
      return res.status(404).json({ success: false, error: 'No connected TikTok account found' });
    }

    let synced = 0;
    const errors: string[] = [];

    for (const acct of accountRes.rows as any[]) {
      let token = '';
      if (acct.access_token_encrypted) {
        try { token = decryptIntegrationSecret(String(acct.access_token_encrypted)); } catch (_err) { /* */ }
      }
      if (!token) token = String(acct.access_token || '').trim();
      if (!token) { errors.push('No access token available'); continue; }

      // ── Profile sync (with scope fallback) ────────────────────────────────
      try {
        const { user: u, scopeLimited } = await fetchTikTokUserProfile(token);
        if (u) {
          const followers  = Number(u.follower_count  ?? 0);
          const following  = Number(u.following_count ?? 0);
          const postsCount = Number(u.video_count     ?? 0);
          const totalLikes = Number(u.likes_count     ?? 0);
          const bio        = typeof u.bio_description === 'string' ? u.bio_description : null;
          const isVerified = Boolean(u.is_verified ?? false);
          await pool.query(
            `INSERT INTO social_profile_stats
               (id, user_id, social_account_id, platform,
                followers, following, posts_count, total_likes,
                bio, is_verified, raw_response, synced_at)
             VALUES (gen_random_uuid()::text, $1, $2, 'tiktok', $3, $4, $5, $6, $7, $8, $9::jsonb, NOW())
             ON CONFLICT (social_account_id) DO UPDATE SET
               followers   = CASE WHEN EXCLUDED.followers   > 0 THEN EXCLUDED.followers   ELSE social_profile_stats.followers   END,
               following   = CASE WHEN EXCLUDED.following   > 0 THEN EXCLUDED.following   ELSE social_profile_stats.following   END,
               posts_count = CASE WHEN EXCLUDED.posts_count > 0 THEN EXCLUDED.posts_count ELSE social_profile_stats.posts_count END,
               total_likes = CASE WHEN EXCLUDED.total_likes > 0 THEN EXCLUDED.total_likes ELSE social_profile_stats.total_likes END,
               bio         = COALESCE(EXCLUDED.bio, social_profile_stats.bio),
               is_verified = EXCLUDED.is_verified,
               raw_response= EXCLUDED.raw_response,
               synced_at   = NOW()`,
            [auth.userId, acct.id,
             followers, following, postsCount, totalLikes,
             bio, isVerified, JSON.stringify(u)]
          );
          const displayName = typeof u.display_name === 'string' && u.display_name.trim() ? u.display_name.trim() : null;
          const username    = typeof u.username    === 'string' && u.username.trim()    ? u.username.trim()    : null;
          await pool.query(
            `UPDATE social_accounts SET
               account_name = COALESCE($1, account_name),
               handle       = COALESCE($2, handle),
               followers    = CASE WHEN $3 > 0 THEN $3 ELSE followers END
             WHERE id = $4`,
            [displayName, username, followers, acct.id]
          );
          synced++;
          if (scopeLimited) {
            errors.push('Stats scope not granted — reconnect TikTok to enable follower/video counts');
          }
        }
      } catch (profileErr: any) {
        errors.push(`Profile sync failed: ${profileErr.message}`);
      }

      // ── Video insights sync ────────────────────────────────────────────────
      // video/list is a POST endpoint (not GET). All fields — including
      // video_description, embed_html, embed_link, height, width — are
      // available directly. No separate video/query call needed.
      // Pagination: cursor-based, max 20/page, loop until has_more = false.
      // cover_image_url has a 6-hour CDN TTL — always update on sync.
      try {
        const VIDEO_FIELDS = 'id,title,cover_image_url,share_url,video_description,create_time,duration,height,width,embed_html,embed_link,like_count,comment_count,share_count,view_count';
        let cursor: number | undefined;
        let hasMore = true;
        let pageCount = 0;
        const MAX_PAGES = 10; // safety cap — 10 pages × 20 = 200 videos

        while (hasMore && pageCount < MAX_PAGES) {
          const body: Record<string, any> = { max_count: 20 };
          if (cursor !== undefined) body.cursor = cursor;

          const listResp = await axios.post(
            'https://open.tiktokapis.com/v2/video/list/',
            body,
            {
              headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
              params: { fields: VIDEO_FIELDS },
              validateStatus: () => true,
              timeout: 15000,
            }
          );

          const listErrCode = listResp.data?.error?.code;
          if (listErrCode && listErrCode !== 'ok') {
            if (pageCount === 0) {
              logger.info(`TikTok video.list scope not available (${listErrCode}) — skipping video sync`);
            }
            break;
          }
          if (listResp.status !== 200) break;

          const pageVideos: any[] = listResp.data?.data?.videos || [];
          hasMore = listResp.data?.data?.has_more === true;
          cursor  = listResp.data?.data?.cursor;
          pageCount++;

          for (const v of pageVideos) {
            if (!v.id) continue;
            const likes    = Number(v.like_count    ?? 0);
            const comments = Number(v.comment_count ?? 0);
            const shares   = Number(v.share_count   ?? 0);
            const views    = Number(v.view_count    ?? 0);
            const engagement = likes + comments + shares;

            await pool!.query(
              `INSERT INTO tiktok_video_insights
                 (id, user_id, social_account_id, video_id, title, cover_url, share_url,
                  likes, comments, shares, views, engagement, duration_seconds, posted_at,
                  video_description, embed_html, embed_link, height, width,
                  fetched_at, raw_data)
               VALUES (gen_random_uuid()::text, $1, $2, $3, $4, $5, $6,
                       $7, $8, $9, $10, $11, $12, $13,
                       $14, $15, $16, $17, $18,
                       NOW(), $19::jsonb)
               ON CONFLICT (social_account_id, video_id) DO UPDATE SET
                 title             = EXCLUDED.title,
                 cover_url         = EXCLUDED.cover_url,
                 share_url         = EXCLUDED.share_url,
                 likes             = EXCLUDED.likes,
                 comments          = EXCLUDED.comments,
                 shares            = EXCLUDED.shares,
                 views             = EXCLUDED.views,
                 engagement        = EXCLUDED.engagement,
                 duration_seconds  = EXCLUDED.duration_seconds,
                 video_description = EXCLUDED.video_description,
                 embed_html        = EXCLUDED.embed_html,
                 embed_link        = EXCLUDED.embed_link,
                 height            = EXCLUDED.height,
                 width             = EXCLUDED.width,
                 fetched_at        = NOW(),
                 raw_data          = EXCLUDED.raw_data`,
              [
                auth.userId, acct.id, String(v.id),
                typeof v.title === 'string' ? v.title.slice(0, 500) : null,
                typeof v.cover_image_url === 'string' ? v.cover_image_url : null,
                typeof v.share_url === 'string' ? v.share_url : null,
                likes, comments, shares, views, engagement,
                Number(v.duration ?? 0),
                v.create_time ? new Date(v.create_time * 1000).toISOString() : null,
                typeof v.video_description === 'string' ? v.video_description.slice(0, 2000) : null,
                typeof v.embed_html === 'string' ? v.embed_html : null,
                typeof v.embed_link === 'string' ? v.embed_link : null,
                Number(v.height ?? 0),
                Number(v.width  ?? 0),
                JSON.stringify(v),
              ]
            );
            synced++;
          }

          // No more results or no cursor to continue
          if (!hasMore || cursor === undefined) break;
        }
      } catch (vidErr: any) {
        errors.push(`Video sync failed: ${vidErr.message}`);
      }
    }

    return res.json({ success: true, synced, errors: errors.length > 0 ? errors : undefined });
  } catch (err) {
    logger.error('TikTok sync error:', err);
    return res.status(500).json({ success: false, error: 'TikTok sync failed' });
  }
});

// GET /api/social/tiktok/videos — all synced video insights for the authenticated user
// No days filter — returns all videos ever synced, sorted by posted_at DESC.
// The `days` param (if provided) is used only to label the summary, not to filter.
router.get('/api/social/tiktok/videos', async (req: Request, res: Response) => {
  try {
    const auth = requireAuth(req, res);
    if (!auth) return;
    if (!pool) return res.status(503).json({ success: false, error: 'DB not ready' });

    const q = req.query as any;
    const days = Math.min(365, Math.max(1, parseInt(q.days || '30', 10)));
    const limit = Math.min(200, Math.max(1, parseInt(q.limit || '100', 10)));
    const offset = Math.max(0, parseInt(q.offset || '0', 10));
    const accountId = q.account_id ? String(q.account_id) : null;

    const params: any[] = [auth.userId];
    let accountFilter = '';
    if (accountId) {
      params.push(accountId);
      accountFilter = `AND tvi.social_account_id = $${params.length}`;
    }
    params.push(limit, offset);

    const videosRes = await pool.query(
      `SELECT tvi.*, sa.account_name, sa.handle
       FROM tiktok_video_insights tvi
       JOIN social_accounts sa ON sa.id = tvi.social_account_id
       WHERE tvi.user_id = $1
         ${accountFilter}
       ORDER BY COALESCE(tvi.posted_at, tvi.fetched_at) DESC
       LIMIT $${params.length - 1} OFFSET $${params.length}`,
      params
    );

    const countRes = await pool.query(
      `SELECT COUNT(*) FROM tiktok_video_insights tvi
       WHERE tvi.user_id = $1 ${accountFilter}`,
      params.slice(0, params.length - 2)
    );

    const summaryRes = await pool.query(
      `SELECT
         COUNT(*) AS total_videos,
         COALESCE(SUM(likes), 0) AS total_likes,
         COALESCE(SUM(comments), 0) AS total_comments,
         COALESCE(SUM(shares), 0) AS total_shares,
         COALESCE(SUM(views), 0) AS total_views,
         COALESCE(SUM(engagement), 0) AS total_engagement,
         CASE WHEN COALESCE(SUM(views), 0) > 0
              THEN ROUND((SUM(engagement)::numeric / NULLIF(SUM(views), 0)) * 100, 2)
              ELSE 0 END AS avg_engagement_rate
       FROM tiktok_video_insights tvi
       WHERE tvi.user_id = $1 ${accountFilter}`,
      params.slice(0, params.length - 2)
    );

    return res.json({
      success: true,
      videos: videosRes.rows,
      total: parseInt(countRes.rows[0]?.count || '0', 10),
      summary: summaryRes.rows[0] || {},
      days,
    });
  } catch (err) {
    logger.error('TikTok videos error:', err);
    return res.status(500).json({ success: false, error: 'Failed to fetch TikTok videos' });
  }
});

// GET /api/social/tiktok/followers — get full profile snapshot for authenticated user
router.get('/api/social/tiktok/followers', async (req: Request, res: Response) => {
  try {
    const auth = requireAuth(req, res);
    if (!auth) return;
    if (!pool) return res.json({ followers: null, hasData: false });

    // TikTok is connected via OAuth → stored in social_accounts.
    // The sync writes all profile stats to social_profile_stats.
    const { rows: accounts } = await pool.query(
      `SELECT
         sa.id, sa.account_name, sa.handle, sa.followers AS sa_followers,
         sps.followers, sps.following, sps.posts_count,
         sps.total_likes, sps.bio, sps.is_verified, sps.synced_at
       FROM social_accounts sa
       LEFT JOIN social_profile_stats sps ON sps.social_account_id = sa.id
       WHERE sa.user_id = $1
         AND sa.connected = true
         AND (sa.platform = 'tiktok' OR sa.platform ILIKE 'tiktok')
       ORDER BY sps.synced_at DESC NULLS LAST
       LIMIT 1`,
      [auth.userId]
    );

    if (!accounts.length) {
      return res.json({ followers: null, hasData: false });
    }

    const row = accounts[0];
    const followers = row.followers ?? row.sa_followers ?? null;
    const hasData = followers !== null || row.following !== null || row.posts_count !== null;

    return res.json({
      hasData,
      followers:    followers    !== null ? Number(followers)         : null,
      following:    row.following    !== null ? Number(row.following)    : null,
      posts_count:  row.posts_count  !== null ? Number(row.posts_count)  : null,
      total_likes:  row.total_likes  !== null ? Number(row.total_likes)  : null,
      bio:          row.bio          ?? null,
      is_verified:  row.is_verified  ?? null,
      display_name: row.account_name ?? null,
      handle:       row.handle       ?? null,
      synced_at:    row.synced_at    ?? null,
    });
  } catch (err) {
    logger.error('TikTok followers error:', err);
    return res.json({ followers: null, hasData: false });
  }
});

// ─── Facebook Pages Analytics routes ───────────────────────────────────────────

// POST /api/social/facebook/sync — manual sync of Facebook page data + posts
router.post('/api/social/facebook/sync', async (req: Request, res: Response) => {
  try {
    const auth = requireAuth(req, res);
    if (!auth) return;
    if (!pool) return res.status(503).json({ success: false, error: 'DB not ready' });

    const accountRes = await pool.query(
      `SELECT id, account_id, access_token, access_token_encrypted, refresh_token, refresh_token_encrypted, token_data
       FROM social_accounts WHERE user_id=$1 AND platform='facebook' AND connected=true`,
      [auth.userId]
    );
    if (accountRes.rows.length === 0) {
      return res.status(404).json({ success: false, error: 'No connected Facebook account found' });
    }

    let synced = 0;
    const errors: string[] = [];

    for (const acct of accountRes.rows as any[]) {
      let token = '';
      if (acct.access_token_encrypted) {
        try { token = decryptIntegrationSecret(String(acct.access_token_encrypted)); } catch (_err) { /* */ }
      }
      if (!token) token = String(acct.access_token || '').trim();
      if (!token) { errors.push('No access token available'); continue; }

      const pageId = String(acct.account_id);
      const GRAPH_BASE = 'https://graph.facebook.com/v19.0';

      // ── Page Profile Sync ─────────────────────────────────────────────────
      try {
        const pageResp = await axios.get(
          `${GRAPH_BASE}/${pageId}`,
          {
            params: {
              fields: 'id,name,followers_count,fan_count,picture.type(large),bio',
              access_token: token,
            },
            validateStatus: () => true,
            timeout: 15000,
          }
        );

        if (pageResp.status === 200 && pageResp.data?.id) {
          const p = pageResp.data;
          const followers = Number(p.followers_count ?? 0);
          const pageLikes = Number(p.fan_count ?? 0);
          const bio = typeof p.bio === 'string' ? p.bio : null;
          const pictureUrl = typeof p.picture?.data?.url === 'string' ? p.picture.data.url : null;

          await pool.query(
            `INSERT INTO facebook_page_stats
               (id, user_id, social_account_id, platform, followers, page_likes, bio, picture_url, raw_response, synced_at)
             VALUES (gen_random_uuid()::text, $1, $2, 'facebook', $3, $4, $5, $6, $7::jsonb, NOW())
             ON CONFLICT (social_account_id) DO UPDATE SET
               followers    = CASE WHEN EXCLUDED.followers > 0 THEN EXCLUDED.followers ELSE facebook_page_stats.followers END,
               page_likes   = CASE WHEN EXCLUDED.page_likes > 0 THEN EXCLUDED.page_likes ELSE facebook_page_stats.page_likes END,
               bio          = COALESCE(EXCLUDED.bio, facebook_page_stats.bio),
               picture_url  = COALESCE(EXCLUDED.picture_url, facebook_page_stats.picture_url),
               raw_response = EXCLUDED.raw_response,
               synced_at    = NOW()`,
            [auth.userId, acct.id, followers, pageLikes, bio, pictureUrl, JSON.stringify(p)]
          );

          // Update account name if not already set
          const displayName = typeof p.name === 'string' && p.name.trim() ? p.name.trim() : null;
          await pool.query(
            `UPDATE social_accounts SET
               account_name = COALESCE($1, account_name),
               followers    = CASE WHEN $2 > 0 THEN $2 ELSE followers END
             WHERE id = $3`,
            [displayName, followers, acct.id]
          );
          synced++;
        }
      } catch (profileErr: any) {
        errors.push(`Profile sync failed: ${profileErr.message}`);
      }

      // ── Page Posts Sync ──────────────────────────────────────────────────────
      // Use cursor-based pagination to fetch all posts
      try {
        const POST_FIELDS = 'id,message,picture,story,type,created_time,shares.summary(total_count).as(shares_summary),likes.summary(total_count).as(likes_summary),comments.summary(total_count).as(comments_summary),permalink_url';
        let cursor: string | null | undefined;
        let hasMore = true;
        let pageCount = 0;
        const MAX_PAGES = 10; // safety cap — 10 pages × 100 = 1000 posts

        while (hasMore && pageCount < MAX_PAGES) {
          const params: Record<string, any> = {
            fields: POST_FIELDS,
            limit: 100,
            access_token: token,
          };
          if (cursor) params.after = cursor;

          const postsResp = await axios.get(
            `${GRAPH_BASE}/${pageId}/posts`,
            {
              params,
              validateStatus: () => true,
              timeout: 15000,
            }
          );

          if (postsResp.status !== 200) {
            if (pageCount === 0) {
              logger.info(`Facebook posts endpoint error (${postsResp.status}) — skipping posts sync`);
            }
            break;
          }

          const pageData = postsResp.data?.data || [];
          const paging = postsResp.data?.paging || {};
          hasMore = !!paging.cursors?.after;
          cursor = paging.cursors?.after;
          pageCount++;

          for (const post of pageData) {
            if (!post.id) continue;

            const likes = Number(post.likes_summary?.summary?.total_count ?? 0);
            const comments = Number(post.comments_summary?.summary?.total_count ?? 0);
            const shares = Number(post.shares_summary?.summary?.total_count ?? 0);
            const engagement = likes + comments + shares;
            const createdAt = post.created_time ? new Date(post.created_time).toISOString() : null;

            await pool!.query(
              `INSERT INTO facebook_post_insights
                 (id, user_id, social_account_id, post_id, message, picture, story, type,
                  permalink_url, shares, likes_count, comments_count, engagement, created_at,
                  fetched_at, raw_data)
               VALUES (gen_random_uuid()::text, $1, $2, $3, $4, $5, $6, $7,
                       $8, $9, $10, $11, $12, $13,
                       NOW(), $14::jsonb)
               ON CONFLICT (social_account_id, post_id) DO UPDATE SET
                 message       = EXCLUDED.message,
                 picture       = EXCLUDED.picture,
                 story         = EXCLUDED.story,
                 type          = EXCLUDED.type,
                 permalink_url = EXCLUDED.permalink_url,
                 shares        = EXCLUDED.shares,
                 likes_count   = EXCLUDED.likes_count,
                 comments_count= EXCLUDED.comments_count,
                 engagement    = EXCLUDED.engagement,
                 fetched_at    = NOW(),
                 raw_data      = EXCLUDED.raw_data`,
              [
                auth.userId, acct.id, String(post.id),
                typeof post.message === 'string' ? post.message.slice(0, 5000) : null,
                typeof post.picture === 'string' ? post.picture : null,
                typeof post.story === 'string' ? post.story : null,
                typeof post.type === 'string' ? post.type : null,
                typeof post.permalink_url === 'string' ? post.permalink_url : null,
                shares, likes, comments, engagement,
                createdAt,
                JSON.stringify(post),
              ]
            );
            synced++;
          }

          // No more pages
          if (!hasMore) break;
        }
      } catch (postsErr: any) {
        errors.push(`Posts sync failed: ${postsErr.message}`);
      }
    }

    return res.json({ success: true, synced, errors: errors.length > 0 ? errors : undefined });
  } catch (err) {
    logger.error('Facebook sync error:', err);
    return res.status(500).json({ success: false, error: 'Facebook sync failed' });
  }
});

// GET /api/social/facebook/posts — all synced post insights for the authenticated user
router.get('/api/social/facebook/posts', async (req: Request, res: Response) => {
  try {
    const auth = requireAuth(req, res);
    if (!auth) return;
    if (!pool) return res.status(503).json({ success: false, error: 'DB not ready' });

    const q = req.query as any;
    const days = Math.min(365, Math.max(1, parseInt(q.days || '30', 10)));
    const limit = Math.min(200, Math.max(1, parseInt(q.limit || '100', 10)));
    const offset = Math.max(0, parseInt(q.offset || '0', 10));
    const accountId = q.account_id ? String(q.account_id) : null;

    const params: any[] = [auth.userId];
    let accountFilter = '';
    if (accountId) {
      params.push(accountId);
      accountFilter = `AND fpi.social_account_id = $${params.length}`;
    }
    params.push(limit, offset);

    const postsRes = await pool.query(
      `SELECT fpi.*, sa.account_name
       FROM facebook_post_insights fpi
       JOIN social_accounts sa ON sa.id = fpi.social_account_id
       WHERE fpi.user_id = $1
         ${accountFilter}
       ORDER BY COALESCE(fpi.created_at, fpi.fetched_at) DESC
       LIMIT $${params.length - 1} OFFSET $${params.length}`,
      params
    );

    const countRes = await pool.query(
      `SELECT COUNT(*) FROM facebook_post_insights fpi
       WHERE fpi.user_id = $1 ${accountFilter}`,
      params.slice(0, params.length - 2)
    );

    const summaryRes = await pool.query(
      `SELECT
         COUNT(*) AS total_posts,
         COALESCE(SUM(likes_count), 0) AS total_likes,
         COALESCE(SUM(comments_count), 0) AS total_comments,
         COALESCE(SUM(shares), 0) AS total_shares,
         COALESCE(SUM(engagement), 0) AS total_engagement,
         CASE WHEN COUNT(*) > 0
              THEN ROUND((SUM(engagement)::numeric / NULLIF(COUNT(*), 0)), 2)
              ELSE 0 END AS avg_engagement_per_post
       FROM facebook_post_insights fpi
       WHERE fpi.user_id = $1 ${accountFilter}`,
      params.slice(0, params.length - 2)
    );

    return res.json({
      success: true,
      posts: postsRes.rows,
      total: parseInt(countRes.rows[0]?.count || '0', 10),
      summary: summaryRes.rows[0] || {},
      days,
    });
  } catch (err) {
    logger.error('Facebook posts error:', err);
    return res.status(500).json({ success: false, error: 'Failed to fetch Facebook posts' });
  }
});

// GET /api/social/facebook/stats — get full page snapshot for authenticated user
router.get('/api/social/facebook/stats', async (req: Request, res: Response) => {
  try {
    const auth = requireAuth(req, res);
    if (!auth) return;
    if (!pool) return res.json({ stats: null, hasData: false });

    const { rows: pages } = await pool.query(
      `SELECT
         sa.id, sa.account_name, sa.handle, sa.followers AS sa_followers,
         fps.followers, fps.page_likes, fps.posts_count,
         fps.engagement_rate, fps.bio, fps.picture_url, fps.synced_at
       FROM social_accounts sa
       LEFT JOIN facebook_page_stats fps ON fps.social_account_id = sa.id
       WHERE sa.user_id = $1
         AND sa.connected = true
         AND (sa.platform = 'facebook' OR sa.platform ILIKE 'facebook')
       ORDER BY fps.synced_at DESC NULLS LAST
       LIMIT 1`,
      [auth.userId]
    );

    if (!pages.length) {
      return res.json({ stats: null, hasData: false });
    }

    const row = pages[0];
    const followers = row.followers ?? row.sa_followers ?? null;
    const hasData = followers !== null || row.page_likes !== null;

    return res.json({
      hasData,
      followers:      followers      !== null ? Number(followers)       : null,
      page_likes:     row.page_likes  !== null ? Number(row.page_likes)  : null,
      posts_count:    row.posts_count !== null ? Number(row.posts_count) : null,
      engagement_rate:row.engagement_rate !== null ? Number(row.engagement_rate) : null,
      bio:            row.bio          ?? null,
      picture_url:    row.picture_url  ?? null,
      account_name:   row.account_name ?? null,
      synced_at:      row.synced_at    ?? null,
    });
  } catch (err) {
    logger.error('Facebook stats error:', err);
    return res.json({ stats: null, hasData: false });
  }
});

// GET /api/social/facebook/accounts — list all connected Facebook pages and groups
router.get('/api/social/facebook/accounts', async (req: Request, res: Response) => {
  try {
    const auth = requireAuth(req, res);
    if (!auth) return;
    if (!pool) return res.status(503).json({ success: false, error: 'DB not ready' });

    const { rows: accounts } = await pool.query(
      `SELECT 
         sa.id, sa.account_id, sa.account_name, sa.account_type,
         sa.followers, sa.profile_image, sa.handle,
         fps.followers as page_followers, fps.page_likes
       FROM social_accounts sa
       LEFT JOIN facebook_page_stats fps ON fps.social_account_id = sa.id
       WHERE sa.user_id = $1
         AND sa.platform = 'facebook'
         AND sa.connected = true
       ORDER BY sa.account_type DESC, sa.account_name ASC`,
      [auth.userId]
    );

    const pages = accounts.filter((a: any) => a.account_type === 'page');
    const groups = accounts.filter((a: any) => a.account_type === 'group');

    return res.json({
      success: true,
      pages: pages.map((p: any) => ({
        id: p.id,
        account_id: p.account_id,
        name: p.account_name,
        type: p.account_type,
        followers: p.page_followers || p.followers || 0,
        likes: p.page_likes || 0,
        picture_url: p.profile_image,
      })),
      groups: groups.map((g: any) => ({
        id: g.id,
        account_id: g.account_id,
        name: g.account_name,
        type: g.account_type,
        members: g.followers || 0,
        picture_url: g.profile_image,
      })),
      total_pages: pages.length,
      total_groups: groups.length,
    });
  } catch (err) {
    logger.error('Facebook accounts error:', err);
    return res.status(500).json({ success: false, error: 'Failed to fetch Facebook accounts' });
  }
});

// ─── Instagram Analytics Endpoints ────────────────────────────────────────────

// POST /api/social/instagram/sync — sync Instagram profile, insights, and media
router.post('/api/social/instagram/sync', async (req: Request, res: Response) => {
  try {
    const auth = requireAuth(req, res);
    if (!auth) return;
    if (!pool) return res.status(503).json({ success: false, error: 'DB not ready' });

    const accountRes = await pool.query(
      `SELECT id, account_id, account_name, handle, followers, profile_image, access_token, access_token_encrypted, token_data
       FROM social_accounts
       WHERE user_id=$1 AND platform='instagram' AND connected=true`,
      [auth.userId]
    );
    if (accountRes.rows.length === 0) {
      return res.status(404).json({ success: false, error: 'No connected Instagram account found' });
    }

    let synced = 0;
    const errors: string[] = [];

    for (const acct of accountRes.rows as any[]) {
      const result = await syncInstagramAnalyticsAccount({
        userId: auth.userId,
        account: acct,
        days: 30,
      });
      synced += result.synced;
      errors.push(...result.errors);
    }

    return res.json({ success: true, synced, errors: errors.length > 0 ? errors : undefined });
  } catch (err) {
    logger.error('Instagram sync error:', err);
    return res.status(500).json({ success: false, error: 'Instagram sync failed' });
  }
});

// GET /api/social/instagram/profile — get Instagram profile snapshot for authenticated user
router.get('/api/social/instagram/profile', async (req: Request, res: Response) => {
  try {
    const auth = requireAuth(req, res);
    if (!auth) return;
    if (!pool) return res.json({ profile: null, hasData: false });

    const { rows } = await pool.query(
      `SELECT
         sa.id,
         sa.account_name,
         sa.handle,
         sa.followers AS sa_followers,
         sa.profile_image,
         sa.token_data,
         sps.followers,
         sps.following,
         sps.posts_count,
         sps.bio,
         sps.is_verified,
         sps.synced_at
       FROM social_accounts sa
       LEFT JOIN social_profile_stats sps ON sps.social_account_id = sa.id
       WHERE sa.user_id = $1
         AND sa.platform = 'instagram'
         AND sa.connected = true
       ORDER BY sps.synced_at DESC NULLS LAST, sa.connected_at DESC NULLS LAST
       LIMIT 1`,
      [auth.userId]
    );

    if (!rows.length) {
      return res.json({ profile: null, hasData: false });
    }

    const row: any = rows[0];
    const tokenData = row.token_data || {};
    const followers = row.followers ?? row.sa_followers ?? null;
    const hasData = followers !== null || row.posts_count !== null || Boolean(row.account_name);

    return res.json({
      hasData,
      followers: followers !== null ? Number(followers) : null,
      following: row.following !== null ? Number(row.following) : null,
      posts_count: row.posts_count !== null ? Number(row.posts_count) : null,
      bio: row.bio ?? null,
      is_verified: row.is_verified === true,
      account_name: row.account_name ?? tokenData?.instagramName ?? null,
      handle: row.handle ?? tokenData?.instagramUsername ?? null,
      picture_url: row.profile_image ?? tokenData?.profilePictureUrl ?? null,
      account_type: tokenData?.accountType ?? null,
      page_name: tokenData?.pageName ?? null,
      page_id: tokenData?.pageId ?? null,
      website: tokenData?.website ?? null,
      synced_at: row.synced_at ?? null,
    });
  } catch (err) {
    logger.error('Instagram profile error:', err);
    return res.json({ profile: null, hasData: false });
  }
});

// GET /api/social/instagram/posts — all synced Instagram media for the authenticated user
router.get('/api/social/instagram/posts', async (req: Request, res: Response) => {
  try {
    const auth = requireAuth(req, res);
    if (!auth) return;
    if (!pool) return res.status(503).json({ success: false, error: 'DB not ready' });

    const q = req.query as any;
    const days = Math.min(365, Math.max(1, parseInt(q.days || '30', 10)));
    const limit = Math.min(200, Math.max(1, parseInt(q.limit || '100', 10)));
    const offset = Math.max(0, parseInt(q.offset || '0', 10));
    const accountId = q.account_id ? String(q.account_id).trim() : '';
    const sinceDate = new Date(Date.now() - days * 24 * 60 * 60 * 1000);

    const params: any[] = [auth.userId, sinceDate];
    let accountFilter = '';
    if (accountId) {
      params.push(accountId);
      accountFilter = `AND sm.social_account_id = $${params.length}`;
    }
    params.push(limit, offset);

    const postsRes = await pool.query(
      `SELECT sm.*, sa.account_name, sa.handle
       FROM social_metrics sm
       JOIN social_accounts sa ON sa.id = sm.social_account_id
       WHERE sm.user_id = $1
         AND sm.platform = 'instagram'
         AND (sm.posted_at IS NULL OR sm.posted_at >= $2)
         ${accountFilter}
       ORDER BY COALESCE(sm.posted_at, sm.fetched_at) DESC
       LIMIT $${params.length - 1} OFFSET $${params.length}`,
      params
    );

    const countRes = await pool.query(
      `SELECT COUNT(*)
       FROM social_metrics sm
       WHERE sm.user_id = $1
         AND sm.platform = 'instagram'
         AND (sm.posted_at IS NULL OR sm.posted_at >= $2)
         ${accountFilter}`,
      params.slice(0, params.length - 2)
    );

    const summaryRes = await pool.query(
      `SELECT
         COUNT(*) AS total_posts,
         COALESCE(SUM(likes), 0) AS total_likes,
         COALESCE(SUM(comments), 0) AS total_comments,
         COALESCE(SUM(shares), 0) AS total_shares,
         COALESCE(SUM(saves), 0) AS total_saves,
         COALESCE(SUM(impressions), 0) AS total_impressions,
         COALESCE(SUM(reach), 0) AS total_reach,
         COALESCE(SUM(engagement), 0) AS total_engagement,
         CASE WHEN COALESCE(SUM(impressions), 0) > 0
              THEN ROUND((SUM(engagement)::numeric / NULLIF(SUM(impressions), 0)) * 100, 2)
              ELSE 0 END AS avg_engagement_rate
       FROM social_metrics sm
       WHERE sm.user_id = $1
         AND sm.platform = 'instagram'
         AND (sm.posted_at IS NULL OR sm.posted_at >= $2)
         ${accountFilter}`,
      params.slice(0, params.length - 2)
    );

    const posts = postsRes.rows.map((row: any) => {
      const raw = row.raw_data || {};
      const media = raw?.media || {};
      const account = raw?.account || {};
      return {
        ...row,
        media_id: row.platform_post_id,
        caption: media?.caption || null,
        media_type: media?.media_type || null,
        media_product_type: media?.media_product_type || null,
        media_url: media?.media_url || null,
        thumbnail_url: media?.thumbnail_url || null,
        permalink: media?.permalink || null,
        instagram_username: account?.instagramUsername || row.handle || null,
      };
    });

    return res.json({
      success: true,
      posts,
      total: parseInt(countRes.rows[0]?.count || '0', 10),
      summary: summaryRes.rows[0] || {
        total_posts: 0,
        total_likes: 0,
        total_comments: 0,
        total_shares: 0,
        total_saves: 0,
        total_impressions: 0,
        total_reach: 0,
        total_engagement: 0,
        avg_engagement_rate: 0,
      },
      days,
    });
  } catch (err) {
    logger.error('Instagram posts error:', err);
    return res.status(500).json({ success: false, error: 'Failed to fetch Instagram posts' });
  }
});

// ─── Pinterest Analytics Endpoints ───────────────────────────────────────────

// POST /api/social/pinterest/sync — sync Pinterest profile and pins (with metrics)
router.post('/api/social/pinterest/sync', async (req: Request, res: Response) => {
  try {
    const auth = requireAuth(req, res);
    if (!auth) return;
    if (!pool) return res.status(503).json({ success: false, error: 'DB not ready' });

    const accountRes = await pool.query(
      `SELECT id, account_id, account_name, handle, followers, profile_image, access_token, access_token_encrypted, token_data
       FROM social_accounts
       WHERE user_id=$1 AND platform='pinterest' AND connected=true AND account_type='profile'
       ORDER BY connected_at DESC NULLS LAST, created_at DESC NULLS LAST
       LIMIT 1`,
      [auth.userId]
    );

    if (accountRes.rows.length === 0) {
      return res.status(404).json({ success: false, error: 'No connected Pinterest account found' });
    }

    const result = await syncPinterestAnalyticsAccount({
      userId: auth.userId,
      account: accountRes.rows[0],
      days: 30,
      maxPins: 250,
    });

    return res.json({
      success: true,
      synced: result.synced,
      errors: result.errors.length > 0 ? result.errors : undefined,
    });
  } catch (err) {
    logger.error('Pinterest sync error:', err);
    return res.status(500).json({ success: false, error: 'Pinterest sync failed' });
  }
});

// GET /api/social/pinterest/profile — get Pinterest profile snapshot for authenticated user
router.get('/api/social/pinterest/profile', async (req: Request, res: Response) => {
  try {
    const auth = requireAuth(req, res);
    if (!auth) return;
    if (!pool) {
      return res.json({
        hasData: false,
        followers: null,
        following: null,
        posts_count: null,
        bio: null,
        account_name: null,
        handle: null,
        picture_url: null,
        website: null,
        monthly_views: null,
        synced_at: null,
      });
    }

    const { rows } = await pool.query(
      `SELECT
         sa.id,
         sa.account_id,
         sa.account_name,
         sa.handle,
         sa.followers AS sa_followers,
         sa.profile_image,
         sps.followers,
         sps.following,
         sps.posts_count,
         sps.bio,
         sps.raw_response,
         sps.synced_at
       FROM social_accounts sa
       LEFT JOIN social_profile_stats sps ON sps.social_account_id = sa.id
       WHERE sa.user_id = $1
         AND sa.platform = 'pinterest'
         AND sa.account_type = 'profile'
         AND sa.connected = true
       ORDER BY sps.synced_at DESC NULLS LAST, sa.connected_at DESC NULLS LAST
       LIMIT 1`,
      [auth.userId]
    );

    if (!rows.length) {
      return res.json({
        hasData: false,
        followers: null,
        following: null,
        posts_count: null,
        bio: null,
        account_name: null,
        handle: null,
        picture_url: null,
        website: null,
        monthly_views: null,
        synced_at: null,
      });
    }

    const row: any = rows[0];
    const raw = row.raw_response || {};

    const followers = row.followers ?? row.sa_followers ?? null;
    const hasData = followers !== null || row.posts_count !== null || Boolean(row.account_name) || Boolean(row.handle);

    return res.json({
      hasData,
      followers: followers !== null ? Number(followers) : null,
      following: row.following !== null ? Number(row.following) : null,
      posts_count: row.posts_count !== null ? Number(row.posts_count) : raw?.pin_count != null ? Number(raw.pin_count) : null,
      bio: row.bio ?? null,
      account_name: row.account_name ?? raw?.business_name ?? raw?.username ?? null,
      handle: row.handle ?? raw?.username ?? null,
      picture_url: row.profile_image ?? raw?.profile_image ?? null,
      website: raw?.website_url ?? null,
      monthly_views: raw?.monthly_views != null ? Number(raw.monthly_views) : null,
      synced_at: row.synced_at ?? null,
    });
  } catch (err) {
    logger.error('Pinterest profile error:', err);
    return res.json({
      hasData: false,
      followers: null,
      following: null,
      posts_count: null,
      bio: null,
      account_name: null,
      handle: null,
      picture_url: null,
      website: null,
      monthly_views: null,
      synced_at: null,
    });
  }
});

// GET /api/social/pinterest/pins — all synced Pinterest pins for the authenticated user
router.get('/api/social/pinterest/pins', async (req: Request, res: Response) => {
  try {
    const auth = requireAuth(req, res);
    if (!auth) return;
    if (!pool) return res.status(503).json({ success: false, error: 'DB not ready' });

    const q = req.query as any;
    const days = Math.min(365, Math.max(1, parseInt(q.days || '90', 10)));
    const limit = Math.min(200, Math.max(1, parseInt(q.limit || '100', 10)));
    const offset = Math.max(0, parseInt(q.offset || '0', 10));
    const accountId = q.account_id ? String(q.account_id).trim() : '';
    const boardId = q.board_id ? String(q.board_id).trim() : '';
    const sinceDate = new Date(Date.now() - days * 24 * 60 * 60 * 1000);

    const params: any[] = [auth.userId, sinceDate];
    let extraFilter = '';
    if (accountId) {
      params.push(accountId);
      extraFilter += `AND sm.social_account_id = $${params.length}\n`;
    }
    if (boardId) {
      params.push(boardId);
      extraFilter += `AND (sm.raw_data->'pin'->>'board_id') = $${params.length}\n`;
    }
    const baseParams = params.slice();
    params.push(limit, offset);

    const pinsRes = await pool.query(
      `SELECT sm.*, sa.account_name, sa.handle
       FROM social_metrics sm
       JOIN social_accounts sa ON sa.id = sm.social_account_id
       WHERE sm.user_id = $1
         AND sm.platform = 'pinterest'
         AND (sm.posted_at IS NULL OR sm.posted_at >= $2)
         ${extraFilter}
       ORDER BY COALESCE(sm.posted_at, sm.fetched_at) DESC
       LIMIT $${params.length - 1} OFFSET $${params.length}`,
      params
    );

    const countRes = await pool.query(
      `SELECT COUNT(*)
       FROM social_metrics sm
       WHERE sm.user_id = $1
         AND sm.platform = 'pinterest'
         AND (sm.posted_at IS NULL OR sm.posted_at >= $2)
         ${extraFilter}`,
      baseParams
    );

    const summaryRes = await pool.query(
      `SELECT
         COUNT(*) AS total_pins,
         COALESCE(SUM(impressions), 0) AS total_impressions,
         COALESCE(SUM(clicks), 0) AS total_outbound_clicks,
         COALESCE(SUM(saves), 0) AS total_saves,
         COALESCE(SUM(likes), 0) AS total_reactions,
         COALESCE(SUM(comments), 0) AS total_comments,
         COALESCE(SUM(engagement), 0) AS total_engagement,
         COALESCE(SUM(
           CASE
             WHEN (raw_data->'metrics'->>'pin_click') ~ '^\\d+(\\.\\d+)?$'
             THEN (raw_data->'metrics'->>'pin_click')::numeric
             ELSE 0
           END
         ), 0) AS total_pin_clicks,
         CASE WHEN COALESCE(SUM(impressions), 0) > 0
              THEN ROUND((SUM(engagement)::numeric / NULLIF(SUM(impressions), 0)) * 100, 2)
              ELSE 0 END AS avg_engagement_rate
       FROM social_metrics sm
       WHERE sm.user_id = $1
         AND sm.platform = 'pinterest'
         AND (sm.posted_at IS NULL OR sm.posted_at >= $2)
         ${extraFilter}`,
      baseParams
    );

    const pins = pinsRes.rows.map((row: any) => {
      const raw = row.raw_data || {};
      const pin = raw?.pin || {};
      const metrics = raw?.metrics || {};
      const media = pin?.media || {};
      const images = media?.images || {};

      const imageUrl =
        images?.['400x300']?.url ||
        images?.['150x150']?.url ||
        images?.['600x']?.url ||
        null;

      return {
        ...row,
        pin_id: row.platform_post_id,
        title: pin?.title ?? null,
        description: pin?.description ?? null,
        link: pin?.link ?? null,
        board_id: pin?.board_id ?? null,
        creative_type: pin?.creative_type ?? null,
        media_url: imageUrl,
        pin_clicks: metrics?.pin_click ?? null,
        outbound_clicks: metrics?.outbound_clicks ?? row.clicks ?? null,
        saves_count: metrics?.saves ?? row.saves ?? null,
        created_at: row.posted_at ?? pin?.created_at ?? null,
      };
    });

    return res.json({
      success: true,
      pins,
      total: parseInt(countRes.rows[0]?.count || '0', 10),
      summary: summaryRes.rows[0] || {
        total_pins: 0,
        total_impressions: 0,
        total_outbound_clicks: 0,
        total_saves: 0,
        total_reactions: 0,
        total_comments: 0,
        total_engagement: 0,
        total_pin_clicks: 0,
        avg_engagement_rate: 0,
      },
      days,
    });
  } catch (err) {
    logger.error('Pinterest pins error:', err);
    return res.status(500).json({ success: false, error: 'Failed to fetch Pinterest pins' });
  }
});

// GET /api/social/pinterest/boards-performance — aggregated board performance from synced pins
router.get('/api/social/pinterest/boards-performance', async (req: Request, res: Response) => {
  try {
    const auth = requireAuth(req, res);
    if (!auth) return;
    if (!pool) return res.status(503).json({ success: false, error: 'DB not ready' });

    const q = req.query as any;
    const days = Math.min(365, Math.max(1, parseInt(q.days || '90', 10)));
    const sinceDate = new Date(Date.now() - days * 24 * 60 * 60 * 1000);

    const { rows } = await pool.query(
      `SELECT
         COALESCE(sm.raw_data->'pin'->>'board_id', '') AS board_id,
         MAX(sa_board.account_name) AS board_name,
         COUNT(*)::int AS total_pins,
         COALESCE(SUM(sm.impressions), 0) AS total_impressions,
         COALESCE(SUM(sm.clicks), 0) AS total_outbound_clicks,
         COALESCE(SUM(sm.saves), 0) AS total_saves,
         COALESCE(SUM(sm.likes), 0) AS total_reactions,
         COALESCE(SUM(sm.comments), 0) AS total_comments,
         COALESCE(SUM(sm.engagement), 0) AS total_engagement,
         MAX(COALESCE(sm.posted_at, sm.fetched_at)) AS last_activity,
         CASE WHEN COALESCE(SUM(sm.impressions), 0) > 0
              THEN ROUND((SUM(sm.engagement)::numeric / NULLIF(SUM(sm.impressions), 0)) * 100, 2)
              ELSE 0 END AS engagement_rate
       FROM social_metrics sm
       LEFT JOIN social_accounts sa_board
         ON sa_board.user_id = sm.user_id
        AND sa_board.platform = 'pinterest'
        AND sa_board.account_type = 'board'
        AND sa_board.account_id = (sm.raw_data->'pin'->>'board_id')
       WHERE sm.user_id = $1
         AND sm.platform = 'pinterest'
         AND (sm.posted_at IS NULL OR sm.posted_at >= $2)
         AND COALESCE(sm.raw_data->'pin'->>'board_id', '') <> ''
       GROUP BY board_id
       ORDER BY COALESCE(SUM(sm.impressions), 0) DESC, COALESCE(SUM(sm.engagement), 0) DESC, COUNT(*) DESC
       LIMIT 200`,
      [auth.userId, sinceDate]
    );

    const boards = rows.map((row: any) => ({
      board_id: String(row.board_id || '').trim(),
      board_name: row.board_name ? String(row.board_name) : null,
      total_pins: Number(row.total_pins || 0),
      total_impressions: Number(row.total_impressions || 0),
      total_outbound_clicks: Number(row.total_outbound_clicks || 0),
      total_saves: Number(row.total_saves || 0),
      total_reactions: Number(row.total_reactions || 0),
      total_comments: Number(row.total_comments || 0),
      total_engagement: Number(row.total_engagement || 0),
      engagement_rate: Number(row.engagement_rate || 0),
      last_activity: row.last_activity ? new Date(row.last_activity).toISOString() : null,
    })).filter((b: any) => b.board_id);

    return res.json({ success: true, boards, days });
  } catch (err) {
    logger.error('Pinterest boards performance error:', err);
    return res.status(500).json({ success: false, error: 'Failed to fetch Pinterest board performance' });
  }
});

// ─── Threads Analytics Endpoints ───────────────────────────────────────────

// POST /api/social/threads/sync — sync Threads profile + post insights
router.post('/api/social/threads/sync', async (req: Request, res: Response) => {
  try {
    const auth = requireAuth(req, res);
    if (!auth) return;
    if (!pool) return res.status(503).json({ success: false, error: 'DB not ready' });

    const accountRes = await pool.query(
      `SELECT id, account_id, account_name, handle, followers, profile_image, access_token, access_token_encrypted, token_data
       FROM social_accounts
       WHERE user_id=$1 AND platform='threads' AND connected=true AND account_type='profile'
       ORDER BY connected_at DESC NULLS LAST, created_at DESC NULLS LAST
       LIMIT 1`,
      [auth.userId]
    );

    if (accountRes.rows.length === 0) {
      return res.status(404).json({ success: false, error: 'No connected Threads account found' });
    }

    const tokenConn = await getPublishableSocialConnection(auth.userId, 'threads');
    if (!tokenConn || tokenConn.needs_reapproval || !tokenConn.access_token) {
      return res.status(400).json({ success: false, error: 'Threads access token missing or expired — reconnect Threads.' });
    }

    const result = await syncThreadsAnalyticsAccount({
      userId: auth.userId,
      account: { ...accountRes.rows[0], access_token: tokenConn.access_token, access_token_encrypted: null },
      days: 30,
      maxPosts: 120,
    });

    return res.json({
      success: true,
      synced: result.synced,
      errors: result.errors.length > 0 ? result.errors : undefined,
    });
  } catch (err) {
    logger.error('Threads sync error:', err);
    return res.status(500).json({ success: false, error: 'Threads sync failed' });
  }
});

// GET /api/social/threads/profile — get Threads profile snapshot for authenticated user
router.get('/api/social/threads/profile', async (req: Request, res: Response) => {
  try {
    const auth = requireAuth(req, res);
    if (!auth) return;
    if (!pool) {
      return res.json({
        hasData: false,
        followers: null,
        posts_count: null,
        total_likes: null,
        total_views: null,
        total_replies: null,
        total_reposts: null,
        total_quotes: null,
        total_clicks: null,
        follower_demographics: null,
        bio: null,
        is_verified: null,
        account_name: null,
        handle: null,
        picture_url: null,
        synced_at: null,
      });
    }

    const { rows } = await pool.query(
      `SELECT
         sa.id,
         sa.account_id,
         sa.account_name,
         sa.handle,
         sa.followers AS sa_followers,
         sa.profile_image,
         sa.token_data,
         sps.followers,
         sps.posts_count,
         sps.total_likes,
         sps.bio,
         sps.is_verified,
         sps.raw_response,
         sps.synced_at
       FROM social_accounts sa
       LEFT JOIN social_profile_stats sps ON sps.social_account_id = sa.id
       WHERE sa.user_id = $1
         AND sa.platform = 'threads'
         AND sa.account_type = 'profile'
         AND sa.connected = true
       ORDER BY sps.synced_at DESC NULLS LAST, sa.connected_at DESC NULLS LAST
       LIMIT 1`,
      [auth.userId]
    );

    if (!rows.length) {
      return res.json({
        hasData: false,
        followers: null,
        posts_count: null,
        total_likes: null,
        total_views: null,
        total_replies: null,
        total_reposts: null,
        total_quotes: null,
        total_clicks: null,
        follower_demographics: null,
        bio: null,
        is_verified: null,
        account_name: null,
        handle: null,
        picture_url: null,
        synced_at: null,
      });
    }

    const row: any = rows[0];
    const tokenData = row.token_data || {};
    const raw = row.raw_response || {};
    const rawProfile = raw?.profile || {};

    const followers = row.followers ?? row.sa_followers ?? null;
    const hasData =
      followers !== null ||
      row.posts_count !== null ||
      Boolean(row.account_name) ||
      Boolean(row.handle);

    const bio =
      row.bio ??
      (typeof rawProfile?.threads_biography === 'string' ? rawProfile.threads_biography : null) ??
      (typeof tokenData?.about === 'string' ? tokenData.about : null) ??
      null;

    const pictureUrl =
      row.profile_image ??
      (typeof rawProfile?.threads_profile_picture_url === 'string' ? rawProfile.threads_profile_picture_url : null) ??
      (typeof tokenData?.avatar_url === 'string' ? tokenData.avatar_url : null) ??
      null;

    const handle =
      row.handle ??
      (typeof rawProfile?.username === 'string' ? rawProfile.username : null) ??
      (typeof tokenData?.username === 'string' ? tokenData.username : null) ??
      null;

    const accountName =
      row.account_name ??
      (typeof rawProfile?.name === 'string' ? rawProfile.name : null) ??
      (typeof tokenData?.name === 'string' ? tokenData.name : null) ??
      null;

    const isVerified =
      row.is_verified === true ||
      rawProfile?.is_verified === true ||
      tokenData?.is_verified === true;

    const metricNumOrNull = (value: any): number | null => {
      if (value === null || value === undefined) return null;
      const n = typeof value === 'number' ? value : parseFloat(String(value));
      return Number.isFinite(n) ? n : null;
    };

    const accountMetrics = raw?.account_metrics || {};
    const followerDemographics = raw?.follower_demographics || null;

    return res.json({
      hasData,
      followers: followers !== null ? Number(followers) : null,
      posts_count: row.posts_count !== null ? Number(row.posts_count) : null,
      total_likes: row.total_likes !== null ? Number(row.total_likes) : null,
      total_views: metricNumOrNull(accountMetrics?.views),
      total_replies: metricNumOrNull(accountMetrics?.replies),
      total_reposts: metricNumOrNull(accountMetrics?.reposts),
      total_quotes: metricNumOrNull(accountMetrics?.quotes),
      total_clicks: metricNumOrNull(accountMetrics?.clicks),
      follower_demographics: followerDemographics,
      bio,
      is_verified: isVerified,
      account_name: accountName,
      handle,
      picture_url: pictureUrl,
      synced_at: row.synced_at ?? null,
    });
  } catch (err) {
    logger.error('Threads profile error:', err);
    return res.json({
      hasData: false,
      followers: null,
      posts_count: null,
      total_likes: null,
      total_views: null,
      total_replies: null,
      total_reposts: null,
      total_quotes: null,
      total_clicks: null,
      follower_demographics: null,
      bio: null,
      is_verified: null,
      account_name: null,
      handle: null,
      picture_url: null,
      synced_at: null,
    });
  }
});

// GET /api/social/threads/posts — all synced Threads posts for the authenticated user
router.get('/api/social/threads/posts', async (req: Request, res: Response) => {
  try {
    const auth = requireAuth(req, res);
    if (!auth) return;
    if (!pool) return res.status(503).json({ success: false, error: 'DB not ready' });

    const q = req.query as any;
    const days = Math.min(365, Math.max(1, parseInt(q.days || '30', 10)));
    const limit = Math.min(200, Math.max(1, parseInt(q.limit || '100', 10)));
    const offset = Math.max(0, parseInt(q.offset || '0', 10));
    const accountId = q.account_id ? String(q.account_id).trim() : '';
    const sinceDate = new Date(Date.now() - days * 24 * 60 * 60 * 1000);

    const params: any[] = [auth.userId, sinceDate];
    let accountFilter = '';
    if (accountId) {
      params.push(accountId);
      accountFilter = `AND sm.social_account_id = $${params.length}`;
    }
    params.push(limit, offset);

    const postsRes = await pool.query(
      `SELECT sm.*, sa.account_name, sa.handle
       FROM social_metrics sm
       JOIN social_accounts sa ON sa.id = sm.social_account_id
       WHERE sm.user_id = $1
         AND sm.platform = 'threads'
         AND (sm.posted_at IS NULL OR sm.posted_at >= $2)
         ${accountFilter}
       ORDER BY COALESCE(sm.posted_at, sm.fetched_at) DESC
       LIMIT $${params.length - 1} OFFSET $${params.length}`,
      params
    );

    const countRes = await pool.query(
      `SELECT COUNT(*)
       FROM social_metrics sm
       WHERE sm.user_id = $1
         AND sm.platform = 'threads'
         AND (sm.posted_at IS NULL OR sm.posted_at >= $2)
         ${accountFilter}`,
      params.slice(0, params.length - 2)
    );

    const summaryRes = await pool.query(
      `SELECT
         COUNT(*) AS total_posts,
         COALESCE(SUM(impressions), 0) AS total_views,
         COALESCE(SUM(likes), 0) AS total_likes,
         COALESCE(SUM(comments), 0) AS total_replies,
         COALESCE(SUM(shares), 0) AS total_shares,
         COALESCE(SUM(engagement), 0) AS total_engagement,
         COALESCE(SUM(COALESCE(NULLIF(sm.raw_data->'metrics'->>'reposts', '')::numeric, 0)), 0) AS total_reposts,
         COALESCE(SUM(COALESCE(NULLIF(sm.raw_data->'metrics'->>'quotes', '')::numeric, 0)), 0) AS total_quotes,
         CASE WHEN COALESCE(SUM(impressions), 0) > 0
              THEN ROUND((SUM(engagement)::numeric / NULLIF(SUM(impressions), 0)) * 100, 2)
              ELSE 0 END AS avg_engagement_rate
       FROM social_metrics sm
       WHERE sm.user_id = $1
         AND sm.platform = 'threads'
         AND (sm.posted_at IS NULL OR sm.posted_at >= $2)
         ${accountFilter}`,
      params.slice(0, params.length - 2)
    );

    const posts = postsRes.rows.map((row: any) => {
      const raw = row.raw_data || {};
      const post = raw?.post || {};
      const metrics = raw?.metrics || {};
      const metricNum = (value: any) => {
        const n = typeof value === 'number' ? value : parseFloat(String(value ?? '0'));
        return Number.isFinite(n) ? n : 0;
      };

      const mediaUrl = typeof post?.media_url === 'string' ? post.media_url : null;
      const gifUrl = typeof post?.gif_url === 'string' ? post.gif_url : null;
      return {
        ...row,
        thread_id: row.platform_post_id,
        text: typeof post?.text === 'string' ? post.text : null,
        permalink: typeof post?.permalink === 'string' ? post.permalink : null,
        username: typeof post?.username === 'string' ? post.username : (row.handle || null),
        media_product_type: typeof post?.media_product_type === 'string' ? post.media_product_type : null,
        media_type: typeof post?.media_type === 'string' ? post.media_type : null,
        media_url: mediaUrl || gifUrl,
        gif_url: gifUrl,
        thumbnail_url: typeof post?.thumbnail_url === 'string' ? post.thumbnail_url : null,
        alt_text: typeof post?.alt_text === 'string' ? post.alt_text : null,
        link_attachment_url: typeof post?.link_attachment_url === 'string' ? post.link_attachment_url : null,
        poll_attachment: post?.poll_attachment ?? null,
        location_id: post?.location_id !== undefined && post?.location_id !== null ? String(post.location_id) : null,
        topic_tag: typeof post?.topic_tag === 'string' ? post.topic_tag : null,
        is_quote_post: post?.is_quote_post === true,
        has_replies: post?.has_replies === true,
        views: row.impressions !== null && row.impressions !== undefined ? Number(row.impressions) : metricNum(metrics?.views),
        replies: row.comments !== null && row.comments !== undefined ? Number(row.comments) : metricNum(metrics?.replies),
        reposts: metricNum(metrics?.reposts),
        quotes: metricNum(metrics?.quotes),
      };
    });

    return res.json({
      success: true,
      posts,
      total: parseInt(countRes.rows[0]?.count || '0', 10),
      summary: summaryRes.rows[0] || {
        total_posts: 0,
        total_views: 0,
        total_likes: 0,
        total_replies: 0,
        total_shares: 0,
        total_engagement: 0,
        total_reposts: 0,
        total_quotes: 0,
        avg_engagement_rate: 0,
      },
      days,
    });
  } catch (err) {
    logger.error('Threads posts error:', err);
    return res.status(500).json({ success: false, error: 'Failed to fetch Threads posts' });
  }
});

// GET /api/social/threads/debug-token — inspect the current Threads access token (scopes/expiry)
router.get('/api/social/threads/debug-token', async (req: Request, res: Response) => {
  try {
    const auth = requireAuth(req, res);
    if (!auth) return;

    const conn = await getPublishableSocialConnection(auth.userId, 'threads');
    if (!conn || conn.needs_reapproval || !conn.access_token) {
      return res.status(400).json({ success: false, error: 'Threads access token missing or expired — reconnect Threads.' });
    }

    const cfg = await getPlatformConfig('threads');
    const appId = String(cfg.appId || process.env.VITE_THREADS_APP_ID || process.env.VITE_THREADS_CLIENT_ID || '').trim();
    const appSecret = String(cfg.appSecret || process.env.THREADS_APP_SECRET || process.env.VITE_THREADS_APP_SECRET || '').trim();
    const appToken = appId && appSecret ? `${appId}|${appSecret}` : '';
    if (!appToken) {
      return res.status(400).json({ success: false, error: 'Threads app credentials not configured by admin' });
    }

    const resp = await axios.get('https://graph.threads.net/debug_token', {
      params: {
        input_token: conn.access_token,
        access_token: appToken,
      },
      validateStatus: () => true,
      timeout: 15000,
    });

    const data: any = resp.data || {};
    if (resp.status >= 400) {
      const msg = data?.error?.message || `Threads debug_token failed (${resp.status})`;
      return res.status(400).json({ success: false, error: msg });
    }

    return res.json({ success: true, data });
  } catch (err) {
    logger.error('Threads debug-token error:', err);
    return res.status(500).json({ success: false, error: 'Failed to debug Threads token' });
  }
});

// GET /api/social/threads/replies?thread_id=... — list top-level replies for a thread
router.get('/api/social/threads/replies', async (req: Request, res: Response) => {
  try {
    const auth = requireAuth(req, res);
    if (!auth) return;

    const threadId = String((req.query as any).thread_id || '').trim();
    if (!threadId) return res.status(400).json({ success: false, error: 'thread_id is required' });

    const conn = await getPublishableSocialConnection(auth.userId, 'threads');
    if (!conn || conn.needs_reapproval || !conn.access_token) {
      return res.status(400).json({ success: false, error: 'Threads access token missing or expired — reconnect Threads.' });
    }

    const fields =
      String((req.query as any).fields || '').trim() ||
      'id,text,timestamp,media_product_type,media_type,media_url,gif_url,permalink,shortcode,thumbnail_url,username,children,is_quote_post,quoted_post,reposted_post,alt_text,link_attachment_url,has_replies,is_reply,is_reply_owned_by_me,root_post,replied_to,hide_status,reply_audience,location_id,topic_tag,is_verified,profile_picture_url,reply_approval_status';
    const limit = Math.min(100, Math.max(1, parseInt(String((req.query as any).limit || '50'), 10)));
    const after = String((req.query as any).after || '').trim();
    const reverseRaw = String((req.query as any).reverse || '').trim().toLowerCase();
    const reverse = reverseRaw === '1' || reverseRaw === 'true' || reverseRaw === 'yes';

    const threadsBase = 'https://graph.threads.net/v1.0';
    const resp = await axios.get(`${threadsBase}/${encodeURIComponent(threadId)}/replies`, {
      params: {
        fields,
        limit,
        reverse,
        ...(after ? { after } : {}),
        access_token: conn.access_token,
      },
      validateStatus: () => true,
      timeout: 20000,
    });

    const data: any = resp.data || {};
    if (resp.status >= 400) {
      const msg = data?.error?.message || `Threads replies fetch failed (${resp.status})`;
      return res.status(400).json({ success: false, error: msg });
    }

    return res.json({ success: true, data });
  } catch (err) {
    logger.error('Threads replies error:', err);
    return res.status(500).json({ success: false, error: 'Failed to fetch Threads replies' });
  }
});

// POST /api/social/threads/replies/hide — hide/unhide a reply (top-level)
router.post('/api/social/threads/replies/hide', async (req: Request, res: Response) => {
  try {
    const auth = requireAuth(req, res);
    if (!auth) return;

    const { replyId, hide } = req.body as { replyId?: string; hide?: boolean };
    const rid = String(replyId || '').trim();
    if (!rid) return res.status(400).json({ success: false, error: 'replyId is required' });

    const conn = await getPublishableSocialConnection(auth.userId, 'threads');
    if (!conn || conn.needs_reapproval || !conn.access_token) {
      return res.status(400).json({ success: false, error: 'Threads access token missing or expired — reconnect Threads.' });
    }

    const threadsBase = 'https://graph.threads.net/v1.0';
    const resp = await axios.post(
      `${threadsBase}/${encodeURIComponent(rid)}/manage_reply`,
      null,
      {
        params: {
          hide: hide === false ? 'false' : 'true',
          access_token: conn.access_token,
        },
        validateStatus: () => true,
        timeout: 15000,
      }
    );
    const data: any = resp.data || {};
    if (resp.status >= 400) {
      const msg = data?.error?.message || `Threads manage_reply failed (${resp.status})`;
      return res.status(400).json({ success: false, error: msg });
    }

    return res.json({ success: true, data });
  } catch (err) {
    logger.error('Threads manage-reply error:', err);
    return res.status(500).json({ success: false, error: 'Failed to manage Threads reply' });
  }
});

// POST /api/social/threads/replies/respond — create and publish a reply
router.post('/api/social/threads/replies/respond', async (req: Request, res: Response) => {
  try {
    const auth = requireAuth(req, res);
    if (!auth) return;

    const { replyToId, text } = req.body as { replyToId?: string; text?: string };
    const rid = String(replyToId || '').trim();
    const bodyText = String(text || '').trim();
    if (!rid || !bodyText) return res.status(400).json({ success: false, error: 'replyToId and text are required' });

    const conn = await getPublishableSocialConnection(auth.userId, 'threads');
    if (!conn || conn.needs_reapproval || !conn.access_token) {
      return res.status(400).json({ success: false, error: 'Threads access token missing or expired — reconnect Threads.' });
    }

    const threadsBase = 'https://graph.threads.net/v1.0';
    let threadsUserId = String(conn.token_data?.user_id || conn.token_data?.userId || conn.token_data?.id || '').trim();
    if (!threadsUserId) {
      const meResp = await axios.get(`${threadsBase}/me`, {
        params: { fields: 'id', access_token: conn.access_token },
        validateStatus: () => true,
        timeout: 15000,
      });
      const meData: any = meResp.data || {};
      if (meResp.status >= 400) {
        throw new Error(meData?.error?.message || `Threads profile lookup failed (${meResp.status})`);
      }
      threadsUserId = String(meData?.id || '').trim();
    }
    if (!threadsUserId) return res.status(400).json({ success: false, error: 'Threads user id not available' });

    const createParams = new URLSearchParams({
      media_type: 'TEXT',
      text: bodyText,
      reply_to_id: rid,
      access_token: conn.access_token,
    });
    const createResp = await axios.post(
      `${threadsBase}/${encodeURIComponent(threadsUserId)}/threads`,
      createParams.toString(),
      {
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        validateStatus: () => true,
        timeout: 15000,
      }
    );
    const createData: any = createResp.data || {};
    if (createResp.status >= 400) {
      const msg = createData?.error?.message || `Threads create reply error ${createResp.status}`;
      return res.status(400).json({ success: false, error: msg });
    }
    const creationId = String(createData?.id || '').trim();
    if (!creationId) return res.status(400).json({ success: false, error: 'Threads creation id missing' });

    const publishParams = new URLSearchParams({
      creation_id: creationId,
      access_token: conn.access_token,
    });
    const pubResp = await axios.post(
      `${threadsBase}/${encodeURIComponent(threadsUserId)}/threads_publish`,
      publishParams.toString(),
      {
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        validateStatus: () => true,
        timeout: 15000,
      }
    );
    const pubData: any = pubResp.data || {};
    if (pubResp.status >= 400) {
      const msg = pubData?.error?.message || `Threads publish reply error ${pubResp.status}`;
      return res.status(400).json({ success: false, error: msg });
    }

    const platformPostId = String(pubData?.id || '').trim();
    return res.json({ success: true, platformPostId });
  } catch (err) {
    logger.error('Threads reply publish error:', err);
    return res.status(500).json({ success: false, error: err instanceof Error ? err.message : 'Failed to publish Threads reply' });
  }
});

// GET /api/social/threads/locations/search?q=... — search for locations to tag
router.get('/api/social/threads/locations/search', async (req: Request, res: Response) => {
  try {
    const auth = requireAuth(req, res);
    if (!auth) return;

    const q = String((req.query as any).q || '').trim();
    if (!q) return res.status(400).json({ success: false, error: 'q is required' });

    const conn = await getPublishableSocialConnection(auth.userId, 'threads');
    if (!conn || conn.needs_reapproval || !conn.access_token) {
      return res.status(400).json({ success: false, error: 'Threads access token missing or expired — reconnect Threads.' });
    }

    const latitude = String((req.query as any).latitude || '').trim();
    const longitude = String((req.query as any).longitude || '').trim();
    const fields =
      String((req.query as any).fields || '').trim() ||
      'id,address,city,country,name,latitude,longitude,postal_code';

    const resp = await axios.get('https://graph.threads.net/location_search', {
      params: {
        q,
        ...(latitude ? { latitude } : {}),
        ...(longitude ? { longitude } : {}),
        fields,
        access_token: conn.access_token,
      },
      validateStatus: () => true,
      timeout: 15000,
    });

    const data: any = resp.data || {};
    if (resp.status >= 400) {
      const msg = data?.error?.message || `Threads location_search failed (${resp.status})`;
      return res.status(400).json({ success: false, error: msg });
    }

    return res.json({ success: true, data });
  } catch (err) {
    logger.error('Threads location search error:', err);
    return res.status(500).json({ success: false, error: 'Failed to search Threads locations' });
  }
});

// GET /api/social/threads/locations/:locationId — retrieve a location by id
router.get('/api/social/threads/locations/:locationId', async (req: Request, res: Response) => {
  try {
    const auth = requireAuth(req, res);
    if (!auth) return;

    const locationId = String(req.params.locationId || '').trim();
    if (!locationId) return res.status(400).json({ success: false, error: 'locationId is required' });

    const conn = await getPublishableSocialConnection(auth.userId, 'threads');
    if (!conn || conn.needs_reapproval || !conn.access_token) {
      return res.status(400).json({ success: false, error: 'Threads access token missing or expired — reconnect Threads.' });
    }

    const fields =
      String((req.query as any).fields || '').trim() ||
      'id,address,city,country,name,latitude,longitude,postal_code';

    const resp = await axios.get(`https://graph.threads.net/${encodeURIComponent(locationId)}`, {
      params: { fields, access_token: conn.access_token },
      validateStatus: () => true,
      timeout: 15000,
    });

    const data: any = resp.data || {};
    if (resp.status >= 400) {
      const msg = data?.error?.message || `Threads location lookup failed (${resp.status})`;
      return res.status(400).json({ success: false, error: msg });
    }

    return res.json({ success: true, data });
  } catch (err) {
    logger.error('Threads location lookup error:', err);
    return res.status(500).json({ success: false, error: 'Failed to fetch Threads location' });
  }
});

// ─── LinkedIn Analytics Endpoints ──────────────────────────────────────────────

// POST /api/social/linkedin/sync — sync LinkedIn profile and posts
router.post('/api/social/linkedin/sync', async (req: Request, res: Response) => {
  try {
    const auth = requireAuth(req, res);
    if (!auth) return;
    if (!pool) return res.status(503).json({ success: false, error: 'DB not ready' });

    const accountRes = await pool.query(
      `SELECT id, account_id, access_token, access_token_encrypted, refresh_token, refresh_token_encrypted, token_data
       FROM social_accounts WHERE user_id=$1 AND platform='linkedin' AND connected=true`,
      [auth.userId]
    );
    if (accountRes.rows.length === 0) {
      return res.status(404).json({ success: false, error: 'No connected LinkedIn account found' });
    }

    let synced = 0;
    const errors: string[] = [];

    for (const acct of accountRes.rows as any[]) {
      let token = '';
      if (acct.access_token_encrypted) {
        try { token = decryptIntegrationSecret(String(acct.access_token_encrypted)); } catch (_err) { /* */ }
      }
      if (!token) token = String(acct.access_token || '').trim();
      if (!token) { errors.push('No access token available'); continue; }

      const API_BASE = 'https://api.linkedin.com/v2';

      // ── Profile Sync ─────────────────────────────────────────────────────
      try {
        const profileResp = await axios.get(
          `${API_BASE}/me`,
          {
            headers: { Authorization: `Bearer ${token}` },
            validateStatus: () => true,
            timeout: 15000,
          }
        );

        if (profileResp.status === 200 && profileResp.data?.id) {
          const profile = profileResp.data;
          const firstName = profile.localizedFirstName || profile.firstName?.localized?.[Object.keys(profile.firstName?.localized || {})[0]] || '';
          const lastName = profile.localizedLastName || profile.lastName?.localized?.[Object.keys(profile.lastName?.localized || {})[0]] || '';

          await pool.query(
            `INSERT INTO linkedin_profile_stats
               (id, user_id, social_account_id, platform, first_name, last_name, headline, profile_picture_url, raw_response, synced_at)
             VALUES (gen_random_uuid()::text, $1, $2, 'linkedin', $3, $4, $5, $6, $7::jsonb, NOW())
             ON CONFLICT (social_account_id) DO UPDATE SET
               first_name = COALESCE(EXCLUDED.first_name, linkedin_profile_stats.first_name),
               last_name = COALESCE(EXCLUDED.last_name, linkedin_profile_stats.last_name),
               headline = COALESCE(EXCLUDED.headline, linkedin_profile_stats.headline),
               profile_picture_url = COALESCE(EXCLUDED.profile_picture_url, linkedin_profile_stats.profile_picture_url),
               raw_response = EXCLUDED.raw_response,
               synced_at = NOW()`,
            [auth.userId, acct.id, firstName, lastName, profile.headline?.localized?.[Object.keys(profile.headline?.localized || {})[0]] || null, 
             profile.profilePicture?.displayImage || null, JSON.stringify(profile)]
          );

          // Update account name
          const displayName = `${firstName} ${lastName}`.trim();
          await pool.query(
            `UPDATE social_accounts SET account_name = \$1 WHERE id = \$2`,
            [displayName, acct.id]
          );
          synced++;
        }
      } catch (profileErr: any) {
        errors.push(`Profile sync failed: ${profileErr.message}`);
      }

      // ── Posts Sync (UGC Posts) ────────────────────────────────────────────
      try {
        const postsResp = await axios.get(
          `${API_BASE}/ugcPosts`,
          {
            params: {
              q: 'authors',
              authors: `urn:li:person:${acct.account_id}`,
              count: 100,
            },
            headers: { Authorization: `Bearer ${token}` },
            validateStatus: () => true,
            timeout: 15000,
          }
        );

        if (postsResp.status === 200 && postsResp.data?.elements) {
          for (const post of postsResp.data.elements) {
            if (!post.id) continue;

            const createdAt = post.created?.time ? new Date(post.created.time).toISOString() : null;

            await pool.query(
              `INSERT INTO linkedin_post_metrics
                 (id, user_id, social_account_id, post_id, text, post_url, media_type, created_at, fetched_at, raw_data)
                VALUES (gen_random_uuid()::text, \$1, \$2, \$3, \$4, \$5, \$6, \$7, NOW(), \$8::jsonb)
                ON CONFLICT (social_account_id, post_id) DO UPDATE SET
                  text = EXCLUDED.text,
                  post_url = EXCLUDED.post_url,
                  media_type = EXCLUDED.media_type,
                  fetched_at = NOW(),
                  raw_data = EXCLUDED.raw_data`,
              [
                auth.userId, acct.id, String(post.id),
                post.specificContent?.com?.linkedin?.ugcPost?.content?.com?.linkedin?.ugcPost?.shareCommentary?.text?.slice(0, 5000) || null,
                `https://www.linkedin.com/feed/update/${post.id}` || null,
                post.specificContent?.com?.linkedin?.ugcPost?.content?.media?.length > 0 ? 'media' : 'text',
                createdAt,
                JSON.stringify(post),
              ]
            );
            synced++;
          }
        }
      } catch (postsErr: any) {
        errors.push(`Posts sync failed: ${postsErr.message}`);
      }
    }

    return res.json({ success: true, synced, errors: errors.length > 0 ? errors : undefined });
  } catch (err) {
    logger.error('LinkedIn sync error:', err);
    return res.status(500).json({ success: false, error: 'LinkedIn sync failed' });
  }
});

// GET /api/social/linkedin/profile — get LinkedIn profile snapshot for authenticated user
router.get('/api/social/linkedin/profile', async (req: Request, res: Response) => {
  try {
    const auth = requireAuth(req, res);
    if (!auth) return;
    if (!pool) return res.json({ profile: null, hasData: false });

    const { rows: profile } = await pool.query(
      `SELECT
         sa.id, sa.account_name, sa.handle, sa.followers,
         lps.first_name, lps.last_name, lps.headline, lps.connections_count, 
         lps.profile_picture_url, lps.synced_at
       FROM social_accounts sa
       LEFT JOIN linkedin_profile_stats lps ON lps.social_account_id = sa.id
       WHERE sa.user_id = \$1
         AND sa.connected = true
         AND sa.platform = 'linkedin'
       ORDER BY lps.synced_at DESC NULLS LAST
       LIMIT 1`,
      [auth.userId]
    );

    if (!profile.length) {
      return res.json({ profile: null, hasData: false });
    }

    const row = profile[0];
    const hasData = row.first_name !== null || row.headline !== null;

    return res.json({
      hasData,
      first_name: row.first_name ?? null,
      last_name: row.last_name ?? null,
      headline: row.headline ?? null,
      connections_count: row.connections_count !== null ? Number(row.connections_count) : 0,
      profile_picture_url: row.profile_picture_url ?? null,
      account_name: row.account_name ?? null,
      synced_at: row.synced_at ?? null,
    });
  } catch (err) {
    logger.error('LinkedIn profile error:', err);
    return res.json({ profile: null, hasData: false });
  }
});

// GET /api/social/linkedin/posts — all synced posts for the authenticated user
router.get('/api/social/linkedin/posts', async (req: Request, res: Response) => {
  try {
    const auth = requireAuth(req, res);
    if (!auth) return;
    if (!pool) return res.status(503).json({ success: false, error: 'DB not ready' });

    const q = req.query as any;
    const limit = Math.min(200, Math.max(1, parseInt(q.limit || '100', 10)));
    const offset = Math.max(0, parseInt(q.offset || '0', 10));

    const postsRes = await pool.query(
      `SELECT lpm.*, sa.account_name
       FROM linkedin_post_metrics lpm
       JOIN social_accounts sa ON sa.id = lpm.social_account_id
       WHERE lpm.user_id = \$1
       ORDER BY COALESCE(lpm.created_at, lpm.fetched_at) DESC
       LIMIT \$2 OFFSET \$3`,
      [auth.userId, limit, offset]
    );

    const countRes = await pool.query(
      `SELECT COUNT(*) FROM linkedin_post_metrics WHERE user_id = \$1`,
      [auth.userId]
    );

    const summaryRes = await pool.query(
      `SELECT
         COUNT(*) AS total_posts
       FROM linkedin_post_metrics
       WHERE user_id = \$1`,
      [auth.userId]
    );

    return res.json({
      success: true,
      posts: postsRes.rows,
      total: parseInt(countRes.rows[0]?.count || '0', 10),
      summary: summaryRes.rows[0] || { total_posts: 0 },
    });
  } catch (err) {
    logger.error('LinkedIn posts error:', err);
    return res.status(500).json({ success: false, error: 'Failed to fetch LinkedIn posts' });
  }
});

// GET /api/social/linkedin/organizations — list admin organizations available to user
router.get('/api/social/linkedin/organizations', async (req: Request, res: Response) => {
  try {
    const auth = requireAuth(req, res);
    if (!auth) return;
    if (!pool) return res.status(503).json({ success: false, error: 'DB not ready' });

    const linkedInAuth = await getLinkedInAuthContext(auth.userId);
    if (!linkedInAuth.hasConnection) {
      return res.status(404).json({ success: false, error: 'No connected LinkedIn account found' });
    }
    const token = linkedInAuth.accessToken;
    if (!token) {
      return res.status(401).json({ success: false, error: 'LinkedIn access token missing or expired — please reconnect' });
    }
    const organizationScopeError = getLinkedInOrganizationScopeError(linkedInAuth.tokenData);
    if (organizationScopeError) {
      return res.status(400).json({ success: false, error: organizationScopeError });
    }

    try {
      const { personId } = await resolveLinkedInProfileIdentity(token, {
        accountId: linkedInAuth.accountId,
        accountName: linkedInAuth.accountName,
        tokenData: linkedInAuth.tokenData,
      });
      if (!personId) {
        return res.status(400).json({ success: false, error: 'Unable to resolve your LinkedIn profile id' });
      }

      const { organizations } = await listLinkedInAdminOrganizations(token, personId, {
        allowedRoles: ['ADMINISTRATOR', 'CONTENT_ADMINISTRATOR', 'ANALYST', 'CURATOR'],
      });
      return res.json({ success: true, organizations });
    } catch (err: any) {
      logger.error('LinkedIn organizations error:', err.message);
      return res.status(500).json({ success: false, error: err?.message || 'Failed to fetch organizations' });
    }
  } catch (err) {
    logger.error('LinkedIn organizations list error:', err);
    return res.status(500).json({ success: false, error: 'Failed to fetch organizations' });
  }
});

// POST /api/social/linkedin/company-sync — sync LinkedIn company page analytics
router.post('/api/social/linkedin/company-sync', async (req: Request, res: Response) => {
  try {
    const auth = requireAuth(req, res);
    if (!auth) return;
    if (!pool) return res.status(503).json({ success: false, error: 'DB not ready' });

    const { organizationId } = req.body as any;
    if (!organizationId) {
      return res.status(400).json({ success: false, error: 'organizationId required' });
    }

    const linkedInAuth = await getLinkedInAuthContext(auth.userId);
    if (!linkedInAuth.hasConnection || !linkedInAuth.socialAccountId) {
      return res.status(404).json({ success: false, error: 'No connected LinkedIn account found' });
    }
    const token = linkedInAuth.accessToken;
    if (!token) {
      return res.status(401).json({ success: false, error: 'LinkedIn access token missing or expired — please reconnect' });
    }
    const organizationScopeError = getLinkedInOrganizationScopeError(linkedInAuth.tokenData, { requireSocialRead: true });
    if (organizationScopeError) {
      return res.status(400).json({ success: false, error: organizationScopeError });
    }

    let synced = 0;
    const errors: string[] = [];
    const organizationUrn = `urn:li:organization:${organizationId}`;

    try {
      const [organizationDetails, followerCount, pageStatsResp, shareStatsResp, posts] = await Promise.all([
        fetchLinkedInOrganizationsByIds(token, [organizationId]),
        fetchLinkedInOrganizationNetworkSize(token, organizationUrn),
        axios.get('https://api.linkedin.com/rest/organizationPageStatistics', {
          params: {
            q: 'organization',
            organization: organizationUrn,
          },
          headers: getLinkedInRestHeaders(token),
          validateStatus: () => true,
          timeout: 15000,
        }),
        axios.get('https://api.linkedin.com/rest/organizationalEntityShareStatistics', {
          params: {
            q: 'organizationalEntity',
            organizationalEntity: organizationUrn,
          },
          headers: getLinkedInRestHeaders(token),
          validateStatus: () => true,
          timeout: 15000,
        }),
        fetchLinkedInPostsByAuthor(token, organizationUrn, 100),
      ]);

      const org = organizationDetails[0]?.raw || null;
      const orgName = organizationDetails[0]?.name || `LinkedIn Page ${organizationId}`;
      const logoUrl = organizationDetails[0]?.picture_url || null;
      const description = extractLinkedInOrganizationDescription(org);
      const shareElements = Array.isArray((shareStatsResp.data as any)?.elements) ? (shareStatsResp.data as any).elements : [];
      const aggregateShareStats = (shareElements[0]?.totalShareStatistics || {}) as Record<string, any>;
      const engagementRate = Number(aggregateShareStats?.engagement || 0) || 0;
      const postsCreated = posts.length;

      await pool.query(
        `INSERT INTO linkedin_company_stats
           (id, user_id, social_account_id, organization_id, organization_name, follower_count, engagement_rate, posts_created, logo_url, description, raw_response, synced_at)
         VALUES (gen_random_uuid()::text, $1, $2, $3, $4, $5, $6, $7, $8, $9, $10::jsonb, NOW())
         ON CONFLICT (social_account_id, organization_id) DO UPDATE SET
           organization_name = COALESCE(EXCLUDED.organization_name, linkedin_company_stats.organization_name),
           follower_count = COALESCE(EXCLUDED.follower_count, linkedin_company_stats.follower_count),
           engagement_rate = COALESCE(EXCLUDED.engagement_rate, linkedin_company_stats.engagement_rate),
           posts_created = COALESCE(EXCLUDED.posts_created, linkedin_company_stats.posts_created),
           logo_url = COALESCE(EXCLUDED.logo_url, linkedin_company_stats.logo_url),
           description = COALESCE(EXCLUDED.description, linkedin_company_stats.description),
           raw_response = EXCLUDED.raw_response,
           synced_at = NOW()`,
        [
          auth.userId,
          linkedInAuth.socialAccountId,
          organizationId,
          orgName,
          followerCount ?? 0,
          engagementRate,
          postsCreated,
          logoUrl,
          description,
          JSON.stringify({
            organization: org,
            followerCount,
            pageStatistics: pageStatsResp.status < 400 ? pageStatsResp.data : null,
            shareStatistics: shareStatsResp.status < 400 ? shareStatsResp.data : null,
          }),
        ],
      );
      synced++;

      const postUrns = posts
        .map((post) => String(post?.id || '').trim())
        .filter(Boolean);
      const [socialMetadataByPostId, shareStatsByPostId] = await Promise.all([
        fetchLinkedInSocialMetadataBatch(token, postUrns),
        fetchLinkedInShareStatisticsForPosts(token, organizationUrn, postUrns),
      ]);

      for (const post of posts) {
        const postId = String(post?.id || '').trim();
        if (!postId) continue;

        const socialMetadata = socialMetadataByPostId[postId] || {};
        const postStats = shareStatsByPostId.get(postId) || {};
        const impressions = Number(postStats?.impressionCount || 0) || 0;
        const clicks = Number(postStats?.clickCount || 0) || 0;
        const likes = Number(postStats?.likeCount || sumLinkedInReactionCounts(socialMetadata) || 0) || 0;
        const comments = Number(postStats?.commentCount || socialMetadata?.commentSummary?.count || 0) || 0;
        const reposts = Number(postStats?.shareCount || socialMetadata?.repostSummary?.count || 0) || 0;
        const postEngagementRate = Number(postStats?.engagement || 0) || 0;
        const createdAtRaw = post?.publishedAt || post?.createdAt || null;
        const createdAt = createdAtRaw ? new Date(createdAtRaw).toISOString() : null;

        await pool.query(
          `INSERT INTO linkedin_company_posts
             (id, user_id, social_account_id, post_id, organization_id, text, media_type, impressions, likes, comments, reposts, clicks, engagement_rate, created_at, fetched_at, raw_data)
           VALUES (gen_random_uuid()::text, $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, NOW(), $14::jsonb)
           ON CONFLICT (social_account_id, post_id) DO UPDATE SET
             text = EXCLUDED.text,
             media_type = EXCLUDED.media_type,
             impressions = EXCLUDED.impressions,
             likes = EXCLUDED.likes,
             comments = EXCLUDED.comments,
             reposts = EXCLUDED.reposts,
             clicks = EXCLUDED.clicks,
             engagement_rate = EXCLUDED.engagement_rate,
             created_at = COALESCE(EXCLUDED.created_at, linkedin_company_posts.created_at),
             fetched_at = NOW(),
             raw_data = EXCLUDED.raw_data`,
          [
            auth.userId,
            linkedInAuth.socialAccountId,
            postId,
            organizationId,
            extractLinkedInPostText(post),
            extractLinkedInPostMediaType(post),
            impressions,
            likes,
            comments,
            reposts,
            clicks,
            postEngagementRate,
            createdAt,
            JSON.stringify({
              post,
              socialMetadata,
              shareStatistics: postStats,
            }),
          ],
        );
        synced++;
      }
    } catch (syncErr: any) {
      errors.push(`Company analytics sync failed: ${syncErr.message}`);
    }

    return res.json({ success: true, synced, errors: errors.length > 0 ? errors : undefined });
  } catch (err) {
    logger.error('LinkedIn company sync error:', err);
    return res.status(500).json({ success: false, error: 'LinkedIn company sync failed' });
  }
});

// GET /api/social/linkedin/company-stats — get company page analytics snapshot
router.get('/api/social/linkedin/company-stats', async (req: Request, res: Response) => {
  try {
    const auth = requireAuth(req, res);
    if (!auth) return;
    if (!pool) return res.json({ stats: null, hasData: false });

    const { organization_id } = req.query as any;
    if (!organization_id) {
      return res.json({ stats: null, hasData: false });
    }

    const { rows: stats } = await pool.query(
      `SELECT
         sa.id, sa.account_name,
         lcs.organization_id, lcs.organization_name, lcs.follower_count,
         lcs.posts_created, lcs.engagement_rate, lcs.logo_url, lcs.synced_at
       FROM social_accounts sa
       LEFT JOIN linkedin_company_stats lcs ON lcs.social_account_id = sa.id
       WHERE sa.user_id = $1
         AND lcs.organization_id = $2
         AND sa.connected = true
         AND sa.platform = 'linkedin'
       LIMIT 1`,
      [auth.userId, organization_id]
    );

    if (!stats.length) {
      return res.json({ stats: null, hasData: false });
    }

    const row = stats[0];
    const hasData = row.follower_count !== null || row.posts_created !== null;

    return res.json({
      hasData,
      organization_id: row.organization_id,
      organization_name: row.organization_name ?? null,
      follower_count: row.follower_count !== null ? Number(row.follower_count) : 0,
      posts_created: row.posts_created !== null ? Number(row.posts_created) : 0,
      engagement_rate: row.engagement_rate !== null ? Number(row.engagement_rate) : 0,
      logo_url: row.logo_url ?? null,
      synced_at: row.synced_at ?? null,
    });
  } catch (err) {
    logger.error('LinkedIn company stats error:', err);
    return res.json({ stats: null, hasData: false });
  }
});

// GET /api/social/linkedin/company-posts — get company page posts analytics
router.get('/api/social/linkedin/company-posts', async (req: Request, res: Response) => {
  try {
    const auth = requireAuth(req, res);
    if (!auth) return;
    if (!pool) return res.status(503).json({ success: false, error: 'DB not ready' });

    const { organization_id, limit = '50', offset = '0' } = req.query as any;
    if (!organization_id) {
      return res.status(400).json({ success: false, error: 'organization_id required' });
    }

    const pageLimit = Math.min(500, Math.max(1, parseInt(limit, 10)));
    const pageOffset = Math.max(0, parseInt(offset, 10));

    const postsRes = await pool.query(
      `SELECT lcp.*, sa.account_name
       FROM linkedin_company_posts lcp
       JOIN social_accounts sa ON sa.id = lcp.social_account_id
       WHERE lcp.user_id = $1 AND lcp.organization_id = $2
       ORDER BY lcp.created_at DESC NULLS LAST
       LIMIT $3 OFFSET $4`,
      [auth.userId, organization_id, pageLimit, pageOffset]
    );

    const countRes = await pool.query(
      `SELECT COUNT(*) FROM linkedin_company_posts WHERE user_id = $1 AND organization_id = $2`,
      [auth.userId, organization_id]
    );

    const summaryRes = await pool.query(
      `SELECT
         COUNT(*) AS total_posts,
         COALESCE(SUM(impressions), 0) AS total_impressions,
         COALESCE(SUM(likes), 0) AS total_likes,
         COALESCE(SUM(comments), 0) AS total_comments,
         COALESCE(SUM(clicks), 0) AS total_clicks,
         CASE WHEN COUNT(*) > 0
              THEN ROUND((SUM(likes + comments)::numeric / NULLIF(SUM(impressions), 0)) * 100, 2)
              ELSE 0 END AS avg_engagement_rate
       FROM linkedin_company_posts
       WHERE user_id = $1 AND organization_id = $2`,
      [auth.userId, organization_id]
    );

    return res.json({
      success: true,
      posts: postsRes.rows,
      total: parseInt(countRes.rows[0]?.count || '0', 10),
      summary: summaryRes.rows[0] || {},
    });
  } catch (err) {
    logger.error('LinkedIn company posts error:', err);
    return res.status(500).json({ success: false, error: 'Failed to fetch company posts' });
  }
});


  return router;
}
