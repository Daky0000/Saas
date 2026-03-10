import express from 'express';
import type { Request, Response } from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import axios from 'axios';
import jwt from 'jsonwebtoken';
import bcrypt from 'bcryptjs';
import { Pool } from 'pg';
import { randomUUID, randomBytes, createCipheriv, createDecipheriv, scryptSync } from 'crypto';
import { SAMPLE_TEMPLATES } from './src/data/sampleFabricTemplates.js';

dotenv.config();

const WORDPRESS_ENCRYPTION_KEY = (() => {
  const raw = process.env.WORDPRESS_ENCRYPTION_KEY || process.env.JWT_SECRET || 'default-wp-key';
  return scryptSync(raw, 'salt', 32);
})();

const app = express();
const PORT = process.env.PORT || process.env.BACKEND_PORT || 5000;
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
      discount_percentage DECIMAL(5,2) DEFAULT 0,
      is_on_sale BOOLEAN DEFAULT FALSE,
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

  await pool.query(`
    CREATE TABLE IF NOT EXISTS platform_configs (
      platform TEXT PRIMARY KEY,
      config JSONB NOT NULL DEFAULT '{}',
      enabled BOOLEAN NOT NULL DEFAULT false,
      updated_at TIMESTAMPTZ DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS auth_providers (
      provider TEXT PRIMARY KEY,
      config JSONB NOT NULL DEFAULT '{}',
      enabled BOOLEAN NOT NULL DEFAULT false,
      updated_at TIMESTAMPTZ DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS payment_transactions (
      id TEXT PRIMARY KEY,
      amount NUMERIC(12,2) NOT NULL,
      currency TEXT NOT NULL DEFAULT 'GHS',
      description TEXT,
      status TEXT NOT NULL DEFAULT 'pending',
      provider TEXT NOT NULL DEFAULT 'hubtel',
      client_reference TEXT UNIQUE,
      provider_reference TEXT,
      customer_name TEXT,
      customer_email TEXT,
      customer_phone TEXT,
      checkout_url TEXT,
      metadata JSONB,
      created_at TIMESTAMPTZ DEFAULT NOW(),
      updated_at TIMESTAMPTZ DEFAULT NOW()
    );
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS page_content (
      slug TEXT PRIMARY KEY,
      content JSONB NOT NULL DEFAULT '{}',
      updated_at TIMESTAMPTZ DEFAULT NOW()
    );
  `);

  // Migrate: add discount columns to existing pricing_plans tables
  await pool.query(`
    ALTER TABLE pricing_plans ADD COLUMN IF NOT EXISTS discount_percentage DECIMAL(5,2) DEFAULT 0;
    ALTER TABLE pricing_plans ADD COLUMN IF NOT EXISTS is_on_sale BOOLEAN DEFAULT FALSE;
  `).catch(() => { /* ignore if columns already exist or table doesn't exist yet */ });

  await pool.query(`
    CREATE TABLE IF NOT EXISTS user_designs (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      name TEXT NOT NULL DEFAULT 'Untitled Design',
      canvas_width INTEGER NOT NULL DEFAULT 1080,
      canvas_height INTEGER NOT NULL DEFAULT 1080,
      canvas_data JSONB NOT NULL DEFAULT '{}',
      thumbnail_url TEXT,
      created_at TIMESTAMPTZ DEFAULT NOW(),
      updated_at TIMESTAMPTZ DEFAULT NOW()
    );
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS media_images (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      file_name TEXT NOT NULL,
      original_name TEXT NOT NULL,
      file_size INTEGER NOT NULL DEFAULT 0,
      file_type TEXT NOT NULL DEFAULT 'image/jpeg',
      width INTEGER,
      height INTEGER,
      upload_date TIMESTAMPTZ DEFAULT NOW(),
      url TEXT NOT NULL,
      thumbnail_url TEXT,
      tags TEXT[] DEFAULT '{}',
      used_in JSONB DEFAULT '[]',
      category TEXT DEFAULT 'user'
    );
  `);
  await pool.query(`ALTER TABLE media_images ADD COLUMN IF NOT EXISTS category TEXT DEFAULT 'user'`);

  // Blog post management tables
  await pool.query(`
    CREATE TABLE IF NOT EXISTS blog_categories (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      name TEXT NOT NULL,
      slug TEXT NOT NULL,
      created_at TIMESTAMPTZ DEFAULT NOW()
    );
  `);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS blog_tags (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      name TEXT NOT NULL,
      slug TEXT NOT NULL,
      created_at TIMESTAMPTZ DEFAULT NOW()
    );
  `);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS blog_posts (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      title TEXT NOT NULL DEFAULT '',
      slug TEXT NOT NULL DEFAULT '',
      content TEXT NOT NULL DEFAULT '',
      excerpt TEXT DEFAULT '',
      featured_image TEXT DEFAULT '',
      status TEXT NOT NULL DEFAULT 'draft',
      category_id TEXT REFERENCES blog_categories(id) ON DELETE SET NULL,
      meta_title TEXT DEFAULT '',
      meta_description TEXT DEFAULT '',
      focus_keyword TEXT DEFAULT '',
      social_title TEXT DEFAULT '',
      social_description TEXT DEFAULT '',
      social_image TEXT DEFAULT '',
      scheduled_at TIMESTAMPTZ,
      published_at TIMESTAMPTZ,
      created_at TIMESTAMPTZ DEFAULT NOW(),
      updated_at TIMESTAMPTZ DEFAULT NOW()
    );
  `);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS blog_post_tags (
      post_id TEXT NOT NULL REFERENCES blog_posts(id) ON DELETE CASCADE,
      tag_id TEXT NOT NULL REFERENCES blog_tags(id) ON DELETE CASCADE,
      PRIMARY KEY (post_id, tag_id)
    );
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS publishing_logs (
      id TEXT PRIMARY KEY,
      post_id TEXT NOT NULL,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      platform TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'pending',
      platform_post_id TEXT,
      error_message TEXT,
      created_at TIMESTAMPTZ DEFAULT NOW()
    );
  `);

  // Ensure cover_image_url exists on card_templates (added in v6.4)
  await pool.query(`ALTER TABLE card_templates ADD COLUMN IF NOT EXISTS cover_image_url TEXT`);

  // Seed card templates once if the table is empty
  try {
    const { rows: existingRows } = await pool.query<{ id: string }>('SELECT id FROM card_templates LIMIT 1');
    if (existingRows.length === 0) {
      const now = new Date().toISOString();
      for (const t of SAMPLE_TEMPLATES) {
        const tid = randomUUID();
        await pool.query(
          'INSERT INTO card_templates (id, name, description, design_data, cover_image_url, is_published, created_at, updated_at) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)',
          [tid, t.name, t.description, JSON.stringify(t.designData), '', true, now, now],
        );
      }
      console.log(`Seeded ${SAMPLE_TEMPLATES.length} card templates.`);
    }
  } catch (e) {
    console.warn('Card template seed skipped:', e);
  }

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
app.use(express.json({ limit: '20mb' }));
app.use(express.urlencoded({ extended: true, limit: '20mb' }));

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
  discount_percentage: number;
  is_on_sale: boolean;
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

type PlatformConfigRow = { platform: string; config: Record<string, string>; enabled: boolean; updated_at: string };
type PaymentTransactionRow = {
  id: string; amount: number; currency: string; description: string | null;
  status: string; provider: string; client_reference: string | null;
  provider_reference: string | null; customer_name: string | null;
  customer_email: string | null; customer_phone: string | null;
  checkout_url: string | null; metadata: Record<string, unknown> | null;
  created_at: string; updated_at: string;
};
const inMemoryPlatformConfigs = new Map<string, PlatformConfigRow>();
const inMemoryPaymentTransactions: PaymentTransactionRow[] = [];

async function getPlatformConfig(platform: string): Promise<Record<string, string>> {
  if (hasDatabase()) {
    const result = await dbQuery('SELECT config FROM platform_configs WHERE platform = $1', [platform]);
    if (result.rows.length > 0) return result.rows[0].config as Record<string, string>;
    return {};
  }
  return inMemoryPlatformConfigs.get(platform)?.config ?? {};
}

async function isPlatformEnabled(platform: string): Promise<boolean> {
  if (hasDatabase()) {
    const result = await dbQuery('SELECT enabled FROM platform_configs WHERE platform = $1', [platform]);
    return result.rows.length > 0 ? Boolean(result.rows[0].enabled) : false;
  }
  return inMemoryPlatformConfigs.get(platform)?.enabled ?? false;
}

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
    email: 'danayipah@gmail.com',
    password: 'DanAyipah#1',
    role: 'admin',
  });
  upsertInMemoryUser({
    id: 'platform-user-1',
    name: 'User One',
    username: 'user',
    email: 'dakyayipah@gmail.com',
    password: 'User',
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

ensureDatabase()
  .then(() => ensureSeedUsers())
  .then(() => ensureSeedPricingPlans())
  .catch((err) => {
    dbReady = false;
    seedInMemoryUsers();
    console.error('Database initialization failed:', err);
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
    dateJoined: user.created_at ? new Date(user.created_at).toISOString().slice(0, 10) : new Date().toISOString().slice(0, 10),
    lastLogin: user.last_login_at ? new Date(user.last_login_at).toISOString().slice(0, 16).replace('T', ' ') : 'Never',
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
    email: 'danayipah@gmail.com',
    password: 'DanAyipah#1',
    role: 'admin',
  });
  await ensureSeedUser({
    name: 'User One',
    username: 'user',
    email: 'dakyayipah@gmail.com',
    password: 'User',
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

// OAuth Exchange Functions — credentials read from DB first, then env vars
async function exchangeInstagramCode(code: string) {
  const cfg = await getPlatformConfig('instagram');
  const data = new URLSearchParams({
    client_id: cfg.appId || process.env.VITE_INSTAGRAM_APP_ID || '',
    client_secret: cfg.appSecret || process.env.INSTAGRAM_APP_SECRET || '',
    grant_type: 'authorization_code',
    redirect_uri: cfg.redirectUri || resolveRedirectUri(process.env.VITE_INSTAGRAM_REDIRECT_URI),
    code,
  });
  const response = await axios.post('https://api.instagram.com/oauth/access_token', data, {
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
  });
  return response.data;
}

async function exchangeTwitterCode(code: string) {
  const cfg = await getPlatformConfig('twitter');
  const response = await axios.post('https://api.twitter.com/2/oauth2/token', {
    client_id: cfg.clientId || process.env.VITE_TWITTER_CLIENT_ID,
    client_secret: cfg.clientSecret || process.env.TWITTER_CLIENT_SECRET,
    code,
    grant_type: 'authorization_code',
    redirect_uri: cfg.redirectUri || process.env.VITE_TWITTER_REDIRECT_URI,
    code_verifier: 'challenge',
  });
  return response.data;
}

async function exchangeLinkedInCode(code: string) {
  const cfg = await getPlatformConfig('linkedin');
  const response = await axios.post('https://www.linkedin.com/oauth/v2/accessToken', {
    grant_type: 'authorization_code',
    code,
    redirect_uri: cfg.redirectUri || process.env.VITE_LINKEDIN_REDIRECT_URI,
    client_id: cfg.clientId || process.env.VITE_LINKEDIN_CLIENT_ID,
    client_secret: cfg.clientSecret || process.env.LINKEDIN_CLIENT_SECRET,
  });
  return response.data;
}

async function exchangeFacebookCode(code: string) {
  const cfg = await getPlatformConfig('facebook');
  const response = await axios.get('https://graph.facebook.com/v18.0/oauth/access_token', {
    params: {
      client_id: cfg.appId || process.env.VITE_FACEBOOK_APP_ID,
      client_secret: cfg.appSecret || process.env.FACEBOOK_APP_SECRET,
      redirect_uri: cfg.redirectUri || process.env.VITE_FACEBOOK_REDIRECT_URI,
      code,
    },
  });
  return response.data;
}

async function exchangeTikTokCode(code: string) {
  const cfg = await getPlatformConfig('tiktok');
  const response = await axios.post('https://open.tiktokapis.com/v2/oauth/token/', {
    client_key: cfg.clientKey || process.env.VITE_TIKTOK_CLIENT_ID,
    client_secret: cfg.clientSecret || process.env.TIKTOK_CLIENT_SECRET,
    code,
    grant_type: 'authorization_code',
    redirect_uri: cfg.redirectUri || process.env.VITE_TIKTOK_REDIRECT_URI,
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
        'SELECT id, name, description, price, billing_period, features, is_active, discount_percentage, is_on_sale, created_at, updated_at FROM pricing_plans ORDER BY created_at DESC'
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
        discountPercentage: parseFloat(String(p.discount_percentage ?? 0)),
        isOnSale: p.is_on_sale ?? false,
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

    const { name, description, price, billingPeriod, features, discountPercentage, isOnSale } = req.body;
    if (!name || !description || price === undefined) {
      return res
        .status(400)
        .json({ success: false, error: 'Name, description, and price are required' });
    }

    const id = randomUUID();
    const now = new Date().toISOString();
    const discPct = Number(discountPercentage ?? 0);
    const onSale = Boolean(isOnSale ?? false);

    if (!hasDatabase()) {
      const plan: DbPricingPlan = {
        id,
        name,
        description,
        price: Number(price),
        billing_period: (billingPeriod || 'monthly') as 'monthly' | 'yearly',
        features: Array.isArray(features) ? features : [],
        is_active: true,
        discount_percentage: discPct,
        is_on_sale: onSale,
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
          discountPercentage: plan.discount_percentage,
          isOnSale: plan.is_on_sale,
          createdAt: plan.created_at,
          updatedAt: plan.updated_at,
        },
      });
    } else {
      const result = await dbQuery<DbPricingPlan>(
        'INSERT INTO pricing_plans (id, name, description, price, billing_period, features, is_active, discount_percentage, is_on_sale, created_at, updated_at) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $10) RETURNING *',
        [
          id,
          name,
          description,
          Number(price),
          billingPeriod || 'monthly',
          features || [],
          true,
          discPct,
          onSale,
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
          discountPercentage: parseFloat(String(plan.discount_percentage ?? 0)),
          isOnSale: plan.is_on_sale ?? false,
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
    const { name, description, price, billingPeriod, features, isActive, discountPercentage, isOnSale } = req.body;

    if (!name || !description || price === undefined) {
      return res
        .status(400)
        .json({ success: false, error: 'Name, description, and price are required' });
    }

    const now = new Date().toISOString();
    const discPct = Number(discountPercentage ?? 0);
    const onSale = Boolean(isOnSale ?? false);

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
        discount_percentage: discPct,
        is_on_sale: onSale,
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
          discountPercentage: updated.discount_percentage,
          isOnSale: updated.is_on_sale,
          createdAt: updated.created_at,
          updatedAt: updated.updated_at,
        },
      });
    } else {
      const result = await dbQuery<DbPricingPlan>(
        'UPDATE pricing_plans SET name = $1, description = $2, price = $3, billing_period = $4, features = $5, is_active = $6, discount_percentage = $7, is_on_sale = $8, updated_at = $9 WHERE id = $10 RETURNING *',
        [
          name,
          description,
          Number(price),
          billingPeriod || 'monthly',
          features || [],
          isActive !== undefined ? isActive : true,
          discPct,
          onSale,
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
          discountPercentage: parseFloat(String(plan.discount_percentage ?? 0)),
          isOnSale: plan.is_on_sale ?? false,
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
    const { name, description, designData, coverImageUrl } = req.body;

    if (!name || !designData) {
      return res.status(400).json({ success: false, error: 'Name and designData are required' });
    }

    const now = new Date().toISOString();
    const hasCover = coverImageUrl !== undefined && coverImageUrl !== null;

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
        ...(hasCover && { cover_image_url: coverImageUrl as string }),
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
      if (hasCover) {
        await dbQuery(
          'UPDATE card_templates SET name = $1, description = $2, design_data = $3, cover_image_url = $4, updated_at = $5 WHERE id = $6',
          [name, description || '', JSON.stringify(designData), coverImageUrl, now, id]
        );
      } else {
        await dbQuery(
          'UPDATE card_templates SET name = $1, description = $2, design_data = $3, updated_at = $4 WHERE id = $5',
          [name, description || '', JSON.stringify(designData), now, id]
        );
      }

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
    const coverUrl = typeof coverImageUrl === 'string' ? coverImageUrl : '';

    const now = new Date().toISOString();

    if (!hasDatabase()) {
      const existing = inMemoryCardTemplatesById.get(id);
      if (!existing) {
        return res.status(404).json({ success: false, error: 'Card template not found' });
      }

      const updated: DbCardTemplate = {
        ...existing,
        cover_image_url: coverUrl,
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
        [coverUrl, now, id]
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

app.post('/api/card-templates/:id/unpublish', async (req: Request, res: Response) => {
  try {
    const admin = await requireAdmin(req, res);
    if (!admin) return;

    const { id } = req.params;
    const now = new Date().toISOString();

    if (!hasDatabase()) {
      const existing = inMemoryCardTemplatesById.get(id);
      if (!existing) {
        return res.status(404).json({ success: false, error: 'Card template not found' });
      }
      inMemoryCardTemplatesById.set(id, { ...existing, is_published: false, updated_at: now });
      return res.json({ success: true });
    } else {
      await dbQuery(
        'UPDATE card_templates SET is_published = false, updated_at = $1 WHERE id = $2',
        [now, id]
      );
      return res.json({ success: true });
    }
  } catch (error) {
    console.error('Unpublish card template error:', error);
    return res.status(500).json({ success: false, error: 'Failed to unpublish card template' });
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

// ─── User Designs Routes ──────────────────────────────────────────────────────

interface DbDesign {
  id: string;
  user_id: string;
  name: string;
  canvas_width: number;
  canvas_height: number;
  canvas_data: object;
  thumbnail_url: string | null;
  created_at: string;
  updated_at: string;
}

const inMemoryDesigns = new Map<string, DbDesign>();

// GET /api/designs — list current user's designs
app.get('/api/designs', async (req: Request, res: Response) => {
  try {
    const auth = requireAuth(req, res);
    if (!auth) return;

    if (hasDatabase()) {
      const result = await dbQuery(
        'SELECT * FROM user_designs WHERE user_id = $1 ORDER BY updated_at DESC',
        [auth.userId],
      );
      return res.json({ success: true, designs: result.rows });
    } else {
      const designs = Array.from(inMemoryDesigns.values())
        .filter((d) => d.user_id === auth.userId)
        .sort((a, b) => b.updated_at.localeCompare(a.updated_at));
      return res.json({ success: true, designs });
    }
  } catch (error) {
    console.error('Get designs error:', error);
    return res.status(500).json({ success: false, error: 'Failed to fetch designs' });
  }
});

// GET /api/designs/:id — get a single design
app.get('/api/designs/:id', async (req: Request, res: Response) => {
  try {
    const auth = requireAuth(req, res);
    if (!auth) return;
    const { id } = req.params;

    if (hasDatabase()) {
      const result = await dbQuery(
        'SELECT * FROM user_designs WHERE id = $1 AND user_id = $2',
        [id, auth.userId],
      );
      if (result.rows.length === 0)
        return res.status(404).json({ success: false, error: 'Design not found' });
      return res.json({ success: true, design: result.rows[0] });
    } else {
      const design = inMemoryDesigns.get(id);
      if (!design || design.user_id !== auth.userId)
        return res.status(404).json({ success: false, error: 'Design not found' });
      return res.json({ success: true, design });
    }
  } catch (error) {
    console.error('Get design error:', error);
    return res.status(500).json({ success: false, error: 'Failed to fetch design' });
  }
});

// POST /api/designs — create a new design
app.post('/api/designs', async (req: Request, res: Response) => {
  try {
    const auth = requireAuth(req, res);
    if (!auth) return;
    const { name, canvas_width, canvas_height, canvas_data, thumbnail_url } = req.body;
    const id = crypto.randomUUID();
    const now = new Date().toISOString();

    const design: DbDesign = {
      id,
      user_id: auth.userId,
      name: name || 'Untitled Design',
      canvas_width: canvas_width || 1080,
      canvas_height: canvas_height || 1080,
      canvas_data: canvas_data || {},
      thumbnail_url: thumbnail_url || null,
      created_at: now,
      updated_at: now,
    };

    if (hasDatabase()) {
      await dbQuery(
        `INSERT INTO user_designs (id, user_id, name, canvas_width, canvas_height, canvas_data, thumbnail_url, created_at, updated_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $8)`,
        [id, auth.userId, design.name, design.canvas_width, design.canvas_height, JSON.stringify(design.canvas_data), design.thumbnail_url, now],
      );
    } else {
      inMemoryDesigns.set(id, design);
    }

    return res.status(201).json({ success: true, design });
  } catch (error) {
    console.error('Create design error:', error);
    return res.status(500).json({ success: false, error: 'Failed to create design' });
  }
});

// PUT /api/designs/:id — update a design
app.put('/api/designs/:id', async (req: Request, res: Response) => {
  try {
    const auth = requireAuth(req, res);
    if (!auth) return;
    const { id } = req.params;
    const { name, canvas_width, canvas_height, canvas_data, thumbnail_url } = req.body;
    const now = new Date().toISOString();

    if (hasDatabase()) {
      const result = await dbQuery(
        `UPDATE user_designs
         SET name = COALESCE($1, name),
             canvas_width = COALESCE($2, canvas_width),
             canvas_height = COALESCE($3, canvas_height),
             canvas_data = COALESCE($4, canvas_data),
             thumbnail_url = COALESCE($5, thumbnail_url),
             updated_at = $6
         WHERE id = $7 AND user_id = $8
         RETURNING *`,
        [name, canvas_width, canvas_height, canvas_data ? JSON.stringify(canvas_data) : null, thumbnail_url, now, id, auth.userId],
      );
      if (result.rows.length === 0)
        return res.status(404).json({ success: false, error: 'Design not found' });
      return res.json({ success: true, design: result.rows[0] });
    } else {
      const design = inMemoryDesigns.get(id);
      if (!design || design.user_id !== auth.userId)
        return res.status(404).json({ success: false, error: 'Design not found' });
      const updated: DbDesign = {
        ...design,
        ...(name !== undefined && { name }),
        ...(canvas_width !== undefined && { canvas_width }),
        ...(canvas_height !== undefined && { canvas_height }),
        ...(canvas_data !== undefined && { canvas_data }),
        ...(thumbnail_url !== undefined && { thumbnail_url }),
        updated_at: now,
      };
      inMemoryDesigns.set(id, updated);
      return res.json({ success: true, design: updated });
    }
  } catch (error) {
    console.error('Update design error:', error);
    return res.status(500).json({ success: false, error: 'Failed to update design' });
  }
});

// DELETE /api/designs/:id — delete a design
app.delete('/api/designs/:id', async (req: Request, res: Response) => {
  try {
    const auth = requireAuth(req, res);
    if (!auth) return;
    const { id } = req.params;

    if (hasDatabase()) {
      await dbQuery('DELETE FROM user_designs WHERE id = $1 AND user_id = $2', [id, auth.userId]);
    } else {
      const design = inMemoryDesigns.get(id);
      if (design && design.user_id === auth.userId) inMemoryDesigns.delete(id);
    }
    return res.json({ success: true });
  } catch (error) {
    console.error('Delete design error:', error);
    return res.status(500).json({ success: false, error: 'Failed to delete design' });
  }
});

// ─── Platform Config Routes (Admin) ───────────────────────────────────────────

// GET /api/admin/platform-configs  — returns all configs with secrets masked
app.get('/api/admin/platform-configs', async (req: Request, res: Response) => {
  try {
    const admin = await requireAdmin(req, res);
    if (!admin) return;

    const mask = (v: string | undefined) => (v && v.length > 4 ? '••••' + v.slice(-4) : v ? '••••' : '');

    const SECRET_FIELDS = ['appSecret', 'clientSecret', 'apiKey', 'accessToken', 'signingSecret', 'applicationPassword'];

    const maskConfig = (cfg: Record<string, string>) => {
      const out: Record<string, string> = {};
      for (const [k, v] of Object.entries(cfg)) {
        out[k] = SECRET_FIELDS.includes(k) ? mask(v) : v;
      }
      return out;
    };

    if (hasDatabase()) {
      const result = await dbQuery('SELECT platform, config, enabled, updated_at FROM platform_configs ORDER BY platform');
      const rows = result.rows.map((r: any) => ({ ...r, config: maskConfig(r.config) }));
      return res.json({ success: true, configs: rows });
    }

    const configs = Array.from(inMemoryPlatformConfigs.values()).map((r) => ({
      ...r,
      config: maskConfig(r.config),
    }));
    return res.json({ success: true, configs });
  } catch (error) {
    console.error('Get platform configs error:', error);
    return res.status(500).json({ success: false, error: 'Failed to fetch platform configs' });
  }
});

// GET /api/admin/platform-configs/:platform — returns raw config including secrets (admin only)
app.get('/api/admin/platform-configs/:platform', async (req: Request, res: Response) => {
  try {
    const admin = await requireAdmin(req, res);
    if (!admin) return;

    const { platform } = req.params;

    if (hasDatabase()) {
      const result = await dbQuery('SELECT platform, config, enabled, updated_at FROM platform_configs WHERE platform = $1', [platform]);
      if (result.rows.length === 0) return res.json({ success: true, config: null });
      return res.json({ success: true, config: result.rows[0] });
    }

    const cfg = inMemoryPlatformConfigs.get(platform);
    return res.json({ success: true, config: cfg ?? null });
  } catch (error) {
    console.error('Get platform config error:', error);
    return res.status(500).json({ success: false, error: 'Failed to fetch platform config' });
  }
});

// PUT /api/admin/platform-configs/:platform — save/update platform config
app.put('/api/admin/platform-configs/:platform', async (req: Request, res: Response) => {
  try {
    const admin = await requireAdmin(req, res);
    if (!admin) return;

    const { platform } = req.params;
    const { config, enabled } = req.body as { config: Record<string, string>; enabled: boolean };

    if (!config || typeof config !== 'object') {
      return res.status(400).json({ success: false, error: 'config object is required' });
    }

    const now = new Date().toISOString();

    if (hasDatabase()) {
      await dbQuery(
        `INSERT INTO platform_configs (platform, config, enabled, updated_at)
         VALUES ($1, $2, $3, NOW())
         ON CONFLICT (platform) DO UPDATE
           SET config = EXCLUDED.config, enabled = EXCLUDED.enabled, updated_at = NOW()`,
        [platform, JSON.stringify(config), Boolean(enabled)]
      );
    } else {
      inMemoryPlatformConfigs.set(platform, { platform, config, enabled: Boolean(enabled), updated_at: now });
    }

    return res.json({ success: true, message: 'Platform config saved' });
  } catch (error) {
    console.error('Save platform config error:', error);
    return res.status(500).json({ success: false, error: 'Failed to save platform config' });
  }
});

// ─── Hubtel Payment Routes ─────────────────────────────────────────────────────

async function getHubtelConfig(): Promise<{ clientId: string; clientSecret: string; merchantAccountNumber: string } | null> {
  const cfg = await getPlatformConfig('hubtel');
  const clientId = cfg.clientId || process.env.HUBTEL_CLIENT_ID || '';
  const clientSecret = cfg.clientSecret || process.env.HUBTEL_CLIENT_SECRET || '';
  const merchantAccountNumber = cfg.merchantAccountNumber || process.env.HUBTEL_MERCHANT_ACCOUNT_NUMBER || '';
  if (!clientId || !clientSecret) return null;
  return { clientId, clientSecret, merchantAccountNumber };
}

// POST /api/payments/hubtel/initiate — start a Hubtel checkout
app.post('/api/payments/hubtel/initiate', async (req: Request, res: Response) => {
  try {
    const auth = requireAuth(req, res);
    if (!auth) return;

    const {
      amount,
      description,
      customerName,
      customerEmail,
      customerMsisdn,
    } = req.body as {
      amount: number;
      description: string;
      customerName: string;
      customerEmail: string;
      customerMsisdn: string;
    };

    if (!amount || !customerName || !customerMsisdn) {
      return res.status(400).json({ success: false, error: 'amount, customerName, and customerMsisdn are required' });
    }

    const hubtel = await getHubtelConfig();
    if (!hubtel) {
      return res.status(503).json({ success: false, error: 'Hubtel is not configured. Add credentials in Admin > Payments.' });
    }

    const clientReference = randomUUID();
    const backendUrl = process.env.BACKEND_PUBLIC_URL || `https://contentflow-api.onrender.com`;

    const payload = {
      totalAmount: Number(amount),
      description: description || 'Payment',
      callbackUrl: `${backendUrl}/api/payments/hubtel/callback`,
      returnUrl: `${process.env.FRONTEND_ORIGIN || 'https://marketing.dakyworld.com'}/payments/success`,
      cancellationUrl: `${process.env.FRONTEND_ORIGIN || 'https://marketing.dakyworld.com'}/payments/cancel`,
      merchantAccountNumber: hubtel.merchantAccountNumber,
      clientReference,
    };

    const response = await axios.post('https://payproxyapi.hubtel.com/items/initiate', payload, {
      auth: { username: hubtel.clientId, password: hubtel.clientSecret },
      headers: { 'Content-Type': 'application/json' },
    });

    const checkoutUrl: string = response.data?.data?.checkoutUrl || response.data?.checkoutUrl || '';

    const txn: PaymentTransactionRow = {
      id: randomUUID(),
      amount: Number(amount),
      currency: 'GHS',
      description: description || null,
      status: 'pending',
      provider: 'hubtel',
      client_reference: clientReference,
      provider_reference: null,
      customer_name: customerName,
      customer_email: customerEmail || null,
      customer_phone: customerMsisdn,
      checkout_url: checkoutUrl,
      metadata: response.data || null,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };

    if (hasDatabase()) {
      await dbQuery(
        `INSERT INTO payment_transactions
           (id, amount, currency, description, status, provider, client_reference, customer_name, customer_email, customer_phone, checkout_url, metadata)
         VALUES ($1,$2,$3,$4,'pending','hubtel',$5,$6,$7,$8,$9,$10)`,
        [txn.id, txn.amount, txn.currency, txn.description, clientReference, customerName, customerEmail || null, customerMsisdn, checkoutUrl, JSON.stringify(txn.metadata)]
      );
    } else {
      inMemoryPaymentTransactions.unshift(txn);
    }

    return res.json({ success: true, checkoutUrl, clientReference });
  } catch (error: any) {
    console.error('Hubtel initiate error:', error?.response?.data || error);
    return res.status(502).json({ success: false, error: error?.response?.data?.message || 'Failed to initiate payment' });
  }
});

