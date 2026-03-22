/**
 * ╔══════════════════════════════════════════════════════════════╗
 * ║  FISCAL NA OBRA v15.1 — utils/dom-safe-v2.js               ║
 * ║  API segura para manipulação de DOM sem XSS                 ║
 * ║                                                              ║
 * ║  PROBLEMA: módulos usam innerHTML com template literals.    ║
 * ║  Se qualquer dado do Firestore contiver HTML, há risco XSS. ║
 * ║                                                              ║
 * ║  SOLUÇÃO: helpers que sanitizam dados antes de inserir      ║
 * ║  no DOM, com API conveniente para substituir innerHTML.     ║
 * ╚══════════════════════════════════════════════════════════════╝
 */

/**
 * Escapa caracteres HTML para uso seguro em innerHTML.
 * Equivalente ao `esc()` local de vários módulos — centralizado aqui.
 */
export function esc(str) {
  return String(str ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/**
 * Sanitiza um valor para uso como atributo HTML (data-*, id, class).
 * Remove caracteres que podem quebrar atributos.
 */
export function escAttr(str) {
  return String(str ?? '').replace(/['"<>&\n\r\t]/g, '');
}

/**
 * Cria um elemento HTML a partir de uma string de template segura.
 * Os valores interpolados em `values` são automaticamente escapados.
 *
 * Uso (template tag):
 *   const el = safeHtml`<div class="card">${titulo}</div>`;
 *   container.appendChild(el);
 *
 * Ou para obter a string:
 *   const html = safeHtml`<span>${nome}</span>`.outerHTML;
 */
export function safeHtml(strings, ...values) {
  const html = strings.reduce((acc, str, i) => {
    const val = values[i - 1];
    return acc + esc(val) + str;
  });
  const tpl = document.createElement('template');
  tpl.innerHTML = strings[0] + strings.slice(1).reduce((acc, str, i) => {
    return acc + esc(values[i]) + str;
  }, '');
  return tpl.content.firstElementChild || tpl.content;
}

/**
 * Insere HTML sanitizado em um container, substituindo o conteúdo.
 * Os valores nos placeholders são automaticamente escapados.
 *
 * Uso:
 *   setHtml(document.getElementById('card'), `<h2>${titulo}</h2>`, { titulo });
 *
 * @param {Element} el — elemento alvo
 * @param {string}  template — string HTML com ${chave} nos placeholders
 * @param {Object}  data — valores a interpolar (serão escapados)
 */
export function setHtml(el, template, data = {}) {
  if (!el) return;
  const html = template.replace(/\$\{(\w+)\}/g, (_, key) =>
    key in data ? esc(data[key]) : ''
  );
  el.innerHTML = html;
}

/**
 * Cria um nó de texto seguro (sem XSS por design).
 * Use para conteúdo puramente textual.
 */
export function setText(el, text) {
  if (!el) return;
  el.textContent = String(text ?? '');
}

/**
 * Define atributos de forma segura, ignorando keys inválidas.
 */
export function setAttrs(el, attrs) {
  if (!el || typeof attrs !== 'object') return;
  const SAFE_ATTRS = new Set([
    'id','class','style','title','href','src','alt','type','value',
    'disabled','checked','placeholder','data-action','data-arg0',
    'data-arg1','data-arg2','aria-label','aria-hidden','role',
    'tabindex','for','name','target','rel','download','accept',
  ]);
  for (const [k, v] of Object.entries(attrs)) {
    if (k.startsWith('data-') || SAFE_ATTRS.has(k)) {
      el.setAttribute(k, String(v ?? ''));
    }
  }
}

/**
 * Verifica se uma string contém HTML potencialmente perigoso.
 * Usado para logging/alertas em desenvolvimento.
 */
export function contemHtml(str) {
  return /<[a-z][\s\S]*>/i.test(String(str ?? ''));
}
