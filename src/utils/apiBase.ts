const DEFAULT_PROD_API_BASE_URL = 'https://contentflow-api-production.up.railway.app';
const DEFAULT_PROD_HOSTS = new Set(['marketing.dakyworld.com', 'daky0000.github.io']);

const normalizeBaseUrl = (value: string) => value.trim().replace(/\/$/, '');

export const getApiBaseUrl = (): string => {
  const envBase = normalizeBaseUrl((import.meta.env.VITE_API_BASE_URL || '') as string);
  const runtimeBase =
    typeof window !== 'undefined' && (window as any).__API_BASE_URL__
      ? normalizeBaseUrl(String((window as any).__API_BASE_URL__))
      : '';

  const candidate = runtimeBase || envBase;
  if (candidate && !/api\.yourdomain\.com/i.test(candidate)) {
    return candidate;
  }

  if (typeof window !== 'undefined') {
    const host = window.location.hostname;
    if (DEFAULT_PROD_HOSTS.has(host)) return DEFAULT_PROD_API_BASE_URL;
    return window.location.origin;
  }

  return '';
};

export const API_BASE_URL = getApiBaseUrl();
