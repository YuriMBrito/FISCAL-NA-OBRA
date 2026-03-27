/**
 * ╔══════════════════════════════════════════════════════════════╗
 * ║  FISCAL NA OBRA v15.1 — modules/config/config-controller.js  ║
 * ║  Módulo: ConfigModule — IMPLEMENTAÇÃO COMPLETA             ║
 * ╚══════════════════════════════════════════════════════════════╝
 *
 * • Carrega dados da obra via state.get('cfg')
 * • Exibe e permite edição de todos os campos contratuais
 * • Alimentado automaticamente pela importação de planilhas
 * • Persiste via FirebaseService.setObraCfg()
 */

import EventBus        from '../../core/EventBus.js';
import state           from '../../core/state.js';
import router          from '../../core/router.js';
import { validarCNPJ } from '../../utils/server-validators.js';
import { formatters }  from '../../utils/formatters.js';
import FirebaseService from '../../firebase/firebase-service.js';
import storageUtils    from '../../utils/storage.js';

const R$ = v => formatters.currency ? formatters.currency(v)
  : (v||0).toLocaleString('pt-BR',{style:'currency',currency:'BRL'});

export class ConfigModule {
  constructor() {
    this._subs       = [];
    this._unsubWatch = null; // FIX-E3.4: unsubscribe do watchCfg
  }

  async init() {
    try { this._bindEvents(); this._exposeGlobals(); }
    catch (e) { console.error('[ConfigModule] init:', e); }
  }

  onEnter() {
    try { this._renderCfg(); }
    catch (e) { console.error('[ConfigModule] onEnter:', e); }
    // Renderiza log de auditoria (se módulo disponível)
    try { setTimeout(() => window.renderAuditLog?.(), 100); } catch(e) {}
    // Renderiza lixeira de itens excluídos
    try { setTimeout(() => this._renderLixeira(), 200); } catch(e) {}
  }

  // ═══════════════════════════════════════════════════════════════
  //  PREENCHER FORMULÁRIO HTML
  // ═══════════════════════════════════════════════════════════════
  _renderCfg() {
    const obraId = state.get('obraAtivaId');
    const cfg    = state.get('cfg') || {};
    const bms    = state.get('bms') || [];
    const itens  = state.get('itensContrato') || [];

    // ── Campos do formulário HTML existente ────────────────────
    this._setVal('cfgContrato',    cfg.contrato    || '');
    this._setVal('cfgBdi',         ((cfg.bdi||0)*100).toFixed(2));
    this._setVal('cfgBdiReduzido', ((cfg.bdiReduzido||0.10)*100).toFixed(2));
    this._setVal('cfgObjeto',      cfg.objeto      || '');
    this._setVal('cfgApelido',     cfg.apelido     || '');
    this._setVal('cfgContratante', cfg.contratante || '');
    this._setVal('cfgContratada',  cfg.contratada  || '');
    this._setVal('cfgCnpj',        cfg.cnpj        || '');
    this._setVal('cfgValor',       cfg.valor       || '');
    this._setVal('cfgInicioPrev',  cfg.inicioPrev  || '');
    this._setVal('cfgInicioReal',  cfg.inicioReal  || '');
    this._setVal('cfgDuracaoDias', cfg.duracaoDias || '');
    this._setVal('cfgTermino',     cfg.termino     || '');
    this._setVal('cfgFiscal',      cfg.fiscal      || '');
    this._setVal('cfgCreaFiscal',  cfg.creaFiscal  || '');
    this._setVal('cfgRT',          cfg.rt          || '');
    this._setVal('cfgCreaRT',      cfg.creaRT      || '');
    this._setVal('cfgCnpjContratante', cfg.cnpjContratante || '');
    const modeEl = document.getElementById('cfgModoCalculo');
    if (modeEl) modeEl.value = cfg.modoCalculo || 'truncar';

    // ── Campos extras injetados (processo, unidade) ────────────
    this._renderCamposExtras(cfg);

    // ── Status da obra ─────────────────────────────────────────
    this._renderStatus(obraId);

    // ── BMs na config ──────────────────────────────────────────
    this._renderBMs(obraId, bms, itens, cfg);

    // ── Banner de origem dos dados ─────────────────────────────
    this._renderBannerOrigem(cfg);
  }

  _setVal(id, val) {
    const el = document.getElementById(id);
    if (!el) return;
    el.value = val ?? '';
  }

  _renderBannerOrigem(cfg) {
    // Injeta badge informativo após o form-grid se dados vieram de importação
    let wrap = document.querySelector('#config .card');
    if (!wrap) return;
    let banner = document.getElementById('cfg-origem-banner');
    if (!banner) {
      banner = document.createElement('div');
      banner.id = 'cfg-origem-banner';
      wrap.insertBefore(banner, wrap.querySelector('.form-grid'));
    }
    if (cfg._importadoEm) {
      banner.innerHTML = `
        <div style="display:flex;align-items:center;gap:10px;padding:10px 14px;border-radius:8px;
          background:#f0fdf4;border:1px solid #86efac;margin-bottom:14px">
          <span style="font-size:16px">✅</span>
          <div>
            <div style="font-size:12px;font-weight:700;color:#15803d">
              Dados importados automaticamente da planilha
            </div>
            <div style="font-size:11px;color:#166534;margin-top:1px">
              Importado em ${new Date(cfg._importadoEm).toLocaleDateString('pt-BR')} —
              você pode editar e salvar as alterações abaixo.
            </div>
            <div style="font-size:10px;color:#166534;margin-top:4px">
              Campos importados: <strong>Fiscal do Contrato · CREA/CAU · CNPJ Contratada · CNPJ Contratante</strong>
            </div>
          </div>
        </div>`;
    } else if (cfg.objeto || cfg.contrato) {
      banner.innerHTML = `
        <div style="display:flex;align-items:center;gap:10px;padding:10px 14px;border-radius:8px;
          background:#eff6ff;border:1px solid #bfdbfe;margin-bottom:14px">
          <span style="font-size:16px">ℹ️</span>
          <span style="font-size:12px;color:#1d4ed8">
            Os dados abaixo são carregados automaticamente ao importar uma planilha.
            Você pode editá-los e salvar a qualquer momento.
          </span>
        </div>`;
    } else {
      banner.innerHTML = `
        <div style="display:flex;align-items:center;gap:10px;padding:10px 14px;border-radius:8px;
          background:#fffbeb;border:1px solid #fde68a;margin-bottom:14px">
          <span style="font-size:16px">💡</span>
          <span style="font-size:12px;color:#92400e">
            Importe uma planilha orçamentária para preencher automaticamente os campos abaixo.
            <a href="javascript:void(0)" data-action="verPagina" data-arg0="importacao"
              style="color:#b45309;font-weight:700;text-decoration:underline">
              Ir para Importação →
            </a>
          </span>
        </div>`;
    }
  }

