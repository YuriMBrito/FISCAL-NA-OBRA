/**
 * ╔══════════════════════════════════════════════════════════════╗
 * ║  FISCAL NA OBRA — components/sidebar.js                     ║
 * ║  Accordion EXCLUSIVO — apenas 1 grupo aberto por vez        ║
 * ║  Sem scroll vertical · Animação fluida · Lei 14.133/2021    ║
 * ╚══════════════════════════════════════════════════════════════╝
 *
 * LÓGICA DE ESTADO:
 *   _activeGroup: string | null
 *   → Clicar em grupo aberto   → fecha (null)
 *   → Clicar em grupo fechado  → abre este, fecha todos os outros
 *   → Navegar para uma página  → abre o grupo dela automaticamente
 */

import EventBus from '../core/EventBus.js';
import state    from '../core/state.js';
import router   from '../core/router.js';

// ── Grupos semânticos (Lei 14.133/2021) ──────────────────────────────────────
const SEMANTIC_GROUPS = [
  {
    id: 'dashboard',
    label: 'Dashboard',
    icon: '📊',
    singleton: true,
    pageIds: ['dashboard'],
  },
  {
    id: 'dash-global',
    label: 'Dashboard Global',
    icon: '🌐',
    singleton: true,
    pageIds: ['dash-global'],
  },
  {
    id: 'contrato',
    label: 'Contrato',
    icon: '📁',
    pageIds: ['obras-manager', 'responsaveis', 'prazos', 'riscos', 'aditivos', 'painel-contratual'],
  },
  {
    id: 'fiscalizacao',
    label: 'Fiscalização',
    icon: '🔍',
    pageIds: ['ocorrencias', 'notificacoes', 'sancoes', 'fiscal-obras'],
  },
  {
    id: 'execucao',
    label: 'Execução',
    icon: '🏗️',
    pageIds: ['boletim', 'memoria', 'chuva', 'diario', 'relatorio'],
  },
  {
    id: 'pac',
    label: 'PAC / Federal',
    icon: '🇧🇷',
    pageIds: ['sinapi', 'etapas-pac', 'relatorio-federal'],
  },
  {
    id: 'campo',
    label: 'Modo Campo',
    icon: '📱',
    singleton: true,
    pageIds: ['modo-campo'],
  },
  {
    id: 'qualidade',
    label: 'Qualidade',
    icon: '🔬',
    pageIds: ['checklist-tecnico', 'fotos-medicao', 'qualidade'],
  },
  {
    id: 'encerramento',
    label: 'Encerramento',
    icon: '✅',
    pageIds: ['recebimento'],
  },
  {
    id: 'registros',
    label: 'Documentos',
    icon: '📄',
    pageIds: ['documentos', 'historico', 'auditoria'],
  },
  {
    id: 'sistema',
    label: 'Sistema',
    icon: '⚙️',
    pageIds: ['usuarios', 'config', 'importacao', 'obras-concluidas', 'diagnostico', 'acesso-obra'],
  },
];

// Altura máxima do submenu aberto (px).
// Cobre o maior grupo (Sistema com 6 itens × ~38px + folga).
const SUBMENU_MAX_H = 300;

