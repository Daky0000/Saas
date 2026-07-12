import Anthropic from '@anthropic-ai/sdk';
import { GoogleGenerativeAI } from '@google/generative-ai';
import { getPlatformConfig, getUserPlanName } from './user-auth.ts';
import { decryptIntegrationSecret } from './integration-helpers.ts';
import { pool, dbQuery } from './db.ts';
import { logger } from './logger.ts';
import { randomUUID } from 'crypto';

export const AI_CONFIG_PLATFORM = 'ai_assistant';

// ─────────────────────────────────────────────────────────────────────────────
// Model registry — the single source of truth for model IDs across the API.
// Route modules must import from here instead of hardcoding strings.
// ─────────────────────────────────────────────────────────────────────────────

export const CLAUDE_MODELS = [
  { id: 'claude-opus-4-8', label: 'Claude Opus 4.8', note: 'Most capable · best for the assistant' },
  { id: 'claude-sonnet-5', label: 'Claude Sonnet 5', note: 'Near-Opus quality · lower cost' },
  { id: 'claude-sonnet-4-6', label: 'Claude Sonnet 4.6', note: 'Balanced' },
  { id: 'claude-haiku-4-5', label: 'Claude Haiku 4.5', note: 'Fastest · lowest cost' },
] as const;

// Primary assistant (Daky chat) default — admin can change in Admin → AI Assistant
export const DEFAULT_CHAT_MODEL = 'claude-opus-4-8';
// Background work: skill-brief compilation, per-agent proposal generation
export const FAST_MODEL = 'claude-haiku-4-5';

// Gemini model names — used for model selection UI + provider-aware calls
export const GEMINI_MODELS = ['gemini-2.5-flash', 'gemini-2.5-pro', 'gemini-2.0-flash', 'gemini-1.5-flash', 'gemini-1.5-pro'];

// Map from Anthropic model IDs → equivalent Gemini models for background/agent calls.
// Includes legacy IDs so configs saved by older deploys keep resolving.
export const ANTHROPIC_TO_GEMINI: Record<string, string> = {
  'claude-opus-4-8': 'gemini-2.5-pro',
  'claude-sonnet-5': 'gemini-2.5-pro',
  'claude-sonnet-4-6': 'gemini-2.5-flash',
  'claude-haiku-4-5': 'gemini-2.0-flash',
  // legacy IDs from earlier deploys
  'claude-haiku-4-5-20251001': 'gemini-2.0-flash',
  'claude-opus-4-7': 'gemini-2.5-pro',
};

export function resolveGeminiModel(model: string): string {
  return GEMINI_MODELS.includes(model) ? model : (ANTHROPIC_TO_GEMINI[model] ?? 'gemini-2.0-flash');
}

export async function getAIConfig(): Promise<{
  model: string;
  provider: 'anthropic' | 'google';
  encryptedKey: string | null;
  googleEncryptedKey: string | null;
  systemPrompt: string | null;
}> {
  const cfg = await getPlatformConfig(AI_CONFIG_PLATFORM);
  return {
    model: String(cfg.model || DEFAULT_CHAT_MODEL),
    provider: (cfg.provider as 'anthropic' | 'google') || 'anthropic',
    encryptedKey: cfg.apiKeyEncrypted ? String(cfg.apiKeyEncrypted) : null,
    googleEncryptedKey: cfg.googleApiKeyEncrypted ? String(cfg.googleApiKeyEncrypted) : null,
    systemPrompt: cfg.systemPrompt ? String(cfg.systemPrompt) : null,
  };
}

export function resolveActiveKey(config: { provider: 'anthropic' | 'google'; encryptedKey: string | null; googleEncryptedKey: string | null }): string {
  if (config.provider === 'google') {
    return (config.googleEncryptedKey ? decryptAIKey(config.googleEncryptedKey) : null) || process.env.GOOGLE_AI_API_KEY || '';
  }
  return (config.encryptedKey ? decryptAIKey(config.encryptedKey) : null) || process.env.ANTHROPIC_API_KEY || '';
}

