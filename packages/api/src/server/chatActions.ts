import { randomUUID } from 'crypto';
import { MAGNIFIC_IMAGE_MODELS, MAGNIFIC_VIDEO_MODELS } from './magnificRoutes.ts';

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

/** Credits for one post written by the batch tool (the content-plan copy rate). */
export const BATCH_POST_CREDITS = 2;
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
      const n = batchPosts(input).length;
      if (!n) return null;
      return {
        credits: n * BATCH_POST_CREDITS,
        label: `Write and schedule ${n} post${n === 1 ? '' : 's'}`,
        lines: [`${n} post${n === 1 ? '' : 's'} × ${BATCH_POST_CREDITS} credits`],
      };
    }
    case 'magnific_one_generate': {
      const credits = input?.mode === 'draft' ? 4 : (input?.resolution === '4k' ? 8 : 6);
      return { credits, label: 'Generate an image with Magnific One', lines: [`Magnific One, ${input?.mode === 'draft' ? 'draft sheet' : `${input?.resolution || '2k'} image`}: ${credits} credits`] };
    }
    case 'magnific_generate_image': {
      const model = input?.model && MAGNIFIC_IMAGE_MODELS[input.model] ? input.model : 'magnific-one';
      const credits = MAGNIFIC_IMAGE_MODELS[model]?.credits ?? 5;
      return { credits, label: `Generate an image (${model})`, lines: [`${model} image: ${credits} credits`] };
    }
    case 'magnific_edit_image': {
      const type = String(input?.type || 'upscale');
      const credits = type === 'remove-background' ? 1 : 5;
      return { credits, label: `Edit an image (${type})`, lines: [`${type}: ${credits} credits`] };
    }
    case 'magnific_generate_video': {
      const model = input?.model && MAGNIFIC_VIDEO_MODELS[input.model] ? input.model : (input?.image_url ? 'kling-v2-6-pro' : 'ltx-2-pro');
      const credits = MAGNIFIC_VIDEO_MODELS[model]?.credits ?? 25;
      return { credits, label: `Generate a video (${model})`, lines: [`${model} video: ${credits} credits`] };
    }
    case 'magnific_lip_sync':
      return { credits: 30, label: 'Animate a lip-sync avatar', lines: ['OmniHuman lip-sync: 30 credits'] };
    case 'magnific_generate_audio': {
      const type = String(input?.type || 'sound-effects');
      const credits = type === 'music-generation' ? 6 : 4;
      return { credits, label: `Generate audio (${type})`, lines: [`${type}: ${credits} credits`] };
    }
    case 'magnific_space_or_flow': {
      const action = String(input?.action || 'run_space');
      if (action !== 'run_space' && action !== 'run_flow') return null;
      return { credits: 10, label: action === 'run_flow' ? 'Run a Magnific Flow' : 'Run a Magnific Space', lines: ['Estimated 10 credits (the final charge follows the run)'] };
    }
    default:
      return null;
  }
}

export interface BatchPost { topic: string; platforms: string[]; scheduled_at: string }

/** The batch tool's posts, cleaned: at most 30, each with a date (tomorrow 09:00 UTC onwards, one a day, when not given). */
export function batchPosts(input: any, now = new Date()): BatchPost[] {
  const raw: any[] = Array.isArray(input?.posts) ? input.posts.slice(0, BATCH_MAX_POSTS) : [];
  const first = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1, 9, 0, 0));
  return raw
    .map((p, i) => {
      const topic = String(p?.topic ?? p?.title ?? p?.brief ?? '').trim().slice(0, 600);
      const when = p?.scheduled_at ? new Date(p.scheduled_at) : null;
      const valid = when && !Number.isNaN(when.getTime()) && when.getTime() > now.getTime();
      const fallback = new Date(first.getTime() + i * 86_400_000);
      const platforms = Array.isArray(p?.platforms) ? p.platforms.map((x: unknown) => String(x).toLowerCase()).slice(0, 8)
        : Array.isArray(input?.platforms) ? input.platforms.map((x: unknown) => String(x).toLowerCase()).slice(0, 8) : [];
      return { topic, platforms, scheduled_at: (valid ? when! : fallback).toISOString() };
    })
    .filter((p) => p.topic);
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
