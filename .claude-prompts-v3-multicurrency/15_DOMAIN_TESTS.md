# 15 - Tests de Dominio Multicurrency

## Contexto fijo

PROJECT_ROOT: `/Users/edudavidmorenoccama/Documents/Documentos-Edus-MacBook-Pro-2/EBIM/masteradmin`
GUIDELINES_ROOT: `/Users/edudavidmorenoccama/Library/CloudStorage/GoogleDrive-gep.soporteit@gmail.com/My Drive/EBIM-Plataforma` (READ ONLY)

Baseline esperado: 23 migraciones existentes. No editarlas. Toda migracion nueva debe ser 24+.
No hacer push ni cambios remotos. No implementar APIs hacia los SaaS de la suite en esta V3.


Crear regresiones especificas. Minimo:

- PEN + USD no se suma directamente.
- BOB + USD no se suma directamente.
- invoice PEN + payment USD -> DENIED.
- subscription BOB + item USD -> DENIED.
- settlement con currencies mixtas -> DENIED.
- PE/USD price puede diferir de EC/USD.
- currency no permitida por market -> DENIED.
- FX faltante -> no conversion inventada.
- FX rate <= 0 -> DENIED.
- native amount no cambia tras reporting conversion.
- provider account incompatible -> DENIED.
- reporting totals correctos con FX disponible.

Incluye pgTAP y unit tests de helpers TS.
