/**
 * ╔══════════════════════════════════════════════════════════════╗
 * ║  FISCAL NA OBRA v15.5 — modules/dashboard-analytics/        ║
 * ║  dash-analytics.js                                          ║
 * ║  Aba "Analytics" no Dashboard — Gráficos e Indicadores      ║
 * ╠══════════════════════════════════════════════════════════════╣
 * ║  Adiciona uma 4ª aba "📈 Analytics" ao dashboard existente  ║
 * ║  sem alterar os módulos originais.                          ║
 * ║                                                              ║
 * ║  Painéis:                                                   ║
 * ║   • Ritmo de medição por BM (barras)                        ║
 * ║   • Curva S planejado × executado (linha)                   ║
 * ║   • Distribuição de valor por grupo (doughnut)              ║
 * ║   • Previsão de término (regressão linear simples)          ║
 * ║   • Tabela de itens com maior saldo                         ║
 * ║   • Alertas do ValidationEngine                             ║
 * ╚══════════════════════════════════════════════════════════════╝
 */

import EventBus   from '../../core/EventBus.js';
import state      from '../../core/state.js';
import logger     from '../../core/logger.js';
import { formatters } from '../../utils/formatters.js';

const R$  = v => formatters.currency ? formatters.currency(v) : (v||0).toLocaleString('pt-BR',{style:'currency',currency:'BRL'});
const pct = v => ((parseFloat(v)||0).toFixed(1)).replace('.',',') + '%';

// ── Chaves de chart para cleanup ──────────────────────────────
const _charts = {};
function _destroyChart(key) {
  if (_charts[key]) { try { _charts[key].destroy(); } catch {} _charts[key] = null; }
}

// ═══════════════════════════════════════════════════════════════
// DashAnalyticsModule
// ═══════════════════════════════════════════════════════════════
export class DashAnalyticsModule {

  constructor() { this._subs = []; this._ativo = false; }

  init() {
    try {
      this._patchDashboardTabs();
      this._bindEvents();
      logger.info('DashAnalytics', '✅ Aba Analytics ativa.');
    } catch(e) {
      logger.warn('DashAnalytics', `init: ${e.message}`);
    }
  }

  onEnter() {
    // Chamado pelo app.js quando o módulo dashboard entra em foco
    if (this._ativo) this._render();
  }

  // ── Patch: injeta aba "Analytics" no tab header do dashboard ─

  _patchDashboardTabs() {
    // Intercepta _renderTabHeader do DashboardModule para adicionar aba Analytics
    // Usamos um MutationObserver no container do dashboard
    const observer = new MutationObserver(() => {
      const hdr = document.getElementById('dash-tab-header');
      if (!hdr || hdr.querySelector('[data-analytics-tab]')) return;

      const btn = document.createElement('button');
      btn.setAttribute('data-analytics-tab', '1');
      btn.setAttribute('data-action', '_dashAnalyticsAba');
      btn.style.cssText = 'padding:8px 18px;border:none;border-bottom:3px solid transparent;' +
        'background:transparent;cursor:pointer;font-size:12px;font-weight:600;' +
        'color:var(--text-muted);transition:all .15s;white-space:nowrap';
      btn.textContent = '📈 Analytics';
      // Insere antes do spacer (flex:1)
      const spacer = hdr.querySelector('div[style*="flex:1"]') || hdr.lastElementChild;
      hdr.insertBefore(btn, spacer);

      // FIX-CHARTS: desconecta o observer imediatamente após inserir o botão.
      // Sem isso, a inserção do botão dispara uma nova mutação no DOM que
      // re-executa este callback, podendo invalidar o _renderToken do dashboard
      // e destruir os <canvas> antes dos gráficos serem desenhados.
      observer.disconnect();

      // Registra handler se ainda não registrado
      if (!window._dashAnalyticsAbaReg) {
        window._dashAnalyticsAbaReg = true;
        window._dashAnalyticsAba = () => {
          this._ativo = true;
          // Desativa a aba atual do dashboard (remove bordas ativas)
          hdr.querySelectorAll('button[data-action="_dashTab"]').forEach(b => {
            b.style.borderBottomColor = 'transparent';
            b.style.fontWeight = '600';
            b.style.color = 'var(--text-muted)';
          });
          btn.style.borderBottomColor = 'var(--accent)';
          btn.style.fontWeight = '800';
          btn.style.color = 'var(--accent)';
          this._render();
        };
        // Registra no EventDelegate se disponível
        try {
          const { EventDelegate } = window.__EventDelegate || {};
          if (EventDelegate) EventDelegate.register('_dashAnalyticsAba', window._dashAnalyticsAba);
        } catch {}

        // Fallback: listener de click direto
        btn.addEventListener('click', () => window._dashAnalyticsAba?.());
      }
    });

    const container = document.getElementById('dashboard');
    if (container) observer.observe(container, { childList: true, subtree: true });
  }

