/**
 * Persistencia de apariencia — contrato §4.4 / U-12, spec §4.1 (E10).
 *
 * Sólo modo y densidad. Nada financiero ni de negocio pasa por aquí.
 *
 * Tres capas:
 *   1. `ebim-cp-color-mode` / `ebim-cp-density` (claves históricas): anti-flash
 *      ANTES de iniciar sesión. Es «lo último usado en este navegador».
 *   2. `…:<userId>`: preferencia de ESE usuario en este navegador. Dos personas
 *      que comparten equipo no se pisan.
 *   3. `profiles.settings.appearance` (fila propia, política
 *      `profiles_update_self`): copia entre dispositivos, hidratada al login.
 *
 * Todo acceso a storage va en try/catch: sin storage la app funciona con el
 * default y la preferencia dura la sesión.
 */
export type ColorMode = 'light' | 'dark';
export type Density = 'comoda' | 'equilibrada' | 'compacta';

export interface AppearancePrefs {
  mode: ColorMode;
  density: Density;
}

export const DEFAULT_PREFS: AppearancePrefs = { mode: 'light', density: 'equilibrada' };

const MODE_KEY = 'ebim-cp-color-mode';
const DENSITY_KEY = 'ebim-cp-density';
const MODES: readonly ColorMode[] = ['light', 'dark'];
const DENSITIES: readonly Density[] = ['comoda', 'equilibrada', 'compacta'];

export function isMode(v: unknown): v is ColorMode {
  return typeof v === 'string' && (MODES as readonly string[]).includes(v);
}
export function isDensity(v: unknown): v is Density {
  return typeof v === 'string' && (DENSITIES as readonly string[]).includes(v);
}

function safeGet(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

function safeSet(key: string, value: string): void {
  try {
    localStorage.setItem(key, value);
  } catch {
    /* almacenamiento no disponible: la preferencia dura la sesión */
  }
}

const userKey = (base: string, userId: string) => `${base}:${userId}`;

/** Preferencia guardada para `userId` (o la global si `null`); `null` si no hay ninguna. */
export function readStoredPrefs(userId: string | null): AppearancePrefs | null {
  const mode = safeGet(userId ? userKey(MODE_KEY, userId) : MODE_KEY);
  const density = safeGet(userId ? userKey(DENSITY_KEY, userId) : DENSITY_KEY);
  if (!isMode(mode) && !isDensity(density)) return null;
  return {
    mode: isMode(mode) ? mode : DEFAULT_PREFS.mode,
    density: isDensity(density) ? density : DEFAULT_PREFS.density,
  };
}

export function writeStoredPrefs(userId: string | null, prefs: AppearancePrefs): void {
  // La global siempre: evita el flash en la pantalla de login.
  safeSet(MODE_KEY, prefs.mode);
  safeSet(DENSITY_KEY, prefs.density);
  if (userId) {
    safeSet(userKey(MODE_KEY, userId), prefs.mode);
    safeSet(userKey(DENSITY_KEY, userId), prefs.density);
  }
}

/**
 * Preferencia inicial del usuario en este navegador. Migración sin pérdida: si el
 * usuario todavía no tiene clave propia, hereda la global histórica (la que usaba
 * la versión anterior) en vez de volver al default.
 */
export function initialPrefsFor(userId: string | null): AppearancePrefs {
  if (userId) {
    const own = readStoredPrefs(userId);
    if (own) return own;
  }
  return readStoredPrefs(null) ?? DEFAULT_PREFS;
}

export function hasOwnStoredPrefs(userId: string): boolean {
  return readStoredPrefs(userId) !== null;
}

/** Forma guardada en `profiles.settings.appearance`. */
export interface RemoteAppearance {
  mode?: unknown;
  density?: unknown;
  /** Marca de escritura explícita por la consola; el default de la columna no la trae. */
  updated_at?: unknown;
}

/**
 * Decide qué gana al hidratar desde el perfil:
 *  - el perfil, si alguna vez se guardó explícitamente (`updated_at`);
 *  - si el perfil sólo tiene el DEFAULT de la columna, gana lo local (no se pierde
 *    la preferencia que el usuario ya tenía en este navegador).
 */
export function resolveRemote(
  local: AppearancePrefs,
  remote: RemoteAppearance | null | undefined,
): { prefs: AppearancePrefs; pushLocal: boolean } {
  if (!remote || !remote.updated_at) return { prefs: local, pushLocal: true };
  return {
    prefs: {
      mode: isMode(remote.mode) ? remote.mode : local.mode,
      density: isDensity(remote.density) ? remote.density : local.density,
    },
    pushLocal: false,
  };
}

export function applyToDocument(prefs: AppearancePrefs): void {
  document.documentElement.setAttribute('data-theme', prefs.mode);
  document.documentElement.setAttribute('data-density', prefs.density);
}
