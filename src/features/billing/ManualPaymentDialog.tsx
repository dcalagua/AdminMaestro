import { useEffect, useState } from 'react';
import { FormDialog } from '@/components/ui/FormDialog';
import { NumberField, SelectField, TextField, TextAreaField, FieldRow } from '@/components/ui/fields';
import { useToast } from '@/components/ui/toast-context';
import { useConfirmManualPayment } from '@/services/mutations';
import { formatMoney } from '@/lib/format';

/**
 * Cobro manual de una factura (V3 · fase 17).
 *
 * La moneda NO se elige: es la de la factura, que es la del contrato. Un cobro
 * en otra moneda no existe en V3 (la base lo rechazaría con MONEDA_INCOHERENTE).
 * Confirmar el cobro devenga la comisión en esa misma moneda.
 */
const METHODS = [
  { value: 'BANK_TRANSFER', label: 'Transferencia bancaria' },
  { value: 'MANUAL', label: 'Acuerdo manual' },
  { value: 'CHECK', label: 'Cheque' },
  { value: 'CASH', label: 'Efectivo' },
];

export function ManualPaymentDialog({
  invoice,
  onClose,
}: {
  invoice: { id: string; number: string; currency: string; outstanding: number } | null;
  onClose: () => void;
}) {
  const toast = useToast();
  const confirm = useConfirmManualPayment();
  const [amount, setAmount] = useState('');
  const [reference, setReference] = useState('');
  const [method, setMethod] = useState('BANK_TRANSFER');
  const [notes, setNotes] = useState('');

  useEffect(() => {
    if (!invoice) return;
    confirm.reset();
    setAmount(String(invoice.outstanding));
    setReference('');
    setNotes('');
  }, [invoice?.id]);

  const invalid = !invoice || !(Number(amount) > 0) || !reference.trim();

  async function submit() {
    if (invalid || !invoice) return;
    try {
      await confirm.mutateAsync({
        p_invoice_id: invoice.id,
        p_amount: Number(amount),
        p_reference: reference.trim(),
        p_method: method,
        p_notes: notes.trim() || undefined,
      });
      toast.success('Cobro registrado', `${invoice.number}: ${formatMoney(Number(amount), invoice.currency)}`);
      onClose();
    } catch {
      /* visible en el diálogo */
    }
  }

  return (
    <FormDialog
      open={Boolean(invoice)}
      title={invoice ? `Registrar cobro · ${invoice.number}` : 'Registrar cobro'}
      description="Dinero que YA entró. Se registra en la moneda de la factura y devenga comisión en esa moneda."
      submitLabel="Confirmar cobro"
      busy={confirm.isPending}
      error={confirm.error}
      onSubmit={() => void submit()}
      onCancel={onClose}
    >
      <FieldRow>
        <NumberField
          label={`Importe (${invoice?.currency ?? '—'})`} required min={0} step="0.01"
          value={amount} onChange={(e) => setAmount(e.target.value)}
          hint={invoice ? `Pendiente: ${formatMoney(invoice.outstanding, invoice.currency)}` : undefined}
        />
        <TextField label="Moneda" value={invoice?.currency ?? ''} disabled hint="La de la factura: no se elige." />
      </FieldRow>
      <FieldRow>
        <TextField
          label="Referencia" required value={reference} onChange={(e) => setReference(e.target.value)}
          placeholder="Nº de operación o voucher"
        />
        <SelectField label="Método" options={METHODS} value={method} onChange={(e) => setMethod(e.target.value)} />
      </FieldRow>
      <TextAreaField label="Notas" value={notes} onChange={(e) => setNotes(e.target.value)} />
    </FormDialog>
  );
}
