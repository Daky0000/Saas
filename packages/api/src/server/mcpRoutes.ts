import express from 'express';
import type { Router, Request, Response } from 'express';
import type { Pool } from 'pg';
import { logger } from '../logger.ts';
import { withMcpClient, listMcpTools, extractToolPayload, type McpServerConn } from './mcpClient.ts';

// ─────────────────────────────────────────────────────────────────────────────
// MCP integrations (Admin → MCP) + the media they feed.
//
// Admin configures MCP servers (command/env for stdio, url/headers for http).
// The MeiGen AI Design adapter pulls its curated gallery (image + prompt +
// model) into mcp_media, filtered to the allowed models (GPT / Gemini by
// default). Users browse that feed in AI Studio → Discover, like images
// (mcp_media_likes → Personalization → Images), and get "AI Suggestions"
// based on what they liked.
// ─────────────────────────────────────────────────────────────────────────────

type AuthResult = { userId: string; role?: string } | null;

interface AdminDeps {
  requireAdmin: (req: Request, res: Response) => Promise<{ userId: string } | null>;
  pool: Pool;
  encryptIntegrationSecret: (plain: string) => string;
  decryptIntegrationSecret: (encrypted: string) => string;
}

interface UserDeps {
  requireAuth: (req: Request, res: Response) => AuthResult;
  pool: Pool;
}

const DEFAULT_MEIGEN_CONFIG = {
  adapter: 'meigen',
  search_tool: 'search_gallery',
  detail_tool: 'get_inspiration',
  search_arg: 'keywords',
  sync_keywords: ['portrait', 'product', 'poster', 'logo', '3d', 'anime', 'landscape', 'fashion', 'food', 'illustration', 'ui design', 'character'],
  allowed_models: ['gpt', 'gemini', 'nano banana', 'nanobanana', 'nano-banana', 'imagen'],
  max_detail_lookups: 30,
};

function decryptJson(decrypt: (s: string) => string, value: string | null | undefined): Record<string, string> {
  if (!value) return {};
  try { return JSON.parse(decrypt(value)); } catch { return {}; }
}

function maskKeys(obj: Record<string, string>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const k of Object.keys(obj)) out[k] = obj[k] ? '••••••' : '';
  return out;
}

async function buildConn(row: any, decrypt: (s: string) => string): Promise<McpServerConn> {
  return {
    transport: row.transport === 'http' ? 'http' : 'stdio',
    command: row.command,
    args: typeof row.args === 'string' ? JSON.parse(row.args) : row.args,
    url: row.url,
    env: decryptJson(decrypt, row.env_encrypted),
    headers: decryptJson(decrypt, row.headers_encrypted),
  };
}

// ── MeiGen gallery sync ───────────────────────────────────────────────────────

function normalizeGalleryItems(payload: unknown): any[] {
  if (Array.isArray(payload)) return payload;
  if (payload && typeof payload === 'object') {
    const p = payload as Record<string, unknown>;
    for (const key of ['results', 'items', 'entries', 'gallery', 'data', 'prompts']) {
      if (Array.isArray(p[key])) return p[key] as any[];
    }
  }
  return [];
}

function pickField(item: any, keys: string[]): string {
  for (const k of keys) {
    const v = item?.[k];
    if (typeof v === 'string' && v.trim()) return v.trim();
    if (typeof v === 'number') return String(v);
  }
  return '';
}

function pickImage(item: any): string {
  const direct = pickField(item, ['image_url', 'imageUrl', 'image', 'preview', 'preview_url', 'thumbnail', 'thumbnail_url', 'url', 'cover']);
  if (direct) return direct;
  const arr = item?.images;
  if (Array.isArray(arr) && arr.length) {
    const first = arr[0];
    if (typeof first === 'string') return first;
    if (first && typeof first === 'object') return pickField(first, ['url', 'image_url', 'src', 'preview']);
  }
  return '';
}

function modelAllowed(model: string, allowed: string[]): boolean {
  const m = model.toLowerCase();
  return allowed.some((a) => m.includes(a.toLowerCase()));
}

