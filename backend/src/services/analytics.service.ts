import axios from "axios";
import { PrismaClient, PostStatus } from "@prisma/client";
import { logIntegrationEvent } from "../utils/integration-log";
import { decryptToken } from "../utils/encryption";
import { FacebookAdapter } from "./platform-adapters/facebook.adapter";
import { InstagramAdapter } from "./platform-adapters/instagram.adapter";
import { TwitterAdapter } from "./platform-adapters/twitter.adapter";
import { LinkedInAdapter } from "./platform-adapters/linkedin.adapter";
import { PinterestAdapter } from "./platform-adapters/pinterest.adapter";

const prisma = new PrismaClient();

export type DateRange = { start: Date; end: Date };

export type StandardMetrics = {
  postsPublished: number;
  totalReach: number;
  totalImpressions: number;
  totalEngagement: number;
  totalLikes: number;
  totalComments: number;
  totalShares: number;
  totalSaves: number;
  engagementRate: number;
  rawData?: any;
};

const emptyMetrics = (): StandardMetrics => ({
  postsPublished: 0,
  totalReach: 0,
  totalImpressions: 0,
  totalEngagement: 0,
  totalLikes: 0,
  totalComments: 0,
  totalShares: 0,
  totalSaves: 0,
  engagementRate: 0,
});

const calcEngagementRate = (engagement: number, impressions: number) =>
  impressions > 0 ? Number(((engagement / impressions) * 100).toFixed(2)) : 0;

const startOfDay = (date: Date) => {
  const d = new Date(date);
  d.setHours(0, 0, 0, 0);
  return d;
};

const endOfDay = (date: Date) => {
  const d = new Date(date);
  d.setHours(23, 59, 59, 999);
  return d;
};

const addDays = (date: Date, days: number) => {
  const d = new Date(date);
  d.setDate(d.getDate() + days);
  return d;
};

const buildDateRange = (days: 30 | 60): DateRange => {
  const end = endOfDay(new Date());
  const start = startOfDay(addDays(end, -(days - 1)));
  return { start, end };
};

const getDaysList = (range: DateRange) => {
  const dates: Date[] = [];
  let cursor = startOfDay(range.start);
  const end = startOfDay(range.end);
  while (cursor.getTime() <= end.getTime()) {
    dates.push(new Date(cursor));
    cursor = addDays(cursor, 1);
  }
  return dates;
};

const sumMetrics = (items: StandardMetrics[]) => {
  return items.reduce(
    (acc, item) => {
      acc.postsPublished += item.postsPublished;
      acc.totalReach += item.totalReach;
      acc.totalImpressions += item.totalImpressions;
      acc.totalEngagement += item.totalEngagement;
      acc.totalLikes += item.totalLikes;
      acc.totalComments += item.totalComments;
      acc.totalShares += item.totalShares;
      acc.totalSaves += item.totalSaves;
      return acc;
    },
    emptyMetrics()
  );
};

const normalizeMetrics = (metrics: StandardMetrics) => {
  return {
    ...metrics,
    totalEngagement:
      metrics.totalEngagement ||
      metrics.totalLikes + metrics.totalComments + metrics.totalShares,
    engagementRate: calcEngagementRate(
      metrics.totalEngagement ||
        metrics.totalLikes + metrics.totalComments + metrics.totalShares,
      metrics.totalImpressions
    ),
  } as StandardMetrics;
};

