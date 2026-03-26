import { API_BASE_URL } from '../utils/apiBase';

const ANALYTICS_FALLBACK_API_BASE_URL = 'https://contentflow-api-production.up.railway.app';

function getToken() {
  return localStorage.getItem('auth_token') || '';
}

function safeJsonParse(text: string) {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

async function parseApiResponse<T>(res: Response): Promise<T> {
  const text = await res.text();
  const parsed = text ? safeJsonParse(text) : null;
  if (!res.ok) {
    const errorMessage = parsed?.error || parsed?.message || text || 'Request failed';
    throw new Error(typeof errorMessage === 'string' ? errorMessage : 'Request failed');
  }
  if (text && parsed === null) {
    throw new Error('Invalid server response');
  }
  return (parsed ?? {}) as T;
}

function getAnalyticsApiCandidates() {
  const candidates = [API_BASE_URL];
  if (typeof window !== 'undefined') {
    candidates.push(window.location.origin.replace(/\/$/, ''));
  }
  candidates.push(ANALYTICS_FALLBACK_API_BASE_URL);
  return Array.from(new Set(candidates.filter(Boolean)));
}

async function fetchAnalyticsResponse(path: string, _expected: 'json' | 'file') {
  const candidates = getAnalyticsApiCandidates();
  let lastNetworkError: Error | null = null;

  for (const [index, base] of candidates.entries()) {
    const isLast = index === candidates.length - 1;
    try {
      const res = await fetch(`${base}${path}`, {
        headers: { Authorization: `Bearer ${getToken()}` },
      });
      const contentType = String(res.headers.get('content-type') || '').toLowerCase();
      const looksLikeHtml = contentType.includes('text/html');
      if (res.ok && !(looksLikeHtml && !isLast)) {
        return res;
      }
      if (!isLast && (res.status === 404 || res.status >= 500 || looksLikeHtml)) {
        continue;
      }
      return res;
    } catch (error) {
      lastNetworkError = error instanceof Error ? error : new Error('Analytics API is unreachable right now.');
      if (isLast) throw lastNetworkError;
    }
  }

  throw lastNetworkError || new Error('Analytics API is unreachable right now.');
}

export type AnalyticsRangePreset = '7d' | '30d' | '90d' | 'custom';

export type BlogAnalyticsDashboard = {
  range: {
    preset: AnalyticsRangePreset;
    start: string;
    end: string;
    label: string;
    days: number;
  };
  metricsAvailability: {
    performance: boolean;
  };
  summaryNote: string | null;
  kpis: {
    publishedPosts: number;
    publishedPostsChange: number | null;
    totalReach: number | null;
    totalReachChange: number | null;
    totalEngagement: number | null;
    totalEngagementChange: number | null;
    engagementRate: number | null;
    engagementRateChange: number | null;
    publishSuccessRate: number | null;
    publishSuccessRateChange: number | null;
    topPlatform: {
      platform: string;
      label: string;
      published: number;
      share: number;
    } | null;
    bestTimeWindow: {
      label: string;
      supportingValue: string;
    } | null;
    futureScheduledCount: number;
  };
  trend: Array<{
    date: string;
    publishedPosts: number;
    successfulPublishes: number;
    failedPublishes: number;
    scheduledPublishes: number;
    reach: number | null;
    engagement: number | null;
    engagementRate: number | null;
  }>;
  platformBreakdown: Array<{
    platform: string;
    label: string;
    published: number;
    failed: number;
    scheduled: number;
    successRate: number | null;
    reach: number | null;
    engagement: number | null;
    engagementRate: number | null;
    accounts: number;
    followerReach: number | null;
  }>;
  topPosts: Array<{
    id: string;
    title: string;
    publishedAt: string | null;
    platforms: string[];
    type: 'image' | 'text';
    hashtags: string[];
    tagNames: string[];
    successfulPublishes: number;
    failedPublishes: number;
    reach: number | null;
    engagement: number | null;
    engagementRate: number | null;
    score: number;
    scoreLabel: string;
  }>;
  insights: Array<{
    type: 'positive' | 'warning' | 'suggestion';
    title: string;
    description: string;
    actionLabel?: string;
    actionHref?: string;
  }>;
};

export type DashboardQuery = {
  preset?: AnalyticsRangePreset;
  start?: string;
  end?: string;
};

export const blogAnalyticsService = {
  async fetchDashboard(query: DashboardQuery): Promise<BlogAnalyticsDashboard> {
    const params = new URLSearchParams();
    if (query.preset) params.set('preset', query.preset);
    if (query.start) params.set('start', query.start);
    if (query.end) params.set('end', query.end);

    const res = await fetchAnalyticsResponse(`/api/analytics/dashboard?${params.toString()}`, 'json');
    const payload = await parseApiResponse<{ success?: boolean; data?: BlogAnalyticsDashboard }>(res);
    if (!payload.data) {
      throw new Error('Analytics dashboard was empty');
    }
    return payload.data;
  },

  async exportDashboard(query: DashboardQuery): Promise<Blob> {
    const params = new URLSearchParams();
    if (query.preset) params.set('preset', query.preset);
    if (query.start) params.set('start', query.start);
    if (query.end) params.set('end', query.end);

    const res = await fetchAnalyticsResponse(`/api/analytics/export?${params.toString()}`, 'file');
    if (!res.ok) {
      const text = await res.text();
      throw new Error(text || 'Export failed');
    }
    return res.blob();
  },
};
