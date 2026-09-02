# DEFINITION OF DONE - EBIM CONTROL PLANE V0

La ejecución nocturna se considera una buena base si cumple la mayoría de los siguientes puntos con evidencia.

## Repositorio y entorno

- [ ] Proyecto aislado dentro de EBIM-Plataforma.
- [ ] Ningún proyecto hermano modificado.
- [ ] Git inicializado y branch de trabajo.
- [ ] React + TypeScript + Vite levanta.
- [ ] Supabase local reproducible o blocker de runtime claramente documentado.

## Database

- [ ] Migrations versionadas.
- [ ] `db reset` local PASS.
- [ ] Seed PASS.
- [ ] Catálogo multi-SaaS.
- [ ] Organizations/relationships.
- [ ] Tenants.
- [ ] Partner agreements por SaaS.
- [ ] Plans/subscriptions.
- [ ] Sales agents/attributions.
- [ ] Commissions.
- [ ] Costs/margin.
- [ ] Deployment targets/provisioning.
- [ ] Audit logs.

## Modelos comerciales

- [ ] Shared directo EBIM.
- [ ] Shared vía Partner/Reseller con múltiples tenants.
- [ ] Implementation fee en Shared.
- [ ] Partner Dedicated.
- [ ] Tenant Dedicated.
- [ ] Comisión comercial.
- [ ] Margen partner.
- [ ] Demo sin recurrente.

## Seguridad

- [ ] Supabase Auth.
- [ ] RBAC.
- [ ] RLS.
- [ ] anon cerrado.
- [ ] service_role fuera del browser.
- [ ] cross-org denied.
- [ ] cross-tenant denied.
- [ ] sales-agent operational access denied.
- [ ] secrets scan PASS.

## Frontend

- [ ] Login.
- [ ] Dashboard EBIM.
- [ ] Products.
- [ ] Organizations.
- [ ] Partners.
- [ ] Customers.
- [ ] Tenants.
- [ ] Commercials.
- [ ] Commissions.
- [ ] Plans/subscriptions.
- [ ] Billing/payments.
- [ ] Costs/margin.
- [ ] Deployments/provisioning.
- [ ] Feature flags.
- [ ] Audit.

## Calidad

- [ ] Typecheck PASS.
- [ ] Lint PASS.
- [ ] Unit tests PASS.
- [ ] DB tests PASS.
- [ ] Build PASS.
- [ ] E2E PASS o BLOCKED_ENVIRONMENT justificado.
- [ ] Documentación de arquitectura.
- [ ] FINAL_REPORT con evidencia.

## Regla final

Un dashboard bonito sin RLS y sin modelo reproducible NO cuenta como base terminada.
Una base segura/reproducible con alguna pantalla secundaria pendiente sí puede ser `GO_WITH_GAPS`.
