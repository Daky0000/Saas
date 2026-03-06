import express from 'express';
import type { Request, Response } from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import axios from 'axios';
import jwt from 'jsonwebtoken';
import bcrypt from 'bcryptjs';
import { Pool } from 'pg';
import { randomUUID, randomBytes, createCipheriv, createDecipheriv, scryptSync } from 'crypto';

dotenv.config();

const WORDPRESS_ENCRYPTION_KEY = (() => {
  const raw = process.env.WORDPRESS_ENCRYPTION_KEY || process.env.JWT_SECRET || 'default-wp-key';
  return scryptSync(raw, 'salt', 32);
})();

const app = express();
const PORT = process.env.BACKEND_PORT || 5000;
const JWT_SECRET = process.env.JWT_SECRET || 'your-secret-key';
const DATABASE_URL = process.env.DATABASE_URL;
const extraOrigins = (process.env.FRONTEND_ORIGINS || '')
  .split(',')
  .map((origin) => origin.trim())
  .filter(Boolean);

const allowedOrigins = new Set([
  process.env.VITE_APP_URL || 'http://localhost:3000',
  'http://localhost:3000',
  'http://127.0.0.1:3000',
  'https://marketing.dakyworld.com',
  'https://daky0000.github.io',
  ...extraOrigins,
]);

const pool = DATABASE_URL ? new Pool({ connectionString: DATABASE_URL }) : null;

