/**
 * ╔══════════════════════════════════════════════════════════════╗
 * ║  TESTES — utils/validators.js                              ║
 * ╚══════════════════════════════════════════════════════════════╝
 */

import { describe, it, expect } from 'vitest';
import { validators } from '../utils/validators.js';

describe('validators.isValidDate', () => {
  it('aceita data ISO válida', () => expect(validators.isValidDate('2024-03-15')).toBe(true));
  it('rejeita data inválida', () => expect(validators.isValidDate('2024-13-01')).toBe(false));
  it('rejeita vazio', () => expect(validators.isValidDate('')).toBe(false));
  it('rejeita null', () => expect(validators.isValidDate(null)).toBe(false));
  it('rejeita formato BR', () => expect(validators.isValidDate('15/03/2024')).toBe(false));
});

describe('validators.isValidEmail', () => {
  it('aceita email válido', () => expect(validators.isValidEmail('fiscal@prefeitura.gov.br')).toBe(true));
  it('rejeita sem @', () => expect(validators.isValidEmail('fiscalprefeitura.gov.br')).toBe(false));
  it('rejeita vazio', () => expect(validators.isValidEmail('')).toBe(false));
  it('rejeita com espaço', () => expect(validators.isValidEmail('fi scal@gov.br')).toBe(false));
});

describe('validators.isValidCNPJ', () => {
  // BUG CORRIGIDO v24.1: algoritmo anterior usava multiplicadores errados (13/14)
  // em vez dos pesos oficiais da Receita Federal (5,4,3,2,9,8,7,6,5,4,3,2).
  // Resultado: CNPJs válidos eram rejeitados em produção.
  it('aceita CNPJ válido da União (00.394.460/0001-41)', () => expect(validators.isValidCNPJ('00.394.460/0001-41')).toBe(true));
  it('aceita CNPJ sem formatação', () => expect(validators.isValidCNPJ('00394460000141')).toBe(true));
  it('aceita CNPJ da Petrobras (33.000.167/0001-01)', () => expect(validators.isValidCNPJ('33.000.167/0001-01')).toBe(true));
  it('rejeita CNPJ com todos dígitos iguais', () => expect(validators.isValidCNPJ('11.111.111/1111-11')).toBe(false));
  it('rejeita CNPJ com dígito verificador errado', () => expect(validators.isValidCNPJ('12.345.678/0001-00')).toBe(false));
  it('rejeita CNPJ vazio', () => expect(validators.isValidCNPJ('')).toBe(false));
});

describe('validators.safeDimensional', () => {
  it('aceita número positivo', () => expect(validators.safeDimensional(5.5)).toBe(5.5));
  it('aceita zero', () => expect(validators.safeDimensional(0)).toBe(0));
  it('retorna 0 para negativo', () => expect(validators.safeDimensional(-3)).toBe(0));
  it('retorna 0 para string inválida', () => expect(validators.safeDimensional('abc')).toBe(0));
  it('converte string numérica', () => expect(validators.safeDimensional('3.14')).toBe(3.14));
});

describe('validators.clamp', () => {
  it('mantém valor dentro do intervalo', () => expect(validators.clamp(5, 0, 10)).toBe(5));
  it('limita ao máximo', () => expect(validators.clamp(15, 0, 10)).toBe(10));
  it('eleva ao mínimo', () => expect(validators.clamp(-5, 0, 10)).toBe(0));
});

describe('validators.notEmpty', () => {
  it('retorna false para null', () => expect(validators.notEmpty(null)).toBe(false));
  it('retorna false para string vazia', () => expect(validators.notEmpty('')).toBe(false));
  it('retorna false para array vazio', () => expect(validators.notEmpty([])).toBe(false));
  it('retorna false para objeto vazio', () => expect(validators.notEmpty({})).toBe(false));
  it('retorna true para string com conteúdo', () => expect(validators.notEmpty('abc')).toBe(true));
  it('retorna true para array com itens', () => expect(validators.notEmpty([1])).toBe(true));
});

describe('validators.isValidItem', () => {
  it('aceita item válido', () => {
    expect(validators.isValidItem({ id: 'i1', desc: 'Serviço', und: 'm²', qtd: 10, up: 150 })).toBe(true);
  });
  it('rejeita item sem id', () => {
    expect(validators.isValidItem({ desc: 'Serviço', und: 'm²', qtd: 10, up: 150 })).toBe(false);
  });
  it('rejeita item nulo', () => expect(validators.isValidItem(null)).toBe(false));
  it('aceita título (item.t = true)', () => {
    expect(validators.isValidItem({ id: 'grp1', t: true })).toBe(true);
  });
});

describe('validators.sanitize', () => {
  it('remove campos undefined', () => {
    const obj = { a: 1, b: undefined, c: 'ok' };
    const result = validators.sanitize(obj);
    expect(result).toEqual({ a: 1, c: 'ok' });
    expect('b' in result).toBe(false);
  });
  it('mantém null intacto', () => {
    expect(validators.sanitize(null)).toBeNull();
  });
  it('processa objetos aninhados', () => {
    const obj = { a: { b: undefined, c: 2 } };
    expect(validators.sanitize(obj)).toEqual({ a: { c: 2 } });
  });
});

describe('validators.roundByConfig', () => {
  it('trunca por padrão', () => expect(validators.roundByConfig(1.556, 2, 'truncar')).toBe(1.55));
  it('arredonda quando configurado', () => expect(validators.roundByConfig(1.556, 2, 'arredondar')).toBe(1.56));
  it('funciona com 4 casas decimais', () => {
    const v = validators.roundByConfig(3.14159265, 4, 'truncar');
    expect(v).toBe(3.1415);
  });
});
