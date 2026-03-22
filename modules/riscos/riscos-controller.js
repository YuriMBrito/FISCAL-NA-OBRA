/**
 * ╔══════════════════════════════════════════════════════════════╗
 * ║  FISCAL NA OBRA — modules/riscos/riscos-controller.js        ║
 * ║  Módulo: RiscosModule — Matriz de Riscos Contratuais         ║
 * ║  Lei 14.133/2021 e boas práticas de gestão de contratos     ║
 * ╚══════════════════════════════════════════════════════════════╝
 */

import EventBus       from '../../core/EventBus.js';
import state          from '../../core/state.js';
import router         from '../../core/router.js';
import FirebaseService from '../../firebase/firebase-service.js';

const esc  = s => String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const hoje = () => new Date().toISOString().slice(0, 10);

const PROBABILIDADES = [
  { key: 'baixa',  label: 'Baixa',  cor: '#22c55e', peso: 1 },
  { key: 'media',  label: 'Média',  cor: '#f59e0b', peso: 2 },
  { key: 'alta',   label: 'Alta',   cor: '#ef4444', peso: 3 },
];
const IMPACTOS = [
  { key: 'baixo',  label: 'Baixo',  cor: '#22c55e', peso: 1 },
  { key: 'medio',  label: 'Médio',  cor: '#f59e0b', peso: 2 },
  { key: 'alto',   label: 'Alto',   cor: '#ef4444', peso: 3 },
  { key: 'critico',label: 'Crítico',cor: '#7c3aed', peso: 4 },
];
const STATUS_RISCO = [
  { key: 'identificado', label: 'Identificado', cor: '#6b7280' },
  { key: 'monitorando',  label: 'Monitorando',  cor: '#3b82f6' },
  { key: 'mitigado',     label: 'Mitigado',     cor: '#22c55e' },
  { key: 'materializado',label: 'Materializado',cor: '#ef4444' },
  { key: 'encerrado',    label: 'Encerrado',    cor: '#7c3aed' },
];

// Calcula nível consolidado: probabilidade × impacto
const nivelRisco = (r) => {
  const p = PROBABILIDADES.find(x => x.key === r.probabilidade)?.peso || 0;
  const i = IMPACTOS.find(x => x.key === r.impacto)?.peso || 0;
  const v = p * i;
  if (v >= 9) return { label: 'Crítico',  cor: '#7c3aed' };
  if (v >= 6) return { label: 'Alto',     cor: '#ef4444' };
  if (v >= 3) return { label: 'Médio',    cor: '#f59e0b' };
  if (v >= 1) return { label: 'Baixo',    cor: '#22c55e' };
  return          { label: '—',       cor: '#9ca3af' };
};

export class RiscosModule {
  constructor() {
    this._subs   = [];
    this._lista  = [];
    this._view   = 'lista';
    this._editId = null;
  }

  async init() {
    try { this._bindEvents(); this._exposeGlobals(); }
    catch (e) { console.error('[RiscosModule] init:', e); }
  }

  async onEnter() {
    try { await this._carregar(); this._view = 'lista'; this._render(); }
    catch (e) { console.error('[RiscosModule] onEnter:', e); }
  }

  async _carregar() {
    const obraId = state.get('obraAtivaId');
    if (!obraId) return;
    try {
      this._lista = await FirebaseService.getRiscos(obraId).catch(() => []) || [];
    } catch (e) { this._lista = []; }
  }

  async _salvar() {
    const obraId = state.get('obraAtivaId');
    if (!obraId) return;
    await FirebaseService.salvarRiscos(obraId, this._lista);
    window.auditRegistrar?.({ modulo: 'Riscos', tipo: 'salvo', registro: obraId, detalhe: 'Matriz de riscos atualizada' });
  }