const getPlatformMetricsFromAnalytics = (analytics: any, platform: string) => {
  if (!analytics) return emptyMetrics();
  switch (platform) {
    case "instagram":
      return normalizeMetrics({
        postsPublished: 1,
        totalReach: analytics.instagramReach || 0,
        totalImpressions: analytics.instagramImpressions || 0,
        totalEngagement:
          (analytics.instagramLikes || 0) +
          (analytics.instagramComments || 0) +
          (analytics.instagramShares || 0),
        totalLikes: analytics.instagramLikes || 0,
        totalComments: analytics.instagramComments || 0,
        totalShares: analytics.instagramShares || 0,
        totalSaves: analytics.instagramSaves || 0,
        engagementRate: 0,
      });
    case "tiktok":
      return normalizeMetrics({
        postsPublished: 1,
        totalReach: analytics.tiktokViews || 0,
        totalImpressions: analytics.tiktokViews || 0,
        totalEngagement:
          (analytics.tiktokLikes || 0) +
          (analytics.tiktokComments || 0) +
          (analytics.tiktokShares || 0),
        totalLikes: analytics.tiktokLikes || 0,
        totalComments: analytics.tiktokComments || 0,
        totalShares: analytics.tiktokShares || 0,
        totalSaves: 0,
        engagementRate: 0,
      });
    case "linkedin":
      return normalizeMetrics({
        postsPublished: 1,
        totalReach: analytics.linkedinImpressions || 0,
        totalImpressions: analytics.linkedinImpressions || 0,
        totalEngagement:
          (analytics.linkedinLikes || 0) +
          (analytics.linkedinComments || 0),
        totalLikes: analytics.linkedinLikes || 0,
        totalComments: analytics.linkedinComments || 0,
        totalShares: 0,
        totalSaves: 0,
        engagementRate: 0,
      });
    case "twitter":
      return normalizeMetrics({
        postsPublished: 1,
        totalReach: analytics.twitterImpressions || 0,
        totalImpressions: analytics.twitterImpressions || 0,
        totalEngagement:
          (analytics.twitterLikes || 0) +
          (analytics.twitterRetweets || 0) +
          (analytics.twitterReplies || 0),
        totalLikes: analytics.twitterLikes || 0,
        totalComments: analytics.twitterReplies || 0,
        totalShares: analytics.twitterRetweets || 0,
        totalSaves: 0,
        engagementRate: 0,
      });
    case "facebook":
      return normalizeMetrics({
        postsPublished: 1,
        totalReach: analytics.facebookReach || 0,
        totalImpressions: analytics.facebookImpressions || 0,
        totalEngagement:
          (analytics.facebookLikes || 0) +
          (analytics.facebookComments || 0) +
          (analytics.facebookShares || 0),
        totalLikes: analytics.facebookLikes || 0,
        totalComments: analytics.facebookComments || 0,
        totalShares: analytics.facebookShares || 0,
        totalSaves: 0,
        engagementRate: 0,
      });
    default:
      return emptyMetrics();
  }
};

const buildTrendSeries = (rows: any[], key: keyof StandardMetrics) => {
  const grouped = new Map<string, number>();
  rows.forEach((row) => {
    const dateKey = new Date(row.date).toISOString().split("T")[0];
    grouped.set(dateKey, (grouped.get(dateKey) || 0) + (row[key] || 0));
  });
  return Array.from(grouped.entries())
    .map(([date, value]) => ({ date, value }))
    .sort((a, b) => (a.date > b.date ? 1 : -1));
};

export class AnalyticsService {
  static async fetchPlatformMetrics(
    userIntegrationId: string,
    days: 30 | 60,
    refresh = false
  ) {
    const integration = await prisma.userIntegration.findUnique({
      where: { id: userIntegrationId },
      include: { integration: true, user: true },
    });
    if (!integration) throw new Error("Integration not found");

    const range = buildDateRange(days);
    const daysList = getDaysList(range);

    const cached = await prisma.platformDailyMetrics.findMany({
      where: {
        userIntegrationId,
        date: { gte: range.start, lte: range.end },
      },
      orderBy: { date: "asc" },
    });

    const cacheFresh = cached.length >= daysList.length &&
      cached.every((row) => Date.now() - row.updatedAt.getTime() < 60 * 60 * 1000);

    if (!refresh && cacheFresh) {
      return cached;
    }

    const platform = integration.integration.slug;
    const metrics = await this.fetchMetricsFromApi(integration, range);
    await this.storeDailyMetrics(integration, platform, metrics, daysList);

    return prisma.platformDailyMetrics.findMany({
      where: {
        userIntegrationId,
        date: { gte: range.start, lte: range.end },
      },
      orderBy: { date: "asc" },
    });
  }

