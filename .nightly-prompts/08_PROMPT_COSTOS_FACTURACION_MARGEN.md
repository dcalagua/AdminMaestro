# FASE 7 - COSTOS, FACTURACIÓN GERENCIAL Y MARGEN

Implementa en EBIM Control Plane una capa gerencial de ingresos/costos que permita al gerente entender qué SaaS, partner o tenant es rentable.

No construyas contabilidad general ni SUNAT completa en esta fase.

## Capacidades

### Billing metadata

- invoices
- invoice lines / items
- payments
- statuses
- currency
- billing period
- customer organization
- subscription/tenant/product references

### Costos

Crear `cost_entries` y `cost_allocations` o modelo equivalente.
Debe poder registrar costos como:

- Supabase / DB / compute;
- storage;
- email/SMS/WhatsApp si aplica;
- hosting frontend;
- dominios;
- soporte;
- infraestructura dedicada;
- servicios de terceros;
- costo manual administrativo.

Un costo puede asignarse a:

- plataforma global;
- producto SaaS;
- partner;
- tenant;
- deployment target.

### Métricas

Implementa queries/views/RPC seguras para obtener:

- MRR;
- ARR;
- licencias activas;
- ingresos cobrados;
- fees de implementación cobrados;
- comisión accrued/paid;
- costo directo;
- margen bruto estimado;
- margen por producto;
- margen por partner;
- margen por tenant;
- ticket promedio.

Documenta claramente fórmulas y qué datos son estimados vs cobrados.

## UI

Crear:

- Billing / Payments
- Costs
- Margin Dashboard

Dashboard debe poder filtrar por:

- periodo;
- SaaS;
- partner;
- tenant;
- deployment mode;
- moneda cuando aplique.

Incluye tarjetas y tablas simples; evita gráficos sin datos reales del seed.

## Tests

Prueba al menos:

- no contar invoice DRAFT/VOID como revenue cobrado;
- comisión no pagada correctamente separada de comisión pagada;
- costos compartidos asignados con regla explícita;
- margen = ingreso reconocido definido - costos - comisiones según la fórmula documentada.

Actualiza STATE y commit.
