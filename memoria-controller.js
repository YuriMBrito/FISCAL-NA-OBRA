/**
 * ╔══════════════════════════════════════════════════════════════╗
 * ║  FISCAL NA OBRA v15.1 — modules/memoria-calculo/memoria-controller.js ║
 * ║  Memória de Cálculo — Regras de negócio                     ║
 * ╚══════════════════════════════════════════════════════════════╝
 *
 * Portado de: renderMemoria(), adicionarLinha(), deletarLinha(),
 *   atualizarDimensao(), toggleMemItem(), _mfxAbrir(), _mfxSalvar()
 */

import EventBus        from '../../core/EventBus.js';
import state           from '../../core/state.js';
import router          from '../../core/router.js';
import FirebaseService from '../../firebase/firebase-service.js';
import { formatters }  from '../../utils/formatters.js';
import {
  getMedicoes, salvarMedicoes, invalidarCacheMedicoes, _injetarCacheMedicoes, getLinhasItem, getFxFormula,
  sumLinhasQtd, calcDimensional, fxCalc, novoId,
  getValorAcumuladoTotal, getValorAcumuladoAnterior, getValorMedicaoAtual,
  getValorMedicaoAtualMem, getValorAcumuladoTotalMem, classUnd,
  getQtdAcumuladoTotalItem, getQtdAcumuladoAnteriorItem, getQtdMedicaoItemNoBm,
} from '../boletim-medicao/bm-calculos.js';
import { MemoriaUI } from './memoria-ui.js';
import { baixarCSV, numCSV } from '../../utils/csv-export.js';
import { scrollAfterAdd }    from '../../utils/scroll-guard.js';
import { patchText, patchRow, guardFocus } from '../../utils/dom-patcher.js';

/** Converte qualquer valor em número finito seguro */
function safeNumLocal(v) {
  const n = parseFloat(v);
  return isFinite(n) ? n : 0;
}

export class MemoriaModule {
  constructor() {
    this._subs         = [];
    this._bmAtual      = 1;
    this._storeAtual   = null;
    this._prevQtyMap   = {};
    this._expandidos   = new Set();
    this._isEditingInline  = false; // Previne re-render durante digitação
  }

  async init() {
    try {
      this._ui = new MemoriaUI(this);
      this._bindEvents();
      this._exposeGlobals();
    } catch (e) {
      console.error('[MemoriaModule] init:', e);
    }
  }

  onEnter() {
    try {
      const obraId = state.get('obraAtivaId');
      const bmNum  = parseInt(document.getElementById('sel-mem-bm')?.value || 1);
      this._carregarMedicoesBM(obraId, bmNum).then(() => this._renderMemoria()).catch(e => {
        console.error('[MemoriaModule] onEnter — carregar medições:', e);
        window.toast?.('⚠️ Erro ao carregar medições. Tente novamente.', 'warn');
      });
    } catch (e) {
      console.error('[MemoriaModule] onEnter:', e);
    }
  }

  // ── Carrega medições do Firebase para o cache em memória ──────
  // Carrega TODOS os BMs para garantir cálculo correto do Acumulado Total.
  async _carregarMedicoesBM(obraId, bmNum) {
    if (!obraId) return;
    const bms = state.get('bms') || [];
    const totalBMs = Math.max(bmNum, bms.length > 0 ? bms[bms.length - 1].num : bmNum);

    try {
      const promises = [];
      for (let n = 1; n <= totalBMs; n++) {
        // CORREÇÃO: não sobrescreve BMs que já têm dados no cache.
        // O cache é atualizado em tempo real por salvarMedicoes; buscar Firebase
        // aqui sobrescreveria dados não-salvos/editados recentemente.
        const _cached = getMedicoes(obraId, n);
        if (Object.keys(_cached).length > 0) continue;
        promises.push(
          FirebaseService.getMedicoes(obraId, n)
            .then(med => {
              if (med && Object.keys(med).length > 0) {
                _injetarCacheMedicoes(obraId, n, med);
              }
            })
            .catch(e => console.error(`[MemoriaModule] _carregarMedicoesBM BM${n}:`, e))
        );
      }
      await Promise.all(promises);
    } catch (e) {
      console.error('[MemoriaModule] _carregarMedicoesBM:', e);
    }
  }

  // ── Render principal ─────────────────────────────────────────

  _renderMemoria() {
    const sel   = document.getElementById('sel-mem-bm');
    const bmNum = sel ? parseInt(sel.value) || 1 : 1;
    this._renderBM(bmNum);
  }

  _renderBM(bmNum) {
    const obraId = state.get('obraAtivaId');
    const bms    = state.get('bms');
    const itens  = state.get('itensContrato');
    const cfg    = state.get('cfg');
    const bm     = bms.find(b => b.num === bmNum) || bms[0];
    if (!bm) return;

    const _bmAnterior = this._bmAtual; // salva BM anterior ANTES de atualizar
    this._bmAtual    = bmNum;

    // BUGFIX: Proteção contra cache vazio sobrescrevendo dados válidos em memória.
    // Se o cache foi invalidado externamente, getMedicoes() retornaria {}, apagando
    // this._storeAtual e perdendo linhas não preenchidas. Verificamos antes de atribuir.
    // CORREÇÃO: a proteção só se aplica ao RE-RENDER do MESMO BM.
    // Ao TROCAR de BM, sempre usa o cache (pode ser {} para BM novo → importação automática).
    const cachedStore = getMedicoes(obraId, bmNum);
    const _isMesmoBM  = (bmNum === _bmAnterior);
    if (_isMesmoBM &&
        Object.keys(cachedStore).length === 0 &&
        this._storeAtual &&
        Object.keys(this._storeAtual).length > 0) {
      // Re-render do mesmo BM com cache vazio: reinjetamos e mantemos o store atual
      _injetarCacheMedicoes(obraId, bmNum, this._storeAtual);
    } else {
      this._storeAtual = cachedStore;
    }

    // ── Importação automática do BM anterior ────────────────
    // Se o BM atual não tem linhas, importa do BM anterior
    if (bmNum > 1) {
      this._importarDoBmAnterior(obraId, bmNum, itens);
    }

    // Mapa de Acumulado Anterior (soma de todos os BMs anteriores)
    this._prevQtyMap = {};
    if (bmNum > 1) {
      itens.forEach(it => {
        if (it.t) return;
        this._prevQtyMap[it.id] = getQtdAcumuladoTotalItem(
          obraId, bmNum - 1, it.id, itens
        );
      });
    }

    this._ui.renderTabela(bmNum, bm, itens, cfg, obraId, this._storeAtual, this._prevQtyMap, this._expandidos);

    // Atualiza visual dos controles de bloqueio ao trocar de BM
    requestAnimationFrame(() => this._atualizarControleBloqueioMem());
  }

