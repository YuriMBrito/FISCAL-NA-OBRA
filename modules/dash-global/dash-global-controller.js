/**
 * ╔══════════════════════════════════════════════════════════════╗
 * ║  FISCAL NA OBRA v16 — dash-global-controller.js             ║
 * ║  Dashboard Global — Design Dark Premium                     ║
 * ╚══════════════════════════════════════════════════════════════╝
 */

import EventBus        from '../../core/EventBus.js';
import state           from '../../core/state.js';
import router          from '../../core/router.js';
import { formatters }  from '../../utils/formatters.js';
import FirebaseService from '../../firebase/firebase-service.js';
import { exposeGlobal } from '../../utils/global-guard.js';
import { _injetarCacheMedicoes, getValorAcumuladoTotal } from '../boletim-medicao/bm-calculos.js';

if (typeof CanvasRenderingContext2D !== 'undefined' && !CanvasRenderingContext2D.prototype.roundRect) {
  CanvasRenderingContext2D.prototype.roundRect = function(x,y,w,h,r=0){
    const R=typeof r==='number'?[r,r,r,r]:r;
    this.moveTo(x+R[0],y);this.lineTo(x+w-R[1],y);this.quadraticCurveTo(x+w,y,x+w,y+R[1]);
    this.lineTo(x+w,y+h-R[2]);this.quadraticCurveTo(x+w,y+h,x+w-R[2],y+h);
    this.lineTo(x+R[3],y+h);this.quadraticCurveTo(x,y+h,x,y+h-R[3]);
    this.closePath();return this;
  };
}

