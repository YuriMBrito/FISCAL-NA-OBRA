/**
 * ╔══════════════════════════════════════════════════════════════════════╗
 * ║  FISCAL NA OBRA v15.1 — core/app.js                                 ║
 * ║  CORREÇÃO v15.1:                                                     ║
 * ║   - EventDelegate inicializado no boot (elimina onclick inline)      ║
 * ║   - Handlers da index.html registrados via EventDelegate             ║
 * ║   - Comentários obsoletos de onclick removidos                       ║
 * ╚══════════════════════════════════════════════════════════════════════╝
 *
 * CORREÇÕES APLICADAS:
 *
 *  BUG-A — timeout excessivo nos módulos críticos
 *    Original: timeout: 10 000ms × retries: 2 = até 32 segundos de espera
 *    por módulo antes de liberar a tela. Com 5 módulos críticos em paralelo,
 *    o boot podia travar visualmente por todo esse tempo.
 *    → timeout: 5 000ms, retries: 1 (máximo 10s por módulo)
 *
 *  BUG-B — módulos dinâmicos eram fire-and-forget
 *    Original: loadAll() chamado sem await — falhas silenciosas, sem
 *    garantia de que todos estavam prontos antes do boot ser declarado ok.
 *    → Substituído por await moduleLoader.initializeSystem() (REQ-6)
 *
 * MELHORIAS (conforme requisitos):
 *
 *  REQ-1  — _bootCriticalModules usa Promise.all (paralelo, falhas isoladas)
 *  REQ-2  — timeout de 5s com mensagem clara de qual módulo travou
 *  REQ-3  — console.log em cada passo do boot e em cada módulo crítico
 *  REQ-6  — initializeSystem() aguarda todos os dinâmicos antes de
 *           remover o loader
 */

import EventBus      from './EventBus.js';
import logger        from './logger.js';
import state         from './state.js';
import router        from './router.js';
import { safeExecute, safeExecuteSync } from './safe-execute.js';
import moduleLoader  from './module-loader.js';
import moduleMonitor from './module-monitor.js';
import FallbackUI    from './fallback-ui.js';

import { ToastComponent }   from '../components/toast.js';
import { SidebarComponent } from '../components/sidebar.js';
import { TopbarComponent }  from '../components/topbar.js';
import { ConfirmComponent } from '../components/confirm.js';
import { AvisoIntegridade } from '../components/aviso-integridade.js';
import { PAPEL_PADRAO }     from '../utils/rbac.js';
import { formatters }       from '../utils/formatters.js';
import { FirebaseService }  from '../firebase/firebase-service.js';
import { stubGlobals }      from '../utils/global-guard.js';
import { initAutoSave }     from '../utils/auto-save.js';
import EventDelegate        from '../utils/event-delegate.js';
// REQ-5: imports estáticos garantem que as classes estão disponíveis
// antes do boot — nenhum módulo executa código no momento do import,
// apenas declara a classe. A execução começa em init(), chamado pelo boot.
import { DashboardModule }    from '../modules/dashboard/dashboard-controller.js';
import { BoletimModule }      from '../modules/boletim-medicao/bm-controller.js';
import { AditivosModule }     from '../modules/aditivos/aditivos-controller.js';
import { DocumentosModule }   from '../modules/documentos/documentos-controller.js';
import { ObrasManagerModule } from '../modules/obras-manager/obras-manager-controller.js';
import { FiscalObrasModule }  from '../modules/fiscal-obras/fiscal-obras-controller.js';

// ── Novos serviços — v15+ ───────────────────────────────────────────────────
// CARREGADOS DINAMICAMENTE em _initNewServices() para não travar o boot
// caso algum arquivo não exista no servidor (404 não derruba o módulo inteiro).

// ─────────────────────────────────────────────────────────────────────────────
// Definição dos grupos de módulos
// ─────────────────────────────────────────────────────────────────────────────

const CRITICAL_MODULES = [
  { id: 'dashboard',       Klass: DashboardModule,    pageId: 'dashboard'     },
  { id: 'boletim-medicao', Klass: BoletimModule,      pageId: 'boletim'       },
  { id: 'aditivos',        Klass: AditivosModule,     pageId: 'aditivos'      },
  { id: 'documentos',      Klass: DocumentosModule,   pageId: 'documentos'    },
  { id: 'obras-manager',   Klass: ObrasManagerModule, pageId: 'obras-manager' },
  { id: 'fiscal-obras',    Klass: FiscalObrasModule,  pageId: 'fiscal-obras'  },
];

const DYNAMIC_MODULE_IDS = [
  'memoria-calculo', 'config', 'chuva', 'relatorio', 'diario',
  'obras-concluidas', 'ocorrencias', 'historico', 'painel-contratual',
  'usuarios', 'notificacoes', 'importacao', 'dash-global', 'diagnostico',
  'auditoria', 'exportacao-obra',
  // Lei 14.133/2021 — módulos incrementais
  'responsaveis', 'sancoes', 'prazos', 'recebimento', 'riscos',
  // Integração entre módulos (sem pageId próprio — carrega em background)
  'integracao-lei14133',
  // PAC / Obras Federais — novos módulos
  'sinapi', 'fotos-medicao', 'checklist-tecnico', 'etapas-pac',
  'relatorio-federal', 'modo-campo', 'qualidade',
  // Gerenciamento de acesso à obra (renderiza dentro da página config)
  'acesso-obra',
];

// ─────────────────────────────────────────────────────────────────────────────
// App
// ─────────────────────────────────────────────────────────────────────────────
class App {
  constructor() {
    this._booting      = false;
    this._ready        = false;
    this._critInst     = new Map();
    // FIX-E1.2: flag de idempotência para o handler auth:login principal.
    // Impede que múltiplos listeners paralelos executem a carga de dados
    // mais de uma vez na mesma sessão (race condition em redes lentas).
    this._loginHandled = false;
  }

  // ───────────────────────────────────────────────────────────────────────────
  // boot() — sequência principal de inicialização
  // ───────────────────────────────────────────────────────────────────────────
  async boot() {
    if (this._booting) return;
    this._booting = true;
    const t0 = performance.now();

    try {

      // ── PASSO 1: Logger ───────────────────────────────────────────────────
      console.log('[Boot] Passo 1/11 — Inicializando logger...');
      logger.setLevel('info');
      logger.setEventBus(EventBus);
      logger.info('App', '🚀 Fiscal na Obra v15.1 — boot iniciado');

      // ── P1 — Stubs globais: evita ReferenceError antes dos módulos carregarem
      // Todas as funções usadas em onclick="window.fn()" ficam disponíveis
      // imediatamente. Quando o módulo real registrar a função, o stub é
      // substituído e chamadas enfileiradas são drenadas automaticamente.
      safeExecuteSync(() => stubGlobals(
        '_dgAbrirObra', '_dgBusca', '_dgFiltro', '_dgLimparFiltros', '_dgRecarregar', '_dgTab',
        '_dashMudarStatus', '_dashDetalheBM', '_dashTab', '_dashGerarPDF', '_dashGerarPDFContratual',
        '_dashAlerta', '_alertaConfig', '_alertaAtualizar',
        'renderDashboard', 'renderRegistroBMs', 'renderBoletim', 'abrirDetalheBM',
        '_adtSalvar', '_adtEditar', '_adtExcluir', '_adtVerPlanilha', '_adtVerVersao',
        '_adtFecharModal', '_adtCalcVariacao', '_adtCalcTermino', '_adtOnStatusChange',
        '_adtGerarPDF', '_adtAbrirPlanilhaEditor', '_adtFecharPlanilhaEditor',
        '_adtPlanilhaReset', '_adtPlanilhaAplicar', '_adtPlanilhaEditQtd',
        '_adtPlanilhaEditUp', '_adtPlanilhaEditDesc', '_adtPlanilhaRemover',
        '_adtPlanilhaRestaurar', 'abrirModalNovoAditivo',
        'salvarMedicaoBol', 'renderMemoria', 'imprimirMemoria', 'exportarCSVMemoria',
        'exportarCSVBoletim', 'exportarCSVRegistroBMs', 'imprimirRegistroBMs',
        'exportarCSVRelatorio', 'exportarCSVChuva', 'exportarCSVNotificacoes', 'imprimirChuva',
        'exportarCSVDiario', 'gerarPDFDiario', '_diario_gerarPDFEntrada',
        'exportarCSVPainelContratual', 'exportarDocumentacaoObra',
        'renderAuditLog', 'exportarCSVAudit', 'auditRegistrar',
        '_siProcessarArquivo', '_siCriarObra', '_notif_editar',
        'novaObra', 'verPagina',
      ), { source: 'App:globalStubs' });

      // ── PASSO 2: Toast ────────────────────────────────────────────────────
      console.log('[Boot] Passo 2/11 — Toast...');
      safeExecuteSync(() => ToastComponent.init(), { source: 'App:toast' });
      window.toast = (msg, tipo = 'ok', dur) =>
        safeExecuteSync(() => ToastComponent.show(msg, tipo, dur), { source: 'toast', silent: true });

      // Aviso de integridade: precisa subir junto com o Toast, antes de
      // qualquer leitura da obra. É ele que transforma "leitura recusada" em
      // faixa vermelha na tela, em vez de dado fabricado passando por real.
      safeExecuteSync(() => AvisoIntegridade.init(), { source: 'App:aviso-integridade' });

      // FIX-E3.3: expõe confirm globalizado para migração gradual dos módulos
      // (ConfirmComponent já exporta window._confirm no seu próprio módulo,
      //  mas garantimos que está disponível desde o boot)
      window._confirm = (message, opts) => ConfirmComponent.show(message, opts);

      // ── PASSO 2b: Login ───────────────────────────────────────────────────
      safeExecuteSync(() => this._initLogin(), { source: 'App:login' });

      // ── PASSO 2c: EventDelegate — substitui onclick="window.fn()" ────────
      // Todos os botões no index.html usam data-action="fn" em vez de onclick.
      // O EventDelegate escuta click/change no container e despacha para o
      // handler registrado, permitindo CSP sem 'unsafe-inline'.
      safeExecuteSync(() => {
        EventDelegate.init(document.body);
        this._registerIndexHandlers();
      }, { source: 'App:eventDelegate' });

      // ── PASSO 3: State + formatters ───────────────────────────────────────
      console.log('[Boot] Passo 3/11 — State e formatters...');
      await safeExecute(() => this._initState(), { source: 'App:state', timeout: 2000 });

      // ── PASSO 4: Firebase (aguarda auth antes de continuar) ──────────────
      console.log('[Boot] Passo 4/11 — Firebase (aguardando auth state)...');
      const _fbRes = await safeExecute(() => this._initFirebase(), { source: 'App:firebase', timeout: 10000 });
      if (!_fbRes.ok) {
        console.warn('[Boot] Firebase offline — modo local ativo.');
        logger.warn('App', '⚠️ Firebase offline — modo local ativo.');
      } else {
        console.log('[Boot] Firebase conectado e auth resolvido.');
      }

      // ── PASSO 5: Sidebar + Topbar ─────────────────────────────────────────
      console.log('[Boot] Passo 5/11 — Sidebar e Topbar...');
      safeExecuteSync(() => SidebarComponent.init(this._getNavRoutes()), { source: 'App:sidebar' });
      safeExecuteSync(() => TopbarComponent.init(),                       { source: 'App:topbar'  });

      // ── PASSO 6: ModuleMonitor ────────────────────────────────────────────
      console.log('[Boot] Passo 6/11 — ModuleMonitor...');
      safeExecuteSync(() => moduleMonitor.init(), { source: 'App:monitor' });

      // ── PASSO 7: Módulos críticos ─────────────────────────────────────────
      // REQ-1: Promise.all — 5 módulos em paralelo, falhas isoladas
      // BUG-A: timeout reduzido de 10 000ms → 5 000ms, retries: 2 → 1
      console.log(`[Boot] Passo 7/11 — Módulos críticos (${CRITICAL_MODULES.length} em paralelo)...`);
      logger.info('App', '🔐 Carregando módulos críticos...');
      await this._bootCriticalModules();

      // ── PASSO 8: Módulos dinâmicos ────────────────────────────────────────
      // FIX-2: carregados em BACKGROUND — não bloqueiam a remoção do loader.
      // O loader sai assim que os módulos críticos estão prontos, reduzindo
      // drasticamente o tempo percebido de carregamento (era até ~40s).
      // As rotas dinâmicas são registradas quando os módulos ficam prontos.
      console.log(`[Boot] Passo 8/11 — Módulos dinâmicos (${DYNAMIC_MODULE_IDS.length} em background)...`);
      logger.info('App', '📦 Iniciando carregamento dinâmico em background...');
      const dynPromise = moduleLoader.initializeSystem(DYNAMIC_MODULE_IDS);

      // ── PASSO 9: Registrar módulos críticos no router ─────────────────────
      console.log('[Boot] Passo 9/11 — Registrando rotas dos módulos críticos...');
      this._registrarRotas();

      // Valor contratual sempre colado na planilha de itens
      safeExecuteSync(() => this._observarItensContrato(), { source: 'App:valorContratual' });

      // ── PASSO 9b: Listeners globais ───────────────────────────────────────
      console.log('[Boot] Passo 9b/11 — Listeners globais...');
      safeExecuteSync(() => this._setupGlobalListeners(), { source: 'App:listeners' });

      // ── PASSO 10: Navegação inicial ───────────────────────────────────────
      console.log('[Boot] Passo 10/11 — Navegação inicial...');
      const hash = window.location.hash?.replace('#', '').trim();
      router.navigate(
        (hash && document.getElementById(hash)) ? hash : 'dashboard',
        { noHash: true }
      );

      // ── PASSO 11: Remove loader (módulos críticos já prontos) ─────────────
      console.log('[Boot] Passo 11/11 — Removendo tela de carregamento...');
      this._removeLoader();

      // ── Dinâmicos: aguarda em background e registra rotas quando prontos ──
      dynPromise.then(dynResult => {
        logger.info('App',
          `📦 Dinâmicos: ${dynResult.loaded.length} OK, ${dynResult.failed.length} falhas`
        );
      }).catch(e => logger.error('App', 'Erro inesperado em módulos dinâmicos:', e?.message));
      // ── SERVIÇOS v15+: inicializam após o boot ────────────────────────────
      // São desacoplados — falha de um serviço não afeta o boot nem os módulos.
      setTimeout(() => this._initNewServices(), 600);

      // ── Concluído ─────────────────────────────────────────────────────────
      this._ready    = true;
      // Expõe EventBus globalmente para scripts clássicos (ex: login-controller.js offline mode)
      window._appEventBus = EventBus;
      const elapsed  = Math.round(performance.now() - t0);
      console.log(`[Boot] ✅ Boot completo em ${elapsed}ms.`);
      logger.info('App', `✅ Boot completo em ${elapsed}ms`);
      EventBus.emit('app:ready', { elapsed });

    } catch (err) {
      // Erro fatal: só chega aqui se algo fora do safeExecute lançar
      console.error('[Boot] ❌ Erro fatal no boot:', err?.message);
      logger.critical('App', `💀 Erro fatal no boot: ${err?.message}`, { stack: err?.stack });
      this._showBootError(err);
    } finally {
      this._booting = false;
    }
  }

