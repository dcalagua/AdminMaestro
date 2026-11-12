import { PROVISIONING_STATUS_LABEL } from '@/types/domain';

/** Acción de una solicitud de infraestructura en español (U-13); un código nuevo se muestra tal cual. */
export const PROVISIONING_ACTION_LABEL: Record<string, string> = {
  CREATE_TENANT_SPACE: 'Crear espacio de tenant',
  CREATE_DEDICATED_TARGET: 'Crear infraestructura dedicada',
  ATTACH_TENANT_TO_TARGET: 'Adjuntar tenant a destino',
  SUSPEND_TENANT: 'Suspender tenant',
  RESUME_TENANT: 'Reanudar tenant',
  DECOMMISSION_TENANT: 'Dar de baja tenant',
};

export function provisioningStatusLabel(status: string): string {
  return PROVISIONING_STATUS_LABEL[status as keyof typeof PROVISIONING_STATUS_LABEL] ?? status;
}

export function provisioningRequestTone(status: string): 'ok' | 'danger' | 'warn' | 'neutral' {
  if (status === 'SUCCEEDED') return 'ok';
  if (status === 'FAILED') return 'danger';
  if (status === 'CANCELLED') return 'neutral';
  return 'warn';
}
