/**
 * ╔══════════════════════════════════════════════════════════════════════╗
 * ║  FISCAL NA OBRA — utils/calc-guard.js                              ║
 * ║  Guarda de cálculos: previne NaN, Infinity, undefined e ÷0         ║
 * ╠══════════════════════════════════════════════════════════════════════╣
 * ║  FASE 4 — Data and Calculation Safety                               ║
 * ║                                                                      ║
 * ║  Cada função retorna SEMPRE um número finito. Nunca NaN, Infinity,  ║
 * ║  undefined ou null. Todas as proteções são inline — sem overhead     ║
 * ║  de validação complexa.                                              ║
 * ╚══════════════════════════════════════════════════════════════════════╝
 *
 * USO:
 *   import { safe, safeMul, safeDiv, safePct, safeSum } from '../utils/calc-guard.js';
 *
 *   const total = safeMul(qtd, preco, 1 + bdi);   // Nunca NaN
 *   const pct   = safePct(parcial, total);          // Divisão segura
 *   const soma  = safeSum([1.1, 2.2, NaN, 3.3]);   // Ignora NaN
 */

// ── safe() — Converte qualquer valor em número finito ─────────
/**
 * @param {*} v — valor de entrada (string, number, null, undefined, etc.)
 * @param {number} [fallback=0] — retornado se v não for um número finito
 * @returns {number} — sempre um número finito
 */
export function safe(v, fallback = 0) {
  if (v === null || v === undefined || v === '') return fallback;
  const n = typeof v === 'number' ? v : parseFloat(v);
  return isFinite(n) ? n : fallback;
}

/** safe() que aceita valores negativos (alias semântico para clareza). */
export function safeSigned(v, fallback = 0) {
  return safe(v, fallback);
}

/** safe() que rejeita negativos: retorna 0 para valores < 0. */
export function safePositive(v, fallback = 0) {
  const n = safe(v, fallback);
  return n >= 0 ? n : 0;
}

// ── Operações seguras ─────────────────────────────────────────

/**
 * Multiplicação segura de N argumentos.
 * Se qualquer argumento for NaN/Infinity/undefined → retorna 0.
 *
 * @param  {...*} args — valores a multiplicar
 * @returns {number}
 */
export function safeMul(...args) {
  let result = 1;
  for (let i = 0; i < args.length; i++) {
    const n = safe(args[i]);
    // Se qualquer argumento é zero, o resultado já é zero
    if (n === 0) return 0;
    result *= n;
    if (!isFinite(result)) return 0;
  }
  return result;
}

/**
 * Divisão segura: a / b. Retorna 0 se b === 0.
 *
 * @param {*} a — numerador
 * @param {*} b — denominador
 * @param {number} [fallback=0] — retornado se b === 0
 * @returns {number}
 */
export function safeDiv(a, b, fallback = 0) {
  const num   = safe(a);
  const denom = safe(b);
  if (denom === 0) return fallback;
  const result = num / denom;
  return isFinite(result) ? result : fallback;
}

/**
 * Percentual seguro: (parcial / total) * 100.
 * Retorna 0 se total === 0.
 */
export function safePct(parcial, total) {
  return safeDiv(safe(parcial) * 100, safe(total), 0);
}

/**
 * Soma segura de um array de valores.
 * Ignora silenciosamente valores não-finitos.
 *
 * @param {Array} arr — valores a somar
 * @returns {number}
 */
export function safeSum(arr) {
  if (!Array.isArray(arr)) return 0;
  let total = 0;
  for (let i = 0; i < arr.length; i++) {
    const n = safe(arr[i]);
    total += n;
  }
  return isFinite(total) ? total : 0;
}

/**
 * Arredondamento seguro com modo configurável.
 *
 * @param {*} val — valor a arredondar
 * @param {number} [decimals=2] — casas decimais
 * @param {'truncar'|'arredondar'} [modo='truncar']
 * @returns {number}
 */
export function safeRound(val, decimals = 2, modo = 'truncar') {
  const v = safe(val);
  const factor = Math.pow(10, decimals);
  if (modo === 'truncar') {
    // Compensação floating-point: 63.16 * 1.25 = 78.94999... → precisa normalizar
    // ATENÇÃO: 1e9 causava overflow de Number.MAX_SAFE_INTEGER para valores
    // acima de ~R$90.000 (v × factor × 1e9 > 2^53). Usando ×100/100.
    return Math.trunc(Math.round(v * factor * 100) / 100) / factor;
  }
  return Math.round(v * factor) / factor;
}

/**
 * Clamp seguro: limita val entre min e max.
 */
export function safeClamp(val, min, max) {
  const v = safe(val);
  return Math.min(safe(max, Infinity), Math.max(safe(min, -Infinity), v));
}

/**
 * Compara dois números com tolerância (para evitar false negatives
 * por imprecisão de ponto flutuante).
 *
 * @param {*} a
 * @param {*} b
 * @param {number} [epsilon=0.0001]
 * @returns {boolean} — true se |a - b| < epsilon
 */
export function safeEqual(a, b, epsilon = 0.0001) {
  return Math.abs(safe(a) - safe(b)) < epsilon;
}

/**
 * Calcula valor financeiro de um item: qtd × up × (1 + bdi).
 * Função de conveniência que combina safeMul + safeRound.
 *
 * @param {*} qtd — quantidade medida
 * @param {*} up  — preço unitário
 * @param {*} bdi — BDI (ex: 0.25 para 25%)
 * @param {number} [decimals=2]
 * @returns {number}
 */
export function safeValorItem(qtd, up, bdi = 0.25, decimals = 2) {
  return safeRound(
    safeMul(safe(qtd), safe(up), 1 + safe(bdi)),
    decimals
  );
}

export default {
  safe, safeSigned, safePositive,
  safeMul, safeDiv, safePct,
  safeSum, safeRound, safeClamp,
  safeEqual, safeValorItem,
};
