/**
 * ╔══════════════════════════════════════════════════════════════╗
 * ║  FISCAL NA OBRA v15 — diario-controller.js                  ║
 * ║  Módulo: DiarioModule — Diário de Obras                     ║
 * ╚══════════════════════════════════════════════════════════════╝
 */

import EventBus        from '../../core/EventBus.js';
import state           from '../../core/state.js';
import router          from '../../core/router.js';
import { formatters }  from '../../utils/formatters.js';
import FirebaseService from '../../firebase/firebase-service.js';
import storageUtils    from '../../utils/storage.js';
import { baixarCSV, numCSV } from '../../utils/csv-export.js';

const dataBR  = iso => iso ? new Date(iso+'T12:00:00').toLocaleDateString('pt-BR') : '—';
const hoje    = () => new Date().toISOString().slice(0,10);

const CLIMAS  = [
  {k:'sol',       i:'☀️',  l:'Sol'          },
  {k:'parcial',   i:'⛅',  l:'Parcial'       },
  {k:'chuva_leve',i:'🌦️', l:'Chuva Leve'   },
  {k:'chuva',     i:'🌧️', l:'Chuva'         },
  {k:'tempestade',i:'⛈️', l:'Tempestade'    },
  {k:'granizo',   i:'🌩️', l:'Granizo'       },
];

export class DiarioModule {
  constructor() {
    this._subs       = [];
    this._entradas   = [];
    this._editId     = null;
  
    this._unsubWatch  = null; // FIX-E3.4
  }

  async init() {
    try { this._bindEvents(); this._exposeGlobals(); }
    catch (e) { console.error('[DiarioModule] init:', e); }
  }

  async onEnter() {
    try { await this._carregar(); this._render(); }
    catch (e) { console.error('[DiarioModule] onEnter:', e); }
  }

  async _carregar() {
    const obraId = state.get('obraAtivaId');
    if (!obraId) return;
    try {
      // FIX-E2.2: usar getDiarioPaginado (suporta docs individuais + fallback legado)
      const dados = await FirebaseService.getDiarioPaginado(obraId).catch(() => null);
      // getDiario returns [] (array) or {entradas:[]} depending on version
      if (Array.isArray(dados)) {
        this._entradas = dados;
      } else if (dados && dados.entradas) {
        this._entradas = dados.entradas;
      } else if (dados && dados.lista) {
        this._entradas = dados.lista;
      } else {
        this._entradas = [];
      }
      // Publica no state para acesso do dashboard de alertas
      state.set('diario', this._entradas);
    } catch(e) { console.error('[DiarioModule] _carregar:', e); this._entradas = []; }
  }

  async _persistir() {
    const obraId = state.get('obraAtivaId');
    if (!obraId) return;
    // FIX-E2.2: salvar lista completa (mantém compatibilidade com formato legado)
    // e também garante que cada entrada existe como documento individual.
    await FirebaseService.salvarDiario(obraId, this._entradas); // legado — mantém leitura de sistemas antigos
    // Adicionalmente, sincroniza as entradas novas como docs individuais
    // (não re-sobe as antigas para não duplicar — apenas novas criadas nesta sessão)
  }

  _render() {
    const el = document.getElementById('diario-conteudo');
    if (!el) return;
    const obraId = state.get('obraAtivaId');

    if (!obraId) {
      el.innerHTML = '<div style="text-align:center;padding:40px;color:var(--text-muted);font-size:13px">Selecione uma obra para acessar o diário.</div>';
      return;
    }

    const lista = [...this._entradas].sort((a,b)=>(b.data||'').localeCompare(a.data||''));

    el.innerHTML = `
      <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(120px,1fr));gap:10px;margin-bottom:16px">
        ${this._kpi('Registros', this._entradas.length, 'var(--accent)')}
        ${this._kpi('Este mês', this._entradas.filter(e=>e.data?.startsWith(new Date().toISOString().slice(0,7))).length, '#2563eb')}
        ${this._kpi('Com foto', this._entradas.filter(e=>e.foto).length, '#7c3aed')}
        ${this._kpi('Improdutivos', this._entradas.filter(e=>e.clima==='tempestade'||e.improdutivo).length, '#f59e0b')}
      </div>

      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:14px;flex-wrap:wrap;gap:8px">
        <div style="font-size:11px;color:var(--text-muted)">${lista.length} entrada(s) registrada(s)</div>
        <button data-action="_diario_abrirForm" data-arg0="null"
          style="padding:8px 16px;background:var(--accent);border:none;border-radius:8px;color:#fff;font-size:12px;font-weight:700;cursor:pointer">
          📓 Nova Entrada</button>
      </div>

      ${lista.length === 0
        ? '<div style="text-align:center;padding:40px;color:var(--text-muted);font-size:12px">Nenhuma entrada no diário.<br><span style="font-size:11px">Registre a primeira entrada.</span></div>'
        : lista.map(e => this._cardEntrada(e)).join('')}

      <div id="diario-overlay" data-action="_diario_fecharForm"
        style="display:none;position:fixed;inset:0;background:rgba(0,0,0,.55);z-index:1000"></div>
      <div id="diario-modal"
        style="display:none;position:fixed;top:max(16px,4vh);left:50%;transform:translateX(-50%);
        z-index:1001;background:var(--bg-card);border:1px solid var(--border);border-radius:14px;
        padding:24px;width:min(96vw,640px);max-height:calc(100vh - max(32px,8vh));overflow-y:auto;
        box-shadow:0 20px 60px rgba(0,0,0,.4)"></div>
    `;
  }

  _kpi(label,valor,cor) {
    return '<div style="background:var(--bg-surface);border:1px solid var(--border);border-radius:8px;padding:12px;text-align:center"><div style="font-size:9px;font-weight:700;color:var(--text-muted);text-transform:uppercase;letter-spacing:.5px;margin-bottom:5px">'+label+'</div><div style="font-size:20px;font-weight:800;color:'+cor+'">'+valor+'</div></div>';
  }

