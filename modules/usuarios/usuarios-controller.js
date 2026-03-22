/**
 * ╔══════════════════════════════════════════════════════════════╗
 * ║  FISCAL NA OBRA v15 — usuarios-controller.js                ║
 * ║  Módulo: UsuariosModule — Gerenciamento de Usuários         ║
 * ╚══════════════════════════════════════════════════════════════╝
 */

import EventBus        from '../../core/EventBus.js';
import state           from '../../core/state.js';
import router          from '../../core/router.js';
import { formatters }  from '../../utils/formatters.js';
import FirebaseService from '../../firebase/firebase-service.js';

const hoje = () => new Date().toISOString().slice(0,10);

const PERFIS = [
  { k:'fiscal',        l:'Fiscal de Obras'      },
  { k:'engenheiro',    l:'Engenheiro / Gestor'   },
  { k:'tecnico',       l:'Técnico'               },
  { k:'administrador', l:'Administrador'         },
  { k:'visualizador',  l:'Somente Leitura'       },
];

export class UsuariosModule {
  constructor() {
    this._subs     = [];
    this._usuarios = [];
    this._editId   = null;
  }

  async init() {
    try { this._bindEvents(); this._exposeGlobals(); }
    catch(e) { console.error('[UsuariosModule] init:', e); }
  }

  async onEnter() {
    try { await this._carregar(); this._render(); }
    catch(e) { console.error('[UsuariosModule] onEnter:', e); }
  }

  async _carregar() {
    const obraId = state.get('obraAtivaId');
    if (!obraId) { this._usuarios=[]; return; }
    try {
      const todos = await FirebaseService.getUsuarios(obraId).catch(()=>[]);
      // Só usuários normais (não fiscais de obras do módulo fiscal-obras)
      this._usuarios = (todos||[]).filter(u=>!u._tipoFiscal);
    } catch(e) { console.error('[UsuariosModule] _carregar:', e); this._usuarios=[]; }
  }

  async _persistir() {
    const obraId = state.get('obraAtivaId');
    if (!obraId) return;
    const todos = await FirebaseService.getUsuarios(obraId).catch(()=>[]);
    const fiscais = (todos||[]).filter(u=>u._tipoFiscal);
    await FirebaseService.salvarUsuarios(obraId, [...fiscais, ...this._usuarios]);
  }

