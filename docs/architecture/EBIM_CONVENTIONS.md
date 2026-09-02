# Convenciones EBIM adoptadas por Control Plane

> Fuente: `GUIDELINES_ROOT` (READ-ONLY)
> `/Users/edudavidmorenoccama/Library/CloudStorage/GoogleDrive-gep.soporteit@gmail.com/My Drive/EBIM-Plataforma`
> Documentos revisados: `EBIM-CONTRATO-PLATAFORMA.md` (v1.15, fuente de verdad),
> `EBIM-DISENO-HUB-IDENTIDAD.md`, `EBIM-DESIGN-BRIEF.md`, `EBIM-PLATAFORMA-INDEX.md`,
> `EBIM-CREW-ROSTER.md`, `plantillas/CLAUDE-eExpense.md`,
> `Estado de Suite/EBIM-ESTADO-{GMAO,eSupplier,eExpense,eChange}.md`, `operador/RUNBOOK-OPERADOR.md`.
>
> **Ningún archivo de GUIDELINES_ROOT fue modificado.** Solo lectura.

---

## 1. Qué es EBIM Control Plane frente al contrato de plataforma

El contrato EBIM describe un **hub de identidad/plataforma** (schema `platform`, hoy dentro del
proyecto Supabase de GMAO) que las apps (GMAO, eExpense, eSupplier, eChange, WMS/TMS, GMAO...)
consumen vía *Platform Context API* y SSO.

**EBIM Control Plane es la consola de gobierno de ese hub**: administra el catálogo de SaaS,
organizaciones, partners/resellers, clientes, tenants, comerciales, licencias, comisiones,
costos, márgenes, despliegues y auditoría. **No** almacena datos operativos de las apps
(proveedores, OTs, gastos): eso vive en cada proyecto de app (contrato §7 "regla de oro").

Por eso el Control Plane implementa el schema `platform` (nombres del contrato) y le añade el
plano **comercial/financiero/de provisioning** que el contrato menciona pero no detalla
(`subscriptions`, `invoices`, `payments`, comisiones, costos, deployment targets).

---

## 2. Convenciones adoptadas (y de dónde salen)

### 2.1 Datos / PostgreSQL

| # | Convención | Origen |
|---|---|---|
| C-01 | Schema dedicado **`platform`** para el plano de control; nada en `public` salvo lo estrictamente expuesto | contrato §1, §7; GMAO §4 |
| C-02 | IDs canónicos **`uuid`** (`gen_random_uuid()`); PKs internas pueden variar pero las referencias org/company son uuid | contrato §8 |
| C-03 | Nombres de columna exactos **`organization_id`**, **`company_id`** — sin variantes | contrato §8 |
| C-04 | `company_code`/`erp_code` es **atributo**, nunca clave de sociedad (se repite entre países) | contrato §8 |
| C-05 | **RLS activada en toda tabla expuesta**, con *default deny* | contrato §8; §3 |
| C-06 | Columnas comerciales (precio, plan, límites) protegidas con **GRANT por columna**, no solo RLS ("RLS decide filas, no columnas") | contrato §2.6 lección 1, §3.2 aviso lateral |
| C-07 | Nunca confiar en `org_id`/`company_id` del body: del JWT / de la sesión de DB | contrato §8, §2.2 |
| C-08 | Config en 3 capas con **deep merge** JSONB: default plataforma → organización → sociedad; función `effective_config()` | hub §2, contrato §4 |
| C-09 | `custom_fields[]` con shape canónico (`key/label/type/required/options/hint/processes/active`), *integridad-first* | contrato §4.2 |
| C-10 | Alta de tenant **exige correo de administrador**, validado **en la función de base** (no solo UI/edge). Error canónico `ADMIN_EMAIL_REQUERIDO` | contrato §3.2 |
| C-11 | Nombres canónicos de pricing multi-sociedad: `included_companies`, addon `extra_company`, `multi_country`, `consolidation`, `addon.scope ∈ {org-wide, per-company}` | contrato §11.1 |
| C-12 | Addons/catálogo centralizados (`catalog_items`, activación por sociedad); las apps **leen** del hub, no definen su propio catálogo | contrato §5, §6 |
| C-13 | `SECURITY DEFINER` sólo cuando es necesario, con `search_path` explícito y permisos mínimos | contrato §8 + práctica eSupplier (auditoría RLS→RPC) |
| C-14 | Migraciones versionadas `YYYYMMDDHHMMSS_descripcion.sql` | práctica GMAO (`20260813120000_require_admin_email_provision_tenant.sql`) |
| C-15 | Dinero: `numeric(14,2)` + `currency char(3)`; nunca float binario | contrato §4.1 (`fiscal.currency`) + buenas prácticas |
| C-16 | `audit_log` append-only real (no "por convención"): el COMMENT debe reflejar el enforcement | contrato §14 (lección `esupplier-030`) |

