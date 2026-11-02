import { getPlatformConfig } from '../user-auth.ts';
import { logger } from '../logger.ts';

// ─────────────────────────────────────────────────────────────────────────────
// Free NVIDIA models — the same catalogue, ladders and wire rules as Dakyworld
// OS (`server/src/lib/models/registry.ts` + `call.ts`), carried over so both
// products ask the same verified models for the same kinds of work.
//
// Free first, paid behind: every one-shot generation here tries the job's
// ladder of free models in order, one attempt each, and only then the paid
// vendor configured in Admin → AI Assistant.
//
// Facts below were each a live request in the OS on 1 Sep 2026:
//  - Chat: https://integrate.api.nvidia.com/v1, OpenAI chat-completions shape.
//    `max_tokens` (not max_completion_tokens) caps reasoning AND reply, so
//    reasoning models get headroom on top of the answer or come back empty.
//  - `reasoning_effort` is low|medium|high only, and only for models that
//    reason: gpt-oss answers 400 to anything else.
//  - One key reaches every model; the free allowance is per account.
//  - gemma-4-31b-it (504s) and mistral-nemotron (hangs) are listed but in no
//    shipped ladder: a first rung that times out costs every call a minute.
//  - Images are NVIDIA Cloud Functions on api.nvcf.nvidia.com, addressed by
//    function id. Body is {prompt,width,height} and nothing else (anything
//    more is a 422 "Inference error"). 202 means queued: poll nvcf-reqid.
//    A declined prompt is 200 with finishReason != SUCCESS. Bytes are JPEG.
//    Only flux.2-klein-4b serves; the other three are ACTIVE but 504/hang.
// ─────────────────────────────────────────────────────────────────────────────

export const NVIDIA_CHAT_BASE = () => (process.env.NVIDIA_BASE_URL || 'https://integrate.api.nvidia.com/v1').replace(/\/$/, '');
export const NVCF_BASE = () => (process.env.NVCF_BASE_URL || 'https://api.nvcf.nvidia.com').replace(/\/$/, '');

export interface FreeModel { id: string; name: string; reasoning: boolean; vision: boolean; down?: string }

export const FREE_MODELS: FreeModel[] = [
  { id: 'moonshotai/kimi-k3', name: 'Kimi K3', reasoning: true, vision: true },
  { id: 'nvidia/nemotron-3-super-120b-a12b', name: 'Nemotron 3 Super 120B', reasoning: true, vision: false },
  { id: 'nvidia/nemotron-3-nano-omni-30b-a3b-reasoning', name: 'Nemotron 3 Nano Omni', reasoning: true, vision: true },
  { id: 'openai/gpt-oss-120b', name: 'GPT-OSS 120B', reasoning: true, vision: false },
  { id: 'openai/gpt-oss-20b', name: 'GPT-OSS 20B', reasoning: true, vision: false },
  { id: 'google/diffusiongemma-26b-a4b-it', name: 'DiffusionGemma 26B', reasoning: false, vision: true },
  { id: 'meta/llama-3.2-90b-vision-instruct', name: 'Llama 3.2 90B Vision', reasoning: false, vision: true },
  { id: 'google/gemma-4-31b-it', name: 'Gemma 4 31B', reasoning: true, vision: true, down: '504 on every request when last checked' },
  { id: 'mistralai/mistral-nemotron', name: 'Mistral Nemotron', reasoning: false, vision: false, down: 'hangs to a three-minute timeout when last checked' },
];

export interface ImageModel { id: string; name: string; functionId: string; down?: string }

export const IMAGE_MODELS: ImageModel[] = [
  { id: 'black-forest-labs/flux.2-klein-4b', name: 'FLUX.2 Klein 4B', functionId: 'f67e96d8-1c4e-422e-a913-90f00e19aa9a' },
  { id: 'black-forest-labs/flux.1-schnell', name: 'FLUX.1 Schnell', functionId: '105fe02c-924b-4dfa-9797-92d89c3936ad', down: '504 after a minute when last checked' },
  { id: 'black-forest-labs/flux.1-dev', name: 'FLUX.1 Dev', functionId: '0c474133-6fd2-42f6-be29-8ebbbaeaaeb2', down: '504 after a minute when last checked' },
  { id: 'nvidia/cosmos3-super-text2image', name: 'Cosmos 3 Super', functionId: 'f65a2585-3b67-46ce-a431-af764d93e954', down: 'never answered when last checked' },
];

/**
 * The jobs here, mapped onto the OS ladders. `text` is the OS `text` ladder
 * (prose a customer reads: posts, captions, campaign copy). `fast` is the OS
 * `organise`/`triage` ladder (classification, extraction, short structured
 * answers) — the small fast model first, which buys latency, not money.
 */
export type NvidiaJob = 'text' | 'fast';

export const DEFAULT_LADDERS: Record<NvidiaJob | 'image', string[]> = {
  text: ['moonshotai/kimi-k3', 'nvidia/nemotron-3-super-120b-a12b', 'openai/gpt-oss-120b'],
  fast: ['openai/gpt-oss-20b', 'google/diffusiongemma-26b-a4b-it', 'nvidia/nemotron-3-super-120b-a12b'],
  image: ['black-forest-labs/flux.2-klein-4b'],
};