export async function syncMeigenGallery(
  pool: Pool,
  serverRow: any,
  decrypt: (s: string) => string
): Promise<{ scanned: number; stored: number; errors: string[] }> {
  const cfg = { ...DEFAULT_MEIGEN_CONFIG, ...(typeof serverRow.config === 'object' && serverRow.config ? serverRow.config : {}) };
  const conn = await buildConn(serverRow, decrypt);
  const errors: string[] = [];
  let scanned = 0;
  let stored = 0;
  let detailBudget = Number(cfg.max_detail_lookups) || 0;

  await withMcpClient(conn, async (client) => {
    for (const keyword of cfg.sync_keywords.slice(0, 20)) {
      let items: any[] = [];
      try {
        const result = await client.callTool({ name: cfg.search_tool, arguments: { [cfg.search_arg]: keyword } });
        items = normalizeGalleryItems(extractToolPayload(result));
      } catch (err) {
        errors.push(`search "${keyword}": ${err instanceof Error ? err.message : 'failed'}`);
        continue;
      }
      for (const item of items) {
        scanned++;
        const externalId = pickField(item, ['id', 'entry_id', 'gallery_id', 'uuid', 'slug']);
        const imageUrl = pickImage(item);
        if (!externalId || !imageUrl) continue;
        let prompt = pickField(item, ['prompt', 'prompt_text', 'description', 'text']);
        const model = pickField(item, ['model', 'model_name', 'source', 'provider']);
        if (!model || !modelAllowed(model, cfg.allowed_models)) continue;

        // Gallery search results sometimes omit the full prompt — fetch it.
        if (!prompt && cfg.detail_tool && detailBudget > 0) {
          detailBudget--;
          try {
            const detail = await client.callTool({ name: cfg.detail_tool, arguments: { id: externalId } });
            const dp = extractToolPayload(detail) as any;
            prompt = pickField(dp ?? {}, ['prompt', 'prompt_text', 'description', 'text']);
          } catch { /* keep without prompt */ }
        }

        try {
          const inserted = await pool.query(
            `INSERT INTO mcp_media (server_id, external_id, title, prompt, model, category, image_url, thumb_url, raw, fetched_at)
             VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9::jsonb,NOW())
             ON CONFLICT (server_id, external_id) DO UPDATE SET
               title=COALESCE(NULLIF(EXCLUDED.title,''), mcp_media.title),
               prompt=COALESCE(NULLIF(EXCLUDED.prompt,''), mcp_media.prompt),
               model=COALESCE(NULLIF(EXCLUDED.model,''), mcp_media.model),
               category=COALESCE(NULLIF(EXCLUDED.category,''), mcp_media.category),
               image_url=EXCLUDED.image_url,
               raw=EXCLUDED.raw, fetched_at=NOW()`,
            [
              serverRow.id, externalId,
              pickField(item, ['title', 'name']) || null,
              prompt || null, model, keyword,
              imageUrl,
              pickField(item, ['thumbnail', 'thumbnail_url', 'thumb', 'preview']) || null,
              JSON.stringify(item).slice(0, 8000),
            ]
          );
          if (inserted.rowCount) stored++;
        } catch (err) {
          errors.push(`store ${externalId}: ${err instanceof Error ? err.message : 'failed'}`);
        }
      }
    }
  });

  await pool.query(
    `UPDATE mcp_servers SET last_synced_at=NOW(), status='ok', status_message=$2, updated_at=NOW() WHERE id=$1`,
    [serverRow.id, `Synced ${stored} of ${scanned} items${errors.length ? ` (${errors.length} errors)` : ''}`]
  ).catch(() => undefined);

  return { scanned, stored, errors: errors.slice(0, 10) };
}

