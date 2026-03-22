/**
 * ╔══════════════════════════════════════════════════════════════╗
 * ║  FISCAL NA OBRA — modules/checklist-tecnico/               ║
 * ║                   checklist-tecnico-controller.js           ║
 * ║  Checklist técnico de inspeção por tipo de obra            ║
 * ╚══════════════════════════════════════════════════════════════╝
 *
 * Checklists pré-configurados para os principais tipos de obra
 * pública (UBS, escola, creche, etc.) com itens específicos de
 * conformidade técnica, normas NBR e exigências legais.
 */

import EventBus        from '../../core/EventBus.js';
import state           from '../../core/state.js';
import router          from '../../core/router.js';
import FirebaseService from '../../firebase/firebase-service.js';

const hoje = () => new Date().toISOString().slice(0, 10);

// ── Templates por tipo de obra ──────────────────────────────────────────────
const TEMPLATES = {
  ubs: {
    label: 'UBS — Unidade Básica de Saúde',
    grupos: [
      {
        id: 'acessibilidade', label: '♿ Acessibilidade (NBR 9050)',
        itens: [
          'Rampas com inclinação ≤ 8,33% e corrimão duplo',
          'Vagas de estacionamento para PCD sinalizadas (mín. 2% da área)',
          'Banheiros adaptados em todos os pavimentos',
          'Piso tátil direcional e de alerta instalado corretamente',
          'Portas com vão livre mínimo de 0,90m',
          'Balcões de atendimento com altura rebaixada (0,75–0,85m)',
          'Bebedouros com altura acessível (copo em 0,90–1,00m)',
        ],
      },
      {
        id: 'instalacoes-saude', label: '🏥 Instalações de Saúde Específicas',
        itens: [
          'Sala de vacinação: temperatura controlada (2–8°C) com termômetro calibrado',
          'Câmara fria para vacinas com alarme de temperatura',
          'Gases medicinais: rede de oxigênio e ar comprimido com pressão adequada',
          'Central de material esterilizado (CME) com autoclave instalada',
          'Sala de curativo com pia de lavagem cirúrgica (pedal)',
          'Consultórios com bacia de lavatório de mãos (torneira de cotovelo)',
          'Área de descontaminação de artigos separada',
        ],
      },
      {
        id: 'ccih', label: '🦠 Controle de Infecção (CCIH/ANVISA)',
        itens: [
          'Fluxo de resíduos de saúde Grupo A (infectante) segregado desde a origem',
          'Abrigo externo de resíduos atendendo RDC 306/ANVISA',
          'Lavatórios em todos os consultórios e áreas de procedimento',
          'Vestiário de funcionários separado de área assistencial',
          'Lixeiras de acionamento por pedal nas áreas clínicas',
        ],
      },
      {
        id: 'instalacoes', label: '⚡ Instalações Gerais',
        itens: [
          'SPDA (para-raios) instalado conforme NBR 5419',
          'Grupo gerador com carga mínima para equipamentos críticos',
          'Nobreak em equipamentos de TI e comunicação',
          'Rede de dados estruturada cat. 6 mínimo',
          'Ar-condicionado em todos os consultórios e salas de espera cobertas',
          'Sistema de alarme contra incêndio com detectores de fumaça (NBR 17240)',
          'Extintores conforme Plano de Prevenção PPCI aprovado',
        ],
      },
      {
        id: 'estrutura', label: '🏗️ Estrutura e Acabamentos',
        itens: [
          'Laudos de ensaio de concreto (resistência) arquivados por concretagem',
          'Cobertura sem infiltrações — teste de estanqueidade realizado',
          'Pisos vinílicos ou epóxi em áreas molhadas (solda térmica nas emendas)',
          'Paredes de consultórios com altura mínima de azulejo/pastilha (1,50m)',
          'Impermeabilização de banheiros testada antes do revestimento',
          'Caimento de pisos em áreas molhadas: mín. 1,5% em direção ao ralo',
        ],
      },
    ],
  },
  escola: {
    label: 'Escola / CMEI',
    grupos: [
      {
        id: 'acessibilidade', label: '♿ Acessibilidade (NBR 9050)',
        itens: [
          'Rampas de acesso com guarda-corpo e corrimão duplo',
          'Vagas PCD no estacionamento',
          'Banheiros infantis acessíveis com barras de apoio adaptadas',
          'Bebedouros em duas alturas (adulto e criança)',
          'Piso tátil em circulações principais',
        ],
      },
      {
        id: 'seguranca', label: '🔒 Segurança de Crianças',
        itens: [
          'Controle de acesso na entrada principal (interfone ou câmeras)',
          'Janelas com proteção para queda de crianças (grade/tela)',
          'Tomadas elétricas com protetor infantil em salas de aula',
          'Cantos de bancadas e mesas arredondados nas salas infantis',
          'Pátio coberto com piso antiderrapante',
          'Parquinho com certificado de conformidade (NBR 16071)',
        ],
      },
      {
        id: 'estrutura', label: '🏗️ Estrutura',
        itens: [
          'Ensaios de resistência de concreto arquivados',
          'Cobertura sem infiltrações testada',
          'Forro com resistência ao fogo (mínimo 30 minutos)',
          'Pintura anti-mofo em salas de aula',
        ],
      },
    ],
  },
  creche: {
    label: 'Creche (0–3 anos)',
    grupos: [
      {
        id: 'seguranca-bebe', label: '👶 Segurança de Bebês',
        itens: [
          'Fraldário com bancada de trocas em altura ergonômica',
          'Berçário climatizado com tomadas com protetores',
          'Sala de amamentação privativa',
          'Piso emborrachado no berçário e sala de recreação',
          'Janelas com altura mínima de peitoril de 1,10m ou grade de proteção',
        ],
      },
      {
        id: 'acessibilidade', label: '♿ Acessibilidade',
        itens: [
          'Rampas e corrimão em dupla altura',
          'Banheiros infantis com altura de pia acessível',
          'Piso tátil em circulações',
        ],
      },
    ],
  },
  habitacao: {
    label: 'Habitação Social (MCMV)',
    grupos: [
      {
        id: 'estrutura', label: '🏗️ Estrutura',
        itens: [
          'Ensaios de resistência de concreto (laudos por laje)',
          'Verificação de cobrimento das armaduras',
          'Teste de estanqueidade de cobertura',
          'Impermeabilização de banheiros e cozinha testada',
        ],
      },
      {
        id: 'acessibilidade', label: '♿ Acessibilidade',
        itens: [
          'Unidades adaptadas para PCD conforme cota mínima legal',
          'Rampa de acesso ao pavimento térreo',
          'Garagem com vagas PCD sinalizadas',
        ],
      },
      {
        id: 'acabamentos', label: '🎨 Acabamentos',
        itens: [
          'Esquadrias de alumínio com vedação anti-chuva',
          'Louças e metais instalados e testados',
          'Pintura interna e externa sem manchas ou bolhas',
          'Piso cerâmico sem diferença de nível nas emendas',
        ],
      },
    ],
  },
};

