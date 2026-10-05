import { useState } from 'react';
import { useEntitlementSyncStatus } from '@/services/queries';
import { useSyncEntitlements, useVerifyEntitlements, type EntitlementSyncSummary } from '@/services/mutations';
import { useSearchFilter } from '@/hooks/useSearchFilter';
import { StatusTabs } from '@/components/ui/SectionTabs';
import {
  PageContainer, Card, DataTable, SearchBar, LoadingState, ErrorState, EmptyState, Badge, KpiTile,
} from '@/components/ui/primitives';
import { Avatar } from '@/components/ui/Avatar';
import { KpiStrip } from '@/features/billing/financeUi';
import { cutoverStepLabel } from '@/features/platform/cutover';
import { formatNumber } from '@/lib/format';

/**
 * Sincronización de entitlements (CCP fase 08).
 *
 * Deseado (lo que MasterAdmin emitió) frente a aplicado (lo que el SaaS dice,
 * por GET, que tiene). «Sincronizar ahora» y «Verificar» invocan el
 * orquestador con el tenant y nada más: la autorización es un booleano de la
 * base (platform.provisioning.execute / .read del producto) y el estado lo
 * decide la base. Esta pantalla solo lo muestra.
 */

type Tone = 'ok' | 'warn' | 'danger' | 'info' | 'neutral';

const STATE: Record<string, { label: string; tone: Tone }> = {
  NOT_PROVISIONED: { label: 'Sin aprovisionar', tone: 'neutral' },
  NOT_ENROLLED: { label: 'No enrolado', tone: 'neutral' },
  PENDING_PUSH: { label: 'Pendiente de envío', tone: 'info' },
  PUSHING: { label: 'Enviando', tone: 'info' },
  AWAITING_VERIFY: { label: 'Esperando verificación', tone: 'info' },
  IN_SYNC: { label: 'En sincronía', tone: 'ok' },
  IN_SYNC_WITH_WARNINGS: { label: 'En sincronía con avisos', tone: 'warn' },
  DRIFT_BEHIND: { label: 'Atrasado', tone: 'warn' },
  DRIFT_CHECKSUM: { label: 'Checksum distinto', tone: 'danger' },
  DRIFT_AHEAD: { label: 'SaaS por delante', tone: 'danger' },
  REJECTED: { label: 'Rechazado', tone: 'danger' },
  UNREACHABLE: { label: 'Inalcanzable', tone: 'warn' },
  REGISTRY_DRIFT: { label: 'Registro desalineado', tone: 'warn' },
};

const GROUPS: Record<string, string[]> = {
  IN_SYNC: ['IN_SYNC', 'IN_SYNC_WITH_WARNINGS'],
  PENDING: ['PENDING_PUSH', 'PUSHING', 'AWAITING_VERIFY', 'DRIFT_BEHIND', 'UNREACHABLE'],
  INCIDENTS: ['DRIFT_CHECKSUM', 'DRIFT_AHEAD', 'REJECTED', 'REGISTRY_DRIFT'],
  OUT: ['NOT_PROVISIONED', 'NOT_ENROLLED'],
};

const version = (v: number | null | undefined) => (v === null || v === undefined ? '—' : `v${v}`);
const when = (iso: string | null | undefined) =>
  iso ? new Date(iso).toLocaleString('es-PE', { dateStyle: 'short', timeStyle: 'short' }) : '—';

function summaryText(s: EntitlementSyncSummary): string {
  const parts = [`${s.tenant_id}: ${s.state}`];
  if (s.skipped) parts.push(`sin acción (${s.skipped})`);
  if (s.push) parts.push(`envío ${s.push.result}${s.push.errorCode ? ` · ${s.push.errorCode}` : ''}`);
  if (s.verify) parts.push(`verificación ${s.verify.result}${s.verify.errorCode ? ` · ${s.verify.errorCode}` : ''}`);
  return parts.join(' · ');
}

