import { useState, type ReactNode } from 'react';
import {
  CaretDownIcon,
  CurrencyCircleDollarIcon,
  GaugeIcon,
  PencilSimpleIcon,
  PlusIcon,
  PlugsConnectedIcon,
  ProhibitIcon,
  UserGearIcon,
  WarningCircleIcon,
} from '@phosphor-icons/react';
import {
  auditActionKind,
  auditActionLabel,
  auditDayLabel,
  auditTime,
  entityTypeLabel,
  groupByDay,
  type AuditKind,
} from './auditActions';
import { Link } from 'react-router-dom';
import { changedFieldsOf, metadataSummary } from './auditFormat';
import type { AuditEntityView } from './auditEntities';

/**
 * Línea de tiempo de auditoría (fase 12, VISUAL_SYSTEM_V2 §8 PT-TIMELINE).
 *
 * Agrupa por día (zona del navegador) filas YA ordenadas por la consulta; cada
 * evento dice QUÉ pasó en español, SOBRE QUÉ (con su nombre si se conoce), QUIÉN
 * y CUÁNDO, con un icono por tipo de acción. El código original, los ids y la
 * correlación van al detalle (V6 · F4). El detalle (diff y metadata redactada)
 * se despliega bajo el evento: el JSON nunca es contenido principal (spec §12).
 */

export interface TimelineEvent {
  id: number | string;
  occurred_at: string;
  action: string;
  actor_email: string | null;
  entity_type: string | null;
  entity_id: string | null;
  tenant_id?: string | null;
  organization_id?: string | null;
  metadata: unknown;
}

const KIND: Record<AuditKind, { Icon: typeof PlusIcon; cls: string; sr: string }> = {
  create: { Icon: PlusIcon, cls: 'bg-accent-soft text-accent-deep', sr: 'Alta' },
  update: { Icon: PencilSimpleIcon, cls: 'bg-sunken text-fg-2', sr: 'Cambio' },
  remove: { Icon: ProhibitIcon, cls: 'bg-warn-soft text-warn', sr: 'Baja o revocación' },
  money: { Icon: CurrencyCircleDollarIcon, cls: 'bg-info-soft text-info', sr: 'Dinero' },
  access: { Icon: UserGearIcon, cls: 'bg-sunken text-fg-2', sr: 'Accesos' },
  provision: { Icon: PlugsConnectedIcon, cls: 'bg-sunken text-fg-2', sr: 'Operación SaaS' },
  usage: { Icon: GaugeIcon, cls: 'bg-sunken text-fg-2', sr: 'Uso' },
  failure: { Icon: WarningCircleIcon, cls: 'bg-danger-soft text-danger', sr: 'Fallo' },
};


