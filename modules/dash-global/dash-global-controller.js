/**
 * ╔══════════════════════════════════════════════════════════════╗
 * ║  FISCAL NA OBRA v15 — dash-global-controller.js             ║
 * ║  Módulo: Dashboard Global — Painel Executivo de Obras        ║
 * ║  REMODELADO: Cards animados, gráficos Canvas, tabela resumo ║
 * ╚══════════════════════════════════════════════════════════════╝
 */

import EventBus       from '../../core/EventBus.js';
import state          from '../../core/state.js';
import router         from '../../core/router.js';
import { formatters } from '../../utils/formatters.js';
import FirebaseService from '../../firebase/firebase-service.js';
import { exposeGlobal } from '../../utils/global-guard.js';
import {
  _injetarCacheMedicoes,
  getValorAcumuladoTotal,
} from '../boletim-medicao/bm-calculos.js';

/* ── Polyfill Canvas roundRect ──────────────────────────── */
if (typeof CanvasRenderingContext2D !== 'undefined' && !CanvasRenderingContext2D.prototype.roundRect) {
  CanvasRenderingContext2D.prototype.roundRect = function(x,y,w,h,r) {
    const rad = typeof r === 'number' ? [r,r,r,r] : Array.isArray(r) ? r.concat(Array(4-r.length).fill(0)) : [0,0,0,0];
    this.moveTo(x+rad[0],y);
    this.lineTo(x+w-rad[1],y); this.quadraticCurveTo(x+w,y,x+w,y+rad[1]);
    this.lineTo(x+w,y+h-rad[2]); this.quadraticCurveTo(x+w,y+h,x+w-rad[2],y+h);
    this.lineTo(x+rad[3],y+h); this.quadraticCurveTo(x,y+h,x,y+h-rad[3]);
    this.lineTo(x,y+rad[0]); this.quadraticCurveTo(x,y,x+rad[0],y);
    this.closePath(); return this;
  };
}

/* ── Helpers ────────────────────────────────────────────── */
const R$ = v => (v||0).toLocaleString('pt-BR',{style:'currency',currency:'BRL'});
const pct = v => `${(parseFloat(v)||0).toFixed(1)}%`;
const pct2 = v => `${(parseFloat(v)||0).toFixed(2).replace('.',',')}%`;

/* ── Paleta ─────────────────────────────────────────────── */
const C = {
  blue:'#5B8ECC', green:'#4DBFA8', amber:'#F0A742', red:'#E05252',
  purple:'#9179E0', slate:'#8A94A6', cyan:'#0891b2',
  coral:'#E8785A',
  text:'#1E2A3B', muted:'#8A94A6', dim:'#A0AABB',
  surface:'#fff', border:'#E8EDF5',
  rowBg:'#F7F9FD',
};

export class DashGlobalModule {
  constructor() {
    this._subs    = [];
    this._obras   = [];
    this._filtros = { ano:'', status:'', contratada:'', fiscal:'' };
    this._busca   = '';
    this._loading = false;
    this._anim    = 0;
  }

  async init() {
    try { this._bindEvents(); this._exposeGlobals(); }
    catch (e) { console.error('[DashGlobalModule] init:', e); }
  }

  async onEnter() {
    try { await this._carregarTudo(); this._render(); }
    catch (e) { console.error('[DashGlobalModule] onEnter:', e); }
  }

  /* ═══ DADOS ═══════════════════════════════════════════════ */
  async _carregarTudo() {
    this._loading = true;
    try {
      const lista = await FirebaseService.getObrasLista() || [];
      this._obras = await Promise.all(lista.map(async obra => {
        try {
          const [cfg, bms, itens] = await Promise.all([
            FirebaseService.getObraCfg(obra.id).catch(() => null),
            FirebaseService.getBMs(obra.id).catch(() => []),
            FirebaseService.getItens(obra.id).catch(() => []),
          ]);
          const bmList = bms || [];
          // FIX-2: carrega medições de todos os BMs para permitir cálculo
          // correto de Valor Medido e Execução Média no painel executivo.
          await Promise.all(bmList.map(bm =>
            FirebaseService.getMedicoes(obra.id, bm.num)
              .then(med => {
                if (med && Object.keys(med).length > 0) {
                  _injetarCacheMedicoes(obra.id, bm.num, med);
                }
              })
              .catch(() => {})
          ));
          return { ...obra, cfg: cfg || {}, bms: bmList, itens: itens || [] };
        } catch { return { ...obra, cfg: {}, bms: [], itens: [] }; }
      }));
    } catch (e) {
      console.error('[DashGlobalModule] _carregarTudo:', e);
      this._obras = [];
    }
    this._loading = false;
  }

