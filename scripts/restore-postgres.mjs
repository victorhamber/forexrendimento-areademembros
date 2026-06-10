/**
 * Restaura backup gerado por backup-postgres.mjs
 *
 * SQL (pg_dump):
 *   psql "$DATABASE_URL" -f backups/autofintech-....sql
 *
 * JSON (Prisma):
 *   DATABASE_URL="postgres://..." npm run db:restore -- autofintech-....json
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';
import { PrismaClient } from '@prisma/client';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const BACKUP_DIR = path.join(ROOT, 'backups');

dotenv.config({ path: path.join(ROOT, '.env'), override: true });

const TABLE_ORDER = [
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

const INT_ID_MODELS = new Set([
  'product',
  'license',
  'licenseWebhookRawLog',
  'outgoingWebhook',
  'rankingEntry',
  'trialForm',
  'trialHistory',
  'shortLink',
  'shortLinkClick',
]);

const PG_TABLE_NAMES = {
  ebook: 'Ebook',
  product: 'Product',
  license: 'License',
  licenseWebhookRawLog: 'LicenseWebhookRawLog',
  outgoingWebhook: 'OutgoingWebhook',
  rankingEntry: 'RankingEntry',
  trialForm: 'TrialForm',
  trialHistory: 'TrialHistory',
  shortLink: 'ShortLink',
  shortLinkClick: 'ShortLinkClick',
};

function resolveBackupFile(arg) {
  if (!arg) {
    throw new Error('Informe o arquivo: npm run db:restore -- autofintech-....json');
  }
  const candidate = path.isAbsolute(arg) ? arg : path.join(BACKUP_DIR, arg);
  if (!fs.existsSync(candidate)) {
    throw new Error(`Arquivo não encontrado: ${candidate}`);
  }
  return candidate;
}

async function restoreJson(file) {
  const url = process.env.DATABASE_URL?.trim();
  if (!url?.startsWith('postgres')) {
    throw new Error('DATABASE_URL PostgreSQL não definida.');
  }

  const payload = JSON.parse(fs.readFileSync(file, 'utf8'));
  const prisma = new PrismaClient();

  try {
    await prisma.$transaction(async (tx) => {
      for (const model of [...TABLE_ORDER].reverse()) {
        await tx[model].deleteMany();
      }
    });

    for (const model of TABLE_ORDER) {
      const rows = payload.tables?.[model] || [];
      if (!rows.length) {
        console.log(`[restore] ${model}: 0`);
        continue;
      }
      await prisma[model].createMany({ data: rows, skipDuplicates: true });
      console.log(`[restore] ${model}: ${rows.length}`);
    }

    for (const model of INT_ID_MODELS) {
      const rows = payload.tables?.[model] || [];
      if (!rows.length) continue;
      const maxId = Math.max(...rows.map((r) => Number(r.id) || 0));
      if (maxId <= 0) continue;
      const table = PG_TABLE_NAMES[model] || model;
      await prisma.$executeRawUnsafe(
        `SELECT setval(pg_get_serial_sequence('"${table}"', 'id'), ${maxId}, true)`
      );
    }

    console.log('[restore] Concluído.');
  } finally {
    await prisma.$disconnect();
  }
}

async function main() {
  const fileArg = process.argv[2];
  const file = resolveBackupFile(fileArg);

  if (file.endsWith('.sql')) {
    console.log('[restore] Arquivo SQL: use psql no servidor:');
    console.log(`  psql "$DATABASE_URL" -f "${file}"`);
    process.exit(1);
  }

  await restoreJson(file);
}

main().catch((err) => {
  console.error('[restore] Erro:', err.message || err);
  process.exit(1);
});
