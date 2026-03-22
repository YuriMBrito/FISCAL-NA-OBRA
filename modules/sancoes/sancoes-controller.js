/**
 * ╔══════════════════════════════════════════════════════════════╗
 * ║  FISCAL NA OBRA — modules/sancoes/sancoes-controller.js      ║
 * ║  Módulo: SancoesModule — Lei 14.133/2021 Art. 156            ║
 * ║  Sanções Administrativas — apenas registro, nunca automático ║
 * ╚══════════════════════════════════════════════════════════════╝
 *
 * REGRA: NÃO aplica sanções automaticamente. Apenas registra
 * para rastreabilidade e segurança jurídica.
 */

import EventBus       from '../../core/EventBus.js';
import state          from '../../core/state.js';
import router         from '../../core/router.js';
import { formatters } from '../../utils/formatters.js';
import FirebaseService from '../../firebase/firebase-service.js';

const dataBR = iso => iso ? new Date(iso + 'T12:00:00').toLocaleDateString('pt-BR') : '—';
const hoje   = () => new Date().toISOString().slice(0, 10);
const esc    = s => String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const R$     = v => (parseFloat(v) || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });

const TIPOS_SANCAO = [
  { key: 'advertencia',       icon: '⚠️',  label: 'Advertência',                cor: '#f59e0b' },
  { key: 'multa_mora',        icon: '💰',  label: 'Multa de Mora',               cor: '#ef4444' },
  { key: 'multa_inadimpl',    icon: '💸',  label: 'Multa por Inadimplemento',    cor: '#dc2626' },
  { key: 'suspenso',          icon: '🚫',  label: 'Suspensão Temporária',        cor: '#7c3aed' },
  { key: 'impedimento',       icon: '🔒',  label: 'Impedimento de Licitar',      cor: '#1d4ed8' },
  { key: 'declaracao_inapta', icon: '📛',  label: 'Declaração de Inidoneidade',  cor: '#991b1b' },
];

const STATUS_SANCAO = [
  { key: 'registrada',   label: 'Registrada',      cor: '#6b7280' },
  { key: 'notificada',   label: 'Notificada',       cor: '#3b82f6' },
  { key: 'em_recurso',   label: 'Em Recurso',       cor: '#f59e0b' },
  { key: 'aplicada',     label: 'Aplicada',         cor: '#ef4444' },
  { key: 'cancelada',    label: 'Cancelada',        cor: '#22c55e' },
  { key: 'cumprida',     label: 'Cumprida',         cor: '#7c3aed' },
];

export class SancoesModule {
  constructor() {
    this._subs   = [];
    this._lista  = [];
    this._editId = null;
    this._view   = 'lista'; // 'lista' | 'form'
  }

  async init() {
    try { this._bindEvents(); this._exposeGlobals(); }
    catch (e) { console.error('[SancoesModule] init:', e); }
  }

  async onEnter() {
    try { await this._carregar(); this._view = 'lista'; this._render(); }
    catch (e) { console.error('[SancoesModule] onEnter:', e); }
  }

  async _carregar() {
    const obraId = state.get('obraAtivaId');
    if (!obraId) return;
    try {
      this._lista = await FirebaseService.getSancoes(obraId).catch(() => []) || [];
    } catch (e) { this._lista = []; }
  }

  async _salvar() {
    const obraId = state.get('obraAtivaId');
    if (!obraId) return;
    await FirebaseService.salvarSancoes(obraId, this._lista);
    window.auditRegistrar?.({ modulo: 'Sanções', tipo: 'salvo', registro: obraId, detalhe: 'Registro de sanção atualizado' });
  }

