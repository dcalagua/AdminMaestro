import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { FORBIDDEN_UI_TERMS, GLOSSARY, SQL_OBJECT_NAME, term } from './glossary';
import { visibleTexts, withoutIdentifiers } from './visibleText';

/*
 * V5 · F1 · Glosario de negocio. La jerga técnica (DRY_RUN, provisioning,
 * entitlements, cutover, slug, shadow, M2M, «contrato §») no vuelve a la UI de
 * negocio. Lo que el super admin necesite va a un tooltip (atributo `title`
 * de un elemento HTML) o a «Avanzado».
 */
const ROOT = resolve(process.cwd(), 'src');

/** Fuera del alcance: la galería interna de componentes y los tests. */
const EXCLUDED = [/^src\/features\/design\//, /\.test\.tsx?$/, /^src\/types\//, /^src\/lib\/(glossary|visibleText)\.ts$/];

function sources(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return sources(path);
    return /\.tsx?$/.test(name) ? [path] : [];
  });
}

const files = sources(ROOT)
  .map((path) => ({ path: relative(process.cwd(), path), abs: path }))
  .filter((f) => !EXCLUDED.some((re) => re.test(f.path)));

describe('glosario de negocio (V5 · F1)', () => {
  it('traduce los términos acordados', () => {
    expect(term('dryRun')).toBe('Simulación');
    expect(term('provisioning')).toBe('Alta en la app');
    expect(term('provisioning', { plural: true })).toBe('Altas en las apps');
    expect(term('entitlements')).toBe('Módulos habilitados');
    expect(term('cutover')).toBe('Migración de cobro');
    expect(term('slug')).toBe('Código');
    expect(term('shadow', { lower: true })).toBe('comparación');
    expect(term('m2m')).toBe('Conexión segura');
    expect(GLOSSARY.tenant.business).toBe('Tenant');
  });

  it('los textos visibles no usan la jerga técnica', () => {
    const offenders = files.flatMap((f) =>
      visibleTexts(f.path, readFileSync(f.abs, 'utf8')).flatMap(({ line, text }) => {
        const clean = withoutIdentifiers(text);
        const jargon = FORBIDDEN_UI_TERMS.some((re) => re.test(clean)) || SQL_OBJECT_NAME.test(text);
        return jargon ? [`${f.path}:${line} ${text}`] : [];
      }),
    );
    expect(offenders).toEqual([]);
  });

  it('el extractor ve texto JSX, props y etiquetas, pero no tooltips ni código', () => {
    const sample = `
      const STATUS_LABEL = { DRY: 'Prueba DRY_RUN' };
      export function X() {
        return (
          <Card title="Entitlements" description={ok ? 'Slug libre' : 'otro'}>
            <span title="Cutover técnico" className="shadow-card">Texto del shadow</span>
            <Link to="/saas-provisioning">Ir</Link>
          </Card>
        );
      }`;
    const texts = visibleTexts('x.tsx', sample).map((t) => t.text);
    expect(texts).toEqual(expect.arrayContaining(['Prueba DRY_RUN', 'Entitlements', 'Slug libre', 'Texto del shadow']));
    expect(texts).not.toContain('Cutover técnico');
    expect(texts).not.toContain('shadow-card');
    expect(texts).not.toContain('/saas-provisioning');
    expect(withoutIdentifiers('Usa EWM_QAS_M2M_PRIVATE_KEY o ewm-provisioning-v1')).not.toMatch(/M2M|provisioning/);
  });
});
