import {
  type Icon,
  FirstAidKitIcon,
  PlusCircleIcon,
  ReceiptIcon,
  RocketLaunchIcon,
  TrayIcon,
} from '@phosphor-icons/react';

/**
 * Acciones de ⌘K (V5 · F5): verbos que llevan a la pantalla donde la acción
 * ya existe, con lo necesario para empezarla (`?accion=` abre el diálogo o
 * lanza la verificación al llegar). Cada una sólo se ofrece a quien tiene el
 * permiso de esa acción; la base sigue decidiendo al ejecutarla.
 */
export interface PaletteActionAccess {
  issueInvoice: boolean;
  newSale: boolean;
  newTenant: boolean;
  checkHealth: boolean;
  inbox: boolean;
}

export interface PaletteActionDef {
  id: keyof PaletteActionAccess;
  label: string;
  hint: string;
  to: string;
  icon: Icon;
  keywords: string[];
}

/** Parámetro que abre «Emitir factura» al llegar a Cobranza. */
export const ISSUE_INVOICE_PARAM = 'emitir-factura';
/** Parámetro que lanza «Verificar ahora» en todas las apps al llegar al Centro de la suite. */
export const CHECK_HEALTH_PARAM = 'verificar-salud';

const ACTIONS: PaletteActionDef[] = [
  {
    id: 'issueInvoice',
    label: 'Emitir factura…',
    hint: 'Elige el contrato y el período',
    to: `/cobranza?accion=${ISSUE_INVOICE_PARAM}`,
    icon: ReceiptIcon,
    keywords: ['facturar', 'factura', 'cobranza', 'emitir'],
  },
  {
    id: 'newSale',
    label: 'Nueva venta',
    hint: 'Alta guiada de un cliente',
    to: '/onboarding',
    icon: RocketLaunchIcon,
    keywords: ['vender', 'alta de cliente', 'nuevo cliente', 'contrato'],
  },
  {
    id: 'newTenant',
    label: 'Nuevo tenant',
    hint: 'Para una cuenta existente, en una app',
    to: '/onboarding?modo=app',
    icon: PlusCircleIcon,
    keywords: ['crear tenant', 'alta en una app'],
  },
  {
    id: 'checkHealth',
    label: 'Verificar salud de las apps',
    hint: 'Comprueba ahora la conexión con cada app',
    to: `/suite?accion=${CHECK_HEALTH_PARAM}`,
    icon: FirstAidKitIcon,
    keywords: ['salud', 'verificar', 'conexión', 'apps', 'caída'],
  },
  {
    id: 'inbox',
    label: 'Ir a Bandeja',
    hint: 'Lo que requiere tu atención',
    to: '/bandeja',
    icon: TrayIcon,
    keywords: ['pendientes', 'avisos', 'alertas', 'bandeja'],
  },
];

export function paletteActions(access: PaletteActionAccess): PaletteActionDef[] {
  return ACTIONS.filter((a) => access[a.id]);
}
