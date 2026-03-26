import { Router, Response } from "express";
import { authMiddleware, AuthRequest } from "../middleware/auth.middleware";
import { AnalyticsService } from "../services/analytics.service";
import { AnalyticsSyncService } from "../services/analytics-sync.service";
import { PrismaClient, PostStatus } from "@prisma/client";

const router = Router();
const prisma = new PrismaClient();

const parseDays = (value?: string) => (value === "60" ? 60 : 30) as 30 | 60;

const buildRange = (days: 30 | 60) => {
  const end = new Date();
  end.setHours(23, 59, 59, 999);
  const start = new Date(end);
  start.setDate(start.getDate() - (days - 1));
  start.setHours(0, 0, 0, 0);
  return { start, end };
};

const sumTotals = (rows: any[]) => {
  return rows.reduce(
    (acc, row) => {
      acc.postsPublished += row.postsPublished || 0;
      acc.totalReach += row.totalReach || 0;
      acc.totalImpressions += row.totalImpressions || 0;
      acc.totalEngagement += row.totalEngagement || 0;
      return acc;
    },
    {
      postsPublished: 0,
      totalReach: 0,
      totalImpressions: 0,
      totalEngagement: 0,
    }
  );
};

const calcGrowth = (current: number, previous: number) => {
  if (!previous) return 0;
  return Number((((current - previous) / previous) * 100).toFixed(2));
};

router.get(
  "/overview",
  authMiddleware,
  async (req: AuthRequest, res: Response) => {
    try {
      const days = parseDays(req.query.days as string | undefined);
      const analytics = await AnalyticsService.getUserAnalytics(
        req.userId!,
        req.agencyId!,
        days
      );

      if (!analytics.combined) {
        return res.json({
          success: true,
          data: {
            dateRange: analytics.dateRange,
            summary: null,
            platforms: [],
            topPlatforms: [],
            trends: null,
          },
          message: "No data available yet",
        });
      }

      const range = buildRange(days);
      const previousRange = {
        start: new Date(range.start.getTime() - days * 24 * 60 * 60 * 1000),
        end: new Date(range.start.getTime() - 1),
      };

      const previousRows = await prisma.platformDailyMetrics.findMany({
        where: {
          agencyId: req.agencyId!,
          date: { gte: previousRange.start, lte: previousRange.end },
        },
      });

      const previousTotals = sumTotals(previousRows);
      const growthRate = previousTotals.totalEngagement
        ? calcGrowth(
            analytics.combined.totalEngagement,
            previousTotals.totalEngagement
          )
        : null;

      const platformData = analytics.platforms
        .filter((item) => item.metrics)
        .map((item) => ({
          platform: item.platform,
          reach: item.metrics?.totalReach ?? null,
          impressions: item.metrics?.totalImpressions ?? null,
          engagement: item.metrics?.totalEngagement ?? null,
          engagementRate: item.metrics?.engagementRate ?? null,
        }));

      res.json({
        success: true,
        data: {
          dateRange: analytics.dateRange,
          summary: {
            totalPosts: analytics.combined.postsPublished,
            totalReach: analytics.combined.totalReach,
            totalImpressions: analytics.combined.totalImpressions,
            totalEngagement: analytics.combined.totalEngagement,
            engagementRate: analytics.combined.engagementRate,
            growthRate,
          },
          platforms: platformData,
          topPlatforms: analytics.topPlatforms ?? [],
          trends: analytics.trends,
        },
      });
    } catch (error: any) {
      res.status(400).json({ error: error.message });
    }
  }
);

router.get(
  "/platforms",
  authMiddleware,
  async (req: AuthRequest, res: Response) => {
    try {
      const days = parseDays(req.query.days as string | undefined);
      const analytics = await AnalyticsService.getUserAnalytics(
        req.userId!,
        req.agencyId!,
        days
      );

      const data = analytics.platforms.map((item) => ({
        platform: item.platform,
        accountName: item.accountName,
        metrics: item.metrics,
      }));

      res.json({
        success: true,
        data,
        message: data.length ? undefined : "No data available yet",
      });
    } catch (error: any) {
      res.status(400).json({ error: error.message });
    }
  }
);