  _bindEvents() {
    ['obra:selecionada','medicao:salva','itens:atualizados','boletim:atualizado'].forEach(ev => {
      EventBus.on(ev, () => { if (this._ativo) this._render(); }, 'dashAnalytics');
    });

    // Alertas do ValidationEngine
    EventBus.on('validation:resultado', ({ alertas }) => {
      if (this._ativo) this._atualizarAlertas(alertas);
    }, 'dashAnalytics');
  }

  // ═══════════════════════════════════════════════════════════════
  // Render principal
  // ═══════════════════════════════════════════════════════════════
  _render() {
    const dash = document.getElementById('dashboard');
    if (!dash) return;

    const inner = dash.querySelector('.dash-dark');
    if (!inner) return;

    // Remove body anterior e injeta o nosso
    let body = inner.querySelector('#dash-analytics-body');
    if (!body) {
      // Remove body de outras abas
      inner.querySelector('#dash-tab-body')?.remove();
      body = document.createElement('div');
      body.id = 'dash-analytics-body';
      inner.appendChild(body);
    }

    const obraId = state.get('obraAtivaId');
    if (!obraId) {
      body.innerHTML = '<div style="padding:40px;text-align:center;color:var(--text-muted)">Selecione uma obra para ver os Analytics.</div>';
      return;
    }

    const cfg   = state.get('cfg')           || {};
    const bms   = state.get('bms')           || [];
    const itens = state.get('itensContrato') || [];
    const getAcumAnt = window._bmCalc_getValorAcumuladoAnterior;
    const getAcumTot = window._bmCalc_getValorAcumuladoTotal;

    // Calcula série financeira dos BMs
    const serieBMs = bms.map(bm => {
      let vMed = 0, vAcum = 0;
      try {
        if (typeof getAcumAnt === 'function' && typeof getAcumTot === 'function') {
          vAcum = getAcumTot(obraId, bm.num, itens, cfg);
          vMed  = vAcum - getAcumAnt(obraId, bm.num, itens, cfg);
        }
      } catch {}
      return { bm, vMed, vAcum };
    });

    const valorContrato = cfg.valor || 0;
    const lastEntry     = serieBMs[serieBMs.length - 1];
    const vAcumTotal    = lastEntry?.vAcum || 0;
    const saldo         = valorContrato - vAcumTotal;
    const pctFin        = valorContrato > 0 ? (vAcumTotal / valorContrato * 100) : 0;

    // Previsão de término
    const previsao = this._calcPrevisao(serieBMs, valorContrato, cfg);

    // Alertas do validationEngine
    const alertas = window.validationEngine?.getAlertas() || [];

    body.innerHTML = this._htmlLayout(serieBMs, valorContrato, vAcumTotal, saldo, pctFin, previsao, alertas, itens, obraId, cfg);

    // Renderiza gráficos após DOM estar pronto
    requestAnimationFrame(() => {
      this._chartRitmo(serieBMs);
      this._chartCurvaS(serieBMs, valorContrato);
      this._chartGrupos(itens, obraId, bms, cfg);
    });
  }

