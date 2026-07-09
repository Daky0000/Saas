import { Router, type Request, type Response } from 'express';
import Anthropic from '@anthropic-ai/sdk';
import axios from 'axios';
import { randomUUID } from 'crypto';
import pino from 'pino';
import type { Pool } from 'pg';
import {
  getMagnificApiKey,
  getFreepikApiKey,
  magnificPost,
  pollMagnificTask,
  magnificGenerateImage,
  freepikGenerateImage,
  sanitizeMagnificError,
  MAGNIFIC_IMAGE_MODELS,
  MAGNIFIC_VIDEO_MODELS,
  ASPECT_RATIO_MAP,
  FREEPIK_IMAGE_MODELS,
} from './magnificRoutes.ts';
import { FAST_MODEL, recordAIUsage, chargeAICredits, hasAICredits } from '../ai-helpers.ts';

const logger = pino();

type AuthResult = { userId: string; role: string } | null;
type DbQueryFn = <T = any>(sql: string, params?: unknown[]) => Promise<{ rows: T[] }>;
type AIConfig = { encryptedKey: string | null; activeProvider?: string; activeModel?: string };

export interface NovaDeps {
  requireAuth: (req: Request, res: Response) => AuthResult;
  requireAdmin: (req: Request, res: Response) => Promise<{ userId: string } | null>;
  hasDatabase: () => boolean;
  dbQuery: DbQueryFn;
  pool: Pool | null;
  getAIConfig: () => Promise<AIConfig>;
  resolveActiveKey: (config: AIConfig) => string;
  decryptAIKey: (key: string) => string;
  AGENT_DEFS: Record<string, { name: string; role: string; icon: string; color: string; memoryKeywords: string[] }>;
}

const USER_AGENT_MODELS: Record<string, string> = {
  sage: 'claude-sonnet-4-6',
  daky: FAST_MODEL,
  nova: FAST_MODEL,
  aria: FAST_MODEL,
  flux: FAST_MODEL,
};

const USER_AGENT_PROMPTS: Record<string, string> = {
  daky: `You are Daky, a creative content writer AI agent working for a user's social media marketing team.
Your job is to generate 2-3 concrete content proposals based on the user's brand profile, active platforms, and marketing goals.
Each proposal should be a ready-to-use content piece or a clearly actionable content brief.
You always match the user's brand tone and speak to their target audience.`,

  nova: `You are Nova, an AI creative director working for a user's social media marketing team.
Your job is to generate 2-3 visual content proposals — image concepts, campaign visuals, or design briefs — based on the user's brand.
Each proposal should be specific enough that a designer or AI image generator can execute it immediately.
Include style direction, color mood, and platform context in each proposal.`,

  sage: `You are Sage, an AI strategy analyst working for a user's social media marketing team.
Your job is to generate 2-3 strategic marketing proposals based on the user's goals, audience, niche, and connected platforms.
Each proposal should be a concrete, actionable strategy recommendation — not vague advice.
Think like a CMO: identify specific opportunities, gaps, or plays that will move the needle on their goals.`,

  aria: `You are Aria, an AI analytics and performance specialist working for a user's social media marketing team.
Your job is to generate 2-3 data-driven insights or performance improvement proposals based on the user's connected platforms and brand goals.
Each proposal should identify a specific metric to track, an optimization to make, or an audit to run.
Be concrete — name the platform, the metric, and the expected impact.`,

  flux: `You are Flux, an AI automation and workflow specialist working for a user's social media marketing team.
Your job is to generate 2-3 automation or workflow proposals based on the user's connected platforms and content cadence.
Each proposal should describe a specific automation to set up — like cross-posting, scheduling cadences, or integration workflows.
Be specific about which platforms, what triggers the automation, and what outcome it achieves.`,

  trend_research: `You are Trend, an AI trend research specialist for a user's marketing team.
Your job is to generate 2-3 proposals identifying trending topics, viral formats, or rising niche conversations the brand should act on.
Each proposal should name a specific trend, explain why it's relevant to this brand, and suggest a concrete content angle to capitalize on it.`,

  audience_research: `You are Persona, an AI audience research specialist for a user's marketing team.
Your job is to generate 2-3 audience insight proposals — detailed personas, pain-point analyses, or objection maps — tailored to the brand's niche.
Each proposal should be specific enough to directly inform content creation or messaging strategy.`,

  seo_research: `You are SEO, an AI keyword research specialist for a user's marketing team.
Your job is to generate 2-3 SEO proposals — keyword clusters, content brief outlines, or search-intent analyses — that will drive organic traffic.
Each proposal should name specific keywords, explain the search intent, and suggest a content format to target them.`,

  hook_writing: `You are Hook, an AI hook-writing specialist for a user's marketing team.
Your job is to generate 2-3 proposals each containing 5-10 scroll-stopping hook variations — opening lines, subject lines, or ad headlines — for the brand's content.
Each proposal should be tied to a specific platform or content type and explain why the hooks work.`,

  social_caption: `You are Caption, an AI social caption specialist for a user's marketing team.
Your job is to generate 2-3 platform-specific caption proposals with hooks, body copy, CTAs, and relevant hashtags.
Tailor each proposal to the platform's format (Instagram, TikTok, LinkedIn, Twitter/X) and the brand's tone.`,

  video_script: `You are Script, an AI video script writer for a user's marketing team.
Your job is to generate 2-3 video script proposals — either short-form (under 60 seconds for Reels/TikTok) or long-form (YouTube).
Each proposal should include a hook, structured outline, and key talking points with retention-focused transitions.`,

  ad_copy: `You are Ads, an AI ad copywriter for a user's marketing team.
Your job is to generate 2-3 ad copy proposals — each targeting a specific angle (pain, benefit, social proof) for Meta, Google, or YouTube ads.
Include multiple headline and body copy variations per proposal with a clear CTA.`,

  thumbnail_design: `You are Thumb, an AI thumbnail design strategist for a user's marketing team.
Your job is to generate 2-3 thumbnail design proposals for YouTube or social ads — including concept direction, text overlay copy, color palette, and A/B test variants.
Each proposal should be specific enough for a designer or AI image tool to execute.`,

  meta_ads: `You are Meta, an AI paid social manager for a user's marketing team.
Your job is to generate 2-3 Meta (Facebook/Instagram) campaign proposals — including campaign objective, audience targeting, budget structure, and creative direction.
Each proposal should include a brief performance optimization checklist.`,
};

const USER_AGENT_CHAT_PROMPTS: Record<string, string> = {
  daky: `You are Daky, a creative content writer AI on the user's marketing team. Help them brainstorm content ideas, refine copy, and think through their content strategy. Be conversational, encouraging, and creative. Keep replies focused — 2-4 sentences unless asked for detail.`,
  nova: `You are Nova, a creative director AI. Chat with the user about visual concepts, design aesthetics, branding decisions, and campaign visuals. Be inspiring and specific. Keep replies focused.`,
  sage: `You are Sage, a strategic marketing analyst AI. Help the user think through their marketing strategy, audience positioning, and growth priorities. Be thoughtful and data-informed. Keep replies focused.`,
  aria: `You are Aria, an analytics and performance AI. Help the user understand their KPIs, interpret metrics, and find optimisation opportunities. Be precise and quantitative. Keep replies focused.`,
  flux: `You are Flux, an automation and workflow AI. Help the user design posting schedules, automation triggers, and workflow sequences. Be practical and step-by-step. Keep replies focused.`,
};

const REPLICATE_BASE = 'https://api.replicate.com';

const REPLICATE_MODEL_MAP: Record<string, { owner: string; name: string }> = {
  'flux-2-turbo':          { owner: 'black-forest-labs', name: 'flux-schnell' },
  'flux-2-klein':          { owner: 'black-forest-labs', name: 'flux-schnell' },
  'hyperflux':             { owner: 'black-forest-labs', name: 'flux-schnell' },
  'z-image':               { owner: 'black-forest-labs', name: 'flux-schnell' },
  'nano-banana-pro-flash': { owner: 'black-forest-labs', name: 'flux-schnell' },
  'flux-kontext-pro':      { owner: 'black-forest-labs', name: 'flux-dev' },
  'flux-2-pro':            { owner: 'black-forest-labs', name: 'flux-dev' },
  'flux-dev':              { owner: 'black-forest-labs', name: 'flux-dev' },
  'flux-pro-v1-1':         { owner: 'black-forest-labs', name: 'flux-dev' },
  'seedream-v5-lite':      { owner: 'black-forest-labs', name: 'flux-dev' },
  'seedream-v4-5':         { owner: 'black-forest-labs', name: 'flux-dev' },
  'seedream-v4':           { owner: 'black-forest-labs', name: 'flux-dev' },
  'gemini-flash':          { owner: 'black-forest-labs', name: 'flux-dev' },
  'nano-banana-pro':       { owner: 'black-forest-labs', name: 'flux-dev' },
  'mystic':                { owner: 'black-forest-labs', name: 'flux-dev' },
};

const REPLICATE_ASPECT_MAP: Record<string, string> = {
  'square_1_1':      '1:1',
  'widescreen_16_9': '16:9',
  'portrait_9_16':   '9:16',
  'classic_4_3':     '4:3',
  'portrait_3_4':    '3:4',
  'cinematic_21_9':  '21:9',
};

function slugify(text: string): string {
  return text.toLowerCase().trim().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
}

async function replicateGenerateImage(
  magnificModelId: string,
  prompt: string,
  magnificAspect: string,
  apiKey: string,
): Promise<{ url: string | null; error: string | null }> {
  const mdl = REPLICATE_MODEL_MAP[magnificModelId] ?? { owner: 'black-forest-labs', name: 'flux-schnell' };
  const aspect = REPLICATE_ASPECT_MAP[magnificAspect] ?? '1:1';

  const submitResp = await axios.post(
    `${REPLICATE_BASE}/v1/models/${mdl.owner}/${mdl.name}/predictions`,
    { input: { prompt, aspect_ratio: aspect, output_format: 'webp', output_quality: 85, num_outputs: 1 } },
    {
      headers: {
        'Authorization': `Token ${apiKey}`,
        'Content-Type': 'application/json',
        'Prefer': 'wait=30',
      },
      validateStatus: () => true,
      timeout: 40000,
    },
  );

  if (submitResp.status === 401) return { url: null, error: 'Invalid Replicate API token' };
  if (submitResp.status >= 400) {
    return { url: null, error: submitResp.data?.detail ?? submitResp.data?.error ?? `Replicate error ${submitResp.status}` };
  }

  let prediction = submitResp.data;

  if (prediction.status === 'succeeded') {
    const url: string = Array.isArray(prediction.output) ? prediction.output[0] : prediction.output;
    return { url: url ?? null, error: url ? null : 'No output from Replicate' };
  }

  const pollUrl: string = prediction.urls?.get;
  if (!pollUrl) return { url: null, error: 'No prediction URL from Replicate' };

  const deadline = Date.now() + 120_000;
  while (Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, 3000));
    const poll = await axios.get(pollUrl, {
      headers: { 'Authorization': `Token ${apiKey}` },
      validateStatus: () => true,
      timeout: 10000,
    });
    if (poll.status >= 400) continue;
    const p = poll.data;
    if (p.status === 'succeeded') {
      const url: string = Array.isArray(p.output) ? p.output[0] : p.output;
      return { url: url ?? null, error: url ? null : 'No output from Replicate' };
    }
    if (p.status === 'failed' || p.status === 'canceled') {
      return { url: null, error: p.error ?? 'Replicate generation failed' };
    }
  }
  return { url: null, error: 'Timeout: Replicate generation took too long' };
}