  _renderCamposExtras(cfg) {
    // Helper inline para campos CAIXA
    const _cfgCampo = (label, id, value, placeholder) => `<div>
      <label style="font-size:10px;font-weight:700;color:#1d4ed8;display:block;margin-bottom:3px">${label}</label>
      <input id="${id}" value="${String(value || '').replace(/"/g, '&quot;')}" placeholder="${placeholder}"
        style="width:100%;padding:7px 9px;border-radius:6px;border:1px solid #bfdbfe;
          background:#fff;color:#1e3a5f;font-size:11px;box-sizing:border-box">
    </div>`;
    // Injeta campos Nº Processo e Unidade Responsável se não existirem no HTML
    const formGrid = document.querySelector('#config .form-grid');
    if (!formGrid) return;

    // ── Campo CNPJ Contratante ──────────────────────────────────
    if (!document.getElementById('cfgCnpjContratante')) {
      const dCnpjCte = document.createElement('div');
      dCnpjCte.className = 'campo';
      const isImp = !!cfg._importadoEm && !!cfg.cnpjContratante;
      dCnpjCte.innerHTML = `<label>CNPJ da Contratante${isImp ? ' <span style="font-size:9px;background:#dcfce7;color:#15803d;padding:1px 5px;border-radius:4px;font-weight:700">✅ importado</span>' : ''}</label>
        <input id="cfgCnpjContratante" value="${cfg.cnpjContratante||''}" placeholder="Ex: 00.000.000/0001-00">`;
      formGrid.appendChild(dCnpjCte);
    } else {
      this._setVal('cfgCnpjContratante', cfg.cnpjContratante||'');
    }

    if (!document.getElementById('cfgProcesso')) {
      const d1 = document.createElement('div');
      d1.className = 'campo';
      d1.innerHTML = `<label>Nº do Processo</label>
        <input id="cfgProcesso" value="${cfg.numeroProcesso||''}" placeholder="Ex: 2024/00123">`;
      formGrid.appendChild(d1);
    } else {
      this._setVal('cfgProcesso', cfg.numeroProcesso||'');
    }

    if (!document.getElementById('cfgUnidade')) {
      const d2 = document.createElement('div');
      d2.className = 'campo';
      d2.innerHTML = `<label>Unidade Responsável</label>
        <input id="cfgUnidade" value="${cfg.unidadeResponsavel||''}" placeholder="Ex: Secretaria de Obras">`;
      formGrid.appendChild(d2);
    } else {
      this._setVal('cfgUnidade', cfg.unidadeResponsavel||'');
    }

    // ── Padrão da Obra (Prefeitura / CAIXA) ──────────────────
    // Campo que define o comportamento do Boletim de Medição.
    // CAIXA: habilita Memória de Cálculo e preenchimento por % executado total.
    if (!document.getElementById('cfgTipoObra')) {
      const dTipo = document.createElement('div');
      dTipo.className = 'campo';
      const tipoAtual = cfg.tipoObra || 'prefeitura';
      dTipo.innerHTML = `
        <label>Padrão da Obra
          <span style="font-size:9px;background:#dbeafe;color:#1d4ed8;padding:1px 6px;
            border-radius:4px;font-weight:700;margin-left:5px">Define o BM</span>
        </label>
        <select id="cfgTipoObra"
          style="width:100%;padding:8px 10px;border-radius:7px;border:1px solid var(--border);
            background:var(--bg-surface);color:var(--text-primary);font-size:12px"
          onchange="window._cfgToggleCaixaCampos?.()">
          <option value="prefeitura" ${tipoAtual==='prefeitura'?'selected':''}>🏛️ Prefeitura / Padrão</option>
          <option value="caixa"      ${tipoAtual==='caixa'     ?'selected':''}>🏦 CAIXA Econômica Federal</option>
        </select>
        <div style="font-size:10px;color:var(--text-muted);margin-top:4px">
          ${tipoAtual==='caixa'
            ? '🏦 <strong style="color:#2563eb">Padrão CAIXA ativo</strong> — BM preenchido por % executado · Memória de cálculo disponível'
            : '🏛️ Padrão Prefeitura — BM preenchido manualmente por quantidades'
          }
        </div>`;
      formGrid.appendChild(dTipo);
    } else {
      const sel = document.getElementById('cfgTipoObra');
      if (sel) sel.value = cfg.tipoObra || 'prefeitura';
    }

    // ── Campos exclusivos CAIXA ───────────────────────────────────
    const tipoObraAtual = (document.getElementById('cfgTipoObra')?.value || cfg.tipoObra || 'prefeitura');
    const mostrarCaixa  = tipoObraAtual === 'caixa';

    // Container único para todos os campos CAIXA (evita duplicatas)
    let caixaWrap = document.getElementById('cfg-caixa-campos-extra');
    if (!caixaWrap) {
      caixaWrap = document.createElement('div');
      caixaWrap.id = 'cfg-caixa-campos-extra';
      caixaWrap.style.cssText = `
        grid-column:1/-1;padding:12px 14px;border:1px solid #3b82f6;border-radius:10px;
        background:#eff6ff;margin-top:4px;display:${mostrarCaixa ? 'block' : 'none'}`;
      caixaWrap.innerHTML = `
        <div style="font-size:11px;font-weight:800;color:#1d4ed8;margin-bottom:10px;
          display:flex;align-items:center;gap:6px">
          🏦 Campos do BM Padrão CAIXA
        </div>
        <div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:10px">
          ${_cfgCampo('Nº TC/CR',              'cfgTcCr',              cfg.tcCr              || '', 'Ex: 1032682-96')}
          ${_cfgCampo('Nº CONVÊNIO',           'cfgConvenio',          cfg.convenio          || '', 'Ex: 830020/2016')}
          ${_cfgCampo('GIGOV',                 'cfgGigov',             cfg.gigov             || '', 'Ex: IT - ITABUNA')}
          ${_cfgCampo('GESTOR',                'cfgGestor',            cfg.gestor            || '', 'Ex: MCID')}
          ${_cfgCampo('PROGRAMA',              'cfgPrograma',          cfg.programa          || '', 'Ex: MCID - MINISTÉRIO DAS CIDADES')}
          ${_cfgCampo('AÇÃO / MODALIDADE',     'cfgAcaoModalidade',    cfg.acaoModalidade    || '', 'Ex: PAVIMENTAÇÃO')}
          ${_cfgCampo('DATA ASSINATURA',       'cfgDataAssinatura',    cfg.dataAssinatura    || '', 'Ex: 28/11/2024')}
          ${_cfgCampo('MUNICÍPIO / UF',        'cfgMunicipioUf',       cfg.municipioUf       || '', 'Ex: MUCURI-BA')}
          ${_cfgCampo('LOCALIDADE / ENDEREÇO', 'cfgLocalidade',        cfg.localidade        || '', 'Endereço completo da obra')}
          ${_cfgCampo('Nº CTEF',               'cfgNCtef',             cfg.nCtef             || '', 'Ex: CE07-24')}
          ${_cfgCampo('ART/RRT',               'cfgArtRrt',            cfg.artRrt            || '', 'Ex: BA20240683224')}
          ${_cfgCampo('Representante do Tomador', 'cfgRepresentanteTomador', cfg.representanteTomador || '', 'Nome do representante')}
          ${_cfgCampo('Cargo do Representante', 'cfgCargoRepresentante', cfg.cargoRepresentante || '', 'Ex: Prefeito Municipal')}
          ${_cfgCampo('Local e Data (rodapé)',  'cfgLocalData',         cfg.localData         || '', 'Ex: MUCURI / BA, 09 de dezembro de 2025')}
          ${_cfgCampo('Grau de Sigilo',         'cfgGrauSigilo',        cfg.grauSigilo        || '#PUBLICO', 'Ex: #PUBLICO')}
        </div>`;
      formGrid.appendChild(caixaWrap);
    } else {
      caixaWrap.style.display = mostrarCaixa ? 'block' : 'none';
      // Atualiza valores
      const sv = (id, v) => { const el = document.getElementById(id); if (el) el.value = v || ''; };
      sv('cfgTcCr',              cfg.tcCr              || '');
      sv('cfgConvenio',          cfg.convenio          || '');
      sv('cfgGigov',             cfg.gigov             || '');
      sv('cfgGestor',            cfg.gestor            || '');
      sv('cfgPrograma',          cfg.programa          || '');
      sv('cfgAcaoModalidade',    cfg.acaoModalidade    || '');
      sv('cfgDataAssinatura',    cfg.dataAssinatura    || '');
      sv('cfgMunicipioUf',       cfg.municipioUf       || '');
      sv('cfgLocalidade',        cfg.localidade        || '');
      sv('cfgNCtef',             cfg.nCtef             || '');
      sv('cfgArtRrt',            cfg.artRrt            || '');
      sv('cfgRepresentanteTomador', cfg.representanteTomador || '');
      sv('cfgCargoRepresentante',   cfg.cargoRepresentante   || '');
      sv('cfgLocalData',         cfg.localData         || '');
      sv('cfgGrauSigilo',        cfg.grauSigilo        || '#PUBLICO');
    }

    // Expõe toggle global para o onchange do select
    window._cfgToggleCaixaCampos = () => {
      const v = document.getElementById('cfgTipoObra')?.value;
      const w = document.getElementById('cfg-caixa-campos-extra');
      if (w) w.style.display = v === 'caixa' ? 'block' : 'none';
    };
  }

