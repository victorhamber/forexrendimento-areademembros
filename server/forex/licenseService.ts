import type { License, PrismaClient } from '@prisma/client';
import { cacheGet, cacheSet, invalidateLicenseCacheForEmail } from '../lib/licenseValidationCache.js';
import { filterLicensesForValidation } from '../lib/licenseProductMatch.js';
import { fireLicenseExpiryUpdatedNotify } from '../lib/licenseAdminNotification.js';
import { log } from '../lib/logger.js';

const ACTIVE = 'ativa';
const EXPIRED = 'expirada';

function addDurationByPlanFrom(planoRaw: string | null | undefined, base: Date): Date {
  const plano = String(planoRaw || 'mensal').toLowerCase().trim();
  const d = new Date(base);
  const toleranceDays = 3;
  if (plano === 'teste' || plano === 'desafio') {
    d.setDate(d.getDate() + 7 + toleranceDays);
    return d;
  }
  if (plano === 'semestral') {
    d.setDate(d.getDate() + 180 + toleranceDays);
    return d;
  }
  if (plano === 'anual') {
    d.setDate(d.getDate() + 365 + toleranceDays);
    return d;
  }
  if (plano === 'vitalicio') {
    d.setDate(d.getDate() + 18250 + toleranceDays);
    return d;
  }
  d.setDate(d.getDate() + 30 + toleranceDays); // mensal/default
  return d;
}

