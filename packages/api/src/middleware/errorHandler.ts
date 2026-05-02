import type { Request, Response, NextFunction } from 'express';
import { logger } from '../logger.ts';

export function errorHandler(err: unknown, req: Request, res: Response, _next: NextFunction) {
  const errorId = req.id || 'unknown';
  const message = err instanceof Error ? err.message : 'Unhandled error';

  logger.error(
    {
      errorId,
      method: req.method,
      url: req.originalUrl,
      message,
      stack: err instanceof Error ? err.stack : undefined,
    },
    'request_failed'
  );

  if (res.headersSent) return;
  res.status(500).json({ success: false, error: 'Internal server error', errorId });
}
