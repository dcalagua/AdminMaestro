import { useMemo, useRef, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { XIcon } from '@phosphor-icons/react';
import { useSubscriptions } from '@/services/queries';
import { usePermissions } from '@/hooks/usePermissions';
import { ErrorState, LoadingState } from '@/components/ui/primitives';
import { useModalFocus } from '@/components/ui/useModalFocus';
import { Combobox } from '@/components/ui/Combobox';
import { PeriodInvoiceFields } from './PeriodInvoiceAction';
import { usePeriodInvoice } from './periodInvoice';
import { ISSUE_INVOICE_PARAM } from '@/app/paletteActions';

/**
 * «Emitir factura» como acción primaria de Cobranza (V5 · F4). Antes sólo
 * existía dentro de cada contrato; aquí se elige el contrato y el período y se
 * reutiliza la MISMA lógica (`usePeriodInvoice` → `issue_subscription_invoice`):
 * la base decide los cargos del período y no duplica una factura ya emitida.
 *
 * Sólo contratos que EBIM factura (los que factura el partner no aparecen) y
 * en un estado facturable, igual que en la ficha del contrato.
 */
export function IssueInvoiceAction() {
  const perms = usePermissions();
  const [params, setParams] = useSearchParams();
  // ⌘K «Emitir factura…» (V5 · F5) llega con `?accion=emitir-factura`: el diálogo se abre solo.
  const requested = params.get('accion') === ISSUE_INVOICE_PARAM;
  const [open, setOpen] = useState(false);
  if (!perms.canReadFinance) return null;
  const close = () => {
    setOpen(false);
    if (requested) {
      setParams(
        (current) => {
          const next = new URLSearchParams(current);
          next.delete('accion');
          return next;
        },
        { replace: true, preventScrollReset: true },
      );
    }
  };
  return (
    <>
      <button type="button" className="ebim-btn-primary" onClick={() => setOpen(true)}>
        Emitir factura
      </button>
      {open || requested ? <IssueInvoiceDialog onClose={close} /> : null}
    </>
  );
}

const BILLABLE = new Set(['ACTIVE', 'PAST_DUE']);

type SubscriptionOption = {
  id: string;
  code: string;
  currency: string;
  status: string;
  billing_channel: string | null;
  organizations: { display_name: string | null } | null;
  saas_products: { short_name: string | null } | null;
};

export function IssueInvoiceDialog({ onClose }: { onClose: () => void }) {
  const ref = useRef<HTMLDivElement>(null);
  const subs = useSubscriptions();
  const [selected, setSelected] = useState('');
  const [listOpen, setListOpen] = useState(false);
  const [issued, setIssued] = useState<{ number: string; subscriptionId: string } | null>(null);
  // Escape cierra primero la lista del buscador; con la lista cerrada, el diálogo.
  useModalFocus(ref, true, { onEscape: onClose, canEscape: () => !listOpen });

  const billable = useMemo(
    () =>
      ((subs.data ?? []) as unknown as SubscriptionOption[]).filter(
        (s) => BILLABLE.has(s.status) && s.billing_channel !== 'PARTNER_STATEMENT',
      ),
    [subs.data],
  );
  const subscription = billable.find((s) => s.id === selected);
  const period = usePeriodInvoice({
    subscriptionId: subscription?.id,
    currency: subscription?.currency ?? '',
    onIssued: (r) => subscription && setIssued({ number: r?.number ?? '', subscriptionId: subscription.id }),
  });

  return (
    <div className="ebim-scrim fixed inset-0 z-50 flex items-start justify-center overflow-y-auto p-4 sm:py-10">
      <div
        ref={ref}
        role="dialog"
        aria-modal="true"
        aria-labelledby="issue-invoice-title"
        aria-describedby="issue-invoice-desc"
        className="ebim-dialog w-full max-w-[640px]"
      >
        <header className="flex items-start justify-between gap-4 px-6 pt-6">
          <div className="min-w-0">
            <h2 id="issue-invoice-title" className="text-h2 text-fg">
              Emitir factura
            </h2>
            <p id="issue-invoice-desc" className="mt-1 text-compact text-fg-2">
              Elige el contrato y el período. Se facturan los cargos que tocan en ese período; si la factura del período
              ya existe, se reutiliza.
            </p>
          </div>
          <button type="button" className="ebim-icon-btn -mr-2 -mt-1" aria-label="Cerrar" title="Cerrar" onClick={onClose}>
            <XIcon size={18} aria-hidden />
          </button>
        </header>

        <div className="grid gap-4 px-6 py-5">
          {subs.isLoading ? (
            <LoadingState label="Leyendo contratos…" />
          ) : subs.error ? (
            <ErrorState error={subs.error} onRetry={() => void subs.refetch()} />
          ) : billable.length === 0 ? (
            <p className="text-compact text-fg-2">No hay contratos activos que EBIM facture.</p>
          ) : (
            <Combobox
              label="Contrato"
              listLabel="Contratos facturables"
              placeholder="Busca por cuenta, app o código del contrato…"
              emptyText="Ningún contrato coincide"
              options={billable}
              value={selected}
              getKey={(s) => s.id}
              getText={(s) => `${optionLabel(s)} · ${s.code}`}
              searchText={(s) => [s.code, s.organizations?.display_name, s.saas_products?.short_name]}
              renderPrimary={optionLabel}
              renderSecondary={(s) => (
                <>
                  <span className="font-mono">{s.code}</span> · {s.currency}
                </>
              )}
              onOpenChange={setListOpen}
              onChange={(v) => {
                setSelected(v);
                setIssued(null);
              }}
            />
          )}
          {subscription ? (
            <div data-issue-period>
              <PeriodInvoiceFields key={subscription.id} state={period} />
            </div>
          ) : null}
        </div>

        {/* V6: la acción primaria a la derecha y desactivada hasta que es válida; cerrar es secundario. */}
        <footer className="flex flex-wrap items-center justify-end gap-2 border-t border-border px-6 py-4">
          {issued ? (
            <Link className="ebim-btn-ghost mr-auto" to={`/subscriptions/${issued.subscriptionId}#invoices`} onClick={onClose}>
              Ver {issued.number || 'la factura'} en el contrato
            </Link>
          ) : null}
          <button type="button" className="ebim-btn-secondary" onClick={onClose}>
            {issued ? 'Cerrar' : 'Cancelar'}
          </button>
          <button
            type="button"
            className="ebim-btn-primary"
            disabled={!subscription || period.disabled}
            title={subscription ? undefined : 'Elige primero el contrato'}
            onClick={() => void period.issue()}
          >
            {period.pending ? 'Emitiendo…' : subscription ? `Emitir factura (${subscription.currency})` : 'Emitir factura'}
          </button>
        </footer>
      </div>
    </div>
  );
}

const optionLabel = (s: SubscriptionOption) =>
  `${s.organizations?.display_name ?? 'Sin cuenta'} · ${s.saas_products?.short_name ?? '—'}`;
