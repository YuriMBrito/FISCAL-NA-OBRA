/**
 * ╔══════════════════════════════════════════════════════════════╗
 * ║  FISCAL NA OBRA v15.1 — modules/chuva/chuva-controller.js    ║
 * ║  Registro de clima por período: Manhã / Tarde / Noite       ║
 * ╚══════════════════════════════════════════════════════════════╝
 */

import EventBus        from '../../core/EventBus.js';
import state           from '../../core/state.js';
import router          from '../../core/router.js';
import FirebaseService from '../../firebase/firebase-service.js';
import { baixarCSV }   from '../../utils/csv-export.js';

const CLIMAS = [
  { key: 'sol',        icon: '☀️',  label: 'Sol',            cor: '#fef3c7', borda: '#f59e0b' },
  { key: 'parcial',    icon: '⛅',  label: 'Parc. Nublado',  cor: '#dbeafe', borda: '#93c5fd' },
  { key: 'chuva_leve', icon: '🌦️', label: 'Chuva Leve',     cor: '#e0f2fe', borda: '#38bdf8' },
  { key: 'chuva',      icon: '🌧️', label: 'Chuva',          cor: '#bfdbfe', borda: '#3b82f6' },
  { key: 'tempestade', icon: '⛈️', label: 'Tempestade',      cor: '#e9d5ff', borda: '#7c3aed' },
  { key: 'granizo',    icon: '🌩️', label: 'Granizo',         cor: '#fce7f3', borda: '#ec4899' },
  { key: 'sem_chuva',  icon: '—',   label: 'Sem Chuva',      cor: '#f1f5f9', borda: '#cbd5e1' },
];

const PERIODOS = [
  { key: 'manha', icon: '🌅', label: 'Manhã'  },
  { key: 'tarde', icon: '☀️', label: 'Tarde'  },
  { key: 'noite', icon: '🌙', label: 'Noite'  },
];

const PRIO_CLIMAS = ['sem_chuva','sol','parcial','chuva_leve','chuva','tempestade','granizo'];
const MESES_PT    = ['Janeiro','Fevereiro','Março','Abril','Maio','Junho',
                     'Julho','Agosto','Setembro','Outubro','Novembro','Dezembro'];
const DIAS_SEM    = ['D','S','T','Q','Q','S','S'];

export class ChuvaModule {
  constructor() {
    this._subs       = [];
    this._ano        = new Date().getFullYear();
    this._dados      = {};
    this._carregando = false;
    this._diaAberto  = null;
    this._selManha   = null;
    this._selTarde   = null;
    this._selNoite   = null;
  }

  async init()    { try { this._bindEvents(); this._exposeGlobals(); } catch (e) { console.error('[ChuvaModule] init:', e); } }
  async onEnter() { try { this._render(); await this._carregarDados(); } catch (e) { console.error('[ChuvaModule] onEnter:', e); } }

  // ── Normalização backward-compat ─────────────────────────────
  _normalizarReg(reg) {
    if (!reg) return { manha: null, tarde: null, noite: null, obs: '' };
    if (reg.clima !== undefined)
      return { manha: reg.clima, tarde: reg.clima, noite: reg.clima, obs: reg.obs || '', _legado: true };
    return { manha: reg.manha||null, tarde: reg.tarde||null, noite: reg.noite||null, obs: reg.obs||'', _legado: false };
  }

  _climaPrincipal(norm) {
    const climas = [norm.manha, norm.tarde, norm.noite].filter(Boolean);
    if (!climas.length) return null;
    let pior = null, piorIdx = -1;
    for (const k of climas) { const i = PRIO_CLIMAS.indexOf(k); if (i > piorIdx) { piorIdx = i; pior = k; } }
    return pior;
  }

  _temRegistro(norm) { return !!(norm.manha || norm.tarde || norm.noite); }
  _completo(norm)    { return !!(norm.manha && norm.tarde && norm.noite); }

  // ── Firebase ─────────────────────────────────────────────────
  async _carregarDados() {
    try {
      this._carregando = true; this._atualizarLoadingIndicator(true);
      this._dados = await FirebaseService.getChuva('global', this._ano) || {};
      this._renderCalendario(); this._renderResumo();
    } catch (e) { console.error('[ChuvaModule] _carregarDados:', e); }
    finally { this._carregando = false; this._atualizarLoadingIndicator(false); }
  }

