import { describe, expect, it } from 'vitest';
import { navAccessFor } from '@/app/navigation';
import type { SessionRoles } from '@/types/domain';
import { resolvePersona } from '@/features/auth/session';
import { appHealth, type IntegrationRow, type ProvisioningRow, type SuiteApp, type TargetRow, type TenantRow } from '@/features/suite/suiteModel';
import {
  alertItems,
  altaItems,
  buildInbox,
  confirmItems,
  countByKind,
  documentItems,
  healthItems,
  inboxAudience,
  invoiceItems,
  matchesInbox,
  settlementItems,
  type InboxAlert,
  type InboxAudience,
  type InboxInvoice,
} from './inboxModel';

/*
 * V5 · F5 · Bandeja: el cálculo (qué pide acción, con qué prioridad y qué
 * acción) y los permisos (cada rol ve sólo lo suyo).
 */

const NOW = new Date('2026-11-12T12:00:00Z');

const base: SessionRoles = {
  userId: 'u', email: 'u@ebim.test', fullName: 'Usuaria', platformRole: null, organizations: [],
  tenantRoles: [], salesAgentId: null, provisioningRoles: [], ownedProductIds: [],
};

function audienceFor(roles: SessionRoles, perms: { platform?: boolean; commercial?: boolean; finance?: boolean; provisioning?: boolean }) {
  const persona = resolvePersona(roles);
  return inboxAudience({
    access: navAccessFor(persona, roles),
    canManagePlatform: Boolean(perms.platform),
    canManageCommercial: Boolean(perms.commercial),
    canReadFinance: Boolean(perms.finance),
    hasProvisioningAccess: Boolean(perms.provisioning),
  });
}

const ALL: InboxAudience = {
  invoice: true, alta: true, health: true, confirm: true, document: true, 'billing-alert': true, settlement: true,
};
const NONE: InboxAudience = {
  invoice: false, alta: false, health: false, confirm: false, document: false, 'billing-alert': false, settlement: false,
};

describe('permisos: cada rol ve sólo lo suyo', () => {
  it('el super admin ve los siete tipos', () => {
    const a = audienceFor({ ...base, platformRole: 'EBIM_SUPER_ADMIN' }, { platform: true, commercial: true, finance: true, provisioning: true });
    expect(a).toEqual(ALL);
  });

  it('finanzas EBIM: cobranza, documentos y liquidaciones; no confirma tenants, ni ejecuta altas, ni verifica apps', () => {
    const a = audienceFor({ ...base, platformRole: 'EBIM_FINANCE' }, { commercial: true, finance: true });
    expect(a).toEqual({ ...ALL, confirm: false, health: false, alta: false });
  });

  it('operación técnica EBIM (sin finanzas): sólo altas y salud de sus apps', () => {
    const a = audienceFor({ ...base, ownedProductIds: ['p-ewm'] }, { provisioning: true });
    expect(a).toEqual({ ...NONE, alta: true, health: true });
  });

  it('un partner: sus facturas, alertas y altas; nunca salud de la suite, liquidaciones ni aprobaciones EBIM', () => {
    const roles: SessionRoles = {
      ...base,
      organizations: [{ organizationId: 'o-p', role: 'PARTNER_ADMIN', displayName: 'Andina' }],
    };
    expect(audienceFor(roles, {})).toEqual({ ...NONE, invoice: true, 'billing-alert': true, alta: true });
  });

  it('un comercial o un usuario de tenant no reciben avisos operativos (comercial ≠ acceso operativo)', () => {
    expect(audienceFor({ ...base, salesAgentId: 'sa-1' }, {})).toEqual(NONE);
    expect(audienceFor({ ...base, tenantRoles: [{ tenantId: 't', role: 'TENANT_ADMIN' }] }, {})).toEqual(NONE);
  });

  it('un tipo fuera de la audiencia no aparece aunque haya filas', () => {
    const items = buildInbox({ invoices: [invoice({})] }, { ...ALL, invoice: false }, NOW);
    expect(items).toEqual([]);
  });
});

