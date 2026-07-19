import type { PrismaClient } from '@prisma/client';

export const PAGE_BUILDER_PAGES_KEY = 'admin_page_builder_pages_json';
export const PAGE_BUILDER_FOLDERS_KEY = 'admin_page_builder_folders_json';
export const PAGE_BUILDER_LEGACY_KEY = 'admin_page_builder_html';
export const PAGE_BUILDER_SNAPSHOT_PREFIX = 'admin_page_builder_snapshot_';
const PAGE_BUILDER_SNAPSHOT_MAX = 20;

export type BuilderPageRecord = {
  slug: string;
  html: string;
  published?: boolean;
  target?: string;
  folderId?: string;
  updatedAt?: string;
};

export function normalizeBuilderSlug(raw: string): string {
  return (
    String(raw || '')
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .toLowerCase()
      .replace(/[^a-z0-9-_/]+/g, '-')
      .replace(/\/+/g, '/')
      .replace(/(^[-/]+|[-/]+$)/g, '') || ''
  );
}

function tryParseJson(raw: string): unknown {
  const trimmed = String(raw || '').trim();
  if (!trimmed) return null;
  try {
    return JSON.parse(trimmed) as unknown;
  } catch {
    return null;
  }
}

/** Aceita array direto ou JSON duplamente serializado (string dentro de string). */
export function parseBuilderPagesJson(raw: string): BuilderPageRecord[] {
  let parsed: unknown = tryParseJson(raw);
  if (typeof parsed === 'string') {
    parsed = tryParseJson(parsed);
  }
  if (!Array.isArray(parsed)) return [];

  return parsed
    .map((x) => x as Partial<BuilderPageRecord>)
    .filter((x) => x && typeof x.slug === 'string')
    .map((x) => ({
      slug: normalizeBuilderSlug(String(x.slug)),
      html: String(x.html ?? ''),
      published: x.published === false ? false : true,
      target: x.target === 'header' ? 'header' : 'body',
      folderId: typeof x.folderId === 'string' ? x.folderId : undefined,
      updatedAt: x.updatedAt ? String(x.updatedAt) : undefined,
    }))
    .filter((p) => p.slug && p.html.trim().length > 0);
}

export function isBuilderPagePublished(page: BuilderPageRecord): boolean {
  return page.published !== false;
}

export async function loadBuilderPages(prisma: PrismaClient): Promise<BuilderPageRecord[]> {
  const [pagesRow, legacyRow] = await Promise.all([
    prisma.setting.findUnique({ where: { key: PAGE_BUILDER_PAGES_KEY } }),
    prisma.setting.findUnique({ where: { key: PAGE_BUILDER_LEGACY_KEY } }),
  ]);

  let pages = parseBuilderPagesJson(String(pagesRow?.value || ''));
  if (pages.length) return pages;

  const legacyHtml = String(legacyRow?.value || '').trim();
  if (legacyHtml) {
    return [
      {
        slug: 'pagina-principal',
        html: legacyHtml,
        published: true,
        target: 'body',
      },
    ];
  }

  return [];
}

export function findBuilderPageBySlug(
  pages: BuilderPageRecord[],
  slug: string
): BuilderPageRecord | null {
  const desired = normalizeBuilderSlug(slug);
  if (!desired) return null;
  return pages.find((p) => normalizeBuilderSlug(p.slug) === desired) ?? null;
}

export function serializeBuilderPagesSetting(pages: BuilderPageRecord[]): string {
  return JSON.stringify(pages, null, 2);
}

export type PageBuilderSaveResult =
  | { ok: true; saved: number; previous: number; snapshotKey: string | null }
  | { ok: false; code: 'shrink_blocked'; saved: number; previous: number; snapshotKey: string | null }
  | { ok: false; code: 'invalid_payload'; message: string };

