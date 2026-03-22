/**
 * ╔══════════════════════════════════════════════════════════════╗
 * ║  FISCAL NA OBRA v16 — notificacoes-controller.js            ║
 * ║  Módulo: NotificacoesModule                                 ║
 * ║  Notificações Formais à Empresa Executora — v2              ║
 * ╚══════════════════════════════════════════════════════════════╝
 *
 *  Funcionalidades:
 *   • CRUD completo de notificações com todos os campos exigidos
 *   • 7 tipos de notificação + 6 status no ciclo de vida
 *   • Histórico de interações por notificação
 *   • Resposta da empresa executora
 *   • Geração de PDF oficial da notificação
 *   • Painel com filtros por obra/empresa/status/período/tipo
 *   • Alertas de prazo vencendo ou vencido sem resposta
 *   • Relatórios exportáveis
 *   • Controle de permissões por perfil de usuário
 */

import EventBus        from '../../core/EventBus.js';
import state           from '../../core/state.js';
import router          from '../../core/router.js';
import { formatters }  from '../../utils/formatters.js';
import FirebaseService from '../../firebase/firebase-service.js';
import { baixarCSV }   from '../../utils/csv-export.js';

// ── Constantes ──────────────────────────────────────────────────────
const TIPOS_NOTIF = [
  { k:'advertencia',        i:'⚠️',  l:'Advertência'                   },
  { k:'solicitacao_correcao', i:'🔧', l:'Solicitação de Correção'       },
  { k:'solicitacao_info',   i:'ℹ️',  l:'Solicitação de Informação'     },
  { k:'irregularidade',     i:'🚫',  l:'Irregularidade na Execução'    },
  { k:'descumprimento',     i:'📛',  l:'Descumprimento Contratual'     },
  { k:'tecnica',            i:'🔬',  l:'Notificação Técnica'           },
  { k:'administrativa',     i:'📋',  l:'Notificação Administrativa'    },
];

const STATUS_NOTIF = [
  { k:'emitida',    l:'Emitida',              cor:'#6b7280' },
  { k:'enviada',    l:'Enviada à Empresa',    cor:'#3b82f6' },
  { k:'em_analise', l:'Em Análise',           cor:'#f59e0b' },
  { k:'respondida', l:'Respondida',           cor:'#22c55e' },
  { k:'nao_resp',   l:'Não Respondida',       cor:'#ef4444' },
  { k:'encerrada',  l:'Encerrada',            cor:'#7c3aed' },
];

const PERFIS_EMISSAO = ['administrador','fiscal','engenheiro'];

