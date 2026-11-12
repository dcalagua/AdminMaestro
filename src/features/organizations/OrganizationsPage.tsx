import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useOrganizations, useTenantOverview } from '@/services/queries';
import { useSearchFilter } from '@/hooks/useSearchFilter';
import { usePermissions } from '@/hooks/usePermissions';
import { StatusTabs } from '@/components/ui/SectionTabs';
import {
  PageContainer, Card, DataTable, SearchBar, LoadingState, ErrorState, EmptyState, Badge,
} from '@/components/ui/primitives';
import { ActionMenu } from '@/components/ui/ActionMenu';
import { Avatar } from '@/components/ui/Avatar';
import { entityStatusLabel, entityStatusTone } from '@/features/catalog/catalogLabels';
import { formatNumber } from '@/lib/format';
import { OrganizationFormDialog } from './OrganizationFormDialog';
import type { OrganizationDraft } from './OrganizationFormDialog';
import type { Enums } from '@/types/domain';

const CAPABILITY_LABEL: Record<string, string> = {
  PARTNER: 'Partner',
  RESELLER: 'Reseller',
  CONSULTING: 'Consultora',
  CUSTOMER: 'Cliente',
};

const CHANNEL_CAPABILITIES = ['PARTNER', 'RESELLER', 'CONSULTING'];

type CapabilityFilter = 'ALL' | 'PARTNER' | 'CUSTOMER';
type StatusFilter = 'ALL' | 'ACTIVE' | 'OTHER';

function capabilitiesOf(o: { organization_capabilities?: unknown }): string[] {
  return ((o.organization_capabilities ?? []) as Array<{ capability: string }>).map((c) => c.capability);
}

function matchesCapability(caps: string[], filter: CapabilityFilter): boolean {
  if (filter === 'ALL') return true;
  if (filter === 'PARTNER') return caps.some((c) => CHANNEL_CAPABILITIES.includes(c));
  return caps.includes('CUSTOMER');
}

/**
 * Directorio corporativo (P23) — y el MISMO componente para Clientes (P21) y
 * Partners (P24).
 *
 * Una organización no tiene un "tipo": acumula CAPACIDADES. Consultora Andina
 * aparece como Partner + Consultora + Cliente en la misma fila, sin duplicar la
 * cuenta (D-006). Clientes y Partners son vistas de este directorio: mismo CRUD,
 * mismos permisos y cada fila lleva a la ficha 360 `/organizations/:id`.
 *
 * Sólo se muestran las filas que RLS devuelve; los conteos de las pestañas son
 * de ese alcance, nunca un agregado global de EBIM.
 */