  _render() {
    const el = document.getElementById('sancoes-conteudo');
    if (!el) return;
    const obraId = state.get('obraAtivaId');
    if (!obraId) {
      el.innerHTML = '<div style="text-align:center;padding:40px;color:var(--text-muted)">Selecione uma obra.</div>';
      return;
    }
    if (this._view === 'form') { this._renderForm(); return; }

    const totalMultas = this._lista
      .filter(s => s.tipo?.startsWith('multa') && s.status === 'aplicada')
      .reduce((a, s) => a + (parseFloat(s.valor) || 0), 0);

    el.innerHTML = `
      <div style="display:grid;grid-template-columns:repeat(3,1fr);gap:10px;margin-bottom:14px">
        <div style="background:var(--bg-surface);border:1px solid var(--border);border-radius:8px;padding:12px;text-align:center">
          <div style="font-size:20px;font-weight:800;color:var(--text-primary)">${this._lista.length}</div>
          <div style="font-size:10px;color:var(--text-muted);margin-top:2px">Total registrado</div>
        </div>
        <div style="background:#fef3c7;border:1px solid #f59e0b;border-radius:8px;padding:12px;text-align:center">
          <div style="font-size:20px;font-weight:800;color:#92400e">
            ${this._lista.filter(s => s.status === 'aplicada').length}
          </div>
          <div style="font-size:10px;color:#92400e;margin-top:2px">Aplicadas</div>
        </div>
        <div style="background:#fee2e2;border:1px solid #ef4444;border-radius:8px;padding:12px;text-align:center">
          <div style="font-size:13px;font-weight:800;color:#991b1b">${R$(totalMultas)}</div>
          <div style="font-size:10px;color:#991b1b;margin-top:2px">Multas aplicadas</div>
        </div>
      </div>

      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:12px">
        <div style="font-size:11px;color:var(--text-muted)">
          ⚖️ <strong>Lei 14.133/2021 Art. 156</strong> — Apenas registro para rastreabilidade.
        </div>
        <button class="btn btn-verde btn-sm" data-action="_sancNovaForm">➕ Registrar Sanção</button>
      </div>

      ${this._lista.length === 0
        ? '<div style="text-align:center;padding:30px;color:var(--text-muted);font-size:12px">Nenhuma sanção registrada.</div>'
        : this._lista.map(s => {
            const t = TIPOS_SANCAO.find(x => x.key === s.tipo) || { icon: '⚖️', label: s.tipo, cor: '#6b7280' };
            const st = STATUS_SANCAO.find(x => x.key === s.status) || { label: s.status, cor: '#6b7280' };
            return `<div style="background:var(--bg-surface);border:1px solid var(--border);border-radius:8px;
              padding:12px 14px;margin-bottom:8px">
              <div style="display:flex;justify-content:space-between;align-items:flex-start;flex-wrap:wrap;gap:6px">
                <div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap">
                  <span style="font-size:13px;font-weight:800;color:${t.cor}">${t.icon} ${t.label}</span>
                  <span style="font-size:10px;padding:2px 8px;border-radius:10px;font-weight:700;
                    background:${st.cor}22;color:${st.cor}">${st.label}</span>
                  ${s.tipo?.startsWith('multa') && s.valor
                    ? `<span style="font-size:11px;font-weight:700;color:#ef4444">${R$(s.valor)}</span>` : ''}
                </div>
                <div style="display:flex;gap:6px;align-items:center">
                  <span style="font-size:10px;background:${sc.cor}22;color:${sc.cor};
                    border:1px solid ${sc.cor};border-radius:10px;padding:2px 8px">
                    ${st.label}
                  </span>
                  <button class="btn btn-cinza btn-sm" style="padding:2px 8px;font-size:10px"
                    title="Gerar PDF desta sanção"
                    data-action="_integPDFSancao" data-arg0="${s.id}" >🖨️</button>
                  <button class="btn btn-cinza btn-sm" style="padding:2px 8px;font-size:10px"
                    data-action="_sancEditar" data-arg0="${s.id}" >✏️</button>
                  <button class="btn btn-vermelho btn-sm" style="padding:2px 8px;font-size:10px"
                    data-action="_sancExcluir" data-arg0="${s.id}" >🗑️</button>
                </div>
              </div>
              <div style="font-size:11px;margin-top:6px;color:var(--text-primary)">${esc(s.motivo)}</div>
              <div style="display:flex;gap:14px;margin-top:4px;font-size:10px;color:var(--text-muted)">
                <span>📅 ${dataBR(s.data)}</span>
                ${s.referencia ? `<span>🔗 Ref: ${esc(s.referencia)}</span>` : ''}
                ${s.processo   ? `<span>📁 Proc: ${esc(s.processo)}</span>` : ''}
              </div>
            </div>`;
          }).join('')
      }`;
  }

