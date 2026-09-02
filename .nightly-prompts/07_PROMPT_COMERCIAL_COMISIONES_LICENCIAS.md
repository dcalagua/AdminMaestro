# FASE 6 - COMERCIALES, LICENCIAS Y COMISIONES

Implementa el modelo comercial del EBIM Control Plane.

## Actores

- EBIM
- Partner / Reseller / Consultora
- Comercial independiente
- Comercial de Partner
- Cliente final

## Sales Agent

Crear entidad `sales_agents` o equivalente que permita:

- user vinculado opcional;
- organización afiliada opcional;
- tipo de comercial;
- estado;
- vigencia.

No convertir automáticamente a un comercial en tenant member.

## Atribución comercial

Crear `sales_attributions` o equivalente con histórico:

- product;
- tenant/customer/subscription atribuible;
- sales agent;
- channel organization;
- porcentaje de atribución si aplica;
- vigencia;
- origen de la venta;
- status.

Debe permitir que una venta tenga más de un participante si se configura explícitamente, sin duplicar comisión accidentalmente.

## Planes y licencias

### Shared SaaS
- cada tenant productivo puede tener licencia recurrente;
- DEMO sin cobro recurrente;
- TRIAL configurable;
- implementation/onboarding fee;
- soporte/addons opcionales;
- canal puede ganar comisión o margen según acuerdo.

### Partner Dedicated
- licencia base Partner;
- N licencias por tenants activos;
- fee de implementación;
- fee de infraestructura dedicada;
- servicios opcionales;
- margen del partner;
- posible comisión adicional al captador.

### Tenant Dedicated
- licencia Enterprise;
- infraestructura dedicada;
- implementation/setup;
- soporte premium/SLA;
- comisión/partnership si aplica.

## Comisiones

Modela:

- `commission_plans`
- `commission_rules`
- `commission_events`
- `commission_settlements`

Las reglas deben soportar al menos:

- porcentaje de licencia cobrada;
- porcentaje de implementation fee si contrato lo permite;
- monto fijo;
- vigencia desde/hasta;
- comisión única o recurrente;
- topes/opcionalmente duración máxima;
- status PENDING/ELIGIBLE/ACCRUED/PAID/VOID.

La comisión debe generarse a partir de eventos de pago/cobro, no sólo por crear un tenant.
Evita pagar comisión sobre facturas impagas.

## UI

- Sales Agents
- Sales Attribution
- Commission Plans
- Commission Events
- Settlements
- filtros por producto/partner/comercial/periodo/status
- detalle de cómo se calculó una comisión

Agrega tests de cálculo determinista.
Actualiza STATE y commit.
