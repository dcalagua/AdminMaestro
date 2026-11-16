# Mapa de add-ons y precios de la suite · 16-nov-2026

Inventario de lo que **cada app ya tiene** como plan, add-on, módulo, conector o canal con precio, leído de su base
en la nube y de su código el 16-nov-2026. Es el punto de partida para revisar los precios **app por app** con el área
comercial. Este repositorio es público: aquí no hay clientes; quién usa qué está en el informe privado de la auditoría.

## Cómo quedó en el Admin Maestro

- La migración `20261023000200_suite_addon_catalog_draft.sql` registra **111 add-ons en borrador**
  (`DRAFT`) con código `<app>_<add-on>`, el precio de referencia que hoy muestra la app en `price_month` y la fuente en
  la descripción.
- `DRAFT` no se puede activar en un tenant ni se factura. Nada de esto cambia lo que un cliente tiene ni lo que paga.
- **Para publicar un add-on** tras la reunión de su app: fijar la tarifa por mercado en `catalog_item_prices`
  (pantalla Catálogo) y pasarlo a `AVAILABLE`. Hasta entonces el precio de referencia es solo informativo.
- Los add-ons que ya existían en el catálogo (`licitaciones`, `echange_desk`, `sla_premium`, `white_label`,
  `multi_country`, `extra_company`, `consolidation`, `compras_repuestos`) no se duplican.
- Fuera del borrador: límites y cupos (usuarios, sociedades, créditos IA), módulos operativos internos (los 16 módulos
  de tienda de Comerza, la navegación de GMAO) y los núcleos incluidos (`tms.core`, `gmao.core`).

## Lo que hay que decidir por app

| App | Situación |
|---|---|
| TMS | Sin catálogo comercial propio: solo el núcleo. Precio = plan del Admin Maestro. |
| EWM | 7 agentes de IA con precio por **sociedad** (39–59 USD/mes) ya vendibles en la app; módulos y conectores del blueprint como «próximamente». |
| eSupplier | **Dos catálogos de planes que no coinciden**: la app (Starter 49 / Pro 199 / Enterprise 899) y el Admin Maestro (850 / 2.200 / 480 / 4.200). Todos los tenants de la app están en `pro`. Los agentes de IA no tienen precio. |
| eChange | No hay precio de lista: se cotiza por tenant. Los precios cargados (canales 25–149, agentes 60–140 USD/mes) son de una cotización. |
| Comerza | Sin precios en ningún lado. Agente de WhatsApp, vitrina y conector ERP como candidatos a add-on. |
| eCommerce | 25 funciones premium sin precio; el «starter» es el paquete de arranque. |
| eExpense | El catálogo más completo: 23 add-ons con precio (19–99 USD/mes por workspace) y planes Start 49 / Pro 102 / Enterprise 199. |
| GMAO | Planes en la base (Free / Pro 99 / Enterprise 499) que no coinciden con los documentos comerciales; add-ons sin precio. |

## TMS

_La app no tiene add-ons vendibles registrados._

## EWM

| Plan | Precio | Moneda | Notas |
|---|---|---|---|
| EWM Shared Standard | 700 | USD | MasterAdmin platform.plans/v_plan_price_catalog. SHARED, 1 sociedad incluida. PE: LICENSE 700 USD/mes + IMPLEMENTATION_FEE 2800 USD único; además una fila PE LI |
| EWM Partner Base | 1900 | USD | PARTNER_DEDICATED, partner base. PE: PARTNER_BASE_LICENSE 1900 USD/mes + INFRASTRUCTURE_FEE 1100 USD/mes. |
| EWM Partner · Tenant | 520 | USD | PARTNER_DEDICATED, por tenant activo del partner. PE: TENANT_LICENSE 520 USD/mes. |
| EWM Enterprise | 3800 | USD | TENANT_DEDICATED, 2 sociedades incluidas. PE: LICENSE 3800 USD/mes + INFRASTRUCTURE_FEE 1400 USD/mes + IMPLEMENTATION_FEE 15000 USD único. |

