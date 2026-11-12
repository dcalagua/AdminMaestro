/**
 * Modo presentación del Resumen Ejecutivo (fase 14): lógica pura, sin React.
 *
 * Las diapositivas son los MISMOS paneles del tablero, en el orden de lectura
 * de D-V05; aquí solo viven su orden, la traducción de teclas a acciones y los
 * alias con los que se ocultan los nombres de clientes y partners.
 */

export const PRESENTATION_PARAM = 'presentacion';
export const SLIDE_PARAM = 'diapositiva';
export const MASK_PARAM = 'anonimo';
/** Parámetros que pertenecen al modo presentación (se quitan al salir). */
export const PRESENTATION_PARAMS = [PRESENTATION_PARAM, SLIDE_PARAM, MASK_PARAM] as const;

export const AUTOPLAY_MS = 20_000;

export type SlideId = 'kpis' | 'mrr' | 'puente' | 'cobranza' | 'mix' | 'tops';

export interface SlideDef {
  id: SlideId;
  title: string;
}

export const SLIDES: readonly SlideDef[] = [
  { id: 'kpis', title: 'Indicadores clave' },
  { id: 'mrr', title: 'Evolución del MRR' },
  { id: 'puente', title: 'Puente de MRR del mes' },
  { id: 'cobranza', title: 'Facturado vs cobrado y cartera' },
  { id: 'mix', title: 'Mix por producto y mercado' },
  { id: 'tops', title: 'Top clientes y partners' },
];

/** `?diapositiva=N` (1-based) → índice válido; cualquier otra cosa abre la primera. */
export function slideIndexFrom(raw: string | null, count = SLIDES.length): number {
  const n = Number(raw);
  return Number.isInteger(n) && n >= 1 && n <= count ? n - 1 : 0;
}

export function isPresentationParam(raw: string | null): boolean {
  return raw === '1' || raw === 'true' || raw === 'si';
}

/* ---- Teclado ---------------------------------------------------------------------- */

export type PresentationAction =
  | { type: 'next' }
  | { type: 'prev' }
  | { type: 'first' }
  | { type: 'last' }
  | { type: 'goto'; index: number }
  | { type: 'exit' }
  | { type: 'print' };

export interface KeyInput {
  key: string;
  shiftKey?: boolean;
  ctrlKey?: boolean;
  metaKey?: boolean;
  altKey?: boolean;
  /** Elemento con el foco cuando se pulsó la tecla. */
  target?: EventTarget | null;
}

/** Campos donde las flechas y el espacio pertenecen al control, no a la presentación. */
function isEditable(target: EventTarget | null | undefined): boolean {
  if (!target || typeof (target as HTMLElement).tagName !== 'string') return false;
  const el = target as HTMLElement;
  return el.isContentEditable || ['INPUT', 'SELECT', 'TEXTAREA'].includes(el.tagName);
}

/** Botones y enlaces: espacio y Enter los activan (no se roban). */
function isActivatable(target: EventTarget | null | undefined): boolean {
  if (!target || typeof (target as HTMLElement).tagName !== 'string') return false;
  const el = target as HTMLElement;
  return (
    ['BUTTON', 'A', 'SUMMARY'].includes(el.tagName) ||
    ['button', 'link', 'switch', 'menuitem', 'tab'].includes(el.getAttribute('role') ?? '')
  );
}

/**
 * Traduce una tecla a una acción del modo presentación (o null si no le toca).
 * Flechas, Av/Re Pág y espacio navegan; Inicio/Fin y 1–9 saltan; Esc sale;
 * Ctrl/⌘+P imprime todas las diapositivas (en vez de solo la visible).
 */
export function presentationKeyAction(
  e: KeyInput,
  count = SLIDES.length,
): PresentationAction | null {
  if ((e.ctrlKey || e.metaKey) && !e.altKey && e.key.toLowerCase() === 'p')
    return { type: 'print' };
  if (e.ctrlKey || e.metaKey || e.altKey) return null;
  if (e.key === 'Escape') return { type: 'exit' };
  if (isEditable(e.target)) return null;
  switch (e.key) {
    case 'ArrowRight':
    case 'ArrowDown':
    case 'PageDown':
      return { type: 'next' };
    case 'ArrowLeft':
    case 'ArrowUp':
    case 'PageUp':
      return { type: 'prev' };
    case 'Home':
      return { type: 'first' };
    case 'End':
      return { type: 'last' };
    case ' ':
    case 'Spacebar':
      if (isActivatable(e.target)) return null;
      return { type: e.shiftKey ? 'prev' : 'next' };
    default:
      if (/^[1-9]$/.test(e.key) && Number(e.key) <= count)
        return { type: 'goto', index: Number(e.key) - 1 };
      return null;
  }
}

/** Aplica una acción de navegación sin salirse de [0, count). Avanzar en la última no da la vuelta. */
export function nextIndex(
  current: number,
  action: PresentationAction,
  count = SLIDES.length,
): number {
  switch (action.type) {
    case 'next':
      return Math.min(count - 1, current + 1);
    case 'prev':
      return Math.max(0, current - 1);
    case 'first':
      return 0;
    case 'last':
      return count - 1;
    case 'goto':
      return Math.min(count - 1, Math.max(0, action.index));
    default:
      return current;
  }
}

/** Reproducción automática: avanza y, tras la última, vuelve a la primera. */
export function autoplayIndex(current: number, count = SLIDES.length): number {
  return (current + 1) % count;
}

/* ---- Ocultar nombres ---------------------------------------------------------------- */

/** 0 → A, 25 → Z, 26 → AA, 27 → AB… (como las columnas de una hoja de cálculo). */
export function letterLabel(index: number): string {
  let n = Math.max(0, Math.floor(index));
  let out = '';
  do {
    out = String.fromCharCode(65 + (n % 26)) + out;
    n = Math.floor(n / 26) - 1;
  } while (n >= 0);
  return out;
}

export interface Ranked {
  id: string;
  /** Importe por el que se ordena (mayor primero); null va al final. */
  weight: number | null;
  /** Desempate estable (por ejemplo el nombre real, que no se muestra). */
  tieBreak?: string | null;
}

/**
 * Alias estables «<Prefijo> A, B…» por orden de importe: el mayor es «A». Se
 * construyen UNA vez con la lista completa del mes, así un mismo cliente se
 * llama igual en todas las diapositivas (top, puente) y en la impresión.
 */
export function buildAliases(rows: readonly Ranked[], prefix: string): Map<string, string> {
  const seen = new Set<string>();
  const unique = rows.filter((r) => (seen.has(r.id) ? false : (seen.add(r.id), true)));
  const ordered = [...unique].sort(
    (a, b) =>
      (b.weight ?? Number.NEGATIVE_INFINITY) - (a.weight ?? Number.NEGATIVE_INFINITY) ||
      (a.tieBreak ?? '').localeCompare(b.tieBreak ?? '') ||
      a.id.localeCompare(b.id),
  );
  return new Map(ordered.map((r, i) => [r.id, `${prefix} ${letterLabel(i)}`]));
}

/** Nombre a mostrar: el alias si se ocultan nombres (nunca el real), o el nombre. */
export function displayName(
  aliases: Map<string, string> | null,
  id: string,
  name: string,
  fallbackPrefix: string,
): string {
  if (!aliases) return name;
  return aliases.get(id) ?? `${fallbackPrefix} sin identificar`;
}
