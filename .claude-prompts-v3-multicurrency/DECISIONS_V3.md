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
