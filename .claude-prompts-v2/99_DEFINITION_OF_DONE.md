# Definition of Done - EBIM Control Plane V2

La ejecución solo está funcionalmente completa cuando:

## Suite y comercial
- [ ] Producto SaaS nuevo se crea desde UI sin cambio de código.
- [ ] Partner/Reseller se crea desde UI.
- [ ] Partner puede tener acuerdos diferentes por SaaS.
- [ ] Partner Shared puede administrar múltiples tenants sin dedicated infra.
- [ ] Partner Dedicated tiene licencia base + N licencias + infra fee.
- [ ] Tenant Dedicated tiene licencia Enterprise + infra + implementación + soporte opcional.
- [ ] Comercial independiente puede vender varios productos y cobrar comisión sin acceso operativo.

## Tenants/licencias
- [ ] Alta transaccional de tenant + subscription + items.
- [ ] Implementation fee se cobra como one-time y no infla MRR.
- [ ] Demo no genera recurrente.
- [ ] Suspender/activar es auditable.

## Cobranza
- [ ] Cada subscription tiene collection profile.
- [ ] Métodos: Culqi Card, Service Order, Purchase Order, Bank Transfer, Manual.
- [ ] Un cliente con dos SaaS puede tener dos métodos distintos.
- [ ] OS/OC tiene ciclo request/receive/approve/expire.
- [ ] OS/OC aprobada no equivale a pago.
- [ ] Renovación/anticipación/gracia/suspensión configurable.

## Culqi
- [ ] Provider adapter desacoplado.
- [ ] Secret nunca en React/DB/Git.
- [ ] Customer/Card/Plan/Subscription mapeables.
- [ ] Webhook idempotente.
- [ ] Reconciliación disponible.
- [ ] Sin credenciales, modo mock/test explícito y funcional.
- [ ] PRD no se declara validado sin credenciales/test live autorizado.

## Finanzas/comisiones
- [ ] Payment confirmed es fuente de comisión.
- [ ] Implementation commission solo según rule.
- [ ] Reversals no borran historia.
- [ ] Dashboard separa monedas o usa FX explícito.
- [ ] MRR, cobrado, costs, commission, margin visibles por product/partner/tenant.

## Seguridad/calidad
- [ ] Todas las tablas nuevas RLS + FORCE.
- [ ] anon sin acceso de negocio.
- [ ] negative tests cross-partner/cross-tenant.
- [ ] no secret leakage.
- [ ] DB reset PASS.
- [ ] DB tests PASS.
- [ ] typecheck PASS.
- [ ] lint PASS.
- [ ] unit PASS.
- [ ] build PASS.
- [ ] E2E crítico PASS sin skips ocultos.

## Handoff
- [ ] Documentación V2 actualizada.
- [ ] `FINAL_REPORT_V2.md` con evidencia.
- [ ] Gaps externos claramente marcados.
