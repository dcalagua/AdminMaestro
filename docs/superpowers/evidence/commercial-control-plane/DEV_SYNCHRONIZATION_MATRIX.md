# DEV synchronization matrix — Phase 18 (LOCAL, program branches)

- Run: `certification/20260929-final/` (stamp `20260929T080054Z`), produced by
  `scripts/ccp/certify-local.sh --record ewm suite … --record tms suite …`, verdict by
  `scripts/ccp/checks/summarize.mjs` against spec §19.1.
- LOCAL only.
  - Every database started empty: `supabase db reset --local` for MasterAdmin and for the disposable eChange/eExpense stacks.
  - No QAS, no PRD, no push, no `link`/`db push`/`functions deploy`/`secrets set`.
- Every one of the 27 steps exited 0 (`steps.tsv`).

## Heads certified

| Repo | Head (`feature/ebim-commercial-control-plane-v1`) |
| --- | --- |
| MasterAdmin | `d8b0c16` (+ this closure commit; billing MA-60 `1ab13a6`, MA-61 `be7d220`) |
| eCommerce | `e82bd2e` |
| EWM | `601ebb5` |
| Comerza | `0ee7537` |
| TMS | `9397ff5` |
| eSupplier | `86021db` |
| eChange | `916264b` |
| eExpense | `f2389dc` |
| GMAO | `587e94a` |

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

- ¹ TMS has no approved meter (phase 17).
- ² No ALLOWANCE or credits are registered in the SaaS (D-03/D-05). Nothing was invented.
- ³ There is no local commercial biller. MasterAdmin claims each finalized aggregate once (pgTAP 41).

## Legacy authority state (check 13)

| Product | Entitlements | Billing |
| --- | --- | --- |
| eCommerce | SHADOW | no local biller (Culqi belongs to the tenant storefront) |
| EWM | SHADOW (V49) | no local biller |
| Comerza | SHADOW | no biller/price; `billable=false` by CHECK |
| TMS | SHADOW (V52) | no biller/price |
| eSupplier | SHADOW | no biller; `plans.monthly_price` is informational legacy |
| eChange | SHADOW | no biller |
| eExpense | SHADOW | `LEGACY_AUTHORITY` (local `billing-run` active) |
| GMAO | DUAL_READ | `LEGACY_AUTHORITY` (local `charge` active); hub:`<app>` = LEGACY_AUTHORITY |

## Final acceptance items

| Item | Evidence |
| --- | --- |
| desired/applied version + checksum | checks 2–4 in all 8. The GET is verified by `entitlement-sync-e2e` and by each X-07 |
| add/remove/downgrade | check 6 in all 8 (X-07: v1→v2→v3, STALE and CONFLICT → 409) |
| self-grant denied | check 5 in all 8 (pgTAP + product suite / X-07 legacy write blocked in PRIMARY) |
| offline last-good | check 7 in all 8 (MasterAdmin unreachable → the gate keeps the last-good) |
| drift reconciliation | check 8 in all 8 (GET exposes applied ≠ desired → push → IN_SYNC) |
| usage + dedupe | checks 9–10 in 7 of 8 (TMS N/A). `usage-x07`: real sender → real `usage-ingest` → `DUPLICATE` |
| allowance/credit arithmetic | check 11 in eCommerce, eSupplier, eExpense, GMAO, plus MasterAdmin pgTAP 33–41 |
| no double billing | check 12: eExpense (X-07 21) and GMAO (`charge` → 409). The MasterAdmin usage line references the FINALIZED aggregate, once per closed period (MA-60) |
| legacy authority state | check 13 (table above) |
| original CREATE/REPLAY/GET | check 15: provisioning adapter golden (INV-1, unedited) + product suites |

## Full suites per repo (this run)