export const LADDER_MAX = 3;
const FREE_TIMEOUT_MS = 60_000;
const REASONING_HEADROOM = { low: 2_000, medium: 8_000 } as const;
const MAX_TOKENS_CEILING = 32_000;

export interface NvidiaConfig {
  apiKey: string;
  source: 'admin' | 'env' | null;
  enabled: boolean;
  ladders: Record<NvidiaJob | 'image', string[]>;
}

function parseLadder(raw: unknown, fallback: string[]): string[] {
  const list = String(raw ?? '').split(/[\s,]+/).map((s) => s.trim()).filter(Boolean);
  return list.length ? [...new Set(list)].slice(0, LADDER_MAX) : fallback;
}

let cached: { at: number; value: NvidiaConfig } | null = null;

/** Admin → NVIDIA (platform_configs.nvidia) first, NVIDIA_API_KEY as fallback. Cached 30 s. */
export async function getNvidiaConfig(fresh = false): Promise<NvidiaConfig> {
  if (!fresh && cached && Date.now() - cached.at < 30_000) return cached.value;
  const cfg = await getPlatformConfig('nvidia').catch(() => ({} as Record<string, string>));
  const adminKey = String(cfg.apiKey || '').trim();
  const envKey = String(process.env.NVIDIA_API_KEY || '').trim();
  const value: NvidiaConfig = {
    apiKey: adminKey || envKey,
    source: adminKey ? 'admin' : envKey ? 'env' : null,
    // On by default once a key exists; Admin can switch the free tier off.
    enabled: String(cfg.enabled ?? 'true') !== 'false',
    ladders: {
      text: parseLadder(cfg.textModels, DEFAULT_LADDERS.text),
      fast: parseLadder(cfg.fastModels, DEFAULT_LADDERS.fast),
      image: parseLadder(cfg.imageModels, DEFAULT_LADDERS.image),
    },
  };
  cached = { at: Date.now(), value };
  return value;
}

export function invalidateNvidiaConfig(): void { cached = null; }

export async function nvidiaReady(): Promise<boolean> {
  const c = await getNvidiaConfig();
  return c.enabled && Boolean(c.apiKey);
}

/** Which ladder a caller's model choice maps to: the small/fast tiers go to `fast`. */
export function jobForModel(model: string): NvidiaJob {
  return /haiku|flash|mini|nano|gpt-oss-20b/i.test(model) ? 'fast' : 'text';
}

export class NvidiaError extends Error {
  constructor(message: string, readonly attempts: Array<{ model: string; error: string }>) {
    super(message);
    this.name = 'NvidiaError';
  }
}

function assistantText(message: any): string {
  const content = message?.content;
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) return content.map((p: any) => (typeof p === 'string' ? p : typeof p?.text === 'string' ? p.text : '')).join('');
  return '';
}

function describeHttp(status: number, body: string): string {
  let detail = body;
  try { const j = JSON.parse(body); detail = j?.error?.message || j?.detail || j?.message || j?.title || body; } catch { /* raw text */ }
  const short = String(detail).replace(/\s+/g, ' ').slice(0, 200);
  if (status === 401 || status === 403) return `NVIDIA refused the key (${status}). Keys expire — check build.nvidia.com/settings/api-keys.`;
  if (status === 429) return `NVIDIA rate limit (429): ${short}`;
  return `NVIDIA returned ${status}: ${short}`;
}

export interface NvidiaChatResult { text: string; model: string; inputTokens: number; outputTokens: number; attempts: Array<{ model: string; error: string }> }

/**
 * One prompt down the job's ladder. Each rung gets one attempt with a 60 s
 * cap; an empty answer counts as a failure (a reasoning model that spent its
 * whole budget thinking). A refused key stops the climb: every rung shares it.
 */
