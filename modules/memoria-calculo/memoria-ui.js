/**
 * ╔══════════════════════════════════════════════════════════════╗
 * ║  FISCAL NA OBRA v15.1 — modules/memoria-calculo/memoria-ui.js ║
 * ║  Interface da Memória de Cálculo                            ║
 * ╚══════════════════════════════════════════════════════════════╝
 */

import state        from '../../core/state.js';
import { formatters } from '../../utils/formatters.js';
import { guardFocus } from '../../utils/dom-patcher.js';
import {
  getLinhasItem, getFxFormula, sumLinhasQtd, calcDimensional,
  fxCalc, classUnd,
  getValorAcumuladoTotal, getValorAcumuladoAnterior, getValorMedicaoAtual,
  getQtdAcumuladoTotalItem, getQtdMedicaoItemNoBm,
} from '../boletim-medicao/bm-calculos.js';

export class MemoriaUI {
  constructor(controller) {
    this._ctrl = controller;
  }

  renderTabela(bmNum, bm, itens, cfg, obraId, med, prevQtyMap, expandidos) {
    const wrap = document.getElementById('mem-table-wrap');
    if (!wrap) return;

    // ── Preserva posição de scroll do container principal ──────
    // Evita que a reconstrução do DOM faça a tela rolar para o topo
    const scrollEl = document.querySelector('.conteudo') || document.documentElement;
    const scrollPos = scrollEl.scrollTop;

    const salva = !!(med && med._salva); // true = documento bloqueado para edição

    const R$ = v => formatters.currency(v);
    const n4 = v => formatters.n4(v);

    // Banner
    let banner = '';
    if (bmNum > 1) {
      const bms    = state.get('bms');
      const bmAnt  = bms.find(b => b.num === bmNum - 1);
      const rotulo = bmAnt ? `${bmAnt.label}${bmAnt.mes !== '(a definir)' ? ` (${bmAnt.mes})` : ''}` : `BM ${String(bmNum-1).padStart(2,'0')}`;
      const vAcumAnt = getValorAcumuladoAnterior(obraId, bmNum, itens, cfg);
      banner = `
        <div style="background:#f0f9ff;border:1px solid #bae6fd;border-radius:4px;padding:9px 14px;margin-bottom:10px;font-size:11.5px;color:#0c4a6e;display:flex;align-items:flex-start;gap:10px;flex-wrap:wrap">
          <span style="font-size:16px;line-height:1">📌</span>
          <div>
            <b>Acumulado Anterior</b> carregado do <b>${rotulo}</b> — Total: <b style="font-family:monospace">${R$(vAcumAnt)}</b><br>
            <span style="color:#0369a1">Medição Atual = Acumulado Total (${bm.label}) − Acumulado Total (${rotulo})</span>
          </div>
        </div>`;
    } else {
      banner = `
        <div style="background:#f0fdf4;border:1px solid #86efac;border-radius:4px;padding:9px 14px;margin-bottom:10px;font-size:11.5px;color:#1A1A1A;display:flex;align-items:center;gap:8px">
          <span style="font-size:16px">✅</span>
          <span><b>Primeiro Boletim.</b> Acumulado Anterior = R$ 0,00.</span>
        </div>`;
    }

    // Linhas da tabela
    const linhas = this._gerarLinhas(bmNum, bm, itens, cfg, obraId, med, prevQtyMap, expandidos, salva);
    const vMed   = getValorMedicaoAtual(obraId, bmNum, itens, cfg);
    const vAcum  = getValorAcumuladoTotal(obraId, bmNum, itens, cfg);

    const html = `
      <table id="tbl-memoria">
        <thead>
          <tr>
            <th style="width:84px;text-align:center">Ações</th>
            <th style="width:50px">Item</th>
            <th style="width:72px">Código</th>
            <th style="width:62px">Banco</th>
            <th>Descrição do Serviço</th>
            <th style="width:46px">Und</th>
            <th style="width:88px;text-align:right">Qtd Contr.</th>
            <th style="width:90px;text-align:right">P.Unit. (R$)</th>
            <th style="width:96px;text-align:right">Total c/BDI</th>
            <th style="width:96px;text-align:right;background:var(--table-th-bg);color:var(--table-th-text)">Acum. Ant.<br><small>Qtd</small></th>
            <th style="width:96px;text-align:right;background:#dbeafe;color:#1e40af">Acum. Total<br><small>Qtd</small></th>
            <th style="width:96px;text-align:right;background:#dcfce7;color:#1A1A1A">Med. Atual<br><small>Qtd</small></th>
            <th style="width:72px;text-align:right;background:#dbeafe;color:#1e40af">% Exec.</th>
            <th style="width:112px;text-align:right;background:#dcfce7;color:#1A1A1A">Valor Med. Atual</th>
            <th style="width:112px;text-align:right;background:#dbeafe;color:#1e40af">Valor Acum.</th>
            <th style="width:140px;background:var(--table-th-bg);color:var(--table-th-text)">Observações</th>
          </tr>
        </thead>
        <tbody>${linhas}</tbody>
        <tfoot>
          <tr class="linha-total">
            <td colspan="13" style="text-align:right">TOTAIS DO BOLETIM (${bm.label})</td>
            <td class="td-r" id="mem-tfoot-med">${R$(vMed)}</td>
            <td class="td-r" id="mem-tfoot-acum">${R$(vAcum)}</td>
            <td></td>
          </tr>
        </tfoot>
      </table>`;

    // P2 — guardFocus: preserva foco/cursor se usuário estiver editando
    guardFocus(() => { wrap.innerHTML = banner + html; });

    // ── Restaura posição de scroll após reconstrução do DOM ────
    // Sem isso, o browser rola para o topo ao substituir o innerHTML
    requestAnimationFrame(() => {
      scrollEl.scrollTop = scrollPos;
    });
  }

