import type { PrismaClient } from '@prisma/client';

export async function getForexApiKeys(prisma: PrismaClient): Promise<string[]> {
  const row = await prisma.setting.findUnique({ where: { key: 'forex_api_keys' } });
  if (!row?.value) return [];
  try {
    const parsed = JSON.parse(row.value) as unknown;
    return Array.isArray(parsed) ? parsed.filter((x): x is string => typeof x === 'string') : [];
  } catch {
    return [];
  }
}

export async function getForexWebhookToken(prisma: PrismaClient): Promise<string> {
  const row = await prisma.setting.findUnique({ where: { key: 'forex_webhook_token' } });
  return row?.value?.trim() || '';
}

export async function getTashWebhookToken(prisma: PrismaClient): Promise<string> {
  const row = await prisma.setting.findUnique({ where: { key: 'tash_webhook_token' } });
  return row?.value?.trim() || '';
}

export async function getTashWebhookProductId(prisma: PrismaClient): Promise<string> {
  const row = await prisma.setting.findUnique({ where: { key: 'tash_webhook_product_id' } });
  return row?.value?.trim() || '';
}

export async function setForexApiKeys(prisma: PrismaClient, keys: string[]) {
  await prisma.setting.upsert({
    where: { key: 'forex_api_keys' },
    update: { value: JSON.stringify(keys) },
    create: { key: 'forex_api_keys', value: JSON.stringify(keys) }
  });
}
