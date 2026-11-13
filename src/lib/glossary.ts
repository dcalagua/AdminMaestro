/**
 * Glosario de negocio de la consola (V5 · F1, plan §3.4 y §5).
 *
 * La UI de negocio habla el idioma del trabajo, no el de la base de datos ni el
 * de los contratos técnicos. Cada término técnico tiene UNA traducción, y se usa
 * siempre la misma en menús, títulos, botones, estados vacíos, avisos y toasts.
 * Lo técnico que un super admin necesite (códigos de API, nombres de vistas,
 * referencias a contratos) va a un tooltip o a la pestaña «Avanzado».
 *
 * Fuente única: `docs/design/GLOSARIO_V6.md` documenta las mismas entradas y el
 * test `glossary.test.ts` vigila que los términos prohibidos no vuelvan a
 * aparecer en los textos visibles.
 */
export interface GlossaryEntry {
  /** Término técnico (como aparece en código, base o contrato). */
  technical: string;
  /** Término de negocio que ve la persona. */
  business: string;
  /** Variante en plural, cuando no es trivial. */
  plural?: string;
  /** Cuándo y cómo usarlo. */
  note: string;
}

export const GLOSSARY = {
  dryRun: {
    technical: 'DRY_RUN',
    business: 'Simulación',
    note: 'Modo en que la orden se registra sin llamar a la app. «En simulación», «se envía en simulación».',
  },
  provisioning: {
    technical: 'Provisioning',
    business: 'Alta en la app',
    plural: 'Altas en las apps',
    note: 'Crear el espacio del cliente en una app de la suite. Para la cola de infraestructura: «Solicitudes de infraestructura».',
  },
  entitlements: {
    technical: 'Entitlements',
    business: 'Módulos habilitados',
    note: 'Lo que el plan y los add-ons le permiten usar al cliente en una app. Un elemento suelto: «módulo habilitado».',
  },
  cutover: {
    technical: 'Cutover',
    business: 'Migración de cobro',
    note: 'El paso a paso con el que una app deja de cobrar por su cuenta y pasa a cobrar desde el Admin Maestro.',
  },
  slug: {
    technical: 'Slug',
    business: 'Código',
    note: 'Identificador corto en minúsculas y guiones que aparece en enlaces y URLs.',
  },
  shadow: {
    technical: 'Shadow',
    business: 'Comparación',
    note: 'Etapa en que el cobro nuevo se calcula en paralelo y se compara con el de la app, sin cobrar. «Comparación de cobro».',
  },
  m2m: {
    technical: 'M2M',
    business: 'Conexión segura',
    note: 'La conexión firmada entre el Admin Maestro y cada app (servidor a servidor).',
  },
  // V6 · T7
  masterAdmin: {
    technical: 'MasterAdmin / Control Plane',
    business: 'Admin Maestro',
    note: 'El nombre del producto: «en el Admin Maestro», «al Admin Maestro».',
  },
  target: {
    technical: 'Deployment target',
    business: 'Destino',
    plural: 'Destinos',
    note: 'Dónde corre el tenant: «destino dedicado», «destino compartido».',
  },
  webhook: {
    technical: 'Webhook',
    business: 'Aviso del proveedor',
    plural: 'Avisos del proveedor',
    note: 'Lo que la pasarela de pago nos notifica.',
  },
  pool: {
    technical: 'Pool',
    business: 'Bolsa',
    note: 'Bolsa de créditos IA de un tenant o de un producto.',
  },
  scope: {
    technical: 'Scope',
    business: 'Permiso',
    plural: 'Permisos',
    note: 'Lo que un token puede hacer en la app. El valor técnico se muestra tal cual en mono.',
  },
  ingest: {
    technical: 'Ingest',
    business: 'Conexión de uso',
    note: 'El canal por el que cada app envía sus eventos de uso.',
  },
  tenant: {
    technical: 'Tenant',
    business: 'Tenant',
    note: 'Se mantiene como término (decisión pendiente del dueño). En textos largos, «espacio del cliente en la app» cuando ayude.',
  },
} as const satisfies Record<string, GlossaryEntry>;

export type GlossaryKey = keyof typeof GLOSSARY;

/** Término de negocio para una clave del glosario. */
export function term(key: GlossaryKey, options: { plural?: boolean; lower?: boolean } = {}): string {
  const entry: GlossaryEntry = GLOSSARY[key];
  const text = options.plural && entry.plural ? entry.plural : entry.business;
  return options.lower ? text.charAt(0).toLowerCase() + text.slice(1) : text;
}

/**
 * Jerga que NO debe verse en la UI de negocio (plan §3.4). Se buscan como
 * palabra en los textos visibles; los identificadores de código no cuentan.
 */
export const FORBIDDEN_UI_TERMS: ReadonlyArray<RegExp> = [
  /\bDRY_RUN\b/,
  /\b[Pp]rovisioning\b/,
  /\b[Ee]ntitlements?\b/,
  /\b[Cc]utover\b/,
  /\b[Ss]lug\b/,
  /\b[Ss]hadow\b/,
  /\bM2M\b/,
  // Referencias a contratos, specs o runbooks («contrato §4.4», «spec §12.7»).
  /§/,
  // V6 · T7: jerga que el glosario V5 no vigilaba (plan V6 §0 y §2).
  /\b[Ll]egacy\b/,
  /\b[Ii]ngest\b/,
  /\bGET\b/,
  /\b[Cc]hecksum\b/,
  /\b[Ll]edger\b/,
  /\b[Pp]ool\b/,
  /\b[Tt]argets?\b/,
  /\b[Ss]copes?\b/,
  /\b[Ll]ockup\b/,
  /\b[Oo]ne-time\b/,
  /\b[Dd]eployments?\b/,
  /\b[Ww]ebhooks?\b/,
  /\bMasterAdmin\b/,
  /\bControl Plane\b/,
  /\b[Jj]obs?\b/,
  /\b[Bb]iller\b/,
  /\bAuth\b/,
  // Referencias a decisiones o KPI internos: «(D-06)», «hasta D-12», «(K05)».
  /\bD-\d{2}\b/,
  /\(K\d{2}\)/,
];

/**
 * Nombres de objetos de la base (vistas, RPC, tablas) en un texto visible:
 * `v_subscription_mrr`, `executive_mrr_series`, `platform.invoice_summary`,
 * `commercial_cutover_events`. Se evalúan ANTES de quitar identificadores.
 */
export const SQL_OBJECT_NAME = /\b(?:v_[a-z0-9_]+|executive_[a-z_]+|platform\.[a-z_]+|[a-z]+_[a-z]+_[a-z][a-z_]*)\b/;
