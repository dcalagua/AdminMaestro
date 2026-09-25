# EBIM Control Plane V2 - instrucciones permanentes para Claude

## Paths
- PROJECT_ROOT: `/Users/edudavidmorenoccama/Documents/Documentos-Edus-MacBook-Pro-2/EBIM/masteradmin` - única raíz de escritura del proyecto.
- GUIDELINES_ROOT: `/Users/edudavidmorenoccama/Library/CloudStorage/GoogleDrive-gep.soporteit@gmail.com/My Drive/EBIM-Plataforma` - referencia READ-ONLY.

## Proyecto
Este repositorio YA existe y tiene React 19 + TypeScript + Supabase local con schema `platform`, 13 migraciones baseline y un Control Plane funcional de lectura. NO bootstrappear nuevamente.

## Prioridad
Sigue `.claude-prompts-v2/00_START_HERE_VSCODE.md` y las fases V2 en orden.

## Seguridad
- Nunca modificar GUIDELINES_ROOT.
- Nunca exponer secretos Supabase/Culqi.
## Git policy — EBIM MasterAdmin multi-app program

Git push is authorized for development, QAS and feature branches
when required to complete the MasterAdmin integration program.

Allowed:
- push feature branches
- push dev
- push qas when the repository workflow requires it
- create PR branches and evidence branches

Forbidden:
- force push
- destructive history rewrites
- push or merge to PRD/production release branches without explicit human authorization
- delete remote branches unless explicitly requested

Always verify the remote target and branch before pushing.
- Nunca reset/link/push contra Supabase remoto.
- Mantener RLS como autoridad, UI solo UX.
- Mantener `comercial != acceso operativo`.
- Comisiones solo por payments CONFIRMED.
- Culqi live no se usa sin autorización explícita.

## Convenciones
Lee `docs/architecture/EBIM_CONVENTIONS.md` y, cuando sea accesible, contrasta con GUIDELINES_ROOT. Mantén estructura y patrones existentes antes de crear abstracciones nuevas.
