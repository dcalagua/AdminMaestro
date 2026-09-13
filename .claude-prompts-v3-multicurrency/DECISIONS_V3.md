# DECISIONS V3

Registrar aqui solo decisiones arquitectonicas no obvias tomadas durante la ejecucion.

Decision base aprobada:
- Cada operacion conserva su moneda original.
- Reporting currency es separada y configurable, inicialmente USD.
- FX se usa para reporting, no para reescribir documentos.
- MasterAdmin no se convierte en ERP fiscal.
- APIs SaaS/provisioning quedan fuera de V3.

---

## DV3-001 · `currencies` con clave ISO; `markets` con uuid (fase 02)

`currencies.code char(3)` es la PK. Las 16 columnas `currency char(3)` del baseline ya guardan
el código ISO, así que la FK se añade sin reescribir datos ni cambiar tipos, y los tipos TS y
PostgREST no cambian. `markets` usa `id uuid` + `code` único (convención C-02): el código de
mercado es identificador de negocio y podría no coincidir con el país (un mercado regional).

## DV3-002 · Backfill explícito de monedas desconocidas como INACTIVE (fase 02)

Antes de crear las FKs, la migración 24 registra como `INACTIVE` cualquier código presente en
datos y ausente del catálogo. No se reescribe ningún importe ni moneda. Una moneda INACTIVE
sostiene la historia (p. ej. COP/CLP de sociedades de Colombia y Chile del seed) pero no
admite ventas nuevas. En local el seed da de alta COP/CLP como INACTIVE por el mismo criterio.

## DV3-003 · Moneda por defecto del mercado validada con constraint trigger diferido (fase 02)

`markets.default_currency_code` debe estar en `market_currencies` ACTIVE. Se valida al COMMIT
(constraint trigger `deferrable initially deferred`) porque dar de alta un mercado exige dos
inserts y el invariante está roto entre ambos. Se descartó la FK compuesta circular: no expresa
el estado ACTIVE.

## DV3-004 · Autoridad del catálogo regional = `can_read_finance()` (fase 02)

Monedas, mercados, tipos de cambio y moneda de reporte son catálogo financiero:
`can_manage_regional_catalog()` = EBIM_FINANCE o EBIM_SUPER_ADMIN. EBIM_PRODUCT_ADMIN conserva
la tarifa (`set_plan_price`), como en V2. Lectura del catálogo: cualquier autenticado.

## DV3-005 · EBIM regional = 1 organización PLATFORM + 3 sociedades (fase 03)

No se crean tres organizaciones EBIM: `organizations_single_platform_uk` y la gobernanza del
super admin único dependen de que haya una. `companies.market_id` (nullable) ancla cada sociedad
a su mercado. Si no se indica y el país tiene un único mercado activo, el guard lo asigna; si hay
cero o varios, queda NULL («fuera del modelo regional») en vez de inventarse. Las sociedades EBIM
se siembran en `seed.sql` (sus datos fiscales no son catálogo universal); en QAS/PRD se crean con
`upsert_company(p_market_code => 'BO', ...)`.

## DV3-006 · Tarifas legacy sin mercado: se conservan y nunca se usan para vender (fase 04)

`plan_prices.market_id` es nullable solo para historia previa a V3. Backfill: la tarifa cuya
moneda la admite un único mercado activo recibe ese mercado (PEN→PE, BOB→BO); una tarifa USD
(admitida por PE, BO y EC) queda NULL, porque asignarla a un país sería inventar. Una tarifa
NULL se lista como «Sin mercado» y `current_plan_price()` —que exige mercado— nunca la devuelve.
Toda tarifa nueva exige mercado (trigger `MERCADO_REQUERIDO`). Se eliminó la firma V2 sin
mercado de `current_plan_price` y de `set_plan_price`: mantenerlas era mantener el accidente.
Una tarifa es inmutable salvo su `valid_to` (`PRECIO_HISTORICO_INMUTABLE`) y las vigencias de
una misma combinación no se solapan (exclusión GiST con `btree_gist`, cierra G-05).

## DV3-007 · `subscriptions.market_id`: el contrato recuerda dónde se vendió (fase 04)

