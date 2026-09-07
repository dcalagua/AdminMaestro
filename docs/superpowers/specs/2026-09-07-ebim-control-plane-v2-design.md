# EBIM Control Plane V2 - Diseño aprobado

**Fecha:** 2026-09-07

## Objetivo
Evolucionar `masteradmin` a la plataforma central que administra la suite EBIM, partners, clientes, tenants, modelos de despliegue, licencias, implementación, cobranza, comisiones, costos y margen.

## Arquitectura base que se conserva
- React + TypeScript + TanStack Query + React Hook Form + Zod.
- Supabase/PostgreSQL, schema `platform`, RLS + FORCE.
- 13 migraciones baseline 2026-09-02 inmutables.
- Catálogo `saas_products` data-driven.
- Deployment modes `SHARED`, `PARTNER_DEDICATED`, `TENANT_DEDICATED`.
- Comercial separado de acceso operativo.
- Comisión originada exclusivamente por cobro confirmado.

## Extensiones V2

### Administración
Cerrar los gaps read-only con mutaciones controladas y RPCs transaccionales auditados.

### Suite / Partners
Un partner puede vender múltiples SaaS con acuerdos/márgenes diferentes. Shared permite múltiples tenants del partner sin infraestructura dedicada.

### Licenciamiento
- Shared: licencia por tenant productivo + implementation fee opcional.
- Partner Dedicated: licencia base partner + N tenant licenses + infra + implementación.
- Tenant Dedicated: Enterprise license + infra + implementación + soporte/SLA.

### Cobranza
La forma de cobro se configura por `subscription`, no globalmente por cliente. Métodos iniciales: Culqi Card, Service Order, Purchase Order, Bank Transfer, Manual.

### Culqi
Adapter de provider. React tokeniza con public key/Checkout; Edge Functions usan secrets. Persistir IDs externos y metadata no sensible. Webhooks idempotentes. TEST/MOCK hasta autorización live.

### OS/OC
Documento administrativo distinto de Culqi Order. Tiene ciclo request/received/approved/expired y no devenga comisión sin payment confirmado.

### Renovaciones
Políticas de anticipación, due date, grace period, alertas y suspensión configurable. Funciones deterministas e idempotentes; cron activable en PRD posteriormente.

### Finanzas
Reconciliar provider/local, mantener MRR vs one-time, comisiones, costos y margen por producto/partner/tenant; no mezclar monedas sin FX explícito.

## Seguridad
- Secrets fuera de cliente/DB/Git.
- RLS autoridad final.
- Todas las tablas nuevas RLS + FORCE.
- Negative tests cross-org/cross-tenant.
- No acciones remotas destructivas durante ejecución V2.
