import { useCallback, useMemo, useSyncExternalStore } from 'react';

/**
 * «Hecho» de la Bandeja (V5 · F5). No existe una tabla de estado de la bandeja
 * y la fase no crea ninguna: lo marcado se guarda POR USUARIO en el
 * `localStorage` de este navegador (la UI lo dice). Si el almacenamiento no
 * está disponible (modo privado, bloqueado), dura lo que dure la pestaña.
 *
 * Se guarda la clave del ítem, que incluye el estado que lo hizo aparecer: si
 * el dato cambia, el ítem nuevo vuelve a la bandeja. Las marcas de más de
 * `MAX_AGE_DAYS` se olvidan al escribir.
 */
const PREFIX = 'ebim-cp-inbox-done:';
const MAX_AGE_DAYS = 60;

type Marks = Readonly<Record<string, string>>;

const EMPTY: Marks = Object.freeze({});
const memory = new Map<string, Marks>();
const listeners = new Set<() => void>();
let storageWorks = true;

function storageKey(userId: string) {
  return `${PREFIX}${userId}`;
}

function load(userId: string): Marks {
  const cached = memory.get(userId);
  if (cached) return cached;
  let marks: Marks = EMPTY;
  try {
    const raw = localStorage.getItem(storageKey(userId));
    const parsed: unknown = raw ? JSON.parse(raw) : null;
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      marks = Object.fromEntries(Object.entries(parsed as Record<string, unknown>).filter(([, v]) => typeof v === 'string')) as Marks;
    }
  } catch {
    storageWorks = false;
  }
  memory.set(userId, marks);
  return marks;
}

function save(userId: string, marks: Marks) {
  const cutoff = Date.now() - MAX_AGE_DAYS * 24 * 3600 * 1000;
  const kept = Object.fromEntries(Object.entries(marks).filter(([, at]) => new Date(at).getTime() >= cutoff));
  memory.set(userId, kept);
  try {
    localStorage.setItem(storageKey(userId), JSON.stringify(kept));
    storageWorks = true;
  } catch {
    storageWorks = false; /* sin almacenamiento: dura la pestaña */
  }
  listeners.forEach((l) => l());
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  // Otra pestaña del mismo navegador marcó algo: se relee.
  const onStorage = (e: StorageEvent) => {
    if (e.key?.startsWith(PREFIX)) {
      memory.clear();
      listener();
    }
  };
  window.addEventListener('storage', onStorage);
  return () => {
    listeners.delete(listener);
    window.removeEventListener('storage', onStorage);
  };
}

/** Sólo para tests: olvida la caché en memoria. */
export function resetInboxDismissalsCache() {
  memory.clear();
  storageWorks = true;
}

export function useInboxDismissals(userId: string | null | undefined) {
  const id = userId ?? 'anon';
  const marks = useSyncExternalStore(subscribe, () => load(id), () => EMPTY);

  const dismiss = useCallback((key: string) => save(id, { ...load(id), [key]: new Date().toISOString() }), [id]);
  const restore = useCallback(
    (key: string) => {
      const next = { ...load(id) };
      delete next[key];
      save(id, next);
    },
    [id],
  );
  const restoreAll = useCallback((keys: readonly string[]) => {
    const next = { ...load(id) };
    for (const k of keys) delete next[k];
    save(id, next);
  }, [id]);

  const done = useMemo(() => new Set(Object.keys(marks)), [marks]);
  return { done, dismiss, restore, restoreAll, persistent: storageWorks };
}
