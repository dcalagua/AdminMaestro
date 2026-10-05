import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useAttributions } from '@/services/queries';
import { useEndAttribution } from '@/services/mutations';
import { useSearchFilter } from '@/hooks/useSearchFilter';
import { usePermissions } from '@/hooks/usePermissions';
import { StatusTabs } from '@/components/ui/SectionTabs';
import {
  PageContainer, Card, DataTable, SearchBar, LoadingState, ErrorState, EmptyState, Badge,
} from '@/components/ui/primitives';
import { ConfirmDialog } from '@/components/ui/ConfirmDialog';
import { useToast } from '@/components/ui/toast-context';
import { businessErrorMessage } from '@/lib/pgError';
import { formatDate } from '@/lib/format';
import {
  entityStatusTabs, matchesEntityStatusTab,
} from '@/features/catalog/catalogLabels';
import type { EntityStatusTab } from '@/features/catalog/catalogLabels';
import { AttributionFormDialog } from './CommercialDialogs';
import { SOURCE_LABEL } from './commercialLabels';
import { ActionMenu } from '@/components/ui/ActionMenu';
import { Avatar } from '@/components/ui/Avatar';

function pct(value: unknown): string {
  return `${(Number(value) * 100).toFixed(0)}%`;
}

/**
 * Atribuciones comerciales (P12).
 *
 * La suma de participaciones vigentes sobre un mismo objeto no puede pasar del
 * 100% — lo valida un trigger en la base, no esta pantalla. Ahí es donde nace
 * la comisión duplicada. La lectura no cambia titularidad ni porcentaje.
 */
