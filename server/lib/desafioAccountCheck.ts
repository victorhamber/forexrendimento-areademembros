import type { PrismaClient } from '@prisma/client';
import type { LicenseLite, ProductLite } from './licenseProductMatch.js';
import {
  DESAFIO_ACCOUNT_REUSE_MESSAGE,
  findDesafioAccountConflict,
  isDesafioPlan,
} from './desafioLicenseRules.js';

export { DESAFIO_ACCOUNT_REUSE_MESSAGE };

export async function assertDesafioAccountAllowed(
  prisma: PrismaClient,
  targetLicense: LicenseLite & { id?: number; plano?: string | null },
  numeroConta: string,
  products: ProductLite[]
): Promise<{ ok: true } | { ok: false; message: string }> {
  const account = String(numeroConta || '').trim();
  if (!account || !isDesafioPlan(targetLicense.plano)) {
    return { ok: true };
  }

  const desafioRows = await prisma.license.findMany({
    where: {
      numeroConta: account,
      OR: [
        { plano: { contains: 'teste', mode: 'insensitive' } },
        { plano: { contains: 'desafio', mode: 'insensitive' } },
      ],
    },
    select: {
      id: true,
      email: true,
      plano: true,
      systemId: true,
      offerCode: true,
      numeroConta: true,
    },
  });

  const conflict = findDesafioAccountConflict(
    targetLicense,
    account,
    desafioRows,
    products,
    targetLicense.id
  );
  if (conflict) {
    return { ok: false, message: DESAFIO_ACCOUNT_REUSE_MESSAGE };
  }
  return { ok: true };
}