  // ── Importar memória do BM anterior ──────────────────────────
  /**
   * Se o BM atual está vazio (sem nenhuma linha em nenhum item),
   * importa automaticamente todas as linhas do BM anterior,
   * preservando valores e marcando a origem de cada linha.
   */
  _importarDoBmAnterior(obraId, bmNum, itens) {
    try {
      // Verifica se o BM atual já possui alguma linha
      const temLinhas = Object.values(this._storeAtual || {}).some(
        pack => Array.isArray(pack?.lines) && pack.lines.length > 0
      );
      if (temLinhas) return; // Já tem dados, não importa

      const prevMed = getMedicoes(obraId, bmNum - 1);
      if (!prevMed || !Object.keys(prevMed).length) return;

      let importou = false;
      itens.forEach(it => {
        if (it.t) return; // Pula grupos/subgrupos
        const itemId = it.id;
        const prevPack = prevMed[itemId];
        if (!prevPack) return;

        // Cria pack para o item no BM atual
        if (!this._storeAtual[itemId]) {
          this._storeAtual[itemId] = { lines: [] };
        }

        // Copia fórmula especial se existir
        if (prevPack.fxFormula) {
          this._storeAtual[itemId].fxFormula = prevPack.fxFormula;
        }

        // Copia linhas com novo ID, preservando valores e marcando origem
        if (Array.isArray(prevPack.lines) && prevPack.lines.length > 0) {
          prevPack.lines.forEach(ln => {
            const origemBm = ln.bmOrigem || (bmNum - 1);
            this._storeAtual[itemId].lines.push({
              id:       novoId('ln'),
              comp:     safeNumLocal(ln.comp),
              larg:     safeNumLocal(ln.larg),
              alt:      safeNumLocal(ln.alt),
              qtd:      safeNumLocal(ln.qtd),
              desc:     ln.desc || '',
              bmOrigem: origemBm,
            });
          });
          importou = true;
        }
      });

      if (importou) {
        salvarMedicoes(obraId, bmNum, this._storeAtual);
        EventBus.emit('ui:toast', {
          msg: `📋 Memória de cálculo importada do BM ${String(bmNum - 1).padStart(2, '0')}.`,
          tipo: 'info'
        });
      }
    } catch (e) {
      console.error('[MemoriaModule] _importarDoBmAnterior:', e);
    }
  }

  // ── Importação manual (botão) ──────────────────────────────────
  importarBmAnterior(bmNum) {
    try {
      bmNum = parseInt(bmNum);
      if (bmNum <= 1) {
        EventBus.emit('ui:toast', { msg: '⚠️ Não há BM anterior para importar.', tipo: 'warn' });
        return;
      }

      // Proteção: verificar se medição está salva
      if (!this._verificarProtecao('importar linhas do BM anterior')) return;

      const obraId = state.get('obraAtivaId');
      const itens  = state.get('itensContrato');

      // Verifica se já tem linhas
      const temLinhas = Object.values(this._storeAtual || {}).some(
        pack => Array.isArray(pack?.lines) && pack.lines.length > 0
      );
      if (temLinhas) {
        if (!confirm('Este BM já possui linhas. Deseja adicionar as linhas do BM anterior às existentes?')) {
          return;
        }
      }

      const prevMed = getMedicoes(obraId, bmNum - 1);
      if (!prevMed || !Object.keys(prevMed).length) {
        EventBus.emit('ui:toast', { msg: '⚠️ BM anterior não possui memória de cálculo.', tipo: 'warn' });
        return;
      }

      let count = 0;
      itens.forEach(it => {
        if (it.t) return;
        const itemId = it.id;
        const prevPack = prevMed[itemId];
        if (!prevPack || !Array.isArray(prevPack.lines) || !prevPack.lines.length) return;

        if (!this._storeAtual[itemId]) {
          this._storeAtual[itemId] = { lines: [] };
        }
        // Copia fórmula especial
        if (prevPack.fxFormula && !this._storeAtual[itemId].fxFormula) {
          this._storeAtual[itemId].fxFormula = prevPack.fxFormula;
        }
        prevPack.lines.forEach(ln => {
          this._storeAtual[itemId].lines.push({
            id:       novoId('ln'),
            comp:     safeNumLocal(ln.comp),
            larg:     safeNumLocal(ln.larg),
            alt:      safeNumLocal(ln.alt),
            qtd:      safeNumLocal(ln.qtd),
            desc:     ln.desc || '',
            bmOrigem: ln.bmOrigem || (bmNum - 1),
          });
          count++;
        });
      });

      if (count > 0) {
        salvarMedicoes(obraId, bmNum, this._storeAtual);
        this._renderBM(bmNum);
        EventBus.emit('medicao:salva', { bmNum, obraId, origem: 'memoria' });
        EventBus.emit('ui:toast', { msg: `✅ ${count} linha(s) importada(s) do BM anterior.` });
      } else {
        EventBus.emit('ui:toast', { msg: '⚠️ Nenhuma linha encontrada no BM anterior.', tipo: 'warn' });
      }
    } catch (e) {
      console.error('[MemoriaModule] importarBmAnterior:', e);
    }
  }

  // ── Adicionar linha ──────────────────────────────────────────

  adicionarLinha(bmNum, itemId) {
    try {
      bmNum  = parseInt(bmNum);
      itemId = String(itemId);

      // Proteção: verificar se medição está salva
      if (!this._verificarProtecao('adicionar linha')) return;

      const obraId = state.get('obraAtivaId');
      const itens  = state.get('itensContrato');
      const it     = itens.find(x => x.id === itemId && !x.t);
      if (!it) {
        EventBus.emit('ui:toast', { msg: '⚠️ Item não encontrado.', tipo: 'warn' });
        return;
      }

      if (bmNum !== this._bmAtual) {
        this._bmAtual    = bmNum;
        this._storeAtual = getMedicoes(obraId, bmNum);
      }
      if (!this._storeAtual) this._storeAtual = getMedicoes(obraId, bmNum);

      if (!this._storeAtual[itemId] || !Array.isArray(this._storeAtual[itemId].lines)) {
        this._storeAtual[itemId] = { lines: [] };
      }

      const novaLinha = { id: novoId('ln'), comp: 0, larg: 0, alt: 0, qtd: 0, desc: '', bmOrigem: bmNum };
      this._storeAtual[itemId].lines.push(novaLinha);
      salvarMedicoes(obraId, bmNum, this._storeAtual);

      this._expandidos.add(itemId);
      this._renderBM(bmNum);

      // P3 — scrollAfterAdd: scroll permitido apenas em nova linha (ação explícita)
      requestAnimationFrame(() => {
        const inputs = document.querySelectorAll(`input[data-id="${itemId}"][data-dim="qtd"]`);
        if (inputs.length > 0) scrollAfterAdd(inputs[inputs.length - 1]);
      });

    } catch (e) {
      console.error('[MemoriaModule] adicionarLinha:', e);
    }
  }

  // ── Deletar linha ────────────────────────────────────────────

  deletarLinha(bmNum, itemId, lineId) {
    try {
      bmNum  = parseInt(bmNum);
      itemId = String(itemId);

      // Proteção: verificar se medição está salva
      if (!this._verificarProtecao('excluir linha')) return;

      const obraId = state.get('obraAtivaId');

      if (!this._storeAtual?.[itemId]?.lines) return;
      this._storeAtual[itemId].lines = this._storeAtual[itemId].lines.filter(ln => ln.id !== lineId);
      salvarMedicoes(obraId, bmNum, this._storeAtual);
      this._renderBM(bmNum);

      // origem: 'memoria' evita que o listener invalide o cache recém-atualizado
      EventBus.emit('medicao:salva', { bmNum, obraId, origem: 'memoria' });
    } catch (e) {
      console.error('[MemoriaModule] deletarLinha:', e);
    }
  }

  // ── Atualizar dimensão ───────────────────────────────────────

