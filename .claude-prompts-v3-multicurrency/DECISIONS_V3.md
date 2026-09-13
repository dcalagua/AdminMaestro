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