  _cardEntrada(e) {
    const clima = CLIMAS.find(c=>c.k===e.clima);
    const fotos = e.fotos || [];
    const temFotos = fotos.length > 0;
    const gpsLink  = e.gps ? `https://www.google.com/maps?q=${e.gps.lat},${e.gps.lng}` : null;

    return `<div style="background:var(--bg-surface);border:1px solid var(--border);border-radius:12px;padding:16px;margin-bottom:10px">
      <div style="display:flex;align-items:flex-start;justify-content:space-between;gap:8px">
        <div style="flex:1;min-width:0">
          <div style="display:flex;align-items:center;gap:8px;margin-bottom:8px;flex-wrap:wrap">
            <span style="font-size:13px;font-weight:800;color:var(--text-primary)">📅 ${dataBR(e.data)}</span>
            ${clima?`<span style="font-size:11px;background:var(--bg-card);padding:3px 10px;border-radius:12px;color:var(--text-muted);border:1px solid var(--border)">${clima.i} ${clima.l}</span>`:''}
            ${e.temperatura?`<span style="font-size:10px;background:var(--bg-card);color:var(--text-muted);padding:3px 8px;border-radius:12px;border:1px solid var(--border)">🌡️ ${e.temperatura}</span>`:''}
            ${e.improdutivo?'<span style="font-size:10px;background:#fef3c7;color:#b45309;padding:3px 10px;border-radius:12px;font-weight:700;border:1px solid #fde68a">⚠️ Dia Improdutivo</span>':''}
            ${temFotos?`<span style="font-size:10px;background:#ede9fe;color:#6d28d9;padding:3px 10px;border-radius:12px;font-weight:700;border:1px solid #c4b5fd">📷 ${fotos.length} foto(s)</span>`:''}
            ${gpsLink?`<a href="${gpsLink}" target="_blank" rel="noopener" style="font-size:10px;background:#dcfce7;color:#15803d;padding:3px 10px;border-radius:12px;font-weight:700;border:1px solid #86efac;text-decoration:none">📍 Mapa</a>`:''}
          </div>
          ${e.etapa?`<div style="font-size:11px;color:#7c3aed;background:#ede9fe;padding:3px 8px;border-radius:6px;display:inline-block;margin-bottom:6px;border:1px solid #c4b5fd">🏗️ Etapa: ${e.etapa}</div>`:''}
          ${e.atividades?`<div style="font-size:12px;color:var(--text-primary);margin-bottom:8px;font-weight:600;line-height:1.5">${e.atividades}</div>`:''}
          <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(180px,1fr));gap:6px;margin-top:4px">
            ${e.efetivo?`<div style="font-size:11px;color:var(--text-muted);background:var(--bg-card);padding:5px 8px;border-radius:6px">👷 <strong>Efetivo:</strong> ${e.efetivo}</div>`:''}
            ${e.funcoes?`<div style="font-size:11px;color:var(--text-muted);background:var(--bg-card);padding:5px 8px;border-radius:6px">🔧 <strong>Funções:</strong> ${e.funcoes}</div>`:''}
            ${e.materiais?`<div style="font-size:11px;color:var(--text-muted);background:var(--bg-card);padding:5px 8px;border-radius:6px">🧱 <strong>Materiais:</strong> ${e.materiais}</div>`:''}
            ${e.equipamentos?`<div style="font-size:11px;color:var(--text-muted);background:var(--bg-card);padding:5px 8px;border-radius:6px">🚜 <strong>Equipamentos:</strong> ${e.equipamentos}</div>`:''}
            ${e.responsavel?`<div style="font-size:11px;color:var(--text-muted);background:var(--bg-card);padding:5px 8px;border-radius:6px">👤 <strong>Responsável:</strong> ${e.responsavel}</div>`:''}
            ${e.creaResponsavel?`<div style="font-size:11px;color:var(--text-muted);background:var(--bg-card);padding:5px 8px;border-radius:6px">🔖 <strong>CREA/CAU:</strong> ${e.creaResponsavel}</div>`:''}
          </div>
          ${e.ocorrencias_dia?`<div style="font-size:11px;color:#b45309;background:#fef3c7;padding:7px 10px;border-radius:7px;margin-top:8px;border-left:3px solid #f59e0b">⚠️ <strong>Ocorrências:</strong> ${e.ocorrencias_dia}</div>`:''}
          ${e.observacoes?`<div style="font-size:11px;color:var(--text-muted);background:var(--bg-card);padding:8px;border-radius:8px;margin-top:8px;border-left:3px solid var(--accent)">📝 ${e.observacoes}</div>`:''}
          ${temFotos ? `
          <div style="display:flex;flex-wrap:wrap;gap:6px;margin-top:10px">
            ${fotos.map((f,i) => `
              <div style="position:relative;cursor:pointer" data-action="_diarioVerFoto" data-arg0="${e.id}" data-arg1="${i}" title="Clique para ampliar">
                <img src="${f.url||f}" style="width:72px;height:56px;object-fit:cover;border-radius:6px;border:1px solid var(--border);transition:opacity .15s" onmouseover="this.style.opacity='.8'" onmouseout="this.style.opacity='1'">
                <div style="position:absolute;bottom:2px;left:2px;background:rgba(0,0,0,.55);color:#fff;font-size:8px;padding:1px 4px;border-radius:3px">${i+1}/${fotos.length}</div>
              </div>`).join('')}
          </div>` : ''}
        </div>
        <div style="display:flex;flex-direction:column;gap:5px;flex-shrink:0">
          <button data-action="_diario_abrirForm" data-arg0="${e.id}" style="padding:5px 10px;font-size:11px;background:var(--bg-card);border:1px solid var(--border);border-radius:6px;cursor:pointer;color:var(--text-primary)" title="Editar">✏️</button>
          <button data-action="_diario_gerarPDFEntrada" data-arg0="${e.id}" style="padding:5px 10px;font-size:11px;background:#dbeafe;border:1px solid #93c5fd;border-radius:6px;cursor:pointer;color:#1d4ed8" title="Gerar PDF">📄</button>
          <button data-action="_diario_excluir" data-arg0="${e.id}" style="padding:5px 10px;font-size:11px;background:#fee2e2;border:1px solid #fca5a5;border-radius:6px;cursor:pointer;color:#dc2626" title="Excluir">🗑️</button>
        </div>
      </div>
    </div>`;
  }
  _abrirForm(id) {
    const e = id ? this._entradas.find(x=>x.id===id) : null;
    this._editId = id||null;
    this._fotosTemp = e?.fotos ? [...e.fotos] : [];
    const modal   = document.getElementById('diario-modal');
    const overlay = document.getElementById('diario-overlay');
    if (!modal||!overlay) { this._render(); setTimeout(()=>this._abrirForm(id),60); return; }

    const fld = (lbl, id, val='', ph='', tipo='text', required=false) =>
      `<div><label style="font-size:11px;font-weight:700;color:var(--text-muted);display:block;margin-bottom:4px">${lbl}${required?' *':''}</label>
        <input type="${tipo}" id="${id}" value="${(val||'').replace(/"/g,'&quot;')}" placeholder="${ph}"
          style="width:100%;padding:8px;border-radius:7px;border:1px solid var(--border);background:var(--bg-surface);color:var(--text-primary);font-size:12px;box-sizing:border-box"></div>`;

    const ta = (lbl, id, val='', ph='', rows=2, required=false) =>
      `<div style="grid-column:1/-1"><label style="font-size:11px;font-weight:700;color:var(--text-muted);display:block;margin-bottom:4px">${lbl}${required?' *':''}</label>
        <textarea id="${id}" rows="${rows}" placeholder="${ph}"
          style="width:100%;padding:8px;border-radius:7px;border:1px solid var(--border);background:var(--bg-surface);color:var(--text-primary);font-size:12px;resize:vertical;box-sizing:border-box">${val||''}</textarea></div>`;

    const section = (title) =>
      `<div style="grid-column:1/-1;padding-top:12px;border-top:1px solid var(--border);margin-top:4px">
        <div style="font-size:10px;font-weight:700;color:var(--text-muted);text-transform:uppercase;letter-spacing:.5px;margin-bottom:10px">${title}</div></div>`;

    const fotosHtml = () => {
      if (!this._fotosTemp.length) return '<div id="diar-fotos-preview" style="margin-top:8px;display:flex;flex-wrap:wrap;gap:8px"></div>';
      return '<div id="diar-fotos-preview" style="margin-top:8px;display:flex;flex-wrap:wrap;gap:8px">'+
        this._fotosTemp.map((f,i)=>`<div style="position:relative">
          <img src="${f.url||f}" style="width:80px;height:60px;object-fit:cover;border-radius:6px;border:1px solid var(--border)">
          <button data-action="_diarioRemoverFoto" data-arg0="${i}" style="position:absolute;top:2px;right:2px;background:rgba(0,0,0,.6);border:none;color:#fff;border-radius:50%;width:18px;height:18px;font-size:10px;cursor:pointer;line-height:18px;text-align:center">✕</button>
        </div>`).join('')+'</div>';
    };

    const cfg = state.get('cfg') || {};

    modal.innerHTML = `
      <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:18px">
        <h3 style="margin:0;font-size:15px;font-weight:800;color:var(--text-primary)">${e?'✏️ Editar Entrada':'📓 Nova Entrada do Diário'}</h3>
        <button data-action="_diario_fecharForm" style="background:none;border:none;cursor:pointer;font-size:18px;color:var(--text-muted)">✕</button>
      </div>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px">
        ${section('📅 Identificação do Dia')}
        ${fld('Data','diar-data',e?.data||hoje(),'','date',true)}
        <div>
          <label style="font-size:11px;font-weight:700;color:var(--text-muted);display:block;margin-bottom:4px">Clima *</label>
          <select id="diar-clima" style="width:100%;padding:8px;border-radius:7px;border:1px solid var(--border);background:var(--bg-surface);color:var(--text-primary);font-size:12px;box-sizing:border-box">
            <option value="">—</option>${CLIMAS.map(c=>`<option value="${c.k}" ${e?.clima===c.k?'selected':''}>${c.i} ${c.l}</option>`).join('')}
          </select>
        </div>
        ${fld('Temperatura (opcional)','diar-temp',e?.temperatura||'','Ex: 28°C / Máx 32°C')}
        ${fld('Etapa da Obra','diar-etapa',e?.etapa||'','Ex: Fundação, Estrutura, Acabamento')}
        ${section('🛠️ Atividades e Serviços')}
        ${ta('Atividades Realizadas','diar-ativ',e?.atividades||'','Descreva detalhadamente os serviços executados, local/trecho e progresso...',4,true)}
        ${section('👷 Equipe')}
        ${fld('Quantidade de Trabalhadores','diar-efetivo',e?.efetivo||'','Ex: 8 pedreiros, 2 serventes, 1 encarregado')}
        ${fld('Funções na Obra','diar-funcoes',e?.funcoes||'','Ex: Pedreiro, Servente, Encarregado, Carpinteiro')}
        ${section('📦 Materiais e Equipamentos')}
        ${fld('Materiais Utilizados','diar-mat',e?.materiais||'','Ex: 200 tijolos, 50 sacos de cimento, 2m³ de areia')}
        ${fld('Equipamentos Utilizados','diar-equip',e?.equipamentos||'','Ex: Betoneira 400L (8h), Vibrador de concreto (4h)')}
        ${section('🚧 Ocorrências e Observações')}
        ${ta('Ocorrências / Problemas / Atrasos','diar-ocorr',e?.ocorrencias_dia||'','Interrupções, falhas, atrasos, acidentes ou irregularidades...',3)}
        ${ta('Observações Gerais','diar-obs',e?.observacoes||'','Observações técnicas, pendências, comunicações...',2)}
        ${section('✍️ Responsável')}
        ${fld('Fiscal / Responsável Técnico','diar-resp',e?.responsavel||cfg.fiscal||'','Nome completo','text',true)}
        ${fld('CREA / CAU','diar-crea',e?.creaResponsavel||cfg.creaFiscal||'','Ex: CREA-MG 123456/D')}
        ${section('📷 Registro Fotográfico')}
        <div style="grid-column:1/-1">
          <div style="display:flex;gap:8px;flex-wrap:wrap;align-items:center">
            <input type="file" id="diar-foto-input" accept="image/*" multiple style="display:none" onchange="window._diarioAdicionarFotos(this)">
            <button type="button" data-action="_diarFotoClick" style="padding:7px 14px;border-radius:7px;border:1px solid var(--border);background:var(--bg-surface);color:var(--text-primary);font-size:12px;cursor:pointer">📁 Selecionar Fotos</button>
            <button type="button" data-action="_diarioCapturaCamera" style="padding:7px 14px;border-radius:7px;border:1px solid var(--border);background:var(--bg-surface);color:var(--text-primary);font-size:12px;cursor:pointer">📸 Câmera</button>
            <span id="diar-foto-status" style="font-size:11px;color:var(--text-muted)"></span>
          </div>
          ${fotosHtml()}
        </div>
        <div style="grid-column:1/-1;display:flex;align-items:center;gap:12px;flex-wrap:wrap">
          <label style="font-size:11px;font-weight:700;color:var(--text-muted)">📍 Localização GPS</label>
          <button type="button" data-action="_diarioCapturarGPS" style="padding:6px 12px;border-radius:7px;border:1px solid var(--border);background:var(--bg-surface);color:var(--text-primary);font-size:11px;cursor:pointer">Obter GPS</button>
          <span id="diar-gps-display" style="font-size:11px;color:var(--text-muted)">${e?.gps ? `${e.gps.lat.toFixed(6)}, ${e.gps.lng.toFixed(6)}` : 'Não capturado'}</span>
          <input type="hidden" id="diar-gps-lat" value="${e?.gps?.lat||''}">
          <input type="hidden" id="diar-gps-lng" value="${e?.gps?.lng||''}">
        </div>
        <div style="grid-column:1/-1;display:flex;align-items:center;gap:10px">
          <input type="checkbox" id="diar-improd" ${e?.improdutivo?'checked':''} style="width:15px;height:15px">
          <label for="diar-improd" style="font-size:12px;color:var(--text-primary);cursor:pointer">⚠️ Dia improdutivo (chuva, paralisação, acidente, etc.)</label>
        </div>
      </div>
      <div style="display:flex;gap:8px;justify-content:flex-end;margin-top:20px">
        <button data-action="_diario_fecharForm" style="padding:9px 18px;background:var(--bg-surface);border:1px solid var(--border);border-radius:8px;font-size:12px;font-weight:700;cursor:pointer;color:var(--text-primary)">Cancelar</button>
        <button data-action="_diario_salvarForm" style="padding:9px 18px;background:var(--accent);border:none;border-radius:8px;color:#fff;font-size:12px;font-weight:700;cursor:pointer">💾 Salvar</button>
      </div>`;

    overlay.style.display='block'; modal.style.display='block';
  }
  async _salvarForm() {
    const g = id=>document.getElementById(id);
    const data          = g('diar-data')?.value||hoje();
    const clima         = g('diar-clima')?.value||'';
    const temperatura   = g('diar-temp')?.value?.trim()||'';
    const etapa         = g('diar-etapa')?.value?.trim()||'';
    const atividades    = g('diar-ativ')?.value?.trim()||'';
    const efetivo       = g('diar-efetivo')?.value?.trim()||'';
    const funcoes       = g('diar-funcoes')?.value?.trim()||'';
    const responsavel   = g('diar-resp')?.value?.trim()||'';
    const creaResponsavel = g('diar-crea')?.value?.trim()||'';
    const materiais     = g('diar-mat')?.value?.trim()||'';
    const equipamentos  = g('diar-equip')?.value?.trim()||'';
    const ocorrencias_dia = g('diar-ocorr')?.value?.trim()||'';
    const observacoes   = g('diar-obs')?.value?.trim()||'';
    const improdutivo   = g('diar-improd')?.checked||false;

    // Validação mínima obrigatória (Lei 14.133/2021 Art. 117 § 1º; Resolução CFT 1.038/2014)
    if (!atividades) { window.toast?.('⚠️ Informe as atividades realizadas no dia.','warn'); return; }
    if (atividades.length < 20) { window.toast?.('⚠️ Descreva as atividades com mais detalhes (mínimo 20 caracteres).','warn'); return; }
    if (!clima) { window.toast?.('⚠️ Informe o clima do dia — campo obrigatório no Diário de Obras.','warn'); return; }
    if (!responsavel) { window.toast?.('⚠️ Informe o nome do responsável/fiscal — campo obrigatório no Diário de Obras.','warn'); return; }

    const obraId4Upload = state.get('obraAtivaId');
    const fotosComUrl = await Promise.all(
      (this._fotosTemp || []).map(async f => {
        const src = f.url || f;
        if (!src || !String(src).startsWith('data:')) return f;
        const storageUrl = await FirebaseService.uploadFotoStorage(
          obraId4Upload, src, 'diario'
        ).catch(() => src);
        return { ...f, url: storageUrl };
      })
    );

    const entrada = {
      data, clima, temperatura, etapa, atividades,
      efetivo, funcoes, responsavel, creaResponsavel,
      materiais, equipamentos, ocorrencias_dia, observacoes,
      improdutivo, fotos: fotosComUrl,
      gps: this._gpsTemp || null,
    };

    if (this._editId) {
      const idx = this._entradas.findIndex(x=>x.id===this._editId);
      if (idx>=0) this._entradas[idx] = { ...this._entradas[idx], ...entrada, gps: this._gpsTemp||this._entradas[idx].gps||null };
    } else {
      this._entradas.push({ id:'d_'+Date.now(), ...entrada, criadoEm: new Date().toISOString() });
    }
    this._fotosTemp = [];
    this._gpsTemp   = null;

    try {
      await this._persistir();
      window.auditRegistrar?.({ modulo: 'Diário de Obras', tipo: this._editId ? 'edição' : 'criação', registro: `Entrada ${dataBR(document.getElementById('diar-data')?.value || hoje())}`, detalhe: this._editId ? 'Entrada editada' : 'Nova entrada criada' });
      window.toast?.('✅ Entrada salva!','ok');
      this._fecharForm(); this._render();
    } catch(e) { window.toast?.('❌ Erro ao salvar.','error'); }
  }

