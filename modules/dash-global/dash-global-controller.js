/**
 * ╔══════════════════════════════════════════════════════════════╗
 * ║  FISCAL NA OBRA v16 — dash-global-controller.js             ║
 * ║  Dashboard Global de Gestão de Contratos de Obras Públicas  ║
 * ║  Visão executiva consolidada de múltiplas obras             ║
 * ╚══════════════════════════════════════════════════════════════╝
 *
 * Seções:
 *   1. KPIs Principais
 *   2. Status das Obras (Donut)
 *   3. Avanço Físico das Obras (Barras H)
 *   4. Financeiro — Contratado vs Executado (Barras V)
 *   5. Físico vs Financeiro — Comparativo
 *   6. Prazo e Cronograma — ranking atrasos
 *   7. Riscos e Alertas
 *   8. Empresas Contratadas
 *   9. Aditivos Contratuais
 *  10. Filtros + Tabela Resumo
 */

import EventBus        from '../../core/EventBus.js';
import state           from '../../core/state.js';
import router          from '../../core/router.js';
import { formatters }  from '../../utils/formatters.js';
import FirebaseService from '../../firebase/firebase-service.js';
import { exposeGlobal } from '../../utils/global-guard.js';
import {
  _injetarCacheMedicoes,
  getValorAcumuladoTotal,
} from '../boletim-medicao/bm-calculos.js';

/* ── Canvas polyfill roundRect ─────────────────────────────── */
if (typeof CanvasRenderingContext2D !== 'undefined' && !CanvasRenderingContext2D.prototype.roundRect) {
  CanvasRenderingContext2D.prototype.roundRect = function(x,y,w,h,r=0){
    const R=typeof r==='number'?[r,r,r,r]:r;
    this.moveTo(x+R[0],y);
    this.lineTo(x+w-R[1],y); this.quadraticCurveTo(x+w,y,x+w,y+R[1]);
    this.lineTo(x+w,y+h-R[2]); this.quadraticCurveTo(x+w,y+h,x+w-R[2],y+h);
    this.lineTo(x+R[3],y+h); this.quadraticCurveTo(x,y+h,x,y+h-R[3]);
    this.closePath(); return this;
  };
}

