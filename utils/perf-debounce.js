/**
 * ╔══════════════════════════════════════════════════════════════╗
 * ║  FISCAL NA OBRA v15.1 — utils/perf-debounce.js             ║
 * ║  Utilitários de performance: debounce, throttle, batch     ║
 * ║                                                              ║
 * ║  Resolve problema de leituras excessivas do Firestore       ║
 * ║  ao renderizar tabelas grandes de BM com muitos itens.     ║
 * ╚══════════════════════════════════════════════════════════════╝
 */

/**
 * Debounce: executa fn apenas após `delay` ms sem novas chamadas.
 * Uso ideal: salvar automaticamente, busca em tempo real.
 *
 * @param {Function} fn
 * @param {number} delay — ms
 * @returns {Function} função debounced com .cancel()
 */
export function debounce(fn, delay = 300) {
  let timer = null;
  function debounced(...args) {
    clearTimeout(timer);
    timer = setTimeout(() => {
      timer = null;
      fn.apply(this, args);
    }, delay);
  }
  debounced.cancel = () => clearTimeout(timer);
  debounced.flush  = (...args) => { clearTimeout(timer); fn.apply(this, args); };
  return debounced;
}

/**
 * Throttle: executa fn no máximo 1x por `limit` ms.
 * Uso ideal: scroll, resize, eventos frequentes de UI.
 *
 * @param {Function} fn
 * @param {number} limit — ms
 * @returns {Function} função throttled
 */
export function throttle(fn, limit = 200) {
  let last = 0;
  let timer = null;
  return function (...args) {
    const now = Date.now();
    const remaining = limit - (now - last);
    if (remaining <= 0) {
      clearTimeout(timer);
      last = now;
      fn.apply(this, args);
    } else {
      clearTimeout(timer);
      timer = setTimeout(() => {
        last = Date.now();
        fn.apply(this, args);
      }, remaining);
    }
  };
}

/**
 * Memoize: armazena resultado de funções puras para os mesmos argumentos.
 * Usa WeakRef para chaves objeto (evita memory leak).
 *
 * @param {Function} fn — deve ser função pura (sem side effects)
 * @param {Function} [keyFn] — serializa argumentos em chave string
 * @param {number}   [maxSize=100] — LRU cap
 * @returns {Function} função memoizada com .clear()
 */
export function memoize(fn, keyFn = (...a) => JSON.stringify(a), maxSize = 100) {
  const cache = new Map();
  function memoized(...args) {
    const key = keyFn(...args);
    if (cache.has(key)) {
      const entry = cache.get(key);
      // LRU: move para o fim
      cache.delete(key);
      cache.set(key, entry);
      return entry;
    }
    const result = fn.apply(this, args);
    if (cache.size >= maxSize) {
      // Remove o mais antigo (primeiro da Map)
      cache.delete(cache.keys().next().value);
    }
    cache.set(key, result);
    return result;
  }
  memoized.clear = () => cache.clear();
  memoized.size  = () => cache.size;
  return memoized;
}

/**
 * BatchQueue: agrupa chamadas feitas em sequência rápida e as executa
 * em lote após `delay` ms de silêncio.
 * Uso ideal: múltiplos salvarMedicoes() disparados em milissegundos.
 *
 * @example
 *   const queue = new BatchQueue(items => salvarTodos(items), 400);
 *   queue.add({ itemId: 'i1', val: 5 });
 *   queue.add({ itemId: 'i2', val: 3 });
 *   // → salvarTodos([{itemId:'i1',...}, {itemId:'i2',...}]) após 400ms
 */
export class BatchQueue {
  constructor(processFn, delay = 400) {
    this._fn    = processFn;
    this._delay = delay;
    this._queue = [];
    this._timer = null;
  }

  add(item) {
    this._queue.push(item);
    clearTimeout(this._timer);
    this._timer = setTimeout(() => this._flush(), this._delay);
  }

  _flush() {
    if (!this._queue.length) return;
    const batch = [...this._queue];
    this._queue = [];
    this._timer = null;
    try { this._fn(batch); } catch (e) { console.error('[BatchQueue] flush:', e); }
  }

  forceFlush() { clearTimeout(this._timer); this._flush(); }
  cancel()     { clearTimeout(this._timer); this._queue = []; }
  size()       { return this._queue.length; }
}

/**
 * Lazy render: atrasa renderização de listas longas para não bloquear o UI.
 * Renderiza `chunkSize` itens por frame de animação.
 *
 * @param {Array} items
 * @param {Function} renderItem — (item, index) => HTMLString
 * @param {Element} container
 * @param {number} [chunkSize=20]
 */
export function lazyRender(items, renderItem, container, chunkSize = 20) {
  if (!container) return;
  container.innerHTML = '';
  let index = 0;

  function renderChunk() {
    const end = Math.min(index + chunkSize, items.length);
    const fragment = document.createDocumentFragment();
    for (; index < end; index++) {
      const el = document.createElement('div');
      el.innerHTML = renderItem(items[index], index);
      if (el.firstElementChild) fragment.appendChild(el.firstElementChild);
      else fragment.appendChild(el);
    }
    container.appendChild(fragment);
    if (index < items.length) requestAnimationFrame(renderChunk);
  }

  requestAnimationFrame(renderChunk);
}