  // ── HTML do layout ────────────────────────────────────────────
  _htmlLayout(serie, valorContrato, vAcumTotal, saldo, pctFin, previsao, alertas, itens, obraId, cfg) {
    const getAcumTot = window._bmCalc_getValorAcumuladoTotal;
    const itensSvc   = itens.filter(i => !i.t);
    const lastBmNum  = serie.length ? serie[serie.length-1].bm.num : 0;

    // Top 5 itens com maior saldo
    const top5Saldo = itensSvc
      .map(it => {
        const upBdi  = (it.up||0) * (1 + (cfg.bdi||0.25));
        const totCont= (it.qtd||0) * upBdi;
        let totAcum  = 0;
        try {
          if (typeof getAcumTot === 'function' && lastBmNum > 0) {
            // Aproximação: usa qtdAcum estimada via totAcum
            totAcum = getAcumTot(obraId, lastBmNum, [it], cfg);
          }
        } catch {}
        return { it, totCont, saldoVal: totCont - totAcum, pctExec: totCont > 0 ? ((totAcum/totCont)*100) : 0 };
      })
      .filter(x => x.totCont > 0)
      .sort((a,b) => b.saldoVal - a.saldoVal)
      .slice(0, 5);

    const corAlerta = a => a.gravidade === 'error' ? '#dc2626' : a.gravidade === 'warn' ? '#d97706' : '#6b7280';
    const iconAlerta= a => a.gravidade === 'error' ? '🚨' : a.gravidade === 'warn' ? '⚠️' : 'ℹ️';

    return `
    <div style="display:flex;flex-direction:column;gap:14px;padding-bottom:24px">

      <!-- KPIs de topo -->
      <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(160px,1fr));gap:10px">
        ${[
          ['💰','Valor do Contrato', R$(valorContrato), '#2563eb'],
          ['✅','Acumulado Medido',  R$(vAcumTotal)+' ('+pct(pctFin)+')', '#16a34a'],
          ['⏳','Saldo a Executar',  R$(saldo), saldo < 0 ? '#dc2626' : '#ca8a04'],
          ['📋','BMs Realizados',    serie.length, '#7c3aed'],
          ['🔮','Previsão Término',  previsao.label, previsao.atrasado ? '#dc2626' : '#059669'],
        ].map(([i,l,v,c]) => `
          <div style="background:var(--bg-surface);border:1px solid var(--border);border-radius:10px;padding:14px">
            <div style="font-size:10px;color:var(--text-muted);margin-bottom:4px">${i} ${l}</div>
            <div style="font-size:14px;font-weight:700;color:${c};font-family:var(--font-mono)">${v}</div>
          </div>`).join('')}
      </div>

      <!-- Gráficos principais -->
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:14px">
        <div style="background:var(--bg-surface);border:1px solid var(--border);border-radius:12px;padding:16px">
          <div style="font-size:11px;font-weight:700;color:var(--text-muted);margin-bottom:10px">📊 RITMO DE MEDIÇÃO POR BM (R$)</div>
          <div style="height:180px;position:relative"><canvas id="da-chart-ritmo"></canvas></div>
        </div>
        <div style="background:var(--bg-surface);border:1px solid var(--border);border-radius:12px;padding:16px">
          <div style="font-size:11px;font-weight:700;color:var(--text-muted);margin-bottom:10px">📈 CURVA S — ACUMULADO × CONTRATO</div>
          <div style="height:180px;position:relative"><canvas id="da-chart-curva"></canvas></div>
        </div>
      </div>

      <div style="display:grid;grid-template-columns:1fr 1fr;gap:14px">
        <!-- Doughnut distribuição por grupo -->
        <div style="background:var(--bg-surface);border:1px solid var(--border);border-radius:12px;padding:16px">
          <div style="font-size:11px;font-weight:700;color:var(--text-muted);margin-bottom:10px">🍩 DISTRIBUIÇÃO DE VALOR POR GRUPO</div>
          <div style="height:180px;position:relative"><canvas id="da-chart-grupos"></canvas></div>
        </div>

        <!-- Previsão de término -->
        <div style="background:var(--bg-surface);border:1px solid var(--border);border-radius:12px;padding:16px">
          <div style="font-size:11px;font-weight:700;color:var(--text-muted);margin-bottom:12px">🔮 PREVISÃO DE TÉRMINO</div>
          <div style="display:flex;flex-direction:column;gap:8px">
            ${[
              ['Ritmo médio/BM',    previsao.ritmoMedio  > 0 ? R$(previsao.ritmoMedio)   : '—'],
              ['BMs p/ concluir',   previsao.bmsRestantes > 0 ? previsao.bmsRestantes+' BMs' : '—'],
              ['Data estimada',     previsao.label],
              ['Termino contratual',previsao.terminoContratual || '—'],
              ['Status',            previsao.status],
            ].map(([l,v]) => `
              <div style="display:flex;justify-content:space-between;padding:6px 10px;
                border-radius:7px;background:var(--bg-card)">
                <span style="font-size:11px;color:var(--text-muted)">${l}</span>
                <span style="font-size:11px;font-weight:700;color:var(--text-primary)">${v}</span>
              </div>`).join('')}
          </div>
        </div>
      </div>

      <!-- Top 5 saldos + Alertas -->
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:14px">
        <div style="background:var(--bg-surface);border:1px solid var(--border);border-radius:12px;padding:16px">
          <div style="font-size:11px;font-weight:700;color:var(--text-muted);margin-bottom:10px">⚠️ ITENS COM MAIOR SALDO A EXECUTAR</div>
          ${top5Saldo.length ? `<div style="display:flex;flex-direction:column;gap:6px">
            ${top5Saldo.map(({it,totCont,saldoVal,pctExec}) => `
              <div style="padding:8px 10px;background:var(--bg-card);border-radius:7px">
                <div style="display:flex;justify-content:space-between;margin-bottom:4px">
                  <span style="font-size:11px;font-weight:600;color:var(--text-primary);
                    white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:60%">${it.id} ${(it.desc||'').slice(0,30)}</span>
                  <span style="font-size:11px;font-weight:700;color:#ca8a04;font-family:var(--font-mono)">${R$(saldoVal)}</span>
                </div>
                <div style="height:4px;border-radius:2px;background:var(--border)">
                  <div style="height:4px;border-radius:2px;background:#16a34a;width:${Math.min(100,pctExec).toFixed(1)}%;transition:width .4s"></div>
                </div>
                <div style="font-size:9px;color:var(--text-muted);margin-top:2px">${pct(pctExec)} executado de ${R$(totCont)}</div>
              </div>`).join('')}
          </div>` : '<div style="color:var(--text-muted);font-size:12px;padding:12px">Nenhum item com saldo calculado.</div>'}
        </div>

        <!-- Alertas do ValidationEngine -->
        <div style="background:var(--bg-surface);border:1px solid var(--border);border-radius:12px;padding:16px">
          <div style="font-size:11px;font-weight:700;color:var(--text-muted);margin-bottom:10px">🔍 ALERTAS DE VALIDAÇÃO</div>
          <div id="da-alertas-wrap" style="display:flex;flex-direction:column;gap:5px;max-height:220px;overflow-y:auto">
            ${alertas.length ? alertas.slice(0,10).map(a => `
              <div style="display:flex;gap:8px;align-items:flex-start;padding:7px 10px;
                background:${corAlerta(a)}11;border:1px solid ${corAlerta(a)}44;border-radius:7px">
                <span style="flex-shrink:0;margin-top:1px">${iconAlerta(a)}</span>
                <div>
                  <div style="font-size:10px;font-weight:700;color:${corAlerta(a)}">${a.modulo}</div>
                  <div style="font-size:11px;color:var(--text-primary)">${a.msg}</div>
                </div>
              </div>`).join('')
            : '<div style="color:#16a34a;font-size:12px;padding:12px">✅ Nenhum alerta — dados consistentes.</div>'}
          </div>
        </div>
      </div>
    </div>`;
  }

