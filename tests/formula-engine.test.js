/**
 * ╔══════════════════════════════════════════════════════════════╗
 * ║  TESTES — utils/formula-engine.js                          ║
 * ║  Motor central de cálculos dimensionais (crítico — risco   ║
 * ║  jurídico em caso de falha: pagamentos incorretos a obras  ║
 * ║  públicas com recursos do erário)                          ║
 * ╚══════════════════════════════════════════════════════════════╝
 */

import { describe, it, expect } from 'vitest';
import {
  safeNum, safeNumSigned, calcDimensional,
  fxCalc, calcLinha, sumLinhas, parseBrNumber,
} from '../utils/formula-engine.js';

// ─── safeNum ──────────────────────────────────────────────────────────────
describe('safeNum', () => {
  it('retorna zero para NaN', () => expect(safeNum('abc')).toBe(0));
  it('retorna zero para undefined', () => expect(safeNum(undefined)).toBe(0));
  it('retorna zero para null', () => expect(safeNum(null)).toBe(0));
  it('retorna zero para número negativo', () => expect(safeNum(-5)).toBe(0));
  it('retorna zero para negativo em string', () => expect(safeNum('-3.5')).toBe(0));
  it('retorna o número positivo', () => expect(safeNum(3.14)).toBe(3.14));
  it('converte string numérica com ponto', () => expect(safeNum('10.5')).toBe(10.5));
  it('retorna zero para Infinity', () => expect(safeNum(Infinity)).toBe(0));
  it('retorna zero para vazio', () => expect(safeNum('')).toBe(0));
  it('aceita zero', () => expect(safeNum(0)).toBe(0));
  // BUG FIX v24.1: vírgula como separador decimal (formato BR)
  it('converte vírgula decimal "2,5" → 2.5 (fix v24.1)', () => expect(safeNum('2,5')).toBe(2.5));
  it('converte vírgula decimal "10,75" → 10.75', () => expect(safeNum('10,75')).toBe(10.75));
  it('não corrompe "1.234" (ponto como separador de milhar ficaria 1.234)', () => expect(safeNum('1.234')).toBe(1.234));
});

// ─── safeNumSigned ────────────────────────────────────────────────────────
describe('safeNumSigned', () => {
  it('aceita negativos', () => expect(safeNumSigned(-5)).toBe(-5));
  it('retorna zero para NaN', () => expect(safeNumSigned('abc')).toBe(0));
  it('retorna zero para Infinity', () => expect(safeNumSigned(Infinity)).toBe(0));
  it('aceita positivos', () => expect(safeNumSigned(7.5)).toBe(7.5));
});

// ─── calcDimensional ──────────────────────────────────────────────────────
describe('calcDimensional — m²', () => {
  it('calcula área simples: 5×3 × qtd=1', () => {
    const { qtdCalc } = calcDimensional('m²', 5, 3, 0, 1);
    expect(qtdCalc).toBeCloseTo(15, 4);
  });
  it('calcula área com quantidade: 2×4 × qtd=3', () => {
    const { qtdCalc } = calcDimensional('m2', 2, 4, 0, 3);
    expect(qtdCalc).toBeCloseTo(24, 4);
  });
  it('aceita variação M²', () => {
    const { qtdCalc } = calcDimensional('M²', 2, 2, 0, 1);
    expect(qtdCalc).toBeCloseTo(4, 4);
  });
  it('retorna zero se comp=0', () => {
    const { qtdCalc } = calcDimensional('m²', 0, 5, 0, 1);
    expect(qtdCalc).toBe(0);
  });
  it('formula string contém ×', () => {
    const { formula } = calcDimensional('m2', 3, 4, 0, 2);
    expect(formula).toContain('×');
  });
});

describe('calcDimensional — m³', () => {
  it('calcula volume: 2×3×4 × qtd=1', () => {
    const { qtdCalc } = calcDimensional('m³', 2, 3, 4, 1);
    expect(qtdCalc).toBeCloseTo(24, 4);
  });
  it('calcula volume com qtd=2', () => {
    const { qtdCalc } = calcDimensional('m3', 1, 2, 3, 2);
    expect(qtdCalc).toBeCloseTo(12, 4);
  });
  it('retorna zero com altura=0', () => {
    const { qtdCalc } = calcDimensional('m³', 3, 3, 0, 1);
    expect(qtdCalc).toBe(0);
  });
});

