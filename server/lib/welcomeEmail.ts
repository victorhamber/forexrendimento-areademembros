import type { PrismaClient } from '@prisma/client';
import {
  applyEmailPlaceholders,
  buildWelcomeEmailHtml,
  DEFAULT_WELCOME_BODY_PT,
  emailBodyFromStored,
  type EmailLang,
  DEFAULT_WELCOME_BODY_ES,
} from '../../shared/emailTemplates.js';
import { sendTransactionalEmail } from './emailSender.js';
import { getMemberAppUrl } from './appUrls.js';

const ES_COUNTRIES = ['AR','BO','CL','CO','CR','CU','DO','EC','SV','GQ','GT','HN','MX','NI','PA','PY','PE','ES','UY','VE'];

export function detectLang(country: string | null | undefined): 'es' | 'pt' {
  if (!country) return 'pt';
  return ES_COUNTRIES.includes(country.toUpperCase()) ? 'es' : 'pt';
}

async function getSetting(prismaClient: PrismaClient, key: string): Promise<string | null> {
  const s = await prismaClient.setting.findUnique({ where: { key } });
  return s?.value || null;
}

export async function sendWelcomeEmail(
  prismaClient: PrismaClient,
  email: string,
  name: string | null,
  password: string,
  country: string | null
) {
  const recipient = String(email || '').trim().toLowerCase();
  const lang: EmailLang = detectLang(country) === 'es' ? 'es' : 'pt';
  const templateKey = lang === 'es' ? 'welcome_template_es' : 'welcome_template_pt';
  const stored = await getSetting(prismaClient, templateKey);
  const fallback = lang === 'es' ? DEFAULT_WELCOME_BODY_ES : DEFAULT_WELCOME_BODY_PT;
  const bodyPlain = emailBodyFromStored(stored, fallback);
  const appUrl = getMemberAppUrl();
  const html = applyEmailPlaceholders(buildWelcomeEmailHtml(bodyPlain, lang), {
    name: name || 'Cliente',
    email: recipient,
    password,
    country: country || '-',
    app_url: appUrl,
  });

  const subject =
    lang === 'es'
      ? 'Bienvenido(a) a Forex Rendimento — tu acceso está listo'
      : 'Bem-vindo(a) à Forex Rendimento — seu acesso está pronto';

  const result = await sendTransactionalEmail(prismaClient, recipient, subject, html);
  if (!result.ok && !result.skipped) {
    throw new Error(result.error);
  }
  return result;
}
