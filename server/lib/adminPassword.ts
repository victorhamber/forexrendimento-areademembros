import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

/**
 * Senha master do /admin (header x-admin-password).
 * Se ADMIN_PASSWORD estiver no .env (após loadEnv com override), ela vale.
 * Caso contrário, usa senha local de teste (defina ADMIN_PASSWORD em produção).
 */
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT_ENV_FILE = path.resolve(__dirname, '../../.env');

let warnedMissingAdminPassword = false;
let warnedSystemAdminPassword = false;

const DEV_FALLBACK = 'AdminTeste@local';
const DEV_FALLBACK_EMAIL = 'admin@local.dev';

export function normalizeAdminEmail(raw: string): string {
  return String(raw || '')
    .trim()
    .toLowerCase();
}

export function resolveAdminEmail(): string {
  const raw = process.env.ADMIN_EMAIL;
  if (raw !== undefined && String(raw).trim() !== '') {
    return normalizeAdminEmail(String(raw));
  }
  if (process.env.NODE_ENV === 'production') {
    return 'admin@forexrendimento.com';
  }
  return DEV_FALLBACK_EMAIL;
}

export function validateAdminCredentials(email: string, password: string): boolean {
  if (normalizeAdminEmail(email) !== resolveAdminEmail()) return false;
  return String(password ?? '') === resolveAdminPassword();
}

/** Remove BOM, espaços e aspas comuns do .env (ex.: ADMIN_PASSWORD="minhasenha"). */
function normalizePasswordFromEnv(raw: string): string {
  let s = raw.replace(/^\uFEFF/, '').trim();
  if (s.length >= 2) {
    const q = s[0];
    if ((q === '"' || q === "'") && s[s.length - 1] === q) {
      s = s.slice(1, -1).trim();
    }
  }
  return s;
}

export function resolveAdminPassword(): string {
  const raw = process.env.ADMIN_PASSWORD;
  if (raw !== undefined && String(raw).trim() !== '') {
    if (process.env.NODE_ENV !== 'production' && !warnedSystemAdminPassword) {
      warnedSystemAdminPassword = true;
      if (!fs.existsSync(ROOT_ENV_FILE)) {
        console.warn(
          '[Admin] ADMIN_PASSWORD veio do ambiente (PowerShell/Windows), não de um .env na pasta do projeto. ' +
            'Se o login do /admin falha, crie `Biblioteca de Ebooks/.env` com ADMIN_PASSWORD=AdminTeste@local ou apague ADMIN_PASSWORD das variáveis de ambiente do sistema.'
        );
      }
    }
    return normalizePasswordFromEnv(String(raw));
  }
  if (!warnedMissingAdminPassword) {
    warnedMissingAdminPassword = true;
    console.warn(
      `[Admin] ADMIN_PASSWORD não definida — usando senha de teste "${DEV_FALLBACK}" (defina ADMIN_PASSWORD em produção).`
    );
  }
  return DEV_FALLBACK;
}

/** Express pode entregar o header como string | string[]. */
export function normalizeIncomingAdminPassword(header: unknown): string | undefined {
  if (header == null) return undefined;
  if (Array.isArray(header)) return header[0]?.toString().trim() || undefined;
  const s = String(header).trim();
  return s || undefined;
}