  _calcObra(obra) {
    const cfg = obra.cfg || {}, bms = obra.bms || [], itens = obra.itens || [], hoje = new Date();
    const ultimoBm = bms.slice().sort((a,b)=>(b.num||0)-(a.num||0))[0];
    const lastBmNum = ultimoBm?.num || 0;

    // FIX-2: calcular valorExec usando getValorAcumuladoTotal quando
    // itens e medições estão disponíveis no cache (carregados em _carregarTudo).
    let valorExec = 0;
    let pctFisico = 0;
    if (itens.length > 0 && lastBmNum > 0) {
      valorExec = getValorAcumuladoTotal(obra.id, lastBmNum, itens, cfg);
      const valorContr = parseFloat(cfg.valor || 0);
      pctFisico = valorContr > 0 ? Math.min(100, (valorExec / valorContr) * 100) : 0;
    } else {
      // Fallback: usa campos gravados no BM (compatibilidade com importação PDF)
      pctFisico = parseFloat(ultimoBm?.pctAcumFisico||ultimoBm?.percentualAcumulado||0);
      valorExec = parseFloat(ultimoBm?.valorAcumulado || 0) ||
                  bms.reduce((s,b) => s + parseFloat(b.valorMedicao||0), 0);
    }

    const termino = cfg.termino ? new Date(cfg.termino+'T23:59:59') : null;
    const inicio  = cfg.inicioPrev ? new Date(cfg.inicioPrev) : null;
    const hoje0   = new Date(hoje.toDateString());

    // FIX-3 (parcial): status real a partir de campos confiáveis
    const VALID_STATUS = ['Em andamento','Paralisada','Concluída','Suspensa'];
    const rawSt  = cfg.statusObra||cfg.status||obra.statusObra||obra.status||'';
    const statusAtual = VALID_STATUS.includes(rawSt) ? rawSt : (obra.statusObra || 'Em andamento');

    const atrasada = termino && hoje0 > termino && statusAtual !== 'Concluída';

    let pctPrazo = 0;
    if (inicio && termino) {
      const tot = termino - inicio;
      pctPrazo = tot > 0 ? Math.max(0, Math.min(100, (hoje0 - inicio) / tot * 100)) : 0;
    }

    // FIX-1: classificação ATRASADA / DENTRO DO PRAZO
    // Considera atrasada se: passou do prazo OU execução física está
    // mais de 10 pontos percentuais abaixo do cronograma esperado.
    const MARGEM_ATRASO = 10;
    let statusExecucao = null;
    if (statusAtual !== 'Concluída' && statusAtual !== 'Paralisada' && statusAtual !== 'Suspensa') {
      if (atrasada || (pctPrazo > 0 && (pctPrazo - pctFisico) > MARGEM_ATRASO)) {
        statusExecucao = 'ATRASADA';
      } else {
        statusExecucao = 'DENTRO DO PRAZO';
      }
    }

    return { pctFisico, valorExec, atrasada: !!(atrasada || statusExecucao === 'ATRASADA'),
             pctPrazo, ultimoBm, statusExecucao, statusAtual };
  }

  _obrasVisiveis() {
    let lista = [...this._obras];
    const { ano, status, contratada, fiscal } = this._filtros;
    const busca = this._busca.trim().toLowerCase();
    if (ano) lista = lista.filter(o=>(o.cfg?.inicioPrev||'').startsWith(ano));
    if (status) lista = lista.filter(o=>(o.cfg?.statusObra||o.cfg?.status||o.statusObra||o.status||'Em andamento')===status);
    if (contratada) lista = lista.filter(o=>(o.cfg?.contratada||'').toLowerCase().includes(contratada.toLowerCase()));
    if (fiscal) lista = lista.filter(o=>(o.cfg?.fiscal||'').toLowerCase().includes(fiscal.toLowerCase()));
    if (busca) lista = lista.filter(o=>
      (o.cfg?.apelido||o.apelido||o.nome||o.cfg?.objeto||'').toLowerCase().includes(busca)||
      (o.cfg?.contrato||'').toLowerCase().includes(busca));
    return lista;
  }

