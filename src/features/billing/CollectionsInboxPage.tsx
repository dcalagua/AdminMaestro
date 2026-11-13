import { useState } from 'react';
import { Link } from 'react-router-dom';
import {
  useInvoicePage,
  useInvoiceSummary,
  type AgingFilter,
  type InvoiceRow,
  type InvoiceSort,
} from '@/services/financeRead';
import { useActiveCardsByOrganization, useOrganization } from '@/services/queries';
import { useAutocharge } from '@/services/mutations';
import { useListState } from '@/hooks/useListState';
import { usePermissions } from '@/hooks/usePermissions';
import { StatusTabs } from '@/components/ui/SectionTabs';
import { Badge, Card, SearchBar } from '@/components/ui/primitives';
import { PagedTable, type TableColumn } from '@/components/ui/PagedTable';
import { ActionMenu } from '@/components/ui/ActionMenu';
import { ConfirmDialog } from '@/components/ui/ConfirmDialog';
import { useToast } from '@/components/ui/toast-context';
import { businessErrorMessage } from '@/lib/pgError';
import { formatDate, formatMoney } from '@/lib/format';
import { fromQuery } from '@/features/executive/dataState';
import { toCurrencyAmounts } from '@/features/executive/reportContext';
import { GeneratePaymentLinkDialog } from '@/features/organizations/PaymentLinkDialog';
import { useOrgTenants } from '@/features/organizations/org360Queries';
import { LifecycleDialog, type LifecycleTarget } from '@/features/suite/LifecycleDialog';
import { ManualPaymentDialog } from './ManualPaymentDialog';
import { FilterTotals } from './financeUi';
import { useDebouncedSearch } from './listingState';
import { autochargeToast } from './autochargeSummary';
import { dueText } from './collectionsModel';

/**
 * Cobranza → «Por cobrar» (V5 · F4): la bandeja de lo que hay que cobrar hoy.
 *
 * Una fila por factura vencida o por vencer (emitida o parcialmente pagada),
 * de la más urgente a la menos, con las acciones que ya existían en otras
 * pantallas: enviar o copiar el enlace al portal `/pagar`, registrar un pago
 * manual (`confirm_manual_payment`), cobrar con la tarjeta guardada (si la
 * cuenta tiene una vigente) y «Suspender por mora» con la vista previa del
 * impacto en sus apps. Cada acción respeta el permiso de siempre; la base decide.
 */

type InboxFilter = 'VENCIDA' | 'VIGENTE' | 'ALL';

const SORTS = ['due_date', 'balance', 'organization_name', 'number', 'issue_date', 'total'] as const satisfies readonly InvoiceSort[];
const LIST = {
  filter: 'VENCIDA' as InboxFilter,
  filters: ['VENCIDA', 'VIGENTE', 'ALL'] as const,
  sortBy: 'due_date' as InvoiceSort,
  sorts: SORTS,
  sortDir: 'asc' as const,
};

const num = (v: number | string | null | undefined) => (v === null || v === undefined ? null : Number(v));

type Pending =
  | { kind: 'LINK'; row: InvoiceRow }
  | { kind: 'PAY'; row: InvoiceRow }
  | { kind: 'CARD'; row: InvoiceRow; card: string }
  | { kind: 'SUSPEND'; row: InvoiceRow };