  _renderForm() {
    const el = document.getElementById('sancoes-conteudo');
    if (!el) return;
    const s = this._editId ? this._lista.find(x => x.id === this._editId) : null;

    el.innerHTML = `
      <div style="background:var(--bg-surface);border:1px solid var(--border);border-radius:10px;padding:20px">
        <div style="font-size:14px;font-weight:700;margin-bottom:16px">
          ${s ? '✏️ Editar Sanção' : '⚖️ Registrar Nova Sanção'}
        </div>
        <div style="background:#fef3c7;border:1px solid #f59e0b;border-radius:6px;padding:8px 12px;
          margin-bottom:14px;font-size:11px;color:#92400e">
          ℹ️ <strong>Atenção:</strong> O registro aqui é apenas documental.
          A aplicação formal ocorre por processo administrativo.
        </div>
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px">
          <div>
            <label style="font-size:11px;font-weight:700;color:var(--text-muted);display:block;margin-bottom:4px">Tipo de Sanção *</label>
            <select id="sanc-tipo" style="width:100%;padding:8px;border-radius:7px;border:1px solid var(--border);
              background:var(--bg-card);color:var(--text-primary);font-size:12px"
              onchange="window._sancToggleValor()">
              ${TIPOS_SANCAO.map(t => `<option value="${t.key}" ${s?.tipo === t.key ? 'selected' : ''}>${t.icon} ${t.label}</option>`).join('')}
            </select>
          </div>
          <div>
            <label style="font-size:11px;font-weight:700;color:var(--text-muted);display:block;margin-bottom:4px">Status</label>
            <select id="sanc-status" style="width:100%;padding:8px;border-radius:7px;border:1px solid var(--border);
              background:var(--bg-card);color:var(--text-primary);font-size:12px">
              ${STATUS_SANCAO.map(st => `<option value="${st.key}" ${s?.status === st.key ? 'selected' : ''}>${st.label}</option>`).join('')}
            </select>
          </div>
          <div>
            <label style="font-size:11px;font-weight:700;color:var(--text-muted);display:block;margin-bottom:4px">Data do Registro *</label>
            <input id="sanc-data" type="date" value="${s?.data || hoje()}"
              style="width:100%;padding:8px;border-radius:7px;border:1px solid var(--border);
              background:var(--bg-card);color:var(--text-primary);font-size:12px;box-sizing:border-box">
          </div>
          <div id="sanc-valor-wrap" style="${s?.tipo?.startsWith('multa') ? '' : 'display:none'}">
            <label style="font-size:11px;font-weight:700;color:var(--text-muted);display:block;margin-bottom:4px">Valor da Multa (R$)</label>
            <input id="sanc-valor" type="number" step="0.01" value="${s?.valor || ''}" placeholder="0,00"
              style="width:100%;padding:8px;border-radius:7px;border:1px solid var(--border);
              background:var(--bg-card);color:var(--text-primary);font-size:12px;box-sizing:border-box">
          </div>
          <div style="grid-column:1/-1">
            <label style="font-size:11px;font-weight:700;color:var(--text-muted);display:block;margin-bottom:4px">Motivo / Fundamento Legal *</label>
            <textarea id="sanc-motivo" rows="3" placeholder="Descreva o motivo e cite o artigo da lei ou cláusula contratual..."
              style="width:100%;padding:8px;border-radius:7px;border:1px solid var(--border);
              background:var(--bg-card);color:var(--text-primary);font-size:12px;box-sizing:border-box;resize:vertical">${esc(s?.motivo)}</textarea>
          </div>
          <div>
            <label style="font-size:11px;font-weight:700;color:var(--text-muted);display:block;margin-bottom:4px">Nº Processo Administrativo</label>
            <input id="sanc-processo" type="text" value="${esc(s?.processo)}" placeholder="Ex: 2024/00123"
              style="width:100%;padding:8px;border-radius:7px;border:1px solid var(--border);
              background:var(--bg-card);color:var(--text-primary);font-size:12px;box-sizing:border-box">
          </div>
          <div>
            <label style="font-size:11px;font-weight:700;color:var(--text-muted);display:block;margin-bottom:4px">Referência (Ocorrência/Notificação)</label>
            <input id="sanc-ref" type="text" value="${esc(s?.referencia)}" placeholder="ID da ocorrência ou notificação"
              style="width:100%;padding:8px;border-radius:7px;border:1px solid var(--border);
              background:var(--bg-card);color:var(--text-primary);font-size:12px;box-sizing:border-box">
          </div>
        </div>
        <div style="display:flex;gap:8px;justify-content:flex-end;margin-top:14px">
          <button class="btn btn-cinza btn-sm" data-action="_sancCancelar">Cancelar</button>
          <button class="btn btn-verde btn-sm" data-action="_sancSalvarForm" data-arg0="${this._editId || ''}" >💾 Salvar Registro</button>
        </div>
      </div>`;
  }