  async _salvarDia(data, manha, tarde, noite, obs) {
    try {
      if (manha || tarde || noite)
        this._dados[data] = { manha: manha||null, tarde: tarde||null, noite: noite||null, obs: obs||'' };
      else
        delete this._dados[data];
      await FirebaseService.salvarChuva('global', this._ano, this._dados);
      this._renderCalendario(); this._renderResumo();
      this._fecharModal();
      window.toast?.('✅ Registro salvo!', 'ok');
    } catch (e) { console.error('[ChuvaModule] _salvarDia:', e); window.toast?.('❌ Erro ao salvar.', 'error'); }
  }

  // ── Render ───────────────────────────────────────────────────
  _render() {
    const c = document.getElementById('chuva-conteudo');
    if (!c) { this._renderLegado(); return; }
    c.innerHTML = this._htmlPrincipal();
    this._bindControles(); this._renderCalendario(); this._renderResumo();
  }

  _renderLegado() {
    const anoEl = document.getElementById('anoDisplay'); if (anoEl) anoEl.textContent = this._ano;
    const grade = document.getElementById('gradeCalendario'); if (grade) { grade.innerHTML = this._htmlCalendario(); this._bindDiasClick(grade); }
    const res   = document.getElementById('resumoAnual'); if (res) res.innerHTML = this._htmlResumo();
    this._renderModal();
  }

  _htmlPrincipal() { return `
    <div style="display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:12px;margin-bottom:14px">
      <div style="display:flex;align-items:center;gap:10px">
        <button id="chuva-btn-ant" class="btn btn-cinza btn-sm" style="font-size:16px;padding:5px 12px">‹</button>
        <div id="chuva-ano-display" style="font-size:20px;font-weight:800;color:var(--text-primary);min-width:60px;text-align:center">${this._ano}</div>
        <button id="chuva-btn-prox" class="btn btn-cinza btn-sm" style="font-size:16px;padding:5px 12px">›</button>
        <div id="chuva-loading" style="font-size:11px;color:var(--text-muted);display:none">⏳ Carregando...</div>
      </div>
      <div style="display:flex;flex-wrap:wrap;gap:5px;align-items:center">
        ${CLIMAS.filter(c=>c.key!=='sem_chuva').map(c=>`<span style="display:inline-flex;align-items:center;gap:4px;font-size:10px;padding:2px 7px;border-radius:99px;background:${c.cor};border:1px solid ${c.borda}">${c.icon} ${c.label}</span>`).join('')}
      </div>
      <div style="display:flex;gap:6px">
        <button class="btn btn-cinza btn-sm" data-action="imprimirChuva">🖨️ PDF</button>
        <button class="btn btn-cinza btn-sm" data-action="exportarCSVChuva">📊 CSV</button>
      </div>
    </div>

    <div style="display:flex;gap:14px;align-items:center;margin-bottom:14px;flex-wrap:wrap;padding:8px 12px;background:var(--bg-surface);border:1px solid var(--border);border-radius:8px">
      <span style="font-size:10px;font-weight:700;color:var(--text-muted);text-transform:uppercase;letter-spacing:.5px">Períodos:</span>
      ${PERIODOS.map(p=>`<span style="font-size:11px;color:var(--text-muted)">${p.icon} ${p.label}</span>`).join('')}
      <span style="font-size:10px;color:var(--text-muted);margin-left:4px">● preenchido &nbsp; ○ vazio &nbsp; borda sólida = todos os 3 períodos registrados</span>
    </div>

    <div id="chuva-grade" style="display:grid;grid-template-columns:repeat(auto-fill,minmax(260px,1fr));gap:14px;margin-bottom:20px"></div>

    <div class="card" style="margin:0">
      <div class="titulo-secao" style="margin-bottom:14px">📊 Resumo Anual ${this._ano}</div>
      <div id="chuva-resumo"></div>
    </div>

    <div id="chuva-modal-overlay" data-action="_chuva_fecharModal" style="display:none;position:fixed;inset:0;background:rgba(0,0,0,.5);z-index:900"></div>
    <div id="chuva-modal" style="display:none;position:fixed;top:50%;left:50%;transform:translate(-50%,-50%);z-index:901;background:var(--bg-card);border:1px solid var(--border);border-radius:14px;padding:24px;min-width:340px;max-width:490px;width:min(490px,94vw);max-height:92vh;overflow-y:auto;box-shadow:var(--shadow-lg)"></div>
  `; }

