import { useMemo, useState } from 'react';
import { useProductCapabilities, useProducts } from '@/services/queries';
import { useSearchFilter } from '@/hooks/useSearchFilter';
import { usePermissions } from '@/hooks/usePermissions';
import { StatusTabs } from '@/components/ui/SectionTabs';
import {
  PageContainer, Card, DataTable, SearchBar, LoadingState, ErrorState, EmptyState, Badge,
} from '@/components/ui/primitives';
import { ImportManifestDialog } from './ImportManifestDialog';
import type { ManifestImportResult } from './ImportManifestDialog';

/**
 * Registro de capacidades (CCP fase 07).
 *
 * Qué sabe hacer cada producto de la suite, en el vocabulario que usan los
 * planes, los add-ons y los entitlements: FEATURE (se enciende), LIMIT (tope),
 * ALLOWANCE (cupo que se consume) y AI_FEATURE. El registro NO se edita a mano:
 * lo alimenta el manifiesto que publica cada producto. Importarlo es de
 * producto (EBIM_PRODUCT_ADMIN); la RPC lo exige, el botón sólo lo anticipa.
 */

const KIND_LABEL: Record<string, string> = {
  FEATURE: 'Funcionalidad',
  LIMIT: 'Límite',
  ALLOWANCE: 'Cupo',
  AI_FEATURE: 'Funcionalidad IA',
};

const STATUS_LABEL: Record<string, string> = {
  DRAFT: 'Borrador',
  ACTIVE: 'Activa',
  DEPRECATED: 'Obsoleta',
};

const SCOPE_LABEL: Record<string, string> = {
  TENANT: 'Tenant',
  COMPANY: 'Sociedad',
};

/** Sólo LIMIT/ALLOWANCE combinan valores; una FEATURE se habilita si alguna fuente la da. */
const COMBINE_LABEL: Record<string, string> = {
  MAX: 'Se toma el mayor',
  SUM: 'Se suman',
};

const label = (map: Record<string, string>, value: string | null | undefined) =>
  value ? (map[value] ?? value) : '—';

function statusTone(status: string): 'ok' | 'warn' | 'neutral' {
  if (status === 'ACTIVE') return 'ok';
  if (status === 'DEPRECATED') return 'warn';
  return 'neutral';
}

/** `missing` puede venir como códigos o como objetos con `code`. */
function missingCode(entry: unknown): string {
  if (typeof entry === 'string') return entry;
  if (entry && typeof entry === 'object' && 'code' in entry) return String((entry as { code: unknown }).code);
  return JSON.stringify(entry);
}

