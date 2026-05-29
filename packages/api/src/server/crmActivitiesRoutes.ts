import express from 'express';
import type { Router, Request, Response } from 'express';
import type { Pool } from 'pg';
import { randomUUID } from 'crypto';

type AuthResult = { userId: string } | null;

interface Deps {
  requireAuth: (req: Request, res: Response) => AuthResult;
  pool: Pool;
}

export function registerCRMActivitiesRoutes({ requireAuth, pool }: Deps): Router {
  const router = express.Router();

  // ── List activities (filterable by contact/deal/company) ───────────────────
  router.get('/activities', async (req: Request, res: Response) => {
    const auth = requireAuth(req, res); if (!auth) return;
    const { contact_id, deal_id, company_id, type, limit = '50', offset = '0' } = req.query as Record<string, string>;
    const params: unknown[] = [auth.userId];
    const wheres = ['a.user_id=$1'];
    if (contact_id) { params.push(contact_id); wheres.push(`a.contact_id=$${params.length}`); }
    if (deal_id) { params.push(deal_id); wheres.push(`a.deal_id=$${params.length}`); }
    if (company_id) { params.push(company_id); wheres.push(`a.company_id=$${params.length}`); }
    if (type) { params.push(type); wheres.push(`a.type=$${params.length}`); }
    const { rows } = await pool.query(
      `SELECT a.*,
        mc.email AS contact_email, mc.first_name AS contact_first_name, mc.last_name AS contact_last_name,
        d.title AS deal_title,
        cc.name AS company_name,
        u.full_name AS author_name
       FROM crm_activities a
       LEFT JOIN mailing_contacts mc ON mc.id=a.contact_id
       LEFT JOIN crm_deals d ON d.id=a.deal_id
       LEFT JOIN crm_companies cc ON cc.id=a.company_id
       LEFT JOIN users u ON u.id=a.user_id
       WHERE ${wheres.join(' AND ')}
       ORDER BY a.created_at DESC
       LIMIT $${params.length+1} OFFSET $${params.length+2}`,
      [...params, parseInt(limit), parseInt(offset)]
    );
    res.json(rows);
  });

  // ── Create activity ────────────────────────────────────────────────────────
  router.post('/activities', async (req: Request, res: Response) => {
    const auth = requireAuth(req, res); if (!auth) return;
    const { type, title, body, outcome, duration, scheduled_at, completed_at, contact_id, deal_id, company_id } = req.body;
    const VALID_TYPES = ['note','call','email','meeting','task','whatsapp','sms'];
    if (!type || !VALID_TYPES.includes(type)) return void res.status(400).json({ error: `type must be one of: ${VALID_TYPES.join(', ')}` });
    const id = randomUUID();
    const { rows } = await pool.query(
      `INSERT INTO crm_activities (id,user_id,type,title,body,outcome,duration,scheduled_at,completed_at,contact_id,deal_id,company_id)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) RETURNING *`,
      [id, auth.userId, type, title||null, body||null, outcome||null, duration||null, scheduled_at||null, completed_at||null, contact_id||null, deal_id||null, company_id||null]
    );
    res.status(201).json(rows[0]);
  });

  // ── Update activity ────────────────────────────────────────────────────────
  router.patch('/activities/:id', async (req: Request, res: Response) => {
    const auth = requireAuth(req, res); if (!auth) return;
    const fields = ['title','body','outcome','duration','scheduled_at','completed_at'];
    const sets: string[] = []; const params: unknown[] = [req.params.id, auth.userId];
    for (const f of fields) {
      if (req.body[f] !== undefined) { params.push(req.body[f]); sets.push(`${f}=$${params.length}`); }
    }
    if (!sets.length) return void res.status(400).json({ error: 'nothing to update' });
    sets.push(`updated_at=NOW()`);
    const { rows } = await pool.query(`UPDATE crm_activities SET ${sets.join(',')} WHERE id=$1 AND user_id=$2 RETURNING *`, params);
    if (!rows.length) return void res.status(404).json({ error: 'Not found' });
    res.json(rows[0]);
  });

  // ── Delete activity ────────────────────────────────────────────────────────
  router.delete('/activities/:id', async (req: Request, res: Response) => {
    const auth = requireAuth(req, res); if (!auth) return;
    await pool.query(`DELETE FROM crm_activities WHERE id=$1 AND user_id=$2`, [req.params.id, auth.userId]);
    res.json({ ok: true });
  });

  // ── Lead scoring rules ─────────────────────────────────────────────────────
  router.get('/scoring/rules', async (req: Request, res: Response) => {
    const auth = requireAuth(req, res); if (!auth) return;
    const { rows } = await pool.query(
      `SELECT * FROM crm_lead_scoring_rules WHERE user_id=$1 ORDER BY position, created_at`,
      [auth.userId]
    );
    res.json(rows);
  });

  router.post('/scoring/rules', async (req: Request, res: Response) => {
    const auth = requireAuth(req, res); if (!auth) return;
    const { name, condition, points, active } = req.body;
    if (!name?.trim()) return void res.status(400).json({ error: 'name required' });
    if (!condition || typeof condition !== 'object') return void res.status(400).json({ error: 'condition required' });
    const { rows: [{ max_pos }] } = await pool.query(`SELECT COALESCE(MAX(position),0) AS max_pos FROM crm_lead_scoring_rules WHERE user_id=$1`, [auth.userId]);
    const { rows } = await pool.query(
      `INSERT INTO crm_lead_scoring_rules (id,user_id,name,condition,points,active,position)
       VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING *`,
      [randomUUID(), auth.userId, name.trim(), JSON.stringify(condition), points||0, active !== false, (max_pos as number)+1]
    );
    res.status(201).json(rows[0]);
  });

  router.patch('/scoring/rules/:id', async (req: Request, res: Response) => {
    const auth = requireAuth(req, res); if (!auth) return;
    const sets: string[] = []; const params: unknown[] = [req.params.id, auth.userId];
    const { name, condition, points, active, position } = req.body;
    if (name !== undefined) { params.push(name); sets.push(`name=$${params.length}`); }
    if (condition !== undefined) { params.push(JSON.stringify(condition)); sets.push(`condition=$${params.length}`); }
    if (points !== undefined) { params.push(points); sets.push(`points=$${params.length}`); }
    if (active !== undefined) { params.push(active); sets.push(`active=$${params.length}`); }
    if (position !== undefined) { params.push(position); sets.push(`position=$${params.length}`); }
    if (!sets.length) return void res.status(400).json({ error: 'nothing to update' });
    sets.push(`updated_at=NOW()`);
    const { rows } = await pool.query(`UPDATE crm_lead_scoring_rules SET ${sets.join(',')} WHERE id=$1 AND user_id=$2 RETURNING *`, params);
    if (!rows.length) return void res.status(404).json({ error: 'Not found' });
    res.json(rows[0]);
  });

  router.delete('/scoring/rules/:id', async (req: Request, res: Response) => {
    const auth = requireAuth(req, res); if (!auth) return;
    await pool.query(`DELETE FROM crm_lead_scoring_rules WHERE id=$1 AND user_id=$2`, [req.params.id, auth.userId]);
    res.json({ ok: true });
  });

  // ── Recalculate contact lead score ─────────────────────────────────────────
  router.post('/scoring/recalculate/:contactId', async (req: Request, res: Response) => {
    const auth = requireAuth(req, res); if (!auth) return;
    const { rows: rules } = await pool.query(
      `SELECT * FROM crm_lead_scoring_rules WHERE user_id=$1 AND active=true ORDER BY position`,
      [auth.userId]
    );
    const { rows: [contact] } = await pool.query(
      `SELECT mc.*, ARRAY_AGG(mct.tag) FILTER (WHERE mct.tag IS NOT NULL) AS tags
       FROM mailing_contacts mc
       LEFT JOIN mailing_contact_tags mct ON mct.contact_id=mc.id
       WHERE mc.id=$1 AND mc.user_id=$2 GROUP BY mc.id`,
      [req.params.contactId, auth.userId]
    );
    if (!contact) return void res.status(404).json({ error: 'Not found' });
    let score = 0;
    for (const rule of rules) {
      const cond = rule.condition as { field: string; op: string; value: string };
      let match = false;
      if (cond.field === 'tag') {
        const tags: string[] = contact.tags || [];
        match = cond.op === 'has' ? tags.includes(cond.value) : !tags.includes(cond.value);
      } else if (cond.field === 'subscribed') {
        match = contact.subscribed === (cond.value === 'true');
      } else if (cond.field === 'email_consent') {
        match = contact.email_marketing_consent === (cond.value === 'true');
      }
      if (match) score += rule.points;
    }
    const custom = contact.custom_data || {};
    custom.lead_score = Math.max(0, Math.min(100, score));
    await pool.query(`UPDATE mailing_contacts SET custom_data=$1 WHERE id=$2`, [JSON.stringify(custom), req.params.contactId]);
    res.json({ score: custom.lead_score });
  });

  return router;
}
