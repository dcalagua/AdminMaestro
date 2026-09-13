# 02 - Catalogo de Monedas y Mercados

## Contexto fijo

PROJECT_ROOT: `/Users/edudavidmorenoccama/Documents/Documentos-Edus-MacBook-Pro-2/EBIM/masteradmin`
GUIDELINES_ROOT: `/Users/edudavidmorenoccama/Library/CloudStorage/GoogleDrive-gep.soporteit@gmail.com/My Drive/EBIM-Plataforma` (READ ONLY)

Baseline esperado: 23 migraciones existentes. No editarlas. Toda migracion nueva debe ser 24+.
No hacer push ni cambios remotos. No implementar APIs hacia los SaaS de la suite en esta V3.


Implementa un catalogo normalizado y administrable.

Objetivo minimo:
- `platform.currencies`
- `platform.markets`
- `platform.market_currencies`

Seeds iniciales:
- PEN / Sol peruano / 2 decimales
- BOB / Boliviano / 2 decimales
- USD / Dolar estadounidense / 2 decimales

Mercados:
- PE / Peru / default PEN
- BO / Bolivia / default BOB
- EC / Ecuador / default USD

Monedas permitidas:
- PE: PEN default, USD
- BO: BOB default, USD
- EC: USD default

No asumas que country == currency.

Agregar constraints, indices, comments, updated_at si corresponde al patron existente.
Aplicar RLS y RPC admin siguiendo convenciones actuales.
Solo EBIM roles autorizados pueden mantener estos catalogos.
Lectura puede ser mas amplia si la UI lo requiere.

Agregar pgTAP de constraints, defaults, grants y RLS.