  _render() {
    const el = document.getElementById('riscos-conteudo');
    if (!el) return;
    const obraId = state.get('obraAtivaId');
    if (!obraId) {
      el.innerHTML = '<div style="text-align:center;padding:40px;color:var(--text-muted)">Selecione uma obra.</div>';
      return;
    }
    if (this._view === 'form') { this._renderForm(); return; }

    const criticos = this._lista.filter(r => nivelRisco(r).label === 'Crítico').length;
    const altos    = this._lista.filter(r => nivelRisco(r).label === 'Alto').length;
    const ativos   = this._lista.filter(r => r.status !== 'encerrado' && r.status !== 'mitigado').length;

    el.innerHTML = `
      <!-- Resumo -->
      <div style="display:grid;grid-template-columns:repeat(4,1fr);gap:10px;margin-bottom:16px">
        <div style="background:var(--bg-surface);border:1px solid var(--border);border-radius:8px;padding:12px;text-align:center">
          <div style="font-size:20px;font-weight:800">${this._lista.length}</div>
          <div style="font-size:10px;color:var(--text-muted);margin-top:2px">Total cadastrado</div>
        </div>
        <div style="background:#fee2e2;border:1px solid #ef4444;border-radius:8px;padding:12px;text-align:center">
          <div style="font-size:20px;font-weight:800;color:#991b1b">${altos + criticos}</div>
          <div style="font-size:10px;color:#991b1b;margin-top:2px">Alto/Crítico</div>
        </div>
        <div style="background:#fef3c7;border:1px solid #f59e0b;border-radius:8px;padding:12px;text-align:center">
          <div style="font-size:20px;font-weight:800;color:#92400e">${ativos}</div>
          <div style="font-size:10px;color:#92400e;margin-top:2px">Ativos</div>
        </div>
        <div style="background:#dcfce7;border:1px solid #22c55e;border-radius:8px;padding:12px;text-align:center">
          <div style="font-size:20px;font-weight:800;color:#15803d">
            ${this._lista.filter(r => r.status === 'mitigado' || r.status === 'encerrado').length}
          </div>
          <div style="font-size:10px;color:#15803d;margin-top:2px">Mitigados/Enc.</div>
        </div>
      </div>

      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:12px">
        <div style="font-size:11px;color:var(--text-muted)">🎯 Matriz de identificação e tratamento de riscos</div>
        <button class="btn btn-verde btn-sm" data-action="_riscoNovoForm">➕ Novo Risco</button>
      </div>

      ${this._lista.length === 0
        ? '<div style="text-align:center;padding:30px;color:var(--text-muted);font-size:12px">Nenhum risco cadastrado.</div>'
        : `<table style="width:100%;border-collapse:collapse;font-size:12px">
            <thead><tr style="background:var(--bg-surface)">
              ${['Descrição', 'Prob.', 'Impacto', 'Nível', 'Responsável', 'Status', ''].map(h =>
                `<th style="padding:7px 8px;text-align:left;font-size:10px;color:var(--text-muted);border-bottom:1px solid var(--border)">${h}</th>`
              ).join('')}
            </tr></thead>
            <tbody>
              ${this._lista.map(r => {
                const prob = PROBABILIDADES.find(x => x.key === r.probabilidade);
                const imp  = IMPACTOS.find(x => x.key === r.impacto);
                const nv   = nivelRisco(r);
                const st   = STATUS_RISCO.find(x => x.key === r.status) || { label: r.status, cor: '#6b7280' };
                return `<tr style="border-bottom:1px solid var(--border)">
                  <td style="padding:7px 8px;max-width:200px">
                    <div style="font-weight:600">${esc(r.descricao)}</div>
                    ${r.planoAcao ? `<div style="font-size:10px;color:var(--text-muted);margin-top:2px">▶ ${esc(r.planoAcao).slice(0, 60)}${r.planoAcao.length > 60 ? '…' : ''}</div>` : ''}
                  </td>
                  <td style="padding:7px 8px">
                    <span style="font-size:10px;font-weight:700;color:${prob?.cor || '#6b7280'}">${prob?.label || '—'}</span>
                  </td>
                  <td style="padding:7px 8px">
                    <span style="font-size:10px;font-weight:700;color:${imp?.cor || '#6b7280'}">${imp?.label || '—'}</span>
                  </td>
                  <td style="padding:7px 8px">
                    <span style="font-size:10px;font-weight:700;padding:2px 7px;border-radius:10px;
                      background:${nv.cor}22;color:${nv.cor}">${nv.label}</span>
                  </td>
                  <td style="padding:7px 8px;font-size:11px">${esc(r.responsavel) || '—'}</td>
                  <td style="padding:7px 8px">
                    <span style="font-size:10px;padding:2px 7px;border-radius:10px;
                      background:${st.cor}22;color:${st.cor}">${st.label}</span>
                  </td>
                  <td style="padding:7px 8px;white-space:nowrap">
                    <button class="btn btn-cinza btn-sm" style="padding:2px 7px;font-size:10px"
                      data-action="_riscoEditar" data-arg0="${r.id}" >✏️</button>
                    <button class="btn btn-vermelho btn-sm" style="padding:2px 7px;font-size:10px;margin-left:3px"
                      data-action="_riscoExcluir" data-arg0="${r.id}" >🗑️</button>
                  </td>
                </tr>`;
              }).join('')}
            </tbody>
           </table>`
      }`;
  }

