/**
 * ╔══════════════════════════════════════════════════════════════╗
 * ║  FISCAL NA OBRA v15 — fiscal-obras-controller.js            ║
 * ║  Módulo NOVO — Fiscal de Obras (Controle de Fiscalização)   ║
 * ╚══════════════════════════════════════════════════════════════╝
 */

import EventBus       from '../../core/EventBus.js';
import state          from '../../core/state.js';
import router         from '../../core/router.js';
import FirebaseService from '../../firebase/firebase-service.js';

export class FiscalObrasModule {
  constructor() {
    this._subs    = [];
    this._fiscais = [];
    this._visitas = [];
    this._abaAtiva= 'visitas';  // 'visitas' | 'fiscais'
    this._editVisitaId = null;
    this._editFiscalId = null;
  }

  async init() {
    try { this._bindEvents(); this._exposeGlobals(); }
    catch(e) { console.error('[FiscalObrasModule] init:', e); }
  }

  async onEnter() {
    try { await this._carregar(); this._render(); }
    catch(e) { console.error('[FiscalObrasModule] onEnter:', e); }
  }

  // ═══════════════════════════════════════════════════════════════
  //  PERSISTÊNCIA — coleção própria 'fiscais' e 'visitas_fiscais'
  // ═══════════════════════════════════════════════════════════════
  async _carregar() {
    const obraId = state.get('obraAtivaId');
    if (!obraId) return;
    try {
      const [fiscais, ocorrencias] = await Promise.all([
        FirebaseService.getFiscais(obraId).catch(() => []),
        FirebaseService.getOcorrencias(obraId).catch(() => []),
      ]);
      this._fiscais = fiscais || [];
      this._visitas = (ocorrencias || []).filter(o => o._tipoVisitaFiscal === true);
    } catch(e) {
      console.error('[FiscalObrasModule] _carregar:', e);
      this._fiscais = []; this._visitas = [];
    }
  }

  async _salvarFiscais() {
    const obraId = state.get('obraAtivaId');
    await FirebaseService.salvarFiscais(obraId, this._fiscais);
  }

  async _salvarVisitas() {
    const obraId = state.get('obraAtivaId');
    const todas  = await FirebaseService.getOcorrencias(obraId).catch(() => []);
    const semVisita = (todas||[]).filter(o => !o._tipoVisitaFiscal);
    await FirebaseService.salvarOcorrencias(obraId, [...semVisita, ...this._visitas]);
  }

  // ═══════════════════════════════════════════════════════════════
  //  RENDER PRINCIPAL
  // ═══════════════════════════════════════════════════════════════
  _render() {
    const el = document.getElementById('fiscal-obras-conteudo');
    if (!el) return;
    const obraId = state.get('obraAtivaId');
    const cfg    = state.get('cfg') || {};

    if (!obraId) {
      el.innerHTML = `<div style="text-align:center;padding:40px;color:var(--text-muted);font-size:13px">
        Selecione uma obra para gerenciar a fiscalização.</div>`;
      return;
    }

    el.innerHTML = `
      <!-- KPIs -->
      <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(140px,1fr));gap:10px;margin-bottom:18px">
        ${this._kpi('👷 Fiscais', this._fiscais.length, 'var(--accent)')}
        ${this._kpi('📋 Visitas', this._visitas.length, '#2563eb')}
        ${this._kpi('⚠️ Ocorrências', this._visitas.filter(v=>v.ocorrencia).length, '#f59e0b')}
        ${this._kpi('🔔 Notificações', this._visitas.filter(v=>v.notificacao).length, '#dc2626')}
      </div>

      <!-- Abas -->
      <div style="display:flex;gap:0;border-bottom:1px solid var(--border);margin-bottom:18px">
        <button data-action="_fo_aba" data-arg0="visitas"
          style="padding:9px 18px;font-size:12px;font-weight:700;border:none;cursor:pointer;
          border-bottom:2px solid ${this._abaAtiva==='visitas'?'var(--accent)':'transparent'};
          color:${this._abaAtiva==='visitas'?'var(--accent)':'var(--text-muted)'};
          background:transparent">📋 Visitas de Fiscalização</button>
        <button data-action="_fo_aba" data-arg0="fiscais"
          style="padding:9px 18px;font-size:12px;font-weight:700;border:none;cursor:pointer;
          border-bottom:2px solid ${this._abaAtiva==='fiscais'?'var(--accent)':'transparent'};
          color:${this._abaAtiva==='fiscais'?'var(--accent)':'var(--text-muted)'};
          background:transparent">👷 Cadastro de Fiscais</button>
      </div>

      ${this._abaAtiva === 'visitas' ? this._renderVisitas() : this._renderFiscais()}

      <!-- Overlay e Modais -->
      <div id="fo-overlay" data-action="_fo_fecharModal"
        style="display:none;position:fixed;inset:0;background:rgba(0,0,0,.55);z-index:1000"></div>
      <div id="fo-modal"
        style="display:none;position:fixed;top:50%;left:50%;transform:translate(-50%,-50%);
        z-index:1001;background:var(--bg-card);border:1px solid var(--border);border-radius:14px;
        padding:24px;width:min(96vw,640px);max-height:90vh;overflow-y:auto;
        box-shadow:0 20px 60px rgba(0,0,0,.4)"></div>
    `;
  }

