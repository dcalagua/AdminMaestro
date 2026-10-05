import { useState } from 'react';
import { useSetSubscriptionBillingChannel } from '@/services/mutations';
import { FormDialog } from '@/components/ui/FormDialog';
import { TextAreaField } from '@/components/ui/fields';
import { useToast } from '@/components/ui/toast-context';
import { BILLING_CHANNEL } from '@/features/partnerFees/feeLabels';

/**
 * Corrige el canal de facturación de un contrato (M3, spec §4.2):
 *   · DIRECT: EBIM factura al cliente final;
 *   · PARTNER_STATEMENT: el partner factura al cliente y EBIM le cobra la
 *     tarifa de plataforma. La base exige un partner que facture el producto.
 */
export function BillingChannelDialog({
  open,
  subscriptionId,
  subscriptionCode,
  current,
  onClose,
}: {
  open: boolean;
  subscriptionId: string;
  subscriptionCode: string;
  current: string;
  onClose: () => void;
}) {
  const toast = useToast();
  const setChannel = useSetSubscriptionBillingChannel();
  const [reason, setReason] = useState('');
  const [error, setError] = useState<unknown>(null);
  const [wasOpen, setWasOpen] = useState(open);
  if (wasOpen !== open) {
    setWasOpen(open);
    if (open) {
      setReason('');
      setError(null);
    }
  }
  const target = current === 'PARTNER_STATEMENT' ? 'DIRECT' : 'PARTNER_STATEMENT';

  async function submit() {
    if (reason.trim().length < 3) {
      setError(new Error('MOTIVO_REQUERIDO: indica el motivo del cambio.'));
      return;
    }
    try {
      await setChannel.mutateAsync({ p_subscription_id: subscriptionId, p_channel: target, p_reason: reason.trim() });
      toast.success('Canal de facturación actualizado', `${subscriptionCode}: ${BILLING_CHANNEL[target]?.label ?? target}`);
      onClose();
    } catch (e) {
      setError(e);
    }
  }

  return (
    <FormDialog
      open={open}
      title={`Canal de facturación · ${subscriptionCode}`}
      description={
        target === 'PARTNER_STATEMENT'
          ? 'Pasa a «Factura el partner»: EBIM deja de emitir facturas al cliente final de este contrato y cobra al partner la tarifa de plataforma. Requiere que el partner que gestiona el tenant facture este producto.'
          : 'Pasa a «EBIM factura al cliente»: este contrato vuelve a facturarse desde Facturación y cobros.'
      }
      submitLabel={target === 'PARTNER_STATEMENT' ? 'Pasar a factura del partner' : 'Pasar a factura de EBIM'}
      busy={setChannel.isPending}
      error={error}
      onSubmit={() => void submit()}
      onCancel={onClose}
    >
      <TextAreaField label="Motivo" required hint="Queda en la auditoría del contrato." value={reason}
        onChange={(e) => setReason(e.target.value)} />
    </FormDialog>
  );
}