| Add-on | Tipo | Precio en la app (mes) | Unidad | Estado en la app | Código en el Admin Maestro |
|---|---|---|---|---|---|
| Copiloto | IA | 59 USD | Sociedad | Activo en la app | `ewm_wms_copilot` |
| Conteo por riesgo | IA | 39 USD | Sociedad | Activo en la app | `ewm_ai_cycle_count` |
| Slotting inteligente | IA | 59 USD | Sociedad | Activo en la app | `ewm_ai_slotting` |
| Detector de anomalías | IA | 45 USD | Sociedad | Activo en la app | `ewm_ai_anomaly` |
| Conciliador ERP | IA | 49 USD | Sociedad | Activo en la app | `ewm_ai_erp_reconcile` |
| Reposición predictiva | IA | 45 USD | Sociedad | Activo en la app | `ewm_ai_replenishment` |
| Optimizador de olas | IA | 49 USD | Sociedad | Activo en la app | `ewm_ai_wave_optimizer` |
| Captura inteligente | IA | — | Sociedad | Borrador en la app | `ewm_ai_capture` |
| Gestión de mano de obra y estándares | Módulo | 69 USD | — | Próximamente | `ewm_labor_management` |
| Facturación 3PL por actividad | Módulo | 89 USD | — | Próximamente | `ewm_wms_3pl_billing` |
| Patio, citas y muelles avanzado | Módulo | 49 USD | — | Próximamente | `ewm_yard_management` |
| Picking por voz | Módulo | 59 USD | — | Próximamente | `ewm_voice_picking` |
| Conectores ERP (1 conector) | Conector | 49 USD | — | Próximamente | `ewm_erp_sync` |
| Conector SAP nativo (B1 / ECC / S4) | Conector | 99 USD | — | Próximamente | `ewm_sap_integration` |
| EDI (X12 940/943/944/945/947, EDIFACT) | Conector | 79 USD | — | Próximamente | `ewm_edi_connector` |
| BI embebido (Fabric/Power BI) | Add-on | — | — | Próximamente | `ewm_bi_embedded` |
| SDK de personalización (webhooks) | Add-on | 79 USD | — | Próximamente | `ewm_custom_sdk` |

## eSupplier

| Plan | Precio | Moneda | Notas |
|---|---|---|---|
| Starter | 49 | USD | app public.plans; max_users 5, max_companies 2; enabled; no tenant uses it |
| Pro | 199 | USD | app public.plans; max_users 25, max_companies 10; enabled; ALL 8 cloud tenants are on 'pro' (default of create_tenant_operator and platform_provision_tenant) |
| Enterprise | 899 | USD | app public.plans; max_users null, max_companies null (unlimited); enabled |
| eSupplier Shared Standard | 850 | USD | Admin Maestro catalog; SHARED, 1 company included. LICENSE monthly: PE 850 USD / 3150 PEN, BO 850 USD / 5900 BOB, EC 700 USD. IMPLEMENTATION_FEE one-time: PE 35 |
| eSupplier Partner Base | 2200 | USD | Admin Maestro; PARTNER_DEDICATED, partner base. PE: PARTNER_BASE_LICENSE 2200 USD/mes + INFRASTRUCTURE_FEE 900 USD/mes + IMPLEMENTATION_FEE 8000 USD one-time |
| eSupplier Partner · Tenant | 480 | USD | Admin Maestro; PARTNER_DEDICATED, per active tenant inside the partner dedicated. TENANT_LICENSE monthly: PE 480 USD, BO 480 USD / 3300 BOB |
| eSupplier Enterprise | 4200 | USD | Admin Maestro; TENANT_DEDICATED, 3 companies included, multi_country. PE: LICENSE 4200 + INFRASTRUCTURE_FEE 1500 + SUPPORT_FEE 800 USD/mes, IMPLEMENTATION_FEE 1 |
| eSupplier Demo | 0 | USD | Admin Maestro; SHARED demo without recurring charge |

