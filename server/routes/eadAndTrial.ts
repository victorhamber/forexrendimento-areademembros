import express from 'express';
import type { PrismaClient } from '@prisma/client';
import { resolveUserId } from '../auth/resolveUser.js';
import { adminAuthMiddleware } from '../middleware/adminAuth.js';
import { normalizeCsv, parseCsv, csvIncludes } from '../lib/csv.js';
import { checkRateLimit } from '../lib/rateLimitMem.js';
import {
  equivalentSystemIds,
  licenseMatchesProduct,
  licenseMatchesSystemGroup,
} from '../lib/licenseProductMatch.js';
import { fireLicenseCreatedNotify } from '../lib/licenseAdminNotification.js';

function sanitizeUrl(raw: unknown): string | null {
  const s = String(raw ?? '').trim();
  if (!s) return null;
  return s.slice(0, 2048);
}

function normalizeProductIdsCsv(raw: unknown): string | null {
  if (raw == null) return null;
  const ids = String(raw)
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
    .map((s) => Number(s))
    .filter((n) => Number.isInteger(n) && n > 0);
  if (!ids.length) return null;
  return Array.from(new Set(ids)).join(',');
}

type CourseLicenseRow = {
  systemId: string | null;
  offerCode: string | null;
  plano: string | null;
};

type CourseProductRow = {
  id: number;
  systemId: string | null;
  offerCode: string | null;
  plano: string | null;
  productName?: string | null;
};

async function loadActiveLicensesForUser(prisma: PrismaClient, userId: string | null): Promise<CourseLicenseRow[]> {
  if (!userId) return [];
  const user = await prisma.user.findUnique({ where: { id: userId } });
  if (!user) return [];
  const now = new Date();
  return prisma.license.findMany({
    where: {
      email: user.email.toLowerCase(),
      statusLicenca: 'ativa',
      OR: [{ dataExpiracao: null }, { dataExpiracao: { gte: now } }],
    },
    select: { systemId: true, offerCode: true, plano: true },
  });
}

function productMatchesSystemRequirement(product: CourseProductRow, requiredSid: string): boolean {
  const group = equivalentSystemIds(requiredSid);
  const prodIds = parseCsv(String(product.systemId || ''));
  if (!prodIds.length) return csvIncludes(String(product.systemId || ''), requiredSid);
  return prodIds.some((pid) => licenseMatchesSystemGroup({ systemId: pid }, group));
}

function computeCourseAccess(
  course: { licenseSystemId: string | null; productIds: string | null },
  activeLicenses: CourseLicenseRow[],
  allProducts: CourseProductRow[]
): { isPublic: boolean; hasAccess: boolean; requiredProductIds: number[]; requiredSystemIds: string[] } {
  const requiredProductIds = (course.productIds || '')
    .split(',')
    .map((s) => Number(s.trim()))
    .filter((n) => Number.isInteger(n) && n > 0);
  const requiredSystemIds = parseCsv(course.licenseSystemId);
  const hasRestrictions = requiredProductIds.length > 0 || requiredSystemIds.length > 0;

  // Sem produto/system_id vinculado: curso fica bloqueado para todos (não é público).
  if (!hasRestrictions) {
    return { isPublic: false, hasAccess: false, requiredProductIds, requiredSystemIds };
  }

  if (!activeLicenses.length) {
    return { isPublic: false, hasAccess: false, requiredProductIds, requiredSystemIds };
  }

  let hasAccess = false;

  if (requiredProductIds.length) {
    const requiredProducts = allProducts.filter((p) => requiredProductIds.includes(p.id));
    hasAccess = requiredProducts.some((product) =>
      activeLicenses.some((lic) => licenseMatchesProduct(lic, product))
    );
  }

  if (!hasAccess && requiredSystemIds.length) {
    const mappedProducts = allProducts.filter((p) =>
      requiredSystemIds.some((sid) => productMatchesSystemRequirement(p, sid))
    );
    if (mappedProducts.length) {
      hasAccess = mappedProducts.some((product) =>
        activeLicenses.some((lic) => licenseMatchesProduct(lic, product))
      );
    } else {
      hasAccess = activeLicenses.some((lic) =>
        requiredSystemIds.some((sid) => licenseMatchesSystemGroup(lic, equivalentSystemIds(sid)))
      );
    }
  }

  return { isPublic: false, hasAccess, requiredProductIds, requiredSystemIds };
}

