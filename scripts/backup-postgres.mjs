/**
 * Backup do PostgreSQL de produção (EasyPanel).
 *
 * Uso:
 *   DATABASE_URL="postgres://..." npm run db:backup
 *   node scripts/backup-postgres.mjs --url "postgres://..."
 *
 * Preferência: pg_dump (SQL completo, ideal para restaurar).
 * Fallback: export JSON via Prisma (restaurar com npm run db:restore).
 *
 * No EasyPanel, rode no terminal do serviço do app (já tem DATABASE_URL interna).
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { spawnSync } from 'child_process';
import dotenv from 'dotenv';
import { PrismaClient } from '@prisma/client';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const BACKUP_DIR = path.join(ROOT, 'backups');

dotenv.config({ path: path.join(ROOT, '.env'), override: true });

const MODELS = [
  'category',
  'user',
  'product',
  'setting',
  'trialForm',
  'outgoingWebhook',
  'shortLink',
  'mediaFolder',
  'mediaAsset',
  'webhookLog',
  'ebook',
  'license',
  'licenseWebhookRawLog',
  'rankingEntry',
  'trialHistory',
  'course',
  'courseModule',
  'courseLesson',
  'purchase',
  'wishlist',
  'highlight',
  'lessonProgress',
  'shortLinkClick',
];

function parseDatabaseUrl(raw) {
  const url = new URL(raw);
  return {
    host: url.hostname,
    port: url.port || '5432',
    user: decodeURIComponent(url.username),
    password: decodeURIComponent(url.password),
    database: url.pathname.replace(/^\//, '').split('?')[0],
    sslmode: url.searchParams.get('sslmode') || 'prefer',
  };
}

function getDatabaseUrl() {
  const idx = process.argv.indexOf('--url');
  if (idx !== -1 && process.argv[idx + 1]) {
    return process.argv[idx + 1].trim();
  }
  const url = process.env.DATABASE_URL?.trim();
  if (!url) {
    throw new Error(
      'DATABASE_URL não definida. Use --url ou exporte DATABASE_URL no ambiente.'
    );
  }
  return url;
}

function timestamp() {
  const d = new Date();
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`;
}

function tryPgDump(databaseUrl, outFile) {
  const cfg = parseDatabaseUrl(databaseUrl);
  const args = [
    '-h',
    cfg.host,
    '-p',
    cfg.port,
    '-U',
    cfg.user,
    '-d',
    cfg.database,
    '--no-owner',
    '--no-acl',
    '-f',
    outFile,
  ];
  if (cfg.sslmode === 'disable') args.unshift('--no-sync');

  const env = { ...process.env, PGPASSWORD: cfg.password };
  const bin = process.platform === 'win32' ? 'pg_dump.exe' : 'pg_dump';
  const result = spawnSync(bin, args, { env, encoding: 'utf8' });

  if (result.error?.code === 'ENOENT') {
    return { ok: false, reason: 'pg_dump não encontrado no PATH' };
  }
  if (result.status !== 0) {
    const msg = [result.stderr, result.stdout].filter(Boolean).join('\n').trim();
    return { ok: false, reason: msg || `pg_dump exit ${result.status}` };
  }
  if (!fs.existsSync(outFile) || fs.statSync(outFile).size === 0) {
    return { ok: false, reason: 'pg_dump não gerou arquivo' };
  }
  return { ok: true };
}

async function exportViaPrisma(databaseUrl, outFile) {
  process.env.DATABASE_URL = databaseUrl;
  const prisma = new PrismaClient();
  const payload = {
    exportedAt: new Date().toISOString(),
    source: 'prisma-json',
    tables: {},
  };

  try {
    for (const model of MODELS) {
      const rows = await prisma[model].findMany();
      payload.tables[model] = rows;
      console.log(`[backup] ${model}: ${rows.length} registros`);
    }
  } finally {
    await prisma.$disconnect();
  }

  fs.writeFileSync(outFile, JSON.stringify(payload));
  return payload;
}

async function main() {
  const databaseUrl = getDatabaseUrl();
  if (!databaseUrl.startsWith('postgres')) {
    throw new Error('DATABASE_URL deve ser PostgreSQL (postgres://...).');
  }

  fs.mkdirSync(BACKUP_DIR, { recursive: true });
  const ts = timestamp();
  const sqlFile = path.join(BACKUP_DIR, `autofintech-${ts}.sql`);
  const jsonFile = path.join(BACKUP_DIR, `autofintech-${ts}.json`);

  console.log('[backup] Tentando pg_dump...');
  const dump = tryPgDump(databaseUrl, sqlFile);
  if (dump.ok) {
    const sizeKb = Math.round(fs.statSync(sqlFile).size / 1024);
    console.log(`[backup] SQL salvo: ${sqlFile} (${sizeKb} KB)`);
    return;
  }

  console.warn(`[backup] pg_dump indisponível ou falhou: ${dump.reason}`);
  console.log('[backup] Exportando via Prisma (JSON)...');

  await exportViaPrisma(databaseUrl, jsonFile);
  const sizeKb = Math.round(fs.statSync(jsonFile).size / 1024);
  console.log(`[backup] JSON salvo: ${jsonFile} (${sizeKb} KB)`);
  console.log('[backup] Restaurar: npm run db:restore -- ' + path.basename(jsonFile));
}

main().catch((err) => {
  console.error('[backup] Erro:', err.message || err);
  process.exit(1);
});
