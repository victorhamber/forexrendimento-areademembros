import type { PrismaClient } from '@prisma/client';
import { isPrismaUniqueViolation } from './prismaErrors.js';

/** Tabelas com `id Int @default(autoincrement())` — após import WP a sequence pode ficar atrás do MAX(id). */
const AUTO_ID_TABLES = [
  'License',
  'Product',
  'LicenseWebhookRawLog',
  'OutgoingWebhook',
  'RankingEntry',
  'ShortLink',
  'ShortLinkClick',
] as const;

/**
 * Ajusta sequences PostgreSQL para o próximo INSERT usar MAX(id)+1.
 * Corrige P2002 em `id` após migração MariaDB → Postgres com IDs explícitos.
 */
export async function repairAutoincrementSequences(prisma: PrismaClient): Promise<number> {
  let repaired = 0;
  for (const table of AUTO_ID_TABLES) {
    try {
      const rows = await prisma.$queryRawUnsafe<Array<{ max: number | null }>>(
        `SELECT MAX(id) AS max FROM "${table}"`
      );
      const maxId = Number(rows[0]?.max ?? 0);
      if (maxId <= 0) {
        await prisma.$executeRawUnsafe(
          `SELECT setval(pg_get_serial_sequence('"${table}"', 'id'), 1, false)`
        );
      } else {
        await prisma.$executeRawUnsafe(
          `SELECT setval(pg_get_serial_sequence('"${table}"', 'id'), ${maxId}, true)`
        );
      }
      repaired += 1;
    } catch (err) {
      console.warn(`[db] repair sequence "${table}" ignorado:`, err instanceof Error ? err.message : err);
    }
  }
  return repaired;
}

export async function createLicenseWebhookRawLog(
  prisma: PrismaClient,
  rawData: string,
  processed = false
) {
  try {
    return await prisma.licenseWebhookRawLog.create({ data: { rawData, processed } });
  } catch (err) {
    if (!isPrismaUniqueViolation(err, 'id')) throw err;
    console.warn('[webhook] Sequence LicenseWebhookRawLog desincronizada — reparando...');
    await repairAutoincrementSequences(prisma);
    return prisma.licenseWebhookRawLog.create({ data: { rawData, processed } });
  }
}
