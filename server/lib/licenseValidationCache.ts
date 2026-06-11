type Cached = { body: object; status: number; expires: number };
const store = new Map<string, Cached>();

const TWO_DAYS_MS = 2 * 24 * 60 * 60 * 1000;
const SUCCESS_TTL_MS = TWO_DAYS_MS;
const ERROR_TTL_MS = 60_000;

export function cacheGet(key: string): Cached | null {
  const c = store.get(key);
  if (!c || Date.now() > c.expires) {
    store.delete(key);
    return null;
  }
  return c;
}

export function cacheSet(key: string, status: number, body: object, ttlMs?: number) {
  const ttl =
    ttlMs ??
    (status === 200 ? SUCCESS_TTL_MS : ERROR_TTL_MS);
  store.set(key, { status, body, expires: Date.now() + ttl });
}

/** Sucesso vale para todos os system_id equivalentes (EA tenta 516247 e 5162473 na revalidação). */
export function cacheSetLicenseValidation(
  email: string,
  numeroConta: string,
  systemId: string,
  status: number,
  body: object,
  equivalentIds: string[]
) {
  const normEmail = email.trim().toLowerCase();
  const account = String(numeroConta || '').trim();
  const ids = status === 200 ? [...new Set(equivalentIds.filter(Boolean))] : [String(systemId || '').trim()];
  for (const sid of ids) {
    if (!sid) continue;
    cacheSet(`license_validation_${normEmail}_${account}_${sid}`, status, body);
  }
}

/** Limpa cache de validação do e-mail (troca de conta, expiração, desativação). */
export function invalidateLicenseCacheForEmail(email: string): void {
  const norm = email.trim().toLowerCase();
  if (!norm) return;
  const prefix = `license_validation_${norm}_`;
  for (const key of store.keys()) {
    if (key.startsWith(prefix)) store.delete(key);
  }
}
