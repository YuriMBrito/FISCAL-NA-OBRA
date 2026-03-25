/**
 * ╔══════════════════════════════════════════════════════════════════╗
 * ║  FISCAL NA OBRA v16 — modules/aditivos/aditivos-ui.js           ║
 * ║  REESCRITO: sem inline onchange/oninput — tudo via data-action  ║
 * ╚══════════════════════════════════════════════════════════════════╝
 */

import state        from '../../core/state.js';
import { formatters } from '../../utils/formatters.js';
import {
  trunc2, classificarItem, classeRealce, calcularTotais,
  dataParaInput, dataBR,
} from './aditivos-calculos.js';

const R$  = v => formatters.currency ? formatters.currency(v) : (v || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
const fmtN = v => (parseFloat(v) || 0).toLocaleString('pt-BR', { maximumFractionDigits: 4 });

const TIPO_LABEL   = { prazo: '⏱️ Prazo', valor: '💰 Valor', planilha: '📋 Planilha', misto: '⏱️💰 Tempo e Valor' };
const STATUS_COLOR = { Rascunho: 'var(--orange)', Aprovado: 'var(--green)' };
const OP_MAP   = { inclusao: '★ Inclusão', exclusao: '✕ Exclusão', alteracao_qtd: '▲▼ Qtd', alteracao_preco: '💲 Preço' };

export class AditivosUI {

  // ═══════════════════════════════════════════════════════════════
  // PÁGINA PRINCIPAL
  // ═══════════════════════════════════════════════════════════════

  renderPagina(planilhaDraft, planilhaBase) {
    const container = document.getElementById('aditivos-conteudo');
    if (!container) return;
    const obraId    = state.get('obraAtivaId');
    const aditivos  = state.get('aditivos') || [];
    const versoes   = state.get('versoesContratuais') || [];
    const obraMeta  = state.get('obraMeta') || { contractVersion: 1 };
    const cfg       = state.get('cfg') || {};
    const bms       = state.get('bms') || [];

    if (!obraId) {
      container.innerHTML = `<div style="text-align:center;padding:40px;color:var(--text-muted);font-size:13px">🏗️ Selecione uma obra para gerenciar os aditivos.</div>`;
      return;
    }

    const versaoAtual   = versoes.find(v => v.numero === obraMeta.contractVersion) || null;
    const valorAtual    = versaoAtual?.cfgSnapshot?.valor || cfg.valor || 0;
    const valorOriginal = versoes.find(v => v.numero === 1)?.cfgSnapshot?.valor || valorAtual;
    const varTotal      = trunc2(valorAtual - valorOriginal);
    const pctVar        = valorOriginal > 0 ? (varTotal / valorOriginal * 100) : 0;

    container.innerHTML = `
      <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(200px,1fr));gap:10px;margin-bottom:20px">
        ${this._cardResumo('Versão Contratual', `v${obraMeta.contractVersion}`, 'var(--accent)', `${aditivos.length} aditivo(s)`)}
        ${this._cardResumo('Valor Original', R$(valorOriginal), 'var(--text-primary)')}
        ${this._cardResumo('Valor Atual', R$(valorAtual), 'var(--green)')}
        ${this._cardResumo('Variação Total', `${varTotal >= 0 ? '+' : ''}${R$(varTotal)}`, varTotal >= 0 ? 'var(--green)' : 'var(--red)', `${pctVar >= 0 ? '+' : ''}${pctVar.toFixed(1)}%`)}
        ${versaoAtual?.cfgSnapshot?.termino ? this._cardResumo('Término Vigente', dataBR(versaoAtual.cfgSnapshot.termino), 'var(--text-primary)') : ''}
      </div>

      <div style="margin-bottom:20px">
        <div style="font-size:11px;font-weight:800;text-transform:uppercase;letter-spacing:.6px;color:var(--text-muted);margin-bottom:10px">📋 Histórico de Versões Contratuais</div>
        <div>${this._renderVersoes(versoes, aditivos, bms, obraMeta)}</div>
      </div>

      <div style="font-size:11px;font-weight:800;text-transform:uppercase;letter-spacing:.6px;color:var(--text-muted);margin-bottom:10px">📝 Aditivos Registrados</div>
      <div style="overflow-x:auto">
        <table style="width:100%;border-collapse:collapse;font-size:12px">
          <thead>
            <tr style="border-bottom:2px solid var(--border);background:var(--bg-card-alt)">
              <th style="padding:8px 10px;text-align:left;color:var(--text-on-panel);white-space:nowrap">Nº</th>
              <th style="padding:8px 10px;text-align:left;color:var(--text-on-panel);white-space:nowrap">Tipo</th>
              <th style="padding:8px 10px;text-align:left;color:var(--text-on-panel)">Descrição</th>
              <th style="padding:8px 10px;text-align:left;color:var(--text-on-panel);white-space:nowrap">Data</th>
              <th style="padding:8px 10px;text-align:right;color:var(--text-on-panel);white-space:nowrap">Valor Anterior</th>
              <th style="padding:8px 10px;text-align:right;color:var(--text-on-panel);white-space:nowrap">Valor Novo</th>
              <th style="padding:8px 10px;text-align:right;color:var(--text-on-panel);white-space:nowrap">Variação</th>
              <th style="padding:8px 10px;text-align:center;color:var(--text-on-panel);white-space:nowrap">Prazo</th>
              <th style="padding:8px 10px;text-align:center;color:var(--text-on-panel)">Versão</th>
              <th style="padding:8px 10px;text-align:center;color:var(--text-on-panel)">Status</th>
              <th style="padding:8px 10px;text-align:center;color:var(--text-on-panel)">Planilha</th>
              <th style="padding:8px 10px;text-align:center;color:var(--text-on-panel)">Ações</th>
            </tr>
          </thead>
          <tbody>${this._renderLinhasTabela(aditivos)}</tbody>
        </table>
      </div>
      ${aditivos.length === 0 ? `<div style="text-align:center;padding:32px;color:var(--text-muted);font-size:13px">Nenhum aditivo registrado. Clique em <strong>＋ Novo Aditivo</strong> para começar.</div>` : ''}`;
  }

  _cardResumo(label, valor, cor, sub = '') {
    return `<div style="background:var(--bg-warm);border:1px solid var(--border);border-radius:8px;padding:12px 16px;text-align:center">
      <div style="font-size:10px;color:var(--text-muted);text-transform:uppercase;letter-spacing:.5px;margin-bottom:4px">${label}</div>
      <div style="font-size:15px;font-weight:700;font-family:var(--font-mono);color:${cor}">${valor}</div>
      ${sub ? `<div style="font-size:10px;color:var(--text-muted);margin-top:2px">${sub}</div>` : ''}
    </div>`;
  }

  _renderVersoes(versoes, aditivos, bms, obraMeta) {
    if (!versoes.length) return `<div style="color:var(--text-muted);font-size:12px;padding:8px">Nenhuma versão registrada.</div>`;
    return versoes.map(v => {
      const isAtual  = v.numero === obraMeta.contractVersion;
      const adt      = v.aditivoId ? aditivos.find(a => a.id === v.aditivoId) : null;
      const bmsDaVer = bms.filter(b => (b.contractVersion || 1) === v.numero);
      return `<div style="display:flex;align-items:center;gap:10px;padding:10px 14px;border-radius:8px;border:1px solid ${isAtual ? 'var(--accent)' : 'var(--border)'};background:${isAtual ? 'var(--accent-soft)' : 'var(--bg-warm)'};margin-bottom:6px">
        <div style="width:32px;height:32px;border-radius:50%;background:${isAtual ? 'var(--accent)' : 'var(--bg-card-alt)'};color:${isAtual ? '#fff' : 'var(--text-on-panel)'};display:flex;align-items:center;justify-content:center;font-weight:800;font-size:12px;flex-shrink:0">v${v.numero}</div>
        <div style="flex:1;min-width:0">
          <div style="font-weight:600;font-size:12px;color:var(--text-primary)">${v.descricao || 'Versão ' + v.numero}${isAtual ? ' <span style="font-size:10px;background:var(--accent);color:#fff;padding:1px 7px;border-radius:10px;margin-left:6px;font-weight:700">VIGENTE</span>' : ''}</div>
          <div style="font-size:11px;color:var(--text-muted);margin-top:1px">${adt ? `Aditivo Nº ${String(adt.numero).padStart(2,'0')} · ${adt.data || '—'} · ` : 'Contrato original · '}BMs: ${bmsDaVer.length ? bmsDaVer.map(b => b.label).join(', ') : 'nenhum'}</div>
        </div>
        <button class="btn btn-sm" data-action="_adtVerVersao" data-arg0="${v.numero}" style="font-size:11px;background:var(--blue-soft);color:var(--blue-text);border:1px solid var(--blue);padding:4px 10px;white-space:nowrap">🔍 Ver Snapshot</button>
      </div>`;
    }).join('');
  }

  _renderLinhasTabela(aditivos) {
    if (!aditivos.length) return '';
    return aditivos.map(a => {
      const varVal = trunc2((a.valorNovo || 0) - (a.valorAnterior || 0));
      const pctV   = a.valorAnterior > 0 ? trunc2(varVal / a.valorAnterior * 100) : 0;
      const dias   = parseInt(a.prazoAdicionalDias) || 0;
      const prazoCell = dias === 0
        ? `<span style="font-size:10px;color:var(--text-muted);font-style:italic">Sem alteração</span>`
        : `<span style="font-size:11px;font-weight:700;font-family:var(--font-mono);color:${dias > 0 ? 'var(--green)' : 'var(--red)'}">${dias > 0 ? '+' : ''}${dias}d</span>`;
      const temItens = a.itensMudados && a.itensMudados.length > 0;
      const aprovado = a.status === 'Aprovado';
      return `<tr style="border-bottom:1px solid var(--border-subtle)">
        <td style="padding:8px 10px;font-weight:700;font-family:var(--font-mono)">${String(a.numero).padStart(2,'0')}</td>
        <td style="padding:8px 10px;white-space:nowrap">${TIPO_LABEL[a.tipo] || a.tipo}</td>
        <td style="padding:8px 10px;max-width:200px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap" title="${a.descricao || ''}">${a.descricao || '—'}</td>
        <td style="padding:8px 10px;font-family:var(--font-mono);font-size:11px;white-space:nowrap">${a.data || '—'}</td>
        <td style="padding:8px 10px;text-align:right;font-family:var(--font-mono);white-space:nowrap">${a.valorAnterior ? R$(a.valorAnterior) : '—'}</td>
        <td style="padding:8px 10px;text-align:right;font-family:var(--font-mono);font-weight:600;white-space:nowrap">${a.valorNovo ? R$(a.valorNovo) : '—'}</td>
        <td style="padding:8px 10px;text-align:right;font-family:var(--font-mono);white-space:nowrap;color:${varVal >= 0 ? 'var(--green)' : 'var(--red)'}">${a.valorNovo ? `${varVal >= 0 ? '+' : ''}${R$(varVal)} (${pctV.toFixed(1)}%)` : '—'}</td>
        <td style="padding:8px 10px;text-align:center">${prazoCell}</td>
        <td style="padding:8px 10px;text-align:center"><span style="font-size:10px;background:var(--blue-soft);color:var(--blue-text);border:1px solid var(--blue);padding:2px 8px;border-radius:10px;font-weight:600">v${a.contractVersionNova || '—'}</span></td>
        <td style="padding:8px 10px;text-align:center"><span style="font-size:10px;color:${STATUS_COLOR[a.status] || 'var(--text-muted)'};font-weight:600">${a.status || 'Rascunho'}</span></td>
        <td style="padding:8px 10px;text-align:center">${temItens ? `<button data-action="_adtVerPlanilha" data-arg0="${a.id}" style="background:none;border:none;cursor:pointer;font-size:16px;padding:2px 5px" title="Visualizar planilha">📄</button>` : '<span style="color:var(--text-muted);font-size:11px">—</span>'}</td>
        <td style="padding:8px 10px;text-align:center;white-space:nowrap">
          <button class="btn btn-sm" data-action="_adtEditar" data-arg0="${a.id}" style="font-size:11px;padding:3px 8px;margin-right:3px" ${aprovado ? 'disabled title="Aprovado — imutável"' : ''}>✏️</button>
          <button class="btn btn-vermelho btn-sm" data-action="_adtExcluir" data-arg0="${a.id}" style="font-size:11px;padding:3px 8px" ${aprovado ? 'disabled title="Aprovado — imutável"' : ''}>🗑️</button>
        </td>
      </tr>`;
    }).join('');
  }

  // ═══════════════════════════════════════════════════════════════
  // MODAL CRIAÇÃO / EDIÇÃO
  // ═══════════════════════════════════════════════════════════════

  injectModalAditivo() {
    if (document.getElementById('adt-modal-overlay')) return;
    const overlay = document.createElement('div');
    overlay.id = 'adt-modal-overlay';
    overlay.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,.6);z-index:1100;display:none;align-items:center;justify-content:center;padding:20px';
    overlay.innerHTML = `
      <div style="background:var(--bg-card);border:1px solid var(--border);border-radius:16px;padding:28px;width:100%;max-width:720px;max-height:92vh;overflow-y:auto;box-shadow:0 24px 60px rgba(0,0,0,.5)">
        <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:20px">
          <div>
            <div style="font-size:10px;font-weight:700;color:var(--text-muted);text-transform:uppercase;letter-spacing:.5px">Aditivo Contratual</div>
            <div id="adt-modal-titulo" style="font-size:16px;font-weight:800;color:var(--text-primary)">Novo Aditivo</div>
          </div>
          <button data-action="_adtFecharModal" style="background:none;border:none;font-size:24px;cursor:pointer;color:var(--text-muted);line-height:1">×</button>
        </div>
        <input type="hidden" id="adt-edit-id">

        <div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:12px;margin-bottom:14px">
          <div>
            <label style="font-size:11px;font-weight:600;color:var(--text-muted);display:block;margin-bottom:4px">Número do Aditivo</label>
            <input type="number" id="adt-numero" min="1" class="campo-input" style="width:100%">
          </div>
          <div>
            <label style="font-size:11px;font-weight:600;color:var(--text-muted);display:block;margin-bottom:4px">Tipo de Aditivo</label>
            <select id="adt-tipo" class="campo-input" style="width:100%">
              <option value="misto">⏱️💰 Tempo e Valor</option>
              <option value="valor">💰 Valor</option>
              <option value="prazo">⏱️ Prazo</option>
              <option value="planilha">📋 Planilha</option>
            </select>
          </div>
          <div>
            <label style="font-size:11px;font-weight:600;color:var(--text-muted);display:block;margin-bottom:4px">Data do Aditivo</label>
            <input type="date" id="adt-data" class="campo-input" style="width:100%">
          </div>
        </div>

        <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-bottom:14px">
          <div>
            <label style="font-size:11px;font-weight:600;color:var(--text-muted);display:block;margin-bottom:4px">Número do Processo <span style="color:#ef4444;font-size:10px">*</span></label>
            <input type="text" id="adt-processo" class="campo-input" placeholder="Ex.: 001/2024 (obrigatório para Aprovado)" style="width:100%">
          </div>
          <div>
            <label style="font-size:11px;font-weight:600;color:var(--text-muted);display:block;margin-bottom:4px">Status</label>
            <select id="adt-status" class="campo-input" style="width:100%"
              data-action="_adtOnStatusChange" data-value-from="this.value">
              <option value="Rascunho">📝 Rascunho</option>
              <option value="Aprovado">✅ Aprovado</option>
            </select>
          </div>
        </div>

        <div style="margin-bottom:14px">
          <label style="font-size:11px;font-weight:600;color:var(--text-muted);display:block;margin-bottom:4px">Descrição *</label>
          <textarea id="adt-descricao" rows="2" class="campo-input" placeholder="Descreva o objeto do aditivo..." style="width:100%;resize:vertical"></textarea>
        </div>

        <div style="background:var(--bg-warm);border:1px solid var(--border);border-radius:10px;padding:14px;margin-bottom:14px">
          <div style="font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:.5px;color:var(--text-muted);margin-bottom:10px">💰 Alteração de Valor</div>
          <div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:10px">
            <div>
              <label style="font-size:11px;font-weight:600;color:var(--text-muted);display:block;margin-bottom:4px">Valor Anterior (R$)</label>
              <input type="number" id="adt-valor-anterior" step="0.01" class="campo-input" style="width:100%"
                data-action="_adtCalcVariacao">
            </div>
            <div>
              <label style="font-size:11px;font-weight:600;color:var(--text-muted);display:block;margin-bottom:4px">Novo Valor (R$)</label>
              <input type="number" id="adt-valor-novo" step="0.01" class="campo-input" style="width:100%"
                data-action="_adtCalcVariacao">
            </div>
            <div>
              <label style="font-size:11px;font-weight:600;color:var(--text-muted);display:block;margin-bottom:4px">Variação</label>
              <input type="text" id="adt-variacao" readonly class="campo-input" style="width:100%;background:var(--bg-card-alt)">
            </div>
          </div>
        </div>

        <div style="background:var(--bg-warm);border:1px solid var(--border);border-radius:10px;padding:14px;margin-bottom:14px">
          <div style="font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:.5px;color:var(--text-muted);margin-bottom:10px">⏱️ Alteração de Prazo</div>
          <div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:10px">
            <div>
              <label style="font-size:11px;font-weight:600;color:var(--text-muted);display:block;margin-bottom:4px">Término Anterior</label>
              <input type="date" id="adt-termino-anterior" class="campo-input" style="width:100%">
            </div>
            <div>
              <label style="font-size:11px;font-weight:600;color:var(--text-muted);display:block;margin-bottom:4px">Prazo Adicional (dias)</label>
              <input type="number" id="adt-prazo-adicional" class="campo-input" style="width:100%"
                data-action="_adtCalcTermino">
            </div>
            <div>
              <label style="font-size:11px;font-weight:600;color:var(--text-muted);display:block;margin-bottom:4px">Novo Término</label>
              <input type="date" id="adt-termino-novo" class="campo-input" style="width:100%;background:var(--bg-card-alt)" readonly>
            </div>
          </div>
        </div>

        <div id="adt-aviso-versao" style="display:none;background:#fef3c7;border:1px solid #f59e0b;border-radius:8px;padding:10px 14px;margin-bottom:14px;font-size:12px;color:#92400e">
          ⚠️ <strong>Atenção:</strong> Ao salvar com status <strong>Aprovado</strong>, uma nova versão contratual será criada automaticamente. Esta ação é <strong>irreversível</strong>.
        </div>

        <div id="adt-planilha-btn-area" style="margin-bottom:16px">
          <button class="btn btn-sm" data-action="_adtAbrirPlanilhaEditor" style="background:var(--blue-soft);color:var(--blue-text);border:1px solid var(--blue)">
            📋 Editar Planilha do Aditivo
          </button>
          <span id="adt-planilha-status" style="font-size:11px;color:var(--text-muted);margin-left:8px"></span>
          <div id="adt-planilha-aviso-pendente" style="display:none;margin-top:8px;background:#fff7ed;border:1px solid #fb923c;border-radius:6px;padding:8px 12px;font-size:11px;color:#9a3412">
            ⚠️ <strong>Atenção:</strong> Há alterações na planilha não aplicadas. Clique em <strong>✅ Aplicar ao Aditivo</strong> antes de salvar.
          </div>
        </div>

        <div style="display:flex;justify-content:flex-end;gap:10px;margin-top:4px">
          <button class="btn btn-sm" data-action="_adtFecharModal" style="background:var(--bg-card);color:var(--text-secondary)">Cancelar</button>
          <button class="btn btn-azul btn-sm" data-action="_adtSalvar">💾 Salvar Aditivo</button>
        </div>
      </div>`;
    document.body.appendChild(overlay);
  }

  abrirModal(titulo) {
    this.injectModalAditivo();
    const overlay = document.getElementById('adt-modal-overlay');
    if (overlay) {
      overlay.style.display = 'flex';
      document.getElementById('adt-modal-titulo').textContent = titulo;
    }
  }

  fecharModal() {
    const el = document.getElementById('adt-modal-overlay');
    if (el) el.style.display = 'none';
  }

  preencherModalNovo(aditivos, cfg) {
    document.getElementById('adt-edit-id').value = '';
    const prox = aditivos.length ? Math.max(...aditivos.map(a => parseInt(a.numero) || 0)) + 1 : 1;
    document.getElementById('adt-numero').value = prox;
    document.getElementById('adt-tipo').value = 'misto';
    document.getElementById('adt-descricao').value = '';
    document.getElementById('adt-processo').value = '';
    document.getElementById('adt-data').value = '';
    document.getElementById('adt-valor-anterior').value = cfg.valor || '';
    document.getElementById('adt-valor-novo').value = '';
    document.getElementById('adt-variacao').value = '';
    document.getElementById('adt-termino-anterior').value = dataParaInput(cfg.termino || '');
    document.getElementById('adt-prazo-adicional').value = '';
    document.getElementById('adt-termino-novo').value = '';
    document.getElementById('adt-status').value = 'Rascunho';
    document.getElementById('adt-aviso-versao').style.display = 'none';
    document.getElementById('adt-planilha-status').textContent = '';
  }

  preencherModalEditar(a) {
    document.getElementById('adt-edit-id').value = a.id;
    document.getElementById('adt-numero').value = a.numero;
    document.getElementById('adt-tipo').value = a.tipo || 'misto';
    document.getElementById('adt-descricao').value = a.descricao || '';
    document.getElementById('adt-processo').value = a.numeroProcesso || '';
    document.getElementById('adt-data').value = dataParaInput(a.data || '');
    document.getElementById('adt-valor-anterior').value = a.valorAnterior || '';
    document.getElementById('adt-valor-novo').value = a.valorNovo || '';
    document.getElementById('adt-termino-anterior').value = dataParaInput(a.terminoAnterior || '');
    document.getElementById('adt-prazo-adicional').value = a.prazoAdicionalDias || '';
    document.getElementById('adt-termino-novo').value = dataParaInput(a.terminoNovo || '');
    document.getElementById('adt-status').value = a.status || 'Rascunho';
    document.getElementById('adt-aviso-versao').style.display = 'none';
    const ni = a.itensMudados?.length || 0;
    document.getElementById('adt-planilha-status').textContent = ni > 0 ? `(${ni} item(ns) alterado(s) salvos)` : '';
    const ant = parseFloat(a.valorAnterior) || 0;
    const nov = parseFloat(a.valorNovo) || 0;
    if (ant && nov) {
      const v = trunc2(nov - ant), pct = ant > 0 ? (v / ant * 100) : 0;
      document.getElementById('adt-variacao').value = `${v >= 0 ? '+' : ''}${R$(v)} (${pct >= 0 ? '+' : ''}${pct.toFixed(1)}%)`;
    }
  }

  lerModal() {
    return {
      editId:         document.getElementById('adt-edit-id').value.trim(),
      numero:         parseInt(document.getElementById('adt-numero').value) || 1,
      tipo:           document.getElementById('adt-tipo').value,
      descricao:      document.getElementById('adt-descricao').value.trim(),
      processo:       document.getElementById('adt-processo').value.trim(),
      data:           document.getElementById('adt-data').value,
      valorAnterior:  parseFloat(document.getElementById('adt-valor-anterior').value) || 0,
      valorNovo:      parseFloat(document.getElementById('adt-valor-novo').value) || 0,
      terminoAnterior:document.getElementById('adt-termino-anterior').value,
      prazoAdicional: parseInt(document.getElementById('adt-prazo-adicional').value) || 0,
      terminoNovo:    document.getElementById('adt-termino-novo').value,
      status:         document.getElementById('adt-status').value,
    };
  }

  // ═══════════════════════════════════════════════════════════════
  // MODAL EDITOR DE PLANILHA
  // ═══════════════════════════════════════════════════════════════

  injectModalPlanilha() {
    if (document.getElementById('adt-planilha-modal-overlay')) return;
    const overlay = document.createElement('div');
    overlay.id = 'adt-planilha-modal-overlay';
    overlay.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,.65);z-index:1200;display:none;align-items:center;justify-content:center;padding:12px';
    overlay.innerHTML = `
      <div style="background:var(--bg-card);border:1px solid var(--border);border-radius:16px;padding:24px;width:100%;max-width:1100px;height:92vh;display:flex;flex-direction:column;box-shadow:0 24px 60px rgba(0,0,0,.5)">
        <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:16px;flex-shrink:0">
          <div>
            <div style="font-size:10px;font-weight:700;color:var(--text-muted);text-transform:uppercase;letter-spacing:.5px">Planilha do Aditivo</div>
            <div style="font-size:15px;font-weight:800;color:var(--text-primary)">Editor de Planilha Contratual</div>
          </div>
          <div style="display:flex;gap:8px;align-items:center">
            <button class="btn btn-sm" data-action="_adtPlanilhaReset" style="font-size:11px;background:var(--bg-warm);border:1px solid var(--border)">↩ Resetar</button>
            <button class="btn btn-sm" data-action="_adtPlanilhaAdicionarItem" style="font-size:11px;background:var(--green-soft);color:var(--green-text);border:1px solid var(--green)">+ Adicionar Item</button>
            <button class="btn btn-azul btn-sm" data-action="_adtPlanilhaAplicar" style="font-size:11px">✅ Aplicar ao Aditivo</button>
            <button data-action="_adtFecharPlanilhaEditor" style="background:none;border:none;font-size:24px;cursor:pointer;color:var(--text-muted);line-height:1">×</button>
          </div>
        </div>
        <div style="display:flex;gap:10px;flex-wrap:wrap;margin-bottom:12px;flex-shrink:0;font-size:10px">
          <span style="background:#bbf7d0;color:#15803d;border:1px solid #86efac;padding:2px 8px;border-radius:4px;font-weight:600">🟢 Valor Unit. Aumentado</span>
          <span style="background:#e9d5ff;color:#7e22ce;border:1px solid #d8b4fe;padding:2px 8px;border-radius:4px;font-weight:600">🟣 Valor Unit. Reduzido</span>
          <span style="background:#dbeafe;color:#1d4ed8;border:1px solid #93c5fd;padding:2px 8px;border-radius:4px;font-weight:600">🔵 Qtd Aumentada / Novo</span>
          <span style="background:#fecaca;color:#b91c1c;border:1px solid #fca5a5;padding:2px 8px;border-radius:4px;font-weight:600">🔴 Qtd Reduzida</span>
          <span style="background:#fef08a;color:#854d0e;border:1px solid #fde047;padding:2px 8px;border-radius:4px;font-weight:600">🟡 Suprimido (Qtd=0)</span>
        </div>
        <div id="adt-pl-stats" style="display:flex;gap:10px;flex-wrap:wrap;margin-bottom:12px;flex-shrink:0"></div>
        <div style="overflow:auto;flex:1;border:1px solid var(--border);border-radius:8px">
          <table style="width:100%;border-collapse:collapse;font-size:11.5px">
            <thead style="position:sticky;top:0;background:var(--bg-card-alt);z-index:5">
              <tr>
                <th style="padding:8px 10px;text-align:left;color:var(--text-on-panel);white-space:nowrap">Cód.</th>
                <th style="padding:8px 10px;text-align:left;color:var(--text-on-panel)">Descrição</th>
                <th style="padding:8px 10px;text-align:center;color:var(--text-on-panel);white-space:nowrap">Un.</th>
                <th style="padding:8px 10px;text-align:right;color:var(--text-on-panel);white-space:nowrap">Qtd Base</th>
                <th style="padding:8px 10px;text-align:right;color:var(--text-on-panel);white-space:nowrap">Qtd Nova</th>
                <th style="padding:8px 10px;text-align:right;color:var(--text-on-panel);white-space:nowrap">Δ Qtd</th>
                <th style="padding:8px 10px;text-align:right;color:var(--text-on-panel);white-space:nowrap">P. Unit.</th>
                <th style="padding:8px 10px;text-align:right;color:var(--text-on-panel);white-space:nowrap">Total (c/BDI)</th>
                <th style="padding:8px 10px;text-align:center;color:var(--text-on-panel)">Ações</th>
              </tr>
            </thead>
            <tbody id="adt-pl-tbody"></tbody>
          </table>
        </div>
      </div>`;
    document.body.appendChild(overlay);
  }

  abrirPlanilhaEditor() {
    this.injectModalPlanilha();
    document.getElementById('adt-planilha-modal-overlay').style.display = 'flex';
  }

  fecharPlanilhaEditor() {
    const el = document.getElementById('adt-planilha-modal-overlay');
    if (el) el.style.display = 'none';
  }

  // ─── Renderiza linhas da tabela de planilha ────────────────────
  // TODOS os inputs usam data-action + data-arg0 + data-value-from="this.value"
  // Sem nenhum onchange/oninput inline — compatível com CSP strict.
  renderPlanilha(planilhaDraft, planilhaBase, cfg) {
    const tbody = document.getElementById('adt-pl-tbody');
    if (!tbody) return;
    const bdi = cfg?.bdi || 0.25;

    if (!planilhaDraft.length) {
      tbody.innerHTML = `<tr><td colspan="9" style="text-align:center;padding:24px;color:var(--text-muted)">Nenhum item na planilha.</td></tr>`;
      this.renderStats([], bdi);
      return;
    }

    const rows = planilhaDraft.map((it, idx) => {
      // Grupo / Subgrupo
      if (it.t === 'G' || it.t === 'SG') {
        const pad = it.t === 'SG' ? 'padding-left:24px' : '';
        return `<tr style="background:var(--bg-warm);border-bottom:1px solid var(--border-subtle)">
          <td style="padding:6px 10px;font-family:var(--font-mono);white-space:nowrap;font-size:10px;${pad}">${it.id || ''}</td>
          <td colspan="7" style="padding:6px 10px;font-weight:700;color:var(--text-primary);font-size:11px">${it.desc || ''}</td>
          <td></td>
        </tr>`;
      }

      const base    = planilhaBase.find(b => b.id === it.id);
      const qtdB    = base ? (parseFloat(base.qtd) || 0) : 0;
      const upB     = base ? (parseFloat(base.up)  || 0) : 0;
      const qtdD    = parseFloat(it.qtd) || 0;
      const upD     = parseFloat(it.up)  || 0;
      const total   = trunc2(qtdD * upD * (1 + bdi));
      const delta   = base !== undefined ? trunc2(qtdD - qtdB) : null;
      const removido = !!it._adtRemovido;

      const trClass = removido
        ? 'linha-suprimiu-item'
        : base ? classeRealce(upD, upB, qtdD, qtdB) : (qtdD > 0 ? 'linha-aumento-qtd' : '');

      let deltaBadge = '';
      if (!base) {
        deltaBadge = `<span style="font-size:9px;background:#dbeafe;color:#1d4ed8;border:1px solid #93c5fd;padding:1px 5px;border-radius:3px;font-weight:700">NOVO</span>`;
      } else if (delta !== null && Math.abs(delta) > 0.0001) {
        const col = delta > 0 ? '#15803d' : '#b91c1c';
        deltaBadge = `<span style="font-size:10px;font-weight:700;color:${col}">${delta > 0 ? '+' : ''}${fmtN(delta)}</span>`;
      }

      // Inputs com data-action — sem onchange inline
      const inputQtd = removido
        ? `<span style="color:var(--text-muted)">${fmtN(qtdD)}</span>`
        : `<input type="number" value="${qtdD || ''}" step="0.0001"
            data-action="_adtPlanilhaEditQtd" data-arg0="${idx}" data-value-from="this.value"
            style="background:transparent;border:1px solid var(--border);border-radius:4px;width:80px;text-align:right;padding:3px 6px;font-size:11.5px;font-family:var(--font-mono);color:var(--text-primary)">`;

      const inputUp = removido
        ? `<span style="color:var(--text-muted)">${R$(upD)}</span>`
        : `<input type="number" value="${upD || ''}" step="0.01"
            data-action="_adtPlanilhaEditUp" data-arg0="${idx}" data-value-from="this.value"
            style="background:transparent;border:1px solid var(--border);border-radius:4px;width:95px;text-align:right;padding:3px 6px;font-size:11.5px;font-family:var(--font-mono);color:var(--text-primary)">`;

      const inputDesc = `<input type="text" value="${(it.desc || '').replace(/"/g, "'")}"
          data-action="_adtPlanilhaEditDesc" data-arg0="${idx}" data-value-from="this.value"
          style="background:transparent;border:none;width:100%;font-size:11.5px;color:var(--text-primary);outline:none;padding:0"
          ${removido ? 'disabled' : ''}>`;

      return `<tr class="${trClass}" style="border-bottom:1px solid var(--border-subtle);${removido ? 'opacity:.55;text-decoration:line-through;' : ''}">
        <td style="padding:6px 10px;font-family:var(--font-mono);font-size:10px;white-space:nowrap">${it.id || ''}</td>
        <td style="padding:6px 10px;max-width:220px">${inputDesc}</td>
        <td style="padding:6px 10px;text-align:center;font-family:var(--font-mono);font-size:10px">${it.un || ''}</td>
        <td style="padding:6px 10px;text-align:right;font-family:var(--font-mono);color:var(--text-muted);font-size:10px">${base !== undefined ? fmtN(qtdB) : '—'}</td>
        <td style="padding:6px 10px;text-align:right">${inputQtd}</td>
        <td style="padding:6px 10px;text-align:right">${deltaBadge}</td>
        <td style="padding:6px 10px;text-align:right">${inputUp}</td>
        <td style="padding:6px 10px;text-align:right;font-family:var(--font-mono);font-weight:600;font-size:11px">${removido ? '<span style="color:var(--red)">EXCLUÍDO</span>' : R$(total)}</td>
        <td style="padding:6px 10px;text-align:center;white-space:nowrap">
          ${removido
            ? `<button data-action="_adtPlanilhaRestaurar" data-arg0="${idx}" style="background:none;border:none;cursor:pointer;font-size:13px;padding:2px 4px" title="Restaurar">♻️</button>`
            : `<button data-action="_adtPlanilhaRemover" data-arg0="${idx}" style="background:none;border:none;cursor:pointer;font-size:13px;padding:2px 4px" title="Remover">✕</button>`}
        </td>
      </tr>`;
    });

    tbody.innerHTML = rows.join('');
    this.renderStats(planilhaDraft, bdi, planilhaBase);
  }

  renderStats(planilhaDraft, bdi = 0.25, planilhaBase = []) {
    const el = document.getElementById('adt-pl-stats');
    if (!el) return;
    const itensServico = planilhaDraft.filter(it => !it.t || it.t === 'item');
    const totalAtual = trunc2(itensServico.filter(it => !it._adtRemovido)
      .reduce((s, it) => s + trunc2((parseFloat(it.qtd)||0)*(parseFloat(it.up)||0)*(1+bdi)), 0));
    const cnt = { 'linha-aumento-valor':0,'linha-diminuiu-valor':0,'linha-aumento-qtd':0,'linha-diminuiu-qtd':0,'linha-suprimiu-item':0 };
    itensServico.forEach(it => {
      if (it._adtRemovido) { cnt['linha-suprimiu-item']++; return; }
      const base = planilhaBase.find(b => b.id === it.id);
      const cls  = !base ? ((parseFloat(it.qtd)||0)>0?'linha-aumento-qtd':'') : classeRealce(it.up, base.up, it.qtd, base.qtd);
      if (cls) cnt[cls]++;
    });
    el.innerHTML = `
      <div style="background:var(--bg-warm);border:1px solid var(--border);border-radius:6px;padding:8px 12px;text-align:center">
        <div style="font-size:9px;color:var(--text-muted);text-transform:uppercase">Total Atual</div>
        <div style="font-weight:700;font-family:var(--font-mono);color:var(--text-primary);font-size:13px">${R$(totalAtual)}</div>
      </div>
      <div style="background:#bbf7d0;border:1px solid #86efac;border-radius:6px;padding:8px 12px;text-align:center">
        <div style="font-size:9px;color:#15803d;text-transform:uppercase">🟢 Valor ▲</div>
        <div style="font-weight:700;color:#15803d;font-size:13px">${cnt['linha-aumento-valor']}</div>
      </div>
      <div style="background:#e9d5ff;border:1px solid #d8b4fe;border-radius:6px;padding:8px 12px;text-align:center">
        <div style="font-size:9px;color:#7e22ce;text-transform:uppercase">🟣 Valor ▼</div>
        <div style="font-weight:700;color:#7e22ce;font-size:13px">${cnt['linha-diminuiu-valor']}</div>
      </div>
      <div style="background:#dbeafe;border:1px solid #93c5fd;border-radius:6px;padding:8px 12px;text-align:center">
        <div style="font-size:9px;color:#1d4ed8;text-transform:uppercase">🔵 Qtd ▲ / Novos</div>
        <div style="font-weight:700;color:#1d4ed8;font-size:13px">${cnt['linha-aumento-qtd']}</div>
      </div>
      <div style="background:#fecaca;border:1px solid #fca5a5;border-radius:6px;padding:8px 12px;text-align:center">
        <div style="font-size:9px;color:#b91c1c;text-transform:uppercase">🔴 Qtd ▼</div>
        <div style="font-weight:700;color:#b91c1c;font-size:13px">${cnt['linha-diminuiu-qtd']}</div>
      </div>
      <div style="background:#fef08a;border:1px solid #fde047;border-radius:6px;padding:8px 12px;text-align:center">
        <div style="font-size:9px;color:#854d0e;text-transform:uppercase">🟡 Suprimidos</div>
        <div style="font-weight:700;color:#854d0e;font-size:13px">${cnt['linha-suprimiu-item']}</div>
      </div>`;
  }

  // ═══════════════════════════════════════════════════════════════
  // MODAL NOVO ITEM
  // ═══════════════════════════════════════════════════════════════

  injectModalNovoItem() {
    if (document.getElementById('adt-novoitem-modal-overlay')) return;
    const overlay = document.createElement('div');
    overlay.id = 'adt-novoitem-modal-overlay';
    overlay.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,.72);z-index:1500;display:none;align-items:center;justify-content:center;padding:20px';
    overlay.innerHTML = `
      <div style="background:var(--bg-card);border:1px solid var(--border);border-radius:16px;padding:28px;width:100%;max-width:560px;box-shadow:0 24px 60px rgba(0,0,0,.55)">
        <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:20px">
          <div>
            <div style="font-size:10px;font-weight:700;color:var(--text-muted);text-transform:uppercase;letter-spacing:.5px">Planilha do Aditivo</div>
            <div style="font-size:15px;font-weight:800;color:var(--text-primary)">★ Incluir Novo Item</div>
          </div>
          <button data-action="_adtNovoItemFechar" style="background:none;border:none;font-size:24px;cursor:pointer;color:var(--text-muted);line-height:1">×</button>
        </div>
        <div style="background:#dbeafe;border:1px solid #93c5fd;border-radius:8px;padding:10px 14px;margin-bottom:18px;font-size:11.5px;color:#1d4ed8">
          <strong>📌 Posicionamento automático:</strong> O item é inserido após o código numericamente anterior.<br>
          <span style="font-size:11px;margin-top:3px;display:block">Ex.: adicionando <strong>4.5.6</strong> → inserido após <strong>4.5.5</strong>.</span>
        </div>
        <div style="margin-bottom:14px">
          <label style="font-size:11px;font-weight:700;color:var(--text-muted);display:block;margin-bottom:5px">Código do Item <span style="color:var(--red)">*</span></label>
          <input type="text" id="adt-ni-codigo" placeholder="Ex.: 4.5.6" class="campo-input"
            style="width:100%;font-family:var(--font-mono);font-size:14px;font-weight:700;letter-spacing:.5px"
            data-action="_adtNovoItemPreviewPosicao">
          <div id="adt-ni-preview" style="margin-top:6px;font-size:11px;color:var(--text-muted);min-height:16px"></div>
        </div>
        <div style="margin-bottom:14px">
          <label style="font-size:11px;font-weight:700;color:var(--text-muted);display:block;margin-bottom:5px">Descrição <span style="color:var(--red)">*</span></label>
          <input type="text" id="adt-ni-desc" placeholder="Descreva o item..." class="campo-input" style="width:100%">
        </div>
        <div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:12px;margin-bottom:18px">
          <div>
            <label style="font-size:11px;font-weight:700;color:var(--text-muted);display:block;margin-bottom:5px">Unidade</label>
            <input type="text" id="adt-ni-un" placeholder="m², kg…" class="campo-input" style="width:100%;text-align:center">
          </div>
          <div>
            <label style="font-size:11px;font-weight:700;color:var(--text-muted);display:block;margin-bottom:5px">Quantidade</label>
            <input type="number" id="adt-ni-qtd" placeholder="0,00" step="0.0001" min="0" class="campo-input"
              style="width:100%;text-align:right;font-family:var(--font-mono)"
              data-action="_adtNovoItemCalcTotal">
          </div>
          <div>
            <label style="font-size:11px;font-weight:700;color:var(--text-muted);display:block;margin-bottom:5px">Preço Unit.</label>
            <input type="number" id="adt-ni-up" placeholder="0,00" step="0.01" min="0" class="campo-input"
              style="width:100%;text-align:right;font-family:var(--font-mono)"
              data-action="_adtNovoItemCalcTotal">
          </div>
        </div>
        <div style="background:var(--bg-warm);border:1px solid var(--border);border-radius:8px;padding:12px 16px;margin-bottom:20px;display:flex;align-items:center;justify-content:space-between">
          <span style="font-size:11px;color:var(--text-muted)">Total estimado (c/BDI):</span>
          <span id="adt-ni-total" style="font-size:14px;font-weight:800;font-family:var(--font-mono);color:var(--green)">R$ 0,00</span>
        </div>
        <div id="adt-ni-erro" style="display:none;background:#fee2e2;border:1px solid #fca5a5;border-radius:8px;padding:10px 14px;margin-bottom:14px;font-size:12px;color:#b91c1c"></div>
        <div style="display:flex;justify-content:flex-end;gap:10px">
          <button class="btn btn-sm" data-action="_adtNovoItemFechar" style="background:var(--bg-card);color:var(--text-secondary)">Cancelar</button>
          <button class="btn btn-azul btn-sm" data-action="_adtNovoItemConfirmar" style="padding:8px 20px">★ Incluir Item</button>
        </div>
      </div>`;
    document.body.appendChild(overlay);
  }

  abrirModalNovoItem() {
    this.injectModalNovoItem();
    const overlay = document.getElementById('adt-novoitem-modal-overlay');
    if (!overlay) return;
    ['adt-ni-codigo','adt-ni-desc','adt-ni-un','adt-ni-qtd','adt-ni-up'].forEach(id => {
      const el = document.getElementById(id); if (el) el.value = '';
    });
    document.getElementById('adt-ni-preview').textContent = '';
    document.getElementById('adt-ni-total').textContent = 'R$ 0,00';
    document.getElementById('adt-ni-erro').style.display = 'none';
    overlay.style.display = 'flex';
    setTimeout(() => document.getElementById('adt-ni-codigo')?.focus(), 80);
  }

  fecharModalNovoItem() {
    const el = document.getElementById('adt-novoitem-modal-overlay');
    if (el) el.style.display = 'none';
  }

  lerModalNovoItem() {
    return {
      codigo: (document.getElementById('adt-ni-codigo')?.value || '').trim(),
      desc:   (document.getElementById('adt-ni-desc')?.value   || '').trim(),
      un:     (document.getElementById('adt-ni-un')?.value     || '').trim(),
      qtd:    parseFloat(document.getElementById('adt-ni-qtd')?.value) || 0,
      up:     parseFloat(document.getElementById('adt-ni-up')?.value)  || 0,
    };
  }

  mostrarErroNovoItem(msg) {
    const el = document.getElementById('adt-ni-erro');
    if (!el) return;
    el.textContent = msg; el.style.display = 'block';
  }
  limparErroNovoItem() {
    const el = document.getElementById('adt-ni-erro');
    if (el) el.style.display = 'none';
  }
  atualizarPreviewNovoItem(texto, cor = 'var(--text-muted)') {
    const el = document.getElementById('adt-ni-preview');
    if (el) { el.textContent = texto; el.style.color = cor; }
  }

  // ═══════════════════════════════════════════════════════════════
  // VISUALIZAÇÃO DA PLANILHA (somente leitura)
  // ═══════════════════════════════════════════════════════════════

  injectModalVisualizacao() {
    if (document.getElementById('adt-view-modal-overlay')) return;
    const overlay = document.createElement('div');
    overlay.id = 'adt-view-modal-overlay';
    overlay.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,.65);z-index:1300;display:none;align-items:center;justify-content:center;padding:16px';
    overlay.innerHTML = `
      <div style="background:var(--bg-card);border:1px solid var(--border);border-radius:16px;padding:24px;width:100%;max-width:1050px;max-height:94vh;display:flex;flex-direction:column;box-shadow:0 24px 60px rgba(0,0,0,.5)">
        <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:14px;flex-shrink:0">
          <div id="adt-view-titulo" style="font-size:15px;font-weight:800;color:var(--text-primary)"></div>
          <div style="display:flex;gap:8px">
            <button class="btn btn-sm" data-action="_adtGerarPDF" style="font-size:11px">📄 Gerar PDF</button>
            <button data-action="_adtFecharViewModal" style="background:none;border:none;font-size:24px;cursor:pointer;color:var(--text-muted)">×</button>
          </div>
        </div>
        <div style="display:flex;gap:8px;flex-wrap:wrap;margin-bottom:12px;flex-shrink:0;font-size:10px">
          <span style="background:#bbf7d0;color:#15803d;border:1px solid #86efac;padding:2px 8px;border-radius:4px;font-weight:600">🟢 Valor Unit. Aumentado</span>
          <span style="background:#e9d5ff;color:#7e22ce;border:1px solid #d8b4fe;padding:2px 8px;border-radius:4px;font-weight:600">🟣 Valor Unit. Reduzido</span>
          <span style="background:#dbeafe;color:#1d4ed8;border:1px solid #93c5fd;padding:2px 8px;border-radius:4px;font-weight:600">🔵 Qtd Aumentada / Novo</span>
          <span style="background:#fecaca;color:#b91c1c;border:1px solid #fca5a5;padding:2px 8px;border-radius:4px;font-weight:600">🔴 Qtd Reduzida</span>
          <span style="background:#fef08a;color:#854d0e;border:1px solid #fde047;padding:2px 8px;border-radius:4px;font-weight:600">🟡 Suprimido</span>
        </div>
        <div id="adt-view-resumo" style="flex-shrink:0"></div>
        <div id="adt-view-corpo" style="overflow-y:auto;flex:1;border:1px solid var(--border);border-radius:8px;margin-top:12px"></div>
      </div>`;
    document.body.appendChild(overlay);
  }

  mostrarVisualizacao(aditivo, cfg) {
    this.injectModalVisualizacao();
    document.getElementById('adt-view-modal-overlay').style.display = 'flex';
    document.getElementById('adt-view-titulo').textContent =
      `Planilha do Aditivo Nº ${String(aditivo.numero).padStart(2,'0')} — ${aditivo.descricao?.slice(0,55)||''}`;

    const bdi = cfg?.bdi || 0.25;
    const itensMudados = aditivo.itensMudados || [];
    const planilha     = aditivo.itensSnapshot || [];
    const totais       = calcularTotais(itensMudados, bdi);
    const delta        = trunc2((aditivo.valorNovo || 0) - (aditivo.valorAnterior || 0));
    const dias         = parseInt(aditivo.prazoAdicionalDias) || 0;
    const prazoStr     = dias === 0 ? 'Sem alteração' : `${dias > 0 ? '+' : ''}${dias}d`;
    const mapMudancas  = {};
    itensMudados.forEach(m => { mapMudancas[m.itemId] = m; });

    const resumoEl = document.getElementById('adt-view-resumo');
    if (resumoEl) resumoEl.innerHTML = `
      <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(140px,1fr));gap:8px;margin-bottom:10px">
        ${this._cardInfo('Nº Aditivo', `Nº ${String(aditivo.numero).padStart(2,'0')}`, 'var(--accent)')}
        ${this._cardInfo('Data', aditivo.data || '—')}
        ${this._cardInfo('Tipo', TIPO_LABEL[aditivo.tipo] || aditivo.tipo)}
        ${this._cardInfo('Valor Anterior', R$(aditivo.valorAnterior || 0))}
        ${this._cardInfo('Valor Novo', R$(aditivo.valorNovo || 0), 'var(--green)')}
        ${this._cardInfo('Variação', `${delta >= 0 ? '+' : ''}${R$(delta)}`, delta >= 0 ? 'var(--green)' : 'var(--red)')}
        ${this._cardInfo('Prazo', prazoStr, dias !== 0 ? (dias > 0 ? 'var(--green)' : 'var(--red)') : 'var(--text-muted)')}
        ${this._cardInfo('Status', aditivo.status || 'Rascunho', STATUS_COLOR[aditivo.status] || 'var(--text-muted)')}
      </div>
      <div style="display:grid;grid-template-columns:repeat(3,1fr);gap:8px">
        <div style="background:#dcfce7;border:1px solid #86efac;border-radius:8px;padding:10px;text-align:center">
          <div style="font-size:9px;color:#15803d;text-transform:uppercase;font-weight:700">Acréscimos (c/BDI)</div>
          <div style="font-weight:800;font-family:var(--font-mono);color:#15803d;font-size:13px">+${R$(totais.acrescimos)}</div>
        </div>
        <div style="background:#fee2e2;border:1px solid #fca5a5;border-radius:8px;padding:10px;text-align:center">
          <div style="font-size:9px;color:#b91c1c;text-transform:uppercase;font-weight:700">Supressões (c/BDI)</div>
          <div style="font-weight:800;font-family:var(--font-mono);color:#b91c1c;font-size:13px">−${R$(totais.supressoes)}</div>
        </div>
        <div style="background:var(--bg-warm);border:1px solid var(--border);border-radius:8px;padding:10px;text-align:center">
          <div style="font-size:9px;color:var(--text-muted);text-transform:uppercase;font-weight:700">Saldo Líquido</div>
          <div style="font-weight:800;font-family:var(--font-mono);color:${totais.liquido >= 0 ? 'var(--green)' : 'var(--red)'};font-size:13px">${totais.liquido >= 0 ? '+' : ''}${R$(totais.liquido)}</div>
        </div>
      </div>`;

    const corpoEl = document.getElementById('adt-view-corpo');
    if (!corpoEl) return;
    if (!planilha.length) {
      corpoEl.innerHTML = `<div style="text-align:center;padding:32px;color:var(--text-muted);font-size:12px">Planilha completa não disponível.<br><em style="font-size:11px">Edite e salve novamente o aditivo para habilitar.</em></div>`;
      return;
    }

    const totalItens = planilha.filter(i => !i.t || i.t === 'item').length;
    const badgeMap = {
      'linha-aumento-valor':  `<span style="font-size:9px;background:#bbf7d0;color:#15803d;border:1px solid #86efac;padding:2px 6px;border-radius:3px;font-weight:700">▲ PREÇO</span>`,
      'linha-diminuiu-valor': `<span style="font-size:9px;background:#e9d5ff;color:#7e22ce;border:1px solid #d8b4fe;padding:2px 6px;border-radius:3px;font-weight:700">▼ PREÇO</span>`,
      'linha-aumento-qtd':    `<span style="font-size:9px;background:#dbeafe;color:#1d4ed8;border:1px solid #93c5fd;padding:2px 6px;border-radius:3px;font-weight:700">▲ QTD</span>`,
      'linha-diminuiu-qtd':   `<span style="font-size:9px;background:#fecaca;color:#b91c1c;border:1px solid #fca5a5;padding:2px 6px;border-radius:3px;font-weight:700">▼ QTD</span>`,
      'linha-suprimiu-item':  `<span style="font-size:9px;background:#fef08a;color:#854d0e;border:1px solid #fde047;padding:2px 6px;border-radius:3px;font-weight:700">✕ SUPRIMIDO</span>`,
    };

    corpoEl.innerHTML = `
      <div style="padding:7px 12px;background:var(--bg-warm);border-bottom:1px solid var(--border);font-size:11px;color:var(--text-muted);display:flex;justify-content:space-between">
        <span><strong>${totalItens}</strong> item(ns)</span>
        <span><strong>${itensMudados.length}</strong> item(ns) alterado(s)</span>
      </div>
      <table style="width:100%;border-collapse:collapse;font-size:11.5px">
        <thead style="position:sticky;top:0;background:var(--bg-card-alt);z-index:5">
          <tr>
            <th style="padding:8px 10px;text-align:left;color:var(--text-on-panel);white-space:nowrap">Cód.</th>
            <th style="padding:8px 10px;text-align:left;color:var(--text-on-panel)">Descrição</th>
            <th style="padding:8px 10px;text-align:center;color:var(--text-on-panel)">Un.</th>
            <th style="padding:8px 10px;text-align:right;color:var(--text-on-panel);white-space:nowrap">Qtd Anterior</th>
            <th style="padding:8px 10px;text-align:right;color:var(--text-on-panel);white-space:nowrap">Qtd Vigente</th>
            <th style="padding:8px 10px;text-align:right;color:var(--text-on-panel);white-space:nowrap">P. Unit.</th>
            <th style="padding:8px 10px;text-align:right;color:var(--text-on-panel);white-space:nowrap">Total (c/BDI)</th>
            <th style="padding:8px 10px;text-align:center;color:var(--text-on-panel)">Situação</th>
          </tr>
        </thead>
        <tbody>
          ${planilha.map(it => {
            if (it.t === 'G' || it.t === 'SG') {
              return `<tr style="background:var(--bg-warm);border-bottom:1px solid var(--border-subtle)">
                <td style="padding:6px 10px;font-family:var(--font-mono);font-size:10px">${it.id||''}</td>
                <td colspan="7" style="padding:6px 10px;font-weight:700;font-size:11px">${it.desc||''}</td>
              </tr>`;
            }
            const mudanca  = mapMudancas[it.id];
            const qtdV     = parseFloat(it.qtd) || 0;
            const upV      = parseFloat(it.up)  || 0;
            const total    = trunc2(qtdV * upV * (1 + bdi));
            const qtdAnt   = mudanca?.qtdAnterior != null ? mudanca.qtdAnterior : qtdV;
            const upAnt    = mudanca?.upAnterior  != null ? mudanca.upAnterior  : upV;
            const removido = mudanca?.operacao === 'exclusao' || (mudanca && qtdV === 0 && (parseFloat(mudanca.qtdAnterior)||0) > 0);
            const trClass  = mudanca ? (mudanca.operacao === 'exclusao' ? 'linha-suprimiu-item' : classeRealce(upV, upAnt, qtdV, qtdAnt)) : '';
            const situacao = mudanca?.operacao === 'inclusao'
              ? `<span style="font-size:9px;background:#dbeafe;color:#1d4ed8;border:1px solid #93c5fd;padding:2px 6px;border-radius:3px;font-weight:700">★ NOVO</span>`
              : (badgeMap[trClass] || `<span style="color:var(--text-muted);font-size:10px">—</span>`);
            return `<tr class="${trClass}" style="border-bottom:1px solid var(--border-subtle);${removido ? 'opacity:.6;' : ''}">
              <td style="padding:6px 10px;font-family:var(--font-mono);font-size:10px;white-space:nowrap">${it.id||''}</td>
              <td style="padding:6px 10px;max-width:240px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${it.desc||'—'}</td>
              <td style="padding:6px 10px;text-align:center;font-family:var(--font-mono);font-size:10px">${it.un||''}</td>
              <td style="padding:6px 10px;text-align:right;font-family:var(--font-mono);font-size:11px;color:var(--text-muted)">${fmtN(qtdAnt)}</td>
              <td style="padding:6px 10px;text-align:right;font-family:var(--font-mono);font-weight:${mudanca?700:400};font-size:11px">${removido ? `<s style="color:var(--red)">${fmtN(qtdV)}</s>` : fmtN(qtdV)}</td>
              <td style="padding:6px 10px;text-align:right;font-family:var(--font-mono);font-size:11px">${R$(upV)}</td>
              <td style="padding:6px 10px;text-align:right;font-family:var(--font-mono);font-weight:600;font-size:11px">${removido ? '—' : R$(total)}</td>
              <td style="padding:6px 10px;text-align:center">${situacao}</td>
            </tr>`;
          }).join('')}
        </tbody>
      </table>`;
  }

  _cardInfo(label, valor, cor = 'var(--text-primary)') {
    return `<div style="background:var(--bg-warm);border:1px solid var(--border);border-radius:6px;padding:10px">
      <div style="font-size:9px;color:var(--text-muted);text-transform:uppercase;letter-spacing:.5px;margin-bottom:3px">${label}</div>
      <div style="font-size:13px;font-weight:700;color:${cor}">${valor}</div>
    </div>`;
  }

  // ═══════════════════════════════════════════════════════════════
  // MODAL SNAPSHOT DE VERSÃO
  // ═══════════════════════════════════════════════════════════════

  injectModalVersao() {
    if (document.getElementById('adt-versao-modal-overlay')) return;
    const overlay = document.createElement('div');
    overlay.id = 'adt-versao-modal-overlay';
    overlay.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,.65);z-index:1400;display:none;align-items:center;justify-content:center;padding:16px';
    overlay.innerHTML = `
      <div style="background:var(--bg-card);border:1px solid var(--border);border-radius:16px;padding:24px;width:100%;max-width:800px;max-height:90vh;overflow-y:auto;box-shadow:0 24px 60px rgba(0,0,0,.5)">
        <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:16px">
          <div id="adt-versao-modal-titulo" style="font-size:15px;font-weight:800;color:var(--text-primary)"></div>
          <button data-action="_adtFecharVersaoModal" style="background:none;border:none;font-size:24px;cursor:pointer;color:var(--text-muted)">×</button>
        </div>
        <div id="adt-versao-modal-corpo"></div>
      </div>`;
    document.body.appendChild(overlay);
  }

  mostrarVersao(versao) {
    this.injectModalVersao();
    document.getElementById('adt-versao-modal-overlay').style.display = 'flex';
    document.getElementById('adt-versao-modal-titulo').textContent =
      `Versão Contratual v${versao.numero} — ${versao.descricao || ''}`;
    const cfg   = versao.cfgSnapshot  || {};
    const itens = versao.itensSnapshot || [];
    document.getElementById('adt-versao-modal-corpo').innerHTML = `
      <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(160px,1fr));gap:8px;margin-bottom:16px">
        ${this._cardInfo('Valor', R$(cfg.valor || 0), 'var(--green)')}
        ${this._cardInfo('Término', cfg.termino ? dataBR(cfg.termino) : '—')}
        ${this._cardInfo('BDI', `${((cfg.bdi || 0) * 100).toFixed(1)}%`)}
        ${this._cardInfo('Tipo', versao.tipo === 'original' ? '🏗️ Original' : '📝 Aditivo', 'var(--accent)')}
      </div>
      <div style="font-size:11px;color:var(--text-muted);margin-bottom:8px">🔒 Snapshot imutável · <strong>${itens.length} itens</strong></div>
      <div style="overflow:auto;border:1px solid var(--border);border-radius:8px;max-height:380px">
        <table style="width:100%;border-collapse:collapse;font-size:11px">
          <thead style="position:sticky;top:0;background:var(--bg-card-alt)">
            <tr>${['Cód.','Descrição','Un.','Qtd','P. Unit.'].map(h =>
              `<th style="padding:6px 8px;color:var(--text-on-panel);text-align:${h==='Descrição'?'left':'right'};white-space:nowrap">${h}</th>`
            ).join('')}</tr>
          </thead>
          <tbody>
            ${itens.slice(0, 500).map(i => {
              if (i.t && i.t !== 'item') return `<tr style="background:var(--bg-warm)"><td colspan="5" style="padding:5px 10px;font-weight:700">${i.id||''} — ${i.desc||''}</td></tr>`;
              return `<tr style="border-bottom:1px solid var(--border-subtle)">
                <td style="padding:5px 8px;font-family:var(--font-mono);font-size:10px">${i.id||'—'}</td>
                <td style="padding:5px 8px">${i.desc||''}</td>
                <td style="padding:5px 8px;text-align:right;font-family:var(--font-mono)">${i.un||''}</td>
                <td style="padding:5px 8px;text-align:right;font-family:var(--font-mono)">${i.qtd!=null?fmtN(i.qtd):''}</td>
                <td style="padding:5px 8px;text-align:right;font-family:var(--font-mono)">${i.up!=null?R$(i.up):''}</td>
              </tr>`;
            }).join('')}
          </tbody>
        </table>
      </div>`;
  }

  // ═══════════════════════════════════════════════════════════════
  // GERAÇÃO DE PDF
  // ═══════════════════════════════════════════════════════════════

  gerarPDF(aditivo, cfg) {
    const itensMudados = aditivo.itensMudados || [];
    const planilha     = aditivo.itensSnapshot || [];
    const bdi          = cfg?.bdi || 0.25;
    const totais       = calcularTotais(itensMudados, bdi);
    const delta        = trunc2((aditivo.valorNovo || 0) - (aditivo.valorAnterior || 0));
    const dias         = parseInt(aditivo.prazoAdicionalDias) || 0;
    const prazoStr     = dias === 0 ? 'Sem alteração' : `${dias > 0 ? '+' : ''}${dias} dia(s)`;
    const agora        = new Date();
    const mapMudancas  = {};
    itensMudados.forEach(m => { mapMudancas[m.itemId] = m; });

    const bgPDF   = { 'linha-aumento-valor':'#bbf7d0','linha-diminuiu-valor':'#e9d5ff','linha-aumento-qtd':'#dbeafe','linha-diminuiu-qtd':'#fecaca','linha-suprimiu-item':'#fef08a' };
    const txtPDF  = { 'linha-aumento-valor':'#15803d','linha-diminuiu-valor':'#7e22ce','linha-aumento-qtd':'#1d4ed8','linha-diminuiu-qtd':'#b91c1c','linha-suprimiu-item':'#854d0e' };
    const lblPDF  = { 'linha-aumento-valor':'▲ PREÇO','linha-diminuiu-valor':'▼ PREÇO','linha-aumento-qtd':'▲ QTD','linha-diminuiu-qtd':'▼ QTD','linha-suprimiu-item':'✕ SUPRIM.' };

    const fonte = planilha.length ? planilha : itensMudados;
    let linhas = '';
    if (!fonte.length) {
      linhas = `<tr><td colspan="8" style="text-align:center;padding:14px;color:#6b7280">Nenhum item registrado.</td></tr>`;
    } else if (planilha.length) {
      linhas = planilha.map(it => {
        if (it.t === 'G' || it.t === 'SG') return `<tr style="background:#f3f4f6"><td colspan="8" style="padding:4px 8px;font-weight:700;font-size:7.5pt">${it.id||''} — ${it.desc||''}</td></tr>`;
        const mudanca  = mapMudancas[it.id];
        const qtdV     = parseFloat(it.qtd) || 0;
        const upV      = parseFloat(it.up)  || 0;
        const total    = trunc2(qtdV * upV * (1 + bdi));
        const qtdAnt   = mudanca?.qtdAnterior != null ? mudanca.qtdAnterior : qtdV;
        const upAnt    = mudanca?.upAnterior  != null ? mudanca.upAnterior  : upV;
        const removido = mudanca?.operacao === 'exclusao' || (mudanca && qtdV === 0 && (parseFloat(mudanca.qtdAnterior)||0) > 0);
        const trClass  = mudanca ? (mudanca.operacao === 'exclusao' ? 'linha-suprimiu-item' : classeRealce(upV, upAnt, qtdV, qtdAnt)) : '';
        const bg       = bgPDF[trClass] || '';
        let situacao = '';
        if (mudanca?.operacao === 'inclusao') situacao = `<span style="font-size:6pt;background:#dbeafe;color:#1d4ed8;padding:1px 4px;border-radius:2px;font-weight:700">★ NOVO</span>`;
        else if (trClass && bg) situacao = `<span style="font-size:6pt;background:${bg};color:${txtPDF[trClass]};padding:1px 4px;border-radius:2px;font-weight:700">${lblPDF[trClass]}</span>`;
        return `<tr style="border-bottom:1px solid #f3f4f6;${bg?`background-color:${bg};`:''}">
          <td style="font-family:monospace;font-size:7pt;padding:4px 6px">${it.id||'—'}</td>
          <td style="font-size:7.5pt;padding:4px 6px">${it.desc||'—'}</td>
          <td style="text-align:center;padding:4px 6px;font-size:6pt">${it.un||''}</td>
          <td style="text-align:right;font-family:monospace;font-size:7pt;padding:4px 6px;color:#6b7280">${mudanca?fmtN(qtdAnt):fmtN(qtdV)}</td>
          <td style="text-align:right;font-family:monospace;font-size:7.5pt;padding:4px 6px;font-weight:${mudanca?700:400}">${removido?`<s>${fmtN(qtdV)}</s>`:fmtN(qtdV)}</td>
          <td style="text-align:right;font-family:monospace;font-size:7.5pt;padding:4px 6px">${R$(upV)}</td>
          <td style="text-align:right;font-family:monospace;font-size:7.5pt;padding:4px 6px;font-weight:600">${removido?'—':R$(total)}</td>
          <td style="text-align:center;padding:4px 6px">${situacao}</td>
        </tr>`;
      }).join('');
    } else {
      linhas = itensMudados.map(it => {
        const tot = trunc2((parseFloat(it.qtdNova)||0)*(parseFloat(it.upNova)||0)*(1+bdi));
        const trClass = it.operacao === 'exclusao' ? 'linha-suprimiu-item' : it.operacao === 'inclusao' ? 'linha-aumento-qtd' : classeRealce(it.upNova, it.upAnterior, it.qtdNova, it.qtdAnterior);
        const bg = bgPDF[trClass] || '';
        return `<tr style="border-bottom:1px solid #f3f4f6;${bg?`background:${bg};`:''}">
          <td style="font-family:monospace;font-size:7pt;padding:4px 6px">${it.itemId||'—'}</td>
          <td style="font-size:7.5pt;padding:4px 6px">${it.descricao||'—'}</td>
          <td></td>
          <td style="text-align:right;font-family:monospace;font-size:7pt;padding:4px 6px;color:#6b7280">${it.qtdAnterior??''}</td>
          <td style="text-align:right;font-family:monospace;font-size:7.5pt;padding:4px 6px;font-weight:700">${it.qtdNova??''}</td>
          <td style="text-align:right;font-family:monospace;font-size:7.5pt;padding:4px 6px">${it.upNova!=null?R$(it.upNova):'—'}</td>
          <td style="text-align:right;font-family:monospace;font-size:7.5pt;padding:4px 6px;font-weight:600">${it.operacao!=='exclusao'?R$(tot):'—'}</td>
          <td></td>
        </tr>`;
      }).join('');
    }

    const html = `<!DOCTYPE html><html lang="pt-BR"><head><meta charset="UTF-8">
<title>Aditivo Nº ${String(aditivo.numero).padStart(2,'0')}</title>
<style>*{box-sizing:border-box;margin:0;padding:0}body{font-family:Arial,sans-serif;font-size:9pt;color:#1f2937;background:#fff;padding:16mm 12mm}.header{text-align:center;border-bottom:3px solid #1d4ed8;padding-bottom:10px;margin-bottom:14px}.header h1{font-size:13pt;color:#1d4ed8;font-weight:800}.info-grid{display:grid;grid-template-columns:repeat(3,1fr);gap:6px;margin-bottom:12px}.info-box{background:#f9fafb;border:1px solid #e5e7eb;border-radius:5px;padding:6px 8px}.info-box .lbl{font-size:6.5pt;text-transform:uppercase;color:#9ca3af;margin-bottom:2px}.info-box .val{font-weight:700;font-size:8.5pt}.kpi-grid{display:grid;grid-template-columns:repeat(3,1fr);gap:6px;margin-bottom:12px}.kpi-box{border-radius:5px;padding:8px;text-align:center}.kpi-lbl{font-size:6.5pt;text-transform:uppercase;font-weight:700;margin-bottom:3px}.kpi-val{font-weight:800;font-size:10pt;font-family:monospace}table{width:100%;border-collapse:collapse}th{background:#f3f4f6;color:#374151;font-weight:700;padding:5px 6px;border:1px solid #d1d5db;text-align:right;font-size:7pt}th:nth-child(1),th:nth-child(2){text-align:left}td{padding:4px 5px;border-bottom:1px solid #f3f4f6;vertical-align:middle;font-size:7.5pt}.assinaturas{display:grid;grid-template-columns:repeat(3,1fr);gap:16px;margin-top:55px}.assinatura{text-align:center;border-top:1px solid #374151;padding-top:5px}.rodape{margin-top:16px;font-size:6.5pt;color:#9ca3af;text-align:center;border-top:1px solid #e5e7eb;padding-top:6px}@media print{@page{size:A4 landscape;margin:8mm}body{padding:8mm}}</style>
</head><body>
<div class="header"><h1>PLANILHA DE ADITIVO CONTRATUAL — Nº ${String(aditivo.numero).padStart(2,'0')}</h1><p>${cfg?.objeto||''}</p></div>
<div class="info-grid">
  <div class="info-box"><div class="lbl">Contrato</div><div class="val">${cfg?.contrato||'—'}</div></div>
  <div class="info-box"><div class="lbl">Nº Aditivo</div><div class="val">Nº ${String(aditivo.numero).padStart(2,'0')}</div></div>
  <div class="info-box"><div class="lbl">Data</div><div class="val">${aditivo.data||'—'}</div></div>
  <div class="info-box"><div class="lbl">Tipo</div><div class="val">${TIPO_LABEL[aditivo.tipo]||aditivo.tipo}</div></div>
  <div class="info-box"><div class="lbl">Status</div><div class="val">${aditivo.status||'Rascunho'}</div></div>
  <div class="info-box"><div class="lbl">Prazo</div><div class="val">${prazoStr}</div></div>
  <div class="info-box"><div class="lbl">Valor Anterior</div><div class="val">${aditivo.valorAnterior?R$(aditivo.valorAnterior):'—'}</div></div>
  <div class="info-box"><div class="lbl">Novo Valor</div><div class="val">${aditivo.valorNovo?R$(aditivo.valorNovo):'—'}</div></div>
  <div class="info-box"><div class="lbl">Versão Gerada</div><div class="val">v${aditivo.contractVersionNova||'—'}</div></div>
  ${aditivo.descricao?`<div class="info-box" style="grid-column:span 3"><div class="lbl">Descrição</div><div class="val">${aditivo.descricao}</div></div>`:''}
</div>
<div class="kpi-grid">
  <div class="kpi-box" style="background:#dcfce7;border:1px solid #86efac"><div class="kpi-lbl" style="color:#15803d">Acréscimos (c/BDI)</div><div class="kpi-val" style="color:#15803d">+${R$(totais.acrescimos)}</div></div>
  <div class="kpi-box" style="background:#fee2e2;border:1px solid #fca5a5"><div class="kpi-lbl" style="color:#b91c1c">Supressões (c/BDI)</div><div class="kpi-val" style="color:#b91c1c">−${R$(totais.supressoes)}</div></div>
  <div class="kpi-box" style="background:#f0f9ff;border:1px solid #bae6fd"><div class="kpi-lbl" style="color:#0369a1">Saldo Líquido</div><div class="kpi-val" style="color:#0369a1">${delta>=0?'+':''}${R$(delta)}</div></div>
</div>
<table>
  <thead><tr>
    <th style="text-align:left;width:52px">Cód.</th><th style="text-align:left">Descrição</th>
    <th style="width:28px">Un.</th><th style="width:58px">Qtd Ant.</th>
    <th style="width:58px">Qtd Vigente</th><th style="width:80px">P. Unit.</th>
    <th style="width:88px">Total (c/BDI)</th><th style="width:60px;text-align:center">Situação</th>
  </tr></thead>
  <tbody>${linhas}</tbody>
</table>
<div class="assinaturas">
  <div class="assinatura"><div style="font-weight:700;font-size:8pt">${cfg?.fiscal||'______________________________'}</div><div style="font-size:6.5pt;color:#6b7280">Fiscal do Contrato</div><div style="font-size:6.5pt;color:#6b7280;margin-top:3px">Data: ___/___/______</div></div>
  <div class="assinatura"><div style="font-weight:700;font-size:8pt">${cfg?.contratada||'______________________________'}</div><div style="font-size:6.5pt;color:#6b7280">Responsável Técnico</div><div style="font-size:6.5pt;color:#6b7280;margin-top:3px">Data: ___/___/______</div></div>
  <div class="assinatura"><div style="font-weight:700;font-size:8pt">${cfg?.contratante||'______________________________'}</div><div style="font-size:6.5pt;color:#6b7280">Gestora do Contrato</div><div style="font-size:6.5pt;color:#6b7280;margin-top:3px">Data: ___/___/______</div></div>
</div>
<div class="rodape">Fiscal na Obra · Aditivo Nº ${String(aditivo.numero).padStart(2,'0')} · Emitido em ${agora.toLocaleDateString('pt-BR')} às ${agora.toLocaleTimeString('pt-BR',{hour:'2-digit',minute:'2-digit'})}</div>
<script>window.onload=function(){setTimeout(function(){window.print()},500)}<\/script>
</body></html>`;

    const janela = window.open('', `adt_pdf_${aditivo.id}`, 'width=1000,height=700,scrollbars=yes');
    if (janela) { janela.document.write(html); janela.document.close(); }
  }
}
