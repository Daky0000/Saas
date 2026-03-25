const DEFAULT_PROD_API_BASE_URL = 'https://contentflow-api-production.up.railway.app';
const DEFAULT_PROD_HOSTS = new Set(['marketing.dakyworld.com', 'daky0000.github.io']);
const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1']);
const FRONTEND_HOST_PATTERNS = [/\.github\.io$/i, /\.dakyworld\.com$/i];
const BACKEND_HOST_PATTERNS = [/\.railway\.app$/i];

const normalizeBaseUrl = (value: string) => value.trim().replace(/\/$/, '');
const isPlaceholderBase = (value: string) => /api\.yourdomain\.com/i.test(value);
const matchesAnyPattern = (value: string, patterns: RegExp[]) => patterns.some((pattern) => pattern.test(value));

const isLikelyFrontendHost = (host: string) =>
  DEFAULT_PROD_HOSTS.has(host) || matchesAnyPattern(host, FRONTEND_HOST_PATTERNS);

const isLikelyBackendHost = (host: string) => matchesAnyPattern(host, BACKEND_HOST_PATTERNS);

const resolveCandidateBase = (value: string, origin: string) => {
  try {
    return normalizeBaseUrl(new URL(value, origin).toString());
  } catch {
    return normalizeBaseUrl(value);
  }
};

export const getApiBaseUrl = (): string => {
  const envBase = normalizeBaseUrl((import.meta.env.VITE_API_BASE_URL || '') as string);
  const runtimeBase =
    typeof window !== 'undefined' && (window as any).__API_BASE_URL__
      ? normalizeBaseUrl(String((window as any).__API_BASE_URL__))
      : '';

  if (typeof window !== 'undefined') {
    const host = String(window.location.hostname || '').trim().toLowerCase();
    const origin = normalizeBaseUrl(window.location.origin);
    const candidate = runtimeBase || envBase;

    if (candidate && !isPlaceholderBase(candidate)) {
      const resolvedCandidate = resolveCandidateBase(candidate, origin);
      if (isLikelyFrontendHost(host) && resolvedCandidate === origin) {
        return DEFAULT_PROD_API_BASE_URL;
      }
      return resolvedCandidate;
    }

    if (isLikelyFrontendHost(host) && !isLikelyBackendHost(host) && !LOCAL_HOSTS.has(host)) {
      return DEFAULT_PROD_API_BASE_URL;
    }

    return origin;
  }

  const candidate = runtimeBase || envBase;
  if (candidate && !isPlaceholderBase(candidate)) {
    return candidate;
  }

  return '';
};

export const API_BASE_URL = getApiBaseUrl();
