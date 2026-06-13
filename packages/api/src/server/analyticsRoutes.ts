import { Router } from 'express';
import type { AnalyticsDeps } from './analytics/helpers.ts';
import { createSyncHelpers } from './analytics/syncHelpers.ts';
import { registerSocialAccountRoutes } from './analytics/socialAccountRoutes.ts';
import { registerTikTokRoutes } from './analytics/tiktokRoutes.ts';
import { registerFacebookRoutes } from './analytics/facebookRoutes.ts';
import { registerInstagramRoutes } from './analytics/instagramRoutes.ts';
import { registerPinterestRoutes } from './analytics/pinterestRoutes.ts';
import { registerThreadsRoutes } from './analytics/threadsRoutes.ts';
import { registerLinkedInAnalyticsRoutes } from './analytics/linkedinAnalyticsRoutes.ts';
import { registerAdapterRoutes } from './analytics/adapterRoutes.ts';

export type { AnalyticsDeps };

export function registerAnalyticsRoutes(deps: AnalyticsDeps): Router {
  const router = Router();

  function decodeStoredIntegrationSecret(value: string | null | undefined): string {
    const raw = String(value || '').trim();
    if (!raw) return '';
    try { return deps.decryptIntegrationSecret(raw); } catch { return ''; }
  }

  const syncHelpers = createSyncHelpers(deps.pool, decodeStoredIntegrationSecret);

  registerSocialAccountRoutes(router, deps);
  registerTikTokRoutes(router, deps);
  registerFacebookRoutes(router, deps);
  registerInstagramRoutes(router, deps, syncHelpers);
  registerPinterestRoutes(router, deps, syncHelpers);
  registerThreadsRoutes(router, deps, syncHelpers);
  registerLinkedInAnalyticsRoutes(router, deps);
  registerAdapterRoutes(router, deps);

  return router;
}