  _kpi(label, valor, cor) {
    return `<div style="background:var(--bg-surface);border:1px solid var(--border);border-radius:8px;
      padding:12px;text-align:center">
      <div style="font-size:9px;font-weight:700;color:var(--text-muted);text-transform:uppercase;
        letter-spacing:.5px;margin-bottom:5px">${label}</div>
      <div style="font-size:20px;font-weight:800;color:${cor}">${valor}</div>
    </div>`;
  }

  // ─────────────────────────────────────────────────────────────
  //  ABA: VISITAS
  // ─────────────────────────────────────────────────────────────
  _renderVisitas() {
    const visitas = [...this._visitas].sort((a,b) =>
      (b.data||'').localeCompare(a.data||''));

    return `
      <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:14px">
        <div style="font-size:11px;color:var(--text-muted)">${visitas.length} visita(s) registrada(s)</div>
        <button data-action="_fo_abrirVisita" data-arg0="null"
          style="padding:8px 16px;background:var(--accent);border:none;border-radius:8px;
          color:#fff;font-size:12px;font-weight:700;cursor:pointer">📋 Nova Visita</button>
      </div>

      ${visitas.length === 0
        ? `<div style="text-align:center;padding:40px;color:var(--text-muted);font-size:12px">
            Nenhuma visita registrada.<br>
            <span style="font-size:11px">Registre a primeira visita de fiscalização.</span></div>`
        : visitas.map(v => this._cardVisita(v)).join('')}
    `;
  }