  // ───────────────────────────────────────────────────────────────────────────
  // _bootCriticalModules()
  // ───────────────────────────────────────────────────────────────────────────
  async _bootCriticalModules() {
    // REQ-1: Promise.all carrega todos em paralelo
    // Falha de um módulo não cancela os demais — _loadCriticalModule() nunca rejeita
    const results = await Promise.all(
      CRITICAL_MODULES.map(m => this._loadCriticalModule(m.id, m.Klass, m.pageId))
    );
    const ok = results.filter(Boolean).length;
    console.log(`[Boot] Módulos críticos: ${ok}/${CRITICAL_MODULES.length} carregados.`);
    logger.info('App', `🔐 Críticos: ${ok}/${CRITICAL_MODULES.length} OK`);
  }

  async _loadCriticalModule(id, Klass, pageId) {
    // REQ-3: log de início do módulo
    console.log(`[Boot] Carregando módulo "${id}"...`);

    const result = await safeExecute(
      async () => {
        // REQ-5: o construtor não executa lógica — apenas cria o objeto.
        // Todo o trabalho real está em init().
        const i = new Klass();
        await i.init();
        return i;
      },
      {
        source:     `App:critical:${id}`,
        timeout:    5000,    // BUG-A: reduzido de 10 000 → 5 000ms
        retries:    1,       // BUG-A: reduzido de 2 → 1 (máximo 2 tentativas = 10s)
        retryDelay: 800,
        label:      `critical.${id}`,
        // REQ-2: mensagem clara de qual módulo excedeu o timeout
        onError: (err) => {
          if (err?.name === 'TimeoutError') {
            console.error(
              `[Boot] Módulo crítico "${id}" não inicializou em 5s. ` +
              `Verifique o método init() de ${Klass.name}.`
            );
          }
        },
      }
    );

    if (result.ok) {
      this._critInst.set(id, result.value);

      // Sincroniza com o module-loader para que app.getModule() funcione
      const entry = moduleLoader._modules.get(id);
      if (entry) {
        entry.instance = result.value;
        entry.status   = 'active';
        entry.loadedAt = Date.now();
      }

      // REQ-3: log de conclusão bem-sucedida
      console.log(`[Boot] Módulo "${id}" carregado.`);
      logger.info('App', `✅ Módulo crítico "${id}" ativo.`);
      EventBus.emit('module:loaded', { moduleId: id });
      return result.value;

    } else {
      // REQ-3: log de erro com nome do módulo
      console.error(`[Boot] Erro ao carregar módulo "${id}": ${result.error?.message}`);
      logger.error('App', `❌ Módulo crítico "${id}" falhou: ${result.error?.message}`);
      FallbackUI.show(pageId, id, result.error, false);

      const entry = moduleLoader._modules.get(id);
      if (entry) { entry.recordError(result.error); entry.status = 'failed'; }

      EventBus.emit('module:failed', {
        moduleId: id,
        phase:    'boot-critical',
        error:    result.error?.message,
      });
      return null;
    }
  }

  // ───────────────────────────────────────────────────────────────────────────
  // Helpers internos
  // ───────────────────────────────────────────────────────────────────────────

  // ───────────────────────────────────────────────────────────────────────────
  // _registrarRotas()
  // Conecta o onEnter() de cada módulo ao router pelo pageId correspondente.
  // Sem isso, router.navigate('importacao') abre a div HTML mas nunca chama
  // o método onEnter() do módulo — a tela fica em branco.
  // ───────────────────────────────────────────────────────────────────────────
  // ───────────────────────────────────────────────────────────────────────────
  // _sincronizarValorContratual()
  // O valor do contrato exibido em todo o sistema (dashboards, gráficos,
  // relatórios, boletim) passa a ser SEMPRE a soma da planilha de itens, e não
  // o número digitado em Configurações — que ficava defasado e divergia por
  // centavos do total das medições.
  //
  // Só sobrescreve quando há itens; sem planilha, mantém o valor digitado.
  // ───────────────────────────────────────────────────────────────────────────
  async _sincronizarValorContratual() {
    try {
      const itens = state.get('itensContrato') || [];
      if (!itens.length) return;
      const cfg = state.get('cfg') || {};
      const { getValorContratual } = await import('../modules/boletim-medicao/bm-calculos.js');
      const soma = getValorContratual(itens, cfg);
      if (soma > 0 && Math.abs((parseFloat(cfg.valor) || 0) - soma) >= 0.005) {
        state.set('cfg', { ...cfg, valor: soma });
        logger.info('App', `💰 Valor contratual sincronizado com a planilha: ${soma}`);
      }
    } catch (e) {
      console.warn('[App] _sincronizarValorContratual:', e);
    }
  }

  /** Mantém o valor contratual colado na planilha sempre que os itens mudarem. */
  _observarItensContrato() {
    try {
      state.subscribe('itensContrato', () => this._sincronizarValorContratual());
      EventBus.on('itens:atualizados', () => this._sincronizarValorContratual(), 'app:valor');
    } catch (e) {
      console.warn('[App] _observarItensContrato:', e);
    }
  }

  _registrarRotas() {
    // Mapeamento pageId → moduleId (para módulos onde diferem)
    const PAGE_TO_MODULE = {
      'boletim':   'boletim-medicao',
      'memoria':   'memoria-calculo',
    };

    // CRIT-02: múltiplos módulos podem compartilhar o mesmo pageId (ex: 'config').
    // Em vez de sobrescrever silenciosamente, acumulamos os handlers e registramos
    // uma única rota que chama todos eles em sequência.
    //
    // Estrutura: Map<pageId, { enters: Function[], leaves: Function[] }>
    const pageHandlers = new Map();

    const _addHandlers = (pageId, inst) => {
      if (!inst || !pageId) return;
      if (!pageHandlers.has(pageId)) pageHandlers.set(pageId, { enters: [], leaves: [] });
      const h = pageHandlers.get(pageId);
      if (typeof inst.onEnter === 'function') h.enters.push((data) => inst.onEnter?.(data));
      if (typeof inst.onLeave === 'function') h.leaves.push(()     => inst.onLeave?.());
    };

    const _commitRoute = (pageId) => {
      const h = pageHandlers.get(pageId);
      if (!h) return;
      router.register(pageId, {
        onEnter: (data) => h.enters.forEach(fn => fn(data)),
        onLeave: ()     => h.leaves.forEach(fn => fn()),
      });
    };

    // Registra módulos críticos (já instanciados em this._critInst)
    CRITICAL_MODULES.forEach(({ id, pageId }) => {
      _addHandlers(pageId, this._critInst.get(id));
    });

    // Registra módulos dinâmicos (via moduleLoader)
    DYNAMIC_MODULE_IDS.forEach(moduleId => {
      const entry  = moduleLoader._modules.get(moduleId);
      const pageId = entry?.config?.pageId || moduleId;
      _addHandlers(pageId, moduleLoader.getInstance(moduleId));
    });

    // Commit all composed routes
    for (const pageId of pageHandlers.keys()) _commitRoute(pageId);

    // Escuta novos módulos que carregarem depois do boot (reloads, etc.)
    EventBus.on('module:loaded', ({ moduleId }) => {
      const entry  = moduleLoader._modules.get(moduleId);
      const pageId = entry?.config?.pageId || moduleId;
      const inst   = moduleLoader.getInstance(moduleId)
                  || this._critInst.get(moduleId);
      if (!inst || !pageId) return;
      // Merge into existing handler list then re-commit (idempotent for single module)
      _addHandlers(pageId, inst);
      _commitRoute(pageId);
    }, 'app:rotas');

    logger.info('App', `✅ Rotas registradas no router.`);
  }

