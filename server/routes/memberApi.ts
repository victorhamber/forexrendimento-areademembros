import express from 'express';
import type { PrismaClient } from '@prisma/client';
import { resolveUserId } from '../auth/resolveUser.js';
import { validateLicenseHandler } from '../forex/licenseService.js';
import { invalidateLicenseCacheForEmail } from '../lib/licenseValidationCache.js';
import { checkRateLimit } from '../lib/rateLimitMem.js';
import { resolveOwnedProductIds, resolveOwnedSystemIds, resolveProductForLicense } from '../lib/licenseProductMatch.js';
import { assertDesafioAccountAllowed } from '../lib/desafioAccountCheck.js';

export function registerMemberApiRoutes(app: express.Application, prisma: PrismaClient) {
  app.get('/api/me/licenses', async (req, res) => {
    const userId = resolveUserId(req);
    if (!userId) return res.status(401).json({ error: 'Unauthorized' });
    const user = await prisma.user.findUnique({ where: { id: userId } });
    if (!user) return res.status(404).json({ error: 'User not found' });
    const licenses = await prisma.license.findMany({
      where: { email: user.email.toLowerCase() },
      orderBy: { id: 'desc' },
      select: {
        id: true,
        systemId: true,
        offerCode: true,
        plano: true,
        statusLicenca: true,
        dataExpiracao: true,
        numeroConta: true,
        buyerName: true
      }
    });
    const products = await prisma.product.findMany();
    const withNames = licenses.map(l => ({
      ...l,
      productName: resolveProductForLicense(products, l)?.productName || l.systemId
    }));
    res.json(withNames);
  });

  /** Mesma lógica do EA/plugin: valida e-mail da conta + número da conta + system_id */
  app.post('/api/me/validate-license', async (req, res) => {
    const userId = resolveUserId(req);
    if (!userId) return res.status(401).json({ error: 'Unauthorized' });
    if (!checkRateLimit(`me_validate_license_${userId}`, 40, 60_000)) {
      return res.status(429).json({ status: 'error', message: 'Muitas tentativas. Aguarde um minuto.' });
    }
    const user = await prisma.user.findUnique({ where: { id: userId } });
    if (!user) return res.status(404).json({ error: 'User not found' });
    const numero_conta = String(req.body?.numero_conta || '').trim();
    const system_id = String(req.body?.system_id || '').trim();
    const license_id = req.body?.license_id;
    const out = await validateLicenseHandler(prisma, {
      email: user.email,
      numero_conta,
      system_id,
      license_id,
    });
    res.status(out.status).json(out.json);
  });

  app.put('/api/me/licenses/:id/account', async (req, res) => {
    const userId = resolveUserId(req);
    if (!userId) return res.status(401).json({ error: 'Unauthorized' });
    const user = await prisma.user.findUnique({ where: { id: userId } });
    if (!user) return res.status(404).json({ error: 'User not found' });
    const id = parseInt(req.params.id, 10);
    const numeroConta = String(req.body?.numero_conta || '').trim();
    if (!numeroConta || numeroConta.length < 3) {
      return res.status(400).json({ error: 'Informe um número de conta MetaTrader válido (mínimo 3 dígitos).' });
    }
    const lic = await prisma.license.findFirst({
      where: { id, email: user.email.toLowerCase() }
    });
    if (!lic) return res.status(404).json({ error: 'License not found' });

    const products = await prisma.product.findMany();
    const desafioCheck = await assertDesafioAccountAllowed(prisma, lic, numeroConta, products);
    if (!desafioCheck.ok) {
      return res.status(400).json({ error: desafioCheck.message });
    }

    await prisma.license.update({ where: { id }, data: { numeroConta } });
    invalidateLicenseCacheForEmail(user.email);
    res.json({ success: true });
  });

  app.get('/api/me/entitlements', async (req, res) => {
    const userId = resolveUserId(req);
    if (!userId) return res.status(401).json({ error: 'Unauthorized' });
    const user = await prisma.user.findUnique({ where: { id: userId } });
    if (!user) return res.status(404).json({ error: 'User not found' });
    const now = new Date();
    const activeLicenses = await prisma.license.findMany({
      where: {
        email: user.email.toLowerCase(),
        statusLicenca: 'ativa',
        OR: [{ dataExpiracao: null }, { dataExpiracao: { gte: now } }]
      },
      select: { systemId: true, offerCode: true, plano: true, dataExpiracao: true }
    });
    const allProducts = await prisma.product.findMany({
      select: { id: true, systemId: true, offerCode: true, plano: true }
    });
    const systemIds = resolveOwnedSystemIds(activeLicenses);
    const productIds = [...resolveOwnedProductIds(activeLicenses, allProducts)];
    res.json({ systemIds, productIds, licenses: activeLicenses });
  });

  /** Downloads do robô liberados pelas licenças ativas do usuário */
  app.get('/api/me/downloads', async (req, res) => {
    const userId = resolveUserId(req);
    if (!userId) return res.status(401).json({ error: 'Unauthorized' });
    const user = await prisma.user.findUnique({ where: { id: userId } });
    if (!user) return res.status(404).json({ error: 'User not found' });
    const now = new Date();
    const activeLicenses = await prisma.license.findMany({
      where: {
        email: user.email.toLowerCase(),
        statusLicenca: 'ativa',
        OR: [{ dataExpiracao: null }, { dataExpiracao: { gte: now } }]
      },
      select: { systemId: true, offerCode: true, plano: true }
    });
    if (!activeLicenses.length) return res.json({ downloads: [] });

    // IMPORTANT: resolve posse com catálogo COMPLETO para evitar vazamento
    // quando só um dos produtos (mesmo systemId) tem download cadastrado.
    const catalogProducts = await prisma.product.findMany({
      select: { id: true, systemId: true, offerCode: true, plano: true }
    });
    const ownedProductIds = resolveOwnedProductIds(activeLicenses, catalogProducts);
    if (!ownedProductIds.size) return res.json({ downloads: [] });

    const downloadableProducts = await prisma.product.findMany({
      where: { NOT: { downloadUrl: null } },
      orderBy: { id: 'asc' },
      select: {
        id: true,
        productName: true,
        systemId: true,
        offerCode: true,
        plano: true,
        description: true,
        downloadUrl: true,
        downloadFileName: true,
        downloadVersion: true
      }
    });
    const downloads = downloadableProducts.filter((p) => ownedProductIds.has(p.id));
    res.json({ downloads });
  });

  app.get('/api/public/carousel', async (_req, res) => {
    const row = await prisma.setting.findUnique({ where: { key: 'carousel_slides' } });
    let slides: unknown[] = [];
    if (row?.value) {
      try {
        const p = JSON.parse(row.value) as unknown;
        slides = Array.isArray(p) ? p : [];
      } catch {
        slides = [];
      }
    }
    res.json({ slides });
  });
}