// Periodic scan (server.ts scheduler): sync media for every enabled MCP
// server whose adapter produces media. Currently only the meigen adapter.
export async function processMcpMediaSync(pool: Pool | null, decrypt: (s: string) => string): Promise<void> {
  if (!pool) return;
  try {
    const { rows } = await pool.query(
      `SELECT * FROM mcp_servers WHERE enabled=true AND (config->>'adapter')='meigen'
       AND (last_synced_at IS NULL OR last_synced_at < NOW() - INTERVAL '5 hours')`
    );
    for (const row of rows) {
      try {
        const result = await syncMeigenGallery(pool, row, decrypt);
        logger.info({ server: row.slug, ...result, errors: result.errors.length }, 'mcp_media_sync_done');
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Sync failed';
        logger.warn({ err, server: row.slug }, 'mcp_media_sync_failed');
        await pool.query(
          `UPDATE mcp_servers SET status='error', status_message=$2, updated_at=NOW() WHERE id=$1`,
          [row.id, message.slice(0, 300)]
        ).catch(() => undefined);
      }
    }
  } catch (err) {
    logger.error({ err }, 'mcp_media_sync_tick_failed');
  }
}

// Seed the MeiGen server row once so the admin only has to paste the token.
export async function seedDefaultMcpServers(pool: Pool | null): Promise<void> {
  if (!pool) return;
  await pool.query(
    `INSERT INTO mcp_servers (name, slug, transport, command, args, config, enabled, status, status_message)
     VALUES ('MeiGen AI Design', 'meigen', 'stdio', 'npx', '["-y","meigen-ai-design-mcp"]'::jsonb, $1::jsonb, false, 'unconfigured', 'Add your MEIGEN_API_TOKEN and enable to start syncing')
     ON CONFLICT (slug) DO NOTHING`,
    [JSON.stringify(DEFAULT_MEIGEN_CONFIG)]
  ).catch(() => undefined);
}

// ── Admin routes (mounted at /api/admin/mcp) ─────────────────────────────────

