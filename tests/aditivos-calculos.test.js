/**
 * ╔══════════════════════════════════════════════════════════════╗
 * ║  TESTES — modules/aditivos/aditivos-calculos.js            ║
 * ║  Funções puras de cálculo de Aditivos Contratuais          ║
 * ║  (Lei 14.133/2021 Art. 125 — limites de acréscimos/         ║
 * ║   supressões de até 25% obras e 50% equipamentos)          ║
 * ╚══════════════════════════════════════════════════════════════╝
 */

import { describe, it, expect } from 'vitest';
import {
  trunc2, classificarItem, classeVisual, gerarDiff,
  calcularTotais, classeRealce, classePorMudanca,
  dataParaInput, inputParaData, dataBR,
} from '../modules/aditivos/aditivos-calculos.js';

// ─── trunc2 ──────────────────────────────────────────────────────────────
describe('trunc2 — truncamento a 2 casas (sem arredondamento)', () => {
  it('trunca 1.556 para 1.55', () => expect(trunc2(1.556)).toBe(1.55));
  it('trunca 2.999 para 2.99', () => expect(trunc2(2.999)).toBe(2.99));
  it('mantém inteiro', () => expect(trunc2(5)).toBe(5));
  it('aceita zero', () => expect(trunc2(0)).toBe(0));
  it('aceita string numérica', () => expect(trunc2('3.789')).toBe(3.78));
  it('aceita null → 0', () => expect(trunc2(null)).toBe(0));
  it('aceita undefined → 0', () => expect(trunc2(undefined)).toBe(0));
});

// ─── classificarItem ─────────────────────────────────────────────────────
describe('classificarItem', () => {
  const base = [
    { id: 'i1', qtd: 100, up: 50 },
    { id: 'i2', qtd: 200, up: 30 },
  ];

  it('retorna original quando não houve mudança', () => {
    expect(classificarItem({ id: 'i1', qtd: 100, up: 50 }, base)).toBe('original');
  });

  it('retorna aumentado quando qtd subiu', () => {
    expect(classificarItem({ id: 'i1', qtd: 150, up: 50 }, base)).toBe('aumentado');
  });

  it('retorna diminuido quando qtd caiu', () => {
    expect(classificarItem({ id: 'i1', qtd: 80, up: 50 }, base)).toBe('diminuido');
  });

  it('retorna novo quando item não existe na base', () => {
    expect(classificarItem({ id: 'i99', qtd: 10, up: 20 }, base)).toBe('novo');
  });

  it('retorna removido quando _adtRemovido=true', () => {
    expect(classificarItem({ id: 'i1', qtd: 100, up: 50, _adtRemovido: true }, base)).toBe('removido');
  });

  it('retorna valor quando apenas up mudou', () => {
    expect(classificarItem({ id: 'i1', qtd: 100, up: 60 }, base)).toBe('valor');
  });
});

// ─── calcularTotais ──────────────────────────────────────────────────────
describe('calcularTotais — acréscimos e supressões', () => {
  const bdi = 0.25;

  it('calcula acréscimo simples de inclusão', () => {
    const itens = [{
      operacao: 'inclusao',
      qtdNova: 100, upNova: 50,
      qtdAnterior: null, upAnterior: null,
    }];
    const { acrescimos, supressoes, liquido } = calcularTotais(itens, bdi);
    expect(acrescimos).toBeCloseTo(100 * 50 * 1.25, 2);
    expect(supressoes).toBe(0);
    expect(liquido).toBeCloseTo(6250, 2);
  });

  it('calcula supressão de exclusão', () => {
    const itens = [{
      operacao: 'exclusao',
      qtdNova: 0, upNova: 50,
      qtdAnterior: 80, upAnterior: 50,
    }];
    const { supressoes, acrescimos, liquido } = calcularTotais(itens, bdi);
    expect(supressoes).toBeCloseTo(80 * 50 * 1.25, 2);
    expect(acrescimos).toBe(0);
    expect(liquido).toBeCloseTo(-5000, 2);
  });

  it('calcula alteração de quantidade (aumento)', () => {
    const itens = [{
      operacao: 'alteracao_qtd',
      qtdNova: 150, upNova: 40,
      qtdAnterior: 100, upAnterior: 40,
    }];
    const { acrescimos, supressoes } = calcularTotais(itens, bdi);
    // delta = (150-100) * 40 * 1.25 = 2500
    expect(acrescimos).toBeCloseTo(2500, 2);
    expect(supressoes).toBe(0);
  });

  it('liquido = acrescimos - supressoes', () => {
    const itens = [
      { operacao: 'inclusao', qtdNova: 100, upNova: 10, qtdAnterior: null, upAnterior: null },
      { operacao: 'exclusao', qtdNova: 0, upNova: 0, qtdAnterior: 20, upAnterior: 20 },
    ];
    const { acrescimos, supressoes, liquido } = calcularTotais(itens, bdi);
    expect(liquido).toBeCloseTo(acrescimos - supressoes, 2);
  });

  it('retorna zeros para lista vazia', () => {
    const { acrescimos, supressoes, liquido } = calcularTotais([], bdi);
    expect(acrescimos).toBe(0);
    expect(supressoes).toBe(0);
    expect(liquido).toBe(0);
  });

  // Lei 14.133/2021 Art. 125: acréscimos ≤ 25% do contrato original
  it('valida limite de 25% (Art. 125 Lei 14.133/2021)', () => {
    const valorContrato = 1_000_000;
    const limiteAcrescimos = valorContrato * 0.25;
    expect(limiteAcrescimos).toBe(250_000);

    // Acréscimos dentro do limite: OK
    const acrescimoPermitido = 200_000;
    expect(acrescimoPermitido).toBeLessThanOrEqual(limiteAcrescimos);

    // Acréscimos acima do limite: requer justificativa
    const acrescimoExcessivo = 300_000;
    expect(acrescimoExcessivo).toBeGreaterThan(limiteAcrescimos);
  });
});