  _cardVisita(v) {
    const fiscal = this._fiscais.find(f => f.id === v.fiscalId);
    const nomeFiscal = fiscal ? fiscal.nome : (v.fiscalNome || 'Não informado');
    const temOcorr = v.ocorrencia ? true : false;
    const temNot = v.notificacao ? true : false;

    return `
      <div style="background:var(--bg-surface);border:1px solid var(--border);border-radius:10px;
        padding:14px;margin-bottom:10px">
        <div style="display:flex;align-items:flex-start;justify-content:space-between;gap:10px">
          <div style="flex:1">
            <div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap;margin-bottom:6px">
              <span style="font-weight:700;font-size:13px;color:var(--text-primary)">
                📅 ${v.data || '—'}</span>
              <span style="font-size:11px;color:var(--text-muted)">👷 ${nomeFiscal}</span>
              ${temOcorr ? `<span style="font-size:10px;background:#fffbeb;border:1px solid #f59e0b;
                color:#f59e0b;padding:1px 7px;border-radius:10px;font-weight:600">⚠️ Ocorrência</span>` : ''}
              ${temNot ? `<span style="font-size:10px;background:#fef2f2;border:1px solid #dc2626;
                color:#dc2626;padding:1px 7px;border-radius:10px;font-weight:600">🔔 Notificação</span>` : ''}
            </div>
            ${v.descricao ? `<div style="font-size:12px;color:var(--text-primary);margin-bottom:4px">
              ${v.descricao}</div>` : ''}
            ${v.ocorrencia ? `<div style="font-size:11px;color:#f59e0b;margin-bottom:3px">
              ⚠️ Ocorrência: ${v.ocorrencia}</div>` : ''}
            ${v.notificacao ? `<div style="font-size:11px;color:#dc2626;margin-bottom:3px">
              🔔 Notificação: ${v.notificacao}</div>` : ''}
            ${v.obstech ? `<div style="font-size:11px;color:var(--text-muted);font-style:italic">
              📝 ${v.obstech}</div>` : ''}
          </div>
          <div style="display:flex;gap:6px;flex-shrink:0">
            <button data-action="_fo_abrirVisita" data-arg0="${v.id}" style="padding:4px 9px;font-size:11px;background:transparent;border:1px solid var(--border);
              border-radius:6px;color:var(--text-primary);cursor:pointer">✏️</button>
            <button data-action="_fo_excluirVisita" data-arg0="${v.id}" style="padding:4px 9px;font-size:11px;background:transparent;border:1px solid #fca5a5;
              border-radius:6px;color:#ef4444;cursor:pointer">🗑️</button>
          </div>
        </div>
      </div>`;
  }

  // ─────────────────────────────────────────────────────────────
  //  ABA: FISCAIS
  // ─────────────────────────────────────────────────────────────
  _renderFiscais() {
    return `
      <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:14px">
        <div style="font-size:11px;color:var(--text-muted)">${this._fiscais.length} fiscal(is) cadastrado(s)</div>
        <button data-action="_fo_abrirFiscal" data-arg0="null"
          style="padding:8px 16px;background:var(--accent);border:none;border-radius:8px;
          color:#fff;font-size:12px;font-weight:700;cursor:pointer">👷 Novo Fiscal</button>
      </div>

      ${this._fiscais.length === 0
        ? `<div style="text-align:center;padding:40px;color:var(--text-muted);font-size:12px">
            Nenhum fiscal cadastrado.<br>
            <span style="font-size:11px">Cadastre os fiscais responsáveis pela obra.</span></div>`
        : `<div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(260px,1fr));gap:10px">
            ${this._fiscais.map(f => this._cardFiscal(f)).join('')}</div>`}
    `;
  }

  _cardFiscal(f) {
    const visitasDele = this._visitas.filter(v => v.fiscalId === f.id).length;
    return `
      <div style="background:var(--bg-surface);border:1px solid var(--border);border-radius:10px;padding:14px">
        <div style="display:flex;align-items:center;gap:10px;margin-bottom:10px">
          <div style="width:40px;height:40px;border-radius:50%;background:var(--accent);display:flex;
            align-items:center;justify-content:center;font-size:18px;flex-shrink:0">👷</div>
          <div>
            <div style="font-weight:700;font-size:13px;color:var(--text-primary)">${f.nome||'—'}</div>
            <div style="font-size:10px;color:var(--text-muted)">${f.cargo||''}</div>
          </div>
        </div>
        <div style="font-size:11px;color:var(--text-muted);display:grid;gap:3px">
          ${f.crea ? `<div>🔖 CREA/CAU: ${f.crea}</div>` : ''}
          ${f.email ? `<div>📧 ${f.email}</div>` : ''}
          ${f.telefone ? `<div>📱 ${f.telefone}</div>` : ''}
          <div>📋 Visitas registradas: <strong>${visitasDele}</strong></div>
        </div>
        <div style="display:flex;gap:6px;margin-top:10px">
          <button data-action="_fo_abrirFiscal" data-arg0="${f.id}" style="flex:1;padding:5px;font-size:11px;background:transparent;border:1px solid var(--border);
            border-radius:6px;color:var(--text-primary);cursor:pointer">✏️ Editar</button>
          <button data-action="_fo_excluirFiscal" data-arg0="${f.id}" style="padding:5px 8px;font-size:11px;background:transparent;border:1px solid #fca5a5;
            border-radius:6px;color:#ef4444;cursor:pointer">🗑️</button>
        </div>
      </div>`;
  }

  // ═══════════════════════════════════════════════════════════════
  //  MODAIS
  // ═══════════════════════════════════════════════════════════════
  _showModal() {
    document.getElementById('fo-overlay').style.display = 'block';
    document.getElementById('fo-modal').style.display = 'block';
  }

  _fecharModal() {
    const modal   = document.getElementById('fo-modal');
    const overlay = document.getElementById('fo-overlay');
    if (modal)   modal.style.display = 'none';
    if (overlay) overlay.style.display = 'none';
    this._editVisitaId = null;
    this._editFiscalId = null;
  }

  _fld(id, label, type='text', value='', placeholder='') {
    return `<div>
      <label style="display:block;font-size:10px;font-weight:700;color:var(--text-muted);
        text-transform:uppercase;letter-spacing:.5px;margin-bottom:5px">${label}</label>
      <input type="${type}" id="${id}" value="${value||''}" placeholder="${placeholder}"
        style="width:100%;box-sizing:border-box;padding:8px 11px;border:1px solid var(--border);
        border-radius:7px;background:var(--bg-card);color:var(--text-primary);font-size:13px"></div>`;
  }

