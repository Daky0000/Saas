import { createHash } from 'node:crypto';
import express from 'express';
import { decode as decodePng, convertIndexedToRgb } from 'fast-png';
import jpegJs from 'jpeg-js';
import type { Router, Response } from 'express';
import type { Request } from '../types/http.ts';
import { logger } from '../logger.ts';
import { config } from '../config.ts';
import { fetchMediaBytes } from '../ssrf-guard.ts';
import { getBackendPublicUrl } from '../platform-helpers.ts';
import { resolveAssetStorage, type AssetStorageDriver } from './autopilot/assetStorage.ts';
import { dbQuery, hasDatabase } from '../db.ts';

// ─────────────────────────────────────────────────────────────────────────────
// Durable media for everything outside autopilot (content plans, Magnific
// studio and chat, scheduled posts). Provider links expire within hours and
// base64 data URLs bloat rows and cannot be fetched by social platforms, so
// generated media is copied into the same S3-compatible bucket autopilot uses
// (Cloudflare R2 in production).
//
// Objects are content-addressed (`media/<sha256>.<ext>`), so the same bytes are
// stored once however often they are saved. The stored URL is a stable app
// route, `/media/r2/<sha256>.<ext>`, that redirects to a short-lived presigned
// R2 URL; the bucket itself stays private. Without S3 storage configured every
// helper here returns its input unchanged.
// ─────────────────────────────────────────────────────────────────────────────

const ROUTE_PREFIX = '/media/r2/';
const KEY_PREFIX = 'media/';
const FILE_RE = /^[a-f0-9]{64}\.(png|jpg|webp|gif|mp4|webm|mov|mp3|wav|m4a)$/;
const MAX_BYTES = 200 * 1024 * 1024;

const EXT_BY_MIME: Record<string, string> = {
  'image/png': 'png', 'image/jpeg': 'jpg', 'image/jpg': 'jpg', 'image/webp': 'webp', 'image/gif': 'gif',
  'video/mp4': 'mp4', 'video/webm': 'webm', 'video/quicktime': 'mov',
  'audio/mpeg': 'mp3', 'audio/mp3': 'mp3', 'audio/wav': 'wav', 'audio/x-wav': 'wav', 'audio/mp4': 'm4a',
};
const MIME_BY_EXT: Record<string, string> = {
  png: 'image/png', jpg: 'image/jpeg', webp: 'image/webp', gif: 'image/gif',
  mp4: 'video/mp4', webm: 'video/webm', mov: 'video/quicktime', mp3: 'audio/mpeg', wav: 'audio/wav', m4a: 'audio/mp4',
};