  // ═══════════════════════════════════════════════════════════════
  //  STATUS DA OBRA
  // ═══════════════════════════════════════════════════════════════
  _renderStatus(obraId) {
    const infoEl   = document.getElementById('cfg-status-obra-info');
    const acoesEl  = document.getElementById('cfg-status-obra-acoes');
    if (!infoEl || !acoesEl) return;

    const obrasLista = state.get('obrasLista') || [];
    const obraRef    = obrasLista.find(o => o.id === obraId) || {};
    const status     = obraRef.statusObra || 'Em andamento';
    const nomeObra   = obraRef.nome || obraId;

    const cores  = {'Em andamento':'#2563eb','Paralisada':'#dc2626','Concluída':'#16a34a'};
    const icons  = {'Em andamento':'🔵','Paralisada':'🔴','Concluída':'🟢'};
    const cor    = cores[status] || '#475569';

    infoEl.innerHTML = `
      <div style="display:inline-flex;align-items:center;gap:8px;padding:7px 14px;border-radius:99px;
        background:${cor}18;border:1px solid ${cor}44;font-size:13px;font-weight:700;color:${cor}">
        ${icons[status]||'🔵'} ${status}
      </div>`;

    acoesEl.innerHTML = `
      <div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap">
        <select id="cfg-sel-status" style="font-size:12px;padding:6px 10px;border-radius:6px;
          border:1px solid var(--border);background:var(--bg-card);color:var(--text-primary)">
          <option ${status==='Em andamento'?'selected':''}>Em andamento</option>
          <option ${status==='Paralisada'?'selected':''}>Paralisada</option>
          <option ${status==='Concluída'?'selected':''}>Concluída</option>
        </select>
        <button class="btn btn-cinza btn-sm" data-action="_cfgSalvarStatus">
          ✅ Atualizar Status
        </button>
        <div style="width:1px;height:28px;background:var(--border);margin:0 4px"></div>
        <button class="btn btn-sm" data-action="_cfgExcluirObra"
          style="background:#dc262618;border:1px solid #dc262644;color:#dc2626;font-weight:700;font-size:11px;padding:5px 12px;border-radius:6px;cursor:pointer;transition:all .15s"
          onmouseover="this.style.background='#dc262630'" onmouseout="this.style.background='#dc262618'">
          🗑️ Excluir Obra
        </button>
      </div>`;
  }

