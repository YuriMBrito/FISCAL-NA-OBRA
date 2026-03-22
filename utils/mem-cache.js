/**
 * ╔══════════════════════════════════════════════════════════════╗
 * ║  FISCAL NA OBRA v20 — utils/mem-cache.js                   ║
 * ║  Problema 4 — Consultas Firebase repetidas                 ║
 * ╚══════════════════════════════════════════════════════════════╝
 *
 * PROPÓSITO:
 *   Cache em memória com TTL (time-to-live) para dados Firebase.
 *   Evita múltiplas requisições para os mesmos dados dentro
 *   de uma sessão de trabalho.
 *
 * ESTRATÉGIA:
 *   - Cada entrada tem uma chave derivada de (tipo, obraId, [extra]).
 *   - TTL padrão: 30 segundos (configurável por chave).
 *   - Invalidação automática ao salvar (write-through).
 *   - Não altera a lógica de consulta existente no firebase-service.
 *   - O FirebaseService usa o cache internamente (wrapper não intrusivo).
 *
 * USO (no FirebaseService — adicionado nos métodos get):
 *   import MemCache from '../utils/mem-cache.js';
 *
 *   async getAditivos(obraId) {
 *     const cached = MemCache.get('aditivos', obraId);
 *     if (cached !== null) return cached;
 *     // ... consulta Firebase ...
 *     MemCache.set('aditivos', obraId, resultado);
 *     return resultado;
 *   }
 *
 *   async salvarAditivo(obraId, aditivo) {
 *     MemCache.invalidate('aditivos', obraId); // write-through
 *     // ... salva no Firebase ...
 *   }
 */

// TTL padrão por tipo de dado (em ms)
const TTL_MAP = {
  obras:        60_000,         // 60s — lista de obras muda pouco
  cfg:          30_000,         // 30s — configurações da obra
  bms:          20_000,         // 20s — boletins
  itens:        20_000,         // 20s — itens do contrato
  medicoes:     30 * 60_000,    // 30min — dados ativos de medição (write-through)
  aditivos:     30_000,         // 30s
  ocorrencias:  20_000,         // 20s
  chuva:        60_000,         // 60s — raramente muda
  diario:       20_000,         // 20s
  notificacoes: 20_000,         // 20s
  historico:    60_000,         // 60s
  usuarios:     60_000,         // 60s
  versoes:      30_000,         // 30s
  _default:     15_000,         // 15s para tipos não mapeados
};

class MemCacheClass {
  constructor() {
    this._store = new Map(); // key → { data, expiresAt, lastAccess }
    this._hits  = 0;
    this._miss  = 0;
    this._maxEntries = 200;  // LRU eviction threshold
  }

  // ── Gera chave de cache ─────────────────────────────────────
  _key(type, obraId, extra = '') {
    return `${type}::${obraId || '_global'}${extra ? '::' + extra : ''}`;
  }

  // ── LRU eviction ────────────────────────────────────────────
  _evictIfNeeded() {
    if (this._store.size <= this._maxEntries) return;
    // Find oldest entry by lastAccess
    let oldestKey = null;
    let oldestTs = Infinity;
    for (const [key, entry] of this._store) {
      if (entry.lastAccess < oldestTs) {
        oldestTs = entry.lastAccess;
        oldestKey = key;
      }
    }
    if (oldestKey) this._store.delete(oldestKey);
  }

  // ── get ─────────────────────────────────────────────────────
  /**
   * @param {string} type   - Tipo de dado ('aditivos', 'bms', etc.)
   * @param {string} obraId - ID da obra
   * @param {string} [extra] - Discriminador adicional (ex: bmNum)
   * @returns {*|null}  Dados em cache ou null se expirado/ausente
   */
  get(type, obraId, extra = '') {
    const key   = this._key(type, obraId, extra);
    const entry = this._store.get(key);
    if (!entry) { this._miss++; return null; }
    if (Date.now() > entry.expiresAt) {
      this._store.delete(key);
      this._miss++;
      return null;
    }
    entry.lastAccess = Date.now(); // LRU tracking
    this._hits++;
    return entry.data;
  }

  // ── set ─────────────────────────────────────────────────────
  /**
   * @param {string} type   - Tipo de dado
   * @param {string} obraId - ID da obra
   * @param {*}      data   - Dados a armazenar
   * @param {string} [extra] - Discriminador adicional
   */
  set(type, obraId, data, extra = '') {
    const key    = this._key(type, obraId, extra);
    const ttl    = TTL_MAP[type] ?? TTL_MAP._default;
    this._store.set(key, { data, expiresAt: Date.now() + ttl, lastAccess: Date.now() });
    this._evictIfNeeded();
  }

  // ── invalidate ──────────────────────────────────────────────
  /**
   * Remove todas as entradas para (type, obraId).
   * Chame sempre que salvar/atualizar dados no Firebase.
   *
   * @param {string} type   - Tipo de dado
   * @param {string} [obraId] - ID da obra (omitir = limpa todos do tipo)
   */
  invalidate(type, obraId = null) {
    if (obraId) {
      // Remove entradas que começam com type::obraId
      const prefix = `${type}::${obraId}`;
      for (const key of this._store.keys()) {
        if (key.startsWith(prefix)) this._store.delete(key);
      }
    } else {
      // Remove todas do tipo
      const prefix = `${type}::`;
      for (const key of this._store.keys()) {
        if (key.startsWith(prefix)) this._store.delete(key);
      }
    }
  }

  // ── invalidateObra ──────────────────────────────────────────
  /**
   * Invalida TODOS os dados de uma obra específica.
   * Útil após trocar de obra ativa.
   *
   * @param {string} obraId
   */
  invalidateObra(obraId) {
    for (const key of this._store.keys()) {
      if (key.includes(`::${obraId}:`)) this._store.delete(key);
    }
  }

  // ── clear ───────────────────────────────────────────────────
  clear() { this._store.clear(); }

  // ── stats ───────────────────────────────────────────────────
  stats() {
    return {
      keys:  this._store.size,
      hits:  this._hits,
      miss:  this._miss,
      ratio: this._hits + this._miss > 0
        ? ((this._hits / (this._hits + this._miss)) * 100).toFixed(1) + '%'
        : '—',
    };
  }
}

const MemCache = new MemCacheClass();
export default MemCache;
