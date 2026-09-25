import { useEffect } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { FormDialog } from '@/components/ui/FormDialog';
import { TextField, SelectField, CheckboxField, FieldRow } from '@/components/ui/fields';
import { useToast } from '@/components/ui/toast-context';
import { useMarkets } from '@/services/queries';
import { useUpsertCompany } from '@/services/mutations';

/**
 * Alta / edición de una SOCIEDAD de la organización (spec §11.4).
 *
 * Conecta el contrato EXISTENTE `platform.upsert_company`: la base decide quién
 * puede (`can_manage_platform_entities` o admin de la organización) y valida
 * mercado, país y moneda. La UI sólo ofrece la acción a quien el permiso espejo
 * `canManageOrganization` permite; si la base la rechaza, se muestra su motivo.
 */
export interface CompanyDraft {
  id: string;
  name: string;
  tax_id: string | null;
  erp_code: string | null;
  market_code: string | null;
  is_default: boolean;
}

const schema = z.object({
  name: z.string().trim().min(2, 'Nombre de la sociedad'),
  tax_id: z.string().trim().optional(),
  erp_code: z.string().trim().optional(),
  market_code: z.string().min(1, 'Elige el mercado'),
  is_default: z.boolean(),
});

type Values = z.infer<typeof schema>;

export function CompanyFormDialog({
  open,
  organizationId,
  company,
  onClose,
}: {
  open: boolean;
  organizationId: string;
  company: CompanyDraft | null;
  onClose: () => void;
}) {
  const markets = useMarkets();
  const upsert = useUpsertCompany();
  const toast = useToast();
  const form = useForm<Values>({
    resolver: zodResolver(schema),
    defaultValues: { name: '', tax_id: '', erp_code: '', market_code: '', is_default: false },
  });

  useEffect(() => {
    if (!open) return;
    form.reset({
      name: company?.name ?? '',
      tax_id: company?.tax_id ?? '',
      erp_code: company?.erp_code ?? '',
      market_code: company?.market_code ?? '',
      is_default: company?.is_default ?? false,
    });
  }, [open, company, form]);

  const submit = form.handleSubmit(async (v) => {
    try {
      await upsert.mutateAsync({
        p_id: company?.id,
        p_organization_id: organizationId,
        p_name: v.name,
        p_tax_id: v.tax_id || undefined,
        p_erp_code: v.erp_code || undefined,
        p_market_code: v.market_code,
        p_is_default: v.is_default,
      });
      toast.success(company ? 'Sociedad actualizada' : 'Sociedad creada', v.name);
      onClose();
    } catch {
      /* el error de negocio queda visible en el diálogo */
    }
  });

  return (
    <FormDialog
      open={open}
      title={company ? `Editar sociedad · ${company.name}` : 'Nueva sociedad'}
      description="Multipaís dentro de la misma cuenta (contrato §3.1). El mercado fija país y moneda; el código ERP es un atributo, no una clave."
      submitLabel={company ? 'Guardar cambios' : 'Crear sociedad'}
      busy={upsert.isPending}
      error={upsert.error}
      onSubmit={() => void submit()}
      onCancel={onClose}
    >
      <TextField label="Nombre de la sociedad" required error={form.formState.errors.name} {...form.register('name')} />
      <FieldRow>
        <SelectField
          label="Mercado"
          required
          placeholder="Elige el mercado"
          error={form.formState.errors.market_code}
          options={(markets.data ?? []).map((m) => ({ value: m.code, label: `${m.name} (${m.code})` }))}
          {...form.register('market_code')}
        />
        <TextField label="Identificación tributaria" error={form.formState.errors.tax_id} {...form.register('tax_id')} />
      </FieldRow>
      <TextField
        label="Código ERP"
        hint="Atributo informativo: se repite entre países y nunca identifica a la sociedad."
        error={form.formState.errors.erp_code}
        {...form.register('erp_code')}
      />
      <CheckboxField label="Sociedad principal" hint="La que se usa por defecto al facturar." {...form.register('is_default')} />
    </FormDialog>
  );
}
