/**
 * ╔══════════════════════════════════════════════════════════════╗
 * ║  FISCAL NA OBRA — modules/responsaveis/responsaveis-controller.js ║
 * ║  Módulo: ResponsaveisModule — Lei 14.133/2021 Art. 117       ║
 * ║  Gestores e Fiscais vinculados ao contrato/obra             ║
 * ╚══════════════════════════════════════════════════════════════╝
 *
 * REGRA: NÃO altera nenhuma estrutura existente.
 * Complementa o sistema com vinculação formal de responsáveis.
 */

import EventBus       from '../../core/EventBus.js';
import state          from '../../core/state.js';
import router         from '../../core/router.js';
import { formatters } from '../../utils/formatters.js';
import FirebaseService from '../../firebase/firebase-service.js';

const dataBR = iso => iso ? new Date(iso + 'T12:00:00').toLocaleDateString('pt-BR') : '—';
const hoje   = () => new Date().toISOString().slice(0, 10);
const esc    = s => String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

const PAPEIS = [
  { key: 'gestor',        icon: '🏛️', label: 'Gestor do Contrato',        obrigatorio: true  },
  { key: 'fiscal_tec',    icon: '🔧', label: 'Fiscal Técnico',             obrigatorio: true  },
  { key: 'fiscal_adm',    icon: '📋', label: 'Fiscal Administrativo',      obrigatorio: false },
  { key: 'fiscal_sup',    icon: '👁️', label: 'Fiscal Suplente',            obrigatorio: false },
  { key: 'preposto',      icon: '🤝', label: 'Preposto da Contratada',     obrigatorio: false },
];

export class ResponsaveisModule {
  constructor() {
    this._subs  = [];
    this._lista = [];
    this._editId = null;
  }

  async init() {
    try { this._bindEvents(); this._exposeGlobals(); }
    catch (e) { console.error('[ResponsaveisModule] init:', e); }
  }

  async onEnter() {
    try { await this._carregar(); this._render(); }
    catch (e) { console.error('[ResponsaveisModule] onEnter:', e); }
  }

  // ── Persistência ────────────────────────────────────────────────
  async _carregar() {
    const obraId = state.get('obraAtivaId');
    if (!obraId) return;
    try {
      this._lista = await FirebaseService.getResponsaveis(obraId).catch(() => []) || [];
      // Publica no state para acesso do dashboard de alertas
      state.set('responsaveis', this._lista);
    } catch (e) { this._lista = []; }
  }

  async _salvar() {
    const obraId = state.get('obraAtivaId');
    if (!obraId) return;
    await FirebaseService.salvarResponsaveis(obraId, this._lista);
    window.auditRegistrar?.({ modulo: 'Responsáveis', tipo: 'salvo', registro: obraId, detalhe: 'Lista de responsáveis atualizada' });
  }

