/**
 * ╔══════════════════════════════════════════════════════════════╗
 * ║  FISCAL NA OBRA v15.1 — utils/event-delegate.js            ║
 * ║  Sistema de Event Delegation — elimina onclick="window.fn" ║
 * ║  Permite CSP sem 'unsafe-inline' em script-src             ║
 * ╚══════════════════════════════════════════════════════════════╝
 *
 * USO NOS TEMPLATES HTML:
 *   Antes: <button onclick="window._bmSalvar('x', 1)">
 *   Depois: <button data-action="bmSalvar" data-arg0="x" data-arg1="1">
 *
 * REGISTRO DE HANDLERS:
 *   EventDelegate.register('bmSalvar', (arg0, arg1) => { ... });
 *
 * INICIALIZAÇÃO:
 *   EventDelegate.init(document.getElementById('app-shell'));
 *
 * O delegador escuta click/change/input/submit no container raiz
 * e despacha para o handler registrado sem precisar de onclick inline.
 */

const _handlers = new Map();
const _initialized = new Set();

export const EventDelegate = {

  /**
   * Registra um handler para um action name.
   * Pode ser chamado a qualquer momento — antes ou depois do init().
   * @param {string} action - nome da ação (ex: 'bmSalvar')
   * @param {Function} fn - função handler(arg0, arg1, ..., event, element)
   */
  register(action, fn) {
    if (typeof fn !== 'function') {
      console.warn(`[EventDelegate] Handler inválido para "${action}"`);
      return;
    }
    _handlers.set(action, fn);
  },

  /**
   * Registra múltiplos handlers de uma vez.
   * @param {Object} map - { actionName: fn, ... }
   */
  registerAll(map) {
    for (const [action, fn] of Object.entries(map)) {
      this.register(action, fn);
    }
  },

  /**
   * Inicializa a delegação num elemento container.
   * Pode ser chamado em múltiplos containers (ex: app-shell + modals).
   * @param {Element} container
   */
  init(container) {
    if (!container || _initialized.has(container)) return;
    _initialized.add(container);

    container.addEventListener('click',  this._dispatch.bind(this), true);
    container.addEventListener('change', this._dispatch.bind(this), true);
    container.addEventListener('submit', this._dispatch.bind(this), true);
    // 'input' usa bubble phase (false) — o valor do campo (el.value) só fica
    // atualizado APÓS a fase de captura, por isso não usamos capture aqui.
    container.addEventListener('input',  this._dispatchInput.bind(this), false);
  },

  /** @private */
  _dispatch(event) {
    // Sobe o DOM a partir do target até encontrar data-action
    let el = event.target;
    while (el && el !== document.body) {
      const action = el.dataset?.action;
      if (action) {
        const handler = _handlers.get(action);
        if (handler) {
          // Coleta data-arg0, data-arg1, ..., data-arg9
          const args = [];
          for (let i = 0; i <= 9; i++) {
            const v = el.dataset[`arg${i}`];
            if (v !== undefined) args.push(_tryParse(v));
            else break;
          }
          // Suporte a data-value-from="this.value" para inputs numéricos (ex: CAIXA %)
          // Injeta o valor atual do input como último argumento antes de event/el
          if (el.dataset.valueFrom === 'this.value') {
            args.push(el.value);
          }
          try {
            handler(...args, event, el);
          } catch (err) {
            console.error(`[EventDelegate] Erro em handler "${action}":`, err);
          }
          // Não propaga para outros data-action no DOM acima
          return;
        } else {
          console.warn(`[EventDelegate] Action "${action}" não tem handler registrado.`);
        }
      }
      el = el.parentElement;
    }
  },

  /**
   * Variante de _dispatch usada para o evento 'input' (fase de bubble).
   * Idêntica a _dispatch mas garantidamente lê el.value DEPOIS da atualização.
   * @private
   */
  _dispatchInput(event) {
    return this._dispatch(event);
  },

  /** Lista todos os actions registrados (debug) */
  list() {
    return [..._handlers.keys()];
  },
};

/**
 * Converte valores de data-arg para seus tipos JS corretos.
 * INTENCIONAL: NÃO converte strings numéricas para Number.
 * Motivo: IDs de item como "1.1", "2.3", "1.01" são strings no Firestore
 * e devem permanecer strings — converter para número quebra todas as buscas
 * do tipo itens.find(i => i.id === argRecebido).
 * Handlers que precisem de números devem fazer parseInt/parseFloat explicitamente.
 */
function _tryParse(val) {
  if (val === 'true')  return true;
  if (val === 'false') return false;
  if (val === 'null')  return null;
  // Arrays e objetos JSON: parse seguro
  if (val.startsWith('{') || val.startsWith('[')) {
    try { return JSON.parse(val); } catch { return val; }
  }
  // Tudo mais (IDs, strings, números) permanece como string
  return val;
}

export default EventDelegate;
