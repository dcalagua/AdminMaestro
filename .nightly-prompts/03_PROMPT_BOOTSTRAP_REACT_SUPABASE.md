# FASE 2 - BOOTSTRAP REACT + SUPABASE

Continúa sobre el mismo PROJECT_ROOT y respeta los lineamientos detectados.

Objetivo: dejar una aplicación React/TypeScript y un Supabase local reproducible.

## Frontend

Inicializa una app moderna con:

- React + TypeScript + Vite;
- TypeScript strict;
- Tailwind;
- estructura por features;
- React Router;
- cliente Supabase aislado en módulo de infraestructura;
- ESLint + Prettier;
- Vitest + React Testing Library;
- variables de entorno documentadas mediante `.env.example`, nunca secretos reales.

Estructura sugerida:

```text
src/
  app/
  components/
  features/
  hooks/
  lib/
  routes/
  services/
  types/
```

No hagas una arquitectura excesivamente ceremonial.

## Supabase

- Inicializa Supabase CLI en el repo.
- Crea `supabase/config.toml`.
- Prepara migrations y seed.
- El entorno local debe poder reconstruirse desde cero.
- Si Docker runtime no está disponible, no bloquees toda la noche: deja configuración completa, marca `SUPABASE_LOCAL=BLOCKED_ENVIRONMENT`, y continúa con migraciones/test estático donde sea posible.

## Aplicación base

Crea:

- shell/layout administrativo;
- login placeholder conectado a Supabase Auth si stack local está disponible;
- manejo de sesión;
- rutas protegidas base;
- error boundary/fallback;
- página 404;
- navegación lateral preparada para módulos futuros.

Ejecuta:

- install;
- typecheck;
- lint;
- unit tests mínimos;
- build.

Actualiza `docs/nightly/STATE.md` y haz commit si los gates pasan.
