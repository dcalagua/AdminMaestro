import { describe, expect, it } from 'vitest';
import { initialsOf } from './initials';

describe('initialsOf', () => {
  it('organizaciones: dos primeras palabras, sin sufijos societarios', () => {
    expect(initialsOf('Transportes Qhapaq Cargo')).toBe('TQ');
    expect(initialsOf('GRUPASA')).toBe('GR');
    expect(initialsOf('Agrícola Chincha Sol S.A.C.')).toBe('AC');
    expect(initialsOf('Ñandú S.R.L.')).toBe('ÑA');
  });

  it('personas y correos: primera y última palabra', () => {
    expect(initialsOf('Dennis Calagua (Operador)', 'person')).toBe('DC');
    expect(initialsOf('ana.perez@x.com', 'person')).toBe('AP');
    expect(initialsOf('   ')).toBe('?');
  });
});
