import './loadEnv.js';
import express from 'express';
import cors from 'cors';
import path from 'path';
import fs from 'fs';
import crypto from 'crypto';
import http from 'http';
import { fileURLToPath } from 'url';
import { PrismaClient } from '@prisma/client';
import multer from 'multer';
import { signUserToken, signAdminJwt } from './auth/jwt.js';
import { resolveUserId } from './auth/resolveUser.js';
import { registerForexRoutes } from './forex/forexRoutes.js';
import { processLicenseWebhook } from './forex/webhookLicenseProcessor.js';
import { registerMemberApiRoutes } from './routes/memberApi.js';
import { registerEadAndTrialRoutes } from './routes/eadAndTrial.js';
import { registerAdminForexRoutes } from './routes/adminForex.js';
import { startScheduledJobs } from './jobs/scheduler.js';
import { userHasMemberAccess } from './lib/userAccess.js';
import { hashMemberPassword, verifyUserPassword } from './lib/verifyUserPassword.js';
import { adminAuthMiddleware } from './middleware/adminAuth.js';
import { validateAdminCredentials } from './lib/adminPassword.js';
import { ensureDevTestAccount } from './lib/ensureDevTestAccount.js';
import {
  decodeUploadOriginalName,
  detectMediaKind,
  formatMediaUploadError,
  resolveStoredMediaMime,
  resolveUploadMime,
  safeUploadFilename,
} from './lib/uploadMime.js';
import { assertUploadDirectoryWritable, resolveUploadDirectory } from './lib/uploadDir.js';
import {
  applyEmailPlaceholders,
  buildResetEmailHtml,
  DEFAULT_RESET_BODY_PT,
  emailBodyFromStored,
  type EmailLang,
} from '../shared/emailTemplates.js';
import { MEMBER_THEME_DEFAULTS, MEMBER_THEME_KEYS } from '../shared/memberTheme.js';
import { sendWelcomeEmail, detectLang } from './lib/welcomeEmail.js';
import { sendTransactionalEmail } from './lib/emailSender.js';
import { getMemberAppUrl, getWebhookUrls } from './lib/appUrls.js';
import { validateHotmartWebhookAuth } from './lib/hotmartWebhookAuth.js';
import { formatPrismaError } from './lib/prismaErrors.js';
import { createLicenseWebhookRawLog, repairAutoincrementSequences } from './lib/repairSequences.js';
import {
  enhanceBuilderPageHtml,
  findBuilderPageBySlug,
  isBuilderPagePublished,
  loadBuilderPages,
  normalizeBuilderSlug,
  PAGE_BUILDER_PAGES_KEY,
  resetPageBuilder,
  savePagesWithGuard,
} from './lib/pageBuilder.js';

const DEFAULT_PASSWORD = 'Mudar123@';

function getAppUrl() {
  return getMemberAppUrl();
}

// ==========================================
// EMAIL HELPER (RESEND)
// ==========================================
async function getSetting(prismaClient: PrismaClient, key: string): Promise<string | null> {
  const s = await prismaClient.setting.findUnique({ where: { key } });
  return s?.value || null;
}

async function sendEmail(prismaClient: PrismaClient, to: string, subject: string, html: string) {
  await sendTransactionalEmail(prismaClient, to, subject, html);
}

function normalizeShortLinkSlug(raw: string): string {
  return String(raw || '')
    .trim()
    .replace(/^\/+/, '')
    .replace(/\/+$/, '')
    .replace(/\/+/g, '/')
    .toLowerCase();
}

function detectDeviceType(userAgentRaw: string | undefined): 'mobile' | 'desktop' {
  const ua = String(userAgentRaw || '').toLowerCase();
  return /android|iphone|ipad|ipod|mobile|windows phone|opera mini/.test(ua) ? 'mobile' : 'desktop';
}

function getCountryCodeFromHeaders(req: express.Request): string {
  const v = String(
    req.headers['cf-ipcountry'] ||
      req.headers['x-vercel-ip-country'] ||
      req.headers['cloudfront-viewer-country'] ||
      ''
  )
    .trim()
    .toUpperCase();
  return /^[A-Z]{2}$/.test(v) ? v : '';
}

function getRegionCodeFromHeaders(req: express.Request): string {
  const v = String(
    req.headers['x-vercel-ip-country-region'] ||
      req.headers['cloudfront-viewer-country-region'] ||
      req.headers['cf-region-code'] ||
      ''
  )
    .trim()
    .toUpperCase();
  return v.replace(/[^A-Z0-9_-]/g, '').slice(0, 10);
}

function getClientIp(req: express.Request): string {
  const xff = String(req.headers['x-forwarded-for'] || '').trim();
  if (xff) return xff.split(',')[0].trim().slice(0, 45);
  const ip = String(req.ip || req.socket?.remoteAddress || '').trim();
  return ip.slice(0, 45);
}

function appendTrackingParams(targetUrl: string, utmParamsJson: string | null): string {
  if (!utmParamsJson) return targetUrl;
  try {
    const parsed = JSON.parse(utmParamsJson) as Record<string, unknown>;
    const entries = Object.entries(parsed).filter(([, v]) => String(v || '').trim().length > 0);
    if (!entries.length) return targetUrl;
    const url = new URL(targetUrl);
    for (const [k, v] of entries) url.searchParams.set(k, String(v));
    return url.toString();
  } catch {
    return targetUrl;
  }
}

function applySmartRouting(
  targetUrl: string,
  smartRulesJson: string | null,
  countryCode: string,
  regionCode: string,
  deviceType: 'mobile' | 'desktop'
): string {
  if (!smartRulesJson) return targetUrl;
  try {
    const rules = JSON.parse(smartRulesJson) as Array<{
      type?: string;
      value?: string;
      region?: string;
      target?: string;
    }>;
    if (!Array.isArray(rules)) return targetUrl;
    for (const rule of rules) {
      const type = String(rule?.type || '').toLowerCase();
      const value = String(rule?.value || '').trim();
      const target = String(rule?.target || '').trim();
      if (!type || !value || !target) continue;
      if (type === 'device' && value.toLowerCase() === deviceType) return target;
      if (type === 'geo' && countryCode) {
        const countries = value
          .toUpperCase()
          .split(',')
          .map((x) => x.trim())
          .filter(Boolean);
        if (!countries.includes(countryCode)) continue;
        const requiredRegion = String(rule?.region || '').trim().toUpperCase();
        if (requiredRegion && requiredRegion !== regionCode) continue;
        return target;
      }
    }
    return targetUrl;
  } catch {
    return targetUrl;
  }
}

// ES Modules directory name polyfill
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const prisma = new PrismaClient();
const PORT = Number(process.env.PORT || 3000);

app.set('trust proxy', 1);
app.use(cors());
app.use(express.json({ limit: '2mb' }));

registerForexRoutes(app, prisma);
registerMemberApiRoutes(app, prisma);
registerEadAndTrialRoutes(app, prisma);
startScheduledJobs(prisma);

// ==========================================
// FILE UPLOADS (MULTER)
// ==========================================
let uploadDir: string;
try {
  uploadDir = resolveUploadDirectory(path.join(__dirname, '../uploads'));
  console.log(`[Uploads] Diretório: ${uploadDir}`);
} catch (e) {
  console.error('[Uploads] Falha ao preparar pasta:', e);
  throw e;
}

