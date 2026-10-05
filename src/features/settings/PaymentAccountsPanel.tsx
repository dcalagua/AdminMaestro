import { useState } from 'react';
import { useMarkets, useProviderAccountRoutes, useProviderAccounts } from '@/services/queries';
import {
  useClearPaymentProviderSecret, useSetPaymentProviderApiBase, useUpsertProviderAccount,
} from '@/services/mutations';
import { useSearchFilter } from '@/hooks/useSearchFilter';
import { usePermissions } from '@/hooks/usePermissions';
import { formatDate } from '@/lib/format';
import {
  Badge, Card, DataTable, EmptyState, ErrorState, LoadingState, SearchBar,
} from '@/components/ui/primitives';
import { FormDialog } from '@/components/ui/FormDialog';
import { RevokeWithReasonDialog } from '@/components/ui/RevokeWithReasonDialog';
import { CheckboxField, FieldRow, NumberField, SelectField, TextField } from '@/components/ui/fields';
import { useToast } from '@/components/ui/toast-context';
import {
  normalizeApiBaseUrl, validateProviderAccount, type DraftErrors, type ProviderAccountDraft,
} from './providerAccountForm';
import { ProviderSecretDialog, type SecretTarget } from './ProviderSecretDialog';

/**
 * Configuración → «Cuentas de pago» (finanzas). Spec §2.5 y §11.
 *
 * Ficha de la cuenta con `upsert_payment_provider_account` (+ URL de la API con
 * `set_payment_provider_api_base`). La llave SECRETA (`sk_`) se gestiona aparte
 * —«Configurar llave», «Reemplazar», «Quitar»— y se guarda CIFRADA en el servidor
 * (Supabase Vault): esta pantalla solo vuelve a ver su pista (`sk_test_…abcd`).
 * La variable de entorno (`secret_key_ref`) queda como opción avanzada.
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
  apiBaseUrl: '',
  routingPriority: '100',
  status: 'ACTIVE',
  hasEncryptedKey: false,
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
  secret_hint: string | null;
  secret_set_at: string | null;
  api_base_url: string | null;
};

type ClearTarget = { id: string; code: string; environment: string };

export function PaymentAccountsPanel() {
  const routes = useProviderAccountRoutes();
  const accounts = useProviderAccounts();
  const markets = useMarkets();
  const upsert = useUpsertProviderAccount();
  const setApiBase = useSetPaymentProviderApiBase();
  const clearSecret = useClearPaymentProviderSecret();
  const toast = useToast();
  // La RPC vuelve a decidir: esto solo evita ofrecer acciones que la base rechazaría.
  const canConfigure = usePermissions().canReadFinance;

  const [secretTarget, setSecretTarget] = useState<SecretTarget | null>(null);
  const [clearTarget, setClearTarget] = useState<ClearTarget | null>(null);

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
      apiBaseUrl: a?.api_base_url ?? '',
      routingPriority: String(r.routing_priority ?? 100),
      status: (r.status ?? 'ACTIVE') as ProviderAccountDraft['status'],
      hasEncryptedKey: Boolean(a?.secret_hint),
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
      const id = await upsert.mutateAsync({
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
      // La URL de la API no la reescribe el upsert: va por su propia RPC (auditada).
      const apiBase = normalizeApiBaseUrl(draft.apiBaseUrl);
      if (apiBase !== (previous?.api_base_url ?? null)) {
        await setApiBase.mutateAsync({ p_account_id: id, p_api_base_url: apiBase ?? '' });
      }
      toast.success(draft.id ? 'Cuenta actualizada' : 'Cuenta creada', draft.code);
      setDraft(null);
    } catch (error) {
      setServerError(error);
    }
  }

  const rows = filtered;

  async function clear(reason: string) {
    if (!clearTarget) return;
    await clearSecret.mutateAsync({ p_account_id: clearTarget.id, p_reason: reason });
    toast.success('Llave quitada', clearTarget.code);
    setClearTarget(null);
  }

  function keyCell(r: NonNullable<typeof routes.data>[number], a: FullAccount | undefined) {
    if (r.provider_kind !== 'CULQI') return <span className="text-xs text-muted">No aplica</span>;
    const target: SecretTarget = {
      id: r.provider_account_id as string,
      code: r.code ?? '',
      environment: (r.environment ?? 'TEST') as SecretTarget['environment'],
      hint: a?.secret_hint ?? null,
    };
    return (
      <div className="space-y-1">
        {a?.secret_hint ? (
          <div className="flex flex-wrap items-center gap-1 text-xs">
            <Badge tone="ok">Configurada</Badge>
            <span className="font-mono">({a.secret_hint})</span>
            <span className="text-muted">· {formatDate(a.secret_set_at)}</span>
          </div>
        ) : a?.secret_key_ref ? (
          <div className="flex flex-wrap items-center gap-1 text-xs">
            <Badge tone="info">Variable de entorno</Badge>
            <span className="font-mono">{a.secret_key_ref}</span>
          </div>
        ) : (
          <Badge tone="warn">
            {r.environment === 'LIVE' ? 'No configurada · no cobra' : 'No configurada · modo de prueba (MOCK)'}
          </Badge>
        )}
        {canConfigure ? (
          <div className="flex gap-3">
            <button type="button" className="ebim-link text-[13px]" onClick={() => setSecretTarget(target)}>
              {a?.secret_hint ? 'Reemplazar' : 'Configurar llave'}
            </button>
            {a?.secret_hint ? (
              <button
                type="button"
                className="ebim-link text-[13px]"
                onClick={() => setClearTarget({ id: target.id, code: target.code, environment: target.environment })}
              >
                Quitar
              </button>
            ) : null}
          </div>
        ) : null}
      </div>
    );
  }

  return (
    <Card
      title="Cuentas de pago"
      description="Cuentas de cobro por mercado y moneda. La llave secreta de Culqi se configura aquí y se guarda cifrada en el servidor: nunca vuelve a mostrarse, solo su pista."
      actions={
        canConfigure ? (
          <button type="button" className="ebim-btn-primary h-8 px-3 text-xs" onClick={openNew}>
            Nueva cuenta
          </button>
        ) : undefined
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
        <DataTable columns={['Cuenta', 'Tipo', 'Entorno', 'Mercado', 'Monedas', 'Prioridad', 'Llave pública', 'Llave secreta', 'Estado', '']}>
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
                <td className="ebim-td">{keyCell(r, a)}</td>
                <td className="ebim-td">
                  <Badge tone={r.status === 'ACTIVE' ? 'ok' : 'neutral'}>{STATUS_LABEL[r.status as string] ?? r.status}</Badge>
                </td>
                <td className="ebim-td text-right">
                  {canConfigure ? (
                    <button type="button" className="ebim-link text-[13px]" onClick={() => openEdit(r)}>
                      Editar
                    </button>
                  ) : null}
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
        description="La llave secreta no va en esta ficha: tras guardar, usa «Configurar llave» en la lista. Se guarda cifrada en el servidor."
        busy={upsert.isPending || setApiBase.isPending}
        error={serverError}
        onCancel={() => setDraft(null)}
        onSubmit={() => void save()}
      >
        {draft ? (
          <>
            {draft.environment === 'LIVE' ? (
              <p className="rounded-lg bg-warn-soft px-3 py-2 text-sm text-warn" role="note">
                Cuenta <strong>LIVE</strong>: cobra dinero real. Además exige <span className="font-mono">CULQI_ALLOW_LIVE=true</span>{' '}
                en el servidor y autorización explícita del operador. Una cuenta nueva se crea <strong>Inactiva</strong>, se le
                configura la llave y después se activa.
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
            {draft.providerKind === 'CULQI' ? (
              <>
                <TextField
                  label="URL de la API (opcional)"
                  value={draft.apiBaseUrl}
                  autoComplete="off"
                  spellCheck={false}
                  placeholder="https://api.culqi.com/v2"
                  error={errors.apiBaseUrl ? { message: errors.apiBaseUrl } : undefined}
                  onChange={(e) => set('apiBaseUrl', e.target.value)}
                  hint="URL base de la API de Culqi (verificada: https://api.culqi.com/v2). Vacía = la que defina el servidor (CULQI_API_BASE); si tampoco existe, la cuenta opera en modo de prueba (MOCK)."
                />
                <TextField
                  label="Variable de entorno (avanzado, opcional)"
                  value={draft.secretKeyRef}
                  autoComplete="off"
                  spellCheck={false}
                  error={errors.secretKeyRef ? { message: errors.secretKeyRef } : undefined}
                  onChange={(e) => set('secretKeyRef', e.target.value)}
                  hint="Déjala vacía: la llave se configura con «Configurar llave» y se guarda cifrada. Solo si la llave vive como variable del servidor, escribe su NOMBRE (ej. CULQI_SECRET_KEY); la llave cifrada tiene prioridad."
                />
              </>
            ) : null}
            <SelectField
              label="Estado"
              value={draft.status}
              error={errors.status ? { message: errors.status } : undefined}
              onChange={(e) => set('status', e.target.value as ProviderAccountDraft['status'])}
              options={Object.entries(STATUS_LABEL).map(([value, label]) => ({ value, label }))}
            />
          </>
        ) : null}
      </FormDialog>

      <ProviderSecretDialog target={secretTarget} onClose={() => setSecretTarget(null)} />

      <RevokeWithReasonDialog
        open={Boolean(clearTarget)}
        title="Quitar llave secreta"
        description={
          clearTarget?.environment === 'LIVE'
            ? `Se borra del servidor la llave cifrada de ${clearTarget.code}. Una cuenta LIVE activa no puede quedarse sin llave: desactívala antes o reemplaza la llave.`
            : `Se borra del servidor la llave cifrada de ${clearTarget?.code ?? ''}. Sin llave, la cuenta TEST opera en modo de prueba (MOCK).`
        }
        submitLabel="Quitar llave"
        busy={clearSecret.isPending}
        onSubmit={clear}
        onCancel={() => setClearTarget(null)}
      />
    </Card>
  );
}
