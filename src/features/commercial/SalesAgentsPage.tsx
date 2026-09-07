import { useState } from 'react';
import { useSalesAgents, useAttributions } from '@/services/queries';
import { useSearchFilter } from '@/hooks/useSearchFilter';
import { usePermissions } from '@/hooks/usePermissions';
import {
  PageContainer, Card, DataTable, SearchBar, LoadingState, ErrorState, EmptyState, Badge,
} from '@/components/ui/primitives';
import { formatDate, formatNumber } from '@/lib/format';
import { SalesAgentFormDialog } from './CommercialDialogs';
import type { SalesAgentDraft } from './CommercialDialogs';

const AGENT_TYPE_LABEL: Record<string, string> = {
  EBIM_INTERNAL: 'Interno EBIM',
  INDEPENDENT: 'Independiente',
  PARTNER_AGENT: 'De partner',
};

/**
 * Comerciales.
 *
 * Un comercial puede existir sin `user_id` (no todos tienen login) y sin
 * organización (independiente). Crear uno NUNCA crea un tenant_membership.
 */
export function SalesAgentsPage() {
  const agents = useSalesAgents();
  const attributions = useAttributions();
  const perms = usePermissions();
  const [dialog, setDialog] = useState<{ open: boolean; agent: SalesAgentDraft | null }>({
    open: false,
    agent: null,
  });
  const { term, setTerm, filtered } = useSearchFilter(agents.data, (a) => [
    a.full_name, a.code, a.contact_email, a.agent_type,
    (a.organizations as { display_name: string } | null)?.display_name,
  ]);

  const salesByAgent = new Map<string, number>();
  for (const a of attributions.data ?? []) {
    const key = a.sales_agent_id as string;
    salesByAgent.set(key, (salesByAgent.get(key) ?? 0) + 1);
  }

  return (
    <PageContainer
      title="Comerciales"
      description="Independientes, de partner o internos de EBIM. Un comercial cobra comisión por lo que vendió; eso no le da acceso operativo a ningún tenant."
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
        <SearchBar value={term} onChange={setTerm} placeholder="Buscar comercial por nombre, código u organización…" />
        {agents.isLoading ? (
          <LoadingState />
        ) : agents.error ? (
          <ErrorState error={agents.error} onRetry={() => void agents.refetch()} />
        ) : filtered.length === 0 ? (
          <EmptyState title="Sin comerciales" description="Ningún comercial coincide con la búsqueda." />
        ) : (
          <DataTable columns={['Comercial', 'Tipo', 'Organización', 'Contacto', 'Ventas atribuidas', 'Vigencia', 'Estado', '']}>
            {filtered.map((a) => (
              <tr key={a.id}>
                <td className="ebim-td">
                  <div className="font-semibold">{a.full_name}</div>
                  <div className="font-mono text-xs text-muted">{a.code}</div>
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
                <td className="ebim-td tabular-nums">{formatNumber(salesByAgent.get(a.id) ?? 0)}</td>
                <td className="ebim-td text-xs text-muted">
                  {formatDate(a.valid_from)} → {a.valid_to ? formatDate(a.valid_to) : 'sin fin'}
                </td>
                <td className="ebim-td">
                  <Badge tone={a.status === 'ACTIVE' ? 'ok' : 'neutral'}>{a.status}</Badge>
                </td>
                <td className="ebim-td text-right">
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
                </td>
              </tr>
            ))}
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
