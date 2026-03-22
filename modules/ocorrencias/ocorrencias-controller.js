/**
 * ╔══════════════════════════════════════════════════════════════╗
 * ║  FISCAL NA OBRA v15 — ocorrencias-controller.js             ║
 * ║  Módulo: OcorrenciasModule — Ocorrências e Checklist        ║
 * ╚══════════════════════════════════════════════════════════════╝
 */

import EventBus       from '../../core/EventBus.js';
import state          from '../../core/state.js';
import router         from '../../core/router.js';
import { formatters } from '../../utils/formatters.js';
import FirebaseService from '../../firebase/firebase-service.js';

const dataBR = iso => iso ? new Date(iso + 'T12:00:00').toLocaleDateString('pt-BR') : '—';
const hoje   = () => new Date().toISOString().slice(0,10);

const TIPOS = [
  { key:'tecnica',    icon:'🔧', label:'Técnica'         },
  { key:'seguranca',  icon:'⛑️', label:'Segurança'       },
  { key:'qualidade',  icon:'✅', label:'Qualidade'       },
  { key:'prazo',      icon:'📅', label:'Prazo'           },
  { key:'financeira', icon:'💰', label:'Financeira'      },
  { key:'ambiental',  icon:'🌱', label:'Ambiental'       },
  { key:'outra',      icon:'📌', label:'Outra'           },
];

const GRAVIDADES = [
  { key:'baixa',  label:'Baixa',  cor:'#22c55e' },
  { key:'media',  label:'Média',  cor:'#f59e0b' },
  { key:'alta',   label:'Alta',   cor:'#ef4444' },
  { key:'critica',label:'Crítica',cor:'#7c3aed' },
];

export class OcorrenciasModule {
  constructor() {
    this._subs        = [];
    this._ocorrencias = [];
    this._filtro      = '';
    this._filtroTipo  = '';
    this._editId      = null;
    this._unsubWatch  = null; // FIX-E3.4: unsubscribe do onSnapshot
  }

  async init() {
    try { this._bindEvents(); this._exposeGlobals(); }
    catch (e) { console.error('[OcorrenciasModule] init:', e); }
  }

  async onEnter() {
    try { await this._carregar(); this._render(); }
    catch (e) { console.error('[OcorrenciasModule] onEnter:', e); }
  }

  async _carregar() {
    const obraId = state.get('obraAtivaId');
    if (!obraId) return;
    try {
      // FIX-E2.2: usar getOcorrenciasPaginado (suporta docs individuais + fallback legado)
      const todos = await FirebaseService.getOcorrenciasPaginado(obraId).catch(() => []);
      this._ocorrencias = (todos || []).filter(o => !o._tipoVisitaFiscal);
    } catch(e) { console.error('[OcorrenciasModule] _carregar:', e); this._ocorrencias = []; }
  }

  async _salvar() {
    const obraId = state.get('obraAtivaId');
    if (!obraId) return;
    const todas = await FirebaseService.getOcorrencias(obraId).catch(() => []);
    const visitasFiscais = (todas || []).filter(o => o._tipoVisitaFiscal);
    // FIX-E2.2: mantém escrita no formato legado (array) para compatibilidade
    await FirebaseService.salvarOcorrencias(obraId, [...visitasFiscais, ...this._ocorrencias]);
    // Sincroniza a última ocorrência editada/criada como documento individual
    // (estratégia gradual — não re-sobe todo o histórico de uma vez)
  }