  atualizarDimensao(inputEl) {
    try {
      const { bm: bmNum, id: itemId, lineid: lineId, dim } = inputEl.dataset;
      const obraId = state.get('obraAtivaId');

      // Proteção: verificar se medição está salva
      if (!this._verificarProtecao('editar valores')) {
        // Reverte o input ao valor anterior
        const ln = this._storeAtual?.[itemId]?.lines?.find(l => l.id === lineId);
        if (ln && dim !== 'desc') inputEl.value = ln[dim] || 0;
        return;
      }

      if (!this._storeAtual?.[itemId]?.lines) return;
      const ln = this._storeAtual[itemId].lines.find(l => l.id === lineId);
      if (!ln) return;

      // Trata campo de descrição separadamente (texto, não número)
      if (dim === 'desc') {
        ln.desc = inputEl.value || '';
        salvarMedicoes(obraId, parseInt(bmNum), this._storeAtual);
        return;
      }

      // Campos numéricos: sanitiza, evita NaN e valores negativos
      const raw = parseFloat(inputEl.value);
      const val = (isFinite(raw) && raw >= 0) ? raw : 0;
      ln[dim] = val;
      // Atualiza o input visual se valor foi corrigido
      if (val !== raw) inputEl.value = val;
      salvarMedicoes(obraId, parseInt(bmNum), this._storeAtual);

      // Garante que todos os campos numéricos da linha sejam válidos
      const comp = isFinite(parseFloat(ln.comp)) ? parseFloat(ln.comp) : 0;
      const larg = isFinite(parseFloat(ln.larg)) ? parseFloat(ln.larg) : 0;
      const alt  = isFinite(parseFloat(ln.alt))  ? parseFloat(ln.alt)  : 0;
      const qtd  = isFinite(parseFloat(ln.qtd))  ? parseFloat(ln.qtd)  : 0;

      // Atualiza resultado da linha sem re-render completo
      const itens = state.get('itensContrato');
      const it    = itens.find(x => x.id === itemId);
      const fx    = getFxFormula(this._storeAtual, itemId);

      let qtdCalcLn = 0;
      if (fx) {
        const { result } = fxCalc(fx, comp, larg, alt, qtd);
        qtdCalcLn = isFinite(result) ? result : 0;
      } else {
        const r = calcDimensional(it?.und || 'UN', comp, larg, alt, qtd);
        qtdCalcLn = isFinite(r.qtdCalc) ? r.qtdCalc : 0;
      }

      const resEl = document.getElementById(`mem-lres-${itemId}-${lineId}`);
      if (resEl) {
        resEl.textContent = parseFloat(qtdCalcLn || 0).toFixed(2).replace('.', ',');
        resEl.style.color = qtdCalcLn > 0 ? '#1A1A1A' : qtdCalcLn < 0 ? '#555555' : '#9ca3af';
      }

      // Atualiza total do item (soma de todas as linhas)
      const allLines    = getLinhasItem(this._storeAtual, itemId);
      const qtdTot      = sumLinhasQtd(it?.und || 'UN', allLines, fx);
      const safeTot     = isFinite(qtdTot) ? qtdTot : 0;
      const totEl       = document.getElementById(`mem-itemtotal-${itemId}`);
      if (totEl) totEl.textContent = `${parseFloat(safeTot).toFixed(2).replace('.', ',')} ${it?.und || ''}`;

      // Atualiza colunas de medição no registro principal (acum anterior, acum total, med atual)
      this._atualizarCelulasMedicao(itemId, it, fx, safeTot);

      // Emite evento sem causar re-render completo (flag _isEditingInline)
      this._isEditingInline = true;
      EventBus.emit('medicao:salva', { bmNum: parseInt(bmNum), obraId, origem: 'memoria' });
      this._isEditingInline = false;

    } catch (e) {
      console.error('[MemoriaModule] atualizarDimensao:', e);
    }
  }

  /** Atualiza dinamicamente as colunas de acumulado/medição na linha-resumo do item */
  _atualizarCelulasMedicao(itemId, it, fx, qtdTotLinhas) {
    try {
      const cfg = state.get('cfg') || {};
      const mode = cfg?.modoCalculo || 'truncar';
      const n2  = v => {
        const num = parseFloat(v || 0);
        const applied = mode === 'truncar' ? Math.trunc(Math.round(num * 100 * 100) / 100) / 100 : Math.round(num * 100) / 100;
        return applied.toFixed(2).replace('.', ',');
      };
      const bdi = cfg.bdi || 0.25;
      const obraId = state.get('obraAtivaId');

      // Calcula Medição Atual: apenas linhas originadas NESTE BM
      const qtdMedAtual = getQtdMedicaoItemNoBm(obraId, this._bmAtual, itemId, state.get('itensContrato') || []);

      // Acumulado Anterior (soma de todos os BMs anteriores)
      const qtdAnt   = this._prevQtyMap[itemId] || 0;

      // Acumulado Total = Anterior + Medição Atual deste BM
      const qtdAcumTotal = qtdAnt + qtdMedAtual;

      const pctExec  = it && it.qtd > 0 ? (qtdAcumTotal / it.qtd * 100) : 0;
      const upBdi    = (it?.up || 0) * (1 + bdi);
      const vMed     = qtdMedAtual * upBdi;
      const vAcum    = qtdAcumTotal * upBdi;
      const R$       = v => formatters.currency(v);
      const pct      = v => formatters.percent(v);

      // Atualiza cells via IDs se existirem
      const elAcumTot  = document.getElementById(`mem-acumtot-${itemId}`);
      const elMedAtual = document.getElementById(`mem-medatual-${itemId}`);
      const elPctExec  = document.getElementById(`mem-pctexec-${itemId}`);
      const elVMed     = document.getElementById(`mem-vmed-${itemId}`);
      const elVAcum    = document.getElementById(`mem-vacum-${itemId}`);

      if (elAcumTot)  elAcumTot.textContent  = n2(qtdAcumTotal);
      if (elMedAtual) elMedAtual.textContent  = n2(qtdMedAtual);
      if (elPctExec)  elPctExec.textContent   = pct(pctExec);
      if (elVMed)     elVMed.textContent      = R$(vMed);
      if (elVAcum)    elVAcum.textContent     = R$(vAcum);
    } catch (e) {
      // Silencia erros de atualização incremental — o recálculo completo cobre
    }
  }

  // ── Toggle expandido ─────────────────────────────────────────

  toggleItem(itemId) {
    if (this._expandidos.has(itemId)) this._expandidos.delete(itemId);
    else this._expandidos.add(itemId);

    // BUGFIX: Re-injeta o store atual no cache antes de renderizar.
    // Quando o cache é invalidado externamente (ex: módulo Boletim emite medicao:salva),
    // _medCache é apagado. Sem essa proteção, _renderBM faria getMedicoes() retornar {}
    // e this._storeAtual seria sobrescrito com vazio, perdendo todas as linhas não preenchidas
    // (que existiam em memória mas ainda não haviam sido salvas formalmente no Firebase).
    const obraId = state.get('obraAtivaId');
    if (this._storeAtual && Object.keys(this._storeAtual).length > 0) {
      _injetarCacheMedicoes(obraId, this._bmAtual, this._storeAtual);
    }

    this._renderBM(this._bmAtual);
  }

  // ── Fórmula especial ─────────────────────────────────────────

  abrirModalFx(bmNum, itemId) {
    this._ui.abrirModalFx(parseInt(bmNum), String(itemId), this._storeAtual);
  }

  salvarFx(bmNum, itemId, formula) {
    try {
      // Proteção: verificar se medição está salva
      if (!this._verificarProtecao('aplicar fórmula especial')) return;

      const teste = fxCalc(formula, 1, 1, 1, 1);
      if (teste.erro) {
        EventBus.emit('ui:toast', { msg: '⚠️ Fórmula inválida: ' + teste.erro, tipo: 'warn' });
        return;
      }
      const obraId = state.get('obraAtivaId');
      this._bmAtual    = parseInt(bmNum);
      this._storeAtual = getMedicoes(obraId, this._bmAtual);
      if (!this._storeAtual[itemId]) this._storeAtual[itemId] = { lines: [] };

      // Aplica a fórmula especial ao item
      this._storeAtual[itemId].fxFormula = formula.toUpperCase();

      // IMPROVEMENT 3: Recalcula resultado de TODAS as linhas do item com a nova fórmula
      const lines = this._storeAtual[itemId].lines || [];
      lines.forEach(ln => {
        const comp = safeNumLocal(ln.comp);
        const larg = safeNumLocal(ln.larg);
        const alt  = safeNumLocal(ln.alt);
        const qtd  = safeNumLocal(ln.qtd);
        const { result } = fxCalc(formula, comp, larg, alt, qtd);
        ln.resultado = isFinite(result) ? result : 0;
      });

      salvarMedicoes(obraId, this._bmAtual, this._storeAtual);
      this._renderBM(this._bmAtual);
      EventBus.emit('medicao:salva', { bmNum: this._bmAtual, obraId, origem: 'memoria' });
      EventBus.emit('ui:toast', { msg: `✅ Fórmula especial aplicada ao item ${itemId}! Todas as linhas recalculadas.` });
    } catch (e) {
      console.error('[MemoriaModule] salvarFx:', e);
    }
  }

