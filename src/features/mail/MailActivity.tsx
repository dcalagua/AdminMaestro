import { Link } from 'react-router-dom';
import { Card, DataTable, EmptyState, ErrorState, LoadingState } from '@/components/ui/primitives';
import { CellTitle, StatusCell } from '@/components/ui/cells';
import { formatDateTime } from '@/lib/format';
import { useAuth } from '@/hooks/useAuth';
import { relativeAge } from '@/features/suite/suiteModel';
import { useMailFor, type MailRow } from './mailApi';
import { MAIL_EVENT, mailStatus } from './mailModel';

/**
 * Estado del correo en las fichas 360 (organización y tenant).
 *
 * Solo lectura: la RLS de `v_mail_outbox` decide (super admin, producto y
 * finanzas). Para quien no ve correo, la consulta vuelve vacía y no se pinta
 * nada que confunda: la tarjeta lo dice en una línea.
 */

export function InvoiceMailCell({ mail }: { mail: MailRow | undefined }) {
  if (!mail) return <span className="text-caption text-muted">—</span>;
  const st = mailStatus(mail.status);
  return (
    <StatusCell
      label={st.label}
      tone={st.tone}
      help={`${MAIL_EVENT[mail.event_type ?? ''] ?? mail.event_type} → ${mail.recipient_email ?? 'sin destinatario'}. ${st.help}`}
      detail={MAIL_EVENT[mail.event_type ?? ''] ?? undefined}
    />
  );
}

export function MailActivityCard({
  organizationId,
  tenantId,
  title = 'Correos enviados',
}: {
  organizationId?: string | null;
  tenantId?: string | null;
  title?: string;
}) {
  const { persona } = useAuth();
  const mails = useMailFor({ organizationId: persona === 'EBIM' ? organizationId : null, tenantId: persona === 'EBIM' ? tenantId : null }, 20);
  const rows = mails.data ?? [];
  // El correo lo gestiona EBIM; un partner o cliente no tiene bandeja que ver.
  if (persona !== 'EBIM') return null;
  return (
    <Card
      title={title}
      description="Avisos que el Admin Maestro envió por EBIM MailHub y su estado de entrega."
      actions={
        <Link to="/correos" className="ebim-btn-ghost ebim-btn-sm">
          Ver todos
        </Link>
      }
    >
      {mails.isLoading ? (
        <LoadingState variant="table" rows={3} label="Cargando los correos…" />
      ) : mails.error ? (
        <ErrorState error={mails.error} onRetry={() => void mails.refetch()} />
      ) : rows.length === 0 ? (
        <EmptyState illustration="none" title="Sin correos para mostrar" />
      ) : (
        <DataTable
          label={title}
          paginate={false}
          columns={[
            { label: 'Correo', sticky: true, width: 240 },
            { label: 'Destinatario' },
            { label: 'Estado', width: 170 },
            { label: 'Creado', width: 130 },
          ]}
        >
          {rows.map((r) => {
            const st = mailStatus(r.status);
            return (
              <tr key={r.id}>
                <td className="ebim-td py-2">
                  <CellTitle
                    title={MAIL_EVENT[r.event_type ?? ''] ?? r.event_type ?? 'Correo'}
                    secondary={[r.reference_label]}
                  />
                </td>
                <td className="ebim-td text-compact">
                  <span className="block truncate" title={r.recipient_email ?? undefined}>
                    {r.recipient_email ?? '— Sin destinatario'}
                  </span>
                </td>
                <td className="ebim-td">
                  <StatusCell label={st.label} tone={st.tone} help={r.status_detail ?? st.help} />
                </td>
                <td className="ebim-td whitespace-nowrap text-compact">
                  <span title={formatDateTime(r.created_at)}>{r.created_at ? relativeAge(r.created_at) : '—'}</span>
                </td>
              </tr>
            );
          })}
        </DataTable>
      )}
    </Card>
  );
}
