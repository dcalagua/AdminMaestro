import { useMemo, useState } from 'react';
import { usePartnerFeeStatements, usePlatformFeeAgreements } from '@/services/queries';
import {
  useComputeAllPartnerFeeStatements,
  useComputePartnerFeeStatement,
  useIssuePartnerFeeStatement,
  useVoidPartnerFeeStatement,
} from '@/services/mutations';
import { usePermissions } from '@/hooks/usePermissions';
import { useSearchFilter } from '@/hooks/useSearchFilter';
import { StatusTabs } from '@/components/ui/SectionTabs';
import {
  Badge, Card, DataTable, EmptyState, ErrorState, KpiTile, LoadingState, PageContainer, SearchBar,
} from '@/components/ui/primitives';
import { ActionMenu } from '@/components/ui/ActionMenu';
import { KpiStrip, NativeAmountTile } from '@/features/billing/financeUi';
import { fromQuery } from '@/features/executive/dataState';
import { ConfirmDialog } from '@/components/ui/ConfirmDialog';
import { FormDialog } from '@/components/ui/FormDialog';
import { SelectField, TextAreaField } from '@/components/ui/fields';
import { useToast } from '@/components/ui/toast-context';
import { businessErrorMessage } from '@/lib/pgError';
import { formatDate, formatMoney, formatNumber, sumByCurrency } from '@/lib/format';
import { formatPeriod, labelOf, periodFromMonth } from '@/features/usage/usageLabels';
import { analyzedMonthOptions } from '@/features/dashboard/executiveModel';
import { analyzedMonth } from '@/features/billing/financeModel';
import { STATEMENT_STATUS } from './feeLabels';
import { StatementDetailDrawer, type Statement } from './StatementDetailDrawer';

/**
 * Finanzas → «Tarifas de partners» (M3, spec §4.4).
 *
 * Cada mes EBIM calcula, por partner y moneda, la tarifa de plataforma que el
 * partner le debe por los tenants que gestiona y factura él mismo; la emite
 * como factura al partner (sin suscripción) y la cobra por el portal de pago.
 * Es el flujo partner → EBIM: las comisiones (EBIM → vendedores) van aparte.
 *
 * Toda escritura es una RPC de finanzas; esta pantalla solo la ofrece.
 */
type Tab = 'ALL' | 'DRAFT' | 'ISSUED' | 'VOID';