  _renderForm() {
    const el = document.getElementById('riscos-conteudo');
    if (!el) return;
    const r = this._editId ? this._lista.find(x => x.id === this._editId) : null;

    const selOpts = (arr, valKey, val) => arr.map(x =>
      `<option value="${x.key}" ${val === x.key ? 'selected' : ''}>${x.label}</option>`
    ).join('');

    el.innerHTML = `
      <div style="background:var(--bg-surface);border:1px solid var(--border);border-radius:10px;padding:20px">
        <div style="font-size:14px;font-weight:700;margin-bottom:16px">
          ${r ? '✏️ Editar Risco' : '🎯 Novo Risco'}
        </div>
        <div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:12px">
          <div style="grid-column:1/-1">
            <label style="font-size:11px;font-weight:700;color:var(--text-muted);display:block;margin-bottom:4px">Descrição do Risco *</label>
            <textarea id="risco-desc" rows="2" placeholder="Descreva o risco identificado..."
              style="width:100%;padding:8px;border-radius:7px;border:1px solid var(--border);
              background:var(--bg-card);color:var(--text-primary);font-size:12px;box-sizing:border-box;resize:vertical">${esc(r?.descricao)}</textarea>
          </div>
          <div>
            <label style="font-size:11px;font-weight:700;color:var(--text-muted);display:block;margin-bottom:4px">Probabilidade</label>
            <select id="risco-prob" style="width:100%;padding:8px;border-radius:7px;border:1px solid var(--border);
              background:var(--bg-card);color:var(--text-primary);font-size:12px">
              ${selOpts(PROBABILIDADES, 'key', r?.probabilidade)}
            </select>
          </div>
          <div>
            <label style="font-size:11px;font-weight:700;color:var(--text-muted);display:block;margin-bottom:4px">Impacto</label>
            <select id="risco-imp" style="width:100%;padding:8px;border-radius:7px;border:1px solid var(--border);
              background:var(--bg-card);color:var(--text-primary);font-size:12px">
              ${selOpts(IMPACTOS, 'key', r?.impacto)}
            </select>
          </div>
          <div>
            <label style="font-size:11px;font-weight:700;color:var(--text-muted);display:block;margin-bottom:4px">Status</label>
            <select id="risco-status" style="width:100%;padding:8px;border-radius:7px;border:1px solid var(--border);
              background:var(--bg-card);color:var(--text-primary);font-size:12px">
              ${selOpts(STATUS_RISCO, 'key', r?.status || 'identificado')}
            </select>
          </div>
          <div>
            <label style="font-size:11px;font-weight:700;color:var(--text-muted);display:block;margin-bottom:4px">Responsável</label>
            <input id="risco-resp" type="text" value="${esc(r?.responsavel)}" placeholder="Nome do responsável"
              style="width:100%;padding:8px;border-radius:7px;border:1px solid var(--border);
              background:var(--bg-card);color:var(--text-primary);font-size:12px;box-sizing:border-box">
          </div>
          <div>
            <label style="font-size:11px;font-weight:700;color:var(--text-muted);display:block;margin-bottom:4px">Data de Identificação</label>
            <input id="risco-data" type="date" value="${r?.data || hoje()}"
              style="width:100%;padding:8px;border-radius:7px;border:1px solid var(--border);
              background:var(--bg-card);color:var(--text-primary);font-size:12px;box-sizing:border-box">
          </div>
          <div style="grid-column:1/-1">
            <label style="font-size:11px;font-weight:700;color:var(--text-muted);display:block;margin-bottom:4px">Plano de Ação / Mitigação</label>
            <textarea id="risco-plano" rows="2" placeholder="Descreva as ações para mitigar ou eliminar o risco..."
              style="width:100%;padding:8px;border-radius:7px;border:1px solid var(--border);
              background:var(--bg-card);color:var(--text-primary);font-size:12px;box-sizing:border-box;resize:vertical">${esc(r?.planoAcao)}</textarea>
          </div>
        </div>
        <div style="display:flex;gap:8px;justify-content:flex-end;margin-top:14px">
          <button class="btn btn-cinza btn-sm" data-action="_riscoCancelar">Cancelar</button>
          <button class="btn btn-verde btn-sm" data-action="_riscoSalvarForm" data-arg0="${this._editId || ''}" >💾 Salvar</button>
        </div>
      </div>`;
  }

  _exposeGlobals() {
    window._riscoNovoForm = () => { this._editId = null; this._view = 'form'; this._render(); };
    window._riscoEditar   = (id) => { this._editId = id; this._view = 'form'; this._render(); };
    window._riscoCancelar = () => { this._view = 'lista'; this._render(); };
    window._riscoExcluir  = async (id) => {
      if (!confirm('Excluir este risco?')) return;
      this._lista = this._lista.filter(r => r.id !== id);
      await this._salvar(); this._render();
      window.toast?.('🗑️ Risco removido.', 'ok');
    };
    window._riscoSalvarForm = async (editId) => {
      const g = id => document.getElementById(id)?.value?.trim() || '';
      const desc = g('risco-desc');
      if (!desc) { window.toast?.('⚠️ Informe a descrição.', 'warn'); return; }
      const item = {
        id:           editId || `risco_${Date.now()}`,
        descricao:    desc,
        probabilidade:g('risco-prob'),
        impacto:      g('risco-imp'),
        status:       g('risco-status') || 'identificado',
        responsavel:  g('risco-resp'),
        data:         g('risco-data'),
        planoAcao:    document.getElementById('risco-plano')?.value?.trim() || '',
        criadoEm:     new Date().toISOString(),
      };
      if (editId) {
        this._lista = this._lista.map(r => r.id === editId ? { ...r, ...item } : r);
      } else {
        this._lista.push(item);
      }
      await this._salvar(); this._view = 'lista'; this._render();
      window.toast?.('✅ Risco registrado!', 'ok');
    };
  }

  _bindEvents() {
    this._subs.push(
      EventBus.on('obra:selecionada', async () => {
        await this._carregar(); this._view = 'lista';
        if (router.current === 'riscos') this._render();
      }, 'riscos')
    );
  }

  destroy() {
    this._subs.forEach(u => u?.());
    this._subs = [];
    EventBus.offByContext('riscos');
  }
}
