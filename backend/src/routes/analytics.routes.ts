import { Router, Response } from "express";
import { authMiddleware, AuthRequest } from "../middleware/auth.middleware";
import { AnalyticsService } from "../services/analytics.service";
import { AnalyticsSyncService } from "../services/analytics-sync.service";
import { PrismaClient } from "@prisma/client";

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

export default router;
