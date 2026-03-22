/**
 * ╔══════════════════════════════════════════════════════════════════════╗
 * ║  FISCAL NA OBRA — utils/perf-monitor.js                            ║
 * ║  Observabilidade: performance, render tracking, diagnóstico         ║
 * ╠══════════════════════════════════════════════════════════════════════╣
 * ║  FASE 6 — Observability                                             ║
 * ║                                                                      ║
 * ║  Módulos opt-in via perf.time() / perf.timeEnd() ou perf.track().  ║
 * ║  Nenhum módulo existente precisa ser alterado.                       ║
 * ║  Debug API: window._FO_perf() no console do navegador.             ║
 * ╚══════════════════════════════════════════════════════════════════════╝
 *
 * USO:
 *   import perf from '../utils/perf-monitor.js';
 *
 *   // Medir tempo de uma operação:
 *   perf.time('render:dashboard');
 *   render();
 *   perf.timeEnd('render:dashboard');  // Loga: "render:dashboard: 42ms"
 *
 *   // Decorator automático para funções async:
 *   const result = await perf.track('loadObra', () => loadObra(id));
 *
 *   // Contar operações:
 *   perf.count('firebase:read');
 *
 *   // Relatório completo:
 *   window._FO_perf();
 */

import logger from '../core/logger.js';

// ── Constantes ────────────────────────────────────────────────
const MAX_TIMINGS = 200;      // máximo de timings armazenados
const SLOW_MS     = 500;      // operações > 500ms são destacadas como slow
const WARN_MS     = 2000;     // operações > 2s geram warning no logger

// ── Estado interno ────────────────────────────────────────────
const _marks    = new Map();   // label → { start, meta }
const _timings  = [];          // [{ label, duration, ts, slow, meta }]
const _counters = {};          // label → count
const _bootTs   = Date.now();

