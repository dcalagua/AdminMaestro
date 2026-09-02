# PROMPT MAESTRO AUTÓNOMO - EBIM CONTROL PLANE

Actúa como **arquitecto de software, senior full-stack engineer, especialista Supabase/PostgreSQL/RLS, QA y DevSecOps**. Vas a trabajar de forma autónoma durante la noche para crear desde cero una primera base funcional de **EBIM Control Plane**.

No esperes respuestas humanas salvo que exista un riesgo real de modificar producción o archivos fuera del proyecto. Para decisiones de implementación ambiguas, elige la alternativa más mantenible, segura y simple, documenta la decisión y continúa.

---

## 0. PATH Y REGLAS DE SEGURIDAD DE FILESYSTEM

Path EBIM autorizado para lectura de lineamientos:

```text
/Users/edudavidmorenoccama/Library/CloudStorage/GoogleDrive-gep.soporteit@gmail.com/My Drive/EBIM-Plataforma
```

Primero ejecuta `pwd -P` y verifica que el directorio de trabajo actual esté dentro del path anterior.

Reglas:

- Puedes leer convenciones existentes en el path EBIM: `CLAUDE.md`, `.claude/`, `README*`, `AGENTS.md`, `CONTRIBUTING.md`, `.editorconfig` u otros documentos equivalentes.
- NO modifiques proyectos hermanos ni ningún archivo fuera del directorio de trabajo del nuevo Control Plane.
- Si estás directamente en `EBIM-Plataforma` y no es una carpeta vacía, crea `EBIM-Control-Plane` y trabaja exclusivamente ahí.
- Si estás en una subcarpeta vacía dentro de `EBIM-Plataforma`, úsala como raíz del proyecto.
- No ejecutes `rm -rf`, resets remotos, cambios destructivos ni comandos masivos fuera de la raíz del nuevo proyecto.
- No despliegues a PRD.
- Si existe configuración remota de Supabase, trátala como READ-ONLY salvo que esté explícitamente marcada como DEV y exista una variable `EBIM_ALLOW_REMOTE_DEV=true`.
- Incluso con `EBIM_ALLOW_REMOTE_DEV=true`, NO ejecutes `supabase db reset --linked` ni wipes remotos.
- Nunca escribas secretos, PAT, service-role key, passwords o API keys dentro del repositorio.

Si la ubicación no cumple estas reglas, no improvises: crea el proyecto únicamente dentro del path autorizado y registra la decisión en `docs/nightly/STATE.md`.

---

# 1. MISIÓN DEL PRODUCTO

Crear una aplicación central **React + TypeScript + Supabase** que administre múltiples SaaS de EBIM.

Productos iniciales a cargar en catálogo:

1. eSupplier
2. EWM by EBIM
3. TMS
4. GMAO
5. eChange

La arquitectura debe permitir agregar nuevos SaaS sin cambiar las tablas core.

EBIM Control Plane debe administrar:

- catálogo de productos SaaS;
- organizaciones;
- partners / resellers / consultoras;
- empresas cliente;
- relaciones entre organizaciones;
- usuarios y memberships;
- tenants por producto;
- comerciales independientes y comerciales de partner;
- atribución comercial;
- planes y licencias;
- suscripciones;
- fees de implementación/onboarding;
- infraestructura y costos;
- comisiones;
- facturación/pagos a nivel de control gerencial, sin pretender ser un ERP contable;
- modelos Shared / Partner Dedicated / Tenant Dedicated;
- feature flags/configuración por tenant;
- solicitudes de provisioning/deployment;
- auditoría;
- dashboards de MRR/ARR/costos/margen/tenants/comisiones.

---

# 2. REGLAS DE NEGOCIO BASE

## 2.1 Jerarquía

No implementes "tenant de tenant" literalmente.

Usa conceptos separados:

```text
EBIM PLATFORM
  -> Organizations / Partners / Customers
  -> SaaS Products
  -> Tenants
  -> Subscriptions / Deployments
```

Un partner puede administrar muchos clientes y tenants.
Una organización puede tener tenants de varios SaaS.
Un tenant pertenece a un producto SaaS.

## 2.2 Modelos de despliegue

`deployment_mode`:

- `SHARED`
- `PARTNER_DEDICATED`
- `TENANT_DEDICATED`

