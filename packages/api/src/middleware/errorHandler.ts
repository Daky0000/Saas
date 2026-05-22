import type { Request, Response, NextFunction } from 'express';
import { logger } from '../logger.ts';

type HttpError = { type?: string; status?: number; statusCode?: number; message?: string };

function deriveStatus(err: unknown): number {
  const e = err as HttpError;
  if (e?.type === 'entity.too.large') return 413;
  if (e?.type === 'entity.parse.failed') return 400;
  if (typeof e?.status === 'number') return e.status;
  if (typeof e?.statusCode === 'number') return e.statusCode;
  return 500;
}

function deriveMessage(err: unknown, status: number): string {
  if (status === 413) return 'Request too large';
  if (status === 400) return 'Invalid JSON payload';
  return err instanceof Error ? err.message : 'Internal server error';
}

export function errorHandler(err: unknown, req: Request, res: Response, _next: NextFunction) {
  if (res.headersSent) return;

  const status = deriveStatus(err);
  const message = deriveMessage(err, status);

  if (status >= 500) {
    logger.error(
      {
        method: req.method,
        url: req.originalUrl,
        status,
        message,
        stack: err instanceof Error ? err.stack : undefined,
      },
      'request_error',
    );
  }

  res.status(status).json({ success: false, error: message });
}
