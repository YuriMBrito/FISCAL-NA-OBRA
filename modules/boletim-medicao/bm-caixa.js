/**
 * ╔══════════════════════════════════════════════════════════════╗
 * ║  FISCAL NA OBRA v15.5 — modules/boletim-medicao/bm-caixa.js ║
 * ║  Boletim de Medição — Padrão CAIXA (Portaria 37.587)        ║
 * ║                                                              ║
 * ║  Módulo completamente separado do BM padrão prefeitura.     ║
 * ║  Ativado quando cfg.tipoObra === 'caixa'.                   ║
 * ║                                                              ║
 * ║  Regras do padrão CAIXA:                                    ║
 * ║   • Fiscal informa APENAS o "% Executado Total" por item    ║
 * ║   • Todos os valores são calculados automaticamente         ║
 * ║   • % Anterior = puxado automaticamente dos BMs anteriores  ║
 * ║   • Qtd Atual = qtd_cont × (pct_total − pct_ant) / 100     ║
 * ║   • Memória de Cálculo = documentação opcional (não afeta BM)║
 * ║   • PDF gerado no layout oficial CAIXA (Portaria 37.587)    ║
 * ╚══════════════════════════════════════════════════════════════╝
 */

import state         from '../../core/state.js';
import { formatters } from '../../utils/formatters.js';
import { guardFocus } from '../../utils/dom-patcher.js';
import { notifyDirectSave } from '../../utils/auto-save.js';
import {
  getMedicoes,
  salvarMedicoes,
  getQtdAcumuladoAnteriorItem,
  getQtdAcumuladoTotalItem,
  getValorAcumuladoTotal,
  getValorAcumuladoAnterior,
  getBdiEfetivo,
  novoId,
} from './bm-calculos.js';

// ── Formatadores ──────────────────────────────────────────────
const R$ = v => formatters.currency(v);
const n2 = v => {
  const n = parseFloat(v || 0);
  return n.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
};
const pctFmt = v => {
  const n = parseFloat(v || 0);
  return n.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + '%';
};

// ── ID de célula para live-patch ───────────────────────────────
const cid = itemId => `cx-${String(itemId).replace(/\./g, '-')}`;

// ═══════════════════════════════════════════════════════════════
// CaixaBM — renderização da tabela padrão CAIXA
// ═══════════════════════════════════════════════════════════════
export class CaixaBM {

