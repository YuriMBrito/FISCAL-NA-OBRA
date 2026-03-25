/**
 * ╔══════════════════════════════════════════════════════════════════╗
 * ║  FISCAL NA OBRA v16 — modules/aditivos/aditivos-controller.js   ║
 * ║  REESCRITO: toda comunicação via EventDelegate (sem inline)     ║
 * ╚══════════════════════════════════════════════════════════════════╝
 */

import EventBus        from '../../core/EventBus.js';
import state           from '../../core/state.js';
import { formatters }  from '../../utils/formatters.js';
import FirebaseService from '../../firebase/firebase-service.js';
import { AditivosUI }  from './aditivos-ui.js';
import { exposeGlobal } from '../../utils/global-guard.js';
import storageUtils    from '../../utils/storage.js';
import EventDelegate   from '../../utils/event-delegate.js';
import {
  trunc2, gerarDiff, calcularTotais,
  dataParaInput, inputParaData, classificarItem,
} from './aditivos-calculos.js';

const R$ = v => formatters.currency
  ? formatters.currency(v)
  : (v || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });

// ─── Estado interno ───────────────────────────────────────────────
let _planilhaDraft    = [];
let _planilhaBase     = [];
let _itensMudadosPend = null;
let _adtViewAtualId   = null;
let _obraAtivaDraft   = null;