// POST /api/payments/hubtel/callback — Hubtel posts here after payment
app.post('/api/payments/hubtel/callback', async (req: Request, res: Response) => {
  try {
    const body = req.body as any;
    const clientReference: string = body?.Data?.ClientReference || body?.clientReference || '';
    const status: string = (body?.Data?.Status || body?.status || 'failed').toLowerCase();
    const providerRef: string = body?.Data?.TransactionId || body?.transactionId || '';

    const mappedStatus = status === 'successful' || status === 'success' ? 'successful' : status === 'pending' ? 'pending' : 'failed';

    if (clientReference) {
      if (hasDatabase()) {
        await dbQuery(
          `UPDATE payment_transactions SET status = $1, provider_reference = $2, updated_at = NOW(), metadata = metadata || $3::jsonb
           WHERE client_reference = $4`,
          [mappedStatus, providerRef, JSON.stringify({ hubtelCallback: body }), clientReference]
        );
      } else {
        const txn = inMemoryPaymentTransactions.find((t) => t.client_reference === clientReference);
        if (txn) { txn.status = mappedStatus; txn.provider_reference = providerRef; txn.updated_at = new Date().toISOString(); }
      }
    }

    return res.json({ success: true });
  } catch (error) {
    console.error('Hubtel callback error:', error);
    return res.status(500).json({ success: false, error: 'Callback processing failed' });
  }
});