  /* ═══ RENDER PRINCIPAL ════════════════════════════════════ */
  _render() {
    const el = document.getElementById('dash-global-conteudo');
    if (!el) return;

    if (this._loading) {
      el.innerHTML = '<div class="dg-loading"><div class="dg-spin"></div> Carregando dados das obras...</div>';
      return;
    }

    const todas = this._obras;
    const visiveis = this._obrasVisiveis();

    /* ── Consolidação ── */
    let totContr=0,totExec=0,totBMs=0,nAtr=0,nConc=0,nAnd=0,nPar=0,nSus=0,nSem=0,nProx=0;
    const calc = [];
    todas.forEach(o => {
      const c = this._calcObra(o);
      const cfg = o.cfg||{}, bms = o.bms||[];
      totContr += parseFloat(cfg.valor||0);
      totExec += c.valorExec;
      totBMs += bms.length;
      // FIX-1/2: conta atrasadas pelo statusExecucao calculado
      if (c.statusExecucao === 'ATRASADA') nAtr++;
      const st = c.statusAtual;
      if (st==='Concluída') nConc++;
      else if (st==='Em andamento') nAnd++;
      else if (st==='Paralisada') nPar++;
      else if (st==='Suspensa') nSus++;
      if (bms.length===0) nSem++;
      if (c.pctFisico>=80 && c.pctFisico<100 && st!=='Concluída') nProx++;
      calc.push({...o, c, st});
    });
    const pctMed = todas.length > 0 ? calc.reduce((s,o)=>s+(o.c.pctFisico||0),0)/todas.length : 0;

    /* ── Filtros ── */
    const statusOpts = ['Em andamento','Paralisada','Concluída','Suspensa'];
    const contratadas = [...new Set(todas.map(o=>o.cfg?.contratada||'').filter(Boolean))].sort();
    const fiscais = [...new Set(todas.map(o=>o.cfg?.fiscal||'').filter(Boolean))].sort();
    const agora = new Date();

    el.innerHTML = `
    <div class="dg-hdr">
      <div style="display:flex;align-items:center;justify-content:space-between;max-width:var(--layout-max,1200px);margin:0 auto;flex-wrap:wrap;gap:10px">
        <div>
          <div class="dg-hdr-title">Painel Executivo de Obras</div>
          <div class="dg-hdr-sub">Consolidado de ${todas.length} obra${todas.length!==1?'s':''} — ${agora.toLocaleDateString('pt-BR',{day:'2-digit',month:'long',year:'numeric'})} às ${agora.toLocaleTimeString('pt-BR',{hour:'2-digit',minute:'2-digit'})}</div>
        </div>
        <button id="dg-btn-att" style="padding:10px 22px;background:#E8785A;border:none;border-radius:10px;
          color:#fff;font-size:12px;font-weight:700;cursor:pointer;display:flex;align-items:center;gap:7px;
          transition:all .2s;letter-spacing:.3px;box-shadow:0 4px 14px rgba(232,120,90,.30)">
          🔃 Atualizar Dashboard
        </button>
      </div>
    </div>

    <div class="dg-wrap">

      <!-- ═══ 1. CARDS KPI ═══ -->
      <div class="dg-stitle"><span style="color:${C.blue}">◆</span> INDICADORES GLOBAIS</div>
      <div class="dg-kg" style="grid-template-columns:repeat(auto-fit,minmax(165px,1fr));gap:10px;margin-bottom:22px">
        ${this._card('🏗️','Total de Obras',String(todas.length),'obras cadastradas',C.cyan)}
        ${this._card('💼','Valor Contratado',R$(totContr),'soma dos contratos',C.blue)}
        ${this._card('💰','Valor Total Medido',R$(totExec),'já executado',C.green)}
        ${this._card('📊','Execução Média',pct2(pctMed),'média percentual',C.purple)}
        ${this._card('📋','Total de BMs',String(totBMs),'boletins registrados',C.amber)}
        ${this._card('⏰','Obras Atrasadas',String(nAtr),nAtr>0?'atenção necessária':'nenhuma atrasada',nAtr>0?C.red:'#A0AABB')}
      </div>

      <!-- ═══ 2-4. GRÁFICOS ═══ -->
      <div class="dg-cg">
        <div class="dg-cc" style="min-height:300px">
          <div class="dg-ct"><span style="color:${C.green}">◆</span> AVANÇO PERCENTUAL DAS OBRAS</div>
          <canvas id="dg-c1" style="width:100%;height:250px"></canvas>
        </div>
        <div class="dg-cc" style="min-height:300px">
          <div class="dg-ct"><span style="color:${C.blue}">◆</span> CONTRATADO vs MEDIDO</div>
          <canvas id="dg-c2" style="width:100%;height:250px"></canvas>
        </div>
        <div class="dg-cc" style="min-height:300px">
          <div class="dg-ct"><span style="color:${C.purple}">◆</span> SITUAÇÃO DAS OBRAS</div>
          <canvas id="dg-c3" style="width:100%;height:210px"></canvas>
          <div id="dg-leg" style="margin-top:6px;display:flex;flex-wrap:wrap;gap:5px 14px;justify-content:center"></div>
        </div>
      </div>

      <!-- ═══ 5. FILTROS + TABELA ═══ -->
      <div class="dg-stitle" style="margin-top:24px"><span style="color:${C.amber}">◆</span> TABELA RESUMO GLOBAL</div>
      <div style="background:#fff;border:1px solid #E8EDF5;border-radius:14px;padding:16px;margin-bottom:12px;box-shadow:0 2px 14px rgba(100,130,200,.07)">
        <div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap">
          <input id="dg-busca" type="text" placeholder="🔍 Buscar obra ou contrato..." value="${this._busca}" oninput="window._dgBusca(this.value)"
            style="flex:1;min-width:200px;padding:8px 12px;border:1px solid #E8EDF5;border-radius:8px;background:#F7F9FD;color:#1E2A3B;font-size:12px;outline:none">
          <select onchange="window._dgFiltro('status',this.value)" style="padding:8px 10px;border:1px solid #E8EDF5;border-radius:8px;background:#F7F9FD;color:#1E2A3B;font-size:11px">
            <option value="">Todos os status</option>
            ${statusOpts.map(s=>`<option value="${s}" ${this._filtros.status===s?'selected':''}>${s}</option>`).join('')}
          </select>
          <select onchange="window._dgFiltro('contratada',this.value)" style="padding:8px 10px;border:1px solid #E8EDF5;border-radius:8px;background:#F7F9FD;color:#1E2A3B;font-size:11px;max-width:180px">
            <option value="">Todas contratadas</option>
            ${contratadas.map(c=>`<option value="${c}" ${this._filtros.contratada===c?'selected':''}>${c.slice(0,28)}</option>`).join('')}
          </select>
          <select onchange="window._dgFiltro('fiscal',this.value)" style="padding:8px 10px;border:1px solid #E8EDF5;border-radius:8px;background:#F7F9FD;color:#1E2A3B;font-size:11px">
            <option value="">Todos fiscais</option>
            ${fiscais.map(f=>`<option value="${f}" ${this._filtros.fiscal===f?'selected':''}>${f.slice(0,22)}</option>`).join('')}
          </select>
          <button data-action="_dgLimparFiltros" style="padding:7px 12px;background:transparent;border:1px solid #E8EDF5;border-radius:8px;color:#8A94A6;font-size:11px;cursor:pointer">Limpar</button>
        </div>
        <div style="font-size:10px;color:#A0AABB;margin-top:6px">Exibindo <strong style="color:#1E2A3B">${visiveis.length}</strong> de ${todas.length} obras</div>
      </div>

      <div style="overflow-x:auto;border:1px solid #E8EDF5;border-radius:14px;margin-bottom:32px;box-shadow:0 2px 14px rgba(100,130,200,.07)">
        <table class="dg-tbl">
          <thead><tr>${['Obra','Status','Valor Contratado','Valor Medido','% Execução','Qtd BMs','Última Medição','Situação',''].map(h=>`<th style="white-space:nowrap">${h}</th>`).join('')}</tr></thead>
          <tbody>${this._rows(visiveis)}</tbody>
          <tfoot><tr>
            <td>TOTAL (${visiveis.length})</td><td></td>
            <td style="font-family:var(--font-mono,monospace)">${R$(visiveis.reduce((s,o)=>s+parseFloat(o.cfg?.valor||0),0))}</td>
            <td style="font-family:var(--font-mono,monospace);color:${C.green}">${R$(visiveis.reduce((s,o)=>s+this._calcObra(o).valorExec,0))}</td>
            <td></td><td style="text-align:center">${visiveis.reduce((s,o)=>s+(o.bms||[]).length,0)}</td>
            <td colspan="3"></td>
          </tr></tfoot>
        </table>
      </div>
    </div>`;

    document.getElementById('dg-btn-att')?.addEventListener('click', ()=>window._dgRecarregar());

    /* Desenhar gráficos */
    this._anim++;
    const id = this._anim;
    requestAnimationFrame(() => {
      if (id !== this._anim) return;
      try { this._chartBarH(calc); } catch(e){}
      try { this._chartBarV(calc); } catch(e){}
      try { this._chartDonut(nSem,nAnd,nProx,nConc,nPar,nSus); } catch(e){}
    });
  }