  _initLogin() {
    window._loginAction = async () => {
      const email  = document.getElementById('login-email')?.value?.trim() || '';
      const senha  = document.getElementById('login-senha')?.value || '';
      const erroEl = document.getElementById('login-erro');

      // Limpa erro anterior
      if (erroEl) erroEl.innerHTML = '';

      if (!email || !senha) {
        if (erroEl) erroEl.innerHTML = '⚠️ Preencha e-mail e senha.';
        return;
      }

      // Ativa loading
      window._setLoginLoading?.(true);

      try {
        await FirebaseService.login(email, senha);

        // Salva e-mail se toggle ativo (sessionStorage apenas para UX — não dados de obra)
        try {
          if (window._salvarLoginAtivo) sessionStorage.setItem('fo_login_email', email);
          else sessionStorage.removeItem('fo_login_email');
        } catch(e) {}

        // Esconde login e mostra app
        const telaLogin = document.getElementById('tela-login');
        if (telaLogin) telaLogin.style.display = 'none';
        const appShell = document.getElementById('app-shell');
        if (appShell) appShell.style.display = 'flex';

      } catch (err) {
        // "E-mail ou senha inválidos" era o texto PADRÃO: qualquer falha que
        // não casasse com a lista virava acusação de senha errada. Um 403 da
        // API Key restrita a domínios (o servidor de teste não cadastrado no
        // Google Cloud) mandava o usuário procurar a senha certa durante horas,
        // quando o login estava correto e o bloqueio era de origem HTTP.
        // Só afirmamos a causa quando ela é conhecida.
        const msg    = err?.message || '';
        const codigo = err?.code || '';
        let texto;

        if (msg.includes('user-not-found') || msg.includes('no user record'))
          texto = '❌ Usuário não encontrado.';
        else if (msg.includes('wrong-password') || msg.includes('invalid-credential') || msg.includes('invalid credential'))
          texto = '❌ E-mail ou senha inválidos.';
        else if (msg.includes('too-many-requests'))
          texto = '⏳ Muitas tentativas. Aguarde alguns minutos.';
        else if (msg.includes('network') || msg.includes('Network'))
          texto = '🌐 Sem conexão. Verifique sua internet.';
        else if (msg.includes('blocked') || msg.includes('referer') || msg.includes('API key')
                 || msg.includes('requests-to-this-api') || codigo === 'auth/requests-from-referer-are-blocked')
          texto = '🚫 Esta origem não está autorizada na API Key.<br>' +
                  '<span style="font-weight:400;font-size:11px">Google Cloud Console → Credenciais → chave do navegador → ' +
                  'liberar este endereço em "Referenciadores HTTP". Não é a sua senha.</span>';
        else if (msg.includes('operation-not-allowed'))
          texto = '🚫 Login por e-mail e senha está desabilitado no Firebase Console.';
        else
          texto = `❌ Não foi possível entrar.<br>` +
                  `<span style="font-weight:400;font-size:11px">${codigo || msg || 'erro desconhecido'}</span>`;

        console.error('[Login]', codigo, msg, err);
        if (erroEl) erroEl.innerHTML = texto;
      } finally {
        window._setLoginLoading?.(false);
      }
    };

    // Enter dispara login
    document.getElementById('login-senha')?.addEventListener('keydown', e => {
      if (e.key === 'Enter') window._loginAction?.();
    });

    // auth:login — esconde tela de login e carrega dados completos da obra ativa
    EventBus.on('auth:login', async () => {
      // FIX-E1.2: idempotência — garante execução única por sessão.
      // Sem este guard, os 3 listeners auth:login disparam em paralelo ao
      // login, causando race conditions onde carregamentos posteriores
      // sobrescrevem dados com null em redes lentas.
      if (this._loginHandled) return;
      this._loginHandled = true;
      const telaLogin = document.getElementById('tela-login');
      if (telaLogin) telaLogin.style.display = 'none';
      const shell = document.getElementById('app-shell');
      if (shell) shell.style.display = 'flex';

      // Carrega a lista de obras do Firebase e popula o state.
      try {
        const lista = await FirebaseService.getObrasLista();
        if (Array.isArray(lista) && lista.length > 0) {
          state.set('obrasLista', lista);
          EventBus.emit('obras:lista-atualizada', {});
        }
      } catch (e) {
        console.warn('[App] auth:login — erro ao carregar obras:', e);
      }

      // ── Carrega cfg / bms / itens da obra ativa direto do Firebase ──
      // Sem isso, o state usa o localStorage (stale) após F5 ou novo login.
      const obraId = state.get('obraAtivaId');
      if (obraId) {
        try {
          const [cfg, bms, itens] = await Promise.all([
            FirebaseService.getObraCfg(obraId).catch(() => null),
            FirebaseService.getBMs(obraId).catch(() => null),
            FirebaseService.getItens(obraId).catch(() => null),
          ]);
          if (cfg)                   state.set('cfg',           cfg);
          if (bms   && bms.length)   state.set('bms',           bms);
          if (itens && itens.length) state.set('itensContrato', itens);

          // Restaura a logo da obra: `logoBase64` é volátil e só era preenchido
          // no upload, então a logo sumia dos impressos após qualquer recarga.
          if (cfg?.logo && !state.get('logoBase64')) state.set('logoBase64', cfg.logo);

          await this._sincronizarValorContratual();

          // FIX-5: pré-carrega todas as medições no cache em memória imediatamente
          // após o login, para que dashboards e KPIs estejam corretos sem que o
          // usuário precise entrar individualmente em cada BM.
          if (bms && bms.length) {
            try {
              const { _injetarCacheMedicoes } = await import('../modules/boletim-medicao/bm-calculos.js');
              await Promise.all(
                bms.map(bm =>
                  FirebaseService.getMedicoes(obraId, bm.num)
                    .then(med => {
                      if (med && Object.keys(med).length > 0) {
                        _injetarCacheMedicoes(obraId, bm.num, med);
                      }
                    })
                    .catch(() => {})
                )
              );
              logger.info('App', `✅ Medições pré-carregadas para obra "${obraId}" (${bms.length} BMs).`);
            } catch (ePreload) {
              console.warn('[App] auth:login — erro ao pré-carregar medições:', ePreload);
            }
          }

          EventBus.emit('obra:selecionada', { obraId });
          logger.info('App', `✅ Dados da obra ativa "${obraId}" sincronizados do Firebase.`);
        } catch (e) {
          console.warn('[App] auth:login — erro ao sincronizar obra ativa:', e);
        }
      }
    }, 'app:login');
  }

  _initState() {
    state.hydrate(['obraAtivaId']);
    window.R$          = v     => formatters.currency(v);
    window.fmtNum      = (v,d) => formatters.number(v, d);
    window.n4          = v     => formatters.n4(v);
    window.pct         = v     => formatters.percent(v);
    window.formatarData= iso   => formatters.date(iso);
    window.HOJE        = new Date();
    logger.info('App', '✅ State e formatters OK.');
    // ── Auto-save global ──────────────────────────────────────
    initAutoSave();
    logger.info('App', '✅ AutoSave inicializado.');
  }

  async _initFirebase() {
    await window._firebaseSDKReady;
    FirebaseService.init();
    logger.info('App', '✅ FirebaseService OK.');

    // ── Detecta IndexedDB bloqueado (Opera GX / modo privado / GX Cleaner) ──
    // Firebase v9/v10 usa IndexedDB para persistir a sessão de Auth.
    // Se o browser bloquear o IndexedDB, o usuário parece "deslogado" mesmo
    // tendo feito login antes — o banco aparece vazio sem nenhum erro visível.
    const idbDisponivel = await new Promise(resolve => {
      try {
        if (typeof indexedDB === 'undefined' || indexedDB === null) { resolve(false); return; }
        const req = indexedDB.open('_fo_idb_check', 1);
        const t = setTimeout(() => resolve(false), 1500);
        req.onsuccess = () => {
          clearTimeout(t);
          try { req.result.close(); indexedDB.deleteDatabase('_fo_idb_check'); } catch {}
          resolve(true);
        };
        req.onerror   = () => { clearTimeout(t); resolve(false); };
        req.onblocked = () => { clearTimeout(t); resolve(false); };
      } catch { resolve(false); }
    });

    if (!idbDisponivel) {
      console.warn('[Boot] ⚠️ IndexedDB bloqueado — Opera GX ou modo privado detectado. Sessão Firebase não pode ser restaurada automaticamente.');
      // Aviso visual persistente para o usuário entender o problema
      safeExecuteSync(() => {
        window.toast?.(
          '⚠️ Seu browser está bloqueando o armazenamento local (IndexedDB). No Opera GX: desative o GX Cleaner para este site ou use o modo normal (não privado). Você precisará fazer login novamente.',
          'warn', 12000
        );
      }, { source: 'boot:idb-warn', silent: true });
    }

    // Aguarda o Firebase resolver quem está autenticado (até 6s).
    // Firebase v9/v10 armazena a sessão no IndexedDB e dispara
    // onAuthStateChanged com null primeiro, depois com o usuário real.
    // NÃO cancelamos o listener na chamada null — esperamos o user real
    // ou o timeout de 6s antes de prosseguir.
    if (window.firebase && window.firebase.apps && window.firebase.apps.length > 0) {
      await new Promise(resolve => {
        try {
          let timer;
          const unsub = window.firebase.auth().onAuthStateChanged(user => {
            if (user) {
              clearTimeout(timer);
              unsub();
              resolve(user);
            }
            // null = Firebase ainda não terminou de ler o IndexedDB, aguarda
          });
          // Se IndexedDB bloqueado, o Firebase nunca vai retornar usuário — timeout reduzido
          timer = setTimeout(() => { unsub(); resolve(null); }, idbDisponivel ? 6000 : 2000);
        } catch(e) { resolve(null); }
      });
    }
  }