  // ── Render principal ────────────────────────────────────────────
  _render() {
    const el = document.getElementById('responsaveis-conteudo');
    if (!el) return;
    const obraId = state.get('obraAtivaId');

    if (!obraId) {
      el.innerHTML = '<div style="text-align:center;padding:40px;color:var(--text-muted)">Selecione uma obra.</div>';
      return;
    }

    const temGestor   = this._lista.some(r => r.papel === 'gestor');
    const temFiscalTec = this._lista.some(r => r.papel === 'fiscal_tec');
    const alertaLei   = (!temGestor || !temFiscalTec)
      ? `<div style="background:#fef3c7;border:1px solid #f59e0b;border-radius:8px;padding:10px 14px;
           margin-bottom:14px;font-size:12px;color:#92400e;display:flex;gap:8px">
           <span>⚠️</span>
           <span><strong>Exigência Lei 14.133/2021 (Art. 117):</strong>
           ${!temGestor ? ' Gestor do Contrato não designado.' : ''}
           ${!temFiscalTec ? ' Fiscal Técnico não designado.' : ''}</span>
         </div>` : '';

    el.innerHTML = `
      ${alertaLei}
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:14px;flex-wrap:wrap;gap:8px">
        <div style="font-size:11px;color:var(--text-muted)">
          Responsáveis cadastrados: <strong>${this._lista.length}</strong>
        </div>
        <button class="btn btn-verde btn-sm" data-action="_respNovoForm">➕ Designar Responsável</button>
      </div>

      <div id="resp-form-wrap"></div>

      ${this._lista.length === 0
        ? '<div style="text-align:center;padding:30px;color:var(--text-muted);font-size:12px">Nenhum responsável designado ainda.</div>'
        : `<table style="width:100%;border-collapse:collapse;font-size:12px">
            <thead>
              <tr style="background:var(--bg-surface)">
                <th style="padding:8px;text-align:left;font-size:11px;color:var(--text-muted);border-bottom:1px solid var(--border)">Papel</th>
                <th style="padding:8px;text-align:left;font-size:11px;color:var(--text-muted);border-bottom:1px solid var(--border)">Nome</th>
                <th style="padding:8px;text-align:left;font-size:11px;color:var(--text-muted);border-bottom:1px solid var(--border)">CPF/Matrícula</th>
                <th style="padding:8px;text-align:left;font-size:11px;color:var(--text-muted);border-bottom:1px solid var(--border)">Cargo</th>
                <th style="padding:8px;text-align:left;font-size:11px;color:var(--text-muted);border-bottom:1px solid var(--border)">Designado em</th>
                <th style="padding:8px;text-align:left;font-size:11px;color:var(--text-muted);border-bottom:1px solid var(--border)">Portaria/Ato</th>
                <th style="padding:8px;text-align:center;border-bottom:1px solid var(--border)"></th>
              </tr>
            </thead>
            <tbody>
              ${this._lista.map(r => {
                const p = PAPEIS.find(x => x.key === r.papel) || { icon: '👤', label: r.papel };
                return `<tr style="border-bottom:1px solid var(--border)">
                  <td style="padding:8px">
                    <span style="display:inline-flex;align-items:center;gap:5px;font-size:11px;font-weight:700;
                      padding:2px 8px;border-radius:12px;background:var(--bg-surface)">
                      ${p.icon} ${p.label}
                    </span>
                  </td>
                  <td style="padding:8px;font-weight:600">${esc(r.nome)}</td>
                  <td style="padding:8px;font-family:var(--font-mono);font-size:11px">${esc(r.cpf)}</td>
                  <td style="padding:8px;font-size:11px">${esc(r.cargo)}</td>
                  <td style="padding:8px;font-size:11px;color:var(--text-muted)">${dataBR(r.dataDesignacao)}</td>
                  <td style="padding:8px;font-size:11px">
                    ${esc(r.documentoDesignacao) || '—'}
                    ${r.dataVigenciaFim ? (() => {
                        const diff = Math.ceil((new Date(r.dataVigenciaFim + 'T23:59:59') - new Date()) / 86400000);
                        if (diff < 0)  return `<br><span style="font-size:10px;color:#dc2626;font-weight:700">⚠️ Vencida há ${Math.abs(diff)}d</span>`;
                        if (diff <= 30) return `<br><span style="font-size:10px;color:#d97706;font-weight:700">⚠️ Vence em ${diff}d</span>`;
                        return `<br><span style="font-size:10px;color:#6b7280">Vigente até ${dataBR(r.dataVigenciaFim)}</span>`;
                      })() : ''}
                  </td>
                  <td style="padding:8px;text-align:center;white-space:nowrap">
                    <button class="btn btn-cinza btn-sm" style="padding:2px 7px;font-size:10px"
                      data-action="_respEditar" data-arg0="${r.id}" >✏️</button>
                    <button class="btn btn-vermelho btn-sm" style="padding:2px 7px;font-size:10px;margin-left:3px"
                      data-action="_respExcluir" data-arg0="${r.id}" >🗑️</button>
                  </td>
                </tr>`;
              }).join('')}
            </tbody>
           </table>`
      }`;
  }

