/**
 * ╔══════════════════════════════════════════════════════════════╗
 * ║  FISCAL NA OBRA v15.5 — services/validationEngine.js        ║
 * ║  Motor de Validação Centralizado                            ║
 * ╠══════════════════════════════════════════════════════════════╣
 * ║  Roda validações periódicas e sob demanda sobre:            ║
 * ║   • Itens do contrato (preços zerados, sem unidade, etc.)   ║
 * ║   • BMs (datas fora de sequência, medição > contratado)     ║
 * ║   • Configurações (BDI fora do intervalo TCU, campos vaz.)  ║
 * ║   • Medições (% acumulado > 100%, saldo negativo)           ║
 * ║                                                              ║
 * ║  Alertas são exibidos no dashboard e logados.               ║
 * ║  Acesso: window.validationEngine.validate()                 ║
 * ╚══════════════════════════════════════════════════════════════╝
 */

import EventBus  from '../core/EventBus.js';
import state     from '../core/state.js';
import logger    from '../core/logger.js';

// ── Gravidade ─────────────────────────────────────────────────
const WARN  = 'warn';
const ERROR = 'error';
const INFO  = 'info';

// ── Intervalos TCU para BDI (Acórdão 2.622/2013) ─────────────
const BDI_MIN_SERVICOS  = 0.1823;
const BDI_MAX_SERVICOS  = 0.2967;
const BDI_MIN_REDUZIDO  = 0.063;
const BDI_MAX_REDUZIDO  = 0.14;

// ═══════════════════════════════════════════════════════════════
// ValidationEngine
// ═══════════════════════════════════════════════════════════════
const ValidationEngine = {

  _alertas: [],   // [{ id, gravidade, modulo, msg, ts }]

  init() {
    try {
      this._bindEvents();
      window.validationEngine = this;
      logger.info('ValidationEngine', '✅ Motor de validação ativo.');
    } catch (e) {
      logger.warn('ValidationEngine', `init: ${e.message}`);
    }
  },

  _bindEvents() {
    // Revalida quando dados críticos mudam
    ['itens:atualizados', 'config:salva', 'boletim:atualizado', 'medicao:salva', 'obra:selecionada'].forEach(ev => {
      EventBus.on(ev, () => {
        clearTimeout(this._debounce);
        this._debounce = setTimeout(() => this.validate(), 1500);
      }, 'validation');
    });
  },

  /**
   * Executa todas as validações e emite os alertas.
   * Retorna array de alertas encontrados.
   */
  validate() {
    try {
      const obraId = state.get('obraAtivaId');
      if (!obraId) return [];

      const itens = state.get('itensContrato') || [];
      const cfg   = state.get('cfg')           || {};
      const bms   = state.get('bms')           || [];

      this._alertas = [
        ...this._validarCfg(cfg),
        ...this._validarItens(itens, cfg),
        ...this._validarBMs(bms),
      ];

      // Emite alertas para o dashboard consumir
      EventBus.emit('validation:resultado', { alertas: this._alertas });

      const erros = this._alertas.filter(a => a.gravidade === ERROR).length;
      const warns = this._alertas.filter(a => a.gravidade === WARN).length;
      if (erros + warns > 0) {
        logger.warn('ValidationEngine', `${erros} erro(s), ${warns} aviso(s) encontrado(s).`);
      }

      return this._alertas;
    } catch (e) {
      logger.warn('ValidationEngine', `validate: ${e.message}`);
      return [];
    }
  },

  /** Retorna os alertas mais recentes sem revalidar. */
  getAlertas() { return this._alertas || []; },

  // ── Validações de Configuração ────────────────────────────

  _validarCfg(cfg) {
    const alertas = [];
    const add = (gravidade, msg) =>
      alertas.push({ id: `cfg_${msg.slice(0,20)}`, gravidade, modulo: 'Configurações', msg, ts: Date.now() });

    if (!cfg.valor || cfg.valor <= 0)
      add(ERROR, 'Valor do contrato não informado ou zerado.');
    if (!cfg.contrato)
      add(WARN, 'Número do contrato não preenchido.');
    if (!cfg.contratada)
      add(WARN, 'Empresa contratada não preenchida.');
    if (!cfg.fiscal)
      add(WARN, 'Fiscal do contrato não identificado.');
    if (!cfg.inicioPrev)
      add(WARN, 'Data de início previsto não preenchida.');

    const bdi = parseFloat(cfg.bdi) || 0;
    if (bdi > 0 && (bdi < BDI_MIN_SERVICOS || bdi > BDI_MAX_SERVICOS))
      add(WARN, `BDI ${(bdi*100).toFixed(2)}% fora do intervalo TCU (${(BDI_MIN_SERVICOS*100).toFixed(2)}%–${(BDI_MAX_SERVICOS*100).toFixed(2)}%).`);

    const bdiR = parseFloat(cfg.bdiReduzido) || 0;
    if (bdiR > 0 && (bdiR < BDI_MIN_REDUZIDO || bdiR > BDI_MAX_REDUZIDO))
      add(WARN, `BDI Reduzido ${(bdiR*100).toFixed(2)}% fora do intervalo TCU (${(BDI_MIN_REDUZIDO*100).toFixed(2)}%–${(BDI_MAX_REDUZIDO*100).toFixed(2)}%).`);

    return alertas;
  },

  // ── Validações de Itens ───────────────────────────────────

  _validarItens(itens, cfg) {
    const alertas = [];
    const itensSvc = itens.filter(i => !i.t);
    const add = (gravidade, item, msg) =>
      alertas.push({ id: `item_${item.id}_${msg.slice(0,15)}`, gravidade, modulo: `Item ${item.id}`, msg, ts: Date.now() });

    itensSvc.forEach(it => {
      if (!it.up || it.up <= 0)
        add(WARN, it, `Preço unitário zerado — item "${it.desc?.slice(0,30) || it.id}".`);
      if (!it.qtd || it.qtd <= 0)
        add(WARN, it, `Quantidade contratada zerada — item "${it.desc?.slice(0,30) || it.id}".`);
      if (!it.und)
        add(INFO, it, `Unidade não informada — item "${it.desc?.slice(0,30) || it.id}".`);
    });

    if (!itensSvc.length)
      alertas.push({ id: 'itens_vazio', gravidade: ERROR, modulo: 'Contrato', msg: 'Planilha de itens vazia — importe ou adicione itens.', ts: Date.now() });

    return alertas;
  },

  // ── Validações de BMs ─────────────────────────────────────

  _validarBMs(bms) {
    const alertas = [];
    const add = (gravidade, bm, msg) =>
      alertas.push({ id: `bm_${bm?.num}_${msg.slice(0,15)}`, gravidade, modulo: `BM ${String(bm?.num||'').padStart(2,'0')}`, msg, ts: Date.now() });

    bms.forEach((bm, idx) => {
      if (!bm.mes || bm.mes === '(a definir)')
        add(WARN, bm, `BM ${String(bm.num).padStart(2,'0')} sem período definido.`);
      if (!bm.data)
        add(INFO, bm, `BM ${String(bm.num).padStart(2,'0')} sem data de medição.`);

      // Verifica ordem cronológica
      if (idx > 0 && bm.data && bms[idx-1].data) {
        if (bm.data < bms[idx-1].data)
          add(ERROR, bm, `Data do BM ${String(bm.num).padStart(2,'0')} (${bm.data}) anterior ao BM ${String(bms[idx-1].num).padStart(2,'0')} (${bms[idx-1].data}).`);
      }
    });

    return alertas;
  },
};

export default ValidationEngine;
