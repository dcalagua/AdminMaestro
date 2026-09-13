import { useMemo, useState } from 'react';
import {
  Card, Badge, DataTable, EmptyState, LoadingState, ErrorState, SearchBar,
} from '@/components/ui/primitives';
import { FormDialog } from '@/components/ui/FormDialog';
import { SelectField, NumberField, TextField, TextAreaField, FieldRow } from '@/components/ui/fields';
import { useToast } from '@/components/ui/toast-context';
import { usePermissions } from '@/hooks/usePermissions';
import { useSearchFilter } from '@/hooks/useSearchFilter';
import { useCurrencies, useExchangeRates } from '@/services/queries';
import { usePublishExchangeRate, useVoidExchangeRate } from '@/services/mutations';
import { supabase } from '@/lib/supabase';
import { formatDate, formatMoney } from '@/lib/format';
import { businessErrorMessage } from '@/lib/pgError';

/**
 * Tipos de cambio MANUAL (V3 · fase 08/12).
 *
 * Solo para REPORTING: ninguna factura, cobro ni comisión se convierte con esto.
 * Una tasa no se edita: publicar otra para la misma fecha la sustituye y anular
 * exige motivo. Las tasas DEMO del seed se rotulan: no son cotizaciones.
 */

type RateStatus = 'ACTIVE' | 'SUPERSEDED' | 'VOIDED';
const STATUS_LABEL: Record<RateStatus, string> = {
  ACTIVE: 'Vigente',
  SUPERSEDED: 'Sustituida',
  VOIDED: 'Anulada',
};
const STATUS_TONE: Record<RateStatus, 'ok' | 'neutral' | 'danger'> = {
  ACTIVE: 'ok',
  SUPERSEDED: 'neutral',
  VOIDED: 'danger',
};

function formatRate(value: number | string) {
  return new Intl.NumberFormat('es-PE', { minimumFractionDigits: 4, maximumFractionDigits: 10 }).format(Number(value));
}

export function ExchangeRatesPanel() {
  const perms = usePermissions();
  const rates = useExchangeRates();
  const currencies = useCurrencies();
  const [publishing, setPublishing] = useState(false);
  const [voiding, setVoiding] = useState<{ id: string; label: string } | null>(null);
  const [tab, setTab] = useState<'ACTIVE' | 'ALL'>('ACTIVE');

  const { term, setTerm, filtered } = useSearchFilter(rates.data, (r) => [
    r.base_currency, r.quote_currency, r.rate_date, r.notes, r.status,
  ]);
  const rows = filtered.filter((r) => tab === 'ALL' || r.status === 'ACTIVE');
  const active = (currencies.data ?? []).filter((c) => c.status === 'ACTIVE');
  const canWrite = perms.canReadFinance;

  return (
    <div className="space-y-4">
      <p className="rounded-lg bg-info-soft px-3 py-2 text-xs text-info">
        <strong>Solo reporting.</strong> Un tipo de cambio da equivalentes gerenciales en la moneda de
        reporte; nunca convierte ni reescribe un documento. Fuente inicial: MANUAL. Sin una tasa, el
        consolidado marca la conversión como faltante en vez de inventarla.
      </p>

      <Card
        title="Tipos de cambio"
        description="1 moneda base = tasa × moneda cotizada. Se usa la tasa directa; si no existe, su recíproca. Nunca se triangula."
        actions={
          canWrite ? (
            <button type="button" className="ebim-btn-primary" onClick={() => setPublishing(true)}>
              Publicar tasa
            </button>
          ) : null
        }
      >
        <SearchBar
          value={term}
          onChange={setTerm}
          placeholder="Buscar por moneda, fecha o nota…"
          right={
            <div role="tablist" aria-label="Estado de las tasas" className="flex gap-1">
              {(['ACTIVE', 'ALL'] as const).map((t) => (
                <button
                  key={t}
                  type="button"
                  role="tab"
                  aria-selected={tab === t}
                  className={tab === t ? 'ebim-btn-primary' : 'ebim-btn-ghost'}
                  onClick={() => setTab(t)}
                >
                  {t === 'ACTIVE' ? 'Vigentes' : 'Historial completo'}
                </button>
              ))}
            </div>
          }
        />
        {rates.isLoading ? (
          <LoadingState />
        ) : rates.error ? (
          <ErrorState error={rates.error} onRetry={() => void rates.refetch()} />
        ) : rows.length === 0 ? (
          <EmptyState
            title="Sin tipos de cambio"
            description="Mientras no haya tasas, el consolidado muestra los importes por moneda y advierte las conversiones faltantes."
          />
        ) : (
          <DataTable columns={['Fecha', 'Tasa', 'Fuente', 'Estado', 'Notas', '']}>
            {rows.map((r) => {
              const status = r.status as RateStatus;
              return (
                <tr key={r.id}>
                  <td className="ebim-td whitespace-nowrap">{formatDate(r.rate_date)}</td>
                  <td className="ebim-td whitespace-nowrap font-mono text-sm">
                    1 {r.base_currency} = {formatRate(r.rate)} {r.quote_currency}
                  </td>
                  <td className="ebim-td">
                    <div className="flex flex-wrap gap-1">
                      <Badge tone="info">{r.source}</Badge>
                      {r.is_demo ? <Badge tone="warn">DEMO · no es cotización real</Badge> : null}
                    </div>
                  </td>
                  <td className="ebim-td">
                    <Badge tone={STATUS_TONE[status]}>{STATUS_LABEL[status]}</Badge>
                    {r.status_reason ? <div className="mt-0.5 text-xs text-muted">{r.status_reason}</div> : null}
                  </td>
                  <td className="ebim-td text-xs text-muted">{r.notes ?? '—'}</td>
                  <td className="ebim-td text-right">
                    {canWrite && status === 'ACTIVE' ? (
                      <button
                        type="button"
                        className="ebim-link text-[13px]"
                        onClick={() =>
                          setVoiding({ id: r.id, label: `1 ${r.base_currency} = ${formatRate(r.rate)} ${r.quote_currency} (${r.rate_date})` })
                        }
                      >
                        Anular
                      </button>
                    ) : null}
                  </td>
                </tr>
              );
            })}
          </DataTable>
        )}
      </Card>

      <ConversionTester currencies={active.map((c) => c.code)} />

      <PublishRateDialog
        open={publishing}
        currencies={active.map((c) => ({ value: c.code, label: `${c.code} · ${c.name}` }))}
        onClose={() => setPublishing(false)}
      />
      <VoidRateDialog target={voiding} onClose={() => setVoiding(null)} />
    </div>
  );
}