/* ── Helpers ────────────────────────────────────────────────── */
const R$  = v => (v||0).toLocaleString('pt-BR',{style:'currency',currency:'BRL'});
const pct = v => `${(parseFloat(v)||0).toFixed(1)}%`;
const esc = s => String(s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
const diffDias = iso => iso ? Math.ceil((new Date(iso+'T23:59:59')-new Date())/86400000) : null;

/* ── Paleta ─────────────────────────────────────────────────── */
const C = {
  blue:'#5B8ECC', green:'#4DBFA8', amber:'#F0A742', red:'#E05252',
  purple:'#9179E0', slate:'#8A94A6', cyan:'#0891b2', coral:'#E8785A',
  text:'#1E2A3B', muted:'#8A94A6', dim:'#A0AABB',
  surface:'#fff', border:'#E8EDF5', rowBg:'#F7F9FD',
};

/* ── Limites configuráveis (alertas) ───────────────────────── */
const ALERTA = {
  diasAtrasoLimite: 30,
  pctBaixoExecucao: 30,
  maxAditivos: 3,
  diasSemAtualizacao: 60,
  diasVencimentoProximo: 45,
};

export class DashGlobalModule {
  constructor() {
    this._subs    = [];
    this._obras   = [];
    this._filtros = { status:'', contratada:'', cidade:'', tipo:'' };
    this._busca   = '';
    this._loading = false;
    this._anim    = 0;
    this._tabAtual = 'visao'; // visao | prazo | financeiro | riscos | empresas | aditivos
  }

  async init() {
    try { this._bindEvents(); this._exposeGlobals(); }
    catch(e) { console.error('[DashGlobal] init:', e); }
  }

  async onEnter() {
    try { await this._carregarTudo(); this._render(); }
    catch(e) { console.error('[DashGlobal] onEnter:', e); }
  }

  /* ═══════════════════════════════════════════════════════════
   *  CARREGAMENTO DE DADOS
   * ═════════════════════════════════════════════════════════ */
  async _carregarTudo() {
    this._loading = true;
    try {
      const lista = await FirebaseService.getObrasLista() || [];
      this._obras = await Promise.all(lista.map(async obra => {
        try {
          const [cfg, bms, itens, aditivos, prorrs] = await Promise.all([
            FirebaseService.getObraCfg(obra.id).catch(() => null),
            FirebaseService.getBMs(obra.id).catch(() => []),
            FirebaseService.getItens(obra.id).catch(() => []),
            FirebaseService.getAditivos(obra.id).catch(() => []),
            FirebaseService.getProrrogacoes(obra.id).catch(() => []),
          ]);
          const bmList = bms || [];
          await Promise.all(bmList.map(bm =>
            FirebaseService.getMedicoes(obra.id, bm.num)
              .then(med => { if (med && Object.keys(med).length > 0) _injetarCacheMedicoes(obra.id, bm.num, med); })
              .catch(() => {})
          ));
          return { ...obra, cfg: cfg||{}, bms: bmList, itens: itens||[], aditivos: aditivos||[], prorrs: prorrs||[] };
        } catch { return { ...obra, cfg:{}, bms:[], itens:[], aditivos:[], prorrs:[] }; }
      }));
    } catch(e) {
      console.error('[DashGlobal] _carregarTudo:', e);
      this._obras = [];
    }
    this._loading = false;
  }

  /* ═══════════════════════════════════════════════════════════
   *  CÁLCULO POR OBRA
   * ═════════════════════════════════════════════════════════ */
  _calcObra(obra) {
    const cfg=obra.cfg||{}, bms=obra.bms||[], itens=obra.itens||[];
    const aditivos=obra.aditivos||[], prorrs=obra.prorrs||[];
    const hoje=new Date(), hoje0=new Date(hoje.toDateString());

    const ultimoBm = bms.slice().sort((a,b)=>(b.num||0)-(a.num||0))[0];
    const lastBmNum = ultimoBm?.num||0;

    // Valor executado
    let valorExec=0, pctFisico=0;
    if (itens.length>0 && lastBmNum>0) {
      valorExec = getValorAcumuladoTotal(obra.id, lastBmNum, itens, cfg);
      const vc = parseFloat(cfg.valor||0);
      pctFisico = vc>0 ? Math.min(100,(valorExec/vc)*100) : 0;
    } else {
      pctFisico = parseFloat(ultimoBm?.pctAcumFisico||ultimoBm?.percentualAcumulado||0);
      valorExec = parseFloat(ultimoBm?.valorAcumulado||0) || bms.reduce((s,b)=>s+parseFloat(b.valorMedicao||0),0);
    }
    const valorContr = parseFloat(cfg.valor||0);
    const saldo = Math.max(0, valorContr - valorExec);
    const pctFinanceiro = valorContr>0 ? Math.min(100,(valorExec/valorContr)*100) : 0;

    // Status
    const VALID = ['Em andamento','Paralisada','Concluída','Suspensa'];
    const raw = cfg.statusObra||cfg.status||obra.statusObra||obra.status||'';
    const statusAtual = VALID.includes(raw) ? raw : (obra.statusObra||'Em andamento');

    // Prazo
    const diasBasePrazo = parseInt(cfg.duracaoDias)||0;
    const diasProrr = prorrs.reduce((s,p)=>s+(parseInt(p.dias)||0),0);
    const diasTotal = diasBasePrazo + diasProrr;
    const inicio = cfg.inicioReal||cfg.inicioPrev||null;
    let dataFim = cfg.termino||null;
    if (inicio && diasTotal>0) {
      const d=new Date(inicio+'T12:00:00'); d.setDate(d.getDate()+diasTotal);
      dataFim = d.toISOString().slice(0,10);
    }
    const diasRestantes = diffDias(dataFim);
    const atrasada = dataFim && hoje0 > new Date(dataFim+'T23:59:59') && statusAtual!=='Concluída';
    const diasAtraso = atrasada && diasRestantes!==null ? Math.abs(diasRestantes) : 0;

    // % prazo decorrido
    let pctPrazo=0;
    if (inicio && dataFim) {
      const dtI=new Date(inicio+'T12:00:00'), dtF=new Date(dataFim+'T23:59:59');
      const tot=dtF-dtI;
      pctPrazo = tot>0 ? Math.max(0,Math.min(100,(hoje0-dtI)/tot*100)) : 0;
    }
    const statusExecucao = statusAtual==='Concluída'||statusAtual==='Paralisada'||statusAtual==='Suspensa'
      ? null
      : (atrasada||(pctPrazo>0&&(pctPrazo-pctFisico)>10)) ? 'ATRASADA' : 'DENTRO DO PRAZO';

    // Aditivos aprovados
    const aditivosAprov = aditivos.filter(a=>a.status==='Aprovado');
    const valorAditivos = aditivosAprov.reduce((s,a)=>s+(parseFloat(a.variacaoValor)||0),0);
    const pctAditivo = valorContr>0 ? (valorAditivos/valorContr)*100 : 0;

    // Última atualização (último BM)
    const ultimaAt = ultimoBm?.criadoEm||ultimoBm?.data||null;
    const diasSemAt = ultimaAt ? Math.max(0, Math.floor((hoje0-new Date(ultimaAt))/86400000)) : 999;

    // Cidade
    const cidade = cfg.municipio||cfg.cidade||obra.municipio||obra.cidade||'—';
    const tipoObra = cfg.tipo||obra.tipo||'—';

    return {
      pctFisico, pctFinanceiro, valorExec, valorContr, saldo,
      atrasada:!!(atrasada||statusExecucao==='ATRASADA'), diasAtraso,
      pctPrazo, diasRestantes, dataFim, statusExecucao, statusAtual,
      ultimoBm, aditivosAprov, valorAditivos, pctAditivo,
      diasSemAt, cidade, tipoObra,
    };
  }

  /* ═══════════════════════════════════════════════════════════
   *  FILTROS
   * ═════════════════════════════════════════════════════════ */
  _obrasVisiveis() {
    let lista = [...this._obras];
    const {status, contratada, cidade, tipo} = this._filtros;
    const busca = this._busca.trim().toLowerCase();
    if (status) lista = lista.filter(o=>this._calcObra(o).statusAtual===status);
    if (contratada) lista = lista.filter(o=>(o.cfg?.contratada||'').toLowerCase().includes(contratada.toLowerCase()));
    if (cidade) lista = lista.filter(o=>(o.cfg?.municipio||o.cfg?.cidade||o.municipio||o.cidade||'').toLowerCase().includes(cidade.toLowerCase()));
    if (tipo) lista = lista.filter(o=>(o.cfg?.tipo||o.tipo||'').toLowerCase().includes(tipo.toLowerCase()));
    if (busca) lista = lista.filter(o=>
      (o.cfg?.apelido||o.apelido||o.nome||o.cfg?.objeto||'').toLowerCase().includes(busca)||
      (o.cfg?.contrato||'').toLowerCase().includes(busca)||
      (o.cfg?.contratada||'').toLowerCase().includes(busca));
    return lista;
  }

  /* ═══════════════════════════════════════════════════════════
   *  RENDER PRINCIPAL
   * ═════════════════════════════════════════════════════════ */
  _render(tab) {
    if (tab) this._tabAtual = tab;
    const el = document.getElementById('dash-global-conteudo');
    if (!el) return;

    if (this._loading) {
      el.innerHTML = `<div style="display:flex;flex-direction:column;align-items:center;justify-content:center;min-height:300px;gap:14px;color:${C.muted}">
        <div style="width:36px;height:36px;border:3px solid #E8EDF5;border-top-color:${C.coral};border-radius:50%;animation:spin 0.8s linear infinite"></div>
        <div style="font-size:13px">Carregando dados das obras...</div>
        <style>@keyframes spin{to{transform:rotate(360deg)}}</style>
      </div>`;
      return;
    }

    const todas = this._obras;
    const visiveis = this._obrasVisiveis();
    const agora = new Date();

    /* Consolidação global */
    let totContr=0, totExec=0, totSaldo=0, totBMs=0;
    let nAtr=0, nConc=0, nAnd=0, nPar=0, nSus=0, nSem=0, nProx=0;
    let somaPctFis=0, somaPctFin=0, nComPct=0;
    let totAditivos=0, somaAditPct=0, nComAdt=0;
    const calc = [];

    todas.forEach(o => {
      const c = this._calcObra(o);
      const cfg=o.cfg||{}, bms=o.bms||[];
      totContr += c.valorContr;
      totExec  += c.valorExec;
      totSaldo += c.saldo;
      totBMs   += bms.length;
      if (c.atrasada) nAtr++;
      if (c.statusAtual==='Concluída') nConc++;
      else if (c.statusAtual==='Em andamento') nAnd++;
      else if (c.statusAtual==='Paralisada') nPar++;
      else if (c.statusAtual==='Suspensa') nSus++;
      if (bms.length===0) nSem++;
      if (c.pctFisico>=80 && c.pctFisico<100 && c.statusAtual!=='Concluída') nProx++;
      if (c.valorContr>0) { somaPctFis+=c.pctFisico; somaPctFin+=c.pctFinanceiro; nComPct++; }
      const na = (o.aditivos||[]).filter(a=>a.status==='Aprovado').length;
      totAditivos += na;
      if (na>0) { somaAditPct += c.pctAditivo; nComAdt++; }
      calc.push({...o, c});
    });
    const pctFisMed = nComPct>0 ? somaPctFis/nComPct : 0;
    const pctFinMed = nComPct>0 ? somaPctFin/nComPct : 0;
    const pctAdtMed = nComAdt>0 ? somaAditPct/nComAdt : 0;
    const pctExecGlobal = totContr>0 ? (totExec/totContr)*100 : 0;

    /* Opções de filtro */
    const statusOpts = ['Em andamento','Paralisada','Concluída','Suspensa'];
    const contratadas = [...new Set(todas.map(o=>o.cfg?.contratada||'').filter(Boolean))].sort();
    const cidades = [...new Set(todas.map(o=>o.cfg?.municipio||o.cfg?.cidade||o.municipio||o.cidade||'').filter(Boolean))].sort();

    /* Alertas */
    const alertas = this._gerarAlertas(calc);

    /* Tabs */
    const tabs = [
      {id:'visao',     icon:'📊', label:'Visão Geral'},
      {id:'financeiro',icon:'💰', label:'Financeiro'},
      {id:'prazo',     icon:'📅', label:'Prazos'},
      {id:'riscos',    icon:'⚠️',  label:`Alertas${alertas.length>0?` (${alertas.length})`:''}` },
      {id:'empresas',  icon:'🏢', label:'Empresas'},
      {id:'aditivos',  icon:'📋', label:'Aditivos'},
    ];
    const tabHtml = `<div style="display:flex;gap:2px;flex-wrap:wrap;border-bottom:2px solid #E8EDF5;margin-bottom:20px;padding-bottom:0">
      ${tabs.map(t=>`<button data-action="_dgTab" data-arg0="${t.id}"
        style="padding:9px 16px;border:none;background:none;cursor:pointer;font-size:12px;font-weight:700;
          color:${this._tabAtual===t.id?C.coral:C.muted};
          border-bottom:2px solid ${this._tabAtual===t.id?C.coral:'transparent'};
          margin-bottom:-2px;transition:all .15s;white-space:nowrap">${t.icon} ${t.label}</button>`).join('')}
    </div>`;

    el.innerHTML = `
    <div style="background:linear-gradient(135deg,#1E2A3B 0%,#2d3f57 100%);padding:20px 24px 16px;margin:-0px 0 0;border-radius:0">
      <div style="display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:10px">
        <div>
          <div style="font-size:20px;font-weight:900;color:#fff;letter-spacing:-.3px">Painel Executivo de Obras</div>
          <div style="font-size:11px;color:#8A94A6;margin-top:3px">
            ${todas.length} obra${todas.length!==1?'s':''} · Atualizado ${agora.toLocaleDateString('pt-BR',{day:'2-digit',month:'short',year:'numeric'})} às ${agora.toLocaleTimeString('pt-BR',{hour:'2-digit',minute:'2-digit'})}
          </div>
        </div>
        <button id="dg-btn-att" style="padding:9px 20px;background:${C.coral};border:none;border-radius:9px;
          color:#fff;font-size:12px;font-weight:700;cursor:pointer;display:flex;align-items:center;gap:6px;
          box-shadow:0 4px 14px rgba(232,120,90,.35)">🔃 Atualizar</button>
      </div>
    </div>

    <div style="padding:20px 24px">

      <!-- KPIs -->
      <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(155px,1fr));gap:10px;margin-bottom:24px">
        ${this._kpi('🏗️','Contratos Ativos',String(nAnd+nSus+nPar),'em execução',C.cyan)}
        ${this._kpi('💼','Valor Contratado',R$(totContr),'total dos contratos',C.blue)}
        ${this._kpi('💰','Valor Executado',R$(totExec),'medido acumulado',C.green)}
        ${this._kpi('📦','Saldo a Executar',R$(totSaldo),'restante',C.slate)}
        ${this._kpi('📊','Exec. Física Média',pct(pctFisMed),'avg % físico',C.purple)}
        ${this._kpi('💳','Exec. Financ. Média',pct(pctFinMed),'avg % financeiro',C.amber)}
        ${this._kpi('⏰','Em Atraso',String(nAtr),nAtr>0?'atenção!':'todas no prazo',nAtr>0?C.red:C.slate)}
        ${this._kpi('🚫','Paralisadas',String(nPar),nPar>0?'verificar':'nenhuma',nPar>0?C.amber:C.slate)}
        ${this._kpi('🏆','Concluídas',String(nConc),'obras finalizadas',C.green)}
        ${this._kpi('⚠️','Alertas Ativos',String(alertas.length),alertas.length>0?'requerem atenção':'tudo ok',alertas.length>0?C.red:C.slate)}
      </div>

      <!-- Tabs de seção -->
      ${tabHtml}

      <!-- Conteúdo da aba -->
      <div id="dg-tab-content">
        ${this._tabAtual==='visao'      ? this._htmlVisao(calc,nSem,nAnd,nProx,nConc,nPar,nSus)          : ''}
        ${this._tabAtual==='financeiro' ? this._htmlFinanceiro(calc,totContr,totExec,pctExecGlobal)       : ''}
        ${this._tabAtual==='prazo'      ? this._htmlPrazo(calc)                                           : ''}
        ${this._tabAtual==='riscos'     ? this._htmlRiscos(alertas)                                       : ''}
        ${this._tabAtual==='empresas'   ? this._htmlEmpresas(calc)                                        : ''}
        ${this._tabAtual==='aditivos'   ? this._htmlAditivos(calc,totAditivos,pctAdtMed)                  : ''}
      </div>

      <!-- Filtros + Tabela -->
      <div style="margin-top:28px">
        <div style="font-size:11px;font-weight:800;text-transform:uppercase;letter-spacing:.6px;color:${C.muted};margin-bottom:10px">
          <span style="color:${C.amber}">◆</span> TABELA RESUMO GLOBAL
        </div>
        ${this._htmlFiltros(statusOpts,contratadas,cidades,visiveis.length,todas.length)}
        ${this._htmlTabela(visiveis)}
      </div>
    </div>`;

    document.getElementById('dg-btn-att')?.addEventListener('click', ()=>window._dgRecarregar());

    /* Desenhar gráficos após render */
    this._anim++;
    const aid = this._anim;
    requestAnimationFrame(() => {
      if (aid!==this._anim) return;
      if (this._tabAtual==='visao') {
        try { this._chartAvancoH(calc, aid); } catch(e){}
        try { this._chartDonut(nSem,nAnd,nProx,nConc,nPar,nSus, aid); } catch(e){}
      }
      if (this._tabAtual==='financeiro') {
        try { this._chartFinancieroV(calc, aid); } catch(e){}
        try { this._chartFisVsFin(calc, aid); } catch(e){}
      }
    });
  }

  /* ═══════════════════════════════════════════════════════════
   *  KPI CARD
   * ═════════════════════════════════════════════════════════ */
  _kpi(ico,lbl,val,sub,cor) {
    return `<div style="background:#fff;border:1px solid #E8EDF5;border-radius:12px;padding:14px 16px;border-top:3px solid ${cor};box-shadow:0 2px 10px rgba(100,130,200,.06);transition:box-shadow .2s" onmouseover="this.style.boxShadow='0 6px 20px rgba(100,130,200,.14)'" onmouseout="this.style.boxShadow='0 2px 10px rgba(100,130,200,.06)'">
      <div style="display:flex;align-items:center;gap:6px;margin-bottom:8px">
        <span style="font-size:16px">${ico}</span>
        <span style="font-size:9px;font-weight:700;color:${C.muted};text-transform:uppercase;letter-spacing:.5px">${lbl}</span>
      </div>
      <div style="font-size:17px;font-weight:900;color:${cor};font-family:var(--font-mono,monospace);line-height:1">${val}</div>
      <div style="font-size:9px;color:${C.dim};margin-top:4px">${sub}</div>
    </div>`;
  }

  /* ═══════════════════════════════════════════════════════════
   *  ABA VISÃO GERAL
   * ═════════════════════════════════════════════════════════ */
  _htmlVisao(calc, nSem, nAnd, nProx, nConc, nPar, nSus) {
    return `<div style="display:grid;grid-template-columns:1fr 1fr;gap:16px;margin-bottom:0">
      <div style="background:#fff;border:1px solid #E8EDF5;border-radius:14px;padding:18px;box-shadow:0 2px 12px rgba(100,130,200,.07)">
        <div style="font-size:11px;font-weight:800;color:${C.muted};text-transform:uppercase;letter-spacing:.5px;margin-bottom:14px"><span style="color:${C.green}">◆</span> AVANÇO FÍSICO DAS OBRAS</div>
        <canvas id="dg-c1" style="width:100%;height:260px;display:block"></canvas>
      </div>
      <div style="background:#fff;border:1px solid #E8EDF5;border-radius:14px;padding:18px;box-shadow:0 2px 12px rgba(100,130,200,.07)">
        <div style="font-size:11px;font-weight:800;color:${C.muted};text-transform:uppercase;letter-spacing:.5px;margin-bottom:14px"><span style="color:${C.purple}">◆</span> SITUAÇÃO DAS OBRAS</div>
        <canvas id="dg-c3" style="width:100%;height:200px;display:block"></canvas>
        <div id="dg-leg" style="margin-top:10px;display:flex;flex-wrap:wrap;gap:6px 16px;justify-content:center"></div>
      </div>
    </div>`;
  }

  /* ═══════════════════════════════════════════════════════════
   *  ABA FINANCEIRO
   * ═════════════════════════════════════════════════════════ */
  _htmlFinanceiro(calc, totContr, totExec, pctExecGlobal) {
    const totSaldo = totContr - totExec;
    const corPct = pctExecGlobal>=80?C.green:pctExecGlobal>=40?C.amber:C.red;
    return `
    <!-- KPIs financeiros -->
    <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(180px,1fr));gap:10px;margin-bottom:18px">
      <div style="background:#dbeafe;border:1px solid #93c5fd;border-radius:10px;padding:14px;text-align:center">
        <div style="font-size:9px;color:#1d4ed8;text-transform:uppercase;font-weight:700">Total Contratado</div>
        <div style="font-size:16px;font-weight:900;color:#1d4ed8;font-family:monospace;margin-top:4px">${R$(totContr)}</div>
      </div>
      <div style="background:#dcfce7;border:1px solid #86efac;border-radius:10px;padding:14px;text-align:center">
        <div style="font-size:9px;color:#15803d;text-transform:uppercase;font-weight:700">Total Executado</div>
        <div style="font-size:16px;font-weight:900;color:#15803d;font-family:monospace;margin-top:4px">${R$(totExec)}</div>
      </div>
      <div style="background:#f3f4f6;border:1px solid #d1d5db;border-radius:10px;padding:14px;text-align:center">
        <div style="font-size:9px;color:#374151;text-transform:uppercase;font-weight:700">Saldo a Executar</div>
        <div style="font-size:16px;font-weight:900;color:#374151;font-family:monospace;margin-top:4px">${R$(Math.max(0,totSaldo))}</div>
      </div>
      <div style="background:${corPct}18;border:1px solid ${corPct}44;border-radius:10px;padding:14px;text-align:center">
        <div style="font-size:9px;color:${corPct};text-transform:uppercase;font-weight:700">Execução Global</div>
        <div style="font-size:24px;font-weight:900;color:${corPct};margin-top:2px">${pct(pctExecGlobal)}</div>
      </div>
    </div>
    <!-- Gráficos -->
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:16px">
      <div style="background:#fff;border:1px solid #E8EDF5;border-radius:14px;padding:18px;box-shadow:0 2px 12px rgba(100,130,200,.07)">
        <div style="font-size:11px;font-weight:800;color:${C.muted};text-transform:uppercase;letter-spacing:.5px;margin-bottom:12px"><span style="color:${C.blue}">◆</span> CONTRATADO vs EXECUTADO POR OBRA</div>
        <canvas id="dg-c2" style="width:100%;height:260px;display:block"></canvas>
        <div style="display:flex;gap:14px;justify-content:center;margin-top:8px;font-size:10px">
          <span style="display:flex;align-items:center;gap:5px"><span style="width:10px;height:10px;background:${C.blue};border-radius:2px;display:inline-block"></span>Contratado</span>
          <span style="display:flex;align-items:center;gap:5px"><span style="width:10px;height:10px;background:${C.green};border-radius:2px;display:inline-block"></span>Executado</span>
        </div>
      </div>
      <div style="background:#fff;border:1px solid #E8EDF5;border-radius:14px;padding:18px;box-shadow:0 2px 12px rgba(100,130,200,.07)">
        <div style="font-size:11px;font-weight:800;color:${C.muted};text-transform:uppercase;letter-spacing:.5px;margin-bottom:12px"><span style="color:${C.purple}">◆</span> FÍSICO vs FINANCEIRO (%)</div>
        <canvas id="dg-c4" style="width:100%;height:260px;display:block"></canvas>
        <div style="display:flex;gap:14px;justify-content:center;margin-top:8px;font-size:10px">
          <span style="display:flex;align-items:center;gap:5px"><span style="width:10px;height:10px;background:${C.blue};border-radius:2px;display:inline-block"></span>% Físico</span>
          <span style="display:flex;align-items:center;gap:5px"><span style="width:10px;height:10px;background:${C.amber};border-radius:2px;display:inline-block"></span>% Financeiro</span>
        </div>
      </div>
    </div>`;
  }

  /* ═══════════════════════════════════════════════════════════
   *  ABA PRAZO
   * ═════════════════════════════════════════════════════════ */
  _htmlPrazo(calc) {
    const comPrazo = calc.filter(o=>o.c.dataFim).map(o=>{
      const dr = o.c.diasRestantes;
      return {...o, _dr: dr};
    }).sort((a,b)=>(a._dr??9999)-(b._dr??9999));

    const vencidas   = comPrazo.filter(o=>o.c.atrasada && o.c.statusAtual!=='Concluída');
    const proximas   = comPrazo.filter(o=>!o.c.atrasada && o._dr!==null && o._dr<=ALERTA.diasVencimentoProximo && o.c.statusAtual!=='Concluída');
    const emDia      = comPrazo.filter(o=>!o.c.atrasada && (o._dr===null||o._dr>ALERTA.diasVencimentoProximo) && o.c.statusAtual!=='Concluída');

    const rowPrazo = o => {
      const c=o.c, cfg=o.cfg||{};
      const nome=(cfg.apelido||o.apelido||o.nome||cfg.objeto||'Obra').slice(0,30);
      const dr=o._dr;
      let badge, corLinha='';
      if (c.atrasada) { badge=`<span style="background:#fee2e2;color:#b91c1c;border:1px solid #fca5a5;padding:2px 7px;border-radius:4px;font-size:10px;font-weight:700">🔴 ${c.diasAtraso}d atraso</span>`; corLinha='background:#fff5f5'; }
      else if (dr!==null && dr<=ALERTA.diasVencimentoProximo) { badge=`<span style="background:#fef3c7;color:#92400e;border:1px solid #fde68a;padding:2px 7px;border-radius:4px;font-size:10px;font-weight:700">⚠️ ${dr}d restantes</span>`; corLinha='background:#fffbeb'; }
      else { badge=`<span style="background:#dcfce7;color:#15803d;border:1px solid #86efac;padding:2px 7px;border-radius:4px;font-size:10px;font-weight:700">✅ ${dr!==null?dr+'d':'—'}</span>`; }
      const dtFim = c.dataFim ? new Date(c.dataFim+'T12:00:00').toLocaleDateString('pt-BR') : '—';
      const prorrs = (o.prorrs||[]).length;
      return `<tr style="${corLinha}">
        <td style="padding:8px 10px;font-weight:600;max-width:200px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap" title="${esc(nome)}">${esc(nome)}</td>
        <td style="padding:8px 10px;text-align:center;font-size:11px">${dtFim}</td>
        <td style="padding:8px 10px;text-align:center">${badge}</td>
        <td style="padding:8px 10px;text-align:center;font-size:11px">${prorrs>0?`<span style="color:${C.amber};font-weight:700">+${prorrs} prorr.</span>`:'—'}</td>
        <td style="padding:8px 10px;text-align:center;font-size:11px">${pct(c.pctFisico)}</td>
        <td style="padding:8px 10px;text-align:center">
          <button data-action="_dgAbrirObra" data-arg0="${o.id}" style="padding:3px 10px;font-size:10px;background:${C.coral};border:none;border-radius:6px;color:#fff;cursor:pointer;font-weight:700">Abrir</button>
        </td>
      </tr>`;
    };

    return `
    <!-- KPIs prazo -->
    <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(150px,1fr));gap:10px;margin-bottom:16px">
      <div style="background:#fee2e2;border:1px solid #fca5a5;border-radius:10px;padding:12px;text-align:center">
        <div style="font-size:9px;color:#b91c1c;text-transform:uppercase;font-weight:700">Prazo Vencido</div>
        <div style="font-size:24px;font-weight:900;color:#b91c1c">${vencidas.length}</div>
      </div>
      <div style="background:#fef3c7;border:1px solid #fde68a;border-radius:10px;padding:12px;text-align:center">
        <div style="font-size:9px;color:#92400e;text-transform:uppercase;font-weight:700">Vence em ${ALERTA.diasVencimentoProximo}d</div>
        <div style="font-size:24px;font-weight:900;color:#92400e">${proximas.length}</div>
      </div>
      <div style="background:#dcfce7;border:1px solid #86efac;border-radius:10px;padding:12px;text-align:center">
        <div style="font-size:9px;color:#15803d;text-transform:uppercase;font-weight:700">Em Dia</div>
        <div style="font-size:24px;font-weight:900;color:#15803d">${emDia.length}</div>
      </div>
      <div style="background:#f3f4f6;border:1px solid #d1d5db;border-radius:10px;padding:12px;text-align:center">
        <div style="font-size:9px;color:#374151;text-transform:uppercase;font-weight:700">Sem Prazo Def.</div>
        <div style="font-size:24px;font-weight:900;color:#374151">${calc.length-comPrazo.length}</div>
      </div>
    </div>
    <!-- Tabela ranking -->
    <div style="overflow-x:auto;border:1px solid #E8EDF5;border-radius:14px;box-shadow:0 2px 12px rgba(100,130,200,.07)">
      <table class="dg-tbl" style="width:100%;border-collapse:collapse;font-size:12px">
        <thead><tr>
          <th style="padding:9px 10px;text-align:left;white-space:nowrap">Obra</th>
          <th style="padding:9px 10px;text-align:center;white-space:nowrap">Término</th>
          <th style="padding:9px 10px;text-align:center;white-space:nowrap">Situação</th>
          <th style="padding:9px 10px;text-align:center;white-space:nowrap">Prorrogações</th>
          <th style="padding:9px 10px;text-align:center;white-space:nowrap">% Físico</th>
          <th style="padding:9px 10px;text-align:center;white-space:nowrap"></th>
        </tr></thead>
        <tbody>
          ${vencidas.map(rowPrazo).join('')}
          ${proximas.map(rowPrazo).join('')}
          ${emDia.map(rowPrazo).join('')}
          ${calc.filter(o=>!o.c.dataFim).map(o=>`<tr style="opacity:.5"><td style="padding:8px 10px;font-size:11px">${esc((o.cfg?.apelido||o.nome||'Obra').slice(0,30))}</td><td colspan="4" style="padding:8px 10px;font-size:11px;color:${C.muted}">Prazo não configurado</td><td></td></tr>`).join('')}
        </tbody>
      </table>
    </div>`;
  }

  /* ═══════════════════════════════════════════════════════════
   *  ABA RISCOS / ALERTAS
   * ═════════════════════════════════════════════════════════ */
  _gerarAlertas(calc) {
    const alertas = [];
    calc.forEach(o => {
      const c=o.c, cfg=o.cfg||{};
      const nome=(cfg.apelido||o.apelido||o.nome||cfg.objeto||'Obra').slice(0,35);
      if (c.atrasada && c.diasAtraso > ALERTA.diasAtrasoLimite)
        alertas.push({nivel:'critico', obraId:o.id, obra:nome, tipo:'Atraso crítico', desc:`${c.diasAtraso} dias de atraso (limite: ${ALERTA.diasAtrasoLimite}d)`});
      if (c.pctFisico < ALERTA.pctBaixoExecucao && c.pctPrazo > 20 && c.statusAtual==='Em andamento')
        alertas.push({nivel:'alerta', obraId:o.id, obra:nome, tipo:'Execução baixa', desc:`${pct(c.pctFisico)} executado com ${pct(c.pctPrazo)} do prazo decorrido`});
      if (c.aditivosAprov.length > ALERTA.maxAditivos)
        alertas.push({nivel:'aviso', obraId:o.id, obra:nome, tipo:'Muitos aditivos', desc:`${c.aditivosAprov.length} aditivos aprovados (limite sugerido: ${ALERTA.maxAditivos})`});
      if (c.diasSemAt > ALERTA.diasSemAtualizacao && c.statusAtual==='Em andamento')
        alertas.push({nivel:'aviso', obraId:o.id, obra:nome, tipo:'Sem atualização', desc:`Último BM há ${c.diasSemAt} dias (limite: ${ALERTA.diasSemAtualizacao}d)`});
      if (c.diasRestantes!==null && c.diasRestantes>0 && c.diasRestantes<=ALERTA.diasVencimentoProximo && c.statusAtual!=='Concluída')
        alertas.push({nivel:'aviso', obraId:o.id, obra:nome, tipo:'Prazo próximo', desc:`Vence em ${c.diasRestantes} dias`});
      if (c.pctFinanceiro > c.pctFisico + 15 && c.pctFisico > 5)
        alertas.push({nivel:'alerta', obraId:o.id, obra:nome, tipo:'Pagamento adiantado', desc:`Financeiro (${pct(c.pctFinanceiro)}) > Físico (${pct(c.pctFisico)}) em mais de 15pp`});
    });
    return alertas.sort((a,b)=>({critico:0,alerta:1,aviso:2}[a.nivel]||3)-({critico:0,alerta:1,aviso:2}[b.nivel]||3));
  }

  _htmlRiscos(alertas) {
    const cores = { critico:{bg:'#fee2e2',brd:'#fca5a5',tx:'#b91c1c',ico:'🔴'}, alerta:{bg:'#fef3c7',brd:'#fde68a',tx:'#92400e',ico:'⚠️'}, aviso:{bg:'#dbeafe',brd:'#93c5fd',tx:'#1d4ed8',ico:'💡'} };
    const nCrit  = alertas.filter(a=>a.nivel==='critico').length;
    const nAlerta = alertas.filter(a=>a.nivel==='alerta').length;
    const nAviso  = alertas.filter(a=>a.nivel==='aviso').length;
    return `
    <div style="display:grid;grid-template-columns:repeat(3,1fr);gap:10px;margin-bottom:16px">
      <div style="background:#fee2e2;border:1px solid #fca5a5;border-radius:10px;padding:12px;text-align:center">
        <div style="font-size:9px;color:#b91c1c;text-transform:uppercase;font-weight:700">🔴 Críticos</div>
        <div style="font-size:28px;font-weight:900;color:#b91c1c">${nCrit}</div>
      </div>
      <div style="background:#fef3c7;border:1px solid #fde68a;border-radius:10px;padding:12px;text-align:center">
        <div style="font-size:9px;color:#92400e;text-transform:uppercase;font-weight:700">⚠️ Alertas</div>
        <div style="font-size:28px;font-weight:900;color:#92400e">${nAlerta}</div>
      </div>
      <div style="background:#dbeafe;border:1px solid #93c5fd;border-radius:10px;padding:12px;text-align:center">
        <div style="font-size:9px;color:#1d4ed8;text-transform:uppercase;font-weight:700">💡 Avisos</div>
        <div style="font-size:28px;font-weight:900;color:#1d4ed8">${nAviso}</div>
      </div>
    </div>
    ${alertas.length===0
      ? `<div style="text-align:center;padding:40px;color:${C.muted}"><div style="font-size:32px;margin-bottom:8px">✅</div><div style="font-size:14px;font-weight:700">Nenhum alerta ativo</div><div style="font-size:11px;margin-top:4px">Todas as obras dentro dos parâmetros configurados.</div></div>`
      : `<div style="display:flex;flex-direction:column;gap:8px">
          ${alertas.map(a=>{
            const cor=cores[a.nivel]||cores.aviso;
            return `<div style="display:flex;align-items:center;gap:12px;padding:12px 16px;background:${cor.bg};border:1px solid ${cor.brd};border-radius:10px">
              <span style="font-size:18px;flex-shrink:0">${cor.ico}</span>
              <div style="flex:1;min-width:0">
                <div style="font-size:11px;font-weight:700;color:${cor.tx}">${esc(a.tipo)}</div>
                <div style="font-size:12px;font-weight:600;color:${C.text};white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${esc(a.obra)}</div>
                <div style="font-size:11px;color:${C.muted};margin-top:1px">${esc(a.desc)}</div>
              </div>
              <button data-action="_dgAbrirObra" data-arg0="${a.obraId}" style="flex-shrink:0;padding:5px 12px;font-size:10px;background:${cor.tx};border:none;border-radius:6px;color:#fff;cursor:pointer;font-weight:700">Ver obra</button>
            </div>`;
          }).join('')}
        </div>`}`;
  }

  /* ═══════════════════════════════════════════════════════════
   *  ABA EMPRESAS
   * ═════════════════════════════════════════════════════════ */
  _htmlEmpresas(calc) {
    const map = {};
    calc.forEach(o => {
      const cfg=o.cfg||{}, c=o.c;
      const emp=(cfg.contratada||'Não informada').trim();
      if (!map[emp]) map[emp]={nome:emp,nContratos:0,valorTotal:0,valorExec:0,nAtrasadas:0,soma_pct:0,n_pct:0};
      map[emp].nContratos++;
      map[emp].valorTotal += c.valorContr;
      map[emp].valorExec  += c.valorExec;
      if (c.atrasada) map[emp].nAtrasadas++;
      if (c.valorContr>0) { map[emp].soma_pct+=c.pctFisico; map[emp].n_pct++; }
    });
    const empresas = Object.values(map)
      .map(e=>({...e, pctMedExec: e.n_pct>0?e.soma_pct/e.n_pct:0, pctExecFin: e.valorTotal>0?(e.valorExec/e.valorTotal)*100:0}))
      .sort((a,b)=>b.valorTotal-a.valorTotal);

    if (!empresas.length) return `<div style="text-align:center;padding:40px;color:${C.muted}">Nenhuma empresa cadastrada.</div>`;

    return `<div style="overflow-x:auto;border:1px solid #E8EDF5;border-radius:14px;box-shadow:0 2px 12px rgba(100,130,200,.07)">
      <table class="dg-tbl" style="width:100%;border-collapse:collapse;font-size:12px">
        <thead><tr>
          <th style="padding:9px 12px;text-align:left">Empresa Contratada</th>
          <th style="padding:9px 12px;text-align:center">Contratos</th>
          <th style="padding:9px 12px;text-align:right">Valor Total</th>
          <th style="padding:9px 12px;text-align:right">Valor Exec.</th>
          <th style="padding:9px 12px;text-align:center">% Exec. Média</th>
          <th style="padding:9px 12px;text-align:center">Em Atraso</th>
          <th style="padding:9px 12px;text-align:center">Performance</th>
        </tr></thead>
        <tbody>
          ${empresas.map((e,i)=>{
            const perf = e.nAtrasadas===0&&e.pctMedExec>50?'✅ Boa':e.nAtrasadas>0?'⚠️ Atenção':'🔵 Regular';
            const perfCor = e.nAtrasadas===0&&e.pctMedExec>50?C.green:e.nAtrasadas>0?C.amber:C.blue;
            const bc = e.pctMedExec>=80?C.green:e.pctMedExec>=40?C.amber:C.red;
            return `<tr>
              <td style="padding:9px 12px;font-weight:700">
                <div style="display:flex;align-items:center;gap:8px">
                  <span style="width:22px;height:22px;border-radius:50%;background:${C.blue}18;color:${C.blue};font-size:10px;font-weight:900;display:flex;align-items:center;justify-content:center;flex-shrink:0">${i+1}</span>
                  ${esc(e.nome.slice(0,35))}
                </div>
              </td>
              <td style="padding:9px 12px;text-align:center;font-weight:700">${e.nContratos}</td>
              <td style="padding:9px 12px;text-align:right;font-family:monospace;font-size:11px">${R$(e.valorTotal)}</td>
              <td style="padding:9px 12px;text-align:right;font-family:monospace;font-size:11px;color:${C.green}">${R$(e.valorExec)}</td>
              <td style="padding:9px 12px;min-width:100px">
                <div style="display:flex;justify-content:space-between;font-size:9px;margin-bottom:3px"><span>Exec.</span><span style="font-weight:700;color:${bc}">${pct(e.pctMedExec)}</span></div>
                <div style="height:6px;background:#E8EDF5;border-radius:3px;overflow:hidden"><div style="height:6px;background:${bc};width:${Math.min(100,e.pctMedExec)}%;border-radius:3px"></div></div>
              </td>
              <td style="padding:9px 12px;text-align:center">
                ${e.nAtrasadas>0?`<span style="color:${C.red};font-weight:700">${e.nAtrasadas}</span>`:`<span style="color:${C.green}">0</span>`}
              </td>
              <td style="padding:9px 12px;text-align:center">
                <span style="background:${perfCor}18;color:${perfCor};border:1px solid ${perfCor}44;padding:2px 8px;border-radius:5px;font-size:10px;font-weight:700">${perf}</span>
              </td>
            </tr>`;
          }).join('')}
        </tbody>
      </table>
    </div>`;
  }

  /* ═══════════════════════════════════════════════════════════
   *  ABA ADITIVOS
   * ═════════════════════════════════════════════════════════ */
  _htmlAditivos(calc, totAditivos, pctAdtMed) {
    const comAdt = calc.filter(o=>o.c.aditivosAprov.length>0)
      .sort((a,b)=>b.c.pctAditivo-a.c.pctAditivo);

    // Contagem por tipo
    const tiposCnt = {};
    calc.forEach(o => {
      (o.aditivos||[]).filter(a=>a.status==='Aprovado').forEach(a=>{
        const t=a.tipo||'outro';
        tiposCnt[t]=(tiposCnt[t]||0)+1;
      });
    });
    const tipoLabels = {prazo:'⏱️ Prazo',valor:'💰 Valor',planilha:'📋 Planilha',misto:'⏱️💰 Misto'};

    return `
    <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(150px,1fr));gap:10px;margin-bottom:18px">
      <div style="background:#dbeafe;border:1px solid #93c5fd;border-radius:10px;padding:12px;text-align:center">
        <div style="font-size:9px;color:#1d4ed8;text-transform:uppercase;font-weight:700">Total de Aditivos</div>
        <div style="font-size:28px;font-weight:900;color:#1d4ed8">${totAditivos}</div>
      </div>
      <div style="background:#e9d5ff;border:1px solid #d8b4fe;border-radius:10px;padding:12px;text-align:center">
        <div style="font-size:9px;color:#6d28d9;text-transform:uppercase;font-weight:700">Obras com Aditivo</div>
        <div style="font-size:28px;font-weight:900;color:#6d28d9">${comAdt.length}</div>
      </div>
      <div style="background:#fef3c7;border:1px solid #fde68a;border-radius:10px;padding:12px;text-align:center">
        <div style="font-size:9px;color:#92400e;text-transform:uppercase;font-weight:700">Acréscimo Médio</div>
        <div style="font-size:24px;font-weight:900;color:#92400e">${pct(pctAdtMed)}</div>
      </div>
      ${Object.entries(tiposCnt).map(([k,v])=>`
        <div style="background:#f3f4f6;border:1px solid #d1d5db;border-radius:10px;padding:12px;text-align:center">
          <div style="font-size:9px;color:#374151;text-transform:uppercase;font-weight:700">${tipoLabels[k]||k}</div>
          <div style="font-size:24px;font-weight:900;color:#374151">${v}</div>
        </div>`).join('')}
    </div>
    ${comAdt.length===0
      ? `<div style="text-align:center;padding:32px;color:${C.muted}">Nenhum aditivo aprovado registrado.</div>`
      : `<div style="overflow-x:auto;border:1px solid #E8EDF5;border-radius:14px;box-shadow:0 2px 12px rgba(100,130,200,.07)">
          <table class="dg-tbl" style="width:100%;border-collapse:collapse;font-size:12px">
            <thead><tr>
              <th style="padding:9px 12px;text-align:left">Obra</th>
              <th style="padding:9px 12px;text-align:center">Qtd Aditivos</th>
              <th style="padding:9px 12px;text-align:right">Valor Original</th>
              <th style="padding:9px 12px;text-align:right">Variação</th>
              <th style="padding:9px 12px;text-align:center">% Acréscimo</th>
              <th style="padding:9px 12px;text-align:center"></th>
            </tr></thead>
            <tbody>
              ${comAdt.map(o=>{
                const c=o.c, cfg=o.cfg||{};
                const nome=(cfg.apelido||o.apelido||o.nome||cfg.objeto||'Obra').slice(0,35);
                const pctA=c.pctAditivo;
                const corA=pctA>25?C.red:pctA>10?C.amber:C.green;
                return `<tr>
                  <td style="padding:8px 12px;font-weight:600;max-width:220px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap" title="${esc(nome)}">${esc(nome)}</td>
                  <td style="padding:8px 12px;text-align:center;font-weight:700;color:${C.blue}">${c.aditivosAprov.length}</td>
                  <td style="padding:8px 12px;text-align:right;font-family:monospace;font-size:11px">${R$(c.valorContr)}</td>
                  <td style="padding:8px 12px;text-align:right;font-family:monospace;font-size:11px;color:${c.valorAditivos>=0?C.green:C.red}">${c.valorAditivos>=0?'+':''}${R$(c.valorAditivos)}</td>
                  <td style="padding:8px 12px;min-width:100px">
                    <div style="display:flex;justify-content:space-between;font-size:9px;margin-bottom:3px"><span>Acrésimo</span><span style="font-weight:700;color:${corA}">${pct(pctA)}</span></div>
                    <div style="height:6px;background:#E8EDF5;border-radius:3px;overflow:hidden"><div style="height:6px;background:${corA};width:${Math.min(100,pctA*2)}%;border-radius:3px"></div></div>
                  </td>
                  <td style="padding:8px 12px;text-align:center">
                    <button data-action="_dgAbrirObra" data-arg0="${o.id}" style="padding:3px 10px;font-size:10px;background:${C.coral};border:none;border-radius:6px;color:#fff;cursor:pointer;font-weight:700">Abrir</button>
                  </td>
                </tr>`;
              }).join('')}
            </tbody>
          </table>
        </div>`}`;
  }

  /* ═══════════════════════════════════════════════════════════
   *  FILTROS
   * ═════════════════════════════════════════════════════════ */
  _htmlFiltros(statusOpts, contratadas, cidades, nVis, nTot) {
    return `<div style="background:#fff;border:1px solid #E8EDF5;border-radius:12px;padding:14px 16px;margin-bottom:12px;box-shadow:0 2px 10px rgba(100,130,200,.06)">
      <div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap">
        <input id="dg-busca" type="text" placeholder="🔍 Buscar obra, contrato ou empresa..." value="${esc(this._busca)}"
          oninput="window._dgBusca(this.value)"
          style="flex:1;min-width:200px;padding:8px 12px;border:1px solid #E8EDF5;border-radius:8px;background:#F7F9FD;color:#1E2A3B;font-size:12px;outline:none">
        <select onchange="window._dgFiltro('status',this.value)" style="padding:8px 10px;border:1px solid #E8EDF5;border-radius:8px;background:#F7F9FD;color:#1E2A3B;font-size:11px">
          <option value="">Todos os status</option>
          ${statusOpts.map(s=>`<option value="${s}" ${this._filtros.status===s?'selected':''}>${s}</option>`).join('')}
        </select>
        <select onchange="window._dgFiltro('contratada',this.value)" style="padding:8px 10px;border:1px solid #E8EDF5;border-radius:8px;background:#F7F9FD;color:#1E2A3B;font-size:11px;max-width:200px">
          <option value="">Todas empresas</option>
          ${contratadas.map(c=>`<option value="${c}" ${this._filtros.contratada===c?'selected':''}>${c.slice(0,30)}</option>`).join('')}
        </select>
        <select onchange="window._dgFiltro('cidade',this.value)" style="padding:8px 10px;border:1px solid #E8EDF5;border-radius:8px;background:#F7F9FD;color:#1E2A3B;font-size:11px">
          <option value="">Todas cidades</option>
          ${cidades.map(c=>`<option value="${c}" ${this._filtros.cidade===c?'selected':''}>${c.slice(0,25)}</option>`).join('')}
        </select>
        <button data-action="_dgLimparFiltros" style="padding:8px 12px;background:transparent;border:1px solid #E8EDF5;border-radius:8px;color:#8A94A6;font-size:11px;cursor:pointer">✕ Limpar</button>
      </div>
      <div style="font-size:10px;color:#A0AABB;margin-top:6px">Exibindo <strong style="color:#1E2A3B">${nVis}</strong> de ${nTot} obra${nTot!==1?'s':''}</div>
    </div>`;
  }

  /* ═══════════════════════════════════════════════════════════
   *  TABELA RESUMO
   * ═════════════════════════════════════════════════════════ */
  _htmlTabela(vis) {
    if (!vis.length) return `<div style="text-align:center;padding:40px;color:#A0AABB;background:#fff;border:1px solid #E8EDF5;border-radius:14px">Nenhuma obra encontrada.</div>`;
    const totContr = vis.reduce((s,o)=>s+parseFloat(o.cfg?.valor||0),0);
    const totExec  = vis.reduce((s,o)=>s+this._calcObra(o).valorExec,0);
    return `<div style="overflow-x:auto;border:1px solid #E8EDF5;border-radius:14px;box-shadow:0 2px 12px rgba(100,130,200,.07)">
      <table class="dg-tbl" style="width:100%;border-collapse:collapse;font-size:12px">
        <thead><tr>${['Obra','Status','Contratado','Executado','Físico %','Financ. %','BMs','Empresa','Situação',''].map(h=>`<th style="padding:9px 10px;white-space:nowrap">${h}</th>`).join('')}</tr></thead>
        <tbody>${vis.map(o=>{
          const cfg=o.cfg||{}, c=this._calcObra(o);
          const nome=(cfg.apelido||o.apelido||o.nome||cfg.objeto||'Sem nome').slice(0,30);
          const sc={Em_andamento:C.blue,Concluída:C.green,Paralisada:C.amber,Suspensa:C.red}[c.statusAtual.replace(/ /g,'_')]||C.slate;
          const pF=c.pctFisico||0, pFin=c.pctFinanceiro||0;
          const bcF=pF>=80?C.green:pF>=40?C.amber:C.blue;
          const bcFin=pFin>=80?C.green:pFin>=40?C.amber:C.blue;
          const ult=c.ultimoBm?(c.ultimoBm.mes||c.ultimoBm.data||'BM '+c.ultimoBm.num):'—';
          const emp=(cfg.contratada||'—').slice(0,20);
          let sit;
          if (c.atrasada) sit=`<span style="background:${C.red}18;color:${C.red};border:1px solid ${C.red}44;padding:2px 6px;border-radius:4px;font-size:9px;white-space:nowrap">⚠️ Atrasada</span>`;
          else if (c.diasRestantes!==null&&c.diasRestantes<=ALERTA.diasVencimentoProximo&&c.statusAtual!=='Concluída') sit=`<span style="background:${C.amber}18;color:${C.amber};border:1px solid ${C.amber}44;padding:2px 6px;border-radius:4px;font-size:9px;white-space:nowrap">⏰ ${c.diasRestantes}d</span>`;
          else if (c.statusAtual==='Concluída') sit=`<span style="background:${C.green}18;color:${C.green};border:1px solid ${C.green}44;padding:2px 6px;border-radius:4px;font-size:9px">✅ Concluída</span>`;
          else if ((o.bms||[]).length===0) sit=`<span style="background:#F0F4FB;color:#A0AABB;border:1px solid #E8EDF5;padding:2px 6px;border-radius:4px;font-size:9px">Sem BM</span>`;
          else sit=`<span style="background:${C.blue}12;color:${C.blue};border:1px solid ${C.blue}33;padding:2px 6px;border-radius:4px;font-size:9px">✔ Normal</span>`;
          return `<tr style="cursor:pointer" data-action="_dgAbrirObra" data-arg0="${o.id}">
            <td style="padding:8px 10px;max-width:180px"><div style="font-weight:600;color:#1E2A3B;white-space:nowrap;overflow:hidden;text-overflow:ellipsis" title="${esc(nome)}">${esc(nome)}</div>${cfg.contrato?`<div style="font-size:9px;color:#A0AABB">📄 ${esc(cfg.contrato)}</div>`:''}</td>
            <td style="padding:8px 10px"><span style="color:${sc};border:1px solid ${sc}44;background:${sc}18;padding:2px 7px;border-radius:4px;font-size:10px;white-space:nowrap">${c.statusAtual}</span></td>
            <td style="padding:8px 10px;text-align:right;font-family:monospace;font-size:11px;white-space:nowrap">${cfg.valor?R$(cfg.valor):'—'}</td>
            <td style="padding:8px 10px;text-align:right;font-family:monospace;font-size:11px;color:${C.green};white-space:nowrap">${c.valorExec>0?R$(c.valorExec):'—'}</td>
            <td style="padding:8px 10px;min-width:80px">
              <div style="display:flex;justify-content:space-between;font-size:9px;margin-bottom:2px"><span>Fís.</span><span style="font-weight:700;color:${bcF}">${pct(pF)}</span></div>
              <div style="height:5px;background:#EEF2F9;border-radius:3px;overflow:hidden"><div style="height:5px;background:${bcF};width:${Math.min(100,pF)}%;border-radius:3px"></div></div>
            </td>
            <td style="padding:8px 10px;min-width:80px">
              <div style="display:flex;justify-content:space-between;font-size:9px;margin-bottom:2px"><span>Fin.</span><span style="font-weight:700;color:${bcFin}">${pct(pFin)}</span></div>
              <div style="height:5px;background:#EEF2F9;border-radius:3px;overflow:hidden"><div style="height:5px;background:${bcFin};width:${Math.min(100,pFin)}%;border-radius:3px"></div></div>
            </td>
            <td style="padding:8px 10px;text-align:center;font-weight:600">${(o.bms||[]).length}</td>
            <td style="padding:8px 10px;font-size:10px;color:#6b7280;white-space:nowrap;max-width:130px;overflow:hidden;text-overflow:ellipsis" title="${esc(emp)}">${esc(emp)}</td>
            <td style="padding:8px 10px">${sit}</td>
            <td style="padding:8px 10px"><button data-action="_dgAbrirObra" data-arg0="${o.id}" style="padding:4px 12px;font-size:10px;background:${C.coral};border:none;border-radius:7px;color:#fff;cursor:pointer;font-weight:700">Abrir</button></td>
          </tr>`;
        }).join('')}</tbody>
        <tfoot><tr>
          <td style="padding:8px 10px;font-size:11px;font-weight:800">TOTAL (${vis.length})</td>
          <td></td>
          <td style="padding:8px 10px;text-align:right;font-family:monospace;font-size:11px;font-weight:800">${R$(totContr)}</td>
          <td style="padding:8px 10px;text-align:right;font-family:monospace;font-size:11px;font-weight:800;color:${C.green}">${R$(totExec)}</td>
          <td colspan="6"></td>
        </tr></tfoot>
      </table>
    </div>`;
  }

  /* ═══════════════════════════════════════════════════════════
   *  GRÁFICOS
   * ═════════════════════════════════════════════════════════ */
  _chartAvancoH(calc, aid) {
    const cv=document.getElementById('dg-c1'); if(!cv) return;
    const ctx=cv.getContext('2d'), dpr=window.devicePixelRatio||1, r=cv.getBoundingClientRect();
    cv.width=r.width*dpr; cv.height=r.height*dpr; ctx.scale(dpr,dpr);
    const W=r.width, H=r.height;
    const dados=calc.slice(0,14).map(o=>({n:(o.cfg?.apelido||o.apelido||o.nome||o.cfg?.objeto||'Obra').slice(0,20),p:Math.min(100,o.c.pctFisico||0)}));
    if(!dados.length){ctx.fillStyle=C.muted;ctx.font='12px sans-serif';ctx.textAlign='center';ctx.fillText('Sem dados',W/2,H/2);return;}
    const mL=130,mR=55,mT=8, bH=Math.min(18,(H-mT)/(dados.length)-4),gap=4,cW=W-mL-mR;
    const t0=performance.now(),dur=700;
    const draw=now=>{
      if(aid!==this._anim)return;
      const pr=Math.min(1,(now-t0)/dur),e=1-Math.pow(1-pr,3);
      ctx.clearRect(0,0,W,H);
      dados.forEach((d,i)=>{
        const y=mT+i*(bH+gap),bW=(d.p/100)*cW*e,cor=d.p>=80?C.green:d.p>=40?C.amber:C.blue;
        ctx.fillStyle=C.muted;ctx.font='10px sans-serif';ctx.textAlign='right';ctx.textBaseline='middle';
        ctx.fillText(d.n,mL-8,y+bH/2);
        ctx.fillStyle='#EEF2F9';ctx.beginPath();ctx.roundRect(mL,y,cW,bH,3);ctx.fill();
        if(bW>2){const g=ctx.createLinearGradient(mL,0,mL+bW,0);g.addColorStop(0,cor);g.addColorStop(1,cor+'88');ctx.fillStyle=g;ctx.beginPath();ctx.roundRect(mL,y,bW,bH,3);ctx.fill();}
        ctx.fillStyle=C.text;ctx.font='bold 10px sans-serif';ctx.textAlign='left';
        ctx.fillText(`${(d.p*e).toFixed(1)}%`,mL+bW+5,y+bH/2);
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
    const sl=[{l:'Sem medições',v:sem,c:C.slate},{l:'Em andamento',v:and,c:C.blue},{l:'Próx. conclusão',v:prox,c:C.amber},{l:'Concluídas',v:conc,c:C.green},{l:'Paralisadas',v:par,c:'#d97706'},{l:'Suspensas',v:sus,c:C.red}].filter(s=>s.v>0);
    const tot=sl.reduce((s,x)=>s+x.v,0);
    if(!tot){ctx.fillStyle=C.muted;ctx.font='12px sans-serif';ctx.textAlign='center';ctx.fillText('Sem dados',W/2,H/2);return;}
    const cx=W/2,cy=H/2,R=Math.min(cx,cy)-16,iR=R*.56;
    const t0=performance.now(),dur=900;
    const draw=now=>{
      if(aid!==this._anim)return;
      const pr=Math.min(1,(now-t0)/dur),e=1-Math.pow(1-pr,3),ta=Math.PI*2*e;
      ctx.clearRect(0,0,W,H);
      let sa=-Math.PI/2;
      sl.forEach(s=>{const a=(s.v/tot)*ta;ctx.beginPath();ctx.moveTo(cx,cy);ctx.arc(cx,cy,R,sa,sa+a);ctx.closePath();ctx.fillStyle=s.c;ctx.fill();sa+=a;});
      ctx.beginPath();ctx.arc(cx,cy,iR,0,Math.PI*2);ctx.fillStyle='#F7F9FD';ctx.fill();
      if(pr>.4){ctx.fillStyle=C.text;ctx.font='bold 22px sans-serif';ctx.textAlign='center';ctx.textBaseline='middle';ctx.fillText(String(tot),cx,cy-6);ctx.fillStyle=C.muted;ctx.font='9px sans-serif';ctx.fillText('OBRAS',cx,cy+14);}
      if(pr<1)requestAnimationFrame(draw);
    };
    requestAnimationFrame(draw);
    const leg=document.getElementById('dg-leg');
    if(leg)leg.innerHTML=sl.map(s=>`<div style="display:flex;align-items:center;gap:5px;font-size:10px;color:${C.muted}"><span style="width:8px;height:8px;border-radius:2px;background:${s.c};flex-shrink:0"></span>${s.l}: <strong style="color:${C.text}">${s.v}</strong></div>`).join('');
  }

  _chartFinancieroV(calc, aid) {
    const cv=document.getElementById('dg-c2');if(!cv)return;
    const ctx=cv.getContext('2d'),dpr=window.devicePixelRatio||1,r=cv.getBoundingClientRect();
    cv.width=r.width*dpr;cv.height=r.height*dpr;ctx.scale(dpr,dpr);
    const W=r.width,H=r.height;
    const dados=calc.slice(0,10).map(o=>({n:(o.cfg?.apelido||o.apelido||o.nome||o.cfg?.objeto||'Obra').slice(0,12),v:o.c.valorContr,m:o.c.valorExec}));
    if(!dados.length){ctx.fillStyle=C.muted;ctx.font='12px sans-serif';ctx.textAlign='center';ctx.fillText('Sem dados',W/2,H/2);return;}
    const mL=12,mR=12,mT=12,mB=44,cH=H-mT-mB,cW=W-mL-mR,mx=Math.max(1,...dados.map(d=>Math.max(d.v,d.m)));
    const gW=cW/dados.length,bW=Math.min(16,gW*.3);
    const t0=performance.now(),dur=800;
    const draw=now=>{
      if(aid!==this._anim)return;
      const pr=Math.min(1,(now-t0)/dur),e=1-Math.pow(1-pr,3);
      ctx.clearRect(0,0,W,H);
      for(let i=0;i<=4;i++){const y=mT+(cH/4)*i;ctx.strokeStyle='rgba(0,0,0,.05)';ctx.lineWidth=1;ctx.beginPath();ctx.moveTo(mL,y);ctx.lineTo(W-mR,y);ctx.stroke();}
      dados.forEach((d,i)=>{
        const cx2=mL+gW*i+gW/2,h1=(d.v/mx)*cH*e,h2=(d.m/mx)*cH*e;
        ctx.fillStyle=C.blue;ctx.beginPath();ctx.roundRect(cx2-bW-1,mT+cH-h1,bW,h1,[3,3,0,0]);ctx.fill();
        ctx.fillStyle=C.green;ctx.beginPath();ctx.roundRect(cx2+1,mT+cH-h2,bW,h2,[3,3,0,0]);ctx.fill();
        ctx.fillStyle=C.muted;ctx.font='9px sans-serif';ctx.textAlign='center';ctx.textBaseline='top';
        ctx.fillText(d.n,cx2,H-mB+6);
      });
      if(pr<1)requestAnimationFrame(draw);
    };
    requestAnimationFrame(draw);
  }

  _chartFisVsFin(calc, aid) {
    const cv=document.getElementById('dg-c4');if(!cv)return;
    const ctx=cv.getContext('2d'),dpr=window.devicePixelRatio||1,r=cv.getBoundingClientRect();
    cv.width=r.width*dpr;cv.height=r.height*dpr;ctx.scale(dpr,dpr);
    const W=r.width,H=r.height;
    const dados=calc.slice(0,10).map(o=>({n:(o.cfg?.apelido||o.apelido||o.nome||o.cfg?.objeto||'Obra').slice(0,12),f:o.c.pctFisico,fin:o.c.pctFinanceiro}));
    if(!dados.length){ctx.fillStyle=C.muted;ctx.font='12px sans-serif';ctx.textAlign='center';ctx.fillText('Sem dados',W/2,H/2);return;}
    const mL=12,mR=12,mT=12,mB=44,cH=H-mT-mB,cW=W-mL-mR;
    const gW=cW/dados.length,bW=Math.min(16,gW*.3);
    const t0=performance.now(),dur=800;
    const draw=now=>{
      if(aid!==this._anim)return;
      const pr=Math.min(1,(now-t0)/dur),e=1-Math.pow(1-pr,3);
      ctx.clearRect(0,0,W,H);
      for(let i=0;i<=4;i++){const y=mT+(cH/4)*i;ctx.strokeStyle='rgba(0,0,0,.05)';ctx.lineWidth=1;ctx.beginPath();ctx.moveTo(mL,y);ctx.lineTo(W-mR,y);ctx.stroke();ctx.fillStyle=C.dim;ctx.font='8px sans-serif';ctx.textAlign='left';ctx.fillText(`${100-i*25}%`,mL,y-2);}
      dados.forEach((d,i)=>{
        const cx2=mL+gW*i+gW/2,h1=(d.f/100)*cH*e,h2=(d.fin/100)*cH*e;
        ctx.fillStyle=C.blue;ctx.beginPath();ctx.roundRect(cx2-bW-1,mT+cH-h1,bW,h1,[3,3,0,0]);ctx.fill();
        ctx.fillStyle=C.amber;ctx.beginPath();ctx.roundRect(cx2+1,mT+cH-h2,bW,h2,[3,3,0,0]);ctx.fill();
        ctx.fillStyle=C.muted;ctx.font='9px sans-serif';ctx.textAlign='center';ctx.textBaseline='top';
        ctx.fillText(d.n,cx2,H-mB+6);
      });
      if(pr<1)requestAnimationFrame(draw);
    };
    requestAnimationFrame(draw);
  }

  /* ═══════════════════════════════════════════════════════════
   *  EVENTOS
   * ═════════════════════════════════════════════════════════ */
  _bindEvents() {
    const recarregar = async () => {
      try { if(router.current!=='dash-global')return; await this._carregarTudo(); this._render(); }
      catch(e){console.error('[DashGlobal] event reload:',e);}
    };
    this._subs.push(
      EventBus.on('obra:criada',        recarregar,'dash-global'),
      EventBus.on('boletim:atualizado', recarregar,'dash-global'),
      EventBus.on('config:salva',       recarregar,'dash-global'),
      EventBus.on('itens:atualizados',  recarregar,'dash-global'),
      EventBus.on('aditivos:changed',   recarregar,'dash-global'),
    );
  }

  _exposeGlobals() {
    window.renderDashGlobal = () => { try{this.onEnter();}catch(e){} };
    exposeGlobal('_dgTab', tab => { try{this._render(tab);}catch(e){} });
    exposeGlobal('_dgFiltro', (campo,valor) => { try{this._filtros[campo]=valor;this._render();}catch(e){} });
    exposeGlobal('_dgBusca', v => { try{this._busca=v;this._render();}catch(e){} });
    exposeGlobal('_dgLimparFiltros', () => { try{this._filtros={status:'',contratada:'',cidade:'',tipo:''};this._busca='';this._render();}catch(e){} });
    exposeGlobal('_dgRecarregar', async () => {
      try { this._loading=true; this._render(); await this._carregarTudo(); this._render(); }
      catch(e) { console.error('[DashGlobal] _dgRecarregar:',e); this._loading=false; this._render(); }
    });
    exposeGlobal('_dgAbrirObra', async obraId => {
      try {
        state.set('obraAtivaId',obraId);
        state.persist?.(['obraAtivaId']);
        const [cfg,bms,itens]=await Promise.all([
          FirebaseService.getObraCfg(obraId).catch(()=>null),
          FirebaseService.getBMs(obraId).catch(()=>null),
          FirebaseService.getItens(obraId).catch(()=>null),
        ]);
        if(cfg) state.set('cfg',cfg);
        if(bms&&bms.length) state.set('bms',bms);
        if(itens&&itens.length) state.set('itensContrato',itens);
        EventBus.emit('obra:selecionada',{obraId});
        router.navigate('dashboard');
      } catch(e){console.warn('[DashGlobal] _dgAbrirObra:',e);}
    });
  }

  destroy() { this._subs.forEach(u=>u()); this._subs=[]; }
}
