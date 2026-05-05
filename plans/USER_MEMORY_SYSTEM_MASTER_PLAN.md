# User Memory System — Master Build Plan
**Project:** Dakyworld Hub — AI Context Engine  
**Feature:** User Memory  
**Version:** 1.0  
**Date:** 2026-05-05  

---

## 1. Vision & Purpose

Every user on the platform is different — different niche, audience, tone, goals, and content style. Without knowing who they are, the AI bot gives generic output that rarely fits.

The **Memory System** is a structured, editable knowledge base per user. It feeds every AI interaction — content generation, post suggestions, hashtag recommendations, scheduling advice — with real, user-specific context. The result: the AI behaves like a brand strategist who already knows the user, not a generic assistant.

---

## 2. Core Concepts

| Concept | Description |
|---|---|
| **Memory Field** | One unit of memory — a `title` and `content` pair |
| **Category** | Logical grouping of fields (Brand, Audience, etc.) |
| **Source** | How the memory was created: `manual`, `scraped`, `generated`, `inferred` |
| **Memory Context** | The compiled memory string injected into every AI prompt |
| **Health Score** | % of important fields filled — shown to motivate completion |

---

## 3. Memory Categories & Default Fields

Each category ships with pre-defined titles that the system tries to populate. Users can add unlimited custom fields on top.

### 3.1 Brand & Identity
| Title | Description | Auto-source |
|---|---|---|
| Brand Name | The business/personal brand name | Website scrape |
| Tagline | One-line brand statement | Website scrape |
| Mission Statement | What the brand stands for | Website scrape |
| Brand Voice | Tone of communication (casual, professional, bold, etc.) | AI-generated |
| Brand Colors | Primary visual colors (description or hex) | Manual |
| Brand Personality | 3–5 adjectives that describe the brand | AI-generated |

### 3.2 Business & Products
| Title | Description | Auto-source |
|---|---|---|
| Industry / Niche | Primary industry or sub-niche | Website + manual |
| Products / Services | What the business sells or offers | Website scrape |
| Unique Selling Proposition | What makes it different from competitors | AI-generated |
| Price Range | General pricing tier (budget, mid-range, premium) | Manual |
| Geographic Focus | Local, national, or global market | Manual |
| Business Stage | Startup, growing, established | Manual |

### 3.3 Target Audience
| Title | Description | Auto-source |
|---|---|---|
| Primary Audience Age | Age range of ideal customer | AI-generated |
| Primary Audience Gender | Gender breakdown (if relevant) | AI-generated |
| Audience Location | Where the audience is based | Manual |
| Audience Interests | Topics and hobbies the audience cares about | AI-generated |
| Audience Pain Points | Problems the audience wants solved | AI-generated |
| Audience Goals | What the audience wants to achieve | AI-generated |
| Customer Persona | Short description of the ideal customer | AI-generated |

### 3.4 Social Media Presence
| Title | Description | Auto-source |
|---|---|---|
| Instagram Handle | @username | Scraped / connected account |
| Instagram Followers | Follower count | Scraped |
| Instagram Content Style | Visual style + content type | Scraped |
| Facebook Page | Page name or URL | Scraped |
| LinkedIn Company | Company page URL | Scraped |
| Twitter/X Handle | @username | Scraped |
| TikTok Handle | @username | Scraped |
| Most Active Platform | Where they post most | Inferred |
| Best Performing Content | Topics/formats with highest engagement | Inferred |

### 3.5 Content Strategy
| Title | Description | Auto-source |
|---|---|---|
| Content Pillars | 3–5 main themes all content revolves around | AI-generated |
| Preferred Formats | Images, videos, carousels, threads, stories | Inferred |
| Posting Frequency | How often they post per platform | Inferred |
| Posting Schedule | Preferred days/times | Inferred |
| Content Goals | Awareness, engagement, lead gen, sales | AI-generated |
| Call to Action Style | How they typically close posts | Inferred |
| Hashtag Strategy | Niche hashtags used consistently | Scraped / inferred |