function PublishRateDialog({
  open,
  currencies,
  onClose,
}: {
  open: boolean;
  currencies: Array<{ value: string; label: string }>;
  onClose: () => void;
}) {
  const toast = useToast();
  const publish = usePublishExchangeRate();
  const [date, setDate] = useState(new Date().toISOString().slice(0, 10));
  const [base, setBase] = useState('USD');
  const [quote, setQuote] = useState('');
  const [rate, setRate] = useState('');
  const [notes, setNotes] = useState('');

  const invalid = !date || !base || !quote || base === quote || !(Number(rate) > 0);

  async function submit() {
    if (invalid) return;
    try {
      await publish.mutateAsync({
        p_rate_date: date, p_base: base, p_quote: quote, p_rate: Number(rate),
        p_notes: notes.trim() || undefined,
      });
      toast.success('Tasa publicada', `1 ${base} = ${rate} ${quote} al ${date}`);
      setRate('');
      setNotes('');
      onClose();
    } catch {
      /* visible en el diálogo */
    }
  }

  return (
    <FormDialog
      open={open}
      title="Publicar tipo de cambio"
      description="Si ya existe una tasa vigente para esa fecha y par, queda sustituida (no se borra)."
      submitLabel="Publicar"
      busy={publish.isPending}
      error={publish.error}
      onSubmit={() => void submit()}
      onCancel={onClose}
    >
      <FieldRow>
        <TextField label="Fecha de la tasa" type="date" required value={date} onChange={(e) => setDate(e.target.value)} />
        <NumberField
          label="Tasa" required min={0} step="0.0000000001" value={rate}
          onChange={(e) => setRate(e.target.value)}
          hint="Mayor que cero."
          error={rate !== '' && !(Number(rate) > 0) ? { message: 'La tasa debe ser mayor que 0' } : undefined}
        />
      </FieldRow>
      <FieldRow>
        <SelectField label="Moneda base" required options={currencies} value={base} onChange={(e) => setBase(e.target.value)} />
        <SelectField
          label="Moneda cotizada" required placeholder="Elige la moneda…" options={currencies}
          value={quote} onChange={(e) => setQuote(e.target.value)}
          error={base && quote && base === quote ? { message: 'Debe ser distinta de la base' } : undefined}
        />
      </FieldRow>
      {base && quote && Number(rate) > 0 && base !== quote ? (
        <p className="rounded-lg bg-accent-soft px-3 py-2 text-sm text-accent-deep">
          1 {base} = {rate} {quote}
        </p>
      ) : null}
      <TextAreaField label="Notas" value={notes} onChange={(e) => setNotes(e.target.value)} hint="Origen del dato (p. ej. tasa de cierre del mes)." />
    </FormDialog>
  );
}

