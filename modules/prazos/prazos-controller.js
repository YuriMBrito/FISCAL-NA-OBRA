/**
 * ╔══════════════════════════════════════════════════════════════╗
 * ║  FISCAL NA OBRA — modules/prazos/prazos-controller.js        ║
 * ║  Módulo: PrazosModule — Lei 14.133/2021                      ║
 * ║  Controle de Prazos e Prorrogações Contratuais              ║
 * ╚══════════════════════════════════════════════════════════════╝
 *
 * REGRA: Não altera cfg existente. Mantém histórico de prorrogações.
 * Usa cfg.inicioPrev e cfg.duracaoDias como fonte de verdade inicial.
 */

import EventBus       from '../../core/EventBus.js';
import state          from '../../core/state.js';
import router         from '../../core/router.js';
import { formatters } from '../../utils/formatters.js';
import FirebaseService from '../../firebase/firebase-service.js';
import { validarProrrogacao } from '../../utils/server-validators.js';

const dataBR  = iso => iso ? new Date(iso + 'T12:00:00').toLocaleDateString('pt-BR') : '—';
const hoje    = () => new Date().toISOString().slice(0, 10);
const esc     = s => String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const diffDias = (dataFim) => {
  if (!dataFim) return null;
  const d = new Date(dataFim + 'T23:59:59') - new Date();
  return Math.ceil(d / 86400000);
};

export class PrazosModule {
  constructor() {
    this._subs         = [];
    this._prorrogacoes = [];
    this._editProrId   = null;
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
    try {
      this._prorrogacoes = await FirebaseService.getProrrogacoes(obraId).catch(() => []) || [];
    } catch (e) { this._prorrogacoes = []; }
  }

  async _salvar() {
    const obraId = state.get('obraAtivaId');
    if (!obraId) return;
    await FirebaseService.salvarProrrogacoes(obraId, this._prorrogacoes);
    window.auditRegistrar?.({ modulo: 'Prazos', tipo: 'salvo', registro: obraId, detalhe: 'Prorrogações atualizadas' });
  }

  // ── Cálculo de prazo consolidado ───────────────────────────────
  _calcPrazo(cfg) {
    const inicio    = cfg.inicioReal || cfg.inicioPrev || null;
    const diasBase  = parseInt(cfg.duracaoDias) || 0;
    const diasProrr = this._prorrogacoes.reduce((a, p) => a + (parseInt(p.dias) || 0), 0);
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
      if (diasRestantes < 0)  status = 'atrasado';
      else if (diasRestantes <= 30) status = 'atencao';
      else status = 'em_dia';
    }
    // Verifica se a obra está concluída
    const obrasLista = state.get('obrasLista') || [];
    const obraRef = obrasLista.find(o => o.id === state.get('obraAtivaId'));
    if (obraRef?.statusObra === 'Concluída') status = 'concluido';