  /* ═══ CARD KPI ════════════════════════════════════════════ */
  _card(ico, lbl, val, sub, cor) {
    return `<div class="dg-k" style="border-top-color:${cor}">
      <div class="dg-k-top"><span class="dg-k-ico">${ico}</span><span class="dg-k-lbl">${lbl}</span></div>
      <div class="dg-k-val" style="color:${cor}">${val}</div>
      <div class="dg-k-sub">${sub}</div>
    </div>`;
  }

  /* ═══ LINHAS TABELA ═══════════════════════════════════════ */
  _rows(vis) {
    if (!vis.length) return `<tr><td colspan="9" style="padding:40px;text-align:center;color:#A0AABB">Nenhuma obra encontrada.</td></tr>`;
    return vis.map(o => {
      const cfg=o.cfg||{}, bms=o.bms||[], c=this._calcObra(o);
      const nome=(cfg.apelido||o.apelido||o.nome||cfg.objeto||'Sem nome').slice(0,38);
      // FIX-3: usa statusAtual validado em _calcObra para evitar "Prefeitura"
      const st = c.statusAtual;
      const sc={Em_andamento:C.blue,Concluída:C.green,Paralisada:C.amber,Suspensa:C.red}[st.replace(/ /g,'_')]||C.slate;
      const p=c.pctFisico||0;
      const bc=p>=80?C.green:p>=40?C.amber:C.blue;
      const ult=c.ultimoBm?(c.ultimoBm.mes||c.ultimoBm.data||'BM '+c.ultimoBm.num):'—';
      // FIX-1: exibe statusExecucao calculado (ATRASADA / DENTRO DO PRAZO)
      let sit;
      if (c.statusExecucao === 'ATRASADA') {
        sit = `<span class="dg-b" style="background:${C.red}18;color:${C.red};border:1px solid ${C.red}44">⚠️ Atrasada</span>`;
      } else if (c.statusExecucao === 'DENTRO DO PRAZO') {
        sit = `<span class="dg-b" style="background:${C.green}18;color:${C.green};border:1px solid ${C.green}44">✅ Dentro do prazo</span>`;
      } else if (bms.length===0) {
        sit = `<span class="dg-b" style="background:#F0F4FB;color:#A0AABB;border:1px solid #E8EDF5">Sem medição</span>`;
      } else if (st==='Concluída') {
        sit = `<span class="dg-b" style="background:${C.green}18;color:${C.green};border:1px solid ${C.green}44">Concluída</span>`;
      } else if (st==='Paralisada') {
        sit = `<span class="dg-b" style="background:${C.amber}18;color:${C.amber};border:1px solid ${C.amber}44">Paralisada</span>`;
      } else if (st==='Suspensa') {
        sit = `<span class="dg-b" style="background:${C.red}18;color:${C.red};border:1px solid ${C.red}44">Suspensa</span>`;
      } else {
        sit = `<span class="dg-b" style="background:${C.blue}12;color:${C.blue};border:1px solid ${C.blue}33">Normal</span>`;
      }
      return `<tr style="cursor:pointer" data-action="_dgAbrirObra" data-arg0="${o.id}" >
        <td style="max-width:200px"><div style="font-weight:600;color:#1E2A3B;white-space:nowrap;overflow:hidden;text-overflow:ellipsis" title="${nome}">${nome}</div>${cfg.contrato?`<div style="font-size:9px;color:#A0AABB;margin-top:1px">📄 ${cfg.contrato}</div>`:''}</td>
        <td><span class="dg-b" style="color:${sc};border:1px solid ${sc}44;background:${sc}18">${st}</span></td>
        <td style="text-align:right;font-family:var(--font-mono,monospace);white-space:nowrap">${cfg.valor?R$(cfg.valor):'—'}</td>
        <td style="text-align:right;font-family:var(--font-mono,monospace);color:${C.green};white-space:nowrap">${c.valorExec>0?R$(c.valorExec):'—'}</td>
        <td style="min-width:95px"><div style="display:flex;justify-content:space-between;font-size:9px;color:#A0AABB;margin-bottom:3px"><span>Exec.</span><span style="font-weight:700;color:${bc}">${pct(p)}</span></div><div class="dg-pb"><div class="dg-pbf" style="width:${Math.min(100,p)}%;background:${bc}"></div></div></td>
        <td style="text-align:center;font-weight:600">${bms.length}</td>
        <td style="font-size:10px;color:#8A94A6;white-space:nowrap">${ult}</td>
        <td>${sit}</td>
        <td><button data-action="_dgAbrirObra" data-arg0="${o.id}" style="padding:4px 12px;font-size:10px;background:#E8785A;border:none;border-radius:7px;color:#fff;cursor:pointer;font-weight:700">Abrir</button></td>
      </tr>`;
    }).join('');
  }

