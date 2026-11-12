/**
 * Presentación segura de la metadata de auditoría (spec §12).
 *
 *  - Nunca se muestra ni exporta el valor de una clave con forma de secreto,
 *    aunque la base ya lo impida con su guard: defensa en profundidad.
 *  - El diff antes/después sólo existe cuando AMBOS lados existen. Si falta uno
 *    no se reconstruye un «antes» ficticio: se muestra la metadata disponible.
 */
export type Json = string | number | boolean | null | Json[] | { [key: string]: Json };

const SECRET_KEY = /(secret|password|passwd|pwd|token|private|api[_-]?key|service[_-]?role|authorization|credential|signature|cookie|session)/i;
export const REDACTED = '[oculto]';

/** Metadatos SOBRE un secreto (duración, si está configurado) no son el secreto. */
const SAFE_SUFFIX = /(_ttl_seconds|_configured|_enabled)$/i;

export function isSecretKey(key: string): boolean {
  return SECRET_KEY.test(key) && !SAFE_SUFFIX.test(key);
}

export function redact(value: unknown): Json {
  if (Array.isArray(value)) return value.map(redact);
  if (value && typeof value === 'object') {
    const out: Record<string, Json> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      out[k] = isSecretKey(k) ? REDACTED : redact(v);
    }
    return out;
  }
  if (value === undefined) return null;
  return value as Json;
}

function asObject(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
}

function hasContent(value: unknown): boolean {
  const obj = asObject(value);
  return obj !== null && Object.keys(obj).length > 0;
}

export function metadataOf(raw: unknown): Record<string, unknown> {
  return asObject(raw) ?? {};
}

export function correlationOf(raw: unknown): string | null {
  const meta = metadataOf(raw);
  const value = meta.correlation_id ?? meta.correlationId;
  return typeof value === 'string' && value ? value : null;
}

export function changedFieldsOf(raw: unknown): string[] {
  const value = metadataOf(raw).changed_fields;
  return Array.isArray(value) ? value.filter((v): v is string => typeof v === 'string') : [];
}

export interface DiffEntry {
  field: string;
  before: string;
  after: string;
}

function show(value: unknown): string {
  if (value === undefined) return '—';
  if (value === null) return 'vacío';
  if (typeof value === 'string') return value;
  return JSON.stringify(value);
}

/**
 * Diff campo a campo SÓLO si `before` y `after` existen y tienen contenido.
 * Devuelve null cuando falta un lado: el llamador muestra la metadata tal cual.
 */
export function diffOf(raw: unknown): DiffEntry[] | null {
  const meta = metadataOf(raw);
  if (!hasContent(meta.before) || !hasContent(meta.after)) return null;
  const before = redact(meta.before) as Record<string, Json>;
  const after = redact(meta.after) as Record<string, Json>;
  const declared = changedFieldsOf(raw);
  const fields =
    declared.length > 0
      ? declared
      : [...new Set([...Object.keys(before), ...Object.keys(after)])].filter(
          (k) => JSON.stringify(before[k]) !== JSON.stringify(after[k]),
        );
  return fields.map((field) => ({ field, before: show(before[field]), after: show(after[field]) }));
}

/** Resumen corto y humano de la metadata para la celda principal (nunca JSON). */
export function metadataSummary(raw: unknown): string {
  const changed = changedFieldsOf(raw);
  if (changed.length > 0) return `${changed.length} campo${changed.length === 1 ? '' : 's'} modificado${changed.length === 1 ? '' : 's'}`;
  const keys = Object.keys(metadataOf(raw));
  if (keys.length === 0) return 'Sin metadata';
  return `${keys.length} dato${keys.length === 1 ? '' : 's'} de contexto`;
}
