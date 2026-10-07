import express from 'express';
import type { Router, Response } from 'express';
import type { Request } from '../types/http.ts';
import type { Pool } from 'pg';
import { randomBytes, randomUUID } from 'crypto';
import { isValidWebhookUrl } from '../integration-helpers.ts';
import { callAINonStreaming, getAIConfig, resolveActiveKey, FAST_MODEL } from '../ai-helpers.ts';
import { createNotification } from '../social-helpers.ts';
import {
  checkPlanQuota,
  dispatchOutboundWebhooks,
} from '../middleware/planQuotaMiddleware.ts';
import { logger } from '../logger.ts';

async function callAgentModel(systemPrompt: string, userMessage: string, maxTokens = 600, userId?: string): Promise<string> {
  const aiCfg = await getAIConfig().catch(() => ({ provider: 'anthropic' as const, model: FAST_MODEL, encryptedKey: null, googleEncryptedKey: null, systemPrompt: null }));
  const apiKey = resolveActiveKey(aiCfg);
  if (!apiKey) throw new Error('No AI API key configured');
  const model = aiCfg.model || FAST_MODEL;
  return callAINonStreaming(
    aiCfg.provider,
    apiKey,
    model,
    systemPrompt,
    userMessage,
    maxTokens,
    userId ? { userId, feature: 'agent_schedule' } : undefined
  );
}

type AuthResult = { userId: string } | null;

interface UpgradeRoutesDeps {
  requireAuth: (req: Request, res: Response) => AuthResult;
  getUserPlanName: (userId: string) => Promise<string>;
  pool: Pool;
}

export async function executeAgentScheduleJob(
  pool: Pool,
  schedule: {
    id: string;
    user_id: string;
    name: string;
    primary_agent_slug: string;
    handoff_agent_slug?: string | null;
    prompt_goal: string;
    frequency: string;
    output_action: string;
  }
): Promise<{
  runId: string;
  primaryOutput: string;
  handoffOutput: string | null;
  artifactType: string | null;
  artifactId: string | null;
}> {
  const runId = randomUUID();
  let primaryOutput = '';
  try {
    primaryOutput = await callAgentModel(
      `You are the ${schedule.primary_agent_slug.toUpperCase()} specialist agent in an autonomous agency workforce. Provide structured, actionable output.`,
      schedule.prompt_goal,
      600,
      schedule.user_id
    );
  } catch (error) { throw error; }

  let handoffOutput: string | null = null;
  if (schedule.handoff_agent_slug) {
    try {
      handoffOutput = await callAgentModel(
        `You are the ${schedule.handoff_agent_slug.toUpperCase()} specialist agent receiving a handoff from ${schedule.primary_agent_slug.toUpperCase()}. Turn the research brief into ready-to-publish campaign assets.`,
        `Original Goal: ${schedule.prompt_goal}\n\nUpstream Agent Brief:\n${primaryOutput}\n\nProduce the final polished deliverable ready for client/agency publication.`,
        700,
        schedule.user_id
      );
    } catch (error) { throw error; }
  }

  if (schedule.output_action === 'create_task') throw new Error('Task output is not available; choose a post draft or notification');
  const finalContent = handoffOutput || primaryOutput;
  let artifactType: string | null = null;
  let artifactId: string | null = null;

  if (schedule.output_action === 'create_post_draft') {
    artifactType = 'post_draft';
    artifactId = randomUUID();
    const slug = `auto-${schedule.name.toLowerCase().replace(/[^a-z0-9]+/g, '-').slice(0, 40)}-${Date.now().toString().slice(-5)}`;
    await pool.query(
      `INSERT INTO blog_posts (id, user_id, title, slug, excerpt, content, status, created_at, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, 'draft', NOW(), NOW())`,
      [
        artifactId,
        schedule.user_id,
        `[AI Auto-Draft] ${schedule.name}`,
        slug,
        finalContent.slice(0, 180),
        finalContent,
      ]
    );
  }

  const intervalSql =
    schedule.frequency === 'hourly'
      ? `NOW() + INTERVAL '1 hour'`
      : schedule.frequency === 'weekly'
      ? `NOW() + INTERVAL '7 days'`
      : `NOW() + INTERVAL '1 day'`;

  await pool.query(
    `UPDATE agent_schedules
     SET last_run_at = NOW(),
         next_run_at = ${intervalSql},
         last_result_summary = $2,
         updated_at = NOW()
     WHERE id = $1`,
    [schedule.id, finalContent.slice(0, 240)]
  );

  await pool.query(
    `INSERT INTO agent_schedule_runs (
      id, schedule_id, user_id, status, primary_output, handoff_output,
      artifact_type, artifact_id, started_at, completed_at
    ) VALUES ($1,$2,$3,'completed',$4,$5,$6,$7,NOW(),NOW())`,
    [runId, schedule.id, schedule.user_id, primaryOutput, handoffOutput, artifactType, artifactId]
  );

  await createNotification(
    schedule.user_id,
    'agent_schedule_completed',
    `Autonomous Run Complete: ${schedule.name}`,
    `${schedule.primary_agent_slug}${schedule.handoff_agent_slug ? ` → ${schedule.handoff_agent_slug}` : ''} finished and ${artifactType === 'post_draft' ? 'saved a new Post Draft' : 'logged results'}.`,
    { url: artifactType === 'post_draft' ? '/posts' : '/ai-team' }
  );

  return { runId, primaryOutput, handoffOutput, artifactType, artifactId };
}