  _gerarLinhas(bmNum, bm, itens, cfg, obraId, med, prevQtyMap, expandidos, salva = false) {
    const R$   = v => formatters.currency(v);
    const n4   = v => formatters.n4(v);
    // ALT2: quantidades exibidas com 2 casas decimais respeitando modoCalculo
    const mode = cfg?.modoCalculo || 'truncar';
    const n2   = v => {
      const num = parseFloat(v || 0);
      const applied = mode === 'truncar'
        ? Math.trunc(Math.round(num * 100 * 100) / 100) / 100
        : Math.round(num * 100) / 100;
      return applied.toFixed(2).replace('.', ',');
    };
    const pct  = v => formatters.percent(v);
    const bdi  = cfg.bdi || 0.25;
    let html   = '';

    itens.forEach(it => {
      if (it.t === 'G') {
        html += `<tr class="linha-grupo"><td colspan="16" style="font-weight:800;background:#1A1A1A;color:#fff;padding:7px 10px">${it.desc}</td></tr>`;
        return;
      }
      if (it.t === 'SG') {
        html += `<tr class="linha-subgrupo"><td colspan="16" style="font-weight:700;background:#333333;color:#e2e8f0;padding:6px 10px">${it.desc}</td></tr>`;
        return;
      }

      const itemId   = it.id;
      const lines    = getLinhasItem(med, itemId);
      const fxFormula = getFxFormula(med, itemId);
      const temFx    = !!fxFormula;
      const qtdLinhas   = sumLinhasQtd(it.und, lines, fxFormula); // total de TODAS as linhas no BM (para exibição)
      const qtdMedAtual = getQtdMedicaoItemNoBm(obraId, bmNum, itemId, itens);
      const qtdAnt      = prevQtyMap[itemId] || 0;
      const qtdTotRaw   = qtdAnt + qtdMedAtual;
      // FIX-4: marca ultrapassagem mas limita o total contabilizado a 100% do item
      const ultrapassou = it.qtd > 0 && qtdTotRaw > it.qtd;
      const qtdTot      = ultrapassou ? it.qtd : qtdTotRaw;
      const qtdAtual    = qtdMedAtual;            // Medição Atual = apenas linhas deste BM
      const pctExec     = it.qtd > 0 ? (qtdTotRaw / it.qtd * 100) : 0; // exibe % real para alertar
      const upBdi    = it.up * (1 + bdi);
      const totalItem = it.qtd * upBdi;
      const vMed     = qtdAtual * upBdi;
      const vAcum    = qtdTot   * upBdi;
      const isExp    = expandidos.has(itemId);

      const pctCor = ultrapassou ? '#dc2626' : pctExec > 0 ? '#059669' : '#9ca3af';

      html += `
        <tr class="${isExp ? 'linha-item-exp' : ''}">
          <td class="td-c">
            <button class="btn btn-cinza btn-sm" style="margin-right:3px"
              data-action="toggle-item" data-itemid="${itemId}" title="${isExp ? 'Fechar' : 'Expandir'}">
              ${isExp ? '▲' : '▼'}
            </button>
            <button class="btn btn-verde btn-sm" ${salva ? 'disabled style="opacity:.4"' : ''}
              data-action="add-linha" data-bm="${bmNum}" data-itemid="${itemId}" title="${salva ? 'Bloqueado' : 'Adicionar linha'}">➕</button>
          </td>
          <td class="td-c" style="font-size:11px;font-weight:700">${it.id}</td>
          <td style="font-size:10px;color:#6b7280">${it.cod || '—'}</td>
          <td style="font-size:10px;color:#6b7280">${it.banco || '—'}</td>
          <td style="font-size:11px">${it.desc.slice(0, 80)}${it.desc.length > 80 ? '…' : ''}${ultrapassou ? `<span title="⚠️ Medição ultrapassou 100% da quantidade prevista (${pctExec.toFixed(1)}%)" style="display:inline-block;background:#fef08a;color:#92400e;border:1px solid #d97706;border-radius:4px;font-size:8px;font-weight:700;padding:1px 5px;margin-left:4px">⚠️ +100%</span>` : ''}</td>
          <td class="td-c" style="font-size:11px">${it.und}</td>
          <td class="td-r">${n2(it.qtd)}</td>
          <td class="td-r">${R$(it.up)}</td>
          <td class="td-r">${R$(totalItem)}</td>
          <td class="td-r" style="background:var(--table-th-bg);color:var(--table-th-text)">${n2(qtdAnt)}</td>
          <td class="td-r" id="mem-acumtot-${itemId}" style="background:#dbeafe;color:#1e40af;font-weight:700">${n2(qtdTot)}</td>
          <td class="td-r" id="mem-medatual-${itemId}" style="background:#dcfce7;color:${qtdAtual < 0 ? '#dc2626' : '#1A1A1A'};font-weight:700">${n2(qtdAtual)}</td>
          <td class="td-r" id="mem-pctexec-${itemId}" style="background:#dbeafe;color:${pctCor};font-weight:700">${pct(pctExec)}</td>
          <td class="td-r" id="mem-vmed-${itemId}" style="background:#dcfce7">${R$(vMed)}</td>
          <td class="td-r" id="mem-vacum-${itemId}" style="background:#dbeafe;font-weight:700">${R$(vAcum)}</td>
          <td style="background:var(--table-th-bg);font-size:10px;color:var(--text-muted)">
            ${lines.length} linha(s)
            ${temFx ? `<span class="fx-badge" title="Fórmula: ${fxFormula}">𝑓𝑥</span>` : ''}
          </td>
        </tr>`;

      if (isExp) {
        html += this._renderPainelLinhas(bmNum, it, lines, fxFormula, temFx, obraId, salva);
      }
    });

    return html;
  }