export function registerMcpAdminRoutes({ requireAdmin, pool, encryptIntegrationSecret, decryptIntegrationSecret }: AdminDeps): Router {
  const router = express.Router();

  router.get('/servers', async (req: Request, res: Response) => {
    const admin = await requireAdmin(req, res); if (!admin) return;
    try {
      const { rows } = await pool.query(`SELECT * FROM mcp_servers ORDER BY created_at`);
      return res.json({
        success: true,
        servers: rows.map((r: any) => ({
          ...r,
          env_encrypted: undefined,
          headers_encrypted: undefined,
          env_keys: maskKeys(decryptJson(decryptIntegrationSecret, r.env_encrypted)),
          header_keys: maskKeys(decryptJson(decryptIntegrationSecret, r.headers_encrypted)),
        })),
      });
    } catch (err) {
      logger.error({ err }, 'mcp_servers_list_failed');
      return res.status(500).json({ success: false, error: 'Failed to list MCP servers' });
    }
  });

  router.post('/servers', async (req: Request, res: Response) => {
    const admin = await requireAdmin(req, res); if (!admin) return;
    try {
      const { name, slug, transport = 'stdio', command, args, url, env, headers, config } = req.body as Record<string, any>;
      if (!name?.trim() || !slug?.trim()) return res.status(400).json({ success: false, error: 'name and slug are required' });
      const { rows } = await pool.query(
        `INSERT INTO mcp_servers (name, slug, transport, command, args, url, env_encrypted, headers_encrypted, config)
         VALUES ($1,$2,$3,$4,$5::jsonb,$6,$7,$8,$9::jsonb) RETURNING id`,
        [
          String(name).trim(), String(slug).trim().toLowerCase(), transport === 'http' ? 'http' : 'stdio',
          command || null, JSON.stringify(Array.isArray(args) ? args : []), url || null,
          env && Object.keys(env).length ? encryptIntegrationSecret(JSON.stringify(env)) : null,
          headers && Object.keys(headers).length ? encryptIntegrationSecret(JSON.stringify(headers)) : null,
          JSON.stringify(config && typeof config === 'object' ? config : {}),
        ]
      );
      return res.json({ success: true, id: rows[0].id });
    } catch (err: any) {
      if (String(err?.message || '').includes('unique')) return res.status(400).json({ success: false, error: 'A server with that slug already exists' });
      logger.error({ err }, 'mcp_server_create_failed');
      return res.status(500).json({ success: false, error: 'Failed to create MCP server' });
    }
  });

  router.put('/servers/:id', async (req: Request, res: Response) => {
    const admin = await requireAdmin(req, res); if (!admin) return;
    try {
      const { rows: existing } = await pool.query(`SELECT * FROM mcp_servers WHERE id=$1`, [req.params.id]);
      if (!existing.length) return res.status(404).json({ success: false, error: 'Server not found' });
      const cur = existing[0];
      const b = req.body as Record<string, any>;

      // Secrets: merge with existing so masked values ('••••••') keep old secrets.
      const mergeSecrets = (incoming: Record<string, string> | undefined, encrypted: string | null) => {
        if (!incoming) return encrypted;
        const current = decryptJson(decryptIntegrationSecret, encrypted);
        const next: Record<string, string> = {};
        for (const [k, v] of Object.entries(incoming)) {
          if (!k.trim()) continue;
          next[k.trim()] = v && !/^•+$/.test(v) ? v : (current[k.trim()] ?? '');
        }
        const clean = Object.fromEntries(Object.entries(next).filter(([, v]) => v !== ''));
        return Object.keys(clean).length ? encryptIntegrationSecret(JSON.stringify(clean)) : null;
      };

      await pool.query(
        `UPDATE mcp_servers SET
           name=COALESCE($2,name), transport=COALESCE($3,transport), command=$4, args=COALESCE($5::jsonb,args),
           url=$6, env_encrypted=$7, headers_encrypted=$8, config=COALESCE($9::jsonb,config),
           enabled=COALESCE($10,enabled), updated_at=NOW()
         WHERE id=$1`,
        [
          req.params.id,
          b.name?.trim() || null,
          b.transport === 'http' ? 'http' : b.transport === 'stdio' ? 'stdio' : null,
          b.command !== undefined ? (b.command || null) : cur.command,
          b.args !== undefined ? JSON.stringify(Array.isArray(b.args) ? b.args : []) : null,
          b.url !== undefined ? (b.url || null) : cur.url,
          mergeSecrets(b.env, cur.env_encrypted),
          mergeSecrets(b.headers, cur.headers_encrypted),
          b.config && typeof b.config === 'object' ? JSON.stringify(b.config) : null,
          typeof b.enabled === 'boolean' ? b.enabled : null,
        ]
      );
      return res.json({ success: true });
    } catch (err) {
      logger.error({ err }, 'mcp_server_update_failed');
      return res.status(500).json({ success: false, error: 'Failed to update MCP server' });
    }
  });

  router.delete('/servers/:id', async (req: Request, res: Response) => {
    const admin = await requireAdmin(req, res); if (!admin) return;
    try {
      await pool.query(`DELETE FROM mcp_servers WHERE id=$1`, [req.params.id]);
      return res.json({ success: true });
    } catch (err) {
      logger.error({ err }, 'mcp_server_delete_failed');
      return res.status(500).json({ success: false, error: 'Failed to delete MCP server' });
    }
  });

  // Test connection: connect + list tools, record status.
  router.post('/servers/:id/test', async (req: Request, res: Response) => {
    const admin = await requireAdmin(req, res); if (!admin) return;
    try {
      const { rows } = await pool.query(`SELECT * FROM mcp_servers WHERE id=$1`, [req.params.id]);
      if (!rows.length) return res.status(404).json({ success: false, error: 'Server not found' });
      const conn = await buildConn(rows[0], decryptIntegrationSecret);
      const tools = await listMcpTools(conn);
      await pool.query(
        `UPDATE mcp_servers SET status='ok', status_message=$2, last_checked_at=NOW(), updated_at=NOW() WHERE id=$1`,
        [req.params.id, `Connected — ${tools.length} tools`]
      );
      return res.json({ success: true, tools });
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Connection failed';
      await pool.query(
        `UPDATE mcp_servers SET status='error', status_message=$2, last_checked_at=NOW(), updated_at=NOW() WHERE id=$1`,
        [req.params.id, message.slice(0, 300)]
      ).catch(() => undefined);
      return res.status(502).json({ success: false, error: message });
    }
  });

  // Manual sync now (meigen adapter).
  router.post('/servers/:id/sync', async (req: Request, res: Response) => {
    const admin = await requireAdmin(req, res); if (!admin) return;
    try {
      const { rows } = await pool.query(`SELECT * FROM mcp_servers WHERE id=$1`, [req.params.id]);
      if (!rows.length) return res.status(404).json({ success: false, error: 'Server not found' });
      if (rows[0].config?.adapter !== 'meigen') return res.status(400).json({ success: false, error: 'This server has no media sync adapter' });
      const result = await syncMeigenGallery(pool, rows[0], decryptIntegrationSecret);
      return res.json({ success: true, ...result });
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Sync failed';
      await pool.query(
        `UPDATE mcp_servers SET status='error', status_message=$2, updated_at=NOW() WHERE id=$1`,
        [req.params.id, message.slice(0, 300)]
      ).catch(() => undefined);
      return res.status(502).json({ success: false, error: message });
    }
  });

  return router;
}

