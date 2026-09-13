# 08 - FX Engine para Reporting

## Contexto fijo

PROJECT_ROOT: `/Users/edudavidmorenoccama/Documents/Documentos-Edus-MacBook-Pro-2/EBIM/masteradmin`
GUIDELINES_ROOT: `/Users/edudavidmorenoccama/Library/CloudStorage/GoogleDrive-gep.soporteit@gmail.com/My Drive/EBIM-Plataforma` (READ ONLY)

Baseline esperado: 23 migraciones existentes. No editarlas. Toda migracion nueva debe ser 24+.
No hacer push ni cambios remotos. No implementar APIs hacia los SaaS de la suite en esta V3.


Implementa FX solo para reporting, no para alterar documentos transaccionales.

Crear modelo auditable similar a:
- exchange_rates
  - rate_date
  - base_currency
  - quote_currency
  - rate numeric > 0
  - source (MANUAL inicialmente)
  - status
  - created_by / audit metadata segun convenciones

Requisitos:
- unique por fecha/base/quote/source activo segun diseno;
- base != quote;
- rate > 0;
- no inventar rate si falta;
- conversion helper explicito y determinista;
- soportar direct rate y, solo si se diseña claramente, reciprocal; no triangular conversion implicita sin documentacion.

Inicialmente NO conectar BCRP/BCB/BCE ni APIs externas.

Tests para rate valido, inexistente, reciprocal si se implementa, fechas y permisos.