type WfSeed = { name: string; description: string; steps: any[] };
const WORKFLOW_DEFAULTS: Record<string, WfSeed[]> = {
  nova: [
    {
      name: 'Brand Identity Visual', description: 'Search design concepts, tailor to brand memory, then generate a branded image via Freepik AI.',
      steps: [
        { id: 'step_search',   name: 'Search Designs',        tool: 'meigen_search',         description: 'Find design templates', prompt_template: 'Search for designs matching: {input}. Style niche: {brand.niche}', params: { top_n: 5 } },
        { id: 'step_extract',  name: 'Extract Style Prompts', tool: 'claude_synthesize',      description: 'Extract visual styles and prompts', prompt_template: 'Extract 3–5 key visual styles with image prompts from:\n{step_search.result}', params: {} },
        { id: 'step_tailor',   name: 'Tailor to Brand',       tool: 'claude_synthesize',      description: 'Blend inspiration with brand memory', prompt_template: 'Create one optimized image prompt for brand:\nNiche: {brand.niche}\nTone: {brand.tone}\nAudience: {brand.audience}\nDesigns: {step_extract.result}\n\nReturn ONLY JSON: { "prompt": "...", "model": "freepik-mystic" }', params: {} },
        { id: 'step_generate', name: 'Generate via Freepik',  tool: 'freepik_generate_image', description: 'Generate image via Freepik AI', prompt_template: '{step_tailor.prompt}', params: { auto_if_memory: true } },
        { id: 'step_save',     name: 'Save Design',           tool: 'save_design',            description: 'Save to designs collection', prompt_template: '', params: {} },
      ],
    },
    {
      name: 'Social Media Post Image', description: 'Generate a platform-optimized social media image tailored to brand and audience.',
      steps: [
        { id: 'step_brief',    name: 'Draft Visual Brief',   tool: 'claude_synthesize',       description: 'Write image brief for the post', prompt_template: 'Image brief for {input} social media post.\nNiche: {brand.niche}, tone: {brand.tone}, audience: {brand.audience}\nReturn ONLY JSON: { "prompt": "...", "model": "freepik-mystic" }', params: {} },
        { id: 'step_generate', name: 'Generate via Freepik', tool: 'freepik_generate_image',  description: 'Generate via Freepik', prompt_template: '{step_brief.prompt}', params: {} },
        { id: 'step_save',     name: 'Save Design',          tool: 'save_design',             description: 'Save to designs', prompt_template: '', params: {} },
      ],
    },
    {
      name: 'Product Promo Banner', description: 'Create a promotional banner using brand memory and Freepik generation.',
      steps: [
        { id: 'step_concept',  name: 'Build Promo Concept',  tool: 'claude_synthesize',       description: 'Generate banner concept', prompt_template: 'Promo banner for: {input}\nNiche: {brand.niche}, tone: {brand.tone}\nReturn ONLY JSON: { "prompt": "...", "model": "freepik-mystic", "headline": "..." }', params: {} },
        { id: 'step_generate', name: 'Generate via Freepik', tool: 'freepik_generate_image',  description: 'Generate banner via Freepik', prompt_template: '{step_concept.prompt}', params: {} },
        { id: 'step_save',     name: 'Save Design',          tool: 'save_design',             description: 'Save to designs', prompt_template: '', params: {} },
      ],
    },
    {
      name: 'AI Brand Video', description: 'Generate a short branded video clip using Magnific AI.',
      steps: [
        { id: 'step_script',   name: 'Write Video Brief', tool: 'claude_synthesize',          description: 'Draft video concept', prompt_template: 'Text-to-video prompt for: {input}\nNiche: {brand.niche}, tone: {brand.tone}\nReturn ONLY JSON: { "prompt": "...", "model": "wan-2-7-t2v" }', params: {} },
        { id: 'step_generate', name: 'Generate Video',    tool: 'generate_video',             description: 'Generate branded video', prompt_template: '{step_script.prompt}', params: {} },
      ],
    },
    {
      name: 'Content Mood Board', description: 'Generate multiple visual concepts for a content campaign via Freepik.',
      steps: [
        { id: 'step_concepts', name: 'Generate Visual Ideas', tool: 'claude_synthesize',      description: 'Create 5 mood board concepts', prompt_template: '5 visual mood board concepts for: {input}\nBrand: {brand.niche}, tone: {brand.tone}\nReturn ONLY JSON array: [{ "name": "...", "prompt": "..." }]', params: {} },
        { id: 'step_generate', name: 'Generate Hero Image',   tool: 'freepik_generate_image', description: 'Generate hero image via Freepik', prompt_template: '{step_concepts.result}', params: { use_first_prompt: true } },
        { id: 'step_save',     name: 'Save Design',           tool: 'save_design',            description: 'Save to designs', prompt_template: '', params: {} },
      ],
    },
  ],
  sage: [
    {
      name: 'Competitor Analysis', description: 'Analyze competitors and surface strategic differentiation opportunities.',
      steps: [
        { id: 'step_research', name: 'Research Competitors', tool: 'claude_synthesize',       description: 'Generate competitor landscape', prompt_template: 'Competitor analysis for {brand.niche}.\nRequest: {input}\nAudience: {brand.audience}\n\nAnalyze top 3–5 competitors: positioning, content strategy, strengths/weaknesses, gaps.', params: {} },
        { id: 'step_summary',  name: 'Strategic Summary',   tool: 'claude_synthesize',        description: 'Distill into recommendations', prompt_template: 'From this analysis:\n{step_research.result}\n\nWrite strategic recommendations: differentiation opportunities, content gaps, positioning angle, top 3 actions.', params: {} },
      ],
    },
    {
      name: 'Content Strategy Plan', description: 'Build a 30-day content strategy aligned to brand goals.',
      steps: [
        { id: 'step_audit',  name: 'Audit Brand Positioning', tool: 'claude_synthesize',      description: 'Assess positioning and gaps', prompt_template: 'Audit content positioning for {brand.niche}.\nTone: {brand.tone}, audience: {brand.audience}\nRequest: {input}\n\nIdentify: gaps, pain points, content pillars, platforms to prioritize.', params: {} },
        { id: 'step_plan',   name: 'Build 30-Day Plan',       tool: 'claude_synthesize',      description: 'Create monthly content plan', prompt_template: 'Using this audit:\n{step_audit.result}\n\nBuild a 30-day content strategy: 4 weekly themes, daily post types, platform mix, KPIs to track.', params: {} },
      ],
    },
    {
      name: 'Audience Persona Builder', description: 'Create 3 detailed target audience personas with actionable insights.',
      steps: [
        { id: 'step_research', name: 'Research Audience',  tool: 'claude_synthesize',         description: 'Research audience characteristics', prompt_template: 'Target audience research for {brand.niche}.\nCurrent audience: {brand.audience}\nRequest: {input}\n\nIdentify: demographics, psychographics, pain points, goals, preferred platforms, purchasing triggers.', params: {} },
        { id: 'step_personas', name: 'Build 3 Personas',  tool: 'claude_synthesize',          description: 'Create persona profiles', prompt_template: 'Create 3 detailed audience personas from:\n{step_research.result}\n\nEach persona: name, age/role, goals, pain points, preferred content, platforms, how this brand helps.', params: {} },
      ],
    },
    {
      name: 'Campaign Brief Writer', description: 'Write a complete marketing campaign brief from goals to creative direction.',
      steps: [
        { id: 'step_objectives', name: 'Define Objectives', tool: 'claude_synthesize',        description: 'Clarify campaign goals', prompt_template: 'Campaign objectives for: {input}\nBrand: {brand.niche}, tone: {brand.tone}, audience: {brand.audience}\n\nSpecify: primary goal, KPIs, target segment, timeline, budget framework.', params: {} },
        { id: 'step_brief',      name: 'Write Full Brief',  tool: 'claude_synthesize',        description: 'Write comprehensive brief', prompt_template: 'Campaign brief from:\n{step_objectives.result}\n\nInclude: concept, messaging framework, content mix, channel strategy, creative direction, timeline, success criteria.', params: {} },
      ],
    },
    {
      name: 'Brand Positioning Statement', description: 'Craft a compelling brand positioning statement and tagline.',
      steps: [
        { id: 'step_analysis',  name: 'Positioning Analysis', tool: 'claude_synthesize',      description: 'Analyze brand differentiators', prompt_template: 'Positioning analysis for {brand.niche}.\nTone: {brand.tone}, audience: {brand.audience}\nInput: {input}\n\nIdentify: unique value props, differentiators, emotional and functional benefits, competitive gaps.', params: {} },
        { id: 'step_statement', name: 'Write Positioning',    tool: 'claude_synthesize',      description: 'Draft positioning options', prompt_template: 'From this analysis:\n{step_analysis.result}\n\nWrite 3 brand positioning statements for {brand.niche}. Include a tagline for each.', params: {} },
      ],
    },
  ],
  aria: [
    {
      name: 'Performance Summary', description: 'Analyze KPIs and surface actionable performance insights.',
      steps: [
        { id: 'step_kpis',     name: 'Define Key Metrics',  tool: 'claude_synthesize',        description: 'Identify critical KPIs', prompt_template: '5 critical KPIs for {brand.niche}.\nRequest: {input}, audience: {brand.audience}\n\nFor each KPI: what it measures, why it matters, benchmark target, how to improve.', params: {} },
        { id: 'step_insights', name: 'Synthesize Insights', tool: 'claude_synthesize',        description: 'Distill into recommendations', prompt_template: 'Performance summary from KPIs:\n{step_kpis.result}\n\nFor {brand.niche}: overall health score (1–10), top areas, underperforming areas, 3 immediate optimization recommendations.', params: {} },
      ],
    },
    {
      name: 'Engagement Analysis', description: 'Break down content engagement patterns to identify what resonates.',
      steps: [
        { id: 'step_patterns', name: 'Analyze Patterns',    tool: 'claude_synthesize',        description: 'Identify engagement patterns', prompt_template: 'Engagement patterns for {brand.niche} targeting {brand.audience}.\nRequest: {input}\n\nBreak down: best content types, optimal posting times, engagement benchmarks, format performance.', params: {} },
        { id: 'step_recs',     name: 'Engagement Playbook', tool: 'claude_synthesize',        description: 'Create optimization playbook', prompt_template: 'From these patterns:\n{step_patterns.result}\n\nPlaybook for {brand.niche}: top 3 formats, posting schedule, caption/CTA strategies, community tactics, A/B test ideas.', params: {} },
      ],
    },
    {
      name: 'Growth Opportunity Report', description: 'Identify and prioritize the highest-impact growth opportunities.',
      steps: [
        { id: 'step_gaps',   name: 'Find Growth Gaps',    tool: 'claude_synthesize',          description: 'Identify underexplored opportunities', prompt_template: 'Growth opportunities for {brand.niche}.\nAudience: {brand.audience}, tone: {brand.tone}\nRequest: {input}\n\nAnalyze: untapped formats, underutilized platforms, audience segments, hashtag/SEO gaps, partnerships.', params: {} },
        { id: 'step_report', name: 'Prioritize & Plan',   tool: 'claude_synthesize',          description: 'Prioritize by impact and effort', prompt_template: 'From these opportunities:\n{step_gaps.result}\n\nPrioritized growth plan for {brand.niche}: quick wins (this week), medium-term (this month), long-term (this quarter). Each: opportunity, impact, effort, first step.', params: {} },
      ],
    },
    {
      name: 'Monthly Insights Report', description: 'Compile a comprehensive monthly performance report with next-month strategy.',
      steps: [
        { id: 'step_review',  name: 'Monthly Review',       tool: 'claude_synthesize',        description: 'Review monthly performance', prompt_template: 'Monthly review for {brand.niche}.\nRequest: {input}, audience: {brand.audience}\n\nCover: content volume, engagement trends, growth, top posts, biggest misses, revenue/lead impact.', params: {} },
        { id: 'step_forward', name: 'Next Month Strategy',  tool: 'claude_synthesize',        description: 'Draft next month recommendations', prompt_template: 'From this monthly review:\n{step_review.result}\n\nNext-month strategy for {brand.niche}: double down, stop/fix, tests to run, focus KPIs, content themes.', params: {} },
      ],
    },
  ],
  flux: [
    {
      name: 'Content Repurposer', description: 'Adapt one piece of content into platform-specific formats for maximum reach.',
      steps: [
        { id: 'step_analyze',   name: 'Analyze Source Content',     tool: 'claude_synthesize',  description: 'Extract core message and intent', prompt_template: 'Analyze for repurposing: {input}\nBrand: {brand.niche}, tone: {brand.tone}\n\nExtract: core message, key quotes, supporting points, target emotion, content type.', params: {} },
        { id: 'step_repurpose', name: 'Generate Platform Variants', tool: 'draft_content',      description: 'Write platform-specific variations', prompt_template: 'Repurpose this content:\n{step_analyze.result}\n\nWrite variants for:\n1. Instagram caption (150 chars + hashtags)\n2. LinkedIn post (200 words)\n3. Twitter/X thread (3–5 tweets)\n4. TikTok script (30-sec)\n5. Email newsletter intro (100 words)\n\nTone: {brand.tone}', params: {} },
      ],
    },
    {
      name: 'Caption & Hashtag Generator', description: 'Write 3 caption variations and a tiered hashtag strategy for any post.',
      steps: [
        { id: 'step_caption',  name: 'Write Caption Options', tool: 'draft_content',           description: 'Generate 3 caption variations', prompt_template: '3 caption variations for: {input}\nNiche: {brand.niche}, tone: {brand.tone}, audience: {brand.audience}\n\n1. Hook-driven\n2. Storytelling\n3. Value-first\n\nEach 80–150 chars with CTA.', params: {} },
        { id: 'step_hashtags', name: 'Hashtag Strategy',      tool: 'draft_content',           description: 'Categorize hashtags by reach tier', prompt_template: 'Hashtag strategy for: {input}\nNiche: {brand.niche}\n\n30 hashtags across 3 tiers:\n- 10 High-reach (1M+ posts)\n- 10 Mid-reach (100K–1M)\n- 10 Niche (10K–100K)\n\nPlus 5 brand-specific hashtags.', params: {} },
      ],
    },
    {
      name: 'Weekly Content Plan', description: 'Build a complete 7-day posting schedule with themes and caption ideas.',
      steps: [
        { id: 'step_themes',   name: 'Define Weekly Themes',    tool: 'draft_content',          description: 'Establish 7 daily content themes', prompt_template: 'Weekly content themes for {brand.niche}.\nTone: {brand.tone}, audience: {brand.audience}, goal: {input}\n\n7 daily themes using pillars: educational, entertaining, promotional, engagement, behind-scenes, user stories, trending.', params: {} },
        { id: 'step_schedule', name: 'Build Posting Schedule',  tool: 'draft_content',          description: 'Create the full 7-day schedule', prompt_template: 'From these themes:\n{step_themes.result}\n\n7-day posting plan for {brand.niche}: day, time, platform, content type, caption idea, visual direction. Include 2 reels, 3 static posts, 1 carousel, 1 story series.', params: {} },
      ],
    },
    {
      name: 'Post Batch Generator', description: 'Generate 10 ready-to-use post ideas with captions for bulk scheduling.',
      steps: [
        { id: 'step_ideas',    name: 'Generate Post Ideas', tool: 'draft_content',             description: 'Brainstorm 10 post concepts', prompt_template: '10 post ideas for {brand.niche}.\nTone: {brand.tone}, audience: {brand.audience}, topic: {input}\n\nFor each: title, format, hook, message, platform, angle.', params: {} },
        { id: 'step_captions', name: 'Write All Captions',  tool: 'draft_content',             description: 'Write captions for all posts', prompt_template: 'Captions for all 10 posts:\n{step_ideas.result}\n\nEach: full caption (100–200 chars), 3 emojis, CTA, 5–10 hashtags. Tone: {brand.tone}', params: {} },
      ],
    },
  ],
  daky: [
    {
      name: 'Full Campaign Launch', description: 'Orchestrate a complete campaign — strategy, content framework, and master brief.',
      steps: [
        { id: 'step_strategy', name: 'Campaign Strategy',     tool: 'claude_synthesize',       description: 'Define strategy and objectives', prompt_template: 'Full campaign strategy for: {input}\nBrand: {brand.niche}, tone: {brand.tone}, audience: {brand.audience}\n\nDefine: name, objective, key message, target segment, channels, timeline, content mix, success metrics.', params: {} },
        { id: 'step_content',  name: 'Content Framework',     tool: 'draft_content',           description: 'Create execution content plan', prompt_template: 'Content framework from:\n{step_strategy.result}\n\nFor {brand.niche}: launch week plan (7 posts), visual direction brief for Nova, copy guide for Flux, KPIs for Aria, automation notes for Flux.', params: {} },
        { id: 'step_brief',    name: 'Master Campaign Brief', tool: 'claude_synthesize',       description: 'Compile master brief for all agents', prompt_template: 'Master brief from:\nStrategy: {step_strategy.result}\nContent: {step_content.result}\n\nActionable brief for each role: creative, content, analytics. Include: overview, role briefs, timeline, dependencies, launch checklist.', params: {} },
      ],
    },
    {
      name: 'Brand Onboarding', description: 'Guide a new user through brand setup and prepare all agents for first use.',
      steps: [
        { id: 'step_collect', name: 'Brand Discovery',    tool: 'claude_synthesize',           description: 'Extract and organize brand information', prompt_template: 'Onboarding a new brand.\nInput: {input}\n\nExtract: business name, industry, target audience, tone/personality, products/services, competitors, marketing goals, social presence. Format as structured brand profile.', params: {} },
        { id: 'step_memory',  name: 'Memory Setup Guide', tool: 'claude_synthesize',           description: 'Create memory setup guide for the user', prompt_template: 'Memory setup guide from:\n{step_collect.result}\n\nExplain: what to save in Brand Memory, suggested keywords, which agent handles what, recommended first workflows, 7-day quick-start plan.', params: {} },
      ],
    },
    {
      name: 'Weekly Marketing Review', description: 'Compile a cross-team weekly review with performance insights and next-week priorities.',
      steps: [
        { id: 'step_review', name: 'Weekly Review',          tool: 'claude_synthesize',        description: 'Analyze the week across all dimensions', prompt_template: 'Weekly review for {brand.niche}.\nContext: {input}, audience: {brand.audience}\n\nCover: content performance, engagement trends, top/bottom posts, audience growth, campaign progress, what worked and what did not.', params: {} },
        { id: 'step_plan',   name: 'Next Week Action Plan',  tool: 'claude_synthesize',        description: 'Draft next week priorities per agent', prompt_template: 'From this review:\n{step_review.result}\n\nNext-week action plan for {brand.niche}:\n- Nova: visuals to create\n- Sage: strategy adjustments\n- Flux: automation tasks\n- Aria: metrics to focus on\n- Key decisions and deadlines', params: {} },
      ],
    },
  ],
};