export class ChecklistTecnicoModule {
  constructor() {
    this._subs       = [];
    this._checklists = [];
    this._tipoObra   = 'ubs';
    this._editId     = null;
  }

  async init()    { this._bindEvents(); this._exposeGlobals(); }
  async onEnter() { await this._carregar(); this._render(); }

  async _carregar() {
    const obraId = state.get('obraAtivaId');
    if (!obraId) { this._checklists = []; return; }
    try {
      // FIX-E2.3: carregar do Firebase e sincronizar no state central
      const estadoCache = state.get('checklistTecnico');
      if (estadoCache && estadoCache.length > 0) {
        // Usar cache do state (evita re-fetch ao trocar de aba)
        this._checklists = estadoCache;
      } else {
        this._checklists = await FirebaseService.getChecklistTecnico(obraId);
        state.set('checklistTecnico', this._checklists);
      }
    } catch { this._checklists = []; }
  }

  async _salvar() {
    const obraId = state.get('obraAtivaId');
    if (!obraId) return;
    await FirebaseService.salvarChecklistTecnico(obraId, this._checklists);
    state.set('checklistTecnico', this._checklists); // FIX-E2.3: manter state sincronizado
  }

  _render() {
    const el = document.getElementById('checklist-tecnico-conteudo');
    if (!el) return;
    const obraId = state.get('obraAtivaId');

    if (!obraId) {
      el.innerHTML = '<div style="text-align:center;padding:40px;color:var(--text-muted);font-size:13px">Selecione uma obra para acessar os checklists.</div>';
      return;
    }

    const kpis   = this._calcKpis();
    const ultimo = this._checklists.length > 0
      ? [...this._checklists].sort((a,b) => (b.data||'').localeCompare(a.data||''))[0] : null;

    el.innerHTML = `
      <!-- KPIs -->
      <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(130px,1fr));gap:10px;margin-bottom:16px">
        ${this._kpi('Inspeções', kpis.total, 'var(--accent)')}
        ${this._kpi('Conformes', kpis.conformes, 'var(--color-success, #22c55e)')}
        ${this._kpi('Não conformes', kpis.naoConformes, 'var(--color-danger, #ef4444)')}
        ${this._kpi('Pendentes', kpis.pendentes, 'var(--color-warning, #f59e0b)')}
      </div>

      <!-- Ação -->
      <div style="display:flex;gap:8px;justify-content:flex-end;margin-bottom:14px;flex-wrap:wrap">
        <select id="ck-tipo-sel" style="padding:7px 10px;font-size:12px;border-radius:7px;border:1px solid var(--border);background:var(--bg-surface);color:var(--text-primary)"
          onchange="window._ck_setTipo(this.value)">
          ${Object.entries(TEMPLATES).map(([k,v]) => `<option value="${k}" ${this._tipoObra===k?'selected':''}>${v.label}</option>`).join('')}
        </select>
        <button data-action="_ck_iniciarNova"
          style="padding:8px 16px;background:var(--accent);border:none;border-radius:8px;color:#fff;font-size:12px;font-weight:700;cursor:pointer">
          📋 Nova Inspeção
        </button>
      </div>

      <!-- Histórico de inspeções -->
      ${this._checklists.length === 0
        ? '<div style="text-align:center;padding:48px;color:var(--text-muted);font-size:12px">📋 Nenhuma inspeção registrada. Clique em "Nova Inspeção" para iniciar.</div>'
        : this._checklists
            .sort((a,b) => (b.data||'').localeCompare(a.data||''))
            .map(c => this._cardInspecao(c)).join('')
      }

      <!-- Modal overlay -->
      <div id="ck-overlay" data-action="if" data-arg0="event.target===this)window._ck_fecharModal("
        style="display:none;position:fixed;inset:0;background:rgba(0,0,0,.6);z-index:1000;overflow-y:auto;padding:20px;box-sizing:border-box">
        <div id="ck-modal"
          style="background:var(--bg-card);border:1px solid var(--border);border-radius:14px;padding:24px;width:min(100%,680px);margin:auto;
          box-shadow:0 20px 60px rgba(0,0,0,.45)"></div>
      </div>
    `;
  }

