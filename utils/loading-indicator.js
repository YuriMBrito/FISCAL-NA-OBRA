/**
 * ╔══════════════════════════════════════════════════════════════╗
 * ║  FISCAL NA OBRA v20 — utils/loading-indicator.js           ║
 * ║  Problema 5 — Feedback visual ao usuário                   ║
 * ╚══════════════════════════════════════════════════════════════╝
 *
 * PROPÓSITO:
 *   Indicadores de carregamento não intrusivos que se sobrepõem
 *   a containers específicos ou à tela inteira, sem alterar o
 *   layout existente. Usa um overlay leve com CSS inline.
 *
 * API:
 *   LoadingIndicator.show(target, message?)   — Mostra loader
 *   LoadingIndicator.hide(target)             — Remove loader
 *   LoadingIndicator.wrap(asyncFn, opts)      — Decorator automático
 *   LoadingIndicator.button(btn, asyncFn)     — Desativa botão + mostra spinner
 *
 * EXEMPLOS:
 *   // Loader de tela inteira:
 *   LoadingIndicator.show('body', 'Importando planilha...');
 *   await processarPlanilha();
 *   LoadingIndicator.hide('body');
 *
 *   // Loader em container específico:
 *   const el = document.getElementById('mem-table-wrap');
 *   LoadingIndicator.show(el, 'Calculando medições...');
 *   await recalcular();
 *   LoadingIndicator.hide(el);
 *
 *   // Decorator automático (mais simples):
 *   await LoadingIndicator.wrap(
 *     () => importarArquivo(file),
 *     { target: '#si-status', message: 'Processando arquivo...' }
 *   );
 *
 *   // Botão com spinner:
 *   btnCriarObra.addEventListener('click', () =>
 *     LoadingIndicator.button(btnCriarObra, () => this._criarObra())
 *   );
 */

const OVERLAY_ATTR = 'data-loading-overlay';
const OVERLAY_ID_PREFIX = '__loading_overlay_';
let _overlayCounter = 0;

// ── CSS inline compartilhado ───────────────────────────────────────────────
const OVERLAY_STYLE = `
  position:absolute;inset:0;z-index:9998;
  background:rgba(15,23,42,.62);
  display:flex;align-items:center;justify-content:center;
  border-radius:inherit;backdrop-filter:blur(2px);
  animation:__ld_fade .18s ease;
`;
const SPINNER_STYLE = `
  display:inline-block;width:22px;height:22px;
  border:3px solid rgba(255,255,255,.25);
  border-top-color:#fff;border-radius:50%;
  animation:__ld_spin .7s linear infinite;
  flex-shrink:0;
`;
const MSG_STYLE = `
  font-size:12px;font-weight:700;color:#f8fafc;
  margin-left:10px;letter-spacing:.3px;
`;

// Injeta keyframes uma única vez
function _injectKeyframes() {
  if (document.getElementById('__loading_keyframes')) return;
  const style = document.createElement('style');
  style.id = '__loading_keyframes';
  style.textContent = `
    @keyframes __ld_spin { to { transform:rotate(360deg); } }
    @keyframes __ld_fade { from { opacity:0; } to { opacity:1; } }
  `;
  document.head.appendChild(style);
}

// ── Resolve target para Element ────────────────────────────────────────────
function _resolveTarget(target) {
  if (!target) return document.body;
  if (typeof target === 'string') return document.querySelector(target) || document.body;
  return target;
}