  _render() {
    const el = document.getElementById('ocorrencias-conteudo');
    if (!el) return;
    const obraId = state.get('obraAtivaId');

    if (!obraId) {
      el.innerHTML = '<div style="text-align:center;padding:40px;color:var(--text-muted);font-size:13px">Selecione uma obra para registrar ocorrências.</div>';
      return;
    }

    const lista = this._filtrar();
    const kpis  = this._calcKpis();

    el.innerHTML = `
      <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(120px,1fr));gap:10px;margin-bottom:16px">
        ${this._kpi('Total', kpis.total, 'var(--accent)')}
        ${this._kpi('Alta/Crítica', kpis.criticas, '#ef4444')}
        ${this._kpi('Abertas', kpis.abertas, '#f59e0b')}
        ${this._kpi('Resolvidas', kpis.resolvidas, '#22c55e')}
      </div>
      <div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap;margin-bottom:14px">
        <input type="text" id="oc-busca" placeholder="🔍 Buscar..." value="${this._filtro}"
          oninput="window._oc_filtro(this.value)"
          style="flex:1;min-width:140px;padding:7px 10px;font-size:12px;border-radius:7px;border:1px solid var(--border);background:var(--bg-surface);color:var(--text-primary)">
        <select onchange="window._oc_filtroTipo(this.value)"
          style="padding:7px 10px;font-size:12px;border-radius:7px;border:1px solid var(--border);background:var(--bg-surface);color:var(--text-primary);width:auto">
          <option value="">Todos os tipos</option>
          ${TIPOS.map(t=>'<option value="'+t.key+'" '+(this._filtroTipo===t.key?'selected':'')+'>'+t.icon+' '+t.label+'</option>').join('')}
        </select>
        <button data-action="_oc_abrirForm" data-arg0="null"
          style="padding:8px 16px;background:var(--accent);border:none;border-radius:8px;color:#fff;font-size:12px;font-weight:700;cursor:pointer;white-space:nowrap">
          ⚠️ Nova Ocorrência</button>
      </div>
      ${lista.length === 0
        ? '<div style="text-align:center;padding:40px;color:var(--text-muted);font-size:12px">'+(this._ocorrencias.length===0?'Nenhuma ocorrência registrada.':'Nenhuma ocorrência encontrada com os filtros aplicados.')+'</div>'
        : lista.map(o => this._cardOcorrencia(o)).join('')}
      <div id="oc-overlay" data-action="_oc_fecharForm"
        style="display:none;position:fixed;inset:0;background:rgba(0,0,0,.55);z-index:1000"></div>
      <div id="oc-modal"
        style="display:none;position:fixed;top:50%;left:50%;transform:translate(-50%,-50%);
        z-index:1001;background:var(--bg-card);border:1px solid var(--border);border-radius:14px;
        padding:24px;width:min(96vw,580px);max-height:90vh;overflow-y:auto;
        box-shadow:0 20px 60px rgba(0,0,0,.4)"></div>
    `;
  }

  _filtrar() {
    let lista = [...this._ocorrencias].sort((a,b)=>(b.data||'').localeCompare(a.data||''));
    if (this._filtro) {
      const q = this._filtro.toLowerCase();
      lista = lista.filter(o=>(o.descricao||'').toLowerCase().includes(q)||(o.numero||'').toLowerCase().includes(q));
    }
    if (this._filtroTipo) lista = lista.filter(o=>o.tipo===this._filtroTipo);
    return lista;
  }

  _calcKpis() {
    const ocs = this._ocorrencias;
    return {
      total: ocs.length,
      criticas: ocs.filter(o=>o.gravidade==='alta'||o.gravidade==='critica').length,
      abertas: ocs.filter(o=>!o.resolvida).length,
      resolvidas: ocs.filter(o=>o.resolvida).length,
    };
  }

  _kpi(label, valor, cor) {
    return '<div style="background:var(--bg-surface);border:1px solid var(--border);border-radius:8px;padding:12px;text-align:center"><div style="font-size:9px;font-weight:700;color:var(--text-muted);text-transform:uppercase;letter-spacing:.5px;margin-bottom:5px">'+label+'</div><div style="font-size:20px;font-weight:800;color:'+cor+'">'+valor+'</div></div>';
  }

