/**
 * ╔══════════════════════════════════════════════════════════════╗
 * ║  FISCAL NA OBRA — utils/formula-engine.js                   ║
 * ║  Motor central de fórmulas de cálculo dimensional           ║
 * ╚══════════════════════════════════════════════════════════════╝
 *
 * Regras padrão:
 *   m2 = comprimento × largura × quantidade
 *   m3 = comprimento × largura × altura × quantidade
 *   m  = comprimento × quantidade
 *   un = quantidade
 *
 * Se existir formulaEspecial, ela substitui a fórmula padrão.
 *
 * Resultado da linha:
 *   resultadoLinha = fórmula(comp, larg, alt, qtd)
 *
 * Total do item:
 *   soma de resultadoLinha de todas as linhas
 */

import { classUnd } from './unit-normalizer.js';

/** Converte qualquer valor em número finito seguro (0 se inválido ou negativo).
 *  Aceita vírgula como separador decimal (formato BR: "2,5" → 2.5).
 *  Não aceita formato de milhar com ponto (use parseBrNumber para isso). */
export function safeNum(v) {
  if (typeof v === 'string') {
    // Troca vírgula decimal por ponto APENAS quando não há ponto (ex: "2,5" → "2.5")
    // Evita corromper "1.234,56" — esse formato fica para parseBrNumber
    if (v.includes(',') && !v.includes('.')) {
      v = v.replace(',', '.');
    }
  }
  const n = parseFloat(v);
  return (isFinite(n) && n >= 0) ? n : 0;
}

/** Converte valor permitindo negativos (para resultados intermediários) */
export function safeNumSigned(v) {
  const n = parseFloat(v);
  return isFinite(n) ? n : 0;
}

/** Formata número com N casas decimais */
function n4(v) {
  return parseFloat(parseFloat(v).toFixed(4));
}

/**
 * Calcula resultado dimensional padrão.
 * @param {string} und — unidade (m², m³, m, un, etc.)
 * @param {number} comp — comprimento
 * @param {number} larg — largura
 * @param {number} alt  — altura
 * @param {number} qtd  — quantidade
 * @returns {{ qtdCalc: number, formula: string }}
 */
export function calcDimensional(und, comp, larg, alt, qtd) {
  const tipo = classUnd(und);
  comp = safeNum(comp);
  larg = safeNum(larg);
  alt  = safeNum(alt);
  qtd  = safeNum(qtd);

  let qtdCalc = 0, formula = '';

  switch (tipo) {
    case 'm2':
      qtdCalc = comp * larg * qtd;
      formula = `${n4(comp)} m × ${n4(larg)} m × ${qtd} = ${n4(qtdCalc)} m²`;
      break;
    case 'm3':
      qtdCalc = comp * larg * alt * qtd;
      formula = `${n4(comp)} m × ${n4(larg)} m × ${n4(alt)} m × ${qtd} = ${n4(qtdCalc)} m³`;
      break;
    case 'm':
      qtdCalc = comp * qtd;
      formula = `${n4(comp)} m × ${qtd} = ${n4(qtdCalc)} m`;
      break;
    default:
      qtdCalc = qtd;
      formula = `Quantidade = ${qtd} ${String(und || '').trim()}`;
  }

  qtdCalc = isFinite(qtdCalc) ? qtdCalc : 0;
  return { qtdCalc, formula };
}

/**
 * Motor de fórmula especial (definida pelo usuário).
 * Variáveis: C (comprimento), L (largura), H/A (altura), Q (quantidade)
 * Operadores: + - * / ()
 *
 * @param {string} formula — ex: "C * L * Q", "3.14 * (C/2) * (C/2) * H * Q"
 * @param {number} comp
 * @param {number} larg
 * @param {number} alt
 * @param {number} qtd
 * @returns {{ result: number, expr: string, erro: string|null }}
 */
