import { createContext } from 'react';
import type { ColorMode, Density } from './appearanceStore';

/** Dónde quedó guardada la preferencia: se declara, no se promete (spec P30). */
export type AppearancePersistence = 'BROWSER_AND_PROFILE' | 'BROWSER_ONLY' | 'SESSION_ONLY';

export interface AppearanceContextValue {
  mode: ColorMode;
  density: Density;
  persistence: AppearancePersistence;
  setMode: (mode: ColorMode) => void;
  setDensity: (density: Density) => void;
  toggleMode: () => void;
}

export const AppearanceContext = createContext<AppearanceContextValue | null>(null);