export function EntitlementSyncPage() {
  const status = useEntitlementSyncStatus();
  const sync = useSyncEntitlements();
  const verify = useVerifyEntitlements();
  const [tab, setTab] = useState<string>('ALL');

  const { term, setTerm, filtered } = useSearchFilter(status.data, (r) => [
    r.tenant_name, r.tenant_slug, r.product_code, r.product_name, r.state, r.state_reason, r.integration_code,
  ]);

  const count = (group: string) => filtered.filter((r) => GROUPS[group].includes(r.state ?? '')).length;
  const all = status.data ?? [];
  const totalOf = (group: string) => all.filter((r) => GROUPS[group].includes(r.state ?? '')).length;
  const tabs = [
    { id: 'ALL', label: 'Todos', count: filtered.length },
    { id: 'IN_SYNC', label: 'En sincronía', count: count('IN_SYNC') },
    { id: 'PENDING', label: 'En curso', count: count('PENDING') },
    { id: 'INCIDENTS', label: 'Incidentes', count: count('INCIDENTS') },
    { id: 'OUT', label: 'Fuera del programa', count: count('OUT') },
  ];
  const visible = filtered.filter((r) => tab === 'ALL' || GROUPS[tab].includes(r.state ?? ''));
  const lastResult = (sync.data ?? verify.data) as EntitlementSyncSummary | undefined;
  const lastError = sync.error ?? verify.error;

  return (
    <PageContainer
      title="Sincronización de entitlements"
      description="Lo que MasterAdmin emitió frente a lo que cada SaaS confirma por GET. Solo el GET cuenta como sincronizado; los incidentes (checksum distinto, SaaS por delante) no se corrigen solos."
    >
      {all.length > 0 ? (
        <KpiStrip label="Estado de la sincronización">
          <KpiTile label="En sincronía" value={formatNumber(totalOf('IN_SYNC'))} footer="Confirmado por GET del SaaS." tone="ok" />
          <KpiTile label="En curso" value={formatNumber(totalOf('PENDING'))} footer="Envío o verificación pendiente." />
          <KpiTile
            label="Incidentes"
            value={formatNumber(totalOf('INCIDENTS'))}
            footer="Requieren a una persona: no se corrigen solos."
            tone={totalOf('INCIDENTS') > 0 ? 'danger' : 'neutral'}
          />
          <KpiTile label="Fuera del programa" value={formatNumber(totalOf('OUT'))} footer="Sin aprovisionar o sin enrolar." />
        </KpiStrip>
      ) : null}
      {lastResult ? (
        <div role="status" className="mb-4 rounded-card border border-border bg-card px-4 py-3 text-compact text-fg">
          <span className="font-semibold">Última acción:</span> {summaryText(lastResult)}
        </div>
      ) : null}
      {lastError ? (
        <div role="alert" className="mb-4 rounded-card border border-danger bg-danger-soft px-4 py-3 text-compact text-danger">
          {lastError instanceof Error ? lastError.message : String(lastError)}
        </div>
      ) : null}

      <Card>
        <SearchBar
          value={term}
          onChange={setTerm}
          placeholder="Buscar por tenant, producto, estado o integración…"
          right={<StatusTabs value={tab} onChange={setTab} options={tabs} />}
        />
        {status.isLoading ? (
          <LoadingState label="Cargando el estado de sincronización…" />
        ) : status.error ? (
          <ErrorState error={status.error} onRetry={() => void status.refetch?.()} />
        ) : visible.length === 0 ? (
          <EmptyState
            title={(status.data ?? []).length > 0 ? 'Ningún tenant coincide' : 'Ningún tenant en sincronización'}
            description={
              (status.data ?? []).length > 0
                ? 'Prueba con otra búsqueda o cambia de filtro.'
                : 'Un tenant aparece aquí cuando su integración se configura para entitlements y se enrola (eje SHADOW o superior).'
            }
          />
        ) : (
          <DataTable
            label="Sincronización por tenant y producto"
            columns={['Tenant', 'Estado', 'Deseado', 'Aplicado', 'Último envío / verificación', 'Integración', { label: 'Acciones', srOnly: true }]}
          >
            {visible.map((r) => {
              const st = STATE[r.state ?? ''] ?? { label: r.state ?? '—', tone: 'neutral' as Tone };
              const busy =
                (sync.isPending && sync.variables === r.tenant_id) || (verify.isPending && verify.variables === r.tenant_id);
              return (
                <tr key={`${r.tenant_id}:${r.saas_product_id}`}>
                  <td className="ebim-td">
                    <div className="flex min-w-0 items-center gap-3">
                      <Avatar name={r.tenant_name ?? '—'} />
                      <div className="min-w-0">
                        <div className="truncate font-semibold text-fg">{r.tenant_name}</div>
                        <div className="truncate text-caption text-muted">{r.product_name}</div>
                      </div>
                    </div>
                  </td>
                  <td className="ebim-td">
                    <Badge tone={st.tone} dot>{st.label}</Badge>
                    {r.state_reason && r.state_reason !== r.state ? (
                      <div className="mt-1 font-mono text-caption text-muted">{r.state_reason}</div>
                    ) : null}
                    {(r.consecutive_failures ?? 0) > 0 ? (
                      <div className="mt-1 text-caption font-semibold text-warn">{r.consecutive_failures} fallo(s) seguidos</div>
                    ) : null}
                  </td>
                  <td className="ebim-td text-compact">
                    <span className="font-mono">{version(r.desired_version)}</span>
                    {r.desired_dirty ? (
                      <div className="mt-1">
                        <Badge tone="info">Cambios sin emitir</Badge>
                      </div>
                    ) : null}
                  </td>
                  <td className="ebim-td text-compact">
                    <span className="font-mono">{version(r.applied_version)}</span>
                    {(r.unknown_capabilities ?? []).length > 0 ? (
                      <ul className="mt-1 flex flex-wrap gap-1" aria-label="Capacidades desconocidas para el SaaS">
                        {(r.unknown_capabilities ?? []).map((c) => (
                          <li key={c} className="font-mono">
                            <Badge tone="warn">{c}</Badge>
                          </li>
                        ))}
                      </ul>
                    ) : null}
                  </td>
                  <td className="ebim-td text-compact">
                    <div className="whitespace-nowrap">Envío: {when(r.last_push_at)}{r.last_push_result ? ` · ${r.last_push_result}` : ''}</div>
                    <div className="whitespace-nowrap text-caption text-muted">GET: {when(r.last_verified_at)}</div>
                  </td>
                  <td className="ebim-td text-compact">
                    <div className="font-mono text-caption">{r.integration_code ?? '—'}</div>
                    <div className="mt-1 flex flex-wrap gap-1">
                      {r.cutover_state_entitlements ? (
                        <Badge tone="accent" title={r.cohort_state ?? r.cutover_state_entitlements}>
                          Cutover: {cutoverStepLabel(r.cohort_state ?? r.cutover_state_entitlements)}
                        </Badge>
                      ) : null}
                      {r.push_enabled === false ? <Badge tone="danger">Envío apagado</Badge> : null}
                    </div>
                  </td>
                  <td className="ebim-td whitespace-nowrap text-right">
                    <button
                      type="button"
                      className="ebim-btn-secondary ebim-btn-sm"
                      disabled={busy}
                      onClick={() => sync.mutate(r.tenant_id!)}
                    >
                      Sincronizar ahora
                    </button>
                    <button
                      type="button"
                      className="ebim-btn-ghost ebim-btn-sm ml-1"
                      disabled={busy}
                      onClick={() => verify.mutate(r.tenant_id!)}
                    >
                      Verificar
                    </button>
                  </td>
                </tr>
              );
            })}
          </DataTable>
        )}
      </Card>
    </PageContainer>
  );
}
