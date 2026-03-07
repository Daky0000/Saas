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
let dbReady = false;

function hasDatabase() {
  return Boolean(pool && dbReady);
}

async function ensureDatabase() {
  if (!pool) {
    console.warn('DATABASE_URL is not set; running in in-memory mode.');
    dbReady = false;
    seedInMemoryUsers();
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
  await pool.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS role TEXT NOT NULL DEFAULT 'user';`);
  await pool.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'active';`);
  await pool.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS avatar_url TEXT;`);
  await pool.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS cover_url TEXT;`);
  await pool.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS last_login_at TIMESTAMPTZ;`);
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

  await pool.query(`
    CREATE TABLE IF NOT EXISTS pricing_plans (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      description TEXT NOT NULL,
      price DECIMAL(10, 2) NOT NULL,
      billing_period TEXT NOT NULL DEFAULT 'monthly',
      features TEXT[] DEFAULT '{}',
      is_active BOOLEAN DEFAULT TRUE,
      created_at TIMESTAMPTZ DEFAULT NOW(),
      updated_at TIMESTAMPTZ DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS card_templates (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      description TEXT,
      design_data JSON NOT NULL,
      cover_image_url TEXT,
      is_published BOOLEAN DEFAULT FALSE,
      created_at TIMESTAMPTZ DEFAULT NOW(),
      updated_at TIMESTAMPTZ DEFAULT NOW()
    );
  `);

  dbReady = true;
}

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
  role: string;
  status: string;
  avatar_url: string | null;
  cover_url: string | null;
  last_login_at: string | null;
  password_hash: string;
  created_at: string;
};

type AdminDbRole = 'admin' | 'user';
type AdminDbStatus = 'active' | 'suspended' | 'pending' | 'banned';

type DbPricingPlan = {
  id: string;
  name: string;
  description: string;
  price: number;
  billing_period: 'monthly' | 'yearly';
  features: string[];
  is_active: boolean;
  created_at: string;
  updated_at: string;
};

type DbCardTemplate = {
  id: string;
  name: string;
  description?: string;
  design_data: any;
  cover_image_url?: string;
  is_published: boolean;
  created_at: string;
  updated_at: string;
};

const inMemoryUsersById = new Map<string, DbUserRow>();
const inMemoryUserIdByEmail = new Map<string, string>();
const inMemoryUserIdByUsername = new Map<string, string>();
const inMemoryPricingPlansById = new Map<string, DbPricingPlan>();
const inMemoryCardTemplatesById = new Map<string, DbCardTemplate>();

function upsertInMemoryUser(input: {
  id: string;
  name: string;
  username: string;
  email: string;
  password: string;
  role: AdminDbRole;
  status?: AdminDbStatus;
}) {
  const normalizedEmail = normalizeEmail(input.email);
  const normalizedUsername = normalizeUsername(input.username);
  const existingId = inMemoryUserIdByUsername.get(normalizedUsername) || inMemoryUserIdByEmail.get(normalizedEmail);
  const id = existingId || input.id;
  const existing = inMemoryUsersById.get(id);
  const passwordHash =
    existing && bcrypt.compareSync(input.password, existing.password_hash)
      ? existing.password_hash
      : bcrypt.hashSync(input.password, 10);

  const nextUser: DbUserRow = {
    id,
    email: normalizedEmail,
    username: normalizedUsername,
    full_name: input.name,
    phone: existing?.phone || null,
    country: existing?.country || null,
    role: input.role,
    status: input.status || 'active',
    avatar_url: existing?.avatar_url || null,
    cover_url: existing?.cover_url || null,
    last_login_at: existing?.last_login_at || null,
    password_hash: passwordHash,
    created_at: existing?.created_at || new Date().toISOString(),
  };

  inMemoryUsersById.set(id, nextUser);
  inMemoryUserIdByEmail.set(normalizedEmail, id);
  inMemoryUserIdByUsername.set(normalizedUsername, id);
}

function seedInMemoryUsers() {
  upsertInMemoryUser({
    id: 'admin-1',
    name: 'Dan Ayipah',
    username: 'daky',
    email: 'officialdakyworld@gmail.com',
    password: 'DanAyipah#1',
    role: 'admin',
  });
  upsertInMemoryUser({
    id: 'platform-user-1',
    name: 'Platform User',
    username: 'user',
    email: 'user@dakyworldhub.com',
    password: 'user',
    role: 'user',
  });
}

// Helpers
async function dbQuery<T = any>(sql: string, params: any[] = []) {
  if (!hasDatabase()) {
    throw new Error('DATABASE_URL is not configured. Please set it to enable persistence.');
  }
  return pool!.query<T>(sql, params);
}

function normalizeEmail(value: string) {
  return value.trim().toLowerCase();
}

function normalizeUsername(value: string) {
  return value.trim().toLowerCase();
}

ensureDatabase().catch((err) => {
  dbReady = false;
  seedInMemoryUsers();
  console.error('Database initialization failed:', err);
});
ensureSeedUsers().catch((err) => {
  console.error('Seed user initialization failed:', err);
});
ensureSeedPricingPlans().catch((err) => {
  console.error('Seed pricing plans initialization failed:', err);
});

function titleRole(role: string) {
  switch (role) {
    case 'admin':
      return 'Admin';
    default:
      return 'User';
  }
}

function titleStatus(status: string) {
  switch (status) {
    case 'active':
      return 'Active';
    case 'suspended':
      return 'Suspended';
    case 'pending':
      return 'Pending';
    case 'banned':
      return 'Banned';
    default:
      return 'Active';
  }
}

function parseAdminRole(role: string | undefined): AdminDbRole {
  switch ((role || '').trim().toLowerCase()) {
    case 'admin':
      return 'admin';
    default:
      return 'user';
  }
}

function parseAdminStatus(status: string | undefined): AdminDbStatus {
  switch ((status || '').trim().toLowerCase()) {
    case 'suspended':
      return 'suspended';
    case 'pending':
      return 'pending';
    case 'banned':
      return 'banned';
    default:
      return 'active';
  }
}

function userToAuthPayload(user: DbUserRow) {
  return {
    id: user.id,
    email: user.email,
    username: user.username,
    name: user.full_name,
    phone: user.phone,
    country: user.country,
    role: user.role === 'admin' ? 'admin' : 'user',
    avatar: user.avatar_url,
    cover: user.cover_url,
  };
}

function userToManagedUser(user: DbUserRow) {
  return {
    id: user.id,
    name: user.full_name || user.username || user.email.split('@')[0],
    email: user.email,
    username: user.username || '',
    role: titleRole(user.role),
    status: titleStatus(user.status),
    avatar: user.avatar_url || `https://ui-avatars.com/api/?background=eff6ff&color=1d4ed8&name=${encodeURIComponent(user.full_name || user.username || user.email)}`,
    dateJoined: user.created_at?.slice(0, 10) || new Date().toISOString().slice(0, 10),
    lastLogin: user.last_login_at || 'Never',
    recentActions: ['User record synced from database'],
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
  if (!hasDatabase()) {
    const userId = inMemoryUserIdByEmail.get(normalizedEmail);
    return userId ? inMemoryUsersById.get(userId) : undefined;
  }
  const result = await dbQuery<DbUserRow>('SELECT * FROM users WHERE email = $1', [normalizedEmail]);
  return result.rows[0];
}

