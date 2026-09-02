import { useAuth } from '@/hooks/useAuth';
import { useAppearance } from '@/hooks/useAppearance';
import { SectionTabs } from '@/components/ui/SectionTabs';
import { PageContainer, Card, Badge, DataTable, EmptyState } from '@/components/ui/primitives';
import { PLATFORM_ROLE_LABEL, ORG_ROLE_LABEL } from '@/types/domain';
import { env } from '@/lib/env';
import { EbimLockup } from '@/components/ui/EbimMark';

/**
 * Configuración.
 *
 * Apariencia (contrato §4.4): el usuario elige SÓLO modo y densidad. No existe
 * selector de color — el acento lo fija la marca del tenant y un preset de
 * usuario nunca puede sobreescribirlo.
 */
export function SettingsPage() {
  const { roles, persona } = useAuth();
  const { mode, density, setMode, setDensity } = useAppearance();

  return (
    <PageContainer title="Configuración" description="Tu sesión, tu apariencia y el entorno de esta consola.">
      <SectionTabs
        tabs={[
          {
            id: 'appearance',
            label: 'Apariencia',
            content: (
              <Card
                title="Apariencia"
                description="Sólo modo y densidad. El color de marca no es elegible por el usuario: lo define la marca del portal (contrato §4.4)."
              >
                <div className="space-y-5 p-4">
                  <div>
                    <span className="ebim-label">Modo</span>
                    <div className="flex gap-2">
                      {(['light', 'dark'] as const).map((m) => (
                        <button
                          key={m}
                          type="button"
                          onClick={() => setMode(m)}
                          className={mode === m ? 'ebim-btn-primary' : 'ebim-btn-ghost'}
                        >
                          {m === 'light' ? 'Claro' : 'Oscuro'}
                        </button>
                      ))}
                    </div>
                  </div>

                  <div>
                    <span className="ebim-label">Densidad</span>
                    <div className="flex flex-wrap gap-2">
                      {(['comoda', 'equilibrada', 'compacta'] as const).map((d) => (
                        <button
                          key={d}
                          type="button"
                          onClick={() => setDensity(d)}
                          className={density === d ? 'ebim-btn-primary' : 'ebim-btn-ghost'}
                        >
                          {d === 'comoda' ? 'Cómoda' : d === 'equilibrada' ? 'Equilibrada' : 'Compacta'}
                        </button>
                      ))}
                    </div>
                    <p className="mt-2 text-xs text-muted">
                      Altura de control / fila: cómoda 40/52 · equilibrada 36/44 · compacta 32/38.
                    </p>
                  </div>

                  <div className="rounded-field border border-border p-4">
                    <p className="mb-2 text-xs font-bold uppercase tracking-wider text-muted">
                      Vista previa
                    </p>
                    <div className="flex flex-wrap items-center gap-2">
                      <button type="button" className="ebim-btn-primary">Acción primaria</button>
                      <button type="button" className="ebim-btn-ghost">Secundaria</button>
                      <input className="ebim-input max-w-[200px]" placeholder="Campo de texto" />
                      <Badge tone="ok">Activo</Badge>
                      <Badge tone="warn">Pendiente</Badge>
                    </div>
                  </div>
                </div>
              </Card>
            ),
          },
          {
            id: 'session',
            label: 'Mi sesión',
            content: (
              <div className="grid gap-4 lg:grid-cols-2">
                <Card title="Identidad">
                  <dl className="divide-y divide-border">
                    {[
                      ['Correo', roles?.email ?? '—'],
                      ['Nombre', roles?.fullName ?? '—'],
                      ['Perfil', persona],
                      ['Rol de plataforma', roles?.platformRole ? PLATFORM_ROLE_LABEL[roles.platformRole] : 'Ninguno'],
                      ['Comercial asociado', roles?.salesAgentId ? 'Sí' : 'No'],
                    ].map(([k, v]) => (
                      <div key={k} className="flex justify-between gap-4 px-4 py-2.5 text-sm">
                        <dt className="text-muted">{k}</dt>
                        <dd className="text-right font-medium">{v}</dd>
                      </div>
                    ))}
                  </dl>
                </Card>

                <Card title="Mis membresías" description="El alcance real de lo que puedes ver lo decide RLS, no este listado.">
                  {(roles?.organizations.length ?? 0) === 0 && (roles?.tenantRoles.length ?? 0) === 0 ? (
                    <EmptyState title="Sin membresías" description="Tu acceso proviene de tu rol de plataforma." />
                  ) : (
                    <DataTable columns={['Ámbito', 'Nombre', 'Rol']}>
                      {(roles?.organizations ?? []).map((o) => (
                        <tr key={o.organizationId}>
                          <td className="ebim-td">Organización</td>
                          <td className="ebim-td font-semibold">{o.displayName}</td>
                          <td className="ebim-td"><Badge tone="info">{ORG_ROLE_LABEL[o.role]}</Badge></td>
                        </tr>
                      ))}
                      {(roles?.tenantRoles ?? []).map((t) => (
                        <tr key={t.tenantId}>
                          <td className="ebim-td">Tenant</td>
                          <td className="ebim-td font-mono text-xs">{t.tenantId.slice(0, 8)}…</td>
                          <td className="ebim-td"><Badge tone="accent">{t.role}</Badge></td>
                        </tr>
                      ))}
                    </DataTable>
                  )}
                </Card>
              </div>
            ),
          },
          {
            id: 'environment',
            label: 'Entorno',
            content: (
              <Card title="Entorno de la consola">
                <div className="p-4">
                  <div className="mb-4">
                    <EbimLockup appName="Control Plane" />
                  </div>
                  <dl className="divide-y divide-border">
                    {[
                      ['Entorno', env.appEnv],
                      ['URL de Supabase', env.supabaseUrl],
                      ['Clave en uso', 'anon / publicable — la seguridad la da RLS'],
                      // La regla de lint prohíbe el token literal en el cliente, incluso
                      // dentro de una etiqueta de UI. Se describe sin escribirlo.
                      ['Clave de servicio en el navegador', 'Nunca. Sólo existe del lado servidor.'],
                      ['Modo de provisioning', 'DRY_RUN (por defecto)'],
                    ].map(([k, v]) => (
                      <div key={k} className="flex justify-between gap-4 px-1 py-2.5 text-sm">
                        <dt className="text-muted">{k}</dt>
                        <dd className="break-all text-right font-mono text-xs">{v}</dd>
                      </div>
                    ))}
                  </dl>
                </div>
              </Card>
            ),
          },
        ]}
      />
    </PageContainer>
  );
}
