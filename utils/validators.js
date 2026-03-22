/**
 * ╔══════════════════════════════════════════════════════════════╗
 * ║  FISCAL NA OBRA v15.1 — utils/validators.js                  ║
 * ║  Funções de validação e sanitização                         ║
 * ╚══════════════════════════════════════════════════════════════╝
 */

export const validators = {

  /** Remove campos undefined de um objeto (Firestore não aceita). */
  sanitize(obj) {
    if (obj === null || obj === undefined) return null;
    if (typeof obj !== 'object' || Array.isArray(obj)) return obj;
    const out = {};
    for (const [k, v] of Object.entries(obj)) {
      if (v === undefined) continue;
      out[k] = (typeof v === 'object' && v !== null && !Array.isArray(v))
        ? this.sanitize(v)
        : v;
    }
    return out;
  },

  /** Verifica se objeto é seguro para Firestore (sem undefined). */
  isFirebaseSafe(obj) {
    if (obj === null || obj === undefined) return false;
    if (typeof obj !== 'object') return true;
    return Object.values(obj).every(v => v !== undefined && this.isFirebaseSafe(v));
  },

  /** Valida data ISO (YYYY-MM-DD). */
  isValidDate(iso) {
    if (!iso || typeof iso !== 'string') return false;
    const d = new Date(iso);
    return !isNaN(d.getTime()) && /^\d{4}-\d{2}-\d{2}/.test(iso);
  },

  /** Valida e-mail. */
  isValidEmail(email) {
    return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(email || ''));
  },

  /** Valida CNPJ usando o algoritmo oficial da Receita Federal.
   *  Pesos do 1º dígito: 5,4,3,2,9,8,7,6,5,4,3,2
   *  Pesos do 2º dígito: 6,5,4,3,2,9,8,7,6,5,4,3,2
   *  Aceita CNPJ com ou sem formatação (pontos, barra, traço). */
  isValidCNPJ(cnpj) {
    const s = String(cnpj || '').replace(/\D/g, '');
    if (s.length !== 14) return false;
    if (/^(\d)\1+$/.test(s)) return false; // todos dígitos iguais → inválido

    // Calcula um dígito verificador usando os pesos fornecidos
    const calcDigit = (digits, weights) => {
      const sum = weights.reduce((acc, w, i) => acc + parseInt(digits[i]) * w, 0);
      const r = sum % 11;
      return r < 2 ? 0 : 11 - r;
    };

    const w1 = [5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2];      // pesos do 1º dígito
    const w2 = [6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2];   // pesos do 2º dígito

    return calcDigit(s, w1) === parseInt(s[12]) &&
           calcDigit(s, w2) === parseInt(s[13]);
  },

  /** Valida configuração do Firebase. */
  isValidFirebaseConfig(cfg) {
    if (!cfg || typeof cfg !== 'object') return false;
    const required = ['apiKey', 'authDomain', 'projectId'];
    return required.every(k => typeof cfg[k] === 'string' && cfg[k].trim().length > 0);
  },

  /** Valida item contratual. */
  isValidItem(item) {
    if (!item || typeof item !== 'object') return false;
    if (item.t) return typeof item.id === 'string' && item.id.length > 0;
    return (
      typeof item.id === 'string' && item.id.length > 0 &&
      typeof item.desc === 'string' && item.desc.length > 0 &&
      typeof item.und === 'string' &&
      isFinite(item.qtd) && item.qtd >= 0 &&
      isFinite(item.up)  && item.up  >= 0
    );
  },

  /** Valida BM. */
  isValidBM(bm) {
    return bm && typeof bm.num === 'number' && bm.num > 0 &&
           typeof bm.label === 'string';
  },

  /** Verifica se valor não é vazio (null, undefined, '', [], {}). */
  notEmpty(val) {
    if (val === null || val === undefined || val === '') return false;
    if (Array.isArray(val)) return val.length > 0;
    if (typeof val === 'object') return Object.keys(val).length > 0;
    return true;
  },

  /** Limita valor entre min e max. */
  clamp(val, min, max) {
    return Math.min(max, Math.max(min, parseFloat(val) || 0));
  },

  /**
   * Valida e sanitiza um campo dimensional (comprimento, largura, altura, quantidade).
   * Aceita apenas números positivos ou zero. Retorna 0 se inválido.
   * @param {*} val — valor bruto (string ou number)
   * @returns {number} — valor numérico seguro (>= 0)
   */
  safeDimensional(val) {
    const n = parseFloat(val);
    if (!isFinite(n) || n < 0) return 0;
    return n;
  },

  /**
   * Valida todos os campos dimensionais de uma linha de memória.
   * Retorna objeto sanitizado com valores >= 0.
   * @param {{ comp:*, larg:*, alt:*, qtd:* }} ln
   * @returns {{ comp:number, larg:number, alt:number, qtd:number }}
   */
  sanitizeLinha(ln) {
    return {
      comp: this.safeDimensional(ln?.comp),
      larg: this.safeDimensional(ln?.larg),
      alt:  this.safeDimensional(ln?.alt),
      qtd:  this.safeDimensional(ln?.qtd),
    };
  },

  /**
   * Aplica arredondamento conforme configuração do sistema.
   * @param {number} val
   * @param {number} decimals — casas decimais (padrão 2)
   * @param {'truncar'|'arredondar'} modo
   * @returns {number}
   */
  roundByConfig(val, decimals = 2, modo = 'truncar') {
    const v = parseFloat(val) || 0;
    const factor = Math.pow(10, decimals);
    return modo === 'truncar'
      ? Math.trunc(Math.round(v * factor * 100) / 100) / factor
      : Math.round(v * factor) / factor;
  },
};

export default validators;
