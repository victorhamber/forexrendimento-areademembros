import type { PrismaClient } from '@prisma/client';
import { Resend } from 'resend';

export type SendEmailResult =
  | { ok: true; messageId?: string; to: string; from: string }
  | { ok: false; to: string; from: string; error: string; skipped?: boolean };

async function getSetting(prismaClient: PrismaClient, key: string): Promise<string | null> {
  const s = await prismaClient.setting.findUnique({ where: { key } });
  return s?.value || null;
}

function normalizeEmail(raw: string): string {
  return String(raw || '').trim().toLowerCase();
}

function isValidEmail(email: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

export async function sendTransactionalEmail(
  prismaClient: PrismaClient,
  toRaw: string,
  subject: string,
  html: string
): Promise<SendEmailResult> {
  const to = normalizeEmail(toRaw);
  if (!to) {
    const msg = 'Destinatário vazio — e-mail não enviado.';
    console.error(`[Email] ${msg}`);
    return { ok: false, to: '', from: '', error: msg, skipped: true };
  }
  if (!isValidEmail(to)) {
    const msg = `Destinatário inválido: ${toRaw}`;
    console.error(`[Email] ${msg}`);
    return { ok: false, to, from: '', error: msg };
  }

  try {
    const apiKey = await getSetting(prismaClient, 'resend_api_key');
    if (!apiKey) {
      const msg = 'Chave Resend não configurada — e-mail não enviado.';
      console.log(`[Email] ${msg} (destino seria: ${to})`);
      return { ok: false, to, from: '', error: msg, skipped: true };
    }

    const senderName = (await getSetting(prismaClient, 'sender_name')) || 'Forex Rendimento';
    const senderEmail = normalizeEmail((await getSetting(prismaClient, 'sender_email')) || 'noreply@example.com');
    const from = `${senderName} <${senderEmail}>`;

    const resend = new Resend(apiKey);
    const { data, error } = await resend.emails.send({
      from,
      to: [to],
      subject,
      html,
    });

    if (error) {
      const errMsg = typeof error === 'object' && error && 'message' in error ? String(error.message) : String(error);
      console.error(`[Email] Resend rejeitou envio para ${to}: ${errMsg}`);
      return { ok: false, to, from: senderEmail, error: errMsg };
    }

    const messageId = data?.id ? String(data.id) : undefined;
    console.log(`[Email] ✅ Enviado para ${to} (from: ${senderEmail}, id: ${messageId || 'n/a'}): ${subject}`);
    return { ok: true, to, from: senderEmail, messageId };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`[Email] Falha ao enviar para ${to}:`, err);
    return { ok: false, to, from: '', error: msg };
  }
}
