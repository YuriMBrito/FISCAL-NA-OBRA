/**
 * ╔══════════════════════════════════════════════════════════════╗
 * ║  FISCAL NA OBRA v15 — historico-controller.js               ║
 * ║  Módulo: HistoricoModule — Histórico de Ações               ║
 * ╚══════════════════════════════════════════════════════════════╝
 */

import EventBus        from '../../core/EventBus.js';
import state           from '../../core/state.js';
import router          from '../../core/router.js';
import { formatters }  from '../../utils/formatters.js';
import FirebaseService from '../../firebase/firebase-service.js';

const dataBRHora = iso => {
  if (!iso) return '—';
  const d = new Date(iso);
  return d.toLocaleDateString('pt-BR') + ' ' + d.toLocaleTimeString('pt-BR',{hour:'2-digit',minute:'2-digit'});
};

const ICONES = {
  bm_criado:'📋', bm_editado:'✏️', bm_excluido:'🗑️',
  cfg_salva:'⚙️', aditivo_criado:'📝', aditivo_excluido:'🗑️',
  obra_criada:'🏗️', obra_selecionada:'🏗️',
  item_alterado:'🔧', importacao:'📥', documento:'📂',
  ocorrencia:'⚠️', notificacao:'🔔', diario:'📓',
  geral:'📌',
};

export class HistoricoModule {
  constructor() {
    this._subs   = [];
    this._hist   = [];
    this._filtro = '';
    this._max    = 100;
  }

  async init() {
    try { this._bindEvents(); this._exposeGlobals(); }
    catch (e) { console.error('[HistoricoModule] init:', e); }
  }

  async onEnter() {
    try { await this._carregar(); this._render(); }
    catch (e) { console.error('[HistoricoModule] onEnter:', e); }
  }

  async _carregar() {
    const obraId = state.get('obraAtivaId');
    if (!obraId) { this._hist = []; return; }
    try {
      const dados = await FirebaseService.getHistorico(obraId).catch(() => null);
      this._hist = (dados?.registros || []).slice().reverse();
    } catch(e) { console.error('[HistoricoModule] _carregar:', e); this._hist=[]; }
  }

  async _registrar(acao, detalhe, tipo='geral') {
    const obraId = state.get('obraAtivaId');
    if (!obraId) return;
    try {
      const dados = await FirebaseService.getHistorico(obraId).catch(() => null);
      const registros = dados?.registros || [];
      const usuario = state.get('usuarioLogado')?.email || 'Sistema';
      registros.push({ id:'h_'+Date.now(), tipo, acao, detalhe, usuario, timestamp: new Date().toISOString() });
      // Manter só os últimos 500 registros
      if (registros.length > 500) registros.splice(0, registros.length - 500);
      await FirebaseService.salvarHistorico?.(obraId, { registros }) || (() => {})();
    } catch(e) { /* silencioso */ }
  }

  _render() {
    const el = document.getElementById('historico-conteudo');
    if (!el) return;
    const obraId = state.get('obraAtivaId');

    if (!obraId) {
      el.innerHTML = '<div style="text-align:center;padding:40px;color:var(--text-muted);font-size:13px">Selecione uma obra para ver o histórico.</div>';
      return;
    }

    const lista = this._filtrar();

    el.innerHTML = `
      <div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap;margin-bottom:14px">
        <input type="text" placeholder="🔍 Filtrar histórico..." value="${this._filtro}"
          oninput="window._hist_filtro(this.value)"
          style="flex:1;min-width:140px;padding:7px 10px;font-size:12px;border-radius:7px;border:1px solid var(--border);background:var(--bg-surface);color:var(--text-primary)">
        <span style="font-size:11px;color:var(--text-muted)">${lista.length} registro(s)</span>
      </div>
      ${lista.length === 0
        ? '<div style="text-align:center;padding:40px;color:var(--text-muted);font-size:12px">Nenhum registro no histórico.'+(this._filtro?' Tente outro filtro.':'')+'</div>'
        : '<div style="font-size:11px;font-family:var(--font-mono,monospace)">'+lista.slice(0,this._max).map(h=>this._linha(h)).join('')+'</div>'+
          (lista.length>this._max?'<div style="text-align:center;margin-top:10px"><button data-action="_hist_mais" style="padding:7px 18px;background:var(--bg-surface);border:1px solid var(--border);border-radius:7px;font-size:12px;cursor:pointer;color:var(--text-primary)">Ver mais (+'+(lista.length-this._max)+')</button></div>':'')}
    `;
  }

  _filtrar() {
    let lista = this._hist;
    if (this._filtro) {
      const q = this._filtro.toLowerCase();
      lista = lista.filter(h=>(h.acao||'').toLowerCase().includes(q)||(h.detalhe||'').toLowerCase().includes(q)||(h.usuario||'').toLowerCase().includes(q));
    }
    return lista;
  }

  _linha(h) {
    const icon = ICONES[h.tipo]||'📌';
    return '<div style="display:flex;align-items:baseline;gap:10px;padding:6px 0;border-bottom:1px solid var(--border)">'+
      '<span style="flex-shrink:0;font-size:11px;color:var(--text-muted);white-space:nowrap">'+dataBRHora(h.timestamp)+'</span>'+
      '<span style="flex-shrink:0">'+icon+'</span>'+
      '<span style="font-size:11px;color:var(--text-primary);flex:1;min-width:0">'+
      '<strong>'+sanitize(h.acao||'')+'</strong>'+(h.detalhe?' — <span style="color:var(--text-muted)">'+sanitize(h.detalhe)+'</span>':'')+
      '</span>'+
      '<span style="flex-shrink:0;font-size:10px;color:var(--text-muted)">'+sanitize(h.usuario||'')+'</span>'+
      '</div>';
  }

  _bindEvents() {
    this._subs.push(EventBus.on('obra:selecionada', async () => {
      try { await this._carregar(); if (router.current==='historico') this._render(); }
      catch(e) { console.error('[HistoricoModule]', e); }
    }, 'historico'));

    // Escuta eventos globais para auto-registrar
    const esc = (tipo, acao, fn) => this._subs.push(EventBus.on(tipo, d=>{ try { fn(d); } catch(e){} }, 'historico:'+tipo));
    esc('bm:criado',     e=>this._registrar('Boletim de Medição criado', 'BM '+e?.num, 'bm_criado'));
    esc('bm:excluido',   e=>this._registrar('Boletim de Medição excluído', 'BM '+e?.num, 'bm_excluido'));
    esc('cfg:salva',     ()=>this._registrar('Configurações salvas', '', 'cfg_salva'));
    esc('aditivo:salvo', e=>this._registrar('Aditivo registrado', e?.numero||'', 'aditivo_criado'));
  }

  _exposeGlobals() {
    window.renderHistorico = () => { try { this._render(); } catch(e){} };
    window.histRegistrar   = (acao,det,tipo) => { try { this._registrar(acao,det,tipo); } catch(e){} };
    window._hist_filtro    = (v) => { try { this._filtro=v; this._render(); } catch(e){} };
    window._hist_mais      = () => { try { this._max+=100; this._render(); } catch(e){} };
  }

  destroy() { this._subs.forEach(u=>u()); this._subs=[]; }
}

function sanitize(s) {
  return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
}
