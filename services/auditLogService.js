/**
 * ╔══════════════════════════════════════════════════════════════╗
 * ║  FISCAL NA OBRA v15.5 — services/auditLogService.js         ║
 * ║  Auditoria de Nível de Campo — rastreabilidade TCU/CGU      ║
 * ╠══════════════════════════════════════════════════════════════╣
 * ║  Intercepta eventos do EventBus e registra diffs automáticos║
 * ║  em cada alteração de item, medição, BM ou configuração.    ║
 * ║  Integra-se ao AuditoriaModule existente via window.auditRegistrar║
 * ╚══════════════════════════════════════════════════════════════╝
 */

import EventBus        from '../core/EventBus.js';
import state           from '../core/state.js';
import logger          from '../core/logger.js';
import FirebaseService from '../firebase/firebase-service.js';

// ── Campos sensíveis que sempre geram entrada de auditoria ────
const CAMPOS_SENSIVEIS_ITEM = ['up', 'qtd', 'und', 'desc', 'bdi', 'tipoBdi', 'upRef'];
const CAMPOS_SENSIVEIS_CFG  = ['valor', 'bdi', 'bdiReduzido', 'contrato', 'contratada'];

// ── Cache de snapshots anteriores para gerar diffs ─────────────
const _snapshots = {
  itens:  null,
  cfg:    null,
  bms:    null,
};

// ── Serialização simples para diff ─────────────────────────────
function _snap(obj) {
  try { return JSON.parse(JSON.stringify(obj ?? null)); } catch { return null; }
}

function _diffItens(antes, depois) {
  if (!antes || !depois) return [];
  const diffs = [];
  const mapaAntes = Object.fromEntries((antes || []).map(i => [i.id, i]));
  const mapaDepois = Object.fromEntries((depois || []).map(i => [i.id, i]));

  // Itens modificados
  for (const [id, itemDepois] of Object.entries(mapaDepois)) {
    const itemAntes = mapaAntes[id];
    if (!itemAntes) {
      diffs.push({ tipo: 'criação', item: id, desc: itemDepois.desc || id });
      continue;
    }
    for (const campo of CAMPOS_SENSIVEIS_ITEM) {
      if (itemAntes[campo] !== itemDepois[campo]) {
        diffs.push({
          tipo: 'edição',
          item: id,
          desc: itemDepois.desc || id,
          campo,
          antes:  itemAntes[campo],
          depois: itemDepois[campo],
        });
      }
    }
  }
  // Itens excluídos
  for (const [id, itemAntes] of Object.entries(mapaAntes)) {
    if (!mapaDepois[id]) {
      diffs.push({ tipo: 'exclusão', item: id, desc: itemAntes.desc || id });
    }
  }
  return diffs;
}

function _fmtValor(v) {
  if (v === undefined || v === null) return '—';
  if (typeof v === 'number') return v.toLocaleString('pt-BR');
  return String(v);
}

// ═══════════════════════════════════════════════════════════════
// AuditLogService
// ═══════════════════════════════════════════════════════════════
const AuditLogService = {

  init() {
    try {
      // Captura snapshot inicial
      _snapshots.itens = _snap(state.get('itensContrato'));
      _snapshots.cfg   = _snap(state.get('cfg'));
      _snapshots.bms   = _snap(state.get('bms'));

      this._bindEvents();
      logger.info('AuditLogService', '✅ Auditoria de campo ativa.');
    } catch (e) {
      logger.warn('AuditLogService', `init: ${e.message}`);
    }
  },

  _bindEvents() {
    // ── Itens do contrato alterados ──────────────────────────
    EventBus.on('itens:atualizados', () => {
      try {
        const antes  = _snapshots.itens;
        const depois = state.get('itensContrato') || [];
        if (!antes) { _snapshots.itens = _snap(depois); return; }

        const diffs = _diffItens(antes, depois);
        diffs.forEach(d => {
          const detalhe = d.campo
            ? `Campo "${d.campo}": ${_fmtValor(d.antes)} → ${_fmtValor(d.depois)}`
            : d.desc;
          window.auditRegistrar?.({
            modulo:     'Contrato',
            tipo:       d.tipo,
            registro:   `Item ${d.item}`,
            detalhe,
            valorAntes:  d.antes,
            valorDepois: d.depois,
          });
        });

        _snapshots.itens = _snap(depois);
      } catch (e) {
        logger.warn('AuditLogService', `itens:atualizados: ${e.message}`);
      }
    }, 'auditLog');

    // ── Medição salva ─────────────────────────────────────────
    EventBus.on('medicao:salva', ({ bmNum, obraId }) => {
      try {
        window.auditRegistrar?.({
          modulo:   'Boletim de Medição',
          tipo:     'salvo',
          registro: `BM ${String(bmNum).padStart(2, '0')}`,
          detalhe:  `Medição persistida — obra ${obraId || state.get('obraAtivaId')}`,
        });
      } catch (e) {
        logger.warn('AuditLogService', `medicao:salva: ${e.message}`);
      }
    }, 'auditLog');

    // ── Config da obra alterada ───────────────────────────────
    EventBus.on('config:salva', ({ cfg }) => {
      try {
        const antes  = _snapshots.cfg;
        const depois = cfg || state.get('cfg') || {};

        if (antes) {
          const diffs = [];
          for (const campo of CAMPOS_SENSIVEIS_CFG) {
            if (antes[campo] !== depois[campo]) {
              diffs.push({ campo, antes: antes[campo], depois: depois[campo] });
            }
          }
          diffs.forEach(d => {
            window.auditRegistrar?.({
              modulo:      'Configurações',
              tipo:        'edição',
              registro:    `Campo "${d.campo}"`,
              detalhe:     `${_fmtValor(d.antes)} → ${_fmtValor(d.depois)}`,
              valorAntes:  d.antes,
              valorDepois: d.depois,
            });
          });
        }

        _snapshots.cfg = _snap(depois);
      } catch (e) {
        logger.warn('AuditLogService', `config:salva: ${e.message}`);
      }
    }, 'auditLog');

    // ── BM criado ─────────────────────────────────────────────
    EventBus.on('boletim:criado', ({ bm }) => {
      try {
        window.auditRegistrar?.({
          modulo:   'Boletim de Medição',
          tipo:     'criação',
          registro: bm?.label || `BM ${bm?.num}`,
          detalhe:  `Período: ${bm?.mes || '—'}`,
        });
        _snapshots.bms = _snap(state.get('bms'));
      } catch (e) { /* silencioso */ }
    }, 'auditLog');

    // ── Aditivo salvo ─────────────────────────────────────────
    EventBus.on('aditivo:salvo', ({ aditivo }) => {
      try {
        window.auditRegistrar?.({
          modulo:   'Aditivos',
          tipo:     'salvo',
          registro: aditivo?.numero || aditivo?.id || '—',
          detalhe:  `Tipo: ${aditivo?.tipo || '—'} | Valor: ${aditivo?.valor != null ? Number(aditivo.valor).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' }) : '—'}`,
        });
      } catch (e) { /* silencioso */ }
    }, 'auditLog');

    // ── Obra selecionada — atualiza snapshots ─────────────────
    EventBus.on('obra:selecionada', () => {
      setTimeout(() => {
        _snapshots.itens = _snap(state.get('itensContrato'));
        _snapshots.cfg   = _snap(state.get('cfg'));
        _snapshots.bms   = _snap(state.get('bms'));
      }, 500);
    }, 'auditLog');
  },
};

export default AuditLogService;
