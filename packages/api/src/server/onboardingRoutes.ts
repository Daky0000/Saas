import express from 'express';
import type { Router, Request, Response } from 'express';
import Anthropic from '@anthropic-ai/sdk';
import { invalidateSharedContext } from './agentSharedContext.ts';
import { safeAxios } from '../ssrf-guard.ts';
import { FAST_MODEL } from '../ai-helpers.ts';
import { logger } from '../logger.ts';

type AuthResult = { userId: string; role?: string } | null;

interface OnboardingDeps {
  requireAuth: (req: Request, res: Response) => AuthResult;
  dbQuery: <T = any>(sql: string, params?: unknown[]) => Promise<{ rows: T[] }>;
  hasDatabase: () => boolean;
  triggerAgentCompilation: (userId: string) => Promise<void>;
  createNotification: (userId: string, type: string, title: string, message: string, data?: Record<string, any>, pinned?: boolean) => Promise<void>;
  checkTaskActions: (userId: string, actionType: string) => Promise<unknown[]>;
  getAIConfig: () => Promise<{ encryptedKey: string | null }>;
  decryptAIKey: (encryptedKey: string) => string;
}

const str = (v: unknown, max = 500): string => (typeof v === 'string' ? v.trim().slice(0, max) : '');
const strList = (v: unknown, max = 12): string[] =>
  Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string' && x.trim().length > 0).map((x) => x.trim().slice(0, 60)).slice(0, max) : [];

// Must mirror the chip lists in packages/web/src/components/OnboardingWizard.tsx —
// suggestions outside these sets can't be rendered as selected chips.
const INDUSTRIES = [
  'E-commerce', 'SaaS & Tech', 'Agency & Services', 'Creator & Media',
  'Local business', 'Education', 'Health & Wellness', 'Nonprofit', 'Other',
];
const TONES = ['Professional', 'Friendly', 'Bold', 'Playful', 'Luxury', 'Technical', 'Inspirational', 'Witty'];

