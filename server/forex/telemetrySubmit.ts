import type { PrismaClient } from '@prisma/client';
import { isPrismaUniqueViolation } from '../lib/prismaErrors.js';

const KINDS = new Set(['close', 'float_sample', 'goal_gain', 'goal_loss']);
const BROKER_TIME = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})$/;
const MAX_EVENTS = 40;
const RETENTION_MS = 120 * 24 * 60 * 60 * 1000;

export type TelemetryResult = { status: number; json: Record<string, unknown> };

function num(value: unknown): number {
  const n = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(n) ? n : NaN;
}

function brokerInstant(brokerTime: string, offsetMin: number): Date | null {
  const m = BROKER_TIME.exec(brokerTime);
  if (!m) return null;
  const wall = Date.UTC(
    Number(m[1]),
    Number(m[2]) - 1,
    Number(m[3]),
    Number(m[4]),
    Number(m[5]),
    Number(m[6])
  );
  if (!Number.isFinite(wall)) return null;
  return new Date(wall - offsetMin * 60_000);
}

export async function submitTelemetry(
  prisma: PrismaClient,
  body: Record<string, unknown>
): Promise<TelemetryResult> {
  const email = String(body.email || '').trim().toLowerCase();
  const numeroConta = String(body.numero_conta || body.numeroConta || '').trim();
  const systemId = String(body.system_id || body.systemId || '').trim().slice(0, 64);
  const corretora = String(body.corretora || '').trim().slice(0, 120);
  const offsetRaw = num(body.broker_offset_min);
  const brokerOffsetMin = Number.isFinite(offsetRaw)
    ? Math.max(-14 * 60, Math.min(14 * 60, Math.round(offsetRaw)))
    : 0;

  if (!email.includes('@') || numeroConta.length < 3) {
    return { status: 400, json: { status: 'error', message: 'E-mail ou conta inválidos.' } };
  }

  const now = new Date();
  const license = await prisma.license.findFirst({
    where: {
      email,
      numeroConta,
      statusLicenca: 'ativa',
      OR: [{ dataExpiracao: null }, { dataExpiracao: { gte: now } }],
    },
    select: { id: true, systemId: true },
  });
  if (!license) {
    return {
      status: 403,
      json: { status: 'error', code: 'LICENSE_NOT_FOUND', message: 'Licença ativa não encontrada para esta conta.' },
    };
  }

  const rawEvents = Array.isArray(body.events) ? body.events : [];
  if (!rawEvents.length) {
    return { status: 400, json: { status: 'error', message: 'Nenhum evento.' } };
  }

  let accepted = 0;
  let duplicated = 0;

  for (const item of rawEvents.slice(0, MAX_EVENTS)) {
    if (!item || typeof item !== 'object') continue;
    const ev = item as Record<string, unknown>;
    const kind = String(ev.kind || '').trim();
    if (!KINDS.has(kind)) continue;

    const brokerTime = String(ev.broker_time || '').trim();
    const occurredAt = brokerInstant(brokerTime, brokerOffsetMin);
    if (!occurredAt) continue;

    const eventKey = String(ev.key || '').trim().slice(0, 160);
    if (eventKey.length < 8) continue;

    const profitUsd = num(ev.profit_usd);
    const floatUsd = num(ev.float_usd);
    const floatMinUsd = num(ev.float_min_usd);
    const floatMaxUsd = num(ev.float_max_usd);

    try {
      await prisma.robotTelemetryEvent.create({
        data: {
          email,
          numeroConta,
          systemId: systemId || license.systemId || '',
          corretora,
          ativo: String(ev.ativo || '').trim().slice(0, 32),
          kind,
          closeReason: String(ev.close_reason || '').trim().slice(0, 32),
          brokerTime,
          brokerOffsetMin,
          occurredAt,
          profitUsd: Number.isFinite(profitUsd) ? profitUsd : 0,
          floatUsd: Number.isFinite(floatUsd) ? floatUsd : 0,
          floatMinUsd: Number.isFinite(floatMinUsd) ? floatMinUsd : 0,
          floatMaxUsd: Number.isFinite(floatMaxUsd) ? floatMaxUsd : 0,
          eventKey,
        },
      });
      accepted += 1;
    } catch (error) {
      if (isPrismaUniqueViolation(error, 'eventKey')) {
        duplicated += 1;
        continue;
      }
      throw error;
    }
  }

  if (accepted > 0 && Math.random() < 0.05) {
    await prisma.robotTelemetryEvent.deleteMany({
      where: { email, occurredAt: { lt: new Date(Date.now() - RETENTION_MS) } },
    });
  }

  return {
    status: 200,
    json: { status: 'success', accepted, duplicated },
  };
}
