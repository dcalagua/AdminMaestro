import { useState } from 'react';
import { supabase } from '@/lib/supabase';
import { useToast } from '@/components/ui/toast-context';
import { businessErrorMessage } from '@/lib/pgError';

/**
 * Muestra la REFERENCIA del secreto, nunca su valor.
 *
 * Por qué hace falta un botón y no basta con leer la columna: `authenticated`
 * NO tiene privilegio de SELECT sobre `credential_profiles.secret_ref`. Es un
 * privilegio de COLUMNA, no una política, así que no hay consulta de PostgREST
 * que lo devuelva. El único camino es esta RPC, que exige
 * `platform.credentials.manage` y AUDITA cada lectura.
 *
 * Lo que aparece es un NOMBRE de secreto (`EWM_QAS_M2M_PRIVATE_KEY`). El valor
 * vive en el almacén de secretos del servidor y esta base no lo conoce.
 */
export function RevealSecretRefButton({ profileId, code }: { profileId: string; code: string }) {
  const toast = useToast();
  const [reference, setReference] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function reveal() {
    setBusy(true);
    try {
      const { data, error } = await supabase.rpc('reveal_credential_secret_ref', {
        p_id: profileId,
      });
      if (error) throw error;
      const payload = data as unknown as { secret_ref: string | null };
      setReference(payload.secret_ref ?? 'sin referencia');
    } catch (error) {
      toast.error('No se pudo consultar la referencia', businessErrorMessage(error));
    } finally {
      setBusy(false);
    }
  }

  if (reference) {
    return (
      <span
        className="font-mono text-[13px] text-accent-deep"
        title={`Nombre del secreto de ${code}. El valor vive en el servidor.`}
      >
        {reference}
      </span>
    );
  }

  return (
    <button type="button" className="ebim-btn-ghost" disabled={busy} onClick={() => void reveal()}>
      {busy ? 'Consultando…' : 'Ver referencia'}
    </button>
  );
}
