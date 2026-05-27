import { Pool } from 'pg';
import { config } from './config.ts';
import { logger } from './logger.ts';

export let pool: Pool | null = null;
try {
  pool = config.databaseUrl
    ? new Pool({
        connectionString: config.databaseUrl,
        ssl: config.databaseUrl.includes('localhost') || config.databaseUrl.includes('127.0.0.1')
          ? false
          : { rejectUnauthorized: false },
        max: 20,
        connectionTimeoutMillis: 5000,
        idleTimeoutMillis: 30000,
        statement_timeout: 30000,
      })
    : null;
} catch (err) {
  logger.error('Failed to create database pool, running in in-memory mode:', err);
}

export let dbReady = false;
export let dbInitError: string | null = null;
export function setDbReady(value: boolean) {
  dbReady = value;
}
export function setDbInitError(err: unknown) {
  dbInitError = err instanceof Error ? err.message : String(err);
}

export function hasDatabase() {
  return Boolean(pool && dbReady);
}

export async function dbQuery<T = any>(sql: string, params: any[] = []) {
  if (!pool) {
    throw new Error(
      'Database is not configured. Set DATABASE_URL (preferred), or POSTGRES_URL/POSTGRES_URL_NON_POOLING, or PGHOST/PGUSER/PGPASSWORD/PGDATABASE to enable persistence.'
    );
  }
  return pool.query<T>(sql, params);
}

export function normalizeEmail(value: string) {
  return value.trim().toLowerCase();
}

export function normalizeUsername(value: string) {
  return value.trim().toLowerCase();
}
