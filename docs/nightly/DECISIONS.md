# DECISIONS — EBIM Control Plane

Registro de decisiones técnicas tomadas de forma autónoma durante la ejecución nocturna.

## D-001 — PROJECT_ROOT fuera del path de GUIDELINES

El prompt maestro (§0) exige que el proyecto viva dentro de
`.../My Drive/EBIM-Plataforma`. La instrucción explícita del operador en esta sesión fija
`PROJECT_ROOT = /Users/.../EBIM/masteradmin` y declara `EBIM-Plataforma` como **READ-ONLY**.

**Decisión:** se respeta la instrucción del operador (es más restrictiva sobre GUIDELINES y por
tanto más segura). Se trabaja exclusivamente en `masteradmin/`; no se escribe **ni un byte** en
`EBIM-Plataforma`. El gate `FILESYSTEM_GUARDRAILS` se evalúa contra esta regla.

**Riesgo asumido:** el proyecto no queda sincronizado por Google Drive. Mitigación: repo git local
con branch de trabajo; mover/clonar es trivial.

## D-002 — Package manager: npm

`pnpm` no está instalado. El prompt maestro dice "pnpm si ya está disponible, si no npm, y no
cambiar a mitad". → **npm 11.17.0** para toda la noche.

## D-003 — Node fuera del PATH

`node` sólo existe en `~/.nvm/versions/node/v24.19.0/bin` y el PATH del shell no lo incluye.
Se documenta en README y se añade `.nvmrc`. Todos los comandos de la noche exportan el PATH.

## D-004 — Tailwind en vez de MUI

Las apps de la suite usan MUI. El prompt maestro fija Tailwind. Se elige **Tailwind + primitivos
propios**, replicando los *tokens* EBIM (color, DM Sans, densidad, accent/accent-deep, dark mode)
y la anatomía de login del contrato §4.5. La convención de suite es de tokens y anatomía, no de
librería. Ver `docs/architecture/EBIM_CONVENTIONS.md` §3.

## D-005 — Schema `platform` en vez de `public`

Todo el plano de control vive en el schema `platform`, igual que el hub de identidad EBIM
(contrato §1/§7 y `EBIM-DISENO-HUB-IDENTIDAD.md` §1). `public` queda vacío de negocio.
Se expone `platform` a PostgREST vía `db.schemas` en `config.toml`.

## D-006 — `organizations` con capacidades por relación, no con un enum rígido

El prompt maestro pide que una organización pueda ser owner/partner/reseller/customer o combinar
capacidades. Se modela con:
- `organizations.kind` (PLATFORM | COMPANY) — sólo distingue a EBIM del resto;
- `organization_capabilities` (N filas por organización: PARTNER, RESELLER, CUSTOMER, CONSULTING);
- `organization_relationships` (aristas MANAGES / RESELLS_TO / SUBCONTRACTS con vigencia).

Así "Consultora Andina" es partner **y** cliente sin tocar el schema.

## D-007 — `tenants` como unidad SaaS, `companies` como sociedad legal

Se mantienen ambos conceptos del contrato:
- `organizations` = cuenta que compra y se factura;
- `companies` = sociedad legal multipaís bajo la organización (contrato §3.1 Modelo A);
- `tenants` = espacio de **un producto SaaS** para una organización cliente.

`tenants.customer_organization_id` + `tenants.managing_organization_id` (partner) implementan el
modelo partner **sin** `parent_tenant_id` (prompt fase 5).

## D-008 — Roles: enum de rol + scope, no un enum plano

`platform_role` (EBIM_SUPER_ADMIN, EBIM_PRODUCT_ADMIN, EBIM_FINANCE) vive en `platform_admins`.
Los roles de organización (PARTNER_ADMIN/SALES/SUPPORT) viven en `organization_memberships.role`,
y los de tenant (TENANT_ADMIN/TENANT_USER) en `tenant_memberships.role`. `SALES_AGENT` se resuelve
por `sales_agents.user_id`. Cada scope tiene su tabla → RLS simple y sin recursión.

## D-009 — Helpers RLS `SECURITY DEFINER` con `search_path` fijo

Todos los helpers (`platform.is_platform_admin()`, `platform.is_org_member()`, etc.) son
`security definer`, `set search_path = platform, pg_catalog`, `stable`, y se les revoca `EXECUTE`
de `anon`. Evita recursión de políticas (una política de `organizations` que consulte
`organization_memberships`, que a su vez tiene RLS).