router.get(
  "/platforms/:platformSlug",
  authMiddleware,
  async (req: AuthRequest, res: Response) => {
    try {
      const days = parseDays(req.query.days as string | undefined);
      const slug = req.params.platformSlug;
      const integrations = await prisma.userIntegration.findMany({
        where: {
          userId: req.userId!,
          integration: { slug },
        },
        include: { integration: true },
      });
      if (!integrations.length) {
        return res.json({
          success: true,
          data: null,
          message: "Platform not connected",
        });
      }

      const details = await AnalyticsService.getPlatformAnalytics(
        integrations[0].id,
        days
      );

      if (!details) {
        return res.json({
          success: true,
          data: null,
          message: "No data for this platform",
        });
      }

      res.json({ success: true, data: details });
    } catch (error: any) {
      res.status(400).json({ error: error.message });
    }
  }
);

router.get(
  "/trending",
  authMiddleware,
  async (req: AuthRequest, res: Response) => {
    try {
      const days = parseDays(req.query.days as string | undefined);
      const analytics = await AnalyticsService.getUserAnalytics(
        req.userId!,
        req.agencyId!,
        days
      );

      if (!analytics.trends) {
        return res.json({
          success: true,
          data: null,
          message: "No data available yet",
        });
      }

      const topPosts = await AnalyticsService.getTopPosts(
        req.userId!,
        req.agencyId!,
        10,
        days
      );
      const topPlatforms = await AnalyticsService.getTopPlatforms(
        req.userId!,
        req.agencyId!,
        days
      );

      res.json({
        success: true,
        data: {
          engagementTrend: analytics.trends.map((item) => ({
            date: item.date,
            value: item.totalEngagement,
          })),
          reachTrend: analytics.trends.map((item) => ({
            date: item.date,
            value: item.totalReach,
          })),
          impressionsTrend: analytics.trends.map((item) => ({
            date: item.date,
            value: item.totalImpressions ?? null,
          })),
          topPosts,
          topPlatforms,
        },
      });
    } catch (error: any) {
      res.status(400).json({ error: error.message });
    }
  }
);

router.get(
  "/posts",
  authMiddleware,
  async (req: AuthRequest, res: Response) => {
    try {
      const days = parseDays(req.query.days as string | undefined);
      const limit = Number(req.query.limit || 20);
      const offset = Number(req.query.offset || 0);
      const sortBy = (req.query.sortBy as string) || "engagement";

      let posts = await AnalyticsService.getTopPosts(
        req.userId!,
        req.agencyId!,
        200,
        days
      );

      if (!posts.length) {
        return res.json({
          success: true,
          data: [],
          message: "No posts published yet",
        });
      }

      if (sortBy === "reach") {
        posts = posts.sort((a, b) => (b.reach ?? -1) - (a.reach ?? -1));
      } else if (sortBy === "date") {
        posts = posts.sort(
          (a, b) =>
            new Date(b.postedAt).getTime() -
            new Date(a.postedAt).getTime()
        );
      } else {
        posts = posts.sort((a, b) => (b.engagement ?? -1) - (a.engagement ?? -1));
      }

      res.json({ success: true, data: posts.slice(offset, offset + limit) });
    } catch (error: any) {
      res.status(400).json({ error: error.message });
    }
  }
);

router.get(
  "/posts/:postId",
  authMiddleware,
  async (req: AuthRequest, res: Response) => {
    try {
      const payload = await AnalyticsService.getPostAnalytics(req.params.postId);
      res.json({ success: true, data: payload });
    } catch (error: any) {
      res.status(400).json({ error: error.message });
    }
  }
);

