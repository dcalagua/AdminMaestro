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
