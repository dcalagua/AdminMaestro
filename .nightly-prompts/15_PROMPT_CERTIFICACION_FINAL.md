# PROMPT DE CERTIFICACIÓN FINAL - MAÑANA

Actúa ahora como revisor independiente del trabajo nocturno de EBIM Control Plane.

No asumas que porque existe código está correcto.
No agregues features nuevas salvo correcciones pequeñas necesarias para completar un gate.

## 1. Revisar evidencia

Lee:

- `docs/nightly/STATE.md`
- `docs/nightly/DECISIONS.md`
- `docs/nightly/BLOCKERS.md`
- `docs/nightly/QUALITY_GATE.md`
- `docs/nightly/FINAL_REPORT.md`
- documentación de arquitectura/seguridad/comercial.

## 2. Verificar repositorio

- git status limpio o explicar cambios;
- git log;
- última migration;
- no secretos versionados;
- `.env.example` correcto.

## 3. Ejecutar certificación desde cero

Cuando el entorno lo permita:

- Supabase local;
- DB reset;
- seed;
- DB/RLS tests;
- frontend install/typecheck/lint/unit tests/build;
- E2E/smoke.

## 4. Validaciones funcionales

Certifica explícitamente:

1. eSupplier existe como SaaS configurable.
2. EWM by EBIM existe con el mismo core.
3. se pueden agregar otros SaaS por catálogo.
4. partner puede estar habilitado para varios SaaS.
5. Shared SaaS admite partner/empresa con múltiples tenants.
6. Partner Dedicated admite licencia base + N tenants + infra dedicada.
7. Tenant Dedicated admite licencia Enterprise + infra + setup.
8. implementation/onboarding fee existe en el modelo.
9. commercial independiente puede recibir comisión.
10. commercial no accede automáticamente al tenant operacional.
11. costos y margen pueden analizarse por producto/partner/tenant.
12. provisioning DRY_RUN existe y es auditable.
13. RLS evita cross-org/cross-tenant.

## 5. Salida

Reescribe al final de `docs/nightly/FINAL_REPORT.md` una sección:

```text
FINAL CERTIFICATION
```

con:

- GO / GO_WITH_GAPS / NO_GO;
- tabla de gates;
- conteos reales;
- blockers críticos/altos;
- deuda técnica priorizada;
- recomendación de la primera tarea del día.

Sólo marca GO si no quedan fallas de seguridad ni inconsistencias críticas del modelo.
