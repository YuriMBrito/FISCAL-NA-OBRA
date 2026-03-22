/**
 * ╔══════════════════════════════════════════════════════════════╗
 * ║  FISCAL NA OBRA — modules/qualidade/qualidade-controller.js ║
 * ║  Controle de Qualidade de Materiais e Laudos de Ensaio      ║
 * ╚══════════════════════════════════════════════════════════════╝
 *
 * Registra e acompanha:
 *   - Notas fiscais de materiais (vinculadas ao item contratual)
 *   - Laudos de ensaio (concreto, solo, asfalto)
 *   - Certificados de conformidade (tubulações, fiação, blocos)
 *   - Status de aprovação/reprovação de lote
 */

import EventBus        from '../../core/EventBus.js';
import state           from '../../core/state.js';
import router          from '../../core/router.js';
import FirebaseService from '../../firebase/firebase-service.js';

const hoje  = () => new Date().toISOString().slice(0, 10);
const fmtBR = iso => iso ? new Date(iso+'T12:00:00').toLocaleDateString('pt-BR') : '—';

const TIPOS_REGISTRO = [
  { key:'laudo_concreto',   icon:'🧱', label:'Laudo de Ensaio — Concreto' },
  { key:'laudo_solo',       icon:'🪨', label:'Laudo de Ensaio — Solo/Compactação' },
  { key:'laudo_asfalto',    icon:'🛣️', label:'Laudo de Ensaio — Asfalto' },
  { key:'laudo_outro',      icon:'🔬', label:'Laudo de Ensaio — Outro' },
  { key:'certificado',      icon:'📜', label:'Certificado de Conformidade' },
  { key:'nota_fiscal',      icon:'🧾', label:'Nota Fiscal de Material' },
  { key:'ficha_tecnica',    icon:'📋', label:'Ficha Técnica / Datasheet' },
];

const STATUS_OPTS = [
  { key:'pendente',   label:'Pendente análise', cor:'var(--text-muted)' },
  { key:'aprovado',   label:'Aprovado',         cor:'var(--color-success, #22c55e)' },
  { key:'reprovado',  label:'Reprovado',        cor:'var(--color-danger, #ef4444)' },
  { key:'em_analise', label:'Em análise',       cor:'var(--color-warning, #f59e0b)' },
];

export class QualidadeModule {
  constructor() {
    this._subs    = [];
    this._registros= [];
    this._filtro  = '';
    this._filtroTipo = '';
    this._editId  = null;
  }

  async init()    { this._bindEvents(); this._exposeGlobals(); }
  async onEnter() { await this._carregar(); this._render(); }

  async _carregar() {
    const obraId = state.get('obraAtivaId');
    if (!obraId) { this._registros = []; return; }
    try {
      // FIX-E2.3: carregar do Firebase e sincronizar no state central
      const estadoCache = state.get('qualidadeMateriais');
      if (estadoCache && estadoCache.length > 0) {
        // Usar cache do state (evita re-fetch ao trocar de aba)
        this._registros = estadoCache;
      } else {
        this._registros = await FirebaseService.getQualidade(obraId);
        state.set('qualidadeMateriais', this._registros);
      }
    } catch { this._registros = []; }
  }

  async _salvar() {
    const obraId = state.get('obraAtivaId');
    if (!obraId) return;
    await FirebaseService.salvarQualidade(obraId, this._registros);
    state.set('qualidadeMateriais', this._registros); // FIX-E2.3: manter state sincronizado
  }

