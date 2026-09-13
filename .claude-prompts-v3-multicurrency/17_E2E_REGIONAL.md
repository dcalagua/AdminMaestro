# 17 - E2E Peru / Bolivia / Ecuador

## Contexto fijo

PROJECT_ROOT: `/Users/edudavidmorenoccama/Documents/Documentos-Edus-MacBook-Pro-2/EBIM/masteradmin`
GUIDELINES_ROOT: `/Users/edudavidmorenoccama/Library/CloudStorage/GoogleDrive-gep.soporteit@gmail.com/My Drive/EBIM-Plataforma` (READ ONLY)

Baseline esperado: 23 migraciones existentes. No editarlas. Toda migracion nueva debe ser 24+.
No hacer push ni cambios remotos. No implementar APIs hacia los SaaS de la suite en esta V3.


Ejecuta journeys reales sobre local:

A) Peru PEN
crear/usar cliente -> plan regional -> subscription -> invoice -> payment manual seguro -> commission -> dashboard.

B) Bolivia BOB
cliente/partner -> price BOB -> subscription -> billing -> dashboard native y consolidated.

C) Ecuador USD
cliente -> price EC/USD -> subscription -> billing -> dashboard.

D) Diferenciacion PE/USD vs EC/USD.

E) FX missing warning.

No ejecutar cobros Culqi LIVE. Si Culqi TEST no es necesario para estos E2E, no repetir integracion externa.

Cero skips para journeys locales implementables.
