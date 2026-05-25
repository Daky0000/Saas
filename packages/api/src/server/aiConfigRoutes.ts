import type { Request, Response } from 'express';
import { Router } from 'express';
import { logger } from '../logger.ts';
import { AI_SYSTEM_PROMPT_DEFAULT } from './aiChatRoutes.ts';

const AI_CONFIG_PLATFORM = 'ai_assistant';

export interface AIConfigDeps {
  requireAdmin: (req: Request, res: Response) => Promise<any>;
  hasDatabase: () => boolean;
  dbQuery: <T = any>(sql: string, params?: any[]) => Promise<{ rows: T[]; rowCount?: number | null }>;
  getAIConfig: () => Promise<{
    model: string;
    provider: 'anthropic' | 'google';
    encryptedKey: string | null;
    googleEncryptedKey: string | null;
    systemPrompt: string | null;
  }>;
  encryptIntegrationSecret: (plain: string) => string;
  decryptAIKey: (encryptedKey: string) => string;
  resolveActiveKey: (config: { provider: 'anthropic' | 'google'; encryptedKey: string | null; googleEncryptedKey: string | null }) => string;
  callAINonStreaming: (provider: 'anthropic' | 'google', apiKey: string, model: string, system: string, user: string, maxTokens?: number) => Promise<string>;
  inMemoryPlatformConfigs: Map<string, any>;
}

function maskKey(raw: string): string {
  if (!raw || raw.length < 8) return '••••';
  return '••••' + raw.slice(-4);
}

export function registerAIConfigRoutes(deps: AIConfigDeps): Router {
  const {
    requireAdmin, hasDatabase, dbQuery,
    getAIConfig, encryptIntegrationSecret, decryptAIKey,
    resolveActiveKey, callAINonStreaming, inMemoryPlatformConfigs,
  } = deps;

  const router = Router();

  router.get('/admin/ai-config', async (req: Request, res: Response) => {
    try {
      const admin = await requireAdmin(req, res);
      if (!admin) return;
      const { model, provider, encryptedKey, googleEncryptedKey, systemPrompt } = await getAIConfig();
      const rawAnthropicKey = encryptedKey ? decryptAIKey(encryptedKey) : (process.env.ANTHROPIC_API_KEY || '');
      const rawGoogleKey = googleEncryptedKey ? decryptAIKey(googleEncryptedKey) : (process.env.GOOGLE_AI_API_KEY || '');
      const activeKey = provider === 'google' ? rawGoogleKey : rawAnthropicKey;
      return res.json({
        success: true,
        config: {
          model, provider,
          apiKeyMasked: rawAnthropicKey ? maskKey(rawAnthropicKey) : '',
          googleApiKeyMasked: rawGoogleKey ? maskKey(rawGoogleKey) : '',
          enabled: Boolean(activeKey),
          systemPrompt: systemPrompt || null,
          defaultSystemPrompt: AI_SYSTEM_PROMPT_DEFAULT,
        },
      });
    } catch (err) {
      logger.error('AI config GET error:', err);
      return res.status(500).json({ success: false, error: 'Failed to fetch AI config' });
    }
  });

  router.put('/admin/ai-config', async (req: Request, res: Response) => {
    try {
      const admin = await requireAdmin(req, res);
      if (!admin) return;
      const { apiKey, googleApiKey, model, provider, systemPrompt } = req.body as {
        apiKey?: string; googleApiKey?: string; model?: string; provider?: string; systemPrompt?: string;
      };

      const existing = await getAIConfig();
      const newModel = String(model || existing.model).trim();
      const newProvider = (provider === 'google' || provider === 'anthropic') ? provider : existing.provider;

      let newEncryptedKey = existing.encryptedKey;
      if (apiKey && !String(apiKey).startsWith('••')) {
        newEncryptedKey = encryptIntegrationSecret(String(apiKey).trim());
      }

      let newGoogleEncryptedKey = existing.googleEncryptedKey;
      if (googleApiKey && !String(googleApiKey).startsWith('••')) {
        newGoogleEncryptedKey = encryptIntegrationSecret(String(googleApiKey).trim());
      }

      const finalSystemPrompt = 'systemPrompt' in req.body
        ? (systemPrompt ? String(systemPrompt).trim() : null)
        : existing.systemPrompt;

      const configObj: Record<string, any> = { model: newModel, provider: newProvider };
      if (newEncryptedKey) configObj.apiKeyEncrypted = newEncryptedKey;
      if (newGoogleEncryptedKey) configObj.googleApiKeyEncrypted = newGoogleEncryptedKey;
      if (finalSystemPrompt) configObj.systemPrompt = finalSystemPrompt;

      if (hasDatabase()) {
        const updateRes = await dbQuery(
          `UPDATE platform_configs SET config = $2, enabled = true, updated_at = NOW() WHERE platform = $1`,
          [AI_CONFIG_PLATFORM, JSON.stringify(configObj)]
        );
        if (updateRes.rowCount === 0) {
          await dbQuery(
            `INSERT INTO platform_configs (platform, config, enabled, updated_at) VALUES ($1, $2, true, NOW())`,
            [AI_CONFIG_PLATFORM, JSON.stringify(configObj)]
          );
        }
      } else {
        inMemoryPlatformConfigs.set(AI_CONFIG_PLATFORM, {
          platform: AI_CONFIG_PLATFORM,
          config: configObj,
          enabled: true,
          updated_at: new Date().toISOString(),
        });
      }

      const rawAnthropicKey = newEncryptedKey ? decryptAIKey(newEncryptedKey) : (process.env.ANTHROPIC_API_KEY || '');
      const rawGoogleKey = newGoogleEncryptedKey ? decryptAIKey(newGoogleEncryptedKey) : (process.env.GOOGLE_AI_API_KEY || '');
      const activeKey = newProvider === 'google' ? rawGoogleKey : rawAnthropicKey;
      return res.json({
        success: true,
        config: {
          model: newModel, provider: newProvider,
          apiKeyMasked: rawAnthropicKey ? maskKey(rawAnthropicKey) : '',
          googleApiKeyMasked: rawGoogleKey ? maskKey(rawGoogleKey) : '',
          enabled: Boolean(activeKey),
          systemPrompt: finalSystemPrompt || null,
          defaultSystemPrompt: AI_SYSTEM_PROMPT_DEFAULT,
        },
      });
    } catch (err) {
      logger.error('AI config PUT error:', err);
      return res.status(500).json({ success: false, error: 'Failed to save AI config' });
    }
  });

  router.post('/admin/ai-config/test', async (req: Request, res: Response) => {
    try {
      const admin = await requireAdmin(req, res);
      if (!admin) return;
      const aiCfg = await getAIConfig();
      const rawKey = resolveActiveKey(aiCfg);
      if (!rawKey) return res.status(400).json({ success: false, message: 'No API key configured for the active provider' });
      await callAINonStreaming(aiCfg.provider, rawKey, aiCfg.model, 'You are a test assistant.', 'Reply with just: ok', 16);
      return res.json({ success: true, message: `Connected — ${aiCfg.provider === 'google' ? 'Google Gemini' : 'Anthropic'} model ${aiCfg.model} is responding` });
    } catch (err: any) {
      const msg = err?.message || 'Connection failed';
      return res.status(400).json({ success: false, message: msg });
    }
  });

  return router;
}