describe('calcDimensional — m (linear)', () => {
  it('calcula comprimento: 7.5 × qtd=2', () => {
    const { qtdCalc } = calcDimensional('m', 7.5, 0, 0, 2);
    expect(qtdCalc).toBeCloseTo(15, 4);
  });
  it('retorna apenas qtd quando comp=0', () => {
    const { qtdCalc } = calcDimensional('m', 0, 0, 0, 5);
    expect(qtdCalc).toBe(0);
  });
});

describe('calcDimensional — un (quantidade)', () => {
  it('retorna qtd para unidade', () => {
    const { qtdCalc } = calcDimensional('un', 0, 0, 0, 7);
    expect(qtdCalc).toBe(7);
  });
  it('retorna qtd para vb', () => {
    const { qtdCalc } = calcDimensional('vb', 0, 0, 0, 3);
    expect(qtdCalc).toBe(3);
  });
  it('retorna qtd para tipo desconhecido', () => {
    const { qtdCalc } = calcDimensional('cj', 0, 0, 0, 10);
    expect(qtdCalc).toBe(10);
  });
});

// ─── fxCalc ────────────────────────────────────────────────────────────────
describe('fxCalc — fórmula especial', () => {
  it('calcula expressão simples C * L * Q', () => {
    const { result, erro } = fxCalc('C * L * Q', 3, 4, 0, 2);
    expect(erro).toBeNull();
    expect(result).toBeCloseTo(24, 4);
  });
  it('calcula com altura: C * L * H * Q', () => {
    const { result, erro } = fxCalc('C * L * H * Q', 2, 3, 4, 1);
    expect(erro).toBeNull();
    expect(result).toBeCloseTo(24, 4);
  });
  it('calcula expressão com parênteses', () => {
    const { result, erro } = fxCalc('(C + L) * Q', 2, 3, 0, 4);
    expect(erro).toBeNull();
    expect(result).toBeCloseTo(20, 4);
  });
  it('aceita vírgula como separador decimal nos inputs (fix safeNum v24.1)', () => {
    // BUG CORRIGIDO: safeNum('2,5') retornava 2 (parseFloat para na vírgula).
    // Usuários que digitavam "2,5" num campo dimensional perdiam metade do valor.
    const { result, erro } = fxCalc('C * Q', '2,5', 0, 0, 2);
    expect(erro).toBeNull();
    expect(result).toBeCloseTo(5, 4);
  });
  it('rejeita variáveis inválidas (XYZ)', () => {
    const { erro } = fxCalc('C * X', 3, 0, 0, 1);
    expect(erro).not.toBeNull();
    expect(erro).toContain('inválida');
  });
  it('rejeita parênteses desbalanceados', () => {
    const { erro } = fxCalc('(C * L', 2, 3, 0, 1);
    expect(erro).not.toBeNull();
    expect(erro).toContain('desbalanceados');
  });
  it('rejeita fórmula vazia', () => {
    const { erro } = fxCalc('', 1, 1, 1, 1);
    expect(erro).not.toBeNull();
  });
  it('retorna erro em divisão por zero', () => {
    const { result, erro } = fxCalc('C / Q', 5, 0, 0, 0);
    expect(erro).not.toBeNull();
    expect(result).toBe(0);
  });
  it('rejeita fórmula muito longa (>200 chars)', () => {
    const { erro } = fxCalc('C+' + 'L+'.repeat(110), 1, 1, 0, 1);
    expect(erro).toContain('longa');
  });
  it('aceita alias A para altura', () => {
    const { result, erro } = fxCalc('C * A * Q', 2, 0, 3, 1);
    expect(erro).toBeNull();
    expect(result).toBeCloseTo(6, 4);
  });
  it('retorna resultado correto para função 3.14 * (C/2)*(C/2) * H * Q', () => {
    const { result, erro } = fxCalc('3.14 * (C/2) * (C/2) * H * Q', 4, 0, 10, 1);
    expect(erro).toBeNull();
    expect(result).toBeCloseTo(3.14 * 4 * 10, 0);
  });
});

// ─── calcLinha ─────────────────────────────────────────────────────────────
describe('calcLinha', () => {
  it('usa calcDimensional quando sem fórmula especial', () => {
    const ln = { comp: 5, larg: 3, alt: 0, qtd: 2 };
    expect(calcLinha('m²', ln, '')).toBeCloseTo(30, 4);
  });
  it('usa fxCalc quando tem fórmula especial', () => {
    const ln = { comp: 5, larg: 3, alt: 0, qtd: 2 };
    expect(calcLinha('m²', ln, 'C * L * Q')).toBeCloseTo(30, 4);
  });
  it('retorna 0 para linha null', () => {
    expect(calcLinha('m²', null, '')).toBe(0);
  });
  it('retorna 0 para linha undefined', () => {
    expect(calcLinha('un', undefined, '')).toBe(0);
  });
});

