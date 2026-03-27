/**
 * FISCAL NA OBRA v16 - prazos-controller.js
 * Controle de Prazos + Cronograma + Curva S
 */

import EventBus        from '../../core/EventBus.js';
import state           from '../../core/state.js';
import router          from '../../core/router.js';
import { formatters }  from '../../utils/formatters.js';
import FirebaseService from '../../firebase/firebase-service.js';
import { validarProrrogacao } from '../../utils/server-validators.js';

const dataBR   = iso => iso ? new Date(iso + 'T12:00:00').toLocaleDateString('pt-BR') : '—';
const hoje     = () => new Date().toISOString().slice(0, 10);
const esc      = s => String(s || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
const diffDias = dataFim => {
  if (!dataFim) return null;
  return Math.ceil((new Date(dataFim + 'T23:59:59') - new Date()) / 86400000);
};

export class PrazosModule {
  constructor() {
    this._subs         = [];
    this._prorrogacoes = [];
    this._cronograma   = [];
    this._tabAtual     = 'prazos';
  }

  async init() {
    try { this._bindEvents(); this._exposeGlobals(); }
    catch (e) { console.error('[PrazosModule] init:', e); }
  }

  async onEnter() {
    try { await this._carregar(); this._render(); }
    catch (e) { console.error('[PrazosModule] onEnter:', e); }
  }

  async _carregar() {
    const obraId = state.get('obraAtivaId');
    if (!obraId) return;
    const [prorrs, cron] = await Promise.all([
      FirebaseService.getProrrogacoes(obraId).catch(() => []),
      FirebaseService.getCronograma(obraId).catch(() => []),
    ]);
    this._prorrogacoes = prorrs || [];
    this._cronograma   = cron   || [];
  }

  async _salvar() {
    const obraId = state.get('obraAtivaId');
    if (!obraId) return;
    await FirebaseService.salvarProrrogacoes(obraId, this._prorrogacoes);
  }

  async _salvarCronograma() {
    const obraId = state.get('obraAtivaId');
    if (!obraId) return;
    await FirebaseService.salvarCronograma(obraId, this._cronograma);
  }

  _calcPrazo(cfg) {
    const inicio    = cfg.inicioReal || cfg.inicioPrev || null;
    const diasBase  = parseInt(cfg.duracaoDias) || 0;
    const diasProrr = this._prorrogacoes.reduce((a,p) => a + (parseInt(p.dias) || 0), 0);
    const diasTotal = diasBase + diasProrr;
    let dataFimStr = null;
    if (inicio && diasTotal > 0) {
      const d = new Date(inicio + 'T12:00:00');
      d.setDate(d.getDate() + diasTotal);
      dataFimStr = d.toISOString().slice(0, 10);
    } else if (cfg.termino) {
      dataFimStr = cfg.termino;
    }
    const diasRestantes = dataFimStr ? diffDias(dataFimStr) : null;
    let status = 'indefinido';
    if (diasRestantes !== null) {
      if (diasRestantes < 0)       status = 'atrasado';
      else if (diasRestantes <= 30) status = 'atencao';
      else                          status = 'em_dia';
    }
    const obraRef = (state.get('obrasLista') || []).find(o => o.id === state.get('obraAtivaId'));
    if (obraRef?.statusObra === 'Concluída') status = 'concluido';
    return { inicio, diasBase, diasProrr, diasTotal, dataFimStr, diasRestantes, status };
  }

  _render(tab) {
    if (tab) this._tabAtual = tab;
    const el = document.getElementById('prazos-conteudo');
    if (!el) return;
    const obraId = state.get('obraAtivaId');
    if (!obraId) {
      el.innerHTML = '<div style="text-align:center;padding:40px;color:var(--text-muted)">Selecione uma obra.</div>';
      return;
    }
    const tabs = [
      { id:'prazos', icon:'📅', label:'Controle de Prazo' },
      { id:'cronograma', icon:'📋', label:'Cronograma' },
      { id:'curva', icon:'📈', label:'Curva S' },
    ];
    const tabHtml = `<div style="display:flex;gap:4px;margin-bottom:18px;border-bottom:2px solid var(--border);padding-bottom:0">
      ${tabs.map(t => `<button data-action="_prazoTab" data-arg0="${t.id}"
        style="padding:8px 16px;border:none;background:none;cursor:pointer;font-size:12px;font-weight:700;
          color:${this._tabAtual===t.id?'var(--accent)':'var(--text-muted)'};
          border-bottom:2px solid ${this._tabAtual===t.id?'var(--accent)':'transparent'};
          margin-bottom:-2px;transition:all .15s">${t.icon} ${t.label}</button>`).join('')}
    </div>`;
    let conteudo = '';
    if (this._tabAtual === 'prazos')          conteudo = this._htmlPrazos();
    else if (this._tabAtual === 'cronograma') conteudo = this._htmlCronograma();
    else if (this._tabAtual === 'curva')      conteudo = this._htmlCurvaS();
    el.innerHTML = tabHtml + conteudo;
    if (this._tabAtual === 'curva') requestAnimationFrame(() => this._desenharCurvaS());
  }

  /* ── TAB PRAZOS ─────────────────────────────────────────── */
  _htmlPrazos() {
    const cfg = state.get('cfg') || {};
    const p   = this._calcPrazo(cfg);
    const SC  = {
      em_dia:     {bg:'#dcfce7',border:'#22c55e',text:'#15803d',label:'✅ Em dia'},
      atencao:    {bg:'#fef3c7',border:'#f59e0b',text:'#92400e',label:'⚠️ Atenção'},
      atrasado:   {bg:'#fee2e2',border:'#ef4444',text:'#991b1b',label:'🔴 Atrasado'},
      concluido:  {bg:'#dbeafe',border:'#3b82f6',text:'#1e40af',label:'🏆 Concluído'},
      indefinido: {bg:'#f3f4f6',border:'#9ca3af',text:'#6b7280',label:'❓ Indefinido'},
    };
    const sc = SC[p.status] || SC.indefinido;

    return `
    <div style="background:${sc.bg};border:2px solid ${sc.border};border-radius:12px;padding:16px 20px;margin-bottom:16px;display:grid;grid-template-columns:1fr 1fr 1fr 1fr;gap:12px">
      <div style="text-align:center"><div style="font-size:10px;color:${sc.text};text-transform:uppercase;font-weight:700;letter-spacing:.5px">Status</div><div style="font-size:16px;font-weight:900;color:${sc.text};margin-top:4px">${sc.label}</div></div>
      <div style="text-align:center"><div style="font-size:10px;color:var(--text-muted);text-transform:uppercase;font-weight:700;letter-spacing:.5px">Prazo Original</div><div style="font-size:15px;font-weight:800;color:var(--text-primary);margin-top:4px">${p.diasBase>0?p.diasBase+' dias':'—'}</div></div>
      <div style="text-align:center"><div style="font-size:10px;color:var(--text-muted);text-transform:uppercase;font-weight:700;letter-spacing:.5px">Total Prorrogado</div><div style="font-size:15px;font-weight:800;color:${p.diasProrr>0?'#f59e0b':'var(--text-primary)'};margin-top:4px">${p.diasProrr>0?'+'+p.diasProrr+' dias':'—'}</div></div>
      <div style="text-align:center"><div style="font-size:10px;color:var(--text-muted);text-transform:uppercase;font-weight:700;letter-spacing:.5px">${p.diasRestantes!==null&&p.diasRestantes<0?'Dias em Atraso':'Dias Restantes'}</div><div style="font-size:15px;font-weight:800;color:${sc.text};margin-top:4px">${p.diasRestantes!==null?Math.abs(p.diasRestantes):'—'}</div></div>
    </div>
    <div style="background:var(--bg-surface);border:1px solid var(--border);border-radius:8px;padding:12px 16px;margin-bottom:14px;display:grid;grid-template-columns:1fr 1fr 1fr 1fr;gap:10px">
      <div><div style="font-size:10px;font-weight:700;color:var(--text-muted)">INÍCIO PREVISTO</div><div style="font-size:12px;font-weight:600;margin-top:3px">${dataBR(cfg.inicioPrev)}</div></div>
      <div><div style="font-size:10px;font-weight:700;color:var(--text-muted)">INÍCIO REAL</div><div style="font-size:12px;font-weight:600;margin-top:3px">${dataBR(cfg.inicioReal)||'—'}</div></div>
      <div><div style="font-size:10px;font-weight:700;color:var(--text-muted)">PRAZO TOTAL</div><div style="font-size:12px;font-weight:600;margin-top:3px">${p.diasTotal>0?p.diasTotal+' dias':'—'}</div></div>
      <div><div style="font-size:10px;font-weight:700;color:var(--text-muted)">TÉRMINO PREVISTO</div><div style="font-size:12px;font-weight:700;color:${sc.text};margin-top:3px">${dataBR(p.dataFimStr)}</div></div>
    </div>
    <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:10px">
      <div style="font-size:13px;font-weight:700;color:var(--text-primary)">📋 Histórico de Prorrogações (${this._prorrogacoes.length})</div>
      <button class="btn btn-verde btn-sm" data-action="_prazoNovaProrr">➕ Adicionar Prorrogação</button>
    </div>
    <div id="prazo-form-wrap"></div>
    ${this._prorrogacoes.length===0
      ? '<div style="text-align:center;padding:20px;color:var(--text-muted);font-size:12px">Nenhuma prorrogação registrada.</div>'
      : `<table style="width:100%;border-collapse:collapse;font-size:12px">
          <thead><tr style="background:var(--bg-surface)">
            <th style="padding:7px 8px;text-align:left;font-size:10px;color:var(--text-muted);border-bottom:1px solid var(--border)">Nº Ato/Aditivo</th>
            <th style="padding:7px 8px;text-align:right;font-size:10px;color:var(--text-muted);border-bottom:1px solid var(--border)">Dias</th>
            <th style="padding:7px 8px;text-align:left;font-size:10px;color:var(--text-muted);border-bottom:1px solid var(--border)">Fundamento Legal</th>
            <th style="padding:7px 8px;text-align:left;font-size:10px;color:var(--text-muted);border-bottom:1px solid var(--border)">Justificativa</th>
            <th style="padding:7px 8px;text-align:left;font-size:10px;color:var(--text-muted);border-bottom:1px solid var(--border)">Data</th>
            <th style="padding:7px 8px;border-bottom:1px solid var(--border)"></th>
          </tr></thead>
          <tbody>${this._prorrogacoes.map(pr=>{
            const origemAdt=!!pr._origemAditivo, sf=!pr.fundamentoLegal;
            return `<tr style="border-bottom:1px solid var(--border)${sf?';background:#fffbeb':''}">
              <td style="padding:7px 8px;font-weight:600">${esc(pr.ato)||'—'}${origemAdt?'<span style="font-size:9px;background:#dbeafe;color:#1d4ed8;border:1px solid #93c5fd;padding:1px 5px;border-radius:3px;margin-left:4px">ADITIVO</span>':''}</td>
              <td style="padding:7px 8px;text-align:right;font-weight:700;color:#f59e0b">+${pr.dias}d</td>
              <td style="padding:7px 8px;font-size:11px">${sf?'<span style="color:#b45309;font-size:10px;font-weight:700">⚠️ Não informado</span>':`<span style="color:#1d4ed8;font-size:10px">${esc(pr.fundamentoLegal).replace(/_/g,' ')}</span>`}</td>
              <td style="padding:7px 8px;font-size:11px;color:var(--text-muted)">${esc(pr.justificativa)}</td>
              <td style="padding:7px 8px;font-size:11px">${dataBR(pr.data)}</td>
              <td style="padding:7px 8px;white-space:nowrap">
                ${!origemAdt?`<button class="btn btn-cinza btn-sm" style="padding:2px 7px;font-size:10px" data-action="_prazoEditarProrr" data-arg0="${pr.id}">✏️</button>`:''}
                <button class="btn btn-vermelho btn-sm" style="padding:2px 7px;font-size:10px;margin-left:3px" data-action="_prazoExcluirProrr" data-arg0="${pr.id}">🗑️</button>
              </td>
            </tr>`;
          }).join('')}</tbody></table>`}`;
  }

  /* ── TAB CRONOGRAMA ─────────────────────────────────────── */
  _htmlCronograma() {
    const lista = this._cronograma;
    const totalPeso = lista.reduce((s,a)=>s+(parseFloat(a.peso)||0),0);
    const pctReal   = totalPeso>0 ? lista.reduce((s,a)=>s+(parseFloat(a.peso)||0)*(parseFloat(a.realizado)||0)/100,0)/totalPeso*100 : 0;
    const pctPlan   = totalPeso>0 ? lista.reduce((s,a)=>s+(parseFloat(a.peso)||0)*(parseFloat(a.planejado)||0)/100,0)/totalPeso*100 : 0;
    const desvio    = pctReal-pctPlan;
    return `
    <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(150px,1fr));gap:10px;margin-bottom:16px">
      <div style="background:var(--bg-surface);border:1px solid var(--border);border-radius:8px;padding:12px;text-align:center">
        <div style="font-size:9px;color:var(--text-muted);text-transform:uppercase">Atividades</div>
        <div style="font-size:20px;font-weight:800;color:var(--text-primary)">${lista.length}</div>
      </div>
      <div style="background:#dbeafe;border:1px solid #93c5fd;border-radius:8px;padding:12px;text-align:center">
        <div style="font-size:9px;color:#1d4ed8;text-transform:uppercase">Planejado</div>
        <div style="font-size:20px;font-weight:800;color:#1d4ed8">${pctPlan.toFixed(1)}%</div>
      </div>
      <div style="background:#dcfce7;border:1px solid #86efac;border-radius:8px;padding:12px;text-align:center">
        <div style="font-size:9px;color:#15803d;text-transform:uppercase">Realizado</div>
        <div style="font-size:20px;font-weight:800;color:#15803d">${pctReal.toFixed(1)}%</div>
      </div>
      <div style="background:${desvio>=0?'#dcfce7':'#fee2e2'};border:1px solid ${desvio>=0?'#86efac':'#fca5a5'};border-radius:8px;padding:12px;text-align:center">
        <div style="font-size:9px;color:${desvio>=0?'#15803d':'#b91c1c'};text-transform:uppercase">Desvio</div>
        <div style="font-size:20px;font-weight:800;color:${desvio>=0?'#15803d':'#b91c1c'}">${desvio>=0?'+':''}${desvio.toFixed(1)}%</div>
      </div>
    </div>
    <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:10px">
      <div style="font-size:13px;font-weight:700;color:var(--text-primary)">📋 Atividades do Cronograma</div>
      <button class="btn btn-verde btn-sm" data-action="_cronNovaAtividade">➕ Adicionar Atividade</button>
    </div>
    <div id="cron-form-wrap"></div>
    ${lista.length===0
      ? '<div style="text-align:center;padding:28px;color:var(--text-muted);font-size:12px">Nenhuma atividade cadastrada.</div>'
      : `<div style="overflow-x:auto"><table style="width:100%;border-collapse:collapse;font-size:12px">
          <thead><tr style="background:var(--bg-surface)">
            <th style="padding:7px 10px;text-align:left;font-size:10px;color:var(--text-muted);border-bottom:1px solid var(--border)">Atividade</th>
            <th style="padding:7px 10px;text-align:center;font-size:10px;color:var(--text-muted);border-bottom:1px solid var(--border)">Início</th>
            <th style="padding:7px 10px;text-align:center;font-size:10px;color:var(--text-muted);border-bottom:1px solid var(--border)">Término</th>
            <th style="padding:7px 10px;text-align:right;font-size:10px;color:var(--text-muted);border-bottom:1px solid var(--border)">Peso</th>
            <th style="padding:7px 10px;text-align:right;font-size:10px;color:#1d4ed8;border-bottom:1px solid var(--border)">Plan.</th>
            <th style="padding:7px 10px;text-align:right;font-size:10px;color:#15803d;border-bottom:1px solid var(--border)">Real.</th>
            <th style="padding:7px 10px;text-align:left;font-size:10px;color:var(--text-muted);border-bottom:1px solid var(--border)">Progresso</th>
            <th style="padding:7px 10px;border-bottom:1px solid var(--border)"></th>
          </tr></thead>
          <tbody>${lista.map(a=>{
            const plan=parseFloat(a.planejado)||0, real=parseFloat(a.realizado)||0, dev=real-plan;
            const dc=dev>=0?'#15803d':'#b91c1c';
            return `<tr style="border-bottom:1px solid var(--border)">
              <td style="padding:7px 10px;font-weight:600;max-width:200px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap" title="${esc(a.nome)}">${esc(a.nome)}</td>
              <td style="padding:7px 10px;text-align:center;font-size:11px">${dataBR(a.inicio)}</td>
              <td style="padding:7px 10px;text-align:center;font-size:11px">${dataBR(a.termino)}</td>
              <td style="padding:7px 10px;text-align:right;font-family:var(--font-mono)">${(parseFloat(a.peso)||0).toFixed(1)}%</td>
              <td style="padding:7px 10px;text-align:right;font-family:var(--font-mono);color:#1d4ed8">${plan.toFixed(1)}%</td>
              <td style="padding:7px 10px;text-align:right;font-family:var(--font-mono);color:${dc}">${real.toFixed(1)}%${Math.abs(dev)>0.05?`<span style="font-size:9px;margin-left:2px">(${dev>=0?'+':''}${dev.toFixed(1)}%)</span>`:''}</td>
              <td style="padding:7px 10px;min-width:120px">
                <div style="position:relative;height:10px;border-radius:4px;background:#e2e8f0;overflow:hidden">
                  <div style="position:absolute;height:10px;border-radius:4px;background:#93c5fd;width:${Math.min(100,plan)}%"></div>
                  <div style="position:absolute;height:10px;border-radius:4px;background:#22c55e;width:${Math.min(100,real)}%;opacity:.85"></div>
                </div>
              </td>
              <td style="padding:7px 10px;white-space:nowrap">
                <button class="btn btn-cinza btn-sm" style="padding:2px 7px;font-size:10px" data-action="_cronEditarAtividade" data-arg0="${a.id}">✏️</button>
                <button class="btn btn-vermelho btn-sm" style="padding:2px 7px;font-size:10px;margin-left:3px" data-action="_cronExcluirAtividade" data-arg0="${a.id}">🗑️</button>
              </td>
            </tr>`;
          }).join('')}</tbody>
          <tfoot><tr style="background:var(--bg-surface);font-weight:700">
            <td colspan="3" style="padding:7px 10px;font-size:11px">TOTAL</td>
            <td style="padding:7px 10px;text-align:right;font-family:var(--font-mono)">${totalPeso.toFixed(1)}%</td>
            <td style="padding:7px 10px;text-align:right;font-family:var(--font-mono);color:#1d4ed8">${pctPlan.toFixed(1)}%</td>
            <td style="padding:7px 10px;text-align:right;font-family:var(--font-mono);color:${desvio>=0?'#15803d':'#b91c1c'}">${pctReal.toFixed(1)}%</td>
            <td colspan="2"></td>
          </tr></tfoot>
        </table></div>`}`;
  }

  /* ── TAB CURVA S ────────────────────────────────────────── */
  // Resolve as datas do eixo da Curva S diretamente das configurações:
  // início = inicioReal (se preenchido) ou inicioPrev
  // fim    = início + duracaoDias + prorrogações (se duracaoDias > 0) ou cfg.termino
  _resolverDatasCurvaS(cfg) {
    const isoI = cfg.inicioReal || cfg.inicioPrev || null;
    const diasBase  = parseInt(cfg.duracaoDias) || 0;
    const diasProrr = this._prorrogacoes.reduce((a, p) => a + (parseInt(p.dias) || 0), 0);
    const diasTotal = diasBase + diasProrr;
    let isoF = null;
    if (isoI && diasTotal > 0) {
      const d = new Date(isoI + 'T12:00:00');
      d.setDate(d.getDate() + diasTotal);
      isoF = d.toISOString().slice(0, 10);
    } else if (cfg.termino) {
      isoF = cfg.termino;
    }
    return { isoI, isoF };
  }

  _htmlCurvaS() {
    const cfg   = state.get('cfg') || {};
    const lista = this._cronograma.filter(a => a.inicio && a.termino);
    const { isoI: inicio, isoF: termino } = this._resolverDatasCurvaS(cfg);
    if (!inicio || !termino || lista.length === 0) {
      return `<div style="text-align:center;padding:48px 24px;color:var(--text-muted)">
        <div style="font-size:32px;margin-bottom:8px">📈</div>
        <div style="font-size:13px;font-weight:600">Curva S indisponível</div>
        <div style="font-size:11px;margin-top:4px">
          ${!inicio||!termino?'Configure início e término do contrato (aba Contrato).':''}
          ${lista.length===0?'Cadastre atividades com datas na aba Cronograma.':''}
        </div></div>`;
    }
    return `
    <div style="background:var(--bg-surface);border:1px solid var(--border);border-radius:10px;padding:14px 16px;margin-bottom:12px;display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:8px">
      <div>
        <div style="font-size:12px;font-weight:700;color:var(--text-primary)">📈 Curva S — Avanço Físico Acumulado</div>
        <div style="font-size:10px;color:var(--text-muted);margin-top:2px">${dataBR(inicio)} → ${dataBR(termino)} · ${lista.length} atividade(s)</div>
      </div>
      <div style="display:flex;gap:14px;font-size:11px;flex-wrap:wrap">
        <span style="display:flex;align-items:center;gap:5px"><span style="width:24px;height:3px;background:#3b82f6;display:inline-block;border-radius:2px;border:1px dashed #3b82f6"></span><span style="color:var(--text-muted)">Planejado</span></span>
        <span style="display:flex;align-items:center;gap:5px"><span style="width:24px;height:3px;background:#22c55e;display:inline-block;border-radius:2px"></span><span style="color:var(--text-muted)">Realizado</span></span>
        <span style="display:flex;align-items:center;gap:5px"><span style="width:10px;height:10px;background:rgba(254,202,202,.5);border:1px solid #fca5a5;display:inline-block;border-radius:2px"></span><span style="color:var(--text-muted)">Desvio</span></span>
      </div>
    </div>
    <div style="background:var(--bg-card);border:1px solid var(--border);border-radius:10px;padding:16px">
      <canvas id="prazo-curva-s" style="width:100%;height:340px;display:block"></canvas>
    </div>`;
  }

  _desenharCurvaS() {
    const cv = document.getElementById('prazo-curva-s');
    if (!cv) return;
    const cfg   = state.get('cfg') || {};
    const lista = this._cronograma.filter(a => a.inicio && a.termino);
    const { isoI, isoF } = this._resolverDatasCurvaS(cfg);
    if (!isoI || !isoF || lista.length === 0) return;

    const dtI = new Date(isoI + 'T12:00:00');
    const dtF = new Date(isoF + 'T12:00:00');
    // Gerar meses
    const meses = [];
    const cur = new Date(dtI.getFullYear(), dtI.getMonth(), 1);
    const fim = new Date(dtF.getFullYear(), dtF.getMonth(), 1);
    while (cur <= fim) { meses.push(new Date(cur)); cur.setMonth(cur.getMonth()+1); }
    if (meses.length < 2) return;

    const totalPeso = lista.reduce((s,a)=>s+(parseFloat(a.peso)||0),0) || 1;
    const dataPlan = meses.map(m => {
      const fimMes = new Date(m.getFullYear(), m.getMonth()+1, 0, 23, 59, 59);
      let acum = 0;
      lista.forEach(a => {
        const ai=new Date(a.inicio+'T12:00:00'), af=new Date(a.termino+'T12:00:00');
        if (ai > fimMes) return;
        const dur = Math.max(1, af-ai);
        acum += (parseFloat(a.peso)||0) * Math.min(1, Math.max(0, (Math.min(fimMes,af)-ai)/dur));
      });
      return (acum/totalPeso)*100;
    });
    const dataReal = meses.map(m => {
      const fimMes = new Date(m.getFullYear(), m.getMonth()+1, 0, 23, 59, 59);
      let acum = 0;
      lista.forEach(a => {
        const ai=new Date(a.inicio+'T12:00:00'), af=new Date(a.termino+'T12:00:00');
        if (ai > fimMes) return;
        const dur = Math.max(1, af-ai);
        const prop = Math.min(1, Math.max(0, (Math.min(fimMes,af)-ai)/dur));
        acum += (parseFloat(a.peso)||0) * prop * ((parseFloat(a.realizado)||0)/100);
      });
      return (acum/totalPeso)*100;
    });

    const ctx = cv.getContext('2d');
    const dpr = window.devicePixelRatio||1;
    const rc  = cv.getBoundingClientRect();
    cv.width  = rc.width*dpr; cv.height = rc.height*dpr;
    ctx.scale(dpr, dpr);
    const W=rc.width, H=rc.height, mL=54, mR=20, mT=24, mB=44;
    const cW=W-mL-mR, cH=H-mT-mB, n=meses.length;
    const xOf = i => mL+(i/(n-1))*cW;
    const yOf = v => mT+cH-(Math.min(100,Math.max(0,v))/100)*cH;

    // Grid
    for (let g=0;g<=4;g++) {
      const y=mT+(cH/4)*g;
      ctx.strokeStyle='#e2e8f0'; ctx.lineWidth=1;
      ctx.beginPath(); ctx.moveTo(mL,y); ctx.lineTo(mL+cW,y); ctx.stroke();
      ctx.fillStyle='#94a3b8'; ctx.font='9px sans-serif'; ctx.textAlign='right';
      ctx.fillText(`${(100-g*25)}%`, mL-6, y+3);
    }

    // Área desvio
    ctx.beginPath();
    ctx.moveTo(xOf(0), yOf(dataPlan[0]));
    dataPlan.forEach((v,i)=>ctx.lineTo(xOf(i),yOf(v)));
    for (let i=n-1;i>=0;i--) ctx.lineTo(xOf(i),yOf(dataReal[i]));
    ctx.closePath();
    ctx.fillStyle='rgba(254,202,202,0.35)'; ctx.fill();

    // Linha planejada (tracejada)
    ctx.beginPath();
    ctx.moveTo(xOf(0),yOf(dataPlan[0]));
    dataPlan.forEach((v,i)=>ctx.lineTo(xOf(i),yOf(v)));
    ctx.strokeStyle='#3b82f6'; ctx.lineWidth=2.5; ctx.setLineDash([7,4]); ctx.stroke(); ctx.setLineDash([]);

    // Linha realizada
    const hoje2 = new Date();
    const corteIdx = Math.min(n, meses.findIndex((m,i)=>{ const p=meses[i+1]; return !p||hoje2<p; })+1 || n);
    ctx.beginPath();
    ctx.moveTo(xOf(0),yOf(dataReal[0]));
    dataReal.slice(0,corteIdx).forEach((v,i)=>ctx.lineTo(xOf(i),yOf(v)));
    ctx.strokeStyle='#22c55e'; ctx.lineWidth=2.5; ctx.stroke();

    // Pontos realizado
    dataReal.slice(0,corteIdx).forEach((v,i)=>{
      ctx.beginPath(); ctx.arc(xOf(i),yOf(v),3.5,0,Math.PI*2);
      ctx.fillStyle='#22c55e'; ctx.fill();
    });

    // Linha hoje
    if (corteIdx > 0 && corteIdx < n) {
      const xH = xOf(corteIdx-1);
      ctx.beginPath(); ctx.moveTo(xH,mT); ctx.lineTo(xH,mT+cH);
      ctx.strokeStyle='#f59e0b'; ctx.lineWidth=1.5; ctx.setLineDash([4,3]); ctx.stroke(); ctx.setLineDash([]);
      ctx.fillStyle='#f59e0b'; ctx.font='bold 9px sans-serif'; ctx.textAlign='center';
      ctx.fillText('Hoje', xH, mT-8);
    }

    // Labels X
    const step = n>18?3:n>10?2:1;
    meses.forEach((m,i)=>{
      if (i%step!==0) return;
      ctx.fillStyle='#94a3b8'; ctx.font='9px sans-serif'; ctx.textAlign='center';
      ctx.fillText(m.toLocaleDateString('pt-BR',{month:'short',year:'2-digit'}), xOf(i), H-mB+14);
    });
  }

  /* ── FORM PRORROGAÇÃO ───────────────────────────────────── */
  _renderFormProrr(id=null) {
    const wrap=document.getElementById('prazo-form-wrap'); if (!wrap) return;
    const pr=id?this._prorrogacoes.find(x=>x.id===id):null;
    const opts=[
      {v:'',l:'— Selecione o fundamento legal —'},
      {v:'caso_fortuito',l:'Caso fortuito ou força maior (Art. 111, I)'},
      {v:'fato_principe',l:'Fato do príncipe / ato de autoridade (Art. 111, II)'},
      {v:'fato_administracao',l:'Fato da Administração (Art. 111, III)'},
      {v:'servicos_extras',l:'Serviços extras não imputáveis ao contratado (Art. 111, IV)'},
      {v:'impedimento_execucao',l:'Impedimento de execução por ordem administrativa (Art. 111, V)'},
      {v:'chuvas',l:'Chuvas acima da média histórica (Art. 111, VI)'},
      {v:'outro',l:'Outro fundamento (detalhar na justificativa)'},
    ];
    wrap.innerHTML=`<div style="background:var(--bg-surface);border:1px solid var(--border);border-radius:8px;padding:14px;margin-bottom:12px">
      <div style="font-size:12px;font-weight:700;margin-bottom:10px">${pr?'Editar Prorrogação':'Nova Prorrogação'}</div>
      <div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:10px">
        <div><label style="font-size:10px;font-weight:700;color:var(--text-muted);display:block;margin-bottom:3px">Nº Ato / Aditivo</label>
          <input id="prorr-ato" type="text" value="${esc(pr?.ato)}" placeholder="Ex: 1º Aditivo" style="width:100%;padding:7px;border-radius:6px;border:1px solid var(--border);background:var(--bg-card);color:var(--text-primary);font-size:12px;box-sizing:border-box"></div>
        <div><label style="font-size:10px;font-weight:700;color:var(--text-muted);display:block;margin-bottom:3px">Dias Adicionados *</label>
          <input id="prorr-dias" type="number" min="1" value="${pr?.dias||''}" placeholder="Ex: 30" style="width:100%;padding:7px;border-radius:6px;border:1px solid var(--border);background:var(--bg-card);color:var(--text-primary);font-size:12px;box-sizing:border-box"></div>
        <div><label style="font-size:10px;font-weight:700;color:var(--text-muted);display:block;margin-bottom:3px">Data da Prorrogação</label>
          <input id="prorr-data" type="date" value="${pr?.data||hoje()}" style="width:100%;padding:7px;border-radius:6px;border:1px solid var(--border);background:var(--bg-card);color:var(--text-primary);font-size:12px;box-sizing:border-box"></div>
        <div style="grid-column:1/-1"><label style="font-size:10px;font-weight:700;color:var(--text-muted);display:block;margin-bottom:3px">Fundamento Legal *</label>
          <select id="prorr-fundamento" style="width:100%;padding:7px;border-radius:6px;border:1px solid var(--border);background:var(--bg-card);color:var(--text-primary);font-size:12px;box-sizing:border-box">
            ${opts.map(f=>`<option value="${f.v}"${pr?.fundamentoLegal===f.v?' selected':''}>${f.l}</option>`).join('')}
          </select></div>
        <div style="grid-column:1/-1"><label style="font-size:10px;font-weight:700;color:var(--text-muted);display:block;margin-bottom:3px">Justificativa *</label>
          <input id="prorr-just" type="text" value="${esc(pr?.justificativa)}" placeholder="Descreva o motivo"
            style="width:100%;padding:7px;border-radius:6px;border:1px solid var(--border);background:var(--bg-card);color:var(--text-primary);font-size:12px;box-sizing:border-box"></div>
      </div>
      <div style="display:flex;gap:8px;justify-content:flex-end;margin-top:10px">
        <button class="btn btn-cinza btn-sm" data-action="_prazoCancelarForm">Cancelar</button>
        <button class="btn btn-verde btn-sm" data-action="_prazoSalvarProrr" data-arg0="${id||''}">💾 Salvar</button>
      </div></div>`;
  }

  /* ── FORM ATIVIDADE ─────────────────────────────────────── */
  _renderFormAtividade(id=null) {
    const wrap=document.getElementById('cron-form-wrap'); if (!wrap) return;
    const a=id?this._cronograma.find(x=>x.id===id):null;
    wrap.innerHTML=`<div style="background:var(--bg-surface);border:1px solid var(--border);border-radius:8px;padding:14px;margin-bottom:12px">
      <div style="font-size:12px;font-weight:700;margin-bottom:10px">${a?'Editar Atividade':'Nova Atividade'}</div>
      <div style="display:grid;grid-template-columns:2fr 1fr 1fr 1fr 1fr 1fr;gap:10px;align-items:end">
        <div style="grid-column:1/-1"><label style="font-size:10px;font-weight:700;color:var(--text-muted);display:block;margin-bottom:3px">Nome da Atividade *</label>
          <input id="atv-nome" type="text" value="${esc(a?.nome)}" placeholder="Ex: Fundação, Alvenaria..."
            style="width:100%;padding:7px;border-radius:6px;border:1px solid var(--border);background:var(--bg-card);color:var(--text-primary);font-size:12px;box-sizing:border-box"></div>
        <div><label style="font-size:10px;font-weight:700;color:var(--text-muted);display:block;margin-bottom:3px">Início *</label>
          <input id="atv-inicio" type="date" value="${a?.inicio||''}" style="width:100%;padding:7px;border-radius:6px;border:1px solid var(--border);background:var(--bg-card);color:var(--text-primary);font-size:12px;box-sizing:border-box"></div>
        <div><label style="font-size:10px;font-weight:700;color:var(--text-muted);display:block;margin-bottom:3px">Término *</label>
          <input id="atv-termino" type="date" value="${a?.termino||''}" style="width:100%;padding:7px;border-radius:6px;border:1px solid var(--border);background:var(--bg-card);color:var(--text-primary);font-size:12px;box-sizing:border-box"></div>
        <div><label style="font-size:10px;font-weight:700;color:var(--text-muted);display:block;margin-bottom:3px">Peso (%) *</label>
          <input id="atv-peso" type="number" min="0" max="100" step="0.01" value="${a?.peso||''}" placeholder="0-100" style="width:100%;padding:7px;border-radius:6px;border:1px solid var(--border);background:var(--bg-card);color:var(--text-primary);font-size:12px;box-sizing:border-box"></div>
        <div><label style="font-size:10px;font-weight:700;color:#1d4ed8;display:block;margin-bottom:3px">Plan. (%)</label>
          <input id="atv-planejado" type="number" min="0" max="100" step="0.1" value="${a?.planejado||''}" placeholder="0-100" style="width:100%;padding:7px;border-radius:6px;border:1px solid var(--border);background:var(--bg-card);color:var(--text-primary);font-size:12px;box-sizing:border-box"></div>
        <div><label style="font-size:10px;font-weight:700;color:#15803d;display:block;margin-bottom:3px">Real. (%)</label>
          <input id="atv-realizado" type="number" min="0" max="100" step="0.1" value="${a?.realizado||''}" placeholder="0-100" style="width:100%;padding:7px;border-radius:6px;border:1px solid var(--border);background:var(--bg-card);color:var(--text-primary);font-size:12px;box-sizing:border-box"></div>
      </div>
      <div style="display:flex;gap:8px;justify-content:flex-end;margin-top:10px">
        <button class="btn btn-cinza btn-sm" data-action="_cronCancelarForm">Cancelar</button>
        <button class="btn btn-verde btn-sm" data-action="_cronSalvarAtividade" data-arg0="${id||''}">💾 Salvar Atividade</button>
      </div></div>`;
    document.getElementById('atv-nome')?.focus();
  }

  /* ── GLOBALS ────────────────────────────────────────────── */
  _exposeGlobals() {
    window._prazoTab          = tab => { try { this._render(tab); } catch(e){} };
    window._prazoNovaProrr    = ()  => this._renderFormProrr(null);
    window._prazoEditarProrr  = id  => this._renderFormProrr(id);
    window._prazoCancelarForm = ()  => { const w=document.getElementById('prazo-form-wrap'); if(w) w.innerHTML=''; };
    window._prazoExcluirProrr = async id => {
      if (!confirm('Excluir esta prorrogação?')) return;
      this._prorrogacoes=this._prorrogacoes.filter(p=>p.id!==id);
      await this._salvar(); this._render('prazos');
      window.toast?.('🗑️ Prorrogação removida.','ok');
    };
    window._prazoSalvarProrr = async editId => {
      const g=id=>document.getElementById(id)?.value?.trim()||'';
      const dias=parseInt(g('prorr-dias'));
      if (!dias||dias<1) { window.toast?.('⚠️ Informe a quantidade de dias.','warn'); return; }
      const fl=g('prorr-fundamento');
      if (!fl) { window.toast?.('⚠️ Selecione o fundamento legal (Art. 111).','warn'); return; }
      const just=g('prorr-just');
      if (!just) { window.toast?.('⚠️ Informe a justificativa.','warn'); return; }
      const cfg=state.get('cfg')||{}, pp=this._calcPrazo(cfg);
      const dt0=pp.dataFimStr||cfg.termino||'';
      const dt1=(()=>{if(!dt0||!dias)return'';const d=new Date(dt0+'T12:00:00');d.setDate(d.getDate()+dias);return d.toISOString().slice(0,10);})();
      const {ok,erros}=validarProrrogacao({dataTerminoAtual:dt0,novaDataTermino:dt1,justificativa:just});
      if (!ok) { window.toast?.(`⚠️ ${erros.join(' ')}`,'warn'); return; }
      const item={id:editId||`prorr_${Date.now()}`,ato:g('prorr-ato'),dias,data:g('prorr-data'),fundamentoLegal:fl,justificativa:just,criadoEm:new Date().toISOString()};
      if (editId) this._prorrogacoes=this._prorrogacoes.map(p=>p.id===editId?{...p,...item}:p);
      else this._prorrogacoes.push(item);
      await this._salvar(); this._render('prazos');
      window.toast?.('✅ Prorrogação salva!','ok');
    };
    window._cronNovaAtividade    = ()  => this._renderFormAtividade(null);
    window._cronEditarAtividade  = id  => this._renderFormAtividade(id);
    window._cronCancelarForm     = ()  => { const w=document.getElementById('cron-form-wrap'); if(w) w.innerHTML=''; };
    window._cronExcluirAtividade = async id => {
      if (!confirm('Excluir esta atividade?')) return;
      this._cronograma=this._cronograma.filter(a=>a.id!==id);
      await this._salvarCronograma(); this._render('cronograma');
      window.toast?.('🗑️ Atividade removida.','ok');
    };
    window._cronSalvarAtividade = async editId => {
      const g=id=>document.getElementById(id)?.value?.trim()||'';
      const nome=g('atv-nome'); if(!nome){window.toast?.('⚠️ Informe o nome.','warn');return;}
      const inicio=g('atv-inicio'), termino=g('atv-termino');
      if(!inicio||!termino){window.toast?.('⚠️ Informe início e término.','warn');return;}
      if(termino<inicio){window.toast?.('⚠️ Término antes do início.','warn');return;}
      const peso=parseFloat(g('atv-peso'));
      if(!peso||peso<=0){window.toast?.('⚠️ Informe o peso (%).','warn');return;}
      const item={id:editId||`atv_${Date.now()}`,nome,inicio,termino,peso,
        planejado:parseFloat(g('atv-planejado'))||0,realizado:parseFloat(g('atv-realizado'))||0,criadoEm:new Date().toISOString()};
      if(editId) this._cronograma=this._cronograma.map(a=>a.id===editId?{...a,...item}:a);
      else this._cronograma.push(item);
      await this._salvarCronograma(); this._render('cronograma');
      window.toast?.('✅ Atividade salva!','ok');
    };
  }

  /* ── EVENTOS ────────────────────────────────────────────── */
  _bindEvents() {
    this._subs.push(
      EventBus.on('obra:selecionada', async()=>{ await this._carregar(); if(router.current==='prazos') this._render(); },'prazos'),
      EventBus.on('config:salva',     async()=>{ if(router.current==='prazos') this._render(); },'prazos'),
      EventBus.on('prazos:atualizado',async({obraId}={})=>{ if(obraId&&obraId!==state.get('obraAtivaId')) return; await this._carregar(); if(router.current==='prazos') this._render(); },'prazos')
    );
  }

  destroy() { this._subs.forEach(u=>u?.()); this._subs=[]; EventBus.offByContext('prazos'); }
}