// ─────────────────────────────────────────────────────────────────────────────
// Credit economics.
//
// 1 credit = $0.01 of retail value (100 credits = $1). AI text calls are
// metered against REAL provider prices below, marked up AI_PROFIT_MULTIPLIER×
// so every credit spent is profitable: credits = ceil(apiCostUsd × 3 / 0.01),
// minimum 1 per metered call. Image/video generation keeps its fixed per-model
// pricing (✦3–35 in magnific/kling routes), which is already margin-priced.
//
// Plan allowances (matches the seeded pricing page): Free 100 · Pro 2,000 ·
// Agency 6,000 credits/month. Worst-case COGS per plan = allowance × $0.01 / 3,
// e.g. Pro $29 → max $6.67 API spend → ≥77% gross margin on AI.
// ─────────────────────────────────────────────────────────────────────────────

export const CREDIT_USD = 0.01;          // retail value of one credit
export const AI_PROFIT_MULTIPLIER = 3;   // retail = 3× raw provider cost

// Provider list prices, USD per 1M tokens. Anthropic prices are current list
// prices; Gemini prices are Google's published rates (estimates — revisit if
// Google reprices). cacheRead ≈ 0.1× input for Anthropic.
export const MODEL_COSTS: Record<string, { in: number; out: number; cacheRead?: number }> = {
  'claude-opus-4-8':           { in: 5,    out: 25,   cacheRead: 0.5 },
  'claude-opus-4-7':           { in: 5,    out: 25,   cacheRead: 0.5 },
  'claude-sonnet-5':           { in: 3,    out: 15,   cacheRead: 0.3 },
  'claude-sonnet-4-6':         { in: 3,    out: 15,   cacheRead: 0.3 },
  'claude-haiku-4-5':          { in: 1,    out: 5,    cacheRead: 0.1 },
  'claude-haiku-4-5-20251001': { in: 1,    out: 5,    cacheRead: 0.1 },
  'gemini-2.5-pro':            { in: 1.25, out: 10 },
  'gemini-2.5-flash':          { in: 0.30, out: 2.5 },
  'gemini-2.0-flash':          { in: 0.10, out: 0.4 },
  'gemini-1.5-pro':            { in: 1.25, out: 5 },
  'gemini-1.5-flash':          { in: 0.075, out: 0.3 },
};
// Unknown/future models: assume Sonnet-tier so we never under-charge badly.
const FALLBACK_COST = { in: 3, out: 15, cacheRead: 0.3 };

export function computeAICostUsd(model: string, inputTokens: number, outputTokens: number, cacheReadTokens = 0): number {
  const c = MODEL_COSTS[model] ?? FALLBACK_COST;
  const cacheRate = c.cacheRead ?? c.in * 0.1;
  return (
    (Math.max(0, inputTokens) * c.in +
     Math.max(0, outputTokens) * c.out +
     Math.max(0, cacheReadTokens) * cacheRate) / 1_000_000
  );
}

export function creditsForCostUsd(costUsd: number): number {
  if (costUsd <= 0) return 0;
  return Math.max(1, Math.ceil((costUsd * AI_PROFIT_MULTIPLIER) / CREDIT_USD));
}

export const PLAN_AI_CREDITS: Record<string, number> = { free: 100, pro: 2000, agency: 6000 };

async function getMonthlyCreditAllowance(userId: string): Promise<number> {
  try {
    const plan = (await getUserPlanName(userId)).toLowerCase();
    for (const [key, credits] of Object.entries(PLAN_AI_CREDITS)) {
      if (plan.includes(key)) return credits;
    }
  } catch { /* fall through */ }
  return PLAN_AI_CREDITS.free;
}

// Lazy monthly reset: called from balance reads and charges — when reset_date
// has passed, the balance refills to the plan allowance and reset_date rolls
// forward. No scheduler needed, and multi-instance safe (guarded UPDATE).
export async function ensureCreditAccount(userId: string): Promise<{ credits: number; resetDate: string | null }> {
  if (!pool) return { credits: 100, resetDate: null };
  const allowance = await getMonthlyCreditAllowance(userId);
  await dbQuery(
    `INSERT INTO user_credits (user_id, credits, reset_date, updated_at)
     VALUES ($1, $2, date_trunc('month', NOW()) + INTERVAL '1 month', NOW())
     ON CONFLICT (user_id) DO NOTHING`,
    [userId, allowance]
  ).catch(() => undefined);
  const { rows: reset } = await dbQuery<{ credits: number }>(
    `UPDATE user_credits SET credits = $2, reset_date = date_trunc('month', NOW()) + INTERVAL '1 month', updated_at = NOW()
     WHERE user_id = $1 AND reset_date IS NOT NULL AND reset_date <= NOW() RETURNING credits`,
    [userId, allowance]
  ).catch(() => ({ rows: [] as any[] }));
  if (reset.length) {
    await recordCreditLedger(userId, allowance, reset[0].credits, 'monthly_reset', {});
  }
  const { rows } = await dbQuery<{ credits: number; reset_date: string | null }>(
    `SELECT credits, reset_date FROM user_credits WHERE user_id = $1`, [userId]
  );
  return { credits: Number(rows[0]?.credits ?? 0), resetDate: rows[0]?.reset_date ?? null };
}

