# 16 - RLS y Seguridad Multicurrency

## Contexto fijo

PROJECT_ROOT: `/Users/edudavidmorenoccama/Documents/Documentos-Edus-MacBook-Pro-2/EBIM/masteradmin`
GUIDELINES_ROOT: `/Users/edudavidmorenoccama/Library/CloudStorage/GoogleDrive-gep.soporteit@gmail.com/My Drive/EBIM-Plataforma` (READ ONLY)

Baseline esperado: 23 migraciones existentes. No editarlas. Toda migracion nueva debe ser 24+.
No hacer push ni cambios remotos. No implementar APIs hacia los SaaS de la suite en esta V3.


Reaudita todas las nuevas tablas, views, RPCs y SECURITY DEFINER.

Requisitos:
- search_path seguro;
- grants minimos;
- currencies/markets lectura controlada;
- mantenimiento global solo EBIM autorizado;
- FX write solo rol EBIM autorizado;
- regional prices write solo rol autorizado;
- partner/tenant no puede manipular FX ni catalogos globales;
- views con security_invoker cuando corresponda;
- ningun bypass via service_role desde frontend.

Agrega pgTAP negativos por rol.
