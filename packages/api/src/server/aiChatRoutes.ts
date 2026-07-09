import express from 'express';
import type { Router, Request, Response } from 'express';
import { randomUUID } from 'crypto';
import Anthropic from '@anthropic-ai/sdk';
import { GoogleGenerativeAI } from '@google/generative-ai';
import { logger } from '../logger.ts';
import { resolveGeminiModel, recordAIUsage, FAST_MODEL, hasAICredits } from '../ai-helpers.ts';

const OUT_OF_CREDITS_MSG = "You're out of AI credits for this month. Upgrade your plan or wait for your monthly reset to keep using AI features.";

type AuthResult = { userId: string; role?: string } | null;

interface AIConfig {
  model: string;
  provider: 'anthropic' | 'google';
  encryptedKey: string | null;
  googleEncryptedKey: string | null;
  systemPrompt: string | null;
}

interface AIChatDeps {
  requireAuth: (req: Request, res: Response) => AuthResult;
  getAIConfig: () => Promise<AIConfig>;
  resolveActiveKey: (config: AIConfig) => string;
  callAINonStreaming: (provider: 'anthropic' | 'google', apiKey: string, model: string, systemPrompt: string, userMessage: string, maxTokens?: number) => Promise<string>;
  GEMINI_MODELS: string[];
  pool: { query: (sql: string, params?: unknown[]) => Promise<{ rows: any[] }> } | null;
  dbQuery: <T = any>(sql: string, params?: unknown[]) => Promise<{ rows: T[] }>;
  createNotification: (userId: string, type: string, title: string, message: string, data?: Record<string, any>) => Promise<void>;
  checkTaskActions: (userId: string, actionType: string) => Promise<Array<{ task_id: string; title: string; new_status: string; progress: string }>>;
  getUserConnectedAccounts: (userId: string) => Promise<any[]>;
  AGENT_DEFS: Record<string, { name: string; role: string; icon: string; color: string; memoryKeywords: string[] }>;
}

// ── Local constants ───────────────────────────────────────────────────────────

const AI_CORE_RULES = `
---
## UI INTERACTION RULES — ALWAYS ENFORCED (do not remove)

### Question format
Whenever you present a question with multiple options, you MUST use this exact numbered format:

1. [Your question here]
   - Option A
   - Option B
   - Option C
   - Custom

NEVER write plain dash lists or paragraph options. Always number each question. The UI converts this format into interactive click-chips automatically.

### After a post is drafted
Output ONLY this — nothing else:
Done! Your [platform] post is ready.

1. What would you like to do next?
   - Schedule it
   - Explain why this works
   - Add an image
   - Edit something
   - Custom

No coaching text. No breakdowns. No extra paragraphs.

### "Let AI decide" / "Let AI suggest"
When any answer says "Let AI decide", make the creative decision yourself and proceed immediately without asking a follow-up question.

### "Schedule it" (user clicks chip — no date given)
Output nothing. The UI shows a calendar automatically. Wait for "Schedule for [ISO datetime]", then call schedule_post.

### Scheduling when date/time is already in the user's message
If the user's message already contains a date and/or time (e.g. "schedule for tomorrow at 9am", "post on Friday at 3pm", "publish Monday 10:00"), do NOT output anything or show a calendar. Convert the date/time to ISO 8601 UTC (assume the user's timezone if unknown) and call schedule_post immediately.

### "Explain why this works"
Reply with 2–3 bullet points only. Each bullet under 12 words. No intro sentence.

---

## PLATFORM CONNECTION RULES — STRICTLY ENFORCED

Before calling any tool involving a platform, check the LIVE SAAS STATE for that platform's connection status.

### Scenario A — "Publish / schedule to [Platform]" and it is NOT connected
DO NOT call schedule_post. Instead respond:
> [Platform] isn't connected yet. Connect it in **Integrations** and I'll schedule it straight away.
> 1. What would you like to do?
>    - Create the draft now (I'll publish when I connect)
>    - Remind me to connect [Platform]
>    - Cancel

If the user chooses "Create the draft now", call create_draft (no platforms field) and confirm the draft is saved.

### Scenario B — "Draft a post for [Platform]" and it is NOT connected
Proceed and call create_draft immediately. After the tool result, if platforms_not_connected is non-empty, respond:

Done! Your [Platform] draft is ready — but [Platform] isn't connected, so it can't be published yet.

1. What would you like to do next?
   - Connect [Platform] in Integrations
   - Edit the draft
   - Schedule it for later
   - Custom
`;