La tarifa se resuelve en un mercado; sin guardarlo, el dashboard regional tendría que adivinar
el país por la organización. Misma regla que DV3-005: sin mercado explícito, el trigger lo
asigna si el país de quien paga tiene un único mercado activo que admite la moneda; si no, NULL
(p. ej. los contratos de Reseller Pacífico, Chile). Inmutable una vez fijado
(`MERCADO_INMUTABLE`). Las RPCs `create_subscription` y `onboard_customer_subscription` exigen
mercado explícito (`p_market_code`); la moneda es la indicada si el mercado la admite o la
sugerida por el mercado. Sin tarifa regional vigente no se crea contrato
(`TARIFA_REGIONAL_NO_DEFINIDA`), y el importe negociado (`p_license_amount`) solo se acepta
sobre una tarifa existente: V2 creaba la venta con un importe tecleado sin tarifa (G-07).

## DV3-008 · `current_plan_price` SECURITY INVOKER y autorización temprana del onboarding (fase 04)

G-33: la RPC de tarifa era SECURITY DEFINER y exponía precios que `plan_prices_select` oculta.
Pasa a SECURITY INVOKER: un partner recibe NULL para un plan que no contrata; llamada desde el
onboarding (DEFINER) conserva los permisos de la RPC que ya autorizó. El onboarding autoriza
en su primera línea (plataforma o finanzas EBIM, lo que la navegación ya documentaba) para no
revelar por el texto del error si existe una tarifa regional.

## DV3-009 · Cadena de moneda por trigger: heredar si falta, rechazar si difiere (fase 06)

La moneda la fija el contrato y baja: suscripción → líneas / perfil de cobro / documentos /
facturas; factura → líneas / cobros; cobro → eventos de comisión. Un único trigger
(`enforce_currency_chain`) es el punto de enforcement para INSERT directo, service_role, Edge
Functions y RPCs: por eso G-15 (`upsert_subscription_item`, `set_subscription_collection_profile`,
`request_commercial_document` con moneda explícita distinta) se cierra sin reescribir esas RPCs.
Se retiran los `default 'USD'` de todas las columnas `currency` de documentos: los hijos heredan
del padre y las raíces exigen moneda explícita por NOT NULL. `payment_provider_accounts` queda
fuera: es configuración y su país/moneda se rediseñan con el routing (fase 07). La moneda de un
padre con historia es inmutable (`MONEDA_CONTRACTUAL_INMUTABLE`, `MONEDA_DOCUMENTO_INMUTABLE`);
un borrador sin hijos sí puede corregirla. No se reescriben filas previas: las incoherencias
históricas se listan en `v_currency_integrity_issues` (vacía en el seed). `cost_entries` no
pertenece a la cadena: un costo USD sobre un ingreso PEN es legítimo; sumarlo no (fase 10).

## DV3-010 · Routing de cobro en servidor: mercado + monedas por cuenta + métodos por proveedor (fase 07)

Una cuenta de cobro pertenece a un mercado (`payment_provider_accounts.market_id`) y declara las
monedas que cobra (`payment_provider_account_currencies`; la principal siempre incluida). Qué
métodos soporta cada tipo de proveedor vive en una sola función (`provider_kind_supports_method`:
CULQI = tarjeta; BANK = transferencia; MANUAL = manual, transferencia, OS y OC; OTHER = nada).
`provider_account_candidates()` (SECURITY INVOKER) evalúa cada cuenta contra una suscripción y
dice por qué no sirve; `route_rank = 1` es la ruta: la cuenta propia de quien paga, luego
`routing_priority`, luego código. `set_subscription_collection_profile` recibe `p_route_provider`
AL FINAL (compatibilidad posicional V2): con `true` el servidor elige y una cuenta enviada por el
cliente se rechaza (`CUENTA_PROVEEDOR_NO_COINCIDE`); sin cuenta elegible,
`PROVEEDOR_NO_DISPONIBLE_EN_MERCADO` (Culqi no es universal). Sin `p_route_provider` sigue el
modo V2, pero la cuenta explícita pasa por el mismo guard de elegibilidad. La UI ya no tiene
selector de cuenta. Backfill explícito: `culqi-pe-test` cobra también USD (evidencia V2.1) y
`ebim-manual` también PEN. Se retiran los defaults PE/PEN de columnas y RPC; el webhook exige
`?account=`. El guard del perfil solo re-evalúa cuando cambian cuenta, método o suscripción:
cerrar un perfil histórico no vuelve a juzgar una cuenta que era válida entonces.

