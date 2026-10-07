import express from 'express';
import type { Router, Response } from 'express';
import type { Request } from '../types/http.ts';
import type { Pool } from 'pg';
import { ensureCreditAccount, chargeAICredits, grantCredits, CREDIT_TOPUP_PACKS, getTokenEfficiencyTelemetry } from '../ai-helpers.ts';
import { buildPaystackService, PaymentError, type ConfigReader } from './paystackService.ts';
import { recordAuditLog } from '../link-metadata.ts';

type AuthResult = { userId: string; role?: string } | null;

interface CreditsDeps {
  requireAuth: (req: Request, res: Response) => AuthResult;
  requireAdmin: (req: Request, res: Response) => Promise<AuthResult>;
  hasDatabase: () => boolean;
  pool: Pool;
  getPlatformConfig: ConfigReader;
}

export function registerCreditsRoutes({ requireAuth, requireAdmin, hasDatabase, pool, getPlatformConfig }: CreditsDeps): Router {
  const router = express.Router();

  // GET /api/credits/balance — lazily creates the account at the plan
  // allowance and applies the monthly reset when reset_date has passed.
  router.get('/credits/balance', async (req: Request, res: Response) => {
    const auth = requireAuth(req, res);
    if (!auth) return;
    try {
      const { credits, resetDate, autoRecharge, autoRechargePack } = await ensureCreditAccount(auth.userId);
      return res.json({
        success: true,
        credits,
        autoRecharge: { enabled: Boolean(autoRecharge), packId: autoRechargePack, threshold: 50 },
        tokenEfficiency: getTokenEfficiencyTelemetry(),
        reset_date: resetDate,
        auto_recharge: Boolean(autoRecharge),
        auto_recharge_pack: autoRechargePack || 'starter',
        token_efficiency: getTokenEfficiencyTelemetry(),
      });
    } catch (e: any) {
      return res.status(e instanceof PaymentError ? e.status : 500).json({ success: false, error: e instanceof PaymentError ? e.message : 'Unable to complete credit operation' });
    }
  });

  // GET /api/credits/packs — available Pay-As-You-Go AI credit top-up packs + telemetry
  router.get('/credits/packs', async (req: Request, res: Response) => {
    const auth = requireAuth(req, res);
    if (!auth) return;
    const account = await ensureCreditAccount(auth.userId).catch(() => ({ credits: 100, resetDate: null, autoRecharge: false, autoRechargePack: 'starter' }));
    return res.json({
      success: true,
      packs: CREDIT_TOPUP_PACKS,
      account,
      tokenEfficiency: getTokenEfficiencyTelemetry(),
    });
  });

  // POST /api/credits/purchase — purchase a never-expiring AI credit pack (with Idempotency-Key protection)
  router.post('/credits/purchase', async (req: Request, res: Response) => {
    const auth = requireAuth(req, res);
    if (!auth) return;
    const packId = String(req.body?.packId || 'starter').toLowerCase();
    const pack = CREDIT_TOPUP_PACKS.find((p) => p.id === packId);
    if (!pack) {
      return res.status(400).json({ success: false, error: 'Invalid credit pack ID. Choose starter, growth, or agency.' });
    }
    try {
      if (!hasDatabase()) return res.status(503).json({ success: false, error: 'Database unavailable' });
      const payments = buildPaystackService({ pool, readConfig: getPlatformConfig });
      return res.json({ success: true, ...await payments.checkout(auth.userId, 'credits', pack.id) });
    } catch (e: any) {
      return res.status(e instanceof PaymentError ? e.status : 500).json({ success: false, error: e instanceof PaymentError ? e.message : 'Unable to complete credit operation' });
    }
  });

  // PUT /api/credits/auto-recharge — toggle automatic credit top-up when balance drops below 50
  router.put('/credits/auto-recharge', async (req: Request, res: Response) => {
    const auth = requireAuth(req, res);
    if (!auth) return;
    const enabled = Boolean(req.body?.enabled);
    if (enabled) return res.status(409).json({ success: false, error: 'Automatic recharge is not enabled. Buy credits through verified Paystack checkout.' });
    const packId = String(req.body?.packId || 'starter').toLowerCase();
    try {
      await pool.query(
        `UPDATE user_credits SET auto_recharge=$2, auto_recharge_pack=$3, updated_at=NOW() WHERE user_id=$1`,
        [auth.userId, enabled, packId]
      ).catch(() => undefined);
      return res.json({
        success: true,
        auto_recharge: enabled,
        auto_recharge_pack: packId,
        autoRecharge: { enabled, packId, threshold: 50 },
      });
    } catch (e: any) {
      return res.status(e instanceof PaymentError ? e.status : 500).json({ success: false, error: e instanceof PaymentError ? e.message : 'Unable to complete credit operation' });
    }
  });

  // GET /api/credits/history — the user's own credit ledger
  router.get('/credits/history', async (req: Request, res: Response) => {
    const auth = requireAuth(req, res);
    if (!auth) return;
    try {
      const { rows } = await pool.query(
        `SELECT delta, balance_after, reason, meta, created_at FROM credit_ledger
         WHERE user_id = $1 ORDER BY created_at DESC LIMIT 100`,
        [auth.userId]
      );
      return res.json({ success: true, entries: rows });
    } catch (e: any) {
      return res.status(e instanceof PaymentError ? e.status : 500).json({ success: false, error: e instanceof PaymentError ? e.message : 'Unable to complete credit operation' });
    }
  });

  // POST /api/credits/use — spend credits (frontend-initiated features).
  router.post('/credits/use', async (req: Request, res: Response) => {
    const auth = requireAuth(req, res);
    if (!auth) return;
    const rawAmount = Number((req.body as { amount?: unknown })?.amount ?? 5);
    if (!Number.isFinite(rawAmount) || !Number.isInteger(rawAmount) || rawAmount < 1 || rawAmount > 500) {
      return res.status(400).json({ success: false, error: 'amount must be an integer between 1 and 500' });
    }
    const reason = String((req.body as { reason?: unknown })?.reason ?? 'feature_use').slice(0, 60);
    try {
      const { credits } = await ensureCreditAccount(auth.userId);
      if (credits <= 0) return res.status(402).json({ success: false, error: 'Out of credits', credits: 0 });
      await chargeAICredits(auth.userId, rawAmount, reason, { source: 'credits_use_endpoint' });
      const after = await ensureCreditAccount(auth.userId);
      return res.json({ success: true, credits: after.credits });
    } catch (e: any) {
      return res.status(e instanceof PaymentError ? e.status : 500).json({ success: false, error: e instanceof PaymentError ? e.message : 'Unable to complete credit operation' });
    }
  });

  // POST /api/credits/admin/grant
  router.post('/credits/admin/grant', async (req: Request, res: Response) => {
    const admin = await requireAdmin(req, res);
    if (!admin) return;
    if (!hasDatabase()) return res.json({ success: true });
    const { user_id, email, amount } = req.body as { user_id?: string; email?: string; amount: number };
    const amt = Number(amount);
    if ((!user_id && !email) || !Number.isInteger(amt) || amt < 1 || amt > 1_000_000) {
      return res.status(400).json({ success: false, error: 'user_id or email, and a positive integer amount required' });
    }
    try {
      let resolvedId = user_id;
      if (!resolvedId && email) {
        const r = await pool.query(`SELECT id FROM users WHERE email = $1 LIMIT 1`, [email.trim().toLowerCase()]);
        if (!r.rows[0]) return res.status(404).json({ success: false, error: `No user found with email: ${email}` });
        resolvedId = r.rows[0].id;
      }
      const balance = await grantCredits(resolvedId!, amt, 'admin_grant', { granted_by: (admin as any).id ?? 'admin' });
      void recordAuditLog((admin as any).id, 'admin_credits_granted', [], { targetUserId: resolvedId, amount: amt });
      return res.json({ success: true, user_id: resolvedId, credits: balance });
    } catch (e: any) {
      return res.status(e instanceof PaymentError ? e.status : 500).json({ success: false, error: e instanceof PaymentError ? e.message : 'Unable to complete credit operation' });
    }
  });

  // POST /api/credits/admin/grant-all
  router.post('/credits/admin/grant-all', async (req: Request, res: Response) => {
    const admin = await requireAdmin(req, res);
    if (!admin) return;
    if (!hasDatabase()) return res.json({ success: true, updated: 0 });
    const amt = Number((req.body as { amount?: unknown })?.amount);
    if (!Number.isInteger(amt) || amt < 1 || amt > 1_000_000) {
      return res.status(400).json({ success: false, error: 'amount must be a positive integer' });
    }
    try {
      const result = await pool.query(
        `INSERT INTO user_credits (user_id, credits, reset_date, updated_at)
         SELECT id, $1, date_trunc('month', NOW()) + INTERVAL '1 month', NOW() FROM users
         ON CONFLICT (user_id) DO UPDATE SET credits = user_credits.credits + $1, updated_at = NOW()`,
        [amt]
      );
      void recordAuditLog((admin as any).id, 'admin_credits_granted_all', [], { amount: amt, updated: result.rowCount });
      return res.json({ success: true, updated: result.rowCount });
    } catch (e: any) {
      return res.status(e instanceof PaymentError ? e.status : 500).json({ success: false, error: e instanceof PaymentError ? e.message : 'Unable to complete credit operation' });
    }
  });

  // POST /api/card-templates/:id/view
  router.post('/card-templates/:id/view', async (req: Request, res: Response) => {
    const auth = requireAuth(req, res);
    if (!auth) return;
    if (!hasDatabase()) return res.json({ success: true, view_count: 0 });
    const { id } = req.params;
    try {
      const { rows } = await pool.query<{ view_count: number }>(
        `UPDATE card_templates SET view_count = view_count + 1 WHERE id = $1 RETURNING view_count`,
        [id]
      );
      return res.json({ success: true, view_count: rows[0]?.view_count ?? 0 });
    } catch (e: any) {
      return res.status(e instanceof PaymentError ? e.status : 500).json({ success: false, error: e instanceof PaymentError ? e.message : 'Unable to complete credit operation' });
    }
  });

  // POST /api/card-templates/:id/like
  router.post('/card-templates/:id/like', async (req: Request, res: Response) => {
    const auth = requireAuth(req, res);
    if (!auth) return;
    if (!hasDatabase()) return res.json({ success: true, liked: true, like_count: 0 });
    const { id } = req.params;
    try {
      const existing = await pool.query(
        'SELECT 1 FROM design_likes WHERE user_id = $1 AND design_id = $2 AND design_type = $3',
        [auth.userId, id, 'template']
      );
      let liked: boolean;
      if (existing.rows.length > 0) {
        await pool.query('DELETE FROM design_likes WHERE user_id = $1 AND design_id = $2', [auth.userId, id]);
        await pool.query(`UPDATE card_templates SET like_count = GREATEST(0, like_count - 1) WHERE id = $1`, [id]);
        liked = false;
      } else {
        await pool.query(
          'INSERT INTO design_likes (user_id, design_id, design_type) VALUES ($1, $2, $3) ON CONFLICT DO NOTHING',
          [auth.userId, id, 'template']
        );
        await pool.query(`UPDATE card_templates SET like_count = like_count + 1 WHERE id = $1`, [id]);
        liked = true;
      }
      const { rows } = await pool.query<{ like_count: number }>('SELECT like_count FROM card_templates WHERE id = $1', [id]);
      return res.json({ success: true, liked, like_count: rows[0]?.like_count ?? 0 });
    } catch (e: any) {
      return res.status(e instanceof PaymentError ? e.status : 500).json({ success: false, error: e instanceof PaymentError ? e.message : 'Unable to complete credit operation' });
    }
  });

  // POST /api/user-designs/:id/like
  router.post('/user-designs/:id/like', async (req: Request, res: Response) => {
    const auth = requireAuth(req, res);
    if (!auth) return;
    if (!hasDatabase()) return res.json({ success: true, liked: true, like_count: 0 });
    const { id } = req.params;
    try {
      const existing = await pool.query(
        'SELECT 1 FROM design_likes WHERE user_id = $1 AND design_id = $2 AND design_type = $3',
        [auth.userId, id, 'user']
      );
      let liked: boolean;
      if (existing.rows.length > 0) {
        await pool.query('DELETE FROM design_likes WHERE user_id = $1 AND design_id = $2', [auth.userId, id]);
        await pool.query(`UPDATE user_designs SET like_count = GREATEST(0, like_count - 1) WHERE id = $1`, [id]);
        liked = false;
      } else {
        await pool.query(
          'INSERT INTO design_likes (user_id, design_id, design_type) VALUES ($1, $2, $3) ON CONFLICT DO NOTHING',
          [auth.userId, id, 'user']
        );
        await pool.query(`UPDATE user_designs SET like_count = like_count + 1 WHERE id = $1`, [id]);
        liked = true;
      }
      const { rows } = await pool.query<{ like_count: number }>('SELECT like_count FROM user_designs WHERE id = $1', [id]);
      return res.json({ success: true, liked, like_count: rows[0]?.like_count ?? 0 });
    } catch (e: any) {
      return res.status(e instanceof PaymentError ? e.status : 500).json({ success: false, error: e instanceof PaymentError ? e.message : 'Unable to complete credit operation' });
    }
  });

  // GET /api/user-designs/likes
  router.get('/user-designs/likes', async (req: Request, res: Response) => {
    const auth = requireAuth(req, res);
    if (!auth) return;
    if (!hasDatabase()) return res.json({ success: true, liked_ids: [] });
    try {
      const { rows } = await pool.query<{ design_id: string }>(
        `SELECT design_id FROM design_likes WHERE user_id = $1 AND design_type = 'user'`,
        [auth.userId]
      );
      return res.json({ success: true, liked_ids: rows.map((r) => r.design_id) });
    } catch (e: any) {
      return res.status(e instanceof PaymentError ? e.status : 500).json({ success: false, error: e instanceof PaymentError ? e.message : 'Unable to complete credit operation' });
    }
  });

  // GET /api/user-designs/:id/liked
  router.get('/user-designs/:id/liked', async (req: Request, res: Response) => {
    const auth = requireAuth(req, res);
    if (!auth) return;
    if (!hasDatabase()) return res.json({ liked: false });
    const { id } = req.params;
    try {
      const { rows } = await pool.query(
        `SELECT 1 FROM design_likes WHERE user_id = $1 AND design_id = $2 AND design_type = 'user'`,
        [auth.userId, id]
      );
      return res.json({ liked: rows.length > 0 });
    } catch (e: any) {
      return res.status(e instanceof PaymentError ? e.status : 500).json({ success: false, error: e instanceof PaymentError ? e.message : 'Unable to complete credit operation' });
    }
  });

  return router;
}
