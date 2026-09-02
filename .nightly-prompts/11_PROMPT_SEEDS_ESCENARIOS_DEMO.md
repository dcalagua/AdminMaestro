# FASE 10 - SEED DEMO REALISTA

Construye un seed determinista que permita abrir EBIM Control Plane y entender el modelo en minutos.

No uses información personal real, correos reales ni secretos.

## Catálogo SaaS

- eSupplier
- EWM by EBIM
- TMS
- GMAO
- eChange

## Organizaciones

- EBIM
- Consultora Andina
- Reseller Pacífico
- Empresa Directa Alpha
- Empresa Enterprise Omega
- Cliente Partner Uno
- Cliente Partner Dos
- Cliente EWM Norte
- Cliente EWM Sur

## Escenarios obligatorios

### eSupplier Shared - Directo EBIM

- Empresa Directa Alpha
- tenant productivo
- subscription Shared
- implementation fee
- comercial independiente con comisión si sirve al escenario

### eSupplier Shared - Partner con múltiples tenants

- Consultora Andina
- 2 o más clientes/tenants en infraestructura Shared
- la consultora administra esos tenants
- sin infraestructura dedicada
- agreement de eSupplier

### eSupplier Partner Dedicated

- Consultora Andina
- deployment target dedicado del partner en DRY_RUN/metadata
- licencia base Partner
- tenants activos
- infrastructure fee

### eSupplier Tenant Dedicated

- Empresa Enterprise Omega
- licencia Enterprise
- setup
- infraestructura dedicada
- soporte premium/SLA

### EWM by EBIM Shared

- al menos 2 tenants

### EWM by EBIM Partner Dedicated

- Reseller Pacífico
- 2 clientes finales

### EWM by EBIM Tenant Dedicated

- cliente Enterprise

### Multi-SaaS Partner

Consultora Andina debe estar habilitada como mínimo para:

- eSupplier
- EWM by EBIM

con condiciones potencialmente distintas por producto.

### Comercial independiente

Crear un commercial/sales agent ficticio con atribuciones a:

- una venta eSupplier;
- una venta EWM by EBIM;

Debe poder ver sus comisiones pero NO ser tenant member operacional.

## Datos financieros ficticios

Crea invoices/payments/costs suficientes para que dashboard calcule:

- MRR;
- fees de implementación;
- costo de infraestructura;
- comisión;
- margen.

Usa montos simples y documentados en `docs/demo/DEMO_SCENARIOS.md`.

## Auth de prueba

Si el mecanismo local permite usuarios autenticables de prueba de forma segura, crea usuarios demo por rol o documenta un script reproducible para crearlos localmente.
No versionar passwords reales ni reutilizables.

Finalmente:

- `supabase db reset` debe cargar todo correctamente;
- UI debe mostrar los escenarios;
- tests de permisos deben poder referenciar estos sujetos.

Actualiza STATE y commit.
