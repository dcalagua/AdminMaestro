/**
 * Adaptador MOCK — SÓLO DEV.
 *
 * Permite recorrer el flujo entero (PENDING → PROVISIONING → ACTIVE), incluida
 * la escritura del mapeo externo, sin contactar con ningún SaaS. Es lo que hace
 * que el E2E pruebe la orquestación de verdad en lugar de simularla.
 *
 * FALLA CERRADO FUERA DE DEV. La comprobación está aquí, además de en el
 * trigger de la base y en las precondiciones, porque las tres capas protegen del
 * mismo desastre concreto: un MOCK activo en QAS o PRD declararía ACTIVE un
 * tenant que no existe en ninguna parte, y nadie lo descubriría hasta que el
 * cliente intentara entrar.
 */
import type {
  AdapterOutcome,
  ProvisioningAdapter,
  ProvisioningContext,
} from '../types.ts';

export class MockAdapter implements ProvisioningAdapter {
  readonly type = 'MOCK' as const;

  provision(context: ProvisioningContext): Promise<AdapterOutcome> {
    const blocked = this.environmentGuard(context);
    if (blocked) return Promise.resolve(blocked);

    const code = context.payload.tenantCode;

    return Promise.resolve({
      ok: true,
      attempts: 1,
      result: {
        status: 'ACTIVE',
        // Identificadores deterministas y con prefijo `mock-`: en cuanto uno
        // aparece en un entorno que no es DEV, salta a la vista.
        externalTenantId: `mock-tenant-${code}`,
        externalOrganizationId: `mock-org-${code}`,
        externalCompanyId: context.payload.company ? `mock-company-${code}` : null,
        resources: {
          simulated: true,
          contractVersion: context.integration?.contract_version ?? 'v1',
          environment: context.request.environment,
        },
        rawReference: `mock-${context.request.correlation_id}`,
      },
    });
  }

  getStatus(context: ProvisioningContext): Promise<AdapterOutcome> {
    return this.provision(context);
  }

  private environmentGuard(context: ProvisioningContext): AdapterOutcome | null {
    if (context.request.environment === 'DEV') return null;
    return {
      ok: false,
      attempts: 0,
      failure: {
        code: 'MOCK_NOT_ALLOWED_IN_ENVIRONMENT',
        message:
          `El adaptador MOCK no puede ejecutarse en ${context.request.environment}: ` +
          'declararía ACTIVE un tenant que no existe en ningún producto.',
        httpStatus: null,
        retryable: false,
        detail: { environment: context.request.environment },
      },
    };
  }
}
