/**
 * ╔══════════════════════════════════════════════════════════════════════╗
 * ║  FISCAL NA OBRA v15.1 — core/module-monitor.js                       ║
 * ║  Monitor de saúde dos módulos: detecção, reinício e circuit breaker ║
 * ╚══════════════════════════════════════════════════════════════════════╝
 *
 * Responsabilidades:
 *  1. Ouvir eventos de falha dos módulos (module:failed)
 *  2. Decidir se um módulo pode ser reiniciado (circuit breaker)
 *  3. Executar a lógica de reinício com backoff exponencial
 *  4. Publicar relatórios de saúde periódicos
 *  5. Expor API de diagnóstico (window._FO_health)
 */

import logger       from './logger.js';
import EventBus     from './EventBus.js';
import moduleLoader, { MODULE_STATUS } from './module-loader.js';
import router       from './router.js';
import FallbackUI   from './fallback-ui.js';

// ── Configurações do Circuit Breaker ────────────────────────────────────
const CB_CONFIG = Object.freeze({
  MAX_FAILURES:      3,      // falhas antes de abrir o circuito
  RESET_WINDOW_MS:   60_000, // janela de contagem de falhas (1 min)
  HALF_OPEN_DELAY:   5_000,  // aguarda antes de tentar half-open (5 s)
  RESTART_BACKOFF:   [1000, 3000, 8000, 15_000], // delays por tentativa
  HEALTH_INTERVAL:   30_000, // intervalo de relatório de saúde (30 s)
  STUCK_THRESHOLD:   15_000, // módulo preso > 15 s → considera falha
});

// ── Estados do Circuit Breaker ───────────────────────────────────────────
const CB_STATE = Object.freeze({
  CLOSED:    'closed',     // funcionando normalmente
  OPEN:      'open',       // bloqueado após muitas falhas
  HALF_OPEN: 'half_open',  // testando se pode ser fechado
});

// ── CircuitBreaker por módulo ─────────────────────────────────────────────
class CircuitBreaker {
  constructor(moduleId) {
    this.moduleId    = moduleId;
    this.state       = CB_STATE.CLOSED;
    this.failures    = [];       // timestamps de falhas
    this.attempts    = 0;        // tentativas de restart
    this.lastFailure = null;
    this.openedAt    = null;
  }

  /** Registra uma falha. Retorna true se o circuito deve ser aberto. */
  recordFailure() {
    const now = Date.now();
    this.lastFailure = now;

    // Remove falhas fora da janela de contagem
    this.failures = this.failures.filter(ts => now - ts < CB_CONFIG.RESET_WINDOW_MS);
    this.failures.push(now);

    if (this.failures.length >= CB_CONFIG.MAX_FAILURES) {
      this._open();
      return true;
    }
    return false;
  }

  /** Registra sucesso — fecha o circuito. */
  recordSuccess() {
    this.state    = CB_STATE.CLOSED;
    this.failures = [];
    this.attempts = 0;
    this.openedAt = null;
  }

  /** Verifica se permite tentativa de restart. */
  allowsRestart() {
    if (this.state === CB_STATE.CLOSED) return true;
    if (this.state === CB_STATE.OPEN) {
      const elapsed = Date.now() - (this.openedAt || 0);
      if (elapsed >= CB_CONFIG.HALF_OPEN_DELAY) {
        this.state = CB_STATE.HALF_OPEN;
        return true;
      }
      return false;
    }
    return this.state === CB_STATE.HALF_OPEN;
  }

  /** Delay para a próxima tentativa (backoff exponencial). */
  nextDelay() {
    const idx = Math.min(this.attempts, CB_CONFIG.RESTART_BACKOFF.length - 1);
    return CB_CONFIG.RESTART_BACKOFF[idx];
  }

  _open() {
    this.state    = CB_STATE.OPEN;
    this.openedAt = Date.now();
    logger.warn('CircuitBreaker', `⚡ Circuito ABERTO para "${this.moduleId}" (${this.failures.length} falhas em ${CB_CONFIG.RESET_WINDOW_MS / 1000}s)`);
  }

  toJSON() {
    return {
      moduleId:    this.moduleId,
      state:       this.state,
      failures:    this.failures.length,
      attempts:    this.attempts,
      lastFailure: this.lastFailure,
      openedAt:    this.openedAt,
    };
  }
}

// ── ModuleMonitor ─────────────────────────────────────────────────────────
class ModuleMonitorClass {
  constructor() {
    this._breakers         = new Map();   // moduleId → CircuitBreaker
    this._restartTimers    = new Map();   // moduleId → timeoutId
    this._stuckTimers      = new Map();   // moduleId → timeoutId
    this._healthTimer      = null;
    this._subs             = [];
    this._healthLog        = [];          // histórico de relatórios
    this._panelEl          = null;
  }

  // ── Inicialização ────────────────────────────────────────────────────────

  init() {
    this._subscribeToEvents();
    this._startHealthTimer();
    this._exposeDebugAPI();
    logger.info('ModuleMonitor', '🏥 Monitor de módulos iniciado.');
  }

