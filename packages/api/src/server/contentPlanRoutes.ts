import express from 'express';
import type { Router, Request, Response } from 'express';
import type { Pool } from 'pg';
import axios from 'axios';
import { randomUUID } from 'crypto';
import { logger } from '../logger.ts';
import { dbQuery } from '../db.ts';
import { getAIConfig, resolveActiveKey, callAINonStreaming, hasAICredits, chargeAICredits, FAST_MODEL, GEMINI_MODELS } from '../ai-helpers.ts';
import { buildSharedAgentContext } from './agentSharedContext.ts';

// ─────────────────────────────────────────────────────────────────────────────
// Auto-content plans.
//
// "Create image promotion content 3× a day for a month" — a plan row holds
// the cadence + topic + end date; the scheduler claims due plans, and each
// run: builds a brief from the brand profile + shared agent context + the
// user's liked-image style profile, writes the copy (Promo agent prompt),
// generates a featured image (Gemini image → OpenAI fallback), saves a draft
// blog post, records the run, and notifies the user. Everything happens in
// the background.
// ─────────────────────────────────────────────────────────────────────────────

type AuthResult = { userId: string; role?: string } | null;

interface Deps {
  requireAuth: (req: Request, res: Response) => AuthResult;
  pool: Pool;
  createNotification: (userId: string, type: string, title: string, message: string, data?: Record<string, any>) => Promise<void>;
  sendPlatformEmail?: (input: { to: string; subject: string; html: string }) => Promise<unknown>;
}

const GOOGLE_BASE = 'https://generativelanguage.googleapis.com/v1beta';

function slugify(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 80) || `post-${Date.now()}`;
}

// ── Featured image generation (Gemini first, OpenAI fallback) ────────────────

async function getPlatformKey(platform: string, field = 'api_key'): Promise<string | null> {
  try {
    const r = await dbQuery<{ config: Record<string, string> }>(`SELECT config FROM platform_configs WHERE platform=$1`, [platform]);
    return r.rows[0]?.config?.[field] ?? null;
  } catch { return null; }
}

async function storeGeneratedImage(base64Data: string, mimeType: string): Promise<string> {
  try {
    const imgbbKey = process.env.IMGBB_API_KEY || (await getPlatformKey('google', 'imgbb_api_key'));
    if (imgbbKey) {
      const params = new URLSearchParams({ key: imgbbKey, image: base64Data });
      const resp = await axios.post('https://api.imgbb.com/1/upload', params.toString(), {
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, timeout: 20_000,
      });
      const url: string = resp.data?.data?.display_url ?? resp.data?.data?.url ?? '';
      if (url) return url;
    }
  } catch (e) { logger.warn({ e }, 'content_plan_imgbb_upload_failed'); }
  return `data:${mimeType};base64,${base64Data}`;
}

export async function generateFeaturedImage(prompt: string): Promise<string | null> {
  // Gemini image (fast, cheap)
  const googleKey = process.env.GOOGLE_API_KEY || process.env.GEMINI_API_KEY || (await getPlatformKey('google'));
  if (googleKey) {
    try {
      const resp = await axios.post(
        `${GOOGLE_BASE}/models/gemini-2.0-flash-exp:generateContent`,
        { contents: [{ parts: [{ text: prompt }] }], generationConfig: { responseModalities: ['IMAGE', 'TEXT'] } },
        { headers: { 'x-goog-api-key': googleKey, 'Content-Type': 'application/json' }, timeout: 60_000 }
      );
      const parts: any[] = resp.data?.candidates?.[0]?.content?.parts ?? [];
      const imgPart = parts.find((p: any) => p.inlineData?.mimeType?.startsWith('image/'));
      if (imgPart) return storeGeneratedImage(imgPart.inlineData.data, imgPart.inlineData.mimeType);
    } catch (e) { logger.warn({ e: e instanceof Error ? e.message : e }, 'content_plan_gemini_image_failed'); }
  }
  // OpenAI fallback
  const openaiKey = process.env.OPENAI_API_KEY || (await getPlatformKey('openai'));
  if (openaiKey) {
    try {
      const resp = await axios.post(
        'https://api.openai.com/v1/images/generations',
        { model: 'dall-e-3', prompt: prompt.slice(0, 3800), n: 1, size: '1024x1024', response_format: 'b64_json' },
        { headers: { Authorization: `Bearer ${openaiKey}`, 'Content-Type': 'application/json' }, timeout: 90_000 }
      );
      const b64: string = resp.data?.data?.[0]?.b64_json ?? '';
      if (b64) return storeGeneratedImage(b64, 'image/png');
    } catch (e) { logger.warn({ e: e instanceof Error ? e.message : e }, 'content_plan_openai_image_failed'); }
  }
  return null;
}

