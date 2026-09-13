# 01 - Auditoria Multicurrency Baseline

## Contexto fijo

PROJECT_ROOT: `/Users/edudavidmorenoccama/Documents/Documentos-Edus-MacBook-Pro-2/EBIM/masteradmin`
GUIDELINES_ROOT: `/Users/edudavidmorenoccama/Library/CloudStorage/GoogleDrive-gep.soporteit@gmail.com/My Drive/EBIM-Plataforma` (READ ONLY)

Baseline esperado: 23 migraciones existentes. No editarlas. Toda migracion nueva debe ser 24+.
No hacer push ni cambios remotos. No implementar APIs hacia los SaaS de la suite en esta V3.


No modifiques codigo en esta fase.

Revisa migrations, seed, tipos TS, servicios, formularios y vistas financieras buscando:
- currency
- country_code
- defaults USD/PEN
- plan_prices
- subscriptions
- subscription_items
- invoices/invoice_lines/payments
- cost_entries
- commission_events/settlements
- payment_provider_accounts
- onboarding
- dashboards y metrics views

Genera:
- `docs/nightly-v3/MULTICURRENCY_BASELINE.md`
- `docs/nightly-v3/GAP_MATRIX_MULTICURRENCY.md`

Debes responder:
1. donde ya existe moneda;
2. donde se usa default peligroso;
3. donde se escribe moneda libre;
4. donde se agregan importes por currency correctamente;
5. donde existe riesgo de sumar monedas diferentes;
6. que cambios son estrictamente necesarios.

Gate: documentacion creada, cero cambios funcionales.
