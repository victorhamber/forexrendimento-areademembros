export const MEMBER_USER_ID_KEY = 'contentpro_userId';
export const MEMBER_EMAIL_KEY = 'contentpro_userEmail';
export const MEMBER_NAME_KEY = 'contentpro_userName';
export const MEMBER_TOKEN_KEY = 'contentpro_token';

export type SessionExpiredReason = 'unauthorized' | 'token-expired';

type SessionExpiredHandler = (reason: SessionExpiredReason) => void;

let onSessionExpired: SessionExpiredHandler | null = null;

export function registerMemberSessionHandler(handler: SessionExpiredHandler | null): () => void {
  onSessionExpired = handler;
  return () => {
    if (onSessionExpired === handler) onSessionExpired = null;
  };
}

export function clearMemberSessionStorage(): void {
  localStorage.removeItem(MEMBER_USER_ID_KEY);
  localStorage.removeItem(MEMBER_EMAIL_KEY);
  localStorage.removeItem(MEMBER_NAME_KEY);
  localStorage.removeItem(MEMBER_TOKEN_KEY);
}

export function getJwtExpMs(token: string): number | null {
  try {
    const part = token.split('.')[1];
    if (!part) return null;
    const padded = part.replace(/-/g, '+').replace(/_/g, '/');
    const json = JSON.parse(atob(padded)) as { exp?: unknown };
    if (typeof json.exp !== 'number') return null;
    return json.exp * 1000;
  } catch {
    return null;
  }
}

export function isMemberTokenExpired(token: string, skewMs = 30_000): boolean {
  const expMs = getJwtExpMs(token);
  if (!expMs) return false;
  return expMs <= Date.now() + skewMs;
}

export function notifySessionExpired(reason: SessionExpiredReason = 'unauthorized'): void {
  onSessionExpired?.(reason);
}

/** Fetch autenticado da área de membros — dispara logout automático em 401. */
export async function memberFetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  const res = await fetch(input, init);
  if (res.status === 401) {
    notifySessionExpired('unauthorized');
  }
  return res;
}

export function buildMemberAuthHeaders(
  userId?: string | null,
  json = false
): Record<string, string> {
  const h: Record<string, string> = {};
  const uid = userId ?? localStorage.getItem(MEMBER_USER_ID_KEY);
  if (uid) h['x-user-id'] = uid;
  const tok = localStorage.getItem(MEMBER_TOKEN_KEY);
  if (tok) h['Authorization'] = `Bearer ${tok}`;
  if (json) h['Content-Type'] = 'application/json';
  return h;
}

/** Retorna false se o token local já expirou (e dispara logout). */
export function checkLocalMemberToken(): boolean {
  const tok = localStorage.getItem(MEMBER_TOKEN_KEY);
  if (!tok) return true;
  if (isMemberTokenExpired(tok)) {
    notifySessionExpired('token-expired');
    return false;
  }
  return true;
}
