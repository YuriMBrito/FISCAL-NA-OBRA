/**
 * ╔══════════════════════════════════════════════════════════════════════╗
 * ║  FISCAL NA OBRA — services/obra-service.js                         ║
 * ║  Camada de serviço: modules → ObraService → FirebaseService        ║
 * ╠══════════════════════════════════════════════════════════════════════╣
 * ║  PROPÓSITO:                                                         ║
 * ║    Interpõe validação, cache, retry, state sync e logging entre     ║
 * ║    os módulos (consumidores) e o FirebaseService (provedor).        ║
 * ║    Módulos existentes que acessam FirebaseService diretamente       ║
 * ║    continuam funcionando — esta camada é opt-in e aditiva.          ║
 * ╚══════════════════════════════════════════════════════════════════════╝
 */

import { FirebaseService } from '../firebase/firebase-service.js';
import state               from '../core/state.js';
import EventBus            from '../core/EventBus.js';
import logger              from '../core/logger.js';
import MemCache            from '../utils/mem-cache.js';
import { validators }      from '../utils/validators.js';

// ── Helpers ───────────────────────────────────────────────────
function _safeNum(v) {
  const n = parseFloat(v);
  return isFinite(n) ? n : 0;
}

function _ensureObraId(obraId) {
  const id = obraId || state.get('obraAtivaId');
  if (!id) throw new Error('[ObraService] obraId ausente — nenhuma obra ativa.');
  return id;
}

/** Retry wrapper com backoff para operações Firebase transientes. */
async function _withRetry(fn, { attempts = 2, delay = 500, label = '' } = {}) {
  let lastErr;
  for (let i = 0; i < attempts; i++) {
    try {
      return await fn();
    } catch (err) {
      lastErr = err;
      if (i < attempts - 1) {
        logger.warn('ObraService', `⏳ Retry ${i + 1}/${attempts} para "${label}": ${err.message}`);
        await new Promise(r => setTimeout(r, delay * (i + 1)));
      }
    }
  }
  throw lastErr;
}

