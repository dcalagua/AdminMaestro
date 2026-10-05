import { useEffect, useMemo, useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { useCommercialCutoverAxes, useUsageIngestCredentials } from '@/services/queries';
import { useConfigureUsageIngestCredential, useSetUsageIngestEnabled } from '@/services/mutations';
import { usePermissions } from '@/hooks/usePermissions';
import { Card, DataTable, LoadingState, ErrorState, EmptyState, Badge } from '@/components/ui/primitives';
import { FormDialog } from '@/components/ui/FormDialog';
import { CheckboxField, FieldRow, SelectField, TextAreaField, TextField } from '@/components/ui/fields';
import { useToast } from '@/components/ui/toast-context';
import { formatDateTime } from '@/lib/format';
import { PROVISIONING_ENVIRONMENT_LABEL } from '@/lib/provisioning';
import { useLookups } from './useLookups';

/**
 * Ingest de uso (CCP fase 17, runbook `docs/runbooks/usage-ingest.md`).
 *
 * Tres interruptores en serie: el flag GLOBAL `USAGE_INGEST_ENABLED` del
 * entorno de la Edge Function (no se gestiona desde aquí), el kill-switch por
 * producto y la credencial (clave PÚBLICA del SaaS, referida por el NOMBRE de
 * una variable de entorno; nunca la clave).
 */

type Credential = NonNullable<ReturnType<typeof useUsageIngestCredentials>['data']>[number];

interface ProductSwitch {
  productId: string;
  productCode: string;
  productName: string;
  integrations: string[];
  enabled: boolean;
}

export function IngestTab() {
  // Read model comercial: finanzas ve el interruptor sin platform.integration.read.
  const integrations = useCommercialCutoverAxes();
  const credentials = useUsageIngestCredentials();
  const lookups = useLookups();
  const perms = usePermissions();
  const [switching, setSwitching] = useState<ProductSwitch | null>(null);
  const [configuring, setConfiguring] = useState<Credential | 'new' | null>(null);
  const canSwitch = perms.canManagePlatform || perms.canReadFinance;

  const switches = useMemo<ProductSwitch[]>(() => {
    const byProduct = new Map<string, ProductSwitch>();
    for (const i of integrations.data ?? []) {
      if (!i.saas_product_id) continue;
      const current = byProduct.get(i.saas_product_id) ?? {
        productId: i.saas_product_id,
        productCode: i.product_code ?? lookups.productCode(i.saas_product_id) ?? '',
        productName: i.product_short_name ?? lookups.productName(i.saas_product_id),
        integrations: [],
        enabled: false,
      };
      if (i.integration_code) current.integrations.push(i.integration_code);
      current.enabled = current.enabled || i.usage_ingest_enabled === true;
      byProduct.set(i.saas_product_id, current);
    }
    return Array.from(byProduct.values()).sort((a, b) => a.productName.localeCompare(b.productName));
  }, [integrations.data, lookups]);

  return (
    <div className="space-y-4">
      <div role="note" className="rounded-lg border border-warn bg-warn-soft px-4 py-3 text-body text-fg">
        <strong>Interruptor global fuera de la consola.</strong> <code className="font-mono">USAGE_INGEST_ENABLED</code> es
        una variable de entorno de la Edge Function <code className="font-mono">usage-ingest</code> y está apagada hasta
        que se apruebe <strong>D-12</strong> (credencial por producto + validación del alta del tenant). Encender un
        producto aquí no recibe eventos mientras ese flag siga apagado.
      </div>

      <Card
        title="Interruptor por producto"
        description="Kill-switch de product_integrations.usage_ingest_enabled. Apagarlo corta el ingest de ese producto; el SaaS reintenta y no pierde eventos."
      >
        {integrations.isLoading ? (
          <LoadingState label="Cargando integraciones…" />
        ) : integrations.error ? (
          <ErrorState error={integrations.error} onRetry={() => void integrations.refetch()} />
        ) : switches.length === 0 ? (
          <EmptyState
            title="Sin integraciones visibles"
            description="El interruptor vive en la integración del producto. Si no ves ninguna, tu rol no lee finanzas, lo comercial ni la integración."
          />
        ) : (
          <DataTable columns={['Producto', 'Integraciones', 'Ingest', '']}>
            {switches.map((s) => (
              <tr key={s.productId}>
                <td className="ebim-td">
                  <div className="font-semibold">{s.productName}</div>
                  <div className="font-mono text-caption text-muted">{s.productCode}</div>
                </td>
                <td className="ebim-td font-mono text-caption">{s.integrations.join(', ')}</td>
                <td className="ebim-td">
                  <Badge tone={s.enabled ? 'ok' : 'neutral'}>{s.enabled ? 'Encendido' : 'Apagado'}</Badge>
                </td>
                <td className="ebim-td text-right">
                  {canSwitch && s.productCode ? (
                    <button type="button" className="ebim-link text-compact" onClick={() => setSwitching(s)}>
                      {s.enabled ? 'Apagar ingest' : 'Encender ingest'}
                    </button>
                  ) : null}
                </td>
              </tr>
            ))}
          </DataTable>
        )}
      </Card>

      <Card
        title="Credenciales de ingest"
        description="Clave PÚBLICA ES256 con la que MasterAdmin verifica el JWT de cada SaaS, por producto × ambiente × emisor. Solo se guarda el nombre de la variable de entorno; la clave privada vive en el SaaS."
        actions={
          perms.canManagePlatform ? (
            <button type="button" className="ebim-btn-primary h-8 px-3 text-caption" onClick={() => setConfiguring('new')}>
              Configurar credencial
            </button>
          ) : null
        }
      >
        {credentials.isLoading ? (
          <LoadingState label="Cargando credenciales…" />
        ) : credentials.error ? (
          <ErrorState error={credentials.error} onRetry={() => void credentials.refetch()} />
        ) : (credentials.data ?? []).length === 0 ? (
          <EmptyState
            title="Sin credenciales de ingest"
            description="Ningún producto tiene aún su clave pública registrada (runbook usage-ingest §2, tras D-12)."
          />
        ) : (
          <DataTable columns={['Producto', 'Ambiente', 'Emisor', 'Audiencia', 'kid', 'Estado', 'Actualizada', '']}>
            {(credentials.data ?? []).map((c) => (
              <tr key={c.id}>
                <td className="ebim-td font-semibold">{lookups.productName(c.saas_product_id)}</td>
                <td className="ebim-td text-caption">
                  {PROVISIONING_ENVIRONMENT_LABEL[c.environment as keyof typeof PROVISIONING_ENVIRONMENT_LABEL] ?? c.environment}
                </td>
                <td className="ebim-td font-mono text-caption">{c.issuer}</td>
                <td className="ebim-td font-mono text-caption">{c.audience}</td>
                <td className="ebim-td font-mono text-caption">{c.kid ?? '—'}</td>
                <td className="ebim-td">
                  <Badge tone={c.enabled ? 'ok' : 'neutral'}>{c.enabled ? 'Habilitada' : 'Deshabilitada'}</Badge>
                </td>
                <td className="ebim-td whitespace-nowrap text-caption text-muted">{formatDateTime(c.updated_at)}</td>
                <td className="ebim-td text-right">
                  {perms.canManagePlatform ? (
                    <button type="button" className="ebim-link text-compact" onClick={() => setConfiguring(c)}>
                      Editar
                    </button>
                  ) : null}
                </td>
              </tr>
            ))}
          </DataTable>
        )}
      </Card>

      <IngestSwitchDialog target={switching} onClose={() => setSwitching(null)} />
      <CredentialDialog
        open={configuring !== null}
        credential={configuring === 'new' ? null : configuring}
        productCode={configuring && configuring !== 'new' ? lookups.productCode(configuring.saas_product_id) : null}
        productOptions={lookups.productOptions}
        onClose={() => setConfiguring(null)}
      />
    </div>
  );
}

/* ==========================================================================
   Kill-switch por producto (set_usage_ingest_enabled)
   ========================================================================== */

const reasonSchema = z.object({ reason: z.string().trim().min(3, 'El motivo es obligatorio') });
type ReasonValues = z.input<typeof reasonSchema>;

function IngestSwitchDialog({ target, onClose }: { target: ProductSwitch | null; onClose: () => void }) {
  const toast = useToast();
  const setEnabled = useSetUsageIngestEnabled();
  const form = useForm<ReasonValues>({ resolver: zodResolver(reasonSchema), defaultValues: { reason: '' } });

  useEffect(() => {
    if (!target) return;
    setEnabled.reset();
    form.reset({ reason: '' });
  }, [target]);

  const turningOn = target ? !target.enabled : false;
  const submit = form.handleSubmit(async (values) => {
    if (!target) return;
    const v = reasonSchema.parse(values);
    try {
      await setEnabled.mutateAsync({ p_product_code: target.productCode, p_enabled: turningOn, p_reason: v.reason });
      toast.success(turningOn ? 'Ingest encendido' : 'Ingest apagado', target.productName);
      onClose();
    } catch {
      /* visible en el diálogo */
    }
  });

  return (
    <FormDialog
      open={Boolean(target)}
      title={`${turningOn ? 'Encender' : 'Apagar'} el ingest de ${target?.productName ?? ''}`}
      description={
        turningOn
          ? 'Solo tiene efecto si USAGE_INGEST_ENABLED está encendido en el entorno (D-12) y el producto tiene credencial habilitada.'
          : 'Efecto inmediato para este producto. El SaaS reintenta con backoff: no pierde eventos.'
      }
      submitLabel={turningOn ? 'Encender' : 'Apagar'}
      busy={setEnabled.isPending}
      error={setEnabled.error}
      onSubmit={() => void submit()}
      onCancel={onClose}
    >
      <TextAreaField label="Motivo" required hint="Queda en la auditoría (incluye la referencia a D-12 al encender)."
        error={form.formState.errors.reason} {...form.register('reason')} />
    </FormDialog>
  );
}

/* ==========================================================================
   Credencial (configure_usage_ingest_credential)
   ========================================================================== */

const ENVIRONMENTS = ['DEV', 'QAS', 'DEMO', 'PRD'] as const;

const credentialSchema = z.object({
  product_code: z.string().min(1, 'Elige el producto'),
  environment: z.enum(ENVIRONMENTS),
  issuer: z
    .string()
    .trim()
    .regex(/^[a-z0-9]+(\.[a-z0-9]+)*$/, 'Emisor en minúsculas separado por puntos (p. ej. ewm.ebim)')
    .max(100),
  public_key_ref: z
    .string()
    .trim()
    .regex(/^[A-Z][A-Z0-9_]{2,63}$/, 'NOMBRE de la variable de entorno en MAYÚSCULAS (p. ej. EWM_DEV_USAGE_PUBLIC_JWK), nunca la clave'),
  kid: z
    .string()
    .trim()
    .regex(/^[A-Za-z0-9._-]{0,64}$/, 'kid: letras, números, punto, guion o guion bajo')
    .optional(),
  audience: z.string().trim().min(3, 'Audiencia obligatoria'),
  enabled: z.boolean(),
});
type CredentialValues = z.input<typeof credentialSchema>;

function CredentialDialog({
  open,
  credential,
  productCode,
  productOptions,
  onClose,
}: {
  open: boolean;
  credential: Credential | null;
  productCode: string | null;
  productOptions: Array<{ value: string; label: string }>;
  onClose: () => void;
}) {
  const toast = useToast();
  const configure = useConfigureUsageIngestCredential();
  const form = useForm<CredentialValues>({ resolver: zodResolver(credentialSchema) });

  useEffect(() => {
    if (!open) return;
    configure.reset();
    form.reset({
      product_code: productCode ?? '',
      environment: (credential?.environment as CredentialValues['environment']) ?? 'DEV',
      issuer: credential?.issuer ?? '',
      public_key_ref: '',
      kid: credential?.kid ?? '',
      audience: credential?.audience ?? 'masteradmin.ebim',
      enabled: credential?.enabled ?? false,
    });
  }, [open, credential]);

  const submit = form.handleSubmit(async (values) => {
    const v = credentialSchema.parse(values);
    try {
      await configure.mutateAsync({
        p_product_code: v.product_code,
        p_environment: v.environment,
        p_issuer: v.issuer,
        p_public_key_ref: v.public_key_ref,
        p_enabled: v.enabled,
        p_kid: v.kid || undefined,
        p_audience: v.audience,
      });
      toast.success('Credencial configurada', `${v.issuer} · ${v.environment}`);
      onClose();
    } catch {
      /* visible en el diálogo */
    }
  });

  return (
    <FormDialog
      open={open}
      wide
      title={credential ? `Editar credencial · ${credential.issuer}` : 'Configurar credencial de ingest'}
      description="Emisor × ambiente es único: configurar uno existente lo reemplaza. La referencia de la clave pública no se puede leer de vuelta; al editar hay que volver a indicarla."
      submitLabel="Guardar"
      busy={configure.isPending}
      error={configure.error}
      onSubmit={() => void submit()}
      onCancel={onClose}
    >
      <FieldRow>
        <SelectField label="Producto" required placeholder="Elige el producto…" options={productOptions}
          error={form.formState.errors.product_code} {...form.register('product_code')} />
        {/* Emisor × ambiente es la clave: al editar, solo lectura (`readOnly`, no `disabled`). */}
        {credential ? (
          <TextField label="Ambiente" required readOnly error={form.formState.errors.environment} {...form.register('environment')} />
        ) : (
          <SelectField label="Ambiente" required
            options={ENVIRONMENTS.map((e) => ({ value: e, label: PROVISIONING_ENVIRONMENT_LABEL[e] }))}
            error={form.formState.errors.environment} {...form.register('environment')} />
        )}
      </FieldRow>
      <FieldRow>
        <TextField label="Emisor (iss)" required readOnly={Boolean(credential)} placeholder="ewm.ebim"
          error={form.formState.errors.issuer} {...form.register('issuer')} />
        <TextField label="Audiencia (aud)" required error={form.formState.errors.audience} {...form.register('audience')} />
      </FieldRow>
      <TextField label="Referencia de la clave pública" required placeholder="EWM_DEV_USAGE_PUBLIC_JWK"
        hint="Nombre del secreto de la Edge Function (termina en _PUBLIC_JWK o _PUBLIC_KEY). Nunca pegues la clave."
        autoComplete="off" spellCheck={false}
        error={form.formState.errors.public_key_ref} {...form.register('public_key_ref')} />
      <FieldRow>
        <TextField label="kid" hint="Opcional." error={form.formState.errors.kid} {...form.register('kid')} />
        <CheckboxField label="Credencial habilitada" hint="Deshabilitada, el ingest de este emisor se rechaza."
          {...form.register('enabled')} />
      </FieldRow>
    </FormDialog>
  );
}