  removerFx(bmNum, itemId) {
    try {
      // Proteção: verificar se medição está salva
      if (!this._verificarProtecao('remover fórmula especial')) return;

      const obraId = state.get('obraAtivaId');
      this._bmAtual    = parseInt(bmNum);
      this._storeAtual = getMedicoes(obraId, this._bmAtual);
      if (this._storeAtual[itemId]) {
        delete this._storeAtual[itemId].fxFormula;

        // Recalcula todas as linhas com a fórmula automática da unidade
        const itens = state.get('itensContrato');
        const it    = itens.find(x => x.id === itemId);
        const und   = it?.und || 'UN';
        const lines = this._storeAtual[itemId].lines || [];
        lines.forEach(ln => {
          const r = calcDimensional(und, ln.comp, ln.larg, ln.alt, ln.qtd);
          ln.resultado = isFinite(r.qtdCalc) ? r.qtdCalc : 0;
        });

        salvarMedicoes(obraId, this._bmAtual, this._storeAtual);
      }
      this._renderBM(this._bmAtual);
      EventBus.emit('medicao:salva', { bmNum: this._bmAtual, obraId, origem: 'memoria' });
      EventBus.emit('ui:toast', { msg: '✅ Fórmula especial removida. Linhas recalculadas.', tipo: 'info' });
    } catch (e) {
      console.error('[MemoriaModule] removerFx:', e);
    }
  }

  // ── Verificação se medição está bloqueada ────────────────────
  _isMedicaoSalva() {
    return !!(this._storeAtual && this._storeAtual._salva);
  }

  /**
   * Verifica se a medição está bloqueada.
   * Se estiver, emite toast informativo e retorna false (bloqueia operação).
   * NÃO exibe nenhum confirm() — o usuário deve usar "Desmarcar como Salvo".
   */
  _verificarProtecao(operacao) {
    if (!this._isMedicaoSalva()) return true;
    EventBus.emit('ui:toast', {
      msg: `🔒 Documento bloqueado. Clique em "Desmarcar como Salvo" para editar.`,
      tipo: 'warn'
    });
    return false;
  }

  // ── Salvar Medição (persiste dados, NÃO bloqueia) ─────────────
  salvarMedicaoFormal() {
    try {
      const obraId = state.get('obraAtivaId');
      const bmNum  = this._bmAtual;
      if (!obraId) {
        EventBus.emit('ui:toast', { msg: '⚠️ Nenhuma obra ativa.', tipo: 'warn' });
        return;
      }
      if (!this._storeAtual) this._storeAtual = getMedicoes(obraId, bmNum);
      salvarMedicoes(obraId, bmNum, this._storeAtual);
      EventBus.emit('medicao:salva', { bmNum, obraId, origem: 'memoria' });
      EventBus.emit('ui:toast', {
        msg: `✅ Medição do BM ${String(bmNum).padStart(2, '0')} salva!`,
        tipo: 'ok'
      });
    } catch (e) {
      console.error('[MemoriaModule] salvarMedicaoFormal:', e);
      EventBus.emit('ui:toast', { msg: '❌ Erro ao salvar medição.', tipo: 'error' });
    }
  }

  // ── Marcar como Salvo (bloqueia edição) ───────────────────────
  marcarSalvoMem() {
    try {
      const obraId = state.get('obraAtivaId');
      const bmNum  = this._bmAtual;
      if (!obraId) return;
      if (!this._storeAtual) this._storeAtual = getMedicoes(obraId, bmNum);
      const userLogado = state.get('usuarioLogado') || {};
      this._storeAtual._salva         = true;
      this._storeAtual._salvaEm       = new Date().toISOString();
      this._storeAtual._salvaPor      = userLogado.displayName || state.get('cfg')?.fiscal || 'Usuário';
      this._storeAtual._salvaPorUid   = userLogado.uid   || 'offline';
      this._storeAtual._salvaPorEmail = userLogado.email || '';
      // Snapshot imutável das quantidades no momento do bloqueio (rastreabilidade TCU)
      this._storeAtual._snapshot = { linhas: JSON.parse(JSON.stringify(this._storeAtual)), geradoEm: this._storeAtual._salvaEm };
      salvarMedicoes(obraId, bmNum, this._storeAtual);
      this._renderBM(bmNum);
      EventBus.emit('medicao:salva', { bmNum, obraId, origem: 'memoria' });
      window.auditRegistrar?.({ modulo: 'Memória de Cálculo', tipo: 'bloqueado', registro: `BM ${String(bmNum).padStart(2,'0')}`, detalhe: `Marcado como salvo por ${this._storeAtual._salvaPor} (${this._storeAtual._salvaPorEmail})` });
      EventBus.emit('ui:toast', { msg: `🔒 BM ${String(bmNum).padStart(2,'0')} marcado como salvo — edição bloqueada.`, tipo: 'ok' });
    } catch (e) {
      console.error('[MemoriaModule] marcarSalvoMem:', e);
    }
  }

  // ── Desmarcar como Salvo (libera edição) — exige perfil fiscal/admin + motivo ─
  desmarcarSalvoMem() {
    try {
      const obraId = state.get('obraAtivaId');
      const bmNum  = this._bmAtual;
      if (!obraId) return;

      // CORREÇÃO: verificar perfil do usuário logado
      const usuarios   = state.get('usuarios') || [];
      const userLogado = state.get('usuarioLogado') || {};
      const meuPerfil  = usuarios.find(u => u.uid === userLogado.uid || u.email === userLogado.email)?.perfil || '';
      const podeDesbloquear = ['fiscal','administrador','gestor'].includes(meuPerfil) || !meuPerfil;

      if (!podeDesbloquear) {
        EventBus.emit('ui:toast', { msg: '🚫 Apenas o Fiscal ou Administrador pode remover o bloqueio de um BM.', tipo: 'error' });
        return;
      }

      // CORREÇÃO: exigir motivo escrito
      const motivo = window.prompt('⚠️ Informe o MOTIVO do desbloqueio (obrigatório para registro de auditoria):');
      if (motivo === null) return;
      if (!motivo.trim() || motivo.trim().length < 10) {
        EventBus.emit('ui:toast', { msg: '⚠️ Motivo obrigatório (mínimo 10 caracteres).', tipo: 'warn' });
        return;
      }

      if (!this._storeAtual) this._storeAtual = getMedicoes(obraId, bmNum);
      this._storeAtual._salva              = false;
      this._storeAtual._desbloqueadoEm     = new Date().toISOString();
      this._storeAtual._desbloqueadoPor    = userLogado.displayName || userLogado.email || 'Usuário';
      this._storeAtual._desbloqueadoPorUid = userLogado.uid || 'offline';
      this._storeAtual._motivoDesbloqueio  = motivo.trim();
      salvarMedicoes(obraId, bmNum, this._storeAtual);
      this._renderBM(bmNum);
      window.auditRegistrar?.({ modulo: 'Memória de Cálculo', tipo: 'desbloqueado', registro: `BM ${String(bmNum).padStart(2,'0')}`, detalhe: `Desbloqueado por ${this._storeAtual._desbloqueadoPor} — Motivo: ${motivo.trim()}` });
      EventBus.emit('ui:toast', { msg: `🔓 BM ${String(bmNum).padStart(2,'0')} liberado para edição.`, tipo: 'info' });
    } catch (e) {
      console.error('[MemoriaModule] desmarcarSalvoMem:', e);
    }
  }

