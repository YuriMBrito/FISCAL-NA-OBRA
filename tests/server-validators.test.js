/**
 * ╔══════════════════════════════════════════════════════════════╗
 * ║  TESTES — utils/server-validators.js                       ║
 * ║  Regras de negócio críticas: Art. 125 Lei 14.133, CNPJ,    ║
 * ║  Cap de medição, Prorrogação                                ║
 * ╚══════════════════════════════════════════════════════════════╝
 */

import { describe, it, expect } from 'vitest';
import {
  validarLimitesAditivo,
  validarCapMedicao,
  validarCNPJ,
  validarProrrogacao,
} from '../utils/server-validators.js';

// ─── validarLimitesAditivo ────────────────────────────────────────────────────
describe('validarLimitesAditivo — Art. 125 Lei 14.133/2021', () => {
  const base = { valorOriginalContrato: 1_000_000 };

  it('aprova aditivo dentro do limite de 25%', () => {
    const { ok } = validarLimitesAditivo({ ...base, totalAcrescimos: 250_000, totalSupressoes: 0 });
    expect(ok).toBe(true);
  });

  it('rejeita acréscimo acima de 25%', () => {
    const { ok, erros } = validarLimitesAditivo({ ...base, totalAcrescimos: 250_001, totalSupressoes: 0 });
    expect(ok).toBe(false);
    expect(erros[0]).toMatch(/25%/);
    expect(erros[0]).toMatch(/Art. 125/);
  });

  it('rejeita supressão acima de 25%', () => {
    const { ok, erros } = validarLimitesAditivo({ ...base, totalAcrescimos: 0, totalSupressoes: 250_001 });
    expect(ok).toBe(false);
    expect(erros[0]).toMatch(/25%/);
  });

  it('aprova reforma com acréscimo até 50%', () => {
    const { ok } = validarLimitesAditivo({ ...base, totalAcrescimos: 500_000, totalSupressoes: 0, tipoContrato: 'reforma' });
    expect(ok).toBe(true);
  });

  it('rejeita reforma com acréscimo acima de 50%', () => {
    const { ok } = validarLimitesAditivo({ ...base, totalAcrescimos: 500_001, totalSupressoes: 0, tipoContrato: 'reforma' });
    expect(ok).toBe(false);
  });

  it('retorna erro quando valorOriginalContrato é zero', () => {
    const { ok, erros } = validarLimitesAditivo({ valorOriginalContrato: 0, totalAcrescimos: 0, totalSupressoes: 0 });
    expect(ok).toBe(false);
    expect(erros[0]).toMatch(/inválido/);
  });

  it('acumula múltiplos erros quando ambos os limites são excedidos', () => {
    const { ok, erros } = validarLimitesAditivo({ ...base, totalAcrescimos: 300_000, totalSupressoes: 300_000 });
    expect(ok).toBe(false);
    expect(erros.length).toBe(2);
  });
});

// ─── validarCapMedicao ────────────────────────────────────────────────────────
describe('validarCapMedicao — cap 100% do item contratado', () => {
  it('aprova medição dentro do saldo', () => {
    const { ok } = validarCapMedicao({ qtdContratada: 100, qtdAcumuladaAntes: 60, qtdMedicaoAtual: 40 });
    expect(ok).toBe(true);
  });

  it('rejeita medição que ultrapassa o saldo', () => {
    const { ok, erros, qtdPermitida } = validarCapMedicao({ qtdContratada: 100, qtdAcumuladaAntes: 60, qtdMedicaoAtual: 41 });
    expect(ok).toBe(false);
    expect(erros[0]).toMatch(/saldo/);
    expect(qtdPermitida).toBe(40);
  });

  it('permite medição zero quando saldo é zero', () => {
    const { ok } = validarCapMedicao({ qtdContratada: 100, qtdAcumuladaAntes: 100, qtdMedicaoAtual: 0 });
    expect(ok).toBe(true);
  });

  it('rejeita qualquer medição quando saldo é zero', () => {
    const { ok } = validarCapMedicao({ qtdContratada: 100, qtdAcumuladaAntes: 100, qtdMedicaoAtual: 0.01 });
    expect(ok).toBe(false);
  });
});

// ─── validarCNPJ ─────────────────────────────────────────────────────────────
describe('validarCNPJ — algoritmo Receita Federal', () => {
  it('valida CNPJ correto (com máscara)', () => expect(validarCNPJ('11.222.333/0001-81')).toBe(true));
  it('valida CNPJ correto (sem máscara)', () => expect(validarCNPJ('11222333000181')).toBe(true));
  it('rejeita CNPJ com dígito verificador errado', () => expect(validarCNPJ('11.222.333/0001-82')).toBe(false));
  it('rejeita CNPJ com todos dígitos iguais', () => expect(validarCNPJ('11.111.111/1111-11')).toBe(false));
  it('rejeita string vazia', () => expect(validarCNPJ('')).toBe(false));
  it('rejeita CNPJ com menos de 14 dígitos', () => expect(validarCNPJ('123456')).toBe(false));
});

// ─── validarProrrogacao ───────────────────────────────────────────────────────
describe('validarProrrogacao — Art. 111 Lei 14.133/2021', () => {
  it('aprova prorrogação válida', () => {
    const { ok } = validarProrrogacao({
      dataTerminoAtual: '2024-12-31',
      novaDataTermino:  '2025-06-30',
      justificativa:    'Chuvas excessivas impediram execução das fundações.',
    });
    expect(ok).toBe(true);
  });

  it('rejeita justificativa curta demais', () => {
    const { ok, erros } = validarProrrogacao({
      dataTerminoAtual: '2024-12-31',
      novaDataTermino:  '2025-06-30',
      justificativa:    'Motivo.',
    });
    expect(ok).toBe(false);
    expect(erros[0]).toMatch(/20 caracteres/);
  });

  it('rejeita nova data anterior à atual', () => {
    const { ok, erros } = validarProrrogacao({
      dataTerminoAtual: '2025-06-30',
      novaDataTermino:  '2025-01-01',
      justificativa:    'Justificativa com mais de vinte caracteres.',
    });
    expect(ok).toBe(false);
    expect(erros[0]).toMatch(/posterior/);
  });

  it('rejeita sem nova data', () => {
    const { ok } = validarProrrogacao({
      dataTerminoAtual: '2024-12-31',
      novaDataTermino:  '',
      justificativa:    'Justificativa com mais de vinte caracteres.',
    });
    expect(ok).toBe(false);
  });
});
