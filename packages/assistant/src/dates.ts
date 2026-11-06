import { addDays, weekday } from '@camarada/shared';

/** Minúsculas e sem acentos, preservando o comprimento (os índices valem para o texto original). */
export function fold(text: string): string {
  return [...text.normalize('NFC')]
    .map((ch) => {
      const base = ch.normalize('NFD').replace(/\p{M}/gu, '');
      return base.length === 1 ? base.toLowerCase() : ch.toLowerCase();
    })
    .join('');
}

const WEEKDAYS: Record<string, number> = {
  domingo: 0,
  segunda: 1,
  terca: 2,
  quarta: 3,
  quinta: 4,
  sexta: 5,
  sabado: 6,
};

const PREP = String.raw`(?:(?:ate|para|pra|de|no|na|em|nesta|neste|nessa|nesse|esta|este)\s+)?`;

interface Span {
  start: number;
  end: number;
}

export interface When {
  date?: string;
  time?: string;
  /** Texto original sem as expressões de data/hora. */
  rest: string;
}

const pad = (n: number) => String(n).padStart(2, '0');

function validDate(y: number, m: number, d: number): string | undefined {
  const dt = new Date(Date.UTC(y, m - 1, d));
  if (dt.getUTCFullYear() !== y || dt.getUTCMonth() !== m - 1 || dt.getUTCDate() !== d) {
    return undefined;
  }
  return `${y}-${pad(m)}-${pad(d)}`;
}

/** Extrai data e hora em português ("amanhã às 20h", "sexta", "15/11", "8 da noite"). */
export function parseWhen(text: string, today: string): When {
  const original = text.normalize('NFC');
  const f = fold(original);
  const spans: Span[] = [];
  let date: string | undefined;
  let time: string | undefined;
  const [ty, tm, td] = today.split('-').map(Number) as [number, number, number];

  const take = (re: RegExp, fn: (m: RegExpExecArray) => boolean) => {
    const m = re.exec(f);
    if (m && fn(m)) {
      spans.push({ start: m.index, end: m.index + m[0].length });
    }
  };

  take(new RegExp(String.raw`\b${PREP}(depois de amanha|amanha|hoje)\b`), (m) => {
    date = addDays(today, m[1] === 'hoje' ? 0 : m[1] === 'amanha' ? 1 : 2);
    return true;
  });

  if (!date) {
    take(
      new RegExp(
        String.raw`\b${PREP}(?:(?:proxim[oa]|outr[oa])\s+)?(domingo|segunda|terca|quarta|quinta|sexta|sabado)(?:[\s-]feira)?(?:\s+que\s+vem)?\b`,
      ),
      (m) => {
        const target = WEEKDAYS[m[1] ?? ''] ?? 0;
        let diff = (target - weekday(today) + 7) % 7;
        if (diff === 0 && /proxim|outr|que\s+vem/.test(m[0])) diff = 7;
        date = addDays(today, diff);
        return true;
      },
    );
  }

  if (!date) {
    take(
      /\b(?:(?:ate|para|pra|no|em)\s+)?(?:dia\s+)?(\d{1,2})\/(\d{1,2})(?:\/(\d{2,4}))?\b/,
      (m) => {
        const d = Number(m[1]);
        const mo = Number(m[2]);
        let y = m[3] ? Number(m[3]) : ty;
        if (y < 100) y += 2000;
        if (!m[3] && (mo < tm || (mo === tm && d < td))) y += 1;
        date = validDate(y, mo, d);
        return date !== undefined;
      },
    );
  }

  if (!date) {
    take(/\b(?:(?:ate|para|pra|no)\s+)?dia\s+(\d{1,2})\b(?!\s*(?:h|:|horas?)\b)/, (m) => {
      const d = Number(m[1]);
      let y = ty;
      let mo = tm;
      if (d < td) {
        mo += 1;
        if (mo > 12) {
          mo = 1;
          y += 1;
        }
      }
      date = validDate(y, mo, d);
      return date !== undefined;
    });
  }

  take(/\b(?:(?:ate\s+)?(?:as|a)\s+)?meio[\s-]dia\b/, () => {
    time = '12:00';
    return true;
  });

  if (!time) {
    take(
      /\b(?:(?:ate\s+)?(?:as|a)\s+)?(\d{1,2})(?:\s*(?:h|:)\s*(\d{2})?|\s+horas?)(?:\s+(?:da|de)\s+(manha|tarde|noite))?(?![\p{L}\d])/u,
      (m) => setTime(m[1], m[2], m[3]),
    );
  }
  if (!time) {
    take(/\b(?:(?:ate\s+)?(?:as|a)\s+)(\d{1,2})\s+(?:da|de)\s+(manha|tarde|noite)\b/, (m) =>
      setTime(m[1], undefined, m[2]),
    );
  }

  function setTime(h?: string, min?: string, period?: string): boolean {
    let hour = Number(h);
    const minute = min ? Number(min) : 0;
    if ((period === 'tarde' || period === 'noite') && hour < 12) hour += 12;
    if (hour > 23 || minute > 59) return false;
    time = `${pad(hour)}:${pad(minute)}`;
    return true;
  }

  let rest = '';
  let last = 0;
  for (const s of spans.sort((a, b) => a.start - b.start)) {
    rest += `${original.slice(last, s.start)} `;
    last = s.end;
  }
  rest += original.slice(last);
  rest = rest
    .replace(/\s+/g, ' ')
    .replace(/\s+([,.;!?])/g, '$1')
    .replace(/[\s,;:-]+$/u, '')
    .trim();

  return { ...(date && { date }), ...(time && { time }), rest };
}