function isEmailValid(email: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

type ProductRow = {
  id: number;
  systemId: string | null;
  offerCode: string | null;
  plano: string | null;
  productName: string | null;
};

type DenyResult = { status: number; json: { status: string; message: string } };

function denyAccountNotConfigured(): DenyResult {
  return {
    status: 403,
    json: {
      status: 'error',
      message:
        'Informe o número da conta MetaTrader no painel de validação antes de usar o robô.',
    },
  };
}

function denyAccountMismatch(): DenyResult {
  return {
    status: 403,
    json: {
      status: 'error',
      message: 'A conta MetaTrader não confere com a cadastrada no painel para este produto.',
    },
  };
}

function logLicenseFailure(
  email: string,
  numero_conta: string,
  system_id: string,
  status: number,
  json: { message?: string }
): void {
  if (status === 200) return;
  log(
    'WARN',
    `License validation: email=${email}, account=${numero_conta}, system=${system_id}, http=${status}, message=${json.message || '—'}`
  );
}

/** Verificação estrita: system_id + conta do painel — aplicada em toda validação. */
function assertStrictLicenseAccess(
  license: Pick<License, 'systemId' | 'offerCode' | 'plano' | 'numeroConta'>,
  products: ProductRow[],
  system_id: string,
  numero_conta: string
): DenyResult | null {
  if (!filterLicensesForValidation([license], products, system_id).length) {
    return {
      status: 403,
      json: { status: 'error', message: 'Licença inválida ou inativa.' },
    };
  }

  const panelAccount = String(license.numeroConta || '').trim();
  if (!panelAccount) return denyAccountNotConfigured();
  if (panelAccount !== numero_conta) return denyAccountMismatch();
  return null;
}

function resolveLicenseDenial(
  forSystem: License[],
  numero_conta: string
): DenyResult | null {
  if (!forSystem.length) return null;

  const withMatchingAccount = forSystem.filter(
    (l) => String(l.numeroConta || '').trim() === numero_conta
  );
  if (withMatchingAccount.length > 1) {
    return {
      status: 400,
      json: {
        status: 'error',
        message:
          'Você tem mais de uma licença ativa para este produto. Vincule cada licença manualmente no painel.',
      },
    };
  }
  if (withMatchingAccount.length === 1) return null;

  if (forSystem.some((l) => !String(l.numeroConta || '').trim())) {
    return denyAccountNotConfigured();
  }
  return denyAccountMismatch();
}

export async function validateLicenseHandler(
  prisma: PrismaClient,
  body: { email?: string; numero_conta?: string; system_id?: string; license_id?: number | string }
) {
  const email = (body.email || '').trim().toLowerCase();
  const numero_conta = String(body.numero_conta || '').trim();
  const system_id = String(body.system_id || '').trim();
  const licenseIdRaw = body.license_id;
  const licenseId =
    licenseIdRaw != null && String(licenseIdRaw).trim() !== ''
      ? parseInt(String(licenseIdRaw), 10)
      : NaN;

  if (!isEmailValid(email)) {
    const json = { status: 'error', message: 'Email format invalid.' };
    logLicenseFailure(email, numero_conta, system_id, 400, json);
    return { status: 400, json };
  }
  if (!numero_conta || numero_conta.length < 3) {
    const json = { status: 'error', message: 'Account number must have at least 3 characters.' };
    logLicenseFailure(email, numero_conta, system_id, 400, json);
    return { status: 400, json };
  }
  if (!system_id) {
    const json = { status: 'error', message: 'system_id is required.' };
    logLicenseFailure(email, numero_conta, system_id, 400, json);
    return { status: 400, json };
  }

  const cacheKey = `license_validation_${email}_${numero_conta}_${system_id}`;
  const hit = cacheGet(cacheKey);
  if (hit) {
    return { status: hit.status, json: hit.body };
  }

  const products = await prisma.product.findMany({
    select: { id: true, systemId: true, offerCode: true, plano: true, productName: true },
  });

  const allForEmail = await prisma.license.findMany({
    where: { email },
    orderBy: { id: 'desc' },
  });

  let license: License | null = null;

  if (Number.isFinite(licenseId)) {
    const byId = allForEmail.find((l) => l.id === licenseId) ?? null;
    if (byId) {
      const denial = assertStrictLicenseAccess(byId, products, system_id, numero_conta);
      if (denial) {
        cacheSet(cacheKey, denial.status, denial.json);
        logLicenseFailure(email, numero_conta, system_id, denial.status, denial.json);
        return denial;
      }
      license = byId;
    }
  }

  if (!license) {
    const forSystem = filterLicensesForValidation(allForEmail, products, system_id);
    const withAccount = forSystem.filter(
      (l) => String(l.numeroConta || '').trim() === numero_conta
    );

    if (withAccount.length === 1) {
      license = withAccount[0] as License;
    } else if (withAccount.length > 1) {
      const result = {
        status: 400,
        json: {
          status: 'error',
          message:
            'Você tem mais de uma licença ativa para este produto. Vincule cada licença manualmente no painel.',
        },
      };
      cacheSet(cacheKey, result.status, result.json);
      logLicenseFailure(email, numero_conta, system_id, result.status, result.json);
      return result;
    } else {
      const denial = resolveLicenseDenial(forSystem as License[], numero_conta);
      if (denial) {
        cacheSet(cacheKey, denial.status, denial.json);
        logLicenseFailure(email, numero_conta, system_id, denial.status, denial.json);
        return denial;
      }
    }
  }

  if (license) {
    const denial = assertStrictLicenseAccess(license, products, system_id, numero_conta);
    if (denial) {
      cacheSet(cacheKey, denial.status, denial.json);
      logLicenseFailure(email, numero_conta, system_id, denial.status, denial.json);
      return denial;
    }
  }

  let result: { status: number; json: object };
  if (license && (license.statusLicenca === ACTIVE || license.statusLicenca === EXPIRED)) {
    if (license.statusLicenca === EXPIRED) {
      result = { status: 403, json: { status: 'error', message: 'Licença expirada.' } };
    } else {
      const now = new Date();
      // Início da contagem: só começa no primeiro "bind" do EA (validação com sucesso).
      // Compra pode ter acontecido antes, mas o prazo não corre até a primeira ativação real.
      if (!license.dataAtivacao || !license.dataExpiracao) {
        const startedAt = now;
        const expiresAt = addDurationByPlanFrom(license.plano, startedAt);
        const previousDataExpiracao = license.dataExpiracao;
        license = await prisma.license.update({
          where: { id: license.id },
          data: { dataAtivacao: startedAt, dataExpiracao: expiresAt },
        });
        fireLicenseExpiryUpdatedNotify(prisma, license, previousDataExpiracao, 'ea_validation');
        invalidateLicenseCacheForEmail(email);
      }
      if (license.dataExpiracao && license.dataExpiracao < now) {
        await prisma.license.update({ where: { id: license.id }, data: { statusLicenca: EXPIRED } });
        invalidateLicenseCacheForEmail(email);
        result = { status: 403, json: { status: 'error', message: 'Licença expirada.' } };
      } else {
        result = {
          status: 200,
          json: {
            status: 'success',
            message: 'Licença válida.',
            data_expiracao: license.dataExpiracao?.toISOString() ?? null,
          },
        };
      }
    }
  } else {
    result = { status: 403, json: { status: 'error', message: 'Licença inválida ou inativa.' } };
  }

  cacheSet(cacheKey, result.status, result.json as object);
  logLicenseFailure(email, numero_conta, system_id, result.status, result.json as { message?: string });
  return result;
}

export async function grantContentAccessForSystem(prisma: PrismaClient, email: string, systemId: string) {
  if (!systemId) return;
  const user = await prisma.user.findUnique({ where: { email: email.toLowerCase().trim() } });
  if (!user) return;
  const contents = await prisma.content.findMany({ where: { licenseSystemId: systemId } });
  for (const c of contents) {
    try {
      await prisma.purchase.create({ data: { userId: user.id, contentId: c.id } });
    } catch {
      /* unique */
    }
    const bonuses = await prisma.content.findMany({ where: { isBonus: true, parentContentId: c.id } });
    if (bonuses.length) {
      await prisma.purchase.createMany({
        data: bonuses.map((b) => ({ userId: user.id, contentId: b.id })),
        skipDuplicates: true,
      });
    }
  }
}

export async function revokeContentAccessForSystem(prisma: PrismaClient, email: string, systemId: string) {
  if (!systemId) return;
  const user = await prisma.user.findUnique({ where: { email: email.toLowerCase().trim() } });
  if (!user) return;
  const contents = await prisma.content.findMany({
    where: { licenseSystemId: systemId },
    select: { id: true },
  });
  const ids = [...contents.map((c) => c.id)];
  for (const c of contents) {
    const bonuses = await prisma.content.findMany({ where: { parentContentId: c.id }, select: { id: true } });
    ids.push(...bonuses.map((b) => b.id));
  }
  if (ids.length) {
    await prisma.purchase.deleteMany({ where: { userId: user.id, contentId: { in: ids } } });
  }
}