  // ── Atualiza apenas o painel de alertas (sem re-render completo) ─
  _atualizarAlertas(alertas) {
    const wrap = document.getElementById('da-alertas-wrap');
    if (!wrap) return;
    const corAlerta  = a => a.gravidade === 'error' ? '#dc2626' : a.gravidade === 'warn' ? '#d97706' : '#6b7280';
    const iconAlerta = a => a.gravidade === 'error' ? '🚨' : a.gravidade === 'warn' ? '⚠️' : 'ℹ️';
    wrap.innerHTML = alertas.length
      ? alertas.slice(0,10).map(a => `
          <div style="display:flex;gap:8px;align-items:flex-start;padding:7px 10px;
            background:${corAlerta(a)}11;border:1px solid ${corAlerta(a)}44;border-radius:7px">
            <span style="flex-shrink:0;margin-top:1px">${iconAlerta(a)}</span>
            <div>
              <div style="font-size:10px;font-weight:700;color:${corAlerta(a)}">${a.modulo}</div>
              <div style="font-size:11px;color:var(--text-primary)">${a.msg}</div>
            </div>
          </div>`).join('')
      : '<div style="color:#16a34a;font-size:12px;padding:12px">✅ Nenhum alerta — dados consistentes.</div>';
  }

  // ── Previsão de término (regressão linear simples) ────────────
  _calcPrevisao(serie, valorContrato, cfg) {
    const fallback = { label: '—', ritmoMedio: 0, bmsRestantes: 0, atrasado: false, status: '—', terminoContratual: cfg.termino || '—' };
    if (serie.length < 2 || !valorContrato) return fallback;

    const ritmos   = serie.map(s => s.vMed).filter(v => v > 0);
    if (!ritmos.length) return fallback;

    const ritmoMedio  = ritmos.reduce((a,b) => a+b, 0) / ritmos.length;
    const saldoValor  = valorContrato - (serie[serie.length-1]?.vAcum || 0);
    if (saldoValor <= 0) return { label: 'Concluído', ritmoMedio, bmsRestantes: 0, atrasado: false, status: '✅ Obra concluída', terminoContratual: cfg.termino || '—' };

    const bmsRestantes = Math.ceil(saldoValor / ritmoMedio);

    // Estima data baseada no último BM + bmsRestantes meses
    let labelData = '—';
    let atrasado  = false;
    try {
      const ultimaBm   = serie[serie.length-1]?.bm;
      const ultimaData = ultimaBm?.data ? new Date(ultimaBm.data + 'T12:00:00') : new Date();
      ultimaData.setMonth(ultimaData.getMonth() + bmsRestantes);
      labelData = ultimaData.toLocaleDateString('pt-BR', { month:'long', year:'numeric' });

      if (cfg.termino) {
        const terminoCont = new Date(cfg.termino + 'T12:00:00');
        atrasado = ultimaData > terminoCont;
      }
    } catch {}

    const status = atrasado
      ? `⚠️ Estimativa ${bmsRestantes} BMs acima do prazo`
      : `✅ Estimativa dentro do prazo (${bmsRestantes} BMs)`;

    return { label: labelData, ritmoMedio, bmsRestantes, atrasado, status, terminoContratual: cfg.termino || '—' };
  }

