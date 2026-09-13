# 13 - Dashboard Regional

## Contexto fijo

PROJECT_ROOT: `/Users/edudavidmorenoccama/Documents/Documentos-Edus-MacBook-Pro-2/EBIM/masteradmin`
GUIDELINES_ROOT: `/Users/edudavidmorenoccama/Library/CloudStorage/GoogleDrive-gep.soporteit@gmail.com/My Drive/EBIM-Plataforma` (READ ONLY)

Baseline esperado: 23 migraciones existentes. No editarlas. Toda migracion nueva debe ser 24+.
No hacer push ni cambios remotos. No implementar APIs hacia los SaaS de la suite en esta V3.


Agregar filtros:
- market/country
- currency
- SaaS product
- organization/partner cuando aplique

Agregar modos visibles:
- NATIVO: totales separados por currency
- CONSOLIDADO: reporting currency

En consolidado mostrar:
- reporting currency activa;
- fecha/rate context;
- warning si faltan FX rates;
- no presentar cifra consolidada como completa si hay faltantes.

Conservar dashboards actuales si son utiles y extenderlos incrementalmente.
