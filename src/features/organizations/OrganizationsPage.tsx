import { Link } from 'react-router-dom';
import { useOrganizations } from '@/services/queries';
import { useSearchFilter } from '@/hooks/useSearchFilter';
import { StatusTabs } from '@/components/ui/SectionTabs';
import {
  PageContainer, Card, DataTable, SearchBar, LoadingState, ErrorState, EmptyState, Badge,
} from '@/components/ui/primitives';
import { useState } from 'react';

const CAPABILITY_LABEL: Record<string, string> = {
  PARTNER: 'Partner',
  RESELLER: 'Reseller',
  CONSULTING: 'Consultora',
  CUSTOMER: 'Cliente',
};

type CapabilityFilter = 'ALL' | 'PARTNER' | 'CUSTOMER';

/**
 * Listado de organizaciones.
 *
 * Una organización no tiene un "tipo": acumula CAPACIDADES. Consultora Andina
 * aparece como Partner + Consultora + Cliente en la misma fila, sin duplicar la
 * cuenta (D-006).
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
  const [tab, setTab] = useState<CapabilityFilter>(capabilityFilter ?? 'ALL');
  const { term, setTerm, filtered } = useSearchFilter(orgs.data, (o) => [
    o.display_name, o.legal_name, o.slug, o.tax_id, o.country_code,
  ]);

  const byCapability = filtered.filter((o) => {
    if (tab === 'ALL') return true;
    const caps = ((o.organization_capabilities ?? []) as Array<{ capability: string }>).map(
      (c) => c.capability,
    );
    if (tab === 'PARTNER') return caps.some((c) => ['PARTNER', 'RESELLER', 'CONSULTING'].includes(c));
    return caps.includes('CUSTOMER');
  });

  return (
    <PageContainer
      title={title ?? 'Organizaciones'}
      description={
        description ??
        'Cuentas de la plataforma. Una organización puede ser partner y cliente a la vez: las capacidades son acumulativas.'
      }
    >
      <Card>
        <SearchBar
          value={term}
          onChange={setTerm}
          placeholder="Buscar por nombre, RUC/NIT o país…"
          right={
            capabilityFilter ? null : (
              <StatusTabs
                value={tab}
                onChange={setTab}
                options={[
                  { id: 'ALL', label: 'Todas' },
                  { id: 'PARTNER', label: 'Partners' },
                  { id: 'CUSTOMER', label: 'Clientes' },
                ]}
              />
            )
          }
        />
        {orgs.isLoading ? (
          <LoadingState />
        ) : orgs.error ? (
          <ErrorState error={orgs.error} onRetry={() => void orgs.refetch()} />
        ) : byCapability.length === 0 ? (
          <EmptyState
            title="Sin organizaciones"
            description="No hay organizaciones visibles para tu rol que coincidan con la búsqueda."
          />
        ) : (
          <DataTable columns={['Organización', 'País', 'Identificación fiscal', 'Capacidades', 'Estado', '']}>
            {byCapability.map((o) => (
              <tr key={o.id}>
                <td className="ebim-td">
                  <div className="flex items-center gap-2.5">
                    <span
                      className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-[11px] font-bold text-white"
                      style={{ background: o.accent_color ?? 'var(--accent2)' }}
                      aria-hidden
                    >
                      {o.display_name.slice(0, 2).toUpperCase()}
                    </span>
                    <div>
                      <div className="font-semibold">{o.display_name}</div>
                      <div className="text-xs text-muted">{o.legal_name}</div>
                    </div>
                  </div>
                </td>
                <td className="ebim-td">{o.country_code}</td>
                <td className="ebim-td font-mono text-xs text-muted">{o.tax_id ?? '—'}</td>
                <td className="ebim-td">
                  <div className="flex flex-wrap gap-1">
                    {o.kind === 'PLATFORM' ? <Badge tone="accent">Plataforma</Badge> : null}
                    {((o.organization_capabilities ?? []) as Array<{ capability: string }>).map((c) => (
                      <Badge key={c.capability} tone={c.capability === 'CUSTOMER' ? 'info' : 'ok'}>
                        {CAPABILITY_LABEL[c.capability] ?? c.capability}
                      </Badge>
                    ))}
                  </div>
                </td>
                <td className="ebim-td text-muted">{o.status}</td>
                <td className="ebim-td text-right">
                  <Link className="ebim-link text-[13px]" to={`/organizations/${o.id}`}>Ver detalle</Link>
                </td>
              </tr>
            ))}
          </DataTable>
        )}
      </Card>
    </PageContainer>
  );
}
