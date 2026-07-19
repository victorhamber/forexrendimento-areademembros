import path from 'path';

/** Extensões aceitas na biblioteca de mídia → MIME para armazenamento e resposta HTTP. */
export const UPLOAD_EXTENSION_MIME: Record<string, string> = {
  '.webp': 'image/webp',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png': 'image/png',
  '.gif': 'image/gif',
  '.svg': 'image/svg+xml',
  '.avif': 'image/avif',
  '.bmp': 'image/bmp',
  '.ico': 'image/x-icon',
  '.mp4': 'video/mp4',
  '.webm': 'video/webm',
  '.mov': 'video/quicktime',
  '.mp3': 'audio/mpeg',
  '.wav': 'audio/wav',
  '.ogg': 'audio/ogg',
  '.pdf': 'application/pdf',
  '.zip': 'application/zip',
};

const IMAGE_EXTENSIONS = new Set(
  Object.entries(UPLOAD_EXTENSION_MIME)
    .filter(([, mime]) => mime.startsWith('image/'))
    .map(([ext]) => ext)
);

/** Extensão conhecida (prioriza .webp, .tar.gz, etc.). */
export function getFileExtension(filename: string): string {
  const lower = String(filename || '').toLowerCase();
  const known = Object.keys(UPLOAD_EXTENSION_MIME).sort((a, b) => b.length - a.length);
  for (const ext of known) {
    if (lower.endsWith(ext)) return ext;
  }
  return path.extname(lower).toLowerCase();
}

export function mimeFromFilename(filename: string): string | null {
  const ext = getFileExtension(filename);
  return UPLOAD_EXTENSION_MIME[ext] ?? null;
}

const MIME_TO_EXT: Record<string, string> = {
  'image/webp': '.webp',
  'image/jpeg': '.jpg',
  'image/png': '.png',
  'image/gif': '.gif',
  'image/svg+xml': '.svg',
  'image/avif': '.avif',
};

/** Normaliza MIME do multer (inclui .webp quando o SO envia octet-stream). */
export function resolveUploadMime(
  mimetype: string | undefined,
  originalname: string
): string {
  const reported = String(mimetype || '').toLowerCase().trim();
  const fromExt = mimeFromFilename(originalname);

  if (fromExt) {
    if (!reported || reported === 'application/octet-stream') return fromExt;
    if (reported === 'image/webp' || reported === fromExt) return reported;
    // Navegador reportou outro tipo — prioriza extensão para .webp/.avif etc.
    if (IMAGE_EXTENSIONS.has(getFileExtension(originalname))) return fromExt;
  }

  if (reported && reported !== 'application/octet-stream') return reported;
  return fromExt || reported || 'application/octet-stream';
}

export function detectMediaKind(
  mimetype: string | undefined,
  originalname: string
): 'imagem' | 'video' | 'audio' | 'arquivo' {
  const mime = resolveUploadMime(mimetype, originalname);
  if (mime.startsWith('image/')) return 'imagem';
  if (mime.startsWith('video/')) return 'video';
  if (mime.startsWith('audio/')) return 'audio';
  return 'arquivo';
}

/**
 * Remove o prefixo único do multer (`timestamp-random-`) do nome no disco,
 * para o download sair com nome limpo (ex.: EATREND.ex5).
 */
export function cleanStoredUploadFilename(storedName: string): string {
  const base = path.basename(String(storedName || '').trim());
  if (!base) return 'arquivo';
  const cleaned = base.replace(/^\d{10,}-\d+-/, '');
  return cleaned || base;
}

/** Nome amigável para Content-Disposition / atributo download. */
export function resolveFriendlyDownloadName(
  preferredName: string | null | undefined,
  storedOrUrl: string | null | undefined
): string {
  const preferred = path.basename(String(preferredName || '').trim());
  if (preferred && !/^\d{10,}-\d+-/.test(preferred)) return preferred;
  const fromStored = cleanStoredUploadFilename(String(storedOrUrl || ''));
  // Se veio URL /uploads/..., pega só o arquivo
  const onlyFile = fromStored.includes('/') ? path.basename(fromStored) : fromStored;
  return onlyFile || preferred || 'arquivo';
}

/** Nome seguro no disco preservando extensão (.webp, etc.). */
export function safeUploadFilename(originalname: string, mimetype?: string): string {
  const decoded = decodeUploadOriginalName(originalname);
  let ext = getFileExtension(decoded);
  if (!ext || !UPLOAD_EXTENSION_MIME[ext]) {
    const fromMime = MIME_TO_EXT[String(mimetype || '').toLowerCase()];
    if (fromMime) ext = fromMime;
  }
  const base = (ext ? path.basename(decoded, ext) : decoded)
    .replace(/[^a-zA-Z0-9.\-_]/g, '')
    .slice(0, 100);
  const safeBase = base || 'arquivo';
  if (ext && UPLOAD_EXTENSION_MIME[ext]) return `${safeBase}${ext}`;
  if (ext && /^\.[a-z0-9]{1,8}$/i.test(ext)) return `${safeBase}${ext}`;
  return safeBase;
}

/** Multer costuma enviar UTF-8 no campo originalname como latin1. */
export function decodeUploadOriginalName(name: string): string {
  const raw = String(name || '').trim() || 'arquivo';
  try {
    const decoded = Buffer.from(raw, 'latin1').toString('utf8');
    if (decoded.includes('\uFFFD')) return raw;
    return decoded;
  } catch {
    return raw;
  }
}

export function formatMediaUploadError(err: unknown): string {
  const code = (err as { code?: string })?.code;
  if (code === 'P2003') {
    return 'Pasta inválida ou removida. Selecione outra pasta ou envie sem pasta.';
  }
  if (code === 'P2021' || code === 'P2022') {
    return 'Banco desatualizado: execute a migração (prisma migrate deploy) no servidor.';
  }
  if (err instanceof Error && err.message.includes('ENOENT')) {
    return 'Pasta de uploads inexistente ou sem permissão no servidor (UPLOAD_DIR).';
  }
  if (err instanceof Error && err.message.includes('EACCES')) {
    return 'Sem permissão para gravar arquivos no servidor (UPLOAD_DIR).';
  }
  if (err instanceof Error && err.message.trim()) {
    return `Falha ao salvar mídia: ${err.message}`;
  }
  return 'Falha ao salvar mídia. Verifique os logs do servidor.';
}

export function resolveStoredMediaMime(mimeType: string | null | undefined, storedName: string): string {
  const stored = String(mimeType || '').trim();
  if (stored && stored !== 'application/octet-stream') return stored;
  return mimeFromFilename(storedName) || stored || 'application/octet-stream';
}
