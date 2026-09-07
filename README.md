# EBIM Control Plane

Consola central de la suite SaaS de EBIM. Administra el catálogo de productos,
las organizaciones (partners, resellers, clientes), los tenants por producto, el
modelo comercial (comerciales, atribuciones, comisiones), la capa gerencial de
licencias, cobros, costos y margen, y el provisioning de infraestructura.

> **Qué NO es.** El Control Plane no almacena los datos operativos de eSupplier,
> EWM, TMS, GMAO ni eChange — proveedores, órdenes, inventario, documentos viven
> en el proyecto Supabase de cada app. Aquí vive el gobierno: identidad,
> catálogo, suscripciones, canales, costos y despliegues.
> (Contrato de plataforma EBIM §7, "regla de oro".)

---

## 1. Requisitos (macOS)

| Herramienta | Versión probada | Nota |
|---|---|---|
| Node | **v24.19.0** | Instalado vía `nvm`. **No está en el PATH por defecto** — ver abajo. |
| npm | 11.17.0 | Gestor de paquetes del proyecto. No mezclar con pnpm/yarn. |
| Docker | 29.7.2 | Necesario para el stack local de Supabase. |
| Supabase CLI | 2.115.0 | `brew install supabase/tap/supabase`. |
| git | 2.55.0 | |

En este equipo `node` vive en `~/.nvm/versions/node/v24.19.0/bin`. Antes de
trabajar:

```bash
nvm use            # lee .nvmrc
# o, si nvm no está cargado en la shell:
export PATH="$HOME/.nvm/versions/node/v24.19.0/bin:$PATH"
```

---

## 2. Puesta en marcha

```bash
npm install
supabase start          # levanta Postgres, Auth, PostgREST, Studio
cp .env.example .env.local
```

Completa `.env.local` con los valores que imprime `supabase status`:

```bash
supabase status         # copia API URL y anon key
```

```bash
npm run db:reset        # migraciones desde cero + seed demo
npm run dev             # http://127.0.0.1:5199
```

### Puertos

Este proyecto **no** usa el rango 54321-54327 por defecto: en esta máquina ya lo
ocupaba otro stack local de Supabase, y detenerlo habría interrumpido el trabajo
de otro proyecto. Se usa el rango **544xx**:

| Servicio | Puerto |
|---|---|
| API (Kong) | 54421 |
| PostgreSQL | 54422 |
| Studio | 54423 |
| Mailpit (correo) | 54424 |
| Analytics | 54427 |

---

## 3. Variables de entorno

Sólo las variables con prefijo `VITE_` llegan al bundle del navegador. Esa es la
frontera de seguridad, y por eso ninguna credencial de servidor lleva ese
prefijo (ver `src/lib/env.ts` y `src/vite-env.d.ts`).

| Variable | Dónde vive | Descripción |
|---|---|---|
| `VITE_SUPABASE_URL` | `.env.local` | URL del proyecto Supabase. |
| `VITE_SUPABASE_ANON_KEY` | `.env.local` | Clave publicable/anon. **Es pública por diseño**: la seguridad la da RLS. |
| `VITE_APP_ENV` | `.env.local` | `LOCAL` / `DEV` / `QAS` / `PRD`. Muestra el badge de entorno. |
| `PROVISIONING_MODE` | Edge Function secrets | `DRY_RUN` (default) o `LIVE`. |
| `SUPABASE_MANAGEMENT_TOKEN` | Edge Function secrets | Token de la Management API. **Nunca** en el repo ni en el navegador. |

`.env.example` sólo contiene nombres y placeholders. `.env.local` está
gitignorado y `scripts/secrets-scan.mjs` verifica que no se cuele nada.

---

## 4. Comandos

| Comando | Qué hace |
|---|---|
| `npm run dev` | Servidor de desarrollo. |
| `npm run build` | Typecheck + build de producción. |
| `npm run typecheck` | Sólo TypeScript. |
| `npm run lint` | ESLint. |
| `npm test` | Tests unitarios (Vitest). |
| `npm run e2e` | Smoke E2E (Playwright). Requiere Supabase local con seed. |
| `npm run db:start` / `db:stop` | Stack local de Supabase. |
| `npm run db:reset` | **Reconstruye la BD desde cero** + seed. |
| `npm run db:test` | Tests de base de datos (pgTAP). |
| `npm run db:types` | Regenera `src/types/database.types.ts` desde la BD. |
| `npm run secrets:scan` | Busca credenciales en el repo y en `dist/`. |