  // ═══════════════════════════════════════════════════════════════
  //  BMs NA CONFIG
  // ═══════════════════════════════════════════════════════════════
  _renderBMs(obraId, bms, itens, cfg) {
    const tbody = document.getElementById('config-bms-lista');
    if (!tbody) return;
    if (!bms.length) {
      tbody.innerHTML = `<tr><td colspan="6" style="text-align:center;padding:16px;color:var(--text-muted);font-size:12px">
        Nenhum BM cadastrado.</td></tr>`;
      return;
    }
    try {
      const { getValorAcumuladoTotal, getValorAcumuladoAnterior } =
        /* dynamic import cache */ window._bmCalcModule || {};

      tbody.innerHTML = bms.map(bm => {
        let vBm=0, vAcum=0;
        try {
          if (getValorAcumuladoTotal) {
            vAcum = getValorAcumuladoTotal(obraId, bm.num, itens, cfg);
            vBm   = vAcum - (getValorAcumuladoAnterior(obraId, bm.num, itens, cfg)||0);
          }
        } catch {}
        return `
          <tr>
            <td class="td-c" style="font-weight:700">${bm.label||`BM ${bm.num}`}</td>
            <td>${bm.mes||'—'}</td>
            <td class="td-c">${bm.data||'—'}</td>
            <td class="td-r" style="font-family:var(--font-mono)">${R$(vBm)}</td>
            <td class="td-r" style="font-family:var(--font-mono)">${R$(vAcum)}</td>
            <td class="td-c" style="white-space:nowrap">
              <button class="btn btn-cinza btn-sm" style="padding:2px 8px;font-size:10px"
                data-action="_cfgEditarBM" data-arg0="${bm.num}">✏️</button>
              <button class="btn btn-vermelho btn-sm" style="padding:2px 8px;font-size:10px"
                data-action="_cfgExcluirBM" data-arg0="${bm.num}">🗑️</button>
            </td>
          </tr>`;
      }).join('');
    } catch(e) {
      tbody.innerHTML = bms.map(bm => `
        <tr>
          <td class="td-c" style="font-weight:700">${bm.label||`BM ${bm.num}`}</td>
          <td>${bm.mes||'—'}</td>
          <td class="td-c">${bm.data||'—'}</td>
          <td class="td-r">—</td><td class="td-r">—</td>
          <td class="td-c">
            <button class="btn btn-cinza btn-sm" style="padding:2px 8px;font-size:10px"
              data-action="_cfgEditarBM" data-arg0="${bm.num}">✏️</button>
            <button class="btn btn-vermelho btn-sm" style="padding:2px 8px;font-size:10px"
              data-action="_cfgExcluirBM" data-arg0="${bm.num}">🗑️</button>
          </td>
        </tr>`).join('');
    }
  }

  // ═══════════════════════════════════════════════════════════════
  //  SALVAR CONFIGURAÇÕES
  // ═══════════════════════════════════════════════════════════════
  async _salvarConfig() {
    const obraId = state.get('obraAtivaId');
    if (!obraId) {
      window.toast?.('⚠️ Nenhuma obra ativa.','warn'); return;
    }
    const g  = id => (document.getElementById(id)?.value||'').trim();
    const gn = id => parseFloat(document.getElementById(id)?.value||'')||0;

    const cfgAtual = state.get('cfg') || {};
    const bdiPct   = gn('cfgBdi');
    const cfgNova  = {
      ...cfgAtual,
      contrato:          g('cfgContrato'),
      bdi:               bdiPct / 100,
      bdiReduzido:       gn('cfgBdiReduzido') / 100 || 0.10,
      modoCalculo:       g('cfgModoCalculo') || 'truncar',
      objeto:            g('cfgObjeto').toUpperCase() || cfgAtual.objeto || '',
      contratante:       g('cfgContratante'),
      contratada:        g('cfgContratada'),
      cnpj:              g('cfgCnpj'),
      valor:             gn('cfgValor'),
      inicioPrev:        g('cfgInicioPrev'),
      inicioReal:        g('cfgInicioReal'),
      duracaoDias:       parseInt(document.getElementById('cfgDuracaoDias')?.value||'0')||0,
      termino:           g('cfgTermino'),
      fiscal:            g('cfgFiscal'),
      creaFiscal:        g('cfgCreaFiscal'),
      rt:                g('cfgRT'),
      creaRT:            g('cfgCreaRT'),
      cnpjContratante:   g('cfgCnpjContratante'),
      numeroProcesso:    g('cfgProcesso'),
      unidadeResponsavel:g('cfgUnidade'),
      apelido:           g('cfgApelido'),
      tipoObra:          (document.getElementById('cfgTipoObra')?.value || cfgAtual.tipoObra || 'prefeitura'),
      // ── Campos exclusivos CAIXA ──────────────────────────────
      tcCr:              g('cfgTcCr'),
      convenio:          g('cfgConvenio'),
      gigov:             g('cfgGigov'),
      gestor:            g('cfgGestor'),
      programa:          g('cfgPrograma'),
      acaoModalidade:    g('cfgAcaoModalidade'),
      dataAssinatura:    g('cfgDataAssinatura'),
      municipioUf:       g('cfgMunicipioUf'),
      localidade:        g('cfgLocalidade'),
      nCtef:             g('cfgNCtef'),
      artRrt:            g('cfgArtRrt'),
      representanteTomador: g('cfgRepresentanteTomador'),
      cargoRepresentante:   g('cfgCargoRepresentante'),
      localData:         g('cfgLocalData'),
      grauSigilo:        g('cfgGrauSigilo') || '#PUBLICO',
    };

    // ── Validação CNPJ client-side (substitui Cloud Function validarCNPJContratado)
    // Migrado para client-side para funcionar no plano Spark (gratuito) do Firebase.
    if (cfgNova.cnpj && !validarCNPJ(cfgNova.cnpj)) {
      window.toast?.('⚠️ CNPJ da Contratada inválido. Verifique os dígitos e tente novamente.', 'warn');
      document.getElementById('cfgCnpj')?.focus();
      return;
    }
    if (cfgNova.cnpjContratante && !validarCNPJ(cfgNova.cnpjContratante)) {
      window.toast?.('⚠️ CNPJ da Contratante inválido. Verifique os dígitos e tente novamente.', 'warn');
      document.getElementById('cfgCnpjContratante')?.focus();
      return;
    }

    const obrasLista = state.get('obrasLista') || [];
    // FIX-3: passar o statusObra real da obra, não o tipoObra.
    // Antes passava tipoObra ('prefeitura') como 3º argumento de setObraCfg,
    // que o usava como statusObra → campo statusObra do cfg ficava como "prefeitura".
    const obraRefCfg   = obrasLista.find(o => o.id === obraId) || {};
    const statusAtual  = obraRefCfg.statusObra || 'Em andamento';

    try {
      await FirebaseService.setObraCfg?.(obraId, cfgNova, statusAtual);
      state.set('cfg', cfgNova);

      // Atualiza nome da obra na lista
      const idx = obrasLista.findIndex(o => o.id === obraId);
      if (idx >= 0 && cfgNova.objeto) {
        obrasLista[idx].nome = cfgNova.objeto.slice(0,100);
        state.set('obrasLista', obrasLista);
      }

      EventBus.emit('config:salva', { obraId });
      window.auditRegistrar?.({ modulo: 'Config', tipo: 'edição', registro: `Obra: ${cfgNova.objeto || obraId}`, detalhe: 'Configurações do contrato atualizadas' });
      window.toast?.('✅ Configurações salvas!','ok');
      this._renderCfg();
    } catch (err) {
      console.error('[ConfigModule] _salvarConfig:', err);
      window.toast?.(`❌ Erro ao salvar: ${err.message}`,'err');
    }
  }