export const AI_SYSTEM_PROMPT_DEFAULT = `You are Daky — the user's dedicated personal social media butler with 55 years of deep, battle-tested expertise in social media marketing, brand strategy, content creation, audience psychology, and platform algorithms. You have guided Fortune 500 brands, solo creators, and everything in between. You know what works, what flops, and exactly why.

You operate exclusively within this SaaS platform. You do NOT give advice that requires tools, apps, or workflows outside this platform. Every recommendation you make is something the user can act on directly here, right now.

You are not a chatbot. You are the user's personal butler — proactive, precise, discreet, and deeply invested in their success. You speak with quiet authority: no fluff, no filler, no generic advice. Every word you say is earned.

---

## YOUR PERSONALITY
- Address the user by their first name when you know it (from their profile below)
- Speak like a trusted advisor who knows their brand inside-out
- Confident but never arrogant; warm but never sycophantic
- When you know what's best, recommend it with conviction — don't hedge
- When you genuinely need input, ask cleanly and precisely
- Never say "Great question!" or "Absolutely!" — just answer

---

## USER CONTEXT — READ THIS FIRST, ALWAYS
{USER_MEMORY}

Use this context to make every response feel personally crafted for this user. Reference their brand, industry, tone, audience, or goals when relevant. If no memory is provided, ask 1 focused question to understand who they are before drafting anything.

---

## PLATFORM SCOPE — HARD BOUNDARIES
You ONLY help with tasks achievable inside this platform:
✓ Drafting posts, captions, threads, and content
✓ Scheduling posts to connected social accounts
✓ Analyzing post performance and suggesting improvements
✓ Creating visual content cards (via the card builder)
✓ Managing content calendars and pipelines
✓ Social media strategy scoped to the user's brand
✓ Platform-specific best practices (LinkedIn, Instagram, Twitter/X, Facebook, TikTok)

✗ NEVER suggest third-party tools, external apps, or workflows outside this platform
✗ NEVER advise on paid advertising, ad budgets, or media buying
✗ NEVER give legal, financial, or medical advice
✗ NEVER draft content that is political, hateful, deceptive, or off-brand for the user

---

## TOOLS
Act immediately when intent is clear — never just describe what you could do:
- "draft / write / create a post" → create_draft
- "schedule / post at / publish on [date]" → schedule_post
- "show my posts / list drafts / what have I written" → get_recent_posts
- "what platforms / accounts connected" → get_connected_platforms

Platform pre-selection: when the user names a platform (e.g. "LinkedIn post", "Instagram caption", "Twitter thread"), set the lowercase platform name in the platforms field. No platform mentioned → omit the field.

IMPORTANT: Always check the LIVE SAAS STATE section for each platform's connection status before calling a publishing tool. Follow the PLATFORM CONNECTION RULES exactly.

After every tool use, confirm in one sentence and offer a clear next step.

### Task auto-progression
When a tool result includes a non-empty "tasks_progressed" array, always mention it concisely. Examples:
- If status is "done": "✓ Your task **"[title]"** has been completed automatically."
- If progress is "1/3": "📋 Your task **"[title]"** is now 1/3 of the way there."
Never skip this — task progress feedback is important to the user.

---

## CONTENT CREATION — HOW DAKY WORKS

When a request is vague (no topic, platform, or tone stated), present a focused question set FIRST. When the request is specific enough, draft immediately — do not ask unnecessary questions.

### Question format (ALWAYS use this — never plain text lists):

[One-sentence butler intro ending with a colon:]

1. [Question]
   - [Specific option tailored to this user's brand/industry]
   - [Specific option]
   - [Specific option]
   - Custom

2. [Question]
   - [Option]
   - [Option]
   - Custom

Rules:
- Maximum 3 questions. Stop at 3. Never ask a 4th.
- Every option must be under 55 characters
- ALWAYS include "- Custom" as the last sub-bullet under every question
- Use numbered items (1. 2. 3.) and indented sub-bullets (- ) — never plain text
- Options must be tailored to this specific user's known brand/industry — never generic filler

### EXAMPLE for a user who runs a fitness coaching brand:

Let's craft the perfect post for you:

1. What would you like to focus on?
   - Client transformation story
   - Morning routine that doubles energy
   - The biggest fitness myth debunked
   - Nutrition tip most coaches get wrong
   - Custom

2. Which platform is this for?
   - Instagram
   - LinkedIn
   - Twitter/X
   - Facebook
   - Custom

3. What tone should it have?
   - Motivational and direct
   - Educational and credible
   - Relatable and conversational
   - Custom

---

## AFTER USER SUBMITS CHOICES

Read ALL their answers and immediately call the tool with a complete, high-quality draft. Do NOT ask follow-up questions. Just execute.

**"Let AI decide"** — make the best creative choice yourself and proceed immediately. Never ask what "Let AI decide" means.

Write real, engaging content — never placeholder text. Use platform-appropriate length, formatting, and voice aligned to the user's brand personality.

---

## AFTER A DRAFT IS CREATED

Output EXACTLY this — nothing else:

Done! Your [platform] post is ready.

1. What would you like to do next?
   - Schedule it
   - Explain why this works
   - Add an image
   - Edit something
   - Custom

No coaching paragraphs. No breakdowns. No extra sentences. The user picks their next step.

---

## WHEN USER SELECTS "Explain why this works"

Reply with ONLY 2–3 bullet points. Each bullet under 12 words. No intro sentence.

• [Reason 1]
• [Reason 2]
• [Reason 3]

If user says "explain in detail" — then write more.

---

## WHEN USER SELECTS "Schedule it" (chip with no date given)

Output nothing. The frontend shows an inline calendar automatically. Wait for "Schedule for [ISO datetime] ([label])", then call schedule_post with the most recent draft's title and content.

## WHEN USER GIVES A DATE/TIME DIRECTLY

If the user's message already specifies a date and/or time (e.g. "schedule for tomorrow at 9am", "post on Friday 3pm", "publish 2025-06-01 14:00"), skip the calendar entirely. Convert the specified date/time to ISO 8601 UTC and call schedule_post immediately with the most recent draft's title and content.

---

## WHEN USER SELECTS "Add an image"

1. What style works best for this post?
   - Abstract artistic background
   - Professional lifestyle photo
   - Quote text overlay
   - Infographic or data visual
   - Custom

2. What mood should it convey?
   - Energetic and motivating
   - Calm and professional
   - Fun and vibrant
   - Custom

---

## BUTLER STANDARDS
- Every response must feel personally crafted, not templated
- Use the user's brand data to make topic suggestions feel inevitable, not random
- When you sense the user is stuck or frustrated, gently guide — don't interrogate
- Short, decisive responses win over long explanations — the user is busy
- If something is outside platform scope, say so once, briefly, then redirect to what you CAN do here`;

