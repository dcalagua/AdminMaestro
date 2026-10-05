import { useId, useState } from 'react';
import { FormDialog } from '@/components/ui/FormDialog';
import { TextAreaField } from '@/components/ui/fields';
import { useSetPaymentProviderSecret } from '@/services/mutations';
import { useToast } from '@/components/ui/toast-context';
import { validateSecretKey } from './providerAccountForm';

export interface SecretTarget {
  id: string;
  code: string;
  environment: 'TEST' | 'LIVE';
  /** Pista de la llave vigente (`sk_test_…abcd`), si ya hay una. */
  hint: string | null;
}

/**
 * «Configurar llave» / «Reemplazar» de una cuenta Culqi. Spec §11.
 *
 * La llave se escribe UNA vez y viaja solo a `set_payment_provider_secret`, que
 * la guarda cifrada en Vault y devuelve únicamente la pista. Reglas de este
 * componente:
 *   · el campo es de tipo contraseña (con «Mostrar»), sin autocompletar ni
 *     corrector, y se VACÍA tras cada envío, salga bien o mal;
 *   · el valor no pasa por React Query (ver `useSetPaymentProviderSecret`), ni
 *     por localStorage, ni por ningún log; los errores no lo repiten;
 *   · al cerrar el diálogo el estado se descarta (el componente se desmonta).
 */
export function ProviderSecretDialog({ target, onClose }: { target: SecretTarget | null; onClose: () => void }) {
  if (!target) return null;
  // `key`: cada apertura parte de un estado vacío, aunque sea la misma cuenta.
  return <SecretForm key={`${target.id}:${target.hint ?? ''}`} target={target} onClose={onClose} />;
}

function SecretForm({ target, onClose }: { target: SecretTarget; onClose: () => void }) {
  const setSecret = useSetPaymentProviderSecret();
  const toast = useToast();
  const inputId = useId();
  const [value, setValue] = useState('');
  const [reveal, setReveal] = useState(false);
  const [reason, setReason] = useState('');
  const [fieldError, setFieldError] = useState<string | null>(null);
  const [serverError, setServerError] = useState<unknown>(null);

  const replacing = Boolean(target.hint);

  async function submit() {
    const problem = validateSecretKey(value, target.environment);
    if (problem) {
      setFieldError(problem);
      setValue('');
      return;
    }
    setFieldError(null);
    setServerError(null);
    // Se toma el valor y se vacía el campo ANTES de la llamada: pase lo que pase,
    // la llave no se queda en el estado del componente.
    const secret = value.trim();
    setValue('');
    setReveal(false);
    try {
      const result = (await setSecret.mutateAsync({
        p_account_id: target.id,
        p_secret: secret,
        p_reason: reason.trim() || undefined,
      })) as { hint?: string } | null;
      toast.success(replacing ? 'Llave reemplazada' : 'Llave configurada', `${target.code} · ${result?.hint ?? ''}`.trim());
      onClose();
    } catch (error) {
      setServerError(error);
    }
  }

  return (
    <FormDialog
      open
      title={replacing ? 'Reemplazar llave secreta' : 'Configurar llave secreta'}
      description={`Cuenta ${target.code}. La llave se guarda cifrada en el servidor y no vuelve a mostrarse: después solo verás su pista.`}
      submitLabel={replacing ? 'Reemplazar' : 'Configurar llave'}
      busy={setSecret.isPending}
      error={serverError}
      onCancel={onClose}
      onSubmit={() => void submit()}
    >
      {target.environment === 'LIVE' ? (
        <p className="rounded-lg bg-warn-soft px-3 py-2 text-sm text-warn" role="note">
          Cuenta <strong>LIVE</strong>: esta llave cobra dinero real. Además el servidor exige{' '}
          <span className="font-mono">CULQI_ALLOW_LIVE=true</span>, que no se cambia desde esta consola.
        </p>
      ) : null}
      {replacing ? (
        <p className="text-sm text-muted">
          Llave actual: <span className="font-mono">{target.hint}</span>. La nueva la sustituye en cuanto guardes.
        </p>
      ) : null}
      <div>
        <label className="ebim-label" htmlFor={inputId}>
          Llave secreta<span className="ml-0.5 text-danger">*</span>
        </label>
        <div className="flex gap-2">
          <input
            id={inputId}
            type={reveal ? 'text' : 'password'}
            className="ebim-input font-mono"
            value={value}
            autoComplete="off"
            autoCorrect="off"
            autoCapitalize="off"
            spellCheck={false}
            data-1p-ignore
            data-lpignore="true"
            placeholder={target.environment === 'LIVE' ? 'sk_live_…' : 'sk_test_…'}
            aria-invalid={fieldError ? true : undefined}
            aria-describedby={`${inputId}-msg`}
            onChange={(e) => setValue(e.target.value)}
          />
          <button
            type="button"
            className="ebim-btn-ghost shrink-0"
            aria-pressed={reveal}
            aria-controls={inputId}
            onClick={() => setReveal((r) => !r)}
          >
            {reveal ? 'Ocultar' : 'Mostrar'}
          </button>
        </div>
        {fieldError ? (
          <p id={`${inputId}-msg`} className="mt-1 text-xs text-danger" role="alert">
            {fieldError}
          </p>
        ) : (
          <p id={`${inputId}-msg`} className="mt-1 text-xs text-muted">
            {target.environment === 'LIVE' ? 'sk_live_…' : 'sk_test_…'} del panel de Culqi. Se envía una sola vez y el campo se
            vacía al guardar.
          </p>
        )}
      </div>
      <TextAreaField
        label="Motivo (opcional)"
        value={reason}
        onChange={(e) => setReason(e.target.value)}
        hint="Queda en la auditoría junto a la pista de la llave. No pegues la llave aquí."
      />
    </FormDialog>
  );
}
