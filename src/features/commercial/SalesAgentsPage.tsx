import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useSalesAgents, useAttributions } from '@/services/queries';
import { useSearchFilter } from '@/hooks/useSearchFilter';
import { usePermissions } from '@/hooks/usePermissions';
import { StatusTabs } from '@/components/ui/SectionTabs';
import {
  PageContainer, Card, DataTable, SearchBar, LoadingState, ErrorState, EmptyState, Badge,
} from '@/components/ui/primitives';
import { formatDate } from '@/lib/format';
import {
  countText, entityStatusLabel, entityStatusTabs, entityStatusTone, matchesEntityStatusTab,
} from '@/features/catalog/catalogLabels';
import type { EntityStatusTab } from '@/features/catalog/catalogLabels';
import { SalesAgentFormDialog } from './CommercialDialogs';
import type { SalesAgentDraft } from './CommercialDialogs';

const AGENT_TYPE_LABEL: Record<string, string> = {
  EBIM_INTERNAL: 'Interno EBIM',
  INDEPENDENT: 'Independiente',
  PARTNER_AGENT: 'De partner',
};

interface Portfolio {
  active: number;
  customers: Set<string>;
  products: Set<string>;
}

/**
 * Equipo comercial (P15).
 *
 * Un comercial puede existir sin `user_id` (no todos tienen login) y sin
 * organización (independiente). Crear uno NUNCA crea un tenant_membership.
 *
 * La cartera sale SÓLO de las atribuciones registradas (vigentes, clientes y
 * productos distintos). No hay embudo, oportunidades ni actividad: no existe
 * una fuente para eso y no se inventa.
 */
export function SalesAgentsPage() {
  const agents = useSalesAgents();
  const attributions = useAttributions();
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
  const hasAny = (agents.data ?? []).length > 0;

  const portfolio = new Map<string, Portfolio>();
  for (const a of attributions.data ?? []) {
    if (a.status !== 'ACTIVE') continue;
    const key = a.sales_agent_id as string;
    const entry = portfolio.get(key) ?? { active: 0, customers: new Set<string>(), products: new Set<string>() };
    entry.active += 1;
    if (a.customer_organization_id) entry.customers.add(a.customer_organization_id);
    const product = (a.saas_products as { short_name: string } | null)?.short_name;
    if (product) entry.products.add(product);
    portfolio.set(key, entry);
  }

  return (
    <PageContainer
      title="Equipo comercial"
      description="Comerciales internos de EBIM, de partner o independientes, con la cartera que tienen atribuida. Cobrar comisión no da acceso operativo a ningún tenant."
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
      <Card>
        <SearchBar
          value={term}
          onChange={setTerm}
          placeholder="Buscar comercial por nombre, código u organización…"
          right={<StatusTabs value={tab} onChange={setTab} options={entityStatusTabs(filtered)} />}
        />
        {agents.isLoading ? (
          <LoadingState label="Cargando equipo comercial…" />
        ) : agents.error ? (
          <ErrorState error={agents.error} onRetry={() => void agents.refetch()} />
        ) : visible.length === 0 ? (
          <EmptyState
            title={hasAny ? 'Ningún comercial coincide' : 'Sin comerciales'}
            description={
              hasAny
                ? 'Prueba con otra búsqueda o cambia de pestaña.'
                : 'Todavía no hay comerciales visibles para tu perfil.'
            }
          />
        ) : (
          <DataTable
            columns={['Comercial', 'Tipo', 'Organización', 'Contacto', 'Atribuciones vigentes', 'Cartera', 'Vigencia', 'Estado', '']}
          >
            {visible.map((a) => {
              const own = portfolio.get(a.id);
              return (
                <tr key={a.id}>
                  <td className="ebim-td">
                    <div className="font-semibold">{a.full_name}</div>
                    <div className="font-mono text-[11px] text-muted">{a.code}</div>
                  </td>
                  <td className="ebim-td">
                    <Badge tone={a.agent_type === 'INDEPENDENT' ? 'accent' : 'info'}>
                      {AGENT_TYPE_LABEL[a.agent_type] ?? a.agent_type}
                    </Badge>
                  </td>
                  <td className="ebim-td text-muted">
                    {(a.organizations as { display_name: string } | null)?.display_name ?? 'Independiente'}
                  </td>
                  <td className="ebim-td text-muted">{a.contact_email ?? '—'}</td>
                  <td className="ebim-td tabular-nums">{countText(attributions, own?.active ?? 0)}</td>
                  <td className="ebim-td text-xs text-muted">
                    {attributions.error || attributions.isLoading ? (
                      countText(attributions, 0)
                    ) : own ? (
                      <>
                        {own.customers.size} {own.customers.size === 1 ? 'cliente' : 'clientes'} ·{' '}
                        {[...own.products].sort().join(', ')}
                      </>
                    ) : (
                      'Sin cartera atribuida'
                    )}
                  </td>
                  <td className="ebim-td whitespace-nowrap text-xs text-muted">
                    {formatDate(a.valid_from)} → {a.valid_to ? formatDate(a.valid_to) : 'sin fin'}
                  </td>
                  <td className="ebim-td">
                    <Badge tone={entityStatusTone(a.status)}>{entityStatusLabel(a.status)}</Badge>
                  </td>
                  <td className="ebim-td text-right">
                    <div className="flex items-center justify-end gap-3 whitespace-nowrap">
                      {own ? (
                        <Link className="ebim-link text-[13px]" to="/attributions">
                          Ver atribuciones
                        </Link>
                      ) : null}
                      {perms.canManageCommercial || perms.isOrgAdmin(a.organization_id) ? (
                        <button
                          type="button"
                          className="ebim-link text-[13px]"
                          onClick={() =>
                            setDialog({
                              open: true,
                              agent: {
                                id: a.id,
                                code: a.code,
                                full_name: a.full_name,
                                agent_type: a.agent_type,
                                organization_id: a.organization_id,
                                contact_email: a.contact_email,
                                status: a.status,
                                valid_from: a.valid_from,
                                valid_to: a.valid_to,
                              },
                            })
                          }
                        >
                          Editar
                        </button>
                      ) : null}
                    </div>
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
