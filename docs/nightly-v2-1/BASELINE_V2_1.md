# Punto de partida de la fase V2.1

Fecha: 2026-09-07 · HEAD al empezar: `31ace33` · `origin/dev`: `561053e`

## Qué había antes de tocar nada

| Elemento | Estado medido |
|---|---|
| Migraciones | 21, todas aplicadas por `db:reset` sin error |
| Tests pgTAP | 102, PASS |
| Tests unitarios | 32, PASS |
| Tests E2E | 39, PASS |
| Edge Functions | 4 (`culqi-webhook`, `payment-setup`, `payment-reconcile`, `provisioning-worker`) |
| Modo de cobro | MOCK — la cuenta `culqi-pe-test` no tenía `secret_key_ref` |

## Qué NO se dio por bueno

El informe final de la V2 declaraba `GO_WITH_GAPS`. Esta fase **no partió de
él**: cada afirmación relevante se volvió a comprobar ejecutándola. Esa decisión
es la que hizo aparecer los ocho fallos del apartado siguiente, cinco de ellos
de seguridad, ninguno visible leyendo el informe anterior.

Concretamente, lo que el informe V2 daba por resuelto y **no lo estaba**:

- «El webhook clasifica los eventos de suscripción» — sí, pero clasificaba los
  cobros recurrentes como cambios de estado. Ver F-08.
- «El adapter de Culqi implementa el flujo de recurrencia» — contra endpoints
  que no existen. Ver F-06.
- «Las RPC de proveedor son `SECURITY DEFINER` y auditadas» — cierto, y aun así
  ejecutables por roles humanos. Ver F-01 y F-02.

## Regla que se mantuvo toda la fase

Las 21 migraciones existentes no se editaron. Se comprobó al terminar con
`git diff --name-only HEAD -- supabase/migrations/`, que no devuelve ninguna.
Lo nuevo son dos migraciones (22 y 23) y ningún cambio retroactivo.
