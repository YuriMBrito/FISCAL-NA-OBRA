/**
 * ╔══════════════════════════════════════════════════════════════════════╗
 * ║  FISCAL NA OBRA — core/module-lifecycle.js                         ║
 * ║  Mixin de lifecycle padronizado para módulos                        ║
 * ╠══════════════════════════════════════════════════════════════════════╣
 * ║  FASE 2 — Architecture Hardening                                    ║
 * ║                                                                      ║
 * ║  Adiciona a qualquer classe de módulo:                               ║
 * ║    - Registro automático de EventBus listeners com cleanup           ║
 * ║    - Performance tracking de onEnter/onLeave                        ║
 * ║    - destroy() automático que limpa tudo                            ║
 * ║    - Proteção contra chamadas duplicadas de init()                  ║
 * ║    - Safe DOM querying dentro do pageId do módulo                   ║
 * ║                                                                      ║
 * ║  USO (opt-in — não altera módulos existentes):                      ║
 * ║                                                                      ║
 * ║    import { withLifecycle } from '../../core/module-lifecycle.js';   ║
 * ║                                                                      ║
 * ║    class MeuModule {                                                 ║
 * ║      constructor() {                                                 ║
 * ║        withLifecycle(this, 'meu-modulo', 'meu-pageid');             ║
 * ║      }                                                              ║
 * ║    }                                                                ║
 * ║                                                                      ║
 * ║  Depois disso o módulo tem:                                          ║
 * ║    this.listen('evento', handler)    → auto-cleanup no destroy()    ║
 * ║    this.$('#id')                     → query dentro do pageId       ║
 * ║    this.$$('.cls')                   → queryAll dentro do pageId    ║
 * ║    this.destroy()                    → limpa tudo                    ║
 * ╚══════════════════════════════════════════════════════════════════════╝
 */

import EventBus from './EventBus.js';
import logger   from './logger.js';
import perf     from '../utils/perf-monitor.js';

/**
 * Aplica o mixin de lifecycle a uma instância de módulo.
 *
 * @param {Object} instance  — this do módulo (no constructor)
 * @param {string} moduleId  — id do módulo (ex: 'boletim-medicao')
 * @param {string} [pageId]  — id do div.pagina no HTML (ex: 'boletim')
 */
export function withLifecycle(instance, moduleId, pageId = null) {
  // ── Estado interno do mixin ─────────────────────────────────
  instance.__lc = {
    moduleId,
    pageId:       pageId || moduleId,
    initialized:  false,
    active:       false,
    subs:         [],       // unsubscribe functions do EventBus
    domCleanups:  [],       // cleanup functions de event listeners DOM
    timers:       [],       // setTimeout/setInterval IDs
  };

  // ── Guard contra init() duplicado ───────────────────────────
  const originalInit = instance.init;
  if (typeof originalInit === 'function') {
    instance.init = async function (...args) {
      if (instance.__lc.initialized) {
        logger.warn(moduleId, 'init() chamado mais de uma vez — ignorando.');
        return;
      }
      instance.__lc.initialized = true;
      perf.time(`${moduleId}:init`);
      try {
        return await originalInit.apply(this, args);
      } finally {
        perf.timeEnd(`${moduleId}:init`);
      }
    };
  }

  // ── Performance tracking em onEnter/onLeave ─────────────────
  const originalOnEnter = instance.onEnter;
  if (typeof originalOnEnter === 'function') {
    instance.onEnter = function (...args) {
      instance.__lc.active = true;
      perf.time(`${moduleId}:onEnter`);
      try {
        return originalOnEnter.apply(this, args);
      } finally {
        perf.timeEnd(`${moduleId}:onEnter`);
      }
    };
  }

  const originalOnLeave = instance.onLeave;
  if (typeof originalOnLeave === 'function') {
    instance.onLeave = function (...args) {
      instance.__lc.active = false;
      try {
        return originalOnLeave.apply(this, args);
      } catch (e) {
        logger.warn(moduleId, `onLeave erro: ${e.message}`);
      }
    };
  }

  // ── EventBus com auto-cleanup ───────────────────────────────

  /**
   * Registra listener no EventBus com cleanup automático.
   * Usa o moduleId como contexto para offByContext().
   */
  instance.listen = function (event, handler) {
    const unsub = EventBus.on(event, handler, moduleId);
    instance.__lc.subs.push(unsub);
    return unsub;
  };

  /** Registra listener que dispara apenas uma vez. */
  instance.listenOnce = function (event, handler) {
    const unsub = EventBus.once(event, handler, moduleId);
    instance.__lc.subs.push(unsub);
    return unsub;
  };

  // ── DOM scoped ao pageId do módulo ──────────────────────────

  /** querySelector dentro do container do módulo. */
  instance.$ = function (selector) {
    const page = document.getElementById(instance.__lc.pageId);
    if (!page) return null;
    if (selector.startsWith('#')) return document.getElementById(selector.slice(1));
    return page.querySelector(selector);
  };

  /** querySelectorAll dentro do container do módulo. */
  instance.$$ = function (selector) {
    const page = document.getElementById(instance.__lc.pageId);
    if (!page) return [];
    return [...page.querySelectorAll(selector)];
  };

  // ── Timer management ────────────────────────────────────────

  /** setTimeout que é automaticamente limpo no destroy(). */
  instance.safeTimeout = function (fn, ms) {
    const id = setTimeout(fn, ms);
    instance.__lc.timers.push({ type: 'timeout', id });
    return id;
  };

  /** setInterval que é automaticamente limpo no destroy(). */
  instance.safeInterval = function (fn, ms) {
    const id = setInterval(fn, ms);
    instance.__lc.timers.push({ type: 'interval', id });
    return id;
  };

  // ── Destroy padronizado ─────────────────────────────────────

  const originalDestroy = instance.destroy;
  instance.destroy = function () {
    const lc = instance.__lc;

    // 1. Chama destroy original do módulo (se existir)
    if (typeof originalDestroy === 'function') {
      try { originalDestroy.call(this); } catch (e) {
        logger.warn(moduleId, `destroy() original erro: ${e.message}`);
      }
    }

    // 2. Remove todos os EventBus listeners
    lc.subs.forEach(unsub => {
      try { unsub(); } catch {}
    });
    lc.subs = [];

    // 3. Remove listeners DOM registrados via addCleanup
    lc.domCleanups.forEach(cleanup => {
      try { cleanup(); } catch {}
    });
    lc.domCleanups = [];

    // 4. Limpa timers
    lc.timers.forEach(t => {
      if (t.type === 'timeout') clearTimeout(t.id);
      else clearInterval(t.id);
    });
    lc.timers = [];

    // 5. Remove listeners por contexto (safety net)
    try { EventBus.offByContext(moduleId); } catch {}

    // 6. Marca como não-inicializado para permitir re-init no reload
    lc.initialized = false;
    lc.active = false;

    logger.debug(moduleId, '🧹 Lifecycle cleanup completo.');
  };

  /**
   * Registra uma função de cleanup para ser chamada no destroy().
   * Útil para event listeners DOM manuais.
   *
   * @param {Function} cleanupFn
   */
  instance.addCleanup = function (cleanupFn) {
    if (typeof cleanupFn === 'function') {
      instance.__lc.domCleanups.push(cleanupFn);
    }
  };

  return instance;
}

export default withLifecycle;
