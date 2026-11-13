import { describe, it, expect } from 'vitest';
import {
  INVENTORY_NOT_AVAILABLE, capabilityText, errorText, findingDetail, findingSubject, inventoryText, linksText,
  outcomeOf, suggestSlug,
} from './syncModel';

/*
 * Textos de la sincronización con las apps: español de negocio, sin jerga, y
 * una app sin inventario lo dice en vez de inventar un número.
 */
describe('syncModel', () => {
  it('una app que no anuncia inventario lo dice tal cual', () => {
    expect(inventoryText({ inventory_available: false, last_inventory_status: null, last_inventory_items: null, last_inventory_unknown: null }))
      .toEqual({ text: INVENTORY_NOT_AVAILABLE, tone: 'neutral' });
    expect(INVENTORY_NOT_AVAILABLE).toBe('Inventario no disponible en esta app');
  });

  it('con inventario: cuántos clientes y cuántos sin registrar', () => {
    expect(inventoryText({ inventory_available: true, last_inventory_status: 'AVAILABLE', last_inventory_items: 8, last_inventory_unknown: 6 }))
      .toEqual({ text: '8 clientes en la app · 6 sin registrar aquí', tone: 'warn' });
    expect(inventoryText({ inventory_available: true, last_inventory_status: 'AVAILABLE', last_inventory_items: 1, last_inventory_unknown: 0 }).text)
      .toBe('1 cliente en la app');
    expect(inventoryText({ inventory_available: true, last_inventory_status: 'FAILED', last_inventory_items: 0, last_inventory_unknown: 0 }).tone)
      .toBe('danger');
  });

  it('resume los vínculos revisados', () => {
    const base = { last_checked_at: '2026-11-13T10:30:00Z', active_links: 3 };
    expect(linksText({ ...base, last_links_total: 3, last_links_ok: 1, last_links_broken: 1, last_links_state_mismatch: 1, last_links_unverified: 0 }))
      .toBe('1 de 3 coinciden · 1 rotos · 1 con estado distinto');
    expect(linksText({ ...base, last_checked_at: null, last_links_total: null, last_links_ok: null, last_links_broken: null, last_links_state_mismatch: null, last_links_unverified: null }))
      .toBe('3 vinculados');
  });

  it('resultado y capacidades por app', () => {
    expect(outcomeOf({ last_outcome: null, last_checked_at: null }).label).toBe('Aún sin revisar');
    expect(outcomeOf({ last_outcome: 'NOT_VERIFIABLE', last_checked_at: 'x' }).label).toBe('Sin forma de comprobar');
    expect(capabilityText({ can_check_existence: true, can_check_state: false })).toBe('Comprueba que cada cliente existe (no su estado).');
    expect(capabilityText({ can_check_existence: false, can_check_state: false })).toMatch(/todavía no permite/);
  });

  it('nunca muestra un código técnico como causa', () => {
    expect(errorText('DEPLOYMENT_WITHOUT_URL')).toBe('El entorno no tiene dirección configurada.');
    expect(errorText('HTTP_502')).not.toMatch(/HTTP_502/);
    expect(errorText(null)).toBeNull();
  });

  it('describe cada diferencia en palabras de negocio', () => {
    expect(findingSubject({ kind: 'APP_ONLY', app_name: 'LABOFTA S.A.C.', app_code: null, tenant_name: null, external_tenant_id: 'a2' }))
      .toBe('LABOFTA S.A.C.');
    expect(findingSubject({ kind: 'BROKEN_LINK', app_name: null, app_code: null, tenant_name: 'EBIM eCommerce QAS Smoke', external_tenant_id: 'af8' }))
      .toBe('EBIM eCommerce QAS Smoke');
    expect(findingDetail({ kind: 'STATE_MISMATCH', masteradmin_state: 'ACTIVE', app_state: 'SUSPENDED', app_status: null }))
      .toBe('Admin Maestro: Activo · App: Suspendido');
  });

  it('propone un identificador limpio', () => {
    expect(suggestSlug('Panadería La Rosa S.A.C.', 'comerza')).toBe('panaderia-la-rosa-s-a-c-comerza');
    expect(suggestSlug('chm', 'esupplier')).toBe('chm-esupplier');
    expect(suggestSlug('grupasa-ewm', 'ewm')).toBe('grupasa-ewm');
    expect(suggestSlug(null)).toBe('');
  });
});
