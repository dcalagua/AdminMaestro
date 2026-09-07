# Correcciones de seguridad V2.1

Ocho fallos. Todos **confirmados ejecutándolos** contra el stack local y, los
que tocan la pasarela, contra la API TEST real de Culqi. Ninguno se dedujo
leyendo código.

---

## F-01 · CRÍTICO · Un rol humano podía inventar un cobro de pasarela

**Qué pasaba.** `EBIM_FINANCE` llamaba a `platform.register_provider_payment()`
por PostgREST y obtenía `accepted: true` con una fila real en `payments` en
estado `CONFIRMED`, indistinguible de un cobro de Culqi. Y `payments.CONFIRMED`
es exactamente el disparador del devengo de comisión.

**Por qué importa.** No es «un rol con muchos permisos». Es que un cobro que
nunca ocurrió entra en la contabilidad, genera factura, genera comisión
pagadera, y queda registrado como si lo hubiera afirmado la pasarela. La
auditoría posterior no puede distinguirlo de uno legítimo.

**Corrección.** `platform.is_service_context()` (migración 22): las tres RPC de
proveedor exigen `service_role` o `postgres` y, además, se les revoca EXECUTE a
`public`, `anon` y `authenticated`. Dos candados: el `if` dentro de la función y
el permiso que PostgREST necesitaría para exponerla.

**Verificado.** `05_v2_1_hardening.test.sql` pruebas 1-2 (`42501`), 10-11
(nadie salvo `service_role` tiene EXECUTE). El camino legítimo sigue abierto:
prueba 3, `confirm_manual_payment()` funciona para `EBIM_FINANCE`.

---

## F-02 · ALTO · Un cliente podía reapuntar su propio mapeo de cobro

**Qué pasaba.** `upsert_provider_subscription()` era ejecutable por
`authenticated`. Un `ORG_ADMIN` podía apuntar su contrato a la suscripción de
otro en la pasarela; a partir de ahí, cobros ajenos se registraban contra su
factura.

**Corrección.** Mismo `is_service_context()` y misma revocación de EXECUTE.

**Verificado.** Pruebas 4-5: falla para `ORG_ADMIN` **y para el super admin**.
Prueba 6: el contexto de servicio la conserva, así que el webhook sigue
operando.

---

## F-03 · ALTO · `payment-reconcile` confundía «sin error» con «autorizado»

**Qué pasaba.** El control de acceso era un `select` sobre una tabla con RLS
seguido de «si `error == null`, adelante». Una política RLS que no concede
acceso **no devuelve error: devuelve cero filas**. `error` venía `null` para
cualquier usuario autenticado, así que un `TENANT_USER` superaba el control — y
justo después la función construía un cliente `service_role`.

**Corrección.** Se pregunta a la base por un booleano explícito
(`can_read_finance()`), comparado con `!== true` para que ni `null` ni un objeto
vacío pasen por autorización. El cliente `service_role` se crea **después** del
control, no antes.

**Verificado sobre HTTP real** (`supabase functions serve`):

| Rol | Respuesta |
|---|---|
| `TENANT_USER` | 403 `NO_AUTORIZADO` |
| `ORG_ADMIN` de cliente | 403 `NO_AUTORIZADO` |
| `EBIM_FINANCE` | 200, reconciliación real contra Culqi TEST (`simulated: false`) |

---

## F-04 · ALTO · El navegador elegía la cuenta de comercio

**Qué pasaba.** `payment-setup` resolvía la cuenta como
`body.provider_account_id ?? collection.provider_account_id`: un valor enviado
por el cliente **ganaba** sobre la configuración. Un cliente podía dar de alta
su tarjeta contra la cuenta de comercio de otro partner.

**Corrección.** La cuenta se deriva solo de
`subscription → collection profile → payment_provider_account`. Si la petición
trae `provider_account_id` y no coincide, se rechaza con 403 en vez de
ignorarse en silencio: una discrepancia significa que alguien lo está
intentando.

**Verificado sobre HTTP real.** 403 `CUENTA_PROVEEDOR_NO_COINCIDE`.

---

## F-05 · ALTO · `provisioning-worker` no comprobaba ningún rol

**Qué pasaba.** Exigía un JWT y nada más; después creaba un cliente
`service_role`. Cualquier usuario autenticado podía accionar el worker.

**Corrección.** Dos canales explícitos: el de servidor
(`x-provisioning-secret`, comparado con la service key) y el humano, que exige
`can_run_provisioning()` — super admin o `EBIM_PRODUCT_ADMIN`.

**Verificado sobre HTTP real.**

| Quién | Respuesta |
|---|---|
| Sin JWT | 401 |
| `TENANT_USER` | 403 «Un JWT válido no es autorización» |
| `EBIM_FINANCE` | 403 (provisioning no es una función financiera) |

---

## F-06 · ALTO · La domiciliación apuntaba a endpoints que no existen

**Qué pasaba.** El adapter usaba `POST /plans` y `POST /subscriptions`. Medido
contra la API TEST: **400 y 401 respectivamente**. Los correctos son
`/recurrent/plans/create` y `/recurrent/subscriptions/create`.