  _render() {
    const el = document.getElementById('usuarios-conteudo');
    if (!el) return;
    const obraId = state.get('obraAtivaId');

    if (!obraId) {
      el.innerHTML = '<div style="text-align:center;padding:40px;color:var(--text-muted);font-size:13px">Selecione uma obra para gerenciar usuários.</div>';
      return;
    }

    el.innerHTML = `
      <!-- Form novo usuário -->
      <div style="background:var(--bg-surface);border:1px solid var(--border);border-radius:10px;padding:16px;margin-bottom:18px">
        <div style="font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:.5px;color:var(--text-muted);margin-bottom:12px">👤 Adicionar Usuário / Participante</div>
        <div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:10px">
          <div>
            <label style="font-size:11px;font-weight:700;color:var(--text-muted);display:block;margin-bottom:4px">Nome *</label>
            <input id="usr-nome" placeholder="Nome completo"
              style="width:100%;padding:8px;border-radius:7px;border:1px solid var(--border);background:var(--bg-card);color:var(--text-primary);font-size:12px;box-sizing:border-box">
          </div>
          <div>
            <label style="font-size:11px;font-weight:700;color:var(--text-muted);display:block;margin-bottom:4px">E-mail</label>
            <input id="usr-email" type="email" placeholder="email@exemplo.com"
              style="width:100%;padding:8px;border-radius:7px;border:1px solid var(--border);background:var(--bg-card);color:var(--text-primary);font-size:12px;box-sizing:border-box">
          </div>
          <div>
            <label style="font-size:11px;font-weight:700;color:var(--text-muted);display:block;margin-bottom:4px">Perfil</label>
            <select id="usr-perfil"
              style="width:100%;padding:8px;border-radius:7px;border:1px solid var(--border);background:var(--bg-card);color:var(--text-primary);font-size:12px;box-sizing:border-box">
              ${PERFIS.map(p=>'<option value="'+p.k+'">'+p.l+'</option>').join('')}
            </select>
          </div>
          <div>
            <label style="font-size:11px;font-weight:700;color:var(--text-muted);display:block;margin-bottom:4px">CREA / CAU</label>
            <input id="usr-crea" placeholder="Ex: CREA-PE 123456"
              style="width:100%;padding:8px;border-radius:7px;border:1px solid var(--border);background:var(--bg-card);color:var(--text-primary);font-size:12px;box-sizing:border-box">
          </div>
          <div>
            <label style="font-size:11px;font-weight:700;color:var(--text-muted);display:block;margin-bottom:4px">Telefone</label>
            <input id="usr-tel" placeholder="(00) 00000-0000"
              style="width:100%;padding:8px;border-radius:7px;border:1px solid var(--border);background:var(--bg-card);color:var(--text-primary);font-size:12px;box-sizing:border-box">
          </div>
          <div style="display:flex;align-items:flex-end">
            <button data-action="_usr_adicionar"
              style="width:100%;padding:9px;background:var(--accent);border:none;border-radius:8px;color:#fff;font-size:12px;font-weight:700;cursor:pointer">
              ➕ Adicionar</button>
          </div>
        </div>
      </div>

      <!-- Lista de usuários -->
      <div style="font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:.5px;color:var(--text-muted);margin-bottom:10px">
        👥 Usuários Cadastrados (${this._usuarios.length})
      </div>
      ${this._usuarios.length===0
        ? '<div style="text-align:center;padding:30px;color:var(--text-muted);font-size:12px">Nenhum usuário cadastrado para esta obra.</div>'
        : this._usuarios.map(u=>this._cardUser(u)).join('')}

      <!-- Modal edição -->
      <div id="usr-overlay" data-action="_usr_fecharModal"
        style="display:none;position:fixed;inset:0;background:rgba(0,0,0,.55);z-index:1000"></div>
      <div id="usr-modal"
        style="display:none;position:fixed;top:50%;left:50%;transform:translate(-50%,-50%);
        z-index:1001;background:var(--bg-card);border:1px solid var(--border);border-radius:14px;
        padding:24px;width:min(96vw,500px);max-height:90vh;overflow-y:auto;
        box-shadow:0 20px 60px rgba(0,0,0,.4)"></div>
    `;
  }

  _cardUser(u) {
    const perfil = PERFIS.find(p=>p.k===u.perfil)||{l:u.perfil||'—'};
    const iniciais = (u.nome||'?').split(' ').map(w=>w[0]).slice(0,2).join('').toUpperCase();
    const cor = ['#2563eb','#16a34a','#f59e0b','#7c3aed','#ef4444'][u.nome?.charCodeAt(0)%5||0];
    return '<div style="background:var(--bg-surface);border:1px solid var(--border);border-radius:10px;padding:14px;margin-bottom:10px">'+
      '<div style="display:flex;align-items:center;gap:12px">'+
      '<div style="width:40px;height:40px;border-radius:50%;background:'+cor+'22;border:2px solid '+cor+';display:flex;align-items:center;justify-content:center;font-size:14px;font-weight:800;color:'+cor+';flex-shrink:0">'+iniciais+'</div>'+
      '<div style="flex:1;min-width:0">'+
      '<div style="font-size:13px;font-weight:700;color:var(--text-primary)">'+sanitize(u.nome||'—')+'</div>'+
      '<div style="font-size:11px;color:var(--text-muted)">'+perfil.l+(u.email?' · '+sanitize(u.email):'')+(u.crea?' · '+sanitize(u.crea):'')+
      (u.tel?' · 📞 '+sanitize(u.tel):'')+'</div>'+
      '</div>'+
      '<div style="display:flex;gap:6px;flex-shrink:0">'+
      '<button data-action="_usr_editar" data-arg0="+u.id+" style="padding:5px 10px;font-size:11px;background:var(--bg-card);border:1px solid var(--border);border-radius:6px;cursor:pointer;color:var(--text-primary)">✏️</button>'+
      '<button data-action="_usr_excluir" data-arg0="+u.id+" style="padding:5px 10px;font-size:11px;background:#fee2e2;border:1px solid #fca5a5;border-radius:6px;cursor:pointer;color:#dc2626">🗑️</button>'+
      '</div></div></div>';
  }

