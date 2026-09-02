/**
 * Abstracción de proveedor de infraestructura.
 *
 * El Control Plane no habla de "Supabase" en su lógica de dominio: habla de un
 * `ProvisioningProvider`. Añadir AWS o Azure mañana es implementar esta
 * interfaz, no reescribir la máquina de estados.
 *
 * REGLA DE SEGURIDAD (prompt fase 8):
 * El token de la Management API llega SÓLO por `Deno.env` (Edge Function
 * secrets). No se acepta por parámetro, no se registra en eventos y no puede
 * viajar al navegador. `DryRunProvider` ni siquiera lo lee.
 */

export type ProvisioningAction =
  | 'CREATE_TENANT_SPACE'
  | 'CREATE_DEDICATED_TARGET'
  | 'ATTACH_TENANT_TO_TARGET'
  | 'SUSPEND_TENANT'
  | 'RESUME_TENANT'
  | 'DECOMMISSION_TENANT';

export interface ProvisioningInput {
  action: ProvisioningAction;
  /** Payload SIN secretos. La base rechaza claves con pinta de credencial. */
  payload: Record<string, unknown>;
  tenantId: string | null;
  deploymentTargetId: string | null;
}

export interface ProvisioningStep {
  status: 'VALIDATING' | 'RUNNING' | 'SUCCEEDED' | 'FAILED';
  message: string;
  /** Detalle SANITIZADO: nunca la respuesta cruda del proveedor. */
  detail: Record<string, unknown>;
}

export interface ProvisioningOutcome {
  ok: boolean;
  steps: ProvisioningStep[];
  result: Record<string, unknown>;
  /** Mensaje de error legible y sin datos sensibles. */
  errorMessage?: string;
}

export interface ProvisioningProvider {
  readonly name: string;
  readonly mode: 'DRY_RUN' | 'LIVE';
  execute(input: ProvisioningInput): Promise<ProvisioningOutcome>;
}

/** Validaciones comunes a cualquier proveedor. */
function validate(input: ProvisioningInput): string | null {
  const needsTenant: ProvisioningAction[] = [
    'CREATE_TENANT_SPACE',
    'ATTACH_TENANT_TO_TARGET',
    'SUSPEND_TENANT',
    'RESUME_TENANT',
    'DECOMMISSION_TENANT',
  ];
  if (needsTenant.includes(input.action) && !input.tenantId) {
    return `VALIDACION_FALLIDA: la acción ${input.action} requiere un tenant`;
  }
  if (input.action === 'ATTACH_TENANT_TO_TARGET' && !input.deploymentTargetId) {
    return 'VALIDACION_FALLIDA: ATTACH_TENANT_TO_TARGET requiere un deployment target';
  }
  return null;
}

/**
 * Proveedor por defecto. SIMULA la operación completa: produce el mismo timeline
 * y el mismo shape de resultado que haría el proveedor real, sin ninguna llamada
 * de red. Es lo que permite ejercitar y probar toda la máquina de estados sin
 * tocar infraestructura.
 */
export class DryRunProvider implements ProvisioningProvider {
  readonly name = 'dry-run';
  readonly mode = 'DRY_RUN' as const;

  execute(input: ProvisioningInput): Promise<ProvisioningOutcome> {
    const steps: ProvisioningStep[] = [
      {
        status: 'VALIDATING',
        message: 'Validando la solicitud (modo simulación)',
        detail: { action: input.action, checks: ['tenant', 'target', 'payload_sin_secretos'] },
      },
    ];

    const error = validate(input);
    if (error) {
      steps.push({ status: 'FAILED', message: error, detail: { retryable: false } });
      return Promise.resolve({ ok: false, steps, result: {}, errorMessage: error });
    }

    steps.push({
      status: 'RUNNING',
      message: 'Ejecutando en modo DRY_RUN: no se realiza ninguna llamada remota',
      detail: { mode: 'DRY_RUN' },
    });

    const wouldDo = PLANNED_EFFECTS[input.action];
    steps.push({
      status: 'SUCCEEDED',
      message: 'Simulación completada',
      detail: { simulated: true, would_perform: wouldDo },
    });

    return Promise.resolve({
      ok: true,
      steps,
      result: {
        simulated: true,
        action: input.action,
        would_perform: wouldDo,
        tenant_id: input.tenantId,
        deployment_target_id: input.deploymentTargetId,
      },
    });
  }
}

/** Lo que cada acción HARÍA en modo LIVE. Es la especificación del adapter real. */
const PLANNED_EFFECTS: Record<ProvisioningAction, string[]> = {
  CREATE_TENANT_SPACE: ['crear el espacio lógico del tenant', 'aplicar migraciones', 'sembrar roles base'],
  CREATE_DEDICATED_TARGET: ['crear el proyecto en el proveedor', 'fijar región y plan', 'registrar la referencia pública'],
  ATTACH_TENANT_TO_TARGET: ['asociar el tenant al target', 'validar capacidad', 'publicar la configuración'],
  SUSPEND_TENANT: ['revocar el acceso de la aplicación', 'conservar los datos'],
  RESUME_TENANT: ['restaurar el acceso de la aplicación'],
  DECOMMISSION_TENANT: ['exportar el respaldo final', 'liberar los recursos'],
};

/**
 * Adapter real contra la Supabase Management API.
 *
 * ESQUELETO A PROPÓSITO: la ejecución nocturna no debe crear ni destruir nada
 * remoto. El constructor exige el token desde el entorno del servidor y falla
 * ruidosamente si no está — así queda explícito dónde se integra mañana, en vez
 * de dejar un `TODO` que alguien complete pasando la clave por el frontend.
 */
export class SupabaseManagementProvider implements ProvisioningProvider {
  readonly name = 'supabase-management';
  readonly mode = 'LIVE' as const;

  private readonly token: string;

  constructor() {
    const token = Deno.env.get('SUPABASE_MANAGEMENT_TOKEN');
    if (!token) {
      throw new Error(
        'PROVIDER_SIN_CREDENCIAL: el modo LIVE exige SUPABASE_MANAGEMENT_TOKEN en los ' +
          'secrets de la Edge Function. Nunca se acepta por parámetro ni desde el cliente.',
      );
    }
    this.token = token;
  }

  execute(_input: ProvisioningInput): Promise<ProvisioningOutcome> {
    // Punto de integración. Al implementarse:
    //   · usar `this.token` sólo en la cabecera Authorization;
    //   · NUNCA volcar la respuesta cruda en provisioning_events (sanitizar);
    //   · respetar la clave de idempotencia para no duplicar proyectos;
    //   · exigir autorización explícita del operador antes de habilitar LIVE.
    void this.token;
    return Promise.reject(
      new Error(
        'MODO_LIVE_NO_HABILITADO: el provisioning real requiere autorización explícita ' +
          'del operador. Esta ejecución opera en DRY_RUN.',
      ),
    );
  }
}

/** Selecciona el proveedor según el entorno. DRY_RUN es el default seguro. */
export function resolveProvider(): ProvisioningProvider {
  const mode = Deno.env.get('PROVISIONING_MODE') ?? 'DRY_RUN';
  if (mode === 'LIVE') return new SupabaseManagementProvider();
  return new DryRunProvider();
}