**Consecuencia real.** La recurrencia con tarjeta nunca habría funcionado. Como
el sistema operaba en MOCK, el fallo estaba a la espera del día en que se
cargaran credenciales de producción.

**Corrección y verificación.** Reescrito contra los endpoints reales; alta
completa Plan → Customer → Card → Subscription ejecutada en TEST para las tres
periodicidades. Ver `CULQI_TEST_EVIDENCE.md`.

---

## F-07 · ALTO · Las fechas se leían siempre como milisegundos

**Qué pasaba.** `toIso()` asumía epoch en milisegundos. Culqi **mezcla unidades
en la misma API y en la misma sesión**: `plan.creation_date` = 1788795734
(segundos), `token.creation_date` = 1788795802323 (milisegundos).

**Consecuencia real.** `1656201600` se convertía en el **20 de enero de 1970**.
Un `next_billing_date` en 1970 no falla ruidosamente: se guarda tan tranquilo y
vacía la pantalla de Renovaciones, que es justo la que avisa de los cobros que
vienen.

**Corrección.** `normalizeCulqiTimestamp()`, con umbral 10^12 (que corresponde a
2001 en milisegundos y al año 33658 en segundos: ninguna fecha real es ambigua).

**Verificado.** 5 pruebas unitarias sobre los valores reales medidos.

---

## F-08 · ALTO · El cobro recurrente se archivaba «sin efecto contable»

**Qué pasaba.** La clasificación evaluaba `type.startsWith('subscription.')`
**antes** de mirar si el evento era un cobro. `subscription.charge.succeeded`
—la renovación de tarjeta, el evento que mueve el dinero— caía en
`SUBSCRIPTION_UPDATED`.

**Consecuencia real.** Ninguna renovación habría generado `payments` ni
comisión. En silencio, en cada renovación, de cada cliente, sin un solo error en
el log. El síntoma habría sido «el MRR no sube» meses después.

**Corrección.** `classifyCulqiEvent()` comprueba primero lo específico
(`*.charge.*`) y solo después el prefijo genérico. **El orden de esas ramas es
la corrección.**

**Verificado sobre HTTP real**, con un cargo real de Culqi TEST:

```
POST /culqi-webhook  {"type":"subscription.charge.succeeded", ...}
→ {"accepted":true,"kind":"PAYMENT_SUCCEEDED","mode":"TEST",
   "result":{"accepted":true,"commission_events":1}}
```

Y en la base: `payments` CONFIRMED de 450,00 USD y una comisión `ELIGIBLE` de
45,00 USD. Exactamente la cadena que el fallo interrumpía.

---

## Hallazgos adicionales encontrados al verificar

Ninguno de estos estaba en el encargo; aparecieron al ejercitar el código real.

### A-01 · Las tres Edge Functions autenticadas devolvían 401 a todo el mundo

La cabecera global se pasaba como `authorization` en minúscula, mientras
supabase-js escribe `Authorization`. La cabecera se **duplicaba**, la puerta de
enlace respondía «Bad request» en texto plano y el cliente lo reportaba como
error de autenticación. Resultado medido: 401 incluso para `EBIM_FINANCE` con un
JWT válido. Falla cerrado —no abría ningún hueco— pero dejaba las tres funciones
inservibles sin decir por qué.

### A-02 · Un alta fallida bloqueaba al cliente para siempre

Culqi impone un Customer por correo. Si un primer intento creaba el Customer y
luego fallaba en la tarjeta, el mapeo local no llegaba a escribirse: el cliente
existía en la pasarela y no en nuestra base, y **todos** los reintentos
posteriores fallaban con «Un cliente está registrado actualmente con este
email», hablando de un cliente que el operador no ve por ninguna parte. Se
recupera por correo (`GET /customers?email=`).

### A-03 · `next_billing_date` no viene en la respuesta de creación

La documentación lo muestra en el ejemplo; la API real no lo devuelve. Solo el
GET lo trae. Sin una segunda consulta, `next_billing_at` se guardaba siempre
null y Renovaciones nunca mostraba una suscripción con tarjeta.

### A-04 · El estado de la suscripción es un número, y se guardaba como número

Culqi devuelve `status: 1`. El Control Plane compara `provider_status = 'active'`
en la vista de reconciliación. Guardar «1» habría marcado **toda** suscripción
con tarjeta como desviación permanente.

### A-05 · Una coma invalida el nombre de un plan

Medido carácter a carácter: `name`, `short_name` y `description` aceptan letras
(con tildes), dígitos, espacio, `-`, `.` y `_`. Rechazan `,` `:` `/` `(` `&` `#`
`+` `'` `·`. Un plan llamado «Plan Básico, anual» habría roto el alta con un
mensaje que apunta a otro sitio. Se sanea con `toCulqiText()`.

### A-06 · Los fixtures de facturación no se aplicaban

Se habían puesto en la migración 23, y las migraciones corren **antes** que
`seed.sql`: la sentencia actualizaba cero filas, sin fallar. Se detectó porque
el alta seguía respondiendo `DATOS_FACTURACION_INCOMPLETOS` con los fixtures
supuestamente cargados. Movidos a `seed.sql`.