  _fldTA(id, label, value='', placeholder='') {
    return `<div>
      <label style="display:block;font-size:10px;font-weight:700;color:var(--text-muted);
        text-transform:uppercase;letter-spacing:.5px;margin-bottom:5px">${label}</label>
      <textarea id="${id}" rows="3" placeholder="${placeholder}"
        style="width:100%;box-sizing:border-box;padding:8px 11px;border:1px solid var(--border);
        border-radius:7px;background:var(--bg-card);color:var(--text-primary);font-size:13px;
        resize:vertical">${value||''}</textarea></div>`;
  }

  // ── Modal de Visita ───────────────────────────────────────────
  _abrirVisita(visitaId) {
    this._editVisitaId = visitaId;
    const modal = document.getElementById('fo-modal');
    if (!modal) return;
    const v = visitaId ? this._visitas.find(x => x.id === visitaId) : null;
    const opsFiscais = this._fiscais.map(f =>
      `<option value="${f.id}" ${v?.fiscalId===f.id?'selected':''}>${f.nome}</option>`).join('');

    modal.innerHTML = `
      <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:18px">
        <div style="font-size:15px;font-weight:800;color:var(--text-primary)">
          ${v ? '✏️ Editar Visita' : '📋 Nova Visita de Fiscalização'}</div>
        <button data-action="_fo_fecharModal"
          style="background:none;border:none;cursor:pointer;font-size:22px;color:var(--text-muted)">×</button>
      </div>

      <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px">
        <div>
          <label style="display:block;font-size:10px;font-weight:700;color:var(--text-muted);
            text-transform:uppercase;letter-spacing:.5px;margin-bottom:5px">Data da Visita *</label>
          <input type="date" id="fo-v-data" value="${v?.data||''}"
            style="width:100%;box-sizing:border-box;padding:8px 11px;border:1px solid var(--border);
            border-radius:7px;background:var(--bg-card);color:var(--text-primary);font-size:13px">
        </div>
        <div>
          <label style="display:block;font-size:10px;font-weight:700;color:var(--text-muted);
            text-transform:uppercase;letter-spacing:.5px;margin-bottom:5px">Fiscal Responsável</label>
          <select id="fo-v-fiscal"
            style="width:100%;box-sizing:border-box;padding:8px 11px;border:1px solid var(--border);
            border-radius:7px;background:var(--bg-card);color:var(--text-primary);font-size:13px">
            <option value="">— Selecione —</option>
            ${opsFiscais}
          </select>
        </div>
        <div style="grid-column:1/-1">
          ${this._fldTA('fo-v-desc','Descrição da Visita *', v?.descricao||'')}
        </div>
        <div style="grid-column:1/-1">
          ${this._fldTA('fo-v-ocorrencia','Ocorrência Registrada', v?.ocorrencia||'', 'Descreva eventuais problemas ou irregularidades...')}
        </div>
        <div style="grid-column:1/-1">
          ${this._fldTA('fo-v-obstech','Observações Técnicas', v?.obstech||'')}
        </div>
        <div style="grid-column:1/-1">
          ${this._fld('fo-v-notificacao','Notificação Emitida (nº/descrição)', 'text', v?.notificacao||'')}
        </div>
        <div>
          ${this._fld('fo-v-contrato','Vinculo ao Contrato', 'text', v?.contrato||state.get('cfg')?.contrato||'')}
        </div>
      </div>

      <div id="fo-v-erro" style="display:none;padding:10px;background:#fef2f2;border:1px solid #fca5a5;
        border-radius:6px;color:#dc2626;font-size:12px;margin-top:12px"></div>

      <div style="display:flex;gap:8px;justify-content:flex-end;margin-top:18px">
        <button data-action="_fo_fecharModal"
          style="padding:10px 18px;background:transparent;border:1px solid var(--border);border-radius:8px;
          color:var(--text-muted);font-size:13px;cursor:pointer">Cancelar</button>
        <button data-action="_fo_salvarVisita"
          style="padding:10px 22px;background:var(--accent);border:none;border-radius:8px;
          color:#fff;font-size:13px;font-weight:700;cursor:pointer">💾 Salvar</button>
      </div>`;

    this._showModal();
  }

