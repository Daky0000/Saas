import express from 'express';
import type { Router, Request, Response } from 'express';
import type { Pool } from 'pg';
import axios from 'axios';
import { randomUUID } from 'crypto';
import { logger } from '../logger.ts';
import { dbQuery } from '../db.ts';
import { getAIConfig, resolveActiveKey, callAINonStreaming, hasAICredits, chargeAICredits, ensureCreditAccount, FAST_MODEL, GEMINI_MODELS } from '../ai-helpers.ts';
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

// Credit estimate for a whole plan — shown before starting and enforced at
// creation. Per piece: ~2 credits copy + 1 QA review; images add 3 each
// (image_mode 'auto' assumes roughly two thirds of pieces get one).
export function estimatePlanCredits(perDay: number, durationDays: number, imageMode: string): number {
  const pieces = Math.max(1, perDay) * Math.max(1, durationDays);
  const perPieceText = 3;
  const perPieceImage = imageMode === 'always' ? 3 : imageMode === 'never' ? 0 : 2;
  return pieces * (perPieceText + perPieceImage);
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

      const [sharedCtx, styleProfile, socials] = await Promise.all([
        buildSharedAgentContext(plan.user_id).catch(() => ''),
        plan.use_liked_style ? likedStyleProfile(plan.user_id) : Promise.resolve(''),
        pool.query(`SELECT DISTINCT platform FROM social_accounts WHERE user_id=$1 AND connected=true`, [plan.user_id])
          .then(r => r.rows.map((x: any) => String(x.platform))).catch(() => [] as string[]),
      ]);
      const platformLine = socials.length
        ? `Target platforms (the user's connected socials): ${socials.join(', ')}. Write for these channels.`
        : 'No social platforms connected yet — write a platform-neutral promotional post.';

      const topicLine = plan.ai_recommended
        ? `Choose the promotional angle YOURSELF: from the user's personalization (memories, brand, goals, audience) pick the content most likely to achieve their goals right now. Do not pick randomly — justify the choice to yourself from their data.`
        : `Create content about: ${plan.topic || 'the user\'s brand and offers'}.`;

      const imageMode = String(plan.image_mode || (plan.generate_image ? 'auto' : 'never'));
      const imageLine = imageMode === 'never'
        ? 'This piece will not have a featured image.'
        : imageMode === 'always'
          ? 'This piece MUST include a featured image — provide image_prompt.'
          : 'Decide whether this piece needs a featured image for its target platforms (set needs_image accordingly). Not every post needs one.';

      const model = aiCfg.provider === 'google'
        ? (GEMINI_MODELS.includes(aiCfg.model) ? aiCfg.model : 'gemini-2.0-flash')
        : FAST_MODEL;
      const raw = await callAINonStreaming(
        aiCfg.provider, apiKey, model,
        `You are Promo, the Promotion & Media Planner on a marketing team. You create scroll-stopping promotional content.${sharedCtx ? `\n\nWorkspace context (personalization — always respect it):\n${sharedCtx}` : ''}${styleProfile ? `\n\n${styleProfile}` : ''}${plan.custom_instructions ? `\n\nUSER'S STANDING INSTRUCTIONS FOR THIS PLAN (highest priority):\n${String(plan.custom_instructions).slice(0, 1500)}` : ''}`,
        `${topicLine}
${platformLine}
${imageLine}
Tone: ${plan.tone}. Piece #${(plan.runs_count ?? 0) + 1} of an ongoing series — vary the angle from typical previous pieces.
Respond ONLY with JSON: {"title": "post title (max 70 chars)", "excerpt": "1-2 sentence hook", "content": "the full post body, 150-350 words, HTML paragraphs allowed", "needs_image": true/false, "image_prompt": "vivid image-generation prompt under 60 words (empty string if needs_image is false)"}`,
        1400,
        { userId: plan.user_id, feature: 'content_plan' }
      );

      let piece: { title?: string; excerpt?: string; content?: string; needs_image?: boolean; image_prompt?: string } = {};
      try {
        piece = JSON.parse(raw.slice(raw.indexOf('{'), raw.lastIndexOf('}') + 1));
      } catch { piece = { title: `Promo — ${new Date().toLocaleDateString()}`, content: raw }; }

      // Quality gate: Vetta reviews the piece against the personalization and
      // the user's instructions before anything is saved.
      try {
        const qaRaw = await callAINonStreaming(
          aiCfg.provider, apiKey, model,
          `You are Vetta, the Quality Control agent. Review marketing content against the user's brand, audience, goals and instructions. Fix what's weak; keep what works.${sharedCtx ? `\n\nUser context:\n${sharedCtx}` : ''}${plan.custom_instructions ? `\n\nUser's instructions: ${String(plan.custom_instructions).slice(0, 800)}` : ''}`,
          `Review this piece and respond ONLY with JSON {"approved": true/false, "title": "...", "excerpt": "...", "content": "..."} — return the fields improved if needed, unchanged if already strong.\n\n${JSON.stringify({ title: piece.title, excerpt: piece.excerpt, content: piece.content })}`,
          1400,
          { userId: plan.user_id, feature: 'content_plan_qa' }
        );
        const qa = JSON.parse(qaRaw.slice(qaRaw.indexOf('{'), qaRaw.lastIndexOf('}') + 1));
        if (qa && typeof qa === 'object') {
          if (typeof qa.title === 'string' && qa.title.trim()) piece.title = qa.title;
          if (typeof qa.excerpt === 'string' && qa.excerpt.trim()) piece.excerpt = qa.excerpt;
          if (typeof qa.content === 'string' && qa.content.trim()) piece.content = qa.content;
        }
      } catch (err) { logger.warn({ err, planId: plan.id }, 'content_plan_qa_skipped'); }

      const title = String(piece.title || 'Promotional post').slice(0, 200);

      let imageUrl: string | null = null;
      const wantsImage = imageMode === 'always' || (imageMode === 'auto' && piece.needs_image !== false && Boolean(piece.image_prompt));
      if (wantsImage && piece.image_prompt) {
        imageUrl = await generateFeaturedImage(String(piece.image_prompt));
        if (imageUrl) await chargeAICredits(plan.user_id, 3, 'content_plan_image', { plan_id: plan.id }).catch(() => undefined);
      }

      // Scheduled (not draft) so the piece shows on the calendar; the 3-hour
      // buffer is the review window before it goes out.
      const postId = randomUUID();
      const scheduledAt = new Date(Date.now() + 3 * 60 * 60 * 1000);
      await pool.query(
        `INSERT INTO blog_posts (id, user_id, title, slug, content, excerpt, featured_image, status, scheduled_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,'scheduled',$8)`,
        [postId, plan.user_id, title, `${slugify(title)}-${postId.slice(0, 6)}`,
         String(piece.content || ''), String(piece.excerpt || '').slice(0, 500), imageUrl || '', scheduledAt.toISOString()]
      );
      await pool.query(
        `INSERT INTO content_plan_runs (id, plan_id, user_id, blog_post_id, title, image_url, status)
         VALUES ($1,$2,$3,$4,$5,$6,'done')`,
        [runId, plan.id, plan.user_id, postId, title, imageUrl]
      );
      await createNotification(
        plan.user_id, 'content_generated',
        `New promo content ready: ${title}`,
        `"${plan.name}" created a post${imageUrl ? ' with a featured image' : ''}, scheduled for ${scheduledAt.toLocaleString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })} — it's on your calendar. Review or reschedule it in Content → Posts.`,
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

  // GET /api/content-plans/estimate — credit cost + current balance for the UI
  router.get('/content-plans/estimate', async (req: Request, res: Response) => {
    const auth = requireAuth(req, res); if (!auth) return;
    try {
      const perDay = Math.min(6, Math.max(1, parseInt(String(req.query.per_day ?? 3), 10) || 3));
      const durationDays = Math.min(90, Math.max(1, parseInt(String(req.query.duration_days ?? 30), 10) || 30));
      const imageMode = ['always', 'never', 'auto'].includes(String(req.query.image_mode)) ? String(req.query.image_mode) : 'auto';
      const credits = estimatePlanCredits(perDay, durationDays, imageMode);
      const { credits: balance } = await ensureCreditAccount(auth.userId);
      return res.json({ success: true, estimated_credits: credits, balance, sufficient: balance >= credits });
    } catch (err) {
      return res.status(500).json({ success: false, error: err instanceof Error ? err.message : 'Estimate failed' });
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
      const imageMode = ['always', 'never', 'auto'].includes(String(b.image_mode)) ? String(b.image_mode) : 'auto';
      const aiRecommended = Boolean(b.ai_recommended);
      if (!aiRecommended && !String(b.topic || '').trim()) {
        return res.status(400).json({ success: false, error: 'Describe what to promote, or switch on AI recommended' });
      }

      // Credit gate: the whole plan must be affordable up front.
      const estimate = estimatePlanCredits(perDay, durationDays, imageMode);
      const { credits: balance } = await ensureCreditAccount(auth.userId);
      if (balance < estimate) {
        return res.status(402).json({
          success: false,
          error: `This plan needs about ${estimate} credits but you have ${balance}. Reduce the cadence/duration or top up.`,
          estimated_credits: estimate, balance,
        });
      }

      const { rows } = await pool.query(
        `INSERT INTO content_plans (user_id, name, topic, tone, per_day, ends_at, use_liked_style, generate_image, image_mode, ai_recommended, custom_instructions, estimated_credits, next_run_at)
         VALUES ($1,$2,$3,$4,$5, NOW() + make_interval(days => $6), $7, $8, $9, $10, $11, $12, NOW())
         RETURNING *`,
        [auth.userId, name.slice(0, 120), String(b.topic || '').slice(0, 500), String(b.tone || 'engaging').slice(0, 40),
         perDay, durationDays, b.use_liked_style !== false, imageMode !== 'never', imageMode, aiRecommended,
         String(b.custom_instructions || '').slice(0, 2000), estimate]
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