export async function nvidiaChat(params: {
  system: string; user: string; maxTokens: number; job: NvidiaJob;
  config?: NvidiaConfig; fetchImpl?: typeof fetch;
}): Promise<NvidiaChatResult> {
  const config = params.config ?? await getNvidiaConfig();
  if (!config.apiKey) throw new NvidiaError('No NVIDIA key is set (Admin → NVIDIA).', []);
  const doFetch = params.fetchImpl ?? fetch;
  const effort = params.job === 'fast' ? 'low' : 'medium';
  const attempts: Array<{ model: string; error: string }> = [];
  for (const model of config.ladders[params.job]) {
    const known = FREE_MODELS.find((m) => m.id === model);
    const reasons = known ? known.reasoning : true;
    const body = {
      model,
      max_tokens: Math.min(params.maxTokens + (reasons ? REASONING_HEADROOM[effort] : 0), MAX_TOKENS_CEILING),
      messages: [{ role: 'system', content: params.system }, { role: 'user', content: params.user }],
      ...(reasons ? { reasoning_effort: effort } : {}),
    };
    try {
      const res = await doFetch(`${NVIDIA_CHAT_BASE()}/chat/completions`, {
        method: 'POST',
        headers: { authorization: `Bearer ${config.apiKey}`, 'content-type': 'application/json', accept: 'application/json' },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(FREE_TIMEOUT_MS),
      });
      const raw = await res.text();
      if (!res.ok) {
        attempts.push({ model, error: describeHttp(res.status, raw) });
        if (res.status === 401 || res.status === 403) break;
        continue;
      }
      const json = JSON.parse(raw);
      const text = assistantText(json?.choices?.[0]?.message).trim();
      if (!text) { attempts.push({ model, error: `empty answer (finish_reason ${json?.choices?.[0]?.finish_reason ?? 'unknown'})` }); continue; }
      return {
        text,
        model,
        inputTokens: Number(json?.usage?.prompt_tokens) || Math.ceil((params.system.length + params.user.length) / 4),
        outputTokens: Number(json?.usage?.completion_tokens) || Math.ceil(text.length / 4),
        attempts,
      };
    } catch (err: any) {
      attempts.push({ model, error: err?.name === 'TimeoutError' ? 'timed out after 60 s' : (err?.message || 'network error') });
    }
  }
  throw new NvidiaError(`Free NVIDIA models did not answer: ${attempts.map((a) => `${a.model} — ${a.error}`).join('; ') || 'no models in the ladder'}`, attempts);
}

const NVCF_POLL_ATTEMPTS = 12;
const NVCF_POLL_MS = 5000;

/** width/height the image functions honour: multiples of 64 within 512..1536. */
export function nvidiaImageSize(width = 1024, height = 1024): { width: number; height: number } {
  const clamp = (v: number) => Math.min(Math.max(Math.round(v / 64) * 64, 512), 1536);
  return { width: clamp(width), height: clamp(height) };
}

/** One picture down the image ladder. Returns JPEG bytes. */
export async function nvidiaImage(params: {
  prompt: string; width?: number; height?: number;
  config?: NvidiaConfig; fetchImpl?: typeof fetch; pollMs?: number;
}): Promise<{ bytes: Buffer; mimeType: string; model: string }> {
  const config = params.config ?? await getNvidiaConfig();
  if (!config.apiKey) throw new NvidiaError('No NVIDIA key is set (Admin → NVIDIA).', []);
  const doFetch = params.fetchImpl ?? fetch;
  const { width, height } = nvidiaImageSize(params.width, params.height);
  const attempts: Array<{ model: string; error: string }> = [];
  for (const model of config.ladders.image) {
    const known = IMAGE_MODELS.find((m) => m.id === model);
    // The address is a function UUID nobody can guess, so an unknown id is refused, not tried.
    if (!known) { attempts.push({ model, error: 'not an NVIDIA image model this app knows how to reach' }); continue; }
    const headers = {
      authorization: `Bearer ${config.apiKey}`, 'content-type': 'application/json', accept: 'application/json',
      'nvcf-poll-seconds': '60',
    };
    try {
      let res = await doFetch(`${NVCF_BASE()}/v2/nvcf/pexec/functions/${known.functionId}`, {
        method: 'POST', headers, body: JSON.stringify({ prompt: params.prompt.slice(0, 2000), width, height }),
        signal: AbortSignal.timeout(180_000),
      });
      const requestId = res.headers.get('nvcf-reqid');
      for (let i = 0; res.status === 202 && requestId && i < NVCF_POLL_ATTEMPTS; i++) {
        await new Promise((r) => setTimeout(r, params.pollMs ?? NVCF_POLL_MS));
        res = await doFetch(`${NVCF_BASE()}/v2/nvcf/pexec/status/${requestId}`, { headers, signal: AbortSignal.timeout(180_000) });
      }
      const raw = await res.text();
      if (!res.ok) {
        attempts.push({ model, error: res.status === 422 ? 'NVIDIA could not draw that (422 "Inference error" — usually the prompt was declined)' : describeHttp(res.status, raw) });
        if (res.status === 401 || res.status === 403) break;
        continue;
      }
      const artifact = JSON.parse(raw)?.artifacts?.[0];
      const finish = typeof artifact?.finishReason === 'string' ? artifact.finishReason : 'SUCCESS';
      if (finish !== 'SUCCESS') { attempts.push({ model, error: `declined (${finish}) — rephrase the prompt` }); continue; }
      if (typeof artifact?.base64 !== 'string' || !artifact.base64) { attempts.push({ model, error: 'no image in the answer' }); continue; }
      return { bytes: Buffer.from(artifact.base64, 'base64'), mimeType: 'image/jpeg', model };
    } catch (err: any) {
      attempts.push({ model, error: err?.name === 'TimeoutError' ? 'timed out' : (err?.message || 'network error') });
    }
  }
  logger.warn({ attempts }, 'nvidia_image_failed');
  throw new NvidiaError(`Free NVIDIA image models did not answer: ${attempts.map((a) => `${a.model} — ${a.error}`).join('; ')}`, attempts);
}
