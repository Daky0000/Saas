import pino from 'pino';
import * as Sentry from '@sentry/node';

// Most failures in this codebase are caught and logged rather than thrown, so
// hooking error/fatal logs is what actually gets them into monitoring.
// Sentry.capture* is a safe no-op when SENTRY_DSN is unset (init never ran).
function forwardToSentry(args: unknown[]) {
  try {
    const first = args[0] as any;
    const error =
      args.find((a): a is Error => a instanceof Error) ??
      (first && typeof first === 'object' && first.err instanceof Error ? (first.err as Error) : undefined);
    if (error) {
      Sentry.captureException(error, { extra: { logArgs: args.filter((a) => a !== error) } });
      return;
    }
    const msg = args
      .map((a) => {
        if (typeof a === 'string') return a;
        try { return JSON.stringify(a); } catch { return String(a); }
      })
      .join(' ');
    if (msg) Sentry.captureMessage(msg.slice(0, 500), 'error');
  } catch {
    // never let monitoring break logging
  }
}

export const logger = pino({
  level: process.env.LOG_LEVEL || 'info',
  hooks: {
    logMethod(inputArgs, method, level) {
      if (level >= 50) forwardToSentry(inputArgs as unknown[]);
      return method.apply(this, inputArgs as Parameters<typeof method>);
    },
  },
  redact: {
    paths: [
      'req.headers.authorization',
      'req.headers.cookie',
      '*.password',
      '*.token',
      '*.refreshToken',
      '*.accessToken',
    ],
    remove: true,
  },
});