| Add-on | Tipo | Precio en la app (mes) | Unidad | Estado en la app | Código en el Admin Maestro |
|---|---|---|---|---|---|
| Auditor IA de homologación (homologation-auditor, homologation-scorecard) | IA | — | Tenant | Activo en la app | `esupplier_ai_auditor` |
| Captura IA (document-ocr-validator, ai-autofill, contact-email-check, bank-account-ocr) | IA | — | Tenant | Activo en la app | `esupplier_ai_capture` |
| Riesgo de Proveedor (supplier-risk) | IA | — | Tenant | Activo en la app | `esupplier_supplier_risk` |
| Asistente de Subsanación (homologation-subsanation) | IA | — | Tenant | Activo en la app | `esupplier_ai_subsanacion` |
| Analista de Cartera (supplier-portfolio) | IA | — | Tenant | Activo en la app | `esupplier_supplier_portfolio` |
| Descubrimiento Comercial (discover-commercial-presence) | IA | — | Tenant | Activo en la app | `esupplier_commercial_discovery` |
| Copiloto de Licitaciones (tender-copilot) | IA | — | Tenant | Activo en la app | `esupplier_tender_copilot` |
| Inteligencia de Contratos (ai_contracts) | IA | — | Tenant | Activo en la app | `esupplier_ai_contracts` |
| Validador 3-way (invoice-3way-validator) | IA | — | Tenant | Activo en la app | `esupplier_invoice_3way` |
| Validación de Facturas (invoice-validator) | IA | — | Tenant | Activo en la app | `esupplier_invoice_validator` |
| Dorothy copiloto + paneles IA (ai-chat, ai-insights) | IA | — | Tenant | Activo en la app | `esupplier_dorothy_copilot` |
| Contratos | Módulo | — | — | Activo en la app | `esupplier_contratos` |
| Factoring | Módulo | — | — | Activo en la app | `esupplier_factoring` |
| Encuestas de satisfacción de proveedores | Módulo | — | — | Activo en la app | `esupplier_encuestas` |
| Mesa de ayuda interna (helpdesk tickets) | Módulo | — | — | Activo en la app | `esupplier_mesa_de_ayuda` |

## eChange

| Plan | Precio | Moneda | Notas |
|---|---|---|---|
| eChange (núcleo: mesa de servicio + flota IA incluida + portal) | — | — | No existe tabla de planes ni precio de lista del núcleo en la base ni en el repo. Lo incluido = billing=incluido en ai_agents/channels. billing_plans es POR TEN |

| Add-on | Tipo | Precio en la app (mes) | Unidad | Estado en la app | Código en el Admin Maestro |
|---|---|---|---|---|---|
| Analista de adopción | IA | — | Tenant | Activo en la app | `echange_adoption_analyst` |
| Altas, bajas y equipos | IA | 140 USD | Tenant | Borrador en la app | `echange_asset_clerk` |
| Autoservicio | IA | — | Tenant | Activo en la app | `echange_deflector` |
| Correo entrante | IA | 60 USD | Tenant | Borrador en la app | `echange_email_intake` |
| Asistente de ingreso | IA | — | Tenant | Activo en la app | `echange_intake_assistant` |
| Reportería mensual | IA | 90 USD | Tenant | Activo en la app | `echange_report_writer` |
| Sentimiento de encuestas | IA | — | Tenant | Activo en la app | `echange_survey_sentiment` |
| Clasificador ITIL | IA | — | Tenant | Activo en la app | `echange_triage` |
| Notas de voz | IA | — | Tenant | Activo en la app | `echange_voice_transcriber` |
| Correo electrónico | Canal | 25 USD | Tenant | Activo en la app | `echange_email` |
| Portal de proveedores | Canal | 60 USD | Tenant | Activo en la app | `echange_esupplier` |
| Teléfono | Canal | 120 USD | Tenant | Activo en la app | `echange_phone` |
| Portal de autoservicio | Canal | — | Tenant | Activo en la app | `echange_portal` |
| Microsoft Teams | Canal | — | Tenant | Activo en la app | `echange_teams` |
| WhatsApp | Canal | 60 USD | Tenant | Activo en la app | `echange_whatsapp` |
| Línea telefónica de la mesa (número) | Servicio | 149 USD | Tenant | Activo en la app | `echange_service_line` |

