import express from 'express';
import type { Router, Request, Response } from 'express';
import type { Pool } from 'pg';
import { randomUUID } from 'crypto';

type AuthResult = { userId: string } | null;

interface Deps {
  requireAuth: (req: Request, res: Response) => AuthResult;
  pool: Pool;
}

function computeNextRun(frequency: string): Date | null {
  const now = new Date();
  switch (frequency) {
    case 'hourly': return new Date(now.getTime() + 3600_000);
    case '6h':     return new Date(now.getTime() + 6 * 3600_000);
    case 'daily':  return new Date(now.getTime() + 86400_000);
    case 'weekly': return new Date(now.getTime() + 7 * 86400_000);
    default:       return null; // manual
  }
}

export function registerConnectorSyncRoutes({ requireAuth, pool }: Deps): Router {
  const router = express.Router();

  // ── List sync jobs ────────────────────────────────────────────────────────────
  router.get('/sync/jobs', async (req: Request, res: Response) => {
    const auth = requireAuth(req, res); if (!auth) return;
    const { domain_slug } = req.query as Record<string, string>;
    const params: unknown[] = [auth.userId];
    const wheres = ['j.user_id=$1'];
    if (domain_slug) { params.push(domain_slug); wheres.push(`j.domain_slug=$${params.length}`); }
    const { rows } = await pool.query(
      `SELECT j.*,
        (SELECT COUNT(*) FROM connector_sync_runs r WHERE r.job_id=j.id) AS run_count,
        (SELECT row_to_json(r.*) FROM connector_sync_runs r WHERE r.job_id=j.id ORDER BY r.started_at DESC LIMIT 1) AS last_run
       FROM connector_sync_jobs j WHERE ${wheres.join(' AND ')} ORDER BY j.created_at DESC`,
      params
    );
    res.json(rows);
  });

  // ── Create sync job ───────────────────────────────────────────────────────────
  router.post('/sync/jobs', async (req: Request, res: Response) => {
    const auth = requireAuth(req, res); if (!auth) return;
    const { domain_slug, provider_slug, name, sync_type, direction, frequency, filter_config } = req.body;
    if (!domain_slug || !provider_slug || !name || !sync_type) {
      return void res.status(400).json({ error: 'domain_slug, provider_slug, name, sync_type required' });
    }
    // Verify provider exists
    const { rows: [provider] } = await pool.query(
      `SELECT slug FROM connector_provider_catalog WHERE domain_slug=$1 AND slug=$2`,
      [domain_slug, provider_slug]
    );
    if (!provider) return void res.status(404).json({ error: 'Provider not found' });

    const nextRun = computeNextRun(frequency || 'manual');
    const { rows } = await pool.query(
      `INSERT INTO connector_sync_jobs (id,user_id,domain_slug,provider_slug,name,sync_type,direction,frequency,filter_config,next_run_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING *`,
      [randomUUID(), auth.userId, domain_slug, provider_slug, name, sync_type, direction||'inbound', frequency||'manual', JSON.stringify(filter_config||{}), nextRun]
    );
    res.status(201).json(rows[0]);
  });

  // ── Update sync job ───────────────────────────────────────────────────────────
  router.patch('/sync/jobs/:id', async (req: Request, res: Response) => {
    const auth = requireAuth(req, res); if (!auth) return;
    const fields = ['name','sync_type','direction','frequency','filter_config','active'];
    const sets: string[] = []; const params: unknown[] = [req.params.id, auth.userId];
    for (const f of fields) {
      if (req.body[f] !== undefined) {
        params.push(f === 'filter_config' ? JSON.stringify(req.body[f]) : req.body[f]);
        sets.push(`${f}=$${params.length}`);
      }
    }
    if (req.body.frequency !== undefined) {
      const nextRun = computeNextRun(req.body.frequency);
      if (nextRun) { params.push(nextRun); sets.push(`next_run_at=$${params.length}`); }
    }
    if (!sets.length) return void res.status(400).json({ error: 'nothing to update' });
    sets.push('updated_at=NOW()');
    const { rows } = await pool.query(`UPDATE connector_sync_jobs SET ${sets.join(',')} WHERE id=$1 AND user_id=$2 RETURNING *`, params);
    if (!rows.length) return void res.status(404).json({ error: 'Not found' });
    res.json(rows[0]);
  });

  // ── Delete sync job ───────────────────────────────────────────────────────────
  router.delete('/sync/jobs/:id', async (req: Request, res: Response) => {
    const auth = requireAuth(req, res); if (!auth) return;
    await pool.query(`DELETE FROM connector_sync_jobs WHERE id=$1 AND user_id=$2`, [req.params.id, auth.userId]);
    res.json({ ok: true });
  });

  // ── Trigger sync run manually ─────────────────────────────────────────────────
  router.post('/sync/jobs/:id/run', async (req: Request, res: Response) => {
    const auth = requireAuth(req, res); if (!auth) return;
    const { rows: [job] } = await pool.query(
      `SELECT * FROM connector_sync_jobs WHERE id=$1 AND user_id=$2`, [req.params.id, auth.userId]
    );
    if (!job) return void res.status(404).json({ error: 'Job not found' });

    // Create a run record immediately
    const runId = randomUUID();
    const { rows: [run] } = await pool.query(
      `INSERT INTO connector_sync_runs (id,job_id,user_id,domain_slug,provider_slug,status)
       VALUES ($1,$2,$3,$4,$5,'running') RETURNING *`,
      [runId, job.id, auth.userId, job.domain_slug, job.provider_slug]
    );

    // Update job last_run_at
    await pool.query(
      `UPDATE connector_sync_jobs SET last_run_at=NOW(), next_run_at=$1, updated_at=NOW() WHERE id=$2`,
      [computeNextRun(job.frequency), job.id]
    );

    // Run the sync asynchronously (fire-and-forget simulation)
    // Real implementation would dispatch to a BullMQ queue
    setImmediate(async () => {
      try {
        // Stub: simulate a sync. Real implementation calls provider adapter.
        await new Promise(r => setTimeout(r, 500));
        await pool.query(
          `UPDATE connector_sync_runs SET status='completed', records_pulled=0, completed_at=NOW() WHERE id=$1`,
          [runId]
        );
      } catch (err) {
        await pool.query(
          `UPDATE connector_sync_runs SET status='failed', error_message=$1, completed_at=NOW() WHERE id=$2`,
          [err instanceof Error ? err.message : 'Unknown error', runId]
        );
      }
    });

    res.status(202).json({ run_id: runId, status: 'running', message: 'Sync started' });
  });

  // ── Get sync run history ──────────────────────────────────────────────────────
  router.get('/sync/runs', async (req: Request, res: Response) => {
    const auth = requireAuth(req, res); if (!auth) return;
    const { job_id, domain_slug, limit = '25', offset = '0' } = req.query as Record<string, string>;
    const params: unknown[] = [auth.userId];
    const wheres = ['r.user_id=$1'];
    if (job_id) { params.push(job_id); wheres.push(`r.job_id=$${params.length}`); }
    if (domain_slug) { params.push(domain_slug); wheres.push(`r.domain_slug=$${params.length}`); }
    const { rows } = await pool.query(
      `SELECT r.*,
        j.name AS job_name, j.sync_type, j.frequency
       FROM connector_sync_runs r
       LEFT JOIN connector_sync_jobs j ON j.id=r.job_id
       WHERE ${wheres.join(' AND ')}
       ORDER BY r.started_at DESC
       LIMIT $${params.length+1} OFFSET $${params.length+2}`,
      [...params, parseInt(limit), parseInt(offset)]
    );
    res.json(rows);
  });

  // ── Get single run detail ─────────────────────────────────────────────────────
  router.get('/sync/runs/:id', async (req: Request, res: Response) => {
    const auth = requireAuth(req, res); if (!auth) return;
    const { rows: [run] } = await pool.query(
      `SELECT r.*, j.name AS job_name, j.sync_type FROM connector_sync_runs r
       LEFT JOIN connector_sync_jobs j ON j.id=r.job_id
       WHERE r.id=$1 AND r.user_id=$2`,
      [req.params.id, auth.userId]
    );
    if (!run) return void res.status(404).json({ error: 'Not found' });
    res.json(run);
  });

  // ── Sync stats summary ────────────────────────────────────────────────────────
  router.get('/sync/stats', async (req: Request, res: Response) => {
    const auth = requireAuth(req, res); if (!auth) return;
    const { rows: [stats] } = await pool.query(
      `SELECT
        COUNT(*) FILTER (WHERE status='completed') AS completed_runs,
        COUNT(*) FILTER (WHERE status='failed')    AS failed_runs,
        COUNT(*) FILTER (WHERE status='running')   AS running_runs,
        COALESCE(SUM(records_created), 0)          AS total_created,
        COALESCE(SUM(records_updated), 0)          AS total_updated,
        MAX(started_at)                            AS last_run_at
       FROM connector_sync_runs WHERE user_id=$1`,
      [auth.userId]
    );
    const { rows: activeJobs } = await pool.query(
      `SELECT COUNT(*) AS count FROM connector_sync_jobs WHERE user_id=$1 AND active=true`, [auth.userId]
    );
    res.json({ ...stats, active_jobs: parseInt(activeJobs[0].count) });
  });

  return router;
}
