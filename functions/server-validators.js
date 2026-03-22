/**
 * ╔══════════════════════════════════════════════════════════════╗
 * ║  FISCAL NA OBRA v15.1 — utils/server-validators.js         ║
 * ║                                                              ║
 * ║  Validações de regras de negócio críticas compartilhadas    ║
 * ║  entre cliente e Cloud Functions (server-side enforcement). ║
 * ║                                                              ║
 * ║  PROBLEMA ANTERIOR: regras de negócio como limite de 25%   ║
 * ║  dos aditivos (Art. 125 Lei 14.133) existiam APENAS no      ║
 * ║  cliente — um usuário técnico autenticado podia enviar       ║
 * ║  dados inválidos diretamente para o Firestore via REST.     ║
 * ║                                                              ║
 * ║  SOLUÇÃO: estas funções são usadas em DOIS lugares:         ║
 * ║   1. No cliente (validação UX antes de salvar)              ║
 * ║   2. No Cloud Function functions/index.js (server-side)     ║
 * ║      que rejeita escritas inválidas antes de persistir.     ║
 * ╚══════════════════════════════════════════════════════════════╝
 */

/**
 * Valida se um aditivo respeita os limites do Art. 125 da Lei 14.133/2021.
 *
 * Limites:
 *  - Obras e serviços de engenharia: até 25% para acréscimos e supressões
 *  - Compras e outros serviços: até 25% para acréscimos e 25% para supressões
 *  - Reforma de edifício/equipamento: até 50% para acréscimos
 *
 * @param {object} params
 * @param {number} params.valorOriginalContrato — valor original do contrato (R$)
 * @param {number} params.totalAcrescimos        — soma de todos os acréscimos acumulados (R$)
 * @param {number} params.totalSupressoes        — soma de todas as supressões acumuladas (R$)
 * @param {string} params.tipoContrato           — 'obras'|'servicos'|'compras'|'reforma'
 * @returns {{ ok: boolean, erros: string[] }}
 */
export function validarLimitesAditivo({ valorOriginalContrato, totalAcrescimos, totalSupressoes, tipoContrato = 'obras' }) {
  const erros = [];

  if (!valorOriginalContrato || valorOriginalContrato <= 0) {
    erros.push('Valor original do contrato inválido.');
    return { ok: false, erros };
  }

  const limiteAcrescimo = tipoContrato === 'reforma' ? 0.50 : 0.25;
  const limiteSupressao = 0.25; // sempre 25% para supressões

  const pctAcrescimo = totalAcrescimos / valorOriginalContrato;
  const pctSupressao = totalSupressoes / valorOriginalContrato;

  if (pctAcrescimo > limiteAcrescimo) {
    const limPct = (limiteAcrescimo * 100).toFixed(0);
    const atualPct = (pctAcrescimo * 100).toFixed(2);
    erros.push(
      `Acréscimos acumulados (${atualPct}%) excedem o limite de ${limPct}% ` +
      `previsto no Art. 125 da Lei 14.133/2021.`
    );
  }

  if (pctSupressao > limiteSupressao) {
    const atualPct = (pctSupressao * 100).toFixed(2);
    erros.push(
      `Supressões acumuladas (${atualPct}%) excedem o limite de 25% ` +
      `previsto no Art. 125 da Lei 14.133/2021.`
    );
  }

  return { ok: erros.length === 0, erros };
}

/**
 * Valida se uma medição não ultrapassa 100% da quantidade contratada.
 *
 * @param {object} params
 * @param {number} params.qtdContratada     — quantidade original do item
 * @param {number} params.qtdAcumuladaAntes — acumulado antes deste BM
 * @param {number} params.qtdMedicaoAtual   — quantidade medida neste BM
 * @returns {{ ok: boolean, erros: string[], qtdPermitida: number }}
 */
export function validarCapMedicao({ qtdContratada, qtdAcumuladaAntes, qtdMedicaoAtual }) {
  const erros = [];
  const qtdPermitida = Math.max(0, qtdContratada - qtdAcumuladaAntes);

  if (qtdMedicaoAtual > qtdPermitida) {
    erros.push(
      `Medição (${qtdMedicaoAtual}) ultrapassa o saldo disponível (${qtdPermitida.toFixed(4)}) ` +
      `do item. Acumulado anterior: ${qtdAcumuladaAntes.toFixed(4)} / Contratado: ${qtdContratada.toFixed(4)}.`
    );
  }

  return { ok: erros.length === 0, erros, qtdPermitida };
}

/**
 * Valida CNPJ usando o algoritmo oficial da Receita Federal.
 * Fonte única de verdade — mesma lógica usada no cliente e no servidor.
 *
 * @param {string} cnpj
 * @returns {boolean}
 */
export function validarCNPJ(cnpj) {
  const s = String(cnpj || '').replace(/\D/g, '');
  if (s.length !== 14) return false;
  if (/^(\d)\1+$/.test(s)) return false;

  const calcDigit = (digits, weights) => {
    const sum = weights.reduce((acc, w, i) => acc + parseInt(digits[i]) * w, 0);
    const r = sum % 11;
    return r < 2 ? 0 : 11 - r;
  };

  const w1 = [5,4,3,2,9,8,7,6,5,4,3,2];
  const w2 = [6,5,4,3,2,9,8,7,6,5,4,3,2];

  return calcDigit(s, w1) === parseInt(s[12]) &&
         calcDigit(s, w2) === parseInt(s[13]);
}

/**
 * Valida se uma data de prorrogação é admissível (Art. 111 Lei 14.133).
 * A nova data deve ser posterior à data atual de término e ter justificativa.
 *
 * @param {string} dataTerminoAtual — ISO date (YYYY-MM-DD)
 * @param {string} novaDataTermino  — ISO date (YYYY-MM-DD)
 * @param {string} justificativa
 * @returns {{ ok: boolean, erros: string[] }}
 */
export function validarProrrogacao({ dataTerminoAtual, novaDataTermino, justificativa }) {
  const erros = [];

  if (!justificativa || justificativa.trim().length < 20) {
    erros.push('Justificativa obrigatória com ao menos 20 caracteres (Art. 111 Lei 14.133/2021).');
  }

  if (!novaDataTermino) {
    erros.push('Nova data de término é obrigatória.');
  } else if (novaDataTermino <= dataTerminoAtual) {
    erros.push('Nova data de término deve ser posterior à data de término atual.');
  }

  return { ok: erros.length === 0, erros };
}
