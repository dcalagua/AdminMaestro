import { useState } from 'react';
import { FormDialog } from './FormDialog';
import { TextAreaField } from './fields';

/**
 * Revocación con MOTIVO obligatorio (enlace de pago, autorización de tarjeta).
 * El motivo queda en la auditoría; sin él no se llama a la RPC.
 */
export function RevokeWithReasonDialog({
  open,
  title,
  description,
  busy,
  onSubmit,
  onCancel,
}: {
  open: boolean;
  title: string;
  description: string;
  busy: boolean;
  onSubmit: (reason: string) => Promise<void>;
  onCancel: () => void;
}) {
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

  return (
    <FormDialog
      open={open}
      title={title}
      description={description}
      submitLabel="Revocar"
      busy={busy}
      error={error}
      onCancel={onCancel}
      onSubmit={() => {
        if (reason.trim() === '') {
          setError(new Error('MOTIVO_REQUERIDO: indica el motivo de la revocación.'));
          return;
        }
        setError(null);
        void onSubmit(reason.trim()).catch((e: unknown) => setError(e));
      }}
    >
      <TextAreaField
        label="Motivo"
        required
        value={reason}
        onChange={(e) => setReason(e.target.value)}
        hint="Queda en la auditoría."
      />
    </FormDialog>
  );
}

