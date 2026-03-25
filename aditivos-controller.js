/**
 * ╔══════════════════════════════════════════════════════════════════╗
 * ║  FISCAL NA OBRA v15 — modules/aditivos/aditivos-controller.js   ║
 * ║  Módulo: AditivosModule — Aditivos Contratuais                  ║
 * ╠══════════════════════════════════════════════════════════════════╣
 * ║  FEATURES:                                                       ║
 * ║    • CRUD completo de aditivos (novo, editar, excluir)          ║
 * ║    • Editor de planilha com diff visual (5 classes de cor)      ║
 * ║    • Aprovação → versionamento contratual automático            ║
 * ║    • Visualização da planilha e snapshot de versão              ║
 * ║    • Geração de PDF completo do aditivo                         ║
 * ║    • Cálculo automático de acréscimos, supressões e líquido     ║
 * ╠══════════════════════════════════════════════════════════════════╣
 * ║  INTEGRAÇÃO:                                                     ║
 * ║    • Registrado em app.js como módulo crítico                   ║
 * ║    • Consome state: aditivos, itensContrato, cfg, bms,          ║
 * ║      versoesContratuais, obraMeta, obraAtivaId                  ║
 * ║    • Persiste via FirebaseService (aditivos + versoes)          ║
 * ╚══════════════════════════════════════════════════════════════════╝
 */

import EventBus       from '../../core/EventBus.js';
import state          from '../../core/state.js';
import { formatters } from '../../utils/formatters.js';
import FirebaseService from '../../firebase/firebase-service.js';
import { AditivosUI } from './aditivos-ui.js';
import { exposeGlobal } from '../../utils/global-guard.js';
import storageUtils    from '../../utils/storage.js';
import EventDelegate   from '../../utils/event-delegate.js';
import {
  trunc2, gerarDiff, calcularTotais,
  dataParaInput, inputParaData, classificarItem,
} from './aditivos-calculos.js';

const R$ = v => formatters.currency ? formatters.currency(v) : (v || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });

// ─── Estado interno do módulo (Draft da planilha em edição) ──────────────────
let _planilhaDraft    = [];  // Cópia editável dos itens atuais
let _planilhaBase     = [];  // Snapshot de referência (imutável durante a sessão)
let _itensMudadosPend = null; // Buffer de diff pendente para salvar junto ao aditivo
let _adtViewAtualId   = null; // ID do aditivo aberto na visualização
let _obraAtivaDraft   = null; // Obra para a qual o draft atual foi criado (REC-01)

export class AditivosModule {
  constructor() {
    this._ui   = new AditivosUI();
    this._subs = [];
  }

  // ═══════════════════════════════════════════════════════════════════
  // CICLO DE VIDA DO MÓDULO
  // ═══════════════════════════════════════════════════════════════════

  async init() {
    try {
      this._bindGlobals();
      this._bindEvents();
      console.log('[AditivosModule] init OK');
    } catch (e) {
      console.error('[AditivosModule] init:', e);
    }
  }

  onEnter() {
    try {
      this._render();
    } catch (e) {
      console.error('[AditivosModule] onEnter:', e);
    }
  }

  _render() {
    this._ui.renderPagina(_planilhaDraft, _planilhaBase);
  }

  // ═══════════════════════════════════════════════════════════════════
  // BINDINGS — globals expostos ao HTML e ao EventBus
  // ═══════════════════════════════════════════════════════════════════

  _bindGlobals() {
    // Referenciados em index.html e nos templates inline da UI
    // P1 — exposeGlobal: drena stubs enfileirados e envolve em try/catch
    exposeGlobal('abrirModalNovoAditivo',    () => this._novoAditivo());
    exposeGlobal('_adtEditar',               (id) => this._editarAditivo(id));
    exposeGlobal('_adtExcluir',              (id) => this._excluirAditivo(id));
    exposeGlobal('_adtVerPlanilha',          (id) => this._verPlanilhaAditivo(id));
    exposeGlobal('_adtVerVersao',            (n)  => this._verVersaoContratual(n));
    exposeGlobal('_adtFecharModal',          ()   => this._ui.fecharModal());
    exposeGlobal('_adtSalvar',               ()   => this._salvarAditivo());
    exposeGlobal('_adtCalcVariacao',         ()   => this._calcVariacao());
    exposeGlobal('_adtCalcTermino',          ()   => this._calcTermino());
    exposeGlobal('_adtOnStatusChange',       (v)  => this._onStatusChange(v));
    exposeGlobal('_adtGerarPDF',             ()   => this._gerarPDF());
    // Editor de planilha
    exposeGlobal('_adtAbrirPlanilhaEditor',  ()   => this._abrirPlanilhaEditor());
    exposeGlobal('_adtFecharPlanilhaEditor', ()   => this._fecharPlanilhaEditor());
    exposeGlobal('_adtPlanilhaReset',        ()   => this._resetarPlanilha());
    exposeGlobal('_adtPlanilhaAplicar',      ()   => this._aplicarPlanilha());
    exposeGlobal('_adtPlanilhaEditQtd',      (i, v) => this._planilhaEditarQtd(i, v));
    exposeGlobal('_adtPlanilhaEditUp',       (i, v) => this._planilhaEditarUp(i, v));
    exposeGlobal('_adtPlanilhaEditDesc',     (i, v) => this._planilhaEditarDesc(i, v));
    exposeGlobal('_adtPlanilhaRemover',      (i)    => this._planilhaRemoverItem(i));
    exposeGlobal('_adtPlanilhaRestaurar',    (i)    => this._planilhaRestaurarItem(i));
    exposeGlobal('_adtPlanilhaAdicionarItem',()   => this._planilhaAdicionarItem());

    // BUG-FIX: registra handlers diretamente no EventDelegate dentro do próprio módulo.
    // O registerAll em app.js pode falhar silenciosamente se o bundle do Vite
    // nao incluir a versao atualizada. Registrar aqui garante funcionamento
    // independente do estado do bundle implantado.
    EventDelegate.registerAll({
      'abrirModalNovoAditivo':     ()       => this._novoAditivo(),
      '_adtSalvar':                ()       => this._salvarAditivo(),
      '_adtEditar':                (id)     => this._editarAditivo(id),
      '_adtExcluir':               (id)     => this._excluirAditivo(id),
      '_adtVerPlanilha':           (id)     => this._verPlanilhaAditivo(id),
      '_adtVerVersao':             (n)      => this._verVersaoContratual(n),
      '_adtFecharModal':           ()       => this._ui.fecharModal(),
      '_adtFecharViewModal':       ()       => { const el = document.getElementById('adt-view-modal-overlay'); if (el) el.style.display = 'none'; },
      '_adtFecharVersaoModal':     ()       => { const el = document.getElementById('adt-versao-modal-overlay'); if (el) el.style.display = 'none'; },
      '_adtCalcVariacao':          ()       => this._calcVariacao(),
      '_adtCalcTermino':           ()       => this._calcTermino(),
      '_adtOnStatusChange':        (v)      => this._onStatusChange(v),
      '_adtGerarPDF':              ()       => this._gerarPDF(),
      '_adtAbrirPlanilhaEditor':   ()       => this._abrirPlanilhaEditor(),
      '_adtFecharPlanilhaEditor':  ()       => this._fecharPlanilhaEditor(),
      '_adtPlanilhaReset':         ()       => this._resetarPlanilha(),
      '_adtPlanilhaAplicar':       ()       => this._aplicarPlanilha(),
      '_adtPlanilhaEditQtd':       (i, v)   => this._planilhaEditarQtd(i, v),
      '_adtPlanilhaEditUp':        (i, v)   => this._planilhaEditarUp(i, v),
      '_adtPlanilhaEditDesc':      (i, v)   => this._planilhaEditarDesc(i, v),
      '_adtPlanilhaRemover':       (i)      => this._planilhaRemoverItem(i),
      '_adtPlanilhaRestaurar':     (i)      => this._planilhaRestaurarItem(i),
      '_adtPlanilhaAdicionarItem': ()       => this._planilhaAdicionarItem(),
      '_adtNovoItemFechar':        ()       => this._ui.fecharModalNovoItem?.(),
      '_adtNovoItemConfirmar':     ()       => this._confirmarNovoItem?.(),
    });
  }

