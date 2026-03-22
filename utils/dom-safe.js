/**
 * ╔══════════════════════════════════════════════════════════════════════╗
 * ║  FISCAL NA OBRA — utils/dom-safe.js                                ║
 * ║  Wrappers seguros para manipulação DOM                              ║
 * ╠══════════════════════════════════════════════════════════════════════╣
 * ║  FASE 5 — Performance & Scalability: DOM Safety                     ║
 * ║                                                                      ║
 * ║  Todas as funções aceitam null/undefined sem lançar exceção.        ║
 * ║  Nenhuma função causa re-render desnecessário.                       ║
 * ║  Todas são otimizadas para performance em tabelas grandes.          ║
 * ╚══════════════════════════════════════════════════════════════════════╝
 *
 * USO:
 *   import { $, $$, setText, setHTML, show, hide, on } from '../utils/dom-safe.js';
 *
 *   const el = $('#meu-id');          // null-safe getElementById
 *   setText('#total', 'R$ 1.234');    // null-safe textContent
 *   on('#btn', 'click', handler);     // auto-cleanup listener
 */

// ── Seletores seguros ─────────────────────────────────────────

/**
 * getElementById null-safe. Aceita string (id), Element ou null.
 * @param {string|Element|null} sel
 * @returns {Element|null}
 */
export function $(sel) {
  if (!sel) return null;
  if (sel instanceof Element) return sel;
  if (typeof sel === 'string') {
    return sel.startsWith('#')
      ? document.getElementById(sel.slice(1))
      : document.getElementById(sel) || document.querySelector(sel);
  }
  return null;
}

/**
 * querySelectorAll null-safe. Retorna array (nunca NodeList, nunca null).
 * @param {string} sel — seletor CSS
 * @param {Element} [scope=document]
 * @returns {Element[]}
 */
export function $$(sel, scope = document) {
  if (!sel || !scope) return [];
  try {
    return [...scope.querySelectorAll(sel)];
  } catch {
    return [];
  }
}

// ── Texto e HTML seguros ──────────────────────────────────────

/**
 * Define textContent de forma null-safe.
 * Só altera se o valor realmente mudou (evita layout thrashing).
 *
 * @param {string|Element} target — id ou elemento
 * @param {*} text — novo texto
 * @returns {boolean} — true se alterou
 */
export function setText(target, text) {
  const el = $(target);
  if (!el) return false;
  const newText = String(text ?? '');
  if (el.textContent !== newText) {
    el.textContent = newText;
    return true;
  }
  return false;
}

/**
 * Define innerHTML de forma null-safe.
 * Só altera se o HTML realmente mudou (evita re-render).
 *
 * @param {string|Element} target — id ou elemento
 * @param {string} html — novo HTML
 * @returns {boolean} — true se alterou
 */
export function setHTML(target, html) {
  const el = $(target);
  if (!el) return false;
  const newHTML = String(html ?? '');
  if (el.innerHTML !== newHTML) {
    el.innerHTML = newHTML;
    return true;
  }
  return false;
}

/**
 * Define valor de input/select/textarea de forma null-safe.
 *
 * @param {string|Element} target
 * @param {*} value
 * @returns {boolean}
 */
export function setValue(target, value) {
  const el = $(target);
  if (!el) return false;
  const newVal = value ?? '';
  if (el.value !== String(newVal)) {
    el.value = newVal;
    return true;
  }
  return false;
}

// ── Visibilidade segura ───────────────────────────────────────

/** Mostra elemento (remove display:none). */
export function show(target, displayValue = '') {
  const el = $(target);
  if (el) el.style.display = displayValue;
}

/** Oculta elemento (display:none). */
export function hide(target) {
  const el = $(target);
  if (el) el.style.display = 'none';
}

/** Toggle de visibilidade. */
export function toggle(target, visible) {
  const el = $(target);
  if (!el) return;
  if (visible === undefined) {
    el.style.display = el.style.display === 'none' ? '' : 'none';
  } else {
    el.style.display = visible ? '' : 'none';
  }
}

