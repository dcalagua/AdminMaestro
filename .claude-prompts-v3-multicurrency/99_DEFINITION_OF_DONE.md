# 99 - Definition of Done V3 Multicurrency

## Contexto fijo

PROJECT_ROOT: `/Users/edudavidmorenoccama/Documents/Documentos-Edus-MacBook-Pro-2/EBIM/masteradmin`
GUIDELINES_ROOT: `/Users/edudavidmorenoccama/Library/CloudStorage/GoogleDrive-gep.soporteit@gmail.com/My Drive/EBIM-Plataforma` (READ ONLY)

Baseline esperado: 23 migraciones existentes. No editarlas. Toda migracion nueva debe ser 24+.
No hacer push ni cambios remotos. No implementar APIs hacia los SaaS de la suite en esta V3.


V3 esta DONE solo si:

- [ ] 23 migraciones baseline intactas.
- [ ] catalogo currencies implementado.
- [ ] markets PE/BO/EC implementados.
- [ ] PE: PEN default + USD permitido.
- [ ] BO: BOB default + USD permitido.
- [ ] EC: USD default.
- [ ] EBIM Peru/Bolivia/Ecuador representables como companies.
- [ ] pricing distingue market incluso con misma currency.
- [ ] onboarding usa market + allowed currency + regional price.
- [ ] subscription/items/invoice/payment protegen moneda contractual.
- [ ] payment routing valida market/currency.
- [ ] FX engine auditable existe.
- [ ] FX source inicial MANUAL.
- [ ] reporting currency configurable existe.
- [ ] native amounts nunca se reescriben.
- [ ] dashboards no suman monedas diferentes sin FX.
- [ ] consolidated reporting expone FX faltante.
- [ ] commissions conservan currency original.
- [ ] settlements son mono-moneda.
- [ ] UI usa selectores controlados de market/currency.
- [ ] seeds regionales PE/BO/EC existen.
- [ ] RLS/grants/SECURITY DEFINER auditados.
- [ ] pgTAP PASS.
- [ ] unit PASS.
- [ ] E2E regional PASS sin skips locales.
- [ ] typecheck PASS.
- [ ] lint PASS.
- [ ] build PASS.
- [ ] secrets scan PASS.
- [ ] no push ni cambios remotos.
- [ ] no APIs de SaaS/provisioning implementadas en esta V3.
- [ ] docs V3 actualizadas.
- [ ] `docs/nightly-v3/FINAL_REPORT_V3_MULTICURRENCY.md` creado con evidencia.

Veredicto permitido:
- GO_LOCAL / GO_QAS_CANDIDATE si todos los gates locales pasan;
- PARTIAL si existen gaps no bloqueantes documentados;
- NO_GO si falla seguridad, integridad monetaria, migraciones o tests criticos.