  /* ═══ GRÁFICO 1 — Barras Horizontais (Avanço %) ══════════ */
  _chartBarH(calc) {
    const cv = document.getElementById('dg-c1'); if (!cv) return;
    const ctx = cv.getContext('2d');
    const dpr = window.devicePixelRatio||1;
    const r = cv.getBoundingClientRect();
    cv.width = r.width*dpr; cv.height = r.height*dpr;
    ctx.scale(dpr,dpr);
    const W=r.width, H=r.height;
    const dados = calc.slice(0,12).map(o=>({ n:(o.cfg?.apelido||o.apelido||o.nome||o.cfg?.objeto||'Obra').slice(0,18), p:Math.min(100,o.c.pctFisico||0) }));
    if (!dados.length) { ctx.fillStyle='#64748b'; ctx.font='12px sans-serif'; ctx.textAlign='center'; ctx.fillText('Sem dados',W/2,H/2); return; }
    const mL=120, mR=50, mT=8, bH=Math.min(20,(H-mT)/(dados.length)-5), gap=5, cW=W-mL-mR;
    const t0=performance.now(), dur=800, aid=this._anim;
    const draw=(now)=>{
      if(aid!==this._anim) return;
      const pr=Math.min(1,(now-t0)/dur), e=1-Math.pow(1-pr,3);
      ctx.clearRect(0,0,W,H);
      dados.forEach((d,i)=>{
        const y=mT+i*(bH+gap), bW=(d.p/100)*cW*e;
        const cor=d.p>=80?C.green:d.p>=40?C.amber:C.blue;
        ctx.fillStyle='#8A94A6'; ctx.font='10px sans-serif'; ctx.textAlign='right'; ctx.textBaseline='middle';
        ctx.fillText(d.n, mL-8, y+bH/2);
        ctx.fillStyle='#EEF2F9';
        ctx.beginPath(); ctx.roundRect(mL,y,cW,bH,3); ctx.fill();
        if(bW>2){
          const g=ctx.createLinearGradient(mL,0,mL+bW,0); g.addColorStop(0,cor); g.addColorStop(1,cor+'88');
          ctx.fillStyle=g; ctx.beginPath(); ctx.roundRect(mL,y,bW,bH,3); ctx.fill();
        }
        ctx.fillStyle='#1E2A3B'; ctx.font='bold 10px sans-serif'; ctx.textAlign='left';
        ctx.fillText(`${(d.p*e).toFixed(1)}%`, mL+bW+6, y+bH/2);
      });
      if(pr<1) requestAnimationFrame(draw);
    };
    requestAnimationFrame(draw);
  }