function VoidRateDialog({ target, onClose }: { target: { id: string; label: string } | null; onClose: () => void }) {
  const toast = useToast();
  const voidRate = useVoidExchangeRate();
  const [reason, setReason] = useState('');

  async function submit() {
    if (!target || !reason.trim()) return;
    try {
      await voidRate.mutateAsync({ p_rate_id: target.id, p_reason: reason.trim() });
      toast.success('Tasa anulada', target.label);
      setReason('');
      onClose();
    } catch {
      /* visible en el diálogo */
    }
  }

  return (
    <FormDialog
      open={Boolean(target)}
      title="Anular tipo de cambio"
      description={target ? `Se anula ${target.label}. Queda en el historial con el motivo.` : undefined}
      submitLabel="Anular tasa"
      busy={voidRate.isPending}
      error={voidRate.error}
      onSubmit={() => void submit()}
      onCancel={onClose}
    >
      <TextAreaField label="Motivo" required value={reason} onChange={(e) => setReason(e.target.value)} />
    </FormDialog>
  );
}

/** Prueba una conversión con la misma función que usa el consolidado. No escribe nada. */
function ConversionTester({ currencies }: { currencies: string[] }) {
  const [amount, setAmount] = useState('1000');
  const [from, setFrom] = useState('PEN');
  const [to, setTo] = useState('USD');
  const [date, setDate] = useState(new Date().toISOString().slice(0, 10));
  const [maxAge, setMaxAge] = useState('31');
  const [result, setResult] = useState<null | { status: string; amount: number | null; rate: number | null; rate_date: string | null; is_demo: boolean | null }>(null);
  const [error, setError] = useState<unknown>(null);
  const options = useMemo(() => currencies.map((c) => ({ value: c, label: c })), [currencies]);

  async function run() {
    setError(null);
    const { data, error: rpcError } = await supabase.rpc('fx_convert', {
      p_amount: Number(amount), p_from: from, p_to: to, p_as_of: date, p_max_age_days: Number(maxAge || 0),
    });
    if (rpcError) {
      setError(rpcError);
      setResult(null);
      return;
    }
    setResult((data ?? [])[0] ?? null);
  }

  return (
    <Card title="Probar una conversión" description="Misma regla que el consolidado: tasa directa, luego recíproca, dentro de la antigüedad indicada.">
      <div className="grid gap-4 p-4 sm:grid-cols-5">
        <NumberField label="Importe" value={amount} onChange={(e) => setAmount(e.target.value)} />
        <SelectField label="De" options={options} value={from} onChange={(e) => setFrom(e.target.value)} />
        <SelectField label="A" options={options} value={to} onChange={(e) => setTo(e.target.value)} />
        <TextField label="Fecha" type="date" value={date} onChange={(e) => setDate(e.target.value)} />
        <NumberField label="Antigüedad máx. (días)" min={0} max={366} value={maxAge} onChange={(e) => setMaxAge(e.target.value)} />
      </div>
      <div className="flex flex-wrap items-center justify-between gap-3 border-t border-border px-4 py-3">
        <div className="text-sm" aria-live="polite" data-testid="fx-test-result">
          {error ? (
            <span className="text-danger">{businessErrorMessage(error)}</span>
          ) : result ? (
            result.status === 'MISSING' ? (
              <span className="text-warn">Sin tasa para {from}→{to} en esa ventana: no se inventa una conversión.</span>
            ) : (
              <span>
                {formatMoney(Number(amount), from)} ≈ <strong>{formatMoney(result.amount, to)}</strong>{' '}
                <span className="text-muted">
                  ({result.status === 'IDENTITY' ? 'misma moneda' : `${result.status === 'DIRECT' ? 'directa' : 'recíproca'}, tasa ${formatRate(result.rate ?? 0)} del ${result.rate_date}`}
                  {result.is_demo ? ', DEMO' : ''})
                </span>
              </span>
            )
          ) : (
            <span className="text-muted">Indica importe, monedas y fecha.</span>
          )}
        </div>
        <button type="button" className="ebim-btn-ghost" onClick={() => void run()} disabled={!from || !to || !date}>
          Probar
        </button>
      </div>
    </Card>
  );
}
