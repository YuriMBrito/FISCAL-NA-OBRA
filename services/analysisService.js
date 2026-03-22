/**
 * ╔══════════════════════════════════════════════════════════════╗
 * ║  FISCAL NA OBRA v15.5 — services/analysisService.js         ║
 * ║  Análise Inteligente + Detecção de Risco                    ║
 * ╠══════════════════════════════════════════════════════════════╣
 * ║  Computa métricas de risco e tendência sobre os dados da    ║
 * ║  obra ativa: avanço físico x financeiro, velocidade de      ║
 * ║  execução, projeção de término e índices de desempenho.     ║
 * ║                                                              ║
 * ║  API pública:                                               ║
 * ║    analysisService.computeAnalysis()  → resultado           ║
 * ║    analysisService.getResultado()     → último resultado    ║
 * ╚══════════════════════════════════════════════════════════════╝
 */

import EventBus from '../core/EventBus.js';
import state    from '../core/state.js';
import logger   from '../core/logger.js';

// ── Níveis de risco ──────────────────────────────────────────
const RISCO_BAIXO  = 'baixo';
const RISCO_MEDIO  = 'medio';
const RISCO_ALTO   = 'alto';
const RISCO_CRITICO = 'critico';

// ═══════════════════════════════════════════════════════════════
// AnalysisService
// ═══════════════════════════════════════════════════════════════
const AnalysisService = {

  _resultado: null,
  _debounce:  null,

  init() {
    try {
      this._bindEvents();
      window.analysisService = this;
      logger.info('AnalysisService', '✅ Análise Inteligente ativa.');
    } catch (e) {
      logger.warn('AnalysisService', `init: ${e.message}`);
    }
  },

  _bindEvents() {
    const _re = () => {
      clearTimeout(this._debounce);
      this._debounce = setTimeout(() => this.computeAnalysis(), 2000);
    };
    ['medicao:salva', 'itens:atualizados', 'config:salva', 'obra:selecionada'].forEach(ev => {
      EventBus.on(ev, _re, 'analysis');
    });
  },

  /**
   * Computa análise completa da obra ativa.
   * Emite 'analysis:resultado' com o objeto de resultado.
   */
  computeAnalysis() {
    try {
      const obraId = state.get('obraAtivaId');
      if (!obraId) return null;

      const cfg   = state.get('cfg')            || {};
      const itens = state.get('itensContrato')  || [];
      const bms   = state.get('bms')            || [];

      const resultado = {
        ts:          Date.now(),
        obraId,
        indicadores: this._calcularIndicadores(cfg, itens, bms),
        riscos:      this._detectarRiscos(cfg, itens, bms),
        tendencia:   this._calcularTendencia(cfg, bms),
      };

      this._resultado = resultado;
      EventBus.emit('analysis:resultado', resultado);

      const nCriticos = resultado.riscos.filter(r => r.nivel === RISCO_CRITICO).length;
      const nAltos    = resultado.riscos.filter(r => r.nivel === RISCO_ALTO).length;
      if (nCriticos + nAltos > 0) {
        logger.warn('AnalysisService', `${nCriticos} risco(s) crítico(s), ${nAltos} alto(s).`);
      }

      return resultado;
    } catch (e) {
      logger.warn('AnalysisService', `computeAnalysis: ${e.message}`);
      return null;
    }
  },

  /** Retorna o último resultado computado sem reprocessar. */
  getResultado() {
    return this._resultado;
  },

  // ── Indicadores ──────────────────────────────────────────────

  _calcularIndicadores(cfg, itens, bms) {
    const valorContrato = parseFloat(cfg.valor) || 0;
    const itensSvc      = itens.filter(i => !i.t);

    // Valor total contratado (itens × qtd × up)
    const valorItens = itensSvc.reduce((acc, it) => {
      const bdi   = 1 + (parseFloat(it.bdi ?? cfg.bdi) || 0);
      return acc + (parseFloat(it.up || 0) * parseFloat(it.qtd || 0) * bdi);
    }, 0);

    // Somatório medido em todos os BMs aprovados
    const valorMedido = bms.reduce((acc, bm) => {
      const medicoes = bm.medicoes || [];
      return acc + medicoes.reduce((s, m) => s + (parseFloat(m.valorMedido || 0)), 0);
    }, 0);

    const pctFisico    = valorItens > 0 ? Math.min(valorMedido / valorItens, 1) : 0;
    const pctFinanceiro = valorContrato > 0 ? Math.min(valorMedido / valorContrato, 1) : 0;

    // Índice de Desempenho de Custo (IDC) — simples: físico / financeiro
    const idc = pctFinanceiro > 0 ? pctFisico / pctFinanceiro : null;

    return {
      valorContrato,
      valorItens,
      valorMedido,
      saldoContrato:  valorContrato - valorMedido,
      pctFisico:      +(pctFisico * 100).toFixed(2),
      pctFinanceiro:  +(pctFinanceiro * 100).toFixed(2),
      idc:            idc !== null ? +idc.toFixed(3) : null,
      totalBMs:       bms.length,
    };
  },

  // ── Detecção de Riscos ────────────────────────────────────────

  _detectarRiscos(cfg, itens, bms) {
    const riscos = [];
    const add = (nivel, modulo, msg) =>
      riscos.push({ nivel, modulo, msg, ts: Date.now() });

    const valorContrato = parseFloat(cfg.valor) || 0;
    const itensSvc      = itens.filter(i => !i.t);

    // Risco: obra sem itens
    if (!itensSvc.length) {
      add(RISCO_CRITICO, 'Contrato', 'Planilha de itens vazia — análise incompleta.');
    }

    // Risco: medição acima do contrato
    const valorMedido = bms.reduce((acc, bm) => {
      return acc + (bm.medicoes || []).reduce((s, m) => s + parseFloat(m.valorMedido || 0), 0);
    }, 0);
    if (valorContrato > 0 && valorMedido > valorContrato * 1.01) {
      add(RISCO_CRITICO, 'Financeiro', `Valor medido (R$ ${_fmt(valorMedido)}) supera o contrato (R$ ${_fmt(valorContrato)}).`);
    }

    // Risco: prazo expirado sem obra concluída
    const hoje = new Date().toISOString().slice(0, 10);
    if (cfg.fimPrev && cfg.fimPrev < hoje) {
      const pct = valorContrato > 0 ? (valorMedido / valorContrato * 100).toFixed(1) : '?';
      add(RISCO_ALTO, 'Prazo', `Data de término prevista (${cfg.fimPrev}) ultrapassada. Avanço: ${pct}%.`);
    }

    // Risco: aditivo não formalizado (valor dos itens > contrato em mais de 1%)
    const valorItens = itensSvc.reduce((acc, it) => {
      const bdi = 1 + (parseFloat(it.bdi ?? cfg.bdi) || 0);
      return acc + parseFloat(it.up || 0) * parseFloat(it.qtd || 0) * bdi;
    }, 0);
    if (valorContrato > 0 && valorItens > valorContrato * 1.01) {
      add(RISCO_MEDIO, 'Contrato', `Soma dos itens (R$ ${_fmt(valorItens)}) excede o contrato em ${((valorItens / valorContrato - 1) * 100).toFixed(1)}%.`);
    }

    // Risco: BM sem aprovação há muito tempo (> 60 dias do último)
    if (bms.length) {
      const ultimo = bms[bms.length - 1];
      if (ultimo.data) {
        const diasDesde = Math.floor((Date.now() - new Date(ultimo.data).getTime()) / 86400000);
        if (diasDesde > 60) {
          add(RISCO_MEDIO, 'Medição', `Último BM (${String(ultimo.num).padStart(2,'0')}) há ${diasDesde} dias sem nova medição.`);
        }
      }
    }

    return riscos;
  },

  // ── Tendência de Conclusão ────────────────────────────────────

  _calcularTendencia(cfg, bms) {
    if (bms.length < 2) return null;

    const bmOrdenados = [...bms].filter(b => b.data).sort((a, b) => a.data.localeCompare(b.data));
    if (bmOrdenados.length < 2) return null;

    const valorContrato = parseFloat(cfg.valor) || 0;
    if (!valorContrato) return null;

    // Calcula velocidade média (R$/dia) nos últimos 3 BMs
    const ultimos = bmOrdenados.slice(-3);
    let acumulado = 0;
    let diasTotal = 0;

    for (let i = 1; i < ultimos.length; i++) {
      const dias   = Math.max(1, Math.floor((new Date(ultimos[i].data) - new Date(ultimos[i-1].data)) / 86400000));
      const medBM  = (ultimos[i].medicoes || []).reduce((s, m) => s + parseFloat(m.valorMedido || 0), 0);
      acumulado   += medBM;
      diasTotal   += dias;
    }

    const velocidade = diasTotal > 0 ? acumulado / diasTotal : 0; // R$/dia
    if (!velocidade) return null;

    const totalMedido = bms.reduce((acc, bm) => {
      return acc + (bm.medicoes || []).reduce((s, m) => s + parseFloat(m.valorMedido || 0), 0);
    }, 0);

    const saldo      = Math.max(0, valorContrato - totalMedido);
    const diasFaltam = Math.ceil(saldo / velocidade);
    const previsaoFim = new Date(Date.now() + diasFaltam * 86400000).toISOString().slice(0, 10);

    return {
      velocidadeRsdia:  +velocidade.toFixed(2),
      diasEstimados:    diasFaltam,
      previsaoFimCalc:  previsaoFim,
      confianca:        ultimos.length >= 3 ? 'media' : 'baixa',
    };
  },
};

function _fmt(v) {
  return Number(v).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

export default AnalysisService;