// ═══════════════════════════════════════════════════════════════
// PerfMonitor API
// ═══════════════════════════════════════════════════════════════
export const perf = {

  // ── Timing manual ───────────────────────────────────────────

  /**
   * Inicia medição de tempo para um label.
   * @param {string} label — identificador (ex: 'render:dashboard')
   * @param {Object} [meta] — metadados opcionais
   */
  time(label, meta = null) {
    _marks.set(label, { start: performance.now(), meta });
  },

  /**
   * Finaliza medição e retorna duração em ms.
   * Se o label não existir, retorna -1.
   *
   * @param {string} label
   * @returns {number} — duração em ms (ou -1 se não iniciado)
   */
  timeEnd(label) {
    const mark = _marks.get(label);
    if (!mark) return -1;

    const duration = Math.round(performance.now() - mark.start);
    _marks.delete(label);

    const entry = {
      label,
      duration,
      ts:   Date.now(),
      slow: duration >= SLOW_MS,
      meta: mark.meta,
    };

    _timings.push(entry);
    if (_timings.length > MAX_TIMINGS) _timings.shift();

    // Log contextual baseado na duração
    if (duration >= WARN_MS) {
      logger.warn('Perf', `🐢 "${label}" levou ${duration}ms (lento)`, entry);
    } else if (duration >= SLOW_MS) {
      logger.info('Perf', `⏱ "${label}": ${duration}ms`, entry);
    }

    return duration;
  },

  // ── Decorator automático ────────────────────────────────────

  /**
   * Executa fn() medindo automaticamente o tempo.
   * Funciona com funções sync e async.
   *
   * @param {string}   label — identificador
   * @param {Function} fn    — função a executar
   * @param {Object}   [meta]
   * @returns {Promise<*>} — resultado de fn()
   */
  async track(label, fn, meta = null) {
    this.time(label, meta);
    try {
      const result = await fn();
      return result;
    } finally {
      this.timeEnd(label);
    }
  },

  /** Versão síncrona de track(). */
  trackSync(label, fn, meta = null) {
    this.time(label, meta);
    try {
      return fn();
    } finally {
      this.timeEnd(label);
    }
  },

  // ── Contadores ──────────────────────────────────────────────

  /**
   * Incrementa um contador nomeado.
   * Útil para: firebase:read, firebase:write, render:count, etc.
   */
  count(label) {
    _counters[label] = (_counters[label] || 0) + 1;
  },

  /** Retorna o valor atual de um contador. */
  getCount(label) {
    return _counters[label] || 0;
  },

  // ── Relatório ───────────────────────────────────────────────

  /**
   * Gera relatório completo de performance.
   * @returns {Object}
   */
  report() {
    const now = Date.now();
    const uptime = now - _bootTs;

    // Agrupa timings por label
    const byLabel = {};
    _timings.forEach(t => {
      if (!byLabel[t.label]) {
        byLabel[t.label] = { count: 0, totalMs: 0, maxMs: 0, minMs: Infinity, slowCount: 0 };
      }
      const g = byLabel[t.label];
      g.count++;
      g.totalMs += t.duration;
      g.maxMs = Math.max(g.maxMs, t.duration);
      g.minMs = Math.min(g.minMs, t.duration);
      if (t.slow) g.slowCount++;
    });

    // Calcula médias
    const stats = Object.entries(byLabel).map(([label, g]) => ({
      label,
      count:   g.count,
      avgMs:   Math.round(g.totalMs / g.count),
      maxMs:   g.maxMs,
      minMs:   g.minMs === Infinity ? 0 : g.minMs,
      slowPct: g.count > 0 ? Math.round((g.slowCount / g.count) * 100) : 0,
    })).sort((a, b) => b.avgMs - a.avgMs);

    // Métricas de memória (se disponível)
    let memory = null;
    if (performance.memory) {
      memory = {
        usedMB:  Math.round(performance.memory.usedJSHeapSize / 1048576),
        totalMB: Math.round(performance.memory.totalJSHeapSize / 1048576),
        limitMB: Math.round(performance.memory.jsHeapSizeLimit / 1048576),
      };
    }

    return {
      uptimeMs:      uptime,
      uptimeMin:     Math.round(uptime / 60000),
      totalTimings:  _timings.length,
      slowTimings:   _timings.filter(t => t.slow).length,
      counters:      { ..._counters },
      timingStats:   stats,
      recentSlow:    _timings.filter(t => t.slow).slice(-10),
      memory,
    };
  },

  // ── Reset ───────────────────────────────────────────────────

  reset() {
    _marks.clear();
    _timings.length = 0;
    Object.keys(_counters).forEach(k => delete _counters[k]);
  },

  // ── Acesso ao histórico bruto ───────────────────────────────

  getTimings(label = null, limit = 50) {
    const filtered = label
      ? _timings.filter(t => t.label === label)
      : _timings;
    return filtered.slice(-limit);
  },
};

// ── Expose debug API ──────────────────────────────────────────
if (typeof window !== 'undefined') {
  window._FO_perf = () => {
    const r = perf.report();
    console.group('%c⚡ Fiscal na Obra — Performance', 'color:#f59e0b;font-weight:bold;font-size:13px');

    if (r.memory) {
      console.log(`🧠 Memória: ${r.memory.usedMB}MB / ${r.memory.totalMB}MB (limit: ${r.memory.limitMB}MB)`);
    }
    console.log(`⏱ Uptime: ${r.uptimeMin} min | Timings: ${r.totalTimings} total, ${r.slowTimings} lentos`);

    if (r.timingStats.length > 0) {
      console.table(r.timingStats.slice(0, 20));
    }

    if (Object.keys(r.counters).length > 0) {
      console.log('📊 Contadores:', r.counters);
    }

    if (r.recentSlow.length > 0) {
      console.warn('🐢 Últimas operações lentas:', r.recentSlow);
    }

    console.groupEnd();
    return r;
  };
}

export default perf;
