import { useState } from 'react';
import { useMarkets, useProviderAccountRoutes, useProviderAccounts } from '@/services/queries';
import { useUpsertProviderAccount } from '@/services/mutations';
import { useSearchFilter } from '@/hooks/useSearchFilter';
import {
  Badge, Card, DataTable, EmptyState, ErrorState, LoadingState, SearchBar,
} from '@/components/ui/primitives';
import { FormDialog } from '@/components/ui/FormDialog';
import { CheckboxField, FieldRow, NumberField, SelectField, TextField } from '@/components/ui/fields';
import { useToast } from '@/components/ui/toast-context';
import { validateProviderAccount, type DraftErrors, type ProviderAccountDraft } from './providerAccountForm';

/**
 * Configuración → «Cuentas de pago» (finanzas). Spec §2.5.
 *
 * Alta y edición con `upsert_payment_provider_account`. Aquí solo viven la llave
 * PÚBLICA (`pk_`, la usa el Checkout del navegador) y el NOMBRE del secret del
 * servidor. La clave secreta (`sk_`) nunca se escribe en esta pantalla: se carga
 * con `supabase secrets set <NOMBRE>=…` en el servidor.
 */

const KIND_LABEL: Record<string, string> = {
  CULQI: 'Culqi (tarjeta)',
  BANK: 'Banco (transferencia)',
  MANUAL: 'Manual',
  OTHER: 'Otro',
};
const STATUS_LABEL: Record<string, string> = {
  ACTIVE: 'Activa',
  INACTIVE: 'Inactiva',
  SUSPENDED: 'Suspendida',
  ARCHIVED: 'Archivada',
};

const EMPTY: ProviderAccountDraft = {
  id: null,
  code: '',
  name: '',
  providerKind: 'CULQI',
  environment: 'TEST',
  marketCode: '',
  currencies: [],
  publicKey: '',
  secretKeyRef: '',
  routingPriority: '100',
  status: 'ACTIVE',
};

type FullAccount = {
  id: string;
  public_key: string | null;
  secret_key_ref: string | null;
  owner_organization_id: string | null;
  rsa_public_key_ref: string | null;
  rsa_id_ref: string | null;
  webhook_endpoint: string | null;
  metadata: unknown;
};