---

## 5. Cuentas de demostración

El seed crea usuarios de prueba **con dominio de fixtures `@ebim.test`**
(gobernanza de datos del contrato §11: nunca cuentas reales de cliente).

Contraseña común, **sólo válida en el stack local**: `Ebim.Demo2026!`

| Correo | Rol | Qué demuestra |
|---|---|---|
| `dcalagua@ebim.pe` | `EBIM_SUPER_ADMIN` | Operador único de la suite (contrato §13). Ve todo. |
| `product.admin@ebim.test` | `EBIM_PRODUCT_ADMIN` | Administra productos, tenants y deployments. |
| `finance@ebim.test` | `EBIM_FINANCE` | Costos, márgenes, comisiones. |
| `admin@andina.ebim.test` | `PARTNER_ADMIN` | Consultora Andina: partner **multi-SaaS**. Ve sólo lo suyo. |
| `ventas@andina.ebim.test` | `PARTNER_SALES` | Vista comercial del partner. |
| `soporte@andina.ebim.test` | `PARTNER_SUPPORT` | Metadata de tenants, sin datos comerciales. |
| `admin@pacifico.ebim.test` | `PARTNER_ADMIN` | Reseller Pacífico. Útil para probar el aislamiento cross-partner. |
| `comercial@indep.ebim.test` | `SALES_AGENT` | Comercial independiente con ventas en **dos productos** y **sin** acceso operativo. |
| `admin@alpha.ebim.test` | `TENANT_ADMIN` | Administra un solo tenant. |
| `admin@omega.ebim.test` | `TENANT_ADMIN` | Tenant Enterprise dedicado. |

> ⚠️ **No usar el seed en producción.** Crea usuarios con contraseña conocida,
> organizaciones ficticias y datos financieros inventados. Existe para poder
> entender el modelo en minutos y para que los tests tengan sujetos concretos.

---

## 5-bis. Novedades V2 (2026-09-07)

El Control Plane pasa de consola de LECTURA a consola administrable. 8 migraciones
nuevas (`20260907*`) sobre las 13 baseline, que **no se tocaron**.

| Área | Qué se añadió |
|---|---|
| **Administración** | 25 RPCs `SECURITY DEFINER` auditadas. No se abrió ni un GRANT de escritura: el baseline los revoca a propósito |
| **Canal** | Acuerdo por producto con modelos permitidos, tipos de tenant, tope y responsabilidad de factura |
| **Licenciamiento** | `onboard_customer_subscription()`: una venta = una transacción |
| **Cobranza** | Método de cobro **por suscripción**: Culqi Card, OS, OC, transferencia, manual |
| **OS/OC** | Ciclo completo. Aprobar **no** es cobrar |
| **Culqi** | Adapter desacoplado, webhook idempotente, modo MOCK explícito sin credenciales |
| **Renovaciones** | Alertas idempotentes, gracia y suspensión configurable |
| **Comisiones** | Reverso por contra-evento: la historia no se borra |
| **Finanzas** | Reconciliación y paneles por producto y por canal, agrupados por moneda |

### Rutas nuevas

| Ruta | Para qué |
|---|---|
| `/onboarding` | Wizard «Nueva venta / alta de cliente» (solo EBIM) |
| `/subscriptions/:id` | Detalle con pestaña **Cobranza** (perfil + OS/OC + facturas) |
| `/renewals` | Renovaciones, alertas y suspensiones |
| `/reconciliation` | Hallazgos, panel por producto, por canal y eventos del proveedor (solo EBIM) |
| `/organizations/:id` → **Vista 360** | La demostración principal: todo sobre una cuenta en una pantalla |

### Puerto de desarrollo

El dev server escucha en **5199**, no en el 5173 por defecto, con `strictPort`.
El 5173 lo ocupa de forma permanente el dev server de otro proyecto de la
máquina de desarrollo; con `reuseExistingServer` la suite E2E llegó a ejecutarse
entera contra esa otra aplicación. Mismo criterio que el blocker B-01 del
baseline: se mueve NUESTRO puerto, no se mata el servidor ajeno.

