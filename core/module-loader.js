/**
 * ╔══════════════════════════════════════════════════════════════════════╗
 * ║  FISCAL NA OBRA v15.1 — core/module-loader.js (v3 — Robusto)         ║
 * ╚══════════════════════════════════════════════════════════════════════╝
 *
 * CORREÇÕES APLICADAS:
 *
 *  BUG-1 (linha 302 original) — await faltando na Fase 2 (instanciação)
 *    safeExecute() é async — sem await, instanceResult era uma Promise não
 *    resolvida. Se new Klass() lançasse exceção, instance ficava undefined
 *    e instance.init() explodia com TypeError na Fase 3.
 *    → Adicionado: const instanceResult = await safeExecute(...)
 *
 *  BUG-2 (linha 311 original) — instanceResult nunca era verificado
 *    Mesmo com o await, o código não checava instanceResult.ok antes de
 *    chamar instance.init(), então uma falha no construtor era ignorada.
 *    → Adicionado: if (!instanceResult.ok) { return _handleLoadFailure(...) }
 *
 * MELHORIAS IMPLEMENTADAS (conforme requisitos):
 *
 *  REQ-1 — Module Loader robusto:
 *    - Carregamento em 3 fases isoladas: import → new Klass() → init()
 *    - Promise.all em initializeSystem() para aguardar dependências
 *    - Detecção de falha em cada fase com mensagem específica
 *    - console.error() em todo ponto de falha
 *
 *  REQ-2 — Timeout de 5 s com mensagem clara:
 *    - Todos os timeouts reduzidos de 6–10 000ms → 5 000ms
 *    - onError callback exibe: "Módulo X não carregou em 5s"
 *
 *  REQ-3 — Logs detalhados:
 *    - console.log("Carregando módulo X")  → ao iniciar cada load()
 *    - console.log("Módulo X carregado")   → ao concluir com sucesso
 *    - console.error("Erro ao carregar X") → em qualquer falha
 *
 *  REQ-4 — Exports corretos verificados no registro:
 *    - MODULE_REGISTRY mapeia cada módulo ao seu export nomeado
 *    - Fase 'export' valida que o símbolo existe antes de instanciar
 *
 *  REQ-5 — Nenhum módulo executa antes de ser inicializado:
 *    - Construtores não executam lógica (apenas atribuição de propriedades)
 *    - Toda lógica de inicialização está em init(), chamado explicitamente
 *
 *  REQ-6 — initializeSystem():
 *    - Função central que aguarda TODOS os módulos com Promise.all
 *    - Só resolve após todos terminarem (sucesso ou falha isolada)
 *    - Emite 'system:initialized' com relatório completo
 *
 * USO:
 *   // Carregar um único módulo:
 *   const inst = await moduleLoader.load('boletim-medicao');
 *
 *   // Carregar todos de uma vez (função central — REQ-6):
 *   const { loaded, failed } = await moduleLoader.initializeSystem(ids);
 *
 *   // Utilitários:
 *   moduleLoader.reload('boletim-medicao');
 *   moduleLoader.getStatus('boletim-medicao'); // active | failed | ...
 *   moduleLoader.getAllStatuses();
 */

import logger             from './logger.js';
import EventBus           from './EventBus.js';
import { safeExecute }    from './safe-execute.js';
import { FallbackUI }     from './fallback-ui.js';
import { createBoundary } from './error-boundary.js';

// ─────────────────────────────────────────────────────────────────────────────
// Status possíveis de um módulo
// ─────────────────────────────────────────────────────────────────────────────
export const MODULE_STATUS = Object.freeze({
  PENDING:      'pending',       // aguardando carregamento
  LOADING:      'loading',       // import() em andamento
  INITIALIZING: 'initializing',  // init() em andamento
  ACTIVE:       'active',        // funcionando normalmente
  DEGRADED:     'degraded',      // funcionando com falhas não-críticas
  FAILED:       'failed',        // falhou — não pode ser usado
  DISABLED:     'disabled',      // desativado manualmente
  RESTARTING:   'restarting',    // tentando reiniciar
});

