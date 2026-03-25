/**
 * ╔══════════════════════════════════════════════════════════════╗
 * ║  FISCAL NA OBRA v15.1 — modules/boletim-medicao/bm-ui.js     ║
 * ║  Interface do Boletim de Medição                            ║
 * ║  ATUALIZADO: renderBoletim idêntico ao v12 (20 colunas,    ║
 * ║  hierarquia G/SG/MACRO, bm-infos, modo de cálculo, saldo)  ║
 * ╚══════════════════════════════════════════════════════════════╝
 */

import state      from '../../core/state.js';
import { formatters } from '../../utils/formatters.js';
import { guardFocus } from '../../utils/dom-patcher.js';
import {
  getMedicoes,
  getLinhasItem,
  getFxFormula,
  sumLinhasQtd,
  getValorAcumuladoTotal,
  getValorAcumuladoAnterior,
  getValorMedicaoAtual,
  getQtdAcumuladoAnteriorItem,
  getQtdAcumuladoTotalItem,
  getQtdMedicaoItemNoBm,
  getBdiEfetivo,
} from './bm-calculos.js';

// Soma o valor total contratado dos itens (qtd × upBdi).
// Usado como fallback quando cfg.valor não está configurado.
function _calcTotalContratado(itens, cfg) {
  const rnd2 = v => Math.round(v * 100) / 100;
  let total = 0;
  itens.forEach(it => {
    if (it.t) return; // ignora agregadores
    const bdiEf = getBdiEfetivo(it, cfg);
    const upBdi = it.upBdi ? it.upBdi : rnd2((it.up || 0) * (1 + bdiEf));
    total += rnd2((it.qtd || 0) * upBdi);
  });
  return Math.round(total * 100) / 100;
}

export class BoletimUI {

  injectPage() {
    const container = document.getElementById('boletim');
    if (!container) return;
    this._injectSelects();
  }

  _injectSelects() {
    const bms = state.get('bms') || [];
    ['sel-bol-bm', 'sel-mem-bm', 'sel-rel-bm'].forEach(id => {
      const el = document.getElementById(id);
      if (!el) return;
      el.innerHTML = bms.map(b =>
        `<option value="${b.num}">${b.label} — ${b.mes}</option>`
      ).join('');
    });
  }

  render(ctx) {
    try {
      this._renderBoletim(ctx);
    } catch (e) {
      console.error('[BoletimUI] render:', e);
    }
  }

  // ── Helpers de formatação (iguais ao v12) ───────────────────
  _fmt(cfg) {
    const mode = cfg?.modoCalculo || 'truncar';
    // CORREÇÃO FLOATING-POINT: Math.trunc direto em JS causa erro em produtos
    // como 63.16 * 1.25 = 78.94999999999999 → trunca para 78.94 (errado).
    // Normalizar com round(...* 1e9)/1e9 antes de truncar corrige o erro.
    const _safe = (v, decimals = 2) => {
      const f = Math.pow(10, decimals);
      if (mode === 'truncar') return Math.trunc(Math.round(v * f * 100) / 100) / f;
      return Math.round(v * f) / f;
    };
    return {
      R$:     v => formatters.currency(v),
      n4:     v => formatters.n4(v),
      n2:     v => {
        const num = parseFloat(v || 0);
        return _safe(num).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
      },
      pct:    v => formatters.percent(v),
      fmtNum: v => _safe(parseFloat(v) || 0),
    };
  }

