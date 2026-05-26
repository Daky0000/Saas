import express from 'express';
import type { Router, Request, Response } from 'express';
import type { Pool } from 'pg';
import { randomUUID } from 'crypto';

type AuthResult = { userId: string } | null;

interface Deps {
  requireAuth: (req: Request, res: Response) => AuthResult;
  pool: Pool;
}

const DEFAULT_STAGES = [
  { name: 'Lead', color: '#6366f1', position: 0 },
  { name: 'Qualified', color: '#8b5cf6', position: 1 },
  { name: 'Proposal', color: '#f59e0b', position: 2 },
  { name: 'Negotiation', color: '#ef4444', position: 3 },
  { name: 'Closed Won', color: '#10b981', position: 4 },
];

export function registerCRMDealsRoutes({ requireAuth, pool }: Deps): Router {
  const router = express.Router();

  // ── Ensure default stages exist for user ───────────────────────────────────
  async function ensureDefaultStages(userId: string) {
    const { rows } = await pool.query(`SELECT id FROM crm_pipeline_stages WHERE user_id=$1 LIMIT 1`, [userId]);
    if (rows.length) return;
    for (const s of DEFAULT_STAGES) {
      await pool.query(
        `INSERT INTO crm_pipeline_stages (id,user_id,name,color,position) VALUES ($1,$2,$3,$4,$5) ON CONFLICT DO NOTHING`,
        [randomUUID(), userId, s.name, s.color, s.position]
      );
    }
  }

  // ── Pipeline stages ────────────────────────────────────────────────────────
  router.get('/pipeline/stages', async (req: Request, res: Response) => {
    const auth = requireAuth(req, res); if (!auth) return;
    await ensureDefaultStages(auth.userId);
    const { rows } = await pool.query(
      `SELECT s.*,
        (SELECT COUNT(*) FROM crm_deals d WHERE d.stage_id=s.id AND d.status='open') AS deal_count,
        (SELECT COALESCE(SUM(d.value),0) FROM crm_deals d WHERE d.stage_id=s.id AND d.status='open') AS total_value
       FROM crm_pipeline_stages s WHERE s.user_id=$1 ORDER BY s.position`,
      [auth.userId]
    );
    res.json(rows);
  });

  router.post('/pipeline/stages', async (req: Request, res: Response) => {
    const auth = requireAuth(req, res); if (!auth) return;
    const { name, color } = req.body;
    if (!name?.trim()) return void res.status(400).json({ error: 'name required' });
    const { rows: [{ max_pos }] } = await pool.query(`SELECT COALESCE(MAX(position),0) AS max_pos FROM crm_pipeline_stages WHERE user_id=$1`, [auth.userId]);
    const { rows } = await pool.query(
      `INSERT INTO crm_pipeline_stages (id,user_id,name,color,position) VALUES ($1,$2,$3,$4,$5) RETURNING *`,
      [randomUUID(), auth.userId, name.trim(), color||'#6366f1', (max_pos as number)+1]
    );
    res.status(201).json(rows[0]);
  });

  router.patch('/pipeline/stages/:id', async (req: Request, res: Response) => {
    const auth = requireAuth(req, res); if (!auth) return;
    const { name, color, position } = req.body;
    const sets: string[] = []; const params: unknown[] = [req.params.id, auth.userId];
    if (name !== undefined) { params.push(name); sets.push(`name=$${params.length}`); }
    if (color !== undefined) { params.push(color); sets.push(`color=$${params.length}`); }
    if (position !== undefined) { params.push(position); sets.push(`position=$${params.length}`); }
    if (!sets.length) return void res.status(400).json({ error: 'nothing to update' });
    const { rows } = await pool.query(`UPDATE crm_pipeline_stages SET ${sets.join(',')} WHERE id=$1 AND user_id=$2 RETURNING *`, params);
    if (!rows.length) return void res.status(404).json({ error: 'Not found' });
    res.json(rows[0]);
  });

  router.delete('/pipeline/stages/:id', async (req: Request, res: Response) => {
    const auth = requireAuth(req, res); if (!auth) return;
    const { rows: [stage] } = await pool.query(`SELECT * FROM crm_pipeline_stages WHERE id=$1 AND user_id=$2`, [req.params.id, auth.userId]);
    if (!stage) return void res.status(404).json({ error: 'Not found' });
    await pool.query(`UPDATE crm_deals SET stage_id=NULL WHERE stage_id=$1`, [req.params.id]);
    await pool.query(`DELETE FROM crm_pipeline_stages WHERE id=$1`, [req.params.id]);
    res.json({ ok: true });
  });

  // ── Deals list (board data) ────────────────────────────────────────────────
  router.get('/deals', async (req: Request, res: Response) => {
    const auth = requireAuth(req, res); if (!auth) return;
    const { stage_id, status = 'open', search, limit = '100', offset = '0' } = req.query as Record<string, string>;
    const params: unknown[] = [auth.userId];
    const wheres = ['d.user_id=$1'];
    if (stage_id) { params.push(stage_id); wheres.push(`d.stage_id=$${params.length}`); }
    if (status) { params.push(status); wheres.push(`d.status=$${params.length}`); }
    if (search) { params.push(`%${search}%`); wheres.push(`d.title ILIKE $${params.length}`); }
    const { rows } = await pool.query(
      `SELECT d.*,
        s.name AS stage_name, s.color AS stage_color,
        mc.email AS contact_email, mc.first_name AS contact_first_name, mc.last_name AS contact_last_name,
        cc.name AS company_name
       FROM crm_deals d
       LEFT JOIN crm_pipeline_stages s ON s.id=d.stage_id
       LEFT JOIN mailing_contacts mc ON mc.id=d.contact_id
       LEFT JOIN crm_companies cc ON cc.id=d.company_id
       WHERE ${wheres.join(' AND ')}
       ORDER BY d.stage_id NULLS LAST, d.position, d.created_at DESC
       LIMIT $${params.length+1} OFFSET $${params.length+2}`,
      [...params, parseInt(limit), parseInt(offset)]
    );
    res.json(rows);
  });

  // ── Get single deal ────────────────────────────────────────────────────────
  router.get('/deals/:id', async (req: Request, res: Response) => {
    const auth = requireAuth(req, res); if (!auth) return;
    const { rows } = await pool.query(
      `SELECT d.*,
        s.name AS stage_name, s.color AS stage_color,
        mc.email AS contact_email, mc.first_name AS contact_first_name, mc.last_name AS contact_last_name,
        cc.name AS company_name
       FROM crm_deals d
       LEFT JOIN crm_pipeline_stages s ON s.id=d.stage_id
       LEFT JOIN mailing_contacts mc ON mc.id=d.contact_id
       LEFT JOIN crm_companies cc ON cc.id=d.company_id
       WHERE d.id=$1 AND d.user_id=$2`,
      [req.params.id, auth.userId]
    );
    if (!rows.length) return void res.status(404).json({ error: 'Not found' });
    const { rows: activities } = await pool.query(
      `SELECT * FROM crm_activities WHERE deal_id=$1 ORDER BY created_at DESC LIMIT 20`,
      [req.params.id]
    );
    res.json({ ...rows[0], activities });
  });

  // ── Create deal ────────────────────────────────────────────────────────────
  router.post('/deals', async (req: Request, res: Response) => {
    const auth = requireAuth(req, res); if (!auth) return;
    const { title, value, currency, stage_id, contact_id, company_id, close_date, priority, probability, description } = req.body;
    if (!title?.trim()) return void res.status(400).json({ error: 'title required' });
    const { rows: [{ max_pos }] } = await pool.query(
      `SELECT COALESCE(MAX(position),0) AS max_pos FROM crm_deals WHERE user_id=$1 AND stage_id IS NOT DISTINCT FROM $2`,
      [auth.userId, stage_id||null]
    );
    const id = randomUUID();
    const { rows } = await pool.query(
      `INSERT INTO crm_deals (id,user_id,title,value,currency,stage_id,contact_id,company_id,close_date,priority,probability,description,position)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13) RETURNING *`,
      [id, auth.userId, title.trim(), value||0, currency||'USD', stage_id||null, contact_id||null, company_id||null, close_date||null, priority||'medium', probability||0, description||null, (max_pos as number)+1]
    );
    res.status(201).json(rows[0]);
  });

  // ── Update deal ────────────────────────────────────────────────────────────
  router.patch('/deals/:id', async (req: Request, res: Response) => {
    const auth = requireAuth(req, res); if (!auth) return;
    const fields = ['title','value','currency','stage_id','contact_id','company_id','close_date','priority','status','probability','description','position','custom_data'];
    const sets: string[] = []; const params: unknown[] = [req.params.id, auth.userId];
    for (const f of fields) {
      if (req.body[f] !== undefined) {
        params.push(f === 'custom_data' ? JSON.stringify(req.body[f]) : req.body[f]);
        sets.push(`${f}=$${params.length}`);
      }
    }
    if (!sets.length) return void res.status(400).json({ error: 'nothing to update' });
    sets.push(`updated_at=NOW()`);
    const { rows } = await pool.query(`UPDATE crm_deals SET ${sets.join(',')} WHERE id=$1 AND user_id=$2 RETURNING *`, params);
    if (!rows.length) return void res.status(404).json({ error: 'Not found' });
    res.json(rows[0]);
  });

  // ── Delete deal ────────────────────────────────────────────────────────────
  router.delete('/deals/:id', async (req: Request, res: Response) => {
    const auth = requireAuth(req, res); if (!auth) return;
    await pool.query(`DELETE FROM crm_deals WHERE id=$1 AND user_id=$2`, [req.params.id, auth.userId]);
    res.json({ ok: true });
  });

  // ── Board reorder (drag-drop) ──────────────────────────────────────────────
  router.post('/deals/reorder', async (req: Request, res: Response) => {
    const auth = requireAuth(req, res); if (!auth) return;
    const { deal_id, stage_id, position } = req.body;
    if (!deal_id) return void res.status(400).json({ error: 'deal_id required' });
    await pool.query(
      `UPDATE crm_deals SET stage_id=$1, position=$2, updated_at=NOW() WHERE id=$3 AND user_id=$4`,
      [stage_id||null, position||0, deal_id, auth.userId]
    );
    res.json({ ok: true });
  });

  // ── Pipeline summary stats ─────────────────────────────────────────────────
  router.get('/pipeline/stats', async (req: Request, res: Response) => {
    const auth = requireAuth(req, res); if (!auth) return;
    const { rows } = await pool.query(
      `SELECT
        COUNT(*) FILTER (WHERE status='open') AS open_count,
        COUNT(*) FILTER (WHERE status='won') AS won_count,
        COUNT(*) FILTER (WHERE status='lost') AS lost_count,
        COALESCE(SUM(value) FILTER (WHERE status='open'), 0) AS open_value,
        COALESCE(SUM(value) FILTER (WHERE status='won'), 0) AS won_value,
        COALESCE(AVG(value) FILTER (WHERE status='won'), 0) AS avg_deal_size
       FROM crm_deals WHERE user_id=$1`,
      [auth.userId]
    );
    res.json(rows[0]);
  });

  return router;
}
