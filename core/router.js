/**
 * ╔══════════════════════════════════════════════════════════════════════╗
 * ║  FISCAL NA OBRA v15.1 — core/router.js (v2)                          ║
 * ║  Roteador com onEnter/onLeave protegidos por ErrorBoundary          ║
 * ╚══════════════════════════════════════════════════════════════════════╝
 */

import EventBus   from './EventBus.js';
import state      from './state.js';
import logger     from './logger.js';
import { getBoundary } from './error-boundary.js';
import { safeExecuteSync } from './safe-execute.js';

class Router {
  constructor() {
    this._routes  = new Map();
    this._current = null;
    this._history = [];
  }

  /**
   * Registra uma rota.
   * config: { label, icon, navGroup, navOrder, hidden, onEnter, onLeave }
   */
  register(pageId, config = {}) {
    this._routes.set(pageId, { pageId, ...config });
  }

  /**
   * Navega para uma página.
   * opts: { noHash, force, data }
   */
  navigate(pageId, opts = {}) {
    // Guard: prevent empty/null pageId
    if (!pageId || typeof pageId !== 'string') {
      logger.warn('Router', `navigate() chamado com pageId inválido: "${pageId}"`);
      return false;
    }

    const route = this._routes.get(pageId);
    if (!route && !document.getElementById(pageId)) {
      logger.warn('Router', `Página "${pageId}" não encontrada — ignorando.`);
      return false;
    }

    // Guard: skip navigation to current page unless forced
    const previous = this._current;
    if (previous === pageId && !opts.force) {
      // Still call onEnter for re-render if data changed
      if (typeof route?.onEnter === 'function') {
        safeExecuteSync(() => route.onEnter(opts.data), {
          source: `router:onEnter:${pageId}`,
          silent: true,
        });
      }
      return true;
    }

    // ── onLeave da página anterior ─────────────────────────────────────
    if (previous && previous !== pageId) {
      const prevRoute = this._routes.get(previous);
      if (typeof prevRoute?.onLeave === 'function') {
        safeExecuteSync(() => prevRoute.onLeave(), { source: `router:onLeave:${previous}`, silent: true });
      }
      const prevPage = document.getElementById(previous);
      prevPage?.classList.remove('ativa');
    }

    // ── Ativa nova página ──────────────────────────────────────────────
    document.querySelectorAll('.pagina').forEach(p => p.classList.remove('ativa'));
    const page = document.getElementById(pageId);
    if (page) page.classList.add('ativa');

    this._current = pageId;
    this._history.push(pageId);
    if (this._history.length > 50) this._history.shift();

    state.set('paginaAtiva', pageId);

    // ── Hash URL ───────────────────────────────────────────────────────
    if (!opts.noHash) {
      window.history.replaceState(null, '', `#${pageId}`);
    }

    // ── Sidebar: marca item ativo ─────────────────────────────────────
    document.querySelectorAll('[data-nav-page]').forEach(el => {
      el.classList.toggle('ativo', el.dataset.navPage === pageId);
    });

    // ── onEnter: via boundary se disponível, senão direto ─────────────
    const boundary = getBoundary(pageId) || getBoundary(this._moduleIdFromPage(pageId));

    if (boundary && !boundary.isFailed()) {
      boundary.run(
        () => { route?.onEnter?.(opts.data); },
        { label: `onEnter:${pageId}`, timeout: 8000 }
      );
    } else if (boundary?.isFailed()) {
      // Boundary em estado FAILED → não chama onEnter
      logger.warn('Router', `⛔ onEnter de "${pageId}" bloqueado — boundary FAILED.`);
    } else if (typeof route?.onEnter === 'function') {
      safeExecuteSync(() => route.onEnter(opts.data), {
        source: `router:onEnter:${pageId}`,
        silent: false,
      });
    }

    EventBus.emit('router:navigated', { pageId, previous, data: opts.data });
    logger.debug('Router', `→ ${pageId}${previous ? ` (de ${previous})` : ''}`);
    return true;
  }

  back() {
    if (this._history.length < 2) return;
    this._history.pop();
    const prev = this._history[this._history.length - 1];
    this.navigate(prev, { noHash: false });
  }

  initFromHash() {
    const hash = window.location.hash?.replace('#', '').trim();
    if (hash && document.getElementById(hash)) {
      this.navigate(hash, { noHash: true });
      return true;
    }
    return false;
  }

  getRoutes()  { return [...this._routes.values()]; }
  get current(){ return this._current; }

  /** Converte pageId → moduleId para lookup do boundary */
  _moduleIdFromPage(pageId) {
    const map = {
      boletim:  'boletim-medicao',
      memoria:  'memoria-calculo',
    };
    return map[pageId] || pageId;
  }
}

export const router = new Router();
export default router;

// Backward compat
if (typeof window !== 'undefined') {
  window.verPagina = (pageId) => router.navigate(pageId);
}
