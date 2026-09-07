# Renovaciones, alertas y suspensión

**Fase 11 de V2.** Migración: `20260907000700_billing_alerts_and_renewals.sql`.

---

## 1. Dos reglas que definen el diseño

### 1.1 Determinismo

`refresh_billing_alerts(p_as_of timestamptz)` recibe la fecha **como parámetro**.
Con la misma fecha y los mismos datos produce exactamente el mismo resultado.

Eso permite que un test afirme igualdad en vez de aproximaciones, y que un fallo
se reproduzca en lugar de «pasar a veces».

### 1.2 Calcular no puede apagar clientes

`refresh_billing_alerts` **nunca** cambia el estado de un tenant. Suspender es
una función aparte —`apply_due_suspensions`— que hay que llamar a propósito.

Un `SELECT` que suspende clientes como efecto colateral es la clase de sorpresa
que nadie quiere depurar a las 3 de la mañana. Verificado: tras un refresh, el
número de tenants activos es idéntico (`04_v2_business.test.sql` §23).

---

## 2. Idempotencia: `dedupe_key`

Cada alerta lleva una clave determinista, por ejemplo:

```
<subscription_id>:REQUEST_DOCUMENT:<fecha de renovación>
<invoice_id>:PAST_DUE
<invoice_id>:SUSPENSION_DUE
```

Con `unique (dedupe_key)` y `on conflict do nothing`, recalcular mil veces la
misma situación produce **una** fila. La función devuelve cuántas alertas NUEVAS
creó: en una segunda pasada con la misma fecha, 0.

---

## 3. Tipos de alerta

| Tipo | Cuándo se genera | Severidad |
|---|---|---|
| `REQUEST_DOCUMENT` | Faltan `document_lead_days` para la renovación y no hay OS/OC vigente que la cubra | WARNING |
| `RENEWAL_NOTICE` | Faltan `renewal_notice_days` para la renovación | INFO |
| `DOCUMENT_EXPIRING` | Una OS/OC aprobada vence dentro del lead | WARNING |
| `PAYMENT_DUE` | Factura emitida, vencimiento dentro de `payment_due_days` | INFO |
| `PAST_DUE` | Vencida y dentro de la gracia | WARNING |
| `GRACE_ENDING` | Quedan ≤ 3 días de gracia | CRITICAL |
| `SUSPENSION_DUE` | Gracia terminada y sigue impaga | CRITICAL |
| `PAYMENT_FAILURE` | El proveedor reportó un cobro fallido | CRITICAL |

---

## 4. Cálculo de la renovación

`next_renewal_date(started_on, ends_on, billing_interval, as_of)`:

1. Si hay `ends_on` explícito, **manda**.
2. `ONE_TIME` no renueva: devuelve `NULL`.
3. Si no, se proyecta desde `started_on` en saltos del intervalo.

Se usa `age()` y **no** `epoch / 30 días`: un mes no son 30 días, y con epoch el
aniversario se desplazaría unos días cada año. En el propio día de aniversario
la renovación es **hoy**, no el periodo siguiente.

---

## 5. Suspensión

`apply_due_suspensions(p_as_of, p_mode)`:

- solo actúa sobre alertas `SUSPENSION_DUE` cuya política declara `auto_suspend`;
- **sin `auto_suspend`, la alerta es una sugerencia para una persona** y la
  función la cuenta como `skipped`;
- una licencia base de partner (sin tenant) no tiene nada que apagar: `skipped`;
- un tenant que ya estaba suspendido cierra la alerta sin repetir la acción;
- cada suspensión pasa por `request_tenant_suspension`, que cambia el estado
  **y** encola una solicitud `SUSPEND_TENANT` en DRY_RUN, en la misma
  transacción, con motivo auditable.

Verificado de las dos formas: con `auto_suspend` → `applied: 1`, tenant
`SUSPENDED`, solicitud encolada, y una segunda pasada `applied: 0`. Sin
`auto_suspend` → `skipped: 1` y el tenant sigue `ACTIVE`.

---

## 6. Resolución automática

El trigger `payments_resolve_alerts` cierra las alertas de una factura cuando el
cobro la completa. Un pago **parcial** no cierra nada: la factura sigue vencida
por el resto.

Sin esto, el tablero se llenaría de alertas zombis que ya nadie mira.

---

## 7. Activación por cron en producción

**Deliberadamente NO programado.** La migración deja el `cron.schedule`
documentado y comentado:

```sql
select cron.schedule('ebim-billing-alerts', '0 6 * * *',
  $$ select platform.refresh_billing_alerts(); $$);

select cron.schedule('ebim-billing-suspensions', '30 6 * * *',
  $$ select platform.apply_due_suspensions(now(), 'DRY_RUN'); $$);
```

Requiere `create extension pg_cron` y **autorización explícita del operador**.
Activar un cron que suspende clientes es una decisión de negocio, no un efecto
colateral de aplicar una migración.

---

## 8. Dónde se ve

`/renewals`, con dos botones deliberadamente separados:

- **Recalcular alertas** — idempotente, inocuo.
- **Aplicar suspensiones** — la única acción que apaga clientes, con confirmación.

Y el tablero de cartera por ventana (7/15/30/45/60 días) con los estados
vencida / en gracia / suspensión pendiente.