  _render() {
    const el = document.getElementById('qualidade-conteudo');
    if (!el) return;
    const obraId = state.get('obraAtivaId');

    if (!obraId) {
      el.innerHTML = '<div style="text-align:center;padding:40px;color:var(--text-muted);font-size:13px">Selecione uma obra para registrar laudos e certificados.</div>';
      return;
    }

    const lista = this._filtrar();
    const kpis  = this._calcKpis();

    el.innerHTML = `
      <!-- KPIs -->
      <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(120px,1fr));gap:10px;margin-bottom:16px">
        ${this._kpi('Total', kpis.total, 'var(--accent)')}
        ${this._kpi('Aprovados', kpis.aprovados, 'var(--color-success, #22c55e)')}
        ${this._kpi('Reprovados', kpis.reprovados, 'var(--color-danger, #ef4444)')}
        ${this._kpi('Pendentes', kpis.pendentes, 'var(--color-warning, #f59e0b)')}
      </div>

      <!-- Filtros + ação -->
      <div style="display:flex;gap:8px;flex-wrap:wrap;align-items:center;margin-bottom:14px">
        <input type="text" placeholder="🔍 Buscar material, NF, laudo..." value="${this._filtro}"
          oninput="window._qa_filtro(this.value)"
          style="flex:1;min-width:160px;padding:7px 10px;font-size:12px;border-radius:7px;border:1px solid var(--border);background:var(--bg-surface);color:var(--text-primary)">
        <select onchange="window._qa_filtroTipo(this.value)"
          style="padding:7px 10px;font-size:12px;border-radius:7px;border:1px solid var(--border);background:var(--bg-surface);color:var(--text-primary)">
          <option value="">Todos os tipos</option>
          ${TIPOS_REGISTRO.map(t => `<option value="${t.key}" ${this._filtroTipo===t.key?'selected':''}>${t.icon} ${t.label}</option>`).join('')}
        </select>
        <button data-action="_qa_abrirForm" data-arg0="null"
          style="padding:8px 16px;background:var(--accent);border:none;border-radius:8px;color:#fff;font-size:12px;font-weight:700;cursor:pointer;white-space:nowrap">
          📋 Novo Registro
        </button>
      </div>

      <!-- Alerta de reprovados -->
      ${kpis.reprovados > 0 ? `
        <div style="background:var(--color-danger-bg, #fee2e2);border:1px solid var(--color-danger-light, #fca5a5);border-radius:8px;padding:12px;margin-bottom:12px;font-size:12px;color:var(--color-danger-dark, #dc2626);font-weight:700">
          🚨 ${kpis.reprovados} registro(s) REPROVADO(s) — Verificar e providenciar substituição de material.
        </div>` : ''}

      <!-- Lista -->
      ${lista.length === 0
        ? `<div style="text-align:center;padding:48px;color:var(--text-muted);font-size:12px">
            ${this._registros.length === 0 ? '📋 Nenhum laudo ou certificado registrado.' : 'Nenhum registro encontrado com os filtros aplicados.'}</div>`
        : lista.map(r => this._cardRegistro(r)).join('')
      }

      <!-- Modal overlay -->
      <div id="qa-overlay" data-action="if" data-arg0="event.target===this)window._qa_fecharForm("
        style="display:none;position:fixed;inset:0;background:rgba(0,0,0,.6);z-index:1000;overflow-y:auto;padding:20px;box-sizing:border-box">
        <div id="qa-modal" style="background:var(--bg-card);border:1px solid var(--border);border-radius:14px;padding:24px;
          width:min(100%,560px);margin:auto;box-shadow:0 20px 60px rgba(0,0,0,.45)"></div>
      </div>
    `;
  }

  _filtrar() {
    let lista = [...this._registros].sort((a,b) => (b.data||'').localeCompare(a.data||''));
    if (this._filtro) {
      const q = this._filtro.toLowerCase();
      lista = lista.filter(r =>
        (r.material||'').toLowerCase().includes(q) ||
        (r.numeroDoc||'').toLowerCase().includes(q) ||
        (r.laboratorio||'').toLowerCase().includes(q) ||
        (r.obs||'').toLowerCase().includes(q)
      );
    }
    if (this._filtroTipo) lista = lista.filter(r => r.tipo === this._filtroTipo);
    return lista;
  }

  _calcKpis() {
    const rs = this._registros;
    return {
      total:     rs.length,
      aprovados: rs.filter(r => r.status === 'aprovado').length,
      reprovados:rs.filter(r => r.status === 'reprovado').length,
      pendentes: rs.filter(r => r.status === 'pendente' || r.status === 'em_analise').length,
    };
  }

