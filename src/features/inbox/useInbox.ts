import { useMemo } from 'react';
import { useAuth } from '@/hooks/useAuth';
import { usePermissions } from '@/hooks/usePermissions';
import { useProvisioningAccess } from '@/hooks/useProvisioningAccess';
import { useNavAccess } from '@/app/useNavAccess';
import {
  useBillingAlerts,
  useProductIntegrations,
  useProducts,
  useProvisioningTargets,
  useReceivedCommercialDocuments,
  useSaasProvisioningRequests,
  useSettlements,
  useTenantOverview,
} from '@/services/queries';
import { useOverdueInvoices } from '@/services/financeRead';
import {
  appHealth,
  suiteApps,
  type IntegrationRow,
  type ProvisioningRow,
  type TargetRow,
  type TenantRow,
} from '@/features/suite/suiteModel';
import {
  buildInbox,
  inboxAudience,
  KIND_LABEL,
  type InboxAlert,
  type InboxDocument,
  type InboxInvoice,
  type InboxItem,
  type InboxKind,
  type InboxSettlement,
} from './inboxModel';
import { useInboxDismissals } from './inboxDismissals';

/** Tope de facturas vencidas que se leen para la bandeja (las más antiguas). */
export const INBOX_INVOICE_LIMIT = 200;

export interface InboxSourceState {
  kind: InboxKind;
  label: string;
  loading: boolean;
  error: unknown;
}

/**
 * Datos de la Bandeja y de la campana (V5 · F5). Reutiliza las consultas de
 * cada pantalla (misma caché, mismo RLS): una acción en Cobranza o en la
 * Suite refresca también la bandeja. Sólo se lee lo que el rol puede ver
 * (`inboxAudience`); el resto de consultas ni se disparan.
 */
export function useInbox() {
  const { roles } = useAuth();
  const access = useNavAccess();
  const perms = usePermissions();
  const prov = useProvisioningAccess();

  const audience = useMemo(
    () =>
      inboxAudience({
        access,
        canManagePlatform: perms.canManagePlatform,
        canManageCommercial: perms.canManageCommercial,
        canReadFinance: perms.canReadFinance,
        hasProvisioningAccess: prov.hasAnyAccess,
      }),
    [access, perms.canManagePlatform, perms.canManageCommercial, perms.canReadFinance, prov.hasAnyAccess],
  );
  const ready = !access.loading;

  const invoices = useOverdueInvoices({ enabled: ready && audience.invoice, limit: INBOX_INVOICE_LIMIT });
  const requests = useSaasProvisioningRequests({ enabled: ready && (audience.alta || audience.confirm) });
  const tenants = useTenantOverview({ enabled: ready && (audience.confirm || audience.health) });
  const products = useProducts({ enabled: ready && audience.health });
  const targets = useProvisioningTargets({ enabled: ready && audience.health });
  const integrations = useProductIntegrations({ enabled: ready && audience.health });
  const alerts = useBillingAlerts('OPEN', { enabled: ready && audience['billing-alert'] });
  const documents = useReceivedCommercialDocuments({ enabled: ready && audience.document });
  const settlements = useSettlements({ enabled: ready && audience.settlement });

  const all = useMemo<InboxItem[]>(() => {
    const now = new Date();
    const tenantRows = (tenants.data ?? []) as TenantRow[];
    const targetRows = (targets.data ?? []) as TargetRow[];
    const integrationRows = (integrations.data ?? []) as unknown as IntegrationRow[];
    const health = audience.health
      ? suiteApps(products.data ?? [], { integrations: integrationRows, targets: targetRows, tenants: tenantRows })
          // Sólo las apps que este perfil puede verificar: lo suyo.
          .filter((app) => prov.canForProduct('platform.deployment.read', app.id))
          .map((app) => appHealth(app, targetRows, integrationRows, now))
      : [];
    return buildInbox(
      {
        invoices: (invoices.data?.rows ?? []) as InboxInvoice[],
        requests: (requests.data ?? []) as ProvisioningRow[],
        tenants: tenantRows,
        health,
        alerts: (alerts.data ?? []) as unknown as InboxAlert[],
        documents: (documents.data ?? []) as unknown as InboxDocument[],
        settlements: (settlements.data ?? []) as unknown as InboxSettlement[],
      },
      audience,
      now,
    );
  }, [audience, prov, invoices.data, requests.data, tenants.data, products.data, targets.data, integrations.data, alerts.data, documents.data, settlements.data]);

  const marks = useInboxDismissals(roles?.userId);
  const items = useMemo(() => all.filter((i) => !marks.done.has(i.key)), [all, marks.done]);
  const done = useMemo(() => all.filter((i) => marks.done.has(i.key)), [all, marks.done]);

  const pick = (kind: InboxKind, ...queries: Array<{ isLoading: boolean; error: unknown }>): InboxSourceState => ({
    kind,
    label: KIND_LABEL[kind],
    loading: queries.some((q) => q.isLoading),
    error: queries.find((q) => q.error)?.error ?? null,
  });
  const sources: InboxSourceState[] = [
    pick('invoice', invoices),
    pick('health', products, targets, integrations),
    pick('alta', requests),
    pick('confirm', requests, tenants),
    pick('billing-alert', alerts),
    pick('document', documents),
    pick('settlement', settlements),
  ].filter((s) => audience[s.kind]);

  return {
    /** Pendientes (sin los marcados como hechos). */
    items,
    /** Marcados como hechos en este navegador y todavía vigentes. */
    done,
    audience,
    sources,
    loading: !ready || sources.some((s) => s.loading),
    /** Hay más facturas vencidas de las que se leyeron. */
    invoicesTruncated: (invoices.data?.total ?? 0) > INBOX_INVOICE_LIMIT,
    dismiss: marks.dismiss,
    restore: marks.restore,
    restoreAll: () => marks.restoreAll(done.map((i) => i.key)),
    persistent: marks.persistent,
  };
}

export type InboxState = ReturnType<typeof useInbox>;
