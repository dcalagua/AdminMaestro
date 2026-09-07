# GAP MATRIX — EBIM Control Plane V2

Generada en Fase 01 (2026-09-07) contra la DB local verificada. Es el plan de trabajo
de las fases 02-18: cada gap tiene dueño de fase y se cierra con evidencia.

Leyenda de estado: `OK` = ya existe y sirve · `PARTIAL` = existe pero incompleto ·
`MISSING` = no existe.

---

## A. Administración / escritura

| # | Área | Estado | Existente | Falta | Riesgo | Fase |
|---|---|---|---|---|---|---|
| A-1 | Mutaciones en el cliente | **MISSING** | `queries.ts` con 24 `useQuery` | Capa `mutations.ts`, invalidación de caché, feedback de error | Alto — la consola no administra nada | 02 |
| A-2 | Primitivos de formulario | **MISSING** | `primitives.tsx` sin inputs de formulario | `FormField`, `Modal`/`Drawer`, `Toast` reutilizables | Medio — cada página inventaría los suyos | 02 |
| A-3 | RPCs de escritura administrativa | **PARTIAL** | Solo `create_tenant`, `settle_commissions` | RPCs para producto, plan, precio, org, acuerdo, agente, atribución, plan/regla de comisión, suscripción, ítems, estado de tenant, target, provisioning | Alto | 02 |
| A-4 | Auditoría de escrituras | **PARTIAL** | `log_audit()` existe; solo la llaman `create_tenant` y `settle_commissions` | Todas las RPCs nuevas deben auditar | Alto — cambios sin rastro | 02 |
| A-5 | Autorización negativa comprobada | **PARTIAL** | RLS de SELECT probada (52 tests) | Tests negativos de ESCRITURA por RPC | Alto | 02, 16 |

## B. Suite / producto

| # | Área | Estado | Existente | Falta | Riesgo | Fase |
|---|---|---|---|---|---|---|
| B-1 | Alta de SaaS sin tocar código | **PARTIAL** | Tabla `saas_products` + GRANT insert/update | UI de alta/edición, validación de `code`, orden, branding | Medio | 03 |
| B-2 | Planes y precios gestionables | **MISSING** | `plans`/`plan_prices` con escritura REVOCADA a `authenticated` | RPC + UI de plan y tarifa por `charge_kind`/`billing_interval` | Alto — sin esto no se puede licenciar producto nuevo | 03 |
| B-3 | Catálogo de addons | **PARTIAL** | `catalog_items` solo lectura | Alta/edición vía RPC | Bajo | 03 |
| B-4 | Feature flags editables | **PARTIAL** | `tenant_features` con GRANT completo, sin UI de escritura | UI de toggle auditada | Bajo | 03, 14 |

## C. Partners / canal

| # | Área | Estado | Existente | Falta | Riesgo | Fase |
|---|---|---|---|---|---|---|
| C-1 | Alta de partner/reseller desde UI | **MISSING** | `organizations` + `organization_capabilities` | Formulario con capacidades (`PARTNER`,`RESELLER`,`CONSULTING`,`CUSTOMER`) | Alto | 04 |
| C-2 | Acuerdo distinto por SaaS | **PARTIAL** | `organization_product_agreements` (1 fila por org×producto, con `margin_rate`, `can_resell`, `can_manage_tenants`, `default_deployment_mode`) | UI que deje gestionar N acuerdos y RPC que valide solapamiento de vigencias | Medio | 04 |
| C-3 | Partner Shared con N tenants | **PARTIAL** | `tenants.managing_organization_id` + trigger `enforce_tenant_manager_agreement` | Comprobación explícita en escenario y seed | Medio | 04, 15 |
| C-4 | Comercial sin acceso operativo | **OK** | `my_attributed_tenant_ids()` separado de `my_tenant_ids()`; ningún camino crea `tenant_memberships` desde venta | Test negativo dedicado que lo fije como invariante de V2 | Alto si se rompe | 04, 16 |

## D. Tenants / licenciamiento