export function AttributionsPage() {
  const attributions = useAttributions();
  const perms = usePermissions();
  const toast = useToast();
  const endAttribution = useEndAttribution();
  const [tab, setTab] = useState<EntityStatusTab>('ALL');
  const [creating, setCreating] = useState(false);
  const [ending, setEnding] = useState<{ id: string; label: string } | null>(null);

  async function confirmEnd() {
    if (!ending) return;
    try {
      await endAttribution.mutateAsync({
        p_attribution_id: ending.id,
        p_reason: 'Cerrada desde la consola',
      });
      // Cerrar NO borra: las comisiones ya devengadas apuntan a esta atribución.
      toast.success('Atribución cerrada', ending.label);
    } catch (error) {
      toast.error('No se pudo cerrar', businessErrorMessage(error));
    } finally {
      setEnding(null);
    }
  }

  const { term, setTerm, filtered } = useSearchFilter(attributions.data, (a) => [
    (a.sales_agents as { full_name: string } | null)?.full_name,
    (a.saas_products as { short_name: string } | null)?.short_name,
    (a.tenants as { name: string } | null)?.name,
    (a.organizations as { display_name: string } | null)?.display_name,
    SOURCE_LABEL[a.source] ?? a.source,
  ]);
  const visible = filtered.filter((a) => matchesEntityStatusTab(a.status, tab));
  const hasAny = (attributions.data ?? []).length > 0;

  return (
    <PageContainer
      title="Atribuciones comerciales"
      description="Quién se lleva el crédito de cada venta, en qué porcentaje, con qué plan de comisión y desde cuándo. Una venta puede repartirse entre varios comerciales sin duplicar la comisión."
      actions={
        perms.canManageCommercial ? (
          <button type="button" className="ebim-btn-primary" onClick={() => setCreating(true)}>
            Nueva atribución
          </button>
        ) : null
      }
    >
      <Card>
        <SearchBar
          value={term}
          onChange={setTerm}
          placeholder="Buscar por comercial, producto, cliente o tenant…"
          right={
            <StatusTabs
              value={tab}
              onChange={setTab}
              options={entityStatusTabs(filtered, { all: 'Todas', active: 'Vigentes', inactive: 'Cerradas' })}
            />
          }
        />
        {attributions.isLoading ? (
          <LoadingState label="Cargando atribuciones…" />
        ) : attributions.error ? (
          <ErrorState error={attributions.error} onRetry={() => void attributions.refetch()} />
        ) : visible.length === 0 ? (
          <EmptyState
            title={hasAny ? 'Ninguna atribución en esta vista' : 'Sin atribuciones'}
            description={
              hasAny
                ? 'Prueba con otra búsqueda o cambia de pestaña.'
                : 'No hay atribuciones visibles para tu perfil.'
            }
          />
        ) : (
          <DataTable
            columns={[
              'Comercial',
              'Cliente',
              { label: 'Participación', align: 'right' },
              'Canal',
              'Plan de comisión',
              'Vigencia',
              { label: 'Acciones', srOnly: true },
            ]}
          >
            {visible.map((a) => {
              const agent = (a.sales_agents as { full_name: string } | null)?.full_name ?? 'Comercial sin nombre';
              const product = (a.saas_products as { short_name: string } | null)?.short_name ?? 'producto';
              const customer = (a.organizations as { display_name: string } | null)?.display_name;
              const plan = (a.commission_plans as { name: string } | null)?.name;
              return (
                <tr key={a.id}>
                  <td className="ebim-td">
                    <div className="flex items-center gap-3">
                      <Avatar name={agent} mode="person" />
                      <div className="min-w-0">
                        <div className="font-semibold">{agent}</div>
                        <div className="text-compact text-fg-2">crédito de {product}</div>
                      </div>
                    </div>
                  </td>
                  <td className="ebim-td">
                    {customer ? (
                      <Link className="ebim-link" to={`/organizations/${a.customer_organization_id}`}>
                        {customer}
                      </Link>
                    ) : (
                      <span className="text-muted">—</span>
                    )}
                    <div className="text-compact text-fg-2">
                      {a.tenant_id ? (
                        <Link className="hover:underline" to={`/tenants/${a.tenant_id}`}>
                          {(a.tenants as { name: string } | null)?.name ?? 'Ver tenant'}
                        </Link>
                      ) : (
                        'Todo el cliente'
                      )}
                    </div>
                  </td>
                  <td className="ebim-td ebim-num font-semibold">{pct(a.attribution_pct)}</td>
                  <td className="ebim-td">
                    <Badge tone="neutral">{SOURCE_LABEL[a.source] ?? a.source}</Badge>
                  </td>
                  <td className="ebim-td text-fg-2">{plan ?? 'Sin plan de comisión'}</td>
                  <td className="ebim-td whitespace-nowrap">
                    <Badge tone={a.status === 'ACTIVE' ? 'ok' : 'neutral'} dot>
                      {a.status === 'ACTIVE' ? 'Vigente' : 'Cerrada'}
                    </Badge>
                    <div className="mt-1 text-compact text-fg-2">
                      {formatDate(a.valid_from)} → {a.valid_to ? formatDate(a.valid_to) : 'sin fin'}
                    </div>
                  </td>
                  <td className="ebim-td w-12 text-right">
                    <ActionMenu
                      label={`Acciones de la atribución de ${agent} · ${product}`}
                      items={[
                        customer ? { label: 'Ficha del cliente', to: `/organizations/${a.customer_organization_id}` } : null,
                        a.tenant_id ? { label: 'Tenant 360', to: `/tenants/${a.tenant_id}` } : null,
                        perms.canManageCommercial && a.status === 'ACTIVE'
                          ? {
                              label: 'Cerrar atribución…',
                              tone: 'danger' as const,
                              onSelect: () => setEnding({ id: a.id, label: `${agent} · ${product}` }),
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

      <AttributionFormDialog open={creating} onClose={() => setCreating(false)} />

      <ConfirmDialog
        open={Boolean(ending)}
        title="¿Cerrar la vigencia de esta atribución?"
        message="La atribución dejará de generar comisión nueva. No se borra: las comisiones ya devengadas siguen apuntando a ella."
        confirmLabel="Cerrar atribución"
        busy={endAttribution.isPending}
        onConfirm={confirmEnd}
        onCancel={() => setEnding(null)}
      />
    </PageContainer>
  );
}