  _calcKpis() {
    const cs = this._checklists;
    let conf = 0, nconf = 0, pend = 0;
    cs.forEach(c => {
      const itens = Object.values(c.respostas || {});
      itens.forEach(r => {
        if (r === 'conforme')     conf++;
        else if (r === 'nao')     nconf++;
        else                      pend++;
      });
    });
    return { total: cs.length, conformes: conf, naoConformes: nconf, pendentes: pend };
  }

  _kpi(label, valor, cor) {
    return `<div style="background:var(--bg-surface);border:1px solid var(--border);border-radius:8px;padding:12px;text-align:center">
      <div style="font-size:9px;font-weight:700;color:var(--text-muted);text-transform:uppercase;letter-spacing:.5px;margin-bottom:5px">${label}</div>
      <div style="font-size:20px;font-weight:800;color:${cor}">${valor}</div>
    </div>`;
  }

  _cardInspecao(c) {
    const tpl      = TEMPLATES[c.tipoObra] || TEMPLATES.ubs;
    const totalIt  = tpl.grupos.reduce((s,g) => s + g.itens.length, 0);
    const resp     = c.respostas || {};
    const nResp    = Object.values(resp).filter(v => v !== 'pendente').length;
    const nConf    = Object.values(resp).filter(v => v === 'conforme').length;
    const nNao     = Object.values(resp).filter(v => v === 'nao').length;
    const pct      = totalIt > 0 ? Math.round((nResp/totalIt)*100) : 0;
    const dataBR   = c.data ? new Date(c.data+'T12:00:00').toLocaleDateString('pt-BR') : '—';

    return `
      <div style="background:var(--bg-surface);border:1px solid var(--border);border-radius:10px;padding:14px;margin-bottom:10px;
        border-left:3px solid ${nNao > 0 ? 'var(--color-danger, #ef4444)' : nResp === totalIt ? 'var(--color-success, #22c55e)' : 'var(--color-warning, #f59e0b)'}">
        <div style="display:flex;align-items:flex-start;justify-content:space-between;gap:10px;flex-wrap:wrap">
          <div>
            <div style="font-size:13px;font-weight:700;color:var(--text-primary);margin-bottom:4px">${tpl.label}</div>
            <div style="font-size:11px;color:var(--text-muted)">📅 ${dataBR} &nbsp;|&nbsp; 👤 ${c.fiscal || '—'}</div>
            <div style="display:flex;gap:10px;margin-top:6px;font-size:11px;flex-wrap:wrap">
              <span style="color:var(--color-success, #22c55e)">✅ ${nConf} conformes</span>
              <span style="color:var(--color-danger, #ef4444)">❌ ${nNao} não conformes</span>
              <span style="color:var(--color-warning, #f59e0b)">⏳ ${totalIt - nResp} pendentes</span>
            </div>
            <div style="margin-top:6px;background:var(--bg-card);border-radius:4px;height:6px;width:200px;overflow:hidden">
              <div style="height:100%;width:${pct}%;background:${nNao>0?'var(--color-danger, #ef4444)':'var(--color-success, #22c55e)'};border-radius:4px;transition:width .3s"></div>
            </div>
            <div style="font-size:10px;color:var(--text-muted);margin-top:2px">${pct}% preenchido</div>
          </div>
          <div style="display:flex;gap:6px;flex-shrink:0">
            <button data-action="_ck_abrirInspecao" data-arg0="${c.id}" style="padding:6px 12px;font-size:11px;background:var(--accent);border:none;border-radius:7px;color:#fff;cursor:pointer;font-weight:700">
              ${nResp === totalIt ? '👁️ Ver' : '✏️ Continuar'}
            </button>
            <button data-action="_ck_excluir" data-arg0="${c.id}" style="padding:6px 12px;font-size:11px;background:var(--color-danger-bg, #fee2e2);border:1px solid var(--color-danger-light, #fca5a5);border-radius:7px;color:var(--color-danger-dark, #dc2626);cursor:pointer">🗑️</button>
          </div>
        </div>
      </div>
    `;
  }