router.get(
  "/performance",
  authMiddleware,
  async (req: AuthRequest, res: Response) => {
    try {
      const days = parseDays(req.query.days as string | undefined);
      const groupBy = (req.query.groupBy as string) || "daily";
      const range = buildRange(days);
      const rows = await prisma.platformDailyMetrics.findMany({
        where: { agencyId: req.agencyId!, date: { gte: range.start, lte: range.end } },
      });

      if (!rows.length) {
        return res.json({
          success: true,
          data: null,
          message: "No data available yet",
        });
      }

      const grouped = new Map<string, any>();
      rows.forEach((row) => {
        const date = new Date(row.date);
        let key = date.toISOString().split("T")[0];
        if (groupBy === "weekly") {
          const weekStart = new Date(date);
          weekStart.setDate(date.getDate() - date.getDay());
          key = weekStart.toISOString().split("T")[0];
        } else if (groupBy === "monthly") {
          key = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;
        }

        const existing = grouped.get(key) || { period: key, posts: 0, engagement: 0, reach: 0 };
        existing.posts += row.postsPublished || 0;
        existing.engagement += row.totalEngagement || 0;
        existing.reach += row.totalReach || 0;
        grouped.set(key, existing);
      });

      const groupedData = Array.from(grouped.values()).sort((a, b) =>
        a.period > b.period ? 1 : -1
      );

      const currentTotals = groupedData.reduce(
        (acc, row) => {
          acc.posts += row.posts;
          acc.engagement += row.engagement;
          acc.reach += row.reach;
          return acc;
        },
        { posts: 0, engagement: 0, reach: 0 }
      );

      const comparison = {
        currentPeriod: currentTotals,
        previousPeriod: { posts: 0, engagement: 0, reach: 0 },
        growth: { posts: 0, engagement: 0, reach: 0 },
      };

      res.json({ success: true, data: { groupedData, comparison } });
    } catch (error: any) {
      res.status(400).json({ error: error.message });
    }
  }
);

router.post(
  "/refresh",
  authMiddleware,
  async (req: AuthRequest, res: Response) => {
    try {
      const integrationId = req.query.userIntegrationId as string | undefined;
      if (integrationId) {
        await AnalyticsSyncService.syncPlatformAnalytics(integrationId);
      } else {
        await AnalyticsSyncService.syncAllUserAnalytics(req.userId!, req.agencyId!);
      }
      res.json({ success: true, jobId: `sync-${Date.now()}` });
    } catch (error: any) {
      res.status(400).json({ error: error.message });
    }
  }
);

router.get(
  "/export",
  authMiddleware,
  async (req: AuthRequest, res: Response) => {
    try {
      const days = parseDays(req.query.days as string | undefined);
      const format = (req.query.format as string) || "csv";
      const analytics = await AnalyticsService.getUserAnalytics(
        req.userId!,
        req.agencyId!,
        days
      );

      const rows = [
        ["Platform", "Reach", "Impressions", "Engagement", "Engagement Rate"],
        ...(analytics.platforms
          .filter((item) => item.metrics)
          .map((item) => [
            item.platform,
            item.metrics?.totalReach ?? "",
            item.metrics?.totalImpressions ?? "",
            item.metrics?.totalEngagement ?? "",
            item.metrics?.engagementRate ?? "",
          ])),
      ];

      const csv = rows.map((row) => row.join(",")).join("\n");

      if (format === "pdf") {
        res.setHeader("Content-Type", "application/pdf");
        res.setHeader("Content-Disposition", "attachment; filename=analytics.pdf");
        return res.send(csv);
      }

      res.setHeader("Content-Type", "text/csv");
      res.setHeader("Content-Disposition", "attachment; filename=analytics.csv");
      res.send(csv);
    } catch (error: any) {
      res.status(400).json({ error: error.message });
    }
  }
);

router.get(
  "/comparison",
  authMiddleware,
  async (req: AuthRequest, res: Response) => {
    try {
      const now = new Date();
      const currentStart = new Date(now.getFullYear(), now.getMonth(), 1);
      const currentEnd = new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59, 999);
      const lastStart = new Date(now.getFullYear(), now.getMonth() - 1, 1);
      const lastEnd = new Date(now.getFullYear(), now.getMonth(), 0, 23, 59, 59, 999);

      const currentRows = await prisma.platformDailyMetrics.findMany({
        where: { agencyId: req.agencyId!, date: { gte: currentStart, lte: currentEnd } },
      });
      const lastRows = await prisma.platformDailyMetrics.findMany({
        where: { agencyId: req.agencyId!, date: { gte: lastStart, lte: lastEnd } },
      });

      if (!currentRows.length && !lastRows.length) {
        return res.json({
          success: true,
          data: null,
          message: "No data available yet",
        });
      }

      const currentTotals = sumTotals(currentRows);
      const lastTotals = sumTotals(lastRows);

      res.json({
        success: true,
        data: {
          thisMonth: currentTotals,
          lastMonth: lastTotals,
          change: {
            posts: calcGrowth(currentTotals.postsPublished, lastTotals.postsPublished),
            engagement: calcGrowth(currentTotals.totalEngagement, lastTotals.totalEngagement),
            reach: calcGrowth(currentTotals.totalReach, lastTotals.totalReach),
          },
        },
      });
    } catch (error: any) {
      res.status(400).json({ error: error.message });
    }
  }
);