  // ═══════════════════════════════════════════════════════════════
  //  STATUS DA OBRA — salvar
  // ═══════════════════════════════════════════════════════════════
  async _salvarStatus() {
    const obraId    = state.get('obraAtivaId');
    const novoStatus= document.getElementById('cfg-sel-status')?.value;
    if (!obraId || !novoStatus) return;
    try {
      const lista = state.get('obrasLista') || [];
      const idx   = lista.findIndex(o => o.id === obraId);
      if (idx >= 0) { lista[idx].statusObra = novoStatus; state.set('obrasLista', lista); }
      await FirebaseService.atualizarObra?.(obraId, { statusObra: novoStatus });
      this._renderStatus(obraId);
      EventBus.emit('config:salva', { obraId });
      window.toast?.('✅ Status atualizado!','ok');
    } catch (err) { window.toast?.(`❌ Erro: ${err.message}`,'err'); }
  }

  // ═══════════════════════════════════════════════════════════════
  //  EXCLUIR OBRA — SOFT DELETE (move para lixeira, não apaga)
  //
  //  FIX-EXCLUIR-1: limpa obraAtivaId de TODOS os storages para que
  //  o listener auth:login não recarregue a obra excluída após F5.
  //  FIX-EXCLUIR-2: zera cfg/bms/itensContrato do state imediatamente,
  //  impedindo que outros módulos reconstruam a obra na lista.
  // ═══════════════════════════════════════════════════════════════
  async _excluirObra() {
    const obraId = state.get('obraAtivaId');
    if (!obraId) { window.toast?.('⚠️ Nenhuma obra ativa.','warn'); return; }

    const lista   = state.get('obrasLista') || [];
    const obraRef = lista.find(o => o.id === obraId) || {};
    const nome    = obraRef.nome || obraId;

    if (!confirm(`⚠️ Mover a obra para a Lixeira?\n\n"${nome}"\n\nVocê poderá restaurá-la em Configurações → Itens Excluídos.`)) return;

    try {
      window.toast?.('⏳ Movendo para a lixeira...','info');

      const user = state.get('usuarioLogado') || {};
      const meta = {
        excluidoPor:  { uid: user.uid || '', email: user.email || 'desconhecido', nome: user.displayName || user.email || 'Usuário' },
        moduloOrigem: 'config',
        obraId,
      };

      storageUtils.lixeiraEnviar('obra', nome, { obraRef }, meta);
      await FirebaseService.softDeleteObra(obraId, meta);

      // FIX-EXCLUIR-1: remove da lista e persiste ausência
      const novaLista = lista.filter(o => o.id !== obraId);
      state.set('obrasLista', novaLista);

      // FIX-EXCLUIR-2: zera dados transientes para evitar reconstrução
      state.set('cfg',           {});
      state.set('bms',           []);
      state.set('itensContrato', []);

      const proxima = novaLista[0];
      if (proxima) {
        state.set('obraAtivaId', proxima.id);
        state.persist(['obraAtivaId']);
        EventBus.emit('obra:selecionada', { obraId: proxima.id });
      } else {
        state.set('obraAtivaId', '');
        state.persist(['obraAtivaId']);
        // FIX-EXCLUIR-1: garante remoção de ambos os storages
        try { localStorage.removeItem('fo_obraAtivaId'); } catch(_) {}
        try { sessionStorage.removeItem('fo_obraAtivaId'); } catch(_) {}
      }

      EventBus.emit('obra:excluida', { obraId });
      EventBus.emit('obras:lista-atualizada', {});
      EventBus.emit('lixeira:atualizada', {});
      window.toast?.(`🗑️ Obra "${nome}" movida para a lixeira.`,'warn');
      window.router?.navigate?.('dashboard');
    } catch (err) {
      console.error('[ConfigModule] _excluirObra:', err);
      window.toast?.(`❌ Erro: ${err.message}`,'err');
    }
  }

