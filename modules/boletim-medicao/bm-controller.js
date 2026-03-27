/**
 * ╔══════════════════════════════════════════════════════════════╗
 * ║  FISCAL NA OBRA v15.1 — modules/boletim-medicao/bm-controller.js ║
 * ║  Regras de negócio do Boletim de Medição                    ║
 * ╚══════════════════════════════════════════════════════════════╝
 *
 * Portado de: adicionarBM(), excluirBM(), editarBM(),
 *   renderBoletim(), renderConfig(), popularSelects() etc.
 */

import EventBus      from '../../core/EventBus.js';
import state         from '../../core/state.js';
import router        from '../../core/router.js';
import FirebaseService from '../../firebase/firebase-service.js';
import storageUtils    from '../../utils/storage.js';
import { formatters }  from '../../utils/formatters.js';
import { validarCapMedicao } from '../../utils/server-validators.js';
import { notifyDirectSave } from '../../utils/auto-save.js';
import {
  getMedicoes, salvarMedicoes, invalidarCacheMedicoes, _injetarCacheMedicoes,
  getValorAcumuladoTotal, getValorAcumuladoAnterior, getValorMedicaoAtual,
  getLinhasItem, getFxFormula, sumLinhasQtd,
  getQtdAcumuladoAnteriorItem, getQtdAcumuladoTotalItem,
  getBdiEfetivo, novoId,
} from './bm-calculos.js';
import { BoletimUI } from './bm-ui.js';
import CaixaBM       from './bm-caixa.js';
import { baixarCSV, numCSV } from '../../utils/csv-export.js';

export class BoletimModule {
  constructor() {
    this._subs = [];
  }

  async init() {
    try {
      this._ui      = new BoletimUI();
      this._caixaBM = new CaixaBM();
      this._ui.injectPage();
      this._bindEvents();
    } catch (e) {
      console.error('[BoletimModule] init:', e);
    }
  }

  onEnter() {
    try {
      this._atualizarSelects();
      const obraId = state.get('obraAtivaId');
      const bmNum  = parseInt(document.getElementById('sel-bol-bm')?.value || 1);
      // Carrega medições do Firebase antes de renderizar
      this._carregarMedicoesBM(obraId, bmNum).then(() => {
        this._render();
        this._atualizarControleBloqueio(obraId, bmNum);
      }).catch(e => {
        console.error('[BoletimModule] onEnter — carregar medições:', e);
        window.toast?.('⚠️ Erro ao carregar medições do BM. Tente novamente.', 'warn');
      });
    } catch (e) {
      console.error('[BoletimModule] onEnter:', e);
    }
  }

  // ── Carrega medições do Firebase para o cache em memória ──────
  // IMPORTANTE: para calcular o Acumulado Total corretamente, é necessário
  // ter em cache TODOS os BMs de 1 até bmNum. O cálculo do acumulado
  // itera cada BM individualmente — sem os dados dos BMs anteriores no
  // cache, o acumulado fica incorreto (conta apenas o BM atual).
  async _carregarMedicoesBM(obraId, bmNum) {
    if (!obraId) return;
    const bms = state.get('bms') || [];
    // Garante carregar até o maior BM existente para cobrir todos os acumulados
    const totalBMs = Math.max(bmNum, bms.length > 0 ? bms[bms.length - 1].num : bmNum);

    try {
      // Carrega todos os BMs de 1 até totalBMs em paralelo
      const promises = [];
      for (let n = 1; n <= totalBMs; n++) {
        // CORREÇÃO: não sobrescreve BMs que já têm dados no cache.
        // O MemCache é atualizado em tempo real por salvarMedicoes/aplicarPct;
        // buscar o Firebase aqui sobrescreveria dados recém-digitados no padrão CAIXA.
        // Só carrega do Firebase se o cache estiver vazio para este BM.
        const _cached = getMedicoes(obraId, n);
        if (Object.keys(_cached).length > 0) continue;
        promises.push(
          FirebaseService.getMedicoes(obraId, n)
            .then(med => {
              if (med && Object.keys(med).length > 0) {
                _injetarCacheMedicoes(obraId, n, med);
              }
            })
            .catch(e => console.error(`[BoletimModule] _carregarMedicoesBM BM${n}:`, e))
        );
      }
      await Promise.all(promises);
    } catch (e) {
      console.error('[BoletimModule] _carregarMedicoesBM:', e);
    }
  }

  // ── Impressão PDF ─────────────────────────────────────────────

  _imprimirBoletim() {
    try {
      const ctx    = this._getContext();
      const bmNum  = parseInt(document.getElementById('sel-bol-bm')?.value || 1);
      this._ui.imprimirBoletim(ctx, bmNum);
    } catch (e) {
      console.error('[BoletimModule] imprimirBoletim:', e);
      EventBus.emit('ui:toast', { msg: '❌ Erro ao gerar PDF.', tipo: 'error' });
    }
  }

  // ── Salvar Medição (persiste dados, NÃO bloqueia) ────────────
  _salvarMedicaoBol() {
    try {
      const obraId = state.get('obraAtivaId');
      const bmNum  = parseInt(document.getElementById('sel-bol-bm')?.value || 1);
      if (!obraId) {
        EventBus.emit('ui:toast', { msg: '⚠️ Nenhuma obra ativa.', tipo: 'warn' });
        return;
      }
      const med = getMedicoes(obraId, bmNum);
      salvarMedicoes(obraId, bmNum, med);
      EventBus.emit('medicao:salva', { bmNum, obraId, origem: 'boletim' });
      window.auditRegistrar?.({ modulo: 'Boletim de Medição', tipo: 'salvo', registro: `BM ${String(bmNum).padStart(2,'0')}`, detalhe: 'Medição salva' });
      EventBus.emit('ui:toast', {
        msg: `✅ Medição do BM ${String(bmNum).padStart(2, '0')} salva!`,
        tipo: 'ok'
      });
    } catch (e) {
      console.error('[BoletimModule] salvarMedicaoBol:', e);
    }
  }

  // ── Marcar como Salvo (bloqueia edição) ───────────────────────
  _marcarSalvoBol() {
    try {
      const obraId = state.get('obraAtivaId');
      const bmNum  = parseInt(document.getElementById('sel-bol-bm')?.value || 1);
      if (!obraId) return;
      const med = getMedicoes(obraId, bmNum);

      // ── Validação de Cap 100% por item (substitui Cloud Function validarCapMedicaoBM)
      // Migrado para client-side para funcionar no plano Spark (gratuito) do Firebase.
      const itensContrato = state.get('itensContrato') || [];
      const violacoesCap = [];
      for (const item of itensContrato) {
        if (!item?.id || !item?.qtd) continue;
        const qtdContratada     = parseFloat(item.qtd) || 0;
        if (qtdContratada <= 0) continue;
        const qtdAcumAnterior   = getQtdAcumuladoAnteriorItem(obraId, bmNum, item.id);
        const linhasAtual       = getLinhasItem(obraId, bmNum, item.id);
        const qtdMedicaoAtual   = sumLinhasQtd(linhasAtual);
        const { ok, erros }     = validarCapMedicao({ qtdContratada, qtdAcumuladaAntes: qtdAcumAnterior, qtdMedicaoAtual });
        if (!ok) violacoesCap.push(`${item.desc || item.id}: ${erros[0]}`);
      }
      if (violacoesCap.length > 0) {
        const resumo = violacoesCap.slice(0, 3).join('\n') + (violacoesCap.length > 3 ? `\n…e mais ${violacoesCap.length - 3} item(s).` : '');
        const confirmou = window.confirm(
          `⚠️ CAP DE 100% ULTRAPASSADO EM ${violacoesCap.length} ITEM(S):\n\n${resumo}\n\nDeseja bloquear o BM mesmo assim?`
        );
        if (!confirmou) return;
        window.auditRegistrar?.({ modulo: 'Boletim de Medição', tipo: 'alerta_cap', registro: `BM ${String(bmNum).padStart(2,'0')}`, detalhe: `Cap 100% violado: ${violacoesCap.join(' | ')}` });
      }

      const userLogado = state.get('usuarioLogado') || {};
      med._salva    = true;
      med._salvaEm  = new Date().toISOString();
      med._salvaPor = userLogado.displayName || (state.get('cfg') || {}).fiscal || 'Usuário';
      med._salvaPorUid   = userLogado.uid   || 'offline';
      med._salvaPorEmail = userLogado.email || '';
      // Snapshot imutável das quantidades no momento do bloqueio (rastreabilidade TCU)
      med._snapshot = { linhas: JSON.parse(JSON.stringify(med)), geradoEm: med._salvaEm };
      salvarMedicoes(obraId, bmNum, med);
      this._render();
      this._atualizarControleBloqueio(obraId, bmNum);
      EventBus.emit('medicao:salva', { bmNum, obraId, origem: 'boletim' });
      window.auditRegistrar?.({ modulo: 'Boletim de Medição', tipo: 'bloqueado', registro: `BM ${String(bmNum).padStart(2,'0')}`, detalhe: `Marcado como salvo por ${med._salvaPor} (${med._salvaPorEmail})` });
      EventBus.emit('ui:toast', { msg: `🔒 BM ${String(bmNum).padStart(2,'0')} marcado como salvo — edição bloqueada.`, tipo: 'ok' });
    } catch (e) {
      console.error('[BoletimModule] marcarSalvoBol:', e);
    }
  }