// Providers sometimes answer with a generic type; the leading bytes settle it.
function sniffMime(buf: Buffer, declared: string): string {
  if (buf.length >= 8 && buf.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return 'image/png';
  if (buf.length >= 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return 'image/jpeg';
  if (buf.length >= 12 && buf.toString('ascii', 0, 4) === 'RIFF' && buf.toString('ascii', 8, 12) === 'WEBP') return 'image/webp';
  if (buf.length >= 6 && buf.toString('ascii', 0, 3) === 'GIF') return 'image/gif';
  if (buf.length >= 12 && buf.toString('ascii', 4, 8) === 'ftyp') return declared.startsWith('audio/') ? declared : 'video/mp4';
  if (buf.length >= 4 && buf.readUInt32BE(0) === 0x1a45dfa3) return 'video/webm';
  return declared;
}

/**
 * PNG → JPEG (alpha flattened onto white). Instagram's API takes only JPEG
 * stills, and every other platform accepts JPEG, so media headed for a social
 * post is stored as JPEG. Returns null for input it cannot convert.
 */
export function pngToJpeg(png: Buffer, quality = 90): Buffer | null {
  try {
    const img = decodePng(png);
    const rgb = img.palette ? convertIndexedToRgb(img) : img.data;
    const channels = img.palette ? (img.palette[0]?.length ?? 3) : img.channels;
    const shift = img.depth === 16 ? 8 : 0;
    if (!img.palette && img.depth !== 8 && img.depth !== 16) return null;
    const out = Buffer.alloc(img.width * img.height * 4);
    for (let p = 0, s = 0; p < out.length; p += 4, s += channels) {
      const g = channels <= 2;
      let r = rgb[s] >> shift;
      let gr = (g ? rgb[s] : rgb[s + 1]) >> shift;
      let b = (g ? rgb[s] : rgb[s + 2]) >> shift;
      const a = channels === 4 ? rgb[s + 3] >> shift : channels === 2 ? rgb[s + 1] >> shift : 255;
      if (a < 255) {
        r = Math.round((r * a + 255 * (255 - a)) / 255);
        gr = Math.round((gr * a + 255 * (255 - a)) / 255);
        b = Math.round((b * a + 255 * (255 - a)) / 255);
      }
      out[p] = r; out[p + 1] = gr; out[p + 2] = b; out[p + 3] = 255;
    }
    return Buffer.from(jpegJs.encode({ data: out, width: img.width, height: img.height }, quality).data);
  } catch {
    return null;
  }
}

let cached: { driver: AssetStorageDriver | null; description: string } | null = null;

/** The bucket driver, or null when S3-compatible storage is not configured. */
export function getMediaStorage(): AssetStorageDriver | null {
  if (!cached) {
    const r = resolveAssetStorage({ env: process.env });
    // Only object storage qualifies; the postgres blob store is autopilot's own fallback.
    cached = { driver: r.driver?.name === 's3' ? r.driver : null, description: r.description };
  }
  return cached.driver;
}

/** Test seam: swap the driver (null to reset to the environment's). */
export function setMediaStorageForTests(driver: AssetStorageDriver | null | undefined): void {
  cached = driver === undefined ? null : { driver, description: 'test' };
}

// ── Database fallback ────────────────────────────────────────────────────────
//
// Without S3-compatible storage, media is kept in Postgres (media_blobs) and
// served from the same public route, so uploads, generated images and videos
// still get a stable https address that Magnific, social platforms and
// browsers can fetch. Content-addressed and immutable, like the bucket copy.
// Files above DB_MAX_BYTES need object storage.

export const DB_MAX_BYTES = 50 * 1024 * 1024;
let dbReady: Promise<void> | null = null;
function ensureBlobTable(): Promise<void> {
  dbReady ??= dbQuery(`
    CREATE TABLE IF NOT EXISTS media_blobs (
      file TEXT PRIMARY KEY,
      mime TEXT NOT NULL,
      bytes BYTEA NOT NULL,
      size INTEGER NOT NULL,
      tenant_id TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )`).then(() => undefined).catch((err) => { dbReady = null; throw err; });
  return dbReady;
}

/** The database fallback's storage (swappable in tests). */
interface BlobBackend {
  available(): boolean;
  put(file: string, buffer: Buffer, mime: string, tenantId: string): Promise<void>;
  get(file: string): Promise<{ bytes: Buffer; mime: string } | null>;
}
let blobBackend: BlobBackend = { available: () => hasDatabase(), put: (...a) => dbPutPg(...a), get: (f) => dbGetPg(f) };
/** Test seam: an in-memory database fallback (null resets to Postgres). */
export function setMediaBlobBackendForTests(b: BlobBackend | null): void {
  blobBackend = b ?? { available: () => hasDatabase(), put: (...a) => dbPutPg(...a), get: (f) => dbGetPg(f) };
}
const dbPut = (file: string, buffer: Buffer, mime: string, tenantId: string) => blobBackend.put(file, buffer, mime, tenantId);
const dbGet = (file: string) => blobBackend.get(file);
const dbAvailable = () => blobBackend.available();

/** True when media can be stored at all: object storage, or the database fallback. */
export function mediaStorageAvailable(): boolean {
  return Boolean(getMediaStorage()) || dbAvailable();
}

async function dbPutPg(file: string, buffer: Buffer, mime: string, tenantId: string): Promise<void> {
  await ensureBlobTable();
  await dbQuery(
    `INSERT INTO media_blobs (file, mime, bytes, size, tenant_id) VALUES ($1,$2,$3,$4,$5) ON CONFLICT (file) DO NOTHING`,
    [file, mime, buffer, buffer.length, tenantId],
  );
}

async function dbGetPg(file: string): Promise<{ bytes: Buffer; mime: string } | null> {
  await ensureBlobTable();
  const { rows } = await dbQuery<{ bytes: Buffer; mime: string }>(`SELECT bytes, mime FROM media_blobs WHERE file=$1`, [file]);
  return rows[0] ? { bytes: Buffer.from(rows[0].bytes), mime: rows[0].mime } : null;
}

function publicBase(): string {
  return (getBackendPublicUrl() || config.appUrl).replace(/\/$/, '');
}

export function isStoredMediaUrl(url: string | null | undefined): boolean {
  return Boolean(storedMediaFile(url));
}

function storedMediaFile(url: string | null | undefined): string | null {
  const raw = String(url || '').trim();
  const idx = raw.indexOf(ROUTE_PREFIX);
  if (idx < 0) return null;
  const file = raw.slice(idx + ROUTE_PREFIX.length).split(/[?#]/)[0];
  return FILE_RE.test(file) ? file : null;
}

export interface StoreOptions {
  /** Store PNG stills as JPEG, for media that will go to a social platform. */
  jpeg?: boolean;
}

/** Stores bytes and returns their stable URL. Throws when storage is missing or the write fails. */
export async function storeMediaBytes(buffer: Buffer, declaredMime: string, tenantId = 'shared', opts: StoreOptions = {}): Promise<string> {
  const driver = getMediaStorage();
  if (!driver && !dbAvailable()) throw new Error('Media storage is not configured');
  if (!buffer.length) throw new Error('Empty media');
  if (buffer.length > MAX_BYTES) throw new Error('Media exceeds the size limit');
  let mimeType = sniffMime(buffer, String(declaredMime || '').toLowerCase());
  if (opts.jpeg && mimeType === 'image/png') {
    const converted = pngToJpeg(buffer);
    if (converted) { buffer = converted; mimeType = 'image/jpeg'; }
  }
  const ext = EXT_BY_MIME[mimeType];
  if (!ext) throw new Error(`Unsupported media type ${mimeType || 'unknown'}`);
  const sha256 = createHash('sha256').update(buffer).digest('hex');
  const file = `${sha256}.${ext}`;
  const key = `${KEY_PREFIX}${file}`;
  if (driver) {
    const existing = await driver.head(key).catch(() => null);
    if (!existing) await driver.put(key, buffer, MIME_BY_EXT[ext], { sha256, tenantId });
  } else {
    if (buffer.length > DB_MAX_BYTES) throw new Error(`Files over ${Math.round(DB_MAX_BYTES / 1024 / 1024)} MB need object storage`);
    await dbPut(file, buffer, MIME_BY_EXT[ext], tenantId);
  }
  return `${publicBase()}${ROUTE_PREFIX}${file}`;
}

/**
 * Copies a provider URL or data URL into the bucket and returns the stable
 * URL. Never throws: on any failure (or with no storage) the input comes back,
 * so a storage outage degrades to the old behaviour instead of losing a result.
 */
export async function durableMediaUrl(url: string | null | undefined, tenantId = 'shared', opts: StoreOptions = {}): Promise<string> {
  const raw = String(url || '').trim();
  if (!raw || !mediaStorageAvailable()) return raw;
  if (isStoredMediaUrl(raw)) return opts.jpeg ? jpegStoredMediaUrl(raw, tenantId) : raw;
  if (!/^(https:\/\/|data:)/i.test(raw)) return raw;
  try {
    const { buffer, mimeType } = await fetchMediaBytes(raw, { maxBytes: MAX_BYTES, timeoutMs: 120_000 });
    return await storeMediaBytes(buffer, mimeType, tenantId, opts);
  } catch (err) {
    logger.warn({ err: err instanceof Error ? err.message : err, source: raw.startsWith('data:') ? 'data-url' : new URL(raw).host }, 'media_store_copy_failed');
    return raw;
  }
}

/** A stored PNG's JPEG twin (stored on first use); any other stored URL unchanged. */
async function jpegStoredMediaUrl(url: string, tenantId: string): Promise<string> {
  const file = storedMediaFile(url);
  const driver = getMediaStorage();
  if (!file || !file.endsWith('.png') || (!driver && !dbAvailable())) return url;
  try {
    const bytes = driver ? await driver.get(`${KEY_PREFIX}${file}`) : (await dbGet(file))?.bytes ?? null;
    return bytes ? await storeMediaBytes(bytes, 'image/png', tenantId, { jpeg: true }) : url;
  } catch (err) {
    logger.warn({ err: err instanceof Error ? err.message : err }, 'media_store_jpeg_failed');
    return url;
  }
}

/** durableMediaUrl for a list, preserving order. */
export async function durableMediaUrls(urls: Array<string | null | undefined>, tenantId = 'shared', opts: StoreOptions = {}): Promise<string[]> {
  return Promise.all(urls.map((u) => durableMediaUrl(u, tenantId, opts)));
}

/**
 * For handing to a platform that fetches the file itself: a stored URL becomes
 * a direct presigned bucket URL (no redirect hop); anything else is unchanged.
 */
export function directMediaUrl(url: string, ttlSeconds = 24 * 60 * 60): string {
  const file = storedMediaFile(url);
  const driver = getMediaStorage();
  if (!file || !driver) return url;
  return driver.deliveryUrl(`${KEY_PREFIX}${file}`, ttlSeconds);
}

/** GET /media/r2/<sha256>.<ext> → 302 to a presigned bucket URL. Public, like the posts that embed it. */
export function registerMediaStoreRoutes(): Router {
  const router = express.Router();
  router.get(`${ROUTE_PREFIX}:file`, async (req: Request, res: Response) => {
    const file = String(req.params.file || '');
    const driver = getMediaStorage();
    if (!FILE_RE.test(file)) return res.status(404).end();
    if (!driver) {
      // Database fallback: the bytes themselves (content-addressed, so cacheable for a year).
      if (!dbAvailable()) return res.status(503).json({ error: 'Media storage is not configured' });
      try {
        const blob = await dbGet(file);
        if (!blob) return res.status(404).end();
        res.setHeader('Content-Type', blob.mime);
        res.setHeader('Content-Length', String(blob.bytes.length));
        res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
        res.setHeader('Cross-Origin-Resource-Policy', 'cross-origin');
        return res.end(blob.bytes);
      } catch (err) {
        logger.warn({ err: err instanceof Error ? err.message : err }, 'media_blob_read_failed');
        return res.status(500).end();
      }
    }
    // Presigned for an hour; the redirect itself may be cached a little less.
    // Embeddable from customers' sites (WordPress, newsletters), unlike helmet's default.
    res.setHeader('Cache-Control', 'public, max-age=3000');
    res.setHeader('Cross-Origin-Resource-Policy', 'cross-origin');
    return res.redirect(302, driver.deliveryUrl(`${KEY_PREFIX}${file}`, 3600));
  });
  return router;
}
