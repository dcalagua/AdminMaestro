# V3.2 · Contrato recurrente futuro en `payment-setup` (P1-B)

## 1. Causa raíz (confirmada antes del fix)

`recurringCardAmount` (V3.1, `recurring-amount.ts:31-36`) solo miraba las líneas vigentes **en la
fecha de hoy** (`valid_from <= asOf`). El test V3.1 «no domicilia líneas vencidas ni futuras»
consideraba correcto aceptar una línea YEARLY con `valid_from` futuro junto a una MONTHLY actual.

Un Plan del proveedor cobra un importe fijo cada intervalo y no se reprovisiona solo. Por eso:

| Contrato conocido hoy | V3.1 | Consecuencia |
|---|---|---|
| LICENSE MONTHLY desde hoy + SUPPORT YEARLY en 3 meses | Domicilia MONTHLY | A los 3 meses el contrato mezcla MONTHLY y YEARLY, pero el Plan solo cobra la licencia: **subcobro** del soporte |
| LICENSE MONTHLY + ADDON MONTHLY en 3 meses | Domicilia el importe actual | El Plan no cobra el addon: **subcobro** |
| Línea MONTHLY con `valid_to` antes del fin del contrato | Domicilia la suma actual | Tras `valid_to` se sigue cobrando: **sobrecobro** |

Evidencia: `evidence/phase1-e2e-payment-setup-before-fix.txt` (la función real respondió 200 en
«MONTHLY vigente + YEARLY futuro» y en «addon MONTHLY en 3 meses») y
`evidence/phase8-unit-recurring-before-fix.txt`.

## 2. Regla V3.2 (FAIL-SAFE)

`recurringCardAmount(items, subscriptionInterval, asOf, contractEndsOn)`:

1. **Líneas relevantes**: las no ONE_TIME, salvo las que terminaron antes de hoy
   (`valid_to < asOf`) y las que empiezan después del fin del contrato (`valid_from > ends_on`). Se
   incluyen las de `valid_from` futuro. `subscription_items` no tiene estado propio: la cancelación
   de una línea es su `valid_to`.
2. **Cadencia**: si alguna línea relevante no tiene la periodicidad de la suscripción →
   `CADENCIA_MIXTA_NO_DOMICILIABLE`. Cubre MONTHLY+YEARLY, MONTHLY+QUARTERLY, QUARTERLY+YEARLY,
   etc., vigentes o futuras, incluido el caso en que ninguna está vigente hoy.
3. **Estabilidad del importe**: el total recurrente (en céntimos) solo puede cambiar el día en que
   una línea empieza o el día siguiente a su `valid_to`. Se evalúa el total en cada una de esas
   fechas posteriores a hoy y hasta `ends_on`. Si alguna difiere del total de hoy →
   `MONTO_RECURRENTE_FUTURO_VARIABLE` (con `changes_on`, la primera fecha distinta). Incluye:
   - una línea que empieza más adelante (el total sube);
   - una línea que termina antes que el contrato (el total baja);
   - nada vigente hoy y una línea futura (de 0 a X);
   - una sustitución con un día sin cobertura.
4. Sin importe → `SIN_IMPORTE_RECURRENTE`.

Se **permite** (fase 10):

- LICENSE MONTHLY que termina el día D + LICENSE MONTHLY del **mismo importe** desde D+1;
- cambios que se compensan el mismo día;
- cambios posteriores a `ends_on`;
- ONE_TIME presentes o futuros, que no cuentan.

No se crean varias suscripciones en Culqi ni hay reprovisioning programado del Plan: ese esquema
de cobro no existe y no se inventa en V3.2.

## 3. Respuesta de `payment-setup`

HTTP 409 antes de hablar con el PSP y antes de crear o buscar ningún Plan. No se escribe ningún
mapeo.

```json
{ "error": "CADENCIA_MIXTA_NO_DOMICILIABLE",
  "message": "La suscripción contiene cargos recurrentes con distintas periodicidades y no puede domiciliarse mediante un único plan." }

{ "error": "MONTO_RECURRENTE_FUTURO_VARIABLE",
  "message": "El importe recurrente cambiará durante la vigencia del contrato. Esta configuración requiere un esquema de cobro distinto.",
  "changes_on": "2026-12-01" }
```

Los mensajes (`RECURRING_ERROR_MESSAGES`) no llevan detalles del PSP; un test lo comprueba. Hoy
ninguna pantalla de `src/` invoca `payment-setup`, así que no hizo falta UI nueva (fase 23): el
consumidor recibe `message` listo para mostrar.

Antes el cuerpo de `CADENCIA_MIXTA_NO_DOMICILIABLE` era `error: "CODIGO: texto técnico"`. Ahora
`error` es solo el código y el texto va en `message`, como en el resto de errores de la función
(`CUENTA_PROVEEDOR_NO_COINCIDE`, `DATOS_FACTURACION_INCOMPLETOS`).

## 4. Límites conocidos

1. **Cambios del contrato después de domiciliar.** La regla se evalúa al domiciliar. Si más tarde se
   añade o edita una línea (`upsert_subscription_item`) de una suscripción ya domiciliada, el Plan
   del PSP no cambia y nada lo bloquea todavía. No es el escenario P1-B (ahí el contrato ya se
   conocía al domiciliar), pero es el mismo tipo de riesgo. Recomendación para una fase posterior:
   rechazar cambios de importe o cadencia en suscripciones con `provider_subscriptions` ACTIVE, o
   señalarlos en la reconciliación.
2. **Fecha de referencia.** `asOf` es la fecha UTC del servidor, igual que en V3.1. Entre las
   19:00 y las 24:00 de Lima puede ser «mañana».
3. La facturación del período (V3.1) no cambia: un contrato rechazado para tarjeta se sigue
   facturando por su cadencia.