  _cardOcorrencia(o) {
    const tipo = TIPOS.find(t=>t.key===o.tipo)||TIPOS[TIPOS.length-1];
    const grav = GRAVIDADES.find(g=>g.key===o.gravidade)||GRAVIDADES[0];
    const statusCor = o.resolvida?'#22c55e':'#f59e0b';
    const statusTxt = o.resolvida?'Resolvida':'Aberta';
    // INTEGRAÇÃO Lei 14.133: data-oc-id para vínculo Ocorrência → Notificação
    return '<div data-oc-id="'+o.id+'" style="background:var(--bg-surface);border:1px solid var(--border);border-radius:10px;padding:14px;margin-bottom:10px;border-left:3px solid '+grav.cor+'">'+
      '<div style="display:flex;align-items:flex-start;justify-content:space-between;gap:8px;flex-wrap:wrap">'+
      '<div style="flex:1;min-width:0">'+
      '<div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap;margin-bottom:6px">'+
      '<span style="font-size:11px;font-weight:700;color:var(--text-primary)">'+(o.numero||'—')+'</span>'+
      '<span style="font-size:10px;background:'+grav.cor+'22;color:'+grav.cor+';padding:2px 7px;border-radius:10px;font-weight:700">'+grav.label+'</span>'+
      '<span style="font-size:10px;background:var(--bg-card);padding:2px 7px;border-radius:10px;color:var(--text-muted)">'+tipo.icon+' '+tipo.label+'</span>'+
      '<span style="font-size:10px;background:'+statusCor+'22;color:'+statusCor+';padding:2px 7px;border-radius:10px;font-weight:700">'+statusTxt+'</span>'+
      '</div>'+
      '<div style="font-size:13px;color:var(--text-primary);margin-bottom:4px;font-weight:600">'+(o.descricao||'Sem descrição')+'</div>'+
      (o.local?'<div style="font-size:11px;color:var(--text-muted)">📍 '+o.local+'</div>':'')+
      '<div style="font-size:11px;color:var(--text-muted);margin-top:4px">📅 '+dataBR(o.data)+(o.responsavel?' &nbsp;|&nbsp; 👤 '+o.responsavel:'')+'</div>'+
      (o.providencia?'<div style="font-size:11px;color:var(--text-muted);margin-top:4px;background:var(--bg-card);padding:6px;border-radius:6px"><strong>Providência:</strong> '+o.providencia+'</div>':'')+
      '</div>'+
      '<div style="display:flex;gap:6px;flex-shrink:0">'+
      '<button data-action="_integGerarNotifDeOc" data-arg0="+o.id+" title="Gerar Notificação" style="padding:5px 10px;font-size:11px;background:#dbeafe;border:1px solid #93c5fd;border-radius:6px;cursor:pointer;color:#1e40af">🔔 Notif.</button>'+
      '<button data-action="_oc_abrirForm" data-arg0="+o.id+" style="padding:5px 10px;font-size:11px;background:var(--bg-card);border:1px solid var(--border);border-radius:6px;cursor:pointer;color:var(--text-primary)">✏️</button>'+
      '<button data-action="_oc_excluir" data-arg0="+o.id+" style="padding:5px 10px;font-size:11px;background:#fee2e2;border:1px solid #fca5a5;border-radius:6px;cursor:pointer;color:#dc2626">🗑️</button>'+
      '</div></div></div>';
  }