  /* ═══ GRÁFICO 2 — Barras Verticais Duplas (Financeiro) ═══ */
  _chartBarV(calc) {
    const cv = document.getElementById('dg-c2'); if (!cv) return;
    const ctx = cv.getContext('2d');
    const dpr = window.devicePixelRatio||1;
    const r = cv.getBoundingClientRect();
    cv.width = r.width*dpr; cv.height = r.height*dpr;
    ctx.scale(dpr,dpr);
    const W=r.width, H=r.height;
    const dados = calc.slice(0,8).map(o=>({ n:(o.cfg?.apelido||o.apelido||o.nome||o.cfg?.objeto||'Obra').slice(0,10), v:parseFloat(o.cfg?.valor||0), m:o.c.valorExec||0 }));
    if (!dados.length) { ctx.fillStyle='#64748b'; ctx.font='12px sans-serif'; ctx.textAlign='center'; ctx.fillText('Sem dados',W/2,H/2); return; }
    const mL=12,mR=12,mT=12,mB=42;
    const cH=H-mT-mB, cW=W-mL-mR, mx=Math.max(1,...dados.map(d=>Math.max(d.v,d.m)));
    const gW=cW/dados.length, bW=Math.min(16,gW*.28);

    // Store final bar rects for tooltip hit-testing
    let barRects = [];

    const t0=performance.now(), dur=900, aid=this._anim;
    const draw=(now)=>{
      if(aid!==this._anim) return;
      const pr=Math.min(1,(now-t0)/dur), e=1-Math.pow(1-pr,3);
      ctx.clearRect(0,0,W,H);
      for(let i=0;i<=4;i++){const y=mT+(cH/4)*i; ctx.strokeStyle='rgba(0,0,0,.05)'; ctx.lineWidth=1; ctx.beginPath(); ctx.moveTo(mL,y); ctx.lineTo(W-mR,y); ctx.stroke();}

      barRects = [];
      dados.forEach((d,i)=>{
        const cx=mL+gW*i+gW/2, h1=(d.v/mx)*cH*e, h2=(d.m/mx)*cH*e;
        ctx.fillStyle=C.blue; ctx.beginPath(); ctx.roundRect(cx-bW-1,mT+cH-h1,bW,h1,[3,3,0,0]); ctx.fill();
        ctx.fillStyle=C.green; ctx.beginPath(); ctx.roundRect(cx+1,mT+cH-h2,bW,h2,[3,3,0,0]); ctx.fill();
        ctx.fillStyle='#8A94A6'; ctx.font='9px sans-serif'; ctx.textAlign='center'; ctx.textBaseline='top';
        ctx.fillText(d.n, cx, H-mB+6);

        // Store final (non-animated) bar rects for tooltip
        barRects.push({
          name: d.n,
          contratado: d.v, medido: d.m,
          x1: cx-bW-1, y1: mT+cH-(d.v/mx)*cH, w: bW, h1: (d.v/mx)*cH,
          x2: cx+1,    y2: mT+cH-(d.m/mx)*cH,         h2: (d.m/mx)*cH,
        });
      });
      const ly=H-14;
      ctx.fillStyle=C.blue; ctx.fillRect(W/2-80,ly,8,8);
      ctx.fillStyle='#8A94A6'; ctx.font='9px sans-serif'; ctx.textAlign='left'; ctx.fillText('Contratado',W/2-68,ly+7);
      ctx.fillStyle=C.green; ctx.fillRect(W/2+10,ly,8,8);
      ctx.fillStyle='#8A94A6'; ctx.fillText('Medido',W/2+22,ly+7);
      if(pr<1) requestAnimationFrame(draw);
    };
    requestAnimationFrame(draw);

    // ── Tooltip ────────────────────────────────────────────
    const wrapper = cv.parentElement;
    wrapper.style.position = 'relative';
    let tip = wrapper.querySelector('.dg-c2-tip');
    if (!tip) {
      tip = document.createElement('div');
      tip.className = 'dg-c2-tip';
      tip.style.cssText = 'position:absolute;background:#fff;border:1px solid #E8EDF5;border-radius:8px;padding:8px 12px;font-size:11px;color:#1E2A3B;pointer-events:none;display:none;z-index:10;white-space:nowrap;box-shadow:0 4px 16px rgba(100,130,200,.14)';
      wrapper.appendChild(tip);
    }
    cv.onmousemove = (evt) => {
      const rect = cv.getBoundingClientRect();
      const mx2 = evt.clientX - rect.left;
      const my2 = evt.clientY - rect.top;
      let found = false;
      for (const b of barRects) {
        const inBar1 = b.h1 > 0 && mx2 >= b.x1 && mx2 <= b.x1+b.w && my2 >= b.y1 && my2 <= b.y1+b.h1;
        const inBar2 = b.h2 > 0 && mx2 >= b.x2 && mx2 <= b.x2+b.w && my2 >= b.y2 && my2 <= b.y2+b.h2;
        if (inBar1 || inBar2) {
          const tipo = inBar1 ? 'Contratado' : 'Medido';
          const val  = inBar1 ? b.contratado : b.medido;
          const cor  = inBar1 ? C.blue : C.green;
          tip.innerHTML = `<div style="font-weight:700;color:#8A94A6;font-size:9px;margin-bottom:3px">${b.name}</div><div style="color:${cor}">${tipo}: <strong>${R$(val)}</strong></div>`;
          tip.style.display = 'block';
          const tipX = Math.min(evt.clientX - rect.left + 14, W - tip.offsetWidth - 8);
          const tipY = Math.max(evt.clientY - rect.top - 38, 4);
          tip.style.left = tipX + 'px';
          tip.style.top  = tipY + 'px';
          found = true;
          break;
        }
      }
      if (!found) tip.style.display = 'none';
    };
    cv.onmouseleave = () => { tip.style.display = 'none'; };
  }

