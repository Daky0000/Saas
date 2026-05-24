import express from 'express';
import type { Router, Request, Response } from 'express';
import { randomUUID } from 'crypto';
import axios from 'axios';
import { logger } from '../logger.ts';

type AuthResult = { userId: string; role?: string } | null;
type Pool = { query: (sql: string, params?: unknown[]) => Promise<{ rows: any[] }> };

interface MagnificDeps {
  requireAuth: (req: Request, res: Response) => AuthResult;
  requireAdmin: (req: Request, res: Response) => Promise<AuthResult>;
  hasDatabase: () => boolean;
  pool: Pool | null;
}

// ── Module-level constants (read from process.env at startup) ─────────────────

export const _PROXY = (() => {
  const raw = (process.env.MAGNIFIC_PROXY_URL ?? '').trim().replace(/\/$/, '');
  if (!raw) return '';
  try { new URL(raw); return raw; }
  catch { logger.error(`[proxy] Invalid MAGNIFIC_PROXY_URL "${raw}" — must start with https://. Falling back to direct API.`); return ''; }
})();

export const MAGNIFIC_BASE = _PROXY ? `${_PROXY}/magnific` : 'https://api.magnific.com';
export const FREEPIK_BASE = _PROXY ? `${_PROXY}/freepik` : 'https://api.freepik.com';
export const BROWSER_UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';

export const ASPECT_TO_WH: Record<string, { width: number; height: number }> = {
  'square_1_1':        { width: 1024, height: 1024 },
  'widescreen_16_9':   { width: 1280, height: 720 },
  'portrait_9_16':     { width: 720,  height: 1280 },
  'social_story_9_16': { width: 720,  height: 1280 },
  'classic_4_3':       { width: 1024, height: 768 },
  'portrait_3_4':      { width: 768,  height: 1024 },
  'traditional_3_4':   { width: 768,  height: 1024 },
  'cinematic_21_9':    { width: 1024, height: 448 },
  'portrait_2_3':      { width: 768,  height: 1152 },
  'standard_3_2':      { width: 1024, height: 683 },
};

