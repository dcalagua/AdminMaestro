import { useState } from 'react';
import { CheckIcon } from '@phosphor-icons/react';
import { useSettlementEvents, type useSettlements } from '@/services/queries';
import { useSearchFilter } from '@/hooks/useSearchFilter';
import { StatusTabs } from '@/components/ui/SectionTabs';
import { ActionMenu } from '@/components/ui/ActionMenu';
import { DetailDrawer, DetailList } from '@/components/ui/DetailDrawer';
import { Badge, Card, DataTable, EmptyState, ErrorState, LoadingState, SearchBar } from '@/components/ui/primitives';
import { formatDate, formatDateTime, formatMoney, formatNumber } from '@/lib/format';
import { InfoNote } from '@/features/billing/listing';
import {
  ApproveSettlementDialog,
  CancelSettlementDialog,
  GenerateSettlementDialog,
  PaySettlementDialog,
  type Settlement,
} from './SettlementDialogs';
import {
  SETTLEMENT_STEPS,
  approvalBlocker,
  paymentMethodLabel,
  settlementActions,
  settlementSearchText,
  settlementStatus,
  settlementStep,
  type SettlementAction,
} from './settlementModel';

/**
 * Pestaña «Liquidaciones» de Comisiones (fase 13).
 *
 * Finanzas genera, aprueba, registra el pago o anula; un comercial ve las suyas
 * (RLS) y en qué paso está cada una. Buscador único + pestañas de estado (U-06);
 * el detalle se abre en un panel lateral con el ciclo y las comisiones que
 * contiene. Cada acción es una RPC con su propio diálogo.
 */

type Tab = 'ALL' | 'OPEN' | 'APPROVED' | 'PAID' | 'CANCELLED';

function agentOf(s: Settlement): { full_name?: string; code?: string } | null {
  return s.sales_agents as { full_name?: string; code?: string } | null;
}

/** Fecha del último paso alcanzado, para la columna de estado. */
function stageDate(s: Settlement): string | null {
  if (s.status === 'PAID') return s.paid_at ? `Pagada el ${formatDate(s.paid_at)}` : null;
  if (s.status === 'APPROVED') return s.approved_at ? `Aprobada el ${formatDate(s.approved_at)}` : null;
  if (s.status === 'CANCELLED') return s.cancelled_at ? `Anulada el ${formatDate(s.cancelled_at)}` : null;
  return `Generada el ${formatDate(s.created_at)}`;
}

