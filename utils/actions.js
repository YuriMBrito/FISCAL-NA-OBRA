/**
 * ╔══════════════════════════════════════════════════════════════╗
 * ║  FISCAL NA OBRA — utils/actions.js                          ║
 * ║  FIX-E4.1: data-action + event delegation                   ║
 * ╚══════════════════════════════════════════════════════════════╝
 *
 * Substitui o padrão onclick="window._fn(id)" por data-action="fn"
 * com um único listener delegado por módulo.
 *
 * BENEFÍCIOS:
 *   - Elimina window.* — funções não ficam expostas no console
 *   - 1 listener por módulo em vez de N listeners por card renderizado
 *   - Novos cards herdam handlers automaticamente
 *   - Permite hot-reload de handlers sem recriar DOM
 *
 * USO:
 *   import { bindActions } from '../../utils/actions.js';
 *
 *   // No _render() ou init():
 *   this._unbindActions = bindActions(container, {
 *     editar:  (id) => this._abrirForm(id),
 *     excluir: (id) => this._excluir(id),
 *     salvar:  ()   => this._salvarForm(),
 *     fechar:  ()   => this._fecharForm(),
 *   });
 *
 *   // No destroy():
 *   this._unbindActions?.();
 *
 *   // No HTML gerado (em vez de onclick="window._fn('id')"):
 *   `<button data-action="editar" data-id="${item.id}">✏️</button>`
 *   `<button data-action="excluir" data-id="${item.id}">🗑️</button>`
 *   `<button data-action="salvar">💾 Salvar</button>`
 */

/**
 * Registra um único listener delegado no container.
 *
 * @param {HTMLElement|string} containerOrSelector - elemento ou seletor CSS
 * @param {Record<string, Function>} handlers      - mapa ação → função
 * @returns {Function} unsubscribe — chamar no destroy()
 */
export function bindActions(containerOrSelector, handlers) {
  const container = typeof containerOrSelector === 'string'
    ? document.querySelector(containerOrSelector)
    : containerOrSelector;

  if (!container) {
    console.warn('[actions] container não encontrado:', containerOrSelector);
    return () => {};
  }

  const listener = (e) => {
    const btn = e.target.closest('[data-action]');
    if (!btn || !container.contains(btn)) return;

    const action = btn.dataset.action;
    const id     = btn.dataset.id     ?? null;
    const value  = btn.dataset.value  ?? null;
    const extra  = btn.dataset.extra  ?? null;

    const fn = handlers[action];
    if (typeof fn === 'function') {
      e.stopPropagation();
      // Passa id como primeiro argumento se existir, depois value e extra
      fn(id, value, extra, btn);
    } else if (action) {
      console.warn(`[actions] ação "${action}" não registrada no handler`);
    }
  };

  container.addEventListener('click', listener);
  return () => container.removeEventListener('click', listener);
}

/**
 * Versão simplificada: registra no document.getElementById(containerId).
 * Útil quando o container é renderizado dinamicamente e pode não existir
 * no momento do init().
 *
 * @param {string}   containerId  - id do elemento (sem #)
 * @param {Record<string, Function>} handlers
 * @returns {Function} unsubscribe
 */
export function bindActionsById(containerId, handlers) {
  return bindActions(document.getElementById(containerId), handlers);
}
