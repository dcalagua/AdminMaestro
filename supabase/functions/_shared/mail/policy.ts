/**
 * Modo de entrega del correo de negocio (salvaguarda de QAS).
 *
 * Módulo PURO: lo prueba vitest.
 *
 *   MAIL_DELIVERY_MODE = allowlist | redirect | live     (por defecto: allowlist)
 *   MAIL_ALLOWED_DOMAINS = "ebim.pe,grupoebim.com"        (por defecto: esos dos)
 *   MAIL_REDIRECT_TO = "buzon@ebim.pe"                    (solo modo redirect)
 *
 * Reglas, en este orden:
 *   1. Dominios de prueba (`.test`, `.invalid`, `.example`, `.localhost`,
 *      `example.com/.org/.net`) se DESCARTAN siempre, en cualquier modo: no son
 *      buzones y MailHub los rebotaría.
 *   2. live      → se envía al destinatario real (PRD).
 *   3. redirect  → se envía a MAIL_REDIRECT_TO (si falta o no está en la lista
 *                  permitida, se retiene: nunca se adivina un destino).
 *   4. allowlist → solo a los dominios permitidos; el resto queda RETENIDO en el
 *                  outbox (estado HELD, «Retenido (QAS)») y no sale.
 *
 * Fail-safe: un valor desconocido o vacío en MAIL_DELIVERY_MODE se trata como
 * `allowlist`. Para que un correo llegue a un cliente real hay que escribir
 * `live` a propósito.
 */

export type DeliveryMode = 'allowlist' | 'redirect' | 'live';

export interface DeliveryConfig {
  mode: DeliveryMode;
  allowedDomains: string[];
  redirectTo: string | null;
}

export type DeliveryDecision =
  | { action: 'SEND'; to: string; redirectedFrom: string | null }
  | { action: 'HOLD'; reason: string }
  | { action: 'SKIP'; reason: string };

export const DEFAULT_ALLOWED_DOMAINS = ['ebim.pe', 'grupoebim.com'];

const TEST_TLDS = ['test', 'invalid', 'example', 'localhost', 'local'];
const TEST_DOMAINS = ['example.com', 'example.org', 'example.net'];
const EMAIL_RE = /^[^\s@<>"',;]+@([a-z0-9-]+(\.[a-z0-9-]+)+)$/i;

export function parseDeliveryConfig(env: (name: string) => string | undefined): DeliveryConfig {
  const rawMode = (env('MAIL_DELIVERY_MODE') ?? '').trim().toLowerCase();
  const mode: DeliveryMode = rawMode === 'live' || rawMode === 'redirect' ? rawMode : 'allowlist';
  const domains = (env('MAIL_ALLOWED_DOMAINS') ?? '')
    .split(',')
    .map((d) => d.trim().toLowerCase().replace(/^@/, ''))
    .filter(Boolean);
  const redirect = (env('MAIL_REDIRECT_TO') ?? '').trim().toLowerCase();
  return {
    mode,
    allowedDomains: domains.length ? domains : DEFAULT_ALLOWED_DOMAINS,
    redirectTo: EMAIL_RE.test(redirect) ? redirect : null,
  };
}

export function domainOf(email: string): string | null {
  const m = EMAIL_RE.exec(email.trim().toLowerCase());
  return m ? m[1] : null;
}

export function isTestDomain(domain: string): boolean {
  const d = domain.toLowerCase();
  if (TEST_DOMAINS.includes(d)) return true;
  const tld = d.split('.').pop() ?? '';
  return TEST_TLDS.includes(tld);
}

/** ¿El dominio está permitido? Acepta subdominios (`qas.ebim.pe` ⊂ `ebim.pe`). */
export function isAllowedDomain(domain: string, allowed: string[]): boolean {
  const d = domain.toLowerCase();
  return allowed.some((a) => d === a || d.endsWith(`.${a}`));
}

export function decideDelivery(recipient: string, cfg: DeliveryConfig): DeliveryDecision {
  const email = recipient.trim().toLowerCase();
  const domain = domainOf(email);
  if (!domain) return { action: 'SKIP', reason: 'Dirección de correo inválida' };
  if (isTestDomain(domain)) return { action: 'SKIP', reason: 'Dominio de prueba: no es un buzón real' };
  if (cfg.mode === 'live') return { action: 'SEND', to: email, redirectedFrom: null };
  if (cfg.mode === 'redirect') {
    if (!cfg.redirectTo) return { action: 'HOLD', reason: 'Modo redirección sin MAIL_REDIRECT_TO válido' };
    const target = domainOf(cfg.redirectTo);
    if (!target || !isAllowedDomain(target, cfg.allowedDomains)) {
      return { action: 'HOLD', reason: 'MAIL_REDIRECT_TO fuera de los dominios permitidos' };
    }
    return { action: 'SEND', to: cfg.redirectTo, redirectedFrom: email === cfg.redirectTo ? null : email };
  }
  if (isAllowedDomain(domain, cfg.allowedDomains)) return { action: 'SEND', to: email, redirectedFrom: null };
  return { action: 'HOLD', reason: `Retenido (QAS): ${domain} no está en los dominios permitidos` };
}
