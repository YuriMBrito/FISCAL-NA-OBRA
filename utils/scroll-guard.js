/**
 * ╔══════════════════════════════════════════════════════════════╗
 * ║  FISCAL NA OBRA v20 — utils/scroll-guard.js                ║
 * ║  Problema 3 — Scroll automático durante digitação          ║
 * ╚══════════════════════════════════════════════════════════════╝
 *
 * PROPÓSITO:
 *   Intercepta scrollIntoView para permitir scroll apenas em
 *   situações legítimas (nova linha adicionada, novo foco),
 *   bloqueando-o enquanto o usuário está editando um campo.
 *
 * ESTRATÉGIA:
 *   - safeScrollIntoView(): substitui chamadas diretas a scrollIntoView.
 *     Verifica se o usuário está digitando antes de rolar.
 *   - _flagEditing: flag que é ativada no focusin e desativada no blur,
 *     com debounce de 150ms para cobrir transições rápidas.
 *   - scrollAfterAdd(): para uso em adicionarLinha() — sempre permite scroll
 *     pois é uma ação explícita do usuário.
 *
 * USO:
 *   import { safeScrollIntoView, scrollAfterAdd } from '../../utils/scroll-guard.js';
 *
 *   // Substitui: last.scrollIntoView({ behavior:'smooth', block:'center' })
 *   safeScrollIntoView(last);
 *
 *   // Em adicionarLinha() — permite scroll incondicional:
 *   scrollAfterAdd(last);
 */

let _isEditing    = false;
let _editTimeout  = null;

// ── Rastreia estado de edição via delegação global ─────────────────────────
if (typeof document !== 'undefined') {
  document.addEventListener('focusin', (e) => {
    if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA' || e.target.isContentEditable) {
      clearTimeout(_editTimeout);
      _isEditing = true;
    }
  }, { passive: true });

  document.addEventListener('focusout', () => {
    clearTimeout(_editTimeout);
    // Pequeno debounce: aguarda novo foco antes de desligar o flag
    _editTimeout = setTimeout(() => { _isEditing = false; }, 150);
  }, { passive: true });
}

// ── safeScrollIntoView ─────────────────────────────────────────────────────
/**
 * Rola a tela para o elemento SOMENTE se o usuário NÃO estiver editando.
 *
 * @param {Element}  el       - Elemento a rolar para o foco
 * @param {Object}   [opts]   - Opções do scrollIntoView nativo
 * @param {boolean}  [force=false] - Ignora a checagem de edição
 */
export function safeScrollIntoView(el, opts = { behavior: 'smooth', block: 'nearest' }, force = false) {
  if (!el) return;
  if (!force && _isEditing) return; // Bloqueia durante edição
  try {
    el.scrollIntoView(opts);
  } catch (e) {
    console.warn('[ScrollGuard] scrollIntoView falhou:', e);
  }
}

// ── scrollAfterAdd ─────────────────────────────────────────────────────────
/**
 * Versão para adicionarLinha() — sempre rola, pois é ação explícita.
 * Aplica focus() e select() junto, com rAF para aguardar o DOM.
 *
 * @param {Element}  el - Input da nova linha
 */
export function scrollAfterAdd(el) {
  if (!el) return;
  requestAnimationFrame(() => {
    try {
      el.scrollIntoView({ behavior: 'smooth', block: 'center' });
      el.focus({ preventScroll: false });
      el.select?.();
    } catch (e) {
      console.warn('[ScrollGuard] scrollAfterAdd:', e);
    }
  });
}

// ── isEditing ──────────────────────────────────────────────────────────────
/** Expõe o estado de edição atual para uso em outros módulos */
export function isEditing() { return _isEditing; }