  _iniciarNova() {
    const tpl    = TEMPLATES[this._tipoObra];
    const insp   = {
      id:        `ck_${Date.now()}`,
      tipoObra:  this._tipoObra,
      data:      hoje(),
      fiscal:    state.get('usuarioLogado')?.displayName || '',
      respostas: {},
      obs:       {},
    };
    this._checklists.push(insp);
    this._abrirModal(insp.id);
  }

  _abrirModal(id) {
    const overlay = document.getElementById('ck-overlay');
    const modal   = document.getElementById('ck-modal');
    if (!overlay || !modal) { this._render(); setTimeout(() => this._abrirModal(id), 60); return; }

    const insp = this._checklists.find(c => c.id === id);
    if (!insp) return;
    const tpl  = TEMPLATES[insp.tipoObra] || TEMPLATES.ubs;
    this._editId = id;

    modal.innerHTML = `
      <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:18px;flex-wrap:wrap;gap:10px">
        <div>
          <h3 style="margin:0 0 4px;font-size:15px;font-weight:800;color:var(--text-primary)">📋 ${tpl.label}</h3>
          <div style="font-size:11px;color:var(--text-muted)">Data da inspeção: <input type="date" id="ck-data" value="${insp.data}"
            style="border:none;background:transparent;color:var(--text-muted);font-size:11px;cursor:pointer"
            onchange="window._ck_setData(this.value)">
          &nbsp;|&nbsp; Fiscal: <input type="text" id="ck-fiscal" value="${insp.fiscal}" placeholder="Nome do fiscal"
            style="border:none;background:transparent;color:var(--text-muted);font-size:11px;width:160px"
            onchange="window._ck_setFiscal(this.value)"></div>
        </div>
        <button data-action="_ck_fecharModal"
          style="background:none;border:none;cursor:pointer;font-size:18px;color:var(--text-muted)">✕</button>
      </div>

      ${tpl.grupos.map(grupo => `
        <div style="margin-bottom:18px">
          <div style="font-size:12px;font-weight:700;color:var(--text-primary);margin-bottom:8px;padding-bottom:6px;border-bottom:1px solid var(--border)">
            ${grupo.label}
          </div>
          ${grupo.itens.map((item, idx) => {
            const key  = `${grupo.id}_${idx}`;
            const resp = insp.respostas?.[key] || 'pendente';
            const obs  = insp.obs?.[key] || '';
            return `
              <div style="padding:10px;background:${resp==='conforme'?'var(--color-success-bg, #dcfce7)20':resp==='nao'?'var(--color-danger-bg, #fee2e2)20':'var(--bg-surface)'};
                border-radius:8px;margin-bottom:6px;border:1px solid ${resp==='conforme'?'var(--color-success, #22c55e)40':resp==='nao'?'var(--color-danger, #ef4444)40':'var(--border)'}">
                <div style="font-size:12px;color:var(--text-primary);margin-bottom:8px">${item}</div>
                <div style="display:flex;gap:6px;flex-wrap:wrap;align-items:center">
                  <button data-action="_ck_resp" data-arg0="${id}" data-arg1="${key}" data-arg2="conforme"
                    style="padding:4px 10px;font-size:11px;font-weight:700;border-radius:6px;cursor:pointer;
                    background:${resp==='conforme'?'var(--color-success-dark, #16a34a)':'var(--bg-card)'};color:${resp==='conforme'?'#fff':'var(--color-success, #22c55e)'};
                    border:1px solid ${resp==='conforme'?'var(--color-success-dark, #16a34a)':'var(--color-success, #22c55e)'}">✅ Conforme</button>
                  <button data-action="_ck_resp" data-arg0="${id}" data-arg1="${key}" data-arg2="nao"
                    style="padding:4px 10px;font-size:11px;font-weight:700;border-radius:6px;cursor:pointer;
                    background:${resp==='nao'?'var(--color-danger-dark, #dc2626)':'var(--bg-card)'};color:${resp==='nao'?'#fff':'var(--color-danger, #ef4444)'};
                    border:1px solid ${resp==='nao'?'var(--color-danger-dark, #dc2626)':'var(--color-danger, #ef4444)'}">❌ Não conforme</button>
                  <button data-action="_ck_resp" data-arg0="${id}" data-arg1="${key}" data-arg2="na"
                    style="padding:4px 10px;font-size:11px;font-weight:700;border-radius:6px;cursor:pointer;
                    background:${resp==='na'?'var(--text-muted)':'var(--bg-card)'};color:${resp==='na'?'#fff':'var(--text-muted)'};
                    border:1px solid var(--border)">N/A</button>
                  <input type="text" placeholder="Observação..." value="${obs}"
                    onchange="window._ck_obs('${id}','${key}',this.value)"
                    style="flex:1;min-width:120px;padding:4px 8px;font-size:11px;border-radius:6px;border:1px solid var(--border);background:var(--bg-card);color:var(--text-primary)">
                </div>
              </div>
            `;
          }).join('')}
        </div>
      `).join('')}

      <div style="display:flex;gap:8px;justify-content:flex-end;margin-top:16px;position:sticky;bottom:0;background:var(--bg-card);padding:12px 0 0">
        <button data-action="_ck_fecharModal"
          style="padding:9px 18px;background:var(--bg-surface);border:1px solid var(--border);border-radius:8px;font-size:12px;font-weight:700;cursor:pointer;color:var(--text-primary)">
          Fechar
        </button>
        <button data-action="_ck_salvar"
          style="padding:9px 18px;background:var(--accent);border:none;border-radius:8px;color:#fff;font-size:12px;font-weight:700;cursor:pointer">
          💾 Salvar Inspeção
        </button>
      </div>
    `;

    overlay.style.display = 'block';
  }

