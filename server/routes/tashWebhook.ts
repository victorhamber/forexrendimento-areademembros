import express from 'express';
import type { PrismaClient } from '@prisma/client';
import { checkRateLimit } from '../lib/rateLimitMem.js';
import { log } from '../lib/logger.js';
import { getTashWebhookProductId, getTashWebhookToken } from '../lib/apiSettings.js';
import { normalizeCsv, parseCsv } from '../lib/csv.js';
import { isDesafioPlan, isPaidUpgradePlan } from '../lib/desafioLicenseRules.js';
import { grantContentAccessForSystem } from '../forex/licenseService.js';
import { fireLicenseCreatedNotify } from '../lib/licenseAdminNotification.js';
import { isPrismaUniqueViolation } from '../lib/prismaErrors.js';
import { createLicenseWebhookRawLog } from '../lib/repairSequences.js';

function clientIp(req: express.Request): string {
  return String(req.ip || req.socket?.remoteAddress || 'unknown').slice(0, 45);
}

function extractTashToken(req: express.Request): string {
  const h = req.headers;
  const fromHeader =
    h['x-webhook-token'] ||
    h['x-tash-token'] ||
    h['authorization'];
  if (fromHeader) {
    let raw = String(Array.isArray(fromHeader) ? fromHeader[0] : fromHeader).trim();
    if (/^bearer\s+/i.test(raw)) raw = raw.replace(/^bearer\s+/i, '').trim();
    return raw;
  }
  const q = req.query?.token ?? req.query?.tash_token;
  if (q != null) return String(q).trim();
  return '';
}

function pickField(body: Record<string, unknown>, keys: string[]): string {
  for (const key of keys) {
    const v = body[key];
    if (v != null && String(v).trim()) return String(v).trim();
  }
  // Nested common shapes (Tally / forms)
  const data = body.data;
  if (data && typeof data === 'object' && !Array.isArray(data)) {
    return pickField(data as Record<string, unknown>, keys);
  }
  return '';
}