// ── The engine ────────────────────────────────────────────────────────────────

export function buildContentPlanEngine({ pool, createNotification, sendPlatformEmail }: Pick<Deps, 'pool' | 'createNotification' | 'sendPlatformEmail'>) {

  async function likedStyleProfile(userId: string): Promise<string> {
    try {
      const { rows } = await pool.query(
        `SELECT m.model, m.prompt FROM mcp_media_likes l JOIN mcp_media m ON m.id=l.media_id
         WHERE l.user_id=$1 ORDER BY l.created_at DESC LIMIT 5`, [userId]
      );
      if (!rows.length) return '';
      return `Visual style the user likes (from their saved images — imitate the aesthetic, not the subject):\n${rows.map((r: any) => `- [${r.model || 'ai'}] ${String(r.prompt || '').slice(0, 200)}`).join('\n')}`;
    } catch { return ''; }
  }

  async function runPlanOnce(plan: any): Promise<void> {
    const runId = randomUUID();
    try {
      if (!(await hasAICredits(plan.user_id))) {
        await pool.query(
          `INSERT INTO content_plan_runs (id, plan_id, user_id, status, error) VALUES ($1,$2,$3,'skipped','Out of AI credits')`,
          [runId, plan.id, plan.user_id]
        );
        return;
      }
      const aiCfg = await getAIConfig();
      const apiKey = resolveActiveKey(aiCfg);
      if (!apiKey) throw new Error('AI not configured');

      const [sharedCtx, styleProfile] = await Promise.all([
        buildSharedAgentContext(plan.user_id).catch(() => ''),
        plan.use_liked_style ? likedStyleProfile(plan.user_id) : Promise.resolve(''),
      ]);

      const model = aiCfg.provider === 'google'
        ? (GEMINI_MODELS.includes(aiCfg.model) ? aiCfg.model : 'gemini-2.0-flash')
        : FAST_MODEL;
      const raw = await callAINonStreaming(
        aiCfg.provider, apiKey, model,
        `You are Promo, the Promotion & Media Planner on a marketing team. You create scroll-stopping promotional content.${sharedCtx ? `\n\nWorkspace context:\n${sharedCtx}` : ''}${styleProfile ? `\n\n${styleProfile}` : ''}`,
        `Create ONE promotional content piece about: ${plan.topic || 'the user\'s brand and offers'}.
Tone: ${plan.tone}. Piece #${(plan.runs_count ?? 0) + 1} of an ongoing series — vary the angle from typical previous pieces.
Respond ONLY with JSON: {"title": "post title (max 70 chars)", "excerpt": "1-2 sentence hook", "content": "the full post body, 150-350 words, HTML paragraphs allowed", "image_prompt": "a vivid image-generation prompt for the featured visual, under 60 words"}`,
        1200,
        { userId: plan.user_id, feature: 'content_plan' }
      );

      let piece: { title?: string; excerpt?: string; content?: string; image_prompt?: string } = {};
      try {
        piece = JSON.parse(raw.slice(raw.indexOf('{'), raw.lastIndexOf('}') + 1));
      } catch { piece = { title: `Promo — ${new Date().toLocaleDateString()}`, content: raw }; }
      const title = String(piece.title || 'Promotional post').slice(0, 200);

      let imageUrl: string | null = null;
      if (plan.generate_image && piece.image_prompt) {
        imageUrl = await generateFeaturedImage(String(piece.image_prompt));
        if (imageUrl) await chargeAICredits(plan.user_id, 3, 'content_plan_image', { plan_id: plan.id }).catch(() => undefined);
      }

      const postId = randomUUID();
      await pool.query(
        `INSERT INTO blog_posts (id, user_id, title, slug, content, excerpt, featured_image, status)
         VALUES ($1,$2,$3,$4,$5,$6,$7,'draft')`,
        [postId, plan.user_id, title, `${slugify(title)}-${postId.slice(0, 6)}`,
         String(piece.content || ''), String(piece.excerpt || '').slice(0, 500), imageUrl || '']
      );
      await pool.query(
        `INSERT INTO content_plan_runs (id, plan_id, user_id, blog_post_id, title, image_url, status)
         VALUES ($1,$2,$3,$4,$5,$6,'done')`,
        [runId, plan.id, plan.user_id, postId, title, imageUrl]
      );
      await createNotification(
        plan.user_id, 'content_generated',
        `New promo content ready: ${title}`,
        `"${plan.name}" created a draft post${imageUrl ? ' with a featured image' : ''}. Review it in Content → Posts.`,
        { plan_id: plan.id, blog_post_id: postId }
      );
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Generation failed';
      logger.warn({ err, planId: plan.id }, 'content_plan_run_failed');
      await pool.query(
        `INSERT INTO content_plan_runs (id, plan_id, user_id, status, error) VALUES ($1,$2,$3,'failed',$4)
         ON CONFLICT (id) DO NOTHING`,
        [runId, plan.id, plan.user_id, message.slice(0, 300)]
      ).catch(() => undefined);
    }
  }

  // Scheduler tick: complete expired plans (with a wrap-up notification +
  // email), then claim and run due ones. The claim atomically advances
  // next_run_at (24h / per_day), so concurrent instances can't double-run.
  async function processDueContentPlans(): Promise<void> {
    if (!pool) return;
    try {
      const { rows: finished } = await pool.query(
        `UPDATE content_plans SET status='completed', updated_at=NOW()
         WHERE status='active' AND ends_at IS NOT NULL AND ends_at <= NOW() RETURNING *`
      );
      for (const plan of finished) {
        await createNotification(
          plan.user_id, 'content_plan_completed',
          `Content plan finished: ${plan.name}`,
          `All done — ${plan.runs_count} pieces were created. Review your drafts in Content → Posts.`,
          { plan_id: plan.id }
        ).catch(() => undefined);
        if (sendPlatformEmail) {
          try {
            const { rows: u } = await pool.query(`SELECT email FROM users WHERE id=$1`, [plan.user_id]);
            if (u[0]?.email) {
              await sendPlatformEmail({
                to: u[0].email,
                subject: `Your content plan "${plan.name}" is complete`,
                html: `<p>Hi,</p><p>Your automated content plan <b>${plan.name}</b> has finished — <b>${plan.runs_count}</b> promotional pieces were created as drafts.</p><p>Open Content → Posts to review, edit, and publish them.</p>`,
              });
            }
          } catch (err) { logger.warn({ err }, 'content_plan_completion_email_failed'); }
        }
      }

      const { rows: due } = await pool.query(
        `UPDATE content_plans SET
           last_run_at=NOW(), runs_count=runs_count+1, updated_at=NOW(),
           next_run_at = NOW() + make_interval(hours => GREATEST(1, (24.0 / per_day))::int)
         WHERE id IN (
           SELECT id FROM content_plans
           WHERE status='active' AND next_run_at <= NOW() AND (ends_at IS NULL OR ends_at > NOW())
           ORDER BY next_run_at LIMIT 10 FOR UPDATE SKIP LOCKED
         )
         RETURNING *`
      );
      for (const plan of due) {
        await runPlanOnce(plan);
      }
    } catch (err) {
      logger.error({ err }, 'content_plan_tick_failed');
    }
  }

  return { processDueContentPlans, runPlanOnce };
}

