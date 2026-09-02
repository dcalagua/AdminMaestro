import { useAllFeatureFlags } from '@/services/queries';
import { useSearchFilter } from '@/hooks/useSearchFilter';
import {
  PageContainer, Card, DataTable, SearchBar, LoadingState, ErrorState, EmptyState, Badge,
} from '@/components/ui/primitives';
import { formatDateTime } from '@/lib/format';

/**
 * Feature flags por tenant.
 *
 * `source` distingue de dónde sale el flag: PLAN (viene del plan contratado),
 * ADDON (se contrató aparte) o MANUAL (lo encendió el operador). Sin esa
 * distinción, nadie puede responder "¿por qué este cliente tiene esto?".
 */
export function FeatureFlagsPage() {
  const flags = useAllFeatureFlags();
  const { term, setTerm, filtered } = useSearchFilter(flags.data, (f) => [
    f.feature_key,
    f.source,
    (f.tenants as { name: string } | null)?.name,
    (f.tenants as { slug: string } | null)?.slug,
  ]);

  return (
    <PageContainer
      title="Feature flags"
      description="Qué está encendido en cada tenant y por qué: por plan, por addon contratado o por decisión manual del operador."
    >
      <Card>
        <SearchBar value={term} onChange={setTerm} placeholder="Buscar por flag o tenant…" />
        {flags.isLoading ? (
          <LoadingState />
        ) : flags.error ? (
          <ErrorState error={flags.error} onRetry={() => void flags.refetch()} />
        ) : filtered.length === 0 ? (
          <EmptyState title="Sin feature flags" description="Ningún tenant tiene flags configurados." />
        ) : (
          <DataTable columns={['Flag', 'Tenant', 'Producto', 'Origen', 'Estado', 'Actualizado']}>
            {filtered.map((f) => {
              const tenant = f.tenants as { name: string; slug: string; saas_products: { short_name: string } | null } | null;
              return (
                <tr key={`${f.tenant_id}-${f.feature_key}`}>
                  <td className="ebim-td font-mono text-[13px] font-semibold">{f.feature_key}</td>
                  <td className="ebim-td">{tenant?.name ?? '—'}</td>
                  <td className="ebim-td text-muted">{tenant?.saas_products?.short_name ?? '—'}</td>
                  <td className="ebim-td">
                    <Badge tone={f.source === 'ADDON' ? 'accent' : f.source === 'PLAN' ? 'info' : 'warn'}>
                      {f.source}
                    </Badge>
                  </td>
                  <td className="ebim-td">
                    <Badge tone={f.enabled ? 'ok' : 'neutral'}>{f.enabled ? 'Activo' : 'Inactivo'}</Badge>
                  </td>
                  <td className="ebim-td text-xs text-muted">{formatDateTime(f.updated_at)}</td>
                </tr>
              );
            })}
          </DataTable>
        )}
      </Card>
    </PageContainer>
  );
}
