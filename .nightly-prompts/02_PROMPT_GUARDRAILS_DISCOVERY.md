# FASE 1 - GUARDRAILS Y DISCOVERY

Trabaja sobre el proyecto EBIM Control Plane.

Base autorizada de macOS:

```text
/Users/edudavidmorenoccama/Library/CloudStorage/GoogleDrive-gep.soporteit@gmail.com/My Drive/EBIM-Plataforma
```

Objetivo: preparar el terreno de forma segura antes de crear código.

1. Ejecuta `pwd -P`.
2. Confirma que la raíz del proyecto está dentro del path autorizado.
3. Identifica el PROJECT_ROOT exacto y escríbelo en `docs/nightly/STATE.md`.
4. Revisa en modo lectura los lineamientos de EBIM dentro del path padre: `CLAUDE.md`, `.claude/`, README, AGENTS, CONTRIBUTING, editorconfig y convenciones visibles.
5. Resume las convenciones aplicables en `docs/architecture/EBIM_CONVENTIONS.md`.
6. NO copies secretos ni configuraciones sensibles desde proyectos existentes.
7. Inspecciona herramientas locales: node, npm/pnpm, git, docker/colima/orbstack si existen, Supabase CLI.
8. Determina qué puede ejecutarse localmente sin intervención humana.
9. Inicializa `docs/nightly/STATE.md`, `DECISIONS.md`, `BLOCKERS.md`, `FINAL_REPORT.md`.
10. Si no existe git, inicialízalo y crea branch `feature/ebim-control-plane-bootstrap-<fecha>`.

Salida requerida:

- PROJECT_ROOT confirmado.
- Lista de convenciones adoptadas.
- Herramientas disponibles y versiones.
- Riesgos detectados.
- Ningún archivo modificado fuera de PROJECT_ROOT.

No implementes features todavía. Finaliza esta fase dejando el proyecto listo para bootstrap y marca el gate `FILESYSTEM_GUARDRAILS` como PASS o FAIL con evidencia.