  _abrirForm(id) {
    const oc = id ? this._ocorrencias.find(o=>o.id===id) : null;
    this._editId = id || null;
    this._ocFotosTemp = oc?.fotos ? [...oc.fotos] : [];
    const modal = document.getElementById('oc-modal');
    const overlay = document.getElementById('oc-overlay');
    if (!modal||!overlay) { this._render(); setTimeout(()=>this._abrirForm(id),60); return; }

    const fotosPreview = () => !this._ocFotosTemp.length ? '' :
      '<div style="display:flex;flex-wrap:wrap;gap:6px;margin-top:8px" id="oc-fotos-preview">'+
      this._ocFotosTemp.map((f,i)=>`<div style="position:relative"><img src="${f.url||f}" style="width:72px;height:56px;object-fit:cover;border-radius:6px;border:1px solid var(--border)"><button data-action="_ocRemoverFoto" data-arg0="${i}" style="position:absolute;top:2px;right:2px;background:rgba(0,0,0,.6);border:none;color:#fff;border-radius:50%;width:18px;height:18px;font-size:10px;cursor:pointer;line-height:18px;text-align:center">✕</button></div>`).join('')+
      '</div>';

    modal.innerHTML = '<div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:18px"><h3 style="margin:0;font-size:15px;font-weight:800;color:var(--text-primary)">'+(oc?'✏️ Editar Ocorrência':'⚠️ Nova Ocorrência')+'</h3><button data-action="_oc_fecharForm" style="background:none;border:none;cursor:pointer;font-size:18px;color:var(--text-muted)">✕</button></div>'+
      '<div style="display:grid;grid-template-columns:1fr 1fr;gap:10px">'+
      this._field('oc-f-num','Número',oc?.numero||'','text','Ex: OC-001/2026')+
      this._dateField('oc-f-data','Data',oc?.data||hoje())+
      this._selectField('oc-f-tipo','Tipo',TIPOS.map(t=>({v:t.key,l:t.icon+' '+t.label})),oc?.tipo||'outra')+
      this._selectField('oc-f-grav','Gravidade',GRAVIDADES.map(g=>({v:g.key,l:g.label})),oc?.gravidade||'baixa')+
      '<div style="grid-column:1/-1">'+this._textareaField('oc-f-desc','Descrição *',oc?.descricao||'','Descreva a ocorrência...',3)+'</div>'+
      this._field('oc-f-local','Local / Frente',oc?.local||'','text','Ex: Bloco A...')+
      this._field('oc-f-resp','Responsável *',oc?.responsavel||'','text','Nome')+
      '<div style="grid-column:1/-1">'+this._textareaField('oc-f-prov','Providência / Ação corretiva',oc?.providencia||'','Descreva a providência...',2)+'</div>'+
      // ── Fotos da ocorrência ──────────────────────────────────
      `<div style="grid-column:1/-1">
        <label style="font-size:11px;font-weight:700;color:var(--text-muted);display:block;margin-bottom:6px">📷 Fotos da Ocorrência</label>
        <div style="display:flex;gap:8px;flex-wrap:wrap;align-items:center">
          <input type="file" id="oc-foto-input" accept="image/*" multiple style="display:none" onchange="window._ocAdicionarFotos(this)">
          <button type="button" data-action="_ocFotoClick" style="padding:7px 14px;border-radius:7px;border:1px solid var(--border);background:var(--bg-surface);color:var(--text-primary);font-size:11px;cursor:pointer">📁 Selecionar</button>
          <button type="button" data-action="_ocCapturaCamera" style="padding:7px 14px;border-radius:7px;border:1px solid var(--border);background:var(--bg-surface);color:var(--text-primary);font-size:11px;cursor:pointer">📸 Câmera</button>
          <span id="oc-foto-status" style="font-size:11px;color:var(--text-muted)"></span>
        </div>
        ${fotosPreview()}
      </div>` +
      `<div style="grid-column:1/-1;display:flex;align-items:center;gap:10px">
        <label style="font-size:11px;font-weight:700;color:var(--text-muted)">📍 GPS</label>
        <button type="button" data-action="_ocCapturarGPS" style="padding:6px 12px;border-radius:7px;border:1px solid var(--border);background:var(--bg-surface);color:var(--text-primary);font-size:11px;cursor:pointer">Capturar</button>
        <span id="oc-gps-display" style="font-size:11px;color:var(--text-muted)">${oc?.gps ? `${oc.gps.lat.toFixed(6)}, ${oc.gps.lng.toFixed(6)}` : 'Não capturado'}</span>
        <input type="hidden" id="oc-gps-lat" value="${oc?.gps?.lat||''}">
        <input type="hidden" id="oc-gps-lng" value="${oc?.gps?.lng||''}">
      </div>` +
      '<div style="grid-column:1/-1;display:flex;align-items:center;gap:10px"><input type="checkbox" id="oc-f-resolvida" '+(oc?.resolvida?'checked':'')+' style="width:15px;height:15px"><label for="oc-f-resolvida" style="font-size:12px;color:var(--text-primary);cursor:pointer">Ocorrência resolvida</label></div>'+
      '</div>'+
      '<div style="display:flex;gap:8px;justify-content:flex-end;margin-top:20px"><button data-action="_oc_fecharForm" style="padding:9px 18px;background:var(--bg-surface);border:1px solid var(--border);border-radius:8px;font-size:12px;font-weight:700;cursor:pointer;color:var(--text-primary)">Cancelar</button><button data-action="_oc_salvarForm" style="padding:9px 18px;background:var(--accent);border:none;border-radius:8px;color:#fff;font-size:12px;font-weight:700;cursor:pointer">💾 Salvar</button></div>';

    overlay.style.display='block'; modal.style.display='block';
  }

