import { csvIncludes, parseCsv } from './csv.js';

export type PlanKind = 'anual' | 'vitalicio' | 'desafio' | 'outro';

export type LicenseLite = {
  systemId?: string | null;
  offerCode?: string | null;
  plano?: string | null;
};

export type ProductLite = {
  id: number;
  systemId?: string | null;
  offerCode?: string | null;
  plano?: string | null;
  productName?: string | null;
};

function norm(v: unknown): string {
  return String(v || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .trim();
}

/** Plano da licença → tipo de produto (fallback legado, sem offerCode). */
export function classifyLicensePlan(plano: string | null | undefined): PlanKind {
  const p = norm(plano);
  if (!p) return 'outro';
  if (p.includes('vital')) return 'vitalicio';
  if (p.includes('anual')) return 'anual';
  if (p.includes('teste') || p.includes('desafio')) return 'desafio';
  return 'outro';
}

/** Resolve produto pelo código da oferta Hotmart (match exato na lista CSV, sem contains). */
export function findProductByOfferCodeInList<T extends ProductLite>(
  products: T[],
  offerCode: string | null | undefined
): T | null {
  const code = String(offerCode || '').trim();
  if (!code) return null;

  const matches = products.filter((p) => csvIncludes(String(p.offerCode || ''), code));
  if (matches.length === 0) return null;
  if (matches.length === 1) return matches[0];

  const exactField = matches.find((p) => String(p.offerCode || '').trim() === code);
  if (exactField) return exactField as T;

  const narrowed = narrowCandidates(matches, { offerCode: code });
  return narrowed.length === 1 ? (narrowed[0] as T) : null;
}

function productMatchesKind(product: ProductLite, kind: PlanKind): boolean {
  if (kind === 'outro') return false;
  const name = norm(product.productName);
  const plan = norm(product.plano);
  if (kind === 'anual') return name.includes('anual') || plan.includes('anual');
  if (kind === 'vitalicio') return name.includes('vitalicio') || plan.includes('vitalicio');
  if (kind === 'desafio') {
    return (
      name.includes('desafio') ||
      name.includes('teste') ||
      plan.includes('desafio') ||
      plan.includes('teste')
    );
  }
  return false;
}

function narrowCandidates(candidates: ProductLite[], lic: LicenseLite): ProductLite[] {
  if (candidates.length <= 1) return candidates;

  // Código da oferta é o que diferencia planos quando todos compartilham o mesmo systemId.
  const offer = String(lic.offerCode || '').trim();
  if (offer) {
    const byOffer = candidates.filter((p) => csvIncludes(String(p.offerCode || ''), offer));
    if (byOffer.length === 1) return byOffer;
    if (byOffer.length > 1) candidates = byOffer;
  }

  const plan = norm(lic.plano);
  if (plan) {
    const byPlanField = candidates.filter((p) => norm(p.plano) === plan);
    if (byPlanField.length === 1) return byPlanField;
    if (byPlanField.length) candidates = byPlanField;
  }

  return candidates;
}

function productsBySystem(products: ProductLite[], systemId: string): ProductLite[] {
  if (!systemId) return [];
  return products.filter((p) => csvIncludes(String(p.systemId || ''), systemId));
}

/**
 * IDs equivalentes do mesmo produto (EA legado vs catálogo atual).
 * Se o EA enviar qualquer ID do grupo, a mesma licença/produto é aceito.
 */
const SYSTEM_ID_ALIAS_GROUPS: string[][] = [['516247', '5162473']];

export function equivalentSystemIds(systemId: string): string[] {
  const sid = String(systemId || '').trim();
  if (!sid) return [];
  for (const group of SYSTEM_ID_ALIAS_GROUPS) {
    if (group.includes(sid)) return [...group];
  }
  return [sid];
}

/** systemId da licença pode ser um único id ou CSV (como no cadastro do admin). */
function licenseSystemIdsMatchGroup(lic: LicenseLite, group: string[]): boolean {
  const licIds = parseCsv(String(lic.systemId || ''));
  if (!licIds.length) return true;
  return licIds.some((id) => group.includes(id));
}

function productsForSystemIdGroup<T extends ProductLite>(products: T[], systemId: string): T[] {
  const seen = new Set<number>();
  const out: T[] = [];
  for (const id of equivalentSystemIds(systemId)) {
    for (const p of productsBySystem(products, id)) {
      if (!seen.has(p.id)) {
        seen.add(p.id);
        out.push(p as T);
      }
    }
  }
  return out;
}

/** Produtos do catálogo cujo CSV de systemId inclui o id enviado pelo EA. */
export function productsForSystemId<T extends ProductLite>(products: T[], systemId: string): T[] {
  return productsForSystemIdGroup(products, String(systemId || '').trim()) as T[];
}

/** Licença pertence ao produto via código da oferta (prioridade) ou plano cadastrado. */
export function licenseMatchesProduct(lic: LicenseLite, product: ProductLite): boolean {
  const offer = String(lic.offerCode || '').trim();
  if (offer) {
    return csvIncludes(String(product.offerCode || ''), offer);
  }
  const licPlan = norm(lic.plano);
  const prodPlan = norm(product.plano);
  return !!(licPlan && prodPlan && licPlan === prodPlan);
}

/**
 * Licenças elegíveis na validação do EA.
 * Aceita o system_id solicitado e IDs equivalentes (ex.: 516247 ↔ 5162473).
 */
export function filterLicensesForValidation<T extends LicenseLite>(
  licenses: T[],
  products: ProductLite[],
  systemId: string
): T[] {
  const sid = String(systemId || '').trim();
  if (!sid) return [];

  const group = equivalentSystemIds(sid);
  const systemProducts = productsForSystemIdGroup(products, sid);

  if (!systemProducts.length) {
    return licenses.filter((lic) => licenseSystemIdsMatchGroup(lic, group));
  }

  return licenses.filter((lic) => {
    if (!licenseSystemIdsMatchGroup(lic, group)) return false;
    return systemProducts.some((p) => licenseMatchesProduct(lic, p));
  });
}

/** Só retorna licença já vinculada à conta informada no painel (sem auto-vínculo). */
export function pickLicenseFromCandidates<T extends LicenseLite & { numeroConta?: string | null }>(
  candidates: T[],
  numeroConta: string
): T | null {
  const account = String(numeroConta || '').trim();
  if (!account || candidates.length === 0) return null;

  const matched = candidates.filter((c) => String(c.numeroConta || '').trim() === account);
  if (matched.length === 1) return matched[0];
  return null;
}

export function pickProductsForLicense(products: ProductLite[], lic: LicenseLite): ProductLite[] {
  const offer = String(lic.offerCode || '').trim();

  // 1) Código da oferta Hotmart é a fonte da verdade para produto + plano
  if (offer) {
    const byOffer = products.filter((p) => csvIncludes(String(p.offerCode || ''), offer));
    if (byOffer.length === 1) return byOffer;
    if (byOffer.length > 1) {
      const narrowed = narrowCandidates(byOffer, lic);
      return narrowed.length === 1 ? narrowed : [];
    }
  }

  // 2) Legado sem offerCode: diferenciar pelo plano (systemId é igual em todos os produtos)
  const sid = String(lic.systemId || '').trim();
  if (sid && !offer) {
    const plan = norm(lic.plano);
    if (plan) {
      const byPlan = products.filter((p) => norm(p.plano) === plan);
      if (byPlan.length === 1) return byPlan;
      if (byPlan.length > 1) {
        const narrowed = narrowCandidates(byPlan, lic);
        return narrowed.length === 1 ? narrowed : [];
      }
    }
  }

  // 3) Sem offerCode: inferir pelo plano (legado)
  if (!offer) {
    const kind = classifyLicensePlan(lic.plano);
    if (kind !== 'outro') {
      const byKind = products.filter((p) => productMatchesKind(p, kind));
      if (byKind.length) {
        const narrowed = narrowCandidates(byKind, lic);
        return narrowed.length === 1 ? narrowed : [];
      }
    }
  }

  return [];
}

export function resolveOwnedProductIds(
  licenses: LicenseLite[],
  products: ProductLite[]
): Set<number> {
  const owned = new Set<number>();
  for (const lic of licenses) {
    for (const p of pickProductsForLicense(products, lic)) owned.add(p.id);
  }
  return owned;
}

export function resolveProductForLicense<T extends ProductLite>(
  products: T[],
  lic: LicenseLite
): T | null {
  const matched = pickProductsForLicense(products, lic);
  if (!matched.length) return null;
  return matched[0] as T;
}

export function resolveOwnedSystemIds(licenses: LicenseLite[]): string[] {
  return [...new Set(licenses.map((l) => String(l.systemId || '').trim()).filter(Boolean))];
}

export function hasOfferCode(raw: string | null | undefined): boolean {
  return parseCsv(raw).length > 0;
}
