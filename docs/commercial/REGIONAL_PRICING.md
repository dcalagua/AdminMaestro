# Pricing regional (V3)

## 1. Identidad de una tarifa

```
plan + mercado + tipo de cargo + periodicidad + moneda + vigencia
```

Misma moneda en dos mercados = dos tarifas distintas. En el seed, *eSupplier Shared Standard*
cuesta **USD 850** en Perú y **USD 700** en Ecuador.

## 2. Reglas

| Regla | Enforcement |
|---|---|
| Toda tarifa nueva tiene mercado | Trigger `MERCADO_REQUERIDO` |
| La moneda está admitida por el mercado | `MONEDA_NO_PERMITIDA_EN_MERCADO` |
| Una sola tarifa abierta por combinación | Índice único `plan_prices_current_uk` |
| Vigencias de una combinación no se solapan | Exclusión GiST `plan_prices_no_overlap_ex` |
| Una tarifa no se edita (solo se cierra su vigencia) | `PRECIO_HISTORICO_INMUTABLE` |
| Una tarifa futura no se usa antes de su fecha | `current_plan_price(plan, mercado, cargo, periodicidad, moneda, fecha)` |

**Versionar** una tarifa (`set_plan_price`, EBIM_PRODUCT_ADMIN o super admin) cierra la vigente
el día anterior a la nueva y abre otra; nunca reescribe la anterior: las facturas ya emitidas se
calcularon con ella. La moneda es explícita (una tarifa no hereda la moneda sugerida).

## 3. Tarifas legacy

Las tarifas anteriores a V3 cuya moneda la admite un único mercado reciben ese mercado en la
migración (PEN → PE, BOB → BO). Las demás (típicamente USD) quedan **sin mercado**: se listan como
«Sin mercado (legacy)» y `current_plan_price` —que exige mercado— nunca las devuelve. Para vender
en un mercado hay que publicar su tarifa regional.

## 4. Venta regional

Flujo del wizard **Nueva venta** y de `onboard_customer_subscription`:

```
cliente → mercado (sugerido por país) → moneda sugerida / admitidas → plan → tarifa DEL mercado → contrato
```

- `p_market_code` es obligatorio; ya no existe `p_currency default 'USD'`.
- Sin tarifa regional vigente la venta se rechaza (`TARIFA_REGIONAL_NO_DEFINIDA`), **aunque** se
  teclee un importe: V2 creaba contratos con importes sin tarifa detrás.
- `p_license_amount` sigue permitiendo un precio negociado, siempre sobre una tarifa existente;
  la tarifa de lista y el negociado quedan en la auditoría.
- El fee de implementación se presenta y se cobra en la moneda del contrato; la tarifa regional
  de implementación se sugiere en pantalla.
- El contrato guarda su mercado (`subscriptions.market_id`, inmutable).

## 5. Dónde verlo

- **Planes y licencias:** cada tarifa vigente con su mercado.
- **Monedas y FX → Tarifas por mercado:** vigentes, programadas, historial y legacy; «Versionar tarifa».
- Lectura de tarifas por RLS: finanzas, plataforma o la organización que contrata el plan
  (`current_plan_price` es SECURITY INVOKER).