async function ensureDatabase() {
  if (!pool) {
    console.warn('DATABASE_URL is not set; running in in-memory mode.');
    return;
  }

  await pool.query(`
    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY,
      email TEXT UNIQUE NOT NULL,
      username TEXT,
      password_hash TEXT NOT NULL,
      full_name TEXT,
      phone TEXT,
      country TEXT,
      created_at TIMESTAMPTZ DEFAULT NOW()
    );
  `);

  await pool.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS username TEXT;`);
  await pool.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS phone TEXT;`);
  await pool.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS country TEXT;`);
  await pool.query(`
    CREATE UNIQUE INDEX IF NOT EXISTS users_username_unique_idx
    ON users (LOWER(username))
    WHERE username IS NOT NULL;
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS oauth_states (
      state TEXT PRIMARY KEY,
      user_id TEXT,
      platform TEXT NOT NULL,
      created_at TIMESTAMPTZ DEFAULT NOW(),
      expires_at TIMESTAMPTZ DEFAULT (NOW() + INTERVAL '15 minutes')
    );
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS social_accounts (
      id TEXT PRIMARY KEY,
      user_id TEXT REFERENCES users(id) ON DELETE CASCADE,
      platform TEXT NOT NULL,
      handle TEXT,
      followers INTEGER DEFAULT 0,
      connected BOOLEAN DEFAULT TRUE,
      connected_at TIMESTAMPTZ DEFAULT NOW(),
      expires_at TIMESTAMPTZ,
      access_token TEXT,
      refresh_token TEXT,
      token_data JSONB DEFAULT '{}'::jsonb,
      UNIQUE (user_id, platform)
    );
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS wordpress_connections (
      id TEXT PRIMARY KEY,
      user_id TEXT REFERENCES users(id) ON DELETE CASCADE,
      site_url TEXT NOT NULL,
      username TEXT NOT NULL,
      app_password_encrypted TEXT NOT NULL,
      created_at TIMESTAMPTZ DEFAULT NOW(),
      UNIQUE (user_id)
    );
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS make_webhook_connections (
      id TEXT PRIMARY KEY,
      user_id TEXT REFERENCES users(id) ON DELETE CASCADE,
      webhook_url_encrypted TEXT NOT NULL,
      created_at TIMESTAMPTZ DEFAULT NOW(),
      UNIQUE (user_id)
    );
  `);
}

ensureDatabase().catch((err) => {
  console.error('Database initialization failed:', err);
});

app.use(
  cors({
    origin: (origin, callback) => {
      if (!origin || allowedOrigins.has(origin)) {
        callback(null, true);
        return;
      }
      callback(new Error(`Origin not allowed by CORS: ${origin}`));
    },
    credentials: true,
  })
);
app.use(express.json());

// Types
interface OAuthState {
  platform: string;
  userId: string;
  code: string;
  state: string;
}

interface StoredConnection {
  id: string;
  userId: string;
  platform: string;
  handle: string;
  followers: string;
  connected: boolean;
  connectedAt: string;
  expiresAt?: string;
}

type DbUserRow = {
  id: string;
  email: string;
  username: string | null;
  full_name: string | null;
  phone: string | null;
  country: string | null;
  password_hash: string;
  created_at: string;
};

const inMemoryUsersById = new Map<string, DbUserRow>();
const inMemoryUserIdByEmail = new Map<string, string>();
const inMemoryUserIdByUsername = new Map<string, string>();

// Helpers
async function dbQuery<T = any>(sql: string, params: any[] = []) {
  if (!pool) {
    throw new Error('DATABASE_URL is not configured. Please set it to enable persistence.');
  }
  return pool.query<T>(sql, params);
}

function normalizeEmail(value: string) {
  return value.trim().toLowerCase();
}

function normalizeUsername(value: string) {
  return value.trim().toLowerCase();
}

function signToken(userId: string, email: string) {
  return jwt.sign({ userId, email }, JWT_SECRET, { expiresIn: '7d' });
}

function getAuthUser(req: Request) {
  const token = req.headers.authorization?.split(' ')[1];
  if (!token) return null;
  try {
    const decoded = jwt.verify(token, JWT_SECRET) as any;
    return { userId: decoded.userId as string, email: decoded.email as string };
  } catch {
    return null;
  }
}

async function findUserByEmail(email: string): Promise<DbUserRow | undefined> {
  const normalizedEmail = normalizeEmail(email);
  if (!pool) {
    const userId = inMemoryUserIdByEmail.get(normalizedEmail);
    return userId ? inMemoryUsersById.get(userId) : undefined;
  }
  const result = await dbQuery<DbUserRow>('SELECT * FROM users WHERE email = $1', [normalizedEmail]);
  return result.rows[0];
}

async function findUserByUsername(username: string): Promise<DbUserRow | undefined> {
  const normalizedUsername = normalizeUsername(username);
  if (!pool) {
    const userId = inMemoryUserIdByUsername.get(normalizedUsername);
    return userId ? inMemoryUsersById.get(userId) : undefined;
  }
  const result = await dbQuery<DbUserRow>('SELECT * FROM users WHERE LOWER(username) = $1', [normalizedUsername]);
  return result.rows[0];
}

async function findUserByIdentifier(identifier: string): Promise<DbUserRow | undefined> {
  const normalized = identifier.trim();
  if (!normalized) return undefined;
  if (normalized.includes('@')) {
    return findUserByEmail(normalized);
  }
  return findUserByUsername(normalized);
}

async function getUserById(id: string): Promise<DbUserRow | undefined> {
  if (!pool) {
    return inMemoryUsersById.get(id);
  }
  const result = await dbQuery<DbUserRow>('SELECT * FROM users WHERE id = $1', [id]);
  return result.rows[0];
}

async function createUser(
  name: string,
  username: string,
  email: string,
  password: string
): Promise<DbUserRow> {
  const hash = await bcrypt.hash(password, 10);
  const id = randomUUID();
  const normalizedEmail = normalizeEmail(email);
  const normalizedUsername = normalizeUsername(username);

  if (!pool) {
    const user: DbUserRow = {
      id,
      email: normalizedEmail,
      username: normalizedUsername,
      full_name: name || null,
      phone: null,
      country: null,
      password_hash: hash,
      created_at: new Date().toISOString(),
    };
    inMemoryUsersById.set(id, user);
    inMemoryUserIdByEmail.set(normalizedEmail, id);
    inMemoryUserIdByUsername.set(normalizedUsername, id);
    return user;
  }

  const result = await dbQuery<DbUserRow>(
    'INSERT INTO users (id, email, username, password_hash, full_name, phone, country) VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING *',
    [id, normalizedEmail, normalizedUsername, hash, name || null, null, null]
  );
  return result.rows[0];
}

async function updateUserProfile(
  userId: string,
  updates: { name: string; username: string; email: string; phone: string; country: string }
): Promise<DbUserRow | undefined> {
  const normalizedEmail = normalizeEmail(updates.email);
  const normalizedUsername = normalizeUsername(updates.username);
  const normalizedPhone = updates.phone.trim();
  const normalizedCountry = updates.country.trim();
  const normalizedName = updates.name.trim();

  if (!pool) {
    const existing = inMemoryUsersById.get(userId);
    if (!existing) return undefined;

    const byEmail = inMemoryUserIdByEmail.get(normalizedEmail);
    if (byEmail && byEmail !== userId) {
      throw new Error('Email is already in use');
    }
    const byUsername = inMemoryUserIdByUsername.get(normalizedUsername);
    if (byUsername && byUsername !== userId) {
      throw new Error('Username is already in use');
    }

    inMemoryUserIdByEmail.delete(normalizeEmail(existing.email));
    if (existing.username) {
      inMemoryUserIdByUsername.delete(normalizeUsername(existing.username));
    }

    const nextUser: DbUserRow = {
      ...existing,
      email: normalizedEmail,
      username: normalizedUsername,
      full_name: normalizedName || null,
      phone: normalizedPhone || null,
      country: normalizedCountry || null,
    };

    inMemoryUsersById.set(userId, nextUser);
    inMemoryUserIdByEmail.set(normalizedEmail, userId);
    inMemoryUserIdByUsername.set(normalizedUsername, userId);
    return nextUser;
  }

  const duplicateEmail = await dbQuery<{ id: string }>('SELECT id FROM users WHERE email = $1 AND id <> $2', [
    normalizedEmail,
    userId,
  ]);
  if (duplicateEmail.rowCount) {
    throw new Error('Email is already in use');
  }

  const duplicateUsername = await dbQuery<{ id: string }>(
    'SELECT id FROM users WHERE LOWER(username) = $1 AND id <> $2',
    [normalizedUsername, userId]
  );
  if (duplicateUsername.rowCount) {
    throw new Error('Username is already in use');
  }

  const result = await dbQuery<DbUserRow>(
    `
    UPDATE users
    SET email = $1,
        username = $2,
        full_name = $3,
        phone = $4,
        country = $5
    WHERE id = $6
    RETURNING *;
  `,
    [normalizedEmail, normalizedUsername, normalizedName || null, normalizedPhone || null, normalizedCountry || null, userId]
  );

  return result.rows[0];
}

function requireAuth(req: Request, res: Response): { userId: string; email?: string } | null {
  const auth = getAuthUser(req);
  if (!auth) {
    res.status(401).json({ success: false, error: 'Unauthorized' });
    return null;
  }
  return auth;
}

// Auth routes
app.post('/api/auth/register', async (req: Request, res: Response) => {
  try {
    const { email, password, name, username } = req.body;
    if (!email || !password || !name || !username) {
      return res
        .status(400)
        .json({ success: false, error: 'Name, username, email, and password are required' });
    }

    const existing = await findUserByEmail(email);
    if (existing) {
      return res.status(400).json({ success: false, error: 'Account already exists' });
    }

    const existingUsername = await findUserByUsername(username);
    if (existingUsername) {
      return res.status(400).json({ success: false, error: 'Username is already in use' });
    }

    const user = await createUser(name, username, email, password);
    const token = signToken(user.id, user.email);

    return res.json({
      success: true,
      token,
      user: {
        id: user.id,
        email: user.email,
        username: user.username,
        name: user.full_name,
        phone: user.phone,
        country: user.country,
      },
    });
  } catch (error) {
    console.error('Register error:', error);
    return res.status(500).json({ success: false, error: 'Registration failed' });
  }
});

app.post('/api/auth/login', async (req: Request, res: Response) => {
  try {
    const { identifier, email, password } = req.body;
    const loginIdentifier = (identifier || email || '').trim();
    if (!loginIdentifier || !password) {
      return res
        .status(400)
        .json({ success: false, error: 'Username or email and password are required' });
    }

    const user = await findUserByIdentifier(loginIdentifier);
    if (!user) {
      return res.status(400).json({ success: false, error: 'Invalid credentials' });
    }

    const valid = await bcrypt.compare(password, user.password_hash);
    if (!valid) {
      return res.status(400).json({ success: false, error: 'Invalid credentials' });
    }

    const token = signToken(user.id, user.email);
    return res.json({
      success: true,
      token,
      user: {
        id: user.id,
        email: user.email,
        username: user.username,
        name: user.full_name,
        phone: user.phone,
        country: user.country,
      },
    });
  } catch (error) {
    console.error('Login error:', error);
    return res.status(500).json({ success: false, error: 'Login failed' });
  }
});

app.get('/api/auth/me', async (req: Request, res: Response) => {
  try {
    const auth = requireAuth(req, res);
    if (!auth) return;

    const user = await getUserById(auth.userId);
    if (!user) {
      return res.status(404).json({ success: false, error: 'User not found' });
    }

    return res.json({
      success: true,
      user: {
        id: user.id,
        email: user.email,
        username: user.username,
        name: user.full_name,
        phone: user.phone,
        country: user.country,
      },
    });
  } catch (error) {
    console.error('Me error:', error);
    return res.status(500).json({ success: false, error: 'Failed to fetch user' });
  }
});

app.put('/api/auth/profile', async (req: Request, res: Response) => {
  try {
    const auth = requireAuth(req, res);
    if (!auth) return;

    const { name, username, email, phone, country } = req.body;
    if (!name || !username || !email) {
      return res.status(400).json({ success: false, error: 'Name, username, and email are required' });
    }

    const updated = await updateUserProfile(auth.userId, {
      name: String(name),
      username: String(username),
      email: String(email),
      phone: String(phone || ''),
      country: String(country || ''),
    });

    if (!updated) {
      return res.status(404).json({ success: false, error: 'User not found' });
    }

    return res.json({
      success: true,
      user: {
        id: updated.id,
        email: updated.email,
        username: updated.username,
        name: updated.full_name,
        phone: updated.phone,
        country: updated.country,
      },
    });
  } catch (error) {
    console.error('Profile update error:', error);
    const message = error instanceof Error ? error.message : 'Failed to update profile';
    const statusCode = message.includes('already in use') ? 400 : 500;
    return res.status(statusCode).json({ success: false, error: message });
  }
});

// OAuth state registration (for CSRF protection)
app.post('/api/oauth/state', async (req: Request, res: Response) => {
  try {
    const auth = requireAuth(req, res);
    if (!auth) return;

    const { state, platform } = req.body;
    if (!state || !platform) {
      return res.status(400).json({ success: false, error: 'Missing state or platform' });
    }

    if (!pool) {
      return res.status(503).json({ success: false, error: 'Database not configured' });
    }

    await dbQuery(
      `INSERT INTO oauth_states (state, user_id, platform, expires_at)
       VALUES ($1, $2, $3, NOW() + INTERVAL '15 minutes')
       ON CONFLICT (state) DO NOTHING`,
      [state, auth.userId, platform]
    );

    return res.json({ success: true });
  } catch (error) {
    console.error('OAuth state error:', error);
    return res.status(500).json({ success: false, error: 'Failed to store state' });
  }
});

// OAuth Handler for Instagram and others
app.post('/api/oauth/callback', async (req: Request, res: Response) => {
  try {
    const auth = requireAuth(req, res);
    if (!auth) return;

    const { platform, code, state } = req.body;

    if (!code || !state) {
      return res.status(400).json({ success: false, error: 'Missing code or state' });
    }

    const storedState = await getStoredState(state);
    if (!storedState) {
      return res.status(400).json({ success: false, error: 'Invalid state parameter' });
    }

    let tokenData;

    switch (platform) {
      case 'Instagram':
        tokenData = await exchangeInstagramCode(code);
        break;
      case 'Twitter':
        tokenData = await exchangeTwitterCode(code);
        break;
      case 'LinkedIn':
        tokenData = await exchangeLinkedInCode(code);
        break;
      case 'Facebook':
        tokenData = await exchangeFacebookCode(code);
        break;
      case 'TikTok':
        tokenData = await exchangeTikTokCode(code);
        break;
      default:
        return res.status(400).json({ success: false, error: 'Unsupported platform' });
    }

    await storeUserConnection(auth.userId, platform, tokenData);

    return res.json({ success: true, data: tokenData });
  } catch (error) {
    console.error('OAuth callback error:', error);
    return res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : 'OAuth callback failed',
    });
  }
});

// Get connected accounts
app.get('/api/accounts', async (req: Request, res: Response) => {
  try {
    const auth = requireAuth(req, res);
    if (!auth) return;

    const accounts = await getUserConnectedAccounts(auth.userId);
    return res.json({ success: true, data: accounts });
  } catch (error) {
    console.error('Accounts error:', error);
    return res.status(500).json({ success: false, error: 'Failed to fetch accounts' });
  }
});

// Disconnect account
app.delete('/api/accounts/:platform', async (req: Request, res: Response) => {
  try {
    const auth = requireAuth(req, res);
    if (!auth) return;

    const { platform } = req.params;
    await removeUserConnection(auth.userId, platform);
    return res.json({ success: true });
  } catch (error) {
    console.error('Disconnect error:', error);
    return res.status(500).json({ success: false, error: 'Failed to disconnect' });
  }
});

// Test connection
app.get('/api/accounts/:platform/test', async (req: Request, res: Response) => {
  try {
    const auth = requireAuth(req, res);
    if (!auth) return;

    const { platform } = req.params;
    const result = await testPlatformConnection(auth.userId, platform);
    return res.json({ success: true, data: result });
  } catch (error) {
    console.error('Test connection error:', error);
    return res.status(500).json({ success: false, error: 'Connection test failed' });
  }
});

// Publish post
app.post('/api/posts/:platform/publish', async (req: Request, res: Response) => {
  try {
    const auth = requireAuth(req, res);
    if (!auth) return;

    const { platform } = req.params;
    const { text, media, hashtags } = req.body;

    const result = await publishToPlatform(auth.userId, platform, {
      text,
      media,
      hashtags,
    });

    return res.json({ success: true, data: result });
  } catch (error) {
    console.error('Publish error:', error);
    return res.status(500).json({ success: false, error: 'Failed to publish post' });
  }
});

// Get analytics
app.get('/api/analytics/:platform', async (req: Request, res: Response) => {
  try {
    const auth = requireAuth(req, res);
    if (!auth) return;

    const { platform } = req.params;
    const analytics = await getPlatformAnalytics(auth.userId, platform);
    return res.json({ success: true, data: analytics });
  } catch (error) {
    console.error('Analytics error:', error);
    return res.status(500).json({ success: false, error: 'Failed to fetch analytics' });
  }
});

// OAuth Exchange Functions
async function exchangeInstagramCode(code: string) {
  const data = new URLSearchParams({
    client_id: process.env.VITE_INSTAGRAM_APP_ID || '',
    client_secret: process.env.INSTAGRAM_APP_SECRET || '',
    grant_type: 'authorization_code',
    redirect_uri: resolveRedirectUri(process.env.VITE_INSTAGRAM_REDIRECT_URI),
    code,
  });

  const response = await axios.post('https://api.instagram.com/oauth/access_token', data, {
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
  });
  return response.data;
}

async function exchangeTwitterCode(code: string) {
  const response = await axios.post('https://api.twitter.com/2/oauth2/token', {
    client_id: process.env.VITE_TWITTER_CLIENT_ID,
    client_secret: process.env.TWITTER_CLIENT_SECRET,
    code,
    grant_type: 'authorization_code',
    redirect_uri: process.env.VITE_TWITTER_REDIRECT_URI,
    code_verifier: 'challenge', // Add proper PKCE verification
  });
  return response.data;
}

async function exchangeLinkedInCode(code: string) {
  const response = await axios.post('https://www.linkedin.com/oauth/v2/accessToken', {
    grant_type: 'authorization_code',
    code,
    redirect_uri: process.env.VITE_LINKEDIN_REDIRECT_URI,
    client_id: process.env.VITE_LINKEDIN_CLIENT_ID,
    client_secret: process.env.LINKEDIN_CLIENT_SECRET,
  });
  return response.data;
}

async function exchangeFacebookCode(code: string) {
  const response = await axios.get('https://graph.facebook.com/v18.0/oauth/access_token', {
    params: {
      client_id: process.env.VITE_FACEBOOK_APP_ID,
      client_secret: process.env.FACEBOOK_APP_SECRET,
      redirect_uri: process.env.VITE_FACEBOOK_REDIRECT_URI,
      code,
    },
  });
  return response.data;
}

async function exchangeTikTokCode(code: string) {
  const response = await axios.post('https://open.tiktokapis.com/v2/oauth/token/', {
    client_key: process.env.VITE_TIKTOK_CLIENT_ID,
    client_secret: process.env.TIKTOK_CLIENT_SECRET,
    code,
    grant_type: 'authorization_code',
    redirect_uri: process.env.VITE_TIKTOK_REDIRECT_URI,
  });
  return response.data;
}

// Database/Storage Functions
async function getStoredState(state: string): Promise<boolean> {
  if (!pool) return true;
  const result = await dbQuery('SELECT 1 FROM oauth_states WHERE state = $1 AND expires_at > NOW()', [state]);
  return result.rowCount > 0;
}

async function storeUserConnection(userId: string, platform: string, tokenData: any): Promise<void> {
  if (!pool) {
    console.warn('DATABASE_URL not set; cannot persist social connection');
    return;
  }

  const handle =
    tokenData?.user_id || tokenData?.username || tokenData?.handle || `${platform.toLowerCase()}_account`;
  const followers = Number(tokenData?.followers || tokenData?.followers_count || 0);
  const expiresAt = tokenData?.expires_in
    ? new Date(Date.now() + Number(tokenData.expires_in) * 1000).toISOString()
    : null;

  await dbQuery(
    `
    INSERT INTO social_accounts
      (id, user_id, platform, handle, followers, connected, connected_at, expires_at, access_token, refresh_token, token_data)
    VALUES ($1, $2, $3, $4, $5, true, NOW(), $6, $7, $8, $9)
    ON CONFLICT (user_id, platform) DO UPDATE
      SET handle = EXCLUDED.handle,
          followers = EXCLUDED.followers,
          connected = true,
          connected_at = NOW(),
          expires_at = EXCLUDED.expires_at,
          access_token = EXCLUDED.access_token,
          refresh_token = EXCLUDED.refresh_token,
          token_data = EXCLUDED.token_data;
  `,
    [
      randomUUID(),
      userId,
      platform,
      String(handle),
      followers,
      expiresAt,
      tokenData?.access_token ?? tokenData?.accessToken ?? null,
      tokenData?.refresh_token ?? tokenData?.refreshToken ?? null,
      tokenData || {},
    ]
  );
}

async function getUserConnectedAccounts(userId: string): Promise<any[]> {
  if (!pool) return [];
  const result = await dbQuery(
    `
    SELECT
      id,
      user_id AS "userId",
      platform,
      handle,
      followers::text AS followers,
      connected,
      connected_at AS "connectedAt",
      expires_at AS "expiresAt"
    FROM social_accounts
    WHERE user_id = $1
    ORDER BY platform;
  `,
    [userId]
  );
  return result.rows;
}

async function removeUserConnection(userId: string, platform: string): Promise<void> {
  if (!pool) return;
  await dbQuery('DELETE FROM social_accounts WHERE user_id = $1 AND platform = $2', [userId, platform]);
}

async function testPlatformConnection(userId: string, platform: string): Promise<any> {
  // Implement testing connection
  return { status: 'ok', platform, userId };
}

async function publishToPlatform(userId: string, platform: string, content: any): Promise<any> {
  // Implement publishing to platform
  return { postId: 'test', platform, userId, content };
}

async function getPlatformAnalytics(userId: string, platform: string): Promise<any> {
  // Implement fetching analytics
  return { platform, followers: 0, engagement: 0, userId };
}

function resolveRedirectUri(uri: string | undefined): string {
  if (!uri) return '';
  if (uri.startsWith('http://') || uri.startsWith('https://')) return uri;
  const appUrl = process.env.VITE_APP_URL || 'http://localhost:3000';
  return `${appUrl}${uri}`;
}

// --- WordPress: encryption and storage (credentials never logged) ---
function encryptWordPressPassword(plain: string): string {
  const iv = randomBytes(16);
  const cipher = createCipheriv('aes-256-gcm', WORDPRESS_ENCRYPTION_KEY, iv);
  const enc = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
  const authTag = cipher.getAuthTag();
  return Buffer.concat([iv, authTag, enc]).toString('base64');
}

function decryptWordPressPassword(encrypted: string): string {
  const buf = Buffer.from(encrypted, 'base64');
  const iv = buf.subarray(0, 16);
  const authTag = buf.subarray(16, 32);
  const data = buf.subarray(32);
  const decipher = createDecipheriv('aes-256-gcm', WORDPRESS_ENCRYPTION_KEY, iv);
  decipher.setAuthTag(authTag);
  return decipher.update(data).toString('utf8') + decipher.final('utf8');
}

function normalizeWordPressSiteUrl(url: string): string {
  const u = url.trim().replace(/\/+$/, '');
  return u.startsWith('http') ? u : `https://${u}`;
}

