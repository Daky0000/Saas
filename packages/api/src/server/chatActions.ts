import { randomUUID } from 'crypto';
import { MAGNIFIC_IMAGE_MODELS, MAGNIFIC_VIDEO_MODELS } from './magnificRoutes.ts';
import {
  bestSlot, validTimeZone, FORMAT_LABEL, socialImageCredits, PLATFORM_LABEL, socialCopyCredits, socialVideoCredits, clampSlides, mediaPlan,
  normalizeFormat, normalizePlatform, postCredits, type SocialFormat, type SocialPlatform,
} from './socialFormats.ts';
import { creditsForMagnific, magnificAudioCost, magnificEditCost, magnificImageCost, magnificLipSyncCost, magnificOneCost, magnificVideoCost } from './aiPricing.ts';

// ─────────────────────────────────────────────────────────────────────────────
// Chat sessions (history) and credit-gated actions.
//
// Sessions: the chat's conversations, saved per user so they survive a reload
// and can be reopened from the history list.
//
// Actions: any tool that spends credits is not run when the model calls it.
// It is priced first and parked as a pending action; the chat shows the
// estimate with Proceed / Cancel, and only Proceed runs it.
// ─────────────────────────────────────────────────────────────────────────────

type Query = (sql: string, params?: unknown[]) => Promise<{ rows: any[] }>;

/** Credits for the words of one post (the content-plan copy rate); media is priced on top. */
export const BATCH_MAX_POSTS = 30;

let ensured: Promise<void> | null = null;

export function ensureChatTables(query: Query): Promise<void> {
  ensured ??= (async () => {
    await query(`
      CREATE TABLE IF NOT EXISTS chat_sessions (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL,
        title TEXT NOT NULL DEFAULT 'New chat',
        messages JSONB NOT NULL DEFAULT '[]'::jsonb,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )`);
    await query(`CREATE INDEX IF NOT EXISTS chat_sessions_user_idx ON chat_sessions(user_id, updated_at DESC)`);
    await query(`
      CREATE TABLE IF NOT EXISTS user_custom_instructions (
        user_id TEXT PRIMARY KEY,
        instructions TEXT NOT NULL DEFAULT '',
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )`);
    await query(`ALTER TABLE blog_posts ADD COLUMN IF NOT EXISTS social_platform TEXT`).catch(() => undefined);
    await query(`
      CREATE TABLE IF NOT EXISTS chat_pending_actions (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL,
        tool TEXT NOT NULL,
        args JSONB NOT NULL,
        credits INTEGER NOT NULL,
        label TEXT,
        status TEXT NOT NULL DEFAULT 'pending',
        result JSONB,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )`);
  })().catch((err) => { ensured = null; throw err; });
  return ensured;
}

export interface CreditEstimate { credits: number; label: string; lines: string[] }

/**
 * What a tool call will cost, from the same rates the tools charge. Null for
 * tools that spend nothing (they run straight away).
 */