  // ── Handlers da index.html via EventDelegate (substitui onclick inline) ──
  _registerIndexHandlers() {
    EventDelegate.registerAll({
      // Login
      // CORREÇÃO v15.3: EventDelegate chama window._loginAction (definido em _initLogin)
      // A versão anterior chamava this._handleLogin() que não existe como método de classe.
      '_loginAction':         ()        => safeExecuteSync(() => window._loginAction?.(),     { source: 'login:action' }),
      // '_loginGoogle' removido em 13/08/2026 junto com o provedor Google.
      '_toggleSalvar':        ()        => safeExecuteSync(() => window._toggleSalvar?.(),     { source: 'login:toggle' }),
      '_abaLogin':            (aba)     => safeExecuteSync(() => window._abaLogin?.(aba),      { source: 'login:aba' }),
      '_abrirConfigFirebase': ()        => safeExecuteSync(() => window._abrirConfigFirebase?.(), { source: 'login:cfg' }),
      '_modoOffline':         ()        => safeExecuteSync(() => window._modoOffline?.(),      { source: 'login:offline' }),

      // LGPD
      '_lgpdAceitar':          ()       => window._lgpdAceitar?.(),
      '_lgpdVerPolitica':      ()       => window._lgpdVerPolitica?.(),
      '_lgpdFecharPolitica':   ()       => { const el = document.getElementById('lgpd-politica-overlay'); if (el) el.style.display = 'none'; },

      // Navegação global
      'verPagina':             (pg)     => safeExecuteSync(() => window.verPagina?.(pg),       { source: 'nav:verPagina' }),

      // Config
      'salvarConfig':          ()       => safeExecuteSync(() => window.salvarConfig?.(),      { source: 'cfg:salvar' }),
      'removerLogo':           ()       => safeExecuteSync(() => window.removerLogo?.(),       { source: 'cfg:removerLogo' }),
      'adicionarBM':           ()       => safeExecuteSync(() => window.adicionarBM?.(),       { source: 'cfg:adicionarBM' }),
      'salvarFirebaseConfig':  ()       => safeExecuteSync(() => window.salvarFirebaseConfig?.(), { source: 'cfg:firebase' }),
      'testarFirebase':        ()       => safeExecuteSync(() => window.testarFirebase?.(),    { source: 'cfg:testarFirebase' }),
      'exportarDocumentacaoObra': ()    => safeExecuteSync(() => window.exportarDocumentacaoObra?.(), { source: 'cfg:exportar' }),
      'renderAuditLog':        ()       => safeExecuteSync(() => window.renderAuditLog?.(),    { source: 'cfg:auditLog' }),
      'exportarCSVAudit':      ()       => safeExecuteSync(() => window.exportarCSVAudit?.(),  { source: 'cfg:exportAudit' }),
      '_cfgRenderLixeira':     ()       => safeExecuteSync(() => window._cfgRenderLixeira?.(), { source: 'cfg:lixeira' }),
      '_cfgClickLogoInput':    ()       => document.getElementById('logoInput')?.click(),

      // Boletim
      'abrirCrudItemBM':       (m, id)  => safeExecuteSync(() => window.abrirCrudItemBM?.(m, id), { source: 'bm:crud' }),
      'abrirCrudMacroItem':    ()       => safeExecuteSync(() => window.abrirCrudMacroItem?.(), { source: 'bm:macro' }),
      '_bmSalvarItem':         (m, id)  => safeExecuteSync(() => window._bmSalvarItem?.(m, id),   { source: 'bm:salvarItem' }),
      '_bmToggleAgregador':    (v)      => safeExecuteSync(() => window._bmToggleAgregador?.(v),  { source: 'bm:toggleAgr' }),
      '_bmAgrExcluirFilho':    (id)     => safeExecuteSync(() => window._bmAgrExcluirFilho?.(id), { source: 'bm:agrFilho' }),
      '_bmSalvarPagamento':    (n)      => safeExecuteSync(() => window._bmSalvarPagamento?.(n),  { source: 'bm:pagamento' }),
      'salvarMedicaoBol':      ()       => safeExecuteSync(() => window.salvarMedicaoBol?.(),   { source: 'bm:salvarBol' }),
      'marcarSalvoBol':        ()       => safeExecuteSync(() => window.marcarSalvoBol?.(),      { source: 'bm:marcarBol' }),
      'desmarcarSalvoBol':     ()       => safeExecuteSync(() => window.desmarcarSalvoBol?.(),   { source: 'bm:desmarcarBol' }),
      'salvarMedicaoMem':      ()       => safeExecuteSync(() => window.salvarMedicaoFormal?.(), { source: 'mem:salvar' }),
      'marcarSalvoMem':        ()       => safeExecuteSync(() => window.marcarSalvoMem?.(),      { source: 'mem:marcar' }),
      'desmarcarSalvoMem':     ()       => safeExecuteSync(() => window.desmarcarSalvoMem?.(),   { source: 'mem:desmarcar' }),
      'imprimirBoletim':       ()       => safeExecuteSync(() => window.imprimirBoletim?.(),   { source: 'bm:imprimir' }),
      'exportarCSVBoletim':    ()       => safeExecuteSync(() => window.exportarCSVBoletim?.(), { source: 'bm:csv' }),
      'exportarCSVRegistroBMs':()       => safeExecuteSync(() => window.exportarCSVRegistroBMs?.(), { source: 'bm:csvReg' }),
      'imprimirRegistroBMs':   ()       => safeExecuteSync(() => window.imprimirRegistroBMs?.(), { source: 'bm:impReg' }),
      // Memória de Cálculo — fórmula especial
      '_mfxFechar':            ()       => safeExecuteSync(() => window._mfxFechar?.(),          { source: 'mem:mfxFechar' }),
      '_mfxInserir':           (f)      => safeExecuteSync(() => window._mfxInserir?.(f),        { source: 'mem:mfxInserir' }),
      '_mfxRemover':           (i)      => safeExecuteSync(() => window._mfxRemover?.(i),        { source: 'mem:mfxRemover' }),
      '_mfxSalvar':            ()       => safeExecuteSync(() => window._mfxSalvar?.(),          { source: 'mem:mfxSalvar' }),
      // Relatório
      'imprimirRelatorio':     ()       => safeExecuteSync(() => window.imprimirRelatorio?.(),   { source: 'rel:imprimir' }),
      'limparFiltroRelatorio': ()       => safeExecuteSync(() => window.limparFiltroRelatorio?.(),{ source: 'rel:limpar' }),
      // Notificações
      'adicionarNotificacao':  ()       => safeExecuteSync(() => window.adicionarNotificacao?.(),{ source: 'notif:adicionar' }),
      'limparFiltroNotif':     ()       => safeExecuteSync(() => window.limparFiltroNotif?.(),   { source: 'notif:limpar' }),
      'gerarPDFNotificacoes':  ()       => safeExecuteSync(() => window.gerarPDFNotificacoes?.(),{ source: 'notif:pdf' }),
      '_bmImportarAnterior':   ()       => safeExecuteSync(() => {
        const bm = parseInt(document.getElementById('sel-bol-bm')?.value || 1) - 1;
        window.importarBmAnterior?.(bm);
      }, { source: 'bm:importarAnterior' }),
      '_memImportarBmAnterior':()       => safeExecuteSync(() => {
        const bm = parseInt(document.getElementById('sel-mem-bm')?.value || 1);
        window.importarBmAnterior?.(bm);
      }, { source: 'mem:importarAnterior' }),

      // Diagnóstico
      'diagnostico':           ()       => safeExecuteSync(() => window.verPagina?.('diagnostico'), { source: 'nav:diag' }),
      '_FO_diagRefresh':       ()       => window._FO_diag?.refresh(),
      '_FO_diagDownload':      ()       => window._FO_diag?.downloadLogs(),
      '_FO_diagClear':         ()       => window._FO_diag?.clearLogs(),

      // Aditivos — fechar modais (substituem onclick com document.getElementById)
      '_adtFecharViewModal':   ()       => { const el = document.getElementById('adt-view-modal-overlay'); if (el) el.style.display = 'none'; },
      '_adtFecharVersaoModal': ()       => { const el = document.getElementById('adt-versao-modal-overlay'); if (el) el.style.display = 'none'; },
      '_adtFecharModal':       ()       => safeExecuteSync(() => window._adtFecharModal?.(), { source: 'adt:fechar' }),
      '_adtFecharPlanilhaEditor': ()    => safeExecuteSync(() => window._adtFecharPlanilhaEditor?.(), { source: 'adt:fecharPlanilha' }),

      // Aditivos Contratuais — CRUD principal
      '_adtSalvar':                ()       => safeExecuteSync(() => window._adtSalvar?.(),                   { source: 'adt:salvar' }),
      '_adtEditar':                (id)     => safeExecuteSync(() => window._adtEditar?.(id),                 { source: 'adt:editar' }),
      '_adtExcluir':               (id)     => safeExecuteSync(() => window._adtExcluir?.(id),                { source: 'adt:excluir' }),
      '_adtVerPlanilha':           (id)     => safeExecuteSync(() => window._adtVerPlanilha?.(id),            { source: 'adt:verPlanilha' }),
      '_adtVerVersao':             (n)      => safeExecuteSync(() => window._adtVerVersao?.(n),               { source: 'adt:verVersao' }),
      '_adtGerarPDF':              ()       => safeExecuteSync(() => window._adtGerarPDF?.(),                 { source: 'adt:pdf' }),
      // Aditivos — editor de planilha (BUG-FIX: estava ausente do registerAll, causando
      // "Action não tem handler registrado" ao clicar em "Editar Planilha do Aditivo")
      '_adtAbrirPlanilhaEditor':   ()       => safeExecuteSync(() => window._adtAbrirPlanilhaEditor?.(),      { source: 'adt:abrirPlanilha' }),
      '_adtPlanilhaReset':         ()       => safeExecuteSync(() => window._adtPlanilhaReset?.(),            { source: 'adt:planilhaReset' }),
      '_adtPlanilhaAplicar':       ()       => safeExecuteSync(() => window._adtPlanilhaAplicar?.(),          { source: 'adt:planilhaAplicar' }),
      '_adtPlanilhaAdicionarItem': ()       => safeExecuteSync(() => window._adtPlanilhaAdicionarItem?.(),    { source: 'adt:planilhaAdd' }),
      '_adtPlanilhaRemover':       (i)      => safeExecuteSync(() => window._adtPlanilhaRemover?.(i),         { source: 'adt:planilhaRemover' }),
      '_adtPlanilhaRestaurar':     (i)      => safeExecuteSync(() => window._adtPlanilhaRestaurar?.(i),       { source: 'adt:planilhaRestaurar' }),
      // Aditivos — modal de novo item na planilha
      '_adtNovoItemFechar':        ()       => safeExecuteSync(() => window._adtNovoItemFechar?.(),           { source: 'adt:novoItemFechar' }),
      '_adtNovoItemConfirmar':     ()       => safeExecuteSync(() => window._adtNovoItemConfirmar?.(),        { source: 'adt:novoItemConfirmar' }),

      // Boletim de Medição — fechar modais
      '_bmFecharItemModal':    ()       => {
        document.getElementById('bm-item-modal-overlay')?.remove();
        document.getElementById('bm-item-modal')?.remove();
      },
      '_bmFecharMacroModal':   ()       => {
        document.getElementById('bm-macro-modal-overlay')?.remove();
        document.getElementById('bm-macro-modal')?.remove();
      },
      'editarAgregadorBM':     (t, id)  => safeExecuteSync(() => window.editarAgregadorBM?.(t, id),   { source: 'bm:editarAgr' }),
      'excluirAgregadorBM':    (id)     => safeExecuteSync(() => window.excluirAgregadorBM?.(id),      { source: 'bm:excluirAgr' }),
      'editarMacroItem':       (id)     => safeExecuteSync(() => window.editarMacroItem?.(id),          { source: 'bm:editarMacro' }),
      'reverterMacroItem':     (id)     => safeExecuteSync(() => window.reverterMacroItem?.(id),        { source: 'bm:reverterMacro' }),
      'excluirMacroItem':      (id)     => safeExecuteSync(() => window.excluirMacroItem?.(id),         { source: 'bm:excluirMacro' }),
      'excluirItemBM':         (id)     => safeExecuteSync(() => window.excluirItemBM?.(id),            { source: 'bm:excluirItem' }),
      '_macroSalvarEdicao':    (id)     => safeExecuteSync(() => window._macroSalvarEdicao?.(id),       { source: 'bm:macroSalvar' }),
      '_bmCaixaAplicarPct':    (id, v)  => safeExecuteSync(() => window._bmCaixaAplicarPct?.(id, v),   { source: 'bm:caixaPct' }),
      '_bmCaixaAbrirMemoria':  (id)     => safeExecuteSync(() => window._bmCaixaAbrirMemoria?.(id),     { source: 'bm:caixaMem' }),
      '_memCaixaRemoverLinha': (idx)    => safeExecuteSync(() => window._memCaixaRemoverLinha?.(idx),   { source: 'bm:memCaixaRemover' }),

      // Dashboard — abas, gráficos, alertas
      '_dashTab':              (t)      => safeExecuteSync(() => window._dashTab?.(t),               { source: 'dash:tab' }),
      '_dashGerarPDF':         ()       => safeExecuteSync(() => window._dashGerarPDF?.(),            { source: 'dash:pdf' }),
      '_dashGerarPDFContratual':()      => safeExecuteSync(() => window._dashGerarPDFContratual?.(),  { source: 'dash:pdfCont' }),
      '_dashAlerta':           (a)      => safeExecuteSync(() => window._dashAlerta?.(a),             { source: 'dash:alerta' }),
      '_alertaConfig':         ()       => safeExecuteSync(() => window._alertaConfig?.(),            { source: 'dash:alertaCfg' }),
      '_alertaAtualizar':      ()       => safeExecuteSync(() => window._alertaAtualizar?.(),         { source: 'dash:alertaAtt' }),
      '_dashMudarStatus':      (v)      => safeExecuteSync(() => window._dashMudarStatus?.(v),        { source: 'dash:status' }),
      '_dashDetalheBM':        (n)      => safeExecuteSync(() => window._dashDetalheBM?.(n),          { source: 'dash:detalhe' }),
      '_dashAnalyticsAba':     ()       => safeExecuteSync(() => window._dashAnalyticsAba?.(),        { source: 'dash:analytics' }),
      '_dashFecharDetalhe':    ()       => { const el = document.getElementById('dash-bm-detalhe'); if (el) el.style.display = 'none'; },

      // Fiscal de Obras
      '_fo_aba':               (a)      => safeExecuteSync(() => window._fo_aba?.(a),               { source: 'fo:aba' }),
      '_fo_fecharModal':       ()       => safeExecuteSync(() => window._fo_fecharModal?.(),         { source: 'fo:fechar' }),
      '_fo_abrirVisita':       (id)     => safeExecuteSync(() => window._fo_abrirVisita?.(id),       { source: 'fo:abrirVisita' }),
      '_fo_salvarVisita':      ()       => safeExecuteSync(() => window._fo_salvarVisita?.(),        { source: 'fo:salvarVisita' }),
      '_fo_excluirVisita':     (id)     => safeExecuteSync(() => window._fo_excluirVisita?.(id),     { source: 'fo:excluirVisita' }),
      '_fo_abrirFiscal':       (id)     => safeExecuteSync(() => window._fo_abrirFiscal?.(id),       { source: 'fo:abrirFiscal' }),
      '_fo_salvarFiscal':      ()       => safeExecuteSync(() => window._fo_salvarFiscal?.(),        { source: 'fo:salvarFiscal' }),
      '_fo_excluirFiscal':     (id)     => safeExecuteSync(() => window._fo_excluirFiscal?.(id),     { source: 'fo:excluirFiscal' }),

      // Diário de Obras
      '_diario_abrirForm':         (id)     => safeExecuteSync(() => window._diario_abrirForm?.(id),          { source: 'diario:abrir' }),
      '_diario_fecharForm':        ()       => safeExecuteSync(() => window._diario_fecharForm?.(),           { source: 'diario:fechar' }),
      '_diario_salvarForm':        ()       => safeExecuteSync(() => window._diario_salvarForm?.(),           { source: 'diario:salvar' }),
      '_diario_excluir':           (id)     => safeExecuteSync(() => window._diario_excluir?.(id),            { source: 'diario:excluir' }),
      '_diario_gerarPDFEntrada':   (id)     => safeExecuteSync(() => window._diario_gerarPDFEntrada?.(id),    { source: 'diario:pdf' }),
      '_diarioCapturaCamera':      ()       => safeExecuteSync(() => window._diarioCapturaCamera?.(),         { source: 'diario:camera' }),
      '_diarioCapturarGPS':        ()       => safeExecuteSync(() => window._diarioCapturarGPS?.(),           { source: 'diario:gps' }),
      '_diarioRemoverFoto':        (idx)    => safeExecuteSync(() => window._diarioRemoverFoto?.(idx),        { source: 'diario:removerFoto' }),
      '_diarioVerFoto':            (id, i)  => safeExecuteSync(() => window._diarioVerFoto?.(id, i),          { source: 'diario:verFoto' }),
      '_diarLBNav':                (dir)    => safeExecuteSync(() => window._diarLBNav?.(dir),                { source: 'diario:lbNav' }),
      'gerarPDFDiario':            ()       => safeExecuteSync(() => window.gerarPDFDiario?.(),               { source: 'diario:gerarPDF' }),
      'exportarCSVDiario':         ()       => safeExecuteSync(() => window.exportarCSVDiario?.(),            { source: 'diario:csv' }),

      // Ocorrências
      '_oc_abrirForm':             (id)     => safeExecuteSync(() => window._oc_abrirForm?.(id),              { source: 'oc:abrir' }),
      '_oc_fecharForm':            ()       => safeExecuteSync(() => window._oc_fecharForm?.(),               { source: 'oc:fechar' }),
      '_oc_salvarForm':            ()       => safeExecuteSync(() => window._oc_salvarForm?.(),               { source: 'oc:salvar' }),
      '_oc_excluir':               (id)     => safeExecuteSync(() => window._oc_excluir?.(id),                { source: 'oc:excluir' }),
      '_ocCapturaCamera':          ()       => safeExecuteSync(() => window._ocCapturaCamera?.(),             { source: 'oc:camera' }),
      '_ocCapturarGPS':            ()       => safeExecuteSync(() => window._ocCapturarGPS?.(),               { source: 'oc:gps' }),
      '_ocRemoverFoto':            (idx)    => safeExecuteSync(() => window._ocRemoverFoto?.(idx),            { source: 'oc:removerFoto' }),

      // Notificações
      '_notif_nova':               ()       => safeExecuteSync(() => window._notif_nova?.(),                  { source: 'notif:nova' }),
      '_notif_editar':             (id)     => safeExecuteSync(() => window._notif_editar?.(id),              { source: 'notif:editar' }),
      '_notif_excluir':            (id)     => safeExecuteSync(() => window._notif_excluir?.(id),             { source: 'notif:excluir' }),
      '_notif_salvarForm':         ()       => safeExecuteSync(() => window._notif_salvarForm?.(),            { source: 'notif:salvar' }),
      '_notif_voltarPainel':       ()       => safeExecuteSync(() => window._notif_voltarPainel?.(),          { source: 'notif:voltar' }),
      '_notif_verDetalhe':         (id)     => safeExecuteSync(() => window._notif_verDetalhe?.(id),          { source: 'notif:detalhe' }),
      '_notif_gerarPDF':           (id)     => safeExecuteSync(() => window._notif_gerarPDF?.(id),            { source: 'notif:gerarPDF' }),
      '_notif_relatorio':          ()       => safeExecuteSync(() => window._notif_relatorio?.(),             { source: 'notif:relatorio' }),
      '_notif_mudarStatus':        (id)     => safeExecuteSync(() => window._notif_mudarStatus?.(id),         { source: 'notif:status' }),
      '_notif_salvarResposta':     (id)     => safeExecuteSync(() => window._notif_salvarResposta?.(id),      { source: 'notif:resposta' }),
      '_notif_addHistorico':       (id)     => safeExecuteSync(() => window._notif_addHistorico?.(id),        { source: 'notif:historico' }),
      '_notif_limparFiltros':      ()       => safeExecuteSync(() => window._notif_limparFiltros?.(),         { source: 'notif:limpar' }),

      // Sanções Administrativas
      '_sancNovaForm':             ()       => safeExecuteSync(() => window._sancNovaForm?.(),                { source: 'sanc:nova' }),
      '_sancEditar':               (id)     => safeExecuteSync(() => window._sancEditar?.(id),                { source: 'sanc:editar' }),
      '_sancExcluir':              (id)     => safeExecuteSync(() => window._sancExcluir?.(id),               { source: 'sanc:excluir' }),
      '_sancCancelar':             ()       => safeExecuteSync(() => window._sancCancelar?.(),                { source: 'sanc:cancelar' }),
      '_sancSalvarForm':           (id)     => safeExecuteSync(() => window._sancSalvarForm?.(id),            { source: 'sanc:salvar' }),
      '_sancToggleValor':          ()       => safeExecuteSync(() => window._sancToggleValor?.(),             { source: 'sanc:toggle' }),
      '_integPDFSancao':           (id)     => safeExecuteSync(() => window._integPDFSancao?.(id),            { source: 'sanc:pdf' }),

      // Responsáveis Técnicos
      '_respNovoForm':             ()       => safeExecuteSync(() => window._respNovoForm?.(),                { source: 'resp:novo' }),
      '_respEditar':               (id)     => safeExecuteSync(() => window._respEditar?.(id),                { source: 'resp:editar' }),
      '_respExcluir':              (id)     => safeExecuteSync(() => window._respExcluir?.(id),               { source: 'resp:excluir' }),
      '_respCancelarForm':         ()       => safeExecuteSync(() => window._respCancelarForm?.(),            { source: 'resp:cancelar' }),
      '_respSalvarForm':           (id)     => safeExecuteSync(() => window._respSalvarForm?.(id),            { source: 'resp:salvar' }),

      // Controle de Prazos
      '_prazoTab':                 (tab)    => safeExecuteSync(() => window._prazoTab?.(tab),                 { source: 'prazo:tab' }),
      '_prazoNovaProrr':           ()       => safeExecuteSync(() => window._prazoNovaProrr?.(),              { source: 'prazo:nova' }),
      '_prazoEditarProrr':         (id)     => safeExecuteSync(() => window._prazoEditarProrr?.(id),          { source: 'prazo:editar' }),
      '_prazoExcluirProrr':        (id)     => safeExecuteSync(() => window._prazoExcluirProrr?.(id),         { source: 'prazo:excluir' }),
      '_prazoSalvarProrr':         (id)     => safeExecuteSync(() => window._prazoSalvarProrr?.(id),          { source: 'prazo:salvar' }),
      '_prazoCancelarForm':        ()       => { const el = document.getElementById('prazo-form-wrap'); if (el) el.innerHTML = ''; },

      // Prazos — Cronograma
      '_cronNovaAtividade':        ()       => safeExecuteSync(() => window._cronNovaAtividade?.(),           { source: 'cron:nova' }),
      '_cronEditarAtividade':      (id)     => safeExecuteSync(() => window._cronEditarAtividade?.(id),       { source: 'cron:editar' }),
      '_cronExcluirAtividade':     (id)     => safeExecuteSync(() => window._cronExcluirAtividade?.(id),      { source: 'cron:excluir' }),
      '_cronSalvarAtividade':      (id)     => safeExecuteSync(() => window._cronSalvarAtividade?.(id),       { source: 'cron:salvar' }),
      '_cronCancelarForm':         ()       => { const el = document.getElementById('cron-form-wrap'); if (el) el.innerHTML = ''; },

      // Matriz de Riscos
      '_riscoNovoForm':            ()       => safeExecuteSync(() => window._riscoNovoForm?.(),               { source: 'risco:novo' }),
      '_riscoEditar':              (id)     => safeExecuteSync(() => window._riscoEditar?.(id),               { source: 'risco:editar' }),
      '_riscoExcluir':             (id)     => safeExecuteSync(() => window._riscoExcluir?.(id),              { source: 'risco:excluir' }),
      '_riscoCancelar':            ()       => safeExecuteSync(() => window._riscoCancelar?.(),               { source: 'risco:cancelar' }),
      '_riscoSalvarForm':          (id)     => safeExecuteSync(() => window._riscoSalvarForm?.(id),           { source: 'risco:salvar' }),

      // Aditivos Contratuais — handlers de cálculo e status (complementam os já registrados)
      '_adtCalcVariacao':          ()       => safeExecuteSync(() => window._adtCalcVariacao?.(),             { source: 'adt:calcVar' }),
      '_adtCalcTermino':           ()       => safeExecuteSync(() => window._adtCalcTermino?.(),              { source: 'adt:calcTerm' }),
      '_adtOnStatusChange':        (v)      => safeExecuteSync(() => window._adtOnStatusChange?.(v),          { source: 'adt:status' }),
      '_adtPlanilhaEditQtd':       (i, v)   => safeExecuteSync(() => window._adtPlanilhaEditQtd?.(i, v),     { source: 'adt:editQtd' }),
      '_adtPlanilhaEditUp':        (i, v)   => safeExecuteSync(() => window._adtPlanilhaEditUp?.(i, v),      { source: 'adt:editUp' }),
      '_adtPlanilhaEditDesc':      (i, v)   => safeExecuteSync(() => window._adtPlanilhaEditDesc?.(i, v),    { source: 'adt:editDesc' }),
      'abrirModalNovoAditivo':     ()       => safeExecuteSync(() => window.abrirModalNovoAditivo?.(),        { source: 'adt:novo' }),

      // Painel Contratual
      'imprimirPainelContratual':  ()       => safeExecuteSync(() => window.imprimirPainelContratual?.(),     { source: 'painel:pdf' }),
      'exportarCSVPainelContratual':()      => safeExecuteSync(() => window.exportarCSVPainelContratual?.(),  { source: 'painel:csv' }),

      // Memória de Cálculo — ações de topo
      'renderMemoria':             ()       => safeExecuteSync(() => window.renderMemoria?.(),                { source: 'mem:render' }),
      'imprimirMemoria':           ()       => safeExecuteSync(() => window.imprimirMemoria?.(),              { source: 'mem:imprimir' }),
      'exportarCSVMemoria':        ()       => safeExecuteSync(() => window.exportarCSVMemoria?.(),           { source: 'mem:csv' }),

      // Quadro de Chuvas
      'imprimirChuva':            ()       => safeExecuteSync(() => window.imprimirChuva?.(),                          { source: 'chuva:pdf' }),
      'exportarCSVChuva':         ()       => safeExecuteSync(() => window.exportarCSVChuva?.(),                       { source: 'chuva:csv' }),
      '_chuva_fecharModal':       ()       => safeExecuteSync(() => window._chuva_fecharModal?.(),                     { source: 'chuva:fechar' }),
      '_chuva_limparDia':         ()       => safeExecuteSync(() => window._chuva_limparDia?.(),                       { source: 'chuva:limpar' }),
      '_chuva_selecionarPeriodo': (p, k)   => safeExecuteSync(() => window._chuva_selecionarPeriodo?.(p, k),          { source: 'chuva:periodo' }),

      // Relatório Mensal
      'exportarCSVRelatorio':      ()       => safeExecuteSync(() => window.exportarCSVRelatorio?.(),         { source: 'rel:csv' }),

      // ── Controles do index.html que eram onchange/oninput inline ────────
      // Não funcionavam em produção: o CSP do hosting traz script-src sem
      // 'unsafe-inline', então o navegador bloqueava o handler do atributo.
      // Trocar de BM, filtrar relatório/notificações por data, ver a prévia
      // da fórmula especial e enviar o logo dependiam disso.
      'renderBoletim':             ()       => safeExecuteSync(() => window.renderBoletim?.(),                { source: 'bm:trocarBM' }),
      'renderRelatorio':           ()       => safeExecuteSync(() => window.renderRelatorio?.(),              { source: 'rel:filtro' }),
      'renderNotificacoes':        ()       => safeExecuteSync(() => window.renderNotificacoes?.(),           { source: 'notif:filtro' }),
      // Botão existia no index.html com data-action, mas sem handler aqui —
      // o EventDelegate só logava "Action não tem handler registrado".
      'exportarCSVNotificacoes':   ()       => safeExecuteSync(() => window.exportarCSVNotificacoes?.(),      { source: 'notif:csv' }),
      '_mfxRecalc':                ()       => safeExecuteSync(() => window._mfxRecalc?.(),                   { source: 'mem:mfxRecalc' }),
      'carregarLogo':              (ev)     => safeExecuteSync(() => window.carregarLogo?.(ev),               { source: 'cfg:carregarLogo' }),

      // SINAPI — file input
      '_sinapiClickFileInput': ()       => document.getElementById('sinapi-file-input')?.click(),

      // Documentos — file input e filtro
      '_docClickFileInput':    ()       => document.getElementById('doc-file-input')?.click(),
      '_doc_filtroTipo':       (t)      => safeExecuteSync(() => window._doc_filtroTipo?.(t), { source: 'doc:filtro' }),

      // Ocorrências
      '_ocFotoClick':          ()       => document.getElementById('oc-foto-input')?.click(),
      '_integGerarNotifDeOc':  (id)     => safeExecuteSync(() => window._integGerarNotifDeOc?.(id), { source: 'oc:integ' }),

      // Fotos de medição
      '_fmFotoClick':          ()       => document.getElementById('fm-foto-input')?.click(),

      // Modo campo
      '_mcFotoOcClick':        ()       => document.getElementById('mc-foto-oc')?.click(),

      // Diário
      '_diarFotoClick':        ()       => document.getElementById('diar-foto-input')?.click(),
      '_diarFecharLightbox':   ()       => document.getElementById('diar-lightbox')?.remove(),

      // Importação
      '_importacaoClickFileInput': ()   => document.getElementById('si-file-input')?.click(),
      '_bmpdfClickInput':      ()       => document.getElementById('bmpdf-input')?.click(),

      // Notificações
      '_integGerarSancDeNotif': (id)    => safeExecuteSync(() => window._integGerarSancDeNotif?.(id), { source: 'notif:integ' }),

      // Obras Manager
      '_obm_selecionar':       (id)     => safeExecuteSync(() => window._obm_selecionar?.(id),       { source: 'obm:selecionar' }),
      '_obm_irAba':            (aba)    => safeExecuteSync(() => window._obm_irAba?.(aba),            { source: 'obm:irAba' }),
      '_obm_excluir':          (id, nm) => safeExecuteSync(() => window._obm_excluir?.(id, nm),       { source: 'obm:excluir' }),

      // Dash Global
      '_dgAbrirObra':          (id)     => safeExecuteSync(() => window._dgAbrirObra?.(id), { source: 'dg:abrir' }),
      '_dgTab':                (tab)    => safeExecuteSync(() => window._dgTab?.(tab),       { source: 'dg:tab' }),
      '_dgFiltro':             (c,v)    => safeExecuteSync(() => window._dgFiltro?.(c,v),    { source: 'dg:filtro' }),
      '_dgBusca':              (v)      => safeExecuteSync(() => window._dgBusca?.(v),        { source: 'dg:busca' }),
      '_dgLimparFiltros':      ()       => safeExecuteSync(() => window._dgLimparFiltros?.(), { source: 'dg:limpar' }),
      '_dgRecarregar':         ()       => safeExecuteSync(() => window._dgRecarregar?.(),    { source: 'dg:recarregar' }),

      // Sidebar
      '_sidebarToggleGroup':   (id)     => safeExecuteSync(() => window._sidebarToggleGroup?.(id), { source: 'sidebar:toggle' }),

      // Topbar
      '_logoutConfirm':        ()       => safeExecuteSync(() => window._logoutConfirm?.(), { source: 'topbar:logout' }),

      // Fallback UI — recarregar/reportar módulo com erro
      '_FO_reloadModule':      (id)     => safeExecuteSync(() => window._FO_reloadModule?.(id),  { source: 'fallback:reload' }),
      '_FO_reportModule':      (id)     => safeExecuteSync(() => window._FO_reportModule?.(id),  { source: 'fallback:report' }),

      // App — botão de recarga de emergência
      '_appReload':            ()       => location.reload(),

      // Config — handlers de exclusão e gerenciamento de BMs
      // (registrados como window.fn em config-controller._exposeGlobals,
      //  mas precisam estar aqui para que o EventDelegate os despache)
      '_cfgExcluirObra':              ()      => safeExecuteSync(() => window._cfgExcluirObra?.(),          { source: 'cfg:excluirObra' }),
      '_cfgSalvarStatus':             ()      => safeExecuteSync(() => window._cfgSalvarStatus?.(),         { source: 'cfg:salvarStatus' }),
      '_cfgEditarBM':                 (num)   => safeExecuteSync(() => window._cfgEditarBM?.(num),          { source: 'cfg:editarBM' }),
      '_cfgExcluirBM':                (num)   => safeExecuteSync(() => window._cfgExcluirBM?.(num),         { source: 'cfg:excluirBM' }),
      '_cfgLixeiraRestaurar':         (id)    => safeExecuteSync(() => window._cfgLixeiraRestaurar?.(id),    { source: 'cfg:lixeiraRestaurar' }),
      '_cfgLixeiraDeletarPermanente': (id)    => safeExecuteSync(() => window._cfgLixeiraDeletarPermanente?.(id), { source: 'cfg:lixeiraDeletar' }),

      // Importação — todos os handlers do módulo SmartImport
      // (_bindWindowGlobals define window.fn, mas EventDelegate precisa estar ciente)
      '_siSetTipoImportacao':         (t)     => safeExecuteSync(() => window._siSetTipoImportacao?.(t),    { source: 'si:setTipo' }),
      '_siSetModo':                   (m)     => safeExecuteSync(() => window._siSetModo?.(m),              { source: 'si:setModo' }),
      '_siAbaAtiva':                  (a)     => safeExecuteSync(() => window._siAbaAtiva?.(a),             { source: 'si:aba' }),
      '_siAplicarMapeamento':         ()      => safeExecuteSync(() => window._siAplicarMapeamento?.(),     { source: 'si:mapear' }),
      '_siVoltarUpload':              ()      => safeExecuteSync(() => window._siVoltarUpload?.(),          { source: 'si:voltar' }),
      '_siCriarObra':                 ()      => safeExecuteSync(() => window._siCriarObra?.(),             { source: 'si:criarObra' }),
      '_siExportarRelatorioPDF':      ()      => safeExecuteSync(() => window._siExportarRelatorioPDF?.(),  { source: 'si:exportarPDF' }),
    });

    // ── Ponte para os globais migrados dos handlers inline ────────────────
    //
    // Todo handler inline (onclick/onchange/oninput="window._x(...)") virou
    // data-action="_x", porque a CSP de produção não tem 'unsafe-inline' em
    // script-src e simplesmente não executava nenhum deles. Ver CHANGELOG
    // v15.5.5.
    //
    // Cada nome aqui vira uma ação que só repassa os argumentos ao global de
    // mesmo nome — é o que as entradas acima fazem uma a uma, escrito de uma
    // vez só. A LISTA É A LISTA DE PERMITIDOS: deliberadamente não existe um
    // fallback genérico para window[action], que transformaria um
    // data-action="eval" injetado em execução de código — exatamente o que a
    // CSP está ali para impedir.
    // O delegador chama handler(...dataArgs, event, el). _ponte repassa tudo,
    // então o global recebe (…args, event, el) — serve a quem já esperava o
    // event como primeiro parâmetro.
    const _ponte = (...nomes) => Object.fromEntries(nomes.map(nome => [
      nome,
      (...args) => safeExecuteSync(() => window[nome]?.(...args), { source: `acao:${nome}` }),
    ]));

    // Para quem recebia o elemento (o antigo onchange="window._x(this)").
    const _ponteEl = (...nomes) => Object.fromEntries(nomes.map(nome => [
      nome,
      (...args) => safeExecuteSync(() => window[nome]?.(args[args.length - 1]), { source: `acao:${nome}` }),
    ]));

    // Soltar arquivo: tira a moldura de destaque e repassa ao global do
    // módulo. O preventDefault aqui também importa — sem ele o browser abre
    // o arquivo solto numa aba, por cima do app.
    const _soltar = (nome, args) => {
      const event = args[args.length - 2];
      const el    = args[args.length - 1];
      event?.preventDefault?.();
      el?.classList?.remove('fo-drop-ativo');
      return safeExecuteSync(() => window[nome]?.(event, el), { source: `acao:${nome}` });
    };

    EventDelegate.registerAll(_ponte(
      // Aditivos
      '_adtNovoItemCalcTotal', '_adtNovoItemPreviewPosicao', '_adtOnReajusteIndice',
      '_adtOnTipoChange',
      // Boletim — espelho de preço unitário com/sem BDI
      '_bmItemSincronizaBdi',
      // Config
      '_cfgToggleCaixaCampos',
      // Checklist técnico
      '_ck_obs', '_ck_setData', '_ck_setFiscal', '_ck_setTipo',
      // Buscas e filtros de lista
      '_doc_busca', '_fm_filtrarItens', '_fm_filtro', '_hist_filtro',
      '_notif_filtro', '_obrc_busca', '_oc_filtro', '_oc_filtroTipo',
      '_qa_filtro', '_qa_filtroTipo', '_sidebarSearch',
      // Relatório
      '_rel_salvarObs',
      // Seleção de arquivo que o global já lia do event
      '_doc_fileSelected', '_siProcessarArquivo', '_bmpdfArquivo',
    ));

    // ── Ações que estavam no markup e NUNCA tiveram handler ──────────────
    //
    // Estes 52 nomes já apareciam como data-action no HTML gerado e os
    // módulos já criavam window._x correspondente — mas ninguém ligava os
    // dois. O EventDelegate achava o data-action, não achava handler,
    // escrevia "Action X não tem handler registrado" no console e devolvia
    // sem fazer nada. Na tela: botão que não responde ao clique, em
    // checklist técnico, documentos, fotos de medição, modo campo,
    // qualidade, recebimento, relatório, relatório federal, usuários,
    // acesso à obra, histórico, importação de BM em PDF e obras concluídas.
    //
    // Não tem relação com a CSP — apareceu ao cruzar os data-action do
    // markup com os handlers registrados, conferindo a migração dos
    // handlers inline.
    EventDelegate.registerAll(_ponte(
      '_acessoObra_atualizarLista', '_acessoObra_buscarEmail', '_acessoObra_conceder',
      '_acessoObra_revogar', '_bmpdfConfirmar', '_bmpdfLimpar',
      '_bmpdfSetModo', '_ck_abrirInspecao', '_ck_excluir',
      '_ck_fecharModal', '_ck_iniciarNova', '_ck_resp',
      '_ck_salvar', '_consultarObraConcluida', '_doc_abrirUpload',
      '_doc_excluir', '_doc_fecharModal', '_doc_salvar',
      '_fm_abrirCamera', '_fm_abrirForm', '_fm_capturarGPS',
      '_fm_excluir', '_fm_fecharForm', '_fm_salvarForm',
      '_hist_mais', '_integPDFRecebimento', '_mc_checkin',
      '_mc_diarioRapido', '_mc_fecharModal', '_mc_fotoRapida',
      '_mc_ocorrenciaRapida', '_mc_salvarDiario', '_mc_salvarOcorrencia',
      '_mc_setGrav', '_qa_abrirForm', '_qa_excluir',
      '_qa_fecharForm', '_qa_salvarForm', '_recebCancelar',
      '_recebEditar', '_recebExcluir', '_recebNovoForm',
      '_recebSalvarForm', '_rel_adicionarOcorrencia', '_rel_confirmarOcorrencia',
      '_rel_fecharModal', '_rf_gerarHTML', '_rf_imprimir',
      '_usr_adicionar', '_usr_editar', '_usr_excluir',
      '_usr_fecharModal',
    ));

    // Globais que esperam o próprio <input type="file">.
    EventDelegate.registerAll(_ponteEl(
      '_diarioAdicionarFotos', '_ocAdicionarFotos', '_fm_adicionarFoto',
      '_mc_previewFotoOc', '_sinapi_carregar',
    ));

    // ── Ações que precisam de forma própria ──────────────────────────────
    EventDelegate.registerAll({
      // Arrastar-soltar. dragover PRECISA de preventDefault, senão o browser
      // recusa o drop. A moldura de destaque é classe CSS: dragover e
      // dragleave não têm pseudo-classe para isso.
      '_dropZoneSobre': (...args) => {
        const event = args[args.length - 2];
        const el    = args[args.length - 1];
        event?.preventDefault?.();
        el?.classList?.add('fo-drop-ativo');
      },
      '_dropZoneSai': (...args) => {
        args[args.length - 1]?.classList?.remove('fo-drop-ativo');
      },

      // Enter no campo de e-mail do convite de acesso à obra.
      '_acessoObraEnter': (...args) => {
        const event = args[args.length - 2];
        if (event?.key === 'Enter') {
          safeExecuteSync(() => window._acessoObra_buscarEmail?.(), { source: 'acao:acessoObraEnter' });
        }
      },

      // Planilha de aditivos: o valor do campo chega como texto.
      '_adtPlanilhaEditQtd': (idx, valor) => safeExecuteSync(
        () => window._adtPlanilhaEditQtd?.(idx, parseFloat(valor) || 0),
        { source: 'acao:adtEditQtd' }),
      '_adtPlanilhaEditUp': (idx, valor) => safeExecuteSync(() => {
        // "R$ 1.234,56" → 1234.56
        const n = parseFloat(String(valor).replace(/[R$\s]/g, '').replace(/\./g, '').replace(',', '.')) || 0;
        window._adtPlanilhaEditUp?.(idx, n);
      }, { source: 'acao:adtEditUp' }),

      // Checklist do relatório: checkbox manda booleano, não texto.
      '_rel_checklist': (id, marcado) => safeExecuteSync(
        () => window._rel_checklist?.(id, marcado), { source: 'acao:relChecklist' }),

      // Nível de log do diagnóstico — método de objeto, não função solta.
      '_diagSetLogLevel': (nivel) => safeExecuteSync(
        () => window._FO_diag?.setLogLevel(nivel), { source: 'acao:diagLogLevel' }),

      // Busca global e alertas: também métodos de objeto.
      '_gsAtivarItem':   (idx) => safeExecuteSync(
        () => window.globalSearchService?._ativarItem(idx), { source: 'acao:gsAtivar' }),
      '_alertasLimpar':  ()    => safeExecuteSync(
        () => window.smartAlertsService?.limpar(), { source: 'acao:alertasLimpar' }),
      '_alertasFechar':  ()    => safeExecuteSync(
        () => window.smartAlertsService?._fecharPainel(), { source: 'acao:alertasFechar' }),

      // Abre o seletor de arquivo escondido da tela de importação.
      '_siAbrirSeletorArquivo': () => document.getElementById('si-file-input')?.click(),

      // Zonas de soltar: cada módulo tem o seu, e todas limpam a moldura.
      '_doc_handleDrop': (...args) => _soltar('_doc_handleDrop', args),
      '_siHandleDrop':   (...args) => _soltar('_siHandleDrop', args),
      '_bmpdfDrop':      (...args) => _soltar('_bmpdfDrop', args),

      // Fecha a faixa de aviso (era onclick="this.parentElement.remove()").
      '_foFecharAviso': (...args) => args[args.length - 1]?.parentElement?.remove(),

      // Seleciona o texto do campo ao focar (era onfocus="this.select()").
      '_foSelecionarTexto': (...args) => args[args.length - 1]?.select?.(),

      // Fecha o modal do checklist só quando o clique é no fundo, não no
      // conteúdo. No markup isto era data-action="if" com
      // data-arg0="event.target===this)window._ck_fecharModal(" — restos de
      // uma conversão anterior que picotou um onclick="if(...)" no meio.
      // Ação "if" nunca teve handler, então clicar no fundo não fechava nada.
      '_ck_fecharModalSeFundo': (...args) => {
        const event = args[args.length - 2];
        const el    = args[args.length - 1];
        if (event?.target === el) {
          safeExecuteSync(() => window._ck_fecharModal?.(), { source: 'acao:ckFecharFundo' });
        }
      },
    });
  }

