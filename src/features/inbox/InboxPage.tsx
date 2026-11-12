import { useState } from 'react';
import { Link } from 'react-router-dom';
import { CheckIcon, ArrowCounterClockwiseIcon } from '@phosphor-icons/react';
import { Badge, Card, EmptyState, LoadingState, PageContainer, SearchBar } from '@/components/ui/primitives';
import { StatusTabs } from '@/components/ui/SectionTabs';
import { findNavItem } from '@/app/navigation';
import { useProvisioningAccess } from '@/hooks/useProvisioningAccess';
import { useProvisionTenant } from '@/services/mutations';
import { useTaskQueue, type TaskResult } from '@/components/ui/task-queue-context';
import { businessErrorMessage } from '@/lib/pgError';
import { formatNumber } from '@/lib/format';
import { providerErrorLabel } from '@/lib/provisioning';
import { useConfirmActive } from '@/features/suite/useConfirmActive';
import { useHealthCheck } from '@/features/suite/useSuiteData';
import {
  KIND_LABEL,
  KIND_ORDER,
  PRIORITY_LABEL,
  PRIORITY_TONE,
  countByKind,
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

export function InboxPage() {
  const nav = findNavItem('/bandeja');
  const inbox = useInbox();
  const [kind, setKind] = useState<KindFilter>('ALL');
  const [priority, setPriority] = useState<PriorityFilter>('ALL');
  const [term, setTerm] = useState('');
  const [showDone, setShowDone] = useState(false);
  const actions = useInboxActions();

  const source = showDone ? inbox.done : inbox.items;
  const searched = source.filter((i) => matchesInbox(i, term));
  const byPriority = searched.filter((i) => priority === 'ALL' || i.priority === (Number(priority) as InboxPriority));
  const visible = byPriority.filter((i) => kind === 'ALL' || i.kind === kind);
  const kindCounts = countByKind(byPriority);
  const kinds = KIND_ORDER.filter((k) => inbox.audience[k]);
  const urgent = inbox.items.filter((i) => i.priority === 1).length;
  const failed = inbox.sources.filter((s) => s.error);

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

  return (
    <PageContainer
      title={nav?.label ?? 'Bandeja'}
      description={nav?.description}
      meta={
        inbox.loading
          ? 'Revisando cobranza, apps y aprobaciones…'
          : `${formatNumber(inbox.items.length)} pendiente${inbox.items.length === 1 ? '' : 's'}${urgent > 0 ? ` · ${formatNumber(urgent)} urgente${urgent === 1 ? '' : 's'}` : ''}`
      }
    >
      <Card>
        <SearchBar
          value={term}
          onChange={setTerm}
          placeholder="Buscar por cuenta, app, factura o tenant…"
          right={
            <StatusTabs
              label="Prioridad"
              value={priority}
              onChange={setPriority}
              options={[
                { id: 'ALL' as const, label: 'Todas' },
                { id: '1' as const, label: 'Urgentes' },
                { id: '2' as const, label: 'Importantes' },
                { id: '3' as const, label: 'Normales' },
              ]}
            />
          }
        />
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border px-5 py-3">
          <StatusTabs
            label="Tipo de aviso"
            value={kind}
            onChange={setKind}
            options={[
              { id: 'ALL' as const, label: 'Todo', count: byPriority.length },
              ...kinds.map((k) => ({ id: k, label: KIND_LABEL[k], count: kindCounts[k] })),
            ]}
          />
          <button
            type="button"
            className="ebim-btn-ghost ebim-btn-sm"
            aria-pressed={showDone}
            onClick={() => setShowDone((v) => !v)}
          >
            {showDone ? 'Volver a los pendientes' : `Ver marcados como hechos (${formatNumber(inbox.done.length)})`}
          </button>
        </div>
        <p className="border-b border-border bg-sunken px-5 py-2.5 text-caption text-fg-2" data-inbox-note>
          Cada aviso desaparece solo cuando el dato cambia (la factura se cobra, el alta se completa…). «Hecho» lo
          oculta <strong>solo en este navegador</strong>
          {inbox.persistent ? '' : ' y solo mientras dure esta pestaña, porque el navegador no permite guardar'}: no lo
          resuelve ni lo oculta a otras personas.
        </p>

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
            illustration={source.length > 0 ? 'search' : 'empty'}
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
          />
        ) : (
          <div className="divide-y divide-border">
            {KIND_ORDER.filter((k) => visible.some((i) => i.kind === k)).map((k) => {
              const group = visible.filter((i) => i.kind === k);
              return (
                <section key={k} aria-labelledby={`inbox-${k}`} data-inbox-group={k}>
                  <h2 id={`inbox-${k}`} className="bg-sunken px-5 py-2 text-micro text-muted">
                    {KIND_LABEL[k]} <span className="tabular-nums">({formatNumber(group.length)})</span>
                  </h2>
                  <ul className="divide-y divide-border">
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

function ActionButton({ item, actions }: { item: InboxItem; actions: InboxActions }) {
  const a = item.action;
  const label = `${a.label}: ${item.title}`;
  if (a.type === 'confirm-active' && actions.confirm.allowed) {
    return (
      <button type="button" className="ebim-btn-primary ebim-btn-sm" aria-label={label} onClick={() => actions.confirm.open({ tenantId: a.tenantId, tenantName: a.tenantName })}>
        {a.label}
      </button>
    );
  }
  if (a.type === 'execute-alta' && actions.prov.canForProduct('platform.provisioning.execute', a.productId)) {
    const busy = actions.isRunning(a.requestId);
    return (
      <button type="button" className="ebim-btn-primary ebim-btn-sm" aria-label={label} disabled={busy} aria-busy={busy || undefined} onClick={() => void actions.executeAlta(a)}>
        {busy ? 'Ejecutando…' : a.label}
      </button>
    );
  }
  if (a.type === 'check-health' && actions.prov.canForProduct('platform.deployment.read', a.productId)) {
    const busy = actions.health.isRunning(a.targetId);
    return (
      <button type="button" className="ebim-btn-primary ebim-btn-sm" aria-label={label} disabled={busy} aria-busy={busy || undefined} onClick={() => void actions.health.run(a.targetId, a.appName, a.appCode)}>
        {busy ? 'Verificando…' : a.label}
      </button>
    );
  }
  if (a.type === 'link') {
    return (
      <Link className="ebim-btn-primary ebim-btn-sm" to={a.to} aria-label={label}>
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
  const sameScreen = item.action.type === 'link' && item.action.to === item.screen.to;
  return (
    <li className="flex flex-wrap items-start gap-x-4 gap-y-2 px-5 py-3" data-inbox-item={item.key} data-priority={item.priority}>
      <div className="w-[96px] shrink-0 pt-0.5">
        <Badge tone={PRIORITY_TONE[item.priority]} dot>
          {PRIORITY_LABEL[item.priority]}
        </Badge>
      </div>
      <div className="min-w-0 flex-1 basis-[260px]">
        <p className="text-compact font-semibold text-fg">{item.title}</p>
        <p className="mt-0.5 flex flex-wrap gap-x-1.5 text-caption text-muted">
          {item.account ? (
            item.account.to ? (
              <Link className="ebim-link" to={item.account.to}>{item.account.name}</Link>
            ) : (
              <span className="text-fg-2">{item.account.name}</span>
            )
          ) : null}
          {item.app ? <span>{item.account ? '· ' : ''}{item.app}</span> : null}
          <span>{item.account || item.app ? '· ' : ''}{item.ageText}</span>
        </p>
        {item.detail ? <p className="mt-0.5 text-caption text-fg-2">{item.detail}</p> : null}
      </div>
      <div className="flex shrink-0 flex-wrap items-center justify-end gap-2">
        {done ? null : <ActionButton item={item} actions={actions} />}
        {sameScreen && !done ? null : (
          <Link className="ebim-btn-ghost ebim-btn-sm" to={item.screen.to}>
            {item.screen.label}
          </Link>
        )}
        {done ? (
          <button type="button" className="ebim-btn-ghost ebim-btn-sm" aria-label={`Devolver a la bandeja: ${item.title}`} onClick={onRestore}>
            <ArrowCounterClockwiseIcon size={14} aria-hidden />
            Devolver
          </button>
        ) : (
          <button
            type="button"
            className="ebim-btn-ghost ebim-btn-sm"
            aria-label={`Marcar como hecho: ${item.title}`}
            title="Lo oculta solo en este navegador; vuelve si el dato cambia"
            onClick={onDone}
          >
            <CheckIcon size={14} aria-hidden />
            Hecho
          </button>
        )}
      </div>
    </li>
  );
}