// GET /api/payments/hubtel/verify/:clientReference — verify a payment status
app.get('/api/payments/hubtel/verify/:clientReference', async (req: Request, res: Response) => {
  try {
    const auth = requireAuth(req, res);
    if (!auth) return;

    const { clientReference } = req.params;
    const hubtel = await getHubtelConfig();

    if (hubtel) {
      try {
        const response = await axios.get(`https://api.hubtel.com/checkout/v1.1/merchant/transactions/status?clientReference=${clientReference}`, {
          auth: { username: hubtel.clientId, password: hubtel.clientSecret },
        });
        const remoteStatus = (response.data?.data?.status || '').toLowerCase();
        const mappedStatus = remoteStatus === 'successful' || remoteStatus === 'success' ? 'successful' : remoteStatus === 'pending' ? 'pending' : 'failed';

        if (hasDatabase()) {
          await dbQuery(`UPDATE payment_transactions SET status = $1, updated_at = NOW() WHERE client_reference = $2`, [mappedStatus, clientReference]);
        } else {
          const txn = inMemoryPaymentTransactions.find((t) => t.client_reference === clientReference);
          if (txn) txn.status = mappedStatus;
        }
        return res.json({ success: true, status: mappedStatus, data: response.data });
      } catch {
        // fall through to DB lookup
      }
    }

    // Fallback: return local status
    if (hasDatabase()) {
      const result = await dbQuery('SELECT status FROM payment_transactions WHERE client_reference = $1', [clientReference]);
      if (result.rows.length === 0) return res.status(404).json({ success: false, error: 'Transaction not found' });
      return res.json({ success: true, status: result.rows[0].status });
    }

    const txn = inMemoryPaymentTransactions.find((t) => t.client_reference === clientReference);
    if (!txn) return res.status(404).json({ success: false, error: 'Transaction not found' });
    return res.json({ success: true, status: txn.status });
  } catch (error) {
    console.error('Verify payment error:', error);
    return res.status(500).json({ success: false, error: 'Failed to verify payment' });
  }
});

// GET /api/admin/payments — list all transactions
app.get('/api/admin/payments', async (req: Request, res: Response) => {
  try {
    const admin = await requireAdmin(req, res);
    if (!admin) return;

    if (hasDatabase()) {
      const result = await dbQuery(
        `SELECT id, amount, currency, description, status, provider, client_reference, provider_reference,
                customer_name, customer_email, customer_phone, created_at, updated_at
         FROM payment_transactions ORDER BY created_at DESC LIMIT 200`
      );
      return res.json({ success: true, transactions: result.rows });
    }

    return res.json({ success: true, transactions: inMemoryPaymentTransactions.slice(0, 200) });
  } catch (error) {
    console.error('List payments error:', error);
    return res.status(500).json({ success: false, error: 'Failed to fetch transactions' });
  }
});