  _kpi(label, valor, cor) {
    return `<div style="background:var(--bg-surface);border:1px solid var(--border);border-radius:8px;padding:12px;text-align:center">
      <div style="font-size:9px;font-weight:700;color:var(--text-muted);text-transform:uppercase;letter-spacing:.5px;margin-bottom:5px">${label}</div>
      <div style="font-size:20px;font-weight:800;color:${cor}">${valor}</div>
    </div>`;
  }

  _cardRegistro(r) {
    const tipo   = TIPOS_REGISTRO.find(t => t.key === r.tipo) || TIPOS_REGISTRO[0];
    const status = STATUS_OPTS.find(s => s.key === r.status) || STATUS_OPTS[0];

    return `
      <div style="background:var(--bg-surface);border:1px solid var(--border);border-radius:10px;padding:14px;margin-bottom:10px;
        border-left:3px solid ${status.cor}">
        <div style="display:flex;align-items:flex-start;justify-content:space-between;gap:8px;flex-wrap:wrap">
          <div style="flex:1;min-width:0">
            <div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap;margin-bottom:5px">
              <span style="font-size:13px;font-weight:700;color:var(--text-primary)">${tipo.icon} ${r.material || 'Material não especificado'}</span>
              <span style="font-size:10px;padding:2px 8px;border-radius:10px;font-weight:700;background:${status.cor}22;color:${status.cor}">${status.label}</span>
            </div>
            <div style="font-size:11px;color:var(--text-muted);margin-bottom:3px">${tipo.label}</div>
            <div style="display:flex;gap:10px;font-size:11px;color:var(--text-muted);flex-wrap:wrap">
              ${r.numeroDoc ? `📄 ${r.numeroDoc}` : ''}
              ${r.data ? `📅 ${fmtBR(r.data)}` : ''}
              ${r.laboratorio ? `🔬 ${r.laboratorio}` : ''}
              ${r.itemVinculado ? `🔗 ${r.itemVinculado}` : ''}
            </div>
            ${r.resultado ? `<div style="font-size:11px;color:var(--text-primary);margin-top:5px;background:var(--bg-card);padding:6px;border-radius:6px"><strong>Resultado:</strong> ${r.resultado}</div>` : ''}
            ${r.obs ? `<div style="font-size:11px;color:var(--text-muted);margin-top:4px;font-style:italic">${r.obs}</div>` : ''}
          </div>
          <div style="display:flex;gap:6px;flex-shrink:0">
            <button data-action="_qa_abrirForm" data-arg0="${r.id}" style="padding:5px 10px;font-size:11px;background:var(--bg-card);border:1px solid var(--border);border-radius:6px;cursor:pointer;color:var(--text-primary)">✏️</button>
            <button data-action="_qa_excluir" data-arg0="${r.id}" style="padding:5px 10px;font-size:11px;background:var(--color-danger-bg, #fee2e2);border:1px solid var(--color-danger-light, #fca5a5);border-radius:6px;cursor:pointer;color:var(--color-danger-dark, #dc2626)">🗑️</button>
          </div>
        </div>
      </div>
    `;
  }

