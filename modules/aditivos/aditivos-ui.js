/**
 * ╔══════════════════════════════════════════════════════════════════╗
 * ║  FISCAL NA OBRA v15 — modules/aditivos/aditivos-ui.js           ║
 * ║  Renderização de toda a interface do módulo de Aditivos          ║
 * ╚══════════════════════════════════════════════════════════════════╝
 */

import state       from '../../core/state.js';
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
const OP_COLOR = { inclusao: '#2563EB', exclusao: '#DC2626', alteracao_qtd: '#16a34a', alteracao_preco: '#ea580c' };

export class AditivosUI {

  // ═══════════════════════════════════════════════════════════════════
  // PÁGINA PRINCIPAL — lista de aditivos + resumo
  // ═══════════════════════════════════════════════════════════════════

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
      container.innerHTML = `<div style="text-align:center;padding:40px;color:var(--text-muted);font-size:13px">
        🏗️ Selecione uma obra para gerenciar os aditivos contratuais.
      </div>`;
      return;
    }

    // ── Calcular resumo ──
    const versaoAtual    = versoes.find(v => v.numero === obraMeta.contractVersion) || null;
    const valorAtual     = versaoAtual?.cfgSnapshot?.valor || cfg.valor || 0;
    const valorOriginal  = versoes.find(v => v.numero === 1)?.cfgSnapshot?.valor || valorAtual;
    const varTotal       = trunc2(valorAtual - valorOriginal);
    const pctVar         = valorOriginal > 0 ? (varTotal / valorOriginal * 100) : 0;

    container.innerHTML = `
      <!-- RESUMO -->
      <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(200px,1fr));gap:10px;margin-bottom:20px" id="adt-resumo-cards">
        ${this._cardResumo('Versão Contratual', `v${obraMeta.contractVersion}`, 'var(--accent)', `${aditivos.length} aditivo(s)`)}
        ${this._cardResumo('Valor Original', R$(valorOriginal), 'var(--text-primary)')}
        ${this._cardResumo('Valor Atual', R$(valorAtual), 'var(--green)')}
        ${this._cardResumo('Variação Total', `${varTotal >= 0 ? '+' : ''}${R$(varTotal)}`, varTotal >= 0 ? 'var(--green)' : 'var(--red)', `${pctVar >= 0 ? '+' : ''}${pctVar.toFixed(1)}%`)}
        ${versaoAtual?.cfgSnapshot?.termino ? this._cardResumo('Término Vigente', dataBR(versaoAtual.cfgSnapshot.termino), 'var(--text-primary)') : ''}
      </div>

      <!-- VERSÕES CONTRATUAIS -->
      <div style="margin-bottom:20px">
        <div style="font-size:11px;font-weight:800;text-transform:uppercase;letter-spacing:.6px;color:var(--text-muted);margin-bottom:10px">📋 Histórico de Versões Contratuais</div>
        <div id="adt-versoes-lista">${this._renderVersoes(versoes, aditivos, bms, obraMeta)}</div>
      </div>

      <!-- TABELA DE ADITIVOS -->
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
          <tbody id="adt-tbody">${this._renderLinhasTabela(aditivos)}</tbody>
        </table>
      </div>
      ${aditivos.length === 0 ? `<div style="text-align:center;padding:32px;color:var(--text-muted);font-size:13px">
        Nenhum aditivo registrado. Clique em <strong>＋ Novo Aditivo</strong> para começar.
      </div>` : ''}
    `;
  }

  _cardResumo(label, valor, cor, sub = '') {
    return `<div style="background:var(--bg-warm);border:1px solid var(--border);border-radius:8px;padding:12px 16px;text-align:center">
      <div style="font-size:10px;color:var(--text-muted);text-transform:uppercase;letter-spacing:.5px;margin-bottom:4px">${label}</div>
      <div style="font-size:15px;font-weight:700;font-family:var(--font-mono);color:${cor}">${valor}</div>
      ${sub ? `<div style="font-size:10px;color:var(--text-muted);margin-top:2px">${sub}</div>` : ''}
    </div>`;
  }

  _renderVersoes(versoes, aditivos, bms, obraMeta) {
    if (!versoes.length) return `<div style="color:var(--text-muted);font-size:12px;padding:8px">Nenhuma versão contratual registrada.</div>`;
    return versoes.map(v => {
      const isAtual = v.numero === obraMeta.contractVersion;
      const adt     = v.aditivoId ? aditivos.find(a => a.id === v.aditivoId) : null;
      const bmsDaVer = bms.filter(b => (b.contractVersion || 1) === v.numero);
      return `<div style="display:flex;align-items:center;gap:10px;padding:10px 14px;border-radius:8px;border:1px solid ${isAtual ? 'var(--accent)' : 'var(--border)'};background:${isAtual ? 'var(--accent-soft)' : 'var(--bg-warm)'};margin-bottom:6px">
        <div style="width:32px;height:32px;border-radius:50%;background:${isAtual ? 'var(--accent)' : 'var(--bg-card-alt)'};color:${isAtual ? '#fff' : 'var(--text-on-panel)'};display:flex;align-items:center;justify-content:center;font-weight:800;font-size:12px;flex-shrink:0">v${v.numero}</div>
        <div style="flex:1;min-width:0">
          <div style="font-weight:600;font-size:12px;color:var(--text-primary)">${v.descricao || 'Versão ' + v.numero}${isAtual ? ' <span style="font-size:10px;background:var(--accent);color:#fff;padding:1px 7px;border-radius:10px;margin-left:6px;font-weight:700">VIGENTE</span>' : ''}</div>
          <div style="font-size:11px;color:var(--text-muted);margin-top:1px">
            ${adt ? `Aditivo Nº ${String(adt.numero).padStart(2,'0')} · ${adt.data || '—'} · ` : 'Contrato original · '}
            BMs: ${bmsDaVer.length ? bmsDaVer.map(b => b.label).join(', ') : 'nenhum'}
          </div>
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
        <td style="padding:8px 10px;text-align:center">
          ${temItens
            ? `<button data-action="_adtVerPlanilha" data-arg0="${a.id}" style="background:none;border:none;cursor:pointer;font-size:16px;padding:2px 5px" title="Visualizar planilha">📄</button>`
            : '<span style="color:var(--text-muted);font-size:11px">—</span>'}
        </td>
        <td style="padding:8px 10px;text-align:center;white-space:nowrap">
          <button class="btn btn-sm" data-action="_adtEditar" data-arg0="${a.id}" style="font-size:11px;padding:3px 8px;margin-right:3px" ${aprovado ? 'disabled title="Aditivo aprovado — imutável"' : ''}>✏️</button>
          <button class="btn btn-vermelho btn-sm" data-action="_adtExcluir" data-arg0="${a.id}" style="font-size:11px;padding:3px 8px" ${aprovado ? 'disabled title="Aditivo aprovado — imutável"' : ''}>🗑️</button>
        </td>
      </tr>`;
    }).join('');
  }

  // ═══════════════════════════════════════════════════════════════════
  // MODAL DE CRIAÇÃO / EDIÇÃO DO ADITIVO
  // ═══════════════════════════════════════════════════════════════════

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

        <!-- Linha 1 -->
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

        <!-- Linha 2 -->
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-bottom:14px">
          <div>
            <label style="font-size:11px;font-weight:600;color:var(--text-muted);display:block;margin-bottom:4px">Número do Processo <span style="color:#ef4444;font-size:10px" title="Obrigatório para Aprovação">*</span></label>
            <input type="text" id="adt-processo" class="campo-input" placeholder="Ex.: 001/2024 (obrigatório para Aprovado)" style="width:100%">
          </div>
          <div>
            <label style="font-size:11px;font-weight:600;color:var(--text-muted);display:block;margin-bottom:4px">Status</label>
            <select id="adt-status" class="campo-input" style="width:100%" onchange="window._adtOnStatusChange?.(this.value)">
              <option value="Rascunho">📝 Rascunho</option>
              <option value="Aprovado">✅ Aprovado</option>
            </select>
          </div>
        </div>

        <!-- Descrição -->
        <div style="margin-bottom:14px">
          <label style="font-size:11px;font-weight:600;color:var(--text-muted);display:block;margin-bottom:4px">Descrição *</label>
          <textarea id="adt-descricao" rows="2" class="campo-input" placeholder="Descreva o objeto do aditivo..." style="width:100%;resize:vertical"></textarea>
        </div>

        <!-- Valores -->
        <div style="background:var(--bg-warm);border:1px solid var(--border);border-radius:10px;padding:14px;margin-bottom:14px">
          <div style="font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:.5px;color:var(--text-muted);margin-bottom:10px">💰 Alteração de Valor</div>
          <div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:10px">
            <div>
              <label style="font-size:11px;font-weight:600;color:var(--text-muted);display:block;margin-bottom:4px">Valor Anterior (R$)</label>
              <input type="number" id="adt-valor-anterior" step="0.01" class="campo-input" style="width:100%" oninput="window._adtCalcVariacao?.()">
            </div>
            <div>
              <label style="font-size:11px;font-weight:600;color:var(--text-muted);display:block;margin-bottom:4px">Novo Valor (R$)</label>
              <input type="number" id="adt-valor-novo" step="0.01" class="campo-input" style="width:100%" oninput="window._adtCalcVariacao?.()">
            </div>
            <div>
              <label style="font-size:11px;font-weight:600;color:var(--text-muted);display:block;margin-bottom:4px">Variação</label>
              <input type="text" id="adt-variacao" readonly class="campo-input" style="width:100%;background:var(--bg-card-alt)">
            </div>
          </div>
        </div>

        <!-- Prazo -->
        <div style="background:var(--bg-warm);border:1px solid var(--border);border-radius:10px;padding:14px;margin-bottom:14px">
          <div style="font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:.5px;color:var(--text-muted);margin-bottom:10px">⏱️ Alteração de Prazo</div>
          <div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:10px">
            <div>
              <label style="font-size:11px;font-weight:600;color:var(--text-muted);display:block;margin-bottom:4px">Término Anterior</label>
              <input type="date" id="adt-termino-anterior" class="campo-input" style="width:100%">
            </div>
            <div>
              <label style="font-size:11px;font-weight:600;color:var(--text-muted);display:block;margin-bottom:4px">Prazo Adicional (dias)</label>
              <input type="number" id="adt-prazo-adicional" class="campo-input" style="width:100%" oninput="window._adtCalcTermino?.()">
            </div>
            <div>
              <label style="font-size:11px;font-weight:600;color:var(--text-muted);display:block;margin-bottom:4px">Novo Término</label>
              <input type="date" id="adt-termino-novo" class="campo-input" style="width:100%;background:var(--bg-card-alt)" readonly>
            </div>
          </div>
        </div>

        <!-- Aviso aprovação -->
        <div id="adt-aviso-versao" style="display:none;background:#fef3c7;border:1px solid #f59e0b;border-radius:8px;padding:10px 14px;margin-bottom:14px;font-size:12px;color:#92400e">
          ⚠️ <strong>Atenção:</strong> Ao salvar com status <strong>Aprovado</strong>, uma nova versão contratual será criada automaticamente. Esta ação é <strong>irreversível</strong>.
        </div>

        <!-- Botão planilha -->
        <div id="adt-planilha-btn-area" style="margin-bottom:16px">
          <button class="btn btn-sm" data-action="_adtAbrirPlanilhaEditor" style="background:var(--blue-soft);color:var(--blue-text);border:1px solid var(--blue)">
            📋 Editar Planilha do Aditivo
          </button>
          <span id="adt-planilha-status" style="font-size:11px;color:var(--text-muted);margin-left:8px"></span>
          <div id="adt-planilha-aviso-pendente" style="display:none;margin-top:8px;background:#fff7ed;border:1px solid #fb923c;border-radius:6px;padding:8px 12px;font-size:11px;color:#9a3412">
            ⚠️ <strong>Atenção:</strong> Há alterações na planilha que ainda <strong>não foram aplicadas</strong>. Clique em <strong>✅ Aplicar ao Aditivo</strong> no editor antes de salvar.
          </div>
        </div>

        <!-- Ações -->
        <div style="display:flex;justify-content:flex-end;gap:10px;margin-top:4px">
          <button class="btn btn-sm" data-action="_adtFecharModal" style="background:var(--bg-card);color:var(--text-secondary)">Cancelar</button>
          <button class="btn btn-azul btn-sm" data-action="_adtSalvar">💾 Salvar Aditivo</button>
        </div>
      </div>
    `;

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
    const overlay = document.getElementById('adt-modal-overlay');
    if (overlay) overlay.style.display = 'none';
  }

  preencherModalNovo(aditivos, cfg) {
    document.getElementById('adt-edit-id').value = '';
    // REC-06: usar max(numeros)+1 para evitar duplicatas após exclusões
    const proximoNum = aditivos.length
      ? Math.max(...aditivos.map(a => parseInt(a.numero) || 0)) + 1
      : 1;
    document.getElementById('adt-numero').value = proximoNum;
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
    document.getElementById('adt-variacao').value = '';
    document.getElementById('adt-termino-anterior').value = dataParaInput(a.terminoAnterior || '');
    document.getElementById('adt-prazo-adicional').value = a.prazoAdicionalDias || '';
    document.getElementById('adt-termino-novo').value = dataParaInput(a.terminoNovo || '');
    document.getElementById('adt-status').value = a.status || 'Rascunho';
    document.getElementById('adt-aviso-versao').style.display = 'none';
    const ni = a.itensMudados?.length || 0;
    document.getElementById('adt-planilha-status').textContent = ni > 0 ? `(${ni} item(ns) alterado(s) salvos)` : '';
    // Recalcula variacao
    const ant = parseFloat(a.valorAnterior) || 0;
    const nov = parseFloat(a.valorNovo) || 0;
    if (ant && nov) {
      const v = trunc2(nov - ant);
      const pct = ant > 0 ? (v / ant * 100) : 0;
      document.getElementById('adt-variacao').value = `${v >= 0 ? '+' : ''}${R$(v)} (${pct >= 0 ? '+' : ''}${pct.toFixed(1)}%)`;
    }
  }

  lerModal() {
    return {
      editId:       document.getElementById('adt-edit-id').value.trim(),
      numero:       parseInt(document.getElementById('adt-numero').value) || 1,
      tipo:         document.getElementById('adt-tipo').value,
      descricao:    document.getElementById('adt-descricao').value.trim(),
      processo:     document.getElementById('adt-processo').value.trim(),
      data:         document.getElementById('adt-data').value,
      valorAnterior: parseFloat(document.getElementById('adt-valor-anterior').value) || 0,
      valorNovo:    parseFloat(document.getElementById('adt-valor-novo').value) || 0,
      terminoAnterior: document.getElementById('adt-termino-anterior').value,
      prazoAdicional: parseInt(document.getElementById('adt-prazo-adicional').value) || 0,
      terminoNovo:  document.getElementById('adt-termino-novo').value,
      status:       document.getElementById('adt-status').value,
    };
  }

  // ═══════════════════════════════════════════════════════════════════
  // MODAL DE PLANILHA — Editor inline
  // ═══════════════════════════════════════════════════════════════════

  injectModalPlanilha() {
    if (document.getElementById('adt-planilha-modal-overlay')) return;

    const overlay = document.createElement('div');
    overlay.id = 'adt-planilha-modal-overlay';
    overlay.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,.65);z-index:1200;display:none;align-items:center;justify-content:center;padding:12px';

    overlay.innerHTML = `
      <div style="background:var(--bg-card);border:1px solid var(--border);border-radius:16px;padding:24px;width:min(1240px,96vw);height:min(880px,94vh);aspect-ratio:297/210;display:flex;flex-direction:column;box-shadow:0 24px 60px rgba(0,0,0,.5)">
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

        <!-- Legenda -->
        <div style="display:flex;gap:10px;flex-wrap:wrap;margin-bottom:12px;flex-shrink:0;font-size:10px">
          <span style="background:#fecaca;color:#b91c1c;border:1px solid #fca5a5;padding:2px 8px;border-radius:4px;font-weight:600">🔴 Quantidade Reduzida</span>
          <span style="background:#dbeafe;color:#1d4ed8;border:1px solid #93c5fd;padding:2px 8px;border-radius:4px;font-weight:600">🔵 Quantidade Aumentada / Novo</span>
          <span style="background:#bbf7d0;color:#15803d;border:1px solid #86efac;padding:2px 8px;border-radius:4px;font-weight:600">🟢 Valor Unitário Aumentado</span>
          <span style="background:#e9d5ff;color:#7e22ce;border:1px solid #d8b4fe;padding:2px 8px;border-radius:4px;font-weight:600">🟣 Valor Unitário Reduzido</span>
          <span style="background:#fef08a;color:#854d0e;border:1px solid #fde047;padding:2px 8px;border-radius:4px;font-weight:600">🟡 Suprimido (Qtd=0)</span>
          <span style="background:var(--bg-warm);color:var(--text-muted);border:1px solid var(--border);padding:2px 8px;border-radius:4px;font-weight:600">⬜ Sem alteração</span>
        </div>

        <!-- Stats -->
        <div id="adt-pl-stats" style="display:flex;gap:10px;flex-wrap:wrap;margin-bottom:12px;flex-shrink:0"></div>

        <!-- Tabela -->
        <div style="overflow:auto;flex:1;border:1px solid var(--border);border-radius:8px">
          <table style="width:100%;border-collapse:collapse;font-size:11.5px">
            <colgroup>
              <col style="width:80px">
              <col style="min-width:320px">
              <col style="width:48px">
              <col style="width:72px">
              <col style="width:82px">
              <col style="width:68px">
              <col style="width:115px">
              <col style="width:115px">
              <col style="width:44px">
            </colgroup>
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
      </div>
    `;

    document.body.appendChild(overlay);
  }

  abrirPlanilhaEditor() {
    this.injectModalPlanilha();
    document.getElementById('adt-planilha-modal-overlay').style.display = 'flex';
  }

  // ═══════════════════════════════════════════════════════════════════
  // MODAL DE ADIÇÃO DE NOVO ITEM À PLANILHA
  // ═══════════════════════════════════════════════════════════════════

  injectModalNovoItem() {
    if (document.getElementById('adt-novoitem-modal-overlay')) return;

    const overlay = document.createElement('div');
    overlay.id = 'adt-novoitem-modal-overlay';
    overlay.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,.72);z-index:1500;display:none;align-items:center;justify-content:center;padding:20px';

    overlay.innerHTML = `
      <div style="background:var(--bg-card);border:1px solid var(--border);border-radius:16px;padding:28px;width:100%;max-width:560px;box-shadow:0 24px 60px rgba(0,0,0,.55)">

        <!-- Cabeçalho -->
        <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:20px">
          <div>
            <div style="font-size:10px;font-weight:700;color:var(--text-muted);text-transform:uppercase;letter-spacing:.5px">Planilha do Aditivo</div>
            <div style="font-size:15px;font-weight:800;color:var(--text-primary)">★ Incluir Novo Item</div>
          </div>
          <button data-action="_adtNovoItemFechar" style="background:none;border:none;font-size:24px;cursor:pointer;color:var(--text-muted);line-height:1">×</button>
        </div>

        <!-- Aviso de posicionamento -->
        <div style="background:#dbeafe;border:1px solid #93c5fd;border-radius:8px;padding:10px 14px;margin-bottom:18px;font-size:11.5px;color:#1d4ed8">
          <strong>📌 Posicionamento automático:</strong> O item será inserido imediatamente após o item cujo código seja numericamente anterior ao código informado.<br>
          <span style="font-size:11px;color:#2563EB;margin-top:3px;display:block">Exemplo: ao adicionar <strong>4.5.6</strong>, ele será inserido logo após o item <strong>4.5.5</strong>.</span>
        </div>

        <!-- Código do item -->
        <div style="margin-bottom:14px">
          <label style="font-size:11px;font-weight:700;color:var(--text-muted);display:block;margin-bottom:5px">
            Código do Item <span style="color:var(--red)">*</span>
            <span style="font-weight:400;font-style:italic;margin-left:6px">Ex.: 1.2.3 &nbsp;·&nbsp; 4.5 &nbsp;·&nbsp; 2.10.1</span>
          </label>
          <input type="text" id="adt-ni-codigo"
            placeholder="Ex.: 4.5.6"
            class="campo-input"
            style="width:100%;font-family:var(--font-mono);font-size:14px;font-weight:700;letter-spacing:.5px"
            oninput="window._adtNovoItemPreviewPosicao?.()">
          <div id="adt-ni-preview" style="margin-top:6px;font-size:11px;color:var(--text-muted);min-height:16px"></div>
        </div>

        <!-- Descrição -->
        <div style="margin-bottom:14px">
          <label style="font-size:11px;font-weight:700;color:var(--text-muted);display:block;margin-bottom:5px">
            Descrição do Item <span style="color:var(--red)">*</span>
          </label>
          <input type="text" id="adt-ni-desc"
            placeholder="Descreva o item de serviço..."
            class="campo-input"
            style="width:100%">
        </div>

        <!-- Unidade + Quantidade + Preço Unit. -->
        <div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:12px;margin-bottom:18px">
          <div>
            <label style="font-size:11px;font-weight:700;color:var(--text-muted);display:block;margin-bottom:5px">Unidade</label>
            <input type="text" id="adt-ni-un"
              placeholder="m², m³, kg…"
              class="campo-input"
              style="width:100%;text-align:center">
          </div>
          <div>
            <label style="font-size:11px;font-weight:700;color:var(--text-muted);display:block;margin-bottom:5px">Quantidade</label>
            <input type="number" id="adt-ni-qtd"
              placeholder="0,00"
              step="0.0001" min="0"
              class="campo-input"
              style="width:100%;text-align:right;font-family:var(--font-mono)"
              oninput="window._adtNovoItemCalcTotal?.()">
          </div>
          <div>
            <label style="font-size:11px;font-weight:700;color:var(--text-muted);display:block;margin-bottom:5px">Preço Unit. (s/BDI)</label>
            <input type="number" id="adt-ni-up"
              placeholder="0,00"
              step="0.01" min="0"
              class="campo-input"
              style="width:100%;text-align:right;font-family:var(--font-mono)"
              oninput="window._adtNovoItemCalcTotal?.()">
          </div>
        </div>

        <!-- Prévia do total -->
        <div id="adt-ni-total-box" style="background:var(--bg-warm);border:1px solid var(--border);border-radius:8px;padding:12px 16px;margin-bottom:20px;display:flex;align-items:center;justify-content:space-between">
          <span style="font-size:11px;color:var(--text-muted)">Total estimado (c/BDI):</span>
          <span id="adt-ni-total" style="font-size:14px;font-weight:800;font-family:var(--font-mono);color:var(--green)">R$ 0,00</span>
        </div>

        <!-- Erro -->
        <div id="adt-ni-erro" style="display:none;background:#fee2e2;border:1px solid #fca5a5;border-radius:8px;padding:10px 14px;margin-bottom:14px;font-size:12px;color:#b91c1c"></div>

        <!-- Ações -->
        <div style="display:flex;justify-content:flex-end;gap:10px">
          <button class="btn btn-sm" data-action="_adtNovoItemFechar" style="background:var(--bg-card);color:var(--text-secondary)">Cancelar</button>
          <button class="btn btn-azul btn-sm" data-action="_adtNovoItemConfirmar" style="padding:8px 20px">
            ★ Incluir Item na Planilha
          </button>
        </div>
      </div>
    `;

    document.body.appendChild(overlay);
  }

  abrirModalNovoItem() {
    this.injectModalNovoItem();
    const overlay = document.getElementById('adt-novoitem-modal-overlay');
    if (!overlay) return;
    // Limpa campos
    ['adt-ni-codigo','adt-ni-desc','adt-ni-un','adt-ni-qtd','adt-ni-up'].forEach(id => {
      const el = document.getElementById(id);
      if (el) el.value = '';
    });
    document.getElementById('adt-ni-preview').textContent = '';
    document.getElementById('adt-ni-total').textContent = 'R$ 0,00';
    document.getElementById('adt-ni-erro').style.display = 'none';
    overlay.style.display = 'flex';
    setTimeout(() => document.getElementById('adt-ni-codigo')?.focus(), 80);
  }

  fecharModalNovoItem() {
    const overlay = document.getElementById('adt-novoitem-modal-overlay');
    if (overlay) overlay.style.display = 'none';
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
    el.textContent = msg;
    el.style.display = 'block';
  }

  limparErroNovoItem() {
    const el = document.getElementById('adt-ni-erro');
    if (el) el.style.display = 'none';
  }

  atualizarPreviewNovoItem(texto, cor = 'var(--text-muted)') {
    const el = document.getElementById('adt-ni-preview');
    if (el) { el.textContent = texto; el.style.color = cor; }
  }

  fecharPlanilhaEditor() {
    const el = document.getElementById('adt-planilha-modal-overlay');
    if (el) el.style.display = 'none';
  }

  renderPlanilha(planilhaDraft, planilhaBase, cfg) {
    const tbody = document.getElementById('adt-pl-tbody');
    if (!tbody) return;

    const bdi = cfg?.bdi || 0.25;

    if (!planilhaDraft.length) {
      tbody.innerHTML = `<tr><td colspan="9" style="text-align:center;padding:24px;color:var(--text-muted)">
        Nenhum item na planilha. Crie um aditivo com obra e planilha carregadas.
      </td></tr>`;
      this.renderStats([], bdi);
      return;
    }

    const BG_MAP = {
      'linha-aumento-valor':  '#bbf7d0',
      'linha-diminuiu-valor': '#e9d5ff',
      'linha-aumento-qtd':    '#dbeafe',
      'linha-diminuiu-qtd':   '#fecaca',
      'linha-suprimiu-item':  '#fef08a',
    };

    const rows = planilhaDraft.map((it, idx) => {
      if (it.t === 'G' || it.t === 'SG') {
        const indent = it.t === 'SG' ? 'padding-left:24px' : '';
        return `<tr style="background:var(--bg-warm);border-bottom:1px solid var(--border-subtle)">
          <td style="padding:6px 10px;font-family:var(--font-mono);white-space:nowrap;font-size:10px;${indent}">${it.id || ''}</td>
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

      // Classe de realce: item novo sem base usa lógica de aumento de qtd
      const trClass = removido
        ? 'linha-suprimiu-item'
        : base
          ? classeRealce(upD, upB, qtdD, qtdB)
          : (qtdD > 0 ? 'linha-aumento-qtd' : '');   // item novo

      const trBg = BG_MAP[trClass] || '';
      const trInlineBg = trBg ? `background-color:${trBg};` : '';

      let deltaBadge = '';
      if (!base) {
        deltaBadge = `<span style="font-size:9px;background:#dbeafe;color:#1d4ed8;border:1px solid #93c5fd;padding:1px 5px;border-radius:3px;font-weight:700">NOVO</span>`;
      } else if (delta !== null && Math.abs(delta) > 0.0001) {
        const col = delta > 0 ? '#15803d' : '#b91c1c';
        deltaBadge = `<span style="font-size:10px;font-weight:700;color:${col}">${delta > 0 ? '+' : ''}${fmtN(delta)}</span>`;
      }

      const upFormatted = upD > 0 ? upD.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' }) : '';

      const tdBg = trBg ? `background-color:${trBg};` : '';
      return `<tr class="${trClass}" style="border-bottom:1px solid var(--border-subtle);${removido ? 'opacity:.55;text-decoration:line-through;' : ''}">
        <td style="padding:6px 10px;font-family:var(--font-mono);font-size:10px;white-space:nowrap;${tdBg}">${it.id || ''}</td>
        <td style="padding:6px 10px;${tdBg}">
          <input value="${(it.desc || '').replace(/"/g,"'")}" onchange="window._adtPlanilhaEditDesc?.(${idx},this.value)"
            style="background:transparent;border:none;width:100%;font-size:11.5px;color:var(--text-primary);outline:none;padding:0" ${removido ? 'disabled' : ''}>
        </td>
        <td style="padding:6px 10px;text-align:center;font-family:var(--font-mono);font-size:10px;${tdBg}">${it.un || ''}</td>
        <td style="padding:6px 10px;text-align:right;font-family:var(--font-mono);color:var(--text-muted);font-size:10px;${tdBg}">${base !== undefined ? fmtN(qtdB) : '—'}</td>
        <td style="padding:6px 10px;text-align:right;${tdBg}">
          <input type="number" value="${qtdD || ''}" step="0.0001" onchange="window._adtPlanilhaEditQtd?.(${idx},parseFloat(this.value)||0)"
            style="background:transparent;border:1px solid var(--border);border-radius:4px;width:72px;text-align:right;padding:3px 6px;font-size:11.5px;font-family:var(--font-mono);color:var(--text-primary)" ${removido ? 'disabled' : ''}>
        </td>
        <td style="padding:6px 10px;text-align:right;${tdBg}">${deltaBadge}</td>
        <td style="padding:6px 10px;text-align:right;${tdBg}">
          <input type="text" value="${upFormatted}" onchange="window._adtPlanilhaEditUp?.(${idx},(v=>parseFloat(v.replace(/[R$\\s]/g,'').replace(/\\./g,'').replace(',','.'))||0)(this.value))"
            style="background:transparent;border:1px solid var(--border);border-radius:4px;width:105px;text-align:right;padding:3px 6px;font-size:11.5px;font-family:var(--font-mono);color:var(--text-primary)" ${removido ? 'disabled' : ''}>
        </td>
        <td style="padding:6px 10px;text-align:right;font-family:var(--font-mono);font-weight:600;font-size:11px;${tdBg}">${removido ? '<span style="color:var(--red)">EXCLUÍDO</span>' : R$(total)}</td>
        <td style="padding:6px 10px;text-align:center;white-space:nowrap;${tdBg}">
          ${removido
            ? `<button data-action="_adtPlanilhaRestaurar" data-arg0="${idx}" style="background:none;border:none;cursor:pointer;font-size:13px;padding:2px 4px" title="Restaurar item">♻️</button>`
            : `<button data-action="_adtPlanilhaRemover" data-arg0="${idx}" style="background:none;border:none;cursor:pointer;font-size:13px;padding:2px 4px" title="Remover item">✕</button>`}
        </td>
      </tr>`;
    });

    tbody.innerHTML = rows.join('');
    this.renderStats(planilhaDraft, bdi, planilhaBase);
  }

  renderStats(planilhaDraft, bdi = 0.25, planilhaBase = []) {
    const el = document.getElementById('adt-pl-stats');
    if (!el) return;

    // Usa classeRealce() como fonte única de verdade (mesma lógica das linhas)
    const itensServico = planilhaDraft.filter(it => !it.t || it.t === 'item');

    const totalAtual = trunc2(itensServico
      .filter(it => !it._adtRemovido)
      .reduce((s, it) => s + trunc2((parseFloat(it.qtd) || 0) * (parseFloat(it.up) || 0) * (1 + bdi)), 0));

    const contagem = { 'linha-aumento-valor': 0, 'linha-diminuiu-valor': 0,
                       'linha-aumento-qtd': 0,   'linha-diminuiu-qtd': 0,
                       'linha-suprimiu-item': 0 };

    itensServico.forEach(it => {
      if (it._adtRemovido) { contagem['linha-suprimiu-item']++; return; }
      const base = planilhaBase.find(b => b.id === it.id);
      let cls;
      if (!base) {
        // Item novo — azul se tiver qtd, sem classe se qtd=0
        cls = (parseFloat(it.qtd) || 0) > 0 ? 'linha-aumento-qtd' : '';
      } else {
        cls = classeRealce(it.up, base.up, it.qtd, base.qtd);
      }
      if (cls) contagem[cls]++;
    });

    el.innerHTML = `
      <div style="background:var(--bg-warm);border:1px solid var(--border);border-radius:6px;padding:8px 12px;text-align:center">
        <div style="font-size:9px;color:var(--text-muted);text-transform:uppercase">Total Atual</div>
        <div style="font-weight:700;font-family:var(--font-mono);color:var(--text-primary);font-size:13px">${R$(totalAtual)}</div>
      </div>
      <div style="background:#bbf7d0;border:1px solid #86efac;border-radius:6px;padding:8px 12px;text-align:center" title="Itens com valor unitário aumentado">
        <div style="font-size:9px;color:#15803d;text-transform:uppercase">🟢 Valor ▲</div>
        <div style="font-weight:700;color:#15803d;font-size:13px">${contagem['linha-aumento-valor']}</div>
      </div>
      <div style="background:#e9d5ff;border:1px solid #d8b4fe;border-radius:6px;padding:8px 12px;text-align:center" title="Itens com valor unitário reduzido">
        <div style="font-size:9px;color:#7e22ce;text-transform:uppercase">🟣 Valor ▼</div>
        <div style="font-weight:700;color:#7e22ce;font-size:13px">${contagem['linha-diminuiu-valor']}</div>
      </div>
      <div style="background:#dbeafe;border:1px solid #93c5fd;border-radius:6px;padding:8px 12px;text-align:center" title="Itens com quantidade aumentada ou novos">
        <div style="font-size:9px;color:#1d4ed8;text-transform:uppercase">🔵 Qtd ▲ / Novos</div>
        <div style="font-weight:700;color:#1d4ed8;font-size:13px">${contagem['linha-aumento-qtd']}</div>
      </div>
      <div style="background:#fecaca;border:1px solid #fca5a5;border-radius:6px;padding:8px 12px;text-align:center" title="Itens com quantidade reduzida (mas não zerada)">
        <div style="font-size:9px;color:#b91c1c;text-transform:uppercase">🔴 Qtd ▼</div>
        <div style="font-weight:700;color:#b91c1c;font-size:13px">${contagem['linha-diminuiu-qtd']}</div>
      </div>
      <div style="background:#fef08a;border:1px solid #fde047;border-radius:6px;padding:8px 12px;text-align:center" title="Itens suprimidos (quantidade zerada ou removidos)">
        <div style="font-size:9px;color:#854d0e;text-transform:uppercase">🟡 Suprimidos</div>
        <div style="font-weight:700;color:#854d0e;font-size:13px">${contagem['linha-suprimiu-item']}</div>
      </div>
    `;
  }

  // ═══════════════════════════════════════════════════════════════════
  // MODAL DE VISUALIZAÇÃO DA PLANILHA DO ADITIVO (somente leitura)
  // ═══════════════════════════════════════════════════════════════════

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
        <!-- Legenda cores -->
        <div style="display:flex;gap:8px;flex-wrap:wrap;margin-bottom:12px;flex-shrink:0;font-size:10px">
          <span style="background:#fecaca;color:#b91c1c;border:1px solid #fca5a5;padding:2px 8px;border-radius:4px;font-weight:600">🔴 Quantidade Reduzida</span>
          <span style="background:#dbeafe;color:#1d4ed8;border:1px solid #93c5fd;padding:2px 8px;border-radius:4px;font-weight:600">🔵 Quantidade Aumentada / Novo</span>
          <span style="background:#bbf7d0;color:#15803d;border:1px solid #86efac;padding:2px 8px;border-radius:4px;font-weight:600">🟢 Valor Unitário Aumentado</span>
          <span style="background:#e9d5ff;color:#7e22ce;border:1px solid #d8b4fe;padding:2px 8px;border-radius:4px;font-weight:600">🟣 Valor Unitário Reduzido</span>
          <span style="background:#fef08a;color:#854d0e;border:1px solid #fde047;padding:2px 8px;border-radius:4px;font-weight:600">🟡 Suprimido (Qtd=0)</span>
          <span style="background:var(--bg-warm);color:var(--text-muted);border:1px solid var(--border);padding:2px 8px;border-radius:4px;font-weight:600">⬜ Sem alteração</span>
        </div>
        <!-- KPIs e cards resumo -->
        <div id="adt-view-resumo" style="flex-shrink:0"></div>
        <!-- Tabela completa -->
        <div id="adt-view-corpo" style="overflow-y:auto;flex:1;border:1px solid var(--border);border-radius:8px;margin-top:12px"></div>
      </div>
    `;

    document.body.appendChild(overlay);
  }

  mostrarVisualizacao(aditivo, cfg) {
    this.injectModalVisualizacao();
    const overlay = document.getElementById('adt-view-modal-overlay');
    overlay.style.display = 'flex';

    document.getElementById('adt-view-titulo').textContent =
      `Planilha do Aditivo Nº ${String(aditivo.numero).padStart(2, '0')} — ${aditivo.descricao?.slice(0, 55) || ''}`;

    const bdi          = cfg?.bdi || 0.25;
    const itensMudados = aditivo.itensMudados || [];
    const planilha     = aditivo.itensSnapshot || [];   // planilha COMPLETA após o aditivo
    const totais       = calcularTotais(itensMudados, bdi);
    const delta        = trunc2((aditivo.valorNovo || 0) - (aditivo.valorAnterior || 0));
    const dias         = parseInt(aditivo.prazoAdicionalDias) || 0;
    const prazoStr     = dias === 0 ? 'Sem alteração de prazo' : `${dias > 0 ? '+' : ''}${dias} dia${Math.abs(dias) !== 1 ? 's' : ''}`;

    // Índice rápido de mudanças: itemId → objeto de mudança
    const mapMudancas = {};
    itensMudados.forEach(m => { mapMudancas[m.itemId] = m; });

    // ── Resumo / KPIs ─────────────────────────────────────────────
    const resumoEl = document.getElementById('adt-view-resumo');
    if (resumoEl) resumoEl.innerHTML = `
      <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(140px,1fr));gap:8px;margin-bottom:10px">
        ${this._cardInfo('Nº Aditivo',    `Nº ${String(aditivo.numero).padStart(2, '0')}`, 'var(--accent)')}
        ${this._cardInfo('Data',           aditivo.data || '—')}
        ${this._cardInfo('Tipo',           TIPO_LABEL[aditivo.tipo] || aditivo.tipo)}
        ${this._cardInfo('Valor Anterior', R$(aditivo.valorAnterior || 0))}
        ${this._cardInfo('Valor Novo',     R$(aditivo.valorNovo || 0), 'var(--green)')}
        ${this._cardInfo('Variação',       `${delta >= 0 ? '+' : ''}${R$(delta)}`, delta >= 0 ? 'var(--green)' : 'var(--red)')}
        ${this._cardInfo('Prazo Aditivado', prazoStr, dias !== 0 ? (dias > 0 ? 'var(--green)' : 'var(--red)') : 'var(--text-muted)')}
        ${this._cardInfo('Status',         aditivo.status || 'Rascunho', STATUS_COLOR[aditivo.status] || 'var(--text-muted)')}
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

    // ── Tabela COMPLETA com todos os itens ─────────────────────────
    const corpoEl = document.getElementById('adt-view-corpo');
    if (!corpoEl) return;

    if (!planilha.length) {
      corpoEl.innerHTML = `
        <div style="text-align:center;padding:32px;color:var(--text-muted);font-size:12px">
          Planilha completa não disponível (aditivo salvo antes desta versão).<br>
          <em style="font-size:11px">Edite e salve novamente o aditivo para habilitar esta visualização.</em>
        </div>`;
      return;
    }

    const totalItens = planilha.filter(i => !i.t || i.t === 'item').length;

    corpoEl.innerHTML = `
      <div style="padding:7px 12px;background:var(--bg-warm);border-bottom:1px solid var(--border);font-size:11px;color:var(--text-muted);display:flex;justify-content:space-between">
        <span>Planilha completa vigente após este aditivo — <strong>${totalItens} item(ns) de serviço</strong></span>
        <span><strong>${itensMudados.length}</strong> item(ns) realçado(s) por alteração</span>
      </div>
      <table style="width:100%;border-collapse:collapse;font-size:11.5px">
        <thead style="position:sticky;top:0;background:var(--bg-card-alt);z-index:5">
          <tr>
            <th style="padding:8px 10px;text-align:left;color:var(--text-on-panel);white-space:nowrap">Cód.</th>
            <th style="padding:8px 10px;text-align:left;color:var(--text-on-panel)">Descrição</th>
            <th style="padding:8px 10px;text-align:center;color:var(--text-on-panel);white-space:nowrap">Un.</th>
            <th style="padding:8px 10px;text-align:right;color:var(--text-on-panel);white-space:nowrap">Qtd Anterior</th>
            <th style="padding:8px 10px;text-align:right;color:var(--text-on-panel);white-space:nowrap">Qtd Vigente</th>
            <th style="padding:8px 10px;text-align:right;color:var(--text-on-panel);white-space:nowrap">P. Unit. (s/BDI)</th>
            <th style="padding:8px 10px;text-align:right;color:var(--text-on-panel);white-space:nowrap">Total (c/BDI)</th>
            <th style="padding:8px 10px;text-align:center;color:var(--text-on-panel);white-space:nowrap">Situação</th>
          </tr>
        </thead>
        <tbody>
          ${planilha.map(it => {
            // Grupos / subgrupos — sem realce
            if (it.t === 'G' || it.t === 'SG') {
              const pad = it.t === 'SG' ? 'padding-left:22px' : '';
              return `<tr style="background:var(--bg-warm);border-bottom:1px solid var(--border-subtle)">
                <td style="padding:6px 10px;font-family:var(--font-mono);font-size:10px;${pad}">${it.id || ''}</td>
                <td colspan="7" style="padding:6px 10px;font-weight:700;font-size:11px;color:var(--text-primary)">${it.desc || ''}</td>
              </tr>`;
            }

            const mudanca  = mapMudancas[it.id];
            const qtdVigor = parseFloat(it.qtd) || 0;
            const upVigor  = parseFloat(it.up)  || 0;
            const total    = trunc2(qtdVigor * upVigor * (1 + bdi));
            const qtdAnt   = mudanca && mudanca.qtdAnterior != null ? mudanca.qtdAnterior : qtdVigor;
            const upAnt    = mudanca && mudanca.upAnterior  != null ? mudanca.upAnterior  : upVigor;
            const removido = mudanca?.operacao === 'exclusao' || (mudanca && qtdVigor === 0 && (parseFloat(mudanca.qtdAnterior) || 0) > 0);

            // Classe de realce usando a mesma lógica de _classeRealce
            // Para itens sem mudança registrada, trClass = '' (sem cor)
            const trClass = mudanca
              ? (mudanca.operacao === 'exclusao'
                  ? 'linha-suprimiu-item'
                  : classeRealce(upVigor, upAnt, qtdVigor, qtdAnt))
              : '';

            // Badges de situação
            const badgeMap = {
              'linha-aumento-valor':  `<span style="font-size:9px;background:#bbf7d0;color:#15803d;border:1px solid #86efac;padding:2px 6px;border-radius:3px;font-weight:700">▲ PREÇO</span>`,
              'linha-diminuiu-valor': `<span style="font-size:9px;background:#e9d5ff;color:#7e22ce;border:1px solid #d8b4fe;padding:2px 6px;border-radius:3px;font-weight:700">▼ PREÇO</span>`,
              'linha-aumento-qtd':    `<span style="font-size:9px;background:#dbeafe;color:#1d4ed8;border:1px solid #93c5fd;padding:2px 6px;border-radius:3px;font-weight:700">▲ QTD</span>`,
              'linha-diminuiu-qtd':   `<span style="font-size:9px;background:#fecaca;color:#b91c1c;border:1px solid #fca5a5;padding:2px 6px;border-radius:3px;font-weight:700">▼ QTD</span>`,
              'linha-suprimiu-item':  `<span style="font-size:9px;background:#fef08a;color:#854d0e;border:1px solid #fde047;padding:2px 6px;border-radius:3px;font-weight:700">✕ SUPRIMIDO</span>`,
            };
            const situacaoBadge = mudanca?.operacao === 'inclusao'
              ? `<span style="font-size:9px;background:#dbeafe;color:#1d4ed8;border:1px solid #93c5fd;padding:2px 6px;border-radius:3px;font-weight:700">★ NOVO</span>`
              : (badgeMap[trClass] || `<span style="color:var(--text-muted);font-size:10px">—</span>`);

            return `<tr class="${trClass}" style="border-bottom:1px solid var(--border-subtle);${removido ? 'opacity:.6;' : ''}">
              <td style="padding:6px 10px;font-family:var(--font-mono);font-size:10px;white-space:nowrap">${it.id || ''}</td>
              <td style="padding:6px 10px;max-width:240px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap" title="${(it.desc||'').replace(/"/g,"'")}">${it.desc || '—'}</td>
              <td style="padding:6px 10px;text-align:center;font-family:var(--font-mono);font-size:10px">${it.un || ''}</td>
              <td style="padding:6px 10px;text-align:right;font-family:var(--font-mono);font-size:11px;color:var(--text-muted)">${fmtN(qtdAnt)}</td>
              <td style="padding:6px 10px;text-align:right;font-family:var(--font-mono);font-weight:${mudanca ? 700 : 400};font-size:11px">${removido ? `<s style="color:var(--red)">${fmtN(qtdVigor)}</s>` : fmtN(qtdVigor)}</td>
              <td style="padding:6px 10px;text-align:right;font-family:var(--font-mono);font-size:11px">${R$(upVigor)}</td>
              <td style="padding:6px 10px;text-align:right;font-family:var(--font-mono);font-weight:600;font-size:11px">${removido ? '—' : R$(total)}</td>
              <td style="padding:6px 10px;text-align:center">${situacaoBadge}</td>
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

  // ═══════════════════════════════════════════════════════════════════
  // MODAL DE SNAPSHOT DE VERSÃO CONTRATUAL
  // ═══════════════════════════════════════════════════════════════════

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
    const overlay = document.getElementById('adt-versao-modal-overlay');
    overlay.style.display = 'flex';

    document.getElementById('adt-versao-modal-titulo').textContent =
      `Versão Contratual v${versao.numero} — ${versao.descricao || ''}`;

    const cfg   = versao.cfgSnapshot  || {};
    const itens = versao.itensSnapshot || [];

    document.getElementById('adt-versao-modal-corpo').innerHTML = `
      <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(160px,1fr));gap:8px;margin-bottom:16px">
        ${this._cardInfo('Valor Contratual', R$(cfg.valor || 0), 'var(--green)')}
        ${this._cardInfo('Término', cfg.termino ? dataBR(cfg.termino) : '—')}
        ${this._cardInfo('BDI', `${((cfg.bdi || 0) * 100).toFixed(1)}%`)}
        ${this._cardInfo('Tipo', versao.tipo === 'original' ? '🏗️ Contrato Original' : '📝 Aditivo', 'var(--accent)')}
      </div>
      <div style="font-size:11px;color:var(--text-muted);margin-bottom:8px">🔒 Snapshot imutável · <strong>${itens.length} itens</strong></div>
      ${itens.length > 500 ? `<div style="background:#fef3c7;border:1px solid #f59e0b;border-radius:6px;padding:8px 12px;margin-bottom:10px;font-size:11px;color:#92400e">⚠️ Esta planilha contém <strong>${itens.length} itens</strong>. Apenas os primeiros <strong>500</strong> estão sendo exibidos aqui.</div>` : ''}
      <div style="overflow:auto;border:1px solid var(--border);border-radius:8px;max-height:380px">
        <table style="width:100%;border-collapse:collapse;font-size:11px">
          <thead style="position:sticky;top:0;background:var(--bg-card-alt)">
            <tr>
              ${['Cód.','Descrição','Un.','Qtd','P. Unit. (s/BDI)'].map(h =>
                `<th style="padding:6px 8px;color:var(--text-on-panel);text-align:${h==='Descrição'?'left':'right'};white-space:nowrap">${h}</th>`
              ).join('')}
            </tr>
          </thead>
          <tbody>
            ${itens.slice(0, 500).map(i => {
              if (i.t && i.t !== 'item') {
                return `<tr style="background:var(--bg-warm)"><td colspan="5" style="padding:5px 10px;font-weight:700;font-size:11px">${i.id || ''} — ${i.desc || ''}</td></tr>`;
              }
              return `<tr style="border-bottom:1px solid var(--border-subtle)">
                <td style="padding:5px 8px;font-family:var(--font-mono);font-size:10px">${i.id || '—'}</td>
                <td style="padding:5px 8px">${i.desc || ''}</td>
                <td style="padding:5px 8px;text-align:right;font-family:var(--font-mono)">${i.un || ''}</td>
                <td style="padding:5px 8px;text-align:right;font-family:var(--font-mono)">${i.qtd != null ? fmtN(i.qtd) : ''}</td>
                <td style="padding:5px 8px;text-align:right;font-family:var(--font-mono)">${i.up != null ? R$(i.up) : ''}</td>
              </tr>`;
            }).join('')}
          </tbody>
        </table>
      </div>
    `;
  }

  // ═══════════════════════════════════════════════════════════════════
  // GERAÇÃO DE PDF
  // ═══════════════════════════════════════════════════════════════════

  gerarPDF(aditivo, cfg) {
    const itensMudados = aditivo.itensMudados || [];
    const planilha     = aditivo.itensSnapshot || [];  // planilha COMPLETA
    const bdi          = cfg?.bdi || 0.25;
    const totais       = calcularTotais(itensMudados, bdi);
    const delta        = trunc2((aditivo.valorNovo || 0) - (aditivo.valorAnterior || 0));
    const dias         = parseInt(aditivo.prazoAdicionalDias) || 0;
    const prazoStr     = dias === 0 ? 'Sem alteração de prazo' : `${dias > 0 ? '+' : ''}${dias} dia${Math.abs(dias) !== 1 ? 's' : ''}`;
    const agora        = new Date();

    // Índice rápido de mudanças para determinar cor de cada linha
    const mapMudancas = {};
    itensMudados.forEach(m => { mapMudancas[m.itemId] = m; });

    // Cores das linhas no PDF — alinhadas com as classes CSS do sistema
    // linha-aumento-valor / linha-diminuiu-valor / linha-aumento-qtd /
    // linha-diminuiu-qtd / linha-suprimiu-item
    const bgPDF = {
      'linha-aumento-valor':  '#bbf7d0',  // verde claro
      'linha-diminuiu-valor': '#e9d5ff',  // roxo claro
      'linha-aumento-qtd':    '#dbeafe',  // azul claro
      'linha-diminuiu-qtd':   '#fecaca',  // vermelho claro
      'linha-suprimiu-item':  '#fef08a',  // amarelo claro
    };
    const textoPDF = {
      'linha-aumento-valor':  '#15803d',
      'linha-diminuiu-valor': '#7e22ce',
      'linha-aumento-qtd':    '#1d4ed8',
      'linha-diminuiu-qtd':   '#b91c1c',
      'linha-suprimiu-item':  '#854d0e',
    };

    // ── Gera linhas da tabela completa ─────────────────────────────
    const fonte = planilha.length ? planilha : itensMudados;
    const usandoSnapshot = planilha.length > 0;

    let linhas;
    if (!fonte.length) {
      linhas = `<tr><td colspan="8" style="text-align:center;padding:14px;color:#6b7280">Nenhum item registrado neste aditivo.</td></tr>`;
    } else if (usandoSnapshot) {
      // Planilha completa — mostra TODOS os itens com realce nos alterados
      linhas = planilha.map(it => {
        if (it.t === 'G' || it.t === 'SG') {
          const pad = it.t === 'SG' ? 'padding-left:18px' : '';
          return `<tr style="background:#f3f4f6"><td colspan="8" style="padding:4px 8px;font-weight:700;font-size:7.5pt;${pad}">${it.id || ''} — ${it.desc || ''}</td></tr>`;
        }
        const mudanca  = mapMudancas[it.id];
        const qtdVigor = parseFloat(it.qtd) || 0;
        const upVigor  = parseFloat(it.up)  || 0;
        const total    = trunc2(qtdVigor * upVigor * (1 + bdi));
        const qtdAnt   = mudanca && mudanca.qtdAnterior != null ? mudanca.qtdAnterior : qtdVigor;
        const upAnt    = mudanca && mudanca.upAnterior  != null ? mudanca.upAnterior  : upVigor;
        const removido = mudanca?.operacao === 'exclusao' || (mudanca && qtdVigor === 0 && (parseFloat(mudanca.qtdAnterior) || 0) > 0);

        // Classe de realce — mesma lógica de _classeRealce
        const trClass = mudanca
          ? (mudanca.operacao === 'exclusao'
              ? 'linha-suprimiu-item'
              : classeRealce(upVigor, upAnt, qtdVigor, qtdAnt))
          : '';

        const bgColor = bgPDF[trClass] || '';
        const tdBg    = bgColor ? `background-color:${bgColor} !important;` : '';

        // Badge de situação no PDF
        const labelsPDF = {
          'linha-aumento-valor':  '▲ PREÇO',
          'linha-diminuiu-valor': '▼ PREÇO',
          'linha-aumento-qtd':    '▲ QTD',
          'linha-diminuiu-qtd':   '▼ QTD',
          'linha-suprimiu-item':  '✕ SUPRIMIDO',
        };
        let situacao = '';
        if (mudanca?.operacao === 'inclusao') {
          situacao = `<span style="font-size:6pt;background:#dbeafe;color:#1d4ed8;border:1px solid #93c5fd;padding:1px 4px;border-radius:2px;font-weight:700">★ NOVO</span>`;
        } else if (trClass && bgColor) {
          situacao = `<span style="font-size:6pt;background:${bgColor};color:${textoPDF[trClass]};border:1px solid ${textoPDF[trClass]}44;padding:1px 4px;border-radius:2px;font-weight:700">${labelsPDF[trClass]}</span>`;
        }

        return `<tr style="border-bottom:1px solid #f3f4f6;${bgColor ? `background-color:${bgColor};` : ''}">
          <td style="font-family:monospace;font-size:7pt;padding:4px 6px;white-space:nowrap;${tdBg}">${it.id || '—'}</td>
          <td style="font-size:7.5pt;padding:4px 6px;${tdBg}">${it.desc || '—'}</td>
          <td style="text-align:center;padding:4px 6px;font-size:6pt;font-family:monospace;${tdBg}">${it.un || ''}</td>
          <td style="text-align:right;font-family:monospace;font-size:7pt;padding:4px 6px;color:#6b7280;${tdBg}">${mudanca ? fmtN(qtdAnt) : fmtN(qtdVigor)}</td>
          <td style="text-align:right;font-family:monospace;font-size:7.5pt;padding:4px 6px;font-weight:${mudanca ? 700 : 400};${tdBg}">${removido ? `<s>${fmtN(qtdVigor)}</s>` : fmtN(qtdVigor)}</td>
          <td style="text-align:right;font-family:monospace;font-size:7.5pt;padding:4px 6px;${tdBg}">${R$(upVigor)}</td>
          <td style="text-align:right;font-family:monospace;font-size:7.5pt;padding:4px 6px;font-weight:600;${tdBg}">${removido ? '—' : R$(total)}</td>
          <td style="text-align:center;padding:4px 6px;${tdBg}">${situacao}</td>
        </tr>`;
      }).join('');
    } else {
      // Fallback: mostra apenas itens alterados (aditivos sem itensSnapshot)
      linhas = itensMudados.map(it => {
        const op  = it.operacao || '';
        const tot = trunc2((parseFloat(it.qtdNova) || 0) * (parseFloat(it.upNova) || 0) * (1 + bdi));
        // Usa classeRealce como fonte única de verdade
        const trClass = op === 'exclusao'
          ? 'linha-suprimiu-item'
          : op === 'inclusao'
            ? 'linha-aumento-qtd'
            : classeRealce(it.upNova, it.upAnterior, it.qtdNova, it.qtdAnterior);
        const bgColor = bgPDF[trClass] || '';
        const bg  = bgColor ? `background-color:${bgColor};` : '';
        return `<tr style="border-bottom:1px solid #f3f4f6;${bg}">
          <td style="font-family:monospace;font-size:7pt;padding:4px 6px">${it.itemId || '—'}</td>
          <td style="font-size:7.5pt;padding:4px 6px">${it.descricao || '—'}</td>
          <td></td>
          <td style="text-align:right;font-family:monospace;font-size:7pt;padding:4px 6px;color:#6b7280">${it.qtdAnterior != null ? it.qtdAnterior : ''}</td>
          <td style="text-align:right;font-family:monospace;font-size:7.5pt;padding:4px 6px;font-weight:700">${it.qtdNova != null ? it.qtdNova : ''}</td>
          <td style="text-align:right;font-family:monospace;font-size:7.5pt;padding:4px 6px">${it.upNova != null ? R$(it.upNova) : '—'}</td>
          <td style="text-align:right;font-family:monospace;font-size:7.5pt;padding:4px 6px;font-weight:600">${op !== 'exclusao' ? R$(tot) : '—'}</td>
          <td></td>
        </tr>`;
      }).join('');
    }

    const totalItensLabel = usandoSnapshot
      ? `${planilha.filter(i => !i.t || i.t === 'item').length} item(ns) — ${itensMudados.length} alterado(s)`
      : `${itensMudados.length} item(ns) alterado(s)`;

    const html = `<!DOCTYPE html><html lang="pt-BR"><head>
      <meta charset="UTF-8">
      <title>Aditivo Nº ${String(aditivo.numero).padStart(2,'0')}</title>
      <style>
        * { box-sizing: border-box; margin: 0; padding: 0; }
        body { font-family: 'Arial', sans-serif; font-size: 9pt; color: #1f2937; background: #fff; padding: 16mm 12mm; }
        .header { text-align: center; border-bottom: 3px solid #1d4ed8; padding-bottom: 10px; margin-bottom: 14px; }
        .header h1 { font-size: 13pt; color: #1d4ed8; font-weight: 800; letter-spacing: .5px; }
        .header p { font-size: 8.5pt; color: #6b7280; margin-top: 3px; }
        .info-grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 6px; margin-bottom: 12px; }
        .info-box { background: #f9fafb; border: 1px solid #e5e7eb; border-radius: 5px; padding: 6px 8px; }
        .info-box .lbl { font-size: 6.5pt; text-transform: uppercase; color: #9ca3af; letter-spacing: .5px; margin-bottom: 2px; }
        .info-box .val { font-weight: 700; font-size: 8.5pt; }
        .kpi-grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 6px; margin-bottom: 12px; }
        .kpi-box { border-radius: 5px; padding: 8px; text-align: center; }
        .kpi-lbl { font-size: 6.5pt; text-transform: uppercase; font-weight: 700; margin-bottom: 3px; }
        .kpi-val { font-weight: 800; font-size: 10pt; font-family: monospace; }
        .legenda { display: flex; gap: 8px; flex-wrap: wrap; margin-bottom: 8px; }
        .leg-item { font-size: 6.5pt; font-weight: 600; padding: 2px 6px; border-radius: 3px; border: 1px solid; }
        .secao { font-size: 8pt; font-weight: 800; text-transform: uppercase; letter-spacing: .5px; color: #374151; border-bottom: 1px solid #d1d5db; padding-bottom: 3px; margin-bottom: 6px; margin-top: 12px; }
        table { width: 100%; border-collapse: collapse; }
        th { background: #f3f4f6; color: #374151; font-weight: 700; padding: 5px 6px; border: 1px solid #d1d5db; text-align: right; font-size: 7pt; }
        th:nth-child(1), th:nth-child(2) { text-align: left; }
        td { padding: 4px 5px; border-bottom: 1px solid #f3f4f6; vertical-align: middle; font-size: 7.5pt; }
        .assinaturas { display: grid; grid-template-columns: repeat(3, 1fr); gap: 16px; margin-top: 55px; }
        .assinatura { text-align: center; border-top: 1px solid #374151; padding-top: 5px; }
        .assin-nome { font-weight: 700; font-size: 8pt; }
        .assin-cargo { font-size: 6.5pt; color: #6b7280; }
        .rodape { margin-top: 16px; font-size: 6.5pt; color: #9ca3af; text-align: center; border-top: 1px solid #e5e7eb; padding-top: 6px; }
        @media print { body { padding: 8mm 8mm; } @page { size: A4 landscape; margin: 8mm; } }
      </style>
    </head><body>
      <div class="header">
        <h1>PLANILHA DE ADITIVO CONTRATUAL — Nº ${String(aditivo.numero).padStart(2, '0')}</h1>
        <p>${cfg?.objeto || ''}</p>
      </div>

      <div class="info-grid">
        <div class="info-box"><div class="lbl">Contrato</div><div class="val">${cfg?.contrato || '—'}</div></div>
        <div class="info-box"><div class="lbl">Nº do Aditivo</div><div class="val">Nº ${String(aditivo.numero).padStart(2, '0')}</div></div>
        <div class="info-box"><div class="lbl">Data</div><div class="val">${aditivo.data || '—'}</div></div>
        <div class="info-box"><div class="lbl">Tipo</div><div class="val">${TIPO_LABEL[aditivo.tipo] || aditivo.tipo}</div></div>
        <div class="info-box"><div class="lbl">Status</div><div class="val">${aditivo.status || 'Rascunho'}</div></div>
        <div class="info-box"><div class="lbl">Versão Gerada</div><div class="val">v${aditivo.contractVersionNova || '—'}</div></div>
        <div class="info-box"><div class="lbl">Prazo Aditivado</div><div class="val">${prazoStr}</div></div>
        <div class="info-box"><div class="lbl">Valor Anterior</div><div class="val">${aditivo.valorAnterior ? R$(aditivo.valorAnterior) : '—'}</div></div>
        <div class="info-box"><div class="lbl">Novo Valor</div><div class="val">${aditivo.valorNovo ? R$(aditivo.valorNovo) : '—'}</div></div>
        ${aditivo.descricao ? `<div class="info-box" style="grid-column:span 3"><div class="lbl">Descrição</div><div class="val">${aditivo.descricao}</div></div>` : ''}
      </div>

      <div class="kpi-grid">
        <div class="kpi-box" style="background:#dcfce7;border:1px solid #86efac"><div class="kpi-lbl" style="color:#15803d">Total Acréscimos (c/BDI)</div><div class="kpi-val" style="color:#15803d">+${R$(totais.acrescimos)}</div></div>
        <div class="kpi-box" style="background:#fee2e2;border:1px solid #fca5a5"><div class="kpi-lbl" style="color:#b91c1c">Total Supressões (c/BDI)</div><div class="kpi-val" style="color:#b91c1c">−${R$(totais.supressoes)}</div></div>
        <div class="kpi-box" style="background:#f0f9ff;border:1px solid #bae6fd"><div class="kpi-lbl" style="color:#0369a1">Saldo Líquido Aditivado</div><div class="kpi-val" style="color:#0369a1">${delta >= 0 ? '+' : ''}${R$(delta)}</div></div>
      </div>

      <div class="legenda">
        <span class="leg-item" style="background:#bbf7d0;color:#15803d;border-color:#86efac">🟢 Valor Unitário Aumentado</span>
        <span class="leg-item" style="background:#e9d5ff;color:#7e22ce;border-color:#d8b4fe">🟣 Valor Unitário Reduzido</span>
        <span class="leg-item" style="background:#dbeafe;color:#1d4ed8;border-color:#93c5fd">🔵 Quantidade Aumentada / Novo</span>
        <span class="leg-item" style="background:#fecaca;color:#b91c1c;border-color:#fca5a5">🔴 Quantidade Reduzida</span>
        <span class="leg-item" style="background:#fef08a;color:#854d0e;border-color:#fde047">🟡 Suprimido (Qtd=0)</span>
        <span class="leg-item" style="background:#f9fafb;color:#6b7280;border-color:#e5e7eb">⬜ Sem alteração</span>
      </div>

      <div class="secao">Planilha Completa Vigente — ${totalItensLabel}</div>
      <table>
        <thead>
          <tr>
            <th style="text-align:left;width:52px">Cód.</th>
            <th style="text-align:left">Descrição</th>
            <th style="width:28px">Un.</th>
            <th style="width:58px">Qtd Ant.</th>
            <th style="width:58px">Qtd Vigente</th>
            <th style="width:80px">P. Unit. (s/BDI)</th>
            <th style="width:88px">Total (c/BDI)</th>
            <th style="width:60px;text-align:center">Situação</th>
          </tr>
        </thead>
        <tbody>${linhas}</tbody>
      </table>

      <div class="assinaturas">
        <div class="assinatura">
          <div class="assin-nome">${cfg?.fiscal || '______________________________'}</div>
          <div class="assin-cargo">Fiscal do Contrato</div>
          <div class="assin-cargo" style="margin-top:3px">Data: ___/___/______</div>
        </div>
        <div class="assinatura">
          <div class="assin-nome">${cfg?.contratada || '______________________________'}</div>
          <div class="assin-cargo">Responsável Técnico</div>
          <div class="assin-cargo" style="margin-top:3px">Data: ___/___/______</div>
        </div>
        <div class="assinatura">
          <div class="assin-nome">${cfg?.contratante || '______________________________'}</div>
          <div class="assin-cargo">Gestora do Contrato</div>
          <div class="assin-cargo" style="margin-top:3px">Data: ___/___/______</div>
        </div>
      </div>

      <div class="rodape">
        Fiscal na Obra · Planilha do Aditivo Nº ${String(aditivo.numero).padStart(2, '0')} · Emitido em ${agora.toLocaleDateString('pt-BR')} às ${agora.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}
      </div>
      <script>window.onload=function(){ setTimeout(function(){ window.print(); }, 500); }</script>
    </body></html>`;

    const janela = window.open('', `adt_pdf_${aditivo.id}`, 'width=1000,height=700,scrollbars=yes');
    if (janela) {
      janela.document.write(html);
      janela.document.close();
    }
  }
}