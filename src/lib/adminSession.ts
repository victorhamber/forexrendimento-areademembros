export const ADMIN_JWT_KEY = 'contentpro_admin_jwt';

type AdminSessionExpiredHandler = () => void;

let onAdminSessionExpired: AdminSessionExpiredHandler | null = null;
let expiredNotified = false;

export function registerAdminSessionHandler(handler: AdminSessionExpiredHandler | null): () => void {
  onAdminSessionExpired = handler;
  expiredNotified = false;
  return () => {
    if (onAdminSessionExpired === handler) onAdminSessionExpired = null;
  };
}

export function notifyAdminSessionExpired(): void {
  if (expiredNotified) return;
  expiredNotified = true;
  onAdminSessionExpired?.();
}

export function resetAdminSessionExpiredFlag(): void {
  expiredNotified = false;
}

/** Fetch do painel admin — em 401 limpa a sessão e volta para a tela de login. */
export async function adminFetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  const res = await fetch(input, init);
  const url =
    typeof input === 'string'
      ? input
      : input instanceof URL
        ? input.href
        : input instanceof Request
          ? input.url
          : String(input);

  const isAdminApi = url.includes('/api/admin');
  const isLogin = url.includes('/api/admin/login');
  if (res.status === 401 && isAdminApi && !isLogin) {
    notifyAdminSessionExpired();
  }
  return res;
}
