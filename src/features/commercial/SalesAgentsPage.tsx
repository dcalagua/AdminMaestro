import { useMemo, useState } from 'react';
import { useSalesAgents, useAttributions, useTenantOverview } from '@/services/queries';
import { useSearchFilter } from '@/hooks/useSearchFilter';
import { usePermissions } from '@/hooks/usePermissions';
import { useNavAccess } from '@/app/useNavAccess';
import { StatusTabs } from '@/components/ui/SectionTabs';
import {
  PageContainer, Card, DataTable, SearchBar, LoadingState, ErrorState, EmptyState, Badge, Skeleton,
  type DataColumn,
} from '@/components/ui/primitives';
import { StatCell, StatStrip } from '@/components/ui/StatStrip';
import { CellTitle, MoneyCell, StatusCell, type CellTone } from '@/components/ui/cells';
import { formatAmountsCompact, formatCountNoun, formatDate, formatNumber } from '@/lib/format';
import {
  entityStatusLabel, entityStatusTabs, entityStatusTone, matchesEntityStatusTab,
} from '@/features/catalog/catalogLabels';
import type { EntityStatusTab } from '@/features/catalog/catalogLabels';
import { SalesAgentFormDialog } from './CommercialDialogs';
import { ActionMenu } from '@/components/ui/ActionMenu';
import { Avatar } from '@/components/ui/Avatar';
import { AGENT_TYPE_LABEL } from './commercialLabels';
import type { SalesAgentDraft } from './CommercialDialogs';
import { agentCommissions, agentPortfolios } from './salesTeamModel';
import { useSalesTeamCommissions } from './salesTeamQueries';

function sumMaps(maps: Array<Record<string, number>>): Record<string, number> {
  const out: Record<string, number> = {};
  for (const m of maps) for (const [c, v] of Object.entries(m)) out[c] = (out[c] ?? 0) + v;
  return out;
}

/**
 * Equipo comercial (P15 · V6 · F2, plan §3.2).
 *
 * Un comercial puede existir sin `user_id` (no todos tienen login) y sin
 * organización (independiente). Crear uno NUNCA crea un tenant_membership:
 * cobrar comisión no da acceso operativo a ningún tenant.
 *
 * La cartera sale SÓLO de las atribuciones vigentes (clientes y productos
 * distintos). Con vista financiera, además: MRR atribuido (tenants activos ×
 * participación) y comisión por liquidar y pagada (`v_commission_detail`), por
 * moneda. No hay embudo ni oportunidades: no existe una fuente y no se inventa.
 */
