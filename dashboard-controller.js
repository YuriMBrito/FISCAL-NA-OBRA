/**
 * ╔══════════════════════════════════════════════════════════════╗
 * ║  FISCAL NA OBRA v15.1 — dashboard-controller.js              ║
 * ║  Dashboard RECRIADO — layout moderno e organizado          ║
 * ╚══════════════════════════════════════════════════════════════╝
 *
 * ▸ Layout: injetado no container #dashboard .dash-dark
 * ▸ Dados: mesma lógica de cálculo (bm-calculos.js)
 * ▸ Responsivo: flex + grid, sem quebras em telas pequenas
 */

import EventBus        from '../../core/EventBus.js';
import state           from '../../core/state.js';
import router          from '../../core/router.js';
import { formatters }  from '../../utils/formatters.js';
import FirebaseService from '../../firebase/firebase-service.js';
import {
  getValorAcumuladoTotal,
  getValorAcumuladoAnterior,
  getValorMedicaoAtual,
  getQtdAcumuladoTotalItem,
  getMedicoes,
  _injetarCacheMedicoes,
  getBdiEfetivo,
} from '../boletim-medicao/bm-calculos.js';

const R$  = v => formatters.currency ? formatters.currency(v) : (v||0).toLocaleString('pt-BR',{style:'currency',currency:'BRL'});
const pct = v => ((v||0).toFixed(2)).replace('.',',') + ' %';
const bar = (p,cor) => `<div style="height:6px;border-radius:3px;background:${cor}22;overflow:hidden">
  <div style="height:6px;border-radius:3px;background:${cor};width:${Math.min(100,Math.max(0,p))}%;transition:width .4s"></div></div>`;

export class DashboardModule {
  constructor() {
    this._subs = [];
    this._renderTimer = null;   // FIX-CHARTS: debounce timer
    this._renderToken = 0;      // FIX-CHARTS: cancellation token
  }

  async init() {
    try {
      // Cache calc functions for tab renders (imported at module top level)
      this._calcFuncs = { getValorAcumuladoTotal, getValorAcumuladoAnterior, getValorMedicaoAtual, getQtdAcumuladoTotalItem };
      this._bindEvents(); this._exposeGlobals();
    }
    catch(e) { console.error('[DashboardModule] init:', e); }
  }

  onEnter() {
    try { this._renderImediato(); }
    catch(e) { console.error('[DashboardModule] onEnter:', e); }
    // Lei 14.133: verifica responsáveis da obra após render
    setTimeout(() => this._verificarResponsaveisLei(), 800);
  }

  async _verificarResponsaveisLei() {
    // FIX: alertas de responsáveis (ex: "Obra sem Gestor") são exibidos
    // exclusivamente no card "Alertas Automáticos" dentro do dashboard.
    // O banner #dash-alertas-lei (topo) foi suprimido para evitar duplicidade.
    try {
      const container = document.getElementById('dash-alertas-lei');
      if (container) container.innerHTML = ''; // garante que está vazio
    } catch(e) { /* silencioso */ }
  }

  // ═══════════════════════════════════════════════════════════════
  //  RENDER PRINCIPAL
  // ═══════════════════════════════════════════════════════════════
  _tabAtual = 'visao'; // 'visao' | 'indicadores' | 'painel'

  // FIX-CHARTS: wrapper com debounce de 80ms para colapsar múltiplos
  // re-renders disparados em cascata por obra:selecionada → config:salva →
  // boletim:atualizado → itens:atualizados. Sem isso, cada evento destrói
  // os <canvas> do render anterior antes que os gráficos sejam desenhados.
  _render(tab) {
    if (tab) this._tabAtual = tab;
    if (this._renderTimer) clearTimeout(this._renderTimer);
    // FIX-CHARTS: debounce de 200ms (era 80ms).
    // O bm-controller executa invalidarCacheMedicoes + fetch Firebase ao receber
    // obra:selecionada. Com 80ms o dashboard renderizava antes do bm-controller
    // terminar, encontrava o cache vazio e buscava do Firebase em paralelo,
    // gerando uma corrida. 200ms dá tempo suficiente para o bm-controller
    // popular o cache antes do dashboard renderizar os gráficos.
    this._renderTimer = setTimeout(() => { this._renderTimer = null; this._renderImediato(); }, 200);
  }

