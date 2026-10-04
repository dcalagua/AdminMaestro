import { Badge } from '@/components/ui/primitives';
import { undecidedText } from './usageLabels';

/**
 * Decisión de negocio abierta (spec CCP §20). Se pinta como «No decidido
 * (D-xx)» y nunca como 0, vacío ni «gratis»: un nulo comercial no es un valor.
 */
export function Undecided({ code }: { code: string }) {
  return <Badge tone="warn">{undecidedText(code)}</Badge>;
}