export function SalesAgentsPage() {
  const access = useNavAccess();
  const finance = access.finance;
  const agents = useSalesAgents();
  const attributions = useAttributions();
  const tenants = useTenantOverview({ enabled: finance });
  const commissions = useSalesTeamCommissions({ enabled: finance });
  const perms = usePermissions();
  const [tab, setTab] = useState<EntityStatusTab>('ALL');
  const [dialog, setDialog] = useState<{ open: boolean; agent: SalesAgentDraft | null }>({
    open: false,
    agent: null,
  });
  const { term, setTerm, filtered } = useSearchFilter(agents.data, (a) => [
    a.full_name, a.code, a.contact_email, AGENT_TYPE_LABEL[a.agent_type] ?? a.agent_type,
    (a.organizations as { display_name: string } | null)?.display_name,
  ]);
  const visible = filtered.filter((a) => matchesEntityStatusTab(a.status, tab));
  const all = agents.data ?? [];

  const portfolio = useMemo(
    () => agentPortfolios(attributions.data ?? [], finance ? tenants.data : undefined),
    [attributions.data, tenants.data, finance],
  );
  const earned = useMemo(() => agentCommissions(commissions.data ?? []), [commissions.data]);
  const totalPending = sumMaps([...earned.values()].map((e) => e.pending));
  const totalMrr = sumMaps([...portfolio.values()].map((p) => p.mrr));
  const withPortfolio = all.filter((a) => portfolio.has(a.id)).length;
  const attributionsLoading = attributions.isLoading;

  const columns: DataColumn[] = [
    { label: 'Comercial', sticky: true },
    { label: 'Tipo' },
    { label: 'Cartera' },
    ...(finance
      ? ([
          { label: 'MRR atribuido', align: 'right' },
          { label: 'Comisión por liquidar', align: 'right' },
        ] as DataColumn[])
      : []),
    { label: 'Estado', mobile: false },
    { label: 'Acciones', srOnly: true },
  ];

  return (
    <PageContainer
      title="Equipo comercial"
      description="Comerciales internos de EBIM, de partner o independientes, con la cartera que tienen atribuida y lo que han ganado. Cobrar comisión no da acceso operativo a ningún tenant."
      actions={
        perms.canManageCommercial ? (
          <button
            type="button"
            className="ebim-btn-primary"
            onClick={() => setDialog({ open: true, agent: null })}
          >
            Nuevo comercial
          </button>
        ) : null
      }
    >
      {agents.isLoading || all.length > 0 ? (
        <StatStrip label="Resumen del equipo comercial">
          <StatCell
            label="Comerciales activos"
            value={formatNumber(all.filter((a) => a.status === 'ACTIVE').length)}
            loading={agents.isLoading}
            context={`de ${formatNumber(all.length)}`}
          />
          <StatCell
            label="Con cartera"
            value={formatNumber(withPortfolio)}
            loading={agents.isLoading || attributionsLoading}
            error={attributions.error}
            onRetry={() => void attributions.refetch()}
            context={`${formatCountNoun(
              [...portfolio.values()].reduce((n, p) => n + p.attributions, 0),
              'atribución',
              'atribuciones',
            )} vigentes`}
          />
          {finance ? (
            <StatCell
              label="MRR atribuido"
              amounts={totalMrr}
              emptyLabel="Sin recurrente"
              loading={tenants.isLoading || attributionsLoading}
              info="Recurrente mensual de los tenants activos de cada cartera, por la participación de cada comercial. Por moneda."
              context="Por participación, por moneda"
            />
          ) : null}
          {finance ? (
            <StatCell
              label="Comisión por liquidar"
              amounts={totalPending}
              emptyLabel="Nada por liquidar"
              loading={commissions.isLoading}
              error={commissions.error}
              onRetry={() => void commissions.refetch()}
              info="Comisión devengada sobre cobros confirmados que todavía no entra en una liquidación pagada."
              context="Sobre cobros confirmados"
            />
          ) : null}
        </StatStrip>
      ) : null}

      <Card>
        <SearchBar
          value={term}
          onChange={setTerm}
          total={agents.isLoading ? undefined : all.length}
          placeholder="Buscar comercial por nombre, correo, código u organización…"
          right={<StatusTabs label="Estado del comercial" value={tab} onChange={setTab} options={entityStatusTabs(filtered)} />}
        />
        {agents.isLoading ? (
          <LoadingState label="Cargando equipo comercial…" />
        ) : agents.error ? (
          <ErrorState error={agents.error} onRetry={() => void agents.refetch()} />
        ) : all.length === 0 ? (
          <EmptyState
            title="Sin comerciales"
            description="Todavía no hay comerciales visibles para tu perfil."
            action={
              perms.canManageCommercial ? (
                <button type="button" className="ebim-btn-primary" onClick={() => setDialog({ open: true, agent: null })}>
                  Nuevo comercial
                </button>
              ) : undefined
            }
          />
        ) : visible.length === 0 ? (
          <EmptyState
            variant="no-results"
            title="Ningún comercial coincide"
            description="Prueba con otra búsqueda o cambia de pestaña."
            onClear={() => {
              setTerm('');
              setTab('ALL');
            }}
          />
        ) : (
          <DataTable label="Equipo comercial" minWidth={finance ? 1040 : 760} columns={columns}>
            {visible.map((a) => {
              const own = portfolio.get(a.id);
              const money = earned.get(a.id);
              const org = (a.organizations as { display_name: string } | null)?.display_name ?? 'Independiente';
              return (
                <tr key={a.id} data-agent={a.code} className={a.status === 'ACTIVE' ? undefined : 'opacity-80'}>
                  <td className="ebim-td py-2">
                    <div className="max-w-[280px]">
                      <CellTitle
                        title={a.full_name}
                        tooltip={`${a.full_name}\nCódigo: ${a.code}`}
                        leading={<Avatar name={a.full_name} mode="person" />}
                        secondary={
                          <span title={[org, a.contact_email].filter(Boolean).join(' · ')}>
                            {org}
                            {a.contact_email ? (
                              <>
                                {' · '}
                                <a className="hover:text-accent-deep hover:underline" href={`mailto:${a.contact_email}`}>
                                  {a.contact_email}
                                </a>
                              </>
                            ) : null}
                          </span>
                        }
                      />
                    </div>
                  </td>
                  <td className="ebim-td">
                    <Badge tone="neutral">{AGENT_TYPE_LABEL[a.agent_type] ?? a.agent_type}</Badge>
                  </td>
                  <td className="ebim-td py-2 text-compact">
                    {attributionsLoading ? (
                      <Skeleton className="h-4 w-28" />
                    ) : attributions.error ? (
                      <span className="text-muted">No disponible</span>
                    ) : own ? (
                      <span className="block max-w-[220px] leading-tight" title={own.products.join(', ')}>
                        <span className="block whitespace-nowrap font-semibold text-fg">
                          {formatCountNoun(own.customers, 'cliente')}
                          <span className="font-normal text-muted"> · {formatCountNoun(own.attributions, 'atribución', 'atribuciones')}</span>
                        </span>
                        <span className="block truncate text-caption text-muted">{own.products.join(', ')}</span>
                      </span>
                    ) : (
                      <span className="text-muted">Sin cartera atribuida</span>
                    )}
                  </td>
                  {finance ? (
                    <>
                      <td className="ebim-td ebim-num">
                        {tenants.isLoading || attributionsLoading ? (
                          <Skeleton className="ml-auto h-4 w-16" />
                        ) : (
                          <MoneyCell amounts={own?.mrr} />
                        )}
                      </td>
                      <td className="ebim-td ebim-num">
                        {commissions.isLoading ? (
                          <Skeleton className="ml-auto h-4 w-16" />
                        ) : commissions.error ? (
                          <span className="text-compact text-muted">No disponible</span>
                        ) : (
                          // Lo pagado va debajo, en pequeño: una columna en lugar de dos.
                          <CommissionCell pending={money?.pending} paid={money?.paid} />
                        )}
                      </td>
                    </>
                  ) : null}
                  <td className="ebim-td py-2">
                    <StatusCell
                      label={entityStatusLabel(a.status)}
                      tone={entityStatusTone(a.status) as CellTone}
                      detail={a.valid_to ? `Hasta ${formatDate(a.valid_to)}` : `Desde ${formatDate(a.valid_from)}`}
                    />
                  </td>
                  <td className="ebim-td w-12 text-right">
                    <ActionMenu
                      label={`Acciones de ${a.full_name}`}
                      items={[
                        own ? { label: 'Ver atribuciones', to: '/sales-agents?tab=atribuciones' } : null,
                        perms.canManageCommercial || perms.isOrgAdmin(a.organization_id)
                          ? {
                              label: 'Editar comercial',
                              onSelect: () =>
                                setDialog({
                                  open: true,
                                  agent: {
                                    id: a.id,
                                    code: a.code,
                                    full_name: a.full_name,
                                    agent_type: a.agent_type,
                                    organization_id: a.organization_id,
                                    contact_email: a.contact_email,
                                    user_id: a.user_id,
                                    status: a.status,
                                    valid_from: a.valid_from,
                                    valid_to: a.valid_to,
                                  },
                                }),
                            }
                          : null,
                      ]}
                    />
                  </td>
                </tr>
              );
            })}
          </DataTable>
        )}
      </Card>

      <SalesAgentFormDialog
        open={dialog.open}
        agent={dialog.agent}
        onClose={() => setDialog({ open: false, agent: null })}
      />
    </PageContainer>
  );
}

/** Comisión por liquidar y, debajo, lo ya pagado (por moneda, compacto; el monto completo en el `title`). */
function CommissionCell({ pending, paid }: { pending?: Record<string, number>; paid?: Record<string, number> }) {
  const hasPending = Boolean(pending && Object.keys(pending).length > 0);
  const paidText = paid && Object.keys(paid).length > 0 ? `Pagado ${formatAmountsCompact(paid)}` : null;
  if (hasPending) return <MoneyCell amounts={pending} context={paidText ?? undefined} />;
  return (
    <span className="inline-flex flex-col items-end leading-tight">
      <span className="text-muted">—</span>
      {paidText ? <span className="whitespace-nowrap text-caption text-muted">{paidText}</span> : null}
    </span>
  );
}
