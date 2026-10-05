import { useMemo, useState } from 'react';
import { useCurrencies, useEligibleCommissions, useSalesAgents, type useSettlements } from '@/services/queries';
import {
  useApproveCommissionSettlement,
  useCancelCommissionSettlement,
  usePayCommissionSettlement,
  useSettleCommissions,
} from '@/services/mutations';
import { FormDialog } from '@/components/ui/FormDialog';
import { FieldRow, SelectField, TextAreaField, TextField } from '@/components/ui/fields';
import { useToast } from '@/components/ui/toast-context';
import { formatDate, formatMoney, formatNumber } from '@/lib/format';
import { InfoNote } from '@/features/billing/listing';
import { PAYMENT_METHODS, localIsoDate, previousMonthRange } from './settlementModel';

/**
 * Diálogos del ciclo de una liquidación (fase 13). Cada uno llama a UNA RPC de
 * finanzas; la base valida de nuevo todo lo que aquí se comprueba y su error
 * de negocio se muestra tal cual dentro del diálogo.
 */

export type Settlement = NonNullable<ReturnType<typeof useSettlements>['data']>[number];

function agentName(s: Settlement | null): string {
  return (s?.sales_agents as { full_name?: string } | null)?.full_name ?? '';
}

/** Línea de resumen que encabeza los diálogos: qué liquidación y por cuánto. */
function SettlementSummary({ settlement }: { settlement: Settlement }) {
  return (
    <dl className="grid grid-cols-2 gap-x-6 gap-y-3 rounded-card bg-sunken px-4 py-3" data-settlement-summary>
      <div className="min-w-0">
        <dt className="text-caption text-muted">Comercial</dt>
        <dd className="truncate text-body font-medium text-fg">{agentName(settlement) || '—'}</dd>
      </div>
      <div className="min-w-0 text-right">
        <dt className="text-caption text-muted">Total</dt>
        <dd className="ebim-num text-h3 text-fg">{formatMoney(Number(settlement.total_amount), settlement.currency)}</dd>
      </div>
      <div className="min-w-0">
        <dt className="text-caption text-muted">Período</dt>
        <dd className="text-compact text-fg-2">
          {formatDate(settlement.period_start)} – {formatDate(settlement.period_end)}
        </dd>
      </div>
      <div className="min-w-0 text-right">
        <dt className="text-caption text-muted">Comisiones</dt>
        <dd className="text-compact text-fg-2">{formatNumber(settlement.event_count)}</dd>
      </div>
    </dl>
  );
}

/* ==========================================================================
   Generar liquidación (settle_commissions)
   ========================================================================== */