// ─────────────────────────────────────────────────────────────────────────────
// REQ-2: timeout padrão de 5 000ms para todos os módulos
// ─────────────────────────────────────────────────────────────────────────────
const DEFAULT_MODULE_TIMEOUT = 5000;

// ─────────────────────────────────────────────────────────────────────────────
// Registro estático de módulos (REQ-4: export nomeado de cada módulo)
// ─────────────────────────────────────────────────────────────────────────────
// Cada entrada define:
//   path     — caminho relativo ao arquivo do módulo
//   export   — nome exato do export nomeado (ex: 'BoletimModule')
//   pageId   — id do <div class="pagina"> correspondente no HTML
//   timeout  — ms antes de considerar falha (REQ-2)
//   restartable — se o monitor pode tentar reiniciar automaticamente
const MODULE_REGISTRY = {
  'dashboard': {
    path:        '../modules/dashboard/dashboard-controller.js',
    export:      'DashboardModule',
    pageId:      'dashboard',
    timeout:     DEFAULT_MODULE_TIMEOUT,
    restartable: true,
  },
  'obras-manager': {
    path:        '../modules/obras-manager/obras-manager-controller.js',
    export:      'ObrasManagerModule',
    pageId:      'obras-manager',
    timeout:     DEFAULT_MODULE_TIMEOUT,
    restartable: true,
  },
  'boletim-medicao': {
    path:        '../modules/boletim-medicao/bm-controller.js',
    export:      'BoletimModule',
    pageId:      'boletim',
    timeout:     DEFAULT_MODULE_TIMEOUT,
    restartable: true,
  },
  'memoria-calculo': {
    path:        '../modules/memoria-calculo/memoria-controller.js',
    export:      'MemoriaModule',
    pageId:      'memoria',
    timeout:     DEFAULT_MODULE_TIMEOUT,
    restartable: true,
  },
  'aditivos': {
    path:        '../modules/aditivos/aditivos-controller.js',
    export:      'AditivosModule',
    pageId:      'aditivos',
    timeout:     DEFAULT_MODULE_TIMEOUT,
    restartable: true,
  },
  'config': {
    path:        '../modules/config/config-controller.js',
    export:      'ConfigModule',
    pageId:      'config',
    timeout:     DEFAULT_MODULE_TIMEOUT,
    restartable: true,
  },
  'chuva': {
    path:        '../modules/chuva/chuva-controller.js',
    export:      'ChuvaModule',
    pageId:      'chuva',
    timeout:     DEFAULT_MODULE_TIMEOUT,
    restartable: true,
  },
  'relatorio': {
    path:        '../modules/relatorio/relatorio-controller.js',
    export:      'RelatorioModule',
    pageId:      'relatorio',
    timeout:     DEFAULT_MODULE_TIMEOUT,
    restartable: true,
  },
  'diario': {
    path:        '../modules/diario/diario-controller.js',
    export:      'DiarioModule',
    pageId:      'diario',
    timeout:     DEFAULT_MODULE_TIMEOUT,
    restartable: true,
  },
  'documentos': {
    path:        '../modules/documentos/documentos-controller.js',
    export:      'DocumentosModule',
    pageId:      'documentos',
    timeout:     DEFAULT_MODULE_TIMEOUT,
    restartable: true,
  },
  'obras-concluidas': {
    path:        '../modules/obras-concluidas/obras-concluidas-controller.js',
    export:      'ObrasConcluiModule',
    pageId:      'obras-concluidas',
    timeout:     DEFAULT_MODULE_TIMEOUT,
    restartable: true,
  },
  'ocorrencias': {
    path:        '../modules/ocorrencias/ocorrencias-controller.js',
    export:      'OcorrenciasModule',
    pageId:      'ocorrencias',
    timeout:     DEFAULT_MODULE_TIMEOUT,
    restartable: true,
  },
  'historico': {
    path:        '../modules/historico/historico-controller.js',
    export:      'HistoricoModule',
    pageId:      'historico',
    timeout:     DEFAULT_MODULE_TIMEOUT,
    restartable: true,
  },
  'painel-contratual': {
    path:        '../modules/painel-contratual/painel-contratual-controller.js',
    export:      'PainelContratualModule',
    pageId:      'painel-contratual',
    timeout:     DEFAULT_MODULE_TIMEOUT,
    restartable: true,
  },
  'usuarios': {
    path:        '../modules/usuarios/usuarios-controller.js',
    export:      'UsuariosModule',
    pageId:      'usuarios',
    timeout:     DEFAULT_MODULE_TIMEOUT,
    restartable: true,
  },
  'notificacoes': {
    path:        '../modules/notificacoes/notificacoes-controller.js',
    export:      'NotificacoesModule',
    pageId:      'notificacoes',
    timeout:     DEFAULT_MODULE_TIMEOUT,
    restartable: true,
  },
  'importacao': {
    path:        '../modules/importacao/importacao-controller.js',
    export:      'ImportacaoModule',
    pageId:      'importacao',
    timeout:     DEFAULT_MODULE_TIMEOUT,
    restartable: true,
  },
  'dash-global': {
    path:        '../modules/dash-global/dash-global-controller.js',
    export:      'DashGlobalModule',
    pageId:      'dash-global',
    timeout:     DEFAULT_MODULE_TIMEOUT,
    restartable: true,
  },
  'diagnostico': {
    path:        '../modules/diagnostico/diagnostico-controller.js',
    export:      'DiagnosticoModule',
    pageId:      'diagnostico',
    timeout:     DEFAULT_MODULE_TIMEOUT,
    restartable: true,
  },
  'auditoria': {
    path:        '../modules/auditoria/auditoria-controller.js',
    export:      'AuditoriaModule',
    pageId:      'config',
    timeout:     DEFAULT_MODULE_TIMEOUT,
    restartable: true,
  },
  'exportacao-obra': {
    path:        '../modules/exportacao-obra/exportacao-obra-controller.js',
    export:      'ExportacaoObraModule',
    pageId:      'config',
    timeout:     DEFAULT_MODULE_TIMEOUT,
    restartable: true,
  },
  // ── Lei 14.133/2021 — módulos incrementais ──────────────────────────────
  'responsaveis': {
    path:        '../modules/responsaveis/responsaveis-controller.js',
    export:      'ResponsaveisModule',
    pageId:      'responsaveis',
    timeout:     DEFAULT_MODULE_TIMEOUT,
    restartable: true,
  },
  'sancoes': {
    path:        '../modules/sancoes/sancoes-controller.js',
    export:      'SancoesModule',
    pageId:      'sancoes',
    timeout:     DEFAULT_MODULE_TIMEOUT,
    restartable: true,
  },
  'prazos': {
    path:        '../modules/prazos/prazos-controller.js',
    export:      'PrazosModule',
    pageId:      'prazos',
    timeout:     DEFAULT_MODULE_TIMEOUT,
    restartable: true,
  },
  'recebimento': {
    path:        '../modules/recebimento/recebimento-controller.js',
    export:      'RecebimentoModule',
    pageId:      'recebimento',
    timeout:     DEFAULT_MODULE_TIMEOUT,
    restartable: true,
  },
  'riscos': {
    path:        '../modules/riscos/riscos-controller.js',
    export:      'RiscosModule',
    pageId:      'riscos',
    timeout:     DEFAULT_MODULE_TIMEOUT,
    restartable: true,
  },
  // ── Integração com PAC / Obras Federais ────────────────────────────────────
  'acesso-obra': {
    path:        '../modules/acesso-obra/acesso-obra-controller.js',
    export:      'AcessoObraModule',
    pageId:      'config',   // Renderiza dentro do painel de configuração
    timeout:     DEFAULT_MODULE_TIMEOUT,
    restartable: true,
  },
  'fiscal-obras': {
    path:        '../modules/fiscal-obras/fiscal-obras-controller.js',
    export:      'FiscalObrasModule',
    pageId:      'fiscal-obras',
    timeout:     DEFAULT_MODULE_TIMEOUT,
    restartable: true,
  },
  'sinapi': {
    path:        '../modules/sinapi/sinapi-controller.js',
    export:      'SinapiModule',
    pageId:      'sinapi',
    timeout:     DEFAULT_MODULE_TIMEOUT,
    restartable: true,
  },
  'fotos-medicao': {
    path:        '../modules/fotos-medicao/fotos-medicao-controller.js',
    export:      'FotosMedicaoModule',
    pageId:      'fotos-medicao',
    timeout:     DEFAULT_MODULE_TIMEOUT,
    restartable: true,
  },
  'checklist-tecnico': {
    path:        '../modules/checklist-tecnico/checklist-tecnico-controller.js',
    export:      'ChecklistTecnicoModule',
    pageId:      'checklist-tecnico',
    timeout:     DEFAULT_MODULE_TIMEOUT,
    restartable: true,
  },
  'etapas-pac': {
    path:        '../modules/etapas-pac/etapas-pac-controller.js',
    export:      'EtapasPacModule',
    pageId:      'etapas-pac',
    timeout:     DEFAULT_MODULE_TIMEOUT,
    restartable: true,
  },
  'relatorio-federal': {
    path:        '../modules/relatorio-federal/relatorio-federal-controller.js',
    export:      'RelatorioFederalModule',
    pageId:      'relatorio-federal',
    timeout:     DEFAULT_MODULE_TIMEOUT,
    restartable: true,
  },
  'modo-campo': {
    path:        '../modules/modo-campo/modo-campo-controller.js',
    export:      'ModoCampoModule',
    pageId:      'modo-campo',
    timeout:     DEFAULT_MODULE_TIMEOUT,
    restartable: true,
  },
  'qualidade': {
    path:        '../modules/qualidade/qualidade-controller.js',
    export:      'QualidadeModule',
    pageId:      'qualidade',
    timeout:     DEFAULT_MODULE_TIMEOUT,
    restartable: true,
  },
  // ── Módulo de integração — sem pageId próprio, roda em background ──────
  'integracao-lei14133': {
    path:        '../modules/integracao-lei14133/integracao-lei14133-controller.js',
    export:      'IntegracaoLei14133Module',
    pageId:      'dashboard', // não tem página própria — usa dashboard como fallback
    timeout:     DEFAULT_MODULE_TIMEOUT,
    restartable: true,
  },
};