  _setupGlobalListeners() {
    document.addEventListener('keydown', e => {
      safeExecuteSync(() => {
        if ((e.ctrlKey||e.metaKey) && e.key==='z' && !e.shiftKey) { e.preventDefault(); EventBus.emit('undo:desfazer',{}); }
        if ((e.ctrlKey||e.metaKey) && (e.key==='y'||(e.shiftKey&&e.key==='z'))) { e.preventDefault(); EventBus.emit('undo:refazer',{}); }
        if (e.key==='Escape') document.querySelectorAll('.modal-overlay.aberto').forEach(m=>m.classList.remove('aberto'));
      }, { source:'App:keydown', silent:true });
    });

    window.addEventListener('beforeunload', e => {
      if (window._dadosNaoSalvos) { e.preventDefault(); e.returnValue=''; }
    });

    EventBus.on('ui:toast',      ({ msg, tipo }) => safeExecuteSync(() => ToastComponent.show(msg, tipo), { source:'App:toast', silent:true }), 'app');
    EventBus.on('undo:desfazer', () => {
      if (state.undo()) ToastComponent.show('↩️ Ação desfeita.','info');
      else ToastComponent.show('ℹ️ Nenhuma ação para desfazer.','info');
    }, 'app');
    EventBus.on('undo:refazer',  () => {
      if (state.redo()) ToastComponent.show('↪️ Ação refeita.','info');
      else ToastComponent.show('ℹ️ Nenhuma ação para refazer.','info');
    }, 'app');

    EventBus.on('module:failed',    d => logger.error('App', `📦 module:failed → ${d.moduleId}`, d), 'app');
    EventBus.on('module:restarted', d => logger.info ('App', `📦 module:restarted → ${d.moduleId}`), 'app');

    // ── IndexedDB bloqueado (Opera GX / modo privado / GX Cleaner) ───────
    // Quando o Firebase detecta que o IndexedDB está inacessível, emite este
    // evento. Exibimos um banner fixo no topo explicando o problema ao usuário,
    // pois sem IndexedDB a sessão de Auth não é restaurada e os dados somem.
    EventBus.on('firebase:indexeddb-bloqueado', () => {
      safeExecuteSync(() => {
        const bannerId = 'fo-idb-banner';
        if (document.getElementById(bannerId)) return; // já exibido
        const banner = document.createElement('div');
        banner.id = bannerId;
        banner.setAttribute('role', 'alert');
        banner.style.cssText = [
          'position:fixed', 'top:0', 'left:0', 'right:0', 'z-index:99999',
          'background:#b45309', 'color:#fff', 'font-size:13px',
          'padding:10px 16px', 'display:flex', 'align-items:center',
          'gap:10px', 'box-shadow:0 2px 8px rgba(0,0,0,.35)',
        ].join(';');
        banner.innerHTML = `
          <span style="font-size:18px">⚠️</span>
          <span style="flex:1">
            <strong>Armazenamento local bloqueado</strong> — seu browser está impedindo o
            IndexedDB, necessário para manter a sessão e os dados do app.<br>
            <span style="opacity:.9;font-size:12px">
              <strong>Opera GX:</strong> desative o <em>GX Cleaner</em> para este site
              (Menu → GX Cleaner → Exceções) ou use o modo normal (não privado).
              <strong>Outros browsers:</strong> verifique as configurações de privacidade/cookies.
            </span>
          </span>
          <button data-action="_foFecharAviso" data-event="click"
            style="background:rgba(255,255,255,.25);border:none;color:#fff;
                   padding:4px 10px;border-radius:4px;cursor:pointer;font-size:12px">
            Fechar
          </button>`;
        document.body.prepend(banner);
        logger.warn('App', '⚠️ Banner IndexedDB bloqueado exibido ao usuário.');
      }, { source: 'App:idb-banner', silent: true });
    }, 'app');

    // FIX-3: quando o Firebase SDK carrega tarde (após o timeout de boot),
    // o auth:logout é emitido mas ninguém exibia a tela de login.
    // Este handler garante que o usuário veja o login sempre que necessário.
    EventBus.on('auth:logout', () => {
      // FIX-E1.2: reseta o flag para que o próximo login carregue os dados.
      this._loginHandled = false;

      // isReady é METHOD (a classe tem um getter e um método com o mesmo nome;
      // o método vence). Sem os parênteses isto era sempre truthy.
      const firebaseAtivo = FirebaseService.isReady();
      if (!firebaseAtivo) return; // modo offline genuíno — mantém app-shell

      const telaLogin = document.getElementById('tela-login');
      const shell     = document.getElementById('app-shell');

      // A condição `shell.style.display !== 'none'` estava aqui e abria o pior
      // buraco do sistema: no boot o #app-shell nasce com display:none, e o
      // onAuthStateChanged dispara com user=null ANTES de restaurar a sessão.
      // A guarda barrava a troca de tela, o shell aparecia depois assim mesmo,
      // e o usuário ficava operando DESLOGADO — lendo do cache do IndexedDB,
      // com toda gravação recusada pela regra estaAutenticado(). Foi assim que
      // um BM inteiro foi "criado" sem nunca chegar ao servidor.
      if (telaLogin && shell) {
        shell.style.display     = 'none';
        telaLogin.style.display = 'flex';
      }
    }, 'app:logout-guard');

    window.addEventListener('error', e => {
      if (e.filename?.includes('extension://')) return;
      logger.error('App:uncaught', e.message, { file: e.filename, line: e.lineno });
    });
    window.addEventListener('unhandledrejection', e => {
      logger.error('App:unhandledrejection', e.reason?.message || String(e.reason), { stack: e.reason?.stack });
    });

    // Inicia sistema de logout automático por inatividade (30 min)
    this._initAutoLogout();

    // Inicia modal e ação de logout manual
    this._initLogout();

    logger.debug('App', '✅ Listeners globais OK.');
  }