interface WordPressConnection {
  id: string;
  userId: string;
  siteUrl: string;
  username: string;
  appPasswordEncrypted: string;
}

async function getWordPressConnection(userId: string): Promise<WordPressConnection | null> {
  if (!pool) return null;
  const result = await dbQuery<{
    id: string;
    user_id: string;
    site_url: string;
    username: string;
    app_password_encrypted: string;
  }>('SELECT id, user_id, site_url, username, app_password_encrypted FROM wordpress_connections WHERE user_id = $1', [
    userId,
  ]);
  const row = result.rows[0];
  if (!row) return null;
  return {
    id: row.id,
    userId: row.user_id,
    siteUrl: row.site_url,
    username: row.username,
    appPasswordEncrypted: row.app_password_encrypted,
  };
}

// --- Make webhook connection (store webhook URL encrypted; never log URL) ---
async function getMakeWebhookConnection(userId: string): Promise<{ webhookUrlEncrypted: string } | null> {
  if (!pool) return null;
  const result = await dbQuery<{ webhook_url_encrypted: string }>(
    'SELECT webhook_url_encrypted FROM make_webhook_connections WHERE user_id = $1',
    [userId]
  );
  const row = result.rows[0];
  return row ? { webhookUrlEncrypted: row.webhook_url_encrypted } : null;
}