  private static async storeDailyMetrics(
    integration: any,
    platform: string,
    metrics: StandardMetrics,
    daysList: Date[]
  ) {
    const daysCount = daysList.length || 1;
    const perDay = (value: number) => Math.round(value / daysCount);

    for (const date of daysList) {
      const payload: StandardMetrics = normalizeMetrics({
        postsPublished: perDay(metrics.postsPublished),
        totalReach: perDay(metrics.totalReach),
        totalImpressions: perDay(metrics.totalImpressions),
        totalEngagement: perDay(metrics.totalEngagement),
        totalLikes: perDay(metrics.totalLikes),
        totalComments: perDay(metrics.totalComments),
        totalShares: perDay(metrics.totalShares),
        totalSaves: perDay(metrics.totalSaves),
        engagementRate: 0,
        rawData: metrics.rawData,
      });

      await prisma.platformDailyMetrics.upsert({
        where: {
          userIntegrationId_date_platform: {
            userIntegrationId: integration.id,
            date: startOfDay(date),
            platform,
          },
        },
        update: {
          postsPublished: payload.postsPublished,
          totalReach: payload.totalReach,
          totalImpressions: payload.totalImpressions,
          totalEngagement: payload.totalEngagement,
          totalLikes: payload.totalLikes,
          totalComments: payload.totalComments,
          totalShares: payload.totalShares,
          totalSaves: payload.totalSaves,
          engagementRate: payload.engagementRate,
          rawData: payload.rawData,
        },
        create: {
          userIntegrationId: integration.id,
          agencyId: integration.user.agencyId,
          userId: integration.userId,
          date: startOfDay(date),
          platform,
          postsPublished: payload.postsPublished,
          totalReach: payload.totalReach,
          totalImpressions: payload.totalImpressions,
          totalEngagement: payload.totalEngagement,
          totalLikes: payload.totalLikes,
          totalComments: payload.totalComments,
          totalShares: payload.totalShares,
          totalSaves: payload.totalSaves,
          engagementRate: payload.engagementRate,
          rawData: payload.rawData,
        },
      });
    }
  }

  private static async fetchMetricsFromApi(integration: any, range: DateRange) {
    const accessToken = integration.accessToken
      ? decryptToken(integration.accessToken)
      : "";

    try {
      switch (integration.integration.slug) {
        case "facebook":
          return await this.fetchFacebookMetrics(
            accessToken,
            integration.accountId,
            range
          );
        case "instagram":
          return await this.fetchInstagramMetrics(
            accessToken,
            integration.accountId,
            range
          );
        case "twitter":
          return await this.fetchTwitterMetrics(
            accessToken,
            integration.accountId,
            range
          );
        case "linkedin":
          return await this.fetchLinkedInMetrics(
            accessToken,
            integration.accountId,
            range
          );
        case "pinterest":
          return await this.fetchPinterestMetrics(
            accessToken,
            integration.accountId,
            range
          );
        case "tiktok":
          return await this.fetchTikTokMetrics(accessToken, integration.accountId, range);
        default:
          return emptyMetrics();
      }
    } catch (error: any) {
      await logIntegrationEvent({
        userId: integration.userId,
        integrationId: integration.integrationId,
        userIntegrationId: integration.id,
        eventType: "analytics_fetch",
        status: "failed",
        errorMessage: error?.message || "Analytics fetch failed",
      });
      return emptyMetrics();
    }
  }

