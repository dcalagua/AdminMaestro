import { useEffect, useState } from 'react';

/**
 * Buscador con retardo: el texto se edita localmente y se publica en la URL
 * (y, por tanto, en la consulta) tras una pausa. Si la URL cambia desde fuera
 * (enlace, atrás/adelante), el borrador se alinea con ella.
 */
export function useDebouncedSearch(value: string, onCommit: (next: string) => void, delay = 300) {
  const [draft, setDraft] = useState(value);
  const [synced, setSynced] = useState(value);
  if (value !== synced) {
    setSynced(value);
    setDraft(value);
  }
  useEffect(() => {
    if (draft === value) return undefined;
    const timer = window.setTimeout(() => onCommit(draft), delay);
    return () => window.clearTimeout(timer);
  }, [draft, value, onCommit, delay]);
  return [draft, setDraft] as const;
}

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

/** Acepta sólo `YYYY-MM-DD` válido; cualquier otra cosa se ignora. */
export function parseIsoDate(value: string): string {
  if (!ISO_DATE.test(value)) return '';
  const [y, m, d] = value.split('-').map(Number) as [number, number, number];
  const date = new Date(y, m - 1, d);
  return date.getFullYear() === y && date.getMonth() === m - 1 && date.getDate() === d ? value : '';
}