export function estimateToolCredits(name: string, input: any): CreditEstimate | null {
  switch (name) {
    case 'create_posts_batch': {
      const posts = batchPosts(input);
      const n = posts.length;
      if (!n) return null;
      // One line per kind of post, e.g. "2 × Instagram carousel (5 slides): 64".
      const groups = new Map<string, { count: number; credits: number }>();
      let credits = 0;
      let images = 0;
      let videos = 0;
      for (const p of posts) {
        const c = postCredits(p.format, p.slides, p.with_image);
        const m = mediaPlan(p.format, p.slides, p.with_image);
        credits += c;
        images += m.images;
        videos += m.videos;
        const key = `${PLATFORM_LABEL[p.platform]} ${FORMAT_LABEL[p.format].toLowerCase()}${p.format === 'carousel' ? ` (${p.slides} slides)` : ''}${p.format === 'text' && p.with_image ? ' + image' : ''}`;
        const g = groups.get(key) ?? { count: 0, credits: 0 };
        g.count++;
        g.credits += c;
        groups.set(key, g);
      }
      const platforms = new Set(posts.map((p) => p.platform)).size;
      const lines = [...groups].map(([k, g]) => `${g.count} × ${k}: ${g.credits} credits`);
      lines.push(`Includes writing (${socialCopyCredits()}/post)${images ? `, ${images} image${images === 1 ? '' : 's'} (${socialImageCredits()} each)` : ''}${videos ? `, ${videos} video${videos === 1 ? '' : 's'} (${socialVideoCredits()} each)` : ''}. You're only charged for what is made.`);
      return {
        credits,
        label: `Create ${n} post${n === 1 ? '' : 's'}${platforms > 1 ? ` across ${platforms} platforms` : ` for ${PLATFORM_LABEL[posts[0].platform]}`}`,
        lines,
      };
    }
    // Magnific: the real price × 1.54 (server/aiPricing.ts), same as what the tool charges.
    case 'magnific_one_generate': {
      const opts = { mode: input?.mode === 'draft' ? 'draft' : 'quality', quality: input?.quality === 'normal' ? 'medium' : 'high', resolution: ['1k', '2k', '4k'].includes(input?.resolution) ? input.resolution : '2k' };
      const credits = creditsForMagnific(magnificOneCost(opts));
      return { credits, label: 'Generate an image with Magnific One', lines: [`Magnific One, ${opts.mode === 'draft' ? 'draft sheet' : `${opts.resolution} ${opts.quality === 'high' ? 'max quality' : 'standard quality'}`}: ${credits} credits`] };
    }
    case 'magnific_generate_image': {
      const model = input?.model && MAGNIFIC_IMAGE_MODELS[input.model] ? input.model : 'magnific-one';
      const credits = creditsForMagnific(magnificImageCost(model, { resolution: input?.resolution }));
      return { credits, label: `Generate an image (${model})`, lines: [`${model} image${input?.resolution === '4k' ? ' (4K)' : ''}: ${credits} credits`] };
    }
    case 'magnific_edit_image': {
      const type = String(input?.type || 'upscale');
      const credits = creditsForMagnific(magnificEditCost(type, input?.scale_factor));
      return { credits, label: `Edit an image (${type})`, lines: [`${type}${input?.scale_factor ? ` ${input.scale_factor}` : ''}: ${credits} credits`] };
    }
    case 'magnific_generate_video': {
      const model = input?.model && MAGNIFIC_VIDEO_MODELS[input.model] ? input.model : (input?.image_url ? 'kling-v2-6-pro' : 'ltx-2-pro');
      const credits = creditsForMagnific(magnificVideoCost(model, input ?? {}));
      return { credits, label: `Generate a video (${model})`, lines: [`${model}, ${Number(input?.duration) || 5} s${input?.resolution ? ` ${input.resolution}` : ''}${input?.generate_audio ? ' with audio' : ''}: ${credits} credits`] };
    }
    case 'magnific_lip_sync': {
      const credits = creditsForMagnific(magnificLipSyncCost());
      return { credits, label: 'Animate a lip-sync avatar', lines: [`OmniHuman lip-sync (audio up to 30 s): ${credits} credits`] };
    }
    case 'magnific_generate_audio': {
      const type = String(input?.type || 'sound-effects');
      const credits = creditsForMagnific(magnificAudioCost(type, input?.duration_seconds));
      return { credits, label: `Generate audio (${type})`, lines: [`${type}${input?.duration_seconds ? `, ${input.duration_seconds} s` : ''}: ${credits} credits`] };
    }
    case 'magnific_space_or_flow': {
      const action = String(input?.action || 'run_space');
      if (action !== 'run_space' && action !== 'run_flow') return null;
      // Replaced by the Space's own node-by-node estimate when the chat prices it.
      const credits = creditsForMagnific(1500);
      return { credits, label: action === 'run_flow' ? 'Run a Magnific Flow' : 'Run a Magnific Space', lines: [`Estimated ${credits} credits`] };
    }
    default:
      return null;
  }
}

export interface BatchPost {
  topic: string;
  platform: SocialPlatform;
  format: SocialFormat;
  /** Carousel slide count (3–10). */
  slides: number;
  /** A text post that should still carry an image. */
  with_image: boolean;
  /** Art direction for the visuals, when the planner gave one. */
  visual: string;
  scheduled_at: string;
  /** Only when the user asked for drafts: saved unscheduled. */
  as_draft: boolean;
}

/**
 * The batch tool's posts, cleaned: one native post per platform (an entry
 * naming several platforms becomes one post each), at most 30, each with a
 * format the platform supports and a date (tomorrow 09:00 UTC onwards, one
 * day apart per entry, when not given).
 */