### 2.2 Identidad / seguridad

| # | Convención | Origen |
|---|---|---|
| S-01 | **Super Admin único de la suite = `dcalagua@ebim.pe`**. No asignable, no transferible, doble capa (UI + servidor 403 aunque venga forzado en el body) | contrato §13 |
| S-02 | **Dominio operador único = `ebim.pe`**. `grupoebim.com` es dominio de negocio normal. Lista bloqueada = `["ebim.pe"]` | contrato §13.2 |
| S-03 | Roles de consola (`superadmin`, `operador`, `soporte`, `comercial`) **invisibles/no asignables** desde la UI de un tenant | contrato §13.2 |
| S-04 | Datos de prueba = fixtures QA descartables (`*@ebim.test`); nunca cuentas reales de operador o cliente | contrato §11 (gobernanza de datos) |
| S-05 | `service_role` y secretos **sólo server-side** (Edge Function secrets / env del operador). Nunca en Drive, nunca en el repo, nunca en el frontend | hub §6; contrato §14 |
| S-06 | Identidad de **terceros externos** (proveedores) es local a cada app; el hub sólo modela cuentas-cliente y sus empleados | contrato §2.5 |
| S-07 | Integración app-a-app: endpoint **separado** (límite físico, no una rama condicional); credencial en cabecera, nunca en URL; **tenant derivado de la credencial**, nunca del payload (si viene → 400) | contrato §2.6 |
| S-08 | Ningún compromiso contractual (SLA/prioridad) puede depender de un modelo de IA sin confianza declarada + umbral de revisión humana | contrato §2.6 lección 2 |

### 2.3 Frontend / UX

| # | Convención | Origen |
|---|---|---|
| U-01 | Marca: verde EBIM **`#5AA97F`**, teal **`#056769`**, isotipo teal oscuro `#0A5A52`; tipografía **DM Sans** | DESIGN-BRIEF §2; contrato §4.6 |
| U-02 | **Isotipo EBIM inline SVG** (swirl de 6 figuras, `viewBox 200 200`, `fill` configurable) + lockup `<App>` / `BY EBIM` (9.5px/700, `letter-spacing .22em`, opacity .85). Favicon = mismo isotipo | contrato §4.6 |
| U-03 | Animación "gira y para" del isotipo: 1 vuelta, `3.6s cubic-bezier(.66,0,.2,1)`, **respeta `prefers-reduced-motion`** | contrato §4.6 |
| U-04 | **Anatomía de login obligatoria**: tarjeta flotante `radius 22px`, grid `1fr 1fr`, `max-width 1000`, `min-height 580`, sombra teñida de marca; panel izquierdo (isotipo → wordmark → eyebrow → párrafo → **exactamente 3 bullets** → pie de confianza), oculto en móvil (`display:none`, no se apila); panel derecho (labels ENCIMA del input, `radius 11px`, ojo de contraseña, link de recuperar a la derecha, CTA ancho completo, **un solo** link secundario, lockup "by EBIM" al pie) | contrato §4.5 |
| U-05 | Criterio de aceptación del login: *tapando el nombre del producto no se sabe qué app es, pero sí que es EBIM* | contrato §4.5 |
| U-06 | **Listados = un buscador general.** Prohibidos paneles de filtros multi-campo con N dropdowns/date-ranges. Tabs de estado sí | contrato §8; esupplier-022 |
| U-07 | **Pantallas densas/detalle = tabs centrados** (primitivo reusable tipo `SectionTabs`), deep-link por `#hash`, barra de Guardar persistente. Prohibido el scroll infinito de formularios apilados | contrato §8; gmao-025 |
| U-08 | Apariencia por usuario = **sólo modo (light/dark) + densidad**. El **color/accent NUNCA es elegible por el usuario**: manda el `accent_color` del tenant | contrato §4.4 (enmienda 2026-08-11) |
| U-09 | Tokens de densidad 1:1: `--control-h/--row-h/--pad-y/--pad-x` = cómoda `40/52/12/14`, equilibrada `36/44/9/12`, compacta `32/38/6/10`; reflejados en `data-density` del `<html>` | contrato §4.4 |
| U-10 | Regla AA: `accent` para *fills/barras*; **`accent-deep`** para *texto* sobre fondo claro (~4.5:1). Nunca `accent` puro como color de texto | contrato §4.4 |
| U-11 | Topbar: sólo 2 tratamientos válidos — (A) neutro `var(--card)`+`var(--border)`, o (B) gradiente de marca del sidebar. **Prohibido** un tercer tratamiento con tinte arbitrario | contrato §4.4; GMAO §3.6 |
| U-12 | Persistencia de apariencia: `localStorage` anti-flash (`<app>-color-mode`, `<app>-density`) + `profiles.settings.appearance` cross-device, hidratado al login | contrato §4.4 |
| U-13 | **Toda la UI en español** (mercado LATAM), incluidos mensajes de error | eSupplier §7.1 |
| U-14 | Estados explícitos siempre: vacío, carga, error, éxito. Accesibilidad WCAG AA | DESIGN-BRIEF §3 |
| U-15 | Branding por tenant: shape de lookup `{ name, logo_url, accent_color, white_label, brand_slug }`; identificador en URL `?t=<slug>` | contrato §4.3 |

