import { useState } from 'react';
import { Link } from 'react-router-dom';
import { CheckCircleIcon, MinusCircleIcon } from '@phosphor-icons/react';
import { useAllFeatureFlags } from '@/services/queries';
import { useSearchFilter } from '@/hooks/useSearchFilter';
import { StatusTabs } from '@/components/ui/SectionTabs';
import {
  PageContainer, Card, DataTable, SearchBar, LoadingState, ErrorState, EmptyState, Badge,
} from '@/components/ui/primitives';
import { formatDateTime } from '@/lib/format';
import type { BadgeTone } from './catalogLabels';

/**
 * Capacidades por tenant (P08, antes «Feature flags»).
 *
 * `source` distingue de dónde sale la capacidad: PLAN (predeterminada por el
 * plan contratado), ADDON (se contrató aparte) o MANUAL (la ajustó el
 * operador). ADDON y MANUAL son AJUSTES sobre lo predeterminado: mezclarlos
 * impide responder «¿por qué este cliente tiene esto?».
 *
 * Pantalla de sólo lectura: no añade asignaciones nuevas.
 */
const SOURCE: Record<string, { label: string; kind: 'default' | 'override'; tone: BadgeTone }> = {
  PLAN: { label: 'Predeterminada por plan', kind: 'default', tone: 'info' },
  ADDON: { label: 'Ajuste · addon contratado', kind: 'override', tone: 'accent' },
  MANUAL: { label: 'Ajuste · manual del operador', kind: 'override', tone: 'warn' },
};

type OriginTab = 'ALL' | 'default' | 'override';

function sourceOf(source: string | null | undefined) {
  return (
    SOURCE[source ?? ''] ?? { label: source ? `Origen ${source}` : 'Origen no registrado', kind: 'override' as const, tone: 'neutral' as BadgeTone }
  );
}

/** `advanced_reports` → «Advanced reports». El código queda visible como dato secundario. */
function humanize(key: string): string {
  const text = key.replace(/[._-]+/g, ' ').trim();
  return text.charAt(0).toUpperCase() + text.slice(1);
}

export function FeatureFlagsPage() {
  const flags = useAllFeatureFlags();
  const [tab, setTab] = useState<OriginTab>('ALL');
  const { term, setTerm, filtered } = useSearchFilter(flags.data, (f) => [
    f.feature_key,
    humanize(f.feature_key),
    f.source,
    sourceOf(f.source).label,
    (f.tenants as { name: string } | null)?.name,
    (f.tenants as { slug: string } | null)?.slug,
  ]);
  const visible = filtered.filter((f) => tab === 'ALL' || sourceOf(f.source).kind === tab);
  const defaults = filtered.filter((f) => sourceOf(f.source).kind === 'default').length;
  const hasAny = (flags.data ?? []).length > 0;

  return (
    <PageContainer
      title="Capacidades"
      description="Qué funcionalidades tiene encendidas cada tenant y por qué: predeterminadas por su plan o ajustadas (addon contratado o decisión del operador)."
    >
      <Card>
        <SearchBar
          value={term}
          onChange={setTerm}
          placeholder="Buscar por capacidad o tenant…"
          right={
            <StatusTabs
              value={tab}
              onChange={setTab}
              options={[
                { id: 'ALL', label: 'Todas', count: filtered.length },
                { id: 'default', label: 'Predeterminadas', count: defaults },
                { id: 'override', label: 'Ajustes', count: filtered.length - defaults },
              ]}
            />
          }
        />
        {flags.isLoading ? (
          <LoadingState label="Cargando capacidades…" />
        ) : flags.error ? (
          <ErrorState error={flags.error} onRetry={() => void flags.refetch()} />
        ) : visible.length === 0 ? (
          <EmptyState
            title={hasAny ? 'Ninguna capacidad coincide' : 'Sin capacidades configuradas'}
            description={
              hasAny
                ? 'Prueba con otra búsqueda o cambia de pestaña.'
                : 'Ningún tenant visible para tu perfil tiene capacidades registradas.'
            }
          />
        ) : (
          <DataTable columns={['Capacidad', 'Tenant', 'Origen', 'Estado', 'Actualizado']}>
            {visible.map((f) => {
              const tenant = f.tenants as { name: string; slug: string; saas_products: { short_name: string } | null } | null;
              const src = sourceOf(f.source);
              return (
                <tr key={`${f.tenant_id}-${f.feature_key}`}>
                  <td className="ebim-td">
                    <div className="font-semibold">{humanize(f.feature_key)}</div>
                    <div className="whitespace-nowrap font-mono text-caption text-muted">{f.feature_key}</div>
                  </td>
                  <td className="ebim-td">
                    {f.tenant_id ? (
                      <Link className="hover:underline" to={`/tenants/${f.tenant_id}#features`}>
                        {tenant?.name ?? '—'}
                      </Link>
                    ) : (
                      tenant?.name ?? '—'
                    )}
                    <div className="text-compact text-fg-2">{tenant?.saas_products?.short_name ?? '—'}</div>
                  </td>
                  <td className="ebim-td">
                    <Badge tone={src.tone}>{src.label}</Badge>
                  </td>
                  <td className="ebim-td">
                    {f.enabled ? (
                      <span className="inline-flex items-center gap-1.5 text-compact font-semibold text-fg">
                        <CheckCircleIcon size={16} weight="fill" className="text-ok" aria-hidden /> Encendida
                      </span>
                    ) : (
                      <span className="inline-flex items-center gap-1.5 text-compact text-muted">
                        <MinusCircleIcon size={16} aria-hidden /> Apagada
                      </span>
                    )}
                  </td>
                  <td className="ebim-td whitespace-nowrap text-compact text-fg-2">{formatDateTime(f.updated_at)}</td>
                </tr>
              );
            })}
          </DataTable>
        )}
      </Card>
    </PageContainer>
  );
}
