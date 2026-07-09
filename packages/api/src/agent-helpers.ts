import { pool, dbQuery } from './db.ts';
import { getAIConfig, decryptAIKey, resolveActiveKey, callAINonStreaming, GEMINI_MODELS, FAST_MODEL } from './ai-helpers.ts';

export const AGENT_DEFS: Record<string, { name: string; role: string; icon: string; color: string; memoryKeywords: string[] }> = {
  daky:             { name: 'Daky',    role: 'Content Writer',        icon: '✦', color: '#5B6CF9', memoryKeywords: [] },
  nova:             { name: 'Nova',    role: 'Creative Director',     icon: '◉', color: '#EC4899', memoryKeywords: ['brand','voice','visual','content','product','audience'] },
  sage:             { name: 'Sage',    role: 'Strategy Analyst',      icon: '◈', color: '#10B981', memoryKeywords: ['goal','competit','strategy','industry','market','target','campaign'] },
  aria:             { name: 'Aria',    role: 'Analytics & Perf.',     icon: '⊕', color: '#F59E0B', memoryKeywords: ['analytic','performance','kpi','metric','business'] },
  flux:             { name: 'Flux',    role: 'Automation',            icon: '⟳', color: '#8B5CF6', memoryKeywords: ['automat','workflow','platform','social','schedule'] },
  trend_research:   { name: 'Trend',   role: 'Trend Research',        icon: '◎', color: '#06B6D4', memoryKeywords: ['trend','viral','niche','topic','content','platform'] },
  audience_research:{ name: 'Persona', role: 'Audience Research',    icon: '◑', color: '#7C3AED', memoryKeywords: ['audience','persona','pain','objection','customer','demographic'] },
  seo_research:     { name: 'SEO',     role: 'SEO Keyword Research',  icon: '⊗', color: '#059669', memoryKeywords: ['seo','keyword','search','organic','traffic','content'] },
  hook_writing:     { name: 'Hook',    role: 'Hook Writing',          icon: '⚡', color: '#D97706', memoryKeywords: ['hook','headline','attention','opening','subject','ad'] },
  social_caption:   { name: 'Caption', role: 'Social Caption',        icon: '✎', color: '#DB2777', memoryKeywords: ['caption','social','instagram','tiktok','linkedin','hashtag'] },
  video_script:     { name: 'Script',  role: 'Video Script',          icon: '▶', color: '#DC2626', memoryKeywords: ['video','script','youtube','reels','tiktok','short','long'] },
  ad_copy:          { name: 'Ads',     role: 'Ad Copy',               icon: '◆', color: '#EA580C', memoryKeywords: ['ad','copy','meta','google','facebook','conversion','cta'] },
  thumbnail_design: { name: 'Thumb',   role: 'Thumbnail Design',      icon: '▣', color: '#9333EA', memoryKeywords: ['thumbnail','youtube','visual','design','creative','click'] },
  meta_ads:         { name: 'Meta',    role: 'Paid Social Manager',   icon: '⊛', color: '#1877F2', memoryKeywords: ['meta','facebook','instagram','paid','campaign','budget','roas'] },
};

export async function provisionUserAgents(userId: string): Promise<void> {
  if (!pool) return;
  for (const key of Object.keys(AGENT_DEFS)) {
    await dbQuery(
      `INSERT INTO user_agents (user_id, agent_key, compiled_skill) VALUES ($1, $2, '') ON CONFLICT (user_id, agent_key) DO NOTHING`,
      [userId, key]
    ).catch(() => undefined);
  }
}

export async function compileAgentSkill(userId: string, agentKey: string): Promise<void> {
  if (!pool) return;
  const def = AGENT_DEFS[agentKey];
  if (!def) return;
  try {
    const { encryptedKey } = await getAIConfig();
    const apiKey = (encryptedKey ? decryptAIKey(encryptedKey) : null) || process.env.ANTHROPIC_API_KEY || '';
    if (!apiKey) return;

    let memoryRows: any[] = [];
    if (def.memoryKeywords.length > 0) {
      const conditions = def.memoryKeywords.map((_, i) => `(category ILIKE $${i + 2} OR title ILIKE $${i + 2} OR content ILIKE $${i + 2})`).join(' OR ');
      const { rows } = await dbQuery(
        `SELECT category, title, content FROM user_memories WHERE user_id=$1 AND (${conditions}) ORDER BY category, sort_order, created_at LIMIT 30`,
        [userId, ...def.memoryKeywords.map((k) => `%${k}%`)]
      );
      memoryRows = rows;
    } else {
      const { rows } = await dbQuery(
        `SELECT category, title, content FROM user_memories WHERE user_id=$1 ORDER BY category, sort_order, created_at LIMIT 60`,
        [userId]
      );
      memoryRows = rows;
    }

    if (memoryRows.length === 0) {
      await dbQuery(`UPDATE user_agents SET compiled_skill='', last_compiled_at=NOW() WHERE user_id=$1 AND agent_key=$2`, [userId, agentKey]);
      return;
    }

    const memText = memoryRows.map((r: any) => `[${r.category}] ${r.title}: ${r.content}`).join('\n');
    const aiCfgCompile = await getAIConfig();
    const compileKey = resolveActiveKey(aiCfgCompile);
    const compileFastModel = aiCfgCompile.provider === 'google'
      ? (GEMINI_MODELS.includes(aiCfgCompile.model) ? aiCfgCompile.model : 'gemini-2.0-flash')
      : FAST_MODEL;
    const skill = await callAINonStreaming(
      aiCfgCompile.provider, compileKey, compileFastModel,
      `You are ${def.name} (${def.role}) on a marketing team.`,
      `Below is the user's brand/business memory. Write a concise 3-5 sentence "agent skill brief" summarizing what you know about this user that is most relevant to your specialty. Be specific and useful — this will be injected into your system prompt.\n\nUser memory:\n${memText}\n\nSkill brief:`,
      512,
      { userId, feature: 'agent_skill_compile' }
    );
    await dbQuery(`UPDATE user_agents SET compiled_skill=$1, last_compiled_at=NOW() WHERE user_id=$2 AND agent_key=$3`, [skill, userId, agentKey]);
  } catch (_err) { /* non-fatal */ }
}

export async function triggerAgentCompilation(userId: string): Promise<void> {
  for (const key of Object.keys(AGENT_DEFS)) {
    compileAgentSkill(userId, key).catch(() => undefined);
  }
}
