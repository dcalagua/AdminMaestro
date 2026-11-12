import { useContext } from 'react';
import { AppearanceContext } from './appearance-context';

/**
 * Apariencia por usuario — contrato §4.4.
 *
 * El usuario elige SÓLO modo y densidad. El color/accent NUNCA es elegible:
 * lo fija la marca (enmienda 2026-08-11, esupplier-021). Por eso este hook no
 * expone ningún selector de paleta.
 *
 * Todas las pantallas comparten UN estado (`AppearanceProvider`): cambiar el modo
 * en Configuración cambia el Shell en el mismo instante. Persistencia y alcance
 * por usuario en `appearanceStore.ts`.
 */
export type { ColorMode, Density } from './appearanceStore';

export function useAppearance() {
  const ctx = useContext(AppearanceContext);
  if (!ctx) {
    throw new Error('useAppearance debe usarse dentro de <AppearanceProvider>');
  }
  return ctx;
}