const AI_TOOLS: Anthropic.Tool[] = [
  {
    name: 'create_draft',
    description: 'Create a new blog/content post saved as a draft. Use when user asks to draft, write, or create a post/article.',
    input_schema: {
      type: 'object',
      properties: {
        title: { type: 'string', description: 'Post title' },
        content: { type: 'string', description: 'Full post content (can be markdown or plain text)' },
        excerpt: { type: 'string', description: 'Short summary (1-2 sentences)' },
        platforms: { type: 'array', items: { type: 'string' }, description: 'Lowercase social platform names to pre-select for automation (e.g. ["linkedin","instagram"]). Only include when user explicitly mentions specific platforms.' },
      },
      required: ['title', 'content'],
    },
  },
  {
    name: 'schedule_post',
    description: 'Create a post and schedule it to publish at a specific date/time. Use when user specifies a date or time to publish.',
    input_schema: {
      type: 'object',
      properties: {
        title: { type: 'string', description: 'Post title' },
        content: { type: 'string', description: 'Full post content' },
        scheduled_at: { type: 'string', description: 'ISO 8601 datetime string (e.g. "2025-06-01T09:00:00Z"). Convert relative times like "tomorrow at 9am" to absolute UTC.' },
        excerpt: { type: 'string', description: 'Short summary' },
        platforms: { type: 'array', items: { type: 'string' }, description: 'Lowercase social platform names to pre-select for automation (e.g. ["linkedin","twitter"]). Only include when user explicitly mentions specific platforms.' },
      },
      required: ['title', 'content', 'scheduled_at'],
    },
  },
  {
    name: 'get_recent_posts',
    description: "Fetch the user's recent posts to show them or reference them.",
    input_schema: {
      type: 'object',
      properties: {
        limit: { type: 'number', description: 'Max number to return (default 5, max 10)' },
        status: { type: 'string', description: 'Filter: draft | published | scheduled | all' },
      },
    },
  },
  {
    name: 'get_connected_platforms',
    description: "Get which social media platforms the user has connected so you can give relevant advice.",
    input_schema: {
      type: 'object',
      properties: {},
    },
  },
  {
    name: 'get_my_tasks',
    description: "Fetch the user's tasks. Use when asked about tasks, to-dos, what to work on next, or to check task status. The live state already shows open tasks — call this for filtered/complete lists.",
    input_schema: {
      type: 'object',
      properties: {
        status: { type: 'string', description: 'Filter: todo | in_progress | review | done | open (default, all non-done) | all' },
      },
    },
  },
  {
    name: 'update_task_status',
    description: "Update a task's status. Use when user says 'mark done', 'complete', 'move to review', 'start working on', etc. Requires task_id from the live state or get_my_tasks.",
    input_schema: {
      type: 'object',
      properties: {
        task_id: { type: 'string', description: 'UUID of the task (shown in live state as [task_id:…])' },
        status: { type: 'string', description: 'New status: todo | in_progress | review | done' },
      },
      required: ['task_id', 'status'],
    },
  },
  {
    name: 'create_task',
    description: "Create a new task and assign it to the user. Use when asked to add, create, or log a task or to-do item.",
    input_schema: {
      type: 'object',
      properties: {
        title: { type: 'string', description: 'Task title' },
        description: { type: 'string', description: 'Optional detail or notes' },
        priority: { type: 'string', description: 'low | medium | high | urgent (default: medium)' },
        due_date: { type: 'string', description: 'YYYY-MM-DD if a date was mentioned' },
        project_id: { type: 'string', description: 'Optional: specific project UUID from live state. If omitted, uses the first project.' },
      },
      required: ['title'],
    },
  },
  {
    name: 'get_my_projects',
    description: "List the user's projects and workspaces with open task counts. Use when asked about projects, workspaces, or to pick a project for a task.",
    input_schema: {
      type: 'object',
      properties: {},
    },
  },
];

// ── Local helpers ─────────────────────────────────────────────────────────────

function slugify(text: string): string {
  return text.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');
}

function inferTaskActions(title: string): Array<{ action_type: string; label: string; target_count: number }> {
  const t = title.toLowerCase();
  const results: Array<{ action_type: string; label: string; target_count: number }> = [];
  const numMatch = t.match(/\b(\d+)\b/);
  const n = numMatch ? Math.min(parseInt(numMatch[1], 10), 50) : 1;
  const check = (actionType: string, label: string, verbs: RegExp, nouns: RegExp) => {
    if (verbs.test(t) && nouns.test(t)) results.push({ action_type: actionType, label, target_count: n });
  };
  check('create_post',    'Create a post',              /create|write|draft|make|compose|produce/,    /post|content|article|caption|blog|copy|update|tweet|thread/);
  check('schedule_post',  'Schedule a post',            /schedule|publish|queue|plan/,                /post|content|article|caption|update|tweet/);
  check('publish_post',   'Publish / go live',          /publish|go\slive|launch|release|push\slive/, /post|content|article|update/);
  check('connect_social', 'Connect a social account',   /connect|add|link|integrate|set\sup/,         /social|account|platform|twitter|linkedin|instagram|facebook|tiktok|youtube/);
  check('create_card',    'Create a design card',       /create|design|make|build|produce/,           /card|graphic|visual|banner|image|poster|flyer/);
  check('save_memory',    'Save a memory / brand item', /add|save|update|fill|set/,                   /memory|brand|profile|personal|about|niche|tone/);
  return results;
}

function aiToolLabel(name: string, input: any): string {
  switch (name) {
    case 'create_draft': return `Creating draft: "${input?.title || 'untitled'}"`;
    case 'schedule_post': return `Scheduling post: "${input?.title || 'untitled'}"`;
    case 'get_recent_posts': return 'Fetching your posts…';
    case 'get_connected_platforms': return 'Checking connected platforms…';
    case 'get_my_tasks': return 'Fetching your tasks…';
    case 'update_task_status': return `Marking task as ${input?.status ?? 'updated'}…`;
    case 'create_task': return `Creating task: "${input?.title || 'untitled'}"…`;
    case 'get_my_projects': return 'Fetching your projects…';
    default: return `Running ${name}…`;
  }
}

