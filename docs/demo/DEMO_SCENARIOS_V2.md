# Guion de demostración gerencial · V2

**Duración:** ~20 minutos. **Preparación:** `npm run db:reset && npm run dev`,
después entrar en `http://127.0.0.1:5199` como `dcalagua@ebim.pe`.

> Cada paso está cubierto por un test E2E (`e2e/v2-journeys.spec.ts`), así que
> si algo falla en la demo, falla también en CI.

---

## 0. Qué se quiere demostrar

Que el Control Plane administra **toda la suite**, no eSupplier; que el canal,
la licencia y la cobranza son configurables **por datos**; y que el dinero solo
se mueve cuando alguien cobra de verdad.

---

## 1. La suite no está atada a ningún producto · 2 min

**Suite SaaS →** cinco productos. Entrar en cualquiera: seis pestañas —Resumen,
Planes, Partners, Tenants, Finanzas, Deployments—.

> «Dar de alta un sexto SaaS es insertar una fila. No hay una sola rama de
> código por producto: ni una columna `is_esupplier`.»

Si hay tiempo: **Nuevo producto**, código `efield`, nombre corto `eField`. El
lockup «eField by EBIM» se genera solo.

---

## 2. Un canal, varios SaaS, márgenes distintos · 3 min

**Partners / Resellers → Consultora Andina → Productos autorizados.**

Se ven acuerdos separados por producto, cada uno con su margen, sus modelos
permitidos, su tope de tenants y quién factura.

> «El mismo partner vende eSupplier al 25 % y WMS al 18 %. Son dos acuerdos, no
> dos partners. Y el acuerdo *acota*: si solo autoriza SHARED, la base rechaza
> un alta dedicada.»

Mostrar la columna **Tenants**: «5 en compartido».

> «Tener veinte clientes en infraestructura compartida no convierte a un partner
> en Dedicated. Lo decide el modelo del tenant, no el volumen.»

---

## 3. Una venta, una transacción · 4 min

**Nueva venta.** Recorrer los cinco pasos con un cliente real.

En el paso 4 poner **1500** de fee de implementación. En el resumen señalar:

> «La implementación aparece como cargo único, separada del MRR. Si se colara
> como mensual, el MRR quedaría inflado para siempre — y la base directamente lo
> rechaza.»

Crear. Aterriza en el tenant.

> «Eso fue *una* transacción de base de datos: tenant, suscripción, licencia,
> fee, atribución comercial y la solicitud de provisioning en DRY_RUN. Si
> cualquier paso falla, no queda nada a medias.»

---

## 4. El caso que justifica el modelo de cobranza · 4 min

**Clientes → GRUPASA → Vista 360.**

Tarjeta superior: **«Métodos de cobro distintos: 2»**.

Tabla **Cobranza por SaaS**:

| Producto | Método | Renueva | Documento |
|---|---|---|---|
| eSupplier | Tarjeta (Culqi) | … | No aplica |
| EWM | Orden de Servicio | … | Aprobada |

> «Mismo cliente, dos productos, dos formas de cobrar. Si el método colgara del
> cliente en vez de la suscripción, este caso —que es el caso real— no se podría
> ni representar.»

Bajar por la vista 360: cobros confirmados, comisiones con su origen,
margen por moneda, provisioning.

> «Esto es lo que gerencia pregunta sobre una cuenta, en una sola pantalla.»

---

## 5. Una Orden de Servicio aprobada NO es un cobro · 3 min

**Suscripciones y licencias → SUB-GRUPASA-EWM → Cobranza.**

Mostrar la OS `OS-2026-0455` aprobada, con sus hitos.

Cambiar a **Facturación y cobros**: no hay cobro confirmado por ella.

> «Aprobar la OS habilita el trámite. No mueve dinero, no marca la factura como
> pagada y no devenga ni un sol de comisión. Hay un test que cuenta los pagos y
> las comisiones antes y después de aprobar: los dos números son idénticos.»

Enseñar también `SUB-P1-EWM` (recibida, pendiente de aprobar) y la OC de
`SUB-P2-ESUP` (solicitada, aún sin número).

---

## 6. Culqi: honestidad sobre el estado real · 2 min

**SUB-GRUPASA-ESUP → Cobranza → Cobro con tarjeta.**

> **«Culqi pendiente de configurar.»**

> «No hay credenciales, así que el adapter opera en modo simulado y la consola
> lo dice. No finge que el cobro está operativo. Los pasos exactos para
> activarlo están en el checklist de la documentación.»

**Reconciliación → Eventos del proveedor**: un evento `IGNORED`.

> «Esa es la idempotencia funcionando: una entrega repetida del mismo webhook no
> genera un segundo cobro. Está probado con cinco entregas seguidas: un pago,
> una comisión.»

---

## 7. Cobranza operativa · 3 min

**Renovaciones y alertas.**

Ventanas 7/15/30/45/60, vencidas, en gracia, suspensión pendiente.

Pulsar **Recalcular alertas** dos veces:

> «La segunda vez dice "nada nuevo". El cálculo es idempotente: no duplica
> trabajo pendiente, y —esto es lo importante— *no suspende a nadie*. Suspender
> es un botón aparte, y solo actúa donde la política del cliente lo autoriza.»

---

## 8. La seguridad no es el menú · 3 min

Salir y entrar como `admin@andina.ebim.test` (partner).

- No hay «Costos y margen», ni «Reconciliación», ni «Nueva venta».
- **Todas las organizaciones**: solo aparece Consultora Andina.

> «No es que el menú lo esconda: es que la base no devuelve esas filas. Si
> forzara la URL, vería una pantalla vacía; y si llamara a la API directamente,
> recibiría un 42501.»

Demostrarlo: ir a `/onboarding` escribiendo la URL. Sale «Tu rol no tiene acceso
a esta sección».

Entrar como `comercial@indep.ebim.test`:

> «Ve sus comisiones, y ni un tenant. Vender no da acceso operativo: ese
> invariante tiene un test dedicado que comprueba que la venta no crea ninguna
> membresía.»

---

## Cierre

| Lo que está listo | Lo que falta |
|---|---|
| Suite, canal, licenciamiento, cobranza, OS/OC, renovaciones, comisiones con reverso, reconciliación | **Credenciales Culqi**: el cobro con tarjeta está en simulación |
| 102 tests de base de datos, 32 unitarios, 39 E2E | Provisioning LIVE: pendiente de autorización del operador |
| RLS + FORCE en las 48 tablas, sin secretos en base | FX para consolidar monedas: fuera de alcance de V2 |

> «Nada de lo que se ve aquí está mockeado salvo la pasarela de pago, y eso está
> escrito en la propia pantalla.»