export function SettlementsSection({
  query,
  canManage,
  generateOpen,
  onGenerateClose,
}: {
  query: ReturnType<typeof useSettlements>;
  /** Finanzas o super admin (UX; la RPC es la autoridad). */
  canManage: boolean;
  generateOpen: boolean;
  onGenerateClose: () => void;
}) {
  const [tab, setTab] = useState<Tab>('ALL');
  const [detailId, setDetailId] = useState<string | null>(null);
  const [acting, setActing] = useState<{ action: SettlementAction; id: string } | null>(null);
  const all = query.data ?? [];
  const { term, setTerm, filtered } = useSearchFilter(all, (s) => settlementSearchText({ ...s, sales_agents: agentOf(s) }));
  const count = (t: Tab) => filtered.filter((s) => t === 'ALL' || s.status === t).length;
  const visible = filtered.filter((s) => tab === 'ALL' || s.status === tab);
  // El panel y los diálogos leen la fila VIGENTE: tras una acción la lista se
  // vuelve a leer y el detalle refleja el estado nuevo sin reabrirlo.
  const detail = all.find((s) => s.id === detailId) ?? null;
  const target = acting ? (all.find((s) => s.id === acting.id) ?? null) : null;
  const open = (action: SettlementAction, s: Settlement) => {
    setDetailId(null);
    setActing({ action, id: s.id });
  };

  const ACTION_LABEL: Record<SettlementAction, string> = {
    approve: 'Aprobar…',
    pay: 'Registrar pago…',
    cancel: 'Anular…',
  };

  return (
    <>
      <Card>
        <SearchBar
          value={term}
          onChange={setTerm}
          placeholder="Buscar por código, comercial o referencia de pago…"
          right={
            <StatusTabs
              label="Estado de la liquidación"
              value={tab}
              onChange={setTab}
              options={[
                { id: 'ALL' as const, label: 'Todas', count: count('ALL') },
                { id: 'OPEN' as const, label: 'Abiertas', count: count('OPEN') },
                { id: 'APPROVED' as const, label: 'Aprobadas', count: count('APPROVED') },
                { id: 'PAID' as const, label: 'Pagadas', count: count('PAID') },
                { id: 'CANCELLED' as const, label: 'Anuladas', count: count('CANCELLED') },
              ]}
            />
          }
        />
        <div className="border-b border-border px-5 py-3">
          <InfoNote>
            {canManage
              ? 'Ciclo: Generar → Aprobar → Registrar pago. Al aprobarla, la liquidación ya no cambia; anularla devuelve sus comisiones a «por liquidar». Si un cobro se revierte después del pago, su contra-comisión se descuenta en la próxima liquidación.'
              : 'Ves tus liquidaciones. Finanzas las genera, las aprueba y registra el pago; un cobro revertido después del pago se descuenta en la próxima.'}
          </InfoNote>
        </div>
        {query.isLoading ? (
          <LoadingState label="Cargando liquidaciones…" />
        ) : query.error ? (
          <ErrorState error={query.error} onRetry={() => void query.refetch()} />
        ) : visible.length === 0 ? (
          <EmptyState
            illustration={all.length > 0 ? 'search' : 'empty'}
            title={all.length > 0 ? 'Ninguna liquidación coincide' : 'Sin liquidaciones'}
            description={
              all.length > 0
                ? 'Prueba con otra búsqueda o cambia de pestaña.'
                : canManage
                  ? 'Usa «Generar liquidación» para agrupar las comisiones elegibles de un comercial.'
                  : 'Todavía no se ha liquidado ninguna comisión visible para tu rol.'
            }
          />
        ) : (
          <DataTable
            label="Liquidaciones"
            columns={[
              'Liquidación',
              'Período',
              { label: 'Comisiones', align: 'right' },
              { label: 'Total', align: 'right' },
              'Estado',
              'Pago',
              { label: 'Acciones', srOnly: true },
            ]}
          >
            {visible.map((s) => {
              const st = settlementStatus(s.status);
              const actions = settlementActions(s, canManage);
              const negative = Number(s.total_amount) < 0;
              return (
                <tr key={s.id} data-settlement={s.code} data-settlement-status={s.status}>
                  <td className="ebim-td">
                    {/* Acción primaria de la fila: abrir el detalle. */}
                    <button type="button" className="ebim-link block whitespace-nowrap text-left font-mono text-compact"
                      onClick={() => setDetailId(s.id)}>
                      {s.code}
                    </button>
                    <span className="block max-w-[220px] truncate text-caption text-muted">{agentOf(s)?.full_name ?? '—'}</span>
                  </td>
                  <td className="ebim-td whitespace-nowrap text-compact text-fg-2">
                    {formatDate(s.period_start)} – {formatDate(s.period_end)}
                  </td>
                  <td className="ebim-td ebim-num text-compact">
                    {s.status === 'CANCELLED' ? <span className="text-muted" title="Liberadas al anular">—</span> : formatNumber(s.event_count)}
                  </td>
                  <td className={`ebim-td ebim-num whitespace-nowrap font-semibold ${negative ? 'text-danger' : ''}`}>
                    {formatMoney(Number(s.total_amount), s.currency)}
                  </td>
                  <td className="ebim-td">
                    <Badge tone={st.tone} dot>{st.label}</Badge>
                    <span className="mt-0.5 block whitespace-nowrap text-caption text-muted">{stageDate(s)}</span>
                  </td>
                  <td className="ebim-td text-compact">
                    {s.payment_reference ? (
                      <>
                        <span className="block max-w-[160px] truncate font-mono" title={s.payment_reference}>{s.payment_reference}</span>
                        <span className="block text-caption text-muted">{paymentMethodLabel(s.payment_method)}</span>
                      </>
                    ) : (
                      <span className="text-muted">—</span>
                    )}
                  </td>
                  <td className="ebim-td w-12 text-right">
                    <ActionMenu
                      label={`Acciones de ${s.code}`}
                      items={[
                        { label: 'Ver detalle', onSelect: () => setDetailId(s.id) },
                        ...actions.map((a) => ({
                          label: ACTION_LABEL[a],
                          tone: a === 'cancel' ? ('danger' as const) : undefined,
                          onSelect: () => open(a, s),
                        })),
                      ]}
                    />
                  </td>
                </tr>
              );
            })}
          </DataTable>
        )}
      </Card>

      <SettlementDetailDrawer
        settlement={detail}
        canManage={canManage}
        onAction={(a) => detail && open(a, detail)}
        onClose={() => setDetailId(null)}
      />
      <GenerateSettlementDialog
        open={generateOpen}
        onClose={onGenerateClose}
        onCreated={(id) => {
          onGenerateClose();
          setTab('ALL');
          setTerm('');
          setDetailId(id);
        }}
      />
      <ApproveSettlementDialog settlement={acting?.action === 'approve' ? target : null} onClose={() => setActing(null)} />
      <PaySettlementDialog settlement={acting?.action === 'pay' ? target : null} onClose={() => setActing(null)} />
      <CancelSettlementDialog settlement={acting?.action === 'cancel' ? target : null} onClose={() => setActing(null)} />
    </>
  );
}

