# 09 - Moneda de Reporte

## Contexto fijo

PROJECT_ROOT: `/Users/edudavidmorenoccama/Documents/Documentos-Edus-MacBook-Pro-2/EBIM/masteradmin`
GUIDELINES_ROOT: `/Users/edudavidmorenoccama/Library/CloudStorage/GoogleDrive-gep.soporteit@gmail.com/My Drive/EBIM-Plataforma` (READ ONLY)

Baseline esperado: 23 migraciones existentes. No editarlas. Toda migracion nueva debe ser 24+.
No hacer push ni cambios remotos. No implementar APIs hacia los SaaS de la suite en esta V3.


Agregar setting global de Control Plane para `reporting_currency`, inicialmente USD por seed/config pero NO hardcodeado en codigo de dominio.

Requisitos:
- solo EBIM admin autorizado modifica;
- moneda debe existir y estar activa;
- helpers/views de reporting reciben fecha y reporting currency;
- valor original siempre se conserva;
- respuesta debe distinguir `native_amount/native_currency` y `reporting_amount/reporting_currency`;
- si falta FX, devolver estado de conversion faltante, no 0 ni conversion inventada.

Agregar UI administrativa simple para cambiar reporting currency entre monedas activas.
