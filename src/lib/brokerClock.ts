/** Converte o relógio da corretora para o fuso da pessoa, e o contrário. */

export type ClockParts = {
  hour: number;
  minute: number;
  dow: number;
};

const WEEKDAY_INDEX: Record<string, number> = {
  Sun: 0,
  Mon: 1,
  Tue: 2,
  Wed: 3,
  Thu: 4,
  Fri: 5,
  Sat: 6,
};

export function deviceTimeZone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || 'America/Sao_Paulo';
  } catch {
    return 'America/Sao_Paulo';
  }
}

/** Offset (minutos) do fuso em relação ao UTC naquele instante. São Paulo ≈ −180. */
export function timeZoneOffsetMin(utcMs: number, timeZone: string): number {
  const dtf = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hourCycle: 'h23',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
  const map: Record<string, string> = {};
  for (const part of dtf.formatToParts(new Date(utcMs))) {
    if (part.type !== 'literal') map[part.type] = part.value;
  }
  const asUtc = Date.UTC(
    Number(map.year),
    Number(map.month) - 1,
    Number(map.day),
    Number(map.hour),
    Number(map.minute),
    Number(map.second)
  );
  return Math.round((asUtc - utcMs) / 60000);
}

/** Relógio de parede da corretora → instante UTC. offsetMin = TimeCurrent − TimeGMT. */
export function brokerWallToUtcMs(brokerTime: string, brokerOffsetMin: number): number | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2}))?$/.exec(brokerTime.trim());
  if (!match) return null;
  const wall = Date.UTC(
    Number(match[1]),
    Number(match[2]) - 1,
    Number(match[3]),
    Number(match[4]),
    Number(match[5]),
    Number(match[6] || 0)
  );
  if (!Number.isFinite(wall)) return null;
  return wall - brokerOffsetMin * 60_000;
}

export function brokerWallParts(brokerTime: string): ClockParts | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/.exec(brokerTime.trim());
  if (!match) return null;
  const utc = Date.UTC(
    Number(match[1]),
    Number(match[2]) - 1,
    Number(match[3]),
    Number(match[4]),
    Number(match[5])
  );
  return {
    hour: Number(match[4]),
    minute: Number(match[5]),
    dow: new Date(utc).getUTCDay(),
  };
}

export function partsInTimeZone(utcMs: number, timeZone: string): ClockParts {
  const dtf = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hourCycle: 'h23',
    weekday: 'short',
    hour: '2-digit',
    minute: '2-digit',
  });
  const map: Record<string, string> = {};
  for (const part of dtf.formatToParts(new Date(utcMs))) {
    if (part.type !== 'literal') map[part.type] = part.value;
  }
  const hour = Number(map.hour);
  return {
    hour: hour === 24 ? 0 : hour,
    minute: Number(map.minute),
    dow: WEEKDAY_INDEX[map.weekday] ?? 0,
  };
}

function pad(n: number): string {
  return String(n).padStart(2, '0');
}

/** HH:MM digitado no relógio da corretora → HH:MM no fuso da pessoa. */
export function convertBrokerClockToZone(
  hour: number,
  minute: number,
  brokerOffsetMin: number,
  timeZone: string,
  day = new Date()
): string {
  const wall = Date.UTC(day.getFullYear(), day.getMonth(), day.getDate(), hour, minute, 0);
  const utc = wall - brokerOffsetMin * 60_000;
  const parts = partsInTimeZone(utc, timeZone);
  return `${pad(parts.hour)}:${pad(parts.minute)}`;
}

/** HH:MM no fuso da pessoa → HH:MM no relógio da corretora (o que entra no robô). */
export function convertZoneClockToBroker(
  hour: number,
  minute: number,
  brokerOffsetMin: number,
  timeZone: string,
  day = new Date()
): string {
  const guess = Date.UTC(day.getFullYear(), day.getMonth(), day.getDate(), hour, minute, 0);
  let utc = guess - timeZoneOffsetMin(guess, timeZone) * 60_000;
  utc = guess - timeZoneOffsetMin(utc, timeZone) * 60_000;
  const broker = new Date(utc + brokerOffsetMin * 60_000);
  return `${pad(broker.getUTCHours())}:${pad(broker.getUTCMinutes())}`;
}

export function formatOffset(minutes: number): string {
  const sign = minutes >= 0 ? '+' : '−';
  const abs = Math.abs(minutes);
  const h = Math.floor(abs / 60);
  const m = abs % 60;
  return `UTC${sign}${pad(h)}:${pad(m)}`;
}
