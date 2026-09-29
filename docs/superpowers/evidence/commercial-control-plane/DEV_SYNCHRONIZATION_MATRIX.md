# DEV synchronization matrix — Phase 18 (LOCAL/DEV, program branches, D-14 APPROVED)

- Run: `certification/20260929-d14-final3/` (stamp `20260929T170038Z`), produced by
  `scripts/ccp/certify-local.sh --record ewm suite … --record tms suite …`, verdict by
  `scripts/ccp/checks/summarize.mjs` against spec §19.1 (steps + D-14 evidence).
- **Verdict: `DEV_ALL_8_SYNCHRONIZED=YES`** — all 8 products `SYNCHRONIZED`, `CERTIFY_EXIT=0`.
- D-14 human decision: **APPROVED for DEV/LOCAL only** (spec amendment `c9ff5c8`).
- LOCAL only.
  - Every database started empty: `supabase db reset --local` for MasterAdmin and for the disposable eChange/eExpense stacks.
  - No QAS, no PRD, no push/merge/publish, no `link`/`db push`/`functions deploy`/`secrets set`, no remote Supabase mutation.
- All 29 steps exited 0 (`steps.tsv`), including the final `masteradmin · d14-axes` (24/24 PASS).
- Superseded run: `20260929-final/` (pre-D-14, verdict NOT_SYNCHRONIZED by governance only).

## Heads certified

| Repo | Head (`feature/ebim-commercial-control-plane-v1`) |
| --- | --- |
| MasterAdmin | `c9ff5c8` + the closure commit (e2e fixture step 9b, d14-axes resilience, this matrix) |
| eCommerce | `708d53c` |
| EWM | `60167c2` |
| Comerza | `0ee7537` |
| TMS | `3369f94` |
| eSupplier | `86021db` |
| eChange | `916264b` |
| eExpense | `f2f2934` |
| GMAO | `40933e5` |

## The 15 Phase 18 checks

P = PASS, N/A = the product has no such surface (reason in `<product>.json`).

| # | Check | eCommerce | EWM | Comerza | TMS | eSupplier | eChange | eExpense | GMAO |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 1 | canonical MasterAdmin mapping | P | P | P | P | P | P | P | P |
| 2 | desired entitlement generated | P | P | P | P | P | P | P | P |
| 3 | SaaS applied same version/checksum | P | P | P | P | P | P | P | P |
| 4 | GET same applied state | P | P | P | P | P | P | P | P |
| 5 | tenant self-grant denied | P | P | P | P | P | P | P | P |
| 6 | add/remove/downgrade version transition | P | P | P | P | P | P | P | P |
| 7 | offline last-good | P | P | P | P | P | P | P | P |
| 8 | drift reconciled | P | P | P | P | P | P | P | P |
| 9 | usage event accepted once | P | P | P | N/A¹ | P | P | P | P |
| 10 | duplicate deduped | P | P | P | N/A¹ | P | P | P | P |
| 11 | allowance/credit arithmetic | P | N/A² | N/A² | N/A | P | N/A² | P | P |
| 12 | no duplicate billing | N/A³ | N/A³ | N/A³ | N/A³ | N/A³ | N/A³ | P | P |
| 13 | local price/billing authority stage explicit | P | P | P | P | P | P | P | P |
| 14 | technical configuration still works | P | P | P | P | P | P | P | P |
| 15 | CREATE/REPLAY/GET provisioning regression | P | P | P | P | P | P | P | P |
| | **totals** | 14P/1 | 13P/2 | 13P/2 | 11P/4 | 14P/1 | 13P/2 | 15P | 15P |

- ¹ TMS has no approved meter (phase 17).
- ² No ALLOWANCE or credits are registered in the SaaS (D-03/D-05). Nothing was invented.
- ³ There is no local commercial biller. MasterAdmin claims each finalized aggregate once (pgTAP 41).

## D-14 final state (DEV/LOCAL)

SaaS evidence: `d14/d14-<product>.json`. MasterAdmin axes: `d14/d14-masteradmin.json` (24/24).

| Product | SaaS entitlements (scope → final) | MasterAdmin entitlements axis | Billing axis | Legacy commercial write in PRIMARY | Parity blocking | `appActive=false`: commercial denied / operation continues | SaaS D-14 checks |
| --- | --- | --- | --- | --- | --- | --- | --- |
| eCommerce | PRODUCT → PRIMARY | MASTERADMIN_PRIMARY | BILLING_LEGACY (no local biller) | BLOCKED | 0 | yes / yes | 28/0 |
| EWM | COHORT → PRIMARY | MASTERADMIN_PRIMARY | BILLING_LEGACY (no local biller) | BLOCKED (server-side, approved EWM migration) | 0 | yes / yes | 26/0 |
| Comerza | COHORT → PRIMARY | MASTERADMIN_PRIMARY | BILLING_LEGACY (`billable=false`) | BLOCKED | 0 | yes / yes | 26/0 |
| TMS | PRODUCT → PRIMARY | MASTERADMIN_PRIMARY | BILLING_LEGACY (no biller/price) | no legacy write path | 0 | yes / yes | 25/0 |
| eSupplier | COHORT → PRIMARY | MASTERADMIN_PRIMARY (cohort 1/1 IN_SYNC) | BILLING_LEGACY | BLOCKED | 0 | yes / yes | 26/0 |
| eChange | PRODUCT → PRIMARY | MASTERADMIN_PRIMARY | BILLING_LEGACY | BLOCKED | 0 | yes / yes | 30/0 |
| eExpense | PRODUCT → PRIMARY | MASTERADMIN_PRIMARY | **BILLING_SHADOW**: diff 0, period 2026-10, report `sha256:9f67da55…5276`, 0 gateway calls | BLOCKED | 0 | yes / yes | 39/0 |
| GMAO | PRODUCT → MASTERADMIN_AUTHORITY (= contract PRIMARY) | MASTERADMIN_PRIMARY | **BILLING_SHADOW**: diff 0, period 2026-10, report `sha256:8cab8b95…002b`, no duplicate charge | BLOCKED | 0 | yes / yes | 41/0 |

