# FASE 11 - TESTS, SEGURIDAD Y QUALITY GATES

Realiza un cierre técnico serio. No declares PASS sin evidencia.

## 1. Base de datos

Ejecuta cuando el entorno lo permita:

- Supabase local start/status;
- db reset desde cero;
- migration list;
- seed;
- DB tests / pgTAP;
- RLS tests.

Valida manualmente o con SQL:

- toda tabla privada expuesta tiene RLS;
- grants anon/authenticated mínimos;
- no SECURITY DEFINER inseguro;
- search_path seguro;
- views sensibles seguras;
- indexes para FK y queries críticas donde aplique.

## 2. Aislamiento negativo

Pruebas obligatorias:

- Cross organization denied.
- Cross partner denied.
- Cross tenant denied.
- Sales agent sólo comercial.
- Tenant admin no ve otro tenant.
- Partner admin no ve partner ajeno.
- anon denied.
- service-role nunca presente en bundle/browser env.

## 3. Frontend

- clean install si es razonable;
- typecheck;
- lint;
- unit tests;
- build;
- Playwright smoke/E2E cuando entorno lo permita.

Smoke mínimo:

- login;
- dashboard;
- products;
- partners;
- tenants;
- commercial/commissions;
- costs;
- deployments;
- forbidden route/access.

## 4. Secrets/hygiene

Busca:

- passwords;
- API keys;
- service_role;
- Supabase PAT;
- JWT secret;
- connection strings;
- `.env` reales.

`.env.example` sí puede contener nombres/placeholder, nunca valores reales.

## 5. Calidad del modelo

Verifica que:

- eSupplier no esté hardcodeado como único SaaS;
- EWM by EBIM funcione con el mismo modelo;
- partner multi-SaaS esté probado;
- Shared SaaS permita partner con múltiples tenants;
- implementation fee esté modelado;
- comisiones se generen desde cobros elegibles;
- deployment_mode esté desacoplado del tenant lógico.

## 6. Evidencia

Escribe resultados y conteos en:

```text
docs/nightly/QUALITY_GATE.md
```

Actualiza FINAL_REPORT con PASS/PARTIAL/BLOCKED/FAIL.
Corrige errores antes de cerrar cuando sea razonable.
Commit final de hardening si el repo queda sano.
