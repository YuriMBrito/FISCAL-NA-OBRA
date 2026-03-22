/**
 * ╔══════════════════════════════════════════════════════════════╗
 * ║  FISCAL NA OBRA — utils/ui.js                               ║
 * ║  FIX-E4.5: componentes HTML reutilizáveis                   ║
 * ╚══════════════════════════════════════════════════════════════╝
 *
 * Funções puras que retornam strings HTML com estilo consistente.
 * Substituem strings inline espalhadas por todos os módulos.
 *
 * BENEFÍCIOS:
 *   - Mudar o estilo de um botão: 1 lugar em vez de 72
 *   - Garantia de consistência visual entre módulos
 *   - Novos módulos criados 50% mais rápido
 *   - Dark mode e tokens CSS automaticamente corretos
 *
 * USO:
 *   import { UI } from '../../utils/ui.js';
 *
 *   // Botão com data-action (Fix 4.1)
 *   UI.btn('✏️ Editar', 'editar', item.id)
 *   UI.btn('🗑️ Excluir', 'excluir', item.id, 'danger')
 *   UI.btn('💾 Salvar', 'salvar', null, 'primary', { fullWidth: true })
 *
 *   // KPI card
 *   UI.kpi('Total', 42, 'var(--accent)')
 *   UI.kpi('Aprovados', 8, 'var(--color-success)')
 *
 *   // Badge de status
 *   UI.badge('Conforme', 'success')
 *   UI.badge('Reprovado', 'danger')
 *   UI.badge('Pendente', 'warning')
 *
 *   // Campo de formulário
 *   UI.field('nome', 'Nome completo', valor, 'text', 'Ex: João Silva')
 *   UI.fieldDate('data', 'Data', hoje())
 *   UI.fieldSelect('tipo', 'Tipo', opcoes, valorSelecionado)
 *   UI.fieldTextarea('obs', 'Observações', texto, 'Digite...', 3)
 *
 *   // Estado vazio
 *   UI.empty('Nenhum registro encontrado.')
 *   UI.emptyObra('Selecione uma obra para continuar.')
 *
 *   // Modal
 *   UI.modalHeader('📋 Título do Modal', 'fechar')
 *   UI.modalFooter([
 *     UI.btn('Cancelar', 'fechar', null, 'secondary'),
 *     UI.btn('💾 Salvar', 'salvar', null, 'primary'),
 *   ])
 */

// ── Botões ────────────────────────────────────────────────────────────────────

const BTN_VARIANTS = {
  primary:   'background:var(--accent);border:none;color:#fff;',
  secondary: 'background:var(--bg-surface);border:1px solid var(--border);color:var(--text-primary);',
  danger:    'background:var(--color-danger-bg,#fee2e2);border:1px solid var(--color-danger-light,#fca5a5);color:var(--color-danger,#ef4444);',
  success:   'background:var(--color-success-bg,#dcfce7);border:1px solid var(--color-success,#22c55e);color:var(--color-success-dark,#16a34a);',
  ghost:     'background:none;border:none;color:var(--text-muted);',
  warning:   'background:var(--color-warning-bg,#fefce8);border:1px solid var(--color-warning,#f59e0b);color:var(--color-warning-dark,#d97706);',
  info:      'background:var(--color-info-bg,#dbeafe);border:1px solid var(--color-info-light,#93c5fd);color:var(--color-info-dark,#1d4ed8);',
};

