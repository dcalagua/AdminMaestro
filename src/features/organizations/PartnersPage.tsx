import { useMemo, useState } from 'react';
import { useOrganizations, useTenantOverview } from '@/services/queries';
import { useSearchFilter } from '@/hooks/useSearchFilter';
import { usePermissions } from '@/hooks/usePermissions';
import { useNavAccess } from '@/app/useNavAccess';
import { StatusTabs } from '@/components/ui/SectionTabs';
import {
  Badge, Card, DataTable, EmptyState, ErrorState, LoadingState, PageContainer, SearchBar, Skeleton,
  type DataColumn, type DataTableSort,
} from '@/components/ui/primitives';
import { StatCell, StatStrip } from '@/components/ui/StatStrip';
import { AppChips, CellTitle, MoneyCell } from '@/components/ui/cells';
import { nextSort } from '@/components/ui/tableSort';
import { ActionMenu } from '@/components/ui/ActionMenu';
import { Avatar } from '@/components/ui/Avatar';
import { entityStatusLabel, entityStatusTone } from '@/features/catalog/catalogLabels';
import { countryName, formatCountNoun, formatNumber, formatPercent } from '@/lib/format';
import { OrganizationFormDialog, type OrganizationDraft } from './OrganizationFormDialog';
import {
  CAPABILITY_LABEL,
  buildPartnerRows,
  capabilitiesOf,
  partnerSummary,
  type PartnerOrgLike,
  type PartnerRow,
} from './partnerListModel';
import { usePartnerListFees, usePartnerListFinance } from './partnerListQueries';

type StatusFilter = 'ALL' | 'ACTIVE' | 'OTHER';
type SortKey = 'name' | 'tenants' | 'customers';

/**
 * Partners y canales (P24 · V6 · F2, plan §3.2).
 *
 * Organizaciones con capacidad de canal (Partner, Reseller, Consultora) y lo
 * que administran: clientes, tenants y apps; con vista financiera, además el
 * MRR administrado, el margen del canal y la tarifa de plataforma del último
 * período. Arriba, la franja de cifras; acuerdos y cartera en la ficha 360.
 *
 * Solo se resume lo que RLS devuelve al perfil (un admin de partner ve lo
 * suyo): no son agregados globales de EBIM. Nunca se suman monedas.
 */
