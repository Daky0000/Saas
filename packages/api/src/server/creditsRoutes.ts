import express from 'express';
import type { Router, Request, Response } from 'express';
import type { Pool } from 'pg';

type AuthResult = { userId: string; role?: string } | null;

interface CreditsDeps {
  requireAuth: (req: Request, res: Response) => AuthResult;
  requireAdmin: (req: Request, res: Response) => Promise<AuthResult>;
  hasDatabase: () => boolean;
  pool: Pool;
}

export function registerCreditsRoutes({ requireAuth, requireAdmin, hasDatabase, pool }: CreditsDeps): Router {
  const router = express.Router();

  // GET /api/credits/balance
  router.get('/credits/balance', async (req: Request, res: Response) => {
    const auth = requireAuth(req, res);
    if (!auth) return;
    if (!hasDatabase()) return res.json({ success: true, credits: 100, reset_date: null });
    try {
      const { rows } = await pool.query<{ credits: number; reset_date: string }>(
        'SELECT credits, reset_date FROM user_credits WHERE user_id = $1',
        [auth.userId]
      );
      if (rows.length === 0) {
        await pool.query(
          `INSERT INTO user_credits (user_id, credits, reset_date, updated_at)
           VALUES ($1, 100, date_trunc('month', NOW()) + INTERVAL '1 month', NOW())
           ON CONFLICT (user_id) DO NOTHING`,
          [auth.userId]
        );
        return res.json({ success: true, credits: 100, reset_date: null });
      }
      return res.json({ success: true, credits: rows[0].credits, reset_date: rows[0].reset_date });
    } catch (e: any) {
      return res.status(500).json({ success: false, error: e.message });
    }
  });

  // POST /api/credits/use
  router.post('/credits/use', async (req: Request, res: Response) => {
    const auth = requireAuth(req, res);
    if (!auth) return;
    if (!hasDatabase()) return res.json({ success: true, credits: 50 });
    const { amount = 5 } = req.body as { amount?: number };
    try {
      const { rows } = await pool.query<{ credits: number }>(
        `UPDATE user_credits SET credits = GREATEST(0, credits - $1), updated_at = NOW()
         WHERE user_id = $2 RETURNING credits`,
        [amount, auth.userId]
      );
      if (rows.length === 0) return res.status(404).json({ success: false, error: 'No credit account found' });
      return res.json({ success: true, credits: rows[0].credits });
    } catch (e: any) {
      return res.status(500).json({ success: false, error: e.message });
    }
  });

  // POST /api/credits/admin/grant
  router.post('/credits/admin/grant', async (req: Request, res: Response) => {
    const admin = await requireAdmin(req, res);
    if (!admin) return;
    if (!hasDatabase()) return res.json({ success: true });
    const { user_id, email, amount } = req.body as { user_id?: string; email?: string; amount: number };
    if ((!user_id && !email) || !amount) return res.status(400).json({ success: false, error: 'user_id or email, and amount required' });
    try {
      let resolvedId = user_id;
      if (!resolvedId && email) {
        const r = await pool.query(`SELECT id FROM users WHERE email = $1 LIMIT 1`, [email.trim().toLowerCase()]);
        if (!r.rows[0]) return res.status(404).json({ success: false, error: `No user found with email: ${email}` });
        resolvedId = r.rows[0].id;
      }
      await pool.query(
        `INSERT INTO user_credits (user_id, credits, reset_date, updated_at)
         VALUES ($1, $2, date_trunc('month', NOW()) + INTERVAL '1 month', NOW())
         ON CONFLICT (user_id) DO UPDATE SET credits = user_credits.credits + $2, updated_at = NOW()`,
        [resolvedId, amount]
      );
      return res.json({ success: true, user_id: resolvedId });
    } catch (e: any) {
      return res.status(500).json({ success: false, error: e.message });
    }
  });

  // POST /api/credits/admin/grant-all
  router.post('/credits/admin/grant-all', async (req: Request, res: Response) => {
    const admin = await requireAdmin(req, res);
    if (!admin) return;
    if (!hasDatabase()) return res.json({ success: true, updated: 0 });
    const { amount } = req.body as { amount: number };
    if (!amount || amount <= 0) return res.status(400).json({ success: false, error: 'amount must be positive' });
    try {
      const result = await pool.query(
        `INSERT INTO user_credits (user_id, credits, reset_date, updated_at)
         SELECT id, $1, date_trunc('month', NOW()) + INTERVAL '1 month', NOW() FROM users
         ON CONFLICT (user_id) DO UPDATE SET credits = user_credits.credits + $1, updated_at = NOW()`,
        [amount]
      );
      return res.json({ success: true, updated: result.rowCount });
    } catch (e: any) {
      return res.status(500).json({ success: false, error: e.message });
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
      return res.status(500).json({ success: false, error: e.message });
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
      return res.status(500).json({ success: false, error: e.message });
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
      return res.status(500).json({ success: false, error: e.message });
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
      return res.status(500).json({ success: false, error: e.message });
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
      return res.status(500).json({ success: false, error: e.message });
    }
  });

  return router;
}