| # | Área | Estado | Existente | Falta | Riesgo | Fase |
|---|---|---|---|---|---|---|
| D-1 | Alta transaccional tenant+subscription+items | **MISSING** | `create_tenant()` crea SOLO el tenant | RPC de onboarding atómica: tenant + subscription + items + atribución + provisioning DRY_RUN | Alto — hoy se crea un tenant sin contrato asociado | 05 |
| D-2 | Implementation fee one-time sin inflar MRR | **PARTIAL** | `charge_kind='IMPLEMENTATION_FEE'`, `billing_interval='ONE_TIME'`, vista `v_subscription_mrr` | Verificar que la vista excluye ONE_TIME y fijarlo con test | Alto — MRR falso | 05, 13 |
| D-3 | DEMO sin recurrente | **OK** | Trigger `enforce_demo_not_recurring` | Test de regresión V2 | Medio | 05, 16 |
| D-4 | Suspender/activar auditable | **MISSING** | `tenants.status` editable por GRANT directo, sin auditoría | RPC `set_tenant_status` con motivo + `log_audit` | Alto | 05 |
| D-5 | Partner Dedicated: base + N licencias + infra | **PARTIAL** | `plans.is_partner_base`, `charge_kind` `PARTNER_BASE_LICENSE`/`TENANT_LICENSE`/`INFRASTRUCTURE_FEE` | Composición guiada y validación de coherencia | Medio | 06 |
| D-6 | Tenant Dedicated: enterprise + infra + impl + soporte | **PARTIAL** | `charge_kind='SUPPORT_FEE'`, trigger `enforce_deployment_coherence` | Composición guiada y seed | Medio | 06 |

## E. Cobranza

| # | Área | Estado | Existente | Falta | Riesgo | Fase |
|---|---|---|---|---|---|---|
| E-1 | Método de cobro por subscription | **MISSING** | nada | Tabla `subscription_collection_profiles` + enum de método + RPC + UI | Alto — es el corazón del prompt | 07 |
| E-2 | Dos SaaS del mismo cliente con métodos distintos | **MISSING** | — | Se resuelve solo si E-1 se modela por `subscription_id`, no por organización | Alto | 07, 15 |
| E-3 | OS/OC como documento comercial | **MISSING** | nada | Tabla `commercial_documents` con ciclo `REQUESTED→RECEIVED→APPROVED→EXPIRED/REJECTED` | Alto | 08 |
| E-4 | OS/OC aprobada ≠ pago | **MISSING** | — | Invariante: aprobar documento NO inserta en `payments` ni devenga comisión | Alto — falsearía ingresos | 08, 16 |
| E-5 | Transferencia / manual | **PARTIAL** | `payments.method` es texto libre | Métodos normalizados en el perfil de cobro + registro manual auditado | Medio | 07, 08 |

## F. Culqi / proveedor de pago

| # | Área | Estado | Existente | Falta | Riesgo | Fase |
|---|---|---|---|---|---|---|
| F-1 | Diseño de adapter desacoplado | **MISSING** | nada | `docs/payments/CULQI_ARCHITECTURE.md` + interfaz `PaymentProvider` | Alto | 09 |
| F-2 | Mapeo de entidades externas | **MISSING** | nada | `payment_provider_customers/cards/plans/subscriptions` con `provider` + `external_id` | Alto | 09, 10 |
| F-3 | Webhook idempotente | **MISSING** | nada | `payment_provider_events` con clave única de evento + Edge Function | Alto — pagos duplicados | 10 |
| F-4 | Secret fuera de React/DB/Git | **PARTIAL** | `scripts/secrets-scan.mjs` existe; `.env.example` sin secretos | Ampliar el escáner a patrones Culqi y verificarlo | Alto | 09, 10, 16 |
| F-5 | Modo TEST/MOCK sin credenciales | **MISSING** | — | Adapter mock funcional y explícito | Alto — si no, la fase queda inejecutable | 10 |
| F-6 | Reconciliación proveedor↔local | **MISSING** | — | Función/Edge `payment-reconcile` + vista de diferencias | Medio | 10, 13 |

## G. Renovaciones

| # | Área | Estado | Existente | Falta | Riesgo | Fase |
|---|---|---|---|---|---|---|
| G-1 | Política de anticipación/gracia | **MISSING** | `subscriptions.ends_on` sin política | Tabla de política + campos `advance_days`, `grace_days` | Alto | 11 |
| G-2 | Alertas de vencimiento | **MISSING** | nada | Tabla `billing_alerts` + función determinista e idempotente | Medio | 11 |
| G-3 | Suspensión configurable | **MISSING** | — | Función de suspensión automática auditada, activable | Alto | 11 |