/* ==========================================================================
   Detalle
   ========================================================================== */

function SettlementStepper({ settlement }: { settlement: Settlement }) {
  const current = settlementStep(settlement.status);
  const dates = [settlement.created_at, settlement.approved_at, settlement.paid_at];
  if (current < 0) return null;
  return (
    <ol aria-label={`Ciclo de la liquidación: ${settlementStatus(settlement.status).label}`} className="flex items-start" data-settlement-stepper>
      {SETTLEMENT_STEPS.map((step, i) => {
        const done = i <= current;
        const isCurrent = i === current;
        return (
          <li key={step.id} aria-current={isCurrent ? 'step' : undefined} className={`flex items-start ${i < SETTLEMENT_STEPS.length - 1 ? 'flex-1' : ''}`}>
            <span className="flex flex-col items-center gap-1">
              <span
                className={`flex h-6 w-6 items-center justify-center rounded-full ${
                  done ? 'bg-accent text-accent-fg' : 'border border-border-strong bg-card'
                }`}
              >
                {done ? <CheckIcon size={13} weight="bold" aria-hidden /> : null}
              </span>
              <span className={`whitespace-nowrap text-caption ${isCurrent ? 'font-bold text-fg' : done ? 'text-fg-2' : 'text-muted'}`}>
                {step.label}
                <span className="sr-only">{done ? (isCurrent ? ' (paso actual)' : ' (completado)') : ' (pendiente)'}</span>
              </span>
              <span className="whitespace-nowrap text-caption text-muted">{done && dates[i] ? formatDate(dates[i]) : ' '}</span>
            </span>
            {i < SETTLEMENT_STEPS.length - 1 ? (
              <span className={`mx-2 mt-3 h-0.5 flex-1 rounded-full ${i < current ? 'bg-accent' : 'bg-border'}`} aria-hidden />
            ) : null}
          </li>
        );
      })}
    </ol>
  );
}

