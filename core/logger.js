/**
 * ╔══════════════════════════════════════════════════════════════════════╗
 * ║  FISCAL NA OBRA v15.1 — core/logger.js                               ║
 * ║  Sistema de logs estruturado com níveis, persistência e EventBus   ║
 * ╚══════════════════════════════════════════════════════════════════════╝
 *
 * Níveis (em ordem crescente de severidade):
 *   DEBUG    — rastreamento de fluxo (desabilitado em produção)
 *   INFO     — eventos normais do sistema
 *   WARN     — situações inesperadas mas recuperáveis
 *   ERROR    — falhas que afetam funcionalidade
 *   CRITICAL — falhas que comprometem integridade do sistema
 */

// ── Constantes ────────────────────────────────────────────────────────────
const LEVELS = Object.freeze({
  DEBUG:    0,
  INFO:     1,
  WARN:     2,
  ERROR:    3,
  CRITICAL: 4,
});

const LEVEL_LABELS = Object.freeze({
  0: 'DEBUG',
  1: 'INFO',
  2: 'WARN',
  3: 'ERROR',
  4: 'CRITICAL',
});

const LEVEL_COLORS = Object.freeze({
  0: '#6b7280',   // cinza
  1: '#2563eb',   // azul
  2: '#d97706',   // âmbar
  3: '#dc2626',   // vermelho
  4: '#7c3aed',   // roxo
});

const LEVEL_EMOJI = Object.freeze({
  0: '🔍',
  1: 'ℹ️',
  2: '⚠️',
  3: '❌',
  4: '💀',
});

const MAX_ENTRIES_MEMORY  = 500;
const MAX_ENTRIES_STORAGE = 200;
const STORAGE_KEY         = 'fo_logs_v1';
const DEFAULT_MIN_LEVEL   = LEVELS.INFO;

// ── Logger ─────────────────────────────────────────────────────────────────
class Logger {
  constructor() {
    this._entries    = [];           // buffer em memória
    this._minLevel   = DEFAULT_MIN_LEVEL;
    this._listeners  = [];           // callbacks externos
    this._sessionId  = this._genId();
    this._startTs    = Date.now();
    this._paused     = false;
    this._eventBus   = null;         // injetado após boot para evitar dep. circular
  }

  // ── Configuração ────────────────────────────────────────────────────────

  /** Define nível mínimo de log. Strings ou números são aceitos. */
  setLevel(level) {
    const n = typeof level === 'string' ? (LEVELS[level.toUpperCase()] ?? LEVELS.INFO) : level;
    this._minLevel = n;
  }

  /** Injeta EventBus depois do boot (evita dependência circular). */
  setEventBus(bus) {
    this._eventBus = bus;
  }

  // ── API pública ─────────────────────────────────────────────────────────

  debug(source, message, data)    { this._log(LEVELS.DEBUG,    source, message, data); }
  info(source, message, data)     { this._log(LEVELS.INFO,     source, message, data); }
  warn(source, message, data)     { this._log(LEVELS.WARN,     source, message, data); }
  error(source, message, data)    { this._log(LEVELS.ERROR,    source, message, data); }
  critical(source, message, data) { this._log(LEVELS.CRITICAL, source, message, data); }

  /** Atalho: loga e retorna falso — útil em catch. */
  logError(source, err, context = {}) {
    this.error(source, err?.message || String(err), {
      stack:   err?.stack,
      name:    err?.name,
      ...context,
    });
    return false;
  }

  // ── Leitura ──────────────────────────────────────────────────────────────

  /** Retorna cópias dos logs filtrados. */
  getEntries({ level = 0, source = null, limit = 100, since = 0 } = {}) {
    const minTs   = since || 0;
    const minLvl  = typeof level === 'string' ? (LEVELS[level.toUpperCase()] ?? 0) : level;
    return this._entries
      .filter(e => e.level >= minLvl &&
                   e.ts    >= minTs  &&
                   (!source || e.source === source))
      .slice(-limit)
      .map(e => ({ ...e }));         // cópia rasa — protege buffer interno
  }

  /** Retorna últimas N entradas (atalho). */
  tail(n = 50) {
    return this._entries.slice(-n).map(e => ({ ...e }));
  }

