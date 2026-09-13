# 04 - Pricing Regional

## Contexto fijo

PROJECT_ROOT: `/Users/edudavidmorenoccama/Documents/Documentos-Edus-MacBook-Pro-2/EBIM/masteradmin`
GUIDELINES_ROOT: `/Users/edudavidmorenoccama/Library/CloudStorage/GoogleDrive-gep.soporteit@gmail.com/My Drive/EBIM-Plataforma` (READ ONLY)

Baseline esperado: 23 migraciones existentes. No editarlas. Toda migracion nueva debe ser 24+.
No hacer push ni cambios remotos. No implementar APIs hacia los SaaS de la suite en esta V3.


Problema a resolver: hoy un mismo plan puede necesitar precio diferente por mercado aun usando la misma moneda.

Evoluciona pricing sin reescribir historial.

Requisitos:
- precio identificado por plan + market + charge_kind + billing_interval + currency + vigencia;
- EC/USD puede diferir de PE/USD;
- conservar precios historicos;
- una sola tarifa current por combinacion valida;
- `current_plan_price()` o equivalente debe recibir/resolver market;
- onboarding no debe elegir precio de otro mercado accidentalmente.

Si `market_id` nullable ayuda a compatibilidad, define una estrategia explicita de backfill y eliminacion de ambiguedad.

Tests:
- PE/USD != EC/USD permitido;
- dos current prices iguales para misma combinacion DENIED;
- precio fuera de vigencia no se usa;
- moneda no permitida por mercado DENIED.
