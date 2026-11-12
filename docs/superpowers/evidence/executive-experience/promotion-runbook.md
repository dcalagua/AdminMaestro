# Runbook de promoción (NO ejecutado en esta corrida)

Esta corrida autorizó sólo trabajo LOCAL. Nada de lo siguiente se ejecutó: ni push, ni PR, ni
merge, ni deploy, ni SQL remoto. Cada paso requiere autorización humana explícita.

## 1. Cambios de backend (sólo lectura, aditivos)

Una sola migración nueva: `supabase/migrations/20260925100000_executive_read_models.sql`.

| Objeto | Tipo | Seguridad |
|---|---|---|
| `v_invoice_balances`, `v_collected_payments`, `v_renewal_pipeline`, `v_cost_entry_list` | vistas | `security_invoker = true`; `SELECT` para authenticated/service_role; nada para anon |
| `invoice_summary`, `receivables_aging`, `collections_by_month`, `cost_summary`, `commission_summary` | funciones SQL `STABLE` | `SECURITY INVOKER`, `search_path` fijo; `EXECUTE` sólo authenticated/service_role |

No redefine vistas, funciones, políticas ni GRANT existentes. pgTAP `supabase/tests/25_executive_read_models.test.sql` (34 aserciones).

**Rollback** (sin datos que migrar) — está en la cabecera de la migración:

```sql
drop function if exists platform.commission_summary(text, text);
drop function if exists platform.cost_summary(text, text);
drop function if exists platform.collections_by_month(date, date, uuid);
drop function if exists platform.receivables_aging(uuid);
drop function if exists platform.invoice_summary(text, text, uuid, text);
drop view if exists platform.v_cost_entry_list;
drop view if exists platform.v_renewal_pipeline;
drop view if exists platform.v_collected_payments;
drop view if exists platform.v_invoice_balances;
```

## 2. Orden de despliegue

1. **Backend primero**: aplicar SÓLO `20260925100000_executive_read_models.sql` al entorno destino,
   archivo por archivo (el repo ya tiene el script de operador que aplica migraciones pendientes una a
   una). **Nunca `db push` general**: el historial remoto tiene drift conocido.
2. Verificar con un rol autenticado de finanzas: `select platform.invoice_summary();` devuelve jsonb.
3. **Frontend después.** Compatibilidad: si el frontend llega a un entorno SIN la migración, las
   tarjetas y tablas afectadas muestran «No disponible» (PGRST202/42883), no totales inventados;
   el resto de la consola funciona (probado en `e2e/executive/states.spec.ts`).
4. No se requiere ningún cambio de Edge Functions, secretos, integraciones ni datos. No tocar el
   provisioning certificado.

## 3. Flujo Git sugerido (no ejecutado)

```bash
# desde el checkout principal, rama dev limpia
git fetch origin
git log --oneline dev..feat/masteradmin-executive-experience-20260925-0042   # revisar commits
# opción: PR feature → dev; luego PR dev → qas con los checks del repo
```

- Sin force push. Verificar remoto y rama antes de cada push.
- `.runtime/`, `.env.local` y `test-results/` no están versionados.
- El fixture `supabase/fixtures/executive-demo.sql` es LOCAL: no aplicarlo a QAS/PRD.

## 4. Checklist de verificación en QAS (tras autorización)

- [ ] Migración aplicada sola; `supabase/tests/25_*` equivalente verificado con roles reales.
- [ ] Partner ve sólo su cartera en `/billing` y en el inicio; técnico no ve finanzas.
- [ ] Login A → salir → login B: sin datos de A.
- [ ] Ninguna pantalla dispara CHECK_HEALTH ni altas SaaS al abrirse.
- [ ] Capturas QAS rotuladas como datos de prueba; nada de cifras sintéticas en QAS.