| Repo | Result |
| --- | --- |
| MasterAdmin | from empty DB: pgTAP all green. MA gate: pgTAP 1647/1647, vitest 1190/1190, typecheck/lint/build/deno check, node:test 15/15, secrets PASS, no new advisors |
| MasterAdmin e2e | `provisioning-golden`, `entitlement-sync-e2e`, `usage-x07` exit 0 |
| eCommerce | `test:db` + X-07 exit 0 |
| EWM | `./mvnw -B clean verify`, run as `clean verify -DskipITs` then `failsafe:integration-test failsafe:verify`: unit 1512/0/0 (1 skipped), **IT 1535/0/0**. X-07 exit 0 |
| Comerza | `test:db`, from-zero rebuild with seed, and X-07 exit 0 |
| TMS | `./mvnw -o -B clean test` on disposable PostGIS 17 (`TMS_TEST_DB_URL`): **2103/0/0**, 1 skipped (opt-in X-07 bridge). X-07 exit 0 |
| eSupplier | SQL + golden, X-07 exit 0 |
| eChange | pgTAP (against the pre-existing baseline of 10, identical at `3d6f34e`), golden/parity, X-07 exit 0 |
| eExpense | pgTAP, golden, X-07 exit 0 |
| GMAO | PGlite SQL (5 runners), `deno test`, X-07 exit 0 |

### Java suite root causes resolved in this phase

- **EWM `YardVisitIT` (24 errors)** is fixed in EWM `601ebb5`. Phase 17 had classified it as pre-existing harness pollution by `NeoRetailSeedSmokeIT`. Re-measured, that turned out to be wrong: the base `7c086e8` runs the full IT suite at 1525/0/0.
  - The real cause: `@TestPropertySource` gives `PlatformEntitlementsIT` (added in phase 10) its own Spring context with its own Hikari pool. That leaves 12 cached pools against the shared PostgreSQL (11 at the base), and `YardVisitIT`'s Flyway gets "too many clients".
  - The fix is `@DirtiesContext(AFTER_CLASS)`, test only. The result is IT 1535/0/0.
- **TMS `IdentityResolutionIntegrationTest` (10 errors)** is not a code defect. The earlier Phase 18 run used Testcontainers and hit a Flyway V13 deadlock. With the repo's documented mechanism (`TMS_TEST_DB_URL`, as in phase 12), the suite is 2103/0/0 on the same code (`9397ff5` only adds docs over `f009380`).

## Spec §19.1 verdict

| Criterion | Status |
| --- | --- |
| (1) P0 security | met ×8 |
| (2) contract | met ×8 |
| (3) registry | met ×8 |
| (4) state IN_SYNC by GET | met ×8 |
| (5) enforcement | met ×8 |
| **(6) cutover `MASTERADMIN_PRIMARY` + legacy writes blocked** | **NOT met ×8**: seeded in SHADOW (GMAO DUAL_READ) |
| (7) usage | met (TMS: N/A) |
| **(8) billing ≥ `BILLING_SHADOW`, diff 0** | met / N/A in 6. **NOT met in eExpense and GMAO** (`LEGACY_AUTHORITY`; SHADOW with diff 0 is shown only inside X-07) |

These are not test failures. The spec (§ modes table, D-14) says no mode advances "sin aprobación humana explícita" (without explicit human approval). Moving a product to `MASTERADMIN_PRIMARY` or `BILLING_SHADOW` without D-14 would violate the approved spec. The program does not make that decision.

### What must happen before `DEV_ALL_8_SYNCHRONIZED=YES` can be issued

| Product | Required |
| --- | --- |
| all | D-14 approved (observation windows per environment) and a human authorization per product/axis |
| all | a single `appActive=false` criterion (TMS suspends operation; others only the commercial side) |
| EWM | authorized Supabase migration for the server-side block of `admin_set_agent` in PRIMARY |
| Comerza | decide the shared-provider cap |
| eSupplier | adopt legacy tenants with no provisioning mapping (or PRIMARY per tenant); P-08 |
| eChange / eExpense | adopt pre-MasterAdmin tenants |
| eExpense / GMAO | move billing to `BILLING_SHADOW` with a diff-0 report for a certified period; P-05 (no QAS separate from production) |
| GMAO | D-03 (`gmao.ai.requests`); verify the live hub schema |

Then re-run `scripts/ccp/certify-local.sh --with-java-suites` (or with `--record`).
