# 06 - Hardening de Moneda Transaccional

## Contexto fijo

PROJECT_ROOT: `/Users/edudavidmorenoccama/Documents/Documentos-Edus-MacBook-Pro-2/EBIM/masteradmin`
GUIDELINES_ROOT: `/Users/edudavidmorenoccama/Library/CloudStorage/GoogleDrive-gep.soporteit@gmail.com/My Drive/EBIM-Plataforma` (READ ONLY)

Baseline esperado: 23 migraciones existentes. No editarlas. Toda migracion nueva debe ser 24+.
No hacer push ni cambios remotos. No implementar APIs hacia los SaaS de la suite en esta V3.


Asegura coherencia de moneda en toda la cadena comercial.

Reglas:
- subscription currency define moneda contractual;
- subscription_items deben coincidir;
- invoice e invoice_lines deben coincidir;
- payment debe coincidir con invoice/subscription salvo que exista un futuro flujo FX explicito (NO implementarlo ahora);
- provider payment debe validar currency;
- cost entries pueden estar en otra moneda pero nunca sumarse sin conversion de reporting;
- commission event usa moneda del pago/base correspondiente;

Elimina defaults `USD` peligrosos en RPCs cuando el contexto ya conoce la moneda.
No cambies historicos silenciosamente.

Agregar pgTAP para mismatches y regression tests sobre billing/Culqi.