  static async aggregateDailyMetrics(userIntegrationId: string, date: Date) {
    const integration = await prisma.userIntegration.findUnique({
      where: { id: userIntegrationId },
      include: { integration: true, user: true },
    });
    if (!integration) throw new Error("Integration not found");

    const day = startOfDay(date);
    const platform = integration.integration.slug;

    const record = await prisma.platformDailyMetrics.findUnique({
      where: {
        userIntegrationId_date_platform: {
          userIntegrationId,
          date: day,
          platform,
        },
      },
    });

    if (record) return record;

    return prisma.platformDailyMetrics.create({
      data: {
        userIntegrationId,
        agencyId: integration.user.agencyId,
        userId: integration.userId,
        date: day,
        platform,
        postsPublished: 0,
        totalReach: 0,
        totalImpressions: 0,
        totalEngagement: 0,
        totalLikes: 0,
        totalComments: 0,
        totalShares: 0,
        totalSaves: 0,
        engagementRate: 0,
      },
    });
  }
  static async aggregateMonthlyMetrics(
    userIntegrationId: string,
    year: number,
    month: number
  ) {
    const integration = await prisma.userIntegration.findUnique({
      where: { id: userIntegrationId },
      include: { integration: true, user: true },
    });
    if (!integration) throw new Error("Integration not found");

    const start = new Date(year, month - 1, 1);
    const end = new Date(year, month, 0, 23, 59, 59, 999);

    const rows = await prisma.platformDailyMetrics.findMany({
      where: {
        userIntegrationId,
        date: { gte: start, lte: end },
      },
    });

    const totals = sumMetrics(
      rows.map((row) => normalizeMetrics({
        postsPublished: row.postsPublished,
        totalReach: row.totalReach,
        totalImpressions: row.totalImpressions,
        totalEngagement: row.totalEngagement,
        totalLikes: row.totalLikes,
        totalComments: row.totalComments,
        totalShares: row.totalShares,
        totalSaves: row.totalSaves,
        engagementRate: row.engagementRate,
      }))
    );

    const engagementRate = calcEngagementRate(
      totals.totalEngagement,
      totals.totalImpressions
    );

    const previous = await prisma.platformMonthlyMetrics.findFirst({
      where: {
        userIntegrationId,
        year: month === 1 ? year - 1 : year,
        month: month === 1 ? 12 : month - 1,
        platform: integration.integration.slug,
      },
    });

    const growthRate = previous
      ? Number(
          (
            ((totals.totalEngagement - previous.totalEngagement) /
              (previous.totalEngagement || 1)) *
            100
          ).toFixed(2)
        )
      : 0;

    return prisma.platformMonthlyMetrics.upsert({
      where: {
        userIntegrationId_year_month_platform: {
          userIntegrationId,
          year,
          month,
          platform: integration.integration.slug,
        },
      },
      update: {
        postsPublished: totals.postsPublished,
        totalReach: totals.totalReach,
        totalImpressions: totals.totalImpressions,
        totalEngagement: totals.totalEngagement,
        totalLikes: totals.totalLikes,
        totalComments: totals.totalComments,
        totalShares: totals.totalShares,
        totalSaves: totals.totalSaves,
        engagementRate,
        growthRate,
      },
      create: {
        userIntegrationId,
        agencyId: integration.user.agencyId,
        userId: integration.userId,
        year,
        month,
        platform: integration.integration.slug,
        postsPublished: totals.postsPublished,
        totalReach: totals.totalReach,
        totalImpressions: totals.totalImpressions,
        totalEngagement: totals.totalEngagement,
        totalLikes: totals.totalLikes,
        totalComments: totals.totalComments,
        totalShares: totals.totalShares,
        totalSaves: totals.totalSaves,
        engagementRate,
        growthRate,
      },
    });
  }

