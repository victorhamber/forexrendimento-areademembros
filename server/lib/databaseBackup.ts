import type { PrismaClient } from '@prisma/client';

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
] as const;

export async function exportDatabaseJson(prisma: PrismaClient) {
  const tables: Record<string, unknown[]> = {};
  for (const model of MODELS) {
    tables[model] = await prisma[model].findMany();
  }
  return {
    exportedAt: new Date().toISOString(),
    source: 'prisma-json',
    tables,
  };
}