function isValidWebhookUrl(url: string): boolean {
  const u = url.trim();
  return u.startsWith('https://') || u.startsWith('http://');
}

async function wpRequest(
  siteUrl: string,
  username: string,
  appPassword: string,
  method: string,
  path: string,
  options: { data?: any; formData?: FormData; responseType?: 'json' } = {}
): Promise<{ data?: any; status: number; error?: string }> {
  const base = normalizeWordPressSiteUrl(siteUrl);
  const url = `${base.replace(/\/+$/, '')}/wp-json${path.startsWith('/') ? path : `/${path}`}`;
  const auth = Buffer.from(`${username}:${appPassword}`, 'utf8').toString('base64');
  const headers: Record<string, string> = {
    Authorization: `Basic ${auth}`,
  };
  if (options.formData) {
    // Let axios set Content-Type for FormData
    try {
      const res = await axios.request({
        method,
        url,
        data: options.formData,
        headers: { ...headers, ...(options.formData.getHeaders?.() || {}) },
        maxRedirects: 2,
        validateStatus: () => true,
        maxBodyLength: Infinity,
        maxContentLength: Infinity,
      });
      return { data: res.data, status: res.status, error: res.status >= 400 ? (res.data?.message || res.statusText) : undefined };
    } catch (err: any) {
      const msg = err?.response?.data?.message || err?.message || 'Request failed';
      return { status: err?.response?.status || 500, error: msg };
    }
  }
  if (options.data !== undefined) headers['Content-Type'] = 'application/json';
  try {
    const res = await axios.request({
      method,
      url,
      data: options.data,
      headers,
      maxRedirects: 2,
      validateStatus: () => true,
    });
    const error = res.status >= 400 ? (res.data?.message || res.data?.code || res.statusText) : undefined;
    return { data: res.data, status: res.status, error };
  } catch (err: any) {
    const msg = err?.response?.data?.message || err?.message || 'Request failed';
    return { status: err?.response?.status || 500, error: msg };
  }
}