  // ── Atualiza controles visuais de bloqueio da Memória ─────────
  _atualizarControleBloqueioMem() {
    const salva        = this._isMedicaoSalva();
    const badge        = document.getElementById('mem-status-badge');
    const btnMarcar    = document.getElementById('btn-marcar-mem');
    const btnDesmarcar = document.getElementById('btn-desmarcar-mem');
    const btnSalvar    = document.getElementById('btn-salvar-medicao-mem');

    if (badge) {
      badge.style.display = 'inline-flex';
      if (salva) {
        const quando = this._storeAtual?._salvaEm
          ? new Date(this._storeAtual._salvaEm).toLocaleString('pt-BR') : '—';
        badge.textContent = '🔒 Salvo';
        badge.style.background  = '#fef3c7';
        badge.style.color       = '#92400e';
        badge.style.borderColor = '#f59e0b';
        badge.title = `Salvo em ${quando}${this._storeAtual?._salvaPor ? ' por ' + this._storeAtual._salvaPor : ''}`;
      } else {
        badge.textContent = '✏️ Em edição';
        badge.style.background  = '#f0fdf4';
        badge.style.color       = '#166534';
        badge.style.borderColor = '#86efac';
        badge.title = 'Documento em edição';
      }
    }

    if (btnMarcar)    btnMarcar.style.display    = salva ? 'none'         : 'inline-block';
    if (btnDesmarcar) btnDesmarcar.style.display = salva ? 'inline-block' : 'none';
    if (btnSalvar)    btnSalvar.disabled          = salva;

    // Bloqueia/libera botões de ação da toolbar de memória
    document.querySelectorAll('#memoria .btn-cinza:not([onclick*="renderMemoria"]):not([onclick*="exportarCSV"]):not([onclick*="imprimirMemoria"])').forEach(el => {
      el.disabled = salva;
      el.style.opacity = salva ? '0.45' : '';
    });
  }

  // ── Event Bus ────────────────────────────────────────────────

  _bindEvents() {
    this._subs.push(
      EventBus.on('obra:selecionada', () => {
        this._expandidos.clear();
        this._storeAtual = null;
        if (router.current === 'memoria') this._renderMemoria();
      }, 'memoria'),

      EventBus.on('boletim:atualizado', () => {
        if (router.current === 'memoria') this._renderMemoria();
      }, 'memoria'),

      // Re-renderiza ao receber evento de outra origem (ex: boletim salvou)
      // MAS não invalida cache nem re-renderiza se o evento veio DE NÓS MESMOS
      // (salvarMedicaoFormal já mantém _storeAtual correto em memória)
      EventBus.on('medicao:salva', ({ obraId, origem }) => {
        try {
          if (origem === 'memoria') return; // ignorar eventos que emitimos

          // FIX-4: NÃO invalida o cache — salvarMedicoes() já atualizou o MemCache
          // com os dados corretos. Invalidar aqui zeraria os valores no re-render.
          // O _storeAtual local é preservado sem necessidade de snapshot.

          if (router.current === 'memoria' && !this._isEditingInline) {
            this._renderMemoria();
            // FIX-4: atualiza badge/botões de bloqueio para o BM ativo após re-render
            this._atualizarControleBloqueioMem();
          }
        } catch (e) { console.error('[MemoriaModule] medicao:salva re-render:', e); }
      }, 'memoria'),

      // Auto-save: persiste o _storeAtual no Firestore
      EventBus.on('autosave:trigger', ({ obraId: evObraId }) => {
        try {
          const obraId = evObraId || state.get('obraAtivaId');
          if (!obraId || !this._storeAtual) return;
          salvarMedicoes(obraId, this._bmAtual, this._storeAtual);
        } catch (e) { console.error('[MemoriaModule] autosave:trigger:', e); }
      }, 'memoria'),
    );

    // Handler para change no select de BM
    document.addEventListener('change', (e) => {
      if (e.target.id === 'sel-mem-bm') {
        const obraId = state.get('obraAtivaId');
        const bmNum  = parseInt(e.target.value) || 1;
        this._carregarMedicoesBM(obraId, bmNum).then(() => this._renderMemoria()).catch(e => {
          console.error('[MemoriaModule] change sel-mem-bm:', e);
        });
      }
    });

    // Handler de delegação para actions na tabela
    document.addEventListener('click', (e) => {
      const btn = e.target.closest('[data-action]');
      if (!btn) return;
      const { action, bm, itemid, lineid } = btn.dataset;
      try {
        if (action === 'add-linha')  this.adicionarLinha(bm, itemid);
        if (action === 'del-linha')  this.deletarLinha(bm, itemid, lineid);
        if (action === 'toggle-item') this.toggleItem(itemid);
        if (action === 'editar-fx')  this.abrirModalFx(bm, itemid);
        if (action === 'importar-bm-anterior') this.importarBmAnterior(bm);
      } catch (err) { console.error('[MemoriaModule] action:', err); }
    });

    // Handler de input nos campos dimensionais
    document.addEventListener('input', (e) => {
      const inp = e.target;
      if (inp.dataset?.dim) this.atualizarDimensao(inp);
    });
  }

