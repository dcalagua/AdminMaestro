# MasterAdmin como orquestador de provisioning — informe de la fase

**Fecha:** 2026-09-15 · **Rama:** `dev` · **Sin cambios remotos.**

## 1. Qué había y qué hay

MasterAdmin sabía **que** un cliente había contratado EWM. No sabía **si existía
dentro de EWM**, ni tenía forma de crearlo. El alta se hacía a mano, sin
registro, sin identificadores cruzados y sin nadie capaz de responder «¿está dado
de alta?» sin abrir el producto.

Ahora hay un plano de provisioning completo: configuración administrable desde la
consola, un orquestador server-side que autoriza antes de tener privilegios, un
contrato estándar agnóstico del producto, y un historial auditado de cada intento.

**Sin tocar EWM, sin llamar a ningún servicio real y sin mover `origin`.**

## 2. Decisiones que valía la pena tomar

**Dos ejes de provisioning, no uno.** El baseline ya tenía una cola de
infraestructura. Fusionarla con el alta de aplicación habría roto su máquina de
estados y sus pruebas, y habría mezclado dos preguntas distintas. Conviven, y la
consola las nombra de forma distinguible.

**La capa de permisos es aditiva.** El baseline autoriza por rol enumerado.
Reescribirlo para tener permisos con nombre habría tocado 37 migraciones y 537
pruebas. La capa nueva gobierna **sólo** este subsistema; ningún rol existente
cambió de alcance.

**El adaptador HTTP_M2M es genérico, y EWM no tiene código propio.** Si el
contrato genérico alcanza —y alcanza—, escribir un adaptador de EWM sería meter
código específico de producto en un Control Plane que existe para no tenerlo.

**`secret_ref` es una referencia por CHECK, no por acuerdo.** Un PEM, un JWT o
una clave base64 no pasan la expresión regular. La promesa es verificable, y hay
un test que la verifica ejecutando como superusuario.

**`UNKNOWN` no bloquea el provisioning.** Hay productos sin `/health`, y marcar
`HEALTHY` lo que nadie ha comprobado es peor que no tener estado.

## 3. Lo que este trabajo NO hace

- **No crea infraestructura cloud.** Ni Supabase, ni AWS, ni DNS. Registrar y
  orquestar sí; aprovisionar máquinas, no.
- **No implementa el contrato final de EWM**, porque no está confirmado. Lo que
  hay es el adaptador genérico y un borrador de configuración deshabilitado.
- **No llamó a ningún servicio real.** MOCK en DEV; el HTTP_M2M se ejercita
  contra un doble de `fetch`.
- **No implementa `suspend`/`activate`.** Inventar esa semántica sin acuerdo con
  los productos sería crear algo que después habría que romper.

## 4. Gates (medición fresca, no reutilizada)

| Gate | Baseline V3.2 | Tras V4 |
| --- | --- | --- |
| `db:reset` | PASS | PASS |
| `db:test` | 537/537 | **719/719** |
| `npm test` | 169/169 | **445/445** |
| `npm run e2e` | 74/74 | **113/113** |
| `typecheck` / `lint` / `build` | PASS | PASS |
| `secrets:scan` | PASS | PASS (9 exenciones justificadas por línea) |

Las 37 migraciones históricas verificadas por SHA-256: **intactas**. 6 migraciones
nuevas.

## 5. Siete defectos que encontraron las pruebas

Ninguno salió de una revisión de código; todos de un test en rojo. Detalle en
[SECURITY_AUDIT.md](../nightly-provisioning-masteradmin/SECURITY_AUDIT.md).

El más instructivo: el primer intento concedía EXECUTE con un bucle sobre el
schema — el mismo patrón que usa el baseline — y eso **reabrió** permisos que
V2.1 y V3 habían revocado a propósito. Los tests del baseline lo detectaron de
inmediato. Es un buen argumento para que las pruebas de seguridad comprueben
ausencias, no sólo presencias.

## 6. Qué falta para conectar EWM

Nada de código:

1. confirmar el contrato con el equipo de EWM (payload y respuesta ya están
   especificados en [ADAPTERS.md](./ADAPTERS.md));
2. completar `ewm-provisioning-v1` desde la consola;
3. cargar `EWM_QAS_M2M_PRIVATE_KEY` en los secrets del servidor y publicar la
   pública en EWM;
4. habilitar el perfil de credencial y marcar `ewm-shared-qas` como READY;
5. verificar conexión y provisionar un tenant de prueba.

Si en el paso 1 apareciera semántica que el contrato genérico no expresa,
**entonces** —y sólo entonces— se escribiría un adaptador específico.

## 7. Riesgos abiertos

| Riesgo | Mitigación actual |
| --- | --- |
| El contrato de EWM difiere de lo previsto | Todo es configuración; adaptar es editar filas |
| El secreto de firma no se carga y nadie se entera | El destino no puede declararse READY sin credencial habilitada; el bloqueo tiene código propio |
| Alguien configura un MOCK en QAS | Bloqueado en tres capas independientes |
| Un operador pega la clave en el campo de la referencia | CHECK en la base + mensaje explícito en la RPC y en el formulario |
| Dos destinos válidos para el mismo tenant | Se declara la ambigüedad; nunca se desempata |

## 8. Veredicto

**READY_FOR_EWM_ADAPTER.**

No por compilar: por tener 182 pruebas de base nuevas, 276 unitarias y 39 E2E que
ejercitan aislamiento por producto, SSRF, idempotencia, resolución de destino,
máquina de estados y la frontera de secretos contra la base y la Edge Function
reales.
