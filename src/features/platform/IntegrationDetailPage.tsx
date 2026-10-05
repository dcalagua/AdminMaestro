import { useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import {
  useProductIntegration,
  useProvisioningTargets,
  useCredentialProfiles,
  useProductOwners,
  useProvisioningAudit,
} from '@/services/queries';
import { useDeactivateProductOwner } from '@/services/mutations';
import { useProvisioningAccess } from '@/hooks/useProvisioningAccess';
import { useToast } from '@/components/ui/toast-context';
import { businessErrorMessage } from '@/lib/pgError';
import { ConfirmDialog } from '@/components/ui/ConfirmDialog';
import { SectionTabs } from '@/components/ui/SectionTabs';
import {
  PageContainer, Card, DataTable, LoadingState, ErrorState, EmptyState, Badge,
} from '@/components/ui/primitives';
import { formatDateTime } from '@/lib/format';
import {
  CREDENTIAL_TYPE_LABEL,
  DEPLOYMENT_TARGET_STATUS_LABEL,
  INTEGRATION_STATUS_LABEL,
  INTEGRATION_TYPE_HINT,
  INTEGRATION_TYPE_LABEL,
  PRODUCT_OWNER_ROLE_LABEL,
  PROVISIONING_ENVIRONMENT_LABEL,
  PROVISIONING_POLICY_HINT,
  PROVISIONING_POLICY_LABEL,
  integrationStatusTone,
  targetStatusTone,
  type CredentialProfileType,
  type DeploymentTargetStatus,
  type IntegrationStatus,
  type IntegrationType,
  type ProductOwnerRole,
  type ProvisioningEnvironment,
  type ProvisioningPolicy,
} from '@/lib/provisioning';
import {
  IntegrationDialog,
  CredentialProfileDialog,
  ProductOwnerDialog,
  type CredentialDraft,
  type IntegrationDraft,
} from './IntegrationDialogs';
import { RevealSecretRefButton } from './RevealSecretRef';
import { contractAdapterFor } from '@/features/deployments/contractAdapters';
import { environmentLabel, isEvaluable, notEvaluatedReason, observedHealth, summarizeByEnvironment } from './targetHealth';
import { EnvironmentHealthList, HealthBadge, ObservationDate } from './EnvironmentHealth';
import { CutoverStepper } from './CutoverStepper';
import { Avatar } from '@/components/ui/Avatar';
import { AuditTimeline } from '@/features/settings/AuditTimeline';
import { AuditDetail } from '@/features/settings/AuditPage';

/** Fila etiqueta/valor para las fichas de configuración. */
function Row({ label, value, hint }: { label: string; value: React.ReactNode; hint?: string }) {
  return (
    <div className="flex flex-col gap-0.5 border-b border-border py-2.5 last:border-b-0 sm:flex-row sm:items-baseline sm:gap-4">
      <span className="w-56 shrink-0 text-micro text-muted">
        {label}
      </span>
      <div className="min-w-0 flex-1 text-body text-fg">
        {value}
        {hint ? <p className="mt-0.5 text-caption text-muted">{hint}</p> : null}
      </div>
    </div>
  );
}

function Mono({ children }: { children: React.ReactNode }) {
  return <span className="font-mono text-compact">{children}</span>;
}

const NOT_SET = <span className="text-muted">Sin configurar</span>;

export function IntegrationDetailPage() {
  const { integrationId } = useParams<{ integrationId: string }>();
  const integration = useProductIntegration(integrationId);
  const targets = useProvisioningTargets();
  const credentials = useCredentialProfiles();
  const owners = useProductOwners();
  const audit = useProvisioningAudit('product_integration', integrationId);
  const access = useProvisioningAccess();
  const toast = useToast();
  const deactivate = useDeactivateProductOwner();

  const [editOpen, setEditOpen] = useState(false);
  const [credentialDialog, setCredentialDialog] = useState<{
    open: boolean;
    profile: CredentialDraft | null;
  }>({ open: false, profile: null });
  const [ownerDialogOpen, setOwnerDialogOpen] = useState(false);
  const [ownerToRemove, setOwnerToRemove] = useState<{ id: string; name: string } | null>(null);

  if (integration.isLoading) return <LoadingState variant="page" />;
  if (integration.error) {
    return <ErrorState error={integration.error} onRetry={() => void integration.refetch()} />;
  }
  if (!integration.data) {
    return (
      <PageContainer title="Integración no encontrada">
        <Card>
          <EmptyState
            title="No existe o no tiene acceso"
            description="Un propietario técnico sólo ve las integraciones de su producto."
            action={
              <Link to="/integrations" className="ebim-btn-secondary">
                Volver a integraciones
              </Link>
            }
          />
        </Card>
      </PageContainer>
    );
  }

  const data = integration.data;
  const product = data.saas_products as
    | { id: string; code: string; short_name: string; accent_color?: string | null }
    | null;
  const productId = data.saas_product_id;
  const type = data.integration_type as IntegrationType;
  const isHttp = type === 'HTTP_M2M' || type === 'EDGE_FUNCTION';

  const canManage = access.canForProduct('platform.integration.manage', productId);
  const canManageCredentials = access.canForProduct('platform.credentials.manage', productId);
  const canManageOwners = access.can('platform.product_owner.manage');

  const relatedTargets = (targets.data ?? []).filter((t) => t.product_integration_id === data.id);
  const productCredentials = (credentials.data ?? []).filter(
    (c) => c.saas_product_id === productId || c.saas_product_id === null,
  );
  const productOwners = (owners.data ?? []).filter((o) => o.saas_product_id === productId);
  const enabledTargets = relatedTargets.filter(isEvaluable);
  const readyCredentials = productCredentials.filter((c) => c.enabled && c.secret_configured);
  const responsible =
    data.owner_name ??
    (data.profiles as { full_name: string | null; email: string } | null)?.full_name ??
    null;

  const draft: IntegrationDraft = {
    id: data.id,
    saas_product_id: data.saas_product_id,
    code: data.code,
    name: data.name,
    integration_type: data.integration_type,
    adapter_key: data.adapter_key,
    contract_version: data.contract_version,
    owner_name: data.owner_name,
    issuer: data.issuer,
    audience: data.audience,
    subject: data.subject,
    algorithm: data.algorithm,
    token_ttl_seconds: data.token_ttl_seconds,
    create_scope: data.create_scope,
    read_scope: data.read_scope,
    create_path_template: data.create_path_template,
    status_path_template: data.status_path_template,
    health_path_template: data.health_path_template,
    allowed_hosts: data.allowed_hosts,
    provisioning_policy: data.provisioning_policy,
    enabled: data.enabled,
    status: data.status,
  };

  async function confirmRemoveOwner() {
    if (!ownerToRemove) return;
    try {
      await deactivate.mutateAsync({ p_id: ownerToRemove.id });
      toast.success('Propietario retirado', ownerToRemove.name);
    } catch (error) {
      toast.error('No se pudo retirar', businessErrorMessage(error));
    } finally {
      setOwnerToRemove(null);
    }
  }

  return (
    <PageContainer
      title={data.name}
      description={`${product?.short_name ?? 'Producto'} · ${INTEGRATION_TYPE_LABEL[type]} · contrato ${data.contract_version}`}
      leading={<Avatar name={product?.short_name ?? data.name} size="lg" ringColor={product?.accent_color} />}
      titleAside={
        <>
          <Badge tone={integrationStatusTone(data.status as IntegrationStatus)}>
            {INTEGRATION_STATUS_LABEL[data.status as IntegrationStatus]}
          </Badge>
          {data.enabled ? <Badge tone="ok" dot>Habilitada</Badge> : <Badge>Deshabilitada</Badge>}
        </>
      }
      meta={<span className="font-mono">{data.code}</span>}
      actions={
        canManage ? (
          <button type="button" className="ebim-btn-primary" onClick={() => setEditOpen(true)}>
            Editar integración
          </button>
        ) : null
      }
    >
      <SectionTabs
        tabs={[
          {
            id: 'summary',
            label: 'Resumen',
            content: (
              <div className="grid gap-4 lg:grid-cols-2">
                <Card
                  title="Resumen operativo"
                  description="Lo necesario para saber si se puede operar. Los parámetros técnicos están en las pestañas siguientes."
                >
                  <div className="px-4 pb-2">
                    <Row
                      label="Estado"
                      value={
                        <span className="flex flex-wrap gap-2">
                          <Badge tone={integrationStatusTone(data.status as IntegrationStatus)}>
                            {INTEGRATION_STATUS_LABEL[data.status as IntegrationStatus]}
                          </Badge>
                          {data.enabled ? <Badge tone="ok">Habilitada</Badge> : <Badge>Deshabilitada</Badge>}
                        </span>
                      }
                    />
                    <Row
                      label="Política de provisioning"
                      value={PROVISIONING_POLICY_LABEL[data.provisioning_policy as ProvisioningPolicy]}
                      hint={PROVISIONING_POLICY_HINT[data.provisioning_policy as ProvisioningPolicy]}
                    />
                    <Row label="Responsable técnico" value={responsible ?? NOT_SET} />
                    <Row
                      label="Destinos habilitados"
                      value={`${enabledTargets.length} de ${relatedTargets.length}`}
                      hint="Un destino deshabilitado o en borrador queda «No evaluado»."
                    />
                    <Row
                      label="Credenciales listas"
                      value={
                        credentials.isLoading
                          ? 'Leyendo…'
                          : `${readyCredentials.length} de ${productCredentials.length} con referencia configurada y habilitadas`
                      }
                      hint="Sólo se sabe si la referencia existe; el valor del secreto nunca llega a la consola."
                    />
                    <Row
                      label="Certificación"
                      value={<span className="text-muted">Sin fuente verificable en la consola</span>}
                      hint="No se deduce de que la integración esté lista ni de que un alta haya quedado activa."
                    />
                  </div>
                </Card>
                <div className="flex flex-col gap-4">
                  <Card
                    title="Salud observada por entorno"
                    description="Última comprobación guardada de cada entorno. No es monitoreo en tiempo real: se actualiza con «Verificar conexión» en Entornos y despliegues."
                  >
                    <div className="p-4">
                      {targets.isLoading ? (
                        <LoadingState label="Leyendo destinos…" />
                      ) : targets.error ? (
                        <ErrorState error={targets.error} onRetry={() => void targets.refetch()} />
                      ) : (
                        <EnvironmentHealthList summaries={summarizeByEnvironment(relatedTargets)} />
                      )}
                    </div>
                  </Card>
                  <Card
                    title="Modo de cutover"
                    description="Quién manda en cada eje para este producto. Se mueve paso a paso, con motivo, desde Billing shadow; aquí solo se muestra."
                  >
                    <div className="grid gap-5 p-4 sm:grid-cols-2">
                      <CutoverStepper axis="entitlements" state={data.cutover_state_entitlements} />
                      <CutoverStepper axis="billing" state={data.cutover_state_billing} />
                    </div>
                  </Card>
                </div>
              </div>
            ),
          },
          {
            id: 'general',
            label: 'Contrato',
            content: (
              <Card title="Identidad y contrato">
                <div className="px-4 pb-2">
                  <Row label="Código" value={<Mono>{data.code}</Mono>} />
                  <Row label="Producto" value={product?.short_name ?? '—'} />
                  <Row
                    label="Tipo de integración"
                    value={INTEGRATION_TYPE_LABEL[type]}
                    hint={INTEGRATION_TYPE_HINT[type]}
                  />
                  <Row label="Versión del contrato" value={<Mono>{data.contract_version}</Mono>} />
                  <Row label="Forma del contrato" value={contractAdapterFor(data.adapter_key).label} />
                  <Row label="Responsable técnico" value={responsible ?? NOT_SET} />
                  <Row label="Actualizada" value={formatDateTime(data.updated_at)} />
                </div>
              </Card>
            ),
          },
          {
            id: 'security',
            label: 'Seguridad',
            content: (
              <>
                <Card title="Contrato M2M">
                  <div className="px-4 pb-2">
                    {isHttp ? (
                      <>
                        <Row
                          label="Issuer"
                          value={<Mono>{data.issuer}</Mono>}
                          hint="Quién emite el token. Siempre MasterAdmin."
                        />
                        <Row
                          label="Audience"
                          value={data.audience ? <Mono>{data.audience}</Mono> : NOT_SET}
                          hint="Para quién es el token. Cada producto tiene la suya; no hay valor por defecto."
                        />
                        <Row
                          label="Subject"
                          value={<Mono>{data.subject}</Mono>}
                          hint="Identifica al SISTEMA. La persona viaja como claim de auditoría, que no autoriza por sí mismo."
                        />
                        <Row
                          label="Algoritmo"
                          value={data.algorithm ? <Mono>{data.algorithm}</Mono> : NOT_SET}
                          hint="Sólo asimétricos. `none` y HS256 están fuera del modelo."
                        />
                        <Row
                          label="TTL del token"
                          value={
                            data.token_ttl_seconds ? `${data.token_ttl_seconds} segundos` : NOT_SET
                          }
                          hint="Máximo 300 s. Un token de provisioning de vida larga es un token robado de vida larga."
                        />
                        <Row
                          label="Hosts permitidos"
                          value={
                            (data.allowed_hosts ?? []).length > 0 ? (
                              <Mono>{(data.allowed_hosts ?? []).join(', ')}</Mono>
                            ) : (
                              <span className="text-muted">
                                Sólo el host de la URL base del destino
                              </span>
                            )
                          }
                          hint="Lista blanca del guard SSRF, revalidada en el servidor antes de cada llamada."
                        />
                      </>
                    ) : (
                      <p className="py-6 text-body text-muted">
                        Una integración {INTEGRATION_TYPE_LABEL[type].toLowerCase()} no firma tokens
                        M2M: no arrastra issuer, audience, algoritmo ni TTL.
                      </p>
                    )}
                  </div>
                </Card>

                <div className="mt-4">
                  <Card title="Rutas del contrato">
                    <div className="px-4 pb-2">
                      <Row
                        label="Ruta de alta"
                        value={
                          data.create_path_template ? <Mono>{data.create_path_template}</Mono> : NOT_SET
                        }
                        hint="Relativa a la URL base del destino: la misma ruta sirve en QAS, PRD y dedicados."
                      />
                      <Row
                        label="Ruta de consulta"
                        value={
                          data.status_path_template ? <Mono>{data.status_path_template}</Mono> : NOT_SET
                        }
                      />
                      <Row
                        label="Ruta de salud"
                        value={
                          data.health_path_template ? (
                            <Mono>{data.health_path_template}</Mono>
                          ) : (
                            <span className="text-muted">
                              El producto no expone salud: el estado queda en «Sin verificar»
                            </span>
                          )
                        }
                      />
                    </div>
                  </Card>
                </div>
              </>
            ),
          },
          {
            id: 'scopes',
            label: 'Scopes',
            content: (
              <Card title="Alcance del token">
                <div className="px-4 pb-2">
                  <Row
                    label="Scope de creación"
                    value={data.create_scope ? <Mono>{data.create_scope}</Mono> : NOT_SET}
                  />
                  <Row
                    label="Scope de consulta"
                    value={data.read_scope ? <Mono>{data.read_scope}</Mono> : NOT_SET}
                  />
                  <Row
                    label="Scopes adicionales"
                    value={
                      (data.additional_scopes ?? []).length > 0 ? (
                        <Mono>{(data.additional_scopes ?? []).join(' ')}</Mono>
                      ) : (
                        <span className="text-muted">Ninguno</span>
                      )
                    }
                  />
                </div>
                <p className="px-4 pb-4 text-caption text-muted">
                  El orquestador rechaza firmar un token sin scope: un token sin alcance declarado
                  es un token con todos.
                </p>
              </Card>
            ),
          },
          {
            id: 'deployments',
            label: `Destinos (${relatedTargets.length})`,
            content: (
              <Card title="Destinos que usan esta integración">
                {relatedTargets.length === 0 ? (
                  <EmptyState
                    title="Sin destinos asociados"
                    description="Configure un destino en Entornos y despliegues para indicar a qué URL se llama en cada entorno."
                  />
                ) : (
                  <DataTable
                    columns={['Destino', 'Entorno', 'Modo', 'URL base', 'Estado', 'Salud observada', 'Timeout']}
                  >
                    {relatedTargets.map((t) => (
                      <tr key={t.deployment_target_id}>
                        <td className="ebim-td">
                          <Link to="/deployments" className="font-mono text-compact text-accent-deep hover:underline">
                            {t.code}
                          </Link>
                        </td>
                        <td className="ebim-td">{environmentLabel(t.provisioning_environment)}</td>
                        <td className="ebim-td">{t.deployment_mode}</td>
                        <td className="ebim-td">
                          {t.base_url ? (
                            <Mono>{t.base_url}</Mono>
                          ) : (
                            <span className="text-muted">No aplica</span>
                          )}
                        </td>
                        <td className="ebim-td">
                          <Badge
                            tone={targetStatusTone(t.provisioning_status as DeploymentTargetStatus)}
                          >
                            {
                              DEPLOYMENT_TARGET_STATUS_LABEL[
                                t.provisioning_status as DeploymentTargetStatus
                              ]
                            }
                          </Badge>
                        </td>
                        <td className="ebim-td">
                          <HealthBadge health={observedHealth(t)} />
                          <p className="mt-1 text-caption">
                            {isEvaluable(t) ? (
                              <ObservationDate at={t.health_checked_at} />
                            ) : (
                              <span className="text-muted">{notEvaluatedReason(t)}</span>
                            )}
                          </p>
                        </td>
                        <td className="ebim-td tabular-nums">{t.timeout_ms} ms</td>
                      </tr>
                    ))}
                  </DataTable>
                )}
              </Card>
            ),
          },
          {
            id: 'credentials',
            label: 'Credenciales',
            content: (
              <Card
                title="Perfiles de credencial"
                actions={
                  canManageCredentials ? (
                    <button
                      type="button"
                      className="ebim-btn-secondary"
                      onClick={() => setCredentialDialog({ open: true, profile: null })}
                    >
                      Nuevo perfil
                    </button>
                  ) : null
                }
              >
                <p className="px-4 pb-3 text-caption text-muted">
                  Un perfil guarda la <strong>referencia</strong> del secreto de firma, nunca su
                  valor. El valor vive en el almacén de secretos del servidor y esta base no puede
                  conocerlo.
                </p>
                {productCredentials.length === 0 ? (
                  <EmptyState title="Sin perfiles de credencial para este producto" />
                ) : (
                  <DataTable
                    columns={['Perfil', 'Ambiente', 'Tipo', 'Algoritmo', 'TTL', 'Secreto', 'Estado', '']}
                  >
                    {productCredentials.map((c) => (
                      <tr key={c.id}>
                        <td className="ebim-td">
                          <Mono>{c.code}</Mono>
                          <p className="text-caption text-muted">{c.name}</p>
                        </td>
                        <td className="ebim-td">
                          {PROVISIONING_ENVIRONMENT_LABEL[c.environment as ProvisioningEnvironment]}
                        </td>
                        <td className="ebim-td">
                          {CREDENTIAL_TYPE_LABEL[c.type as CredentialProfileType]}
                        </td>
                        <td className="ebim-td">{c.algorithm ?? '—'}</td>
                        <td className="ebim-td tabular-nums">
                          {c.token_ttl_seconds ? `${c.token_ttl_seconds} s` : '—'}
                        </td>
                        <td className="ebim-td">
                          {c.secret_configured ? (
                            <Badge tone="ok">Referencia configurada</Badge>
                          ) : (
                            <Badge tone="warn">Sin referencia</Badge>
                          )}
                        </td>
                        <td className="ebim-td">
                          {c.enabled ? (
                            <Badge tone="ok">Habilitado</Badge>
                          ) : (
                            <Badge>Deshabilitado</Badge>
                          )}
                        </td>
                        <td className="ebim-td text-right">
                          <div className="flex justify-end gap-2">
                            {canManageCredentials ? (
                              <RevealSecretRefButton profileId={c.id} code={c.code} />
                            ) : null}
                            {canManageCredentials ? (
                              <button
                                type="button"
                                className="ebim-btn-ghost"
                                onClick={() =>
                                  setCredentialDialog({
                                    open: true,
                                    profile: c as unknown as CredentialDraft,
                                  })
                                }
                              >
                                Editar
                              </button>
                            ) : null}
                          </div>
                        </td>
                      </tr>
                    ))}
                  </DataTable>
                )}
              </Card>
            ),
          },
          {
            id: 'owners',
            label: `Propietarios (${productOwners.length})`,
            content: (
              <Card
                title="Propietarios técnicos del producto"
                actions={
                  canManageOwners ? (
                    <button
                      type="button"
                      className="ebim-btn-secondary"
                      onClick={() => setOwnerDialogOpen(true)}
                    >
                      Asignar propietario
                    </button>
                  ) : null
                }
              >
                <p className="px-4 pb-3 text-caption text-muted">
                  Un propietario ve y opera el provisioning de <strong>este</strong> producto, y de
                  ningún otro. No es un rol de plataforma: repartir la propiedad exige alcance
                  transversal, para que nadie pueda auto-nombrarse en el producto del vecino.
                </p>
                {productOwners.length === 0 ? (
                  <EmptyState title="Sin propietarios técnicos asignados" />
                ) : (
                  <DataTable columns={['Persona', 'Correo', 'Rol', 'Desde', '']}>
                    {productOwners.map((o) => {
                      const person = o.profiles as { full_name: string | null; email: string } | null;
                      return (
                        <tr key={o.id}>
                          <td className="ebim-td">{person?.full_name ?? '—'}</td>
                          <td className="ebim-td">
                            <Mono>{person?.email ?? '—'}</Mono>
                          </td>
                          <td className="ebim-td">
                            <Badge tone="accent">
                              {PRODUCT_OWNER_ROLE_LABEL[o.role as ProductOwnerRole]}
                            </Badge>
                          </td>
                          <td className="ebim-td">{formatDateTime(o.granted_at)}</td>
                          <td className="ebim-td text-right">
                            {canManageOwners ? (
                              <button
                                type="button"
                                className="ebim-btn-ghost"
                                onClick={() =>
                                  setOwnerToRemove({
                                    id: o.id,
                                    name: person?.full_name ?? person?.email ?? 'propietario',
                                  })
                                }
                              >
                                Retirar
                              </button>
                            ) : null}
                          </td>
                        </tr>
                      );
                    })}
                  </DataTable>
                )}
              </Card>
            ),
          },
          {
            id: 'audit',
            label: 'Auditoría',
            content: (
              <Card
                title="Eventos de la integración"
                description="Cada cambio guarda el antes, el después y quién lo hizo. Los valores de secreto no aparecen: esta configuración no contiene ninguno."
              >
                {audit.isLoading ? (
                  <LoadingState label="Cargando eventos…" />
                ) : audit.error ? (
                  <ErrorState error={audit.error} onRetry={() => void audit.refetch()} />
                ) : (audit.data ?? []).length === 0 ? (
                  <EmptyState title="Sin cambios registrados" description="Aún no hay eventos de configuración para esta integración." />
                ) : (
                  <AuditTimeline
                    label="Eventos de la integración"
                    rows={audit.data ?? []}
                    renderDetail={(row) => <AuditDetail row={row} embedded />}
                  />
                )}
              </Card>
            ),
          },
        ]}
      />

      <IntegrationDialog
        open={editOpen}
        integration={draft}
        onClose={() => setEditOpen(false)}
      />
      <CredentialProfileDialog
        open={credentialDialog.open}
        profile={credentialDialog.profile}
        productId={productId}
        onClose={() => setCredentialDialog({ open: false, profile: null })}
      />
      <ProductOwnerDialog
        open={ownerDialogOpen}
        productId={productId}
        productName={product?.short_name ?? 'el producto'}
        onClose={() => setOwnerDialogOpen(false)}
      />
      <ConfirmDialog
        open={Boolean(ownerToRemove)}
        title="Retirar propietario técnico"
        message={`${ownerToRemove?.name ?? ''} dejará de ver el provisioning de este producto. La asignación se desactiva; no se borra el historial.`}
        confirmLabel="Retirar"
        onConfirm={confirmRemoveOwner}
        onCancel={() => setOwnerToRemove(null)}
      />
    </PageContainer>
  );
}