async function findUserByUsername(username: string): Promise<DbUserRow | undefined> {
  const normalizedUsername = normalizeUsername(username);
  if (!hasDatabase()) {
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
  if (!hasDatabase()) {
    return inMemoryUsersById.get(id);
  }
  const result = await dbQuery<DbUserRow>('SELECT * FROM users WHERE id = $1', [id]);
  return result.rows[0];
}

async function createUser(
  name: string,
  username: string,
  email: string,
  password: string,
  options?: { role?: AdminDbRole; status?: AdminDbStatus; avatarUrl?: string | null; coverUrl?: string | null }
): Promise<DbUserRow> {
  const hash = await bcrypt.hash(password, 10);
  const id = randomUUID();
  const normalizedEmail = normalizeEmail(email);
  const normalizedUsername = normalizeUsername(username);

  if (!hasDatabase()) {
    const user: DbUserRow = {
      id,
      email: normalizedEmail,
      username: normalizedUsername,
      full_name: name || null,
      phone: null,
      country: null,
      role: options?.role || 'user',
      status: options?.status || 'active',
      avatar_url: options?.avatarUrl || null,
      cover_url: options?.coverUrl || null,
      last_login_at: null,
      password_hash: hash,
      created_at: new Date().toISOString(),
    };
    inMemoryUsersById.set(id, user);
    inMemoryUserIdByEmail.set(normalizedEmail, id);
    inMemoryUserIdByUsername.set(normalizedUsername, id);
    return user;
  }

  const result = await dbQuery<DbUserRow>(
    'INSERT INTO users (id, email, username, password_hash, full_name, phone, country, role, status, avatar_url, cover_url, last_login_at) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12) RETURNING *',
    [id, normalizedEmail, normalizedUsername, hash, name || null, null, null, options?.role || 'user', options?.status || 'active', options?.avatarUrl || null, options?.coverUrl || null, null]
  );
  return result.rows[0];
}

async function updateLastLogin(userId: string) {
  if (!hasDatabase()) {
    const user = inMemoryUsersById.get(userId);
    if (!user) return;
    inMemoryUsersById.set(userId, { ...user, last_login_at: new Date().toISOString() });
    return;
  }
  await dbQuery('UPDATE users SET last_login_at = NOW() WHERE id = $1', [userId]);
}

async function ensureSeedUser(input: {
  name: string;
  username: string;
  email: string;
  password: string;
  role: AdminDbRole;
  status?: AdminDbStatus;
}) {
  const existing = await findUserByUsername(input.username);
  if (existing) {
    return existing;
  }
  return createUser(input.name, input.username, input.email, input.password, {
    role: input.role,
    status: input.status || 'active',
  });
}

async function ensureSeedUsers() {
  if (!hasDatabase()) {
    seedInMemoryUsers();
    return;
  }

  await ensureSeedUser({
    name: 'Dan Ayipah',
    username: 'daky',
    email: 'officialdakyworld@gmail.com',
    password: 'DanAyipah#1',
    role: 'admin',
  });
  await ensureSeedUser({
    name: 'Platform User',
    username: 'user',
    email: 'user@dakyworldhub.com',
    password: 'user',
    role: 'user',
  });
}

async function ensureSeedPricingPlans() {
  const plans = [
    {
      name: 'Starter',
      description: 'For solo creators building posts, cards, and a lean publishing workflow.',
      monthlyPrice: 19,
      yearlyPrice: 190,
      monthlyFeatures: [
        'Up to 60 social posts per month',
        'Access to the social card template editor',
        'JPG export for final cards',
        'Up to 3 connected integrations',
        'Basic analytics overview',
        '1 team member',
      ],
      yearlyFeatures: [
        'Everything in Starter monthly',
        'Save about 2 months each year',
        '60 social posts per month',
        '3 connected integrations',
        'Basic analytics overview',
        '1 team member',
      ],
    },
    {
      name: 'Growth',
      description: 'For active brands that need more output, more templates, and more connected tools.',
      monthlyPrice: 49,
      yearlyPrice: 490,
      featured: true,
      monthlyFeatures: [
        'Up to 250 social posts per month',
        'Unlimited card edits and exports',
        'Advanced template customization',
        'Up to 10 connected integrations',
        'Full analytics dashboard and insights',
        'Up to 5 team members',
      ],
      yearlyFeatures: [
        'Everything in Growth monthly',
        'Save about 2 months each year',
        '250 social posts per month',
        '10 connected integrations',
        'Advanced editor and analytics access',
        'Up to 5 team members',
      ],
    },
    {
      name: 'Scale',
      description: 'For teams running multi-channel content operations with heavier collaboration needs.',
      monthlyPrice: 99,
      yearlyPrice: 990,
      monthlyFeatures: [
        'Unlimited social posts',
        'Unlimited card templates and exports',
        'Priority access to new editor features',
        'Unlimited integrations',
        'Advanced analytics and export workflows',
        'Up to 15 team members',
      ],
      yearlyFeatures: [
        'Everything in Scale monthly',
        'Save about 2 months each year',
        'Unlimited posts and exports',
        'Unlimited integrations',
        'Advanced analytics and exports',
        'Up to 15 team members',
      ],
    },
  ];

  if (!hasDatabase()) {
    // Seed in-memory pricing plans
    const now = new Date().toISOString();
    plans.forEach((plan) => {
      const monthlyId = randomUUID();
      const yearlyId = randomUUID();

      inMemoryPricingPlansById.set(monthlyId, {
        id: monthlyId,
        name: `${plan.name} (Monthly)`,
        description: plan.description,
        price: plan.monthlyPrice,
        billing_period: 'monthly',
        features: plan.monthlyFeatures,
        is_active: true,
        created_at: now,
        updated_at: now,
      });

      inMemoryPricingPlansById.set(yearlyId, {
        id: yearlyId,
        name: `${plan.name} (Yearly)`,
        description: plan.description,
        price: plan.yearlyPrice,
        billing_period: 'yearly',
        features: plan.yearlyFeatures,
        is_active: true,
        created_at: now,
        updated_at: now,
      });
    });
    console.log(`Seeded ${inMemoryPricingPlansById.size} pricing plans in-memory`);
    return;
  }

  // Check if plans already exist
  const existing = await dbQuery<{ count: number }>(
    'SELECT COUNT(*) as count FROM pricing_plans'
  );

  if (existing.rows[0]?.count > 0) {
    console.log('Pricing plans already seeded in database');
    return; // Plans already seeded
  }

  const now = new Date().toISOString();

  for (const plan of plans) {
    const monthlyId = randomUUID();
    const yearlyId = randomUUID();

    await dbQuery(
      'INSERT INTO pricing_plans (id, name, description, price, billing_period, features, is_active, created_at, updated_at) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)',
      [
        monthlyId,
        `${plan.name} (Monthly)`,
        plan.description,
        plan.monthlyPrice,
        'monthly',
        plan.monthlyFeatures,
        true,
        now,
        now,
      ]
    );

    await dbQuery(
      'INSERT INTO pricing_plans (id, name, description, price, billing_period, features, is_active, created_at, updated_at) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)',
      [
        yearlyId,
        `${plan.name} (Yearly)`,
        plan.description,
        plan.yearlyPrice,
        'yearly',
        plan.yearlyFeatures,
        true,
        now,
        now,
      ]
    );
  }
  console.log(`Seeded 6 pricing plans in database (${plans.length} plan types)`);
}

async function updateUserProfile(
  userId: string,
  updates: { name: string; username: string; email: string; phone: string; country: string; avatar?: string; cover?: string }
): Promise<DbUserRow | undefined> {
  const normalizedEmail = normalizeEmail(updates.email);
  const normalizedUsername = normalizeUsername(updates.username);
  const normalizedPhone = updates.phone.trim();
  const normalizedCountry = updates.country.trim();
  const normalizedName = updates.name.trim();

  if (!hasDatabase()) {
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
      avatar_url: typeof updates.avatar === 'string' ? updates.avatar || null : existing.avatar_url,
      cover_url: typeof updates.cover === 'string' ? updates.cover || null : existing.cover_url,
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
        country = $5,
        avatar_url = COALESCE($6, avatar_url),
        cover_url = COALESCE($7, cover_url)
    WHERE id = $8
    RETURNING *;
  `,
    [
      normalizedEmail,
      normalizedUsername,
      normalizedName || null,
      normalizedPhone || null,
      normalizedCountry || null,
      typeof updates.avatar === 'string' ? updates.avatar || null : null,
      typeof updates.cover === 'string' ? updates.cover || null : null,
      userId,
    ]
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

async function requireAdmin(req: Request, res: Response): Promise<DbUserRow | null> {
  const auth = requireAuth(req, res);
  if (!auth) return null;
  const user = await getUserById(auth.userId);
  if (!user || user.role !== 'admin') {
    res.status(403).json({ success: false, error: 'Admin access required' });
    return null;
  }
  return user;
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
      user: userToAuthPayload(user),
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

    await updateLastLogin(user.id);
    const refreshedUser = (await getUserById(user.id)) || user;
    const token = signToken(user.id, user.email);
    return res.json({
      success: true,
      token,
      user: userToAuthPayload(refreshedUser),
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
      user: userToAuthPayload(user),
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

    const { name, username, email, phone, country, avatar, cover } = req.body;
    if (!name || !username || !email) {
      return res.status(400).json({ success: false, error: 'Name, username, and email are required' });
    }

    const updated = await updateUserProfile(auth.userId, {
      name: String(name),
      username: String(username),
      email: String(email),
      phone: String(phone || ''),
      country: String(country || ''),
      avatar: typeof avatar === 'string' ? avatar : undefined,
      cover: typeof cover === 'string' ? cover : undefined,
    });

    if (!updated) {
      return res.status(404).json({ success: false, error: 'User not found' });
    }

    return res.json({
      success: true,
      user: userToAuthPayload(updated),
    });
  } catch (error) {
    console.error('Profile update error:', error);
    const message = error instanceof Error ? error.message : 'Failed to update profile';
    const statusCode = message.includes('already in use') ? 400 : 500;
    return res.status(statusCode).json({ success: false, error: message });
  }
});

app.get('/api/users', async (req: Request, res: Response) => {
  try {
    const admin = await requireAdmin(req, res);
    if (!admin) return;

    const search = String(req.query.search || '').trim().toLowerCase();
    const role = String(req.query.role || 'All');
    const status = String(req.query.status || 'All');
    const joined = String(req.query.joined || 'all');
    const page = Math.max(1, Number(req.query.page || 1));
    const perPage = Math.max(1, Number(req.query.perPage || 25));

    const users = hasDatabase()
      ? (await dbQuery<DbUserRow>('SELECT * FROM users ORDER BY created_at DESC')).rows
      : Array.from(inMemoryUsersById.values()).sort((a, b) => (a.created_at < b.created_at ? 1 : -1));

    const now = new Date('2026-03-07T00:00:00Z').getTime();
    const filtered = users.filter((user) => {
      const matchesSearch =
        !search ||
        [user.id, user.email, user.username || '', user.full_name || '']
          .some((value) => value.toLowerCase().includes(search));
      const matchesRole = role === 'All' || titleRole(user.role) === role;
      const matchesStatus = status === 'All' || titleStatus(user.status) === status;
      const joinedMs = new Date(user.created_at).getTime();
      const diffDays = Math.floor((now - joinedMs) / (1000 * 60 * 60 * 24));
      const matchesJoined =
        joined === 'all' ||
        (joined === '7days' && diffDays <= 7) ||
        (joined === '30days' && diffDays <= 30) ||
        (joined === '1year' && diffDays <= 365);
      return matchesSearch && matchesRole && matchesStatus && matchesJoined;
    });

    const start = (page - 1) * perPage;
    const items = filtered.slice(start, start + perPage).map(userToManagedUser);

    return res.json({
      items,
      total: filtered.length,
      page,
      perPage,
    });
  } catch (error) {
    console.error('List users error:', error);
    return res.status(500).json({ success: false, error: 'Failed to fetch users' });
  }
});

app.post('/api/users', async (req: Request, res: Response) => {
  try {
    const admin = await requireAdmin(req, res);
    if (!admin) return;

    const { name, email, username, password, role, status } = req.body;
    if (!name || !email || !username || !password) {
      return res.status(400).json({ success: false, error: 'Name, email, username, and password are required' });
    }

    const existingEmail = await findUserByEmail(String(email));
    if (existingEmail) {
      return res.status(400).json({ success: false, error: 'Email is already in use' });
    }
    const existingUsername = await findUserByUsername(String(username));
    if (existingUsername) {
      return res.status(400).json({ success: false, error: 'Username is already in use' });
    }

    const created = await createUser(String(name), String(username), String(email), String(password), {
      role: parseAdminRole(role),
      status: parseAdminStatus(status),
    });
    return res.status(201).json(userToManagedUser(created));
  } catch (error) {
    console.error('Create user error:', error);
    const message = error instanceof Error ? error.message : 'Failed to create user';
    return res.status(500).json({ success: false, error: message });
  }
});

app.put('/api/users/:id', async (req: Request, res: Response) => {
  try {
    const admin = await requireAdmin(req, res);
    if (!admin) return;

    const { id } = req.params;
    const existing = await getUserById(id);
    if (!existing) {
      return res.status(404).json({ success: false, error: 'User not found' });
    }

    const normalizedEmail = normalizeEmail(String(req.body.email || existing.email));
    const normalizedUsername = normalizeUsername(String(req.body.username || existing.username || ''));
    const duplicateEmail = await findUserByEmail(normalizedEmail);
    if (duplicateEmail && duplicateEmail.id !== id) {
      return res.status(400).json({ success: false, error: 'Email is already in use' });
    }
    const duplicateUsername = await findUserByUsername(normalizedUsername);
    if (duplicateUsername && duplicateUsername.id !== id) {
      return res.status(400).json({ success: false, error: 'Username is already in use' });
    }

    const nextRole = parseAdminRole(req.body.role);
    const nextStatus = parseAdminStatus(req.body.status);
    const nextAvatar = typeof req.body.avatar === 'string' ? req.body.avatar.trim() : existing.avatar_url;
    const nextName = String(req.body.name || existing.full_name || '').trim();

    let updated: DbUserRow | undefined;
    if (!hasDatabase()) {
      const nextUser: DbUserRow = {
        ...existing,
        full_name: nextName || null,
        email: normalizedEmail,
        username: normalizedUsername || null,
        role: nextRole,
        status: nextStatus,
        avatar_url: nextAvatar || null,
      };
      inMemoryUsersById.set(id, nextUser);
      inMemoryUserIdByEmail.set(normalizedEmail, id);
      if (normalizedUsername) {
        inMemoryUserIdByUsername.set(normalizedUsername, id);
      }
      updated = nextUser;
    } else {
      updated = (
        await dbQuery<DbUserRow>(
          `UPDATE users
           SET full_name = $1, email = $2, username = $3, role = $4, status = $5, avatar_url = $6
           WHERE id = $7
           RETURNING *`,
          [nextName || null, normalizedEmail, normalizedUsername || null, nextRole, nextStatus, nextAvatar || null, id],
        )
      ).rows[0];
    }

    return res.json(userToManagedUser(updated!));
  } catch (error) {
    console.error('Update user error:', error);
    return res.status(500).json({ success: false, error: 'Failed to update user' });
  }
});

app.delete('/api/users/:id', async (req: Request, res: Response) => {
  try {
    const admin = await requireAdmin(req, res);
    if (!admin) return;

    const { id } = req.params;
    if (admin.id === id) {
      return res.status(400).json({ success: false, error: 'Admin cannot delete the active admin account' });
    }

    if (!hasDatabase()) {
      const existing = inMemoryUsersById.get(id);
      if (existing?.username) {
        inMemoryUserIdByUsername.delete(normalizeUsername(existing.username));
      }
      if (existing) {
        inMemoryUserIdByEmail.delete(normalizeEmail(existing.email));
      }
      inMemoryUsersById.delete(id);
    } else {
      await dbQuery('DELETE FROM users WHERE id = $1', [id]);
    }

    return res.json({ success: true });
  } catch (error) {
    console.error('Delete user error:', error);
    return res.status(500).json({ success: false, error: 'Failed to delete user' });
  }
});

app.patch('/api/users/:id/status', async (req: Request, res: Response) => {
  try {
    const admin = await requireAdmin(req, res);
    if (!admin) return;

    const { id } = req.params;
    const nextStatus = parseAdminStatus(req.body.status);
    if (!hasDatabase()) {
      const existing = inMemoryUsersById.get(id);
      if (!existing) {
        return res.status(404).json({ success: false, error: 'User not found' });
      }
      inMemoryUsersById.set(id, { ...existing, status: nextStatus });
    } else {
      await dbQuery('UPDATE users SET status = $1 WHERE id = $2', [nextStatus, id]);
    }
    return res.json({ success: true });
  } catch (error) {
    console.error('Patch user status error:', error);
    return res.status(500).json({ success: false, error: 'Failed to update status' });
  }
});

app.patch('/api/users/:id/role', async (req: Request, res: Response) => {
  try {
    const admin = await requireAdmin(req, res);
    if (!admin) return;

    const { id } = req.params;
    const nextRole = parseAdminRole(req.body.role);
    if (!hasDatabase()) {
      const existing = inMemoryUsersById.get(id);
      if (!existing) {
        return res.status(404).json({ success: false, error: 'User not found' });
      }
      inMemoryUsersById.set(id, { ...existing, role: nextRole });
    } else {
      await dbQuery('UPDATE users SET role = $1 WHERE id = $2', [nextRole, id]);
    }
    return res.json({ success: true });
  } catch (error) {
    console.error('Patch user role error:', error);
    return res.status(500).json({ success: false, error: 'Failed to update role' });
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

// POST /api/wordpress/connect �?validate and store connection (tries Application Password first, then login password)
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
        error: 'Provide either your WordPress login password or an Application Password (Users �?Profile �?Application Passwords).',
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
        message = 'WordPress REST API requires an Application Password, not your normal login password. In your WordPress admin go to Users �?your profile �?Application Passwords, create a new one, and paste it in the "Application Password" field above. Some hosts disable this; if you don’t see it, check your host’s docs or use a plugin that enables REST API auth.';
      } else {
        message = lastError || 'WordPress authentication failed. Try an Application Password (Users �?Profile �?Application Passwords).';
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

// POST /api/wordpress/connect-webhook �?validate and store Make webhook URL
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

// POST /api/wordpress/publish-webhook �?send payload to stored Make webhook
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

// POST /api/wordpress/publish �?create post (optionally upload featured image, set meta)
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

// Pricing Plans Routes
app.get('/api/pricing/plans', async (req: Request, res: Response) => {
  try {
    let plans: DbPricingPlan[] = [];

    if (!hasDatabase()) {
      plans = Array.from(inMemoryPricingPlansById.values());
      console.log(`GET /api/pricing/plans - Returning ${plans.length} in-memory plans`);
    } else {
      const result = await dbQuery<DbPricingPlan>(
        'SELECT id, name, description, price, billing_period, features, is_active, created_at, updated_at FROM pricing_plans ORDER BY created_at DESC'
      );
      plans = result.rows;
      console.log(`GET /api/pricing/plans - Returning ${plans.length} database plans`);
    }

    console.log('Plans to return:', plans.length > 0 ? plans[0] : 'No plans');

    return res.json({
      success: true,
      plans: plans.map((p) => ({
        id: p.id,
        name: p.name,
        description: p.description,
        price: parseFloat(String(p.price)),
        billingPeriod: p.billing_period,
        features: Array.isArray(p.features) ? p.features : [],
        isActive: p.is_active,
        createdAt: p.created_at,
        updatedAt: p.updated_at,
      })),
    });
  } catch (error) {
    console.error('Get pricing plans error:', error);
    return res.status(500).json({ success: false, error: 'Failed to fetch pricing plans' });
  }
});

app.post('/api/pricing/plans', async (req: Request, res: Response) => {
  try {
    const admin = await requireAdmin(req, res);
    if (!admin) return;

    const { name, description, price, billingPeriod, features } = req.body;
    if (!name || !description || price === undefined) {
      return res
        .status(400)
        .json({ success: false, error: 'Name, description, and price are required' });
    }

    const id = randomUUID();
    const now = new Date().toISOString();

    if (!hasDatabase()) {
      const plan: DbPricingPlan = {
        id,
        name,
        description,
        price: Number(price),
        billing_period: (billingPeriod || 'monthly') as 'monthly' | 'yearly',
        features: Array.isArray(features) ? features : [],
        is_active: true,
        created_at: now,
        updated_at: now,
      };
      inMemoryPricingPlansById.set(id, plan);

      return res.status(201).json({
        success: true,
        plan: {
          id: plan.id,
          name: plan.name,
          description: plan.description,
          price: plan.price,
          billingPeriod: plan.billing_period,
          features: plan.features,
          isActive: plan.is_active,
          createdAt: plan.created_at,
          updatedAt: plan.updated_at,
        },
      });
    } else {
      const result = await dbQuery<DbPricingPlan>(
        'INSERT INTO pricing_plans (id, name, description, price, billing_period, features, is_active, created_at, updated_at) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) RETURNING *',
        [
          id,
          name,
          description,
          Number(price),
          billingPeriod || 'monthly',
          features || [],
          true,
          now,
          now,
        ]
      );
      const plan = result.rows[0];

      return res.status(201).json({
        success: true,
        plan: {
          id: plan.id,
          name: plan.name,
          description: plan.description,
          price: parseFloat(String(plan.price)),
          billingPeriod: plan.billing_period,
          features: Array.isArray(plan.features) ? plan.features : [],
          isActive: plan.is_active,
          createdAt: plan.created_at,
          updatedAt: plan.updated_at,
        },
      });
    }
  } catch (error) {
    console.error('Create pricing plan error:', error);
    return res.status(500).json({ success: false, error: 'Failed to create pricing plan' });
  }
});

app.put('/api/pricing/plans/:id', async (req: Request, res: Response) => {
  try {
    const admin = await requireAdmin(req, res);
    if (!admin) return;

    const { id } = req.params;
    const { name, description, price, billingPeriod, features, isActive } = req.body;

    if (!name || !description || price === undefined) {
      return res
        .status(400)
        .json({ success: false, error: 'Name, description, and price are required' });
    }

    const now = new Date().toISOString();

    if (!hasDatabase()) {
      const existing = inMemoryPricingPlansById.get(id);
      if (!existing) {
        return res.status(404).json({ success: false, error: 'Pricing plan not found' });
      }

      const updated: DbPricingPlan = {
        ...existing,
        name,
        description,
        price: Number(price),
        billing_period: (billingPeriod || 'monthly') as 'monthly' | 'yearly',
        features: Array.isArray(features) ? features : [],
        is_active: isActive !== undefined ? isActive : existing.is_active,
        updated_at: now,
      };
      inMemoryPricingPlansById.set(id, updated);

      return res.json({
        success: true,
        plan: {
          id: updated.id,
          name: updated.name,
          description: updated.description,
          price: updated.price,
          billingPeriod: updated.billing_period,
          features: updated.features,
          isActive: updated.is_active,
          createdAt: updated.created_at,
          updatedAt: updated.updated_at,
        },
      });
    } else {
      const result = await dbQuery<DbPricingPlan>(
        'UPDATE pricing_plans SET name = $1, description = $2, price = $3, billing_period = $4, features = $5, is_active = $6, updated_at = $7 WHERE id = $8 RETURNING *',
        [
          name,
          description,
          Number(price),
          billingPeriod || 'monthly',
          features || [],
          isActive !== undefined ? isActive : true,
          now,
          id,
        ]
      );

      if (result.rows.length === 0) {
        return res.status(404).json({ success: false, error: 'Pricing plan not found' });
      }

      const plan = result.rows[0];
      return res.json({
        success: true,
        plan: {
          id: plan.id,
          name: plan.name,
          description: plan.description,
          price: parseFloat(String(plan.price)),
          billingPeriod: plan.billing_period,
          features: Array.isArray(plan.features) ? plan.features : [],
          isActive: plan.is_active,
          createdAt: plan.created_at,
          updatedAt: plan.updated_at,
        },
      });
    }
  } catch (error) {
    console.error('Update pricing plan error:', error);
    return res.status(500).json({ success: false, error: 'Failed to update pricing plan' });
  }
});

app.delete('/api/pricing/plans/:id', async (req: Request, res: Response) => {
  try {
    const admin = await requireAdmin(req, res);
    if (!admin) return;

    const { id } = req.params;

    if (!hasDatabase()) {
      if (!inMemoryPricingPlansById.has(id)) {
        return res.status(404).json({ success: false, error: 'Pricing plan not found' });
      }
      inMemoryPricingPlansById.delete(id);
    } else {
      const result = await dbQuery('DELETE FROM pricing_plans WHERE id = $1', [id]);
      if (result.rowCount === 0) {
        return res.status(404).json({ success: false, error: 'Pricing plan not found' });
      }
    }

    return res.json({ success: true });
  } catch (error) {
    console.error('Delete pricing plan error:', error);
    return res.status(500).json({ success: false, error: 'Failed to delete pricing plan' });
  }
});

app.patch('/api/pricing/plans/:id/status', async (req: Request, res: Response) => {
  try {
    const admin = await requireAdmin(req, res);
    if (!admin) return;

    const { id } = req.params;
    const { isActive } = req.body;

    if (isActive === undefined) {
      return res.status(400).json({ success: false, error: 'isActive is required' });
    }

    const now = new Date().toISOString();

    if (!hasDatabase()) {
      const existing = inMemoryPricingPlansById.get(id);
      if (!existing) {
        return res.status(404).json({ success: false, error: 'Pricing plan not found' });
      }

      const updated: DbPricingPlan = {
        ...existing,
        is_active: isActive,
        updated_at: now,
      };
      inMemoryPricingPlansById.set(id, updated);

      return res.json({
        success: true,
        plan: {
          id: updated.id,
          name: updated.name,
          description: updated.description,
          price: updated.price,
          billingPeriod: updated.billing_period,
          features: updated.features,
          isActive: updated.is_active,
          createdAt: updated.created_at,
          updatedAt: updated.updated_at,
        },
      });
    } else {
      const result = await dbQuery<DbPricingPlan>(
        'UPDATE pricing_plans SET is_active = $1, updated_at = $2 WHERE id = $3 RETURNING *',
        [isActive, now, id]
      );

      if (result.rows.length === 0) {
        return res.status(404).json({ success: false, error: 'Pricing plan not found' });
      }

      const plan = result.rows[0];
      return res.json({
        success: true,
        plan: {
          id: plan.id,
          name: plan.name,
          description: plan.description,
          price: parseFloat(String(plan.price)),
          billingPeriod: plan.billing_period,
          features: Array.isArray(plan.features) ? plan.features : [],
          isActive: plan.is_active,
          createdAt: plan.created_at,
          updatedAt: plan.updated_at,
        },
      });
    }
  } catch (error) {
    console.error('Update pricing plan status error:', error);
    return res.status(500).json({ success: false, error: 'Failed to update pricing plan status' });
  }
});

// Card Templates Routes
app.get('/api/card-templates', async (req: Request, res: Response) => {
  try {
    const admin = await requireAdmin(req, res);
    if (!admin) return;

    let templates: DbCardTemplate[] = [];

    if (!hasDatabase()) {
      templates = Array.from(inMemoryCardTemplatesById.values());
    } else {
      const result = await dbQuery<DbCardTemplate>(
        'SELECT id, name, description, design_data, cover_image_url, is_published, created_at, updated_at FROM card_templates ORDER BY created_at DESC'
      );
      templates = result.rows;
    }

    return res.json({
      success: true,
      templates: templates.map((t) => ({
        id: t.id,
        name: t.name,
        description: t.description || '',
        designData: typeof t.design_data === 'string' ? JSON.parse(t.design_data) : t.design_data,
        coverImageUrl: t.cover_image_url,
        isPublished: t.is_published,
        createdAt: t.created_at,
        updatedAt: t.updated_at,
      })),
    });
  } catch (error) {
    console.error('Get card templates error:', error);
    return res.status(500).json({ success: false, error: 'Failed to fetch card templates' });
  }
});

app.get('/api/card-templates/published', async (req: Request, res: Response) => {
  try {
    let templates: DbCardTemplate[] = [];

    if (!hasDatabase()) {
      templates = Array.from(inMemoryCardTemplatesById.values()).filter((t) => t.is_published);
    } else {
      const result = await dbQuery<DbCardTemplate>(
        'SELECT id, name, description, design_data, cover_image_url, is_published, created_at, updated_at FROM card_templates WHERE is_published = true ORDER BY created_at DESC'
      );
      templates = result.rows;
    }

    return res.json({
      success: true,
      templates: templates.map((t) => ({
        id: t.id,
        name: t.name,
        description: t.description || '',
        designData: typeof t.design_data === 'string' ? JSON.parse(t.design_data) : t.design_data,
        coverImageUrl: t.cover_image_url,
        isPublished: t.is_published,
        createdAt: t.created_at,
        updatedAt: t.updated_at,
      })),
    });
  } catch (error) {
    console.error('Get published card templates error:', error);
    return res.status(500).json({ success: false, error: 'Failed to fetch published card templates' });
  }
});

app.post('/api/card-templates', async (req: Request, res: Response) => {
  try {
    const admin = await requireAdmin(req, res);
    if (!admin) return;

    const { name, description, designData } = req.body;
    if (!name || !designData) {
      return res.status(400).json({ success: false, error: 'Name and designData are required' });
    }

    const id = randomUUID();
    const now = new Date().toISOString();

    const template: DbCardTemplate = {
      id,
      name,
      description: description || '',
      design_data: designData,
      is_published: false,
      created_at: now,
      updated_at: now,
    };

    if (!hasDatabase()) {
      inMemoryCardTemplatesById.set(id, template);
    } else {
      await dbQuery(
        'INSERT INTO card_templates (id, name, description, design_data, is_published, created_at, updated_at) VALUES ($1, $2, $3, $4, $5, $6, $7)',
        [id, name, description || '', JSON.stringify(designData), false, now, now]
      );
    }

    return res.json({
      success: true,
      template: {
        id: template.id,
        name: template.name,
        description: template.description,
        designData: template.design_data,
        coverImageUrl: template.cover_image_url,
        isPublished: template.is_published,
        createdAt: template.created_at,
        updatedAt: template.updated_at,
      },
    });
  } catch (error) {
    console.error('Create card template error:', error);
    return res.status(500).json({ success: false, error: 'Failed to create card template' });
  }
});

app.put('/api/card-templates/:id', async (req: Request, res: Response) => {
  try {
    const admin = await requireAdmin(req, res);
    if (!admin) return;

    const { id } = req.params;
    const { name, description, designData } = req.body;

    if (!name || !designData) {
      return res.status(400).json({ success: false, error: 'Name and designData are required' });
    }

    const now = new Date().toISOString();

    if (!hasDatabase()) {
      const existing = inMemoryCardTemplatesById.get(id);
      if (!existing) {
        return res.status(404).json({ success: false, error: 'Card template not found' });
      }

      const updated: DbCardTemplate = {
        ...existing,
        name,
        description: description || '',
        design_data: designData,
        updated_at: now,
      };
      inMemoryCardTemplatesById.set(id, updated);

      return res.json({
        success: true,
        template: {
          id: updated.id,
          name: updated.name,
          description: updated.description,
          designData: updated.design_data,
          coverImageUrl: updated.cover_image_url,
          isPublished: updated.is_published,
          createdAt: updated.created_at,
          updatedAt: updated.updated_at,
        },
      });
    } else {
      await dbQuery(
        'UPDATE card_templates SET name = $1, description = $2, design_data = $3, updated_at = $4 WHERE id = $5',
        [name, description || '', JSON.stringify(designData), now, id]
      );

      const result = await dbQuery<DbCardTemplate>(
        'SELECT id, name, description, design_data, cover_image_url, is_published, created_at, updated_at FROM card_templates WHERE id = $1',
        [id]
      );

      if (result.rows.length === 0) {
        return res.status(404).json({ success: false, error: 'Card template not found' });
      }

      const template = result.rows[0];
      return res.json({
        success: true,
        template: {
          id: template.id,
          name: template.name,
          description: template.description,
          designData: typeof template.design_data === 'string' ? JSON.parse(template.design_data) : template.design_data,
          coverImageUrl: template.cover_image_url,
          isPublished: template.is_published,
          createdAt: template.created_at,
          updatedAt: template.updated_at,
        },
      });
    }
  } catch (error) {
    console.error('Update card template error:', error);
    return res.status(500).json({ success: false, error: 'Failed to update card template' });
  }
});

app.post('/api/card-templates/:id/publish', async (req: Request, res: Response) => {
  try {
    const admin = await requireAdmin(req, res);
    if (!admin) return;

    const { id } = req.params;
    const { coverImageUrl } = req.body;

    if (!coverImageUrl) {
      return res.status(400).json({ success: false, error: 'coverImageUrl is required' });
    }

    const now = new Date().toISOString();

    if (!hasDatabase()) {
      const existing = inMemoryCardTemplatesById.get(id);
      if (!existing) {
        return res.status(404).json({ success: false, error: 'Card template not found' });
      }

      const updated: DbCardTemplate = {
        ...existing,
        cover_image_url: coverImageUrl,
        is_published: true,
        updated_at: now,
      };
      inMemoryCardTemplatesById.set(id, updated);

      return res.json({
        success: true,
        template: {
          id: updated.id,
          name: updated.name,
          description: updated.description,
          designData: updated.design_data,
          coverImageUrl: updated.cover_image_url,
          isPublished: updated.is_published,
          createdAt: updated.created_at,
          updatedAt: updated.updated_at,
        },
      });
    } else {
      await dbQuery(
        'UPDATE card_templates SET cover_image_url = $1, is_published = true, updated_at = $2 WHERE id = $3',
        [coverImageUrl, now, id]
      );

      const result = await dbQuery<DbCardTemplate>(
        'SELECT id, name, description, design_data, cover_image_url, is_published, created_at, updated_at FROM card_templates WHERE id = $1',
        [id]
      );

      if (result.rows.length === 0) {
        return res.status(404).json({ success: false, error: 'Card template not found' });
      }

      const template = result.rows[0];
      return res.json({
        success: true,
        template: {
          id: template.id,
          name: template.name,
          description: template.description,
          designData: typeof template.design_data === 'string' ? JSON.parse(template.design_data) : template.design_data,
          coverImageUrl: template.cover_image_url,
          isPublished: template.is_published,
          createdAt: template.created_at,
          updatedAt: template.updated_at,
        },
      });
    }
  } catch (error) {
    console.error('Publish card template error:', error);
    return res.status(500).json({ success: false, error: 'Failed to publish card template' });
  }
});

app.delete('/api/card-templates/:id', async (req: Request, res: Response) => {
  try {
    const admin = await requireAdmin(req, res);
    if (!admin) return;

    const { id } = req.params;

    if (!hasDatabase()) {
      const existing = inMemoryCardTemplatesById.get(id);
      if (!existing) {
        return res.status(404).json({ success: false, error: 'Card template not found' });
      }
      inMemoryCardTemplatesById.delete(id);
      return res.json({ success: true, message: 'Card template deleted' });
    } else {
      await dbQuery('DELETE FROM card_templates WHERE id = $1', [id]);
      return res.json({ success: true, message: 'Card template deleted' });
    }
  } catch (error) {
    console.error('Delete card template error:', error);
    return res.status(500).json({ success: false, error: 'Failed to delete card template' });
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