  // ── Desmarcar como Salvo (libera edição) — exige perfil fiscal/admin + motivo ─
  _desmarcarSalvoBol() {
    try {
      const obraId = state.get('obraAtivaId');
      const bmNum  = parseInt(document.getElementById('sel-bol-bm')?.value || 1);
      if (!obraId) return;

      // CORREÇÃO: verificar perfil do usuário logado
      const usuarios   = state.get('usuarios') || [];
      const userLogado = state.get('usuarioLogado') || {};
      const meuPerfil  = usuarios.find(u => u.uid === userLogado.uid || u.email === userLogado.email)?.perfil || '';
      const podeDesbloquear = ['fiscal','administrador','gestor'].includes(meuPerfil) || !meuPerfil; // fallback para sistemas sem perfil configurado

      if (!podeDesbloquear) {
        EventBus.emit('ui:toast', { msg: '🚫 Apenas o Fiscal ou Administrador pode remover o bloqueio de um BM.', tipo: 'error' });
        return;
      }

      // CORREÇÃO: exigir motivo escrito para o desbloqueio
      const motivo = window.prompt('⚠️ Informe o MOTIVO do desbloqueio (obrigatório para registro de auditoria):');
      if (motivo === null) return; // cancelou
      if (!motivo.trim() || motivo.trim().length < 10) {
        EventBus.emit('ui:toast', { msg: '⚠️ Motivo obrigatório (mínimo 10 caracteres).', tipo: 'warn' });
        return;
      }

      const med = getMedicoes(obraId, bmNum);
      med._salva              = false;
      med._desbloqueadoEm     = new Date().toISOString();
      med._desbloqueadoPor    = userLogado.displayName || userLogado.email || 'Usuário';
      med._desbloqueadoPorUid = userLogado.uid || 'offline';
      med._motivoDesbloqueio  = motivo.trim();
      salvarMedicoes(obraId, bmNum, med);
      this._render();
      // FIX: _atualizarControleBloqueio deve ser chamado APÓS o _render()
      // para que os botões e inputs recém-criados pelo render já existam no DOM.
      // Usar setTimeout(0) garante que o guardFocus/requestAnimationFrame do
      // bm-caixa.render() já completou antes de aplicar o estado de bloqueio.
      setTimeout(() => this._atualizarControleBloqueio(obraId, bmNum), 0);
      window.auditRegistrar?.({ modulo: 'Boletim de Medição', tipo: 'desbloqueado', registro: `BM ${String(bmNum).padStart(2,'0')}`, detalhe: `Desbloqueado por ${med._desbloqueadoPor} — Motivo: ${motivo.trim()}` });
      // FIX: emitir medicao:salva também no desbloqueio para que outros módulos
      // (dashboard, memória) atualizem seus estados corretamente.
      EventBus.emit('medicao:salva', { bmNum, obraId, origem: 'boletim' });
      EventBus.emit('ui:toast', { msg: `🔓 BM ${String(bmNum).padStart(2,'0')} liberado para edição.`, tipo: 'info' });
    } catch (e) {
      console.error('[BoletimModule] desmarcarSalvoBol:', e);
    }
  }

  _isMedicaoSalvaBol(obraId, bmNum) {
    try {
      const med = getMedicoes(obraId, bmNum);
      return !!(med && med._salva);
    } catch { return false; }
  }

  // ── Atualiza controles visuais de bloqueio do Boletim ─────────
  _atualizarControleBloqueio(obraId, bmNum) {
    const salva       = this._isMedicaoSalvaBol(obraId, bmNum);
    const badge       = document.getElementById('bol-status-badge');
    const btnMarcar   = document.getElementById('btn-marcar-bol');
    const btnDesmarcar= document.getElementById('btn-desmarcar-bol');
    const btnSalvar   = document.getElementById('btn-salvar-medicao-bol');

    if (badge) {
      badge.style.display = 'inline-flex';
      if (salva) {
        const med = getMedicoes(obraId, bmNum);
        const quando = med._salvaEm ? new Date(med._salvaEm).toLocaleString('pt-BR') : '—';
        badge.textContent = '🔒 Salvo';
        badge.style.background = '#fef3c7';
        badge.style.color      = '#92400e';
        badge.style.borderColor= '#f59e0b';
        badge.title = `Salvo em ${quando}${med._salvaPor ? ' por ' + med._salvaPor : ''}`;
      } else {
        badge.textContent = '✏️ Em edição';
        badge.style.background = '#f0fdf4';
        badge.style.color      = '#166534';
        badge.style.borderColor= '#86efac';
        badge.title = 'Documento em edição';
      }
    }

    if (btnMarcar)    btnMarcar.style.display    = salva ? 'none'         : 'inline-block';
    if (btnDesmarcar) btnDesmarcar.style.display = salva ? 'inline-block' : 'none';
    if (btnSalvar)    btnSalvar.disabled          = salva;

    // Bloqueia/libera botões de adição de itens na toolbar
    ['btn-add-item-bol', 'btn-macro-item-bol'].forEach(id => {
      const el = document.getElementById(id);
      if (el) el.disabled = salva;
    });
    // FIX-3: desabilita apenas botões de edição do BM atual (não gestão de BMs)
    document.querySelectorAll('#boletim .btn-verde:not(#btn-salvar-medicao-bol):not(#btn-marcar-bol):not([data-bm-mgmt]), #boletim .btn-laranja:not([data-bm-mgmt])').forEach(el => {
      el.disabled = salva;
      el.style.opacity = salva ? '0.45' : '';
    });
  }

  // ── CRUD Item / Macro (delegates para modal no index.html) ────

  // ═══════════════════════════════════════════════════════════════
  //  EDITOR DE ITEM — modal completo (editar / novo)
  // ═══════════════════════════════════════════════════════════════
  _abrirCrudItemBM(modo, itemId) {
    const itens  = state.get('itensContrato') || [];
    const item   = modo === 'editar' ? itens.find(i => i.id === itemId) : null;
    const obraId = state.get('obraAtivaId');
    const cfg    = state.get('cfg') || {};

    // Remove modal anterior
    document.getElementById('bm-item-modal-overlay')?.remove();
    document.getElementById('bm-item-modal')?.remove();

    const overlay = document.createElement('div');
    overlay.id = 'bm-item-modal-overlay';
    overlay.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,.55);z-index:1100';
    overlay.onclick = () => { overlay.remove(); modal.remove(); };

    const modal = document.createElement('div');
    modal.id = 'bm-item-modal';
    modal.style.cssText = 'position:fixed;top:50%;left:50%;transform:translate(-50%,-50%);z-index:1101;' +
      'background:var(--bg-card);border:1px solid var(--border);border-radius:14px;' +
      'padding:24px;min-width:520px;max-width:680px;width:90vw;max-height:90vh;overflow-y:auto;' +
      'box-shadow:0 20px 60px rgba(0,0,0,.4)';

    const tipoItem = item?.t || '';
    const ehAgregador = tipoItem === 'G' || tipoItem === 'SG';

    modal.innerHTML = `
      <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:18px">
        <div>
          <div style="font-size:10px;font-weight:700;color:var(--text-muted);text-transform:uppercase;letter-spacing:.5px">${modo==='editar'?'Editar Item':'Novo Item'}</div>
          <div style="font-size:15px;font-weight:800;color:var(--text-primary)">${item?.id||'—'} ${item?.desc||''}</div>
        </div>
        <button data-action="_bmFecharItemModal"
          style="background:none;border:none;font-size:22px;cursor:pointer;color:var(--text-muted)">×</button>
      </div>

      <!-- Toggle: item normal / agregador -->
      <div style="display:flex;gap:8px;margin-bottom:16px">
        <button id="bm-btn-normal" data-action="_bmToggleAgregador" data-arg0="false"
          style="padding:7px 16px;border-radius:7px;font-size:12px;font-weight:700;cursor:pointer;
            background:${!ehAgregador?'var(--accent)':'var(--bg-surface)'};
            border:2px solid ${!ehAgregador?'var(--accent)':'var(--border)'};
            color:${!ehAgregador?'#fff':'var(--text-muted)'}">
          📄 Item de Serviço</button>
        <button id="bm-btn-agr" data-action="_bmToggleAgregador" data-arg0="true"
          style="padding:7px 16px;border-radius:7px;font-size:12px;font-weight:700;cursor:pointer;
            background:${ehAgregador?'#7c3aed':'var(--bg-surface)'};
            border:2px solid ${ehAgregador?'#7c3aed':'var(--border)'};
            color:${ehAgregador?'#fff':'var(--text-muted)'}">
          📂 Item Agregador (Grupo)</button>
      </div>

      <div id="bm-form-campos">
        ${this._formCamposItem(item, ehAgregador)}
      </div>

      <!-- Info de posicionamento -->
      <div style="background:var(--bg-surface);border:1px solid var(--border);border-radius:8px;padding:10px;margin-top:12px;font-size:11px;color:var(--text-muted)">
        ℹ️ O item será posicionado automaticamente na ordem hierárquica correta da planilha.
      </div>

      <div style="display:flex;gap:10px;justify-content:flex-end;margin-top:18px">
        <button data-action="_bmFecharItemModal"
          style="padding:9px 20px;background:var(--bg-surface);border:1px solid var(--border);border-radius:8px;font-size:12px;font-weight:700;cursor:pointer;color:var(--text-primary)">
          Cancelar</button>
        <button data-action="_bmSalvarItem" data-arg0="${modo}" data-arg1="${itemId||''}" 
          style="padding:9px 20px;background:var(--accent);border:none;border-radius:8px;color:#fff;font-size:12px;font-weight:700;cursor:pointer">
          💾 ${modo==='editar'?'Salvar Alterações':'Criar Item'}</button>
      </div>`;

    document.body.appendChild(overlay);
    document.body.appendChild(modal);

    // Toggle entre tipo normal e agregador
    window._bmToggleAgregador = (isAgr) => {
      const campos = document.getElementById('bm-form-campos');
      if (campos) campos.innerHTML = this._formCamposItem(item, isAgr);
      const btnN = document.getElementById('bm-btn-normal');
      const btnA = document.getElementById('bm-btn-agr');
      if (btnN) { btnN.style.background = !isAgr?'var(--accent)':'var(--bg-surface)'; btnN.style.borderColor = !isAgr?'var(--accent)':'var(--border)'; btnN.style.color = !isAgr?'#fff':'var(--text-muted)'; }
      if (btnA) { btnA.style.background = isAgr?'#7c3aed':'var(--bg-surface)'; btnA.style.borderColor = isAgr?'#7c3aed':'var(--border)'; btnA.style.color = isAgr?'#fff':'var(--text-muted)'; }
    };

