import { Badge } from '@/components/ui/primitives';
import { UNDECIDED_HELP, undecidedText } from './usageLabels';

/**
 * Decisión de negocio abierta (spec CCP §20). Se pinta como «No decidido» y
 * nunca como 0, vacío ni «gratis»: un nulo comercial no es un valor. El código
 * de la decisión (D-xx) queda en `data-decision`, no en pantalla (V6 · F5).
 */
export function Undecided({ code }: { code: string }) {
  return (
    <span data-decision={code} className="inline-flex max-w-full">
      <Badge tone="warn" title={UNDECIDED_HELP}>
        {undecidedText(code)}
      </Badge>
    </span>
  );
}
