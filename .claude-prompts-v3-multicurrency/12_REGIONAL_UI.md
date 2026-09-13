# 12 - UI Regional

## Contexto fijo

PROJECT_ROOT: `/Users/edudavidmorenoccama/Documents/Documentos-Edus-MacBook-Pro-2/EBIM/masteradmin`
GUIDELINES_ROOT: `/Users/edudavidmorenoccama/Library/CloudStorage/GoogleDrive-gep.soporteit@gmail.com/My Drive/EBIM-Plataforma` (READ ONLY)

Baseline esperado: 23 migraciones existentes. No editarlas. Toda migracion nueva debe ser 24+.
No hacer push ni cambios remotos. No implementar APIs hacia los SaaS de la suite en esta V3.


Actualiza UI sin rediseño innecesario.

Agregar/reutilizar componentes para:
- Country/Market selector
- Currency selector basado en market
- Money display con ISO code y symbol cuando sea seguro
- Reporting currency selector para EBIM admin
- Regional price editor
- FX rates admin

Eliminar input libre de currency donde el dominio tenga catalogo.
Mantener accesibilidad y patrones visuales actuales.

No ocultar currency en ningun amount financiero.
Ejemplo correcto: `PEN 1,250.00`, `BOB 890.00`, `USD 250.00`.