const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, uploadDir);
  },
  filename: (req, file, cb) => {
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1e9);
    const safeName = safeUploadFilename(file.originalname || 'arquivo', file.mimetype);
    cb(null, `${uniqueSuffix}-${safeName}`);
  },
});
const upload = multer({
  storage,
  limits: { fileSize: 80 * 1024 * 1024 },
});

function respondMediaUploadError(err: unknown, res: express.Response): boolean {
  if (!err) return false;
  const code = (err as { code?: string }).code;
  if (code === 'LIMIT_FILE_SIZE') {
    res.status(413).json({ error: 'Arquivo muito grande (máx. 80 MB).' });
    return true;
  }
  if (err instanceof multer.MulterError) {
    res.status(400).json({ error: `Falha no upload: ${err.message}` });
    return true;
  }
  if (err) {
    console.error('[Upload]', err);
    res.status(500).json({ error: 'Falha ao processar o arquivo enviado.' });
    return true;
  }
  return false;
}

function mediaAssetPublicFileUrl(id: string): string {
  return `/api/public/media/${id}/file`;
}

function resolveMediaAssetFilePath(storedName: string): string | null {
  const filePath = path.join(uploadDir, path.basename(String(storedName || '')));
  if (!filePath || !fs.existsSync(filePath)) return null;
  return filePath;
}

// Serve uploaded files publicly (quando o proxy encaminha /uploads ao Node)
app.use('/uploads', express.static(uploadDir));

// ==========================================
// PUBLIC API ROUTES
// ==========================================
app.get('/api/health', (req, res) => {
  const uploads = assertUploadDirectoryWritable(uploadDir);
  res.json({
    status: 'Platform API is active',
    time: new Date(),
    uploadDir,
    uploadsWritable: uploads.ok,
    uploadError: uploads.ok ? null : uploads.error,
  });
});

app.get('/api/public/contents', async (req, res) => {
  try {
    const contents = await prisma.content.findMany({ 
      where: { isBonus: false },
      orderBy: { createdAt: 'desc' },
      include: { category: true }
    });
    res.json(contents);
  } catch (error) {
    res.status(500).json({ error: 'Failed' });
  }
});

/** Banner fixo da home (área do membro): fundo + selo opcionais via admin (Setting). */
app.get('/api/public/member-hero', async (_req, res) => {
  try {
    let backgroundUrl = (await getSetting(prisma, 'member_hero_background_url'))?.trim() || null;
    const kicker = (await getSetting(prisma, 'member_hero_kicker'))?.trim() || null;
    const supportUrl = (await getSetting(prisma, 'member_support_url'))?.trim() || null;
    if (!backgroundUrl) {
      const c = await prisma.course.findFirst({
        where: { published: true, coverUrl: { not: null } },
        orderBy: [{ sortOrder: 'asc' }, { createdAt: 'desc' }],
        select: { coverUrl: true },
      });
      const u = c?.coverUrl?.trim();
      backgroundUrl = u && u.length > 0 ? u : null;
    }
    res.json({ backgroundUrl: backgroundUrl || null, kicker: kicker || null, supportUrl: supportUrl || null });
  } catch {
    res.status(500).json({ error: 'Failed' });
  }
});

app.get('/api/public/member-theme', async (_req, res) => {
  try {
    const payload: Record<string, string> = {};
    for (const key of MEMBER_THEME_KEYS) {
      const value = (await getSetting(prisma, key))?.trim();
      payload[key] = value || MEMBER_THEME_DEFAULTS[key];
    }
    res.json(payload);
  } catch {
    res.status(500).json({ error: 'Failed' });
  }
});

app.get('/api/public/pages/:slug', async (req, res) => {
  try {
    const desired = normalizeBuilderSlug(String(req.params.slug || ''));
    if (!desired) {
      res.status(400).type('text/plain; charset=utf-8').send('Slug inválida.');
      return;
    }

    const pages = await loadBuilderPages(prisma);
    const page = findBuilderPageBySlug(pages, desired);
    if (!page?.html?.trim()) {
      res.status(404).type('text/plain; charset=utf-8').send('Página não encontrada.');
      return;
    }

    if (!isBuilderPagePublished(page)) {
      res.status(403).type('text/plain; charset=utf-8').send('Página em rascunho. Publique para liberar a URL.');
      return;
    }

    res.status(200).type('text/html; charset=utf-8').send(enhanceBuilderPageHtml(page.html, page.slug));
  } catch {
    res.status(500).type('text/plain; charset=utf-8').send('Erro ao carregar página.');
  }
});

app.get('/api/public/links/resolve', async (req, res) => {
  try {
    const slug = normalizeShortLinkSlug(String(req.query?.slug || ''));
    if (!slug) return res.status(400).json({ error: 'Slug obrigatória.' });

    const link = await prisma.shortLink.findUnique({ where: { slug } });
    if (!link || !link.isActive) return res.status(404).json({ found: false });

    const countryCode = getCountryCodeFromHeaders(req);
    const regionCode = getRegionCodeFromHeaders(req);
    const deviceType = detectDeviceType(req.headers['user-agent']);
    const ipAddress = getClientIp(req);
    const referrer = String(req.headers.referer || '').trim().slice(0, 255);

    let target = String(link.targetUrl || '').trim();
    if (!target) return res.status(404).json({ found: false });

    target = applySmartRouting(target, link.smartRules, countryCode, regionCode, deviceType);
    target = appendTrackingParams(target, link.utmParams);

    await prisma.shortLinkClick
      .create({
        data: {
          linkId: link.id,
          ipAddress,
          countryCode,
          regionCode,
          deviceType,
          referrer
        }
      })
      .catch(() => {});

    const status = [301, 302, 307, 308].includes(link.redirectType) ? link.redirectType : 302;
    res.json({ found: true, targetUrl: target, status });
  } catch {
    res.status(500).json({ error: 'Falha ao resolver link.' });
  }
});

/** Exibe o arquivo no navegador (imagem/vídeo/áudio) — rota /api evita cair no SPA da home. */
app.get('/api/public/media/:id/file', async (req, res) => {
  try {
    const id = String(req.params.id || '').trim();
    if (!id) return res.status(400).json({ error: 'ID inválido.' });
    const media = await prisma.mediaAsset.findUnique({ where: { id } });
    if (!media) return res.status(404).json({ error: 'Arquivo não encontrado.' });

    const filePath = resolveMediaAssetFilePath(media.storedName);
    if (!filePath) return res.status(404).json({ error: 'Arquivo não encontrado no servidor.' });

    res.type(resolveStoredMediaMime(media.mimeType, media.storedName));
    res.setHeader('Cache-Control', 'public, max-age=86400');
    return res.sendFile(filePath);
  } catch {
    return res.status(500).json({ error: 'Falha ao abrir arquivo.' });
  }
});