  static async getUserAnalytics(
    userId: string,
    agencyId: string,
    days: 30 | 60
  ) {
    const range = buildDateRange(days);
    const integrations = await prisma.userIntegration.findMany({
      where: {
        userId,
        user: { agencyId },
      },
      include: { integration: true },
    });

    const platforms = [] as any[];
    const combinedMetrics = emptyMetrics();

    for (const integration of integrations) {
      const dailyMetrics = await prisma.platformDailyMetrics.findMany({
        where: {
          userIntegrationId: integration.id,
          date: { gte: range.start, lte: range.end },
        },
      });

      const totals = sumMetrics(
        dailyMetrics.map((row) => normalizeMetrics({
          postsPublished: row.postsPublished,
          totalReach: row.totalReach,
          totalImpressions: row.totalImpressions,
          totalEngagement: row.totalEngagement,
          totalLikes: row.totalLikes,
          totalComments: row.totalComments,
          totalShares: row.totalShares,
          totalSaves: row.totalSaves,
          engagementRate: row.engagementRate,
        }))
      );

      const normalized = normalizeMetrics(totals);

      platforms.push({
        platform: integration.integration.slug,
        accountName: integration.accountName,
        metrics: normalized,
      });

      combinedMetrics.postsPublished += normalized.postsPublished;
      combinedMetrics.totalReach += normalized.totalReach;
      combinedMetrics.totalImpressions += normalized.totalImpressions;
      combinedMetrics.totalEngagement += normalized.totalEngagement;
      combinedMetrics.totalLikes += normalized.totalLikes;
      combinedMetrics.totalComments += normalized.totalComments;
      combinedMetrics.totalShares += normalized.totalShares;
      combinedMetrics.totalSaves += normalized.totalSaves;
    }

    combinedMetrics.engagementRate = calcEngagementRate(
      combinedMetrics.totalEngagement,
      combinedMetrics.totalImpressions
    );

    const allDaily = await prisma.platformDailyMetrics.findMany({
      where: { agencyId, date: { gte: range.start, lte: range.end } },
    });

    const trends = Array.from(
      new Map(
        allDaily.map((row) => {
          const dateKey = new Date(row.date).toISOString().split("T")[0];
          return [dateKey, row];
        })
      ).keys()
    ).map((dateKey) => {
      const rows = allDaily.filter(
        (row) => new Date(row.date).toISOString().split("T")[0] === dateKey
      );
      const dayTotals = sumMetrics(
        rows.map((row) => normalizeMetrics({
          postsPublished: row.postsPublished,
          totalReach: row.totalReach,
          totalImpressions: row.totalImpressions,
          totalEngagement: row.totalEngagement,
          totalLikes: row.totalLikes,
          totalComments: row.totalComments,
          totalShares: row.totalShares,
          totalSaves: row.totalSaves,
          engagementRate: row.engagementRate,
        }))
      );
      return {
        date: dateKey,
        totalEngagement: dayTotals.totalEngagement,
        totalReach: dayTotals.totalReach,
        totalImpressions: dayTotals.totalImpressions,
      };
    });

    trends.sort((a, b) => (a.date > b.date ? 1 : -1));

    const topPlatforms = [...platforms]
      .sort(
        (a, b) => b.metrics.totalEngagement - a.metrics.totalEngagement
      )
      .slice(0, 5)
      .map((item) => ({
        platform: item.platform,
        engagement: item.metrics.totalEngagement,
      }));

    return {
      dateRange: range,
      platforms,
      combined: {
        postsPublished: combinedMetrics.postsPublished,
        totalReach: combinedMetrics.totalReach,
        totalImpressions: combinedMetrics.totalImpressions,
        totalEngagement: combinedMetrics.totalEngagement,
        engagementRate: combinedMetrics.engagementRate,
        topPlatforms,
        trends,
      },
    };
  }

  static async getPlatformAnalytics(userIntegrationId: string, days: 30 | 60) {
    const range = buildDateRange(days);
    const integration = await prisma.userIntegration.findUnique({
      where: { id: userIntegrationId },
      include: { integration: true },
    });
    if (!integration) throw new Error("Integration not found");

    const dailyMetrics = await prisma.platformDailyMetrics.findMany({
      where: {
        userIntegrationId,
        date: { gte: range.start, lte: range.end },
      },
      orderBy: { date: "asc" },
    });

    const totals = sumMetrics(
      dailyMetrics.map((row) => normalizeMetrics({
        postsPublished: row.postsPublished,
        totalReach: row.totalReach,
        totalImpressions: row.totalImpressions,
        totalEngagement: row.totalEngagement,
        totalLikes: row.totalLikes,
        totalComments: row.totalComments,
        totalShares: row.totalShares,
        totalSaves: row.totalSaves,
        engagementRate: row.engagementRate,
      }))
    );

    return {
      platform: integration.integration.slug,
      accountName: integration.accountName,
      metrics: normalizeMetrics(totals),
      dailyBreakdown: dailyMetrics.map((row) => ({
        date: row.date,
        reach: row.totalReach,
        impressions: row.totalImpressions,
        engagement: row.totalEngagement,
        likes: row.totalLikes,
        comments: row.totalComments,
        shares: row.totalShares,
        saves: row.totalSaves,
      })),
    };
  }

