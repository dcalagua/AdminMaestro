import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowClockwiseIcon } from '@phosphor-icons/react';
import { usePlans } from '@/services/queries';
import { usePermissions } from '@/hooks/usePermissions';
import { useSearchFilter } from '@/hooks/useSearchFilter';
import { StatusTabs } from '@/components/ui/SectionTabs';
import {
  PageContainer, Card, DataTable, SearchBar, LoadingState, ErrorState, EmptyState,
} from '@/components/ui/primitives';
import { CellTitle, StatusCell } from '@/components/ui/cells';
import { ActionMenu } from '@/components/ui/ActionMenu';
import { DetailDrawer } from '@/components/ui/DetailDrawer';
import { DetailFacts } from '@/components/ui/DetailFacts';
import { RevokeWithReasonDialog } from '@/components/ui/RevokeWithReasonDialog';
import { useToast } from '@/components/ui/toast-context';
import { businessErrorMessage } from '@/lib/pgError';
import { formatDateTime } from '@/lib/format';
import { OrganizationFormDialog } from '@/features/organizations/OrganizationFormDialog';
import {
  useCommercialLeads, useLeadSyncState, useLinkLeadOrganization, useRunLeadSync, useSetLeadStatus, type LeadWithRefs,
} from './leadsApi';
import {
  COUNTRY_LABEL, STATUS_LABEL, STATUS_TONE, ageLabel, asStatus, matchesTab, onboardingUrl, organizationDraftFrom,
  planLabel, tabOptions, type LeadTab,
} from './leadsModel';

/**
 * Solicitudes de la web (leads.v1).
 *
 * Lo que llena alguien en la landing de una app (hoy eChange) llega acá cada
 * 10 minutos —o al pulsar «Traer ahora»— y se trabaja sin salir del Admin
 * Maestro: contactar, descartar con motivo, o convertir creando la cuenta
 * cliente y abriendo «Nueva venta» con sus datos.
 */
