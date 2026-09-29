// ============================================================================
// EBIM Commercial Control Plane · Fase 18 · matriz de certificación (MA-62)
// ----------------------------------------------------------------------------
// Qué pasos de certify-local.sh evidencian cada uno de los 15 checks del
// prompt 18, por producto, y el estado de los criterios de spec §19.1 que NO
// son tests (modo de cutover, autoridad legacy, decisiones humanas).
//
// Criterios con `steps` se evalúan contra la corrida; criterios con `met`
// fijo describen estado persistido que un test no puede cambiar (p. ej. el
// modo sembrado). Fuente de cada hecho: evidencia de la fase del producto.
// ============================================================================

export const CHECKS = {
  1: 'canonical MasterAdmin mapping',
  2: 'desired entitlement generated',
  3: 'SaaS applied same version/checksum',
  4: 'GET same applied state',
  5: 'tenant self-grant denied',
  6: 'add/remove/downgrade version transition',
  7: 'offline last-good',
  8: 'drift reconciled',
  9: 'usage event accepted once',
  10: 'duplicate deduped',
  11: 'allowance/credit arithmetic',
  12: 'no duplicate billing',
  13: 'local price/billing authority stage explicit',
  14: 'technical configuration still works',
  15: 'CREATE/REPLAY/GET provisioning regression green',
};

const MA = (s) => `masteradmin:${s}`;
const PGTAP = MA('pgtap');
const SYNC = MA('entitlement-sync-e2e');
const USAGE = MA('usage-x07');
const PROV = MA('provisioning-golden');

// Spec §19.1(6): el eje de entitlements debe estar en MASTERADMIN_PRIMARY en el
// entorno y con las escrituras legacy bloqueadas. Todos los productos cierran
// sus fases en SHADOW (GMAO: DUAL_READ); PRIMARY solo se ejercita dentro de
// cada X-07 y vuelve atrás. Avanzar el estado persistido exige D-14.
const CUTOVER = (mode, extra = []) => ({
  met: false,
  reason: `entitlements sembrado en ${mode}, no MASTERADMIN_PRIMARY; avanzar requiere D-14 (ventanas de observación) ${
    extra.length ? `y además: ${extra.join('; ')}` : ''}`.trim(),
});
const NO_BILLER = { met: true, reason: 'sin biller local: no aplica (spec §19.1(8))' };

function product({ code, steps, x07, legacyAuthority, checks, criteria, gaps }) {
  const own = (s) => `${code}:${s}`;
  const base = {
    1: { steps: [PGTAP, own(x07)] },
    2: { steps: [PGTAP, SYNC, own(x07)] },
    3: { steps: [own(x07)] },
    4: { steps: [SYNC, own(x07)] },
    6: { steps: [own(x07)] },
    7: { steps: [own(x07)] },
    8: { steps: [SYNC, own(x07)] },
    12: { steps: [PGTAP] },
    13: { steps: steps.suite.map(own), note: legacyAuthority },
    14: { steps: steps.suite.map(own) },
    15: { steps: [PROV, ...steps.suite.map(own)] },
  };
  return {
    legacyAuthority,
    checks: { ...base, ...checks },
    criteria: {
      1: { met: true, reason: 'P0 del §1.4 cerrados en fases 03–06 con test' },
      2: { steps: [own(x07)] },
      3: { steps: [PGTAP, own(x07)] },
      4: { steps: [SYNC, own(x07)] },
      5: { steps: [own(x07)] },
      ...criteria,
    },
    gaps,
  };
}

