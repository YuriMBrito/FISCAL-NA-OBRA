/**
 * ╔══════════════════════════════════════════════════════════════╗
 * ║  FISCAL NA OBRA v20 — utils/dom-patcher.js                 ║
 * ║  Problema 2 — Re-renderização completa do DOM              ║
 * ╚══════════════════════════════════════════════════════════════╝
 *
 * PROPÓSITO:
 *   Permite atualizar apenas o conteúdo TEXT de células/elementos
 *   específicos sem re-renderizar innerHTML de toda a tabela.
 *   Preserva foco, cursor e scroll durante edição.
 *
 * ESTRATÉGIA:
 *   1. patchText()   — Atualiza textContent de um elemento por ID
 *   2. patchRow()    — Atualiza um conjunto de células de uma linha
 *   3. guardFocus()  — Salva/restaura foco + cursor antes/depois de innerHTML
 *   4. smartSetHTML()— Aplica innerHTML só se o HTML mudou (evita flicker)
 *
 * USO (em atualizarDimensao):
 *   import { patchText, patchRow } from '../../utils/dom-patcher.js';
 *   patchText('mem-itemtotal-1.1', '12,34 m²');
 *   patchRow({ 'mem-lres-1.1-ln1': '5,00', 'mem-acum-1.1': '12,34' });
 *
 * USO (em renderBoletim / renderMemoria — forçado):
 *   import { guardFocus } from '../../utils/dom-patcher.js';
 *   guardFocus(() => { wrap.innerHTML = novoHTML; });
 */

// ── patchText ──────────────────────────────────────────────────────────────
/**
 * Atualiza o textContent de um elemento pelo seu ID.
 * NÃO dispara re-render, NÃO perde foco, NÃO faz scroll.
 *
 * @param {string} id        - ID do elemento (sem #)
 * @param {string} text      - Novo texto
 * @param {Object} [style]   - Propriedades CSS opcionais a aplicar
 * @returns {boolean}        - true se o elemento foi encontrado
 */
export function patchText(id, text, style = null) {
  const el = document.getElementById(id);
  if (!el) return false;
  const newText = String(text ?? '');
  if (el.textContent !== newText) {
    el.textContent = newText;
  }
  if (style) {
    Object.assign(el.style, style);
  }
  return true;
}

// ── patchRow ───────────────────────────────────────────────────────────────
/**
 * Atualiza múltiplas células de uma só vez, em batch, sem perder foco.
 *
 * @param {Object} updates - { elementId: novoTexto, ... }
 * @param {Object} [styles] - { elementId: { color: '...' }, ... }
 */
export function patchRow(updates = {}, styles = {}) {
  Object.entries(updates).forEach(([id, text]) => {
    patchText(id, text, styles[id] || null);
  });
}

// ── guardFocus ─────────────────────────────────────────────────────────────
/**
 * Salva o estado de foco/seleção atual, executa fn(), e restaura o foco.
 * Use sempre que for inevitável usar innerHTML em um container.
 *
 * @param {Function} fn - Função que vai alterar o DOM (ex: innerHTML =)
 */
export function guardFocus(fn) {
  const active = document.activeElement;
  let savedId       = null;
  let savedStart    = null;
  let savedEnd      = null;
  let savedDataAttrs = null;

  // Captura identificadores do input ativo
  if (active && (active.tagName === 'INPUT' || active.tagName === 'TEXTAREA')) {
    savedId        = active.id || null;
    savedDataAttrs = { ...active.dataset };
    try {
      savedStart = active.selectionStart;
      savedEnd   = active.selectionEnd;
    } catch (_) { /* selectionStart pode lançar em alguns tipos */ }
  }

  // Executa a função que altera o DOM
  try { fn(); } catch (e) { throw e; }

  // Restaura foco se havia input ativo
  if (!savedId && !savedDataAttrs) return;

  requestAnimationFrame(() => {
    let target = savedId ? document.getElementById(savedId) : null;

    // Fallback: tenta achar pelo dataset (útil para inputs dinâmicos sem ID fixo)
    if (!target && savedDataAttrs && Object.keys(savedDataAttrs).length) {
      const selector = Object.entries(savedDataAttrs)
        .map(([k, v]) => `[data-${k.replace(/([A-Z])/g, '-$1').toLowerCase()}="${CSS.escape(v)}"]`)
        .join('');
      try { target = document.querySelector(selector); } catch (_) {}
    }

    if (target) {
      target.focus({ preventScroll: true });
      if (savedStart !== null) {
        try { target.setSelectionRange(savedStart, savedEnd ?? savedStart); } catch (_) {}
      }
    }
  });
}

// ── smartSetHTML ───────────────────────────────────────────────────────────
/**
 * Define innerHTML apenas se o HTML realmente mudou.
 * Evita re-renders desnecessários e perda de foco em atualizações idempotentes.
 *
 * @param {HTMLElement} el  - Elemento alvo
 * @param {string}      html - Novo HTML
 * @returns {boolean}    true se o HTML foi alterado
 */
export function smartSetHTML(el, html) {
  if (!el) return false;
  if (el.innerHTML === html) return false; // Nada mudou
  guardFocus(() => { el.innerHTML = html; });
  return true;
}

// ── trackEditing ──────────────────────────────────────────────────────────
/**
 * Retorna true se o usuário está ativamente editando um input na tabela.
 * Usado para bloquear scrollIntoView durante digitação.
 *
 * @param {string} [containerSelector='.tabela-wrap'] - Seletor do container
 * @returns {boolean}
 */
export function isUserEditing(containerSelector = '.tabela-wrap, #mem-table-wrap, #bol-table-wrap') {
  const active = document.activeElement;
  if (!active) return false;
  if (active.tagName !== 'INPUT' && active.tagName !== 'TEXTAREA' && !active.isContentEditable) {
    return false;
  }
  // Verifica se o input está dentro de uma tabela do sistema
  return !!active.closest(containerSelector);
}
