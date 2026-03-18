import axios from "axios";
import { UserIntegration } from "@prisma/client";
import { logIntegrationEvent } from "../../utils/integration-log";

export class TwitterAdapter {
  static async publishPost(
    content: string,
    media: { url?: string } | null,
    userIntegration: UserIntegration
  ) {
    if (content.length > 280) {
      return { success: false, error: "Tweet exceeds 280 characters" };
    }

    try {
      const accessToken = userIntegration.accessToken || "";
      if (!accessToken) {
        return { success: false, error: "Missing access token" };
      }

      let mediaIds: string[] = [];
      if (media?.url) {
        const upload = await this.uploadMedia(media.url, userIntegration);
        if (upload?.media_id) {
          mediaIds = [upload.media_id];
        }
      }

      const body: any = { text: content };
      if (mediaIds.length) {
        body.media = { media_ids: mediaIds };
      }

      const resp = await axios.post("https://api.twitter.com/2/tweets", body, {
        headers: { Authorization: `Bearer ${accessToken}` },
      });

      return { success: true, platformPostId: resp.data?.data?.id };
    } catch (error: any) {
      await logIntegrationEvent({
        userId: userIntegration.userId,
        integrationId: userIntegration.integrationId,
        userIntegrationId: userIntegration.id,
        eventType: "post_publish",
        status: "failed",
        errorMessage: error?.message || "Twitter publish failed",
      });
      return {
        success: false,
        error:
          error?.response?.data?.detail ||
          error?.message ||
          "Twitter publish failed",
      };
    }
  }

  static async uploadMedia(fileUrl: string, userIntegration: UserIntegration) {
    try {
      const accessToken = userIntegration.accessToken || "";
      const fileResp = await axios.get(fileUrl, { responseType: "arraybuffer" });
      const FormData = (await import("form-data")).default;
      const form = new FormData();
      form.append("media", Buffer.from(fileResp.data), {
        filename: "upload",
      });

      const resp = await axios.post(
        "https://upload.twitter.com/1.1/media/upload.json",
        form,
        {
          headers: {
            ...form.getHeaders(),
            Authorization: `Bearer ${accessToken}`,
          },
        }
      );

      return { media_id: resp.data?.media_id_string };
    } catch (error: any) {
      return { error: error?.message || "Media upload failed" };
    }
  }

  static async validateToken(accessToken: string) {
    try {
      const resp = await axios.get("https://api.twitter.com/2/users/me", {
        headers: { Authorization: `Bearer ${accessToken}` },
      });
      return { valid: resp.status < 400 };
    } catch {
      return { valid: false };
    }
  }

  static async getMetrics(tweetId: string, userIntegration: UserIntegration) {
    const accessToken = userIntegration.accessToken || "";
    const resp = await axios.get(
      `https://api.twitter.com/2/tweets/${tweetId}?tweet.fields=public_metrics`,
      { headers: { Authorization: `Bearer ${accessToken}` } }
    );
    return resp.data?.data?.public_metrics || {};
  }

  static async getProfile(accessToken: string) {
    try {
      const resp = await axios.get("https://api.twitter.com/2/users/me", {
        headers: { Authorization: `Bearer ${accessToken}` },
      });
      return resp.data?.data || null;
    } catch {
      return null;
    }
  }
  static async getTweetMetrics(tweetId: string, accessToken: string) {
    try {
      const resp = await axios.get(
        `https://api.twitter.com/2/tweets/${tweetId}?tweet.fields=public_metrics`,
        { headers: { Authorization: `Bearer ${accessToken}` } }
      );
      return resp.data?.data?.public_metrics || {};
    } catch (error: any) {
      return { error: error?.message || "Tweet metrics failed" };
    }
  }

  static async getUserMetrics(
    userId: string,
    accessToken: string,
    dateRange: { start: Date; end: Date }
  ) {
    try {
      const resp = await axios.get(
        `https://api.twitter.com/2/users/${userId}/tweets`,
        {
          headers: { Authorization: `Bearer ${accessToken}` },
          params: {
            start_time: dateRange.start.toISOString(),
            end_time: dateRange.end.toISOString(),
            max_results: 100,
            "tweet.fields": "public_metrics",
          },
        }
      );
      const tweets = resp.data?.data || [];
      const totals = tweets.reduce(
        (acc: any, tweet: any) => {
          const metrics = tweet.public_metrics || {};
          acc.likes += metrics.like_count || 0;
          acc.retweets += metrics.retweet_count || 0;
          acc.replies += metrics.reply_count || 0;
          acc.impressions += metrics.impression_count || 0;
          acc.posts += 1;
          return acc;
        },
        { likes: 0, retweets: 0, replies: 0, impressions: 0, posts: 0 }
      );

      return {
        posts: totals.posts,
        likes: totals.likes,
        retweets: totals.retweets,
        comments: totals.replies,
        impressions: totals.impressions,
        engagement: totals.likes + totals.retweets + totals.replies,
        raw: resp.data,
      };
    } catch (error: any) {
      return { error: error?.message || "User metrics failed" };
    }
  }\n}