  _exposeGlobals() {
    window._sancNovaForm  = () => { this._editId = null; this._view = 'form'; this._render(); };
    window._sancEditar    = (id) => { this._editId = id; this._view = 'form'; this._render(); };
    window._sancCancelar  = () => { this._view = 'lista'; this._render(); };
    window._sancToggleValor = () => {
      const tipo = document.getElementById('sanc-tipo')?.value || '';
      const wrap = document.getElementById('sanc-valor-wrap');
      if (wrap) wrap.style.display = tipo.startsWith('multa') ? '' : 'none';
    };
    window._sancExcluir = async (id) => {
      if (!confirm('Excluir este registro de sanção?')) return;
      this._lista = this._lista.filter(s => s.id !== id);
      await this._salvar();
      this._render();
      window.toast?.('🗑️ Sanção removida.', 'ok');
    };
    window._sancSalvarForm = async (editId) => {
      const g = id => document.getElementById(id)?.value?.trim() || '';
      const motivo = g('sanc-motivo');
      if (!motivo) { window.toast?.('⚠️ Informe o motivo.', 'warn'); return; }
      // REGRA Lei 14.133: sanção exige referência ou processo para rastreabilidade
      const ref = g('sanc-ref');
      const proc = g('sanc-processo');
      if (!ref && !proc && !editId) {
        window.toast?.('⚠️ Vincule a sanção a uma ocorrência/notificação ou informe o nº do processo.', 'warn');
        return;
      }
      const tipo = g('sanc-tipo');
      const item = {
        id:        editId || `sanc_${Date.now()}`,
        tipo,
        status:    g('sanc-status') || 'registrada',
        data:      g('sanc-data'),
        valor:     tipo.startsWith('multa') ? parseFloat(g('sanc-valor')) || 0 : null,
        motivo,
        processo:  g('sanc-processo'),
        referencia:g('sanc-ref'),
        criadoEm:  new Date().toISOString(),
      };
      if (editId) {
        this._lista = this._lista.map(s => s.id === editId ? { ...s, ...item } : s);
      } else {
        this._lista.push(item);
      }
      await this._salvar();
      this._view = 'lista';
      this._render();
      window.toast?.('✅ Sanção registrada!', 'ok');
    };
  }

  _bindEvents() {
    this._subs.push(
      EventBus.on('obra:selecionada', async () => {
        await this._carregar(); this._view = 'lista';
        if (router.current === 'sancoes') this._render();
      }, 'sancoes')
    );
  }

  destroy() {
    this._subs.forEach(u => u?.());
    this._subs = [];
    EventBus.offByContext('sancoes');
  }
}
