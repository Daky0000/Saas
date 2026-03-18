import { useCallback, useState } from "react";
import api from "../utils/api";

export type AnalyticsSummary = {
  totalPosts: number;
  totalReach: number;
  totalImpressions: number;
  totalEngagement: number;
  engagementRate: number;
  growthRate: number;
};

export type AnalyticsOverview = {
  dateRange: { start: string; end: string };
  summary: AnalyticsSummary;
  platforms: Array<{
    platform: string;
    reach: number;
    impressions: number;
    engagement: number;
    engagementRate: number;
  }>;
  topPlatforms: Array<{ platform: string; engagement: number }>;
  trends: Array<{ date: string; totalEngagement: number; totalReach: number; totalImpressions?: number }>;
};

export type PlatformMetric = {
  platform: string;
  accountName?: string;
  metrics: any;
};

export type TrendData = {
  engagementTrend: Array<{ date: string; value: number }>;
  reachTrend: Array<{ date: string; value: number }>;
  impressionsTrend: Array<{ date: string; value: number }>;
  topPosts: any[];
  topPlatforms: any[];
};

export type ComparisonData = {
  thisMonth: any;
  lastMonth: any;
  change: any;
};

const getErrorMessage = (error: any) =>
  error?.response?.data?.error || error?.message || "Something went wrong";

export const useAnalytics = () => {
  const [analyticsData, setAnalyticsData] = useState<AnalyticsOverview | null>(
    null
  );
  const [platformMetrics, setPlatformMetrics] = useState<PlatformMetric[]>([]);
  const [topPosts, setTopPosts] = useState<any[]>([]);
  const [trends, setTrends] = useState<TrendData | null>(null);
  const [comparison, setComparison] = useState<ComparisonData | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selectedDays, setSelectedDaysState] = useState<30 | 60>(30);

  const run = useCallback(async <T,>(fn: () => Promise<T>) => {
    setLoading(true);
    setError(null);
    try {
      return await fn();
    } catch (err: any) {
      setError(getErrorMessage(err));
      throw err;
    } finally {
      setLoading(false);
    }
  }, []);

  const getOverviewAnalytics = useCallback(
    async (days: 30 | 60) => {
      const data = await run(async () => {
        const resp = await api.get<AnalyticsOverview>("/analytics/overview", {
          params: { days },
        });
        return resp.data;
      });
      setAnalyticsData(data);
      return data;
    },
    [run]
  );

  const getPlatformMetrics = useCallback(
    async (days: 30 | 60) => {
      const data = await run(async () => {
        const resp = await api.get<PlatformMetric[]>("/analytics/platforms", {
          params: { days },
        });
        return resp.data;
      });
      setPlatformMetrics(data);
      return data;
    },
    [run]
  );

  const getPlatformDetails = useCallback(
    async (platform: string, days: 30 | 60) => {
      return run(async () => {
        const resp = await api.get(`/analytics/platforms/${platform}`, {
          params: { days },
        });
        return resp.data;
      });
    },
    [run]
  );

  const getTopContent = useCallback(
    async (days: 30 | 60, limit = 10) => {
      const data = await run(async () => {
        const resp = await api.get<any[]>("/analytics/posts", {
          params: { days, limit },
        });
        return resp.data;
      });
      setTopPosts(data);
      return data;
    },
    [run]
  );

  const getTrends = useCallback(
    async (days: 30 | 60) => {
      const data = await run(async () => {
        const resp = await api.get<TrendData>("/analytics/trending", {
          params: { days },
        });
        return resp.data;
      });
      setTrends(data);
      return data;
    },
    [run]
  );

  const getComparison = useCallback(async () => {
    const data = await run(async () => {
      const resp = await api.get<ComparisonData>("/analytics/comparison");
      return resp.data;
    });
    setComparison(data);
    return data;
  }, [run]);

  const getPostMetrics = useCallback(
    async (postId: string) => {
      return run(async () => {
        const resp = await api.get(`/analytics/posts/${postId}`);
        return resp.data;
      });
    },
    [run]
  );

  const refreshAnalytics = useCallback(async () => {
    return run(async () => {
      const resp = await api.post("/analytics/refresh");
      return resp.data;
    });
  }, [run]);

  const exportAnalytics = useCallback(
    async (format: "csv" | "pdf", days: 30 | 60) => {
      const resp = await api.get(`/analytics/export`, {
        params: { format, days },
        responseType: "blob",
      });
      const url = window.URL.createObjectURL(resp.data);
      const link = document.createElement("a");
      link.href = url;
      link.download = `analytics.${format}`;
      link.click();
      window.URL.revokeObjectURL(url);
    },
    []
  );

  const setSelectedDays = useCallback(
    (days: 30 | 60) => {
      setSelectedDaysState(days);
      void Promise.all([
        getOverviewAnalytics(days),
        getPlatformMetrics(days),
        getTopContent(days),
        getTrends(days),
        getComparison(),
      ]);
    },
    [getOverviewAnalytics, getPlatformMetrics, getTopContent, getTrends, getComparison]
  );

  return {
    analyticsData,
    platformMetrics,
    topPosts,
    trends,
    comparison,
    loading,
    error,
    selectedDays,
    getOverviewAnalytics,
    getPlatformMetrics,
    getPlatformDetails,
    getTopContent,
    getTrends,
    getComparison,
    getPostMetrics,
    refreshAnalytics,
    exportAnalytics,
    setSelectedDays,
  };
};