  _bindEvents() {
    // Reage à troca de obra ativa — recarrega dados
    const sub1 = EventBus.on('obra:changed', async ({ obraId }) => {
      await this._carregarDados(obraId);
      this._render();
    }, 'aditivos');
    this._subs.push(sub1);

    // Reage a importação / alteração de planilha
    const sub2 = EventBus.on('itens:updated', () => {
      this._render();
    }, 'aditivos');
    this._subs.push(sub2);
  }

  // ═══════════════════════════════════════════════════════════════════
  // CARREGAMENTO DE DADOS
  // ═══════════════════════════════════════════════════════════════════

  async _carregarDados(obraId) {
    if (!obraId) return;
    try {
      // Aditivos
      const adts = await FirebaseService.getAditivos(obraId);
      state.set('aditivos', adts || []);

      // Versões contratuais
      const versoes = await FirebaseService.getVersoesContratuais(obraId);
      state.set('versoesContratuais', versoes || []);

      // Garante versão 1 (contrato original)
      await this._garantirVersaoOriginal(obraId);

      // Sincroniza obraMeta.contractVersion
      const todasVersoes = state.get('versoesContratuais') || [];
      const maxVer = todasVersoes.length
        ? Math.max(...todasVersoes.map(v => v.numero))
        : 1;
      state.set('obraMeta', { ...state.get('obraMeta'), contractVersion: maxVer });

      // Reseta draft da planilha ao trocar de obra (REC-01)
      _planilhaDraft    = [];
      _planilhaBase     = [];
      _itensMudadosPend = null;
      _obraAtivaDraft   = null;
    } catch (e) {
      console.error('[AditivosModule] _carregarDados:', e);
    }
  }

  async _garantirVersaoOriginal(obraId) {
    const versoes = state.get('versoesContratuais') || [];
    if (versoes.find(v => v.numero === 1)) return;

    const cfg   = state.get('cfg') || {};
    const itens = state.get('itensContrato') || [];

    const v1 = {
      numero:        1,
      tipo:          'original',
      aditivoId:     null,
      descricao:     'Contrato Original',
      cfgSnapshot:   JSON.parse(JSON.stringify(cfg)),
      itensSnapshot: JSON.parse(JSON.stringify(itens)),
      criadoEm:      new Date().toISOString(),
    };

    versoes.push(v1);
    state.set('versoesContratuais', versoes);

    try {
      await FirebaseService.salvarVersaoContratual(obraId, v1);
    } catch (e) {
      console.warn('[AditivosModule] _garantirVersaoOriginal (Firebase):', e);
    }
  }

  // ═══════════════════════════════════════════════════════════════════
  // CRUD DE ADITIVOS
  // ═══════════════════════════════════════════════════════════════════

  async _novoAditivo() {
    const obraId = state.get('obraAtivaId');
    if (!obraId) {
      window.toast?.('⚠️ Selecione uma obra antes de criar um aditivo.', 'warn');
      return;
    }
    // Inicializa draft da planilha com itens atuais
    await this._inicializarDraftPlanilha();

    const aditivos = state.get('aditivos') || [];
    const cfg      = state.get('cfg') || {};
    this._ui.abrirModal('Novo Aditivo');
    this._ui.preencherModalNovo(aditivos, cfg);
    _itensMudadosPend = null;
    // REC-11: esconde aviso de pendente no início
    const elAviso = document.getElementById('adt-planilha-aviso-pendente');
    if (elAviso) elAviso.style.display = 'none';
  }