export function PartnerFeesPage() {
  const perms = usePermissions();
  const toast = useToast();
  // Por defecto el último mes CERRADO: la tarifa se calcula sobre un mes completo.
  const [month, setMonth] = useState(() => analyzedMonth());
  // Últimos 13 meses, el más reciente primero; el en curso rotulado parcial.
  const monthOptions = useMemo(() => analyzedMonthOptions(new Date(), 13), []);
  const period = periodFromMonth(month);
  const statements = usePartnerFeeStatements({ periodStart: period || undefined });
  const agreements = usePlatformFeeAgreements();
  const computeAll = useComputeAllPartnerFeeStatements();
  const issue = useIssuePartnerFeeStatement();

  const [tab, setTab] = useState<Tab>('ALL');
  const [detail, setDetail] = useState<Statement | null>(null);
  const [computing, setComputing] = useState(false);
  const [confirmAll, setConfirmAll] = useState(false);
  const [issuing, setIssuing] = useState<Statement | null>(null);
  const [voiding, setVoiding] = useState<Statement | null>(null);

  const partnerOptions = useMemo(() => {
    const map = new Map<string, string>();
    for (const a of agreements.data ?? []) {
      const org = a.organizations as { display_name: string } | null;
      if (a.status === 'ACTIVE') map.set(a.organization_id, org?.display_name ?? a.organization_id);
    }
    return Array.from(map, ([value, label]) => ({ value, label })).sort((x, y) => x.label.localeCompare(y.label));
  }, [agreements.data]);

  const { term, setTerm, filtered } = useSearchFilter(statements.data, (s) => [
    s.partner_name, s.partner_slug, s.currency, s.invoice_number, s.status,
  ]);
  const count = (t: Tab) => filtered.filter((s) => t === 'ALL' || s.status === t).length;
  const visible = filtered.filter((s) => tab === 'ALL' || s.status === tab);
  const hasAny = (statements.data ?? []).length > 0;

  // Franja del período elegido: lo ya leído, por moneda (nunca se suman monedas).
  const all = statements.data ?? [];
  const live = all.filter((x) => x.status !== 'VOID');
  const drafts = all.filter((x) => x.status === 'DRAFT').length;
  const owed = all.filter((x) => x.status === 'ISSUED' && Number(x.invoice_balance ?? 0) > 0);
  const listState = fromQuery(statements, { isEmpty: () => false });

  async function runComputeAll() {
    if (!period) return;
    try {
      const result = (await computeAll.mutateAsync({ p_period_start: period })) as { partners?: number } | null;
      toast.success('Tarifas calculadas', `${result?.partners ?? 0} partner(s) con tarifa en ${formatPeriod(period)}`);
    } catch (error) {
      toast.error('No se pudo calcular', businessErrorMessage(error));
    } finally {
      setConfirmAll(false);
    }
  }

  async function runIssue() {
    if (!issuing?.id) return;
    try {
      const r = (await issue.mutateAsync({ p_statement_id: issuing.id })) as { number?: string } | null;
      toast.success('Factura emitida al partner', `${issuing.partner_name} · ${r?.number ?? ''}`);
    } catch (error) {
      toast.error('No se pudo emitir', businessErrorMessage(error));
    } finally {
      setIssuing(null);
    }
  }

  return (
    <PageContainer
      title="Tarifas de partners"
      description="Lo que cada partner paga a EBIM por usar la plataforma con los clientes que él factura. Un estado de cuenta por partner, mes y moneda; se emite como factura al partner y se cobra por el portal de pago. No son comisiones."
      actions={
        <>
          <label className="flex items-center gap-2">
            <span className="text-micro text-muted">Período</span>
            <select className="ebim-input h-control w-auto min-w-[200px]" value={month} onChange={(e) => setMonth(e.target.value)}>
              {monthOptions.some((o) => o.value === month) ? null : <option value={month}>{month}</option>}
              {monthOptions.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </select>
          </label>
          {perms.canReadFinance ? (
            <>
              <button type="button" className="ebim-btn-secondary" disabled={!period} onClick={() => setComputing(true)}>
                Calcular
              </button>
              <button type="button" className="ebim-btn-primary" disabled={!period} onClick={() => setConfirmAll(true)}>
                Calcular todos
              </button>
            </>
          ) : null}
        </>
      }
    >
      <KpiStrip label="Indicadores de tarifas de partners">
        <NativeAmountTile
          label="Tarifa del período"
          info="Lo que los partners deben a EBIM por la plataforma en el período, sin las anuladas. Por moneda."
          amounts={sumByCurrency(live, (x) => x.fee_total, (x) => x.currency)}
          state={listState}
          onRetry={() => void statements.refetch()}
          emptyLabel="Sin tarifas calculadas"
          footer={`${formatNumber(live.length)} estado(s) de cuenta`}
        />
        <NativeAmountTile
          label="Base facturada por partners"
          info="Base mensual de los tenants que gestiona y factura cada partner, sobre la que se calcula la tarifa."
          amounts={sumByCurrency(live, (x) => x.base_total, (x) => x.currency)}
          state={listState}
          onRetry={() => void statements.refetch()}
          emptyLabel="Sin base en el período"
          footer={`${formatNumber(live.reduce((t, x) => t + Number(x.tenant_count ?? 0), 0))} tenants`}
        />
        <KpiTile
          label="Por emitir"
          info="Borradores del período: aún no son factura al partner."
          value={statements.data ? formatNumber(drafts) : null}
          tone={drafts > 0 ? 'warn' : 'neutral'}
          footer={drafts > 0 ? 'Borradores sin factura' : 'Nada por emitir'}
          loading={statements.isLoading}
          error={statements.error}
          onRetry={() => void statements.refetch()}
        />
        <NativeAmountTile
          label="Saldo por cobrar"
          info="Facturas de tarifa emitidas y no pagadas del período. Se cobran por el portal de pago."
          amounts={sumByCurrency(owed, (x) => x.invoice_balance, (x) => x.currency)}
          state={listState}
          onRetry={() => void statements.refetch()}
          emptyLabel="Sin saldo pendiente"
          footer={`${formatNumber(owed.length)} factura(s) con saldo`}
        />
      </KpiStrip>

      <Card>
        <SearchBar
          value={term}
          onChange={setTerm}
          placeholder="Buscar por partner, moneda o factura…"
          right={
            <StatusTabs
              value={tab}
              onChange={setTab}
              options={[
                { id: 'ALL', label: 'Todas', count: count('ALL') },
                { id: 'DRAFT', label: 'Borrador', count: count('DRAFT') },
                { id: 'ISSUED', label: 'Emitida', count: count('ISSUED') },
                { id: 'VOID', label: 'Anulada', count: count('VOID') },
              ]}
            />
          }
        />
        {statements.isLoading ? (
          <LoadingState label="Cargando estados de cuenta…" />
        ) : statements.error ? (
          <ErrorState error={statements.error} onRetry={() => void statements.refetch()} />
        ) : visible.length === 0 ? (
          <EmptyState
            title={hasAny ? 'Ningún estado de cuenta coincide' : `Sin estados de cuenta en ${formatPeriod(period)}`}
            description={
              hasAny
                ? 'Prueba con otra búsqueda o cambia de pestaña.'
                : partnerOptions.length === 0
                  ? 'Ningún acuerdo tiene tarifa de plataforma. Se configura en la ficha del partner → Productos autorizados.'
                  : 'Usa «Calcular todos» para generar los borradores del mes.'
            }
          />
        ) : (
          <DataTable
            label="Estados de cuenta de partners"
            columns={[
              'Partner',
              { label: 'Tenants', align: 'right' },
              { label: 'Base mensual', align: 'right' },
              { label: 'Tarifa', align: 'right' },
              'Estado',
              'Factura',
              { label: 'Saldo', align: 'right' },
              { label: 'Acciones', srOnly: true },
            ]}
          >
            {visible.map((s) => {
              const st = labelOf(STATEMENT_STATUS, s.status);
              const balance = s.invoice_balance !== null ? Number(s.invoice_balance) : null;
              const canFinance = perms.canReadFinance;
              return (
                <tr key={s.id}>
                  <td className="ebim-td">
                    {/* Acción primaria de la fila: abrir el detalle del estado de cuenta. */}
                    <button type="button" className="ebim-link text-left" onClick={() => setDetail(s)}>
                      {s.partner_name}
                    </button>
                    <div className="text-caption text-muted">{s.currency}</div>
                  </td>
                  <td className="ebim-td ebim-num">{s.tenant_count}</td>
                  <td className="ebim-td ebim-num whitespace-nowrap">{formatMoney(Number(s.base_total), s.currency)}</td>
                  <td className="ebim-td ebim-num whitespace-nowrap font-semibold">{formatMoney(Number(s.fee_total), s.currency)}</td>
                  <td className="ebim-td"><Badge tone={st.tone}>{st.label}</Badge></td>
                  <td className="ebim-td">
                    {s.invoice_number ? (
                      <>
                        <div className="whitespace-nowrap font-mono text-compact">{s.invoice_number}</div>
                        {s.invoice_due_date ? <div className="text-caption text-muted">Vence {formatDate(s.invoice_due_date)}</div> : null}
                      </>
                    ) : (
                      <span className="text-compact text-muted">Sin emitir</span>
                    )}
                  </td>
                  <td className="ebim-td ebim-num whitespace-nowrap">{balance !== null ? formatMoney(balance, s.currency) : '—'}</td>
                  <td className="ebim-td w-12 text-right">
                    <ActionMenu
                      label={`Acciones de ${s.partner_name} · ${s.currency}`}
                      items={[
                        { label: 'Ver detalle', onSelect: () => setDetail(s) },
                        canFinance && s.status === 'DRAFT' ? { label: 'Emitir factura…', onSelect: () => setIssuing(s) } : null,
                        canFinance && s.status === 'ISSUED' && (balance ?? 0) > 0 && s.partner_organization_id
                          ? { label: 'Compartir enlace de pago', to: `/organizations/${s.partner_organization_id}#payment-portal` }
                          : null,
                        canFinance && s.status !== 'VOID' ? { label: 'Anular…', tone: 'danger', onSelect: () => setVoiding(s) } : null,
                      ]}
                    />
                  </td>
                </tr>
              );
            })}
          </DataTable>
        )}
      </Card>

      <StatementDetailDrawer statement={detail} onClose={() => setDetail(null)} />
      <ComputeDialog open={computing} period={period} partnerOptions={partnerOptions} onClose={() => setComputing(false)} />
      <VoidStatementDialog statement={voiding} onClose={() => setVoiding(null)} />
      <ConfirmDialog
        open={confirmAll}
        title={`¿Calcular todas las tarifas de ${formatPeriod(period)}?`}
        message="Recalcula el borrador de cada partner con tarifa de plataforma. Los estados ya emitidos no cambian; un borrador sin cambios conserva su huella."
        confirmLabel="Calcular todos"
        tone="primary"
        busy={computeAll.isPending}
        onConfirm={runComputeAll}
        onCancel={() => setConfirmAll(false)}
      />
      <ConfirmDialog
        open={issuing !== null}
        title={`¿Emitir la factura a ${issuing?.partner_name ?? ''}?`}
        message={
          issuing
            ? `Se emite una factura de ${formatMoney(Number(issuing.fee_total), issuing.currency)} al partner por la tarifa de ${formatPeriod(issuing.period_start)}, con vencimiento a 15 días. Después el estado de cuenta ya no se recalcula.`
            : ''
        }
        confirmLabel="Emitir factura"
        tone="primary"
        busy={issue.isPending}
        onConfirm={runIssue}
        onCancel={() => setIssuing(null)}
      />
    </PageContainer>
  );
}

function ComputeDialog({
  open,
  period,
  partnerOptions,
  onClose,
}: {
  open: boolean;
  period: string;
  partnerOptions: Array<{ value: string; label: string }>;
  onClose: () => void;
}) {
  const toast = useToast();
  const compute = useComputePartnerFeeStatement();
  const [partner, setPartner] = useState('');
  const [error, setError] = useState<unknown>(null);
  const [wasOpen, setWasOpen] = useState(open);
  if (wasOpen !== open) {
    setWasOpen(open);
    if (open) {
      setPartner('');
      setError(null);
      compute.reset();
    }
  }

  async function submit() {
    if (!partner) {
      setError(new Error('PARTNER_REQUERIDO: elige el partner.'));
      return;
    }
    try {
      const r = (await compute.mutateAsync({ p_partner_id: partner, p_period_start: period })) as {
        statements?: Array<{ changed?: boolean }>;
      } | null;
      const n = r?.statements?.length ?? 0;
      toast.success('Tarifa calculada', n === 0 ? 'Sin tenants con tarifa en el período.' : `${n} estado(s) de cuenta`);
      onClose();
    } catch (e) {
      setError(e);
    }
  }

  return (
    <FormDialog
      open={open}
      title={`Calcular tarifa · ${formatPeriod(period)}`}
      description="Recalcula el borrador del partner (uno por moneda). Si ya está emitido no cambia."
      submitLabel="Calcular"
      busy={compute.isPending}
      error={error ?? compute.error}
      onSubmit={() => void submit()}
      onCancel={onClose}
    >
      <SelectField label="Partner" required placeholder={partnerOptions.length ? 'Elige el partner…' : 'Ningún partner con tarifa'}
        options={partnerOptions} value={partner} onChange={(e) => setPartner(e.target.value)} />
    </FormDialog>
  );
}

function VoidStatementDialog({ statement, onClose }: { statement: Statement | null; onClose: () => void }) {
  const toast = useToast();
  const voidStatement = useVoidPartnerFeeStatement();
  const [reason, setReason] = useState('');
  const [error, setError] = useState<unknown>(null);
  const [current, setCurrent] = useState<Statement | null>(statement);
  if (current !== statement) {
    setCurrent(statement);
    setReason('');
    setError(null);
  }

  async function submit() {
    if (!statement?.id) return;
    if (reason.trim().length < 3) {
      setError(new Error('MOTIVO_REQUERIDO: indica el motivo de la anulación.'));
      return;
    }
    try {
      await voidStatement.mutateAsync({ p_statement_id: statement.id, p_reason: reason.trim() });
      toast.success('Estado de cuenta anulado', `${statement.partner_name} · ${statement.currency}`);
      onClose();
    } catch (e) {
      setError(e);
    }
  }

  return (
    <FormDialog
      open={Boolean(statement)}
      title={`Anular tarifa · ${statement?.partner_name ?? ''} · ${statement?.currency ?? ''}`}
      description={
        statement?.invoice_number
          ? `También se anula la factura ${statement.invoice_number}. No es posible si ya tiene cobros confirmados. Un nuevo cálculo del mes crea otro borrador.`
          : 'El borrador se anula. Un nuevo cálculo del mes crea otro.'
      }
      submitLabel="Anular"
      busy={voidStatement.isPending}
      error={error}
      onSubmit={() => void submit()}
      onCancel={onClose}
    >
      <TextAreaField label="Motivo" required hint="Queda en la auditoría." value={reason}
        onChange={(e) => setReason(e.target.value)} />
    </FormDialog>
  );
}