// GET /api/analytics/dashboard
// Returns the unified BlogAnalyticsDashboard shape expected by the frontend.
router.get(
  "/dashboard",
  authMiddleware,
  async (req: AuthRequest, res: Response) => {
    try {
      const preset = (req.query.preset as string) || "30d";
      const customStart = req.query.start as string | undefined;
      const customEnd = req.query.end as string | undefined;

      // Build date range
      const now = new Date();
      now.setHours(23, 59, 59, 999);

      let daysCount: number;
      let rangeStart: Date;
      const rangeEnd = new Date(now);
      let rangeLabel: string;

      if (preset === "custom" && customStart && customEnd) {
        rangeStart = new Date(customStart);
        rangeStart.setHours(0, 0, 0, 0);
        const customEndDate = new Date(customEnd);
        customEndDate.setHours(23, 59, 59, 999);
        rangeEnd.setTime(customEndDate.getTime());
        daysCount = Math.max(
          1,
          Math.ceil(
            (rangeEnd.getTime() - rangeStart.getTime()) / (1000 * 60 * 60 * 24)
          )
        );
        rangeLabel = `${customStart} – ${customEnd}`;
      } else {
        daysCount = preset === "7d" ? 7 : preset === "90d" ? 90 : 30;
        rangeStart = new Date(now);
        rangeStart.setDate(rangeStart.getDate() - (daysCount - 1));
        rangeStart.setHours(0, 0, 0, 0);
        rangeLabel = `Last ${daysCount} days`;
      }

      const previousRangeMs = rangeEnd.getTime() - rangeStart.getTime();
      const previousStart = new Date(rangeStart.getTime() - previousRangeMs);
      const previousEnd = new Date(rangeStart.getTime() - 1);

      const [currentPosts, previousPosts, platformMetrics, prevPlatformMetrics, futurePosts, lastSyncRecord] =
        await Promise.all([
          prisma.post.findMany({
            where: {
              agencyId: req.agencyId!,
              createdAt: { gte: rangeStart, lte: rangeEnd },
            },
            include: {
              platformIntegrations: {
                include: {
                  userIntegration: { include: { integration: true } },
                },
              },
            },
            orderBy: { postedAt: "desc" },
          }),
          prisma.post.count({
            where: {
              agencyId: req.agencyId!,
              status: PostStatus.POSTED,
              createdAt: { gte: previousStart, lte: previousEnd },
            },
          }),
          prisma.platformDailyMetrics.findMany({
            where: {
              agencyId: req.agencyId!,
              date: { gte: rangeStart, lte: rangeEnd },
            },
            orderBy: { date: "asc" },
          }),
          prisma.platformDailyMetrics.findMany({
            where: {
              agencyId: req.agencyId!,
              date: { gte: previousStart, lte: previousEnd },
            },
          }),
          prisma.post.count({
            where: {
              agencyId: req.agencyId!,
              status: PostStatus.SCHEDULED,
              scheduledAt: { gt: new Date() },
            },
          }),
          prisma.platformDailyMetrics.findFirst({
            where: { agencyId: req.agencyId! },
            orderBy: { updatedAt: "desc" },
            select: { updatedAt: true },
          }),
        ]);

      // ── KPIs ──────────────────────────────────────────────────────────────
      const publishedPosts = currentPosts.filter(
        (p) => p.status === PostStatus.POSTED
      ).length;

      const totalReachCurrent = platformMetrics.reduce(
        (s, r) => s + r.totalReach,
        0
      );
      const totalEngagementCurrent = platformMetrics.reduce(
        (s, r) => s + r.totalEngagement,
        0
      );
      const totalImpressionsCurrent = platformMetrics.reduce(
        (s, r) => s + r.totalImpressions,
        0
      );

      const totalReachPrev = prevPlatformMetrics.reduce(
        (s, r) => s + r.totalReach,
        0
      );
      const totalEngagementPrev = prevPlatformMetrics.reduce(
        (s, r) => s + r.totalEngagement,
        0
      );
      const totalImpressionsPrev = prevPlatformMetrics.reduce(
        (s, r) => s + r.totalImpressions,
        0
      );

      const engagementRate =
        totalImpressionsCurrent > 0
          ? Number(
              (
                (totalEngagementCurrent / totalImpressionsCurrent) *
                100
              ).toFixed(2)
            )
          : null;
      const prevEngagementRate =
        totalImpressionsPrev > 0
          ? Number(
              (
                (totalEngagementPrev / totalImpressionsPrev) *
                100
              ).toFixed(2)
            )
          : null;

      const calcChange = (
        curr: number | null,
        prev: number | null
      ): number | null => {
        if (curr === null || prev === null || prev === 0) return null;
        return Number((((curr - prev) / prev) * 100).toFixed(1));
      };

      const allIntegrations = currentPosts.flatMap(
        (p) => p.platformIntegrations
      );
      const postedCount = allIntegrations.filter(
        (i) => i.status === "POSTED"
      ).length;
      const failedCount = allIntegrations.filter(
        (i) => i.status === "FAILED"
      ).length;
      const publishSuccessRate =
        postedCount + failedCount > 0
          ? Number(
              ((postedCount / (postedCount + failedCount)) * 100).toFixed(1)
            )
          : null;

      // Top platform by published count
      const platformPublishCounts = new Map<string, number>();
      currentPosts
        .filter((p) => p.status === PostStatus.POSTED)
        .forEach((p) =>
          p.platformIntegrations
            .filter((i) => i.status === "POSTED")
            .forEach((i) => {
              const slug = i.userIntegration.integration.slug;
              platformPublishCounts.set(
                slug,
                (platformPublishCounts.get(slug) || 0) + 1
              );
            })
        );
      const topEntry = Array.from(platformPublishCounts.entries()).sort(
        (a, b) => b[1] - a[1]
      )[0];
      const totalPublished = Array.from(platformPublishCounts.values()).reduce(
        (s, v) => s + v,
        0
      );
      const topPlatform = topEntry
        ? {
            platform: topEntry[0],
            label:
              topEntry[0].charAt(0).toUpperCase() + topEntry[0].slice(1),
            published: topEntry[1],
            share:
              totalPublished > 0
                ? Number(((topEntry[1] / totalPublished) * 100).toFixed(1))
                : 0,
          }
        : null;

      // Best time window from postedAt hours
      const hourCounts = new Map<number, number>();
      currentPosts
        .filter((p) => p.postedAt)
        .forEach((p) => {
          const h = new Date(p.postedAt!).getHours();
          hourCounts.set(h, (hourCounts.get(h) || 0) + 1);
        });
      const bestHour = Array.from(hourCounts.entries()).sort(
        (a, b) => b[1] - a[1]
      )[0];
      const bestTimeWindow = bestHour
        ? {
            label: `${bestHour[0]}:00 – ${bestHour[0] + 1}:00`,
            supportingValue: `${bestHour[1]} post${bestHour[1] !== 1 ? "s" : ""} published`,
          }
        : null;

      // ── Trend by date ──────────────────────────────────────────────────────
      const trendMap = new Map<
        string,
        {
          publishedPosts: number;
          successfulPublishes: number;
          failedPublishes: number;
          scheduledPublishes: number;
          reach: number;
          engagement: number;
          impressions: number;
        }
      >();
      let cur = new Date(rangeStart);
      while (cur <= rangeEnd) {
        trendMap.set(cur.toISOString().split("T")[0], {
          publishedPosts: 0,
          successfulPublishes: 0,
          failedPublishes: 0,
          scheduledPublishes: 0,
          reach: 0,
          engagement: 0,
          impressions: 0,
        });
        cur.setDate(cur.getDate() + 1);
      }
      currentPosts.forEach((post) => {
        const dateKey = new Date(post.postedAt || post.createdAt)
          .toISOString()
          .split("T")[0];
        const entry = trendMap.get(dateKey);
        if (!entry) return;
        if (post.status === PostStatus.POSTED) {
          entry.publishedPosts += 1;
          entry.successfulPublishes += post.platformIntegrations.filter(
            (i) => i.status === "POSTED"
          ).length;
          entry.failedPublishes += post.platformIntegrations.filter(
            (i) => i.status === "FAILED"
          ).length;
        } else if (post.status === PostStatus.SCHEDULED) {
          entry.scheduledPublishes += 1;
        }
      });
      platformMetrics.forEach((row) => {
        const dateKey = new Date(row.date).toISOString().split("T")[0];
        const entry = trendMap.get(dateKey);
        if (!entry) return;
        entry.reach += row.totalReach;
        entry.engagement += row.totalEngagement;
        entry.impressions += row.totalImpressions;
      });
      const trend = Array.from(trendMap.entries()).map(([date, d]) => ({
        date,
        publishedPosts: d.publishedPosts,
        successfulPublishes: d.successfulPublishes,
        failedPublishes: d.failedPublishes,
        scheduledPublishes: d.scheduledPublishes,
        reach: d.reach || null,
        engagement: d.engagement || null,
        engagementRate:
          d.impressions > 0 && d.engagement > 0
            ? Number(((d.engagement / d.impressions) * 100).toFixed(2))
            : null,
      }));

      // ── Platform breakdown ─────────────────────────────────────────────────
      const platformMap = new Map<
        string,
        {
          label: string;
          published: number;
          failed: number;
          scheduled: number;
          accounts: Set<string>;
          reach: number;
          engagement: number;
          impressions: number;
        }
      >();
      currentPosts.forEach((post) =>
        post.platformIntegrations.forEach((i) => {
          const slug = i.userIntegration.integration.slug;
          const e = platformMap.get(slug) || {
            label: slug.charAt(0).toUpperCase() + slug.slice(1),
            published: 0,
            failed: 0,
            scheduled: 0,
            accounts: new Set<string>(),
            reach: 0,
            engagement: 0,
            impressions: 0,
          };
          if (i.status === "POSTED") e.published += 1;
          else if (i.status === "FAILED") e.failed += 1;
          else e.scheduled += 1;
          e.accounts.add(i.userIntegrationId);
          platformMap.set(slug, e);
        })
      );
      platformMetrics.forEach((row) => {
        const e = platformMap.get(row.platform);
        if (e) {
          e.reach += row.totalReach;
          e.engagement += row.totalEngagement;
          e.impressions += row.totalImpressions;
        }
      });
      const platformBreakdown = Array.from(platformMap.entries()).map(
        ([platform, d]) => ({
          platform,
          label: d.label,
          published: d.published,
          failed: d.failed,
          scheduled: d.scheduled,
          successRate:
            d.published + d.failed > 0
              ? Number(
                  ((d.published / (d.published + d.failed)) * 100).toFixed(1)
                )
              : null,
          reach: d.reach || null,
          engagement: d.engagement || null,
          engagementRate:
            d.impressions > 0 && d.engagement > 0
              ? Number(((d.engagement / d.impressions) * 100).toFixed(2))
              : null,
          accounts: d.accounts.size,
          followerReach: null,
        })
      );

      // ── Top posts ──────────────────────────────────────────────────────────
      const topPosts = currentPosts
        .filter((p) => p.status === PostStatus.POSTED)
        .map((post) => {
          const platforms = post.platformIntegrations.map(
            (i) => i.userIntegration.integration.slug
          );
          const successfulPublishes = post.platformIntegrations.filter(
            (i) => i.status === "POSTED"
          ).length;
          const failedPublishes = post.platformIntegrations.filter(
            (i) => i.status === "FAILED"
          ).length;
          const postedDateStr = post.postedAt
            ? new Date(post.postedAt).toISOString().split("T")[0]
            : null;
          const dayMetrics = postedDateStr
            ? platformMetrics.filter(
                (r) =>
                  new Date(r.date).toISOString().split("T")[0] === postedDateStr
              )
            : [];
          const reach =
            dayMetrics.reduce((s, r) => s + r.totalReach, 0) || null;
          const engagement =
            dayMetrics.reduce((s, r) => s + r.totalEngagement, 0) || null;
          const score = Math.min(
            100,
            Math.round(
              successfulPublishes * 20 +
                (engagement ? Math.min(engagement / 10, 60) : 0)
            )
          );
          const content = post.content as any;
          const hasMedia =
            Array.isArray(content?.original?.mediaUrls) &&
            content.original.mediaUrls.length > 0;
          return {
            id: post.id,
            title: post.title,
            publishedAt: post.postedAt?.toISOString() || null,
            platforms,
            type: hasMedia ? ("image" as const) : ("text" as const),
            hashtags: [] as string[],
            tagNames: [] as string[],
            successfulPublishes,
            failedPublishes,
            reach,
            engagement,
            engagementRate: null as number | null,
            score,
            scoreLabel:
              score >= 80
                ? "Excellent"
                : score >= 60
                  ? "Good"
                  : score >= 40
                    ? "Average"
                    : "Low",
          };
        })
        .sort((a, b) => b.score - a.score)
        .slice(0, 10);

      // ── Insights ───────────────────────────────────────────────────────────
      const insights: Array<{
        type: "positive" | "warning" | "suggestion";
        title: string;
        description: string;
        actionLabel?: string;
      }> = [];
      if (publishSuccessRate !== null && publishSuccessRate < 80) {
        insights.push({
          type: "warning",
          title: "High publish failure rate",
          description: `${(100 - publishSuccessRate).toFixed(0)}% of posts failed to publish. Check your integration connections.`,
          actionLabel: "Check Integrations",
        });
      }
      if (publishedPosts > previousPosts && previousPosts > 0) {
        const inc = publishedPosts - previousPosts;
        insights.push({
          type: "positive",
          title: "Publishing frequency up",
          description: `You published ${inc} more post${inc !== 1 ? "s" : ""} compared to the previous period.`,
        });
      }
      if (topPlatform) {
        insights.push({
          type: "suggestion",
          title: `${topPlatform.label} is your top platform`,
          description: `${topPlatform.share}% of your published content goes to ${topPlatform.label}. Consider diversifying.`,
        });
      }
      if (futurePosts > 0) {
        insights.push({
          type: "positive",
          title: `${futurePosts} post${futurePosts !== 1 ? "s" : ""} scheduled`,
          description: "You have upcoming scheduled posts ready to publish.",
        });
      }

      const hasPerformanceData = platformMetrics.some(
        (r) =>
          r.totalReach > 0 || r.totalEngagement > 0 || r.totalImpressions > 0
      );

      res.json({
        success: true,
        data: {
          range: {
            preset,
            start: rangeStart.toISOString(),
            end: rangeEnd.toISOString(),
            label: rangeLabel,
            days: daysCount,
          },
          lastSyncedAt: lastSyncRecord?.updatedAt?.toISOString() ?? null,
          metricsAvailability: { performance: hasPerformanceData },
          summaryNote: hasPerformanceData
            ? null
            : "Connect integrations and sync analytics to see performance data.",
          kpis: {
            publishedPosts,
            publishedPostsChange: calcChange(publishedPosts, previousPosts),
            totalReach: totalReachCurrent || null,
            totalReachChange: calcChange(
              totalReachCurrent || null,
              totalReachPrev || null
            ),
            totalEngagement: totalEngagementCurrent || null,
            totalEngagementChange: calcChange(
              totalEngagementCurrent || null,
              totalEngagementPrev || null
            ),
            engagementRate,
            engagementRateChange: calcChange(engagementRate, prevEngagementRate),
            publishSuccessRate,
            publishSuccessRateChange: null,
            topPlatform,
            bestTimeWindow,
            futureScheduledCount: futurePosts,
          },
          trend,
          platformBreakdown,
          topPosts,
          insights,
        },
      });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  }
);

export default router;