  async _adicionar() {
    const nome  = document.getElementById('usr-nome')?.value?.trim()||'';
    const email = document.getElementById('usr-email')?.value?.trim()||'';
    const perfil= document.getElementById('usr-perfil')?.value||'fiscal';
    const crea  = document.getElementById('usr-crea')?.value?.trim()||'';
    const tel   = document.getElementById('usr-tel')?.value?.trim()||'';
    if (!nome) { window.toast?.('⚠️ Informe o nome.','warn'); return; }

    if (this._editId) {
      const idx = this._usuarios.findIndex(u=>u.id===this._editId);
      if (idx>=0) this._usuarios[idx] = {...this._usuarios[idx],nome,email,perfil,crea,tel};
      this._editId=null;
    } else {
      this._usuarios.push({id:'usr_'+Date.now(),nome,email,perfil,crea,tel,criadoEm:new Date().toISOString()});
    }
    try {
      await this._persistir();
      window.toast?.('✅ Usuário salvo!','ok');
      ['usr-nome','usr-email','usr-crea','usr-tel'].forEach(id=>{const el=document.getElementById(id);if(el)el.value='';});
      this._render();
    } catch(e) { window.toast?.('❌ Erro ao salvar.','error'); }
  }

  _editar(id) {
    const u = this._usuarios.find(x=>x.id===id);
    if (!u) return;
    const nomeEl=document.getElementById('usr-nome'); if(nomeEl) nomeEl.value=u.nome||'';
    const emailEl=document.getElementById('usr-email'); if(emailEl) emailEl.value=u.email||'';
    const perfilEl=document.getElementById('usr-perfil'); if(perfilEl) perfilEl.value=u.perfil||'fiscal';
    const creaEl=document.getElementById('usr-crea'); if(creaEl) creaEl.value=u.crea||'';
    const telEl=document.getElementById('usr-tel'); if(telEl) telEl.value=u.tel||'';
    this._editId = id;
    document.getElementById('usr-nome')?.scrollIntoView({behavior:'smooth'});
    window.toast?.('✏️ Dados carregados para edição. Clique em "Adicionar" para salvar.','info');
  }

  async _excluir(id) {
    if (!confirm('Remover este usuário?')) return;
    this._usuarios = this._usuarios.filter(u=>u.id!==id);
    try { await this._persistir(); window.toast?.('🗑️ Removido.','ok'); this._render(); }
    catch(e) { window.toast?.('❌ Erro.','error'); }
  }

  _bindEvents() {
    this._subs.push(EventBus.on('obra:selecionada', async () => {
      try { await this._carregar(); if (router.current==='usuarios') this._render(); }
      catch(e) { console.error('[UsuariosModule]', e); }
    }, 'usuarios'));
  }

  _exposeGlobals() {
    window.renderUsuarios  = () => { try { this._render(); } catch(e){} };
    window.convidarUsuario = () => { try { this._adicionar(); } catch(e){} };
    window._usr_adicionar  = () => { try { this._adicionar(); } catch(e){} };
    window._usr_editar     = (id)=>{ try { this._editar(id); } catch(e){} };
    window._usr_excluir    = (id)=>{ try { this._excluir(id); } catch(e){} };
    window._usr_fecharModal= () => {
      const m=document.getElementById('usr-modal'); const o=document.getElementById('usr-overlay');
      if(m)m.style.display='none'; if(o)o.style.display='none';
    };
  }

  destroy() { this._subs.forEach(u=>u()); this._subs=[]; }
}

function sanitize(s) { return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;'); }
