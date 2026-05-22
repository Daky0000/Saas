const PROD_API_URL = 'https://contentflow-api-production.up.railway.app';

function resolveApiBase(): string {
  // 1. Explicit env var (set in .env or deployment config) — highest priority
  const envBase = ((import.meta.env.VITE_API_BASE_URL as string) || '').trim().replace(/\/$/, '');
  if (envBase) return envBase;

  // 2. Runtime injection (set via window.__API_BASE_URL__ before app boots)
  if (typeof window !== 'undefined' && (window as any).__API_BASE_URL__) {
    return String((window as any).__API_BASE_URL__).trim().replace(/\/$/, '');
  }

  // 3. Dev mode: empty string means relative paths → Vite proxy forwards to localhost:5000
  if (import.meta.env.DEV) return '';

  // 4. Production fallback: VITE_API_BASE_URL should always be set in deployed envs
  // eslint-disable-next-line no-console
  console.warn('[api] VITE_API_BASE_URL is not set — falling back to hardcoded production URL');
  return PROD_API_URL;
}

export const getApiBaseUrl = resolveApiBase;
export const API_BASE_URL = resolveApiBase();