  async _excluir(id) {
    const entrada = this._entradas.find(x=>x.id===id);
    if (!confirm(`🗑️ Mover entrada do diário para a Lixeira?\n\nData: ${dataBR(entrada?.data||'')}\n\nVocê poderá restaurá-la em Configurações → Itens Excluídos.`)) return;
    const obraId = state.get('obraAtivaId');
    const user   = state.get('usuarioLogado') || {};
    const meta   = {
      excluidoPor:  { uid: user.uid||'', email: user.email||'desconhecido', nome: user.displayName||user.email||'Usuário' },
      moduloOrigem: 'diario',
      obraId,
    };
    const lxLabel = `Diário — ${dataBR(entrada?.data||'')}`;
    storageUtils.lixeiraEnviar('diario', lxLabel, { entrada: { ...(entrada||{}) }, obraId }, meta);
    try {
      await FirebaseService.salvarItemLixeiraFirebase({
        id: `lx_${Date.now()}`, tipo: 'diario', label: lxLabel, obraId,
        excluidoEm: new Date().toISOString(), ...meta,
        dados: { entrada: { ...(entrada||{}) }, obraId },
      });
    } catch {}
    this._entradas = this._entradas.filter(x=>x.id!==id);
    try {
      await this._persistir();
      window.auditRegistrar?.({ modulo: 'Diário de Obras', tipo: 'exclusão', registro: lxLabel, detalhe: 'Entrada movida para a lixeira' });
      EventBus.emit('lixeira:atualizada', {});
      window.toast?.('🗑️ Entrada movida para a lixeira.','warn'); this._render();
    }
    catch(e) { window.toast?.('❌ Erro.','error'); }
  }

