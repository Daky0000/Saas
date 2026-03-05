import express from 'express';
import type { Request, Response } from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import axios from 'axios';
import jwt from 'jsonwebtoken';
import bcrypt from 'bcryptjs';
import { Pool } from 'pg';
import { createCipheriv, createDecipheriv, createHash, randomBytes, randomUUID } from 'crypto';

dotenv.config();

const app = express();
const PORT = process.env.BACKEND_PORT || 5000;
const JWT_SECRET = process.env.JWT_SECRET || 'your-secret-key';
const WORDPRESS_CREDENTIALS_KEY = process.env.WORDPRESS_CREDENTIALS_KEY || JWT_SECRET;
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
      user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
      site_url TEXT NOT NULL,
      username TEXT NOT NULL,
      app_password_encrypted TEXT NOT NULL,
      wp_user_id INTEGER,
      wp_display_name TEXT,
      created_at TIMESTAMPTZ DEFAULT NOW(),
      updated_at TIMESTAMPTZ DEFAULT NOW()
    );
  `);

  await pool.query(`ALTER TABLE wordpress_connections ADD COLUMN IF NOT EXISTS site_url TEXT;`);
  await pool.query(`ALTER TABLE wordpress_connections ADD COLUMN IF NOT EXISTS username TEXT;`);
  await pool.query(`ALTER TABLE wordpress_connections ADD COLUMN IF NOT EXISTS app_password_encrypted TEXT;`);
  await pool.query(`ALTER TABLE wordpress_connections ADD COLUMN IF NOT EXISTS wp_user_id INTEGER;`);
  await pool.query(`ALTER TABLE wordpress_connections ADD COLUMN IF NOT EXISTS wp_display_name TEXT;`);
  await pool.query(`ALTER TABLE wordpress_connections ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ DEFAULT NOW();`);
  await pool.query(`ALTER TABLE wordpress_connections ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT NOW();`);
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
app.use(express.json({ limit: '20mb' }));

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

type WordPressConnectionRow = {
  user_id: string;
  site_url: string;
  username: string;
  app_password_encrypted: string;
  wp_user_id: number | null;
  wp_display_name: string | null;
  created_at: string;
  updated_at: string;
};

type WordPressConnectInput = {
  siteUrl: string;
  username: string;
  appPassword: string;
};

type WordPressTerm = {
  id: number;
  name: string;
  slug: string;
};

const inMemoryUsersById = new Map<string, DbUserRow>();
const inMemoryUserIdByEmail = new Map<string, string>();
const inMemoryUserIdByUsername = new Map<string, string>();
const inMemoryWordPressConnections = new Map<string, WordPressConnectionRow>();

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

function getWordPressEncryptionKey() {
  return createHash('sha256').update(WORDPRESS_CREDENTIALS_KEY).digest();
}

function encryptSecret(secret: string) {
  const key = getWordPressEncryptionKey();
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  const encrypted = Buffer.concat([cipher.update(secret, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `${iv.toString('base64')}.${tag.toString('base64')}.${encrypted.toString('base64')}`;
}

function decryptSecret(payload: string) {
  const parts = payload.split('.');
  if (parts.length !== 3) {
    throw new Error('Invalid encrypted payload');
  }
  const [ivBase64, tagBase64, encryptedBase64] = parts;
  const key = getWordPressEncryptionKey();
  const iv = Buffer.from(ivBase64, 'base64');
  const tag = Buffer.from(tagBase64, 'base64');
  const encrypted = Buffer.from(encryptedBase64, 'base64');
  const decipher = createDecipheriv('aes-256-gcm', key, iv);
  decipher.setAuthTag(tag);
  const decrypted = Buffer.concat([decipher.update(encrypted), decipher.final()]);
  return decrypted.toString('utf8');
}

function normalizeWordPressSiteUrl(value: string) {
  const trimmed = value.trim();
  if (!trimmed) {
    throw new Error('WordPress Site URL is required');
  }

  const withProtocol = /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
  const parsed = new URL(withProtocol);
  parsed.pathname = '';
  parsed.search = '';
  parsed.hash = '';
  return parsed.toString().replace(/\/$/, '');
}

function buildWordPressAuthHeader(username: string, appPassword: string) {
  const token = Buffer.from(`${username}:${appPassword}`, 'utf8').toString('base64');
  return `Basic ${token}`;
}

function wordPressApiBaseUrl(siteUrl: string) {
  return `${siteUrl}/wp-json/wp/v2`;
}

function parseAxiosError(error: unknown) {
  if (axios.isAxiosError(error)) {
    const status = error.response?.status;
    if (status === 401 || status === 403) {
      return 'Authentication failed. Check WordPress username and application password.';
    }
    if (status === 404) {
      return 'WordPress REST API endpoint was not found. Check the site URL.';
    }
    if (status === 400) {
      return 'WordPress rejected the request. Confirm your input values.';
    }
    return `WordPress API request failed${status ? ` (HTTP ${status})` : ''}.`;
  }
  return error instanceof Error ? error.message : 'Unexpected error';
}

function sanitizeWordPressConnection(row: WordPressConnectionRow) {
  return {
    connected: true,
    siteUrl: row.site_url,
    username: row.username,
    userId: row.wp_user_id,
    displayName: row.wp_display_name,
    connectedAt: row.created_at,
    updatedAt: row.updated_at,
  };
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

async function getWordPressConnection(userId: string): Promise<WordPressConnectionRow | undefined> {
  if (!pool) {
    return inMemoryWordPressConnections.get(userId);
  }
  const result = await dbQuery<WordPressConnectionRow>(
    'SELECT * FROM wordpress_connections WHERE user_id = $1',
    [userId]
  );
  return result.rows[0];
}

async function saveWordPressConnection(
  userId: string,
  input: { siteUrl: string; username: string; appPassword: string; wpUserId: number; wpDisplayName: string }
) {
  const encryptedPassword = encryptSecret(input.appPassword);
  const now = new Date().toISOString();

  if (!pool) {
    const existing = inMemoryWordPressConnections.get(userId);
    const row: WordPressConnectionRow = {
      user_id: userId,
      site_url: input.siteUrl,
      username: input.username,
      app_password_encrypted: encryptedPassword,
      wp_user_id: input.wpUserId,
      wp_display_name: input.wpDisplayName || null,
      created_at: existing?.created_at || now,
      updated_at: now,
    };
    inMemoryWordPressConnections.set(userId, row);
    return row;
  }

  const result = await dbQuery<WordPressConnectionRow>(
    `
      INSERT INTO wordpress_connections
        (user_id, site_url, username, app_password_encrypted, wp_user_id, wp_display_name, updated_at)
      VALUES ($1, $2, $3, $4, $5, $6, NOW())
      ON CONFLICT (user_id) DO UPDATE
      SET site_url = EXCLUDED.site_url,
          username = EXCLUDED.username,
          app_password_encrypted = EXCLUDED.app_password_encrypted,
          wp_user_id = EXCLUDED.wp_user_id,
          wp_display_name = EXCLUDED.wp_display_name,
          updated_at = NOW()
      RETURNING *;
    `,
    [userId, input.siteUrl, input.username, encryptedPassword, input.wpUserId, input.wpDisplayName || null]
  );

  return result.rows[0];
}

async function removeWordPressConnection(userId: string) {
  if (!pool) {
    inMemoryWordPressConnections.delete(userId);
    return;
  }
  await dbQuery('DELETE FROM wordpress_connections WHERE user_id = $1', [userId]);
}

async function validateWordPressConnection(input: WordPressConnectInput) {
  const siteUrl = normalizeWordPressSiteUrl(input.siteUrl);
  const username = input.username.trim();
  const appPassword = input.appPassword.trim();

  if (!username) {
    throw new Error('WordPress Username is required');
  }
  if (!appPassword) {
    throw new Error('WordPress Application Password is required');
  }

  const response = await axios.get(`${wordPressApiBaseUrl(siteUrl)}/users/me`, {
    headers: {
      Authorization: buildWordPressAuthHeader(username, appPassword),
    },
    timeout: 15000,
  });

  const user = response.data;
  if (!user || typeof user !== 'object' || !user.id) {
    throw new Error('WordPress returned an unexpected user response');
  }

  return {
    siteUrl,
    username,
    appPassword,
    wpUserId: Number(user.id),
    wpDisplayName: String(user.name || user.slug || username),
  };
}

async function getAuthenticatedWordPressConnection(userId: string) {
  const connection = await getWordPressConnection(userId);
  if (!connection) {
    throw new Error('WordPress is not connected');
  }

  const appPassword = decryptSecret(connection.app_password_encrypted);
  return {
    connection,
    authHeader: buildWordPressAuthHeader(connection.username, appPassword),
  };
}

async function fetchWordPressTerms(userId: string, type: 'categories' | 'tags'): Promise<WordPressTerm[]> {
  const { connection, authHeader } = await getAuthenticatedWordPressConnection(userId);
  const response = await axios.get(`${wordPressApiBaseUrl(connection.site_url)}/${type}`, {
    headers: { Authorization: authHeader },
    params: { per_page: 100, hide_empty: false },
    timeout: 15000,
  });

  const terms = Array.isArray(response.data) ? response.data : [];
  return terms.map((term: any) => ({
    id: Number(term.id),
    name: String(term.name || ''),
    slug: String(term.slug || ''),
  }));
}

function toArrayOfNumbers(value: unknown) {
  if (!Array.isArray(value)) return [];
  return value
    .map((item) => Number(item))
    .filter((item) => Number.isFinite(item) && item > 0);
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

// WordPress direct connection routes
app.post('/api/wordpress/connect', async (req: Request, res: Response) => {
  try {
    const auth = requireAuth(req, res);
    if (!auth) return;

    const { siteUrl, username, appPassword } = req.body as WordPressConnectInput;
    if (!siteUrl || !username || !appPassword) {
      return res.status(400).json({
        success: false,
        error: 'WordPress Site URL, WordPress Username, and Application Password are required',
      });
    }

    let validated;
    try {
      validated = await validateWordPressConnection({ siteUrl, username, appPassword });
    } catch (error) {
      return res.status(400).json({ success: false, error: parseAxiosError(error) });
    }

    const saved = await saveWordPressConnection(auth.userId, validated);

    return res.json({
      success: true,
      message: 'WordPress Connected Successfully',
      data: sanitizeWordPressConnection(saved),
    });
  } catch (error) {
    console.error('WordPress connect error:', error);
    return res.status(500).json({ success: false, error: 'Failed to connect WordPress' });
  }
});

app.get('/api/wordpress/status', async (req: Request, res: Response) => {
  try {
    const auth = requireAuth(req, res);
    if (!auth) return;

    const connection = await getWordPressConnection(auth.userId);
    if (!connection) {
      return res.json({ success: true, data: { connected: false } });
    }

    return res.json({ success: true, data: sanitizeWordPressConnection(connection) });
  } catch (error) {
    console.error('WordPress status error:', error);
    return res.status(500).json({ success: false, error: 'Failed to fetch WordPress status' });
  }
});

app.delete('/api/wordpress/disconnect', async (req: Request, res: Response) => {
  try {
    const auth = requireAuth(req, res);
    if (!auth) return;

    await removeWordPressConnection(auth.userId);
    return res.json({ success: true, message: 'WordPress disconnected' });
  } catch (error) {
    console.error('WordPress disconnect error:', error);
    return res.status(500).json({ success: false, error: 'Failed to disconnect WordPress' });
  }
});

app.get('/api/wordpress/categories', async (req: Request, res: Response) => {
  try {
    const auth = requireAuth(req, res);
    if (!auth) return;

    const categories = await fetchWordPressTerms(auth.userId, 'categories');
    return res.json({ success: true, data: categories });
  } catch (error) {
    const message = parseAxiosError(error);
    const statusCode = message.includes('not connected') ? 400 : 500;
    return res.status(statusCode).json({ success: false, error: message });
  }
});

app.get('/api/wordpress/tags', async (req: Request, res: Response) => {
  try {
    const auth = requireAuth(req, res);
    if (!auth) return;

    const tags = await fetchWordPressTerms(auth.userId, 'tags');
    return res.json({ success: true, data: tags });
  } catch (error) {
    const message = parseAxiosError(error);
    const statusCode = message.includes('not connected') ? 400 : 500;
    return res.status(statusCode).json({ success: false, error: message });
  }
});

app.post('/api/wordpress/publish', async (req: Request, res: Response) => {
  try {
    const auth = requireAuth(req, res);
    if (!auth) return;

    const {
      title,
      content,
      excerpt,
      slug,
      status,
      categories,
      tags,
      author,
      seoTitle,
      seoDescription,
      focusKeyword,
      featuredImage,
    } = req.body || {};

    if (!title || !content) {
      return res.status(400).json({ success: false, error: 'Post title and content are required' });
    }

    const desiredStatus = status === 'publish' ? 'publish' : 'draft';
    const { connection, authHeader } = await getAuthenticatedWordPressConnection(auth.userId);
    const headers = { Authorization: authHeader };
    const apiBase = wordPressApiBaseUrl(connection.site_url);
    let featuredMediaId: number | null = null;

    if (featuredImage && typeof featuredImage === 'object') {
      const fileName = String((featuredImage as any).fileName || 'featured-image.jpg').replace(/"/g, '');
      const mimeType = String((featuredImage as any).mimeType || 'image/jpeg');
      let dataBase64 = String((featuredImage as any).dataBase64 || '');
      dataBase64 = dataBase64.replace(/^data:[^;]+;base64,/, '');

      if (dataBase64) {
        const mediaBuffer = Buffer.from(dataBase64, 'base64');
        const mediaResponse = await axios.post(`${apiBase}/media`, mediaBuffer, {
          headers: {
            ...headers,
            'Content-Type': mimeType,
            'Content-Disposition': `attachment; filename="${fileName}"`,
          },
          timeout: 30000,
          maxBodyLength: Infinity,
          maxContentLength: Infinity,
        });
        if (mediaResponse.data?.id) {
          featuredMediaId = Number(mediaResponse.data.id);
        }
      }
    }

    const postMeta: Record<string, string> = {};
    if (typeof seoTitle === 'string' && seoTitle.trim()) {
      postMeta._yoast_wpseo_title = seoTitle.trim();
      postMeta.rank_math_title = seoTitle.trim();
    }
    if (typeof seoDescription === 'string' && seoDescription.trim()) {
      postMeta._yoast_wpseo_metadesc = seoDescription.trim();
      postMeta.rank_math_description = seoDescription.trim();
    }
    if (typeof focusKeyword === 'string' && focusKeyword.trim()) {
      postMeta._yoast_wpseo_focuskw = focusKeyword.trim();
      postMeta.rank_math_focus_keyword = focusKeyword.trim();
    }

    const authorId = Number(author);
    const payload: Record<string, any> = {
      title: String(title),
      content: String(content),
      excerpt: typeof excerpt === 'string' ? excerpt : '',
      slug: typeof slug === 'string' && slug.trim() ? slug.trim() : undefined,
      status: desiredStatus,
      categories: toArrayOfNumbers(categories),
      tags: toArrayOfNumbers(tags),
    };

    if (Number.isFinite(authorId) && authorId > 0) {
      payload.author = authorId;
    }
    if (featuredMediaId) {
      payload.featured_media = featuredMediaId;
    }
    if (Object.keys(postMeta).length > 0) {
      payload.meta = postMeta;
    }

    const postResponse = await axios.post(`${apiBase}/posts`, payload, {
      headers,
      timeout: 30000,
    });

    return res.json({
      success: true,
      message: desiredStatus === 'publish' ? 'Post Published Successfully' : 'Post Saved as Draft',
      data: {
        id: postResponse.data?.id,
        link: postResponse.data?.link,
        status: postResponse.data?.status,
        featuredMediaId,
      },
    });
  } catch (error) {
    const message = parseAxiosError(error);
    const statusCode = message.includes('not connected') ? 400 : 500;
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
      case 'WordPress':
        tokenData = await exchangeWordPressCode(code);
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
    const filteredAccounts = accounts.filter((account) => account.platform !== 'WordPress');
    const wordPressConnection = await getWordPressConnection(auth.userId);

    if (wordPressConnection) {
      filteredAccounts.push({
        id: `wordpress-${auth.userId}`,
        userId: auth.userId,
        platform: 'WordPress',
        handle: wordPressConnection.username,
        followers: '0',
        connected: true,
        connectedAt: wordPressConnection.created_at,
        expiresAt: null,
      });
    }

    return res.json({ success: true, data: filteredAccounts });
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
    if (platform === 'WordPress') {
      await removeWordPressConnection(auth.userId);
      return res.json({ success: true });
    }
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
    if (platform === 'WordPress') {
      const { connection, authHeader } = await getAuthenticatedWordPressConnection(auth.userId);
      const response = await axios.get(`${wordPressApiBaseUrl(connection.site_url)}/users/me`, {
        headers: { Authorization: authHeader },
        timeout: 15000,
      });
      return res.json({ success: true, data: { status: 'ok', platform, user: response.data } });
    }

    const result = await testPlatformConnection(auth.userId, platform);
    return res.json({ success: true, data: result });
  } catch (error) {
    const message = parseAxiosError(error);
    return res.status(500).json({ success: false, error: message });
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

async function exchangeWordPressCode(code: string) {
  const data = new URLSearchParams({
    client_id: process.env.VITE_WORDPRESS_CLIENT_ID || '',
    client_secret: process.env.WORDPRESS_CLIENT_SECRET || '',
    grant_type: 'authorization_code',
    redirect_uri: resolveRedirectUri(process.env.VITE_WORDPRESS_REDIRECT_URI),
    code,
  });

  const response = await axios.post('https://public-api.wordpress.com/oauth2/token', data, {
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
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