  _bindControles() {
    document.getElementById('chuva-btn-ant')?.addEventListener('click',  () => this._mudarAno(-1));
    document.getElementById('chuva-btn-prox')?.addEventListener('click', () => this._mudarAno(+1));
  }

  _mudarAno(delta) {
    this._ano += delta;
    const el = document.getElementById('chuva-ano-display') || document.getElementById('anoDisplay');
    if (el) el.textContent = this._ano;
    this._dados = {}; this._carregarDados();
  }

  _atualizarLoadingIndicator(show) {
    const el = document.getElementById('chuva-loading'); if (el) el.style.display = show ? 'block' : 'none';
  }

  // ── Calendário ───────────────────────────────────────────────
  _renderCalendario() {
    const g = document.getElementById('chuva-grade') || document.getElementById('gradeCalendario');
    if (!g) return; g.innerHTML = this._htmlCalendario(); this._bindDiasClick(g);
  }

  _htmlCalendario() { let h=''; for (let m=0;m<12;m++) h+=this._htmlMes(m); return h; }

  _htmlMes(mes) {
    const diasNoMes   = new Date(this._ano, mes+1, 0).getDate();
    const primeiroDia = new Date(this._ano, mes, 1).getDay();
    const hoje        = new Date();
    let diasHtml      = DIAS_SEM.map(d=>`<div style="font-size:9px;font-weight:700;color:var(--text-muted);text-align:center;padding:2px 0">${d}</div>`).join('');
    for (let i=0;i<primeiroDia;i++) diasHtml+=`<div></div>`;

    for (let dia=1;dia<=diasNoMes;dia++) {
      const dataKey  = `${this._ano}-${String(mes+1).padStart(2,'0')}-${String(dia).padStart(2,'0')}`;
      const norm     = this._normalizarReg(this._dados[dataKey]);
      const climaK   = this._climaPrincipal(norm);
      const clima    = climaK ? CLIMAS.find(c=>c.key===climaK) : null;
      const ehHoje   = hoje.getFullYear()===this._ano && hoje.getMonth()===mes && hoje.getDate()===dia;
      const completo = this._completo(norm);
      const parcial  = this._temRegistro(norm) && !completo;

      const dot = (p) => {
        const v = norm[p]; const c = v ? CLIMAS.find(cl=>cl.key===v) : null;
        return `<span title="${c?c.label:'Não registrado'}" style="width:4px;height:4px;border-radius:50%;display:inline-block;background:${c?c.borda:'var(--border)'}"></span>`;
      };

      diasHtml += `<div data-dia="${dataKey}"
        title="${dia} — ${clima?clima.label:'Clique para registrar'}${completo?' ✓ Completo':parcial?' (parcial)':''}"
        style="aspect-ratio:1;display:flex;flex-direction:column;align-items:center;justify-content:center;
          border-radius:6px;cursor:pointer;transition:all .12s;gap:1px;padding:1px;
          background:${clima?clima.cor:'var(--bg-surface)'};
          border:${completo?'2px':'1.5px'} solid ${ehHoje?'var(--accent)':completo?(clima?.borda||'#94a3b8'):parcial?'#94a3b8':'transparent'};
          color:${ehHoje?'var(--accent)':'var(--text-primary)'};"
        onmouseover="this.style.opacity='.72'" onmouseout="this.style.opacity='1'">
        <span style="font-size:9px;line-height:1">${clima?clima.icon:''}</span>
        <span style="line-height:1.1;font-weight:${ehHoje?'800':'600'};font-size:10px">${dia}</span>
        <div style="display:flex;gap:2px;align-items:center;margin-top:1px">${dot('manha')}${dot('tarde')}${dot('noite')}</div>
      </div>`;
    }

    return `<div style="background:var(--bg-card);border:1px solid var(--border);border-radius:10px;padding:12px">
      <div style="font-size:11px;font-weight:800;color:var(--text-primary);text-align:center;margin-bottom:8px;text-transform:uppercase;letter-spacing:.5px">${MESES_PT[mes]}</div>
      <div style="display:grid;grid-template-columns:repeat(7,1fr);gap:2px">${diasHtml}</div>
    </div>`;
  }

  _bindDiasClick(c) {
    c.addEventListener('click', (e) => { const cell = e.target.closest('[data-dia]'); if (cell?.dataset.dia) this._abrirModal(cell.dataset.dia); });
  }

