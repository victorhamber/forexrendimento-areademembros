import express from 'express';
import iconv from 'iconv-lite';
import type { PrismaClient } from '@prisma/client';
import { getForexApiKeys, getForexWebhookToken } from '../lib/apiSettings.js';
import { extractHotmartWebhookToken } from '../lib/appUrls.js';
import { checkRateLimit } from '../lib/rateLimitMem.js';
import { log } from '../lib/logger.js';
import { validateLicenseHandler } from './licenseService.js';
import { processLicenseWebhook } from './webhookLicenseProcessor.js';
import { submitPerformance } from './performanceSubmit.js';
import { getRankingResponse } from './rankingService.js';
import { createLicenseWebhookRawLog } from '../lib/repairSequences.js';

function clientIp(req: express.Request): string {
  const xf = req.headers['x-forwarded-for'];
  if (typeof xf === 'string') return xf.split(',')[0]!.trim();
  return req.socket.remoteAddress || 'unknown';
}

export function registerForexRoutes(app: express.Application, prisma: PrismaClient) {
  const router = express.Router();

  const validate = async (req: express.Request, res: express.Response) => {
    const ip = clientIp(req);
    if (!checkRateLimit(`rate_limit_${ip}`, 60, 60_000)) {
      log('WARN', `validate_license rate limit: ip=${ip}`);
      return res.status(429).json({ status: 'error', message: 'Rate limit exceeded. Try again later.' });
    }
    const apiKey = String(req.headers['x-api-key'] || '');
    const keys = await getForexApiKeys(prisma);
    if (!keys.length || !keys.includes(apiKey)) {
      log('WARN', `validate_license API key inválida: ip=${ip}`);
      return res.status(403).json({ status: 'error', message: 'Unauthorized: invalid or missing X-API-Key' });
    }
    const out = await validateLicenseHandler(prisma, req.body || {});
    res.status(out.status).json(out.json);
  };

  router.post('/validate_license', validate);

  router.post('/webhook', async (req, res) => {
    const token = extractHotmartWebhookToken(req);
    const dbToken = (await getForexWebhookToken(prisma)).trim();
    const envToken = String(process.env.HOTMART_HOTTOK || '').trim();
    const validTokens = [...new Set([dbToken, envToken].filter(Boolean))];
    if (!validTokens.length) {
      log('SECURITY', 'Webhook rejeitado: forex_webhook_token não configurado');
      return res.status(500).json({
        status: 'error',
        message: 'Configuration Error: Webhook Token not set in settings'
      });
    }
    if (!validTokens.includes(token)) {
      log('SECURITY', 'Webhook token inválido');
      return res.status(401).json({ status: 'error', message: 'Unauthorized: Invalid Webhook Token' });
    }

    const raw = JSON.stringify(req.body);
    const logRow = await createLicenseWebhookRawLog(prisma, raw, false);

    try {
      const result = await processLicenseWebhook(prisma, (req.body || {}) as Record<string, unknown>);
      await prisma.licenseWebhookRawLog.update({ where: { id: logRow.id }, data: { processed: true } });
      if (!result.ok) return res.status(result.status).json({ status: 'error', message: result.message });
      return res.status(200).json({ status: 'success', message: result.message });
    } catch (e) {
      log('ERROR', 'Webhook process error', { err: String(e) });
      return res.status(400).json({ status: 'error', message: String(e) });
    }
  });

  router.post('/submit_performance', async (req, res) => {
    const out = await submitPerformance(prisma, (req.body || {}) as Record<string, unknown>);
    res.status(out.status).json(out.json);
  });

  router.get('/get_ranking', async (req, res) => {
    const period = parseInt(String(req.query.period || '7'), 10);
    const ranking = await getRankingResponse(prisma, period);
    res.json(ranking);
  });

  router.get('/download_setup', async (req, res) => {
    const id = parseInt(String(req.query.id || '0'), 10);
    if (!id) return res.status(400).json({ status: 'error', message: 'ID do setup não informado.' });
    const row = await prisma.rankingEntry.findUnique({ where: { id }, select: { setupFile: true } });
    if (!row?.setupFile) return res.status(404).json({ status: 'error', message: 'Setup não encontrado.' });
    let setup = row.setupFile;
    if (setup.includes('\n')) {
      setup = setup.replace(/\n/g, '\r\n').replace(/\r\r\n/g, '\r\n');
    } else if (setup.includes('\\n')) {
      setup = setup.replace(/\\n/g, '\r\n');
    }
    const buf = iconv.encode(setup, 'win1252');
    res.setHeader('Content-Type', 'text/plain; charset=Windows-1252');
    res.setHeader('Content-Disposition', `attachment; filename="setup_trader_${id}.set"`);
    res.setHeader('Content-Length', String(buf.length));
    res.send(buf);
  });

  app.use('/api/forex-rendimento/v1', router);
  app.post('/api/forex-rendimento/v2/validate_license', validate);
  // Compatibilidade com EAs que ainda chamam a URL legada do WordPress
  app.post('/wp-json/forex-rendimento/v2/validate_license', validate);
}
