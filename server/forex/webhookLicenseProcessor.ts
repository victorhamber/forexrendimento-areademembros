import type { PrismaClient } from '@prisma/client';
import { log } from '../lib/logger.js';
import { invalidateLicenseCacheForEmail } from '../lib/licenseValidationCache.js';
import { grantContentAccessForSystem, revokeContentAccessForSystem } from './licenseService.js';
import { postRobotJson } from './robotNotify.js';
import { parseCsv } from '../lib/csv.js';
import { findProductByOfferCodeInList } from '../lib/licenseProductMatch.js';
import { sendWelcomeEmail } from '../lib/welcomeEmail.js';
import {
  fireLicenseCreatedNotify,
  fireLicenseExpiryUpdatedNotify,
} from '../lib/licenseAdminNotification.js';
import { isPrismaUniqueViolation } from '../lib/prismaErrors.js';

async function findProductByOfferCode(prisma: PrismaClient, offerCode: string) {
  const code = String(offerCode || '').trim();
  if (!code) return null;
  const products = await prisma.product.findMany();
  return findProductByOfferCodeInList(products, code);
}

function addDurationFrom(plano: string, base: Date): Date {
  const d = new Date(base);
  const p = String(plano || 'mensal').toLowerCase().trim();
  const toleranceDays = 3;
  if (p === 'teste' || p === 'desafio') {
    d.setDate(d.getDate() + 7 + toleranceDays);
    return d;
  }
  if (p === 'semestral') {
    d.setDate(d.getDate() + 180 + toleranceDays);
    return d;
  }
  if (p === 'anual') {
    d.setDate(d.getDate() + 365 + toleranceDays);
    return d;
  }
  if (p === 'vitalicio') {
    d.setDate(d.getDate() + 18250 + toleranceDays);
    return d;
  }
  d.setDate(d.getDate() + 30 + toleranceDays); // mensal/default
  return d;
}

function extractSubscriberCode(data: Record<string, unknown>): string {
  const d = data.data as Record<string, unknown> | undefined;
  const sub = d?.subscription as Record<string, unknown> | undefined;
  const sub2 = sub?.subscriber as Record<string, unknown> | undefined;
  const fromNested =
    (sub2?.code as string) ||
    ((d?.subscriber as Record<string, unknown> | undefined)?.code as string) ||
    ((data.subscription as Record<string, unknown> | undefined)?.subscriber as Record<string, unknown> | undefined)?.code;
  return String(fromNested || '').trim();
}

/** Número da recorrência Hotmart (1 = primeira cobrança, >1 = renovação). */
function extractRecurrencyNumber(data: Record<string, unknown>): number {
  const d = data.data as Record<string, unknown> | undefined;
  const purchase = (d?.purchase || {}) as Record<string, unknown>;
  const subscription = (d?.subscription || {}) as Record<string, unknown>;
  const raw =
    purchase.recurrency_number ??
    purchase.recurrence_number ??
    subscription.recurrency_number ??
    subscription.recurrence_number;
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? n : 0;
}

const PURCHASE_EVENTS = ['PURCHASE_APPROVED', 'PURCHASE_COMPLETE'] as const;
const RENEWAL_EVENTS = [
  'SUBSCRIPTION_RENEWAL',
  'SUBSCRIPTION_RENEWAL_DATE_UPDATE',
  'UPDATE_SUBSCRIPTION_CHARGE_DATE',
] as const;

function isSubscriptionRenewal(data: Record<string, unknown>, event: string): boolean {
  if ((RENEWAL_EVENTS as readonly string[]).includes(event)) return true;
  if (!(PURCHASE_EVENTS as readonly string[]).includes(event)) return false;
  return extractRecurrencyNumber(data) > 1;
}