## H. Finanzas / comisiones

| # | Área | Estado | Existente | Falta | Riesgo | Fase |
|---|---|---|---|---|---|---|
| H-1 | Comisión desde cobro confirmado | **OK** | `generate_commission_events()` + trigger `payments_generate_commissions` | Extender a pagos originados por proveedor externo | Alto si se rompe | 12 |
| H-2 | Comisión de implementación por regla | **OK** | `basis='COLLECTED_IMPLEMENTATION'` | Test explícito | Medio | 12 |
| H-3 | Reversals sin borrar historia | **PARTIAL** | `payment_status='REVERSED'` existe; no hay lógica de reverso de comisión | Evento de reverso que anula sin `DELETE` | Alto — pérdida de trazabilidad | 12 |
| H-4 | Dashboard por moneda / FX explícito | **PARTIAL** | `dashboard_summary` ya devuelve `*_by_currency` | Mantener separación y no mezclar (R-02 del baseline) | Medio | 13 |
| H-5 | MRR/cobrado/costo/comisión/margen por producto-partner-tenant | **PARTIAL** | 7 vistas ya existen | Vista de margen que descuente comisión, y reconciliación | Medio | 13 |

## I. Seguridad / calidad

| # | Área | Estado | Existente | Falta | Riesgo | Fase |
|---|---|---|---|---|---|---|
| I-1 | RLS + FORCE en tablas nuevas | **N/A aún** | Bucle del baseline solo cubrió lo que existía en 09 | Cada migración V2 declara `enable`+`force` + política | Alto | 07-11, 16 |
| I-2 | `anon` sin acceso de negocio | **OK** | `revoke usage on schema platform from anon` | Re-verificar tras cada tabla nueva | Alto | 16 |
| I-3 | Tests negativos cross-partner/cross-tenant | **PARTIAL** | `01_rls_isolation.test.sql` cubre el baseline | Cubrir tablas y RPCs de V2 | Alto | 16 |
| I-4 | Escáner de secretos | **PARTIAL** | `scripts/secrets-scan.mjs` | Patrones Culqi/`service_role`/PAN; ejecutarlo en el gate | Alto | 16 |
| I-5 | E2E de flujos V2 | **PARTIAL** | 21 smoke Playwright | Flujos de escritura: alta de producto, onboarding, perfil de cobro, OS/OC | Medio | 17 |
| I-6 | `build`/`typecheck` fiables | **CORREGIDO EN 01** | Ver `AUDIT_BASELINE.md` §5 | — | — | 01 ✅ |

## J. Documentación

| # | Área | Estado | Existente | Falta | Riesgo | Fase |
|---|---|---|---|---|---|---|
| J-1 | Docs de arquitectura V2 | **PARTIAL** | `docs/architecture/*` del baseline | Actualizar con modelo de cobranza, Culqi, OS/OC, renovaciones | Medio | 18 |
| J-2 | Reporte final con evidencia | **MISSING** | — | `docs/nightly-v2/FINAL_REPORT_V2.md` | Alto | 18, 98 |
| J-3 | Convenciones contrastadas con GUIDELINES_ROOT | **BLOCKED_EXTERNAL** | snapshot local `EBIM_CONVENTIONS.md` | Contraste en vivo — bloqueado (BE-01) | Bajo | — |

---

## Resumen por fase

| Fase | Gaps que cierra |
|---|---|
| 02 | A-1, A-2, A-3, A-4, A-5 |
| 03 | B-1, B-2, B-3, B-4 |
| 04 | C-1, C-2, C-3, C-4 |
| 05 | D-1, D-2, D-3, D-4 |
| 06 | D-5, D-6 |
| 07 | E-1, E-2, E-5 |
| 08 | E-3, E-4 |
| 09 | F-1, F-2, F-4 |
| 10 | F-3, F-5, F-6 |
| 11 | G-1, G-2, G-3 |
| 12 | H-1, H-2, H-3 |
| 13 | H-4, H-5, F-6 |
| 14 | B-4, UI 360 |
| 15 | C-3, E-2, D-5, D-6 (escenarios) |
| 16 | I-1…I-4, A-5, C-4, E-4 |
| 17 | I-5 |
| 18 | J-1, J-2 |