export function CapabilitiesPage() {
  const capabilities = useProductCapabilities();
  const products = useProducts();
  const perms = usePermissions();
  const [tab, setTab] = useState<string>('ALL');
  const [importOpen, setImportOpen] = useState(false);
  const [lastImport, setLastImport] = useState<ManifestImportResult | null>(null);

  const productName = useMemo(() => {
    const map = new Map<string, string>();
    for (const p of products.data ?? []) map.set(p.id, p.short_name);
    return map;
  }, [products.data]);

  const { term, setTerm, filtered } = useSearchFilter(capabilities.data, (c) => [
    c.code, c.name, c.description, c.kind, c.meter_code, productName.get(c.saas_product_id),
    ...c.aliases.map((a) => a.alias_code),
  ]);

  const productTabs = useMemo(() => {
    const ids = Array.from(new Set((capabilities.data ?? []).map((c) => c.saas_product_id)));
    return ids
      .map((id) => ({
        id,
        label: productName.get(id) ?? 'Producto',
        count: filtered.filter((c) => c.saas_product_id === id).length,
      }))
      .sort((a, b) => a.label.localeCompare(b.label));
  }, [capabilities.data, filtered, productName]);

  const visible = filtered.filter((c) => tab === 'ALL' || c.saas_product_id === tab);
  const groups = productTabs
    .map((p) => ({ ...p, rows: visible.filter((c) => c.saas_product_id === p.id) }))
    .filter((g) => g.rows.length > 0);
  const hasAny = (capabilities.data ?? []).length > 0;

  return (
    <PageContainer
      title="Registro de capacidades"
      description="Qué sabe hacer cada producto, en el vocabulario común de planes, add-ons y entitlements. Lo alimenta el manifiesto que publica cada producto; no se edita a mano."
      actions={
        perms.canManagePlatform ? (
          <button type="button" className="ebim-btn-primary" onClick={() => setImportOpen(true)}>
            Importar manifiesto
          </button>
        ) : null
      }
    >
      {lastImport ? (
        <Card
          className="mb-4"
          title={`Última importación${lastImport.product ? ` · ${lastImport.product}` : ''}`}
          description="Resultado devuelto por la base. Las capacidades ausentes en el manifiesto no se borran: se informan como drift."
        >
          <dl className="grid gap-3 p-4 sm:grid-cols-4">
            {[
              ['Nuevas', lastImport.inserted],
              ['Actualizadas', lastImport.updated],
              ['Sin cambios', lastImport.unchanged],
              ['Alias', lastImport.aliases],
            ].map(([k, v]) => (
              <div key={k as string}>
                <dt className="text-micro text-muted">{k as string}</dt>
                <dd className="mt-1 text-xl font-bold tabular-nums">{v === undefined || v === null ? '—' : String(v)}</dd>
              </div>
            ))}
          </dl>
          <div className="border-t border-border px-4 py-3">
            {(lastImport.missing ?? []).length === 0 ? (
              <p className="text-compact text-ok">Sin drift: el registro y el manifiesto coinciden.</p>
            ) : (
              <div role="status">
                <p className="text-compact font-semibold text-warn">
                  Drift de registro: {(lastImport.missing ?? []).length} capacidad(es) registradas que el manifiesto ya no declara
                </p>
                <ul className="mt-1 flex flex-wrap gap-1.5">
                  {(lastImport.missing ?? []).map((m) => (
                    <li key={missingCode(m)} className="font-mono text-compact">
                      <Badge tone="warn">{missingCode(m)}</Badge>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        </Card>
      ) : null}

      <Card>
        <SearchBar
          value={term}
          onChange={setTerm}
          placeholder="Buscar capacidad por código, nombre, medidor o alias…"
          right={
            <StatusTabs
              value={tab}
              onChange={setTab}
              options={[{ id: 'ALL', label: 'Todos', count: filtered.length }, ...productTabs]}
            />
          }
        />
        {capabilities.isLoading ? (
          <LoadingState label="Cargando el registro de capacidades…" />
        ) : capabilities.error ? (
          <ErrorState error={capabilities.error} onRetry={() => void capabilities.refetch()} />
        ) : groups.length === 0 ? (
          <EmptyState
            title={hasAny ? 'Ninguna capacidad coincide' : 'Sin capacidades registradas'}
            description={
              hasAny
                ? 'Prueba con otra búsqueda o cambia de producto.'
                : 'Ningún producto ha importado todavía su manifiesto de capacidades.'
            }
          />
        ) : (
          groups.map((g) => (
            <section key={g.id} aria-label={g.label}>
              <h2 className="border-b border-border bg-sunken px-5 py-2.5 text-h3 text-fg">
                {g.label} <span className="ml-1 font-normal text-muted tabular-nums">{g.rows.length}</span>
              </h2>
              <DataTable columns={['Capacidad', 'Tipo', 'Estado', 'Alcance', 'Combinación', 'Unidad / medidor', 'Alias']}>
                {g.rows.map((c) => (
                  <tr key={c.id}>
                    <td className="ebim-td">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="font-semibold">{c.name}</span>
                        {c.is_baseline ? <Badge tone="info">Incluida en base</Badge> : null}
                      </div>
                      <div className="whitespace-nowrap font-mono text-caption text-muted">{c.code}</div>
                    </td>
                    <td className="ebim-td">
                      <Badge tone="neutral">{label(KIND_LABEL, c.kind)}</Badge>
                    </td>
                    <td className="ebim-td">
                      <Badge tone={statusTone(c.status)} dot>{label(STATUS_LABEL, c.status)}</Badge>
                    </td>
                    <td className="ebim-td text-compact">{label(SCOPE_LABEL, c.scope_level)}</td>
                    <td className="ebim-td text-compact">{label(COMBINE_LABEL, c.combine_rule)}</td>
                    <td className="ebim-td text-compact">
                      {c.unit ?? '—'}
                      {c.meter_code ? <div className="whitespace-nowrap font-mono text-caption text-muted">{c.meter_code}</div> : null}
                    </td>
                    <td className="ebim-td">
                      {c.aliases.length === 0 ? (
                        <span className="text-compact text-muted">—</span>
                      ) : (
                        <ul className="space-y-0.5">
                          {c.aliases.map((a) => (
                            <li key={a.id} className="text-compact">
                              <span className="font-mono">{a.alias_code}</span>
                              <span className="text-muted"> · {a.alias_source}</span>
                            </li>
                          ))}
                        </ul>
                      )}
                    </td>
                  </tr>
                ))}
              </DataTable>
            </section>
          ))
        )}
      </Card>

      <ImportManifestDialog
        open={importOpen}
        products={(products.data ?? []).map((p) => ({ code: p.code, short_name: p.short_name }))}
        onClose={() => setImportOpen(false)}
        onImported={setLastImport}
      />
    </PageContainer>
  );
}
