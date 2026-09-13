# 98 - Auditoria Final V3

## Contexto fijo

PROJECT_ROOT: `/Users/edudavidmorenoccama/Documents/Documentos-Edus-MacBook-Pro-2/EBIM/masteradmin`
GUIDELINES_ROOT: `/Users/edudavidmorenoccama/Library/CloudStorage/GoogleDrive-gep.soporteit@gmail.com/My Drive/EBIM-Plataforma` (READ ONLY)

Baseline esperado: 23 migraciones existentes. No editarlas. Toda migracion nueva debe ser 24+.
No hacer push ni cambios remotos. No implementar APIs hacia los SaaS de la suite en esta V3.


Antes de declarar GO:

1. `git diff` completo contra HEAD inicial si esta disponible.
2. Verifica que las 23 migraciones baseline NO cambiaron.
3. Lista migraciones V3 nuevas y su responsabilidad.
4. Busca todos los defaults `USD`/`PEN` en DB y TS y clasifica si son validos o peligrosos.
5. Busca `SUM(` sobre money fields y confirma grouping/conversion por currency.
6. Audita SECURITY DEFINER/search_path/grants de RPC nuevas.
7. Audita views por security_invoker.
8. Ejecuta secrets scan.
9. Confirma que no hay cambios QAS/PRD ni push remoto.
10. Confirma que provisioning SaaS/API sigue fuera de alcance.

Ejecuta gates frescos:
- npm run db:reset
- npm run db:test
- npm test
- npm run typecheck
- npm run lint
- npm run build
- npm run secrets:scan
- npm run e2e

No declares PASS si alguno no se ejecuto.