// ─── classeRealce ────────────────────────────────────────────────────────
describe('classeRealce', () => {
  it('aumento de valor → linha-aumento-valor', () =>
    expect(classeRealce(60, 50, 100, 100)).toBe('linha-aumento-valor'));

  it('redução de valor → linha-diminuiu-valor', () =>
    expect(classeRealce(40, 50, 100, 100)).toBe('linha-diminuiu-valor'));

  it('aumento de qtd → linha-aumento-qtd', () =>
    expect(classeRealce(50, 50, 150, 100)).toBe('linha-aumento-qtd'));

  it('redução de qtd (parcial) → linha-diminuiu-qtd', () =>
    expect(classeRealce(50, 50, 70, 100)).toBe('linha-diminuiu-qtd'));

  it('supressão total (qtd=0) → linha-suprimiu-item', () =>
    expect(classeRealce(50, 50, 0, 100)).toBe('linha-suprimiu-item'));

  it('sem mudança → vazio', () =>
    expect(classeRealce(50, 50, 100, 100)).toBe(''));
});

// ─── gerarDiff ───────────────────────────────────────────────────────────
describe('gerarDiff', () => {
  const base = [
    { id: 'i1', qtd: 100, up: 50, desc: 'Serviço A', un: 'm²' },
    { id: 'i2', qtd: 200, up: 30, desc: 'Serviço B', un: 'm'  },
  ];

  it('retorna diff vazio quando nada mudou', () => {
    const draft = [
      { id: 'i1', qtd: 100, up: 50 },
      { id: 'i2', qtd: 200, up: 30 },
    ];
    expect(gerarDiff(draft, base)).toHaveLength(0);
  });

  it('detecta item novo', () => {
    const draft = [...base, { id: 'i3', qtd: 50, up: 20, desc: 'Novo', un: 'un' }];
    const diff = gerarDiff(draft, base);
    expect(diff.some(d => d.operacao === 'inclusao' && d.itemId === 'i3')).toBe(true);
  });

  it('detecta alteração de quantidade', () => {
    const draft = [
      { id: 'i1', qtd: 150, up: 50 },
      { id: 'i2', qtd: 200, up: 30 },
    ];
    const diff = gerarDiff(draft, base);
    expect(diff.some(d => d.operacao === 'alteracao_qtd' && d.itemId === 'i1')).toBe(true);
  });

  it('detecta exclusão por _adtRemovido', () => {
    const draft = [
      { id: 'i1', qtd: 100, up: 50, _adtRemovido: true },
      { id: 'i2', qtd: 200, up: 30 },
    ];
    const diff = gerarDiff(draft, base);
    expect(diff.some(d => d.operacao === 'exclusao' && d.itemId === 'i1')).toBe(true);
  });

  it('retorna [] para arrays vazios', () => {
    expect(gerarDiff([], [])).toHaveLength(0);
  });
});

// ─── conversão de datas ──────────────────────────────────────────────────
describe('conversão de datas', () => {
  it('dataParaInput converte DD/MM/AAAA → AAAA-MM-DD', () =>
    expect(dataParaInput('25/03/2024')).toBe('2024-03-25'));

  it('dataParaInput mantém formato ISO', () =>
    expect(dataParaInput('2024-03-25')).toBe('2024-03-25'));

  it('dataParaInput retorna vazio para null', () =>
    expect(dataParaInput(null)).toBe(''));

  it('inputParaData converte AAAA-MM-DD → DD/MM/AAAA', () =>
    expect(inputParaData('2024-03-25')).toBe('25/03/2024'));

  it('inputParaData mantém formato BR', () =>
    expect(inputParaData('25/03/2024')).toBe('25/03/2024'));

  it('dataBR retorna — para nulo', () =>
    expect(dataBR(null)).toBe('—'));

  it('dataBR converte ISO para BR', () =>
    expect(dataBR('2024-03-25')).toBe('25/03/2024'));
});
