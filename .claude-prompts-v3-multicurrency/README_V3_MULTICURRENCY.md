# EBIM Control Plane V3 - Multicurrency

Este pack extiende incrementalmente el MasterAdmin actual para operar comercialmente en Peru, Bolivia y Ecuador.

PROJECT_ROOT:
`/Users/edudavidmorenoccama/Documents/Documentos-Edus-MacBook-Pro-2/EBIM/masteradmin`

GUIDELINES_ROOT (READ ONLY):
`/Users/edudavidmorenoccama/Library/CloudStorage/GoogleDrive-gep.soporteit@gmail.com/My Drive/EBIM-Plataforma`

## Objetivo

Mantener cada operacion en su moneda original y agregar una moneda de reporte configurable para consolidacion gerencial.

Mercados iniciales:
- PE: PEN default, USD permitido
- BO: BOB default, USD permitido
- EC: USD default

Fuera de alcance de V3:
- SUNAT / SRI / SIN
- facturacion electronica
- impuestos y retenciones regionales
- APIs de provisioning hacia eSupplier/WMS/TMS/GMAO/eChange
- cambios remotos QAS/PRD

## Ejecucion

1. Extraer este pack dentro del PROJECT_ROOT.
2. Revisar `.claude-prompts-v3-multicurrency/MASTER_PROMPT_CLI.md`.
3. Ejecutar con `claude-2` desde PROJECT_ROOT.
4. Si la sesion se corta, usar `90_RECOVERY_CONTEXT.md`.
5. Al finalizar revisar `98_FINAL_AUDIT.md` y `99_DEFINITION_OF_DONE.md`.