Reglas comerciales iniciales:

### SHARED
- Infraestructura compartida.
- Puede existir venta directa EBIM.
- También puede existir Partner/Reseller/Empresa con múltiples tenants dentro de la misma infraestructura compartida.
- Cada tenant productivo puede representar una licencia activa.
- Demo no genera cobro recurrente.
- Puede existir fee de implementación/onboarding.
- Puede existir comisión o margen de canal.

### PARTNER_DEDICATED
- Partner con infraestructura dedicada.
- Licencia base Partner.
- N licencias por tenants activos.
- Fee de implementación.
- Fee recurrente de infraestructura dedicada.
- Partner puede retener margen.
- Comercial captador puede tener comisión adicional si la regla contractual lo permite.

### TENANT_DEDICATED
- Cliente Enterprise con infraestructura exclusiva.
- Licencia Enterprise.
- Fee de implementación/setup.
- Fee recurrente de infraestructura dedicada.
- Soporte premium/SLA opcional.
- Comisión a comercial/partner si aplica.

## 2.3 Comerciales y seguridad

Un comercial que vendió un tenant puede ver información comercial autorizada:

- cliente;
- SaaS;
- plan;
- estado comercial;
- monto atribuible;
- comisión;
- settlement.

NO obtiene automáticamente acceso a proveedores, contratos, inventario, órdenes, documentos u otros datos operativos del SaaS del cliente.

---

# 3. STACK

Usa una base moderna y mantenible:

- React
- TypeScript estricto
- Vite
- Supabase JS
- Supabase CLI + PostgreSQL migrations
- Supabase Auth
- PostgreSQL RLS
- Tailwind CSS
- una librería de componentes accesible/coherente (preferentemente shadcn/ui si encaja sin fricción)
- React Router
- TanStack Query para server state si aporta valor
- React Hook Form + Zod para formularios complejos
- ESLint
- Prettier
- Vitest + React Testing Library
- Playwright para smoke/E2E si el entorno lo permite

Usa `pnpm` si ya está disponible y es compatible con los lineamientos del path EBIM. De lo contrario utiliza `npm`.
No cambies de package manager a mitad del proyecto.

---

# 4. MODELO DE DATOS MÍNIMO

Diseña migraciones versionadas para cubrir, al menos, las siguientes capacidades. Ajusta nombres si existe una convención EBIM mejor, pero conserva las responsabilidades.

## Identidad y acceso

- `profiles`
- `platform_roles` o enums equivalentes
- `organization_memberships`
- `tenant_memberships`

## Productos y organizaciones

- `saas_products`
- `organizations`
- `organization_relationships`
- `organization_product_agreements`

Una organización debe poder actuar como owner, partner, reseller, customer o combinar capacidades mediante relaciones/roles sin quedar limitada por un enum rígido si eso perjudica el modelo.

## Tenancy

- `tenants`
- `tenant_features`
- `tenant_settings`

Cada tenant debe saber, como mínimo:

- producto SaaS;
- customer organization;
- managing organization/partner si aplica;
- tipo DEMO/TRIAL/PRODUCTION/SANDBOX;
- estado;
- deployment mode;
- slug/código estable.

## Comercial

- `sales_agents` o `commercial_profiles`
- `sales_attributions`
- `commission_plans`
- `commission_rules`
- `commission_events`
- `commission_settlements`

No hardcodees comisión en el tenant.
Debe existir histórico y vigencia de reglas.

## Licenciamiento / finanzas gerenciales

- `plans`
- `plan_prices`
- `subscriptions`
- `subscription_items`
- `invoices`
- `payments`
- `fees` o estructura equivalente para setup/implementation/infrastructure/support
- `cost_entries`
- `cost_allocations`

Debemos poder calcular al menos:

- MRR;
- ARR;
- ingreso cobrado;
- costo de infraestructura;
- comisión provisionada/pagada;
- margen bruto estimado por producto/partner/tenant.

No construyas un ERP contable completo.

## Provisioning

- `deployment_targets`
- `tenant_deployments`
- `provisioning_requests`
- `provisioning_events`

Debe contemplar proveedor Supabase, pero diseña una abstracción que permita otro provider en el futuro.
Nunca guardes secretos de infraestructura en texto plano en tablas de aplicación.