// ── User media routes (mounted at /api/mcp) ─────────────────────────────────

export function registerMcpMediaRoutes({ requireAuth, pool }: UserDeps): Router {
  const router = express.Router();

  // GET /api/mcp/media?tab=all|gpt|gemini&sort=featured|newest|popular
  router.get('/media', async (req: Request, res: Response) => {
    const auth = requireAuth(req, res); if (!auth) return;
    try {
      const tab = String(req.query.tab || 'all');
      const sort = String(req.query.sort || 'featured');
      const limit = Math.min(80, Math.max(1, parseInt(String(req.query.limit || '48'), 10)));
      const offset = Math.max(0, parseInt(String(req.query.offset || '0'), 10));

      const params: unknown[] = [auth.userId];
      let where = 'TRUE';
      if (tab === 'gpt') { where = `LOWER(m.model) LIKE '%gpt%'`; }
      else if (tab === 'gemini') { where = `(LOWER(m.model) LIKE '%gemini%' OR LOWER(m.model) LIKE '%nano%' OR LOWER(m.model) LIKE '%imagen%')`; }

      const order = sort === 'newest' ? 'm.created_at DESC'
        : sort === 'popular' ? 'm.likes_count DESC, m.created_at DESC'
        : 'm.featured DESC, m.likes_count DESC, m.created_at DESC';

      params.push(limit, offset);
      const { rows } = await pool.query(
        `SELECT m.id, m.title, m.prompt, m.model, m.category, m.image_url, m.thumb_url, m.likes_count, m.featured, m.created_at,
                (l.id IS NOT NULL) AS liked
         FROM mcp_media m
         LEFT JOIN mcp_media_likes l ON l.media_id = m.id AND l.user_id = $1
         WHERE ${where}
         ORDER BY ${order} LIMIT $2 OFFSET $3`,
        params
      );
      return res.json({ success: true, media: rows });
    } catch (err) {
      logger.error({ err }, 'mcp_media_list_failed');
      return res.status(500).json({ success: false, error: 'Failed to load media' });
    }
  });

  // GET /api/mcp/media/liked — powers Personalization → Images
  router.get('/media/liked', async (req: Request, res: Response) => {
    const auth = requireAuth(req, res); if (!auth) return;
    try {
      const { rows } = await pool.query(
        `SELECT m.id, m.title, m.prompt, m.model, m.image_url, m.thumb_url, l.created_at AS liked_at
         FROM mcp_media_likes l JOIN mcp_media m ON m.id = l.media_id
         WHERE l.user_id=$1 ORDER BY l.created_at DESC LIMIT 200`,
        [auth.userId]
      );
      return res.json({ success: true, media: rows });
    } catch (err) {
      logger.error({ err }, 'mcp_media_liked_failed');
      return res.status(500).json({ success: false, error: 'Failed to load liked images' });
    }
  });

  // GET /api/mcp/media/suggestions — similar style to what the user liked
  router.get('/media/suggestions', async (req: Request, res: Response) => {
    const auth = requireAuth(req, res); if (!auth) return;
    try {
      // Style profile: the models + categories of liked images. Suggest
      // unliked media matching either, most-liked models first.
      const { rows } = await pool.query(
        `WITH liked AS (
           SELECT m.model, m.category FROM mcp_media_likes l JOIN mcp_media m ON m.id=l.media_id WHERE l.user_id=$1
         )
         SELECT m.id, m.title, m.prompt, m.model, m.category, m.image_url, m.thumb_url, m.likes_count,
                ((m.model IN (SELECT model FROM liked))::int + (m.category IN (SELECT category FROM liked))::int) AS score
         FROM mcp_media m
         WHERE m.id NOT IN (SELECT media_id FROM mcp_media_likes WHERE user_id=$1)
           AND (EXISTS (SELECT 1 FROM liked) AND (m.model IN (SELECT model FROM liked) OR m.category IN (SELECT category FROM liked)))
         ORDER BY score DESC, m.likes_count DESC, m.created_at DESC
         LIMIT 40`,
        [auth.userId]
      );
      // No likes yet → fall back to overall featured/popular items.
      if (!rows.length) {
        const { rows: fallback } = await pool.query(
          `SELECT m.id, m.title, m.prompt, m.model, m.category, m.image_url, m.thumb_url, m.likes_count, 0 AS score
           FROM mcp_media m
           WHERE m.id NOT IN (SELECT media_id FROM mcp_media_likes WHERE user_id=$1)
           ORDER BY m.featured DESC, m.likes_count DESC, m.created_at DESC LIMIT 40`,
          [auth.userId]
        );
        return res.json({ success: true, media: fallback, based_on_likes: false });
      }
      return res.json({ success: true, media: rows, based_on_likes: true });
    } catch (err) {
      logger.error({ err }, 'mcp_media_suggestions_failed');
      return res.status(500).json({ success: false, error: 'Failed to load suggestions' });
    }
  });

  // GET /api/mcp/media/:id — detail + more-like-this
  router.get('/media/:id', async (req: Request, res: Response) => {
    const auth = requireAuth(req, res); if (!auth) return;
    try {
      const { rows } = await pool.query(
        `SELECT m.*, (l.id IS NOT NULL) AS liked
         FROM mcp_media m LEFT JOIN mcp_media_likes l ON l.media_id=m.id AND l.user_id=$2
         WHERE m.id=$1`,
        [req.params.id, auth.userId]
      );
      if (!rows.length) return res.status(404).json({ success: false, error: 'Not found' });
      const item = rows[0];
      const { rows: similar } = await pool.query(
        `SELECT id, image_url, thumb_url, model FROM mcp_media
         WHERE id <> $1 AND (model=$2 OR category=$3)
         ORDER BY likes_count DESC, created_at DESC LIMIT 12`,
        [item.id, item.model, item.category]
      );
      return res.json({ success: true, media: { ...item, raw: undefined }, similar });
    } catch (err) {
      logger.error({ err }, 'mcp_media_detail_failed');
      return res.status(500).json({ success: false, error: 'Failed to load media' });
    }
  });

  // POST /api/mcp/media/:id/like — toggle
  router.post('/media/:id/like', async (req: Request, res: Response) => {
    const auth = requireAuth(req, res); if (!auth) return;
    try {
      const { rows: existing } = await pool.query(
        `SELECT id FROM mcp_media_likes WHERE user_id=$1 AND media_id=$2`, [auth.userId, req.params.id]
      );
      let liked: boolean;
      if (existing.length) {
        await pool.query(`DELETE FROM mcp_media_likes WHERE id=$1`, [existing[0].id]);
        await pool.query(`UPDATE mcp_media SET likes_count=GREATEST(0, likes_count-1) WHERE id=$1`, [req.params.id]);
        liked = false;
      } else {
        await pool.query(
          `INSERT INTO mcp_media_likes (user_id, media_id) VALUES ($1,$2) ON CONFLICT DO NOTHING`,
          [auth.userId, req.params.id]
        );
        await pool.query(`UPDATE mcp_media SET likes_count=likes_count+1 WHERE id=$1`, [req.params.id]);
        liked = true;
      }
      const { rows } = await pool.query(`SELECT likes_count FROM mcp_media WHERE id=$1`, [req.params.id]);
      return res.json({ success: true, liked, likes_count: rows[0]?.likes_count ?? 0 });
    } catch (err) {
      logger.error({ err }, 'mcp_media_like_failed');
      return res.status(500).json({ success: false, error: 'Failed to update like' });
    }
  });

  return router;
}