  async _salvarVisita() {
    const g  = id => document.getElementById(id)?.value?.trim()||'';
    const data = g('fo-v-data');
    const desc = g('fo-v-desc');
    const erroEl = document.getElementById('fo-v-erro');

    if (!data || !desc) {
      if (erroEl) { erroEl.textContent='⚠️ Data e descrição são obrigatórias.'; erroEl.style.display='block'; }
      return;
    }
    const fiscalId  = g('fo-v-fiscal');
    const fiscal    = this._fiscais.find(f => f.id === fiscalId);
    const visita = {
      id:          this._editVisitaId || `vis_${Date.now().toString(36)}`,
      _tipoVisitaFiscal: true,
      data,
      fiscalId,
      fiscalNome:  fiscal?.nome || '',
      descricao:   desc,
      ocorrencia:  g('fo-v-ocorrencia'),
      obstech:     g('fo-v-obstech'),
      notificacao: g('fo-v-notificacao'),
      contrato:    g('fo-v-contrato'),
      criadoEm:    this._editVisitaId
        ? (this._visitas.find(v=>v.id===this._editVisitaId)?.criadoEm || new Date().toISOString())
        : new Date().toISOString(),
    };

    try {
      const idx = this._visitas.findIndex(v => v.id === visita.id);
      if (idx >= 0) this._visitas[idx] = visita; else this._visitas.push(visita);
      await this._salvarVisitas();
      this._fecharModal();
      this._render();
      window.toast?.('✅ Visita registrada!', 'ok');
    } catch(e) {
      if (erroEl) { erroEl.textContent=`❌ Erro: ${e.message}`; erroEl.style.display='block'; }
    }
  }

  async _excluirVisita(id) {
    if (!confirm('🗑️ Excluir esta visita?')) return;
    this._visitas = this._visitas.filter(v => v.id !== id);
    await this._salvarVisitas();
    this._render();
    window.toast?.('🗑️ Visita excluída.','warn');
  }

