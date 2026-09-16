/**
 * Validación de la respuesta del SaaS.
 *
 * Un 200 no es un éxito: es un 200. Sin esta validación, un producto que
 * responda `{"ok":true}` sin crear nada dejaría la solicitud en ACTIVE y el
 * mapeo vacío — y nadie se enteraría hasta que el cliente intentara entrar.
 *
 * REGLA: no se guarda "cualquier JSON". Se extrae exactamente lo que el
 * contrato define y se descarta el resto. Lo que no encaja produce
 * PROVIDER_RESPONSE_INVALID y la solicitud NO pasa a ACTIVE.
 */
import type { AdapterResult } from './types.ts';
import { ProvisioningError } from './types.ts';

const MAX_ID_LENGTH = 200;
const MAX_RESOURCE_KEYS = 25;
const MAX_RESOURCE_VALUE_LENGTH = 500;

/** Claves que nunca entran en `resources`, aunque el producto las devuelva. */
const FORBIDDEN_RESOURCE_KEYS =
  /(password|passwd|secret|token|api[-_]?key|private[-_]?key|service[-_]?role|credential|authorization|connection[-_]?string|dsn)/i;

function readId(value: unknown, field: string, required: boolean): string | null {
  if (value === undefined || value === null || value === '') {
    if (required) {
      throw new ProvisioningError(
        'PROVIDER_RESPONSE_INVALID',
        `La respuesta del producto no trae "${field}"`,
      );
    }
    return null;
  }
  // Se acepta número además de cadena: hay backends que devuelven identificadores
  // numéricos, y rechazarlos obligaría a cada producto a adaptarse a nosotros.
  if (typeof value !== 'string' && typeof value !== 'number') {
    throw new ProvisioningError(
      'PROVIDER_RESPONSE_INVALID',
      `El campo "${field}" debe ser texto o número`,
    );
  }
  const text = String(value).trim();
  if (text === '') {
    if (required) {
      throw new ProvisioningError(
        'PROVIDER_RESPONSE_INVALID',
        `El campo "${field}" llegó vacío`,
      );
    }
    return null;
  }
  if (text.length > MAX_ID_LENGTH) {
    throw new ProvisioningError(
      'PROVIDER_RESPONSE_INVALID',
      `El campo "${field}" excede ${MAX_ID_LENGTH} caracteres`,
    );
  }
  return text;
}

/**
 * Filtra `resources` a datos NO sensibles y acotados.
 *
 * Aquí caben cosas como `initialWarehouseId`. No caben claves, tokens ni
 * estructuras anidadas arbitrarias: la base tiene además su propio guard
 * anti-secretos, y esto evita llegar a él con algo que ya se sabe que sobra.
 */
export function sanitizeResources(raw: unknown): Record<string, unknown> {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {};

  const out: Record<string, unknown> = {};
  let count = 0;

  for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
    if (count >= MAX_RESOURCE_KEYS) break;
    if (FORBIDDEN_RESOURCE_KEYS.test(key)) continue;

    if (typeof value === 'string') {
      if (value.length > MAX_RESOURCE_VALUE_LENGTH) continue;
      out[key] = value;
    } else if (typeof value === 'number' || typeof value === 'boolean' || value === null) {
      out[key] = value;
    } else {
      // Objetos y arrays se descartan: sin un contrato que los describa, no hay
      // forma de saber qué llevan dentro.
      continue;
    }
    count += 1;
  }

  return out;
}

/**
 * Valida y normaliza la respuesta de creación.
 *
 * `status` sólo admite ACTIVE o PENDING. PENDING es legítimo: hay productos que
 * crean el tenant de forma asíncrona, y en ese caso el mapeo se registra pero la
 * solicitud no se declara ACTIVE hasta confirmarlo.
 */
export function parseProvisioningResponse(body: unknown): AdapterResult {
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    throw new ProvisioningError(
      'PROVIDER_RESPONSE_INVALID',
      'La respuesta del producto no es un objeto JSON',
    );
  }

  const record = body as Record<string, unknown>;

  const rawStatus = typeof record.status === 'string' ? record.status.trim().toUpperCase() : 'ACTIVE';
  if (rawStatus !== 'ACTIVE' && rawStatus !== 'PENDING') {
    throw new ProvisioningError(
      'PROVIDER_RESPONSE_INVALID',
      `Estado no contemplado en el contrato: "${rawStatus}". Sólo ACTIVE o PENDING`,
    );
  }

  const externalTenantId = readId(record.externalTenantId, 'externalTenantId', true) as string;

  return {
    status: rawStatus,
    externalTenantId,
    externalOrganizationId: readId(record.externalOrganizationId, 'externalOrganizationId', false),
    externalCompanyId: readId(record.externalCompanyId, 'externalCompanyId', false),
    resources: sanitizeResources(record.resources),
    rawReference: readId(record.rawReference ?? record.reference, 'rawReference', false),
  };
}