app.get('/api/public/media/:id/download', async (req, res) => {
  try {
    const id = String(req.params.id || '').trim();
    if (!id) return res.status(400).json({ error: 'ID inválido.' });
    const media = await prisma.mediaAsset.findUnique({ where: { id } });
    if (!media) return res.status(404).json({ error: 'Arquivo não encontrado.' });

    const filePath = resolveMediaAssetFilePath(media.storedName);
    if (!filePath) return res.status(404).json({ error: 'Arquivo não encontrado no servidor.' });

    res.type(resolveStoredMediaMime(media.mimeType, media.storedName));
    return res.download(filePath, media.originalName || media.storedName);
  } catch {
    return res.status(500).json({ error: 'Falha ao baixar arquivo.' });
  }
});

// ==========================================
// USER AUTHENTICATION & ACCESS ROUTES
// ==========================================
app.post('/api/auth/login', async (req, res) => {
  try {
    const { email, password } = req.body;
    let user = await prisma.user.findUnique({ where: { email: String(email || '').toLowerCase().trim() } });
    
    // First-Time Login Logic: If user exists from Hotmart but has no password yet
    if (user && !user.password) {
      user = await prisma.user.update({
        where: { id: user.id },
        data: { password: hashMemberPassword(String(password || '')) },
      });
      const ok = await userHasMemberAccess(prisma, user.id);
      if (!ok) {
        return res.status(401).json({ error: 'Sem acesso ativo: é necessário compra ou licença ativa.' });
      }
      const token = signUserToken(user.id, user.email);
      return res.json({ id: user.id, email: user.email, name: user.name, token });
    }
    
    // Validate Existing User (texto puro legado ou hash WordPress)
    if (user && verifyUserPassword(String(password || ''), user.password)) {
      const ok = await userHasMemberAccess(prisma, user.id);
      if (!ok) {
        return res.status(401).json({ error: 'Sem acesso ativo: é necessário compra ou licença ativa.' });
      }
      const token = signUserToken(user.id, user.email);
      return res.json({ id: user.id, email: user.email, name: user.name, token });
    }
    
    return res.status(401).json({ error: 'E-mail ou senha incorretos. Acesso negado. Apenas usuários que já efetuaram uma compra podem acessar.' });
  } catch (err) {
    res.status(500).json({ error: 'Server Error' });
  }
});

// ==========================================
// FORGOT PASSWORD & RESET
// ==========================================
app.post('/api/auth/forgot-password', async (req, res) => {
  try {
    const { email } = req.body;
    if (!email) return res.status(400).json({ error: 'Email is required' });

    const user = await prisma.user.findUnique({ where: { email: email.toLowerCase().trim() } });
    // Always return success to prevent email enumeration
    if (!user) return res.json({ success: true });

    // Generate reset token (valid for 1 hour)
    const token = crypto.randomBytes(32).toString('hex');
    const expires = Date.now() + 3600000; // 1 hour
    await prisma.setting.upsert({
      where: { key: `reset_token_${user.id}` },
      update: { value: `${token}|${expires}` },
      create: { key: `reset_token_${user.id}`, value: `${token}|${expires}` }
    });

    // Send reset email
    const lang = detectLang(user.country);
    const emailLang: EmailLang = lang === 'es' ? 'es' : 'pt';
    const templateKey = emailLang === 'es' ? 'reset_template_es' : 'reset_template_pt';
    const stored = await getSetting(prisma, templateKey);
    const bodyPlain = emailBodyFromStored(stored, DEFAULT_RESET_BODY_PT);

    const appUrl = getAppUrl();
    const resetLink = `${appUrl}?reset_token=${token}&user_id=${user.id}`;

    const html = applyEmailPlaceholders(buildResetEmailHtml(bodyPlain, emailLang), {
      name: user.name || (emailLang === 'es' ? 'Usuario' : 'Usuário'),
      email: user.email,
      country: user.country || '-',
      reset_link: resetLink,
    });

    const subject = lang === 'es' ? 'Recuperación de contraseña - Autofintech' : 'Recuperação de senha - Autofintech';
    await sendEmail(prisma, user.email, subject, html);

    res.json({ success: true });
  } catch (err) {
    console.error('[Forgot Password Error]', err);
    res.status(500).json({ error: 'Server Error' });
  }
});

app.post('/api/auth/reset-password', async (req, res) => {
  try {
    const { token, userId, newPassword } = req.body;
    if (!token || !userId || !newPassword) return res.status(400).json({ error: 'Missing fields' });

    const setting = await prisma.setting.findUnique({ where: { key: `reset_token_${userId}` } });
    if (!setting) return res.status(400).json({ error: 'Token inválido ou expirado.' });

    const [savedToken, expiresStr] = setting.value.split('|');
    if (savedToken !== token || Date.now() > parseInt(expiresStr)) {
      await prisma.setting.delete({ where: { key: `reset_token_${userId}` } }).catch(() => {});
      return res.status(400).json({ error: 'Token inválido ou expirado.' });
    }

    await prisma.user.update({
      where: { id: userId },
      data: { password: hashMemberPassword(String(newPassword || '')) },
    });
    await prisma.setting.delete({ where: { key: `reset_token_${userId}` } }).catch(() => {});

    res.json({ success: true });
  } catch (err) {
    console.error('[Reset Password Error]', err);
    res.status(500).json({ error: 'Server Error' });
  }
});

app.get('/api/contents/my', async (req, res) => {
  try {
    const userId = resolveUserId(req);
    if (!userId) return res.status(401).json({ error: 'Unauthorized' });

    const purchases = await prisma.purchase.findMany({
      where: { userId },
      include: { content: true }
    });

    const myBooks = purchases.map(p => ({
      ...p.content,
      lastReadAt: p.lastReadAt,
      lastPage: p.lastPage
    }));
    res.json(myBooks);
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch your library' });
  }
});

// PROFILE
app.get('/api/profile', async (req, res) => {
  try {
    const userId = resolveUserId(req);
    if (!userId) return res.status(401).json({ error: 'Unauthorized' });
    const user = await prisma.user.findUnique({ where: { id: userId }, select: { id: true, email: true, name: true, country: true } });
    if (!user) return res.status(404).json({ error: 'User not found' });
    res.json(user);
  } catch (error) { res.status(500).json({ error: 'Failed' }); }
});

app.put('/api/profile', async (req, res) => {
  try {
    const userId = resolveUserId(req);
    if (!userId) return res.status(401).json({ error: 'Unauthorized' });
    const { name } = req.body;
    const user = await prisma.user.update({ where: { id: userId }, data: { name } });
    res.json({ id: user.id, email: user.email, name: user.name });
  } catch (error) { res.status(500).json({ error: 'Failed to update profile' }); }
});

app.put('/api/profile/password', async (req, res) => {
  try {
    const userId = resolveUserId(req);
    if (!userId) return res.status(401).json({ error: 'Unauthorized' });
    const { currentPassword, newPassword } = req.body;
    const user = await prisma.user.findUnique({ where: { id: userId } });
    if (!user || !verifyUserPassword(String(currentPassword || ''), user.password)) {
      return res.status(400).json({ error: 'Senha atual incorreta.' });
    }
    await prisma.user.update({
      where: { id: userId },
      data: { password: hashMemberPassword(String(newPassword || '')) },
    });
    res.json({ success: true });
  } catch (error) { res.status(500).json({ error: 'Failed' }); }
});