  // ═══════════════════════════════════════════════════════════════
  //  LIXEIRA — Renderização da aba "Itens Excluídos"
  // ═══════════════════════════════════════════════════════════════
  async _renderLixeira() {
    const el = document.getElementById('cfg-lixeira-lista');
    if (!el) return;

    el.innerHTML = `<div style="text-align:center;padding:20px;color:var(--text-muted);font-size:12px">⏳ Carregando itens excluídos...</div>`;

    // Mescla lixeira local + Firebase
    const local    = storageUtils.lixeiraGetAll();
    let firebase   = [];
    try { firebase = await FirebaseService.getLixeiraFirebase(); } catch {}

    // Une e deduplica por id
    const todos = [...firebase];
    for (const item of local) {
      if (!todos.find(f => f.id === item.id)) todos.push(item);
    }
    todos.sort((a, b) => (b.excluidoEm || '').localeCompare(a.excluidoEm || ''));

    if (!todos.length) {
      el.innerHTML = `
        <div style="text-align:center;padding:40px;color:var(--text-muted)">
          <div style="font-size:32px;margin-bottom:12px">🗑️</div>
          <div style="font-size:13px;font-weight:600">Nenhum item excluído</div>
          <div style="font-size:11px;margin-top:4px">Registros excluídos aparecerão aqui.</div>
        </div>`;
      return;
    }

    const icones = { obra:'🏗️', bm:'📋', aditivo:'📝', diario:'📓', documento:'📂', relatorio:'📑', memoria:'📐' };
    const cores  = { obra:'#dc2626', bm:'#2563eb', aditivo:'#d97706', diario:'#7c3aed', documento:'#0891b2', relatorio:'#059669', memoria:'#db2777' };

    el.innerHTML = `
      <div style="font-size:11px;color:var(--text-muted);margin-bottom:12px">${todos.length} item(ns) na lixeira</div>
      <div style="display:flex;flex-direction:column;gap:8px">
        ${todos.map(item => {
          const cor  = cores[item.tipo] || '#475569';
          const ico  = icones[item.tipo] || '📄';
          const dt   = item.excluidoData || (item.excluidoEm ? new Date(item.excluidoEm).toLocaleDateString('pt-BR') : '—');
          const hr   = item.excluidoHora || (item.excluidoEm ? new Date(item.excluidoEm).toLocaleTimeString('pt-BR',{hour:'2-digit',minute:'2-digit'}) : '—');
          const user = item.excluidoPor?.nome || item.excluidoPor?.email || 'Desconhecido';
          const mod  = item.moduloOrigem || item.tipo || '—';
          return `
          <div style="display:flex;align-items:center;gap:12px;padding:12px 14px;border:1px solid var(--border);border-radius:8px;background:var(--bg-card);flex-wrap:wrap">
            <div style="width:36px;height:36px;border-radius:8px;background:${cor}18;border:1px solid ${cor}33;display:flex;align-items:center;justify-content:center;font-size:18px;flex-shrink:0">${ico}</div>
            <div style="flex:1;min-width:180px">
              <div style="font-size:12px;font-weight:700;color:var(--text-primary)">${item.label || item.tipo}</div>
              <div style="font-size:10px;color:var(--text-muted);margin-top:2px;display:flex;gap:10px;flex-wrap:wrap">
                <span style="background:${cor}18;color:${cor};border:1px solid ${cor}33;border-radius:4px;padding:1px 6px;font-weight:700">${item.tipo?.toUpperCase()}</span>
                <span>📅 ${dt} às ${hr}</span>
                <span>👤 ${user}</span>
                <span>📁 ${mod}</span>
              </div>
            </div>
            <div style="display:flex;gap:6px;flex-shrink:0">
              <button data-action="_cfgLixeiraRestaurar" data-arg0="${item.id}" style="padding:5px 12px;font-size:10px;font-weight:700;background:#16a34a18;border:1px solid #16a34a44;color:#16a34a;border-radius:6px;cursor:pointer;transition:all .15s"
                onmouseover="this.style.background='#16a34a30'" onmouseout="this.style.background='#16a34a18'">
                ♻️ Restaurar
              </button>
              <button data-action="_cfgLixeiraDeletarPermanente" data-arg0="${item.id}" style="padding:5px 12px;font-size:10px;font-weight:700;background:#dc262618;border:1px solid #dc262644;color:#dc2626;border-radius:6px;cursor:pointer;transition:all .15s"
                onmouseover="this.style.background='#dc262630'" onmouseout="this.style.background='#dc262618'">
                ❌ Excluir Permanente
              </button>
            </div>
          </div>`;
        }).join('')}
      </div>`;
  }

  // ═══════════════════════════════════════════════════════════════
  //  LIXEIRA — Restaurar item
  // ═══════════════════════════════════════════════════════════════
  async _lixeiraRestaurar(itemId) {
    // Busca o item na lixeira local ou Firebase
    const local    = storageUtils.lixeiraGetAll();
    let item = local.find(i => i.id === itemId);
    if (!item) {
      try {
        const fb = await FirebaseService.getLixeiraFirebase();
        item = fb.find(i => i.id === itemId);
      } catch {}
    }
    if (!item) { window.toast?.('⚠️ Item não encontrado na lixeira.','warn'); return; }

    if (!confirm(`♻️ Restaurar "${item.label}"?\n\nO item retornará ao seu módulo original.`)) return;

    try {
      window.toast?.('⏳ Restaurando...','info');

      if (item.tipo === 'obra') {
        // Restaura obra via Firebase
        await FirebaseService.restaurarObra(item);
        const lista = state.get('obrasLista') || [];
        const { obraRef } = item.dados || {};
        const obraId = item.obraId;
        if (obraRef && !lista.find(o => o.id === obraId)) {
          const novaLista = [...lista, { id: obraId, nome: obraRef.nome || obraId, tipo: obraRef.tipo || 'prefeitura', statusObra: obraRef.statusObra || 'Em andamento' }];
          state.set('obrasLista', novaLista);
          EventBus.emit('obras:lista-atualizada', {});
        }
      } else if (item.tipo === 'bm') {
        // BM: reintegra na lista de BMs da obra
        const obraId = item.obraId || item.dados?.obraId;
        if (obraId) {
          const bms = state.get('bms') || [];
          const bmRestaurado = item.dados?.bm;
          if (bmRestaurado && !bms.find(b => b.num === bmRestaurado.num)) {
            const novosBms = [...bms, bmRestaurado].sort((a,b) => a.num - b.num);
            state.set('bms', novosBms);
            await FirebaseService.setBMs?.(obraId, novosBms);
            EventBus.emit('boletim:atualizado', { bms: novosBms });
          }
        }
      } else if (item.tipo === 'aditivo') {
        const obraId = item.obraId || item.dados?.obraId;
        const aditivo = item.dados?.aditivo;
        if (obraId && aditivo) {
          const aditivos = state.get('aditivos') || [];
          if (!aditivos.find(a => a.id === aditivo.id)) {
            const novos = [...aditivos, aditivo];
            state.set('aditivos', novos);
            await FirebaseService.salvarAditivo?.(obraId, aditivo);
          }
        }
      } else if (item.tipo === 'diario') {
        const obraId = item.obraId || item.dados?.obraId;
        const entrada = item.dados?.entrada;
        if (obraId && entrada) {
          const entradas = state.get('diario') || [];
          if (!entradas.find(e => e.id === entrada.id)) {
            const novas = [...entradas, entrada];
            state.set('diario', novas);
            await FirebaseService.salvarDiario?.(obraId, novas);
          }
        }
      } else if (item.tipo === 'documento') {
        const obraId = item.obraId || item.dados?.obraId;
        const doc = item.dados?.doc;
        if (obraId && doc) {
          const docs = state.get('documentos') || [];
          if (!docs.find(d => d.id === doc.id)) {
            const novos = [...docs, doc];
            state.set('documentos', novos);
            await FirebaseService.salvarDocumentos?.(obraId, novos);
          }
        }
      }

      // Remove da lixeira local e Firebase
      storageUtils.lixeiraRemover(itemId);
      await FirebaseService.removerItemLixeiraFirebase(itemId);

      EventBus.emit('lixeira:atualizada', {});
      window.toast?.(`✅ "${item.label}" restaurado com sucesso!`,'ok');
      this._renderLixeira();
    } catch (err) {
      console.error('[ConfigModule] _lixeiraRestaurar:', err);
      window.toast?.(`❌ Erro ao restaurar: ${err.message}`,'err');
    }
  }