## Comerza

| Add-on | Tipo | Precio en la app (mes) | Unidad | Estado en la app | Código en el Admin Maestro |
|---|---|---|---|---|---|
| Agente IA de WhatsApp | IA | — | — | Activo en la app | `comerza_ai_whatsapp_agent` |
| Vitrina (agentes de marketing) | Add-on | — | — | Borrador en la app | `comerza_storefront` |
| Conector ERP | Conector | — | — | Borrador en la app | `comerza_erp_connector` |

## eCommerce

| Plan | Precio | Moneda | Notas |
|---|---|---|---|
| Paquete de arranque (starter) | — | — | No hay tabla de planes ni precio. "starter" es el texto que bootstrap_tenant deja en tenant_platform_context.plan (informativo) y el paquete = ebim.starter_enti |

| Add-on | Tipo | Precio en la app (mes) | Unidad | Estado en la app | Código en el Admin Maestro |
|---|---|---|---|---|---|
| Asistente IA | IA | — | Tenant | Activo en la app | `ecommerce_ai_assist` |
| IA · textos de catálogo | IA | — | Tenant | Activo en la app | `ecommerce_ai_catalog_copy` |
| IA · contenido | IA | — | Tenant | Borrador en la app | `ecommerce_ai_content` |
| IA · insights | IA | — | Tenant | Activo en la app | `ecommerce_ai_insights` |
| Analítica avanzada | Add-on | — | Tenant | Activo en la app | `ecommerce_analytics_advanced` |
| Catálogo avanzado (PIM) | Módulo | — | Tenant | Activo en la app | `ecommerce_catalog_advanced` |
| CMS | Add-on | — | Tenant | Activo en la app | `ecommerce_content_cms` |
| Marca blanca | Add-on | — | Tenant | Activo en la app | `ecommerce_content_white_label` |
| Gestión de crédito | Módulo | — | Tenant | Activo en la app | `ecommerce_credit_management` |
| Clientes B2B | Módulo | — | Tenant | Activo en la app | `ecommerce_customers_b2b` |
| Entregas | Módulo | — | Tenant | Activo en la app | `ecommerce_fulfillment` |
| Ruteo de entregas | Add-on | — | Tenant | Activo en la app | `ecommerce_fulfillment_routing` |
| Integraciones enterprise | Conector | — | Tenant | Activo en la app | `ecommerce_integrations_enterprise` |
| Multi-almacén | Módulo | — | Tenant | Activo en la app | `ecommerce_inventory_multiwarehouse` |
| Facturación a clientes | Módulo | — | Tenant | Activo en la app | `ecommerce_invoicing` |
| Pedidos avanzados | Add-on | — | Tenant | Activo en la app | `ecommerce_orders_advanced` |
| Cobros | Módulo | — | Tenant | Activo en la app | `ecommerce_payments` |
| Planificación de demanda | Add-on | — | Tenant | Activo en la app | `ecommerce_planning_demand` |
| Listas de precios | Módulo | — | Tenant | Activo en la app | `ecommerce_pricing_lists` |
| Promociones | Add-on | — | Tenant | Activo en la app | `ecommerce_promotions` |
| Fuerza de ventas | Módulo | — | Tenant | Activo en la app | `ecommerce_sales_force` |
| Desempeño comercial | Add-on | — | Tenant | Activo en la app | `ecommerce_sales_performance` |
| Territorios de venta | Add-on | — | Tenant | Activo en la app | `ecommerce_sales_territory` |
| Surtidos B2B | Add-on | — | Tenant | Activo en la app | `ecommerce_trade_assortments` |
| Cotizaciones B2B | Add-on | — | Tenant | Activo en la app | `ecommerce_trade_quotes` |