## DV3-011 · Defecto V2 corregido: `upsert_payment_provider_account` nunca completaba (fase 07)

Su auditoría escribía la clave `has_secret_ref`, y el guard `reject_secret_like_json` de
`audit_logs` rechaza toda clave que contenga «secret» (42501 `METADATA_CON_SECRETO`). Ningún test
V2 lo cubría: solo probaban el rechazo por autorización. La versión V3 audita
`server_credential_configured`. Los fixtures de `03_v2_security` declaran ahora país y moneda en
sus INSERT directos de cuentas (sin default ya no nacen PE/PEN); cada prueba sigue fallando por
su motivo original (el secreto).

## DV3-012 · FX: directa primero, recíproca documentada, sin triangulación, ventana explícita (fase 08)

`exchange_rates` guarda `1 base = rate quote` con fuente MANUAL (enum ampliable a BCRP/BCB/BCE
en otra fase). Una tasa no se edita: republicar la misma fecha la deja `SUPERSEDED` (con
`superseded_by`) y anular exige motivo (`VOIDED`); una sola ACTIVE por fecha/par/fuente.
`fx_rate_lookup` resuelve en este orden: IDENTITY → DIRECT (la ACTIVE más reciente con
`rate_date ∈ [as_of − max_age, as_of]`) → RECIPROCAL (`1/inversa`, misma ventana) → MISSING.
Nunca usa tasas futuras ni triangula por una tercera moneda. `p_max_age_days` vale 0 por
defecto (solo la fecha exacta): la tolerancia la declara quien consulta (la moneda de reporte la
toma de su setting, fase 09). `fx_convert` redondea a los decimales ISO destino y con MISSING
devuelve NULL, nunca 0. Las funciones son SECURITY INVOKER: quien no puede leer tasas (partner,
tenant) obtiene MISSING, no una conversión. Lectura de tasas: plataforma o finanzas; escritura:
`can_manage_regional_catalog()` (EBIM_FINANCE / super admin).

## DV3-013 · Moneda de reporte = fila de configuración; contrato de respuesta nativo/reporte (fase 09)

`control_plane_settings` es un singleton (`id boolean` con CHECK) con `reporting_currency_code`
(FK a monedas) y `fx_max_rate_age_days`. El USD inicial se siembra como FILA de configuración en
la migración (debe existir en QAS/PRD igual que el catálogo de mercados); ninguna función lo
asume: todas leen `reporting_settings()` y, si la fila falta, responden
`NO_REPORTING_CURRENCY`. Tolerancia inicial 31 días, pensada para una tasa gerencial MANUAL
mensual; la fecha de la tasa usada se devuelve siempre. `to_reporting_amount` es el contrato de
todo reporting: `native_amount/native_currency` intactos, `reporting_amount/reporting_currency`
(NULL si falta tasa) y `conversion_status` ∈ {SAME_CURRENCY, CONVERTED, MISSING_FX,
NO_REPORTING_CURRENCY} con la tasa, método, fecha e `is_demo`. Cambiarla exige
`can_manage_regional_catalog()`. UI: página «Monedas y FX» (persona EBIM) con selector entre
monedas activas, editable solo por finanzas / super admin.

## DV3-014 · Nativo corregido sin cambiar columnas; consolidado = sumar por moneda y luego convertir (fase 10)

Las vistas nativas del baseline conservan columnas y tipos (`create or replace`), pero las de
margen pasan a una fila por (entidad, moneda): las claves son la unión de ingresos, costos,
comisiones y MRR, así un costo USD de un producto que solo cobra PEN ya no desaparece (R-3). Una
entidad sin actividad conserva una fila con moneda NULL y ceros (antes «USD»). `channel_mrr`
vale NULL cuando el canal factura en varias monedas y el detalle va en la nueva columna final
`channel_mrr_by_currency` (R-2). En `dashboard_summary`, `commission_pending/paid` son NULL con
varias monedas y se añaden los mapas `*_by_currency` (R-1). `v_tenant_overview` toma la moneda
del MRR o del contrato, nunca `USD` por defecto, y añade `market_code` al final (G-32).
El consolidado se apoya en `v_finance_facts` (hechos nativos con producto, mercado, organización,
canal y fecha) y en `finance_reporting_rows`, que suma DENTRO de cada moneda y convierte cada
total con `to_reporting_amount` a la fecha `p_as_of` (tasa de cierre del reporte, tolerancia
configurada). `finance_consolidated` agrega por grupo (TOTAL/MARKET/PRODUCT/PARTNER): una
métrica consolidada es NULL si falta cualquier conversión, el margen consolidado solo existe si
COLLECTED, COST y COMMISSION están completos, y `completeness.missing_fx_count` lo expone. El
periodo filtra cobros, costos y comisiones; el MRR es foto a hoy.

