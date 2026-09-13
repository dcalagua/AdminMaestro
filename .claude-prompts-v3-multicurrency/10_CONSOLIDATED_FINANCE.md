# 10 - Finanzas Consolidadas

## Contexto fijo

PROJECT_ROOT: `/Users/edudavidmorenoccama/Documents/Documentos-Edus-MacBook-Pro-2/EBIM/masteradmin`
GUIDELINES_ROOT: `/Users/edudavidmorenoccama/Library/CloudStorage/GoogleDrive-gep.soporteit@gmail.com/My Drive/EBIM-Plataforma` (READ ONLY)

Baseline esperado: 23 migraciones existentes. No editarlas. Toda migracion nueva debe ser 24+.
No hacer push ni cambios remotos. No implementar APIs hacia los SaaS de la suite en esta V3.


Extiende las vistas/dashboard financieros sin romper las vistas nativas actuales.

Objetivo:
- MRR/ARR native por currency;
- collected native por currency;
- costs native por currency;
- commissions native por currency;
- consolidated reporting equivalents usando FX explicito;
- margen consolidado solo cuando todas las conversiones requeridas existen.

Nunca hacer `SUM()` de importes de currencies distintas antes de conversion.

Vistas objetivo pueden incluir versiones `_reporting` o columnas explicitas; sigue patrones existentes.

Expose conversion completeness/missing FX count para evitar dashboards engañosos.

Tests con PEN, BOB, USD y un FX faltante.