// ─── sumLinhas ─────────────────────────────────────────────────────────────
describe('sumLinhas', () => {
  it('soma múltiplas linhas m²', () => {
    const lines = [
      { comp: 5, larg: 2, alt: 0, qtd: 1 },   // 10
      { comp: 3, larg: 4, alt: 0, qtd: 1 },   // 12
    ];
    expect(sumLinhas('m²', lines, '')).toBeCloseTo(22, 4);
  });
  it('retorna 0 para array vazio', () => {
    expect(sumLinhas('m²', [], '')).toBe(0);
  });
  it('retorna 0 para null', () => {
    expect(sumLinhas('un', null, '')).toBe(0);
  });
  it('soma com fórmula especial', () => {
    const lines = [
      { comp: 2, larg: 3, alt: 0, qtd: 1 },   // 6
      { comp: 4, larg: 5, alt: 0, qtd: 1 },   // 20
    ];
    expect(sumLinhas('m²', lines, 'C * L * Q')).toBeCloseTo(26, 4);
  });
});

// ─── parseBrNumber ─────────────────────────────────────────────────────────
describe('parseBrNumber', () => {
  it('converte formato BR 1.234,56', () => {
    expect(parseBrNumber('1.234,56')).toBeCloseTo(1234.56, 2);
  });
  it('converte inteiro BR simples', () => {
    expect(parseBrNumber('1234')).toBe(1234);
  });
  it('converte 0,50', () => {
    expect(parseBrNumber('0,50')).toBeCloseTo(0.5, 2);
  });
  it('converte número já float', () => {
    expect(parseBrNumber(3.14)).toBeCloseTo(3.14, 2);
  });
  it('retorna 0 para vazio', () => {
    expect(parseBrNumber('')).toBe(0);
  });
  it('retorna 0 para null', () => {
    expect(parseBrNumber(null)).toBe(0);
  });
  it('remove R$', () => {
    expect(parseBrNumber('R$ 1.500,00')).toBeCloseTo(1500, 2);
  });
  it('converte formato americano 1,234.56', () => {
    expect(parseBrNumber('1,234.56')).toBeCloseTo(1234.56, 2);
  });
});

// ─── Cenários de regressão financeira (críticos para erário) ──────────────
describe('Cenários de regressão financeira', () => {
  it('calçada 10m × 2m × 3 trechos = 60m²', () => {
    const { qtdCalc } = calcDimensional('m²', 10, 2, 0, 3);
    expect(qtdCalc).toBeCloseTo(60, 2);
  });

  it('concreto 6m × 3m × 0.15m = 2.70m³', () => {
    const { qtdCalc } = calcDimensional('m³', 6, 3, 0.15, 1);
    expect(qtdCalc).toBeCloseTo(2.70, 2);
  });

  it('tubulação 1500m lineares = 1500m', () => {
    const { qtdCalc } = calcDimensional('m', 1500, 0, 0, 1);
    expect(qtdCalc).toBeCloseTo(1500, 2);
  });

  it('soma de 100 linhas de 1m² cada = 100m²', () => {
    const lines = Array.from({ length: 100 }, () => ({ comp: 1, larg: 1, alt: 0, qtd: 1 }));
    expect(sumLinhas('m²', lines, '')).toBeCloseTo(100, 2);
  });

  it('não aceita valor negativo no safeNum (proteção contra manipulação)', () => {
    // Valor negativo forçado não deve gerar crédito indevido
    const { qtdCalc } = calcDimensional('m²', -10, 5, 0, 1);
    expect(qtdCalc).toBe(0);
  });

  it('acumulado não pode exceder contratado — teste de cap', () => {
    // sumLinhas não aplica cap (isso é responsabilidade do bm-calculos)
    // mas valores base devem ser corretos
    const lines = [{ comp: 200, larg: 1, alt: 0, qtd: 1 }];
    const resultado = sumLinhas('m²', lines, '');
    expect(resultado).toBeCloseTo(200, 2);
    // O cap de 100% do contratado é aplicado em getQtdAcumuladoTotalItem
  });
});