  // ── Renderiza a tabela completa do BM CAIXA ──────────────────
  render({ bms, cfg, obraId, itens }) {
    const sel = document.getElementById('sel-bol-bm');
    if (!sel) return;
    const bmNum = parseInt(sel.value) || 1;
    const bm    = bms.find(b => b.num === bmNum) || bms[0];
    if (!bm) return;

    const med   = getMedicoes(obraId, bmNum);
    const salva = !!(med && med._salva);

    // KPIs do cabeçalho
    const vAcumAnt  = getValorAcumuladoAnterior(obraId, bmNum, itens, cfg);
    const vAcumTot  = getValorAcumuladoTotal(obraId, bmNum, itens, cfg);
    const vMedAtual = vAcumTot - vAcumAnt;
    const saldo     = (cfg.valor || 0) - vAcumTot;

    // Assinaturas
    const setEl = (id, v) => { const el = document.getElementById(id); if (el) el.textContent = v || ''; };
    setEl('sig-fiscal-bol',     cfg.fiscal      || 'FISCAL DO CONTRATO');
    setEl('sig-crea-bol',       cfg.creaFiscal  || '');
    setEl('sig-contratada-bol', cfg.contratada  || 'RESPONSÁVEL TÉCNICO');
    setEl('sig-cnpj-bol',       'CNPJ: ' + (cfg.cnpj || ''));
    setEl('sig-contratante-bol',cfg.contratante || 'CONTRATANTE');

    // Infobar
    const infoEl = document.getElementById('bol-infos');
    if (infoEl) {
      const pgEmpenho = bm.empenho       || '';
      const pgNF      = bm.notaFiscal    || '';
      const pgDataPag = bm.dataPagamento || '';
      const pgPago    = bm.pago          || false;
      infoEl.innerHTML = `
        <div class="bm-info-box"><div class="bm-info-label">Boletim Nº</div><div class="bm-info-val">${bm.label}</div></div>
        <div class="bm-info-box"><div class="bm-info-label">Período</div><div class="bm-info-val">${bm.mes}</div></div>
        <div class="bm-info-box"><div class="bm-info-label">Data Medição</div><div class="bm-info-val">${bm.data || '—'}</div></div>
        <div class="bm-info-box"><div class="bm-info-label">Contrato</div><div class="bm-info-val">${cfg.contrato || '—'}</div></div>
        <div class="bm-info-box"><div class="bm-info-label">Valor Contratual</div><div class="bm-info-val">${R$(cfg.valor || 0)}</div></div>
        <div class="bm-info-box"><div class="bm-info-label">Acumulado Anterior</div><div class="bm-info-val">${R$(vAcumAnt)}</div></div>
        <div class="bm-info-box bm-info-medatual">
          <div class="bm-info-label">Medição Atual</div>
          <div class="bm-info-val" style="color:${vMedAtual < 0 ? '#8B3A2A' : '#1A5E3A'}">${R$(vMedAtual)}</div>
        </div>
        <div class="bm-info-box"><div class="bm-info-label">Acumulado Total</div><div class="bm-info-val">${R$(vAcumTot)}</div></div>
        <div class="bm-info-box bm-info-saldo"><div class="bm-info-label">Saldo a Executar</div><div class="bm-info-val">${R$(saldo)}</div></div>
        <div class="bm-info-box" style="min-width:160px;border-left:3px solid ${pgPago?'#16a34a':'#d97706'}">
          <div class="bm-info-label">💳 Nº Empenho</div>
          <input id="bm-pag-empenho" value="${pgEmpenho}" placeholder="—"
            style="font-size:12px;font-family:var(--font-mono);border:none;background:transparent;color:var(--text-primary);width:100%;padding:0;outline:none"
            data-action="_bmSalvarPagamento" data-arg0="${bmNum}">
        </div>
        <div class="bm-info-box" style="min-width:140px">
          <div class="bm-info-label">🧾 Nota Fiscal</div>
          <input id="bm-pag-nf" value="${pgNF}" placeholder="—"
            style="font-size:12px;font-family:var(--font-mono);border:none;background:transparent;color:var(--text-primary);width:100%;padding:0;outline:none"
            data-action="_bmSalvarPagamento" data-arg0="${bmNum}">
        </div>
        <div class="bm-info-box" style="min-width:130px">
          <div class="bm-info-label">📅 Data Pagamento</div>
          <input id="bm-pag-data" type="date" value="${pgDataPag}"
            style="font-size:11px;border:none;background:transparent;color:var(--text-primary);width:100%;padding:0;outline:none"
            data-action="_bmSalvarPagamento" data-arg0="${bmNum}">
        </div>
        <div class="bm-info-box" style="min-width:100px;border-left:3px solid ${pgPago?'#16a34a':'#e5e7eb'}">
          <div class="bm-info-label">Pagamento</div>
          <label style="display:flex;align-items:center;gap:5px;cursor:pointer;margin-top:4px">
            <input type="checkbox" id="bm-pag-pago" ${pgPago?'checked':''} style="width:14px;height:14px"
              data-action="_bmSalvarPagamento" data-arg0="${bmNum}">
            <span style="font-size:11px;font-weight:700;color:${pgPago?'#16a34a':'#d97706'}">${pgPago?'✅ Pago':'⏳ Pendente'}</span>
          </label>
        </div>
        <div class="bm-info-box" style="background:#fffbeb;border:1px solid #f59e0b;min-width:110px">
          <div class="bm-info-label" style="color:#92400e">🏦 Padrão CAIXA</div>
          <div style="font-size:10px;font-weight:700;color:#92400e;margin-top:2px">Portaria 37.587</div>
        </div>`;
    }

    // ── Gera a tabela ─────────────────────────────────────────
    // Acumuladores em centavos inteiros — evita erro de ponto flutuante binário
    // (ex: 530.50 + 5183.59 + 120814.06 + 16501.93 = 143030.0799... em float → trunca errado)
    let gContR = 0, gAntR = 0, gAtualR = 0, gAcumR = 0, gSaldoR = 0;
    let _gContC = 0, _gAntC = 0, _gAtualC = 0, _gAcumC = 0, _gSaldoC = 0;

    // Helpers hierárquicos (reutilizados da versão standard)
    const _filhoDireto = (paiId, filhoId) => {
      const p = paiId + '.';
      if (!filhoId.startsWith(p)) return false;
      return !filhoId.slice(p.length).includes('.');
    };
    const _temMacroPai = id => {
      const partes = id.split('.');
      for (let n = partes.length - 1; n >= 1; n--) {
        const cand = partes.slice(0, n).join('.');
        if (itens.find(x => x.id === cand && x.t === 'MACRO')) return true;
      }
      return false;
    };
    const _temQualquerPai = id => itens.some(x => x.id !== id && id.startsWith(x.id + '.'));

    // Agrega valores de grupo/macro para linhas de totais
    // CORREÇÃO: arredonda cada contribuição antes de somar — igual à planilha CAIXA
    const rnd2 = v => Math.round(v * 100) / 100;

    const _valGrupo = grupoId => {
      let tCont = 0, tAnt = 0, tAtual = 0, tAcum = 0;
      const prefix = grupoId + '.';
      itens.forEach(sub => {
        if (!sub.id.startsWith(prefix)) return;
        if (sub.t === 'G' || sub.t === 'SG' || sub.t === 'MACRO') return;
        if (_temMacroPai(sub.id)) return;
        // Usa upBdi salvo diretamente se disponível (evita perda de precisão na divisão/multiplicação por BDI)
        const upBdi  = sub.upBdi ? sub.upBdi : rnd2((sub.up || 0) * (1 + getBdiEfetivo(sub, cfg)));
        const tC     = rnd2((sub.qtd || 0) * upBdi);
        const qAnt   = getQtdAcumuladoAnteriorItem(obraId, bmNum, sub.id, itens);
        const qAcum  = getQtdAcumuladoTotalItem(obraId, bmNum, sub.id, itens);
        tCont  += tC;
        tAnt   += rnd2(qAnt  * upBdi);
        tAcum  += rnd2(qAcum * upBdi);
        tAtual += rnd2((qAcum - qAnt) * upBdi);
      });
      return { tCont, tAnt, tAtual, tAcum, tSaldo: tCont - tAcum };
    };

    // ── Cabeçalho da tabela ───────────────────────────────────
    let html = `
    <table id="caixa-bm-table">
      <colgroup>
        <col style="width:38px">   <!-- ações -->
        <col style="width:34px">   <!-- item -->
        <col style="width:54px">   <!-- código -->
        <col style="width:22%">    <!-- descrição -->
        <col style="width:30px">   <!-- und -->
        <col style="width:64px">   <!-- qtd cont -->
        <col style="width:80px">   <!-- v.unit+bdi -->
        <col style="width:88px">   <!-- tot.cont -->
        <col style="width:54px">   <!-- % ant -->
        <col style="width:88px">   <!-- tot ant -->
        <col style="width:80px">   <!-- % exec total (INPUT) -->
        <col style="width:64px">   <!-- qtd atual -->
        <col style="width:54px">   <!-- % atual -->
        <col style="width:88px">   <!-- total atual -->
        <col style="width:54px">   <!-- % acum -->
        <col style="width:88px">   <!-- total acum -->
        <col style="width:64px">   <!-- saldo qtd -->
        <col style="width:88px">   <!-- saldo R$ -->
        <col style="width:38px">   <!-- memória -->
      </colgroup>
      <thead>
        <tr>
          <th rowspan="2" style="background:#1e1e1e;color:#9ca3af;font-size:9px">Ações</th>
          <th rowspan="2">Item</th>
          <th rowspan="2">Código</th>
          <th rowspan="2" style="text-align:left">Descrição</th>
          <th rowspan="2" style="text-align:center">Und</th>
          <th colspan="3" style="text-align:center;background:#1A3A5C;color:#93c5fd">Contratual</th>
          <th colspan="2" style="text-align:center;background:#2a2a2a;color:#d1d5db">Acum. Anterior</th>
          <th rowspan="2" style="text-align:center;background:#78350f;color:#fde68a;border:2px solid #f59e0b;font-size:9px;white-space:nowrap">
            % Exec.<br>Total<br><span style="font-size:8px;font-weight:400">(digitar)</span>
          </th>
          <th colspan="3" style="text-align:center;background:#14532d;color:#86efac">Medição Atual</th>
          <th colspan="2" style="text-align:center;background:#1e3a5f;color:#93c5fd">Acum. Total</th>
          <th colspan="2" style="text-align:center;background:#1c1917;color:#a8a29e">Saldo</th>
          <th rowspan="2" style="background:#1e1e1e;color:#9ca3af;font-size:9px">Mem.</th>
        </tr>
        <tr>
          <th style="text-align:right;background:#1A3A5C;color:#93c5fd;font-size:9px">Qtd</th>
          <th style="text-align:right;background:#1A3A5C;color:#93c5fd;font-size:9px">V.Unit (R$)</th>
          <th style="text-align:right;background:#1A3A5C;color:#93c5fd;font-size:9px">Tot.Cont.</th>
          <th style="text-align:right;background:#2a2a2a;color:#d1d5db;font-size:9px">%</th>
          <th style="text-align:right;background:#2a2a2a;color:#d1d5db;font-size:9px">Total</th>
          <th style="text-align:right;background:#14532d;color:#86efac;font-size:9px">Qtd</th>
          <th style="text-align:right;background:#14532d;color:#86efac;font-size:9px">%</th>
          <th style="text-align:right;background:#14532d;color:#86efac;font-size:9px">Total</th>
          <th style="text-align:right;background:#1e3a5f;color:#93c5fd;font-size:9px">%</th>
          <th style="text-align:right;background:#1e3a5f;color:#93c5fd;font-size:9px">Total</th>
          <th style="text-align:right;background:#1c1917;color:#a8a29e;font-size:9px">Qtd</th>
          <th style="text-align:right;background:#1c1917;color:#a8a29e;font-size:9px">Total</th>
        </tr>
      </thead>
      <tbody>`;

    itens.forEach(it => {
      // ── Linha de GRUPO ──────────────────────────────────────
      if (it.t === 'G' || it.t === 'SG') {
        const v  = _valGrupo(it.id);
        const bg = it.t === 'G' ? 'background:#1e1e1e' : 'background:#1a1a1a';
        const fw = it.t === 'G' ? 'font-weight:700' : 'font-weight:600';
        const pAcum = v.tCont > 0 ? v.tAcum / v.tCont * 100 : 0;
        // Grupos G/SG: NÃO somam ao total geral — seus filhos são somados individualmente como itens normais
        html += `<tr style="${bg};${fw};color:#e2e8f0">
          <td style="padding:0 6px;text-align:center">
            ${!salva ? `<button style="background:none;border:none;color:#9ca3af;cursor:pointer;font-size:10px;padding:1px 4px"
              data-action="editarAgregadorBM" data-arg0="${it.t}" data-arg1="${it.id.replace(/'/g,"\\'")}">✏️</button>` : ''}
          </td>
          <td colspan="7" style="padding:4px 10px;font-size:10px">
            ${it.t==='G'?'▌':' ↳'} ${it.id} &nbsp; ${it.desc}
          </td>
          <td class="td-r" style="font-size:9.5px;color:#9ca3af">${pctFmt(v.tCont > 0 ? v.tAnt/v.tCont*100 : 0)}</td>
          <td class="td-r" style="font-size:9.5px;color:#9ca3af">${v.tAnt > 0 ? R$(v.tAnt) : '—'}</td>
          <td></td>
          <td class="td-r" style="font-size:9.5px;color:#9ca3af">—</td>
          <td class="td-r" style="font-size:9.5px;color:${v.tAtual > 0 ? '#86efac' : '#9ca3af'}">${v.tAtual !== 0 ? pctFmt(v.tCont > 0 ? v.tAtual/v.tCont*100 : 0) : '—'}</td>
          <td class="td-r" style="font-size:9.5px;color:${v.tAtual > 0 ? '#86efac' : '#9ca3af'}">${v.tAtual !== 0 ? R$(v.tAtual) : '—'}</td>
          <td class="td-r" style="font-size:9.5px;color:#93c5fd">${pctFmt(pAcum)}</td>
          <td class="td-r" style="font-size:9.5px;color:#93c5fd">${v.tAcum > 0 ? R$(v.tAcum) : '—'}</td>
          <td class="td-r" style="font-size:9.5px;color:#a8a29e">—</td>
          <td class="td-r" style="font-size:9.5px;color:${v.tSaldo < 0.01 ? '#86efac' : '#fca5a5'}">${R$(v.tSaldo)}</td>
          <td></td>
        </tr>`;
        return;
      }

      // ── Linha de MACRO ──────────────────────────────────────
      if (it.t === 'MACRO') {
        // Agrupa filhos diretos do MACRO
        let tCont = 0, tAnt = 0, tAtual = 0, tAcum = 0;
        itens.forEach(sub => {
          if (!_filhoDireto(it.id, sub.id) || sub.t) return;
          const upBdi = sub.upBdi ? sub.upBdi : rnd2((sub.up || 0) * (1 + getBdiEfetivo(sub, cfg)));
          const qAnt  = getQtdAcumuladoAnteriorItem(obraId, bmNum, sub.id, itens);
          const qAcum = getQtdAcumuladoTotalItem(obraId, bmNum, sub.id, itens);
          tCont  += rnd2((sub.qtd || 0) * upBdi);
          tAnt   += rnd2(qAnt  * upBdi);
          tAcum  += rnd2(qAcum * upBdi);
          tAtual += rnd2((qAcum - qAnt) * upBdi);
        });
        const tSaldo = tCont - tAcum;
        const pAcum  = tCont > 0 ? tAcum / tCont * 100 : 0;
        // CORREÇÃO: MACRO também soma sempre — seus filhos diretos não têm pai próprio
        html += `<tr style="background:#1c1c1e;color:#e2e8f0">
          <td style="padding:0 4px;text-align:center;font-size:9px;color:#6b7280">MACRO</td>
          <td class="td-c" style="font-size:9px;color:#9ca3af">${it.id}</td>
          <td>—</td>
          <td style="font-size:10px;padding-left:${8+(it.id.split('.').length-1)*14}px"><strong>${it.desc}</strong></td>
          <td>—</td>
          <td>—</td><td class="td-r" style="font-size:9.5px">${R$(tCont/(it.qtd||1) || 0)}</td>
          <td class="td-r" style="font-weight:700">${R$(tCont)}</td>
          <td class="td-r" style="color:#9ca3af">${pctFmt(tCont > 0 ? tAnt/tCont*100 : 0)}</td>
          <td class="td-r" style="color:#9ca3af">${tAnt > 0 ? R$(tAnt) : '—'}</td>
          <td></td>
          <td class="td-r" style="color:#86efac">${tAtual !== 0 ? n2(0) : '—'}</td>
          <td class="td-r" style="color:#86efac">${pctFmt(tCont > 0 ? tAtual/tCont*100 : 0)}</td>
          <td class="td-r;font-weight:700;color:#86efac">${tAtual !== 0 ? R$(tAtual) : '—'}</td>
          <td class="td-r" style="color:#93c5fd">${pctFmt(pAcum)}</td>
          <td class="td-r" style="color:#93c5fd">${tAcum > 0 ? R$(tAcum) : '—'}</td>
          <td class="td-r" style="color:#a8a29e">—</td>
          <td class="td-r;color:${tSaldo < 0.01 ? '#86efac' : '#fca5a5'}">${R$(tSaldo)}</td>
          <td></td>
        </tr>`;
        return;
      }

      // ── Linha de ITEM NORMAL ────────────────────────────────
      // Usa upBdi salvo diretamente se disponível (evita 1 centavo de diferença por arredondamento)
      const upBdi    = it.upBdi ? it.upBdi : rnd2((it.up || 0) * (1 + getBdiEfetivo(it, cfg)));
      const totCont  = rnd2((it.qtd || 0) * upBdi);

      // Acumulado anterior (BMs 1..bmNum-1)
      const qtdAnt   = getQtdAcumuladoAnteriorItem(obraId, bmNum, it.id, itens);
      const pctAnt   = it.qtd > 0 ? qtdAnt / it.qtd * 100 : 0;
      const totAnt   = rnd2(qtdAnt * upBdi);

      // % Executado Total salvo (o que o usuário digitou)
      const pctExec  = med[it.id]?._pctExec ?? null;

      // Acumulado total (BMs 1..bmNum) — vem do cache de medições
      const qtdAcum  = getQtdAcumuladoTotalItem(obraId, bmNum, it.id, itens);
      const pctAcum  = it.qtd > 0 ? qtdAcum / it.qtd * 100 : 0;
      const totAcum  = rnd2(qtdAcum * upBdi);

      // Medição atual
      const qtdAtual = Math.max(0, qtdAcum - qtdAnt);
      const pctAtual = it.qtd > 0 ? qtdAtual / it.qtd * 100 : 0;
      const totAtual = rnd2(qtdAtual * upBdi);

      // Saldo
      const qtdSaldo = (it.qtd || 0) - qtdAcum;
      const totSaldo = rnd2(totCont - totAcum);

      // CORREÇÃO: soma TODOS os itens folha (sem tipo t), independente de hierarquia.
      // getValorAcumuladoTotal (KPI do cabeçalho) também soma todos os itens folha,
      // por isso o filtro _temQualquerPai causava divergência entre KPI e TOTAL GERAL.
      // Grupos G/SG são apenas cabeçalhos — seus filhos carregam os valores reais.
      _gContC  += Math.round(totCont  * 100);
      _gAntC   += Math.round(totAnt   * 100);
      _gAtualC += Math.round(totAtual * 100);
      _gAcumC  += Math.round(totAcum  * 100);
      _gSaldoC += Math.round(totSaldo * 100);

      const rowBg = qtdAtual > 0
        ? 'background:rgba(34,197,94,.08)'
        : qtdAtual < 0 ? 'background:rgba(239,68,68,.06)' : '';

      const btnAcoes = salva
        ? `<span title="Bloqueado" style="font-size:9px;color:#6b7280">🔒</span>`
        : `<button
             title="Editar item"
             style="background:none;border:1px solid #374151;border-radius:4px;
               color:#93c5fd;font-size:9px;padding:2px 5px;cursor:pointer"
             data-action="abrirCrudItemBM"
             data-arg0="editar"
             data-arg1="${it.id.replace(/"/g,'&quot;')}">✏️</button>
           <button
             title="Excluir item"
             style="background:none;border:1px solid #7f1d1d;border-radius:4px;
               color:#fca5a5;font-size:9px;padding:2px 5px;cursor:pointer;margin-left:2px"
             data-action="excluirItemBM"
             data-arg0="${it.id.replace(/"/g,'&quot;')}">🗑️</button>`;

