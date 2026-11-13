import { useMemo, useState } from 'react';
import { ArrowsClockwiseIcon, PaperPlaneTiltIcon } from '@phosphor-icons/react';
import {
  Card,
  DataTable,
  EmptyState,
  ErrorState,
  LoadingState,
  PageContainer,
  SearchBar,
} from '@/components/ui/primitives';
import { StatCell, StatStrip } from '@/components/ui/StatStrip';
import { CellTitle, StatusCell } from '@/components/ui/cells';
import { StatusTabs } from '@/components/ui/SectionTabs';
import { RevokeWithReasonDialog } from '@/components/ui/RevokeWithReasonDialog';
import { FormDialog } from '@/components/ui/FormDialog';
import { SelectField, SwitchField, TextField } from '@/components/ui/fields';
import { useToast } from '@/components/ui/toast-context';
import { useSearchFilter } from '@/hooks/useSearchFilter';
import { usePermissions } from '@/hooks/usePermissions';
import { useAuth } from '@/hooks/useAuth';
import { businessErrorMessage } from '@/lib/pgError';
import { formatDateTime, formatNumber } from '@/lib/format';
import { relativeAge } from '@/features/suite/suiteModel';
import {
  useCancelMail,
  useMailOutbox,
  useMailSettings,
  useProcessMailNow,
  useResendMail,
  useSaveMailSettings,
  useSendTestMail,
  type MailRow,
} from './mailApi';
import {
  MAIL_CATEGORY,
  MAIL_EVENT,
  MAIL_FILTERS,
  MAIL_TEMPLATES,
  canCancel,
  canResend,
  mailStatus,
  matchesFilter,
  type MailFilter,
} from './mailModel';

/**
 * Gobierno › Correos enviados.
 *
 * Todo lo que el Admin Maestro envía por EBIM MailHub: accesos a la consola,
 * avisos a clientes (factura, pago, vencimiento, suspensión, alta) y resúmenes
 * internos. Estado de entrega real (callbacks de MailHub), retenidos por la
 * salvaguarda de QAS y acciones con motivo (reenviar, cancelar). V6: franja
 * `StatStrip`, celdas tipadas y tabla densa.
 */
const DAY = 24 * 60 * 60 * 1000;

type Acting = { row: MailRow; action: 'RESEND' | 'CANCEL' } | null;