  // ── Formulário ──────────────────────────────────────────────────
  _renderForm(id = null) {
    const r = id ? this._lista.find(x => x.id === id) : null;
    const wrap = document.getElementById('resp-form-wrap');
    if (!wrap) return;

    // papelObj resolvido no momento do render (papel atual ou primeiro da lista)
    const papelAtual = r?.papel || PAPEIS[0]?.key || '';
    const papelObj   = PAPEIS.find(p => p.key === papelAtual);
    const portariaObrig = papelObj?.obrigatorio ? ' <span style="color:#ef4444">*</span>' : '';

    wrap.innerHTML = `
      <div style="background:var(--bg-surface);border:1px solid var(--border);border-radius:10px;
        padding:18px;margin-bottom:16px">
        <div style="font-size:13px;font-weight:700;margin-bottom:14px;color:var(--text-primary)">
          ${r ? '✏️ Editar Responsável' : '➕ Designar Responsável'}
        </div>
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px">
          <div>
            <label style="font-size:11px;font-weight:700;color:var(--text-muted);display:block;margin-bottom:4px">Papel *</label>
            <select id="resp-papel" style="width:100%;padding:8px;border-radius:7px;border:1px solid var(--border);
              background:var(--bg-card);color:var(--text-primary);font-size:12px">
              ${PAPEIS.map(p => `<option value="${p.key}" ${r?.papel === p.key ? 'selected' : ''}>${p.icon} ${p.label}${p.obrigatorio ? ' *' : ''}</option>`).join('')}
            </select>
          </div>
          <div>
            <label style="font-size:11px;font-weight:700;color:var(--text-muted);display:block;margin-bottom:4px">Nome Completo *</label>
            <input id="resp-nome" type="text" value="${esc(r?.nome)}" placeholder="Nome do responsável"
              style="width:100%;padding:8px;border-radius:7px;border:1px solid var(--border);
              background:var(--bg-card);color:var(--text-primary);font-size:12px;box-sizing:border-box">
          </div>
          <div>
            <label style="font-size:11px;font-weight:700;color:var(--text-muted);display:block;margin-bottom:4px">CPF / Matrícula</label>
            <input id="resp-cpf" type="text" value="${esc(r?.cpf)}" placeholder="000.000.000-00 ou matrícula"
              style="width:100%;padding:8px;border-radius:7px;border:1px solid var(--border);
              background:var(--bg-card);color:var(--text-primary);font-size:12px;box-sizing:border-box">
          </div>
          <div>
            <label style="font-size:11px;font-weight:700;color:var(--text-muted);display:block;margin-bottom:4px">Cargo / Função</label>
            <input id="resp-cargo" type="text" value="${esc(r?.cargo)}" placeholder="Ex: Engenheiro Civil"
              style="width:100%;padding:8px;border-radius:7px;border:1px solid var(--border);
              background:var(--bg-card);color:var(--text-primary);font-size:12px;box-sizing:border-box">
          </div>
          <div>
            <label style="font-size:11px;font-weight:700;color:var(--text-muted);display:block;margin-bottom:4px">Data de Designação</label>
            <input id="resp-data" type="date" value="${r?.dataDesignacao || hoje()}"
              style="width:100%;padding:8px;border-radius:7px;border:1px solid var(--border);
              background:var(--bg-card);color:var(--text-primary);font-size:12px;box-sizing:border-box">
          </div>
          <div>
            <label style="font-size:11px;font-weight:700;color:var(--text-muted);display:block;margin-bottom:4px">
              Nº Portaria / Ato de Designação${portariaObrig}
            </label>
            <input id="resp-doc" type="text" value="${esc(r?.documentoDesignacao)}" placeholder="Ex: Portaria nº 123/2024"
              style="width:100%;padding:8px;border-radius:7px;border:1px solid var(--border);
              background:var(--bg-card);color:var(--text-primary);font-size:12px;box-sizing:border-box">
          </div>
          <div>
            <label style="font-size:11px;font-weight:700;color:var(--text-muted);display:block;margin-bottom:4px">Vigência da Portaria (fim)</label>
            <input id="resp-vigencia" type="date" value="${r?.dataVigenciaFim || ''}"
              style="width:100%;padding:8px;border-radius:7px;border:1px solid var(--border);
              background:var(--bg-card);color:var(--text-primary);font-size:12px;box-sizing:border-box">
          </div>
          <div style="grid-column:1/-1">
            <label style="font-size:11px;font-weight:700;color:var(--text-muted);display:block;margin-bottom:4px">Observações</label>
            <textarea id="resp-obs" rows="2" placeholder="Atribuições específicas, substituto etc."
              style="width:100%;padding:8px;border-radius:7px;border:1px solid var(--border);
              background:var(--bg-card);color:var(--text-primary);font-size:12px;box-sizing:border-box;resize:vertical">${esc(r?.obs)}</textarea>
          </div>
        </div>
        <div style="display:flex;gap:8px;justify-content:flex-end;margin-top:12px">
          <button class="btn btn-cinza btn-sm" data-action="_respCancelarForm">Cancelar</button>
          <button class="btn btn-verde btn-sm" data-action="_respSalvarForm" data-arg0="${id || ''}" >💾 Salvar</button>
        </div>
      </div>`;
  }