export function registerAIChatRoutes({
  requireAuth,
  getAIConfig,
  resolveActiveKey,
  callAINonStreaming,
  GEMINI_MODELS,
  pool,
  dbQuery,
  createNotification,
  checkTaskActions,
  getUserConnectedAccounts,
  AGENT_DEFS,
}: AIChatDeps): Router {
  const router = express.Router();

  // ── Module-scoped helpers that close over deps ──────────────────────────────

  async function logTaskActivity(
    projectId: string, userId: string, action: string, taskId?: string, metadata?: Record<string, unknown>
  ) {
    try {
      await dbQuery(
        `INSERT INTO task_activity (project_id, user_id, action, task_id, metadata) VALUES ($1,$2,$3,$4,$5)`,
        [projectId, userId, action, taskId ?? null, metadata ? JSON.stringify(metadata) : null]
      );
    } catch (_err) { /* non-fatal */ }
  }

  async function getUserSaaSContext(userId: string): Promise<string> {
    if (!pool) return '';
    const parts: string[] = [];
    try {
      const { rows: socials } = await dbQuery(
        `SELECT platform, account_name, handle, followers, connected FROM social_accounts WHERE user_id = $1 ORDER BY platform`,
        [userId]
      );
      if (socials.length > 0) {
        const lines = (socials as any[]).map((s) => {
          const label = s.account_name || s.handle || s.platform;
          const fol = s.followers ? ` (${s.followers.toLocaleString()} followers)` : '';
          return `  ${s.connected ? '✅' : '❌'} ${s.platform}: ${label}${fol}${s.connected ? '' : ' — DISCONNECTED'}`;
        });
        parts.push(`### Social Accounts\n${lines.join('\n')}`);
      } else {
        parts.push('### Social Accounts\nNone connected yet.');
      }

      const { rows: projects } = await dbQuery(
        `SELECT p.id, p.name AS project_name, o.name AS org_name, om.role
         FROM projects p
         JOIN organizations o ON o.id = p.org_id
         JOIN organization_memberships om ON om.org_id = p.org_id AND om.user_id = $1
         ORDER BY p.created_at`,
        [userId]
      );
      if (projects.length > 0) {
        const lines = (projects as any[]).map((p) => `  • ${p.org_name} / ${p.project_name} (${p.role}) [project_id:${p.id}]`);
        parts.push(`### Workspaces & Projects\n${lines.join('\n')}`);
      } else {
        parts.push('### Workspaces & Projects\nNo projects yet.');
      }

      const { rows: tasks } = await dbQuery(
        `SELECT t.id, t.title, t.status, t.priority, t.due_date, p.name AS project_name
         FROM tasks t
         JOIN task_assignees ta ON ta.task_id = t.id AND ta.user_id = $1
         JOIN projects p ON p.id = t.project_id
         WHERE t.status != 'done'
         ORDER BY t.due_date ASC NULLS LAST, t.priority DESC LIMIT 20`,
        [userId]
      );
      if (tasks.length > 0) {
        const lines = (tasks as any[]).map((t) => {
          const due = t.due_date ? ` due:${new Date(t.due_date).toLocaleDateString('en-GB')}` : '';
          return `  • [${t.status.toUpperCase()}][${t.priority}]${due} "${t.title}" — ${t.project_name} [task_id:${t.id}]`;
        });
        parts.push(`### My Open Tasks (${tasks.length})\n${lines.join('\n')}`);
      } else {
        parts.push('### My Open Tasks\nNo open tasks assigned.');
      }

      const { rows: scheduled } = await dbQuery(
        `SELECT title, scheduled_at FROM blog_posts WHERE user_id = $1 AND status = 'scheduled' AND scheduled_at > NOW() ORDER BY scheduled_at ASC LIMIT 5`,
        [userId]
      );
      if (scheduled.length > 0) {
        const lines = (scheduled as any[]).map((p) => `  • "${p.title}" — ${new Date(p.scheduled_at).toLocaleString('en-GB', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })}`);
        parts.push(`### Upcoming Scheduled Posts\n${lines.join('\n')}`);
      }

      const { rows: draftCount } = await dbQuery(
        `SELECT COUNT(*)::int AS n FROM blog_posts WHERE user_id=$1 AND status='draft'`,
        [userId]
      );
      if ((draftCount[0] as any)?.n > 0) {
        parts.push(`### Drafts\n  ${(draftCount[0] as any).n} draft(s) saved.`);
      }
    } catch (e) {
      logger.error('getUserSaaSContext error:', e);
    }
    if (parts.length === 0) return '';
    return `## YOUR LIVE SAAS STATE (as of this message)\n${parts.join('\n\n')}`;
  }

  async function getSkillsPromptForScope(page: string): Promise<string> {
    try {
      const { rows } = await dbQuery(
        `SELECT system_prompt FROM ai_skills WHERE enabled = true AND (scope = 'all' OR scope = $1) ORDER BY sort_order ASC`,
        [page || 'all']
      );
      return (rows as any[]).map((r) => r.system_prompt).filter(Boolean).join('\n\n');
    } catch (_err) { return ''; }
  }

  async function preselectPlatformsForPost(
    postId: string,
    userId: string,
    platforms: string[],
  ): Promise<{ connected: string[]; missing: string[] }> {
    const result = { connected: [] as string[], missing: [] as string[] };
    if (!pool || platforms.length === 0) return result;
    try {
      const normalized = platforms.map((p) => p.toLowerCase().trim());
      const expanded = Array.from(new Set(normalized.flatMap((p) =>
        p === 'x' ? ['twitter', 'x'] : p === 'twitter' ? ['twitter', 'x'] : [p]
      )));
      const { rows: accounts } = await dbQuery(
        `SELECT id, LOWER(platform) AS platform FROM social_accounts WHERE user_id=$1 AND LOWER(platform) = ANY($2::text[]) AND connected = true`,
        [userId, expanded]
      );
      const foundPlatforms = new Set((accounts as any[]).map((a) => a.platform as string));
      for (const p of normalized) {
        const aliases = p === 'x' ? ['x', 'twitter'] : p === 'twitter' ? ['twitter', 'x'] : [p];
        if (aliases.some((a) => foundPlatforms.has(a))) {
          result.connected.push(p);
        } else {
          result.missing.push(p);
        }
      }
      if ((accounts as any[]).length === 0) return result;
      const settingId = randomUUID();
      const existing = await dbQuery('SELECT id FROM social_post_settings WHERE post_id=$1', [postId]);
      const settId: string = (existing.rows[0] as any)?.id ? String((existing.rows[0] as any).id) : settingId;
      if (!existing.rows.length) {
        await dbQuery(
          `INSERT INTO social_post_settings (id, post_id, template, publish_type, scheduled_at) VALUES ($1,$2,'','immediate',NULL)`,
          [settId, postId]
        );
      }
      for (const acc of accounts as any[]) {
        await dbQuery(
          `INSERT INTO social_post_targets (id, social_post_id, social_account_id, enabled) VALUES ($1,$2,$3,true)`,
          [randomUUID(), settId, acc.id]
        );
      }
    } catch (e) {
      logger.error('preselectPlatformsForPost error:', e);
    }
    return result;
  }

  async function executeAITool(name: string, input: any, userId: string): Promise<any> {
    switch (name) {
      case 'create_draft': {
        const title = String(input?.title || 'Untitled').slice(0, 255);
        const content = String(input?.content || '');
        const excerpt = String(input?.excerpt || '').slice(0, 500);
        const platforms: string[] = Array.isArray(input?.platforms) ? input.platforms.map(String) : [];
        const id = randomUUID();
        const slug = slugify(title) || id;
        const { rows } = await dbQuery(
          `INSERT INTO blog_posts (id, user_id, title, slug, content, excerpt, status, created_at, updated_at)
           VALUES ($1, $2, $3, $4, $5, $6, 'draft', NOW(), NOW()) RETURNING id, title, status`,
          [id, userId, title, slug, content, excerpt]
        );
        const platformResult = await preselectPlatformsForPost(id, userId, platforms);
        createNotification(userId, 'draft_created', 'Draft created', `"${title}" has been saved as a draft.`, { postId: id }).catch(() => undefined);
        const tasksProgressed = await checkTaskActions(userId, 'create_post');
        return { success: true, action: 'created_draft', post: (rows as any[])[0], platforms_connected: platformResult.connected, platforms_not_connected: platformResult.missing, tasks_progressed: tasksProgressed };
      }
      case 'schedule_post': {
        const title = String(input?.title || 'Untitled').slice(0, 255);
        const content = String(input?.content || '');
        const excerpt = String(input?.excerpt || '').slice(0, 500);
        const scheduled_at = input?.scheduled_at ? new Date(input.scheduled_at).toISOString() : null;
        if (!scheduled_at) throw new Error('Invalid scheduled_at datetime');
        const platforms: string[] = Array.isArray(input?.platforms) ? input.platforms.map(String) : [];
        const id = randomUUID();
        const slug = slugify(title) || id;
        const { rows } = await dbQuery(
          `INSERT INTO blog_posts (id, user_id, title, slug, content, excerpt, status, scheduled_at, created_at, updated_at)
           VALUES ($1, $2, $3, $4, $5, $6, 'scheduled', $7, NOW(), NOW()) RETURNING id, title, status, scheduled_at`,
          [id, userId, title, slug, content, excerpt, scheduled_at]
        );
        const platformResult = await preselectPlatformsForPost(id, userId, platforms);
        const schedDate = scheduled_at ? new Date(scheduled_at).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }) : '';
        createNotification(userId, 'post_scheduled', 'Post scheduled', `"${title}" is scheduled for ${schedDate}.`, { postId: id, scheduled_at }).catch(() => undefined);
        const tasksProgressed = await Promise.all([checkTaskActions(userId, 'create_post'), checkTaskActions(userId, 'schedule_post')]).then(([a, b]) => [...a, ...b]);
        return { success: true, action: 'scheduled_post', post: (rows as any[])[0], platforms_connected: platformResult.connected, platforms_not_connected: platformResult.missing, tasks_progressed: tasksProgressed };
      }
      case 'get_recent_posts': {
        const limit = Math.min(Number(input?.limit) || 5, 10);
        const status = String(input?.status || '').trim().toLowerCase();
        const params: any[] = [userId];
        let q = `SELECT id, title, status, scheduled_at, published_at, updated_at FROM blog_posts WHERE user_id = $1`;
        if (status && status !== 'all') {
          params.push(status);
          q += ` AND status = $${params.length}`;
        } else {
          q += ` AND status NOT IN ('archived','deleted')`;
        }
        q += ` ORDER BY updated_at DESC LIMIT $${params.length + 1}`;
        params.push(limit);
        const { rows } = await dbQuery(q, params);
        return { posts: rows };
      }
      case 'get_connected_platforms': {
        const accounts = await getUserConnectedAccounts(userId);
        const connected = (accounts as any[]).filter((a) => a.connected !== false).map((a) => ({
          platform: a.platform,
          name: a.accountName || a.handle || a.platform,
        }));
        return { connected };
      }
      case 'get_my_tasks': {
        const sf = String(input?.status || 'open').toLowerCase();
        let cond = '';
        if (sf === 'open') cond = `AND t.status != 'done'`;
        else if (sf !== 'all') cond = `AND t.status = '${sf.replace(/'/g, "''")}'`;
        const { rows } = await dbQuery(
          `SELECT t.id, t.title, t.status, t.priority, t.due_date, p.name AS project_name, o.name AS org_name
           FROM tasks t
           JOIN task_assignees ta ON ta.task_id = t.id AND ta.user_id = $1
           JOIN projects p ON p.id = t.project_id
           JOIN organizations o ON o.id = p.org_id
           WHERE 1=1 ${cond}
           ORDER BY t.due_date ASC NULLS LAST, t.updated_at DESC LIMIT 25`,
          [userId]
        );
        return { tasks: rows };
      }
      case 'update_task_status': {
        const taskId = String(input?.task_id || '');
        const newStatus = String(input?.status || '').toLowerCase();
        if (!['todo', 'in_progress', 'review', 'done'].includes(newStatus)) {
          throw new Error('Invalid status. Use: todo | in_progress | review | done');
        }
        const { rows: check } = await dbQuery(
          `SELECT t.id, t.title, t.status, t.project_id
           FROM tasks t
           WHERE t.id = $1 AND (
             EXISTS (SELECT 1 FROM task_assignees ta WHERE ta.task_id = t.id AND ta.user_id = $2)
             OR EXISTS (
               SELECT 1 FROM organization_memberships om
               JOIN projects p ON p.org_id = om.org_id
               WHERE p.id = t.project_id AND om.user_id = $2 AND om.role IN ('owner','admin')
             )
           )`,
          [taskId, userId]
        );
        if (!(check as any[]).length) throw new Error('Task not found or you do not have permission to update it');
        const task = (check as any[])[0];
        const { rows: newPos } = await dbQuery(
          `SELECT COALESCE(MAX(position),0)+1 AS next FROM tasks WHERE project_id=$1 AND status=$2`,
          [task.project_id, newStatus]
        );
        await dbQuery(`UPDATE tasks SET status=$1, position=$2, updated_at=NOW() WHERE id=$3`, [newStatus, (newPos as any[])[0].next, taskId]);
        void logTaskActivity(task.project_id, userId, 'status_changed', taskId, { from: task.status, to: newStatus });
        if (newStatus === 'done') {
          createNotification(userId, 'agent_activity', 'Task completed ✓', `"${task.title}" marked as done.`, { taskId }).catch(() => undefined);
        }
        return { success: true, task_id: taskId, title: task.title, old_status: task.status, new_status: newStatus };
      }
      case 'create_task': {
        const title = String(input?.title || '').trim().slice(0, 255);
        if (!title) throw new Error('Task title is required');
        const description = String(input?.description || '');
        const priority = ['low', 'medium', 'high', 'urgent'].includes(input?.priority) ? input.priority : 'medium';
        const dueDate = input?.due_date || null;
        let projectId = input?.project_id ? String(input.project_id) : null;
        if (!projectId) {
          const { rows: projs } = await dbQuery(
            `SELECT p.id FROM projects p JOIN organization_memberships om ON om.org_id = p.org_id AND om.user_id = $1 ORDER BY p.created_at ASC LIMIT 1`,
            [userId]
          );
          if (!(projs as any[]).length) throw new Error('No project found. Create a project first.');
          projectId = (projs as any[])[0].id;
        }
        const { rows: posRows } = await dbQuery(
          `SELECT COALESCE(MAX(position),0)+1 AS next FROM tasks WHERE project_id=$1 AND status='todo'`,
          [projectId]
        );
        const taskId = randomUUID();
        const { rows } = await dbQuery(
          `INSERT INTO tasks (id, project_id, title, description, status, priority, position, due_date, created_by)
           VALUES ($1,$2,$3,$4,'todo',$5,$6,$7,$8) RETURNING id, title, status, priority`,
          [taskId, projectId, title, description, priority, (posRows as any[])[0].next, dueDate, userId]
        );
        await dbQuery(`INSERT INTO task_assignees (task_id, user_id) VALUES ($1,$2) ON CONFLICT DO NOTHING`, [taskId, userId]);
        const inferred = inferTaskActions(title);
        if (inferred.length) {
          await Promise.all(inferred.map((a) =>
            dbQuery(
              `INSERT INTO task_actions (id, task_id, action_type, label, target_count, current_count) VALUES ($1,$2,$3,$4,$5,0)`,
              [randomUUID(), taskId, a.action_type, a.label, a.target_count]
            )
          ));
        }
        void logTaskActivity(projectId, userId, 'created', taskId, { title });
        return { success: true, task: (rows as any[])[0] };
      }
      case 'get_my_projects': {
        const { rows } = await dbQuery(
          `SELECT p.id, p.name AS project_name, o.name AS org_name, om.role,
             (SELECT COUNT(*)::int FROM tasks t JOIN task_assignees ta ON ta.task_id=t.id WHERE ta.user_id=$1 AND t.project_id=p.id AND t.status!='done') AS my_open_tasks
           FROM projects p
           JOIN organizations o ON o.id = p.org_id
           JOIN organization_memberships om ON om.org_id = p.org_id AND om.user_id = $1
           ORDER BY p.created_at`,
          [userId]
        );
        return { projects: rows };
      }
      default:
        throw new Error(`Unknown tool: ${name}`);
    }
  }

  // ── POST /api/ai/chat ─────────────────────────────────────────────────────
  router.post('/ai/chat', async (req: Request, res: Response) => {
    try {
      const auth = requireAuth(req, res);
      if (!auth) return;

      const { messages, page } = req.body as {
        messages: Array<{ role: 'user' | 'assistant'; content: string }>;
        page?: string;
      };

      if (!Array.isArray(messages) || messages.length === 0) {
        return res.status(400).json({ success: false, error: 'messages array is required' });
      }

      const aiCfg = await getAIConfig();
      const apiKey = resolveActiveKey(aiCfg);
      if (!apiKey) {
        return res.status(503).json({ success: false, error: 'AI service not configured — add your API key in Admin → AI Assistant' });
      }
      if (!(await hasAICredits(auth.userId))) {
        return res.status(402).json({ success: false, error: OUT_OF_CREDITS_MSG });
      }

      const skillsPrompt = await getSkillsPromptForScope(page || '');

      let userMemoryBlock = '';
      if (pool) {
        try {
          const { rows: memRows } = await dbQuery(
            `SELECT category, title, content FROM user_memories WHERE user_id = $1 AND title != '🌐 Full Scraped Memory' ORDER BY category, sort_order, created_at LIMIT 60`,
            [auth.userId]
          );
          if ((memRows as any[]).length > 0) {
            const grouped: Record<string, string[]> = {};
            for (const row of memRows as any[]) {
              if (!grouped[row.category]) grouped[row.category] = [];
              grouped[row.category].push(`  • ${row.title}: ${row.content}`);
            }
            const sections = Object.entries(grouped)
              .map(([cat, lines]) => `### ${cat}\n${lines.join('\n')}`)
              .join('\n\n');
            userMemoryBlock = `## ABOUT THIS USER\n${sections}`;
          } else {
            userMemoryBlock = '## ABOUT THIS USER\nNo personalization data yet. Ask one focused question to understand their brand before drafting.';
          }
        } catch (_err) { /* non-fatal */ }
      }

      const saasContext = await getUserSaaSContext(auth.userId);

      // System prompt in two blocks so the stable prefix (persona + core rules —
      // identical for every user and request) is served from the prompt cache;
      // only the per-user block (memory, live SaaS state, page skills) is
      // reprocessed each request. Tools render before system, so they're cached too.
      const stablePrompt = [
        (aiCfg.systemPrompt || AI_SYSTEM_PROMPT_DEFAULT).replace('{USER_MEMORY}', '(See the ABOUT THIS USER section at the end of this prompt.)'),
        AI_CORE_RULES,
      ].join('\n\n');
      const dynamicPrompt = [userMemoryBlock, saasContext, skillsPrompt].filter(Boolean).join('\n\n');

      res.setHeader('Content-Type', 'text/event-stream');
      res.setHeader('Cache-Control', 'no-cache');
      res.setHeader('Connection', 'keep-alive');

      const send = (data: object) => res.write(`data: ${JSON.stringify(data)}\n\n`);

      // ── Google Gemini path — direct streaming, no tool use ──────────────────
      if (aiCfg.provider === 'google') {
        const effectiveModel = resolveGeminiModel(aiCfg.model);
        const genAI = new GoogleGenerativeAI(apiKey);
        const gModel = genAI.getGenerativeModel({ model: effectiveModel, systemInstruction: `${stablePrompt}\n\n${dynamicPrompt}` });

        const allMessages = messages.slice(-20).map((m) => ({
          role: m.role === 'assistant' ? 'model' : 'user',
          parts: [{ text: String(m.content || '').slice(0, 4000) }],
        }));
        const history = allMessages.slice(0, -1);
        const lastPart = allMessages[allMessages.length - 1]?.parts[0]?.text ?? '';

        const chat = gModel.startChat({ history });
        const stream = await chat.sendMessageStream(lastPart);
        for await (const chunk of stream.stream) {
          const text = chunk.text();
          if (text) send({ type: 'text', text });
        }
        const agg = await stream.response;
        void recordAIUsage({
          userId: auth.userId, feature: 'chat', provider: 'google', model: effectiveModel,
          inputTokens: agg.usageMetadata?.promptTokenCount ?? 0,
          outputTokens: agg.usageMetadata?.candidatesTokenCount ?? 0,
        });
        res.write('data: [DONE]\n\n');
        res.end();
        return;
      }

      // ── Anthropic path — streaming agentic loop with tools ──────────────────
      // One streamed request per iteration: text deltas reach the user live,
      // and the same response is used to detect tool_use — no second
      // "final answer" generation.
      const client = new Anthropic({ apiKey });

      const systemBlocks: Anthropic.TextBlockParam[] = [
        { type: 'text', text: stablePrompt, cache_control: { type: 'ephemeral' } },
        ...(dynamicPrompt ? [{ type: 'text' as const, text: dynamicPrompt }] : []),
      ];

      const conversationMessages: Anthropic.MessageParam[] = messages.slice(-20).map((m) => ({
        role: m.role as 'user' | 'assistant',
        content: String(m.content || '').slice(0, 4000),
      }));

      let loopMessages = [...conversationMessages];
      const usage = { input: 0, output: 0, cacheRead: 0 };

      for (let iteration = 0; iteration < 5; iteration++) {
        const isLastIteration = iteration >= 4;

        const stream = client.messages.stream({
          model: aiCfg.model,
          max_tokens: 4096,
          system: systemBlocks,
          // Tools stay in the request on every iteration so the cached
          // tools+system prefix is byte-identical; the last iteration blocks
          // further calls via tool_choice instead of dropping the tool list.
          tools: AI_TOOLS,
          ...(isLastIteration ? { tool_choice: { type: 'none' as const } } : {}),
          messages: loopMessages,
        });
        for await (const chunk of stream) {
          if (chunk.type === 'content_block_delta' && chunk.delta.type === 'text_delta') {
            send({ type: 'text', text: chunk.delta.text });
          }
        }
        const response = await stream.finalMessage();
        usage.input += response.usage.input_tokens;
        usage.output += response.usage.output_tokens;
        usage.cacheRead += response.usage.cache_read_input_tokens ?? 0;

        if (response.stop_reason !== 'tool_use' || isLastIteration) break;

        const toolResultContents: Anthropic.ToolResultBlockParam[] = [];
        for (const block of response.content) {
          if (block.type !== 'tool_use') continue;
          send({ type: 'tool_start', name: block.name, label: aiToolLabel(block.name, block.input) });
          try {
            const result = await executeAITool(block.name, block.input, auth.userId);
            send({ type: 'tool_done', name: block.name, success: true, result });
            toolResultContents.push({ type: 'tool_result', tool_use_id: block.id, content: JSON.stringify(result) });
          } catch (err: any) {
            const errMsg = err?.message || 'Tool failed';
            send({ type: 'tool_done', name: block.name, success: false, error: errMsg });
            toolResultContents.push({ type: 'tool_result', tool_use_id: block.id, content: `Error: ${errMsg}`, is_error: true });
          }
        }

        loopMessages = [
          ...loopMessages,
          { role: 'assistant', content: response.content },
          { role: 'user', content: toolResultContents },
        ];
      }

      void recordAIUsage({
        userId: auth.userId, feature: 'chat', provider: 'anthropic', model: aiCfg.model,
        inputTokens: usage.input, outputTokens: usage.output, cacheReadTokens: usage.cacheRead,
      });

      res.write('data: [DONE]\n\n');
      res.end();
    } catch (error: any) {
      logger.error('AI chat error:', error);
      if (!res.headersSent) {
        return res.status(500).json({ success: false, error: error?.message || 'AI request failed' });
      }
      res.write(`data: ${JSON.stringify({ error: error?.message || 'AI request failed' })}\n\n`);
      res.end();
    }
  });

  // ── POST /api/ai/orchestrate ───────────────────────────────────────────────
  router.post('/ai/orchestrate', async (req: Request, res: Response) => {
    try {
      const auth = requireAuth(req, res);
      if (!auth) return;

      const { messages } = req.body as { messages: Array<{ role: 'user' | 'assistant'; content: string }> };
      if (!Array.isArray(messages) || messages.length === 0) {
        return res.status(400).json({ success: false, error: 'messages required' });
      }

      const aiCfgOrch = await getAIConfig();
      const apiKey = resolveActiveKey(aiCfgOrch);
      if (!apiKey) return res.json({ type: 'direct' });
      // No credits → let /ai/chat return its 402 rather than spending on routing
      if (!(await hasAICredits(auth.userId))) return res.json({ type: 'direct' });

      const lastUserMsg = [...messages].reverse().find((m) => m.role === 'user')?.content || '';
      const orchFastModel = aiCfgOrch.provider === 'google' ? resolveGeminiModel(aiCfgOrch.model) : FAST_MODEL;

      const orchSystemPrompt = `You are a routing assistant for a marketing AI team. Decide if a user message requires a coordinated multi-agent response from specialist agents (Nova=creative director, Sage=strategy analyst, Aria=analytics, Flux=automation) or can be handled directly by the main assistant.

Return ONLY valid JSON. No markdown fences, no explanation.

If single agent: {"type":"direct"}

If multi-agent (complex campaign, brand strategy, platform automation, multi-domain analysis): {"type":"plan","summary":"one sentence describing the overall task","agents":[{"key":"nova","name":"Nova","icon":"◉","color":"#EC4899","task":"what Nova should focus on"},{"key":"sage","name":"Sage","icon":"◈","color":"#10B981","task":"..."}]}

Rules:
- Include only genuinely relevant agents (2-4 max)
- Simple post requests, quick questions, single-domain tasks → direct
- Brand + strategy + analytics + automation tasks → plan`;

      const raw = await callAINonStreaming(aiCfgOrch.provider, apiKey, orchFastModel, orchSystemPrompt, `User request: "${lastUserMsg.slice(0, 600)}"`, 400);
      try {
        const parsed = JSON.parse(raw);
        if (parsed.type === 'plan' && Array.isArray(parsed.agents) && parsed.agents.length >= 2) {
          return res.json(parsed);
        }
      } catch (_err) { /* fall through */ }
      return res.json({ type: 'direct' });
    } catch (err) {
      logger.error('Unhandled error:', err);
      return res.json({ type: 'direct' });
    }
  });

  // ── POST /api/ai/execute-plan ──────────────────────────────────────────────
  router.post('/ai/execute-plan', async (req: Request, res: Response) => {
    try {
      const auth = requireAuth(req, res);
      if (!auth) return;

      const { messages, plan } = req.body as {
        messages: Array<{ role: 'user' | 'assistant'; content: string }>;
        plan: { summary: string; agents: Array<{ key: string; name: string; icon: string; color: string; task: string; enabled: boolean }> };
      };

      if (!Array.isArray(messages) || !plan?.agents) {
        return res.status(400).json({ success: false, error: 'messages and plan required' });
      }

      const aiCfg = await getAIConfig();
      const apiKey = resolveActiveKey(aiCfg);
      if (!apiKey) return res.status(503).json({ success: false, error: 'AI not configured' });
      if (!(await hasAICredits(auth.userId))) {
        return res.status(402).json({ success: false, error: OUT_OF_CREDITS_MSG });
      }

      res.setHeader('Content-Type', 'text/event-stream');
      res.setHeader('Cache-Control', 'no-cache');
      res.setHeader('Connection', 'keep-alive');
      const send = (data: object) => res.write(`data: ${JSON.stringify(data)}\n\n`);

      const enabledAgents = plan.agents.filter((a) => a.enabled);
      const conversationHistory = messages.slice(-10).map((m) => ({
        role: m.role as 'user' | 'assistant',
        content: String(m.content || '').slice(0, 3000),
      }));
      const lastUserMsg = [...messages].reverse().find((m) => m.role === 'user')?.content || '';

      let allMemory: any[] = [];
      if (pool) {
        const { rows } = await dbQuery(
          `SELECT category, title, content FROM user_memories WHERE user_id=$1 ORDER BY category, sort_order, created_at LIMIT 60`,
          [auth.userId]
        );
        allMemory = rows as any[];
      }

      const [{ rows: agentRows }, { rows: templateRows }] = await Promise.all([
        dbQuery(`SELECT agent_key, compiled_skill FROM user_agents WHERE user_id=$1`, [auth.userId]),
        dbQuery(`SELECT agent_key, base_prompt FROM agent_templates WHERE agent_key = ANY($1)`, [enabledAgents.map((a) => a.key)]),
      ]);
      const skillMap: Record<string, string> = {};
      for (const r of agentRows as any[]) skillMap[r.agent_key] = r.compiled_skill;
      const templateMap: Record<string, string> = {};
      for (const r of templateRows as any[]) templateMap[r.agent_key] = r.base_prompt;

      send({ type: 'agents_start', count: enabledAgents.length });
      const agentResults: Array<{ key: string; name: string; icon: string; color: string; task: string; analysis: string }> = [];

      const agentFastModel = aiCfg.provider === 'google' ? resolveGeminiModel(aiCfg.model) : FAST_MODEL;

      await Promise.all(enabledAgents.map(async (agent) => {
        send({ type: 'agent_start', key: agent.key, name: agent.name, icon: agent.icon, color: agent.color });
        try {
          const def = AGENT_DEFS[agent.key];
          const basePrompt = templateMap[agent.key] || (def ? `You are ${def.name}, ${def.role} on the Dakyworld Hub marketing team.` : `You are ${agent.name}.`);
          const skill = skillMap[agent.key] || '';
          const agentSystem = `${basePrompt}${skill ? `\n\nWhat you know about this user:\n${skill}` : ''}\n\nYour specific task: ${agent.task}\n\nGive a concise expert analysis (3-5 sentences or a brief bullet list). No intros or sign-offs. Pure insight.`;

          const analysis = await callAINonStreaming(aiCfg.provider, apiKey, agentFastModel, agentSystem, lastUserMsg.slice(0, 1000), 350);
          agentResults.push({ key: agent.key, name: agent.name, icon: agent.icon, color: agent.color, task: agent.task, analysis });
          send({ type: 'agent_done', key: agent.key, name: agent.name, icon: agent.icon, color: agent.color, analysis });
        } catch (err) {
          logger.error('Unhandled error:', err);
          send({ type: 'agent_done', key: agent.key, name: agent.name, icon: agent.icon, color: agent.color, analysis: '' });
        }
      }));

      send({ type: 'synthesis_start' });
      const userMemBlock = allMemory.length > 0
        ? '## ABOUT THIS USER\n' + allMemory.map((r: any) => `[${r.category}] ${r.title}: ${r.content}`).slice(0, 30).join('\n')
        : '## ABOUT THIS USER\nNo personalization data yet.';

      const teamContext = agentResults
        .filter((r) => r.analysis)
        .map((r) => `**${r.name}:** ${r.analysis}`)
        .join('\n\n');

      const synthSystem = `${AI_SYSTEM_PROMPT_DEFAULT.replace('{USER_MEMORY}', userMemBlock)}\n\n${AI_CORE_RULES}`;
      const synthPrompt = `${lastUserMsg}\n\n---\nYour specialist team has analyzed this:\n\n${teamContext}\n\nSynthesize their insights into one unified, decisive recommendation. Be the orchestrator — build on their analyses, don't just repeat them.`;

      if (aiCfg.provider === 'google') {
        const effectiveModel = resolveGeminiModel(aiCfg.model);
        const genAI = new GoogleGenerativeAI(apiKey);
        const gModel = genAI.getGenerativeModel({ model: effectiveModel, systemInstruction: synthSystem });
        const gStream = await gModel.generateContentStream(synthPrompt);
        for await (const chunk of gStream.stream) {
          const text = chunk.text();
          if (text) send({ type: 'text', text });
        }
      } else {
        const anthropicClient = new Anthropic({ apiKey });
        const synthMessages: Anthropic.MessageParam[] = [
          ...conversationHistory.slice(0, -1),
          { role: 'user', content: synthPrompt },
        ];
        const finalStream = await anthropicClient.messages.stream({
          model: aiCfg.model,
          max_tokens: 1024,
          system: synthSystem,
          messages: synthMessages,
        });
        for await (const chunk of finalStream) {
          if (chunk.type === 'content_block_delta' && chunk.delta.type === 'text_delta') {
            send({ type: 'text', text: chunk.delta.text });
          }
        }
      }

      send({ type: 'done' });
      const agentNames = enabledAgents.map((a: any) => a.name).join(', ');
      createNotification(auth.userId, 'plan_executed', 'Agent team finished', `Your marketing team (${agentNames}) completed their analysis.`, { agentCount: enabledAgents.length }).catch(() => undefined);
      res.end();
    } catch (e: any) {
      if (!res.headersSent) return res.status(500).json({ success: false, error: e?.message || 'Execute plan failed' });
      res.end();
    }
  });

  return router;
}