// GET /api/admin/payments/stats — revenue stats
app.get('/api/admin/payments/stats', async (req: Request, res: Response) => {
  try {
    const admin = await requireAdmin(req, res);
    if (!admin) return;

    if (hasDatabase()) {
      const result = await dbQuery(`
        SELECT
          COUNT(*)::int AS total,
          COUNT(*) FILTER (WHERE status = 'successful')::int AS successful,
          COUNT(*) FILTER (WHERE status = 'pending')::int AS pending,
          COUNT(*) FILTER (WHERE status = 'failed')::int AS failed,
          COALESCE(SUM(amount) FILTER (WHERE status = 'successful'), 0)::numeric AS revenue
        FROM payment_transactions
      `);
      return res.json({ success: true, stats: result.rows[0] });
    }

    const all = inMemoryPaymentTransactions;
    return res.json({
      success: true,
      stats: {
        total: all.length,
        successful: all.filter((t) => t.status === 'successful').length,
        pending: all.filter((t) => t.status === 'pending').length,
        failed: all.filter((t) => t.status === 'failed').length,
        revenue: all.filter((t) => t.status === 'successful').reduce((s, t) => s + t.amount, 0),
      },
    });
  } catch (error) {
    console.error('Payment stats error:', error);
    return res.status(500).json({ success: false, error: 'Failed to fetch payment stats' });
  }
});

// ── Integration helpers ────────────────────────────────────────────────────────

const OAUTH_AUTH_URLS: Record<string, { authUrl: string; scopes: string; idField: 'appId' | 'clientId' | 'clientKey' }> = {
  instagram: { authUrl: 'https://api.instagram.com/oauth/authorize', scopes: 'user_profile,user_media,instagram_basic,instagram_content_publish', idField: 'appId' },
  facebook:  { authUrl: 'https://www.facebook.com/v18.0/dialog/oauth', scopes: 'pages_manage_posts,pages_read_engagement,pages_show_list', idField: 'appId' },
  linkedin:  { authUrl: 'https://www.linkedin.com/oauth/v2/authorization', scopes: 'r_liteprofile,w_member_social,r_emailaddress', idField: 'clientId' },
  twitter:   { authUrl: 'https://twitter.com/i/oauth2/authorize', scopes: 'tweet.read tweet.write users.read offline.access', idField: 'clientId' },
  tiktok:    { authUrl: 'https://www.tiktok.com/oauth/authorize', scopes: 'user.info.basic,video.upload', idField: 'clientKey' },
  threads:   { authUrl: 'https://www.threads.net/oauth/authorize', scopes: 'threads_basic,threads_content_publish', idField: 'appId' },
};

// GET /api/oauth/:platform/authorize-url — build OAuth URL from DB-configured credentials
app.get('/api/oauth/:platform/authorize-url', async (req: Request, res: Response) => {
  try {
    const auth = requireAuth(req, res);
    if (!auth) return;

    const platform = req.params.platform.toLowerCase();
    const { state } = req.query as { state?: string };
    if (!state) return res.status(400).json({ success: false, error: 'Missing state' });

    const meta = OAUTH_AUTH_URLS[platform];
    if (!meta) return res.status(400).json({ success: false, error: 'Unsupported platform' });

    const cfg = await getPlatformConfig(platform);
    const clientId = cfg[meta.idField];
    const redirectUri = cfg.redirectUri;

    if (!clientId || !redirectUri) {
      return res.status(400).json({ success: false, error: 'Platform credentials not configured by admin' });
    }

    const params = new URLSearchParams({
      client_id: clientId,
      redirect_uri: redirectUri,
      response_type: 'code',
      state,
      scope: meta.scopes,
    });

    return res.json({ success: true, url: `${meta.authUrl}?${params.toString()}` });
  } catch (err) {
    console.error('Authorize URL error:', err);
    return res.status(500).json({ success: false, error: 'Failed to build authorization URL' });
  }
});

// GET /api/oauth/:platform/configured — check if admin has configured platform credentials (public)
app.get('/api/oauth/:platform/configured', async (req: Request, res: Response) => {
  try {
    const platform = req.params.platform.toLowerCase();
    const meta = OAUTH_AUTH_URLS[platform];
    if (!meta) return res.json({ success: true, configured: false });

    const cfg = await getPlatformConfig(platform);
    const clientId = cfg[meta.idField];
    const configured = Boolean(clientId && cfg.redirectUri);

    return res.json({ success: true, configured });
  } catch {
    return res.json({ success: true, configured: false });
  }
});