  // ── Eventos globais ─────────────────────────────────────────────
  _exposeGlobals() {
    window._respNovoForm   = () => { this._editId = null; this._renderForm(); };
    window._respEditar     = (id) => { this._editId = id; this._renderForm(id); };
    window._respCancelarForm = () => { const w = document.getElementById('resp-form-wrap'); if (w) w.innerHTML = ''; };
    window._respExcluir    = async (id) => {
      if (!confirm('Excluir este responsável?')) return;
      this._lista = this._lista.filter(r => r.id !== id);
      await this._salvar();
      this._render();
      window.toast?.('🗑️ Responsável removido.', 'ok');
    };
    window._respSalvarForm = async (editId) => {
      const g = id => document.getElementById(id)?.value?.trim() || '';
      const papel = g('resp-papel');
      const nome  = g('resp-nome');
      if (!nome) { window.toast?.('⚠️ Informe o nome.', 'warn'); return; }

      // CORREÇÃO: portaria obrigatória para papéis que exigem designação formal (Lei 14.133 Art. 117 § 3º)
      const papelObj = PAPEIS.find(p => p.key === papel);
      const doc = g('resp-doc');
      if (papelObj?.obrigatorio && !doc) {
        window.toast?.('⚠️ O Nº da Portaria/Ato de Designação é obrigatório para este papel (Lei 14.133/2021 Art. 117 § 3º).', 'warn');
        document.getElementById('resp-doc')?.focus();
        return;
      }

      const item = {
        id:                  editId || `resp_${Date.now()}`,
        papel,
        nome,
        cpf:                 g('resp-cpf'),
        cargo:               g('resp-cargo'),
        dataDesignacao:      g('resp-data'),
        documentoDesignacao: doc,
        dataVigenciaFim:     g('resp-vigencia'),  // NOVO: vencimento da portaria
        obs:                 document.getElementById('resp-obs')?.value?.trim() || '',
        criadoEm:            new Date().toISOString(),
      };

      if (editId) {
        this._lista = this._lista.map(r => r.id === editId ? { ...r, ...item } : r);
      } else {
        this._lista.push(item);
      }

      await this._salvar();
      this._render();
      window.toast?.('✅ Responsável salvo!', 'ok');
    };
  }

  _bindEvents() {
    this._subs.push(
      EventBus.on('obra:selecionada', async () => {
        await this._carregar();
        if (router.current === 'responsaveis') this._render();
      }, 'responsaveis')
    );
  }

  destroy() {
    this._subs.forEach(u => u?.());
    this._subs = [];
    EventBus.offByContext('responsaveis');
  }
}