export function OrganizationsPage({
  capabilityFilter,
  title,
  description,
}: {
  capabilityFilter?: CapabilityFilter;
  title?: string;
  description?: string;
} = {}) {
  const orgs = useOrganizations();
  // Conteo de tenants por organización (cliente / administradora): misma caché
  // que el listado de Tenants; si falla, la columna dice «—» y la tabla sigue.
  const tenants = useTenantOverview();
  const perms = usePermissions();
  const [tab, setTab] = useState<CapabilityFilter>(capabilityFilter ?? 'ALL');
  const [status, setStatus] = useState<StatusFilter>('ALL');
  const [dialog, setDialog] = useState<{ open: boolean; org: OrganizationDraft | null }>({
    open: false,
    org: null,
  });

  // La pantalla de Partners crea partners y la de Clientes crea clientes: la
  // capacidad por defecto sale del filtro con el que se entró.
  const defaultCapability: Enums<'org_capability'> | undefined =
    capabilityFilter === 'PARTNER' ? 'PARTNER' : capabilityFilter === 'CUSTOMER' ? 'CUSTOMER' : undefined;

  const { term, setTerm, filtered } = useSearchFilter(orgs.data, (o) => [
    o.display_name, o.legal_name, o.slug, o.tax_id, o.country_code,
  ]);

  function toDraft(o: (typeof filtered)[number]): OrganizationDraft {
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

  // Vista fija (Clientes / Partners): la capacidad no es elegible y las
  // pestañas pasan a ser de estado. Directorio: pestañas de capacidad.
  const scoped = capabilityFilter
    ? filtered.filter((o) => matchesCapability(capabilitiesOf(o), capabilityFilter))
    : filtered;
  const rows = capabilityFilter
    ? scoped.filter((o) => status === 'ALL' || (status === 'ACTIVE' ? o.status === 'ACTIVE' : o.status !== 'ACTIVE'))
    : scoped.filter((o) => matchesCapability(capabilitiesOf(o), tab));

  const tenantCount = new Map<string, { own: number; managed: number }>();
  for (const t of tenants.data ?? []) {
    for (const [id, key] of [
      [t.customer_organization_id, 'own'],
      [t.managing_organization_id, 'managed'],
    ] as const) {
      if (!id) continue;
      const c = tenantCount.get(id) ?? { own: 0, managed: 0 };
      c[key] += 1;
      tenantCount.set(id, c);
    }
  }
  const countCell = (id: string, key: 'own' | 'managed') =>
    tenants.data ? formatNumber(tenantCount.get(id)?.[key] ?? 0) : '—';
  const showOwn = capabilityFilter !== 'PARTNER';
  const showManaged = capabilityFilter !== 'CUSTOMER';

  const activeCount = scoped.filter((o) => o.status === 'ACTIVE').length;
  const hasAny = (orgs.data ?? []).length > 0;
  const noun = capabilityFilter === 'PARTNER' ? 'partners' : capabilityFilter === 'CUSTOMER' ? 'clientes' : 'organizaciones';

  return (
    <PageContainer
      title={title ?? 'Directorio corporativo'}
      description={
        description ??
        'Cuentas de la plataforma con sus capacidades: una misma organización puede ser partner y cliente a la vez. Abre la ficha 360 para ver su cartera.'
      }
      actions={
        perms.canManagePlatform ? (
          <button
            type="button"
            className="ebim-btn-primary"
            onClick={() => setDialog({ open: true, org: null })}
          >
            {capabilityFilter === 'PARTNER'
              ? 'Nuevo partner'
              : capabilityFilter === 'CUSTOMER'
                ? 'Nuevo cliente'
                : 'Nueva organización'}
          </button>
        ) : null
      }
    >
      <Card>
        <SearchBar
          value={term}
          onChange={setTerm}
          placeholder="Buscar por nombre, RUC/NIT o país…"
          right={
            capabilityFilter ? (
              <StatusTabs
                value={status}
                onChange={setStatus}
                options={[
                  { id: 'ALL', label: 'Todos', count: scoped.length },
                  { id: 'ACTIVE', label: 'Activos', count: activeCount },
                  { id: 'OTHER', label: 'Inactivos o archivados', count: scoped.length - activeCount },
                ]}
              />
            ) : (
              <StatusTabs
                value={tab}
                onChange={setTab}
                options={[
                  { id: 'ALL', label: 'Todas', count: filtered.length },
                  {
                    id: 'PARTNER',
                    label: 'Partners',
                    count: filtered.filter((o) => matchesCapability(capabilitiesOf(o), 'PARTNER')).length,
                  },
                  {
                    id: 'CUSTOMER',
                    label: 'Clientes',
                    count: filtered.filter((o) => matchesCapability(capabilitiesOf(o), 'CUSTOMER')).length,
                  },
                ]}
              />
            )
          }
        />
        {orgs.isLoading ? (
          <LoadingState label={`Cargando ${noun}…`} />
        ) : orgs.error ? (
          <ErrorState error={orgs.error} onRetry={() => void orgs.refetch()} />
        ) : rows.length === 0 ? (
          <EmptyState
            title={hasAny && term ? `Ningún resultado para «${term}»` : `Sin ${noun}`}
            description={
              hasAny && term
                ? 'Prueba con otra búsqueda o cambia de pestaña.'
                : `No hay ${noun} visibles para tu perfil en esta pestaña.`
            }
          />
        ) : (
          <DataTable
            columns={[
              'Organización',
              'País',
              'Identificación fiscal',
              ...(capabilityFilter ? [] : ['Capacidades']),
              ...(showOwn ? [{ label: 'Tenants', align: 'right' as const }] : []),
              ...(showManaged ? [{ label: 'Administra', align: 'right' as const }] : []),
              'Estado',
              { label: 'Acciones', srOnly: true },
            ]}
          >
            {rows.map((o) => {
              const caps = capabilitiesOf(o);
              return (
                <tr key={o.id}>
                  <td className="ebim-td">
                    <div className="flex items-center gap-3">
                      <Avatar name={o.display_name} ringColor={o.accent_color} />
                      <div className="min-w-0">
                        <Link className="font-semibold text-fg hover:underline" to={`/organizations/${o.id}`}>
                          {o.display_name}
                        </Link>
                        <div className="truncate text-compact text-fg-2" title={o.legal_name}>
                          {o.legal_name}
                        </div>
                      </div>
                    </div>
                  </td>
                  <td className="ebim-td">{o.country_code}</td>
                  <td className="ebim-td whitespace-nowrap font-mono text-compact text-fg-2">{o.tax_id ?? '—'}</td>
                  {capabilityFilter ? null : (
                    <td className="ebim-td">
                      <div className="flex flex-wrap gap-1">
                        {o.kind === 'PLATFORM' ? <Badge tone="accent">Plataforma EBIM</Badge> : null}
                        {caps.map((c) => (
                          <Badge key={c} tone={c === 'CUSTOMER' ? 'info' : 'neutral'}>
                            {CAPABILITY_LABEL[c] ?? c}
                          </Badge>
                        ))}
                      </div>
                    </td>
                  )}
                  {showOwn ? <td className="ebim-td ebim-num">{countCell(o.id, 'own')}</td> : null}
                  {showManaged ? <td className="ebim-td ebim-num">{countCell(o.id, 'managed')}</td> : null}
                  <td className="ebim-td">
                    <Badge tone={entityStatusTone(o.status)} dot>
                      {entityStatusLabel(o.status)}
                    </Badge>
                  </td>
                  <td className="ebim-td w-12 text-right">
                    <ActionMenu
                      label={`Acciones de ${o.display_name}`}
                      items={[
                        { label: 'Abrir ficha 360', to: `/organizations/${o.id}` },
                        { label: 'Ver contratos', to: `/organizations/${o.id}#contracts` },
                        perms.canManageOrganization(o.id)
                          ? { label: 'Editar datos', onSelect: () => setDialog({ open: true, org: toDraft(o) }) }
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

      <OrganizationFormDialog
        open={dialog.open}
        organization={dialog.org}
        defaultCapability={defaultCapability}
        onClose={() => setDialog({ open: false, org: null })}
      />
    </PageContainer>
  );
}
