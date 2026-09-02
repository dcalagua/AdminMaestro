# FASE 9 - CONSOLA ADMINISTRATIVA REACT

Consolida el frontend de EBIM Control Plane para que sea presentable y realmente utilizable.

## Principios UX

- diseño sobrio empresarial EBIM;
- responsive desktop-first;
- navegación consistente;
- breadcrumbs;
- filtros persistentes razonables;
- loading/empty/error states;
- feedback de acciones;
- confirmación en operaciones destructivas;
- no depender de permisos sólo para ocultar UI;
- accesibilidad básica.

## Navegación

Sidebar sugerido:

1. Dashboard
2. SaaS Products
3. Organizations
4. Partners / Resellers
5. Customers
6. Tenants
7. Commercials
8. Commissions
9. Plans & Licenses
10. Subscriptions
11. Billing
12. Costs & Margin
13. Deployments
14. Feature Flags
15. Audit Logs
16. Settings

El menú debe adaptarse al rol.

## Dashboards

### EBIM

Cards:

- productos activos;
- partners;
- clientes;
- tenants productivos;
- demo/trial;
- MRR;
- ingresos cobrados;
- costos;
- comisiones pendientes;
- margen;
- provisioning failures.

### Partner

- SaaS autorizados;
- tenants administrados;
- tenants por estado;
- licencias activas;
- margen/comisión visible según acuerdo;
- últimos deployments/provisioning relevantes.

### Commercial

- ventas atribuidas;
- clientes;
- comisión eligible/accrued/paid;
- período;
- sin datos operativos del SaaS.

## Detalles importantes

Tenant detail debe mostrar pestañas administrativas, por ejemplo:

- Overview
- Product & Plan
- Organization
- Commercial Attribution
- Subscription
- Deployment
- Features
- Costs / Billing si el rol lo permite
- Audit

Partner detail:

- Overview
- Products Authorized
- Customers
- Tenants
- Agreements
- Commercials
- Billing/Margin
- Deployments

Evita mocks inertes: conecta a Supabase local/seed.

Ejecuta visual smoke, typecheck, tests, lint y build.
Actualiza STATE y commit.
