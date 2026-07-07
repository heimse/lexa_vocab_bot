import jwt from 'jsonwebtoken';
import { config } from '../config.js';

const TOKEN_TTL = '30d';

export function signToken(userId: string): string {
  return jwt.sign({}, config.jwtSecret, { subject: userId, expiresIn: TOKEN_TTL });
}

export function verifyToken(token: string): string | null {
  try {
    const payload = jwt.verify(token, config.jwtSecret);
    return typeof payload === 'object' && typeof payload.sub === 'string' ? payload.sub : null;
  } catch {
    return null;
  }
}
