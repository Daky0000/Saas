import type { Request, Response, NextFunction } from 'express';
import { randomUUID } from 'crypto';

export function requestIdMiddleware(req: Request, res: Response, next: NextFunction) {
  const incoming = String(req.headers['x-request-id'] || '').trim();
  const id = incoming || randomUUID();
  req.id = id;
  res.setHeader('x-request-id', id);
  next();
}