// READING PROGRESS
app.post('/api/reading-progress', async (req, res) => {
  try {
    const userId = resolveUserId(req);
    if (!userId) return res.status(401).json({ error: 'Unauthorized' });
    const { contentId, page } = req.body;
    await prisma.purchase.updateMany({
      where: { userId, contentId },
      data: { lastReadAt: new Date(), lastPage: page || 1 }
    });
    res.json({ success: true });
  } catch (error) { res.status(500).json({ error: 'Failed' }); }
});

// HIGHLIGHTS
app.get('/api/highlights/:contentId', async (req, res) => {
  try {
    const userId = resolveUserId(req);
    if (!userId) return res.status(401).json({ error: 'Unauthorized' });
    const { contentId } = req.params;
    const highlights = await prisma.highlight.findMany({
      where: { userId, contentId },
      orderBy: { createdAt: 'asc' }
    });
    res.json(highlights);
  } catch (error) { res.status(500).json({ error: 'Failed' }); }
});

app.post('/api/highlights', async (req, res) => {
  try {
    const userId = resolveUserId(req);
    if (!userId) return res.status(401).json({ error: 'Unauthorized' });
    const { contentId, pageNumber, text, color } = req.body;
    const highlight = await prisma.highlight.create({
      data: { userId, contentId, pageNumber, text, color: color || 'yellow' }
    });
    res.json(highlight);
  } catch (error) { res.status(500).json({ error: 'Failed' }); }
});

app.delete('/api/highlights/:id', async (req, res) => {
  try {
    const userId = resolveUserId(req);
    if (!userId) return res.status(401).json({ error: 'Unauthorized' });
    await prisma.highlight.delete({ where: { id: req.params.id } });
    res.json({ success: true });
  } catch (error) { res.status(500).json({ error: 'Failed' }); }
});

// WISHLIST (synced across devices)
app.get('/api/wishlist', async (req, res) => {
  try {
    const userId = resolveUserId(req);
    if (!userId) return res.status(401).json({ error: 'Unauthorized' });
    const items = await prisma.wishlist.findMany({ where: { userId }, select: { contentId: true } });
    res.json(items.map(i => i.contentId));
  } catch (error) {
    res.status(500).json({ error: 'Failed' });
  }
});

app.post('/api/wishlist/toggle', async (req, res) => {
  try {
    const userId = resolveUserId(req);
    if (!userId) return res.status(401).json({ error: 'Unauthorized' });
    const { contentId } = req.body;
    
    const existing = await prisma.wishlist.findUnique({ where: { userId_contentId: { userId, contentId } } });
    if (existing) {
      await prisma.wishlist.delete({ where: { id: existing.id } });
      return res.json({ wishlisted: false });
    } else {
      await prisma.wishlist.create({ data: { userId, contentId } });
      return res.json({ wishlisted: true });
    }
  } catch (error) {
    res.status(500).json({ error: 'Failed to toggle wishlist' });
  }
});

app.get('/api/contents', async (req, res) => {
  try {
    const contents = await prisma.content.findMany({ 
      orderBy: { createdAt: 'desc' },
      include: {
        category: true,
        _count: { select: { purchases: true } }
      }
    });
    res.json(contents);
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch catalog' });
  }
});

// Webhook unificado Hotmart — cria usuário + ativa licença + concede acesso ao conteúdo
app.post('/api/webhooks/hotmart', async (req, res) => {
  try {
    const auth = await validateHotmartWebhookAuth(prisma, req);
    if (!auth.ok) {
      await prisma.webhookLog.create({
        data: { event: 'AUTH_FAILED', status: 'rejected', details: auth.reason }
      });
      return res.status(401).json({ error: auth.reason });
    }

    const body = req.body;
    const event = body.event || 'UNKNOWN';
    const buyerEmail = body.data?.buyer?.email?.toLowerCase()?.trim();
    const offerCode = String(body.data?.product?.offer_code || body.data?.purchase?.offer?.code || body.data?.product?.id || '').trim();

    console.log(`[Hotmart Webhook Unificado] Event: ${event}, Buyer: ${buyerEmail}, Offer: ${offerCode}`);

    const raw = JSON.stringify(body);
    const logRow = await createLicenseWebhookRawLog(prisma, raw, false);

    const result = await processLicenseWebhook(prisma, body as Record<string, unknown>);
    await prisma.licenseWebhookRawLog.update({ where: { id: logRow.id }, data: { processed: true } });

    await prisma.webhookLog.create({
      data: { event, buyerEmail, productId: offerCode, status: result.ok ? 'success' : 'error', details: result.message }
    });

    return res.status(result.status).json({ status: result.ok ? 'success' : 'error', message: result.message });
  } catch (error) {
    const details = formatPrismaError(error);
    console.error('[Hotmart Webhook Error]', details, error);
    const body = (req.body || {}) as {
      event?: string;
      data?: {
        buyer?: { email?: string };
        product?: { offer_code?: string | number };
        purchase?: { offer?: { code?: string } };
      };
    };
    const event = body.event || 'SYSTEM_ERROR';
    const buyerEmail = body.data?.buyer?.email?.toLowerCase()?.trim();
    const offerCode = String(
      body.data?.product?.offer_code || body.data?.purchase?.offer?.code || body.data?.product || ''
    ).trim() || undefined;

    await prisma.webhookLog
      .create({
        data: {
          event,
          buyerEmail,
          productId: offerCode,
          status: 'error',
          details: `SYSTEM: ${details}`
        }
      })
      .catch(() => {});
    return res.status(200).json({ status: 'Internal error logged', error: details });
  }
});

// ==========================================
// ADMIN — login por JSON (evita header bloqueado / proxy)
// ==========================================
app.post('/api/admin/login', (req, res) => {
  try {
    const email = String(req.body?.email ?? '');
    const password = String(req.body?.password ?? '');
    if (!email.trim() || !password) {
      return res.status(400).json({ error: 'Informe e-mail e senha.' });
    }
    if (!validateAdminCredentials(email, password)) {
      return res.status(401).json({ error: 'E-mail ou senha incorretos.' });
    }
    res.json({ token: signAdminJwt() });
  } catch {
    res.status(500).json({ error: 'Server error' });
  }
});

// ==========================================
// ADMIN DASHBOARD ROUTES
// ==========================================
registerAdminForexRoutes(app, prisma, adminAuthMiddleware);

app.get('/api/admin/categories', adminAuthMiddleware, async (req, res) => {
  try {
    const cats = await prisma.category.findMany({ orderBy: { name: 'asc' } });
    res.json(cats);
  } catch (error) {
    res.status(500).json({ error: 'Failed' });
  }
});

app.post('/api/admin/categories', adminAuthMiddleware, async (req, res) => {
  try {
    const { name } = req.body;
    const cat = await prisma.category.create({ data: { name } });
    res.json(cat);
  } catch (error) {
    res.status(500).json({ error: 'Failed to create Category' });
  }
});

app.post('/api/admin/upload', adminAuthMiddleware, upload.single('file'), (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'No file uploaded' });
  const fileUrl = `/uploads/${req.file.filename}`;
  res.json({ url: fileUrl });
});

async function resolveMediaFolderId(raw: unknown): Promise<string | null | 'invalid'> {
  const value = String(raw ?? '').trim();
  if (!value) return null;
  const folder = await prisma.mediaFolder.findUnique({ where: { id: value } });
  return folder ? folder.id : 'invalid';
}

