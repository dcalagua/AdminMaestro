# BLOCKERS — EBIM Control Plane

| ID | Fase | Blocker | Impacto | Alternativa aplicada | Estado |
|---|---|---|---|---|---|
| B-01 | 2 | El puerto 54322 (PostgreSQL de Supabase) ya estaba ocupado por el stack local de otro proyecto (`apt-supervisor`). | `supabase start` fallaba con `port is already allocated`. | **No se detuvo el stack ajeno**: habría interrumpido el trabajo de otro proyecto sin autorización. Se reasignaron los puertos de ESTE proyecto al rango 544xx en `supabase/config.toml`. Documentado en README §2 y en `LOCAL_DEVELOPMENT.md` §2. | **RESUELTO** |
| B-02 | 2 | `node` y `npm` no están en el PATH por defecto de la shell (viven en `~/.nvm/versions/node/v24.19.0/bin`). | Ningún comando de npm funcionaba directamente. | Se exporta el PATH en cada invocación y se añadió `.nvmrc`. Documentado en README §1. | **RESUELTO** |
| B-03 | 2 | `pnpm` no está instalado. | El prompt maestro lo prefería si estaba disponible. | Se usó **npm 11.17.0** para todo el proyecto, sin cambiar de gestor a mitad (D-002). | **RESUELTO** |
| B-04 | 10 | Sembrar `auth.users` a mano dejaba las columnas de token de GoTrue en NULL, y su driver las escanea como string. | **Todo login devolvía 500 "Database error querying schema"**, sin nombrar usuario ni columna. 18 de 21 E2E fallaban a la vez. | Se siembran las 8 columnas de token (`confirmation_token`, `recovery_token`, `email_change*`, `phone_change*`, `reauthentication_token`) con `''`. Documentado en `LOCAL_DEVELOPMENT.md` §7 para que no vuelva a costar un diagnóstico. | **RESUELTO** |
| B-05 | 8 | Sin autorización del operador para tocar la Supabase Management API. | No se puede validar el provisioning LIVE end-to-end. | **Esperado y correcto**: el prompt exige DRY_RUN por defecto. El adapter real está escrito como esqueleto que exige el token desde secrets del servidor y falla ruidosamente si falta. Camino a LIVE documentado en `PROVISIONING.md` §7. | **NO ES UN FALLO** |

## Blockers abiertos

**Ninguno.**

## Riesgos anotados (no bloquean, pero conviene decidirlos)

| # | Riesgo | Recomendación |
|---|---|---|
| R-01 | Este proyecto implementa el schema `platform`, que **ya existe** dentro del proyecto Supabase de GMAO (contrato §1). Si ambos evolucionan por separado, divergen. | Decisión de arquitectura de suite con el operador y GMAO como lead: o este proyecto ES el hub (se promueve/extrae el schema), o consume el Platform Context API del hub actual. Es el paso 10 de los próximos pasos. |
| R-02 | Sin conversión FX: los agregados multi-moneda se muestran por separado. | Añadir una tabla de tipos de cambio con fecha y fuente cuando el negocio lo pida. Convertir con un FX implícito hoy produciría un número no auditable. |
| R-03 | El MRR se calcula desde suscripciones vigentes, no desde un snapshot mensual. | No se puede reconstruir el MRR histórico. Requiere una tabla de snapshots. |
| R-04 | El bundle es un único chunk de 587 kB. | Code-splitting por ruta con `React.lazy`. |