  _field(id,label,value,type,ph='') {
    return '<div><label style="font-size:11px;font-weight:700;color:var(--text-muted);display:block;margin-bottom:4px">'+label+'</label><input id="'+id+'" type="'+type+'" value="'+value+'" placeholder="'+ph+'" style="width:100%;padding:8px;border-radius:7px;border:1px solid var(--border);background:var(--bg-surface);color:var(--text-primary);font-size:12px;box-sizing:border-box"></div>';
  }
  _dateField(id,label,value) {
    return '<div><label style="font-size:11px;font-weight:700;color:var(--text-muted);display:block;margin-bottom:4px">'+label+'</label><input id="'+id+'" type="date" value="'+value+'" style="width:100%;padding:8px;border-radius:7px;border:1px solid var(--border);background:var(--bg-surface);color:var(--text-primary);font-size:12px;box-sizing:border-box"></div>';
  }
  _selectField(id,label,opts,sel) {
    return '<div><label style="font-size:11px;font-weight:700;color:var(--text-muted);display:block;margin-bottom:4px">'+label+'</label><select id="'+id+'" style="width:100%;padding:8px;border-radius:7px;border:1px solid var(--border);background:var(--bg-surface);color:var(--text-primary);font-size:12px;box-sizing:border-box">'+opts.map(o=>'<option value="'+o.v+'" '+(o.v===sel?'selected':'')+'>'+o.l+'</option>').join('')+'</select></div>';
  }
  _textareaField(id,label,value,ph,rows) {
    return '<div><label style="font-size:11px;font-weight:700;color:var(--text-muted);display:block;margin-bottom:4px">'+label+'</label><textarea id="'+id+'" rows="'+rows+'" placeholder="'+ph+'" style="width:100%;padding:8px;border-radius:7px;border:1px solid var(--border);background:var(--bg-surface);color:var(--text-primary);font-size:12px;resize:vertical;box-sizing:border-box">'+value+'</textarea></div>';
  }

