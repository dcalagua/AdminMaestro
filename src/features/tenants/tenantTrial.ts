/**
 * Periodo de prueba de un tenant (migración 20261024000100). Modelo puro: la
 * fecha y su vigencia las decide la base; aquí solo se dicen en español.
 */
import { formatDate } from '@/lib/format';

const DAY_MS = 24 * 60 * 60 * 1000;

/** Mismo tope que `set_tenant_trial_end`: una prueba no se extiende más de 365 días. */
export const MAX_TRIAL_EXTENSION_DAYS = 365;

export type TrialStatus =
  | { kind: 'NOT_TRIAL' }
  | { kind: 'CONVERTED'; convertedAt: string }
  | { kind: 'NO_END' }
  | { kind: 'ACTIVE'; endsAt: string; daysLeft: number }
  | { kind: 'EXPIRED'; endsAt: string; daysAgo: number };

export interface TrialFields {
  tenant_type?: unknown;
  trial_ends_at?: unknown;
  trial_converted_at?: unknown;
}

/** Días completos o parciales que faltan (ceil): «vence mañana a las 9» son 1 día. */
export function trialStatus(t: TrialFields, now: Date = new Date()): TrialStatus {
  if (typeof t.trial_converted_at === 'string' && t.trial_converted_at) {
    return { kind: 'CONVERTED', convertedAt: t.trial_converted_at };
  }
  if (t.tenant_type !== 'TRIAL') return { kind: 'NOT_TRIAL' };
  if (typeof t.trial_ends_at !== 'string' || !t.trial_ends_at) return { kind: 'NO_END' };
  const diff = Date.parse(t.trial_ends_at) - now.getTime();
  if (Number.isNaN(diff)) return { kind: 'NO_END' };
  if (diff > 0) return { kind: 'ACTIVE', endsAt: t.trial_ends_at, daysLeft: Math.max(1, Math.ceil(diff / DAY_MS)) };
  return { kind: 'EXPIRED', endsAt: t.trial_ends_at, daysAgo: Math.floor(-diff / DAY_MS) };
}

function days(n: number): string {
  return `${n} ${n === 1 ? 'día' : 'días'}`;
}

/** «Prueba vence el 24 nov 2026 (quedan 7 días)» / «… (vencida)». */
export function trialText(s: TrialStatus): string {
  switch (s.kind) {
    case 'ACTIVE':
      return `Prueba vence el ${formatDate(s.endsAt)} (${s.daysLeft === 1 ? 'queda 1 día' : `quedan ${days(s.daysLeft)}`})`;
    case 'EXPIRED':
      return `Prueba vencida el ${formatDate(s.endsAt)}${s.daysAgo > 0 ? ` (hace ${days(s.daysAgo)})` : ' (hoy)'}`;
    case 'CONVERTED':
      return `Prueba convertida en cliente el ${formatDate(s.convertedAt)}`;
    case 'NO_END':
      return 'Prueba sin vencimiento registrado';
    default:
      return '';
  }
}

/** Fecha de vencimiento que se mostrará al crear un tenant TRIAL (now + días del producto). */
export function trialEndPreview(trialDays: number | null | undefined, now: Date = new Date()): string | null {
  if (!trialDays || trialDays < 1) return null;
  return formatDate(new Date(now.getTime() + trialDays * DAY_MS));
}

/** `YYYY-MM-DD` local de una fecha (valor de un `<input type="date">`). */
export function toDateInput(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/**
 * El día elegido vence al FINAL de ese día en la hora local de quien lo elige:
 * «extender hasta el 30» no puede cortar el 30 a medianoche.
 */
export function endOfDayIso(dateInput: string): string | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dateInput)) return null;
  const d = new Date(`${dateInput}T23:59:59`);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}
