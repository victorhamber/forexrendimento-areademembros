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
  // Sem JWT válido não autentica — evita sessão “fantasma” só com x-user-id
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
