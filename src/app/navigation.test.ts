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
    const grupos = navGroupsFor('EBIM').map((g) => g.group);
    expect(grupos[0]).toBe('General');
    expect(new Set(grupos).size).toBe(grupos.length);
  });
});
