# PROMPT SUPERVISOR / RECUPERACIÓN

Retoma el proyecto **EBIM Control Plane** después de una interrupción, compactación de contexto o fallo parcial.

No empieces de cero.

1. Confirma `pwd -P` y que sigues dentro de:

```text
/Users/edudavidmorenoccama/Library/CloudStorage/GoogleDrive-gep.soporteit@gmail.com/My Drive/EBIM-Plataforma
```

2. Determina PROJECT_ROOT.
3. Lee primero:

```text
docs/nightly/STATE.md
docs/nightly/DECISIONS.md
docs/nightly/BLOCKERS.md
docs/nightly/QUALITY_GATE.md (si existe)
docs/nightly/FINAL_REPORT.md (si existe)
```

4. Revisa:

- `git status`
- `git log --oneline -20`
- migrations
- package.json
- README

5. Identifica la última fase realmente completada según evidencia, no según texto optimista.
6. Si hay cambios sin commit, evalúalos antes de continuar.
7. Ejecuta los gates mínimos que permitan comprobar el estado actual.
8. Continúa desde la primera fase pendiente o fallida.
9. No repitas una migración ya aplicada ni recrees módulos existentes.
10. Si un blocker de entorno persiste, documenta y avanza a trabajo independiente.
11. Mantén la prohibición de tocar producción y proyectos hermanos.

Objetivo final: maximizar los estados PASS de `docs/nightly/FINAL_REPORT.md` sin falsificar resultados.