  _abrirForm(id) {
    const r       = id ? this._registros.find(x => x.id === id) : null;
    this._editId  = id || null;
    const overlay = document.getElementById('qa-overlay');
    const modal   = document.getElementById('qa-modal');
    if (!overlay || !modal) { this._render(); setTimeout(() => this._abrirForm(id), 60); return; }

    const itens   = (state.get('itensContrato') || []).filter(i => !i.t);

    modal.innerHTML = `
      <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:18px">
        <h3 style="margin:0;font-size:15px;font-weight:800;color:var(--text-primary)">${r ? '✏️ Editar Registro' : '📋 Novo Laudo / Certificado'}</h3>
        <button data-action="_qa_fecharForm" style="background:none;border:none;cursor:pointer;font-size:18px;color:var(--text-muted)">✕</button>
      </div>
      <div style="display:grid;gap:12px">

        <div>
          <label style="font-size:11px;font-weight:700;color:var(--text-muted);display:block;margin-bottom:4px">Tipo de Documento *</label>
          <select id="qa-tipo" style="width:100%;padding:8px;border-radius:7px;border:1px solid var(--border);background:var(--bg-surface);color:var(--text-primary);font-size:12px;box-sizing:border-box">
            ${TIPOS_REGISTRO.map(t => `<option value="${t.key}" ${r?.tipo===t.key?'selected':''}>${t.icon} ${t.label}</option>`).join('')}
          </select>
        </div>

        <div>
          <label style="font-size:11px;font-weight:700;color:var(--text-muted);display:block;margin-bottom:4px">Material / Produto *</label>
          <input type="text" id="qa-material" value="${r?.material||''}" placeholder="Ex: Concreto fck 25 MPa, Tubo PVC 100mm..."
            style="width:100%;padding:8px;border-radius:7px;border:1px solid var(--border);background:var(--bg-surface);color:var(--text-primary);font-size:12px;box-sizing:border-box">
        </div>

        <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px">
          <div>
            <label style="font-size:11px;font-weight:700;color:var(--text-muted);display:block;margin-bottom:4px">N.º do Documento</label>
            <input type="text" id="qa-num" value="${r?.numeroDoc||''}" placeholder="Ex: NF 001234, Laudo 45/2026"
              style="width:100%;padding:8px;border-radius:7px;border:1px solid var(--border);background:var(--bg-surface);color:var(--text-primary);font-size:12px;box-sizing:border-box">
          </div>
          <div>
            <label style="font-size:11px;font-weight:700;color:var(--text-muted);display:block;margin-bottom:4px">Data</label>
            <input type="date" id="qa-data" value="${r?.data||hoje()}"
              style="width:100%;padding:8px;border-radius:7px;border:1px solid var(--border);background:var(--bg-surface);color:var(--text-primary);font-size:12px;box-sizing:border-box">
          </div>
        </div>

        <div>
          <label style="font-size:11px;font-weight:700;color:var(--text-muted);display:block;margin-bottom:4px">Laboratório / Fornecedor</label>
          <input type="text" id="qa-lab" value="${r?.laboratorio||''}" placeholder="Nome do laboratório ou fornecedor"
            style="width:100%;padding:8px;border-radius:7px;border:1px solid var(--border);background:var(--bg-surface);color:var(--text-primary);font-size:12px;box-sizing:border-box">
        </div>

        <div>
          <label style="font-size:11px;font-weight:700;color:var(--text-muted);display:block;margin-bottom:4px">Item Contratual Vinculado</label>
          <select id="qa-item" style="width:100%;padding:8px;border-radius:7px;border:1px solid var(--border);background:var(--bg-surface);color:var(--text-primary);font-size:12px;box-sizing:border-box">
            <option value="">Nenhum</option>
            ${itens.map(i => `<option value="${i.id} — ${i.desc.slice(0,40)}" ${r?.itemVinculado?.startsWith(i.id)?'selected':''}>${i.id} — ${i.desc.slice(0,50)}</option>`).join('')}
          </select>
        </div>

        <div>
          <label style="font-size:11px;font-weight:700;color:var(--text-muted);display:block;margin-bottom:4px">Resultado do Ensaio / Certificação</label>
          <input type="text" id="qa-resultado" value="${r?.resultado||''}" placeholder="Ex: Resistência 28,4 MPa (atende fck ≥ 25 MPa)"
            style="width:100%;padding:8px;border-radius:7px;border:1px solid var(--border);background:var(--bg-surface);color:var(--text-primary);font-size:12px;box-sizing:border-box">
        </div>

        <div>
          <label style="font-size:11px;font-weight:700;color:var(--text-muted);display:block;margin-bottom:4px">Status *</label>
          <select id="qa-status" style="width:100%;padding:8px;border-radius:7px;border:1px solid var(--border);background:var(--bg-surface);color:var(--text-primary);font-size:12px;box-sizing:border-box">
            ${STATUS_OPTS.map(s => `<option value="${s.key}" ${r?.status===s.key?'selected':''}>${s.label}</option>`).join('')}
          </select>
        </div>

        <div>
          <label style="font-size:11px;font-weight:700;color:var(--text-muted);display:block;margin-bottom:4px">Observações</label>
          <textarea id="qa-obs" rows="2" placeholder="Observações, ressalvas ou ações corretivas..."
            style="width:100%;padding:8px;border-radius:7px;border:1px solid var(--border);background:var(--bg-surface);color:var(--text-primary);font-size:12px;resize:vertical;box-sizing:border-box">${r?.obs||''}</textarea>
        </div>
      </div>

      <div style="display:flex;gap:8px;justify-content:flex-end;margin-top:20px">
        <button data-action="_qa_fecharForm"
          style="padding:9px 18px;background:var(--bg-surface);border:1px solid var(--border);border-radius:8px;font-size:12px;font-weight:700;cursor:pointer;color:var(--text-primary)">
          Cancelar
        </button>
        <button data-action="_qa_salvarForm"
          style="padding:9px 18px;background:var(--accent);border:none;border-radius:8px;color:#fff;font-size:12px;font-weight:700;cursor:pointer">
          💾 Salvar
        </button>
      </div>
    `;

    overlay.style.display = 'block';
  }