  // ═══════════════════════════════════════════════════════════════
  //  LOGOUT MANUAL — modal de confirmação + ação
  // ═══════════════════════════════════════════════════════════════
  _initLogout() {
    const overlay    = document.getElementById('logout-modal-overlay');
    const btnConfirm = document.getElementById('logout-modal-confirmar');
    const btnCancel  = document.getElementById('logout-modal-cancelar');
    const userLabel  = document.getElementById('logout-modal-user');

    // Abre o modal de confirmação
    window._logoutConfirm = () => {
      if (!overlay) { this._executarLogoutManual(); return; }
      const email = FirebaseService.currentUser()?.email || '';
      if (userLabel) userLabel.textContent = email ? `Você está logado como ${email}` : '';
      overlay.classList.add('aberto');
      btnConfirm?.focus();
    };

    // Confirma e executa o logout
    const _fechar = () => overlay?.classList.remove('aberto');

    btnConfirm?.addEventListener('click', async () => {
      btnConfirm.disabled = true;
      btnConfirm.textContent = 'Saindo…';
      await this._executarLogoutManual();
      btnConfirm.disabled = false;
      _fechar();
    });

    btnCancel?.addEventListener('click', _fechar);

    // ESC fecha o modal
    overlay?.addEventListener('click', (e) => { if (e.target === overlay) _fechar(); });
    document.addEventListener('keydown', (e) => { if (e.key === 'Escape') _fechar(); });
  }

