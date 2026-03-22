/**
 * ╔══════════════════════════════════════════════════════════════╗
 * ║  FISCAL NA OBRA v15.1 — modules/acesso-obra/acesso-obra-controller.js ║
 * ║  Módulo: AcessoObraModule — Gerenciar Acesso à Obra         ║
 * ╚══════════════════════════════════════════════════════════════╝
 *
 * Permite ao CRIADOR (owner) da obra conceder/revogar acesso
 * para outros usuários cadastrados no sistema.
 *
 * Renderiza dentro do card #cfg-acesso-obra-container na página config.
 * Segue o padrão modular existente (EventBus, state, FirebaseService).
 */

import EventBus        from '../../core/EventBus.js';
import state           from '../../core/state.js';
import router          from '../../core/router.js';
import FirebaseService from '../../firebase/firebase-service.js';

// ── Perfis disponíveis para acesso compartilhado ────────────────
const PERFIS_ACESSO = [
  { k: 'editor',       l: 'Editor',         desc: 'Pode visualizar e editar dados da obra' },
  { k: 'visualizador', l: 'Somente leitura', desc: 'Pode apenas visualizar os dados da obra' },
];

// ── Sanitização HTML básica ─────────────────────────────────────
function esc(s) {
  return String(s ?? '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

export class AcessoObraModule {
  constructor() {
    this._subs        = [];
    this._usuarios    = [];   // lista de usuários com acesso à obra atual
    this._buscando    = false;
    this._salvando    = false;
  }

  async init() {
    try { this._bindEvents(); this._exposeGlobals(); }
    catch (e) { console.error('[AcessoObraModule] init:', e); }
  }

  onEnter() {
    try { this._render(); }
    catch (e) { console.error('[AcessoObraModule] onEnter:', e); }
  }

  // ═══════════════════════════════════════════════════════════════
  //  VERIFICAÇÃO DE PERMISSÃO
  // ═══════════════════════════════════════════════════════════════

  /** Retorna true se o usuário logado é o criador (owner) da obra ativa. */
  _souDono() {
    const obraId   = state.get('obraAtivaId');
    const user     = FirebaseService.currentUser();
    const obras    = state.get('obrasLista') || [];
    const obra     = obras.find(o => o.id === obraId);
    if (!obraId || !user || !obra) return false;
    return obra.uid === user.uid;
  }

  // ═══════════════════════════════════════════════════════════════
  //  RENDER PRINCIPAL
  // ═══════════════════════════════════════════════════════════════

  async _render() {
    const container = document.getElementById('cfg-acesso-obra-container');
    if (!container) return;

    const obraId = state.get('obraAtivaId');
    if (!obraId) {
      container.innerHTML = '';
      return;
    }

    // Carrega lista de usuários com acesso
    await this._carregarAcesso(obraId);

    const souDono = this._souDono();

    container.innerHTML = `
      <div class="card" style="border:2px solid #6366f118">
        <div style="display:flex;align-items:center;justify-content:space-between;
            flex-wrap:wrap;gap:8px;margin-bottom:16px">
          <div style="display:flex;align-items:center;gap:10px">
            <div style="width:34px;height:34px;background:#6366f118;border:1px solid #6366f144;
                border-radius:9px;display:flex;align-items:center;justify-content:center;font-size:17px">🔐</div>
            <div>
              <div class="titulo-secao" style="margin:0;border:none;padding:0">
                Gerenciar Acesso à Obra
              </div>
              <div style="font-size:11px;color:var(--text-muted);margin-top:2px">
                ${souDono
                  ? 'Conceda ou revogue acesso a outros usuários cadastrados no sistema.'
                  : 'Usuários com acesso a esta obra.'}
              </div>
            </div>
          </div>
          ${souDono ? `
            <button class="btn btn-cinza btn-sm" data-action="_acessoObra_atualizarLista">
              🔄 Atualizar
            </button>` : ''}
        </div>

        ${souDono ? this._renderFormBusca() : ''}
        ${this._renderListaAcesso(souDono)}
      </div>`;
  }

  // ── Formulário de busca / adição ─────────────────────────────
  _renderFormBusca() {
    return `
      <div id="acesso-form-busca"
          style="background:var(--bg-surface);border:1px solid var(--border);
                 border-radius:10px;padding:16px;margin-bottom:16px">
        <div style="font-size:11px;font-weight:700;text-transform:uppercase;
            letter-spacing:.5px;color:var(--text-muted);margin-bottom:12px">
          ➕ Conceder acesso a usuário
        </div>

        <div style="display:grid;grid-template-columns:1fr auto auto;gap:10px;align-items:end">
          <div>
            <label style="font-size:11px;font-weight:700;color:var(--text-muted);
                display:block;margin-bottom:5px">E-mail do usuário *</label>
            <input id="acesso-email-input" type="email"
              placeholder="usuario@sistema.com"
              style="width:100%;box-sizing:border-box;padding:9px 12px;border-radius:7px;
                border:1px solid var(--border);background:var(--bg-card);
                color:var(--text-primary);font-size:13px;outline:none"
              onkeydown="if(event.key==='Enter') window._acessoObra_buscarEmail?.()">
          </div>
          <div>
            <label style="font-size:11px;font-weight:700;color:var(--text-muted);
                display:block;margin-bottom:5px">Perfil de acesso</label>
            <select id="acesso-perfil-select"
              style="padding:9px 12px;border-radius:7px;border:1px solid var(--border);
                background:var(--bg-card);color:var(--text-primary);font-size:13px;
                white-space:nowrap">
              ${PERFIS_ACESSO.map(p =>
                `<option value="${p.k}">${p.l} — ${p.desc}</option>`
              ).join('')}
            </select>
          </div>
          <button id="acesso-btn-buscar" data-action="_acessoObra_buscarEmail"
            style="padding:9px 18px;background:var(--accent);border:none;border-radius:7px;
              color:#fff;font-size:13px;font-weight:700;cursor:pointer;white-space:nowrap;
              transition:opacity .15s"
            title="Buscar e conceder acesso">
            🔍 Buscar
          </button>
        </div>

        <div id="acesso-busca-resultado" style="margin-top:12px"></div>
      </div>`;
  }

  // ── Lista de usuários com acesso ──────────────────────────────
  _renderListaAcesso(souDono) {
    const count = this._usuarios.length;
    if (!count) {
      return `
        <div style="text-align:center;padding:28px 16px;color:var(--text-muted);font-size:13px">
          <div style="font-size:32px;margin-bottom:10px">🔒</div>
          <div style="font-weight:600;margin-bottom:4px">
            ${souDono
              ? 'Nenhum acesso externo concedido'
              : 'Nenhum usuário compartilhado encontrado'}
          </div>
          <div style="font-size:12px">
            ${souDono
              ? 'Use o formulário acima para liberar o acesso da obra a outros usuários do sistema.'
              : 'Somente o criador da obra pode gerenciar acessos.'}
          </div>
        </div>`;
    }

    return `
      <div>
        <div style="font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:.5px;
            color:var(--text-muted);margin-bottom:10px">
          👥 Usuários com acesso (${count})
        </div>
        ${this._usuarios.map(u => this._cardUsuarioAcesso(u, souDono)).join('')}
      </div>`;
  }

  // ── Card de usuário com acesso ────────────────────────────────
  _cardUsuarioAcesso(u, souDono) {
    const iniciais = (u.nome || u.email || '?').split(' ').map(w => w[0]).slice(0, 2).join('').toUpperCase();
    const perfil   = PERFIS_ACESSO.find(p => p.k === u.perfil) || { l: u.perfil || 'Editor' };
    const cores    = ['#6366f1','#2563eb','#16a34a','#f59e0b','#ef4444'];
    const cor      = cores[(u.uid || u.email || '').charCodeAt(0) % cores.length];
    const data     = u.grantedAt
      ? new Date(u.grantedAt).toLocaleDateString('pt-BR')
      : '—';

    const badgeColor = u.perfil === 'visualizador'
      ? { bg:'#f0fdf4', border:'#86efac', text:'#15803d' }
      : { bg:'#eff6ff', border:'#bfdbfe', text:'#1d4ed8' };

    return `
      <div style="background:var(--bg-surface);border:1px solid var(--border);
          border-radius:10px;padding:13px 16px;margin-bottom:9px;
          display:flex;align-items:center;gap:12px">

        <!-- Avatar -->
        <div style="width:38px;height:38px;border-radius:50%;background:${cor}22;
            border:2px solid ${cor};display:flex;align-items:center;justify-content:center;
            font-size:13px;font-weight:800;color:${cor};flex-shrink:0">
          ${esc(iniciais)}
        </div>

        <!-- Info -->
        <div style="flex:1;min-width:0">
          <div style="font-size:13px;font-weight:700;color:var(--text-primary);
              overflow:hidden;text-overflow:ellipsis;white-space:nowrap">
            ${esc(u.nome || u.email || '—')}
          </div>
          <div style="font-size:11px;color:var(--text-muted);margin-top:1px">
            ${esc(u.email || '')}
            ${u.nome && u.email ? '' : ''}
            · Concedido em ${esc(data)}
          </div>
        </div>

        <!-- Badge perfil -->
        <span style="font-size:10px;font-weight:700;padding:3px 9px;border-radius:99px;
            background:${badgeColor.bg};color:${badgeColor.text};
            border:1px solid ${badgeColor.border};flex-shrink:0;white-space:nowrap">
          ${esc(perfil.l)}
        </span>

        <!-- Ação revogar (só para donos) -->
        ${souDono ? `
          <button data-action="_acessoObra_revogar" data-arg0="${esc(u.uid)}" style="padding:5px 11px;background:transparent;border:1px solid #fca5a5;
              border-radius:6px;color:#ef4444;font-size:11px;font-weight:600;
              cursor:pointer;flex-shrink:0;transition:all .15s"
            title="Revogar acesso de ${esc(u.nome || u.email)}"
            onmouseover="this.style.background='#fee2e2'"
            onmouseout="this.style.background='transparent'">
            🚫 Revogar
          </button>` : ''}
      </div>`;
  }

  // ═══════════════════════════════════════════════════════════════
  //  CARREGAR ACESSO DO FIREBASE
  // ═══════════════════════════════════════════════════════════════

  async _carregarAcesso(obraId) {
    try {
      const dados = await FirebaseService.getAcessoObra(obraId);
      this._usuarios = dados?.usuarios || [];
    } catch (e) {
      console.error('[AcessoObraModule] _carregarAcesso:', e);
      this._usuarios = [];
    }
  }

  // ═══════════════════════════════════════════════════════════════
  //  BUSCAR USUÁRIO POR EMAIL
  // ═══════════════════════════════════════════════════════════════

  async _buscarEmail() {
    if (!this._souDono()) {
      window.toast?.('⚠️ Apenas o criador da obra pode conceder acesso.', 'warn'); return;
    }
    if (this._buscando) return;

    const emailInput = document.getElementById('acesso-email-input');
    const resultEl   = document.getElementById('acesso-busca-resultado');
    const btnEl      = document.getElementById('acesso-btn-buscar');
    const email      = emailInput?.value?.trim()?.toLowerCase();

    if (!email) {
      window.toast?.('⚠️ Informe o e-mail do usuário.', 'warn');
      emailInput?.focus();
      return;
    }

    // Valida formato de e-mail
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      window.toast?.('⚠️ E-mail inválido.', 'warn');
      emailInput?.focus();
      return;
    }

    // Verifica se já tem acesso
    if (this._usuarios.some(u => u.email === email)) {
      if (resultEl) resultEl.innerHTML = `
        <div style="display:flex;align-items:center;gap:8px;padding:10px 14px;
            border-radius:8px;background:#fef3c7;border:1px solid #fcd34d;
            font-size:12px;color:#92400e">
          ⚠️ Este usuário já possui acesso a esta obra.
        </div>`;
      return;
    }

    // Verifica se é o próprio dono
    const currentUser = FirebaseService.currentUser();
    if (email === currentUser?.email?.toLowerCase()) {
      if (resultEl) resultEl.innerHTML = `
        <div style="display:flex;align-items:center;gap:8px;padding:10px 14px;
            border-radius:8px;background:#fef3c7;border:1px solid #fcd34d;
            font-size:12px;color:#92400e">
          ⚠️ Você é o criador da obra e já tem acesso completo.
        </div>`;
      return;
    }

    this._buscando = true;
    if (btnEl) { btnEl.disabled = true; btnEl.textContent = '⏳ Buscando...'; }
    if (resultEl) resultEl.innerHTML = `
      <div style="font-size:12px;color:var(--text-muted);padding:8px 0">⏳ Buscando usuário...</div>`;

    try {
      const usuario = await FirebaseService.buscarUsuarioPorEmail(email);

      if (!usuario) {
        if (resultEl) resultEl.innerHTML = `
          <div style="display:flex;align-items:center;gap:8px;padding:12px 14px;
              border-radius:8px;background:#fef2f2;border:1px solid #fca5a5;
              font-size:12px;color:#dc2626">
            <span style="font-size:16px">❌</span>
            <div>
              <div style="font-weight:700">Usuário não encontrado</div>
              <div style="margin-top:2px;color:#ef4444">
                O e-mail <strong>${esc(email)}</strong> não está cadastrado no sistema.
                O administrador precisa criar o usuário antes de conceder acesso.
              </div>
            </div>
          </div>`;
        return;
      }

      // Usuário encontrado — exibe card de confirmação
      const perfil = document.getElementById('acesso-perfil-select')?.value || 'editor';
      const perfilLabel = PERFIS_ACESSO.find(p => p.k === perfil)?.l || perfil;

      if (resultEl) resultEl.innerHTML = `
        <div style="display:flex;align-items:center;gap:12px;padding:12px 14px;
            border-radius:8px;background:#f0fdf4;border:1px solid #86efac">
          <div style="width:36px;height:36px;border-radius:50%;background:#dcfce7;
              border:2px solid #16a34a;display:flex;align-items:center;justify-content:center;
              font-size:13px;font-weight:800;color:#15803d;flex-shrink:0">
            ${esc((usuario.nome || usuario.email || '?').split(' ').map(w=>w[0]).slice(0,2).join('').toUpperCase())}
          </div>
          <div style="flex:1">
            <div style="font-size:13px;font-weight:700;color:#15803d">${esc(usuario.nome || usuario.email)}</div>
            <div style="font-size:11px;color:#166534">${esc(usuario.email)} · Perfil: ${esc(perfilLabel)}</div>
          </div>
          <button data-action="_acessoObra_conceder" data-arg0="${esc(usuario.uid)}" data-arg1="${esc(usuario.email)}" data-arg2="${esc(usuario.nome||'')}" data-arg3="${esc(perfil)}" style="padding:8px 16px;background:#16a34a;border:none;border-radius:7px;
              color:#fff;font-size:12px;font-weight:700;cursor:pointer;
              white-space:nowrap;transition:opacity .15s"
            onmouseover="this.style.opacity='.85'"
            onmouseout="this.style.opacity='1'">
            ✅ Conceder acesso
          </button>
        </div>`;

    } catch (err) {
      console.error('[AcessoObraModule] _buscarEmail:', err);
      if (resultEl) resultEl.innerHTML = `
        <div style="padding:10px 14px;border-radius:8px;background:#fef2f2;
            border:1px solid #fca5a5;font-size:12px;color:#dc2626">
          ❌ Erro ao buscar usuário: ${esc(err.message)}
        </div>`;
    } finally {
      this._buscando = false;
      if (btnEl) { btnEl.disabled = false; btnEl.textContent = '🔍 Buscar'; }
    }
  }

  // ═══════════════════════════════════════════════════════════════
  //  CONCEDER ACESSO
  // ═══════════════════════════════════════════════════════════════

  async _conceder(uid, email, nome, perfil) {
    if (!this._souDono()) {
      window.toast?.('⚠️ Apenas o criador da obra pode conceder acesso.', 'warn'); return;
    }
    if (this._salvando) return;

    const obraId = state.get('obraAtivaId');
    if (!obraId) { window.toast?.('⚠️ Nenhuma obra ativa.', 'warn'); return; }

    // Previne duplicata
    if (this._usuarios.some(u => u.uid === uid)) {
      window.toast?.('⚠️ Este usuário já possui acesso.', 'warn'); return;
    }

    this._salvando = true;
    try {
      const novoUsuario = {
        uid,
        email,
        nome:      nome || email,
        perfil:    perfil || 'editor',
        grantedAt: new Date().toISOString(),
        grantedBy: FirebaseService.currentUser()?.uid || '',
      };

      const novaLista = [...this._usuarios, novoUsuario];
      await FirebaseService.salvarAcessoObra(obraId, novaLista);
      this._usuarios = novaLista;

      // Limpa form
      const emailInput = document.getElementById('acesso-email-input');
      const resultEl   = document.getElementById('acesso-busca-resultado');
      if (emailInput) emailInput.value = '';
      if (resultEl)   resultEl.innerHTML = '';

      window.auditRegistrar?.({
        modulo: 'Acesso à Obra',
        tipo: 'concessão',
        registro: `Acesso concedido a: ${nome || email}`,
        detalhe: `UID: ${uid} | Perfil: ${perfil} | Obra: ${obraId}`,
      });

      window.toast?.(`✅ Acesso concedido a ${nome || email}!`, 'ok');
      this._render();
    } catch (err) {
      console.error('[AcessoObraModule] _conceder:', err);
      window.toast?.(`❌ Erro ao conceder acesso: ${err.message}`, 'err');
    } finally {
      this._salvando = false;
    }
  }

  // ═══════════════════════════════════════════════════════════════
  //  REVOGAR ACESSO
  // ═══════════════════════════════════════════════════════════════

  async _revogar(uid) {
    if (!this._souDono()) {
      window.toast?.('⚠️ Apenas o criador da obra pode revogar acesso.', 'warn'); return;
    }

    const obraId  = state.get('obraAtivaId');
    const usuario = this._usuarios.find(u => u.uid === uid);
    if (!obraId || !usuario) return;

    if (!confirm(`🚫 Revogar acesso de "${usuario.nome || usuario.email}"?\n\nEste usuário não poderá mais acessar esta obra.`)) return;

    try {
      const novaLista = this._usuarios.filter(u => u.uid !== uid);
      await FirebaseService.salvarAcessoObra(obraId, novaLista);
      this._usuarios = novaLista;

      window.auditRegistrar?.({
        modulo: 'Acesso à Obra',
        tipo: 'revogação',
        registro: `Acesso revogado de: ${usuario.nome || usuario.email}`,
        detalhe: `UID: ${uid} | Obra: ${obraId}`,
      });

      window.toast?.(`🚫 Acesso de ${usuario.nome || usuario.email} revogado.`, 'warn');
      this._render();
    } catch (err) {
      console.error('[AcessoObraModule] _revogar:', err);
      window.toast?.(`❌ Erro ao revogar acesso: ${err.message}`, 'err');
    }
  }

  // ═══════════════════════════════════════════════════════════════
  //  EVENTOS E GLOBALS
  // ═══════════════════════════════════════════════════════════════

  _bindEvents() {
    this._subs.push(
      EventBus.on('obra:selecionada', () => {
        try { if (router.current === 'config') this._render(); } catch(e){}
      }, 'acesso-obra'),
      EventBus.on('config:salva', () => {
        try { if (router.current === 'config') this._render(); } catch(e){}
      }, 'acesso-obra'),
    );
  }

  _exposeGlobals() {
    window._acessoObra_render         = ()           => { try { this._render();           } catch(e){} };
    window._acessoObra_buscarEmail    = ()           => { try { this._buscarEmail();       } catch(e){} };
    window._acessoObra_conceder       = (uid,em,nm,p)=> { try { this._conceder(uid,em,nm,p); } catch(e){} };
    window._acessoObra_revogar        = (uid)        => { try { this._revogar(uid);        } catch(e){} };
    window._acessoObra_atualizarLista = ()           => { try { this._render();           } catch(e){} };
  }

  destroy() { this._subs.forEach(u => u()); this._subs = []; }
}