async function pruneSnapshots(prisma: PrismaClient) {
  const all = await prisma.setting.findMany({
    where: { key: { startsWith: PAGE_BUILDER_SNAPSHOT_PREFIX } },
  });
  if (all.length <= PAGE_BUILDER_SNAPSHOT_MAX) return;
  const sorted = [...all].sort((a, b) => (a.key < b.key ? -1 : 1));
  const toRemove = sorted.slice(0, sorted.length - PAGE_BUILDER_SNAPSHOT_MAX);
  for (const row of toRemove) {
    await prisma.setting.delete({ where: { key: row.key } }).catch(() => null);
  }
}

async function writeSnapshot(prisma: PrismaClient, payload: string): Promise<string | null> {
  const trimmed = String(payload || '').trim();
  if (!trimmed) return null;
  const ts = new Date().toISOString().replace(/[^0-9]/g, '').slice(0, 14);
  const key = `${PAGE_BUILDER_SNAPSHOT_PREFIX}${ts}_${Math.random().toString(36).slice(2, 8)}`;
  await prisma.setting.upsert({
    where: { key },
    update: { value: trimmed },
    create: { key, value: trimmed },
  });
  await pruneSnapshots(prisma);
  return key;
}

/**
 * Persiste a lista de páginas do construtor com proteções:
 *  - rejeita payload inválido (não-JSON ou não-array);
 *  - bloqueia shrink sem allowShrink (evita perda acidental);
 *  - sempre grava um snapshot com o valor anterior antes de sobrescrever.
 */
export async function savePagesWithGuard(
  prisma: PrismaClient,
  newRawJson: string,
  opts?: { allowShrink?: boolean }
): Promise<PageBuilderSaveResult> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(newRawJson);
  } catch {
    return { ok: false, code: 'invalid_payload', message: 'JSON inválido em admin_page_builder_pages_json.' };
  }
  if (!Array.isArray(parsed)) {
    return { ok: false, code: 'invalid_payload', message: 'admin_page_builder_pages_json precisa ser um array.' };
  }
  const incomingPages = parseBuilderPagesJson(newRawJson);

  const current = await prisma.setting.findUnique({ where: { key: PAGE_BUILDER_PAGES_KEY } });
  const currentRaw = String(current?.value || '');
  const currentPages = parseBuilderPagesJson(currentRaw);

  const snapshotKey = currentRaw.trim() ? await writeSnapshot(prisma, currentRaw) : null;

  if (currentPages.length > 0 && incomingPages.length < currentPages.length && !opts?.allowShrink) {
    return {
      ok: false,
      code: 'shrink_blocked',
      saved: incomingPages.length,
      previous: currentPages.length,
      snapshotKey,
    };
  }

  await prisma.setting.upsert({
    where: { key: PAGE_BUILDER_PAGES_KEY },
    update: { value: newRawJson },
    create: { key: PAGE_BUILDER_PAGES_KEY, value: newRawJson },
  });

  return {
    ok: true,
    saved: incomingPages.length,
    previous: currentPages.length,
    snapshotKey,
  };
}

export async function listPageBuilderSnapshots(prisma: PrismaClient) {
  const rows = await prisma.setting.findMany({
    where: { key: { startsWith: PAGE_BUILDER_SNAPSHOT_PREFIX } },
  });
  return rows
    .map((r) => {
      const pages = parseBuilderPagesJson(String(r.value || ''));
      return { key: r.key, pages: pages.length };
    })
    .sort((a, b) => (a.key < b.key ? 1 : -1));
}

export async function restorePageBuilderSnapshot(prisma: PrismaClient, snapshotKey: string) {
  if (!snapshotKey.startsWith(PAGE_BUILDER_SNAPSHOT_PREFIX)) {
    throw new Error('Chave de snapshot inválida.');
  }
  const snap = await prisma.setting.findUnique({ where: { key: snapshotKey } });
  if (!snap) throw new Error('Snapshot não encontrado.');
  await writeSnapshot(prisma, String(snap.value || ''));
  await prisma.setting.upsert({
    where: { key: PAGE_BUILDER_PAGES_KEY },
    update: { value: snap.value },
    create: { key: PAGE_BUILDER_PAGES_KEY, value: snap.value },
  });
  return parseBuilderPagesJson(String(snap.value || ''));
}

