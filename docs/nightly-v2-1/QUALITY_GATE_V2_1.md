# Quality gate V2.1

Todo lo de abajo se ejecutó en esta fase. **Nada está marcado PASS por
inferencia**: si una casilla dice PASS es porque hay una salida de comando
detrás.

## Puertas automáticas

| Puerta | Comando | Resultado |
|---|---|---|
| Migraciones | `npm run db:reset` | **PASS** — 23 migraciones aplicadas, seed cargado |
| pgTAP | `npm run db:test` | **PASS** — 6 ficheros, **124 tests**, 0 fallos, 0 omitidos |
| Unitarios | `npm test` | **PASS** — 4 ficheros, **54 tests** |
| E2E | `npm run e2e` | **PASS** — **41 tests** |
| Tipos | `npm run typecheck` | **PASS** — sin errores |
| Lint | `npm run lint` | **PASS** — sin avisos |
| Build | `npm run build` | **PASS** — `dist/` generado |
| Secretos | `npm run secrets:scan` | **PASS** — sin credenciales en repositorio ni bundle |
| Tipos de Deno | `deno check` sobre los módulos de pago | **PASS** |

Crecimiento respecto de la V2: pgTAP 102 → **124**, unitarios 32 → **54**, E2E
39 → **41**. Cero tests omitidos o marcados como pendientes.

## Verificaciones ejecutadas contra sistemas reales

| Qué | Contra qué | Resultado |
|---|---|---|
| Alta completa de suscripción | API TEST de Culqi | **PASS** en las 3 periodicidades |
| Cadencia de facturación | Distancia real al próximo cobro | **PASS** — 30 / 91 / 365 días |
| Verificación de cargo | API TEST de Culqi | **PASS** — confirma el real, rechaza el inventado |
| Webhook de cobro recurrente | HTTP real sobre `functions serve` | **PASS** — pago + comisión |
| Idempotencia del webhook | HTTP real, evento reenviado | **PASS** — un solo pago |
| Autorización de las 3 funciones | HTTP real, 4 roles distintos | **PASS** |

## Invariantes de seguridad, comprobados

| Invariante | Comprobación | Resultado |
|---|---|---|
| Ninguna RPC de proveedor expuesta a `authenticated`/`anon` | pgTAP sobre `has_function_privilege` | **PASS** — 0 |
| `service_role` conserva EXECUTE en las tres | pgTAP | **PASS** |
| Toda función `SECURITY DEFINER` con `search_path` fijo | pgTAP en bucle sobre el schema | **PASS** — 0 sin él |
| RLS + FORCE en todas las tablas de `platform` | pgTAP `00_structure` | **PASS** |
| Las 21 migraciones baseline sin modificar | `git diff --name-only HEAD` | **PASS** — vacío |
| Ninguna clave Culqi en el árbol ni en el historial | `git grep`, `git log -S` | **PASS** — sin coincidencias |
| Ningún uso de credenciales LIVE | El adapter aborta ante `sk_live_`/`pk_live_` | **PASS** |

## Lo que NO está cubierto

| Hueco | Por qué | Riesgo |
|---|---|---|
| Webhook entregado por Culqi **desde internet** | Requiere un despliegue accesible públicamente, que no existe. Se ejercitó HTTP real contra la función, no la entrega del proveedor | Bajo. Lo no cubierto es el transporte y el formato exacto que envía Culqi; el clasificador acepta patrones, no literales |
| 3-D Secure con desafío real | La tarjeta de prueba no lo dispara | Medio. El código detecta la tarjeta no activa y detiene la domiciliación en vez de darla por buena; ese camino no se pudo ejecutar |
| Códigos de estado 2 y 5 de suscripción | No observados | Bajo. Se traducen a `unknown` en vez de adivinarse |
| Cobro recurrente esperando 30 días | Evidente | Bajo. El cobro se verificó con un cargo real; lo no observado es el disparo automático de la pasarela |

## Veredicto

**GO_QAS** — con los cuatro huecos anteriores documentados y sin ninguno de
ellos bloqueante para un entorno de QA.
