/**
 * ╔══════════════════════════════════════════════════════════════╗
 * ║  FISCAL NA OBRA v15 — obras-concluidas-controller.js        ║
 * ║  Módulo: ObrasConcluiModule — Obras Concluídas              ║
 * ╚══════════════════════════════════════════════════════════════╝
 */

import EventBus        from '../../core/EventBus.js';
import state           from '../../core/state.js';
import router          from '../../core/router.js';
import { formatters }  from '../../utils/formatters.js';
import FirebaseService from '../../firebase/firebase-service.js';

const R$   = v => formatters.currency ? formatters.currency(v) : (v||0).toLocaleString('pt-BR',{style:'currency',currency:'BRL'});
const dataBR = iso => iso ? new Date(iso+'T12:00:00').toLocaleDateString('pt-BR') : '—';

export class ObrasConcluiModule {
  constructor() {
    this._subs        = [];
    this._obras       = [];
    this._busca       = '';
    this._obraAberta  = null;
  }

  async init() {
    try { this._bindEvents(); this._exposeGlobals(); }
    catch(e) { console.error('[ObrasConcluiModule] init:', e); }
  }

  async onEnter() {
    try { await this._carregar(); this._render(); }
    catch(e) { console.error('[ObrasConcluiModule] onEnter:', e); }
  }

  async _carregar() {
    try {
      const lista = await FirebaseService.getObrasLista().catch(()=>[]);
      // Filtra só obras concluídas
      const concluidas = (lista||[]).filter(o=>
        (o.statusObra||'').toLowerCase().includes('conclu') ||
        (o.status||'').toLowerCase().includes('conclu')
      );
      // Carregar cfg de cada uma
      this._obras = await Promise.all(concluidas.map(async obra => {
        try {
          const cfg = await FirebaseService.getObraCfg(obra.id).catch(()=>null);
          const bms = await FirebaseService.getBMs(obra.id).catch(()=>[]);
          return { ...obra, cfg: cfg||{}, bms: bms||[] };
        } catch { return { ...obra, cfg:{}, bms:[] }; }
      }));
    } catch(e) { console.error('[ObrasConcluiModule] _carregar:', e); this._obras=[]; }
  }

  _render() {
    const el = document.getElementById('obras-conc-lista');
    if (!el) return;

    const lista = this._filtrar();

    // KPIs acima da lista (injetar no card parent)
    const card = el.closest('.card');
    let kpiEl = card?.querySelector('#oc-kpis');
    if (card && !kpiEl) {
      kpiEl = document.createElement('div');
      kpiEl.id = 'oc-kpis';
      card.insertBefore(kpiEl, el);
    }

    const total    = this._obras.length;
    const vTotal   = this._obras.reduce((s,o)=>{const v=o.cfg?.valor||0; return s+parseFloat(v);},0);
    const vExec    = this._obras.reduce((s,o)=>{
      const lastBm = (o.bms||[]).slice(-1)[0];
      return s + parseFloat(lastBm?.valorAcumulado || lastBm?.valorMedicao || 0);
    },0);

    if (kpiEl) kpiEl.innerHTML = `
      <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(140px,1fr));gap:10px;margin-bottom:18px">
        ${this._kpi('Obras Concluídas', total, 'var(--accent)')}
        ${this._kpi('Valor Total', R$(vTotal), '#2563eb')}
        ${this._kpi('Valor Executado', R$(vExec), '#22c55e')}
      </div>
      <div style="display:flex;gap:8px;align-items:center;margin-bottom:14px;flex-wrap:wrap">
        <input type="text" placeholder="🔍 Buscar obra..." value="${this._busca}"
          oninput="window._obrc_busca(this.value)"
          style="flex:1;min-width:140px;padding:7px 10px;font-size:12px;border-radius:7px;border:1px solid var(--border);background:var(--bg-surface);color:var(--text-primary)">
        <span style="font-size:11px;color:var(--text-muted)">${lista.length} obra(s)</span>
      </div>
    `;

    if (lista.length === 0) {
      el.innerHTML = '<div style="text-align:center;padding:40px;color:var(--text-muted);font-size:12px;grid-column:1/-1">'+
        (total===0 ? 'Nenhuma obra concluída ainda.<br><span style="font-size:11px">Ao concluir uma obra no Gerenciador, ela aparecerá aqui.</span>'
                   : 'Nenhuma obra encontrada com os filtros aplicados.')+'</div>';
      return;
    }

    el.innerHTML = lista.map(o => this._card(o)).join('');
  }

  _filtrar() {
    let lista = [...this._obras];
    if (this._busca) {
      const q = this._busca.toLowerCase();
      lista = lista.filter(o =>
        (o.nome||o.cfg?.objeto||'').toLowerCase().includes(q) ||
        (o.cfg?.contrato||'').toLowerCase().includes(q) ||
        (o.cfg?.contratada||'').toLowerCase().includes(q)
      );
    }
    return lista;
  }