app.get('/api/admin/media-folders', adminAuthMiddleware, async (_req, res) => {
  try {
    const rows = await prisma.mediaFolder.findMany({
      orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
      include: { _count: { select: { assets: true } } },
    });
    res.json(rows);
  } catch {
    res.status(500).json({ error: 'Falha ao listar pastas.' });
  }
});

app.post('/api/admin/media-folders', adminAuthMiddleware, async (req, res) => {
  try {
    const name = String(req.body?.name ?? '').trim();
    if (!name) return res.status(400).json({ error: 'Informe o nome da pasta.' });
    const created = await prisma.mediaFolder.create({ data: { name } });
    res.json(created);
  } catch {
    res.status(500).json({ error: 'Falha ao criar pasta.' });
  }
});

app.put('/api/admin/media-folders/:id', adminAuthMiddleware, async (req, res) => {
  try {
    const id = String(req.params.id || '').trim();
    if (!id) return res.status(400).json({ error: 'ID inválido.' });
    const name = String(req.body?.name ?? '').trim();
    if (!name) return res.status(400).json({ error: 'Informe o nome da pasta.' });
    const updated = await prisma.mediaFolder.update({
      where: { id },
      data: { name },
    });
    res.json(updated);
  } catch {
    res.status(500).json({ error: 'Falha ao renomear pasta.' });
  }
});

app.delete('/api/admin/media-folders/:id', adminAuthMiddleware, async (req, res) => {
  try {
    const id = String(req.params.id || '').trim();
    if (!id) return res.status(400).json({ error: 'ID inválido.' });
    const folder = await prisma.mediaFolder.findUnique({ where: { id } });
    if (!folder) return res.status(404).json({ error: 'Pasta não encontrada.' });
    await prisma.mediaAsset.updateMany({ where: { folderId: id }, data: { folderId: null } });
    await prisma.mediaFolder.delete({ where: { id } });
    res.json({ success: true });
  } catch {
    res.status(500).json({ error: 'Falha ao excluir pasta.' });
  }
});

app.get('/api/admin/media', adminAuthMiddleware, async (_req, res) => {
  try {
    const rows = await prisma.mediaAsset.findMany({
      orderBy: { createdAt: 'desc' },
      include: { folder: { select: { id: true, name: true } } },
    });
    res.json(rows);
  } catch {
    res.status(500).json({ error: 'Falha ao listar mídias.' });
  }
});

app.post('/api/admin/media', adminAuthMiddleware, (req, res, next) => {
  upload.single('file')(req, res, (err) => {
    if (respondMediaUploadError(err, res)) return;
    next();
  });
}, async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'Nenhum arquivo enviado.' });

    let folderId = await resolveMediaFolderId(req.body?.folderId);
    if (folderId === 'invalid') return res.status(400).json({ error: 'Pasta inválida.' });

    const originalName = decodeUploadOriginalName(req.file.originalname || req.file.filename);
    const mimeType = resolveUploadMime(req.file.mimetype, originalName);
    const kind = detectMediaKind(req.file.mimetype, originalName);
    const assetId = crypto.randomUUID();
    const publicUrl = mediaAssetPublicFileUrl(assetId);

    const createData = {
      id: assetId,
      originalName,
      storedName: String(req.file.filename),
      url: publicUrl,
      mimeType,
      kind,
      sizeBytes: Number(req.file.size || 0),
      folderId,
    };

    let saved;
    try {
      saved = await prisma.mediaAsset.create({
        data: createData,
        include: { folder: { select: { id: true, name: true } } },
      });
    } catch (firstErr) {
      const code = (firstErr as { code?: string })?.code;
      if (code === 'P2003' && folderId) {
        saved = await prisma.mediaAsset.create({
          data: { ...createData, folderId: null },
          include: { folder: { select: { id: true, name: true } } },
        });
      } else {
        throw firstErr;
      }
    }

    res.json(saved);
  } catch (err) {
    console.error('[Media upload]', err);
    if (req.file?.filename) {
      const orphan = path.join(uploadDir, path.basename(req.file.filename));
      fs.unlink(orphan, () => {});
    }
    res.status(500).json({ error: formatMediaUploadError(err) });
  }
});

app.patch('/api/admin/media/:id', adminAuthMiddleware, async (req, res) => {
  try {
    const id = String(req.params.id || '').trim();
    if (!id) return res.status(400).json({ error: 'ID inválido.' });
    if (!Object.prototype.hasOwnProperty.call(req.body || {}, 'folderId')) {
      return res.status(400).json({ error: 'Informe folderId para mover o arquivo.' });
    }
    const folderId = await resolveMediaFolderId(req.body.folderId);
    if (folderId === 'invalid') return res.status(400).json({ error: 'Pasta inválida.' });
    const row = await prisma.mediaAsset.findUnique({ where: { id } });
    if (!row) return res.status(404).json({ error: 'Mídia não encontrada.' });
    const saved = await prisma.mediaAsset.update({
      where: { id },
      data: { folderId },
      include: { folder: { select: { id: true, name: true } } },
    });
    res.json(saved);
  } catch {
    res.status(500).json({ error: 'Falha ao mover mídia.' });
  }
});

app.delete('/api/admin/media/:id', adminAuthMiddleware, async (req, res) => {
  try {
    const id = String(req.params.id || '').trim();
    if (!id) return res.status(400).json({ error: 'ID inválido.' });
    const row = await prisma.mediaAsset.findUnique({ where: { id } });
    if (!row) return res.status(404).json({ error: 'Mídia não encontrada.' });

    const filePath = path.join(uploadDir, path.basename(row.storedName));
    if (fs.existsSync(filePath)) {
      try {
        fs.unlinkSync(filePath);
      } catch {
        // Se não conseguir deletar no disco, seguimos removendo o registro.
      }
    }

    await prisma.mediaAsset.delete({ where: { id } });
    res.json({ success: true });
  } catch {
    res.status(500).json({ error: 'Falha ao remover mídia.' });
  }
});

// -- USER & ACCESS MANAGEMENT --
app.get('/api/admin/users', adminAuthMiddleware, async (req, res) => {
  try {
    const users = await prisma.user.findMany({
      orderBy: { createdAt: 'desc' },
      include: {
        purchases: { include: { content: true } }
      }
    });
    res.json(users);
  } catch (error) {
    res.status(500).json({ error: 'Failed' });
  }
});

app.post('/api/admin/users', adminAuthMiddleware, async (req, res) => {
  try {
    const { email, name } = req.body;
    const pwd = String(req.body.password || '').trim() || DEFAULT_PASSWORD;
    const user = await prisma.user.create({
      data: {
        email,
        password: hashMemberPassword(pwd),
        name: name != null && String(name).trim() ? String(name).trim() : null
      }
    });
    // Cadastro manual: enviar boas-vindas também (como no webhook).
    // Não bloqueia a resposta do admin caso o provedor de e-mail falhe.
    sendWelcomeEmail(prisma, String(email || '').toLowerCase().trim(), user.name || null, pwd, null).catch((err) =>
      console.error('[Email] boas-vindas (admin) falhou:', err)
    );
    res.json(user);
  } catch(error) {
    res.status(400).json({ error: 'Erro. Talvez e-mail já exista.' });
  }
});