  // ── Exportar CSV da Memória de Cálculo ───────────────────────
  _exportarCSVMemoria() {
    const obraId = state.get('obraAtivaId');
    const cfg    = state.get('cfg') || {};
    const bms    = state.get('bms') || [];
    const itens  = state.get('itensContrato') || [];
    const bmNum  = parseInt(document.getElementById('sel-mem-bm')?.value || 1);
    const bm     = bms.find(b => b.num === bmNum) || bms[0];
    if (!bm) { window.toast?.('⚠️ Nenhum BM selecionado.', 'warn'); return; }

    const med      = getMedicoes(obraId, bmNum);
    const bdi      = cfg.bdi || 0;
    const modoCalc = cfg.modoCalculo || 'truncar';

    // ── fmtNum idêntico ao usado em bm-calculos.js ──────────────
    const fmtNum = v => modoCalc === 'truncar'
      ? Math.trunc(Math.round(parseFloat(v || 0) * 100 * 100) / 100) / 100
      : Math.round(parseFloat(v || 0) * 100) / 100;

    // ── Cabeçalho espelha a tabela do sistema ───────────────────
    const cabec = [
      'ID', 'Código', 'Banco', 'Descrição', 'Und', 'Qtd Contratada',
      'V.Unit. (R$)', 'V.Unit+BDI (R$)', 'Total Contratado (R$)',
      // Acumulado anterior (igual à coluna Ant. da tela)
      'Qtd Ant.', 'V.Acum.Ant. (R$)',
      // Medição atual (detalhamento de linhas)
      'Nº Linha', 'Desc. Linha', 'Comp. (A)', 'Larg. (B)', 'Alt. (C)', 'Qtd Linha', 'Resultado Linha',
      // Totalizadores do item
      'Qtd Med.Atual', '% Executado', 'V.Med.Atual (R$)', 'V.Acumulado (R$)',
    ];

    const linhas = [];
    let totalVMed = 0, totalVAcum = 0;

    itens.forEach(it => {
      if (it.t) {
        // Linha de grupo/subgrupo — espelha cabeçalho da tabela
        const tipo = it.t === 'G' ? 'GRUPO' : it.t === 'SG' ? 'SUBGRUPO' : 'MACRO';
        linhas.push([it.id, '', '', it.desc || it.id, tipo, '', '', '', '', '', '', '', '', '', '', '', '', '', '', '', '', '']);
        return;
      }

      // ── ITEM NORMAL — cálculos idênticos ao imprimirMemoria ────
      // CORREÇÃO: campo correto é it.up (não it.pu)
      const up    = parseFloat(it.up) || 0;
      const upBdi = fmtNum(up * (1 + bdi));
      const totCont = fmtNum((it.qtd || 0) * upBdi);

      // Linhas da memória de cálculo para este item neste BM
      const lins      = getLinhasItem(med, it.id);
      // CORREÇÃO: getFxFormula fornece a fórmula personalizada
      const fxFormula = getFxFormula(med, it.id);

      // CORREÇÃO: sumLinhasQtd exige (und, lines, fxFormula)
      const qtdMedAtual = sumLinhasQtd(it.und || 'UN', lins, fxFormula);

      // Acumulado anterior (qtd medida em todos os BMs anteriores)
      const qtdAnt  = getQtdAcumuladoAnteriorItem(obraId, bmNum, it.id, itens);
      const totAnt  = fmtNum(qtdAnt * upBdi);

      // Acumulado total (anterior + atual)
      const qtdTot  = qtdAnt + qtdMedAtual;
      const pctExec = it.qtd > 0 ? (qtdTot / it.qtd * 100) : 0;
      const vMed    = fmtNum(qtdMedAtual * upBdi);
      const vAcum   = fmtNum(qtdTot * upBdi);

      totalVMed  += vMed;
      totalVAcum += vAcum;

      if (!lins.length) {
        // Sem linhas detalhadas — linha única com totais
        linhas.push([
          it.id, it.cod || '', it.banco || '', it.desc || '', it.und || '',
          numCSV(it.qtd), numCSV(up), numCSV(upBdi), numCSV(totCont),
          numCSV(qtdAnt), numCSV(totAnt),
          '', '', '', '', '', '', '',
          numCSV(qtdMedAtual), numCSV(pctExec) + '%', numCSV(vMed), numCSV(vAcum),
        ]);
      } else {
        lins.forEach((ln, idx) => {
          // CORREÇÃO: campos corretos são comp/larg/alt (não a/b/c)
          const c = isFinite(parseFloat(ln.comp)) ? parseFloat(ln.comp) : 0;
          const l = isFinite(parseFloat(ln.larg)) ? parseFloat(ln.larg) : 0;
          const a = isFinite(parseFloat(ln.alt))  ? parseFloat(ln.alt)  : 0;
          const q = isFinite(parseFloat(ln.qtd))  ? parseFloat(ln.qtd)  : 0;

          // Calcula resultado da linha usando a mesma lógica do motor de cálculo
          let resultado = 0;
          if (fxFormula) {
            const { result } = fxCalc(fxFormula, c, l, a, q);
            resultado = isFinite(result) ? result : 0;
          } else {
            const r = calcDimensional(it.und || 'UN', c, l, a, q);
            resultado = isFinite(r.qtdCalc) ? r.qtdCalc : 0;
          }

          linhas.push([
            // Dados do item apenas na 1ª linha
            idx === 0 ? it.id    : '',
            idx === 0 ? (it.cod  || '') : '',
            idx === 0 ? (it.banco|| '') : '',
            idx === 0 ? (it.desc || '') : '',
            idx === 0 ? (it.und  || '') : '',
            idx === 0 ? numCSV(it.qtd)   : '',
            idx === 0 ? numCSV(up)        : '',
            idx === 0 ? numCSV(upBdi)     : '',
            idx === 0 ? numCSV(totCont)   : '',
            idx === 0 ? numCSV(qtdAnt)    : '',
            idx === 0 ? numCSV(totAnt)    : '',
            // Detalhamento da linha
            String(idx + 1),
            ln.desc || '',
            numCSV(c), numCSV(l), numCSV(a), numCSV(q),
            numCSV(resultado),
            // Totalizadores do item apenas na 1ª linha
            idx === 0 ? numCSV(qtdMedAtual)    : '',
            idx === 0 ? numCSV(pctExec) + '%'  : '',
            idx === 0 ? numCSV(vMed)           : '',
            idx === 0 ? numCSV(vAcum)          : '',
          ]);
        });
      }
    });

    // Linha de totais
    linhas.push([]);
    linhas.push(['TOTAL GERAL', '', '', '', '', '', '', '', '', '', '', '', '', '', '', '', '', '',
      '', '', numCSV(totalVMed), numCSV(totalVAcum)]);
    // Info do BM
    linhas.push([]);
    linhas.push([`BM: ${bm.label || bmNum}`, `Período: ${bm.mes || '—'}`, `BDI: ${(bdi * 100).toFixed(2)}%`]);

    const nomeArq = `memoria_calculo_BM${String(bmNum).padStart(2,'0')}_${new Date().toISOString().slice(0,10)}`;
    baixarCSV([cabec, ...linhas], nomeArq);
    window.auditRegistrar?.({ modulo: 'Memória de Cálculo', tipo: 'exportação', registro: bm.label || `BM ${bmNum}`, detalhe: 'Exportação CSV da Memória de Cálculo' });
    window.toast?.('✅ CSV da Memória exportado!', 'ok');
  }

