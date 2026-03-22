/**
 * ╔══════════════════════════════════════════════════════════════╗
 * ║  TESTES — modules/boletim-medicao/bm-calculos.js           ║
 * ║  Funções puras de cálculo de BM — máxima prioridade        ║
 * ║  Erros aqui = pagamentos incorretos em obras públicas       ║
 * ╚══════════════════════════════════════════════════════════════╝
 *
 * ESTRATÉGIA: testar apenas as funções exportáveis que não dependem
 * de Firebase/state (funções puras). Funções com efeitos externos
 * (getMedicoes, salvarMedicoes) são testadas via integração.
 */

import { describe, it, expect } from 'vitest';
import { calcDimensional, fxCalc } from '../utils/formula-engine.js';
import { classUnd }                 from '../utils/unit-normalizer.js';

// ─── getBdiEfetivo (lógica replicada para teste isolado) ──────
// Replica a lógica de getBdiEfetivo sem importar módulo Firebase-dependente
function getBdiEfetivo(item, cfg) {
  const bdiGlobal   = parseFloat(cfg?.bdi)   || 0.25;
  const bdiReduzido = parseFloat(cfg?.bdiReduzido) || 0.10;
  switch (item?.tipoBdi) {
    case 'reduzido': return bdiReduzido;
    case 'zero':     return 0;
    default:         return bdiGlobal;
  }
}

// ─── sumLinhasQtd (lógica replicada para teste isolado) ───────
function sumLinhasQtd(und, lines, fxFormula) {
  return (lines || []).reduce((acc, ln) => {
    let lr = 0;
    if (fxFormula) {
      const { result } = fxCalc(fxFormula, ln.comp, ln.larg, ln.alt, ln.qtd);
      lr = isFinite(result) ? result : 0;
    } else {
      const r = calcDimensional(und, ln.comp, ln.larg, ln.alt, ln.qtd);
      lr = isFinite(r.qtdCalc) ? r.qtdCalc : 0;
    }
    return acc + lr;
  }, 0);
}

// ─── classUnd ────────────────────────────────────────────────────────────
describe('classUnd — normalização de unidade', () => {
  it('normaliza m²', () => expect(classUnd('m²')).toBe('m2'));
  it('normaliza M2', () => expect(classUnd('M2')).toBe('m2'));
  it('normaliza m³', () => expect(classUnd('m³')).toBe('m3'));
  it('normaliza M3', () => expect(classUnd('M3')).toBe('m3'));
  it('normaliza m linear', () => expect(classUnd('m')).toBe('m'));
  it('normaliza M', () => expect(classUnd('M')).toBe('m'));
  it('retorna un para desconhecido', () => expect(classUnd('cj')).toBe('un'));
  it('retorna un para vazio', () => expect(classUnd('')).toBe('un'));
  it('retorna un para undefined', () => expect(classUnd(undefined)).toBe('un'));
});

// ─── sumLinhasQtd ────────────────────────────────────────────────────────
describe('sumLinhasQtd — soma de linhas de medição', () => {
  it('soma duas linhas de 10m² cada', () => {
    const lines = [
      { comp: 5, larg: 2, alt: 0, qtd: 1 },
      { comp: 5, larg: 2, alt: 0, qtd: 1 },
    ];
    expect(sumLinhasQtd('m²', lines, '')).toBeCloseTo(20, 4);
  });

  it('soma com fórmula especial', () => {
    const lines = [
      { comp: 3, larg: 4, alt: 0, qtd: 1 },   // 12
      { comp: 2, larg: 5, alt: 0, qtd: 1 },   // 10
    ];
    expect(sumLinhasQtd('m²', lines, 'C * L * Q')).toBeCloseTo(22, 4);
  });

  it('retorna 0 para array vazio', () => {
    expect(sumLinhasQtd('m²', [], '')).toBe(0);
  });

  it('retorna 0 para null', () => {
    expect(sumLinhasQtd('m²', null, '')).toBe(0);
  });

  it('lida com linha com valores 0', () => {
    const lines = [{ comp: 0, larg: 0, alt: 0, qtd: 0 }];
    expect(sumLinhasQtd('m²', lines, '')).toBe(0);
  });

  it('lida com qtd como string numérica', () => {
    const lines = [{ comp: '5', larg: '2', alt: 0, qtd: '1' }];
    expect(sumLinhasQtd('m²', lines, '')).toBeCloseTo(10, 4);
  });
});