  _fecharForm() {
    const overlay = document.getElementById('qa-overlay');
    if (overlay) overlay.style.display = 'none';
    this._editId = null;
  }

  async _salvarForm() {
    const g = id => document.getElementById(id);
    const material = g('qa-material')?.value?.trim();
    if (!material) { window.toast?.('⚠️ Informe o material.', 'warn'); return; }

    const novo = {
      tipo:         g('qa-tipo')?.value     || 'certificado',
      material,
      numeroDoc:    g('qa-num')?.value?.trim()  || '',
      data:         g('qa-data')?.value         || hoje(),
      laboratorio:  g('qa-lab')?.value?.trim()  || '',
      itemVinculado:g('qa-item')?.value         || '',
      resultado:    g('qa-resultado')?.value?.trim() || '',
      status:       g('qa-status')?.value   || 'pendente',
      obs:          g('qa-obs')?.value?.trim()  || '',
    };

    if (this._editId) {
      const idx = this._registros.findIndex(r => r.id === this._editId);
      if (idx >= 0) this._registros[idx] = { ...this._registros[idx], ...novo };
    } else {
      this._registros.push({ ...novo, id: `qa_${Date.now()}`, criadoEm: new Date().toISOString() });
    }

    try {
      await this._salvar();
      window.toast?.('✅ Registro salvo!', 'ok');
      this._fecharForm();
      this._render();
    } catch (e) {
      window.toast?.('❌ Erro ao salvar.', 'error');
    }
  }

  async _excluir(id) {
    // FIX-E3.3: ConfirmComponent em vez de confirm() nativo
    const _okExcluirQa = await window._confirm('Excluir este registro de laudo/certificado?', { labelOk: 'Excluir', danger: true });
    if (!_okExcluirQa) return;
    this._registros = this._registros.filter(r => r.id !== id);
    try { await this._salvar(); window.toast?.('🗑️ Excluído.', 'ok'); this._render(); }
    catch (e) { window.toast?.('❌ Erro.', 'error'); }
  }

  _bindEvents() {
    this._subs.push(EventBus.on('obra:selecionada', async () => {
      try { await this._carregar(); if (router.current === 'qualidade') this._render(); }
      catch (e) {}
    }, 'qualidade'));
  }

  _exposeGlobals() {
    window._qa_abrirForm  = id => this._abrirForm(id);
    window._qa_fecharForm = ()  => this._fecharForm();
    window._qa_salvarForm = () => {
      // FIX-E3.2: protege contra duplo salvamento de laudo/certificado
      const btn = document.querySelector('[data-action="_qa_salvarForm"]');
      import('../../utils/loading.js').then(({ withLoading }) => {
        withLoading(btn, () => this._salvarForm(), {
          labelLoading: 'Salvando registro...',
          labelDone: 'Salvo!',
        }).catch(e => window.toast?.('❌ Erro ao salvar: ' + e.message, 'error'));
      });
    };
    window._qa_excluir    = id  => this._excluir(id).catch(console.error);
    window._qa_filtro     = v   => { this._filtro = v; this._render(); };
    window._qa_filtroTipo = v   => { this._filtroTipo = v; this._render(); };
  }

  destroy() { this._subs.forEach(u => u()); this._subs = []; }
}