export const MAGNIFIC_IMAGE_MODELS: Record<string, {
  endpoint: string;
  pollPath: (id: string) => string;
  bodyType: 'aspect_ratio' | 'image_size' | 'width_height';
  credits: number;
}> = {
  'flux-2-turbo':          { endpoint: '/v1/ai/text-to-image/flux-2-turbo',                     pollPath: (id) => `/v1/ai/text-to-image/flux-2-turbo/${id}`,                     bodyType: 'image_size',    credits: 3 },
  'flux-2-klein':          { endpoint: '/v1/ai/text-to-image/flux-2-klein',                     pollPath: (id) => `/v1/ai/text-to-image/flux-2-klein/${id}`,                     bodyType: 'aspect_ratio',  credits: 3 },
  'flux-kontext-pro':      { endpoint: '/v1/ai/text-to-image/flux-kontext-pro',                 pollPath: (id) => `/v1/ai/text-to-image/flux-kontext-pro/${id}`,                 bodyType: 'aspect_ratio',  credits: 5 },
  'flux-2-pro':            { endpoint: '/v1/ai/text-to-image/flux-2-pro',                       pollPath: (id) => `/v1/ai/text-to-image/flux-2-pro/${id}`,                       bodyType: 'width_height',  credits: 5 },
  'flux-dev':              { endpoint: '/v1/ai/text-to-image/flux-dev',                         pollPath: (id) => `/v1/ai/text-to-image/flux-dev/${id}`,                         bodyType: 'aspect_ratio',  credits: 4 },
  'flux-pro-v1-1':         { endpoint: '/v1/ai/text-to-image/flux-pro-v1-1',                    pollPath: (id) => `/v1/ai/text-to-image/flux-pro-v1-1/${id}`,                    bodyType: 'aspect_ratio',  credits: 5 },
  'hyperflux':             { endpoint: '/v1/ai/text-to-image/hyperflux',                        pollPath: (id) => `/v1/ai/text-to-image/hyperflux/${id}`,                        bodyType: 'aspect_ratio',  credits: 3 },
  'seedream-v5-lite':      { endpoint: '/v1/ai/text-to-image/seedream-v5-lite',                 pollPath: (id) => `/v1/ai/text-to-image/seedream-v5-lite/${id}`,                 bodyType: 'aspect_ratio',  credits: 4 },
  'seedream-v4-5':         { endpoint: '/v1/ai/text-to-image/seedream-v4-5',                    pollPath: (id) => `/v1/ai/text-to-image/seedream-v4-5/${id}`,                    bodyType: 'aspect_ratio',  credits: 4 },
  'seedream-v4':           { endpoint: '/v1/ai/text-to-image/seedream-v4',                      pollPath: (id) => `/v1/ai/text-to-image/seedream-v4/${id}`,                      bodyType: 'aspect_ratio',  credits: 5 },
  'gemini-flash':          { endpoint: '/v1/ai/text-to-image/gemini-2-5-flash-image-preview',   pollPath: (id) => `/v1/ai/text-to-image/gemini-2-5-flash-image-preview/${id}`,   bodyType: 'aspect_ratio',  credits: 6 },
  'nano-banana-pro-flash': { endpoint: '/v1/ai/text-to-image/nano-banana-pro-flash',            pollPath: (id) => `/v1/ai/text-to-image/nano-banana-pro-flash/${id}`,            bodyType: 'aspect_ratio',  credits: 3 },
  'nano-banana-pro':       { endpoint: '/v1/ai/text-to-image/nano-banana-pro',                  pollPath: (id) => `/v1/ai/text-to-image/nano-banana-pro/${id}`,                  bodyType: 'aspect_ratio',  credits: 4 },
  'z-image':               { endpoint: '/v1/ai/text-to-image/z-image',                          pollPath: (id) => `/v1/ai/text-to-image/z-image/${id}`,                          bodyType: 'aspect_ratio',  credits: 2 },
  'mystic':                { endpoint: '/v1/ai/mystic',                                          pollPath: (id) => `/v1/ai/mystic/${id}`,                                          bodyType: 'aspect_ratio',  credits: 8 },
};

export const MAGNIFIC_VIDEO_MODELS: Record<string, { endpoint: string; pollPath: (id: string) => string; credits: number }> = {
  'wan-2-7-t2v':      { endpoint: '/v1/ai/text-to-video/wan-2-7',         pollPath: (id) => `/v1/ai/text-to-video/wan-2-7/${id}`,         credits: 25 },
  'happy-horse-i2v':  { endpoint: '/v1/ai/image-to-video/happy-horse-1',  pollPath: (id) => `/v1/ai/image-to-video/happy-horse-1/${id}`,  credits: 20 },
  'kling-3-pro':      { endpoint: '/v1/ai/video/kling-v3-pro',            pollPath: (id) => `/v1/ai/video/kling-v3-pro/${id}`,            credits: 35 },
};

export const ASPECT_RATIO_MAP: Record<string, string> = {
  '1:1':   'square_1_1',
  '16:9':  'widescreen_16_9',
  '9:16':  'portrait_9_16',
  '4:3':   'classic_4_3',
  '3:4':   'portrait_3_4',
  '21:9':  'cinematic_21_9',
};

export const FREEPIK_IMAGE_MODELS: Record<string, { credits: number; type: 'async' }> = {
  'freepik-mystic': { credits: 5, type: 'async' },
};

// ── Exported helper functions ─────────────────────────────────────────────────

export function sanitizeMagnificError(raw: string): string {
  if (raw.toLowerCase().includes('free trial') || raw.toLowerCase().includes('magnific.com/developers')) {
    logger.error('[Magnific] Account limit reached:', raw);
    return 'Video generation is temporarily unavailable. Please try again later.';
  }
  return raw;
}