// ─────────────────────────────────────────────────────────────────────────────
// ModuleEntry — estado interno de cada módulo
// ─────────────────────────────────────────────────────────────────────────────
class ModuleEntry {
  constructor(id, config) {
    this.id          = id;
    this.config      = config;
    this.status      = MODULE_STATUS.PENDING;
    this.instance    = null;
    this.error       = null;
    this.loadedAt    = null;
    this.failedAt    = null;
    this.restarts    = 0;
    this.maxRestarts = 3;
    this.errors      = [];
  }

  recordError(err) {
    this.error    = err;
    this.failedAt = Date.now();
    this.errors.push({ ts: Date.now(), message: err?.message || String(err), name: err?.name });
    if (this.errors.length > 10) this.errors.shift();
  }

  canRestart() {
    return this.config.restartable !== false && this.restarts < this.maxRestarts;
  }

  toJSON() {
    return {
      id:       this.id,
      status:   this.status,
      loadedAt: this.loadedAt,
      failedAt: this.failedAt,
      restarts: this.restarts,
      errors:   this.errors.slice(-3),
      pageId:   this.config.pageId,
    };
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// ModuleLoader
// ─────────────────────────────────────────────────────────────────────────────
class ModuleLoaderClass {
  constructor() {
    this._modules = new Map();
    this._ready   = false;

    // Pré-popula com entradas pendentes para que getStatus() funcione antes do boot
    Object.entries(MODULE_REGISTRY).forEach(([id, cfg]) => {
      this._modules.set(id, new ModuleEntry(id, cfg));
    });
  }

  // ───────────────────────────────────────────────────────────────────────────
  // REQ-6: initializeSystem()
  // Função central que carrega todos os módulos e só resolve quando TODOS
  // terminam — com sucesso ou falha isolada. Usa Promise.all (REQ-1).
  // ───────────────────────────────────────────────────────────────────────────
  /**
   * Inicializa o sistema carregando os módulos fornecidos em paralelo.
   * Aguarda todos com Promise.all e retorna um relatório de resultado.
   *
   * @param  {string[]} [moduleIds]  IDs a carregar. Usa o registro completo se omitido.
   * @returns {Promise<{ loaded: string[], failed: string[], total: number }>}
   */
  async initializeSystem(moduleIds = null) {
    const ids = moduleIds || [...this._modules.keys()];

    // REQ-3: log de início do sistema
    const t0 = performance.now();
    console.log(`[ModuleLoader] Iniciando sistema — ${ids.length} módulos a carregar...`);
    logger.info('ModuleLoader', `🚀 initializeSystem — ${ids.length} módulos em paralelo.`);

    // REQ-1: Promise.all aguarda TODOS antes de resolver
    // load() nunca rejeita — erros são isolados internamente
    const instances = await Promise.all(ids.map(id => this.load(id)));

    // Consolida relatório
    const summary = { loaded: [], failed: [], total: ids.length };
    ids.forEach((id, i) => {
      (instances[i] ? summary.loaded : summary.failed).push(id);
    });

    const elapsed = Math.round(performance.now() - t0);
    summary.elapsedMs = elapsed;

    if (summary.failed.length === 0) {
      console.log(`[ModuleLoader] Sistema inicializado — ${summary.total}/${summary.total} módulos OK em ${elapsed}ms.`);
    } else {
      console.warn(
        `[ModuleLoader] Sistema inicializado com falhas (${elapsed}ms) — ` +
        `${summary.loaded.length} OK, ${summary.failed.length} falhas: [${summary.failed.join(', ')}]`
      );
    }

    logger.info('ModuleLoader',
      `📦 initializeSystem: ${summary.loaded.length} OK, ${summary.failed.length} falhas`,
      summary
    );

    this._ready = summary.failed.length === 0;
    EventBus.emit('system:initialized', summary);
    return summary;
  }

  // ───────────────────────────────────────────────────────────────────────────
  // load() — carrega e inicializa um único módulo em 3 fases isoladas
  // ───────────────────────────────────────────────────────────────────────────
  /**
   * Carrega e inicializa um módulo dinamicamente.
   * Nunca rejeita — retorna null em caso de falha.
   *
   * @param  {string} moduleId
   * @returns {Promise<object|null>} instância do módulo ou null
   */
  async load(moduleId) {
    const entry = this._modules.get(moduleId);
    if (!entry) {
      console.error(`[ModuleLoader] Erro ao carregar módulo "${moduleId}": módulo desconhecido.`);
      logger.error('ModuleLoader', `Módulo desconhecido: "${moduleId}"`);
      return null;
    }

    // Já ativo → reutiliza instância existente
    if (entry.status === MODULE_STATUS.ACTIVE) {
      return entry.instance;
    }

    // Desabilitado → ignora silenciosamente
    if (entry.status === MODULE_STATUS.DISABLED) {
      console.warn(`[ModuleLoader] Módulo "${moduleId}" está desativado — ignorado.`);
      logger.warn('ModuleLoader', `Módulo "${moduleId}" está desativado — ignorado.`);
      return null;
    }

    // ── REQ-3: log de início ────────────────────────────────────────────────
    console.log(`[ModuleLoader] Carregando módulo "${moduleId}"...`);
    logger.info('ModuleLoader', `⏳ Carregando módulo "${moduleId}"...`);

    entry.status = MODULE_STATUS.LOADING;
    EventBus.emitAsync('module:loading', { moduleId });

    // ── FASE 1: import() dinâmico ───────────────────────────────────────────
    // REQ-2: timeout de 5 s, com mensagem de qual módulo falhou
    const importResult = await safeExecute(
      () => import(entry.config.path),
      {
        source:  `ModuleLoader:${moduleId}`,
        timeout: entry.config.timeout,
        label:   `import(${moduleId})`,
        onError: (err) => {
          if (err?.name === 'TimeoutError') {
            console.error(
              `[ModuleLoader] Módulo "${moduleId}" não carregou em ` +
              `${entry.config.timeout / 1000}s — verifique o caminho ou a rede.`
            );
          }
        },
      }
    );

    if (!importResult.ok) {
      console.error(`[ModuleLoader] Erro ao carregar módulo "${moduleId}" (import): ${importResult.error?.message}`);
      return this._handleLoadFailure(entry, importResult.error, 'import');
    }

    // ── FASE 2: verificar export ────────────────────────────────────────────
    // REQ-4: garante que o export nomeado existe no arquivo
    const mod   = importResult.value;
    const Klass = mod[entry.config.export];

    if (typeof Klass !== 'function') {
      const err = new Error(
        `Export "${entry.config.export}" não encontrado em "${entry.config.path}". ` +
        `Verifique se o arquivo usa: export class ${entry.config.export} { ... }`
      );
      console.error(`[ModuleLoader] Erro ao carregar módulo "${moduleId}" (export): ${err.message}`);
      return this._handleLoadFailure(entry, err, 'export');
    }

    // ── FASE 3: instanciação ────────────────────────────────────────────────
    // Construtores são síncronos e triviais — safeExecute adicionaria overhead
    // desnecessário de Promise/timeout em todos os 30+ módulos. Usamos try/catch direto.
    let instance;
    try {
      instance = new Klass();
    } catch (err) {
      console.error(`[ModuleLoader] Erro ao carregar módulo "${moduleId}" (instanciação): ${err?.message}`);
      return this._handleLoadFailure(entry, err, 'instantiation');
    }

    // ── FASE 4: init() ──────────────────────────────────────────────────────
    // REQ-5: módulo só executa código a partir daqui, após estar completamente pronto
    // REQ-2: timeout de 5 s com mensagem clara de qual módulo travou
    entry.status = MODULE_STATUS.INITIALIZING;

    const initResult = await safeExecute(
      () => instance.init(),
      {
        source:  `${moduleId}.init`,
        timeout: entry.config.timeout,
        retries: 0,
        label:   `${moduleId}.init()`,
        onError: (err) => {
          if (err?.name === 'TimeoutError') {
            console.error(
              `[ModuleLoader] Módulo "${moduleId}" não inicializou em ` +
              `${entry.config.timeout / 1000}s — o método init() pode estar travado.`
            );
          }
        },
      }
    );

    if (!initResult.ok) {
      console.error(`[ModuleLoader] Erro ao carregar módulo "${moduleId}" (init): ${initResult.error?.message}`);
      return this._handleLoadFailure(entry, initResult.error, 'init');
    }

    // ── Sucesso ─────────────────────────────────────────────────────────────
    entry.instance = instance;
    entry.status   = MODULE_STATUS.ACTIVE;
    entry.loadedAt = Date.now();
    entry.error    = null;

    // Registra ErrorBoundary para proteção pós-boot
    try { createBoundary(moduleId, entry.config.pageId); } catch {}

    // REQ-3: log de conclusão bem-sucedida
    console.log(`[ModuleLoader] Módulo "${moduleId}" carregado.`);
    logger.info('ModuleLoader', `✅ Módulo "${moduleId}" ativo.`);
    EventBus.emit('module:loaded', { moduleId, entry: entry.toJSON() });

    return instance;
  }

  // ───────────────────────────────────────────────────────────────────────────
  // loadAll() — mantido para compatibilidade (prefira initializeSystem)
  // ───────────────────────────────────────────────────────────────────────────
  /** Carrega múltiplos módulos em paralelo. Falhas são isoladas. */
  async loadAll(moduleIds = null) {
    const ids = moduleIds || [...this._modules.keys()];
    const results = await Promise.allSettled(ids.map(id => this.load(id)));

    const summary = { loaded: [], failed: [] };
    ids.forEach((id, i) => {
      const r = results[i];
      (r.status === 'fulfilled' && r.value ? summary.loaded : summary.failed).push(id);
    });

    logger.info('ModuleLoader',
      `📦 loadAll: ${summary.loaded.length} OK, ${summary.failed.length} falhas`, summary
    );
    return summary;
  }

  // ───────────────────────────────────────────────────────────────────────────
  // Descarregamento / reload / disable
  // ───────────────────────────────────────────────────────────────────────────

  unload(moduleId) {
    const entry = this._modules.get(moduleId);
    if (!entry || !entry.instance) return;
    try { entry.instance.destroy?.(); } catch (e) {
      logger.warn('ModuleLoader', `Erro ao destruir "${moduleId}": ${e.message}`);
    }
    // Safety net: remove any EventBus listeners registered by this module's context
    try { EventBus.offByContext(moduleId); } catch {}
    // Also try common context aliases (pageId)
    if (entry.config?.pageId && entry.config.pageId !== moduleId) {
      try { EventBus.offByContext(entry.config.pageId); } catch {}
    }
    entry.instance = null;
    entry.status   = MODULE_STATUS.PENDING;
    logger.info('ModuleLoader', `🔌 Módulo "${moduleId}" descarregado.`);
    EventBus.emit('module:unloaded', { moduleId });
  }

  async reload(moduleId) {
    logger.info('ModuleLoader', `🔄 Recarregando módulo "${moduleId}"...`);
    const entry = this._modules.get(moduleId);
    if (!entry) return null;
    entry.status = MODULE_STATUS.RESTARTING;
    entry.restarts++;
    this.unload(moduleId);
    EventBus.emit('module:restarting', { moduleId, attempt: entry.restarts });
    await new Promise(r => setTimeout(r, 500 * entry.restarts));
    return this.load(moduleId);
  }

  disable(moduleId) {
    const entry = this._modules.get(moduleId);
    if (!entry) return;
    this.unload(moduleId);
    entry.status = MODULE_STATUS.DISABLED;
    logger.warn('ModuleLoader', `🔒 Módulo "${moduleId}" desativado.`);
    EventBus.emit('module:disabled', { moduleId });
    FallbackUI.show(entry.config.pageId, moduleId, null, true);
  }

  // ───────────────────────────────────────────────────────────────────────────
  // Consultas
  // ───────────────────────────────────────────────────────────────────────────

  getInstance(moduleId) {
    const entry = this._modules.get(moduleId);
    return entry?.status === MODULE_STATUS.ACTIVE ? entry.instance : null;
  }

  getStatus(moduleId)  { return this._modules.get(moduleId)?.status ?? null; }
  isActive(moduleId)   { return this.getStatus(moduleId) === MODULE_STATUS.ACTIVE; }
  get isReady()        { return this._ready; }

  getAllStatuses() {
    const out = {};
    this._modules.forEach((entry, id) => { out[id] = entry.toJSON(); });
    return out;
  }

  getActiveModules() {
    const active = [];
    this._modules.forEach((entry, id) => {
      if (entry.status === MODULE_STATUS.ACTIVE) active.push(id);
    });
    return active;
  }

  getFailedModules() {
    const failed = [];
    this._modules.forEach((entry, id) => {
      if (entry.status === MODULE_STATUS.FAILED) failed.push(id);
    });
    return failed;
  }

  // ───────────────────────────────────────────────────────────────────────────
  // Internos
  // ───────────────────────────────────────────────────────────────────────────

  _handleLoadFailure(entry, error, phase) {
    entry.recordError(error);
    entry.status = MODULE_STATUS.FAILED;

    // REQ-3: console.error com formato padronizado
    console.error(`[ModuleLoader] Erro ao carregar módulo "${entry.id}" — fase "${phase}": ${error?.message}`);
    logger.error('ModuleLoader',
      `❌ Módulo "${entry.id}" falhou na fase "${phase}": ${error?.message}`,
      { phase, stack: error?.stack, restarts: entry.restarts }
    );

    EventBus.emit('module:failed', {
      moduleId: entry.id,
      phase,
      error:    error?.message,
      entry:    entry.toJSON(),
    });

    FallbackUI.show(entry.config.pageId, entry.id, error, false);
    return null;
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// REQ-4: exports nomeado e default para compatibilidade
// ─────────────────────────────────────────────────────────────────────────────
export const moduleLoader = new ModuleLoaderClass();
export { MODULE_REGISTRY };
export default moduleLoader;
