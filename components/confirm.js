/**
 * ╔══════════════════════════════════════════════════════════════╗
 * ║  FISCAL NA OBRA — components/confirm.js                     ║
 * ║  FIX-E3.3: substitui 41 confirm() nativos do browser        ║
 * ╚══════════════════════════════════════════════════════════════╝
 *
 * Substitui window.confirm() nativo — que bloqueia a UI, não pode
 * ser estilizado e é inutilizável em mobile — por um modal leve
 * consistente com o design system.
 *
 * USO:
 *   import { ConfirmComponent } from '../../components/confirm.js';
 *
 *   // Simples
 *   const ok = await ConfirmComponent.show('Excluir este item?');
 *   if (!ok) return;
 *
 *   // Com opções
 *   const ok = await ConfirmComponent.show(
 *     'Importar planilha SINAPI? Os 127 itens atuais serão substituídos.',
 *     { labelOk: 'Importar', labelCancel: 'Cancelar', danger: true }
 *   );
 *
 * COMPATIBILIDADE:
 *   window._confirm é exposto como alias global para que módulos que
 *   ainda usam confirm() nativo possam ser migrados gradualmente.
 */

let _overlay = null;
let _pendingResolve = null;

function _getOrCreateOverlay() {
  if (_overlay && document.body.contains(_overlay)) return _overlay;

  _overlay = document.createElement('div');
  _overlay.id = '_fo-confirm-overlay';
  _overlay.style.cssText = [
    'position:fixed', 'inset:0', 'z-index:99999',
    'background:rgba(0,0,0,.55)',
    'display:flex', 'align-items:center', 'justify-content:center',
    'opacity:0', 'transition:opacity .15s',
    'padding:16px', 'box-sizing:border-box',
  ].join(';');

  // Clicar fora = cancelar
  _overlay.addEventListener('click', e => {
    if (e.target === _overlay) _resolve(false);
  });
  // ESC = cancelar
  document.addEventListener('keydown', _onKey);

  document.body.appendChild(_overlay);
  return _overlay;
}

function _onKey(e) {
  if (e.key === 'Escape') _resolve(false);
  if (e.key === 'Enter')  _resolve(true);
}

function _resolve(value) {
  if (!_pendingResolve) return;
  const fn = _pendingResolve;
  _pendingResolve = null;
  document.removeEventListener('keydown', _onKey);
  if (_overlay) {
    _overlay.style.opacity = '0';
    setTimeout(() => {
      if (_overlay && _overlay.parentNode) _overlay.parentNode.removeChild(_overlay);
      _overlay = null;
    }, 160);
  }
  fn(value);
}

export const ConfirmComponent = {
  /**
   * Exibe um modal de confirmação e retorna Promise<boolean>.
   *
   * @param {string}  message                - Mensagem principal
   * @param {object}  [opts]
   * @param {string}  [opts.title]           - Título (opcional)
   * @param {string}  [opts.labelOk='Confirmar']
   * @param {string}  [opts.labelCancel='Cancelar']
   * @param {boolean} [opts.danger=true]     - Botão OK em vermelho
   * @param {string}  [opts.detail]          - Texto secundário menor
   * @returns {Promise<boolean>}
   */
  show(message, opts = {}) {
    return new Promise(resolve => {
      _pendingResolve = resolve;

      const {
        title       = null,
        labelOk     = 'Confirmar',
        labelCancel = 'Cancelar',
        danger      = true,
        detail      = null,
      } = opts;

      const okColor = danger ? '#dc2626' : 'var(--accent, #3b82f6)';
      const okHover = danger ? '#b91c1c' : '#2563eb';

      const overlay = _getOrCreateOverlay();
      overlay.innerHTML = `
        <div role="dialog" aria-modal="true"
          style="
            background:var(--bg-card,#1e2330);
            border:1px solid var(--border,#2d3748);
            border-radius:12px;
            padding:24px;
            width:min(92vw,420px);
            box-shadow:0 20px 60px rgba(0,0,0,.5);
          ">
          ${title ? `<div style="font-size:14px;font-weight:800;color:var(--text-primary,#f1f5f9);margin-bottom:10px">${title}</div>` : ''}
          <div style="font-size:13px;color:var(--text-primary,#f1f5f9);line-height:1.6;margin-bottom:${detail ? '8px' : '20px'}">${message}</div>
          ${detail ? `<div style="font-size:12px;color:var(--text-muted,#9ca3af);margin-bottom:20px;line-height:1.5">${detail}</div>` : ''}
          <div style="display:flex;gap:10px;justify-content:flex-end">
            <button id="_fo-confirm-cancel"
              style="
                padding:8px 18px;
                border-radius:8px;
                border:1px solid var(--border,#2d3748);
                background:var(--bg-surface,#2d3748);
                color:var(--text-primary,#f1f5f9);
                font-size:13px;font-weight:600;cursor:pointer;
              "
              onmouseover="this.style.opacity='.8'"
              onmouseout="this.style.opacity='1'"
            >${labelCancel}</button>
            <button id="_fo-confirm-ok"
              style="
                padding:8px 18px;
                border-radius:8px;
                border:none;
                background:${okColor};
                color:#fff;
                font-size:13px;font-weight:700;cursor:pointer;
              "
              onmouseover="this.style.background='${okHover}'"
              onmouseout="this.style.background='${okColor}'"
            >${labelOk}</button>
          </div>
        </div>
      `;

      overlay.querySelector('#_fo-confirm-cancel').onclick = () => _resolve(false);
      overlay.querySelector('#_fo-confirm-ok').onclick     = () => _resolve(true);

      // Anima entrada
      requestAnimationFrame(() => {
        overlay.style.opacity = '1';
        overlay.querySelector('#_fo-confirm-ok')?.focus();
      });
    });
  },
};

// ── Alias global — migração gradual dos módulos ───────────────────────────────
// Módulos que ainda chamam confirm() nativo podem usar window._confirm()
// sem alterar sua lógica imediatamente.
// Nota: window._confirm é async — módulos que usam `if (!confirm(...)) return`
// precisam ser migrados para `if (!await window._confirm(...)) return`.
if (typeof window !== 'undefined') {
  window._confirm = (message, opts) => ConfirmComponent.show(message, opts);
}

export default ConfirmComponent;