  static async getPostAnalytics(postId: string) {
    const post = await prisma.post.findUnique({
      where: { id: postId },
      include: {
        analytics: true,
        platformIntegrations: {
          include: { userIntegration: { include: { integration: true } } },
        },
      },
    });
    if (!post) throw new Error("Post not found");

    const platforms = post.platformIntegrations.map((integration) => {
      const platform = integration.userIntegration.integration.slug;
      const metrics = getPlatformMetricsFromAnalytics(post.analytics, platform);
      return {
        platform,
        status: integration.status,
        platformPostId: integration.platformPostId,
        metrics: {
          likes: metrics.totalLikes,
          comments: metrics.totalComments,
          shares: metrics.totalShares,
          reach: metrics.totalReach,
          impressions: metrics.totalImpressions,
        },
      };
    });

    const combined = sumMetrics(
      platforms.map((item) => normalizeMetrics({
        postsPublished: 1,
        totalReach: item.metrics.reach,
        totalImpressions: item.metrics.impressions,
        totalEngagement: item.metrics.likes + item.metrics.comments + item.metrics.shares,
        totalLikes: item.metrics.likes,
        totalComments: item.metrics.comments,
        totalShares: item.metrics.shares,
        totalSaves: 0,
        engagementRate: 0,
      }))
    );

    return {
      post: { id: post.id, title: post.title, content: post.content },
      platforms,
      combined: {
        totalEngagement: combined.totalEngagement,
        totalReach: combined.totalReach,
      },
    };
  }

  static async calculateEngagementTrend(
    userIntegrationId: string,
    days: 30 | 60
  ) {
    const range = buildDateRange(days);
    const rows = await prisma.platformDailyMetrics.findMany({
      where: {
        userIntegrationId,
        date: { gte: range.start, lte: range.end },
      },
      orderBy: { date: "asc" },
    });
    return buildTrendSeries(rows, "totalEngagement");
  }

  static async calculateReachTrend(userIntegrationId: string, days: 30 | 60) {
    const range = buildDateRange(days);
    const rows = await prisma.platformDailyMetrics.findMany({
      where: {
        userIntegrationId,
        date: { gte: range.start, lte: range.end },
      },
      orderBy: { date: "asc" },
    });
    return buildTrendSeries(rows, "totalReach");
  }

  static async getTopPosts(
    userId: string,
    agencyId: string,
    limit = 10,
    days: 30 | 60
  ) {
    const range = buildDateRange(days);
    const posts = await prisma.post.findMany({
      where: {
        agencyId,
        createdById: userId,
        status: { in: [PostStatus.POSTED, PostStatus.FAILED] },
        createdAt: { gte: range.start, lte: range.end },
      },
      include: {
        analytics: true,
        platformIntegrations: {
          include: { userIntegration: { include: { integration: true } } },
        },
      },
      orderBy: { createdAt: "desc" },
    });

    const rows = posts.map((post) => {
      const platforms = post.platformIntegrations.map(
        (integration) => integration.userIntegration.integration.slug
      );
      const metrics = sumMetrics(
        platforms.map((platform) =>
          getPlatformMetricsFromAnalytics(post.analytics, platform)
        )
      );
      const normalized = normalizeMetrics(metrics);
      return {
        id: post.id,
        title: post.title,
        platforms,
        engagement: normalized.totalEngagement,
        reach: normalized.totalReach,
        impressions: normalized.totalImpressions,
        postedAt: post.postedAt || post.createdAt,
        engagementRate: normalized.engagementRate,
      };
    });

    return rows
      .sort((a, b) => b.engagement - a.engagement)
      .slice(0, limit);
  }

  static async getTopPlatforms(userId: string, agencyId: string, days: 30 | 60) {
    const range = buildDateRange(days);
    const rows = await prisma.platformDailyMetrics.findMany({
      where: { agencyId, date: { gte: range.start, lte: range.end } },
    });

    const grouped = new Map<string, StandardMetrics>();
    rows.forEach((row) => {
      const key = row.platform;
      const current = grouped.get(key) || emptyMetrics();
      grouped.set(
        key,
        normalizeMetrics({
          postsPublished: current.postsPublished + row.postsPublished,
          totalReach: current.totalReach + row.totalReach,
          totalImpressions: current.totalImpressions + row.totalImpressions,
          totalEngagement: current.totalEngagement + row.totalEngagement,
          totalLikes: current.totalLikes + row.totalLikes,
          totalComments: current.totalComments + row.totalComments,
          totalShares: current.totalShares + row.totalShares,
          totalSaves: current.totalSaves + row.totalSaves,
          engagementRate: 0,
        })
      );
    });

    return Array.from(grouped.entries())
      .map(([platform, metrics]) => ({
        platform,
        engagementRate: metrics.engagementRate,
        engagement: metrics.totalEngagement,
      }))
      .sort((a, b) => b.engagementRate - a.engagementRate);
  }

