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

## 2026-09-27 — Phase 03 (MasterAdmin P0)
- Precondition: HUMAN_PLAN_APPROVAL=YES supplied to the phase (GATE B passed; P-01/P-02 approved with the plan).
- LOCAL only (guard `scripts/ccp/guard-env.sh`); no remote Supabase command, no push.
- Commits (MasterAdmin): `00e2f4e` MA-00 guard + baseline · `80456ca` MA-01 preservation hashes · `a396c81` MA-02 DISCOUNT sign · `63f8b74` MA-03 self-grant lockdown · MA-04 evidence commit.
- Migrations: `20260928000100_ccp_discount_sign.sql`, `20260928000200_ccp_commercial_write_lockdown.sql`. Tests: `26_ccp_preservation`, `27_ccp_discount` (20), `28_ccp_commercial_self_grant` (46).
- Gate: pgTAP 916/916 · vitest 778/778 · typecheck/lint/build OK · secrets PASS · advisors local: no new findings · protected provisioning diff vs 346aa72 empty.
- Deviations: (1) issued-invoice lines are not trigger-blocked as the plan assumed; protection is the absence of API write grants on `invoice_lines` → added read-only `v_discount_sign_legacy_invoices` to expose legacy totals (local count 0; QAS measured read-only in phase 19). (2) `v_collected_payments` and `get_subscription_billing_status` also switched to signed amounts to keep reconciliation. (3) INV-3/INV-4 hashes use natural keys + day offsets (seed ids random, dates relative); local seed has no mappings/requests (empty-table hash). (4) EBIM_FINANCE gains `set_tenant_feature` (gate now `can_manage_commercial()`). (5) KPI vitest lives in `executive-contracts.test.ts` (no `kpis.test.ts`).
- Supabase docs finding: new functions get EXECUTE for PUBLIC by default and anon/authenticated share default privileges → explicit revoke/grant on every new or redefined function.
- Evidence: `phase-03-masteradmin-p0.md`, `logs/MA-0*-*`, `supabase-cli-masteradmin.txt`, rollback `docs/runbooks/ccp-rollback/03.sql`.
- Status: PHASE_03=PASS.

## 2026-09-27 — Phase 04 (eExpense P0)
- LOCAL only. eExpense worktree `eExpenses/.worktrees/ebim-commercial-control-plane-v1` created on `feature/ebim-commercial-control-plane-v1` from `f282dc4` (`git fetch origin` failed inside the sandbox — SSH; cached `dev == origin/dev == f282dc4`, same as phase 00). `.worktrees/` and the `web/node_modules` symlink excluded via `.git/info/exclude`. No push (eExpense rule: local commits only).
- Local DB: `supabase db start/reset --local --workdir $TMPDIR/eexpense-ccp` (config copy, DB port 55822; ports 54321/54322 taken by another stack). Repo `config.toml` untouched. Nothing against `uvjmdphlnpyhtohobvzx`.
- Commits (eExpense): `d5c3a3e` EX-00 · `a5ecaa7` EX-01 · `b9223af` EX-02 · `7e410c5` EX-03 · `5e2a436` EX-04 · `03d6e03` EX-05 · `3e5ac28` EX-06 · `090645e` EX-07/08 evidence.
- Migrations: `20260928100000_ccp_commercial_columns_lockdown.sql`, `20260928100100_ccp_addon_requests.sql`. Tests: `ccp_commercial_columns_test.sql` (41), `ccp_addon_requests_test.sql` (16), vitest +60 (requireTenantActor, aiEndpointsAuth, whatsappInboundSignature, billingWebhook, platformSubscribe, billingRunCharacterization).
- Gate: vitest 120/120 · typecheck/build OK · deno check 14/14 · pgTAP 41/41, 16/16, provisioning 44/44 · INV-1 protected diff empty · INV-4 plans/addons hash unchanged · advisors: no new findings · rollback dry-run OK.
- Supabase docs finding: `verify_jwt` accepts any valid project JWT (incl. legacy anon) → handlers must resolve the user with `auth.getUser(token)`; new publishable/secret keys are not JWTs.
- Deviations: (1) shared `serveForTenantActor` wrapper + per-function wiring tests instead of 10 `core.ts` extractions; (2) platform superadmin passes without an active tenant (console calls `fiscal-validate`); (3) EX-05 also closes tenant self-DELETE/INSERT (RED showed a tenant admin could delete its tenant) and gates `white_label` on the add-on; guards read JWT claims so SECURITY DEFINER RPCs can't bypass; (4) new `addon_requests` queue for EX-06; (5) legacy billing characterization by source hash + patterns; (6) own NULL-handling bug in the guard caught by pgTAP before commit.
- Open (recorded, not expanded): AI add-on entitlement gating server-side → phase 15; hub `platform-register subscribe` → phase 05; `billing-run` non-constant-time cron secret compare and client-set `tenant_billing.payment_status` (legacy, migration target); 4 pre-existing deno type errors in `whatsapp-inbound`; add-ons UI request flow verified by typecheck/build only (no browser run).
- Deploy prerequisites for a future GATE C + P-05: `BILLING_WEBHOOK_SECRET` before deploying `billing-webhook` (else 503 by design; Culqi needs a signing relay); Twilio auth token in `tenant_whatsapp.auth_token`.
- Status: PHASE_04=PASS.
