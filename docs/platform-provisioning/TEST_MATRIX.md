# Matriz de pruebas del plano de provisioning

Medición fresca del 2026-09-15. Los totales son de la ejecución de esta fase, no
copiados de V3.2.

| Gate | Baseline (V3.2) | Tras V4 | Nuevo |
| --- | --- | --- | --- |
| `npm run db:test` (pgTAP) | 537 | **719** | +182 |
| `npm test` (vitest) | 169 | **445** | +276 |
| `npm run e2e` (Playwright) | 74 | **113** | +39 |

## 1. pgTAP

### `21_v4_provisioning_model.test.sql` — 106 pruebas

| Bloque | Qué fija |
| --- | --- |
| Frontera del Control Plane | `DB_DIRECT` no existe; el enum de algoritmos no admite `none` ni HMAC; ninguna tabla tiene columna de credencial de SaaS |
| Referencias de secreto | PEM, JWT, base64 y `sk_live_` **rechazados** por la base incluso como superusuario; TTL acotado; tipo NONE sin referencias |
| SSRF | 20 casos: esquemas, HTTPS por ambiente, metadatos de cloud, rangos privados, userinfo, query, barra final, salto de línea, puerto fuera de rango; `172.15`/`172.32` **fuera** del bloqueo, `172.16`-`172.31` dentro |
| Coherencia destino↔integración | MOCK fuera de DEV rechazado; integración de otro producto; READY con credencial deshabilitada; enabled sin READY; timeout desmesurado |
| Resolución | SHARED, PARTNER_DEDICATED (partner que **administra**), TENANT_DEDICATED sin infra, producto equivocado, tenant inexistente, **ambigüedad sin desempate** |
| Idempotencia | Clave determinista; **cinco clics → una solicitud**; segunda solicitud viva rechazada por índice; clave inmutable |
| Máquina de estados | Salto prohibido a ACTIVE; sellado de `started_at`/`completed_at`; PROVISIONING no se cancela; ACTIVE terminal; **DELETE bloqueado**; FAILED sin código rechazado |
| Mapeo externo | ACTIVE sin ID externo rechazado; guard anti-secretos en metadata |
| Política | MANUAL siempre; suscripción requerida; **pago PENDING no cuenta** |
| Flujo dedicado | WAITING_INFRA sin destino asignado → configurar → **promoción automática** → evento `INFRA_READY` |
| Precondiciones | UNHEALTHY bloquea; **UNKNOWN no bloquea**; mantenimiento con dos códigos distinguibles |
| Contexto de ejecución | Ni el super admin lo resuelve desde el cliente; las 6 funciones de servidor sin EXECUTE para `authenticated` |

### `22_v4_provisioning_rbac.test.sql` — 76 pruebas

| Bloque | Qué fija |
| --- | --- |
| Estructura | 9 tablas con RLS **habilitada y forzada**; cero escritura directa; `anon` sin ningún privilegio; **`secret_ref` sin privilegio de columna**; vistas `security_invoker`; `search_path` fijo en toda RPC definer |
| Catálogo | 11 permisos; TECH_LEAD los 11; PROVISIONING_ADMIN sin `product_owner.manage`; PRODUCT_OWNER sin ningún `.manage`; PRODUCT_OWNER no concedible como rol global |
| Super admin | Transversal por definición del contrato §13 |
| Tech Lead | Ve los 3 productos y sus 2 perfiles de credencial |
| Provisioning Admin | Opera todo, **no** reparte propiedad; la RPC se lo niega |
| **Aislamiento** | Owner de EWM: lee/ejecuta EWM, **no** eSupplier, sin permisos transversales, sin administrar ni su propia integración; RLS le devuelve una sola integración; simétrico con el owner de eSupplier |
| Viewer | Finanzas ve el estado, no ejecuta |
| Negativos | Partner y TENANT_USER: cero integraciones, cero credenciales, cero ejecución, cero salud |
| Visibilidad del cliente | El usuario del tenant ve el estado del alta de **su** tenant y ninguna base_url |
| Auditoría | Rastro con `idempotency_key` y `actor_role`; **sin claves, tokens ni Authorization**; el diff excluye `secret_ref`; cada lectura de la referencia queda auditada |