// ─────────────────────────────────────────────────────────────────────────────
export const SidebarComponent = {
  _routes:      [],
  _activeGroup: null, // ← ESTADO ÚNICO: id do grupo aberto ou null

  // ───────────────────────────────────────────────────────────────────────────
  init(routes = []) {
    this._routes = routes;

    // Restaura grupo ativo da sessão anterior
    try {
      const saved = localStorage.getItem('_fo_sidebar_active');
      if (saved) this._activeGroup = saved;
    } catch (_) {}

    this._render();
    this._bindEvents();
    this._updateObraInfo();
    // Expõe toggle global (usado nos onclick do HTML gerado)
    window._sidebarToggleGroup = (id) => this._toggle(id);

    // FIX-E3.5: filtro de busca em tempo real
    window._sidebarSearch = (termo) => {
      const q = (termo || '').toLowerCase().trim();
      const nav = document.querySelector('.sidebar-nav');
      if (!nav) return;

      if (!q) {
        // Sem busca: restaurar visibilidade normal
        nav.querySelectorAll('[data-nav-page]').forEach(el => {
          el.closest('li, [data-sidebar-item]')
            ? (el.closest('li, [data-sidebar-item]').style.display = '')
            : (el.style.display = '');
        });
        nav.querySelectorAll('[data-sidebar-group]').forEach(g => g.style.display = '');
        return;
      }

      // Com busca: mostrar apenas itens que correspondem e seus grupos
      nav.querySelectorAll('[data-sidebar-group]').forEach(group => {
        const items = group.querySelectorAll('[data-nav-page]');
        let algumVisivel = false;
        items.forEach(item => {
          const label = (item.textContent || '').toLowerCase();
          const match = label.includes(q);
          const li = item.closest('li') || item;
          li.style.display = match ? '' : 'none';
          if (match) algumVisivel = true;
        });
        // Mostrar/esconder grupo inteiro
        group.style.display = algumVisivel ? '' : 'none';
        // Abrir grupo se tiver resultado
        if (algumVisivel) {
          const submenu = group.querySelector('[data-sidebar-submenu]');
          if (submenu) submenu.style.maxHeight = '400px';
        }
      });
    };
  },

  // ── Accordion exclusivo ─────────────────────────────────────────────────
  // Abre o grupo clicado e fecha todos os outros.
  // Se já estava aberto, fecha (toggle off).
  _toggle(groupId) {
    const next = this._activeGroup === groupId ? null : groupId;
    this._activeGroup = next;

    try {
      if (next) localStorage.setItem('_fo_sidebar_active', next);
      else      localStorage.removeItem('_fo_sidebar_active');
    } catch (_) {}

    this._applyAccordionDOM(next);
  },

  // ── Abre o grupo de uma página sem toggle (navegar = sempre abre) ────────
  _openGroupOf(pageId) {
    const group = SEMANTIC_GROUPS.find(
      g => !g.singleton && g.pageIds.includes(pageId)
    );
    if (!group || this._activeGroup === group.id) return;
    this._activeGroup = group.id;
    try { localStorage.setItem('_fo_sidebar_active', group.id); } catch (_) {}
    this._applyAccordionDOM(group.id);
  },

  // ── Aplica estado de accordion a todos os grupos no DOM ─────────────────
  _applyAccordionDOM(openId) {
    SEMANTIC_GROUPS.forEach(g => {
      if (g.singleton) return;
      const isOpen  = g.id === openId;
      const itemsEl = document.querySelector(`[data-group-items="${g.id}"]`);
      const arrowEl = document.querySelector(`[data-arrow="${g.id}"]`);
      const btnEl   = document.querySelector(`[data-group="${g.id}"]`);
      if (!itemsEl) return;

      itemsEl.style.maxHeight = isOpen ? SUBMENU_MAX_H + 'px' : '0';
      if (arrowEl) arrowEl.style.transform = `rotate(${isOpen ? 90 : 0}deg)`;
      if (btnEl) {
        btnEl.setAttribute('aria-expanded', String(isOpen));
        // Cor do header do grupo: branco quando aberto, cinza quando fechado
        // (mas mantém branco se contém item ativo — tratado via classe CSS)
        const hasActive = btnEl.classList.contains('group-has-active');
        btnEl.style.color = (isOpen || hasActive) ? '#FFFFFF' : '#777777';
      }
    });
  },

  // ───────────────────────────────────────────────────────────────────────────
  _render() {
    const sidebar = document.getElementById('sidebar');
    if (!sidebar) return;

    const routeMap = {};
    this._routes.forEach(r => { routeMap[r.pageId] = r; });

    const activePageId = router.current || '';

    // Se nenhum grupo foi persistido, pré-seleciona o da página atual
    if (!this._activeGroup && activePageId) {
      const owner = SEMANTIC_GROUPS.find(
        g => !g.singleton && g.pageIds.includes(activePageId)
      );
      if (owner) this._activeGroup = owner.id;
    }

    // ── HTML ─────────────────────────────────────────────────────────────
    let html = `
      <div class="sidebar-brand" style="flex-shrink:0">
        <span class="sidebar-brand-icon">🏗️</span>
        <span class="sidebar-brand-text">Fiscal na Obra</span>
        <span style="font-size:8px;color:#555;margin-left:4px">β</span>
      </div>

      <div id="sidebar-obra-info" class="sidebar-obra-info"
        style="overflow:hidden;margin:0 8px 2px;max-width:100%;flex-shrink:0"></div>

      <nav class="sidebar-nav" style="
        flex: 1;
        overflow: hidden;
        display: flex;
        flex-direction: column;
        min-height: 0;
      ">
    `;

    // FIX-E3.5: campo de busca rápida na sidebar
    html += `
      <div style="padding:6px 8px 4px;flex-shrink:0">
        <div style="position:relative">
          <span style="position:absolute;left:9px;top:50%;transform:translateY(-50%);font-size:11px;color:#555;pointer-events:none">🔍</span>
          <input
            id="sidebar-search-input"
            type="text"
            placeholder="Buscar módulo..."
            autocomplete="off"
            oninput="window._sidebarSearch(this.value)"
            onfocus="this.select()"
            style="
              width:100%;box-sizing:border-box;
              padding:6px 8px 6px 26px;
              background:#1a1a1a;border:1px solid #2a2a2a;
              border-radius:6px;color:#ccc;
              font-size:11px;outline:none;
            "
          />
        </div>
      </div>
    `;

        SEMANTIC_GROUPS.forEach(group => {
      const items = group.pageIds
        .map(pid => routeMap[pid])
        .filter(Boolean)
        .sort((a, b) => (a.navOrder || 99) - (b.navOrder || 99));

      if (items.length === 0) return;

      const isOpen    = this._activeGroup === group.id;
      const hasActive = items.some(r => r.pageId === activePageId);

      // ── Singleton (Dashboard direto, sem accordion) ──────────────────
      if (group.singleton) {
        items.forEach(r => {
          html += `
            <button
              class="sidebar-item${r.pageId === activePageId ? ' ativo' : ''}"
              data-nav-page="${r.pageId}"
              data-tip="${r.label}"
              style="flex-shrink:0"
              data-action="verPagina" data-arg0="${r.pageId}">
              <span class="nav-icon">${r.icon || '📄'}</span>
              <span class="nav-label">${r.label}</span>
            </button>`;
        });
        return;
      }

      // ── Botão do grupo ───────────────────────────────────────────────
      html += `<div data-sidebar-group="${group.id}">`;
      html += `
        <button
          class="sidebar-group-btn${hasActive ? ' group-has-active' : ''}"
          data-group="${group.id}"
          aria-expanded="${isOpen}"
          data-action="_sidebarToggleGroup" data-arg0="${group.id}"
          style="
            background: ${isOpen || hasActive ? 'rgba(255,255,255,.06)' : 'none'};
            border: none;
            border-left: 3px solid ${hasActive ? '#FFFFFF' : 'transparent'};
            color: ${isOpen || hasActive ? '#FFFFFF' : '#777777'};
            padding: 9px 14px;
            cursor: pointer;
            font-family: var(--font-sans);
            font-size: 10px;
            font-weight: 700;
            white-space: nowrap;
            width: 100%;
            text-align: left;
            display: flex;
            align-items: center;
            gap: 10px;
            border-radius: 0 8px 8px 0;
            margin: 1px 0;
            letter-spacing: .5px;
            text-transform: uppercase;
            transition: background .15s, color .15s, border-color .15s;
            flex-shrink: 0;
          ">
          <span class="nav-icon" style="font-size:14px">${group.icon}</span>
          <span class="nav-label" style="flex:1;font-size:10px">${group.label}</span>
          <span
            data-arrow="${group.id}"
            style="
              font-size: 8px;
              color: #555;
              flex-shrink: 0;
              transition: transform .22s cubic-bezier(.4,0,.2,1);
              transform: rotate(${isOpen ? 90 : 0}deg);
            ">▶</span>
        </button>

        <div
          data-group-items="${group.id}"
          data-sidebar-submenu
          style="
            overflow: hidden;
            max-height: ${isOpen ? SUBMENU_MAX_H + 'px' : '0'};
            transition: max-height .25s cubic-bezier(.4,0,.2,1);
            flex-shrink: 0;
          ">`;

      items.forEach(r => {
        html += `
          <button
            class="sidebar-item${r.pageId === activePageId ? ' ativo' : ''}"
            data-nav-page="${r.pageId}"
            data-tip="${r.label}"
            data-action="verPagina" data-arg0="${r.pageId}"
            style="padding-left:26px;font-size:12px;flex-shrink:0">
            <span class="nav-icon" style="font-size:13px">${r.icon || '📄'}</span>
            <span class="nav-label">${r.label}</span>
          </button>`;
      });

      html += `</div>`; // fecha data-group-items
      html += `</div>`; // fecha data-sidebar-group (FIX-E3.5)
    });

    html += `
      </nav>

      <div class="sidebar-footer" style="flex-shrink:0">

        <div class="sidebar-user-card" id="sidebar-user-card">
          <div class="sidebar-user-avatar" id="sidebar-user-avatar">👤</div>
          <div class="sidebar-user-meta">
            <div class="sidebar-user-name" id="sidebar-user-info">Não logado</div>
            <div class="sidebar-user-role" id="sidebar-user-role"></div>
          </div>
          <button class="sidebar-logout-btn" id="sidebar-logout-btn" title="Sair da conta">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none"
              stroke="currentColor" stroke-width="2.2"
              stroke-linecap="round" stroke-linejoin="round">
              <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/>
              <polyline points="16 17 21 12 16 7"/>
              <line x1="21" y1="12" x2="9" y2="12"/>
            </svg>
          </button>
        </div>
      </div>
    `;

    sidebar.innerHTML = html;
  },

  // ───────────────────────────────────────────────────────────────────────────
  _bindEvents() {
    EventBus.on('obra:selecionada', () => this._updateObraInfo(), 'sidebar');
    EventBus.on('config:salva',     () => this._updateObraInfo(), 'sidebar');
    EventBus.on('auth:login',  ({ user }) => this._updateUserInfo(user),  'sidebar');
    EventBus.on('auth:logout', ()         => this._updateUserInfo(null),  'sidebar');



    document.getElementById('sidebar-logout-btn')?.addEventListener('click', () => {
      window._logoutConfirm?.();
    });

    // Ao navegar: marca item ativo + abre grupo correto (accordion exclusivo)
    EventBus.on('ui:pagina', ({ pageId }) => {
      document.querySelectorAll('[data-nav-page]').forEach(el => {
        el.classList.toggle('ativo', el.dataset.navPage === pageId);
      });
      this._openGroupOf(pageId);
    }, 'sidebar');
  },

  // ───────────────────────────────────────────────────────────────────────────
  _updateObraInfo() {
    const el = document.getElementById('sidebar-obra-info');
    if (!el) return;
    const cfg  = state.get('cfg') || {};
    const nome = cfg.objeto || 'Nenhuma obra ativa';
    el.className = 'sidebar-obra-info';
    el.innerHTML = `
      <div class="sidebar-obra-label">Obra Selecionada</div>
      <div class="sidebar-obra-title">${nome}</div>
      ${cfg.contrato   ? `<div class="sidebar-obra-contrato">${cfg.contrato}</div>` : ''}
      ${cfg.contratada ? `<div class="sidebar-obra-contrato">${cfg.contratada.slice(0, 30)}</div>` : ''}
    `;
  },

  // ───────────────────────────────────────────────────────────────────────────
  _updateUserInfo(user) {
    const nameEl   = document.getElementById('sidebar-user-info');
    const avatarEl = document.getElementById('sidebar-user-avatar');
    const roleEl   = document.getElementById('sidebar-user-role');
    const logoutEl = document.getElementById('sidebar-logout-btn');
    if (!nameEl) return;
    if (user) {
      const email    = user.email || '';
      const username = email.split('@')[0] || '👤';
      const initial  = username[0]?.toUpperCase() || '?';
      nameEl.textContent = username;
      if (avatarEl) avatarEl.textContent = initial;
      if (roleEl)   roleEl.textContent   = email;
      if (logoutEl) logoutEl.style.display = 'flex';
    } else {
      nameEl.textContent = 'Não logado';
      if (avatarEl) avatarEl.textContent = '👤';
      if (roleEl)   roleEl.textContent   = '';
      if (logoutEl) logoutEl.style.display = 'none';
    }
  },
};

export default SidebarComponent;
