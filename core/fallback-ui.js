/**
 * ╔══════════════════════════════════════════════════════════════════════╗
 * ║  FISCAL NA OBRA v15.1 — core/fallback-ui.js                          ║
 * ║  Componente visual de fallback para módulos com falha               ║
 * ╚══════════════════════════════════════════════════════════════════════╝
 *
 * Exibe um card amigável no lugar do módulo quebrado, com:
 *  - mensagem de erro (modo dev) ou genérica (modo prod)
 *  - botão de recarregar
 *  - informações de diagnóstico (expansível)
 *  - indicador de módulos desativados vs com erro
 */

import EventBus from './EventBus.js';

const DEV_MODE = window.location.hostname === 'localhost' ||
                 window.location.hostname === '127.0.0.1' ||
                 window.location.search.includes('debug=1');

export const FallbackUI = {

  /**
   * Injeta o card de fallback dentro da página do módulo.
   *
   * @param {string}    pageId     — id do elemento <div class="pagina">
   * @param {string}    moduleId   — identificador do módulo
   * @param {Error|null} error     — erro original (ou null)
   * @param {boolean}   disabled  — se foi desativado manualmente
   */
  show(pageId, moduleId, error = null, disabled = false) {
    const page = document.getElementById(pageId);
    if (!page) return;

    // Sanitize moduleId to prevent injection in onclick handlers
    const safeModuleId = String(moduleId || '').replace(/[^a-zA-Z0-9\-_]/g, '');

    const title = disabled
      ? 'Módulo desativado'
      : 'Módulo temporariamente indisponível';

    const icon = disabled ? '🔒' : '⚠️';

    const devDetails = DEV_MODE && error ? `
      <details style="margin-top:12px;cursor:pointer">
        <summary style="font-size:11px;color:#9ca3af;user-select:none">🔍 Detalhes técnicos (modo dev)</summary>
        <pre style="margin-top:8px;padding:10px;background:#0d111a;border-radius:4px;font-size:10px;color:#ef4444;overflow-x:auto;white-space:pre-wrap;word-break:break-all;max-height:200px;overflow-y:auto">${this._esc(error?.stack || error?.message || String(error))}</pre>
      </details>` : '';

    const reloadBtn = disabled ? '' : `
      <button
        data-action="_FO_reloadModule" data-arg0="${safeModuleId}"
        style="margin-top:14px;padding:8px 20px;border:none;border-radius:6px;
               background:#2563eb;color:#fff;font-size:12px;font-weight:700;
               cursor:pointer;display:inline-flex;align-items:center;gap:6px;
               transition:background .2s"
        onmouseover="this.style.background='#1d4ed8'"
        onmouseout="this.style.background='#2563eb'">
        🔄 Tentar novamente
      </button>`;

    const reportBtn = `
      <button
        data-action="_FO_reportModule" data-arg0="${safeModuleId}"
        style="margin-top:14px;margin-left:8px;padding:8px 14px;border:1px solid #374151;border-radius:6px;
               background:transparent;color:#9ca3af;font-size:11px;cursor:pointer"
        onmouseover="this.style.color='#f1f5f9'"
        onmouseout="this.style.color='#9ca3af'">
        📋 Ver logs
      </button>`;

    const html = `
      <div class="fo-fallback-card" data-module="${safeModuleId}" style="
        margin:20px auto;
        max-width:560px;
        background:#1e2330;
        border:1px solid ${disabled ? '#374151' : '#7f1d1d'};
        border-left:4px solid ${disabled ? '#6b7280' : '#dc2626'};
        border-radius:8px;
        padding:24px 28px;
        font-family:'DM Sans',sans-serif;
        color:#f1f5f9;
      ">
        <div style="display:flex;align-items:flex-start;gap:14px">
          <div style="font-size:36px;line-height:1;flex-shrink:0">${icon}</div>
          <div style="flex:1">
            <div style="font-size:14px;font-weight:800;margin-bottom:6px;color:${disabled ? '#9ca3af' : '#fca5a5'}">${title}</div>
            <div style="font-size:12px;color:#9ca3af;line-height:1.6">
              O módulo <code style="background:#0d111a;padding:1px 6px;border-radius:3px;font-size:11px;color:#60a5fa">${safeModuleId}</code>
              ${disabled
                ? 'foi desativado pelo sistema. Recarregue a página para reativar.'
                : 'encontrou um erro e foi isolado para proteger o restante da aplicação.'
              }
            </div>
            ${error && !DEV_MODE ? `<div style="font-size:11px;color:#6b7280;margin-top:6px">Código: <code style="color:#9ca3af">${this._esc(error?.name || 'UnknownError')}</code></div>` : ''}
            ${devDetails}
            <div style="margin-top:4px">
              ${reloadBtn}
              ${reportBtn}
            </div>
          </div>
        </div>

        <!-- Barra de status inferior -->
        <div style="
          margin-top:16px;padding-top:12px;border-top:1px solid #2d3748;
          display:flex;align-items:center;gap:8px;font-size:10px;color:#6b7280;
        ">
          <div style="width:8px;height:8px;border-radius:50%;background:${disabled ? '#6b7280' : '#dc2626'};flex-shrink:0"></div>
          <span>${disabled ? 'Desativado' : 'Com falha'} · Os demais módulos continuam funcionando normalmente</span>
          <span style="margin-left:auto;font-family:monospace">${new Date().toLocaleTimeString('pt-BR')}</span>
        </div>
      </div>`;

    // Preserva conteúdo original (para restaurar após reload bem-sucedido)
    if (!page.dataset.originalContent) {
      page.dataset.originalContent = 'true';
    }

    // Injeta apenas o fallback card (preserva estrutura .pagina para o roteador)
    const existingFallback = page.querySelector('.fo-fallback-card');
    if (existingFallback) {
      existingFallback.outerHTML = html;
    } else {
      // Oculta conteúdo existente e adiciona fallback
      const wrapper = document.createElement('div');
      wrapper.className = 'fo-fallback-wrapper';
      wrapper.innerHTML = html;

      // Oculta cards existentes dentro da página
      page.querySelectorAll(':scope > .card, :scope > .dash-dark').forEach(el => {
        el.style.display = 'none';
        el.dataset.hiddenByFallback = '1';
      });

      page.appendChild(wrapper);
    }
  },

  /** Remove o fallback e restaura o conteúdo original da página. */
  clear(pageId) {
    const page = document.getElementById(pageId);
    if (!page) return;

    const wrapper = page.querySelector('.fo-fallback-wrapper');
    wrapper?.remove();

    const card = page.querySelector('.fo-fallback-card');
    card?.closest('.fo-fallback-wrapper')?.remove();

    // Restaura cards ocultos
    page.querySelectorAll('[data-hidden-by-fallback]').forEach(el => {
      el.style.display = '';
      delete el.dataset.hiddenByFallback;
    });
  },

  /** Exibe toast de aviso não-intrusivo (para falhas parciais/degraded). */
  toast(moduleId, message) {
    EventBus.emit('ui:toast', {
      msg:  `⚠️ [${moduleId}] ${message}`,
      tipo: 'warn',
    });
  },

  _esc(str) {
    return String(str || '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  },
};

export default FallbackUI;
