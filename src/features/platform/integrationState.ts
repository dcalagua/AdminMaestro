import type { CellTone } from '@/components/ui/cells';
import type { IntegrationStatus } from '@/lib/provisioning';

/**
 * Estado de negocio de una integración (V6 · F1): combina `status` y `enabled`
 * en UNA insignia («Operativa», «Degradada», «Borrador», «Deshabilitada») en
 * lugar de dos («Lista» + «Habilitada»).
 */
export function integrationState(i: { status: string | null; enabled: boolean | null }): { label: string; tone: CellTone } {
  if (!i.enabled || i.status === 'DISABLED') return { label: 'Deshabilitada', tone: 'neutral' };
  switch (i.status as IntegrationStatus) {
    case 'READY':
      return { label: 'Operativa', tone: 'ok' };
    case 'DEGRADED':
      return { label: 'Degradada', tone: 'warn' };
    default:
      return { label: 'Borrador', tone: 'neutral' };
  }
}