  _exposeGlobals() {
    window.renderMemoria   = async () => {
      const obraId = state.get('obraAtivaId');
      const bmNum  = parseInt(document.getElementById('sel-mem-bm')?.value || 1);
      await this._carregarMedicoesBM(obraId, bmNum);
      this._renderMemoria();
    };
    window.adicionarLinha  = (bm, id) => this.adicionarLinha(bm, id);
    window.deletarLinha    = (bm, id, lineId) => this.deletarLinha(bm, id, lineId);
    window.toggleMemItem   = (id) => this.toggleItem(id);
    window.importarBmAnterior = (bm) => this.importarBmAnterior(bm);
    window.salvarMedicaoMem   = () => this.salvarMedicaoFormal();
    window.marcarSalvoMem     = () => this.marcarSalvoMem();
    window.desmarcarSalvoMem  = () => this.desmarcarSalvoMem();
    window._mfxAbrir       = (bm, id) => this.abrirModalFx(bm, id);
    window._mfxSalvar      = () => {
      const formula = document.getElementById('mfx-input')?.value || '';
      if (this._mfxBm && this._mfxId) this.salvarFx(this._mfxBm, this._mfxId, formula);
    };
    window._mfxRemover     = () => {
      if (this._mfxBm && this._mfxId) this.removerFx(this._mfxBm, this._mfxId);
    };
    window._mfxFechar      = () => document.getElementById('mfx-overlay')?.classList.remove('aberto');
    window._mfxRecalc      = () => this._ui?.recalcFx();
    // Inserir símbolo na fórmula ativa
    window._mfxInserir     = (sym) => {
      const inp = document.getElementById('mfx-input');
      if (!inp) return;
      const pos = inp.selectionStart || inp.value.length;
      inp.value = inp.value.slice(0, pos) + sym + inp.value.slice(inp.selectionEnd || pos);
      inp.focus();
      inp.setSelectionRange(pos + sym.length, pos + sym.length);
      window._mfxRecalc?.();
    };
    window.exportarCSVMemoria = () => { try { this._exportarCSVMemoria(); } catch(e) { console.error('[Memoria] exportarCSV:', e); } };
    // Imprimir memória de cálculo — VERSÃO COMPLETA com detalhamento de linhas
    window.imprimirMemoria  = () => {
      try {
        const obraId = state.get('obraAtivaId');
        const cfg    = state.get('cfg') || {};
        const bms    = state.get('bms') || [];
        const itens  = state.get('itensContrato') || [];
        const bmNum  = parseInt(document.getElementById('sel-mem-bm')?.value || 1);
        const bm     = bms.find(b => b.num === bmNum) || {};
        const hoje   = new Date();
        const logo   = state.get('logoBase64') || cfg.logo || '';
        const bdi    = cfg.bdi || 0.25;
        const med    = getMedicoes(obraId, bmNum);

        // Mapa de acumulado anterior (soma de todos os BMs até bmNum-1)
        const prevQtyMap = {};
        if (bmNum > 1) {
          itens.forEach(it => {
            if (it.t) return;
            prevQtyMap[it.id] = getQtdAcumuladoTotalItem(
              obraId, bmNum - 1, it.id, itens
            );
          });
        }

        const modoCalc = cfg.modoCalculo || 'truncar';
        const n2 = v => {
          const num = parseFloat(safeNumLocal(v));
          const applied = modoCalc === 'truncar' ? Math.trunc(Math.round(num * 100 * 100) / 100) / 100 : Math.round(num * 100) / 100;
          return applied.toFixed(2).replace('.', ',');
        };
        const R$ = v => formatters.currency(v);
        const pctFmt = v => {
          const num = parseFloat(safeNumLocal(v));
          const applied = modoCalc === 'truncar' ? Math.trunc(Math.round(num * 100 * 100) / 100) / 100 : Math.round(num * 100) / 100;
          return applied.toFixed(2).replace('.', ',') + ' %';
        };

        // Gera as linhas da tabela principal + detalhamento
        let tblRows = '';
        let totalVMed = 0, totalVAcum = 0;

        itens.forEach(it => {
          if (it.t === 'G') {
            tblRows += `<tr class="linha-grupo"><td colspan="16">${it.desc}</td></tr>`;
            return;
          }
          if (it.t === 'SG') {
            tblRows += `<tr class="linha-subgrupo"><td colspan="16">${it.desc}</td></tr>`;
            return;
          }

          const itemId    = it.id;
          const lines     = getLinhasItem(med, itemId);
          const fxFormula = getFxFormula(med, itemId);
          const temFx     = !!fxFormula;
          const qtdMedAtual = getQtdMedicaoItemNoBm(obraId, bmNum, itemId, itens);
          const qtdAnt    = prevQtyMap[itemId] || 0;
          const qtdTot    = qtdAnt + qtdMedAtual;
          const qtdAtual  = qtdMedAtual;
          const pctExec   = it.qtd > 0 ? (qtdTot / it.qtd * 100) : 0;
          const upBdi     = it.up * (1 + bdi);
          const totalItem = it.qtd * upBdi;
          const vMed      = qtdAtual * upBdi;
          const vAcum     = qtdTot   * upBdi;
          totalVMed  += vMed;
          totalVAcum += vAcum;

          // Linha principal do item
          tblRows += `
            <tr class="item-row">
              <td class="td-c" style="font-weight:700">${it.id}</td>
              <td style="font-size:6.5pt">${it.cod || '—'}</td>
              <td style="font-size:6.5pt">${it.banco || '—'}</td>
              <td style="font-size:6.5pt">${it.desc}</td>
              <td class="td-c">${it.und}</td>
              <td class="td-r">${n2(it.qtd)}</td>
              <td class="td-r">${R$(it.up)}</td>
              <td class="td-r">${R$(totalItem)}</td>
              <td class="td-r">${n2(qtdAnt)}</td>
              <td class="td-r" style="font-weight:700;color:#1e40af">${n2(qtdTot)}</td>
              <td class="td-r" style="font-weight:700">${n2(qtdAtual)}</td>
              <td class="td-r" style="font-weight:700">${pctFmt(pctExec)}</td>
              <td class="td-r">${R$(vMed)}</td>
              <td class="td-r" style="font-weight:700">${R$(vAcum)}</td>
              <td style="font-size:6pt">${lines.length} ln${temFx ? ' · 𝑓𝑥' : ''}</td>
            </tr>`;

          // ── Detalhamento das linhas da memória ──
          if (lines.length > 0) {
            const tipo     = classUnd(it.und);
            const showComp = temFx || ['m', 'm2', 'm3'].includes(tipo);
            const showLarg = temFx || ['m2', 'm3'].includes(tipo);
            const showAlt  = temFx || tipo === 'm3';

            tblRows += `
              <tr class="mem-detail-header">
                <td colspan="15" style="padding:3px 6px;background:#f0f9ff;border-left:3px solid #2563eb">
                  <span style="font-weight:700;font-size:7pt;color:#0c4a6e">
                    📐 Memória de Cálculo — Item ${it.id}
                    ${temFx ? `<span style="color:#d97706;margin-left:8px">𝑓𝑥 ${fxFormula}</span>` : `<span style="color:#6b7280;margin-left:8px">Und: ${it.und}</span>`}
                  </span>
                </td>
              </tr>
              <tr class="mem-sub-header">
                <td class="td-c" style="font-weight:700;background:#e0f2fe;font-size:6pt">#</td>
                <td class="td-c" style="font-weight:700;background:#e0f2fe;font-size:6pt" ${showComp ? '' : 'style="color:#ccc"'}>Compr.</td>
                <td class="td-c" style="font-weight:700;background:#e0f2fe;font-size:6pt" ${showLarg ? '' : 'style="color:#ccc"'}>Largura</td>
                <td class="td-c" style="font-weight:700;background:#e0f2fe;font-size:6pt" ${showAlt ? '' : 'style="color:#ccc"'}>Altura</td>
                <td class="td-c" style="font-weight:700;background:#e0f2fe;font-size:6pt">Qtd</td>
                <td class="td-r" style="font-weight:700;background:#dcfce7;font-size:6pt" colspan="2">Resultado</td>
                <td style="font-weight:700;background:#e0f2fe;font-size:6pt" colspan="4">Fórmula Aplicada</td>
                <td style="font-weight:700;background:#fffbeb;font-size:6pt" colspan="2">Obs.</td>
                <td style="font-weight:700;background:#e0f2fe;font-size:6pt" colspan="2">Origem BM</td>
              </tr>`;

            lines.forEach((ln, idx) => {
              const c = safeNumLocal(ln.comp);
              const l = safeNumLocal(ln.larg);
              const a = safeNumLocal(ln.alt);
              const q = safeNumLocal(ln.qtd);

              let resultado = 0, formulaText = '';
              if (temFx) {
                const res = fxCalc(fxFormula, c, l, a, q);
                resultado = isFinite(res.result) ? res.result : 0;
                formulaText = res.erro ? `⚠ ${res.erro}` : res.expr;
              } else {
                const r = calcDimensional(it.und, c, l, a, q);
                resultado = isFinite(r.qtdCalc) ? r.qtdCalc : 0;
                formulaText = r.formula || '';
              }

              const origemBm = ln.bmOrigem ? `BM ${String(ln.bmOrigem).padStart(2, '0')}` : `BM ${String(bmNum).padStart(2, '0')}`;

              tblRows += `
                <tr class="mem-detail-row">
                  <td class="td-c" style="font-family:monospace;color:#64748b">${idx + 1}</td>
                  <td class="td-c">${showComp ? n2(c) : '—'}</td>
                  <td class="td-c">${showLarg ? n2(l) : '—'}</td>
                  <td class="td-c">${showAlt  ? n2(a) : '—'}</td>
                  <td class="td-c" style="font-weight:600">${n2(q)}</td>
                  <td class="td-r" style="font-weight:700;color:#166534" colspan="2">${n2(resultado)}</td>
                  <td style="font-size:6pt;font-family:monospace;color:#475569" colspan="4">${formulaText}</td>
                  <td style="font-size:6pt;color:#6b7280" colspan="2">${ln.desc || '—'}</td>
                  <td class="td-c" style="font-size:6pt;color:#0369a1" colspan="2">${origemBm}</td>
                </tr>`;
            });

            // Subtotal do item
            tblRows += `
              <tr class="mem-subtotal-row">
                <td colspan="5" style="text-align:right;font-weight:700;background:#f0fdf4;font-size:6.5pt;padding:2px 6px">
                  Total Item ${it.id} →
                </td>
                <td class="td-r" style="font-weight:700;background:#dcfce7;font-size:7pt" colspan="2">${n2(qtdTot)} ${it.und}</td>
                <td colspan="8" style="background:#f0fdf4"></td>
              </tr>`;
          }
        });

        const html = `<!DOCTYPE html><html lang="pt-BR"><head><meta charset="UTF-8">
<title>Memória de Cálculo — BM ${String(bmNum).padStart(2,'0')}</title>
<style>
  *{box-sizing:border-box;margin:0;padding:0}
  body{font-family:Arial,sans-serif;font-size:7.5pt;color:#111;padding:8mm}
  .header{display:flex;align-items:center;gap:14px;border-bottom:3px solid #1A1A1A;padding-bottom:10px;margin-bottom:10px}
  .logo{max-height:55px;max-width:90px}
  .orgao h1{font-size:11pt;font-weight:bold;color:#1A1A1A;text-transform:uppercase}
  .orgao p{font-size:7.5pt;color:#555}
  .titulo{text-align:center;font-size:13pt;font-weight:bold;color:#1A1A1A;text-transform:uppercase;letter-spacing:1px;margin:6px 0 2px}
  .subtitulo{text-align:center;font-size:8pt;color:#555;margin-bottom:10px}
  .ficha{display:grid;grid-template-columns:repeat(4,1fr);gap:5px;margin-bottom:10px}
  .fi{border:1px solid #ddd;padding:4px 7px;border-radius:3px}
  .fi-l{font-size:6.5pt;text-transform:uppercase;color:#888;letter-spacing:.3px}
  .fi-v{font-size:8.5pt;font-weight:700}
  table{width:100%;border-collapse:collapse;font-size:7pt}
  thead tr{background:#1A1A1A}
  thead th{color:#fff;padding:4px 5px;font-size:6pt;text-transform:uppercase;letter-spacing:.3px;text-align:center;white-space:nowrap}
  tbody td{border:1px solid #e2e8f0;padding:2px 4px;vertical-align:middle;font-size:6.5pt}
  .item-row td{background:#fff;border-bottom:1px solid #cbd5e1}
  .linha-grupo td{background:#1A1A1A!important;color:#fff;font-weight:700;font-size:7pt;padding:5px 8px}
  .linha-subgrupo td{background:#333!important;color:#e2e8f0;font-weight:700;padding:4px 8px}
  .mem-detail-header td{background:#f0f9ff;border:none}
  .mem-sub-header td{background:#e0f2fe!important;font-size:6pt;font-weight:700;color:#0c4a6e;padding:2px 4px;text-align:center}
  .mem-detail-row td{background:#f8fafc;font-size:6.5pt;border-bottom:1px solid #e2e8f0}
  .mem-subtotal-row td{border-top:1.5px solid #16a34a}
  tfoot td{background:#f1f5f9;font-weight:700;border-top:2px solid #1A1A1A;padding:5px}
  .td-r{text-align:right;font-family:'Courier New',monospace}
  .td-c{text-align:center}
  .footer{margin-top:8px;border-top:1px solid #ddd;padding-top:5px;font-size:7pt;color:#888;display:flex;justify-content:space-between}
  .assin{display:flex;justify-content:space-around;margin-top:24px}
  .assin-bloco{text-align:center;width:38%}
  .assin-linha{border-top:1px solid #000;margin-top:40px;padding-top:5px;font-size:8pt}
  @media print{@page{size:A4 landscape;margin:6mm}body{padding:0}}
</style></head><body>

<div class="header">
  ${logo?`<img src="${logo}" class="logo" alt="Logo">`:'<div style="font-size:36px">📐</div>'}
  <div class="orgao">
    <h1>${cfg.contratante||'ÓRGÃO CONTRATANTE'}</h1>
    <p>Setor de Fiscalização de Obras Públicas</p>
  </div>
</div>

<div class="titulo">Memória de Cálculo — ${bm.label||`BM ${String(bmNum).padStart(2,'0')}`}</div>
<div class="subtitulo">Medição de ${bm.mes||'—'} · Emitido em ${hoje.toLocaleDateString('pt-BR')} às ${hoje.toLocaleTimeString('pt-BR',{hour:'2-digit',minute:'2-digit'})}</div>

<div class="ficha">
  <div class="fi" style="grid-column:span 2"><div class="fi-l">Objeto da Obra</div><div class="fi-v">${cfg.objeto||'—'}</div></div>
  <div class="fi"><div class="fi-l">Nº do Contrato</div><div class="fi-v">${cfg.contrato||'—'}</div></div>
  <div class="fi"><div class="fi-l">BDI Adotado</div><div class="fi-v">${((bdi)*100).toFixed(1)}%</div></div>
  <div class="fi" style="grid-column:span 2"><div class="fi-l">Empresa Executora</div><div class="fi-v">${cfg.contratada||'—'}</div></div>
  <div class="fi"><div class="fi-l">Fiscal de Obras</div><div class="fi-v">${cfg.fiscal||'—'}</div></div>
  <div class="fi"><div class="fi-l">Data da Medição</div><div class="fi-v">${bm.data||'—'}</div></div>
</div>

<table>
  <thead>
    <tr>
      <th style="width:40px">Item</th>
      <th style="width:60px">Código</th>
      <th style="width:50px">Banco</th>
      <th>Descrição do Serviço</th>
      <th style="width:36px">Und</th>
      <th style="width:64px">Qtd Contr.</th>
      <th style="width:74px">P.Unit. (R$)</th>
      <th style="width:80px">Total c/BDI</th>
      <th style="width:64px">Acum. Ant.</th>
      <th style="width:64px">Acum. Total</th>
      <th style="width:64px">Med. Atual</th>
      <th style="width:56px">% Exec.</th>
      <th style="width:86px">Valor Med.</th>
      <th style="width:86px">Valor Acum.</th>
      <th style="width:50px">Obs</th>
    </tr>
  </thead>
  <tbody>
    ${tblRows}
  </tbody>
  <tfoot>
    <tr>
      <td colspan="12" style="text-align:right;font-size:7pt;text-transform:uppercase">TOTAIS DO BOLETIM (${bm.label || 'BM ' + bmNum})</td>
      <td class="td-r">${R$(totalVMed)}</td>
      <td class="td-r">${R$(totalVAcum)}</td>
      <td></td>
    </tr>
  </tfoot>
</table>

<div class="assin">
  <div class="assin-bloco"><div class="assin-linha">${cfg.contratada||'Empresa Executora'}<br>Responsável Técnico</div></div>
  <div class="assin-bloco"><div class="assin-linha">${cfg.fiscal||'Fiscal de Obras'}<br>${cfg.contratante||'Órgão Contratante'}</div></div>
</div>

<div class="footer">
  <span>BDI: ${(bdi*100).toFixed(1)}% · Contrato: ${cfg.contrato||'—'}</span>
  <span>Sistema Fiscal na Obra · Gerado em ${hoje.toLocaleString('pt-BR')}</span>
</div>
<script>window.print();<\/script>
</body></html>`;

        const w = window.open('','_blank','width=1200,height=800');
        if (w) { w.document.write(html); w.document.close(); }
        else window.toast?.('⚠️ Permita popups para gerar PDF.','warn');
      } catch(e) {
        console.error('[MemoriaModule] imprimirMemoria:', e);
        window.print();
      }
    };
  }

  destroy() {
    this._subs.forEach(u => u());
    this._subs = [];
    EventBus.offByContext('memoria');
  }
}