const LoadingIndicator = {

  // ── show ────────────────────────────────────────────────────
  /**
   * Mostra indicador de carregamento sobre o target.
   * @param {Element|string} target  - Elemento ou seletor CSS
   * @param {string}         [msg]   - Mensagem opcional
   * @returns {string} ID do overlay (para hide())
   */
  show(target, msg = '') {
    _injectKeyframes();
    const el = _resolveTarget(target);
    if (!el) return '';

    // Garante position:relative no container (se não for body/fixed)
    const pos = getComputedStyle(el).position;
    if (pos === 'static' && el !== document.body) {
      el.style.position = 'relative';
    }

    const id      = OVERLAY_ID_PREFIX + (++_overlayCounter);
    const overlay = document.createElement('div');
    overlay.id    = id;
    overlay.setAttribute(OVERLAY_ATTR, '1');
    overlay.style.cssText = OVERLAY_STYLE + (el === document.body
      ? 'position:fixed;'
      : '');

    overlay.innerHTML = `
      <div style="display:flex;align-items:center;background:rgba(15,23,42,.85);
        padding:10px 18px;border-radius:8px;box-shadow:0 4px 20px rgba(0,0,0,.4)">
        <span style="${SPINNER_STYLE}"></span>
        ${msg ? `<span style="${MSG_STYLE}">${msg}</span>` : ''}
      </div>
    `;

    el.setAttribute(OVERLAY_ATTR, id);
    el.appendChild(overlay);
    return id;
  },

  // ── hide ────────────────────────────────────────────────────
  /**
   * Remove o indicador de carregamento.
   * @param {Element|string|null} target - Mesmo target passado para show()
   *                                       (pode ser null para remover todos)
   */
  hide(target = null) {
    if (!target) {
      document.querySelectorAll(`[${OVERLAY_ATTR}]`).forEach(el => {
        const overlayId = el.getAttribute(OVERLAY_ATTR);
        if (overlayId.startsWith(OVERLAY_ID_PREFIX)) {
          el.remove(); // é o próprio overlay
        } else {
          const overlay = document.getElementById(overlayId);
          overlay?.remove();
          el.removeAttribute(OVERLAY_ATTR);
        }
      });
      return;
    }
    const el      = _resolveTarget(target);
    if (!el) return;
    const overlayId = el.getAttribute(OVERLAY_ATTR);
    if (overlayId) {
      document.getElementById(overlayId)?.remove();
      el.removeAttribute(OVERLAY_ATTR);
    }
  },

  // ── wrap ────────────────────────────────────────────────────
  /**
   * Executa uma função assíncrona exibindo loading antes e escondendo depois.
   * Em caso de erro, remove o loading e relança a exceção.
   *
   * @param {Function} asyncFn - Função async a executar
   * @param {Object}   opts
   * @param {Element|string} [opts.target='body']   - Container do overlay
   * @param {string}         [opts.message='']      - Mensagem de loading
   * @param {string}         [opts.successMsg='']   - Toast de sucesso (opcional)
   * @param {string}         [opts.errorMsg='']     - Prefixo de toast de erro
   * @returns {Promise<*>} Resultado de asyncFn
   */
  async wrap(asyncFn, { target = 'body', message = '', successMsg = '', errorMsg = '' } = {}) {
    this.show(target, message);
    try {
      const result = await asyncFn();
      if (successMsg) window.toast?.(successMsg, 'ok');
      return result;
    } catch (e) {
      const msg = errorMsg ? `${errorMsg}: ${e.message}` : `❌ Erro: ${e.message}`;
      window.toast?.(msg, 'error');
      throw e;
    } finally {
      this.hide(target);
    }
  },

  // ── button ──────────────────────────────────────────────────
  /**
   * Desativa um botão, mostra spinner inline e restaura ao terminar.
   * Ideal para ações de formulário (Criar Obra, Salvar, Importar).
   *
   * @param {HTMLButtonElement} btn      - Botão a desativar
   * @param {Function}          asyncFn  - Função async a executar
   * @param {string}            [label]  - Texto de loading (default: conteúdo atual + "...")
   */
  async button(btn, asyncFn, label = null) {
    if (!btn || btn.disabled) return;
    const originalHTML = btn.innerHTML;
    const loadLabel    = label || (btn.textContent.trim() || 'Aguarde') + '...';

    btn.disabled   = true;
    btn.innerHTML  = `<span style="${SPINNER_STYLE}margin-right:6px;vertical-align:middle"></span>${loadLabel}`;

    try {
      return await asyncFn();
    } finally {
      btn.disabled  = false;
      btn.innerHTML = originalHTML;
    }
  },

  // ── inline ──────────────────────────────────────────────────
  /**
   * Injeta HTML de loading em um elemento de status existente.
   * Útil para os elementos #si-status e similares já usados no código.
   *
   * @param {string|Element} target - Elemento de status
   * @param {string}         [msg]  - Mensagem
   */
  inline(target, msg = 'Processando...') {
    const el = _resolveTarget(target);
    if (!el) return;
    el.innerHTML = `
      <span style="display:inline-flex;align-items:center;gap:8px;color:#94a3b8;font-size:12px">
        <span style="${SPINNER_STYLE}border-top-color:#60a5fa;border-color:rgba(148,163,184,.3)"></span>
        <span>${msg}</span>
      </span>
    `;
  },

  // ── progress ────────────────────────────────────────────────
  /**
   * Mostra barra de progresso em um elemento de status.
   * @param {string|Element} target  - Elemento de status
   * @param {number}         pct     - 0 a 100
   * @param {string}         [msg]
   */
  progress(target, pct, msg = '') {
    const el = _resolveTarget(target);
    if (!el) return;
    const p = Math.min(100, Math.max(0, pct));
    el.innerHTML = `
      <div style="width:100%">
        ${msg ? `<div style="font-size:11px;color:#94a3b8;margin-bottom:5px">${msg}</div>` : ''}
        <div style="height:6px;background:rgba(255,255,255,.1);border-radius:3px;overflow:hidden">
          <div style="height:100%;width:${p}%;background:#3b82f6;border-radius:3px;
            transition:width .3s ease;"></div>
        </div>
        <div style="font-size:10px;color:#64748b;margin-top:3px;text-align:right">${p.toFixed(0)}%</div>
      </div>
    `;
  },
};

export default LoadingIndicator;
