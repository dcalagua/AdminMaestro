import { useState } from 'react';
import { useMarkets, useProviderAccountRoutes, useProviderAccounts } from '@/services/queries';
import {
  useClearPaymentProviderSecret, useSetPaymentProviderApiBase, useUpsertProviderAccount,
} from '@/services/mutations';
import { useSearchFilter } from '@/hooks/useSearchFilter';
import { usePermissions } from '@/hooks/usePermissions';
import { formatDate } from '@/lib/format';
import { LockKeyIcon, LockKeyOpenIcon } from '@phosphor-icons/react';
import {
  Badge, Card, EmptyState, ErrorState, LoadingState, SearchBar,
} from '@/components/ui/primitives';
import { Avatar } from '@/components/ui/Avatar';
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

  /**
   * Estado de la llave secreta, protagonista de la tarjeta: cifrada en el
   * servidor (pista + fecha), por variable de entorno, o sin configurar (en
   * TEST se cobra en MOCK; en LIVE no se cobra). El valor nunca llega aquí.
   */
  function keyBlock(r: NonNullable<typeof routes.data>[number], a: FullAccount | undefined) {
    if (r.provider_kind !== 'CULQI') {
      return (
        <div className="flex items-center gap-3 rounded-field border border-border bg-sunken px-3 py-2.5">
          <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-card text-muted">
            <LockKeyOpenIcon size={16} aria-hidden />
          </span>
          <p className="text-compact text-fg-2">
            <span className="font-semibold text-fg">Llave secreta:</span> <span className="text-muted">No aplica</span>
            <span className="block text-caption text-muted">Este medio no usa llave de API.</span>
          </p>
        </div>
      );
    }
    const target: SecretTarget = {
      id: r.provider_account_id as string,
      code: r.code ?? '',
      environment: (r.environment ?? 'TEST') as SecretTarget['environment'],
      hint: a?.secret_hint ?? null,
    };
    const state = a?.secret_hint ? 'vault' : a?.secret_key_ref ? 'env' : 'missing';
    const tone =
      state === 'vault'
        ? 'border-transparent bg-ok-soft text-ok'
        : state === 'env'
          ? 'border-transparent bg-info-soft text-info'
          : 'border-transparent bg-warn-soft text-warn';
    const Icon = state === 'missing' ? LockKeyOpenIcon : LockKeyIcon;
    return (
      <div className={`rounded-field border px-3 py-2.5 ${tone}`} data-secret-state={state}>
        <div className="flex items-start gap-3">
          <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-card">
            <Icon size={16} weight="bold" aria-hidden />
          </span>
          <div className="min-w-0 flex-1 text-compact text-fg">
            <p className="text-micro">Llave secreta</p>
            {state === 'vault' ? (
              <p className="flex flex-wrap items-baseline gap-x-1.5">
                <Badge tone="ok">Configurada</Badge>
                <span className="font-semibold">Cifrada en el servidor</span>
                <span className="font-mono text-caption">({a!.secret_hint})</span>
                <span className="text-caption text-fg-2">· desde {formatDate(a!.secret_set_at)}</span>
              </p>
            ) : state === 'env' ? (
              <p className="flex flex-wrap items-baseline gap-x-1.5">
                <Badge tone="info">Variable de entorno</Badge>
                <span className="font-mono text-caption">{a!.secret_key_ref}</span>
              </p>
            ) : (
              <p className="font-semibold">
                {r.environment === 'LIVE' ? 'No configurada · no cobra' : 'No configurada · modo de prueba (MOCK)'}
              </p>
            )}
          </div>
        </div>
        {canConfigure ? (
          <div className="mt-2 flex gap-2 pl-11">
            <button type="button" className="ebim-btn-secondary ebim-btn-sm" onClick={() => setSecretTarget(target)}>
              {a?.secret_hint ? 'Reemplazar' : 'Configurar llave'}
            </button>
            {a?.secret_hint ? (
              <button
                type="button"
                className="ebim-btn-ghost ebim-btn-sm text-danger"
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
          <button type="button" className="ebim-btn-primary ebim-btn-sm" onClick={openNew}>
            Nueva cuenta
          </button>
        ) : undefined
      }
    >
      <SearchBar value={term} onChange={setTerm} placeholder="Buscar por código, nombre, mercado o tipo…" />
      {routes.isLoading || accounts.isLoading ? (
        <LoadingState variant="card" />
      ) : routes.error ? (
        <ErrorState error={routes.error} onRetry={() => void routes.refetch()} />
      ) : rows.length === 0 ? (
        <EmptyState title="Sin cuentas de pago" description="Crea la cuenta del proveedor para el mercado que vas a cobrar." />
      ) : (
        <ul className="grid gap-4 p-5 xl:grid-cols-2" aria-label="Cuentas de pago">
          {rows.map((r) => {
            const a = full.get(r.provider_account_id as string);
            return (
              <li
                key={r.provider_account_id as string}
                className="flex min-w-0 flex-col gap-3 rounded-card border border-border bg-card p-4"
                data-account={r.code}
              >
                <div className="flex items-start gap-3">
                  <Avatar name={r.name ?? r.code ?? '—'} size="md" />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-h3 text-fg">{r.name}</p>
                    <p className="font-mono text-caption text-muted">{r.code}</p>
                  </div>
                  <div className="flex shrink-0 flex-col items-end gap-1">
                    <Badge tone={r.status === 'ACTIVE' ? 'ok' : 'neutral'} dot>
                      {STATUS_LABEL[r.status as string] ?? r.status}
                    </Badge>
                    <Badge tone={r.environment === 'LIVE' ? 'warn' : 'info'}>
                      {r.environment === 'LIVE' ? 'LIVE · cobra dinero real' : 'TEST'}
                    </Badge>
                  </div>
                </div>

                <dl className="grid grid-cols-2 gap-x-4 gap-y-2 text-compact sm:grid-cols-4">
                  <div className="min-w-0">
                    <dt className="text-caption text-muted">Tipo</dt>
                    <dd className="truncate text-fg">{KIND_LABEL[r.provider_kind as string] ?? r.provider_kind}</dd>
                  </div>
                  <div className="min-w-0">
                    <dt className="text-caption text-muted">Mercado · monedas</dt>
                    <dd className="truncate text-fg">
                      {r.market_code ?? '—'} · {(r.currencies ?? []).join(', ') || '—'}
                    </dd>
                  </div>
                  <div>
                    <dt className="text-caption text-muted">Prioridad</dt>
                    <dd className="tabular-nums text-fg">{r.routing_priority}</dd>
                  </div>
                  <div>
                    <dt className="text-caption text-muted">Llave pública</dt>
                    <dd>{a?.public_key ? <Badge tone="ok">Configurada</Badge> : <Badge tone="warn">Pendiente</Badge>}</dd>
                  </div>
                </dl>

                {keyBlock(r, a)}

                {canConfigure ? (
                  <div className="flex justify-end">
                    <button type="button" className="ebim-btn-ghost ebim-btn-sm" onClick={() => openEdit(r)}>
                      Editar
                    </button>
                  </div>
                ) : null}
              </li>
            );
          })}
        </ul>
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
              <p className="rounded-lg bg-warn-soft px-3 py-2 text-body text-warn" role="note">
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
                <p className="text-caption text-muted">Elige primero el mercado.</p>
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
              {errors.currencies ? <p className="mt-1 text-caption text-danger" role="alert">{errors.currencies}</p> : null}
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
