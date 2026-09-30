/**
 * EBIM Commercial Control Plane · Fase 18 · ejes de cutover de MasterAdmin (D-14, LOCAL).
 *
 * Spec §15: cada producto tiene dos ejes en platform.product_integrations
 * (cutover_state_entitlements / cutover_state_billing) que SOLO cambian con
 * platform.set_commercial_cutover_state (un paso, motivo, historial
 * append-only, guarda de cohorte IN_SYNC al ir a DUAL_READ/PRIMARY).
 *
 * Este módulo lo usan:
 *   · los X-07 de eExpense/GMAO, para llevar el eje de facturación a
 *     BILLING_SHADOW antes de comparar (record_billing_shadow_comparison lo exige);
 *   · d14-masteradmin-axes.mts, para llevar el eje de entitlements de cada
 *     producto a MASTERADMIN_PRIMARY después de que su X-07 dejó evidencia D-14
 *     en verde.
 *
 * Integración del eje: la integración HTTP_M2M del producto con contrato
 * entitlements configurado; si no existe, se crea `<producto>-ccp-d14-dev`
 * DESHABILITADA (no entra en el índice único de habilitadas, nunca se usa para
 * empujar) y se configura con la RPC humana. Actores: super admin (entitlements,
 * platform.integration.manage) y finanzas (facturación), sembrados en local.
 *
 * SOLO LOCAL: aborta si SUPABASE_DB_URL no es 127.0.0.1/localhost.
 */
import { execFileSync } from 'node:child_process';

export const SUPERADMIN = '10000000-0000-4000-a000-000000000001';
export const FINANCE = '10000000-0000-4000-a000-000000000003';

const ENT_ORDER = ['LEGACY_ONLY', 'SHADOW', 'DUAL_READ', 'MASTERADMIN_PRIMARY'];
const BILL_ORDER = ['BILLING_LEGACY', 'BILLING_SHADOW'];

export function maDbUrl(): string {
  const db = process.env.SUPABASE_DB_URL ?? '';
  if (!/@(127\.0\.0\.1|localhost):\d+\//.test(db)) {
    throw new Error('HARD STOP: SUPABASE_DB_URL debe ser el stack LOCAL de MasterAdmin');
  }
  return db;
}

/** psql contra MasterAdmin LOCAL; `as` fija rol y claims (locales a la transacción). */
export function maSql(q: string, as?: { user?: string; service?: boolean }): string {
  const claims = as?.service
    ? JSON.stringify({ role: 'service_role' })
    : as?.user
      ? JSON.stringify({ sub: as.user, role: 'authenticated' })
      : null;
  const role = as?.service ? 'service_role' : 'authenticated';
  const prelude = claims
    ? `do $d14$ begin perform set_config('request.jwt.claims', '${claims}', true); perform set_config('role', '${role}', true); end $d14$;`
    : '';
  const script = `begin;\n${prelude}\n${q};\ncommit;`;
  const out = execFileSync('psql', [maDbUrl(), '-X', '-q', '-At', '-v', 'ON_ERROR_STOP=1'], { input: script, encoding: 'utf8' });
  return out.trim();
}

const lit = (s: string) => `'${s.replace(/'/g, "''")}'`;

/** Devuelve el id de la integración del eje del producto (la crea deshabilitada si no hay ninguna). */
export function ensureCcpIntegration(product: string): string {
  const existing = maSql(`select i.id from platform.product_integrations i join platform.saas_products p on p.id = i.saas_product_id
     where p.code = ${lit(product)} and i.integration_type = 'HTTP_M2M' and i.entitlements_path is not null
     order by i.enabled desc, i.created_at limit 1`);
  if (existing) return existing;
  const id = maSql(`insert into platform.product_integrations
      (saas_product_id, code, name, integration_type, contract_version, issuer, audience, subject, algorithm,
       token_ttl_seconds, create_scope, read_scope, create_path_template, status_path_template, provisioning_policy,
       enabled, status)
    select p.id, ${lit(`${product}-ccp-d14-dev`)}, ${lit(`${product} · eje CCP D-14 (LOCAL/DEV)`)}, 'HTTP_M2M', 'v1',
           'masteradmin.ebim', ${lit(`${product}.ebim`)}, 'masteradmin-provisioning', 'ES256', 300,
           ${lit(`${product}:tenant:create`)}, ${lit(`${product}:tenant:read`)}, '/tenants', '/tenants/{controlPlaneTenantId}',
           'MANUAL', false, 'READY'
      from platform.saas_products p where p.code = ${lit(product)}
    returning id`);
  if (!id) throw new Error(`producto ${product} no existe en MasterAdmin`);
  maSql(`select platform.configure_entitlements_integration(${lit(id)}, '/tenants/{controlPlaneTenantId}/entitlements',
      '/entitlements/manifest', ${lit(`${product}:entitlements:write`)}, ${lit(`${product}:entitlements:read`)})`, { user: SUPERADMIN });
  return id;
}

export function axisState(integrationId: string): { entitlements: string; billing: string } {
  const [entitlements, billing] = maSql(`select cutover_state_entitlements || '|' || cutover_state_billing
      from platform.product_integrations where id = ${lit(integrationId)}`).split('|');
  return { entitlements, billing };
}

/**
 * Avanza un eje hasta `target`, un paso por vez, con la RPC gobernada.
 * Devuelve las transiciones hechas (vacío si ya estaba). Nunca retrocede.
 */
export function advanceAxis(integrationId: string, axis: 'ENTITLEMENTS' | 'BILLING', target: string, reason: string): string[] {
  const order = axis === 'ENTITLEMENTS' ? ENT_ORDER : BILL_ORDER;
  const actor = axis === 'ENTITLEMENTS' ? SUPERADMIN : FINANCE;
  const done: string[] = [];
  for (;;) {
    const s = axisState(integrationId);
    const cur = axis === 'ENTITLEMENTS' ? s.entitlements : s.billing;
    const i = order.indexOf(cur);
    const t = order.indexOf(target);
    if (i < 0 || t < 0) throw new Error(`estado fuera del alcance de D-14: ${cur} → ${target}`);
    if (i === t) return done;
    if (i > t) throw new Error(`el eje ${axis} ya está en ${cur}, más allá de ${target}: D-14 no retrocede ni avanza más`);
    const next = order[i + 1];
    maSql(`select platform.set_commercial_cutover_state(${lit(integrationId)}, ${lit(axis)}, ${lit(next)}, ${lit(reason)})`, { user: actor });
    done.push(`${cur}->${next}`);
  }
}

/** Tenants con mapping ACTIVE en la integración y su estado de sync (lo que evalúa la guarda de cohorte). */
export function cohortOf(integrationId: string): { mapped: number; inSync: number } {
  const [mapped, inSync] = maSql(`select count(*) || '|' || count(*) filter (where s.state in ('IN_SYNC','IN_SYNC_WITH_WARNINGS'))
      from platform.tenant_product_mappings m
      join platform.deployment_targets d on d.id = m.deployment_target_id
      left join platform.entitlement_sync_state s on s.tenant_id = m.tenant_id and s.saas_product_id = m.saas_product_id
     where d.product_integration_id = ${lit(integrationId)} and m.status = 'ACTIVE'`).split('|').map(Number);
  return { mapped, inSync };
}
