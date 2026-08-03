import type { License, PrismaClient } from '@prisma/client';
import { sendTransactionalEmail } from './emailSender.js';
import { log } from './logger.js';

/** Destinatário interno de gestão (não é e-mail do cliente). */
export const LICENSE_ADMIN_NOTIFY_EMAIL = 'contato@victorhamber.com';

type LicenseSnapshot = Pick<
  License,
  | 'id'
  | 'email'
  | 'buyerName'
  | 'plano'
  | 'systemId'
  | 'offerCode'
  | 'statusLicenca'
  | 'numeroConta'
  | 'dataExpiracao'
  | 'dataAtivacao'
  | 'eventId'
>;

export type LicenseAdminNotifySource =
  | 'admin'
  | 'webhook'
  | 'ea_validation'
  | 'trial'
  | 'tash_webhook'
  | 'webhook_retry';

function formatDateBr(d: Date | null | undefined): string {
  if (!d) return '— (aguardando 1ª validação do robô)';
  return d.toLocaleString('pt-BR', {
    timeZone: 'America/Sao_Paulo',
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function row(label: string, value: string): string {
  return `<tr><td style="padding:6px 12px 6px 0;color:#64748b;vertical-align:top;white-space:nowrap">${escapeHtml(label)}</td><td style="padding:6px 0;color:#0f172a">${escapeHtml(value)}</td></tr>`;
}

function buildLicenseTable(license: LicenseSnapshot, extraRows = ''): string {
  return `<table style="border-collapse:collapse;font-size:14px;line-height:1.5">${row('ID', String(license.id))}${row('E-mail', license.email)}${row('Nome', license.buyerName || '—')}${row('Plano', license.plano || '—')}${row('System ID', license.systemId || '—')}${row('Offer code', license.offerCode || '—')}${row('Status', license.statusLicenca || '—')}${row('Conta MT5', license.numeroConta || '—')}${row('Ativação', formatDateBr(license.dataAtivacao))}${row('Expiração', formatDateBr(license.dataExpiracao))}${row('Event ID', license.eventId || '—')}${extraRows}</table>`;
}

function wrapHtml(title: string, body: string): string {
  return `<!DOCTYPE html><html><body style="font-family:system-ui,-apple-system,Segoe UI,sans-serif;background:#f8fafc;padding:24px"><div style="max-width:560px;margin:0 auto;background:#fff;border:1px solid #e2e8f0;border-radius:8px;padding:24px"><h1 style="margin:0 0 16px;font-size:18px;color:#0f172a">${escapeHtml(title)}</h1>${body}<p style="margin:24px 0 0;font-size:12px;color:#94a3b8">Notificação interna — Área de Membros Autofintech</p></div></body></html>`;
}

export function expiryDateChanged(
  before: Date | null | undefined,
  after: Date | null | undefined
): boolean {
  const b = before ? before.getTime() : null;
  const a = after ? after.getTime() : null;
  return b !== a;
}

async function sendLicenseAdminEmail(
  prisma: PrismaClient,
  subject: string,
  html: string
): Promise<void> {
  const result = await sendTransactionalEmail(prisma, LICENSE_ADMIN_NOTIFY_EMAIL, subject, html);
  if (!result.ok && !result.skipped) {
    log('ERROR', `Falha ao enviar notificação de gestão de licença: ${result.error}`);
  } else if (result.ok) {
    log('INFO', `Notificação de gestão de licença enviada para ${LICENSE_ADMIN_NOTIFY_EMAIL}: ${subject}`);
  }
}

export async function notifyLicenseCreated(
  prisma: PrismaClient,
  license: LicenseSnapshot,
  source: LicenseAdminNotifySource
): Promise<void> {
  const subject = `[Gestão] Nova licença #${license.id} — ${license.email}`;
  const html = wrapHtml(
    'Nova licença criada',
    `<p style="color:#334155;margin:0 0 16px">Origem: <strong>${escapeHtml(source)}</strong></p>${buildLicenseTable(license)}`
  );
  await sendLicenseAdminEmail(prisma, subject, html);
}

export async function notifyLicenseExpiryUpdated(
  prisma: PrismaClient,
  license: LicenseSnapshot,
  previousDataExpiracao: Date | null | undefined,
  source: LicenseAdminNotifySource
): Promise<void> {
  if (!expiryDateChanged(previousDataExpiracao, license.dataExpiracao)) return;

  const subject = `[Gestão] Expiração alterada — licença #${license.id} (${license.email})`;
  const extra = `${row('Expiração anterior', formatDateBr(previousDataExpiracao))}${row('Nova expiração', formatDateBr(license.dataExpiracao))}${row('Origem', source)}`;
  const html = wrapHtml('Data de expiração alterada', `<p style="color:#334155;margin:0 0 16px">A data de expiração desta licença foi atualizada.</p>${buildLicenseTable(license, extra)}`);
  await sendLicenseAdminEmail(prisma, subject, html);
}

/** Não bloqueia o fluxo principal em caso de falha no e-mail. */
export function fireLicenseCreatedNotify(
  prisma: PrismaClient,
  license: LicenseSnapshot,
  source: LicenseAdminNotifySource
): void {
  void notifyLicenseCreated(prisma, license, source).catch((err) =>
    log('ERROR', 'notifyLicenseCreated', { err: String(err) })
  );
}

export function fireLicenseExpiryUpdatedNotify(
  prisma: PrismaClient,
  license: LicenseSnapshot,
  previousDataExpiracao: Date | null | undefined,
  source: LicenseAdminNotifySource
): void {
  void notifyLicenseExpiryUpdated(prisma, license, previousDataExpiracao, source).catch((err) =>
    log('ERROR', 'notifyLicenseExpiryUpdated', { err: String(err) })
  );
}
