import { Pool } from 'pg';
import { config } from './config.ts';
import { logger } from './logger.ts';

export let pool: Pool | null = null;
try {
  pool = config.databaseUrl
    ? new Pool({
        connectionString: config.databaseUrl,
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
export function setDbReady(value: boolean) {
  dbReady = value;
}

export function hasDatabase() {
  return Boolean(pool && dbReady);
}

export async function dbQuery<T = any>(sql: string, params: any[] = []) {
  if (!pool) throw new Error('DATABASE_URL is not configured. Please set it to enable persistence.');
  return pool.query<T>(sql, params);
}

export function normalizeEmail(value: string) {
  return value.trim().toLowerCase();
}

export function normalizeUsername(value: string) {
  return value.trim().toLowerCase();
}