  _renderImediato(tab) {
    try {
      if (tab) this._tabAtual = tab;
      const obraId = state.get('obraAtivaId');
      const cfg    = state.get('cfg')            || {};
      const bms    = state.get('bms')            || [];
      const itens  = state.get('itensContrato')  || [];

      // v24.1 FIX: sempre usa #dashboard como container raiz para evitar que
      // _htmlSemObra() destrua o .dash-dark e depois _render real caia no
      // fallback getElementById('dashboard'), exibindo ambos simultaneamente.
      const container = document.getElementById('dashboard');
      if (!container) return;

      // Garante que .dash-dark existe sempre como único filho de #dashboard
      let inner = container.querySelector('.dash-dark');
      if (!inner) {
        inner = document.createElement('div');
        inner.className = 'dash-dark';
        container.innerHTML = '';
        container.appendChild(inner);
      }

      if (!obraId) {
        // Limpa conteúdo real anterior e exibe placeholder dentro do .dash-dark
        inner.innerHTML = this._htmlSemObra();
        return;
      }

      // Há obra selecionada — garante que o placeholder suma antes de renderizar
      inner.innerHTML = '';
      
      // ── Renderiza aba selecionada ────────────────────────────
      if (this._tabAtual === 'painel') {
        // Limpa conteúdo antigo que não seja o tab header
        const oldBody = inner.querySelector('#dash-tab-body');
        if (oldBody) oldBody.remove();
        this._renderTabHeader(inner, cfg, obraId);
        this._renderPainel(inner, obraId, cfg, bms, itens);
        return;
      }
      if (this._tabAtual === 'indicadores') {
        const oldBody2 = inner.querySelector('#dash-tab-body');
        if (oldBody2) oldBody2.remove();
        this._renderTabHeader(inner, cfg, obraId);
        this._renderIndicadores(inner, obraId, cfg, bms, itens);
        return;
      }
      // ── Visão Geral — remove tabs header se trocando de volta
      const oldHdr = inner.querySelector('#dash-tab-header');
      if (oldHdr) oldHdr.remove();
      const oldBdy = inner.querySelector('#dash-tab-body');
      if (oldBdy) oldBdy.remove();

      // ── Metadados ────────────────────────────────────────────
      const obrasLista  = state.get('obrasLista') || [];
      const obraRef     = obrasLista.find(o => o.id === obraId) || {};
      const statusObra  = obraRef.statusObra || 'Em andamento';
      const nomeObra    = cfg.objeto || obraRef.nome || 'Obra sem nome';

      // ── Financeiro ───────────────────────────────────────────
      // Usa cfg.valor se configurado; caso contrário, soma itens contratados (fallback)
      const _rnd2 = v => Math.round(v * 100) / 100;
      const _totalItens = () => {
        // Soma apenas itens FOLHA (sem filhos), excluindo G e SG puros.
        // Funciona para estruturas G→normal, MACRO→sub, SG→normal, aninhadas, etc.
        let t = 0;
        itens.forEach(it => {
          if (it.t === 'G' || it.t === 'SG') return;
          if (itens.some(x => x.id !== it.id && x.id.startsWith(it.id + '.'))) return;
          const bdiEf = getBdiEfetivo(it, cfg);
          const upBdi = (it.upBdi && it.upBdi > 0) ? it.upBdi : _rnd2((it.up || 0) * (1 + bdiEf));
          t += _rnd2((it.qtd || 0) * upBdi);
        });
        return Math.round(t * 100) / 100;
      };
      const valorContrato = (cfg.valor && cfg.valor > 0) ? cfg.valor : _totalItens();
      const itensSvc      = itens.filter(i => !i.t);
      const lastBm        = bms.length ? bms[bms.length-1] : null;
      const lastBmNum     = lastBm?.num || 0;
      let vAcumTotal=0, vMedAtual=0;
      try {
        if (lastBmNum > 0) {
          vAcumTotal = getValorAcumuladoTotal(obraId, lastBmNum, itens, cfg);
          const vAnt = getValorAcumuladoAnterior(obraId, lastBmNum, itens, cfg);
          vMedAtual  = getValorMedicaoAtual(obraId, lastBmNum, itens, cfg);
        }
      } catch(e) { console.warn('[Dash] fin calc:', e); }

      const saldo    = valorContrato - vAcumTotal;
      const pctFin   = valorContrato > 0 ? (vAcumTotal / valorContrato * 100) : 0;
      const bdiPct   = (cfg.bdi||0)*100;

      // ── Prazo ────────────────────────────────────────────────
      const hoje = new Date();
      let pctPrazo=0, diasRestantes='—', diasDecorridos=0, duracaoTotal=0;
      try {
        if (cfg.inicioPrev && cfg.termino) {
          const ini = new Date(cfg.inicioPrev), fim = new Date(cfg.termino);
          duracaoTotal    = Math.max(1, Math.round((fim-ini)/86400000));
          diasDecorridos  = Math.round((hoje-ini)/86400000);
          pctPrazo        = Math.min(100, Math.max(0, diasDecorridos/duracaoTotal*100));
          const dias      = Math.round((fim-hoje)/86400000);
          diasRestantes   = dias > 0 ? `${dias} dias` : dias === 0 ? 'Hoje' : `${Math.abs(dias)}d atrás`;
        } else if (cfg.duracaoDias && cfg.inicioPrev) {
          const ini = new Date(cfg.inicioPrev);
          duracaoTotal    = cfg.duracaoDias;
          diasDecorridos  = Math.round((hoje-ini)/86400000);
          pctPrazo        = Math.min(100, Math.max(0, diasDecorridos/duracaoTotal*100));
          diasRestantes   = `${Math.max(0,duracaoTotal-diasDecorridos)} dias`;
        }
      } catch(e) {}

      // ── Alertas ──────────────────────────────────────────────
      const alertas = this._gerarAlertas(bms, cfg, valorContrato, vAcumTotal, saldo, pctPrazo, pctFin);
      const desvio  = pctFin - pctPrazo;

      // ── HTML completo ─────────────────────────────────────────
      // Injeta tab header na visão geral
      this._renderTabHeader(inner, cfg, obraId);
      // Cria body div para a visão geral
      let _vgBody = inner.querySelector('#dash-tab-body');
      if (!_vgBody) { _vgBody = document.createElement('div'); _vgBody.id='dash-tab-body'; inner.appendChild(_vgBody); }
      _vgBody.innerHTML = `
        <style id="dash-design-v2">
          .ds-card{background:#fff;border-radius:16px;box-shadow:0 2px 20px rgba(100,130,200,.08);border:1px solid #E8EDF5;padding:20px}
          .ds-title{font-size:10.5px;font-weight:700;color:#8A94A6;text-transform:uppercase;letter-spacing:.7px;margin-bottom:14px}
        </style>

        <!-- HEADER OBRA -->
        <div style="background:#fff;border-radius:16px;box-shadow:0 2px 20px rgba(100,130,200,.08);border:1px solid #E8EDF5;padding:20px 24px;margin-bottom:16px;display:flex;align-items:center;justify-content:space-between;gap:16px;flex-wrap:wrap">
          <div style="display:flex;align-items:center;gap:16px;min-width:0;flex:1">
            <div style="width:48px;height:48px;border-radius:12px;background:linear-gradient(135deg,#E8785A,#F5A68A);display:flex;align-items:center;justify-content:center;font-size:22px;flex-shrink:0">🏗️</div>
            <div style="min-width:0">
              <div style="font-size:10px;font-weight:700;color:#8A94A6;text-transform:uppercase;letter-spacing:.7px;margin-bottom:3px">Obra em Fiscalização</div>
              <div style="font-size:18px;font-weight:800;color:#1E2A3B;line-height:1.3;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${nomeObra}</div>
              <div style="display:flex;flex-wrap:wrap;gap:14px;margin-top:6px">
                ${cfg.contrato?`<span style="font-size:11px;color:#8A94A6">Contrato: <strong style="color:#1E2A3B">${cfg.contrato}</strong></span>`:''}
                ${cfg.contratada?`<span style="font-size:11px;color:#8A94A6">Executora: <strong style="color:#1E2A3B">${cfg.contratada}</strong></span>`:''}
                ${cfg.fiscal?`<span style="font-size:11px;color:#8A94A6">Fiscal: <strong style="color:#1E2A3B">${cfg.fiscal}</strong></span>`:''}
                ${diasRestantes!=='—'?`<span style="font-size:11px;color:#8A94A6">Prazo: <strong style="color:#1E2A3B">${diasRestantes}</strong></span>`:''}
              </div>
            </div>
          </div>
          <div style="display:flex;align-items:center;gap:10px;flex-shrink:0">
            ${this._badgeStatus(statusObra)}
            <select style="font-size:11px;padding:6px 12px;border-radius:10px;border:1px solid #E8EDF5;background:#F7F9FD;color:#1E2A3B;cursor:pointer;outline:none" onchange="window._dashMudarStatus?.(this.value)">
              ${['Em andamento','Paralisada','Concluída'].map(s=>`<option ${s===statusObra?'selected':''}>${s}</option>`).join('')}
            </select>
          </div>
        </div>

        <!-- CHARTS ROW: bar + curva S + coral summary -->
        <div style="display:grid;grid-template-columns:1fr 1fr 300px;gap:16px;margin-bottom:16px;align-items:start">
          <div style="background:#fff;border-radius:16px;box-shadow:0 2px 20px rgba(100,130,200,.08);border:1px solid #E8EDF5;padding:20px">
            <div style="font-size:10.5px;font-weight:700;color:#8A94A6;text-transform:uppercase;letter-spacing:.7px">Valor dos Boletins de Medição</div>
            <div style="font-size:11px;color:#A0AABB;margin-top:2px;margin-bottom:14px">Evolução financeira por BM</div>
            <div style="position:relative;height:190px"><canvas id="dash-chart-bms-mes"></canvas></div>
          </div>
          <div style="background:#fff;border-radius:16px;box-shadow:0 2px 20px rgba(100,130,200,.08);border:1px solid #E8EDF5;padding:20px">
            <div style="font-size:10.5px;font-weight:700;color:#8A94A6;text-transform:uppercase;letter-spacing:.7px">Curva S — Previsto vs Realizado</div>
            <div style="font-size:11px;color:#A0AABB;margin-top:2px;margin-bottom:14px">Avanço acumulado (%)</div>
            <div style="position:relative;height:190px"><canvas id="dash-chart-curva-s"></canvas></div>
          </div>
          <div style="border-radius:16px;overflow:hidden;box-shadow:0 4px 24px rgba(232,120,90,.22)">
            <div style="background:linear-gradient(135deg,#E8785A 0%,#F5A07A 100%);padding:20px 20px 18px">
              <div style="font-size:9.5px;font-weight:700;color:rgba(255,255,255,.75);text-transform:uppercase;letter-spacing:.7px;margin-bottom:5px">Valor do Contrato</div>
              <div style="font-size:20px;font-weight:900;color:#fff;font-family:var(--font-mono);line-height:1.15">${R$(valorContrato)}</div>
              <div style="font-size:10px;color:rgba(255,255,255,.75);margin-top:3px">${cfg.contrato||'Contrato não definido'}</div>
            </div>
            <div style="background:#fff;padding:16px 20px">
              <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-bottom:14px">
                <div>
                  <div style="font-size:9px;color:#8A94A6;font-weight:700;text-transform:uppercase;letter-spacing:.5px;margin-bottom:3px">Acumulado</div>
                  <div style="font-size:13px;font-weight:800;color:#1E2A3B;font-family:var(--font-mono)">${R$(vAcumTotal)}</div>
                  <div style="font-size:9.5px;color:#4DBFA8;font-weight:700;margin-top:2px">+${pct(pctFin).trim()}</div>
                </div>
                <div>
                  <div style="font-size:9px;color:#8A94A6;font-weight:700;text-transform:uppercase;letter-spacing:.5px;margin-bottom:3px">Saldo</div>
                  <div style="font-size:13px;font-weight:800;color:${saldo<0?'#E05252':'#1E2A3B'};font-family:var(--font-mono)">${R$(saldo)}</div>
                  <div style="font-size:9.5px;color:${saldo<0?'#E05252':'#8A94A6'};margin-top:2px">${valorContrato>0?pct(Math.max(0,saldo/valorContrato*100)).trim()+' restante':'—'}</div>
                </div>
              </div>
              <div style="font-size:9px;color:#8A94A6;margin-bottom:5px">Execução financeira</div>
              <div style="height:5px;border-radius:3px;background:#F0F4FB;overflow:hidden">
                <div style="height:5px;border-radius:3px;background:linear-gradient(90deg,#E8785A,#F5A07A);width:${Math.min(100,Math.max(0,pctFin)).toFixed(1)}%;transition:width .5s"></div>
              </div>
              <div style="display:flex;justify-content:space-between;margin-top:4px">
                <span style="font-size:9px;color:#A0AABB">0%</span>
                <span style="font-size:9.5px;font-weight:700;color:#E8785A">${pct(pctFin).trim()}</span>
                <span style="font-size:9px;color:#A0AABB">100%</span>
              </div>
              <div style="margin-top:12px;padding-top:12px;border-top:1px solid #F0F4FB;display:flex;flex-direction:column;gap:8px">
                ${[['📋 BMs',String(bms.length),'#5B8ECC'],['📐 BDI',bdiPct.toFixed(1)+'%','#9179E0'],['📒 Última Med.',lastBm?lastBm.label:'—','#F0A742']].map(([l,v,c])=>`
                  <div style="display:flex;justify-content:space-between;align-items:center">
                    <span style="font-size:10.5px;color:#8A94A6">${l}</span>
                    <span style="font-size:10.5px;font-weight:700;color:${c}">${v}</span>
                  </div>`).join('')}
              </div>
            </div>
          </div>
        </div>

        <!-- KPI GRID 8 cards -->
        <div style="display:grid;grid-template-columns:repeat(4,1fr);gap:12px;margin-bottom:16px">
          ${[
            ['Valor Contratual',  R$(valorContrato),  '100% do contrato',  '#5B8ECC','💰'],
            ['Acumulado Medido',  R$(vAcumTotal),     pct(pctFin)+' do contrato', '#4DBFA8','✅'],
            ['Saldo a Executar',  R$(saldo),          valorContrato>0?pct(Math.max(0,saldo/valorContrato*100))+' restante':'—', saldo<0?'#E05252':'#F0A742','⏳'],
            ['Última Medição',    R$(vMedAtual),      lastBm?lastBm.label:'—',  '#9179E0','📋'],
            ['BDI',               bdiPct.toFixed(2)+' %', itensSvc.length+' itens', '#0891b2','📐'],
            ['Boletins (BMs)',    String(bms.length), lastBm?lastBm.mes||lastBm.label:'Nenhum BM', '#475569','📒'],
            ['% Financeiro',      pct(pctFin),        pctFin>=90?'✅ Ótimo':pctFin>=50?'Em andamento':'⚠️ Baixo', pctFin>=90?'#4DBFA8':pctFin>=50?'#F0A742':'#5B8ECC','📈'],
            ['% Prazo Decorrido', pct(pctPrazo),      diasRestantes, pctPrazo>100?'#E05252':'#F0A742','⏱️'],
          ].map(([l,v,s,c,i])=>`
            <div style="background:#fff;border-radius:14px;box-shadow:0 2px 14px rgba(100,130,200,.07);border:1px solid #E8EDF5;padding:16px;border-top:3px solid ${c}">
              <div style="display:flex;align-items:center;gap:7px;margin-bottom:10px">
                <span style="font-size:14px">${i}</span>
                <span style="font-size:8.5px;font-weight:700;color:#8A94A6;text-transform:uppercase;letter-spacing:.5px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${l}</span>
              </div>
              <div style="font-size:15px;font-weight:800;color:#1E2A3B;font-family:var(--font-mono);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;line-height:1.2;margin-bottom:3px">${v}</div>
              <div style="font-size:9.5px;color:#A0AABB;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${s}</div>
            </div>`).join('')}
        </div>

        <!-- DISTRIBUIÇÃO TOP 10 full width -->
        <div style="background:#fff;border-radius:16px;box-shadow:0 2px 20px rgba(100,130,200,.08);border:1px solid #E8EDF5;padding:20px;margin-bottom:16px">
          <div style="margin-bottom:12px">
            <div style="font-size:10.5px;font-weight:700;color:#8A94A6;text-transform:uppercase;letter-spacing:.7px">Distribuição de Execução por Item (Top 10)</div>
            <div style="font-size:11px;color:#A0AABB;margin-top:2px">Valor executado acumulado por item do contrato</div>
          </div>
          <div style="position:relative;height:250px"><canvas id="dash-chart-dist-itens"></canvas></div>
        </div>

        <!-- PROGRESSO + ALERTAS -->
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:16px;margin-bottom:16px">
          <div style="background:#fff;border-radius:16px;box-shadow:0 2px 20px rgba(100,130,200,.08);border:1px solid #E8EDF5;padding:20px">
            <div style="font-size:10.5px;font-weight:700;color:#8A94A6;text-transform:uppercase;letter-spacing:.7px;margin-bottom:18px">📊 Avanço da Obra</div>
            <div style="display:flex;flex-direction:column;gap:16px">
              ${this._barraProgresso('% Financeiro',pctFin,'#E8785A')}
              ${this._barraProgresso('% Prazo Decorrido',pctPrazo,'#5B8ECC')}
              ${this._barraProgresso('Desvio Físico',Math.abs(desvio),desvio>=0?'#4DBFA8':'#E05252',(desvio>=0?'+':'')+desvio.toFixed(2).replace('.',',')+'%',desvio>=0?'À frente':'Abaixo')}
            </div>
          </div>
          <div style="background:#fff;border-radius:16px;box-shadow:0 2px 20px rgba(100,130,200,.08);border:1px solid #E8EDF5;padding:20px">
            <div style="font-size:10.5px;font-weight:700;color:#8A94A6;text-transform:uppercase;letter-spacing:.7px;margin-bottom:14px">⚠️ Alertas Automáticos</div>
            ${alertas.length ? alertas.map(a=>this._alerta(a)).join('') : '<div style="display:flex;align-items:center;gap:10px;font-size:12px;color:#4DBFA8;padding:10px 0"><span style="font-size:18px">✅</span><span>Tudo em ordem. Nenhum alerta ativo.</span></div>'}
          </div>
        </div>

        <!-- BMs TABLE + PRAZO INFO -->
        <div style="display:grid;grid-template-columns:1fr 320px;gap:16px;margin-bottom:16px;align-items:start">
          <div style="background:#fff;border-radius:16px;box-shadow:0 2px 20px rgba(100,130,200,.08);border:1px solid #E8EDF5;padding:20px">
            <div style="display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:8px;margin-bottom:14px">
              <div>
                <div style="font-size:10.5px;font-weight:700;color:#8A94A6;text-transform:uppercase;letter-spacing:.7px">Boletins de Medição</div>
                <div style="font-size:11px;color:#A0AABB;margin-top:2px">${bms.length} boletim(ns) registrado(s)</div>
              </div>
              <div style="display:flex;gap:8px">
                <button class="btn btn-pdf btn-sm" data-action="imprimirRegistroBMs">📄 PDF</button>
                <button class="btn btn-azul btn-sm" data-action="verPagina" data-arg0="boletim">📋 Abrir Boletim</button>
              </div>
            </div>
            ${bms.length ? `
            <div style="overflow-x:auto;border-radius:10px;border:1px solid #EEF2F9">
              <table style="width:100%;border-collapse:collapse;font-size:11.5px">
                <thead>
                  <tr style="background:#F7F9FD">
                    ${['Nº','Período','Data','Valor BM','% BM','Acumulado','% Acum.','Saldo','Status'].map(h=>`<th style="padding:9px 10px;font-size:8.5px;font-weight:700;color:#8A94A6;text-transform:uppercase;letter-spacing:.4px;border-bottom:1px solid #E8EDF5;text-align:${h==='Nº'||h==='Data'||h==='Status'?'center':'right'};white-space:nowrap">${h}</th>`).join('')}
                  </tr>
                </thead>
                <tbody>${this._linhasBMs(obraId, bms, itens, cfg, valorContrato)}</tbody>
                <tfoot>
                  <tr style="background:#F7F9FD;font-weight:700">
                    <td colspan="3" style="padding:9px 10px;text-align:right;font-size:8.5px;font-weight:700;color:#8A94A6;text-transform:uppercase;letter-spacing:.5px;border-top:2px solid #E8EDF5">TOTAL</td>
                    <td style="padding:9px 10px;text-align:right;font-family:var(--font-mono);border-top:2px solid #E8EDF5">${R$(vAcumTotal)}</td>
                    <td style="padding:9px 10px;text-align:right;border-top:2px solid #E8EDF5">${pct(pctFin)}</td>
                    <td style="padding:9px 10px;text-align:right;font-family:var(--font-mono);border-top:2px solid #E8EDF5">${R$(vAcumTotal)}</td>
                    <td style="padding:9px 10px;text-align:right;border-top:2px solid #E8EDF5">${pct(pctFin)}</td>
                    <td style="padding:9px 10px;text-align:right;font-family:var(--font-mono);border-top:2px solid #E8EDF5;color:${saldo<0?'#E05252':'inherit'}">${R$(saldo)}</td>
                    <td style="border-top:2px solid #E8EDF5"></td>
                  </tr>
                </tfoot>
              </table>
            </div>
            <div id="dash-bm-detalhe" style="display:none;margin-top:12px;padding:14px;background:#F7F9FD;border:1px solid #E8EDF5;border-radius:10px"></div>
            ` : `<div style="text-align:center;padding:40px;color:#8A94A6;font-size:13px">Nenhum BM registrado ainda.<br><button class="btn btn-verde btn-sm" style="margin-top:14px" data-action="verPagina" data-arg0="config">➕ Adicionar BM</button></div>`}
          </div>
          <div style="display:flex;flex-direction:column;gap:12px">
            <div style="background:#fff;border-radius:16px;box-shadow:0 2px 20px rgba(100,130,200,.08);border:1px solid #E8EDF5;padding:20px">
              <div style="font-size:10.5px;font-weight:700;color:#8A94A6;text-transform:uppercase;letter-spacing:.7px;margin-bottom:14px">📅 Informações de Prazo</div>
              <div style="display:flex;flex-direction:column;gap:7px">
                ${[['Início Previsto',cfg.inicioPrev?new Date(cfg.inicioPrev).toLocaleDateString('pt-BR'):'—'],['Término Previsto',cfg.termino?new Date(cfg.termino).toLocaleDateString('pt-BR'):'—'],['Dias Decorridos',duracaoTotal>0?`${Math.max(0,diasDecorridos)} / ${duracaoTotal}`:'—'],['Dias Restantes',diasRestantes],['Fiscal',cfg.fiscal||'—'],['Contratada',cfg.contratada||'—']].map(([l,v])=>`
                  <div style="display:flex;justify-content:space-between;align-items:center;padding:7px 10px;border-radius:8px;background:#F7F9FD">
                    <span style="font-size:11px;color:#8A94A6">${l}</span>
                    <span style="font-size:11px;font-weight:600;color:#1E2A3B;max-width:55%;text-overflow:ellipsis;overflow:hidden;white-space:nowrap;text-align:right" title="${v}">${v}</span>
                  </div>`).join('')}
              </div>
            </div>
            <div style="background:#fff;border-radius:16px;box-shadow:0 2px 20px rgba(100,130,200,.08);border:1px solid #E8EDF5;padding:20px">
              <div style="font-size:10.5px;font-weight:700;color:#8A94A6;text-transform:uppercase;letter-spacing:.7px;margin-bottom:14px">📊 Resumo de Medições</div>
              <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px">
                ${[['Total BMs',String(bms.length),'#5B8ECC'],['Valor Contrato',R$(valorContrato),'#E8785A'],['Total Medido',R$(vAcumTotal),'#4DBFA8'],['% Executado',pct(pctFin),pctFin>=50?'#4DBFA8':'#F0A742']].map(([l,v,c])=>`
                  <div style="background:#F7F9FD;border-radius:10px;padding:10px 12px;text-align:center;border-top:2px solid ${c}">
                    <div style="font-size:13px;font-weight:800;color:#1E2A3B;font-family:var(--font-mono);overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${v}</div>
                    <div style="font-size:8.5px;color:#8A94A6;text-transform:uppercase;letter-spacing:.4px;margin-top:3px">${l}</div>
                  </div>`).join('')}
              </div>
            </div>
          </div>
        </div>

        ${this._htmlAnalyticsResumo(obraId, cfg, bms, itens, vAcumTotal)}
        ${this._htmlPainelContratualSecao(obraId, cfg, bms, itens, vAcumTotal, saldo, pctFin, diasRestantes)}`;

      // Reinjecta handlers
      this._bindLocalHandlers(obraId, bms, itens, cfg, valorContrato);
      // Re-render tab header on visao to update active tab highlight
      this._renderTabHeader(inner, cfg, obraId);

      // Renderiza gráficos após o DOM estar pronto
      // Usa retry para garantir que Chart.js (carregado com defer) esteja disponível
      const _renderCharts = (tentativa = 0) => {
        if (typeof Chart === 'undefined') {
          // FIX-CHARTS-CDN: tenta carregar de jsDelivr como fallback se cdnjs falhar
          if (tentativa === 10 && !document.querySelector('script[src*="jsdelivr"][src*="chart"]')) {
            const fb = document.createElement('script');
            fb.src = 'https://cdn.jsdelivr.net/npm/chart.js@4.4.1/dist/chart.umd.min.js';
            fb.defer = true;
            document.head.appendChild(fb);
          }
          if (tentativa < 40) setTimeout(() => _renderCharts(tentativa + 1), 200);
          return;
        }
        // FIX-CHARTS-V3: re-lê bms/itens/cfg do state no momento da execução
        // para evitar closure stale capturado quando o cache ainda estava vazio.
        const _bms   = state.get('bms')           || bms;
        const _itens = state.get('itensContrato') || itens;
        const _cfg   = state.get('cfg')           || cfg;
        const _vid   = state.get('obraAtivaId')   || obraId;
        const _vCont = (_cfg.valor && _cfg.valor > 0) ? _cfg.valor : valorContrato;
        try { this._renderChartBmsMes(_bms); } catch(e) { console.warn('[Dash] chart bms:', e); }
        try { this._renderChartCurvaS(_vid, _bms, _itens, _cfg, _vCont); } catch(e) { console.warn('[Dash] chart curvaS:', e); }
        try { this._renderChartDistItens(_vid, _bms, _itens, _cfg); } catch(e) { console.warn('[Dash] chart dist:', e); }
      };
      // FIX-CHARTS: incrementa o token para cancelar renders obsoletos.
      // Se um segundo _renderImediato() rodar enquanto aguardamos o Firebase,
      // o token muda e o callback abaixo descarta o desenho sem tocar no DOM.
      const myToken = ++this._renderToken;

      // FIX-DASH-CHARTS: garante que o MemCache de medições está populado antes
      // de renderizar os gráficos. Sem isso, getValorAcumuladoTotal retorna 0
      // quando o usuário abre o dashboard sem ter visitado o módulo de BM antes.
      this._carregarMedicoesDash(obraId).then(() => {
        // FIX-CHARTS: duplo rAF — garante que o navegador completou o layout
        // (paint) antes de tentar usar o canvas; um único rAF não é suficiente
        // quando há MutationObservers que reinjetam elementos no DOM.
        // FIX-CHARTS-V2: removida a guarda _renderToken !== myToken para charts.
        // O token bloqueava o render de gráficos quando eventos concorrentes
        // (obra:selecionada, config:salva, boletim:atualizado) incrementavam o
        // token antes do .then resolver, deixando os cards vazios. As funções
        // de chart já fazem `if (!canvas) return` como guarda natural.
        requestAnimationFrame(() => requestAnimationFrame(() => {
          _renderCharts();
        }));
      });

    } catch(e) { console.error('[DashboardModule] _render:', e); }
  }

