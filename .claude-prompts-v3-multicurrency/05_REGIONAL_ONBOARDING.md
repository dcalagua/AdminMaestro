# 05 - Onboarding Regional

## Contexto fijo

PROJECT_ROOT: `/Users/edudavidmorenoccama/Documents/Documentos-Edus-MacBook-Pro-2/EBIM/masteradmin`
GUIDELINES_ROOT: `/Users/edudavidmorenoccama/Library/CloudStorage/GoogleDrive-gep.soporteit@gmail.com/My Drive/EBIM-Plataforma` (READ ONLY)

Baseline esperado: 23 migraciones existentes. No editarlas. Toda migracion nueva debe ser 24+.
No hacer push ni cambios remotos. No implementar APIs hacia los SaaS de la suite en esta V3.


Extiende `Nueva venta` / onboarding para flujo:
cliente -> pais/mercado -> moneda sugerida -> monedas permitidas -> plan -> precio regional -> subscription.

Requisitos:
- pais/mercado seleccionable;
- default currency sugerida por market;
- usuario puede cambiar solo a moneda permitida;
- pricing se consulta por market+currency;
- no usar textbox libre de currency;
- mostrar implementation fee en misma moneda contractual salvo regla explicita;
- errores claros si no existe precio.

No crear una subscription si plan/market/currency no tiene precio valido.

Tests unit + E2E del selector regional.