export async function hasAICredits(userId: string): Promise<boolean> {
  if (!pool) return true; // in-memory dev mode — don't block
  const { credits } = await ensureCreditAccount(userId);
  return credits > 0;
}

async function recordCreditLedger(userId: string, delta: number, balanceAfter: number, reason: string, meta: Record<string, unknown>): Promise<void> {
  await dbQuery(
    `INSERT INTO credit_ledger (id, user_id, delta, balance_after, reason, meta) VALUES ($1,$2,$3,$4,$5,$6::jsonb)`,
    [randomUUID(), userId, delta, balanceAfter, reason.slice(0, 60), JSON.stringify(meta ?? {})]
  ).catch((err) => logger.warn({ err }, 'credit_ledger_insert_failed'));
}

// Deduct credits (floor 0 — AI usage is post-paid, enforcement blocks the NEXT
// call once the balance is empty) and write an audit ledger row.
export async function chargeAICredits(userId: string, credits: number, reason: string, meta: Record<string, unknown> = {}): Promise<void> {
  if (!pool || credits <= 0) return;
  await ensureCreditAccount(userId);
  const { rows } = await dbQuery<{ credits: number }>(
    `UPDATE user_credits SET credits = GREATEST(0, credits - $1), updated_at = NOW() WHERE user_id = $2 RETURNING credits`,
    [credits, userId]
  ).catch(() => ({ rows: [] as any[] }));
  if (rows.length) await recordCreditLedger(userId, -credits, rows[0].credits, reason, meta);
}

export async function grantCredits(userId: string, credits: number, reason: string, meta: Record<string, unknown> = {}): Promise<number | null> {
  if (!pool || credits <= 0) return null;
  const { rows } = await dbQuery<{ credits: number }>(
    `INSERT INTO user_credits (user_id, credits, reset_date, updated_at)
     VALUES ($1, $2, date_trunc('month', NOW()) + INTERVAL '1 month', NOW())
     ON CONFLICT (user_id) DO UPDATE SET credits = user_credits.credits + $2, updated_at = NOW()
     RETURNING credits`,
    [userId, credits]
  ).catch(() => ({ rows: [] as any[] }));
  if (!rows.length) return null;
  await recordCreditLedger(userId, credits, rows[0].credits, reason, meta);
  return rows[0].credits;
}

// ─────────────────────────────────────────────────────────────────────────────
// Usage tracking — every AI call records tokens + real cost, and charges the
// user's credit balance at the marked-up rate.
// ─────────────────────────────────────────────────────────────────────────────