- Every transition went through the governed RPC one step at a time (`LEGACY_ONLY → SHADOW → DUAL_READ → MASTERADMIN_PRIMARY`), with the D-14 reason and append-only history. None was forced.
- Billing stopped at `BILLING_SHADOW` for eExpense/GMAO (`masteradminAuthorityReached=false`). The local billers remain the collectors, as D-14 requires.
- **Legacy tenants** (eCommerce 1, EWM 2, Comerza 2, TMS 1, eSupplier 1, eChange 13, eExpense 1, GMAO 1): all `UNRESOLVED`.
  - None has a deterministic mapping (no ACTIVE provisioning record and no plan/price/quota/add-on evidence).
  - Under D-14 rule 4 they were **not** adopted and no commercial value was invented.
  - They stay in legacy under the product-scope mode and are excluded from the PRIMARY cohort. P-08 (LEGACY_BACKFILL) remains the path to adopt them.

## Final acceptance items

| Item | Evidence |
| --- | --- |
| desired/applied version + checksum | checks 2–4 in all 8; GET verified by `entitlement-sync-e2e` (22/22) and each X-07 D-14 `getVerified` |
| add/remove/downgrade | check 6 in all 8 (X-07: v1→v2→v3, STALE and CONFLICT → 409) |
| self-grant denied | check 5 in all 8; legacy writes BLOCKED in PRIMARY (table above) |
| offline last-good | check 7 in all 8 (MasterAdmin unreachable → the gate keeps the last-good) |
| drift reconciliation | check 8 in all 8 (GET exposes applied ≠ desired → push → IN_SYNC) |
| usage + dedupe | checks 9–10 in 7 of 8 (TMS N/A). `usage-x07`: real sender → real `usage-ingest` → `DUPLICATE` |
| allowance/credit arithmetic | check 11 in eCommerce, eSupplier, eExpense, GMAO, plus MasterAdmin pgTAP 33–41 |
| no double billing | check 12: eExpense and GMAO (`duplicateCharge=false`). The MasterAdmin usage line references the FINALIZED aggregate, once per closed period (MA-60) |
| billing ≥ BILLING_SHADOW, diff 0 | eExpense and GMAO: mismatches 0, computed by MasterAdmin, negative control detected |
| original CREATE/REPLAY/GET | check 15: provisioning adapter golden (INV-1, unedited) + product suites |

## Full suites per repo

| Repo | Result |
| --- | --- |
| MasterAdmin | from empty DB: pgTAP all green. MA gate: pgTAP 1647/1647, vitest 1190/1190, typecheck/lint/build/deno check, node:test 15/15, secrets PASS, no new advisors |
| MasterAdmin e2e | `provisioning-golden`, `entitlement-sync-e2e` 22/22, `usage-x07`, `d14-axes` 24/24, all exit 0 |
| eCommerce | `test:db` + X-07 exit 0 |
| EWM | recorded `EW18-05-full-verify.txt` @ `88ec8c7`: unit 1512/0/0 (1 skipped), **IT 1535/0/0**, `EXIT=0`. X-07 exit 0 |
| Comerza | `test:db`, from-zero rebuild with seed, X-07 exit 0 |
| TMS | recorded `TM18-05-full-it.txt` @ `19875b2`: **2114/0/0**, 1 skipped (opt-in bridge), `EXIT=0`. X-07 exit 0 |
| eSupplier | SQL + golden, X-07 exit 0 |
| eChange | pgTAP (pre-existing baseline of 10 at `3d6f34e`, unchanged), golden/parity, X-07 exit 0 |
| eExpense | pgTAP, golden, X-07 exit 0 |
| GMAO | PGlite SQL, `deno test` 160/0, X-07 exit 0 |

The Java suites were not rerun. Only docs commits came after the recorded heads (`60167c2` over `88ec8c7`, `3369f94` over `19875b2`).

## Spec §19.1 verdict

| Criterion | Status |
| --- | --- |
| (1) P0 security | met ×8 |
| (2) contract | met ×8 |
| (3) registry | met ×8 |
| (4) state IN_SYNC by GET | met ×8 |
| (5) enforcement | met ×8 |
| (6) cutover `MASTERADMIN_PRIMARY` + legacy writes blocked | **met ×8** (DEV/LOCAL, D-14) |
| (7) usage | met (TMS: N/A) |
| (8) billing ≥ `BILLING_SHADOW`, diff 0 | **met**: eExpense/GMAO SHADOW diff 0; N/A in the other 6 |

## Out of scope / still open (not blocking DEV)

- QAS (GATE C `PROMOTE_COMMERCIAL_CONTROL_PLANE_TO_QAS=YES`) and PRD: not touched.
- `BILLING_AUTHORITY` for eExpense/GMAO: not authorized by D-14.
- Adopting legacy tenants (P-08), D-02/D-03/D-04/D-05/D-06/D-12 business decisions, and usage ingest ON: still open.
- Backlog outside the program:
  - eChange DEFINER grants (10 pre-existing pgTAP);
  - eCommerce `storage_buckets` from-zero portability;
  - GMAO live hub schema verification (phase 19).