export function registerEadAndTrialRoutes(app: express.Application, prisma: PrismaClient) {
  const admin = adminAuthMiddleware;

  app.get('/api/public/products', async (_req, res) => {
    const products = await prisma.product.findMany({
      orderBy: { id: 'asc' },
      select: { productName: true, systemId: true, description: true, plano: true }
    });
    res.json(products);
  });

  app.get('/api/public/courses', async (req, res) => {
    const userId = resolveUserId(req);
    const activeLicenses = await loadActiveLicensesForUser(prisma, userId);

    const courses = await prisma.course.findMany({
      where: { published: true },
      orderBy: [{ sortOrder: 'asc' }, { id: 'asc' }],
      include: {
        modules: {
          orderBy: [{ sortOrder: 'asc' }, { id: 'asc' }],
          include: { lessons: { orderBy: [{ sortOrder: 'asc' }, { id: 'asc' }], include: { content: true } } },
        },
      },
    });
    const allProducts = await prisma.product.findMany({
      select: { id: true, systemId: true, offerCode: true, plano: true, productName: true },
    });

    const result = courses.map((c) => {
      const access = computeCourseAccess(c, activeLicenses, allProducts);
      const safeModules = access.hasAccess
        ? c.modules
        : c.modules.map((m) => ({ ...m, lessons: [] as typeof m.lessons }));
      return {
        ...c,
        modules: safeModules,
        ...access,
      };
    });

    res.json(result);
  });

  app.get('/api/public/courses/:slug', async (req, res) => {
    const c = await prisma.course.findFirst({
      where: { slug: req.params.slug, published: true },
      include: {
        modules: {
          orderBy: [{ sortOrder: 'asc' }, { id: 'asc' }],
          include: {
            lessons: {
              orderBy: [{ sortOrder: 'asc' }, { id: 'asc' }],
              include: { content: { select: { id: true, title: true, coverUrl: true } } },
            },
          },
        },
      },
    });
    if (!c) return res.status(404).json({ error: 'Not found' });

    const userId = resolveUserId(req);
    const activeLicenses = await loadActiveLicensesForUser(prisma, userId);
    const allProducts = await prisma.product.findMany({
      select: { id: true, systemId: true, offerCode: true, plano: true, productName: true },
    });
    const access = computeCourseAccess(c, activeLicenses, allProducts);

    if (!access.hasAccess) {
      return res.status(403).json({
        error: 'Acesso negado',
        salesPageUrl: c.salesPageUrl || null,
        memberPageUrl: c.memberPageUrl || null,
        ...access,
      });
    }

    res.json({ ...c, ...access });
  });

  app.get('/api/me/course-progress', async (req, res) => {
    const userId = resolveUserId(req);
    if (!userId) return res.status(401).json({ error: 'Unauthorized' });
    const slug = String(req.query.course || '');
    if (!slug) {
      const prog = await prisma.lessonProgress.findMany({ where: { userId } });
      return res.json({ progress: prog });
    }
    const course = await prisma.course.findFirst({ where: { slug } });
    if (!course) return res.status(404).json({ error: 'Course not found' });
    const lessons = await prisma.courseLesson.findMany({
      where: { module: { courseId: course.id } },
      select: { id: true }
    });
    const ids = lessons.map(l => l.id);
    const prog = await prisma.lessonProgress.findMany({ where: { userId, lessonId: { in: ids } } });
    res.json({ courseId: course.id, progress: prog });
  });

  app.post('/api/me/lesson-progress', async (req, res) => {
    const userId = resolveUserId(req);
    if (!userId) return res.status(401).json({ error: 'Unauthorized' });
    const { lessonId, percent, completed } = req.body as { lessonId?: string; percent?: number; completed?: boolean };
    if (!lessonId) return res.status(400).json({ error: 'lessonId required' });
    const existing = await prisma.lessonProgress.findUnique({
      where: { userId_lessonId: { userId, lessonId } }
    });
    const nextPercent =
      percent != null
        ? Math.min(100, Math.max(existing?.percent ?? 0, Math.max(0, percent)))
        : (existing?.percent ?? 0);
    const nextCompleted = completed != null ? Boolean(completed) : (existing?.completed ?? false);
    const p = await prisma.lessonProgress.upsert({
      where: { userId_lessonId: { userId, lessonId } },
      create: {
        userId,
        lessonId,
        percent: nextPercent,
        completed: nextCompleted
      },
      update: {
        percent: percent != null ? nextPercent : undefined,
        completed: completed != null ? nextCompleted : undefined
      }
    });
    res.json(p);
  });

  app.post('/api/public/trial', async (req, res) => {
    // Sem limite, dá para criar licença de teste em massa e cadastrar contas
    // no e-mail de terceiros. 5 por hora por IP não atrapalha uso legítimo.
    const ip = String(req.ip || req.socket?.remoteAddress || 'unknown').slice(0, 45);
    if (!checkRateLimit(`trial_${ip}`, 5, 60 * 60_000)) {
      return res
        .status(429)
        .json({ error: 'Muitas ativações de teste a partir deste endereço. Tente novamente mais tarde.' });
    }

    const email = String(req.body?.email || '')
      .trim()
      .toLowerCase();
    const name = String(req.body?.name || '').trim();
    const systemId = String(req.body?.systemId || 'TESTE_GRATUITO').trim();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return res.status(400).json({ error: 'Invalid email' });

    const existingLic = await prisma.license.count({ where: { email } });
    if (existingLic > 0) return res.status(400).json({ error: 'E-mail já possui licença.' });

    const trial = await prisma.trialHistory.findUnique({ where: { email_systemId: { email, systemId } } });
    if (trial) return res.status(400).json({ error: 'Trial já utilizado para este produto.' });

    const eventId = `trial_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
    const end = new Date();
    end.setDate(end.getDate() + 10); // 7 dias de trial + 3 dias de tolerância

    const trialLicense = await prisma.license.create({
      data: {
        email,
        buyerName: name || null,
        numeroConta: '',
        eventId,
        plano: 'teste',
        statusLicenca: 'ativa',
        dataExpiracao: end,
        systemId,
        dataAtivacao: new Date()
      }
    });
    fireLicenseCreatedNotify(prisma, trialLicense, 'trial');

    await prisma.trialHistory.create({
      data: {
        email,
        systemId,
        eventId,
        trialEnd: end,
        status: 'active',
        ipAddress: req.socket.remoteAddress || undefined,
        userAgent: String(req.headers['user-agent'] || '').slice(0, 500)
      }
    });

    let user = await prisma.user.findUnique({ where: { email } });
    if (!user) {
      const { hashMemberPassword } = await import('../lib/verifyUserPassword.js');
      user = await prisma.user.create({ data: { email, name: name || null, password: hashMemberPassword('Mudar123@') } });
    }

    const contents = await prisma.content.findMany({ where: { licenseSystemId: systemId } });
    for (const c of contents) {
      try {
        await prisma.purchase.create({ data: { userId: user.id, contentId: c.id } });
      } catch {
        /* */
      }
    }

    res.json({ success: true, message: 'Trial de 7 dias criado.', eventId });
  });

  app.get('/api/admin/courses', admin, async (_req, res) => {
    const courses = await prisma.course.findMany({
      orderBy: [{ sortOrder: 'asc' }, { id: 'asc' }],
      include: {
        modules: {
          orderBy: [{ sortOrder: 'asc' }, { id: 'asc' }],
          include: { lessons: { orderBy: [{ sortOrder: 'asc' }, { id: 'asc' }], include: { content: true } } },
        },
      },
    });
    res.json(courses);
  });

  app.post('/api/admin/courses', admin, async (req, res) => {
    const { title, slug, coverUrl, licenseSystemId, productIds, salesPageUrl, memberPageUrl, published } = req.body as {
      title?: string;
      slug?: string;
      coverUrl?: string | null;
      licenseSystemId?: string | null;
      productIds?: string | null;
      salesPageUrl?: string | null;
      memberPageUrl?: string | null;
      published?: boolean;
    };
    if (!title || !slug) return res.status(400).json({ error: 'title and slug required' });
    const c = await prisma.course.create({
      data: {
        title,
        slug,
        coverUrl: coverUrl || null,
        published: published ?? true,
        licenseSystemId: normalizeCsv(licenseSystemId ?? '') || null,
        productIds: normalizeProductIdsCsv(productIds),
        salesPageUrl: sanitizeUrl(salesPageUrl),
        memberPageUrl: sanitizeUrl(memberPageUrl),
      },
    });
    res.json(c);
  });

  app.put('/api/admin/courses/:id', admin, async (req, res) => {
    const { title, slug, coverUrl, published, sortOrder, licenseSystemId, productIds, salesPageUrl, memberPageUrl } =
      req.body as {
        title?: string;
        slug?: string;
        coverUrl?: string | null;
        published?: boolean;
        sortOrder?: number;
        licenseSystemId?: string | null;
        productIds?: string | null;
        salesPageUrl?: string | null;
        memberPageUrl?: string | null;
      };
    const c = await prisma.course
      .update({
        where: { id: req.params.id },
        data: {
          title: title ?? undefined,
          slug: slug ?? undefined,
          coverUrl: coverUrl === undefined ? undefined : coverUrl,
          published: published ?? undefined,
          sortOrder: sortOrder ?? undefined,
          licenseSystemId:
            licenseSystemId === undefined ? undefined : normalizeCsv(licenseSystemId ?? '') || null,
          productIds: productIds === undefined ? undefined : normalizeProductIdsCsv(productIds),
          salesPageUrl: salesPageUrl === undefined ? undefined : sanitizeUrl(salesPageUrl),
          memberPageUrl: memberPageUrl === undefined ? undefined : sanitizeUrl(memberPageUrl),
        },
      })
      .catch(() => null);
    if (!c) return res.status(404).json({ error: 'Not found' });
    res.json(c);
  });

  app.post('/api/admin/course-modules', admin, async (req, res) => {
    const { courseId, title, sortOrder } = req.body as { courseId?: string; title?: string; sortOrder?: number };
    if (!courseId || !title) return res.status(400).json({ error: 'courseId and title required' });
    const maxSort = await prisma.courseModule.aggregate({
      where: { courseId },
      _max: { sortOrder: true },
    });
    const nextSortOrder =
      typeof sortOrder === 'number' && Number.isFinite(sortOrder)
        ? sortOrder
        : (maxSort._max.sortOrder ?? -1) + 1;
    const m = await prisma.courseModule.create({
      data: { courseId, title, sortOrder: nextSortOrder }
    });
    res.json(m);
  });

  app.post('/api/admin/course-lessons', admin, async (req, res) => {
    const { moduleId, title, sortOrder, contentId, videoUrl, bodyText, actionLabel, actionUrl } = req.body as {
      moduleId?: string;
      title?: string;
      sortOrder?: number;
      contentId?: string | null;
      videoUrl?: string | null;
      bodyText?: string | null;
      actionLabel?: string | null;
      actionUrl?: string | null;
    };
    if (!moduleId || !title) return res.status(400).json({ error: 'moduleId and title required' });
    const maxSort = await prisma.courseLesson.aggregate({
      where: { moduleId },
      _max: { sortOrder: true },
    });
    const nextSortOrder =
      typeof sortOrder === 'number' && Number.isFinite(sortOrder)
        ? sortOrder
        : (maxSort._max.sortOrder ?? -1) + 1;
    const l = await prisma.courseLesson.create({
      data: {
        moduleId,
        title,
        sortOrder: nextSortOrder,
        contentId: contentId || null,
        videoUrl: videoUrl || null,
        bodyText: bodyText || null,
        actionLabel: actionLabel || null,
        actionUrl: actionUrl || null,
      }
    });
    res.json(l);
  });

  app.put('/api/admin/course-modules/:id', admin, async (req, res) => {
    const { title, sortOrder } = req.body as { title?: string; sortOrder?: number };
    const m = await prisma.courseModule
      .update({
        where: { id: req.params.id },
        data: {
          title: title ?? undefined,
          sortOrder: sortOrder ?? undefined,
        },
      })
      .catch(() => null);
    if (!m) return res.status(404).json({ error: 'Not found' });
    res.json(m);
  });

  app.delete('/api/admin/course-modules/:id', admin, async (req, res) => {
    await prisma.courseModule.delete({ where: { id: req.params.id } }).catch(() => null);
    res.json({ success: true });
  });

  app.put('/api/admin/course-lessons/:id', admin, async (req, res) => {
    const { title, sortOrder, contentId, videoUrl, bodyText, actionLabel, actionUrl } = req.body as {
      title?: string;
      sortOrder?: number;
      contentId?: string | null;
      videoUrl?: string | null;
      bodyText?: string | null;
      actionLabel?: string | null;
      actionUrl?: string | null;
    };
    const l = await prisma.courseLesson
      .update({
        where: { id: req.params.id },
        data: {
          title: title ?? undefined,
          sortOrder: sortOrder ?? undefined,
          contentId: contentId === undefined ? undefined : contentId || null,
          videoUrl: videoUrl === undefined ? undefined : videoUrl,
          bodyText: bodyText === undefined ? undefined : bodyText,
          actionLabel: actionLabel === undefined ? undefined : actionLabel,
          actionUrl: actionUrl === undefined ? undefined : actionUrl,
        },
      })
      .catch(() => null);
    if (!l) return res.status(404).json({ error: 'Not found' });
    res.json(l);
  });

  app.put('/api/admin/course-modules/:id/reorder-lessons', admin, async (req, res) => {
    const moduleId = req.params.id;
    const { lessonIds } = req.body as { lessonIds?: string[] };
    if (!Array.isArray(lessonIds)) return res.status(400).json({ error: 'lessonIds required' });

    const module = await prisma.courseModule.findUnique({ where: { id: moduleId }, select: { id: true } });
    if (!module) return res.status(404).json({ error: 'Module not found' });

    const existing = await prisma.courseLesson.findMany({
      where: { moduleId },
      select: { id: true },
      orderBy: [{ sortOrder: 'asc' }, { id: 'asc' }],
    });
    const existingIds = new Set(existing.map((l) => l.id));
    const uniqueIncoming = Array.from(new Set(lessonIds.filter((id) => existingIds.has(id))));
    const missingIds = existing.map((l) => l.id).filter((id) => !uniqueIncoming.includes(id));
    const finalOrder = [...uniqueIncoming, ...missingIds];

    await prisma.$transaction(
      finalOrder.map((lessonId, idx) =>
        prisma.courseLesson.update({
          where: { id: lessonId },
          data: { sortOrder: idx },
        })
      )
    );

    res.json({ success: true });
  });

  app.delete('/api/admin/course-lessons/:id', admin, async (req, res) => {
    await prisma.courseLesson.delete({ where: { id: req.params.id } }).catch(() => null);
    res.json({ success: true });
  });

  app.delete('/api/admin/courses/:id', admin, async (req, res) => {
    await prisma.course.delete({ where: { id: req.params.id } }).catch(() => null);
    res.json({ success: true });
  });
}