export async function processLicenseWebhook(prisma: PrismaClient, data: Record<string, unknown>) {
  const event = String(data.event || '').trim();
  if (!event) return { ok: false, status: 400, message: 'Evento não encontrado no webhook' };

  const deactivate = [
    'PURCHASE_PROTEST',
    'SUBSCRIPTION_CANCELLATION',
    'PURCHASE_DELAYED',
    'PURCHASE_REFUNDED',
    'PURCHASE_CHARGEBACK',
    'PURCHASE_CANCELED'
  ];

  if ((PURCHASE_EVENTS as readonly string[]).includes(event)) {
    const mode = isSubscriptionRenewal(data, event) ? 'renew' : 'create';
    return activateLicense(prisma, data, mode);
  }
  if ((RENEWAL_EVENTS as readonly string[]).includes(event)) {
    return activateLicense(prisma, data, 'renew');
  }
  if (deactivate.includes(event)) return deactivateLicense(prisma, data);
  log('INFO', `Webhook evento não tratado: ${event}`);
  return { ok: true, status: 200, message: 'Event ignored' };
}

async function ensureUser(prisma: PrismaClient, email: string, buyerName: string, country?: string | null) {
  const em = email.toLowerCase().trim();
  let user = await prisma.user.findUnique({ where: { email: em } });
  let isNewUser = false;
  if (!user) {
    const { hashMemberPassword } = await import('../lib/verifyUserPassword.js');
    const DEFAULT_PASSWORD = 'Mudar123@';
    try {
      user = await prisma.user.create({
        data: { email: em, name: buyerName || null, password: hashMemberPassword(DEFAULT_PASSWORD), country: country || null }
      });
      isNewUser = true;
    } catch (err) {
      if (isPrismaUniqueViolation(err, 'email')) {
        user = await prisma.user.findUnique({ where: { email: em } });
        if (!user) throw err;
      } else {
        throw err;
      }
    }
  } else {
    const updates: Record<string, string> = {};
    if (buyerName && !user.name) updates.name = buyerName;
    if (country && !user.country) updates.country = country;
    if (Object.keys(updates).length > 0) {
      user = await prisma.user.update({ where: { id: user.id }, data: updates });
    }
  }
  return { user, isNewUser };
}