// POST /api/wordpress/connect — validate and store connection (tries Application Password first, then login password)
app.post('/api/wordpress/connect', async (req: Request, res: Response) => {
  try {
    const auth = requireAuth(req, res);
    if (!auth) return;

    const { siteUrl, username, applicationPassword, password } = req.body;
    if (!siteUrl || !username) {
      return res.status(400).json({ success: false, error: 'WordPress Site URL and Username are required' });
    }
    const hasAppPassword = applicationPassword && String(applicationPassword).trim();
    const hasLoginPassword = password && String(password).trim();
    if (!hasAppPassword && !hasLoginPassword) {
      return res.status(400).json({
        success: false,
        error: 'Provide either your WordPress login password or an Application Password (Users → Profile → Application Passwords).',
      });
    }

    const site = normalizeWordPressSiteUrl(siteUrl);
    let credentialToStore: string | undefined;
    let lastError: string | undefined;
    let lastStatus: number | undefined;

    // Try Application Password first (recommended)
    if (hasAppPassword) {
      const res = await wpRequest(site, username, String(applicationPassword).trim(), 'GET', '/wp/v2/users/me');
      lastStatus = res.status;
      if (res.status === 200 && res.data?.id) {
        credentialToStore = String(applicationPassword).trim();
      } else {
        lastError = res.error;
      }
    }

    // If Application Password failed or not provided, try login password (works with many hosts/plugins)
    if (credentialToStore === undefined && hasLoginPassword) {
      const res = await wpRequest(site, username, String(password).trim(), 'GET', '/wp/v2/users/me');
      lastStatus = res.status;
      if (res.status === 200 && res.data?.id) {
        credentialToStore = String(password).trim();
      } else {
        lastError = lastError || res.error;
      }
    }

    if (typeof credentialToStore === 'undefined') {
      const err = lastError ? String(lastError).toLowerCase() : '';
      const isNotFound = lastStatus === 404 || err.includes('not found');
      const isNotLoggedIn = err.includes('not currently logged in') || err.includes('not logged in') || err.includes('rest_forbidden');
      const urlHint = 'Use the full site URL only (e.g. https://yoursite.com), no trailing slash. If WordPress is in a subfolder use https://yoursite.com/folder.';
      let message: string;
      if (isNotFound) {
        message = `Site not found. ${urlHint}`;
      } else if (isNotLoggedIn) {
        message = 'WordPress REST API requires an Application Password, not your normal login password. In your WordPress admin go to Users → your profile → Application Passwords, create a new one, and paste it in the "Application Password" field above. Some hosts disable this; if you don’t see it, check your host’s docs or use a plugin that enables REST API auth.';
      } else {
        message = lastError || 'WordPress authentication failed. Try an Application Password (Users → Profile → Application Passwords).';
      }
      return res.status(400).json({ success: false, error: message });
    }

    if (!pool) {
      return res.status(503).json({ success: false, error: 'Database not configured' });
    }

    const encrypted = encryptWordPressPassword(credentialToStore);
    const id = randomUUID();
    await dbQuery(
      `INSERT INTO wordpress_connections (id, user_id, site_url, username, app_password_encrypted)
       VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (user_id) DO UPDATE
         SET site_url = EXCLUDED.site_url, username = EXCLUDED.username, app_password_encrypted = EXCLUDED.app_password_encrypted`,
      [id, auth.userId, site, username, encrypted]
    );

    return res.json({ success: true, message: 'WordPress Connected Successfully' });
  } catch (err) {
    if (err instanceof Error && !err.message.includes('password')) {
      console.error('WordPress connect error:', err.message);
    }
    return res.status(500).json({ success: false, error: 'Connection failed' });
  }
});

