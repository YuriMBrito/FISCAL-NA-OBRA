/**
 * ╔══════════════════════════════════════════════════════════════╗
 * ║  FISCAL NA OBRA v15.1 — components/topbar.js                 ║
 * ║  Barra superior com seletor de obras, undo/redo, status     ║
 * ╚══════════════════════════════════════════════════════════════╝
 *
 * CORREÇÃO APLICADA:
 *
 *  BUG — Classes CSS erradas na barra superior
 *
 *  O arquivo original gerava HTML com classes que não existem no CSS:
 *    ❌ <div class="topbar-left">        → inexistente no CSS
 *    ❌ <div class="topbar-obra-sel">    → inexistente no CSS
 *    ❌ <div class="topbar-right">       → inexistente no CSS
 *    ❌ <button class="topbar-btn">      → inexistente no CSS
 *    ❌ <div class="topbar-fb-status">   → inexistente no CSS
 *    ❌ <div class="topbar-user">        → inexistente no CSS
 *    ❌ id="topbar-obra-select"          → CSS espera id="sel-obra"
 *    ❌ id="topbar-nova-obra"            → botão sem estilo
 *
 *  O CSS (main.css) espera:
 *    ✅ <div class="header-logo-section">   → logo + título
 *    ✅ <div class="header-obra-center">    → seletor de obra no centro
 *    ✅ <select id="sel-obra">             → select estilizado pelo CSS
 *    ✅ <button class="hd-obra-btn">       → botões de ação da obra
 *    ✅ <div class="header-actions">       → botões de ação à direita
 *    ✅ <button class="header-btn">        → cada botão de ação
 *
 *  Resultado do bug: seletor de obra invisível, botões espalhados,
 *  layout da barra completamente quebrado.
 */

import EventBus        from '../core/EventBus.js';
import state           from '../core/state.js';
import router          from '../core/router.js';
import FirebaseService from '../firebase/firebase-service.js';

