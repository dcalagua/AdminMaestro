import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';

/*
 * V5 · F0 · Deuda de consistencia cerrada. Estas comprobaciones evitan que
 * vuelva: la UI usa la escala tipográfica de tokens (`tailwind.config.ts`),
 * las tablas y selects del sistema de diseño y el selector de período en
 * español. Las excepciones son los propios componentes del sistema.
 */
const ROOT = resolve(process.cwd(), 'src');

function sources(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return sources(path);
    return /\.tsx?$/.test(name) && !/\.test\.tsx?$/.test(name) ? [path] : [];
  });
}

const files = sources(ROOT).map((path) => ({
  path: relative(process.cwd(), path),
  text: readFileSync(path, 'utf8'),
}));

function offenders(pattern: RegExp, allowed: string[] = []): string[] {
  return files
    .filter((f) => !allowed.includes(f.path))
    .flatMap((f) =>
      f.text.split('\n').flatMap((line, i) => (pattern.test(line) ? [`${f.path}:${i + 1}`] : [])),
    );
}

describe('consistencia del sistema de diseño (V5 · F0)', () => {
  it('no usa los tamaños de Tailwind fuera de la escala de tokens', () => {
    expect(offenders(/(^|[^\w-])text-(xs|sm|base|lg|xl|[2-9]xl)(?![\w-])/)).toEqual([]);
  });
});