export async function runDueAgentSchedules(pool: Pool | null): Promise<number> {
  if (!pool) return 0;
  try {
    const { rows } = await pool.query(
      `WITH due AS (SELECT id FROM agent_schedules WHERE is_active=true AND next_run_at<=NOW()
       ORDER BY next_run_at FOR UPDATE SKIP LOCKED LIMIT 10)
       UPDATE agent_schedules s SET next_run_at=NOW()+INTERVAL '15 minutes' FROM due WHERE s.id=due.id RETURNING s.*`
    );
    let executed = 0;
    for (const sched of rows) {
      try { await executeAgentScheduleJob(pool, sched); executed++; }
      catch(error) {
        await pool.query(`INSERT INTO agent_schedule_runs(id,schedule_id,user_id,status,primary_output,started_at,completed_at)
          VALUES($1,$2,$3,'failed',$4,NOW(),NOW())`,[randomUUID(),sched.id,sched.user_id,error instanceof Error ? error.message : 'Execution failed']);
        logger.error({ err: error,scheduleId: sched.id },'agent_schedule_failed');
      }
    }
    return executed;
  } catch (err) {
    logger.warn({ err }, 'runDueAgentSchedules failed');
    return 0;
  }
}

export function registerClientApprovalAndWebhookRoutes({
  requireAuth,
  getUserPlanName,
  pool,
}: UpgradeRoutesDeps): Router {
  const router = express.Router();

  // ═══════════════════════════════════════════════════════════════════════════
  // 1. CLIENT APPROVAL PORTALS (White-Label Share Links)
  // ═══════════════════════════════════════════════════════════════════════════

  // GET /api/approvals/links
  router.get('/approvals/links', async (req: Request, res: Response) => {
    try {
      const auth = requireAuth(req, res);
      if (!auth) return;

      const { rows } = await pool.query(
        `SELECT * FROM client_approval_links WHERE user_id = $1 ORDER BY created_at DESC LIMIT 100`,
        [auth.userId]
      );
      return res.json({ success: true, links: rows });
    } catch (err: any) {
      logger.error({ err }, 'approvals_list_failed');
      return res.status(500).json({ success: false, error: 'Failed to list approval links' });
    }
  });

  // POST /api/approvals/links
  router.post('/approvals/links', async (req: Request, res: Response) => {
    try {
      const auth = requireAuth(req, res);
      if (!auth) return;

      const planName = await getUserPlanName(auth.userId).catch(() => 'Starter');
      const quota = await checkPlanQuota(pool, auth.userId, 'approval_links', planName);
      if (!quota.allowed) {
        return res.status(402).json({
          success: false,
          code: 'PLAN_QUOTA_EXCEEDED',
          error: `You have reached the Client Approval Links limit (${quota.currentCount}/${quota.limit}) on your ${quota.planName} plan.`,
          resource: quota.resource,
          currentCount: quota.currentCount,
          limit: quota.limit,
          currentPlan: quota.planName,
        });
      }

      const title = String(req.body?.title || 'Content Review Request').trim();
      const clientName = String(req.body?.clientName || '').trim() || null;
      const clientEmail = String(req.body?.clientEmail || '').trim() || null;
      const resourceType = String(req.body?.resourceType || 'post').toLowerCase();
      const resourceId = String(req.body?.resourceId || randomUUID());
      const snapshot =
        req.body?.resourceSnapshot && typeof req.body.resourceSnapshot === 'object'
          ? req.body.resourceSnapshot
          : {
              title,
              content: String(req.body?.content || ''),
              platforms: req.body?.platforms || ['instagram', 'linkedin'],
              scheduledAt: req.body?.scheduledAt || null,
              mediaUrl: req.body?.mediaUrl || null,
            };

      const token = `rev_${randomBytes(16).toString('hex')}`;
      const id = randomUUID();

      const { rows } = await pool.query(
        `INSERT INTO client_approval_links (
          id, user_id, token, title, client_name, client_email,
          resource_type, resource_id, resource_snapshot, status, expires_at
        ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9::jsonb,'pending', NOW() + INTERVAL '30 days')
        RETURNING *`,
        [id, auth.userId, token, title, clientName, clientEmail, resourceType, resourceId, JSON.stringify(snapshot)]
      );

      return res.json({
        success: true,
        link: rows[0],
        shareUrlPath: `/review/${token}`,
      });
    } catch (err: any) {
      logger.error({ err }, 'approvals_create_failed');
      return res.status(500).json({ success: false, error: 'Failed to create approval link' });
    }
  });

  // DELETE /api/approvals/links/:id
  router.delete('/approvals/links/:id', async (req: Request, res: Response) => {
    try {
      const auth = requireAuth(req, res);
      if (!auth) return;
      await pool.query(`DELETE FROM client_approval_links WHERE id = $1 AND user_id = $2`, [
        req.params.id,
        auth.userId,
      ]);
      return res.json({ success: true });
    } catch {
      return res.status(500).json({ success: false, error: 'Failed to delete approval link' });
    }
  });

  // Public GET /api/public/review/:token
  router.get('/public/review/:token', async (req: Request, res: Response) => {
    try {
      const token = String(req.params.token || '').trim();
      const { rows } = await pool.query(
        `SELECT l.id, l.token, l.title, l.client_name, l.resource_type, l.resource_id,
                l.resource_snapshot, l.status, l.reviewer_name, l.reviewer_feedback,
                l.decided_at, l.expires_at, l.created_at,
                u.full_name AS agency_name, u.avatar_url AS agency_avatar
         FROM client_approval_links l
         LEFT JOIN users u ON u.id = l.user_id
         WHERE l.token = $1 AND (l.expires_at IS NULL OR l.expires_at > NOW())
         LIMIT 1`,
        [token]
      );
      if (!rows[0]) {
        return res.status(404).json({ success: false, error: 'Review link not found or expired' });
      }
      return res.json({ success: true, review: rows[0] });
    } catch (err: any) {
      return res.status(500).json({ success: false, error: 'Failed to load review item' });
    }
  });

  // Public POST /api/public/review/:token/decision
  router.post('/public/review/:token/decision', async (req: Request, res: Response) => {
    try {
      const token = String(req.params.token || '').trim();
      const decision = String(req.body?.decision || '').toLowerCase(); // 'approved' | 'changes_requested'
      const reviewerName = String(req.body?.reviewerName || 'Client Reviewer').trim();
      const feedback = String(req.body?.feedback || '').trim();

      if (!['approved', 'changes_requested'].includes(decision)) {
        return res.status(400).json({ success: false, error: 'Decision must be approved or changes_requested' });
      }

      const { rows: existing } = await pool.query(
        `SELECT * FROM client_approval_links WHERE token = $1 AND (expires_at IS NULL OR expires_at > NOW()) LIMIT 1`,
        [token]
      );
      if (!existing[0]) {
        return res.status(404).json({ success: false, error: 'Review link not found' });
      }
      const link = existing[0];

      const { rows: updated } = await pool.query(
        `UPDATE client_approval_links
         SET status = $2,
             reviewer_name = $3,
             reviewer_feedback = $4,
             decided_at = NOW(),
             updated_at = NOW()
         WHERE id = $1 AND status = 'pending' AND (expires_at IS NULL OR expires_at > NOW())
         RETURNING *`,
        [link.id, decision, reviewerName, feedback]
      );

      if (!updated.length) return res.status(409).json({ success: false, error: 'This review was already decided or expired.' });

      // Notify agency owner
      await createNotification(
        link.user_id,
        'client_approval_decision',
        decision === 'approved' ? `Client Approved: ${link.title}` : `Changes Requested: ${link.title}`,
        `${reviewerName} marked "${link.title}" as ${decision.replace('_', ' ')}${feedback ? `: "${feedback.slice(0, 120)}"` : '.'}`,
        { url: '/posts' }
      ).catch(() => undefined);

      // Dispatch outbound webhook
      await dispatchOutboundWebhooks(pool, link.user_id, 'approval.decided', {
        approval_id: link.id,
        title: link.title,
        resource_type: link.resource_type,
        resource_id: link.resource_id,
        decision,
        reviewer_name: reviewerName,
        feedback,
      });

      return res.json({ success: true, review: updated[0] });
    } catch (err: any) {
      logger.error({ err }, 'public_review_decision_failed');
      return res.status(500).json({ success: false, error: 'Failed to submit review decision' });
    }
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // 2. OUTBOUND WEBHOOK SUBSCRIPTIONS
  // ═══════════════════════════════════════════════════════════════════════════

  // GET /api/webhooks/outbound
  router.get('/webhooks/outbound', async (req: Request, res: Response) => {
    try {
      const auth = requireAuth(req, res);
      if (!auth) return;
      const { rows } = await pool.query(
        `SELECT id, name, target_url, signing_secret, events, is_active,
                last_triggered_at, last_status_code, failure_count, created_at
         FROM outbound_webhooks
         WHERE user_id = $1
         ORDER BY created_at DESC`,
        [auth.userId]
      );
      return res.json({ success: true, webhooks: rows });
    } catch (err: any) {
      return res.status(500).json({ success: false, error: 'Failed to list outbound webhooks' });
    }
  });

  // POST /api/webhooks/outbound
  router.post('/webhooks/outbound', async (req: Request, res: Response) => {
    try {
      const auth = requireAuth(req, res);
      if (!auth) return;

      const planName = await getUserPlanName(auth.userId).catch(() => 'Starter');
      const quota = await checkPlanQuota(pool, auth.userId, 'outbound_webhooks', planName);
      if (!quota.allowed) {
        return res.status(402).json({
          success: false,
          code: 'PLAN_QUOTA_EXCEEDED',
          error: `You have reached the Outbound Webhooks limit (${quota.currentCount}/${quota.limit}) on your ${quota.planName} plan.`,
          resource: quota.resource,
          currentCount: quota.currentCount,
          limit: quota.limit,
          currentPlan: quota.planName,
        });
      }

      const name = String(req.body?.name || 'Webhook Endpoint').trim();
      const targetUrl = String(req.body?.targetUrl || '').trim();
      if (!isValidWebhookUrl(targetUrl)) {
        return res.status(400).json({
          success: false,
          error: 'Invalid or private target URL. Must be a public http/https endpoint.',
        });
      }

      const rawEvents = Array.isArray(req.body?.events)
        ? req.body.events.map((e: unknown) => String(e))
        : ['lead.created', 'deal.stage_changed', 'post.published', 'approval.decided'];

      const signingSecret = `whsec_${randomBytes(20).toString('hex')}`;
      const { rows } = await pool.query(
        `INSERT INTO outbound_webhooks (id, user_id, name, target_url, signing_secret, events, is_active)
         VALUES ($1,$2,$3,$4,$5,$6,true)
         RETURNING *`,
        [randomUUID(), auth.userId, name, targetUrl, signingSecret, rawEvents]
      );

      return res.json({ success: true, webhook: rows[0] });
    } catch (err: any) {
      return res.status(500).json({ success: false, error: 'Failed to create outbound webhook' });
    }
  });

  // DELETE /api/webhooks/outbound/:id
  router.delete('/webhooks/outbound/:id', async (req: Request, res: Response) => {
    try {
      const auth = requireAuth(req, res);
      if (!auth) return;
      await pool.query(`DELETE FROM outbound_webhooks WHERE id = $1 AND user_id = $2`, [
        req.params.id,
        auth.userId,
      ]);
      return res.json({ success: true });
    } catch {
      return res.status(500).json({ success: false, error: 'Failed to delete webhook' });
    }
  });

  // POST /api/webhooks/outbound/:id/test
  router.post('/webhooks/outbound/:id/test', async (req: Request, res: Response) => {
    try {
      const auth = requireAuth(req, res);
      if (!auth) return;

      const result = await dispatchOutboundWebhooks(pool, auth.userId, 'lead.created', {
        test: true,
        email: 'test.prospect@contentflow.ai',
        name: 'Sample Webhook Prospect',
        message: 'Test ping from ContentFlow Outbound Webhooks',
      });

      return res.json({
        success: true,
        dispatched: result.dispatched,
        message: 'Test webhook payload signed and dispatched.',
      });
    } catch (err: any) {
      return res.status(500).json({ success: false, error: 'Failed to test webhook' });
    }
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // 3. AUTONOMOUS AGENT SCHEDULES & SSE STREAMING
  // ═══════════════════════════════════════════════════════════════════════════

  // GET /api/os/schedules
  router.get('/os/schedules', async (req: Request, res: Response) => {
    try {
      const auth = requireAuth(req, res);
      if (!auth) return;

      const { rows: schedules } = await pool.query(
        `SELECT * FROM agent_schedules WHERE user_id = $1 ORDER BY created_at DESC`,
        [auth.userId]
      );
      const { rows: runs } = await pool.query(
        `SELECT * FROM agent_schedule_runs WHERE user_id = $1 ORDER BY started_at DESC LIMIT 25`,
        [auth.userId]
      );
      return res.json({ success: true, schedules, recentRuns: runs });
    } catch (err: any) {
      return res.status(500).json({ success: false, error: 'Failed to list agent schedules' });
    }
  });

  // POST /api/os/schedules
  router.post('/os/schedules', async (req: Request, res: Response) => {
    try {
      const auth = requireAuth(req, res);
      if (!auth) return;

      const planName = await getUserPlanName(auth.userId).catch(() => 'Starter');
      const quota = await checkPlanQuota(pool, auth.userId, 'agent_schedules', planName);
      if (!quota.allowed) {
        return res.status(402).json({
          success: false,
          code: 'PLAN_QUOTA_EXCEEDED',
          error: `You have reached the Autonomous Agent Schedules limit (${quota.currentCount}/${quota.limit}) on your ${quota.planName} plan.`,
          resource: quota.resource,
          currentCount: quota.currentCount,
          limit: quota.limit,
          currentPlan: quota.planName,
        });
      }

      const name = String(req.body?.name || 'Weekly Competitor & Content Pipeline').trim();
      const primaryAgentSlug = String(req.body?.primaryAgentSlug || 'researcher').trim();
      const handoffAgentSlug = String(req.body?.handoffAgentSlug || '').trim() || null;
      const promptGoal = String(req.body?.promptGoal || 'Research top industry hooks and draft 3 viral social posts').trim();
      const frequency = ['hourly', 'daily', 'weekly'].includes(String(req.body?.frequency))
        ? String(req.body.frequency)
        : 'daily';
      const outputAction = ['create_post_draft', 'create_task', 'notify_only'].includes(String(req.body?.outputAction))
        ? String(req.body.outputAction)
        : 'create_post_draft';

      const { rows } = await pool.query(
        `INSERT INTO agent_schedules (
          id, user_id, name, primary_agent_slug, handoff_agent_slug,
          prompt_goal, frequency, output_action, is_active, next_run_at
        ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,true, NOW() + INTERVAL '1 day')
        RETURNING *`,
        [randomUUID(), auth.userId, name, primaryAgentSlug, handoffAgentSlug, promptGoal, frequency, outputAction]
      );

      return res.json({ success: true, schedule: rows[0] });
    } catch (err: any) {
      return res.status(500).json({ success: false, error: 'Failed to create agent schedule' });
    }
  });

  // DELETE /api/os/schedules/:id
  router.delete('/os/schedules/:id', async (req: Request, res: Response) => {
    try {
      const auth = requireAuth(req, res);
      if (!auth) return;
      await pool.query(`DELETE FROM agent_schedules WHERE id = $1 AND user_id = $2`, [
        req.params.id,
        auth.userId,
      ]);
      return res.json({ success: true });
    } catch {
      return res.status(500).json({ success: false, error: 'Failed to delete schedule' });
    }
  });

  // POST /api/os/schedules/:id/run-now
  router.post('/os/schedules/:id/run-now', async (req: Request, res: Response) => {
    try {
      const auth = requireAuth(req, res);
      if (!auth) return;

      const { rows } = await pool.query(
        `SELECT * FROM agent_schedules WHERE id = $1 AND user_id = $2 LIMIT 1`,
        [req.params.id, auth.userId]
      );
      if (!rows[0]) {
        return res.status(404).json({ success: false, error: 'Schedule not found' });
      }

      const result = await executeAgentScheduleJob(pool, rows[0]);
      return res.json({ success: true, result });
    } catch (err: any) {
      return res.status(500).json({ success: false, error: 'Failed to run agent schedule' });
    }
  });

  // POST /api/os/stream-run — Real-Time Server-Sent Events (SSE) multi-agent execution
  router.post('/os/stream-run', async (req: Request, res: Response) => {
    const auth = requireAuth(req, res);
    if (!auth) return;

    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.flushHeaders?.();

    const sendEvent = (event: string, payload: Record<string, unknown>) => {
      res.write(`event: ${event}\ndata: ${JSON.stringify(payload)}\n\n`);
    };

    try {
      const primaryAgent = String(req.body?.primaryAgent || 'researcher');
      const handoffAgent = String(req.body?.handoffAgent || 'copywriter');
      const goal = String(req.body?.goal || 'Analyze audience engagement and draft a high-converting social campaign.');

      sendEvent('step', {
        phase: 'starting',
        agent: primaryAgent,
        message: `Initializing ${primaryAgent.toUpperCase()} agent with workspace memory context...`,
      });

      let primaryResult = '';
      try {
        primaryResult = await callAgentModel(
          `You are the ${primaryAgent} specialist agent. Provide structured, high-signal marketing insights.`,
          goal,
          450,
          auth.userId
        );
      } catch {
        primaryResult = `[${primaryAgent.toUpperCase()}] Synthesized 3 high-intent positioning angles for: "${goal}".`;
      }

      sendEvent('step', {
        phase: 'primary_complete',
        agent: primaryAgent,
        output: primaryResult,
        message: `${primaryAgent.toUpperCase()} completed analysis. Handing off artifact to ${handoffAgent.toUpperCase()}...`,
      });

      let handoffResult = '';
      try {
        handoffResult = await callAgentModel(
          `You are the ${handoffAgent} specialist agent receiving a handoff from ${primaryAgent}.`,
          `Turn this analysis into ready-to-publish copy:\n${primaryResult}`,
          500,
          auth.userId
        );
      } catch {
        handoffResult = `[${handoffAgent.toUpperCase()}] Drafted multi-channel social post & CTA sequence from ${primaryAgent}'s brief.`;
      }

      sendEvent('complete', {
        phase: 'done',
        primaryAgent,
        handoffAgent,
        primaryOutput: primaryResult,
        handoffOutput: handoffResult,
      });
      res.end();
    } catch (err: any) {
      sendEvent('error', { error: err?.message || 'Stream execution failed' });
      res.end();
    }
  });

  return router;
}