export function batchPosts(input: any, now = new Date()): BatchPost[] {
  const raw: any[] = Array.isArray(input?.posts) ? input.posts.slice(0, BATCH_MAX_POSTS) : [];
  const tz = validTimeZone(input?.timezone);
  const out: BatchPost[] = [];
  raw.forEach((p, i) => {
    const topic = String(p?.topic ?? p?.title ?? p?.brief ?? '').trim().slice(0, 600);
    if (!topic) return;
    const when = p?.scheduled_at ? new Date(p.scheduled_at) : null;
    const valid = when && !Number.isNaN(when.getTime()) && when.getTime() > now.getTime() + 5 * 60_000;
    const named = [p?.platform, ...(Array.isArray(p?.platforms) ? p.platforms : []), ...(p?.platform || Array.isArray(p?.platforms) ? [] : Array.isArray(input?.platforms) ? input.platforms : [])]
      .map(normalizePlatform).filter((x): x is SocialPlatform => Boolean(x));
    const platforms = [...new Set(named.length ? named : ['instagram' as SocialPlatform])];
    for (const platform of platforms) {
      const format = normalizeFormat(platform, p?.format);
      // No usable time from the planner: the platform's best slot in the user's timezone, one entry per day from tomorrow.
      const scheduled_at = (valid ? when! : bestSlot(platform, 1 + i, tz, now)).toISOString();
      out.push({
        topic, platform, format, scheduled_at, as_draft: p?.as_draft === true,
        slides: format === 'carousel' ? clampSlides(p?.slides) : 0,
        with_image: format === 'text' ? Boolean(p?.with_image) : false,
        visual: String(p?.visual ?? p?.visual_direction ?? '').trim().slice(0, 600),
      });
    }
  });
  return out.slice(0, BATCH_MAX_POSTS);
}

export async function createPendingAction(query: Query, userId: string, tool: string, args: unknown, estimate: CreditEstimate): Promise<string> {
  await ensureChatTables(query);
  const id = randomUUID();
  await query(
    `INSERT INTO chat_pending_actions (id, user_id, tool, args, credits, label) VALUES ($1,$2,$3,$4,$5,$6)`,
    [id, userId, tool, JSON.stringify(args ?? {}), estimate.credits, estimate.label],
  );
  return id;
}

/** Claims a pending action for running; null if it is not this user's, already ran, was cancelled or is over a day old. */
export async function claimPendingAction(query: Query, userId: string, id: string): Promise<{ id: string; tool: string; args: any; credits: number; label: string } | null> {
  await ensureChatTables(query);
  const { rows } = await query(
    `UPDATE chat_pending_actions SET status='running', updated_at=NOW()
     WHERE id=$1 AND user_id=$2 AND status='pending' AND created_at > NOW() - INTERVAL '1 day'
     RETURNING id, tool, args, credits, label`,
    [id, userId],
  );
  return rows[0] ?? null;
}

export async function finishPendingAction(query: Query, id: string, status: 'done' | 'failed' | 'cancelled', result?: unknown): Promise<void> {
  await query(`UPDATE chat_pending_actions SET status=$2, result=$3, updated_at=NOW() WHERE id=$1`, [id, status, result === undefined ? null : JSON.stringify(result)]).catch(() => undefined);
}

/** Session messages as saved: pasted images are dropped (they are data URLs), everything else kept. */
export function sanitizeSessionMessages(messages: unknown): unknown[] {
  if (!Array.isArray(messages)) return [];
  return messages.slice(-200).map((m: any) => {
    if (m && typeof m === 'object' && Array.isArray(m.images)) {
      return { ...m, images: m.images.map((i: any) => ({ id: i?.id, name: i?.name, dataUrl: '' })) };
    }
    return m;
  });
}

// ── Custom instructions: the user's standing orders for every agent task ─────

export const CUSTOM_INSTRUCTIONS_MAX = 4000;

export async function getCustomInstructions(query: Query, userId: string): Promise<string> {
  try {
    await ensureChatTables(query);
    const { rows } = await query(`SELECT instructions FROM user_custom_instructions WHERE user_id=$1`, [userId]);
    return String(rows[0]?.instructions || '').trim();
  } catch {
    return '';
  }
}

export async function saveCustomInstructions(query: Query, userId: string, text: string): Promise<string> {
  await ensureChatTables(query);
  const clean = String(text || '').replace(/\r\n/g, '\n').trim().slice(0, CUSTOM_INSTRUCTIONS_MAX);
  await query(
    `INSERT INTO user_custom_instructions (user_id, instructions, updated_at) VALUES ($1,$2,NOW())
     ON CONFLICT (user_id) DO UPDATE SET instructions=EXCLUDED.instructions, updated_at=NOW()`,
    [userId, clean],
  );
  return clean;
}

/** The block every agent prompt carries: the user's own rules, above defaults (never above safety). */
export function customInstructionsBlock(text: string): string {
  if (!text) return '';
  return `## THE USER'S CUSTOM INSTRUCTIONS — check and obey on EVERY task\nThese are the user's standing orders for all work you do for them. They override your defaults and style choices (formats, images, tone, platforms, length, schedule). They never override safety rules or the credit confirmation step.\n${text}`;
}
