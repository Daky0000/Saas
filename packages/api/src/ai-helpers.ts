import Anthropic from '@anthropic-ai/sdk';
import { GoogleGenerativeAI } from '@google/generative-ai';
import { getPlatformConfig } from './user-auth.ts';
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
// Usage tracking — every AI call records tokens so admins can see spend per
// user/feature (GET /api/admin/ai-usage) and credits can meter it later.
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
  await dbQuery(
    `INSERT INTO ai_usage_log (id, user_id, feature, provider, model, input_tokens, output_tokens, cache_read_tokens)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
    [
      randomUUID(), params.userId, params.feature.slice(0, 60), params.provider, params.model,
      Math.max(0, Math.round(params.inputTokens || 0)),
      Math.max(0, Math.round(params.outputTokens || 0)),
      Math.max(0, Math.round(params.cacheReadTokens || 0)),
    ]
  ).catch((err) => logger.warn({ err }, 'ai_usage_record_failed'));
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
    const msg: string = err?.message || String(err);
    if (msg.includes('429') || msg.toLowerCase().includes('quota') || msg.toLowerCase().includes('rate limit') || msg.toLowerCase().includes('too many requests')) {
      if (provider === 'google') {
        throw new Error('Google API quota exceeded. The free tier has a limit of 0 for this project — enable billing at aistudio.google.com to use Gemini.');
      } else {
        throw new Error('Anthropic rate limit exceeded. Check your usage limits at console.anthropic.com.');
      }
    }
    if (msg.includes('401') || msg.toLowerCase().includes('invalid') || msg.toLowerCase().includes('unauthorized')) {
      throw new Error(`Invalid ${provider === 'google' ? 'Google' : 'Anthropic'} API key. Please check your key and try again.`);
    }
    throw err;
  }
}

export function decryptAIKey(encryptedKey: string): string {
  try { return decryptIntegrationSecret(encryptedKey); } catch (_err) { return ''; }
}