export function CollectionsInboxPage() {
  const perms = usePermissions();
  const toast = useToast();
  const autocharge = useAutocharge();
  const list = useListState(LIST, 'pc');
  const [draft, setDraft] = useDebouncedSearch(list.search, list.setSearch);
  const [pending, setPending] = useState<Pending | null>(null);
  // La última factura para la que se pidió un enlace: el diálogo del enlace
  // creado sigue abierto aunque `pending` ya se haya limpiado.
  const [linkFor, setLinkFor] = useState<InvoiceRow | null>(null);

  const aging: AgingFilter = list.filter === 'ALL' ? '' : list.filter;
  const params = {
    search: list.search,
    filter: 'OPEN' as const,
    page: list.page,
    pageSize: list.pageSize,
    sortBy: list.sortBy,
    sortDir: list.sortDir,
    aging,
  };
  const page = useInvoicePage(params);
  const summary = useInvoiceSummary({ search: list.search, filter: 'OPEN', aging });
  const rows = page.data?.rows ?? [];
  const cards = useActiveCardsByOrganization(perms.canReadFinance ? rows.map((r) => r.customer_organization_id ?? '') : []);

  async function chargeCard() {
    if (pending?.kind !== 'CARD' || !pending.row.invoice_id) return;
    const number = pending.row.number ?? '';
    try {
      const summaryResult = await autocharge.mutateAsync({ invoiceId: pending.row.invoice_id });
      const [tone, title, detail] = autochargeToast(summaryResult, number);
      if (tone === 'success') toast.success(title, detail);
      else toast.error(title, detail);
    } catch (error) {
      toast.error('No se pudo cobrar', businessErrorMessage(error));
    } finally {
      setPending(null);
    }
  }

  const columns: TableColumn<InvoiceRow>[] = [
    {
      id: 'number',
      header: 'Factura',
      sortKey: 'number',
      cell: (r) => (
        <span className="block max-w-[180px] truncate whitespace-nowrap font-mono text-compact font-semibold" title={r.number ?? undefined}>
          {r.number ?? '—'}
        </span>
      ),
    },
    {
      id: 'organization',
      header: 'Cuenta',
      sortKey: 'organization_name',
      cell: (r) =>
        r.customer_organization_id ? (
          <Link className="ebim-link block max-w-[200px] truncate" to={`/organizations/${r.customer_organization_id}`} title={r.organization_name ?? undefined}>
            {r.organization_name ?? 'Sin nombre'}
          </Link>
        ) : (
          <span className="text-muted">{r.organization_name ?? '—'}</span>
        ),
    },
    {
      id: 'due',
      header: 'Vencimiento',
      sortKey: 'due_date',
      cell: (r) => {
        const due = dueText(r);
        return (
          <span className="whitespace-nowrap">
            <span className="block text-compact text-fg-2">{r.due_date ? formatDate(r.due_date) : '—'}</span>
            <span className={`block text-caption ${due.overdue ? 'font-semibold text-danger' : 'text-muted'}`}>{due.text}</span>
          </span>
        );
      },
    },
    {
      id: 'balance',
      header: 'Saldo',
      sortKey: 'balance',
      align: 'right',
      cell: (r) => (
        <span className="whitespace-nowrap">
          <span className="block font-semibold">{formatMoney(num(r.balance), r.currency)}</span>
          <span className="block text-caption text-muted">de {formatMoney(num(r.total), r.currency)}</span>
        </span>
      ),
    },
    {
      id: 'card',
      header: 'Tarjeta',
      cell: (r) => {
        const card = r.customer_organization_id ? cards.data?.get(r.customer_organization_id) : undefined;
        return card ? (
          <Badge tone="accent">{card.brand ?? 'Tarjeta'} •••• {card.last4 ?? '????'}</Badge>
        ) : (
          <span className="text-caption text-muted">Sin tarjeta guardada</span>
        );
      },
    },
    {
      id: 'actions',
      header: 'Acciones',
      srOnly: true,
      align: 'right',
      cell: (r) => {
        const card = r.customer_organization_id ? cards.data?.get(r.customer_organization_id) : undefined;
        const balance = num(r.balance) ?? 0;
        const overdue = (r.days_overdue ?? 0) > 0;
        return (
          <ActionMenu
            label={`Acciones de ${r.number ?? 'la factura'}`}
            items={[
              perms.canReadFinance && r.customer_organization_id
                ? {
                    label: 'Enviar enlace de pago',
                    onSelect: () => {
                      setLinkFor(r);
                      setPending({ kind: 'LINK', row: r });
                    },
                  }
                : null,
              perms.canReadFinance && balance > 0 && r.invoice_id
                ? { label: 'Registrar pago manual', onSelect: () => setPending({ kind: 'PAY', row: r }) }
                : null,
              perms.canReadFinance && card && balance > 0 && r.invoice_id
                ? {
                    label: 'Cobrar con tarjeta guardada',
                    title: `${card.brand ?? 'Tarjeta'} •••• ${card.last4 ?? ''}`,
                    onSelect: () =>
                      setPending({ kind: 'CARD', row: r, card: `${card.brand ?? 'Tarjeta'} •••• ${card.last4 ?? ''}` }),
                  }
                : null,
              r.subscription_id ? { label: 'Ver contrato', to: `/subscriptions/${r.subscription_id}#invoices` } : null,
              r.customer_organization_id ? { label: 'Ver cuenta', to: `/organizations/${r.customer_organization_id}` } : null,
              perms.canManagePlatform && overdue && r.customer_organization_id
                ? { label: 'Suspender por mora', tone: 'danger' as const, onSelect: () => setPending({ kind: 'SUSPEND', row: r }) }
                : null,
            ]}
          />
        );
      },
    },
  ];

  const tabs: Array<{ id: InboxFilter; label: string }> = [
    { id: 'VENCIDA', label: 'Vencidas' },
    { id: 'VIGENTE', label: 'Por vencer' },
    { id: 'ALL', label: 'Todas por cobrar' },
  ];

  return (
    <Card>
      <SearchBar
        value={draft}
        onChange={setDraft}
        placeholder="Buscar por número de factura o cuenta…"
        right={
          <StatusTabs
            label="Vencimiento"
            value={list.filter}
            onChange={list.setFilter}
            options={tabs.map((t) => ({
              ...t,
              count: t.id === list.filter && summary.data ? Number(summary.data.row_count) : undefined,
            }))}
          />
        }
      />
      <FilterTotals
        state={fromQuery(summary, { isEmpty: () => false })}
        onRetry={() => void summary.refetch()}
        items={[
          {
            label: 'Saldo por cobrar',
            amounts: toCurrencyAmounts(summary.data?.receivable),
            emptyLabel: 'Sin saldo',
            hint: 'Total − cobros confirmados de estas facturas, por moneda.',
          },
          {
            label: 'Vencido',
            amounts: toCurrencyAmounts(summary.data?.overdue),
            emptyLabel: 'Nada vencido',
            hint: 'Saldo con vencimiento anterior a hoy.',
          },
        ]}
      />
      <PagedTable
        mobileCards
        label="Facturas por cobrar"
        columns={columns}
        rows={rows}
        rowKey={(r) => r.invoice_id ?? `${r.number}`}
        sortBy={list.sortBy}
        sortDir={list.sortDir}
        onSortChange={list.setSort}
        page={list.page}
        pageSize={list.pageSize}
        total={page.data?.total ?? 0}
        onPageChange={list.setPage}
        onPageSizeChange={list.setPageSize}
        loading={page.isLoading}
        fetching={page.isFetching}
        error={page.error}
        onRetry={() => void page.refetch()}
        emptyTitle={list.filter === 'VENCIDA' ? 'Sin facturas vencidas' : 'Nada por cobrar'}
        emptyDescription={
          list.filter === 'VENCIDA'
            ? 'Ninguna factura visible para tu rol está vencida con saldo pendiente.'
            : 'No hay facturas emitidas con saldo pendiente con estos filtros.'
        }
      />

      {/* Montado aunque se cierre: el enlace generado se muestra después, una sola vez. */}
      {linkFor ? (
        <InvoiceLinkDialog row={linkFor} open={pending?.kind === 'LINK'} onClose={() => setPending(null)} />
      ) : null}

      <ManualPaymentDialog
        invoice={
          pending?.kind === 'PAY' && pending.row.invoice_id
            ? {
                id: pending.row.invoice_id,
                number: pending.row.number ?? '',
                currency: pending.row.currency ?? '',
                outstanding: num(pending.row.balance) ?? 0,
              }
            : null
        }
        onClose={() => setPending(null)}
      />

      <ConfirmDialog
        open={pending?.kind === 'CARD'}
        title="¿Cobrar con la tarjeta guardada?"
        message={
          pending?.kind === 'CARD'
            ? `Se cobrará el saldo de la factura ${pending.row.number ?? ''} (${formatMoney(num(pending.row.balance), pending.row.currency)}) con ${pending.card}, autorizada por el cliente. Si el emisor la rechaza, queda registrado como un intento fallido.`
            : ''
        }
        confirmLabel="Cobrar ahora"
        tone="primary"
        busy={autocharge.isPending}
        onConfirm={chargeCard}
        onCancel={() => setPending(null)}
      />

      {pending?.kind === 'SUSPEND' && pending.row.customer_organization_id ? (
        <MoraSuspension row={pending.row} onClose={() => setPending(null)} />
      ) : null}
    </Card>
  );
}

