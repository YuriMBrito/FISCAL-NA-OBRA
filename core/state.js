/**
 * ╔══════════════════════════════════════════════════════════════╗
 * ║  FISCAL NA OBRA v15.1 — core/state.js                        ║
 * ║  Estado central do sistema (substitui todas as globais)     ║
 * ╚══════════════════════════════════════════════════════════════╝
 *
 * Substitui as variáveis globais do v12:
 *   ITENS_CONTRATO → state.get('itensContrato')
 *   BMS            → state.get('bms')
 *   CFG            → state.get('cfg')
 *   OBRA_ATIVA_ID  → state.get('obraAtivaId')
 *   OBRAS_LISTA    → state.get('obrasLista')
 *   ADITIVOS       → state.get('aditivos')
 *   STATUS_OBRA    → state.get('statusObra')
 *   NOTIFICACOES   → state.get('notificacoes')
 *   DIARIO         → state.get('diario')
 *   OCORRENCIAS    → state.get('ocorrencias')
 *   dadosChuva     → state.get('dadosChuva')
 *   LOGO_BASE64    → state.get('logoBase64')
 *   VERSOES_CONTRATUAIS → state.get('versoesContratuais')
 *   OBRA_META      → state.get('obraMeta')
 */

import EventBus from './EventBus.js';

const INITIAL_STATE = {
  /* ── Sessão ── */
  usuarioLogado:   null,   // { uid, email, displayName }

  /* ── Obra ativa ── */
  obraAtivaId:     '',
  statusObra:      'Em andamento',

  /* ── Dados do contrato ── */
  cfg: {
    contrato: '', bdi: 0.25, bdiReduzido: 0.10, objeto: '',
    contratante: '', contratada: '', cnpj: '',
    valor: 0, fiscal: '', creaFiscal: '',
    rt: '', creaRT: '', duracaoDias: 0,
    inicioPrev: '', inicioReal: '', termino: '',
    modoCalculo: 'truncar', tipoObra: 'prefeitura',
  },
  itensContrato:      [],
  bms:                [{ num: 1, label: 'BM 01', mes: '(a definir)', data: '', contractVersion: 1 }],

  /* ── Listas de obras ── */
  obrasLista:         [],

  /* ── Aditivos e versões contratuais ── */
  aditivos:           [],
  versoesContratuais: [],
  obraMeta:           { contractVersion: 1 },

  /* ── Módulos operacionais ── */
  notificacoes:       [],
  diario:             [],
  ocorrencias:        [],
  dadosChuva:         {},
  documentos:         [],
  historico:          [],
  usuarios:           [],
  responsaveis:       [],

  /* ── Módulos PAC / Obras Federais (FIX-E2.3) ── */
  // Dados centralizados para evitar re-fetch a cada troca de aba
  // e habilitar uso cross-módulo (ex: relatorio-federal lê etapasPac do state)
  fotosMedicao:       [],
  checklistTecnico:   [],
  etapasPac:          [],
  qualidadeMateriais: [],

  /* ── UI ── */
  logoBase64:         '',

  paginaAtiva:        'dashboard',

  /* ── Firebase ── */
  firebaseConectado:  false,
  firebaseProjectId:  '',
};

class StateManager {
  constructor() {
    this._state       = this._deepClone(INITIAL_STATE);
    this._subscribers = {};
    this._history     = [];
    this._histIdx     = -1;
    this._maxHist     = 10;  // Limite de 10 ações conforme requisito

    // ── Auto-history: chaves que disparam pushHistory automaticamente ──
    // Qualquer state.set() nessas chaves salva snapshot ANTES da mudança,
    // sem precisar alterar nenhum módulo individualmente.
    this._trackedKeys = new Set([
      'bms', 'cfg', 'itensContrato', 'aditivos', 'diario',
      'documentos', 'ocorrencias', 'obrasLista', 'obraMeta',
      'versoesContratuais', 'medicoes',
      // FIX-E2.3: módulos PAC entram no histórico automático de undo/redo
      'etapasPac', 'checklistTecnico',
    ]);
    // Debounce: evita N entradas para operações em batch (ex: setBatch)
    this._histDebounceTimer = null;
    this._pendingHistDesc   = null;
  }

  // ── Leitura ───────────────────────────────────────────────────

  /** Retorna deep-copy de uma chave. Nunca retorna referência interna. */
  get(key) {
    if (!(key in this._state)) {
      console.warn(`[State] Chave desconhecida: "${key}"`);
      return undefined;
    }
    return this._deepClone(this._state[key]);
  }

