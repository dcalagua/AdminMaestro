# MasterAdmin V3 Multicurrency Implementation Plan

> For agentic workers: execute the phase prompts in `.claude-prompts-v3-multicurrency/` in order and verify each gate before advancing.

**Goal:** Extend EBIM Control Plane from partial currency awareness to a safe regional multicurrency model for Peru, Bolivia and Ecuador while preserving transactional amounts and adding auditable reporting conversion.

**Architecture:** Transactions keep native currency. Markets control allowed currencies and regional pricing. FX is a separate reporting-only layer. Consolidated dashboards convert explicitly into a configurable reporting currency and expose missing rates instead of inventing values.

**Tech Stack:** React 19, TypeScript, Vite, Supabase/PostgreSQL, RLS, pgTAP, Vitest, Playwright.

**Project:** `/Users/edudavidmorenoccama/Documents/Documentos-Edus-MacBook-Pro-2/EBIM/masteradmin`

## Global Constraints

- 23 existing migrations are immutable baseline.
- New DB work starts at migration 24+.
- No QAS/PRD changes or remote pushes.
- No SaaS provisioning APIs in this V3.
- No fiscal ERP scope.
- No cross-currency arithmetic without explicit FX.
- Native financial amounts are immutable.

## Execution Units

1. Baseline and gap matrix.
2. Currency and market catalogs.
3. Regional EBIM companies.
4. Regional pricing.
5. Regional onboarding.
6. Transaction-currency invariants.
7. Payment routing.
8. FX engine.
9. Reporting currency.
10. Consolidated finance views.
11. Multicurrency commissions and settlements.
12. Regional UI.
13. Dashboard filters and native/consolidated modes.
14. Regional deterministic seeds.
15. Domain regression tests.
16. RLS/security audit.
17. Regional E2E journeys.
18. Documentation and final certification.

Each unit is independently gated by the corresponding prompt file and its tests. Final completion requires `98_FINAL_AUDIT.md` and `99_DEFINITION_OF_DONE.md`.
