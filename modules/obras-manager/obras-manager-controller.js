/**
 * ╔══════════════════════════════════════════════════════════════╗
 * ║  FISCAL NA OBRA v15.1 — obras-manager-controller.js           ║
 * ║  Módulo RECRIADO: Cadastro e Gerenciamento de Obras         ║
 * ╚══════════════════════════════════════════════════════════════╝
 * Recriado do zero: cadastro manual + importação Excel/PDF
 * Padrão modular preservado (EventBus, state, router, FirebaseService)
 */

import EventBus        from '../../core/EventBus.js';
import state           from '../../core/state.js';
import router          from '../../core/router.js';
import { formatters }  from '../../utils/formatters.js';
import FirebaseService from '../../firebase/firebase-service.js';

function gerarId(prefix = 'obra') {
  return `${prefix}_${Date.now().toString(16)}_${Math.random().toString(16).slice(2, 8)}`;
}

export class ObrasManagerModule {
  constructor() {
    this._subs       = [];
    this._aba        = 'lista';
    this._criandoObra = false; // idempotência — evita duplo-clique criar 2 obras
  }

  async init() {
    try { this._bindEvents(); this._exposeGlobals(); }
    catch (e) { console.error('[ObrasManagerModule] init:', e); }
  }

  onEnter() {
    try { this._aba = 'lista'; this._render(); }
    catch (e) { console.error('[ObrasManagerModule] onEnter:', e); }
  }

  // ═══════════════════════════════════════════════════════════════
  //  RENDER PRINCIPAL
  // ═══════════════════════════════════════════════════════════════
  _render() {
    const container = document.getElementById('obras-manager-conteudo');
    if (!container) return;

    container.innerHTML = `
      <div style="display:flex;gap:0;border-bottom:2px solid var(--border);margin-bottom:20px">
        ${this._tabBtn('lista',   '🏗️',  'Minhas Obras')}
        ${this._tabBtn('nova',    '✏️',  'Criar Manual')}
        ${this._tabBtn('importar','📥', 'Importar Planilha')}
      </div>
      <div id="obm-aba-content"></div>`;

    ['lista','nova','importar'].forEach(aba =>
      document.getElementById('obm-tab-' + aba)?.addEventListener('click', () => {
        this._aba = aba; this._render();
      })
    );
    this._renderAba();
  }

  _tabBtn(aba, icon, label) {
    const a = this._aba === aba;
    return `<button id="obm-tab-${aba}" style="display:flex;align-items:center;gap:6px;padding:10px 18px;
      border:none;border-bottom:3px solid ${a?'var(--accent)':'transparent'};background:none;
      font-size:13px;font-weight:${a?'700':'500'};color:${a?'var(--text-primary)':'var(--text-muted)'};
      cursor:pointer;transition:all .15s;white-space:nowrap">${icon} ${label}</button>`;
  }

  _renderAba() {
    const el = document.getElementById('obm-aba-content');
    if (!el) return;
    if (this._aba === 'lista')    this._renderLista(el);
    if (this._aba === 'nova')     this._renderFormNova(el);
    if (this._aba === 'importar') this._renderImportar(el);
  }