export function LeadsPage() {
  const perms = usePermissions();
  const navigate = useNavigate();
  const toast = useToast();
  const leads = useCommercialLeads({ enabled: perms.canManageCommercial });
  const syncState = useLeadSyncState();
  const plans = usePlans();
  const runSync = useRunLeadSync();
  const setStatus = useSetLeadStatus();
  const linkOrg = useLinkLeadOrganization();
  const [tab, setTab] = useState<LeadTab>('OPEN');
  const [openId, setOpenId] = useState<string | null>(null);
  const [discarding, setDiscarding] = useState<LeadWithRefs | null>(null);
  const [converting, setConverting] = useState<LeadWithRefs | null>(null);

  const planList = useMemo(
    () => (plans.data ?? []).map((p) => ({ code: p.code, name: p.name })),
    [plans.data],
  );
  const { term, setTerm, filtered } = useSearchFilter(leads.data, (l) => [
    l.company_name, l.contact_name, l.email, l.phone, l.saas_products?.short_name,
    planLabel(l.plan_code, planList), COUNTRY_LABEL[l.country_code ?? ''],
  ]);
  const visible = filtered.filter((l) => matchesTab(l, tab));
  const open = (leads.data ?? []).find((l) => l.id === openId) ?? null;
  // Estable: el diálogo se reinicia cuando cambia lo propuesto, no en cada render.
  const convertDraft = useMemo(() => (converting ? organizationDraftFrom(converting) : undefined), [converting]);
  const lastRun = (syncState.data ?? [])
    .map((s) => s.last_run_at)
    .filter(Boolean)
    .sort()
    .at(-1);
  const failing = (syncState.data ?? []).filter((s) => s.last_outcome === 'FAILED');

  async function traer() {
    try {
      const r = await runSync.mutateAsync();
      const nuevas = (r.targets ?? []).reduce((n, t) => n + (t.new ?? 0), 0);
      const fallos = (r.targets ?? []).filter((t) => t.errorCode);
      if (fallos.length) toast.error('Alguna app no respondió', fallos.map((f) => `${f.product}: ${f.errorCode}`).join(' · '));
      else toast.success(nuevas ? `${nuevas} solicitud${nuevas === 1 ? '' : 'es'} nueva${nuevas === 1 ? '' : 's'}` : 'No hay solicitudes nuevas');
    } catch (error) {
      toast.error('No se pudieron traer', businessErrorMessage(error));
    }
  }

  async function marcar(lead: LeadWithRefs, status: 'NEW' | 'CONTACTED') {
    try {
      await setStatus.mutateAsync({ id: lead.id, status });
      toast.success(status === 'CONTACTED' ? 'Marcada como contactada' : 'Solicitud reabierta', lead.company_name);
    } catch (error) {
      toast.error('No se pudo cambiar', businessErrorMessage(error));
    }
  }

  async function vincular(lead: LeadWithRefs, organizationId: string) {
    try {
      await linkOrg.mutateAsync({ id: lead.id, organizationId });
      navigate(onboardingUrl({ id: lead.id, organization_id: organizationId }));
    } catch (error) {
      toast.error('El cliente se creó, pero no se pudo enlazar la solicitud', businessErrorMessage(error));
    }
  }

  function acciones(l: LeadWithRefs) {
    const status = asStatus(l.status);
    return [
      { label: 'Ver solicitud', onSelect: () => setOpenId(l.id) },
      { label: 'Escribir correo', onSelect: () => { window.location.href = `mailto:${l.email}`; } },
      status === 'NEW' ? { label: 'Marcar como contactada', onSelect: () => void marcar(l, 'CONTACTED') } : null,
      status === 'NEW' || status === 'CONTACTED'
        ? { label: 'Crear cliente y nueva venta…', onSelect: () => setConverting(l) }
        : null,
      status === 'CONVERTED' && l.organization_id
        ? { label: 'Ficha del cliente', to: `/organizations/${l.organization_id}` }
        : null,
      status === 'CONVERTED' ? { label: 'Nueva venta con esta solicitud', to: onboardingUrl(l) } : null,
      status === 'DISCARDED' ? { label: 'Reabrir', onSelect: () => void marcar(l, 'NEW') } : null,
      status === 'NEW' || status === 'CONTACTED'
        ? { label: 'Descartar…', tone: 'danger' as const, onSelect: () => setDiscarding(l) }
        : null,
    ];
  }

  if (!perms.canManageCommercial) {
    return (
      <PageContainer title="Solicitudes de la web">
        <Card>
          <EmptyState title="Sin acceso" description="Las solicitudes de la web las trabaja el área comercial de EBIM." />
        </Card>
      </PageContainer>
    );
  }

  const hasAny = (leads.data ?? []).length > 0;

  return (
    <PageContainer
      title="Solicitudes de la web"
      description="Lo que llenan los prospectos en la landing de cada app. Contáctalos, descártalos con motivo o conviértelos en cliente y nueva venta."
      actions={
        <button type="button" className="ebim-btn-secondary" disabled={runSync.isPending} onClick={() => void traer()}>
          <ArrowClockwiseIcon size={16} aria-hidden />
          {runSync.isPending ? 'Trayendo…' : 'Traer ahora'}
        </button>
      }
    >
      <p className="mb-3 text-caption text-muted">
        {lastRun ? `Última lectura: ${formatDateTime(lastRun)}. ` : 'Todavía no se leyó ninguna app. '}
        Se leen solas cada 10 minutos.
        {failing.length ? <span className="text-warn"> La última lectura falló en {failing.length} app(s): {failing.map((f) => f.last_error_code).join(', ')}.</span> : null}
      </p>
      <Card>
        <SearchBar
          value={term}
          onChange={setTerm}
          total={leads.isLoading ? undefined : (leads.data ?? []).length}
          placeholder="Buscar por empresa, persona, correo, plan o país…"
          right={<StatusTabs label="Estado" value={tab} onChange={setTab} options={tabOptions(filtered)} />}
        />
        {leads.isLoading ? (
          <LoadingState label="Cargando solicitudes…" />
        ) : leads.error ? (
          <ErrorState error={leads.error} onRetry={() => void leads.refetch()} />
        ) : !hasAny ? (
          <EmptyState
            title="Todavía no llegó ninguna solicitud"
            description="Cuando alguien llene el formulario de la landing de eChange, aparece acá en menos de 10 minutos."
          />
        ) : visible.length === 0 ? (
          <EmptyState
            variant="no-results"
            title="Ninguna solicitud en esta vista"
            description="Prueba con otra búsqueda o cambia de pestaña."
            onClear={() => { setTerm(''); setTab('ALL'); }}
          />
        ) : (
          <DataTable
            label="Solicitudes de la web"
            minWidth={980}
            columns={[
              { label: 'Empresa y contacto', sticky: true },
              'Interés',
              { label: 'País', mobile: false },
              'Recibida',
              'Estado',
              { label: 'Acciones', srOnly: true },
            ]}
          >
            {visible.map((l) => {
              const status = asStatus(l.status);
              return (
                <tr key={l.id} className="cursor-pointer" onClick={() => setOpenId(l.id)}>
                  <td className="ebim-td py-2">
                    <div className="max-w-[300px]">
                      <CellTitle title={l.company_name} secondary={[l.contact_name, l.email]} />
                    </div>
                  </td>
                  <td className="ebim-td py-2 text-compact">
                    <span className="block leading-tight">
                      <span className="block text-fg">{l.saas_products?.short_name ?? 'App'} · {planLabel(l.plan_code, planList)}</span>
                      <span className="block text-caption text-muted">{l.team_size ? `${l.team_size} agentes` : 'Equipo sin indicar'}</span>
                    </span>
                  </td>
                  <td className="ebim-td py-2 text-compact">{COUNTRY_LABEL[l.country_code ?? ''] ?? 'Otro'}</td>
                  <td className="ebim-td py-2 text-compact">
                    <span className="block leading-tight">
                      <span className="block text-fg">{ageLabel(l.received_at)}</span>
                      <span className="block text-caption text-muted">{formatDateTime(l.received_at)}</span>
                    </span>
                  </td>
                  <td className="ebim-td py-2">
                    <StatusCell
                      label={STATUS_LABEL[status]}
                      tone={STATUS_TONE[status]}
                      detail={status === 'CONVERTED' ? l.organizations?.display_name : status === 'DISCARDED' ? l.status_note ?? undefined : undefined}
                    />
                  </td>
                  <td className="ebim-td w-12 text-right" onClick={(e) => e.stopPropagation()}>
                    <ActionMenu label={`Acciones de la solicitud de ${l.company_name}`} items={acciones(l)} />
                  </td>
                </tr>
              );
            })}
          </DataTable>
        )}
      </Card>

      <DetailDrawer
        open={Boolean(open)}
        title={open?.company_name ?? ''}
        subtitle={open ? `${STATUS_LABEL[asStatus(open.status)]} · recibida ${ageLabel(open.received_at)}` : undefined}
        onClose={() => setOpenId(null)}
        actions={
          open && (open.status === 'NEW' || open.status === 'CONTACTED') ? (
            <button type="button" className="ebim-btn-primary" onClick={() => setConverting(open)}>
              Crear cliente y nueva venta
            </button>
          ) : open?.status === 'CONVERTED' ? (
            <button type="button" className="ebim-btn-primary" onClick={() => navigate(onboardingUrl(open))}>
              Nueva venta con esta solicitud
            </button>
          ) : null
        }
      >
        {open ? (
          <div className="grid gap-4">
            <DetailFacts
              columns={2}
              items={[
                ['Contacto', open.contact_name],
                ['Correo', <a key="m" className="ebim-link" href={`mailto:${open.email}`}>{open.email}</a>],
                ['Teléfono', open.phone ? <a key="t" className="ebim-link" href={`tel:${open.phone}`}>{open.phone}</a> : 'No lo dejó'],
                ['País', COUNTRY_LABEL[open.country_code ?? ''] ?? 'Otro / sin indicar'],
                ['App', open.saas_products?.short_name ?? '—'],
                ['Plan de interés', planLabel(open.plan_code, planList)],
                ['Tamaño del equipo', open.team_size ? `${open.team_size} agentes` : 'Sin indicar'],
                ['Recibida', formatDateTime(open.received_at)],
              ]}
            />
            <div className="px-5">
              <p className="text-caption text-muted">Lo que escribió</p>
              <p className="mt-1 whitespace-pre-wrap text-compact text-fg">{open.message || 'No dejó mensaje.'}</p>
            </div>
            {open.status_note ? (
              <div className="px-5">
                <p className="text-caption text-muted">Nota del seguimiento</p>
                <p className="mt-1 whitespace-pre-wrap text-compact text-fg">{open.status_note}</p>
              </div>
            ) : null}
            <div className="flex flex-wrap gap-2 px-5 pb-4">
              {acciones(open).filter((a) => a && a.label !== 'Ver solicitud').map((a) =>
                a ? (
                  <button
                    key={a.label}
                    type="button"
                    className={a.tone === 'danger' ? 'ebim-btn-danger' : 'ebim-btn-secondary'}
                    onClick={() => (a.to ? navigate(a.to) : a.onSelect?.())}
                  >
                    {a.label.replace('…', '')}
                  </button>
                ) : null,
              )}
            </div>
          </div>
        ) : null}
      </DetailDrawer>

      <RevokeWithReasonDialog
        open={Boolean(discarding)}
        title="¿Descartar esta solicitud?"
        description="Queda en la pestaña «Descartadas» con el motivo, y se puede reabrir. No se le avisa nada al prospecto."
        submitLabel="Descartar"
        busy={setStatus.isPending}
        onSubmit={async (reason) => {
          if (!discarding) return;
          try {
            await setStatus.mutateAsync({ id: discarding.id, status: 'DISCARDED', note: reason });
            toast.success('Solicitud descartada', discarding.company_name);
            setDiscarding(null);
          } catch (error) {
            toast.error('No se pudo descartar', businessErrorMessage(error));
          }
        }}
        onCancel={() => setDiscarding(null)}
      />

      <OrganizationFormDialog
        open={Boolean(converting)}
        defaultCapability="CUSTOMER"
        initial={convertDraft}
        onSaved={(id) => { if (converting) void vincular(converting, id); }}
        onClose={() => setConverting(null)}
      />
    </PageContainer>
  );
}
