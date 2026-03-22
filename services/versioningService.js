/**
 * ╔══════════════════════════════════════════════════════════════╗
 * ║  FISCAL NA OBRA v15.5 — services/versioningService.js       ║
 * ║  Versionamento dos Itens do Contrato por BM                 ║
 * ╠══════════════════════════════════════════════════════════════╣
 * ║  Cada vez que um BM é marcado como Salvo, uma snapshot      ║
 * ║  imutável dos itens do contrato é gravada no Firestore.     ║
 * ║  Permite comparar a planilha em qualquer BM anterior.       ║
 * ║                                                              ║
 * ║  API pública:                                               ║
 * ║    versioningService.getSnapshot(obraId, bmNum)             ║
 * ║    versioningService.listarVersions(obraId)                 ║
 * ║    versioningService.diffBMs(obraId, bmA, bmB)              ║
 * ╚══════════════════════════════════════════════════════════════╝
 */

import EventBus        from '../core/EventBus.js';
import state           from '../core/state.js';
import logger          from '../core/logger.js';
import FirebaseService from '../firebase/firebase-service.js';

// ── Helpers ──────────────────────────────────────────────────
const _snap = obj => { try { return JSON.parse(JSON.stringify(obj ?? null)); } catch { return null; } };

function _itensDiff(snapA, snapB) {
  if (!snapA || !snapB) return [];
  const diffs = [];
  const mapaA = Object.fromEntries(snapA.map(i => [i.id, i]));
  const mapaB = Object.fromEntries(snapB.map(i => [i.id, i]));

  const CAMPOS = ['desc', 'und', 'qtd', 'up', 'bdi', 'tipoBdi'];

  for (const [id, b] of Object.entries(mapaB)) {
    const a = mapaA[id];
    if (!a) { diffs.push({ tipo: 'novo', item: id, desc: b.desc }); continue; }
    for (const c of CAMPOS) {
      if (a[c] !== b[c]) diffs.push({ tipo: 'alterado', item: id, desc: b.desc, campo: c, de: a[c], para: b[c] });
    }
  }
  for (const [id, a] of Object.entries(mapaA)) {
    if (!mapaB[id]) diffs.push({ tipo: 'removido', item: id, desc: a.desc });
  }
  return diffs;
}

// ═══════════════════════════════════════════════════════════════
// VersioningService
// ═══════════════════════════════════════════════════════════════
const VersioningService = {

  _cache: {},  // obraId → { bmNum → snapshot }

  init() {
    try {
      this._bindEvents();
      // Expõe globalmente para uso em outros módulos
      window.versioningService = this;
      logger.info('VersioningService', '✅ Versionamento de itens ativo.');
    } catch (e) {
      logger.warn('VersioningService', `init: ${e.message}`);
    }
  },

  _bindEvents() {
    // Cria snapshot quando um BM é marcado como Salvo
    EventBus.on('medicao:salva', async ({ bmNum, obraId }) => {
      try {
        const oid   = obraId || state.get('obraAtivaId');
        const itens = state.get('itensContrato') || [];
        const cfg   = state.get('cfg') || {};
        if (!oid || !itens.length) return;

        await this._salvarSnapshot(oid, bmNum, itens, cfg);
      } catch (e) {
        logger.warn('VersioningService', `medicao:salva snapshot: ${e.message}`);
      }
    }, 'versioning');

    // Limpa cache ao trocar de obra
    EventBus.on('obra:selecionada', ({ obraId }) => {
      if (obraId) delete this._cache[obraId];
    }, 'versioning');
  },

  async _salvarSnapshot(obraId, bmNum, itens, cfg) {
    const snap = {
      bmNum,
      criadoEm: new Date().toISOString(),
      versaoContrato: cfg.contractVersion || 1,
      itens: _snap(itens),
    };

    // Persiste no Firestore
    try {
      await FirebaseService._db
        ?.collection('obras').doc(obraId)
        .collection('versoes_itens').doc(`bm${bmNum}`)
        .set(snap);
    } catch (e) {
      // Firebase pode não ter permissão — salva apenas em memória
      logger.warn('VersioningService', `Firebase write: ${e.message}`);
    }

    // Salva no cache local
    if (!this._cache[obraId]) this._cache[obraId] = {};
    this._cache[obraId][bmNum] = snap;

    logger.info('VersioningService', `📸 Snapshot BM ${String(bmNum).padStart(2,'0')} salvo (${itens.length} itens).`);
    return snap;
  },

  /**
   * Retorna o snapshot dos itens para um BM específico.
   * Tenta cache local → Firestore.
   */
  async getSnapshot(obraId, bmNum) {
    const oid = obraId || state.get('obraAtivaId');
    if (!oid) return null;

    if (this._cache[oid]?.[bmNum]) return this._cache[oid][bmNum];

    try {
      const doc = await FirebaseService._db
        ?.collection('obras').doc(oid)
        .collection('versoes_itens').doc(`bm${bmNum}`)
        .get();
      if (doc?.exists) {
        const data = doc.data();
        if (!this._cache[oid]) this._cache[oid] = {};
        this._cache[oid][bmNum] = data;
        return data;
      }
    } catch (e) {
      logger.warn('VersioningService', `getSnapshot: ${e.message}`);
    }
    return null;
  },

  /**
   * Lista todos os BMs que têm snapshot salvo para a obra.
   */
  async listarVersions(obraId) {
    const oid = obraId || state.get('obraAtivaId');
    if (!oid) return [];
    try {
      const snaps = await FirebaseService._db
        ?.collection('obras').doc(oid)
        .collection('versoes_itens').get();
      return snaps?.docs.map(d => d.data()) || [];
    } catch (e) {
      logger.warn('VersioningService', `listarVersions: ${e.message}`);
      return [];
    }
  },

  /**
   * Compara os itens entre dois BMs.
   * Retorna array de diffs: { tipo, item, desc, campo?, de?, para? }
   */
  async diffBMs(obraId, bmNumA, bmNumB) {
    const oid  = obraId || state.get('obraAtivaId');
    const [sA, sB] = await Promise.all([
      this.getSnapshot(oid, bmNumA),
      this.getSnapshot(oid, bmNumB),
    ]);
    if (!sA || !sB) return [];
    return _itensDiff(sA.itens, sB.itens);
  },
};

export default VersioningService;
