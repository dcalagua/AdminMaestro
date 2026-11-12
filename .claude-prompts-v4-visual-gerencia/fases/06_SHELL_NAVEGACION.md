# FASE 06 — Shell y navegación

## Objetivo
Primera impresión de producto premium: el marco que rodea todas las pantallas.

## Alcance (`src/app/AppShell.tsx`, `navigation.ts`, componentes asociados)
- **Sidebar**: gradiente teal profundo de marca, isotipo EBIM + lockup «Admin Maestro / BY EBIM» (U-02), grupos con micro-labels,
  ítem activo evidente (indicador + fondo), iconos Phosphor consistentes, colapsable a iconos con tooltip, persistencia del estado
  colapsado en `localStorage` (con try/catch). Badges de conteo donde ya exista el dato (p. ej. alertas de cobranza) sin consultas nuevas pesadas.
- **Topbar** neutro (U-11 A): buscador global, selector de tema, avatar con menú (Mi perfil, Salir), indicador de entorno
  (`VITE_APP_ENV`: LOCAL/DEV/QAS con color distinto; PRD discreto).
- **Buscador global ⌘K/Ctrl+K**: paleta de comandos que navega a cualquier ruta de `NAV_ITEMS` y busca organizaciones/tenants/suscripciones
  por nombre o código usando queries existentes (debounce, máximo 8 resultados por grupo, RLS decide lo visible).
- **Encabezado de página** unificado (vía `PageContainer`): título, descripción breve, migas, acciones a la derecha.
- Transición suave entre rutas (sin bloquear), foco al `h1` al navegar (accesibilidad).

## Pasos
1. Implementa. 2. Tests: navegación por persona sigue igual (`navigation.test.ts`), paleta de comandos (abre con atajo, filtra, navega).
3. Capturas `VISUAL_LABEL=fase06` de 4 pantallas y del sidebar colapsado. 4. Gate completo. 5. Commits.

## Hecho cuando
Shell nuevo en todas las rutas, ⌘K funcional, sin cambios de permisos, gates verdes.