## 2. Unitarias (vitest)

| Fichero | Pruebas | Foco |
| --- | --- | --- |
| `url-guard.test.ts` | 60 | SSRF: hosts, esquemas, allowlist, composición de ruta, redirecciones |
| `provisioning.test.ts` (cliente) | 39 | Acciones por estado, tonos, validación de formulario, permisos por producto |
| `retry.test.ts` | 33 | Clasificación, backoff acotado, presupuesto total |
| `response.test.ts` | 32 | Contrato mínimo, saneado de `resources`, cuerpos inválidos |
| `errors.test.ts` | 30 | Redacción de JWT/PEM/conexión/stack; código estable; cuerpo crudo nunca guardado |
| `m2m.test.ts` | 30 | Claims, TTL con techo, algoritmos, **firma real con claves generadas en memoria** |
| `http-m2m.test.ts` | 22 | Cabeceras, reintentos con misma clave, timeout, SSRF, redirecciones, validación |
| `registry.test.ts` | 21 | Resolución por tipo, guard de ambiente, MANUAL y MOCK |
| `navigation.test.ts` | +5 | Los dos ejes distinguibles; partner sin integraciones |
| `session.test.ts` | +4 | Persona del propietario de producto sin permisos de plataforma |

## 3. E2E (Playwright)

### `v4-provisioning-orchestrator.spec.ts` — 24 pruebas

Contra la Edge Function **real** del stack local, con adaptador MOCK. Sin una
sola llamada a un SaaS.

- **Autorización antes del privilegio**: sin token 401; tenant admin con JWT
  válido 403; partner 403; **owner de otro producto 403**; id inexistente 403 sin
  revelar existencia; GET 405.
- **SHARED**: alta completa, mapeo en la base, timeline con actor y correlación,
  sin material de credencial en ningún evento, re-ejecución bloqueada,
  **cinco intentos → una solicitud**.
- **MANUAL**: no finge éxito, no crea mapeo; el registro manual escribe el mismo
  mapeo marcado como manual.
- **TENANT_DEDICATED**: WAITING_INFRA sin destino → configurar → promoción
  automática → UNHEALTHY bloquea → salud restaurada → ACTIVE.
- **Aislamiento y secretos**: cada owner ve sólo lo suyo; **nadie** lee
  `secret_ref` por PostgREST, ni el super admin; la RPC lo devuelve y lo audita;
  un owner no puede ni con su propia referencia.
- **Salud**: MOCK saludable sin llamar a nadie; sin ruta de salud → UNKNOWN; sin
  permiso → 403.

### `v4-provisioning-console.spec.ts` — 15 pruebas

Contra la aplicación real, sin mocks de red.

- Tech Lead ve el catálogo, el contrato completo y **ningún secreto** hasta
  pedirlo.
- El formulario rechaza `http://169.254.169.254` y lo explica en el acto.
- Verificar conexión no inventa un estado.
- El detalle expone correlación, idempotencia y timeline.
- No se ofrece «Provisionar» sobre algo ya activo.
- La ficha del tenant muestra su alta por producto.
- **Nueva venta no aprovisiona**, y provisioning SaaS es un destino separado.
- Owner de EWM ve EWM y no eSupplier; owner de eSupplier al revés; ninguno
  administra integraciones.
- Finanzas ve y no ejecuta.

## 4. Lo que estos tests NO cubren, y hay que decirlo

- **El contrato real de EWM.** No está confirmado, así que no se prueba contra
  él. Lo que está probado es el adaptador genérico y la configuración.
- **Un SaaS real.** Ninguna prueba sale del stack local; el HTTP_M2M se ejercita
  contra un doble de `fetch`, no contra un servidor.
- **La firma verificada por el otro lado.** Se verifica con la clave pública
  generada en el propio test; que EWM la acepte se certificará al integrar.