export function buildNovaModule(deps: NovaDeps): { router: Router; runScheduledAgents: () => Promise<void> } {
  const { requireAuth, requireAdmin, hasDatabase, dbQuery, pool, getAIConfig, resolveActiveKey, decryptAIKey, AGENT_DEFS } = deps;

  const AGENT_NAMES: Record<string, string> = Object.fromEntries(Object.entries(AGENT_DEFS).map(([k, v]) => [k, v.name]));

  async function getReplicateApiKey(): Promise<string> {
    const envKey = process.env.REPLICATE_API_TOKEN;
    if (envKey) return envKey;
    try {
      const cfg = await pool!.query(`SELECT config FROM platform_configs WHERE platform = 'replicate' LIMIT 1`);
      return cfg.rows[0]?.config?.apiKey ?? '';
    } catch (_err) { return ''; }
  }

  async function gatherPlatformSnapshot(agentKey: string): Promise<Record<string, any>> {
    if (!pool) return {};
    const data: Record<string, any> = { snapshot_at: new Date().toUTCString() };
    const safe = async (label: string, fn: () => Promise<any>) => {
      try { data[label] = await fn(); } catch (_err) { /* skip incomplete data */ }
    };
    await safe('users', async () => {
      const { rows } = await dbQuery(`
        SELECT
          COUNT(*)                                                           AS total,
          COUNT(*) FILTER (WHERE status='active')                           AS active,
          COUNT(*) FILTER (WHERE status='suspended')                        AS suspended,
          COUNT(*) FILTER (WHERE created_at > NOW() - INTERVAL '7 days')   AS new_7d,
          COUNT(*) FILTER (WHERE created_at > NOW() - INTERVAL '24 hours') AS new_24h
        FROM users WHERE role = 'user'
      `);
      return rows[0];
    });
    if (['ceo', 'cro'].includes(agentKey)) {
      await safe('revenue', async () => {
        const { rows } = await dbQuery(`
          SELECT
            COALESCE(SUM(amount) FILTER (WHERE status='success'), 0)                                    AS total_revenue,
            COALESCE(SUM(amount) FILTER (WHERE status='success' AND created_at > NOW()-INTERVAL '30 days'), 0) AS revenue_30d,
            COALESCE(SUM(amount) FILTER (WHERE status='success' AND created_at > NOW()-INTERVAL '7 days'), 0)  AS revenue_7d,
            COUNT(*) FILTER (WHERE status='success')  AS successful_transactions,
            COUNT(*) FILTER (WHERE status='failed')   AS failed_transactions,
            COUNT(*) FILTER (WHERE status='pending')  AS pending_transactions
          FROM payment_transactions
        `);
        return rows[0];
      });
      await safe('pricing_plans', async () => {
        const { rows } = await dbQuery(`SELECT id, name, price, billing_period, is_active, is_on_sale, discount_percentage FROM pricing_plans ORDER BY price ASC`);
        return rows;
      });
    }
    if (agentKey === 'coo') {
      await safe('recent_payments', async () => {
        const { rows } = await dbQuery(`SELECT id, amount, currency, status, customer_email, created_at FROM payment_transactions ORDER BY created_at DESC LIMIT 10`);
        return rows;
      });
      await safe('social_connections', async () => {
        const { rows } = await dbQuery(`SELECT platform, COUNT(*) AS total, COUNT(*) FILTER (WHERE connected) AS connected FROM social_accounts GROUP BY platform ORDER BY total DESC`);
        return rows;
      });
    }
    if (agentKey === 'cto') {
      await safe('integrations', async () => {
        const { rows } = await dbQuery(`SELECT platform, enabled, updated_at FROM platform_configs ORDER BY platform`);
        return rows;
      });
      await safe('social_connections', async () => {
        const { rows } = await dbQuery(`SELECT platform, COUNT(*) AS total, COUNT(*) FILTER (WHERE connected) AS connected FROM social_accounts GROUP BY platform ORDER BY total DESC`);
        return rows;
      });
    }
    if (agentKey === 'cco') {
      await safe('card_templates', async () => {
        const { rows } = await dbQuery(`SELECT id, name, is_published, created_at FROM card_templates ORDER BY created_at DESC LIMIT 20`);
        return rows;
      });
      await safe('user_designs', async () => {
        const { rows } = await dbQuery(`SELECT COUNT(*) AS total FROM user_designs`);
        return rows[0];
      });
    }
    return data;
  }

  function buildActionsPrompt(agentKey: string, autonomyConfig: Record<string, any>): string {
    const lines: string[] = [
      '- **create_notification**: Alert the admin team. Payload: { "title": string, "body": string, "severity": "info"|"warning"|"critical" }',
    ];
    if ((agentKey === 'ceo' || agentKey === 'cro') && autonomyConfig.can_change_pricing) {
      const pct = autonomyConfig.pricing_range_pct ?? 15;
      lines.push(`- **update_pricing_plan**: Adjust a plan price (max ±${pct}% from current). Payload: { "plan_id": string, "current_price": number, "new_price": number }`);
    }
    if (agentKey === 'coo' && autonomyConfig.can_suspend_accounts) {
      lines.push('- **suspend_user**: Suspend a violating user. Payload: { "user_id": string, "reason": string }');
    }
    if (agentKey === 'cco' && autonomyConfig.can_manage_templates) {
      lines.push('- **feature_template**: Publish or unpublish a template. Payload: { "template_id": string, "publish": boolean }');
    }
    if (agentKey === 'cto' && autonomyConfig.can_disable_integrations) {
      lines.push('- **disable_integration**: Disable a malfunctioning integration. Payload: { "platform": string }');
    }
    return lines.join('\n');
  }

  async function executeAgentDecision(
    agentKey: string,
    decision: { action_type: string; payload: Record<string, any>; reasoning: string; severity: string },
    autonomyConfig: Record<string, any>,
  ): Promise<void> {
    const { action_type, payload } = decision;
    switch (action_type) {
      case 'create_notification': {
        await dbQuery(
          `INSERT INTO admin_notifications (agent_key, title, body, severity) VALUES ($1, $2, $3, $4)`,
          [agentKey, String(payload.title ?? 'Agent Notification'), String(payload.body ?? ''), String(payload.severity ?? 'info')],
        );
        break;
      }
      case 'update_pricing_plan': {
        if (!autonomyConfig.can_change_pricing) throw new Error('Not authorized for pricing changes');
        const maxPct = Number(autonomyConfig.pricing_range_pct ?? 15);
        const planRes = await dbQuery(`SELECT price FROM pricing_plans WHERE id = $1`, [payload.plan_id]);
        if (!planRes.rows.length) throw new Error(`Plan ${payload.plan_id} not found`);
        const current = parseFloat(planRes.rows[0].price);
        const newPrice = parseFloat(payload.new_price);
        if (isNaN(newPrice) || newPrice <= 0) throw new Error('Invalid price value');
        const changePct = Math.abs((newPrice - current) / current * 100);
        if (changePct > maxPct) throw new Error(`±${changePct.toFixed(1)}% exceeds authorized limit of ±${maxPct}%`);
        await dbQuery(`UPDATE pricing_plans SET price = $1, updated_at = NOW() WHERE id = $2`, [newPrice, payload.plan_id]);
        break;
      }
      case 'suspend_user': {
        if (!autonomyConfig.can_suspend_accounts) throw new Error('Not authorized for user suspension');
        if (!payload.user_id) throw new Error('user_id required');
        await dbQuery(`UPDATE users SET status = 'suspended' WHERE id = $1 AND role = 'user'`, [payload.user_id]);
        break;
      }
      case 'feature_template': {
        if (!autonomyConfig.can_manage_templates) throw new Error('Not authorized for template management');
        if (!payload.template_id) throw new Error('template_id required');
        await dbQuery(`UPDATE card_templates SET is_published = $1, updated_at = NOW() WHERE id = $2`, [payload.publish !== false, payload.template_id]);
        break;
      }
      case 'disable_integration': {
        if (!autonomyConfig.can_disable_integrations) throw new Error('Not authorized to disable integrations');
        if (!payload.platform) throw new Error('platform required');
        await dbQuery(`UPDATE platform_configs SET enabled = false, updated_at = NOW() WHERE platform = $1`, [payload.platform]);
        break;
      }
      default:
        throw new Error(`Unknown action type: ${action_type}`);
    }
  }

  async function gatherUserContext(userId: string, agentKey: string): Promise<Record<string, any>> {
    const ctx: Record<string, any> = { gathered_at: new Date().toUTCString() };
    if (!pool) return ctx;
    const safe = async (label: string, fn: () => Promise<any>) => {
      try { ctx[label] = await fn(); } catch (_err) { /* skip on error */ }
    };
    await safe('brand', async () => {
      const { rows } = await dbQuery(`SELECT brand_name, niche, tone, audience, goals, platforms, website, extra_notes FROM brand_profiles WHERE user_id = $1`, [userId]);
      return rows[0] ?? null;
    });
    await safe('memories', async () => {
      const { rows } = await dbQuery(
        `SELECT category, title, content FROM user_memories WHERE user_id = $1 AND category IN ('brand','audience','content','visual','business') ORDER BY category, sort_order LIMIT 20`,
        [userId],
      );
      return rows.reduce((acc: Record<string, string[]>, r: any) => {
        if (!acc[r.category]) acc[r.category] = [];
        acc[r.category].push(`${r.title}: ${r.content}`);
        return acc;
      }, {});
    });
    await safe('agent_memory', async () => {
      const { rows } = await dbQuery(
        `SELECT key, value FROM user_agent_memory WHERE user_id = $1 AND (agent_key = $2 OR agent_key = 'global') ORDER BY created_at DESC LIMIT 15`,
        [userId, agentKey],
      );
      return rows.map((r: any) => `${r.key}: ${r.value}`);
    });
    await safe('social_accounts', async () => {
      const { rows } = await dbQuery(
        `SELECT platform, account_name, handle, followers, connected FROM social_accounts WHERE user_id = $1 AND connected = true ORDER BY platform`,
        [userId],
      );
      return rows;
    });
    await safe('design_count', async () => {
      const { rows } = await dbQuery(`SELECT COUNT(*)::int AS total FROM user_designs WHERE user_id = $1`, [userId]);
      return rows[0]?.total ?? 0;
    });
    if (agentKey === 'nova' || agentKey === 'daky') {
      await safe('recent_designs', async () => {
        const { rows } = await dbQuery(`SELECT name, created_at FROM user_designs WHERE user_id = $1 ORDER BY created_at DESC LIMIT 5`, [userId]);
        return rows.map((r: any) => r.name);
      });
    }
    if (agentKey === 'flux') {
      await safe('active_workflows', async () => {
        const { rows } = await dbQuery(`SELECT name, description, is_active FROM agent_workflows WHERE agent_key = $1 AND is_active = true LIMIT 5`, [agentKey]);
        return rows;
      });
    }
    await safe('past_decisions', async () => {
      const { rows } = await dbQuery(
        `SELECT agent_key, task_type, title, status FROM user_agent_tasks WHERE user_id = $1 AND status IN ('approved','rejected') ORDER BY decided_at DESC LIMIT 8`,
        [userId],
      );
      return rows;
    });
    return ctx;
  }

  function buildUserAgentOutputSpec(extraInstruction?: string): string {
    return `Respond ONLY with valid JSON — no markdown, no extra text:
{
  "proposals": [
    {
      "task_type": "content_post|strategy_proposal|analysis_report|visual_concept|workflow_setup",
      "title": "Short action title (max 80 characters)",
      "body": "What this is and why you recommend it (max 350 characters)",
      "payload": { "key_detail": "value" }
    }
  ]
}

Generate 2-3 highly specific, immediately actionable proposals.${extraInstruction ? '\n' + extraInstruction : ''}
If the user has no brand profile, return 1 proposal suggesting they complete their brand setup.`;
  }

  async function callAgentAndParse(
    userId: string,
    agentKey: string,
    apiKey: string,
    extraContext?: Record<string, any>,
    extraInstruction?: string,
  ): Promise<any[]> {
    const ctx = await gatherUserContext(userId, agentKey);
    const merged = extraContext ? { ...ctx, ...extraContext } : ctx;
    const { rows: tmplRows } = await dbQuery(
      `SELECT base_prompt FROM agent_templates WHERE agent_key = $1`, [agentKey],
    ).catch(() => ({ rows: [] as any[] }));
    const baseSystemPrompt = tmplRows[0]?.base_prompt
      ? `${tmplRows[0].base_prompt}\n\n${USER_AGENT_PROMPTS[agentKey] ?? ''}`
      : USER_AGENT_PROMPTS[agentKey] ?? '';
    const customInstr = (merged.agent_memory as string[] | undefined)
      ?.find((m) => m.startsWith('custom_instructions:'));
    const systemPrompt = customInstr
      ? `${baseSystemPrompt}\n\nUSER'S STANDING INSTRUCTIONS FOR YOU:\n${customInstr.replace(/^custom_instructions:\s*/, '').trim()}`
      : baseSystemPrompt;
    const model = USER_AGENT_MODELS[agentKey] ?? FAST_MODEL;
    const userMessage = `User context:\n\n${JSON.stringify(merged, null, 2)}\n\n${buildUserAgentOutputSpec(extraInstruction)}`;
    const client = new Anthropic({ apiKey });

    // Structured outputs guarantee valid JSON — no regex extraction needed.
    // Falls back to the legacy free-text + regex path if the request fails
    // (e.g. an older model without structured-output support configured).
    const proposalsSchema = {
      type: 'object' as const,
      additionalProperties: false,
      required: ['proposals'],
      properties: {
        proposals: {
          type: 'array',
          items: {
            type: 'object',
            additionalProperties: false,
            required: ['task_type', 'title', 'body'],
            properties: {
              task_type: { type: 'string' },
              title: { type: 'string' },
              body: { type: 'string' },
              payload: { type: 'string', description: 'JSON-encoded object with key details for this proposal' },
            },
          },
        },
      },
    };

    let rawText = '';
    let proposals: any[] = [];
    try {
      const aiRes = await client.messages.create({
        model, max_tokens: 1200,
        system: systemPrompt,
        output_config: { format: { type: 'json_schema', schema: proposalsSchema } },
        messages: [{ role: 'user', content: userMessage }],
      } as any);
      void recordAIUsage({
        userId, feature: `agent_${agentKey}`, provider: 'anthropic', model,
        inputTokens: aiRes.usage.input_tokens, outputTokens: aiRes.usage.output_tokens,
        cacheReadTokens: aiRes.usage.cache_read_input_tokens ?? 0,
      });
      rawText = aiRes.content[0]?.type === 'text' ? aiRes.content[0].text : '';
      const j = JSON.parse(rawText);
      if (Array.isArray(j.proposals)) {
        proposals = j.proposals.map((p: any) => {
          if (typeof p.payload === 'string') {
            try { p.payload = JSON.parse(p.payload); } catch { p.payload = {}; }
          }
          return p;
        });
      }
    } catch (_structuredErr) {
      // Legacy free-text path
      const aiRes = await client.messages.create({
        model, max_tokens: 800,
        system: systemPrompt,
        messages: [{ role: 'user', content: userMessage }],
      });
      void recordAIUsage({
        userId, feature: `agent_${agentKey}`, provider: 'anthropic', model,
        inputTokens: aiRes.usage.input_tokens, outputTokens: aiRes.usage.output_tokens,
      });
      rawText = aiRes.content[0]?.type === 'text' ? aiRes.content[0].text : '';
      try {
        const block = rawText.match(/```(?:json)?\s*([\s\S]*?)```/);
        const candidate = block ? block[1] : rawText;
        const match = candidate.match(/\{[\s\S]*\}/);
        if (match) {
          const j = JSON.parse(match[0]);
          if (Array.isArray(j.proposals)) proposals = j.proposals;
        }
      } catch (_err) { /* ignore */ }
    }
    if (proposals.length === 0) {
      proposals = [{ task_type: 'strategy_proposal', title: `${AGENT_NAMES[agentKey] ?? agentKey} — Check in`, body: rawText.slice(0, 350), payload: {} }];
    }
    return proposals;
  }

  async function insertProposals(userId: string, agentKey: string, proposals: any[]): Promise<number> {
    let created = 0;
    for (const p of proposals.slice(0, 3)) {
      if (!p?.title) continue;
      await dbQuery(
        `INSERT INTO user_agent_tasks (user_id, agent_key, task_type, title, body, payload) VALUES ($1,$2,$3,$4,$5,$6)`,
        [userId, agentKey, p.task_type ?? 'proposal', String(p.title).slice(0, 80), String(p.body ?? '').slice(0, 400), JSON.stringify(p.payload ?? {})],
      ).catch(() => {});
      created++;
    }
    return created;
  }

  async function notifyProposals(userId: string, agentKey: string, count: number): Promise<void> {
    if (count === 0) return;
    const name = AGENT_NAMES[agentKey] ?? agentKey;
    await dbQuery(
      `INSERT INTO notifications (user_id, type, title, message, data) VALUES ($1,'agent_proposal',$2,$3,$4)`,
      [userId,
       `${name} has ${count} new proposal${count !== 1 ? 's' : ''} for you`,
       `${count} proposal${count !== 1 ? 's' : ''} waiting in your AI Team approval queue`,
       JSON.stringify({ agent_key: agentKey, count, link: '/ai-team' })],
    ).catch(() => {});
  }

  function _addPlaceholders(prompt: string): string {
    if (prompt.includes('[') && prompt.includes(']')) return prompt;
    return `[YOUR BUSINESS NAME] ${prompt.replace(/\b(professional|modern|minimalist|elegant|bold)\b/gi, '[STYLE]').trim()}`.trim()
      || `[STYLE] design for [YOUR BUSINESS] targeting [YOUR AUDIENCE]`;
  }

  function _extractJsonFromText(text: string): Record<string, any> | null {
    try {
      const codeBlock = text.match(/```(?:json)?\s*([\s\S]*?)```/);
      const candidate = codeBlock ? codeBlock[1] : text;
      const jsonMatch = candidate.match(/\{[\s\S]*\}/);
      if (jsonMatch) return JSON.parse(jsonMatch[0]);
    } catch (_err) { /* ignore */ }
    return null;
  }

  async function runScheduledAgents(): Promise<void> {
    if (!pool) return;
    try {
      const now = new Date();
      const currentHour = now.getUTCHours();
      const currentDay  = now.getUTCDay();
      const { rows } = await dbQuery(
        `SELECT * FROM user_agent_schedules
         WHERE enabled = true AND frequency != 'off'
         AND (
           (frequency = 'daily' AND run_hour = $1
            AND (last_scheduled_run_at IS NULL OR last_scheduled_run_at < NOW() - INTERVAL '23 hours'))
           OR
           (frequency = 'weekly' AND run_hour = $1 AND run_day = $2
            AND (last_scheduled_run_at IS NULL OR last_scheduled_run_at < NOW() - INTERVAL '6 days'))
         )`,
        [currentHour, currentDay],
      );
      const { encryptedKey } = await getAIConfig().catch(() => ({ encryptedKey: null as string | null }));
      const apiKey = (encryptedKey ? decryptAIKey(encryptedKey) : null) || process.env.ANTHROPIC_API_KEY || '';
      if (!apiKey) return;
      for (const sched of rows as any[]) {
        try {
          // Skip users with an empty credit balance, but still advance the
          // schedule so we don't retry them every hourly tick.
          if (!(await hasAICredits(sched.user_id))) {
            await dbQuery(`UPDATE user_agent_schedules SET last_scheduled_run_at = NOW(), updated_at = NOW() WHERE id = $1`, [sched.id]);
            continue;
          }
          const proposals = await callAgentAndParse(sched.user_id, sched.agent_key, apiKey);
          const created   = await insertProposals(sched.user_id, sched.agent_key, proposals);
          await notifyProposals(sched.user_id, sched.agent_key, created);
          await dbQuery(`UPDATE user_agent_schedules SET last_scheduled_run_at = NOW(), updated_at = NOW() WHERE id = $1`, [sched.id]);
        } catch (_err) { /* skip failing agent */ }
      }
    } catch (_err) { /* non-fatal */ }
  }

  const router = Router();

  // ── Admin Agent Tools & Workflows ─────────────────────────────────────────────

  router.get('/admin/agent-tools', async (req: Request, res: Response) => {
    if (!hasDatabase()) return res.status(503).json({ success: false, error: 'Database not configured' });
    try {
      const auth = await requireAdmin(req, res);
      if (!auth) return;
      const { rows } = await dbQuery(`SELECT * FROM agent_tools ORDER BY type, name`);
      return res.json({ success: true, tools: rows });
    } catch (e: any) { return res.status(500).json({ success: false, error: e.message }); }
  });

  router.get('/admin/agent-workflows/:key', async (req: Request, res: Response) => {
    if (!hasDatabase()) return res.status(503).json({ success: false, error: 'Database not configured' });
    try {
      const auth = await requireAdmin(req, res);
      if (!auth) return;
      const { rows } = await dbQuery(`SELECT * FROM agent_workflows WHERE agent_key = $1 ORDER BY updated_at ASC`, [req.params.key]);
      return res.json({ success: true, workflows: rows });
    } catch (e: any) { return res.status(500).json({ success: false, error: e.message }); }
  });

  router.post('/admin/agent-workflows/:key', async (req: Request, res: Response) => {
    if (!hasDatabase()) return res.status(503).json({ success: false, error: 'Database not configured' });
    const { name, description = '', steps = [], is_active = true } = req.body as { name: string; description?: string; steps?: any[]; is_active?: boolean };
    if (!name?.trim()) return res.status(400).json({ success: false, error: 'name is required' });
    try {
      const auth = await requireAdmin(req, res);
      if (!auth) return;
      const { rows } = await dbQuery(
        `INSERT INTO agent_workflows (agent_key, name, description, steps, is_active, updated_at)
         VALUES ($1, $2, $3, $4, $5, NOW())
         ON CONFLICT (agent_key, name) DO UPDATE SET description = $3, steps = $4, is_active = $5, updated_at = NOW()
         RETURNING *`,
        [req.params.key, name.trim(), description, JSON.stringify(steps), is_active],
      );
      return res.json({ success: true, workflow: rows[0] });
    } catch (e: any) { return res.status(500).json({ success: false, error: e.message }); }
  });

  router.put('/admin/agent-workflows/:key/:id', async (req: Request, res: Response) => {
    if (!hasDatabase()) return res.status(503).json({ success: false, error: 'Database not configured' });
    const { name, description, steps, is_active } = req.body as { name?: string; description?: string; steps?: any[]; is_active?: boolean };
    if (steps !== undefined && !Array.isArray(steps)) return res.status(400).json({ success: false, error: 'steps must be an array' });
    try {
      const auth = await requireAdmin(req, res);
      if (!auth) return;
      const setClauses: string[] = ['updated_at = NOW()'];
      const vals: any[] = [];
      let idx = 1;
      if (name !== undefined)        { setClauses.push(`name = $${idx++}`);        vals.push(name); }
      if (description !== undefined) { setClauses.push(`description = $${idx++}`); vals.push(description); }
      if (steps !== undefined)       { setClauses.push(`steps = $${idx++}`);       vals.push(JSON.stringify(steps)); }
      if (is_active !== undefined)   { setClauses.push(`is_active = $${idx++}`);   vals.push(is_active); }
      vals.push(req.params.id, req.params.key);
      const { rows } = await dbQuery(
        `UPDATE agent_workflows SET ${setClauses.join(', ')} WHERE id = $${idx++} AND agent_key = $${idx} RETURNING *`,
        vals,
      );
      if (rows.length === 0) return res.status(404).json({ success: false, error: 'Workflow not found' });
      return res.json({ success: true, workflow: rows[0] });
    } catch (e: any) { return res.status(500).json({ success: false, error: e.message }); }
  });

  router.delete('/admin/agent-workflows/:key/:id', async (req: Request, res: Response) => {
    if (!hasDatabase()) return res.status(503).json({ success: false, error: 'Database not configured' });
    try {
      const auth = await requireAdmin(req, res);
      if (!auth) return;
      await dbQuery(`DELETE FROM agent_workflows WHERE id = $1 AND agent_key = $2`, [req.params.id, req.params.key]);
      return res.json({ success: true });
    } catch (e: any) { return res.status(500).json({ success: false, error: e.message }); }
  });

  // ── Admin Platform Agents ──────────────────────────────────────────────────────

  router.get('/admin/platform-agents', async (req: Request, res: Response) => {
    const auth = await requireAdmin(req, res);
    if (!auth) return;
    if (!hasDatabase()) return res.status(503).json({ success: false, error: 'Database not configured' });
    try {
      const { rows } = await dbQuery(
        `SELECT * FROM admin_agents ORDER BY CASE tier WHEN 'strategic' THEN 1 WHEN 'operational' THEN 2 ELSE 3 END, created_at ASC`,
      );
      return res.json({ success: true, agents: rows });
    } catch (e: any) { return res.status(500).json({ success: false, error: e.message }); }
  });

  router.get('/admin/platform-agents/notifications', async (req: Request, res: Response) => {
    const auth = await requireAdmin(req, res);
    if (!auth) return;
    if (!hasDatabase()) return res.status(503).json({ success: false, error: 'Database not configured' });
    try {
      const { rows } = await dbQuery(`SELECT * FROM admin_notifications ORDER BY created_at DESC LIMIT 50`);
      return res.json({ success: true, notifications: rows });
    } catch (e: any) { return res.status(500).json({ success: false, error: e.message }); }
  });

  router.get('/admin/platform-agents/:key/runs', async (req: Request, res: Response) => {
    const auth = await requireAdmin(req, res);
    if (!auth) return;
    if (!hasDatabase()) return res.status(503).json({ success: false, error: 'Database not configured' });
    try {
      const { rows } = await dbQuery(`SELECT * FROM admin_agent_runs WHERE agent_key = $1 ORDER BY created_at DESC LIMIT 25`, [req.params.key]);
      return res.json({ success: true, runs: rows });
    } catch (e: any) { return res.status(500).json({ success: false, error: e.message }); }
  });

  router.put('/admin/platform-agents/:key', async (req: Request, res: Response) => {
    const auth = await requireAdmin(req, res);
    if (!auth) return;
    if (!hasDatabase()) return res.status(503).json({ success: false, error: 'Database not configured' });
    const { system_prompt, model, autonomy_config } = req.body as { system_prompt?: string; model?: string; autonomy_config?: Record<string, any> };
    try {
      const setClauses: string[] = ['updated_at = NOW()'];
      const vals: any[] = [];
      let idx = 1;
      if (system_prompt !== undefined)  { setClauses.push(`system_prompt = $${idx++}`);   vals.push(system_prompt); }
      if (model !== undefined)          { setClauses.push(`model = $${idx++}`);            vals.push(model); }
      if (autonomy_config !== undefined){ setClauses.push(`autonomy_config = $${idx++}`);  vals.push(JSON.stringify(autonomy_config)); }
      vals.push(req.params.key);
      const { rows } = await dbQuery(`UPDATE admin_agents SET ${setClauses.join(', ')} WHERE key = $${idx} RETURNING *`, vals);
      if (rows.length === 0) return res.status(404).json({ success: false, error: 'Agent not found' });
      return res.json({ success: true, agent: rows[0] });
    } catch (e: any) { return res.status(500).json({ success: false, error: e.message }); }
  });

  router.post('/admin/platform-agents/:key/run', async (req: Request, res: Response) => {
    const auth = await requireAdmin(req, res);
    if (!auth) return;
    if (!hasDatabase()) return res.status(503).json({ success: false, error: 'Database not configured' });
    const { key } = req.params;
    const trigger = (req.body?.trigger as string) || 'manual';
    try {
      const agentRes = await dbQuery(`SELECT * FROM admin_agents WHERE key = $1`, [key]);
      if (agentRes.rows.length === 0) return res.status(404).json({ success: false, error: 'Agent not found' });
      const agent = agentRes.rows[0];
      await dbQuery(`UPDATE admin_agents SET status = 'running' WHERE key = $1`, [key]);
      const { encryptedKey } = await getAIConfig();
      const apiKey = (encryptedKey ? decryptAIKey(encryptedKey) : null) || process.env.ANTHROPIC_API_KEY || '';
      if (!apiKey) {
        await dbQuery(`UPDATE admin_agents SET status = 'error' WHERE key = $1`, [key]);
        return res.status(503).json({ success: false, error: 'Anthropic API key not configured. Set it in Admin → AI Assistant → Configuration.' });
      }
      const snapshot = await gatherPlatformSnapshot(key);
      const actionsPrompt = buildActionsPrompt(key, agent.autonomy_config ?? {});
      const userMessage = `Analyze the current Dakyworld Hub platform state and take any autonomous actions within your authority.

## Live Platform Snapshot
\`\`\`json
${JSON.stringify(snapshot, null, 2)}
\`\`\`

## Available Autonomous Actions
${actionsPrompt}

## Response Format
Respond ONLY with a JSON object in this exact format (no extra text):
\`\`\`json
{
  "summary": "2-3 sentence executive summary of platform health and your key observations",
  "health_score": <integer 1-10>,
  "decisions": [
    {
      "action_type": "action_name",
      "reasoning": "specific, data-driven reason for this action",
      "payload": { ... },
      "severity": "low|medium|high|critical"
    }
  ]
}
\`\`\`

Only take actions when data clearly justifies them. If the platform is healthy, return an empty decisions array.`;

      const client = new Anthropic({ apiKey });
      const aiResponse = await client.messages.create({
        model: agent.model || 'claude-sonnet-4-6',
        max_tokens: 1500,
        system: agent.system_prompt,
        messages: [{ role: 'user', content: userMessage }],
      });
      const rawText = aiResponse.content[0]?.type === 'text' ? aiResponse.content[0].text : '';
      let parsed: { summary: string; health_score?: number; decisions: any[] } = { summary: rawText.slice(0, 600), decisions: [] };
      try {
        const block = rawText.match(/```(?:json)?\s*([\s\S]*?)```/);
        const candidate = block ? block[1] : rawText;
        const jsonMatch = candidate.match(/\{[\s\S]*\}/);
        if (jsonMatch) {
          const j = JSON.parse(jsonMatch[0]);
          parsed = {
            summary: String(j.summary ?? rawText.slice(0, 600)),
            health_score: typeof j.health_score === 'number' ? j.health_score : undefined,
            decisions: Array.isArray(j.decisions) ? j.decisions : [],
          };
        }
      } catch (_err) { /* use raw text as summary */ }
      let executedCount = 0;
      const decisionErrors: string[] = [];
      for (const decision of parsed.decisions) {
        if (!decision?.action_type) continue;
        let taskStatus: 'executed' | 'rejected' = 'rejected';
        let taskError = '';
        try {
          await executeAgentDecision(key, decision, agent.autonomy_config ?? {});
          taskStatus = 'executed';
          executedCount++;
        } catch (e: any) {
          taskError = e.message;
          decisionErrors.push(`${decision.action_type}: ${e.message}`);
        }
        await dbQuery(
          `INSERT INTO admin_agent_tasks (agent_key, action_type, payload, status, reasoning, severity) VALUES ($1, $2, $3, $4, $5, $6)`,
          [key, decision.action_type, JSON.stringify(decision.payload ?? {}), taskStatus,
           (decision.reasoning ?? '') + (taskError ? ` [error: ${taskError}]` : ''), decision.severity ?? 'low'],
        ).catch(() => {});
      }
      const healthTag = parsed.health_score != null ? ` [Health: ${parsed.health_score}/10]` : '';
      const actTag = executedCount > 0 ? ` — ${executedCount} action${executedCount !== 1 ? 's' : ''} executed.` : '';
      const errTag = decisionErrors.length > 0 ? ` Skipped: ${decisionErrors.join('; ')}.` : '';
      const fullSummary = `${parsed.summary}${healthTag}${actTag}${errTag}`.slice(0, 2000);
      const { rows: runRows } = await dbQuery(
        `INSERT INTO admin_agent_runs (agent_key, trigger, summary, decisions_made, status, metadata) VALUES ($1, $2, $3, $4, 'completed', $5) RETURNING *`,
        [key, trigger, fullSummary, executedCount, JSON.stringify({ health_score: parsed.health_score, errors: decisionErrors })],
      );
      await dbQuery(`UPDATE admin_agents SET status = 'idle', last_run_at = NOW() WHERE key = $1`, [key]);
      return res.json({ success: true, run: runRows[0] });
    } catch (e: any) {
      await dbQuery(`UPDATE admin_agents SET status = 'error' WHERE key = $1`, [key]).catch(() => {});
      return res.status(500).json({ success: false, error: e.message });
    }
  });

  // ── User Agent Foundation ───────────────────────────────────────────────────────

  router.get('/user/agent-templates', async (req: Request, res: Response) => {
    const auth = requireAuth(req, res);
    if (!auth) return;
    if (!hasDatabase()) return res.status(503).json({ success: false, error: 'Database unavailable' });
    try {
      const { rows } = await dbQuery(`SELECT agent_key, name, role, icon, color, base_prompt FROM agent_templates ORDER BY agent_key`, []);
      return res.json({ success: true, templates: rows });
    } catch (e: any) { return res.status(500).json({ success: false, error: e.message }); }
  });

  router.get('/user/brand-profile', async (req: Request, res: Response) => {
    const auth = requireAuth(req, res);
    if (!auth) return;
    if (!hasDatabase()) return res.status(503).json({ success: false, error: 'Database unavailable' });
    try {
      const { rows } = await dbQuery(`SELECT * FROM brand_profiles WHERE user_id = $1`, [auth.userId]);
      return res.json({ success: true, profile: rows[0] ?? null });
    } catch (e: any) { return res.status(500).json({ success: false, error: e.message }); }
  });

  router.put('/user/brand-profile', async (req: Request, res: Response) => {
    const auth = requireAuth(req, res);
    if (!auth) return;
    if (!hasDatabase()) return res.status(503).json({ success: false, error: 'Database unavailable' });
    const { brand_name = '', niche = '', tone = 'professional', audience = '', goals = [], platforms = [], website = '', extra_notes = '', setup_done = false } = req.body as Record<string, any>;
    try {
      const { rows } = await dbQuery(
        `INSERT INTO brand_profiles (user_id, brand_name, niche, tone, audience, goals, platforms, website, extra_notes, setup_done, updated_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,NOW())
         ON CONFLICT (user_id) DO UPDATE SET
           brand_name  = EXCLUDED.brand_name, niche       = EXCLUDED.niche,    tone        = EXCLUDED.tone,
           audience    = EXCLUDED.audience,   goals       = EXCLUDED.goals,    platforms   = EXCLUDED.platforms,
           website     = EXCLUDED.website,    extra_notes = EXCLUDED.extra_notes, setup_done = EXCLUDED.setup_done, updated_at = NOW()
         RETURNING *`,
        [auth.userId, brand_name, niche, tone, audience,
         Array.isArray(goals) ? goals : [], Array.isArray(platforms) ? platforms : [],
         website, extra_notes, Boolean(setup_done)],
      );
      return res.json({ success: true, profile: rows[0] });
    } catch (e: any) { return res.status(500).json({ success: false, error: e.message }); }
  });

  router.get('/user/agent-memory', async (req: Request, res: Response) => {
    const auth = requireAuth(req, res);
    if (!auth) return;
    if (!hasDatabase()) return res.status(503).json({ success: false, error: 'Database unavailable' });
    try {
      const { rows } = await dbQuery(`SELECT * FROM user_agent_memory WHERE user_id = $1 ORDER BY agent_key, created_at DESC`, [auth.userId]);
      return res.json({ success: true, memories: rows });
    } catch (e: any) { return res.status(500).json({ success: false, error: e.message }); }
  });

  router.post('/user/agent-memory', async (req: Request, res: Response) => {
    const auth = requireAuth(req, res);
    if (!auth) return;
    if (!hasDatabase()) return res.status(503).json({ success: false, error: 'Database unavailable' });
    const { agent_key = 'global', mem_type = 'general', key, value } = req.body as Record<string, any>;
    if (!key || !value) return res.status(400).json({ success: false, error: 'key and value required' });
    try {
      const { rows } = await dbQuery(
        `INSERT INTO user_agent_memory (user_id, agent_key, mem_type, key, value) VALUES ($1,$2,$3,$4,$5)
         ON CONFLICT (user_id, agent_key, key) DO UPDATE SET value = EXCLUDED.value, mem_type = EXCLUDED.mem_type RETURNING *`,
        [auth.userId, agent_key, mem_type, key, value],
      );
      return res.json({ success: true, memory: rows[0] });
    } catch (e: any) { return res.status(500).json({ success: false, error: e.message }); }
  });

  router.delete('/user/agent-memory/:id', async (req: Request, res: Response) => {
    const auth = requireAuth(req, res);
    if (!auth) return;
    if (!hasDatabase()) return res.status(503).json({ success: false, error: 'Database unavailable' });
    try {
      await dbQuery(`DELETE FROM user_agent_memory WHERE id = $1 AND user_id = $2`, [req.params.id, auth.userId]);
      return res.json({ success: true });
    } catch (e: any) { return res.status(500).json({ success: false, error: e.message }); }
  });

  router.get('/user/agent-drafts', async (req: Request, res: Response) => {
    const auth = requireAuth(req, res);
    if (!auth) return;
    if (!hasDatabase()) return res.status(503).json({ success: false, error: 'Database unavailable' });
    try {
      const { rows } = await dbQuery(`SELECT * FROM agent_drafts WHERE user_id=$1 ORDER BY created_at DESC LIMIT 30`, [auth.userId]);
      return res.json({ success: true, drafts: rows });
    } catch (e: any) { return res.status(500).json({ success: false, error: e.message }); }
  });

  router.get('/user/agent-tasks', async (req: Request, res: Response) => {
    const auth = requireAuth(req, res);
    if (!auth) return;
    if (!hasDatabase()) return res.status(503).json({ success: false, error: 'Database unavailable' });
    try {
      await dbQuery(`UPDATE user_agent_tasks SET status='expired' WHERE user_id=$1 AND status='pending' AND expires_at < NOW()`, [auth.userId]).catch(() => {});
      const { rows } = await dbQuery(`SELECT * FROM user_agent_tasks WHERE user_id = $1 ORDER BY created_at DESC LIMIT 50`, [auth.userId]);
      return res.json({ success: true, tasks: rows });
    } catch (e: any) { return res.status(500).json({ success: false, error: e.message }); }
  });

  router.put('/user/agent-tasks/:id', async (req: Request, res: Response) => {
    const auth = requireAuth(req, res);
    if (!auth) return;
    if (!hasDatabase()) return res.status(503).json({ success: false, error: 'Database unavailable' });
    const { decision } = req.body as { decision: string };
    if (!['approved', 'rejected'].includes(decision)) return res.status(400).json({ success: false, error: "decision must be 'approved' or 'rejected'" });
    try {
      const { rows } = await dbQuery(
        `UPDATE user_agent_tasks SET status=$1, decided_at=NOW() WHERE id=$2 AND user_id=$3 AND status='pending' RETURNING *`,
        [decision, req.params.id, auth.userId],
      );
      if (!rows[0]) return res.status(404).json({ success: false, error: 'Task not found or already decided' });
      const task = rows[0];
      try {
        const { rows: history } = await dbQuery(
          `SELECT task_type, title, status FROM user_agent_tasks WHERE user_id=$1 AND agent_key=$2 AND status IN ('approved','rejected') ORDER BY decided_at DESC LIMIT 12`,
          [auth.userId, task.agent_key],
        );
        const approved = history.filter((r: any) => r.status === 'approved').map((r: any) => `${r.task_type}: "${String(r.title).slice(0, 50)}"`).join('; ');
        const rejected = history.filter((r: any) => r.status === 'rejected').map((r: any) => `${r.task_type}: "${String(r.title).slice(0, 50)}"`).join('; ');
        const summary = [
          approved && `USER APPROVED (${history.filter((r: any) => r.status === 'approved').length}): ${approved}`,
          rejected && `USER REJECTED (${history.filter((r: any) => r.status === 'rejected').length}): ${rejected}`,
        ].filter(Boolean).join(' | ');
        if (summary) {
          await dbQuery(
            `INSERT INTO user_agent_memory (user_id, agent_key, mem_type, key, value) VALUES ($1,$2,'preference','decision_history',$3)
             ON CONFLICT (user_id, agent_key, key) DO UPDATE SET value = EXCLUDED.value`,
            [auth.userId, task.agent_key, summary.slice(0, 1000)],
          );
        }
      } catch (_err) { /* non-fatal */ }
      let execution: Record<string, any> | null = null;
      if (decision === 'approved') {
        try {
          if (task.task_type === 'content_post') {
            const postId = randomUUID();
            const postSlug = slugify(task.title) || postId;
            await dbQuery(`INSERT INTO blog_posts (id,user_id,title,slug,content,status) VALUES ($1,$2,$3,$4,$5,'draft')`, [postId, auth.userId, task.title, postSlug, task.body || '']);
            const { rows: dr } = await dbQuery(
              `INSERT INTO agent_drafts (user_id,agent_key,task_id,task_type,title,content,payload,blog_post_id) VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING id`,
              [auth.userId, task.agent_key, task.id, task.task_type, task.title, task.body || '', JSON.stringify(task.payload || {}), postId],
            );
            execution = { type: 'blog_draft', draft_id: dr[0]?.id, blog_post_id: postId };
          } else {
            const { rows: dr } = await dbQuery(
              `INSERT INTO agent_drafts (user_id,agent_key,task_id,task_type,title,content,payload) VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING id`,
              [auth.userId, task.agent_key, task.id, task.task_type, task.title, task.body || '', JSON.stringify(task.payload || {})],
            );
            execution = { type: 'agent_draft', draft_id: dr[0]?.id };
          }
        } catch (_err) { /* non-fatal */ }
      }
      return res.json({ success: true, task, execution });
    } catch (e: any) { return res.status(500).json({ success: false, error: e.message }); }
  });

  router.post('/admin/agent-tasks', async (req: Request, res: Response) => {
    const adm = requireAdmin(req, res);
    if (!adm) return;
    if (!hasDatabase()) return res.status(503).json({ success: false, error: 'Database unavailable' });
    const { user_id, agent_key, task_type = 'proposal', title, body = '', payload = {}, expires_hours = 48 } = req.body as Record<string, any>;
    if (!user_id || !agent_key || !title) return res.status(400).json({ success: false, error: 'user_id, agent_key, title required' });
    try {
      const { rows } = await dbQuery(
        `INSERT INTO user_agent_tasks (user_id, agent_key, task_type, title, body, payload, expires_at) VALUES ($1,$2,$3,$4,$5,$6, NOW() + ($7 || ' hours')::interval) RETURNING *`,
        [user_id, agent_key, task_type, title, body, JSON.stringify(payload), String(Number(expires_hours) || 48)],
      );
      return res.json({ success: true, task: rows[0] });
    } catch (e: any) { return res.status(500).json({ success: false, error: e.message }); }
  });

  // ── User Agent Run ────────────────────────────────────────────────────────────

  router.post('/user/agents/:key/run', async (req: Request, res: Response) => {
    const auth = requireAuth(req, res);
    if (!auth) return;
    if (!hasDatabase()) return res.status(503).json({ success: false, error: 'Database unavailable' });
    const { key } = req.params;
    if (!AGENT_DEFS[key]) return res.status(400).json({ success: false, error: 'Unknown agent key' });
    try {
      const { rows: cd } = await dbQuery(`SELECT value FROM user_agent_memory WHERE user_id=$1 AND agent_key=$2 AND key='meta:last_run_at'`, [auth.userId, key]);
      if (cd[0]) {
        const elapsed = Date.now() - new Date(cd[0].value).getTime();
        if (elapsed < 10 * 60 * 1000) {
          const mins = Math.ceil((10 * 60 * 1000 - elapsed) / 60000);
          return res.status(429).json({ success: false, error: `Agent ${key} was just run. Try again in ${mins} minute${mins !== 1 ? 's' : ''}.` });
        }
      }
    } catch (_err) { /* proceed */ }
    if (!(await hasAICredits(auth.userId))) {
      return res.status(402).json({ success: false, error: "You're out of AI credits for this month. Upgrade your plan or wait for your monthly reset." });
    }
    try {
      const { encryptedKey } = await getAIConfig();
      const apiKey = (encryptedKey ? decryptAIKey(encryptedKey) : null) || process.env.ANTHROPIC_API_KEY || '';
      if (!apiKey) return res.status(503).json({ success: false, error: 'Anthropic API key not configured' });
      const proposals = await callAgentAndParse(auth.userId, key, apiKey);
      const created = await insertProposals(auth.userId, key, proposals);
      await notifyProposals(auth.userId, key, created);
      await dbQuery(
        `INSERT INTO user_agent_memory (user_id, agent_key, mem_type, key, value) VALUES ($1,$2,'meta','meta:last_run_at',$3)
         ON CONFLICT (user_id, agent_key, key) DO UPDATE SET value = EXCLUDED.value`,
        [auth.userId, key, new Date().toISOString()],
      ).catch(() => {});
      return res.json({ success: true, proposals_created: created, agent_key: key });
    } catch (e: any) { return res.status(500).json({ success: false, error: e.message }); }
  });

  router.get('/user/agents/status', async (req: Request, res: Response) => {
    const auth = requireAuth(req, res);
    if (!auth) return;
    if (!hasDatabase()) return res.status(503).json({ success: false, error: 'Database unavailable' });
    try {
      const { rows } = await dbQuery(`SELECT agent_key, value AS last_run_at FROM user_agent_memory WHERE user_id=$1 AND key='meta:last_run_at'`, [auth.userId]);
      const status: Record<string, string> = {};
      for (const r of rows as any[]) status[r.agent_key] = r.last_run_at;
      return res.json({ success: true, status });
    } catch (e: any) { return res.status(500).json({ success: false, error: e.message }); }
  });

  router.post('/user/agents/orchestrate', async (req: Request, res: Response) => {
    const auth = requireAuth(req, res);
    if (!auth) return;
    if (!hasDatabase()) return res.status(503).json({ success: false, error: 'Database unavailable' });
    try {
      const { encryptedKey } = await getAIConfig();
      const apiKey = (encryptedKey ? decryptAIKey(encryptedKey) : null) || process.env.ANTHROPIC_API_KEY || '';
      if (!apiKey) return res.status(503).json({ success: false, error: 'Anthropic API key not configured' });
      const createdByAgent: Record<string, number> = {};
      const sageProposals = await callAgentAndParse(auth.userId, 'sage', apiKey, {}, 'This is an orchestrated run. Generate a clear strategy framework that other agents (content writer, creative director) can execute on. Be explicit about themes, messaging angles, and audience priorities.');
      createdByAgent['sage'] = await insertProposals(auth.userId, 'sage', sageProposals);
      await notifyProposals(auth.userId, 'sage', createdByAgent['sage']);
      const strategyContext = { sage_strategy: sageProposals.slice(0, 3).map((p: any) => ({ type: p.task_type, title: p.title, brief: p.body })) };
      const dakyProposals = await callAgentAndParse(auth.userId, 'daky', apiKey, strategyContext, 'An orchestrated strategy from Sage is included in your context under "sage_strategy". Create content proposals that directly execute on those strategic themes. Reference the strategy by name when relevant.');
      createdByAgent['daky'] = await insertProposals(auth.userId, 'daky', dakyProposals);
      await notifyProposals(auth.userId, 'daky', createdByAgent['daky']);
      const contentContext = { ...strategyContext, daky_content: dakyProposals.slice(0, 3).map((p: any) => ({ type: p.task_type, title: p.title, theme: p.body })) };
      const novaProposals = await callAgentAndParse(auth.userId, 'nova', apiKey, contentContext, "Sage's strategy and Daky's content proposals are in your context. Create visual concepts that visually represent those content pieces — match the tone, platform, and message of each content proposal. Reference by title.");
      createdByAgent['nova'] = await insertProposals(auth.userId, 'nova', novaProposals);
      await notifyProposals(auth.userId, 'nova', createdByAgent['nova']);
      const [ariaProposals, fluxProposals] = await Promise.all([
        callAgentAndParse(auth.userId, 'aria', apiKey, strategyContext, 'This is part of an orchestrated campaign run. Identify performance metrics and tracking setup that will measure the success of the strategy in your context.'),
        callAgentAndParse(auth.userId, 'flux', apiKey, strategyContext, 'This is part of an orchestrated campaign run. Design automation workflows to efficiently distribute the content being created as part of this campaign.'),
      ]);
      createdByAgent['aria'] = await insertProposals(auth.userId, 'aria', ariaProposals);
      createdByAgent['flux'] = await insertProposals(auth.userId, 'flux', fluxProposals);
      await notifyProposals(auth.userId, 'aria', createdByAgent['aria']);
      await notifyProposals(auth.userId, 'flux', createdByAgent['flux']);
      const now = new Date().toISOString();
      for (const k of ['sage', 'daky', 'nova', 'aria', 'flux']) {
        await dbQuery(
          `INSERT INTO user_agent_memory (user_id, agent_key, mem_type, key, value) VALUES ($1,$2,'meta','meta:last_run_at',$3)
           ON CONFLICT (user_id, agent_key, key) DO UPDATE SET value = EXCLUDED.value`,
          [auth.userId, k, now],
        ).catch(() => {});
      }
      const total = Object.values(createdByAgent).reduce((a, b) => a + b, 0);
      await dbQuery(
        `INSERT INTO notifications (user_id, type, title, message, data) VALUES ($1,'orchestration',$2,$3,$4)`,
        [auth.userId, 'Your AI Team completed a full campaign orchestration', `${total} coordinated proposals created across strategy, content, visuals, analytics & automation`, JSON.stringify({ proposals_by_agent: createdByAgent, total, link: '/ai-team' })],
      ).catch(() => {});
      return res.json({ success: true, proposals_by_agent: createdByAgent, total });
    } catch (e: any) { return res.status(500).json({ success: false, error: e.message }); }
  });

  router.post('/user/agents/:key/chat', async (req: Request, res: Response) => {
    const auth = requireAuth(req, res);
    if (!auth) return;
    if (!hasDatabase()) return res.status(503).json({ success: false, error: 'Database unavailable' });
    const { key } = req.params;
    const validKeys = ['daky', 'nova', 'sage', 'aria', 'flux'];
    if (!validKeys.includes(key)) return res.status(400).json({ success: false, error: 'Unknown agent' });
    const { messages } = req.body as { messages: { role: string; content: string }[] };
    if (!Array.isArray(messages) || messages.length === 0) return res.status(400).json({ success: false, error: 'messages required' });
    try {
      const { encryptedKey } = await getAIConfig();
      const apiKey = (encryptedKey ? decryptAIKey(encryptedKey) : null) || process.env.ANTHROPIC_API_KEY || '';
      if (!apiKey) return res.status(503).json({ success: false, error: 'Anthropic API key not configured' });
      const ctx = await gatherUserContext(auth.userId, key);
      const systemPrompt = `${USER_AGENT_CHAT_PROMPTS[key] ?? ''}

Current user brand context:
${ctx.brand ? `Brand: ${ctx.brand.brand_name || 'N/A'}, Niche: ${ctx.brand.niche || 'N/A'}, Tone: ${ctx.brand.tone || 'N/A'}, Audience: ${ctx.brand.audience || 'N/A'}` : 'No brand profile set up yet.'}`;
      const client = new Anthropic({ apiKey });
      const aiRes = await client.messages.create({
        model: USER_AGENT_MODELS[key] ?? FAST_MODEL,
        max_tokens: 512,
        system: systemPrompt,
        messages: messages.map((m) => ({ role: (m.role === 'assistant' ? 'assistant' : 'user') as 'user' | 'assistant', content: String(m.content).slice(0, 2000) })),
      });
      const reply = aiRes.content[0]?.type === 'text' ? aiRes.content[0].text : '';
      return res.json({ success: true, reply });
    } catch (e: any) { return res.status(500).json({ success: false, error: e.message }); }
  });

  router.get('/user/agent-schedules', async (req: Request, res: Response) => {
    const auth = requireAuth(req, res);
    if (!auth) return;
    if (!hasDatabase()) return res.status(503).json({ success: false, error: 'Database unavailable' });
    try {
      const { rows } = await dbQuery(`SELECT * FROM user_agent_schedules WHERE user_id=$1 ORDER BY agent_key`, [auth.userId]);
      return res.json({ success: true, schedules: rows });
    } catch (e: any) { return res.status(500).json({ success: false, error: e.message }); }
  });

  router.put('/user/agent-schedules/:key', async (req: Request, res: Response) => {
    const auth = requireAuth(req, res);
    if (!auth) return;
    if (!hasDatabase()) return res.status(503).json({ success: false, error: 'Database unavailable' });
    const validKeys = ['daky', 'nova', 'sage', 'aria', 'flux'];
    if (!validKeys.includes(req.params.key)) return res.status(400).json({ success: false, error: 'Unknown agent' });
    const { frequency = 'off', run_hour = 9, run_day = 1, enabled = false } = req.body as Record<string, any>;
    try {
      const { rows } = await dbQuery(
        `INSERT INTO user_agent_schedules (user_id, agent_key, frequency, run_hour, run_day, enabled, updated_at)
         VALUES ($1,$2,$3,$4,$5,$6,NOW())
         ON CONFLICT (user_id, agent_key) DO UPDATE SET frequency=EXCLUDED.frequency, run_hour=EXCLUDED.run_hour, run_day=EXCLUDED.run_day, enabled=EXCLUDED.enabled, updated_at=NOW()
         RETURNING *`,
        [auth.userId, req.params.key, frequency, Number(run_hour), Number(run_day), Boolean(enabled)],
      );
      return res.json({ success: true, schedule: rows[0] });
    } catch (e: any) { return res.status(500).json({ success: false, error: e.message }); }
  });

  router.post('/user/brand-voice-extract', async (req: Request, res: Response) => {
    const auth = requireAuth(req, res);
    if (!auth) return;
    if (!hasDatabase()) return res.status(503).json({ success: false, error: 'Database unavailable' });
    const { samples } = req.body as { samples?: string };
    if (!samples || samples.trim().length < 20) return res.status(400).json({ success: false, error: 'Provide at least 20 characters of content samples' });
    try {
      const { encryptedKey } = await getAIConfig();
      const apiKey = (encryptedKey ? decryptAIKey(encryptedKey) : null) || process.env.ANTHROPIC_API_KEY || '';
      if (!apiKey) return res.status(503).json({ success: false, error: 'Anthropic API key not configured' });
      const client = new Anthropic({ apiKey });
      const aiRes = await client.messages.create({
        model: FAST_MODEL,
        max_tokens: 600,
        messages: [{ role: 'user', content: `Analyze these content samples and extract the brand voice. Reply ONLY with valid JSON, no markdown:\n{\n  "tone": "one sentence describing overall tone",\n  "vocabulary": "description of vocabulary style",\n  "personality": ["trait1", "trait2", "trait3"],\n  "do_list": ["writing habit they clearly have", "..."],\n  "dont_list": ["what they clearly avoid", "..."],\n  "one_liner": "one sentence that captures this brand's voice"\n}\n\nCONTENT SAMPLES:\n${samples.slice(0, 3000)}` }],
      });
      const raw = aiRes.content[0]?.type === 'text' ? aiRes.content[0].text : '';
      let voice: Record<string, any> = {};
      try {
        const match = raw.match(/\{[\s\S]*\}/);
        if (match) voice = JSON.parse(match[0]);
      } catch (_err) { voice = { one_liner: raw.slice(0, 200) }; }
      const summary = `Tone: ${voice.tone ?? ''}. Personality: ${(voice.personality ?? []).join(', ')}. Do: ${(voice.do_list ?? []).join('; ')}. Avoid: ${(voice.dont_list ?? []).join('; ')}.`;
      await dbQuery(
        `INSERT INTO user_agent_memory (user_id, agent_key, mem_type, key, value) VALUES ($1,'global','brand','brand_voice',$2)
         ON CONFLICT (user_id, agent_key, key) DO UPDATE SET value = EXCLUDED.value`,
        [auth.userId, summary.slice(0, 800)],
      ).catch(() => {});
      return res.json({ success: true, voice });
    } catch (e: any) { return res.status(500).json({ success: false, error: e.message }); }
  });

  // ── Nova Design Agent ────────────────────────────────────────────────────────

  router.post('/nova/design', async (req: Request, res: Response) => {
    const auth = requireAuth(req, res);
    if (!auth) return;
    if (!hasDatabase()) return res.status(503).json({ error: 'Database unavailable' });
    const { description = '', auto = true } = req.body as { description?: string; auto?: boolean };
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    const send = (data: object) => res.write(`data: ${JSON.stringify(data)}\n\n`);
    try {
      const { rows: memRows } = await dbQuery(
        `SELECT category, title, content FROM user_memories WHERE user_id = $1 AND category IN ('brand','visual','content','audience','business') ORDER BY category, sort_order LIMIT 30`,
        [auth.userId],
      );
      const hasBrandMemory = memRows.length > 0;
      const brandCtx: Record<string, string[]> = {};
      for (const r of memRows as any[]) {
        if (!brandCtx[r.category]) brandCtx[r.category] = [];
        brandCtx[r.category].push(`${r.title}: ${r.content}`);
      }
      const brandSummary = Object.entries(brandCtx).map(([cat, items]) => `${cat.toUpperCase()}:\n${items.join('\n')}`).join('\n\n');
      const brandNiche    = brandCtx.business?.[0] ?? brandCtx.brand?.[0]   ?? 'general business';
      const brandTone     = brandCtx.brand?.[1]    ?? brandCtx.content?.[0] ?? 'professional';
      const brandAudience = brandCtx.audience?.[0] ?? 'general audience';

      const { rows: wfRows } = await dbQuery(`SELECT steps FROM agent_workflows WHERE agent_key = 'nova' AND is_active = true LIMIT 1`);
      const steps: any[] = wfRows[0]?.steps ?? [];
      if (steps.length === 0) { send({ type: 'error', message: 'Nova workflow not configured. Set up the workflow in Admin → Agents.' }); send({ type: 'done' }); return res.end(); }

      const aiCfg = await getAIConfig();
      const apiKey = resolveActiveKey(aiCfg);
      if (!apiKey) { send({ type: 'error', message: 'AI not configured — add an API key in Admin → AI Assistant.' }); send({ type: 'done' }); return res.end(); }
      const anthropic = new Anthropic({ apiKey });
      const stepResults: Record<string, any> = {};

      for (const step of steps) {
        send({ type: 'step_start', step_id: step.id, name: step.name, tool: step.tool });
        try {
          if (step.tool === 'meigen_search') {
            const searchRes = await anthropic.messages.create({
              model: FAST_MODEL, max_tokens: 1500,
              messages: [{ role: 'user', content: `You are a design research AI. Generate 4 realistic design concepts as if retrieved from a design AI library.\n\nRequest: "${description || 'professional brand design'}"\nBrand niche: ${brandNiche}\n\nReturn ONLY valid JSON array (no markdown, no text outside the array):\n[\n  {\n    "title": "short descriptive name",\n    "style": "visual style description",\n    "colors": "main colors used",\n    "prompt": "detailed image generation prompt that would create this design",\n    "model": "one of: flux-2-turbo | flux-kontext-pro | seedream-v5-lite | mystic",\n    "thumbnail_description": "brief visual description for display"\n  }\n]` }],
            });
            let designs: any[] = [];
            const rawContent = searchRes.content[0].type === 'text' ? searchRes.content[0].text : '';
            try { const arrMatch = rawContent.match(/\[[\s\S]*\]/); if (arrMatch) designs = JSON.parse(arrMatch[0]); } catch (_err) { designs = []; }
            stepResults[step.id] = { designs };
            send({ type: 'step_done', step_id: step.id });
            send({ type: 'inspirations', designs });

          } else if (step.tool === 'claude_synthesize') {
            let prompt = step.prompt_template
              .replace('{input}', description || 'professional brand design')
              .replace('{brand.niche}', brandNiche).replace('{brand.tone}', brandTone).replace('{brand.audience}', brandAudience)
              .replace('{step_search.result}', JSON.stringify(stepResults['step_search']?.designs ?? []))
              .replace('{step_extract.result}', stepResults['step_extract']?.result ?? '');
            if (brandSummary) prompt += `\n\nUSER BRAND MEMORY:\n${brandSummary}`;
            const synthRes = await anthropic.messages.create({ model: FAST_MODEL, max_tokens: 1200, messages: [{ role: 'user', content: prompt }] });
            const result = synthRes.content[0].type === 'text' ? synthRes.content[0].text : '';
            stepResults[step.id] = { result };
            send({ type: 'step_done', step_id: step.id });

          } else if (step.tool === 'generate_image') {
            let finalPrompt = description || 'professional brand design';
            let finalModel = 'flux-2-turbo';
            const tailorResult = stepResults['step_tailor']?.result ?? '';
            const parsed = _extractJsonFromText(tailorResult);
            if (parsed?.prompt) { finalPrompt = parsed.prompt; finalModel = parsed.model ?? finalModel; }
            else if (tailorResult) { finalPrompt = tailorResult.slice(0, 900); }
            if (!MAGNIFIC_IMAGE_MODELS[finalModel]) finalModel = 'flux-2-turbo';
            if (!hasBrandMemory && !auto) {
              send({ type: 'prompt_ready', prompt: _addPlaceholders(finalPrompt), model: finalModel, has_memory: false, needs_input: true });
              send({ type: 'done' }); return res.end();
            }
            send({ type: 'prompt_ready', prompt: finalPrompt, model: finalModel, has_memory: hasBrandMemory, needs_input: false });
            const magnificApiKey = await getMagnificApiKey(pool);
            if (!magnificApiKey) { send({ type: 'error', message: 'Image generation not configured — set up Magnific in Admin.' }); send({ type: 'done' }); return res.end(); }
            send({ type: 'step_progress', step_id: step.id, message: `Submitting to Magnific…` });
            const genId = randomUUID();
            await dbQuery(`INSERT INTO magnific_generations (id, user_id, type, model, prompt, params, status) VALUES ($1, $2, 'image', $3, $4, $5, 'pending')`,
              [genId, auth.userId, finalModel, finalPrompt, JSON.stringify({ source: 'nova_workflow' })]).catch(() => undefined);
            let imageUrl: string | null = null;
            try {
              const genResult = await magnificGenerateImage(finalModel, finalPrompt, 'square_1_1', magnificApiKey, (status) => send({ type: 'step_progress', step_id: step.id, message: `Generation ${status}…` }));
              if (genResult.error) throw new Error(genResult.error);
              if (genResult.taskId) await dbQuery(`UPDATE magnific_generations SET task_id=$1, status='processing' WHERE id=$2`, [genResult.taskId, genId]).catch(() => undefined);
              imageUrl = genResult.url;
            } catch (e: any) {
              const errMsg = e?.message ?? 'Generation failed';
              await dbQuery(`UPDATE magnific_generations SET status='failed', error=$1 WHERE id=$2`, [errMsg, genId]).catch(() => undefined);
              send({ type: 'error', message: errMsg }); send({ type: 'done' }); return res.end();
            }
            await dbQuery(`UPDATE magnific_generations SET status='completed', result_url=$1, completed_at=NOW() WHERE id=$2`, [imageUrl, genId]).catch(() => undefined);
            stepResults[step.id] = { url: imageUrl, gen_id: genId, model: finalModel, prompt: finalPrompt };
            send({ type: 'step_done', step_id: step.id });
            send({ type: 'image_ready', url: imageUrl, model: finalModel, prompt: finalPrompt });

          } else if (step.tool === 'freepik_generate_image') {
            let freepikPrompt = description || 'professional brand design';
            let freepikModel = 'freepik-mystic';
            const freepikCreditCost = FREEPIK_IMAGE_MODELS[freepikModel]?.credits ?? 5;
            for (const k of Object.keys(stepResults)) {
              const r = stepResults[k]?.result ?? stepResults[k]?.prompt ?? '';
              if (r) { const p = _extractJsonFromText(r); if (p?.prompt) { freepikPrompt = p.prompt; if (p.model && FREEPIK_IMAGE_MODELS[p.model]) freepikModel = p.model; break; } }
            }
            const { rows: cRows } = await dbQuery(`SELECT credits FROM user_credits WHERE user_id = $1`, [auth.userId]).catch(() => ({ rows: [] as any[] }));
            const currentCredits = cRows[0]?.credits ?? 0;
            if (cRows.length > 0 && currentCredits < freepikCreditCost) { send({ type: 'error', message: `Insufficient credits (need ${freepikCreditCost}, have ${currentCredits}). Please upgrade your plan.` }); send({ type: 'done' }); return res.end(); }
            const freepikApiKey = await getFreepikApiKey(pool);
            if (!freepikApiKey) { send({ type: 'error', message: 'Freepik not configured — add FREEPIK_API_KEY in environment or Admin settings.' }); send({ type: 'done' }); return res.end(); }
            send({ type: 'prompt_ready', prompt: freepikPrompt, model: freepikModel, has_memory: hasBrandMemory, needs_input: false });
            send({ type: 'step_progress', step_id: step.id, message: 'Submitting to Freepik…' });
            const freepikResult = await freepikGenerateImage(freepikModel, freepikPrompt, 'square_1_1', freepikApiKey, (status) => send({ type: 'step_progress', step_id: step.id, message: `Freepik: ${status}…` }));
            if (freepikResult.error) { send({ type: 'error', message: freepikResult.error }); send({ type: 'done' }); return res.end(); }
            await chargeAICredits(auth.userId, freepikCreditCost, 'image_generate_freepik', { source: 'agent_workflow' });
            const freepikImageUrl = freepikResult.url!;
            stepResults[step.id] = { url: freepikImageUrl, model: freepikModel, prompt: freepikPrompt };
            send({ type: 'step_done', step_id: step.id });
            send({ type: 'image_ready', url: freepikImageUrl, model: freepikModel, prompt: freepikPrompt });

          } else if (step.tool === 'generate_video') {
            let videoPrompt = description || 'professional branded video';
            let videoModel = 'wan-2-7-t2v';
            for (const k of Object.keys(stepResults)) {
              const r = stepResults[k]?.result ?? '';
              if (r) { const p = _extractJsonFromText(r); if (p?.prompt) { videoPrompt = p.prompt; if (p.model && MAGNIFIC_VIDEO_MODELS[p.model]) videoModel = p.model; break; } }
            }
            const vidModelCfg = MAGNIFIC_VIDEO_MODELS[videoModel] ?? MAGNIFIC_VIDEO_MODELS['wan-2-7-t2v'];
            const vidCreditCost = vidModelCfg.credits;
            const { rows: vcRows } = await dbQuery(`SELECT credits FROM user_credits WHERE user_id = $1`, [auth.userId]).catch(() => ({ rows: [] as any[] }));
            const vcCredits = vcRows[0]?.credits ?? 0;
            if (vcRows.length > 0 && vcCredits < vidCreditCost) { send({ type: 'error', message: `Insufficient credits for video (need ${vidCreditCost}, have ${vcCredits}). Please upgrade your plan.` }); send({ type: 'done' }); return res.end(); }
            const vidApiKey = await getMagnificApiKey(pool);
            if (!vidApiKey) { send({ type: 'error', message: 'Video generation not configured — set up Magnific in Admin.' }); send({ type: 'done' }); return res.end(); }
            send({ type: 'step_progress', step_id: step.id, message: 'Submitting video to Magnific…' });
            const vidSubmit = await magnificPost(vidModelCfg.endpoint, { prompt: videoPrompt }, vidApiKey);
            if (vidSubmit.status >= 400) { send({ type: 'error', message: sanitizeMagnificError(vidSubmit.data?.message ?? `Magnific video error ${vidSubmit.status}`) }); send({ type: 'done' }); return res.end(); }
            const vidTaskId: string = vidSubmit.data?.data?.task_id ?? vidSubmit.data?.task_id ?? vidSubmit.data?.data?.id ?? vidSubmit.data?.id;
            if (!vidTaskId) { send({ type: 'error', message: 'No task_id returned from Magnific for video' }); send({ type: 'done' }); return res.end(); }
            await chargeAICredits(auth.userId, vidCreditCost, 'video_generate', { source: 'agent_workflow' });
            const vidPoll = await pollMagnificTask(vidModelCfg.pollPath(vidTaskId), vidApiKey, 300, (status) => send({ type: 'step_progress', step_id: step.id, message: `Video: ${status}…` }));
            if (vidPoll.error) { send({ type: 'error', message: vidPoll.error }); send({ type: 'done' }); return res.end(); }
            stepResults[step.id] = { url: vidPoll.url, model: videoModel, prompt: videoPrompt };
            send({ type: 'step_done', step_id: step.id });
            send({ type: 'video_ready', url: vidPoll.url, model: videoModel, prompt: videoPrompt });

          } else if (step.tool === 'draft_content' || step.tool === 'summarize_content') {
            let prompt = step.prompt_template
              .replace('{input}', description || '').replace('{brand.niche}', brandNiche)
              .replace('{brand.tone}', brandTone).replace('{brand.audience}', brandAudience);
            for (const k of Object.keys(stepResults)) {
              const r = stepResults[k]?.result ?? stepResults[k]?.url ?? '';
              prompt = prompt.replace(`{${k}.result}`, r);
            }
            if (brandSummary) prompt += `\n\nUSER BRAND MEMORY:\n${brandSummary}`;
            const draftRes = await anthropic.messages.create({ model: FAST_MODEL, max_tokens: 2000, messages: [{ role: 'user', content: prompt }] });
            const result = draftRes.content[0].type === 'text' ? draftRes.content[0].text : '';
            stepResults[step.id] = { result };
            send({ type: 'step_done', step_id: step.id });

          } else if (step.tool === 'save_design') {
            const genStep = Object.values(stepResults).reverse().find((r: any) => r?.url && typeof r.url === 'string' && r.url.startsWith('http'));
            const imageUrl = genStep?.url ?? null;
            if (imageUrl) {
              const dId = randomUUID();
              const dName = `AI Design — ${new Date().toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}`;
              await dbQuery(
                `INSERT INTO user_designs (id, user_id, name, canvas_width, canvas_height, canvas_data, thumbnail_url, updated_at) VALUES ($1, $2, $3, 1080, 1080, $4, $5, NOW())`,
                [dId, auth.userId, dName, JSON.stringify({ type: 'ai_image', imageUrl, prompt: genStep?.prompt ?? '', model: genStep?.model ?? '' }), imageUrl],
              ).catch(() => undefined);
              stepResults[step.id] = { design_id: dId, name: dName };
              send({ type: 'step_done', step_id: step.id });
              send({ type: 'saved', design_id: dId, name: dName });
            } else { send({ type: 'step_done', step_id: step.id }); }
          } else { send({ type: 'step_done', step_id: step.id }); }
        } catch (stepErr: any) { send({ type: 'step_done', step_id: step.id, error: stepErr.message }); }
      }
      send({ type: 'done' }); return res.end();
    } catch (err: any) { send({ type: 'error', message: err?.message ?? 'Workflow failed' }); send({ type: 'done' }); return res.end(); }
  });

  router.post('/nova/generate-video', async (req: Request, res: Response) => {
    const auth = requireAuth(req, res);
    if (!auth) return;
    if (!hasDatabase()) return res.status(503).json({ error: 'Database unavailable' });
    const { prompt = '', model = 'wan-2-7-t2v', aspect_ratio = '16:9' } = req.body as { prompt?: string; model?: string; aspect_ratio?: string };
    if (!prompt.trim()) return res.status(400).json({ error: 'Prompt is required' });
    const modelConfig = MAGNIFIC_VIDEO_MODELS[model] ?? MAGNIFIC_VIDEO_MODELS['wan-2-7-t2v'];
    const creditCost = modelConfig.credits;
    const credRow = await pool!.query<{ credits: number }>('SELECT credits FROM user_credits WHERE user_id = $1', [auth.userId]).catch(() => ({ rows: [] as { credits: number }[] }));
    const currentCredits = credRow.rows[0]?.credits ?? 0;
    if (currentCredits < creditCost) return res.status(402).json({ error: 'Insufficient credits', credits: currentCredits, required: creditCost });
    const apiKey = await getMagnificApiKey(pool);
    if (!apiKey) return res.status(400).json({ error: 'Video generation not configured — set up Magnific in Admin.' });
    const genId = randomUUID();
    await pool!.query(`INSERT INTO magnific_generations (id, user_id, type, model, prompt, params, status) VALUES ($1, $2, 'video', $3, $4, $5, 'pending')`,
      [genId, auth.userId, model, prompt.trim(), JSON.stringify({ aspect_ratio })]).catch(() => undefined);
    try {
      const submitResp = await magnificPost(modelConfig.endpoint, { prompt: prompt.trim() }, apiKey);
      if (submitResp.status >= 400) {
        const errMsg = sanitizeMagnificError(submitResp.data?.message ?? `Magnific API error ${submitResp.status}`);
        await pool!.query(`UPDATE magnific_generations SET status='failed', error=$1 WHERE id=$2`, [errMsg, genId]).catch(() => undefined);
        return res.status(400).json({ error: errMsg });
      }
      const taskId: string = submitResp.data?.data?.task_id ?? submitResp.data?.task_id ?? submitResp.data?.data?.id ?? submitResp.data?.id;
      if (!taskId) throw new Error('No task_id returned from Magnific');
      await pool!.query(`UPDATE magnific_generations SET task_id=$1, status='processing' WHERE id=$2`, [taskId, genId]).catch(() => undefined);
      await chargeAICredits(auth.userId, creditCost, 'video_generate', { gen_id: genId });
      const result = await pollMagnificTask(modelConfig.pollPath(taskId), apiKey, 300);
      if (result.error) throw new Error(result.error);
      const videoUrl = result.url!;
      await pool!.query(`UPDATE magnific_generations SET status='completed', result_url=$1, completed_at=NOW() WHERE id=$2`, [videoUrl, genId]).catch(() => undefined);
      const designId = randomUUID();
      const dName = `AI Video — ${new Date().toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}`;
      await pool!.query(
        `INSERT INTO user_designs (id, user_id, name, canvas_width, canvas_height, canvas_data, thumbnail_url, media_type, updated_at) VALUES ($1, $2, $3, 1080, 1920, $4, $5, 'video', NOW())`,
        [designId, auth.userId, dName, JSON.stringify({ type: 'ai_video', videoUrl, prompt: prompt.trim(), model }), videoUrl],
      ).catch(() => undefined);
      return res.json({ success: true, url: videoUrl, design_id: designId, gen_id: genId });
    } catch (e: any) {
      await pool!.query(`UPDATE magnific_generations SET status='failed', error=$1 WHERE id=$2`, [e.message, genId]).catch(() => undefined);
      return res.status(500).json({ error: e.message });
    }
  });

  router.post('/nova/generate-image', async (req: Request, res: Response) => {
    const auth = requireAuth(req, res);
    if (!auth) return;
    if (!hasDatabase()) return res.status(503).json({ error: 'Database unavailable' });
    const { prompt = '', model = 'flux-2-turbo', aspect_ratio = '1:1', save = true } = req.body as { prompt?: string; model?: string; aspect_ratio?: string; save?: boolean };
    if (!prompt.trim()) return res.status(400).json({ error: 'Prompt is required' });
    const isFreepikModel = !!FREEPIK_IMAGE_MODELS[model];
    const magnificCfg = !isFreepikModel ? (MAGNIFIC_IMAGE_MODELS[model] ?? MAGNIFIC_IMAGE_MODELS['flux-2-turbo']) : null;
    const creditCost = isFreepikModel ? FREEPIK_IMAGE_MODELS[model].credits : magnificCfg!.credits;
    const { rows: creditRows } = await dbQuery(`SELECT credits FROM user_credits WHERE user_id = $1`, [auth.userId]).catch(() => ({ rows: [] as any[] }));
    const currentCredits = creditRows[0]?.credits ?? 50;
    if (creditRows.length > 0 && currentCredits < creditCost) return res.status(402).json({ error: 'Insufficient credits' });
    const aspectStr = ASPECT_RATIO_MAP[aspect_ratio] ?? 'square_1_1';
    const genId = randomUUID();
    await dbQuery(`INSERT INTO magnific_generations (id, user_id, type, model, prompt, params, status) VALUES ($1, $2, 'image', $3, $4, $5, 'pending')`,
      [genId, auth.userId, model, prompt.trim(), JSON.stringify({ source: 'nova_manual', aspect_ratio })]).catch(() => undefined);
    try {
      let imageUrl: string | null = null;
      let actualCreditCost = creditCost;
      const replicateKey = await getReplicateApiKey();
      if (replicateKey) {
        const result = await replicateGenerateImage(model, prompt.trim(), aspectStr, replicateKey);
        if (!result.error) { imageUrl = result.url; }
        else {
          logger.info('[generate-image] Replicate failed:', result.error);
          if (result.error.includes('Invalid Replicate')) {
            await dbQuery(`UPDATE magnific_generations SET status='failed', error=$1 WHERE id=$2`, [result.error, genId]).catch(() => undefined);
            return res.status(400).json({ error: result.error });
          }
          logger.info('[generate-image] Replicate non-auth error, skipping Magnific, trying Freepik');
        }
      }
      if (!imageUrl && !isFreepikModel && !replicateKey) {
        const magnificKey = await getMagnificApiKey(pool);
        if (magnificKey) {
          const genResult = await magnificGenerateImage(model, prompt.trim(), aspectStr, magnificKey);
          if (!genResult.error) {
            imageUrl = genResult.url;
            if (genResult.taskId) await dbQuery(`UPDATE magnific_generations SET task_id=$1, status='processing' WHERE id=$2`, [genResult.taskId, genId]).catch(() => undefined);
          } else {
            const isBlocked = genResult.error.includes('403') || genResult.error.toLowerCase().includes('blocked') || genResult.error.toLowerCase().includes('access denied');
            if (!isBlocked) {
              await dbQuery(`UPDATE magnific_generations SET status='failed', error=$1 WHERE id=$2`, [genResult.error, genId]).catch(() => undefined);
              return res.status(400).json({ error: genResult.error });
            }
            logger.info('[generate-image] Magnific blocked, trying Freepik');
          }
        }
      }
      if (!imageUrl) {
        const freepikKey = await getFreepikApiKey(pool);
        if (!freepikKey && !replicateKey) {
          await dbQuery(`UPDATE magnific_generations SET status='failed', error='No API keys configured' WHERE id=$1`, [genId]).catch(() => undefined);
          return res.status(400).json({ error: 'Image generation not configured — add a Replicate API token in Admin → Magnific AI.' });
        }
        if (freepikKey) {
          const freepikModel = isFreepikModel ? model : 'freepik-mystic';
          actualCreditCost = FREEPIK_IMAGE_MODELS[freepikModel]?.credits ?? 5;
          const freepikResult = await freepikGenerateImage(freepikModel, prompt.trim(), aspectStr, freepikKey);
          if (freepikResult.error) {
            await dbQuery(`UPDATE magnific_generations SET status='failed', error=$1 WHERE id=$2`, [freepikResult.error, genId]).catch(() => undefined);
            return res.status(400).json({ error: freepikResult.error });
          }
          imageUrl = freepikResult.url;
        }
      }
      if (!imageUrl) {
        await dbQuery(`UPDATE magnific_generations SET status='failed', error='All providers failed' WHERE id=$1`, [genId]).catch(() => undefined);
        return res.status(400).json({ error: 'Image generation failed — all providers unavailable.' });
      }
      await dbQuery(`UPDATE magnific_generations SET status='completed', result_url=$1, completed_at=NOW() WHERE id=$2`, [imageUrl, genId]).catch(() => undefined);
      let designId: string | null = null;
      if (save && imageUrl) {
        designId = randomUUID();
        const dName = `AI Design — ${new Date().toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}`;
        await dbQuery(`INSERT INTO user_designs (id, user_id, name, canvas_width, canvas_height, canvas_data, thumbnail_url, updated_at) VALUES ($1, $2, $3, 1080, 1080, $4, $5, NOW())`,
          [designId, auth.userId, dName, JSON.stringify({ type: 'ai_image', imageUrl, prompt: prompt.trim(), model }), imageUrl]).catch(() => undefined);
      }
      await chargeAICredits(auth.userId, actualCreditCost, 'image_generate', { gen_id: genId, model });
      const deductResult = await dbQuery(`SELECT credits FROM user_credits WHERE user_id = $1`, [auth.userId]).catch(() => ({ rows: [] as any[] }));
      if (deductResult.rows.length === 0) {
        await dbQuery(
          `INSERT INTO user_credits (user_id, credits, reset_date, updated_at) VALUES ($1, GREATEST(0, 100 - $2), date_trunc('month', NOW()) + INTERVAL '1 month', NOW())
           ON CONFLICT (user_id) DO UPDATE SET credits = GREATEST(0, user_credits.credits - $2), updated_at = NOW()`,
          [auth.userId, actualCreditCost],
        ).catch((e) => logger.error('Credit deduction fallback failed:', e));
      }
      return res.json({ success: true, url: imageUrl, design_id: designId, gen_id: genId });
    } catch (e: any) {
      await dbQuery(`UPDATE magnific_generations SET status='failed', error=$1 WHERE id=$2`, [e.message, genId]).catch(() => undefined);
      return res.status(500).json({ error: e.message });
    }
  });

  router.get('/admin/replicate/config', async (req: Request, res: Response) => {
    const admin = await requireAdmin(req, res);
    if (!admin) return;
    if (!hasDatabase()) return res.status(503).json({ error: 'Database unavailable' });
    try {
      const envKey: string = process.env.REPLICATE_API_TOKEN ?? '';
      if (envKey) {
        const masked = envKey.length > 8 ? `${'*'.repeat(envKey.length - 4)}${envKey.slice(-4)}` : '****';
        return res.json({ success: true, hasKey: true, maskedKey: masked, source: 'env' });
      }
      const r = await pool!.query(`SELECT config FROM platform_configs WHERE platform='replicate' LIMIT 1`);
      const key: string = r.rows[0]?.config?.apiKey ?? '';
      const masked = key.length > 8 ? `${'*'.repeat(key.length - 4)}${key.slice(-4)}` : (key ? '****' : '');
      return res.json({ success: true, hasKey: !!key, maskedKey: masked, source: 'db' });
    } catch (e: any) { return res.status(500).json({ error: e.message }); }
  });

  router.put('/admin/replicate/config', async (req: Request, res: Response) => {
    const admin = await requireAdmin(req, res);
    if (!admin) return;
    if (!hasDatabase()) return res.status(503).json({ error: 'Database unavailable' });
    const { apiKey } = req.body as { apiKey?: string };
    if (!apiKey?.trim()) return res.status(400).json({ error: 'apiKey is required' });
    try {
      await pool!.query(
        `INSERT INTO platform_configs (platform, config, enabled, updated_at) VALUES ('replicate', $1, true, NOW())
         ON CONFLICT (platform) DO UPDATE SET config=$1, enabled=true, updated_at=NOW()`,
        [JSON.stringify({ apiKey: apiKey.trim() })],
      );
      return res.json({ success: true });
    } catch (e: any) { return res.status(500).json({ error: e.message }); }
  });

  router.get('/admin/replicate/test', async (req: Request, res: Response) => {
    const admin = await requireAdmin(req, res);
    if (!admin) return;
    const apiKey = await getReplicateApiKey();
    if (!apiKey) return res.status(400).json({ success: false, error: 'No Replicate API token configured' });
    try {
      const r = await axios.get(`${REPLICATE_BASE}/v1/models/black-forest-labs/flux-schnell`, { headers: { 'Authorization': `Token ${apiKey}` }, validateStatus: () => true, timeout: 10000 });
      if (r.status === 401) return res.json({ success: false, error: 'Invalid API token (401 Unauthorized)' });
      if (r.status >= 400) return res.json({ success: false, error: `Replicate returned HTTP ${r.status}` });
      return res.json({ success: true, model: r.data?.name ?? 'flux-schnell', note: 'Token is valid' });
    } catch (e: any) { return res.status(500).json({ success: false, error: e.message }); }
  });

  router.post('/admin/generations/:id/push-to-discover', async (req: Request, res: Response) => {
    const admin = await requireAdmin(req, res);
    if (!admin) return;
    if (!hasDatabase()) return res.status(503).json({ error: 'Database unavailable' });
    try {
      const { rows: genRows } = await pool!.query(`SELECT id FROM magnific_generations WHERE id=$1 AND status='completed' AND result_url IS NOT NULL`, [req.params.id]);
      if (!genRows.length) return res.status(404).json({ error: 'Generation not found or not completed' });
      const { rows } = await pool!.query(
        `INSERT INTO discover_feed (generation_id, pushed_by) VALUES ($1, $2)
         ON CONFLICT (generation_id) DO UPDATE SET visible=true, pushed_at=NOW(), pushed_by=$2 RETURNING id`,
        [req.params.id, admin.userId],
      );
      return res.json({ success: true, discover_id: rows[0].id });
    } catch (e: any) { return res.status(500).json({ error: e.message }); }
  });

  router.delete('/admin/discover/:id', async (req: Request, res: Response) => {
    const admin = await requireAdmin(req, res);
    if (!admin) return;
    if (!hasDatabase()) return res.status(503).json({ error: 'Database unavailable' });
    try {
      await pool!.query(`DELETE FROM discover_feed WHERE id=$1`, [req.params.id]);
      return res.json({ success: true });
    } catch (e: any) { return res.status(500).json({ error: e.message }); }
  });

  router.get('/discover', async (req: Request, res: Response) => {
    const auth = requireAuth(req, res);
    if (!auth) return;
    if (!hasDatabase()) return res.status(503).json({ error: 'Database unavailable' });
    try {
      const { rows } = await pool!.query(
        `SELECT df.id AS discover_id, df.pushed_at, mg.id AS generation_id, mg.prompt, mg.model,
                mg.result_url, mg.created_at, u.id AS creator_id, u.full_name AS creator_name,
                u.username AS creator_username, u.avatar_url AS creator_avatar
         FROM discover_feed df
         JOIN magnific_generations mg ON mg.id = df.generation_id
         LEFT JOIN users u ON u.id = mg.user_id
         WHERE df.visible = true ORDER BY df.pushed_at DESC LIMIT 100`,
      );
      return res.json({ success: true, items: rows });
    } catch (e: any) { return res.status(500).json({ error: e.message }); }
  });

  router.post('/nova/freepik-image', async (req: Request, res: Response) => {
    const auth = requireAuth(req, res);
    if (!auth) return;
    if (!hasDatabase()) return res.status(503).json({ error: 'Database unavailable' });
    const { prompt = '', model = 'freepik-mystic', aspect_ratio = '1:1', save = true } = req.body as { prompt?: string; model?: string; aspect_ratio?: string; save?: boolean };
    if (!prompt.trim()) return res.status(400).json({ error: 'Prompt is required' });
    const modelCfg = FREEPIK_IMAGE_MODELS[model] ?? FREEPIK_IMAGE_MODELS['freepik-mystic'];
    const creditCost = modelCfg.credits;
    const { rows: creditRows } = await dbQuery(`SELECT credits FROM user_credits WHERE user_id = $1`, [auth.userId]).catch(() => ({ rows: [] as any[] }));
    const currentCredits = creditRows[0]?.credits ?? 0;
    if (creditRows.length > 0 && currentCredits < creditCost) return res.status(402).json({ error: 'Insufficient credits', credits: currentCredits, required: creditCost });
    const apiKey = await getFreepikApiKey(pool);
    if (!apiKey) return res.status(400).json({ error: 'Freepik not configured — set FREEPIK_API_KEY in environment or Admin settings.' });
    try {
      const freepikAspect = ASPECT_RATIO_MAP[aspect_ratio] ?? 'square_1_1';
      const result = await freepikGenerateImage(model, prompt.trim(), freepikAspect, apiKey);
      if (result.error) return res.status(400).json({ error: result.error });
      const imageUrl = result.url!;
      await dbQuery(
        `INSERT INTO user_credits (user_id, credits, updated_at) VALUES ($1, GREATEST(0, 50 - $2), NOW())
         ON CONFLICT (user_id) DO UPDATE SET credits = GREATEST(0, user_credits.credits - $2), updated_at = NOW()`,
        [auth.userId, creditCost],
      ).catch(() => undefined);
      let designId: string | null = null;
      if (save && imageUrl) {
        designId = randomUUID();
        const dName = `Freepik Design — ${new Date().toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}`;
        await dbQuery(`INSERT INTO user_designs (id, user_id, name, canvas_width, canvas_height, canvas_data, thumbnail_url, updated_at) VALUES ($1, $2, $3, 1080, 1080, $4, $5, NOW())`,
          [designId, auth.userId, dName, JSON.stringify({ type: 'ai_image', imageUrl, prompt: prompt.trim(), model, provider: 'freepik' }), imageUrl]).catch(() => undefined);
      }
      return res.json({ success: true, url: imageUrl, design_id: designId, provider: 'freepik', credits_used: creditCost });
    } catch (e: any) { return res.status(500).json({ error: e.message }); }
  });

  router.post('/nova/suggestions', async (req: Request, res: Response) => {
    const auth = requireAuth(req, res);
    if (!auth) return;
    if (!hasDatabase()) return res.status(503).json({ error: 'Database unavailable' });
    try {
      const { rows: memRows } = await dbQuery(
        `SELECT category, title, content FROM user_memories WHERE user_id = $1 AND category IN ('brand','visual','content','audience','business') ORDER BY category, sort_order LIMIT 30`,
        [auth.userId],
      );
      if (memRows.length === 0) {
        return res.json({
          success: true, has_memory: false,
          suggestions: [
            { id: 'g1', title: 'Brand Identity Post',      description: 'Showcase your brand story and values',        hint: 'modern brand identity social media post, clean professional design' },
            { id: 'g2', title: 'Product Showcase',         description: 'Highlight your key product or service',       hint: 'product showcase image, studio lighting, premium quality' },
            { id: 'g3', title: 'Promotional Banner',       description: 'Eye-catching offer or announcement',          hint: 'promotional banner with bold typography and vibrant colors' },
            { id: 'g4', title: 'Quote / Inspiration Post', description: 'Motivational content for your audience',      hint: 'elegant quote post with minimal design and beautiful typography' },
          ],
        });
      }
      const brandCtx: Record<string, string[]> = {};
      for (const r of memRows as any[]) { if (!brandCtx[r.category]) brandCtx[r.category] = []; brandCtx[r.category].push(`${r.title}: ${r.content}`); }
      const brandSummary = Object.entries(brandCtx).map(([cat, items]) => `${cat.toUpperCase()}:\n${items.join('\n')}`).join('\n\n');
      const aiCfg = await getAIConfig();
      const apiKey = resolveActiveKey(aiCfg);
      if (!apiKey) return res.json({ success: true, has_memory: true, suggestions: [] });
      const anthropic = new Anthropic({ apiKey });
      const msg = await anthropic.messages.create({
        model: FAST_MODEL, max_tokens: 800,
        messages: [{ role: 'user', content: `Based on this brand's memory profile, generate 4 personalized design suggestions for social media / marketing content.\n\nBRAND MEMORY:\n${brandSummary}\n\nReturn ONLY a valid JSON array (no markdown):\n[\n  {\n    "id": "s1",\n    "title": "Short catchy title (3-5 words)",\n    "description": "One sentence describing what this design achieves for the brand",\n    "hint": "A specific image generation prompt tailored to this brand's style, colors, and niche (used as the pre-filled description)"\n  }\n]\n\nMake each suggestion specific to this brand — reference their niche, audience, and visual style. Vary the formats: social post, banner, story, etc.` }],
      });
      let suggestions: any[] = [];
      const raw = msg.content[0].type === 'text' ? msg.content[0].text : '';
      try { const arrMatch = raw.match(/\[[\s\S]*\]/); if (arrMatch) suggestions = JSON.parse(arrMatch[0]); } catch (_err) { suggestions = []; }
      return res.json({ success: true, has_memory: true, suggestions });
    } catch (e: any) { return res.status(500).json({ success: false, error: e.message }); }
  });

  router.post('/admin/agent-workflows/:key/reset', async (req: Request, res: Response) => {
    if (!hasDatabase()) return res.status(503).json({ success: false, error: 'Database not configured' });
    const defaults = WORKFLOW_DEFAULTS[req.params.key];
    if (!defaults) return res.status(404).json({ success: false, error: `No defaults for agent '${req.params.key}'` });
    try {
      const auth = await requireAdmin(req, res);
      if (!auth) return;
      await dbQuery(`DELETE FROM agent_workflows WHERE agent_key = $1`, [req.params.key]);
      const seeded: any[] = [];
      for (const wf of defaults) {
        const { rows } = await dbQuery(
          `INSERT INTO agent_workflows (agent_key, name, description, steps, is_active, updated_at) VALUES ($1, $2, $3, $4, true, NOW()) RETURNING *`,
          [req.params.key, wf.name, wf.description, JSON.stringify(wf.steps)],
        );
        seeded.push(rows[0]);
      }
      return res.json({ success: true, workflows: seeded });
    } catch (e: any) { return res.status(500).json({ success: false, error: e.message }); }
  });

  return { router, runScheduledAgents };
}


