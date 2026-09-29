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

// Spec §19.1(6) y (8) bajo D-14 (DEV/LOCAL, aprobada 2026-09-29): ya NO son texto
// fijo. Se derivan de la corrida: rc del X-07 (cuya fase D14 hace la transición
// gobernada sin revertirla y verifica por GET), del paso masteradmin:d14-axes
// (eje de MasterAdmin) y de la evidencia <corrida>/d14/d14-<producto>.json
// (entitlementBlockers / billingBlockers de scripts/ccp/d14-evidence.mts).
const D14_AXES = MA('d14-axes');
const NO_BILLER = { met: true, reason: 'sin biller local: no aplica (spec §19.1(8))' };

function product({ code, steps, x07, legacyAuthority, checks, criteria, gaps, cutoverSteps = [], localBiller = false }) {
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
      6: { d14: 'entitlements', steps: [own(x07), D14_AXES, ...cutoverSteps],
        label: 'MASTERADMIN_PRIMARY (SaaS y MasterAdmin) verificado por GET; escritura legacy negada server-side' },
      8: localBiller
        ? { d14: 'billing', steps: [own(x07), D14_AXES, PGTAP],
          label: 'BILLING_SHADOW con diff material 0 calculado por MasterAdmin; sin doble cobro' }
        : NO_BILLER,
      'D14-2': { d14: 'appActive', steps: [own(x07)], label: 'appActive=false retira lo comercial, no la operación' },
      ...criteria,
    },
    gaps,
  };
}