  /**
   * Retorna valor da chave ou fallback se null/undefined/vazio.
   * Evita que módulos precisem de || ou ?? em cada chamada.
   */
  getOrDefault(key, fallback) {
    const val = this.get(key);
    if (val === null || val === undefined) return fallback;
    if (Array.isArray(val) && val.length === 0) return fallback;
    if (typeof val === 'string' && val.trim() === '') return fallback;
    return val;
  }

  /** Retorna snapshot completo (deep-copy). */
  snapshot() {
    return this._deepClone(this._state);
  }

  // ── Escrita ───────────────────────────────────────────────────

  /**
   * Atualiza uma chave do estado e notifica subscribers.
   * @param {string}  key
   * @param {*}       value
   * @param {boolean} [merge=false] — faz Object.assign se true e value é objeto
   */
  set(key, value, merge = false) {
    if (!(key in this._state)) {
      console.warn(`[State] set() com chave desconhecida: "${key}"`);
    }

    const prev = this._state[key];
    let next;

    if (merge && value && typeof value === 'object' && !Array.isArray(value)) {
      next = Object.assign({}, prev, value);
    } else {
      next = this._deepClone(value);
    }

    // ── Auto-history: captura snapshot ANTES de alterar chaves rastreadas ──
    // Isso alimenta Ctrl+Z/Ctrl+Y sem precisar alterar nenhum módulo.
    if (this._trackedKeys && this._trackedKeys.has(key)) {
      this._scheduleAutoHistory(key);
    }

    this._state[key] = next;

    // Notifica subscribers locais
    const subs = this._subscribers[key];
    if (subs) {
      subs.forEach(fn => {
        try { fn(this._deepClone(next), this._deepClone(prev)); }
        catch (e) { console.error(`[State] Subscriber "${key}" erro:`, e); }
      });
    }

    // Emite evento genérico no EventBus
    EventBus.emitAsync('state:changed', { key, value: this._deepClone(next) });
  }

  /**
   * Agenda pushHistory com debounce de 300ms para absorver operações em
   * batch (ex: salvar cfg + bms ao mesmo tempo conta como 1 ação no histórico).
   */
  _scheduleAutoHistory(key) {
    // Só faz push se não houver um push em andamento no mesmo tick
    if (this._histDebounceTimer) {
      clearTimeout(this._histDebounceTimer);
    } else {
      // Primeiro set do lote: captura snapshot AGORA (antes de alterar o state)
      this._pendingSnap = this.snapshot();
    }
    this._pendingHistDesc = key;
    this._histDebounceTimer = setTimeout(() => {
      this._histDebounceTimer = null;
      if (this._pendingSnap) {
        // Insere o snapshot capturado antes das mudanças deste lote
        this._history = this._history.slice(0, this._histIdx + 1);
        this._history.push({
          snap: this._pendingSnap,
          desc: this._pendingHistDesc || 'ação',
          ts:   Date.now(),
        });
        if (this._history.length > this._maxHist) this._history.shift();
        this._histIdx = this._history.length - 1;
        this._pendingSnap = null;
        this._pendingHistDesc = null;
      }
    }, 300);
  }

  /** Atualiza múltiplas chaves de uma vez (batch). */
  setBatch(updates = {}) {
    Object.entries(updates).forEach(([k, v]) => this.set(k, v));
  }

  // ── Subscribers locais ────────────────────────────────────────

  /** Registra callback chamado quando `key` mudar. Retorna unsubscribe. */
  subscribe(key, fn) {
    if (!this._subscribers[key]) this._subscribers[key] = [];
    this._subscribers[key].push(fn);
    return () => {
      this._subscribers[key] = this._subscribers[key].filter(f => f !== fn);
    };
  }

  // ── Persistência (noop — tudo vai para o Firebase via FirebaseService) ──

  persist(keys) {
    // Anteriormente usava localStorage. Agora é noop: dados persistem
    // exclusivamente no Firestore via FirebaseService.
  }

  hydrate(keys) {
    // Anteriormente lia do localStorage. Agora é noop: dados são carregados
    // do Firestore no evento auth:login (ver core/app.js).
  }

  // ── Undo / Redo ───────────────────────────────────────────────

  pushHistory(desc = '') {
    // Descarta redo "à frente"
    this._history = this._history.slice(0, this._histIdx + 1);
    this._history.push({ snap: this.snapshot(), desc, ts: Date.now() });
    if (this._history.length > this._maxHist) this._history.shift();
    this._histIdx = this._history.length - 1;
  }

  undo() {
    if (this._histIdx <= 0) return false;
    this._histIdx--;
    const { snap } = this._history[this._histIdx];
    this._state = this._deepClone(snap);
    EventBus.emit('state:undo', { idx: this._histIdx });
    return true;
  }