    return { inicio, diasBase, diasProrr, diasTotal, dataFimStr, diasRestantes, status };
  }

  _render() {
    const el = document.getElementById('prazos-conteudo');
    if (!el) return;
    const cfg = state.get('cfg') || {};
    const obraId = state.get('obraAtivaId');

    if (!obraId) {
      el.innerHTML = '<div style="text-align:center;padding:40px;color:var(--text-muted)">Selecione uma obra.</div>';
      return;
    }

    const p = this._calcPrazo(cfg);

    const statusCores = {
      em_dia:     { bg: '#dcfce7', border: '#22c55e', text: '#15803d', label: '✅ Em dia'      },
      atencao:    { bg: '#fef3c7', border: '#f59e0b', text: '#92400e', label: '⚠️ Atenção'     },
      atrasado:   { bg: '#fee2e2', border: '#ef4444', text: '#991b1b', label: '🔴 Atrasado'    },
      concluido:  { bg: '#dbeafe', border: '#3b82f6', text: '#1e40af', label: '🏆 Concluído'   },
      indefinido: { bg: '#f3f4f6', border: '#9ca3af', text: '#6b7280', label: '❓ Indefinido'  },
    };
    const sc = statusCores[p.status] || statusCores.indefinido;

    el.innerHTML = `
      <!-- Painel de status -->
      <div style="background:${sc.bg};border:2px solid ${sc.border};border-radius:12px;
        padding:16px 20px;margin-bottom:16px;display:grid;grid-template-columns:1fr 1fr 1fr 1fr;gap:12px">
        <div style="text-align:center">
          <div style="font-size:10px;color:${sc.text};text-transform:uppercase;font-weight:700;letter-spacing:.5px">Status</div>
          <div style="font-size:16px;font-weight:900;color:${sc.text};margin-top:4px">${sc.label}</div>
        </div>
        <div style="text-align:center">
          <div style="font-size:10px;color:var(--text-muted);text-transform:uppercase;font-weight:700;letter-spacing:.5px">Prazo Original</div>
          <div style="font-size:15px;font-weight:800;color:var(--text-primary);margin-top:4px">${p.diasBase > 0 ? p.diasBase + ' dias' : '—'}</div>
        </div>
        <div style="text-align:center">
          <div style="font-size:10px;color:var(--text-muted);text-transform:uppercase;font-weight:700;letter-spacing:.5px">Total Prorrogado</div>
          <div style="font-size:15px;font-weight:800;color:${p.diasProrr > 0 ? '#f59e0b' : 'var(--text-primary)'};margin-top:4px">
            ${p.diasProrr > 0 ? '+' + p.diasProrr + ' dias' : '—'}
          </div>
        </div>
        <div style="text-align:center">
          <div style="font-size:10px;color:var(--text-muted);text-transform:uppercase;font-weight:700;letter-spacing:.5px">
            ${p.diasRestantes !== null && p.diasRestantes < 0 ? 'Dias em Atraso' : 'Dias Restantes'}
          </div>
          <div style="font-size:15px;font-weight:800;color:${sc.text};margin-top:4px">
            ${p.diasRestantes !== null ? Math.abs(p.diasRestantes) : '—'}
          </div>
        </div>
      </div>

      <!-- Datas -->
      <div style="background:var(--bg-surface);border:1px solid var(--border);border-radius:8px;
        padding:12px 16px;margin-bottom:14px;display:grid;grid-template-columns:1fr 1fr 1fr 1fr;gap:10px">
        <div>
          <div style="font-size:10px;font-weight:700;color:var(--text-muted)">INÍCIO PREVISTO</div>
          <div style="font-size:12px;font-weight:600;margin-top:3px">${dataBR(cfg.inicioPrev)}</div>
        </div>
        <div>
          <div style="font-size:10px;font-weight:700;color:var(--text-muted)">INÍCIO REAL</div>
          <div style="font-size:12px;font-weight:600;margin-top:3px">${dataBR(cfg.inicioReal) || '—'}</div>
        </div>
        <div>
          <div style="font-size:10px;font-weight:700;color:var(--text-muted)">PRAZO TOTAL</div>
          <div style="font-size:12px;font-weight:600;margin-top:3px">${p.diasTotal > 0 ? p.diasTotal + ' dias' : '—'}</div>
        </div>
        <div>
          <div style="font-size:10px;font-weight:700;color:var(--text-muted)">TÉRMINO PREVISTO</div>
          <div style="font-size:12px;font-weight:700;color:${sc.text};margin-top:3px">${dataBR(p.dataFimStr)}</div>
        </div>
      </div>

      <!-- Prorrogações -->
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:10px">
        <div style="font-size:13px;font-weight:700;color:var(--text-primary)">
          📋 Histórico de Prorrogações (${this._prorrogacoes.length})
        </div>
        <button class="btn btn-verde btn-sm" data-action="_prazoNovaProrr">➕ Adicionar Prorrogação</button>
      </div>

      <div id="prazo-form-wrap"></div>

      ${this._prorrogacoes.length === 0
        ? '<div style="text-align:center;padding:20px;color:var(--text-muted);font-size:12px">Nenhuma prorrogação registrada.</div>'
        : `<table style="width:100%;border-collapse:collapse;font-size:12px">
            <thead><tr style="background:var(--bg-surface)">
              <th style="padding:7px 8px;text-align:left;font-size:10px;color:var(--text-muted);border-bottom:1px solid var(--border)">Nº Ato/Aditivo</th>
              <th style="padding:7px 8px;text-align:right;font-size:10px;color:var(--text-muted);border-bottom:1px solid var(--border)">Dias</th>
              <th style="padding:7px 8px;text-align:left;font-size:10px;color:var(--text-muted);border-bottom:1px solid var(--border)">Fundamento Legal (Art. 111)</th>
              <th style="padding:7px 8px;text-align:left;font-size:10px;color:var(--text-muted);border-bottom:1px solid var(--border)">Justificativa</th>
              <th style="padding:7px 8px;text-align:left;font-size:10px;color:var(--text-muted);border-bottom:1px solid var(--border)">Data</th>
              <th style="padding:7px 8px;border-bottom:1px solid var(--border)"></th>
            </tr></thead>
            <tbody>
              ${this._prorrogacoes.map(pr => {
                const semFundamento = !pr.fundamentoLegal;
                return `
                <tr style="border-bottom:1px solid var(--border)${semFundamento ? ';background:#fffbeb' : ''}">
                  <td style="padding:7px 8px;font-weight:600">${esc(pr.ato) || '—'}</td>
                  <td style="padding:7px 8px;text-align:right;font-weight:700;color:#f59e0b">+${pr.dias}d</td>
                  <td style="padding:7px 8px;font-size:11px">
                    ${semFundamento
                      ? '<span style="color:#b45309;font-size:10px;font-weight:700">⚠️ Não informado</span>'
                      : `<span style="color:#1d4ed8;font-size:10px">${esc(pr.fundamentoLegal).replace(/_/g,' ')}</span>`}
                  </td>
                  <td style="padding:7px 8px;font-size:11px;color:var(--text-muted)">${esc(pr.justificativa)}</td>
                  <td style="padding:7px 8px;font-size:11px">${dataBR(pr.data)}</td>
                  <td style="padding:7px 8px;white-space:nowrap">
                    <button class="btn btn-cinza btn-sm" style="padding:2px 7px;font-size:10px"
                      data-action="_prazoEditarProrr" data-arg0="${pr.id}" >✏️</button>
                    <button class="btn btn-vermelho btn-sm" style="padding:2px 7px;font-size:10px;margin-left:3px"
                      data-action="_prazoExcluirProrr" data-arg0="${pr.id}" >🗑️</button>
                  </td>
                </tr>`}).join('')}
            </tbody>
           </table>`
      }`;
  }

  _renderFormProrr(id = null) {
    const wrap = document.getElementById('prazo-form-wrap');
    if (!wrap) return;
    const pr = id ? this._prorrogacoes.find(x => x.id === id) : null;
    // CORREÇÃO: hipóteses legais do Art. 111 da Lei 14.133/2021
    const fundamentosLegais = [
      { v: '',                    l: '— Selecione o fundamento legal —' },
      { v: 'caso_fortuito',       l: 'Caso fortuito ou força maior (Art. 111, I)' },
      { v: 'fato_principe',       l: 'Fato do príncipe / ato de autoridade (Art. 111, II)' },
      { v: 'fato_administracao',  l: 'Fato da Administração (Art. 111, III)' },
      { v: 'servicos_extras',     l: 'Serviços extras não imputáveis ao contratado (Art. 111, IV)' },
      { v: 'impedimento_execucao',l: 'Impedimento de execução por ordem administrativa (Art. 111, V)' },
      { v: 'chuvas',              l: 'Chuvas acima da média histórica (Art. 111, VI)' },
      { v: 'outro',               l: 'Outro fundamento (detalhar na justificativa)' },
    ];
    const selOpts = fundamentosLegais.map(f =>
      `<option value="${f.v}" ${pr?.fundamentoLegal === f.v ? 'selected' : ''}>${f.l}</option>`
    ).join('');

    wrap.innerHTML = `
      <div style="background:var(--bg-surface);border:1px solid var(--border);border-radius:8px;
        padding:14px;margin-bottom:12px">
        <div style="font-size:12px;font-weight:700;margin-bottom:10px">${pr ? 'Editar Prorrogação' : 'Nova Prorrogação'}</div>
        <div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:10px">
          <div>
            <label style="font-size:10px;font-weight:700;color:var(--text-muted);display:block;margin-bottom:3px">Nº Ato / Aditivo</label>
            <input id="prorr-ato" type="text" value="${esc(pr?.ato)}" placeholder="Ex: 1º Aditivo"
              style="width:100%;padding:7px;border-radius:6px;border:1px solid var(--border);
              background:var(--bg-card);color:var(--text-primary);font-size:12px;box-sizing:border-box">
          </div>
          <div>
            <label style="font-size:10px;font-weight:700;color:var(--text-muted);display:block;margin-bottom:3px">Dias Adicionados *</label>
            <input id="prorr-dias" type="number" min="1" value="${pr?.dias || ''}" placeholder="Ex: 30"
              style="width:100%;padding:7px;border-radius:6px;border:1px solid var(--border);
              background:var(--bg-card);color:var(--text-primary);font-size:12px;box-sizing:border-box">
          </div>
          <div>
            <label style="font-size:10px;font-weight:700;color:var(--text-muted);display:block;margin-bottom:3px">Data da Prorrogação</label>
            <input id="prorr-data" type="date" value="${pr?.data || hoje()}"
              style="width:100%;padding:7px;border-radius:6px;border:1px solid var(--border);
              background:var(--bg-card);color:var(--text-primary);font-size:12px;box-sizing:border-box">
          </div>
          <div style="grid-column:1/-1">
            <label style="font-size:10px;font-weight:700;color:var(--text-muted);display:block;margin-bottom:3px">
              Fundamento Legal * <span style="font-size:9px;color:#6b7280">(Lei 14.133/2021 Art. 111)</span>
            </label>
            <select id="prorr-fundamento"
              style="width:100%;padding:7px;border-radius:6px;border:1px solid var(--border);
              background:var(--bg-card);color:var(--text-primary);font-size:12px;box-sizing:border-box">
              ${selOpts}
            </select>
          </div>
          <div style="grid-column:1/-1">
            <label style="font-size:10px;font-weight:700;color:var(--text-muted);display:block;margin-bottom:3px">Justificativa *</label>
            <input id="prorr-just" type="text" value="${esc(pr?.justificativa)}" placeholder="Descreva o motivo da prorrogação"
              style="width:100%;padding:7px;border-radius:6px;border:1px solid var(--border);
              background:var(--bg-card);color:var(--text-primary);font-size:12px;box-sizing:border-box">
          </div>
        </div>
        <div style="display:flex;gap:8px;justify-content:flex-end;margin-top:10px">
          <button class="btn btn-cinza btn-sm" data-action="_prazoCancelarForm">Cancelar</button>
          <button class="btn btn-verde btn-sm" data-action="_prazoSalvarProrr" data-arg0="${id || ''}" >💾 Salvar</button>
        </div>
      </div>`;
  }

  _exposeGlobals() {
    window._prazoNovaProrr    = () => this._renderFormProrr(null);
    window._prazoEditarProrr  = (id) => this._renderFormProrr(id);
    window._prazoExcluirProrr = async (id) => {
      if (!confirm('Excluir esta prorrogação?')) return;
      this._prorrogacoes = this._prorrogacoes.filter(p => p.id !== id);
      await this._salvar(); this._render();
      window.toast?.('🗑️ Prorrogação removida.', 'ok');
    };
    window._prazoSalvarProrr  = async (editId) => {
      const g = id => document.getElementById(id)?.value?.trim() || '';
      const dias = parseInt(g('prorr-dias'));
      if (!dias || dias < 1) { window.toast?.('⚠️ Informe a quantidade de dias.', 'warn'); return; }
      // CORREÇÃO: fundamento legal obrigatório (Lei 14.133/2021 Art. 111)
      const fundamentoLegal = g('prorr-fundamento');
      if (!fundamentoLegal) { window.toast?.('⚠️ Selecione o fundamento legal da prorrogação (Lei 14.133/2021 Art. 111).', 'warn'); return; }
      const justificativa = g('prorr-just');
      if (!justificativa) { window.toast?.('⚠️ Informe a justificativa da prorrogação.', 'warn'); return; }

      // ── Validação Art. 111 via server-validators (substitui Cloud Function validarProrrogacaoArt111)
      // Migrado para client-side para funcionar no plano Spark (gratuito) do Firebase.
      const cfg = state.get('cfg') || {};
      const prazoAtual = this._calcPrazo(cfg);
      const dataTerminoAtual = prazoAtual.dataFimStr || cfg.termino || '';
      const novaDataTermino  = (() => {
        if (!dataTerminoAtual || !dias) return '';
        const d = new Date(dataTerminoAtual + 'T12:00:00');
        d.setDate(d.getDate() + dias);
        return d.toISOString().slice(0, 10);
      })();
      const { ok: prorOk, erros: prorErros } = validarProrrogacao({ dataTerminoAtual, novaDataTermino, justificativa });
      if (!prorOk) {
        window.toast?.(`⚠️ ${prorErros.join(' ')}`, 'warn');
        return;
      }
      const item = {
        id:             editId || `prorr_${Date.now()}`,
        ato:            g('prorr-ato'),
        dias,
        data:           g('prorr-data'),
        fundamentoLegal,
        justificativa,
        criadoEm:       new Date().toISOString(),
      };
      if (editId) {
        this._prorrogacoes = this._prorrogacoes.map(p => p.id === editId ? { ...p, ...item } : p);
      } else {
        this._prorrogacoes.push(item);
      }
      await this._salvar(); this._render();
      window.toast?.('✅ Prorrogação salva!', 'ok');
    };
  }

  _bindEvents() {
    this._subs.push(
      EventBus.on('obra:selecionada', async () => {
        await this._carregar();
        if (router.current === 'prazos') this._render();
      }, 'prazos'),
      EventBus.on('config:salva', async () => {
        if (router.current === 'prazos') this._render();
      }, 'prazos')
    );
  }

  destroy() {
    this._subs.forEach(u => u?.());
    this._subs = [];
    EventBus.offByContext('prazos');
  }
}