const invoice = (over: Partial<InboxInvoice>): InboxInvoice => ({
  invoice_id: 'inv-1', number: 'F001-12', customer_organization_id: 'o-1', organization_name: 'Acme',
  due_date: '2026-10-01', days_overdue: 42, balance: 1180, currency: 'PEN', ...over,
});

describe('facturas vencidas', () => {
  it('más de 30 días es urgente; con saldo cero no pide nada; la acción abre Por cobrar con la factura', () => {
    const items = invoiceItems([
      invoice({}),
      invoice({ invoice_id: 'inv-2', number: 'F001-13', days_overdue: 5 }),
      invoice({ invoice_id: 'inv-3', balance: 0 }),
      invoice({ invoice_id: 'inv-4', days_overdue: 0 }),
    ]);
    expect(items.map((i) => [i.key, i.priority])).toEqual([['invoice:inv-1', 1], ['invoice:inv-2', 2]]);
    expect(items[0]).toMatchObject({
      title: 'Factura F001-12 vencida',
      ageText: 'vencida hace 42 días',
      account: { name: 'Acme', to: '/organizations/o-1' },
      action: { type: 'link', label: 'Gestionar el cobro', to: '/cobranza?tab=por-cobrar&pcq=F001-12' },
    });
    expect(items[0]!.detail).toMatch(/1,180\.00/);
  });
});

const request = (over: Partial<ProvisioningRow>): ProvisioningRow =>
  ({
    id: 'r-1', tenant_id: 'tn-1', saas_product_id: 'p-ewm', tenant_name: 'Acme EWM', product_short_name: 'EWM',
    customer_organization_id: 'o-1', customer_organization_name: 'Acme', status: 'FAILED', attempt_count: 1, max_attempts: 3,
    requested_at: '2026-11-10T10:00:00Z', updated_at: '2026-11-11T12:00:00Z', completed_at: null,
    last_error_code: null, last_error_message: 'La app no responde', ...over,
  }) as ProvisioningRow;

describe('altas en las apps', () => {
  it('fallida = urgente; lista para ejecutar = acción «Ejecutar alta» en el sitio', () => {
    const items = altaItems(
      [request({}), request({ id: 'r-2', tenant_id: 'tn-2', tenant_name: 'Beta EWM', status: 'READY_TO_PROVISION' })],
      NOW,
    );
    expect(items.map((i) => [i.key, i.priority, i.action.type])).toEqual([
      ['alta:r-1:FAILED:1', 1, 'link'],
      ['alta:r-2:READY', 3, 'execute-alta'],
    ]);
    expect(items[0]).toMatchObject({ title: 'Alta fallida de Acme EWM en EWM', detail: 'La app no responde', ageText: 'ayer' });
    expect(items[1]!.action).toMatchObject({ requestId: 'r-2', productId: 'p-ewm', tenantId: 'tn-2' });
  });

  it('se resuelve solo: si una solicitud posterior quedó activa, la fallida ya no aparece', () => {
    const items = altaItems(
      [request({}), request({ id: 'r-3', status: 'ACTIVE', requested_at: '2026-11-11T13:00:00Z' })],
      NOW,
    );
    expect(items).toEqual([]);
  });

  it('un reintento cambia la clave: un «hecho» anterior no oculta el fallo nuevo', () => {
    const [first] = altaItems([request({ attempt_count: 1 })], NOW);
    const [second] = altaItems([request({ attempt_count: 2 })], NOW);
    expect(first!.key).not.toBe(second!.key);
  });
});

describe('tenants por confirmar', () => {
  it('PENDING aquí con alta ACTIVE en la app: «Confirmar como activo» en el sitio', () => {
    const tenants = [
      { tenant_id: 'tn-1', name: 'Acme EWM', status: 'PENDING', saas_product_id: 'p-ewm', customer_organization_id: 'o-1', customer_name: 'Acme', product_short_name: 'EWM' },
      { tenant_id: 'tn-2', name: 'Beta EWM', status: 'ACTIVE', saas_product_id: 'p-ewm', customer_organization_id: 'o-2', customer_name: 'Beta', product_short_name: 'EWM' },
    ] as TenantRow[];
    const requests = [
      request({ status: 'ACTIVE', completed_at: '2026-11-12T09:00:00Z' }),
      request({ id: 'r-2', tenant_id: 'tn-2', status: 'ACTIVE' }),
    ];
    const items = confirmItems(tenants, requests, NOW);
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({
      key: 'confirm:tn-1',
      priority: 2,
      app: 'EWM',
      ageText: 'hace 3 horas',
      action: { type: 'confirm-active', tenantId: 'tn-1', tenantName: 'Acme EWM' },
    });
  });
});

