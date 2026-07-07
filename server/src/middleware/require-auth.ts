import type { NextFunction, Request, Response } from 'express';
import { verifyToken } from '../auth/jwt.js';

export const AUTH_COOKIE = 'lexa_token';

declare global {
  namespace Express {
    interface Request {
      userId?: string;
    }
  }
}

export function requireAuth(req: Request, res: Response, next: NextFunction): void {
  const token = (req.cookies as Record<string, string | undefined>)[AUTH_COOKIE];
  const userId = token ? verifyToken(token) : null;
  if (!userId) {
    res.status(401).json({ error: 'Unauthorized' });
    return;
  }
  req.userId = userId;
  next();
}
