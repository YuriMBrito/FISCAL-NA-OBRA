/**
 * ╔══════════════════════════════════════════════════════════════════════╗
 * ║  FISCAL NA OBRA v15.1 — core/error-boundary.js                       ║
 * ║  Error Boundary por módulo: isola, registra e exibe fallback       ║
 * ╚══════════════════════════════════════════════════════════════════════╝
 *
 * Cada módulo recebe sua própria instância de ErrorBoundary.
 * Toda execução passa por boundary.run(fn) — se quebrar, apenas ESSE
 * módulo é afetado. Os demais continuam funcionando normalmente.
 *
 * Uso:
 *   const boundary = createBoundary('boletim-medicao', 'boletim');
 *
 *   // Execução protegida
 *   await boundary.run(() => module.init());
 *   await boundary.run(() => module.onEnter(), { label: 'onEnter' });
 *
 *   // Verificação de estado
 *   if (boundary.isHealthy()) { ... }
 *   boundary.status  // 'healthy' | 'degraded' | 'failed'
 */

import logger   from './logger.js';
import EventBus from './EventBus.js';
import FallbackUI from './fallback-ui.js';
import { safeExecute, safeExecuteSync, TimeoutError } from './safe-execute.js';

// ── Status ────────────────────────────────────────────────────────────────
export const BOUNDARY_STATUS = Object.freeze({
  HEALTHY:  'healthy',   // nenhum erro
  DEGRADED: 'degraded',  // erros não-fatais (< threshold)
  FAILED:   'failed',    // desativado após muitos erros
});

// ── ErrorBoundary ─────────────────────────────────────────────────────────
export class ErrorBoundary {
  /**
   * @param {string} moduleId  — identificador do módulo (ex: 'boletim-medicao')
   * @param {string} pageId    — id do <div class="pagina"> correspondente
   * @param {object} opts
   * @param {number} opts.errorThreshold — erros antes de marcar FAILED (padrão: 5)
   * @param {number} opts.timeout        — ms para timeout de cada run() (padrão: 10 000)
   * @param {number} opts.resetWindow    — ms para zerar contador de erros (padrão: 60 000)
   */
  constructor(moduleId, pageId, opts = {}) {
    this.moduleId       = moduleId;
    this.pageId         = pageId;
    this.status         = BOUNDARY_STATUS.HEALTHY;

    this._errorThreshold = opts.errorThreshold ?? 5;
    this._timeout        = opts.timeout        ?? 10_000;
    this._resetWindow    = opts.resetWindow    ?? 60_000;

    this._errors         = [];     // { ts, message, label }
    this._runCount       = 0;
    this._lastActivity   = Date.now();
  }

  // ── run ─────────────────────────────────────────────────────────────────
  /**
   * Executa fn dentro do boundary.
   * Erros são capturados, logados e contabilizados.
   * Retorna { ok, value, error }.
   */
  async run(fn, opts = {}) {
    if (this.status === BOUNDARY_STATUS.FAILED) {
      logger.warn(this.moduleId, `⛔ run() bloqueado — boundary em FAILED.`);
      return { ok: false, value: undefined, error: new Error('Boundary FAILED') };
    }

    this._runCount++;
    this._lastActivity = Date.now();
    const label = opts.label || `run#${this._runCount}`;

    const result = await safeExecute(fn, {
      source:  this.moduleId,
      timeout: opts.timeout ?? this._timeout,
      label,
      silent:  opts.silent ?? false,
      onError: (err) => this._recordError(err, label),
    });

    if (!result.ok) {
      this._escalateIfNeeded();
    }

    return result;
  }

  /** Versão síncrona de run(). */
  runSync(fn, opts = {}) {
    if (this.status === BOUNDARY_STATUS.FAILED) {
      logger.warn(this.moduleId, `⛔ runSync() bloqueado — boundary em FAILED.`);
      return { ok: false, value: undefined, error: new Error('Boundary FAILED') };
    }

    const label = opts.label || `runSync#${++this._runCount}`;
    const result = safeExecuteSync(fn, {
      source: this.moduleId,
      silent: opts.silent ?? false,
    });

    if (!result.ok) {
      this._recordError(result.error, label);
      this._escalateIfNeeded();
    }

    return result;
  }