export function proxyHeaders(extra: Record<string, string> = {}): Record<string, string> {
  const h: Record<string, string> = {
    'User-Agent': BROWSER_UA,
    'Accept': 'application/json, */*',
    'Accept-Language': 'en-US,en;q=0.9',
    ...extra,
  };
  if (process.env.MAGNIFIC_PROXY_SECRET) h['X-Proxy-Secret'] = process.env.MAGNIFIC_PROXY_SECRET;
  return h;
}

export async function getMagnificApiKey(pool: Pool | null): Promise<string> {
  const envKey = process.env.MAGNIFIC_API_KEY;
  if (envKey) return envKey;
  try {
    const cfg = await pool!.query(`SELECT config FROM platform_configs WHERE platform = 'magnific' LIMIT 1`);
    return cfg.rows[0]?.config?.apiKey ?? '';
  } catch (_err) { return ''; }
}

export async function getFreepikApiKey(pool: Pool | null): Promise<string> {
  const envKey = process.env.FREEPIK_API_KEY;
  if (envKey) return envKey;
  try {
    const cfg = await pool!.query(`SELECT config FROM platform_configs WHERE platform = 'freepik' LIMIT 1`);
    const dbKey: string = cfg.rows[0]?.config?.apiKey ?? '';
    if (dbKey) return dbKey;
  } catch (_err) { /* ignore */ }
  return getMagnificApiKey(pool);
}

export async function magnificPost(path: string, body: object, apiKey: string) {
  return axios.post(`${MAGNIFIC_BASE}${path}`, body, {
    headers: proxyHeaders({
      'x-magnific-api-key': apiKey,
      'Content-Type': 'application/json',
      'Origin': 'https://app.magnific.com',
      'Referer': 'https://app.magnific.com/',
    }),
    validateStatus: () => true,
    timeout: 15000,
  });
}

export async function pollMagnificTask(
  taskPath: string,
  apiKey: string,
  maxSeconds = 120,
  onProgress?: (status: string) => void
): Promise<{ url: string | null; error: string | null }> {
  const deadline = Date.now() + maxSeconds * 1000;
  while (Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, 3000));
    const r = await axios.get(`${MAGNIFIC_BASE}${taskPath}`, {
      headers: proxyHeaders({
        'x-magnific-api-key': apiKey,
        'Origin': 'https://app.magnific.com',
        'Referer': 'https://app.magnific.com/',
      }),
      validateStatus: () => true,
      timeout: 10000,
    });
    const data = r.data?.data ?? r.data;
    const status: string = data?.status ?? '';
    onProgress?.(status);
    if (status === 'COMPLETED') {
      const urls: string[] = data.generated ?? data.output ?? (data.output_url ? [data.output_url] : []) ?? (data.url ? [data.url] : []);
      return { url: urls[0] ?? null, error: null };
    }
    if (status === 'FAILED') {
      return { url: null, error: data?.error ?? 'Generation failed' };
    }
  }
  return { url: null, error: 'Timeout: generation took too long' };
}

