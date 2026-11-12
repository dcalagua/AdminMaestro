import { ENVIRONMENT_ORDER, isEvaluable } from '@/features/platform/targetHealth';
import {
  PROVISIONING_ENVIRONMENT_LABEL,
  canRetry,
  providerErrorLabel,
  type ProvisioningEnvironment,
  type SaasProvisioningStatus,
  type Tone,
} from '@/lib/provisioning';
import type { ProvisioningRow, TargetRow } from '@/features/suite/suiteModel';

/**
 * Modelo del flujo guiado de alta de cliente (V5 · F4). Sin estado ni UI: el
 * hilo de fases, el resultado del alta por app y el progreso de un cliente,
 * todo calculado con datos que ya existen. La base sigue decidiendo.
 */

// ---------------------------------------------------------------------------
// Hilo del flujo
// ---------------------------------------------------------------------------

export type FlowMode = 'SALE' | 'APP';

export interface FlowStep {
  id: number;
  label: string;
  /** Fase del hilo visible a la que pertenece el paso. */
  phase: string;
}

export interface FlowPhase {
  id: string;
  label: string;
}

/** Venta completa: cuenta → plan y precio → contrato → primera factura → enlace de pago → alta en las apps. */
export const SALE_PHASES: FlowPhase[] = [
  { id: 'cuenta', label: 'Cuenta' },
  { id: 'plan', label: 'Plan y precio' },
  { id: 'contrato', label: 'Contrato' },
  { id: 'factura', label: 'Primera factura' },
  { id: 'enlace', label: 'Enlace de pago' },
  { id: 'alta', label: 'Alta en las apps' },
];

export const SALE_STEPS: FlowStep[] = [
  { id: 1, label: 'Cliente, mercado y producto', phase: 'cuenta' },
  { id: 2, label: 'Canal y modelo', phase: 'cuenta' },
  { id: 3, label: 'Plan y precio regional', phase: 'plan' },
  { id: 4, label: 'Implementación y comercial', phase: 'plan' },
  { id: 5, label: 'Resumen del contrato', phase: 'contrato' },
  { id: 6, label: 'Primera factura', phase: 'factura' },
  { id: 7, label: 'Enlace de pago', phase: 'enlace' },
  { id: 8, label: 'Alta en las apps', phase: 'alta' },
];

/** «Nuevo tenant» para una cuenta existente: sólo el alta en una app. */
export const APP_PHASES: FlowPhase[] = [
  { id: 'cuenta', label: 'Cuenta y app' },
  { id: 'tenant', label: 'Tenant' },
  { id: 'alta', label: 'Alta en la app' },
];

export const APP_STEPS: FlowStep[] = [
  { id: 1, label: 'Cuenta y app', phase: 'cuenta' },
  { id: 2, label: 'Tenant', phase: 'tenant' },
  { id: 3, label: 'Alta en la app', phase: 'alta' },
];

export function flowFor(mode: FlowMode): { steps: FlowStep[]; phases: FlowPhase[]; createStep: number } {
  return mode === 'APP'
    ? { steps: APP_STEPS, phases: APP_PHASES, createStep: 2 }
    : { steps: SALE_STEPS, phases: SALE_PHASES, createStep: 5 };
}

// ---------------------------------------------------------------------------
// Alta en cada app
// ---------------------------------------------------------------------------

export type AltaOutcome = 'NONE' | 'READY' | 'RUNNING' | 'PENDING' | 'ACTIVE' | 'FAILED';

export interface AltaState {
  outcome: AltaOutcome;
  label: string;
  tone: Tone;
  reason: string | null;
  requestId: string | null;
  /** El mismo intento puede volver a lanzarse (quedan intentos). */
  canRetrySame: boolean;
}

/** Resultado del alta de un tenant en su app, en lenguaje de negocio. */
export function altaState(request: Pick<ProvisioningRow, 'id' | 'status' | 'attempt_count' | 'max_attempts' | 'last_error_code' | 'last_error_message'> | null | undefined): AltaState {
  const status = request?.status as SaasProvisioningStatus | null | undefined;
  const id = request?.id ?? null;
  switch (status) {
    case 'ACTIVE':
      return { outcome: 'ACTIVE', label: 'Activo', tone: 'ok', reason: null, requestId: id, canRetrySame: false };
    case 'FAILED':
      return {
        outcome: 'FAILED',
        label: 'Falló',
        tone: 'danger',
        reason: providerErrorLabel(request?.last_error_code) ?? request?.last_error_message ?? 'La app rechazó el alta sin detalle.',
        requestId: id,
        canRetrySame: canRetry('FAILED', request?.attempt_count ?? 0, request?.max_attempts ?? 0),
      };
    case 'READY_TO_PROVISION':
      return { outcome: 'READY', label: 'Lista para ejecutar', tone: 'info', reason: null, requestId: id, canRetrySame: false };
    case 'PROVISIONING':
      return { outcome: 'RUNNING', label: 'En curso', tone: 'info', reason: 'La app está creando el tenant.', requestId: id, canRetrySame: false };
    case 'PENDING':
      return {
        outcome: 'PENDING',
        label: 'Pendiente',
        tone: 'warn',
        reason: 'Espera la condición de la política de alta de la app (por ejemplo, el contrato activo o el pago).',
        requestId: id,
        canRetrySame: false,
      };
    case 'WAITING_INFRA':
      return {
        outcome: 'PENDING',
        label: 'Pendiente',
        tone: 'warn',
        reason: 'Falta la infraestructura del destino en ese ambiente.',
        requestId: id,
        canRetrySame: false,
      };
    case 'CANCELLED':
      return { outcome: 'NONE', label: 'Sin alta', tone: 'neutral', reason: 'La solicitud anterior se canceló.', requestId: null, canRetrySame: false };
    default:
      return { outcome: 'NONE', label: 'Sin alta', tone: 'neutral', reason: null, requestId: null, canRetrySame: false };
  }
}