  // ── Modal 3 períodos ─────────────────────────────────────────
  _abrirModal(dataKey) {
    this._diaAberto = dataKey;
    const norm = this._normalizarReg(this._dados[dataKey] || {});
    this._selManha = norm.manha; this._selTarde = norm.tarde; this._selNoite = norm.noite;

    const [ano, mes, dia] = dataKey.split('-');
    const titulo  = `${parseInt(dia)} de ${MESES_PT[parseInt(mes)-1]} de ${ano}`;
    const modal   = document.getElementById('chuva-modal');
    const overlay = document.getElementById('chuva-modal-overlay');
    if (!modal) { this._renderModal(); setTimeout(()=>this._abrirModal(dataKey),60); return; }

    const htmlPeriodo = (periodo) => {
      const p = PERIODOS.find(x=>x.key===periodo);
      const sel = norm[periodo];
      return `<div style="margin-bottom:13px">
        <div style="font-size:10px;font-weight:700;color:var(--text-muted);text-transform:uppercase;letter-spacing:.5px;margin-bottom:6px">${p.icon} ${p.label}</div>
        <div style="display:flex;flex-wrap:wrap;gap:4px" id="chuva-grid-${periodo}">
          ${CLIMAS.map(c=>{const a=sel===c.key; return `<button type="button" title="${c.label}"
            onclick="window._chuva_selecionarPeriodo('${periodo}','${c.key}')"
            style="padding:5px 8px;border-radius:7px;cursor:pointer;font-size:14px;
              background:${a?c.cor:'var(--bg-surface)'};border:1.5px solid ${a?c.borda:'var(--border)'};transition:all .1s">${c.icon}</button>`;}).join('')}
        </div>
        <div id="chuva-label-${periodo}" style="font-size:10px;color:var(--text-muted);margin-top:3px;min-height:14px">
          ${sel?(CLIMAS.find(c=>c.key===sel)?.label||''):'<em>Não registrado</em>'}
        </div>
      </div>`;
    };

    modal.innerHTML = `
      <div style="display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:16px">
        <div>
          <div style="font-size:10px;font-weight:700;color:var(--text-muted);text-transform:uppercase;letter-spacing:.5px">Registrar Clima</div>
          <div style="font-size:15px;font-weight:800;color:var(--text-primary)">${titulo}</div>
          ${norm._legado?`<div style="font-size:10px;color:#f59e0b;margin-top:2px">⚠️ Registro legado — exibido como todos os períodos completos</div>`:''}
        </div>
        <button data-action="_chuva_fecharModal" style="font-size:20px;background:none;border:none;cursor:pointer;color:var(--text-muted);line-height:1;padding:2px">×</button>
      </div>
      ${htmlPeriodo('manha')}
      ${htmlPeriodo('tarde')}
      ${htmlPeriodo('noite')}
      <div style="font-size:11px;font-weight:700;color:var(--text-muted);text-transform:uppercase;letter-spacing:.5px;margin-bottom:6px">Observações (opcional)</div>
      <textarea id="chuva-modal-obs" rows="2"
        style="width:100%;box-sizing:border-box;background:var(--bg-surface);border:1px solid var(--border);border-radius:8px;color:var(--text-primary);font-size:12px;padding:9px 12px;outline:none;resize:vertical"
        placeholder="Ex: Chuva intensa às 14h, interrupção dos serviços...">${norm.obs||''}</textarea>
      <div style="display:flex;gap:8px;margin-top:14px">
        <button id="chuva-modal-salvar"
          style="flex:1;padding:10px;background:var(--accent);border:none;border-radius:8px;color:#fff;font-size:13px;font-weight:700;cursor:pointer">💾 Salvar</button>
        <button data-action="_chuva_limparDia"
          style="padding:10px 14px;background:transparent;border:1px solid #fca5a5;border-radius:8px;color:#ef4444;font-size:12px;cursor:pointer" title="Remover registros deste dia">🗑️ Limpar</button>
      </div>`;

    modal.style.display = 'block'; if (overlay) overlay.style.display = 'block';

    document.getElementById('chuva-modal-salvar')?.addEventListener('click', () => {
      const obs = document.getElementById('chuva-modal-obs')?.value?.trim() || '';
      if (!this._selManha && !this._selTarde && !this._selNoite) {
        window.toast?.('⚠️ Selecione o clima de pelo menos um período.', 'warn'); return;
      }
      this._salvarDia(this._diaAberto, this._selManha, this._selTarde, this._selNoite, obs);
    });

    window._chuva_selecionarPeriodo = (periodo, climaKey) => {
      if (periodo==='manha') this._selManha=climaKey;
      if (periodo==='tarde') this._selTarde=climaKey;
      if (periodo==='noite') this._selNoite=climaKey;
      const grid  = document.getElementById(`chuva-grid-${periodo}`);
      const label = document.getElementById(`chuva-label-${periodo}`);
      if (grid) grid.querySelectorAll('button').forEach((btn,idx)=>{
        const c=CLIMAS[idx], a=c.key===climaKey;
        btn.style.background=a?c.cor:'var(--bg-surface)'; btn.style.borderColor=a?c.borda:'var(--border)';
      });
      if (label) { const c=CLIMAS.find(x=>x.key===climaKey); label.innerHTML=c?c.label:'<em>Não registrado</em>'; }
    };
  }

  _fecharModal() {
    const m=document.getElementById('chuva-modal'), o=document.getElementById('chuva-modal-overlay');
    if (m) m.style.display='none'; if (o) o.style.display='none';
    this._diaAberto=null; this._selManha=this._selTarde=this._selNoite=null;
  }

  _limparDia() {
    if (!this._diaAberto) return;
    if (confirm('Remover todos os registros de clima deste dia?'))
      this._salvarDia(this._diaAberto, null, null, null, '');
  }

  _renderModal() {
    if (document.getElementById('chuva-modal')) return;
    const d = document.createElement('div');
    d.innerHTML=`
      <div id="chuva-modal-overlay" data-action="_chuva_fecharModal" style="display:none;position:fixed;inset:0;background:rgba(0,0,0,.5);z-index:900"></div>
      <div id="chuva-modal" style="display:none;position:fixed;top:50%;left:50%;transform:translate(-50%,-50%);z-index:901;background:var(--bg-card);border:1px solid var(--border);border-radius:14px;padding:24px;min-width:340px;max-width:490px;width:min(490px,94vw);max-height:92vh;overflow-y:auto;box-shadow:var(--shadow-lg)"></div>`;
    document.body.appendChild(d);
  }

  // ── Resumo ───────────────────────────────────────────────────
  _renderResumo() {
    const el=document.getElementById('chuva-resumo')||document.getElementById('resumoAnual');
    if (el) el.innerHTML=this._htmlResumo();
  }

  _htmlResumo() {
    const CLIMAS_CHUVA=['chuva_leve','chuva','tempestade','granizo'];
    const cnt={}; CLIMAS.forEach(c=>{cnt[c.key]=0;});
    let totalDias=0, diasChuva=0;
    Object.values(this._dados).forEach(r=>{
      const n=this._normalizarReg(r); if (!this._temRegistro(n)) return; totalDias++;
      const climas=[n.manha,n.tarde,n.noite].filter(Boolean);
      [...new Set(climas)].forEach(k=>{if(cnt[k]!==undefined)cnt[k]++;});
      if (climas.some(k=>CLIMAS_CHUVA.includes(k))) diasChuva++;
    });

    let html=`<div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(120px,1fr));gap:10px;margin-bottom:14px">
      <div style="background:var(--bg-surface);border:1px solid var(--border);border-radius:8px;padding:12px;text-align:center">
        <div style="font-size:20px;font-weight:800;color:var(--text-primary)">${totalDias}</div>
        <div style="font-size:9px;color:var(--text-muted);text-transform:uppercase;letter-spacing:.5px;margin-top:2px">Dias Registrados</div>
      </div>
      <div style="background:#fef3c7;border:1px solid #f59e0b;border-radius:8px;padding:12px;text-align:center">
        <div style="font-size:20px;font-weight:800;color:#92400e">${diasChuva}</div>
        <div style="font-size:9px;color:#78350f;text-transform:uppercase;letter-spacing:.5px;margin-top:2px">Dias c/ Chuva</div>
      </div>
      ${CLIMAS.filter(c=>c.key!=='sem_chuva').map(c=>`
        <div style="background:${c.cor};border:1px solid ${c.borda};border-radius:8px;padding:10px;text-align:center">
          <div style="font-size:18px;margin-bottom:2px">${c.icon}</div>
          <div style="font-size:18px;font-weight:800;color:var(--text-primary)">${cnt[c.key]||0}</div>
          <div style="font-size:8px;color:var(--text-muted);text-transform:uppercase;letter-spacing:.3px;margin-top:1px">${c.label}</div>
        </div>`).join('')}
    </div>`;

    const comObs=Object.entries(this._dados).filter(([,r])=>this._normalizarReg(r).obs?.trim()).sort(([a],[b])=>a.localeCompare(b));
    if (comObs.length) {
      html+=`<div style="font-size:11px;font-weight:700;color:var(--text-muted);text-transform:uppercase;letter-spacing:.5px;margin-bottom:8px">📝 Observações</div>
        <div style="display:flex;flex-direction:column;gap:6px">
        ${comObs.map(([data,r])=>{
          const n=this._normalizarReg(r);const[ano,mes,dia]=data.split('-');
          const cK=this._climaPrincipal(n); const c=cK?CLIMAS.find(cl=>cl.key===cK):null;
          return `<div style="display:flex;align-items:flex-start;gap:10px;padding:8px 12px;background:${c?.cor||'var(--bg-surface)'};border:1px solid ${c?.borda||'var(--border)'};border-radius:8px">
            <span style="font-size:16px;flex-shrink:0">${c?.icon||'—'}</span>
            <div><div style="font-size:10px;font-weight:700;color:var(--text-muted)">${parseInt(dia)}/${parseInt(mes)}/${ano}</div>
            <div style="font-size:12px;color:var(--text-primary)">${n.obs}</div></div>
          </div>`;
        }).join('')}</div>`;
    }

    html+=`<div style="margin-top:20px">
      <div style="font-size:11px;font-weight:700;color:var(--text-muted);text-transform:uppercase;letter-spacing:.5px;margin-bottom:10px">📅 Resumo Mensal — ${this._ano}</div>
      ${this._htmlResumoMensal()}
    </div>`;
    return html;
  }

  _htmlResumoMensal() {
    const CLIMAS_CHUVA=['chuva_leve','chuva','tempestade','granizo'];
    const rows=[];
    for (let mes=0;mes<12;mes++) {
      const mesKey=String(mes+1).padStart(2,'0'), diasNoMes=new Date(this._ano,mes+1,0).getDate();
      let diasChuva=0,diasImprod=0;
      for (let dia=1;dia<=diasNoMes;dia++) {
        const n=this._normalizarReg(this._dados[`${this._ano}-${mesKey}-${String(dia).padStart(2,'0')}`]);
        const climas=[n.manha,n.tarde,n.noite].filter(Boolean);
        if (climas.some(k=>CLIMAS_CHUVA.includes(k))) {
          diasChuva++;
          diasImprod += climas.some(k=>k==='tempestade'||k==='granizo') ? 2 : 1;
        }
      }
      rows.push({mes:MESES_PT[mes],diasChuva,diasImprod});
    }
    const tc=rows.reduce((s,r)=>s+r.diasChuva,0), ti=rows.reduce((s,r)=>s+r.diasImprod,0);
    if (!rows.some(r=>r.diasChuva>0)) return `<div style="text-align:center;padding:18px;color:var(--text-muted);font-size:12px">Nenhum dia registrado em ${this._ano}.</div>`;
    return `<div style="overflow-x:auto"><table style="width:100%;border-collapse:collapse">
      <thead><tr style="background:var(--bg-surface)">
        <th style="padding:8px 12px;font-size:10px;font-weight:700;color:var(--text-muted);text-transform:uppercase;letter-spacing:.5px;text-align:left">Mês</th>
        <th style="padding:8px 12px;font-size:10px;font-weight:700;color:#2563eb;text-transform:uppercase;letter-spacing:.5px;text-align:center">🌧️ Dias c/ Chuva</th>
        <th style="padding:8px 12px;font-size:10px;font-weight:700;color:#dc2626;text-transform:uppercase;letter-spacing:.5px;text-align:center">🚫 Dias Improdutivos</th>
      </tr></thead>
      <tbody>${rows.map(r=>{
        const cW=Math.round((r.diasChuva/Math.max(tc,1))*100), iW=Math.round((r.diasImprod/Math.max(ti,1))*100);
        return `<tr style="border-bottom:1px solid var(--border)${r.diasChuva===0?';opacity:.45':''}">
          <td style="padding:7px 12px;font-size:12px;font-weight:600;color:var(--text-primary);white-space:nowrap">${r.mes}</td>
          <td style="padding:7px 12px;text-align:center">
            <span style="font-size:13px;font-weight:800;color:#2563eb;font-family:var(--font-mono)">${r.diasChuva}</span>
            <span style="font-size:9px;color:var(--text-muted)"> dia${r.diasChuva!==1?'s':''}</span>
            ${r.diasChuva>0?`<div style="margin-top:3px;height:4px;border-radius:2px;background:#bfdbfe"><div style="height:4px;border-radius:2px;background:#2563eb;width:${cW}%"></div></div>`:''}
          </td>
          <td style="padding:7px 12px;text-align:center">
            <span style="font-size:13px;font-weight:800;color:#dc2626;font-family:var(--font-mono)">${r.diasImprod}</span>
            <span style="font-size:9px;color:var(--text-muted)"> dia${r.diasImprod!==1?'s':''}</span>
            ${r.diasImprod>0?`<div style="margin-top:3px;height:4px;border-radius:2px;background:#fecaca"><div style="height:4px;border-radius:2px;background:#dc2626;width:${iW}%"></div></div>`:''}
          </td>
        </tr>`;
      }).join('')}</tbody>
      <tfoot><tr style="background:var(--bg-surface);font-weight:800">
        <td style="padding:8px 12px;font-size:11px;color:var(--text-primary)">TOTAL ${this._ano}</td>
        <td style="padding:8px 12px;text-align:center;font-size:13px;font-family:var(--font-mono);color:#2563eb">${tc}</td>
        <td style="padding:8px 12px;text-align:center;font-size:13px;font-family:var(--font-mono);color:#dc2626">${ti}</td>
      </tr></tfoot>
    </table></div>`;
  }

  // ── PDF ──────────────────────────────────────────────────────
  _imprimirChuva() {
    const cfg=state.get('cfg')||{}, agora=new Date().toLocaleString('pt-BR');
    const cnt={}; CLIMAS.forEach(c=>{cnt[c.key]=0;});
    Object.values(this._dados).forEach(r=>{
      const n=this._normalizarReg(r);
      [...new Set([n.manha,n.tarde,n.noite].filter(Boolean))].forEach(k=>{if(cnt[k]!==undefined)cnt[k]++;});
    });
    let htmlMeses='';
    for (let mes=0;mes<12;mes++) {
      const dn=new Date(this._ano,mes+1,0).getDate(), pd=new Date(this._ano,mes,1).getDay();
      let cel=DIAS_SEM.map(d=>`<td style="text-align:center;font-size:6pt;font-weight:700;color:#888;border:none;padding:1px">${d}</td>`).join('');
      cel=`<tr>${cel}</tr><tr>`;
      for (let i=0;i<pd;i++) cel+=`<td style="border:none"></td>`;
      for (let dia=1;dia<=dn;dia++) {
        const k=`${this._ano}-${String(mes+1).padStart(2,'0')}-${String(dia).padStart(2,'0')}`;
        const n=this._dados[k]?this._normalizarReg(this._dados[k]):null;
        const cK=n?this._climaPrincipal(n):null, c=cK?CLIMAS.find(cl=>cl.key===cK):null;
        const comp=n?this._completo(n):false;
        if ((pd+dia-1)%7===0&&dia>1) cel+=`</tr><tr>`;
        cel+=`<td style="text-align:center;font-size:6.5pt;padding:2px 1px;background:${c?c.cor:'transparent'};border-radius:3px;border:${comp?`1px solid ${c?.borda||'#ccc'}`:'1px solid transparent'}">${c?c.icon:''}<br>${dia}</td>`;
      }
      cel+=`</tr>`;
      htmlMeses+=`<div style="break-inside:avoid;margin-bottom:10px"><div style="font-size:8pt;font-weight:800;text-align:center;text-transform:uppercase;margin-bottom:4px">${MESES_PT[mes]}</div><table style="width:100%;border-collapse:collapse;font-size:6pt">${cel}</table></div>`;
    }
    const w=window.open('','_blank','width=900,height=700');
    w.document.write(`<!DOCTYPE html><html><head><meta charset="UTF-8"><title>Quadro de Chuvas ${this._ano}</title>
      <style>body{font-family:Arial,sans-serif;font-size:9pt;color:#000;padding:10mm}h1{font-size:12pt;border-bottom:2px solid #000;padding-bottom:6px;margin-bottom:10px}.grid{display:grid;grid-template-columns:repeat(4,1fr);gap:10px}.leg{display:flex;align-items:center;gap:4px;font-size:7pt}td{border:1px solid #ddd;padding:2px 3px;font-size:6.5pt;vertical-align:middle}@media print{body{padding:5mm}@page{size:A4 landscape;margin:8mm}}</style>
      </head><body>
      <h1>☁️ Quadro de Chuvas — ${this._ano}</h1>
      <div style="font-size:8pt;color:#555;margin-bottom:6px">Obra: <strong>${cfg.objeto||'—'}</strong> · Contrato: ${cfg.contrato||'—'} · Gerado: ${agora}</div>
      <p style="font-size:7.5pt;color:#666;margin-bottom:8px">Registro por período: 🌅 Manhã · ☀️ Tarde · 🌙 Noite &nbsp;|&nbsp; Células com borda = todos os 3 períodos registrados</p>
      <div style="display:flex;flex-wrap:wrap;gap:8px;margin:10px 0">
        ${CLIMAS.filter(c=>c.key!=='sem_chuva').map(c=>`<span class="leg" style="background:${c.cor};border:1px solid ${c.borda};padding:2px 6px;border-radius:4px">${c.icon} ${c.label}: <strong>${cnt[c.key]||0} dias</strong></span>`).join('')}
      </div>
      <div class="grid">${htmlMeses}</div>
      <button onclick="window.print()" style="margin-top:16px;padding:8px 20px;background:#111;color:#fff;border:none;border-radius:6px;cursor:pointer;font-size:11pt">🖨️ Imprimir</button>
    </body></html>`);
    w.document.close();
  }

  // ── CSV ──────────────────────────────────────────────────────
  _exportarCSV() {
    const MESES_NOME=['Janeiro','Fevereiro','Março','Abril','Maio','Junho','Julho','Agosto','Setembro','Outubro','Novembro','Dezembro'];
    const CLIMAS_CHUVA=['chuva_leve','chuva','tempestade','granizo'];
    const diasSem=['Dom','Seg','Ter','Qua','Qui','Sex','Sáb'];
    const cabec=['Mês','Dia','Dia da Semana','Manhã','Tarde','Noite','Observação','Improdutivo'];
    const linhas=[];
    for (let mes=0;mes<12;mes++) {
      const dn=new Date(this._ano,mes+1,0).getDate();
      for (let dia=1;dia<=dn;dia++) {
        const dataKey=`${this._ano}-${String(mes+1).padStart(2,'0')}-${String(dia).padStart(2,'0')}`;
        const raw=this._dados[dataKey]; if (!raw) continue;
        const n=this._normalizarReg(raw); if (!this._temRegistro(n)) continue;
        const lbl=k=>k?(CLIMAS.find(c=>c.key===k)?.label||k):'—';
        const climas=[n.manha,n.tarde,n.noite].filter(Boolean);
        linhas.push([MESES_NOME[mes],dia,diasSem[new Date(this._ano,mes,dia).getDay()],lbl(n.manha),lbl(n.tarde),lbl(n.noite),n.obs||'',climas.some(k=>CLIMAS_CHUVA.includes(k))?'Sim':'Não']);
      }
    }
    if (!linhas.length) { window.toast?.('⚠️ Nenhum dado registrado.','warn'); return; }
    baixarCSV([cabec,...linhas],`quadro_chuvas_${this._ano}`);
    window.auditRegistrar?.({modulo:'Quadro de Chuvas',tipo:'exportação',registro:`Ano ${this._ano}`,detalhe:'Exportação CSV'});
    window.toast?.('✅ CSV exportado!','ok');
  }

  // ── Eventos e globals ────────────────────────────────────────
  _bindEvents() {
    this._subs.push(EventBus.on('obra:selecionada',()=>{
      try { this._dados={}; if (router.current==='chuva'){this._render();this._carregarDados();} }
      catch(e){console.error('[ChuvaModule] obra:selecionada:',e);}
    },'chuva'));
  }

  _exposeGlobals() {
    window.renderChuva        = (...a) => { try { this._render(...a); } catch(e){} };
    window.mudarAno           = d     => { try { this._mudarAno(d); } catch(e){} };
    window.imprimirChuva      = ()    => { try { this._imprimirChuva(); } catch(e){} };
    window.exportarCSVChuva   = ()    => { try { this._exportarCSV(); } catch(e){ console.error('[Chuva] CSV:',e); } };
    window._chuva_fecharModal = ()    => { try { this._fecharModal(); } catch(e){} };
    window._chuva_limparDia   = ()    => { try { this._limparDia(); } catch(e){} };
  }

  destroy() {
    this._subs.forEach(u=>u()); this._subs=[];
    delete window._chuva_fecharModal; delete window._chuva_limparDia; delete window._chuva_selecionarPeriodo;
  }
}