## Auditoría

- `audit_logs`

Registra acciones administrativas sensibles con actor, entidad, acción, timestamp y metadata segura.

---

# 5. RBAC / RLS

Roles funcionales mínimos:

- `EBIM_SUPER_ADMIN`
- `EBIM_PRODUCT_ADMIN`
- `EBIM_FINANCE`
- `PARTNER_ADMIN`
- `PARTNER_SALES`
- `PARTNER_SUPPORT`
- `SALES_AGENT`
- `TENANT_ADMIN`
- `TENANT_USER`

No confíes sólo en ocultar menús.
La autorización real debe existir en PostgreSQL mediante grants + RLS y funciones helper seguras.

Principios:

- `anon`: sin acceso a información privada.
- `authenticated`: sólo operaciones necesarias.
- `service_role`: jamás en React/browser.
- vistas sensibles deben respetar RLS o usar patrones seguros.
- evitar políticas duplicadas y recursion accidental.
- helpers `security definer` sólo cuando sean necesarios, con `search_path` explícito y permisos mínimos.

Crea tests positivos y negativos de aislamiento.

---

# 6. UI MÍNIMA COMPLETA

Construye una consola administrativa consistente y utilizable, no sólo páginas vacías.

Módulos/rutas objetivo:

- Login
- Dashboard
- SaaS Products
- Organizations
- Partners / Resellers
- Customers
- Tenants
- Tenant Detail
- Commercials / Sales Agents
- Sales Attributions
- Commission Plans
- Commissions / Settlements
- Plans & Licenses
- Subscriptions
- Billing / Payments
- Costs & Margin
- Deployments / Provisioning
- Feature Flags
- Audit Logs
- Settings

Dashboard EBIM:

- SaaS activos;
- organizaciones;
- partners;
- tenants productivos;
- demos/trials;
- MRR / ARR estimados;
- ingresos cobrados;
- costos de infraestructura;
- comisiones pendientes;
- margen estimado;
- deployments por estado.

Dashboard Partner:

- productos autorizados;
- clientes/tenants que administra;
- licencias activas;
- demos/trials;
- facturación/margen visible según permisos;
- comisiones si aplican.

SALES_AGENT:

- oportunidades/atribuciones propias;
- clientes atribuidos;
- comisiones devengadas/pagadas;
- sin acceso a data operacional de tenants.

---

# 7. SEED DE NEGOCIO OBLIGATORIO

Genera seed reproducible que demuestre el modelo, sin datos personales reales ni secretos.

Debe incluir como mínimo:

### Productos
- eSupplier
- EWM by EBIM
- TMS
- GMAO
- eChange

### Organizaciones
- EBIM
- Consultora Andina
- Reseller Pacífico
- Empresa Directa Alpha
- Empresa Enterprise Omega
- Cliente Partner Uno
- Cliente Partner Dos

### Escenarios

1. eSupplier Shared - cliente directo EBIM.
2. eSupplier Shared - Consultora Andina administrando varios tenants en infraestructura compartida.
3. eSupplier Partner Dedicated - Consultora Andina.
4. eSupplier Tenant Dedicated - Empresa Enterprise Omega.
5. EWM by EBIM Shared - uno o más tenants.
6. EWM by EBIM Partner Dedicated - Reseller Pacífico con múltiples clientes.
7. EWM by EBIM Tenant Dedicated - cliente Enterprise.
8. Al menos un partner autorizado para vender eSupplier + EWM by EBIM, demostrando partner multi-SaaS.
9. Un comercial independiente atribuido a ventas de más de un producto, sin membership operacional en esos tenants.

Incluye planes y valores ficticios coherentes para poder mostrar MRR/costo/margen/comisión en dashboard.

---

# 8. PROVISIONING

Implementa la capa de dominio y UI para provisioning, pero con política segura:

- Por defecto todo provisioning externo debe funcionar en `DRY_RUN`.
- Crea un adapter/interface para Supabase Management API.
- El token de Management API sólo puede venir desde secret/env del lado servidor/Edge Function.
- La UI nunca recibe ese token.
- Un request debe tener estados como `PENDING`, `VALIDATING`, `RUNNING`, `SUCCEEDED`, `FAILED`, `CANCELLED`.
- Guarda eventos y errores sanitizados.
- Debe soportar reintento idempotente.
- No realices creación destructiva o remota real durante esta ejecución nocturna salvo que exista autorización DEV explícita y segura; aun así prioriza DRY_RUN.