app.post('/api/admin/purchases', adminAuthMiddleware, async (req, res) => {
  try {
    const { userId, contentId } = req.body;
    const purchase = await prisma.purchase.create({ data: { userId, contentId } });
    res.json(purchase);
  } catch (error) {
    res.status(400).json({ error: 'Falha ao conceder acesso ou o usuário já o possui.' });
  }
});

app.delete('/api/admin/purchases/:userId/:contentId', adminAuthMiddleware, async (req, res) => {
  try {
    const userId = String(req.params.userId);
    const contentId = String(req.params.contentId);
    await prisma.purchase.deleteMany({ where: { userId, contentId } });
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: 'Falha ao revogar acesso' });
  }
});

app.delete('/api/admin/users/:id', adminAuthMiddleware, async (req, res) => {
  try {
    const id = String(req.params.id);
    const user = await prisma.user.findUnique({ where: { id }, select: { email: true } });
    if (!user) return res.status(404).json({ error: 'Usuário não encontrado.' });

    // Cleanup user relations first
    await prisma.purchase.deleteMany({ where: { userId: id } });
    await prisma.wishlist.deleteMany({ where: { userId: id } });
    await prisma.highlight.deleteMany({ where: { userId: id } });
    await prisma.license.deleteMany({
      where: { email: String(user.email).toLowerCase().trim() },
    });

    // Delete user
    await prisma.user.delete({ where: { id } });
    
    res.json({ success: true });
  } catch (error) {
    console.error('Failed to delete user:', error);
    res.status(500).json({ error: 'Falha ao excluir usuário. Verifique logs.' });
  }
});
// -----------------------------

// -- WEBHOOK LOGS --
app.get('/api/admin/webhook-urls', adminAuthMiddleware, (_req, res) => {
  res.json(getWebhookUrls());
});

app.get('/api/admin/webhook-logs', adminAuthMiddleware, async (req, res) => {
  try {
    const logs = await prisma.webhookLog.findMany({
      orderBy: { createdAt: 'desc' },
      take: 50
    });
    res.json(logs);
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch webhook logs' });
  }
});

app.delete('/api/admin/webhook-logs', adminAuthMiddleware, async (req, res) => {
  try {
    await prisma.webhookLog.deleteMany({});
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: 'Failed to clear logs' });
  }
});

// -- EMAIL SETTINGS --
app.get('/api/admin/settings', adminAuthMiddleware, async (req, res) => {
  try {
    const settings = await prisma.setting.findMany({
      where: { key: { notIn: (await prisma.setting.findMany({ where: { key: { startsWith: 'reset_token_' } } })).map(s => s.key) } }
    });
    // Mask the API key for security
    const result: Record<string, string> = {};
    for (const s of settings) {
      if (s.key === 'resend_api_key' && s.value) {
        result[s.key] = '••••••••' + s.value.slice(-4);
      } else {
        result[s.key] = s.value;
      }
    }
    res.json(result);
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch settings' });
  }
});

app.post('/api/admin/email-settings', adminAuthMiddleware, async (req, res) => {
  try {
    const body = req.body as Record<string, string>;
    const allowed = [
      'resend_api_key',
      'sender_name',
      'sender_email',
      'welcome_template_pt',
      'reset_template_pt',
      'welcome_template_es',
      'reset_template_es',
    ] as const;
    for (const key of allowed) {
      if (!Object.prototype.hasOwnProperty.call(body, key)) continue;
      let value = String(body[key] ?? '');
      if (key === 'resend_api_key' && value.startsWith('••')) continue;
      if (key === 'sender_email') {
        const email = value.trim();
        if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
          return res.status(400).json({ error: 'E-mail do remetente inválido. Verifique o domínio (ex.: contato@seudominio.com).' });
        }
        value = email;
      }
      await prisma.setting.upsert({
        where: { key },
        update: { value },
        create: { key, value },
      });
    }
    res.json({ success: true });
  } catch (error) {
    console.error('[Email settings save]', error);
    res.status(500).json({ error: 'Falha ao salvar configurações de e-mail.' });
  }
});

app.post('/api/admin/email-settings/test', adminAuthMiddleware, async (req, res) => {
  try {
    const to = String((req.body as { to?: string })?.to || '').trim().toLowerCase();
    if (!to || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(to)) {
      return res.status(400).json({ error: 'Informe um e-mail de destino válido para o teste.' });
    }

    const appUrl = getAppUrl();
    const html = `<p style="font-family:sans-serif;font-size:15px;color:#334155;">
      Este é um e-mail de teste da área de membros Autofintech.<br><br>
      <strong>Destinatário configurado:</strong> ${to}<br>
      Se você recebeu esta mensagem nesta caixa de entrada, o envio para compradores está funcionando.
    </p>
    <p style="font-family:sans-serif;font-size:13px;color:#64748b;">
      App: <a href="${appUrl}">${appUrl}</a>
    </p>`;

    const result = await sendTransactionalEmail(
      prisma,
      to,
      'Teste de e-mail — Autofintech Área de Membros',
      html
    );

    if (!result.ok) {
      return res.status(result.skipped ? 503 : 502).json({
        error: result.error,
        to: result.to,
        from: result.from || undefined,
      });
    }

    res.json({
      success: true,
      message: `E-mail de teste enviado para ${result.to}.`,
      to: result.to,
      from: result.from,
      messageId: result.messageId,
    });
  } catch (error) {
    console.error('[Email test]', error);
    res.status(500).json({ error: 'Falha ao enviar e-mail de teste.' });
  }
});

