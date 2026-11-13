import { describe, expect, it } from 'vitest';
import { businessErrorMessage, parseBusinessError } from './pgError';

describe('pgError', () => {
  it('separa el prefijo canónico del mensaje', () => {
    expect(parseBusinessError({ message: 'NO_AUTORIZADO: no puedes' })).toMatchObject({ code: 'NO_AUTORIZADO', message: 'no puedes' });
  });

  it('una vista o función que aún no existe en el entorno se dice en español (V6 · F5)', () => {
    const table = { code: 'PGRST205', message: "Could not find the table 'platform.v_tenant_sync_targets' in the schema cache" };
    expect(businessErrorMessage(table)).toBe('Esta información todavía no está disponible en este entorno. Avisa al equipo de plataforma.');
    expect(businessErrorMessage({ code: 'PGRST202', message: 'Could not find the function' })).toMatch(/todavía no está disponible/);
  });
});
