import { CheckCircleIcon, InfoIcon, MinusCircleIcon, WarningCircleIcon, XCircleIcon } from '@phosphor-icons/react';
import type { Dimension, DimTone, TenantDimensions } from './tenantDimensions';

const ICON: Record<DimTone, typeof InfoIcon> = {
  ok: CheckCircleIcon,
  warn: WarningCircleIcon,
  danger: XCircleIcon,
  info: InfoIcon,
  neutral: MinusCircleIcon,
};

const TONE: Record<DimTone, string> = {
  ok: 'text-ok',
  warn: 'text-warn',
  danger: 'text-danger',
  info: 'text-info',
  neutral: 'text-muted',
};

function Cell({ title, question, dim, extra }: { title: string; question: string; dim: Dimension; extra?: string }) {
  const Icon = ICON[dim.tone];
  return (
    <div className="p-4">
      <p className="text-micro text-muted">{title}</p>
      <p className="text-caption text-muted">{question}</p>
      <p className="mt-2 flex items-start gap-1.5 text-compact font-semibold text-fg">
        <Icon size={18} aria-hidden className={`mt-px shrink-0 ${TONE[dim.tone]}`} />
        <span>{dim.label}</span>
      </p>
      {extra ? <p className="mt-1 text-compact font-semibold text-fg">{extra}</p> : null}
      <p className="mt-1 text-caption text-fg-2">{dim.detail}</p>
    </div>
  );
}

/** Cuatro dimensiones en paralelo, sin resumen global (spec §11.2). */
export function TenantDimensionsView({ dims }: { dims: TenantDimensions }) {
  return (
    <div
      className="ebim-card grid divide-y divide-border sm:grid-cols-2 sm:divide-y-0 xl:grid-cols-4 xl:divide-x"
      aria-label="Estado del tenant por dimensión"
    >
      <Cell title="Comercial" question="¿Qué dice el contrato?" dim={dims.commercial} extra={dims.commercial.mrr} />
      <Cell title="Alta técnica" question="¿Se registró en el producto?" dim={dims.technical} />
      <Cell title="Salud" question="¿Qué se observó del destino?" dim={dims.health} />
      <Cell title="Acceso administrador" question="¿Qué informó el producto?" dim={dims.admin} />
    </div>
  );
}

/** Versión compacta para tablas: una línea por dimensión, con texto (no sólo color). */
export function TenantDimensionsInline({ dims }: { dims: TenantDimensions }) {
  const rows: Array<[string, Dimension]> = [
    ['Comercial', dims.commercial],
    ['Alta', dims.technical],
    ['Admin', dims.admin],
  ];
  return (
    <ul className="space-y-0.5 text-caption">
      {rows.map(([k, d]) => {
        const Icon = ICON[d.tone];
        return (
          <li key={k} className={`flex items-center gap-1 ${TONE[d.tone]}`}>
            <Icon size={12} aria-hidden />
            <span className="text-muted">{k}:</span> <span className="font-semibold">{d.label}</span>
          </li>
        );
      })}
    </ul>
  );
}
