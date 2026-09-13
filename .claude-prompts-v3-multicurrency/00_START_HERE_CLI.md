# START HERE - V3 Multicurrency

## Contexto fijo

PROJECT_ROOT: `/Users/edudavidmorenoccama/Documents/Documentos-Edus-MacBook-Pro-2/EBIM/masteradmin`
GUIDELINES_ROOT: `/Users/edudavidmorenoccama/Library/CloudStorage/GoogleDrive-gep.soporteit@gmail.com/My Drive/EBIM-Plataforma` (READ ONLY)

Baseline esperado: 23 migraciones existentes. No editarlas. Toda migracion nueva debe ser 24+.
No hacer push ni cambios remotos. No implementar APIs hacia los SaaS de la suite en esta V3.


Lee primero `CLAUDE.md`, `README.md`, los reportes V2/V2.1 y `MASTER_PROMPT_CLI.md`.
Luego ejecuta las fases en orden.

Mantener:
- moneda transaccional original;
- reporting currency separada;
- FX auditable;
- pricing por mercado;
- comisiones en moneda de origen;
- settlements mono-moneda;
- aislamiento RLS actual;
- Culqi TEST y billing sin regresiones.