  // ═══════════════════════════════════════════════════════════════
  //  HTML HELPERS
  // ═══════════════════════════════════════════════════════════════
  // FIX-7: Removida mensagem "Nenhuma obra selecionada" e atalhos — não exibir nada
  _htmlSemObra() {
    // FIX-E4.3: onboarding de primeiro acesso — detecta se há obras cadastradas
    const obras = state.get('obrasLista') || [];
    const isPrimeiroAcesso = obras.length === 0;

    if (isPrimeiroAcesso) {
      return `
        <div style="display:flex;flex-direction:column;align-items:center;justify-content:center;
          min-height:60vh;padding:40px 24px;text-align:center">

          <div style="font-size:48px;margin-bottom:16px">🏗️</div>
          <div style="font-size:20px;font-weight:800;color:var(--text-primary);margin-bottom:8px">
            Bem-vindo ao Fiscal na Obra
          </div>
          <div style="font-size:14px;color:var(--text-muted);margin-bottom:32px;max-width:440px;line-height:1.7">
            Siga os 3 passos abaixo para começar a fiscalizar sua primeira obra.
          </div>

          <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(200px,1fr));
            gap:16px;width:100%;max-width:700px;margin-bottom:32px">

            <!-- Passo 1 -->
            <div style="background:var(--bg-surface);border:1px solid var(--border);
              border-radius:12px;padding:20px;text-align:left;border-top:3px solid var(--accent)">
              <div style="font-size:11px;font-weight:700;color:var(--accent);
                text-transform:uppercase;letter-spacing:1px;margin-bottom:8px">Passo 1</div>
              <div style="font-size:14px;font-weight:700;color:var(--text-primary);margin-bottom:6px">
                📋 Criar obra
              </div>
              <div style="font-size:12px;color:var(--text-muted);margin-bottom:14px;line-height:1.6">
                Registre o contrato, contratante, contratada e dados iniciais da obra.
              </div>
              <button data-action="verPagina" data-arg0="obras-manager"
                style="width:100%;padding:9px;background:var(--accent);border:none;
                border-radius:8px;color:#fff;font-size:12px;font-weight:700;cursor:pointer">
                Criar primeira obra →
              </button>
            </div>

            <!-- Passo 2 -->
            <div style="background:var(--bg-surface);border:1px solid var(--border);
              border-radius:12px;padding:20px;text-align:left;border-top:3px solid var(--color-warning, #f59e0b)">
              <div style="font-size:11px;font-weight:700;color:var(--color-warning, #f59e0b);
                text-transform:uppercase;letter-spacing:1px;margin-bottom:8px">Passo 2</div>
              <div style="font-size:14px;font-weight:700;color:var(--text-primary);margin-bottom:6px">
                📊 Importar SINAPI
              </div>
              <div style="font-size:12px;color:var(--text-muted);margin-bottom:14px;line-height:1.6">
                Importe a planilha de itens do SINAPI (Excel exportado pela CEF) para montar o contrato.
              </div>
              <button data-action="verPagina" data-arg0="sinapi"
                style="width:100%;padding:9px;background:var(--color-warning, #f59e0b);border:none;
                border-radius:8px;color:#fff;font-size:12px;font-weight:700;cursor:pointer">
                Importar planilha →
              </button>
            </div>

            <!-- Passo 3 -->
            <div style="background:var(--bg-surface);border:1px solid var(--border);
              border-radius:12px;padding:20px;text-align:left;border-top:3px solid var(--color-success, #22c55e)">
              <div style="font-size:11px;font-weight:700;color:var(--color-success, #22c55e);
                text-transform:uppercase;letter-spacing:1px;margin-bottom:8px">Passo 3</div>
              <div style="font-size:14px;font-weight:700;color:var(--text-primary);margin-bottom:6px">
                ⚙️ Configurar contrato
              </div>
              <div style="font-size:12px;color:var(--text-muted);margin-bottom:14px;line-height:1.6">
                Defina BDI, fiscal responsável, datas e demais dados do contrato.
              </div>
              <button data-action="verPagina" data-arg0="config"
                style="width:100%;padding:9px;background:var(--color-success, #22c55e);border:none;
                border-radius:8px;color:#fff;font-size:12px;font-weight:700;cursor:pointer">
                Configurar →
              </button>
            </div>
          </div>

          <div style="font-size:11px;color:var(--text-muted)">
            Dúvidas? Acesse <strong>Sistema → Diagnóstico</strong> para verificar o estado do sistema.
          </div>
        </div>`;
    }

    // Há obras mas nenhuma selecionada — orientar a selecionar
    return `
      <div style="display:flex;flex-direction:column;align-items:center;justify-content:center;
        min-height:50vh;padding:40px 24px;text-align:center">
        <div style="font-size:36px;margin-bottom:12px">📂</div>
        <div style="font-size:16px;font-weight:700;color:var(--text-primary);margin-bottom:8px">
          Nenhuma obra selecionada
        </div>
        <div style="font-size:13px;color:var(--text-muted);margin-bottom:20px">
          Selecione uma obra na barra lateral ou crie uma nova.
        </div>
        <button data-action="verPagina" data-arg0="obras-manager"
          style="padding:10px 20px;background:var(--accent);border:none;border-radius:8px;
          color:#fff;font-size:13px;font-weight:700;cursor:pointer">
          Ver obras cadastradas →
        </button>
      </div>`;
  }