const hoje   = () => new Date().toISOString().slice(0,10);
const R$     = v  => (v||0).toLocaleString('pt-BR',{style:'currency',currency:'BRL'});
const dataBR = iso => iso ? new Date(iso+'T12:00:00').toLocaleDateString('pt-BR') : '—';
const f_esc  = s  => String(s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');

export class NotificacoesModule {
  constructor() {
    this._subs     = [];
    this._notifs   = [];   // todas as notificações da obra ativa
    this._editId   = null; // null = nova, string = id edição
    this._view     = 'painel'; // 'painel' | 'form' | 'detalhe'
    this._detId    = null;
    this._filtros  = { status:'', tipo:'', dataIni:'', dataFim:'', busca:'' };
  }

  // ══════════════════════════════════════════════════════════════════
  //  INIT
  // ══════════════════════════════════════════════════════════════════
  async init() {
    try { this._bindEvents(); this._exposeGlobals(); }
    catch(e) { console.error('[NotificacoesModule] init:', e); }
  }

  async onEnter() {
    try {
      // sincroniza campos de filtro com o HTML estático se existirem
      this._sincFiltrosHTML();
      await this._carregar();
      this._renderView();
    } catch(e) { console.error('[NotificacoesModule] onEnter:', e); }
  }

  // ══════════════════════════════════════════════════════════════════
  //  PERSISTÊNCIA
  // ══════════════════════════════════════════════════════════════════
  async _carregar() {
    const obraId = state.get('obraAtivaId');
    if (!obraId) { this._notifs=[]; return; }
    try {
      const dados = await FirebaseService.getNotificacoes(obraId).catch(()=>[]);
      // Separação: notificações do novo módulo têm flag _v2=true
      // Compatibilidade: aceita também antigas sem flag
      this._notifs = (dados||[]).filter(n => n._v2 !== false);
      // Ordena: mais recentes primeiro
      this._notifs.sort((a,b) => (b.dataEmissao||'').localeCompare(a.dataEmissao||''));
      // FIX-NOTIF: sincroniza state para que o badge da topbar leia a contagem correta
      state.set('notificacoes', this._notifs);
      EventBus.emit('notificacoes:carregadas', { total: this._notifs.length });
    } catch(e) { console.error('[NotificacoesModule] _carregar:', e); this._notifs=[]; }
  }

  async _persistir() {
    const obraId = state.get('obraAtivaId');
    if (!obraId) { window.toast?.('⚠️ Nenhuma obra ativa.','warn'); return; }
    await FirebaseService.salvarNotificacoes(obraId, this._notifs);
  }

  // ══════════════════════════════════════════════════════════════════
  //  ROTEAMENTO DE VIEWS
  // ══════════════════════════════════════════════════════════════════
  _renderView() {
    if (this._view === 'form')    { this._renderForm();    return; }
    if (this._view === 'detalhe') { this._renderDetalhe(); return; }
    this._renderPainel();
  }

  // ══════════════════════════════════════════════════════════════════
  //  PAINEL PRINCIPAL
  // ══════════════════════════════════════════════════════════════════
  _renderPainel() {
    const el = document.getElementById('notif-lista') || this._container();
    if (!el) return;
    const obraId = state.get('obraAtivaId');
    const cfg    = state.get('cfg') || {};

    // Substitui todo o conteúdo do card de notificações
    const card = document.querySelector('#notificacoes .card');
    if (!card) return;

    const kpis   = this._calcKpis();
    const lista  = this._filtrar();
    const alertas = this._calcAlertas();

    card.innerHTML = `
      <!-- Cabeçalho -->
      <div style="display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:10px;margin-bottom:16px">
        <div class="titulo-secao" style="margin:0;border:none;padding:0">🔔 Notificações à Empresa Executora</div>
        <div style="display:flex;gap:8px;flex-wrap:wrap">
          <button data-action="_notif_relatorio"
            style="padding:7px 14px;background:var(--bg-surface);border:1px solid var(--border);border-radius:8px;font-size:11px;font-weight:700;cursor:pointer;color:var(--text-primary)">
            📊 Relatório</button>
          <button data-action="_notif_nova"
            style="padding:7px 16px;background:var(--accent);border:none;border-radius:8px;color:#fff;font-size:12px;font-weight:700;cursor:pointer">
            ➕ Nova Notificação</button>
        </div>
      </div>

      <!-- KPIs -->
      <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(110px,1fr));gap:10px;margin-bottom:16px">
        ${this._kpi('Total',       kpis.total,       'var(--accent)')}
        ${this._kpi('Emitidas',    kpis.emitidas,    '#3b82f6')}
        ${this._kpi('Pendentes',   kpis.pendentes,   '#f59e0b')}
        ${this._kpi('Vencidas',    kpis.vencidas,    '#ef4444')}
        ${this._kpi('Respondidas', kpis.respondidas, '#22c55e')}
        ${this._kpi('Encerradas',  kpis.encerradas,  '#7c3aed')}
      </div>

      <!-- Alertas de prazo -->
      ${alertas.length > 0 ? `
      <div style="background:#7f1d1d22;border:1px solid #dc2626;border-radius:10px;padding:12px;margin-bottom:14px">
        <div style="font-size:11px;font-weight:700;color:#fca5a5;margin-bottom:8px">⚠️ ${alertas.length} notificação(ões) com prazo crítico</div>
        ${alertas.slice(0,3).map(n=>`
          <div style="font-size:11px;color:var(--text-primary);padding:4px 0;border-bottom:1px solid #ef444433">
            <span style="color:#ef4444;font-weight:700">${n.numero||'—'}</span> — ${f_esc(n.assunto||'').slice(0,60)}
            <span style="float:right;color:#ef4444">Prazo: ${dataBR(n.prazoResposta)}</span>
          </div>
        `).join('')}
      </div>` : ''}

      <!-- Filtros -->
      <div style="display:grid;grid-template-columns:1fr 1fr 1fr 1fr auto;gap:8px;align-items:end;margin-bottom:14px;flex-wrap:wrap">
        <div>
          <label style="font-size:10px;font-weight:700;color:var(--text-muted);display:block;margin-bottom:3px">Status</label>
          <select onchange="window._notif_filtro('status',this.value)"
            style="width:100%;padding:7px;font-size:11px;border-radius:7px;border:1px solid var(--border);background:var(--bg-surface);color:var(--text-primary)">
            <option value="">Todos</option>
            ${STATUS_NOTIF.map(s=>`<option value="${s.k}" ${this._filtros.status===s.k?'selected':''}>${s.l}</option>`).join('')}
          </select>
        </div>
        <div>
          <label style="font-size:10px;font-weight:700;color:var(--text-muted);display:block;margin-bottom:3px">Tipo</label>
          <select onchange="window._notif_filtro('tipo',this.value)"
            style="width:100%;padding:7px;font-size:11px;border-radius:7px;border:1px solid var(--border);background:var(--bg-surface);color:var(--text-primary)">
            <option value="">Todos</option>
            ${TIPOS_NOTIF.map(t=>`<option value="${t.k}" ${this._filtros.tipo===t.k?'selected':''}>${t.i} ${t.l}</option>`).join('')}
          </select>
        </div>
        <div>
          <label style="font-size:10px;font-weight:700;color:var(--text-muted);display:block;margin-bottom:3px">De</label>
          <input type="date" value="${this._filtros.dataIni}" onchange="window._notif_filtro('dataIni',this.value)"
            style="width:100%;padding:7px;font-size:11px;border-radius:7px;border:1px solid var(--border);background:var(--bg-surface);color:var(--text-primary);box-sizing:border-box">
        </div>
        <div>
          <label style="font-size:10px;font-weight:700;color:var(--text-muted);display:block;margin-bottom:3px">Até</label>
          <input type="date" value="${this._filtros.dataFim}" onchange="window._notif_filtro('dataFim',this.value)"
            style="width:100%;padding:7px;font-size:11px;border-radius:7px;border:1px solid var(--border);background:var(--bg-surface);color:var(--text-primary);box-sizing:border-box">
        </div>
        <button data-action="_notif_limparFiltros"
          style="padding:7px 12px;background:var(--bg-surface);border:1px solid var(--border);border-radius:7px;font-size:11px;cursor:pointer;color:var(--text-primary);white-space:nowrap;align-self:end">
          ✕ Limpar</button>
      </div>
      <div style="margin-bottom:12px">
        <input type="text" placeholder="🔍 Buscar por número, assunto, empresa..." value="${this._filtros.busca}"
          oninput="window._notif_filtro('busca',this.value)"
          style="width:100%;padding:8px 12px;font-size:12px;border-radius:7px;border:1px solid var(--border);background:var(--bg-surface);color:var(--text-primary);box-sizing:border-box">
      </div>

      <!-- Lista de notificações -->
      <div id="notif-lista-cards">
        ${lista.length === 0
          ? `<div style="text-align:center;padding:40px;color:var(--text-muted);font-size:12px">
              ${this._notifs.length===0
                ? `Nenhuma notificação registrada.<br><span style="font-size:11px">Clique em "Nova Notificação" para emitir a primeira.</span>`
                : 'Nenhuma notificação encontrada com os filtros aplicados.'}</div>`
          : lista.map(n => this._cardNotif(n)).join('')}
      </div>
    `;
  }

  _cardNotif(n) {
    const tipo   = TIPOS_NOTIF.find(t=>t.k===n.tipo)||TIPOS_NOTIF[0];
    const status = STATUS_NOTIF.find(s=>s.k===n.status)||STATUS_NOTIF[0];
    const vencendo = this._isPrazoAlerta(n);
    const vencida  = this._isPrazoVencido(n);

    return `<div data-notif-id="${n.id}" style="background:var(--bg-surface);border:1px solid var(--border);border-radius:10px;padding:14px;margin-bottom:10px;
      border-left:3px solid ${status.cor};${vencendo?'box-shadow:0 0 0 1px #ef444455':''}">
      <div style="display:flex;align-items:flex-start;justify-content:space-between;gap:8px;flex-wrap:wrap">
        <div style="flex:1;min-width:0">
          <div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap;margin-bottom:6px">
            <span style="font-size:12px;font-weight:800;color:var(--text-primary)">${f_esc(n.numero||'—')}</span>
            <span style="font-size:10px;background:${status.cor}22;color:${status.cor};padding:2px 8px;border-radius:10px;font-weight:700">${status.l}</span>
            <span style="font-size:10px;background:var(--bg-card);padding:2px 8px;border-radius:10px;color:var(--text-muted)">${tipo.i} ${tipo.l}</span>
            ${vencida ? '<span style="font-size:10px;background:#ef444422;color:#ef4444;padding:2px 8px;border-radius:10px;font-weight:700">⏰ PRAZO VENCIDO</span>' : ''}
            ${vencendo && !vencida ? '<span style="font-size:10px;background:#f59e0b22;color:#f59e0b;padding:2px 8px;border-radius:10px;font-weight:700">⚠️ PRAZO CRÍTICO</span>' : ''}
          </div>
          <div style="font-size:13px;font-weight:700;color:var(--text-primary);margin-bottom:4px">${f_esc(n.assunto||'Sem assunto')}</div>
          <div style="font-size:11px;color:var(--text-muted)">
            🏢 ${f_esc(n.empresa||'—')} &nbsp;|&nbsp;
            📅 Emissão: ${dataBR(n.dataEmissao)}
            ${n.prazoResposta ? ` &nbsp;|&nbsp; ⏰ Prazo: ${dataBR(n.prazoResposta)}` : ''}
            ${n.responsavelEmissor ? ` &nbsp;|&nbsp; 👤 ${f_esc(n.responsavelEmissor)}` : ''}
          </div>
          ${n.descricao ? `<div style="font-size:11px;color:var(--text-muted);margin-top:5px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;max-width:600px">${f_esc(n.descricao)}</div>` : ''}
        </div>
        <div style="display:flex;gap:6px;flex-shrink:0;flex-wrap:wrap">
          <button data-action="_notif_verDetalhe" data-arg0="${n.id}" style="padding:5px 10px;font-size:11px;background:var(--accent);border:none;border-radius:6px;cursor:pointer;color:#fff;font-weight:700">
            📄 Ver</button>
          <button data-action="_notif_gerarPDF" data-arg0="${n.id}" style="padding:5px 10px;font-size:11px;background:#1e293b;border:1px solid var(--border);border-radius:6px;cursor:pointer;color:var(--text-primary)">
            🖨️</button>
          <button data-action="_integGerarSancDeNotif" data-arg0="${n.id}"
            title="Gerar Sancao" style="padding:5px 10px;font-size:11px;background:#fee2e2;border:1px solid #fca5a5;border-radius:6px;cursor:pointer;color:#dc2626">⚖️ Sancao</button>
          <button data-action="_notif_editar" data-arg0="${n.id}" style="padding:5px 10px;font-size:11px;background:var(--bg-card);border:1px solid var(--border);border-radius:6px;cursor:pointer;color:var(--text-primary)">
            ✏️</button>
          <button data-action="_notif_excluir" data-arg0="${n.id}" style="padding:5px 10px;font-size:11px;background:#fee2e2;border:1px solid #fca5a5;border-radius:6px;cursor:pointer;color:#dc2626">
            🗑️</button>
        </div>
      </div>
    </div>`;
  }

  // ══════════════════════════════════════════════════════════════════
  //  FORMULÁRIO NOVA / EDITAR
  // ══════════════════════════════════════════════════════════════════
  _renderForm() {
    const card = document.querySelector('#notificacoes .card');
    if (!card) return;
    const n    = this._editId ? this._notifs.find(x=>x.id===this._editId) : null;
    const cfg  = state.get('cfg') || {};

    card.innerHTML = `
      <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:18px">
        <div class="titulo-secao" style="margin:0;border:none;padding:0">
          ${n ? '✏️ Editar Notificação' : '➕ Nova Notificação'}</div>
        <button data-action="_notif_voltarPainel"
          style="padding:7px 14px;background:var(--bg-surface);border:1px solid var(--border);border-radius:8px;font-size:12px;cursor:pointer;color:var(--text-primary)">
          ← Voltar ao Painel</button>
      </div>

      <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px">

        <!-- Número -->
        <div>
          <label style="${this._lbl()}">Número da Notificação *</label>
          <input id="nf-num" value="${f_esc(n?.numero||'')}" placeholder="Ex: NOT-001/2026"
            style="${this._inp()}">
        </div>

        <!-- Data de emissão -->
        <div>
          <label style="${this._lbl()}">Data de Emissão *</label>
          <input id="nf-data" type="date" value="${n?.dataEmissao||hoje()}"
            style="${this._inp()}">
        </div>

        <!-- Obra (readonly - usa obra ativa) -->
        <div>
          <label style="${this._lbl()}">Obra</label>
          <input value="${f_esc(cfg.objeto||state.get('obraAtivaId')||'Obra ativa')}" readonly
            style="${this._inp()} opacity:.7">
        </div>

        <!-- Empresa executora -->
        <div>
          <label style="${this._lbl()}">Empresa Executora *</label>
          <input id="nf-empresa" value="${f_esc(n?.empresa||cfg.contratada||'')}"
            placeholder="Razão social da empresa" style="${this._inp()}">
        </div>

        <!-- Tipo -->
        <div>
          <label style="${this._lbl()}">Tipo de Notificação *</label>
          <select id="nf-tipo" style="${this._inp()}">
            ${TIPOS_NOTIF.map(t=>`<option value="${t.k}" ${n?.tipo===t.k?'selected':''}>${t.i} ${t.l}</option>`).join('')}
          </select>
        </div>

        <!-- Status -->
        <div>
          <label style="${this._lbl()}">Status</label>
          <select id="nf-status" style="${this._inp()}">
            ${STATUS_NOTIF.map(s=>`<option value="${s.k}" ${(n?.status||'emitida')===s.k?'selected':''}>${s.l}</option>`).join('')}
          </select>
        </div>

        <!-- Assunto -->
        <div style="grid-column:1/-1">
          <label style="${this._lbl()}">Assunto *</label>
          <input id="nf-assunto" value="${f_esc(n?.assunto||'')}"
            placeholder="Resumo do objeto da notificação" style="${this._inp()}">
        </div>

        <!-- Descrição detalhada -->
        <div style="grid-column:1/-1">
          <label style="${this._lbl()}">Descrição Detalhada *</label>
          <textarea id="nf-desc" rows="5"
            placeholder="Descreva detalhadamente o objeto da notificação, fatos ocorridos, cláusulas contratuais infringidas, providências exigidas..."
            style="${this._inp()} resize:vertical">${f_esc(n?.descricao||'')}</textarea>
        </div>

        <!-- Prazo para resposta -->
        <div>
          <label style="${this._lbl()}">Prazo para Resposta</label>
          <input id="nf-prazo" type="date" value="${n?.prazoResposta||''}"
            style="${this._inp()}">
        </div>

        <!-- Responsável emissor -->
        <div>
          <label style="${this._lbl()}">Responsável Emissor</label>
          <input id="nf-resp" value="${f_esc(n?.responsavelEmissor||cfg.fiscal||'')}"
            placeholder="Nome do fiscal/responsável" style="${this._inp()}">
        </div>

        <!-- Cargo do emissor -->
        <div>
          <label style="${this._lbl()}">Cargo do Emissor</label>
          <input id="nf-cargo" value="${f_esc(n?.cargoEmissor||'Fiscal de Obras')}"
            placeholder="Fiscal de Obras, Engenheiro..." style="${this._inp()}">
        </div>

        <!-- CREA/CAU -->
        <div>
          <label style="${this._lbl()}">CREA / CAU do Emissor</label>
          <input id="nf-crea" value="${f_esc(n?.creaEmissor||cfg.creaFiscal||'')}"
            placeholder="Ex: CREA-PE 123456" style="${this._inp()}">
        </div>

      </div>

      <!-- Resposta da empresa (apenas em edição) -->
      ${n ? `
      <div style="background:var(--bg-surface);border:1px solid var(--border);border-radius:10px;padding:16px;margin-top:16px">
        <div style="font-size:11px;font-weight:700;color:var(--text-muted);text-transform:uppercase;letter-spacing:.5px;margin-bottom:12px">
          🏢 Resposta da Empresa</div>
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px">
          <div>
            <label style="${this._lbl()}">Data da Resposta</label>
            <input id="nf-resp-data" type="date" value="${n.resposta?.data||''}" style="${this._inp()}">
          </div>
          <div>
            <label style="${this._lbl()}">Responsável (Empresa)</label>
            <input id="nf-resp-resp" value="${f_esc(n.resposta?.responsavel||'')}"
              placeholder="Nome do representante" style="${this._inp()}">
          </div>
          <div style="grid-column:1/-1">
            <label style="${this._lbl()}">Texto da Resposta</label>
            <textarea id="nf-resp-texto" rows="4"
              placeholder="Texto da resposta recebida da empresa..."
              style="${this._inp()} resize:vertical">${f_esc(n.resposta?.texto||'')}</textarea>
          </div>
        </div>
      </div>` : ''}

      <!-- Botões -->
      <div style="display:flex;gap:10px;justify-content:flex-end;margin-top:20px">
        <button data-action="_notif_voltarPainel"
          style="padding:10px 22px;background:var(--bg-surface);border:1px solid var(--border);border-radius:8px;font-size:13px;font-weight:700;cursor:pointer;color:var(--text-primary)">
          Cancelar</button>
        <button data-action="_notif_salvarForm"
          style="padding:10px 22px;background:var(--accent);border:none;border-radius:8px;color:#fff;font-size:13px;font-weight:700;cursor:pointer">
          💾 ${n ? 'Atualizar' : 'Emitir Notificação'}</button>
      </div>
    `;
  }

  async _salvarForm() {
    const g = id => document.getElementById(id);
    const numero          = g('nf-num')?.value?.trim()    || '';
    const dataEmissao     = g('nf-data')?.value           || hoje();
    const empresa         = g('nf-empresa')?.value?.trim() || '';
    const tipo            = g('nf-tipo')?.value            || 'advertencia';
    const status          = g('nf-status')?.value          || 'emitida';
    const assunto         = g('nf-assunto')?.value?.trim() || '';
    const descricao       = g('nf-desc')?.value?.trim()    || '';
    const prazoResposta   = g('nf-prazo')?.value           || '';
    const responsavelEmissor = g('nf-resp')?.value?.trim() || '';
    const cargoEmissor    = g('nf-cargo')?.value?.trim()   || '';
    const creaEmissor     = g('nf-crea')?.value?.trim()    || '';

    if (!assunto || !descricao || !empresa) {
      window.toast?.('⚠️ Preencha empresa, assunto e descrição.','warn'); return;
    }

    const usuario = state.get('usuarioLogado')?.email || 'Sistema';
    const obraId  = state.get('obraAtivaId') || '';
    const cfg     = state.get('cfg') || {};

    // Resposta da empresa (se campos existirem)
    let resposta = undefined;
    const rData = g('nf-resp-data')?.value   || '';
    const rTexto= g('nf-resp-texto')?.value?.trim() || '';
    const rResp = g('nf-resp-resp')?.value?.trim()  || '';
    if (rTexto || rData) resposta = { data:rData, texto:rTexto, responsavel:rResp };

    const agora = new Date().toISOString();

    if (this._editId) {
      const idx = this._notifs.findIndex(n=>n.id===this._editId);
      if (idx >= 0) {
        const old = this._notifs[idx];
        this._notifs[idx] = {
          ...old, numero, dataEmissao, empresa, tipo, status, assunto, descricao,
          prazoResposta, responsavelEmissor, cargoEmissor, creaEmissor,
          obraId, nomeObra: cfg.objeto||'',
          updatedAt: agora, resposta: resposta||old.resposta,
          historico: [...(old.historico||[]), {
            data: agora, usuario, acao: 'Notificação atualizada', obs: `Status: ${status}`
          }],
        };
      }
    } else {
      const autoNum = numero || ('NOT-' + String(this._notifs.length+1).padStart(3,'0') + '/' + new Date().getFullYear());
      this._notifs.unshift({
        id: 'notif_' + Date.now(),
        _v2: true,
        numero: autoNum, dataEmissao, empresa, tipo, status,
        assunto, descricao, prazoResposta, responsavelEmissor, cargoEmissor, creaEmissor,
        obraId, nomeObra: cfg.objeto||'',
        criadoEm: agora, updatedAt: agora,
        historico: [{ data: agora, usuario, acao: 'Notificação emitida', obs: tipo }],
        resposta: resposta,
        anexos: [],
      });
    }

    try {
      await this._persistir();
      // FIX-NOTIF: sincroniza state e emite evento para o badge da topbar atualizar
      state.set('notificacoes', this._notifs);
      EventBus.emit('notificacao:salva', { total: this._notifs.length });
      window.toast?.('✅ Notificação salva!','ok');
      this._editId = null;
      this._view   = 'painel';
      this._renderPainel();
    } catch(e) { window.toast?.('❌ Erro ao salvar.','error'); }
  }

  // ══════════════════════════════════════════════════════════════════
  //  DETALHE DA NOTIFICAÇÃO
  // ══════════════════════════════════════════════════════════════════
  _renderDetalhe() {
    const n = this._notifs.find(x=>x.id===this._detId);
    if (!n) { this._view='painel'; this._renderPainel(); return; }

    const card = document.querySelector('#notificacoes .card');
    if (!card) return;

    const tipo   = TIPOS_NOTIF.find(t=>t.k===n.tipo)||TIPOS_NOTIF[0];
    const status = STATUS_NOTIF.find(s=>s.k===n.status)||STATUS_NOTIF[0];

    card.innerHTML = `
      <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:18px">
        <div style="display:flex;align-items:center;gap:10px">
          <button data-action="_notif_voltarPainel"
            style="padding:6px 12px;background:var(--bg-surface);border:1px solid var(--border);border-radius:7px;font-size:12px;cursor:pointer;color:var(--text-primary)">← Voltar</button>
          <span style="font-size:15px;font-weight:800;color:var(--text-primary)">📄 ${f_esc(n.numero||'Notificação')}</span>
          <span style="font-size:11px;background:${status.cor}22;color:${status.cor};padding:3px 10px;border-radius:10px;font-weight:700">${status.l}</span>
        </div>
        <div style="display:flex;gap:8px">
          <button data-action="_notif_mudarStatus" data-arg0="${n.id}" style="padding:7px 14px;background:var(--bg-surface);border:1px solid var(--border);border-radius:8px;font-size:11px;font-weight:700;cursor:pointer;color:var(--text-primary)">
            🔄 Mudar Status</button>
          <button data-action="_notif_gerarPDF" data-arg0="${n.id}" style="padding:7px 14px;background:#1e3a5f;border:none;border-radius:8px;font-size:11px;font-weight:700;cursor:pointer;color:#93c5fd">
            🖨️ Gerar PDF</button>
          <button data-action="_notif_editar" data-arg0="${n.id}" style="padding:7px 14px;background:var(--accent);border:none;border-radius:8px;font-size:11px;font-weight:700;cursor:pointer;color:#fff">
            ✏️ Editar</button>
        </div>
      </div>

      <!-- Dados principais -->
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-bottom:16px">
        ${this._infoBox('Tipo', tipo.i+' '+tipo.l)}
        ${this._infoBox('Empresa', n.empresa||'—')}
        ${this._infoBox('Data de Emissão', dataBR(n.dataEmissao))}
        ${this._infoBox('Prazo para Resposta', n.prazoResposta ? dataBR(n.prazoResposta) : '—', this._isPrazoVencido(n)?'#ef4444':undefined)}
        ${this._infoBox('Responsável Emissor', (n.responsavelEmissor||'—')+(n.cargoEmissor?' — '+n.cargoEmissor:''))}
        ${this._infoBox('CREA/CAU', n.creaEmissor||'—')}
      </div>

      <!-- Assunto e descrição -->
      <div style="background:var(--bg-surface);border:1px solid var(--border);border-radius:10px;padding:16px;margin-bottom:14px">
        <div style="font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:.5px;color:var(--text-muted);margin-bottom:8px">Assunto</div>
        <div style="font-size:14px;font-weight:700;color:var(--text-primary);margin-bottom:14px">${f_esc(n.assunto||'—')}</div>
        <div style="font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:.5px;color:var(--text-muted);margin-bottom:8px">Descrição Detalhada</div>
        <div style="font-size:12px;color:var(--text-primary);line-height:1.6;white-space:pre-wrap">${f_esc(n.descricao||'—')}</div>
      </div>

      <!-- Resposta da empresa -->
      ${n.resposta?.texto ? `
      <div style="background:#0d2b0d22;border:1px solid #22c55e;border-radius:10px;padding:16px;margin-bottom:14px">
        <div style="font-size:11px;font-weight:700;color:#86efac;margin-bottom:10px">✅ Resposta da Empresa</div>
        <div style="font-size:12px;color:var(--text-primary);line-height:1.6;white-space:pre-wrap;margin-bottom:8px">${f_esc(n.resposta.texto)}</div>
        <div style="font-size:11px;color:var(--text-muted)">📅 ${dataBR(n.resposta.data)} &nbsp;|&nbsp; 👤 ${f_esc(n.resposta.responsavel||'—')}</div>
      </div>` : `
      <div style="background:var(--bg-surface);border:1px solid var(--border);border-radius:10px;padding:16px;margin-bottom:14px">
        <div style="font-size:11px;font-weight:700;color:var(--text-muted);margin-bottom:10px">🏢 Registrar Resposta da Empresa</div>
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px">
          <div><label style="${this._lbl()}">Data da Resposta</label>
            <input id="det-resp-data" type="date" style="${this._inp()}"></div>
          <div><label style="${this._lbl()}">Responsável (Empresa)</label>
            <input id="det-resp-resp" placeholder="Nome" style="${this._inp()}"></div>
          <div style="grid-column:1/-1"><label style="${this._lbl()}">Texto da Resposta</label>
            <textarea id="det-resp-texto" rows="3" style="${this._inp()} resize:vertical"
              placeholder="Cole aqui o texto da resposta recebida..."></textarea></div>
        </div>
        <button data-action="_notif_salvarResposta" data-arg0="${n.id}" style="margin-top:10px;padding:8px 18px;background:#22c55e;border:none;border-radius:7px;color:#fff;font-size:12px;font-weight:700;cursor:pointer">
          ✅ Salvar Resposta</button>
      </div>`}

      <!-- Histórico de interações -->
      <div style="background:var(--bg-surface);border:1px solid var(--border);border-radius:10px;padding:16px">
        <div style="font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:.5px;color:var(--text-muted);margin-bottom:10px">
          📋 Histórico de Interações</div>
        ${(n.historico||[]).length === 0
          ? '<div style="font-size:11px;color:var(--text-muted)">Sem registros de interação.</div>'
          : (n.historico||[]).slice().reverse().map(h => `
            <div style="display:flex;gap:10px;padding:6px 0;border-bottom:1px solid var(--border);font-size:11px">
              <span style="color:var(--text-muted);flex-shrink:0;white-space:nowrap">${dataBR(h.data?.slice(0,10))}</span>
              <span style="color:var(--text-primary);flex:1"><strong>${f_esc(h.usuario||'')}</strong> — ${f_esc(h.acao||'')}
                ${h.obs ? `<span style="color:var(--text-muted)"> (${f_esc(h.obs)})</span>` : ''}</span>
            </div>`).join('')}
        <!-- Adicionar interação -->
        <div style="margin-top:12px;display:flex;gap:8px;align-items:end">
          <div style="flex:1"><label style="${this._lbl()}">Registrar observação</label>
            <input id="det-hist-obs" placeholder="Ex: Empresa notificada por e-mail..." style="${this._inp()}"></div>
          <button data-action="_notif_addHistorico" data-arg0="${n.id}" style="padding:8px 14px;background:var(--accent);border:none;border-radius:7px;color:#fff;font-size:12px;font-weight:700;cursor:pointer">
            ➕ Registrar</button>
        </div>
      </div>
    `;
  }

  // ══════════════════════════════════════════════════════════════════
  //  GERAÇÃO DE PDF OFICIAL
  // ══════════════════════════════════════════════════════════════════
  _gerarPDF(id) {
    const n = this._notifs.find(x=>x.id===id);
    if (!n) return;
    const cfg    = state.get('cfg') || {};
    const tipo   = TIPOS_NOTIF.find(t=>t.k===n.tipo)||TIPOS_NOTIF[0];
    const status = STATUS_NOTIF.find(s=>s.k===n.status)||STATUS_NOTIF[0];
    const logo   = FirebaseService.getLogo?.(n.obraId) || cfg.logo || '';

    const html = `<!DOCTYPE html><html lang="pt-BR"><head>
      <meta charset="UTF-8">
      <title>Notificação ${f_esc(n.numero||'')} — ${f_esc(cfg.contratante||'')}</title>
      <style>
        * { box-sizing:border-box; margin:0; padding:0; }
        body { font-family:'Times New Roman',serif; font-size:11pt; padding:20mm 20mm 20mm 25mm; color:#000; }
        .header { display:flex; align-items:center; gap:20px; border-bottom:3px solid #1e3a5f; padding-bottom:14px; margin-bottom:20px; }
        .logo { max-height:70px; max-width:120px; }
        .orgao { flex:1; }
        .orgao h1 { font-size:14pt; font-weight:bold; color:#1e3a5f; text-transform:uppercase; }
        .orgao p { font-size:9pt; color:#555; }
        .titulo-doc { text-align:center; margin:20px 0; }
        .titulo-doc h2 { font-size:18pt; font-weight:bold; color:#1e3a5f; text-transform:uppercase; letter-spacing:2px; }
        .titulo-doc .num { font-size:13pt; font-weight:bold; color:#374151; margin-top:6px; }
        .tipo-badge { display:inline-block; background:#1e3a5f; color:#fff; padding:4px 14px; border-radius:4px; font-size:9pt; font-weight:bold; margin-top:8px; }
        .secao { margin-bottom:16px; }
        .secao-titulo { font-size:9pt; font-weight:bold; text-transform:uppercase; letter-spacing:.5px; color:#1e3a5f; border-bottom:1px solid #1e3a5f; padding-bottom:4px; margin-bottom:8px; }
        .dados-grid { display:grid; grid-template-columns:1fr 1fr; gap:8px; }
        .dado { margin-bottom:6px; }
        .dado label { font-size:8pt; font-weight:bold; color:#555; display:block; }
        .dado span { font-size:10pt; }
        .descricao { background:#f8fafc; border-left:4px solid #1e3a5f; padding:12px 16px; margin:12px 0; white-space:pre-wrap; line-height:1.7; font-size:10.5pt; }
        .prazo-box { background:#fef3c7; border:1px solid #f59e0b; border-radius:4px; padding:10px 14px; margin:12px 0; font-weight:bold; color:#92400e; }
        .assinaturas { margin-top:60px; display:flex; justify-content:space-around; }
        .assinatura { text-align:center; width:40%; }
        .assinatura .linha { border-top:1px solid #000; padding-top:6px; margin-top:60px; font-size:9pt; }
        .footer { margin-top:30px; border-top:1px solid #ccc; padding-top:8px; font-size:8pt; color:#888; text-align:center; }
        @media print { @page { size:A4; margin:0; } body { padding:15mm 20mm; } }
      </style>
    </head><body>
      <div class="header">
        ${logo ? `<img src="${logo}" class="logo" alt="Logo">` : ''}
        <div class="orgao">
          <h1>${f_esc(cfg.contratante||'CONTRATANTE')}</h1>
          <p>Fiscalização de Contratos — Setor de Obras</p>
        </div>
      </div>

      <div class="titulo-doc">
        <h2>Notificação</h2>
        <div class="num">Nº ${f_esc(n.numero||'—')}</div>
        <div class="tipo-badge">${tipo.i} ${tipo.l}</div>
      </div>

      <div class="secao">
        <div class="secao-titulo">Dados do Contrato</div>
        <div class="dados-grid">
          <div class="dado"><label>Obra / Objeto</label><span>${f_esc(n.nomeObra||cfg.objeto||'—')}</span></div>
          <div class="dado"><label>Nº Contrato</label><span>${f_esc(cfg.contrato||'—')}</span></div>
          <div class="dado"><label>Empresa Executora</label><span>${f_esc(n.empresa||cfg.contratada||'—')}</span></div>
          <div class="dado"><label>Contratante</label><span>${f_esc(cfg.contratante||'—')}</span></div>
        </div>
      </div>

      <div class="secao">
        <div class="secao-titulo">Dados da Notificação</div>
        <div class="dados-grid">
          <div class="dado"><label>Número</label><span>${f_esc(n.numero||'—')}</span></div>
          <div class="dado"><label>Data de Emissão</label><span>${dataBR(n.dataEmissao)}</span></div>
          <div class="dado"><label>Tipo</label><span>${tipo.l}</span></div>
          <div class="dado"><label>Status</label><span>${status.l}</span></div>
          ${n.prazoResposta?`<div class="dado"><label>Prazo para Resposta</label><span>${dataBR(n.prazoResposta)}</span></div>`:''}
          <div class="dado"><label>Responsável</label><span>${f_esc(n.responsavelEmissor||'—')} ${n.creaEmissor?'— '+f_esc(n.creaEmissor):''}</span></div>
        </div>
      </div>

      <div class="secao">
        <div class="secao-titulo">Assunto</div>
        <p style="font-weight:bold;font-size:11pt">${f_esc(n.assunto||'—')}</p>
      </div>

      <div class="secao">
        <div class="secao-titulo">Descrição / Fundamentação</div>
        <div class="descricao">${f_esc(n.descricao||'—')}</div>
      </div>

      ${n.prazoResposta ? `
      <div class="prazo-box">
        ⏰ Esta notificação requer resposta até ${dataBR(n.prazoResposta)}.
        O não atendimento no prazo estipulado poderá ensejar medidas administrativas cabíveis.
      </div>` : ''}

      <div class="assinaturas">
        <div class="assinatura">
          <div class="linha">
            ${f_esc(n.responsavelEmissor||'_____________________')}<br>
            ${f_esc(n.cargoEmissor||'Fiscal de Obras')}<br>
            ${n.creaEmissor?f_esc(n.creaEmissor):''}
          </div>
        </div>
        <div class="assinatura">
          <div class="linha">
            ___________________________<br>
            Representante da Empresa<br>
            ${f_esc(n.empresa||'')}
          </div>
        </div>
      </div>

      <div class="footer">
        Documento gerado pelo Sistema Fiscal na Obra — ${new Date().toLocaleString('pt-BR')}
      </div>
      <script>window.print();<\/script>
    </body></html>`;

    const w = window.open('','_blank','width=900,height=700');
    if (w) { w.document.write(html); w.document.close(); }
    else window.toast?.('⚠️ Permita popups para gerar o PDF.','warn');
  }

  // ══════════════════════════════════════════════════════════════════
  //  RELATÓRIO GERAL
  // ══════════════════════════════════════════════════════════════════
  _relatorio() {
    const cfg  = state.get('cfg') || {};
    const lista = [...this._notifs];
    const html = `<!DOCTYPE html><html><head><meta charset="UTF-8">
      <title>Relatório de Notificações</title>
      <style>
        body{font-family:Arial,sans-serif;font-size:9pt;padding:10mm;color:#000}
        h1{font-size:13pt;color:#1e3a5f}
        .sub{color:#555;font-size:9pt;margin-bottom:14px}
        table{width:100%;border-collapse:collapse;font-size:8pt}
        th{background:#1e3a5f;color:#fff;padding:5px 8px;text-align:left}
        td{border:1px solid #ddd;padding:4px 7px}
        tr:nth-child(even){background:#f5f5f5}
        .ok{color:#16a34a;font-weight:700} .pen{color:#dc2626;font-weight:700}
        @media print{@page{size:A4 landscape;margin:8mm}}
      </style></head><body>
      <h1>🔔 Relatório de Notificações</h1>
      <div class="sub">${f_esc(cfg.objeto||'—')} | Contratante: ${f_esc(cfg.contratante||'—')} | Contratada: ${f_esc(cfg.contratada||'—')}</div>
      <div style="margin-bottom:12px;font-size:9pt">
        Total: ${lista.length} | Respondidas: ${lista.filter(n=>n.status==='respondida').length} | Pendentes: ${lista.filter(n=>n.status==='emitida'||n.status==='enviada'||n.status==='em_analise').length}
      </div>
      <table>
        <tr><th>Nº</th><th>Data</th><th>Tipo</th><th>Empresa</th><th>Assunto</th><th>Prazo</th><th>Status</th></tr>
        ${lista.map(n=>{
          const tipo   = TIPOS_NOTIF.find(t=>t.k===n.tipo)||TIPOS_NOTIF[0];
          const status = STATUS_NOTIF.find(s=>s.k===n.status)||STATUS_NOTIF[0];
          const venc   = this._isPrazoVencido(n);
          return `<tr><td>${f_esc(n.numero||'—')}</td><td>${dataBR(n.dataEmissao)}</td>
            <td>${tipo.l}</td><td>${f_esc(n.empresa||'—')}</td>
            <td>${f_esc((n.assunto||'').slice(0,60))}</td>
            <td style="${venc?'color:#dc2626;font-weight:700':''}">${dataBR(n.prazoResposta)}</td>
            <td class="${n.status==='respondida'||n.status==='encerrada'?'ok':'pen'}">${status.l}</td></tr>`;
        }).join('')}
      </table>
      <p style="font-size:8pt;color:#888;margin-top:14px">Gerado em ${new Date().toLocaleString('pt-BR')}</p>
      <script>window.print();<\/script></body></html>`;

    const w = window.open('','_blank','width=1100,height=700');
    if (w) { w.document.write(html); w.document.close(); }
  }

  // ══════════════════════════════════════════════════════════════════
  //  UTILITÁRIOS
  // ══════════════════════════════════════════════════════════════════
  _calcKpis() {
    return {
      total:       this._notifs.length,
      emitidas:    this._notifs.filter(n=>n.status==='emitida'||n.status==='enviada').length,
      pendentes:   this._notifs.filter(n=>n.status==='em_analise'||n.status==='nao_resp').length,
      vencidas:    this._notifs.filter(n=>this._isPrazoVencido(n)).length,
      respondidas: this._notifs.filter(n=>n.status==='respondida').length,
      encerradas:  this._notifs.filter(n=>n.status==='encerrada').length,
    };
  }

  _calcAlertas() {
    return this._notifs.filter(n =>
      (this._isPrazoAlerta(n) || this._isPrazoVencido(n)) &&
      n.status !== 'respondida' && n.status !== 'encerrada'
    );
  }

  _isPrazoVencido(n) {
    if (!n.prazoResposta || n.status==='respondida' || n.status==='encerrada') return false;
    return new Date(n.prazoResposta+'T23:59:59') < new Date();
  }

  _isPrazoAlerta(n) {
    if (!n.prazoResposta || n.status==='respondida' || n.status==='encerrada') return false;
    const prazo = new Date(n.prazoResposta+'T23:59:59');
    const limite = new Date(Date.now() + 5*24*3600*1000); // 5 dias
    return prazo <= limite && prazo >= new Date();
  }

  _filtrar() {
    let lista = [...this._notifs];
    const { status, tipo, dataIni, dataFim, busca } = this._filtros;
    if (status)  lista = lista.filter(n => n.status === status);
    if (tipo)    lista = lista.filter(n => n.tipo   === tipo);
    if (dataIni) lista = lista.filter(n => (n.dataEmissao||'') >= dataIni);
    if (dataFim) lista = lista.filter(n => (n.dataEmissao||'') <= dataFim);
    if (busca) {
      const q = busca.toLowerCase();
      lista = lista.filter(n =>
        (n.numero||'').toLowerCase().includes(q) ||
        (n.assunto||'').toLowerCase().includes(q) ||
        (n.empresa||'').toLowerCase().includes(q) ||
        (n.descricao||'').toLowerCase().includes(q)
      );
    }
    return lista;
  }

  _sincFiltrosHTML() {
    // Garante que campos HTML estáticos do template não interfiram
    const ini = document.getElementById('notif-filtro-ini');
    const fim = document.getElementById('notif-filtro-fim');
    if (ini) ini.value = this._filtros.dataIni;
    if (fim) fim.value = this._filtros.dataFim;
  }

  async _excluir(id) {
    if (!confirm('Excluir esta notificação? Esta ação não pode ser desfeita.')) return;
    this._notifs = this._notifs.filter(n=>n.id!==id);
    try {
      await this._persistir();
      // FIX-NOTIF: sincroniza state e emite evento para o badge atualizar
      state.set('notificacoes', this._notifs);
      EventBus.emit('notificacao:excluida', { total: this._notifs.length });
      window.toast?.('🗑️ Notificação excluída.','ok');
      this._renderPainel();
    }
    catch(e) { window.toast?.('❌ Erro ao excluir.','error'); }
  }

  async _mudarStatus(id) {
    const n = this._notifs.find(x=>x.id===id);
    if (!n) return;
    const statusAtual = n.status || 'emitida';
    const idx = STATUS_NOTIF.findIndex(s=>s.k===statusAtual);
    const proximo = STATUS_NOTIF[(idx+1) % STATUS_NOTIF.length];
    const conf = confirm(`Mudar status de "${STATUS_NOTIF[idx]?.l}" para "${proximo.l}"?`);
    if (!conf) return;
    const usuario = state.get('usuarioLogado')?.email || 'Sistema';
    n.status = proximo.k;
    n.historico = [...(n.historico||[]), {
      data: new Date().toISOString(), usuario,
      acao: 'Status alterado', obs: `${STATUS_NOTIF[idx]?.l} → ${proximo.l}`
    }];
    try { await this._persistir(); window.toast?.(`✅ Status: ${proximo.l}`,'ok'); this._view='detalhe'; this._renderDetalhe(); }
    catch(e) { window.toast?.('❌ Erro.','error'); }
  }

  async _salvarResposta(id) {
    const n = this._notifs.find(x=>x.id===id);
    if (!n) return;
    const data  = document.getElementById('det-resp-data')?.value  || '';
    const texto = document.getElementById('det-resp-texto')?.value?.trim() || '';
    const resp  = document.getElementById('det-resp-resp')?.value?.trim()  || '';
    if (!texto) { window.toast?.('⚠️ Informe o texto da resposta.','warn'); return; }
    n.resposta = { data, texto, responsavel: resp };
    n.status   = 'respondida';
    const usuario = state.get('usuarioLogado')?.email || 'Sistema';
    n.historico = [...(n.historico||[]), {
      data: new Date().toISOString(), usuario,
      acao: 'Resposta da empresa registrada', obs: resp||''
    }];
    try { await this._persistir(); window.toast?.('✅ Resposta registrada!','ok'); this._renderDetalhe(); }
    catch(e) { window.toast?.('❌ Erro.','error'); }
  }

  async _addHistorico(id) {
    const n = this._notifs.find(x=>x.id===id);
    if (!n) return;
    const obs = document.getElementById('det-hist-obs')?.value?.trim() || '';
    if (!obs) { window.toast?.('⚠️ Informe a observação.','warn'); return; }
    const usuario = state.get('usuarioLogado')?.email || 'Sistema';
    n.historico = [...(n.historico||[]), {
      data: new Date().toISOString(), usuario, acao: obs, obs: ''
    }];
    try { await this._persistir(); window.toast?.('✅ Registrado!','ok'); this._renderDetalhe(); }
    catch(e) { window.toast?.('❌ Erro.','error'); }
  }

  _container() { return document.getElementById('notif-lista'); }

  _kpi(label,valor,cor) {
    return `<div style="background:var(--bg-surface);border:1px solid var(--border);border-radius:8px;padding:10px;text-align:center">
      <div style="font-size:9px;font-weight:700;color:var(--text-muted);text-transform:uppercase;letter-spacing:.5px;margin-bottom:4px">${label}</div>
      <div style="font-size:18px;font-weight:800;color:${cor}">${valor}</div>
    </div>`;
  }

  _infoBox(label, valor, cor) {
    return `<div style="background:var(--bg-surface);border:1px solid var(--border);border-radius:8px;padding:10px 14px">
      <div style="font-size:9px;font-weight:700;color:var(--text-muted);text-transform:uppercase;letter-spacing:.5px;margin-bottom:3px">${label}</div>
      <div style="font-size:12px;font-weight:700;color:${cor||'var(--text-primary)'};">${f_esc(valor)}</div>
    </div>`;
  }

  _lbl() { return 'font-size:11px;font-weight:700;color:var(--text-muted);display:block;margin-bottom:4px'; }
  _inp() { return 'width:100%;padding:8px 10px;border-radius:7px;border:1px solid var(--border);background:var(--bg-surface);color:var(--text-primary);font-size:12px;box-sizing:border-box;'; }

  // ══════════════════════════════════════════════════════════════════
  //  EVENTOS E GLOBALS
  // ══════════════════════════════════════════════════════════════════
  _bindEvents() {
    this._subs.push(EventBus.on('obra:selecionada', async () => {
      try { await this._carregar(); if (router.current==='notificacoes') this._renderPainel(); }
      catch(e) { console.error('[NotificacoesModule]', e); }
    }, 'notificacoes'));
  }

  _exposeGlobals() {
    // Compatibilidade com template HTML estático
    window.adicionarNotificacao  = () => { try { window._notif_nova(); } catch(e){} };
    window.renderNotificacoes    = () => { try { this._renderPainel(); } catch(e){} };
    window.excluirNotificacao    = (id)=> { try { this._excluir(id); } catch(e){} };
    window.limparFiltroNotif     = () => { try { this._limparFiltros(); } catch(e){} };
    window.gerarPDFNotificacoes  = () => { try { this._relatorio(); } catch(e){} };

    // Novos globals v2
    window._notif_nova           = () => { try { this._editId=null; this._view='form'; this._renderForm(); } catch(e){} };
    window._notif_editar         = (id)=> { try { this._editId=id; this._view='form'; this._renderForm(); } catch(e){} };
    window._notif_excluir        = (id)=> { try { this._excluir(id); } catch(e){} };
    window._notif_salvarForm     = () => { try { this._salvarForm(); } catch(e){} };
    window._notif_voltarPainel   = () => { try { this._editId=null; this._view='painel'; this._renderPainel(); } catch(e){} };
    window._notif_verDetalhe     = (id)=> { try { this._detId=id; this._view='detalhe'; this._renderDetalhe(); } catch(e){} };
    window._notif_gerarPDF       = (id)=> { try { this._gerarPDF(id); } catch(e){ console.error(e); } };
    window._notif_relatorio      = () => { try { this._relatorio(); } catch(e){} };
    window._notif_mudarStatus    = (id)=> { try { this._mudarStatus(id); } catch(e){} };
    window._notif_salvarResposta = (id)=> { try { this._salvarResposta(id); } catch(e){} };
    window._notif_addHistorico   = (id)=> { try { this._addHistorico(id); } catch(e){} };
    window._notif_filtro         = (campo, valor) => {
      try { this._filtros[campo]=valor; this._renderPainel(); } catch(e){}
    };
    window._notif_limparFiltros  = () => {
      try {
        this._filtros = { status:'', tipo:'', dataIni:'', dataFim:'', busca:'' };
        this._renderPainel();
      } catch(e) {}
    };
    window.exportarCSVNotificacoes = () => {
      try {
        const TIPOS_MAP  = Object.fromEntries(TIPOS_NOTIF.map(t=>[t.k, t.l]));
        const STATUS_MAP = Object.fromEntries(STATUS_NOTIF.map(s=>[s.k, s.l]));

        // ── Cabeçalho espelha a tabela e o painel de detalhes do sistema ──
        const cabec = [
          'Nº', 'Tipo', 'Status',
          'Data Emissão', 'Prazo para Resposta',
          'Assunto', 'Descrição',
          // CORREÇÃO: campo correto é n.empresa (não n.contratada)
          'Empresa Executora',
          // CORREÇÃO: campo correto é n.responsavelEmissor (não n.fiscal)
          'Responsável Emissor', 'Cargo Emissor',
          // Resposta da empresa
          'Resposta: Data', 'Resposta: Texto', 'Resposta: Responsável',
        ];

        const linhas = this._notifs.map(n => [
          n.numero         || '',
          TIPOS_MAP[n.tipo]   || n.tipo   || '',
          STATUS_MAP[n.status]|| n.status || '',
          n.dataEmissao    || '',
          // CORREÇÃO: campo correto é prazoResposta
          n.prazoResposta  || '',
          n.assunto        || '',
          n.descricao      || '',
          // CORREÇÃO: campo correto é empresa
          n.empresa        || '',
          n.responsavelEmissor || '',
          n.cargoEmissor   || '',
          n.resposta?.data        || '',
          n.resposta?.texto       || '',
          n.resposta?.responsavel || '',
        ]);

        // Linha de total
        const emitidas   = this._notifs.filter(n=>n.status==='emitida'||n.status==='enviada').length;
        const respondidas= this._notifs.filter(n=>n.status==='respondida').length;
        const vencidas   = this._notifs.filter(n=>n.status==='nao_resp').length;
        linhas.push([]);
        linhas.push([`TOTAL: ${this._notifs.length} notificação(ões)`, '', '',
          '', '', '', '', '',
          `Emitidas/Enviadas: ${emitidas}`, `Respondidas: ${respondidas}`, `Não Respondidas: ${vencidas}`, '', '']);

        baixarCSV([cabec, ...linhas], `notificacoes_${new Date().toISOString().slice(0,10)}`);
        window.auditRegistrar?.({ modulo: 'Notificações', tipo: 'exportação', registro: `${this._notifs.length} notificações`, detalhe: 'Exportação CSV das Notificações' });
        window.toast?.('✅ CSV das Notificações exportado!', 'ok');
      } catch(e) { console.error('[Notif] exportarCSV:', e); }
    };
  }

  destroy() { this._subs.forEach(u=>u()); this._subs=[]; }
}