export function PaymentAccountsPanel() {
  const routes = useProviderAccountRoutes();
  const accounts = useProviderAccounts();
  const markets = useMarkets();
  const upsert = useUpsertProviderAccount();
  const toast = useToast();

  const [draft, setDraft] = useState<ProviderAccountDraft | null>(null);
  const [errors, setErrors] = useState<DraftErrors>({});
  const [serverError, setServerError] = useState<unknown>(null);

  const { term, setTerm, filtered } = useSearchFilter(routes.data, (r) => [r.code, r.name, r.market_code, r.provider_kind]);
  const full = new Map(((accounts.data ?? []) as unknown as FullAccount[]).map((a) => [a.id, a]));

  const marketOptions = markets.data ?? [];
  const selectedMarket = marketOptions.find((m) => m.code === draft?.marketCode);
  const currencyOptions = selectedMarket?.allowedCurrencies ?? [];

  function openNew() {
    setDraft({ ...EMPTY });
    setErrors({});
    setServerError(null);
  }

  function openEdit(r: NonNullable<typeof routes.data>[number]) {
    const a = full.get(r.provider_account_id as string);
    setDraft({
      id: r.provider_account_id as string,
      code: r.code ?? '',
      name: r.name ?? '',
      providerKind: (r.provider_kind ?? 'CULQI') as ProviderAccountDraft['providerKind'],
      environment: (r.environment ?? 'TEST') as ProviderAccountDraft['environment'],
      marketCode: r.market_code ?? '',
      currencies: r.currencies ?? [],
      publicKey: a?.public_key ?? '',
      secretKeyRef: a?.secret_key_ref ?? '',
      routingPriority: String(r.routing_priority ?? 100),
      status: (r.status ?? 'ACTIVE') as ProviderAccountDraft['status'],
    });
    setErrors({});
    setServerError(null);
  }

  function set<K extends keyof ProviderAccountDraft>(key: K, value: ProviderAccountDraft[K]) {
    setDraft((d) => (d ? { ...d, [key]: value } : d));
  }

  async function save() {
    if (!draft) return;
    const found = validateProviderAccount(draft);
    setErrors(found);
    if (Object.keys(found).length > 0) return;
    const previous = draft.id ? full.get(draft.id) : undefined;
    try {
      await upsert.mutateAsync({
        p_id: draft.id ?? undefined,
        p_code: draft.code.trim(),
        p_name: draft.name.trim(),
        p_provider_kind: draft.providerKind,
        p_environment: draft.environment,
        p_market_code: draft.marketCode,
        p_currencies: draft.currencies,
        p_public_key: draft.publicKey.trim() || undefined,
        p_secret_key_ref: draft.secretKeyRef.trim() || undefined,
        p_routing_priority: Number(draft.routingPriority),
        p_status: draft.status,
        // La RPC reescribe la fila completa: se conservan los campos que esta
        // pantalla no edita.
        p_owner_organization_id: previous?.owner_organization_id ?? undefined,
        p_rsa_public_key_ref: previous?.rsa_public_key_ref ?? undefined,
        p_rsa_id_ref: previous?.rsa_id_ref ?? undefined,
        p_webhook_endpoint: previous?.webhook_endpoint ?? undefined,
        p_metadata: (previous?.metadata as never) ?? undefined,
      });
      toast.success(draft.id ? 'Cuenta actualizada' : 'Cuenta creada', draft.code);
      setDraft(null);
    } catch (error) {
      setServerError(error);
    }
  }

  const rows = filtered;

  return (
    <Card
      title="Cuentas de pago"
      description="Cuentas de cobro por mercado y moneda. Aquí solo se guardan la llave pública y el NOMBRE del secret del servidor: la clave secreta nunca pasa por el navegador."
      actions={
        <button type="button" className="ebim-btn-primary h-8 px-3 text-xs" onClick={openNew}>
          Nueva cuenta
        </button>
      }
    >
      <SearchBar value={term} onChange={setTerm} placeholder="Buscar por código, nombre, mercado o tipo…" />
      {routes.isLoading || accounts.isLoading ? (
        <LoadingState />
      ) : routes.error ? (
        <ErrorState error={routes.error} onRetry={() => void routes.refetch()} />
      ) : rows.length === 0 ? (
        <EmptyState title="Sin cuentas de pago" description="Crea la cuenta del proveedor para el mercado que vas a cobrar." />
      ) : (
        <DataTable columns={['Cuenta', 'Tipo', 'Entorno', 'Mercado', 'Monedas', 'Prioridad', 'Llave pública', 'Secreto del servidor', 'Estado', '']}>
          {rows.map((r) => {
            const a = full.get(r.provider_account_id as string);
            return (
              <tr key={r.provider_account_id as string}>
                <td className="ebim-td">
                  <div className="font-semibold">{r.name}</div>
                  <div className="font-mono text-xs text-muted">{r.code}</div>
                </td>
                <td className="ebim-td text-xs">{KIND_LABEL[r.provider_kind as string] ?? r.provider_kind}</td>
                <td className="ebim-td">
                  <Badge tone={r.environment === 'LIVE' ? 'warn' : 'info'}>
                    {r.environment === 'LIVE' ? 'LIVE · cobra dinero real' : 'TEST'}
                  </Badge>
                </td>
                <td className="ebim-td text-xs">{r.market_code ?? '—'}</td>
                <td className="ebim-td text-xs">{(r.currencies ?? []).join(', ') || '—'}</td>
                <td className="ebim-td tabular-nums">{r.routing_priority}</td>
                <td className="ebim-td">
                  {a?.public_key ? <Badge tone="ok">Configurada</Badge> : <Badge tone="warn">Pendiente</Badge>}
                </td>
                <td className="ebim-td font-mono text-xs">
                  {a?.secret_key_ref ?? <span className="font-sans text-muted">sin referencia</span>}
                </td>
                <td className="ebim-td">
                  <Badge tone={r.status === 'ACTIVE' ? 'ok' : 'neutral'}>{STATUS_LABEL[r.status as string] ?? r.status}</Badge>
                </td>
                <td className="ebim-td text-right">
                  <button type="button" className="ebim-link text-[13px]" onClick={() => openEdit(r)}>
                    Editar
                  </button>
                </td>
              </tr>
            );
          })}
        </DataTable>
      )}

      <FormDialog
        open={Boolean(draft)}
        wide
        title={draft?.id ? 'Editar cuenta de pago' : 'Nueva cuenta de pago'}
        description="La clave secreta NO se escribe aquí. Se carga en el servidor con «supabase secrets set NOMBRE=…» y en esta ficha solo se indica ese NOMBRE."
        busy={upsert.isPending}
        error={serverError}
        onCancel={() => setDraft(null)}
        onSubmit={() => void save()}
      >
        {draft ? (
          <>
            {draft.environment === 'LIVE' ? (
              <p className="rounded-lg bg-warn-soft px-3 py-2 text-sm text-warn" role="note">
                Cuenta <strong>LIVE</strong>: cobra dinero real. Además exige <span className="font-mono">CULQI_ALLOW_LIVE=true</span>{' '}
                en el servidor y autorización explícita del operador.
              </p>
            ) : null}
            <FieldRow>
              <TextField label="Código" required value={draft.code} error={errors.code ? { message: errors.code } : undefined}
                onChange={(e) => set('code', e.target.value)} hint="Ej. culqi-pe-test" />
              <TextField label="Nombre" required value={draft.name} error={errors.name ? { message: errors.name } : undefined}
                onChange={(e) => set('name', e.target.value)} />
            </FieldRow>
            <FieldRow>
              <SelectField
                label="Tipo"
                value={draft.providerKind}
                onChange={(e) => set('providerKind', e.target.value as ProviderAccountDraft['providerKind'])}
                options={Object.entries(KIND_LABEL).map(([value, label]) => ({ value, label }))}
              />
              <SelectField
                label="Entorno"
                value={draft.environment}
                onChange={(e) => set('environment', e.target.value as ProviderAccountDraft['environment'])}
                options={[
                  { value: 'TEST', label: 'TEST (pruebas)' },
                  { value: 'LIVE', label: 'LIVE (dinero real)' },
                ]}
              />
            </FieldRow>
            <FieldRow>
              <SelectField
                label="Mercado"
                required
                value={draft.marketCode}
                placeholder="Elige un mercado…"
                error={errors.marketCode ? { message: errors.marketCode } : undefined}
                onChange={(e) => setDraft((d) => (d ? { ...d, marketCode: e.target.value, currencies: [] } : d))}
                options={marketOptions.map((m) => ({ value: m.code, label: `${m.name} (${m.code})` }))}
              />
              <NumberField
                label="Prioridad de ruta"
                value={draft.routingPriority}
                error={errors.routingPriority ? { message: errors.routingPriority } : undefined}
                onChange={(e) => set('routingPriority', e.target.value)}
                hint="Menor = preferida entre cuentas del mismo mercado."
              />
            </FieldRow>
            <fieldset>
              <legend className="ebim-label">Monedas que cobra</legend>
              {currencyOptions.length === 0 ? (
                <p className="text-xs text-muted">Elige primero el mercado.</p>
              ) : (
                <div className="flex flex-wrap gap-4">
                  {currencyOptions.map((c) => (
                    <CheckboxField
                      key={c}
                      label={c}
                      checked={draft.currencies.includes(c)}
                      onChange={(e) =>
                        set('currencies', e.target.checked ? [...draft.currencies, c] : draft.currencies.filter((x) => x !== c))
                      }
                    />
                  ))}
                </div>
              )}
              {errors.currencies ? <p className="mt-1 text-xs text-danger" role="alert">{errors.currencies}</p> : null}
            </fieldset>
            <TextField
              label="Llave pública"
              value={draft.publicKey}
              autoComplete="off"
              spellCheck={false}
              error={errors.publicKey ? { message: errors.publicKey } : undefined}
              onChange={(e) => set('publicKey', e.target.value)}
              hint="pk_test_… o pk_live_…. Es pública por diseño: la usa el Checkout para tokenizar la tarjeta."
            />
            <TextField
              label="Nombre del secret del servidor"
              value={draft.secretKeyRef}
              autoComplete="off"
              spellCheck={false}
              error={errors.secretKeyRef ? { message: errors.secretKeyRef } : undefined}
              onChange={(e) => set('secretKeyRef', e.target.value)}
              hint="Solo el NOMBRE (ej. CULQI_SECRET_KEY). El valor se carga con «supabase secrets set CULQI_SECRET_KEY=…»; sin él la cuenta opera en modo de prueba (MOCK)."
            />
            <SelectField
              label="Estado"
              value={draft.status}
              onChange={(e) => set('status', e.target.value as ProviderAccountDraft['status'])}
              options={Object.entries(STATUS_LABEL).map(([value, label]) => ({ value, label }))}
            />
          </>
        ) : null}
      </FormDialog>
    </Card>
  );
}
