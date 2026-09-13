# MASTER PROMPT CLI - EBIM Control Plane V3 Multicurrency

Trabaja sobre el proyecto existente en:

PROJECT_ROOT:
/Users/edudavidmorenoccama/Documents/Documentos-Edus-MacBook-Pro-2/EBIM/masteradmin

GUIDELINES_ROOT:
/Users/edudavidmorenoccama/Library/CloudStorage/GoogleDrive-gep.soporteit@gmail.com/My Drive/EBIM-Plataforma

GUIDELINES_ROOT es READ ONLY. PROJECT_ROOT es la unica raiz modificable.

Tu mision es ejecutar la V3 Multicurrency completa del EBIM Control Plane actual.

## Reglas absolutas

- NO re-bootstrappear el proyecto.
- NO modificar las 23 migraciones existentes.
- Toda DB change debe ser migracion 24+.
- NO hacer git push.
- NO hacer supabase db push.
- NO hacer supabase link.
- NO tocar QAS ni PRD.
- NO usar credenciales LIVE.
- NO implementar aun APIs hacia eSupplier, WMS, TMS, GMAO o eChange.
- NO convertir MasterAdmin en ERP fiscal.
- NO sumar monedas distintas directamente.
- NO reescribir importes historicos.
- Mantener Culqi y pagos existentes funcionales.
- Mantener provisioning en DRY_RUN.
- Hacer commits locales pequenos y trazables si Git esta disponible.

## Arquitectura objetivo

Cada operacion conserva su moneda transaccional original.

Ejemplos:
- Peru: PEN o USD
- Bolivia: BOB o USD
- Ecuador: USD

La plataforma agrega una moneda de reporte configurable, inicialmente USD, solo para reporting gerencial.

Factura PEN 5000 sigue siendo PEN 5000 para siempre.
El dashboard puede mostrar adicionalmente un equivalente de reporting usando un FX rate auditable.

## Ejecucion por fases

Lee y ejecuta EN ORDEN los siguientes archivos:

01_MULTICURRENCY_BASELINE.md
02_CURRENCIES_MARKETS.md
03_EBIM_REGIONAL_COMPANIES.md
04_REGIONAL_PRICING.md
05_REGIONAL_ONBOARDING.md
06_TRANSACTION_CURRENCY_HARDENING.md
07_REGIONAL_PAYMENT_ROUTING.md
08_FX_ENGINE.md
09_REPORTING_CURRENCY.md
10_CONSOLIDATED_FINANCE.md
11_MULTICURRENCY_COMMISSIONS.md
12_REGIONAL_UI.md
13_REGIONAL_DASHBOARD.md
14_REGIONAL_SEEDS.md
15_DOMAIN_TESTS.md
16_SECURITY_RLS.md
17_E2E_REGIONAL.md
18_DOCUMENTATION.md
98_FINAL_AUDIT.md
99_DEFINITION_OF_DONE.md

Despues de cada fase:
- actualiza STATE_V3.md;
- actualiza QUALITY_GATE_V3.md;
- documenta decisiones no triviales en DECISIONS_V3.md;
- ejecuta los tests especificos de la fase;
- no avances si introduces un FAIL nuevo.

Si la sesion pierde contexto, lee 90_RECOVERY_CONTEXT.md y continua desde la primera fase no completada.

## Criterio de salida

Deja `docs/nightly-v3/FINAL_REPORT_V3_MULTICURRENCY.md` con evidencia real.

No declares PASS por inferencia ni por reportes previos. Cada gate final debe ejecutarse de nuevo.