export const PRODUCTS = {
  ecommerce: product({
    code: 'ecommerce', x07: 'x07', steps: { suite: ['test-db'] },
    legacyAuthority: 'entitlements SHADOW (platform_entitlements); sin biller comercial local (los pagos Culqi son del storefront del tenant); sin precios EBIM locales',
    checks: {
      5: { steps: [PGTAP, 'ecommerce:test-db'] },
      9: { steps: [USAGE, 'ecommerce:test-db'] },
      10: { steps: [USAGE, PGTAP] },
      11: { steps: [PGTAP, 'ecommerce:x07'], note: 'asignación ecommerce.ai.credits: el hard gate corta la 3ª llamada' },
      12: { na: 'sin biller comercial local; MasterAdmin reclama cada agregado una vez (pgTAP 41)' },
    },
    criteria: { 6: CUTOVER('SHADOW', ['unificar criterio appActive=false (eCommerce cierra operación)']),
      7: { steps: [USAGE] }, 8: NO_BILLER },
    gaps: [{ class: 'PRE_EXISTING', text: 'migración 20260827090600_storage_buckets (alter table storage.objects) no reconstruye desde cero en Supabase actual; la base de prueba real usa PGlite' }],
  }),
  ewm: product({
    code: 'ewm', x07: 'x07', steps: { suite: ['suite'] },
    legacyAuthority: 'entitlements SHADOW (V49, por producto/contrato); sin biller comercial local',
    checks: {
      5: { steps: [PGTAP, 'ewm:x07'], note: 'X-07 13: escritura legacy admin_set_agent en PRIMARY detectada y revertida' },
      9: { steps: ['ewm:suite'], note: 'emisor Java de uso (ITs de EWM); no está en usage-x07 (solo TS)' },
      10: { steps: ['ewm:suite', PGTAP] },
      11: { na: 'EWM no aplica asignaciones ni créditos en el SaaS (sin ALLOWANCE registrada, D-03)' },
      12: { na: 'sin biller comercial local' },
    },
    criteria: { 6: CUTOVER('SHADOW', ['bloqueo server-side de admin_set_agent en PRIMARY exige migración Supabase autorizada (Dennis)', 'unificar appActive=false']),
      7: { steps: ['ewm:suite'] }, 8: NO_BILLER },
    // YardVisitIT («too many clients»): el pool del contexto propio de PlatformEntitlementsIT; cerrado en EWM 601ebb5.
    gaps: [],
  }),
  comerza: product({
    code: 'comerza', x07: 'x07', steps: { suite: ['test-db'] },
    legacyAuthority: 'entitlements SHADOW (operator.*); sin biller ni precio local; billable=false por CHECK',
    checks: {
      5: { steps: [PGTAP, 'comerza:test-db', 'comerza:x07'], note: 'X-07 15: flags del tenant en true no reviven un agente revocado' },
      9: { steps: [USAGE, 'comerza:test-db'] },
      10: { steps: [USAGE, 'comerza:test-db'] },
      11: { na: 'sin ALLOWANCE ni créditos registrados para Comerza (D-03/D-05)' },
      12: { na: 'sin biller local' },
    },
    criteria: { 6: CUTOVER('SHADOW', ['decidir tope del proveedor compartido', 'unificar appActive=false']),
      7: { steps: [USAGE] }, 8: NO_BILLER },
    gaps: [],
  }),
  tms: product({
    code: 'tms', x07: 'x07', steps: { suite: ['suite'] },
    legacyAuthority: 'entitlements SHADOW (V52); sin biller ni precio local; registro vacío (solo baseline tms.core)',
    checks: {
      5: { steps: [PGTAP, 'tms:suite'], note: 'sin capacidades vendibles; tms_app deny-all sobre las tablas de entitlements' },
      9: { na: 'TMS no tiene medidor aprobado (fase 17)' },
      10: { na: 'TMS no tiene medidor aprobado (fase 17)' },
      11: { na: 'sin asignaciones ni créditos' },
      12: { na: 'sin biller local' },
    },
    criteria: { 6: CUTOVER('SHADOW', ['criterio appActive=false: TMS suspende la operación y otros productos solo lo comercial']),
      7: { met: true, reason: 'sin medidores ACTIVE: no aplica' }, 8: NO_BILLER },
    gaps: [{ class: 'HUMAN_DECISION', text: 'ADR 017 y V52 deben renumerarse al integrar ramas TMS no fusionadas' }],
  }),
  esupplier: product({
    code: 'esupplier', x07: 'x07', steps: { suite: ['sql-and-golden'] },
    legacyAuthority: 'entitlements SHADOW (public.platform_entitlement_*); sin biller local; plans.monthly_price local es precio legacy informativo (INV-4 hash)',
    checks: {
      5: { steps: [PGTAP, 'esupplier:sql-and-golden', 'esupplier:x07'], note: 'X-07 12: concesión legacy bloqueada en PRIMARY' },
      9: { steps: [USAGE, 'esupplier:sql-and-golden', 'esupplier:x07'] },
      10: { steps: [USAGE, 'esupplier:sql-and-golden'] },
      11: { steps: [PGTAP, 'esupplier:sql-and-golden'], note: 'créditos IA desde el outbox local (BLOCK; sin peso → deny)' },
      12: { na: 'sin biller local' },
    },
    criteria: { 6: CUTOVER('SHADOW', ['adoptar tenants legacy sin mapping de provisioning (o PRIMARY por tenant)', 'unificar appActive=false', 'P-08']),
      7: { steps: [USAGE] }, 8: NO_BILLER },
    gaps: [
      { class: 'PRE_EXISTING', text: 'tender-copilot/index.ts:338 no parsea en Deno (ef83f2c, en la base a61dd22)' },
      { class: 'PRE_EXISTING', text: '12 errores de deno check en _shared/authorize.ts, ai-chat, contract-ai (idénticos en la base)' },
    ],
  }),
  echange: product({
    code: 'echange', x07: 'x07', steps: { suite: ['pgtap', 'golden-parity'] },
    legacyAuthority: 'entitlements SHADOW (privado.*); sin biller local (no hay funciones ni tablas de facturación)',
    checks: {
      5: { steps: [PGTAP, 'echange:x07'], note: 'X-07 14: escritura legacy del derecho bloqueada en PRIMARY; pgTAP del repo con 10 fallas PREEXISTENTES ajenas' },
      9: { steps: [USAGE, 'echange:x07'] },
      10: { steps: [USAGE, PGTAP] },
      11: { na: 'eChange no aplica créditos en el SaaS (D-03)' },
      12: { na: 'sin biller local' },
      13: { steps: ['echange:golden-parity', 'echange:x07'], note: 'entitlements SHADOW; sin biller local' },
      14: { steps: ['echange:golden-parity', 'echange:x07'] },
      15: { steps: [PROV, 'echange:x07'], note: 'X-07 0: alta real (CREATED) con la RPC de provisioning de eChange' },
    },
    criteria: { 6: CUTOVER('SHADOW', ['adoptar tenants pre-MasterAdmin', 'unificar appActive=false']),
      7: { steps: [USAGE] }, 8: NO_BILLER },
    gaps: [{ class: 'PRE_EXISTING', text: '10 aserciones pgTAP: EXECUTE de anon/authenticated sobre 5 funciones DEFINER de portal/adjuntos/línea de tiempo (idénticas en la base 3d6f34e)' }],
  }),
  eexpense: product({
    code: 'eexpense', x07: 'x07', steps: { suite: ['pgtap', 'golden'] },
    legacyAuthority: 'entitlements SHADOW; eje de facturación private.billing_authority en LEGACY_AUTHORITY para todo tenant (biller local billing-run activo)',
    checks: {
      5: { steps: [PGTAP, 'eexpense:pgtap', 'eexpense:x07'] },
      9: { steps: [USAGE, 'eexpense:x07'] },
      10: { steps: [USAGE, 'eexpense:pgtap'] },
      11: { steps: [PGTAP, 'eexpense:pgtap'] },
      12: { steps: [PGTAP, 'eexpense:x07', 'eexpense:pgtap'], note: 'X-07 21: en MASTERADMIN_AUTHORITY el biller local no factura ni cobra (nunca dos cobradores)' },
    },
    criteria: { 6: CUTOVER('SHADOW', ['adoptar tenants pre-MasterAdmin', 'P-05: sin QAS separado de producción']),
      7: { steps: [USAGE] },
      8: { met: false, reason: 'biller local en LEGACY_AUTHORITY; BILLING_SHADOW con diff 0 solo se demuestra dentro del X-07 (D-14)' } },
    gaps: [{ class: 'PRE_EXISTING', text: 'npm run lint falla: eslint no instalado (también en la base f282dc4)' }],
  }),
  gmao: product({
    code: 'gmao', x07: 'x07', steps: { suite: ['sql', 'deno'] },
    legacyAuthority: 'private.commercial_authority: gmao ENTITLEMENTS=DUAL_READ, BILLING=LEGACY_AUTHORITY (charge local activo); hub:<app>=LEGACY_AUTHORITY',
    checks: {
      5: { steps: [PGTAP, 'gmao:sql', 'gmao:x07'] },
      9: { steps: [USAGE, 'gmao:sql'] },
      10: { steps: [USAGE, 'gmao:sql'] },
      11: { steps: [PGTAP, 'gmao:deno'], note: 'ALLOWANCE_NOT_DEFINED fail-closed; cuota desde snapshot' },
      12: { steps: [PGTAP, 'gmao:x07', 'gmao:deno'], note: 'charge → 409 en MA+; nunca dos cobradores' },
    },
    criteria: { 6: CUTOVER('DUAL_READ', ['D-03 (tenant con IA no puede llegar a MA sin decidir gmao.ai.requests)', 'P-05: sin QAS separado', 'esquema vivo del hub sin verificar']),
      7: { steps: [USAGE] },
      8: { met: false, reason: 'biller local en LEGACY_AUTHORITY; SHADOW de facturación solo dentro del X-07 (D-14)' } },
    gaps: [{ class: 'LOCAL_INFRA_ONLY', text: 'sin esquema base versionado: `db reset` imposible; PGlite sobre el esquema capturado es el harness' }],
  }),
};
