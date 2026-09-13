# 03 - Empresas Regionales EBIM

## Contexto fijo

PROJECT_ROOT: `/Users/edudavidmorenoccama/Documents/Documentos-Edus-MacBook-Pro-2/EBIM/masteradmin`
GUIDELINES_ROOT: `/Users/edudavidmorenoccama/Library/CloudStorage/GoogleDrive-gep.soporteit@gmail.com/My Drive/EBIM-Plataforma` (READ ONLY)

Baseline esperado: 23 migraciones existentes. No editarlas. Toda migracion nueva debe ser 24+.
No hacer push ni cambios remotos. No implementar APIs hacia los SaaS de la suite en esta V3.


Extiende la configuracion existente para representar bajo la misma organization EBIM:
- EBIM Peru: PE / PEN
- EBIM Bolivia: BO / BOB
- EBIM Ecuador: EC / USD

No crear tres organizaciones EBIM separadas si el modelo `companies` actual permite una organization con multiples empresas.

Asegura que Company use market/country/default currency de forma coherente.
No rompas empresas existentes.

Actualizar seeds y UI administrativa solo donde sea necesario.
Agregar tests que prueben company PE/PEN, BO/BOB, EC/USD y PE/USD permitido cuando aplique.