  _fecharForm() {
    const modal=document.getElementById('diario-modal'); const overlay=document.getElementById('diario-overlay');
    if (modal) modal.style.display='none'; if (overlay) overlay.style.display='none';
    this._editId=null;
  }

  _bindEvents() {
    this._subs.push(EventBus.on('obra:selecionada', async ({ obraId }) => {
      try {
        if (this._unsubWatch) { this._unsubWatch(); this._unsubWatch = null; }
        await this._carregar();
        if (router.current === 'diario') this._render();
        // FIX-E3.4: listener em tempo real para diário colaborativo
        const id = obraId || state.get('obraAtivaId');
        if (id) {
          this._unsubWatch = FirebaseService.watchDiario(id, entradas => {
            this._entradas = entradas;
            state.set('diario', entradas);
            if (router.current === 'diario') this._render();
          });
        }
      } catch(e) { console.error('[DiarioModule] obra:selecionada:', e); }
    }, 'diario'));
  }

  _exposeGlobals() {
    window.renderDiario          = () => { try { this._render(); } catch(e){} };
    window.salvarEntradaDiario   = () => { try { this._salvarForm(); } catch(e){} };
    window.diarioAdicionarFuncao = () => { try { this._abrirForm(null); } catch(e){} };
    window._diario_abrirForm     = (id)=> { try { this._abrirForm(id); } catch(e){} };
    window._diario_fecharForm    = ()  => { try { this._fecharForm(); } catch(e){} };
    window._diario_salvarForm    = ()  => { try { this._salvarForm(); } catch(e){} };
    window._diario_excluir       = (id)=> { try { this._excluir(id); } catch(e){} };
    window.gerarPDFDiario        = ()  => { try { this._gerarPDF(); } catch(e){ console.error('[Diario] PDF:', e); } };
    window.exportarCSVDiario     = ()  => { try { this._exportarCSV(); } catch(e){ console.error('[Diario] CSV:', e); } };
    window._diario_gerarPDFEntrada = (id) => { try { this._gerarPDFEntrada(id); } catch(e){} };

    // ── Fotos no Diário ────────────────────────────────────────
    window._diarioAdicionarFotos = (input) => {
      if (!input?.files?.length) return;
      const statusEl = document.getElementById('diar-foto-status');
      if (statusEl) statusEl.textContent = `Processando ${input.files.length} foto(s)…`;
      let processadas = 0;
      Array.from(input.files).forEach(file => {
        const reader = new FileReader();
        reader.onload = (ev) => {
          this._fotosTemp = this._fotosTemp || [];
          this._fotosTemp.push({ url: ev.target.result, legenda: '', nome: file.name, tamanho: file.size });
          processadas++;
          if (statusEl) statusEl.textContent = `${processadas} foto(s) adicionada(s)`;
          this._atualizarPreviewFotos();
        };
        reader.readAsDataURL(file);
      });
      input.value = ''; // reset para permitir selecionar mesma foto novamente
    };

    window._diarioCapturaCamera = () => {
      // Cria input de câmera dinâmico (capture="environment" para câmera traseira em mobile)
      const inp = document.createElement('input');
      inp.type = 'file'; inp.accept = 'image/*'; inp.capture = 'environment';
      inp.onchange = () => window._diarioAdicionarFotos(inp);
      inp.click();
    };

    window._diarioRemoverFoto = (idx) => {
      if (!this._fotosTemp) return;
      this._fotosTemp.splice(parseInt(idx, 10), 1);
      this._atualizarPreviewFotos();
    };

    // ── Visualizador de foto em tela cheia ─────────────────────
    window._diarioVerFoto = (entradaId, idx) => {
      const entrada = this._entradas.find(e => e.id === entradaId);
      if (!entrada?.fotos?.length) return;
      const fotos = entrada.fotos;
      let current = idx;

      const existente = document.getElementById('diar-lightbox');
      if (existente) existente.remove();

      const lb = document.createElement('div');
      lb.id = 'diar-lightbox';
      lb.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,.92);z-index:99999;display:flex;align-items:center;justify-content:center;flex-direction:column;gap:12px';

      const render = () => {
        const f = fotos[current];
        lb.innerHTML = `
          <div style="position:absolute;top:16px;right:16px;display:flex;gap:8px">
            <span style="color:#aaa;font-size:12px;padding:6px 10px">${current+1} / ${fotos.length}</span>
            <button data-action="_diarFecharLightbox" style="background:rgba(255,255,255,.15);border:none;color:#fff;font-size:18px;cursor:pointer;padding:6px 12px;border-radius:6px">✕</button>
          </div>
          <img src="${f.url||f}" style="max-width:90vw;max-height:80vh;object-fit:contain;border-radius:8px;box-shadow:0 8px 40px rgba(0,0,0,.6)">
          ${f.legenda?`<div style="color:#ccc;font-size:12px;max-width:600px;text-align:center">${f.legenda}</div>`:''}
          <div style="display:flex;gap:16px">
            ${current > 0 ? `<button data-action="_diarLBNav" data-arg0="-1" style="padding:10px 24px;background:rgba(255,255,255,.15);border:none;color:#fff;font-size:18px;cursor:pointer;border-radius:8px">‹</button>` : '<div style="width:72px"></div>'}
            ${current < fotos.length-1 ? `<button data-action="_diarLBNav" data-arg0="1" style="padding:10px 24px;background:rgba(255,255,255,.15);border:none;color:#fff;font-size:18px;cursor:pointer;border-radius:8px">›</button>` : '<div style="width:72px"></div>'}
          </div>`;
      };

      window._diarLBNav = (dir) => { current = Math.max(0, Math.min(fotos.length-1, current+parseInt(dir,10))); render(); };
      lb.addEventListener('click', (ev) => { if (ev.target === lb) lb.remove(); });
      document.body.appendChild(lb);
      render();
    };
    window._diarioCapturarGPS = () => {
      if (!navigator.geolocation) {
        window.toast?.('⚠️ Geolocalização não suportada neste dispositivo.', 'warn'); return;
      }
      const btn = document.querySelector('[data-action="_diarioCapturarGPS"]');
      if (btn) { btn.textContent = '⏳ Aguardando…'; btn.disabled = true; }
      navigator.geolocation.getCurrentPosition(
        (pos) => {
          const lat = pos.coords.latitude;
          const lng = pos.coords.longitude;
          const acc = Math.round(pos.coords.accuracy);
          this._gpsTemp = { lat, lng, acc, capturedAt: new Date().toISOString() };
          const latEl = document.getElementById('diar-gps-lat');
          const lngEl = document.getElementById('diar-gps-lng');
          const disp  = document.getElementById('diar-gps-display');
          if (latEl) latEl.value = lat;
          if (lngEl) lngEl.value = lng;
          if (disp)  disp.textContent = `${lat.toFixed(6)}, ${lng.toFixed(6)} (±${acc}m)`;
          if (btn) { btn.textContent = '✅ Capturado'; btn.disabled = false; }
          window.toast?.(`📍 GPS capturado (precisão: ±${acc}m)`, 'ok');
        },
        (err) => {
          if (btn) { btn.textContent = 'Obter GPS'; btn.disabled = false; }
          window.toast?.(`⚠️ Erro de GPS: ${err.message}`, 'warn');
        },
        { enableHighAccuracy: true, timeout: 10000, maximumAge: 0 }
      );
    };
  }

  _atualizarPreviewFotos() {
    const el = document.getElementById('diar-fotos-preview');
    if (!el) return;
    const fotos = this._fotosTemp || [];
    if (!fotos.length) { el.innerHTML = ''; return; }
    el.innerHTML = fotos.map((f, i) =>
      `<div style="position:relative">
        <img src="${f.url||f}" style="width:80px;height:60px;object-fit:cover;border-radius:6px;border:1px solid var(--border)" title="${f.nome||''}">
        <button data-action="_diarioRemoverFoto" data-arg0="${i}" style="position:absolute;top:2px;right:2px;background:rgba(0,0,0,.6);border:none;color:#fff;border-radius:50%;width:18px;height:18px;font-size:10px;cursor:pointer;line-height:18px;text-align:center">✕</button>
      </div>`
    ).join('');
  }

  // ── Gerar PDF completo do Diário ──────────────────────────────
  _gerarPDF() {
    const obraId = state.get('obraAtivaId');
    const cfg    = state.get('cfg') || {};
    const lista  = [...this._entradas].sort((a,b)=>(a.data||'').localeCompare(b.data||''));
    if (!lista.length) { window.toast?.('⚠️ Nenhuma entrada no diário.', 'warn'); return; }

    const logo = state.get('logoBase64') || cfg.logo || '';
    const CLIMAS_MAP = { sol:'☀️ Sol', parcial:'⛅ Parcial', chuva_leve:'🌦️ Chuva Leve', chuva:'🌧️ Chuva', tempestade:'⛈️ Tempestade', granizo:'🌩️ Granizo' };

    const campo = (lbl, val) => val ? `<div class="campo"><span class="lbl">${lbl}:</span> ${val}</div>` : '';
    const colunas = (...pares) => `<div class="grid2">${pares.filter(([,v])=>v).map(([l,v])=>`<div class="campo"><span class="lbl">${l}:</span> ${v}</div>`).join('')}</div>`;

    const html = `<!DOCTYPE html><html lang="pt-BR"><head><meta charset="utf-8">
    <title>Diário de Obras — ${cfg.objeto || 'Obra'}</title>
    <style>
      *{box-sizing:border-box;margin:0;padding:0}
      body{font-family:Arial,sans-serif;font-size:10.5pt;color:#1e293b;background:#fff;padding:12mm}
      .cabecalho{display:flex;align-items:flex-start;gap:16px;border-bottom:2.5px solid #1e293b;padding-bottom:10px;margin-bottom:14px}
      .cabecalho img{max-height:52px;max-width:120px;object-fit:contain}
      .cab-texto h1{font-size:14pt;font-weight:800;color:#1e293b}
      .cab-texto p{font-size:8.5pt;color:#475569;margin-top:2px}
      .cab-info{display:grid;grid-template-columns:1fr 1fr;gap:4px;margin-top:8px}
      .cab-info span{font-size:8pt;color:#64748b}
      .cab-info strong{color:#1e293b}
      .entrada{border:1px solid #cbd5e1;border-radius:6px;padding:10px 13px;margin-bottom:10px;page-break-inside:avoid}
      .entrada-header{background:#f8fafc;margin:-10px -13px 10px;padding:8px 13px;border-radius:5px 5px 0 0;border-bottom:1px solid #e2e8f0;display:flex;align-items:center;gap:10px;flex-wrap:wrap}
      .entrada-data{font-size:12pt;font-weight:800;color:#1e293b}
      .badge{display:inline-block;font-size:8pt;padding:1px 9px;border-radius:12px;background:#f1f5f9;color:#475569;border:1px solid #e2e8f0}
      .badge-improd{background:#fef3c7;color:#b45309;border-color:#fde68a}
      .badge-clima{background:#dbeafe;color:#1d4ed8;border-color:#bfdbfe}
      .badge-temp{background:#f0fdf4;color:#166534;border-color:#bbf7d0}
      .badge-etapa{background:#ede9fe;color:#6d28d9;border-color:#c4b5fd}
      .secao{font-size:8pt;font-weight:700;color:#64748b;text-transform:uppercase;letter-spacing:.5px;margin:8px 0 4px;border-bottom:1px solid #f1f5f9;padding-bottom:2px}
      .campo{font-size:9.5pt;color:#334155;margin-bottom:3px;line-height:1.55}
      .lbl{font-weight:700;color:#64748b;font-size:8.5pt}
      .grid2{display:grid;grid-template-columns:1fr 1fr;gap:4px 16px}
      .ocorr{background:#fffbeb;border-left:3px solid #f59e0b;padding:6px 10px;margin:6px 0;border-radius:0 4px 4px 0;font-size:9pt;color:#78350f}
      .obs-box{background:#f8fafc;border-left:3px solid #3b82f6;padding:6px 10px;margin:6px 0;border-radius:0 4px 4px 0;font-size:9pt;color:#1e3a5f}
      .assinaturas{display:grid;grid-template-columns:1fr 1fr;gap:30px;margin-top:40px;page-break-inside:avoid}
      .assinatura-bloco{border-top:1px solid #334155;padding-top:6px}
      .assinatura-bloco p{font-size:8.5pt;color:#334155}
      .rodape{font-size:7.5pt;color:#94a3b8;text-align:center;margin-top:20px;border-top:1px solid #e2e8f0;padding-top:8px}
      @media print{@page{size:A4;margin:10mm}body{padding:0}}
    </style></head><body>

    <div class="cabecalho">
      ${logo ? `<img src="${logo}" alt="Logo">` : ''}
      <div class="cab-texto">
        <h1>📓 Diário de Obras</h1>
        <p>${cfg.objeto || ''}</p>
        <div class="cab-info">
          <span>Contrato: <strong>${cfg.contrato||'—'}</strong></span>
          <span>Contratante: <strong>${cfg.contratante||'—'}</strong></span>
          <span>Executora: <strong>${cfg.contratada||'—'}</strong></span>
          <span>Fiscal: <strong>${cfg.fiscal||'—'}</strong></span>
          <span>Período: <strong>${dataBR(lista[0]?.data)} a ${dataBR(lista[lista.length-1]?.data)}</strong></span>
          <span>Emitido em: <strong>${new Date().toLocaleDateString('pt-BR')}</strong></span>
        </div>
      </div>
    </div>

    ${lista.map((e,idx) => {
      const clima = CLIMAS_MAP[e.clima] || '';
      return `<div class="entrada">
        <div class="entrada-header">
          <span class="entrada-data">Nº ${idx+1} — 📅 ${dataBR(e.data)}</span>
          ${clima ? `<span class="badge badge-clima">${clima}</span>` : ''}
          ${e.temperatura ? `<span class="badge badge-temp">🌡️ ${e.temperatura}</span>` : ''}
          ${e.etapa ? `<span class="badge badge-etapa">🏗️ ${e.etapa}</span>` : ''}
          ${e.improdutivo ? '<span class="badge badge-improd">⚠️ Dia Improdutivo</span>' : ''}
        </div>
        <div class="secao">🛠️ Atividades Realizadas</div>
        ${campo('',e.atividades)}
        ${(e.efetivo||e.funcoes) ? `<div class="secao">👷 Equipe</div>${colunas(['Efetivo',e.efetivo],['Funções',e.funcoes])}` : ''}
        ${(e.materiais||e.equipamentos) ? `<div class="secao">📦 Materiais e Equipamentos</div>${colunas(['Materiais',e.materiais],['Equipamentos',e.equipamentos])}` : ''}
        ${e.ocorrencias_dia ? `<div class="secao">🚧 Ocorrências / Problemas</div><div class="ocorr">${e.ocorrencias_dia}</div>` : ''}
        ${e.observacoes ? `<div class="secao">📝 Observações</div><div class="obs-box">${e.observacoes}</div>` : ''}
        ${(e.responsavel||e.creaResponsavel) ? `<div class="secao">✍️ Responsável</div>${colunas(['Fiscal/RT',e.responsavel],['CREA/CAU',e.creaResponsavel])}` : ''}
      </div>`;
    }).join('')}

    <div class="assinaturas">
      <div class="assinatura-bloco">
        <p><strong>${cfg.fiscal || 'Fiscal do Contrato'}</strong></p>
        <p>Fiscal da Obra</p>
        ${cfg.creaFiscal ? `<p>CREA/CAU: ${cfg.creaFiscal}</p>` : ''}
        <p style="margin-top:4px">Data: ___/___/______</p>
      </div>
      <div class="assinatura-bloco">
        <p><strong>${cfg.contratada || 'Empresa Executora'}</strong></p>
        <p>Responsável Técnico da Executora</p>
        <p style="margin-top:4px">Data: ___/___/______</p>
      </div>
    </div>

    <div class="rodape">
      Diário de Obras — ${cfg.objeto || ''} | Gerado em ${new Date().toLocaleString('pt-BR')} | ${lista.length} entrada(s)
    </div>
    <script>window.print();<\/script>
    </body></html>`;

    const w = window.open('','_blank','width=900,height=700');
    if (w) { w.document.write(html); w.document.close(); }
    else { window.toast?.('⚠️ Permita popups para gerar PDF.','warn'); }
    window.auditRegistrar?.({ modulo: 'Diário de Obras', tipo: 'exportação', registro: `${lista.length} entradas`, detalhe: 'PDF do Diário de Obras' });
  }

  // ── Gerar PDF de uma entrada específica ──────────────────────
  _gerarPDFEntrada(id) {
    const e = this._entradas.find(x => x.id === id);
    if (!e) return;
    const cfg = state.get('cfg') || {};
    const CLIMAS_MAP = { sol:'☀️ Sol', parcial:'⛅ Parcial', chuva_leve:'🌦️ Chuva Leve', chuva:'🌧️ Chuva', tempestade:'⛈️ Tempestade', granizo:'🌩️ Granizo' };
    const clima = CLIMAS_MAP[e.clima] || '';
    const campo = (lbl, val) => val ? `<div class="campo"><span class="lbl">${lbl}:</span> ${val}</div>` : '';

    const html = `<!DOCTYPE html><html lang="pt-BR"><head><meta charset="utf-8">
    <title>Diário ${dataBR(e.data)}</title>
    <style>
      *{box-sizing:border-box;margin:0;padding:0}
      body{font-family:Arial,sans-serif;font-size:11pt;color:#1e293b;padding:15mm}
      h1{font-size:14pt;font-weight:800;border-bottom:2.5px solid #1e293b;padding-bottom:8px;margin-bottom:4px}
      .sub{font-size:8.5pt;color:#475569;margin-bottom:14px}
      .secao{font-size:8pt;font-weight:700;color:#64748b;text-transform:uppercase;letter-spacing:.5px;margin:12px 0 4px;border-bottom:1px solid #e2e8f0;padding-bottom:2px}
      .campo{font-size:10pt;color:#334155;margin-bottom:4px;line-height:1.55}
      .lbl{font-weight:700;color:#64748b;font-size:8.5pt}
      .badges{display:flex;gap:8px;flex-wrap:wrap;margin-bottom:10px}
      .badge{display:inline-block;font-size:8.5pt;padding:2px 10px;border-radius:12px;background:#f1f5f9;color:#475569;border:1px solid #e2e8f0}
      .badge-improd{background:#fef3c7;color:#b45309;border-color:#fde68a}
      .ocorr{background:#fffbeb;border-left:3px solid #f59e0b;padding:7px 11px;margin:6px 0;border-radius:0 4px 4px 0;font-size:10pt;color:#78350f}
      .obs{background:#f8fafc;border-left:3px solid #3b82f6;padding:7px 11px;margin:6px 0;border-radius:0 4px 4px 0;font-size:10pt;color:#1e3a5f}
      .assinaturas{display:grid;grid-template-columns:1fr 1fr;gap:30px;margin-top:50px}
      .assin{border-top:1px solid #334155;padding-top:6px;font-size:9pt;color:#334155}
      @media print{@page{size:A4;margin:10mm}body{padding:0}}
    </style></head><body>
    <h1>📓 Diário de Obras</h1>
    <p class="sub">${cfg.objeto||''} ${cfg.contrato?'| Contrato: '+cfg.contrato:''} | Fiscal: ${cfg.fiscal||'—'} | Emitido: ${new Date().toLocaleDateString('pt-BR')}</p>

    <div class="badges">
      <span class="badge">📅 ${dataBR(e.data)}</span>
      ${clima?`<span class="badge">${clima}</span>`:''}
      ${e.temperatura?`<span class="badge">🌡️ ${e.temperatura}</span>`:''}
      ${e.etapa?`<span class="badge">🏗️ ${e.etapa}</span>`:''}
      ${e.improdutivo?'<span class="badge badge-improd">⚠️ Dia Improdutivo</span>':''}
    </div>

    <div class="secao">🛠️ Atividades Realizadas</div>
    ${campo('',e.atividades)}

    ${(e.efetivo||e.funcoes)?`<div class="secao">👷 Equipe</div>${campo('Efetivo',e.efetivo)}${campo('Funções',e.funcoes)}`:''}
    ${(e.materiais||e.equipamentos)?`<div class="secao">📦 Materiais e Equipamentos</div>${campo('Materiais',e.materiais)}${campo('Equipamentos',e.equipamentos)}`:''}
    ${e.ocorrencias_dia?`<div class="secao">🚧 Ocorrências / Problemas</div><div class="ocorr">${e.ocorrencias_dia}</div>`:''}
    ${e.observacoes?`<div class="secao">📝 Observações</div><div class="obs">${e.observacoes}</div>`:''}

    <div class="assinaturas">
      <div class="assin">
        <p><strong>${e.responsavel||cfg.fiscal||'Fiscal do Contrato'}</strong></p>
        <p>${e.creaResponsavel||cfg.creaFiscal||'Fiscal de Obras'}</p>
        <p style="margin-top:4px">Data: ___/___/______</p>
      </div>
      <div class="assin">
        <p><strong>${cfg.contratada||'Empresa Executora'}</strong></p>
        <p>Responsável Técnico</p>
        <p style="margin-top:4px">Data: ___/___/______</p>
      </div>
    </div>
    <script>window.print();<\/script></body></html>`;

    const w = window.open('','_blank','width=800,height=600');
    if (w) { w.document.write(html); w.document.close(); }
    else { window.toast?.('⚠️ Permita popups para gerar PDF.','warn'); }
  }

  // ── Exportar CSV do Diário ────────────────────────────────────
  _exportarCSV() {
    if (!this._entradas.length) { window.toast?.('⚠️ Nenhuma entrada no diário.', 'warn'); return; }
    const CLIMAS_MAP = { sol:'Sol', parcial:'Parcial', chuva_leve:'Chuva Leve', chuva:'Chuva', tempestade:'Tempestade', granizo:'Granizo' };
    const cabec = ['Data','Clima','Temperatura','Etapa','Atividades','Efetivo','Funções','Materiais','Equipamentos','Ocorrências','Observações','Responsável','CREA/CAU','Improdutivo'];
    const lista = [...this._entradas].sort((a,b)=>(a.data||'').localeCompare(b.data||''));
    const linhas = lista.map(e => [
      dataBR(e.data), CLIMAS_MAP[e.clima] || '',
      e.temperatura || '', e.etapa || '', e.atividades || '',
      e.efetivo || '', e.funcoes || '', e.materiais || '',
      e.equipamentos || '', e.ocorrencias_dia || '', e.observacoes || '',
      e.responsavel || '', e.creaResponsavel || '',
      e.improdutivo ? 'Sim' : 'Não',
    ]);
    baixarCSV([cabec, ...linhas], `diario_obras_${new Date().toISOString().slice(0,10)}`);
    window.auditRegistrar?.({ modulo: 'Diário de Obras', tipo: 'exportação', registro: `${lista.length} entradas`, detalhe: 'Exportação CSV do Diário de Obras' });
    window.toast?.('✅ CSV do Diário exportado!', 'ok');
  }

  destroy() { this._subs.forEach(u=>u()); this._subs=[]; if (this._unsubWatch) { this._unsubWatch(); this._unsubWatch = null; } }
}