export function GenerateSettlementDialog({
  open,
  onClose,
  onCreated,
}: {
  open: boolean;
  onClose: () => void;
  onCreated: (settlementId: string) => void;
}) {
  const toast = useToast();
  const settle = useSettleCommissions();
  const agents = useSalesAgents();
  const currencies = useCurrencies();
  const [agentId, setAgentId] = useState('');
  const [currency, setCurrency] = useState('');
  const [range, setRange] = useState(() => previousMonthRange());
  const [error, setError] = useState<unknown>(null);
  const [wasOpen, setWasOpen] = useState(open);
  if (wasOpen !== open) {
    setWasOpen(open);
    if (open) {
      setAgentId('');
      setCurrency('');
      setRange(previousMonthRange());
      setError(null);
      settle.reset();
    }
  }

  const agentOptions = useMemo(
    () =>
      (agents.data ?? [])
        .filter((a) => a.status === 'ACTIVE')
        .map((a) => ({ value: a.id, label: `${a.full_name} (${a.code})` })),
    [agents.data],
  );
  const currencyOptions = useMemo(
    () => (currencies.data ?? []).filter((c) => c.status === 'ACTIVE').map((c) => ({ value: c.code, label: `${c.code} · ${c.name}` })),
    [currencies.data],
  );

  const preview = useEligibleCommissions({ agentId, currency, from: range.from, to: range.to });
  const ready = Boolean(agentId && currency && range.from && range.to);
  const badRange = Boolean(range.from && range.to && range.from > range.to);
  const count = preview.data?.count ?? 0;
  // Solo vista previa de una moneda: el total definitivo lo calcula la base al generar.
  const previewTotal =
    preview.data && preview.data.rows.length === count
      ? preview.data.rows.reduce((t, r) => t + Number(r.amount ?? 0), 0)
      : null;

  async function submit() {
    if (badRange) {
      setError(new Error('PERIODO_INVALIDO: la fecha «Hasta» es anterior a «Desde».'));
      return;
    }
    if (!ready) return;
    if (preview.data && count === 0) {
      setError(new Error('SIN_COMISIONES: no hay comisiones elegibles de ese comercial, moneda y período.'));
      return;
    }
    try {
      const id = (await settle.mutateAsync({
        p_sales_agent_id: agentId,
        p_period_start: range.from,
        p_period_end: range.to,
        p_currency: currency,
      })) as string;
      toast.success('Liquidación generada', `${formatNumber(count)} comisión(es) agrupadas · revisa y apruébala`);
      onCreated(id);
    } catch (e) {
      setError(e);
    }
  }

  return (
    <FormDialog
      open={open}
      title="Generar liquidación"
      description="Agrupa las comisiones elegibles de un comercial, en una sola moneda, del período indicado. Queda abierta para revisarla y aprobarla."
      submitLabel="Generar liquidación"
      busy={settle.isPending}
      error={error}
      onSubmit={() => void submit()}
      onCancel={onClose}
    >
      <SelectField
        label="Comercial"
        required
        placeholder={agents.isLoading ? 'Cargando…' : 'Elige el comercial…'}
        options={agentOptions}
        value={agentId}
        onChange={(e) => setAgentId(e.target.value)}
      />
      <SelectField
        label="Moneda"
        required
        hint="Una liquidación es de una sola moneda: la de los cobros que la originan."
        placeholder="Elige la moneda…"
        options={currencyOptions}
        value={currency}
        onChange={(e) => setCurrency(e.target.value)}
      />
      <FieldRow>
        <TextField label="Desde" type="date" required value={range.from}
          onChange={(e) => setRange((r) => ({ ...r, from: e.target.value }))} />
        <TextField label="Hasta" type="date" required value={range.to}
          onChange={(e) => setRange((r) => ({ ...r, to: e.target.value }))} />
      </FieldRow>
      <div aria-live="polite" data-settle-preview>
        {!ready || badRange ? (
          <p className="text-compact text-muted">Elige comercial, moneda y período para ver qué comisiones entran.</p>
        ) : preview.isLoading ? (
          <p className="text-compact text-muted">Buscando comisiones elegibles…</p>
        ) : preview.error ? (
          <p className="text-compact text-danger">No se pudo leer la vista previa; la base validará al generar.</p>
        ) : count === 0 ? (
          <InfoNote>No hay comisiones elegibles de ese comercial en {currency} entre esas fechas.</InfoNote>
        ) : (
          <InfoNote>
            Entran <strong>{formatNumber(count)}</strong> comisión(es) elegibles
            {previewTotal != null ? <> por <strong>{formatMoney(previewTotal, currency)}</strong></> : null}. Si ya hay una
            liquidación abierta de ese mes y moneda, se suman a ella.
          </InfoNote>
        )}
      </div>
    </FormDialog>
  );
}

/* ==========================================================================
   Aprobar (approve_commission_settlement)
   ========================================================================== */

export function ApproveSettlementDialog({ settlement, onClose }: { settlement: Settlement | null; onClose: () => void }) {
  const toast = useToast();
  const approve = useApproveCommissionSettlement();
  const [note, setNote] = useState('');
  const [error, setError] = useState<unknown>(null);
  const [current, setCurrent] = useState<Settlement | null>(settlement);
  if (current !== settlement) {
    setCurrent(settlement);
    setNote('');
    setError(null);
  }

  async function submit() {
    if (!settlement) return;
    try {
      await approve.mutateAsync({ p_settlement_id: settlement.id, p_note: note.trim() || undefined });
      toast.success('Liquidación aprobada', `${settlement.code} · lista para registrar el pago`);
      onClose();
    } catch (e) {
      setError(e);
    }
  }

  return (
    <FormDialog
      open={Boolean(settlement)}
      title={`Aprobar ${settlement?.code ?? ''}`}
      description="Al aprobarla, la liquidación queda cerrada: ya no gana ni pierde comisiones. Después se registra su pago."
      submitLabel="Aprobar"
      busy={approve.isPending}
      error={error}
      onSubmit={() => void submit()}
      onCancel={onClose}
    >
      {settlement ? <SettlementSummary settlement={settlement} /> : null}
      <TextAreaField label="Nota (opcional)" hint="Queda en la auditoría." value={note}
        onChange={(e) => setNote(e.target.value)} />
    </FormDialog>
  );
}

/* ==========================================================================
   Registrar pago (pay_commission_settlement)
   ========================================================================== */

