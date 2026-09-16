# Flujo de un tenant dedicado

## 1. El problema

Vender un EWM dedicado y crear su infraestructura son dos cosas separadas por
días o semanas. Antes, esa espera no tenía representación: o se forzaba un alta
sobre infraestructura ajena, o la venta se quedaba sin rastro en el sistema.

`WAITING_INFRA` es esa espera, con nombre.

## 2. El recorrido

### Paso 1 — Comercial

Se crea el tenant y la suscripción con normalidad. **El alta comercial no
aprovisiona nada**: la pantalla de Nueva venta lo dice explícitamente y enlaza a
la pantalla correcta.

### Paso 2 — Solicitud

Infraestructura → Provisioning SaaS → Nueva solicitud. Se indica **tenant y
ambiente**, nada más.

El servidor resuelve el destino. Para un `TENANT_DEDICATED` sin infraestructura,
`resolve_deployment_target()` devuelve `DEPLOYMENT_NOT_CONFIGURED` y la RPC, en
vez de fallar, crea la solicitud en:

```
status = WAITING_INFRA
deployment_target_id = NULL
```

`NULL` es deliberado: no se le adjudica el destino de nadie más.

La consola muestra «Infraestructura pendiente» en tono de aviso, no de error.
Es un estado del negocio.

### Paso 3 — Infraestructura

Cuando existe, un Tech Lead o Provisioning Admin la registra en
Infraestructura → Deployments → Configurar provisioning:

- ambiente de provisioning;
- integración del producto;
- URL base (validada en el acto);
- perfil de credencial;
- timeout y reintentos;
- estado → **Listo**, y habilitado.

### Paso 4 — Promoción automática

Al pasar el destino a `READY`, `configure_deployment_provisioning()` promueve
**solas** las solicitudes en `WAITING_INFRA` que esperaban esa infraestructura:

```
WAITING_INFRA → READY_TO_PROVISION
```

Apuntándolas al destino recién configurado y dejando un evento `INFRA_READY` en
el timeline.

Esto no es una comodidad: si no ocurriera, alguien tendría que **acordarse** de
volver a tocar cada solicitud a mano, y esa es exactamente la clase de paso que
se olvida.

### Paso 5 — Provisionar

Botón «Provisionar». El orquestador comprueba el permiso, valida precondiciones,
marca `PROVISIONING`, llama al producto y registra el mapeo.

## 3. Si el alta física es manual

Con `integration_type = MANUAL` —producto sin API todavía, o dedicado que se
levanta a mano— el flujo es el mismo hasta el paso 5. Ahí, el botón
«Registrar manualmente» pide los identificadores que devolvió el producto.

`register_manual_provisioning()` recorre la máquina de estados **completa** en
vez de saltar a ACTIVE, y marca el mapeo con `registered_manually = true`. El
historial cuenta lo mismo que el automático.

## 4. Lo que MasterAdmin NO hace

**No crea infraestructura cloud.** No llama a la Management API de Supabase, ni
a AWS, ni crea DNS. Registrar y orquestar es su trabajo; aprovisionar máquinas,
no — al menos no en esta fase.

El provisioning de infraestructura vive en el otro eje
(`platform.provisioning_requests` y `provisioning-worker`), sigue en DRY_RUN y
no cambió en esta fase.

## 5. Verificado

`e2e/v4-provisioning-orchestrator.spec.ts`, bloque «TENANT_DEDICATED»:
Industrias Titán queda en `WAITING_INFRA` sin destino, se configura el destino
dedicado, la solicitud se promueve sola, un destino `UNHEALTHY` bloquea con
código explicable, y restaurada la salud el alta se completa.

También en pgTAP (`21_v4_provisioning_model.test.sql`, bloque 10).
