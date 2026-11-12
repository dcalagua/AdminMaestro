# FASE 05 — Componentes base de impacto

## Objetivo
Que inputs, botones, tablas y tarjetas «se sientan premium» en toda la app. Los usuarios lo notan sobre todo aquí.

## Alcance (en `src/components/ui/`)
- `fields.tsx` / `regional-fields.tsx`: TextField, NumberField, SelectField, TextAreaField, MoneyField (prefijo de moneda),
  SearchField (icono), Checkbox/Switch. Etiqueta encima, ayuda y error debajo, iconos opcionales, foco de 3px, estados claros.
  API pública compatible (no rompas los usos existentes; agrega props opcionales).
- `primitives.tsx`: `PageContainer` (encabezado con título, subtítulo, acciones y migas opcionales), `Card`, `StatCard`
  → evolucionar a **KpiTile** (valor display, variación con flecha y tono, sparkline opcional, pie de contexto), `Badge`
  (tonos y punto), `DataTable` (cabecera sticky, números a la derecha, hover, densidad), `EmptyState` (ilustración SVG
  inline sobria + acción), `LoadingState` → **Skeleton** de tabla/tarjeta/gráfico, `ErrorState`.
- `SectionTabs`, `StatusTabs`, `FormDialog`, `ConfirmDialog`, `DetailDrawer`, `Toast`: pulido visual consistente.
- `Sparkline` nuevo (Recharts o SVG puro, sin ejes) para KpiTile.
- **Galería `/design`** (solo con `import.meta.env.DEV` o super admin): muestra cada componente en todos sus estados, claro/oscuro.
  Sirve para revisar de un vistazo y para capturas.

## Pasos
1. Implementa, manteniendo compatibilidad. 2. Tests de vitest para los componentes nuevos o cambiados (estados, accesibilidad:
   `label` asociado, `aria-invalid`, `aria-describedby`). 3. Capturas `VISUAL_LABEL=fase05` de `/design` y 3 pantallas con formularios.
4. Gate completo. 5. Commits `feat(ui): …` / `style(ui): …`.

## Hecho cuando
Galería completa, componentes usados por toda la app ya con el nuevo estilo, tests y gates verdes.