  _fecharModal() {
    const overlay = document.getElementById('ck-overlay');
    if (overlay) overlay.style.display = 'none';
    this._editId = null;
    this._render();
  }

  async _salvarModal() {
    try {
      await this._salvar();
      window.toast?.('✅ Inspeção salva!', 'ok');
    } catch (e) {
      window.toast?.('❌ Erro ao salvar.', 'error');
    }
  }

  async _excluir(id) {
    // FIX-E3.3: ConfirmComponent em vez de confirm() nativo
    const _okExcluirCk = await window._confirm('Excluir esta inspeção técnica?', { labelOk: 'Excluir', danger: true });
    if (!_okExcluirCk) return;
    this._checklists = this._checklists.filter(c => c.id !== id);
    try { await this._salvar(); window.toast?.('🗑️ Inspeção excluída.', 'ok'); this._render(); }
    catch (e) { window.toast?.('❌ Erro.', 'error'); }
  }

  _setResposta(checkId, key, valor) {
    const insp = this._checklists.find(c => c.id === checkId);
    if (!insp) return;
    if (!insp.respostas) insp.respostas = {};
    insp.respostas[key] = valor;
    // Atualiza visual do botão sem re-renderizar o modal inteiro
    this._abrirModal(checkId);
  }

  _setObs(checkId, key, valor) {
    const insp = this._checklists.find(c => c.id === checkId);
    if (!insp) return;
    if (!insp.obs) insp.obs = {};
    insp.obs[key] = valor;
  }