  // ── Gráficos ──────────────────────────────────────────────────

  _chartRitmo(serie) {
    _destroyChart('ritmo');
    const canvas = document.getElementById('da-chart-ritmo');
    if (!canvas || typeof Chart === 'undefined') return;

    const labels = serie.map(s => s.bm.label || `BM ${s.bm.num}`);
    const dados  = serie.map(s => parseFloat(s.vMed.toFixed(2)));
    const ctx    = canvas.getContext('2d');

    _charts.ritmo = new Chart(ctx, {
      type: 'bar',
      data: {
        labels,
        datasets: [{
          label: 'Valor do BM (R$)',
          data: dados,
          backgroundColor: 'rgba(34,197,94,0.65)',
          borderColor: 'rgba(22,163,74,1)',
          borderWidth: 1, borderRadius: 5, maxBarThickness: 48,
        }],
      },
      options: {
        responsive: true, maintainAspectRatio: false,
        plugins: { legend: { display: false } },
        scales: {
          x: { grid: { display: false }, ticks: { font: { size: 9 } } },
          y: { ticks: { font: { size: 9 }, callback: v => 'R$' + (v/1000).toFixed(0)+'k' } },
        },
      },
    });
  }

  _chartCurvaS(serie, valorContrato) {
    _destroyChart('curva');
    const canvas = document.getElementById('da-chart-curva');
    if (!canvas || typeof Chart === 'undefined' || !valorContrato) return;

    const labels = serie.map(s => s.bm.label || `BM ${s.bm.num}`);
    const acumulado = serie.map(s => parseFloat((s.vAcum / valorContrato * 100).toFixed(2)));
    // Linha de referência linear (planejado uniform)
    const planejado = serie.map((_, i) => parseFloat(((i+1)/serie.length*100).toFixed(2)));

    const ctx = canvas.getContext('2d');
    _charts.curva = new Chart(ctx, {
      type: 'line',
      data: {
        labels,
        datasets: [
          {
            label: 'Executado (%)',
            data: acumulado,
            borderColor: '#16a34a', backgroundColor: 'rgba(34,197,94,0.1)',
            fill: true, tension: 0.3, pointRadius: 3, borderWidth: 2,
          },
          {
            label: 'Planejado (%)',
            data: planejado,
            borderColor: '#2563eb', borderDash: [5,5],
            fill: false, tension: 0.3, pointRadius: 0, borderWidth: 1.5,
          },
        ],
      },
      options: {
        responsive: true, maintainAspectRatio: false,
        plugins: { legend: { labels: { font: { size: 9 }, boxWidth: 12 } } },
        scales: {
          x: { grid: { display: false }, ticks: { font: { size: 9 } } },
          y: { ticks: { font: { size: 9 }, callback: v => v + '%' }, max: 100, min: 0 },
        },
      },
    });
  }