## DV3-015 · Comisiones: porcentaje agnóstico de moneda; importes fijos y topes solo en la moneda de la regla (fase 11)

Un evento de comisión está en la moneda de su cobro (guard de la fase 06) y el porcentaje se
aplica sobre el importe original cobrado. `commission_rules.currency` pasa a significar «moneda
de `fixed_amount` y `max_total_amount`», obligatoria en `upsert_commission_rule` y término
económico inmutable si la regla ya devengó. Una regla FIXED_AMOUNT o con tope NO devenga sobre un
cobro en otra moneda: comparar el tope exigiría un tipo de cambio y el FX no toca documentos (se
prefiere no pagar a pagar un importe mal expresado; la solución es una regla por moneda). El tope
suma solo eventos en la moneda de la regla. `settle_commissions` exige moneda (sin
`default 'USD'`), genera el código `STL-<agente>-<YYYYMM>-<MON>` —liquidar BOB y PEN el mismo mes
ya no reutiliza la misma liquidación (R-4)— y no añade eventos a una liquidación APPROVED/PAID
(V2 la reabría vía `on conflict`). Un trigger impide que un evento quede en una liquidación de
otra moneda (`LIQUIDACION_MULTIMONEDA`) y la moneda de una liquidación con eventos es inmutable.
Los reversos conservan la moneda y netean dentro de ella. Las liquidaciones históricas conservan
su código sin moneda.

## DV3-016 · UI: código ISO siempre, totales por moneda, catálogo en vez de texto libre (fase 12)

`formatMoney(amount, currency)` ya no tiene moneda por defecto y usa `currencyDisplay: 'code'`
(`PEN 1,250.00`): es-PE pintaba PEN como «S/» pero USD como «USD», y «$» es ambiguo. Sin moneda,
un 0 es «—» y cualquier otro importe se rotula «(sin moneda)». El símbolo solo aparece como ayuda
(`Money` + `currencySymbolHint`) cuando ninguna otra moneda del catálogo lo comparte. Todo total
de cabecera usa `sumByCurrency` + `formatCurrencyMap` (R-7); el «margen sobre cobrado» solo se
calcula con una moneda. Las vistas de detalle muestran un bloque por moneda. El último textbox de
moneda (regla de comisión) pasa a selector de monedas activas. «Monedas y FX» agrupa moneda de
reporte, tipos de cambio (publicar, anular con motivo, probar conversión con `fx_convert`),
tarifas por mercado (vigentes/programadas/historial/legacy, versionar) y mercados con rutas de
cobro. El país de una organización sigue siendo texto: no existe catálogo de países y organizaciones
fuera de PE/BO/EC son legítimas.

## DV3-017 · Dashboard regional: filtros analíticos y cifras incompletas explícitas (fase 13)

El dashboard EBIM añade «Finanzas regionales» con modo NATIVO (mapas por moneda, margen por
moneda) y CONSOLIDADO (moneda de reporte, fecha de las tasas y su tolerancia, tasas usadas con
método y marca DEMO). Filtros de mercado, moneda, producto y organización/partner: la regla U-06
(«un buscador por listado, sin paneles multi-campo») rige LISTADOS; aquí los filtros acotan el
cálculo de la base (`finance_consolidated`), que suma por moneda y convierte en el servidor, y no
filtran filas ya sumadas en el navegador. En consolidado una métrica con cualquier conversión
faltante se muestra «Incompleto» (con la moneda que falta y el nativo como ayuda), el margen
«No calculable», cada mercado afectado lleva «FX faltante» y hay un aviso `role=alert`: una cifra
parcial nunca se presenta como total. La presentación vive en `src/lib/consolidated.ts` (pura,
probada). Defecto corregido de paso: `formatDate('YYYY-MM-DD')` pintaba el día anterior en UTC−5
porque `new Date()` interpreta la fecha sin hora como medianoche UTC; ahora se construye en hora
local (afectaba a toda fecha de calendario de la consola, incluida la fecha de las tasas).