  async _executarLogoutManual() {
    try {
      const shell = document.getElementById('app-shell');
      if (shell) shell.style.display = 'none';

      await FirebaseService.logout();

      const telaLogin = document.getElementById('tela-login');
      if (telaLogin) telaLogin.style.display = 'flex';

      // Limpa estado da sessão
      const erroEl = document.getElementById('login-erro');
      if (erroEl) { erroEl.textContent = ''; erroEl.style.display = 'none'; }

      // Pré-preenche o email se estava salvo
      try {
        const savedEmail = sessionStorage.getItem('fo_login_email');
        const emailEl = document.getElementById('login-email');
        if (savedEmail && emailEl) emailEl.value = savedEmail;
      } catch(e) {}

      logger.info('App', '👋 Logout manual executado.');
    } catch (err) {
      console.error('[App] Logout manual erro:', err);
      window.toast?.('Erro ao sair. Tente novamente.', 'erro');
    }
  }

  // ═══════════════════════════════════════════════════════════════
  //  AUTO-LOGOUT POR INATIVIDADE — 30 minutos
  // ═══════════════════════════════════════════════════════════════
  _initAutoLogout() {
    const INATIVIDADE_MS = 30 * 60 * 1000; // 30 minutos
    const AVISO_MS       = 29 * 60 * 1000; // Aviso 1 minuto antes
    let   _timer         = null;
    let   _timerAviso    = null;
    let   _ativo         = false;

    const _cancelarTimers = () => {
      if (_timer)       clearTimeout(_timer);
      if (_timerAviso)  clearTimeout(_timerAviso);
      _timer = null; _timerAviso = null;
    };

    const _executarLogout = async () => {
      try {
        // Só executa se houver usuário logado
        if (!FirebaseService.currentUser()) return;

        logger.info('App', '⏱️ Auto-logout por inatividade ativado.');
        _cancelarTimers();
        _ativo = false;

        // Esconde shell, mostra login com mensagem
        const shell = document.getElementById('app-shell');
        if (shell) shell.style.display = 'none';

        await FirebaseService.logout();

        const telaLogin = document.getElementById('tela-login');
        if (telaLogin) {
          telaLogin.style.display = 'flex';
          // Injeta mensagem de inatividade se o elemento de erro existir
          const erroEl = document.getElementById('login-erro');
          if (erroEl) {
            erroEl.innerHTML = '⏱️ Sessão encerrada automaticamente por inatividade.';
            erroEl.style.cssText = 'display:block;background:#fef3c7;border:1px solid #f59e0b;color:#92400e;padding:10px 14px;border-radius:8px;font-size:12px;font-weight:600;text-align:center;margin-bottom:12px';
          }
        }
      } catch (err) {
        console.error('[App] Auto-logout erro:', err);
      }
    };

    const _mostrarAviso = () => {
      if (!FirebaseService.currentUser()) return;
      ToastComponent.show('⏱️ Sua sessão expira em 1 minuto por inatividade.', 'warn');
    };

    const _resetarTimer = () => {
      // Só reinicia se houver usuário logado
      if (!FirebaseService.currentUser()) return;
      _cancelarTimers();
      _timerAviso = setTimeout(_mostrarAviso,    AVISO_MS);
      _timer      = setTimeout(_executarLogout,  INATIVIDADE_MS);
    };

    // Eventos que reiniciam o contador — cobrindo todos os tipos de interação
    const _eventos = ['mousemove','mousedown','click','keydown','keypress','scroll','touchstart','touchmove','wheel','input','change','focus'];
    const _handleAtividade = () => {
      if (!_ativo || !FirebaseService.currentUser()) return;
      _resetarTimer();
    };

    // HIGH-06: listeners armazenados para remoção garantida no logout.
    // Os 13 eventos adicionados aqui DEVEM ser removidos ao sair — caso
    // contrário acumulam indefinidamente a cada ciclo login/logout.
    const _addListeners    = () => _eventos.forEach(ev => window.addEventListener(ev,    _handleAtividade, { passive: true, capture: true }));
    const _removeListeners = () => _eventos.forEach(ev => window.removeEventListener(ev, _handleAtividade, { passive: true, capture: true }));

    _addListeners();

    // Inicia quando o usuário fizer login
    EventBus.on('auth:login', () => {
      _ativo = true;
      _resetarTimer();
      logger.info('App', '⏱️ Auto-logout inicializado — 30 min de inatividade.');
    }, 'app:autologout');

    // Para quando o usuário sair manualmente
    EventBus.on('auth:logout', () => {
      _ativo = false;
      _cancelarTimers();
      _removeListeners(); // HIGH-06: remove os 13 window listeners adicionados no boot
    }, 'app:autologout:stop');

    // Se já estiver logado ao carregar a página (sessão persistida)
    setTimeout(() => {
      if (FirebaseService.currentUser()) {
        _ativo = true;
        _resetarTimer();
      }
    }, 1500); // Aguarda firebase resolver onAuthStateChanged
  }

