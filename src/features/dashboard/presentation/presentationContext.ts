import { createContext, useContext } from 'react';
import { displayName } from './presentationModel';

/**
 * Lo que un panel del Resumen Ejecutivo necesita saber del modo presentación:
 * si se está proyectando (gráficos más altos y texto más grande) y si debe
 * ocultar los nombres de clientes y partners. Fuera del modo presentación no
 * hay proveedor y los paneles se ven como siempre.
 */
export interface PresentationView {
  active: boolean;
  /** Dibujando las seis diapositivas para imprimir (alturas fijas que caben en una hoja A4 apaisada). */
  printing: boolean;
  /** Nombres de clientes y partners reemplazados por «Cliente A», «Partner A»… */
  masked: boolean;
  customerName: (id: string, name: string) => string;
  partnerName: (id: string, name: string) => string;
}

const identity = (_id: string, name: string) => name;

export const DASHBOARD_VIEW: PresentationView = {
  active: false,
  printing: false,
  masked: false,
  customerName: identity,
  partnerName: identity,
};

export const PresentationViewContext = createContext<PresentationView>(DASHBOARD_VIEW);

export function usePresentationView(): PresentationView {
  return useContext(PresentationViewContext);
}

export function presentationView(
  masked: boolean,
  customers: Map<string, string>,
  partners: Map<string, string>,
  printing = false,
): PresentationView {
  return {
    active: true,
    printing,
    masked,
    customerName: (id, name) => displayName(masked ? customers : null, id, name, 'Cliente'),
    partnerName: (id, name) => displayName(masked ? partners : null, id, name, 'Partner'),
  };
}
