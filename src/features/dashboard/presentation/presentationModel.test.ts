import { describe, expect, it } from 'vitest';
import {
  autoplayIndex,
  buildAliases,
  displayName,
  isPresentationParam,
  letterLabel,
  nextIndex,
  presentationKeyAction,
  slideIndexFrom,
  SLIDES,
} from './presentationModel';

const el = (tagName: string, attrs: Record<string, string> = {}) =>
  ({
    tagName,
    isContentEditable: false,
    getAttribute: (k: string) => attrs[k] ?? null,
  }) as unknown as HTMLElement;

describe('modo presentación · diapositivas', () => {
  it('seis diapositivas en el orden de lectura del tablero', () => {
    expect(SLIDES.map((s) => s.id)).toEqual(['kpis', 'mrr', 'puente', 'cobranza', 'mix', 'tops']);
  });

  it('?diapositiva=N es 1-based; fuera de rango o basura abre la primera', () => {
    expect(slideIndexFrom('3')).toBe(2);
    expect(slideIndexFrom('6')).toBe(5);
    for (const raw of [null, '', '0', '7', '2.5', 'dos', '-1']) expect(slideIndexFrom(raw)).toBe(0);
  });

  it('solo «1/true/si» activan el modo', () => {
    expect(isPresentationParam('1')).toBe(true);
    expect(isPresentationParam('si')).toBe(true);
    expect(isPresentationParam('0')).toBe(false);
    expect(isPresentationParam(null)).toBe(false);
  });

  it('navegar no se sale de los límites; la reproducción automática sí da la vuelta', () => {
    expect(nextIndex(5, { type: 'next' })).toBe(5);
    expect(nextIndex(0, { type: 'prev' })).toBe(0);
    expect(nextIndex(2, { type: 'next' })).toBe(3);
    expect(nextIndex(2, { type: 'last' })).toBe(5);
    expect(nextIndex(4, { type: 'first' })).toBe(0);
    expect(nextIndex(0, { type: 'goto', index: 9 })).toBe(5);
    expect(autoplayIndex(4)).toBe(5);
    expect(autoplayIndex(5)).toBe(0);
  });
});

describe('modo presentación · teclado', () => {
  it('flechas, Av/Re Pág, espacio, Inicio/Fin y números', () => {
    expect(presentationKeyAction({ key: 'ArrowRight' })).toEqual({ type: 'next' });
    expect(presentationKeyAction({ key: 'ArrowDown' })).toEqual({ type: 'next' });
    expect(presentationKeyAction({ key: 'PageDown' })).toEqual({ type: 'next' });
    expect(presentationKeyAction({ key: ' ' })).toEqual({ type: 'next' });
    expect(presentationKeyAction({ key: ' ', shiftKey: true })).toEqual({ type: 'prev' });
    expect(presentationKeyAction({ key: 'ArrowLeft' })).toEqual({ type: 'prev' });
    expect(presentationKeyAction({ key: 'PageUp' })).toEqual({ type: 'prev' });
    expect(presentationKeyAction({ key: 'Home' })).toEqual({ type: 'first' });
    expect(presentationKeyAction({ key: 'End' })).toEqual({ type: 'last' });
    expect(presentationKeyAction({ key: '4' })).toEqual({ type: 'goto', index: 3 });
    expect(presentationKeyAction({ key: '7' })).toBeNull();
    expect(presentationKeyAction({ key: 'a' })).toBeNull();
  });

  it('Esc sale y Ctrl/⌘+P imprime todas las diapositivas', () => {
    expect(presentationKeyAction({ key: 'Escape' })).toEqual({ type: 'exit' });
    expect(presentationKeyAction({ key: 'p', ctrlKey: true })).toEqual({ type: 'print' });
    expect(presentationKeyAction({ key: 'P', metaKey: true })).toEqual({ type: 'print' });
    // Otros atajos del navegador no se tocan.
    expect(presentationKeyAction({ key: 'ArrowRight', altKey: true })).toBeNull();
    expect(presentationKeyAction({ key: 'r', metaKey: true })).toBeNull();
  });

  it('no roba las teclas a campos ni el espacio a botones y enlaces', () => {
    expect(presentationKeyAction({ key: 'ArrowRight', target: el('SELECT') })).toBeNull();
    expect(presentationKeyAction({ key: ' ', target: el('INPUT') })).toBeNull();
    expect(presentationKeyAction({ key: ' ', target: el('BUTTON') })).toBeNull();
    expect(presentationKeyAction({ key: ' ', target: el('A') })).toBeNull();
    expect(presentationKeyAction({ key: ' ', target: el('DIV', { role: 'switch' }) })).toBeNull();
    // Las flechas sí navegan aunque el foco esté en un botón de la barra.
    expect(presentationKeyAction({ key: 'ArrowRight', target: el('BUTTON') })).toEqual({
      type: 'next',
    });
    // Esc sale incluso desde un campo.
    expect(presentationKeyAction({ key: 'Escape', target: el('SELECT') })).toEqual({
      type: 'exit',
    });
  });
});

describe('modo presentación · ocultar nombres', () => {
  it('letras como columnas de hoja de cálculo', () => {
    expect([0, 1, 25, 26, 27, 51, 52, 701, 702].map(letterLabel)).toEqual([
      'A',
      'B',
      'Z',
      'AA',
      'AB',
      'AZ',
      'BA',
      'ZZ',
      'AAA',
    ]);
  });

  it('el mayor importe es «A»; empate por nombre real; ids repetidos cuentan una vez', () => {
    const aliases = buildAliases(
      [
        { id: 'o2', weight: 4600, tieBreak: 'Transportes Sajama' },
        { id: 'o1', weight: 5700, tieBreak: 'Minera Cordillera' },
        { id: 'o4', weight: 0, tieBreak: 'Baja SRL' },
        { id: 'o5', weight: 0, tieBreak: 'Alfa SAC' },
        { id: 'o1', weight: 5700, tieBreak: 'Minera Cordillera' },
        { id: 'o9', weight: null, tieBreak: 'Sin tasa' },
      ],
      'Cliente',
    );
    expect(Object.fromEntries(aliases)).toEqual({
      o1: 'Cliente A',
      o2: 'Cliente B',
      o5: 'Cliente C',
      o4: 'Cliente D',
      o9: 'Cliente E',
    });
  });

  it('con nombres ocultos nunca devuelve el nombre real, aunque el id no tenga alias', () => {
    const aliases = buildAliases([{ id: 'p1', weight: 10 }], 'Partner');
    expect(displayName(aliases, 'p1', 'Andes Digital', 'Partner')).toBe('Partner A');
    expect(displayName(aliases, 'p9', 'Otro Real SAC', 'Partner')).toBe('Partner sin identificar');
    expect(displayName(null, 'p1', 'Andes Digital', 'Partner')).toBe('Andes Digital');
  });
});