  // ═══════════════════════════════════════════════════════════════
  //  LIXEIRA — Exclusão permanente
  // ═══════════════════════════════════════════════════════════════
  async _lixeiraDeletarPermanente(itemId) {
    // Busca o item localmente e, se não achar, também no Firebase
    const local = storageUtils.lixeiraGetAll();
    let item = local.find(i => i.id === itemId);
    if (!item) {
      try {
        const fb = await FirebaseService.getLixeiraFirebase();
        item = fb.find(i => i.id === itemId);
      } catch {}
    }
    if (!item) item = { label: itemId };

    if (!confirm(`🔴 EXCLUSÃO PERMANENTE\n\n"${item.label}"\n\nEssa ação NÃO pode ser desfeita. Continuar?`)) return;

    try {
      // Se for obra, apaga completamente do Firestore
      if (item.tipo === 'obra' && item.obraId) {
        await FirebaseService.deletarObraPermanente(item.obraId);
      }
      storageUtils.lixeiraRemover(itemId);
      await FirebaseService.removerItemLixeiraFirebase(itemId);
      EventBus.emit('lixeira:atualizada', {});
      window.toast?.('🗑️ Excluído permanentemente.','warn');
      this._renderLixeira();
    } catch (err) {
      console.error('[ConfigModule] _lixeiraDeletarPermanente:', err);
      window.toast?.(`❌ Erro: ${err.message}`,'err');
    }
  }

  // ═══════════════════════════════════════════════════════════════
  //  GERENCIAR BMs
  // ═══════════════════════════════════════════════════════════════
  async _adicionarBM() {
    const obraId = state.get('obraAtivaId');
    if (!obraId) { window.toast?.('⚠️ Nenhuma obra ativa.','warn'); return; }
    const bms    = state.get('bms') || [];
    const prox   = (bms.length > 0 ? Math.max(...bms.map(b=>b.num)) : 0) + 1;
    const mes    = prompt(`Mês de referência do BM ${String(prox).padStart(2,'0')}:`, '');
    if (mes === null) return;
    const data   = prompt('Data da medição (dd/mm/aaaa):', '');
    if (data === null) return;
    const novoBm = { num: prox, label: `BM ${String(prox).padStart(2,'0')}`, mes: mes||'', data: data||'', contractVersion: 1 };
    const novosBms = [...bms, novoBm];
    state.set('bms', novosBms);
    await FirebaseService.setBMs?.(obraId, novosBms);
    EventBus.emit('boletim:atualizado', { obraId });
    this._renderCfg();
    window.toast?.(`✅ BM ${novoBm.label} adicionado.`,'ok');
  }

  async _editarBM(num) {
    const obraId = state.get('obraAtivaId');
    const bms    = [...(state.get('bms')||[])];
    const idx    = bms.findIndex(b => b.num === num);
    if (idx < 0) return;
    const bm  = bms[idx];
    const mes = prompt(`Mês de referência (${bm.label}):`, bm.mes||'');
    if (mes === null) return;
    const data= prompt('Data da medição:', bm.data||'');
    if (data === null) return;
    bms[idx] = { ...bm, mes: mes||bm.mes, data: data||bm.data };
    state.set('bms', bms);
    await FirebaseService.setBMs?.(obraId, bms);
    EventBus.emit('boletim:atualizado', { obraId });
    this._renderCfg();
    window.toast?.('✅ BM atualizado.','ok');
  }

  async _excluirBM(num) {
    const obraId = state.get('obraAtivaId');
    const bms    = state.get('bms') || [];
    const bm     = bms.find(b => b.num === num);
    if (!bm) return;
    if (!confirm(`Excluir ${bm.label}?\n\nAs medições deste BM serão removidas.`)) return;
    const novos  = bms.filter(b => b.num !== num);
    state.set('bms', novos);
    await FirebaseService.setBMs?.(obraId, novos);
    EventBus.emit('boletim:atualizado', { obraId });
    this._renderCfg();
    window.toast?.(`🗑️ ${bm.label} excluído.`,'warn');
  }

  // ═══════════════════════════════════════════════════════════════
  //  FIREBASE CONFIG (mantém compatibilidade)
  // ═══════════════════════════════════════════════════════════════
  _salvarFirebaseConfig() {
    const get = id => document.getElementById(id)?.value?.trim()||'';
    const cfg = {
      apiKey:            get('fb-apikey'),
      authDomain:        get('fb-authdomain'),
      projectId:         get('fb-projectid'),
      storageBucket:     get('fb-storagebucket'),
      messagingSenderId: get('fb-senderid'),
      appId:             get('fb-appid'),
    };
    if (!cfg.apiKey || !cfg.projectId) {
      window.toast?.('⚠️ Informe pelo menos API Key e Project ID.','warn'); return;
    }
    try {
      // Configuração do Firebase é necessária antes do login —
      // usa sessionStorage para inicialização. Fallback para cookie de sessão
      // caso o browser (Opera GX / modo privado) bloqueie o sessionStorage.
      const cfgStr = JSON.stringify(cfg);
      let salvo = false;
      try {
        sessionStorage.setItem('fiscalFirebaseCfg', cfgStr);
        salvo = true;
      } catch (_) { /* sessionStorage bloqueado */ }
      if (!salvo) {
        // Fallback: cookie de sessão (sem expiração = apagado ao fechar o browser)
        try {
          document.cookie = 'fiscalFirebaseCfg=' + encodeURIComponent(cfgStr) + '; path=/; SameSite=Strict';
          salvo = true;
          console.warn('[Config] sessionStorage bloqueado — config Firebase salva em cookie de sessão.');
        } catch (_) { /* cookies também bloqueados */ }
      }
      if (salvo) {
        window.toast?.('🔥 Configuração salva. Recarregue a página para aplicar.','ok');
      } else {
        window.toast?.('❌ Seu browser está bloqueando o armazenamento local. Verifique as configurações de privacidade (Opera GX: desative o GX Cleaner).','err');
      }
    } catch(e) { window.toast?.('❌ Erro ao salvar configuração Firebase.','err'); }
  }

