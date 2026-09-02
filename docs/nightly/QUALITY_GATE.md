# Quality Gate — evidencia de ejecución

Todos los comandos se ejecutaron en este equipo, contra el stack local real.
Ningún resultado está estimado.

## 1. Base de datos

| Gate | Comando | Resultado |
|---|---|---|
| Reconstrucción desde cero | `supabase db reset` | **PASS** (exit 0) |
| Migraciones aplicadas | `supabase migration list --local` | **13/13** aplicadas, sin drift |
| Seed reproducible | incluido en `db reset` | **PASS** — bloque de verificación final sin errores |
| Tests de base de datos | `supabase test db` | **PASS** — `Files=3, Tests=52` |
| Tipos TypeScript | `supabase gen types typescript --local` | **PASS** — 3.783 líneas generadas |

### Desglose de los 52 tests pgTAP

| Archivo | Tests | Cubre |
|---|---|---|
| `00_structure.test.sql` | 14 | RLS + FORCE en todas las tablas, `anon` cerrado, `search_path` en definers, `security_invoker` en vistas, append-only de auditoría, protección del precio por GRANT, sin floats en dinero, índices de FK, catálogo sin columnas por producto. |
| `01_rls_isolation.test.sql` | 20 | Aislamiento cross-partner, cross-org, cross-tenant, alcance de `SALES_AGENT`, usuario sin membresía, `anon` denegado. |
| `02_business_rules.test.sql` | 18 | `ADMIN_EMAIL_REQUERIDO`, super admin único, dominio operador, DEMO sin recurrente, partner sin acuerdo, coherencia de despliegue, DRAFT/VOID fuera del ingreso, comisiones deterministas e idempotentes. |

## 2. Hardening de seguridad (medido, no declarado)

```sql
tablas=39 · con_rls=39 · con_force=39 · politicas=69 · vistas=7
funciones=42 · security_definer=34 · grants_a_anon=0 · indices=152
```

| Verificación | Resultado |
|---|---|
| Tablas con RLS habilitada | **39 / 39** |
| Tablas con `FORCE ROW LEVEL SECURITY` | **39 / 39** |
| Tablas con RLS pero sin ninguna política | **0** |
| GRANTs de `anon` sobre `platform` | **0** |
| GRANTs de `PUBLIC` sobre `platform` | **0** |
| `USAGE` de `anon` sobre el schema | **denegado** |
| Funciones `SECURITY DEFINER` sin `search_path` fijo | **0 de 34** |
| Vistas sin `security_invoker = true` | **0 de 7** |
| GRANT de UPDATE/DELETE sobre `audit_logs` para `authenticated` | **0** (append-only real) |
| GRANT de escritura sobre `catalog_items` (donde vive el precio) para `authenticated` | **0** |
| Columnas monetarias con punto flotante binario | **0** |
| FKs sin índice de apoyo | **0** (24 índices añadidos tras detectarlo el test 12) |

## 3. Tests negativos de aislamiento

Ejecutados fijando `request.jwt.claims`, que es de donde `auth.uid()` lee las
políticas reales. No se simulan permisos: se ejecutan.

| # | Escenario | Resultado |
|---|---|---|
| 1 | Cross-partner: Andina no ve a Reseller Pacífico | **DENEGADO** ✓ |
| 2 | Cross-partner: Andina no ve ningún tenant de Pacífico | **DENEGADO** ✓ |
| 3 | Cross-org: Andina no ve facturas de Pacífico | **DENEGADO** ✓ |
| 4 | Un partner no ve **ningún** `cost_entry` | **DENEGADO** ✓ |
| 5 | Cross-tenant: el admin de Alpha no ve el tenant de Omega | **DENEGADO** ✓ |
| 6 | Cross-tenant: tampoco sus `tenant_settings` | **DENEGADO** ✓ |
| 7 | `SALES_AGENT` no ve atribuciones de otro comercial | **DENEGADO** ✓ |
| 8 | `SALES_AGENT` no ve comisiones de otro comercial | **DENEGADO** ✓ |
| 9 | **Vender un tenant no crea acceso operacional** | **DENEGADO** ✓ |
| 10 | Usuario sin membresía: 0 tenants, 0 facturas | **DENEGADO** ✓ |
| 11 | `anon` sobre `platform.tenants` | **42501 permiso denegado** ✓ |
| 12 | `anon` sobre `platform.invoices` | **42501 permiso denegado** ✓ |

`anon` recibe **error de permisos**, no una lista vacía: la diferencia importa,
porque una lista vacía puede confundirse con "no hay datos".

## 4. Frontend

| Gate | Comando | Resultado |
|---|---|---|
| Typecheck | `tsc -p tsconfig.app.json --noEmit` | **PASS** (exit 0, TS estricto) |
| Lint | `eslint .` | **PASS** — 0 errores, 0 advertencias |
| Tests unitarios | `vitest run` | **PASS** — 29/29 en 3 archivos |
| Build | `vite build` | **PASS** — 586,85 kB (165,31 kB gzip) |
| E2E smoke | `playwright test` | **PASS** — 21/21 |

### Cobertura E2E (navegador real, Supabase local con seed, sin mocks)

| Grupo | Tests | Qué prueba |
|---|---|---|
| Login | 3 | Anatomía del contrato §4.5 (incluido el conteo exacto de 3 bullets), credenciales inválidas en español, ruta protegida → login. |
| Consola EBIM | 10 | Dashboard con datos del seed, 5 SaaS, 3 modelos de despliegue, deep-link `#hash`, buscador único, provisioning DRY_RUN, deployments, costos, auditoría, 404. |
| Aislamiento por rol | 5 | Partner sin acceso a costos (menú **y** URL forzada), partner sin tenants ajenos, comercial sin menú operativo, tenant admin sin otros tenants, finanzas con acceso. |
| Apariencia | 1 | Modo y densidad configurables; **sin** selector de color (contrato §4.4). |
| Higiene de seguridad | 2 | El bundle servido no contiene la clave de servicio; la contraseña demo no viaja en el HTML. |

