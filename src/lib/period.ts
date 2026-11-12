/**
 * V5 · F0 · Períodos mensuales en español (es-PE).
 *
 * El valor interno de un mes sigue siendo `YYYY-MM` (lo que esperan las RPC
 * tras `periodFromMonth`), pero el usuario nunca lo ve: la UI muestra
 * «noviembre de 2026». Sustituye al `<input type="month">`, que pintaba el
 * formato del navegador (a menudo en inglés) y no se podía traducir.
 */

const LOCALE = 'es-PE';
const MONTH_RE = /^(\d{4})-(0[1-9]|1[0-2])/;

/** `YYYY-MM` del mes de calendario de `date` (hora local). */
export function monthValue(date: Date = new Date()): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
}

/** Desplaza un mes `YYYY-MM` `delta` meses (negativo hacia atrás). */
export function shiftMonth(month: string, delta: number): string {
  const m = MONTH_RE.exec(month);
  if (!m) return month;
  const d = new Date(Number(m[1]), Number(m[2]) - 1 + delta, 1);
  return monthValue(d);
}

/**
 * `2026-10` o `2026-10-01` → «octubre de 2026». `—` si no es un mes válido,
 * nunca el texto ISO crudo.
 */
export function formatMonth(value: string | null | undefined): string {
  const m = MONTH_RE.exec(value ?? '');
  if (!m) return '—';
  return new Intl.DateTimeFormat(LOCALE, { month: 'long', year: 'numeric' }).format(
    new Date(Number(m[1]), Number(m[2]) - 1, 1),
  );
}

export interface MonthOption {
  value: string;
  label: string;
}

/**
 * Opciones de un selector de período: del mes más reciente al más antiguo.
 * `back` meses hacia atrás y `ahead` hacia delante del mes de `today`; el mes en
 * curso se rotula. `include` garantiza que un valor fuera del rango (un enlace
 * antiguo, un valor por defecto) siga siendo elegible en vez de perderse.
 */
export function monthOptions({
  today = new Date(),
  back = 24,
  ahead = 0,
  include,
  currentSuffix = ' (mes en curso)',
}: {
  today?: Date;
  back?: number;
  ahead?: number;
  include?: string | null;
  currentSuffix?: string;
} = {}): MonthOption[] {
  const now = monthValue(today);
  const values: string[] = [];
  for (let i = ahead; i >= -back; i -= 1) values.push(shiftMonth(now, i));
  const extra = include && MONTH_RE.test(include) ? include.slice(0, 7) : null;
  if (extra && !values.includes(extra)) {
    values.push(extra);
    values.sort((a, b) => (a < b ? 1 : a > b ? -1 : 0));
  }
  return values.map((v) => ({ value: v, label: v === now ? `${formatMonth(v)}${currentSuffix}` : formatMonth(v) }));
}