  /** Resumo estatístico. */
  stats() {
    const counts = { DEBUG: 0, INFO: 0, WARN: 0, ERROR: 0, CRITICAL: 0 };
    const sources = {};
    this._entries.forEach(e => {
      const lbl = LEVEL_LABELS[e.level] || 'INFO';
      counts[lbl]++;
      sources[e.source] = (sources[e.source] || 0) + 1;
    });
    return {
      total: this._entries.length,
      counts,
      sources,
      sessionId:   this._sessionId,
      uptimeMs:    Date.now() - this._startTs,
    };
  }

  // ── Persistência ────────────────────────────────────────────────────────

  persist() {
    // noop — logs ficam apenas em memória (não persistem entre sessões)
  }

  loadPersisted() {
    return [];
  }

  clearPersisted() {
    // noop
  }

  /** Exporta logs como texto plain-text para download/cópia. */
  exportText(level = LEVELS.DEBUG) {
    return this._entries
      .filter(e => e.level >= level)
      .map(e => `[${e.time}] [${LEVEL_LABELS[e.level]?.padEnd(8)}] [${e.source}] ${e.message}` +
                 (e.data ? `\n  ${JSON.stringify(e.data)}` : ''))
      .join('\n');
  }

  // ── Listeners ────────────────────────────────────────────────────────────

  /** Registra callback chamado em cada entrada de log. Retorna unsub. */
  onLog(fn) {
    this._listeners.push(fn);
    return () => {
      this._listeners = this._listeners.filter(f => f !== fn);
    };
  }

  // ── Internos ─────────────────────────────────────────────────────────────

  _log(level, source, message, data) {
    if (this._paused || level < this._minLevel) return;

    const ts    = Date.now();
    const time  = new Date(ts).toLocaleTimeString('pt-BR', { hour12: false, fractionalSecondDigits: 3 });
    const entry = {
      id:      this._genId(),
      ts,
      time,
      level,
      source:  source  || 'app',
      message: String(message || ''),
      data:    data !== undefined ? data : null,
      session: this._sessionId,
    };

    // Buffer em memória
    this._entries.push(entry);
    if (this._entries.length > MAX_ENTRIES_MEMORY) {
      this._entries.shift();
    }

    // Console nativo
    this._toConsole(entry);

    // Notifica listeners
    this._listeners.forEach(fn => {
      try { fn({ ...entry }); } catch {}
    });

    // EventBus (apenas WARN+)
    if (this._eventBus && level >= LEVELS.WARN) {
      try {
        this._eventBus.emitAsync('logger:entry', { ...entry });
      } catch {}
    }

    // Persiste automaticamente entradas CRITICAL
    if (level >= LEVELS.CRITICAL) {
      this.persist();
    }
  }

  _toConsole(entry) {
    const prefix  = `%c[${entry.time}] [${LEVEL_LABELS[entry.level]}] [${entry.source}]`;
    const style   = `color:${LEVEL_COLORS[entry.level]};font-weight:${entry.level >= LEVELS.ERROR ? 700 : 400}`;
    const msg     = entry.message;
    const data    = entry.data;

    if (entry.level >= LEVELS.CRITICAL) {
      console.error(prefix, style, msg, data ?? '');
    } else if (entry.level === LEVELS.ERROR) {
      console.error(prefix, style, msg, data ?? '');
    } else if (entry.level === LEVELS.WARN) {
      console.warn(prefix,  style, msg, data ?? '');
    } else {
      console.log(prefix,   style, msg, data ?? '');
    }
  }

  _genId() {
    return Math.random().toString(36).slice(2, 10);
  }
}

// ── Singleton exportado ───────────────────────────────────────────────────
export const logger = new Logger();
export default logger;

// ── Alias global para acesso rápido em debug ─────────────────────────────
if (typeof window !== 'undefined') {
  window._logger = logger;

  // Atalhos:  _log.info('modulo', 'mensagem')
  window._log = {
    debug:    (...a) => logger.debug(...a),
    info:     (...a) => logger.info(...a),
    warn:     (...a) => logger.warn(...a),
    error:    (...a) => logger.error(...a),
    critical: (...a) => logger.critical(...a),
    tail:     (n)   => logger.tail(n),
    stats:    ()    => logger.stats(),
    export:   ()    => logger.exportText(),
  };
}