// GET /api/wordpress/status (checks Make webhook first, then direct WordPress API)
app.get('/api/wordpress/status', async (req: Request, res: Response) => {
  try {
    const auth = requireAuth(req, res);
    if (!auth) return;

    const webhookConn = await getMakeWebhookConnection(auth.userId);
    if (webhookConn) {
      return res.json({ success: true, connected: true, connectionType: 'make_webhook' });
    }
    const conn = await getWordPressConnection(auth.userId);
    if (!conn) {
      return res.json({ success: true, connected: false });
    }
    return res.json({ success: true, connected: true, connectionType: 'wordpress_api', siteUrl: conn.siteUrl });
  } catch (err) {
    console.error('WordPress status error:', err);
    return res.status(500).json({ success: false, error: 'Failed to get status' });
  }
});

// DELETE /api/wordpress/disconnect (removes both Make webhook and direct API connection)
app.delete('/api/wordpress/disconnect', async (req: Request, res: Response) => {
  try {
    const auth = requireAuth(req, res);
    if (!auth) return;

    if (!pool) {
      return res.json({ success: true });
    }
    await dbQuery('DELETE FROM make_webhook_connections WHERE user_id = $1', [auth.userId]);
    await dbQuery('DELETE FROM wordpress_connections WHERE user_id = $1', [auth.userId]);
    return res.json({ success: true });
  } catch (err) {
    console.error('WordPress disconnect error:', err);
    return res.status(500).json({ success: false, error: 'Failed to disconnect' });
  }
});