    // Salvar item
    window._bmSalvarItem = (modo, itemId) => {
      const g     = id => document.getElementById(id);
      const idNew = (g('bm-item-id')?.value||'').trim();
      const desc  = (g('bm-item-desc')?.value||'').trim();
      const und   = (g('bm-item-und')?.value||'').trim();
      const qtd   = parseFloat((g('bm-item-qtd')?.value||'0').replace(',','.'))||0;
      const up    = parseFloat((g('bm-item-up')?.value||'0').replace(',','.'))||0;
      const upBdi = parseFloat((g('bm-item-upbdi')?.value||'0').replace(',','.').replace(/[^0-9.]/g,''))||0;
      const cod   = (g('bm-item-cod')?.value||'').trim();
      const banco = (g('bm-item-banco')?.value||'').trim();
      // TCU Acórdão 2.622/2013: tipo de BDI por item e preço de referência SINAPI/ORSE
      const tipoBdi = (g('bm-item-tipobdi')?.value||'').trim();
      const upRef   = parseFloat((g('bm-item-upref')?.value||'0').replace(',','.'))||0;
      const tipoAgr = g('bm-item-tipo')?.value||'';
      const ehGrupo = tipoAgr === 'G' || tipoAgr === 'SG';

      if (!idNew) { window.toast?.('⚠️ Informe o código do item.','warn'); return; }
      if (!desc)  { window.toast?.('⚠️ Informe a descrição.','warn'); return; }

      const itens = state.get('itensContrato') || [];
      const obraId = state.get('obraAtivaId');

      let novosItens;
      if (modo === 'editar') {
        novosItens = itens.map(i => i.id === itemId
          ? { ...i, id:idNew, desc, und, qtd, up, upBdi: upBdi||undefined, cod, banco, tipoBdi: tipoBdi||undefined, upRef: upRef||undefined, t: ehGrupo?(tipoAgr||'G'):undefined }
          : i);

        // FIX-2: se o código (id) do item mudou, migra medições do id antigo para o novo
        // em TODOS os BMs, para não perder dados já registrados.
        if (idNew !== itemId) {
          try {
            // FIX: getMedicoes e salvarMedicoes já são importadas estaticamente no topo
            // do arquivo — o await import() dinâmico aqui causava SyntaxError porque
            // esta arrow function não é async, travando o boot completo do sistema.
            const bms = state.get('bms') || [];
            for (const bm of bms) {
              const med = getMedicoes(obraId, bm.num);
              if (med[itemId] !== undefined) {
                med[idNew] = med[itemId];
                delete med[itemId];
                salvarMedicoes(obraId, bm.num, med);
              }
            }
          } catch (_e) { console.warn('[BM] migrar medicoes:', _e); }
        }
      } else {
        const novoItem = { id:idNew, desc, und: ehGrupo?'':und, qtd: ehGrupo?0:qtd, up: ehGrupo?0:up, upBdi: (!ehGrupo&&upBdi)?upBdi:undefined, cod, banco, bdi: cfg.bdi||0.25, tipoBdi: tipoBdi||undefined, upRef: upRef||undefined, t: ehGrupo?'G':undefined };
        novosItens = this._inserirItemOrdenado([...itens], novoItem);
      }

      state.set('itensContrato', novosItens);
      // Invalida cache de valores acumulados — necessário quando upBdi ou up muda
      invalidarCacheMedicoes(obraId);
      // Persiste
      import('../../firebase/firebase-service.js').then(m => m.default.setItens?.(obraId, novosItens)).catch(()=>{});

      document.getElementById('bm-item-modal-overlay')?.remove();
      document.getElementById('bm-item-modal')?.remove();

      EventBus.emit('itens:atualizados', {});
      window.toast?.(`✅ Item ${idNew} ${modo==='editar'?'atualizado':'criado'}!`,'ok');
    };
  }

  _formCamposItem(item, ehAgregador) {
    const cfg = state.get('cfg') || {};
    const lbl = (txt) => `<label style="font-size:11px;font-weight:700;color:var(--text-muted);display:block;margin-bottom:4px">${txt}</label>`;
    const inp = (id, val, ph, tipo='text', extra='') =>
      `<input id="${id}" type="${tipo}" value="${String(val||'').replace(/"/g,'&quot;')}" placeholder="${ph}"
        style="width:100%;padding:8px 10px;border-radius:7px;border:1px solid var(--border);
          background:var(--bg-surface);color:var(--text-primary);font-size:12px;box-sizing:border-box;${extra}">`;

    return `
      <input type="hidden" id="bm-item-tipo" value="${ehAgregador?(item?.t||'G'):''}">
      <div style="display:grid;grid-template-columns:1fr 2fr;gap:10px;margin-bottom:12px">
        <div>${lbl('Código do Item *')}${inp('bm-item-id',item?.id,'Ex: 4.5.1')}</div>
        <div>${lbl('Descrição *')}${inp('bm-item-desc',item?.desc||item?.descricao,'Descrição completa do serviço')}</div>
      </div>
      ${!ehAgregador ? `
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-bottom:10px">
        <div>${lbl('Unidade')}${inp('bm-item-und',item?.und,'M², UN, KG...')}</div>
        <div>${lbl('Quantidade')}${inp('bm-item-qtd',item?.qtd != null && item?.qtd !== '' ? String(item.qtd).replace('.',',') : '','0,00','text')}</div>
      </div>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-bottom:10px">
        <div>${lbl('Preço Unitário sem BDI (R$)')}
          <input id="bm-item-up" type="text"
            value="${item?.up != null && item?.up !== '' ? String(item.up) : ''}"
            placeholder="0,00"
            style="width:100%;padding:8px 10px;border-radius:7px;border:1px solid var(--border);
              background:var(--bg-surface);color:var(--text-primary);font-size:12px;box-sizing:border-box;
              font-family:var(--font-mono)"
            oninput="(function(el){var tb=document.getElementById('bm-item-tipobdi');var bdiT=tb?tb.value:'';var bdi=bdiT==='zero'?0:bdiT==='reduzido'?${cfg.bdiReduzido||0.10}:${cfg.bdi||0.25};var v=parseFloat(el.value.replace(',','.'))||0;var el2=document.getElementById('bm-item-upbdi');if(el2)el2.value=(v*(1+bdi)).toLocaleString('pt-BR',{minimumFractionDigits:2,maximumFractionDigits:2});})(this)">
        </div>
        <div>${lbl('Preço Unitário c/BDI (R$)')}
          <input id="bm-item-upbdi" type="text"
            value="${item?.up != null && item?.up !== '' ? ((parseFloat(item.up)||0)*(1+(item?.tipoBdi==='zero'?0:item?.tipoBdi==='reduzido'?(cfg.bdiReduzido||0.10):(cfg.bdi||0.25)))).toLocaleString('pt-BR',{minimumFractionDigits:2,maximumFractionDigits:2}) : ''}"
            placeholder="0,00"
            style="width:100%;padding:8px 10px;border-radius:7px;border:2px solid #86efac;
              background:#f0fdf4;color:#166534;font-size:12px;box-sizing:border-box;
              font-family:var(--font-mono)"
            oninput="(function(el){var tb=document.getElementById('bm-item-tipobdi');var bdiT=tb?tb.value:'';var bdi=bdiT==='zero'?0:bdiT==='reduzido'?${cfg.bdiReduzido||0.10}:${cfg.bdi||0.25};var v=parseFloat(el.value.replace(',','.'))||0;var el2=document.getElementById('bm-item-up');if(el2)el2.value=(bdi>0?(v/(1+bdi)):v).toLocaleString('pt-BR',{minimumFractionDigits:4,maximumFractionDigits:4});})(this)">
        </div>
      </div>` : `
      <input type="hidden" id="bm-item-und" value="">
      <input type="hidden" id="bm-item-qtd" value="0">
      <input type="hidden" id="bm-item-up"  value="0">
      <div style="background:#7c3aed18;border:1px solid #7c3aed;border-radius:8px;padding:10px;margin-bottom:10px;font-size:11px;color:var(--text-primary)">
        📂 <strong>Item Agregador</strong> — funciona como grupo de itens. Não possui quantidade ou valor direto.<br>
        Subitens (${item?.id||'X'}.1, ${item?.id||'X'}.2 ...) somam automaticamente.
      </div>`}
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px">
        <div>${lbl('Código Banco de Preços')}${inp('bm-item-cod',item?.cod,'Ex: SINAPI-12345')}</div>
        <div>${lbl('Banco de Referência')}${inp('bm-item-banco',item?.banco,'SINAPI, ORSE, SEINFRA...')}</div>
      </div>
      ${!ehAgregador ? `
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-top:10px">
        <div>
          ${lbl('Tipo de BDI <span style="font-size:9px;color:#6b7280;font-weight:400">(TCU Acórdão 2.622/2013)</span>')}
          <select id="bm-item-tipobdi"
            style="width:100%;padding:8px 10px;border-radius:7px;border:1px solid var(--border);
              background:var(--bg-surface);color:var(--text-primary);font-size:12px;box-sizing:border-box">
            <option value=""         ${!item?.tipoBdi||item?.tipoBdi===''?'selected':''}>Integral (padrão — serviços)</option>
            <option value="reduzido" ${item?.tipoBdi==='reduzido'?'selected':''}>Reduzido (equipamentos/materiais)</option>
            <option value="zero"     ${item?.tipoBdi==='zero'?'selected':''}>Zero (fornecimento direto)</option>
          </select>
        </div>
        <div>
          ${lbl('Preço Referência SINAPI/ORSE (R$) <span style="font-size:9px;color:#6b7280;font-weight:400">opcional — alerta desvio</span>')}
          <input id="bm-item-upref" type="text" value="${String(item?.upRef||'').replace(/"/g,'&quot;')}"
            placeholder="Preço unitário da tabela referência"
            style="width:100%;padding:8px 10px;border-radius:7px;border:1px solid var(--border);
              background:var(--bg-surface);color:var(--text-primary);font-size:12px;box-sizing:border-box;
              font-family:var(--font-mono)">
        </div>
      </div>` : ''}`.trim();
  }

  // ── Posicionamento hierárquico automático ──────────────────────
  // Insere o novo item imediatamente após o último irmão/descendente anterior.
  // Ex: 4.5.8 é inserido após 4.5.7 (e todos seus filhos), antes de 4.6.
  _inserirItemOrdenado(itens, novoItem) {
    const parseId = id => String(id || '').split('.').map(n => parseInt(n, 10) || 0);

    const cmp = (a, b) => {
      const pa = parseId(a), pb = parseId(b);
      for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
        const d = (pa[i] || 0) - (pb[i] || 0);
        if (d !== 0) return d;
      }
      return 0;
    };

    // Um item é "pertencente ao bloco de idRef" se seu id começa com idRef + '.'
    // Ou seja, é descendente de idRef.
    const isDescendente = (id, ancestorId) => id.startsWith(ancestorId + '.');

    const idNovo = novoItem.id;

    // Encontra o índice de inserção:
    // Percorre a lista e avança enquanto o item atual é menor que o novo
    // OU é descendente de um item que é menor — assim 4.5.8 pula também os filhos de 4.5.7.
    let insertAfter = -1;
    for (let i = 0; i < itens.length; i++) {
      const id = itens[i].id;
      if (cmp(id, idNovo) < 0) {
        // id < idNovo: marca posição candidata
        insertAfter = i;
      } else if (insertAfter >= 0 && isDescendente(id, itens[insertAfter].id)) {
        // id > idNovo mas é filho do último candidato — avança junto
        insertAfter = i;
      }
    }

    const novosItens = [...itens];
    novosItens.splice(insertAfter + 1, 0, novoItem);
    return novosItens;
  }

  // ═══════════════════════════════════════════════════════════════
  //  EDITOR DE ITEM AGREGADOR (G / SG) — ALT1
  //  Permite editar observações e ajuste manual do grupo/subgrupo.
  //  Os valores calculados pelos subitens NÃO são alterados.
  //  Os dados são armazenados em medicoes['_obs_' + itemId].
  // ═══════════════════════════════════════════════════════════════
  _editarAgregadorBM(tipo, itemId) {
    const obraId = state.get('obraAtivaId');
    const itens  = state.get('itensContrato') || [];
    const cfg    = state.get('cfg') || {};
    const item   = itens.find(i => i.id === itemId);
    const bmNum  = parseInt(document.getElementById('sel-bol-bm')?.value || 1);
    const med    = getMedicoes(obraId, bmNum);

    // Carrega dados já salvos (se houver)
    const meta = med[`_obs_${itemId}`] || { obs: '', ajuste: 0 };

    // Calcula total dos subitens (somente leitura, para exibição)
    const bdi    = cfg.bdi || 0.25;
    let tCalcCont = 0, tCalcAcum = 0;
    itens.forEach(sub => {
      if (sub.t || !sub.id.startsWith(itemId + '.')) return;
      const upBdi = (sub.up || 0) * (1 + bdi);
      tCalcCont  += (sub.qtd || 0) * upBdi;
      const qtdAcum = sumLinhasQtd(sub.und, getLinhasItem(med, sub.id), getFxFormula(med, sub.id));
      tCalcAcum  += qtdAcum * upBdi;
    });

    // Lista de subitens diretos para exibição com opção de exclusão
    const filhosDirectos = itens.filter(i => {
      if (i.id === itemId) return false;
      if (!i.id.startsWith(itemId + '.')) return false;
      const resto = i.id.slice(itemId.length + 1);
      return !resto.includes('.'); // apenas filhos diretos
    });

    const R$ = v => v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
    const tipoLabel = tipo === 'G' ? '📂 Grupo' : '📁 Subgrupo';

    document.getElementById('bm-agr-modal-overlay')?.remove();
    document.getElementById('bm-agr-modal')?.remove();

    const overlay = document.createElement('div');
    overlay.id = 'bm-agr-modal-overlay';
    overlay.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,.55);z-index:1200';
    overlay.onclick = () => { overlay.remove(); document.getElementById('bm-agr-modal')?.remove(); };

    const modal = document.createElement('div');
    modal.id = 'bm-agr-modal';
    modal.style.cssText =
      'position:fixed;top:50%;left:50%;transform:translate(-50%,-50%);z-index:1201;' +
      'background:var(--bg-card);border:1px solid var(--border);border-radius:14px;' +
      'padding:24px;min-width:520px;max-width:680px;width:90vw;max-height:90vh;overflow-y:auto;' +
      'box-shadow:0 20px 60px rgba(0,0,0,.4)';

    modal.innerHTML = `
      <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:16px">
        <div>
          <div style="font-size:10px;font-weight:700;color:var(--text-muted);text-transform:uppercase;letter-spacing:.5px">${tipoLabel} — Editar</div>
          <div style="font-size:15px;font-weight:800;color:var(--text-primary)">${itemId} &nbsp; ${item?.desc || ''}</div>
        </div>
        <button id="bm-agr-fechar"
          style="background:none;border:none;font-size:22px;cursor:pointer;color:var(--text-muted)">×</button>
      </div>

      <!-- FIX-4: Campos editáveis de código e nome do item agregador -->
      <div style="background:var(--bg-surface);border:1px solid var(--border);border-radius:8px;padding:12px;margin-bottom:14px">
        <div style="font-size:10px;font-weight:700;color:var(--text-muted);text-transform:uppercase;margin-bottom:10px">✏️ Dados do Item Agregador</div>
        <div style="display:grid;grid-template-columns:1fr 2fr;gap:10px">
          <div>
            <label style="font-size:11px;font-weight:700;color:var(--text-muted);display:block;margin-bottom:4px">Código</label>
            <input id="bm-agr-codigo" type="text" value="${item?.id || ''}"
              style="width:100%;padding:8px 10px;border-radius:7px;border:1px solid var(--border);background:var(--bg-surface);color:var(--text-primary);font-size:12px;box-sizing:border-box">
          </div>
          <div>
            <label style="font-size:11px;font-weight:700;color:var(--text-muted);display:block;margin-bottom:4px">Nome / Descrição</label>
            <input id="bm-agr-nome" type="text" value="${(item?.desc || '').replace(/"/g,'&quot;')}"
              style="width:100%;padding:8px 10px;border-radius:7px;border:1px solid var(--border);background:var(--bg-surface);color:var(--text-primary);font-size:12px;box-sizing:border-box">
          </div>
        </div>
      </div>

      <!-- Totais calculados pelos subitens (somente leitura) -->
      <div style="background:var(--bg-surface);border:1px solid var(--border);border-radius:8px;padding:12px;margin-bottom:14px">
        <div style="font-size:10px;font-weight:700;color:var(--text-muted);text-transform:uppercase;margin-bottom:8px">📊 Totais Calculados pelos Subitens (somente leitura)</div>
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px">
          <div>
            <div style="font-size:10px;color:var(--text-muted)">Total Contratual</div>
            <div style="font-size:14px;font-weight:700;font-family:var(--font-mono)">${R$(tCalcCont)}</div>
          </div>
          <div>
            <div style="font-size:10px;color:var(--text-muted)">Total Medido (Acumulado)</div>
            <div style="font-size:14px;font-weight:700;font-family:var(--font-mono);color:#059669">${R$(tCalcAcum)}</div>
          </div>
        </div>
      </div>

      <!-- FIX-4: Lista de itens agregados com opção de exclusão -->
      ${filhosDirectos.length > 0 ? `
      <div style="background:var(--bg-surface);border:1px solid var(--border);border-radius:8px;padding:12px;margin-bottom:14px">
        <div style="font-size:10px;font-weight:700;color:var(--text-muted);text-transform:uppercase;margin-bottom:8px">📋 Itens Agregados (${filhosDirectos.length})</div>
        <div style="display:flex;flex-direction:column;gap:5px;max-height:180px;overflow-y:auto">
          ${filhosDirectos.map(f => `
          <div style="display:flex;align-items:center;justify-content:space-between;padding:6px 8px;background:rgba(255,255,255,.04);border-radius:5px;border:1px solid var(--border)">
            <div>
              <span style="font-size:11px;font-weight:700;color:var(--text-primary)">${f.id}</span>
              <span style="font-size:10px;color:var(--text-muted);margin-left:6px">${(f.desc||'').slice(0,45)}</span>
            </div>
            <button data-action="_bmAgrExcluirFilho" data-arg0="${f.id}"
              style="padding:3px 8px;background:transparent;border:1px solid #ef4444;border-radius:5px;color:#ef4444;font-size:10px;cursor:pointer;flex-shrink:0;margin-left:8px">
              🗑️</button>
          </div>`).join('')}
        </div>
        <div style="font-size:10px;color:var(--text-muted);margin-top:8px">
          ⚠️ Excluir um item agregado remove o item do contrato. As medições já registradas serão preservadas.
        </div>
      </div>` : ''}

      <!-- Observações -->
      <div style="margin-bottom:14px">
        <label style="font-size:11px;font-weight:700;color:var(--text-muted);display:block;margin-bottom:5px">
          📝 Observações do Item Agregador
        </label>
        <textarea id="bm-agr-obs" rows="3" placeholder="Ex: Obras de infraestrutura — medição parcial conforme cronograma..."
          style="width:100%;padding:8px 10px;border-radius:7px;border:1px solid var(--border);background:var(--bg-surface);color:var(--text-primary);font-size:12px;box-sizing:border-box;resize:vertical">${meta.obs || ''}</textarea>
      </div>

      <div style="margin-bottom:20px">
        <label style="font-size:11px;font-weight:700;color:var(--text-muted);display:block;margin-bottom:5px">
          ± Ajuste Manual de Valor (R$)
          <span style="font-size:10px;font-weight:400;margin-left:6px">Opcional — use para complementar o total calculado</span>
        </label>
        <input id="bm-agr-ajuste" type="number" step="0.01" value="${meta.ajuste || 0}"
          placeholder="0,00"
          style="width:200px;padding:8px 10px;border-radius:7px;border:1px solid var(--border);background:var(--bg-surface);color:var(--text-primary);font-size:12px;font-family:var(--font-mono)">
        <span style="font-size:10px;color:var(--text-muted);margin-left:8px">Positivo = acréscimo &nbsp;|&nbsp; Negativo = supressão</span>
      </div>

      <div style="display:flex;gap:10px;justify-content:space-between;align-items:center">
        ${(meta.obs || meta.ajuste) ? `
          <button id="bm-agr-limpar"
            style="padding:8px 16px;background:transparent;border:1px solid var(--red,#dc2626);border-radius:8px;color:var(--red,#dc2626);font-size:12px;font-weight:700;cursor:pointer">
            🗑️ Limpar obs/ajuste</button>` : '<span></span>'}
        <div style="display:flex;gap:10px">
          <button id="bm-agr-cancelar"
            style="padding:9px 20px;background:var(--bg-surface);border:1px solid var(--border);border-radius:8px;font-size:12px;font-weight:700;cursor:pointer;color:var(--text-primary)">
            Cancelar</button>
          <button id="bm-agr-salvar"
            style="padding:9px 20px;background:var(--accent);border:none;border-radius:8px;color:#fff;font-size:12px;font-weight:700;cursor:pointer">
            💾 Salvar</button>
        </div>
      </div>`;

    document.body.appendChild(overlay);
    document.body.appendChild(modal);

    const fechar = () => {
      overlay.remove();
      modal.remove();
    };

    document.getElementById('bm-agr-fechar').onclick   = fechar;
    document.getElementById('bm-agr-cancelar').onclick = fechar;

    // FIX-4: exclusão de filhos diretos
    window._bmAgrExcluirFilho = (filhoId) => {
      if (!confirm(`Excluir item "${filhoId}" do contrato? As medições já registradas serão preservadas.`)) return;
      const itensAtual = state.get('itensContrato') || [];
      const novosItens = itensAtual.filter(i => i.id !== filhoId);
      state.set('itensContrato', novosItens);
      import('../../firebase/firebase-service.js').then(m => m.default.setItens?.(obraId, novosItens)).catch(() => {});
      EventBus.emit('itens:atualizados', {});
      window.toast?.(`🗑️ Item "${filhoId}" excluído.`, 'ok');
      // Reabre o modal com dados atualizados
      fechar();
      setTimeout(() => this._editarAgregadorBM(tipo, itemId), 80);
    };

    const btnLimpar = document.getElementById('bm-agr-limpar');
    if (btnLimpar) {
      btnLimpar.onclick = () => {
        if (!confirm('Limpar observações e ajuste deste item?')) return;
        delete med[`_obs_${itemId}`];
        salvarMedicoes(obraId, bmNum, med);
        fechar();
        this._render();
        window.toast?.('🗑️ Dados do item agregador removidos.', 'info');
      };
    }

    document.getElementById('bm-agr-salvar').onclick = () => {
      const novoCodigo = (document.getElementById('bm-agr-codigo')?.value || '').trim();
      const novoNome   = (document.getElementById('bm-agr-nome')?.value   || '').trim();
      const obs    = (document.getElementById('bm-agr-obs')?.value || '').trim();
      const ajuste = parseFloat(document.getElementById('bm-agr-ajuste')?.value || 0) || 0;

      if (!novoCodigo) { window.toast?.('⚠️ Informe o código do item.', 'warn'); return; }
      if (!novoNome)   { window.toast?.('⚠️ Informe a descrição do item.', 'warn'); return; }

      // FIX-4: atualiza nome e código do item agregador no contrato
      const itensAtual = state.get('itensContrato') || [];
      const idMudou = novoCodigo !== itemId;
      const novosItens = itensAtual.map(i => {
        if (i.id === itemId) return { ...i, id: novoCodigo, desc: novoNome };
        // Se o id mudou, renomeia filhos: ex "1.2.1" → "1.3.1"
        if (idMudou && i.id.startsWith(itemId + '.')) {
          return { ...i, id: novoCodigo + i.id.slice(itemId.length) };
        }
        return i;
      });

      state.set('itensContrato', novosItens);
      import('../../firebase/firebase-service.js').then(m => m.default.setItens?.(obraId, novosItens)).catch(() => {});

      // FIX-4: migra obs de medicoes se o id mudou
      if (idMudou) {
        const bmsLista = state.get('bms') || [];
        for (const bm of bmsLista) {
          const m2 = getMedicoes(obraId, bm.num);
          let alterado = false;
          if (m2[`_obs_${itemId}`] !== undefined) {
            m2[`_obs_${novoCodigo}`] = m2[`_obs_${itemId}`];
            delete m2[`_obs_${itemId}`];
            alterado = true;
          }
          // Migra medições dos subitens renomeados
          Object.keys(m2).forEach(k => {
            if (k.startsWith(itemId + '.')) {
              m2[novoCodigo + k.slice(itemId.length)] = m2[k];
              delete m2[k];
              alterado = true;
            }
          });
          if (alterado) salvarMedicoes(obraId, bm.num, m2);
        }
      }

      // Salva obs/ajuste
      const medAtual = getMedicoes(obraId, bmNum);
      const chaveObs = `_obs_${idMudou ? novoCodigo : itemId}`;
      if (obs || ajuste !== 0) {
        medAtual[chaveObs] = { obs, ajuste };
      } else {
        delete medAtual[chaveObs];
      }
      salvarMedicoes(obraId, bmNum, medAtual);

      fechar();
      EventBus.emit('itens:atualizados', {});
      this._render();
      window.toast?.(`✅ Item agregador "${novoCodigo}" atualizado!`, 'ok');
    };
  }


  _abrirCrudMacroItem() {
    this._abrirCrudItemBM('novo', null);
  }

  adicionarBM() {
    try {
      const bms    = state.get('bms');
      const cfg    = state.get('cfg');
      const obraId = state.get('obraAtivaId');
      const meta   = state.get('obraMeta') || { contractVersion: 1 };
      const num    = bms.length + 1;

      // Persiste medições do BM anterior e cria store vazio para o novo
      if (num > 1) {
        const prevMed = getMedicoes(obraId, num - 1);
        salvarMedicoes(obraId, num - 1, prevMed);
      }

      // Novo BM com store vazio
      salvarMedicoes(obraId, num, {});

      const novoBM = {
        num,
        label: `BM ${String(num).padStart(2, '0')}`,
        mes:   '(a definir)',
        data:  '',
        contractVersion: meta.contractVersion || 1,
      };

      const novosBms = [...bms, novoBM];
      state.set('bms', novosBms);

      this._persistBMs(obraId, novosBms);
      this._atualizarSelects();

      const prevLabel = num > 1
        ? (bms.find(b => b.num === num - 1)?.label || `BM ${String(num-1).padStart(2,'0')}`)
        : '—';

      EventBus.emit('boletim:criado', { bm: novoBM });
      EventBus.emit('ui:toast', { msg: `✅ BM ${String(num).padStart(2,'0')} criado! Acumulado Anterior = Total do ${prevLabel}.` });

    } catch (e) {
      console.error('[BoletimModule] adicionarBM:', e);
      EventBus.emit('ui:toast', { msg: '❌ Erro ao criar BM.', tipo: 'error' });
    }
  }

  editarBM(num) {
    try {
      const bms = state.get('bms');
      const bm  = bms.find(b => b.num === num);
      if (!bm) return;

      const mes  = prompt('Mês de Referência (ex: Março/2025):', bm.mes)  ?? bm.mes;
      const data = prompt('Data da Medição (AAAA-MM-DD):', bm.data) ?? bm.data;

      // Validação de sequência cronológica
      if (data) {
        const dataIso = data.includes('/') ? data.split('/').reverse().join('-') : data;
        const bmAnterior = bms.find(b => b.num === num - 1);
        const bmSeguinte = bms.find(b => b.num === num + 1);

        if (bmAnterior?.data && dataIso < bmAnterior.data) {
          window.toast?.(`⚠️ A data do BM ${String(num).padStart(2,'0')} (${dataIso}) não pode ser anterior ao BM ${String(num-1).padStart(2,'0')} (${bmAnterior.data}). Corrija a sequência cronológica.`, 'warn');
          return;
        }
        if (bmSeguinte?.data && dataIso > bmSeguinte.data) {
          window.toast?.(`⚠️ A data do BM ${String(num).padStart(2,'0')} (${dataIso}) não pode ser posterior ao BM ${String(num+1).padStart(2,'0')} (${bmSeguinte.data}). Corrija a sequência cronológica.`, 'warn');
          return;
        }
      }

      const novosBms = bms.map(b => {
        if (b.num !== num) return b;
        // Deriva mês de referência automaticamente da data para padronização
        let mesFormatado = mes;
        if (data) {
          const dataIso = data.includes('/') ? data.split('/').reverse().join('-') : data;
          try {
            const d = new Date(dataIso + 'T12:00:00');
            const MESES = ['Janeiro','Fevereiro','Março','Abril','Maio','Junho','Julho','Agosto','Setembro','Outubro','Novembro','Dezembro'];
            mesFormatado = `${MESES[d.getMonth()]}/${d.getFullYear()}`;
          } catch(e) {}
        }
        return { ...b, mes: mesFormatado, data: data.includes('/') ? data.split('/').reverse().join('-') : data };
      });
      state.set('bms', novosBms);

      const obraId = state.get('obraAtivaId');
      this._persistBMs(obraId, novosBms);
      this._atualizarSelects();

      EventBus.emit('boletim:atualizado', { bms: novosBms });
      EventBus.emit('ui:toast', { msg: '✅ Boletim atualizado!' });
    } catch (e) {
      console.error('[BoletimModule] editarBM:', e);
    }
  }

  excluirBM(numExcluir) {
    try {
      const bms    = state.get('bms');
      const obraId = state.get('obraAtivaId');

      if (bms.length <= 1) {
        EventBus.emit('ui:toast', { msg: '⚠️ Não é possível excluir o único BM existente.', tipo: 'warn' });
        return;
      }

      const bm = bms.find(b => b.num === numExcluir);
      if (!bm) return;

      const proximos = bms.filter(b => b.num > numExcluir);
      let msg = `🗑️ Mover ${bm.label} (${bm.mes}) para a Lixeira?`;
      if (proximos.length > 0) {
        msg += `\n\nOs BMs seguintes (${proximos.map(b => b.label).join(', ')}) serão renumerados.`;
      }
      if (!confirm(msg)) return;

      // Salva na lixeira (Firebase)
      const medSnap = getMedicoes(obraId, numExcluir);
      FirebaseService.salvarItemLixeiraFirebase?.({
        id: `lx_${Date.now()}`,
        tipo: 'bm',
        label: `${bm.label} (${bm.mes})`,
        obraId,
        excluidoEm: new Date().toISOString(),
        dados: { bm: { ...bm }, obraId, medicoes: medSnap },
      }).catch(() => {});

      // Renumera medições no Firebase: BM n+1 → BM n
      const totalOriginal = bms.length;
      for (let i = numExcluir + 1; i <= totalOriginal; i++) {
        const med = getMedicoes(obraId, i);
        salvarMedicoes(obraId, i - 1, med);
      }
      // Apaga última posição (agora vazia após renumeração)
      FirebaseService.setMedicoes(obraId, totalOriginal, {}).catch(() => {});

      // Renumera BMS
      const novosBms = bms
        .filter(b => b.num !== numExcluir)
        .map((b, i) => ({ ...b, num: i + 1, label: 'BM ' + String(i + 1).padStart(2, '0') }));

      state.set('bms', novosBms);
      invalidarCacheMedicoes(obraId);
      this._persistBMs(obraId, novosBms);
      this._atualizarSelects();

      EventBus.emit('boletim:excluido', { bmNum: numExcluir });
      EventBus.emit('boletim:atualizado', { bms: novosBms });
      EventBus.emit('ui:toast', { msg: `🗑️ ${bm.label} excluído e BMs renumerados.`, tipo: 'warn' });

    } catch (e) {
      console.error('[BoletimModule] excluirBM:', e);
    }
  }

  // ── Persistência ─────────────────────────────────────────────

  // _persistBMs — persiste metadados dos BMs (estrutura: lista, datas, labels).
  // Quando bmNum + medicoes são fornecidos, usa transação atômica (batch.commit)
  // para garantir que ambos persistam juntos — evita inconsistência em rede instável.
  //
  // Os 4 call sites atuais (adicionarBM, editarBM, excluirBM, salvarPagamento)
  // modificam APENAS a estrutura dos BMs — medições não mudam nessas operações,
  // portanto chamam sem bmNum/medicoes e usam setBMs() simples.
  //
  // Para usar a transação atômica (ex: bloquear BM ao salvar medição):
  //   this._persistBMs(obraId, novosBms, bmNum, getMedicoes(obraId, bmNum));
  _persistBMs(obraId, bms, bmNum, medicoes) {
    if (bmNum !== undefined && medicoes !== undefined) {
      FirebaseService.setBMsComMedicoes(obraId, bms, bmNum, medicoes).catch(e => {
        console.error('[BoletimModule] setBMsComMedicoes:', e);
        window.toast?.('⚠️ Erro ao salvar BM. Verifique a conexão e tente novamente.', 'error');
      });
    } else {
      FirebaseService.setBMs(obraId, bms).catch(e =>
        console.error('[BoletimModule] setBMs Firebase:', e)
      );
    }
  }

  // ── UI helpers ───────────────────────────────────────────────

  _atualizarSelects() {
    const bms = state.get('bms');
    ['sel-mem-bm', 'sel-bol-bm', 'sel-rel-bm'].forEach(id => {
      const el = document.getElementById(id);
      if (!el) return;
      const old = el.value;
      el.innerHTML = bms.map(bm =>
        `<option value="${bm.num}">${bm.label} — ${bm.mes}</option>`
      ).join('');
      if (old) el.value = old;
    });
  }

  // ── Roteador de renderização: padrão CAIXA ou padrão prefeitura ──
  _render() {
    const ctx = this._getContext();
    if (this._isCaixa()) {
      this._caixaBM.render(ctx);
    } else {
      this._ui.render(ctx);
    }
  }

  _getContext() {
    return {
      bms:          state.get('bms'),
      cfg:          state.get('cfg'),
      obraId:       state.get('obraAtivaId'),
      itens:        state.get('itensContrato'),
      getMedicoes:  (id, n) => getMedicoes(id, n),
      getAcumTotal: (n) => getValorAcumuladoTotal(
        state.get('obraAtivaId'), n,
        state.get('itensContrato'), state.get('cfg')
      ),
      getAcumAnt: (n) => getValorAcumuladoAnterior(
        state.get('obraAtivaId'), n,
        state.get('itensContrato'), state.get('cfg')
      ),
      getMedAtual: (n) => getValorMedicaoAtual(
        state.get('obraAtivaId'), n,
        state.get('itensContrato'), state.get('cfg')
      ),
    };
  }

  // ── Event Bus ────────────────────────────────────────────────

  _bindEvents() {
    this._subs.push(
      EventBus.on('obra:selecionada', async ({ obraId }) => {
        try {
          await this._carregarDados(obraId);
          if (router.current === 'boletim') this._render();
        } catch (e) { console.error('[BoletimModule] obra:selecionada:', e); }
      }, 'boletim'),

      EventBus.on('itens:atualizados', () => {
        if (router.current === 'boletim') this._render();
      }, 'boletim'),

      // Reprocessamento automático — quando outro módulo salva, atualiza acumulados.
      // NÃO invalida cache: salvarMedicoes() já atualizou o MemCache corretamente.
      // Invalidar aqui apagaria os dados recém-salvos e zeraria os valores no render.
      EventBus.on('medicao:salva', ({ bmNum, obraId, origem }) => {
        try {
          if (router.current === 'boletim') {
            this._render();
            // FIX-3: atualiza badge/botões de bloqueio para o BM ativo após re-render
            const oid  = obraId || state.get('obraAtivaId');
            const bNum = parseInt(document.getElementById('sel-bol-bm')?.value || 1);
            this._atualizarControleBloqueio(oid, bNum);
          }
        } catch (e) { console.error('[BoletimModule] medicao:salva re-render:', e); }
      }, 'boletim'),

      // Auto-save: persiste a medição atual do BM ativo no Firestore
      EventBus.on('autosave:trigger', ({ obraId: evObraId }) => {
        try {
          const obraId = evObraId || state.get('obraAtivaId');
          if (!obraId) return;
          const bmNum = parseInt(document.getElementById('sel-bol-bm')?.value || 1);
          const med   = getMedicoes(obraId, bmNum);
          if (med && Object.keys(med).length > 0) {
            salvarMedicoes(obraId, bmNum, med);
            notifyDirectSave(); // FIX: evita segundo autosave pelo mesmo evento
          }
        } catch (e) { console.error('[BoletimModule] autosave:trigger:', e); }
      }, 'boletim'),
    );

    // Expõe métodos globalmente para handlers inline do HTML
    window.adicionarBM       = () => this.adicionarBM();
    // Salva campos de pagamento (empenho, NF, data pagamento, pago) no BM
    window._bmSalvarPagamento = (bmNum) => {
      try {
        const g = id => document.getElementById(id);
        const bms = state.get('bms') || [];
        const obraId = state.get('obraAtivaId');
        const novosBms = bms.map(b => b.num === bmNum ? {
          ...b,
          empenho:       g('bm-pag-empenho')?.value?.trim() || b.empenho || '',
          notaFiscal:    g('bm-pag-nf')?.value?.trim()      || b.notaFiscal || '',
          dataPagamento: g('bm-pag-data')?.value            || b.dataPagamento || '',
          pago:          g('bm-pag-pago')?.checked          ?? b.pago ?? false,
        } : b);
        state.set('bms', novosBms);
        this._persistBMs(obraId, novosBms);
        window.auditRegistrar?.({ modulo: 'Boletim de Medição', tipo: 'pagamento', registro: `BM ${String(bmNum).padStart(2,'0')}`, detalhe: `Dados de pagamento atualizados` });
      } catch(e) { console.warn('[BM] salvarPagamento:', e); }
    };
    window.editarBM          = (n) => this.editarBM(n);
    window.excluirBM         = (n) => this.excluirBM(n);
    window.popularSelects    = () => this._atualizarSelects();
    window.renderBoletim     = async () => {
      const obraId = state.get('obraAtivaId');
      const sel    = document.getElementById('sel-bol-bm');
      // FIX-BM-TROCA: captura o bmNum ANTES do await para não perder o valor
      // escolhido pelo usuário caso _atualizarSelects() seja chamado durante
      // o carregamento assíncrono e reconstrua as options do select.
      const bmNum  = parseInt(sel?.value || 1);
      await this._carregarMedicoesBM(obraId, bmNum);
      // Garante que o select ainda aponta para o BM escolhido pelo usuário
      // (pode ter sido resetado por _atualizarSelects durante o await acima)
      if (sel && parseInt(sel.value) !== bmNum) sel.value = String(bmNum);
      this._render();
      this._atualizarControleBloqueio(obraId, bmNum);
    };
    window.imprimirBoletim   = () => this._imprimirBoletim();
    window.salvarMedicaoBol  = () => this._salvarMedicaoBol();
    window.marcarSalvoBol    = () => this._marcarSalvoBol();
    window.desmarcarSalvoBol = () => this._desmarcarSalvoBol();
    // Expõe funções de cálculo para uso pelo Dashboard
    window._bmCalc_getValorAcumuladoAnterior = getValorAcumuladoAnterior;
    window._bmCalc_getValorAcumuladoTotal    = getValorAcumuladoTotal;
    window.abrirCrudItemBM   = (modo, id) => this._abrirCrudItemBM(modo, id);
    window.abrirCrudMacroItem = () => this._abrirCrudMacroItem();
    // ALT1: edição de itens agregadores (G / SG) no boletim
    window.editarAgregadorBM  = (tipo, id) => this._editarAgregadorBM(tipo, id);
    window.excluirItemBM      = (id) => {
      if (!window.requirePerfil?.('fiscal','administrador','engenheiro')) return;
      if (!confirm(`Excluir item "${id}"? Esta ação não pode ser desfeita.`)) return;
      const itens = (state.get('itensContrato')||[]).filter(i=>i.id!==id);
      state.set('itensContrato', itens);
      const obraId = state.get('obraAtivaId');
      import('../../firebase/firebase-service.js').then(m=>m.default.setItens?.(obraId,itens)).catch(()=>{});
      EventBus.emit('itens:atualizados',{});
      window.toast?.(`🗑️ Item ${id} excluído.`,'ok');
    };

    window.excluirAgregadorBM = (id) => {
      const itens = state.get('itensContrato') || [];
      const prefix = id + '.';
      const filhos = itens.filter(i => i.id === id || i.id.startsWith(prefix));
      const nFilhos = filhos.length - 1; // sem contar o próprio agregador
      const msg = nFilhos > 0
        ? `Excluir "${id}" e seus ${nFilhos} subitem(ns)? Esta ação não pode ser desfeita.`
        : `Excluir agregador "${id}"? Esta ação não pode ser desfeita.`;
      if (!confirm(msg)) return;
      const novosItens = itens.filter(i => i.id !== id && !i.id.startsWith(prefix));
      state.set('itensContrato', novosItens);
      const obraId = state.get('obraAtivaId');
      import('../../firebase/firebase-service.js').then(m=>m.default.setItens?.(obraId, novosItens)).catch(()=>{});
      EventBus.emit('itens:atualizados', {});
      window.toast?.(`🗑️ Agregador "${id}" e ${nFilhos} subitem(ns) excluídos.`, 'ok');
    };
    window.adicionarItemBM = () => this._abrirCrudItemBM('novo', null);

    // ── Macro Item: Editar (modal) ───────────────────────────
    window.editarMacroItem = (macroId) => {
      const itens = state.get('itensContrato') || [];
      const item  = itens.find(i => i.id === macroId);
      if (!item) { window.toast?.('⚠️ Macro Item não encontrado.','warn'); return; }

      document.getElementById('bm-macro-modal-overlay')?.remove();
      document.getElementById('bm-macro-modal')?.remove();

      const overlay = document.createElement('div');
      overlay.id = 'bm-macro-modal-overlay';
      overlay.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,.55);z-index:1100';
      overlay.onclick = () => { overlay.remove(); modal.remove(); };

      const modal = document.createElement('div');
      modal.id = 'bm-macro-modal';
      modal.style.cssText = 'position:fixed;top:50%;left:50%;transform:translate(-50%,-50%);z-index:1101;background:var(--bg-card);border:1px solid var(--border);border-radius:14px;padding:24px;min-width:460px;max-width:580px;width:90vw;max-height:90vh;overflow-y:auto;box-shadow:0 20px 60px rgba(0,0,0,.4)';

      modal.innerHTML = `
        <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:18px">
          <div>
            <div style="font-size:10px;font-weight:700;color:var(--text-muted);text-transform:uppercase;letter-spacing:.5px">Editar Macro Item</div>
            <div style="font-size:15px;font-weight:800;color:var(--text-primary)">${item.id} — ${item.desc}</div>
          </div>
          <button data-action="_bmFecharMacroModal" style="background:none;border:none;font-size:22px;cursor:pointer;color:var(--text-muted)">×</button>
        </div>
        <div style="display:flex;flex-direction:column;gap:14px">
          <div><label style="font-size:11px;font-weight:700;color:var(--text-muted);display:block;margin-bottom:4px">Código (Item)</label>
          <input id="macro-edit-id" type="text" value="${item.id}" style="width:100%;padding:8px 12px;border:1px solid var(--border);border-radius:8px;font-size:13px;background:var(--bg-surface);color:var(--text-primary)"></div>
          <div><label style="font-size:11px;font-weight:700;color:var(--text-muted);display:block;margin-bottom:4px">Descrição</label>
          <input id="macro-edit-desc" type="text" value="${item.desc.replace(/"/g,'&quot;')}" style="width:100%;padding:8px 12px;border:1px solid var(--border);border-radius:8px;font-size:13px;background:var(--bg-surface);color:var(--text-primary)"></div>
        </div>
        <div style="background:var(--bg-surface);border:1px solid var(--border);border-radius:8px;padding:12px;margin-top:16px">
          <div style="font-size:10px;font-weight:700;color:var(--text-muted);text-transform:uppercase;letter-spacing:.5px;margin-bottom:8px">🔄 Converter Tipo</div>
          <p style="font-size:11px;color:var(--text-muted);margin-bottom:10px">Converter este Macro Item em um Item comum. Os sub-itens deixarão de ser agrupados.</p>
          <button data-action="reverterMacroItem" data-arg0="${macroId.replace(/'/g,"\\\\'")}" style="padding:8px 16px;background:#d97706;border:none;border-radius:8px;color:#fff;font-size:12px;font-weight:700;cursor:pointer">↩️ Converter em Item Comum</button>
        </div>
        <div style="display:flex;gap:10px;justify-content:flex-end;margin-top:18px">
          <button data-action="_bmFecharMacroModal" style="padding:9px 20px;background:var(--bg-surface);border:1px solid var(--border);border-radius:8px;font-size:12px;font-weight:700;cursor:pointer;color:var(--text-primary)">Cancelar</button>
          <button data-action="_macroSalvarEdicao" data-arg0="${macroId.replace(/'/g,"\\\\'")}" style="padding:9px 20px;background:var(--accent);border:none;border-radius:8px;color:#fff;font-size:12px;font-weight:700;cursor:pointer">💾 Salvar Alterações</button>
        </div>`;

      document.body.appendChild(overlay);
      document.body.appendChild(modal);
    };

    window._macroSalvarEdicao = (macroId) => {
      const novoId = (document.getElementById('macro-edit-id')?.value || '').trim();
      const novoDesc = (document.getElementById('macro-edit-desc')?.value || '').trim();
      if (!novoId || !novoDesc) { window.toast?.('⚠️ Preencha código e descrição.','warn'); return; }
      const itens = state.get('itensContrato') || [];
      const novosItens = itens.map(i => i.id === macroId ? { ...i, id: novoId, desc: novoDesc } : i);
      state.set('itensContrato', novosItens);
      const obraId = state.get('obraAtivaId');
      import('../../firebase/firebase-service.js').then(m => m.default.setItens?.(obraId, novosItens)).catch(() => {});
      document.getElementById('bm-macro-modal-overlay')?.remove();
      document.getElementById('bm-macro-modal')?.remove();
      EventBus.emit('itens:atualizados', {});
      window.toast?.(`✅ Macro Item ${novoId} atualizado.`, 'ok');
    };

    // ── Macro Item: Converter em item comum ──────────────────
    window.reverterMacroItem = (macroId) => {
      if (!confirm(`Converter "${macroId}" de Macro Item para Item comum?`)) return;
      const itens = state.get('itensContrato') || [];
      const novosItens = itens.map(i => {
        if (i.id !== macroId) return i;
        const c = { ...i }; delete c.t;
        if (!c.und) c.und = 'vb'; if (!c.qtd) c.qtd = 1; if (!c.up) c.up = 0;
        return c;
      });
      state.set('itensContrato', novosItens);
      const obraId = state.get('obraAtivaId');
      import('../../firebase/firebase-service.js').then(m => m.default.setItens?.(obraId, novosItens)).catch(() => {});
      document.getElementById('bm-macro-modal-overlay')?.remove();
      document.getElementById('bm-macro-modal')?.remove();
      EventBus.emit('itens:atualizados', {});
      window.toast?.(`✅ "${macroId}" convertido para Item comum.`, 'ok');
    };

    // ── Macro Item: Excluir ──────────────────────────────────
    window.excluirMacroItem = (macroId) => {
      if (!confirm(`Excluir Macro Item "${macroId}"? Os sub-itens permanecerão.`)) return;
      const itens = (state.get('itensContrato') || []).filter(i => i.id !== macroId);
      state.set('itensContrato', itens);
      const obraId = state.get('obraAtivaId');
      import('../../firebase/firebase-service.js').then(m => m.default.setItens?.(obraId, itens)).catch(() => {});
      EventBus.emit('itens:atualizados', {});
      window.toast?.(`🗑️ Macro Item "${macroId}" excluído.`, 'ok');
    };
    window.abrirDetalheBM    = (num) => { try { this._abrirDetalheBM?.(num); } catch(e){} };
    window.imprimirRegistroBMs = () => { try { this._imprimirRegistroBMs?.(); } catch(e){ window.imprimirBoletim?.(); } };
    window.renderRegistroBMs   = () => { try { this._render(); } catch(e){} };
    window.exportarCSVBoletim     = () => { try { this._exportarCSVBoletim(); } catch(e){ console.error('[BM] exportarCSVBoletim:', e); } };
    window.exportarCSVRegistroBMs = () => { try { this._exportarCSVRegistroBMs(); } catch(e){ console.error('[BM] exportarCSVRegistroBMs:', e); } };

    // ── Padrão CAIXA — globals exclusivos (sem efeito em outros padrões) ──
    window._bmCaixaIsCaixa      = ()            => this._isCaixa();
    window._bmCaixaAbrirMemoria = (itemId)      => { try { this._caixaBM.abrirMemoria(itemId);  } catch(e){ console.error('[BM/CAIXA] abrirMemoria:', e); } };
    window._bmCaixaAplicarPct   = (itemId, pct) => { try { this._caixaBM.aplicarPct(itemId, pct); } catch(e){ console.error('[BM/CAIXA] aplicarPct:', e);   } };
  }

  // ── Exportar CSV do Boletim de Medição ───────────────────────
  _exportarCSVBoletim() {
    const obraId = state.get('obraAtivaId');
    const cfg    = state.get('cfg') || {};
    const bms    = state.get('bms') || [];
    const itens  = state.get('itensContrato') || [];
    const bmNum  = parseInt(document.getElementById('sel-bol-bm')?.value || 1);
    const bm     = bms.find(b => b.num === bmNum) || bms[0];
    if (!bm) { window.toast?.('⚠️ Nenhum BM selecionado.', 'warn'); return; }

    // ── Mesma lógica de arredondamento do bm-ui.js (_fmt → fmtNum) ──
    const modoCalc = cfg.modoCalculo || 'truncar';
    const fmtNum = v => modoCalc === 'truncar'
      ? Math.trunc(Math.round(parseFloat(v || 0) * 100 * 100) / 100) / 100
      : Math.round(parseFloat(v || 0) * 100) / 100;

    const vContr    = parseFloat(cfg.valor) || 0;
    const vAcumAnt  = getValorAcumuladoAnterior(obraId, bmNum, itens, cfg);
    const vAcumTot  = getValorAcumuladoTotal(obraId, bmNum, itens, cfg);
    const vMedAtual = vAcumTot - vAcumAnt;
    const saldo     = vContr - vAcumTot;

    // ── Cabeçalho espelha as 19 colunas da tabela do sistema (sem coluna Ações) ──
    const cabec = [
      'ID Item', 'Código', 'Descrição', 'Unidade',
      // Contratual
      'Qtd Contratada', 'V.Unit. (R$)', 'V.Unit+BDI (R$)', 'Tot.Contratado (R$)',
      // Acumulado Anterior
      '% Acum.Ant.', 'Qtd Acum.Ant.', 'V.Acum.Ant. (R$)',
      // Medição Atual
      'Qtd Med.Atual', '% Med.Atual', 'V.Med.Atual (R$)',
      // Acumulado Total
      'Qtd Acumulado', 'V.Acumulado (R$)', '% Acumulado',
      // Saldo
      'Qtd Saldo', 'V.Saldo (R$)',
    ];

    // ── Totalizadores gerais (espelham gCont, gAnt, gAtual, gAcum, gSaldo do bm-ui) ──
    let gCont = 0, gAnt = 0, gAtual = 0, gAcum = 0, gSaldo = 0;

    // Auxiliar: verifica se item tem pai (para não duplo-contar em grupos)
    const _temQualquerPai = (id) => itens.some(x => x.t && id.startsWith(x.id + '.'));

    const linhas = [];

    itens.forEach(it => {
      if (it.t) {
        // ── Linha de GRUPO / SUBGRUPO / MACRO ──────────────────────
        const tipo = it.t === 'G' ? 'GRUPO' : it.t === 'SG' ? 'SUBGRUPO' : 'MACRO';
        linhas.push([
          it.id, '', it.desc || '', tipo,
          '', '', '', '',
          '', '', '',
          '', '', '',
          '', '', '',
          '', '',
        ]);
        return;
      }

      // ── ITEM NORMAL — cálculos idênticos ao bm-ui._renderBoletim ──
      const upBdi    = fmtNum((it.up || 0) * (1 + (cfg.bdi || 0)));
      const totCont  = fmtNum((it.qtd || 0) * upBdi);

      const qtdAnt   = getQtdAcumuladoAnteriorItem(obraId, bmNum, it.id, itens);
      const totAnt   = fmtNum(qtdAnt * upBdi);
      const pctAnt   = it.qtd > 0 ? (qtdAnt / it.qtd * 100) : 0;

      const qtdAcum  = getQtdAcumuladoTotalItem(obraId, bmNum, it.id, itens);
      const totAcum  = fmtNum(qtdAcum * upBdi);
      const pctAcum  = it.qtd > 0 ? (qtdAcum / it.qtd * 100) : 0;

      const qtdAtual = qtdAcum - qtdAnt;
      const totAtual = fmtNum(totAcum - totAnt);
      const pctAtual = it.qtd > 0 ? (qtdAtual / it.qtd * 100) : 0;

      const qtdSaldo = (it.qtd || 0) - qtdAcum;
      const totSaldo = fmtNum(totCont - totAcum);

      // Acumula totalizadores gerais (apenas itens sem pai, como bm-ui)
      if (!_temQualquerPai(it.id)) {
        gCont  += totCont;
        gAnt   += totAnt;
        gAtual += totAtual;
        gAcum  += totAcum;
        gSaldo += totSaldo;
      }

      linhas.push([
        it.id,
        it.cod  || '',
        it.desc || '',
        it.und  || '',
        // Contratual
        numCSV(it.qtd || 0),
        numCSV(it.up  || 0),
        numCSV(upBdi),
        numCSV(totCont),
        // Acumulado Anterior
        numCSV(pctAnt)  + '%',
        numCSV(qtdAnt),
        numCSV(totAnt),
        // Medição Atual
        numCSV(qtdAtual),
        numCSV(pctAtual) + '%',
        numCSV(totAtual),
        // Acumulado Total
        numCSV(qtdAcum),
        numCSV(totAcum),
        numCSV(pctAcum)  + '%',
        // Saldo
        numCSV(qtdSaldo),
        numCSV(totSaldo),
      ]);
    });

    // ── Linha de TOTAL GERAL (espelha tfoot do bm-ui) ──────────────
    const pctExecTotal = vContr > 0 ? (gAcum / vContr * 100) : 0;
    const pctMedTotal  = vContr > 0 ? (gAtual / vContr * 100) : 0;
    linhas.push([]);
    linhas.push([
      'TOTAL GERAL', '', '', '',
      '—', '—', '—',
      numCSV(gCont),
      numCSV(gAnt > 0 && gCont > 0 ? (gAnt / gCont * 100) : 0) + '%',
      '—',
      numCSV(gAnt),
      '—',
      numCSV(pctMedTotal) + '%',
      numCSV(gAtual),
      numCSV(gAcum),
      numCSV(gAcum),
      numCSV(pctExecTotal) + '%',
      '—',
      numCSV(gSaldo),
    ]);
    linhas.push([
      'SALDO A EXECUTAR', '', '', '',
      '', '', '', numCSV(saldo),
      '', '', '',
      '', '', '',
      '', '', '',
      '', '',
    ]);
    // ── Info do BM no rodapé ────────────────────────────────────────
    linhas.push([]);
    linhas.push([`BM: ${bm.label || bmNum}`, `Período: ${bm.mes || '—'}`, `Data: ${bm.data || '—'}`, `BDI: ${((cfg.bdi || 0) * 100).toFixed(2)}%`, `Valor Contrato: ${numCSV(vContr)}`]);

    const nomeArq = `boletim_medicao_BM${String(bmNum).padStart(2,'0')}_${new Date().toISOString().slice(0,10)}`;
    baixarCSV([cabec, ...linhas], nomeArq);

    window.auditRegistrar?.({
      modulo: 'Boletim de Medição',
      tipo: 'exportação',
      registro: bm.label || `BM ${bmNum}`,
      detalhe: 'Exportação CSV do Boletim de Medição',
    });

    window.toast?.('✅ CSV do Boletim exportado!', 'ok');
  }

  // ── Exportar CSV do Registro de BMs ──────────────────────────
  _exportarCSVRegistroBMs() {
    const obraId = state.get('obraAtivaId');
    const cfg    = state.get('cfg') || {};
    const bms    = state.get('bms') || [];
    const itens  = state.get('itensContrato') || [];
    const vContr = parseFloat(cfg.valor) || 0;

    const cabec = ['Nº BM', 'Período', 'Data Medição', 'Valor BM (R$)', '% BM', 'Acumulado (R$)', '% Acumulado', 'Saldo (R$)'];
    const linhas = bms.map(bm => {
      const vAcumAnt  = getValorAcumuladoAnterior(obraId, bm.num, itens, cfg);
      const vAcumTot  = getValorAcumuladoTotal(obraId, bm.num, itens, cfg);
      const vMed      = vAcumTot - vAcumAnt;
      const pctBM     = vContr > 0 ? (vMed / vContr * 100) : 0;
      const pctAcum   = vContr > 0 ? (vAcumTot / vContr * 100) : 0;
      const saldo     = vContr - vAcumTot;
      return [
        bm.label || `BM ${bm.num}`,
        bm.mes   || '',
        bm.data  || '',
        numCSV(vMed),
        numCSV(pctBM) + '%',
        numCSV(vAcumTot),
        numCSV(pctAcum) + '%',
        numCSV(saldo),
      ];
    });

    baixarCSV([cabec, ...linhas], `registro_bms_${new Date().toISOString().slice(0,10)}`);
    window.auditRegistrar?.({ modulo: 'Boletim de Medição', tipo: 'exportação', registro: 'Registro de BMs', detalhe: 'Exportação CSV do Registro de BMs' });
    window.toast?.('✅ CSV do Registro de BMs exportado!', 'ok');
  }

  async _carregarDados(obraId) {
    try {
      // FIX-CHARTS: invalida o cache ANTES do fetch paralelo.
      // Invalidar depois (versão anterior) criava uma janela onde o dashboard
      // podia ler o cache ainda populado da obra anterior e gerar gráficos errados.
      // Invalidar antes garante que qualquer leitura durante o fetch retorna {} (vazio),
      // que é o comportamento correto: "ainda carregando".
      invalidarCacheMedicoes(obraId);

      const [cfg, bms, itens] = await Promise.all([
        FirebaseService.getObraCfg(obraId),
        FirebaseService.getBMs(obraId),
        FirebaseService.getItens(obraId),
      ]);
      // Garante que cfg (incluindo tipoObra) está sempre atualizado antes de renderizar o BM
      if (cfg)                   state.set('cfg',           cfg);
      if (bms && bms.length)     state.set('bms',           bms);
      if (itens && itens.length) state.set('itensContrato', itens);

      // Carrega medições de TODOS os BMs — necessário para cálculo correto do Acumulado Total.
      const bmNum = parseInt(document.getElementById('sel-bol-bm')?.value || 1);
      await this._carregarMedicoesBM(obraId, bmNum);
    } catch (e) {
      console.error('[BoletimModule] _carregarDados:', e);
    }
  }


  /** Retorna true se a obra ativa for padrão CAIXA. */
  _isCaixa() {
    const cfg    = state.get('cfg') || {};
    const padrao = (
      cfg.tipoObra   ||
      cfg.padrao     ||
      cfg.tipoPadrao ||
      cfg.padraoObra ||
      ''
    ).toLowerCase();
    return padrao === 'caixa';
  }

  destroy() {
    this._subs.forEach(unsub => unsub());
    this._subs = [];
    EventBus.offByContext('boletim');
  }
}