/**
 * Apaga TODAS as páginas, pastas, legado e snapshots do construtor.
 * Antes de apagar, salva um snapshot final do estado atual de páginas como
 * rede de segurança interna (não exposta na UI). Idempotente.
 */
export async function resetPageBuilder(prisma: PrismaClient) {
  const current = await prisma.setting.findUnique({ where: { key: PAGE_BUILDER_PAGES_KEY } });
  const currentRaw = String(current?.value || '').trim();
  if (currentRaw) {
    await writeSnapshot(prisma, currentRaw);
  }
  const result = await prisma.setting.deleteMany({
    where: {
      OR: [
        { key: PAGE_BUILDER_PAGES_KEY },
        { key: PAGE_BUILDER_FOLDERS_KEY },
        { key: PAGE_BUILDER_LEGACY_KEY },
        { key: { startsWith: PAGE_BUILDER_SNAPSHOT_PREFIX } },
      ],
    },
  });
  return { removed: result.count };
}

const DEFAULT_PAGE_BRAND_TITLE = 'Forex Rendimento';
const PLACEHOLDER_TITLES = /^(nova\s*p[aá]gina|new\s*page|untitled|sem\s*t[ií]tulo)$/i;

function titleFromSlug(slug: string): string {
  const cleaned = normalizeBuilderSlug(slug).replace(/[-_/]+/g, ' ').trim();
  if (!cleaned) return DEFAULT_PAGE_BRAND_TITLE;
  const pretty = cleaned
    .split(/\s+/)
    .map((w) => {
      if (/^(ea|fr|mt5|pwa|html|api)$/i.test(w)) return w.toUpperCase();
      return w.charAt(0).toUpperCase() + w.slice(1);
    })
    .join(' ');
  return `${pretty} | ${DEFAULT_PAGE_BRAND_TITLE}`;
}

const FAVICON_SNIPPET = [
  '<link rel="icon" href="/favicon.ico?v=2" sizes="any" />',
  '<link rel="icon" type="image/jpeg" href="/fivicon.jpg?v=2" />',
  '<link rel="apple-touch-icon" sizes="180x180" href="/apple-touch-icon.png?v=2" />',
].join('\n    ');

/**
 * Ajusta título/favicon das páginas do construtor no momento do serve,
 * para páginas antigas que ainda têm "Nova Página" / sem ícone da marca.
 */
export function enhanceBuilderPageHtml(html: string, slug: string): string {
  let out = String(html || '');
  if (!out.trim()) return out;

  const desiredTitle = titleFromSlug(slug);
  const titleMatch = out.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  if (titleMatch) {
    const current = String(titleMatch[1] || '').replace(/\s+/g, ' ').trim();
    if (!current || PLACEHOLDER_TITLES.test(current)) {
      out = out.replace(/<title[^>]*>[\s\S]*?<\/title>/i, `<title>${desiredTitle}</title>`);
    }
  } else if (/<head[\s>]/i.test(out)) {
    out = out.replace(/<head([^>]*)>/i, `<head$1>\n    <title>${desiredTitle}</title>`);
  }

  // Remove favicons antigos/errados e injeta o da marca
  out = out.replace(
    /<link\b[^>]*rel=["'](?:shortcut )?icon["'][^>]*>\s*/gi,
    ''
  );
  out = out.replace(/<link\b[^>]*rel=["']apple-touch-icon["'][^>]*>\s*/gi, '');
  if (/<\/head>/i.test(out)) {
    out = out.replace(/<\/head>/i, `    ${FAVICON_SNIPPET}\n  </head>`);
  } else if (/<head([^>]*)>/i.test(out)) {
    out = out.replace(/<head([^>]*)>/i, `<head$1>\n    ${FAVICON_SNIPPET}`);
  }

  return out;
}