// POST /api/integrations/validate — server-side credential validation
app.post('/api/integrations/validate', async (req: Request, res: Response) => {
  try {
    const auth = requireAuth(req, res);
    if (!auth) return;

    const { platform, credentials } = req.body as { platform: string; credentials: Record<string, string> };

    switch (platform) {
      case 'wordpress': {
        const { siteUrl, username, applicationPassword } = credentials;
        const base = siteUrl.replace(/\/$/, '');
        const resp = await axios.get(`${base}/wp-json/wp/v2/users/me`, {
          auth: { username, password: applicationPassword },
          validateStatus: () => true,
          timeout: 8000,
        });
        if (resp.status === 200) return res.json({ success: true, handle: resp.data?.name || username });
        if (resp.status === 401) throw new Error('Invalid WordPress credentials');
        throw new Error(`WordPress site returned ${resp.status}`);
      }
      case 'mailchimp': {
        const { apiKey, serverPrefix } = credentials;
        const resp = await axios.get(`https://${serverPrefix}.api.mailchimp.com/3.0/`, {
          auth: { username: 'anystring', password: apiKey },
          validateStatus: () => true,
          timeout: 8000,
        });
        if (resp.status === 200) return res.json({ success: true });
        throw new Error('Invalid Mailchimp API key or server prefix');
      }
      case 'chatgpt': {
        const { apiKey } = credentials;
        const resp = await axios.get('https://api.openai.com/v1/models', {
          headers: { Authorization: `Bearer ${apiKey}` },
          validateStatus: () => true,
          timeout: 8000,
        });
        if (resp.status === 200) return res.json({ success: true });
        throw new Error('Invalid OpenAI API key');
      }
      case 'webflow': {
        const { apiToken } = credentials;
        const resp = await axios.get('https://api.webflow.com/v2/sites', {
          headers: { Authorization: `Bearer ${apiToken}` },
          validateStatus: () => true,
          timeout: 8000,
        });
        if (resp.status === 200) return res.json({ success: true });
        throw new Error('Invalid Webflow API token');
      }
      case 'stripe': {
        const { secretKey } = credentials;
        const resp = await axios.get('https://api.stripe.com/v1/account', {
          headers: { Authorization: `Bearer ${secretKey}` },
          validateStatus: () => true,
          timeout: 8000,
        });
        if (resp.status === 200) return res.json({ success: true });
        throw new Error('Invalid Stripe secret key');
      }
      case 'linear': {
        const { apiKey } = credentials;
        const resp = await axios.post(
          'https://api.linear.app/graphql',
          { query: '{ viewer { id name } }' },
          { headers: { Authorization: apiKey, 'Content-Type': 'application/json' }, validateStatus: () => true, timeout: 8000 }
        );
        if (resp.status === 200 && !resp.data?.errors) return res.json({ success: true });
        throw new Error('Invalid Linear API key');
      }
      case 'square': {
        const { accessToken } = credentials;
        const resp = await axios.get('https://connect.squareup.com/v2/locations', {
          headers: { Authorization: `Bearer ${accessToken}`, 'Square-Version': '2024-01-18' },
          validateStatus: () => true,
          timeout: 8000,
        });
        if (resp.status === 200) return res.json({ success: true });
        throw new Error('Invalid Square access token');
      }
      case 'zapier': {
        const { webhookUrl } = credentials;
        if (!webhookUrl?.startsWith('https://')) throw new Error('Invalid webhook URL');
        const resp = await axios.post(webhookUrl, { test: true, source: 'ContentFlow' }, { validateStatus: () => true, timeout: 8000 });
        if (resp.status < 400) return res.json({ success: true });
        throw new Error(`Webhook returned status ${resp.status}`);
      }
      default:
        // No validation available (Framer, Brave, etc.) — accept as-is
        return res.json({ success: true });
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Validation failed';
    return res.status(400).json({ success: false, error: message });
  }
});

// ─── Social Login OAuth Flow ───────────────────────────────────────────────────

const SOCIAL_PROVIDER_CONFIG: Record<string, { authUrl: string; tokenUrl: string; userInfoUrl: string; scopes: string }> = {
  google: {
    authUrl: 'https://accounts.google.com/o/oauth2/v2/auth',
    tokenUrl: 'https://oauth2.googleapis.com/token',
    userInfoUrl: 'https://www.googleapis.com/oauth2/v3/userinfo',
    scopes: 'openid email profile',
  },
  github: {
    authUrl: 'https://github.com/login/oauth/authorize',
    tokenUrl: 'https://github.com/login/oauth/access_token',
    userInfoUrl: 'https://api.github.com/user',
    scopes: 'read:user user:email',
  },
  microsoft: {
    authUrl: 'https://login.microsoftonline.com/{tenantId}/oauth2/v2.0/authorize',
    tokenUrl: 'https://login.microsoftonline.com/{tenantId}/oauth2/v2.0/token',
    userInfoUrl: 'https://graph.microsoft.com/v1.0/me',
    scopes: 'openid email profile',
  },
};

// GET /api/auth/:provider/start — redirect to provider's OAuth page
app.get('/api/auth/:provider/start', async (req: Request, res: Response) => {
  try {
    const { provider } = req.params as { provider: string };
    const cfg = SOCIAL_PROVIDER_CONFIG[provider];
    if (!cfg) return res.status(404).json({ success: false, error: 'Unknown provider' });

    const providerRow = await dbQuery('SELECT config, enabled FROM auth_providers WHERE provider = $1', [provider]).catch(() => ({ rows: [] }));
    if (!providerRow.rows.length || !providerRow.rows[0].enabled) {
      return res.status(403).json({ success: false, error: 'Provider not enabled' });
    }
    const config = providerRow.rows[0].config as Record<string, string>;
    const clientId = config.clientId || '';
    const redirectUri = config.redirectUri || '';
    if (!clientId || !redirectUri) return res.status(400).json({ success: false, error: 'Provider not configured' });

    const state = randomBytes(16).toString('hex');
    // Store state temporarily (10 min TTL) in DB or a small in-memory map
    (app.locals as Record<string, unknown>)[`oauth_state_${state}`] = { provider, expiry: Date.now() + 600_000 };

    let authUrl = cfg.authUrl.replace('{tenantId}', config.tenantId || 'common');
    const params = new URLSearchParams({
      client_id: clientId,
      redirect_uri: redirectUri,
      response_type: 'code',
      scope: cfg.scopes,
      state,
      access_type: 'offline',
      prompt: 'select_account',
    });
    return res.redirect(`${authUrl}?${params.toString()}`);
  } catch (error) {
    console.error('Social auth start error:', error);
    return res.status(500).json({ success: false, error: 'Failed to start social login' });
  }
});

// GET /auth/:provider/callback — handle OAuth callback, issue JWT
app.get('/auth/:provider/callback', async (req: Request, res: Response) => {
  const FRONTEND_URL = process.env.VITE_APP_URL || process.env.FRONTEND_URL || 'https://marketing.dakyworld.com';
  try {
    const { provider } = req.params as { provider: string };
    const { code, state, error: oauthError } = req.query as Record<string, string>;
    if (oauthError) return res.redirect(`${FRONTEND_URL}/?auth_error=${encodeURIComponent(oauthError)}`);

    // Validate state
    const stateKey = `oauth_state_${state}`;
    const storedState = (app.locals as Record<string, unknown>)[stateKey] as { provider: string; expiry: number } | undefined;
    if (!storedState || storedState.provider !== provider || Date.now() > storedState.expiry) {
      return res.redirect(`${FRONTEND_URL}/?auth_error=${encodeURIComponent('Invalid or expired state')}`);
    }
    delete (app.locals as Record<string, unknown>)[stateKey];

    const cfg = SOCIAL_PROVIDER_CONFIG[provider];
    if (!cfg) return res.redirect(`${FRONTEND_URL}/?auth_error=unknown_provider`);

    const providerRow = await dbQuery('SELECT config FROM auth_providers WHERE provider = $1', [provider]).catch(() => ({ rows: [] }));
    if (!providerRow.rows.length) return res.redirect(`${FRONTEND_URL}/?auth_error=provider_not_configured`);
    const config = providerRow.rows[0].config as Record<string, string>;

    // Exchange code for token
    const tokenUrl = cfg.tokenUrl.replace('{tenantId}', config.tenantId || 'common');
    const tokenRes = await axios.post<Record<string, string>>(tokenUrl, new URLSearchParams({
      client_id: config.clientId || '',
      client_secret: config.clientSecret || '',
      code: code || '',
      redirect_uri: config.redirectUri || '',
      grant_type: 'authorization_code',
    }).toString(), {
      headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' },
    });

    const accessToken = tokenRes.data.access_token;
    if (!accessToken) throw new Error('No access token received');

    // Fetch user info
    const userInfoUrl = cfg.userInfoUrl;
    const userRes = await axios.get<Record<string, string>>(userInfoUrl, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    const userInfo = userRes.data;
    const email = userInfo.email || userInfo.mail || `${userInfo.login || 'user'}@${provider}.social`;
    const name = userInfo.name || userInfo.displayName || email.split('@')[0];
    const socialId = userInfo.sub || userInfo.id || email;

    if (!email) return res.redirect(`${FRONTEND_URL}/?auth_error=no_email`);

    // Find or create user in DB
    let userId: string;
    let userRole = 'user';
    if (hasDatabase()) {
      const existing = await dbQuery('SELECT id, role FROM users WHERE email = $1', [email]);
      if (existing.rows.length > 0) {
        userId = existing.rows[0].id as string;
        userRole = existing.rows[0].role as string;
        await dbQuery('UPDATE users SET last_login_at = NOW() WHERE id = $1', [userId]);
      } else {
        userId = randomUUID();
        const username = `${provider}_${(socialId as string).slice(0, 8)}`;
        await dbQuery(
          `INSERT INTO users (id, name, username, email, password_hash, role, status, created_at, last_login_at)
           VALUES ($1, $2, $3, $4, $5, 'user', 'active', NOW(), NOW())`,
          [userId, name, username, email, await bcrypt.hash(randomBytes(16).toString('hex'), 10)],
        );
      }
    } else {
      // In-memory fallback
      userId = randomUUID();
    }

    const token = jwt.sign({ userId, email, role: userRole }, JWT_SECRET, { expiresIn: '24h' });
    return res.redirect(`${FRONTEND_URL}/?auth_token=${token}&auth_provider=${provider}`);
  } catch (error) {
    console.error('Social auth callback error:', error);
    const FRONTEND_URL = process.env.VITE_APP_URL || process.env.FRONTEND_URL || 'https://marketing.dakyworld.com';
    return res.redirect(`${FRONTEND_URL}/?auth_error=${encodeURIComponent('Social login failed')}`);
  }
});

// ─── Auth Providers Routes ─────────────────────────────────────────────────────

// GET /api/auth/providers — public: returns only enabled providers (for login page)
app.get('/api/auth/providers', async (req: Request, res: Response) => {
  try {
    if (hasDatabase()) {
      const result = await dbQuery('SELECT provider, config FROM auth_providers WHERE enabled = true ORDER BY provider');
      return res.json({
        success: true,
        providers: result.rows.map((r: any) => ({
          provider: r.provider as string,
          // Only return public-safe fields (client_id / app_id, not secret)
          clientId: (r.config as Record<string, string>).clientId || '',
        })),
      });
    }
    return res.json({ success: true, providers: [] });
  } catch (error) {
    console.error('Get auth providers error:', error);
    return res.status(500).json({ success: false, error: 'Failed to fetch providers' });
  }
});

// POST /api/auth/facebook/token — verify FB JS SDK access token, sign in / register user
app.post('/api/auth/facebook/token', async (req: Request, res: Response) => {
  try {
    const { accessToken } = req.body as { accessToken?: string };
    if (!accessToken) return res.status(400).json({ success: false, error: 'Access token required' });

    // Verify token and fetch profile via Graph API
    const graphRes = await axios.get<{ id: string; name?: string; email?: string }>(
      'https://graph.facebook.com/me',
      { params: { fields: 'id,name,email', access_token: accessToken } },
    );
    const { id: fbId, name: fbName, email: fbEmail } = graphRes.data;
    if (!fbId) return res.status(401).json({ success: false, error: 'Could not verify Facebook token' });

    const email = fbEmail || `fb_${fbId}@facebook.social`;
    const name  = fbName  || email.split('@')[0];

    let userId: string;
    let userRole = 'user';

    if (hasDatabase()) {
      const existing = await dbQuery('SELECT id, role FROM users WHERE email = $1', [email]);
      if (existing.rows.length > 0) {
        userId   = existing.rows[0].id as string;
        userRole = existing.rows[0].role as string;
        await dbQuery('UPDATE users SET last_login_at = NOW() WHERE id = $1', [userId]);
      } else {
        userId = randomUUID();
        const username = `fb_${fbId.slice(0, 8)}`;
        await dbQuery(
          `INSERT INTO users (id, name, username, email, password_hash, role, status, created_at, last_login_at)
           VALUES ($1, $2, $3, $4, $5, 'user', 'active', NOW(), NOW())`,
          [userId, name, username, email, await bcrypt.hash(randomBytes(16).toString('hex'), 10)],
        );
      }
    } else {
      userId = randomUUID();
    }

    const token = jwt.sign({ userId, email, role: userRole }, JWT_SECRET, { expiresIn: '7d' });
    return res.json({ success: true, token, user: { id: userId, email, name, role: userRole } });
  } catch (error) {
    console.error('Facebook token auth error:', error);
    return res.status(401).json({ success: false, error: 'Facebook authentication failed' });
  }
});

// GET /api/admin/auth-providers — admin: returns all providers with full config
app.get('/api/admin/auth-providers', async (req: Request, res: Response) => {
  try {
    const admin = await requireAdmin(req, res);
    if (!admin) return;
    if (hasDatabase()) {
      const result = await dbQuery('SELECT provider, config, enabled, updated_at FROM auth_providers ORDER BY provider');
      return res.json({ success: true, providers: result.rows });
    }
    return res.json({ success: true, providers: [] });
  } catch (error) {
    console.error('Get admin auth providers error:', error);
    return res.status(500).json({ success: false, error: 'Failed to fetch auth providers' });
  }
});

// PUT /api/admin/auth-providers/:provider — save/update provider config + enabled toggle
app.put('/api/admin/auth-providers/:provider', async (req: Request, res: Response) => {
  try {
    const admin = await requireAdmin(req, res);
    if (!admin) return;
    const { provider } = req.params as { provider: string };
    const { config, enabled } = req.body as { config: Record<string, string>; enabled: boolean };
    if (!provider) return res.status(400).json({ success: false, error: 'Provider required' });
    if (hasDatabase()) {
      await dbQuery(
        `INSERT INTO auth_providers (provider, config, enabled, updated_at)
         VALUES ($1, $2, $3, NOW())
         ON CONFLICT (provider) DO UPDATE
           SET config = EXCLUDED.config, enabled = EXCLUDED.enabled, updated_at = NOW()`,
        [provider, JSON.stringify(config ?? {}), Boolean(enabled)],
      );
      return res.json({ success: true });
    }
    return res.json({ success: true });
  } catch (error) {
    console.error('Save auth provider error:', error);
    return res.status(500).json({ success: false, error: 'Failed to save auth provider' });
  }
});

// ─── Integration Enabled List ──────────────────────────────────────────────────

// GET /api/integrations/enabled — returns list of integration IDs admin has enabled
app.get('/api/integrations/enabled', async (req: Request, res: Response) => {
  try {
    if (hasDatabase()) {
      const result = await dbQuery('SELECT platform FROM platform_configs WHERE enabled = true');
      return res.json({ success: true, enabled: result.rows.map((r: any) => r.platform as string) });
    }
    return res.json({ success: true, enabled: [] });
  } catch (error) {
    console.error('Get enabled integrations error:', error);
    return res.status(500).json({ success: false, error: 'Failed to fetch enabled integrations' });
  }
});

// PATCH /api/admin/platform-configs/:platform/toggle — toggle enabled without changing config
app.patch('/api/admin/platform-configs/:platform/toggle', async (req: Request, res: Response) => {
  try {
    const admin = await requireAdmin(req, res);
    if (!admin) return;
    const { platform } = req.params as { platform: string };
    const { enabled } = req.body as { enabled: boolean };
    if (!platform) return res.status(400).json({ success: false, error: 'Platform required' });
    if (hasDatabase()) {
      await dbQuery(
        `INSERT INTO platform_configs (platform, config, enabled, updated_at)
         VALUES ($1, '{}', $2, NOW())
         ON CONFLICT (platform) DO UPDATE SET enabled = EXCLUDED.enabled, updated_at = NOW()`,
        [platform, Boolean(enabled)],
      );
      return res.json({ success: true, enabled: Boolean(enabled) });
    }
    return res.json({ success: true, enabled: Boolean(enabled) });
  } catch (error) {
    console.error('Toggle platform config error:', error);
    return res.status(500).json({ success: false, error: 'Failed to toggle integration' });
  }
});

// GET /api/admin/platform-configs/:platform/test — test/validate platform credentials
app.get('/api/admin/platform-configs/:platform/test', async (req: Request, res: Response) => {
  try {
    const admin = await requireAdmin(req, res);
    if (!admin) return;
    const platform = req.params.platform.toLowerCase();
    const cfg = await getPlatformConfig(platform);

    switch (platform) {
      case 'wordpress': {
        const { siteUrl, username, applicationPassword } = cfg;
        if (!siteUrl || !username || !applicationPassword) {
          return res.json({ success: false, error: 'Missing WordPress credentials' });
        }
        const base = siteUrl.replace(/\/$/, '');
        const resp = await axios.get(`${base}/wp-json/wp/v2/users/me`, {
          auth: { username, password: applicationPassword },
          validateStatus: () => true,
          timeout: 8000,
        });
        if (resp.status === 200) return res.json({ success: true, message: `Connected as ${resp.data?.name || username}` });
        return res.json({ success: false, error: `WordPress returned ${resp.status}` });
      }
      case 'mailchimp': {
        const { apiKey, serverPrefix } = cfg;
        if (!apiKey || !serverPrefix) return res.json({ success: false, error: 'Missing Mailchimp credentials' });
        const resp = await axios.get(`https://${serverPrefix}.api.mailchimp.com/3.0/`, {
          auth: { username: 'anystring', password: apiKey },
          validateStatus: () => true,
          timeout: 8000,
        });
        if (resp.status === 200) return res.json({ success: true, message: 'Mailchimp credentials valid' });
        return res.json({ success: false, error: 'Invalid Mailchimp API key or server prefix' });
      }
      case 'chatgpt': {
        const { apiKey } = cfg;
        if (!apiKey) return res.json({ success: false, error: 'Missing OpenAI API key' });
        const resp = await axios.get('https://api.openai.com/v1/models', {
          headers: { Authorization: `Bearer ${apiKey}` },
          validateStatus: () => true,
          timeout: 8000,
        });
        if (resp.status === 200) return res.json({ success: true, message: 'OpenAI credentials valid' });
        return res.json({ success: false, error: 'Invalid OpenAI API key' });
      }
      case 'webflow': {
        const { apiToken } = cfg;
        if (!apiToken) return res.json({ success: false, error: 'Missing Webflow API token' });
        const resp = await axios.get('https://api.webflow.com/v2/sites', {
          headers: { Authorization: `Bearer ${apiToken}`, 'accept-version': '1.0.0' },
          validateStatus: () => true,
          timeout: 8000,
        });
        if (resp.status === 200) return res.json({ success: true, message: 'Webflow credentials valid' });
        return res.json({ success: false, error: 'Invalid Webflow API token' });
      }
      case 'stripe': {
        const { secretKey } = cfg;
        if (!secretKey) return res.json({ success: false, error: 'Missing Stripe secret key' });
        const resp = await axios.get('https://api.stripe.com/v1/balance', {
          headers: { Authorization: `Bearer ${secretKey}` },
          validateStatus: () => true,
          timeout: 8000,
        });
        if (resp.status === 200) return res.json({ success: true, message: 'Stripe credentials valid' });
        return res.json({ success: false, error: 'Invalid Stripe secret key' });
      }
      case 'linear': {
        const { apiKey } = cfg;
        if (!apiKey) return res.json({ success: false, error: 'Missing Linear API key' });
        const resp = await axios.post('https://api.linear.app/graphql', { query: '{ viewer { id name } }' }, {
          headers: { Authorization: apiKey, 'Content-Type': 'application/json' },
          validateStatus: () => true,
          timeout: 8000,
        });
        if (resp.status === 200 && resp.data?.data?.viewer) return res.json({ success: true, message: `Connected as ${resp.data.data.viewer.name}` });
        return res.json({ success: false, error: 'Invalid Linear API key' });
      }
      default: {
        // For OAuth platforms (instagram, facebook, etc.) — check credentials are set
        const meta = OAUTH_AUTH_URLS[platform];
        if (!meta) return res.json({ success: false, error: 'Unsupported platform' });
        const clientId = cfg[meta.idField];
        if (!clientId || !cfg.redirectUri) return res.json({ success: false, error: 'Credentials not configured' });
        return res.json({ success: true, message: 'Credentials are saved. Test the OAuth flow by clicking "Test OAuth" on the user page.' });
      }
    }
  } catch (err) {
    console.error('Platform test error:', err);
    return res.status(500).json({ success: false, error: 'Test failed' });
  }
});

// ─── Page Content ────────────────────────────────────────────────────────────
app.get('/api/pages/:slug', async (req: Request, res: Response) => {
  const { slug } = req.params;
  if (!hasDatabase()) return res.json({ success: true, content: null });
  try {
    const { rows } = await pool!.query('SELECT content FROM page_content WHERE slug = $1', [slug]);
    return res.json({ success: true, content: rows[0]?.content ?? null });
  } catch (err) {
    console.error('page_content GET error:', err);
    return res.status(500).json({ success: false, error: 'Failed to fetch page content' });
  }
});

app.put('/api/pages/:slug', async (req: Request, res: Response) => {
  const admin = await requireAdmin(req, res);
  if (!admin) return;
  const { slug } = req.params;
  const { content } = req.body as { content: unknown };
  if (!content || typeof content !== 'object') return res.status(400).json({ success: false, error: 'content must be an object' });
  if (!hasDatabase()) return res.json({ success: true });
  try {
    await pool!.query(
      `INSERT INTO page_content (slug, content, updated_at) VALUES ($1, $2, NOW())
       ON CONFLICT (slug) DO UPDATE SET content = EXCLUDED.content, updated_at = NOW()`,
      [slug, JSON.stringify(content)]
    );
    return res.json({ success: true });
  } catch (err) {
    console.error('page_content PUT error:', err);
    return res.status(500).json({ success: false, error: 'Failed to save page content' });
  }
});

// ─── Media Library ───────────────────────────────────────────────────────────

function sanitizeFileName(name: string): string {
  return name.replace(/[^a-zA-Z0-9.\-_]/g, '-').replace(/-{2,}/g, '-').replace(/^-|-$/g, '');
}

// Upload image to media library
app.post('/api/media/upload', async (req: Request, res: Response) => {
  const user = await requireAuth(req, res);
  if (!user) return;
  const { url, thumbnail_url, file_name, original_name, file_size, file_type, width, height, category } =
    req.body as {
      url: string; thumbnail_url?: string; file_name: string; original_name: string;
      file_size: number; file_type: string; width?: number; height?: number; category?: string;
    };
  if (!url || !file_name || !original_name || !file_type)
    return res.status(400).json({ success: false, error: 'Missing required fields' });
  const allowedTypes = ['image/jpeg', 'image/png', 'image/webp', 'image/svg+xml'];
  if (!allowedTypes.includes(file_type))
    return res.status(400).json({ success: false, error: 'Unsupported image type' });
  const MAX_SIZE = 10 * 1024 * 1024;
  if (file_size > MAX_SIZE)
    return res.status(400).json({ success: false, error: 'Image exceeds the maximum upload size of 10MB.' });
  if (!hasDatabase()) return res.status(503).json({ success: false, error: 'No database' });
  try {
    const id = randomUUID();
    const safeName = sanitizeFileName(file_name);
    const imgCategory = category === 'admin' ? 'admin' : 'user';
    const { rows } = await pool!.query(
      `INSERT INTO media_images (id, user_id, file_name, original_name, file_size, file_type, width, height, url, thumbnail_url, tags, used_in, category)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,'{}','[]',$11) RETURNING *`,
      [id, user.userId, safeName, original_name, file_size ?? 0, file_type, width ?? null, height ?? null, url, thumbnail_url ?? url, imgCategory]
    );
    return res.json({ success: true, image: rows[0] });
  } catch (err) {
    console.error('media upload error:', err);
    return res.status(500).json({ success: false, error: 'Upload failed' });
  }
});

// List user's media images
app.get('/api/media', async (req: Request, res: Response) => {
  const user = await requireAuth(req, res);
  if (!user) return;
  if (!hasDatabase()) return res.json({ success: true, images: [] });
  const { search, tag } = req.query as { search?: string; tag?: string };
  try {
    const params: unknown[] = [user.userId];
    let query = 'SELECT * FROM media_images WHERE user_id = $1';
    if (search) { query += ` AND (file_name ILIKE $${params.length + 1} OR original_name ILIKE $${params.length + 1})`; params.push(`%${search}%`); }
    if (tag) { query += ` AND $${params.length + 1} = ANY(tags)`; params.push(tag); }
    query += ' ORDER BY upload_date DESC';
    const { rows } = await pool!.query(query, params);
    return res.json({ success: true, images: rows });
  } catch (err) {
    console.error('media list error:', err);
    return res.status(500).json({ success: false, error: 'Failed to fetch images' });
  }
});

// Update image metadata (rename / tags)
app.put('/api/media/:id', async (req: Request, res: Response) => {
  const user = await requireAuth(req, res);
  if (!user) return;
  const { id } = req.params;
  const { file_name, tags } = req.body as { file_name?: string; tags?: string[] };
  if (!hasDatabase()) return res.status(503).json({ success: false, error: 'No database' });
  try {
    const updates: string[] = [];
    const params: unknown[] = [id, user.userId];
    if (file_name !== undefined) { updates.push(`file_name = $${params.length + 1}`); params.push(sanitizeFileName(file_name)); }
    if (tags !== undefined) { updates.push(`tags = $${params.length + 1}`); params.push(tags); }
    if (!updates.length) return res.status(400).json({ success: false, error: 'Nothing to update' });
    const { rows } = await pool!.query(
      `UPDATE media_images SET ${updates.join(', ')} WHERE id = $1 AND user_id = $2 RETURNING *`,
      params
    );
    if (!rows.length) return res.status(404).json({ success: false, error: 'Image not found' });
    return res.json({ success: true, image: rows[0] });
  } catch (err) {
    console.error('media update error:', err);
    return res.status(500).json({ success: false, error: 'Update failed' });
  }
});

// Delete single image
app.delete('/api/media/:id', async (req: Request, res: Response) => {
  const user = await requireAuth(req, res);
  if (!user) return;
  const { id } = req.params;
  if (!hasDatabase()) return res.status(503).json({ success: false, error: 'No database' });
  try {
    await pool!.query('DELETE FROM media_images WHERE id = $1 AND user_id = $2', [id, user.userId]);
    return res.json({ success: true });
  } catch (err) {
    console.error('media delete error:', err);
    return res.status(500).json({ success: false, error: 'Delete failed' });
  }
});

// Bulk delete
app.post('/api/media/bulk-delete', async (req: Request, res: Response) => {
  const user = await requireAuth(req, res);
  if (!user) return;
  const { ids } = req.body as { ids: string[] };
  if (!Array.isArray(ids) || !ids.length) return res.status(400).json({ success: false, error: 'ids required' });
  if (!hasDatabase()) return res.status(503).json({ success: false, error: 'No database' });
  try {
    await pool!.query('DELETE FROM media_images WHERE id = ANY($1) AND user_id = $2', [ids, user.userId]);
    return res.json({ success: true });
  } catch (err) {
    console.error('media bulk delete error:', err);
    return res.status(500).json({ success: false, error: 'Bulk delete failed' });
  }
});

// Admin: list all images
app.get('/api/admin/media', async (req: Request, res: Response) => {
  const admin = await requireAdmin(req, res);
  if (!admin) return;
  if (!hasDatabase()) return res.json({ success: true, images: [] });
  const { search, userId } = req.query as { search?: string; userId?: string };
  try {
    const params: unknown[] = [];
    const where: string[] = [];
    if (userId) { where.push(`m.user_id = $${params.length + 1}`); params.push(userId); }
    if (search) { where.push(`(m.file_name ILIKE $${params.length + 1} OR u.username ILIKE $${params.length + 1})`); params.push(`%${search}%`); }
    const whereClause = where.length ? `WHERE ${where.join(' AND ')}` : '';
    const { rows } = await pool!.query(
      `SELECT m.*, u.username, u.email as user_email
       FROM media_images m JOIN users u ON m.user_id = u.id
       ${whereClause} ORDER BY m.upload_date DESC LIMIT 500`,
      params
    );
    return res.json({ success: true, images: rows });
  } catch (err) {
    console.error('admin media list error:', err);
    return res.status(500).json({ success: false, error: 'Failed to fetch images' });
  }
});

// Admin: stats
app.get('/api/admin/media/stats', async (req: Request, res: Response) => {
  const admin = await requireAdmin(req, res);
  if (!admin) return;
  if (!hasDatabase()) return res.json({ success: true, stats: { total_images: 0, total_size: 0, users_count: 0 } });
  try {
    const { rows } = await pool!.query(
      `SELECT COUNT(*) as total_images, COALESCE(SUM(file_size),0) as total_size, COUNT(DISTINCT user_id) as users_count FROM media_images`
    );
    return res.json({ success: true, stats: rows[0] });
  } catch (err) {
    console.error('admin media stats error:', err);
    return res.status(500).json({ success: false, error: 'Failed to fetch stats' });
  }
});

// Admin: delete any image
app.delete('/api/admin/media/:id', async (req: Request, res: Response) => {
  const admin = await requireAdmin(req, res);
  if (!admin) return;
  const { id } = req.params;
  if (!hasDatabase()) return res.status(503).json({ success: false, error: 'No database' });
  try {
    await pool!.query('DELETE FROM media_images WHERE id = $1', [id]);
    return res.json({ success: true });
  } catch (err) {
    console.error('admin media delete error:', err);
    return res.status(500).json({ success: false, error: 'Delete failed' });
  }
});

// Get admin-category assets (accessible to authenticated users for template suggestions)
app.get('/api/media/admin-assets', async (req: Request, res: Response) => {
  const user = await requireAuth(req, res);
  if (!user) return;
  if (!hasDatabase()) return res.status(503).json({ success: false, error: 'No database' });
  try {
    const { rows } = await pool!.query(
      `SELECT id, file_name, file_type, width, height, url, thumbnail_url, tags, upload_date
       FROM media_images WHERE category = 'admin' ORDER BY upload_date DESC LIMIT 200`
    );
    return res.json({ success: true, images: rows });
  } catch (err) {
    console.error('admin assets error:', err);
    return res.status(500).json({ success: false, error: 'Failed to load admin assets' });
  }
});

// Admin: update media category
app.patch('/api/admin/media/:id/category', async (req: Request, res: Response) => {
  const admin = await requireAdmin(req, res);
  if (!admin) return;
  const { id } = req.params;
  const { category } = req.body as { category: string };
  const allowed = ['user', 'admin'];
  if (!allowed.includes(category)) return res.status(400).json({ success: false, error: 'Invalid category' });
  if (!hasDatabase()) return res.status(503).json({ success: false, error: 'No database' });
  try {
    const { rows } = await pool!.query('UPDATE media_images SET category=$1 WHERE id=$2 RETURNING *', [category, id]);
    return res.json({ success: true, image: rows[0] });
  } catch (err) {
    console.error('admin media category error:', err);
    return res.status(500).json({ success: false, error: 'Update failed' });
  }
});

// TikTok domain verification
app.get('/tiktokGuHuKYUdxb13mmRk5PkdrDFlLEBosnIF.txt', (req: Request, res: Response) => {
  res.setHeader('Content-Type', 'text/plain');
  res.send('tiktok-developers-site-verification=GuHuKYUdxb13mmRk5PkdrDFlLEBosnIF');
});

// ── Blog Post Management ───────────────────────────────────────────────────────

function slugify(text: string): string {
  return text.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');
}

// GET /api/blog/categories
app.get('/api/blog/categories', async (req: Request, res: Response) => {
  const user = await requireAuth(req, res);
  if (!user) return;
  const { rows } = await pool!.query(
    'SELECT * FROM blog_categories WHERE user_id=$1 ORDER BY name',
    [user.id]
  );
  return res.json({ success: true, categories: rows });
});

// POST /api/blog/categories
app.post('/api/blog/categories', async (req: Request, res: Response) => {
  const user = await requireAuth(req, res);
  if (!user) return;
  const { name } = req.body as { name: string };
  if (!name?.trim()) return res.status(400).json({ success: false, error: 'Name required' });
  const id = randomUUID();
  const slug = slugify(name);
  const { rows } = await pool!.query(
    'INSERT INTO blog_categories (id, user_id, name, slug) VALUES ($1,$2,$3,$4) RETURNING *',
    [id, user.id, name.trim(), slug]
  );
  return res.json({ success: true, category: rows[0] });
});

// PUT /api/blog/categories/:id
app.put('/api/blog/categories/:id', async (req: Request, res: Response) => {
  const user = await requireAuth(req, res);
  if (!user) return;
  const { id } = req.params;
  const { name } = req.body as { name: string };
  if (!name?.trim()) return res.status(400).json({ success: false, error: 'Name required' });
  const slug = slugify(name);
  const { rows } = await pool!.query(
    'UPDATE blog_categories SET name=$1, slug=$2 WHERE id=$3 AND user_id=$4 RETURNING *',
    [name.trim(), slug, id, user.id]
  );
  if (!rows.length) return res.status(404).json({ success: false, error: 'Not found' });
  return res.json({ success: true, category: rows[0] });
});

// DELETE /api/blog/categories/:id
app.delete('/api/blog/categories/:id', async (req: Request, res: Response) => {
  const user = await requireAuth(req, res);
  if (!user) return;
  const { id } = req.params;
  await pool!.query('DELETE FROM blog_categories WHERE id=$1 AND user_id=$2', [id, user.id]);
  return res.json({ success: true });
});

// GET /api/blog/tags
app.get('/api/blog/tags', async (req: Request, res: Response) => {
  const user = await requireAuth(req, res);
  if (!user) return;
  const { rows } = await pool!.query(
    'SELECT * FROM blog_tags WHERE user_id=$1 ORDER BY name',
    [user.id]
  );
  return res.json({ success: true, tags: rows });
});

// POST /api/blog/tags
app.post('/api/blog/tags', async (req: Request, res: Response) => {
  const user = await requireAuth(req, res);
  if (!user) return;
  const { name } = req.body as { name: string };
  if (!name?.trim()) return res.status(400).json({ success: false, error: 'Name required' });
  const id = randomUUID();
  const slug = slugify(name);
  const { rows } = await pool!.query(
    'INSERT INTO blog_tags (id, user_id, name, slug) VALUES ($1,$2,$3,$4) RETURNING *',
    [id, user.id, name.trim(), slug]
  );
  return res.json({ success: true, tag: rows[0] });
});

// DELETE /api/blog/tags/:id
app.delete('/api/blog/tags/:id', async (req: Request, res: Response) => {
  const user = await requireAuth(req, res);
  if (!user) return;
  const { id } = req.params;
  await pool!.query('DELETE FROM blog_tags WHERE id=$1 AND user_id=$2', [id, user.id]);
  return res.json({ success: true });
});

// GET /api/blog/posts
app.get('/api/blog/posts', async (req: Request, res: Response) => {
  const user = await requireAuth(req, res);
  if (!user) return;
  const { status, search } = req.query as { status?: string; search?: string };
  let q = `SELECT p.*, c.name AS category_name,
    ARRAY(SELECT t.name FROM blog_tags t JOIN blog_post_tags pt ON pt.tag_id=t.id WHERE pt.post_id=p.id) AS tag_names
    FROM blog_posts p LEFT JOIN blog_categories c ON c.id=p.category_id
    WHERE p.user_id=$1`;
  const params: (string | number)[] = [user.id];
  if (status && status !== 'all') { params.push(status); q += ` AND p.status=$${params.length}`; }
  if (search) { params.push(`%${search}%`); q += ` AND p.title ILIKE $${params.length}`; }
  q += ' ORDER BY p.updated_at DESC';
  const { rows } = await pool!.query(q, params);
  return res.json({ success: true, posts: rows });
});

// GET /api/blog/posts/:id
app.get('/api/blog/posts/:id', async (req: Request, res: Response) => {
  const user = await requireAuth(req, res);
  if (!user) return;
  const { id } = req.params;
  const { rows } = await pool!.query(
    `SELECT p.*, c.name AS category_name,
      ARRAY(SELECT t.id FROM blog_tags t JOIN blog_post_tags pt ON pt.tag_id=t.id WHERE pt.post_id=p.id) AS tag_ids,
      ARRAY(SELECT t.name FROM blog_tags t JOIN blog_post_tags pt ON pt.tag_id=t.id WHERE pt.post_id=p.id) AS tag_names
     FROM blog_posts p LEFT JOIN blog_categories c ON c.id=p.category_id
     WHERE p.id=$1 AND p.user_id=$2`,
    [id, user.id]
  );
  if (!rows.length) return res.status(404).json({ success: false, error: 'Not found' });
  return res.json({ success: true, post: rows[0] });
});

// POST /api/blog/posts
app.post('/api/blog/posts', async (req: Request, res: Response) => {
  const user = await requireAuth(req, res);
  if (!user) return;
  const { title = '', slug: rawSlug, content = '', excerpt = '', featured_image = '',
    status = 'draft', category_id, meta_title = '', meta_description = '', focus_keyword = '',
    social_title = '', social_description = '', social_image = '', scheduled_at, tag_ids = [] } = req.body as {
    title?: string; slug?: string; content?: string; excerpt?: string; featured_image?: string;
    status?: string; category_id?: string; meta_title?: string; meta_description?: string;
    focus_keyword?: string; social_title?: string; social_description?: string; social_image?: string;
    scheduled_at?: string; tag_ids?: string[];
  };
  const id = randomUUID();
  const slug = rawSlug?.trim() || slugify(title) || id;
  const published_at = status === 'published' ? new Date().toISOString() : null;
  const { rows } = await pool!.query(
    `INSERT INTO blog_posts (id,user_id,title,slug,content,excerpt,featured_image,status,category_id,
      meta_title,meta_description,focus_keyword,social_title,social_description,social_image,scheduled_at,published_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17) RETURNING *`,
    [id, user.id, title, slug, content, excerpt, featured_image, status,
     category_id || null, meta_title, meta_description, focus_keyword,
     social_title, social_description, social_image, scheduled_at || null, published_at]
  );
  if (tag_ids.length) {
    await Promise.all(tag_ids.map((tid: string) =>
      pool!.query('INSERT INTO blog_post_tags (post_id,tag_id) VALUES ($1,$2) ON CONFLICT DO NOTHING', [id, tid])
    ));
  }
  return res.json({ success: true, post: rows[0] });
});

// PUT /api/blog/posts/:id
app.put('/api/blog/posts/:id', async (req: Request, res: Response) => {
  const user = await requireAuth(req, res);
  if (!user) return;
  const { id } = req.params;
  const { title, slug: rawSlug, content, excerpt, featured_image, status,
    category_id, meta_title, meta_description, focus_keyword,
    social_title, social_description, social_image, scheduled_at, tag_ids } = req.body as {
    title?: string; slug?: string; content?: string; excerpt?: string; featured_image?: string;
    status?: string; category_id?: string; meta_title?: string; meta_description?: string;
    focus_keyword?: string; social_title?: string; social_description?: string; social_image?: string;
    scheduled_at?: string; tag_ids?: string[];
  };
  const existing = await pool!.query('SELECT * FROM blog_posts WHERE id=$1 AND user_id=$2', [id, user.id]);
  if (!existing.rows.length) return res.status(404).json({ success: false, error: 'Not found' });
  const cur = existing.rows[0];
  const newTitle = title ?? cur.title;
  const newSlug = rawSlug?.trim() || (title ? slugify(title) : cur.slug);
  const newStatus = status ?? cur.status;
  const published_at = newStatus === 'published' && !cur.published_at ? new Date().toISOString() : cur.published_at;
  const { rows } = await pool!.query(
    `UPDATE blog_posts SET title=$1,slug=$2,content=$3,excerpt=$4,featured_image=$5,status=$6,
      category_id=$7,meta_title=$8,meta_description=$9,focus_keyword=$10,social_title=$11,
      social_description=$12,social_image=$13,scheduled_at=$14,published_at=$15,updated_at=NOW()
     WHERE id=$16 AND user_id=$17 RETURNING *`,
    [newTitle, newSlug, content ?? cur.content, excerpt ?? cur.excerpt, featured_image ?? cur.featured_image,
     newStatus, category_id !== undefined ? (category_id || null) : cur.category_id,
     meta_title ?? cur.meta_title, meta_description ?? cur.meta_description,
     focus_keyword ?? cur.focus_keyword, social_title ?? cur.social_title,
     social_description ?? cur.social_description, social_image ?? cur.social_image,
     scheduled_at !== undefined ? (scheduled_at || null) : cur.scheduled_at,
     published_at, id, user.id]
  );
  if (tag_ids !== undefined) {
    await pool!.query('DELETE FROM blog_post_tags WHERE post_id=$1', [id]);
    if (tag_ids.length) {
      await Promise.all(tag_ids.map((tid: string) =>
        pool!.query('INSERT INTO blog_post_tags (post_id,tag_id) VALUES ($1,$2) ON CONFLICT DO NOTHING', [id, tid])
      ));
    }
  }
  return res.json({ success: true, post: rows[0] });
});

// DELETE /api/blog/posts/:id
app.delete('/api/blog/posts/:id', async (req: Request, res: Response) => {
  const user = await requireAuth(req, res);
  if (!user) return;
  const { id } = req.params;
  await pool!.query('DELETE FROM blog_posts WHERE id=$1 AND user_id=$2', [id, user.id]);
  return res.json({ success: true });
});

// POST /api/blog/posts/:id/duplicate
app.post('/api/blog/posts/:id/duplicate', async (req: Request, res: Response) => {
  const user = await requireAuth(req, res);
  if (!user) return;
  const { id } = req.params;
  const { rows } = await pool!.query('SELECT * FROM blog_posts WHERE id=$1 AND user_id=$2', [id, user.id]);
  if (!rows.length) return res.status(404).json({ success: false, error: 'Not found' });
  const src = rows[0];
  const newId = randomUUID();
  const { rows: newRows } = await pool!.query(
    `INSERT INTO blog_posts (id,user_id,title,slug,content,excerpt,featured_image,status,category_id,
      meta_title,meta_description,focus_keyword,social_title,social_description,social_image)
     VALUES ($1,$2,$3,$4,$5,$6,$7,'draft',$8,$9,$10,$11,$12,$13,$14) RETURNING *`,
    [newId, user.id, `${src.title} (Copy)`, `${src.slug}-copy`, src.content, src.excerpt,
     src.featured_image, src.category_id, src.meta_title, src.meta_description,
     src.focus_keyword, src.social_title, src.social_description, src.social_image]
  );
  // Copy tags
  const tagRows = await pool!.query('SELECT tag_id FROM blog_post_tags WHERE post_id=$1', [id]);
  if (tagRows.rows.length) {
    await Promise.all(tagRows.rows.map((r: { tag_id: string }) =>
      pool!.query('INSERT INTO blog_post_tags (post_id,tag_id) VALUES ($1,$2)', [newId, r.tag_id])
    ));
  }
  return res.json({ success: true, post: newRows[0] });
});

// ── Distribution / Automation ────────────────────────────────────────────────

// Helper: publish a blog post to a single platform, return result
async function publishToplatform(
  userId: string,
  post: Record<string, any>,
  platform: string
): Promise<{ status: string; platformPostId?: string; error?: string }> {
  try {
    if (platform === 'wordpress') {
      const conn = await getWordPressConnection(userId);
      if (!conn) throw new Error('WordPress not connected');
      const appPassword = decryptWordPressPassword(conn.appPasswordEncrypted);
      const postPayload: Record<string, any> = {
        title: post.title || '',
        content: post.content || '',
        status: post.status === 'published' ? 'publish' : 'draft',
        excerpt: post.excerpt || '',
        slug: post.slug || '',
      };
      const { data: wpData, status: wpStatus, error: wpError } = await wpRequest(
        conn.siteUrl, conn.username, appPassword, 'POST', '/wp/v2/posts', { data: postPayload }
      );
      if (wpStatus !== 201 && wpStatus !== 200) throw new Error(wpError || 'WordPress publish failed');
      // Set SEO meta if available
      const postId = wpData?.id;
      if (postId && (post.meta_title || post.meta_description || post.focus_keyword)) {
        const meta: Record<string, string> = {};
        if (post.meta_title) { meta._yoast_wpseo_title = post.meta_title; meta.rank_math_title = post.meta_title; }
        if (post.meta_description) { meta._yoast_wpseo_metadesc = post.meta_description; meta.rank_math_description = post.meta_description; }
        if (post.focus_keyword) { meta._yoast_wpseo_focuskw = post.focus_keyword; meta.rank_math_focus_keyword = post.focus_keyword; }
        await wpRequest(conn.siteUrl, conn.username, appPassword, 'POST', `/wp/v2/posts/${postId}`, { data: { meta } });
      }
      return { status: 'published', platformPostId: String(wpData?.id || '') };
    }

    // OAuth platforms (LinkedIn, Twitter/X, Facebook, Instagram, etc.)
    const socialRows = await pool!.query(
      'SELECT access_token, token_data FROM social_accounts WHERE user_id=$1 AND platform=$2 AND connected=true',
      [userId, platform]
    );
    if (!socialRows.rows.length) throw new Error(`${platform} is not connected`);
    const { access_token, token_data } = socialRows.rows[0];
    if (!access_token) throw new Error(`${platform} access token missing – please reconnect`);

    const PLATFORM_NAMES: Record<string, string> = {
      linkedin: 'LinkedIn', twitter: 'Twitter / X', facebook: 'Facebook',
      instagram: 'Instagram', threads: 'Threads', tiktok: 'TikTok',
    };
    const platformName = PLATFORM_NAMES[platform] || platform;
    const summary = post.excerpt || post.title || '';
    const maxLen = platform === 'twitter' ? 260 : 3000;
    const text = `${post.title}\n\n${summary}`.slice(0, maxLen);

    if (platform === 'linkedin') {
      const authorUrn = token_data?.sub ? `urn:li:person:${token_data.sub}` : null;
      if (!authorUrn) throw new Error('LinkedIn profile URN not available – please reconnect');
      const body = {
        author: authorUrn,
        lifecycleState: 'PUBLISHED',
        specificContent: {
          'com.linkedin.ugc.ShareContent': {
            shareCommentary: { text },
            shareMediaCategory: 'NONE',
          },
        },
        visibility: { 'com.linkedin.ugc.MemberNetworkVisibility': 'PUBLIC' },
      };
      const resp = await fetch('https://api.linkedin.com/v2/ugcPosts', {
        method: 'POST',
        headers: { Authorization: `Bearer ${access_token}`, 'Content-Type': 'application/json', 'X-Restli-Protocol-Version': '2.0.0' },
        body: JSON.stringify(body),
      });
      if (!resp.ok) {
        const errData = await resp.json().catch(() => ({}));
        throw new Error((errData as any)?.message || `LinkedIn API error ${resp.status}`);
      }
      const data: any = await resp.json();
      return { status: 'published', platformPostId: data?.id };
    }

    if (platform === 'twitter') {
      const resp = await fetch('https://api.twitter.com/2/tweets', {
        method: 'POST',
        headers: { Authorization: `Bearer ${access_token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ text: text.slice(0, 280) }),
      });
      if (!resp.ok) {
        const errData = await resp.json().catch(() => ({}));
        throw new Error((errData as any)?.detail || `Twitter API error ${resp.status}`);
      }
      const data: any = await resp.json();
      return { status: 'published', platformPostId: data?.data?.id };
    }

    // Stub for other platforms
    console.log(`[Distribution] ${platformName}: token available, platform publishing not yet implemented`);
    return { status: 'pending', error: `${platformName} publishing coming soon` };
  } catch (err) {
    return { status: 'failed', error: err instanceof Error ? err.message : 'Unknown error' };
  }
}

// GET /api/distribution/connected
app.get('/api/distribution/connected', async (req: Request, res: Response) => {
  try {
    const auth = await requireAuth(req, res);
    if (!auth) return;

    const platforms: { id: string; name: string }[] = [];

    const wpRows = await pool!.query('SELECT id FROM wordpress_connections WHERE user_id=$1', [auth.userId]);
    if (wpRows.rows.length > 0) platforms.push({ id: 'wordpress', name: 'WordPress' });

    const socialRows = await pool!.query(
      'SELECT platform FROM social_accounts WHERE user_id=$1 AND connected=true', [auth.userId]
    );
    const SOCIAL_NAMES: Record<string, string> = {
      instagram: 'Instagram', facebook: 'Facebook', linkedin: 'LinkedIn',
      twitter: 'Twitter / X', tiktok: 'TikTok', threads: 'Threads',
    };
    for (const row of socialRows.rows) {
      if (SOCIAL_NAMES[row.platform]) platforms.push({ id: row.platform, name: SOCIAL_NAMES[row.platform] });
    }

    return res.json({ success: true, platforms });
  } catch {
    return res.status(500).json({ success: false, error: 'Failed to fetch connected platforms' });
  }
});

// POST /api/distribution/publish
app.post('/api/distribution/publish', async (req: Request, res: Response) => {
  try {
    const auth = await requireAuth(req, res);
    if (!auth) return;

    const { postId, platforms } = req.body as { postId: string; platforms: string[] };
    if (!postId || !Array.isArray(platforms) || platforms.length === 0) {
      return res.status(400).json({ success: false, error: 'postId and platforms required' });
    }

    const postRows = await pool!.query('SELECT * FROM blog_posts WHERE id=$1 AND user_id=$2', [postId, auth.userId]);
    if (!postRows.rows.length) return res.status(404).json({ success: false, error: 'Post not found' });
    const post = postRows.rows[0];

    const results: { platform: string; status: string; error?: string; platformPostId?: string }[] = [];
    for (const platform of platforms) {
      const result = await publishToplatform(auth.userId, post, platform);
      const logId = randomUUID();
      await pool!.query(
        'INSERT INTO publishing_logs (id,post_id,user_id,platform,status,platform_post_id,error_message) VALUES ($1,$2,$3,$4,$5,$6,$7)',
        [logId, postId, auth.userId, platform, result.status, result.platformPostId || null, result.error || null]
      );
      results.push({ platform, ...result });
    }

    return res.json({ success: true, results });
  } catch {
    return res.status(500).json({ success: false, error: 'Distribution failed' });
  }
});

// GET /api/distribution/status/:postId
app.get('/api/distribution/status/:postId', async (req: Request, res: Response) => {
  try {
    const auth = await requireAuth(req, res);
    if (!auth) return;
    const { postId } = req.params;
    const { rows } = await pool!.query(
      'SELECT * FROM publishing_logs WHERE post_id=$1 AND user_id=$2 ORDER BY created_at DESC',
      [postId, auth.userId]
    );
    return res.json({ success: true, logs: rows });
  } catch {
    return res.status(500).json({ success: false, error: 'Failed to fetch status' });
  }
});

// GET /api/automation/logs
app.get('/api/automation/logs', async (req: Request, res: Response) => {
  try {
    const auth = await requireAuth(req, res);
    if (!auth) return;
    const { rows } = await pool!.query(
      `SELECT l.*, p.title as post_title FROM publishing_logs l
       LEFT JOIN blog_posts p ON p.id = l.post_id
       WHERE l.user_id=$1 ORDER BY l.created_at DESC LIMIT 200`,
      [auth.userId]
    );
    return res.json({ success: true, logs: rows });
  } catch {
    return res.status(500).json({ success: false, error: 'Failed to fetch logs' });
  }
});

// POST /api/automation/retry/:logId
app.post('/api/automation/retry/:logId', async (req: Request, res: Response) => {
  try {
    const auth = await requireAuth(req, res);
    if (!auth) return;
    const { logId } = req.params;
    const logRows = await pool!.query('SELECT * FROM publishing_logs WHERE id=$1 AND user_id=$2', [logId, auth.userId]);
    if (!logRows.rows.length) return res.status(404).json({ success: false, error: 'Log not found' });
    const log = logRows.rows[0];
    const postRows = await pool!.query('SELECT * FROM blog_posts WHERE id=$1', [log.post_id]);
    if (!postRows.rows.length) return res.status(404).json({ success: false, error: 'Post not found' });
    const result = await publishToplatform(auth.userId, postRows.rows[0], log.platform);
    await pool!.query(
      'UPDATE publishing_logs SET status=$1, platform_post_id=$2, error_message=$3 WHERE id=$4',
      [result.status, result.platformPostId || null, result.error || null, logId]
    );
    return res.json({ success: true, result });
  } catch {
    return res.status(500).json({ success: false, error: 'Retry failed' });
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