  _renderPainelLinhas(bmNum, it, lines, fxFormula, temFx, obraId, salva = false) {
    const tipo     = classUnd(it.und);
    // Se tem fórmula especial, mostra todos os campos (a fórmula pode usar qualquer variável)
    const showComp = temFx || ['m', 'm2', 'm3'].includes(tipo);
    const showLarg = temFx || ['m2', 'm3'].includes(tipo);
    const showAlt  = temFx || tipo === 'm3';
    // ALT2: resultado de linha e total do item sempre com 2 casas decimais
    const n2 = v => parseFloat(v || 0).toFixed(2).replace('.', ',');

    const inp = (dim, show, ln) => show
      ? `<input type="number" step="any" value="${ln[dim] || 0}"
           data-bm="${bmNum}" data-id="${it.id}" data-lineid="${ln.id}" data-dim="${dim}"
           ${salva ? 'readonly tabindex="-1"' : ''}
           style="width:72px;text-align:right;padding:3px 5px;font-size:11px;background:${salva ? '#f9fafb' : 'transparent'};border:1px solid #e5e7eb;border-radius:3px;${salva ? 'color:#9ca3af;cursor:not-allowed;' : ''}">`
      : `<span style="color:#9ca3af;font-size:10px">—</span>`;

    const inpDesc = (ln) =>
      `<input type="text" value="${ln.desc || ''}"
         data-bm="${bmNum}" data-id="${it.id}" data-lineid="${ln.id}" data-dim="desc"
         ${salva ? 'readonly tabindex="-1"' : ''}
         placeholder="Obs..." style="width:120px;padding:3px 5px;font-size:10px;background:${salva ? '#f9fafb' : 'transparent'};border:1px solid #e5e7eb;border-radius:3px;${salva ? 'color:#9ca3af;cursor:not-allowed;' : ''}">`;

    const linhaRows = lines.map((ln, idx) => {
      let qtdCalcLn = 0;
      let formulaText = '';
      const safeComp = isFinite(parseFloat(ln.comp)) ? parseFloat(ln.comp) : 0;
      const safeLarg = isFinite(parseFloat(ln.larg)) ? parseFloat(ln.larg) : 0;
      const safeAlt  = isFinite(parseFloat(ln.alt))  ? parseFloat(ln.alt)  : 0;
      const safeQtd  = isFinite(parseFloat(ln.qtd))  ? parseFloat(ln.qtd)  : 0;

      if (temFx) {
        const res = fxCalc(fxFormula, safeComp, safeLarg, safeAlt, safeQtd);
        qtdCalcLn = isFinite(res.result) ? res.result : 0;
        formulaText = res.erro ? `⚠ ${res.erro}` : res.expr;
      } else {
        const r = calcDimensional(it.und, safeComp, safeLarg, safeAlt, safeQtd);
        qtdCalcLn = isFinite(r.qtdCalc) ? r.qtdCalc : 0;
        formulaText = r.formula || '';
      }
      const cor = qtdCalcLn > 0 ? '#1A1A1A' : qtdCalcLn < 0 ? '#555555' : '#9ca3af';
      // Badge de origem do BM
      const origemBm = ln.bmOrigem ? ln.bmOrigem : bmNum;
      const origemBadge = origemBm !== bmNum
        ? `<span style="background:#dbeafe;color:#1e40af;border-radius:3px;padding:1px 5px;font-size:9px;font-weight:600;white-space:nowrap" title="Linha importada do BM ${String(origemBm).padStart(2,'0')}">BM ${String(origemBm).padStart(2,'0')}</span>`
        : `<span style="background:#dcfce7;color:#16a34a;border-radius:3px;padding:1px 5px;font-size:9px;font-weight:600;white-space:nowrap" title="Linha criada neste BM">BM ${String(origemBm).padStart(2,'0')}</span>`;
      return `
        <tr style="background:var(--table-td-bg)">
          <td class="td-c" style="font-family:monospace;color:#9ca3af;font-size:10px;font-weight:700">
            ${idx + 1}
            <div style="margin-top:2px">${origemBadge}</div>
          </td>
          <td class="td-c" style="padding:4px 5px">${inp('comp', showComp, ln)}</td>
          <td class="td-c" style="padding:4px 5px">${inp('larg', showLarg, ln)}</td>
          <td class="td-c" style="padding:4px 5px">${inp('alt',  showAlt,  ln)}</td>
          <td class="td-c" style="padding:4px 5px">${inp('qtd',  true,     ln)}</td>
          <td class="td-r" id="mem-lres-${it.id}-${ln.id}"
              style="font-weight:700;color:${cor};font-family:monospace;font-size:12px">${n2(qtdCalcLn)}</td>
          <td style="font-size:10px;font-family:monospace;color:#6b7280;white-space:nowrap;padding:4px 8px"
              id="mem-lfor-${it.id}-${ln.id}">${formulaText}</td>
          <td style="padding:4px 5px">${inpDesc(ln)}</td>
          <td class="td-c" style="padding:4px 6px">
            <button class="btn btn-vermelho btn-sm" style="padding:3px 8px${salva ? ';opacity:.35' : ''}"
              data-action="del-linha" data-bm="${bmNum}" data-itemid="${it.id}" data-lineid="${ln.id}"
              ${salva ? 'disabled' : ''}
              title="${salva ? 'Bloqueado' : 'Excluir linha'}">🗑️</button>
          </td>
        </tr>`;
    }).join('');

    return `
      <tr>
        <td colspan="16" style="background:var(--bg-surface);padding:10px 14px;border-left:3px solid #444444">
          <div style="display:flex;align-items:center;justify-content:space-between;gap:10px;flex-wrap:wrap;margin-bottom:8px">
            <div style="font-size:11.5px;font-weight:700;color:#1A1A1A;display:flex;align-items:center;gap:8px;flex-wrap:wrap">
              <span style="background:#1A1A1A;color:#fff;border-radius:3px;padding:2px 7px;font-family:monospace;font-size:11px">📐 Item ${it.id}</span>
              <span style="background:#dbeafe;color:#1e40af;border-radius:3px;padding:2px 7px;font-size:10px;font-family:monospace">${it.cod || '—'}</span>
              <span style="color:#6b7280;font-weight:400">${it.desc.slice(0, 55)}${it.desc.length > 55 ? '…' : ''}</span>
              <span id="mem-itemtotal-${it.id}" style="font-family:monospace;font-weight:700;color:#1e40af;font-size:13px">
                ${n2(sumLinhasQtd(it.und, lines, fxFormula))} ${it.und}
              </span>
              ${temFx ? `<span class="fx-badge" title="Fórmula: ${fxFormula}">𝑓𝑥 ${fxFormula.toUpperCase()}</span>` : ''}
            </div>
            <div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap">
              <button class="btn btn-verde" style="padding:5px 12px;font-size:12px;font-weight:700${salva ? ';opacity:.4' : ''}"
                ${salva ? 'disabled' : ''}
                data-action="add-linha" data-bm="${bmNum}" data-itemid="${it.id}">➕ Adicionar Linha</button>
              ${bmNum > 1 ? `<button class="btn btn-cinza" style="padding:5px 11px;font-size:12px;font-weight:600${salva ? ';opacity:.4' : ''}"
                ${salva ? 'disabled' : ''}
                data-action="importar-bm-anterior" data-bm="${bmNum}" data-itemid="${it.id}"
                title="Importar linhas do BM anterior">📋 Importar BM Ant.</button>` : ''}
              <button style="padding:5px 11px;font-size:12px;font-weight:700;border:none;border-radius:5px;cursor:${salva ? 'not-allowed' : 'pointer'};background:${temFx ? '#d97706' : '#f1f5f9'};color:${temFx ? '#fff' : '#374151'};border:1px solid ${temFx ? '#d97706' : '#d1d5db'};opacity:${salva ? '.4' : '1'}"
                ${salva ? 'disabled' : ''}
                data-action="editar-fx" data-bm="${bmNum}" data-itemid="${it.id}">
                𝑓𝑥 ${temFx ? 'Editar fórmula' : 'Fórmula especial'}
              </button>
            </div>
          </div>
          <div class="tabela-wrap" style="border:1px solid var(--card-border);border-radius:4px;overflow:auto;background:var(--card-bg)">
            <table style="width:100%;border-collapse:collapse;font-size:12px">
              <thead>
                <tr style="background:var(--table-th-bg)">
                  <th style="width:48px;text-align:center;color:#6b7280">#<br><small>Origem</small></th>
                  <th style="width:90px;text-align:center;background:${showComp ? '#f0fdf4' : '#f3f4f6'};color:${showComp ? '#1A1A1A' : '#9ca3af'}">
                    ${showComp ? '📏 Compr. (m)' : 'Compr.'}
                  </th>
                  <th style="width:90px;text-align:center;background:${showLarg ? '#f0fdf4' : '#f3f4f6'};color:${showLarg ? '#1A1A1A' : '#9ca3af'}">
                    ${showLarg ? '📐 Larg. (m)' : 'Larg.'}
                  </th>
                  <th style="width:90px;text-align:center;background:${showAlt ? '#f0fdf4' : '#f3f4f6'};color:${showAlt ? '#1A1A1A' : '#9ca3af'}">
                    ${showAlt ? '⬆ Alt. (m)' : 'Alt.'}
                  </th>
                  <th style="width:90px;text-align:center;background:var(--table-th-bg);color:var(--table-th-text)">Qtd</th>
                  <th style="width:96px;text-align:right;background:#dcfce7;color:#1A1A1A">Resultado</th>
                  <th style="background:var(--table-th-bg);color:var(--table-th-text)">Fórmula Aplicada</th>
                  <th style="width:140px;text-align:center;color:#6b7280">Obs. (opcional)</th>
                  <th style="width:64px;text-align:center">Excluir</th>
                </tr>
              </thead>
              <tbody>
                ${lines.length ? linhaRows : `<tr><td colspan="9" style="padding:16px;color:#9ca3af;text-align:center;font-size:12px">
                  <span style="font-size:24px;display:block;margin-bottom:6px">📋</span>
                  Nenhuma linha registrada. Clique em <b>➕ Adicionar Linha</b>.
                </td></tr>`}
              </tbody>
            </table>
          </div>
        </td>
      </tr>`;
  }