  _getNavRoutes() {
    return [
      // ── Dashboard ─────────────────────────────────────────────
      { pageId:'dashboard',        label:'Dashboard',              icon:'🏠', navGroup:'dashboard',    navOrder:1  },
      // ── Contrato ─────────────────────────────────────────────
      { pageId:'obras-manager',    label:'Obras',                  icon:'🏗️', navGroup:'contrato',     navOrder:1  },
      { pageId:'responsaveis',     label:'Responsáveis',           icon:'👷', navGroup:'contrato',     navOrder:2  },
      { pageId:'prazos',           label:'Controle de Prazos',     icon:'📅', navGroup:'contrato',     navOrder:3  },
      { pageId:'riscos',           label:'Matriz de Riscos',       icon:'🎯', navGroup:'contrato',     navOrder:4  },
      { pageId:'aditivos',         label:'Aditivos Contratuais',   icon:'📝', navGroup:'contrato',     navOrder:5  },
      { pageId:'painel-contratual',label:'Painel Contratual',      icon:'📊', navGroup:'contrato',     navOrder:6  },
      // ── Fiscalização ──────────────────────────────────────────
      { pageId:'ocorrencias',      label:'Ocorrências',            icon:'⚠️', navGroup:'fiscalizacao', navOrder:1  },
      { pageId:'notificacoes',     label:'Notificações',           icon:'🔔', navGroup:'fiscalizacao', navOrder:2  },
      { pageId:'sancoes',          label:'Sanções Administrativas',icon:'⚖️', navGroup:'fiscalizacao', navOrder:3  },
      { pageId:'fiscal-obras',     label:'Fiscal de Obras',        icon:'👷', navGroup:'fiscalizacao', navOrder:4  },
      // ── Execução ──────────────────────────────────────────────
      { pageId:'boletim',          label:'Boletim de Medição',     icon:'📋', navGroup:'execucao',     navOrder:1  },
      { pageId:'memoria',          label:'Memória de Cálculo',     icon:'📐', navGroup:'execucao',     navOrder:2  },
      { pageId:'chuva',            label:'Quadro de Chuva',        icon:'🌧️', navGroup:'execucao',     navOrder:3  },
      { pageId:'diario',           label:'Diário de Obras',        icon:'📓', navGroup:'execucao',     navOrder:4  },
      { pageId:'relatorio',        label:'Relatório Mensal',       icon:'📑', navGroup:'execucao',     navOrder:5  },
      // ── Encerramento ──────────────────────────────────────────
      { pageId:'recebimento',      label:'Recebimento Obj./Ctto.', icon:'✅', navGroup:'encerramento', navOrder:1  },
      // ── Documentos ────────────────────────────────────────────
      { pageId:'documentos',       label:'Documentos',             icon:'📂', navGroup:'registros',    navOrder:1  },
      { pageId:'historico',        label:'Histórico',              icon:'🕐', navGroup:'registros',    navOrder:2  },
      // ── Sistema ───────────────────────────────────────────────
      { pageId:'usuarios',         label:'Usuários',               icon:'👥', navGroup:'sistema',      navOrder:1  },
      { pageId:'config',           label:'Configurações',          icon:'⚙️', navGroup:'sistema',      navOrder:2  },
      { pageId:'importacao',       label:'Importar Planilha',      icon:'📥', navGroup:'sistema',      navOrder:3  },
      { pageId:'obras-concluidas', label:'Obras Concluídas',       icon:'🏆', navGroup:'sistema',      navOrder:4  },
      { pageId:'dash-global',      label:'Dashboard Global',       icon:'🌐', navGroup:'sistema',      navOrder:5  },
      { pageId:'diagnostico',      label:'Diagnóstico do Sistema', icon:'🔬', navGroup:'sistema',      navOrder:6  },
      // FIX-E1.4: acesso-obra integrado — gerencia membros da obra
      { pageId:'acesso-obra',      label:'Acesso à Obra',          icon:'🔑', navGroup:'sistema',      navOrder:7  },
    ];
  }

  _removeLoader() {
    const loader = document.getElementById('app-loader');
    if (!loader) return;
    loader.style.opacity      = '0';
    loader.style.pointerEvents= 'none';
    setTimeout(() => loader.remove(), 400);

    // Aguarda um tick para FirebaseService ter resolvido o auth state
    setTimeout(() => {
      const usuarioLogado = FirebaseService.currentUser();
      const firebaseAtivo = FirebaseService.isReady;

      if (firebaseAtivo && !usuarioLogado) {
        // Firebase ativo mas sem usuário — exige login
        const telaLogin = document.getElementById('tela-login');
        if (telaLogin) telaLogin.style.display = 'flex';
        // MED-03: this handler is only needed once (hide login screen on first auth).
        // Use a self-removing pattern to avoid a third persistent auth:login listener
        // accumulating alongside the two already registered in _initLogin() and _initAutoLogout().
        const _onBootLogin = () => {
          const tl = document.getElementById('tela-login');
          if (tl) tl.style.display = 'none';
          const shell = document.getElementById('app-shell');
          if (shell) shell.style.display = 'flex';
          EventBus.offByContext('app:login:boot'); // remove itself after first fire
        };
        EventBus.on('auth:login', _onBootLogin, 'app:login:boot');
      } else {
        // Modo offline ou já logado — abre direto
        const shell = document.getElementById('app-shell');
        if (shell) shell.style.display = 'flex';
      }
    }, 500);
  }

  _showBootError(err) {
    logger.persist();
    const loader = document.getElementById('app-loader');
    if (loader) loader.innerHTML = `
      <div style="text-align:center;padding:40px;max-width:480px;font-family:'DM Sans',sans-serif">
        <div style="font-size:48px;margin-bottom:16px">💀</div>
        <h1 style="font-size:18px;color:#fca5a5;margin-bottom:8px">Erro crítico ao inicializar o sistema</h1>
        <p style="color:#9ca3af;font-size:12px;margin-bottom:20px;font-family:monospace;background:#1e2330;padding:10px;border-radius:6px;word-break:break-all">${String(err?.message||'Erro desconhecido').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;')}</p>
        <button data-action="_appReload" style="padding:10px 28px;background:#2563eb;color:#fff;border:none;border-radius:6px;cursor:pointer;font-size:14px;font-weight:700">🔄 Recarregar página</button>
        <p style="color:#4b5563;font-size:10px;margin-top:16px">Abra o console (F12) e procure por <code style="color:#60a5fa">[Boot]</code> para diagnóstico.</p>
      </div>`;
  }

  // ───────────────────────────────────────────────────────────────────────────
  // API pública
  // ───────────────────────────────────────────────────────────────────────────


  // ═══════════════════════════════════════════════════════════════
  //  SERVIÇOS v15+ — inicialização desacoplada
  // ═══════════════════════════════════════════════════════════════
  async _initNewServices() {
    // Carregamento dinâmico paralelo: todos os serviços iniciam ao mesmo tempo
    // com Promise.all. Um arquivo 404 não derruba os demais — cada _load tem
    // seu próprio try/catch isolado.
    // 'importar' é um thunk com especificador LITERAL, não uma string de
    // caminho: import(variavel) não é analisável estaticamente, e o Rollup
    // deixava estes serviços inteiros fora do bundle.
    const _load = async (name, importar, fn) => {
      try {
        const mod = await importar();
        const svc = mod.default || mod[Object.keys(mod)[0]];
        fn(svc);
        console.log(`[Services] ${name} OK.`);
      } catch (e) {
        console.warn(`[Services] ${name} não carregado (${e.message?.slice(0,60)})`);
      }
    };

    let _validation = null;
    let _analysis   = null;

    // Todos os serviços carregam em paralelo
    await Promise.all([
      // 1. Auditoria de Alterações (nível de campo)
      _load('auditLogService',     () => import('../services/auditLogService.js'),
        s => s.init()),

      // 2. Versionamento por BM
      _load('versioningService',   () => import('../services/versioningService.js'),
        s => s.init()),

      // 3. Motor de Validação
      _load('validationEngine',    () => import('../services/validationEngine.js'),
        s => { s.init(); _validation = s; }),

      // 4. Análise Inteligente + Detecção de Risco
      _load('analysisService',     () => import('../services/analysisService.js'),
        s => { s.init(); _analysis = s; }),

      // 5. Permissões de Usuário
      _load('permissionsService',  () => import('../services/permissionsService.js'),
        s => s.init()),

      // 6. Backup JSON
      _load('backupService',       () => import('../services/backupService.js'),
        s => { s.init(); window.gerarBackupJSONAtual = () => s.gerarBackupJSON(); }),

      // 7. Busca Global (Ctrl+K)
      _load('globalSearchService', () => import('../services/globalSearchService.js'),
        s => s.init()),

      // 8. Alertas Inteligentes (badge + painel)
      _load('smartAlertsService',  () => import('../services/smartAlertsService.js'),
        s => s.init()),

      // 9. Analytics do Dashboard (nova aba)
      _load('dashAnalytics', () => import('../modules/dashboard-analytics/dash-analytics.js'),
        mod => {
          const Klass = mod.DashAnalyticsModule || mod;
          const inst  = new Klass();
          inst.init();
          EventBus.on('module:loaded', ({ moduleId }) => {
            if (moduleId === 'dashboard') inst.onEnter();
          }, 'dash-analytics:boot');
          if (moduleLoader.getInstance('dashboard')) inst.onEnter();
        }),
    ]);

    // Roda validação e análise iniciais após os módulos estarem estáveis
    setTimeout(() => {
      try { _validation?.validate(); } catch(e) {}
      try { _analysis?.computeAnalysis(); } catch(e) {}
    }, 2000);

    console.log('[Services] Carregamento de serviços v15+ concluído.');
  }

  /** Retorna a instância de qualquer módulo (crítico ou dinâmico). */
  getModule(id) { return this._critInst.get(id) || moduleLoader.getInstance(id); }

  get isReady() { return this._ready; }
}

// REQ-4: export nomeado + default
export const app = new App();
export default app;
if (typeof window !== 'undefined') window._FO = app;

// ── Utilitário de controle de acesso frontend ─────────────────────────────
// Protege funções críticas expostas via window contra chamadas sem perfil adequado.
// Uso: if (!requirePerfil('fiscal','administrador')) return;
window.requirePerfil = function (...perfisPermitidos) {
  const userLogado = state.get('usuarioLogado') || {};
  const meuPerfil  = userLogado.perfil || PAPEL_PADRAO;

  // FALHA FECHADA, e o papel vem do custom claim (o mesmo que as rules leem).
  //
  // A versão anterior buscava o papel em state.usuarios — coleção que nenhum
  // módulo nunca populou — e liberava por DOIS caminhos: lista vazia
  // ("fallback para sistemas novos") e papel não encontrado (!meuPerfil).
  // As duas condições eram sempre verdadeiras, então a função devolvia true
  // em qualquer cenário: um no-op com aparência de controle de acesso.
  const permitido = userLogado.adminGlobal === true
    || meuPerfil === 'administrador'
    || perfisPermitidos.includes(meuPerfil);
  if (!permitido) {
    EventBus.emit('ui:toast', {
      msg: `🚫 Acesso negado. Perfil necessário: ${perfisPermitidos.join(' ou ')}.`,
      tipo: 'error',
    });
  }
  return permitido;
};