app.post('/api/admin/settings', adminAuthMiddleware, async (req, res) => {
  try {
    const rawBody = (req.body ?? {}) as Record<string, unknown>;
    const allowShrink = rawBody.__force_page_builder_shrink === true;
    const entries: Record<string, string> = {};
    for (const [k, v] of Object.entries(rawBody)) {
      if (k.startsWith('__')) continue;
      entries[k] = String(v ?? '');
    }
    const colorPattern =
      /^(#[0-9a-fA-F]{3,8}|rgba?\(\s*\d{1,3}\s*,\s*\d{1,3}\s*,\s*\d{1,3}(?:\s*,\s*(?:0|1|0?\.\d+))?\s*\))$/;
    let pageBuilderResult: { saved: number; previous: number; snapshotKey: string | null } | null = null;
    for (const [key, value] of Object.entries(entries)) {
      // Skip masked values (don't overwrite with masked text)
      if (key === 'resend_api_key' && value.startsWith('••')) continue;
      if (key.startsWith('reset_token_')) continue; // Security: don't allow writing reset tokens
      if (key === 'member_hero_background_url') {
        const v = String(value ?? '').trim();
        if (v) {
          const ok = /^https?:\/\//i.test(v) || (v.startsWith('/') && !v.startsWith('//'));
          if (!ok) {
            return res.status(400).json({
              error:
                'member_hero_background_url: use URL vazia, https://…, http://… ou caminho relativo (/api/public/media/…/file ou /uploads/…).'
            });
          }
        }
      }
      if (key === 'member_support_url') {
        const v = String(value ?? '').trim();
        if (v && !/^https?:\/\//i.test(v)) {
          return res.status(400).json({
            error: 'Link de suporte inválido. Use um endereço começando com http:// ou https://.',
          });
        }
      }
      if (MEMBER_THEME_KEYS.includes(key as (typeof MEMBER_THEME_KEYS)[number])) {
        const v = String(value ?? '').trim();
        if (!colorPattern.test(v)) {
          return res.status(400).json({
            error: `${key}: informe uma cor válida em HEX (#RRGGBB) ou RGBA (rgba(...)).`,
          });
        }
      }
      if (key === PAGE_BUILDER_PAGES_KEY) {
        const result = await savePagesWithGuard(prisma, String(value ?? ''), { allowShrink });
        if (!result.ok) {
          if (result.code === 'shrink_blocked') {
            return res.status(409).json({
              error:
                `Bloqueado: tentativa de gravar ${result.saved} página(s) sobrescrevendo ${result.previous} existente(s). ` +
                `Recarregue o admin para sincronizar antes de salvar, ou envie __force_page_builder_shrink=true. ` +
                `Backup automático salvo em ${result.snapshotKey ?? '(nenhum)'}.`,
              code: 'shrink_blocked',
              saved: result.saved,
              previous: result.previous,
              snapshotKey: result.snapshotKey,
            });
          }
          return res.status(400).json({ error: result.message });
        }
        pageBuilderResult = {
          saved: result.saved,
          previous: result.previous,
          snapshotKey: result.snapshotKey,
        };
        continue;
      }
      await prisma.setting.upsert({
        where: { key },
        update: { value },
        create: { key, value }
      });
    }
    res.json({ success: true, pageBuilder: pageBuilderResult });
  } catch (error) {
    console.error('[settings save]', error);
    res.status(500).json({ error: 'Failed to save settings' });
  }
});

app.post('/api/admin/page-builder/reset', adminAuthMiddleware, async (req, res) => {
  try {
    const confirm = String(req.body?.confirm || '');
    if (confirm !== 'APAGAR TUDO') {
      return res.status(400).json({
        error: 'Confirmação ausente. Envie {"confirm":"APAGAR TUDO"} para confirmar.',
      });
    }
    const result = await resetPageBuilder(prisma);
    res.json({ success: true, removed: result.removed });
  } catch (error) {
    console.error('[page-builder reset]', error);
    res.status(500).json({ error: 'Falha ao apagar páginas do construtor.' });
  }
});

app.get('/api/admin/links', adminAuthMiddleware, async (_req, res) => {
  try {
    const links = await prisma.shortLink.findMany({ orderBy: { createdAt: 'desc' } });
    const grouped = await prisma.shortLinkClick.groupBy({
      by: ['linkId'],
      _count: { _all: true }
    });
    const clicksById = new Map<number, number>(grouped.map((g) => [g.linkId, g._count._all]));
    res.json(
      links.map((l) => ({
        ...l,
        clicks: clicksById.get(l.id) || 0
      }))
    );
  } catch {
    res.status(500).json({ error: 'Falha ao listar links.' });
  }
});

app.post('/api/admin/links', adminAuthMiddleware, async (req, res) => {
  try {
    const slug = normalizeShortLinkSlug(String(req.body?.slug || ''));
    const targetUrl = String(req.body?.targetUrl || '').trim();
    if (!slug) return res.status(400).json({ error: 'Slug obrigatória.' });
    if (!targetUrl) return res.status(400).json({ error: 'URL de destino obrigatória.' });
    const redirectTypeRaw = Number(req.body?.redirectType || 301);
    const redirectType = [301, 302, 307, 308].includes(redirectTypeRaw) ? redirectTypeRaw : 301;

    const created = await prisma.shortLink.create({
      data: {
        name: String(req.body?.name || '').trim(),
        slug,
        targetUrl,
        redirectType,
        smartRules: String(req.body?.smartRules || '').trim() || null,
        utmParams: String(req.body?.utmParams || '').trim() || null,
        isActive: req.body?.isActive !== false
      }
    });
    res.json(created);
  } catch (e) {
    res.status(400).json({ error: 'Falha ao criar link. Verifique slug duplicada.' });
  }
});

app.put('/api/admin/links/:id', adminAuthMiddleware, async (req, res) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isFinite(id) || id <= 0) return res.status(400).json({ error: 'ID inválido.' });
    const slug = normalizeShortLinkSlug(String(req.body?.slug || ''));
    const targetUrl = String(req.body?.targetUrl || '').trim();
    if (!slug) return res.status(400).json({ error: 'Slug obrigatória.' });
    if (!targetUrl) return res.status(400).json({ error: 'URL de destino obrigatória.' });
    const redirectTypeRaw = Number(req.body?.redirectType || 301);
    const redirectType = [301, 302, 307, 308].includes(redirectTypeRaw) ? redirectTypeRaw : 301;

    const updated = await prisma.shortLink.update({
      where: { id },
      data: {
        name: String(req.body?.name || '').trim(),
        slug,
        targetUrl,
        redirectType,
        smartRules: String(req.body?.smartRules || '').trim() || null,
        utmParams: String(req.body?.utmParams || '').trim() || null,
        isActive: req.body?.isActive !== false
      }
    });
    res.json(updated);
  } catch {
    res.status(400).json({ error: 'Falha ao atualizar link.' });
  }
});

app.delete('/api/admin/links/:id', adminAuthMiddleware, async (req, res) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isFinite(id) || id <= 0) return res.status(400).json({ error: 'ID inválido.' });
    await prisma.shortLink.delete({ where: { id } });
    res.json({ success: true });
  } catch {
    res.status(400).json({ error: 'Falha ao remover link.' });
  }
});

app.get('/api/admin/contents', adminAuthMiddleware, async (req, res) => {
  try {
    const contents = await prisma.content.findMany({ 
      orderBy: { createdAt: 'desc' },
      include: { category: true }
    });
    res.json(contents);
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch contents' });
  }
});

app.post('/api/admin/contents', adminAuthMiddleware, async (req, res) => {
  try {
    const { title, author, description, coverUrl, pdfUrl, htmlUrl, externalUrl, redirectUrl, salesUrl, hotmartOffer, licenseSystemId, categoryId, featuredList, isBonus, parentContentId, language } = req.body;
    
    const finalOffer = isBonus && !hotmartOffer ? `bonus_${crypto.randomUUID()}` : hotmartOffer;

    const newContent = await prisma.content.create({
      data: { 
        title, 
        author: author || null, 
        description: description || null, 
        coverUrl, 
        pdfUrl: pdfUrl || null, 
        htmlUrl: htmlUrl || null, 
        externalUrl: externalUrl || null,
        redirectUrl: redirectUrl || null,
        salesUrl, 
        hotmartOffer: finalOffer,
        categoryId: categoryId || null, 
        featuredList: featuredList || null,
        isBonus: isBonus || false,
        parentContentId: (isBonus && parentContentId) ? String(parentContentId) : null,
        language: language || 'pt',
        licenseSystemId: licenseSystemId ? String(licenseSystemId).trim() : null
      }
    });

    if (newContent.isBonus && newContent.parentContentId) {
      const parentPurchases = await prisma.purchase.findMany({ where: { contentId: newContent.parentContentId } });
      if (parentPurchases.length > 0) {
        const newPurchases = parentPurchases.map(p => ({ userId: p.userId, contentId: newContent.id }));
        await prisma.purchase.createMany({ data: newPurchases, skipDuplicates: true });
        console.log(`[Bônus] ✅ Distribuído bônus "${newContent.title}" para ${newPurchases.length} clientes do Produto Principal.`);
      }
    }

    res.json(newContent);
  } catch (error) {
    res.status(500).json({ error: 'Failed to create content' });
  }
});