      const c = cid(it.id);

      // Coluna de input ou texto readonly
      const inputCell = salva
        ? `<span style="font-size:11px;font-family:var(--font-mono);color:var(--text-primary);font-weight:700">
             ${pctExec != null ? pctExec.toFixed(2) + '%' : '—'}
           </span>`
        : `<input
             id="cx-input-${c}"
             type="number" min="0" max="100" step="0.01"
             value="${pctExec != null ? pctExec : ''}"
             placeholder="0,00"
             data-action="_bmCaixaAplicarPct"
             data-arg0="${it.id.replace(/"/g,'&quot;')}"
             data-value-from="this.value"
             style="width:68px;padding:4px 6px;border-radius:6px;
               border:2px solid #f59e0b;background:#fffbeb;
               color:#92400e;font-size:12px;font-family:var(--font-mono);
               text-align:right;font-weight:700;outline:none;
               box-shadow:0 0 0 0 rgba(245,158,11,.4);
               transition:box-shadow .15s"
             onfocus="this.style.boxShadow='0 0 0 3px rgba(245,158,11,.3)'"
             onblur="this.style.boxShadow='0 0 0 0 rgba(245,158,11,.4)'">`;

      html += `<tr style="${rowBg}" data-item-id="${it.id}">
        <td class="td-c" style="padding:3px 4px">${btnAcoes}</td>
        <td class="td-c" style="font-size:9px;font-family:var(--font-mono);color:#6b7280">${it.id}</td>
        <td class="td-c" style="font-size:9px;font-family:var(--font-mono);color:#93c5fd">${it.cod || '—'}</td>
        <td style="font-size:10.5px;padding-right:8px">${it.desc}${this._bdiBadge(it)}</td>
        <td class="td-c" style="color:#93c5fd;font-size:10px">${it.und || '—'}</td>
        <td class="td-r" style="font-size:10px">${n2(it.qtd)}</td>
        <td class="td-r" style="font-size:10px;color:#93c5fd">${R$(upBdi)}</td>
        <td class="td-r" style="font-size:10px;font-weight:700">${R$(totCont)}</td>
        <td class="td-r" style="font-size:10px;color:#9ca3af">${pctFmt(pctAnt)}</td>
        <td class="td-r" style="font-size:10px;color:#9ca3af">${totAnt > 0 ? R$(totAnt) : '—'}</td>
        <td class="td-c" style="padding:2px 4px;background:#fffbeb">${inputCell}</td>
        <td id="${c}-qtdAt" class="td-r" style="font-size:10px;${qtdAtual > 0 ? 'color:#16a34a;font-weight:700' : qtdAtual < 0 ? 'color:#dc2626' : 'color:#9ca3af'}">${n2(qtdAtual)}</td>
        <td id="${c}-pctAt" class="td-r" style="font-size:10px;${pctAtual > 0 ? 'color:#16a34a' : 'color:#9ca3af'}">${pctFmt(pctAtual)}</td>
        <td id="${c}-totAt" class="td-r" style="font-size:10px;${qtdAtual > 0 ? 'color:#16a34a;font-weight:700' : qtdAtual < 0 ? 'color:#dc2626' : 'color:#9ca3af'}">${totAtual !== 0 ? R$(totAtual) : '—'}</td>
        <td id="${c}-pctAc" class="td-r" style="font-size:10px;color:#93c5fd">${pctFmt(pctAcum)}</td>
        <td id="${c}-totAc" class="td-r" style="font-size:10px;color:#93c5fd">${totAcum > 0 ? R$(totAcum) : '—'}</td>
        <td id="${c}-qtdSd" class="td-r" style="font-size:10px;color:#a8a29e">${n2(qtdSaldo)}</td>
        <td id="${c}-totSd" class="td-r" style="font-size:10px;color:${totSaldo < 0.01 ? '#16a34a' : '#f97316'}">${R$(totSaldo)}</td>
        <td class="td-c" style="padding:2px 3px">
          <button
            title="Memória de Cálculo"
            style="background:none;border:1px solid #374151;border-radius:4px;
              color:#9ca3af;font-size:9px;padding:2px 5px;cursor:pointer;white-space:nowrap"
            data-action="_bmCaixaAbrirMemoria"
            data-arg0="${it.id.replace(/"/g,'&quot;')}">📐</button>
        </td>
      </tr>`;
    });

    // Rodapé totais — usa os valores já corretamente calculados pelo getValorAcumuladoTotal
    // para garantir que tela e KPI exibam exatamente o mesmo resultado (sem divergência de 1 centavo)
    const rndFinal = v => Math.round(v * 100) / 100;
    // Converte centavos inteiros → reais (divisão exata)
    gContR  = _gContC  / 100;
    gSaldoR = rndFinal(gContR - vAcumTot);
    html += `</tbody>
      <tfoot>
        <tr style="background:#111;font-weight:700;color:#e2e8f0;font-size:10.5px">
          <td colspan="4" style="text-align:right;padding:6px 10px;letter-spacing:.5px">TOTAL GERAL</td>
          <td>—</td>
          <td>—</td><td>—</td>
          <td class="td-r">${R$(gContR)}</td>
          <td class="td-r" style="color:#9ca3af">${pctFmt(gContR > 0 ? vAcumAnt/gContR*100 : 0)}</td>
          <td class="td-r" style="color:#9ca3af">${vAcumAnt > 0 ? R$(vAcumAnt) : '—'}</td>
          <td></td>
          <td class="td-r" style="color:#86efac">—</td>
          <td class="td-r" style="color:#86efac">${pctFmt(gContR > 0 ? vMedAtual/gContR*100 : 0)}</td>
          <td class="td-r" style="color:#86efac">${R$(vMedAtual)}</td>
          <td class="td-r" style="color:#93c5fd">${pctFmt(gContR > 0 ? vAcumTot/gContR*100 : 0)}</td>
          <td class="td-r" style="color:#93c5fd">${R$(vAcumTot)}</td>
          <td class="td-r" style="color:#a8a29e">—</td>
          <td class="td-r" style="color:${gSaldoR < 0.01 ? '#86efac' : '#fca5a5'}">${R$(gSaldoR)}</td>
          <td></td>
        </tr>
      </tfoot>
    </table>`;

    const wrap = document.getElementById('bol-table-wrap');
    if (wrap) guardFocus(() => { wrap.innerHTML = html; });
  }

  // ── Badge de BDI diferenciado ─────────────────────────────
  _bdiBadge(it) {
    if (it.tipoBdi === 'reduzido')
      return `<span title="BDI Reduzido (TCU Ac. 2.622/2013)" style="font-size:8px;background:#dbeafe;color:#1e40af;border:1px solid #93c5fd;border-radius:3px;padding:0 4px;margin-left:4px;font-weight:700">BDI-R</span>`;
    if (it.tipoBdi === 'zero')
      return `<span title="Sem BDI" style="font-size:8px;background:#fee2e2;color:#991b1b;border:1px solid #fca5a5;border-radius:3px;padding:0 4px;margin-left:4px;font-weight:700">BDI0</span>`;
    return '';
  }

  // ══════════════════════════════════════════════════════════
  // aplicarPct — chamado a cada tecla no input % Exec. Total
  // Salva + faz live-patch das 6 células da linha sem re-render
  // ══════════════════════════════════════════════════════════
  aplicarPct(itemId, pctExecRaw) {
    const obraId = state.get('obraAtivaId');
    const bmNum  = parseInt(document.getElementById('sel-bol-bm')?.value || 1);
    const itens  = state.get('itensContrato') || [];
    const cfg    = state.get('cfg') || {};
    const item   = itens.find(i => i.id === itemId);
    if (!item) { console.warn('[CaixaBM] Item não encontrado:', itemId); return; }

    const pct = Math.max(0, Math.min(100, parseFloat(pctExecRaw) || 0));

    // Quantidades
    const qtdAcumTotal = (item.qtd || 0) * (pct / 100);
    const qtdAcumAnt   = getQtdAcumuladoAnteriorItem(obraId, bmNum, itemId, itens);
    const qtdAtual     = Math.max(0, qtdAcumTotal - qtdAcumAnt);

    // Persiste no cache e Firebase
    const med = getMedicoes(obraId, bmNum);
    med[itemId] = {
      lines: [{
        id:       novoId('cx'),
        qtd:      qtdAtual,
        comp: 1, larg: 1, alt: 1,
        desc:     `${pct.toFixed(2)}% executado (CAIXA)`,
        bmOrigem: bmNum,
      }],
      _caixa:   true,
      _pctExec: pct,
    };
    salvarMedicoes(obraId, bmNum, med);
    notifyDirectSave(); // FIX: informa o autosave que já houve save direto
    const rnd2lp  = v => Math.round(v * 100) / 100;
    const upBdi   = item.upBdi ? item.upBdi : rnd2lp((item.up || 0) * (1 + getBdiEfetivo(item, cfg)));
    const totAtual = rnd2lp(qtdAtual * upBdi);
    const totAcum  = rnd2lp(qtdAcumTotal * upBdi);
    const pctAtual = item.qtd > 0 ? qtdAtual / item.qtd * 100 : 0;
    const pctAcum  = item.qtd > 0 ? qtdAcumTotal / item.qtd * 100 : 0;
    const qtdSaldo = (item.qtd || 0) - qtdAcumTotal;
    const totSaldo = (item.qtd || 0) * upBdi - totAcum;

    // Aplica nas células sem re-render da tabela inteira
    const c = cid(itemId);
    const patch = (id, text, color) => {
      const el = document.getElementById(id);
      if (!el) return;
      el.textContent = text;
      if (color !== undefined) el.style.color = color;
    };
    const corAt = qtdAtual > 0 ? '#16a34a' : qtdAtual < 0 ? '#dc2626' : '#9ca3af';
    patch(c + '-qtdAt', n2(qtdAtual),     corAt);
    patch(c + '-pctAt', pctFmt(pctAtual), pctAtual > 0 ? '#16a34a' : '#9ca3af');
    patch(c + '-totAt', totAtual !== 0 ? R$(totAtual) : '—', corAt);
    patch(c + '-pctAc', pctFmt(pctAcum),  pctAcum > 0 ? '#93c5fd' : '#9ca3af');
    patch(c + '-totAc', totAcum > 0 ? R$(totAcum) : '—', '#93c5fd');
    patch(c + '-qtdSd', n2(qtdSaldo));
    patch(c + '-totSd', R$(totSaldo), totSaldo < 0.01 ? '#16a34a' : '#f97316');
  }

  // ══════════════════════════════════════════════════════════
  // abrirMemoria — modal de memória de cálculo (documentação)
  // ══════════════════════════════════════════════════════════
  abrirMemoria(itemId) {
    const obraId = state.get('obraAtivaId');
    const bmNum  = parseInt(document.getElementById('sel-bol-bm')?.value || 1);
    const itens  = state.get('itensContrato') || [];
    const cfg    = state.get('cfg') || {};
    const item   = itens.find(i => i.id === itemId);
    if (!item) { window.toast?.('⚠️ Item não encontrado.', 'warn'); return; }

    const med     = getMedicoes(obraId, bmNum);
    const chave   = `_mem_caixa_${itemId}`;
    const memoria = med[chave] || { linhas: [], observacao: '' };

    document.getElementById('bm-mem-caixa-overlay')?.remove();
    document.getElementById('bm-mem-caixa-modal')?.remove();

    const upBdi   = (item.up || 0); // CAIXA Preço Global: BDI já embutido no V.Unit
    const totCont = (item.qtd || 0) * upBdi;

    // Renderiza as linhas da tabela de memória
    const renderLinhas = linhas => linhas.map((l, idx) => `
      <tr>
        <td style="padding:4px 6px">
          <input value="${(l.descricao||'').replace(/"/g,'&quot;')}" data-mem-desc="${idx}"
            style="width:100%;padding:4px 6px;border:1px solid var(--border);border-radius:5px;
              background:var(--bg-surface);color:var(--text-primary);font-size:11px;box-sizing:border-box"
            placeholder="Ex: Trecho A – Rua das Flores (0+000 a 0+150)">
        </td>
        <td style="padding:4px 6px;width:100px">
          <input value="${l.quantidade || 0}" data-mem-qtd="${idx}" type="number" step="any"
            style="width:100%;padding:4px 6px;border:1px solid var(--border);border-radius:5px;
              background:var(--bg-surface);color:var(--text-primary);font-size:11px;
              font-family:var(--font-mono);box-sizing:border-box;text-align:right">
        </td>
        <td style="padding:4px 6px;width:70px">
          <input value="${l.unidade || ''}" data-mem-und="${idx}"
            style="width:100%;padding:4px 6px;border:1px solid var(--border);border-radius:5px;
              background:var(--bg-surface);color:var(--text-primary);font-size:11px;box-sizing:border-box"
            placeholder="m², un…">
        </td>
        <td style="padding:4px;width:34px;text-align:center">
          <button data-action="_memCaixaRemoverLinha" data-arg0="${idx}"
            style="background:none;border:1px solid #ef4444;color:#ef4444;border-radius:4px;
              padding:2px 7px;cursor:pointer;font-size:10px">✕</button>
        </td>
      </tr>`).join('');

    const overlay = document.createElement('div');
    overlay.id = 'bm-mem-caixa-overlay';
    overlay.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,.65);z-index:1300';

    const modal = document.createElement('div');
    modal.id = 'bm-mem-caixa-modal';
    modal.style.cssText = [
      'position:fixed','top:50%','left:50%','transform:translate(-50%,-50%)',
      'z-index:1301','background:var(--bg-card)','border:1px solid var(--border)',
      'border-radius:14px','padding:24px','min-width:580px','max-width:760px',
      'width:96vw','max-height:92vh','overflow-y:auto',
      'box-shadow:0 24px 64px rgba(0,0,0,.6)',
    ].join(';');

    modal.innerHTML = `
      <div style="display:flex;align-items:flex-start;justify-content:space-between;margin-bottom:18px">
        <div>
          <div style="font-size:10px;font-weight:700;color:#f59e0b;text-transform:uppercase;letter-spacing:.8px">
            📐 Memória de Cálculo · Padrão CAIXA
          </div>
          <div style="font-size:15px;font-weight:800;color:var(--text-primary);margin-top:4px">
            ${item.id} — ${item.desc}
          </div>
          <div style="font-size:11px;color:var(--text-muted);margin-top:4px;display:flex;gap:16px;flex-wrap:wrap">
            <span>BM <strong>${String(bmNum).padStart(2,'0')}</strong></span>
            <span>Qtd contratada: <strong>${n2(item.qtd)} ${item.und || ''}</strong></span>
            <span>V.Unit (global): <strong style="font-family:var(--font-mono)">${R$(upBdi)}</strong></span>
            <span>Total contratual: <strong style="font-family:var(--font-mono);color:#f59e0b">${R$(totCont)}</strong></span>
          </div>
        </div>
        <button id="bm-mem-caixa-fechar"
          style="background:none;border:none;font-size:24px;cursor:pointer;color:var(--text-muted);
            flex-shrink:0;margin-left:12px;line-height:1">×</button>
      </div>

      <div style="background:#fffbeb;border:1px solid #f59e0b;border-radius:8px;
        padding:10px 14px;margin-bottom:16px;font-size:11px;color:#92400e;
        display:flex;gap:10px;align-items:flex-start">
        <span style="font-size:16px;flex-shrink:0">ℹ️</span>
        <div>
          <strong>Esta memória é apenas para documentação.</strong><br>
          Ela <em>não preenche</em> o Boletim de Medição automaticamente.<br>
          Para registrar a execução, use o campo <strong>% Exec. Total</strong> na coluna amarela da tabela.
        </div>
      </div>

      <div style="overflow-x:auto;margin-bottom:12px">
        <table style="width:100%;border-collapse:collapse;font-size:12px">
          <thead>
            <tr style="background:var(--bg-surface)">
              <th style="padding:7px 8px;text-align:left;font-size:10px;font-weight:700;
                color:var(--text-muted);border-bottom:1px solid var(--border)">Localização / Descrição do Serviço</th>
              <th style="padding:7px 8px;text-align:right;font-size:10px;font-weight:700;
                color:var(--text-muted);border-bottom:1px solid var(--border);width:100px">Quantidade</th>
              <th style="padding:7px 8px;text-align:left;font-size:10px;font-weight:700;
                color:var(--text-muted);border-bottom:1px solid var(--border);width:70px">Unidade</th>
              <th style="border-bottom:1px solid var(--border);width:34px"></th>
            </tr>
          </thead>
          <tbody id="bm-mem-caixa-tbody">
            ${renderLinhas(memoria.linhas)}
          </tbody>
        </table>
      </div>

      <button id="bm-mem-caixa-add-linha"
        style="padding:7px 14px;background:var(--bg-surface);border:1px dashed var(--border);
          border-radius:7px;color:var(--text-muted);font-size:11px;font-weight:600;
          cursor:pointer;width:100%;margin-bottom:16px;text-align:left">
        ＋ Adicionar linha de medição
      </button>

      <div style="margin-bottom:18px">
        <label style="font-size:11px;font-weight:700;color:var(--text-muted);display:block;margin-bottom:5px">
          📝 Observação / Justificativa do Fiscal
        </label>
        <textarea id="bm-mem-caixa-obs" rows="3"
          placeholder="Descreva as condições de medição, documentos de referência, visitas realizadas..."
          style="width:100%;padding:9px 11px;border-radius:7px;border:1px solid var(--border);
            background:var(--bg-surface);color:var(--text-primary);font-size:12px;
            box-sizing:border-box;resize:vertical">${memoria.observacao || ''}</textarea>
      </div>

      <div style="display:flex;gap:10px;justify-content:flex-end">
        <button id="bm-mem-caixa-cancelar"
          style="padding:10px 22px;background:var(--bg-surface);border:1px solid var(--border);
            border-radius:8px;font-size:12px;font-weight:700;cursor:pointer;
            color:var(--text-primary)">Cancelar</button>
        <button id="bm-mem-caixa-salvar"
          style="padding:10px 22px;background:var(--accent);border:none;border-radius:8px;
            color:#fff;font-size:12px;font-weight:700;cursor:pointer">
          💾 Salvar Memória</button>
      </div>`;

    document.body.appendChild(overlay);
    document.body.appendChild(modal);

    let _linhas = [...(memoria.linhas || [])];

    const coletarLinhas = () => {
      const tbody = document.getElementById('bm-mem-caixa-tbody');
      if (!tbody) return _linhas;
      return _linhas.map((_, idx) => ({
        descricao:  (tbody.querySelector(`[data-mem-desc="${idx}"]`)?.value || '').trim(),
        quantidade: parseFloat(tbody.querySelector(`[data-mem-qtd="${idx}"]`)?.value || 0) || 0,
        unidade:    (tbody.querySelector(`[data-mem-und="${idx}"]`)?.value  || '').trim(),
      }));
    };

    const reRender = () => {
      const tbody = document.getElementById('bm-mem-caixa-tbody');
      if (tbody) tbody.innerHTML = renderLinhas(_linhas);
    };

    document.getElementById('bm-mem-caixa-add-linha').addEventListener('click', () => {
      _linhas = coletarLinhas();
      _linhas.push({ descricao: '', quantidade: 0, unidade: '' });
      reRender();
    });

    window._memCaixaRemoverLinha = idx => {
      _linhas = coletarLinhas();
      _linhas.splice(parseInt(idx, 10), 1);
      reRender();
    };

    const fechar = () => { overlay.remove(); modal.remove(); };
    document.getElementById('bm-mem-caixa-fechar').addEventListener('click', fechar);
    document.getElementById('bm-mem-caixa-cancelar').addEventListener('click', fechar);
    overlay.addEventListener('click', e => { if (e.target === overlay) fechar(); });

    document.getElementById('bm-mem-caixa-salvar').addEventListener('click', () => {
      const linhasSalvas = coletarLinhas().filter(l => l.descricao || l.quantidade);
      const observacao   = (document.getElementById('bm-mem-caixa-obs')?.value || '').trim();
      const medAtual = getMedicoes(obraId, bmNum);
      medAtual[chave] = { linhas: linhasSalvas, observacao, salvaEm: new Date().toISOString() };
      salvarMedicoes(obraId, bmNum, medAtual);
      fechar();
      window.toast?.('✅ Memória de cálculo CAIXA salva.', 'ok');
    });
  }
}

export default CaixaBM;
