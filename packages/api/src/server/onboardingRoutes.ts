import express from 'express';
import type { Router, Request, Response } from 'express';
import { invalidateSharedContext } from './agentSharedContext.ts';

type AuthResult = { userId: string; role?: string } | null;

interface OnboardingDeps {
  requireAuth: (req: Request, res: Response) => AuthResult;
  dbQuery: <T = any>(sql: string, params?: unknown[]) => Promise<{ rows: T[] }>;
  hasDatabase: () => boolean;
  triggerAgentCompilation: (userId: string) => Promise<void>;
  createNotification: (userId: string, type: string, title: string, message: string, data?: Record<string, any>, pinned?: boolean) => Promise<void>;
  checkTaskActions: (userId: string, actionType: string) => Promise<unknown[]>;
}

const str = (v: unknown, max = 500): string => (typeof v === 'string' ? v.trim().slice(0, max) : '');
const strList = (v: unknown, max = 12): string[] =>
  Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string' && x.trim().length > 0).map((x) => x.trim().slice(0, 60)).slice(0, max) : [];

export function registerOnboardingRoutes({
  requireAuth,
  dbQuery,
  hasDatabase,
  triggerAgentCompilation,
  createNotification,
  checkTaskActions,
}: OnboardingDeps): Router {
  const router = express.Router();

  // GET /api/onboarding — completion status + saved answers
  router.get('/onboarding', async (req: Request, res: Response) => {
    const auth = requireAuth(req, res);
    if (!auth) return;
    if (!hasDatabase()) return res.json({ success: true, completed: true, skipped: false, data: {} });
    try {
      const r = await dbQuery<{ onboarding: Record<string, any> | null }>(
        `SELECT onboarding FROM users WHERE id = $1`,
        [auth.userId]
      );
      const data = r.rows[0]?.onboarding ?? {};
      return res.json({
        success: true,
        completed: Boolean(data.completed_at),
        skipped: Boolean(data.skipped_at),
        data,
      });
    } catch (e: any) {
      return res.status(500).json({ success: false, error: e.message });
    }
  });

  // POST /api/onboarding — save answers, seed the AI memory, recompile agents
  router.post('/onboarding', async (req: Request, res: Response) => {
    const auth = requireAuth(req, res);
    if (!auth) return;
    if (!hasDatabase()) return res.json({ success: true, memoriesCreated: 0 });

    const body = (req.body ?? {}) as Record<string, unknown>;
    const brandName = str(body.brandName, 120);
    const website = str(body.website, 200);
    const industry = str(body.industry, 80);
    const offering = str(body.offering);
    const audience = str(body.audience);
    const tones = strList(body.tones);
    const goals = strList(body.goals);
    const platforms = strList(body.platforms);

    // Each answered question becomes a memory entry the agents compile into context.
    const entries: { category: string; title: string; content: string }[] = [];
    if (brandName) entries.push({ category: 'brand', title: 'Brand name', content: website ? `${brandName} (${website})` : brandName });
    if (industry || offering) entries.push({ category: 'business', title: 'What we do', content: [industry, offering].filter(Boolean).join(' — ') });
    if (audience) entries.push({ category: 'audience', title: 'Target audience', content: audience });
    if (tones.length) entries.push({ category: 'brand', title: 'Tone of voice', content: tones.join(', ') });
    if (goals.length) entries.push({ category: 'content', title: 'Marketing goals', content: goals.join(', ') });
    if (platforms.length) entries.push({ category: 'social', title: 'Priority platforms', content: platforms.join(', ') });

    try {
      const answers = {
        brandName, website, industry, offering, audience, tones, goals, platforms,
        completed_at: new Date().toISOString(),
      };
      await dbQuery(`UPDATE users SET onboarding = $2::jsonb WHERE id = $1`, [auth.userId, JSON.stringify(answers)]);
      if (website) {
        await dbQuery(`UPDATE users SET website = COALESCE(NULLIF(website, ''), $2) WHERE id = $1`, [auth.userId, website]).catch(() => undefined);
      }

      if (entries.length) {
        // Re-running onboarding replaces the entries it owns instead of duplicating them.
        await dbQuery(
          `DELETE FROM user_memories WHERE user_id = $1 AND source = 'manual' AND title = ANY($2)`,
          [auth.userId, entries.map((e) => e.title)]
        );
        for (const e of entries) {
          await dbQuery(
            `INSERT INTO user_memories (user_id, category, title, content, source) VALUES ($1, $2, $3, $4, 'manual')`,
            [auth.userId, e.category, e.title, e.content]
          );
        }
        triggerAgentCompilation(auth.userId).catch(() => undefined);
        invalidateSharedContext(auth.userId);
        void checkTaskActions(auth.userId, 'save_memory');
        createNotification(
          auth.userId, 'onboarding_complete',
          'Your AI team is briefed',
          `${entries.length} brand ${entries.length === 1 ? 'fact' : 'facts'} saved to memory${brandName ? ` — every agent now personalizes for ${brandName}` : ''}. Refine anytime on the Memory page.`,
        ).catch(() => undefined);
      }

      return res.json({ success: true, memoriesCreated: entries.length });
    } catch (e: any) {
      return res.status(500).json({ success: false, error: e.message });
    }
  });

  // POST /api/onboarding/skip — remember the dismissal across devices
  router.post('/onboarding/skip', async (req: Request, res: Response) => {
    const auth = requireAuth(req, res);
    if (!auth) return;
    if (!hasDatabase()) return res.json({ success: true });
    try {
      await dbQuery(
        `UPDATE users SET onboarding = COALESCE(onboarding, '{}'::jsonb) || jsonb_build_object('skipped_at', NOW()) WHERE id = $1`,
        [auth.userId]
      );
      return res.json({ success: true });
    } catch (e: any) {
      return res.status(500).json({ success: false, error: e.message });
    }
  });

  return router;
}