  // ── Estado ────────────────────────────────────────────────────────────────
  isHealthy()  { return this.status === BOUNDARY_STATUS.HEALTHY;  }
  isDegraded() { return this.status === BOUNDARY_STATUS.DEGRADED; }
  isFailed()   { return this.status === BOUNDARY_STATUS.FAILED;   }

  /** Reseta o boundary manualmente (chamado após reload bem-sucedido). */
  reset() {
    this._errors = [];
    this.status  = BOUNDARY_STATUS.HEALTHY;
    logger.info(this.moduleId, `🔄 ErrorBoundary resetado.`);
    FallbackUI.clear(this.pageId);
    EventBus.emit('boundary:reset', { moduleId: this.moduleId });
  }

  /** Snapshot do estado atual. */
  snapshot() {
    return {
      moduleId:     this.moduleId,
      pageId:       this.pageId,
      status:       this.status,
      errorCount:   this._errors.length,
      runCount:     this._runCount,
      lastActivity: this._lastActivity,
      recentErrors: this._errors.slice(-3).map(e => ({
        ts:      e.ts,
        label:   e.label,
        message: e.message,
      })),
    };
  }

  // ── Internos ──────────────────────────────────────────────────────────────
  _recordError(err, label) {
    const now = Date.now();

    // Remove erros fora da janela de reset
    this._errors = this._errors.filter(e => now - e.ts < this._resetWindow);

    this._errors.push({
      ts:      now,
      label,
      message: err?.message || String(err),
      name:    err?.name,
      timeout: err instanceof TimeoutError,
    });

    // Atualiza status
    const count = this._errors.length;
    if (count >= this._errorThreshold) {
      // já será tratado em _escalateIfNeeded
    } else if (count >= Math.floor(this._errorThreshold / 2)) {
      this.status = BOUNDARY_STATUS.DEGRADED;
      EventBus.emit('boundary:degraded', { moduleId: this.moduleId, errorCount: count });
    }
  }

  _escalateIfNeeded() {
    const count = this._errors.length;
    if (count < this._errorThreshold) return;

    // THRESHOLD atingido → FAILED
    this.status = BOUNDARY_STATUS.FAILED;

    const lastErr = this._errors[this._errors.length - 1];
    logger.error(
      this.moduleId,
      `🚫 Boundary FAILED após ${count} erros — módulo desativado.`,
      { errors: this._errors.slice(-3) }
    );

    // Mostra fallback visual
    FallbackUI.show(this.pageId, this.moduleId, new Error(lastErr?.message), false);

    // Emite evento para o ModuleMonitor
    EventBus.emit('module:failed', {
      moduleId: this.moduleId,
      phase:    'boundary-threshold',
      error:    lastErr?.message,
    });
  }
}

// ── Factory ───────────────────────────────────────────────────────────────
/**
 * Cria e registra um ErrorBoundary para um módulo.
 * @returns {ErrorBoundary}
 */
export function createBoundary(moduleId, pageId, opts = {}) {
  const boundary = new ErrorBoundary(moduleId, pageId, opts);
  _registry.set(moduleId, boundary);
  return boundary;
}

/** Retorna o boundary registrado para um módulo. */
export function getBoundary(moduleId) {
  return _registry.get(moduleId) || null;
}

/** Retorna snapshot de todos os boundaries registrados. */
export function getAllBoundarySnapshots() {
  const out = {};
  _registry.forEach((b, id) => { out[id] = b.snapshot(); });
  return out;
}

// ── Registro global de boundaries ─────────────────────────────────────────
const _registry = new Map();

// Expõe para debug
if (typeof window !== 'undefined') {
  window._FO_boundaries = () => {
    const snaps = getAllBoundarySnapshots();
    console.group('%c🛡️ Error Boundaries', 'color:#7c3aed;font-weight:bold');
    console.table(Object.values(snaps).map(s => ({
      módulo:   s.moduleId,
      status:   s.status,
      erros:    s.errorCount,
      runs:     s.runCount,
    })));
    console.groupEnd();
    return snaps;
  };
}
