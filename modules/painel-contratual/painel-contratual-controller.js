/**
 * ╔══════════════════════════════════════════════════════════════╗
 * ║  FISCAL NA OBRA v15 — painel-contratual-controller.js       ║
 * ║  Módulo: PainelContratualModule — Visão Contratual Completa ║
 * ╚══════════════════════════════════════════════════════════════╝
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
  getQtdAcumuladoAnteriorItem,
} from '../boletim-medicao/bm-calculos.js';
import { baixarCSV, numCSV } from '../../utils/csv-export.js';

const R$   = v => formatters.currency ? formatters.currency(v) : (v||0).toLocaleString('pt-BR',{style:'currency',currency:'BRL'});
const pct  = v => ((parseFloat(v)||0).toFixed(2)).replace('.',',')+' %';
const dataBR = iso => iso ? new Date(iso+'T12:00:00').toLocaleDateString('pt-BR') : '—';
const bar  = (p,cor,h=6) => `<div style="height:${h}px;border-radius:${h/2}px;background:${cor}22;overflow:hidden"><div style="height:${h}px;border-radius:${h/2}px;background:${cor};width:${Math.min(100,Math.max(0,p))}%;transition:width .4s"></div></div>`;

export class PainelContratualModule {
  constructor() {
    this._subs = [];
  }

  async init() {
    try { this._bindEvents(); this._exposeGlobals(); }
    catch(e) { console.error('[PainelContratualModule] init:', e); }
  }

  onEnter() {
    try { this._render(); }
    catch(e) { console.error('[PainelContratualModule] onEnter:', e); }
  }

  _render() {
    const el = document.getElementById('painel-contratual-conteudo');
    if (!el) return;

    const obraId = state.get('obraAtivaId');
    const cfg    = state.get('cfg') || {};
    const bms    = state.get('bms') || [];
    const itens  = state.get('itensContrato') || [];

    if (!obraId) {
      el.innerHTML = '<div style="text-align:center;padding:40px;color:var(--text-muted);font-size:13px">Selecione uma obra para ver o painel contratual.</div>';
      return;
    }

    // ── Financeiro ──────────────────────────────────────────────
    const valorOriginal  = cfg.valorOriginal || cfg.valor || 0;
    const valorContrato  = cfg.valor || 0;
    const lastBm         = bms.length ? bms[bms.length-1] : null;
    const lastBmNum      = lastBm?.num || 0;
    let vAcumTotal=0, vMedAtual=0;
    try {
      if (lastBmNum > 0) {
        vAcumTotal = getValorAcumuladoTotal(obraId, lastBmNum, itens, cfg);
        vMedAtual  = getValorMedicaoAtual(obraId, lastBmNum, itens, cfg);
      }
    } catch(e) {}
    const saldo        = valorContrato - vAcumTotal;
    const pctFin       = valorContrato > 0 ? vAcumTotal/valorContrato*100 : 0;
    const variacao     = valorContrato - valorOriginal;
    const pctVariacao  = valorOriginal > 0 ? variacao/valorOriginal*100 : 0;

    // ── Prazo ────────────────────────────────────────────────────
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
      } else if (cfg.duracaoDias && cfg.inicioPrev) {
        const ini = new Date(cfg.inicioPrev);
        duracaoTotal   = cfg.duracaoDias;
        diasDecorridos = Math.round((hoje-ini)/86400000);
        pctPrazo       = Math.min(100,Math.max(0,diasDecorridos/duracaoTotal*100));
        const restante = duracaoTotal - diasDecorridos;
        diasRestantes  = restante > 0 ? `${restante} dias` : `${Math.abs(restante)}d atrasada`;
        atrasada       = restante < 0;
      }
    } catch(e) {}

    // ── Aditivos ─────────────────────────────────────────────────
    const aditivos = state.get('aditivos') || [];

    // ── Itens com saldo ──────────────────────────────────────────
    const itensSvc = itens.filter(i=>!i.t);
    const itensCriticos = itensSvc.filter(i => {
      const qtdExec = i.qtdExec || 0;
      const qtd     = parseFloat(i.qtd)||0;
      return qtd > 0 && qtdExec/qtd > 0.9;
    }).slice(0,5);

    el.innerHTML = `
      <!-- Dados do Contrato -->
      <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(260px,1fr));gap:12px;margin-bottom:20px">
        ${this._cardInfo('📋 Contrato', cfg.contrato||'—')}
        ${this._cardInfo('🏗️ Objeto', cfg.objeto||'—')}
        ${this._cardInfo('🏛️ Contratante', cfg.contratante||'—')}
        ${this._cardInfo('🏢 Contratada', cfg.contratada||'—')}
        ${cfg.cnpjContratada||cfg.cnpj?this._cardInfo('CNPJ Contratada', cfg.cnpjContratada||cfg.cnpj||'—'):''}
        ${cfg.cnpjContratante?this._cardInfo('CNPJ Contratante', cfg.cnpjContratante||'—'):''}
        ${this._cardInfo('👷 Fiscal', cfg.fiscal||'—')}
        ${cfg.creaFiscal?this._cardInfo('CREA/CAU Fiscal', cfg.creaFiscal||'—'):''}
        ${this._cardInfo('👤 Resp. Técnico', cfg.rt||'—')}
      </div>

      <!-- Indicadores Financeiros -->
      <div style="background:var(--bg-surface);border:1px solid var(--border);border-radius:12px;padding:18px;margin-bottom:16px">
        <div style="font-size:11px;font-weight:800;text-transform:uppercase;letter-spacing:.8px;color:var(--text-muted);margin-bottom:14px">💰 Situação Financeira</div>
        <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(160px,1fr));gap:12px;margin-bottom:14px">
          ${this._kpi('Valor Original',    R$(valorOriginal),  '#6b7280')}
          ${this._kpi('Valor Contratual',  R$(valorContrato),  'var(--accent)')}
          ${this._kpi('Valor Executado',   R$(vAcumTotal),     '#2563eb')}
          ${this._kpi('Saldo a Executar',  R$(saldo),          saldo<0?'#ef4444':'#22c55e')}
          ${this._kpi('Última Medição',    R$(vMedAtual),      '#f59e0b')}
          ${variacao!==0?this._kpi('Variação'+(variacao>0?'+':'-'), R$(Math.abs(variacao))+' ('+pct(Math.abs(pctVariacao))+')', variacao>0?'#22c55e':'#ef4444'):''}
        </div>
        <div style="margin-bottom:6px">
          <div style="display:flex;justify-content:space-between;font-size:10px;color:var(--text-muted);margin-bottom:4px"><span>Execução Financeira</span><span style="font-weight:700">${pct(pctFin)}</span></div>
          ${bar(pctFin,'#2563eb',10)}
        </div>
      </div>

      <!-- Prazo -->
      <div style="background:var(--bg-surface);border:1px solid var(--border);border-radius:12px;padding:18px;margin-bottom:16px">
        <div style="font-size:11px;font-weight:800;text-transform:uppercase;letter-spacing:.8px;color:var(--text-muted);margin-bottom:14px">📅 Situação do Prazo</div>
        <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(160px,1fr));gap:12px;margin-bottom:14px">
          ${this._kpi('Início Previsto', dataBR(cfg.inicioPrev), '#6b7280')}
          ${this._kpi('Término Previsto', dataBR(cfg.termino), atrasada?'#ef4444':'#22c55e')}
          ${this._kpi('Dias Decorridos', diasDecorridos, '#f59e0b')}
          ${this._kpi('Dias Restantes', diasRestantes, atrasada?'#ef4444':'#22c55e')}
          ${this._kpi('Duração Total', duracaoTotal+' dias', '#6b7280')}
        </div>
        <div>
          <div style="display:flex;justify-content:space-between;font-size:10px;color:var(--text-muted);margin-bottom:4px"><span>Prazo Decorrido</span><span style="font-weight:700">${pct(pctPrazo)}</span></div>
          ${bar(pctPrazo, atrasada?'#ef4444':'#f59e0b', 10)}
        </div>
      </div>

      <!-- Resumo de Medição — Tabela BM + Valor Medido -->
      <div style="background:var(--bg-surface);border:1px solid var(--border);border-radius:12px;padding:18px;margin-bottom:16px">
        <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:14px">
          <div style="font-size:11px;font-weight:800;text-transform:uppercase;letter-spacing:.8px;color:var(--text-muted)">📋 Resumo de Medição</div>
        </div>
        ${bms.length===0
          ? '<p style="font-size:12px;color:var(--text-muted)">Nenhum BM registrado.</p>'
          : `<table style="width:100%;border-collapse:collapse;font-size:11px">
            <thead>
              <tr style="background:var(--bg-card)">
                <th style="padding:7px 10px;text-align:left;font-size:9px;font-weight:700;text-transform:uppercase;letter-spacing:.5px;color:var(--text-muted);border-bottom:1px solid var(--border)">BM</th>
                <th style="padding:7px 10px;text-align:left;font-size:9px;font-weight:700;text-transform:uppercase;letter-spacing:.5px;color:var(--text-muted);border-bottom:1px solid var(--border)">Período</th>
                <th style="padding:7px 10px;text-align:right;font-size:9px;font-weight:700;text-transform:uppercase;letter-spacing:.5px;color:var(--text-muted);border-bottom:1px solid var(--border)">Valor Medido</th>
                <th style="padding:7px 10px;text-align:right;font-size:9px;font-weight:700;text-transform:uppercase;letter-spacing:.5px;color:var(--text-muted);border-bottom:1px solid var(--border)">% do Contrato</th>
              </tr>
            </thead>
            <tbody>
              ${bms.map(b => {
                const vBm   = (() => { try { return getValorMedicaoAtual(obraId, b.num, itens, cfg); } catch(ex){ return 0; } })();
                const pBm   = valorContrato > 0 ? (vBm / valorContrato * 100) : 0;
                const nStr  = b.num < 10 ? '0'+b.num : String(b.num);
                const clrV  = vBm > 0 ? '#059669' : 'var(--text-muted)';
                return '<tr style="border-bottom:1px solid var(--border)">'
                  + '<td style="padding:7px 10px;font-weight:700;color:var(--accent);white-space:nowrap">BM ' + nStr + '</td>'
                  + '<td style="padding:7px 10px;color:var(--text-muted);font-size:10px">' + (b.mes || dataBR(b.data) || '—') + '</td>'
                  + '<td style="padding:7px 10px;text-align:right;font-family:var(--font-mono,monospace);font-weight:700;color:' + clrV + '">' + R$(vBm) + '</td>'
                  + '<td style="padding:7px 10px;text-align:right;font-family:var(--font-mono,monospace);color:var(--text-muted)">' + pct(pBm) + '</td>'
                  + '</tr>';
              }).join('')}
            </tbody>
            <tfoot>
              <tr style="background:var(--bg-card);border-top:2px solid var(--border)">
                <td colspan="2" style="padding:7px 10px;font-weight:700;font-size:10px;color:var(--text-primary)">TOTAL ACUMULADO</td>
                <td style="padding:7px 10px;text-align:right;font-family:var(--font-mono,monospace);font-weight:800;color:#059669">${R$(vAcumTotal)}</td>
                <td style="padding:7px 10px;text-align:right;font-family:var(--font-mono,monospace);font-weight:700">${pct(pctFin)}</td>
              </tr>
            </tfoot>
          </table>`}
      </div>

      <!-- Aditivos + Botão PDF -->
      <div style="display:grid;grid-template-columns:1fr auto;gap:12px;align-items:start;margin-bottom:16px">
        <div style="background:var(--bg-surface);border:1px solid var(--border);border-radius:12px;padding:18px">
          <div style="font-size:11px;font-weight:800;text-transform:uppercase;letter-spacing:.8px;color:var(--text-muted);margin-bottom:12px">📝 Aditivos Contratuais</div>
          ${aditivos.length===0?'<p style="font-size:12px;color:var(--text-muted)">Nenhum aditivo registrado.</p>':
            aditivos.slice(-5).reverse().map(a=>'<div style="display:flex;justify-content:space-between;align-items:center;padding:6px 0;border-bottom:1px solid var(--border);font-size:11px"><span style="color:var(--text-primary);font-weight:600">'+(a.numero||a.id?.slice(-6))+'</span><span style="color:var(--text-muted)">'+(a.tipo||'—')+'</span><span style="color:var(--accent);font-weight:700">'+(a.valorTotal?R$(a.valorTotal):'—')+'</span></div>').join('')}
        </div>
        <button data-action="imprimirPainelContratual"
          style="padding:10px 18px;background:#1e293b;border:none;border-radius:8px;color:#fff;
          font-size:12px;font-weight:700;cursor:pointer;white-space:nowrap;display:flex;align-items:center;gap:6px;
          box-shadow:0 1px 4px rgba(0,0,0,.2)" title="Exportar Painel Contratual em PDF">
          🖨️ Exportar PDF
        </button>
        <button data-action="exportarCSVPainelContratual"
          style="padding:10px 18px;background:#334155;border:none;border-radius:8px;color:#fff;
          font-size:12px;font-weight:700;cursor:pointer;white-space:nowrap;display:flex;align-items:center;gap:6px;
          box-shadow:0 1px 4px rgba(0,0,0,.2)" title="Exportar Painel Contratual em CSV">
          📊 Exportar CSV
        </button>
      </div>

      ${itensCriticos.length>0?`
      <!-- Itens críticos -->
      <div style="background:var(--bg-surface);border:1px solid var(--border);border-radius:12px;padding:18px">
        <div style="font-size:11px;font-weight:800;text-transform:uppercase;letter-spacing:.8px;color:var(--text-muted);margin-bottom:12px">⚠️ Itens com Execução Avançada (&gt;90%)</div>
        ${itensCriticos.map(i=>{
          const p = parseFloat(i.qtd)>0?(i.qtdExec||0)/parseFloat(i.qtd)*100:0;
          return '<div style="margin-bottom:10px"><div style="display:flex;justify-content:space-between;font-size:11px;margin-bottom:4px"><span style="color:var(--text-primary)">'+(i.desc||i.descricao||'Item')+'</span><span style="font-weight:700;color:#f59e0b">'+pct(p)+'</span></div>'+bar(p,'#f59e0b',6)+'</div>';
        }).join('')}
      </div>`:''}
    `;
  }

  _cardInfo(label, valor) {
    return '<div style="background:var(--bg-surface);border:1px solid var(--border);border-radius:8px;padding:10px 14px">'+
      '<div style="font-size:9px;font-weight:700;text-transform:uppercase;letter-spacing:.5px;color:var(--text-muted);margin-bottom:3px">'+label+'</div>'+
      '<div style="font-size:12px;font-weight:700;color:var(--text-primary)">'+valor+'</div>'+
      '</div>';
  }

  _kpi(label, valor, cor) {
    return '<div style="background:var(--bg-card);border:1px solid var(--border);border-radius:8px;padding:10px;text-align:center">'+
      '<div style="font-size:9px;font-weight:700;color:var(--text-muted);text-transform:uppercase;letter-spacing:.5px;margin-bottom:4px">'+label+'</div>'+
      '<div style="font-size:13px;font-weight:800;color:'+cor+';font-family:var(--font-mono,monospace)">'+valor+'</div>'+
      '</div>';
  }

  _bindEvents() {
    this._subs.push(EventBus.on('obra:selecionada', () => {
      try { if (router.current==='painel-contratual') this._render(); }
      catch(e) { console.error('[PainelContratualModule]', e); }
    }, 'painel-contratual'));
    this._subs.push(EventBus.on('cfg:salva', () => {
      try { if (router.current==='painel-contratual') this._render(); }
      catch(e) {}
    }, 'painel-contratual:cfg'));
    this._subs.push(EventBus.on('bm:criado', () => {
      try { if (router.current==='painel-contratual') this._render(); }
      catch(e) {}
    }, 'painel-contratual:bm'));
  }

  _exposeGlobals() {
    window.renderPainelContratual   = () => { try { this._render(); } catch(e){} };
    window.imprimirPainelContratual = () => { try { this._gerarPDF(); } catch(e){ console.error('[PainelContratual] PDF:', e); } };
    window.exportarCSVPainelContratual = () => { try { this._exportarCSV(); } catch(e){ console.error('[PainelContratual] CSV:', e); } };
  }

  _exportarCSV() {
    const obraId   = state.get('obraAtivaId');
    const cfg      = state.get('cfg') || {};
    const bms      = state.get('bms') || [];
    const itens    = state.get('itensContrato') || [];
    const aditivos = state.get('aditivos') || [];
    const vContr   = parseFloat(cfg.valor) || 0;
    const bdi      = parseFloat(cfg.bdi) || 0;

    // ── Mesma lógica de arredondamento ───────────────────────────
    const modoCalc = cfg.modoCalculo || 'truncar';
    const fmtNum = v => modoCalc === 'truncar'
      ? Math.trunc(Math.round(parseFloat(v || 0) * 100 * 100) / 100) / 100
      : Math.round(parseFloat(v || 0) * 100) / 100;

    // ── Seção 1: Dados contratuais ───────────────────────────────
    const dadosContr = [
      ['PAINEL CONTRATUAL'],
      ['Contrato',          cfg.contrato    || ''],
      ['Objeto',            cfg.objeto      || ''],
      ['Contratante',       cfg.contratante || ''],
      ['Contratada',        cfg.contratada  || ''],
      ['Fiscal',            cfg.fiscal      || ''],
      ['Valor Contratual (R$)', numCSV(vContr)],
      ['Início Previsto',   cfg.inicioPrev  || ''],
      ['Término Previsto',  cfg.termino     || ''],
      [],
    ];

    // ── Seção 2: Resumo de BMs (igual à tabela exibida no painel) ─
    const lastBmNum = bms.length ? bms[bms.length-1].num : 0;
    const vAcumTotal = lastBmNum > 0 ? getValorAcumuladoTotal(obraId, lastBmNum, itens, cfg) : 0;
    const saldoContr = vContr - vAcumTotal;
    const pctExecTotal = vContr > 0 ? (vAcumTotal / vContr * 100) : 0;

    const cabecBM = ['BM', 'Período', 'Data Medição', 'Valor BM (R$)', '% BM', 'Acumulado (R$)', '% Acumulado', 'Saldo (R$)'];
    const linhasBM = bms.map(bm => {
      const vAcumAnt = getValorAcumuladoAnterior(obraId, bm.num, itens, cfg);
      const vAcumTot = getValorAcumuladoTotal(obraId, bm.num, itens, cfg);
      const vMed     = vAcumTot - vAcumAnt;
      const pctBM    = vContr > 0 ? (vMed / vContr * 100) : 0;
      const pctAcum  = vContr > 0 ? (vAcumTot / vContr * 100) : 0;
      return [
        bm.label || `BM ${bm.num}`, bm.mes || '', bm.data || '',
        numCSV(vMed), numCSV(pctBM) + '%',
        numCSV(vAcumTot), numCSV(pctAcum) + '%',
        numCSV(vContr - vAcumTot),
      ];
    });
    // Linha de total dos BMs
    const totalBMs = [
      'TOTAL', '', '',
      '', '',
      numCSV(vAcumTotal), numCSV(pctExecTotal) + '%',
      numCSV(saldoContr),
    ];

    // ── Seção 3: Itens do contrato com execução acumulada ─────────
    // (espelha a situação financeira por item visível no painel)
    const cabecItens = [
      'ID', 'Código', 'Descrição', 'Und',
      'Qtd Contratada', 'V.Unit. (R$)', 'V.Unit+BDI (R$)', 'Total Contratado (R$)',
      'Qtd Executada Acum.', 'V.Executado Acum. (R$)', '% Executado', 'Saldo Qtd', 'Saldo (R$)',
    ];
    const linhasItens = [];
    let gCont = 0, gExec = 0, gSaldo = 0;

    itens.forEach(it => {
      if (it.t) {
        const tipo = it.t === 'G' ? 'GRUPO' : it.t === 'SG' ? 'SUBGRUPO' : 'MACRO';
        linhasItens.push([it.id, '', it.desc || '', tipo, '', '', '', '', '', '', '', '', '']);
        return;
      }
      const up      = parseFloat(it.up) || 0;
      const upBdi   = fmtNum(up * (1 + bdi));
      const totCont = fmtNum((it.qtd || 0) * upBdi);
      const qtdExec = lastBmNum > 0 ? getQtdAcumuladoTotalItem(obraId, lastBmNum, it.id, itens) : 0;
      const vExec   = fmtNum(qtdExec * upBdi);
      const pctExec = it.qtd > 0 ? (qtdExec / it.qtd * 100) : 0;
      const qtdSaldo = fmtNum((it.qtd || 0) - qtdExec);
      const saldoItem = fmtNum(totCont - vExec);

      // Só acumula para itens sem pai (evita duplo-contagem)
      const _temPai = itens.some(x => x.t && it.id.startsWith(x.id + '.'));
      if (!_temPai) { gCont += totCont; gExec += vExec; gSaldo += saldoItem; }

      linhasItens.push([
        it.id, it.cod || '', it.desc || '', it.und || '',
        numCSV(it.qtd || 0), numCSV(up), numCSV(upBdi), numCSV(totCont),
        numCSV(qtdExec), numCSV(vExec), numCSV(pctExec) + '%',
        numCSV(qtdSaldo), numCSV(saldoItem),
      ]);
    });
    const totalItens = ['TOTAL GERAL', '', '', '', '', '', '', numCSV(gCont), '', numCSV(gExec), numCSV(vContr > 0 ? gExec / vContr * 100 : 0) + '%', '', numCSV(gSaldo)];

    // ── Seção 4: Aditivos ────────────────────────────────────────
    const cabecAdit = ['Aditivo', 'Tipo', 'Valor (R$)', 'Descrição', 'Data'];
    const linhasAdit = aditivos.map(a => [
      a.numero || a.id || '', a.tipo || '',
      numCSV(a.valorTotal || 0), a.descricao || a.obs || '', a.data || '',
    ]);

    const dados = [
      ...dadosContr,
      ['BOLETINS DE MEDIÇÃO'],
      cabecBM, ...linhasBM, totalBMs,
      [],
      ['ITENS DO CONTRATO — EXECUÇÃO ACUMULADA'],
      cabecItens, ...linhasItens, totalItens,
      [],
      ['ADITIVOS'],
      cabecAdit, ...linhasAdit,
    ];

    baixarCSV(dados, `painel_contratual_${new Date().toISOString().slice(0,10)}`);
    window.auditRegistrar?.({ modulo: 'Painel Contratual', tipo: 'exportação', registro: cfg.contrato || obraId, detalhe: 'Exportação CSV do Painel Contratual' });
    window.toast?.('✅ CSV do Painel Contratual exportado!', 'ok');
  }

  /** Gera PDF do Painel Contratual com Resumo de Medição */
  _gerarPDF() {
    const obraId = state.get('obraAtivaId');
    const cfg    = state.get('cfg') || {};
    const bms    = state.get('bms') || [];
    const itens  = state.get('itensContrato') || [];
    const aditivos = state.get('aditivos') || [];

    const valorContrato = cfg.valor || 0;
    const lastBmNum = bms.length ? bms[bms.length-1].num : 0;
    let vAcumTotal = 0, vMedAtual = 0;
    try {
      if (lastBmNum > 0) {
        vAcumTotal = getValorAcumuladoTotal(obraId, lastBmNum, itens, cfg);
        vMedAtual  = getValorMedicaoAtual(obraId, lastBmNum, itens, cfg);
      }
    } catch(e) {}

    const saldo    = valorContrato - vAcumTotal;
    const pctFin   = valorContrato > 0 ? vAcumTotal / valorContrato * 100 : 0;
    const hoje     = new Date();

    // Linha de BM na tabela Resumo de Medição
    const linhasBM = bms.map(b => {
      const vBm  = (() => { try { return getValorMedicaoAtual(obraId, b.num, itens, cfg); } catch(ex){ return 0; } })();
      const pBm  = valorContrato > 0 ? (vBm / valorContrato * 100).toFixed(2).replace('.',',') + ' %' : '—';
      const nStr = b.num < 10 ? '0'+b.num : String(b.num);
      const clrV = vBm > 0 ? '#15803d' : '#6b7280';
      return `<tr>
        <td style="padding:5px 8px;font-weight:700;color:#1e40af">BM ${nStr}</td>
        <td style="padding:5px 8px;color:#374151">${b.mes || dataBR(b.data) || '—'}</td>
        <td style="padding:5px 8px;text-align:right;font-family:'Courier New',monospace;font-weight:700;color:${clrV}">${R$(vBm)}</td>
        <td style="padding:5px 8px;text-align:right;font-family:'Courier New',monospace;color:#6b7280">${pBm}</td>
      </tr>`;
    }).join('');

    const logo = state.get('logoBase64') || '';
    const html = `<!DOCTYPE html><html lang="pt-BR"><head>
<meta charset="UTF-8">
<title>Painel Contratual — ${cfg.contrato||''}</title>
<style>
  *{box-sizing:border-box;margin:0;padding:0}
  body{font-family:Arial,sans-serif;font-size:9pt;color:#111;padding:8mm}
  h1{font-size:11pt;font-weight:800;text-align:center;margin-bottom:10px;text-transform:uppercase;letter-spacing:.5px}
  .hdr{display:flex;align-items:center;gap:14px;border-bottom:3px solid #1e293b;padding-bottom:10px;margin-bottom:12px}
  .info-grid{display:grid;grid-template-columns:1fr 1fr;gap:6px;margin-bottom:10px}
  .info-box{border:1px solid #e2e8f0;border-radius:4px;padding:6px 10px}
  .info-lbl{font-size:7pt;font-weight:700;text-transform:uppercase;letter-spacing:.4px;color:#6b7280;margin-bottom:2px}
  .info-val{font-size:9pt;font-weight:700;color:#111}
  .kpis{display:grid;grid-template-columns:repeat(4,1fr);gap:8px;margin-bottom:10px}
  .kpi{border:1px solid #d1d5db;border-radius:4px;padding:8px;text-align:center}
  .kpi-lbl{font-size:7pt;color:#6b7280;text-transform:uppercase;font-weight:600;margin-bottom:3px}
  .kpi-val{font-size:11pt;font-weight:800;font-family:'Courier New',monospace}
  .sec-title{background:#1e293b;color:#fff;padding:5px 10px;font-size:8.5pt;font-weight:700;text-transform:uppercase;letter-spacing:.3px;margin:10px 0 0}
  table.resumo{width:100%;border-collapse:collapse;font-size:8.5pt;border:1px solid #d1d5db}
  table.resumo th{background:#f1f5f9;padding:5px 8px;font-size:7.5pt;font-weight:700;text-transform:uppercase;letter-spacing:.4px;color:#374151;border-bottom:2px solid #d1d5db}
  table.resumo td{padding:5px 8px;border-bottom:1px solid #e5e7eb}
  table.resumo tfoot tr{background:#f8fafc;border-top:2px solid #1e293b}
  table.resumo tfoot td{font-weight:700;font-size:9pt}
  @media print{@page{size:A4;margin:8mm}body{padding:0}button{display:none}}
</style></head><body>
<div class="hdr">
  ${logo ? `<img src="${logo}" style="height:55px;max-width:90px;object-fit:contain">` : ''}
  <div style="flex:1">
    <h1 style="text-align:left;margin-bottom:2px">Painel Contratual</h1>
    <div style="font-size:8pt;color:#6b7280">${cfg.contratante||''} ${cfg.contrato?'· Contrato '+cfg.contrato:''}</div>
  </div>
  <div style="font-size:7.5pt;color:#6b7280;text-align:right">
    Emitido em ${hoje.toLocaleDateString('pt-BR')}<br>
    ${hoje.toLocaleTimeString('pt-BR',{hour:'2-digit',minute:'2-digit'})}
  </div>
</div>

<div class="info-grid">
  <div class="info-box"><div class="info-lbl">Contratante</div><div class="info-val">${cfg.contratante||'—'}</div></div>
  <div class="info-box"><div class="info-lbl">Contratada</div><div class="info-val">${cfg.contratada||'—'}</div></div>
  <div class="info-box"><div class="info-lbl">Objeto</div><div class="info-val">${cfg.objeto||'—'}</div></div>
  <div class="info-box"><div class="info-lbl">Contrato Nº</div><div class="info-val">${cfg.contrato||'—'}</div></div>
  <div class="info-box"><div class="info-lbl">Início Previsto</div><div class="info-val">${dataBR(cfg.inicioPrev)}</div></div>
  <div class="info-box"><div class="info-lbl">Término Previsto</div><div class="info-val">${dataBR(cfg.termino)}</div></div>
  ${cfg.fiscal?`<div class="info-box"><div class="info-lbl">Fiscal</div><div class="info-val">${cfg.fiscal}${cfg.creaFiscal?' · '+cfg.creaFiscal:''}</div></div>`:''}
  ${cfg.bdi?`<div class="info-box"><div class="info-lbl">BDI</div><div class="info-val">${((cfg.bdi||0)*100).toFixed(2)} %</div></div>`:''}
</div>

<div class="kpis">
  <div class="kpi"><div class="kpi-lbl">Valor Contratual</div><div class="kpi-val">${R$(valorContrato)}</div></div>
  <div class="kpi"><div class="kpi-lbl">Executado Acumulado</div><div class="kpi-val" style="color:#1e40af">${R$(vAcumTotal)}</div></div>
  <div class="kpi"><div class="kpi-lbl">Saldo a Executar</div><div class="kpi-val" style="color:${saldo<0?'#dc2626':'#15803d'}">${R$(saldo)}</div></div>
  <div class="kpi"><div class="kpi-lbl">% Executado</div><div class="kpi-val" style="color:#1e40af">${pct(pctFin)}</div></div>
</div>

<div class="sec-title">RESUMO DE MEDIÇÃO — VALORES EXECUTADOS POR BOLETIM</div>
<table class="resumo">
  <thead>
    <tr>
      <th style="text-align:left">BM</th>
      <th style="text-align:left">Período / Referência</th>
      <th style="text-align:right">Valor Medido BM</th>
      <th style="text-align:right">% do Contrato</th>
    </tr>
  </thead>
  <tbody>
    ${linhasBM || '<tr><td colspan="4" style="text-align:center;color:#6b7280;padding:10px">Nenhum boletim cadastrado.</td></tr>'}
  </tbody>
  <tfoot>
    <tr>
      <td colspan="2">TOTAL ACUMULADO</td>
      <td style="text-align:right;font-family:'Courier New',monospace;color:#15803d">${R$(vAcumTotal)}</td>
      <td style="text-align:right;font-family:'Courier New',monospace">${pct(pctFin)}</td>
    </tr>
  </tfoot>
</table>

${aditivos.length>0?`
<div class="sec-title">ADITIVOS CONTRATUAIS</div>
<table class="resumo">
  <thead><tr>
    <th>Número</th><th>Tipo</th><th style="text-align:right">Valor</th><th>Observação</th>
  </tr></thead>
  <tbody>
    ${aditivos.map(a=>`<tr>
      <td style="font-weight:700">${a.numero||a.id?.slice(-6)||'—'}</td>
      <td>${a.tipo||'—'}</td>
      <td style="text-align:right;font-family:'Courier New',monospace">${a.valorTotal?R$(a.valorTotal):'—'}</td>
      <td style="font-size:8pt;color:#6b7280">${a.descricao||a.obs||''}</td>
    </tr>`).join('')}
  </tbody>
</table>`:''}

<div style="margin-top:55px;display:grid;grid-template-columns:1fr 1fr;gap:40px">
  <div style="border-top:1px solid #000;padding-top:5px;text-align:center">
    <div style="font-weight:700">${cfg.fiscal||'_________________________'}</div>
    <div style="font-size:8pt">Fiscal do Contrato${cfg.creaFiscal?' · '+cfg.creaFiscal:''}</div>
    <div style="font-size:8pt;margin-top:4px">Data: ___/___/______</div>
  </div>
  <div style="border-top:1px solid #000;padding-top:5px;text-align:center">
    <div style="font-weight:700">${cfg.contratante||'_________________________'}</div>
    <div style="font-size:8pt">Contratante / Gestor</div>
    <div style="font-size:8pt;margin-top:4px">Data: ___/___/______</div>
  </div>
</div>

<br>
<button data-action="print" style="background:#1e293b;color:#fff;border:none;padding:8px 20px;border-radius:4px;cursor:pointer;font-size:10pt">🖨️ Imprimir / Salvar PDF</button>
</body></html>`;

    const w = window.open('', '_blank', 'width=900,height=750');
    w.document.write(html);
    w.document.close();
  }

  destroy() { this._subs.forEach(u=>u()); this._subs=[]; }
}