  _editarAditivo(id) {
    const aditivos = state.get('aditivos') || [];
    const a = aditivos.find(x => x.id === id);
    if (!a) return;
    if (a.status === 'Aprovado') {
      window.toast?.('⚠️ Aditivos aprovados são imutáveis.', 'warn');
      return;
    }
    // Carrega draft do aditivo existente (itensMudados salvo)
    _itensMudadosPend = a.itensMudados ? JSON.parse(JSON.stringify(a.itensMudados)) : null;

    this._ui.abrirModal(`Editar Aditivo Nº ${String(a.numero).padStart(2, '0')}`);
    this._ui.preencherModalEditar(a);
  }

  async _excluirAditivo(id) {
    const aditivos = state.get('aditivos') || [];
    const a = aditivos.find(x => x.id === id);
    if (!a) return;
    if (a.status === 'Aprovado') {
      window.toast?.('\u26a0\ufe0f Aditivos aprovados são imutáveis.', 'warn');
      return;
    }
    if (!confirm(`\ud83d\uddd1\ufe0f Mover Aditivo Nº ${String(a.numero).padStart(2, '0')} para a Lixeira?\n\nVocê poderá restaurá-lo em Configurações → Itens Excluídos.`)) return;

    const obraId = state.get('obraAtivaId');
    const user   = state.get('usuarioLogado') || {};
    const meta   = {
      excluidoPor:  { uid: user.uid||'', email: user.email||'desconhecido', nome: user.displayName||user.email||'Usuário' },
      moduloOrigem: 'aditivos',
      obraId,
    };
    const lxLabel = `Aditivo Nº ${String(a.numero).padStart(2,'0')} — ${a.descricao || ''}`;

    // Salva na lixeira local + Firebase ANTES de remover
    storageUtils.lixeiraEnviar('aditivo', lxLabel, { aditivo: { ...a }, obraId }, meta);
    try {
      await FirebaseService.salvarItemLixeiraFirebase({
        id: `lx_${Date.now()}`, tipo: 'aditivo', label: lxLabel, obraId,
        excluidoEm: new Date().toISOString(), ...meta,
        dados: { aditivo: { ...a }, obraId },
      });
    } catch {}

    const novos  = aditivos.filter(x => x.id !== id);
    state.set('aditivos', novos);

    try {
      await FirebaseService.deleteAditivo(obraId, id);
    } catch (e) {
      console.warn('[AditivosModule] deleteAditivo:', e);
    }

    EventBus.emit('lixeira:atualizada', {});
    this._render();
    window.toast?.('\ud83d\uddd1\ufe0f Aditivo movido para a lixeira.', 'warn');
    EventBus.emit('historico:add', { acao: 'aditivo_excluido', id, obraId });
  }