export const PRODUCTS = {
  ecommerce: product({
    code: 'ecommerce', x07: 'x07', steps: { suite: ['test-db'] },
    legacyAuthority: 'sin biller comercial local (los pagos Culqi son del storefront del tenant); sin precios EBIM locales',
    checks: {
      5: { steps: [PGTAP, 'ecommerce:test-db'] },
      9: { steps: [USAGE, 'ecommerce:test-db'] },
      10: { steps: [USAGE, PGTAP] },
      11: { steps: [PGTAP, 'ecommerce:x07'], note: 'asignación ecommerce.ai.credits: el hard gate corta la 3ª llamada' },
      12: { na: 'sin biller comercial local; MasterAdmin reclama cada agregado una vez (pgTAP 41)' },
    },
    criteria: { 7: { steps: [USAGE] } },
    gaps: [
      { class: 'PRE_EXISTING', text: 'migración 20260827090600_storage_buckets (alter table storage.objects) no reconstruye desde cero en Supabase actual; la base de prueba real usa PGlite' },
      { class: 'UNRESOLVED_LEGACY', text: 'H-ECO-1: la clave estática de platform-context sigue sirviendo a tenants NO mapeados (legacy sin evidencia de adopción); para los mapeados PRIMARY la bloquea en base (FUENTE_LEGADA_BLOQUEADA)' },
    ],
  }),
  ewm: product({
    code: 'ewm', x07: 'x07', steps: { suite: ['suite'] }, cutoverSteps: ['ewm:supabase-guard'],
    legacyAuthority: 'sin biller comercial local',
    checks: {
      5: { steps: [PGTAP, 'ewm:x07', 'ewm:supabase-guard'], note: 'guarda Supabase D-14: admin_set_agent y la escritura directa por la API bloqueadas en PRIMARY; X-07 13: el reconciliador revierte (defensa en profundidad)' },
      9: { steps: ['ewm:suite'], note: 'emisor Java de uso (ITs de EWM); no está en usage-x07 (solo TS)' },
      10: { steps: ['ewm:suite', PGTAP] },
      11: { na: 'EWM no aplica asignaciones ni créditos en el SaaS (sin ALLOWANCE registrada, D-03)' },
      12: { na: 'sin biller comercial local' },
    },
    criteria: { 7: { steps: ['ewm:suite'] } },
    // YardVisitIT («too many clients»): el pool del contexto propio de PlatformEntitlementsIT; cerrado en EWM 601ebb5.
    gaps: [],
  }),
  comerza: product({
    code: 'comerza', x07: 'x07', steps: { suite: ['test-db'] },
    legacyAuthority: 'sin biller ni precio local; billable=false por CHECK',
    checks: {
      5: { steps: [PGTAP, 'comerza:test-db', 'comerza:x07'], note: 'X-07 15: flags del tenant en true no reviven un agente revocado' },
      9: { steps: [USAGE, 'comerza:test-db'] },
      10: { steps: [USAGE, 'comerza:test-db'] },
      11: { na: 'sin ALLOWANCE ni créditos registrados para Comerza (D-03/D-05)' },
      12: { na: 'sin biller local' },
    },
    criteria: { 7: { steps: [USAGE] } },
    gaps: [{ class: 'HUMAN_DECISION', text: 'tope del proveedor IA compartido (operator.ai_provider_budget) sin decidir: control operativo, no comercial; sin fila cuenta y no corta. No es prerequisito de cutover' }],
  }),
  tms: product({
    code: 'tms', x07: 'x07', steps: { suite: ['suite'] },
    legacyAuthority: 'sin biller ni precio local; registro vacío (solo baseline tms.core)',
    checks: {
      5: { steps: [PGTAP, 'tms:suite'], note: 'sin capacidades vendibles; tms_app deny-all sobre las tablas de entitlements' },
      9: { na: 'TMS no tiene medidor aprobado (fase 17)' },
      10: { na: 'TMS no tiene medidor aprobado (fase 17)' },
      11: { na: 'sin asignaciones ni créditos' },
      12: { na: 'sin biller local' },
    },
    criteria: { 7: { met: true, reason: 'sin medidores ACTIVE: no aplica' } },
    gaps: [{ class: 'HUMAN_DECISION', text: 'ADR 017 y V52 deben renumerarse al integrar ramas TMS no fusionadas' }],
  }),
  esupplier: product({
    code: 'esupplier', x07: 'x07', steps: { suite: ['sql-and-golden'] },
    legacyAuthority: 'sin biller local; plans.monthly_price local es precio legacy informativo (INV-4 hash)',
    checks: {
      5: { steps: [PGTAP, 'esupplier:sql-and-golden', 'esupplier:x07'], note: 'X-07 12: concesión legacy bloqueada en PRIMARY' },
      9: { steps: [USAGE, 'esupplier:sql-and-golden', 'esupplier:x07'] },
      10: { steps: [USAGE, 'esupplier:sql-and-golden'] },
      11: { steps: [PGTAP, 'esupplier:sql-and-golden'], note: 'créditos IA desde el outbox local (BLOCK; sin peso → deny)' },
      12: { na: 'sin biller local' },
    },
    criteria: { 7: { steps: [USAGE] } },
    gaps: [
      { class: 'PRE_EXISTING', text: 'tender-copilot/index.ts:338 no parsea en Deno (ef83f2c, en la base a61dd22)' },
      { class: 'PRE_EXISTING', text: '12 errores de deno check en _shared/authorize.ts, ai-chat, contract-ai (idénticos en la base)' },
      { class: 'HUMAN_DECISION', text: 'P-08 (LEGACY_BACKFILL) sigue pendiente: solo afecta a tenants legacy NO mapeados; en PRIMARY por cohorte los mapeados lo ignoran' },
    ],
  }),
  echange: product({
    code: 'echange', x07: 'x07', steps: { suite: ['pgtap', 'golden-parity'] },
    legacyAuthority: 'sin biller local (no hay funciones ni tablas de facturación)',
    checks: {
      5: { steps: [PGTAP, 'echange:x07'], note: 'X-07 14: escritura legacy del derecho bloqueada en PRIMARY; pgTAP del repo con 10 fallas PREEXISTENTES ajenas' },
      9: { steps: [USAGE, 'echange:x07'] },
      10: { steps: [USAGE, PGTAP] },
      11: { na: 'eChange no aplica créditos en el SaaS (D-03)' },
      12: { na: 'sin biller local' },
      13: { steps: ['echange:golden-parity', 'echange:x07'], note: 'sin biller local' },
      14: { steps: ['echange:golden-parity', 'echange:x07'] },
      15: { steps: [PROV, 'echange:x07'], note: 'X-07 0: alta real (CREATED) con la RPC de provisioning de eChange' },
    },
    criteria: { 7: { steps: [USAGE] } },
    gaps: [{ class: 'PRE_EXISTING', text: '10 aserciones pgTAP: EXECUTE de anon/authenticated sobre 5 funciones DEFINER de portal/adjuntos/línea de tiempo (idénticas en la base 3d6f34e)' }],
  }),
  eexpense: product({
    code: 'eexpense', x07: 'x07', steps: { suite: ['pgtap', 'golden'] }, localBiller: true,
    legacyAuthority: 'biller local billing-run; eje private.billing_authority por tenant',
    checks: {
      5: { steps: [PGTAP, 'eexpense:pgtap', 'eexpense:x07'] },
      9: { steps: [USAGE, 'eexpense:x07'] },
      10: { steps: [USAGE, 'eexpense:pgtap'] },
      11: { steps: [PGTAP, 'eexpense:pgtap'] },
      12: { steps: [PGTAP, 'eexpense:x07', 'eexpense:pgtap'], note: 'en SHADOW el biller local no factura ni cobra y MasterAdmin no emite (nunca dos cobradores)' },
    },
    criteria: { 7: { steps: [USAGE] } },
    gaps: [{ class: 'PRE_EXISTING', text: 'npm run lint falla: eslint no instalado (también en la base f282dc4)' }],
  }),
  gmao: product({
    code: 'gmao', x07: 'x07', steps: { suite: ['sql', 'deno'] }, localBiller: true,
    legacyAuthority: 'biller local charge; private.commercial_authority por producto/eje/tenant; hub:<app>=LEGACY_AUTHORITY (hub fuera de 8/8, spec §19.2)',
    checks: {
      5: { steps: [PGTAP, 'gmao:sql', 'gmao:x07'] },
      9: { steps: [USAGE, 'gmao:sql'] },
      10: { steps: [USAGE, 'gmao:sql'] },
      11: { steps: [PGTAP, 'gmao:deno'], note: 'ALLOWANCE_NOT_DEFINED fail-closed; cuota desde snapshot' },
      12: { steps: [PGTAP, 'gmao:x07', 'gmao:deno'], note: 'en SHADOW el charge local es el único cobrador y MasterAdmin no emite; charge → 409 en MA+' },
    },
    criteria: { 7: { steps: [USAGE] } },
    gaps: [{ class: 'LOCAL_INFRA_ONLY', text: 'sin esquema base versionado: `db reset` imposible; PGlite sobre el esquema capturado es el harness' }],
  }),
};
