# EBIM Control Plane V2 Implementation Plan

> **For agentic workers:** ejecutar las fases de `.claude-prompts-v2` en orden, actualizando los gates después de cada fase.

**Goal:** convertir el Control Plane actual en una consola multi-SaaS completamente gestionable con canales comerciales, licenciamiento, implementación, cobranza por suscripción, Culqi desacoplado, OS/OC, renovaciones, reconciliación y seguridad certificada.

**Architecture:** evolución incremental sobre el schema `platform` existente. Las operaciones sensibles se encapsulan en RPCs transaccionales y Edge Functions; React usa RLS. Los proveedores de pago se desacoplan mediante mappings/adapters y `payments` permanece como ledger de cobros, no configuración.

**Tech Stack:** React 19, TypeScript 5.9, Vite 7, TanStack Query 5, React Hook Form, Zod 4, Supabase/PostgreSQL/RLS/Edge Functions, Vitest, pgTAP, Playwright.

**Spec:** `docs/superpowers/specs/2026-09-07-ebim-control-plane-v2-design.md`

## Global Constraints
- No editar migraciones baseline 20260902.
- Escribir solo en `/Users/edudavidmorenoccama/Documents/Documentos-Edus-MacBook-Pro-2/EBIM/masteradmin`.
- `/Users/edudavidmorenoccama/Library/CloudStorage/GoogleDrive-gep.soporteit@gmail.com/My Drive/EBIM-Plataforma` es read-only.
- No secrets en browser/DB/Git.
- No push ni acciones Supabase remotas destructivas.

---

### Task 1: Baseline y mapa de gaps
**Files:** crear `docs/nightly-v2/AUDIT_BASELINE.md`, `docs/nightly-v2/GAP_MATRIX.md`.
**Produces:** baseline verificable que alimenta todas las tareas siguientes.
- [ ] Ejecutar Fase 01 y dejar comandos/resultados.
- [ ] No avanzar si no se conoce el último estado real de DB y UI.

### Task 2: Mutaciones administrativas y RPCs
**Files:** `supabase/migrations/20260907000100_admin_write_rpcs.sql`, `src/services/queries.ts`, páginas existentes y componentes de formulario.
**Produces:** CRUD seguro de organizations/products/partners/tenants/agents/subscriptions/provisioning.
- [ ] Ejecutar Fase 02.
- [ ] Verificar autorización negativa y auditoría.

### Task 3: Suite y acuerdos de canal
**Files:** migración incremental si es necesaria, `ProductsPage.tsx`, `ProductDetailPage.tsx`, `PartnersPage.tsx`, `OrganizationDetailPage.tsx`.
**Produces:** producto data-driven y partner multi-SaaS.
- [ ] Ejecutar Fases 03-04.

### Task 4: Onboarding/licenciamiento transaccional
**Files:** nueva migración de RPC onboarding, wizard UI, queries/mutations.
**Produces:** tenant + subscription + items + attribution + provisioning DRY_RUN atómico.
- [ ] Ejecutar Fases 05-06.

### Task 5: Collection profiles
**Files:** `supabase/migrations/20260907000200_collection_profiles.sql`, tipos, hooks, UI subscription detail.
**Produces:** método de cobro por subscription.
- [ ] Ejecutar Fase 07.

### Task 6: OS/OC y renovación documental
**Files:** `supabase/migrations/20260907000300_commercial_documents.sql`, UI Cobranza.
**Produces:** ciclo de service/purchase order sin falsear pagos.
- [ ] Ejecutar Fase 08.

### Task 7: Provider adapter Culqi
**Files:** `docs/payments/CULQI_ARCHITECTURE.md`, `supabase/migrations/20260907000400_payment_provider_mappings.sql`, `supabase/functions/_shared/payments/*`, `payment-setup`, `culqi-webhook`, `payment-reconcile`.
**Produces:** TEST/MOCK integration segura, idempotente y sin secrets client-side.
- [ ] Ejecutar Fases 09-10.

### Task 8: Renewal engine
**Files:** `supabase/migrations/20260907000500_billing_alerts_and_renewals.sql`, dashboard/alerts UI.
**Produces:** anticipación, gracia y suspensión programable.
- [ ] Ejecutar Fase 11.

### Task 9: Commissions/reconciliation/finance
**Files:** funciones existentes extendidas solo si necesario, vistas gerenciales, UI reconciliation.
**Produces:** provider->payment->commission y margen consistente.
- [ ] Ejecutar Fases 12-13.

### Task 10: UI 360 y seed V2
**Files:** navegación, páginas, seed.
**Produces:** demo gerencial coherente y escenarios multi-SaaS.
- [ ] Ejecutar Fases 14-15.

### Task 11: Hardening y certificación
**Files:** `supabase/tests/*`, Vitest, `e2e/*`, docs nightly-v2.
**Produces:** seguridad y regresión verificadas.
- [ ] Ejecutar Fases 16-18 y 98.
- [ ] Contrastar todo con `99_DEFINITION_OF_DONE.md`.