---

# 9. CALIDAD Y PRUEBAS

Después de cada fase, ejecuta los gates posibles.

Gate de base de datos:

- migraciones desde cero;
- `supabase db reset` local;
- seed reproducible;
- tests SQL/RLS;
- tipos TypeScript generados desde DB cuando aplique.

Gate frontend:

- install limpio;
- typecheck;
- lint;
- unit tests;
- build;
- smoke/E2E si el entorno lo permite.

Gate seguridad:

- ninguna `service_role` en cliente;
- RLS habilitado en tablas expuestas;
- `anon` sin grants innecesarios;
- negative tests cross-organization y cross-tenant;
- SALES_AGENT no puede leer datos fuera de su dominio comercial;
- PARTNER_ADMIN no puede leer otra organización;
- TENANT_ADMIN no puede administrar otro tenant;
- no secretos versionados.

No maquilles gates. Si algo falla, registra FAIL y corrige o documenta el blocker.

---

# 10. ESTRATEGIA DE EJECUCIÓN NOCTURNA

Crea al iniciar:

```text
docs/nightly/STATE.md
docs/nightly/DECISIONS.md
docs/nightly/BLOCKERS.md
docs/nightly/FINAL_REPORT.md
```

`STATE.md` debe tener checklist de fases y actualizarse después de cada fase.

Fases:

1. Guardrails y discovery.
2. Bootstrap React + Supabase.
3. Modelo de datos Control Plane.
4. Auth + RBAC + RLS.
5. Multi-SaaS + Partner + Tenant.
6. Comercial + Licencias + Comisiones.
7. Costos + Facturación gerencial + Margen.
8. Deployment modes + Provisioning.
9. UI administrativa completa.
10. Seed de escenarios.
11. Tests, hardening y calidad.
12. Documentación y handoff.

Después de cada fase:

- actualiza STATE;
- ejecuta tests relevantes;
- corrige fallos;
- haz commit git descriptivo si el repo está sano.

Inicializa git si la carpeta está vacía y aún no existe repositorio.
Usa una branch tipo:

```text
feature/ebim-control-plane-bootstrap-<YYYYMMDD>
```

No hagas push remoto salvo que esté configurado explícitamente y sea seguro; no es necesario para considerar la noche exitosa.

Si una fase presenta un error:

1. investiga causa;
2. aplica corrección mínima;
3. reintenta gate;
4. máximo dos ciclos amplios por el mismo blocker;
5. si sigue bloqueado, documenta evidencia y continúa con tareas independientes.

No te quedes indefinidamente en un mismo error.

---

# 11. DEFINITION OF DONE NOCTURNO

Al finalizar, `docs/nightly/FINAL_REPORT.md` debe incluir exactamente una tabla de estado con al menos:

```text
FILESYSTEM_GUARDRAILS
REPO_INITIALIZED
REACT_APP
SUPABASE_LOCAL
DB_RESET
MIGRATIONS
SEED
AUTH
RBAC
RLS
MULTI_SAAS
PARTNERS
TENANTS
SALES_AGENTS
COMMISSIONS
SUBSCRIPTIONS
COSTS_MARGIN
DEPLOYMENT_MODEL
PROVISIONING_DRY_RUN
ADMIN_UI
PARTNER_UI
TESTS_DB
TESTS_FRONTEND
TYPECHECK
LINT
BUILD
E2E
SECURITY_NEGATIVE_TESTS
SECRETS_SCAN
DOCUMENTATION
```

Estados permitidos:

- `PASS`
- `PARTIAL`
- `BLOCKED_ENVIRONMENT`
- `FAIL`
- `NOT_APPLICABLE`

Incluye conteos reales de tests, commits creados, última migración, branch, blockers y próximos pasos.

No escribas “todo listo” si existe un FAIL no explicado.

---

# 12. COMIENZA AHORA

Empieza por discovery/guardrails. No me preguntes cómo modelar cada detalle: toma decisiones razonables bajo estos principios, documenta las decisiones y avanza hasta completar la mayor cantidad posible de fases esta noche.