const EWM: SuiteApp = { id: 'p-ewm', code: 'ewm', name: 'EWM', accent: null, sort: 1 };
const target = (over: Partial<TargetRow>) =>
  ({
    deployment_target_id: 't-ewm', saas_product_id: 'p-ewm', provisioning_environment: 'PRD', provisioning_enabled: true,
    provisioning_status: 'READY', health_status: 'HEALTHY', health_checked_at: '2026-11-12T10:00:00Z', ...over,
  }) as TargetRow;
const healthOf = (over: Partial<TargetRow>) => appHealth(EWM, [target(over)], [] as IntegrationRow[], NOW);

describe('salud de las apps', () => {
  it('caída = urgente, degradada = importante, sana y reciente = nada', () => {
    expect(healthItems([healthOf({ health_status: 'UNHEALTHY' })], NOW)[0]).toMatchObject({ priority: 1, title: 'EWM: caído' });
    expect(healthItems([healthOf({ health_status: 'DEGRADED' })], NOW)[0]).toMatchObject({ priority: 2 });
    expect(healthItems([healthOf({})], NOW)).toEqual([]);
  });

  it('chequeo de más de 24 h o nunca hecho = normal, con «Verificar ahora» en el sitio', () => {
    const [stale] = healthItems([healthOf({ health_checked_at: '2026-11-10T10:00:00Z' })], NOW);
    expect(stale).toMatchObject({
      priority: 3,
      title: 'EWM: comprobación vencida',
      action: { type: 'check-health', targetId: 't-ewm', appCode: 'ewm' },
      screen: { to: '/apps/ewm' },
    });
    const [never] = healthItems([healthOf({ health_checked_at: null, health_status: 'UNKNOWN' })], NOW);
    expect(never!.ageText).toBe('nunca comprobada');
  });

  it('un destino en borrador no se evalúa: no es un aviso', () => {
    expect(healthItems([healthOf({ provisioning_status: 'DRAFT', health_status: 'UNHEALTHY' })], NOW)).toEqual([]);
  });

  it('verificar de nuevo cambia la clave (otra observación)', () => {
    const [a] = healthItems([healthOf({ health_status: 'UNHEALTHY' })], NOW);
    const [b] = healthItems([healthOf({ health_status: 'UNHEALTHY', health_checked_at: '2026-11-12T11:00:00Z' })], NOW);
    expect(a!.key).not.toBe(b!.key);
  });
});

const alert = (over: Partial<InboxAlert>): InboxAlert => ({
  id: 'a-1', alert_type: 'RENEWAL_NOTICE', severity: 'INFO', title: 'Renueva en 30 días', message: null,
  created_at: '2026-11-05T00:00:00Z', due_at: '2026-12-12T00:00:00Z', invoice_id: null, subscription_id: 's-1',
  subscriptions: { code: 'SUB-1', saas_products: { short_name: 'EWM' }, organizations: { display_name: 'Acme' } },
  ...over,
});