## DV3-018 · Seed regional: escenarios verificados, FX DEMO con fecha fija (fase 14)

La sección `SEED V3` añade cuatro clientes regionales, tarifas por mercado, contratos con mercado
explícito, facturas y cobros en la moneda de cada contrato, costos USD sobre ingresos locales,
comisiones PEN/BOB/USD y cuentas bancarias DEMO de Bolivia y Ecuador. Un bloque final verifica
mercados, monedas contractuales y de comisión, tasas DEMO, integridad de la cadena de moneda y
PE/USD ≠ EC/USD: si algo falta, `db reset` falla. Las tasas DEMO usan fecha fija (2026-09-01) y
valores redondos (3.50 PEN, 7.00 BOB por USD) deliberadamente irreales, `is_demo = true`; con
tolerancia de 31 días el consolidado por defecto se volverá «incompleto» pasado octubre de 2026,
que es el comportamiento correcto: los E2E fijan la fecha de las tasas. El plan Demo no recibe
tarifa en BO para mantener un caso determinista «sin tarifa regional». Tres tests (08, 13 y dos
E2E de R5) se ajustaron porque dependían de que el seed fuese solo USD; ahora comprueban el
comportamiento multimoneda sin depender de totales absolutos del seed.

## DV3-019 · Grants mínimos: funciones de trigger sin EXECUTE y devengo solo por trigger (fase 16)

La reauditoría encontró `generate_commission_events` ejecutable por `authenticated` (H-1), funciones
de trigger con EXECUTE para `authenticated` (H-2) y dos funciones de trigger del baseline para
PUBLIC (H-3). La migración 33 retira esos privilegios sin tocar migraciones previas. Se comprobó
en la base local que PostgreSQL no exige EXECUTE para disparar un trigger (rol sin privilegio →
el trigger modifica la fila igual), así que el cambio no altera ningún flujo. Las lecturas de
tarifa, FX, routing y reporting son SECURITY INVOKER a propósito: la autorización de datos la da
RLS del llamante; las escrituras son SECURITY DEFINER con autorización explícita en la primera
línea. Detalle en `docs/security/V3_MULTICURRENCY_SECURITY_AUDIT.md`.

## DV3-020 · Emisión de factura gerencial del periodo para cerrar el journey venta → cobro (fase 17)

Los journeys exigen «subscription → invoice → payment manual → commission», pero antes de V3 las
facturas solo nacían del seed o del webhook del proveedor y `confirm_manual_payment` no tenía
pantalla. Se añade `issue_subscription_invoice(subscription, periodo)` (EBIM_FINANCE / super
admin): factura de CONTROL GERENCIAL del mes, en la moneda del contrato (heredada por la cadena de
moneda), con las líneas recurrentes vigentes y los cargos únicos aún no facturados, idempotente
por (suscripción, periodo) y sin facturas vacías. No es un comprobante fiscal (MasterAdmin no es
ERP). En el detalle de suscripción: «Emitir factura del mes (MON)» y «Registrar cobro», cuyo
diálogo muestra la moneda de la factura deshabilitada: no se elige. El alta de cliente la hace el
super admin en los E2E porque `create_tenant` exige rol de plataforma (EBIM_FINANCE no crea
tenants), comportamiento V2 que no se cambia.

## DV3-021 · Auditoría final: país obligatorio en organizaciones y sin par FX preseleccionado (fase 98)

La búsqueda de defaults regionales encontró `organizations.country_code default 'PE'` y
`upsert_organization(p_country_code default 'PE')` (baseline/V2). No es un importe, pero en V3 el
país sugiere el mercado y la moneda de cada venta: una organización boliviana creada sin país nacía
peruana. La migración 35 retira el default de la columna, recrea la RPC con `p_country_code default
null` y exige un ISO de dos letras (`PAIS_REQUERIDO`); el formulario deja de proponer «PE». También se
retira la base `USD` preseleccionada al publicar un tipo de cambio. Se clasificó como válido el
probador de conversión con PEN→USD (solo lectura). Todo `SUM(` vigente se revisó: ninguno cruza monedas.