/* ── Helpers ── */
const R$  = v => (v||0).toLocaleString('pt-BR',{style:'currency',currency:'BRL'});
const pct = v => `${(parseFloat(v)||0).toFixed(1)}%`;
const esc = s => String(s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
const diffDias = iso => iso ? Math.ceil((new Date(iso+'T23:59:59')-new Date())/86400000) : null;

/* ── Paleta dark premium ── */
const D = {
  bg:       '#0c0f1a',
  card:     '#111827',
  card2:    '#151d2e',
  border:   'rgba(255,255,255,0.07)',
  borderHi: 'rgba(255,255,255,0.14)',
  amber:    '#f59e0b',
  amberGlow:'rgba(245,158,11,0.25)',
  cyan:     '#06b6d4',
  cyanGlow: 'rgba(6,182,212,0.2)',
  purple:   '#8b5cf6',
  purpleGlow:'rgba(139,92,246,0.2)',
  green:    '#10b981',
  greenGlow:'rgba(16,185,129,0.2)',
  red:      '#ef4444',
  redGlow:  'rgba(239,68,68,0.2)',
  blue:     '#3b82f6',
  blueGlow: 'rgba(59,130,246,0.2)',
  slate:    '#475569',
  textPri:  '#f1f5f9',
  textSec:  '#94a3b8',
  textMut:  '#475569',
};

const ALERTA = {
  diasAtrasoLimite: 30, pctBaixoExecucao: 30,
  maxAditivos: 3, diasSemAtualizacao: 60, diasVencimentoProximo: 45,
};

/* ── CSS dark theme injetado uma vez ── */
const CSS = `
<style id="dg-dark-css">
#dash-global-conteudo { background:${D.bg}; min-height:100vh; font-family:'Inter',system-ui,sans-serif; }
.dg2-card { background:${D.card}; border:1px solid ${D.border}; border-radius:14px; padding:18px; }
.dg2-card:hover { border-color:${D.borderHi}; }
.dg2-glass { background:rgba(17,24,39,0.7); backdrop-filter:blur(12px); border:1px solid ${D.border}; border-radius:14px; padding:18px; }
.dg2-tab { padding:9px 18px; border:none; background:none; cursor:pointer; font-size:12px; font-weight:700; color:${D.textMut}; border-bottom:2px solid transparent; margin-bottom:-2px; transition:all .2s; white-space:nowrap; letter-spacing:.3px; }
.dg2-tab.active { color:${D.amber}; border-bottom-color:${D.amber}; }
.dg2-tab:hover:not(.active) { color:${D.textSec}; }
.dg2-kpi { background:${D.card}; border:1px solid ${D.border}; border-radius:12px; padding:16px; transition:all .2s; cursor:default; }
.dg2-kpi:hover { transform:translateY(-2px); box-shadow:0 8px 32px rgba(0,0,0,.4); }
.dg2-badge { display:inline-flex;align-items:center;gap:4px;padding:2px 8px;border-radius:5px;font-size:10px;font-weight:700;white-space:nowrap; }
.dg2-btn { padding:5px 14px; border-radius:7px; border:none; font-size:11px; font-weight:700; cursor:pointer; transition:all .15s; }
.dg2-btn:hover { opacity:.85; transform:translateY(-1px); }
.dg2-input { background:rgba(255,255,255,.05); border:1px solid ${D.border}; border-radius:8px; color:${D.textPri}; font-size:12px; padding:8px 12px; outline:none; }
.dg2-input:focus { border-color:${D.amber}; }
.dg2-select { background:${D.card2}; border:1px solid ${D.border}; border-radius:8px; color:${D.textPri}; font-size:11px; padding:8px 10px; outline:none; }
.dg2-tbl { width:100%; border-collapse:collapse; font-size:12px; }
.dg2-tbl thead th { padding:10px 12px; text-align:left; font-size:10px; font-weight:700; color:${D.textMut}; text-transform:uppercase; letter-spacing:.5px; border-bottom:1px solid ${D.border}; background:${D.card2}; white-space:nowrap; }
.dg2-tbl tbody tr { border-bottom:1px solid rgba(255,255,255,.04); transition:background .12s; cursor:pointer; }
.dg2-tbl tbody tr:hover { background:rgba(255,255,255,.04); }
.dg2-tbl tbody td { padding:10px 12px; color:${D.textSec}; vertical-align:middle; }
.dg2-tbl tfoot td { padding:10px 12px; font-weight:800; color:${D.textPri}; border-top:1px solid ${D.border}; background:${D.card2}; }
.dg2-bar-bg { height:5px; background:rgba(255,255,255,.08); border-radius:3px; overflow:hidden; margin-top:3px; }
.dg2-bar-fill { height:5px; border-radius:3px; transition:width .4s; }
.dg2-glow-amber { box-shadow:0 0 20px ${D.amberGlow}; }
.dg2-glow-cyan   { box-shadow:0 0 20px ${D.cyanGlow};  }
.dg2-glow-green  { box-shadow:0 0 20px ${D.greenGlow}; }
.dg2-glow-red    { box-shadow:0 0 20px ${D.redGlow};   }
.dg2-glow-purple { box-shadow:0 0 20px ${D.purpleGlow};}
.dg2-section-title { font-size:10px; font-weight:800; text-transform:uppercase; letter-spacing:.8px; color:${D.textMut}; margin-bottom:12px; display:flex; align-items:center; gap:8px; }
.dg2-section-title::before { content:''; width:3px; height:14px; border-radius:2px; display:inline-block; }
.dg2-pulse { animation:dg2pulse 2s ease-in-out infinite; }
@keyframes dg2pulse { 0%,100%{opacity:1} 50%{opacity:.5} }
@keyframes dg2spin  { to{transform:rotate(360deg)} }
@keyframes dg2fadein { from{opacity:0;transform:translateY(8px)} to{opacity:1;transform:translateY(0)} }
.dg2-fadein { animation:dg2fadein .35s ease both; }
</style>`;

export class DashGlobalModule {
  constructor() {
    this._subs    = [];
    this._obras   = [];
    this._filtros = { status:'', contratada:'', cidade:'', tipo:'' };
    this._busca   = '';
    this._loading = false;
    this._anim    = 0;
    this._tabAtual = 'visao';
  }

  async init()    { try { this._bindEvents(); this._exposeGlobals(); } catch(e) { console.error('[DashGlobal] init:', e); } }
  async onEnter() { try { await this._carregarTudo(); this._render(); } catch(e) { console.error('[DashGlobal] onEnter:', e); } }

  /* ═════════════════════ DADOS ════════════════════════════ */
  async _carregarTudo() {
    this._loading = true;
    try {
      const lista = await FirebaseService.getObrasLista() || [];
      this._obras = await Promise.all(lista.map(async obra => {
        try {
          const [cfg,bms,itens,aditivos,prorrs] = await Promise.all([
            FirebaseService.getObraCfg(obra.id).catch(()=>null),
            FirebaseService.getBMs(obra.id).catch(()=>[]),
            FirebaseService.getItens(obra.id).catch(()=>[]),
            FirebaseService.getAditivos(obra.id).catch(()=>[]),
            FirebaseService.getProrrogacoes(obra.id).catch(()=>[]),
          ]);
          const bmList=bms||[];
          await Promise.all(bmList.map(bm=>FirebaseService.getMedicoes(obra.id,bm.num).then(med=>{if(med&&Object.keys(med).length>0)_injetarCacheMedicoes(obra.id,bm.num,med);}).catch(()=>{})));
          return {...obra, cfg:cfg||{}, bms:bmList, itens:itens||[], aditivos:aditivos||[], prorrs:prorrs||[]};
        } catch { return {...obra, cfg:{}, bms:[], itens:[], aditivos:[], prorrs:[]}; }
      }));
    } catch(e) { console.error('[DashGlobal] _carregarTudo:', e); this._obras=[]; }
    this._loading = false;
  }

  /* ═════════════════════ CÁLCULO ══════════════════════════ */
  _calcObra(obra) {
    const cfg=obra.cfg||{}, bms=obra.bms||[], itens=obra.itens||[];
    const aditivos=obra.aditivos||[], prorrs=obra.prorrs||[];
    const hoje=new Date(), hoje0=new Date(hoje.toDateString());
    const ultimoBm=bms.slice().sort((a,b)=>(b.num||0)-(a.num||0))[0];
    const lastBmNum=ultimoBm?.num||0;
    let valorExec=0, pctFisico=0;
    if (itens.length>0&&lastBmNum>0) {
      valorExec=getValorAcumuladoTotal(obra.id,lastBmNum,itens,cfg);
      const vc=parseFloat(cfg.valor||0); pctFisico=vc>0?Math.min(100,(valorExec/vc)*100):0;
    } else {
      pctFisico=parseFloat(ultimoBm?.pctAcumFisico||ultimoBm?.percentualAcumulado||0);
      valorExec=parseFloat(ultimoBm?.valorAcumulado||0)||bms.reduce((s,b)=>s+parseFloat(b.valorMedicao||0),0);
    }
    const valorContr=parseFloat(cfg.valor||0), saldo=Math.max(0,valorContr-valorExec);
    const pctFinanceiro=valorContr>0?Math.min(100,(valorExec/valorContr)*100):0;
    const VALID=['Em andamento','Paralisada','Concluída','Suspensa'];
    const raw=cfg.statusObra||cfg.status||obra.statusObra||obra.status||'';
    const statusAtual=VALID.includes(raw)?raw:(obra.statusObra||'Em andamento');
    const diasBasePrazo=parseInt(cfg.duracaoDias)||0;
    const diasProrr=prorrs.reduce((s,p)=>s+(parseInt(p.dias)||0),0);
    const diasTotal=diasBasePrazo+diasProrr;
    const inicio=cfg.inicioReal||cfg.inicioPrev||null;
    let dataFim=cfg.termino||null;
    if (inicio&&diasTotal>0) { const d=new Date(inicio+'T12:00:00');d.setDate(d.getDate()+diasTotal);dataFim=d.toISOString().slice(0,10); }
    const diasRestantes=diffDias(dataFim);
    const atrasada=dataFim&&hoje0>new Date(dataFim+'T23:59:59')&&statusAtual!=='Concluída';
    const diasAtraso=atrasada&&diasRestantes!==null?Math.abs(diasRestantes):0;
    let pctPrazo=0;
    if (inicio&&dataFim) { const dtI=new Date(inicio+'T12:00:00'),dtF=new Date(dataFim+'T23:59:59');const tot=dtF-dtI;pctPrazo=tot>0?Math.max(0,Math.min(100,(hoje0-dtI)/tot*100)):0; }
    const statusExecucao=statusAtual==='Concluída'||statusAtual==='Paralisada'||statusAtual==='Suspensa'?null:(atrasada||(pctPrazo>0&&(pctPrazo-pctFisico)>10))?'ATRASADA':'DENTRO DO PRAZO';
    const aditivosAprov=aditivos.filter(a=>a.status==='Aprovado');
    const valorAditivos=aditivosAprov.reduce((s,a)=>s+(parseFloat(a.variacaoValor)||0),0);
    const pctAditivo=valorContr>0?(valorAditivos/valorContr)*100:0;
    const ultimaAt=ultimoBm?.criadoEm||ultimoBm?.data||null;
    const diasSemAt=ultimaAt?Math.max(0,Math.floor((hoje0-new Date(ultimaAt))/86400000)):999;
    const cidade=cfg.municipio||cfg.cidade||obra.municipio||obra.cidade||'—';
    const tipoObra=cfg.tipo||obra.tipo||'—';
    return {pctFisico,pctFinanceiro,valorExec,valorContr,saldo,atrasada:!!(atrasada||statusExecucao==='ATRASADA'),diasAtraso,pctPrazo,diasRestantes,dataFim,statusExecucao,statusAtual,ultimoBm,aditivosAprov,valorAditivos,pctAditivo,diasSemAt,cidade,tipoObra};
  }

  _obrasVisiveis() {
    let lista=[...this._obras];
    const {status,contratada,cidade,tipo}=this._filtros;
    const busca=this._busca.trim().toLowerCase();
    if (status) lista=lista.filter(o=>this._calcObra(o).statusAtual===status);
    if (contratada) lista=lista.filter(o=>(o.cfg?.contratada||'').toLowerCase().includes(contratada.toLowerCase()));
    if (cidade) lista=lista.filter(o=>(o.cfg?.municipio||o.cfg?.cidade||o.municipio||o.cidade||'').toLowerCase().includes(cidade.toLowerCase()));
    if (tipo) lista=lista.filter(o=>(o.cfg?.tipo||o.tipo||'').toLowerCase().includes(tipo.toLowerCase()));
    if (busca) lista=lista.filter(o=>(o.cfg?.apelido||o.apelido||o.nome||o.cfg?.objeto||'').toLowerCase().includes(busca)||(o.cfg?.contrato||'').toLowerCase().includes(busca)||(o.cfg?.contratada||'').toLowerCase().includes(busca));
    return lista;
  }

  /* ═════════════════════ RENDER ═══════════════════════════ */
  _render(tab) {
    if (tab) this._tabAtual = tab;
    const el=document.getElementById('dash-global-conteudo');
    if (!el) return;
    if (!document.getElementById('dg-dark-css')) el.insertAdjacentHTML('beforebegin', CSS);

    if (this._loading) {
      el.innerHTML=`<div style="display:flex;flex-direction:column;align-items:center;justify-content:center;min-height:400px;gap:16px;background:${D.bg}">
        <div style="width:40px;height:40px;border:3px solid rgba(245,158,11,.2);border-top-color:${D.amber};border-radius:50%;animation:dg2spin .7s linear infinite"></div>
        <div style="font-size:13px;color:${D.textMut};letter-spacing:.5px">CARREGANDO DADOS</div>
      </div>`;
      return;
    }

    const todas=this._obras, visiveis=this._obrasVisiveis(), agora=new Date();
    let totContr=0,totExec=0,totSaldo=0,totBMs=0;
    let nAtr=0,nConc=0,nAnd=0,nPar=0,nSus=0,nSem=0,nProx=0;
    let somaPctFis=0,somaPctFin=0,nComPct=0,totAditivos=0,somaAditPct=0,nComAdt=0;
    const calc=[];
    todas.forEach(o=>{
      const c=this._calcObra(o), cfg=o.cfg||{}, bms=o.bms||[];
      totContr+=c.valorContr;totExec+=c.valorExec;totSaldo+=c.saldo;totBMs+=bms.length;
      if(c.atrasada)nAtr++;
      if(c.statusAtual==='Concluída')nConc++;
      else if(c.statusAtual==='Em andamento')nAnd++;
      else if(c.statusAtual==='Paralisada')nPar++;
      else if(c.statusAtual==='Suspensa')nSus++;
      if(bms.length===0)nSem++;
      if(c.pctFisico>=80&&c.pctFisico<100&&c.statusAtual!=='Concluída')nProx++;
      if(c.valorContr>0){somaPctFis+=c.pctFisico;somaPctFin+=c.pctFinanceiro;nComPct++;}
      const na=(o.aditivos||[]).filter(a=>a.status==='Aprovado').length;
      totAditivos+=na;
      if(na>0){somaAditPct+=c.pctAditivo;nComAdt++;}
      calc.push({...o,c});
    });
    const pctFisMed=nComPct>0?somaPctFis/nComPct:0;
    const pctFinMed=nComPct>0?somaPctFin/nComPct:0;
    const pctAdtMed=nComAdt>0?somaAditPct/nComAdt:0;
    const pctExecGlobal=totContr>0?(totExec/totContr)*100:0;
    const alertas=this._gerarAlertas(calc);
    const statusOpts=['Em andamento','Paralisada','Concluída','Suspensa'];
    const contratadas=[...new Set(todas.map(o=>o.cfg?.contratada||'').filter(Boolean))].sort();
    const cidades=[...new Set(todas.map(o=>o.cfg?.municipio||o.cfg?.cidade||o.municipio||o.cidade||'').filter(Boolean))].sort();

    const tabs=[
      {id:'visao',      icon:'◈', label:'Visão Geral'},
      {id:'financeiro', icon:'◈', label:'Financeiro'},
      {id:'prazo',      icon:'◈', label:'Prazos'},
      {id:'riscos',     icon:'◈', label:`Alertas${alertas.length>0?` · ${alertas.length}`:''}` },
      {id:'empresas',   icon:'◈', label:'Empresas'},
      {id:'aditivos',   icon:'◈', label:'Aditivos'},
    ];
    const tabColors={visao:D.cyan,financeiro:D.green,prazo:D.amber,riscos:D.red,empresas:D.purple,aditivos:D.blue};

    el.innerHTML=`
    <div style="background:${D.bg};min-height:100vh;padding:0 0 40px">

      <!-- HEADER -->
      <div style="padding:22px 28px 18px;background:linear-gradient(180deg,#0f1729 0%,${D.bg} 100%);border-bottom:1px solid ${D.border};position:relative;overflow:hidden">
        <div style="position:absolute;top:-60px;left:40%;width:300px;height:200px;background:radial-gradient(circle,rgba(245,158,11,.12) 0%,transparent 70%);pointer-events:none"></div>
        <div style="display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:12px;position:relative">
          <div>
            <div style="font-size:11px;font-weight:700;color:${D.amber};text-transform:uppercase;letter-spacing:1.5px;margin-bottom:4px">PAINEL EXECUTIVO</div>
            <div style="font-size:22px;font-weight:900;color:${D.textPri};letter-spacing:-.4px;line-height:1">Gestão de Contratos de Obras</div>
            <div style="font-size:11px;color:${D.textMut};margin-top:5px">
              <span style="color:${D.amber};font-weight:700">${todas.length}</span> obra${todas.length!==1?'s':''} monitoradas &nbsp;·&nbsp;
              ${agora.toLocaleDateString('pt-BR',{day:'2-digit',month:'long',year:'numeric'})} às ${agora.toLocaleTimeString('pt-BR',{hour:'2-digit',minute:'2-digit'})}
            </div>
          </div>
          <div style="display:flex;gap:8px;align-items:center">
            ${alertas.length>0?`<div class="dg2-pulse" style="display:flex;align-items:center;gap:6px;padding:8px 14px;background:rgba(239,68,68,.1);border:1px solid rgba(239,68,68,.3);border-radius:9px;font-size:11px;font-weight:700;color:${D.red}">⚠ ${alertas.length} alerta${alertas.length>1?'s':''}</div>`:''}
            <button id="dg-btn-att" style="padding:10px 22px;background:linear-gradient(135deg,${D.amber},#d97706);border:none;border-radius:9px;color:#000;font-size:12px;font-weight:800;cursor:pointer;letter-spacing:.3px;box-shadow:0 4px 18px rgba(245,158,11,.35)">↻ Atualizar</button>
          </div>
        </div>
      </div>

      <!-- KPIs -->
      <div style="padding:20px 28px 0">
        <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(160px,1fr));gap:10px;margin-bottom:24px">
          ${this._kpi('🏗️','Contratos Ativos',String(nAnd+nSus+nPar),D.cyan)}
          ${this._kpi('💼','Contratado',R$(totContr),D.blue)}
          ${this._kpi('💰','Executado',R$(totExec),D.green)}
          ${this._kpi('📦','Saldo',R$(totSaldo),D.slate)}
          ${this._kpi('📊','Exec. Física',pct(pctFisMed),pctFisMed>=70?D.green:pctFisMed>=40?D.amber:D.red)}
          ${this._kpi('💳','Exec. Financ.',pct(pctFinMed),pctFinMed>=70?D.green:pctFinMed>=40?D.amber:D.red)}
          ${this._kpi('⏰','Em Atraso',String(nAtr),nAtr>0?D.red:D.slate)}
          ${this._kpi('🏆','Concluídas',String(nConc),D.green)}
          ${this._kpi('🚫','Paralisadas',String(nPar),nPar>0?D.amber:D.slate)}
          ${this._kpi('📋','BMs Total',String(totBMs),D.purple)}
        </div>

        <!-- TABS -->
        <div style="display:flex;gap:0;border-bottom:1px solid ${D.border};margin-bottom:20px;overflow-x:auto">
          ${tabs.map(t=>`<button class="dg2-tab${this._tabAtual===t.id?' active':''}" data-action="_dgTab" data-arg0="${t.id}"
            style="${this._tabAtual===t.id?`color:${tabColors[t.id]};border-bottom-color:${tabColors[t.id]};text-shadow:0 0 12px ${tabColors[t.id]}66`:''}"
            >${t.label}</button>`).join('')}
        </div>

        <!-- TAB CONTENT -->
        <div class="dg2-fadein">
          ${this._tabAtual==='visao'       ? this._htmlVisao(calc,nSem,nAnd,nProx,nConc,nPar,nSus)  : ''}
          ${this._tabAtual==='financeiro'  ? this._htmlFinanceiro(calc,totContr,totExec,pctExecGlobal): ''}
          ${this._tabAtual==='prazo'       ? this._htmlPrazo(calc)                                    : ''}
          ${this._tabAtual==='riscos'      ? this._htmlRiscos(alertas)                                : ''}
          ${this._tabAtual==='empresas'    ? this._htmlEmpresas(calc)                                 : ''}
          ${this._tabAtual==='aditivos'    ? this._htmlAditivos(calc,totAditivos,pctAdtMed)           : ''}
        </div>

        <!-- SEPARADOR -->
        <div style="height:1px;background:linear-gradient(90deg,transparent,${D.border},transparent);margin:28px 0 20px"></div>

        <!-- FILTROS + TABELA -->
        <div style="font-size:10px;font-weight:800;color:${D.amber};text-transform:uppercase;letter-spacing:1px;margin-bottom:12px">◈ TABELA RESUMO GLOBAL</div>
        ${this._htmlFiltros(statusOpts,contratadas,cidades,visiveis.length,todas.length)}
        ${this._htmlTabela(visiveis)}
      </div>
    </div>`;

    document.getElementById('dg-btn-att')?.addEventListener('click',()=>window._dgRecarregar());

    this._anim++;
    const aid=this._anim;
    requestAnimationFrame(()=>{
      if(aid!==this._anim)return;
      if(this._tabAtual==='visao'){try{this._chartAvancoH(calc,aid);}catch(e){}try{this._chartDonut(nSem,nAnd,nProx,nConc,nPar,nSus,aid);}catch(e){}}
      if(this._tabAtual==='financeiro'){try{this._chartFinV(calc,aid);}catch(e){}try{this._chartFisVsFin(calc,aid);}catch(e){}}
    });
  }

  /* ─── KPI card ─── */
  _kpi(ico,lbl,val,cor) {
    return `<div class="dg2-kpi" style="border-top:2px solid ${cor}; position:relative; overflow:hidden">
      <div style="position:absolute;top:-10px;right:-10px;width:60px;height:60px;background:radial-gradient(circle,${cor}15 0%,transparent 70%);pointer-events:none"></div>
      <div style="font-size:18px;margin-bottom:8px">${ico}</div>
      <div style="font-size:9px;color:${D.textMut};text-transform:uppercase;letter-spacing:.6px;margin-bottom:4px">${lbl}</div>
      <div style="font-size:16px;font-weight:900;color:${cor};font-family:monospace;line-height:1.1">${val}</div>
    </div>`;
  }

  /* ─── TAB VISÃO GERAL ─── */
  _htmlVisao(calc,nSem,nAnd,nProx,nConc,nPar,nSus) {
    return `<div style="display:grid;grid-template-columns:1.6fr 1fr;gap:16px">
      <div class="dg2-card">
        <div class="dg2-section-title" style="color:${D.cyan}"><span style="background:${D.cyan};width:3px;height:14px;border-radius:2px;display:inline-block"></span>AVANÇO FÍSICO POR OBRA</div>
        <canvas id="dg-c1" style="width:100%;height:280px;display:block"></canvas>
      </div>
      <div class="dg2-card">
        <div class="dg2-section-title" style="color:${D.purple}"><span style="background:${D.purple};width:3px;height:14px;border-radius:2px;display:inline-block"></span>SITUAÇÃO DAS OBRAS</div>
        <canvas id="dg-c3" style="width:100%;height:200px;display:block"></canvas>
        <div id="dg-leg" style="margin-top:12px;display:flex;flex-wrap:wrap;gap:6px 14px;justify-content:center"></div>
      </div>
    </div>`;
  }

  /* ─── TAB FINANCEIRO ─── */
  _htmlFinanceiro(calc,totContr,totExec,pctExecGlobal) {
    const saldo=totContr-totExec, corPct=pctExecGlobal>=80?D.green:pctExecGlobal>=40?D.amber:D.red;
    return `
    <div style="display:grid;grid-template-columns:repeat(4,1fr);gap:10px;margin-bottom:18px">
      ${[
        {l:'Contratado',v:R$(totContr),c:D.blue},
        {l:'Executado', v:R$(totExec), c:D.green},
        {l:'Saldo',     v:R$(Math.max(0,saldo)), c:D.slate},
        {l:'Exec. Global', v:pct(pctExecGlobal), c:corPct},
      ].map(k=>`<div class="dg2-card" style="text-align:center;border-top:2px solid ${k.c}">
        <div style="font-size:9px;color:${D.textMut};text-transform:uppercase;letter-spacing:.6px;margin-bottom:8px">${k.l}</div>
        <div style="font-size:18px;font-weight:900;color:${k.c};font-family:monospace">${k.v}</div>
      </div>`).join('')}
    </div>
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:16px">
      <div class="dg2-card">
        <div class="dg2-section-title" style="color:${D.blue}"><span style="background:${D.blue};width:3px;height:14px;border-radius:2px;display:inline-block"></span>CONTRATADO vs EXECUTADO</div>
        <canvas id="dg-c2" style="width:100%;height:260px;display:block"></canvas>
        <div style="display:flex;gap:16px;justify-content:center;margin-top:10px;font-size:10px;color:${D.textMut}">
          <span><span style="display:inline-block;width:10px;height:10px;background:${D.blue};border-radius:2px;margin-right:5px;vertical-align:middle"></span>Contratado</span>
          <span><span style="display:inline-block;width:10px;height:10px;background:${D.green};border-radius:2px;margin-right:5px;vertical-align:middle"></span>Executado</span>
        </div>
      </div>
      <div class="dg2-card">
        <div class="dg2-section-title" style="color:${D.purple}"><span style="background:${D.purple};width:3px;height:14px;border-radius:2px;display:inline-block"></span>FÍSICO vs FINANCEIRO (%)</div>
        <canvas id="dg-c4" style="width:100%;height:260px;display:block"></canvas>
        <div style="display:flex;gap:16px;justify-content:center;margin-top:10px;font-size:10px;color:${D.textMut}">
          <span><span style="display:inline-block;width:10px;height:10px;background:${D.blue};border-radius:2px;margin-right:5px;vertical-align:middle"></span>Físico</span>
          <span><span style="display:inline-block;width:10px;height:10px;background:${D.amber};border-radius:2px;margin-right:5px;vertical-align:middle"></span>Financeiro</span>
        </div>
      </div>
    </div>`;
  }

  /* ─── TAB PRAZO ─── */
  _htmlPrazo(calc) {
    const comPrazo=calc.filter(o=>o.c.dataFim).map(o=>({...o,_dr:o.c.diasRestantes})).sort((a,b)=>(a._dr??9999)-(b._dr??9999));
    const vencidas=comPrazo.filter(o=>o.c.atrasada&&o.c.statusAtual!=='Concluída');
    const proximas=comPrazo.filter(o=>!o.c.atrasada&&o._dr!==null&&o._dr<=ALERTA.diasVencimentoProximo&&o.c.statusAtual!=='Concluída');
    const emDia=comPrazo.filter(o=>!o.c.atrasada&&(o._dr===null||o._dr>ALERTA.diasVencimentoProximo)&&o.c.statusAtual!=='Concluída');
    const row=o=>{
      const c=o.c,cfg=o.cfg||{},nome=(cfg.apelido||o.apelido||o.nome||cfg.objeto||'Obra').slice(0,32);
      const dr=o._dr,dtFim=c.dataFim?new Date(c.dataFim+'T12:00:00').toLocaleDateString('pt-BR'):'—';
      let badge,bg='';
      if(c.atrasada){badge=`<span class="dg2-badge" style="background:${D.redGlow};color:${D.red};border:1px solid ${D.red}33">⬤ ${c.diasAtraso}d atraso</span>`;bg=`background:rgba(239,68,68,.04)`;}
      else if(dr!==null&&dr<=ALERTA.diasVencimentoProximo){badge=`<span class="dg2-badge" style="background:${D.amberGlow};color:${D.amber};border:1px solid ${D.amber}33">⬤ ${dr}d restantes</span>`;bg=`background:rgba(245,158,11,.03)`;}
      else{badge=`<span class="dg2-badge" style="background:${D.greenGlow};color:${D.green};border:1px solid ${D.green}33">⬤ ${dr!==null?dr+'d':'—'}</span>`;}
      return `<tr style="${bg}">
        <td style="font-weight:600;color:${D.textPri}" title="${esc(nome)}">${esc(nome)}</td>
        <td style="text-align:center;font-size:11px">${dtFim}</td>
        <td style="text-align:center">${badge}</td>
        <td style="text-align:center;font-size:11px">${(o.prorrs||[]).length>0?`<span style="color:${D.amber};font-weight:700">+${(o.prorrs||[]).length}</span>`:'—'}</td>
        <td style="text-align:center;font-size:11px;color:${D.textSec}">${pct(c.pctFisico)}</td>
        <td style="text-align:right"><button data-action="_dgAbrirObra" data-arg0="${o.id}" class="dg2-btn" style="background:${D.amber};color:#000">Abrir</button></td>
      </tr>`;
    };
    return `
    <div style="display:grid;grid-template-columns:repeat(4,1fr);gap:10px;margin-bottom:16px">
      ${[{l:'Prazo Vencido',v:vencidas.length,c:D.red,g:D.redGlow},{l:'Vence em ${ALERTA.diasVencimentoProximo}d',v:proximas.length,c:D.amber,g:D.amberGlow},{l:'Em Dia',v:emDia.length,c:D.green,g:D.greenGlow},{l:'Sem Prazo',v:calc.length-comPrazo.length,c:D.slate,g:'transparent'}].map(k=>
        `<div class="dg2-card" style="text-align:center;border-top:2px solid ${k.c}">
          <div style="font-size:9px;color:${D.textMut};text-transform:uppercase;letter-spacing:.6px;margin-bottom:8px">${k.l}</div>
          <div style="font-size:28px;font-weight:900;color:${k.c}">${k.v}</div>
        </div>`).join('')}
    </div>
    <div class="dg2-card" style="padding:0;overflow:hidden">
      <table class="dg2-tbl">
        <thead><tr><th>Obra</th><th style="text-align:center">Término</th><th style="text-align:center">Situação</th><th style="text-align:center">Prorr.</th><th style="text-align:center">Físico</th><th></th></tr></thead>
        <tbody>
          ${vencidas.map(row).join('')}
          ${proximas.map(row).join('')}
          ${emDia.map(row).join('')}
          ${calc.filter(o=>!o.c.dataFim).map(o=>`<tr><td style="color:${D.textMut};font-size:11px" colspan="6">${esc((o.cfg?.apelido||o.nome||'Obra').slice(0,30))} — prazo não configurado</td></tr>`).join('')}
        </tbody>
      </table>
    </div>`;
  }

  /* ─── ALERTAS ─── */
  _gerarAlertas(calc) {
    const al=[];
    calc.forEach(o=>{
      const c=o.c,cfg=o.cfg||{},nome=(cfg.apelido||o.apelido||o.nome||cfg.objeto||'Obra').slice(0,35);
      if(c.atrasada&&c.diasAtraso>ALERTA.diasAtrasoLimite)al.push({nivel:'critico',obraId:o.id,obra:nome,tipo:'Atraso crítico',desc:`${c.diasAtraso} dias de atraso`});
      if(c.pctFisico<ALERTA.pctBaixoExecucao&&c.pctPrazo>20&&c.statusAtual==='Em andamento')al.push({nivel:'alerta',obraId:o.id,obra:nome,tipo:'Execução baixa',desc:`${pct(c.pctFisico)} exec. com ${pct(c.pctPrazo)} prazo decorrido`});
      if(c.aditivosAprov.length>ALERTA.maxAditivos)al.push({nivel:'aviso',obraId:o.id,obra:nome,tipo:'Muitos aditivos',desc:`${c.aditivosAprov.length} aditivos aprovados`});
      if(c.diasSemAt>ALERTA.diasSemAtualizacao&&c.statusAtual==='Em andamento')al.push({nivel:'aviso',obraId:o.id,obra:nome,tipo:'Sem atualização',desc:`Último BM há ${c.diasSemAt} dias`});
      if(c.diasRestantes!==null&&c.diasRestantes>0&&c.diasRestantes<=ALERTA.diasVencimentoProximo&&c.statusAtual!=='Concluída')al.push({nivel:'aviso',obraId:o.id,obra:nome,tipo:'Prazo próximo',desc:`Vence em ${c.diasRestantes} dias`});
      if(c.pctFinanceiro>c.pctFisico+15&&c.pctFisico>5)al.push({nivel:'alerta',obraId:o.id,obra:nome,tipo:'Pag. adiantado',desc:`Fin. ${pct(c.pctFinanceiro)} > Fís. ${pct(c.pctFisico)}`});
    });
    return al.sort((a,b)=>({critico:0,alerta:1,aviso:2}[a.nivel]||3)-({critico:0,alerta:1,aviso:2}[b.nivel]||3));
  }

  _htmlRiscos(alertas) {
    const cfg={critico:{c:D.red,g:D.redGlow,ico:'🔴'},alerta:{c:D.amber,g:D.amberGlow,ico:'⚠️'},aviso:{c:D.cyan,g:D.cyanGlow,ico:'💡'}};
    const n=n=>alertas.filter(a=>a.nivel===n).length;
    return `
    <div style="display:grid;grid-template-columns:repeat(3,1fr);gap:10px;margin-bottom:18px">
      ${[['critico',D.red,'🔴','Críticos'],['alerta',D.amber,'⚠️','Alertas'],['aviso',D.cyan,'💡','Avisos']].map(([ni,cor,ico,lbl])=>`
        <div class="dg2-card" style="text-align:center;border-top:2px solid ${cor}">
          <div style="font-size:9px;color:${D.textMut};text-transform:uppercase;letter-spacing:.6px;margin-bottom:8px">${ico} ${lbl}</div>
          <div style="font-size:32px;font-weight:900;color:${cor}">${n(ni)}</div>
        </div>`).join('')}
    </div>
    ${alertas.length===0
      ? `<div style="text-align:center;padding:48px;color:${D.textMut}"><div style="font-size:36px;margin-bottom:8px">✅</div><div style="font-weight:700;color:${D.textSec}">Nenhum alerta ativo</div></div>`
      : `<div style="display:flex;flex-direction:column;gap:8px">
          ${alertas.map(a=>{
            const k=cfg[a.nivel]||cfg.aviso;
            return `<div style="display:flex;align-items:center;gap:14px;padding:14px 18px;background:${D.card};border:1px solid rgba(255,255,255,.06);border-left:3px solid ${k.c};border-radius:10px;transition:background .15s" onmouseover="this.style.background='${D.card2}'" onmouseout="this.style.background='${D.card}'">
              <span style="font-size:20px;flex-shrink:0">${k.ico}</span>
              <div style="flex:1;min-width:0">
                <div style="font-size:11px;font-weight:700;color:${k.c};text-transform:uppercase;letter-spacing:.3px">${esc(a.tipo)}</div>
                <div style="font-size:13px;font-weight:600;color:${D.textPri};margin-top:1px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${esc(a.obra)}</div>
                <div style="font-size:11px;color:${D.textMut};margin-top:1px">${esc(a.desc)}</div>
              </div>
              <button data-action="_dgAbrirObra" data-arg0="${a.obraId}" class="dg2-btn" style="flex-shrink:0;background:${k.c};color:#000">Ver</button>
            </div>`;
          }).join('')}
        </div>`}`;
  }

  /* ─── TAB EMPRESAS ─── */
  _htmlEmpresas(calc) {
    const map={};
    calc.forEach(o=>{
      const cfg=o.cfg||{},c=o.c,emp=(cfg.contratada||'Não informada').trim();
      if(!map[emp])map[emp]={nome:emp,nContratos:0,valorTotal:0,valorExec:0,nAtrasadas:0,soma_pct:0,n_pct:0};
      map[emp].nContratos++;map[emp].valorTotal+=c.valorContr;map[emp].valorExec+=c.valorExec;
      if(c.atrasada)map[emp].nAtrasadas++;
      if(c.valorContr>0){map[emp].soma_pct+=c.pctFisico;map[emp].n_pct++;}
    });
    const empresas=Object.values(map).map(e=>({...e,pctMed:e.n_pct>0?e.soma_pct/e.n_pct:0})).sort((a,b)=>b.valorTotal-a.valorTotal);
    if(!empresas.length)return`<div style="text-align:center;padding:48px;color:${D.textMut}">Nenhuma empresa cadastrada.</div>`;
    return `<div class="dg2-card" style="padding:0;overflow:hidden">
      <table class="dg2-tbl">
        <thead><tr><th>#</th><th>Empresa</th><th style="text-align:center">Contratos</th><th style="text-align:right">Valor Total</th><th style="text-align:right">Executado</th><th style="text-align:center">Exec. Média</th><th style="text-align:center">Atrasos</th><th style="text-align:center">Performance</th></tr></thead>
        <tbody>${empresas.map((e,i)=>{
          const bc=e.pctMed>=80?D.green:e.pctMed>=40?D.amber:D.red;
          const perf=e.nAtrasadas===0&&e.pctMed>50?{l:'Boa',c:D.green}:e.nAtrasadas>0?{l:'Atenção',c:D.amber}:{l:'Regular',c:D.cyan};
          return `<tr>
            <td style="color:${D.textMut};font-size:10px;font-weight:700">${i+1}</td>
            <td style="font-weight:700;color:${D.textPri}">${esc(e.nome.slice(0,36))}</td>
            <td style="text-align:center;font-weight:700;color:${D.cyan}">${e.nContratos}</td>
            <td style="text-align:right;font-family:monospace;font-size:11px">${R$(e.valorTotal)}</td>
            <td style="text-align:right;font-family:monospace;font-size:11px;color:${D.green}">${R$(e.valorExec)}</td>
            <td style="min-width:100px">
              <div style="display:flex;justify-content:space-between;font-size:9px;color:${D.textMut};margin-bottom:2px"><span>Exec.</span><span style="font-weight:700;color:${bc}">${pct(e.pctMed)}</span></div>
              <div class="dg2-bar-bg"><div class="dg2-bar-fill" style="background:${bc};width:${Math.min(100,e.pctMed)}%"></div></div>
            </td>
            <td style="text-align:center">${e.nAtrasadas>0?`<span style="color:${D.red};font-weight:700">${e.nAtrasadas}</span>`:`<span style="color:${D.green}">0</span>`}</td>
            <td style="text-align:center"><span class="dg2-badge" style="background:${perf.c}18;color:${perf.c};border:1px solid ${perf.c}33">${perf.l}</span></td>
          </tr>`;
        }).join('')}</tbody>
      </table>
    </div>`;
  }

  /* ─── TAB ADITIVOS ─── */
  _htmlAditivos(calc,totAditivos,pctAdtMed) {
    const comAdt=calc.filter(o=>o.c.aditivosAprov.length>0).sort((a,b)=>b.c.pctAditivo-a.c.pctAditivo);
    const tiposCnt={};
    calc.forEach(o=>(o.aditivos||[]).filter(a=>a.status==='Aprovado').forEach(a=>{const t=a.tipo||'outro';tiposCnt[t]=(tiposCnt[t]||0)+1;}));
    const tipoLabels={prazo:'⏱ Prazo',valor:'💰 Valor',planilha:'📋 Planilha',misto:'⏱💰 Misto'};
    return `
    <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(150px,1fr));gap:10px;margin-bottom:18px">
      ${[{l:'Total Aditivos',v:String(totAditivos),c:D.blue},{l:'Obras c/ Aditivo',v:String(comAdt.length),c:D.purple},{l:'Acréscimo Médio',v:pct(pctAdtMed),c:D.amber}].map(k=>
        `<div class="dg2-card" style="text-align:center;border-top:2px solid ${k.c}">
          <div style="font-size:9px;color:${D.textMut};text-transform:uppercase;letter-spacing:.6px;margin-bottom:8px">${k.l}</div>
          <div style="font-size:22px;font-weight:900;color:${k.c};font-family:monospace">${k.v}</div>
        </div>`).join('')}
      ${Object.entries(tiposCnt).map(([k,v])=>`
        <div class="dg2-card" style="text-align:center;border-top:2px solid ${D.slate}">
          <div style="font-size:9px;color:${D.textMut};text-transform:uppercase;letter-spacing:.5px;margin-bottom:8px">${tipoLabels[k]||k}</div>
          <div style="font-size:22px;font-weight:900;color:${D.textSec}">${v}</div>
        </div>`).join('')}
    </div>
    ${comAdt.length===0
      ? `<div style="text-align:center;padding:40px;color:${D.textMut}">Nenhum aditivo aprovado.</div>`
      : `<div class="dg2-card" style="padding:0;overflow:hidden">
          <table class="dg2-tbl">
            <thead><tr><th>Obra</th><th style="text-align:center">Aditivos</th><th style="text-align:right">Contratado</th><th style="text-align:right">Variação</th><th style="text-align:center">Acréscimo</th><th></th></tr></thead>
            <tbody>${comAdt.map(o=>{
              const c=o.c,cfg=o.cfg||{},nome=(cfg.apelido||o.apelido||o.nome||cfg.objeto||'Obra').slice(0,35);
              const pctA=c.pctAditivo,corA=pctA>25?D.red:pctA>10?D.amber:D.green;
              return `<tr>
                <td style="font-weight:600;color:${D.textPri};max-width:200px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap" title="${esc(nome)}">${esc(nome)}</td>
                <td style="text-align:center;font-weight:700;color:${D.blue}">${c.aditivosAprov.length}</td>
                <td style="text-align:right;font-family:monospace;font-size:11px">${R$(c.valorContr)}</td>
                <td style="text-align:right;font-family:monospace;font-size:11px;color:${c.valorAditivos>=0?D.green:D.red}">${c.valorAditivos>=0?'+':''}${R$(c.valorAditivos)}</td>
                <td style="min-width:100px">
                  <div style="display:flex;justify-content:space-between;font-size:9px;color:${D.textMut};margin-bottom:2px"><span></span><span style="font-weight:700;color:${corA}">${pct(pctA)}</span></div>
                  <div class="dg2-bar-bg"><div class="dg2-bar-fill" style="background:${corA};width:${Math.min(100,pctA*2)}%"></div></div>
                </td>
                <td><button data-action="_dgAbrirObra" data-arg0="${o.id}" class="dg2-btn" style="background:${D.amber};color:#000">Abrir</button></td>
              </tr>`;
            }).join('')}</tbody>
          </table>
        </div>`}`;
  }

  /* ─── FILTROS ─── */
  _htmlFiltros(statusOpts,contratadas,cidades,nVis,nTot) {
    return `<div class="dg2-card" style="margin-bottom:12px">
      <div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap">
        <input id="dg-busca" class="dg2-input" type="text" placeholder="🔍 Buscar obra, contrato ou empresa..." value="${esc(this._busca)}" oninput="window._dgBusca(this.value)" style="flex:1;min-width:200px">
        <select class="dg2-select" onchange="window._dgFiltro('status',this.value)">
          <option value="">Todos os status</option>
          ${statusOpts.map(s=>`<option value="${s}" ${this._filtros.status===s?'selected':''}>${s}</option>`).join('')}
        </select>
        <select class="dg2-select" onchange="window._dgFiltro('contratada',this.value)" style="max-width:200px">
          <option value="">Todas empresas</option>
          ${contratadas.map(c=>`<option value="${c}" ${this._filtros.contratada===c?'selected':''}>${c.slice(0,28)}</option>`).join('')}
        </select>
        <select class="dg2-select" onchange="window._dgFiltro('cidade',this.value)">
          <option value="">Todas cidades</option>
          ${cidades.map(c=>`<option value="${c}" ${this._filtros.cidade===c?'selected':''}>${c.slice(0,22)}</option>`).join('')}
        </select>
        <button data-action="_dgLimparFiltros" class="dg2-btn" style="background:rgba(255,255,255,.06);color:${D.textMut};border:1px solid ${D.border}">✕ Limpar</button>
      </div>
      <div style="font-size:10px;color:${D.textMut};margin-top:8px">Exibindo <strong style="color:${D.amber}">${nVis}</strong> de ${nTot} obra${nTot!==1?'s':''}</div>
    </div>`;
  }

  /* ─── TABELA RESUMO ─── */
  _htmlTabela(vis) {
    if(!vis.length)return`<div class="dg2-card" style="text-align:center;padding:40px;color:${D.textMut}">Nenhuma obra encontrada.</div>`;
    const totContr=vis.reduce((s,o)=>s+parseFloat(o.cfg?.valor||0),0);
    const totExec=vis.reduce((s,o)=>s+this._calcObra(o).valorExec,0);
    const stCor={Em_andamento:D.cyan,Concluída:D.green,Paralisada:D.amber,Suspensa:D.red};
    return `<div class="dg2-card" style="padding:0;overflow:hidden">
      <div style="overflow-x:auto">
      <table class="dg2-tbl">
        <thead><tr>${['Obra','Status','Contratado','Executado','Físico %','Financ. %','BMs','Empresa','Situação',''].map(h=>`<th>${h}</th>`).join('')}</tr></thead>
        <tbody>${vis.map(o=>{
          const cfg=o.cfg||{},c=this._calcObra(o);
          const nome=(cfg.apelido||o.apelido||o.nome||cfg.objeto||'Sem nome').slice(0,28);
          const sc=stCor[c.statusAtual.replace(/ /g,'_')]||D.slate;
          const pF=c.pctFisico||0,pFin=c.pctFinanceiro||0;
          const bcF=pF>=80?D.green:pF>=40?D.amber:D.blue;
          const bcFin=pFin>=80?D.green:pFin>=40?D.amber:D.blue;
          const emp=(cfg.contratada||'—').slice(0,18);
          let sit;
          if(c.atrasada)sit=`<span class="dg2-badge" style="background:${D.redGlow};color:${D.red};border:1px solid ${D.red}33">⚠ Atrasada</span>`;
          else if(c.diasRestantes!==null&&c.diasRestantes<=ALERTA.diasVencimentoProximo&&c.statusAtual!=='Concluída')sit=`<span class="dg2-badge" style="background:${D.amberGlow};color:${D.amber};border:1px solid ${D.amber}33">⏰ ${c.diasRestantes}d</span>`;
          else if(c.statusAtual==='Concluída')sit=`<span class="dg2-badge" style="background:${D.greenGlow};color:${D.green};border:1px solid ${D.green}33">✓ Concluída</span>`;
          else if((o.bms||[]).length===0)sit=`<span class="dg2-badge" style="background:rgba(255,255,255,.05);color:${D.textMut};border:1px solid ${D.border}">Sem BM</span>`;
          else sit=`<span class="dg2-badge" style="background:${D.cyanGlow};color:${D.cyan};border:1px solid ${D.cyan}33">⬤ Normal</span>`;
          return `<tr data-action="_dgAbrirObra" data-arg0="${o.id}">
            <td style="max-width:180px"><div style="font-weight:700;color:${D.textPri};white-space:nowrap;overflow:hidden;text-overflow:ellipsis" title="${esc(nome)}">${esc(nome)}</div>${cfg.contrato?`<div style="font-size:9px;color:${D.textMut};margin-top:1px">📄 ${esc(cfg.contrato)}</div>`:''}</td>
            <td><span class="dg2-badge" style="color:${sc};border:1px solid ${sc}33;background:${sc}18">${c.statusAtual}</span></td>
            <td style="text-align:right;font-family:monospace;font-size:11px;white-space:nowrap">${cfg.valor?R$(cfg.valor):'—'}</td>
            <td style="text-align:right;font-family:monospace;font-size:11px;color:${D.green};white-space:nowrap">${c.valorExec>0?R$(c.valorExec):'—'}</td>
            <td style="min-width:80px"><div style="display:flex;justify-content:space-between;font-size:9px;color:${D.textMut};margin-bottom:2px"><span>Fís.</span><span style="font-weight:700;color:${bcF}">${pct(pF)}</span></div><div class="dg2-bar-bg"><div class="dg2-bar-fill" style="background:${bcF};width:${Math.min(100,pF)}%"></div></div></td>
            <td style="min-width:80px"><div style="display:flex;justify-content:space-between;font-size:9px;color:${D.textMut};margin-bottom:2px"><span>Fin.</span><span style="font-weight:700;color:${bcFin}">${pct(pFin)}</span></div><div class="dg2-bar-bg"><div class="dg2-bar-fill" style="background:${bcFin};width:${Math.min(100,pFin)}%"></div></div></td>
            <td style="text-align:center;font-weight:600;color:${D.textSec}">${(o.bms||[]).length}</td>
            <td style="font-size:10px;color:${D.textMut};white-space:nowrap;max-width:120px;overflow:hidden;text-overflow:ellipsis" title="${esc(emp)}">${esc(emp)}</td>
            <td>${sit}</td>
            <td><button data-action="_dgAbrirObra" data-arg0="${o.id}" class="dg2-btn" style="background:${D.amber};color:#000">↗</button></td>
          </tr>`;
        }).join('')}</tbody>
        <tfoot><tr>
          <td>TOTAL (${vis.length})</td><td></td>
          <td style="text-align:right;font-family:monospace">${R$(totContr)}</td>
          <td style="text-align:right;font-family:monospace;color:${D.green}">${R$(totExec)}</td>
          <td colspan="6"></td>
        </tr></tfoot>
      </table></div>
    </div>`;
  }

  /* ═════════════════ GRÁFICOS CANVAS (dark) ══════════════ */
  _chartAvancoH(calc,aid) {
    const cv=document.getElementById('dg-c1');if(!cv)return;
    const ctx=cv.getContext('2d'),dpr=window.devicePixelRatio||1,r=cv.getBoundingClientRect();
    cv.width=r.width*dpr;cv.height=r.height*dpr;ctx.scale(dpr,dpr);
    const W=r.width,H=r.height;
    const dados=calc.slice(0,14).map(o=>({n:(o.cfg?.apelido||o.apelido||o.nome||o.cfg?.objeto||'Obra').slice(0,20),p:Math.min(100,o.c.pctFisico||0),a:o.c.atrasada}));
    if(!dados.length){ctx.fillStyle=D.textMut;ctx.font='12px sans-serif';ctx.textAlign='center';ctx.fillText('Sem dados',W/2,H/2);return;}
    const mL=140,mR=55,mT=8,bH=Math.min(17,(H-mT)/(dados.length)-4),gap=4,cW=W-mL-mR;
    const t0=performance.now(),dur=700;
    const draw=now=>{
      if(aid!==this._anim)return;
      const pr=Math.min(1,(now-t0)/dur),e=1-Math.pow(1-pr,3);
      ctx.clearRect(0,0,W,H);
      dados.forEach((d,i)=>{
        const y=mT+i*(bH+gap),bW=(d.p/100)*cW*e;
        const cor=d.a?D.red:d.p>=80?D.green:d.p>=40?D.amber:D.cyan;
        ctx.fillStyle=D.textMut;ctx.font='10px Inter,sans-serif';ctx.textAlign='right';ctx.textBaseline='middle';
        ctx.fillText(d.n,mL-10,y+bH/2);
        ctx.fillStyle='rgba(255,255,255,0.05)';ctx.beginPath();ctx.roundRect(mL,y,cW,bH,3);ctx.fill();
        if(bW>2){
          const g=ctx.createLinearGradient(mL,0,mL+cW,0);g.addColorStop(0,cor);g.addColorStop(1,cor+'44');
          ctx.fillStyle=g;ctx.beginPath();ctx.roundRect(mL,y,bW,bH,3);ctx.fill();
          ctx.shadowColor=cor;ctx.shadowBlur=8;ctx.fillStyle=g;ctx.beginPath();ctx.roundRect(mL,y,bW,bH,3);ctx.fill();ctx.shadowBlur=0;
        }
        ctx.fillStyle=D.textPri;ctx.font='bold 10px monospace';ctx.textAlign='left';
        ctx.fillText(`${(d.p*e).toFixed(1)}%`,mL+bW+6,y+bH/2);
      });
      if(pr<1)requestAnimationFrame(draw);
    };
    requestAnimationFrame(draw);
  }

  _chartDonut(sem,and,prox,conc,par,sus,aid) {
    const cv=document.getElementById('dg-c3');if(!cv)return;
    const ctx=cv.getContext('2d'),dpr=window.devicePixelRatio||1,r=cv.getBoundingClientRect();
    cv.width=r.width*dpr;cv.height=r.height*dpr;ctx.scale(dpr,dpr);
    const W=r.width,H=r.height;
    const sl=[{l:'Sem BM',v:sem,c:D.slate},{l:'Em andamento',v:and,c:D.cyan},{l:'Próx. conclusão',v:prox,c:D.amber},{l:'Concluídas',v:conc,c:D.green},{l:'Paralisadas',v:par,c:'#d97706'},{l:'Suspensas',v:sus,c:D.red}].filter(s=>s.v>0);
    const tot=sl.reduce((s,x)=>s+x.v,0);
    if(!tot){ctx.fillStyle=D.textMut;ctx.font='12px sans-serif';ctx.textAlign='center';ctx.fillText('Sem dados',W/2,H/2);return;}
    const cx=W/2,cy=H/2,R=Math.min(cx,cy)-14,iR=R*.55;
    const t0=performance.now(),dur=900;
    const draw=now=>{
      if(aid!==this._anim)return;
      const pr=Math.min(1,(now-t0)/dur),e=1-Math.pow(1-pr,3),ta=Math.PI*2*e;
      ctx.clearRect(0,0,W,H);
      let sa=-Math.PI/2;
      sl.forEach(s=>{
        const a=(s.v/tot)*ta;
        ctx.shadowColor=s.c;ctx.shadowBlur=10;
        ctx.beginPath();ctx.moveTo(cx,cy);ctx.arc(cx,cy,R,sa,sa+a);ctx.closePath();ctx.fillStyle=s.c;ctx.fill();
        ctx.shadowBlur=0;sa+=a;
      });
      ctx.beginPath();ctx.arc(cx,cy,iR,0,Math.PI*2);ctx.fillStyle=D.card;ctx.fill();
      if(pr>.4){
        ctx.fillStyle=D.textPri;ctx.font='bold 22px Inter,sans-serif';ctx.textAlign='center';ctx.textBaseline='middle';
        ctx.fillText(String(tot),cx,cy-7);
        ctx.fillStyle=D.textMut;ctx.font='9px Inter,sans-serif';ctx.fillText('OBRAS',cx,cy+12);
      }
      if(pr<1)requestAnimationFrame(draw);
    };
    requestAnimationFrame(draw);
    const leg=document.getElementById('dg-leg');
    if(leg)leg.innerHTML=sl.map(s=>`<div style="display:flex;align-items:center;gap:5px;font-size:10px;color:${D.textMut}"><span style="width:8px;height:8px;border-radius:2px;background:${s.c};box-shadow:0 0 5px ${s.c}66;flex-shrink:0"></span>${s.l}: <strong style="color:${D.textPri}">${s.v}</strong></div>`).join('');
  }

  _chartFinV(calc,aid) {
    const cv=document.getElementById('dg-c2');if(!cv)return;
    const ctx=cv.getContext('2d'),dpr=window.devicePixelRatio||1,r=cv.getBoundingClientRect();
    cv.width=r.width*dpr;cv.height=r.height*dpr;ctx.scale(dpr,dpr);
    const W=r.width,H=r.height;
    const dados=calc.slice(0,10).map(o=>({n:(o.cfg?.apelido||o.apelido||o.nome||o.cfg?.objeto||'Obra').slice(0,10),v:o.c.valorContr,m:o.c.valorExec}));
    if(!dados.length){ctx.fillStyle=D.textMut;ctx.font='12px sans-serif';ctx.textAlign='center';ctx.fillText('Sem dados',W/2,H/2);return;}
    const mL=8,mR=8,mT=12,mB=40,cH=H-mT-mB,cW=W-mL-mR,mx=Math.max(1,...dados.map(d=>Math.max(d.v,d.m)));
    const gW=cW/dados.length,bW=Math.min(14,gW*.28);
    const t0=performance.now(),dur=800;
    const draw=now=>{
      if(aid!==this._anim)return;
      const pr=Math.min(1,(now-t0)/dur),e=1-Math.pow(1-pr,3);
      ctx.clearRect(0,0,W,H);
      for(let i=0;i<=4;i++){const y=mT+(cH/4)*i;ctx.strokeStyle='rgba(255,255,255,.05)';ctx.lineWidth=1;ctx.beginPath();ctx.moveTo(mL,y);ctx.lineTo(W-mR,y);ctx.stroke();}
      dados.forEach((d,i)=>{
        const cx2=mL+gW*i+gW/2,h1=(d.v/mx)*cH*e,h2=(d.m/mx)*cH*e;
        ctx.shadowColor=D.blue;ctx.shadowBlur=8;ctx.fillStyle=D.blue;ctx.beginPath();ctx.roundRect(cx2-bW-1,mT+cH-h1,bW,h1,[3,3,0,0]);ctx.fill();
        ctx.shadowColor=D.green;ctx.fillStyle=D.green;ctx.beginPath();ctx.roundRect(cx2+1,mT+cH-h2,bW,h2,[3,3,0,0]);ctx.fill();
        ctx.shadowBlur=0;
        ctx.fillStyle=D.textMut;ctx.font='9px Inter,sans-serif';ctx.textAlign='center';ctx.textBaseline='top';ctx.fillText(d.n,cx2,H-mB+6);
      });
      if(pr<1)requestAnimationFrame(draw);
    };
    requestAnimationFrame(draw);
  }

  _chartFisVsFin(calc,aid) {
    const cv=document.getElementById('dg-c4');if(!cv)return;
    const ctx=cv.getContext('2d'),dpr=window.devicePixelRatio||1,r=cv.getBoundingClientRect();
    cv.width=r.width*dpr;cv.height=r.height*dpr;ctx.scale(dpr,dpr);
    const W=r.width,H=r.height;
    const dados=calc.slice(0,10).map(o=>({n:(o.cfg?.apelido||o.apelido||o.nome||o.cfg?.objeto||'Obra').slice(0,10),f:o.c.pctFisico,fin:o.c.pctFinanceiro}));
    if(!dados.length){ctx.fillStyle=D.textMut;ctx.font='12px sans-serif';ctx.textAlign='center';ctx.fillText('Sem dados',W/2,H/2);return;}
    const mL=8,mR=8,mT=12,mB=40,cH=H-mT-mB,cW=W-mL-mR;
    const gW=cW/dados.length,bW=Math.min(14,gW*.28);
    const t0=performance.now(),dur=800;
    const draw=now=>{
      if(aid!==this._anim)return;
      const pr=Math.min(1,(now-t0)/dur),e=1-Math.pow(1-pr,3);
      ctx.clearRect(0,0,W,H);
      for(let i=0;i<=4;i++){const y=mT+(cH/4)*i;ctx.strokeStyle='rgba(255,255,255,.05)';ctx.lineWidth=1;ctx.beginPath();ctx.moveTo(mL,y);ctx.lineTo(W-mR,y);ctx.stroke();}
      dados.forEach((d,i)=>{
        const cx2=mL+gW*i+gW/2,h1=(d.f/100)*cH*e,h2=(d.fin/100)*cH*e;
        ctx.shadowColor=D.blue;ctx.shadowBlur=8;ctx.fillStyle=D.blue;ctx.beginPath();ctx.roundRect(cx2-bW-1,mT+cH-h1,bW,h1,[3,3,0,0]);ctx.fill();
        ctx.shadowColor=D.amber;ctx.fillStyle=D.amber;ctx.beginPath();ctx.roundRect(cx2+1,mT+cH-h2,bW,h2,[3,3,0,0]);ctx.fill();
        ctx.shadowBlur=0;
        ctx.fillStyle=D.textMut;ctx.font='9px Inter,sans-serif';ctx.textAlign='center';ctx.textBaseline='top';ctx.fillText(d.n,cx2,H-mB+6);
      });
      if(pr<1)requestAnimationFrame(draw);
    };
    requestAnimationFrame(draw);
  }

  /* ═════════════════ EVENTOS + GLOBALS ═══════════════════ */
  _bindEvents() {
    const reload=async()=>{try{if(router.current!=='dash-global')return;await this._carregarTudo();this._render();}catch(e){console.error('[DashGlobal] reload:',e);}};
    this._subs.push(
      EventBus.on('obra:criada',reload,'dash-global'),
      EventBus.on('boletim:atualizado',reload,'dash-global'),
      EventBus.on('config:salva',reload,'dash-global'),
      EventBus.on('itens:atualizados',reload,'dash-global'),
      EventBus.on('aditivos:changed',reload,'dash-global'),
    );
  }

  _exposeGlobals() {
    window.renderDashGlobal=()=>{try{this.onEnter();}catch(e){}};
    exposeGlobal('_dgTab',tab=>{try{this._render(tab);}catch(e){}});
    exposeGlobal('_dgFiltro',(campo,valor)=>{try{this._filtros[campo]=valor;this._render();}catch(e){}});
    exposeGlobal('_dgBusca',v=>{try{this._busca=v;this._render();}catch(e){}});
    exposeGlobal('_dgLimparFiltros',()=>{try{this._filtros={status:'',contratada:'',cidade:'',tipo:''};this._busca='';this._render();}catch(e){}});
    exposeGlobal('_dgRecarregar',async()=>{try{this._loading=true;this._render();await this._carregarTudo();this._render();}catch(e){console.error('[DashGlobal] _dgRecarregar:',e);this._loading=false;this._render();}});
    exposeGlobal('_dgAbrirObra',async obraId=>{try{state.set('obraAtivaId',obraId);state.persist?.(['obraAtivaId']);const[cfg,bms,itens]=await Promise.all([FirebaseService.getObraCfg(obraId).catch(()=>null),FirebaseService.getBMs(obraId).catch(()=>null),FirebaseService.getItens(obraId).catch(()=>null)]);if(cfg)state.set('cfg',cfg);if(bms&&bms.length)state.set('bms',bms);if(itens&&itens.length)state.set('itensContrato',itens);EventBus.emit('obra:selecionada',{obraId});router.navigate('dashboard');}catch(e){console.warn('[DashGlobal] _dgAbrirObra:',e);}});
  }

  destroy() { this._subs.forEach(u=>u()); this._subs=[]; }
}