async function activateLicense(
  prisma: PrismaClient,
  data: Record<string, unknown>,
  mode: 'create' | 'renew'
) {
  const d = data.data as Record<string, unknown> | undefined;
  const buyer = (d?.buyer || {}) as Record<string, unknown>;
  const purchase = (d?.purchase || {}) as Record<string, unknown>;
  const offer = (purchase.offer || {}) as Record<string, unknown>;
  const productObj = (d?.product || {}) as Record<string, unknown>;

  const email = String(buyer.email || '').trim().toLowerCase();
  const buyer_name = String(buyer.name || buyer.first_name || '').trim();
  const buyer_country = String(purchase.checkout_country?.toString() || (buyer.address as any)?.country || '').trim() || null;
  let event_id = String(purchase.transaction || '').trim();
  if (!event_id) event_id = `evt_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
  const offer_code = String(offer.code || productObj.offer_code || '').trim();
  const product_id = String(productObj.id || productObj.ucode || '').trim();
  const subscriber_code = extractSubscriberCode(data);

  if (!email) return { ok: false, status: 400, message: 'Missing buyer email' };

  const { user, isNewUser } = await ensureUser(prisma, email, buyer_name, buyer_country);
  let welcomeEmailNote = '';
  if (isNewUser) {
    log('INFO', `Novo usuário criado via webhook: ${email} (senha padrão: Mudar123@)`);
    try {
      const mail = await sendWelcomeEmail(prisma, email, buyer_name || null, 'Mudar123@', buyer_country);
      if (mail.ok) {
        welcomeEmailNote = ` Boas-vindas enviada para ${mail.to}.`;
        log('INFO', `E-mail de boas-vindas enviado para ${mail.to} (Resend id: ${mail.messageId || 'n/a'})`);
      } else if (mail.skipped) {
        welcomeEmailNote = ' Boas-vindas não enviada (Resend não configurado).';
        log('WARN', `Boas-vindas não enviada para ${email}: ${mail.error}`);
      } else {
        welcomeEmailNote = ` Boas-vindas falhou: ${mail.error}`;
        log('ERROR', `Falha ao enviar boas-vindas para ${email}: ${mail.error}`);
      }
    } catch (err) {
      welcomeEmailNote = ` Boas-vindas falhou: ${err instanceof Error ? err.message : String(err)}`;
      log('ERROR', `Falha ao enviar e-mail de boas-vindas para ${email}: ${err}`);
    }
  } else {
    log('INFO', `Usuário já existia (${email}) — e-mail de boas-vindas não reenviado (evita duplicata).`);
  }

  let product =
    (offer_code ? await findProductByOfferCode(prisma, offer_code) : null) ||
    (product_id ? await findProductByOfferCode(prisma, product_id) : null);
  const resolvedOfferCode = offer_code || (product && product_id ? product_id : '');
  if ((offer_code || product_id) && !product) {
    log(
      'WARN',
      `Produto não encontrado para offer=${offer_code || '—'} product_id=${product_id || '—'} — licença EA não criada/atualizada. Cadastre o código em Produtos.`
    );
  }

  const systemIds = parseCsv(product?.systemId || '');
  const hasProduct = systemIds.length > 0;
  if (!systemIds.length) systemIds.push('');
  const plano = product?.plano || 'mensal';
  const now = new Date();

  // --- 1) Ativar licença(s) se houver Product cadastrado ---
  if (hasProduct) {
    for (const [idx, system_id] of systemIds.entries()) {
      const isFirst = idx === 0;
      const licenseEventId = isFirst ? event_id : `${event_id}_${system_id || idx}`;

      // Idempotência: mesmo webhook reenviado (mesma transação).
      let existing = await prisma.license.findUnique({ where: { eventId: licenseEventId } });
      if (!existing && isFirst) {
        existing = await prisma.license.findFirst({ where: { eventId: event_id } });
      }

      // Renovação/recorrência: estende licença da assinatura (subscriber_code + oferta/plano).
      if (!existing && mode === 'renew' && subscriber_code) {
        const renewWhere: { subscriberCode: string; email: string; offerCode?: string; plano?: string } = {
          subscriberCode: subscriber_code,
          email,
        };
        if (resolvedOfferCode) {
          renewWhere.offerCode = resolvedOfferCode;
        } else if (plano) {
          renewWhere.plano = plano;
        }
        existing = await prisma.license.findFirst({
          where: renewWhere,
          orderBy: { id: 'desc' },
        });
      }

      if (!existing && mode === 'renew') {
        log(
          'WARN',
          `Renovação sem licença encontrada ${email} subscriber=${subscriber_code || '—'} sys=${system_id || '—'} event=${event_id}`
        );
        continue;
      }

      const shouldStartNow = !!(existing?.dataAtivacao && existing?.dataExpiracao);
      const baseForExpiry =
        existing?.dataExpiracao && existing.dataExpiracao > now ? existing.dataExpiracao : now;
      const licensePayload = {
        email,
        buyerName: buyer_name || existing?.buyerName || null,
        plano,
        statusLicenca: 'ativa',
        dataExpiracao: shouldStartNow ? addDurationFrom(plano, baseForExpiry) : null,
        systemId: system_id || existing?.systemId || '',
        dataAtivacao: shouldStartNow ? (existing?.dataAtivacao as Date) : null,
        subscriberCode: subscriber_code || existing?.subscriberCode || null,
        offerCode: resolvedOfferCode || existing?.offerCode || null
      };

      if (existing) {
        const previousDataExpiracao = existing.dataExpiracao;
        const update: typeof licensePayload & { eventId?: string } = { ...licensePayload };
        // Renovação por assinatura mantém eventId original; compra nova atualiza para idempotência.
        const keepOriginalEventId = mode === 'renew' && !!existing.subscriberCode && !!subscriber_code;
        if (!keepOriginalEventId && existing.eventId !== licenseEventId) {
          const conflict = await prisma.license.findFirst({
            where: { eventId: licenseEventId, NOT: { id: existing.id } }
          });
          if (!conflict) update.eventId = licenseEventId;
        }
        const updated = await prisma.license.update({ where: { id: existing.id }, data: update });
        fireLicenseExpiryUpdatedNotify(prisma, updated, previousDataExpiracao, 'webhook');
        invalidateLicenseCacheForEmail(email);
        log(
          'INFO',
          `Licença ${existing.id} ${mode === 'renew' ? 'renovada' : 'reatualizada (idempotência)'} ${email} sys=${system_id} offer=${resolvedOfferCode} plano=${plano} produto=${product?.productName || '—'}`
        );
      } else {
        try {
          const created = await prisma.license.create({
            data: {
              ...licensePayload,
              numeroConta: '',
              eventId: licenseEventId
            }
          });
          fireLicenseCreatedNotify(prisma, created, 'webhook');
          log(
            'INFO',
            `Nova licença criada ${email} event=${licenseEventId} sys=${system_id} offer=${resolvedOfferCode} plano=${plano} produto=${product?.productName || '—'}`
          );
        } catch (err) {
          if (isPrismaUniqueViolation(err, 'eventId')) {
            const prev = await prisma.license.findUnique({ where: { eventId: licenseEventId } });
            const previousDataExpiracao = prev?.dataExpiracao;
            const updated = await prisma.license.update({
              where: { eventId: licenseEventId },
              data: licensePayload
            });
            if (prev) {
              fireLicenseExpiryUpdatedNotify(prisma, updated, previousDataExpiracao, 'webhook_retry');
            } else {
              fireLicenseCreatedNotify(prisma, updated, 'webhook_retry');
            }
            log('INFO', `Licença existente atualizada (eventId duplicado) ${email} event=${licenseEventId}`);
          } else {
            throw err;
          }
        }
      }

      if (system_id) await grantContentAccessForSystem(prisma, email, system_id);

      await postRobotJson(process.env.ROBOT_ACTIVATE_URL, {
        email,
        numero_conta: '',
        system_id,
        event_id
      });
    }
  }

  // --- 2) Conceder acesso a conteúdos pelo offerCode/productId ---
  const searchCode = offer_code || product_id;
  if (searchCode) {
    const possibleContents = await prisma.content.findMany({
      where: {
        OR: [
          { hotmartOffer: { contains: searchCode } },
          ...(product_id && product_id !== searchCode ? [{ hotmartOffer: { contains: product_id } }] : [])
        ]
      }
    });
    const contentsToGrant = possibleContents.filter(c => {
      const codes = c.hotmartOffer.split(',').map(s => s.trim());
      return codes.includes(offer_code) || codes.includes(product_id);
    });

    if (contentsToGrant.length > 0) {
      for (const content of contentsToGrant) {
        try {
          await prisma.purchase.create({ data: { userId: user.id, contentId: content.id } });
        } catch (e: any) {
          if (!e.message?.includes('Unique constraint')) throw e;
        }
        const bonuses = await prisma.content.findMany({ where: { isBonus: true, parentContentId: content.id } });
        if (bonuses.length > 0) {
          await prisma.purchase.createMany({
            data: bonuses.map(b => ({ userId: user.id, contentId: b.id })),
            skipDuplicates: true
          });
        }
      }
      log('INFO', `Acesso ao conteúdo concedido: ${email} -> ${contentsToGrant.map(c => c.title).join(', ')}`);
    }
  }

  return { ok: true, status: 200, message: `Webhook processado com sucesso!${welcomeEmailNote}` };
}

async function deactivateLicense(prisma: PrismaClient, data: Record<string, unknown>) {
  let email = '';
  let event_id = '';
  let offer_code = '';
  let subscriber_code = '';

  const d = data.data as Record<string, unknown> | undefined;
  if (d?.buyer && typeof d.buyer === 'object') {
    const buyer = d.buyer as Record<string, unknown>;
    email = String(buyer.email || '').trim().toLowerCase();
    const purchase = (d.purchase || {}) as Record<string, unknown>;
    const offer = (purchase.offer || {}) as Record<string, unknown>;
    event_id = String(purchase.transaction || '').trim();
    offer_code = String(offer.code || '').trim();
    subscriber_code = extractSubscriberCode(data);
  } else if (d?.subscriber && typeof d.subscriber === 'object') {
    const sub = d.subscriber as Record<string, unknown>;
    email = String(sub.email || '').trim().toLowerCase();
    event_id = String((data as { id?: string }).id || '').trim();
    if (typeof d.subscription === 'object' && d.subscription) {
      const plan = (d.subscription as Record<string, unknown>).plan as Record<string, unknown> | undefined;
      offer_code = String(plan?.id || '');
    }
    subscriber_code = String(sub.code || '').trim();
  }

  if (!email) return { ok: false, status: 400, message: 'Email obrigatório para desativação' };

  const productId = extractProductId(data);

  // --- 1) Desativar licença(s) do produto específico ---
  let licensesDeactivated = 0;
  let deactivatedSystemIds: string[] = [];

  // Tentar encontrar por subscriber_code (mais preciso)
  if (subscriber_code) {
    const bySubscriber = await prisma.license.findMany({
      where: { subscriberCode: subscriber_code, email, statusLicenca: 'ativa' }
    });
    for (const lic of bySubscriber) {
      await prisma.license.update({
        where: { id: lic.id },
        data: { statusLicenca: 'desativada', dataCancelamento: new Date() }
      });
      invalidateLicenseCacheForEmail(lic.email);
      if (lic.systemId) deactivatedSystemIds.push(lic.systemId);
      await postRobotJson(process.env.ROBOT_DEACTIVATE_URL, {
        email: lic.email, numero_conta: lic.numeroConta, system_id: lic.systemId, event_id
      });
      licensesDeactivated++;
    }
  }

  // Tentar por event_id (transaction)
  if (!licensesDeactivated && event_id) {
    const byEvent = await prisma.license.findFirst({ where: { eventId: event_id, statusLicenca: 'ativa' } });
    if (byEvent) {
      await prisma.license.update({
        where: { id: byEvent.id },
        data: { statusLicenca: 'desativada', dataCancelamento: new Date() }
      });
      invalidateLicenseCacheForEmail(byEvent.email);
      if (byEvent.systemId) deactivatedSystemIds.push(byEvent.systemId);
      await postRobotJson(process.env.ROBOT_DEACTIVATE_URL, {
        email: byEvent.email, numero_conta: byEvent.numeroConta, system_id: byEvent.systemId, event_id
      });
      licensesDeactivated++;
    }
  }

  // Tentar por offer_code → desativa a licença mais recente com mesma oferta/plano (não todas)
  if (!licensesDeactivated && offer_code) {
    const product = await findProductByOfferCode(prisma, offer_code);
    const plano = product?.plano || null;
    let lic =
      (await prisma.license.findFirst({
        where: { email, statusLicenca: 'ativa', offerCode: offer_code },
        orderBy: { id: 'desc' },
      })) ||
      (plano
        ? await prisma.license.findFirst({
            where: { email, statusLicenca: 'ativa', plano },
            orderBy: { id: 'desc' },
          })
        : null);
    if (lic) {
      await prisma.license.update({
        where: { id: lic.id },
        data: { statusLicenca: 'desativada', dataCancelamento: new Date() }
      });
      invalidateLicenseCacheForEmail(lic.email);
      if (lic.systemId) deactivatedSystemIds.push(lic.systemId);
      await postRobotJson(process.env.ROBOT_DEACTIVATE_URL, {
        email: lic.email, numero_conta: lic.numeroConta, system_id: lic.systemId, event_id
      });
      licensesDeactivated++;
    }
  }

  // NÃO usar fallback genérico — se não encontrou licença específica, não desativa nenhuma
  if (licensesDeactivated > 0) {
    log('INFO', `${licensesDeactivated} licença(s) desativada(s) para ${email} (event=${event_id}, offer=${offer_code})`);
  }

  // --- 2) Revogar acesso ao conteúdo do produto reembolsado (mas preservar outros) ---
  const searchCode = offer_code || productId;
  if (searchCode) {
    const user = await prisma.user.findUnique({ where: { email } });
    if (user) {
      const possibleContents = await prisma.content.findMany({
        where: {
          OR: [
            { hotmartOffer: { contains: searchCode } },
            ...(productId && productId !== searchCode ? [{ hotmartOffer: { contains: productId } }] : [])
          ]
        }
      });
      const contentsToRevoke = possibleContents.filter(c => {
        const codes = c.hotmartOffer.split(',').map(s => s.trim());
        return codes.includes(offer_code) || codes.includes(productId);
      });

      if (contentsToRevoke.length > 0) {
        // Verificar quais conteúdos o usuário tem acesso por OUTROS produtos/licenças ativos
        const otherActiveLicenses = await prisma.license.findMany({
          where: { email, statusLicenca: 'ativa' }
        });
        const otherActiveSystemIds = otherActiveLicenses
          .map(l => l.systemId)
          .filter(s => s && !deactivatedSystemIds.includes(s));

        // Conteúdos protegidos por outras licenças ativas
        const protectedByOtherLicense = new Set<string>();
        if (otherActiveSystemIds.length > 0) {
          const protectedContents = await prisma.content.findMany({
            where: { licenseSystemId: { in: otherActiveSystemIds } },
            select: { id: true }
          });
          for (const pc of protectedContents) protectedByOtherLicense.add(pc.id);
        }

        // Verificar se o conteúdo está vinculado a outro offerCode que o usuário ainda possui
        const allUserPurchases = await prisma.purchase.findMany({
          where: { userId: user.id },
          select: { contentId: true }
        });
        const userContentIds = new Set(allUserPurchases.map(p => p.contentId));

        let idsToRemove: string[] = [];
        for (const c of contentsToRevoke) {
          if (protectedByOtherLicense.has(c.id)) {
            log('INFO', `Conteúdo "${c.title}" mantido — protegido por outra licença ativa`);
            continue;
          }
          idsToRemove.push(c.id);
          const bonuses = await prisma.content.findMany({ where: { parentContentId: c.id }, select: { id: true } });
          for (const b of bonuses) {
            if (!protectedByOtherLicense.has(b.id)) {
              idsToRemove.push(b.id);
            }
          }
        }

        if (idsToRemove.length > 0) {
          await prisma.purchase.deleteMany({ where: { userId: user.id, contentId: { in: idsToRemove } } });
          log('INFO', `Acesso revogado: ${email} -> ${idsToRemove.length} conteúdo(s) (offer=${offer_code})`);
        }
      }
    }
  }

  // Também revogar acesso a conteúdos por systemId desativado, respeitando outras licenças
  if (deactivatedSystemIds.length > 0) {
    const user = await prisma.user.findUnique({ where: { email } });
    if (user) {
      const otherActiveLicenses = await prisma.license.findMany({
        where: { email, statusLicenca: 'ativa' }
      });
      const stillActiveSystemIds = otherActiveLicenses.map(l => l.systemId).filter(Boolean);

      for (const sysId of deactivatedSystemIds) {
        const contentsForSystem = await prisma.content.findMany({
          where: { licenseSystemId: sysId },
          select: { id: true, title: true }
        });

        for (const c of contentsForSystem) {
          // Se outra licença ativa cobre este conteúdo, não revogar
          const coveredByOther = await prisma.content.findFirst({
            where: { id: c.id, licenseSystemId: { in: stillActiveSystemIds } }
          });
          if (coveredByOther) {
            log('INFO', `Conteúdo "${c.title}" mantido — coberto por outra licença ativa`);
            continue;
          }
          await prisma.purchase.deleteMany({ where: { userId: user.id, contentId: c.id } });
          const bonuses = await prisma.content.findMany({ where: { parentContentId: c.id }, select: { id: true } });
          if (bonuses.length) {
            await prisma.purchase.deleteMany({ where: { userId: user.id, contentId: { in: bonuses.map(b => b.id) } } });
          }
        }
      }
    }
  }

  if (!licensesDeactivated && !searchCode) {
    log('WARN', `Reembolso sem identificação de produto: ${email} event=${event_id} offer=${offer_code}`);
    return { ok: true, status: 200, message: 'Webhook recebido mas nenhum produto específico identificado para desativação' };
  }

  return { ok: true, status: 200, message: 'Webhook processado com sucesso!' };
}

function extractProductId(data: Record<string, unknown>): string {
  const d = data.data as Record<string, unknown> | undefined;
  const product = (d?.product || {}) as Record<string, unknown>;
  return String(product.id || product.ucode || '').trim();
}