export const UI = {

  // ── Botão ──────────────────────────────────────────────────────────────────
  /**
   * @param {string} label     - HTML do label (pode incluir emoji)
   * @param {string} action    - valor do data-action
   * @param {string|null} id   - valor do data-id (opcional)
   * @param {'primary'|'secondary'|'danger'|'success'|'ghost'|'warning'|'info'} variant
   * @param {object} [opts]
   * @param {boolean} [opts.sm]        - tamanho pequeno
   * @param {boolean} [opts.fullWidth] - width: 100%
   * @param {string}  [opts.title]     - tooltip
   * @param {string}  [opts.extra]     - data-extra value
   */
  btn(label, action, id = null, variant = 'secondary', opts = {}) {
    const { sm = false, fullWidth = false, title = '', extra = '' } = opts;
    const variantStyle = BTN_VARIANTS[variant] || BTN_VARIANTS.secondary;
    const size  = sm ? 'font-size:11px;padding:4px 10px;' : 'font-size:12px;padding:8px 16px;';
    const width = fullWidth ? 'width:100%;' : '';
    const dataId    = id    ? ` data-id="${id}"`         : '';
    const dataExtra = extra ? ` data-extra="${extra}"`   : '';
    const titleAttr = title ? ` title="${title}"`        : '';
    return `<button data-action="${action}"${dataId}${dataExtra}${titleAttr}
      style="${variantStyle}${size}${width}border-radius:8px;font-weight:700;cursor:pointer;white-space:nowrap;line-height:1.4"
    >${label}</button>`;
  },

  // ── KPI card ───────────────────────────────────────────────────────────────
  /**
   * @param {string} label   - rótulo
   * @param {string|number} valor
   * @param {string} cor     - cor do valor (CSS color ou var())
   * @param {string} [sub]   - subtexto opcional
   */
  kpi(label, valor, cor = 'var(--accent)', sub = '') {
    return `<div style="background:var(--bg-surface);border:1px solid var(--border);border-radius:8px;padding:12px;text-align:center">
      <div style="font-size:9px;font-weight:700;color:var(--text-muted);text-transform:uppercase;letter-spacing:.5px;margin-bottom:5px">${label}</div>
      <div style="font-size:20px;font-weight:800;color:${cor};line-height:1.2">${valor}</div>
      ${sub ? `<div style="font-size:10px;color:var(--text-muted);margin-top:3px">${sub}</div>` : ''}
    </div>`;
  },

  // Grade de KPIs (1fr por KPI, no mínimo 110px cada)
  kpiGrid(kpis) {
    return `<div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(110px,1fr));gap:10px;margin-bottom:16px">
      ${kpis.map(([label, valor, cor, sub]) => this.kpi(label, valor, cor, sub)).join('')}
    </div>`;
  },

  // ── Badge de status ────────────────────────────────────────────────────────
  /**
   * @param {string} text
   * @param {'success'|'danger'|'warning'|'info'|'muted'} variant
   */
  badge(text, variant = 'muted') {
    const v = {
      success: 'background:var(--color-success-bg,#dcfce7);color:var(--color-success-dark,#16a34a);border:1px solid var(--color-success,#22c55e)44;',
      danger:  'background:var(--color-danger-bg,#fee2e2);color:var(--color-danger,#ef4444);border:1px solid var(--color-danger,#ef4444)44;',
      warning: 'background:var(--color-warning-bg,#fefce8);color:var(--color-warning-dark,#d97706);border:1px solid var(--color-warning,#f59e0b)44;',
      info:    'background:var(--color-info-bg,#dbeafe);color:var(--color-info-dark,#1d4ed8);border:1px solid var(--color-info-light,#93c5fd)44;',
      muted:   'background:var(--bg-surface);color:var(--text-muted);border:1px solid var(--border);',
      accent:  'background:var(--accent)22;color:var(--accent);border:1px solid var(--accent)44;',
    };
    return `<span style="${v[variant] || v.muted}font-size:10px;font-weight:700;padding:2px 8px;border-radius:10px">${text}</span>`;
  },

  // ── Campos de formulário ───────────────────────────────────────────────────
  _fieldWrap(id, label, input) {
    return `<div><label for="${id}" style="font-size:11px;font-weight:700;color:var(--text-muted);display:block;margin-bottom:4px">${label}</label>${input}</div>`;
  },

  _inputStyle: 'width:100%;padding:8px;border-radius:7px;border:1px solid var(--border);background:var(--bg-surface);color:var(--text-primary);font-size:12px;box-sizing:border-box',

  field(id, label, value = '', type = 'text', placeholder = '') {
    return this._fieldWrap(id, label,
      `<input id="${id}" type="${type}" value="${String(value).replace(/"/g,'&quot;')}" placeholder="${placeholder}" style="${this._inputStyle}">`
    );
  },

  fieldDate(id, label, value = '') {
    return this._fieldWrap(id, label,
      `<input id="${id}" type="date" value="${value}" style="${this._inputStyle}">`
    );
  },

  fieldNumber(id, label, value = 0, min = 0, max = '', step = 1) {
    return this._fieldWrap(id, label,
      `<input id="${id}" type="number" value="${value}" min="${min}" ${max !== '' ? `max="${max}"` : ''} step="${step}" style="${this._inputStyle}">`
    );
  },

  /**
   * @param {string} id
   * @param {string} label
   * @param {Array<{v:string, l:string}>|string[]} options  - [{v:'chave',l:'Label'}] ou ['valor']
   * @param {string} selected - valor selecionado
   */
  fieldSelect(id, label, options = [], selected = '') {
    const opts = options.map(o => {
      const v = typeof o === 'object' ? o.v : o;
      const l = typeof o === 'object' ? o.l : o;
      return `<option value="${v}" ${v === selected ? 'selected' : ''}>${l}</option>`;
    }).join('');
    return this._fieldWrap(id, label,
      `<select id="${id}" style="${this._inputStyle}">${opts}</select>`
    );
  },

  fieldTextarea(id, label, value = '', placeholder = '', rows = 3) {
    return this._fieldWrap(id, label,
      `<textarea id="${id}" rows="${rows}" placeholder="${placeholder}" style="${this._inputStyle};resize:vertical">${value}</textarea>`
    );
  },

  // ── Estados vazios ─────────────────────────────────────────────────────────
  empty(message = 'Nenhum registro encontrado.', icon = '📋') {
    return `<div style="text-align:center;padding:48px 20px;color:var(--text-muted);font-size:13px">
      <div style="font-size:32px;margin-bottom:10px;opacity:.5">${icon}</div>
      ${message}
    </div>`;
  },

  emptyObra(message = 'Selecione uma obra para continuar.') {
    return `<div style="text-align:center;padding:40px;color:var(--text-muted);font-size:13px">${message}</div>`;
  },

  // ── Modal ──────────────────────────────────────────────────────────────────
  modalHeader(title, closeAction = 'fechar') {
    return `<div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:18px">
      <h3 style="margin:0;font-size:15px;font-weight:800;color:var(--text-primary)">${title}</h3>
      ${this.btn('✕', closeAction, null, 'ghost')}
    </div>`;
  },

  modalFooter(buttons = []) {
    return `<div style="display:flex;gap:8px;justify-content:flex-end;margin-top:20px">
      ${Array.isArray(buttons) ? buttons.join('') : buttons}
    </div>`;
  },

  // ── Overlay de modal ───────────────────────────────────────────────────────
  overlay(id, closeAction = 'fechar') {
    return `<div id="${id}-overlay" data-action="${closeAction}"
      style="display:none;position:fixed;inset:0;background:rgba(0,0,0,.6);z-index:1000"></div>
      <div id="${id}-modal"
        style="display:none;position:fixed;top:50%;left:50%;transform:translate(-50%,-50%);
        z-index:1001;background:var(--bg-card);border:1px solid var(--border);border-radius:14px;
        padding:24px;width:min(96vw,560px);max-height:92vh;overflow-y:auto;
        box-shadow:0 20px 60px rgba(0,0,0,.45)"></div>`;
  },

  // ── Barra de progresso ─────────────────────────────────────────────────────
  progress(value, max = 100, cor = 'var(--accent)', height = '8px') {
    const pct = Math.min(100, Math.max(0, (value / max) * 100));
    return `<div style="background:var(--bg-card);border-radius:4px;height:${height};overflow:hidden">
      <div style="height:100%;width:${pct.toFixed(1)}%;background:${cor};border-radius:4px;transition:width .3s"></div>
    </div>`;
  },

  // ── Card de item de lista ─────────────────────────────────────────────────
  card(content, opts = {}) {
    const { borderColor = 'var(--border)', mb = '10px' } = opts;
    return `<div style="background:var(--bg-surface);border:1px solid var(--border);border-radius:10px;
      padding:14px;margin-bottom:${mb};border-left:3px solid ${borderColor}">
      ${content}
    </div>`;
  },
};

export default UI;