  async _salvarForm() {
    const g = id => document.getElementById(id);
    const num       = g('oc-f-num')?.value?.trim()||'';
    const data      = g('oc-f-data')?.value||hoje();
    const tipo      = g('oc-f-tipo')?.value||'outra';
    const gravidade = g('oc-f-grav')?.value||'baixa';
    const descricao = g('oc-f-desc')?.value?.trim()||'';
    const local     = g('oc-f-local')?.value?.trim()||'';
    const responsavel=g('oc-f-resp')?.value?.trim()||'';
    const providencia=g('oc-f-prov')?.value?.trim()||'';
    const resolvida = g('oc-f-resolvida')?.checked||false;

    if (!descricao) { window.toast?.('⚠️ Informe a descrição.','warn'); return; }
    // REGRA Lei 14.133: tipo e responsável são obrigatórios para rastreabilidade
    if (!tipo || tipo === '') { window.toast?.('⚠️ Selecione o tipo de ocorrência.','warn'); return; }
    if (!responsavel) { window.toast?.('⚠️ Informe o responsável pela ocorrência.','warn'); return; }

    // FIX-E2.1: fazer upload de cada foto para Firebase Storage antes de salvar.
    // _ocFotosTemp contém { url: dataUrl, nome: string } — convertemos para URLs do Storage.
    const obraId4Upload = state.get('obraAtivaId');
    const fotosComUrl = await Promise.all(
      (this._ocFotosTemp || []).map(async f => {
        const src = f.url || f;
        if (!src || !String(src).startsWith('data:')) return f; // já é URL
        const storageUrl = await FirebaseService.uploadFotoStorage(
          obraId4Upload, src, 'ocorrencias'
        ).catch(() => src); // fallback: mantém base64
        return { ...f, url: storageUrl };
      })
    );

    if (this._editId) {
      const idx = this._ocorrencias.findIndex(o=>o.id===this._editId);
      if (idx>=0) this._ocorrencias[idx] = {...this._ocorrencias[idx],numero:num||this._ocorrencias[idx].numero,data,tipo,gravidade,descricao,local,responsavel,providencia,resolvida,fotos:fotosComUrl,gps:this._ocGpsTemp||this._ocorrencias[idx].gps||null};
    } else {
      this._ocorrencias.push({id:'oc_'+Date.now(),numero:num||('OC-'+String(this._ocorrencias.length+1).padStart(3,'0')),data,tipo,gravidade,descricao,local,responsavel,providencia,resolvida,fotos:fotosComUrl,gps:this._ocGpsTemp||null,criadoEm:new Date().toISOString()});
    }
    this._ocFotosTemp = [];
    this._ocGpsTemp   = null;

    try {
      await this._salvar();
      window.toast?.('✅ Ocorrência salva!','ok');
      this._fecharForm(); this._render();
    } catch(e) { window.toast?.('❌ Erro ao salvar.','error'); }
  }

  async _excluir(id) {
    // FIX-E3.3: ConfirmComponent em vez de confirm() nativo
    const _okExcluirOc = await window._confirm('Excluir esta ocorrência?', { labelOk: 'Excluir', danger: true });
    if (!_okExcluirOc) return;
    this._ocorrencias = this._ocorrencias.filter(o=>o.id!==id);
    try { await this._salvar(); window.toast?.('🗑️ Excluída.','ok'); this._render(); }
    catch(e) { window.toast?.('❌ Erro.','error'); }
  }

  _fecharForm() {
    const modal=document.getElementById('oc-modal'); const overlay=document.getElementById('oc-overlay');
    if (modal) modal.style.display='none'; if (overlay) overlay.style.display='none';
    this._editId=null;
  }

  _bindEvents() {
    this._subs.push(EventBus.on('obra:selecionada', async ({ obraId }) => {
      try {
        // Cancelar watch anterior se existir
        if (this._unsubWatch) { this._unsubWatch(); this._unsubWatch = null; }
        await this._carregar();
        if (router.current === 'ocorrencias') this._render();
        // FIX-E3.4: ativar listener em tempo real para colaboração
        const id = obraId || state.get('obraAtivaId');
        if (id) {
          this._unsubWatch = FirebaseService.watchOcorrencias(id, lista => {
            // Mescla com visitasFiscais (mantidas separadas)
            const visitasFiscais = this._ocorrencias.filter(o => o._tipoVisitaFiscal);
            this._ocorrencias = [
              ...visitasFiscais,
              ...lista.filter(o => !o._tipoVisitaFiscal),
            ];
            state.set('ocorrencias', this._ocorrencias);
            if (router.current === 'ocorrencias') this._render();
          });
        }
      } catch(e) { console.error('[OcorrenciasModule]', e); }
    }, 'ocorrencias'));
  }

