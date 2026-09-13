# 11 - Comisiones Multimoneda

## Contexto fijo

PROJECT_ROOT: `/Users/edudavidmorenoccama/Documents/Documentos-Edus-MacBook-Pro-2/EBIM/masteradmin`
GUIDELINES_ROOT: `/Users/edudavidmorenoccama/Library/CloudStorage/GoogleDrive-gep.soporteit@gmail.com/My Drive/EBIM-Plataforma` (READ ONLY)

Baseline esperado: 23 migraciones existentes. No editarlas. Toda migracion nueva debe ser 24+.
No hacer push ni cambios remotos. No implementar APIs hacia los SaaS de la suite en esta V3.


Reglas:
- commission event conserva moneda de su base/pago;
- porcentaje se calcula sobre amount original;
- settlement es mono-moneda;
- no mezclar PEN+USD+BOB en una misma liquidacion;
- reversals conservan misma currency;
- dashboard puede convertir a reporting currency solo para analitica.

Audita `create_commission_settlement` y defaults actuales como USD.
Elimina defaults ambiguos o exige currency explicita.

Tests:
- settlement USD no toma BOB;
- settlement BOB no toma PEN;
- multi-currency mixed settlement DENIED;
- reversal conserva currency.
