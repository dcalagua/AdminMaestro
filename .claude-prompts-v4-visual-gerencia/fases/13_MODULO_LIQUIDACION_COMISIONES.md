# FASE 13 — Módulo nuevo: liquidación y pago de comisiones

## Contexto
Brecha P0 de la revisión del 2026-10-04: las comisiones de vendedores se devengan solo con pagos CONFIRMED (trigger), pero
`settle_commissions` deja la liquidación OPEN y no existe forma de aprobarla ni marcarla pagada. La UI de `/commissions` lo menciona
sin respaldo. Lee `docs/commercial/COMMISSION_MODEL.md` y las migraciones `20260902000600`, `20260907000800`, `20260913000900` y la
versión vigente de `generate_commission_events` (`20261008000100` + cambios de `20261011000100`).

## Backend (`supabase/migrations/20261016000100_commission_settlement_payout.sql` + pgTAP `52_commission_settlement_payout.test.sql`)
- Ciclo: `OPEN → APPROVED → PAID` (y `CANCELLED` desde OPEN/APPROVED con motivo; si el enum/estado actual difiere, extiéndelo de forma
  compatible). Revisa qué estados ya existen antes de crear nada.
- RPCs (finanzas o super admin, `log_audit`, motivo obligatorio donde aplique):
  `approve_commission_settlement(p_settlement_id, p_note)`, `pay_commission_settlement(p_settlement_id, p_paid_at, p_payment_reference, p_method, p_note)`,
  `cancel_commission_settlement(p_settlement_id, p_reason)` (libera los eventos para una próxima liquidación).
- Reglas: no pagar dos veces; un evento de comisión no puede estar en dos liquidaciones vivas; un reverso de pago posterior a PAID genera
  contra-evento para la próxima liquidación (verifica cómo funciona hoy el contra-evento y respétalo); importes en la moneda de la liquidación.
- Vendedor (SALES_AGENT) ve solo sus liquidaciones (RLS existente).
- pgTAP: transiciones válidas/ inválidas, idempotencia, permisos, reverso tras pago, auditoría.

## Frontend
- `/commissions`: pestañas Devengado / Liquidaciones; botón «Generar liquidación» (usa `settle_commissions`, hook hoy sin uso), detalle
  de liquidación con eventos, acciones Aprobar / Registrar pago / Anular con diálogos; KPIs de la fase 10.
- Vista del vendedor: sus liquidaciones y estado.
- Quitar textos de UI que prometían acciones inexistentes.

## Pasos
Migración + pgTAP → `db reset` + demo + `supabase test db` → tipos → UI + tests → capturas `VISUAL_LABEL=fase13` → gates → commits `feat(commissions): …`.
Actualiza `COMMISSION_MODEL.md`.

## Hecho cuando
Ciclo completo probado en pgTAP y usable desde la UI, documentación actualizada, gates verdes.