export async function magnificGenerateImage(
  modelId: string,
  prompt: string,
  aspectRatio: string,
  apiKey: string,
  onProgress?: (status: string) => void
): Promise<{ url: string | null; taskId: string | null; error: string | null }> {
  const cfg = MAGNIFIC_IMAGE_MODELS[modelId] ?? MAGNIFIC_IMAGE_MODELS['flux-2-turbo'];

  let body: object;
  if (cfg.bodyType === 'image_size') {
    const wh = ASPECT_TO_WH[aspectRatio] ?? { width: 1024, height: 1024 };
    body = { prompt, image_size: wh, guidance_scale: 2.5, output_format: 'jpeg' };
  } else if (cfg.bodyType === 'width_height') {
    const wh = ASPECT_TO_WH[aspectRatio] ?? { width: 1024, height: 768 };
    body = { prompt, width: wh.width, height: wh.height };
  } else {
    body = { prompt, aspect_ratio: aspectRatio };
  }

  const submitResp = await magnificPost(cfg.endpoint, body, apiKey);
  logger.info(`[Magnific] ${modelId} ${cfg.endpoint} → HTTP ${submitResp.status}`, JSON.stringify(submitResp.data)?.slice(0, 300));
  if (submitResp.status >= 400) {
    const isHtml = typeof submitResp.data === 'string' && submitResp.data.trimStart().startsWith('<');
    const msg = isHtml
      ? `Image generation service blocked (HTTP ${submitResp.status}) — API key may be invalid or service is unavailable from this server`
      : (submitResp.data?.message ?? submitResp.data?.error ?? submitResp.data?.detail ?? JSON.stringify(submitResp.data) ?? `Magnific API error`);
    return { url: null, taskId: null, error: sanitizeMagnificError(`HTTP ${submitResp.status}: ${msg}`) };
  }

  const taskId: string = submitResp.data?.data?.task_id ?? submitResp.data?.task_id ?? submitResp.data?.data?.id ?? submitResp.data?.id;
  if (!taskId) {
    logger.error('[Magnific] response missing task_id:', JSON.stringify(submitResp.data)?.slice(0, 500));
    return { url: null, taskId: null, error: 'No task_id in Magnific response' };
  }
  const poll = await pollMagnificTask(cfg.pollPath(taskId), apiKey, 120, onProgress);
  return { url: poll.url, taskId, error: poll.error };
}

export async function freepikGenerateImage(
  _model: string,
  prompt: string,
  aspectRatio: string,
  apiKey: string,
  onProgress?: (status: string) => void
): Promise<{ url: string | null; error: string | null }> {
  const freepikHeaders = proxyHeaders({
    'x-freepik-api-key': apiKey,
    'Content-Type': 'application/json',
    'Origin': 'https://www.freepik.com',
    'Referer': 'https://www.freepik.com/',
  });
  const submitResp = await axios.post(
    `${FREEPIK_BASE}/v1/ai/mystic`,
    { prompt, negative_prompt: '', image: { size: aspectRatio }, output_format: 'jpeg', num_images: 1, filter_nsfw: true },
    { headers: freepikHeaders, validateStatus: () => true, timeout: 20000 }
  );
  if (submitResp.status >= 400) {
    const isHtml = typeof submitResp.data === 'string' && submitResp.data.trimStart().startsWith('<');
    return { url: null, error: isHtml ? `Service blocked (HTTP ${submitResp.status})` : (submitResp.data?.message ?? `Freepik mystic error ${submitResp.status}`) };
  }
  const taskId = submitResp.data?.data?.task_id ?? submitResp.data?.task_id;
  if (!taskId) return { url: null, error: 'No task_id returned from Freepik mystic' };

  const deadline = Date.now() + 150_000;
  while (Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, 4000));
    const pollResp = await axios.get(`${FREEPIK_BASE}/v1/ai/mystic/${taskId}`, {
      headers: proxyHeaders({
        'x-freepik-api-key': apiKey,
        'Origin': 'https://www.freepik.com',
        'Referer': 'https://www.freepik.com/',
      }),
      validateStatus: () => true,
      timeout: 10000,
    });
    const data = pollResp.data?.data ?? pollResp.data;
    const status: string = data?.status ?? '';
    onProgress?.(status);
    if (status === 'COMPLETED') {
      const imgs: string[] = data?.generated ?? [];
      return { url: imgs[0] ?? null, error: imgs[0] ? null : 'No image URL in Freepik response' };
    }
    if (status === 'FAILED') return { url: null, error: data?.error ?? 'Freepik generation failed' };
  }
  return { url: null, error: 'Timeout: Freepik generation took too long' };
}

// ── Route factory ─────────────────────────────────────────────────────────────