  _kpi(icon, label, valor, cor, sub) {
    return `
      <div style="background:#fff;border:1px solid #E8EDF5;border-radius:14px;
        padding:16px;border-top:3px solid ${cor};box-shadow:0 2px 14px rgba(100,130,200,.07);min-width:0;overflow:hidden">
        <div style="display:flex;align-items:center;gap:7px;margin-bottom:10px">
          <span style="font-size:14px">${icon}</span>
          <span style="font-size:8.5px;font-weight:700;color:#8A94A6;text-transform:uppercase;
            letter-spacing:.5px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${label}</span>
        </div>
        <div style="font-size:15px;font-weight:800;color:#1E2A3B;
          font-family:var(--font-mono);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;
          line-height:1.2;margin-bottom:4px">${valor}</div>
        ${sub ? `<div style="font-size:9.5px;color:#A0AABB;overflow:hidden;
          text-overflow:ellipsis;white-space:nowrap">${sub}</div>` : ''}
      </div>`;
  }

  _barraProgresso(label, valor, cor, valorLabel, subLabel) {
    const vl = valorLabel !== undefined ? valorLabel : pct(valor);
    return `
      <div>
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:7px">
          <span style="font-size:11px;color:#8A94A6;font-weight:500">${label}</span>
          <span style="font-size:12px;font-weight:800;color:${cor};font-family:var(--font-mono)">${vl}</span>
        </div>
        <div style="height:7px;border-radius:4px;background:${cor}18;overflow:hidden">
          <div style="height:7px;border-radius:4px;background:${cor};
            width:${Math.min(100,Math.max(0,valor))}%;transition:width .5s ease"></div>
        </div>
        ${subLabel ? `<div style="font-size:10px;color:${cor};margin-top:4px;font-weight:600">${subLabel}</div>` : ''}
      </div>`;
  }

  _badgeStatus(status) {
    const cores  = {'Em andamento':'#5B8ECC','Paralisada':'#E05252','Concluída':'#4DBFA8'};
    const icons  = {'Em andamento':'🔵','Paralisada':'🔴','Concluída':'🟢'};
    const cor    = cores[status] || '#8A94A6';
    return `<span style="display:inline-flex;align-items:center;gap:5px;font-size:10.5px;font-weight:700;
      padding:5px 12px;border-radius:99px;background:${cor}15;color:${cor};border:1px solid ${cor}30">
      ${icons[status]||'🔵'} ${status}</span>`;
  }

  _alerta({tipo,msg,icon}) {
    const bg   = {erro:'#fff5f5',warn:'#fffbeb',info:'#f0f7ff'};
    const bord = {erro:'#fca5a5',warn:'#fde68a',info:'#bfdbfe'};
    const txt  = {erro:'#dc2626',warn:'#b45309',info:'#2563eb'};
    return `
      <div style="display:flex;align-items:flex-start;gap:9px;padding:9px 12px;border-radius:10px;
        margin-bottom:6px;background:${bg[tipo]||bg.info};border:1px solid ${bord[tipo]||bord.info}">
        <span style="font-size:14px;flex-shrink:0;margin-top:1px">${icon}</span>
        <span style="font-size:11.5px;color:${txt[tipo]||txt.info};line-height:1.5">${msg}</span>
      </div>`;
  }

  _linhasBMs(obraId, bms, itens, cfg, valorContrato) {
    return bms.map(bm => {
      let vBm=0, vAcum=0;
      try {
        vAcum = getValorAcumuladoTotal(obraId, bm.num, itens, cfg);
        vBm   = vAcum - (getValorAcumuladoAnterior(obraId, bm.num, itens, cfg)||0);
      } catch {}
      const pBm   = valorContrato>0 ? vBm/valorContrato*100 : 0;
      const pAcum = valorContrato>0 ? vAcum/valorContrato*100 : 0;
      const saldo = valorContrato - vAcum;
      const isLast= bm.num === bms[bms.length-1].num;
      return `
        <tr style="cursor:pointer;border-bottom:1px solid var(--border)"
          data-action="_dashDetalheBM" data-arg0="${bm.num}"
          onmouseover="this.style.background='#F7F9FD'"
          onmouseout="this.style.background=''">
          <td style="padding:9px 10px;text-align:center;font-weight:700;
            font-family:var(--font-mono);font-size:11px">${bm.num}</td>
          <td style="padding:9px 10px;font-size:11px">${bm.mes||'—'}</td>
          <td style="padding:9px 10px;text-align:center;font-size:11px;white-space:nowrap">${bm.data||'—'}</td>
          <td style="padding:9px 10px;text-align:right;font-family:var(--font-mono);
            font-weight:700;font-size:12px;white-space:nowrap">${R$(vBm)}</td>
          <td style="padding:9px 10px;text-align:right;font-size:11px">${pct(pBm)}</td>
          <td style="padding:9px 10px;text-align:right;font-family:var(--font-mono);
            font-size:11px;white-space:nowrap">${R$(vAcum)}</td>
          <td style="padding:9px 10px;text-align:right;font-size:11px">${pct(pAcum)}</td>
          <td style="padding:9px 10px;text-align:right;font-family:var(--font-mono);
            font-size:11px;white-space:nowrap;color:${saldo<0?'#E05252':'inherit'}">${R$(saldo)}</td>
          <td style="padding:9px 10px;text-align:center">
            <span style="font-size:9px;font-weight:700;padding:3px 9px;border-radius:99px;
              background:${isLast?'rgba(91,142,204,.1)':'rgba(77,191,168,.1)'};color:${isLast?'#5B8ECC':'#4DBFA8'};
              border:1px solid ${isLast?'rgba(91,142,204,.25)':'rgba(77,191,168,.25)'}">
              ${isLast?'● Atual':'✓ OK'}
            </span>
          </td>
        </tr>`;
    }).join('');
  }

  _gerarAlertas(bms, cfg, valorContrato, vAcumTotal, saldo, pctPrazo, pctFin) {
    const alertas = [];

    if (!bms.length)
      alertas.push({tipo:'info',icon:'📋',msg:'Nenhum Boletim de Medição cadastrado ainda.'});
    if (valorContrato <= 0)
      alertas.push({tipo:'warn',icon:'⚠️',msg:'Valor contratual não configurado. Acesse Configurações.'});
    if (saldo < 0)
      alertas.push({tipo:'erro',icon:'🚨',msg:`Valor medido excede o contrato em ${R$(Math.abs(saldo))}.`});
    if (pctPrazo > 100 && pctFin < 90)
      alertas.push({tipo:'erro',icon:'⏰',msg:`Prazo expirado! Apenas ${pct(pctFin)} executado financeiramente.`});
    if (!cfg.fiscal)
      alertas.push({tipo:'info',icon:'ℹ️',msg:'Fiscal do contrato não informado. Acesse Configurações.'});
    if (pctPrazo > 80 && pctFin < 50)
      alertas.push({tipo:'warn',icon:'📉',msg:`Avanço físico (${pct(pctFin)}) muito abaixo do prazo (${pct(pctPrazo)}).`});

    // ── BMs sem data definida ────────────────────────────────────
    const bmsSemData = bms.filter(b => !b.data);
    if (bmsSemData.length)
      alertas.push({tipo:'warn',icon:'📅',msg:`${bmsSemData.length} Boletim(ns) sem data de medição definida: ${bmsSemData.map(b=>b.label).join(', ')}.`});

    // ── BMs não bloqueados (desbloqueados há muito tempo) ────────
    try {
      const obraId = state.get('obraAtivaId');
      const DIAS_SEM_BLOQUEAR = 30;
      bms.forEach(bm => {
        try {
          const med = getMedicoes(obraId, bm.num);
          if (med && !med._salva && med._salvaEm === undefined) {
            // BM que nunca foi bloqueado — verificar se tem conteúdo
            const temConteudo = Object.keys(med).some(k => !k.startsWith('_'));
            if (temConteudo) {
              alertas.push({tipo:'warn',icon:'🔓',msg:`${bm.label} tem medição não bloqueada (Marcar como Salvo pendente).`});
            }
          }
        } catch(e) {}
      });
    } catch(e) {}

    // ── Notificações com prazo vencido ──────────────────────────
    try {
      const notifs = state.get('notificacoes') || [];
      const hoje = new Date();
      const vencidas = notifs.filter(n => {
        if (!n.prazoResposta || n.status === 'respondida' || n.status === 'encerrada') return false;
        return new Date(n.prazoResposta + 'T23:59:59') < hoje;
      });
      if (vencidas.length)
        alertas.push({tipo:'erro',icon:'🔔',msg:`${vencidas.length} notificação(ões) com prazo de resposta VENCIDO sem resposta. Acesse Notificações.`});

      const vencendoEm7 = notifs.filter(n => {
        if (!n.prazoResposta || n.status === 'respondida' || n.status === 'encerrada') return false;
        const dias = Math.ceil((new Date(n.prazoResposta + 'T23:59:59') - hoje) / 86400000);
        return dias >= 0 && dias <= 7;
      });
      if (vencendoEm7.length)
        alertas.push({tipo:'warn',icon:'⏰',msg:`${vencendoEm7.length} notificação(ões) com prazo vencendo nos próximos 7 dias.`});
    } catch(e) {}

    // ── Diário sem registros recentes (últimos 7 dias úteis) ─────
    try {
      const diario = state.get('diario') || [];
      if (diario.length > 0) {
        const hoje = new Date();
        const seteDiasAtras = new Date(hoje);
        seteDiasAtras.setDate(seteDiasAtras.getDate() - 7);
        const ultimaEntrada = diario
          .map(e => e.data || e.criadoEm?.slice(0,10) || '')
          .filter(Boolean)
          .sort()
          .pop();
        if (ultimaEntrada && ultimaEntrada < seteDiasAtras.toISOString().slice(0,10)) {
          const diasSemRegistro = Math.ceil((hoje - new Date(ultimaEntrada + 'T12:00:00')) / 86400000);
          alertas.push({tipo:'warn',icon:'📓',msg:`Diário de Obras sem novos registros há ${diasSemRegistro} dias. Mantenha o diário atualizado.`});
        }
      }
    } catch(e) {}

    // ── Responsáveis com portaria vencida ────────────────────────
    try {
      const responsaveis = state.get('responsaveis') || [];
      const hoje = new Date();
      const portariasVencidas = responsaveis.filter(r =>
        r.dataVigenciaFim && new Date(r.dataVigenciaFim + 'T23:59:59') < hoje
      );
      if (portariasVencidas.length)
        alertas.push({tipo:'warn',icon:'📋',msg:`${portariasVencidas.length} responsável(is) com portaria de designação VENCIDA. Acesse Responsáveis.`});
    } catch(e) {}

    return alertas;
  }

  // ═══════════════════════════════════════════════════════════════
  //  GRÁFICOS ANALÍTICOS
  // ═══════════════════════════════════════════════════════════════

  /**
   * FIX-DASH-CHARTS: Popula o MemCache de medições do Firebase para todos os
   * BMs da obra antes de renderizar os gráficos. Necessário quando o usuário
   * abre o dashboard diretamente sem ter visitado o módulo de BM antes
   * (caso em que o cache ainda está vazio e getValorAcumuladoTotal retorna 0).
   */
  async _carregarMedicoesDash(obraId) {
    if (!obraId) return;
    const bms = state.get('bms') || [];
    if (!bms.length) return;
    const totalBMs = bms[bms.length - 1].num;
    const promises = [];
    for (let n = 1; n <= totalBMs; n++) {
      const cached = getMedicoes(obraId, n);
      // FIX-3: ignora chaves de metadados (_salva, _obs_*, etc.) — exige dados reais de itens
      const temDadosReais = Object.keys(cached).some(k => !k.startsWith('_'));
      if (temDadosReais) continue;
      promises.push(
        FirebaseService.getMedicoes(obraId, n)
          .then(med => {
            if (med && Object.keys(med).length > 0) {
              _injetarCacheMedicoes(obraId, n, med);
            }
          })
          .catch(() => {})
      );
    }
    await Promise.all(promises);
  }

  /** Gráfico 1: Barras — Quantidade de Boletins registrados por mês */
  _renderChartBmsMes(bms) {
    const canvas = document.getElementById('dash-chart-bms-mes');
    if (!canvas || typeof Chart === 'undefined') return;

    const obraId = state.get('obraAtivaId');
    const cfg    = state.get('cfg') || {};
    const itens  = state.get('itensContrato') || [];

    // FIX-DASH-CHARTS: usa as funções importadas diretamente no módulo em vez
    // de depender de window._bmCalc_* que pode não estar disponível.
    const labels = [];
    const dados  = [];

    bms.forEach(bm => {
      labels.push(bm.label || `BM ${bm.num}`);

      let vMed = 0;
      try {
        const vAnt = getValorAcumuladoAnterior(obraId, bm.num, itens, cfg);
        const vTot = getValorAcumuladoTotal(obraId, bm.num, itens, cfg);
        vMed = vTot - vAnt;
      } catch(e) { vMed = 0; }

      dados.push(Math.max(0, vMed));
    });

    // Limpa instância anterior se existir
    if (this._chartBmsMes) { this._chartBmsMes.destroy(); this._chartBmsMes = null; }

    const ctx = canvas.getContext('2d');
    this._chartBmsMes = new Chart(ctx, {
      type: 'bar',
      data: {
        labels,
        datasets: [{
          label: 'Valor do BM (R$)',
          data: dados,
          backgroundColor: dados.map((_, i) => {
            const p = ['rgba(91,142,204,.75)','rgba(77,191,168,.75)','rgba(240,167,66,.75)','rgba(145,121,224,.75)','rgba(232,120,90,.75)','rgba(224,82,82,.75)'];
            return p[i % p.length];
          }),
          borderColor: dados.map((_, i) => {
            const p = ['#5B8ECC','#4DBFA8','#F0A742','#9179E0','#E8785A','#E05252'];
            return p[i % p.length];
          }),
          borderWidth: 1,
          borderRadius: 8,
          maxBarThickness: 52,
        }]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        animation: { duration: 900, easing: 'easeOutQuart' },
        plugins: {
          legend: { display: false },
          tooltip: {
            callbacks: {
              label: ctx => {
                const v = ctx.parsed.y;
                return 'R$ ' + v.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
              }
            }
          }
        },
        scales: {
          x: {
            grid: { display: false },
            ticks: { font: { size: 10 }, color: '#6b7280' }
          },
          y: {
            beginAtZero: true,
            ticks: {
              font: { size: 9 },
              color: '#6b7280',
              callback: v => {
                if (v >= 1_000_000) return 'R$ ' + (v / 1_000_000).toFixed(1) + 'M';
                if (v >= 1_000)     return 'R$ ' + (v / 1_000).toFixed(0) + 'k';
                return 'R$ ' + v;
              }
            },
            grid: { color: '#e5e7eb44' }
          }
        }
      }
    });
  }

  /** Gráfico 2: Curva S — Evolução Prevista vs Realizado */
  _renderChartCurvaS(obraId, bms, itens, cfg, valorContrato) {
    const canvas = document.getElementById('dash-chart-curva-s');
    if (!canvas || typeof Chart === 'undefined') return;
    if (!bms.length || !valorContrato) {
      // FIX-CHARTS: exibe mensagem em vez de retornar silenciosamente
      const ctx = canvas.getContext('2d');
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      ctx.fillStyle = 'var(--text-muted, #9ca3af)';
      ctx.font = '12px sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText(
        !bms.length ? 'Nenhum BM registrado' : 'Valor do contrato não configurado',
        canvas.width / 2, canvas.height / 2
      );
      return;
    }

    const mesesAbrev = ['Jan','Fev','Mar','Abr','Mai','Jun','Jul','Ago','Set','Out','Nov','Dez'];

    // ── Dados do Realizado (acumulado por BM) ────────────────
    const labels    = [];
    const realizado = [];
    bms.forEach(bm => {
      let label = `BM ${bm.num}`;
      try {
        if (bm.mes && bm.mes !== '(a definir)') {
          const mesStr = String(bm.mes).toLowerCase().trim();
          const idx = mesesAbrev.findIndex(m => mesStr.includes(m.toLowerCase()));
          if (idx >= 0) {
            const anoMatch = mesStr.match(/(\d{4})/);
            label = mesesAbrev[idx] + (anoMatch ? '/' + anoMatch[1].slice(2) : '');
          } else {
            label = bm.mes.slice(0, 12);
          }
        } else if (bm.data) {
          const d = new Date(bm.data + 'T12:00:00');
          if (!isNaN(d)) label = mesesAbrev[d.getMonth()] + '/' + String(d.getFullYear()).slice(2);
        }
      } catch(e) {}
      labels.push(label);

      let vAcum = 0;
      try {
        vAcum = getValorAcumuladoTotal(obraId, bm.num, itens, cfg);
      } catch(e) {}
      const pctReal = valorContrato > 0 ? Math.min(100, (vAcum / valorContrato) * 100) : 0;
      realizado.push(parseFloat(pctReal.toFixed(2)));
    });

    // ── Dados do Previsto (distribuição linear ao longo dos BMs) ──
    const totalBms = bms.length;
    const previsto = [];

    // Tenta usar prazo previsto para interpolar, senão usa distribuição linear
    let usaPrazo = false;
    if (cfg.inicioPrev && cfg.termino) {
      try {
        const ini = new Date(cfg.inicioPrev);
        const fim = new Date(cfg.termino);
        const duracaoMs = fim - ini;
        if (duracaoMs > 0) {
          usaPrazo = true;
          bms.forEach(bm => {
            let dataBm = null;
            try {
              if (bm.data) dataBm = new Date(bm.data + 'T12:00:00');
            } catch(e) {}
            if (dataBm && !isNaN(dataBm)) {
              const elapsed = dataBm - ini;
              const pctPrevisto = Math.min(100, Math.max(0, (elapsed / duracaoMs) * 100));
              previsto.push(parseFloat(pctPrevisto.toFixed(2)));
            } else {
              // Fallback linear baseado na posição do BM
              const idx = bms.indexOf(bm);
              previsto.push(parseFloat(((idx + 1) / totalBms * 100).toFixed(2)));
            }
          });
        }
      } catch(e) {}
    }

    if (!usaPrazo) {
      // Distribuição linear simples
      bms.forEach((_, idx) => {
        previsto.push(parseFloat(((idx + 1) / totalBms * 100).toFixed(2)));
      });
    }

    // Limpa instância anterior
    if (this._chartCurvaS) { this._chartCurvaS.destroy(); this._chartCurvaS = null; }

    const ctx = canvas.getContext('2d');
    this._chartCurvaS = new Chart(ctx, {
      type: 'line',
      data: {
        labels,
        datasets: [
          {
            label: 'Previsto',
            data: previsto,
            borderColor: '#A0AABB',
            backgroundColor: '#A0AABB11',
            borderWidth: 2,
            borderDash: [6, 3],
            pointRadius: 3,
            pointBackgroundColor: '#A0AABB',
            tension: 0.35,
            fill: false,
          },
          {
            label: 'Realizado',
            data: realizado,
            borderColor: '#E8785A',
            backgroundColor: 'rgba(232,120,90,.12)',
            borderWidth: 2.5,
            pointRadius: 4,
            pointBackgroundColor: '#E8785A',
            tension: 0.3,
            fill: true,
          }
        ]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: {
            display: true,
            position: 'top',
            labels: { font: { size: 10 }, boxWidth: 14, padding: 10 }
          },
          tooltip: {
            callbacks: {
              label: ctx => `${ctx.dataset.label}: ${ctx.parsed.y.toFixed(2).replace('.', ',')} %`
            }
          }
        },
        scales: {
          x: {
            grid: { display: false },
            ticks: { font: { size: 10 }, color: '#6b7280' }
          },
          y: {
            min: 0,
            max: 100,
            ticks: {
              stepSize: 20,
              font: { size: 10 },
              color: '#6b7280',
              callback: v => v + ' %'
            },
            grid: { color: '#e5e7eb44' }
          }
        }
      }
    });
  }

  // ═══════════════════════════════════════════════════════════════
  //  GRÁFICO 3: DISTRIBUIÇÃO DE EXECUÇÃO POR ITEM (barras horizontais)
  // ═══════════════════════════════════════════════════════════════
  _renderChartDistItens(obraId, bms, itens, cfg) {
    const canvas = document.getElementById('dash-chart-dist-itens');
    if (!canvas || typeof Chart === 'undefined') return;
    const lastBmNum = bms.length ? bms[bms.length-1].num : 0;
    if (!lastBmNum) return;

    const bdi = cfg.bdi || 0.25;
    const itensSvc = itens.filter(i => !i.t);

    // Calcula valor executado acumulado por item
    const dados = itensSvc.map(it => {
      let qtdAcum = 0;
      try {
        // FIX-CHARTS: usa a função importada diretamente no topo do módulo
        // em vez de this._calcFuncs, que pode estar undefined se o módulo
        // foi recriado ou se _render() foi chamado antes de init().
        qtdAcum = getQtdAcumuladoTotalItem(obraId, lastBmNum, it.id, itens);
      } catch(e) {}
      const upBdi = (it.up || 0) * (1 + bdi);
      const valorExec = qtdAcum * upBdi;
      return {
        id: it.id,
        desc: (it.desc || '').slice(0, 30) + ((it.desc || '').length > 30 ? '…' : ''),
        valor: valorExec,
        label: `${it.id} — ${(it.desc || '').slice(0, 25)}`
      };
    }).filter(d => d.valor > 0)
      .sort((a, b) => b.valor - a.valor)
      .slice(0, 10); // Top 10

    if (!dados.length) {
      // FIX-CHARTS: exibe mensagem em vez de retornar silenciosamente
      const ctx = canvas.getContext('2d');
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      ctx.fillStyle = 'var(--text-muted, #9ca3af)';
      ctx.font = '12px sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText(
        !lastBmNum ? 'Nenhum BM registrado' : 'Nenhum item com execução registrada',
        canvas.width / 2, canvas.height / 2
      );
      return;
    }

    if (this._chartDistItens) { this._chartDistItens.destroy(); this._chartDistItens = null; }

    const ctx = canvas.getContext('2d');
    this._chartDistItens = new Chart(ctx, {
      type: 'bar',
      data: {
        labels: dados.map(d => d.label),
        datasets: [{
          label: 'Valor Executado (R$)',
          data: dados.map(d => parseFloat(d.valor.toFixed(2))),
          backgroundColor: dados.map((_, i) => {
            const p = ['rgba(91,142,204,.8)','rgba(77,191,168,.8)','rgba(240,167,66,.8)','rgba(145,121,224,.8)','rgba(232,120,90,.8)','rgba(224,82,82,.8)','rgba(8,145,178,.8)','rgba(71,85,105,.8)','rgba(16,185,129,.8)','rgba(245,158,11,.8)'];
            return p[i % p.length];
          }),
          borderColor: dados.map((_, i) => {
            const p = ['#5B8ECC','#4DBFA8','#F0A742','#9179E0','#E8785A','#E05252','#0891b2','#475569','#10b981','#f59e0b'];
            return p[i % p.length];
          }),
          borderWidth: 1,
          borderRadius: 6,
        }]
      },
      options: {
        indexAxis: 'y',
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: { display: false },
          tooltip: {
            callbacks: {
              label: ctx => R$(ctx.parsed.x)
            }
          }
        },
        scales: {
          x: {
            ticks: {
              font: { size: 9 },
              color: '#6b7280',
              callback: v => v >= 1000 ? (v/1000).toFixed(0) + 'k' : v
            },
            grid: { color: '#e5e7eb44' }
          },
          y: {
            ticks: { font: { size: 9 }, color: '#374151' },
            grid: { display: false }
          }
        }
      }
    });
  }

  // ═══════════════════════════════════════════════════════════════
  //  BIND LOCAL HANDLERS
  // ═══════════════════════════════════════════════════════════════
  _bindLocalHandlers(obraId, bms, itens, cfg, valorContrato) {
    window._dashMudarStatus = async (novoStatus) => {
      try {
        const lista = state.get('obrasLista') || [];
        const idx   = lista.findIndex(o => o.id === obraId);
        if (idx >= 0) { lista[idx].statusObra = novoStatus; state.set('obrasLista', lista); }
        await FirebaseService.atualizarObra?.(obraId, { statusObra: novoStatus });
        this._renderImediato();
      } catch(e) { console.error('[Dashboard] _dashMudarStatus:', e); }
    };

    window._dashDetalheBM = (bmNum) => {
      const det = document.getElementById('dash-bm-detalhe');
      if (!det) return;
      const bm  = bms.find(b => b.num === bmNum);
      if (!bm) return;
      let vBm=0, vAcum=0;
      try {
        vAcum = getValorAcumuladoTotal(obraId, bmNum, itens, cfg);
        vBm   = vAcum - (getValorAcumuladoAnterior(obraId, bmNum, itens, cfg)||0);
      } catch {}
      det.style.display = 'block';
      det.innerHTML = `
        <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:12px">
          <div style="font-size:13px;font-weight:700;color:var(--text-primary)">
            🔍 Detalhes — ${bm.label} (${bm.mes||'—'})
          </div>
          <button data-action="_dashFecharDetalhe"
            style="background:none;border:none;cursor:pointer;font-size:18px;color:var(--text-muted)">×</button>
        </div>
        <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(140px,1fr));gap:8px">
          ${[['Nº Boletim',bm.label],['Período',bm.mes||'—'],['Data',bm.data||'—'],
             ['Valor BM',R$(vBm)],['Acumulado',R$(vAcum)],['Saldo',R$(valorContrato-vAcum)]]
            .map(([l,v]) => `
              <div style="background:var(--bg-surface);border-radius:7px;padding:9px 12px">
                <div style="font-size:9px;color:var(--text-muted);font-weight:700;
                  text-transform:uppercase;letter-spacing:.5px;margin-bottom:3px">${l}</div>
                <div style="font-size:13px;font-weight:700;color:var(--text-primary);
                  font-family:var(--font-mono);overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${v}</div>
              </div>`).join('')}
        </div>
        <div style="margin-top:10px">
          <button class="btn btn-primary btn-sm"
            data-action="verPagina" data-arg0="boletim">📋 Abrir Boletim</button>
        </div>`;
      det.scrollIntoView({ behavior:'smooth', block:'nearest' });
    };
  }

  // ═══════════════════════════════════════════════════════════════
  //  EVENTOS E GLOBALS
  // ═══════════════════════════════════════════════════════════════
  _bindEvents() {
    const rerender = () => { try { if (router.current==='dashboard') this._render(); } catch(e){} };
    this._subs.push(
      EventBus.on('obra:selecionada',   rerender, 'dashboard'),
      EventBus.on('boletim:atualizado', rerender, 'dashboard'),
      EventBus.on('config:salva',       rerender, 'dashboard'),
      EventBus.on('itens:atualizados',  rerender, 'dashboard'),
    );
  }

  _exposeGlobals() {
    window.renderDashboard    = () => { try { this._render(); } catch(e){} };
    window.renderRegistroBMs  = () => { try { this._render(); } catch(e){} };
    window.abrirDetalheBM     = (n)=> { try { window._dashDetalheBM?.(n); } catch(e){} };
    window._dashTab           = (t) => { try { this._render(t); } catch(e){} };
    window._dashGerarPDF      = ()  => { try { this._gerarPDFPainel(); } catch(e){ console.error(e); } };
    window._dashGerarPDFContratual = () => { try { this._gerarPDFContratual(); } catch(e){ console.error(e); } };
    // Alertas
    window._alertaConfig  = () => {
      window.toast?.('⚙️ Configure os limites de alerta nas Configurações da Obra.', 'info');
      try { window.verPagina?.('config'); } catch(e) {}
    };
    window._alertaAtualizar = () => { try { this._render(); window.toast?.('🔄 Alertas atualizados.', 'ok'); } catch(e){} };
  }


  // ═══════════════════════════════════════════════════════════════
  //  TAB HEADER — injetado antes de qualquer aba
  // ═══════════════════════════════════════════════════════════════
  _renderTabHeader(container, cfg, obraId) {
    const tabs = [
      { k:'visao',       i:'🏗️', l:'Visão Geral'      },
      { k:'indicadores', i:'📊', l:'Indicadores'       },
      { k:'painel',      i:'📋', l:'Painel de Controle'},
    ];
    const nomeObra = cfg?.objeto || 'Obra ativa';
    const tabsHTML = tabs.map(t => `
      <button data-action="_dashTab" data-arg0="${t.k}" style="padding:9px 20px;border:none;border-bottom:2px solid ${this._tabAtual===t.k?'#E8785A':'transparent'};
          background:transparent;cursor:pointer;font-size:12px;font-weight:${this._tabAtual===t.k?'700':'500'};
          color:${this._tabAtual===t.k?'#E8785A':'#8A94A6'};transition:all .15s;white-space:nowrap;letter-spacing:.1px">
        ${t.i} ${t.l}</button>`).join('');

    let hdrEl = container.querySelector('#dash-tab-header');
    if (!hdrEl) {
      hdrEl = document.createElement('div');
      hdrEl.id = 'dash-tab-header';
      hdrEl.style.cssText = 'display:flex;align-items:center;gap:0;border-bottom:1px solid #E8EDF5;margin-bottom:18px;overflow-x:auto;flex-shrink:0;background:#fff;border-radius:12px 12px 0 0;padding:0 4px';
      container.insertBefore(hdrEl, container.firstChild);
    }
    hdrEl.innerHTML = tabsHTML +
      `<div style="flex:1"></div>
       ${this._tabAtual==='painel'?`<button data-action="_dashGerarPDF"
         style="padding:7px 16px;margin:4px 0;background:#E8785A;border:none;border-radius:8px;color:#fff;font-size:11px;font-weight:700;cursor:pointer;flex-shrink:0;letter-spacing:.2px">
         🖨️ Gerar PDF do Painel</button>`:''}`;
  }

  // ═══════════════════════════════════════════════════════════════
  //  ABA: INDICADORES
  // ═══════════════════════════════════════════════════════════════
  _renderIndicadores(container, obraId, cfg, bms, itens) {
    let body = container.querySelector('#dash-tab-body');
    if (!body) { body = document.createElement('div'); body.id = 'dash-tab-body'; container.appendChild(body); }

    const valorContrato = (cfg.valor && cfg.valor > 0) ? cfg.valor : (() => { const _r2=v=>Math.round(v*100)/100; let _t=0; (itens||[]).forEach(it=>{if(it.t==='G'||it.t==='SG')return; if((itens||[]).some(x=>x.id!==it.id&&x.id.startsWith(it.id+'.')))return; const _b=getBdiEfetivo(it,cfg); const _u=(it.upBdi&&it.upBdi>0)?it.upBdi:_r2((it.up||0)*(1+_b)); _t+=_r2((it.qtd||0)*_u);}); return Math.round(_t*100)/100; })();
    const itensSvc      = itens.filter(i => !i.t);
    const lastBm        = bms.length ? bms[bms.length-1] : null;
    const lastBmNum     = lastBm?.num || 0;
    let vAcumTotal=0, vMedAtual=0;
    try {
      if (lastBmNum > 0) {
        // FIX-CHARTS: usa funções importadas diretamente no topo do módulo
        vAcumTotal = getValorAcumuladoTotal(obraId, lastBmNum, itens, cfg);
        vMedAtual  = getValorMedicaoAtual(obraId, lastBmNum, itens, cfg);
      }
    } catch(e) {}
    const saldo  = valorContrato - vAcumTotal;
    const pctFin = valorContrato > 0 ? (vAcumTotal / valorContrato * 100) : 0;
    const hoje = new Date();
    let pctPrazo=0, diasRestantes='—', diasDecorridos=0, duracaoTotal=0;
    try {
      if (cfg.inicioPrev && cfg.termino) {
        const ini = new Date(cfg.inicioPrev), fim = new Date(cfg.termino);
        duracaoTotal   = Math.max(1, Math.round((fim-ini)/86400000));
        diasDecorridos = Math.round((hoje-ini)/86400000);
        pctPrazo       = Math.min(100, Math.max(0, diasDecorridos/duracaoTotal*100));
        const dias     = Math.round((fim-hoje)/86400000);
        diasRestantes  = dias > 0 ? `${dias} dias` : `${Math.abs(dias)}d atrás`;
      }
    } catch(e) {}
    const desvio = pctFin - pctPrazo;

    body.innerHTML = `
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-bottom:16px">
        <!-- Financeiro -->
        <div style="background:var(--bg-surface);border:1px solid var(--border);border-radius:12px;padding:18px">
          <div style="font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:.5px;color:var(--text-muted);margin-bottom:14px">💰 Indicadores Financeiros</div>
          <div style="display:flex;flex-direction:column;gap:10px">
            ${[
              ['Valor Contratual', R$(valorContrato), '#2563eb'],
              ['Acumulado Medido', R$(vAcumTotal)+' ('+pct(pctFin)+')', '#16a34a'],
              ['Saldo a Executar', R$(saldo), saldo<0?'#dc2626':'#ca8a04'],
              ['Última Medição',   R$(vMedAtual), '#7c3aed'],
              ['BDI', ((cfg.bdi||0)*100).toFixed(2)+' %', '#0891b2'],
            ].map(([l,v,c]) => `<div style="display:flex;justify-content:space-between;padding:7px 10px;border-radius:7px;background:var(--bg-card)">
              <span style="font-size:11px;color:var(--text-muted)">${l}</span>
              <span style="font-size:12px;font-weight:700;color:${c};font-family:var(--font-mono)">${v}</span>
            </div>`).join('')}
          </div>
        </div>
        <!-- Prazo -->
        <div style="background:var(--bg-surface);border:1px solid var(--border);border-radius:12px;padding:18px">
          <div style="font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:.5px;color:var(--text-muted);margin-bottom:14px">📅 Indicadores de Prazo</div>
          <div style="display:flex;flex-direction:column;gap:10px">
            ${[
              ['Início Previsto',   cfg.inicioPrev ? new Date(cfg.inicioPrev).toLocaleDateString('pt-BR') : '—', '#6b7280'],
              ['Término Previsto',  cfg.termino    ? new Date(cfg.termino).toLocaleDateString('pt-BR')    : '—', pctPrazo>100?'#dc2626':'#16a34a'],
              ['Dias Decorridos',   `${Math.max(0,diasDecorridos)} / ${duracaoTotal||'—'}`, '#ca8a04'],
              ['Dias Restantes',    diasRestantes, pctPrazo>100?'#dc2626':'#22c55e'],
              ['% Prazo Decorrido', pct(pctPrazo), pctPrazo>100?'#dc2626':'#ca8a04'],
            ].map(([l,v,c]) => `<div style="display:flex;justify-content:space-between;padding:7px 10px;border-radius:7px;background:var(--bg-card)">
              <span style="font-size:11px;color:var(--text-muted)">${l}</span>
              <span style="font-size:12px;font-weight:700;color:${c};font-family:var(--font-mono)">${v}</span>
            </div>`).join('')}
          </div>
        </div>
      </div>
      <!-- Desvio físico-financeiro -->
      <div style="background:var(--bg-surface);border:1px solid var(--border);border-radius:12px;padding:18px;margin-bottom:16px">
        <div style="font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:.5px;color:var(--text-muted);margin-bottom:14px">📈 Avanço Comparativo</div>
        <div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:20px">
          ${this._barraProgresso('% Financeiro',      pctFin,         '#16a34a')}
          ${this._barraProgresso('% Prazo Decorrido', pctPrazo,       '#ca8a04')}
          ${this._barraProgresso('Desvio Físico', Math.abs(desvio), desvio>=0?'#16a34a':'#dc2626',
              (desvio>=0?'+':'')+desvio.toFixed(2).replace('.',',')+'%',
              desvio>=0?'À frente':'Abaixo')}
        </div>
      </div>
      <!-- Itens do contrato -->
      <div style="background:var(--bg-surface);border:1px solid var(--border);border-radius:12px;padding:18px">
        <div style="font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:.5px;color:var(--text-muted);margin-bottom:12px">📐 Resumo da Planilha</div>
        <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(130px,1fr));gap:8px">
          ${[
            ['Total de Itens', itensSvc.length, '#475569'],
            ['BMs Registrados', bms.length, '#2563eb'],
            ['Grupos', itens.filter(i=>i.t==='G').length, '#7c3aed'],
          ].map(([l,v,c]) => `<div style="background:var(--bg-card);border:1px solid var(--border);border-radius:8px;padding:10px;text-align:center">
            <div style="font-size:18px;font-weight:800;color:${c};font-family:var(--font-mono)">${v}</div>
            <div style="font-size:9px;color:var(--text-muted);text-transform:uppercase;letter-spacing:.4px;margin-top:2px">${l}</div>
          </div>`).join('')}
        </div>
      </div>`;
  }

  // ═══════════════════════════════════════════════════════════════
  //  ABA: PAINEL DE CONTROLE
  // ═══════════════════════════════════════════════════════════════
  _renderPainel(container, obraId, cfg, bms, itens) {
    let body = container.querySelector('#dash-tab-body');
    if (!body) { body = document.createElement('div'); body.id = 'dash-tab-body'; container.appendChild(body); }

    const valorOriginal = cfg.valorOriginal || cfg.valor || 0;
    const valorContrato = (cfg.valor && cfg.valor > 0) ? cfg.valor : (() => { const _r2=v=>Math.round(v*100)/100; let _t=0; (itens||[]).forEach(it=>{if(it.t==='G'||it.t==='SG')return; if((itens||[]).some(x=>x.id!==it.id&&x.id.startsWith(it.id+'.')))return; const _b=getBdiEfetivo(it,cfg); const _u=(it.upBdi&&it.upBdi>0)?it.upBdi:_r2((it.up||0)*(1+_b)); _t+=_r2((it.qtd||0)*_u);}); return Math.round(_t*100)/100; })();
    const lastBm        = bms.length ? bms[bms.length-1] : null;
    const lastBmNum     = lastBm?.num || 0;
    const aditivos      = state.get('aditivos') || [];
    let vAcumTotal=0, vMedAtual=0;
    try {
      if (lastBmNum > 0) {
        // FIX-CHARTS: usa funções importadas diretamente no topo do módulo
        vAcumTotal = getValorAcumuladoTotal(obraId, lastBmNum, itens, cfg);
        vMedAtual  = getValorMedicaoAtual(obraId, lastBmNum, itens, cfg);
      }
    } catch(e) {}
    const saldo      = valorContrato - vAcumTotal;
    const pctFin     = valorContrato > 0 ? vAcumTotal/valorContrato*100 : 0;
    const variacao   = valorContrato - valorOriginal;
    const hoje = new Date();
    let pctPrazo=0, diasRestantes='—', diasDecorridos=0, duracaoTotal=0, atrasada=false;
    try {
      if (cfg.inicioPrev && cfg.termino) {
        const ini = new Date(cfg.inicioPrev), fim = new Date(cfg.termino);
        duracaoTotal   = Math.max(1,Math.round((fim-ini)/86400000));
        diasDecorridos = Math.round((hoje-ini)/86400000);
        pctPrazo       = Math.min(100,Math.max(0,diasDecorridos/duracaoTotal*100));
        const dias     = Math.round((fim-hoje)/86400000);
        diasRestantes  = dias>0?`${dias} dias`:dias===0?'Hoje':`${Math.abs(dias)}d atrasada`;
        atrasada       = dias < 0;
      }
    } catch(e) {}
    const alertas = this._gerarAlertas(bms, cfg, valorContrato, vAcumTotal, saldo, pctPrazo, pctFin);
    const barFn   = (p,cor,h=8) => `<div style="height:${h}px;border-radius:${h/2}px;background:${cor}22;overflow:hidden"><div style="height:${h}px;border-radius:${h/2}px;background:${cor};width:${Math.min(100,Math.max(0,p))}%;transition:width .4s"></div></div>`;
    const dataBR  = iso => iso ? new Date(iso+'T12:00:00').toLocaleDateString('pt-BR') : '—';
    const obraRef = (state.get('obrasLista')||[]).find(o=>o.id===obraId)||{};

    body.innerHTML = `
      <!-- Cabeçalho da obra -->
      <div style="background:var(--bg-surface);border:1px solid var(--border);border-radius:12px;padding:16px 20px;margin-bottom:16px">
        <div style="font-size:10px;font-weight:700;color:var(--text-muted);text-transform:uppercase;letter-spacing:.5px;margin-bottom:4px">Obra Ativa</div>
        <div style="font-size:16px;font-weight:800;color:var(--text-primary);margin-bottom:6px;word-break:break-word;overflow-wrap:anywhere">${cfg.objeto||'—'}</div>
        <div style="display:flex;gap:16px;flex-wrap:wrap;font-size:11px;color:var(--text-muted)">
          ${cfg.contrato?`<span>📋 Contrato: <strong style="color:var(--text-primary)">${cfg.contrato}</strong></span>`:''}
          ${cfg.contratante?`<span>🏛️ ${cfg.contratante}</span>`:''}
          ${cfg.contratada?`<span>🏢 ${cfg.contratada}</span>`:''}
          <span style="background:${obraRef.statusObra==='Concluída'?'#16a34a':obraRef.statusObra==='Paralisada'?'#dc2626':'#2563eb'}18;color:${obraRef.statusObra==='Concluída'?'#16a34a':obraRef.statusObra==='Paralisada'?'#dc2626':'#2563eb'};padding:2px 10px;border-radius:99px;font-weight:700">${obraRef.statusObra||'Em andamento'}</span>
        </div>
      </div>

      <!-- Situação Financeira -->
      <div style="background:var(--bg-surface);border:1px solid var(--border);border-radius:12px;padding:18px;margin-bottom:14px">
        <div style="font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:.5px;color:var(--text-muted);margin-bottom:14px">💰 Situação Financeira</div>
        <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(150px,1fr));gap:10px;margin-bottom:12px">
          ${[['Valor Contratual',R$(valorContrato),'var(--accent)'],['Valor Executado',R$(vAcumTotal),'#2563eb'],
             ['Saldo a Executar',R$(saldo),saldo<0?'#ef4444':'#22c55e'],['Última Medição',R$(vMedAtual),'#f59e0b'],
             ['Variação Contratual',R$(Math.abs(variacao)),variacao>0?'#22c55e':variacao<0?'#ef4444':'#6b7280']]
           .map(([l,v,c])=>`<div style="background:var(--bg-card);border:1px solid var(--border);border-radius:8px;padding:10px;text-align:center">
             <div style="font-size:9px;font-weight:700;color:var(--text-muted);text-transform:uppercase;letter-spacing:.4px;margin-bottom:4px">${l}</div>
             <div style="font-size:13px;font-weight:800;color:${c};font-family:var(--font-mono)">${v}</div>
           </div>`).join('')}
        </div>
        <div style="margin-top:8px">
          <div style="display:flex;justify-content:space-between;font-size:10px;color:var(--text-muted);margin-bottom:4px"><span>Execução Financeira</span><span style="font-weight:700">${pct(pctFin)}</span></div>
          ${barFn(pctFin,'#2563eb',10)}
        </div>
      </div>

      <!-- Prazo e alertas lado a lado -->
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-bottom:14px">
        <div style="background:var(--bg-surface);border:1px solid var(--border);border-radius:12px;padding:18px">
          <div style="font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:.5px;color:var(--text-muted);margin-bottom:12px">📅 Situação do Prazo</div>
          ${[['Início',dataBR(cfg.inicioPrev),'#6b7280'],
             ['Término',dataBR(cfg.termino),atrasada?'#ef4444':'#22c55e'],
             ['Dias Decorridos',diasDecorridos,'#f59e0b'],
             ['Dias Restantes',diasRestantes,atrasada?'#ef4444':'#22c55e']]
           .map(([l,v,c])=>`<div style="display:flex;justify-content:space-between;padding:5px 0;border-bottom:1px solid var(--border);font-size:11px">
             <span style="color:var(--text-muted)">${l}</span>
             <span style="font-weight:700;color:${c}">${v}</span>
           </div>`).join('')}
          <div style="margin-top:10px">
            <div style="display:flex;justify-content:space-between;font-size:10px;color:var(--text-muted);margin-bottom:4px"><span>Prazo Decorrido</span><span style="font-weight:700">${pct(pctPrazo)}</span></div>
            ${barFn(pctPrazo, atrasada?'#ef4444':'#f59e0b', 8)}
          </div>
        </div>
        <div style="background:var(--bg-surface);border:1px solid var(--border);border-radius:12px;padding:18px">
          <div style="font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:.5px;color:var(--text-muted);margin-bottom:12px">⚠️ Alertas</div>
          ${alertas.length ? alertas.map(a=>this._alerta(a)).join('') : '<div style="font-size:12px;color:#16a34a">✅ Nenhum alerta.</div>'}
        </div>
      </div>

      <!-- BMs e Aditivos -->
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-bottom:14px">
        <div style="background:var(--bg-surface);border:1px solid var(--border);border-radius:12px;padding:16px">
          <div style="font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:.5px;color:var(--text-muted);margin-bottom:10px">📒 Boletins de Medição</div>
          ${bms.length===0?'<p style="font-size:12px;color:var(--text-muted)">Nenhum BM.</p>':
            bms.slice(-4).reverse().map(b=>`<div style="display:flex;justify-content:space-between;padding:5px 0;border-bottom:1px solid var(--border);font-size:11px">
              <span style="font-weight:600;color:var(--text-primary)">BM ${b.num}</span>
              <span style="color:var(--text-muted)">${b.mes||'—'}</span>
              <span style="color:var(--accent);font-weight:700">${b.data||'—'}</span>
            </div>`).join('')}
        </div>
        <div style="background:var(--bg-surface);border:1px solid var(--border);border-radius:12px;padding:16px">
          <div style="font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:.5px;color:var(--text-muted);margin-bottom:10px">📝 Aditivos Contratuais</div>
          ${aditivos.length===0?'<p style="font-size:12px;color:var(--text-muted)">Nenhum aditivo.</p>':
            aditivos.slice(-4).reverse().map(a=>`<div style="display:flex;justify-content:space-between;padding:5px 0;border-bottom:1px solid var(--border);font-size:11px">
              <span style="font-weight:600;color:var(--text-primary)">${a.numero||'—'}</span>
              <span style="color:var(--text-muted)">${a.tipo||'—'}</span>
              <span style="color:var(--accent);font-weight:700">${a.valorNovo?R$(a.valorNovo):'—'}</span>
            </div>`).join('')}
        </div>
      </div>`;
  }

  // ═══════════════════════════════════════════════════════════════
  //  PDF DO PAINEL DE CONTROLE
  // ═══════════════════════════════════════════════════════════════
  _gerarPDFPainel() {
    const obraId = state.get('obraAtivaId');
    const cfg    = state.get('cfg') || {};
    const bms    = state.get('bms') || [];
    const itens  = state.get('itensContrato') || [];
    const aditivos = state.get('aditivos') || [];

    const valorContrato = (cfg.valor && cfg.valor > 0) ? cfg.valor : (() => { const _r2=v=>Math.round(v*100)/100; let _t=0; (itens||[]).forEach(it=>{if(it.t==='G'||it.t==='SG')return; if((itens||[]).some(x=>x.id!==it.id&&x.id.startsWith(it.id+'.')))return; const _b=getBdiEfetivo(it,cfg); const _u=(it.upBdi&&it.upBdi>0)?it.upBdi:_r2((it.up||0)*(1+_b)); _t+=_r2((it.qtd||0)*_u);}); return Math.round(_t*100)/100; })();
    const lastBm        = bms.length ? bms[bms.length-1] : null;
    const lastBmNum     = lastBm?.num || 0;
    let vAcumTotal=0, vMedAtual=0;
    try {
      if (lastBmNum > 0) {
        // FIX-CHARTS: usa funções importadas diretamente no topo do módulo
        vAcumTotal = getValorAcumuladoTotal(obraId, lastBmNum, itens, cfg);
        vMedAtual  = getValorMedicaoAtual(obraId, lastBmNum, itens, cfg);
      }
    } catch(e) {}
    const saldo  = valorContrato - vAcumTotal;
    const pctFin = valorContrato > 0 ? (vAcumTotal/valorContrato*100) : 0;
    const hoje = new Date();
    let pctPrazo=0, diasRestantes='—', diasDecorridos=0, duracaoTotal=0, atrasada=false;
    try {
      if (cfg.inicioPrev && cfg.termino) {
        const ini = new Date(cfg.inicioPrev), fim = new Date(cfg.termino);
        duracaoTotal   = Math.max(1,Math.round((fim-ini)/86400000));
        diasDecorridos = Math.round((hoje-ini)/86400000);
        pctPrazo       = Math.min(100,Math.max(0,diasDecorridos/duracaoTotal*100));
        const dias     = Math.round((fim-hoje)/86400000);
        diasRestantes  = dias>0?`${dias} dias`:dias===0?'Hoje':`${Math.abs(dias)}d atrasada`;
        atrasada       = dias < 0;
      }
    } catch(e) {}
    const alertas = this._gerarAlertas(bms, cfg, valorContrato, vAcumTotal, saldo, pctPrazo, pctFin);
    const variacao = valorContrato - (cfg.valorOriginal || valorContrato);
    const dataBR = iso => iso ? new Date(iso+'T12:00:00').toLocaleDateString('pt-BR') : '—';
    const obraRef= (state.get('obrasLista')||[]).find(o=>o.id===obraId)||{};
    const statusObra = obraRef.statusObra || 'Em andamento';
    const logo   = state.get('logoBase64') || cfg.logo || '';
    const barPDF = (p, cor) => `<div style="background:#e5e7eb;border-radius:4px;height:10px;width:100%;overflow:hidden"><div style="background:${cor};height:10px;width:${Math.min(100,Math.max(0,p))}%;border-radius:4px"></div></div>`;

    const html = `<!DOCTYPE html><html lang="pt-BR"><head><meta charset="UTF-8">