  // ─── LISTA DE OBRAS ────────────────────────────────────────────
  _renderLista(el) {
    const obras   = state.get('obrasLista') || [];
    const ativaId = state.get('obraAtivaId') || '';

    if (!obras.length) {
      el.innerHTML = `
        <div style="text-align:center;padding:60px 20px">
          <div style="font-size:52px;margin-bottom:16px">🏗️</div>
          <div style="font-size:17px;font-weight:700;color:var(--text-primary);margin-bottom:8px">Nenhuma obra cadastrada</div>
          <div style="font-size:13px;color:var(--text-muted);margin-bottom:24px">
            Crie uma obra manualmente ou importe uma planilha orçamentária.
          </div>
          <div style="display:flex;justify-content:center;gap:12px;flex-wrap:wrap">
            <button class="btn btn-primary" data-action="_obm_irAba" data-arg0="nova">✏️ Criar Manualmente</button>
            <button class="btn btn-cinza"   data-action="_obm_irAba" data-arg0="importar">📥 Importar Planilha</button>
          </div>
        </div>`;
      return;
    }

    const ativas  = obras.filter(o => (o.statusObra||'') !== 'Concluída');
    const concl   = obras.filter(o => (o.statusObra||'') === 'Concluída');
    let html = '';

    if (ativas.length) {
      html += `<div style="font-size:10px;font-weight:700;color:var(--text-muted);text-transform:uppercase;
        letter-spacing:1px;margin-bottom:10px">Em andamento — ${ativas.length}</div>
        <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(300px,1fr));gap:12px;margin-bottom:24px">
        ${ativas.map(o => this._cardObra(o, ativaId)).join('')}</div>`;
    }
    if (concl.length) {
      html += `<div style="font-size:10px;font-weight:700;color:var(--text-muted);text-transform:uppercase;
        letter-spacing:1px;margin-bottom:10px">🏆 Concluídas — ${concl.length}</div>
        <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(300px,1fr));gap:12px;margin-bottom:24px">
        ${concl.map(o => this._cardObra(o, ativaId)).join('')}</div>`;
    }

    html += `<div style="display:flex;gap:10px;margin-top:8px;flex-wrap:wrap">
      <button class="btn btn-primary" data-action="_obm_irAba" data-arg0="nova">✏️ + Nova Obra</button>
      <button class="btn btn-cinza"   data-action="_obm_irAba" data-arg0="importar">📥 Importar Planilha</button>
    </div>`;
    el.innerHTML = html;
  }

