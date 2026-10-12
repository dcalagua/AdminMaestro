# Contrato de ciclo de vida con las apps de la suite (propuesta v1)

Estado: **PROPUESTA** para acordar con los equipos de EWM, TMS, eSupplier, Comerza, eChange,
eExpense, eCommerce y GMAO. MasterAdmin ya emite la señal (§2); falta el lado de cada app (§3).

## 1. Por qué

MasterAdmin decide quién puede operar cada app: suspende por impago y reactiva al pagar
(`docs/runbooks/tenant-lifecycle.md`). Hoy la única vía hacia la app es el snapshot de entitlements,
y su `appActive=false` solo deniega las funciones de pago (D-14). Un cliente moroso sigue entrando.

## 2. Lo que MasterAdmin ya envía (sin cambios en la app)

- Snapshot de entitlements con `appActive` = `tenant.status = 'ACTIVE'` y la app contratada
  (`platform.is_tenant_app_active`).
- Cada cambio de estado del tenant marca el snapshot como cambiado: el próximo push (cada 5 minutos con
  el job `ebim-entitlement-sync`) lo entrega.
- El checksum JCS cambia con `appActive`, así que el GET de verificación detecta si la app no lo aplicó.

**Primer paso recomendado (sin contrato nuevo):** cada app, al recibir `appActive=false`, deja de
permitir el uso operativo y no solo las funciones de pago:

| Comportamiento con `appActive=false` | Obligatorio |
|---|---|
| Login permitido, con un aviso «Cuenta suspendida: contacte a su administrador» | sí |
| Lectura de datos propios (exportar, consultar) | sí, por 30 días: evita secuestro de datos |
| Escritura operativa (crear, aprobar, mover inventario, emitir) | **bloqueada** |
| Integraciones y API M2M del cliente | bloqueadas (HTTP 423 `TENANT_SUSPENDED`) |
| Jobs programados del tenant | pausados |
| Al volver `appActive=true` | todo se reanuda sin intervención |

## 3. Extensión v1 del contrato de provisioning (opcional, para corte inmediato)

Para no depender del intervalo de sincronización, el adaptador `http-m2m` puede sumar dos
operaciones idempotentes con el mismo token ES256 y la misma audiencia del alta:

```
POST {base_url}/tenants/{externalTenantId}/suspend
POST {base_url}/tenants/{externalTenantId}/activate

{ "requestId": "<uuid de la suspensión>", "reason": "NON_PAYMENT" | "MANUAL", "effectiveAt": "<ISO-8601>" }
```

- Respuesta `200 {"status":"SUSPENDED"|"ACTIVE"}` también si ya estaba en ese estado (idempotente por
  `requestId`).
- `404` si el tenant no existe; `409` si está dado de baja.
- La app que no implemente estas rutas sigue funcionando con §2: MasterAdmin mantendrá el snapshot
  como fuente de verdad y las rutas como aceleración.

Al acordarlo, en MasterAdmin: añadir `suspend`/`activate` a `ProvisioningAdapter`
(`supabase/functions/_shared/provisioning`), que el worker procese `SUSPEND_TENANT`/`RESUME_TENANT`
contra el adaptador del producto y una capacidad por integración (`supports_lifecycle`) para saber
a qué apps llamar.

## 4. Certificación por app

Para cada app, en DEV y luego en QAS:

1. Tenant de prueba en `DUAL_READ` o superior.
2. Suspender desde el Centro de la suite → en ≤ 5 min la app bloquea la escritura (§2).
3. Registrar un pago que salda la deuda → la app vuelve a operar sin intervención.
4. Evidencia en `docs/superpowers/evidence/<fecha>-<app>-lifecycle-certification.md`.