  redo() {
    if (this._histIdx >= this._history.length - 1) return false;
    this._histIdx++;
    const { snap } = this._history[this._histIdx];
    this._state = this._deepClone(snap);
    EventBus.emit('state:redo', { idx: this._histIdx });
    return true;
  }

  get canUndo() { return this._histIdx > 0; }
  get canRedo() { return this._histIdx < this._history.length - 1; }

  // ── Reset ─────────────────────────────────────────────────────

  reset(keepAuth = true) {
    const prev = this._deepClone(this._state);
    this._state = this._deepClone(INITIAL_STATE);
    if (keepAuth) {
      this._state.usuarioLogado   = prev.usuarioLogado;
      this._state.firebaseConectado = prev.firebaseConectado;
      this._state.firebaseProjectId = prev.firebaseProjectId;
      this._state.obrasLista      = prev.obrasLista;

    }
    EventBus.emit('state:reset', {});
  }

  // ── Helpers internos ─────────────────────────────────────────

  _deepClone(v) {
    if (v === null || v === undefined) return v;
    try {
      return JSON.parse(JSON.stringify(v));
    } catch (e) {
      // HIGH-04: returning the original `v` here would break immutability — any caller
      // that mutates the result would silently mutate live state.
      // structuredClone handles circular refs and most non-JSON-safe values.
      console.warn('[State] _deepClone JSON falhou — usando structuredClone:', e?.message);
      try {
        return structuredClone(v);
      } catch (e2) {
        // Last resort: log and return undefined rather than a live reference.
        console.error('[State] _deepClone structuredClone falhou — valor não clonável descartado:', e2?.message);
        return undefined;
      }
    }
  }
}

export const state = new StateManager();
export default state;

// ── Aliases de compatibilidade v12 ───────────────────────────────
// Somente leitura — FIX-E2.4: set() emite aviso em vez de mutar o state
// diretamente, prevenindo manipulação acidental via console do browser.
// Remover após migração completa dos módulos para state.get/set().

if (typeof window !== 'undefined') {
  // Helper: avisa e BLOQUEIA a mutação via alias global
  const _bloqueadoAlias = (alias, chave) => (v) => {
    console.warn(
      `[State v12] Alias window.${alias} é somente leitura.\n` +
      `Use state.set('${chave}', value) para alterar o estado.`
    );
    // NÃO executa a mutação — impede que console hacks corrompam o state
  };

  Object.defineProperties(window, {
    CFG: {
      get: () => state.get('cfg'),
      set: _bloqueadoAlias('CFG', 'cfg'),
      configurable: true,
    },
    BMS: {
      get: () => state.get('bms'),
      set: _bloqueadoAlias('BMS', 'bms'),
      configurable: true,
    },
    ITENS_CONTRATO: {
      get: () => state.get('itensContrato'),
      set: _bloqueadoAlias('ITENS_CONTRATO', 'itensContrato'),
      configurable: true,
    },
    OBRA_ATIVA_ID: {
      get: () => state.get('obraAtivaId'),
      set: _bloqueadoAlias('OBRA_ATIVA_ID', 'obraAtivaId'),
      configurable: true,
    },
    OBRAS_LISTA: {
      get: () => state.get('obrasLista'),
      set: _bloqueadoAlias('OBRAS_LISTA', 'obrasLista'),
      configurable: true,
    },
    STATUS_OBRA: {
      get: () => state.get('statusObra'),
      set: _bloqueadoAlias('STATUS_OBRA', 'statusObra'),
      configurable: true,
    },
    NOTIFICACOES: {
      get: () => state.get('notificacoes'),
      set: _bloqueadoAlias('NOTIFICACOES', 'notificacoes'),
      configurable: true,
    },
    DIARIO: {
      get: () => state.get('diario'),
      set: _bloqueadoAlias('DIARIO', 'diario'),
      configurable: true,
    },
    OCORRENCIAS: {
      get: () => state.get('ocorrencias'),
      set: _bloqueadoAlias('OCORRENCIAS', 'ocorrencias'),
      configurable: true,
    },
    ADITIVOS: {
      get: () => state.get('aditivos'),
      set: _bloqueadoAlias('ADITIVOS', 'aditivos'),
      configurable: true,
    },
    VERSOES_CONTRATUAIS: {
      get: () => state.get('versoesContratuais'),
      set: _bloqueadoAlias('VERSOES_CONTRATUAIS', 'versoesContratuais'),
      configurable: true,
    },
    OBRA_META: {
      get: () => state.get('obraMeta'),
      set: _bloqueadoAlias('OBRA_META', 'obraMeta'),
      configurable: true,
    },
    LOGO_BASE64: {
      get: () => state.get('logoBase64'),
      set: _bloqueadoAlias('LOGO_BASE64', 'logoBase64'),
      configurable: true,
    },
  });
}
