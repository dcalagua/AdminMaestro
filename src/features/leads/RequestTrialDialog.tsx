import { useMemo, useState } from 'react';
import { FormDialog } from '@/components/ui/FormDialog';
import { SelectField, TextAreaField, TextField } from '@/components/ui/fields';
import { useProducts, usePlans } from '@/services/queries';
import { COUNTRY_LABEL, trialDraftFrom } from './leadsModel';
import type { LeadWithRefs, RequestTrialInput } from './leadsApi';

type Draft = ReturnType<typeof trialDraftFrom>;

/**
 * «Pedir prueba» del comercial (perfil comercial, 2026-11-18). El comercial NO
 * crea el tenant: deja el pedido y EBIM lo aprueba creándolo con «Nueva venta»
 * (comercial ≠ acceso operativo). Desde una solicitud de la web llega con sus
 * datos; sin solicitud, se llena a mano.
 */
export function RequestTrialDialog({
  open,
  lead,
  busy,
  onSubmit,
  onCancel,
}: {
  open: boolean;
  /** La solicitud de la web de la que sale el pedido, si sale de una. */
  lead: LeadWithRefs | null;
  busy: boolean;
  onSubmit: (input: RequestTrialInput) => Promise<void>;
  onCancel: () => void;
}) {
  const products = useProducts({ enabled: open });
  const plans = usePlans();
  const planRows = useMemo(
    () => (plans.data ?? []).map((p) => ({ id: p.id, code: p.code, name: p.name, saas_product_id: p.saas_product_id, status: p.status })),
    [plans.data],
  );
  const [draft, setDraft] = useState<Draft>(() => trialDraftFrom(lead, planRows));
  const [error, setError] = useState<unknown>(null);
  const [shownFor, setShownFor] = useState<string | null | undefined>(undefined);
  // Al abrir (o al cambiar de solicitud) se propone de nuevo lo de la solicitud.
  const key = open ? (lead?.id ?? null) : undefined;
  if (key !== shownFor) {
    setShownFor(key);
    if (open) {
      setDraft(trialDraftFrom(lead, planRows));
      setError(null);
    }
  }

  const set = <K extends keyof Draft>(k: K, v: Draft[K]) => setDraft((d) => ({ ...d, [k]: v }));
  const productOptions = (products.data ?? [])
    .filter((p) => p.status === 'ACTIVE')
    .map((p) => ({ value: p.id, label: p.short_name }));
  const planOptions = planRows
    .filter((p) => p.saas_product_id === draft.productId && p.status === 'ACTIVE')
    .map((p) => ({ value: p.id, label: p.name }));

  return (
    <FormDialog
      open={open}
      title={lead ? `Pedir prueba para ${lead.company_name}` : 'Pedir una prueba'}
      description="EBIM revisa el pedido y crea el tenant de prueba. Te llega el aviso en la Bandeja cuando lo apruebe o lo rechace."
      submitLabel="Pedir prueba"
      busy={busy}
      error={error}
      wide
      onCancel={onCancel}
      onSubmit={() => {
        const missing = [
          !draft.productId && 'la app',
          draft.companyName.trim().length < 2 && 'la empresa',
          !draft.contactName.trim() && 'el contacto',
          !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(draft.adminEmail.trim()) && 'un correo válido del administrador',
        ].filter(Boolean);
        if (missing.length) {
          setError(new Error(`DATOS_INCOMPLETOS: falta ${missing.join(', ')}.`));
          return;
        }
        setError(null);
        void onSubmit({
          productId: draft.productId,
          planId: draft.planId || null,
          companyName: draft.companyName.trim(),
          contactName: draft.contactName.trim(),
          adminEmail: draft.adminEmail.trim(),
          countryCode: draft.countryCode || null,
          notes: draft.notes.trim() || null,
          leadId: draft.leadId,
        }).catch((e: unknown) => setError(e));
      }}
    >
      <div className="grid gap-4 sm:grid-cols-2">
        <SelectField
          label="App"
          required
          placeholder="Elige la app"
          options={productOptions}
          value={draft.productId}
          onChange={(e) => setDraft((d) => ({ ...d, productId: e.target.value, planId: '' }))}
        />
        <SelectField
          label="Plan"
          placeholder={planOptions.length ? 'El de la prueba por defecto' : 'Sin planes publicados'}
          options={planOptions}
          value={draft.planId}
          onChange={(e) => set('planId', e.target.value)}
          hint="Opcional: EBIM lo confirma al crear el tenant."
        />
        <TextField label="Empresa" required value={draft.companyName} onChange={(e) => set('companyName', e.target.value)} />
        <TextField label="Contacto" required value={draft.contactName} onChange={(e) => set('contactName', e.target.value)} />
        <TextField
          label="Correo del administrador"
          required
          type="email"
          value={draft.adminEmail}
          onChange={(e) => set('adminEmail', e.target.value)}
          hint="Recibe la invitación de la app cuando EBIM cree el tenant."
        />
        <SelectField
          label="País"
          placeholder="Sin indicar"
          options={Object.entries(COUNTRY_LABEL).map(([value, label]) => ({ value, label }))}
          value={draft.countryCode}
          onChange={(e) => set('countryCode', e.target.value)}
        />
      </div>
      <TextAreaField
        label="Nota para EBIM"
        value={draft.notes}
        onChange={(e) => set('notes', e.target.value)}
        hint="Qué quiere probar, urgencia, lo que hablaron."
      />
    </FormDialog>
  );
}