  _card(o) {
    const cfg     = o.cfg||{};
    const bms     = o.bms||[];
    const lastBm  = bms.slice(-1)[0];
    const vTotal  = parseFloat(cfg.valor||0);
    const vExec   = parseFloat(lastBm?.valorAcumulado||0);
    const pctFin  = vTotal>0?(vExec/vTotal*100):0;

    return '<div style="background:var(--bg-surface);border:1px solid var(--border);border-radius:12px;padding:18px;cursor:pointer;transition:border-color .2s" data-action="_consultarObraConcluida" data-arg0="+o.id+" onmouseenter="this.style.borderColor=\'var(--accent)\'" onmouseleave="this.style.borderColor=\'var(--border)\'">'+
      '<div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:10px;flex-wrap:wrap;gap:6px">'+
      '<span style="font-size:11px;font-weight:700;color:var(--text-primary)">'+(o.nome||cfg.objeto||'Obra sem nome')+'</span>'+
      '<span style="font-size:10px;background:#22c55e22;color:#16a34a;padding:3px 9px;border-radius:10px;font-weight:700">✅ Concluída</span>'+
      '</div>'+
      '<div style="font-size:11px;color:var(--text-muted);margin-bottom:10px">'+
      (cfg.contrato?'📋 '+cfg.contrato+'<br>':'')+
      (cfg.contratada?'🏢 '+cfg.contratada+'<br>':'')+
      (cfg.termino?'📅 Término: '+dataBR(cfg.termino):'')+
      '</div>'+
      '<div style="margin-bottom:6px">'+
      '<div style="display:flex;justify-content:space-between;font-size:10px;color:var(--text-muted);margin-bottom:3px"><span>Execução Financeira</span><span>'+pctFin.toFixed(1).replace('.',',')+' %</span></div>'+
      '<div style="height:5px;border-radius:3px;background:var(--border);overflow:hidden"><div style="height:5px;border-radius:3px;background:#22c55e;width:'+Math.min(100,pctFin)+'%"></div></div>'+
      '</div>'+
      '<div style="display:flex;justify-content:space-between;font-size:11px;font-weight:700">'+
      '<span style="color:var(--text-muted)">'+R$(vTotal)+'</span>'+
      '<span style="color:#22c55e">'+R$(vExec)+' exec.</span>'+
      '</div></div>';
  }

  _kpi(label,valor,cor) {
    return '<div style="background:var(--bg-surface);border:1px solid var(--border);border-radius:8px;padding:12px;text-align:center"><div style="font-size:9px;font-weight:700;color:var(--text-muted);text-transform:uppercase;letter-spacing:.5px;margin-bottom:5px">'+label+'</div><div style="font-size:15px;font-weight:800;color:'+cor+';font-family:var(--font-mono,monospace)">'+valor+'</div></div>';
  }

  async _consultarObra(id) {
    const obra = this._obras.find(o=>o.id===id);
    window.toast?.('🔍 Consultando: '+(obra?.nome||obra?.cfg?.objeto||'obra'),'info');
    // Carrega cfg, bms e itens antes de emitir obra:selecionada (mesmo padrão de _selecionarObra)
    state.set('obraAtivaId', id);
    state.persist?.(['obraAtivaId']);
    try {
      const [cfg, bms, itens] = await Promise.all([
        FirebaseService.getObraCfg(id).catch(() => null),
        FirebaseService.getBMs(id).catch(() => null),
        FirebaseService.getItens(id).catch(() => null),
      ]);
      if (cfg)                   state.set('cfg',           cfg);
      if (bms   && bms.length)   state.set('bms',           bms);
      if (itens && itens.length) state.set('itensContrato', itens);
    } catch(eLoad) {
      console.warn('[ObrasConcluidas] _consultarObra — erro ao carregar dados:', eLoad);
    }
    EventBus.emit('obra:selecionada', {obraId:id});
    window.verPagina?.('dashboard');
  }

  _bindEvents() {
    this._subs.push(EventBus.on('obra:concluida', async () => {
      try { await this._carregar(); if (router.current==='obras-concluidas') this._render(); }
      catch(e) { console.error('[ObrasConcluiModule]', e); }
    }, 'obras-concluidas'));
    this._subs.push(EventBus.on('obra:reativada', async () => {
      try { await this._carregar(); if (router.current==='obras-concluidas') this._render(); }
      catch(e) { console.error('[ObrasConcluiModule]', e); }
    }, 'obras-concluidas:reativada'));
  }

  _exposeGlobals() {
    window.renderObrasConcluidas    = () => { try { this._render(); } catch(e){} };
    window._consultarObraConcluida  = (id)=>{ try { this._consultarObra(id); } catch(e){} };
    window._obrc_busca              = (v) =>{ try { this._busca=v; this._render(); } catch(e){} };
  }

  destroy() { this._subs.forEach(u=>u()); this._subs=[]; }
}