  /* ═══ GRÁFICO 3 — Donut Animado (Situação) ═══════════════ */
  _chartDonut(sem,and,prox,conc,par,sus) {
    const cv = document.getElementById('dg-c3'); if (!cv) return;
    const ctx = cv.getContext('2d');
    const dpr = window.devicePixelRatio||1;
    const r = cv.getBoundingClientRect();
    cv.width = r.width*dpr; cv.height = r.height*dpr;
    ctx.scale(dpr,dpr);
    const W=r.width, H=r.height;
    const sl=[
      {l:'Sem medições',v:sem,c:C.slate},
      {l:'Em andamento',v:and,c:C.blue},
      {l:'Próx. conclusão',v:prox,c:C.amber},
      {l:'Concluídas',v:conc,c:C.green},
      {l:'Paralisadas',v:par,c:'#d97706'},
      {l:'Suspensas',v:sus,c:C.red},
    ].filter(s=>s.v>0);
    const tot=sl.reduce((s,x)=>s+x.v,0);
    if(!tot){ctx.fillStyle='#64748b';ctx.font='12px sans-serif';ctx.textAlign='center';ctx.fillText('Sem dados',W/2,H/2);return;}
    const cx=W/2, cy=H/2, R=Math.min(cx,cy)-16, iR=R*.55;
    const t0=performance.now(), dur=1000, aid=this._anim;
    const draw=(now)=>{
      if(aid!==this._anim) return;
      const pr=Math.min(1,(now-t0)/dur), e=1-Math.pow(1-pr,3), ta=Math.PI*2*e;
      ctx.clearRect(0,0,W,H);
      let sa=-Math.PI/2;
      sl.forEach(s=>{
        const a=(s.v/tot)*ta;
        ctx.beginPath(); ctx.moveTo(cx,cy); ctx.arc(cx,cy,R,sa,sa+a); ctx.closePath(); ctx.fillStyle=s.c; ctx.fill();
        sa+=a;
      });
      ctx.beginPath(); ctx.arc(cx,cy,iR,0,Math.PI*2); ctx.fillStyle='#F7F9FD'; ctx.fill();
      if(pr>.4){
        ctx.fillStyle='#1E2A3B'; ctx.font='bold 24px sans-serif'; ctx.textAlign='center'; ctx.textBaseline='middle';
        ctx.fillText(String(tot),cx,cy-6);
        ctx.fillStyle='#8A94A6'; ctx.font='9px sans-serif'; ctx.fillText('OBRAS',cx,cy+14);
      }
      if(pr<1) requestAnimationFrame(draw);
    };
    requestAnimationFrame(draw);
    const leg=document.getElementById('dg-leg');
    if(leg) leg.innerHTML=sl.map(s=>`<div style="display:flex;align-items:center;gap:5px;font-size:10px;color:#8A94A6"><span style="width:8px;height:8px;border-radius:2px;background:${s.c};flex-shrink:0"></span>${s.l}: <strong style="color:#1E2A3B">${s.v}</strong></div>`).join('');
  }

