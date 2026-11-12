/**
 * JSON Canonicalization Scheme (RFC 8785) y checksum de ebim.entitlements/v1.
 *
 * El checksum de un snapshot es `sha256:` + hex del SHA-256 de los bytes UTF-8
 * del JSON canónico SIN el campo `checksum` (spec §7.2 regla 3). Lo calcula
 * MasterAdmin al emitir (SQL, `platform.entitlement_checksum`) y lo recalcula
 * el receptor al aplicar; esta implementación es la que usan el cliente de
 * sync (verificación antes de enviar), el receptor de referencia y los
 * fixtures dorados.
 *
 * RFC 8785 está definida sobre la serialización de ECMAScript, así que en TS
 * la canonicalización es casi literal: números con `Number#toString` (vía
 * JSON.stringify), cadenas con los escapes de JSON.stringify, claves ordenadas
 * por unidades UTF-16 (el `sort()` por defecto). Lo que se añade es rechazar
 * todo lo que no es JSON en vez de dejar que JSON.stringify lo omita o lo
 * convierta en silencio (undefined, funciones, NaN, fechas con toJSON).
 */
import { sha256Hex } from '../provisioning/fingerprint.ts';

export class JcsError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'JcsError';
  }
}

// Surrogate alto sin bajo detrás, o bajo sin alto delante.
const LONE_SURROGATE_RE = /[\ud800-\udbff](?![\udc00-\udfff])|(?<![\ud800-\udbff])[\udc00-\udfff]/;

function serializeString(value: string): string {
  if (LONE_SURROGATE_RE.test(value)) {
    throw new JcsError('Cadena con surrogate UTF-16 solitario: no es Unicode válido');
  }
  return JSON.stringify(value);
}

function serializeNumber(value: number): string {
  if (!Number.isFinite(value)) {
    throw new JcsError(`Número no representable en JSON: ${String(value)}`);
  }
  // JSON.stringify(-0) === '0', como exige la RFC.
  return JSON.stringify(value);
}

export function canonicalize(value: unknown): string {
  if (value === null) return 'null';
  switch (typeof value) {
    case 'boolean':
      return value ? 'true' : 'false';
    case 'number':
      return serializeNumber(value);
    case 'string':
      return serializeString(value);
    case 'object':
      break;
    default:
      throw new JcsError(`Tipo no admitido en JSON: ${typeof value}`);
  }

  if (Array.isArray(value)) {
    return `[${value.map((item) => canonicalize(item)).join(',')}]`;
  }

  const proto = Object.getPrototypeOf(value);
  if (proto !== Object.prototype && proto !== null) {
    throw new JcsError('Solo se canonicalizan objetos planos (una fecha o una clase no son JSON)');
  }

  const record = value as Record<string, unknown>;
  const keys = Object.keys(record).sort();
  return `{${keys.map((key) => `${serializeString(key)}:${canonicalize(record[key])}`).join(',')}}`;
}

/** `sha256:<hex>` del canónico del documento sin su campo `checksum`. */
export async function entitlementChecksum(document: Record<string, unknown>): Promise<string> {
  const { checksum: _ignored, ...rest } = document;
  return `sha256:${await sha256Hex(canonicalize(rest))}`;
}