/** Enlace al portal `/pagar` de la cuenta de la factura, con su correo de facturación. */
function InvoiceLinkDialog({ row, open, onClose }: { row: InvoiceRow; open: boolean; onClose: () => void }) {
  const org = useOrganization(row.customer_organization_id ?? undefined);
  return (
    <GeneratePaymentLinkDialog
      open={open}
      organizationId={row.customer_organization_id ?? ''}
      organizationName={row.organization_name ?? ''}
      billingEmail={(org.data as { billing_email?: string | null } | null | undefined)?.billing_email ?? null}
      reasonHint={`Cobro de la factura ${row.number ?? ''}`}
      onClose={onClose}
    />
  );
}

/** «Suspender por mora»: los tenants PROPIOS de la cuenta, con la vista previa del impacto. */
function MoraSuspension({ row, onClose }: { row: InvoiceRow; onClose: () => void }) {
  const organizationId = row.customer_organization_id as string;
  const tenants = useOrgTenants(organizationId);
  const targets: LifecycleTarget[] = (tenants.data ?? [])
    .filter((t) => t.customer_organization_id === organizationId && t.tenant_id)
    .map((t) => ({
      tenantId: t.tenant_id as string,
      tenantName: (t.name as string) ?? '—',
      productName: (t.product_short_name as string) ?? '—',
      tenantStatus: (t.status as string) ?? 'PENDING',
    }));
  const days = row.days_overdue ?? 0;
  return (
    <LifecycleDialog
      open
      mode="SUSPEND"
      subject={`${row.organization_name ?? 'la cuenta'} por mora`}
      organizationId={organizationId}
      targets={targets}
      loadingTargets={tenants.isLoading}
      defaultReason={`Mora: factura ${row.number ?? ''} vencida hace ${days} ${days === 1 ? 'día' : 'días'}`}
      onClose={onClose}
    />
  );
}