export function PaySettlementDialog({ settlement, onClose }: { settlement: Settlement | null; onClose: () => void }) {
  const toast = useToast();
  const pay = usePayCommissionSettlement();
  const today = localIsoDate(new Date());
  const [paidOn, setPaidOn] = useState(today);
  const [method, setMethod] = useState('BANK_TRANSFER');
  const [reference, setReference] = useState('');
  const [note, setNote] = useState('');
  const [error, setError] = useState<unknown>(null);
  const [current, setCurrent] = useState<Settlement | null>(settlement);
  if (current !== settlement) {
    setCurrent(settlement);
    setPaidOn(today);
    setMethod('BANK_TRANSFER');
    setReference('');
    setNote('');
    setError(null);
  }

  async function submit() {
    if (!settlement) return;
    if (reference.trim() === '') {
      setError(new Error('REFERENCIA_REQUERIDA: indica la referencia del pago.'));
      return;
    }
    try {
      await pay.mutateAsync({
        p_settlement_id: settlement.id,
        p_paid_at: paidOn,
        p_payment_reference: reference.trim(),
        p_method: method,
        p_note: note.trim() || undefined,
      });
      toast.success('Pago registrado', `${settlement.code} · ${formatMoney(Number(settlement.total_amount), settlement.currency)}`);
      onClose();
    } catch (e) {
      setError(e);
    }
  }

  return (
    <FormDialog
      open={Boolean(settlement)}
      title={`Registrar pago · ${settlement?.code ?? ''}`}
      description="Registra el pago que EBIM ya hizo al comercial. La liquidación y sus comisiones quedan pagadas; si luego se revierte un cobro, su contra-comisión se descuenta en la próxima liquidación."
      submitLabel="Registrar pago"
      busy={pay.isPending}
      error={error}
      onSubmit={() => void submit()}
      onCancel={onClose}
    >
      {settlement ? <SettlementSummary settlement={settlement} /> : null}
      <FieldRow>
        <TextField label="Fecha del pago" type="date" required max={today} min={settlement?.period_start}
          value={paidOn} onChange={(e) => setPaidOn(e.target.value)} />
        <SelectField label="Medio" required options={[...PAYMENT_METHODS]} value={method}
          onChange={(e) => setMethod(e.target.value)} />
      </FieldRow>
      <TextField label="Referencia" required hint="Número de operación, planilla o cheque." value={reference}
        onChange={(e) => setReference(e.target.value)} />
      <TextAreaField label="Nota (opcional)" value={note} onChange={(e) => setNote(e.target.value)} />
    </FormDialog>
  );
}

/* ==========================================================================
   Anular (cancel_commission_settlement)
   ========================================================================== */

export function CancelSettlementDialog({ settlement, onClose }: { settlement: Settlement | null; onClose: () => void }) {
  const toast = useToast();
  const cancel = useCancelCommissionSettlement();
  const [reason, setReason] = useState('');
  const [error, setError] = useState<unknown>(null);
  const [current, setCurrent] = useState<Settlement | null>(settlement);
  if (current !== settlement) {
    setCurrent(settlement);
    setReason('');
    setError(null);
  }

  async function submit() {
    if (!settlement) return;
    if (reason.trim().length < 3) {
      setError(new Error('MOTIVO_REQUERIDO: indica el motivo de la anulación.'));
      return;
    }
    try {
      const r = (await cancel.mutateAsync({ p_settlement_id: settlement.id, p_reason: reason.trim() })) as {
        events_released?: number;
      } | null;
      toast.success('Liquidación anulada', `${formatNumber(r?.events_released ?? 0)} comisión(es) vuelven a estar por liquidar`);
      onClose();
    } catch (e) {
      setError(e);
    }
  }

  const n = settlement?.event_count ?? 0;
  return (
    <FormDialog
      open={Boolean(settlement)}
      title={`Anular ${settlement?.code ?? ''}`}
      description={`Sus ${formatNumber(n)} comisión(es) vuelven a estar por liquidar y entran en la próxima liquidación. La anulada se conserva como historia, con su total y el motivo.`}
      submitLabel="Anular liquidación"
      busy={cancel.isPending}
      error={error}
      onSubmit={() => void submit()}
      onCancel={onClose}
    >
      {settlement ? <SettlementSummary settlement={settlement} /> : null}
      <TextAreaField label="Motivo" required hint="Queda en la auditoría." value={reason}
        onChange={(e) => setReason(e.target.value)} />
    </FormDialog>
  );
}