export function AuditTimeline<Row extends TimelineEvent>({
  rows,
  label,
  renderDetail,
  showSummary = true,
  actionLabel = auditActionLabel,
  actorOf = (row) => row.actor_email ?? 'Sistema',
  extraOf,
  entityOf,
}: {
  rows: readonly Row[];
  /** Nombre accesible de la línea de tiempo. */
  label: string;
  /** Contenido del detalle desplegable de un evento; sin él no hay botón «Ver detalle». */
  renderDetail?: (row: Row) => ReactNode;
  /** Resumen de metadata y correlación bajo el evento. */
  showSummary?: boolean;
  /** Frase del evento (por defecto, el diccionario general de la bitácora). */
  actionLabel?: (action: string) => string | null;
  /** Quién (por defecto, el correo del actor o «Sistema»). */
  actorOf?: (row: Row) => string;
  /** Dato breve propio de la pantalla (rol, motivo) junto a quién/cuándo. */
  extraOf?: (row: Row) => string | null;
  /** Nombre legible de la entidad (V6 · F4); sin él, solo el tipo. */
  entityOf?: (row: Row) => AuditEntityView;
}) {
  const [open, setOpen] = useState<Row['id'] | null>(null);
  return (
    <div role="list" aria-label={label} data-audit-timeline>
      {groupByDay(rows).map((group) => (
        <section key={group.key} role="listitem" aria-label={auditDayLabel(group.first)}>
          <h3 className="border-b border-border bg-sunken px-5 py-2 text-micro text-muted">{auditDayLabel(group.first)}</h3>
          <ol className="relative">
            {group.rows.map((row, i) => {
              const kind = KIND[auditActionKind(row.action)];
              const label = actionLabel(row.action);
              const human = label && label !== row.action ? label : null;
              const extra = extraOf?.(row) ?? null;
              const expanded = open === row.id;
              const entity = entityOf?.(row) ?? { type: entityTypeLabel(row.entity_type), name: null, to: null };
              const changed = changedFieldsOf(row.metadata).length;
              const detailId = `audit-event-${row.id}`;
              const last = i === group.rows.length - 1;
              return (
                <li
                  key={row.id}
                  className={`relative px-5 py-3 transition-colors duration-fast ${expanded ? 'bg-hover' : 'hover:bg-hover'} ${
                    last ? '' : 'border-b border-border'
                  }`}
                  data-audit-kind={auditActionKind(row.action)}
                >
                  <div className="grid grid-cols-[32px_minmax(0,1fr)_auto] items-start gap-x-3">
                    <span className={`flex h-8 w-8 items-center justify-center rounded-full ${kind.cls}`}>
                      <kind.Icon size={16} weight="bold" aria-hidden />
                      <span className="sr-only">{kind.sr}</span>
                    </span>
                    <div className="min-w-0">
                      <p className="flex flex-wrap items-baseline gap-x-2 text-body">
                        <span className="font-semibold text-fg">{human ?? row.action}</span>
                        <span className="text-fg-2" data-audit-entity>
                          {entity.type}
                          {entity.name ? (
                            <>
                              {' · '}
                              {entity.to ? (
                                <Link to={entity.to} className="ebim-link font-medium">
                                  {entity.name}
                                </Link>
                              ) : (
                                <span className="font-medium text-fg">{entity.name}</span>
                              )}
                            </>
                          ) : null}
                        </span>
                      </p>
                      <p className="mt-0.5 flex flex-wrap items-baseline gap-x-1.5 text-caption text-muted">
                        <time dateTime={row.occurred_at} className="font-semibold text-fg-2 tabular-nums">
                          {auditTime(row.occurred_at)}
                        </time>
                        <span aria-hidden>·</span>
                        <span className="break-all">{actorOf(row)}</span>
                        {extra ? (
                          <>
                            <span aria-hidden>·</span>
                            <span className="text-fg-2">{extra}</span>
                          </>
                        ) : null}
                        {showSummary && changed > 0 ? (
                          <>
                            <span aria-hidden>·</span>
                            <span>{metadataSummary(row.metadata)}</span>
                          </>
                        ) : null}
                      </p>
                    </div>
                    {renderDetail ? (
                    <button
                      type="button"
                      className="ebim-btn-ghost ebim-btn-sm"
                      aria-expanded={expanded}
                      aria-controls={detailId}
                      onClick={() => setOpen(expanded ? null : row.id)}
                    >
                      {/* En móvil solo el icono: el texto del evento necesita el ancho (el nombre accesible se conserva). */}
                      <span className="max-sm:sr-only">{expanded ? 'Ocultar' : 'Ver detalle'}</span>
                      <CaretDownIcon
                        size={12}
                        weight="bold"
                        aria-hidden
                        className={`transition-transform duration-fast ${expanded ? 'rotate-180' : ''}`}
                      />
                    </button>
                    ) : null}
                  </div>
                  {renderDetail ? (
                    <div id={detailId} className="ml-11 mt-3 empty:hidden">
                      {expanded ? renderDetail(row) : null}
                    </div>
                  ) : null}
                </li>
              );
            })}
          </ol>
        </section>
      ))}
    </div>
  );
}