// POST /api/wordpress/connect-webhook — validate and store Make webhook URL
const MAKE_TEST_PAYLOAD = {
  title: 'Connection Test',
  content: 'This is a test post from the web app.',
  status: 'draft',
};

app.post('/api/wordpress/connect-webhook', async (req: Request, res: Response) => {
  try {
    const auth = requireAuth(req, res);
    if (!auth) return;

    const { webhookUrl } = req.body;
    const url = typeof webhookUrl === 'string' ? webhookUrl.trim() : '';
    if (!url || !isValidWebhookUrl(url)) {
      return res.status(400).json({ success: false, error: 'A valid webhook URL (https:// or http://) is required.' });
    }

    // Validate webhook by sending test request (do not log URL)
    let responseStatus: number;
    try {
      const axRes = await axios.post(url, MAKE_TEST_PAYLOAD, {
        headers: { 'Content-Type': 'application/json' },
        timeout: 15000,
        validateStatus: () => true,
      });
      responseStatus = axRes.status;
    } catch (err: any) {
      return res.status(400).json({
        success: false,
        error: err?.message || 'Webhook request failed. Check the URL and that your Make scenario is running.',
      });
    }

    if (responseStatus < 200 || responseStatus >= 300) {
      return res.status(400).json({
        success: false,
        error: 'Webhook did not respond successfully. Ensure your Make scenario is active and the webhook URL is correct.',
      });
    }

    if (!pool) {
      return res.status(503).json({ success: false, error: 'Database not configured' });
    }

    const encrypted = encryptWordPressPassword(url);
    const id = randomUUID();
    await dbQuery(
      `INSERT INTO make_webhook_connections (id, user_id, webhook_url_encrypted)
       VALUES ($1, $2, $3)
       ON CONFLICT (user_id) DO UPDATE SET webhook_url_encrypted = EXCLUDED.webhook_url_encrypted`,
      [id, auth.userId, encrypted]
    );

    return res.json({ success: true, message: 'WordPress (Make) connected successfully' });
  } catch (err) {
    if (err instanceof Error && !err.message.includes('webhook')) {
      console.error('Connect webhook error:', err.message);
    }
    return res.status(500).json({ success: false, error: 'Connection failed' });
  }
});

// DELETE /api/wordpress/disconnect-webhook
app.delete('/api/wordpress/disconnect-webhook', async (req: Request, res: Response) => {
  try {
    const auth = requireAuth(req, res);
    if (!auth) return;
    if (pool) await dbQuery('DELETE FROM make_webhook_connections WHERE user_id = $1', [auth.userId]);
    return res.json({ success: true });
  } catch (err) {
    return res.status(500).json({ success: false, error: 'Failed to disconnect' });
  }
});

// POST /api/wordpress/publish-webhook — send payload to stored Make webhook
app.post('/api/wordpress/publish-webhook', async (req: Request, res: Response) => {
  try {
    const auth = requireAuth(req, res);
    if (!auth) return;

    const webhookConn = await getMakeWebhookConnection(auth.userId);
    if (!webhookConn) {
      return res.status(400).json({ success: false, error: 'WordPress (Make webhook) not connected' });
    }

    const webhookUrl = decryptWordPressPassword(webhookConn.webhookUrlEncrypted);
    const raw = req.body;

    const payload: Record<string, unknown> = {};
    if (typeof raw.title === 'string') payload.title = raw.title;
    if (typeof raw.content === 'string') payload.content = raw.content;
    if (typeof raw.excerpt === 'string') payload.excerpt = raw.excerpt;
    if (raw.status === 'draft' || raw.status === 'publish') payload.status = raw.status;
    if (typeof raw.featured_image === 'string') payload.featured_image = raw.featured_image;
    if (Array.isArray(raw.categories)) payload.categories = raw.categories.filter((c: unknown) => typeof c === 'string');
    if (Array.isArray(raw.tags)) payload.tags = raw.tags.filter((t: unknown) => typeof t === 'string');

    if (!payload.title && !payload.content) {
      return res.status(400).json({ success: false, error: 'Title or content is required' });
    }

    const axiosRes = await axios.post(webhookUrl, payload, {
      headers: { 'Content-Type': 'application/json' },
      timeout: 30000,
      validateStatus: () => true,
    });

    if (axiosRes.status < 200 || axiosRes.status >= 300) {
      return res.status(502).json({
        success: false,
        error: 'Failed to publish to WordPress. Make scenario may have failed.',
      });
    }

    return res.json({ success: true, message: 'Post sent to WordPress successfully.' });
  } catch (err) {
    if (err instanceof Error && !err.message.includes('webhook')) {
      console.error('Publish webhook error:', err.message);
    }
    return res.status(500).json({ success: false, error: 'Failed to publish to WordPress.' });
  }
});

// GET /api/wordpress/categories
app.get('/api/wordpress/categories', async (req: Request, res: Response) => {
  try {
    const auth = requireAuth(req, res);
    if (!auth) return;

    const conn = await getWordPressConnection(auth.userId);
    if (!conn) {
      return res.status(400).json({ success: false, error: 'WordPress not connected' });
    }
    const appPassword = decryptWordPressPassword(conn.appPasswordEncrypted);
    const { data, status, error } = await wpRequest(conn.siteUrl, conn.username, appPassword, 'GET', '/wp/v2/categories?per_page=100');
    if (status !== 200) {
      return res.status(400).json({ success: false, error: error || 'Failed to fetch categories' });
    }
    return res.json({ success: true, data: Array.isArray(data) ? data : [] });
  } catch (err) {
    if (err instanceof Error && !err.message.includes('password')) {
      console.error('WordPress categories error:', err.message);
    }
    return res.status(500).json({ success: false, error: 'Failed to fetch categories' });
  }
});