export async function recordAIUsage(params: {
  userId: string | null;
  feature: string;
  provider: string;
  model: string;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens?: number;
}): Promise<void> {
  if (!pool) return;
  const inputTokens = Math.max(0, Math.round(params.inputTokens || 0));
  const outputTokens = Math.max(0, Math.round(params.outputTokens || 0));
  const cacheReadTokens = Math.max(0, Math.round(params.cacheReadTokens || 0));
  const costUsd = computeAICostUsd(params.model, inputTokens, outputTokens, cacheReadTokens);
  const credits = creditsForCostUsd(costUsd);
  await dbQuery(
    `INSERT INTO ai_usage_log (id, user_id, feature, provider, model, input_tokens, output_tokens, cache_read_tokens, cost_usd, credits_charged)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
    [
      randomUUID(), params.userId, params.feature.slice(0, 60), params.provider, params.model,
      inputTokens, outputTokens, cacheReadTokens, costUsd.toFixed(6), credits,
    ]
  ).catch((err) => logger.warn({ err }, 'ai_usage_record_failed'));
  if (params.userId) {
    await chargeAICredits(params.userId, credits, `ai_${params.feature}`.slice(0, 60), {
      model: params.model, input_tokens: inputTokens, output_tokens: outputTokens, cost_usd: Number(costUsd.toFixed(6)),
    });
  }
}

export async function callAINonStreaming(
  provider: 'anthropic' | 'google',
  apiKey: string,
  model: string,
  systemPrompt: string,
  userMessage: string,
  maxTokens = 400,
  usageMeta?: { userId: string | null; feature: string },
): Promise<string> {
  try {
    if (provider === 'google') {
      const effectiveModel = resolveGeminiModel(model);
      const genAI = new GoogleGenerativeAI(apiKey);
      const gModel = genAI.getGenerativeModel({ model: effectiveModel, systemInstruction: systemPrompt });
      const result = await gModel.generateContent(userMessage);
      if (usageMeta) {
        const meta = result.response.usageMetadata;
        void recordAIUsage({
          ...usageMeta, provider: 'google', model: effectiveModel,
          inputTokens: meta?.promptTokenCount ?? 0, outputTokens: meta?.candidatesTokenCount ?? 0,
        });
      }
      return result.response.text();
    } else {
      const client = new Anthropic({ apiKey });
      const resp = await client.messages.create({
        model,
        max_tokens: maxTokens,
        system: systemPrompt,
        messages: [{ role: 'user', content: userMessage }],
      });
      if (usageMeta) {
        void recordAIUsage({
          ...usageMeta, provider: 'anthropic', model,
          inputTokens: resp.usage.input_tokens, outputTokens: resp.usage.output_tokens,
          cacheReadTokens: resp.usage.cache_read_input_tokens ?? 0,
        });
      }
      return resp.content[0]?.type === 'text' ? resp.content[0].text : '';
    }
  } catch (err: any) {
    throw classifyAIProviderError(provider, model, err);
  }
}

// Turn a provider SDK error into an actionable admin-facing message.
// Classify by HTTP status first (the Anthropic SDK exposes err.status); fall
// back to targeted message patterns for the Google SDK, which only throws
// generic Errors. Never match on the bare word "invalid" — Anthropic billing
// and validation errors are typed "invalid_request_error" and were being
// misreported as a bad API key.
export function classifyAIProviderError(provider: 'anthropic' | 'google', model: string, err: any): Error {
  const status: number | undefined = typeof err?.status === 'number' ? err.status : undefined;
  const msg: string = err?.message || String(err);
  const lower = msg.toLowerCase();
  const providerName = provider === 'google' ? 'Google' : 'Anthropic';

  if (status === 429 || lower.includes('quota') || lower.includes('rate limit') || lower.includes('too many requests')) {
    if (provider === 'google') {
      return new Error('Google API quota exceeded. The free tier has a limit of 0 for this project — enable billing at aistudio.google.com to use Gemini.');
    }
    return new Error('Anthropic rate limit exceeded. Check your usage limits at console.anthropic.com.');
  }
  if (lower.includes('credit balance')) {
    return new Error('Your Anthropic account has insufficient credits — the API key is fine. Add credits at console.anthropic.com → Billing.');
  }
  if (status === 401 || lower.includes('authentication_error') || lower.includes('api key not valid') || lower.includes('invalid x-api-key') || lower.includes('unauthorized')) {
    return new Error(`Invalid ${providerName} API key. Please check your key and try again.`);
  }
  if (status === 403 || lower.includes('permission_error')) {
    return new Error(`The ${providerName} API key is valid but lacks permission for model "${model}". Check the key's workspace/model access.`);
  }
  if (status === 404 || lower.includes('not_found_error') || lower.includes('is not found')) {
    return new Error(`Model "${model}" is not available on ${providerName} — pick a different model in Admin → AI Assistant → Configuration.`);
  }
  if (status === 529 || lower.includes('overloaded')) {
    return new Error(`${providerName} is temporarily overloaded — try again in a moment.`);
  }
  return err instanceof Error ? err : new Error(msg);
}

export function decryptAIKey(encryptedKey: string): string {
  try { return decryptIntegrationSecret(encryptedKey); } catch (_err) { return ''; }
}
