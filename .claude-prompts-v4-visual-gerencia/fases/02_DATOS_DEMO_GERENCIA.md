# FASE 02 — Datos de demostración para Gerencia (solo local)

## Objetivo
Que cada gráfico y tabla tenga historia creíble cuando se presente: 12–18 meses de negocio de una suite SaaS en LATAM.
Hoy el seed tiene pocos registros y casi nada de historia, así que los gráficos se ven vacíos o planos.

## Reglas
- **Solo local.** Nada en `supabase/seed.sql` base (los pgTAP dependen de él) ni en la nube.
- Crear `scripts/demo/demo-data.sql` + `scripts/demo/load-demo-data.sh` (usa `docker exec -i supabase_db_ebim-control-plane psql -U postgres`
  o `psql` contra 127.0.0.1:54422; guarda contra cualquier host que no sea local: si la URL no es localhost/127.0.0.1, aborta).
- Idempotente: re-ejecutable sin duplicar (claves deterministas o `on conflict`), y `scripts/demo/unload-demo-data.sh` para borrarlo.
- Marcar todo con un identificador reconocible (p. ej. `metadata->>'demo' = 'gerencia-v4'` o códigos `DEMO-…`).
- Insertar respetando las reglas de negocio: preferir las RPCs existentes cuando sea viable (onboarding, emisión de facturas,
  `confirm_manual_payment`) en contexto de servicio/superadmin; si para historia pasada hace falta insertar directo, que sea en una
  transacción que deje los mismos invariantes (estados de factura sincronizados, comisiones generadas por el trigger, etc.).
- Nombres de empresas ficticios realistas (no marcas reales). Emails solo `@ebim.test`.

## Contenido sugerido
- 3 mercados (PE, BO, EC) y sus monedas; 4–5 partners/resellers; 35–60 clientes; los 8 productos de la suite.
- Suscripciones con altas escalonadas en 18 meses, expansiones (más usuarios/add-ons), algunas contracciones y 4–6 churns.
- Facturas mensuales emitidas por período; cobros con ritmo realista (la mayoría a tiempo, algunos tarde, cartera vencida 30/60/90+).
- Comisiones generadas por los cobros (vía trigger), una liquidación cerrada y otra abierta.
- Uso y créditos IA en algunos tenants; un par de enlaces de pago; tarifas de partner calculadas en 1–2 meses.
- Costos de infraestructura por producto para que margen tenga sentido.

## Pasos
1. Estudia el modelo (migraciones y `seed.sql`) y las RPCs; diseña el dataset en `scripts/demo/README.md` (qué genera y cómo borrarlo).
2. Implementa, carga, y verifica con consultas: MRR por mes con tendencia creciente creíble, % de cobro 85–95%, cartera vencida no nula.
3. `supabase test db` sigue en verde **después de `db reset`** (el demo no está en el seed base).
4. Abre el dashboard actual en una captura rápida (`VISUAL_LABEL=fase02`) para comprobar que ahora hay datos.
5. Commit: `feat(demo): add an idempotent local demo dataset for the management presentation`.

## Hecho cuando
Dataset cargado y verificable, scripts load/unload idempotentes, pgTAP verde, commit, STATE con las cifras clave del demo.
