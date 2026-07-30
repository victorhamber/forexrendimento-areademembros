/** Rate limit simples em memória (60 req/min por chave), paridade wp_cache do plugin. */
const buckets = new Map<string, { count: number; resetAt: number }>();

export function checkRateLimit(key: string, max = 60, windowMs = 60_000): boolean {
  const now = Date.now();
  let b = buckets.get(key);
  if (!b || now > b.resetAt) {
    b = { count: 0, resetAt: now + windowMs };
    buckets.set(key, b);
  }
  if (b.count >= max) return false;
  b.count += 1;
  return true;
}

/**
 * Contador de falhas de login (anti força-bruta).
 * Diferente do checkRateLimit acima: só conta tentativa ERRADA e zera no acerto,
 * então quem digita a senha certa nunca é bloqueado, por mais que use o sistema.
 */
const loginFailures = new Map<string, { count: number; resetAt: number }>();
const LOGIN_FAILURES_MAX_KEYS = 5000;

function pruneLoginFailures(now: number): void {
  for (const [k, v] of loginFailures) {
    if (now > v.resetAt) loginFailures.delete(k);
  }
}

/** true = chave já estourou o limite e deve receber 429. Não incrementa nada. */
export function isLoginBlocked(key: string, max: number): boolean {
  const b = loginFailures.get(key);
  if (!b) return false;
  if (Date.now() > b.resetAt) {
    loginFailures.delete(key);
    return false;
  }
  return b.count >= max;
}

/** Registra UMA tentativa errada. Chamar só quando a senha não confere. */
export function registerLoginFailure(key: string, windowMs: number): void {
  const now = Date.now();
  const b = loginFailures.get(key);
  if (!b || now > b.resetAt) {
    if (loginFailures.size >= LOGIN_FAILURES_MAX_KEYS) pruneLoginFailures(now);
    loginFailures.set(key, { count: 1, resetAt: now + windowMs });
    return;
  }
  b.count += 1;
}

/** Login correto: limpa o histórico de falhas daquela chave. */
export function clearLoginFailures(key: string): void {
  loginFailures.delete(key);
}

/** Segundos restantes de bloqueio (para informar o usuário). */
export function loginBlockRetryAfterSeconds(key: string): number {
  const b = loginFailures.get(key);
  if (!b) return 0;
  return Math.max(0, Math.ceil((b.resetAt - Date.now()) / 1000));
}