### 3.6 Website Intelligence
| Title | Description | Auto-source |
|---|---|---|
| Website URL | Primary domain | Manual |
| About Page Summary | What the website says about the brand | Website scrape |
| Key Offerings Listed | Products/services listed on site | Website scrape |
| Blog Topics | Categories or topics covered in blog | Website scrape |
| SEO Keywords | Keywords the site appears to target | Website scrape |

### 3.7 Competitors (Optional)
| Title | Description | Auto-source |
|---|---|---|
| Main Competitor 1 | Name + description | Manual |
| Main Competitor 2 | Name + description | Manual |
| Differentiator vs Competitors | How the user stands apart | AI-generated |

### 3.8 Platform Workflow (Inferred)
| Title | Description | Auto-source |
|---|---|---|
| Most Used Features | Which platform features they use most | Inferred |
| Automation Preferences | Types of automation they have set up | Inferred |
| Post History Themes | Recurring topics across all posts | Inferred |

---

## 4. Data Sources

### 4.1 Apify Scraping
Apify is the primary automated scraping engine. API key is stored in Admin → Integrations (same pattern as Hubtel/Stripe).

| Platform | Apify Actor | Data Extracted |
|---|---|---|
| Website | `apify/website-content-crawler` | About, services, blog, keywords |
| Instagram | `apify/instagram-profile-scraper` | Bio, followers, post themes, hashtags |
| Facebook | `apify/facebook-pages-scraper` | Page info, about, follower count |
| Twitter/X | `apify/twitter-scraper` | Bio, follower count, content themes |
| LinkedIn | `apify/linkedin-company-scraper` | Company description, industry |
| TikTok | `apify/tiktok-profile-scraper` | Bio, followers, video themes |

Scraping is triggered:
- When user first visits the Memory page (if no memories exist)
- When user clicks "Sync Data" button
- Manually per-platform with a "Re-scrape" button on each social field

### 4.2 Connected Social Accounts (Internal)
We already have `social_accounts` in our DB from OAuth connections. On memory creation, pull:
- Handle/username
- Follower count (from latest token refresh)
- Account bio

### 4.3 Post History Analysis (Internal)
Analyze the user's posts in our `posts` / `post_schedules` tables to infer:
- Most frequently used hashtags
- Most common posting times
- Content format breakdown (images vs video vs text)
- Topic clusters from post content using AI analysis

### 4.4 AI Generation (Wizard)
Multi-step wizard collects seed info from user → calls Claude API → generates all default memory fields in bulk.

### 4.5 Manual Input
User can always type directly into any field or add custom fields.

---

## 5. UI Design

### 5.1 Memory Page (`/memory`)

**Top bar:**
- Title: "Memory" + subtitle "What your AI knows about you"
- Memory Health Score (circular progress, e.g. "72% complete")
- Button: "Sync Data" (trigger re-scrape for connected platforms)
- Button: "Generate Memories" (opens wizard, prominent when health < 30%)

**Empty state (new users):**
- Illustration + headline: "Your AI doesn't know you yet"
- Sub-text: "Add your brand details so the AI can make personalized recommendations"
- Two CTA buttons: "Generate with AI" (primary) + "Add Manually" (secondary)

**Filled state:**
- Categories rendered as expandable cards/sections
- Each section header: category name + field count + "Add field" button (+ icon)
- Each memory field renders as:

```
┌─────────────────────────────────────────────┐
│ [source badge]  Brand Voice          ✏ 🗑  │
│ Conversational, witty, and educational.     │
│ Avoids corporate jargon. Speaks like a      │
│ smart friend who happens to know a lot.     │
│ Last synced: May 3, 2026                    │
└─────────────────────────────────────────────┘
```

Source badges:
- `scraped` → blue "Scraped" pill
- `manual` → slate "Manual" pill
- `generated` → violet "AI Generated" pill
- `inferred` → amber "Inferred" pill

**"Add new field" flow:**
Inline expansion below the last field in the section:
```
Title: [_______________]
Content: [_____________]
         [_____________]
         [Cancel] [Save]
```

**Scraping status:**
- Each social section shows last scraped timestamp
- Loading state per section during scrape

### 5.2 Generate Memories Wizard

A modal with a stepped progress bar. 5 steps:

**Step 1 — Your Brand**
- Brand/Business name (text)
- Industry or niche (text with suggestions dropdown)
- What do you sell or offer? (textarea)
- Website URL (text, optional)

**Step 2 — Your Audience**
- Who is your ideal customer? (textarea)
- Age range (range slider: 18–65+)
- Where are they based? (text)
- What problems do you solve for them? (textarea)

**Step 3 — Your Content Style**
- How would you describe your brand voice? (multi-select chips: Professional, Casual, Witty, Inspirational, Educational, Bold, Minimalist, Playful)
- What content formats do you use most? (multi-select: Images, Videos, Carousels, Stories, Threads, Text-only)
- How often do you post? (dropdown: Daily, 3–5x/week, Weekly, Occasionally)

**Step 4 — Your Goals**
- What are your main content goals? (multi-select: Brand Awareness, Drive Sales, Build Community, Get Leads, Educate Audience, Grow Followers)
- What topics do you want to be known for? (textarea)
- Who are your main competitors? (text, optional)

**Step 5 — Review & Generate**
- Summary of all inputs
- "Generate Memories" button → spinner → success state
- Shows count of memories created ("47 memories generated")

### 5.3 Memory Health Score

Calculated as: `(filled required fields / total required fields) * 100`

Required fields (weighted higher):
- Brand Name, Industry, Products/Services, Target Audience, Content Pillars, Brand Voice, Website URL

Displayed:
- Circular gauge in page header
- Color-coded: red (0–30%), amber (31–60%), green (61–100%)
- Tooltip breakdown by category

---

## 6. AI Integration — Memory as Context

### 6.1 Context String Format

```
=== USER BRAND MEMORY ===
[Brand & Identity]
Brand Name: Acme Studio
Tagline: Design tools for non-designers
Brand Voice: Casual, educational, friendly. Avoids jargon.
Industry: SaaS / Design Tools

[Target Audience]
Customer Persona: Freelancers and small business owners aged 25–40 who need professional graphics without design skills.
Audience Pain Points: No time to learn complex tools. Need results fast. Limited budget.

[Content Strategy]
Content Pillars: Design tips, customer success stories, product tutorials, industry trends
Posting Frequency: 5x per week
Best Performing Content: Carousel tutorials and before/after transformations

[Social Presence]
Most Active Platform: Instagram (42k followers)
Instagram Style: Clean, minimal aesthetics. Bright backgrounds. Sans-serif typography.
=== END MEMORY ===
```

### 6.2 Injection Points

Memory context is injected into:
1. **Content Generator** (`/api/ai/generate-post`) — prepended to system prompt
2. **AI Chat Bot** (existing chat widget) — prepended as system context
3. **Hashtag Recommender** — used to filter relevant hashtags
4. **Post Scheduling Advisor** — uses audience location + posting patterns
5. **Caption Rewriter** — uses brand voice to rewrite in correct tone
6. **AI Skills** (existing system) — each skill receives memory context

### 6.3 Memory Retrieval Strategy

Not all memory is relevant to every AI request. Use category filtering:
- Content generation → Brand, Content Strategy, Audience
- Hashtag suggestion → Social Presence, Content Pillars, Industry
- Scheduling advice → Workflow, Social Presence (posting frequency)
- Competitor analysis → Competitors, Business

---

## 7. Database Schema