const PLATFORM_PATTERNS: [RegExp, string][] = [
  [/instagram\.com\//i, 'Instagram'],
  [/facebook\.com\//i, 'Facebook'],
  [/(?:twitter\.com|\/\/(?:www\.)?x\.com)\//i, 'X (Twitter)'],
  [/linkedin\.com\//i, 'LinkedIn'],
  [/tiktok\.com\//i, 'TikTok'],
  [/youtube\.com|youtu\.be/i, 'YouTube'],
  [/pinterest\./i, 'Pinterest'],
  [/wp-content\/|wp-includes\//i, 'WordPress'],
];

function htmlToText(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<noscript[\s\S]*?<\/noscript>/gi, ' ')
    .replace(/<svg[\s\S]*?<\/svg>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/\s+/g, ' ')
    .trim();
}

function extractTag(html: string, pattern: RegExp): string {
  const m = html.match(pattern);
  return m?.[1] ? htmlToText(m[1]).slice(0, 300) : '';
}

export function registerOnboardingRoutes({
  requireAuth,
  dbQuery,
  hasDatabase,
  triggerAgentCompilation,
  createNotification,
  checkTaskActions,
  getAIConfig,
  decryptAIKey,
}: OnboardingDeps): Router {
  const router = express.Router();

  // POST /api/onboarding/analyze-website — fetch the user's site and suggest
  // wizard answers. Best-effort: always returns whatever could be extracted.
  router.post('/onboarding/analyze-website', async (req: Request, res: Response) => {
    const auth = requireAuth(req, res);
    if (!auth) return;

    let website = str((req.body as Record<string, unknown>)?.website, 200);
    if (!website) return res.status(400).json({ success: false, error: 'website is required' });
    if (!/^https?:\/\//i.test(website)) website = `https://${website}`;

    let html = '';
    try {
      const resp = await safeAxios<string>({
        url: website,
        method: 'GET',
        responseType: 'text',
        timeout: 12000,
        maxContentLength: 3 * 1024 * 1024,
        headers: { 'User-Agent': 'Mozilla/5.0 (compatible; DakyworldBot/1.0; +https://dakyworldhub.com)', Accept: 'text/html' },
      });
      html = typeof resp.data === 'string' ? resp.data : '';
    } catch (e: any) {
      return res.status(400).json({ success: false, error: `Couldn't reach that website (${e?.message ?? 'fetch failed'})` });
    }

    const platforms = PLATFORM_PATTERNS.filter(([re]) => re.test(html)).map(([, label]) => label);
    const title = extractTag(html, /<title[^>]*>([\s\S]*?)<\/title>/i);
    const metaDescription =
      extractTag(html, /<meta[^>]+name=["']description["'][^>]+content=["']([^"']*)["']/i) ||
      extractTag(html, /<meta[^>]+content=["']([^"']*)["'][^>]+name=["']description["']/i);
    const siteName = extractTag(html, /<meta[^>]+property=["']og:site_name["'][^>]+content=["']([^"']*)["']/i);
    const bodyText = htmlToText(html).slice(0, 7000);

    // Heuristic fallbacks in case the AI is unavailable
    const suggestions = {
      brandName: siteName || (title.split(/\s*\|\s*|\s+[—–-]\s+/)[0] ?? '').slice(0, 120),
      industry: '',
      offering: metaDescription,
      audience: '',
      tones: [] as string[],
      platforms,
    };
    let summary = '';

    const { encryptedKey } = await getAIConfig().catch(() => ({ encryptedKey: null }));
    const apiKey = (encryptedKey ? decryptAIKey(encryptedKey) : null) || process.env.ANTHROPIC_API_KEY || '';
    if (apiKey && bodyText.length > 50) {
      try {
        const client = new Anthropic({ apiKey });
        const msg = await client.messages.create({
          model: FAST_MODEL,
          max_tokens: 700,
          messages: [{
            role: 'user',
            content: `You are pre-filling a marketing onboarding form from a company's website.

WEBSITE: ${website}
TITLE: ${title || 'n/a'}
META DESCRIPTION: ${metaDescription || 'n/a'}
PAGE TEXT:
${bodyText}

Return ONLY valid JSON (no markdown fences) with exactly these keys:
{
  "brandName": "official brand/company name, or empty string",
  "industry": "the single closest match from this exact list, or empty string: ${INDUSTRIES.join(', ')}",
  "offering": "1-2 plain sentences describing what they offer, written from the brand's perspective (e.g. 'We sell ...'), or empty string",
  "audience": "1-2 plain sentences describing who their target audience appears to be, or empty string",
  "tones": ["up to 3 that match the site's voice, only from this exact list: ${TONES.join(', ')}"],
  "summary": "2-3 sentences on what the website communicates about the brand"
}
Only use information present or strongly implied by the page. Use empty strings/arrays when unsure.`,
          }],
        });
        const raw = msg.content.find((b) => b.type === 'text')?.text ?? '';
        const match = raw.match(/\{[\s\S]*\}/);
        if (match) {
          const ai = JSON.parse(match[0]) as Record<string, unknown>;
          const aiBrand = str(ai.brandName, 120);
          const aiIndustry = str(ai.industry, 80);
          const aiOffering = str(ai.offering);
          const aiAudience = str(ai.audience);
          if (aiBrand) suggestions.brandName = aiBrand;
          if (INDUSTRIES.includes(aiIndustry)) suggestions.industry = aiIndustry;
          if (aiOffering) suggestions.offering = aiOffering;
          if (aiAudience) suggestions.audience = aiAudience;
          suggestions.tones = strList(ai.tones).filter((t) => TONES.includes(t)).slice(0, 3);
          summary = str(ai.summary, 600);
        }
      } catch (e: any) {
        logger.warn(`Onboarding website analysis AI step failed for ${website}: ${e?.message}`);
      }
    }

    // Stash what the site communicates as Website Intelligence memory
    if (hasDatabase() && summary) {
      try {
        await dbQuery(`DELETE FROM user_memories WHERE user_id = $1 AND source = 'scraped' AND title = 'Website snapshot'`, [auth.userId]);
        await dbQuery(
          `INSERT INTO user_memories (user_id, category, title, content, source) VALUES ($1, 'website', 'Website snapshot', $2, 'scraped')`,
          [auth.userId, `${website} — ${summary}`]
        );
      } catch (e: any) {
        logger.warn(`Onboarding website memory save failed: ${e?.message}`);
      }
    }

    return res.json({ success: true, suggestions, sourceUrl: website });
  });

  // GET /api/onboarding — completion status + saved answers
  router.get('/onboarding', async (req: Request, res: Response) => {
    const auth = requireAuth(req, res);
    if (!auth) return;
    if (!hasDatabase()) return res.json({ success: true, completed: true, skipped: false, data: {} });
    try {
      const r = await dbQuery<{ onboarding: Record<string, any> | null }>(
        `SELECT onboarding FROM users WHERE id = $1`,
        [auth.userId]
      );
      const data = r.rows[0]?.onboarding ?? {};
      return res.json({
        success: true,
        completed: Boolean(data.completed_at),
        skipped: Boolean(data.skipped_at),
        data,
      });
    } catch (e: any) {
      return res.status(500).json({ success: false, error: e.message });
    }
  });

  // POST /api/onboarding — save answers, seed the AI memory, recompile agents
  router.post('/onboarding', async (req: Request, res: Response) => {
    const auth = requireAuth(req, res);
    if (!auth) return;
    if (!hasDatabase()) return res.json({ success: true, memoriesCreated: 0 });

    const body = (req.body ?? {}) as Record<string, unknown>;
    const brandName = str(body.brandName, 120);
    const website = str(body.website, 200);
    const industry = str(body.industry, 80);
    const offering = str(body.offering);
    const audience = str(body.audience);
    const tones = strList(body.tones);
    const goals = strList(body.goals);
    const platforms = strList(body.platforms);

    // Each answered question becomes a memory entry the agents compile into context.
    const entries: { category: string; title: string; content: string }[] = [];
    if (brandName) entries.push({ category: 'brand', title: 'Brand name', content: website ? `${brandName} (${website})` : brandName });
    if (industry || offering) entries.push({ category: 'business', title: 'What we do', content: [industry, offering].filter(Boolean).join(' — ') });
    if (audience) entries.push({ category: 'audience', title: 'Target audience', content: audience });
    if (tones.length) entries.push({ category: 'brand', title: 'Tone of voice', content: tones.join(', ') });
    if (goals.length) entries.push({ category: 'content', title: 'Marketing goals', content: goals.join(', ') });
    if (platforms.length) entries.push({ category: 'social', title: 'Priority platforms', content: platforms.join(', ') });

    try {
      const answers = {
        brandName, website, industry, offering, audience, tones, goals, platforms,
        completed_at: new Date().toISOString(),
      };
      await dbQuery(`UPDATE users SET onboarding = $2::jsonb WHERE id = $1`, [auth.userId, JSON.stringify(answers)]);
      if (website) {
        await dbQuery(`UPDATE users SET website = COALESCE(NULLIF(website, ''), $2) WHERE id = $1`, [auth.userId, website]).catch(() => undefined);
      }

      if (entries.length) {
        // Re-running onboarding replaces the entries it owns instead of duplicating them.
        await dbQuery(
          `DELETE FROM user_memories WHERE user_id = $1 AND source = 'manual' AND title = ANY($2)`,
          [auth.userId, entries.map((e) => e.title)]
        );
        for (const e of entries) {
          await dbQuery(
            `INSERT INTO user_memories (user_id, category, title, content, source) VALUES ($1, $2, $3, $4, 'manual')`,
            [auth.userId, e.category, e.title, e.content]
          );
        }
        triggerAgentCompilation(auth.userId).catch(() => undefined);
        invalidateSharedContext(auth.userId);
        void checkTaskActions(auth.userId, 'save_memory');
        createNotification(
          auth.userId, 'onboarding_complete',
          'Your AI team is briefed',
          `${entries.length} brand ${entries.length === 1 ? 'fact' : 'facts'} saved to memory${brandName ? ` — every agent now personalizes for ${brandName}` : ''}. Refine anytime on the Memory page.`,
        ).catch(() => undefined);
      }

      return res.json({ success: true, memoriesCreated: entries.length });
    } catch (e: any) {
      return res.status(500).json({ success: false, error: e.message });
    }
  });

  // POST /api/onboarding/skip — remember the dismissal across devices
  router.post('/onboarding/skip', async (req: Request, res: Response) => {
    const auth = requireAuth(req, res);
    if (!auth) return;
    if (!hasDatabase()) return res.json({ success: true });
    try {
      await dbQuery(
        `UPDATE users SET onboarding = COALESCE(onboarding, '{}'::jsonb) || jsonb_build_object('skipped_at', NOW()) WHERE id = $1`,
        [auth.userId]
      );
      return res.json({ success: true });
    } catch (e: any) {
      return res.status(500).json({ success: false, error: e.message });
    }
  });

  return router;
}
