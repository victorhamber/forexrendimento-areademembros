import express from 'express';
import type { PrismaClient } from '@prisma/client';
import { invalidateLicenseCacheForEmail } from '../lib/licenseValidationCache.js';
import {
  fireLicenseCreatedNotify,
  fireLicenseExpiryUpdatedNotify,
} from '../lib/licenseAdminNotification.js';
import { repairLicensesByOfferCode } from '../lib/repairLicensesByOfferCode.js';
import { exportDatabaseJson } from '../lib/databaseBackup.js';
import { assertDesafioAccountAllowed } from '../lib/desafioAccountCheck.js';
import {
  datesForDesafioPlanUpgrade,
  findDesafioLicenseForUpgrade,
  isDesafioPlan,
  isPaidUpgradePlan,
} from '../lib/desafioLicenseRules.js';

function addDurationByPlanFrom(planoRaw: string | null | undefined, base: Date): Date {
  const plano = String(planoRaw || 'mensal').toLowerCase().trim();
  const d = new Date(base);
  const toleranceDays = 3;
  if (plano === 'teste') {
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

export function registerAdminForexRoutes(
  app: express.Application,
  prisma: PrismaClient,
  adminAuth: (req: express.Request, res: express.Response, next: express.NextFunction) => void
) {
  app.get('/api/admin/licenses', adminAuth, async (req, res) => {
    const email = String(req.query.email || '')
      .toLowerCase()
      .trim();
    const rows = await prisma.license.findMany({
      where: email ? { email } : undefined,
      orderBy: { id: 'desc' },
      ...(email ? {} : { take: 10000 }),
    });
    res.json(rows);
  });

  app.post('/api/admin/licenses', adminAuth, async (req, res) => {
    const b = req.body as Record<string, unknown>;
    const eventId = String(b.eventId || `manual_${Date.now()}`);
    const plano = String(b.plano || 'mensal');
    const email = String(b.email || '').toLowerCase().trim();
    const numeroConta = String(b.numeroConta ?? '').trim();
    try {
      const products = await prisma.product.findMany();
      const systemId = String(b.systemId || '');

      if (numeroConta) {
        const desafioCheck = await assertDesafioAccountAllowed(
          prisma,
          { id: 0, plano, systemId, offerCode: b.offerCode != null ? String(b.offerCode) : null },
          numeroConta,
          products
        );
        if (!desafioCheck.ok) return res.status(400).json({ error: desafioCheck.message });
      }

      let upgradeTarget = null;
      if (isPaidUpgradePlan(plano) && systemId) {
        const productMatch = products.find(
          (p) =>
            String(p.systemId || '').includes(systemId.split(',')[0]?.trim() || systemId) &&
            String(p.plano || '').toLowerCase() === plano.toLowerCase()
        );
        if (productMatch) {
          const allForEmail = await prisma.license.findMany({ where: { email }, orderBy: { id: 'asc' } });
          upgradeTarget = findDesafioLicenseForUpgrade(allForEmail, productMatch, products);
        }
      }

      if (upgradeTarget) {
        const now = new Date();
        const { dataAtivacao, dataExpiracao } = datesForDesafioPlanUpgrade(
          upgradeTarget,
          plano,
          now,
          addDurationByPlanFrom
        );
        const lic = await prisma.license.update({
          where: { id: upgradeTarget.id },
          data: {
            buyerName: b.buyerName != null ? String(b.buyerName) : undefined,
            numeroConta: numeroConta || undefined,
            plano,
            statusLicenca: String(b.statusLicenca || 'ativa'),
            dataExpiracao,
            dataAtivacao,
            systemId,
            offerCode: b.offerCode != null ? String(b.offerCode).trim() || null : undefined,
            subscriberCode: b.subscriberCode != null ? String(b.subscriberCode) : undefined,
            eventId,
          },
        });
        invalidateLicenseCacheForEmail(lic.email);
        fireLicenseExpiryUpdatedNotify(prisma, lic, upgradeTarget.dataExpiracao, 'admin');
        return res.json(lic);
      }

      const lic = await prisma.license.create({
        data: {
          email,
          buyerName: b.buyerName != null ? String(b.buyerName) : null,
          numeroConta,
          eventId,
          plano,
          statusLicenca: String(b.statusLicenca || 'ativa'),
          dataExpiracao: null,
          systemId,
          offerCode: b.offerCode != null ? String(b.offerCode).trim() || null : null,
          subscriberCode: b.subscriberCode != null ? String(b.subscriberCode) : null,
          dataAtivacao: null,
        },
      });
      invalidateLicenseCacheForEmail(lic.email);
      fireLicenseCreatedNotify(prisma, lic, 'admin');
      res.json(lic);
    } catch (e) {
      res.status(400).json({ error: String(e) });
    }
  });

  app.put('/api/admin/licenses/:id', adminAuth, async (req, res) => {
    const id = parseInt(req.params.id, 10);
    const b = req.body as Record<string, unknown>;
    try {
      const current = await prisma.license.findUnique({ where: { id } });
      if (!current) return res.status(404).json({ error: 'Licença não encontrada.' });
      const plano = b.plano != null ? String(b.plano) : current.plano;

      let dataAtivacao: Date | undefined;
      let dataExpiracao: Date | null | undefined;
      if (Object.prototype.hasOwnProperty.call(b, 'dataExpiracao')) {
        const raw = b.dataExpiracao;
        if (raw === null || raw === '') {
          dataExpiracao = null;
        } else {
          const parsed = new Date(String(raw));
          if (Number.isNaN(parsed.getTime())) {
            return res.status(400).json({ error: 'Data de expiração inválida.' });
          }
          dataExpiracao = parsed;
        }
      } else if (
        b.plano != null &&
        isDesafioPlan(current.plano) &&
        isPaidUpgradePlan(plano)
      ) {
        const now = new Date();
        const dates = datesForDesafioPlanUpgrade(current, plano, now, addDurationByPlanFrom);
        dataAtivacao = dates.dataAtivacao;
        dataExpiracao = dates.dataExpiracao;
      } else if (b.plano != null && current.dataAtivacao) {
        dataExpiracao = addDurationByPlanFrom(plano, current.dataAtivacao);
      }

      const previousDataExpiracao = current.dataExpiracao;

      const nextPlano = b.plano != null ? String(b.plano) : current.plano;
      const nextNumeroConta =
        b.numeroConta !== undefined ? String(b.numeroConta).trim() : String(current.numeroConta || '').trim();
      if (nextNumeroConta) {
        const products = await prisma.product.findMany();
        const desafioCheck = await assertDesafioAccountAllowed(
          prisma,
          {
            id: current.id,
            plano: nextPlano,
            systemId: b.systemId != null ? String(b.systemId) : current.systemId,
            offerCode:
              b.offerCode !== undefined
                ? b.offerCode
                  ? String(b.offerCode)
                  : null
                : current.offerCode,
          },
          nextNumeroConta,
          products
        );
        if (!desafioCheck.ok) return res.status(400).json({ error: desafioCheck.message });
      }

      const lic = await prisma.license.update({
        where: { id },
        data: {
          email: b.email != null ? String(b.email).toLowerCase().trim() : undefined,
          buyerName: b.buyerName !== undefined ? (b.buyerName ? String(b.buyerName) : null) : undefined,
          numeroConta: b.numeroConta !== undefined ? String(b.numeroConta) : undefined,
          plano: b.plano != null ? String(b.plano) : undefined,
          statusLicenca: b.statusLicenca != null ? String(b.statusLicenca) : undefined,
          ...(dataExpiracao !== undefined ? { dataExpiracao } : {}),
          ...(dataAtivacao !== undefined ? { dataAtivacao } : {}),
          systemId: b.systemId != null ? String(b.systemId) : undefined,
          offerCode: b.offerCode !== undefined ? (b.offerCode ? String(b.offerCode).trim() : null) : undefined,
          subscriberCode: b.subscriberCode !== undefined ? (b.subscriberCode ? String(b.subscriberCode) : null) : undefined,
          ...(dataExpiracao && !current.dataAtivacao && dataAtivacao === undefined
            ? { dataAtivacao: new Date() }
            : {}),
        }
      });
      fireLicenseExpiryUpdatedNotify(prisma, lic, previousDataExpiracao, 'admin');
      invalidateLicenseCacheForEmail(lic.email);
      res.json(lic);
    } catch (e) {
      res.status(400).json({ error: String(e) });
    }
  });

  app.delete('/api/admin/licenses/:id', adminAuth, async (req, res) => {
    const id = parseInt(req.params.id, 10);
    await prisma.license.delete({ where: { id } });
    res.json({ success: true });
  });

  /** Remove todas as licenças EA de um e-mail (cliente sem conta User). */
  app.delete('/api/admin/license-clients', adminAuth, async (req, res) => {
    const email = String(req.query.email || '')
      .toLowerCase()
      .trim();
    if (!email) return res.status(400).json({ error: 'E-mail obrigatório.' });
    const result = await prisma.license.deleteMany({ where: { email } });
    res.json({ success: true, deleted: result.count });
  });

  /** Alinha plano/systemId de todas as licenças ao catálogo via offerCode (contas antigas). */
  app.post('/api/admin/licenses/repair-by-offer', adminAuth, async (req, res) => {
    try {
      const dryRun = (req.body as { dryRun?: boolean })?.dryRun === true;
      const result = await repairLicensesByOfferCode(prisma, { dryRun });
      res.json({
        success: true,
        message: dryRun
          ? `${result.updated} licença(s) seriam corrigidas (${result.unchanged} já ok).`
          : `${result.updated} licença(s) corrigidas (${result.unchanged} já estavam ok).`,
        ...result,
      });
    } catch (e) {
      res.status(500).json({ error: e instanceof Error ? e.message : String(e) });
    }
  });

  app.get('/api/admin/products', adminAuth, async (_req, res) => {
    res.json(await prisma.product.findMany({ orderBy: { id: 'asc' } }));
  });

  const normalizeProductCsv = (raw: unknown): string | null => {
    if (raw == null) return null;
    const v = String(raw)
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);
    if (!v.length) return null;
    return Array.from(new Set(v)).join(', ');
  };

  app.post('/api/admin/products', adminAuth, async (req, res) => {
    const b = req.body as Record<string, unknown>;
    const p = await prisma.product.create({
      data: {
        productName: String(b.productName || 'Produto'),
        systemId: normalizeProductCsv(b.systemId) || '',
        description: b.description != null ? String(b.description) : null,
        offerCode: normalizeProductCsv(b.offerCode),
        plano: b.plano != null ? String(b.plano) : null,
        downloadUrl: b.downloadUrl != null ? String(b.downloadUrl) : null,
        downloadFileName: b.downloadFileName != null ? String(b.downloadFileName) : null,
        downloadVersion: b.downloadVersion != null ? String(b.downloadVersion) : null
      }
    });
    res.json(p);
  });

  app.put('/api/admin/products/:id', adminAuth, async (req, res) => {
    const id = parseInt(req.params.id, 10);
    const b = req.body as Record<string, unknown>;
    const p = await prisma.product.update({
      where: { id },
      data: {
        productName: b.productName != null ? String(b.productName) : undefined,
        systemId: b.systemId != null ? (normalizeProductCsv(b.systemId) || '') : undefined,
        description: b.description !== undefined ? (b.description ? String(b.description) : null) : undefined,
        offerCode: b.offerCode !== undefined ? normalizeProductCsv(b.offerCode) : undefined,
        plano: b.plano !== undefined ? (b.plano ? String(b.plano) : null) : undefined,
        downloadUrl: b.downloadUrl !== undefined ? (b.downloadUrl ? String(b.downloadUrl) : null) : undefined,
        downloadFileName:
          b.downloadFileName !== undefined ? (b.downloadFileName ? String(b.downloadFileName) : null) : undefined,
        downloadVersion:
          b.downloadVersion !== undefined ? (b.downloadVersion ? String(b.downloadVersion) : null) : undefined
      }
    });
    res.json(p);
  });

  app.delete('/api/admin/products/:id', adminAuth, async (req, res) => {
    await prisma.product.delete({ where: { id: parseInt(req.params.id, 10) } });
    res.json({ success: true });
  });

  app.get('/api/admin/outgoing-webhooks', adminAuth, async (_req, res) => {
    res.json(await prisma.outgoingWebhook.findMany());
  });

  app.post('/api/admin/outgoing-webhooks', adminAuth, async (req, res) => {
    const b = req.body as { destinationUrl?: string; events?: string[] };
    const row = await prisma.outgoingWebhook.create({
      data: {
        destinationUrl: String(b.destinationUrl || ''),
        events: JSON.stringify(b.events || [])
      }
    });
    res.json(row);
  });

  app.get('/api/admin/export/forex-json', adminAuth, async (_req, res) => {
    const [licenses, products, ranking] = await Promise.all([
      prisma.license.findMany(),
      prisma.product.findMany(),
      prisma.rankingEntry.findMany({ take: 2000, orderBy: { id: 'desc' } })
    ]);
    res.json({ licenses, products, rankingSample: ranking });
  });

  /** Backup completo do banco (JSON) para download antes de manutenção. */
  app.get('/api/admin/database/backup', adminAuth, async (_req, res) => {
    try {
      const payload = await exportDatabaseJson(prisma);
      const ts = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
      const filename = `autofintech-backup-${ts}.json`;
      res.setHeader('Content-Type', 'application/json; charset=utf-8');
      res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
      res.send(JSON.stringify(payload));
    } catch (e) {
      res.status(500).json({ error: e instanceof Error ? e.message : String(e) });
    }
  });
}
