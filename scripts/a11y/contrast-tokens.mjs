#!/usr/bin/env node
/**
 * Contraste WCAG de los pares texto/fondo de `src/app/tokens.css`, en claro y
 * en oscuro (U-10). Lee los hex de cada tema (el oscuro hereda lo que no
 * redefine) y falla con código 1 si algún par de TEXTO queda bajo 4.5:1 o un
 * par de UI (bordes de control, foco, indicadores) bajo 3:1.
 *
 *   node scripts/a11y/contrast-tokens.mjs          # tabla + resumen
 *   node scripts/a11y/contrast-tokens.mjs --json   # para evidencia
 *
 * Los colores con alfa se componen sobre su fondo antes de medir.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const css = readFileSync(resolve(process.cwd(), 'src/app/tokens.css'), 'utf8');

function block(selector) {
  const start = css.indexOf(selector);
  if (start < 0) throw new Error(`No se encontró ${selector} en tokens.css`);
  const open = css.indexOf('{', start);
  let depth = 0;
  for (let i = open; i < css.length; i += 1) {
    if (css[i] === '{') depth += 1;
    if (css[i] === '}') depth -= 1;
    if (depth === 0) return css.slice(open + 1, i);
  }
  throw new Error(`Bloque sin cerrar: ${selector}`);
}

function vars(text) {
  const out = {};
  for (const m of text.matchAll(/--([a-z0-9-]+):\s*(#[0-9a-fA-F]{6}|rgba?\([^)]*\))\s*;/g))
    out[m[1]] = m[2];
  return out;
}

const light = vars(block(':root {'));
const dark = { ...light, ...vars(block(":root[data-theme='dark'] {")) };

function rgba(value) {
  if (value.startsWith('#')) {
    const n = parseInt(value.slice(1), 16);
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255, 1];
  }
  const [r, g, b, a = 1] = value
    .replace(/rgba?\(|\)/g, '')
    .split(',')
    .map(Number);
  return [r, g, b, a];
}

function over(fg, bg) {
  const [r, g, b, a] = fg;
  return [0, 1, 2].map((i) => Math.round([r, g, b][i] * a + bg[i] * (1 - a)));
}

function luminance([r, g, b]) {
  const ch = (c) => {
    const s = c / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * ch(r) + 0.7152 * ch(g) + 0.0722 * ch(b);
}

function ratio(fgValue, bgValue) {
  const bg = rgba(bgValue);
  const fg = over(rgba(fgValue), bg);
  const [l1, l2] = [luminance(fg), luminance(bg)].sort((a, b) => b - a);
  return (l1 + 0.05) / (l2 + 0.05);
}

const SURFACES = ['bg', 'card', 'sunken', 'elevated', 'hover'];
const TEXT = ['text', 'text-2', 'muted', 'accent-deep', 'ok', 'warn', 'danger', 'info'];

/** [texto, fondo, mínimo, motivo] */
const PAIRS = [
  ...TEXT.flatMap((t) => SURFACES.map((s) => [t, s, 4.5, 'texto sobre superficie'])),
  ['ok', 'ok-soft', 4.5, 'insignia'],
  ['warn', 'warn-soft', 4.5, 'insignia'],
  ['danger', 'danger-soft', 4.5, 'insignia'],
  ['info', 'info-soft', 4.5, 'insignia'],
  ['accent-deep', 'accent-soft', 4.5, 'insignia / ítem activo'],
  ['text-2', 'accent-soft', 4.5, 'texto en zona de marca suave'],
  ['accent-action-fg', 'accent-action', 4.5, 'botón primario'],
  ['accent-action-fg', 'accent-action-hover', 4.5, 'botón primario (hover)'],
  ['danger-fill-fg', 'danger-fill', 4.5, 'botón peligroso'],
  ['danger-fill-fg', 'danger-fill-hover', 4.5, 'botón peligroso (hover)'],
  ['on-brand', 'sidebar-base', 4.5, 'texto del sidebar'],
  ['on-brand', 'auth-panel-to', 4.5, 'panel de acceso (tramo claro)'],
  ['on-brand-2', 'auth-panel-to', 4.5, 'texto secundario del panel'],
  ['brand-highlight', 'auth-panel-to', 4.5, 'inicial del wordmark'],
  ['border-strong', 'card', 3, 'borde de control (UI)'],
  ['focus', 'bg', 3, 'anillo de foco (UI)'],
  ['focus', 'card', 3, 'anillo de foco (UI)'],
  ['sidebar-indicator', 'sidebar-base', 3, 'indicador activo (UI)'],
];

const results = [];
for (const [theme, tokens] of [
  ['claro', light],
  ['oscuro', dark],
]) {
  for (const [fg, bg, min, why] of PAIRS) {
    if (!tokens[fg] || !tokens[bg]) continue;
    const value = ratio(tokens[fg], tokens[bg]);
    results.push({
      theme,
      fg,
      bg,
      ratio: Math.round(value * 100) / 100,
      min,
      why,
      ok: value >= min,
    });
  }
}

const failures = results.filter((r) => !r.ok);
if (process.argv.includes('--json')) {
  console.log(
    JSON.stringify({ total: results.length, failures: failures.length, results }, null, 2),
  );
} else {
  for (const r of results) {
    console.log(
      `${r.ok ? 'OK  ' : 'FAIL'} ${r.theme.padEnd(6)} ${`--${r.fg}`.padEnd(22)} sobre ${`--${r.bg}`.padEnd(22)} ${r.ratio
        .toFixed(2)
        .padStart(5)}:1 (mín ${r.min}) · ${r.why}`,
    );
  }
  console.log(
    `\nCONTRASTE: ${results.length - failures.length}/${results.length} pares cumplen AA.`,
  );
}
process.exit(failures.length ? 1 : 0);