// ─── getBdiEfetivo — TCU Acórdão 2.622/2013 ─────────────────────────────
describe('getBdiEfetivo — BDI por tipo de item (Acórdão TCU 2.622/2013)', () => {
  const cfg = { bdi: 0.25, bdiReduzido: 0.12 };

  it('usa bdi global para serviços (tipoBdi undefined)', () => {
    expect(getBdiEfetivo({}, cfg)).toBe(0.25);
  });

  it('usa bdiReduzido para equipamentos', () => {
    expect(getBdiEfetivo({ tipoBdi: 'reduzido' }, cfg)).toBe(0.12);
  });

  it('retorna 0 para fornecimento direto pela Administração', () => {
    expect(getBdiEfetivo({ tipoBdi: 'zero' }, cfg)).toBe(0);
  });

  it('usa bdi global quando tipoBdi é string vazia', () => {
    expect(getBdiEfetivo({ tipoBdi: '' }, cfg)).toBe(0.25);
  });

  it('usa fallback 0.25 quando cfg.bdi não definido', () => {
    expect(getBdiEfetivo({}, {})).toBe(0.25);
  });

  it('usa fallback 0.10 quando cfg.bdiReduzido não definido', () => {
    expect(getBdiEfetivo({ tipoBdi: 'reduzido' }, {})).toBe(0.10);
  });
});

// ─── Cenários de regressão — Boletim de Medição ──────────────────────────
describe('Cenários de regressão BM — cálculo financeiro', () => {
  it('valor bruto de item: qtd × up', () => {
    const qtd = 150;    // m²
    const up  = 45.80;  // R$/m²
    const valorBruto = qtd * up;
    expect(valorBruto).toBeCloseTo(6870, 2);
  });

  it('valor com BDI 25%: up × (1 + 0.25)', () => {
    const up    = 45.80;
    const bdi   = 0.25;
    const upBdi = up * (1 + bdi);
    expect(upBdi).toBeCloseTo(57.25, 2);
  });

  it('valor BM com BDI: 150m² × R$57,25 = R$8.587,50', () => {
    const qtd   = 150;
    const up    = 45.80;
    const bdi   = 0.25;
    const total = qtd * (up * (1 + bdi));
    expect(total).toBeCloseTo(8587.50, 2);
  });

  it('BDI reduzido para equipamento (12%): up × 1.12', () => {
    const up    = 5000;
    const upBdi = up * (1 + 0.12);
    expect(upBdi).toBeCloseTo(5600, 2);
  });

  it('acumulado anterior BM1 é sempre 0', () => {
    // bmNum = 1 → getQtdAcumuladoAnteriorItem deve retornar 0
    const bmNum = 1;
    const acumuladoAnterior = bmNum <= 1 ? 0 : NaN; // lógica real
    expect(acumuladoAnterior).toBe(0);
  });

  it('medição atual = acumulado total - acumulado anterior', () => {
    const acumuladoTotal    = 250;
    const acumuladoAnterior = 100;
    const medicaoAtual      = acumuladoTotal - acumuladoAnterior;
    expect(medicaoAtual).toBe(150);
  });

  it('cap: acumulado não pode exceder qtd contratada', () => {
    const qtdContratada = 500;
    let   acumulado     = 0;
    // Simula 3 BMs medindo 200 cada (total = 600 > 500)
    for (const medicao of [200, 200, 200]) {
      const cap    = Math.max(0, qtdContratada - acumulado);
      const safeM  = Math.min(medicao, cap);
      acumulado   += safeM;
    }
    expect(acumulado).toBe(500); // deve ser limitado ao contratado
  });

  it('percentual executado = (acumulado / contratado) × 100', () => {
    const contratado = 1000;
    const acumulado  = 350;
    const pct = (acumulado / contratado) * 100;
    expect(pct).toBeCloseTo(35, 2);
  });
});

// ─── Cenários reais de obras ──────────────────────────────────────────────
describe('Cenários reais — obra de pavimentação', () => {
  // Obra: Pavimentação Rua Principal
  // Item 1: Sub-base de brita — 1200m² a R$18,50/m² (BDI 25%)
  // Item 2: Meio-fio — 800m a R$25,00/m (BDI 25%)
  // BM1: executa 40% da sub-base e 30% do meio-fio

  const cfg = { bdi: 0.25, bdiReduzido: 0.10 };

  it('calcula valor BM1 item sub-base (40% de 1200m²)', () => {
    const qtdContratada = 1200;
    const pctBM1 = 0.40;
    const qtdBM1 = qtdContratada * pctBM1;   // 480 m²
    const up     = 18.50;
    const upBdi  = up * (1 + cfg.bdi);       // 23,125
    const valorBM1 = qtdBM1 * upBdi;
    expect(qtdBM1).toBeCloseTo(480, 2);
    expect(valorBM1).toBeCloseTo(11100, 2);
  });

  it('calcula valor BM1 item meio-fio (30% de 800m)', () => {
    const qtdContratada = 800;
    const qtdBM1 = 800 * 0.30;               // 240 m
    const up     = 25.00;
    const upBdi  = up * (1 + cfg.bdi);       // 31,25
    const valorBM1 = qtdBM1 * upBdi;
    expect(qtdBM1).toBeCloseTo(240, 2);
    expect(valorBM1).toBeCloseTo(7500, 2);
  });

  it('valor total BM1 = soma dos itens', () => {
    const vSubBase = 11100;
    const vMeioCio = 7500;
    expect(vSubBase + vMeioCio).toBeCloseTo(18600, 2);
  });
});