// ── Routes (mounted at /api) ─────────────────────────────────────────────────

export function registerContentPlanRoutes(deps: Deps & { runPlanOnce: (plan: any) => Promise<void> }): Router {
  const { requireAuth, pool, runPlanOnce } = deps;
  const router = express.Router();

  router.get('/content-plans', async (req: Request, res: Response) => {
    const auth = requireAuth(req, res); if (!auth) return;
    try {
      const { rows } = await pool.query(
        `SELECT p.*,
           (SELECT COUNT(*) FROM content_plan_runs r WHERE r.plan_id=p.id AND r.status='done') AS pieces_created,
           (SELECT COUNT(*) FROM content_plan_runs r WHERE r.plan_id=p.id AND r.status='failed') AS pieces_failed
         FROM content_plans p WHERE p.user_id=$1 ORDER BY p.created_at DESC`,
        [auth.userId]
      );
      return res.json({ success: true, plans: rows });
    } catch (err) {
      logger.error({ err }, 'content_plans_list_failed');
      return res.status(500).json({ success: false, error: 'Failed to load plans' });
    }
  });

  router.post('/content-plans', async (req: Request, res: Response) => {
    const auth = requireAuth(req, res); if (!auth) return;
    try {
      const b = req.body as Record<string, any>;
      const name = String(b.name || '').trim();
      if (!name) return res.status(400).json({ success: false, error: 'Name is required' });
      const perDay = Math.min(6, Math.max(1, parseInt(String(b.per_day ?? 3), 10) || 3));
      const durationDays = Math.min(90, Math.max(1, parseInt(String(b.duration_days ?? 30), 10) || 30));
      const { rows } = await pool.query(
        `INSERT INTO content_plans (user_id, name, topic, tone, per_day, ends_at, use_liked_style, generate_image, next_run_at)
         VALUES ($1,$2,$3,$4,$5, NOW() + make_interval(days => $6), $7, $8, NOW())
         RETURNING *`,
        [auth.userId, name.slice(0, 120), String(b.topic || '').slice(0, 500), String(b.tone || 'engaging').slice(0, 40),
         perDay, durationDays, b.use_liked_style !== false, b.generate_image !== false]
      );
      return res.json({ success: true, plan: rows[0] });
    } catch (err) {
      logger.error({ err }, 'content_plan_create_failed');
      return res.status(500).json({ success: false, error: 'Failed to create plan' });
    }
  });

  router.patch('/content-plans/:id', async (req: Request, res: Response) => {
    const auth = requireAuth(req, res); if (!auth) return;
    try {
      const status = String((req.body as any)?.status || '');
      if (!['active', 'paused'].includes(status)) return res.status(400).json({ success: false, error: 'status must be active or paused' });
      const { rows } = await pool.query(
        `UPDATE content_plans SET status=$1, updated_at=NOW(),
           next_run_at=CASE WHEN $1='active' AND next_run_at < NOW() THEN NOW() ELSE next_run_at END
         WHERE id=$2 AND user_id=$3 RETURNING *`,
        [status, req.params.id, auth.userId]
      );
      if (!rows.length) return res.status(404).json({ success: false, error: 'Plan not found' });
      return res.json({ success: true, plan: rows[0] });
    } catch (err) {
      logger.error({ err }, 'content_plan_update_failed');
      return res.status(500).json({ success: false, error: 'Failed to update plan' });
    }
  });

  router.delete('/content-plans/:id', async (req: Request, res: Response) => {
    const auth = requireAuth(req, res); if (!auth) return;
    try {
      await pool.query(`DELETE FROM content_plans WHERE id=$1 AND user_id=$2`, [req.params.id, auth.userId]);
      return res.json({ success: true });
    } catch (err) {
      logger.error({ err }, 'content_plan_delete_failed');
      return res.status(500).json({ success: false, error: 'Failed to delete plan' });
    }
  });

  // Run one piece right now (also useful to preview quality before committing
  // to a month of output).
  router.post('/content-plans/:id/run', async (req: Request, res: Response) => {
    const auth = requireAuth(req, res); if (!auth) return;
    try {
      const { rows } = await pool.query(`SELECT * FROM content_plans WHERE id=$1 AND user_id=$2`, [req.params.id, auth.userId]);
      if (!rows.length) return res.status(404).json({ success: false, error: 'Plan not found' });
      await pool.query(`UPDATE content_plans SET runs_count=runs_count+1, last_run_at=NOW(), updated_at=NOW() WHERE id=$1`, [req.params.id]);
      // Background — the notification tells the user when it's done.
      void runPlanOnce(rows[0]).catch(() => undefined);
      return res.status(202).json({ success: true, message: 'Generating in the background — you\'ll get a notification when it\'s ready.' });
    } catch (err) {
      logger.error({ err }, 'content_plan_manual_run_failed');
      return res.status(500).json({ success: false, error: 'Failed to run plan' });
    }
  });

  router.get('/content-plans/:id/runs', async (req: Request, res: Response) => {
    const auth = requireAuth(req, res); if (!auth) return;
    try {
      const { rows } = await pool.query(
        `SELECT * FROM content_plan_runs WHERE plan_id=$1 AND user_id=$2 ORDER BY created_at DESC LIMIT 100`,
        [req.params.id, auth.userId]
      );
      return res.json({ success: true, runs: rows });
    } catch (err) {
      logger.error({ err }, 'content_plan_runs_failed');
      return res.status(500).json({ success: false, error: 'Failed to load runs' });
    }
  });

  return router;
}