describe('renovaciones y alertas de cobranza', () => {
  it('la severidad da la prioridad y cada tipo su acción', () => {
    const items = alertItems(
      [alert({}), alert({ id: 'a-2', alert_type: 'SUSPENSION_DUE', severity: 'CRITICAL' }), alert({ id: 'a-3', alert_type: 'REQUEST_DOCUMENT', severity: 'WARNING' })],
      NOW,
    );
    expect(items.map((i) => [i.priority, i.action.type === 'link' ? i.action.to : ''])).toEqual([
      [3, '/cobranza?tab=renovaciones&ventana=30'],
      [1, '/cobranza?tab=renovaciones'],
      [2, '/subscriptions/s-1#collection'],
    ]);
    expect(items[0]).toMatchObject({ title: 'Renovación próxima · SUB-1', account: { name: 'Acme' }, app: 'EWM' });
  });

  it('una alerta de factura vencida no repite la factura que ya está en la bandeja', () => {
    const items = buildInbox(
      { invoices: [invoice({})], alerts: [alert({ alert_type: 'PAST_DUE', invoice_id: 'inv-1' }), alert({ id: 'a-9', alert_type: 'PAST_DUE', invoice_id: 'inv-9' })] },
      ALL,
      NOW,
    );
    expect(items.map((i) => i.key).sort()).toEqual(['alert:a-9', 'invoice:inv-1']);
  });
});

describe('documentos y liquidaciones', () => {
  it('documento recibido = por aprobar en el contrato; más de una semana esperando sube a importante', () => {
    const items = documentItems(
      [
        { id: 'd-1', document_type: 'PURCHASE_ORDER', document_number: 'OC-77', received_at: '2026-11-11T00:00:00Z', requested_at: '2026-11-01T00:00:00Z', subscription_id: 's-1', subscriptions: { code: 'SUB-1', billed_organization_id: 'o-1', organizations: { display_name: 'Acme' } } },
        { id: 'd-2', document_type: 'SERVICE_ORDER', document_number: null, received_at: '2026-10-01T00:00:00Z', requested_at: '2026-09-01T00:00:00Z', subscription_id: 's-2' },
      ],
      NOW,
    );
    expect(items[0]).toMatchObject({ title: 'Orden de compra OC-77 por aprobar', priority: 3, account: { to: '/organizations/o-1' } });
    expect(items[1]).toMatchObject({ title: 'Orden de servicio por aprobar', priority: 2 });
    expect(items[0]!.action).toEqual({ type: 'link', label: 'Revisar y aprobar', to: '/subscriptions/s-1#collection' });
  });

  it('liquidación abierta = por aprobar; aprobada = por pagar; pagada o anulada = nada', () => {
    const row = (id: string, status: string) => ({
      id, code: `LQ-${id}`, status, total_amount: 500, currency: 'USD', created_at: '2026-11-01T00:00:00Z', approved_at: '2026-11-08T00:00:00Z',
      sales_agents: { full_name: 'Ana Ruiz' },
    });
    const items = settlementItems([row('1', 'OPEN'), row('2', 'APPROVED'), row('3', 'PAID'), row('4', 'CANCELLED')], NOW);
    expect(items.map((i) => [i.title, i.priority, i.action.label])).toEqual([
      ['Liquidación LQ-1 por aprobar', 3, 'Aprobar…'],
      ['Liquidación LQ-2 por pagar', 2, 'Registrar pago…'],
    ]);
    expect(items[1]!.key).toBe('settlement:2:APPROVED');
    expect(items[1]!.detail).toMatch(/Ana Ruiz · .*500\.00/);
  });
});

describe('bandeja completa', () => {
  it('más urgente primero y, a igual prioridad, lo que más espera; cuenta por tipo y busca sin tildes', () => {
    const items = buildInbox(
      {
        invoices: [invoice({ days_overdue: 5, due_date: '2026-11-07' }), invoice({ invoice_id: 'inv-old', days_overdue: 20, due_date: '2026-10-23' })],
        requests: [request({})],
        alerts: [alert({ id: 'a-c', alert_type: 'PAYMENT_FAILURE', severity: 'CRITICAL', created_at: '2026-11-12T08:00:00Z' })],
      },
      ALL,
      NOW,
    );
    expect(items.map((i) => i.key)).toEqual(['alta:r-1:FAILED:1', 'alert:a-c', 'invoice:inv-old', 'invoice:inv-1']);
    expect(countByKind(items)).toMatchObject({ invoice: 2, alta: 1, 'billing-alert': 1, health: 0 });
    expect(items.filter((i) => matchesInbox(i, 'acmé')).length).toBe(4);
    expect(items.filter((i) => matchesInbox(i, 'f001-12')).map((i) => i.kind)).toEqual(['invoice', 'invoice']);
  });
});