  // ── Modal de fórmula especial ─────────────────────────────────

  abrirModalFx(bmNum, itemId, store) {
    this._ctrl._mfxBm = bmNum;
    this._ctrl._mfxId = itemId;

    const itens = state.get('itensContrato');
    const it    = itens.find(x => x.id === itemId);
    const fx    = getFxFormula(store, itemId);

    const infoEl = document.getElementById('mfx-info-item');
    if (infoEl) {
      infoEl.textContent = `Item ${itemId} · ${it?.cod || '—'} · ${(it?.desc || '').slice(0, 65)} · Und: ${it?.und || '—'}`;
    }

    const inp = document.getElementById('mfx-input');
    if (inp) { inp.value = fx; inp.classList.remove('ok', 'err'); }

    const remEl = document.getElementById('mfx-remover-wrap');
    if (remEl) remEl.style.display = fx ? '' : 'none';

    document.getElementById('mfx-overlay')?.classList.add('aberto');
    this.recalcFx();
  }

  recalcFx() {
    const formula = document.getElementById('mfx-input')?.value || '';
    const C = parseFloat(document.getElementById('mfx-tc')?.value) || 0;
    const L = parseFloat(document.getElementById('mfx-tl')?.value) || 0;
    const A = parseFloat(document.getElementById('mfx-ta')?.value) || 0;
    const Q = parseFloat(document.getElementById('mfx-tq')?.value) || 0;

    const prevEl = document.getElementById('mfx-preview');
    const errEl  = document.getElementById('mfx-err-msg');
    const inp    = document.getElementById('mfx-input');

    if (!formula.trim()) {
      if (prevEl) { prevEl.textContent = '—'; prevEl.className = 'mfx-preview'; }
      if (errEl)  errEl.textContent = '';
      if (inp)    inp.classList.remove('ok', 'err');
      return;
    }

    const av = fxCalc(formula, C, L, A, Q);
    if (av.erro) {
      if (prevEl) { prevEl.textContent = '⚠ ' + av.erro; prevEl.className = 'mfx-preview err'; }
      if (errEl)  errEl.textContent = av.erro;
      if (inp)    { inp.classList.add('err'); inp.classList.remove('ok'); }
    } else {
      const itemId = this._ctrl._mfxId;
      const itens  = state.get('itensContrato');
      const it     = itens?.find(x => x.id === itemId);
      if (prevEl) {
        prevEl.textContent = formatters.n4(av.result) + ' ' + (it?.und || '');
        prevEl.className = 'mfx-preview';
      }
      if (errEl) errEl.textContent = '';
      if (inp)   { inp.classList.add('ok'); inp.classList.remove('err'); }
    }
  }
}
