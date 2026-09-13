import { useEffect, useState } from 'react';
import { Card, Badge, LoadingState, ErrorState } from '@/components/ui/primitives';
import { SelectField, NumberField } from '@/components/ui/fields';
import { useToast } from '@/components/ui/toast-context';
import { usePermissions } from '@/hooks/usePermissions';
import { useCurrencies, useReportingSettings } from '@/services/queries';
import { useSetReportingSettings } from '@/services/mutations';
import { businessErrorMessage } from '@/lib/pgError';

/**
 * Moneda de reporte (V3 · fase 09).
 *
 * Es una LENTE gerencial: cambiarla no toca ni un importe. Cada documento sigue
 * en su moneda; el consolidado muestra además el equivalente con la tasa usada.
 * Solo EBIM_FINANCE o el super admin la cambian (la base lo exige: 42501).
 */
export function ReportingCurrencyPanel() {
  const toast = useToast();
  const perms = usePermissions();
  const settings = useReportingSettings();
  const currencies = useCurrencies();
  const save = useSetReportingSettings();

  const [currency, setCurrency] = useState('');
  const [maxAge, setMaxAge] = useState('');

  useEffect(() => {
    if (!settings.data) return;
    setCurrency(settings.data.reporting_currency ?? '');
    setMaxAge(String(settings.data.fx_max_rate_age_days ?? ''));
  }, [settings.data]);

  if (settings.isLoading || currencies.isLoading) return <LoadingState />;
  if (settings.error) return <ErrorState error={settings.error} onRetry={() => void settings.refetch()} />;

  const active = (currencies.data ?? []).filter((c) => c.status === 'ACTIVE');
  const canEdit = perms.canReadFinance;
  const dirty =
    currency !== (settings.data?.reporting_currency ?? '') ||
    maxAge !== String(settings.data?.fx_max_rate_age_days ?? '');

  async function submit() {
    try {
      await save.mutateAsync({
        p_reporting_currency: currency,
        p_fx_max_rate_age_days: maxAge === '' ? undefined : Number(maxAge),
      });
      toast.success('Moneda de reporte actualizada', `El consolidado se expresa ahora en ${currency}.`);
    } catch {
      /* el error se muestra bajo el formulario */
    }
  }

  return (
    <Card
      title="Moneda de reporte"
      description="Lente del consolidado gerencial. No convierte ni reescribe documentos: PEN 5 000 sigue siendo PEN 5 000."
      actions={
        <Badge tone="accent">
          Actual: {settings.data?.reporting_currency ?? 'sin configurar'}
        </Badge>
      }
    >
      <div className="grid gap-4 p-4 sm:grid-cols-2">
        <SelectField
          label="Moneda de reporte"
          value={currency}
          onChange={(e) => setCurrency(e.target.value)}
          disabled={!canEdit}
          options={active.map((c) => ({ value: c.code, label: `${c.code} · ${c.name}` }))}
          hint="Solo monedas activas del catálogo."
        />
        <NumberField
          label="Antigüedad máxima de la tasa (días)"
          min={0}
          max={366}
          step={1}
          value={maxAge}
          onChange={(e) => setMaxAge(e.target.value)}
          disabled={!canEdit}
          hint="Una tasa más antigua no se usa: el consolidado marca la conversión como faltante."
        />
      </div>

      {save.error ? (
        <p className="mx-4 mb-3 rounded-lg bg-danger-soft px-3 py-2 text-sm text-danger" role="alert">
          {businessErrorMessage(save.error)}
        </p>
      ) : null}

      <div className="flex items-center justify-between gap-3 border-t border-border px-4 py-3">
        <p className="text-xs text-muted">
          {canEdit
            ? 'El cambio queda en auditoría (REPORTING_SETTINGS_CHANGED).'
            : 'Solo EBIM_FINANCE o el super admin pueden cambiarla.'}
        </p>
        {canEdit ? (
          <button
            type="button"
            className="ebim-btn-primary"
            disabled={!dirty || !currency || save.isPending}
            onClick={() => void submit()}
          >
            {save.isPending ? 'Guardando…' : 'Guardar'}
          </button>
        ) : null}
      </div>
    </Card>
  );
}