  _testarFirebase() {
    const el = document.getElementById('fb-status-info');
    if (!el) return;
    const ok = typeof window.firebase !== 'undefined' || FirebaseService.isReady();
    el.innerHTML = ok
      ? '<span style="color:#16a34a;font-weight:600">✅ Firebase conectado</span>'
      : '<span style="color:#dc2626;font-weight:600">❌ Firebase não conectado — verifique as credenciais</span>';
  }

  _carregarLogo(event) {
    const file = event.target?.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = async (e) => {
      const img  = document.getElementById('logoPreviewImg');
      const wrap = document.getElementById('logoPreviewWrap');
      if (img)  img.src = e.target.result;
      if (wrap) wrap.style.display = 'block';
      // Persiste no Firebase Storage e atualiza o state
      try {
        const obraId = state.get('obraAtivaId');
        const url = await FirebaseService.salvarLogo(obraId, e.target.result);
        state.set('logoBase64', url || e.target.result);
      } catch { state.set('logoBase64', e.target.result); }
      window.toast?.('✅ Logo carregado.','ok');
    };
    reader.readAsDataURL(file);
  }

  _removerLogo() {
    const img  = document.getElementById('logoPreviewImg');
    const wrap = document.getElementById('logoPreviewWrap');
    if (img)  img.src = '';
    if (wrap) wrap.style.display = 'none';
    // Remove do state (sem localStorage)
    state.set('logoBase64', '');
    window.toast?.('🗑️ Logo removido.','warn');
  }

  // ═══════════════════════════════════════════════════════════════
  //  EVENTOS E GLOBALS
  // ═══════════════════════════════════════════════════════════════
  _bindEvents() {
    this._subs.push(
      EventBus.on('obra:selecionada', ({ obraId } = {}) => {
        try {
          // FIX-E3.4: cancelar watch anterior e iniciar novo ao trocar de obra
          if (this._unsubWatch) { this._unsubWatch(); this._unsubWatch = null; }
          if (router.current === 'config') this._renderCfg();
          const id = obraId || state.get('obraAtivaId');
          if (id) {
            this._unsubWatch = FirebaseService.watchCfg(id, cfg => {
              // Atualiza state quando outro usuário salva a configuração
              if (cfg && typeof cfg === 'object') {
                state.set('cfg', cfg);
                if (router.current === 'config') this._renderCfg();
                EventBus.emitAsync('config:salva', { cfg });
              }
            });
          }
        } catch(e){}
      }, 'config'),
      EventBus.on('obra:importada', () => {
        try { if (router.current === 'config') this._renderCfg(); } catch(e){}
      }, 'config'),
      EventBus.on('itens:atualizados', () => {
        try { if (router.current === 'config') this._renderCfg(); } catch(e){}
      }, 'config'),
      // Recarrega lixeira automaticamente quando qualquer módulo enviar item
      EventBus.on('lixeira:atualizada', () => {
        try { if (router.current === 'config') this._renderLixeira(); } catch(e){}
      }, 'config'),
    );
  }

  _exposeGlobals() {
    window.salvarConfig               = ()    => { if (!window.requirePerfil?.('fiscal','administrador','engenheiro')) return; try { this._salvarConfig();              } catch(e){} };
    window.renderConfig               = ()    => { try { this._renderCfg();                 } catch(e){} };
    window.adicionarBM                = ()    => { if (!window.requirePerfil?.('fiscal','administrador','engenheiro')) return; try { this._adicionarBM();               } catch(e){} };
    window.novaObra                   = ()    => { try { window.verPagina?.('importacao');   } catch(e){} };
    window._cfgSalvarStatus           = ()    => { if (!window.requirePerfil?.('fiscal','administrador')) return; try { this._salvarStatus();              } catch(e){} };
    window._cfgExcluirObra            = ()    => { if (!window.requirePerfil?.('administrador')) return; try { this._excluirObra();               } catch(e){} };
    window._cfgEditarBM               = num   => { if (!window.requirePerfil?.('fiscal','administrador','engenheiro')) return; try { this._editarBM(num);               } catch(e){} };
    window._cfgExcluirBM              = num   => { if (!window.requirePerfil?.('administrador')) return; try { this._excluirBM(num);              } catch(e){} };
    window._cfgLixeiraRestaurar       = id    => { if (!window.requirePerfil?.('fiscal','administrador')) return; try { this._lixeiraRestaurar(id);        } catch(e){} };
    window._cfgLixeiraDeletarPermanente = id  => { if (!window.requirePerfil?.('administrador')) return; try { this._lixeiraDeletarPermanente(id);} catch(e){} };
    window._cfgRenderLixeira          = ()    => { try { this._renderLixeira();             } catch(e){} };
    window.salvarFirebaseConfig       = ()    => { if (!window.requirePerfil?.('administrador')) return; try { this._salvarFirebaseConfig();      } catch(e){} };
    window.testarFirebase             = ()    => { try { this._testarFirebase();            } catch(e){} };
    window.carregarLogo               = ev    => { if (!window.requirePerfil?.('fiscal','administrador','engenheiro')) return; try { this._carregarLogo(ev);            } catch(e){} };
    window.removerLogo                = ()    => { if (!window.requirePerfil?.('fiscal','administrador')) return; try { this._removerLogo();               } catch(e){} };
  }

  destroy() {
    this._subs.forEach(u => u());
    this._subs = [];
    if (this._unsubWatch) { this._unsubWatch(); this._unsubWatch = null; }
  }
}
