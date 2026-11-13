import { describe, expect, it } from 'vitest';
import { decideDelivery, isAllowedDomain, isTestDomain, parseDeliveryConfig } from './policy';

/*
 * Salvaguarda de QAS: ningún correo de negocio llega a un cliente real salvo
 * que alguien escriba MAIL_DELIVERY_MODE=live a propósito.
 */
const env = (vars: Record<string, string>) => (name: string) => vars[name];

describe('parseDeliveryConfig', () => {
  it('sin configuración = allowlist con ebim.pe y grupoebim.com', () => {
    expect(parseDeliveryConfig(env({}))).toEqual({ mode: 'allowlist', allowedDomains: ['ebim.pe', 'grupoebim.com'], redirectTo: null });
  });
  it('un modo desconocido o con errores de tipeo cae en allowlist (fail-safe)', () => {
    expect(parseDeliveryConfig(env({ MAIL_DELIVERY_MODE: 'LIVE ' })).mode).toBe('live');
    expect(parseDeliveryConfig(env({ MAIL_DELIVERY_MODE: 'produccion' })).mode).toBe('allowlist');
    expect(parseDeliveryConfig(env({ MAIL_DELIVERY_MODE: '' })).mode).toBe('allowlist');
  });
  it('normaliza dominios y descarta un redirect inválido', () => {
    const cfg = parseDeliveryConfig(env({ MAIL_ALLOWED_DOMAINS: ' @EBIM.pe, ,grupoebim.com ', MAIL_REDIRECT_TO: 'no-es-correo', MAIL_DELIVERY_MODE: 'redirect' }));
    expect(cfg.allowedDomains).toEqual(['ebim.pe', 'grupoebim.com']);
    expect(cfg.redirectTo).toBeNull();
  });
});

describe('decideDelivery', () => {
  const allowlist = parseDeliveryConfig(env({}));

  it('allowlist: EBIM pasa; un cliente real queda retenido (QAS)', () => {
    expect(decideDelivery('Ana@EBIM.pe', allowlist)).toEqual({ action: 'SEND', to: 'ana@ebim.pe', redirectedFrom: null });
    expect(decideDelivery('ops@qas.grupoebim.com', allowlist).action).toBe('SEND');
    const held = decideDelivery('administrador@chm.com.pe', allowlist);
    expect(held.action).toBe('HOLD');
    expect(held.action === 'HOLD' && held.reason).toContain('Retenido (QAS)');
    expect(decideDelivery('x@gmail.com', allowlist).action).toBe('HOLD');
    // Un dominio que solo TERMINA en el nombre no es subdominio.
    expect(decideDelivery('x@fakeebim.pe', allowlist).action).toBe('HOLD');
  });

  it('los dominios de prueba se descartan en cualquier modo', () => {
    for (const mode of ['allowlist', 'redirect', 'live'] as const) {
      const cfg = { ...allowlist, mode, redirectTo: 'qa@ebim.pe' };
      expect(decideDelivery('pagos@alpha.ebim.test', cfg).action).toBe('SKIP');
      expect(decideDelivery('x@foo.invalid', cfg).action).toBe('SKIP');
      expect(decideDelivery('x@example.com', cfg).action).toBe('SKIP');
      expect(decideDelivery('no-es-correo', cfg).action).toBe('SKIP');
    }
  });

  it('redirect: todo va al buzón de QA, que debe ser de EBIM', () => {
    const cfg = { ...allowlist, mode: 'redirect' as const, redirectTo: 'qa@ebim.pe' };
    expect(decideDelivery('admin@chm.com.pe', cfg)).toEqual({ action: 'SEND', to: 'qa@ebim.pe', redirectedFrom: 'admin@chm.com.pe' });
    expect(decideDelivery('admin@chm.com.pe', { ...cfg, redirectTo: 'qa@gmail.com' }).action).toBe('HOLD');
    expect(decideDelivery('admin@chm.com.pe', { ...cfg, redirectTo: null }).action).toBe('HOLD');
  });

  it('live: el destinatario real', () => {
    expect(decideDelivery('admin@chm.com.pe', { ...allowlist, mode: 'live' })).toEqual({ action: 'SEND', to: 'admin@chm.com.pe', redirectedFrom: null });
  });

  it('helpers de dominio', () => {
    expect(isTestDomain('cmh.test')).toBe(true);
    expect(isTestDomain('ebim.pe')).toBe(false);
    expect(isAllowedDomain('a.ebim.pe', ['ebim.pe'])).toBe(true);
    expect(isAllowedDomain('ebim.pe.evil.com', ['ebim.pe'])).toBe(false);
  });
});
