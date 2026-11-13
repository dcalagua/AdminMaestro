import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { auditActionKind, auditActionLabel, auditDayLabel, entityTypeLabel, groupByDay } from './auditActions';

describe('auditActions', () => {
  it('traduce los códigos de la bitácora a frases en español', () => {
    expect(auditActionLabel('INVOICE_ISSUED')).toBe('Emisión de factura');
    expect(auditActionLabel('MANUAL_PAYMENT_CONFIRMED')).toBe('Confirmación de cobro manual');
    expect(auditActionLabel('SUBSCRIPTION_STATUS_CHANGED')).toBe('Cambio de estado de contrato');
    expect(auditActionLabel('USAGE_METER_BILLABLE_SET')).toBe('Cambio de facturable de medidor de uso');
    expect(auditActionLabel('PLATFORM_ROLE_GRANTED')).toBe('Concesión de rol de plataforma');
    expect(auditActionLabel('CUSTOMER_ONBOARDED')).toBe('Alta de cliente (Nueva venta)');
  });

  it('nombra el ciclo de una liquidación de comisiones (fase 13)', () => {
    expect(auditActionLabel('COMMISSION_SETTLEMENT_APPROVED')).toBe('Aprobación de liquidación de comisiones');
    expect(auditActionLabel('COMMISSION_SETTLEMENT_PAID')).toBe('Pago de liquidación de comisiones');
    expect(auditActionLabel('COMMISSION_SETTLEMENT_CANCELLED')).toBe('Anulación de liquidación de comisiones');
    expect(auditActionKind('COMMISSION_SETTLEMENT_PAID')).toBe('money');
  });

  it('un código desconocido no se inventa: devuelve null y se muestra el código', () => {
    expect(auditActionLabel('SOMETHING_ODD')).toBeNull();
    expect(auditActionLabel('product_integration.update')).toBeNull();
    expect(auditActionLabel(null)).toBeNull();
  });

  it('clasifica por tipo para el icono: el fallo manda sobre el tema', () => {
    expect(auditActionKind('PROVISIONING_FAILED')).toBe('failure');
    expect(auditActionKind('INVOICE_ISSUED')).toBe('money');
    expect(auditActionKind('USER_DEACTIVATED')).toBe('access');
    expect(auditActionKind('USAGE_AGGREGATE_FINALIZED')).toBe('usage');
    expect(auditActionKind('INTEGRATION_UPDATED')).toBe('provision');
    expect(auditActionKind('AGREEMENT_ENDED')).toBe('remove');
    expect(auditActionKind('ORGANIZATION_CREATED')).toBe('create');
    expect(auditActionKind('REPORTING_SETTINGS_CHANGED')).toBe('update');
  });

  it('nombra la entidad en español', () => {
    expect(entityTypeLabel('subscription')).toBe('Contrato');
    expect(entityTypeLabel('usage_period_aggregate')).toBe('Agregado de uso');
    expect(entityTypeLabel(null)).toBe('—');
  });

  it('agrupa por día conservando el orden y rotula hoy/ayer', () => {
    const now = new Date(2026, 9, 5, 12, 0);
    const rows = [
      { occurred_at: new Date(2026, 9, 5, 9, 0).toISOString() },
      { occurred_at: new Date(2026, 9, 5, 8, 0).toISOString() },
      { occurred_at: new Date(2026, 9, 4, 22, 0).toISOString() },
      { occurred_at: new Date(2026, 8, 30, 10, 0).toISOString() },
    ];
    const groups = groupByDay(rows);
    expect(groups.map((g) => g.rows.length)).toEqual([2, 1, 1]);
    expect(auditDayLabel(groups[0]!.first, now)).toMatch(/^Hoy · lunes, 5 de octubre de 2026$/);
    expect(auditDayLabel(groups[1]!.first, now)).toMatch(/^Ayer · /);
    expect(auditDayLabel(groups[2]!.first, now)).toMatch(/^Miércoles, 30 de sep?tiembre de 2026$/);
  });
});

/*
 * V6 · F4 · Auditoría sin códigos crudos: toda acción que la base escribe con
 * `platform.log_audit('<CÓDIGO>', '<entidad>', …)` tiene frase en español, y su
 * entidad, nombre. Se lee de las migraciones para que una acción nueva sin
 * etiqueta falle aquí y no aparezca como `SAAS_PROVISIONING_REQUESTED`.
 */
function auditCallsInMigrations(): { actions: Set<string>; entities: Set<string> } {
  const dir = join(process.cwd(), 'supabase/migrations');
  const actions = new Set<string>();
  const entities = new Set<string>();
  for (const file of readdirSync(dir).filter((f) => f.endsWith('.sql'))) {
    const sql = readFileSync(join(dir, file), 'utf8');
    for (const m of sql.matchAll(/log_audit\s*\(\s*([^,]+),\s*([^,]+),/g)) {
      for (const a of m[1]!.matchAll(/'([A-Z][A-Z0-9_]+)'/g)) actions.add(a[1]!);
      for (const e of m[2]!.matchAll(/'([a-z_]+)'/g)) entities.add(e[1]!);
    }
  }
  return { actions, entities };
}

describe('auditActions · cobertura de la base', () => {
  const { actions, entities } = auditCallsInMigrations();

  it('lee las llamadas de las migraciones', () => {
    expect(actions.size).toBeGreaterThan(50);
    expect(entities.size).toBeGreaterThan(20);
  });

  it('toda acción registrada por la base tiene frase en español', () => {
    expect([...actions].filter((a) => !auditActionLabel(a))).toEqual([]);
  });

  it('toda entidad registrada por la base tiene nombre', () => {
    expect([...entities].filter((e) => entityTypeLabel(e) === e.replace(/_/g, ' '))).toEqual([]);
  });

  it('ejemplos del Admin Maestro en QAS', () => {
    expect(auditActionLabel('SAAS_PROVISIONING_REQUESTED')).toBe('Solicitud de alta en la app');
    expect(auditActionLabel('SAAS_PROVISIONING_MANUAL')).toBe('Alta en la app registrada a mano');
    expect(entityTypeLabel('saas_provisioning_request')).toBe('Alta en la app');
  });
});
