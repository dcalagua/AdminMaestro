import { z } from 'zod';

/**
 * Descriptor de UI por contrato de integración (`product_integrations.adapter_key`).
 *
 * Es el ÚNICO archivo de la consola que conoce contratos distintos del estándar:
 * etiqueta, datos de alta que pide cada uno y sus precargas. El resto de la UI
 * pregunta aquí y no ramifica por contrato.
 *
 * Esto es UX. La base valida forma y tamaño de `product_configuration` y el
 * orquestador valida la semántica antes de firmar nada.
 */

export const CONTRACT_ADAPTER_KEYS = ['GENERIC', 'EWM_V1'] as const;
export type ContractAdapterKey = (typeof CONTRACT_ADAPTER_KEYS)[number];

export interface ConfigurationField {
  /** Ruta del valor en `product_configuration` (react-hook-form la admite anidada). */
  name: string;
  label: string;
  kind: 'text' | 'checkbox';
  required?: boolean;
  placeholder?: string;
  hint?: string;
}

export interface PrefillInput {
  fullName: string | null;
  timezone: string | null;
}

export interface ContractAdapterDescriptor {
  label: string;
  /** Esquema de los datos de alta, o `null` si el contrato no pide ninguno. */
  configurationSchema: z.ZodType | null;
  fields: ConfigurationField[];
  prefill(input: PrefillInput): Record<string, unknown>;
}

const DEFAULT_TIMEZONE = 'America/Lima';
const WAREHOUSE_CODE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,31}$/;
/** Un dato de alta es DATO: nada que parezca URL o plantilla. */
const FORBIDDEN_VALUE = /^[a-z][a-z0-9+.-]*:\/\/|\$\{|\{\{/i;

function isTimezone(value: string): boolean {
  if (value.trim() === '') return false;
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: value });
    return true;
  } catch {
    return false;
  }
}

const text = (max: number) =>
  z
    .string()
    .trim()
    .min(1, 'Obligatorio')
    .max(max, `Máximo ${max} caracteres`)
    .refine((v) => !FORBIDDEN_VALUE.test(v), 'Valor no permitido');

const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max, `Máximo ${max} caracteres`)
    .refine((v) => !FORBIDDEN_VALUE.test(v), 'Valor no permitido')
    .nullable()
    .optional()
    .transform((v) => (v ? v : null));

const timezone = z.string().trim().refine(isTimezone, 'Zona horaria IANA inválida (ej. America/Lima)');

const ewmConfigurationSchema = z
  .object({
    organizationTimezone: timezone,
    initialWarehouse: z
      .object({
        code: z
          .string()
          .trim()
          .regex(WAREHOUSE_CODE, 'Letras, números, punto, guion o guion bajo; hasta 32'),
        name: text(200),
        timezone,
        erpCode: optionalText(32),
        address: optionalText(500),
        is3pl: z.boolean().optional().default(false),
      })
      .strict(),
    admin: z.object({ fullName: text(200) }).strict(),
  })
  .strict();

export const CONTRACT_ADAPTERS: Record<ContractAdapterKey, ContractAdapterDescriptor> = {
  GENERIC: {
    label: 'Estándar EBIM v1',
    configurationSchema: null,
    fields: [],
    prefill: () => ({}),
  },
  EWM_V1: {
    label: 'EWM v1',
    configurationSchema: ewmConfigurationSchema,
    fields: [
      { name: 'initialWarehouse.code', label: 'Código de almacén', kind: 'text', required: true, placeholder: 'WH-001' },
      { name: 'initialWarehouse.name', label: 'Nombre del almacén', kind: 'text', required: true, placeholder: 'Almacén Principal' },
      { name: 'initialWarehouse.timezone', label: 'Zona horaria del almacén', kind: 'text', required: true, placeholder: DEFAULT_TIMEZONE },
      { name: 'organizationTimezone', label: 'Zona horaria de la organización', kind: 'text', required: true, placeholder: DEFAULT_TIMEZONE },
      {
        name: 'admin.fullName',
        label: 'Nombre completo del administrador',
        kind: 'text',
        required: true,
        hint: 'El producto lo registra como administrador preaprovisionado: activa su cuenta al registrarse.',
      },
      { name: 'initialWarehouse.erpCode', label: 'Código ERP del almacén (opcional)', kind: 'text' },
      { name: 'initialWarehouse.address', label: 'Dirección del almacén (opcional)', kind: 'text' },
      { name: 'initialWarehouse.is3pl', label: 'Almacén de operador logístico (3PL)', kind: 'checkbox' },
    ],
    prefill: ({ fullName, timezone: tz }) => ({
      organizationTimezone: tz ?? DEFAULT_TIMEZONE,
      initialWarehouse: {
        code: '',
        name: '',
        timezone: tz ?? DEFAULT_TIMEZONE,
        erpCode: '',
        address: '',
        is3pl: false,
      },
      admin: { fullName: fullName ?? '' },
    }),
  },
};

export function contractAdapterFor(key: string | null | undefined): ContractAdapterDescriptor {
  return key && Object.prototype.hasOwnProperty.call(CONTRACT_ADAPTERS, key)
    ? CONTRACT_ADAPTERS[key as ContractAdapterKey]
    : CONTRACT_ADAPTERS.GENERIC;
}

export const CONTRACT_ADAPTER_OPTIONS = CONTRACT_ADAPTER_KEYS.map((value) => ({
  value,
  label: CONTRACT_ADAPTERS[value].label,
}));

/** Estado del administrador en el producto, en lenguaje de operador. */
const ADMIN_STATUS_LABEL: Record<string, string> = {
  PREPROVISIONED: 'Preaprovisionado',
};

export function adminStatusLabel(status: unknown): string | null {
  if (typeof status !== 'string' || status === '') return null;
  return ADMIN_STATUS_LABEL[status] ?? status;
}
