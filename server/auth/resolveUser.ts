import type { Request } from 'express';
import { verifyUserToken } from './jwt.js';

export function resolveUserId(req: Request): string | null {
  const header = req.headers.authorization;
  if (header?.startsWith('Bearer ')) {
    const tok = header.slice(7).trim();
    if (!tok) return null;
    const v = verifyUserToken(tok);
    return v ? v.userId : null;
  }
  const x = req.headers['x-user-id'];
  if (typeof x === 'string' && x.length > 0) return x;
  return null;
}

export function resolveUserEmail(req: Request): string | null {
  const header = req.headers.authorization;
  if (header?.startsWith('Bearer ')) {
    const v = verifyUserToken(header.slice(7).trim());
    if (v) return v.email;
  }
  return null;
}