## 5. Higiene de secretos

```
$ npm run secrets:scan
SECRETS_SCAN: PASS — sin credenciales detectadas en el repositorio ni en el bundle.
```

Cubre archivos versionados **y** `dist/`, buscando: JWT con rol de servicio,
`sb_secret_`, `sbp_` (PAT), cadenas de conexión con contraseña, claves PEM, AWS
Access Key ID, tokens de Slack, claves de Google, claves de OpenAI/Anthropic y
client secrets de Microsoft Graph. Además verifica que ninguna variable de
servidor lleve prefijo `VITE_`.

**El escáner se probó en positivo:** con una sonda plantada en el bundle, falla
(exit 1) y nombra el archivo; al retirarla vuelve a PASS. Un escáner que nunca
se ha visto fallar no es evidencia de nada.

### Capas de defensa contra la fuga de la clave de servicio

1. La variable no lleva prefijo `VITE_` → Vite no la inyecta en el bundle.
2. `src/vite-env.d.ts` no la declara → el typecheck la rechazaría.
3. Regla ESLint sobre `src/**` que prohíbe el literal en el cliente.
4. `secrets:scan` revisa repo y `dist/`.
5. Test E2E que descarga los scripts **desde el navegador real** y los inspecciona.

## 6. Reglas de negocio verificadas

| Regla | Evidencia |
|---|---|
| Crear un tenant sin correo de admin **falla** | `02` #1-2 · `ADMIN_EMAIL_REQUERIDO` |
| `@ebim.pe` no puede administrar un tenant cliente | `02` #3 |
| Sólo `dcalagua@ebim.pe` puede ser `EBIM_SUPER_ADMIN` | `02` #4-5 |
| `@ebim.pe` no es miembro de una organización cliente | `02` #6 |
| Un tenant DEMO no genera recurrente ni aporta MRR | `02` #7-8 |
| Un partner sin acuerdo no administra tenants de ese producto | `02` #9 |
| Un tenant SHARED no puede vivir en un target dedicado | `02` #10 |
| Un target `TENANT_DEDICATED` aloja exactamente 1 tenant | `02` #11 |
| Un target SHARED aloja varios | `02` #12 |
| DRAFT/VOID nunca cuentan como ingreso | `02` #13 |
| No se confirma un cobro sobre una factura DRAFT | `02` #14 |
| Toda comisión proviene de un pago CONFIRMED | `02` #15 |
| Comisión pagada y pendiente separadas | `02` #16 |
| `amount = round(base × tasa × participación, 2)` | `02` #17 |
| Reprocesar un pago no duplica comisiones | `02` #18 |

## 7. Datos cargados por el seed

```
productos=5 · organizaciones=10 · tenants=13 · suscripciones=13
facturas=40 · pagos=25 · eventos_comision=19 · costos=27
deployment_targets=6 · solicitudes_provisioning=4 · usuarios_auth=12
```

Métricas calculadas por `platform.dashboard_summary()` sobre esos datos:

```
MRR                 USD 24.750,00
ingreso cobrado     USD 98.600,00
costo registrado    USD 16.584,00
comisión pendiente  USD  1.593,60
comisión pagada     USD  1.390,00
tenants productivos 11 · demo/trial 2
por modelo          7 SHARED · 4 PARTNER_DEDICATED · 2 TENANT_DEDICATED
provisioning        2 SUCCEEDED · 1 FAILED · 1 PENDING
```

## 8. Fallos encontrados y corregidos durante los gates

No se maquilló ningún gate. Estos fallos aparecieron y se arreglaron:

| # | Fallo | Detectado por | Corrección |
|---|---|---|---|
| 1 | Política `plan_prices_select` siempre verdadera (`boolean is not null`) | Revisión al escribir el gate | Reescrita para exigir finanzas, operador o suscripción vigente. |
| 2 | 24 FKs sin índice de apoyo | Test 12 de estructura | Migración `20260902001300_fk_indexes.sql`. |
| 3 | Reglas de comisión con `valid_from = current_date` → ningún cobro histórico las activaba | Bloque de verificación del seed | `valid_from` explícito en el pasado. |
| 4 | **Todo login devolvía 500** por columnas de token NULL en `auth.users` | 18 de 21 E2E fallando a la vez | Sembrar `''` en las 8 columnas de token de GoTrue. |
| 5 | Tenant DEMO con cliente = partner violaba un CHECK | `db reset` | `managing_organization_id` NULL: Andina es cliente de su propio demo. |
| 6 | Liquidación insertada como `PAID` sin referencia de pago | `db reset` | Se abre `OPEN` y se cierra con fecha y referencia. |
| 7 | `bg-accent/25` no compila (Tailwind no calcula alfa sobre `var()`) | `vite build` | Token `--accent-ring` con su propia transparencia. |
| 8 | ESLint analizaba código generado del edge runtime | `eslint .` | `supabase/.temp/**` ignorado. |
| 9 | La regla anti-clave-de-servicio bloqueaba una Edge Function legítima | `eslint .` | Regla acotada a `src/**`: el servidor SÍ debe leer esa variable. |
| 10 | El propio test E2E de fuga disparaba el escáner de secretos | `secrets:scan` | La aguja se compone en tiempo de ejecución; el escáner sigue estricto. |
