import { describe, it, expect } from 'vitest';
import { navItemsFor, navGroupsFor, NAV_ITEMS } from './navigation';

describe('navegación por perfil', () => {
  it('EBIM ve todas las entradas', () => {
    expect(navItemsFor('EBIM')).toHaveLength(NAV_ITEMS.length);
  });

  it('un partner NO ve la sección de costos de EBIM', () => {
    // Los costos de infraestructura son información interna: un partner no debe
    // ver cuánto le cuesta a EBIM operarlo. RLS además lo bloquea en la base.
    const rutas = navItemsFor('PARTNER').map((i) => i.to);
    expect(rutas).not.toContain('/costs');
    expect(rutas).toContain('/tenants');
  });

  it('un comercial sólo ve su dominio comercial', () => {
    const rutas = navItemsFor('SALES_AGENT').map((i) => i.to);
    expect(rutas).toContain('/attributions');
    expect(rutas).toContain('/commissions');
    // Nada de infraestructura, facturación ni organizaciones ajenas.
    expect(rutas).not.toContain('/deployments');
    expect(rutas).not.toContain('/billing');
    expect(rutas).not.toContain('/organizations');
    expect(rutas).not.toContain('/costs');
  });

  it('un usuario de tenant no ve gestión de partners ni comerciales', () => {
    const rutas = navItemsFor('TENANT').map((i) => i.to);
    expect(rutas).not.toContain('/partners');
    expect(rutas).not.toContain('/sales-agents');
    expect(rutas).toContain('/tenants');
  });

  it('todos los perfiles conservan el dashboard', () => {
    for (const persona of ['EBIM', 'PARTNER', 'SALES_AGENT', 'TENANT'] as const) {
      expect(navItemsFor(persona).map((i) => i.to)).toContain('/');
    }
  });

  it('agrupa manteniendo el orden de declaración', () => {
    // La Fase 14 reordena el menú siguiendo el recorrido de una venta:
    // Plataforma -> Comercial -> Tenancy -> Cobranza -> Infraestructura -> Gobierno.
    const grupos = navGroupsFor('EBIM').map((g) => g.group);
    expect(grupos[0]).toBe('Plataforma');
    expect(grupos).toEqual([
      'Plataforma', 'Comercial', 'Tenancy', 'Cobranza', 'Infraestructura', 'Gobierno',
    ]);
    expect(new Set(grupos).size).toBe(grupos.length);
  });

  it('la reconciliación financiera es solo de EBIM', () => {
    // Cruza cobros de todos los clientes y estados del proveedor de pago: no es
    // información de un partner. RLS lo bloquea además en la base.
    expect(navItemsFor('PARTNER').map((i) => i.to)).not.toContain('/reconciliation');
    expect(navItemsFor('EBIM').map((i) => i.to)).toContain('/reconciliation');
  });

  it('el alta de cliente es solo de EBIM', () => {
    // `onboard_customer_subscription` exige rol de plataforma o finanzas.
    expect(navItemsFor('PARTNER').map((i) => i.to)).not.toContain('/onboarding');
    expect(navItemsFor('SALES_AGENT').map((i) => i.to)).not.toContain('/onboarding');
  });

  it('monedas, FX y moneda de reporte son administración de EBIM', () => {
    // V3: `set_reporting_settings` y `set_exchange_rate` exigen EBIM_FINANCE o super admin.
    expect(navItemsFor('EBIM').map((i) => i.to)).toContain('/regional');
    expect(navItemsFor('PARTNER').map((i) => i.to)).not.toContain('/regional');
    expect(navItemsFor('TENANT').map((i) => i.to)).not.toContain('/regional');
  });

  it('un partner sí ve las renovaciones de su cartera', () => {
    expect(navItemsFor('PARTNER').map((i) => i.to)).toContain('/renewals');
  });
});
