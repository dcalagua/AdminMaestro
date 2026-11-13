import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { TEMPLATES, TEMPLATE_KEYS, placeholdersOf } from './catalog';

/*
 * El catálogo es la fuente de las plantillas publicadas en MailHub. Aquí se fija
 * que cada plantilla declare lo que usa (MailHub no publica variables no
 * declaradas), que su muestra las cubra, y que la migración solo encole
 * plantillas y variables que existen.
 */
const MIGRATION = readFileSync(
  resolve(__dirname, '../../../migrations/20261022000100_mail_outbox.sql'),
  'utf8',
);

describe('catálogo de plantillas masteradmin-*', () => {
  it('claves únicas con el prefijo de la app', () => {
    expect(new Set(TEMPLATE_KEYS).size).toBe(TEMPLATE_KEYS.length);
    for (const k of TEMPLATE_KEYS) expect(k).toMatch(/^masteradmin-[a-z0-9-]{2,60}$/);
  });

  it.each(TEMPLATES.map((t) => [t.key, t] as const))('%s: declara todo lo que usa y su muestra lo cubre', (_k, t) => {
    const declared = t.variables.map((v) => v.name);
    for (const p of placeholdersOf(t)) {
      expect(declared, `${t.key} usa {{${p}}}`).toContain(p);
      expect(t.sample, `${t.key} muestra ${p}`).toHaveProperty(p);
    }
    // Asunto sin saltos de línea; botones con una variable o https.
    expect(t.subject).not.toMatch(/[\r\n]/);
    for (const b of t.blocks) if (b.type === 'button') expect(b.url).toMatch(/^(\{\{\s*\w+\s*\}\}|https:\/\/)/);
  });

  it('cada plantilla que encola la migración existe y recibe sus variables', () => {
    const used = [...MIGRATION.matchAll(/'(masteradmin-[a-z0-9-]+)'/g)].map((m) => m[1]);
    expect(used.length).toBeGreaterThan(5);
    for (const key of new Set(used)) expect(TEMPLATE_KEYS, key).toContain(key);
    // Variables de negocio que arma SQL (las de pago las agrega mail-dispatch).
    const fromSql: Record<string, string[]> = {
      'masteradmin-factura-emitida': ['cliente', 'numero', 'periodo', 'emision', 'vencimiento', 'monto'],
      'masteradmin-pago-confirmado': ['cliente', 'numero', 'monto', 'fecha_pago', 'medio', 'referencia', 'saldo', 'estado_factura'],
      'masteradmin-factura-vencida': ['cliente', 'numero', 'vencimiento', 'dias_vencida', 'saldo'],
      'masteradmin-tenant-suspendido': ['cliente', 'tenant', 'app', 'fecha', 'motivo'],
      'masteradmin-tenant-reactivado': ['cliente', 'tenant', 'app', 'fecha'],
      'masteradmin-tenant-bienvenida': ['cliente', 'tenant', 'app', 'email', 'ambiente', 'como_ingresar'],
      'masteradmin-ops-resumen': ['titulo', 'motivo', 'diferencias_nuevas', 'diferencias_abiertas', 'altas_fallidas', 'fecha', 'enlace'],
    };
    const linkVars = ['enlace_pago', 'vence_enlace'];
    for (const [key, vars] of Object.entries(fromSql)) {
      const t = TEMPLATES.find((x) => x.key === key)!;
      const expected = t.variables.map((v) => v.name).filter((n) => !linkVars.includes(n)).sort();
      expect(vars.slice().sort(), key).toEqual(expected);
      for (const v of vars) expect(MIGRATION, `${key}:${v}`).toContain(`'${v}'`);
    }
  });
});
