/** Datas no fuso da casa. "Chave de dia" = 'YYYY-MM-DD' no fuso informado. */

const partsCache = new Map<string, Intl.DateTimeFormat>();

function partsFormatter(tz: string): Intl.DateTimeFormat {
  let f = partsCache.get(tz);
  if (!f) {
    f = new Intl.DateTimeFormat('en-US', {
      timeZone: tz,
      hourCycle: 'h23',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    });
    partsCache.set(tz, f);
  }
  return f;
}

function zonedParts(ms: number, tz: string) {
  const p: Record<string, string> = {};
  for (const part of partsFormatter(tz).formatToParts(new Date(ms))) {
    p[part.type] = part.value;
  }
  return {
    year: Number(p.year),
    month: Number(p.month),
    day: Number(p.day),
    hour: Number(p.hour),
    minute: Number(p.minute),
    second: Number(p.second),
  };
}

function offsetMs(ms: number, tz: string): number {
  const p = zonedParts(ms, tz);
  const asUtc = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second);
  return asUtc - (ms - (((ms % 1000) + 1000) % 1000));
}

const pad = (n: number) => String(n).padStart(2, '0');

function parseKey(key: string): [number, number, number] {
  const [y, m, d] = key.split('-').map(Number);
  return [y ?? 1970, m ?? 1, d ?? 1];
}

export function dayKey(iso: string | Date, tz: string): string {
  const p = zonedParts(new Date(iso).getTime(), tz);
  return `${p.year}-${pad(p.month)}-${pad(p.day)}`;
}

export function todayKey(tz: string, now: Date = new Date()): string {
  return dayKey(now, tz);
}

export function addDays(key: string, days: number): string {
  const [y, m, d] = parseKey(key);
  const date = new Date(Date.UTC(y, m - 1, d + days));
  return date.toISOString().slice(0, 10);
}

/** 0 = domingo. */
export function weekday(key: string): number {
  const [y, m, d] = parseKey(key);
  return new Date(Date.UTC(y, m - 1, d)).getUTCDay();
}

export function startOfWeek(key: string): string {
  return addDays(key, -weekday(key));
}

export function startOfMonth(key: string): string {
  return `${key.slice(0, 7)}-01`;
}

export function addMonths(key: string, months: number): string {
  const [y, m] = parseKey(key);
  const date = new Date(Date.UTC(y, m - 1 + months, 1));
  return date.toISOString().slice(0, 10);
}

/** Converte data/hora locais da casa em instante UTC (ISO). */
export function zonedToUtcIso(date: string, time: string, tz: string): string {
  const [y, m, d] = parseKey(date);
  const [hh, mm] = time.split(':').map(Number);
  const guess = Date.UTC(y, m - 1, d, hh ?? 0, mm ?? 0);
  const first = guess - offsetMs(guess, tz);
  const second = guess - offsetMs(first, tz);
  return new Date(second).toISOString();
}

/** Início do dia (00:00 no fuso da casa) em UTC. */
export function dayStartUtc(key: string, tz: string): string {
  return zonedToUtcIso(key, '00:00', tz);
}

export function utcToZonedInput(iso: string, tz: string): { date: string; time: string } {
  const p = zonedParts(new Date(iso).getTime(), tz);
  return {
    date: `${p.year}-${pad(p.month)}-${pad(p.day)}`,
    time: `${pad(p.hour)}:${pad(p.minute)}`,
  };
}

export function formatDateTime(iso: string, tz: string): string {
  return new Intl.DateTimeFormat('pt-BR', {
    timeZone: tz,
    weekday: 'short',
    day: '2-digit',
    month: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(iso));
}

export function formatDayLabel(key: string, options: Intl.DateTimeFormatOptions): string {
  const [y, m, d] = parseKey(key);
  return new Intl.DateTimeFormat('pt-BR', { timeZone: 'UTC', ...options }).format(
    new Date(Date.UTC(y, m - 1, d, 12)),
  );
}