  async _salvarAditivo() {
    const form = this._ui.lerModal();

    if (!form.descricao) {
      window.toast?.('⚠️ Informe a descrição do aditivo.', 'warn');
      return;
    }

    // CORREÇÃO: Número de Processo obrigatório para status Aprovado (Lei 14.133/2021 Art. 124)
    if (form.status === 'Aprovado' && !form.processo.trim()) {
      window.toast?.('⚠️ Informe o Número do Processo Administrativo antes de aprovar. (Lei 14.133/2021 Art. 124)', 'warn');
      document.getElementById('adt-processo')?.focus();
      return;
    }

    // CORREÇÃO: Verificar limite legal de 25% para aditivos aprovados (Lei 14.133/2021 Art. 125)
    if (form.status === 'Aprovado') {
      const aditivos     = state.get('aditivos') || [];
      const cfg          = state.get('cfg')      || {};
      const valorInicial = parseFloat(cfg.valor) || 0;

      if (valorInicial > 0) {
        // Soma acréscimos e supressões dos aditivos já aprovados (exceto o atual em edição)
        const aditivosAprovados = aditivos.filter(a => a.status === 'Aprovado' && a.id !== form.editId);
        let totalAcrescimos  = 0;
        let totalSupressoes  = 0;

        aditivosAprovados.forEach(a => {
          const delta = parseFloat(a.variacaoValor) || 0;
          if (delta > 0) totalAcrescimos  += delta;
          if (delta < 0) totalSupressoes  += Math.abs(delta);
        });

        // Inclui o aditivo atual
        const deltaAtual = (form.valorNovo || 0) - (form.valorAnterior || 0);
        if (deltaAtual > 0) totalAcrescimos  += deltaAtual;
        if (deltaAtual < 0) totalSupressoes  += Math.abs(deltaAtual);

        // Limite: 25% para acréscimos e supressões (50% para obras de engenharia conforme § 1º)
        // Usamos 25% como padrão conservador; o usuário pode prosseguir com confirmação explícita
        const LIMITE_PCT = 25;
        const pctAcrescimo = (totalAcrescimos  / valorInicial) * 100;
        const pctSupressao = (totalSupressoes  / valorInicial) * 100;
        const R$ = v => v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });

        if (pctAcrescimo > LIMITE_PCT || pctSupressao > LIMITE_PCT) {
          const msgAcr = pctAcrescimo > LIMITE_PCT
            ? `\n• Acréscimos: ${pctAcrescimo.toFixed(2)}% do valor inicial (limite: ${LIMITE_PCT}%)` : '';
          const msgSup = pctSupressao > LIMITE_PCT
            ? `\n• Supressões: ${pctSupressao.toFixed(2)}% do valor inicial (limite: ${LIMITE_PCT}%)` : '';
          const confirmou = window.confirm(
            `⚠️ ATENÇÃO — LIMITE LEGAL ULTRAPASSADO\n\n` +
            `Valor inicial do contrato: ${R$(valorInicial)}` +
            msgAcr + msgSup +
            `\n\nLei 14.133/2021 Art. 125 estabelece limite de ${LIMITE_PCT}% para acréscimos e supressões.` +
            `\n\nSe houver embasamento legal específico (ex.: § 1º para obras de engenharia até 50%), ` +
            `confirme apenas se o processo administrativo justifica expressamente o extrapolamento.\n\n` +
            `Deseja prosseguir mesmo assim?`
          );
          if (!confirmou) return;
          // Registra que o limite foi ultrapassado conscientemente
          window.auditRegistrar?.({
            modulo: 'Aditivos',
            tipo:   'alerta_limite_legal',
            registro: `Aditivo Nº ${String(form.numero).padStart(2,'0')}`,
            detalhe: `Limite de ${LIMITE_PCT}% ultrapassado — acréscimos: ${pctAcrescimo.toFixed(2)}%, supressões: ${pctSupressao.toFixed(2)}%. Usuário confirmou prosseguimento.`,
          });
        } else if (pctAcrescimo > LIMITE_PCT * 0.8 || pctSupressao > LIMITE_PCT * 0.8) {
          // Alerta preventivo acima de 80% do limite
          window.toast?.(`⚠️ Atenção: acumulado de alterações já atingiu ${Math.max(pctAcrescimo, pctSupressao).toFixed(1)}% do limite legal de ${LIMITE_PCT}%.`, 'warn');
        }
      }
    }

    // REC-02: recalcula diff do draft atual e sobrescreve qualquer pendente,
    // garantindo que o estado salvo reflita exatamente o que está na tela.
    if (_planilhaDraft.length > 0 && _planilhaBase.length > 0) {
      const diff = gerarDiff(_planilhaDraft, _planilhaBase);
      // Só substitui se o draft atual pertence a esta obra (proteção REC-01)
      if (_obraAtivaDraft === state.get('obraAtivaId')) {
        _itensMudadosPend = {
          itensMudados:  diff,
          itensSnapshot: JSON.parse(JSON.stringify(_planilhaDraft)),
        };
      }
    }

    const obraId   = state.get('obraAtivaId');
    const aditivos = state.get('aditivos') || [];
    const obraMeta = state.get('obraMeta') || { contractVersion: 1 };
    const novaVerNum = obraMeta.contractVersion + (form.editId ? 0 : 1);

    // Extrai diff e snapshot do pendente (suporte ao formato antigo: array direto)
    let itensMudados  = [];
    let itensSnapshot = [];
    if (_itensMudadosPend) {
      if (Array.isArray(_itensMudadosPend)) {
        itensMudados  = _itensMudadosPend;
        itensSnapshot = [];
      } else {
        itensMudados  = _itensMudadosPend.itensMudados  || [];
        itensSnapshot = _itensMudadosPend.itensSnapshot || [];
      }
    }

    const aditivo = {
      id:                      form.editId || `adt_${String(form.numero).padStart(2, '0')}_${Date.now()}`,
      numero:                  form.numero,
      tipo:                    form.tipo,
      descricao:               form.descricao,
      numeroProcesso:          form.processo || null,
      data:                    form.data ? inputParaData(form.data) : null,
      valorAnterior:           form.valorAnterior || null,
      valorNovo:               form.valorNovo || null,
      variacaoValor:           (form.valorAnterior && form.valorNovo)
                                 ? trunc2(form.valorNovo - form.valorAnterior) : null,
      percentualVariacao:      (form.valorAnterior && form.valorNovo && form.valorAnterior > 0)
                                 ? trunc2((form.valorNovo - form.valorAnterior) / form.valorAnterior * 100) : null,
      terminoAnterior:         form.terminoAnterior ? inputParaData(form.terminoAnterior) : null,
      prazoAdicionalDias:      form.prazoAdicional || null,
      terminoNovo:             form.terminoNovo ? inputParaData(form.terminoNovo) : null,
      contractVersionAnterior: obraMeta.contractVersion,
      contractVersionNova:     form.editId
                                 ? (aditivos.find(a => a.id === form.editId)?.contractVersionNova || novaVerNum)
                                 : novaVerNum,
      status:                  form.status,
      itensMudados,     // diff — alterações pontuais
      itensSnapshot,    // planilha COMPLETA após o aditivo
      criadoEm:                form.editId
                                 ? (aditivos.find(a => a.id === form.editId)?.criadoEm || new Date().toISOString())
                                 : new Date().toISOString(),
      atualizadoEm:            new Date().toISOString(),
    };

    _itensMudadosPend = null;

    // Atualiza state local
    const idx = aditivos.findIndex(a => a.id === aditivo.id);
    const novos = [...aditivos];
    if (idx >= 0) novos[idx] = aditivo; else novos.push(aditivo);
    state.set('aditivos', novos);

    // Persiste
    try {
      await FirebaseService.salvarAditivo(obraId, aditivo);
    } catch (e) {
      console.warn('[AditivosModule] salvarAditivo:', e);
    }

    // Se aprovado e novo: aplica versionamento
    if (form.status === 'Aprovado' && !form.editId) {
      await this._aplicarVersaoContratual(aditivo, obraId);
    }

    this._ui.fecharModal();
    this._render();

    window.toast?.(`✅ Aditivo Nº ${String(form.numero).padStart(2, '0')} salvo com sucesso!`);
    EventBus.emit('historico:add', {
      acao: form.editId ? 'aditivo_editado' : 'aditivo_criado',
      numero: form.numero, obraId,
    });

    // Notifica outros módulos sobre alteração nos dados
    EventBus.emit('aditivos:changed', { obraId });
  }

  // ═══════════════════════════════════════════════════════════════════
  // CÁLCULOS DO FORMULÁRIO
  // ═══════════════════════════════════════════════════════════════════

  _calcVariacao() {
    const ant = parseFloat(document.getElementById('adt-valor-anterior')?.value) || 0;
    const nov = parseFloat(document.getElementById('adt-valor-novo')?.value)     || 0;
    if (ant && nov) {
      const v   = trunc2(nov - ant);
      const pct = ant > 0 ? (v / ant * 100) : 0;
      const el  = document.getElementById('adt-variacao');
      if (el) el.value = `${v >= 0 ? '+' : ''}${R$(v)} (${pct >= 0 ? '+' : ''}${pct.toFixed(1)}%)`;
    } else {
      const el = document.getElementById('adt-variacao');
      if (el) el.value = '';
    }
  }

  _calcTermino() {
    const ant  = document.getElementById('adt-termino-anterior')?.value;
    const dias = parseInt(document.getElementById('adt-prazo-adicional')?.value) || 0;
    const el   = document.getElementById('adt-termino-novo');
    if (!el) return;
    if (ant && dias > 0) {
      const d = new Date(ant + 'T00:00:00');
      d.setDate(d.getDate() + dias);
      el.value = d.toISOString().slice(0, 10);
    } else {
      el.value = '';
    }
  }

  _onStatusChange(valor) {
    const aviso = document.getElementById('adt-aviso-versao');
    if (aviso) aviso.style.display = valor === 'Aprovado' ? 'block' : 'none';
  }

  // ═══════════════════════════════════════════════════════════════════
  // VERSIONAMENTO CONTRATUAL — aplicado ao aprovar
  // ═══════════════════════════════════════════════════════════════════

  async _aplicarVersaoContratual(aditivo, obraId) {
    const obraMeta = state.get('obraMeta') || { contractVersion: 1 };
    const versoes  = state.get('versoesContratuais') || [];
    const cfg      = state.get('cfg') || {};
    const itens    = state.get('itensContrato') || [];
    const bms      = state.get('bms') || [];
    const novaNum  = aditivo.contractVersionNova;

    // Passo 1 — Cria snapshot da nova versão
    const novaVersao = {
      numero:        novaNum,
      tipo:          'aditivo',
      aditivoId:     aditivo.id,
      descricao:     `${String(aditivo.numero).padStart(2,'0')}º Aditivo — ${aditivo.descricao?.slice(0,60)||''}`,
      cfgSnapshot:   JSON.parse(JSON.stringify(cfg)),
      itensSnapshot: JSON.parse(JSON.stringify(itens)),
      itensMudados:  JSON.parse(JSON.stringify(aditivo.itensMudados || [])),
      criadoEm:      new Date().toISOString(),
    };

    // Aplica novos valores ao cfgSnapshot da versão
    if (aditivo.valorNovo)   novaVersao.cfgSnapshot.valor   = aditivo.valorNovo;
    if (aditivo.terminoNovo) novaVersao.cfgSnapshot.termino = aditivo.terminoNovo;

    // REC-03: persiste a versão no Firebase ANTES de atualizar state local.
    // Se falhar, reverte o aditivo para Rascunho e notifica o usuário.
    try {
      await FirebaseService.salvarVersaoContratual(obraId, novaVersao);
    } catch (e) {
      console.error('[AditivosModule] salvarVersaoContratual FALHOU — revertendo status:', e);
      const adts = state.get('aditivos') || [];
      const idx  = adts.findIndex(a => a.id === aditivo.id);
      if (idx >= 0) {
        adts[idx] = { ...adts[idx], status: 'Rascunho' };
        state.set('aditivos', adts);
        try { await FirebaseService.salvarAditivo(obraId, adts[idx]); } catch (_) {}
      }
      window.toast?.('❌ Falha ao criar versão contratual. Aditivo revertido para Rascunho. Tente novamente.', 'error');
      this._render();
      return;
    }

    // Versão persistida com sucesso — agora atualiza state local
    state.set('versoesContratuais', [...versoes, novaVersao]);

    // Passo 2 — Atualiza cfg (valor e termino vigentes)
    const novoCfg = { ...cfg };
    if (aditivo.valorNovo)        { novoCfg.valor   = aditivo.valorNovo; }
    if (aditivo.terminoNovo)      { novoCfg.termino = aditivo.terminoNovo; }
    if (aditivo.prazoAdicionalDias) {
      novoCfg.duracaoDias = (novoCfg.duracaoDias || 0) + aditivo.prazoAdicionalDias;
    }
    state.set('cfg', novoCfg);

    try {
      await FirebaseService.setObraCfg(obraId, novoCfg, state.get('statusObra'));
    } catch (e) {
      console.warn('[AditivosModule] setObraCfg:', e);
    }

    // Passo 3 — Atualiza obraMeta
    state.set('obraMeta', { ...obraMeta, contractVersion: novaNum });

    // Passo 4 — Atualiza BM em andamento para nova versão
    const bmEmAndamento = [...bms].reverse().find(b => b.status !== 'Aprovado');
    if (bmEmAndamento) {
      bmEmAndamento.contractVersion = novaNum;
      state.set('bms', bms);
      try {
        await FirebaseService.setBMs(obraId, bms);
      } catch (e) {
        console.warn('[AditivosModule] salvarBMs:', e);
      }
    }

    // Reseta draft após aprovação
    _planilhaDraft    = [];
    _planilhaBase     = [];
    _itensMudadosPend = null;
    _obraAtivaDraft   = null;

    window.toast?.(`🔒 Versão Contratual v${novaNum} criada — BMs anteriores preservados!`);
    EventBus.emit('contrato:versao_criada', { versao: novaNum, obraId });
  }

  // ═══════════════════════════════════════════════════════════════════
  // EDITOR DE PLANILHA DO ADITIVO
  // ═══════════════════════════════════════════════════════════════════

  async _inicializarDraftPlanilha() {
    const obraId = state.get('obraAtivaId');

    // REC-01: só reutiliza o draft se pertencer à obra ativa.
    // Se a obra mudou (ou nunca foi registrada), descarta e reinicializa.
    if (_planilhaDraft.length && _obraAtivaDraft === obraId) return;

    // Se havia draft de outra obra, descarta silenciosamente
    if (_planilhaDraft.length && _obraAtivaDraft !== obraId) {
      console.warn('[AditivosModule] draft de obra anterior descartado ao inicializar para obra', obraId);
      _planilhaDraft    = [];
      _planilhaBase     = [];
      _itensMudadosPend = null;
    }

    const obraMeta = state.get('obraMeta') || { contractVersion: 1 };
    const itens    = state.get('itensContrato') || [];
    const versoes  = state.get('versoesContratuais') || [];

    // Tenta carregar snapshot da versão mais recente como base
    const verAtual = obraMeta.contractVersion || 1;
    let baseItens = null;

    try {
      const snapLatest = versoes.find(v => v.numero === verAtual);
      if (snapLatest?.itensSnapshot) {
        baseItens = JSON.parse(JSON.stringify(snapLatest.itensSnapshot));
      } else {
        // Tenta Firebase
        const snap = await FirebaseService.getVersoesContratuais(obraId);
        const snapVer = snap?.find(v => v.numero === verAtual);
        baseItens = snapVer?.itensSnapshot ? JSON.parse(JSON.stringify(snapVer.itensSnapshot)) : null;
      }
    } catch (e) {
      console.warn('[AditivosModule] _inicializarDraftPlanilha snapshot:', e);
    }

    _planilhaBase     = baseItens || JSON.parse(JSON.stringify(itens));
    _planilhaDraft    = JSON.parse(JSON.stringify(itens));
    _obraAtivaDraft   = obraId;   // REC-01: registra a obra dona do draft
    // Remove flags de estado anteriores
    _planilhaDraft.forEach(it => { delete it._adtStatus; delete it._adtRemovido; });
  }

  _abrirPlanilhaEditor() {
    if (!_planilhaDraft.length) {
      this._inicializarDraftPlanilha().then(() => {
        this._ui.abrirPlanilhaEditor();
        this._renderPlanilha();
      }).catch(e => {
        console.error('[AditivosModule] _abrirPlanilhaEditor:', e);
        window.toast?.('⚠️ Erro ao carregar a planilha. Verifique a conexão e tente novamente.', 'warn');
      });
    } else {
      this._ui.abrirPlanilhaEditor();
      this._renderPlanilha();
    }
  }

  _fecharPlanilhaEditor() {
    // REC-11: se o draft tem alterações mas não foram aplicadas, mostra aviso
    if (_planilhaDraft.length && _planilhaBase.length) {
      const diff = gerarDiff(_planilhaDraft, _planilhaBase);
      const jaAplicado = _itensMudadosPend &&
        JSON.stringify((_itensMudadosPend.itensMudados || [])) === JSON.stringify(diff);
      if (diff.length > 0 && !jaAplicado) {
        const elAviso = document.getElementById('adt-planilha-aviso-pendente');
        if (elAviso) elAviso.style.display = 'block';
      }
    }
    this._ui.fecharPlanilhaEditor();
  }

  _renderPlanilha() {
    const cfg = state.get('cfg') || {};
    this._ui.renderPlanilha(_planilhaDraft, _planilhaBase, cfg);
  }

  async _resetarPlanilha() {
    const temAlteracoes = _planilhaDraft.some(it =>
      it._adtNovo || it._adtRemovido ||
      classificarItem(it, _planilhaBase) !== 'original'
    );
    if (temAlteracoes) {
      if (!confirm('↩ Resetar planilha do aditivo?\n\nTodas as alterações não salvas serão descartadas.\n\nConfirmar?')) return;
    }
    _planilhaDraft    = [];
    _planilhaBase     = [];
    _itensMudadosPend = null;
    await this._inicializarDraftPlanilha();
    this._renderPlanilha();
    window.toast?.('↩ Planilha resetada para o estado atual do contrato.', 'info');
  }

  _aplicarPlanilha() {
    const diff = gerarDiff(_planilhaDraft, _planilhaBase);
    _itensMudadosPend = {
      itensMudados:   diff,
      // Planilha COMPLETA após o aditivo — usada na visualização e no PDF
      itensSnapshot:  JSON.parse(JSON.stringify(_planilhaDraft)),
    };

    const ni = diff.length;
    const elStatus = document.getElementById('adt-planilha-status');
    if (elStatus) elStatus.textContent = ni > 0 ? `✅ ${ni} alteração(ões) aplicada(s) ao aditivo` : '⚠️ Nenhuma alteração detectada';

    // REC-11: esconde aviso de pendente ao aplicar
    const elAviso = document.getElementById('adt-planilha-aviso-pendente');
    if (elAviso) elAviso.style.display = 'none';

    this._ui.fecharPlanilhaEditor();
    window.toast?.(ni > 0 ? `✅ Planilha aplicada — ${ni} item(ns) alterado(s)` : '⚠️ Nenhuma alteração na planilha.', ni > 0 ? 'ok' : 'warn');
  }

  _planilhaEditarQtd(idx, val) {
    if (!_planilhaDraft[idx]) return;
    _planilhaDraft[idx].qtd = val;
    this._renderPlanilha();
  }

  _planilhaEditarUp(idx, val) {
    if (!_planilhaDraft[idx]) return;
    _planilhaDraft[idx].up = val;
    this._renderPlanilha();
  }

  _planilhaEditarDesc(idx, val) {
    if (!_planilhaDraft[idx]) return;
    _planilhaDraft[idx].desc = val;
    // Não re-renderiza a tabela inteira para não perder foco do input
  }

  _planilhaRemoverItem(idx) {
    if (!_planilhaDraft[idx]) return;
    const it = _planilhaDraft[idx];
    // Se o item é novo (não existe na base), remove definitivamente
    const existeNaBase = _planilhaBase.find(b => b.id === it.id);
    if (!existeNaBase) {
      _planilhaDraft.splice(idx, 1);
    } else {
      _planilhaDraft[idx]._adtRemovido = true;
    }
    this._renderPlanilha();
  }

  _planilhaRestaurarItem(idx) {
    if (!_planilhaDraft[idx]) return;
    delete _planilhaDraft[idx]._adtRemovido;
    // Restaura qtd e up do item da base
    const base = _planilhaBase.find(b => b.id === _planilhaDraft[idx].id);
    if (base) {
      _planilhaDraft[idx].qtd = base.qtd;
      _planilhaDraft[idx].up  = base.up;
    }
    this._renderPlanilha();
  }

  // ─── Lógica de parsing e ordenação de códigos hierárquicos ────────

  /**
   * Converte um código hierárquico como "4.5.6" em array numérico [4,5,6]
   * para comparação de posicionamento.
   */
  _parseCodigo(codigo) {
    if (!codigo) return [];
    return String(codigo).trim().split('.').map(p => {
      const n = parseInt(p, 10);
      return isNaN(n) ? 0 : n;
    });
  }

  /**
   * Compara dois códigos hierárquicos.
   * Retorna negativo se a < b, 0 se igual, positivo se a > b.
   */
  _compararCodigos(codigoA, codigoB) {
    const a = this._parseCodigo(codigoA);
    const b = this._parseCodigo(codigoB);
    const len = Math.max(a.length, b.length);
    for (let i = 0; i < len; i++) {
      const va = a[i] || 0;
      const vb = b[i] || 0;
      if (va !== vb) return va - vb;
    }
    return 0;
  }

  /**
   * Dado o código do novo item, encontra o índice onde ele deve ser inserido
   * no _planilhaDraft — imediatamente após o item com código anterior mais próximo.
   *
   * Exemplo: novo item "4.5.6" → insere após "4.5.5" (ou após o último item
   * que seja menor que "4.5.6" na ordenação hierárquica).
   *
   * Retorna o índice de inserção (position após o qual inserir).
   */
  _encontrarPosicaoInsercao(novoCodigo) {
    // Última posição onde o código do draft é menor que o novo
    let posicaoApos = -1;

    for (let i = 0; i < _planilhaDraft.length; i++) {
      const it = _planilhaDraft[i];
      if (!it.id) continue;
      // Considera tanto itens de serviço quanto grupos/subgrupos para não
      // "furar" blocos — mas só usa itens com código numérico-hierárquico
      const cmp = this._compararCodigos(it.id, novoCodigo);
      if (cmp < 0) {
        posicaoApos = i; // este item é anterior ao novo → candidato
      } else if (cmp === 0) {
        return null; // código já existe!
      }
    }

    return posicaoApos; // -1 → inserir no início
  }

  // ─── Modal de adição de novo item ──────────────────────────────────

  _planilhaAdicionarItem() {
    // Garante que o draft esteja inicializado
    if (!_planilhaDraft.length) {
      this._inicializarDraftPlanilha()
        .then(() => {
          if (!_planilhaDraft.length) {
            // REC-10: inicialização falhou (Firebase offline ou planilha vazia)
            window.toast?.('⚠️ Não foi possível carregar a planilha base. Verifique a conexão e tente novamente.', 'warn');
            return;
          }
          this._ui.abrirModalNovoItem();
        })
        .catch(e => {
          console.error('[AditivosModule] _planilhaAdicionarItem:', e);
          window.toast?.('⚠️ Erro ao carregar a planilha. Tente novamente.', 'warn');
        });
    } else {
      this._ui.abrirModalNovoItem();
    }

    // Bindings globais do modal
    window._adtNovoItemFechar          = () => this._ui.fecharModalNovoItem();
    window._adtNovoItemConfirmar       = () => this._confirmarNovoItem();
    window._adtNovoItemPreviewPosicao  = () => this._previewPosicaoNovoItem();
    window._adtNovoItemCalcTotal       = () => this._calcTotalNovoItem();
  }

  _calcTotalNovoItem() {
    const qtd  = parseFloat(document.getElementById('adt-ni-qtd')?.value) || 0;
    const up   = parseFloat(document.getElementById('adt-ni-up')?.value)  || 0;
    const cfg  = state.get('cfg') || {};
    const bdi  = cfg.bdi || 0.25;
    const tot  = qtd * up * (1 + bdi);
    const el   = document.getElementById('adt-ni-total');
    if (el) {
      const R$ = v => (v || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
      el.textContent = R$(Math.trunc(Math.round(tot * 100 * 100) / 100) / 100);
      el.style.color = tot > 0 ? 'var(--green)' : 'var(--text-muted)';
    }
  }

  _previewPosicaoNovoItem() {
    this._ui.limparErroNovoItem();
    const codigo = (document.getElementById('adt-ni-codigo')?.value || '').trim();
    if (!codigo) {
      this._ui.atualizarPreviewNovoItem('');
      return;
    }

    // Verifica se código já existe
    const jaExiste = _planilhaDraft.find(it => it.id === codigo);
    if (jaExiste) {
      this._ui.atualizarPreviewNovoItem(`⚠️ Código "${codigo}" já existe na planilha.`, '#dc2626');
      return;
    }

    const posApos = this._encontrarPosicaoInsercao(codigo);
    if (posApos === null) {
      this._ui.atualizarPreviewNovoItem(`⚠️ Código "${codigo}" já existe na planilha.`, '#dc2626');
      return;
    }

    if (posApos === -1) {
      this._ui.atualizarPreviewNovoItem(`📌 Será inserido no início da planilha.`, '#2563EB');
    } else {
      const itemAnterior = _planilhaDraft[posApos];
      this._ui.atualizarPreviewNovoItem(
        `📌 Será inserido após: ${itemAnterior.id}${itemAnterior.desc ? ' — ' + itemAnterior.desc.slice(0, 50) : ''}`,
        '#15803d'
      );
    }
  }

  _confirmarNovoItem() {
    this._ui.limparErroNovoItem();
    const form = this._ui.lerModalNovoItem();

    // Validações
    if (!form.codigo) {
      this._ui.mostrarErroNovoItem('⚠️ Informe o código do item.');
      return;
    }
    if (!form.desc) {
      this._ui.mostrarErroNovoItem('⚠️ Informe a descrição do item.');
      return;
    }

    const posApos = this._encontrarPosicaoInsercao(form.codigo);
    if (posApos === null) {
      this._ui.mostrarErroNovoItem(`⚠️ O código "${form.codigo}" já existe na planilha. Escolha um código diferente.`);
      return;
    }

    // Monta novo item
    const novoItem = {
      id:       form.codigo,
      desc:     form.desc,
      un:       form.un  || '',
      qtd:      form.qtd,
      up:       form.up,
      t:        'item',
      _adtNovo: true,
    };

    // Insere na posição correta
    const idxInsercao = posApos + 1; // após posApos (-1 vira 0 → início)
    _planilhaDraft.splice(idxInsercao, 0, novoItem);

    this._ui.fecharModalNovoItem();
    this._renderPlanilha();

    // Scroll até o novo item inserido
    setTimeout(() => {
      const tbody = document.getElementById('adt-pl-tbody');
      if (!tbody) return;
      const rows = tbody.querySelectorAll('tr');
      // Encontra o índice do novo item no draft após inserção
      const draftIdx = _planilhaDraft.findIndex(it => it.id === form.codigo && it._adtNovo);
      // Conta linhas renderizadas até esse índice
      let linhaIdx = 0;
      for (let i = 0; i < draftIdx && i < _planilhaDraft.length; i++) {
        linhaIdx++;
      }
      if (rows[linhaIdx]) {
        rows[linhaIdx].scrollIntoView({ behavior: 'smooth', block: 'center' });
        // Destaca brevemente
        rows[linhaIdx].style.outline = '2px solid var(--accent)';
        setTimeout(() => { if (rows[linhaIdx]) rows[linhaIdx].style.outline = ''; }, 2000);
      }
    }, 120);

    const R$ = v => (v || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
    const cfg = state.get('cfg') || {};
    const bdi = cfg.bdi || 0.25;
    const total = Math.trunc(Math.round(form.qtd * form.up * (1 + bdi) * 100 * 100) / 100) / 100;
    window.toast?.(`★ Item "${form.codigo}" incluído na planilha${total > 0 ? ' · ' + R$(total) : ''}.`, 'ok');
  }

  // ═══════════════════════════════════════════════════════════════════
  // VISUALIZAÇÃO — Planilha do Aditivo (somente leitura)
  // ═══════════════════════════════════════════════════════════════════

  _verPlanilhaAditivo(id) {
    const aditivos = state.get('aditivos') || [];
    const a = aditivos.find(x => x.id === id);
    if (!a) {
      window.toast?.('⚠️ Aditivo não encontrado.', 'warn');
      return;
    }
    _adtViewAtualId = id;
    const cfg = state.get('cfg') || {};
    this._ui.mostrarVisualizacao(a, cfg);
  }

  // ═══════════════════════════════════════════════════════════════════
  // VISUALIZAÇÃO — Snapshot de Versão Contratual
  // ═══════════════════════════════════════════════════════════════════

  async _verVersaoContratual(versaoNum) {
    const versoes = state.get('versoesContratuais') || [];
    let versao = versoes.find(v => v.numero === versaoNum);

    if (!versao) {
      window.toast?.('⚠️ Versão não encontrada.', 'warn');
      return;
    }

    // Se não tem snapshot carregado, tenta do Firebase
    if (!versao.itensSnapshot) {
      try {
        const obraId  = state.get('obraAtivaId');
        const fetched = await FirebaseService.getVersoesContratuais(obraId);
        versao = fetched?.find(v => v.numero === versaoNum) || versao;
      } catch (e) {
        console.warn('[AditivosModule] _verVersaoContratual:', e);
      }
    }

    this._ui.mostrarVersao(versao);
  }

  // ═══════════════════════════════════════════════════════════════════
  // GERAÇÃO DE PDF
  // ═══════════════════════════════════════════════════════════════════

  _gerarPDF() {
    if (!_adtViewAtualId) return;
    const aditivos = state.get('aditivos') || [];
    const a = aditivos.find(x => x.id === _adtViewAtualId);
    if (!a) {
      window.toast?.('⚠️ Aditivo não encontrado.', 'warn');
      return;
    }
    const cfg = state.get('cfg') || {};
    this._ui.gerarPDF(a, cfg);
  }

  /** Gera PDF diretamente por ID (sem precisar abrir modal). */
  gerarPDFPorId(id) {
    const aditivos = state.get('aditivos') || [];
    const a = aditivos.find(x => x.id === id);
    if (!a) {
      window.toast?.('⚠️ Aditivo não encontrado.', 'warn');
      return;
    }
    _adtViewAtualId = id;
    const cfg = state.get('cfg') || {};
    this._ui.gerarPDF(a, cfg);
  }

  // ═══════════════════════════════════════════════════════════════════
  // API pública para outros módulos (dashboard, painel-contratual etc.)
  // ═══════════════════════════════════════════════════════════════════

  /** Retorna totais consolidados de todos os aditivos aprovados da obra. */
  getTotaisAditivos() {
    const aditivos = state.get('aditivos') || [];
    const cfg      = state.get('cfg')      || {};
    const bdi      = cfg.bdi || 0.25;
    let acrescimos = 0, supressoes = 0;

    aditivos.filter(a => a.status === 'Aprovado').forEach(a => {
      const t = calcularTotais(a.itensMudados || [], bdi);
      acrescimos += t.acrescimos;
      supressoes += t.supressoes;
    });

    return {
      acrescimos: trunc2(acrescimos),
      supressoes: trunc2(supressoes),
      liquido:    trunc2(acrescimos - supressoes),
    };
  }

  destroy() {
    this._subs.forEach(u => u());
    this._subs = [];
  }
}