  _cardObra(obra, ativaId) {
    const ativa  = obra.id === ativaId;
    const status = obra.statusObra || 'Em andamento';
    const cfg    = ativa ? (state.get('cfg') || {}) : {};
    const sc     = status === 'Concluída' ? '#16a34a' : status === 'Paralisada' ? '#dc2626' : '#2563eb';
    const sb     = status === 'Concluída' ? '#f0fdf4' : status === 'Paralisada' ? '#fef2f2' : '#eff6ff';
    const valorHtml = ativa && cfg.valor
      ? `<div style="font-size:11px;color:var(--text-muted);margin-top:2px;font-family:var(--font-mono)">
          ${formatters.currency(cfg.valor)}</div>` : '';

    return `<div style="background:var(--bg-card);border:2px solid ${ativa?'var(--accent)':'var(--border)'};
      border-radius:12px;padding:16px 18px;display:flex;flex-direction:column;gap:10px;
      box-shadow:${ativa?'0 0 0 4px rgba(0,0,0,.06)':'var(--shadow-sm)'}">
      <div style="display:flex;align-items:flex-start;justify-content:space-between;gap:8px">
        <div style="flex:1;min-width:0">
          ${ativa?`<span style="font-size:9px;font-weight:800;background:var(--accent);color:#fff;padding:2px 7px;
            border-radius:4px;letter-spacing:.5px;display:inline-block;margin-bottom:5px">✓ ATIVA</span>`:''}
          <div style="font-size:14px;font-weight:700;color:var(--text-primary);overflow:hidden;text-overflow:ellipsis;white-space:nowrap">
            ${obra.nome||obra.id}</div>
          ${valorHtml}
        </div>
        <span style="font-size:10px;font-weight:700;padding:3px 9px;border-radius:99px;
          background:${sb};color:${sc};flex-shrink:0;border:1px solid ${sc}33">${status}</span>
      </div>
      <div style="display:flex;gap:8px;flex-wrap:wrap">
        ${!ativa ? `<button class="btn btn-primary btn-sm" data-action="_obm_selecionar" data-arg0="${obra.id}" >✓ Selecionar</button>` :
          `<button class="btn btn-cinza btn-sm" data-action="verPagina" data-arg0="dashboard" style="font-weight:600">📊 Dashboard</button>`}
                <button data-action="_obm_excluir" data-arg0="${obra.id}" data-arg1="${obra.nome||''}"
          style="padding:5px 10px;background:transparent;border:1px solid #fca5a5;border-radius:6px;
          color:#ef4444;font-size:11px;font-weight:600;cursor:pointer">🗑️</button>
      </div>
    </div>`;
  }

  // ─── FORMULÁRIO NOVA OBRA ──────────────────────────────────────
  _renderFormNova(el) {
    el.innerHTML = `
      <div style="max-width:700px">
        <div style="font-size:15px;font-weight:800;color:var(--text-primary);margin-bottom:4px">✏️ Nova Obra — Cadastro Manual</div>
        <div style="font-size:12px;color:var(--text-muted);margin-bottom:20px">Preencha os dados contratuais. Campos com * são obrigatórios.</div>

        <div style="background:var(--bg-surface);border:1px solid var(--border);border-radius:10px;padding:20px;margin-bottom:14px">
          <div style="font-size:10px;font-weight:700;color:var(--text-muted);text-transform:uppercase;letter-spacing:.7px;margin-bottom:14px">📋 Identificação</div>
          <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px">
            ${this._campo('obm-nome','Objeto / Nome da Obra *','Ex: Pavimentação Rua das Flores','text','',true)}
            ${this._campo('obm-contrato','Nº do Contrato','Ex: 001/2024','text')}
            ${this._campo('obm-contratante','Contratante','Ex: Prefeitura Municipal','text')}
            ${this._campo('obm-contratada','Contratada','Ex: Construtora XYZ Ltda','text')}
          </div>
        </div>

        <div style="background:var(--bg-surface);border:1px solid var(--border);border-radius:10px;padding:20px;margin-bottom:14px">
          <div style="font-size:10px;font-weight:700;color:var(--text-muted);text-transform:uppercase;letter-spacing:.7px;margin-bottom:14px">💰 Financeiro e Prazo</div>
          <div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:12px">
            ${this._campo('obm-valor','Valor Contrato (R$)','500000.00','number')}
            ${this._campo('obm-bdi','BDI (%)','25','number','25')}
            ${this._campo('obm-duracao','Duração (dias)','180','number')}
            ${this._campo('obm-inicio','Data de Início','','date')}
            ${this._campo('obm-termino','Data de Término','','date')}
            ${this._campoSelect('obm-modo','Modo de Cálculo',[['truncar','✂️ Truncar (TCU)'],['arredondar','🔢 Arredondar']])}
          </div>
        </div>

        <div style="background:var(--bg-surface);border:1px solid var(--border);border-radius:10px;padding:20px;margin-bottom:18px">
          <div style="font-size:10px;font-weight:700;color:var(--text-muted);text-transform:uppercase;letter-spacing:.7px;margin-bottom:14px">👷 Responsáveis</div>
          <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px">
            ${this._campo('obm-fiscal','Fiscal do Contrato','Nome completo','text')}
            ${this._campo('obm-crea-fiscal','CREA / CAU do Fiscal','Ex: CREA/SP 12345','text')}
            ${this._campo('obm-rt','Responsável Técnico','Nome completo','text')}
            ${this._campo('obm-crea-rt','CREA / CAU do RT','Ex: CREA/SP 99999','text')}
          </div>
        </div>

        <div id="obm-erro" style="display:none;padding:10px 14px;background:#fef2f2;border:1px solid #fca5a5;
          border-radius:7px;color:#dc2626;font-size:12px;margin-bottom:14px"></div>

        <div style="display:flex;gap:10px">
          <button id="obm-btn-salvar" style="padding:11px 26px;background:var(--accent);border:none;border-radius:8px;
            color:#fff;font-size:13px;font-weight:800;cursor:pointer">💾 Criar Obra</button>
          <button data-action="_obm_irAba" data-arg0="lista" style="padding:11px 20px;background:transparent;
            border:1px solid var(--border);border-radius:8px;color:var(--text-muted);font-size:13px;cursor:pointer">← Voltar</button>
        </div>
      </div>`;

    document.getElementById('obm-btn-salvar')?.addEventListener('click', () => this._salvarNovaObra());
  }

  _campo(id, label, placeholder, type='text', value='', required=false) {
    return `<div>
      <label style="display:block;font-size:10px;font-weight:700;color:var(--text-muted);
        text-transform:uppercase;letter-spacing:.7px;margin-bottom:5px">${label}</label>
      <input type="${type}" id="${id}" placeholder="${placeholder}" value="${value}"
        style="width:100%;box-sizing:border-box;background:var(--bg-card);border:1px solid var(--border);
          border-radius:7px;color:var(--text-primary);font-size:13px;padding:9px 12px;outline:none;transition:border-color .15s"
        onfocus="this.style.borderColor='var(--accent)'" onblur="this.style.borderColor='var(--border)'"
        ${required?'required':''}></div>`;
  }

  _campoSelect(id, label, opcoes) {
    return `<div>
      <label style="display:block;font-size:10px;font-weight:700;color:var(--text-muted);
        text-transform:uppercase;letter-spacing:.7px;margin-bottom:5px">${label}</label>
      <select id="${id}" style="width:100%;box-sizing:border-box;background:var(--bg-card);border:1px solid var(--border);
        border-radius:7px;color:var(--text-primary);font-size:13px;padding:9px 12px;outline:none">
        ${opcoes.map(([v,l]) => `<option value="${v}">${l}</option>`).join('')}
      </select></div>`;
  }

  // ─── IMPORTAR ──────────────────────────────────────────────────
  _renderImportar(el) {
    el.innerHTML = `
      <div style="max-width:600px">
        <div style="font-size:15px;font-weight:800;color:var(--text-primary);margin-bottom:4px">📥 Importar Planilha Orçamentária</div>
        <div style="font-size:12px;color:var(--text-muted);margin-bottom:22px">
          Importe um arquivo Excel ou PDF com o orçamento. O sistema identifica automaticamente as colunas.
        </div>

        <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-bottom:20px">
          <div style="background:var(--bg-surface);border:1px solid var(--border);border-radius:10px;padding:16px">
            <div style="font-size:24px;margin-bottom:8px">📊</div>
            <div style="font-size:13px;font-weight:700;color:var(--text-primary);margin-bottom:4px">Excel</div>
            <div style="font-size:11px;color:var(--text-muted)">Arquivos <strong>.xlsx</strong> e <strong>.xls</strong></div>
          </div>
          <div style="background:var(--bg-surface);border:1px solid var(--border);border-radius:10px;padding:16px">
            <div style="font-size:24px;margin-bottom:8px">📄</div>
            <div style="font-size:13px;font-weight:700;color:var(--text-primary);margin-bottom:4px">PDF</div>
            <div style="font-size:11px;color:var(--text-muted)">PDFs com tabelas orçamentárias</div>
          </div>
        </div>

        <div style="background:#eff6ff;border:1px solid #bfdbfe;border-radius:10px;padding:14px;margin-bottom:20px">
          <div style="font-size:12px;font-weight:700;color:#1d4ed8;margin-bottom:8px">✨ Colunas detectadas automaticamente:</div>
          <div style="display:grid;grid-template-columns:1fr 1fr;gap:3px">
            ${['1. Item','2. Código','3. Banco','4. Descrição','5. Und. Medida','6. Quantidade','7. Preço Unit.','8. Preço c/ BDI','9. Total']
              .map(c=>`<div style="font-size:11px;color:#3b82f6">✓ ${c}</div>`).join('')}
          </div>
          <div style="font-size:11px;color:#64748b;margin-top:8px">
            Variações aceitas (ex: "Cod.", "Código"). Mapeamento manual disponível se necessário.
          </div>
        </div>

        <button id="obm-btn-ir-import" style="width:100%;padding:14px;background:var(--accent);border:none;
          border-radius:10px;color:#fff;font-size:14px;font-weight:800;cursor:pointer;
          display:flex;align-items:center;justify-content:center;gap:10px">
          📥 Abrir Módulo de Importação
        </button>
      </div>`;

    document.getElementById('obm-btn-ir-import')?.addEventListener('click', () => router.navigate('importacao'));
  }

  // ─── SALVAR NOVA OBRA ──────────────────────────────────────────
  async _salvarNovaObra() {
    // CORREÇÃO BUG-DUPLICAÇÃO: flag de idempotência evita que duplo-clique
    // crie duas obras com IDs diferentes mas o mesmo conteúdo.
    if (this._criandoObra) return;
    this._criandoObra = true;

    const g = id => document.getElementById(id)?.value?.trim() || '';
    const erroEl = document.getElementById('obm-erro');
    const btnEl  = document.getElementById('obm-btn-salvar');

    const nome = g('obm-nome');
    if (!nome) {
      if (erroEl) { erroEl.textContent = '⚠️ O nome/objeto da obra é obrigatório.'; erroEl.style.display = 'block'; }
      document.getElementById('obm-nome')?.focus();
      this._criandoObra = false;
      return;
    }

    // CORREÇÃO BUG-DUPLICAÇÃO: verifica se já existe obra com mesmo nome
    // antes de criar, para evitar duplicatas ao reenviar o formulário.
    const obrasExistentes = state.get('obrasLista') || [];
    const nomeNorm = nome.trim().toLowerCase();
    const jaExiste = obrasExistentes.some(o =>
      o.nome?.trim().toLowerCase() === nomeNorm && !o._excluida
    );
    if (jaExiste) {
      if (erroEl) {
        erroEl.textContent = `⚠️ Já existe uma obra com o nome "${nome}". Verifique antes de criar.`;
        erroEl.style.display = 'block';
      }
      this._criandoObra = false;
      return;
    }

    if (erroEl) erroEl.style.display = 'none';
    if (btnEl) { btnEl.disabled = true; btnEl.textContent = '⏳ Criando obra...'; }

    try {
      // CORREÇÃO BUG-DUPLICAÇÃO: usa crypto.randomUUID() quando disponível,
      // garantindo unicidade global. Fallback para gerarId() com timestamp + random.
      const obraId = (typeof crypto !== 'undefined' && crypto.randomUUID)
        ? `obra_${crypto.randomUUID().replace(/-/g, '').slice(0, 20)}`
        : gerarId('obra');

      const bdi    = (parseFloat(g('obm-bdi')) || 25) / 100;

      let termino = g('obm-termino');
      const inicio = g('obm-inicio');
      if (!termino && inicio && g('obm-duracao')) {
        const d = new Date(inicio);
        d.setDate(d.getDate() + parseInt(g('obm-duracao')));
        termino = d.toISOString().split('T')[0];
      }

      const cfg = {
        objeto: nome, contrato: g('obm-contrato'), contratante: g('obm-contratante'),
        contratada: g('obm-contratada'), valor: parseFloat(g('obm-valor').replace(/[^\d.]/g,'')) || 0,
        bdi, duracaoDias: parseInt(g('obm-duracao')) || 0, inicioPrev: inicio, inicioReal: '', termino,
        fiscal: g('obm-fiscal'), creaFiscal: g('obm-crea-fiscal'), rt: g('obm-rt'), creaRT: g('obm-crea-rt'),
        modoCalculo: g('obm-modo') || 'truncar', tipoObra: 'prefeitura', cnpj: '',
      };

      const bms = [{ num:1, label:'BM 01', mes:'(a definir)', data:'', contractVersion:1 }];

      await FirebaseService.criarObra(obraId, nome, 'prefeitura', cfg, bms, []);

      // CORREÇÃO BUG-DUPLICAÇÃO: adiciona ao state apenas se ainda não estiver lá
      // (proteção extra contra race condition em redes lentas)
      const listaAtual = state.get('obrasLista') || [];
      if (!listaAtual.find(o => o.id === obraId)) {
        state.set('obrasLista', [...listaAtual, { id: obraId, nome, tipo: 'prefeitura', statusObra: 'Em andamento' }]);
      }
      state.set('obraAtivaId', obraId); state.set('cfg', cfg);
      state.set('bms', bms); state.set('itensContrato', []);
      state.persist(['obraAtivaId']);

      EventBus.emit('obra:criada',      { obraId, nome });
      EventBus.emit('obra:selecionada', { obraId });

      window.auditRegistrar?.({ modulo: 'Obras Manager', tipo: 'criação', registro: `Obra: ${nome}`, detalhe: `Nova obra criada (ID: ${obraId})` });
      window.toast?.(`✅ Obra "${nome}" criada com sucesso!`, 'ok');
      router.navigate('dashboard');

    } catch (err) {
      console.error('[ObrasManagerModule] _salvarNovaObra:', err);
      if (erroEl) { erroEl.textContent = `❌ Erro: ${err.message}`; erroEl.style.display = 'block'; }
      if (btnEl) { btnEl.disabled = false; btnEl.textContent = '💾 Criar Obra'; }
    } finally {
      // Sempre libera o flag — permite nova tentativa após erro
      this._criandoObra = false;
    }
  }

  async _selecionarObra(obraId) {
    try {
      // FIX-E2.5: invalidar cache da obra anterior antes de trocar,
      // garantindo que nenhum módulo renderize dados financeiros cruzados.
      const obraAnterior = state.get('obraAtivaId');
      if (obraAnterior && obraAnterior !== obraId) {
        try {
          const { invalidarCacheMedicoes } = await import(
            '../boletim-medicao/bm-calculos.js'
          );
          invalidarCacheMedicoes(obraAnterior);
        } catch (eCache) {
          console.warn('[ObrasManagerModule] invalidarCache:', eCache);
        }
        // Limpar chaves PAC do state para forçar re-fetch na nova obra
        state.set('etapasPac',          []);
        state.set('checklistTecnico',   []);
        state.set('fotosMedicao',       []);
        state.set('qualidadeMateriais', []);
      }

      // ── FIX: carrega cfg, bms e itens da nova obra ANTES de emitir obra:selecionada ──
      // Sem isso, todos os módulos que ouvem obra:selecionada (incluindo o BM)
      // renderizam com o cfg da obra ANTERIOR — tipoObra errado, coluna CAIXA ausente, etc.
      state.set('obraAtivaId', obraId);
      state.persist(['obraAtivaId']);

      try {
        const [cfg, bms, itens] = await Promise.all([
          FirebaseService.getObraCfg(obraId).catch(() => null),
          FirebaseService.getBMs(obraId).catch(() => null),
          FirebaseService.getItens(obraId).catch(() => null),
        ]);
        if (cfg)                   state.set('cfg',           cfg);
        if (bms   && bms.length)   state.set('bms',           bms);
        if (itens && itens.length) state.set('itensContrato', itens);
      } catch (eLoad) {
        console.warn('[ObrasManagerModule] _selecionarObra — erro ao carregar dados:', eLoad);
      }

      EventBus.emit('obra:selecionada', { obraId });
      window.toast?.('✅ Obra selecionada!', 'ok');
      router.navigate('dashboard');
    } catch (e) { console.error('[ObrasManagerModule] _selecionarObra:', e); }
  }

  async _excluirObra(obraId, nome) {
    const _okExcluirObra = await window._confirm(
      `Excluir a obra <strong>"${nome}"</strong>?`,
      { title: '🗑️ Excluir obra', labelOk: 'Excluir', danger: true, detail: 'Esta ação não pode ser desfeita.' }
    );
    if (!_okExcluirObra) return;

    console.log('[DELETE OBRA] Iniciando exclusão pelo Obras Manager:', obraId, nome);

    try {
      // 1. Executa exclusão completa no Firestore (subcoleções + documento principal)
      //    deleteObra já remove da lista persistida e invalida todos os caches
      await FirebaseService.deleteObra?.(obraId);

      // 2. Atualiza state local imediatamente (sem aguardar Firebase)
      const lista = (state.get('obrasLista') || []).filter(o => o.id !== obraId);
      state.set('obrasLista', lista);

      // 3. Persiste a lista atualizada explicitamente no Firestore
      //    Garante que nenhum fluxo posterior possa recriar o documento excluído
      try {
        await FirebaseService.salvarObrasLista(lista);
        console.log('[DELETE OBRA] Lista de obras atualizada no Firestore');
      } catch (eLista) {
        console.warn('[DELETE OBRA] Aviso ao persistir lista:', eLista.message);
      }

      // 4. Se era a obra ativa, limpa COMPLETAMENTE o estado e cancela listeners
      if (state.get('obraAtivaId') === obraId) {
        const proxima = lista[0]?.id || '';

        // Emite evento para que módulos com onSnapshot cancelem seus listeners
        // ANTES de trocar obraAtivaId — evita callbacks em dados da obra excluída
        EventBus.emit('obra:excluida', { obraId });

        // Limpa todos os dados da obra excluída do state
        state.set('obraAtivaId',    proxima);
        state.set('cfg',            {});
        state.set('bms',            []);
        state.set('itensContrato',  []);
        state.set('notificacoes',   []);
        state.set('ocorrencias',    []);
        state.set('diario',         []);
        state.set('documentos',     []);
        state.set('historico',      []);

        // Limpa sessionStorage/localStorage para que F5 não recarregue a obra excluída
        state.persist(['obraAtivaId']);
        try { sessionStorage.removeItem(`cfg_${obraId}`);      } catch (_) {}
        try { sessionStorage.removeItem(`bms_${obraId}`);      } catch (_) {}
        try { sessionStorage.removeItem(`itens_${obraId}`);    } catch (_) {}
        try { localStorage.removeItem(`cfg_${obraId}`);        } catch (_) {}
        try { localStorage.removeItem(`obraAtivaId`);          } catch (_) {}

        if (proxima) {
          EventBus.emit('obra:selecionada', { obraId: proxima });
        }
      } else {
        // Obra excluída não era a ativa — apenas notifica
        EventBus.emit('obra:excluida', { obraId });
      }

      window.auditRegistrar?.({
        modulo: 'Obras Manager', tipo: 'exclusão',
        registro: `Obra: ${nome} (ID: ${obraId})`,
        detalhe: 'Obra e subcoleções excluídas definitivamente do Firestore. Lista persistida.',
      });
      window.toast?.(`🗑️ Obra "${nome}" excluída definitivamente.`, 'warn');
      console.log('[DELETE OBRA] Exclusão concluída:', obraId);
      this._render();
    } catch (e) {
      console.error('[DELETE OBRA] Erro na exclusão:', e);
      window.toast?.('❌ Erro ao excluir. Verifique a conexão e tente novamente.', 'error');
    }
  }

  _bindEvents() {
    const reload = () => { if (router.current === 'obras-manager') this._render(); };
    this._subs.push(
      EventBus.on('obra:criada',      reload, 'obras-manager'),
      EventBus.on('obra:excluida',    reload, 'obras-manager'),
      EventBus.on('obra:selecionada', reload, 'obras-manager'),
      // FIX-7: atualiza lista de obras quando nome/configurações forem alteradas
      EventBus.on('config:salva',     reload, 'obras-manager'),
    );
  }

  _exposeGlobals() {
    window._obm_selecionar     = id      => this._selecionarObra(id);
    window._obm_excluir        = (id,nm) => this._excluirObra(id, nm);
    window._obm_irAba          = aba     => { this._aba = aba; this._render(); };
    window.renderObrasSwitcher = ()      => this._render();
    window.trocarObra          = id      => this._selecionarObra(id);
  }

  destroy() { this._subs.forEach(u => u()); this._subs = []; }
}