  // ── Circuit Breaker ───────────────────────────────────────────────────────

  getBreaker(moduleId) {
    if (!this._breakers.has(moduleId)) {
      this._breakers.set(moduleId, new CircuitBreaker(moduleId));
    }
    return this._breakers.get(moduleId);
  }

  // ── Detecção de falha → reinício ─────────────────────────────────────────

  _handleModuleFailed({ moduleId, phase, error }) {
    const breaker = this.getBreaker(moduleId);
    const opened  = breaker.recordFailure();
    const entry   = moduleLoader._modules.get(moduleId);

    logger.warn('ModuleMonitor',
      `🔍 Falha detectada em "${moduleId}" (fase: ${phase}) — CB: ${breaker.state}`,
      { failures: breaker.failures.length, opened }
    );

    if (opened) {
      // Circuito aberto — desativa o módulo
      logger.error('ModuleMonitor',
        `🚫 Módulo "${moduleId}" desativado após ${CB_CONFIG.MAX_FAILURES} falhas.`
      );
      moduleLoader.disable(moduleId);
      EventBus.emit('module:circuit-open', { moduleId });
      return;
    }

    // Agenda reinício se o módulo é restartable
    if (entry?.canRestart() && !this._restartTimers.has(moduleId)) {
      this._scheduleRestart(moduleId, breaker);
    }
  }

  _scheduleRestart(moduleId, breaker) {
    const delay = breaker.nextDelay();
    breaker.attempts++;

    logger.info('ModuleMonitor',
      `⏳ Módulo "${moduleId}" será reiniciado em ${delay / 1000}s (tentativa ${breaker.attempts})...`
    );

    EventBus.emit('module:restart-scheduled', { moduleId, delayMs: delay, attempt: breaker.attempts });

    const timer = setTimeout(async () => {
      this._restartTimers.delete(moduleId);

      if (!breaker.allowsRestart()) {
        logger.warn('ModuleMonitor', `⛔ Circuito ainda aberto para "${moduleId}" — restart cancelado.`);
        return;
      }

      logger.info('ModuleMonitor', `🔄 Reiniciando módulo "${moduleId}"...`);
      EventBus.emit('module:restarting', { moduleId, attempt: breaker.attempts });

      // Limpa o fallback antes de tentar
      const entry = moduleLoader._modules.get(moduleId);
      if (entry) FallbackUI.clear(entry.config?.pageId);

      const inst = await moduleLoader.reload(moduleId);

      if (inst) {
        breaker.recordSuccess();
        logger.info('ModuleMonitor', `✅ Módulo "${moduleId}" reiniciado com sucesso.`);
        EventBus.emit('module:restarted', { moduleId });

        // onEnter é chamado automaticamente pelo moduleLoader.load()
        // via router.register() — não precisa chamar aqui novamente.
      } else {
        // Reload falhou — o module:failed já foi emitido pelo moduleLoader.
        // O guard !this._restartTimers.has(moduleId) evita agendamento duplo.
        logger.error('ModuleMonitor', `❌ Reinício de "${moduleId}" falhou (tentativa ${breaker.attempts}).`);
      }
    }, delay);

    this._restartTimers.set(moduleId, timer);
  }

  // ── Detecção de módulos presos ────────────────────────────────────────────

  startStuckTimer(moduleId) {
    this.clearStuckTimer(moduleId);
    const timer = setTimeout(() => {
      const status = moduleLoader.getStatus(moduleId);
      if (status === MODULE_STATUS.LOADING || status === MODULE_STATUS.INITIALIZING) {
        logger.error('ModuleMonitor',
          `⏱️ Módulo "${moduleId}" preso em "${status}" há ${CB_CONFIG.STUCK_THRESHOLD / 1000}s — forçando falha.`
        );
        EventBus.emit('module:failed', {
          moduleId,
          phase: 'stuck',
          error: `Timeout: módulo preso em "${status}"`,
        });
      }
    }, CB_CONFIG.STUCK_THRESHOLD);

    this._stuckTimers.set(moduleId, timer);
  }

  clearStuckTimer(moduleId) {
    const t = this._stuckTimers.get(moduleId);
    if (t) { clearTimeout(t); this._stuckTimers.delete(moduleId); }
  }

  // ── Relatório de saúde ────────────────────────────────────────────────────

  _startHealthTimer() {
    this._healthTimer = setInterval(() => this._reportHealth(), CB_CONFIG.HEALTH_INTERVAL);
  }

