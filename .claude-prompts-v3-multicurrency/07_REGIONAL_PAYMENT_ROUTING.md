# 07 - Payment Routing Regional

## Contexto fijo

PROJECT_ROOT: `/Users/edudavidmorenoccama/Documents/Documentos-Edus-MacBook-Pro-2/EBIM/masteradmin`
GUIDELINES_ROOT: `/Users/edudavidmorenoccama/Library/CloudStorage/GoogleDrive-gep.soporteit@gmail.com/My Drive/EBIM-Plataforma` (READ ONLY)

Baseline esperado: 23 migraciones existentes. No editarlas. Toda migracion nueva debe ser 24+.
No hacer push ni cambios remotos. No implementar APIs hacia los SaaS de la suite en esta V3.


El provider account debe resolverse por servidor usando:
country/market + currency + collection_method + provider configuration.

No permitir que React elija arbitrariamente merchant/provider account.

Soportar los metodos actuales:
- CULQI_CARD
- SERVICE_ORDER
- PURCHASE_ORDER
- BANK_TRANSFER
- MANUAL

Culqi no debe asumirse proveedor universal para todos los paises.

Agregar una vista/RPC de elegibilidad de payment provider si mejora el modelo.

Tests:
- cuenta PE/PEN no se usa para BO/BOB;
- provider incompatible DENIED;
- provider account seleccionado server-side;
- metodos no-card siguen operativos.