  _chartGrupos(itens, obraId, bms, cfg) {
    _destroyChart('grupos');
    const canvas = document.getElementById('da-chart-grupos');
    if (!canvas || typeof Chart === 'undefined') return;

    // Agrupa itens de serviço pelo grupo pai (tipo G)
    const grupos = itens.filter(i => i.t === 'G');
    if (!grupos.length) return;

    const getAcumTot = window._bmCalc_getValorAcumuladoTotal;
    const lastBmNum  = bms.length ? bms[bms.length-1].num : 0;

    const labels = [], dados = [], cores = [];
    const PALETA = ['#3b82f6','#16a34a','#f59e0b','#8b5cf6','#ef4444','#06b6d4','#84cc16','#f97316'];

    grupos.forEach((g, idx) => {
      const filhos  = itens.filter(i => !i.t && i.id.startsWith(g.id + '.'));
      let totCont   = 0;
      filhos.forEach(it => { totCont += (it.qtd||0) * (it.up||0) * (1 + (cfg.bdi||0.25)); });
      if (totCont <= 0) return;
      labels.push((g.desc || g.id).slice(0, 25));
      dados.push(parseFloat(totCont.toFixed(2)));
      cores.push(PALETA[idx % PALETA.length]);
    });

    if (!dados.length) return;

    const ctx = canvas.getContext('2d');
    _charts.grupos = new Chart(ctx, {
      type: 'doughnut',
      data: { labels, datasets: [{ data: dados, backgroundColor: cores, borderWidth: 1, hoverOffset: 8 }] },
      options: {
        responsive: true, maintainAspectRatio: false,
        plugins: {
          legend: { position: 'right', labels: { font: { size: 9 }, boxWidth: 10, padding: 8 } },
          tooltip: { callbacks: { label: ctx => ` ${R$(ctx.raw)}` } },
        },
        cutout: '60%',
      },
    });
  }
}

export default DashAnalyticsModule;
