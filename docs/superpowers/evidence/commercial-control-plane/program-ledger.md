# EBIM Commercial Control Plane v1 — Program ledger

## 2026-09-27 — Phase 00 (repo reconciliation)
- PHASE_00=PASS. Bases per `program-state/repo-state.tsv` (MasterAdmin 346aa72 local-dev; eSupplier a61dd22 and eCommerce 7da2ae4 from origin/dev; eExpense f282dc4 dev while root is on qas).

## 2026-09-27 — Phase 01 (architecture spec)
- Created MasterAdmin program worktree `.worktrees/ebim-commercial-control-plane-v1` on `feature/ebim-commercial-control-plane-v1` from 346aa72.
- Read-only discovery of 9 repos + GUIDELINES_ROOT; no product code modified in any repo.
- Spec: `docs/superpowers/specs/2026-09-27-ebim-commercial-control-plane-design.md`.
- Key decisions: versioned full-state entitlement snapshot (JCS SHA-256 checksum, monotonic version) pushed via new additive `PUT/GET /tenants/{id}/entitlements`; SaaS-local last-good enforcement without expiry; usage via SaaS outbox → signed ingest → append-only events → FINALIZED aggregates; AI in EBIM credits with append-only ledger; new charge kind `USAGE_OVERAGE`; DISCOUNT correction on next invoice via `corrects_line_id`; two-axis cutover (entitlements / billing) per product and cohort.
- Discovery corrections: eChange is an ITIL service desk (not FX); hub table is `company_addons`.
- Open business decisions D-01..D-15 (spec §20). Contract §2.6 deviation for usage ingest pending (D-12).
- P0 inventory recorded in spec §1.4 (incl. MasterAdmin `tenant_addons`/`tenant_features` authenticated CRUD).
- Status: PHASE_01=SPEC_REVIEW_REQUIRED (GATE A).

## 2026-09-27 — Phase 02 (implementation plan)
- Precondition: HUMAN_SPEC_APPROVAL=YES supplied to the phase (GATE A passed).
- Read-only verification of all 9 repos at selected bases; no product code, migrations or remote state changed. No SaaS worktree created yet (created on first modification, phase 04+).
- Plan: `docs/superpowers/plans/2026-09-27-ebim-commercial-control-plane-implementation.md`.
- New verified facts: DISCOUNT stored positive → invoice total adds it, MRR ignores it, commissions count it (P-01/P-02); seed has 5 of 8 products (P-03); eExpense and GMAO remote projects are effectively productive (P-05); GMAO `charge` currency override without conversion (P-06); eChange PUBLIC-execute function at `M/20260815130000:47` is `executive_summary_de`.
- SaaS push rules (eCommerce, EWM, Comerza, TMS, eExpense) stricter than MasterAdmin; plan subordinates to them.
- Plan decisions P-01..P-07 require human review.
- Status: PHASE_02=PLAN_REVIEW_REQUIRED (GATE B).
