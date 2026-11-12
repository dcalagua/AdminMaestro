import { useMemo, useState } from 'react';
import { FormDialog } from '@/components/ui/FormDialog';
import { SelectField, TextField } from '@/components/ui/fields';
import { formatMoney } from '@/lib/format';
import { mockToken } from './culqiCheckout';
import { type TokenRequest } from './portalModel';

/** Modo de prueba del portal: tarjeta simulada en lugar del checkout de Culqi. */
export function MockCardDialog({ request, onClose }: { request: TokenRequest | null; onClose: () => void }) {
  const [holder, setHolder] = useState('');
  const [outcome, setOutcome] = useState<'approve' | 'decline' | '3ds'>('approve');
  const amount = useMemo(
    () => (request ? formatMoney(request.amountMinor / 100, request.currency) : ''),
    [request],
  );

  return (
    <FormDialog
      open={Boolean(request)}
      title="Modo de prueba · tarjeta simulada"
      description={`Este entorno no tiene credenciales de Culqi: no se cobra ninguna tarjeta real. ${request?.description ?? ''} · ${amount}`}
      submitLabel="Continuar"
      onCancel={() => {
        request?.reject(null);
        onClose();
      }}
      onSubmit={() => {
        request?.resolve(mockToken(outcome));
        onClose();
      }}
    >
      <p className="rounded-field bg-warn-soft px-3 py-2 text-caption font-semibold text-warn">
        Modo de prueba: no escribas datos de una tarjeta real.
      </p>
      <TextField label="Titular (opcional)" value={holder} onChange={(e) => setHolder(e.target.value)} autoComplete="off" />
      <SelectField
        label="Resultado simulado"
        value={outcome}
        onChange={(e) => setOutcome(e.target.value as typeof outcome)}
        options={[
          { value: 'approve', label: 'Aprobada' },
          { value: 'decline', label: 'Rechazada por el emisor' },
          { value: '3ds', label: 'Requiere autenticación (3-D Secure)' },
        ]}
      />
    </FormDialog>
  );
}