/**
 * Ambientes donde la app tiene un destino con las altas habilitadas, del más
 * productivo al menos. El primero es el sugerido; sin ninguno, no hay alta.
 */
export function altaEnvironments(
  targets: readonly Pick<TargetRow, 'saas_product_id' | 'provisioning_enabled' | 'provisioning_status' | 'provisioning_environment'>[],
  productId: string,
): Array<{ value: ProvisioningEnvironment; label: string }> {
  const envs = new Set(
    targets
      .filter((t) => t.saas_product_id === productId && isEvaluable(t))
      .map((t) => t.provisioning_environment)
      .filter((e): e is ProvisioningEnvironment => Boolean(e)),
  );
  return [...ENVIRONMENT_ORDER]
    .reverse()
    .filter((e) => envs.has(e))
    .map((e) => ({ value: e, label: PROVISIONING_ENVIRONMENT_LABEL[e] }));
}

// ---------------------------------------------------------------------------
// Hilo de progreso de un cliente (ficha 360)
// ---------------------------------------------------------------------------

export type ProgressState = 'done' | 'todo' | 'unknown';

export interface ProgressStep {
  id: 'cuenta' | 'contrato' | 'factura' | 'enlace' | 'pago' | 'alta';
  label: string;
  state: ProgressState;
  detail: string;
}

export interface ProgressInput {
  /** Contratos vigentes o en borrador de la cuenta. */
  contracts: number;
  /** `null` = no visible para el rol (sin vista financiera). */
  invoicesIssued: number | null;
  paymentLinks: number | null;
  paid: boolean | null;
  apps: ReadonlyArray<{ name: string; active: boolean }>;
}

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

/** En qué paso del alta quedó un cliente, con el siguiente por hacer. */
export function customerProgress(input: ProgressInput): { steps: ProgressStep[]; next: ProgressStep | null } {
  const hidden = 'Visible con permisos de finanzas';
  const activeApps = input.apps.filter((a) => a.active).length;
  const steps: ProgressStep[] = [
    { id: 'cuenta', label: 'Cuenta', state: 'done', detail: 'Registrada' },
    {
      id: 'contrato',
      label: 'Contrato',
      state: input.contracts > 0 ? 'done' : 'todo',
      detail: input.contracts > 0 ? plural(input.contracts, 'contrato', 'contratos') : 'Sin contrato',
    },
    {
      id: 'factura',
      label: 'Primera factura',
      state: input.invoicesIssued === null ? 'unknown' : input.invoicesIssued > 0 ? 'done' : 'todo',
      detail:
        input.invoicesIssued === null
          ? hidden
          : input.invoicesIssued > 0
            ? plural(input.invoicesIssued, 'factura emitida', 'facturas emitidas')
            : 'Sin facturas emitidas',
    },
    {
      id: 'enlace',
      label: 'Enlace de pago',
      state: input.paymentLinks === null ? 'unknown' : input.paymentLinks > 0 ? 'done' : 'todo',
      detail:
        input.paymentLinks === null
          ? hidden
          : input.paymentLinks > 0
            ? plural(input.paymentLinks, 'enlace generado', 'enlaces generados')
            : 'Sin enlace de pago',
    },
    {
      id: 'pago',
      label: 'Pago',
      state: input.paid === null ? 'unknown' : input.paid ? 'done' : 'todo',
      detail: input.paid === null ? hidden : input.paid ? 'Con cobros confirmados' : 'Sin cobros confirmados',
    },
    {
      id: 'alta',
      label: 'Alta en las apps',
      state: input.apps.length > 0 && activeApps === input.apps.length ? 'done' : 'todo',
      detail:
        input.apps.length === 0
          ? 'Sin tenants en la suite'
          : `${activeApps} de ${plural(input.apps.length, 'app activa', 'apps activas')}`,
    },
  ];
  return { steps, next: steps.find((s) => s.state === 'todo') ?? null };
}