export const TopbarComponent = {
  init() {
    const topbar = document.getElementById('topbar');
    if (!topbar) return;
    this._render(topbar);
    this._bindEvents();
  },

  _render(topbar) {
    topbar.innerHTML = `
      <!-- ESQUERDA: controle de UI -->
      <div class="header-logo-section">
        <button class="header-btn" id="topbar-menu-btn" title="Recolher/expandir menu" style="font-size:18px;padding:6px 10px">☰</button>
        <div class="header-logo-icon">🏗️</div>
        <h1>Fiscal na Obra</h1>
        <span class="header-version-badge">v13</span>
      </div>

      <!-- CENTRO: obra ativa + seletor -->
      <div class="header-obra-center">
        <select id="sel-obra" title="Trocar obra">
          <option value="">Nenhuma obra</option>
        </select>
        <span id="topbar-obra-resumo" style="font-size:10px;color:rgba(255,255,255,.55);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:320px"></span>
      </div>

      <!-- DIREITA: BM atual + notificações + usuário -->
      <div class="header-actions">
        <div id="topbar-bm-info" style="display:flex;align-items:center;gap:4px;font-size:10px;color:rgba(255,255,255,.6);padding:0 8px;border-right:1px solid rgba(255,255,255,.12);margin-right:4px;white-space:nowrap">
          <span style="font-size:12px">📋</span>
          <span id="topbar-bm-label">—</span>
        </div>
        <button class="header-btn" id="topbar-notif-btn" title="Notificações" data-action="verPagina" data-arg0="notificacoes" style="position:relative">
          🔔<span id="topbar-notif-badge" style="display:none;position:absolute;top:1px;right:1px;min-width:16px;height:16px;padding:0 4px;border-radius:8px;background:#ef4444;color:#fff;font-size:9px;font-weight:700;line-height:16px;text-align:center;box-sizing:border-box"></span>
        </button>
        <button class="header-btn" id="topbar-fb-status" title="Status Firebase">🔴</button>
        <button class="header-btn" id="topbar-fullscreen" title="Tela cheia">⛶</button>
        <button id="topbar-nova-obra" title="Inserir nova obra" style="background:rgba(255,255,255,.10);border:1px solid rgba(255,255,255,.18);border-radius:8px;color:rgba(255,255,255,.85);cursor:pointer;height:34px;padding:0 12px;font-size:11px;font-weight:700;letter-spacing:.3px;display:flex;align-items:center;gap:5px;white-space:nowrap;transition:all .15s">➕ Inserir Obra</button>
        <div class="header-btn" id="topbar-user" title="Usuário" style="cursor:pointer">👤</div>
        <button id="topbar-logout-btn" title="Sair da conta" data-action="_logoutConfirm"
          style="display:inline-flex;align-items:center;gap:5px;padding:5px 11px;border-radius:7px;border:1px solid rgba(255,255,255,.15);background:transparent;color:rgba(255,255,255,.6);font-size:11px;font-weight:600;cursor:pointer;transition:all .15s;white-space:nowrap"
          onmouseover="this.style.background='rgba(220,38,38,.15)';this.style.borderColor='rgba(220,38,38,.4)';this.style.color='#fca5a5'"
          onmouseout="this.style.background='transparent';this.style.borderColor='rgba(255,255,255,.15)';this.style.color='rgba(255,255,255,.6)'">
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
            <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><polyline points="16 17 21 12 16 7"/><line x1="21" y1="12" x2="9" y2="12"/>
          </svg>
          Sair
        </button>
      </div>
    `;
  },

  _bindEvents() {
    // Toggle sidebar — modo mini (só ícones) com persistência
    const _sidebarEl = () => document.getElementById('sidebar');
    // Restaura estado salvo
    try {
      if (localStorage.getItem('_fo_sidebar_mini') === '1') {
        _sidebarEl()?.classList.add('mini');
      }
    } catch(_) {}

    document.getElementById('topbar-menu-btn')?.addEventListener('click', () => {
      const sidebar = _sidebarEl();
      if (!sidebar) return;
      sidebar.classList.toggle('mini');
      const isMini = sidebar.classList.contains('mini');
      try { localStorage.setItem('_fo_sidebar_mini', isMini ? '1' : '0'); } catch(_) {}
    });

    // Firebase status — ouve evento E verifica estado atual ao inicializar
    EventBus.on('firebase:conectado',    () => this._setFbStatus(true),  'topbar');
    EventBus.on('firebase:desconectado', () => this._setFbStatus(false), 'topbar');
    // Se Firebase já estava conectado antes da topbar registrar o listener
    import('../../firebase/firebase-service.js').then(({ default: FB }) => {
      if (FB._ready) this._setFbStatus(true);
    }).catch(() => {});

    // Nova obra — abre direto no formulário de cadastro
    document.getElementById('topbar-nova-obra')?.addEventListener('click', () => {
      router.navigate('obras-manager');
      setTimeout(() => {
        const tabNova = document.getElementById('obm-tab-nova');
        if (tabNova) tabNova.click();
      }, 150);
    });

    // Troca de obra pelo select — carrega dados completos antes de notificar módulos
    document.getElementById('sel-obra')?.addEventListener('change', async (e) => {
      const id = e.target.value;
      if (!id) return;

      state.set('obraAtivaId', id);
      state.persist(['obraAtivaId']);

      const selEl = document.getElementById('sel-obra');
      if (selEl) selEl.disabled = true;

      try {
        const [cfg, bms, itens] = await Promise.all([
          FirebaseService.getObraCfg(id).catch(() => null),
          FirebaseService.getBMs(id).catch(() => null),
          FirebaseService.getItens(id).catch(() => null),
        ]);
        if (cfg)               state.set('cfg', cfg);
        if (bms  && bms.length)   state.set('bms', bms);
        if (itens && itens.length) state.set('itensContrato', itens);
      } catch (err) {
        console.error('[Topbar] Erro ao carregar obra:', err);
      } finally {
        if (selEl) selEl.disabled = false;
      }

      EventBus.emit('obra:selecionada', { obraId: id });

      const rotaAtual = router.current;
      if (rotaAtual) {
        setTimeout(() => { try { router.navigate(rotaAtual); } catch(e2) {} }, 80);
      }
    });

    // Atualiza lista de obras no select
    EventBus.on('obras:lista-atualizada', () => this._updateObraSelect(), 'topbar');
    EventBus.on('obra:selecionada',       () => { this._updateObraSelect(); this._updateObraResumo(); this._updateBmInfo(); }, 'topbar');
    EventBus.on('obra:criada',            () => this._updateObraSelect(), 'topbar');
    EventBus.on('obra:excluida',          () => this._updateObraSelect(), 'topbar');
    EventBus.on('config:salva',           () => this._updateObraResumo(), 'topbar');
    EventBus.on('boletim:atualizado',     () => this._updateBmInfo(), 'topbar');
    EventBus.on('medicao:salva',          () => this._updateBmInfo(), 'topbar');

    // Auth — exibe nome do usuário logado
    EventBus.on('auth:login', ({ user }) => {
      const el = document.getElementById('topbar-user');
      if (el) el.textContent = user.email?.split('@')[0] || '👤';
    }, 'topbar');
    EventBus.on('auth:logout', () => {
      const el = document.getElementById('topbar-user');
      if (el) el.textContent = '👤';
    }, 'topbar');

    // Tela cheia
    document.getElementById('topbar-fullscreen')?.addEventListener('click', () => {
      if (!document.fullscreenElement) {
        document.documentElement.requestFullscreen().catch(() => {});
      } else {
        document.exitFullscreen().catch(() => {});
      }
    });

    // Carrega dados iniciais
    this._updateObraSelect();
    this._updateObraResumo();
    this._updateBmInfo();
    // FIX-NOTIF: atualiza badge de notificações com contagem real
    this._updateNotifBadge();
    EventBus.on('notificacao:salva',       () => this._updateNotifBadge(), 'topbar');
    EventBus.on('notificacao:excluida',    () => this._updateNotifBadge(), 'topbar');
    EventBus.on('notificacoes:carregadas', () => this._updateNotifBadge(), 'topbar');
    EventBus.on('obra:selecionada',        () => this._updateNotifBadge(), 'topbar:notif');
    EventBus.on('auth:login',              () => this._updateNotifBadge(), 'topbar:notif-login');
  },

  _updateObraSelect() {
    const sel = document.getElementById('sel-obra');
    if (!sel) return;

    const obras = state.get('obrasLista') || [];
    const ativa = state.get('obraAtivaId') || '';
    const ativas = obras.filter(o => o.statusObra !== 'concluida');

    sel.innerHTML = ativas.length
      ? ativas.map(o =>
          `<option value="${o.id}" ${o.id === ativa ? 'selected' : ''}>
            ${(o.nome || o.id).slice(0, 40)}
          </option>`
        ).join('')
      : '<option value="">Nenhuma obra cadastrada</option>';
  },

  /** Mostra resumo da obra ativa no centro da topbar */
  _updateObraResumo() {
    const el = document.getElementById('topbar-obra-resumo');
    if (!el) return;
    const cfg = state.get('cfg') || {};
    const parts = [];
    if (cfg.contrato) parts.push(`Contrato ${cfg.contrato}`);
    if (cfg.contratada) parts.push(cfg.contratada.slice(0, 25));
    el.textContent = parts.join(' · ') || '';
  },

  /** Mostra BM atual e data no canto direito */
  _updateBmInfo() {
    const el = document.getElementById('topbar-bm-label');
    if (!el) return;
    const bms = state.get('bms') || [];
    if (!bms.length) { el.textContent = '—'; return; }
    const lastBm = bms[bms.length - 1];
    el.textContent = `${lastBm.label || 'BM ' + lastBm.num}${lastBm.data ? ' · ' + lastBm.data : ''}`;
  },

  /** Atualiza o badge de notificações com a contagem de pendentes (não resolvidas).
   *
   * CORREÇÃO BUG-GHOST-NOTIF:
   * Antes: contava ALL notifs → badge mostrava número mesmo sem nada pendente.
   * Agora: conta apenas notifs em estado ativo (emitida, enviada, em_analise, nao_resp).
   * Notificações encerradas/respondidas não geram badge — usuário já as tratou.
   */
  _updateNotifBadge() {
    const badge = document.getElementById('topbar-notif-badge');
    if (!badge) return;
    try {
      const notifs = state.get('notificacoes') || [];
      // Apenas estados que exigem atenção do fiscal
      const ESTADOS_PENDENTES = new Set(['emitida', 'enviada', 'em_analise', 'nao_resp']);
      const pendentes = Array.isArray(notifs)
        ? notifs.filter(n => ESTADOS_PENDENTES.has(n.status)).length
        : 0;

      if (pendentes > 0) {
        badge.textContent   = pendentes > 99 ? '99+' : String(pendentes);
        badge.style.display = 'inline-block';
      } else {
        badge.style.display = 'none';
        badge.textContent   = '';
      }
    } catch (_) {
      badge.style.display = 'none';
    }
  },

  _setFbStatus(connected) {
    const el = document.getElementById('topbar-fb-status');
    if (el) {
      el.textContent = connected ? '🟢' : '🔴';
      el.title = connected ? 'Firebase conectado' : 'Firebase desconectado — modo local';
    }
  },
};

export default TopbarComponent;
