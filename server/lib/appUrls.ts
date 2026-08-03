/** URL pública da área de membros (e-mails, links para o cliente). */
const DEFAULT_MEMBER_URL = 'https://forexrendimento.com';

/** URL canônica para webhooks/API externa (Hotmart, EA). Mantém compatibilidade com subdomínio app. */
const DEFAULT_WEBHOOK_BASE = 'https://app.forexrendimento.com';

function normalizeBaseUrl(raw: string): string {
  const v = String(raw || '').trim();
  if (!v) return '';
  return v.endsWith('/') ? v.slice(0, -1) : v;
}

export function getMemberAppUrl(): string {
  return normalizeBaseUrl(process.env.APP_URL || DEFAULT_MEMBER_URL) || DEFAULT_MEMBER_URL;
}

export function getWebhookBaseUrl(): string {
  const fromEnv = normalizeBaseUrl(process.env.WEBHOOK_BASE_URL || '');
  if (fromEnv) return fromEnv;
  return normalizeBaseUrl(process.env.APP_URL || DEFAULT_WEBHOOK_BASE) || DEFAULT_WEBHOOK_BASE;
}

export function getWebhookUrls() {
  const appUrl = getMemberAppUrl();
  const webhookBaseUrl = getWebhookBaseUrl();
  const bases = [...new Set([webhookBaseUrl, appUrl].filter(Boolean))];

  return {
    appUrl,
    webhookBaseUrl,
    hotmartWebhook: `${webhookBaseUrl}/api/webhooks/hotmart`,
    tashWebhook: `${webhookBaseUrl}/api/webhooks/tash`,
    forexWebhook: `${webhookBaseUrl}/api/forex-rendimento/v1/webhook`,
    /** Ambos os domínios apontam para o mesmo app — qualquer um funciona se o DNS/proxy estiver ok. */
    alternateHotmartWebhooks: bases.map((b) => `${b}/api/webhooks/hotmart`),
    alternateTashWebhooks: bases.map((b) => `${b}/api/webhooks/tash`),
    alternateForexWebhooks: bases.map((b) => `${b}/api/forex-rendimento/v1/webhook`),
  };
}

export function extractHotmartWebhookToken(req: {
  headers: Record<string, string | string[] | undefined>;
  query: Record<string, unknown>;
}): string {
  const h = req.headers;
  const fromHeader =
    h['x-hottok'] ||
    h['hottok'] ||
    h['x-hotmart-hottok'] ||
    h['x-webhook-token'];
  if (fromHeader) return String(Array.isArray(fromHeader) ? fromHeader[0] : fromHeader).trim();
  const q = req.query?.hottok;
  if (q != null) return String(q).trim();
  return '';
}
