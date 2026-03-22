/**
 * ╔══════════════════════════════════════════════════════════════╗
 * ║  FISCAL NA OBRA v15.1 — utils/formatters.js                  ║
 * ║  Funções de formatação (substitui funções globais do v12)   ║
 * ╚══════════════════════════════════════════════════════════════╝
 */

import state from '../core/state.js';

export const formatters = {

  /**
   * Formata valor como moeda BRL.
   * Idêntico ao R$() global do v12 com modoCalculo.
   */
  currency(val) {
    const v = parseFloat(val) || 0;
    const cfg = state.get('cfg') || {};
    const modo = cfg.modoCalculo || 'truncar';
    let n;
    if (modo === 'truncar') {
      // CORREÇÃO FLOATING-POINT: 63.16 * 1.25 = 78.94999999999999 em JS.
      // Math.trunc direto daria 78.94. Normalizar antes de truncar corrige.
      // ATENÇÃO: 1e9 causava overflow de Number.MAX_SAFE_INTEGER em valores
      // acima de ~R$ 90.000 (v × 100 × 1e9 > 2^53), corrompendo o round.
      // Usar × 100 / 100 mantém o valor dentro do range seguro de inteiros.
      const f = 100;
      n = Math.trunc(Math.round(v * f * 100) / 100) / f;
    } else {
      n = Math.round(v * 100) / 100;
    }
    return 'R$ ' + n.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  },

  /** Alias para currency */
  R$(val) { return this.currency(val); },

  /**
   * Formata número com N casas decimais (padrão 2).
   * Idêntico ao fmtNum() do v12.
   *
   * CORREÇÃO FLOATING-POINT (truncar mode):
   *   Problema: 63.16 * 1.25 = 78.94999999999999 no motor JS.
   *   Math.trunc(78.94999... * 100) / 100 = 78.94  ← ERRADO
   *   Solução: normalizar com round(valor * fator * 1e9) / 1e9 antes de
   *   truncar — compensa a imprecisão de ponto flutuante sem alterar
   *   valores que são genuinamente menores que o alvo.
   *   Resultado: arredondar(63.16 * 1.25, 2) = 78.95  ✓
   */
  number(val, decimals = 2) {
    const v  = parseFloat(val) || 0;
    const cfg = state.get('cfg') || {};
    const modo = cfg.modoCalculo || 'truncar';
    const factor = Math.pow(10, decimals);
    if (modo === 'truncar') {
      // ATENÇÃO: 1e9 causava overflow de Number.MAX_SAFE_INTEGER em valores
      // elevados, corrompendo o Math.round. Usando × 100 / 100 para manter
      // dentro do range seguro de inteiros IEEE 754.
      return Math.trunc(Math.round(v * factor * 100) / 100) / factor;
    }
    return Math.round(v * factor) / factor;
  },

  /** n4() — número com 4 casas decimais para planilhas */
  n4(val) {
    const v = parseFloat(val) || 0;
    return v.toLocaleString('pt-BR', { minimumFractionDigits: 4, maximumFractionDigits: 4 });
  },

  /** Formata percentual: 25.5 → "25,50 %" */
  percent(val) {
    const v = parseFloat(val) || 0;
    return v.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + ' %';
  },

  /** Formata data ISO → DD/MM/AAAA */
  date(iso) {
    if (!iso) return '';
    try {
      const d = new Date(iso + (iso.includes('T') ? '' : 'T12:00:00'));
      return d.toLocaleDateString('pt-BR');
    } catch { return iso; }
  },

  /** Retorna nome do mês em pt-BR: '2026-02' → 'Fevereiro/2026' */
  monthName(iso) {
    if (!iso) return '';
    try {
      const [y, m] = iso.split('-');
      return new Date(+y, +m - 1).toLocaleString('pt-BR', { month: 'long', year: 'numeric' });
    } catch { return iso; }
  },

  /** Formata CPF: 12345678901 → 123.456.789-01 */
  cpf(val) {
    return String(val || '').replace(/\D/g, '')
      .replace(/(\d{3})(\d{3})(\d{3})(\d{2})/, '$1.$2.$3-$4');
  },

  /** Formata CNPJ: 12345678000100 → 12.345.678/0001-00 */
  cnpj(val) {
    return String(val || '').replace(/\D/g, '')
      .replace(/(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})/, '$1.$2.$3/$4-$5');
  },

  /** Tamanho de arquivo: 1024 → "1,0 KB" */
  fileSize(bytes) {
    const b = parseInt(bytes) || 0;
    if (b < 1024)       return `${b} B`;
    if (b < 1024*1024)  return `${(b/1024).toFixed(1)} KB`;
    return `${(b/(1024*1024)).toFixed(1)} MB`;
  },

  /** Diferença em dias entre duas datas ISO. */
  daysBetween(start, end) {
    try {
      const a = new Date(start + (start.includes('T') ? '' : 'T12:00:00'));
      const b = new Date(end   + (end.includes('T')   ? '' : 'T12:00:00'));
      return Math.round((b - a) / 86400000);
    } catch { return 0; }
  },

  /** Adiciona N dias a uma data ISO, retorna nova data ISO. */
  addDays(iso, days) {
    try {
      const d = new Date(iso + (iso.includes('T') ? '' : 'T12:00:00'));
      d.setDate(d.getDate() + (parseInt(days) || 0));
      return d.toISOString().split('T')[0];
    } catch { return iso; }
  },
};

export default formatters;