function SettlementDetailDrawer({
  settlement,
  canManage,
  onAction,
  onClose,
}: {
  settlement: Settlement | null;
  canManage: boolean;
  onAction: (action: SettlementAction) => void;
  onClose: () => void;
}) {
  const s = settlement;
  const events = useSettlementEvents(s && s.status !== 'CANCELLED' ? s.id : null);
  const actions = s ? settlementActions(s, canManage) : [];
  const blocker = s ? approvalBlocker(s) : null;
  const st = settlementStatus(s?.status);
  const rows = events.data ?? [];

  return (
    <DetailDrawer
      open={Boolean(s)}
      size="lg"
      title={s?.code ?? ''}
      subtitle={s ? `${agentOf(s)?.full_name ?? '—'} · ${formatDate(s.period_start)} – ${formatDate(s.period_end)} · ${s.currency}` : undefined}
      onClose={onClose}
      actions={
        actions.length > 0 ? (
          <>
            {actions.includes('cancel') ? (
              <button type="button" className="ebim-btn-ghost mr-auto text-danger" onClick={() => onAction('cancel')}>Anular…</button>
            ) : null}
            {actions.includes('approve') ? (
              <button type="button" className="ebim-btn-primary" onClick={() => onAction('approve')}>Aprobar…</button>
            ) : null}
            {actions.includes('pay') ? (
              <button type="button" className="ebim-btn-primary" onClick={() => onAction('pay')}>Registrar pago…</button>
            ) : null}
          </>
        ) : undefined
      }
    >
      {s ? (
        <div className="space-y-5" data-settlement-detail={s.code}>
          <div className="flex flex-wrap items-end justify-between gap-4">
            <div>
              <p className="text-caption text-muted">Total a pagar</p>
              <p className={`ebim-num text-display ${Number(s.total_amount) < 0 ? 'text-danger' : 'text-fg'}`}>
                {formatMoney(Number(s.total_amount), s.currency)}
              </p>
            </div>
            <Badge tone={st.tone} dot>{st.label}</Badge>
          </div>

          {s.status === 'CANCELLED' ? (
            <p className="rounded-card bg-sunken px-4 py-3 text-compact text-fg-2">
              Anulada el {formatDateTime(s.cancelled_at)}. Motivo: <strong className="text-fg">{s.cancellation_reason ?? '—'}</strong>.
              Sus comisiones volvieron a estar por liquidar; el total mostrado es el que tenía al anularse.
            </p>
          ) : (
            <SettlementStepper settlement={s} />
          )}

          {canManage && blocker ? <InfoNote>{blocker}</InfoNote> : null}

          <DetailList
            items={[
              ['Comercial', agentOf(s)?.full_name ?? '—'],
              ['Moneda', s.currency],
              ['Generada', formatDateTime(s.created_at)],
              ['Aprobada', s.approved_at ? formatDateTime(s.approved_at) : 'Pendiente'],
              ...(s.approval_note ? ([['Nota de aprobación', s.approval_note]] as Array<[string, string]>) : []),
              ['Pagada', s.paid_at ? formatDate(s.paid_at) : 'Pendiente'],
              ...(s.status === 'PAID'
                ? ([
                    ['Medio de pago', paymentMethodLabel(s.payment_method)],
                    ['Referencia', s.payment_reference ?? '—'],
                  ] as Array<[string, string]>)
                : []),
              ...(s.payment_note ? ([['Nota del pago', s.payment_note]] as Array<[string, string]>) : []),
            ]}
          />

          {s.status !== 'CANCELLED' ? (
            <section aria-labelledby="settlement-events-title" className="space-y-2">
              <h3 id="settlement-events-title" className="text-h3 text-fg">
                Comisiones incluidas <span className="text-compact font-normal text-muted">({formatNumber(s.event_count)})</span>
              </h3>
              {events.isLoading ? (
                <LoadingState label="Cargando comisiones…" rows={4} />
              ) : events.error ? (
                <ErrorState error={events.error} onRetry={() => void events.refetch()} />
              ) : rows.length === 0 ? (
                <EmptyState title="Sin comisiones" description="Esta liquidación no contiene comisiones." />
              ) : (
                <DataTable
                  label={`Comisiones de ${s.code}`}
                  columns={['Fecha', 'Cliente y origen', { label: 'Base', align: 'right' }, { label: 'Monto', align: 'right' }]}
                >
                  {rows.map((e) => {
                    const amount = Number(e.amount ?? 0);
                    return (
                      <tr key={e.commission_event_id}>
                        <td className="ebim-td whitespace-nowrap text-compact text-fg-2">{formatDate(e.earned_on)}</td>
                        <td className="ebim-td text-compact">
                          <span className="block max-w-[240px] truncate font-medium" title={e.tenant_name ?? undefined}>
                            {e.tenant_name ?? 'Sin tenant'}
                          </span>
                          <span className="flex items-center gap-1.5 text-caption text-muted">
                            {e.is_reversal ? <Badge tone="danger">Reverso</Badge> : null}
                            <span className="truncate">
                              {[e.product_short_name, e.source_label, e.invoice_number].filter(Boolean).join(' · ')}
                            </span>
                          </span>
                        </td>
                        <td className="ebim-td ebim-num whitespace-nowrap text-compact text-fg-2">
                          {formatMoney(Number(e.base_amount ?? 0), e.currency)}
                        </td>
                        <td className={`ebim-td ebim-num whitespace-nowrap font-semibold ${amount < 0 ? 'text-danger' : ''}`}>
                          {formatMoney(amount, e.currency)}
                        </td>
                      </tr>
                    );
                  })}
                </DataTable>
              )}
            </section>
          ) : null}
        </div>
      ) : null}
    </DetailDrawer>
  );
}
