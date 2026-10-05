import { useEffect, useState } from 'react';
import type { ReactNode } from 'react';
import { EnvelopeSimpleIcon, PlusIcon, TrendUpIcon } from '@phosphor-icons/react';
import { ConfirmDialog } from '@/components/ui/ConfirmDialog';
import { DetailDrawer, DetailList } from '@/components/ui/DetailDrawer';
import { FormDialog } from '@/components/ui/FormDialog';
import {
  CheckboxField,
  FieldRow,
  MoneyField,
  NumberField,
  SearchField,
  SelectField,
  SwitchField,
  TextAreaField,
  TextField,
} from '@/components/ui/fields';
import {
  Badge,
  Card,
  DataTable,
  EmptyState,
  ErrorState,
  KpiTile,
  LoadingState,
  PageContainer,
  StatCard,
} from '@/components/ui/primitives';
import { SectionTabs, StatusTabs } from '@/components/ui/SectionTabs';
import { Sparkline } from '@/components/ui/Sparkline';
import { useToast } from '@/components/ui/toast-context';
import { useAppearance } from '@/hooks/useAppearance';
import { applyToDocument } from '@/hooks/appearanceStore';
import type { ColorMode, Density } from '@/hooks/appearanceStore';

/**
 * Galería de componentes (VISUAL_SYSTEM_V2 §5) — solo desarrollo o super admin.
 *
 * Sirve para revisar de un vistazo cada componente en todos sus estados y para
 * las capturas de QA visual. Los valores son EJEMPLOS DE MAQUETA declarados en
 * pantalla, no cifras del negocio: la galería no lee datos.
 *
 * El conmutador claro/oscuro y de densidad es una VISTA PREVIA: cambia el
 * documento mientras la galería está abierta y no toca la preferencia guardada
 * del usuario (U-08/U-12); al salir se restaura la del perfil.
 */

// Serie de maqueta para la sparkline (forma, no datos).
const SAMPLE_TREND = [14, 16, 18, 21, 24, 27, 30, 33, 37, 41, 46, 50];

function Section({ id, title, description, children }: { id: string; title: string; description?: string; children: ReactNode }) {
  return (
    <section id={id} aria-labelledby={`${id}-title`} className="scroll-mt-6 space-y-4">
      <div>
        <h2 id={`${id}-title`} className="text-h2 text-fg">
          {title}
        </h2>
        {description ? <p className="mt-1 max-w-[72ch] text-compact text-fg-2">{description}</p> : null}
      </div>
      {children}
    </section>
  );
}

function Specimen({ label, children, className = '' }: { label: string; children: ReactNode; className?: string }) {
  return (
    <div className={className}>
      <p className="mb-2 text-micro text-muted">{label}</p>
      {children}
    </div>
  );
}

const TYPE_SCALE: Array<[string, string, string]> = [
  ['text-display', '40 / 44 · KPI del resumen', 'USD 50.1 K'],
  ['text-kpi', '32 / 38 · KPI interno', '1,284'],
  ['text-h1', '28 / 34 · Título de página', 'Facturación y cobros'],
  ['text-h2', '20 / 28 · Sección, diálogo', 'Evolución del negocio'],
  ['text-h3', '16 / 24 · Tarjeta, drawer', 'Cartera por antigüedad'],
  ['text-body', '14 / 22 · Texto base', 'El texto base de celdas, campos y botones.'],
  ['text-compact', '13 / 20 · Labels, tabs', 'Etiqueta de campo'],
  ['text-caption', '12 / 16 · Ayuda, ejes', 'Ayuda bajo el campo · ene 26'],
  ['text-micro', '11 / 16 · Micro-label', 'Cabecera de tabla'],
];

