# Informe final · Fase V2.1 de hardening

Fecha: 2026-09-07 · Alcance: seguridad del cobro + integración real con Culqi TEST.

---

## Resumen en un párrafo

Se auditó el estado que la V2 declaraba `GO_WITH_GAPS`, **sin darlo por bueno**.
Se encontraron y corrigieron **ocho fallos** —cinco de seguridad, tres de
corrección funcional— y **seis más** aparecieron al ejercitar el código contra
la pasarela real. Tres de ellos habrían impedido cobrar por tarjeta y no eran
visibles en modo MOCK: los endpoints de recurrencia no existen, las fechas se
leían en la unidad equivocada y el cobro recurrente se archivaba «sin efecto
contable». La integración está ahora ejecutada de extremo a extremo contra Culqi
TEST, con identificadores reales.

---

## Lo que había que corregir, y qué era en realidad

| Id | Severidad | Titular | Consecuencia real si no se corrige |
|---|---|---|---|
| F-01 | **CRÍTICA** | `EBIM_FINANCE` podía inventar un cobro de pasarela | Pago CONFIRMED falso + comisión pagadera, indistinguible de uno real |
| F-02 | ALTA | `ORG_ADMIN` podía reapuntar su mapeo de cobro | Cobros ajenos imputados a su factura |
| F-03 | ALTA | «Sin error de RLS» se tomaba por «autorizado» | Cualquier autenticado accedía a la reconciliación, y luego se creaba un cliente `service_role` |
| F-04 | ALTA | El navegador elegía la cuenta de comercio | Alta de tarjeta contra la cuenta de otro partner |
| F-05 | ALTA | `provisioning-worker` no miraba el rol | Cualquier autenticado accionaba el provisioning |
| F-06 | ALTA | Endpoints de recurrencia inexistentes | La domiciliación nunca habría funcionado |
| F-07 | ALTA | Fechas siempre leídas como milisegundos | `next_billing_date` en 1970; Renovaciones vacía, sin error |
| F-08 | ALTA | El cobro recurrente clasificado como cambio de estado | **Ninguna renovación generaba pago ni comisión**, en silencio |

Y lo que apareció al verificar: las tres Edge Functions autenticadas devolvían
401 a todo el mundo (cabecera duplicada), un alta fallida bloqueaba al cliente
para siempre, `next_billing_date` no viene en la creación, el estado se guardaba
como número contra un `= 'active'` textual, una coma invalida el nombre de un
plan, y los fixtures de facturación nunca se aplicaban. Detalle en
`SECURITY_FIXES.md`.

---

## Qué se entrega

**Dos migraciones nuevas** (las 21 anteriores intactas):

- `20260908000100_v2_1_provider_server_only.sql` — `is_service_context()`,
  las tres RPC de proveedor pasan a server-only con revocación de EXECUTE,
  validación de moneda, y `can_run_provisioning()`.
- `20260908000200_billing_contact.sql` — los cinco campos de facturación que
  la pasarela exige y el Control Plane no tenía, con CHECK alineados a los
  límites medidos, vista de preparación y RPC de actualización.

**Un módulo nuevo**, `culqi-mapping.ts`, que aísla toda traducción a la pasarela
con la medición que la respalda al lado de cada constante. Es el archivo donde
vive lo que, si se asume mal, produce un error caro y silencioso.

**Cuatro Edge Functions corregidas**, una pantalla nueva de datos de facturación,
y **22 pgTAP + 22 unitarios + 2 E2E** nuevos, cada uno nombrado por el fallo que
evita y no por la función que llama.

---

## Estado de las puertas

| | V2 | V2.1 |
|---|---|---|
| Migraciones | 21 | **23** |
| pgTAP | 102 | **124** |
| Unitarios | 32 | **54** |
| E2E | 39 | **41** |
| typecheck / lint / build / secretos | PASS | **PASS** |
| Modo de cobro verificado | MOCK | **TEST real, extremo a extremo** |

Cero tests omitidos. Detalle y evidencia en `QUALITY_GATE_V2_1.md`.

---

## Lo que sigue abierto

| Hueco | Estado |
|---|---|
| Entrega del webhook desde los servidores de Culqi | `BLOCKED_EXTERNAL: WEBHOOK_HTTP_TEST` — no hay despliegue público. Se ejercitó HTTP real contra la función, no la entrega del proveedor |
| 3-D Secure con desafío real | No reproducible con la tarjeta de prueba. El código detiene la domiciliación si la tarjeta no queda activa, pero ese camino no se ejecutó |
| Estados 2 y 5 de suscripción | Sin observar; se traducen a `unknown` en vez de adivinarse |

Ninguno bloquea QAS. Los tres son «no se pudo ejecutar», no «no se implementó».

---

## Una nota sobre el método

El encargo decía: «no confíes ciegamente en el FINAL_REPORT anterior». Esa
instrucción es la que produjo este informe. Los cinco fallos de seguridad
estaban en código que el informe V2 describía correctamente —las RPC **son**
`SECURITY DEFINER` y **sí** están auditadas— pero que nadie había intentado
llamar desde el rol equivocado. Y los tres fallos de la pasarela vivían detrás
de un modo MOCK que devolvía verde a todo.

La diferencia entre «revisado» y «ejecutado» son, en este caso, ocho fallos.

**Veredicto: GO_QAS.**
