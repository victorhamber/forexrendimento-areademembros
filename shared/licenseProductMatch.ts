import { csvIncludes, parseCsv } from './csv.js';

export type PlanKind = 'anual' | 'vitalicio' | 'desafio' | 'outro';

export type LicenseLite = {
  systemId?: string | null;
  offerCode?: string | null;
  plano?: string | null;
  numeroConta?: string | null;
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
 * IDs equivalentes do EA Trend (robô envia qualquer um em PRODUCT_SYSTEM_IDS).
 * Licença/produto com 5162473 vale também para pedidos com 516247 ou test (sandbox).
 */
const SYSTEM_ID_ALIAS_GROUPS: string[][] = [['516247', '5162473', 'test']];

export function equivalentSystemIds(systemId: string): string[] {
  const sid = String(systemId || '').trim();
  if (!sid) return [];
  for (const group of SYSTEM_ID_ALIAS_GROUPS) {
    if (group.includes(sid)) return [...group];
  }
  return [sid];
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

function licenseSharesSystemWithProduct(lic: LicenseLite, product: ProductLite): boolean {
  const licIds = parseCsv(String(lic.systemId || ''));
  const prodIds = parseCsv(String(product.systemId || ''));
  if (!licIds.length || !prodIds.length) return false;
  for (const id of licIds) {
    const group = equivalentSystemIds(id);
    if (prodIds.some((pid) => group.includes(pid))) return true;
  }
  return false;
}

/** Licença tem algum systemId (ou alias) presente no grupo pedido pelo EA. */
export function licenseMatchesSystemGroup(lic: LicenseLite, group: string[]): boolean {
  const licIds = parseCsv(String(lic.systemId || ''));
  if (!licIds.length) return false;
  for (const id of licIds) {
    const idGroup = equivalentSystemIds(id);
    if (idGroup.some((x) => group.includes(x))) return true;
  }
  return false;
}

/** Licença pertence ao produto via código da oferta (prioridade) ou plano (+ systemId quando houver). */
export function licenseMatchesProduct(lic: LicenseLite, product: ProductLite): boolean {
  const offer = String(lic.offerCode || '').trim();
  if (offer) {
    return csvIncludes(String(product.offerCode || ''), offer);
  }
  const licPlan = norm(lic.plano);
  const prodPlan = norm(product.plano);
  if (!licPlan || !prodPlan || licPlan !== prodPlan) return false;
  const licIds = parseCsv(String(lic.systemId || ''));
  if (!licIds.length) return true;
  return licenseSharesSystemWithProduct(lic, product);
}

/**
 * Licenças elegíveis na validação do EA.
 * Com systemId na licença: só entra se intersectar o pedido (ex.: 516247 ↔ 5162473).
 * Sem systemId (legado): casa por oferta/plano nos produtos do system_id pedido.
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

  return licenses.filter((lic) => {
    const licIds = parseCsv(String(lic.systemId || ''));

    if (licIds.length > 0) {
      return licenseMatchesSystemGroup(lic, group);
    }

    if (!systemProducts.length) return false;

    return systemProducts.some((p) => licenseMatchesProduct(lic, p));
  });
}

function preferLicenseCandidate<T extends LicenseLite & { id?: number; numeroConta?: string | null }>(
  next: T,
  prev: T
): T {
  const nextAccount = String(next.numeroConta || '').trim();
  const prevAccount = String(prev.numeroConta || '').trim();
  if (nextAccount && !prevAccount) return next;
  if (prevAccount && !nextAccount) return prev;
  return (next.id ?? 0) > (prev.id ?? 0) ? next : prev;
}

/** Sufixos do webhook legado (1 transação → N licenças). Não usar \\d+ genérico — evita colapsar compras distintas. */
const LEGACY_EVENT_ID_SUFFIXES = ['5162473', '516247', 'test'];

function legacyEventIdSuffix(eventId: string): string | null {
  for (const suffix of LEGACY_EVENT_ID_SUFFIXES) {
    if (eventId.endsWith(`_${suffix}`)) return suffix;
  }
  return null;
}

/** Webhook antigo gerava eventId com sufixo _systemId na mesma transação Hotmart. */
export function rootPurchaseEventId(eventId: string | null | undefined): string {
  const e = String(eventId || '').trim();
  if (!e) return '';
  const suffix = legacyEventIdSuffix(e);
  if (!suffix) return e;
  const root = e.slice(0, -(suffix.length + 1));
  return root || e;
}

/**
 * Só agrupa licenças da MESMA compra (bug legado: 1 transação → N licenças por system_id).
 * Compras diferentes do mesmo produto permanecem separadas.
 */
export function collapseLegacySplitLicensesFromSamePurchase<
  T extends LicenseLite & { id?: number; eventId?: string | null },
>(licenses: T[]): T[] {
  const groups = new Map<string, T[]>();
  for (const lic of licenses) {
    const root = rootPurchaseEventId(lic.eventId);
    const key = root || `id:${lic.id ?? 0}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key)!.push(lic);
  }

  const out: T[] = [];
  for (const group of groups.values()) {
    if (group.length === 1) {
      out.push(group[0]);
      continue;
    }
    const distinctAccounts = new Set(
      group.map((l) => String(l.numeroConta || '').trim()).filter(Boolean)
    );
    if (distinctAccounts.size > 1) {
      out.push(...group);
      continue;
    }

    const distinctSystemKeys = new Set(
      group
        .map((l) =>
          parseCsv(String(l.systemId || ''))
            .sort()
            .join('|')
        )
        .filter(Boolean)
    );
    if (distinctSystemKeys.size > 1) {
      out.push(...group);
      continue;
    }

    const root = rootPurchaseEventId(group[0].eventId);
    const hasLegacySplit = group.some((l) => {
      const eid = String(l.eventId || '').trim();
      return !!legacyEventIdSuffix(eid) && eid !== root;
    });
    if (!hasLegacySplit) {
      out.push(...group);
      continue;
    }
    out.push(group.reduce((best, lic) => preferLicenseCandidate(lic, best)));
  }
  return out;
}

/** Só retorna licença já vinculada à conta informada no painel (sem auto-vínculo). */
export function pickLicenseFromCandidates<T extends LicenseLite & { numeroConta?: string | null }>(
  candidates: T[],
  numeroConta: string
): T | null {
  const resolved = resolveLicenseForValidation(candidates, numeroConta);
  return resolved.kind === 'picked' ? resolved.license : null;
}

/**
 * Escolhe licença para validação do EA: conta MT5 primeiro, colapso legado só entre duplicatas da mesma conta.
 */
export function resolveLicenseForValidation<
  T extends LicenseLite & { id?: number; numeroConta?: string | null; eventId?: string | null },
>(eligible: T[], numeroConta: string): { kind: 'picked'; license: T } | { kind: 'ambiguous' } | { kind: 'not_found' } {
  const account = String(numeroConta || '').trim();
  if (!account || !eligible.length) return { kind: 'not_found' };

  let forAccount = eligible.filter((l) => String(l.numeroConta || '').trim() === account);
  if (!forAccount.length) return { kind: 'not_found' };
  if (forAccount.length === 1) return { kind: 'picked', license: forAccount[0] };

  const collapsed = collapseLegacySplitLicensesFromSamePurchase(forAccount);
  forAccount = collapsed.filter((l) => String(l.numeroConta || '').trim() === account);
  if (forAccount.length === 1) return { kind: 'picked', license: forAccount[0] };
  if (forAccount.length > 1) return { kind: 'ambiguous' };
  return { kind: 'not_found' };
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
