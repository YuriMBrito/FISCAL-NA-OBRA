/**
 * ╔══════════════════════════════════════════════════════════════╗
 * ║  FISCAL NA OBRA v15.1 — components/topbar.js                  ║
 * ║  Barra superior com seletor de obras, undo/redo, status      ║
 * ╚══════════════════════════════════════════════════════════════╝
 */

import EventBus        from '../core/EventBus.js';
import state           from '../core/state.js';
import router          from '../core/router.js';
import FirebaseService from '../firebase/firebase-service.js';

export const TopbarComponent = {
  /** Inicializa o componente e renderiza no DOM */
  init() {
    const topbar = document.getElementById('topbar');
    if (!topbar) return;
    this._render(topbar);
    this._bindEvents();
  },

  /** * Renderiza o HTML utilizando as classes esperadas pelo design-system.css e main.css
   */
  _render(topbar) {
    topbar.innerHTML = `
      <div class="header-logo-section">
        <button class="header-btn" id="topbar-menu-btn" title="Recolher/expandir menu">
          <span style="font-size:18px">☰</span>
        </button>
        <div class="header-logo-icon">🏗️</div>
        <h1>Fiscal na Obra</h1>
        <span class="header-version-badge">v15.1</span>
      </div>

      <div class="header-obra-center">
        <select id="sel-obra" title="Trocar obra ativa">
          <option value="">Carregando obras...</option>
        </select>
        <div id="topbar-obra-resumo" class="header-obra-subtitle"></div>
      </div>

      <div class="header-actions">
        <div id="topbar-bm-info" class="header-status-item">
          <span style="font-size:14px">📋</span>
          <span id="topbar-bm-label">Sem medição</span>
        </div>

        <button class="header-btn" id="topbar-notif-btn" title="Notificações" data-action="verPagina" data-arg0="notificacoes">
          🔔<span id="topbar-notif-badge" class="notification-badge" style="display:none"></span>
        </button>
        
        <button class="header-btn" id="topbar-fb-status" title="Status Firebase">🔴</button>
        <button class="header-btn" id="topbar-fullscreen" title="Tela cheia">⛶</button>
        
        <button id="topbar-nova-obra" class="hd-obra-btn">
          <span>➕</span> Inserir Obra
        </button>

        <div class="header-user-block">
          <div class="header-btn" id="topbar-user" title="Perfil do Usuário">👤</div>
          <button id="topbar-logout-btn" class="header-logout-btn" data-action="_logoutConfirm">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
              <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><polyline points="16 17 21 12 16 7"/><line x1="21" y1="12" x2="9" y2="12"/>
            </svg>
            Sair
          </button>
        </div>
      </div>
    `;
  },

  /** Vincula eventos de clique, mudanças de estado e listeners do EventBus */
  _bindEvents() {
    // 1. Controle da Sidebar (Mini/Expandida)
    const sidebar = document.getElementById('sidebar');
    if (sidebar && localStorage.getItem('_fo_sidebar_mini') === '1') {
      sidebar.classList.add('mini');
    }

    document.getElementById('topbar-menu-btn')?.addEventListener('click', () => {
      const sb = document.getElementById('sidebar');
      if (!sb) return;
      sb.classList.toggle('mini');
      localStorage.setItem('_fo_sidebar_mini', sb.classList.contains('mini') ? '1' : '0');
    });

    // 2. Status de Conexão Firebase
    EventBus.on('firebase:conectado',