export function DesignGalleryPage() {
  const appearance = useAppearance();
  const toast = useToast();
  const [mode, setMode] = useState<ColorMode>(appearance.mode);
  const [density, setDensity] = useState<Density>(appearance.density);
  const [status, setStatus] = useState<'ALL' | 'OPEN' | 'PAID'>('ALL');
  const [query, setQuery] = useState('andina');
  const [notify, setNotify] = useState(true);
  const [dialog, setDialog] = useState<null | 'form' | 'confirm' | 'drawer'>(null);

  // Vista previa local; al salir se restaura la preferencia del perfil.
  useEffect(() => {
    applyToDocument({ mode, density });
  }, [mode, density]);
  useEffect(
    () => () => applyToDocument({ mode: appearance.mode, density: appearance.density }),
    [appearance.mode, appearance.density],
  );

  return (
    <PageContainer
      title="Galería de componentes"
      description="Sistema visual V2: cada componente base en sus estados. Los valores son ejemplos de maqueta, no cifras del negocio."
      breadcrumbs={[{ label: 'Configuración', to: '/settings' }, { label: 'Galería de componentes' }]}
      meta="Visible solo en desarrollo o para super admin · la vista previa de modo y densidad no se guarda"
      actions={
        <>
          <StatusTabs
            label="Modo de la vista previa"
            value={mode}
            onChange={setMode}
            options={[
              { id: 'light', label: 'Claro' },
              { id: 'dark', label: 'Oscuro' },
            ]}
          />
          <StatusTabs
            label="Densidad de la vista previa"
            value={density}
            onChange={setDensity}
            options={[
              { id: 'comoda', label: 'Cómoda' },
              { id: 'equilibrada', label: 'Equilibrada' },
              { id: 'compacta', label: 'Compacta' },
            ]}
          />
        </>
      }
    >
      <div className="space-y-12">
        <Section id="tipografia" title="Tipografía" description="DM Sans, una sola familia. Cifras display proporcionales; tablas y ejes tabulares.">
          <Card>
            <div className="divide-y divide-border">
              {TYPE_SCALE.map(([cls, spec, sample]) => (
                <div key={cls} className="flex flex-wrap items-baseline gap-x-6 gap-y-1 px-5 py-3">
                  <code className="w-32 shrink-0 font-mono text-caption text-muted">{cls}</code>
                  <span className="w-48 shrink-0 text-caption text-muted">{spec}</span>
                  <span className={`${cls} min-w-0 text-fg`}>{sample}</span>
                </div>
              ))}
            </div>
          </Card>
        </Section>

        <Section id="botones" title="Botones" description="Una primaria por zona. Tamaños sm 32 · md densidad · lg 44. Ocupado: spinner, mismo ancho.">
          <Card>
            <div className="grid gap-6 p-5 lg:grid-cols-2">
              <Specimen label="Variantes">
                <div className="flex flex-wrap items-center gap-2">
                  <button type="button" className="ebim-btn-primary">
                    <PlusIcon size={16} aria-hidden /> Primario
                  </button>
                  <button type="button" className="ebim-btn-secondary">Secundario</button>
                  <button type="button" className="ebim-btn-ghost">Fantasma</button>
                  <button type="button" className="ebim-btn-danger">Peligro</button>
                  <button type="button" className="ebim-link">Enlace</button>
                </div>
              </Specimen>
              <Specimen label="Tamaños">
                <div className="flex flex-wrap items-center gap-2">
                  <button type="button" className="ebim-btn-primary ebim-btn-sm">Pequeño</button>
                  <button type="button" className="ebim-btn-primary">Mediano</button>
                  <button type="button" className="ebim-btn-primary ebim-btn-lg">Grande</button>
                </div>
              </Specimen>
              <Specimen label="Deshabilitado">
                <div className="flex flex-wrap items-center gap-2">
                  <button type="button" className="ebim-btn-primary" disabled>Primario</button>
                  <button type="button" className="ebim-btn-secondary" disabled>Secundario</button>
                  <button type="button" className="ebim-btn-ghost" disabled>Fantasma</button>
                </div>
              </Specimen>
              <Specimen label="Ocupado">
                <div className="flex flex-wrap items-center gap-2">
                  <button type="button" className="ebim-btn-primary" disabled aria-busy="true">
                    <span className="ebim-spinner" aria-hidden /> Guardando…
                  </button>
                  <button type="button" className="ebim-btn-danger" disabled aria-busy="true">
                    <span className="ebim-spinner" aria-hidden /> Procesando…
                  </button>
                </div>
              </Specimen>
            </div>
          </Card>
        </Section>

        <Section id="campos" title="Campos de formulario" description="Etiqueta encima, ayuda o error debajo; foco con borde teal y halo de 3 px.">
          <Card>
            <div className="grid gap-x-6 gap-y-5 p-5 md:grid-cols-2 xl:grid-cols-3">
              <TextField label="Razón social" placeholder="Andina Logística SAC" hint="Como figura en el registro tributario." />
              <TextField label="Correo de facturación" icon={<EnvelopeSimpleIcon size={16} />} defaultValue="cobros@andina.example" required />
              <TextField label="Código" defaultValue="AND-01" error={{ message: 'Ya existe un registro con ese código.' }} />
              <MoneyField label="Precio mensual" currency="USD" defaultValue="1250.00" hint="Sin impuestos." />
              <NumberField label="Usuarios incluidos" defaultValue={25} suffix="usuarios" />
              <SelectField
                label="Moneda"
                placeholder="Elige la moneda…"
                options={[
                  { value: 'PEN', label: 'PEN' },
                  { value: 'USD', label: 'USD' },
                  { value: 'BOB', label: 'BOB' },
                ]}
              />
              <TextField label="Deshabilitado" defaultValue="No editable" disabled />
              <TextField label="Solo lectura" defaultValue="tok_live_…a91f" readOnly hint="Se puede seleccionar y copiar." />
              <SelectField
                label="Con error"
                placeholder="Elige el mercado…"
                options={[{ value: 'PE', label: 'Perú (PE)' }]}
                error={{ message: 'Elige un mercado activo.' }}
              />
              <TextAreaField label="Motivo" placeholder="Explica el cambio…" hint="Queda en la auditoría." className="md:col-span-2" />
              <div className="space-y-4">
                <CheckboxField label="Enviar aviso al cliente" hint="Al correo de facturación." defaultChecked />
                <CheckboxField label="Casilla deshabilitada" disabled />
                <SwitchField label="Avisos por correo" hint="Efecto inmediato." checked={notify} onChange={setNotify} />
                <SwitchField label="Switch deshabilitado" checked={false} onChange={() => undefined} disabled />
              </div>
            </div>
          </Card>
          <Card title="Buscador y pestañas de estado" description="Listados (U-06): un buscador único + pestañas de estado.">
            <div className="flex flex-wrap items-center justify-between gap-3 px-5 py-4">
              <SearchField value={query} onChange={setQuery} placeholder="Buscar clientes…" />
              <StatusTabs
                value={status}
                onChange={setStatus}
                options={[
                  { id: 'ALL', label: 'Todas', count: 832 },
                  { id: 'OPEN', label: 'Por cobrar', count: 41 },
                  { id: 'PAID', label: 'Pagadas', count: 791 },
                ]}
              />
            </div>
          </Card>
        </Section>

        <Section id="badges" title="Badges" description="Texto en español con minúscula inicial; el punto acompaña, nunca sustituye.">
          <Card>
            <div className="space-y-3 p-5">
              <div className="flex flex-wrap gap-2">
                <Badge>Neutro</Badge>
                <Badge tone="ok">Activa</Badge>
                <Badge tone="warn">Por vencer</Badge>
                <Badge tone="danger">Vencida</Badge>
                <Badge tone="info">En revisión</Badge>
                <Badge tone="accent">Partner</Badge>
              </div>
              <div className="flex flex-wrap gap-2">
                <Badge dot>Borrador</Badge>
                <Badge tone="ok" dot>Activa</Badge>
                <Badge tone="warn" dot>Suspendida</Badge>
                <Badge tone="danger" dot>Cancelada</Badge>
                <Badge tone="info" dot>Sombra</Badge>
                <Badge tone="accent" dot>Primaria</Badge>
              </div>
            </div>
          </Card>
        </Section>

        <Section id="kpis" title="KPI" description="Etiqueta micro → valor protagonista → variación con flecha → tendencia 12 meses → pie. El color va en la variación, nunca en el valor.">
          <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
            <KpiTile
              size="display"
              label="MRR · ejemplo"
              currency="USD"
              value="50.1 K"
              delta={{ value: 0.041, comparison: 'vs mes anterior' }}
              trend={SAMPLE_TREND}
              trendDescription="Tendencia de ejemplo: sube de 14 a 50"
              footer="BOB 50.5 K · PEN 51.2 K"
              info="Ingreso recurrente mensual de contratos vigentes."
            />
            <KpiTile
              size="display"
              label="Cartera vencida · ejemplo"
              currency="USD"
              value="30.5 K"
              delta={{ value: 0.12, goodWhen: 'down', comparison: 'vs mes anterior' }}
              trend={[...SAMPLE_TREND].reverse()}
              trendPartial
              footer="Mes en curso parcial"
            />
            <KpiTile
              size="display"
              label="Cobro 12 meses · ejemplo"
              value="94.4%"
              icon={<TrendUpIcon size={14} />}
              delta={{ value: 1.2, kind: 'pp', comparison: 'vs año anterior' }}
              trend={SAMPLE_TREND}
            />
            <KpiTile label="Clientes activos · ejemplo" value="48" delta={{ value: 0, kind: 'number', comparison: 'sin cambio' }} />
            <KpiTile label="Cobrado del período" currency="USD" value={null} footer="Sin cobros en el período" />
            <KpiTile label="Margen bruto" value="—" loading />
            <KpiTile label="Comisiones" value="—" error={new Error('red')} onRetry={() => undefined} />
            <StatCard label="StatCard (compatibilidad)" value="12" hint="Estado: atención" tone="warn" />
            <Specimen label="Sparkline sola (36 px)" className="ebim-card p-5">
              <Sparkline data={SAMPLE_TREND} partialLast />
            </Specimen>
          </div>
        </Section>

        <Section id="tablas" title="Tarjeta y tabla" description="Cabecera micro sobre pozo, filas con hairline y hover, números a la derecha y tabulares.">
          <Card
            title="Facturas · ejemplo"
            description="Importes en moneda nativa"
            actions={<button type="button" className="ebim-btn-ghost ebim-btn-sm">Exportar</button>}
            footer="1–4 de 4 · filas de maqueta"
          >
            <DataTable
              label="Facturas de ejemplo"
              columns={['Número', 'Cliente', 'Estado', { label: 'Importe', align: 'right' }, { label: 'Vence', align: 'right' }]}
            >
              {[
                ['F001-000812', 'Andina Logística SAC', <Badge key="b" tone="ok" dot>Pagada</Badge>, 'USD 1,250.00', '15 sep 2026'],
                ['F001-000813', 'Minera Pacífico SA', <Badge key="b" tone="warn" dot>Por vencer</Badge>, 'PEN 8,420.50', '20 oct 2026'],
                ['F001-000814', 'Altiplano Servicios SRL', <Badge key="b" tone="danger" dot>Vencida</Badge>, 'BOB 3,980.00', '01 sep 2026'],
                ['F001-000815', 'Cordillera Agro SAC', <Badge key="b" dot>Borrador</Badge>, 'USD 640.00', '—'],
              ].map(([num, client, badge, amount, due]) => (
                <tr key={String(num)}>
                  <td className="ebim-td font-mono text-compact">{num}</td>
                  <td className="ebim-td">{client}</td>
                  <td className="ebim-td">{badge}</td>
                  <td className="ebim-td ebim-num">{amount}</td>
                  <td className="ebim-td ebim-num text-fg-2">{due}</td>
                </tr>
              ))}
            </DataTable>
          </Card>
        </Section>

        <Section id="pestanas" title="Pestañas de sección" description="Fichas y configuración (U-07): centradas, deep-link #hash, una sola fila.">
          <Card>
            <div className="p-5">
              <SectionTabs
                tabs={[
                  { id: 'resumen', label: 'Resumen', content: <p className="text-body text-fg-2">Contenido de la pestaña Resumen.</p> },
                  { id: 'contratos', label: 'Contratos', count: 3, content: <p className="text-body text-fg-2">Contratos.</p> },
                  { id: 'cobros', label: 'Cobros', content: <p className="text-body text-fg-2">Cobros.</p> },
                  { id: 'auditoria', label: 'Auditoría', content: <p className="text-body text-fg-2">Auditoría.</p> },
                ]}
              />
            </div>
          </Card>
        </Section>

        <Section id="estados" title="Estados" description="Carga con skeleton (no spinner), vacío con acción, error en español con reintento, éxito con toast.">
          <div className="grid gap-4 lg:grid-cols-2">
            <Card title="Carga · tabla">
              <LoadingState label="Cargando facturas…" rows={4} />
            </Card>
            <Card title="Carga · gráfico">
              <LoadingState variant="chart" label="Cargando gráfico…" />
            </Card>
            <Card title="Vacío">
              <EmptyState
                title="Aún no hay clientes"
                description="Cuando registres la primera venta, el cliente aparecerá aquí."
                action={
                  <button type="button" className="ebim-btn-primary">
                    <PlusIcon size={16} aria-hidden /> Nueva venta
                  </button>
                }
              />
            </Card>
            <Card title="Sin resultados de búsqueda">
              <EmptyState
                illustration="search"
                title="Sin resultados para «zzz»"
                description="Prueba con otro nombre, código o correo."
                action={<button type="button" className="ebim-btn-ghost">Limpiar búsqueda</button>}
              />
            </Card>
            <Card title="Error">
              <ErrorState
                error={{ code: 'PGRST201', message: "Could not embed because more than one relationship was found for 'tenants' and 'saas_products'" }}
                onRetry={() => undefined}
              />
            </Card>
            <Card title="Carga · tarjeta">
              <LoadingState variant="card" />
            </Card>
          </div>
        </Section>

        <Section id="overlays" title="Diálogos, panel lateral y avisos" description="Sobre velo, superficie elevada, entrada de 200 ms. Foco atrapado y devuelto; Escape cierra.">
          <Card>
            <div className="flex flex-wrap gap-2 p-5">
              <button type="button" className="ebim-btn-secondary" onClick={() => setDialog('form')}>
                Abrir diálogo de formulario
              </button>
              <button type="button" className="ebim-btn-ghost" onClick={() => setDialog('confirm')}>
                Abrir confirmación
              </button>
              <button type="button" className="ebim-btn-ghost" onClick={() => setDialog('drawer')}>
                Abrir panel lateral
              </button>
              <button type="button" className="ebim-btn-ghost" onClick={() => toast.success('Cambios guardados', 'El contrato quedó actualizado.')}>
                Aviso de éxito
              </button>
              <button type="button" className="ebim-btn-ghost" onClick={() => toast.error('No se pudo guardar', 'La base rechazó la operación.')}>
                Aviso de error
              </button>
              <button type="button" className="ebim-btn-ghost" onClick={() => toast.push('info', 'Sincronización en curso', 'Tarda unos segundos.')}>
                Aviso informativo
              </button>
            </div>
          </Card>
        </Section>
      </div>

      <FormDialog
        open={dialog === 'form'}
        title="Nuevo cliente"
        description="Datos mínimos para facturar. Puedes completarlos después."
        error={{ code: '23505', message: 'duplicate key value violates unique constraint' }}
        onSubmit={() => setDialog(null)}
        onCancel={() => setDialog(null)}
      >
        <TextField label="Razón social" defaultValue="Andina Logística SAC" required />
        <FieldRow>
          <TextField label="Código" defaultValue="AND-01" error={{ message: 'Ya existe un registro con ese código.' }} />
          <SelectField label="País" options={[{ value: 'PE', label: 'Perú (PE)' }]} />
        </FieldRow>
        <MoneyField label="Precio mensual" currency="USD" defaultValue="1250.00" />
      </FormDialog>

      <ConfirmDialog
        open={dialog === 'confirm'}
        title="Archivar producto"
        message="El producto deja de venderse. Los contratos vigentes no cambian."
        confirmLabel="Archivar"
        onConfirm={() => setDialog(null)}
        onCancel={() => setDialog(null)}
      />

      <DetailDrawer
        open={dialog === 'drawer'}
        title="Movimiento de ejemplo"
        subtitle="ID 7f3c…a91f"
        onClose={() => setDialog(null)}
        actions={<button type="button" className="ebim-btn-ghost" onClick={() => setDialog(null)}>Cerrar</button>}
      >
        <DetailList
          items={[
            ['Cliente', 'Andina Logística SAC'],
            ['Estado', <Badge key="s" tone="ok" dot>Confirmado</Badge>],
            ['Importe', 'USD 1,250.00'],
            ['Fecha', '15 sep 2026'],
            ['Referencia', 'OP-000812'],
            ['Observación', null],
          ]}
        />
      </DetailDrawer>
    </PageContainer>
  );
}