```sql
-- Core memory fields
CREATE TABLE user_memories (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id       TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  category      TEXT NOT NULL,
    -- 'brand', 'business', 'audience', 'social', 'content', 'website', 'competitors', 'workflow', 'custom'
  title         TEXT NOT NULL,
  content       TEXT NOT NULL,
  source        TEXT NOT NULL DEFAULT 'manual',
    -- 'manual', 'scraped', 'generated', 'inferred'
  source_platform TEXT,
    -- 'instagram', 'facebook', 'website', etc. (when source = 'scraped')
  confidence    INT,
    -- 0–100 for scraped/inferred fields
  is_active     BOOLEAN NOT NULL DEFAULT true,
  is_pinned     BOOLEAN NOT NULL DEFAULT false,
  last_synced_at TIMESTAMPTZ,
  sort_order    INT NOT NULL DEFAULT 0,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX user_memories_user_id_idx ON user_memories (user_id);
CREATE INDEX user_memories_category_idx ON user_memories (user_id, category);

-- Scrape job tracking
CREATE TABLE user_memory_scrape_jobs (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id       TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  platform      TEXT NOT NULL,
    -- 'website', 'instagram', 'facebook', 'twitter', 'linkedin', 'tiktok'
  apify_run_id  TEXT,
  status        TEXT NOT NULL DEFAULT 'pending',
    -- 'pending', 'running', 'completed', 'failed'
  url           TEXT,
  result        JSONB,
  error_message TEXT,
  memories_created INT DEFAULT 0,
  started_at    TIMESTAMPTZ,
  completed_at  TIMESTAMPTZ,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX scrape_jobs_user_id_idx ON user_memory_scrape_jobs (user_id, status);

-- Memory generation sessions (from wizard)
CREATE TABLE user_memory_generations (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id       TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  wizard_input  JSONB NOT NULL,
  memories_created INT DEFAULT 0,
  status        TEXT NOT NULL DEFAULT 'pending',
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
```

---

## 8. API Routes

```
GET  /api/memory                    Get all active memories, grouped by category
POST /api/memory                    Create a manual memory field
PUT  /api/memory/:id                Update a memory field (content, title, sort_order)
DELETE /api/memory/:id              Delete a memory field
POST /api/memory/reorder            Reorder fields within a category (drag-drop)

POST /api/memory/scrape             Trigger Apify scrape for a URL/platform
GET  /api/memory/scrape/status      Get status of all pending scrape jobs for user

POST /api/memory/generate           Run Generate Memories wizard (AI-powered)

GET  /api/memory/context            Get compiled memory string for AI injection (internal use)
GET  /api/memory/health             Get health score breakdown by category

GET  /api/admin/memory/stats        Admin: memory completion rates, top categories, scrape volumes
```

### Route Payloads

**POST /api/memory**
```json
{ "category": "brand", "title": "Brand Voice", "content": "Casual and educational." }
```

**POST /api/memory/scrape**
```json
{ "platform": "website", "url": "https://acmestudio.com" }
// or
{ "platform": "instagram", "handle": "acmestudio" }
```

**POST /api/memory/generate**
```json
{
  "brandName": "Acme Studio",
  "industry": "Design Tools / SaaS",
  "offerings": "Drag-and-drop design software for non-designers",
  "websiteUrl": "https://acmestudio.com",
  "audienceDescription": "Freelancers aged 25–40 who need graphics fast",
  "ageRange": [25, 40],
  "audienceLocation": "US, UK, Canada",
  "painPoints": "Complex tools, no design skills, limited budget",
  "brandVoice": ["casual", "educational", "witty"],
  "contentFormats": ["images", "carousels", "stories"],
  "postingFrequency": "5x per week",
  "contentGoals": ["brand_awareness", "educate_audience"],
  "focusTopics": "Design tips, tutorials, before/after transformations",
  "competitors": "Canva, Adobe Express"
}
```

---

## 9. Apify Integration Setup

### 9.1 Admin Configuration
Apify API key is added via **Admin → Integrations** (following the same pattern as Stripe and Hubtel):
- Field: `apiKey` (password type)
- Docs URL: https://docs.apify.com/api/v2
- Test: ping `https://api.apify.com/v2/acts` with the key

### 9.2 Scrape Flow
```
User clicks "Sync Data"
  → POST /api/memory/scrape { platform, url }
    → Insert scrape_job row (status: 'pending')
    → Call Apify REST API to start actor run
    → Return { jobId, status: 'running' }

Frontend polls GET /api/memory/scrape/status every 5 seconds
  → Backend checks Apify run status via GET /api/apify/runs/:runId
  → When complete: extract data, parse into memory fields, upsert user_memories
  → Update job row (status: 'completed', memoriesCreated: N)
  → Frontend stops polling, refreshes memory list
```

### 9.3 Scrape-to-Memory Parsing

Each Apify actor returns different JSON. A parser function per platform normalizes the output into `{ title, content, category }` items:

**Website parser extracts:**
- About page text → `{ category: 'website', title: 'About Page Summary', content: ... }`
- Page titles → `{ category: 'business', title: 'Key Offerings Listed', content: ... }`
- Meta description → `{ category: 'brand', title: 'Tagline', content: ... }`
- Blog categories → `{ category: 'website', title: 'Blog Topics', content: ... }`

**Instagram parser extracts:**
- Bio → `{ category: 'brand', title: 'Instagram Bio', content: ... }`
- Follower count → `{ category: 'social', title: 'Instagram Followers', content: ... }`
- Top hashtags from recent posts → `{ category: 'content', title: 'Hashtag Strategy', content: ... }`
- Common topics from captions → `{ category: 'content', title: 'Instagram Content Themes', content: ... }`

---

## 10. Generate Memories — AI Prompt Design

```
System: You are a brand strategist AI. Given user-provided information about their brand, 
generate a comprehensive brand memory profile. Output ONLY valid JSON — an array of memory 
objects, each with: category, title, content.

Categories: brand, business, audience, social, content, competitors, custom

Populate every default field you can infer from the input. Where information is missing, 
make educated assumptions based on the industry. Mark assumed fields with "(estimated)".

User Input:
{wizardInput}

Output format:
[
  { "category": "brand", "title": "Brand Name", "content": "..." },
  { "category": "audience", "title": "Customer Persona", "content": "..." },
  ...
]
```

Use `claude-sonnet-4-6` with temperature 0.7. Expect 30–60 memory fields per generation.

---

## 11. Memory Health Score

```typescript
const REQUIRED_FIELDS = [
  { category: 'brand', title: 'Brand Name', weight: 10 },
  { category: 'brand', title: 'Brand Voice', weight: 10 },
  { category: 'business', title: 'Industry / Niche', weight: 8 },
  { category: 'business', title: 'Products / Services', weight: 8 },
  { category: 'audience', title: 'Customer Persona', weight: 8 },
  { category: 'audience', title: 'Audience Pain Points', weight: 6 },
  { category: 'content', title: 'Content Pillars', weight: 8 },
  { category: 'content', title: 'Content Goals', weight: 6 },
  { category: 'website', title: 'Website URL', weight: 6 },
  { category: 'social', title: 'Most Active Platform', weight: 5 },
];

// health = sum of weights for filled required fields / total possible weight * 100
```

Displayed per-category too:
- "Brand & Identity: 80%"
- "Target Audience: 40% — needs attention"

---

## 12. Memory Suggestions (Proactive AI)

After the user has been on the platform for 7+ days, the system periodically (weekly cron) runs an analysis job:

```
GET /api/memory/suggestions (internal cron)
```

This job:
1. Reads the user's post history from the last 30 days
2. Extracts recurring topics, hashtags, formats using a Claude API call
3. Compares against existing memory fields
4. Creates `suggested` memory entries (shown with a "Suggested" badge, not active)
5. User can accept (makes them active) or dismiss

This teaches the memory system without burdening the user.

---

## 13. Build Milestones

### Phase 1 — Manual Memory Foundation (Week 1–2)
- [ ] DB: `user_memories` table
- [ ] API: full CRUD routes (`/api/memory`)
- [ ] Frontend: Memory page with categories, field cards, edit/delete
- [ ] Frontend: "Add new field" inline flow
- [ ] Frontend: Empty state with Generate + Add Manually CTAs
- [ ] Wire memory context into existing Content Generator (`/api/ai/generate-post`)

### Phase 2 — Generate Memories Wizard (Week 2–3)
- [ ] DB: `user_memory_generations` table
- [ ] API: `POST /api/memory/generate` (Claude API call)
- [ ] Frontend: 5-step wizard modal
- [ ] Frontend: Success state showing count of generated memories
- [ ] Memory Health Score component + display in page header

### Phase 3 — Apify Scraping (Week 3–4)
- [ ] Admin → Integrations: Apify card (API key field)
- [ ] DB: `user_memory_scrape_jobs` table
- [ ] API: `POST /api/memory/scrape` + `GET /api/memory/scrape/status`
- [ ] Apify actor calls + result parsers (website, Instagram, Facebook, Twitter, LinkedIn, TikTok)
- [ ] Frontend: "Sync Data" button + per-section last-scraped timestamps
- [ ] Frontend: Scrape status polling + loading states per category
- [ ] Frontend: Source badges on each field (Scraped, Manual, Generated, Inferred)