## D-010 — Dinero en `numeric(14,2)` + `currency char(3)`

Nunca `float`. Cada tabla monetaria lleva su `currency` explícita. Los agregados de dashboard
agrupan por moneda; no se hace conversión FX implícita (se documenta como deuda).

## D-011 — Comisión desde eventos de cobro, no desde el alta de tenant

`commission_events` se generan desde `payments` aplicados a `invoice_lines` elegibles, vía la
función `platform.generate_commission_events(payment_id)`. Una factura DRAFT/VOID nunca genera
comisión. Idempotencia por `unique (payment_id, sales_attribution_id, commission_rule_id)`.

## D-012 — Provisioning DRY_RUN por defecto

`PROVISIONING_MODE=DRY_RUN`. La Edge Function `provisioning-worker` implementa una interfaz
`ProvisioningProvider` con dos implementaciones: `DryRunProvider` (activa) y
`SupabaseManagementProvider` (esqueleto, exige `SUPABASE_MANAGEMENT_TOKEN` desde secrets del
servidor). La UI **nunca** recibe ese token. Ninguna llamada remota real se ejecuta esta noche.

## D-013 — V6: pestañas centradas (no se aplica T3) y cabecera única de los hubs

Decisión del dueño (2026-11-13, plan `docs/design/PLAN_MEJORA_UI_UX_V6.md` §2 T3): las pestañas de
sección **siguen centradas** por la regla de suite `gmao-025`; `TabStrip` no cambia de alineación.
El hueco de Cuentas y del resto de hubs se resuelve con T1: el `PageContainer` incrustado lleva sus
acciones a la cabecera del hub (portal, junto al título) y su descripción a un «¿Qué es esto?»
(`InfoHint`) junto al `h1`; la descripción de la entrada en `navigation.ts` es de una línea (≤ 90
caracteres, vigilado por test). F5 no debe reabrir la alineación sin una nueva decisión del dueño.

## D-014 — V6: franjas compactas por defecto y jerga técnica solo en «Avanzado»

`KpiStrip` pasa a `src/components/ui/StatStrip.tsx` como alias de `StatStrip`, compacta (`band`,
~72 px) por defecto: un `KpiTile` dentro de una banda se pinta como `StatCell`. Las tarjetas grandes
con sparkline quedan solo donde la tendencia aporta (`variant="tiles"`: Facturación, Costos,
Comisiones; Resumen ejecutivo usa sus propias tarjetas). El glosario V6 (`docs/design/GLOSARIO_V6.md`)
amplía la lista negra; la guardia excluye `src/features/billing/shadow/` (Configuración › Avanzado).

## D-015 — V6 · F5: móvil con `select`, componentes promovidos y guarda de solapes

- **Pestañas en móvil:** por debajo de 640 px, una fila de `TabStrip` (hub o ficha) o de `StatusTabs` que no cabe en el ancho
  se pinta como `select` nativo con el mismo nombre accesible. Se descartó el scroll horizontal (recorta etiquetas: «uración y
  cobros») y las dos filas (A08/A09). La estimación es sin medir (~7.5 px por carácter) para no parpadear; en escritorio no
  cambia nada y las pestañas siguen centradas (D-013).
- **Un solo segundo nivel:** `SubSections` (Configuración) y `SegmentedSections` (Finanzas) eran el mismo patrón; quedan en
  `src/components/ui/SubSections.tsx`. El `#hash` se reescribe con `history.replaceState` (sin salto ni entrada de historial).
- **Promovidos a `ui`:** `DetailFacts`, `ChartFrame`, `Combobox` (antes `ContractCombobox`) y `EmptyChartLine`.
- **«No decidido»** ya no muestra el código interno (D-xx): queda en `data-decision` y en el código; el `title` explica que
  finanzas aún no fijó el valor.
- **Guarda visual** `e2e/visual/solapes.spec.ts` + `playwright.visual.config.ts`: corre contra cualquier URL servida (no
  necesita Docker), con credenciales por variables de entorno (nunca en el repo). Criterio: 0 hallazgos a 1440 y 390.
- **Sin backend nuevo:** todo usa vistas y RPC existentes; `supabase/` sin cambios.

