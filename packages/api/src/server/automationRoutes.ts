import express from 'express';
import type { Router, Request, Response } from 'express';
import type { Pool } from 'pg';
import { logger } from '../logger.ts';

type AuthResult = { userId: string; role?: string } | null;

interface AutomationDeps {
  requireAuth: (req: Request, res: Response) => AuthResult;
  pool: Pool;
}

export function registerAutomationRoutes({ requireAuth, pool }: AutomationDeps): Router {
  const router = express.Router();

  // Apply migration once on startup
  pool.query(`
    ALTER TABLE mailing_automations
      ADD COLUMN IF NOT EXISTS description TEXT DEFAULT '',
      ADD COLUMN IF NOT EXISTS steps JSONB NOT NULL DEFAULT '[]'::jsonb;
  `).catch(() => undefined);

  // GET /api/automations
  router.get('/automations', async (req: Request, res: Response) => {
    try {
      const auth = requireAuth(req, res);
      if (!auth) return;
      const { rows } = await pool.query(
        `SELECT id, name, description, status, steps, created_at, updated_at
         FROM mailing_automations WHERE user_id = $1 ORDER BY created_at DESC`,
        [auth.userId]
      );
      return res.json({ success: true, data: rows });
    } catch (err) {
      logger.error({ err }, 'automations_list_failed');
      return res.status(500).json({ success: false, error: 'Failed to fetch automations' });
    }
  });

  // POST /api/automations
  router.post('/automations', async (req: Request, res: Response) => {
    try {
      const auth = requireAuth(req, res);
      if (!auth) return;
      const { name, description = '', steps = [], status = 'draft' } = req.body as {
        name: string; description?: string; steps?: unknown[]; status?: string;
      };
      if (!name?.trim()) return res.status(400).json({ success: false, error: 'Name is required' });
      const id = `auto_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
      const { rows } = await pool.query(
        `INSERT INTO mailing_automations (id, user_id, name, description, trigger_type, status, steps)
         VALUES ($1, $2, $3, $4, 'api', $5, $6)
         RETURNING id, name, description, status, steps, created_at, updated_at`,
        [id, auth.userId, name.trim(), description, status, JSON.stringify(steps)]
      );
      return res.json({ success: true, data: rows[0] });
    } catch (err) {
      logger.error({ err }, 'automation_create_failed');
      return res.status(500).json({ success: false, error: 'Failed to create automation' });
    }
  });

  // PUT /api/automations/:id
  router.put('/automations/:id', async (req: Request, res: Response) => {
    try {
      const auth = requireAuth(req, res);
      if (!auth) return;
      const { id } = req.params;
      const { name, description, status, steps } = req.body as {
        name?: string; description?: string; status?: string; steps?: unknown[];
      };
      const { rows } = await pool.query(
        `UPDATE mailing_automations
         SET name = COALESCE($1, name),
             description = COALESCE($2, description),
             status = COALESCE($3, status),
             steps = COALESCE($4, steps),
             updated_at = NOW()
         WHERE id = $5 AND user_id = $6
         RETURNING id, name, description, status, steps, created_at, updated_at`,
        [name ?? null, description ?? null, status ?? null, steps ? JSON.stringify(steps) : null, id, auth.userId]
      );
      if (!rows.length) return res.status(404).json({ success: false, error: 'Automation not found' });
      return res.json({ success: true, data: rows[0] });
    } catch (err) {
      logger.error({ err }, 'automation_update_failed');
      return res.status(500).json({ success: false, error: 'Failed to update automation' });
    }
  });

  // DELETE /api/automations/:id
  router.delete('/automations/:id', async (req: Request, res: Response) => {
    try {
      const auth = requireAuth(req, res);
      if (!auth) return;
      const { id } = req.params;
      await pool.query(`DELETE FROM mailing_automations WHERE id = $1 AND user_id = $2`, [id, auth.userId]);
      return res.json({ success: true });
    } catch (err) {
      logger.error({ err }, 'automation_delete_failed');
      return res.status(500).json({ success: false, error: 'Failed to delete automation' });
    }
  });

  return router;
}