<title>Painel de Controle — ${cfg.objeto||'Obra'}</title>
<style>
  *{box-sizing:border-box;margin:0;padding:0}
  body{font-family:Arial,sans-serif;font-size:9pt;color:#000;padding:12mm}
  .header{display:flex;align-items:center;gap:16px;border-bottom:3px solid #1e3a5f;padding-bottom:12px;margin-bottom:16px}
  .logo{max-height:60px;max-width:100px}
  .orgao h1{font-size:13pt;font-weight:bold;color:#1e3a5f;text-transform:uppercase}
  .orgao p{font-size:8.5pt;color:#555}
  .titulo{text-align:center;margin:10px 0 18px;font-size:15pt;font-weight:bold;color:#1e3a5f;text-transform:uppercase;letter-spacing:1px}
  .emissao{text-align:center;font-size:8.5pt;color:#555;margin-bottom:16px}
  .secao-titulo{font-size:9pt;font-weight:bold;text-transform:uppercase;letter-spacing:.5px;color:#1e3a5f;border-bottom:1.5px solid #1e3a5f;padding-bottom:4px;margin-bottom:8px}
  .grid2{display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-bottom:14px}
  .grid3{display:grid;grid-template-columns:1fr 1fr 1fr;gap:8px;margin-bottom:14px}
  .card{border:1px solid #ddd;border-radius:4px;padding:8px 10px}
  .card-label{font-size:7.5pt;text-transform:uppercase;letter-spacing:.3px;color:#666;margin-bottom:2px}
  .card-value{font-size:10.5pt;font-weight:bold;font-family:'Courier New',monospace}
  .bloco{border:1px solid #ddd;border-radius:4px;padding:10px 12px;margin-bottom:12px}
  .barra-bg{background:#e5e7eb;border-radius:4px;height:10px;overflow:hidden;margin-top:4px}
  .barra-fill{height:10px;border-radius:4px}
  .alerta{background:#fef3c7;border:1px solid #f59e0b;border-radius:4px;padding:5px 8px;font-size:8.5pt;margin-bottom:5px}
  .alerta-err{background:#fee2e2;border-color:#ef4444}
  .row{display:flex;justify-content:space-between;font-size:9pt;border-bottom:1px solid #f3f4f6;padding:4px 0}
  .footer{margin-top:16px;border-top:1px solid #ddd;padding-top:6px;font-size:7.5pt;color:#888;text-align:center}
  @media print{@page{size:A4;margin:0}body{padding:8mm}}
</style></head><body>
<div class="header">
  ${logo?`<img src="${logo}" class="logo" alt="Logo">`:''}
  <div class="orgao"><h1>${cfg.contratante||'CONTRATANTE'}</h1><p>Controle e Fiscalização de Obras</p></div>
</div>
<div class="titulo">Painel de Controle da Obra</div>
<div class="emissao">Emitido em ${hoje.toLocaleDateString('pt-BR')} às ${hoje.toLocaleTimeString('pt-BR',{hour:'2-digit',minute:'2-digit'})}</div>

<div class="bloco">
  <div class="secao-titulo">Identificação da Obra</div>
  <div class="grid2">
    <div class="card"><div class="card-label">Objeto / Obra</div><div class="card-value" style="font-size:9.5pt">${cfg.objeto||'—'}</div></div>
    <div class="card"><div class="card-label">Nº Contrato</div><div class="card-value">${cfg.contrato||'—'}</div></div>
    <div class="card"><div class="card-label">Contratante</div><div class="card-value" style="font-size:9pt">${cfg.contratante||'—'}</div></div>
    <div class="card"><div class="card-label">Empresa Executora</div><div class="card-value" style="font-size:9pt">${cfg.contratada||'—'}</div></div>
    <div class="card"><div class="card-label">Fiscal de Obras</div><div class="card-value" style="font-size:9pt">${cfg.fiscal||'—'}</div></div>
    <div class="card"><div class="card-label">Status</div><div class="card-value" style="font-size:9pt">${statusObra}</div></div>
  </div>
</div>

<div class="grid2">
  <div class="bloco">
    <div class="secao-titulo">Situação Financeira</div>
    ${[['Valor Contratual',R$(valorContrato)],['Valor Executado',R$(vAcumTotal)],
       ['Saldo a Executar',R$(saldo)],['Última Medição',R$(vMedAtual)],
       ['Variação Contratual',R$(Math.abs(variacao))]]
      .map(([l,v])=>`<div class="row"><span>${l}</span><span style="font-weight:700;font-family:'Courier New',monospace">${v}</span></div>`).join('')}
    <div style="margin-top:8px"><div style="display:flex;justify-content:space-between;font-size:8.5pt;margin-bottom:2px"><span>Execução Financeira</span><span style="font-weight:bold">${pct(pctFin)}</span></div>
    ${barPDF(pctFin,'#2563eb')}</div>
  </div>
  <div class="bloco">
    <div class="secao-titulo">Situação do Prazo</div>
    ${[['Início Previsto',dataBR(cfg.inicioPrev)],['Término Previsto',dataBR(cfg.termino)],
       ['Dias Decorridos',String(Math.max(0,diasDecorridos))],['Dias Restantes',diasRestantes],['Duração Total',String(duracaoTotal)+' dias']]
      .map(([l,v])=>`<div class="row"><span>${l}</span><span style="font-weight:700">${v}</span></div>`).join('')}
    <div style="margin-top:8px"><div style="display:flex;justify-content:space-between;font-size:8.5pt;margin-bottom:2px"><span>Prazo Decorrido</span><span style="font-weight:bold">${pct(pctPrazo)}</span></div>
    ${barPDF(pctPrazo, atrasada?'#ef4444':'#f59e0b')}</div>
  </div>
</div>

${alertas.length>0?`<div class="bloco"><div class="secao-titulo">⚠️ Alertas</div>
${alertas.map(a=>`<div class="alerta${a.tipo==='erro'?' alerta-err':''}">${a.icon} ${a.msg}</div>`).join('')}</div>`:''}

<div class="grid2">
  <div class="bloco"><div class="secao-titulo">📒 Boletins de Medição (${bms.length})</div>
  ${bms.length===0?'<p style="font-size:8.5pt;color:#888">Nenhum BM registrado.</p>':
    bms.slice(-5).reverse().map(b=>`<div class="row"><span>BM ${b.num}</span><span>${b.mes||'—'}</span><span>${b.data||'—'}</span></div>`).join('')}
  </div>
  <div class="bloco"><div class="secao-titulo">📝 Aditivos (${aditivos.length})</div>
  ${aditivos.length===0?'<p style="font-size:8.5pt;color:#888">Nenhum aditivo.</p>':
    aditivos.slice(-5).reverse().map(a=>`<div class="row"><span>${a.numero||'—'}</span><span>${a.tipo||'—'}</span><span>${a.valorNovo?R$(a.valorNovo):'—'}</span></div>`).join('')}
  </div>
</div>

<div class="footer">Painel de Controle — Fiscal na Obra · ${cfg.contratante||''} · Gerado em ${hoje.toLocaleString('pt-BR')}</div>
<script>window.print();<\/script>
</body></html>`;

    const w = window.open('','_blank','width=900,height=700');
    if (w) { w.document.write(html); w.document.close(); }
    else window.toast?.('⚠️ Permita popups para gerar PDF.','warn');
  }

  // ═══════════════════════════════════════════════════════════════
  //  SEÇÃO ANALYTICS RESUMO (dados do módulo Analytics na Visão Geral)
  // ═══════════════════════════════════════════════════════════════
  _htmlAnalyticsResumo(obraId, cfg, bms, itens, vAcumTotal) {
    try {
      const valorContrato = (cfg.valor && cfg.valor > 0) ? cfg.valor : (() => { const _r2=v=>Math.round(v*100)/100; let _t=0; (itens||[]).forEach(it=>{if(it.t==='G'||it.t==='SG')return; if((itens||[]).some(x=>x.id!==it.id&&x.id.startsWith(it.id+'.')))return; const _b=getBdiEfetivo(it,cfg); const _u=(it.upBdi&&it.upBdi>0)?it.upBdi:_r2((it.up||0)*(1+_b)); _t+=_r2((it.qtd||0)*_u);}); return Math.round(_t*100)/100; })();
      const R$ = v => formatters.currency ? formatters.currency(v) : (v||0).toLocaleString('pt-BR',{style:'currency',currency:'BRL'});
      const pct = v => ((parseFloat(v)||0).toFixed(1)).replace('.',',') + '%';

      // Série financeira de BMs
      const serie = bms.map(bm => {
        let vMed = 0, vAcum = 0;
        try {
          vAcum = getValorAcumuladoTotal(obraId, bm.num, itens, cfg);
          vMed  = vAcum - getValorAcumuladoAnterior(obraId, bm.num, itens, cfg);
        } catch {}
        return { bm, vMed, vAcum };
      });

      // Previsão de término
      const ritmos = serie.map(s => s.vMed).filter(v => v > 0);
      const ritmoMedio = ritmos.length ? ritmos.reduce((a,b)=>a+b,0)/ritmos.length : 0;
      const saldo = valorContrato - vAcumTotal;
      const bmsRestantes = ritmoMedio > 0 ? Math.ceil(saldo / ritmoMedio) : 0;
      let labelPrevisao = '—';
      let atrasado = false;
      try {
        if (bmsRestantes > 0 && serie.length) {
          const ultimaData = serie[serie.length-1]?.bm?.data
            ? new Date(serie[serie.length-1].bm.data + 'T12:00:00') : new Date();
          ultimaData.setMonth(ultimaData.getMonth() + bmsRestantes);
          labelPrevisao = ultimaData.toLocaleDateString('pt-BR',{month:'short',year:'numeric'});
          if (cfg.termino) atrasado = ultimaData > new Date(cfg.termino + 'T12:00:00');
        } else if (saldo <= 0) {
          labelPrevisao = '✅ Concluído';
        }
      } catch {}

      // Alertas do validationEngine
      const alertas = window.validationEngine?.getAlertas() || [];
      const erros = alertas.filter(a => a.gravidade === 'error');
      const avisos = alertas.filter(a => a.gravidade === 'warn');

      return `
      <div style="background:var(--bg-surface);border:1px solid var(--border);border-radius:12px;
        padding:16px 18px;margin-bottom:18px">
        <div style="font-size:10px;font-weight:700;color:var(--text-muted);text-transform:uppercase;
          letter-spacing:.5px;margin-bottom:14px">📈 ANALYTICS — RESUMO EXECUTIVO</div>
        <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:10px">
          ${[
            ['📊','Ritmo Médio/BM',   ritmoMedio > 0 ? R$(ritmoMedio) : '—',  '#2563eb'],
            ['🔮','Previsão Término', labelPrevisao,                            atrasado ? '#dc2626' : '#059669'],
            ['📋','BMs p/ Concluir', bmsRestantes > 0 ? bmsRestantes + ' BMs' : (saldo<=0?'✅':'—'), '#7c3aed'],
            ['🚨','Erros Validação', erros.length > 0 ? erros.length + ' erro(s)' : '✅ OK',        erros.length > 0 ? '#dc2626' : '#16a34a'],
            ['⚠️','Avisos Validação',avisos.length > 0 ? avisos.length + ' aviso(s)' : '✅ OK',     avisos.length > 0 ? '#d97706' : '#16a34a'],
          ].map(([i,l,v,c]) => `
            <div style="background:var(--bg-card);border:1px solid var(--border);border-radius:9px;padding:12px">
              <div style="font-size:10px;color:var(--text-muted);margin-bottom:4px">${i} ${l}</div>
              <div style="font-size:13px;font-weight:700;color:${c}">${v}</div>
            </div>`).join('')}
        </div>
        ${alertas.length > 0 ? `
        <div style="margin-top:12px;display:flex;flex-direction:column;gap:4px;max-height:100px;overflow-y:auto">
          ${alertas.slice(0,4).map(a => {
            const cor = a.gravidade==='error'?'#dc2626':a.gravidade==='warn'?'#d97706':'#6b7280';
            const ico = a.gravidade==='error'?'🚨':a.gravidade==='warn'?'⚠️':'ℹ️';
            return `<div style="font-size:11px;color:${cor};display:flex;gap:6px;align-items:flex-start">
              <span>${ico}</span><span>${a.modulo}: ${a.msg}</span></div>`;
          }).join('')}
        </div>` : ''}
      </div>`;
    } catch(e) {
      return '';
    }
  }

  // ═══════════════════════════════════════════════════════════════
  //  SEÇÃO PAINEL CONTRATUAL (integrada na Visão Geral)
  // ═══════════════════════════════════════════════════════════════
  _htmlPainelContratualSecao(obraId, cfg, bms, itens, vAcumTotal, saldo, pctFin, diasRestantes) {
    const aditivos      = state.get('aditivos') || [];
    const valorOriginal = cfg.valorOriginal || cfg.valor || 0;
    const valorContrato = (cfg.valor && cfg.valor > 0) ? cfg.valor : (() => { const _r2=v=>Math.round(v*100)/100; let _t=0; (itens||[]).forEach(it=>{if(it.t==='G'||it.t==='SG')return; if((itens||[]).some(x=>x.id!==it.id&&x.id.startsWith(it.id+'.')))return; const _b=getBdiEfetivo(it,cfg); const _u=(it.upBdi&&it.upBdi>0)?it.upBdi:_r2((it.up||0)*(1+_b)); _t+=_r2((it.qtd||0)*_u);}); return Math.round(_t*100)/100; })();
    const valorAditivado= (v => Math.trunc(v * 100) / 100)(valorContrato - valorOriginal);
    const dataBR = iso => iso ? new Date(iso+'T12:00:00').toLocaleDateString('pt-BR') : '—';
    const hoje   = new Date();
    let prazoTotal='—', prazoRestTxt=diasRestantes||'—', atrasada=false;
    try {
      if (cfg.inicioPrev && cfg.termino) {
        const ini = new Date(cfg.inicioPrev), fim = new Date(cfg.termino);
        prazoTotal = Math.max(1, Math.round((fim-ini)/86400000)) + ' dias';
        atrasada   = fim < hoje;
      }
    } catch(e){}

    const barFn = (p,cor) => `<div style="height:7px;border-radius:4px;background:${cor}22;overflow:hidden;margin-top:4px">
      <div style="height:7px;border-radius:4px;background:${cor};width:${Math.min(100,Math.max(0,p))}%;transition:width .4s"></div></div>`;

    return `
    <div style="background:var(--bg-surface);border:1px solid var(--border);border-radius:12px;
      padding:18px 20px;margin-bottom:18px">

      <!-- Cabeçalho da seção -->
      <div style="display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:8px;margin-bottom:16px">
        <div style="font-size:10px;font-weight:700;color:var(--text-muted);text-transform:uppercase;letter-spacing:.5px">
          📄 Painel Contratual
        </div>
        <button data-action="_dashGerarPDFContratual"
          style="padding:6px 14px;background:var(--accent);border:none;border-radius:8px;color:#fff;
            font-size:11px;font-weight:700;cursor:pointer">
          🖨️ Gerar PDF do Painel Contratual
        </button>
      </div>

      <!-- Dados do contrato em grid -->
      <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(200px,1fr));gap:8px;margin-bottom:16px">
        ${[
          ['📋 Nº do Contrato',   cfg.contrato     || '—', '#2563eb'],
          ['🏗️ Objeto da Obra',  cfg.objeto        || '—', '#1e3a5f'],
          ['🏢 Empresa Executora',cfg.contratada   || '—', '#374151'],
          ['🏛️ Contratante',     cfg.contratante  || '—', '#374151'],
          ['👤 Fiscal',           cfg.fiscal       || '—', '#374151'],
          ['📅 Início / Término', `${dataBR(cfg.inicioPrev)} → ${dataBR(cfg.termino)}`, atrasada?'#dc2626':'#16a34a'],
        ].map(([l,v,c]) => `
          <div style="background:var(--bg-card);border:1px solid var(--border);border-radius:8px;padding:9px 12px">
            <div style="font-size:9px;font-weight:700;color:var(--text-muted);text-transform:uppercase;
              letter-spacing:.4px;margin-bottom:3px">${l}</div>
            <div style="font-size:11.5px;font-weight:700;color:${c};overflow:hidden;text-overflow:ellipsis;
              white-space:nowrap" title="${v}">${v}</div>
          </div>`).join('')}
      </div>

      <!-- Tabela financeira -->
      <div style="overflow-x:auto;margin-bottom:12px">
        <table style="width:100%;border-collapse:separate;border-spacing:0;font-size:12px">
          <thead>
            <tr style="background:var(--bg-card)">
              ${['Descrição','Valor (R$)','% do Contrato'].map((h,i) =>
                `<th style="padding:8px 12px;font-size:9.5px;font-weight:700;color:var(--text-muted);
                  text-transform:uppercase;letter-spacing:.3px;border-bottom:1px solid var(--border);
                  text-align:${i===0?'left':'right'}">${h}</th>`
              ).join('')}
            </tr>
          </thead>
          <tbody>
            ${[
              ['Valor Original do Contrato', valorOriginal,   '#374151'],
              ['Valor Aditivado',            valorAditivado,  valorAditivado>=0?'#16a34a':'#dc2626'],
              ['Valor Contratual Vigente',   valorContrato,   '#2563eb'],
              ['Valor Total Medido',         vAcumTotal,      '#7c3aed'],
              ['Saldo Contratual',           saldo,           saldo<0?'#dc2626':'#16a34a'],
            ].map(([l,v,c]) => `
              <tr style="border-bottom:1px solid var(--border)">
                <td style="padding:7px 12px;font-size:12px;color:var(--text-primary)">${l}</td>
                <td style="padding:7px 12px;text-align:right;font-family:var(--font-mono);
                  font-weight:700;font-size:12px;color:${c}">${R$(v)}</td>
                <td style="padding:7px 12px;text-align:right;font-size:11px;color:var(--text-muted)">
                  ${valorContrato>0?(Math.abs(v)/valorContrato*100).toFixed(2).replace('.',','):'0,00'} %
                </td>
              </tr>`).join('')}
          </tbody>
        </table>
      </div>
      <!-- Barra progresso financeiro -->
      <div style="display:flex;justify-content:space-between;font-size:10px;color:var(--text-muted);margin-bottom:2px">
        <span>Execução Financeira</span>
        <span style="font-weight:700;color:${pctFin>=90?'#16a34a':pctFin>=50?'#2563eb':'#ca8a04'}">
          ${pctFin.toFixed(2).replace('.',',')} %
        </span>
      </div>
      ${barFn(pctFin, pctFin>=90?'#16a34a':pctFin>=50?'#2563eb':'#ca8a04')}

      <!-- Prazo + Aditivos lado a lado -->
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-top:14px">
        <div>
          <div style="font-size:9.5px;font-weight:700;color:var(--text-muted);text-transform:uppercase;
            letter-spacing:.4px;margin-bottom:8px">📅 Prazo Contratual</div>
          ${[
            ['Prazo Total',    prazoTotal],
            ['Prazo Restante', prazoRestTxt],
            ['Início',         dataBR(cfg.inicioPrev)],
            ['Término',        dataBR(cfg.termino)],
          ].map(([l,v]) => `
            <div style="display:flex;justify-content:space-between;padding:5px 0;
              border-bottom:1px solid var(--border);font-size:11px">
              <span style="color:var(--text-muted)">${l}</span>
              <span style="font-weight:700;color:${l==='Prazo Restante'&&atrasada?'#dc2626':'var(--text-primary)'}">${v}</span>
            </div>`).join('')}
        </div>
        <div>
          <div style="font-size:9.5px;font-weight:700;color:var(--text-muted);text-transform:uppercase;
            letter-spacing:.4px;margin-bottom:8px">📝 Aditivos Contratuais (${aditivos.length})</div>
          ${aditivos.length === 0
            ? `<div style="font-size:12px;color:var(--text-muted);padding:8px 0">Nenhum aditivo cadastrado.</div>`
            : aditivos.slice(-5).map(a => {
                const varVal = ((a.valorNovo||0)-(a.valorAnterior||0));
                return `
                  <div style="display:flex;justify-content:space-between;padding:5px 0;
                    border-bottom:1px solid var(--border);font-size:11px">
                    <span style="font-weight:600;color:var(--text-primary)">${a.numero||'—'} · ${a.tipo||'—'}</span>
                    <span style="font-family:var(--font-mono);font-weight:700;
                      color:${varVal>=0?'#16a34a':'#dc2626'}">
                      ${a.valorNovo ? (varVal>=0?'+':'')+R$(varVal) : '—'}
                    </span>
                  </div>`;
              }).join('')}
        </div>
      </div>
    </div>`;
  }

  // ═══════════════════════════════════════════════════════════════
  //  PDF DO PAINEL CONTRATUAL
  // ═══════════════════════════════════════════════════════════════
  _gerarPDFContratual() {
    const obraId   = state.get('obraAtivaId');
    const cfg      = state.get('cfg') || {};
    const bms      = state.get('bms') || [];
    const itens    = state.get('itensContrato') || [];
    const aditivos = state.get('aditivos') || [];
    const hoje     = new Date();

    const valorOriginal  = cfg.valorOriginal || cfg.valor || 0;
    const valorContrato  = cfg.valor || 0;
    const valorAditivado = (v => Math.trunc(v * 100) / 100)(valorContrato - valorOriginal);
    const lastBm     = bms.length ? bms[bms.length-1] : null;
    const lastBmNum  = lastBm?.num || 0;
    let vAcumTotal=0, vMedAtual=0;
    try {
      if (lastBmNum > 0) {
        // FIX-CHARTS: usa funções importadas diretamente no topo do módulo
        vAcumTotal = getValorAcumuladoTotal(obraId, lastBmNum, itens, cfg);
        vMedAtual  = getValorMedicaoAtual(obraId, lastBmNum, itens, cfg);
      }
    } catch(e) {}
    const saldo   = (v => Math.trunc(v * 100) / 100)(valorContrato - vAcumTotal);
    const pctFin  = valorContrato > 0 ? (vAcumTotal/valorContrato*100) : 0;
    const dataBR  = iso => iso ? new Date(iso+'T12:00:00').toLocaleDateString('pt-BR') : '—';
    const barPDF  = (p,cor) => `<div style="background:#e5e7eb;border-radius:4px;height:10px;overflow:hidden">
      <div style="background:${cor};height:10px;width:${Math.min(100,Math.max(0,p))}%;border-radius:4px"></div></div>`;
    let prazoTotal='—', prazoRestante='—', atrasada=false, diasDecorridos=0, duracaoTotal=0;
    try {
      if (cfg.inicioPrev && cfg.termino) {
        const ini = new Date(cfg.inicioPrev), fim = new Date(cfg.termino);
        duracaoTotal   = Math.max(1, Math.round((fim-ini)/86400000));
        diasDecorridos = Math.round((hoje-ini)/86400000);
        const diasRest = Math.round((fim-hoje)/86400000);
        prazoTotal    = `${duracaoTotal} dias`;
        prazoRestante = diasRest>0?`${diasRest} dias`:diasRest===0?'Hoje':`${Math.abs(diasRest)}d atrasada`;
        atrasada = diasRest < 0;
      }
    } catch(e) {}
    const logo = state.get('logoBase64') || cfg.logo || '';
    const obraRef = (state.get('obrasLista')||[]).find(o=>o.id===obraId)||{};

    const html = `<!DOCTYPE html><html lang="pt-BR"><head><meta charset="UTF-8">
<title>Painel Contratual — ${cfg.objeto||'Obra'}</title>
<style>
  *{box-sizing:border-box;margin:0;padding:0}
  body{font-family:Arial,sans-serif;font-size:9pt;color:#111;padding:12mm}
  .header{display:flex;align-items:center;gap:16px;border-bottom:3px solid #1e3a5f;padding-bottom:10px;margin-bottom:14px}
  .logo{max-height:60px;max-width:100px}
  .orgao h1{font-size:12pt;font-weight:bold;color:#1e3a5f;text-transform:uppercase}
  .orgao p{font-size:8pt;color:#555}
  .titulo{text-align:center;font-size:14pt;font-weight:bold;color:#1e3a5f;text-transform:uppercase;letter-spacing:1px;margin:8px 0 4px}
  .subtitulo{text-align:center;font-size:8.5pt;color:#555;margin-bottom:14px}
  .secao{font-size:9pt;font-weight:bold;color:#1e3a5f;border-bottom:1.5px solid #1e3a5f;
    padding-bottom:4px;margin:12px 0 8px;text-transform:uppercase;letter-spacing:.5px}
  .grid2{display:grid;grid-template-columns:1fr 1fr;gap:8px}
  .grid3{display:grid;grid-template-columns:repeat(3,1fr);gap:8px}
  .grid4{display:grid;grid-template-columns:repeat(4,1fr);gap:7px;margin-bottom:10px}
  .card{border:1px solid #ddd;border-radius:3px;padding:6px 9px}
  .card-l{font-size:7pt;text-transform:uppercase;color:#888;letter-spacing:.3px;margin-bottom:2px}
  .card-v{font-size:9.5pt;font-weight:700}
  table{width:100%;border-collapse:collapse;font-size:8.5pt;margin-bottom:8px}
  thead th{background:#1e3a5f;color:#fff;padding:5px 7px;text-align:left;font-size:7.5pt;
    text-transform:uppercase;letter-spacing:.3px}
  td{border-bottom:1px solid #f1f5f9;padding:4px 7px}
  .td-r{text-align:right;font-family:'Courier New',monospace}
  tfoot td{background:#f1f5f9;font-weight:700;border-top:2px solid #1e3a5f}
  .row{display:flex;justify-content:space-between;font-size:8.5pt;padding:3.5px 0;border-bottom:1px solid #f3f4f6}
  .barra-bg{background:#e5e7eb;border-radius:4px;height:9px;overflow:hidden;margin-top:3px}
  .barra-fill{height:9px;border-radius:4px}
  .footer{margin-top:12px;border-top:1px solid #ddd;padding-top:5px;font-size:7.5pt;color:#888;text-align:center}
  .assin{display:flex;justify-content:space-around;margin-top:55px}
  .assin-bloco{text-align:center;width:40%}
  .assin-linha{border-top:1px solid #000;margin-top:60px;padding-top:5px;font-size:8.5pt}
  @media print{@page{size:A4;margin:0}body{padding:8mm}}
</style></head><body>

<div class="header">
  ${logo?`<img src="${logo}" class="logo" alt="Logo">`:''}
  <div class="orgao">
    <h1>${cfg.contratante||'CONTRATANTE'}</h1>
    <p>Setor de Controle e Fiscalização de Obras Públicas</p>
  </div>
</div>
<div class="titulo">Painel Contratual da Obra</div>
<div class="subtitulo">Emitido em ${hoje.toLocaleDateString('pt-BR')} às ${hoje.toLocaleTimeString('pt-BR',{hour:'2-digit',minute:'2-digit'})}</div>

<div class="secao">Identificação da Obra e do Contrato</div>
<div class="grid4">
  <div class="card" style="grid-column:span 2"><div class="card-l">Objeto / Descrição da Obra</div><div class="card-v" style="font-size:9pt">${cfg.objeto||'—'}</div></div>
  <div class="card"><div class="card-l">Nº do Contrato</div><div class="card-v">${cfg.contrato||'—'}</div></div>
  <div class="card"><div class="card-l">Status</div><div class="card-v">${obraRef.statusObra||'Em andamento'}</div></div>
  <div class="card" style="grid-column:span 2"><div class="card-l">Empresa Executora</div><div class="card-v">${cfg.contratada||'—'}</div></div>
  <div class="card" style="grid-column:span 2"><div class="card-l">Órgão Contratante</div><div class="card-v">${cfg.contratante||'—'}</div></div>
  <div class="card"><div class="card-l">Fiscal de Obras</div><div class="card-v">${cfg.fiscal||'—'}</div></div>
  <div class="card"><div class="card-l">Data de Início</div><div class="card-v">${dataBR(cfg.inicioPrev)}</div></div>
  <div class="card"><div class="card-l">Data de Término</div><div class="card-v" style="color:${atrasada?'#dc2626':'#15803d'}">${dataBR(cfg.termino)}</div></div>
  <div class="card"><div class="card-l">Prazo Total</div><div class="card-v">${prazoTotal}</div></div>
</div>

<div class="secao">Tabela Financeira do Contrato</div>
<table>
  <thead><tr>
    <th>Descrição</th>
    <th style="text-align:right;width:28%">Valor (R$)</th>
    <th style="text-align:right;width:18%">% do Contrato</th>
  </tr></thead>
  <tbody>
    ${[
      ['Valor Original do Contrato', valorOriginal,   '#374151'],
      ['Valor Aditivado',            valorAditivado,  valorAditivado>=0?'#15803d':'#dc2626'],
      ['Valor Contratual Vigente',   valorContrato,   '#1d4ed8'],
      ['Valor Total Medido',         vAcumTotal,      '#6d28d9'],
      ['Saldo Contratual',           saldo,           saldo<0?'#dc2626':'#15803d'],
    ].map(([l,v,c]) => `<tr>
      <td>${l}</td>
      <td class="td-r" style="color:${c};font-weight:700">${R$(v)}</td>
      <td class="td-r">${valorContrato>0?(Math.abs(v)/valorContrato*100).toFixed(2).replace('.',','):'0,00'} %</td>
    </tr>`).join('')}
  </tbody>
  <tfoot><tr>
    <td colspan="2" style="text-align:right">Execução Financeira</td>
    <td class="td-r">${pctFin.toFixed(2).replace('.',',')} %</td>
  </tr></tfoot>
</table>
<div style="margin-bottom:2px;display:flex;justify-content:space-between;font-size:8pt">
  <span>Progresso de Execução</span><span style="font-weight:700">${pctFin.toFixed(2).replace('.',',')}%</span>
</div>
${barPDF(pctFin,'#2563eb')}

<div class="grid2" style="margin-top:12px">
  <div>
    <div class="secao" style="margin-top:0">Prazo Contratual</div>
    ${[
      ['Prazo Total da Obra', prazoTotal],
      ['Prazo Restante',      prazoRestante],
      ['Dias Decorridos',     `${Math.max(0,diasDecorridos)} / ${duracaoTotal}`],
      ['Data de Início',      dataBR(cfg.inicioPrev)],
      ['Data de Término',     dataBR(cfg.termino)],
    ].map(([l,v]) => `<div class="row"><span>${l}</span><span style="font-weight:700;color:${l==='Prazo Restante'&&atrasada?'#dc2626':'#111'}">${v}</span></div>`).join('')}
  </div>
  <div>
    <div class="secao" style="margin-top:0">Resumo de Medições (${bms.length} BM${bms.length!==1?'s':''})</div>
    ${bms.length===0?'<p style="font-size:8.5pt;color:#888">Nenhum BM registrado.</p>':
      `<table style="margin-bottom:0"><thead><tr><th>BM</th><th>Período</th><th>Data</th><th style="text-align:right">Valor Medido</th></tr></thead><tbody>
      ${bms.slice(-8).map(b=>{const vBm=(()=>{try{return getValorMedicaoAtual(obraId,b.num,itens,cfg);}catch(ex){return 0;}})();return `<tr><td style="font-weight:700">BM ${b.num}</td><td>${b.mes||'—'}</td><td>${b.data||'—'}</td><td class="td-r" style="font-weight:700;color:${vBm>0?'#15803d':'#888'}">${R$(vBm)}</td></tr>`;}).join('')}
      </tbody></table>`}
  </div>
</div>

${aditivos.length>0?`
<div class="secao">Resumo de Aditivos Contratuais (${aditivos.length})</div>
<table>
  <thead><tr>
    <th>Nº</th><th>Tipo</th><th>Data</th>
    <th style="text-align:right">Valor Anterior</th>
    <th style="text-align:right">Valor Novo</th>
    <th style="text-align:right">Variação</th>
    <th>Status</th>
  </tr></thead>
  <tbody>
    ${aditivos.map(a=>{
      const var_ = (v => Math.trunc(v * 100) / 100)((a.valorNovo||0)-(a.valorAnterior||0));
      return `<tr>
        <td style="font-weight:700">${a.numero||'—'}</td>
        <td>${a.tipo||'—'}</td>
        <td>${a.data||'—'}</td>
        <td class="td-r">${a.valorAnterior?R$(a.valorAnterior):'—'}</td>
        <td class="td-r" style="font-weight:700">${a.valorNovo?R$(a.valorNovo):'—'}</td>
        <td class="td-r" style="color:${var_>=0?'#15803d':'#dc2626'}">${a.valorNovo?(var_>=0?'+':'')+R$(var_):'—'}</td>
        <td>${a.status||'—'}</td>
      </tr>`;
    }).join('')}
  </tbody>
</table>`:''}

<div class="assin">
  <div class="assin-bloco"><div class="assin-linha">${cfg.contratada||'Empresa Executora'}<br>Representante Legal</div></div>
  <div class="assin-bloco"><div class="assin-linha">${cfg.fiscal||'Fiscal de Obras'}<br>${cfg.contratante||'Órgão Contratante'}</div></div>
</div>

<div class="footer">Painel Contratual — ${cfg.contratante||''} · Sistema Fiscal na Obra · Gerado em ${hoje.toLocaleString('pt-BR')}</div>
<script>window.print();<\/script>
</body></html>`;

    const w = window.open('','_blank','width=900,height=700');
    if (w) { w.document.write(html); w.document.close(); }
    else window.toast?.('⚠️ Permita popups para gerar PDF.','warn');
  }

    destroy() {
      this._subs.forEach(u => u()); this._subs = [];
      // FIX-CHARTS: cancela qualquer render pendente e invalida tokens
      if (this._renderTimer) { clearTimeout(this._renderTimer); this._renderTimer = null; }
      this._renderToken++;
      if (this._chartBmsMes) { this._chartBmsMes.destroy(); this._chartBmsMes = null; }
      if (this._chartCurvaS) { this._chartCurvaS.destroy(); this._chartCurvaS = null; }
      if (this._chartDistItens) { this._chartDistItens.destroy(); this._chartDistItens = null; }
    }
}
