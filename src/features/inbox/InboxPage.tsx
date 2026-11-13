import { autoTitle } from '@/components/ui/autoTitle';
import { useState, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { CheckIcon, ArrowCounterClockwiseIcon } from '@phosphor-icons/react';
import { Card, EmptyState, LoadingState, PageContainer, SearchBar } from '@/components/ui/primitives';
import { StatusTabs } from '@/components/ui/SectionTabs';
import { SelectInput } from '@/components/ui/fields';
import { InfoHint } from '@/components/ui/InfoHint';
import { StatCell, StatStrip } from '@/components/ui/StatStrip';
import { MoneyCell, StatusDot } from '@/components/ui/cells';
import { MOBILE_QUERY, useMediaQuery } from '@/hooks/useMediaQuery';
import { findNavItem } from '@/app/navigation';
import { useProvisioningAccess } from '@/hooks/useProvisioningAccess';
import { useProvisionTenant } from '@/services/mutations';
import { useTaskQueue, type TaskResult } from '@/components/ui/task-queue-context';
import { businessErrorMessage } from '@/lib/pgError';
import { formatCountNoun, formatNumber } from '@/lib/format';
import { providerErrorLabel } from '@/lib/provisioning';
import { useConfirmActive } from '@/features/suite/useConfirmActive';
import { useHealthCheck } from '@/features/suite/useSuiteData';
import {
  KIND_LABEL,
  KIND_ORDER,
  PRIORITY_LABEL,
  PRIORITY_TONE,
  countByKind,
  inboxSummary,
  matchesInbox,
  type InboxItem,
  type InboxKind,
  type InboxPriority,
} from './inboxModel';
import { useInbox, INBOX_INVOICE_LIMIT } from './useInbox';

/**
 * Bandeja (V5 · F5): en una sola lista, lo que requiere una acción tuya hoy.
 *
 * Cada ítem trae su prioridad, la cuenta o la app, desde cuándo espera y la
 * acción directa (en el sitio cuando ya existe: confirmar un tenant, ejecutar
 * un alta, verificar una app; si no, el botón lleva a la pantalla de la
 * acción). Se agrupa por tipo y se filtra por tipo, prioridad o texto.
 *
 * No hay tabla de estado de la bandeja: los ítems se resuelven solos cuando el
 * dato cambia, y «Hecho» sólo los oculta en este navegador.
 */
type KindFilter = 'ALL' | InboxKind;
type PriorityFilter = 'ALL' | '1' | '2' | '3';

const PRIORITY_OPTIONS: Array<{ id: PriorityFilter; label: string }> = [
  { id: 'ALL', label: 'Todas' },
  { id: '1', label: 'Urgentes' },
  { id: '2', label: 'Importantes' },
  { id: '3', label: 'Normales' },
];

export function InboxPage() {
  const nav = findNavItem('/bandeja');
  const inbox = useInbox();
  const [kind, setKind] = useState<KindFilter>('ALL');
  const [priority, setPriority] = useState<PriorityFilter>('ALL');
  const [term, setTerm] = useState('');
  const [showDone, setShowDone] = useState(false);
  const actions = useInboxActions();
  // V6 · a ≥1280 px los tipos de aviso van en una columna lateral; por debajo, en un selector.
  const wide = useMediaQuery('(min-width: 1280px)');
  const mobile = useMediaQuery(MOBILE_QUERY);

  const source = showDone ? inbox.done : inbox.items;
  const searched = source.filter((i) => matchesInbox(i, term));
  const byPriority = searched.filter((i) => priority === 'ALL' || i.priority === (Number(priority) as InboxPriority));
  const visible = byPriority.filter((i) => kind === 'ALL' || i.kind === kind);
  const kindCounts = countByKind(byPriority);
  const kinds = KIND_ORDER.filter((k) => inbox.audience[k]);
  const urgent = inbox.items.filter((i) => i.priority === 1).length;
  const failed = inbox.sources.filter((s) => s.error);
  const summary = inboxSummary(inbox.items);

  if (kinds.length === 0) {
    return (
      <PageContainer title={nav?.label ?? 'Bandeja'} description={nav?.description}>
        <Card>
          <EmptyState
            title="Nada que atender desde tu rol"
            description="Tu perfil no recibe avisos de cobranza, altas, salud de las apps ni aprobaciones. Si crees que debería, pide al equipo de plataforma EBIM que revise tus permisos."
          />
        </Card>
      </PageContainer>
    );
  }

  const kindOptions = [
    { id: 'ALL' as const, label: 'Todo', count: byPriority.length },
    ...kinds.map((k) => ({ id: k, label: KIND_LABEL[k], count: kindCounts[k] })),
  ];
  /** Una cifra de la franja filtra la lista (y vuelve a «Todo» al pulsarla otra vez). */
  const toggleKind = (k: InboxKind) => {
    setShowDone(false);
    setPriority('ALL');
    setKind((current) => (current === k ? 'ALL' : k));
  };
  const loadingStrip = inbox.loading && inbox.items.length === 0;

  return (
    <PageContainer
      title={nav?.label ?? 'Bandeja'}
      description={nav?.description}
      meta={
        <span className="inline-flex flex-wrap items-center gap-x-1.5">
          {inbox.loading
            ? 'Revisando cobranza, apps y aprobaciones…'
            : `${formatCountNoun(inbox.items.length, 'pendiente')}${urgent > 0 ? ` · ${formatCountNoun(urgent, 'urgente')}` : ''}`}
          <InfoHint label="Cuándo desaparece un aviso" title="Cuándo desaparece un aviso">
            Cada aviso desaparece solo cuando el dato cambia (la factura se cobra, el alta se completa…). «Hecho» lo
            oculta <strong>solo en este navegador</strong>
            {inbox.persistent ? '' : ' y solo mientras dure esta pestaña, porque el navegador no permite guardar'}: no
            lo resuelve ni lo oculta a otras personas.
          </InfoHint>
        </span>
      }
      actions={
        inbox.done.length > 0 || showDone ? (
          <button
            type="button"
            className="ebim-btn-ghost ebim-btn-sm"
            aria-pressed={showDone}
            onClick={() => setShowDone((v) => !v)}
          >
            {showDone ? 'Volver a los pendientes' : `Ver marcados como hechos (${formatNumber(inbox.done.length)})`}
          </button>
        ) : null
      }
    >
      <StatStrip label="Resumen de la bandeja">
        <StatCell
          label="Urgentes"
          value={formatNumber(summary.urgent)}
          tone={summary.urgent > 0 ? 'danger' : 'neutral'}
          loading={loadingStrip}
          context={summary.urgent > 0 ? 'Requieren acción hoy' : 'Nada urgente'}
          info="Facturas vencidas hace más de 30 días, apps caídas, altas fallidas y alertas críticas."
          onSelect={() => {
            setShowDone(false);
            setKind('ALL');
            setPriority((p) => (p === '1' ? 'ALL' : '1'));
          }}
          selected={priority === '1' && kind === 'ALL'}
        />
        {inbox.audience.invoice ? (
          <StatCell
            label="Facturas vencidas"
            amounts={summary.overdue}
            emptyLabel="Nada vencido"
            tone={summary.invoices > 0 ? 'warn' : 'neutral'}
            loading={loadingStrip}
            context={summary.invoices > 0 ? formatCountNoun(summary.invoices, 'factura') : undefined}
            onSelect={() => toggleKind('invoice')}
            selected={kind === 'invoice'}
          />
        ) : null}
        {inbox.audience['billing-alert'] ? (
          <StatCell
            label="Alertas de cobranza"
            value={formatNumber(summary.alerts)}
            loading={loadingStrip}
            context="Renovaciones y cobros"
            onSelect={() => toggleKind('billing-alert')}
            selected={kind === 'billing-alert'}
          />
        ) : null}
        {inbox.audience.alta ? (
          <StatCell
            label="Altas por resolver"
            value={formatNumber(summary.altas)}
            tone={summary.failedAltas > 0 ? 'danger' : 'neutral'}
            loading={loadingStrip}
            context={
              summary.failedAltas > 0
                ? formatCountNoun(summary.failedAltas, 'fallida')
                : summary.altas > 0
                  ? 'Listas para ejecutar'
                  : 'Ninguna pendiente'
            }
            onSelect={() => toggleKind('alta')}
            selected={kind === 'alta'}
          />
        ) : null}
        {inbox.audience.document || inbox.audience.settlement ? (
          <StatCell
            label="Por aprobar"
            value={formatNumber(summary.approvals)}
            loading={loadingStrip}
            context="Órdenes y liquidaciones"
            onSelect={() => toggleKind(inbox.audience.document ? 'document' : 'settlement')}
            selected={kind === 'document' || kind === 'settlement'}
          />
        ) : null}
      </StatStrip>

      <div className="items-start xl:grid xl:grid-cols-[248px_minmax(0,1fr)] xl:gap-5">
        {wide ? (
          <nav aria-label="Tipo de aviso" className="ebim-card sticky top-20 p-2" data-inbox-kinds>
            <p className="px-2.5 pb-1.5 pt-1 text-micro text-muted">Tipo de aviso</p>
            <ul className="space-y-0.5">
              {kindOptions.map((o) => {
                const active = kind === o.id;
                return (
                  <li key={o.id}>
                    <button
                      type="button"
                      aria-pressed={active}
                      onClick={() => setKind(o.id)}
                      className={`flex w-full items-center justify-between gap-2 rounded-md px-2.5 py-1.5 text-left text-compact transition-colors duration-fast ease-out ${
                        active ? 'bg-accent-soft font-semibold text-accent-deep' : 'text-fg-2 hover:bg-hover hover:text-fg'
                      }`}
                    >
                      <span className="min-w-0 leading-snug">{o.label}</span>
                      <span
                        className={`shrink-0 rounded-full px-1.5 text-caption tabular-nums ${
                          active ? 'bg-card text-accent-deep' : o.count > 0 ? 'bg-sunken text-fg-2' : 'text-muted'
                        }`}
                      >
                        {formatNumber(o.count)}
                      </span>
                    </button>
                  </li>
                );
              })}
            </ul>
          </nav>
        ) : null}

        <Card>
          <SearchBar
            value={term}
            onChange={setTerm}
            placeholder="Buscar por cuenta, app, factura o tenant…"
            right={
              <div className="flex flex-wrap items-center gap-2">
                {wide ? null : (
                  <SelectInput
                    label="Tipo"
                    labelDisplay="inline"
                    size="sm"
                    selectClassName="w-auto"
                    value={kind}
                    onChange={(v) => setKind(v as KindFilter)}
                    options={kindOptions.map((o) => ({ value: o.id, label: `${o.label} (${formatNumber(o.count)})` }))}
                  />
                )}
                {mobile ? (
                  <SelectInput
                    label="Prioridad"
                    labelDisplay="inline"
                    size="sm"
                    selectClassName="w-auto"
                    value={priority}
                    onChange={(v) => setPriority(v as PriorityFilter)}
                    options={PRIORITY_OPTIONS.map((o) => ({ value: o.id, label: o.label }))}
                  />
                ) : (
                  <StatusTabs label="Prioridad" value={priority} onChange={setPriority} options={PRIORITY_OPTIONS} />
                )}
              </div>
            }
          />

          {failed.length > 0 ? (
            <ul className="border-b border-border px-5 py-3 text-compact text-danger" role="alert">
              {failed.map((s) => (
                <li key={s.kind}>
                  No se pudo leer «{s.label}»: {businessErrorMessage(s.error)} La lista puede estar incompleta.
                </li>
              ))}
            </ul>
          ) : null}
          {inbox.invoicesTruncated ? (
            <p className="border-b border-border px-5 py-2.5 text-caption text-muted">
              Se muestran las {formatNumber(INBOX_INVOICE_LIMIT)} facturas vencidas más antiguas; el resto está en{' '}
              <Link className="ebim-link" to="/cobranza?tab=por-cobrar">Por cobrar</Link>.
            </p>
          ) : null}

          {inbox.loading && inbox.items.length === 0 ? (
            <LoadingState label="Revisando lo que requiere tu atención…" />
          ) : visible.length === 0 ? (
            <EmptyState
              variant={source.length > 0 ? 'no-results' : 'empty'}
              title={
                showDone
                  ? 'No hay avisos marcados como hechos'
                  : source.length > 0
                    ? 'Ningún aviso coincide'
                    : 'Nada pendiente'
              }
              description={
                showDone
                  ? 'Lo que marques como hecho aparece aquí mientras el dato no cambie.'
                  : source.length > 0
                    ? 'Prueba con otra búsqueda, prioridad o tipo.'
                    : 'No hay facturas vencidas, altas por resolver, apps caídas ni aprobaciones esperando por ti.'
              }
              onClear={
                source.length > 0
                  ? () => {
                      setTerm('');
                      setKind('ALL');
                      setPriority('ALL');
                    }
                  : undefined
              }
              clearLabel="Quitar filtros"
            />
          ) : (
            <div>
              {KIND_ORDER.filter((k) => visible.some((i) => i.kind === k)).map((k) => {
                const group = visible.filter((i) => i.kind === k);
                return (
                  <section key={k} aria-labelledby={`inbox-${k}`} data-inbox-group={k}>
                    <h2
                      id={`inbox-${k}`}
                      className="border-b border-border bg-sunken px-5 py-1.5 text-micro text-muted"
                    >
                      {KIND_LABEL[k]} <span className="tabular-nums">({formatNumber(group.length)})</span>
                    </h2>
                    <ul className="divide-y divide-border border-b border-border">
                      {group.map((item) => (
                        <InboxRow
                          key={item.key}
                          item={item}
                          done={showDone}
                          actions={actions}
                          onDone={() => inbox.dismiss(item.key)}
                          onRestore={() => inbox.restore(item.key)}
                        />
                      ))}
                    </ul>
                  </section>
                );
              })}
            </div>
          )}
          {showDone && inbox.done.length > 0 ? (
            <div className="border-t border-border px-5 py-3 text-right">
              <button type="button" className="ebim-btn-secondary ebim-btn-sm" onClick={inbox.restoreAll}>
                Devolver todos a la bandeja
              </button>
            </div>
          ) : null}
        </Card>
      </div>
      {actions.confirm.dialog}
    </PageContainer>
  );
}

/* ---- Acciones en el sitio ------------------------------------------------- */

/**
 * Las acciones que ya existen en otras pantallas, con su MISMO permiso: si el
 * rol no puede, el ítem ofrece la pantalla en su lugar. La base decide.
 */
function useInboxActions() {
  const confirm = useConfirmActive();
  const prov = useProvisioningAccess();
  const health = useHealthCheck();
  const queue = useTaskQueue();
  const provision = useProvisionTenant();
  const [running, setRunning] = useState<string[]>([]);

  async function executeAlta(a: Extract<InboxItem['action'], { type: 'execute-alta' }>) {
    setRunning((r) => [...r, a.requestId]);
    try {
      await queue.track(
        { title: `Alta de ${a.tenantName} en ${a.productName}`, link: { to: `/tenants/${a.tenantId}`, label: 'Ver el tenant' } },
        () => provision.mutateAsync(a.requestId),
        (result): TaskResult =>
          result.status === 'ACTIVE'
            ? { status: 'success', title: `Alta activa en ${a.productName}`, detail: a.tenantName }
            : result.status === 'FAILED'
              ? { status: 'error', title: `${a.productName} rechazó el alta`, detail: providerErrorLabel(result.error_code) ?? result.message ?? 'Sin detalle' }
              : { status: 'info', title: `Alta en curso en ${a.productName}`, detail: result.message ?? 'La app sigue procesando.' },
        (error) => ({ status: 'error', title: `No se pudo completar el alta en ${a.productName}`, detail: businessErrorMessage(error) }),
      );
    } catch {
      /* El fallo ya quedó en la cola de tareas. */
    } finally {
      setRunning((r) => r.filter((id) => id !== a.requestId));
    }
  }

  return { confirm, prov, health, executeAlta, isRunning: (id: string) => running.includes(id) };
}

type InboxActions = ReturnType<typeof useInboxActions>;

/** La acción directa del aviso, o `null` si este rol no puede hacerla en el sitio. */
function actionButton(item: InboxItem, actions: InboxActions): ReactNode {
  const a = item.action;
  const label = `${a.label}: ${item.title}`;
  if (a.type === 'confirm-active' && actions.confirm.allowed) {
    return (
      <button type="button" className="ebim-btn-secondary ebim-btn-sm" aria-label={label} onClick={() => actions.confirm.open({ tenantId: a.tenantId, tenantName: a.tenantName })}>
        {a.label}
      </button>
    );
  }
  if (a.type === 'execute-alta' && actions.prov.canForProduct('platform.provisioning.execute', a.productId)) {
    const busy = actions.isRunning(a.requestId);
    return (
      <button type="button" className="ebim-btn-secondary ebim-btn-sm" aria-label={label} disabled={busy} aria-busy={busy || undefined} onClick={() => void actions.executeAlta(a)}>
        {busy ? 'Ejecutando…' : a.label}
      </button>
    );
  }
  if (a.type === 'check-health' && actions.prov.canForProduct('platform.deployment.read', a.productId)) {
    const busy = actions.health.isRunning(a.targetId);
    return (
      <button type="button" className="ebim-btn-secondary ebim-btn-sm" aria-label={label} disabled={busy} aria-busy={busy || undefined} onClick={() => void actions.health.run(a.targetId, a.appName, a.appCode)}>
        {busy ? 'Verificando…' : a.label}
      </button>
    );
  }
  if (a.type === 'link') {
    return (
      <Link className="ebim-btn-secondary ebim-btn-sm" to={a.to} aria-label={label}>
        {a.label}
      </Link>
    );
  }
  // Acción en el sitio que este rol no puede hacer: se ofrece la pantalla.
  return null;
}

function InboxRow({
  item,
  done,
  actions,
  onDone,
  onRestore,
}: {
  item: InboxItem;
  done: boolean;
  actions: InboxActions;
  onDone: () => void;
  onRestore: () => void;
}) {
  const action = done ? null : actionButton(item, actions);
  const sameScreen = item.action.type === 'link' && item.action.to === item.screen.to;
  // Sin acción posible para el rol (o ya hecho): la pantalla del aviso como acción secundaria.
  const screenButton = !action || (done && !sameScreen);
  const tone = PRIORITY_TONE[item.priority];
  return (
    // V6 · fila de ~52 px: prioridad (punto) · aviso (2 líneas) · antigüedad · importe · acción secundaria · hecho.
    <li
      className="grid grid-cols-[12px_minmax(0,1fr)_auto] items-center gap-x-3 gap-y-1.5 px-5 py-2 transition-colors duration-fast hover:bg-hover sm:grid-cols-[12px_minmax(0,1fr)_128px_112px_auto]"
      data-inbox-item={item.key}
      data-priority={item.priority}
    >
      <span className="flex items-center" title={PRIORITY_LABEL[item.priority]}>
        <StatusDot tone={tone} hollow={tone === 'neutral'} />
        <span className="sr-only">{PRIORITY_LABEL[item.priority]}</span>
      </span>
      <div className="min-w-0">
        {sameScreen || !action ? (
          <p className="truncate text-compact font-semibold text-fg" title={item.title}>
            {item.title}
          </p>
        ) : (
          <Link
            to={item.screen.to}
            className="block truncate text-compact font-semibold text-fg hover:text-accent-deep hover:underline"
            title={`${item.title} · ${item.screen.label}`}
          >
            {item.title}
          </Link>
        )}
        <p className="truncate text-caption text-muted" ref={autoTitle}>
          {item.account ? (
            item.account.to ? (
              <Link className="text-fg-2 hover:text-accent-deep hover:underline" to={item.account.to}>
                {item.account.name}
              </Link>
            ) : (
              <span className="text-fg-2">{item.account.name}</span>
            )
          ) : null}
          {item.app ? <span>{item.account ? ' · ' : ''}{item.app}</span> : null}
          {item.detail ? (
            <span title={item.detail}>
              {item.account || item.app ? ' · ' : ''}
              {item.detail}
            </span>
          ) : null}
          <span className="sm:hidden">
            {item.account || item.app || item.detail ? ' · ' : ''}
            {item.ageText}
          </span>
        </p>
      </div>
      <span className="hidden whitespace-nowrap text-caption text-muted sm:block">{item.ageText}</span>
      <span className="hidden text-right sm:block">
        {item.amount ? <MoneyCell amount={item.amount.value} currency={item.amount.currency} empty="" /> : null}
      </span>
      <div className="col-start-2 col-end-4 flex flex-wrap items-center justify-start gap-1.5 sm:col-auto sm:justify-end">
        {item.amount ? (
          <span className="mr-auto sm:hidden">
            <MoneyCell amount={item.amount.value} currency={item.amount.currency} empty="" />
          </span>
        ) : null}
        {action}
        {screenButton ? (
          <Link className="ebim-btn-ghost ebim-btn-sm" to={item.screen.to}>
            {item.screen.label}
          </Link>
        ) : null}
        {done ? (
          <button
            type="button"
            className="ebim-btn-ghost ebim-btn-sm"
            aria-label={`Devolver a la bandeja: ${item.title}`}
            onClick={onRestore}
          >
            <ArrowCounterClockwiseIcon size={14} aria-hidden />
            Devolver
          </button>
        ) : (
          <button
            type="button"
            className="inline-flex h-8 w-8 items-center justify-center rounded-md text-muted transition-colors duration-fast hover:bg-sunken hover:text-ok"
            aria-label={`Marcar como hecho: ${item.title}`}
            title="Marcar como hecho (solo en este navegador; vuelve si el dato cambia)"
            onClick={onDone}
          >
            <CheckIcon size={16} weight="bold" aria-hidden />
          </button>
        )}
      </div>
    </li>
  );
}