  // ── Modal de Fiscal ───────────────────────────────────────────
  _abrirFiscal(fiscalId) {
    this._editFiscalId = fiscalId;
    const modal = document.getElementById('fo-modal');
    if (!modal) return;
    const f = fiscalId ? this._fiscais.find(x => x.id === fiscalId) : null;

    modal.innerHTML = `
      <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:18px">
        <div style="font-size:15px;font-weight:800;color:var(--text-primary)">
          ${f ? '✏️ Editar Fiscal' : '👷 Novo Fiscal'}</div>
        <button data-action="_fo_fecharModal"
          style="background:none;border:none;cursor:pointer;font-size:22px;color:var(--text-muted)">×</button>
      </div>

      <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px">
        <div style="grid-column:1/-1">
          ${this._fld('fo-f-nome','Nome Completo *','text',f?.nome||'')}
        </div>
        ${this._fld('fo-f-cargo','Cargo / Função','text',f?.cargo||'Fiscal de Obras')}
        ${this._fld('fo-f-crea','CREA / CAU','text',f?.crea||'')}
        ${this._fld('fo-f-email','E-mail','email',f?.email||'')}
        ${this._fld('fo-f-telefone','Telefone','tel',f?.telefone||'')}
      </div>

      <div id="fo-f-erro" style="display:none;padding:10px;background:#fef2f2;border:1px solid #fca5a5;
        border-radius:6px;color:#dc2626;font-size:12px;margin-top:12px"></div>

      <div style="display:flex;gap:8px;justify-content:flex-end;margin-top:18px">
        <button data-action="_fo_fecharModal"
          style="padding:10px 18px;background:transparent;border:1px solid var(--border);border-radius:8px;
          color:var(--text-muted);font-size:13px;cursor:pointer">Cancelar</button>
        <button data-action="_fo_salvarFiscal"
          style="padding:10px 22px;background:var(--accent);border:none;border-radius:8px;
          color:#fff;font-size:13px;font-weight:700;cursor:pointer">💾 Salvar</button>
      </div>`;

    this._showModal();
  }

  async _salvarFiscal() {
    const g = id => document.getElementById(id)?.value?.trim()||'';
    const nome = g('fo-f-nome');
    const erroEl = document.getElementById('fo-f-erro');
    if (!nome) {
      if (erroEl) { erroEl.textContent='⚠️ O nome é obrigatório.'; erroEl.style.display='block'; }
      return;
    }
    const fiscal = {
      id:          this._editFiscalId || `fisc_${Date.now().toString(36)}`,
      _tipoFiscal: true,
      nome,
      cargo:       g('fo-f-cargo'),
      crea:        g('fo-f-crea'),
      email:       g('fo-f-email'),
      telefone:    g('fo-f-telefone'),
    };
    try {
      const idx = this._fiscais.findIndex(f => f.id === fiscal.id);
      if (idx >= 0) this._fiscais[idx] = fiscal; else this._fiscais.push(fiscal);
      await this._salvarFiscais();
      this._fecharModal();
      this._render();
      window.toast?.('✅ Fiscal salvo!', 'ok');
    } catch(e) {
      if (erroEl) { erroEl.textContent=`❌ Erro: ${e.message}`; erroEl.style.display='block'; }
    }
  }

  async _excluirFiscal(id) {
    if (!confirm('🗑️ Excluir este fiscal?')) return;
    this._fiscais = this._fiscais.filter(f => f.id !== id);
    await this._salvarFiscais();
    this._render();
    window.toast?.('🗑️ Fiscal excluído.','warn');
  }

  // ═══════════════════════════════════════════════════════════════
  //  EVENTOS E GLOBALS
  // ═══════════════════════════════════════════════════════════════
  _bindEvents() {
    this._subs.push(
      EventBus.on('obra:selecionada', async () => {
        try { await this._carregar(); if (router.current==='fiscal-obras') this._render(); } catch(e) {}
      }, 'fiscal-obras'),
    );
  }

  _exposeGlobals() {
    window._fo_aba             = a  => { try { this._abaAtiva=a; this._render(); } catch(e){} };
    window._fo_fecharModal     = () => { try { this._fecharModal(); } catch(e){} };
    window._fo_abrirVisita     = id => { try { this._abrirVisita(id); } catch(e){} };
    window._fo_salvarVisita    = () => { try { this._salvarVisita(); } catch(e){} };
    window._fo_excluirVisita   = id => { try { this._excluirVisita(id); } catch(e){} };
    window._fo_abrirFiscal     = id => { try { this._abrirFiscal(id); } catch(e){} };
    window._fo_salvarFiscal    = () => { try { this._salvarFiscal(); } catch(e){} };
    window._fo_excluirFiscal   = id => { try { this._excluirFiscal(id); } catch(e){} };
  }

  destroy() { this._subs.forEach(u => u()); this._subs = []; }
}
