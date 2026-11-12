import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/hooks/useAuth';
import { AppearanceContext, type AppearancePersistence } from '@/hooks/appearance-context';
import {
  applyToDocument,
  hasOwnStoredPrefs,
  initialPrefsFor,
  resolveRemote,
  writeStoredPrefs,
  type AppearancePrefs,
  type ColorMode,
  type Density,
  type RemoteAppearance,
} from '@/hooks/appearanceStore';

/**
 * Fuente ÚNICA de apariencia (E10). Antes Shell, Login y Configuración creaban
 * cada uno su propio estado y podían contradecirse; ahora todos leen de aquí.
 *
 * Al cambiar de identidad se carga la preferencia de ESA persona; la de la
 * anterior queda en su propia clave. La copia en `profiles.settings.appearance`
 * es la del propio usuario (política `profiles_update_self`): no amplía ningún
 * permiso ni guarda nada que no sea modo y densidad.
 */
export function AppearanceProvider({ children }: { children: ReactNode }) {
  const { session } = useAuth();
  const userId = session?.user?.id ?? null;

  const [prefs, setPrefs] = useState<AppearancePrefs>(() => initialPrefsFor(userId));
  const [persistence, setPersistence] = useState<AppearancePersistence>(
    userId ? 'BROWSER_AND_PROFILE' : 'BROWSER_ONLY',
  );
  const [owner, setOwner] = useState<string | null>(userId);
  const profileSettings = useRef<Record<string, unknown> | null>(null);
  // Identidad cuyo `profiles.settings` está cargado. Hasta que llegue el de la
  // persona actual no se escribe su perfil: nunca con los ajustes de otra (A→B).
  const hydratedFor = useRef<string | null>(null);
  // La persona cambió la apariencia antes de terminar la hidratación: su
  // elección manda y se sube cuando el perfil esté cargado.
  const pendingChoice = useRef<AppearancePrefs | null>(null);

  // Cambio de identidad: se toma la preferencia local de la nueva persona
  // (patrón «ajustar estado durante el render», sin efecto intermedio).
  if (owner !== userId) {
    setOwner(userId);
    setPrefs(initialPrefsFor(userId));
    setPersistence(userId ? 'BROWSER_AND_PROFILE' : 'BROWSER_ONLY');
  }

  useEffect(() => {
    applyToDocument(prefs);
  }, [prefs]);

  const pushRemote = useCallback(async (uid: string, next: AppearancePrefs) => {
    if (hydratedFor.current !== uid) {
      pendingChoice.current = next;
      return;
    }
    const settings = {
      ...(profileSettings.current ?? {}),
      appearance: { mode: next.mode, density: next.density, updated_at: new Date().toISOString() },
    };
    const { error } = await supabase.from('profiles').update({ settings }).eq('id', uid);
    if (error) {
      setPersistence('BROWSER_ONLY');
      return;
    }
    profileSettings.current = settings;
    setPersistence('BROWSER_AND_PROFILE');
  }, []);

  // Hidratación desde el perfil al iniciar sesión (U-12).
  useEffect(() => {
    profileSettings.current = null;
    hydratedFor.current = null;
    pendingChoice.current = null;
    if (!userId) return;
    let cancelled = false;
    const hadOwnLocal = hasOwnStoredPrefs(userId);
    void supabase
      .from('profiles')
      .select('settings')
      .eq('id', userId)
      .maybeSingle()
      .then(({ data, error }) => {
        if (cancelled) return;
        if (error || !data) {
          setPersistence('BROWSER_ONLY');
          return;
        }
        const settings = (data.settings ?? {}) as Record<string, unknown>;
        profileSettings.current = settings;
        hydratedFor.current = userId;
        if (pendingChoice.current) {
          const choice = pendingChoice.current;
          pendingChoice.current = null;
          void pushRemote(userId, choice);
          return;
        }
        const local = initialPrefsFor(userId);
        const { prefs: resolved, pushLocal } = resolveRemote(
          local,
          settings.appearance as RemoteAppearance | undefined,
        );
        setPrefs(resolved);
        writeStoredPrefs(userId, resolved);
        // Migración sin pérdida: lo que el usuario ya tenía en este navegador
        // (clave propia o histórica) se sube si el perfil sólo tenía el default.
        if (pushLocal) void pushRemote(userId, resolved);
        else if (!hadOwnLocal) writeStoredPrefs(userId, resolved);
      });
    return () => {
      cancelled = true;
    };
  }, [userId, pushRemote]);

  const update = useCallback(
    (patch: Partial<AppearancePrefs>) => {
      const next = { ...prefs, ...patch };
      setPrefs(next);
      writeStoredPrefs(userId, next);
      if (userId) void pushRemote(userId, next);
    },
    [prefs, userId, pushRemote],
  );

  const value = useMemo(
    () => ({
      mode: prefs.mode,
      density: prefs.density,
      persistence,
      setMode: (mode: ColorMode) => update({ mode }),
      setDensity: (density: Density) => update({ density }),
      toggleMode: () => update({ mode: prefs.mode === 'light' ? 'dark' : 'light' }),
    }),
    [prefs, persistence, update],
  );

  return <AppearanceContext.Provider value={value}>{children}</AppearanceContext.Provider>;
}
