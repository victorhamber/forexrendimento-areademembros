import { parseCsv } from './csv.js';
import {
  equivalentSystemIds,
  type LicenseLite,
  type ProductLite,
  pickProductsForLicense,
  productsForSystemId,
} from './licenseProductMatch.js';

function norm(v: unknown): string {
  return String(v || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .trim();
}

export function isDesafioPlan(plano: string | null | undefined): boolean {
  const p = norm(plano);
  return p.includes('teste') || p.includes('desafio');
}

export function isPaidUpgradePlan(plano: string | null | undefined): boolean {
  const p = norm(plano);
  return p.includes('anual') || p.includes('vitalicio');
}

function systemIdsForLicense(lic: LicenseLite): string[] {
  return parseCsv(String(lic.systemId || ''));
}

function systemIdsForProduct(product: ProductLite): string[] {
  return parseCsv(String(product.systemId || ''));
}

/** Mesma família de produto EA (compartilham system_id no catálogo). */
export function licensesShareProductFamily(
  a: LicenseLite,
  b: LicenseLite,
  products: ProductLite[]
): boolean {
  const prodsA = pickProductsForLicense(products, a);
  const prodsB = pickProductsForLicense(products, b);
  if (prodsA.length && prodsB.length) {
    const idsB = new Set(prodsB.map((p) => p.id));
    if (prodsA.some((p) => idsB.has(p.id))) return true;
  }

  const idsA = systemIdsForLicense(a);
  const idsB = systemIdsForLicense(b);
  for (const id of idsA) {
    const group = equivalentSystemIds(id);
    if (idsB.some((bid) => group.includes(bid))) return true;
  }
  return false;
}

export function licenseInProductFamily(
  lic: LicenseLite,
  product: ProductLite,
  products: ProductLite[]
): boolean {
  const familyIds = productFamilyProductIds(product, products);
  const licProducts = pickProductsForLicense(products, lic);
  if (licProducts.some((p) => familyIds.has(p.id))) return true;

  const productIds = systemIdsForProduct(product);
  const licIds = systemIdsForLicense(lic);
  for (const id of productIds) {
    const group = equivalentSystemIds(id);
    if (licIds.some((lid) => group.includes(lid))) return true;
  }
  return false;
}

export function productFamilyProductIds(
  product: ProductLite,
  products: ProductLite[]
): Set<number> {
  const ids = new Set<number>();
  const firstSid = systemIdsForProduct(product)[0];
  if (firstSid) {
    for (const p of productsForSystemId(products, firstSid)) {
      ids.add(p.id);
    }
  }
  if (product.id) ids.add(product.id);
  return ids;
}

export function findDesafioLicenseForUpgrade<
  T extends LicenseLite & { id?: number; plano?: string | null },
>(licenses: T[], product: ProductLite, products: ProductLite[]): T | null {
  if (!isPaidUpgradePlan(product.plano)) return null;

  let desafioCandidate: T | null = null;
  let hasPaidInFamily = false;

  for (const lic of licenses) {
    if (!licenseInProductFamily(lic, product, products)) continue;
    if (isDesafioPlan(lic.plano)) {
      if (!desafioCandidate) desafioCandidate = lic;
    } else if (isPaidUpgradePlan(lic.plano)) {
      hasPaidInFamily = true;
    }
  }

  if (desafioCandidate && !hasPaidInFamily) return desafioCandidate;
  return null;
}

/**
 * Datas ao substituir Desafio/teste por plano pago: cliente já opera — não aguardar 1ª validação do EA.
 * Expiração do novo plano conta a partir do upgrade/compra (now).
 */
export function datesForDesafioPlanUpgrade(
  existing: { dataAtivacao?: Date | null },
  newPlano: string,
  now: Date,
  addDurationFrom: (plano: string, base: Date) => Date
): { dataAtivacao: Date; dataExpiracao: Date } {
  const dataAtivacao = existing.dataAtivacao ?? now;
  const dataExpiracao = addDurationFrom(newPlano, now);
  return { dataAtivacao, dataExpiracao };
}

/** Conta MT5 já usada em outro desafio do mesmo produto EA (qualquer e-mail). */
export function findDesafioAccountConflict<
  T extends LicenseLite & { id?: number; email?: string; plano?: string | null },
>(
  targetLicense: T,
  numeroConta: string,
  allLicenses: T[],
  products: ProductLite[],
  excludeLicenseId?: number
): T | null {
  const account = String(numeroConta || '').trim();
  if (!account || !isDesafioPlan(targetLicense.plano)) return null;

  for (const other of allLicenses) {
    if (excludeLicenseId != null && other.id === excludeLicenseId) continue;
    if (String(other.numeroConta || '').trim() !== account) continue;
    if (!isDesafioPlan(other.plano)) continue;
    if (!licensesShareProductFamily(targetLicense, other, products)) continue;
    if (targetLicense.id != null && other.id === targetLicense.id) continue;
    return other;
  }
  return null;
}

export const DESAFIO_ACCOUNT_REUSE_MESSAGE =
  'Este número de conta já utilizou o período de teste (Desafio) para este produto. Use outra conta MetaTrader ou adquira uma licença Anual ou Vitalícia.';
