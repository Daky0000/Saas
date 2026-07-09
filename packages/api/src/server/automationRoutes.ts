import express from 'express';
import type { Router, Request, Response } from 'express';
import type { Pool } from 'pg';
import { logger } from '../logger.ts';
import { deriveTriggerType } from './automationEngine.ts';

type AuthResult = { userId: string; role?: string } | null;

interface AutomationDeps {
  requireAuth: (req: Request, res: Response) => AuthResult;
  pool: Pool;
  runAutomationForContact: (userId: string, automation: any, contact: { id?: string | null; email?: string }) => Promise<void>;
}

export function registerAutomationRoutes({ requireAuth, pool, runAutomationForContact }: AutomationDeps): Router {
  const router = express.Router();

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
      // trigger_type mirrors the flow's trigger node so the engine can match fired events
      const { rows } = await pool.query(
        `INSERT INTO mailing_automations (id, user_id, name, description, trigger_type, status, steps)
         VALUES ($1, $2, $3, $4, $5, $6, $7)
         RETURNING id, name, description, status, steps, created_at, updated_at`,
        [id, auth.userId, name.trim(), description, deriveTriggerType(steps), status, JSON.stringify(steps)]
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
             trigger_type = COALESCE($5, trigger_type),
             updated_at = NOW()
         WHERE id = $6 AND user_id = $7
         RETURNING id, name, description, status, steps, created_at, updated_at`,
        [name ?? null, description ?? null, status ?? null, steps ? JSON.stringify(steps) : null, steps ? deriveTriggerType(steps) : null, id, auth.userId]
      );
      if (!rows.length) return res.status(404).json({ success: false, error: 'Automation not found' });
      return res.json({ success: true, data: rows[0] });
    } catch (err) {
      logger.error({ err }, 'automation_update_failed');
      return res.status(500).json({ success: false, error: 'Failed to update automation' });
    }
  });

  // POST /api/automations/:id/run — run the flow now for one contact
  // (the "Manual entry" trigger, and useful for testing any flow)
  router.post('/automations/:id/run', async (req: Request, res: Response) => {
    try {
      const auth = requireAuth(req, res);
      if (!auth) return;
      const { contact_id, email } = req.body as { contact_id?: string; email?: string };
      if (!contact_id && !email) {
        return res.status(400).json({ success: false, error: 'contact_id or email is required' });
      }
      const { rows } = await pool.query(
        `SELECT id, user_id, name, trigger_type, status, steps, actions FROM mailing_automations WHERE id = $1 AND user_id = $2`,
        [req.params.id, auth.userId]
      );
      if (!rows.length) return res.status(404).json({ success: false, error: 'Automation not found' });
      await runAutomationForContact(auth.userId, rows[0], { id: contact_id ?? null, email });
      return res.json({ success: true });
    } catch (err) {
      logger.error({ err }, 'automation_manual_run_failed');
      return res.status(500).json({ success: false, error: 'Failed to run automation' });
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