  static async fetchFacebookMetrics(
    accessToken: string,
    pageId: string,
    dateRange: DateRange
  ) {
    if (!accessToken || !pageId) return emptyMetrics();
    try {
      const resp = await FacebookAdapter.getPageMetrics(
        pageId,
        accessToken,
        dateRange
      );
      return normalizeMetrics({
        postsPublished: 0,
        totalReach: resp.reach || 0,
        totalImpressions: resp.impressions || 0,
        totalEngagement: resp.engagement || 0,
        totalLikes: resp.likes || 0,
        totalComments: resp.comments || 0,
        totalShares: resp.shares || 0,
        totalSaves: resp.saves || 0,
        engagementRate: 0,
        rawData: resp.raw,
      });
    } catch (error) {
      return emptyMetrics();
    }
  }

  static async fetchInstagramMetrics(
    accessToken: string,
    accountId: string,
    dateRange: DateRange
  ) {
    if (!accessToken || !accountId) return emptyMetrics();
    try {
      const resp = await InstagramAdapter.getAccountMetrics(
        accountId,
        accessToken,
        dateRange
      );
      return normalizeMetrics({
        postsPublished: 0,
        totalReach: resp.reach || 0,
        totalImpressions: resp.impressions || 0,
        totalEngagement: resp.engagement || 0,
        totalLikes: resp.likes || 0,
        totalComments: resp.comments || 0,
        totalShares: resp.shares || 0,
        totalSaves: resp.saves || 0,
        engagementRate: 0,
        rawData: resp.raw,
      });
    } catch {
      return emptyMetrics();
    }
  }

  static async fetchTwitterMetrics(
    accessToken: string,
    userId: string,
    dateRange: DateRange
  ) {
    if (!accessToken || !userId) return emptyMetrics();
    try {
      const resp = await TwitterAdapter.getUserMetrics(
        userId,
        accessToken,
        dateRange
      );
      return normalizeMetrics({
        postsPublished: resp.posts || 0,
        totalReach: resp.impressions || 0,
        totalImpressions: resp.impressions || 0,
        totalEngagement: resp.engagement || 0,
        totalLikes: resp.likes || 0,
        totalComments: resp.comments || 0,
        totalShares: resp.retweets || 0,
        totalSaves: 0,
        engagementRate: 0,
        rawData: resp.raw,
      });
    } catch {
      return emptyMetrics();
    }
  }

  static async fetchLinkedInMetrics(
    accessToken: string,
    organizationId: string,
    dateRange: DateRange
  ) {
    if (!accessToken || !organizationId) return emptyMetrics();
    try {
      const resp = await LinkedInAdapter.getOrganizationMetrics(
        organizationId,
        accessToken,
        dateRange
      );
      return normalizeMetrics({
        postsPublished: resp.posts || 0,
        totalReach: resp.reach || 0,
        totalImpressions: resp.impressions || 0,
        totalEngagement: resp.engagement || 0,
        totalLikes: resp.likes || 0,
        totalComments: resp.comments || 0,
        totalShares: resp.shares || 0,
        totalSaves: 0,
        engagementRate: 0,
        rawData: resp.raw,
      });
    } catch {
      return emptyMetrics();
    }
  }

  static async fetchTikTokMetrics(
    _accessToken: string,
    _businessAccountId: string,
    _dateRange: DateRange
  ) {
    return emptyMetrics();
  }

  static async fetchPinterestMetrics(
    accessToken: string,
    boardId: string,
    dateRange: DateRange
  ) {
    if (!accessToken || !boardId) return emptyMetrics();
    try {
      const resp = await PinterestAdapter.getBoardMetrics(
        boardId,
        accessToken,
        dateRange
      );
      return normalizeMetrics({
        postsPublished: resp.posts || 0,
        totalReach: resp.reach || 0,
        totalImpressions: resp.impressions || 0,
        totalEngagement: resp.engagement || 0,
        totalLikes: resp.likes || 0,
        totalComments: resp.comments || 0,
        totalShares: resp.shares || 0,
        totalSaves: resp.saves || 0,
        engagementRate: 0,
        rawData: resp.raw,
      });
    } catch {
      return emptyMetrics();
    }
  }
}