export function PartnersPage() {
  const access = useNavAccess();
  const finance = access.finance;
  const perms = usePermissions();
  const orgs = useOrganizations();
  const tenants = useTenantOverview();
  const partnerFinance = usePartnerListFinance({ enabled: finance });
  const fees = usePartnerListFees({ enabled: finance });
  const [status, setStatus] = useState<StatusFilter>('ALL');
  const [sort, setSort] = useState<DataTableSort>({ key: 'name', dir: 'asc' });
  const [dialog, setDialog] = useState<{ open: boolean; org: OrganizationDraft | null }>({ open: false, org: null });

  const { term, setTerm, filtered } = useSearchFilter(orgs.data, (o) => [
    o.display_name, o.legal_name, o.slug, o.tax_id, o.country_code,
  ]);
  const byId = useMemo(() => new Map((orgs.data ?? []).map((o) => [o.id, o])), [orgs.data]);

  const all = useMemo(
    () =>
      buildPartnerRows({
        organizations: (orgs.data ?? []) as PartnerOrgLike[],
        tenants: tenants.data ?? [],
        finance: finance ? partnerFinance.data : undefined,
        statements: finance ? fees.data : undefined,
      }),
    [orgs.data, tenants.data, partnerFinance.data, fees.data, finance],
  );
  const visibleIds = new Set(filtered.map((o) => o.id));
  const scoped = all.filter((r) => visibleIds.has(r.id));
  const summary = partnerSummary(all);
  const matches = (r: PartnerRow, f: StatusFilter) =>
    f === 'ALL' || (f === 'ACTIVE' ? r.status === 'ACTIVE' : r.status !== 'ACTIVE');
  const rows = sortPartners(scoped.filter((r) => matches(r, status)), sort.key as SortKey, sort.dir);

  function toDraft(id: string): OrganizationDraft | null {
    const o = byId.get(id);
    if (!o) return null;
    return {
      id: o.id,
      slug: o.slug,
      legal_name: o.legal_name,
      display_name: o.display_name,
      country_code: o.country_code,
      tax_id: o.tax_id,
      billing_email: o.billing_email,
      status: o.status,
      accent_color: o.accent_color,
      capabilities: capabilitiesOf(o),
    };
  }

  const columns: DataColumn[] = [
    { label: 'Partner', sticky: true, sortKey: 'name' },
    { label: 'Clientes', align: 'right', sortKey: 'customers' },
    { label: 'Tenants', align: 'right', sortKey: 'tenants' },
    { label: 'Apps que administra', mobile: false },
    ...(finance
      ? ([
          { label: 'MRR administrado', align: 'right' },
          { label: 'Margen del canal', align: 'right' },
          { label: 'Tarifa plataforma', align: 'right', mobile: false },
        ] as DataColumn[])
      : []),
    { label: 'Acciones', srOnly: true },
  ];

  return (
    <PageContainer
      title="Partners y canales"
      description="Organizaciones que venden o administran tenants: su cartera, lo que facturan y lo que deja el canal. Acuerdos y condiciones por app, en su ficha 360."
      actions={
        perms.canManagePlatform ? (
          <button type="button" className="ebim-btn-primary" onClick={() => setDialog({ open: true, org: null })}>
            Nuevo partner
          </button>
        ) : null
      }
    >
      {orgs.isLoading || all.length > 0 ? (
        <StatStrip label="Resumen de partners">
          <StatCell
            label="Partners activos"
            value={formatNumber(summary.active)}
            loading={orgs.isLoading}
            context={`de ${formatNumber(summary.total)}`}
            onSelect={() => setStatus((s) => (s === 'ACTIVE' ? 'ALL' : 'ACTIVE'))}
            selected={status === 'ACTIVE'}
          />
          <StatCell
            label="Cartera administrada"
            value={formatCountNoun(summary.customers, 'cliente')}
            loading={orgs.isLoading || tenants.isLoading}
            error={tenants.error}
            onRetry={() => void tenants.refetch()}
            context={`${formatCountNoun(summary.tenants, 'tenant')} en la suite`}
          />
          {finance ? (
            <StatCell
              label="MRR administrado"
              amounts={summary.mrr}
              emptyLabel="Sin recurrente"
              loading={tenants.isLoading}
              info="Recurrente mensual de los tenants activos que administra cada partner, por moneda."
              context="Tenants activos, por moneda"
            />
          ) : null}
          {finance ? (
            <StatCell
              label="Margen del canal"
              value={summary.averageMargin === null ? null : formatPercent(summary.averageMargin)}
              emptyLabel="Sin acuerdos"
              loading={partnerFinance.isLoading}
              error={partnerFinance.error}
              onRetry={() => void partnerFinance.refetch()}
              info="Promedio del margen ponderado de los acuerdos de cada partner."
              context="Promedio entre partners"
            />
          ) : null}
          {finance ? (
            <StatCell
              label="Tarifa de plataforma"
              amounts={summary.fee}
              emptyLabel="Sin estados de cuenta"
              loading={fees.isLoading}
              error={fees.error}
              onRetry={() => void fees.refetch()}
              info="Lo que los partners pagan a EBIM por usar la plataforma, en el último período con estado de cuenta."
              context="Último período"
            />
          ) : null}
        </StatStrip>
      ) : null}

      <Card>
        <SearchBar
          value={term}
          onChange={setTerm}
          total={orgs.isLoading ? undefined : all.length}
          placeholder="Buscar por nombre, razón social, RUC/NIT o país…"
          right={
            <StatusTabs
              label="Estado del partner"
              value={status}
              onChange={setStatus}
              options={[
                { id: 'ALL', label: 'Todos', count: scoped.length },
                { id: 'ACTIVE', label: 'Activos', count: scoped.filter((r) => matches(r, 'ACTIVE')).length },
                { id: 'OTHER', label: 'Inactivos o archivados', count: scoped.filter((r) => matches(r, 'OTHER')).length },
              ]}
            />
          }
        />
        {orgs.isLoading ? (
          <LoadingState label="Cargando partners…" />
        ) : orgs.error ? (
          <ErrorState error={orgs.error} onRetry={() => void orgs.refetch()} />
        ) : all.length === 0 ? (
          <EmptyState
            title="Sin partners"
            description="No hay partners ni canales visibles para tu perfil."
            action={
              perms.canManagePlatform ? (
                <button type="button" className="ebim-btn-primary" onClick={() => setDialog({ open: true, org: null })}>
                  Nuevo partner
                </button>
              ) : undefined
            }
          />
        ) : rows.length === 0 ? (
          <EmptyState
            variant="no-results"
            title={term ? `Ningún resultado para «${term}»` : 'Ningún partner en este estado'}
            description="Prueba con otra búsqueda o cambia de pestaña."
            onClear={() => {
              setTerm('');
              setStatus('ALL');
            }}
          />
        ) : (
          <DataTable
            label="Partners"
            minWidth={finance ? 1040 : 760}
            sort={sort}
            onSort={(key) => setSort((s) => nextSort(s, key))}
            columns={columns}
          >
            {rows.map((r) => (
              <tr key={r.id} data-partner={r.id} className={r.status === 'ACTIVE' ? undefined : 'opacity-80'}>
                <td className="ebim-td py-2">
                  <div className="max-w-[300px]">
                    <CellTitle
                      title={r.name}
                      to={`/organizations/${r.id}`}
                      leading={<Avatar name={r.name} ringColor={r.accent} />}
                      // «Partner» es lo normal aquí: la segunda línea marca las OTRAS capacidades.
                      secondary={[
                        r.capabilities
                          .filter((c) => c !== 'PARTNER')
                          .map((c) => CAPABILITY_LABEL[c] ?? c)
                          .join(' y ') || null,
                        r.legalName && r.legalName !== r.name ? r.legalName : null,
                        r.country ? countryName(r.country) : null,
                        r.taxId,
                      ]}
                      monoParts={[3]}
                      aside={
                        r.status !== 'ACTIVE' ? (
                          <Badge tone={entityStatusTone(r.status)} dot>
                            {entityStatusLabel(r.status)}
                          </Badge>
                        ) : undefined
                      }
                    />
                  </div>
                </td>
                <td className="ebim-td ebim-num">{tenants.data ? formatNumber(r.customers) : '—'}</td>
                <td className="ebim-td ebim-num" title={`${formatNumber(r.activeTenants)} activos`}>
                  {tenants.data ? formatNumber(r.tenants) : '—'}
                </td>
                <td className="ebim-td py-2">
                  {tenants.isLoading ? (
                    <Skeleton className="h-4 w-28" />
                  ) : (
                    <div className="min-w-[160px]">
                      <AppChips
                        label={`Apps que administra ${r.name}`}
                        empty="Sin tenants a su cargo"
                        items={r.apps.map((a) => ({
                          key: a.productId,
                          name: a.tenants > 1 ? `${a.name} ×${a.tenants}` : a.name,
                        }))}
                      />
                    </div>
                  )}
                </td>
                {finance ? (
                  <>
                    <td className="ebim-td ebim-num">
                      {tenants.isLoading ? <Skeleton className="ml-auto h-4 w-16" /> : <MoneyCell amounts={r.mrr} />}
                    </td>
                    <td className="ebim-td ebim-num">
                      {partnerFinance.isLoading ? (
                        <Skeleton className="ml-auto h-4 w-12" />
                      ) : r.marginRate === null ? (
                        <span className="text-muted">—</span>
                      ) : (
                        <span
                          className="inline-flex flex-col items-end leading-tight"
                          title="Margen ponderado de sus acuerdos de canal"
                        >
                          <span className="font-semibold tabular-nums text-fg">{formatPercent(r.marginRate)}</span>
                          {r.activeAgreements ? (
                            <span className="text-caption text-muted">{formatCountNoun(r.activeAgreements, 'acuerdo')}</span>
                          ) : null}
                        </span>
                      )}
                    </td>
                    <td className="ebim-td ebim-num">
                      {fees.isLoading ? <Skeleton className="ml-auto h-4 w-16" /> : <MoneyCell amounts={r.fee} tone="muted" />}
                    </td>
                  </>
                ) : null}
                <td className="ebim-td w-12 text-right">
                  <ActionMenu
                    label={`Acciones de ${r.name}`}
                    items={[
                      { label: 'Abrir ficha 360', to: `/organizations/${r.id}` },
                      { label: 'Ver contratos', to: `/organizations/${r.id}?tab=contratos#contracts` },
                      perms.canManageOrganization(r.id)
                        ? { label: 'Editar datos', onSelect: () => setDialog({ open: true, org: toDraft(r.id) }) }
                        : null,
                    ]}
                  />
                </td>
              </tr>
            ))}
          </DataTable>
        )}
      </Card>

      <OrganizationFormDialog
        open={dialog.open}
        organization={dialog.org}
        defaultCapability="PARTNER"
        onClose={() => setDialog({ open: false, org: null })}
      />
    </PageContainer>
  );
}

function sortPartners(rows: PartnerRow[], key: SortKey, dir: 'asc' | 'desc'): PartnerRow[] {
  const sign = dir === 'asc' ? 1 : -1;
  return [...rows].sort((a, b) => {
    if (key === 'tenants') return sign * (a.tenants - b.tenants) || a.name.localeCompare(b.name, 'es');
    if (key === 'customers') return sign * (a.customers - b.customers) || a.name.localeCompare(b.name, 'es');
    return sign * a.name.localeCompare(b.name, 'es');
  });
}