## eExpense

| Plan | Precio | Moneda | Notas |
|---|---|---|---|
| Starter | 49 | USD | activo; columna public.plans.monthly_price (periodo mensual por nombre de columna y UI "US$/mes"); sin límites por plan en la tabla: max_users vive en tenants ( |
| Enterprise | 199 | USD | activo; columna public.plans.monthly_price (periodo mensual por nombre de columna y UI "US$/mes"); sin límites por plan en la tabla: max_users vive en tenants ( |
| Pro | 102 | USD | activo; columna public.plans.monthly_price (periodo mensual por nombre de columna y UI "US$/mes"); la seed del repo (20260626270000_billing.sql) dice 99, la nub |

| Add-on | Tipo | Precio en la app (mes) | Unidad | Estado en la app | Código en el Admin Maestro |
|---|---|---|---|---|---|
| Analítica conversacional | IA | 45 USD | Tenant | Activo en la app | `eexpense_ai_analytics` |
| Auditor IA | IA | 0 USD | Tenant | Activo en la app | `eexpense_ai_auditor` |
| Captura inteligente (OCR+IA) | IA | 0 USD | Tenant | Activo en la app | `eexpense_ai_capture` |
| Cierre contable asistido | IA | 35 USD | Tenant | Activo en la app | `eexpense_ai_close` |
| Copiloto de rendición | IA | 25 USD | Tenant | Activo en la app | `eexpense_ai_copilot` |
| SLA de aprobación | Add-on | 19 USD | Tenant | Activo en la app | `eexpense_approval_sla` |
| Presupuesto predictivo | IA | 39 USD | Tenant | Activo en la app | `eexpense_budget_predict` |
| Caja chica / Fondos fijos | Módulo | 25 USD | Tenant | Activo en la app | `eexpense_caja` |
| Conciliación de tarjeta | Módulo | 29 USD | Tenant | Activo en la app | `eexpense_card_reconcile` |
| SDK de personalización (addons del cliente) | Servicio | 79 USD | Tenant | Activo en la app | `eexpense_custom_sdk` |
| Anti-duplicados en tiempo real | Add-on | 19 USD | Tenant | Activo en la app | `eexpense_duplicate_guard` |
| Conexión Fiscal LatAm | Conector | 29 USD | Tenant | Activo en la app | `eexpense_fiscal_connection` |
| Detección de fraude con visión | IA | 49 USD | Tenant | Activo en la app | `eexpense_fraud_vision` |
| Consolidación multi-moneda | Add-on | 29 USD | Tenant | Activo en la app | `eexpense_fx_consolidation` |
| Liquidaciones de costos | Módulo | 35 USD | Tenant | Activo en la app | `eexpense_liquidaciones_sap` |
| Kilometraje / Movilidad | Módulo | 19 USD | Tenant | Activo en la app | `eexpense_mileage` |
| Motor de viáticos | Módulo | 25 USD | Tenant | Activo en la app | `eexpense_per_diem` |
| Política en lenguaje natural | IA | 29 USD | Tenant | Activo en la app | `eexpense_policy_nlp` |
| Integración SAP nativa | Conector | 99 USD | Tenant | Próximamente | `eexpense_sap_integration` |
| Score de proveedor | Add-on | 29 USD | Tenant | Activo en la app | `eexpense_supplier_score` |
| Gastos de viaje avanzados | Módulo | 39 USD | Tenant | Próximamente | `eexpense_travel_advanced` |
| Rendición por WhatsApp | Canal | 39 USD | Tenant | Activo en la app | `eexpense_whatsapp_bot` |
| Marca blanca (white-label) | Add-on | 49 USD | Tenant | Activo en la app | `eexpense_white_label` |
| CFO insights (núcleo) | IA | — | — | Activo en la app | `eexpense_cfo_insights` |

## GMAO

| Plan | Precio | Moneda | Notas |
|---|---|---|---|
| Free | 0 | USD | db:platform.plans (price_month_usd=0, is_active). max_assets=50, max_users=3, max_work_orders_month=100, allows_integrations=false; features {mobile:true, analy |
| Pro | 99 | USD | db:platform.plans price_month_usd=99 (flat per tenant/month, not per user). max_assets=1000, max_users=25, max_work_orders_month=5000, allows_integrations=true; |
| Enterprise | 499 | USD | db:platform.plans price_month_usd=499. Unlimited assets/users/WO (NULL); allows_integrations=true; features {mobile, analytics, sap_integration, sso, dedicated_ |
| Starter (ONE-PAGER-COMERCIAL) | 29 | USD | NOT in DB. docs/ONE-PAGER-COMERCIAL.md: '~US$29 /técnico/mes' (orientativo, per technician). IA: Triage + Analista; SAP/WhatsApp/IoT not included. |
| Pro (ONE-PAGER-COMERCIAL) | 59 | USD | NOT in DB. docs/ONE-PAGER-COMERCIAL.md: '~US$59 /técnico/mes' (orientativo, per technician). Full AI team; SAP/WhatsApp/IoT as add-on (contradicts DB pro which  |
| Enterprise (ONE-PAGER-COMERCIAL) | — | — | NOT in DB. 'A medida'. SAP/WhatsApp/IoT included; dedicated isolation + audit. |
| Starter (EBIM-PLATAFORMA-PACKAGING) | 149 | USD | NOT in DB. docs/EBIM-PLATAFORMA-PACKAGING.md §3 'Precio ejemplo (USD/mes) $149 (≤10 users)'; doc says figures are an example framework to calibrate. 1 sociedad, |
| Pro (EBIM-PLATAFORMA-PACKAGING) | 499 | USD | NOT in DB. Example price $499/mes; multi-sociedad, mobile, 3 AI agents, 1 ERP connector as add-on. Note $499 = DB 'enterprise' price, not DB 'pro' ($99). |
| Enterprise (EBIM-PLATAFORMA-PACKAGING) | — | — | NOT in DB. 'Cotización'. Bundles in same doc (EBIM Start / Operaciones / Enterprise) have no numeric price (~20% bundle discount stated). |
| Essentials / Autonomous / Enterprise-Suite (LandingPage) | — | — | NOT in DB. web/src/pages/LandingPage.tsx TIERS show 3 tiers with no prices ('Precio por activos y plantas'); names do not match DB codes free/pro/enterprise. |

| Add-on | Tipo | Precio en la app (mes) | Unidad | Estado en la app | Código en el Admin Maestro |
|---|---|---|---|---|---|
| IA de Campo | IA | — | Uso | Activo en la app | `gmao_ai_assist` |
| Log de Fallas | Add-on | — | Tenant | Borrador en la app | `gmao_failure_log` |
| Aprobación de OT | Add-on | — | Tenant | Borrador en la app | `gmao_wo_approvals` |
| Acceso por planta | Add-on | — | Tenant | Borrador en la app | `gmao_access_by_plant` |
| Rondas de Inspección | Add-on | — | Tenant | Borrador en la app | `gmao_inspections` |
| Canal WhatsApp | Canal | — | Tenant | Activo en la app | `gmao_whatsapp` |
| Conector SAP PM | Conector | — | Tenant | Borrador en la app | `gmao_sap_pm` |
| Copiloto por Voz | IA | — | Tenant | Borrador en la app | `gmao_voice_copilot` |
| Analítica Avanzada | Add-on | — | Tenant | Próximamente | `gmao_advanced_reports` |
| IoT & Mantenimiento Predictivo | IA | — | Tenant | Próximamente | `gmao_iot_predictive` |
| Reportes de Seguridad | Add-on | — | Tenant | Borrador en la app | `gmao_safety` |