export function fxCalc(formula, comp, larg, alt, qtd) {
  if (!formula || !formula.trim()) return { result: 0, expr: '', erro: 'Fórmula vazia.' };

  // Guard: limit formula length to prevent abuse
  const raw = formula.trim();
  if (raw.length > 200) return { result: 0, expr: raw.slice(0, 50) + '…', erro: 'Fórmula muito longa (máx 200 caracteres).' };

  let expr = raw.toUpperCase().replace(/,/g, '.').replace(/\bA\b/g, 'H');
  expr = expr.replace(/\bC\b/g, String(safeNum(comp)));
  expr = expr.replace(/\bL\b/g, String(safeNum(larg)));
  expr = expr.replace(/\bH\b/g, String(safeNum(alt)));
  expr = expr.replace(/\bQ\b/g, String(safeNum(qtd)));

  if (!/^[\d\s\.\+\-\*\/\(\)]+$/.test(expr))
    return { result: 0, expr, erro: 'Variável inválida. Use apenas C, L, H, Q.' };

  let open = 0;
  for (const ch of expr) { if (ch === '(') open++; else if (ch === ')') open--; if (open < 0) break; }
  if (open !== 0) return { result: 0, expr, erro: 'Parênteses desbalanceados.' };

  try {
    const fn = new Function('"use strict"; return (' + expr + ')');
    const r  = fn();
    if (!isFinite(r)) return { result: 0, expr, erro: 'Divisão por zero ou resultado inválido.' };
    return { result: parseFloat(r.toFixed(6)), expr, erro: null };
  } catch (e) {
    return { result: 0, expr, erro: 'Erro de sintaxe.' };
  }
}

/**
 * Calcula o resultado de uma linha de memória de cálculo.
 * Se houver fórmula especial, usa ela; senão usa calcDimensional.
 *
 * @param {string} und — unidade do item
 * @param {{ comp:number, larg:number, alt:number, qtd:number }} ln — linha
 * @param {string} fxFormula — fórmula especial (pode ser vazia)
 * @returns {number} — resultado da linha
 */
export function calcLinha(und, ln, fxFormula) {
  if (!ln) return 0;
  if (fxFormula) {
    const { result } = fxCalc(fxFormula, ln.comp, ln.larg, ln.alt, ln.qtd);
    return isFinite(result) ? result : 0;
  }
  const r = calcDimensional(und, ln.comp, ln.larg, ln.alt, ln.qtd);
  return isFinite(r.qtdCalc) ? r.qtdCalc : 0;
}

/**
 * Soma o resultado de todas as linhas de um item.
 * @param {string} und — unidade
 * @param {Array} lines — linhas de medição
 * @param {string} fxFormula — fórmula especial
 * @returns {number} — total do item
 */
export function sumLinhas(und, lines, fxFormula) {
  const total = (lines || []).reduce((acc, ln) => acc + calcLinha(und, ln, fxFormula), 0);
  return isFinite(total) ? total : 0;
}

/**
 * Converte número no formato brasileiro (1.234,56) para float.
 * Remove unidades (m², m³) e símbolos de moeda (R$).
 * @param {string|number} s
 * @returns {number}
 */
export function parseBrNumber(s) {
  if (typeof s === 'number') return isNaN(s) ? 0 : s;
  if (!s) return 0;
  const c = String(s).replace(/R\$\s*/g, '').replace(/[^\d.,\-]/g, '').trim();
  if (!c) return 0;
  // 1.234,56
  if (/^\-?\d{1,3}(\.\d{3})+,\d+$/.test(c)) return parseFloat(c.replace(/\./g, '').replace(',', '.')) || 0;
  // 1234,56
  if (/^\-?\d+,\d+$/.test(c) && !/\./.test(c)) return parseFloat(c.replace(',', '.')) || 0;
  // 1,234.56
  if (/^\-?\d{1,3}(,\d{3})+\.\d+$/.test(c)) return parseFloat(c.replace(/,/g, '')) || 0;
  // 1234.56
  if (/^\-?\d+\.\d+$/.test(c)) return parseFloat(c) || 0;
  // inteiro
  if (/^\-?\d+$/.test(c)) return parseInt(c) || 0;
  return parseFloat(c) || 0;
}

export default {
  safeNum, safeNumSigned, calcDimensional, fxCalc, calcLinha, sumLinhas, parseBrNumber,
};
