/**
 * V6 · F5 · `ref` para un texto que puede cortarse (`truncate`, `line-clamp`)
 * cuando su contenido es un nodo y no hay un `title` explícito: el `title` pasa
 * a ser el texto que pinta. Así una línea cortada siempre se puede leer
 * entera al pasar el puntero (la guarda `e2e/visual/solapes.spec.ts` lo vigila).
 */
export function autoTitle(el: HTMLElement | null): void {
  if (!el || el.hasAttribute('data-title-explicit')) return;
  const text = el.textContent?.replace(/\s+/g, ' ').trim() ?? '';
  if (text && el.title !== text) el.title = text;
}