  _bindEvents() {
    this._subs.push(EventBus.on('obra:selecionada', async () => {
      try { await this._carregar(); if (router.current === 'checklist-tecnico') this._render(); }
      catch (e) {}
    }, 'checklist-tecnico'));
  }

  _exposeGlobals() {
    window._ck_iniciarNova  = ()           => this._iniciarNova();
    window._ck_abrirInspecao= id           => this._abrirModal(id);
    window._ck_fecharModal  = ()           => this._fecharModal();
    window._ck_salvar       = () => {
      // FIX-E3.2: protege contra duplo salvamento de inspeção
      const btn = document.querySelector('[data-action="_ck_salvar"]');
      import('../../utils/loading.js').then(({ withLoading }) => {
        withLoading(btn, () => this._salvarModal(), {
          labelLoading: 'Salvando inspeção...',
          labelDone: 'Salvo!',
        }).catch(e => window.toast?.('❌ Erro ao salvar: ' + e.message, 'error'));
      });
    };
    window._ck_excluir      = id           => this._excluir(id).catch(console.error);
    window._ck_setTipo      = v            => { this._tipoObra = v; };
    window._ck_resp         = (cid, k, v)  => this._setResposta(cid, k, v);
    window._ck_obs          = (cid, k, v)  => this._setObs(cid, k, v);
    window._ck_setData      = v => { const insp = this._checklists.find(c => c.id === this._editId); if (insp) insp.data = v; };
    window._ck_setFiscal    = v => { const insp = this._checklists.find(c => c.id === this._editId); if (insp) insp.fiscal = v; };
  }

  destroy() { this._subs.forEach(u => u()); this._subs = []; }
}
