import { describe, it, expect } from 'vitest';
import { resolvePersona, isFinance, canManagePlatform, isOperatorDomain, BLOCKED_OPERATOR_DOMAINS, CONSOLE_ROLES } from './session';
import type { SessionRoles } from '@/types/domain';

function makeRoles(partial: Partial<SessionRoles>): SessionRoles {
  return {
    userId: 'u1',
    email: 'x@ebim.test',
    fullName: null,
    platformRole: null,
    organizations: [],
    tenantRoles: [],
    salesAgentId: null,
    ...partial,
  };
}

describe('resolvePersona', () => {
  it('prioriza el rol de plataforma sobre cualquier otro', () => {
    const roles = makeRoles({
      platformRole: 'EBIM_SUPER_ADMIN',
      organizations: [{ organizationId: 'o1', role: 'PARTNER_ADMIN', displayName: 'X' }],
    });
    expect(resolvePersona(roles)).toBe('EBIM');
  });

  it('reconoce a un partner por su membresía de organización', () => {
    const roles = makeRoles({
      organizations: [{ organizationId: 'o1', role: 'PARTNER_ADMIN', displayName: 'Andina' }],
    });
    expect(resolvePersona(roles)).toBe('PARTNER');
  });

  it('reconoce a un comercial sin organización', () => {
    expect(resolvePersona(makeRoles({ salesAgentId: 'a1' }))).toBe('SALES_AGENT');
  });

  it('reconoce a un usuario de tenant', () => {
    const roles = makeRoles({ tenantRoles: [{ tenantId: 't1', role: 'TENANT_ADMIN' }] });
    expect(resolvePersona(roles)).toBe('TENANT');
  });

  it('devuelve UNKNOWN sin sesión o sin ningún rol', () => {
    expect(resolvePersona(null)).toBe('UNKNOWN');
    expect(resolvePersona(makeRoles({}))).toBe('UNKNOWN');
  });
});

describe('permisos derivados', () => {
  it('EBIM_FINANCE y el super admin pueden leer finanzas', () => {
    expect(isFinance(makeRoles({ platformRole: 'EBIM_FINANCE' }))).toBe(true);
    expect(isFinance(makeRoles({ platformRole: 'EBIM_SUPER_ADMIN' }))).toBe(true);
  });

  it('un PARTNER_ADMIN no puede leer finanzas de plataforma', () => {
    const roles = makeRoles({
      organizations: [{ organizationId: 'o1', role: 'PARTNER_ADMIN', displayName: 'Andina' }],
    });
    expect(isFinance(roles)).toBe(false);
    expect(canManagePlatform(roles)).toBe(false);
  });

  it('EBIM_PRODUCT_ADMIN administra entidades pero no es de finanzas', () => {
    const roles = makeRoles({ platformRole: 'EBIM_PRODUCT_ADMIN' });
    expect(canManagePlatform(roles)).toBe(true);
    expect(isFinance(roles)).toBe(false);
  });
});

describe('gobernanza de dominio (contrato §13.2)', () => {
  it('bloquea únicamente @ebim.pe', () => {
    expect(isOperatorDomain('dcalagua@ebim.pe')).toBe(true);
    expect(isOperatorDomain('DCALAGUA@EBIM.PE')).toBe(true);
  });

  it('NO bloquea @grupoebim.com — es un dominio de negocio normal', () => {
    // Corrección eexpense-026: confundirlos fue un bug real de la suite.
    expect(isOperatorDomain('alguien@grupoebim.com')).toBe(false);
  });

  it('la lista bloqueada contiene exactamente un dominio', () => {
    expect(BLOCKED_OPERATOR_DOMAINS).toEqual(['ebim.pe']);
  });

  it('los roles de consola no incluyen roles de tenant ni de partner', () => {
    expect(CONSOLE_ROLES).not.toContain('TENANT_ADMIN');
    expect(CONSOLE_ROLES).not.toContain('PARTNER_ADMIN');
  });
});