app.put('/api/admin/contents/:id', adminAuthMiddleware, async (req, res) => {
  try {
    const { id } = req.params;
    const { title, author, description, coverUrl, pdfUrl, htmlUrl, externalUrl, redirectUrl, salesUrl, hotmartOffer, licenseSystemId, categoryId, featuredList, isBonus, parentContentId, language } = req.body;
    const currentContent = await prisma.content.findUnique({ where: { id: String(id) } });

    const finalOffer = isBonus && !hotmartOffer ? (currentContent?.hotmartOffer || `bonus_${crypto.randomUUID()}`) : hotmartOffer;

    const updatedContent = await prisma.content.update({
      where: { id: String(id) },
      data: { 
        title, 
        author: author || null, 
        description: description || null, 
        coverUrl, 
        pdfUrl: pdfUrl || null, 
        htmlUrl: htmlUrl || null, 
        externalUrl: externalUrl || null,
        redirectUrl: redirectUrl || null,
        salesUrl, 
        hotmartOffer: finalOffer, 
        categoryId: categoryId || null, 
        featuredList: featuredList || null,
        isBonus: isBonus || false,
        parentContentId: (isBonus && parentContentId) ? String(parentContentId) : null,
        language: language || 'pt',
        licenseSystemId: licenseSystemId !== undefined ? (licenseSystemId ? String(licenseSystemId).trim() : null) : undefined
      }
    });

    if (updatedContent.isBonus && updatedContent.parentContentId) {
      if (!currentContent?.isBonus || currentContent.parentContentId !== updatedContent.parentContentId) {
        const parentPurchases = await prisma.purchase.findMany({ where: { contentId: updatedContent.parentContentId } });
        if (parentPurchases.length > 0) {
          const newPurchases = parentPurchases.map(p => ({ userId: p.userId, contentId: updatedContent.id }));
          await prisma.purchase.createMany({ data: newPurchases, skipDuplicates: true });
          console.log(`[Bônus] ✅ Atualização: Distribuído bônus "${updatedContent.title}" para ${newPurchases.length} clientes do Produto Principal.`);
        }
      }
    }

    res.json(updatedContent);
  } catch (error) {
    res.status(500).json({ error: 'Failed to update content' });
  }
});

app.delete('/api/admin/contents/:id', adminAuthMiddleware, async (req, res) => {
  try {
    const id = String(req.params.id);
    await prisma.content.delete({ where: { id } });
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: 'Failed to delete content' });
  }
});

// ==========================================
// SERVE STATIC PWA
// ==========================================
const distPath = path.join(__dirname, '../dist');
if (fs.existsSync(distPath)) {
  app.use(async (req, res, next) => {
    if (req.method !== 'GET' && req.method !== 'HEAD') return next();
    const slug = normalizeShortLinkSlug(req.path);
    if (!slug) return next();

    // Rotas reservadas da aplicação (não devem ser sequestradas por short links)
    if (
      slug === 'admin' ||
      slug === 'vitrine' ||
      slug === 'catalogo' ||
      slug === 'catálogo' ||
      slug.startsWith('api/') ||
      slug.startsWith('uploads/')
    ) {
      return next();
    }

    const link = await prisma.shortLink.findUnique({ where: { slug } }).catch(() => null);
    if (link?.isActive) {
      const countryCode = getCountryCodeFromHeaders(req);
      const regionCode = getRegionCodeFromHeaders(req);
      const deviceType = detectDeviceType(req.headers['user-agent']);
      const ipAddress = getClientIp(req);
      const referrer = String(req.headers.referer || '').trim().slice(0, 255);

      let target = String(link.targetUrl || '').trim();
      if (!target) return next();

      target = applySmartRouting(target, link.smartRules, countryCode, regionCode, deviceType);
      target = appendTrackingParams(target, link.utmParams);

      await prisma.shortLinkClick
        .create({
          data: {
            linkId: link.id,
            ipAddress,
            countryCode,
            regionCode,
            deviceType,
            referrer
          }
        })
        .catch(() => {});

      const status = [301, 302, 307, 308].includes(link.redirectType) ? link.redirectType : 302;
      return res.redirect(status, target);
    }

    const builderSlug = normalizeBuilderSlug(slug);
    if (builderSlug) {
      const pages = await loadBuilderPages(prisma);
      const page = findBuilderPageBySlug(pages, builderSlug);
      if (page?.html?.trim() && isBuilderPagePublished(page)) {
        return res.status(200).type('text/html; charset=utf-8').send(enhanceBuilderPageHtml(page.html, page.slug));
      }
    }

    return next();
  });

  // /uploads sem arquivo no disco: 404 em texto (não devolver index.html = home)
  app.use('/uploads', (req, res) => {
    if (req.method !== 'GET' && req.method !== 'HEAD') {
      res.status(405).end();
      return;
    }
    const raw = String(req.path || '').replace(/^\/uploads\/?/, '');
    const filename = path.basename(decodeURIComponent(raw));
    if (!filename) {
      res.status(404).type('text/plain; charset=utf-8').send('Arquivo não encontrado.');
      return;
    }
    const filePath = path.join(uploadDir, filename);
    if (!fs.existsSync(filePath)) {
      res.status(404).type('text/plain; charset=utf-8').send('Arquivo não encontrado.');
      return;
    }
    res.type(resolveStoredMediaMime(null, filename));
    res.sendFile(filePath);
  });

  app.use(express.static(distPath));

  // Client side routing fallback
  app.use((req, res) => {
    if (req.path.startsWith('/uploads/')) {
      res.status(404).type('text/plain; charset=utf-8').send('Arquivo não encontrado.');
      return;
    }
    res.sendFile(path.join(distPath, 'index.html'));
  });
} else {
  console.warn(`[WARN] Static directory not found at ${distPath}. Build the frontend first.`);
}

// ==========================================
// SERVER INITIALIZATION
// ==========================================
async function startServer() {
  try {
    const n = await repairAutoincrementSequences(prisma);
    console.log(`[db] Sequences autoincrement verificadas (${n} tabelas).`);
  } catch (e) {
    console.error('[db] repairAutoincrementSequences:', e);
  }

  if (process.env.NODE_ENV !== 'production') {
    try {
      await ensureDevTestAccount(prisma);
      console.log('[Dev] Conta teste garantida: teste@local.dev / TesteLocal123@');
    } catch (e) {
      console.error('[Dev] ensureDevTestAccount:', e);
    }
  }
  const server = http.createServer(app);
  server.requestTimeout = 120_000;
  server.headersTimeout = 125_000;
  server.listen(PORT, '0.0.0.0', () => {
    console.log(`[ContentPro API] Server running on 0.0.0.0:${PORT}`);
  });
}

process.on('unhandledRejection', (reason) => {
  console.error('[unhandledRejection]', reason);
});
process.on('uncaughtException', (err) => {
  console.error('[uncaughtException]', err);
});

void startServer();