export function MailOutboxPage() {
  const outbox = useMailOutbox();
  const settings = useMailSettings();
  const processNow = useProcessMailNow();
  const resend = useResendMail();
  const cancel = useCancelMail();
  const { isSuperAdmin, canReadFinance } = usePermissions();
  const toast = useToast();
  const [filter, setFilter] = useState<MailFilter>('all');
  const [acting, setActing] = useState<Acting>(null);
  const [testing, setTesting] = useState(false);

  const rows = useMemo(() => outbox.data ?? [], [outbox.data]);
  const byFilter = useMemo(() => rows.filter((r) => matchesFilter(r.status, filter)), [rows, filter]);
  const { term, setTerm, filtered } = useSearchFilter(byFilter, (r) => [
    r.recipient_email,
    r.delivered_to,
    r.reference_label,
    r.organization_name,
    r.tenant_name,
    r.invoice_number,
    r.template_key,
    MAIL_EVENT[r.event_type ?? ''],
    mailStatus(r.status).label,
  ]);

  const stats = useMemo(() => {
    const now = Date.now();
    const recent = rows.filter((r) => r.created_at && now - new Date(r.created_at).getTime() < DAY);
    const sentRecent = recent.filter((r) => ['SENT', 'DELIVERED', 'DELAYED'].includes(r.status ?? '')).length;
    const week = rows.filter((r) => r.sent_at && now - new Date(r.sent_at).getTime() < 7 * DAY);
    const delivered = week.filter((r) => r.status === 'DELIVERED').length;
    return {
      sentRecent,
      week: week.length,
      delivered,
      problems: rows.filter((r) => matchesFilter(r.status, 'problems')).length,
      held: rows.filter((r) => r.status === 'HELD').length,
      queued: rows.filter((r) => ['PENDING', 'SENDING'].includes(r.status ?? '')).length,
      mode: rows.find((r) => r.delivery_mode && r.category !== 'AUTH')?.delivery_mode ?? null,
    };
  }, [rows]);

  const counts = useMemo(
    () => Object.fromEntries(MAIL_FILTERS.map((f) => [f.id, rows.filter((r) => matchesFilter(r.status, f.id)).length])),
    [rows],
  );

  const canAct = isSuperAdmin || canReadFinance;

  const runNow = () =>
    processNow.mutate(undefined, {
      onSuccess: (r) =>
        toast.success(
          'Bandeja procesada',
          `${formatNumber(r.sent ?? 0)} enviados · ${formatNumber(r.held ?? 0)} retenidos · ${formatNumber(r.skipped ?? 0)} descartados.`,
        ),
      onError: (e) => toast.error('No se pudo procesar la bandeja', businessErrorMessage(e)),
    });

  return (
    <PageContainer
      title="Correos enviados"
      description="Todo lo que el Admin Maestro envía por EBIM MailHub, con su estado de entrega real."
      actions={
        <>
          {isSuperAdmin ? (
            <button type="button" className="ebim-btn-secondary" onClick={() => setTesting(true)}>
              <PaperPlaneTiltIcon size={16} aria-hidden />
              Enviar prueba
            </button>
          ) : null}
          <button type="button" className="ebim-btn-primary" disabled={processNow.isPending} onClick={runNow}>
            <ArrowsClockwiseIcon size={16} aria-hidden />
            {processNow.isPending ? 'Procesando…' : 'Procesar ahora'}
          </button>
        </>
      }
    >
      <StatStrip label="Resumen del correo">
        <StatCell
          label="Enviados (24 h)"
          value={formatNumber(stats.sentRecent)}
          context="Aceptados por MailHub"
          loading={outbox.isLoading}
          error={outbox.error}
          onRetry={() => void outbox.refetch()}
        />
        <StatCell
          label="Entregados (7 días)"
          value={stats.week ? `${formatNumber(stats.delivered)} de ${formatNumber(stats.week)}` : null}
          emptyLabel="Sin envíos"
          context="Confirmados por el servidor destino"
          tone={stats.week && stats.delivered === stats.week ? 'ok' : 'neutral'}
          onSelect={() => setFilter('delivered')}
          selected={filter === 'delivered'}
          loading={outbox.isLoading}
          error={outbox.error}
        />
        <StatCell
          label="Con problemas"
          value={formatNumber(stats.problems)}
          context={stats.problems ? 'Rebotes, fallos o demoras' : 'Nada que revisar'}
          tone={stats.problems ? 'danger' : 'ok'}
          onSelect={() => setFilter('problems')}
          selected={filter === 'problems'}
          loading={outbox.isLoading}
          error={outbox.error}
        />
        <StatCell
          label="Retenidos (QAS)"
          value={formatNumber(stats.held)}
          info="Salvaguarda de QAS: los correos a clientes reales no salen; solo a dominios permitidos de EBIM."
          context={stats.mode ? `Modo de entrega: ${stats.mode}` : 'Destinatarios fuera de EBIM'}
          tone={stats.held ? 'warn' : 'neutral'}
          onSelect={() => setFilter('held')}
          selected={filter === 'held'}
          loading={outbox.isLoading}
          error={outbox.error}
        />
        <StatCell
          label="En cola"
          value={formatNumber(stats.queued)}
          context="Salen en el próximo minuto"
          onSelect={() => setFilter('in_flight')}
          selected={filter === 'in_flight'}
          loading={outbox.isLoading}
          error={outbox.error}
        />
      </StatStrip>

      <Card>
        <SearchBar
          value={term}
          onChange={setTerm}
          placeholder="Buscar destinatario, cliente o factura…"
          total={rows.length}
          right={
            <StatusTabs
              label="Estado del correo"
              options={MAIL_FILTERS.map((f) => ({ id: f.id, label: f.label, count: counts[f.id] }))}
              value={filter}
              onChange={setFilter}
            />
          }
        />
        {outbox.isLoading ? (
          <LoadingState variant="table" label="Cargando los correos…" />
        ) : outbox.error ? (
          <ErrorState error={outbox.error} onRetry={() => void outbox.refetch()} />
        ) : rows.length === 0 ? (
          <EmptyState
            illustration="none"
            title="Todavía no se envió ningún correo"
            description="Aparecerán aquí las invitaciones, avisos a clientes y resúmenes que envíe el Admin Maestro."
          />
        ) : filtered.length === 0 ? (
          <EmptyState
            variant="no-results"
            illustration="none"
            title="Ningún correo coincide"
            onClear={() => {
              setTerm('');
              setFilter('all');
            }}
          />
        ) : (
          <DataTable
            label="Correos del Admin Maestro"
            minWidth={1040}
            columns={[
              { label: 'Correo', sticky: true, width: 250 },
              { label: 'Destinatario', width: 220 },
              { label: 'Estado', width: 150 },
              { label: 'Detalle', width: 300 },
              { label: 'Creado', width: 110 },
              { label: 'Acciones', srOnly: true },
            ]}
          >
            {filtered.map((r) => {
              const st = mailStatus(r.status);
              const redirected = r.delivered_to && r.recipient_email && r.delivered_to !== r.recipient_email;
              return (
                <tr key={r.id}>
                  <td className="ebim-td py-2">
                    <CellTitle
                      title={MAIL_EVENT[r.event_type ?? ''] ?? r.event_type ?? 'Correo'}
                      to={
                        r.invoice_id && r.organization_id
                          ? `/organizations/${r.organization_id}`
                          : r.tenant_id
                            ? `/tenants/${r.tenant_id}`
                            : undefined
                      }
                      secondary={[MAIL_CATEGORY[r.category ?? ''] ?? r.category, r.reference_label]}
                      secondaryTitle={`Plantilla ${r.template_key ?? '—'}`}
                    />
                  </td>
                  <td className="ebim-td text-compact">
                    <span className="block truncate" title={r.recipient_email ?? undefined}>
                      {r.recipient_email ?? '— Sin destinatario'}
                    </span>
                    {redirected ? (
                      <span className="block truncate text-caption text-muted" title={r.delivered_to ?? undefined}>
                        Redirigido a {r.delivered_to}
                      </span>
                    ) : r.organization_name ? (
                      <span className="block truncate text-caption text-muted" title={r.organization_name}>
                        {r.organization_name}
                      </span>
                    ) : null}
                  </td>
                  <td className="ebim-td">
                    <StatusCell
                      label={st.label}
                      tone={st.tone}
                      help={st.help}
                      detail={
                        r.last_event_at
                          ? relativeAge(r.last_event_at)
                          : r.sent_at
                            ? relativeAge(r.sent_at)
                            : undefined
                      }
                    />
                  </td>
                  <td className="ebim-td text-compact">
                    <span className="line-clamp-2" title={r.status_detail ?? undefined}>
                      {r.status_detail ?? (r.mailhub_email_id ? 'Aceptado por MailHub' : '—')}
                    </span>
                    {r.mailhub_email_id ? (
                      <span className="block truncate font-mono text-caption text-muted" title={`Id en MailHub: ${r.mailhub_email_id}`}>
                        {r.mailhub_email_id}
                      </span>
                    ) : r.last_error_code ? (
                      <span className="block font-mono text-caption text-muted">{r.last_error_code}</span>
                    ) : null}
                  </td>
                  <td className="ebim-td whitespace-nowrap text-compact">
                    <span title={formatDateTime(r.created_at)}>{r.created_at ? relativeAge(r.created_at) : '—'}</span>
                    {(r.attempts ?? 0) > 1 ? (
                      <div className="text-caption text-muted">{r.attempts} intentos</div>
                    ) : null}
                  </td>
                  <td className="ebim-td whitespace-nowrap text-right">
                    {canAct && canResend(r) ? (
                      <button
                        type="button"
                        className="ebim-btn-secondary ebim-btn-sm"
                        onClick={() => setActing({ row: r, action: 'RESEND' })}
                      >
                        Reenviar
                      </button>
                    ) : null}
                    {canAct && canCancel(r) ? (
                      <button
                        type="button"
                        className="ebim-btn-ghost ebim-btn-sm"
                        onClick={() => setActing({ row: r, action: 'CANCEL' })}
                      >
                        Cancelar
                      </button>
                    ) : null}
                  </td>
                </tr>
              );
            })}
          </DataTable>
        )}
      </Card>

      <MailSettingsCard
        editable={isSuperAdmin}
        loading={settings.isLoading}
        error={settings.error}
        businessMailEnabled={settings.data?.business_mail_enabled ?? true}
        opsRecipients={settings.data?.ops_recipients ?? []}
      />

      <RevokeWithReasonDialog
        open={acting !== null}
        title={acting?.action === 'RESEND' ? 'Reenviar el correo' : 'Cancelar el correo'}
        description={
          acting?.action === 'RESEND'
            ? 'Se vuelve a enviar con una clave nueva hacia MailHub. Si rebotó, corrija antes la dirección en la ficha del cliente.'
            : 'El correo no saldrá. Queda constancia del motivo en la auditoría.'
        }
        submitLabel={acting?.action === 'RESEND' ? 'Reenviar' : 'Cancelar correo'}
        busy={resend.isPending || cancel.isPending}
        onCancel={() => setActing(null)}
        onSubmit={async (reason) => {
          if (!acting?.row.id) return;
          if (acting.action === 'RESEND') {
            await resend.mutateAsync({ id: acting.row.id, reason });
            toast.success('Correo en cola para reenviarse');
          } else {
            await cancel.mutateAsync({ id: acting.row.id, reason });
            toast.success('Correo cancelado');
          }
          setActing(null);
        }}
      />
      <SendTestDialog open={testing} onClose={() => setTesting(false)} />
    </PageContainer>
  );
}

function SendTestDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { session } = useAuth();
  const send = useSendTestMail();
  const processNow = useProcessMailNow();
  const toast = useToast();
  const own = session?.user?.email ?? '';
  const [template, setTemplate] = useState(MAIL_TEMPLATES[0].key);
  const [to, setTo] = useState(/@(.+\.)?(ebim\.pe|grupoebim\.com)$/i.test(own) ? own : '');
  return (
    <FormDialog
      open={open}
      title="Enviar una prueba de plantilla"
      description="Llega con datos de muestra. Solo a direcciones @ebim.pe o @grupoebim.com: una prueba nunca sale hacia un cliente."
      submitLabel="Enviar prueba"
      busy={send.isPending}
      error={send.error}
      onCancel={onClose}
      onSubmit={() =>
        send.mutate(
          { templateKey: template, to },
          {
            onSuccess: () => {
              toast.success('Prueba en cola', `Se envía a ${to} en segundos.`);
              processNow.mutate();
              onClose();
            },
          },
        )
      }
    >
      <SelectField
        label="Plantilla"
        value={template}
        onChange={(e) => setTemplate(e.target.value)}
        options={MAIL_TEMPLATES.map((t) => ({ value: t.key, label: `${t.label} · ${t.key}` }))}
      />
      <TextField
        label="Enviar a"
        type="email"
        required
        value={to}
        onChange={(e) => setTo(e.target.value)}
        hint="Una dirección de EBIM."
      />
    </FormDialog>
  );
}

