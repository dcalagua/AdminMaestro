import { useChargeAttempts } from '@/services/queries';
import { Badge, Card, DataTable, EmptyState, ErrorState, LoadingState } from '@/components/ui/primitives';
import { formatDateTime, formatMoney } from '@/lib/format';
import { ATTEMPT_STATUS_LABEL, ATTEMPT_STATUS_TONE, TRIGGER_SOURCE_LABEL } from './autochargeSummary';

/**
 * Historial de intentos de cobro con tarjeta guardada de una suscripción (M2).
 * Política: intento 1 al vencer, 2 a +3 días, 3 a +7 días; tras el tercero,
 * alerta de cobranza. «Cobrar ahora» abre un intento manual fuera de calendario.
 */
export function ChargeAttemptsCard({ subscriptionId }: { subscriptionId: string }) {
  const attempts = useChargeAttempts(subscriptionId);
  const rows = attempts.data ?? [];

  return (
    <Card
      title="Intentos de cobro con tarjeta"
      description="Cobro automático con la tarjeta guardada: al vencer, a los 3 y a los 7 días. Tras el tercer fallo se crea una alerta de cobranza."
    >
      {attempts.isLoading ? (
        <LoadingState />
      ) : attempts.error ? (
        <ErrorState error={attempts.error} onRetry={() => void attempts.refetch()} />
      ) : rows.length === 0 ? (
        <EmptyState title="Sin intentos de cobro" description="Aún no se ha cobrado ninguna factura con la tarjeta guardada." />
      ) : (
        <DataTable columns={['Intento', 'Factura', 'Estado', 'Importe', 'Código', 'Próximo reintento', 'Origen', 'Fecha']}>
          {rows.map((a) => (
            <tr key={a.id as string}>
              <td className="ebim-td tabular-nums">#{a.attempt_no}</td>
              <td className="ebim-td font-mono text-xs">{a.invoice_number}</td>
              <td className="ebim-td">
                <Badge tone={ATTEMPT_STATUS_TONE[a.status as string] ?? 'neutral'}>
                  {ATTEMPT_STATUS_LABEL[a.status as string] ?? a.status}
                </Badge>
              </td>
              <td className="ebim-td tabular-nums">{formatMoney(Number(a.amount), a.currency)}</td>
              <td className="ebim-td font-mono text-xs">{a.error_code ?? '—'}</td>
              <td className="ebim-td text-xs text-muted">
                {a.next_retry_at ? formatDateTime(a.next_retry_at as string) : a.status === 'FAILED' ? 'Sin reintentos' : '—'}
              </td>
              <td className="ebim-td text-xs">{TRIGGER_SOURCE_LABEL[a.trigger_source as string] ?? a.trigger_source}</td>
              <td className="ebim-td text-xs text-muted">{formatDateTime(a.created_at as string)}</td>
            </tr>
          ))}
        </DataTable>
      )}
    </Card>
  );
}