### 2.4 Proceso / gobierno

| # | Convención | Origen |
|---|---|---|
| P-01 | El contrato manda sobre el código local; cambios a claims (§2), jerarquía (§3) o Context API (§5) son **breaking** | INDEX, contrato §10 |
| P-02 | Nunca `git push` automático; sólo con autorización explícita del operador y sólo para ese lote | esupplier-026; GMAO §3.11 |
| P-03 | Deploys requieren OK del operador | eSupplier §7.3 |
| P-04 | Ser autónomo: no preguntar por decisiones de diseño/producto/arquitectura | eSupplier §7.3 |
| P-05 | Cada solución de la suite declara sus canales de integración, aunque sea "ninguno todavía" | contrato §0.5 |
| P-06 | Sin mocks ni hardcodes en circuitos críticos: umbral de negocio → constante nombrada; URL → env var; secreto → Supabase secrets | eSupplier §7.2 |

---

## 3. Divergencias conscientes respecto de las apps existentes

| Tema | Suite existente | Control Plane | Motivo |
|---|---|---|---|
| Librería UI | MUI v5/v9 (GMAO, eSupplier, eExpense) | **Tailwind CSS + primitivos propios** | El prompt maestro (§3 del stack) fija Tailwind explícitamente. Se compensa implementando los **tokens** de marca EBIM (color, DM Sans, densidad, dark mode, accent/accent-deep) para que la "sensación EBIM" (DESIGN-BRIEF §3) se mantenga. La convención de suite es *tokens*, no una librería concreta. |
| Iconos | `@phosphor-icons/react` (eSupplier) / MUI icons (GMAO) | SVG inline propios | La regla de phosphor es **local de eSupplier**, no de suite (GMAO §3.6 nota de alcance). Se evita una dependencia extra. |
| Estado servidor | Zustand + axios adapter (eSupplier) | **TanStack Query** + cliente Supabase directo | Stack fijado por el prompt maestro; el Control Plane habla PostgREST directo con RLS, que es justamente hacia donde migra GMAO (§3.9). |
| Validación build | `vite build` (eSupplier tiene OOM con `tsc`) | `tsc --noEmit` **y** `vite build` | El OOM es específico del tamaño del repo eSupplier; aquí el typecheck corre bien y es un gate exigido. |
| Auth demo | `demo_users` + handlers en browser (eSupplier) | **Supabase Auth real** + RLS | El Control Plane es la consola del operador: no puede depender de un mecanismo de demo. |

---

## 4. Patrones concretos reutilizados (implementados en este repo)

1. `platform.jsonb_deep_merge(a,b)` y `platform.effective_config(company)` — copiados en espíritu del
   hub §2, extendidos a la capa `platform_defaults → org_config → company_config`.
2. Nombres de tabla del hub: `organizations`, `companies`, `memberships`, `catalog_items`,
   `workspace_apps`, `tenant_addons`, `platform_defaults`, `org_config`, `company_config`.
3. Regla `ADMIN_EMAIL_REQUERIDO` en la función de base que crea tenants (contrato §3.2).
4. Guard de gobernanza `ebim.pe` + Super Admin único, con enforcement en DB (no sólo UI) (contrato §13).
5. GRANT por columna en la tabla de entitlements comerciales (contrato §2.6 lección 1).
6. Anatomía de login §4.5 replicada en Tailwind.
7. Isotipo `EbimMark` inline SVG + animación "gira y para" con `prefers-reduced-motion`.
8. Buscador único en listados + `SectionTabs` con deep-link `#hash` en pantallas de detalle.
9. Tokens de densidad y `accent`/`accent-deep` para contraste AA.
10. Fixtures de QA en `@ebim.test`, nunca cuentas reales.
