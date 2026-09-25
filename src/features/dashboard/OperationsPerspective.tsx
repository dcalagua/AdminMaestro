import { Link } from 'react-router-dom';
import { CheckCircleIcon, MinusCircleIcon, QuestionIcon, WarningCircleIcon } from '@phosphor-icons/react';
import {
  useDashboardSummary,
  useProducts,
  useProvisioningTargets,
  useSaasProvisioningRequests,
} from '@/services/queries';
import { fromQuery } from '@/features/executive/dataState';
import { StateMessage } from '@/features/executive/components/StateView';
import { Badge } from '@/components/ui/primitives';
import { formatDateTime, formatNumber } from '@/lib/format';

/**
 * Perspectiva OPERACIÓN SaaS (spec §7.3).
 *
 * Todo sale de datos persistidos del control plane: catálogo, integración,
 * destinos y solicitudes. NO se llama a ningún proveedor ni a CHECK_HEALTH al
 * renderizar; la salud es la ÚLTIMA OBSERVACIÓN registrada, con su fecha, y no
 * es uptime. Un destino deshabilitado o DRAFT aparece como «No evaluado» y no
 * contamina el resumen de los destinos habilitados. La certificación no se
 * infiere de ACTIVE: el control plane no guarda evidencia de certificación, así
 * que no se afirma.
 */
type Target = NonNullable<ReturnType<typeof useProvisioningTargets>['data']>[number];

function healthCell(t: Target) {
  if (!t.provisioning_enabled || t.provisioning_status !== 'READY') {
    return (
      <span className="inline-flex items-center gap-1 text-muted">
        <MinusCircleIcon size={14} aria-hidden /> No evaluado
      </span>
    );
  }
  const observed = t.health_checked_at ? `observado ${formatDateTime(t.health_checked_at)}` : 'sin observación registrada';
  if (t.health_status === 'HEALTHY') {
    return (
      <span className="inline-flex flex-col">
        <span className="inline-flex items-center gap-1 font-semibold text-ok"><CheckCircleIcon size={14} aria-hidden /> Respondió sano</span>
        <span className="text-[11px] text-muted">{observed}</span>
      </span>
    );
  }
  if (t.health_status === 'UNHEALTHY' || t.health_status === 'DEGRADED') {
    return (
      <span className="inline-flex flex-col">
        <span className="inline-flex items-center gap-1 font-semibold text-danger"><WarningCircleIcon size={14} aria-hidden /> {t.health_status === 'DEGRADED' ? 'Degradado' : 'No respondió'}</span>
        <span className="text-[11px] text-muted">{observed}</span>
      </span>
    );
  }
  return (
    <span className="inline-flex flex-col">
      <span className="inline-flex items-center gap-1 text-muted"><QuestionIcon size={14} aria-hidden /> Sin dato de salud</span>
      <span className="text-[11px] text-muted">{observed}</span>
    </span>
  );
}

