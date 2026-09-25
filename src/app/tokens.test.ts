import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

/*
 * E08 · Contraste de los tokens (WCAG 2.2 · 1.4.3, texto normal ≥ 4.5:1).
 *
 * Mide los colores DECLARADOS; la verificación renderizada vive en las capturas
 * de `e2e/executive`. Los colores de marca (#5AA97F, #056769, #0A5A52) no se
 * tocan: quedan para rellenos, barras e isotipo. El texto y los botones usan
 * variantes funcionales accesibles.
 */
const css = readFileSync(resolve(process.cwd(), 'src/app/tokens.css'), 'utf8');
const indexCss = readFileSync(resolve(process.cwd(), 'src/app/index.css'), 'utf8');

function block(selector: string): Record<string, string> {
  const start = css.indexOf(`${selector} {`);
  if (start < 0) throw new Error(`No existe el bloque ${selector}`);
  const body = css.slice(start, css.indexOf('}', start));
  const out: Record<string, string> = {};
  for (const m of body.matchAll(/--([a-z0-9-]+):\s*(#[0-9a-fA-F]{6})/g)) out[m[1]!] = m[2]!;
  return out;
}

const light = block(':root');
const dark = { ...light, ...block(":root[data-theme='dark']") };

function luminance(hex: string): number {
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255) as [number, number, number];
  const f = (c: number) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
  return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
}

function contrast(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x) as [number, number];
  return (hi + 0.05) / (lo + 0.05);
}

const TEXT_PAIRS: Array<[string, string]> = [
  ['text', 'bg'], ['text', 'card'],
  ['muted', 'bg'], ['muted', 'card'],
  ['accent-deep', 'card'], ['accent-deep', 'bg'], ['accent-deep', 'accent-soft'],
  ['ok', 'card'], ['ok', 'ok-soft'],
  ['warn', 'card'], ['warn', 'warn-soft'],
  ['danger', 'card'], ['danger', 'danger-soft'],
  ['info', 'card'], ['info', 'info-soft'],
  ['accent-action-fg', 'accent-action'],
];

describe.each([
  ['claro', light],
  ['oscuro', dark],
])('Contraste en modo %s', (_name, tokens) => {
  it.each(TEXT_PAIRS)('%s sobre %s ≥ 4.5:1', (fg, bg) => {
    expect(tokens[fg], `falta --${fg}`).toBeDefined();
    expect(tokens[bg], `falta --${bg}`).toBeDefined();
    expect(contrast(tokens[fg]!, tokens[bg]!)).toBeGreaterThanOrEqual(4.5);
  });

  it('botón peligroso: blanco sobre --danger-fill ≥ 4.5:1', () => {
    expect(contrast('#ffffff', tokens['danger-fill']!)).toBeGreaterThanOrEqual(4.5);
  });
});

describe('Identidad EBIM conservada', () => {
  it('verde, teal e isotipo de marca siguen declarados', () => {
    expect(light.accent?.toLowerCase()).toBe('#5aa97f');
    expect(light.accent2?.toLowerCase()).toBe('#056769');
    expect(light['brand-mark']?.toLowerCase()).toBe('#0a5a52');
  });

  it('densidades contractuales 40/52/12/14 · 36/44/9/12 · 32/38/6/10', () => {
    const d = (name: string) => css.slice(css.indexOf(`:root[data-density='${name}']`)).split('}')[0]!;
    expect(d('comoda')).toMatch(/--control-h: 40px;[\s\S]*--row-h: 52px;[\s\S]*--pad-y: 12px;[\s\S]*--pad-x: 14px;/);
    expect(d('equilibrada')).toMatch(/--control-h: 36px;[\s\S]*--row-h: 44px;[\s\S]*--pad-y: 9px;[\s\S]*--pad-x: 12px;/);
    expect(d('compacta')).toMatch(/--control-h: 32px;[\s\S]*--row-h: 38px;[\s\S]*--pad-y: 6px;[\s\S]*--pad-x: 10px;/);
  });
});

describe('Sistema de botones (E07)', () => {
  it('ebim-btn-secondary existe exactamente una vez', () => {
    expect(indexCss.match(/\.ebim-btn-secondary\s*\{/g)?.length).toBe(1);
  });

  it('el primario no usa el verde de marca como fondo de texto blanco (2.83:1)', () => {
    const primary = indexCss.slice(indexCss.indexOf('.ebim-btn-primary {')).split('}')[0]!;
    expect(primary).toContain('--accent-action');
  });
});