### Phase 4 — Platform Inference (Week 5)
- [ ] Analyze post history → infer hashtags, formats, posting times
- [ ] Analyze connected social accounts → populate social memory fields
- [ ] Background job: runs on first login if memories < 5
- [ ] Memory suggestions (accepted/dismissed workflow)

### Phase 5 — Deep AI Integration (Week 6)
- [ ] Inject memory context into all AI endpoints (not just content generator)
- [ ] Category-aware context selection (only relevant categories per request)
- [ ] Weekly suggestion cron job
- [ ] Admin stats page for memory completeness rates

---

## 14. Admin Panel Additions

**Admin → Users:** Add "Memory" column showing health score per user  
**Admin → Memory Stats:** (new tab)
- Average health score across all users
- % of users with generated memories
- % of users with scraped memories
- Top scrape failure reasons
- Most commonly empty fields

---

## 15. Technical Notes

### Apify call pattern (backend)
```typescript
async function startApifyScrape(actorId: string, input: object): Promise<string> {
  const key = await getApifyKey(); // reads from platform_configs
  const r = await fetch(`https://api.apify.com/v2/acts/${actorId}/runs`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ input }),
  });
  const data = await r.json();
  return data.data.id; // Apify run ID
}

async function getApifyRunResult(runId: string): Promise<object[]> {
  const key = await getApifyKey();
  const r = await fetch(`https://api.apify.com/v2/actor-runs/${runId}/dataset/items`, {
    headers: { Authorization: `Bearer ${key}` },
  });
  return r.json();
}
```

### Memory context builder (shared util)
```typescript
async function buildMemoryContext(userId: string, categories?: string[]): Promise<string> {
  const where = categories ? `AND category = ANY($2)` : '';
  const params = categories ? [userId, categories] : [userId];
  const rows = await dbQuery(
    `SELECT category, title, content FROM user_memories 
     WHERE user_id = $1 AND is_active = true ${where}
     ORDER BY category, sort_order`,
    params
  );
  if (!rows.rows.length) return '';
  
  const grouped = groupBy(rows.rows, 'category');
  const lines = Object.entries(grouped).map(([cat, fields]) => {
    const header = `[${CATEGORY_LABELS[cat] ?? cat}]`;
    const body = fields.map(f => `${f.title}: ${f.content}`).join('\n');
    return `${header}\n${body}`;
  });

  return `=== USER BRAND MEMORY ===\n${lines.join('\n\n')}\n=== END MEMORY ===`;
}
```

### UX rules
- Never delete scraped memories silently — soft-delete only (`is_active = false`)
- When re-scraping, upsert by `(user_id, source_platform, title)` — don't create duplicates
- Show confidence indicators on scraped fields (100% = exact, 70% = inferred from context)
- Memory fields cap at 2000 characters each; content generator context cap at 4000 tokens total

---

## 16. Future Extensions (Post-MVP)

- **Team/Org Memory:** Shared memory at the organization level (owned by owner/admin), inherited by all members  
- **Memory Templates:** Industry-specific starter memory packs (e.g. "E-commerce brand", "Personal coach", "Restaurant")  
- **Memory Versioning:** History of changes per field — user can revert  
- **Memory Export:** Download full memory as JSON or formatted PDF brand guide  
- **Memory Import:** Upload a brand guide document (PDF) → AI extracts memory fields automatically  
- **Auto-refresh scraping:** Cron job re-scrapes connected platforms weekly to keep memory fresh  
- **Memory API (for users):** Let power users update memory via API key for external tool integrations  
- **Competitor Memory:** Separate tab to track competitor profiles (scraped separately from Apify)  

---

## 17. Related Plans
- `SUBSCRIPTION_BILLING_PORTAL_MASTER_PLAN.md` — Stripe billing  
- `SUBSCRIPTION_BILLING_QUICK_REFERENCE.md` — Billing quick ref  
- Workspace & Team System (committed to codebase, June 2025)  