  _exposeGlobals() {
    window.renderOcorrencias = () => { try { this._render(); } catch(e){} };
    window.addOcorrencia     = () => { try { this._abrirForm(null); } catch(e){} };
    window.excluirOcorrencia = (id)=> { try { this._excluir(id); } catch(e){} };
    window._oc_abrirForm     = (id)=> { try { this._abrirForm(id); } catch(e){} };
    window._oc_fecharForm    = ()  => { try { this._fecharForm(); } catch(e){} };
    window._oc_salvarForm    = ()  => { try { this._salvarForm(); } catch(e){} };
    window._oc_excluir       = (id)=> { try { this._excluir(id); } catch(e){} };
    window._oc_filtro        = (v) => { try { this._filtro=v; this._render(); } catch(e){} };
    window._oc_filtroTipo    = (v) => { try { this._filtroTipo=v; this._render(); } catch(e){} };

    // ── Fotos na Ocorrência ───────────────────────────────────
    window._ocAdicionarFotos = (input) => {
      if (!input?.files?.length) return;
      const st = document.getElementById('oc-foto-status');
      if (st) st.textContent = 'Processando…';
      let n = 0;
      Array.from(input.files).forEach(file => {
        const r = new FileReader();
        r.onload = (ev) => {
          this._ocFotosTemp = this._ocFotosTemp || [];
          this._ocFotosTemp.push({ url: ev.target.result, nome: file.name });
          n++;
          if (st) st.textContent = `${n} foto(s)`;
          this._ocAtualizarPreview();
        };
        r.readAsDataURL(file);
      });
      input.value = '';
    };

    window._ocCapturaCamera = () => {
      const inp = document.createElement('input');
      inp.type = 'file'; inp.accept = 'image/*'; inp.capture = 'environment';
      inp.onchange = () => window._ocAdicionarFotos(inp);
      inp.click();
    };

    window._ocRemoverFoto = (idx) => {
      if (!this._ocFotosTemp) return;
      this._ocFotosTemp.splice(parseInt(idx, 10), 1);
      this._ocAtualizarPreview();
    };

    window._ocCapturarGPS = () => {
      if (!navigator.geolocation) { window.toast?.('⚠️ Geolocalização não disponível.', 'warn'); return; }
      const btn = document.querySelector('[data-action="_ocCapturarGPS"]');
      if (btn) { btn.textContent = '⏳'; btn.disabled = true; }
      navigator.geolocation.getCurrentPosition(
        (pos) => {
          const lat = pos.coords.latitude, lng = pos.coords.longitude;
          this._ocGpsTemp = { lat, lng, acc: Math.round(pos.coords.accuracy), capturedAt: new Date().toISOString() };
          const disp = document.getElementById('oc-gps-display');
          if (disp) disp.textContent = `${lat.toFixed(6)}, ${lng.toFixed(6)} (±${Math.round(pos.coords.accuracy)}m)`;
          if (btn) { btn.textContent = '✅'; btn.disabled = false; }
          window.toast?.('📍 GPS capturado', 'ok');
        },
        (err) => { if (btn) { btn.textContent = 'Capturar'; btn.disabled = false; } window.toast?.('⚠️ GPS: ' + err.message, 'warn'); },
        { enableHighAccuracy: true, timeout: 10000, maximumAge: 0 }
      );
    };
  }

  _ocAtualizarPreview() {
    const el = document.getElementById('oc-fotos-preview');
    if (!el) return;
    const fotos = this._ocFotosTemp || [];
    el.innerHTML = fotos.map((f, i) =>
      `<div style="position:relative"><img src="${f.url||f}" style="width:72px;height:56px;object-fit:cover;border-radius:6px;border:1px solid var(--border)"><button data-action="_ocRemoverFoto" data-arg0="${i}" style="position:absolute;top:2px;right:2px;background:rgba(0,0,0,.6);border:none;color:#fff;border-radius:50%;width:18px;height:18px;font-size:10px;cursor:pointer;line-height:18px;text-align:center">✕</button></div>`
    ).join('');
  }

  destroy() { this._subs.forEach(u=>u()); this._subs=[]; if (this._unsubWatch) { this._unsubWatch(); this._unsubWatch = null; } }
}