  // ═══════════════════════════════════════════════════════════════
  // _renderBoletim — portado fiel do v12 renderBoletim()
  // 20 colunas, hierarquia completa G/SG/MACRO, bm-infos, saldo
  // ═══════════════════════════════════════════════════════════════
  _renderBoletim({ bms, cfg, obraId, itens }) {
    const sel = document.getElementById('sel-bol-bm');
    if (!sel) return;
    const bmNum = parseInt(sel.value) || 1;
    const bm    = bms.find(b => b.num === bmNum) || bms[0];
    if (!bm) return;

    const med   = getMedicoes(obraId, bmNum);
    const salva = !!(med && med._salva); // true = documento bloqueado para edição

    const { R$, n4, n2, pct, fmtNum } = this._fmt(cfg);

    // KPIs do cabeçalho (bm-infos)
    // Calcula o total contratado percorrendo os itens com a mesma lógica da tabela
    // para garantir que o card "Valor Total Contratual" sempre bata com o TOTAL GERAL
    let _gContCards = 0;
    itens.forEach(it => {
      if (it.t) return; // ignora agregadores
      if (itens.some(x => x.id !== it.id && it.id.startsWith(x.id + '.'))) return; // ignora filhos de grupos
      const _upBdi = fmtNum((it.up || 0) * (1 + getBdiEfetivo(it, cfg)));
      _gContCards += Math.round(fmtNum((it.qtd || 0) * _upBdi) * 100);
    });
    const vContratual = (cfg.valor && cfg.valor > 0) ? cfg.valor : Math.round(_gContCards) / 100;
    const vAcumAnt  = getValorAcumuladoAnterior(obraId, bmNum, itens, cfg);
    const vAcumTot  = getValorAcumuladoTotal(obraId, bmNum, itens, cfg);
    const vMedAtual = vAcumTot - vAcumAnt;
    const saldo     = vContratual - vAcumTot;

    // Assinaturas
    const setEl = (id, v) => { const el = document.getElementById(id); if (el) el.textContent = v || ''; };
    setEl('sig-fiscal-bol',     cfg.fiscal      || 'FISCAL DO CONTRATO');
    setEl('sig-crea-bol',       cfg.creaFiscal  || '');
    setEl('sig-contratada-bol', cfg.contratada  || 'RESPONSÁVEL TÉCNICO');
    setEl('sig-cnpj-bol',       'CNPJ: ' + (cfg.cnpj || ''));
    setEl('sig-contratante-bol',cfg.contratante || 'CONTRATANTE');

    // Info boxes
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
        <div class="bm-info-box"><div class="bm-info-label">Valor Total Contratual</div><div class="bm-info-val">${R$(vContratual)}</div></div>
        <div class="bm-info-box"><div class="bm-info-label">Acumulado Anterior</div><div class="bm-info-val">${R$(vAcumAnt)}</div></div>
        <div class="bm-info-box bm-info-medatual"><div class="bm-info-label">Medição Atual</div>
          <div class="bm-info-val" style="color:${vMedAtual < 0 ? '#8B3A2A' : '#1A5E3A'}">${R$(vMedAtual)}</div></div>
        <div class="bm-info-box"><div class="bm-info-label">Acumulado Total</div><div class="bm-info-val">${R$(vAcumTot)}</div></div>
        <div class="bm-info-box bm-info-saldo"><div class="bm-info-label">Saldo a Executar</div><div class="bm-info-val">${R$(saldo)}</div></div>
        <div class="bm-info-box" style="min-width:160px;border-left:3px solid ${pgPago?'#16a34a':'#d97706'}">
          <div class="bm-info-label">💳 Nº Empenho</div>
          <input id="bm-pag-empenho" value="${pgEmpenho}" placeholder="—"
            style="font-size:12px;font-family:var(--font-mono);border:none;background:transparent;color:var(--text-primary);width:100%;padding:0;outline:none"
            onchange="window._bmSalvarPagamento?.(${bmNum})">
        </div>
        <div class="bm-info-box" style="min-width:140px">
          <div class="bm-info-label">🧾 Nota Fiscal</div>
          <input id="bm-pag-nf" value="${pgNF}" placeholder="—"
            style="font-size:12px;font-family:var(--font-mono);border:none;background:transparent;color:var(--text-primary);width:100%;padding:0;outline:none"
            onchange="window._bmSalvarPagamento?.(${bmNum})">
        </div>
        <div class="bm-info-box" style="min-width:130px">
          <div class="bm-info-label">📅 Data Pagamento</div>
          <input id="bm-pag-data" type="date" value="${pgDataPag}"
            style="font-size:11px;border:none;background:transparent;color:var(--text-primary);width:100%;padding:0;outline:none"
            onchange="window._bmSalvarPagamento?.(${bmNum})">
        </div>
        <div class="bm-info-box" style="min-width:100px;border-left:3px solid ${pgPago?'#16a34a':'#e5e7eb'}">
          <div class="bm-info-label">Pagamento</div>
          <label style="display:flex;align-items:center;gap:5px;cursor:pointer;margin-top:4px">
            <input type="checkbox" id="bm-pag-pago" ${pgPago?'checked':''} style="width:14px;height:14px"
              onchange="window._bmSalvarPagamento?.(${bmNum})">
            <span style="font-size:11px;font-weight:700;color:${pgPago?'#16a34a':'#d97706'}">${pgPago?'✅ Pago':'⏳ Pendente'}</span>
          </label>
        </div>
        <div class="bm-info-box" style="justify-content:flex-start;align-items:flex-start">
          <div class="bm-info-label">Modo de Cálculo</div>
          <div style="margin-top:5px">
            ${(cfg.modoCalculo || 'truncar') === 'truncar'
              ? `<span style="display:inline-flex;align-items:center;gap:4px;font-size:10px;font-weight:700;padding:3px 9px;border-radius:3px;background:#FFF7ED;color:#C05A08;border:1px solid rgba(249,115,22,.3);text-transform:uppercase;letter-spacing:.5px">✂️ Truncar</span>
                 <div style="font-size:9px;color:#555555;margin-top:3px;font-weight:600">⚖️ Padrão TCU</div>`
              : `<span style="display:inline-flex;align-items:center;gap:4px;font-size:10px;font-weight:700;padding:3px 9px;border-radius:3px;background:#EFF6FF;color:#333333;border:1px solid rgba(37,99,235,.2);text-transform:uppercase;letter-spacing:.5px">🔢 Arredondar</span>`
            }
          </div>
        </div>`;
    }

    // ── Helpers hierárquicos ─────────────────────────────────────
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

    const _temQualquerPai = id =>
      itens.some(x => x.id !== id && id.startsWith(x.id + '.'));

    // Agrega valores de um MACRO somando apenas filhos diretos (v63: fmtNum)
    const _valMacro = (macroId) => {
      let tCont = 0, tAnt = 0, tAtual = 0, tAcum = 0, tSaldo = 0;
      itens.forEach(sub => {
        if (!_filhoDireto(macroId, sub.id)) return;
        if (sub.t === 'G' || sub.t === 'SG') return;
        if (sub.t === 'MACRO') {
          const v = _valMacro(sub.id);
          tCont += v.tCont; tAnt += v.tAnt; tAtual += v.tAtual;
          tAcum += v.tAcum; tSaldo += v.tSaldo;
        } else {
          const upBdi = fmtNum((sub.up || 0) * (1 + (cfg.bdi || 0)));
          const tC    = fmtNum((sub.qtd || 0) * upBdi);
          const qAnt  = getQtdAcumuladoAnteriorItem(obraId, bmNum, sub.id, itens);
          const tAn   = fmtNum(qAnt * upBdi);
          const qAcum = getQtdAcumuladoTotalItem(obraId, bmNum, sub.id, itens);
          const tAc   = fmtNum(qAcum * upBdi);
          const tAt   = fmtNum(tAc - tAn);
          tCont += tC; tAnt += tAn; tAtual += tAt;
          tAcum += tAc; tSaldo += fmtNum(tC - tAc);
        }
      });
      return { tCont, tAnt, tAtual, tAcum, tSaldo };
    };

    // Agrega valores de um Grupo G (todos os descendentes, exceto sub-MACROs já agrupados)
    const _valMacroG = (grupoId) => {
      let tCont = 0, tAnt = 0, tAtual = 0, tAcum = 0, tSaldo = 0;
      const prefix = grupoId + '.';
      itens.forEach(sub => {
        if (!sub.id.startsWith(prefix)) return;
        if (sub.t === 'G' || sub.t === 'SG') return;
        if (sub.t === 'MACRO') {
          if (_filhoDireto(grupoId, sub.id)) {
            const v = _valMacro(sub.id);
            tCont += v.tCont; tAnt += v.tAnt; tAtual += v.tAtual;
            tAcum += v.tAcum; tSaldo += v.tSaldo;
          }
          return;
        }
        if (_temMacroPai(sub.id)) return;
        const upBdi = fmtNum((sub.up || 0) * (1 + (cfg.bdi || 0)));
        const tC    = fmtNum((sub.qtd || 0) * upBdi);
        const qAnt  = getQtdAcumuladoAnteriorItem(obraId, bmNum, sub.id, itens);
        const tAn   = fmtNum(qAnt * upBdi);
        const qAcum = getQtdAcumuladoTotalItem(obraId, bmNum, sub.id, itens);
        const tAc   = fmtNum(qAcum * upBdi);
        const tAt   = fmtNum(tAc - tAn);
        tCont += tC; tAnt += tAn; tAtual += tAt;
        tAcum += tAc; tSaldo += fmtNum(tC - tAc);
      });
      return { tCont, tAnt, tAtual, tAcum, tSaldo };
    };

    // ── Totalizadores gerais — acumulação em centavos inteiros (evita erro IEEE 754) ──
    let _gContC = 0, _gAntC = 0, _gAtualC = 0, _gAcumC = 0, _gSaldoC = 0;

    // ── Detecta padrão CAIXA (mesma lógica do controller._isCaixa) ──
    const _padrao = (
      cfg.tipoObra   ||
      cfg.padrao     ||
      cfg.tipoPadrao ||
      cfg.padraoObra ||
      ''
    ).toLowerCase();
    const isCaixa = _padrao === 'caixa';

    // ── Gera linhas da tabela ────────────────────────────────────
    let html = `<table>
    <colgroup>
      <col class="c-acoes"><col class="c-item"><col class="c-cod"><col class="c-desc"><col class="c-und">
      <col class="c-qtdc"><col class="c-vunit"><col class="c-vunitbdi"><col class="c-totcont">
      <col class="c-antpct"><col class="c-antqtd"><col class="c-anttot">
      <col class="c-medqtd"><col class="c-medtot"><col class="c-medpct">
      <col class="c-acqtd"><col class="c-actot"><col class="c-acpct">
      <col class="c-saldoqtd"><col class="c-saldotot">
      ${isCaixa ? '<col class="c-caixa-pct">' : ''}
    </colgroup>
    <thead>
      <tr>
        <th rowspan="2" style="text-align:center;background:#f3f4f6">Ações</th>
        <th rowspan="2">Item</th>
        <th rowspan="2">Código</th>
        <th rowspan="2" style="text-align:left">Descrição dos Serviços</th>
        <th rowspan="2" style="text-align:center">Und</th>
        <th colspan="4" style="text-align:center" class="th-contratual">Contratual</th>
        <th colspan="3" style="text-align:center" class="th-anterior">Acum. Anterior</th>
        <th colspan="3" style="text-align:center" class="th-medicao">Medição Atual</th>
        <th colspan="3" style="text-align:center" class="th-acumulado">Acumulado Total</th>
        <th colspan="2" style="text-align:center" class="th-saldo">Saldo</th>
        ${isCaixa ? '<th rowspan="2" style="text-align:center;background:#fffbeb;color:#92400e;border:1px solid #f59e0b;white-space:nowrap;font-size:10px">% Exec. Total<br><span style="font-size:9px;font-weight:400">(CAIXA)</span></th>' : ''}
      </tr>
      <tr>
        <th style="text-align:right" class="th-contratual">Qtd</th>
        <th style="text-align:right" class="th-contratual">V.Unit.</th>
        <th style="text-align:right" class="th-contratual">V.Unit+BDI</th>
        <th style="text-align:right" class="th-contratual">Tot.Cont.</th>
        <th style="text-align:right" class="th-anterior">%</th>
        <th style="text-align:right" class="th-anterior">Qtd</th>
        <th style="text-align:right" class="th-anterior">Total</th>
        <th style="text-align:right" class="th-medicao">Qtd</th>
        <th style="text-align:right" class="th-medicao">% Executado</th>
        <th style="text-align:right" class="th-medicao">Total</th>
        <th style="text-align:right" class="th-acumulado">Qtd</th>
        <th style="text-align:right" class="th-acumulado">Total</th>
        <th style="text-align:right" class="th-acumulado">%</th>
        <th style="text-align:right" class="th-saldo">Qtd</th>
        <th style="text-align:right" class="th-saldo">Total</th>
      </tr>
    </thead><tbody>`;

    itens.forEach(it => {
      // ── GRUPO G ────────────────────────────────────────────────
      if (it.t === 'G') {
        const v    = _valMacroG(it.id);
        const pAcum = v.tCont > 0 ? (v.tAcum / v.tCont * 100) : 0;
        const pAtu  = v.tCont > 0 ? (v.tAtual / v.tCont * 100) : 0;
        const corAtu = v.tAtual < 0 ? '#fca5a5' : v.tAtual > 0 ? '#86efac' : '#94a3b8';
        if (!_temQualquerPai(it.id)) {
          _gContC  += Math.round(v.tCont  * 100);
          _gAntC   += Math.round(v.tAnt   * 100);
          _gAtualC += Math.round(v.tAtual * 100);
          _gAcumC  += Math.round(v.tAcum  * 100);
          _gSaldoC += Math.round(v.tSaldo * 100);
        }
        // ALT1: Lê obs/ajuste manual armazenado nas medições
        const grpMeta = med[`_obs_${it.id}`] || {};
        const obsTag  = grpMeta.obs
          ? `<span style="font-size:9px;background:#fffbeb;color:#713f12;border:1px solid #fde68a;border-radius:3px;padding:1px 6px;margin-left:8px" title="Observação do item agregador">📝 ${grpMeta.obs.slice(0, 50)}${grpMeta.obs.length > 50 ? '…' : ''}</span>`
          : '';
        const ajusteTag = grpMeta.ajuste != null && grpMeta.ajuste !== 0
          ? `<span style="font-size:9px;background:#f0fdf4;color:#166534;border:1px solid #86efac;border-radius:3px;padding:1px 6px;margin-left:4px" title="Ajuste manual">± ${R$(grpMeta.ajuste)}</span>`
          : '';
        html += `<tr class="linha-grupo" style="border-top:2px solid #000000;border-bottom:2px solid #000000;">
          <td style="padding:0 6px;background:#1A1A1A;width:36px;text-align:center">
            ${!salva ? `<button class="btn btn-sm" style="padding:2px 5px;font-size:9px;background:#333333;border:none;color:#94a3b8;cursor:pointer"
              title="Editar observações / ajuste do grupo"
              data-action="editarAgregadorBM" data-arg0="G" data-arg1="${it.id.replace(/'/g,"\\'")}">✏️</button>
            <button class="btn btn-sm" style="padding:2px 5px;font-size:9px;background:#7f1d1d;border:none;color:#fca5a5;cursor:pointer;margin-left:2px"
              title="Excluir grupo e todos os seus subitens"
              data-action="excluirAgregadorBM" data-arg0="${it.id.replace(/'/g,"\\'")}">🗑️</button>` : ''}\
          </td>
          <td colspan="8" style="padding:0 10px">
            <span style="font-size:11px;font-weight:700">▌ ${it.id} &nbsp; ${it.desc}</span>${obsTag}${ajusteTag}
            ${v.tCont > 0 ? `<span style="float:right;font-size:10px;font-family:var(--font-mono);font-weight:700;color:#fff;padding-right:8px">
              Contratual: ${R$(v.tCont)} &nbsp;|&nbsp; Medido: <span style="color:${corAtu}">${R$(v.tAcum)}</span>
            </span>` : ''}
          </td>
          <td></td><td></td><td></td>
          <td style="text-align:right;font-family:var(--font-mono);font-weight:700;color:${corAtu}">${v.tAtual !== 0 ? R$(v.tAtual) : '—'}</td>
          <td style="text-align:right;color:${corAtu};font-size:9.5px">${pct(pAtu)}</td>
          <td style="text-align:right;font-family:var(--font-mono);font-weight:700;color:${corAtu}">${v.tAtual !== 0 ? R$(v.tAtual) : '—'}</td>
          <td style="text-align:right;font-family:var(--font-mono);font-weight:700">${v.tAcum > 0 ? R$(v.tAcum) : '—'}</td>
          <td style="text-align:right;font-family:var(--font-mono);font-weight:700">${v.tAcum > 0 ? R$(v.tAcum) : '—'}</td>
          <td style="text-align:right;font-size:9.5px">${pct(pAcum)}</td>
          <td></td>
          <td style="text-align:right;font-family:var(--font-mono);font-weight:700;color:${v.tSaldo < 0.01 ? '#86efac' : '#fca5a5'}">${R$(v.tSaldo)}</td>
          ${isCaixa ? '<td></td>' : ''}
        </tr>`;
        return;
      }

      // ── SUBGRUPO SG ────────────────────────────────────────────
      if (it.t === 'SG') {
        // ALT1: Lê obs armazenado nas medições para subgrupo
        const sgMeta = med[`_obs_${it.id}`] || {};
        const obsTag = sgMeta.obs
          ? `<span style="font-size:9px;background:#fffbeb;color:#713f12;border:1px solid #fde68a;border-radius:3px;padding:1px 5px;margin-left:6px">📝 ${sgMeta.obs.slice(0, 50)}${sgMeta.obs.length > 50 ? '…' : ''}</span>`
          : '';
        html += `<tr class="linha-subgrupo" style="border-top:1px solid #000000;border-bottom:1px solid #000000;">
          <td style="padding:0 6px;width:36px;text-align:center">
            ${!salva ? `<button class="btn btn-sm" style="padding:2px 5px;font-size:9px;background:#475569;border:none;color:#94a3b8;cursor:pointer"
              title="Editar observações do subgrupo"
              data-action="editarAgregadorBM" data-arg0="SG" data-arg1="${it.id.replace(/'/g,"\\'")}">✏️</button>
            <button class="btn btn-sm" style="padding:2px 5px;font-size:9px;background:#7f1d1d;border:none;color:#fca5a5;cursor:pointer;margin-left:2px"
              title="Excluir subgrupo e todos os seus subitens"
              data-action="excluirAgregadorBM" data-arg0="${it.id.replace(/'/g,"\\'")}">🗑️</button>` : ''}\
          </td>
          <td colspan="19">&nbsp;&nbsp; ${it.id} — ${it.desc}${obsTag}</td>
          ${isCaixa ? '<td></td>' : ''}
        </tr>`;
        return;
      }

      // ── MACRO ITEM ─────────────────────────────────────────────
      if (it.t === 'MACRO') {
        const v    = _valMacro(it.id);
        const pAnt  = v.tCont > 0 ? (v.tAnt  / v.tCont * 100) : 0;
        const pAcum = v.tCont > 0 ? (v.tAcum / v.tCont * 100) : 0;
        const pAtu  = v.tCont > 0 ? (v.tAtual / v.tCont * 100) : 0;
        const corAtu = v.tAtual < 0 ? '#8B3A2A' : v.tAtual > 0 ? '#1A5E3A' : '#9ca3af';
        const indent = (it.id.split('.').length - 1) * 14;
        if (!_temQualquerPai(it.id)) {
          _gContC  += Math.round(v.tCont  * 100);
          _gAntC   += Math.round(v.tAnt   * 100);
          _gAtualC += Math.round(v.tAtual * 100);
          _gAcumC  += Math.round(v.tAcum  * 100);
          _gSaldoC += Math.round(v.tSaldo * 100);
        }
        html += `<tr class="linha-macro"
          <td class="td-c" style="white-space:nowrap;padding:3px 5px">
            ${!salva ? `<button class="btn btn-azul btn-sm" style="padding:2px 5px;font-size:9px" title="Editar" data-action="editarMacroItem" data-arg0="${it.id.replace(/'/g,"\\'")}">✏️</button>
            <button class="btn btn-laranja btn-sm" style="padding:2px 5px;font-size:9px" title="Desfazer Macro" data-action="reverterMacroItem" data-arg0="${it.id.replace(/'/g,"\\'")}">↩️</button>
            <button class="btn btn-vermelho btn-sm" style="padding:2px 5px;font-size:9px" title="Excluir" data-action="excluirMacroItem" data-arg0="${it.id.replace(/'/g,"\\'")}">🗑️</button>` : `<span style="font-size:9px;color:#6b7280" title="Bloqueado">🔒</span>`}\
          </td>
          <td class="td-c" style="font-size:9.5px;font-family:var(--font-mono)">${it.id}</td>
          <td class="td-c" style="font-size:9px">—</td>
          <td style="font-size:10.5px;padding-left:${8 + indent}px">
            <span style="font-size:8px;background:#333333;color:#fff;padding:1px 5px;border-radius:3px;margin-right:6px;font-weight:800">MACRO</span>
            <strong>${it.desc}</strong>
          </td>
          <td class="td-c">—</td>
          <td class="td-r">—</td><td class="td-r">—</td><td class="td-r">—</td>
          <td class="td-r" style="font-weight:700">${v.tCont > 0 ? R$(v.tCont) : '—'}</td>
          <td class="td-r" style="color:#6b7280">${pct(pAnt)}</td>
          <td class="td-r" style="color:#6b7280">—</td>
          <td class="td-r" style="color:#6b7280">${v.tAnt > 0 ? R$(v.tAnt) : '—'}</td>
          <td class="td-r" style="font-weight:700;color:${corAtu}">${v.tAtual !== 0 ? R$(v.tAtual) : '—'}</td>
          <td class="td-r" style="color:${corAtu}">${pct(pAtu)}</td>
          <td class="td-r" style="font-weight:700;color:${corAtu}">${v.tAtual !== 0 ? R$(v.tAtual) : '—'}</td>
          <td class="td-r" style="font-weight:700">${v.tAcum > 0 ? R$(v.tAcum) : '—'}</td>
          <td class="td-r" style="font-weight:700">${v.tAcum > 0 ? R$(v.tAcum) : '—'}</td>
          <td class="td-r" style="color:${pAcum > 0 ? '#2A4A7A' : '#8B8EA3'}">${pct(pAcum)}</td>
          <td class="td-r" style="color:#9ca3af">—</td>
          <td class="td-r" style="color:${v.tSaldo < 0.01 ? '#1A5E3A' : '#7A3A2A'};font-weight:700">${R$(v.tSaldo)}</td>
          ${isCaixa ? '<td></td>' : ''}
        </tr>`;
        return;
      }

      // ── ITEM NORMAL ────────────────────────────────────────────
      // TCU Acórdão 2.622/2013: usa BDI efetivo por tipo de item (integral/reduzido/zero)
      const upBdi   = fmtNum((it.up || 0) * (1 + getBdiEfetivo(it, cfg)));
      const totCont = fmtNum((it.qtd || 0) * upBdi);
      const qtdAnt    = getQtdAcumuladoAnteriorItem(obraId, bmNum, it.id, itens);
      const totAnt    = fmtNum(qtdAnt * upBdi);
      const pctAnt    = it.qtd > 0 ? (qtdAnt / it.qtd * 100) : 0;
      const qtdAcumRaw= getQtdAcumuladoTotalItem(obraId, bmNum, it.id, itens);
      // FIX-4: limita contabilização a 100% do item contratado
      const ultrapass4= it.qtd > 0 && qtdAcumRaw > it.qtd;
      const qtdAcum   = ultrapass4 ? it.qtd : qtdAcumRaw;
      const totAcum   = fmtNum(qtdAcum * upBdi);
      const pctAcum   = it.qtd > 0 ? (qtdAcum / it.qtd * 100) : 0;
      const qtdAtual  = Math.max(0, qtdAcum - qtdAnt);
      const totAtual  = fmtNum(totAcum - totAnt);
      const pctAtual  = it.qtd > 0 ? (qtdAtual / it.qtd * 100) : 0;
      const qtdSaldo  = (it.qtd || 0) - qtdAcum;
      const totSaldo  = fmtNum(totCont - totAcum);

      // Badge de BDI diferenciado (apenas quando aplicável — rastreabilidade TCU)
      const bdiBadge = it.tipoBdi === 'reduzido'
        ? `<span title="BDI Reduzido (TCU Acórdão 2.622/2013)" style="font-size:8px;background:#dbeafe;color:#1e40af;border:1px solid #93c5fd;border-radius:3px;padding:0 4px;margin-left:4px;font-weight:700">BDI-R</span>`
        : it.tipoBdi === 'zero'
        ? `<span title="Sem BDI — fornecimento direto" style="font-size:8px;background:#fee2e2;color:#991b1b;border:1px solid #fca5a5;border-radius:3px;padding:0 4px;margin-left:4px;font-weight:700">BDI0</span>`
        : '';

      // Badge SINAPI: alerta desvio de preço > 5% acima da referência
      const upRef = parseFloat(it.upRef) || 0;
      const sinapiBadge = (upRef > 0 && it.up > 0)
        ? (() => {
            const desvPct = ((it.up - upRef) / upRef) * 100;
            if (desvPct > 10) return `<span title="Preço ${desvPct.toFixed(1)}% acima da referência SINAPI/ORSE" style="font-size:8px;background:#fef08a;color:#78350f;border:1px solid #fde047;border-radius:3px;padding:0 4px;margin-left:3px;font-weight:700">+${desvPct.toFixed(0)}%</span>`;
            if (desvPct > 5)  return `<span title="Preço ${desvPct.toFixed(1)}% acima da referência SINAPI/ORSE" style="font-size:8px;background:#fef3c7;color:#92400e;border:1px solid #fcd34d;border-radius:3px;padding:0 4px;margin-left:3px;font-weight:700">+${desvPct.toFixed(0)}%</span>`;
            return '';
          })()
        : '';

      if (!_temQualquerPai(it.id)) {
        _gContC  += Math.round(totCont  * 100);
        _gAntC   += Math.round(totAnt   * 100);
        _gAtualC += Math.round(totAtual * 100);
        _gAcumC  += Math.round(totAcum  * 100);
        _gSaldoC += Math.round(totSaldo * 100);
      }

      // FIX-4: badge de ultrapassagem
      const badgeUltra4 = ultrapass4
        ? `<span title="⚠️ Medição ultrapassou 100% da quantidade prevista (${(qtdAcumRaw/it.qtd*100).toFixed(1)}%)" style="display:inline-block;background:#fef08a;color:#92400e;border:1px solid #d97706;border-radius:4px;font-size:8px;font-weight:700;padding:1px 5px;margin-left:4px">⚠️ +100%</span>` : '';
      const destaque = qtdAtual !== 0
        ? `style="font-weight:700;color:${qtdAtual < 0 ? '#8B3A2A' : '#1A5E3A'}"`
        : `style="color:#9ca3af"`;

      // Realce da linha inteira quando há medição atual (fundo claro fixo)
      const rowBg = qtdAtual > 0
        ? 'background:rgba(34,197,94,.10);'             // verde sutil
        : qtdAtual < 0
          ? 'background:rgba(220,38,38,.08);'           // vermelho sutil
          : '';

      const ehPersonalizado = !it.t;
      const btnAcoes = salva
        ? `<span style="font-size:9px;color:#6b7280" title="Documento bloqueado">🔒</span>`
        : ehPersonalizado
          ? `<button class="btn btn-cinza btn-sm" style="padding:2px 6px;font-size:10px" title="Editar item" data-action="abrirCrudItemBM" data-arg0="editar" data-arg1="${it.id.replace(/'/g,"\\'")}">✏️</button>
           <button class="btn btn-vermelho btn-sm" style="padding:2px 6px;font-size:10px" title="Excluir item" data-action="excluirItemBM" data-arg0="${it.id.replace(/'/g,"\\'")}">🗑️</button>`
          : `<span style="font-size:9px;color:#d1d5db">contrato</span>`;

      // IDs de célula para CAIXA live-patch (patchRow sem re-render da tabela)
      const _cid = isCaixa ? `bm-cx-${it.id.replace(/\./g,'-')}` : null;

      html += `<tr style="${rowBg}" data-item-id="${it.id}">
        <td class="td-c" style="white-space:nowrap;padding:4px 6px">${btnAcoes}</td>
        <td class="td-c" style="font-size:9.5px;font-family:var(--font-mono);color:#6b7280">${it.id}</td>
        <td class="td-c" style="font-size:9.5px;font-family:var(--font-mono);color:#2A4A7A">${it.cod || '—'}</td>
        <td style="font-size:10.5px">${it.desc}${badgeUltra4}${bdiBadge}${sinapiBadge}</td>
        <td class="td-c" style="color:#2A4A7A;font-size:10px">${it.und || '—'}</td>
        <td class="td-r" style="font-size:10.5px">${n2(it.qtd)}</td>
        <td class="td-r" style="font-size:10.5px;color:#4b5563">${R$(it.up || 0)}</td>
        <td class="td-r" style="font-size:10.5px;color:#2A4A7A">${R$(upBdi)}</td>
        <td class="td-r" style="font-size:10.5px">${R$(totCont)}</td>
        <td class="td-r" style="font-size:10.5px;color:#6b7280">${pct(pctAnt)}</td>
        <td class="td-r" style="font-size:10.5px;color:#6b7280">${n2(qtdAnt)}</td>
        <td class="td-r" style="font-size:10.5px;color:#6b7280">${totAnt > 0 ? R$(totAnt) : '—'}</td>
        <td id="${_cid ? _cid+'-qtdAt' : ''}" class="td-r" style="font-size:10.5px" ${destaque}>${n2(qtdAtual)}</td>
        <td id="${_cid ? _cid+'-pctAt' : ''}" class="td-r" style="font-size:10.5px;color:${pctAtual !== 0 ? (qtdAtual < 0 ? '#8B3A2A' : '#1A5E3A') : '#8B8EA3'}">${pct(pctAtual)}</td>
        <td id="${_cid ? _cid+'-totAt' : ''}" class="td-r" style="font-size:10.5px" ${destaque}>${totAtual !== 0 ? R$(totAtual) : '—'}</td>
        <td id="${_cid ? _cid+'-qtdAc' : ''}" class="td-r" style="font-size:10.5px">${n2(qtdAcum)}</td>
        <td id="${_cid ? _cid+'-totAc' : ''}" class="td-r" style="font-size:10.5px">${totAcum > 0 ? R$(totAcum) : '—'}</td>
        <td id="${_cid ? _cid+'-pctAc' : ''}" class="td-r" style="font-size:10.5px;color:${pctAcum > 0 ? '#2A4A7A' : '#8B8EA3'}">${pct(pctAcum)}</td>
        <td id="${_cid ? _cid+'-qtdSd' : ''}" class="td-r" style="font-size:10.5px;color:#9ca3af">${n2(qtdSaldo)}</td>
        <td id="${_cid ? _cid+'-totSd' : ''}" class="td-r" style="font-size:10.5px;color:${totSaldo < 0.01 ? '#1A5E3A' : '#7A3A2A'}">${R$(totSaldo)}</td>
        ${isCaixa ? `<td class="td-c" style="padding:2px 4px;background:#fffbeb">
          ${salva
            ? `<span style="font-size:10px;font-family:var(--font-mono);color:#92400e">${med[it.id]?._pctExec != null ? med[it.id]._pctExec.toFixed(2) + '%' : '—'}</span>`
            : `<input type="number" min="0" max="100" step="0.01"
                value="${med[it.id]?._pctExec != null ? med[it.id]._pctExec : ''}"
                placeholder="0.00"
                title="% Executado Total (CAIXA) — informe o percentual acumulado total executado"
                style="width:64px;padding:3px 5px;border-radius:5px;border:1px solid #f59e0b;
                  background:#fff;color:#92400e;font-size:11px;font-family:var(--font-mono);
                  text-align:right"
                data-action="_bmCaixaAplicarPct"
                data-arg0="${it.id.replace(/"/g,'&quot;')}"
                data-value-from="this.value">`
          }
        </td>` : ''}
      </tr>`;
    });

    // Converte centavos inteiros → reais (divisão exata, sem erro IEEE 754)
    const gCont  = _gContC  / 100;
    const gAnt   = _gAntC   / 100;
    const gAtual = _gAtualC / 100;
    const gAcum  = _gAcumC  / 100;
    const gSaldo = _gSaldoC / 100;
    const pctExecTotal = (cfg.valor || 0) > 0 ? (gAcum / cfg.valor * 100) : 0;
    const pctMedTotal  = (cfg.valor || 0) > 0 ? (gAtual / cfg.valor * 100) : 0;
    html += `</tbody>
      <tfoot>
        <tr class="linha-total">
          <td colspan="5" style="text-align:right;font-size:11px;letter-spacing:.5px">TOTAL GERAL</td>
          <td class="td-r">—</td><td class="td-r">—</td><td class="td-r">—</td>
          <td class="td-r">${R$(gCont)}</td>
          <td class="td-r">${pct(gAnt > 0 && gCont > 0 ? (gAnt / gCont * 100) : 0)}</td>
          <td class="td-r">—</td>
          <td class="td-r">${gAnt > 0 ? R$(gAnt) : '—'}</td>
          <td class="td-r">—</td>
          <td class="td-r" style="font-size:9.5px">${pct(pctMedTotal)}</td>
          <td class="td-r">${R$(gAtual)}</td>
          <td class="td-r">${R$(gAcum)}</td>
          <td class="td-r">${R$(gAcum)}</td>
          <td class="td-r">${pct(pctExecTotal)}</td>
          <td class="td-r">—</td>
          <td class="td-r">${R$(gSaldo)}</td>
          ${isCaixa ? '<td></td>' : ''}
        </tr>
      </tfoot>
    </table>`;

    const wrap = document.getElementById('bol-table-wrap');
    // P2 — guardFocus: preserva foco/cursor se usuário estiver editando
    if (wrap) guardFocus(() => { wrap.innerHTML = html; });
  }

  // ═══════════════════════════════════════════════════════════════
  // imprimirBoletim — portado fiel do v12 imprimirBoletim()
  // Abre janela de impressão A4 paisagem com tabela completa
  // ═══════════════════════════════════════════════════════════════
  imprimirBoletim({ bms, cfg, obraId, itens }, bmNum) {
    // ── Padrão CAIXA: redireciona para layout oficial CAIXA ──────
    const _pCfg = (cfg.tipoObra || cfg.padrao || cfg.tipoPadrao || cfg.padraoObra || '').toLowerCase();
    if (_pCfg === 'caixa') return this._imprimirBoletimCaixa({ bms, cfg, obraId, itens }, bmNum);

    const bm = bms.find(b => b.num === bmNum) || bms[0];
    if (!bm) return;

    const med      = getMedicoes(obraId, bmNum);
    const { R$, n4, n2, pct, fmtNum } = this._fmt(cfg);

    const vAcumAnt  = getValorAcumuladoAnterior(obraId, bmNum, itens, cfg);
    const vAcumTot  = getValorAcumuladoTotal(obraId, bmNum, itens, cfg);
    const vMedAtual = vAcumTot - vAcumAnt;
    const saldo     = (cfg.valor || 0) - vAcumTot;
    const pctMed    = cfg.valor > 0 ? (vMedAtual / cfg.valor * 100) : 0;
    const pctAcum   = cfg.valor > 0 ? (vAcumTot  / cfg.valor * 100) : 0;
    const pctSaldo  = cfg.valor > 0 ? (saldo     / cfg.valor * 100) : 0;

    // Helpers hierárquicos (mesmos do renderBoletim)
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

    const _valMacro = (macroId) => {
      let tCont = 0, tAnt = 0, tAtual = 0, tAcum = 0, tSaldo = 0;
      itens.forEach(sub => {
        if (!_filhoDireto(macroId, sub.id)) return;
        if (sub.t === 'G' || sub.t === 'SG') return;
        if (sub.t === 'MACRO') {
          const v = _valMacro(sub.id);
          tCont += v.tCont; tAnt += v.tAnt; tAtual += v.tAtual; tAcum += v.tAcum; tSaldo += v.tSaldo;
        } else {
          const upBdi = fmtNum((sub.up || 0) * (1 + (cfg.bdi || 0)));
          const tC    = fmtNum((sub.qtd || 0) * upBdi);
          const qAnt  = getQtdAcumuladoAnteriorItem(obraId, bmNum, sub.id, itens);
          const tAn   = fmtNum(qAnt * upBdi);
          const qAcum = getQtdAcumuladoTotalItem(obraId, bmNum, sub.id, itens);
          const tAc   = fmtNum(qAcum * upBdi);
          const tAt   = fmtNum(tAc - tAn);
          tCont += tC; tAnt += tAn; tAtual += tAt; tAcum += tAc; tSaldo += fmtNum(tC - tAc);
        }
      });
      return { tCont, tAnt, tAtual, tAcum, tSaldo };
    };

    const _valMacroG = (grupoId) => {
      let tCont = 0, tAnt = 0, tAtual = 0, tAcum = 0, tSaldo = 0;
      const prefix = grupoId + '.';
      itens.forEach(sub => {
        if (!sub.id.startsWith(prefix)) return;
        if (sub.t === 'G' || sub.t === 'SG') return;
        if (sub.t === 'MACRO') {
          if (_filhoDireto(grupoId, sub.id)) {
            const v = _valMacro(sub.id);
            tCont += v.tCont; tAnt += v.tAnt; tAtual += v.tAtual; tAcum += v.tAcum; tSaldo += v.tSaldo;
          }
          return;
        }
        if (_temMacroPai(sub.id)) return;
        const upBdi = fmtNum((sub.up || 0) * (1 + (cfg.bdi || 0)));
        const tC    = fmtNum((sub.qtd || 0) * upBdi);
        const qAnt  = getQtdAcumuladoAnteriorItem(obraId, bmNum, sub.id, itens);
        const tAn   = fmtNum(qAnt * upBdi);
        const qAcum = getQtdAcumuladoTotalItem(obraId, bmNum, sub.id, itens);
        const tAc   = fmtNum(qAcum * upBdi);
        const tAt   = fmtNum(tAc - tAn);
        tCont += tC; tAnt += tAn; tAtual += tAt; tAcum += tAc; tSaldo += fmtNum(tC - tAc);
      });
      return { tCont, tAnt, tAtual, tAcum, tSaldo };
    };

    // Gera linhas da tabela PDF
    let linhas = '';
    // Acumulação em centavos inteiros — evita erro de ponto flutuante binário
    let _gContC = 0, _gAntC = 0, _gAtualC = 0, _gAcumC = 0, _gSaldoC = 0;
    let linhasIdx = 0; // contador para intercalar branco/cinza nos itens normais

    // Formata percentual: 100% exato → "100%", demais → "XX,XX %"
    const fmtPct = v => {
      const n = parseFloat(v) || 0;
      if (n === 100) return '100%';
      return n.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + ' %';
    };

    itens.forEach(it => {
      if (it.t === 'G') {
        const v = _valMacroG(it.id);
        const pAnt_  = v.tCont > 0 ? (v.tAnt  / v.tCont * 100) : 0;
        const pAcum_ = v.tCont > 0 ? (v.tAcum / v.tCont * 100) : 0;
        if (!_temQualquerPai(it.id)) {
          _gContC  += Math.round(v.tCont  * 100);
          _gAntC   += Math.round(v.tAnt   * 100);
          _gAtualC += Math.round(v.tAtual * 100);
          _gAcumC  += Math.round(v.tAcum  * 100);
          _gSaldoC += Math.round(v.tSaldo * 100);
        }
        linhas += `<tr class="grupo">
          <td colspan="5" style="padding:4px 8px;font-size:8pt;font-weight:700">${it.id} &nbsp; ${it.desc}</td>
          <td class="td-r" style="font-size:7pt;color:#cbd5e1">—</td>
          <td class="td-r" style="font-size:7.5pt">${R$(v.tCont)}</td>
          <td class="td-r" style="font-size:7pt;color:#cbd5e1">${pct(pAnt_)}</td>
          <td class="td-r" style="font-size:7.5pt">${v.tAnt > 0 ? R$(v.tAnt) : 'R$ 0,00'}</td>
          <td class="td-r" style="font-size:7pt;color:#cbd5e1">—</td>
          <td class="td-r" style="font-size:7pt;color:#cbd5e1">—</td>
          <td class="td-r" style="font-size:7.5pt">${v.tAtual !== 0 ? R$(v.tAtual) : 'R$ 0,00'}</td>
          <td class="td-r" style="font-size:7pt;color:#cbd5e1">${pct(pAcum_)}</td>
          <td class="td-r" style="font-size:7.5pt">${v.tAcum > 0 ? R$(v.tAcum) : 'R$ 0,00'}</td>
          <td class="td-r" style="font-size:7.5pt;color:#fca5a5">${R$(v.tSaldo)}</td>
        </tr>`;
        return;
      }
      if (it.t === 'SG') {
        linhas += `<tr class="subgrupo"><td colspan="15" style="padding:3px 14px;font-size:7.5pt">${it.id} — ${it.desc}</td></tr>`;
        return;
      }
      if (it.t === 'MACRO') {
        const v     = _valMacro(it.id);
        const pAnt_  = v.tCont > 0 ? (v.tAnt  / v.tCont * 100) : 0;
        const pAcum_ = v.tCont > 0 ? (v.tAcum / v.tCont * 100) : 0;
        const indent = (it.id.split('.').length - 1) * 10;
        if (!_temQualquerPai(it.id)) {
          _gContC  += Math.round(v.tCont  * 100);
          _gAntC   += Math.round(v.tAnt   * 100);
          _gAtualC += Math.round(v.tAtual * 100);
          _gAcumC  += Math.round(v.tAcum  * 100);
          _gSaldoC += Math.round(v.tSaldo * 100);
        }
        linhas += `<tr class="macro-row">
          <td colspan="3" style="padding:3px 8px;padding-left:${8 + indent}px;font-size:7.5pt">
            <span style="font-size:6pt;background:#333333;color:#fff;padding:1px 4px;border-radius:2px;margin-right:4px">MACRO</span>
            <strong>${it.id}</strong> &nbsp; ${it.desc}
          </td>
          <td class="td-c" style="font-size:7.5pt">—</td>
          <td class="td-r" style="font-size:7pt">—</td>
          <td class="td-r" style="font-size:7pt">—</td>
          <td class="td-r" style="font-size:7.5pt;font-weight:700">${R$(v.tCont)}</td>
          <td class="td-r" style="font-size:7pt">${pct(pAnt_)}</td>
          <td class="td-r" style="font-size:7.5pt;font-weight:700">${v.tAnt > 0 ? R$(v.tAnt) : '—'}</td>
          <td class="td-r" style="font-size:7pt">—</td>
          <td class="td-r" style="font-size:7pt">—</td>
          <td class="td-r" style="font-size:7.5pt;font-weight:700">${v.tAtual !== 0 ? R$(v.tAtual) : '—'}</td>
          <td class="td-r" style="font-size:7pt">${pct(pAcum_)}</td>
          <td class="td-r" style="font-size:7.5pt;font-weight:700">${v.tAcum > 0 ? R$(v.tAcum) : '—'}</td>
          <td class="td-r" style="font-size:7.5pt;font-weight:700">${R$(v.tSaldo)}</td>
        </tr>`;
        return;
      }
      // Item normal
      const upBdi   = fmtNum((it.up || 0) * (1 + (cfg.bdi || 0)));
      const totCont = fmtNum((it.qtd || 0) * upBdi);
      const qtdAnt_ = getQtdAcumuladoAnteriorItem(obraId, bmNum, it.id, itens);
      const totAnt_ = fmtNum(qtdAnt_ * upBdi);
      const pctAnt_ = it.qtd > 0 ? (qtdAnt_ / it.qtd * 100) : 0;
      const qtdAcum_= getQtdAcumuladoTotalItem(obraId, bmNum, it.id, itens);
      const totAcum_= fmtNum(qtdAcum_ * upBdi);
      const pctAcum_= it.qtd > 0 ? (qtdAcum_ / it.qtd * 100) : 0;
      const qtdAtual_= qtdAcum_ - qtdAnt_;
      const totAtual_= fmtNum(totAcum_ - totAnt_);
      const totSaldo_= fmtNum(totCont - totAcum_);
      if (!_temQualquerPai(it.id)) {
        _gContC  += Math.round(totCont   * 100);
        _gAntC   += Math.round(totAnt_   * 100);
        _gAtualC += Math.round(totAtual_ * 100);
        _gAcumC  += Math.round(totAcum_  * 100);
        _gSaldoC += Math.round(totSaldo_ * 100);
      }
      const destC = totAtual_ > 0 ? 'color:#15803d;font-weight:700' : totAtual_ < 0 ? 'color:#dc2626;font-weight:700' : 'color:#9ca3af';
      const pctAtualItem = it.qtd > 0 ? (qtdAtual_ / it.qtd * 100) : 0;
      const indent = (it.id.split('.').length - 1) * 8;
      const rowBgPDF = linhasIdx % 2 === 1 ? 'background:#f3f4f6;' : '';
      linhasIdx++;
      linhas += `<tr style="${rowBgPDF}">
        <td class="td-c" style="font-size:7pt;font-family:var(--font-mono);color:#374151">${it.id}</td>
        <td class="td-c" style="font-size:7pt;font-family:var(--font-mono);color:#1e40af">${it.cod || '—'}</td>
        <td style="font-size:7.5pt;padding-left:${4 + indent}px">${it.desc}</td>
        <td class="td-c" style="font-size:7.5pt;color:#1e40af;font-weight:600">${it.und || '—'}</td>
        <td class="td-r" style="font-size:7pt;color:#374151">${it.qtd != null ? n2(it.qtd) : '—'}</td>
        <td class="td-r" style="font-size:7pt;color:#374151;font-family:var(--font-mono)">${R$(upBdi)}</td>
        <td class="td-r" style="font-size:7.5pt">${R$(totCont)}</td>
        <td class="td-r" style="font-size:7pt;color:#6b7280">${fmtPct(pctAnt_)}</td>
        <td class="td-r" style="font-size:7.5pt;color:#6b7280">${totAnt_ > 0 ? R$(totAnt_) : 'R$ 0,00'}</td>
        <td class="td-r" style="font-size:7pt;${destC}">${qtdAtual_ !== 0 ? n2(qtdAtual_) : '—'}</td>
        <td class="td-r" style="font-size:6.5pt;${destC}">${pctAtualItem > 0 ? fmtPct(pctAtualItem) : '—'}</td>
        <td class="td-r" style="font-size:7.5pt;${destC}">${totAtual_ !== 0 ? R$(totAtual_) : 'R$ 0,00'}</td>
        <td class="td-r" style="font-size:7pt;color:${pctAcum_ > 0 ? '#1e40af' : '#6b7280'}">${fmtPct(pctAcum_)}</td>
        <td class="td-r" style="font-size:7.5pt">${totAcum_ > 0 ? R$(totAcum_) : 'R$ 0,00'}</td>
        <td class="td-r" style="font-size:7.5pt;color:${totSaldo_ < 0.01 ? '#15803d' : 'inherit'}">${R$(totSaldo_)}</td>
      </tr>`;
    });

    // Converte centavos inteiros → reais para o rodapé do PDF
    const gCont  = _gContC  / 100;
    const gAnt   = _gAntC   / 100;
    const gAtual = _gAtualC / 100;
    const gAcum  = _gAcumC  / 100;
    const gSaldo = _gSaldoC / 100;

    const agora = new Date();
    const logo  = state.get('logoBase64') || '';

    const html = `
  <!-- ── Título ─────────────────────────────────────────────── -->
  <div style="text-align:center;border-bottom:2px solid #1A1A1A;padding-bottom:6px;margin-bottom:6px">
    ${logo ? `<img src="${logo}" style="height:50px;max-width:140px;object-fit:contain;float:left">` : ''}
    <div style="font-size:12pt;font-weight:800;text-transform:uppercase;letter-spacing:1px">
      BOLETIM DE MEDIÇÃO N° ${bm.label} — DATA: ${bm.data || '__/__/____'}
    </div>
    <div style="font-size:8.5pt;font-weight:700;color:#374151;margin-top:2px;text-transform:uppercase">${cfg.objeto || ''}</div>
    <div style="clear:both"></div>
  </div>

  <!-- ── Cabeçalho compacto: info contrato (esq) + resumo (dir) ── -->
  <table style="width:100%;border-collapse:collapse;margin-bottom:6px;font-size:7pt">
    <tr>
      <!-- Coluna esquerda: dados do contrato em lista simples -->
      <td style="border:1px solid #e2e8f0;padding:4px 6px;width:64%;vertical-align:top">
        <table style="width:100%;border-collapse:collapse;font-size:6.5pt">
          <tr>
            <td style="border:none;padding:1px 4px 1px 0;white-space:nowrap"><strong>OBJETO:</strong></td>
            <td style="border:none;padding:1px 4px;color:#1e40af">${cfg.objeto || '—'}</td>
          </tr>
          <tr>
            <td style="border:none;padding:1px 4px 1px 0;white-space:nowrap"><strong>CONTRATADA:</strong></td>
            <td style="border:none;padding:1px 4px;color:#1e40af">${cfg.contratada || '—'} — CNPJ N° ${cfg.cnpj || '—'}</td>
          </tr>
          <tr>
            <td style="border:none;padding:1px 4px 1px 0;white-space:nowrap"><strong>CONTRATANTE:</strong></td>
            <td style="border:none;padding:1px 4px;color:#1e40af">${cfg.contratante || '—'}</td>
          </tr>
          <tr>
            <td style="border:none;padding:1px 4px 1px 0;white-space:nowrap"><strong>CONTRATO Nº</strong></td>
            <td style="border:none;padding:1px 4px;color:#1e40af">${cfg.contrato || '—'} &nbsp;&nbsp; <strong>BDI:</strong> ${((cfg.bdi||0)*100).toFixed(2)}%</td>
          </tr>
          <tr>
            <td style="border:none;padding:1px 4px 1px 0;white-space:nowrap"><strong>DATA DA MEDIÇÃO:</strong></td>
            <td style="border:none;padding:1px 4px;color:#1e40af">${bm.data || '—'}</td>
          </tr>
        </table>
      </td>
      <!-- Coluna direita: resumo financeiro em 2 colunas por linha -->
      <td style="border:1px solid #e2e8f0;padding:4px 6px;width:36%;background:#f8fafc;vertical-align:top">
        <table style="width:100%;border-collapse:collapse;font-size:6.5pt">
          <tr><td colspan="5" style="border:none;padding:1px 4px;font-weight:800;color:#64748b;text-transform:uppercase;font-size:6pt;letter-spacing:.5px">RESUMO DO CONTRATO</td></tr>
          <tr>
            <td style="border:none;padding:1px 4px;white-space:nowrap">VALOR TOTAL:</td>
            <td style="border:none;padding:1px 4px;font-weight:700;text-align:right;font-family:monospace" colspan="2">${R$(cfg.valor||0)}</td>
            <td style="border:none;padding:1px 0px;white-space:nowrap;padding-left:8px">SALDO:</td>
            <td style="border:none;padding:1px 4px;font-weight:700;text-align:right;font-family:monospace">${R$(saldo)}</td>
          </tr>
          <tr>
            <td style="border:none;padding:1px 4px;white-space:nowrap">ACUMULADO ANTERIOR:</td>
            <td style="border:none;padding:1px 4px;font-weight:700;text-align:right;font-family:monospace">${R$(vAcumAnt)}</td>
            <td style="border:none;padding:1px 4px;text-align:right;font-family:monospace;color:#6b7280">${cfg.valor>0?fmtPct(vAcumAnt/cfg.valor*100):'—'}</td>
            <td style="border:none;padding:1px 0px;white-space:nowrap;padding-left:8px">ACUMULADO TOTAL:</td>
            <td style="border:none;padding:1px 4px;font-weight:700;text-align:right;font-family:monospace">${R$(vAcumTot)}</td>
          </tr>
          <tr style="background:#dbeafe">
            <td style="border:none;padding:1px 4px;font-weight:700;white-space:nowrap">MEDIÇÃO ATUAL:</td>
            <td style="border:none;padding:1px 4px;font-weight:700;text-align:right;font-family:monospace;color:#1e40af">${R$(vMedAtual)}</td>
            <td style="border:none;padding:1px 4px;font-weight:700;text-align:right;font-family:monospace;color:#1e40af">${fmtPct(pctMed)}</td>
            <td style="border:none;padding:1px 0px;padding-left:8px"></td>
            <td style="border:none;padding:1px 4px;text-align:right;font-family:monospace;color:#1e40af">${fmtPct(pctAcum)}</td>
          </tr>
        </table>
      </td>
    </tr>
  </table>

  <!-- ── Tabela principal ──────────────────────────────────────── -->
  <table style="table-layout:fixed;width:100%;font-size:7.5pt;border-collapse:collapse;margin-bottom:0">
    <colgroup>
      <col style="width:22px"><col style="width:32px"><col style="width:190px"><col style="width:22px">
      <col style="width:34px"><col style="width:42px"><col style="width:42px"><col style="width:26px"><col style="width:60px">
      <col style="width:28px"><col style="width:24px"><col style="width:58px">
      <col style="width:24px"><col style="width:56px"><col style="width:53px">
    </colgroup>
    <thead>
      <tr>
        <th rowspan="2" style="text-align:center;background:#1A1A1A;color:#fff;border:1px solid #333333;padding:3px 2px;font-size:6pt">ITEM</th>
        <th rowspan="2" style="text-align:center;background:#1A1A1A;color:#fff;border:1px solid #333333;padding:2px 2px;font-size:6pt">CÓD.</th>
        <th rowspan="2" style="text-align:left;background:#1A1A1A;color:#fff;border:1px solid #333333;padding:3px 6px;font-size:6.5pt">DESCRIÇÃO DOS SERVIÇOS</th>
        <th rowspan="2" style="text-align:center;background:#1A1A1A;color:#fff;border:1px solid #333333;padding:3px 2px;font-size:6pt">UN.</th>
        <th colspan="3" style="text-align:center;background:#1A1A1A;color:#fff;border:1px solid #333333;padding:3px 2px;font-size:6pt">CONTRATUAL</th>
        <th colspan="2" style="text-align:center;background:#374151;color:#fff;border:1px solid #4b5563;padding:3px 2px;font-size:6pt">ACUM. ANTERIOR</th>
        <th colspan="3" style="text-align:center;background:#14532d;color:#fff;border:1px solid #15803d;padding:3px 2px;font-size:6pt">MEDIÇÃO ATUAL</th>
        <th colspan="2" style="text-align:center;background:#2A2A2A;color:#fff;border:1px solid #333333;padding:3px 2px;font-size:6pt">ACUM. TOTAL</th>
        <th rowspan="2" style="text-align:center;background:#7f1d1d;color:#fff;border:1px solid #991b1b;padding:3px 2px;font-size:6pt">SALDO</th>
      </tr>
      <tr>
        <th style="text-align:right;background:#1A1A1A;color:#fff;border:1px solid #333333;padding:2px 3px;font-size:5.5pt">QTD.</th>
        <th style="text-align:right;background:#1A1A1A;color:#fff;border:1px solid #333333;padding:2px 3px;font-size:5.5pt">VL.UNIT c/BDI</th>
        <th style="text-align:right;background:#1A1A1A;color:#fff;border:1px solid #333333;padding:2px 3px;font-size:5.5pt">TOTAL</th>
        <th style="text-align:right;background:#374151;color:#fff;border:1px solid #4b5563;padding:2px 3px;font-size:5.5pt">%</th>
        <th style="text-align:right;background:#374151;color:#fff;border:1px solid #4b5563;padding:2px 3px;font-size:5.5pt">TOTAL</th>
        <th style="text-align:right;background:#14532d;color:#fff;border:1px solid #15803d;padding:2px 3px;font-size:5.5pt">QTD.</th>
        <th style="text-align:right;background:#14532d;color:#fff;border:1px solid #15803d;padding:2px 3px;font-size:5.5pt">%</th>
        <th style="text-align:right;background:#14532d;color:#fff;border:1px solid #15803d;padding:2px 3px;font-size:5.5pt">TOTAL</th>
        <th style="text-align:right;background:#2A2A2A;color:#fff;border:1px solid #333333;padding:2px 3px;font-size:5.5pt">%</th>
        <th style="text-align:right;background:#2A2A2A;color:#fff;border:1px solid #333333;padding:2px 3px;font-size:5.5pt">TOTAL</th>
      </tr>
    </thead>
    <tbody>${linhas}</tbody>
    <tfoot>
      <tr style="background:#1A1A1A;color:#fff;font-weight:700">
        <td colspan="4" style="text-align:right;padding:4px 8px;font-size:8pt;border:1px solid #333333">TOTAL GERAL</td>
        <td class="td-r" style="border:1px solid #333333;font-size:7pt;color:#cbd5e1">—</td>
        <td class="td-r" style="border:1px solid #333333;font-size:7pt;color:#cbd5e1">—</td>
        <td class="td-r" style="border:1px solid #333333;font-family:var(--font-mono);color:#fff;font-size:7.5pt">${R$(gCont)}</td>
        <td class="td-r" style="border:1px solid #333333;font-size:7pt;color:#cbd5e1">${cfg.valor > 0 ? fmtPct(gAnt / gCont * 100) : '—'}</td>
        <td class="td-r" style="border:1px solid #333333;font-family:var(--font-mono);color:#fff;font-size:7.5pt">${R$(gAnt)}</td>
        <td class="td-r" style="border:1px solid #333333;font-size:7pt;color:#86efac">${gAtual !== 0 ? n2(gAtual) : '—'}</td>
        <td colspan="2" style="text-align:center;border:1px solid #14532d;background:rgba(20,83,45,0.6);color:#86efac;font-size:7.5pt;font-weight:800;letter-spacing:.5px;white-space:nowrap">${fmtPct(pctMed)}</td>
        <td class="td-r" style="border:1px solid #333333;font-size:7pt;color:#93c5fd">${fmtPct(pctAcum)}</td>
        <td class="td-r" style="border:1px solid #333333;font-family:var(--font-mono);color:#fff;font-size:7.5pt">${R$(gAcum)}</td>
        <td class="td-r" style="border:1px solid #333333;font-family:var(--font-mono);color:#fca5a5;font-size:7.5pt">${R$(gSaldo)}</td>
      </tr>
    </tfoot>
  </table>
  <!-- "TOTAL EXECUTADO" fora do tfoot para aparecer só na última página -->
  <div style="background:#14532d;color:#fff;font-weight:800;text-align:center;padding:5px 10px;font-size:9pt;letter-spacing:1px;margin-bottom:4px">
    TOTAL EXECUTADO DA OBRA: ${fmtPct(pctAcum)}
  </div>

  <div style="display:grid;grid-template-columns:1fr 1fr;gap:40px;margin-top:35mm;padding:0 20px">
    <div style="border-top:1px solid #000;padding-top:6px;text-align:center">
      <div style="font-weight:700;font-size:9pt">${cfg.fiscal || cfg.contratada || '______________________'}</div>
      <div style="font-size:7.5pt;color:#555">${cfg.creaFiscal || ''}</div>
      <div style="font-size:8pt;font-weight:600;margin-top:2px">FISCAL DO CONTRATO</div>
      <div style="font-size:7pt;color:#555;margin-top:2px">Data: ___/___/______</div>
    </div>
    <div style="border-top:1px solid #000;padding-top:6px;text-align:center">
      <div style="font-weight:700;font-size:9pt">${cfg.contratante || '______________________'}</div>
      <div style="font-size:8pt;font-weight:600;margin-top:2px">CONTRATANTE / GESTOR</div>
      <div style="font-size:7pt;color:#555;margin-top:2px">Data: ___/___/______</div>
    </div>
  </div>
  <div style="text-align:center;font-size:6pt;color:#9ca3af;margin-top:8px;border-top:1px solid #eee;padding-top:4px">
    Emitido em ${agora.toLocaleDateString('pt-BR')} às ${agora.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })} — Fiscal na Obra · beta teste
  </div>`;

    const cssExtra = `
      .grupo td  { background:#1A1A1A!important; color:#fff!important; font-weight:700; }
      .subgrupo td { background:#333333!important; color:#e2e8f0!important; font-weight:600; }
      .macro-row td { background:#1A1A1A!important; color:#f5f5f5!important; font-weight:700; border-bottom:1px solid #333333; }
      .td-r { text-align:right; font-family:var(--font-mono); white-space:nowrap; }
      .td-c { text-align:center; }
    `;

    const w = window.open('', '_blank', 'width=1400,height=900');
    w.document.write(`<!DOCTYPE html>
<html lang="pt-BR"><head>
<meta charset="UTF-8">
<title>BOLETIM DE MEDIÇÃO ${bm.label}</title>
<style>
  *{box-sizing:border-box;margin:0;padding:0}
  body{font-family:'DM Sans',system-ui,sans-serif;font-size:8pt;color:#000;background:#fff;padding:6mm 8mm}
  table{border-collapse:collapse;font-size:7.5pt;font-family:'DM Sans',system-ui,sans-serif}
  th{padding:3px 5px;font-size:6.5pt;text-align:left;white-space:nowrap;font-family:'DM Sans',system-ui,sans-serif}
  td{padding:2px 4px;border:1px solid #d1d5db;vertical-align:middle;font-size:7.5pt}
  ${cssExtra}
  @page{size:A4 landscape;margin:6mm 8mm}
  @media print{
    *{-webkit-print-color-adjust:exact!important;print-color-adjust:exact!important}
    body{padding:0}
    thead{display:table-header-group}
    tr{page-break-inside:avoid}
  }
</style>
</head><body>
${html}
<script>window.onload=function(){window.print();window.onafterprint=function(){window.close();};};<\/script>
</body></html>`);
    w.document.close();
  }

  // ═══════════════════════════════════════════════════════════════
  // _imprimirBoletimCaixa — Layout oficial CAIXA (portaria 37.587)
  // Gerado apenas quando cfg.tipoObra === 'caixa'
  // ═══════════════════════════════════════════════════════════════
  _imprimirBoletimCaixa({ bms, cfg, obraId, itens }, bmNum) {
    const bm = bms.find(b => b.num === bmNum) || bms[0];
    if (!bm) return;

    const med = getMedicoes(obraId, bmNum);
    const { R$, n2, fmtNum } = this._fmt(cfg);

    // ── Formatadores CNPJ e CREA ─────────────────────────────────
    const fmtCNPJ = v => {
      const d = String(v || '').replace(/\D/g, '');
      if (d.length !== 14) return v || '—';
      return `${d.slice(0,2)}.${d.slice(2,5)}.${d.slice(5,8)}/${d.slice(8,12)}-${d.slice(12,14)}`;
    };
    const fmtCREA = v => {
      const s = String(v || '');
      if (!s.trim()) return '—';
      const m = s.match(/^([\s\S]*?)(\d+)$/);
      if (!m) return s;
      const prefix = m[1];
      const digits = m[2].replace(/\D/g, '');
      if (digits.length === 10) return prefix + `${digits.slice(0,3)}.${digits.slice(3,6)}.${digits.slice(6,9)}-${digits.slice(9)}`;
      if (digits.length === 9)  return prefix + `${digits.slice(0,3)}.${digits.slice(3,6)}.${digits.slice(6,8)}-${digits.slice(8)}`;
      return s;
    };

    // ── Cálculos financeiros ──────────────────────────────────────
    const vAcumAnt  = getValorAcumuladoAnterior(obraId, bmNum, itens, cfg);
    const vAcumTot  = getValorAcumuladoTotal(obraId, bmNum, itens, cfg);
    const vMedAtual = vAcumTot - vAcumAnt;
    const pctAcum   = cfg.valor > 0 ? (vAcumTot  / cfg.valor * 100) : 0;
    const pctMed    = cfg.valor > 0 ? (vMedAtual / cfg.valor * 100) : 0;
    const pctAnt    = cfg.valor > 0 ? (vAcumAnt  / cfg.valor * 100) : 0;

    // ── Helpers hierárquicos ──────────────────────────────────────
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

    const _valMacro = macroId => {
      let tCont = 0, tAnt = 0, tAtual = 0, tAcum = 0;
      itens.forEach(sub => {
        if (!_filhoDireto(macroId, sub.id)) return;
        if (sub.t === 'G' || sub.t === 'SG') return;
        if (sub.t === 'MACRO') {
          const v = _valMacro(sub.id);
          tCont += v.tCont; tAnt += v.tAnt; tAtual += v.tAtual; tAcum += v.tAcum;
        } else {
          const upBdi = fmtNum((sub.up || 0) * (1 + (cfg.bdi || 0)));
          const tC    = fmtNum((sub.qtd || 0) * upBdi);
          const qAnt  = getQtdAcumuladoAnteriorItem(obraId, bmNum, sub.id, itens);
          const tAn   = fmtNum(qAnt * upBdi);
          const qAcum = getQtdAcumuladoTotalItem(obraId, bmNum, sub.id, itens);
          const tAc   = fmtNum(qAcum * upBdi);
          tCont += tC; tAnt += tAn; tAtual += fmtNum(tAc - tAn); tAcum += tAc;
        }
      });
      return { tCont, tAnt, tAtual, tAcum };
    };

    const _valMacroG = grupoId => {
      let tCont = 0, tAnt = 0, tAtual = 0, tAcum = 0;
      const prefix = grupoId + '.';
      itens.forEach(sub => {
        if (!sub.id.startsWith(prefix)) return;
        if (sub.t === 'G' || sub.t === 'SG') return;
        if (sub.t === 'MACRO') {
          if (_filhoDireto(grupoId, sub.id)) {
            const v = _valMacro(sub.id);
            tCont += v.tCont; tAnt += v.tAnt; tAtual += v.tAtual; tAcum += v.tAcum;
          }
          return;
        }
        if (_temMacroPai(sub.id)) return;
        const upBdi = fmtNum((sub.up || 0) * (1 + (cfg.bdi || 0)));
        const tC    = fmtNum((sub.qtd || 0) * upBdi);
        const qAnt  = getQtdAcumuladoAnteriorItem(obraId, bmNum, sub.id, itens);
        const tAn   = fmtNum(qAnt * upBdi);
        const qAcum = getQtdAcumuladoTotalItem(obraId, bmNum, sub.id, itens);
        const tAc   = fmtNum(qAcum * upBdi);
        tCont += tC; tAnt += tAn; tAtual += fmtNum(tAc - tAn); tAcum += tAc;
      });
      return { tCont, tAnt, tAtual, tAcum };
    };

    // ── Helpers de célula ─────────────────────────────────────────
    const B  = (v, st = '') => `<td style="padding:2px 4px;border:1px solid #b0b0b0;font-size:6.5pt;${st}">${v}</td>`;
    const Br = (v, st = '') => B(v, `text-align:right;font-family:monospace;white-space:nowrap;${st}`);
    const Bc = (v, st = '') => B(v, `text-align:center;${st}`);
    const Dash = (st = '') => Bc('—', `color:#aaa;${st}`);
    const fp = v => v !== 0 ? v.toFixed(2).replace('.', ',') : '—';
    // rnd2: arredondamento monetário consistente com bm-caixa.js (sempre arredonda, nunca trunca)
    const rnd2pdf = v => Math.round(v * 100) / 100;

    // ── Geração das linhas ────────────────────────────────────────
    let linhas = '';
    let gCont  = 0;

    itens.forEach(it => {
      if (it.t === 'G') {
        const v = _valMacroG(it.id);
        // G é agregador — seus filhos já serão somados individualmente como itens normais
        linhas += `<tr style="background:#e5e5e5">
          <td colspan="2" style="padding:3px 8px;border:1px solid #b0b0b0;font-size:7pt;font-weight:800">${it.id} &nbsp; ${it.desc}</td>
          ${Dash()}${Dash()}${Dash()}
          ${Br(R$(v.tCont), 'font-weight:800')}
          ${Dash()}${Dash()}${Dash()}
          ${Br(v.tAnt > 0 ? R$(v.tAnt) : '—')}
          ${Br(v.tAtual !== 0 ? R$(v.tAtual) : '—')}
          ${Br(v.tAcum > 0 ? R$(v.tAcum) : '—')}
        </tr>`;
        return;
      }
      if (it.t === 'SG') {
        const v = _valMacroG(it.id);
        linhas += `<tr style="background:#efefef">
          <td colspan="2" style="padding:2px 14px;border:1px solid #b0b0b0;font-size:6.5pt;font-weight:700">${it.id} — ${it.desc}</td>
          ${Dash()}${Dash()}${Dash()}
          ${Br(R$(v.tCont))}
          ${Dash()}${Dash()}${Dash()}
          ${Br(v.tAnt > 0 ? R$(v.tAnt) : '—')}
          ${Br(v.tAtual !== 0 ? R$(v.tAtual) : '—')}
          ${Br(v.tAcum > 0 ? R$(v.tAcum) : '—')}
        </tr>`;
        return;
      }
      if (it.t === 'MACRO') {
        const v = _valMacro(it.id);
        // MACRO é agregador — seus filhos já serão somados individualmente como itens normais
        linhas += `<tr style="background:#e5e5e5">
          <td colspan="2" style="padding:2px 8px;border:1px solid #b0b0b0;font-size:6.5pt;font-weight:800">
            <span style="font-size:5.5pt;background:#444;color:#fff;padding:1px 3px;border-radius:2px;margin-right:4px">MACRO</span>
            ${it.id} &nbsp; ${it.desc}
          </td>
          ${Dash()}${Dash()}${Dash()}
          ${Br(R$(v.tCont), 'font-weight:800')}
          ${Dash()}${Dash()}${Dash()}
          ${Br(v.tAnt > 0 ? R$(v.tAnt) : '—')}
          ${Br(v.tAtual !== 0 ? R$(v.tAtual) : '—')}
          ${Br(v.tAcum > 0 ? R$(v.tAcum) : '—')}
        </tr>`;
        return;
      }
      // Item normal
      // CORREÇÃO: usa it.upBdi (pré-calculado) quando disponível, ou rnd2+getBdiEfetivo
      // — idêntico a bm-caixa.js — para que PDF e tela exibam os mesmos valores unitários.
      const upBdi    = it.upBdi ? it.upBdi : rnd2pdf((it.up || 0) * (1 + getBdiEfetivo(it, cfg)));
      const totCont  = rnd2pdf((it.qtd || 0) * upBdi);
      const qtdAnt_  = getQtdAcumuladoAnteriorItem(obraId, bmNum, it.id, itens);
      const totAnt_  = rnd2pdf(qtdAnt_ * upBdi);
      const pctAnt_  = it.qtd > 0 ? (qtdAnt_ / it.qtd * 100) : 0;
      const qtdAcum_ = getQtdAcumuladoTotalItem(obraId, bmNum, it.id, itens);
      const totAcum_ = rnd2pdf(qtdAcum_ * upBdi);
      const pctAcum_ = it.qtd > 0 ? (qtdAcum_ / it.qtd * 100) : 0;
      const qtdAtual_= Math.max(0, qtdAcum_ - qtdAnt_);
      const totAtual_= rnd2pdf(qtdAtual_ * upBdi);
      const pctAtual_= it.qtd > 0 ? (qtdAtual_ / it.qtd * 100) : 0;
      // CORREÇÃO: soma TODOS os itens folha ao total geral, independente de hierarquia
      // (idêntico ao comportamento de bm-caixa.js e getValorAcumuladoTotal)
      gCont += totCont;
      const rowBg = '';
      const indent = (it.id.split('.').length - 1) * 8;
      linhas += `<tr style="${rowBg}">
        ${B(it.id, 'text-align:center;font-family:monospace;white-space:nowrap;font-size:6pt')}
        ${B(it.desc, `padding-left:${4 + indent}px;font-size:6.5pt`)}
        ${Bc(it.und || '—', 'font-size:6.5pt')}
        ${Br(it.qtd != null ? n2(it.qtd) : '—', 'font-size:6.5pt')}
        ${Br(R$(upBdi), 'font-size:6.5pt')}
        ${Br(R$(totCont), 'font-size:6.5pt')}
        ${Br(fp(pctAnt_), 'font-size:6.5pt')}
        ${Br(fp(pctAtual_), 'font-size:6.5pt')}
        ${Br(fp(pctAcum_), 'font-size:6.5pt')}
        ${Br(totAnt_ > 0 ? R$(totAnt_) : '—', 'font-size:6.5pt')}
        ${Br(totAtual_ !== 0 ? R$(totAtual_) : '—', 'font-size:6.5pt')}
        ${Br(totAcum_ > 0 ? R$(totAcum_) : '—', 'font-size:6.5pt')}
      </tr>`;
    });

    // Linha TOTAL (topo do tbody, antes de todos os itens)
    linhas = `<tr style="background:#d8d8d8;font-weight:900">
      <td colspan="5" style="padding:3px 8px;border:1px solid #999;text-align:right;font-size:7.5pt;font-weight:900">TOTAL:</td>
      ${Br(R$(gCont), 'font-size:7.5pt;font-weight:900;border:1px solid #999')}
      ${Br(pctAnt.toFixed(2).replace('.',','), 'font-size:7pt;border:1px solid #999')}
      ${Br(pctMed.toFixed(2).replace('.',','), 'font-size:7pt;border:1px solid #999')}
      ${Br(pctAcum.toFixed(2).replace('.',','), 'font-size:7.5pt;font-weight:900;border:1px solid #999')}
      ${Br(R$(vAcumAnt), 'font-size:7.5pt;border:1px solid #999')}
      ${Br(R$(vMedAtual), 'font-size:7.5pt;border:1px solid #999')}
      ${Br(R$(vAcumTot), 'font-size:7.5pt;font-weight:900;border:1px solid #999')}
    </tr>` + linhas;

    const agora = new Date();
    const logo  = state.get('logoBase64') || '';

    // ── Helper de célula de identificação ────────────────────────
    // Usa padding compacto e font-size pequeno para caber no A4 paisagem
    const HC = (label, value, colspan = 1) =>
      `<td colspan="${colspan}" style="padding:2px 5px;border:1px solid #b0b0b0;vertical-align:top">
        <div style="font-size:5pt;font-weight:700;color:#555;text-transform:uppercase;letter-spacing:.2px;line-height:1.1">${label}</div>
        <div style="font-size:6.5pt;font-weight:700;margin-top:1px;line-height:1.2">${value || '—'}</div>
      </td>`;

    const html = `
  <!-- ── Cabeçalho principal ─────────────────────────────────── -->
  <table style="width:100%;border-collapse:collapse;table-layout:fixed;margin-bottom:0;font-size:7pt">
    <colgroup>
      <col style="width:17%"><col style="width:66%"><col style="width:17%">
    </colgroup>
    <tr>
      <td style="padding:4px 8px;border:1px solid #999;vertical-align:middle">
        ${logo
          ? `<img src="${logo}" style="max-height:48px;max-width:140px;object-fit:contain;display:block;margin-bottom:3px">`
          : `<div style="display:inline-block;background:#005CA9;color:#fff;font-size:13pt;font-weight:900;
              padding:2px 10px;border-radius:3px;letter-spacing:3px;font-family:Arial,sans-serif">CAIXA</div>`
        }
        <div style="font-size:6pt;color:#555;margin-top:2px">Empreitada por Preço Global ou Integral</div>
      </td>
      <td style="padding:2px 10px;border:1px solid #999;text-align:center;vertical-align:middle">
        <div style="font-size:12pt;font-weight:900;letter-spacing:1px;text-transform:uppercase">BM - BOLETIM DE MEDIÇÃO</div>
      </td>
      <td style="padding:4px 8px;border:1px solid #999;text-align:right;vertical-align:top">
        <div style="font-size:6pt;font-weight:700;color:#555">Grau de Sigilo</div>
        <div style="font-size:8pt;font-weight:900">${cfg.grauSigilo || '#PUBLICO'}</div>
      </td>
    </tr>
  </table>

  <!-- ── Bloco de identificação — tabela única com 12 colunas base ── -->
  <table style="width:100%;border-collapse:collapse;table-layout:fixed;margin-bottom:0">
    <colgroup>
      <col style="width:8.33%"><col style="width:8.33%"><col style="width:8.33%">
      <col style="width:8.33%"><col style="width:8.33%"><col style="width:8.33%">
      <col style="width:8.33%"><col style="width:8.33%"><col style="width:8.33%">
      <col style="width:8.33%"><col style="width:8.33%"><col style="width:8.37%">
    </colgroup>
    <tr>
      ${HC('Nº TC/CR',          cfg.tcCr,          2)}
      ${HC('Nº CONVENIO',       cfg.convenio,       2)}
      ${HC('GIGOV',             cfg.gigov,          1)}
      ${HC('GESTOR',            cfg.gestor,         1)}
      ${HC('PROGRAMA',          cfg.programa,       3)}
      ${HC('AÇÃO / MODALIDADE', cfg.acaoModalidade, 2)}
      ${HC('DATA ASSINATURA',   cfg.dataAssinatura, 1)}
    </tr>
    <tr>
      ${HC('PROPONENTE / TOMADOR',  cfg.contratante, 3)}
      ${HC('MUNICÍPIO / UF',        cfg.municipioUf, 1)}
      ${HC('LOCALIDADE / ENDEREÇO', cfg.localidade,  4)}
      ${HC('OBJETO',                cfg.objeto,      4)}
    </tr>
    <tr>
      ${HC('Nº CTEF',          cfg.nCtef,           1)}
      ${HC('EMPRESA EXECUTORA', cfg.contratada,     3)}
      ${HC('CNPJ',             fmtCNPJ(cfg.cnpj),   2)}
      ${HC('OBJETO DO CTEF',   cfg.objeto,          5)}
      ${HC('INÍCIO DA OBRA',   cfg.inicioReal,      1)}
    </tr>
  </table>

  <!-- ── Barra de resumo (compacta) ───────────────────────────── -->
  <table style="width:100%;border-collapse:collapse;margin-bottom:3px">
    <tr style="background:#f0f0f0">
      <td style="padding:2px 8px;border:1px solid #999;text-align:center;font-size:7pt">
        <span style="font-size:6pt;font-weight:400">% Realizado Acum.:</span>
        <strong style="font-size:9pt;color:#005CA9"> ${pctAcum.toFixed(2).replace('.', ',')}%</strong>
      </td>
      <td style="padding:2px 8px;border:1px solid #999;text-align:center;font-size:7pt">
        <span style="font-size:6pt;font-weight:400">Período:</span>
        <strong style="font-size:7.5pt"> ${bm.mes || '—'}</strong>
      </td>
      <td style="padding:2px 8px;border:1px solid #999;text-align:center;width:110px">
        <span style="font-size:6pt;font-weight:400">Medição:</span>
        <strong style="font-size:10pt;color:#005CA9"> ${String(bmNum).padStart(2, '0')}</strong>
      </td>
    </tr>
  </table>

  <!-- ── Tabela principal ─────────────────────────────────────── -->
  <!-- Discriminação: 36% | Und: 2.5% | Ev.Financeira cada: 8% -->
  <table style="width:100%;border-collapse:collapse;font-size:6.5pt;table-layout:fixed">
    <colgroup>
      <col style="width:3.5%"><col style="width:36%"><col style="width:2.5%">
      <col style="width:5%"><col style="width:6%"><col style="width:7.5%">
      <col style="width:4.5%"><col style="width:4.5%"><col style="width:4.5%">
      <col style="width:8.67%"><col style="width:8.67%"><col style="width:8.66%">
    </colgroup>
    <thead>
      <tr style="background:#d0d0d0">
        <th colspan="6" style="padding:3px 6px;border:1px solid #999;text-align:center;font-size:7pt;font-weight:800">Orçamento Contratado</th>
        <th colspan="3" style="padding:3px 6px;border:1px solid #999;text-align:center;font-size:7pt;font-weight:800">Evolução Física (%)</th>
        <th colspan="3" style="padding:3px 6px;border:1px solid #999;text-align:center;font-size:7pt;font-weight:800">Evolução Financeira (R$)</th>
      </tr>
      <tr style="background:#e8e8e8">
        <th style="padding:2px 3px;border:1px solid #999;text-align:center;font-size:5.5pt">Item</th>
        <th style="padding:2px 5px;border:1px solid #999;text-align:left;font-size:5.5pt">Discriminação</th>
        <th style="padding:2px 2px;border:1px solid #999;text-align:center;font-size:5.5pt">Und.</th>
        <th style="padding:2px 3px;border:1px solid #999;text-align:right;font-size:5.5pt">Qtde.</th>
        <th style="padding:2px 3px;border:1px solid #999;text-align:right;font-size:5.5pt">Preço Unit. (R$)</th>
        <th style="padding:2px 3px;border:1px solid #999;text-align:right;font-size:5.5pt">Preço Total (R$)</th>
        <th style="padding:2px 3px;border:1px solid #999;text-align:right;font-size:5.5pt">Acum. Anterior</th>
        <th style="padding:2px 3px;border:1px solid #999;text-align:right;font-size:5.5pt">Período</th>
        <th style="padding:2px 3px;border:1px solid #999;text-align:right;font-size:5.5pt;white-space:normal;word-break:break-word">Acum. Incl. Período</th>
        <th style="padding:2px 3px;border:1px solid #999;text-align:right;font-size:5.5pt">Acum. Anterior</th>
        <th style="padding:2px 3px;border:1px solid #999;text-align:right;font-size:5.5pt">Período</th>
        <th style="padding:2px 3px;border:1px solid #999;text-align:right;font-size:5.5pt;white-space:normal;word-break:break-word">Acum. Incl. Período</th>
      </tr>
    </thead>
    <tbody>${linhas}</tbody>
  </table>

  <!-- ── Rodapé ───────────────────────────────────────────────── -->
  <div style="margin-top:6px;font-size:7pt">
    <div style="margin-bottom:3px"><strong>Obs:</strong>
      <span style="display:inline-block;border-bottom:1px solid #999;width:85%;margin-left:6px">&nbsp;</span>
    </div>
    <div style="font-size:6.5pt;color:#333;margin-bottom:6px;text-align:justify">
      Os serviços medidos informados neste BM encontram-se concluídos, estão em conformidade com os projetos
      e especificações aceitos pela CAIXA e foram executados de acordo com as normas técnicas.
    </div>
    <div style="display:flex;justify-content:space-between;align-items:flex-end;gap:20px">
      <div style="font-size:7pt">
        <div style="margin-bottom:3px"><strong>Local e Data</strong></div>
        <div>${cfg.localData || '______________________________'}</div>
      </div>
      <div style="display:flex;gap:40px">
        <div style="text-align:center;min-width:200px">
          <div style="height:60px;margin-bottom:4px"></div>
          <div style="border-top:1px solid #000;padding-top:4px">
            <div style="font-size:7pt">Resp. Técnico Fiscalização: <strong>${cfg.fiscal || '—'}</strong></div>
            <div style="font-size:6.5pt">CREA/CAU: ${fmtCREA(cfg.creaFiscal)}</div>
            <div style="font-size:6.5pt">ART/RRT: ${cfg.artRrt || '—'}</div>
          </div>
        </div>
        <div style="text-align:center;min-width:220px">
          <div style="height:60px;margin-bottom:4px"></div>
          <div style="border-top:1px solid #000;padding-top:4px">
            <div style="font-size:7pt;font-weight:700">Representante do Tomador / Ag. Promotor ou Tomador</div>
            <div style="font-size:6.5pt">Nome: ${cfg.representanteTomador || '—'}</div>
            <div style="font-size:6.5pt">Cargo: ${cfg.cargoRepresentante || '—'}</div>
          </div>
        </div>
      </div>
    </div>
  </div>
  <div style="text-align:center;font-size:5.5pt;color:#aaa;margin-top:6px;border-top:1px solid #eee;padding-top:3px">
    Emitido em ${agora.toLocaleDateString('pt-BR')} às ${agora.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })} — Fiscal na Obra · beta teste
  </div>`;

    const w = window.open('', '_blank', 'width=1400,height=900');
    w.document.write(`<!DOCTYPE html>
