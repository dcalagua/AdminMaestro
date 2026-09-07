# Cómo usar este pack con Claude Code en VS Code

Proyecto real:
`/Users/edudavidmorenoccama/Documents/Documentos-Edus-MacBook-Pro-2/EBIM/masteradmin`

Lineamientos read-only:
`/Users/edudavidmorenoccama/Library/CloudStorage/GoogleDrive-gep.soporteit@gmail.com/My Drive/EBIM-Plataforma`

1. Copia la carpeta `.claude-prompts-v2` dentro de la raíz `masteradmin`.
2. Copia `CLAUDE.md` y `.claude/settings.json` incluidos en este pack a la raíz del proyecto (si ya existen, fusiona con cuidado; no reemplaces instrucciones propias sin revisar).
3. Abre `masteradmin` en VS Code.
4. En Claude Code, usa el selector de permisos **Editar automáticamente / acceptEdits**. No uses Bypass Permissions.
5. El settings del proyecto agrega `GUIDELINES_ROOT` como directorio adicional y bloquea escritura allí.
6. Abre un chat nuevo y pega exactamente:

```text
Lee CLAUDE.md y luego lee completamente .claude-prompts-v2/00_START_HERE_VSCODE.md.
Ejecuta todas las fases en el orden indicado, trabajando sobre el proyecto existente.
No me pidas confirmación entre fases para decisiones técnicas normales.
Mantén STATE_V2.md, DECISIONS_V2.md y QUALITY_GATE_V2.md actualizados.
Si pierdes contexto, usa 90_RECOVERY_CONTEXT.md y continúa.
No hagas push ni acciones remotas destructivas.
```

Si Claude se detiene por un permiso de terminal legítimo (`npm`, `supabase local`, tests), apruébalo y usa "no preguntar de nuevo" para ese prefijo seguro si confías en él. Las ediciones de archivos pueden avanzar automáticamente con `acceptEdits`.