// ═══════════════════════════════════════════════════════════════
// ObraService
// ═══════════════════════════════════════════════════════════════
export const ObraService = {

  // ── Leitura de dados (com cache + state sync) ───────────────

  /**
   * Carrega a configuração da obra e sincroniza no state.
   * Retorna os dados mesmo se já estiverem em cache.
   */
  async getCfg(obraId = null) {
    const id = _ensureObraId(obraId);
    const data = await _withRetry(
      () => FirebaseService.getObraCfg(id),
      { label: `getCfg(${id})` }
    );
    if (data) state.set('cfg', data);
    return data || state.get('cfg');
  },

  /**
   * Salva a configuração da obra com validação.
   */
  async salvarCfg(cfg, obraId = null) {
    const id = _ensureObraId(obraId);

    // Validação mínima: campos obrigatórios
    if (!cfg || typeof cfg !== 'object') {
      throw new Error('[ObraService] cfg inválida.');
    }

    // Sanitiza antes de salvar
    const sanitized = validators.sanitize(cfg);
    const statusObra = state.get('statusObra') || 'Em andamento';

    await _withRetry(
      () => FirebaseService.setObraCfg(id, sanitized, statusObra),
      { label: `salvarCfg(${id})` }
    );

    state.set('cfg', sanitized);
    EventBus.emit('config:salva', { cfg: sanitized });
    logger.info('ObraService', `✅ Cfg salva para obra "${id}".`);
    return sanitized;
  },

  // ── BMs ─────────────────────────────────────────────────────

  async getBMs(obraId = null) {
    const id = _ensureObraId(obraId);
    const data = await _withRetry(
      () => FirebaseService.getBMs(id),
      { label: `getBMs(${id})` }
    );
    if (data && data.length) state.set('bms', data);
    return data || state.get('bms');
  },

  async salvarBMs(bms, obraId = null) {
    const id = _ensureObraId(obraId);
    if (!Array.isArray(bms)) throw new Error('[ObraService] bms deve ser um array.');

    // Validação: cada BM precisa ter num e label
    const valid = bms.filter(bm => bm && typeof bm.num === 'number' && bm.num > 0);
    if (valid.length !== bms.length) {
      logger.warn('ObraService', `⚠️ ${bms.length - valid.length} BM(s) inválido(s) filtrado(s).`);
    }

    await _withRetry(
      () => FirebaseService.setBMs(id, valid),
      { label: `salvarBMs(${id})` }
    );

    state.set('bms', valid);
    EventBus.emit('boletim:atualizado', { bms: valid });
    return valid;
  },

  // ── Itens Contratuais ───────────────────────────────────────

  async getItens(obraId = null) {
    const id = _ensureObraId(obraId);
    const data = await _withRetry(
      () => FirebaseService.getItens(id),
      { label: `getItens(${id})` }
    );
    if (data && data.length) state.set('itensContrato', data);
    return data || state.get('itensContrato');
  },

  async salvarItens(itens, obraId = null) {
    const id = _ensureObraId(obraId);
    if (!Array.isArray(itens)) throw new Error('[ObraService] itens deve ser um array.');

    const sanitized = itens.map(it => validators.sanitize(it));

    await _withRetry(
      () => FirebaseService.setItens(id, sanitized),
      { label: `salvarItens(${id})` }
    );

    state.set('itensContrato', sanitized);
    EventBus.emit('itens:atualizados', { itens: sanitized });
    return sanitized;
  },

  // ── Medições ────────────────────────────────────────────────

  async getMedicoes(obraId, bmNum) {
    const id = _ensureObraId(obraId);
    const n = _safeNum(bmNum);
    if (n <= 0) return {};
    return _withRetry(
      () => FirebaseService.getMedicoes(id, n),
      { label: `getMedicoes(${id}, BM${n})` }
    );
  },

  async salvarMedicoes(obraId, bmNum, medicoes) {
    const id = _ensureObraId(obraId);
    const n = _safeNum(bmNum);
    if (n <= 0) throw new Error('[ObraService] bmNum inválido.');

    const sanitized = validators.sanitize(medicoes);

    await _withRetry(
      () => FirebaseService.setMedicoes(id, n, sanitized),
      { label: `salvarMedicoes(${id}, BM${n})` }
    );

    EventBus.emit('medicao:salva', { bmNum: n, medicoes: sanitized });
    return sanitized;
  },

  // ── Aditivos ────────────────────────────────────────────────

  async getAditivos(obraId = null) {
    const id = _ensureObraId(obraId);
    const data = await _withRetry(
      () => FirebaseService.getAditivos(id),
      { label: `getAditivos(${id})` }
    );
    if (Array.isArray(data)) state.set('aditivos', data);
    return data || state.get('aditivos');
  },

  async salvarAditivo(obraId, aditivo) {
    const id = _ensureObraId(obraId);
    if (!aditivo || !aditivo.id) throw new Error('[ObraService] Aditivo sem ID.');

    const sanitized = validators.sanitize(aditivo);

    await _withRetry(
      () => FirebaseService.salvarAditivo(id, sanitized),
      { label: `salvarAditivo(${id}, ${aditivo.id})` }
    );

    EventBus.emit('aditivo:salvo', { aditivo: sanitized });
    return sanitized;
  },

  // ── Sincronização completa ──────────────────────────────────

  /**
   * Carrega TODOS os dados de uma obra e popula o state.
   * Ideal para trocar de obra ativa.
   */
  async sincronizarObra(obraId) {
    const id = _ensureObraId(obraId);
    logger.info('ObraService', `🔄 Sincronizando obra "${id}"...`);

    const data = await _withRetry(
      () => FirebaseService.sincronizarObra(id),
      { label: `sincronizarObra(${id})`, attempts: 3 }
    );

    if (!data) return null;

    // Popula o state com todos os dados carregados
    if (data.cfg)                          state.set('cfg', data.cfg);
    if (data.bms && data.bms.length)       state.set('bms', data.bms);
    if (data.itens && data.itens.length)    state.set('itensContrato', data.itens);
    if (Array.isArray(data.aditivos))       state.set('aditivos', data.aditivos);
    if (Array.isArray(data.ocorrencias))    state.set('ocorrencias', data.ocorrencias);
    if (Array.isArray(data.diario))         state.set('diario', data.diario);
    if (Array.isArray(data.notificacoes))   state.set('notificacoes', data.notificacoes);
    if (Array.isArray(data.documentos))     state.set('documentos', data.documentos);
    if (data.historico)                     state.set('historico', data.historico.registros || []);
    if (Array.isArray(data.versoesContratuais)) state.set('versoesContratuais', data.versoesContratuais);

    // Invalida cache antigo
    MemCache.invalidateObra(id);

    logger.info('ObraService', `✅ Obra "${id}" sincronizada.`);
    EventBus.emit('obra:selecionada', { obraId: id });
    return data;
  },

  // ── Helpers de cálculo financeiro seguro ─────────────────────

  /**
   * Calcula o valor total de um item com BDI, com proteção contra
   * NaN, Infinity, e divisão por zero.
   *
   * @param {number} qtd  — quantidade medida
   * @param {number} up   — preço unitário
   * @param {number} bdi  — BDI (ex: 0.25 = 25%)
   * @returns {number} — valor seguro (nunca NaN/Infinity)
   */
  calcValorItem(qtd, up, bdi = 0.25) {
    const q = _safeNum(qtd);
    const u = _safeNum(up);
    const b = _safeNum(bdi);
    const result = q * u * (1 + b);
    return isFinite(result) ? result : 0;
  },

  /**
   * Calcula percentual com proteção contra divisão por zero.
   */
  calcPercentual(parcial, total) {
    const p = _safeNum(parcial);
    const t = _safeNum(total);
    if (t === 0) return 0;
    const result = (p / t) * 100;
    return isFinite(result) ? result : 0;
  },
};

export default ObraService;