<html lang="pt-BR"><head>
<meta charset="UTF-8">
<title>BM - BOLETIM DE MEDIÇÃO ${String(bmNum).padStart(2,'0')}</title>
<style>
  *{box-sizing:border-box;margin:0;padding:0}
  body{font-family:Arial,Helvetica,sans-serif;font-size:7pt;color:#000;background:#fff;padding:5mm 6mm}
  table{border-collapse:collapse;font-family:Arial,Helvetica,sans-serif}
  tr:nth-child(even) td{background:#f9f9f9}
  tr:nth-child(even) td[colspan]{background:inherit}
  @page{size:A4 landscape;margin:5mm 6mm}
  @media print{
    *{-webkit-print-color-adjust:exact!important;print-color-adjust:exact!important}
    body{padding:0}
    thead{display:table-header-group}
    tr{page-break-inside:avoid}
  }
</style>
</head><body>
${html}
<script>window.onload=function(){window.print();window.onafterprint=function(){window.close();};};<\/script>
</body></html>`);
    w.document.close();
  }

  // ── Cabeçalho para PDF ──────────────────────────────────────
  cabecalhoPDF(titulo, subtitulo) {
    const cfg  = state.get('cfg') || {};
    const logo = state.get('logoBase64') || '';
    if (!logo) {
      return `<div class="h1">${titulo}</div><div class="subtitulo">${subtitulo || ''}</div>`;
    }
    return `
      <div style="display:flex;align-items:center;gap:16px;border-bottom:2px solid #1A1A1A;padding-bottom:10px;margin-bottom:12px">
        <img src="${logo}" style="height:60px;max-width:180px;object-fit:contain;flex-shrink:0">
        <div style="flex:1">
          <div class="h1" style="text-align:left;font-size:13pt">${titulo}</div>
          <div style="font-size:9pt;color:#555">${subtitulo || ''}</div>
          <div style="font-size:8pt;color:#6b7280;margin-top:2px">${cfg.contrato || ''} · ${cfg.contratante || ''}</div>
        </div>
      </div>`;
  }
}