// GET /api/wordpress/tags
app.get('/api/wordpress/tags', async (req: Request, res: Response) => {
  try {
    const auth = requireAuth(req, res);
    if (!auth) return;

    const conn = await getWordPressConnection(auth.userId);
    if (!conn) {
      return res.status(400).json({ success: false, error: 'WordPress not connected' });
    }
    const appPassword = decryptWordPressPassword(conn.appPasswordEncrypted);
    const { data, status, error } = await wpRequest(conn.siteUrl, conn.username, appPassword, 'GET', '/wp/v2/tags?per_page=100');
    if (status !== 200) {
      return res.status(400).json({ success: false, error: error || 'Failed to fetch tags' });
    }
    return res.json({ success: true, data: Array.isArray(data) ? data : [] });
  } catch (err) {
    if (err instanceof Error && !err.message.includes('password')) {
      console.error('WordPress tags error:', err.message);
    }
    return res.status(500).json({ success: false, error: 'Failed to fetch tags' });
  }
});

// POST /api/wordpress/publish — create post (optionally upload featured image, set meta)
app.post('/api/wordpress/publish', async (req: Request, res: Response) => {
  try {
    const auth = requireAuth(req, res);
    if (!auth) return;

    const conn = await getWordPressConnection(auth.userId);
    if (!conn) {
      return res.status(400).json({ success: false, error: 'WordPress not connected' });
    }
    const appPassword = decryptWordPressPassword(conn.appPasswordEncrypted);

    const {
      title,
      content,
      excerpt,
      slug,
      status,
      categories,
      tags,
      author,
      featuredImageBase64,
      featuredImageFilename,
      seoTitle,
      seoDescription,
      focusKeyword,
    } = req.body;

    if (!title && !content) {
      return res.status(400).json({ success: false, error: 'Title or content is required' });
    }

    let featuredMediaId: number | undefined;
    if (featuredImageBase64 && typeof featuredImageBase64 === 'string') {
      const base64 = featuredImageBase64.replace(/^data:image\/\w+;base64,/, '');
      let buffer: Buffer;
      try {
        buffer = Buffer.from(base64, 'base64');
      } catch {
        return res.status(400).json({ success: false, error: 'Invalid featured image data' });
      }
      const filename = featuredImageFilename && typeof featuredImageFilename === 'string'
        ? featuredImageFilename
        : 'featured.jpg';
      const FormData = (await import('form-data')).default;
      const form = new FormData();
      form.append('file', buffer, { filename, contentType: 'image/jpeg' });
      const { data: mediaData, status: mediaStatus, error: mediaError } = await wpRequest(
        conn.siteUrl,
        conn.username,
        appPassword,
        'POST',
        '/wp/v2/media',
        { formData: form as any }
      );
      if (mediaStatus !== 201 || !mediaData?.id) {
        return res.status(400).json({
          success: false,
          error: mediaError || 'Failed to upload featured image',
        });
      }
      featuredMediaId = mediaData.id;
    }

    const postPayload: Record<string, any> = {
      title: title || '',
      content: content || '',
      status: status === 'draft' ? 'draft' : 'publish',
    };
    if (excerpt !== undefined && excerpt !== '') postPayload.excerpt = excerpt;
    if (slug !== undefined && slug !== '') postPayload.slug = slug;
    if (Array.isArray(categories) && categories.length) postPayload.categories = categories;
    if (Array.isArray(tags) && tags.length) postPayload.tags = tags;
    if (author !== undefined && author !== '') postPayload.author = Number(author);
    if (featuredMediaId !== undefined) postPayload.featured_media = featuredMediaId;

    const { data: postData, status: postStatus, error: postError } = await wpRequest(
      conn.siteUrl,
      conn.username,
      appPassword,
      'POST',
      '/wp/v2/posts',
      { data: postPayload }
    );

    if (postStatus !== 201 && postStatus !== 200) {
      return res.status(400).json({ success: false, error: postError || 'Failed to create post' });
    }

    const postId = postData?.id;
    if (postId && (seoTitle || seoDescription || focusKeyword)) {
      const meta: Record<string, string> = {};
      if (seoTitle) {
        meta._yoast_wpseo_title = seoTitle;
        meta.rank_math_title = seoTitle;
      }
      if (seoDescription) {
        meta._yoast_wpseo_metadesc = seoDescription;
        meta.rank_math_description = seoDescription;
      }
      if (focusKeyword) {
        meta._yoast_wpseo_focuskw = focusKeyword;
        meta.rank_math_focus_keyword = focusKeyword;
      }
      await wpRequest(conn.siteUrl, conn.username, appPassword, 'POST', `/wp/v2/posts/${postId}`, {
        data: { meta },
      });
    }

    const isDraft = postPayload.status === 'draft';
    return res.json({
      success: true,
      message: isDraft ? 'Post Saved as Draft' : 'Post Published Successfully',
      data: { postId, link: postData?.link, status: postPayload.status },
    });
  } catch (err) {
    if (err instanceof Error && !err.message.includes('password')) {
      console.error('WordPress publish error:', err.message);
    }
    return res.status(500).json({ success: false, error: 'Failed to publish post' });
  }
});

// Health check
app.get('/health', (req: Request, res: Response) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// Root route
app.get('/', (req: Request, res: Response) => {
  res.json({ message: 'OAuth Backend Server Running', version: '1.0.0' });
});

// Start server
app.listen(PORT, () => {
  console.log(`OAuth server running on port ${PORT}`);
});

export default app;