async function ensureUser(
  prisma: PrismaClient,
  email: string,
  buyerName: string,
  phone: string
) {
  const em = email.toLowerCase().trim();
  let user = await prisma.user.findUnique({ where: { email: em } });
  let isNewUser = false;
  if (!user) {
    const { hashMemberPassword } = await import('../lib/verifyUserPassword.js');
    try {
      user = await prisma.user.create({
        data: {
          email: em,
          name: buyerName || null,
          password: hashMemberPassword('Mudar123@'),
        },
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
    if (Object.keys(updates).length > 0) {
      user = await prisma.user.update({ where: { id: user.id }, data: updates });
    }
  }
  void phone;
  return { user, isNewUser };
}

export function registerTashWebhookRoutes(app: express.Application, prisma: PrismaClient) {
  app.post('/api/webhooks/tash', async (req, res) => {
    const ip = clientIp(req);
    if (!checkRateLimit(`tash_webhook_${ip}`, 20, 60_000)) {
      log('WARN', `tash webhook rate limit: ip=${ip}`);
      return res.status(429).json({ status: 'error', message: 'Rate limit exceeded. Try again later.' });
    }

    const configuredToken = (await getTashWebhookToken(prisma)).trim();
    if (!configuredToken) {
      log('SECURITY', 'Webhook Tash rejeitado: tash_webhook_token não configurado');
      return res.status(500).json({
        status: 'error',
        message: 'Configuration Error: Tash webhook token not set in settings',
      });
    }
    const token = extractTashToken(req);
    if (!token || token !== configuredToken) {
      log('SECURITY', `Webhook Tash token inválido: ip=${ip}`);
      return res.status(401).json({ status: 'error', message: 'Unauthorized: Invalid Webhook Token' });
    }

    const body = (req.body || {}) as Record<string, unknown>;
    const raw = JSON.stringify(body);
    const logRow = await createLicenseWebhookRawLog(prisma, raw, false);

    try {
      const email = pickField(body, ['email', 'Email', 'e-mail', 'E-mail', 'EMAIL']).toLowerCase();
      const name = pickField(body, ['name', 'nome', 'Name', 'Nome', 'full_name', 'buyer_name']);
      const phone = pickField(body, ['phone', 'telefone', 'Phone', 'Telefone', 'cellphone', 'whatsapp']);

      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
        await prisma.licenseWebhookRawLog.update({ where: { id: logRow.id }, data: { processed: true } });
        return res.status(400).json({ status: 'error', message: 'E-mail inválido.' });
      }
      if (!name) {
        await prisma.licenseWebhookRawLog.update({ where: { id: logRow.id }, data: { processed: true } });
        return res.status(400).json({ status: 'error', message: 'Nome é obrigatório.' });
      }
      if (!phone) {
        await prisma.licenseWebhookRawLog.update({ where: { id: logRow.id }, data: { processed: true } });
        return res.status(400).json({ status: 'error', message: 'Telefone é obrigatório.' });
      }

      const productIdRaw = await getTashWebhookProductId(prisma);
      const productId = parseInt(productIdRaw, 10);
      if (!Number.isFinite(productId) || productId <= 0) {
        log('ERROR', 'Webhook Tash: tash_webhook_product_id não configurado');
        await prisma.licenseWebhookRawLog.update({ where: { id: logRow.id }, data: { processed: true } });
        return res.status(500).json({
          status: 'error',
          message: 'Configuration Error: Tash product ID not set in settings',
        });
      }

      const product = await prisma.product.findUnique({ where: { id: productId } });
      if (!product) {
        await prisma.licenseWebhookRawLog.update({ where: { id: logRow.id }, data: { processed: true } });
        return res.status(500).json({ status: 'error', message: 'Produto de teste configurado não encontrado.' });
      }

      if (!isDesafioPlan(product.plano)) {
        log(
          'ERROR',
          `Webhook Tash bloqueado: produto id=${product.id} plano="${product.plano}" não é teste/desafio`
        );
        await prisma.licenseWebhookRawLog.update({ where: { id: logRow.id }, data: { processed: true } });
        return res.status(500).json({
          status: 'error',
          message:
            'Configuration Error: Tash webhook só pode ativar produto com plano teste ou desafio.',
        });
      }

      const licenseSystemId = normalizeCsv(product.systemId || '');
      const systemIds = parseCsv(licenseSystemId);
      const primarySystemId = systemIds[0] || licenseSystemId || 'TESTE_GRATUITO';

      const existingLicenses = await prisma.license.findMany({ where: { email } });
      const hasPaid = existingLicenses.some(
        (l) =>
          String(l.statusLicenca || '').toLowerCase() === 'ativa' && isPaidUpgradePlan(l.plano)
      );
      if (hasPaid) {
        await prisma.licenseWebhookRawLog.update({ where: { id: logRow.id }, data: { processed: true } });
        return res.status(400).json({
          status: 'error',
          message: 'Este e-mail já possui licença paga ativa. O teste gratuito não pode ser ativado.',
        });
      }

      for (const sid of systemIds.length ? systemIds : [primarySystemId]) {
        const trial = await prisma.trialHistory.findUnique({
          where: { email_systemId: { email, systemId: sid } },
        });
        if (trial) {
          await prisma.licenseWebhookRawLog.update({ where: { id: logRow.id }, data: { processed: true } });
          return res.status(400).json({
            status: 'error',
            message: 'Teste gratuito já utilizado para este produto.',
          });
        }
      }

      const hasActiveTest = existingLicenses.some(
        (l) =>
          String(l.statusLicenca || '').toLowerCase() === 'ativa' && isDesafioPlan(l.plano)
      );
      if (hasActiveTest) {
        await prisma.licenseWebhookRawLog.update({ where: { id: logRow.id }, data: { processed: true } });
        return res.status(400).json({
          status: 'error',
          message: 'Este e-mail já possui uma licença de teste ativa.',
        });
      }

      await ensureUser(prisma, email, name, phone);

      const eventId = `tash_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
      const plano = String(product.plano || 'teste').toLowerCase().trim() || 'teste';

      const created = await prisma.license.create({
        data: {
          email,
          buyerName: name,
          buyerPhone: phone,
          numeroConta: '',
          eventId,
          plano,
          statusLicenca: 'ativa',
          systemId: licenseSystemId || primarySystemId,
          offerCode: product.offerCode || null,
          dataAtivacao: null,
          dataExpiracao: null,
        },
      });
      fireLicenseCreatedNotify(prisma, created, 'tash_webhook');

      const trialEnd = new Date();
      trialEnd.setDate(trialEnd.getDate() + 10);
      for (const sid of systemIds.length ? systemIds : [primarySystemId]) {
        try {
          await prisma.trialHistory.create({
            data: {
              email,
              systemId: sid,
              eventId,
              trialEnd,
              status: 'active',
              ipAddress: ip,
              userAgent: String(req.headers['user-agent'] || '').slice(0, 500),
            },
          });
        } catch {
          /* unique — já bloqueado acima */
        }
        await grantContentAccessForSystem(prisma, email, sid);
      }

      await prisma.licenseWebhookRawLog.update({ where: { id: logRow.id }, data: { processed: true } });
      log('INFO', `Webhook Tash: licença teste criada email=${email} product=${product.id} event=${eventId}`);
      return res.status(200).json({
        status: 'success',
        message: 'Licença de teste ativada.',
        eventId,
        licenseId: created.id,
      });
    } catch (e) {
      log('ERROR', 'Webhook Tash process error', { err: String(e) });
      return res.status(400).json({ status: 'error', message: String(e) });
    }
  });
}
