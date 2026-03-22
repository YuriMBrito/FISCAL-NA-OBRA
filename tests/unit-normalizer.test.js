import { describe, it, expect } from 'vitest';
import { classUnd, normalizeUnd, dimensionFlags } from '../utils/unit-normalizer.js';

describe('classUnd', () => {
  const casos = [
    ['m²','m2'], ['m2','m2'], ['M2','m2'], ['M²','m2'],
    ['m³','m3'], ['m3','m3'], ['M3','m3'], ['M³','m3'],
    ['m','m'],   ['M','m'],
    ['un','un'], ['vb','un'], ['cj','un'], ['kg','un'],
    ['','un'],   [undefined,'un'], [null,'un'],
  ];
  casos.forEach(([input, expected]) => {
    it(`classUnd("${input}") → "${expected}"`, () =>
      expect(classUnd(input)).toBe(expected));
  });
});

describe('normalizeUnd', () => {
  it('normaliza m2 → m²', () => expect(normalizeUnd('m2')).toBe('m²'));
  it('normaliza M2 → m²', () => expect(normalizeUnd('M2')).toBe('m²'));
  it('normaliza m3 → m³', () => expect(normalizeUnd('M³')).toBe('m³'));
  it('normaliza m → m', () => expect(normalizeUnd('m')).toBe('m'));
  it('preserva unidade desconhecida', () => expect(normalizeUnd('vb')).toBe('vb'));
  it('retorna "un" para vazio', () => expect(normalizeUnd('')).toBe('un'));
});

describe('dimensionFlags', () => {
  it('m² precisa de comp e larg', () => {
    const f = dimensionFlags('m²');
    expect(f.needsComp).toBe(true);
    expect(f.needsLarg).toBe(true);
    expect(f.needsAlt).toBe(false);
  });
  it('m³ precisa de comp, larg e alt', () => {
    const f = dimensionFlags('m³');
    expect(f.needsComp).toBe(true);
    expect(f.needsLarg).toBe(true);
    expect(f.needsAlt).toBe(true);
  });
  it('m linear precisa só de comp', () => {
    const f = dimensionFlags('m');
    expect(f.needsComp).toBe(true);
    expect(f.needsLarg).toBe(false);
    expect(f.needsAlt).toBe(false);
  });
  it('un não precisa de dimensões', () => {
    const f = dimensionFlags('un');
    expect(f.needsComp).toBe(false);
    expect(f.needsLarg).toBe(false);
    expect(f.needsAlt).toBe(false);
  });
});