> ⚠️ **Nunca ejecutes `tsc` sin `--noEmit`.** `tsconfig.app.json` y
> `tsconfig.node.json` compilarían un `.js` junto a cada `.tsx` y junto a
> `vite.config.ts`, y tanto Vite como Playwright resuelven `.js` **antes** que
> `.ts`. El resultado es una app que se queda congelada en la última compilación
> sin dar ningún error. Ver `docs/nightly-v2/AUDIT_BASELINE.md` §5 (R-03).

## 6. Documentación

| Documento | Contenido |
|---|---|
| [`docs/architecture/OVERVIEW.md`](docs/architecture/OVERVIEW.md) | Visión general y decisiones estructurales. |
| [`docs/architecture/DATA_MODEL.md`](docs/architecture/DATA_MODEL.md) | ERD y responsabilidad de cada tabla. |
| [`docs/architecture/DEPLOYMENT_MODEL.md`](docs/architecture/DEPLOYMENT_MODEL.md) | Shared / Partner Dedicated / Tenant Dedicated. |
| [`docs/architecture/EBIM_CONVENTIONS.md`](docs/architecture/EBIM_CONVENTIONS.md) | Convenciones EBIM adoptadas y su origen. |
| [`docs/security/RBAC_RLS_MATRIX.md`](docs/security/RBAC_RLS_MATRIX.md) | Matriz de permisos y política por tabla. |
| [`docs/commercial/COMMERCIAL_MODEL.md`](docs/commercial/COMMERCIAL_MODEL.md) | Actores, canales y licenciamiento. |
| [`docs/commercial/COMMISSION_MODEL.md`](docs/commercial/COMMISSION_MODEL.md) | Cómo se calcula una comisión, paso a paso. |
| [`docs/finance/COST_MARGIN_MODEL.md`](docs/finance/COST_MARGIN_MODEL.md) | Fórmulas de MRR, ARR, costo y margen. |
| [`docs/demo/DEMO_SCENARIOS.md`](docs/demo/DEMO_SCENARIOS.md) | Los 9 escenarios del seed con sus cifras. |
| [`docs/operations/LOCAL_DEVELOPMENT.md`](docs/operations/LOCAL_DEVELOPMENT.md) | Desarrollo local y resolución de problemas. |
| [`docs/operations/PROVISIONING.md`](docs/operations/PROVISIONING.md) | DRY_RUN, adapter y camino a LIVE. |
| [`docs/nightly/FINAL_REPORT.md`](docs/nightly/FINAL_REPORT.md) | Informe de la ejecución y estado de los gates. |

---

### Documentación V2

| Documento | Contenido |
|---|---|
| `docs/payments/COLLECTION_MODEL.md` | Método de cobro por suscripción |
| `docs/payments/CULQI_ARCHITECTURE.md` | Adapter, webhooks, idempotencia y checklist de activación |
| `docs/payments/SERVICE_ORDER_PURCHASE_ORDER.md` | Ciclo de OS/OC |
| `docs/operations/RENEWALS_AND_SUSPENSION.md` | Motor de renovaciones y suspensión |
| `docs/demo/DEMO_SCENARIOS_V2.md` | Guion de demostración gerencial |
| `docs/nightly-v2/FINAL_REPORT_V2.md` | Informe final con evidencia |
| `docs/nightly-v2/E2E_REPORT.md` | Resultado E2E detallado |

## 7. Principios no negociables

1. **Organization ≠ base de datos. Tenant ≠ base de datos.** El aislamiento
   físico lo decide `deployment_mode`, no la jerarquía comercial.
2. **RLS en toda tabla expuesta**, con *default deny*. Ocultar un menú no
   protege nada.
3. **`anon` no tiene ni USAGE** sobre el schema `platform`.
4. **La clave de servicio jamás llega al navegador.** Hay una regla de ESLint y
   un escáner que lo verifican, y un test E2E que lo comprueba en el bundle
   servido.
5. **Ningún secreto versionado.** Ni en el repo ni en tablas de aplicación: un
   trigger rechaza claves JSONB con pinta de credencial.
6. **La comisión nace de un cobro**, nunca de crear un tenant ni de emitir una
   factura.
7. **Provisioning en DRY_RUN por defecto.** LIVE exige autorización explícita
   del operador y un secreto que sólo existe del lado servidor.