export function registerMagnificRoutes({ requireAuth, requireAdmin, hasDatabase, pool }: MagnificDeps): Router {
  const router = express.Router();

  // GET /api/admin/magnific/config
  router.get('/admin/magnific/config', async (req: Request, res: Response) => {
    const admin = await requireAdmin(req, res);
    if (!admin) return;
    if (!hasDatabase()) return res.status(503).json({ error: 'Database unavailable' });
    try {
      const r = await pool!.query(`SELECT config FROM platform_configs WHERE platform='magnific' LIMIT 1`);
      const key: string = r.rows[0]?.config?.apiKey ?? '';
      const masked = key.length > 8 ? `${'*'.repeat(key.length - 4)}${key.slice(-4)}` : (key ? '****' : '');
      return res.json({ success: true, hasKey: !!key, maskedKey: masked });
    } catch (e: any) {
      return res.status(500).json({ error: e.message });
    }
  });

  // PUT /api/admin/magnific/config
  router.put('/admin/magnific/config', async (req: Request, res: Response) => {
    const admin = await requireAdmin(req, res);
    if (!admin) return;
    if (!hasDatabase()) return res.status(503).json({ error: 'Database unavailable' });
    const { apiKey } = req.body as { apiKey?: string };
    if (!apiKey?.trim()) return res.status(400).json({ error: 'apiKey is required' });
    try {
      await pool!.query(
        `INSERT INTO platform_configs (platform, config, enabled, updated_at)
         VALUES ('magnific', $1, true, NOW())
         ON CONFLICT (platform) DO UPDATE SET config=$1, enabled=true, updated_at=NOW()`,
        [JSON.stringify({ apiKey: apiKey.trim() })]
      );
      return res.json({ success: true });
    } catch (e: any) {
      return res.status(500).json({ error: e.message });
    }
  });

  // GET /api/admin/magnific/test
  router.get('/admin/magnific/test', async (req: Request, res: Response) => {
    const admin = await requireAdmin(req, res);
    if (!admin) return;
    const apiKey = await getMagnificApiKey(pool);
    if (!apiKey) return res.status(400).json({ success: false, error: 'No API key configured' });
    try {
      const reqBody = { prompt: 'a red apple on a white table', image: { size: 'square_1_1' }, num_images: 1, filter_nsfw: true };
      const r = await axios.post(
        `${MAGNIFIC_BASE}/v1/ai/text-to-image`,
        reqBody,
        { headers: { 'x-magnific-api-key': apiKey, 'Content-Type': 'application/json' }, validateStatus: () => true, timeout: 30000 }
      );
      const keyHint = apiKey.length > 8 ? `${apiKey.slice(0, 4)}…${apiKey.slice(-4)}` : '(short key)';
      if (r.status === 401 || r.status === 403) {
        return res.json({ success: false, error: `Invalid API key (HTTP ${r.status})`, keyHint, magnific_response: r.data });
      }
      if (r.status >= 400) {
        return res.json({ success: false, error: `Magnific returned HTTP ${r.status}`, keyHint, magnific_response: r.data });
      }
      const hasImage = !!(r.data?.data?.[0]?.base64);
      return res.json({ success: true, status: r.status, keyHint, has_image: hasImage, magnific_response: hasImage ? '(base64 omitted)' : r.data });
    } catch (e: any) {
      return res.status(500).json({ success: false, error: e.message });
    }
  });

  // GET /api/admin/magnific/generations
  router.get('/admin/magnific/generations', async (req: Request, res: Response) => {
    const admin = await requireAdmin(req, res);
    if (!admin) return;
    if (!hasDatabase()) return res.status(503).json({ error: 'Database unavailable' });
    try {
      const { rows } = await pool!.query(
        `SELECT mg.*, u.email AS user_email, u.full_name AS user_full_name, u.username AS user_username, u.avatar_url AS user_avatar, df.id AS discover_id
         FROM magnific_generations mg
         LEFT JOIN users u ON u.id = mg.user_id
         LEFT JOIN discover_feed df ON df.generation_id = mg.id
         WHERE mg.status = 'completed' AND mg.result_url IS NOT NULL AND mg.type = 'image'
         ORDER BY mg.created_at DESC LIMIT 300`
      );
      return res.json({ success: true, generations: rows });
    } catch (e: any) {
      return res.status(500).json({ error: e.message });
    }
  });

  // GET /api/admin/freepik/config
  router.get('/admin/freepik/config', async (req: Request, res: Response) => {
    const admin = await requireAdmin(req, res);
    if (!admin) return;
    if (!hasDatabase()) return res.status(503).json({ error: 'Database unavailable' });
    try {
      const envKey: string = process.env.FREEPIK_API_KEY ?? '';
      if (envKey) {
        const masked = envKey.length > 8 ? `${'*'.repeat(envKey.length - 4)}${envKey.slice(-4)}` : '****';
        return res.json({ success: true, hasKey: true, maskedKey: masked, source: 'env' });
      }
      const r = await pool!.query(`SELECT config FROM platform_configs WHERE platform='freepik' LIMIT 1`);
      const key: string = r.rows[0]?.config?.apiKey ?? '';
      const masked = key.length > 8 ? `${'*'.repeat(key.length - 4)}${key.slice(-4)}` : (key ? '****' : '');
      return res.json({ success: true, hasKey: !!key, maskedKey: masked, source: 'db' });
    } catch (e: any) {
      return res.status(500).json({ error: e.message });
    }
  });

  // PUT /api/admin/freepik/config
  router.put('/admin/freepik/config', async (req: Request, res: Response) => {
    const admin = await requireAdmin(req, res);
    if (!admin) return;
    if (!hasDatabase()) return res.status(503).json({ error: 'Database unavailable' });
    const { apiKey } = req.body as { apiKey?: string };
    if (!apiKey?.trim()) return res.status(400).json({ error: 'apiKey is required' });
    try {
      await pool!.query(
        `INSERT INTO platform_configs (platform, config, enabled, updated_at)
         VALUES ('freepik', $1, true, NOW())
         ON CONFLICT (platform) DO UPDATE SET config=$1, enabled=true, updated_at=NOW()`,
        [JSON.stringify({ apiKey: apiKey.trim() })]
      );
      return res.json({ success: true });
    } catch (e: any) {
      return res.status(500).json({ error: e.message });
    }
  });

  // GET /api/admin/freepik/test
  router.get('/admin/freepik/test', async (req: Request, res: Response) => {
    const admin = await requireAdmin(req, res);
    if (!admin) return;
    const apiKey = await getFreepikApiKey(pool);
    if (!apiKey) return res.status(400).json({ success: false, error: 'No API key configured — set up Magnific in Admin.' });
    try {
      const keyHint = apiKey.length > 8 ? `${apiKey.slice(0, 4)}…${apiKey.slice(-4)}` : '(short key)';
      const r = await axios.post(
        `${FREEPIK_BASE}/v1/ai/mystic`,
        { prompt: 'a red apple', negative_prompt: '', image: { size: 'square_1_1' }, output_format: 'jpeg', num_images: 1 },
        { headers: { 'x-freepik-api-key': apiKey, 'Content-Type': 'application/json' }, validateStatus: () => true, timeout: 20000 }
      );
      if (r.status === 401 || r.status === 403) {
        return res.json({ success: false, error: `Invalid API key (HTTP ${r.status})`, keyHint });
      }
      if (r.status >= 400) {
        return res.json({ success: false, error: `Freepik returned HTTP ${r.status}`, keyHint, response: r.data });
      }
      return res.json({ success: true, status: r.status, keyHint, note: 'Key accepted — mystic task submitted' });
    } catch (e: any) {
      return res.status(500).json({ success: false, error: e.message });
    }
  });

  // GET /api/magnific/task/:id
  router.get('/magnific/task/:id', async (req: Request, res: Response) => {
    const auth = requireAuth(req, res);
    if (!auth) return;
    if (!hasDatabase()) return res.status(503).json({ error: 'Database unavailable' });
    try {
      const { rows } = await pool!.query(
        `SELECT status, result_url, error, type, model, created_at FROM magnific_generations WHERE id=$1 AND user_id=$2 LIMIT 1`,
        [req.params.id, auth.userId]
      );
      if (!rows[0]) return res.status(404).json({ error: 'Not found' });
      return res.json({ success: true, ...rows[0] });
    } catch (e: any) {
      return res.status(500).json({ error: e.message });
    }
  });

  // POST /api/magnific/improve-prompt
  router.post('/magnific/improve-prompt', async (req: Request, res: Response) => {
    const auth = requireAuth(req, res);
    if (!auth) return;
    const { prompt } = req.body as { prompt?: string };
    if (!prompt?.trim()) return res.status(400).json({ error: 'prompt is required' });
    const apiKey = await getMagnificApiKey(pool);
    if (!apiKey) return res.status(400).json({ error: 'Magnific not configured' });
    try {
      const r = await axios.post(
        `${MAGNIFIC_BASE}/v1/ai/improve-prompt`,
        { prompt: prompt.trim() },
        { headers: { 'x-magnific-api-key': apiKey, 'Content-Type': 'application/json' }, validateStatus: () => true, timeout: 12000 }
      );
      const improved: string = r.data?.data?.prompt ?? r.data?.prompt ?? '';
      if (!improved || r.status >= 400) {
        return res.status(400).json({ error: r.data?.message ?? 'Failed to improve prompt' });
      }
      return res.json({ success: true, prompt: improved });
    } catch (e: any) {
      return res.status(500).json({ error: e.message });
    }
  });

  // POST /api/magnific/edit — image editing tools (upscale, relight, style-transfer, remove-background)
  router.post('/magnific/edit', async (req: Request, res: Response) => {
    const auth = requireAuth(req, res);
    if (!auth) return;
    if (!hasDatabase()) return res.status(503).json({ error: 'Database unavailable' });

    const { type, image, image_url, reference_image, prompt, scale_factor, optimized_for, creativity, hdr, resemblance, style, change_background, style_strength, structure_strength } = req.body as Record<string, any>;
    if (!type) return res.status(400).json({ error: 'type is required' });

    const editCreditCosts: Record<string, number> = { 'upscale': 5, 'relight': 4, 'style-transfer': 5, 'remove-background': 1 };
    const creditCost = editCreditCosts[type] ?? 5;

    const credRow = await pool!.query<{ credits: number }>(
      'SELECT credits FROM user_credits WHERE user_id = $1', [auth.userId]
    ).catch(() => ({ rows: [] as { credits: number }[] }));
    const currentCredits = credRow.rows[0]?.credits ?? 0;
    if (currentCredits < creditCost) {
      return res.status(402).json({ error: 'Insufficient credits', credits: currentCredits, required: creditCost });
    }

    const apiKey = await getMagnificApiKey(pool);
    if (!apiKey) return res.status(400).json({ error: 'Magnific not configured — set up in Admin → Magnific AI.' });

    const genId = randomUUID();
    await pool!.query(
      `INSERT INTO magnific_generations (id, user_id, type, model, prompt, params, status) VALUES ($1, $2, $3, $4, $5, $6, 'pending')`,
      [genId, auth.userId, type, type, prompt ?? '', JSON.stringify({ type, scale_factor, optimized_for, style })]
    ).catch(() => undefined);

    try {
      let resultUrl: string | null = null;

      if (type === 'remove-background') {
        if (!image_url) return res.status(400).json({ error: 'image_url is required for remove-background' });
        const r = await axios.post(
          `${MAGNIFIC_BASE}/v1/ai/beta/remove-background`,
          { image_url },
          { headers: { 'x-magnific-api-key': apiKey, 'Content-Type': 'application/json' }, validateStatus: () => true, timeout: 30000 }
        );
        if (r.status >= 400) return res.status(400).json({ error: r.data?.message ?? 'Remove background failed' });
        resultUrl = r.data?.high_resolution ?? r.data?.url ?? null;

      } else if (type === 'upscale') {
        if (!image) return res.status(400).json({ error: 'image (base64) is required for upscale' });
        const body: Record<string, any> = { image, scale_factor: scale_factor ?? '2x' };
        if (optimized_for) body.optimized_for = optimized_for;
        if (creativity != null) body.creativity = creativity;
        if (hdr != null) body.hdr = hdr;
        if (resemblance != null) body.resemblance = resemblance;
        if (prompt) body.prompt = prompt;
        const r = await magnificPost('/v1/ai/image-upscaler', body, apiKey);
        if (r.status >= 400) return res.status(400).json({ error: r.data?.message ?? 'Upscale failed' });
        const taskId: string = r.data?.data?.task_id;
        if (!taskId) throw new Error('No task_id from upscaler');
        await pool!.query(`UPDATE magnific_generations SET task_id=$1, status='processing' WHERE id=$2`, [taskId, genId]).catch(() => undefined);
        const result = await pollMagnificTask(`/v1/ai/image-upscaler/${taskId}`, apiKey, 120);
        if (result.error) throw new Error(result.error);
        resultUrl = result.url;

      } else if (type === 'relight') {
        if (!image) return res.status(400).json({ error: 'image is required for relight' });
        const body: Record<string, any> = { image };
        if (prompt) body.prompt = prompt;
        if (style) body.style = style;
        if (change_background != null) body.change_background = change_background;
        const r = await magnificPost('/v1/ai/image-relight', body, apiKey);
        if (r.status >= 400) return res.status(400).json({ error: r.data?.message ?? 'Relight failed' });
        const taskId: string = r.data?.data?.task_id ?? r.data?.task_id;
        if (!taskId) throw new Error('No task_id from relight');
        await pool!.query(`UPDATE magnific_generations SET task_id=$1, status='processing' WHERE id=$2`, [taskId, genId]).catch(() => undefined);
        const result = await pollMagnificTask(`/v1/ai/image-relight/${taskId}`, apiKey, 120);
        if (result.error) throw new Error(result.error);
        resultUrl = result.url;

      } else if (type === 'style-transfer') {
        if (!image || !reference_image) return res.status(400).json({ error: 'image and reference_image are required for style-transfer' });
        const body: Record<string, any> = { image, reference_image };
        if (style_strength != null) body.style_strength = style_strength;
        if (structure_strength != null) body.structure_strength = structure_strength;
        if (prompt) body.prompt = prompt;
        const r = await magnificPost('/v1/ai/image-style-transfer', body, apiKey);
        if (r.status >= 400) return res.status(400).json({ error: r.data?.message ?? 'Style transfer failed' });
        const taskId: string = r.data?.task_id ?? r.data?.data?.task_id;
        if (!taskId) throw new Error('No task_id from style transfer');
        await pool!.query(`UPDATE magnific_generations SET task_id=$1, status='processing' WHERE id=$2`, [taskId, genId]).catch(() => undefined);
        const result = await pollMagnificTask(`/v1/ai/image-style-transfer/${taskId}`, apiKey, 120);
        if (result.error) throw new Error(result.error);
        resultUrl = result.url;
      } else {
        return res.status(400).json({ error: `Unknown edit type: ${type}` });
      }

      if (!resultUrl) throw new Error('No result URL returned');

      await pool!.query(
        `UPDATE magnific_generations SET status='completed', result_url=$1, completed_at=NOW() WHERE id=$2`,
        [resultUrl, genId]
      ).catch(() => undefined);

      await pool!.query(
        `UPDATE user_credits SET credits = GREATEST(0, credits - $1), updated_at = NOW() WHERE user_id = $2`,
        [creditCost, auth.userId]
      ).catch(() => undefined);

      return res.json({ success: true, url: resultUrl, gen_id: genId });
    } catch (e: any) {
      await pool!.query(`UPDATE magnific_generations SET status='failed', error=$1 WHERE id=$2`, [e.message, genId]).catch(() => undefined);
      return res.status(500).json({ error: e.message });
    }
  });

  return router;
}