  _reportHealth() {
    const all         = moduleLoader.getAllStatuses();
    const active      = Object.values(all).filter(m => m.status === MODULE_STATUS.ACTIVE).length;
    const failed      = Object.values(all).filter(m => m.status === MODULE_STATUS.FAILED).length;
    const disabled_   = Object.values(all).filter(m => m.status === MODULE_STATUS.DISABLED).length;
    const total       = Object.keys(all).length;

    const report = {
      ts:       Date.now(),
      total,
      active,
      failed,
      disabled: disabled_,
      breakers: [...this._breakers.values()].map(b => b.toJSON()),
    };

    this._healthLog.push(report);
    if (this._healthLog.length > 20) this._healthLog.shift();

    if (failed > 0 || disabled_ > 0) {
      logger.warn('ModuleMonitor',
        `🏥 Saúde: ${active}/${total} ativos, ${failed} com falha, ${disabled_} desativados`,
        { failed: Object.values(all).filter(m => m.status === MODULE_STATUS.FAILED).map(m => m.id) }
      );
    } else {
      logger.debug('ModuleMonitor',
        `🏥 Saúde: todos os ${active} módulos OK.`
      );
    }

    EventBus.emitAsync('monitor:health-report', report);
    this._updateHealthPanel(report);
  }

  getHealthReport() {
    return this._healthLog[this._healthLog.length - 1] || null;
  }

  // ── Painel de saúde na UI ─────────────────────────────────────────────────

  _updateHealthPanel(report) {
    const el = document.getElementById('fo-health-indicator');
    if (!el) return;

    const { active, total, failed, disabled } = report;
    const ok  = failed === 0 && disabled === 0;

    el.innerHTML = `
      <span style="width:8px;height:8px;border-radius:50%;background:${ok ? '#22c55e' : failed > 0 ? '#dc2626' : '#d97706'};display:inline-block;flex-shrink:0"></span>
      <span style="font-size:10px;color:${ok ? '#22c55e' : '#d97706'}">${active}/${total}</span>
    `;
    el.title = ok
      ? `${active} módulos ativos`
      : `${active} ativos · ${failed} com falha · ${disabled} desativados`;
  }

  // ── Subscriptions ─────────────────────────────────────────────────────────

  _subscribeToEvents() {
    this._subs.push(
      EventBus.on('module:failed', (data) => {
        try { this._handleModuleFailed(data); }
        catch (e) { logger.error('ModuleMonitor', 'Erro ao tratar module:failed:', e.message); }
      }, 'monitor'),

      EventBus.on('module:loading', ({ moduleId }) => {
        this.startStuckTimer(moduleId);
      }, 'monitor'),

      EventBus.on('module:loaded', ({ moduleId }) => {
        this.clearStuckTimer(moduleId);
      }, 'monitor'),

      EventBus.on('module:restarting', ({ moduleId }) => {
        this.clearStuckTimer(moduleId);
      }, 'monitor')
    );
  }

  // ── API de debug pública ──────────────────────────────────────────────────

  _exposeDebugAPI() {
    window._FO_health = () => {
      const statuses = moduleLoader.getAllStatuses();
      const report   = this.getHealthReport();
      console.group('%c🏥 Fiscal na Obra — Saúde dos Módulos', 'color:#2563eb;font-weight:bold;font-size:13px');
      console.table(statuses);
      console.log('Circuit Breakers:', [...this._breakers.values()].map(b => b.toJSON()));
      console.log('Último relatório:', report);
      console.groupEnd();
      return statuses;
    };

    window._FO_reloadModule = async (moduleId) => {
      logger.info('ModuleMonitor', `👆 Reload manual de "${moduleId}" solicitado pelo usuário.`);
      const entry = moduleLoader._modules.get(moduleId);
      if (entry) FallbackUI.clear(entry.config?.pageId);
      // Reseta o circuit breaker para permitir o reload manual
      const breaker = this.getBreaker(moduleId);
      breaker.recordSuccess();
      const inst = await moduleLoader.reload(moduleId);
      if (inst) {
        // onEnter é chamado automaticamente pelo moduleLoader.load() via router.register()
        logger.info('ModuleMonitor', `✅ Reload manual de "${moduleId}" bem-sucedido.`);
      }
      return inst;
    };

    window._FO_reportModule = (moduleId) => {
      const entries = logger.getEntries({ source: moduleId, limit: 30 });
      console.group(`%c📋 Logs do módulo "${moduleId}"`, 'color:#d97706;font-weight:bold');
      entries.forEach(e => {
        const fn = e.level >= 3 ? console.error : e.level >= 2 ? console.warn : console.log;
        fn(`[${e.time}] ${e.message}`, e.data || '');
      });
      if (entries.length === 0) console.log('(sem logs)');
      console.groupEnd();
    };

    window._FO_disableModule = (moduleId) => {
      moduleLoader.disable(moduleId);
      logger.warn('ModuleMonitor', `👆 Módulo "${moduleId}" desativado manualmente.`);
    };

    window._FO_modules = () => moduleLoader.getAllStatuses();
  }

  destroy() {
    this._subs.forEach(u => u());
    if (this._healthTimer) clearInterval(this._healthTimer);
    this._restartTimers.forEach(t => clearTimeout(t));
    this._stuckTimers.forEach(t => clearTimeout(t));
  }
}

export const moduleMonitor = new ModuleMonitorClass();
export default moduleMonitor;