  /* ═══ EVENTOS ═════════════════════════════════════════════ */
  _bindEvents() {
    const recarregar = async () => {
      try {
        if (router.current !== 'dash-global') return;
        await this._carregarTudo();
        this._render();
      } catch(e) { console.error('[DashGlobalModule] event reload:', e); }
    };
    this._subs.push(
      EventBus.on('obra:criada',        recarregar, 'dash-global'),
      EventBus.on('boletim:atualizado', recarregar, 'dash-global'),
      EventBus.on('config:salva',       recarregar, 'dash-global'),
      EventBus.on('itens:atualizados',  recarregar, 'dash-global'),
    );
  }

  _exposeGlobals() {
    window.renderDashGlobal = () => { try { this.onEnter(); } catch(e){} };
    exposeGlobal('_dgFiltro', (campo, valor) => {
      try { this._filtros[campo] = valor; this._render(); } catch(e) {}
    });
    exposeGlobal('_dgBusca', v => { try { this._busca = v; this._render(); } catch(e) {} });
    exposeGlobal('_dgLimparFiltros', () => {
      try { this._filtros={ano:'',status:'',contratada:'',fiscal:''}; this._busca=''; this._render(); } catch(e) {}
    });
    exposeGlobal('_dgRecarregar', async () => {
      try {
        this._loading = true;
        this._render();
        await this._carregarTudo();
        this._render();
      } catch(e) {
        console.error('[DashGlobalModule] _dgRecarregar:', e);
        this._loading = false;
        this._render();
      }
    });
    exposeGlobal('_dgAbrirObra', async obraId => {
      try {
        state.set('obraAtivaId', obraId);
        state.persist?.(['obraAtivaId']);
        // Carrega cfg, bms e itens antes de emitir obra:selecionada
        const [cfg, bms, itens] = await Promise.all([
          FirebaseService.getObraCfg(obraId).catch(() => null),
          FirebaseService.getBMs(obraId).catch(() => null),
          FirebaseService.getItens(obraId).catch(() => null),
        ]);
        if (cfg)                   state.set('cfg',           cfg);
        if (bms   && bms.length)   state.set('bms',           bms);
        if (itens && itens.length) state.set('itensContrato', itens);
        EventBus.emit('obra:selecionada', { obraId });
        router.navigate('dashboard');
      } catch(e) { console.warn('[DashGlobal] _dgAbrirObra:', e); }
    });
  }

  destroy() { this._subs.forEach(u => u()); this._subs = []; }
}