function MailSettingsCard({
  editable,
  loading,
  error,
  businessMailEnabled,
  opsRecipients,
}: {
  editable: boolean;
  loading: boolean;
  error: unknown;
  businessMailEnabled: boolean;
  opsRecipients: string[];
}) {
  const save = useSaveMailSettings();
  const toast = useToast();
  const [enabled, setEnabled] = useState<boolean | null>(null);
  const [recipients, setRecipients] = useState<string | null>(null);
  const currentEnabled = enabled ?? businessMailEnabled;
  const currentRecipients = recipients ?? opsRecipients.join(', ');
  const dirty = enabled !== null || recipients !== null;

  return (
    <Card
      title="Configuración del correo"
      description="Avisos a clientes y destinatarios internos del resumen de operaciones."
      className="mt-6"
      actions={
        editable && dirty ? (
          <button
            type="button"
            className="ebim-btn-primary ebim-btn-sm"
            disabled={save.isPending}
            onClick={() =>
              save.mutate(
                {
                  businessMailEnabled: currentEnabled,
                  opsRecipients: currentRecipients
                    .split(/[,;\s]+/)
                    .map((s) => s.trim())
                    .filter(Boolean),
                },
                {
                  onSuccess: () => {
                    toast.success('Configuración guardada');
                    setEnabled(null);
                    setRecipients(null);
                  },
                  onError: (e) => toast.error('No se pudo guardar', businessErrorMessage(e)),
                },
              )
            }
          >
            {save.isPending ? 'Guardando…' : 'Guardar'}
          </button>
        ) : null
      }
    >
      {loading ? (
        <LoadingState variant="card" label="Cargando la configuración…" />
      ) : error ? (
        <ErrorState error={error} />
      ) : (
        <div className="grid gap-5 px-5 py-4 md:grid-cols-2">
          <SwitchField
            label="Avisos a clientes activos"
            hint="Factura emitida, pago confirmado, factura vencida, suspensión, reactivación y bienvenida al tenant."
            checked={currentEnabled}
            disabled={!editable}
            onChange={setEnabled}
          />
          <TextField
            label="Resumen para operaciones"
            value={currentRecipients}
            disabled={!editable}
            placeholder="ops@ebim.pe, soporte@ebim.pe"
            hint="Correos internos (@ebim.pe o @grupoebim.com), separados por coma. Vacío = no se envía."
            onChange={(e) => setRecipients(e.target.value)}
          />
        </div>
      )}
    </Card>
  );
}
