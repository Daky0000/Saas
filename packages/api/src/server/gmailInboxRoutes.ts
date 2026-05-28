import { Router, type Request, type Response } from 'express';
import axios from 'axios';
import type { Pool } from 'pg';
import { logger } from '../logger.ts';

// ── Types ─────────────────────────────────────────────────────────────────────

export interface GmailInboxDeps {
  requireAuth: (req: Request, res: Response) => { userId: string; role: string } | null;
  pool: Pool | null;
  getPlatformConfig: (platform: string) => Promise<Record<string, string>>;
  getAIConfig: () => Promise<any>;
  resolveActiveKey: (cfg: any) => string | null;
  GEMINI_MODELS: string[];
  callAINonStreaming: (provider: string, apiKey: string, model: string, system: string, user: string, maxTokens?: number) => Promise<string>;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function parseEmailHeader(raw: string): { name: string; email: string } {
  if (!raw) return { name: '', email: '' };
  const match = raw.match(/^(.*?)\s*<([^>]+)>$/);
  if (match) {
    return {
      name: match[1].trim().replace(/^["']|["']$/g, ''),
      email: match[2].trim().toLowerCase(),
    };
  }
  return { name: '', email: raw.trim().toLowerCase() };
}

function extractDomain(email: string): string {
  const at = email.indexOf('@');
  return at >= 0 ? email.slice(at + 1).toLowerCase() : '';
}

function domainToCompany(domain: string): string {
  if (!domain) return '';
  const knownPersonal: Record<string, string> = {
    'gmail.com': 'Gmail (Personal)', 'yahoo.com': 'Yahoo', 'outlook.com': 'Outlook',
    'hotmail.com': 'Hotmail', 'icloud.com': 'iCloud', 'me.com': 'Apple',
    'protonmail.com': 'ProtonMail', 'aol.com': 'AOL', 'live.com': 'Microsoft',
    'msn.com': 'Microsoft', 'googlemail.com': 'Gmail (Personal)',
  };
  if (knownPersonal[domain]) return knownPersonal[domain];
  const parts = domain.split('.');
  const name = parts.length >= 2 ? parts[parts.length - 2] : domain;
  return name.charAt(0).toUpperCase() + name.slice(1);
}

function base64urlDecode(str: string): string {
  try {
    return Buffer.from(str.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf-8');
  } catch {
    return '';
  }
}

function extractBodyText(payload: any, depth = 0): string {
  if (!payload || depth > 6) return '';
  if (payload.mimeType === 'text/plain' && payload.body?.data) return base64urlDecode(payload.body.data);
  if (payload.mimeType === 'text/html' && payload.body?.data) {
    // Strip HTML tags for plain-text representation
    const html = base64urlDecode(payload.body.data);
    return html.replace(/<[^>]+>/g, ' ').replace(/\s{2,}/g, ' ').trim();
  }
  if (Array.isArray(payload.parts)) {
    for (const part of payload.parts) {
      const text = extractBodyText(part, depth + 1);
      if (text) return text;
    }
  }
  return '';
}

// Refresh Gmail access token if within 5 minutes of expiry
async function getValidGmailToken(
  pool: Pool,
  userId: string,
  getPlatformConfig: (p: string) => Promise<Record<string, string>>
): Promise<string | null> {
  const res = await pool.query(
    `SELECT access_token, refresh_token, token_expires_at
     FROM social_accounts
     WHERE user_id=$1 AND LOWER(platform)='gmail' AND connected=true
     LIMIT 1`,
    [userId]
  );
  if (!res.rows.length) return null;

  const row = res.rows[0] as any;
  const accessToken = String(row.access_token || '').trim();
  const refreshToken = String(row.refresh_token || '').trim();
  const expiresAt = row.token_expires_at ? new Date(row.token_expires_at) : null;

  const needsRefresh = !expiresAt || expiresAt.getTime() < Date.now() + 5 * 60 * 1000;
  if (!needsRefresh || !refreshToken) return accessToken || null;

  const cfg = await getPlatformConfig('gmail');
  const clientId = String(cfg.clientId || '').trim();
  const clientSecret = String(cfg.clientSecret || '').trim();
  if (!clientId || !clientSecret) return accessToken || null;

  const params = new URLSearchParams({
    grant_type: 'refresh_token',
    refresh_token: refreshToken,
    client_id: clientId,
    client_secret: clientSecret,
  });

  const resp = await axios.post('https://oauth2.googleapis.com/token', params.toString(), {
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    validateStatus: () => true,
    timeout: 10000,
  });

  if (resp.status >= 400) return accessToken || null;

  const newToken = String((resp.data as any)?.access_token || '').trim();
  if (!newToken) return accessToken || null;

  const ttl = Number((resp.data as any)?.expires_in || 3600);
  await pool.query(
    `UPDATE social_accounts SET access_token=$1, token_expires_at=$2
     WHERE user_id=$3 AND LOWER(platform)='gmail'`,
    [newToken, new Date(Date.now() + ttl * 1000).toISOString(), userId]
  );
  return newToken;
}

// ── Background sync ───────────────────────────────────────────────────────────

async function runGmailSync(
  pool: Pool,
  userId: string,
  getPlatformConfig: (p: string) => Promise<Record<string, string>>
): Promise<void> {
  const GMAIL_API = 'https://gmail.googleapis.com/gmail/v1/users/me';
  const MAX_MESSAGES = 2000;
  const BATCH_CONCURRENCY = 10;

  try {
    await pool.query(
      `INSERT INTO gmail_sync_state(user_id, status, total_fetched, updated_at)
       VALUES($1,'running',0,NOW())
       ON CONFLICT(user_id) DO UPDATE SET status='running', total_fetched=0, error_message=NULL, updated_at=NOW()`,
      [userId]
    );

    const token = await getValidGmailToken(pool, userId, getPlatformConfig);
    if (!token) throw new Error('Gmail not connected or token expired. Please reconnect Gmail.');

    // ── Collect up to MAX_MESSAGES message IDs ─────────────────────────────
    const messageIds: string[] = [];
    let pageToken: string | undefined;

    while (messageIds.length < MAX_MESSAGES) {
      const params: Record<string, string> = { maxResults: '500' };
      if (pageToken) params.pageToken = pageToken;

      const listResp = await axios.get(`${GMAIL_API}/messages`, {
        headers: { Authorization: `Bearer ${token}` },
        params,
        validateStatus: () => true,
        timeout: 20000,
      });

      if (listResp.status === 401) throw new Error('Gmail access token expired. Please reconnect Gmail.');
      if (listResp.status >= 400) throw new Error(`Gmail API error ${listResp.status}`);

      const data = listResp.data as any;
      const msgs: Array<{ id: string }> = Array.isArray(data?.messages) ? data.messages : [];
      for (const m of msgs) {
        if (m?.id && messageIds.length < MAX_MESSAGES) messageIds.push(m.id);
      }

      pageToken = typeof data?.nextPageToken === 'string' ? data.nextPageToken : undefined;
      if (!pageToken || msgs.length === 0) break;
    }

    // ── Fetch metadata in parallel batches ────────────────────────────────
    let synced = 0;

    for (let i = 0; i < messageIds.length; i += BATCH_CONCURRENCY) {
      const batch = messageIds.slice(i, i + BATCH_CONCURRENCY);

      const results = await Promise.allSettled(
        batch.map((msgId) =>
          axios.get(`${GMAIL_API}/messages/${msgId}`, {
            headers: { Authorization: `Bearer ${token}` },
            params: {
              format: 'metadata',
              metadataHeaders: 'From,To,Subject,Date',
            },
            validateStatus: () => true,
            timeout: 10000,
          })
        )
      );

      const insertValues: any[][] = [];

      for (const result of results) {
        if (result.status === 'rejected') continue;
        const resp = result.value;
        if (resp.status >= 400) continue;

        const msg = resp.data as any;
        const headerMap: Record<string, string> = {};
        for (const h of (msg?.payload?.headers || [])) {
          headerMap[String(h.name || '').toLowerCase()] = String(h.value || '');
        }

        const fromParsed = parseEmailHeader(headerMap.from || '');
        const toParsed = parseEmailHeader(headerMap.to || '');
        const subject = (headerMap.subject || '(No subject)').slice(0, 500);
        const dateRaw = headerMap.date || '';
        const date = dateRaw ? new Date(dateRaw) : null;
        const validDate = date && !isNaN(date.getTime()) ? date.toISOString() : null;
        const isSent = Array.isArray(msg.labelIds) && (msg.labelIds as string[]).includes('SENT');
        const isRead = Array.isArray(msg.labelIds) && !(msg.labelIds as string[]).includes('UNREAD');
        const snippet = String(msg.snippet || '').slice(0, 500);

        insertValues.push([
          userId,
          String(msg.id || ''),
          String(msg.threadId || ''),
          subject,
          snippet,
          fromParsed.email.slice(0, 255),
          fromParsed.name.slice(0, 255),
          toParsed.email.slice(0, 255),
          validDate,
          isRead,
          isSent,
        ]);
      }

      // Bulk upsert
      for (const row of insertValues) {
        await pool.query(
          `INSERT INTO gmail_messages
             (user_id, gmail_message_id, gmail_thread_id, subject, snippet,
              from_email, from_name, to_email, date, is_read, is_sent, synced_at)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,NOW())
           ON CONFLICT(user_id, gmail_message_id) DO UPDATE SET
             snippet=EXCLUDED.snippet,
             is_read=EXCLUDED.is_read,
             is_sent=EXCLUDED.is_sent,
             synced_at=NOW()`,
          row
        ).catch(() => undefined);
        synced++;
      }

      // Update progress every batch
      await pool.query(
        `UPDATE gmail_sync_state SET total_fetched=$1, updated_at=NOW() WHERE user_id=$2`,
        [synced, userId]
      ).catch(() => undefined);
    }

    await pool.query(
      `UPDATE gmail_sync_state
       SET status='done', total_fetched=$1, last_synced_at=NOW(), error_message=NULL, updated_at=NOW()
       WHERE user_id=$2`,
      [synced, userId]
    );
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Sync failed';
    logger.error({ userId, err }, 'gmail_sync_error');
    await pool.query(
      `INSERT INTO gmail_sync_state(user_id, status, error_message, updated_at)
       VALUES($1,'error',$2,NOW())
       ON CONFLICT(user_id) DO UPDATE SET status='error', error_message=$2, updated_at=NOW()`,
      [userId, msg]
    ).catch(() => undefined);
  }
}

// ── Router ─────────────────────────────────────────────────────────────────────

export function registerGmailInboxRoutes(deps: GmailInboxDeps): Router {
  const { requireAuth, pool, getPlatformConfig } = deps;
  // AI helpers referenced directly via `deps` inside the AI summary route
  const router = Router();

  // POST /gmail/sync — start background sync
  router.post('/gmail/sync', async (req: Request, res: Response) => {
    const auth = requireAuth(req, res);
    if (!auth) return;
    if (!pool) return res.status(503).json({ success: false, error: 'DB not ready' });

    const stateRes = await pool.query(
      `SELECT status FROM gmail_sync_state WHERE user_id=$1`,
      [auth.userId]
    ).catch(() => ({ rows: [] as any[] }));

    if (stateRes.rows[0]?.status === 'running') {
      return res.json({ success: true, message: 'Sync already in progress' });
    }

    // Fire-and-forget
    void runGmailSync(pool, auth.userId, getPlatformConfig);
    return res.json({ success: true, message: 'Sync started' });
  });

  // GET /gmail/sync/status
  router.get('/gmail/sync/status', async (req: Request, res: Response) => {
    const auth = requireAuth(req, res);
    if (!auth) return;
    if (!pool) return res.json({ success: true, status: 'idle', totalFetched: 0 });

    const result = await pool.query(
      `SELECT status, total_fetched, last_synced_at, error_message
       FROM gmail_sync_state WHERE user_id=$1`,
      [auth.userId]
    ).catch(() => ({ rows: [] as any[] }));

    if (!result.rows.length) {
      return res.json({ success: true, status: 'idle', totalFetched: 0, lastSyncedAt: null, errorMessage: null });
    }
    const row = result.rows[0] as any;
    return res.json({
      success: true,
      status: String(row.status || 'idle'),
      totalFetched: Number(row.total_fetched || 0),
      lastSyncedAt: row.last_synced_at || null,
      errorMessage: row.error_message || null,
    });
  });

  // GET /gmail/chats — list contacts grouped as chats
  router.get('/gmail/chats', async (req: Request, res: Response) => {
    const auth = requireAuth(req, res);
    if (!auth) return;
    if (!pool) return res.json({ success: true, chats: [] });

    const result = await pool.query(
      `SELECT
         CASE WHEN is_sent THEN to_email ELSE from_email END AS contact_email,
         MAX(CASE WHEN NOT is_sent AND from_name <> '' THEN from_name END) AS contact_name,
         COUNT(*)::int AS message_count,
         SUM(CASE WHEN NOT is_read AND NOT is_sent THEN 1 ELSE 0 END)::int AS unread_count,
         MAX(date) AS last_message_at,
         (array_agg(snippet ORDER BY date DESC NULLS LAST))[1] AS last_snippet,
         (array_agg(subject ORDER BY date DESC NULLS LAST))[1] AS last_subject
       FROM gmail_messages
       WHERE user_id=$1
         AND TRIM(CASE WHEN is_sent THEN to_email ELSE from_email END) <> ''
       GROUP BY (CASE WHEN is_sent THEN to_email ELSE from_email END)
       ORDER BY MAX(date) DESC NULLS LAST
       LIMIT 500`,
      [auth.userId]
    ).catch(() => ({ rows: [] as any[] }));

    const chats = (result.rows as any[]).map((row) => {
      const email = String(row.contact_email || '').toLowerCase().trim();
      const domain = extractDomain(email);
      const company = domainToCompany(domain);
      const storedName = String(row.contact_name || '').trim();
      const name = storedName || company || (email.split('@')[0] ?? email);
      return {
        email,
        name,
        company,
        domain,
        messageCount: Number(row.message_count || 0),
        unreadCount: Number(row.unread_count || 0),
        lastMessageAt: row.last_message_at || null,
        lastSnippet: String(row.last_snippet || ''),
        lastSubject: String(row.last_subject || ''),
      };
    });

    return res.json({ success: true, chats });
  });

  // GET /gmail/chats/:email/messages — all messages in a conversation
  router.get('/gmail/chats/:email/messages', async (req: Request, res: Response) => {
    const auth = requireAuth(req, res);
    if (!auth) return;
    if (!pool) return res.json({ success: true, messages: [] });

    const contactEmail = decodeURIComponent(req.params.email).toLowerCase().trim();

    const result = await pool.query(
      `SELECT gmail_message_id, gmail_thread_id, subject, snippet,
              from_email, from_name, to_email, date, is_read, is_sent, body_text
       FROM gmail_messages
       WHERE user_id=$1
         AND (
           (NOT is_sent AND LOWER(from_email)=$2)
           OR (is_sent AND LOWER(to_email)=$2)
         )
       ORDER BY date ASC NULLS LAST`,
      [auth.userId, contactEmail]
    ).catch(() => ({ rows: [] as any[] }));

    return res.json({
      success: true,
      messages: (result.rows as any[]).map((r) => ({
        id: String(r.gmail_message_id),
        threadId: String(r.gmail_thread_id || ''),
        subject: String(r.subject || ''),
        snippet: String(r.snippet || ''),
        fromEmail: String(r.from_email || ''),
        fromName: String(r.from_name || ''),
        toEmail: String(r.to_email || ''),
        date: r.date ? String(r.date) : null,
        isRead: Boolean(r.is_read),
        isSent: Boolean(r.is_sent),
        bodyText: r.body_text ? String(r.body_text) : null,
      })),
    });
  });

  // GET /gmail/messages/:id/body — fetch full body from Gmail API
  router.get('/gmail/messages/:id/body', async (req: Request, res: Response) => {
    const auth = requireAuth(req, res);
    if (!auth) return;
    if (!pool) return res.status(503).json({ success: false, error: 'DB not ready' });

    const gmailMessageId = req.params.id;

    // Return cached body if available
    const existing = await pool.query(
      `SELECT body_text FROM gmail_messages WHERE user_id=$1 AND gmail_message_id=$2`,
      [auth.userId, gmailMessageId]
    ).catch(() => ({ rows: [] as any[] }));

    if (existing.rows.length && existing.rows[0].body_text) {
      return res.json({ success: true, body: String(existing.rows[0].body_text), cached: true });
    }

    const token = await getValidGmailToken(pool, auth.userId, getPlatformConfig);
    if (!token) return res.status(401).json({ success: false, error: 'Gmail not connected' });

    const resp = await axios.get(
      `https://gmail.googleapis.com/gmail/v1/users/me/messages/${encodeURIComponent(gmailMessageId)}`,
      {
        headers: { Authorization: `Bearer ${token}` },
        params: { format: 'full' },
        validateStatus: () => true,
        timeout: 20000,
      }
    );

    if (resp.status >= 400) {
      return res.status(resp.status < 500 ? resp.status : 502).json({ success: false, error: 'Failed to fetch message from Gmail' });
    }

    const bodyText = extractBodyText((resp.data as any)?.payload);

    await pool.query(
      `UPDATE gmail_messages SET body_text=$1 WHERE user_id=$2 AND gmail_message_id=$3`,
      [bodyText, auth.userId, gmailMessageId]
    ).catch(() => undefined);

    return res.json({ success: true, body: bodyText, cached: false });
  });

  // POST /gmail/contacts/:email/ai-summary — generate AI summary of conversation
  router.post('/gmail/contacts/:email/ai-summary', async (req: Request, res: Response) => {
    const auth = requireAuth(req, res);
    if (!auth) return;
    if (!pool) return res.status(503).json({ success: false, error: 'DB not ready' });

    const contactEmail = decodeURIComponent(req.params.email).toLowerCase().trim();

    // Fetch recent messages (up to 20 for context)
    const result = await pool.query(
      `SELECT subject, snippet, from_name, from_email, to_email, date, is_sent
       FROM gmail_messages
       WHERE user_id=$1
         AND ((NOT is_sent AND LOWER(from_email)=$2) OR (is_sent AND LOWER(to_email)=$2))
       ORDER BY date DESC NULLS LAST
       LIMIT 20`,
      [auth.userId, contactEmail]
    ).catch(() => ({ rows: [] as any[] }));

    if (!result.rows.length) {
      return res.json({ success: true, summary: 'No emails found for this contact.' });
    }

    const aiCfg = await deps.getAIConfig().catch(() => null);
    const key = aiCfg ? deps.resolveActiveKey(aiCfg) : null;
    if (!key) return res.json({ success: true, summary: 'AI not configured — add an OpenAI or Gemini API key in Admin → AI Config.' });

    const provider = String(aiCfg?.activeProvider || aiCfg?.provider || 'openai').toLowerCase();
    const isGemini = deps.GEMINI_MODELS.some((m: string) => String(aiCfg?.model || '').includes(m)) || provider.includes('gemini');
    const model = isGemini ? (aiCfg?.model || 'gemini-1.5-flash') : (aiCfg?.model || 'gpt-4o-mini');

    const messagesText = (result.rows as any[]).reverse().map((m) => {
      const direction = m.is_sent ? 'Sent' : 'Received';
      const date = m.date ? new Date(m.date).toLocaleDateString() : 'Unknown date';
      return `[${date}] ${direction} — Subject: "${m.subject}" — ${m.snippet}`;
    }).join('\n');

    const contactName = (result.rows as any[]).find((r) => !r.is_sent)?.from_name || contactEmail.split('@')[0];
    const domain = extractDomain(contactEmail);
    const company = domainToCompany(domain);

    const systemPrompt = `You are an AI assistant that summarizes email conversations to help sales and marketing professionals understand their relationship with a contact. Be concise, professional, and highlight key topics, action items, and relationship status. Write 2-4 sentences max.`;
    const userPrompt = `Summarize the email conversation with ${contactName} from ${company} (${contactEmail}):\n\n${messagesText}`;

    try {
      const summary = await deps.callAINonStreaming(provider, key, model, systemPrompt, userPrompt, 300);
      return res.json({ success: true, summary: summary.trim() });
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'AI summary failed';
      return res.status(500).json({ success: false, error: msg });
    }
  });

  // DELETE /gmail/messages — clear all synced data for the current user
  router.delete('/gmail/messages', async (req: Request, res: Response) => {
    const auth = requireAuth(req, res);
    if (!auth) return;
    if (!pool) return res.status(503).json({ success: false, error: 'DB not ready' });

    await pool.query(`DELETE FROM gmail_messages WHERE user_id=$1`, [auth.userId]);
    await pool.query(`DELETE FROM gmail_sync_state WHERE user_id=$1`, [auth.userId]);
    return res.json({ success: true });
  });

  return router;
}