// ── Classes CSS seguras ───────────────────────────────────────

export function addClass(target, ...classes) {
  const el = $(target);
  if (el) el.classList.add(...classes.filter(Boolean));
}

export function removeClass(target, ...classes) {
  const el = $(target);
  if (el) el.classList.remove(...classes.filter(Boolean));
}

export function toggleClass(target, className, force) {
  const el = $(target);
  if (el && className) el.classList.toggle(className, force);
}

export function hasClass(target, className) {
  const el = $(target);
  return el ? el.classList.contains(className) : false;
}

// ── Eventos com auto-cleanup ──────────────────────────────────

/**
 * Registra event listener com auto-cleanup.
 * Retorna função de cleanup que remove o listener.
 *
 * @param {string|Element} target
 * @param {string} event
 * @param {Function} handler
 * @param {Object} [opts] — addEventListener options
 * @returns {Function} — cleanup function
 */
export function on(target, event, handler, opts = {}) {
  const el = $(target);
  if (!el || !event || typeof handler !== 'function') {
    return () => {}; // noop cleanup
  }
  el.addEventListener(event, handler, opts);
  return () => el.removeEventListener(event, handler, opts);
}

/**
 * Registra evento delegado com auto-cleanup.
 * Útil para tabelas dinâmicas com muitos elementos.
 *
 * @param {string|Element} container — container pai
 * @param {string} event — tipo de evento
 * @param {string} selector — seletor CSS do alvo
 * @param {Function} handler — fn(e, matchedEl)
 * @returns {Function} — cleanup
 */
export function onDelegate(container, event, selector, handler) {
  const el = $(container);
  if (!el) return () => {};

  const delegated = (e) => {
    const target = e.target.closest(selector);
    if (target && el.contains(target)) {
      handler(e, target);
    }
  };

  el.addEventListener(event, delegated, { passive: false });
  return () => el.removeEventListener(event, delegated);
}

// ── Batch DOM updates ─────────────────────────────────────────

/**
 * Aplica múltiplas atualizações de textContent em batch.
 * Otimizado para atualizar dezenas de células sem layout thrashing.
 *
 * @param {Object} updates — { elementId: novoTexto, ... }
 * @returns {number} — quantidade de elementos atualizados
 */
export function batchSetText(updates) {
  if (!updates || typeof updates !== 'object') return 0;
  let count = 0;
  const entries = Object.entries(updates);
  for (let i = 0; i < entries.length; i++) {
    if (setText(entries[i][0], entries[i][1])) count++;
  }
  return count;
}

// ── Criação segura de elementos ───────────────────────────────

/**
 * Cria elemento com atributos e filhos.
 *
 * @param {string} tag — nome da tag
 * @param {Object} attrs — { class: '...', id: '...', style: '...', ... }
 * @param {Array|string} children — filhos (strings ou Elements)
 * @returns {HTMLElement}
 */
export function createElement(tag, attrs = {}, children = []) {
  const el = document.createElement(tag);

  Object.entries(attrs).forEach(([key, val]) => {
    if (key === 'class' || key === 'className') {
      el.className = val;
    } else if (key === 'style' && typeof val === 'object') {
      Object.assign(el.style, val);
    } else if (key.startsWith('on') && typeof val === 'function') {
      el.addEventListener(key.slice(2).toLowerCase(), val);
    } else if (key === 'dataset' && typeof val === 'object') {
      Object.assign(el.dataset, val);
    } else {
      el.setAttribute(key, val);
    }
  });

  const childArray = Array.isArray(children) ? children : [children];
  childArray.forEach(child => {
    if (typeof child === 'string') {
      el.appendChild(document.createTextNode(child));
    } else if (child instanceof Node) {
      el.appendChild(child);
    }
  });

  return el;
}

export default {
  $, $$, setText, setHTML, setValue,
  show, hide, toggle,
  addClass, removeClass, toggleClass, hasClass,
  on, onDelegate, batchSetText, createElement,
};