export class AditivosModule {
  constructor() {
    this._ui   = new AditivosUI();
    this._subs = [];
  }

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
    try { this._render(); }
    catch (e) { console.error('[AditivosModule] onEnter:', e); }
  }

  _render() {
    this._ui.renderPagina(_planilhaDraft, _planilhaBase);
  }

  // ═══════════════════════════════════════════════════════════════
  // BINDINGS
  // ═══════════════════════════════════════════════════════════════

  _bindGlobals() {
    // window.* para retrocompatibilidade
    exposeGlobal('abrirModalNovoAditivo',     () => this._novoAditivo());
    exposeGlobal('_adtEditar',                (id) => this._editarAditivo(id));
    exposeGlobal('_adtExcluir',               (id) => this._excluirAditivo(id));
    exposeGlobal('_adtVerPlanilha',           (id) => this._verPlanilhaAditivo(id));
    exposeGlobal('_adtVerVersao',             (n)  => this._verVersaoContratual(n));
    exposeGlobal('_adtFecharModal',           ()   => this._ui.fecharModal());
    exposeGlobal('_adtSalvar',                ()   => this._salvarAditivo());
    exposeGlobal('_adtCalcVariacao',          ()   => this._calcVariacao());
    exposeGlobal('_adtCalcTermino',           ()   => this._calcTermino());
    exposeGlobal('_adtOnStatusChange',        (v)  => this._onStatusChange(v));
    exposeGlobal('_adtGerarPDF',              ()   => this._gerarPDF());
    exposeGlobal('_adtAbrirPlanilhaEditor',   ()   => this._abrirPlanilhaEditor());
    exposeGlobal('_adtFecharPlanilhaEditor',  ()   => this._fecharPlanilhaEditor());
    exposeGlobal('_adtPlanilhaReset',         ()   => this._resetarPlanilha());
    exposeGlobal('_adtPlanilhaAplicar',       ()   => this._aplicarPlanilha());
    exposeGlobal('_adtPlanilhaEditQtd',       (i, v) => this._planilhaEditarQtd(parseInt(i), parseFloat(v) || 0));
    exposeGlobal('_adtPlanilhaEditUp',        (i, v) => this._planilhaEditarUp(parseInt(i), parseFloat(v) || 0));
    exposeGlobal('_adtPlanilhaEditDesc',      (i, v) => this._planilhaEditarDesc(parseInt(i), v));
    exposeGlobal('_adtPlanilhaRemover',       (i)    => this._planilhaRemoverItem(parseInt(i)));
    exposeGlobal('_adtPlanilhaRestaurar',     (i)    => this._planilhaRestaurarItem(parseInt(i)));
    exposeGlobal('_adtPlanilhaAdicionarItem', ()   => this._planilhaAdicionarItem());
    exposeGlobal('_adtNovoItemPreviewPosicao',()   => this._previewPosicaoNovoItem());
    exposeGlobal('_adtNovoItemCalcTotal',     ()   => this._calcTotalNovoItem());

    // EventDelegate — registra todos os data-action do módulo.
    // Handlers de input numérico só re-renderizam no evento 'change' (blur),
    // não no 'input' (tecla), para não perder o foco do campo.
    EventDelegate.registerAll({
      'abrirModalNovoAditivo':     ()         => this._novoAditivo(),
      '_adtSalvar':                ()         => this._salvarAditivo(),
      '_adtEditar':                (id)       => this._editarAditivo(id),
      '_adtExcluir':               (id)       => this._excluirAditivo(id),
      '_adtVerPlanilha':           (id)       => this._verPlanilhaAditivo(id),
      '_adtVerVersao':             (n)        => this._verVersaoContratual(n),
      '_adtFecharModal':           ()         => this._ui.fecharModal(),
      '_adtFecharViewModal':       ()         => { const el = document.getElementById('adt-view-modal-overlay'); if (el) el.style.display = 'none'; },
      '_adtFecharVersaoModal':     ()         => { const el = document.getElementById('adt-versao-modal-overlay'); if (el) el.style.display = 'none'; },
      '_adtGerarPDF':              ()         => this._gerarPDF(),
      '_adtAbrirPlanilhaEditor':   ()         => this._abrirPlanilhaEditor(),
      '_adtFecharPlanilhaEditor':  ()         => this._fecharPlanilhaEditor(),
      '_adtPlanilhaReset':         ()         => this._resetarPlanilha(),
      '_adtPlanilhaAplicar':       ()         => this._aplicarPlanilha(),
      '_adtPlanilhaAdicionarItem': ()         => this._planilhaAdicionarItem(),
      '_adtPlanilhaRemover':       (i)        => this._planilhaRemoverItem(parseInt(i)),
      '_adtPlanilhaRestaurar':     (i)        => this._planilhaRestaurarItem(parseInt(i)),
      '_adtNovoItemFechar':        ()         => this._ui.fecharModalNovoItem(),
      '_adtNovoItemConfirmar':     ()         => this._confirmarNovoItem(),

      // Inputs da planilha — só re-renderiza em 'change' (blur/Enter), não em 'input'
      '_adtPlanilhaEditQtd': (i, v, evt) => {
        const idx = parseInt(i);
        if (evt && evt.type === 'input') {
          // Durante digitação: apenas salva no draft sem re-render
          if (_planilhaDraft[idx]) _planilhaDraft[idx].qtd = parseFloat(v) || 0;
          return;
        }
        this._planilhaEditarQtd(idx, parseFloat(v) || 0);
      },
      '_adtPlanilhaEditUp': (i, v, evt) => {
        const idx = parseInt(i);
        if (evt && evt.type === 'input') {
          if (_planilhaDraft[idx]) _planilhaDraft[idx].up = parseFloat(v) || 0;
          return;
        }
        this._planilhaEditarUp(idx, parseFloat(v) || 0);
      },
      '_adtPlanilhaEditDesc': (i, v) => {
        this._planilhaEditarDesc(parseInt(i), v);
      },

      // Modal do aditivo — campos que precisam reagir a input
      '_adtCalcVariacao':   ()    => this._calcVariacao(),
      '_adtCalcTermino':    ()    => this._calcTermino(),
      '_adtOnStatusChange': (v)   => this._onStatusChange(v),

      // Modal de novo item
      '_adtNovoItemPreviewPosicao': () => this._previewPosicaoNovoItem(),
      '_adtNovoItemCalcTotal':      () => this._calcTotalNovoItem(),
    });
  }

  _bindEvents() {
    this._subs.push(
      EventBus.on('obra:changed', async ({ obraId }) => {
        await this._carregarDados(obraId);
        this._render();
      }, 'aditivos'),
      EventBus.on('itens:updated', () => { this._render(); }, 'aditivos'),
    );
  }

  // ═══════════════════════════════════════════════════════════════
  // CARREGAMENTO
  // ═══════════════════════════════════════════════════════════════

  async _carregarDados(obraId) {
    if (!obraId) return;
    try {
      const adts   = await FirebaseService.getAditivos(obraId);
      state.set('aditivos', adts || []);
      const versoes = await FirebaseService.getVersoesContratuais(obraId);
      state.set('versoesContratuais', versoes || []);
      await this._garantirVersaoOriginal(obraId);
      const todasVersoes = state.get('versoesContratuais') || [];
      const maxVer = todasVersoes.length
        ? Math.max(...todasVersoes.map(v => v.numero)) : 1;
      state.set('obraMeta', { ...state.get('obraMeta'), contractVersion: maxVer });
      _planilhaDraft = []; _planilhaBase = [];
      _itensMudadosPend = null; _obraAtivaDraft = null;
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
      numero: 1, tipo: 'original', aditivoId: null,
      descricao: 'Contrato Original',
      cfgSnapshot:   JSON.parse(JSON.stringify(cfg)),
      itensSnapshot: JSON.parse(JSON.stringify(itens)),
      criadoEm: new Date().toISOString(),
    };
    versoes.push(v1);
    state.set('versoesContratuais', versoes);
    try { await FirebaseService.salvarVersaoContratual(obraId, v1); } catch {}
  }

  // ═══════════════════════════════════════════════════════════════
  // CRUD
  // ═══════════════════════════════════════════════════════════════

  async _novoAditivo() {
    const obraId = state.get('obraAtivaId');
    if (!obraId) { window.toast?.('⚠️ Selecione uma obra antes de criar um aditivo.', 'warn'); return; }
    await this._inicializarDraftPlanilha();
    const aditivos = state.get('aditivos') || [];
    const cfg      = state.get('cfg') || {};
    this._ui.abrirModal('Novo Aditivo');
    this._ui.preencherModalNovo(aditivos, cfg);
    _itensMudadosPend = null;
    const elAviso = document.getElementById('adt-planilha-aviso-pendente');
    if (elAviso) elAviso.style.display = 'none';
  }

  _editarAditivo(id) {
    const a = (state.get('aditivos') || []).find(x => x.id === id);
    if (!a) return;
    if (a.status === 'Aprovado') { window.toast?.('⚠️ Aditivos aprovados são imutáveis.', 'warn'); return; }
    _itensMudadosPend = a.itensMudados ? JSON.parse(JSON.stringify(a.itensMudados)) : null;
    this._ui.abrirModal(`Editar Aditivo Nº ${String(a.numero).padStart(2, '0')}`);
    this._ui.preencherModalEditar(a);
  }

  async _excluirAditivo(id) {
    const aditivos = state.get('aditivos') || [];
    const a = aditivos.find(x => x.id === id);
    if (!a) return;
    if (a.status === 'Aprovado') { window.toast?.('⚠️ Aditivos aprovados são imutáveis.', 'warn'); return; }
    if (!confirm(`🗑️ Mover Aditivo Nº ${String(a.numero).padStart(2, '0')} para a Lixeira?`)) return;
    const obraId = state.get('obraAtivaId');
    const user   = state.get('usuarioLogado') || {};
    const meta   = { excluidoPor: { uid: user.uid||'', email: user.email||'', nome: user.displayName||'' }, moduloOrigem: 'aditivos', obraId };
    const lxLabel = `Aditivo Nº ${String(a.numero).padStart(2,'0')} — ${a.descricao || ''}`;
    storageUtils.lixeiraEnviar('aditivo', lxLabel, { aditivo: { ...a }, obraId }, meta);
    try { await FirebaseService.salvarItemLixeiraFirebase({ id: `lx_${Date.now()}`, tipo: 'aditivo', label: lxLabel, obraId, excluidoEm: new Date().toISOString(), ...meta, dados: { aditivo: { ...a }, obraId } }); } catch {}
    state.set('aditivos', aditivos.filter(x => x.id !== id));
    try { await FirebaseService.deleteAditivo(obraId, id); } catch {}
    EventBus.emit('lixeira:atualizada', {});
    this._render();
    window.toast?.('🗑️ Aditivo movido para a lixeira.', 'warn');
  }

  async _salvarAditivo() {
    const form = this._ui.lerModal();
    if (!form.descricao) { window.toast?.('⚠️ Informe a descrição do aditivo.', 'warn'); return; }
    if (form.status === 'Aprovado' && !form.processo.trim()) {
      window.toast?.('⚠️ Informe o Número do Processo Administrativo antes de aprovar.', 'warn');
      document.getElementById('adt-processo')?.focus();
      return;
    }

    // Verificação de limite legal 25%
    if (form.status === 'Aprovado') {
      const aditivos     = state.get('aditivos') || [];
      const cfg          = state.get('cfg') || {};
      const valorInicial = parseFloat(cfg.valor) || 0;
      if (valorInicial > 0) {
        const adAprov = aditivos.filter(a => a.status === 'Aprovado' && a.id !== form.editId);
        let totalAcr = 0, totalSup = 0;
        adAprov.forEach(a => {
          const d = parseFloat(a.variacaoValor) || 0;
          if (d > 0) totalAcr += d; else totalSup += Math.abs(d);
        });
        const dAtual = (form.valorNovo || 0) - (form.valorAnterior || 0);
        if (dAtual > 0) totalAcr += dAtual; else totalSup += Math.abs(dAtual);
        const pctA = (totalAcr / valorInicial) * 100;
        const pctS = (totalSup / valorInicial) * 100;
        if (pctA > 25 || pctS > 25) {
          const msg = `⚠️ ATENÇÃO — Limite legal de 25% (Lei 14.133/2021 Art. 125)\nAcréscimos: ${pctA.toFixed(1)}% | Supressões: ${pctS.toFixed(1)}%\nDeseja prosseguir mesmo assim?`;
          if (!confirm(msg)) return;
          window.auditRegistrar?.({ modulo: 'Aditivos', tipo: 'alerta_limite_legal', registro: `Aditivo Nº ${String(form.numero).padStart(2,'0')}`, detalhe: `Limite de 25% ultrapassado — acréscimos: ${pctA.toFixed(2)}%, supressões: ${pctS.toFixed(2)}%.` });
        }
      }
    }

    // Recalcula diff
    if (_planilhaDraft.length > 0 && _planilhaBase.length > 0 && _obraAtivaDraft === state.get('obraAtivaId')) {
      _itensMudadosPend = {
        itensMudados:  gerarDiff(_planilhaDraft, _planilhaBase),
        itensSnapshot: JSON.parse(JSON.stringify(_planilhaDraft)),
      };
    }

    const obraId   = state.get('obraAtivaId');
    const aditivos = state.get('aditivos') || [];
    const obraMeta = state.get('obraMeta') || { contractVersion: 1 };
    const novaVerNum = obraMeta.contractVersion + (form.editId ? 0 : 1);
    let itensMudados = [], itensSnapshot = [];
    if (_itensMudadosPend) {
      if (Array.isArray(_itensMudadosPend)) {
        itensMudados = _itensMudadosPend;
      } else {
        itensMudados  = _itensMudadosPend.itensMudados  || [];
        itensSnapshot = _itensMudadosPend.itensSnapshot || [];
      }
    }

    const aditivo = {
      id:                      form.editId || `adt_${String(form.numero).padStart(2,'0')}_${Date.now()}`,
      numero:                  form.numero,
      tipo:                    form.tipo,
      descricao:               form.descricao,
      numeroProcesso:          form.processo || null,
      data:                    form.data ? inputParaData(form.data) : null,
      valorAnterior:           form.valorAnterior || null,
      valorNovo:               form.valorNovo || null,
      variacaoValor:           (form.valorAnterior && form.valorNovo) ? trunc2(form.valorNovo - form.valorAnterior) : null,
      percentualVariacao:      (form.valorAnterior && form.valorNovo && form.valorAnterior > 0) ? trunc2((form.valorNovo - form.valorAnterior) / form.valorAnterior * 100) : null,
      terminoAnterior:         form.terminoAnterior ? inputParaData(form.terminoAnterior) : null,
      prazoAdicionalDias:      form.prazoAdicional || null,
      terminoNovo:             form.terminoNovo ? inputParaData(form.terminoNovo) : null,
      contractVersionAnterior: obraMeta.contractVersion,
      contractVersionNova:     form.editId ? (aditivos.find(a => a.id === form.editId)?.contractVersionNova || novaVerNum) : novaVerNum,
      status:                  form.status,
      itensMudados, itensSnapshot,
      criadoEm:    form.editId ? (aditivos.find(a => a.id === form.editId)?.criadoEm || new Date().toISOString()) : new Date().toISOString(),
      atualizadoEm: new Date().toISOString(),
    };

    _itensMudadosPend = null;
    const idx  = aditivos.findIndex(a => a.id === aditivo.id);
    const novos = [...aditivos];
    if (idx >= 0) novos[idx] = aditivo; else novos.push(aditivo);
    state.set('aditivos', novos);
    try { await FirebaseService.salvarAditivo(obraId, aditivo); } catch {}

    if (form.status === 'Aprovado' && !form.editId) {
      await this._aplicarVersaoContratual(aditivo, obraId);
    }

    this._ui.fecharModal();
    this._render();
    window.toast?.(`✅ Aditivo Nº ${String(form.numero).padStart(2,'0')} salvo!`);
    EventBus.emit('aditivos:changed', { obraId });
  }

  // ═══════════════════════════════════════════════════════════════
  // CÁLCULOS DO FORMULÁRIO
  // ═══════════════════════════════════════════════════════════════

  _calcVariacao() {
    const ant = parseFloat(document.getElementById('adt-valor-anterior')?.value) || 0;
    const nov = parseFloat(document.getElementById('adt-valor-novo')?.value)     || 0;
    const el  = document.getElementById('adt-variacao');
    if (!el) return;
    if (ant && nov) {
      const v   = trunc2(nov - ant);
      const pct = ant > 0 ? (v / ant * 100) : 0;
      el.value = `${v >= 0 ? '+' : ''}${R$(v)} (${pct >= 0 ? '+' : ''}${pct.toFixed(1)}%)`;
    } else { el.value = ''; }
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
    } else { el.value = ''; }
  }

  _onStatusChange(valor) {
    const aviso = document.getElementById('adt-aviso-versao');
    if (aviso) aviso.style.display = valor === 'Aprovado' ? 'block' : 'none';
  }

  // ═══════════════════════════════════════════════════════════════
  // VERSIONAMENTO
  // ═══════════════════════════════════════════════════════════════

  async _aplicarVersaoContratual(aditivo, obraId) {
    const obraMeta = state.get('obraMeta') || { contractVersion: 1 };
    const versoes  = state.get('versoesContratuais') || [];
    const cfg      = state.get('cfg') || {};
    const itens    = state.get('itensContrato') || [];
    const bms      = state.get('bms') || [];
    const novaNum  = aditivo.contractVersionNova;

    const novaVersao = {
      numero: novaNum, tipo: 'aditivo', aditivoId: aditivo.id,
      descricao: `${String(aditivo.numero).padStart(2,'0')}º Aditivo — ${aditivo.descricao?.slice(0,60)||''}`,
      cfgSnapshot:   JSON.parse(JSON.stringify(cfg)),
      itensSnapshot: JSON.parse(JSON.stringify(itens)),
      itensMudados:  JSON.parse(JSON.stringify(aditivo.itensMudados || [])),
      criadoEm: new Date().toISOString(),
    };
    if (aditivo.valorNovo)   novaVersao.cfgSnapshot.valor   = aditivo.valorNovo;
    if (aditivo.terminoNovo) novaVersao.cfgSnapshot.termino = aditivo.terminoNovo;

    try {
      await FirebaseService.salvarVersaoContratual(obraId, novaVersao);
    } catch (e) {
      console.error('[AditivosModule] salvarVersaoContratual FALHOU:', e);
      const adts = state.get('aditivos') || [];
      const i    = adts.findIndex(a => a.id === aditivo.id);
      if (i >= 0) { adts[i] = { ...adts[i], status: 'Rascunho' }; state.set('aditivos', adts); try { await FirebaseService.salvarAditivo(obraId, adts[i]); } catch {} }
      window.toast?.('❌ Falha ao criar versão contratual. Aditivo revertido para Rascunho.', 'error');
      this._render(); return;
    }

    state.set('versoesContratuais', [...versoes, novaVersao]);
    const novoCfg = { ...cfg };
    if (aditivo.valorNovo)          novoCfg.valor   = aditivo.valorNovo;
    if (aditivo.terminoNovo)        novoCfg.termino = aditivo.terminoNovo;
    if (aditivo.prazoAdicionalDias) novoCfg.duracaoDias = (novoCfg.duracaoDias || 0) + aditivo.prazoAdicionalDias;
    state.set('cfg', novoCfg);
    try { await FirebaseService.setObraCfg(obraId, novoCfg, state.get('statusObra')); } catch {}
    state.set('obraMeta', { ...obraMeta, contractVersion: novaNum });
    const bmEmAndamento = [...bms].reverse().find(b => b.status !== 'Aprovado');
    if (bmEmAndamento) { bmEmAndamento.contractVersion = novaNum; state.set('bms', bms); try { await FirebaseService.setBMs(obraId, bms); } catch {} }
    _planilhaDraft = []; _planilhaBase = []; _itensMudadosPend = null; _obraAtivaDraft = null;
    window.toast?.(`🔒 Versão Contratual v${novaNum} criada!`);
    EventBus.emit('contrato:versao_criada', { versao: novaNum, obraId });
  }

  // ═══════════════════════════════════════════════════════════════
  // EDITOR DE PLANILHA
  // ═══════════════════════════════════════════════════════════════

  async _inicializarDraftPlanilha() {
    const obraId = state.get('obraAtivaId');
    if (_planilhaDraft.length && _obraAtivaDraft === obraId) return;
    if (_planilhaDraft.length && _obraAtivaDraft !== obraId) {
      _planilhaDraft = []; _planilhaBase = []; _itensMudadosPend = null;
    }

    const obraMeta = state.get('obraMeta') || { contractVersion: 1 };
    const itens    = state.get('itensContrato') || [];
    const versoes  = state.get('versoesContratuais') || [];
    const verAtual = obraMeta.contractVersion || 1;
    let baseItens  = null;

    try {
      const snap = versoes.find(v => v.numero === verAtual);
      if (snap?.itensSnapshot) {
        baseItens = JSON.parse(JSON.stringify(snap.itensSnapshot));
      } else {
        const fetched = await FirebaseService.getVersoesContratuais(obraId);
        const fv = fetched?.find(v => v.numero === verAtual);
        baseItens = fv?.itensSnapshot ? JSON.parse(JSON.stringify(fv.itensSnapshot)) : null;
      }
    } catch {}

    _planilhaBase   = baseItens || JSON.parse(JSON.stringify(itens));
    _planilhaDraft  = JSON.parse(JSON.stringify(itens));
    _obraAtivaDraft = obraId;
    _planilhaDraft.forEach(it => { delete it._adtStatus; delete it._adtRemovido; });
  }

  _abrirPlanilhaEditor() {
    if (!_planilhaDraft.length) {
      this._inicializarDraftPlanilha()
        .then(() => { this._ui.abrirPlanilhaEditor(); this._renderPlanilha(); })
        .catch(() => window.toast?.('⚠️ Erro ao carregar a planilha. Verifique a conexão.', 'warn'));
    } else {
      this._ui.abrirPlanilhaEditor();
      this._renderPlanilha();
    }
  }

  _fecharPlanilhaEditor() {
    if (_planilhaDraft.length && _planilhaBase.length) {
      const diff = gerarDiff(_planilhaDraft, _planilhaBase);
      const jaAplicado = _itensMudadosPend &&
        JSON.stringify((_itensMudadosPend.itensMudados || [])) === JSON.stringify(diff);
      if (diff.length > 0 && !jaAplicado) {
        const el = document.getElementById('adt-planilha-aviso-pendente');
        if (el) el.style.display = 'block';
      }
    }
    this._ui.fecharPlanilhaEditor();
  }

  _renderPlanilha() {
    this._ui.renderPlanilha(_planilhaDraft, _planilhaBase, state.get('cfg') || {});
  }

  async _resetarPlanilha() {
    const temAlteracoes = _planilhaDraft.some(it =>
      it._adtNovo || it._adtRemovido || classificarItem(it, _planilhaBase) !== 'original');
    if (temAlteracoes && !confirm('↩ Resetar planilha? Todas as alterações não salvas serão descartadas.')) return;
    _planilhaDraft = []; _planilhaBase = []; _itensMudadosPend = null;
    await this._inicializarDraftPlanilha();
    this._renderPlanilha();
    window.toast?.('↩ Planilha resetada.', 'info');
  }

  _aplicarPlanilha() {
    const diff = gerarDiff(_planilhaDraft, _planilhaBase);
    _itensMudadosPend = { itensMudados: diff, itensSnapshot: JSON.parse(JSON.stringify(_planilhaDraft)) };
    const ni = diff.length;
    const el = document.getElementById('adt-planilha-status');
    if (el) el.textContent = ni > 0 ? `✅ ${ni} alteração(ões) aplicada(s)` : '⚠️ Nenhuma alteração';
    const elAviso = document.getElementById('adt-planilha-aviso-pendente');
    if (elAviso) elAviso.style.display = 'none';
    this._ui.fecharPlanilhaEditor();
    window.toast?.(ni > 0 ? `✅ ${ni} item(ns) alterado(s) aplicado(s)` : '⚠️ Nenhuma alteração.', ni > 0 ? 'ok' : 'warn');
  }

  _planilhaEditarQtd(idx, val) {
    if (_planilhaDraft[idx] === undefined) return;
    _planilhaDraft[idx].qtd = val;
    this._renderPlanilha();
  }

  _planilhaEditarUp(idx, val) {
    if (_planilhaDraft[idx] === undefined) return;
    _planilhaDraft[idx].up = val;
    this._renderPlanilha();
  }

  _planilhaEditarDesc(idx, val) {
    if (_planilhaDraft[idx] === undefined) return;
    _planilhaDraft[idx].desc = val;
    // Não re-renderiza para não perder o foco
  }

  _planilhaRemoverItem(idx) {
    if (_planilhaDraft[idx] === undefined) return;
    const it = _planilhaDraft[idx];
    const existeNaBase = _planilhaBase.find(b => b.id === it.id);
    if (!existeNaBase) _planilhaDraft.splice(idx, 1);
    else _planilhaDraft[idx]._adtRemovido = true;
    this._renderPlanilha();
  }

  _planilhaRestaurarItem(idx) {
    if (_planilhaDraft[idx] === undefined) return;
    delete _planilhaDraft[idx]._adtRemovido;
    const base = _planilhaBase.find(b => b.id === _planilhaDraft[idx].id);
    if (base) { _planilhaDraft[idx].qtd = base.qtd; _planilhaDraft[idx].up = base.up; }
    this._renderPlanilha();
  }

  // ─── Posicionamento de novo item ──────────────────────────────

  _parseCodigo(codigo) {
    if (!codigo) return [];
    return String(codigo).trim().split('.').map(p => { const n = parseInt(p, 10); return isNaN(n) ? 0 : n; });
  }

  _compararCodigos(a, b) {
    const pa = this._parseCodigo(a), pb = this._parseCodigo(b);
    const len = Math.max(pa.length, pb.length);
    for (let i = 0; i < len; i++) {
      const va = pa[i] || 0, vb = pb[i] || 0;
      if (va !== vb) return va - vb;
    }
    return 0;
  }

  _encontrarPosicaoInsercao(novoCodigo) {
    let posicaoApos = -1;
    for (let i = 0; i < _planilhaDraft.length; i++) {
      const it = _planilhaDraft[i];
      if (!it.id) continue;
      const cmp = this._compararCodigos(it.id, novoCodigo);
      if (cmp < 0) posicaoApos = i;
      else if (cmp === 0) return null;
    }
    return posicaoApos;
  }

  _planilhaAdicionarItem() {
    if (!_planilhaDraft.length) {
      this._inicializarDraftPlanilha()
        .then(() => {
          if (!_planilhaDraft.length) { window.toast?.('⚠️ Planilha base não carregada.', 'warn'); return; }
          this._ui.abrirModalNovoItem();
        })
        .catch(() => window.toast?.('⚠️ Erro ao carregar a planilha.', 'warn'));
    } else {
      this._ui.abrirModalNovoItem();
    }
    // Também registra como window.* para compatibilidade
    window._adtNovoItemFechar         = () => this._ui.fecharModalNovoItem();
    window._adtNovoItemConfirmar      = () => this._confirmarNovoItem();
    window._adtNovoItemPreviewPosicao = () => this._previewPosicaoNovoItem();
    window._adtNovoItemCalcTotal      = () => this._calcTotalNovoItem();
  }

  _calcTotalNovoItem() {
    const qtd = parseFloat(document.getElementById('adt-ni-qtd')?.value) || 0;
    const up  = parseFloat(document.getElementById('adt-ni-up')?.value)  || 0;
    const bdi = (state.get('cfg') || {}).bdi || 0.25;
    const tot = Math.trunc(Math.round(qtd * up * (1 + bdi) * 100 * 100) / 100) / 100;
    const el  = document.getElementById('adt-ni-total');
    if (el) { el.textContent = R$(tot); el.style.color = tot > 0 ? 'var(--green)' : 'var(--text-muted)'; }
  }

  _previewPosicaoNovoItem() {
    this._ui.limparErroNovoItem();
    const codigo = (document.getElementById('adt-ni-codigo')?.value || '').trim();
    if (!codigo) { this._ui.atualizarPreviewNovoItem(''); return; }
    if (_planilhaDraft.find(it => it.id === codigo)) {
      this._ui.atualizarPreviewNovoItem(`⚠️ Código "${codigo}" já existe.`, '#dc2626'); return;
    }
    const posApos = this._encontrarPosicaoInsercao(codigo);
    if (posApos === null) {
      this._ui.atualizarPreviewNovoItem(`⚠️ Código "${codigo}" já existe.`, '#dc2626');
    } else if (posApos === -1) {
      this._ui.atualizarPreviewNovoItem('📌 Será inserido no início da planilha.', '#2563EB');
    } else {
      const it = _planilhaDraft[posApos];
      this._ui.atualizarPreviewNovoItem(`📌 Após: ${it.id}${it.desc ? ' — ' + it.desc.slice(0,50) : ''}`, '#15803d');
    }
  }

  _confirmarNovoItem() {
    this._ui.limparErroNovoItem();
    const form = this._ui.lerModalNovoItem();
    if (!form.codigo) { this._ui.mostrarErroNovoItem('⚠️ Informe o código do item.'); return; }
    if (!form.desc)   { this._ui.mostrarErroNovoItem('⚠️ Informe a descrição.'); return; }
    const posApos = this._encontrarPosicaoInsercao(form.codigo);
    if (posApos === null) { this._ui.mostrarErroNovoItem(`⚠️ Código "${form.codigo}" já existe.`); return; }
    const novoItem = { id: form.codigo, desc: form.desc, un: form.un || '', qtd: form.qtd, up: form.up, t: 'item', _adtNovo: true };
    _planilhaDraft.splice(posApos + 1, 0, novoItem);
    this._ui.fecharModalNovoItem();
    this._renderPlanilha();
    window.toast?.(`★ Item "${form.codigo}" incluído.`, 'ok');
  }

  // ═══════════════════════════════════════════════════════════════
  // VISUALIZAÇÃO
  // ═══════════════════════════════════════════════════════════════

  _verPlanilhaAditivo(id) {
    const a = (state.get('aditivos') || []).find(x => x.id === id);
    if (!a) { window.toast?.('⚠️ Aditivo não encontrado.', 'warn'); return; }
    _adtViewAtualId = id;
    this._ui.mostrarVisualizacao(a, state.get('cfg') || {});
  }

  async _verVersaoContratual(versaoNum) {
    const versoes = state.get('versoesContratuais') || [];
    let versao = versoes.find(v => v.numero === versaoNum);
    if (!versao) { window.toast?.('⚠️ Versão não encontrada.', 'warn'); return; }
    if (!versao.itensSnapshot) {
      try {
        const fetched = await FirebaseService.getVersoesContratuais(state.get('obraAtivaId'));
        versao = fetched?.find(v => v.numero === versaoNum) || versao;
      } catch {}
    }
    this._ui.mostrarVersao(versao);
  }

  _gerarPDF() {
    if (!_adtViewAtualId) return;
    const a = (state.get('aditivos') || []).find(x => x.id === _adtViewAtualId);
    if (!a) return;
    this._ui.gerarPDF(a, state.get('cfg') || {});
  }

  // ═══════════════════════════════════════════════════════════════
  // API PÚBLICA
  // ═══════════════════════════════════════════════════════════════

  getTotaisAditivos() {
    const aditivos = state.get('aditivos') || [];
    const bdi      = (state.get('cfg') || {}).bdi || 0.25;
    let acrescimos = 0, supressoes = 0;
    aditivos.filter(a => a.status === 'Aprovado').forEach(a => {
      const t = calcularTotais(a.itensMudados || [], bdi);
      acrescimos += t.acrescimos; supressoes += t.supressoes;
    });
    return { acrescimos: trunc2(acrescimos), supressoes: trunc2(supressoes), liquido: trunc2(acrescimos - supressoes) };
  }

  destroy() { this._subs.forEach(u => u()); this._subs = []; }
}