export function OperationsPerspective() {
  const products = useProducts();
  const targets = useProvisioningTargets();
  const saas = useSaasProvisioningRequests();
  const summary = useDashboardSummary();

  const productState = fromQuery(products);
  const targetState = fromQuery(targets, { isEmpty: () => false });
  const saasState = fromQuery(saas, { isEmpty: () => false });

  const enabled = (targets.data ?? []).filter((t) => t.provisioning_enabled && t.provisioning_status === 'READY');
  const enabledHealthy = enabled.filter((t) => t.health_status === 'HEALTHY').length;

  return (
    <div className="space-y-5">
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <Stat label="Productos en catálogo" value={products.data ? formatNumber(products.data.length) : null} state={productState} note="Según el catálogo, no un total fijo" />
        <Stat label="Destinos habilitados" value={targets.data ? `${formatNumber(enabled.length)} de ${formatNumber(targets.data.length)}` : null} state={targetState} note="El resto: borrador o deshabilitado (no evaluado)" />
        <Stat label="Habilitados con última observación sana" value={targets.data ? `${formatNumber(enabledHealthy)} de ${formatNumber(enabled.length)}` : null} state={targetState} note="Observación persistida, no uptime" />
        <Stat
          label="Solicitudes de infraestructura fallidas"
          value={summary.data ? formatNumber(summary.data.provisioning_failures) : null}
          state={fromQuery(summary, { isEmpty: () => false })}
          note="Cola de infraestructura; distinta de las altas SaaS"
        />
      </div>

      <section className="ebim-card" aria-labelledby="ops-matrix-title">
        <header className="border-b border-border px-4 py-3">
          <h3 id="ops-matrix-title" className="text-sm font-bold text-fg">Matriz por producto y entorno</h3>
          <p className="text-xs text-muted">
            Catálogo, integración, destino, última observación de salud y altas SaaS. Sin llamadas a proveedores al abrir esta vista.
          </p>
        </header>
        {productState.status !== 'ready' ? (
          <div className="px-4"><StateMessage state={productState} onRetry={() => void products.refetch()} /></div>
        ) : (
          <div className="relative overflow-x-auto" role="region" aria-label="Matriz por producto y entorno" tabIndex={0}>
            <table className="w-full min-w-[860px] border-collapse text-sm">
              <thead className="border-b border-border bg-[color:var(--bg)]">
                <tr>
                  <th scope="col" className="ebim-th">Producto</th>
                  <th scope="col" className="ebim-th">Catálogo</th>
                  <th scope="col" className="ebim-th">Destino · entorno</th>
                  <th scope="col" className="ebim-th">Integración</th>
                  <th scope="col" className="ebim-th">Salud (última observación)</th>
                  <th scope="col" className="ebim-th">Altas SaaS</th>
                  <th scope="col" className="ebim-th">Certificación</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {products.data!.map((p) => {
                  const pts = (targets.data ?? []).filter((t) => t.saas_product_id === p.id);
                  const reqs = (saas.data ?? []).filter((r) => r.saas_product_id === p.id);
                  const byStatus: Record<string, number> = {};
                  for (const r of reqs) byStatus[r.status ?? '—'] = (byStatus[r.status ?? '—'] ?? 0) + 1;
                  const mappings = reqs.filter((r) => r.mapping_status === 'ACTIVE').length;
                  const rows = pts.length ? pts : [null];
                  return rows.map((t, i) => (
                    <tr key={`${p.id}-${t?.deployment_target_id ?? 'none'}`}>
                      {i === 0 ? (
                        <>
                          <th scope="row" rowSpan={rows.length} className="ebim-td text-left align-top">
                            <Link className="ebim-link" to={`/products/${p.id}`}>{p.short_name}</Link>
                          </th>
                          <td rowSpan={rows.length} className="ebim-td align-top">
                            <Badge tone={p.status === 'ACTIVE' ? 'accent' : 'neutral'}>{p.status === 'ACTIVE' ? 'Activo en catálogo' : p.status}</Badge>
                          </td>
                        </>
                      ) : null}
                      <td className="ebim-td">
                        {t ? (
                          <span className="flex flex-col">
                            <span className="font-mono text-xs">{t.code}</span>
                            <span className="text-[11px] text-muted">
                              {t.provisioning_environment ?? 'Sin entorno'} · {t.provisioning_enabled ? 'habilitado' : 'deshabilitado'} · {t.provisioning_status}
                            </span>
                          </span>
                        ) : targetState.status === 'ready' ? (
                          <span className="text-muted">Sin destinos registrados</span>
                        ) : (
                          <StateMessage state={targetState} compact />
                        )}
                      </td>
                      <td className="ebim-td">
                        {t?.integration_code ? (
                          <span className="flex flex-col">
                            <span className="text-xs font-semibold">{t.integration_code}</span>
                            <span className="text-[11px] text-muted">{t.integration_status ?? '—'} · {t.integration_enabled ? 'activa' : 'inactiva'}</span>
                          </span>
                        ) : (
                          <span className="text-muted">Sin integración</span>
                        )}
                      </td>
                      <td className="ebim-td">{t ? healthCell(t) : '—'}</td>
                      {i === 0 ? (
                        <>
                          <td rowSpan={rows.length} className="ebim-td align-top text-xs">
                            {saasState.status !== 'ready' ? (
                              <StateMessage state={saasState} compact />
                            ) : reqs.length === 0 ? (
                              <span className="text-muted">Sin solicitudes</span>
                            ) : (
                              <span className="flex flex-col gap-0.5">
                                {Object.entries(byStatus).map(([s, n]) => (
                                  <span key={s}>{s}: <strong className="tabular-nums">{n}</strong></span>
                                ))}
                                <span className="text-muted">Mappings activos: {mappings}</span>
                                <Link className="ebim-link" to="/saas-provisioning">Ver altas</Link>
                              </span>
                            )}
                          </td>
                          <td rowSpan={rows.length} className="ebim-td align-top text-xs text-muted">
                            Sin fuente verificable en el control plane
                          </td>
                        </>
                      ) : null}
                    </tr>
                  ));
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}

function Stat({
  label,
  value,
  state,
  note,
}: {
  label: string;
  value: string | null;
  state: ReturnType<typeof fromQuery>;
  note: string;
}) {
  return (
    <div className="ebim-card p-4">
      <div className="text-[11px] font-bold uppercase tracking-wider text-muted">{label}</div>
      {value !== null && (state.status === 'ready' || state.status === 'empty') ? (
        <div className="mt-1.5 text-2xl font-bold tabular-nums text-fg">{value}</div>
      ) : (
        <StateMessage state={state} compact />
      )}
      <div className="mt-1 text-xs text-muted">{note}</div>
    </div>
  );
}
