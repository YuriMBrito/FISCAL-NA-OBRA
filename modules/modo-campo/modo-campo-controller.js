/**
 * ╔══════════════════════════════════════════════════════════════╗
 * ║  FISCAL NA OBRA — modules/modo-campo/modo-campo-controller.js ║
 * ║  Interface simplificada para uso em campo (mobile/tablet)   ║
 * ╚══════════════════════════════════════════════════════════════╝
 *
 * Painel compacto otimizado para uso com capacete e luvas,
 * tela pequena e conexão instável. Permite:
 *   - Registrar entrada no diário de obra com 1 toque
 *   - Registrar ocorrência rápida (foto + descrição + GPS)
 *   - Confirmar presença na obra (checkin georreferenciado)
 *   - Ver resumo da obra sem abrir outros módulos
 */

import EventBus        from '../../core/EventBus.js';
import state           from '../../core/state.js';
import router          from '../../core/router.js';
import FirebaseService from '../../firebase/firebase-service.js';

const hoje  = () => new Date().toISOString().slice(0, 10);
const agora = () => new Date().toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
const fmtBRL= v  => (parseFloat(v)||0).toLocaleString('pt-BR', { style:'currency', currency:'BRL' });

export class ModoCampoModule {
  constructor() {
    this._subs    = [];
    this._checkin = null;
    this._salvando= false;
  }

  async init()    { this._bindEvents(); this._exposeGlobals(); }
  async onEnter() { this._render(); }

  _render() {
    const el = document.getElementById('modo-campo-conteudo');
    if (!el) return;
    const obraId = state.get('obraAtivaId');

    if (!obraId) {
      el.innerHTML = `
        <div style="text-align:center;padding:48px 20px">
          <div style="font-size:40px;margin-bottom:12px">🏗️</div>
          <div style="font-size:14px;font-weight:700;color:var(--text-primary);margin-bottom:6px">Nenhuma obra selecionada</div>
          <div style="font-size:12px;color:var(--text-muted)">Selecione uma obra na barra lateral para usar o Modo Campo.</div>
        </div>`;
      return;
    }

    const cfg   = state.get('cfg')  || {};
    const bms   = state.get('bms')  || [];
    const hoje_ = hoje();

    el.innerHTML = `
      <!-- Cabeçalho da obra -->
      <div style="background:linear-gradient(135deg,var(--color-info-darker, #1e40af),#1d4ed8);border-radius:12px;padding:16px;margin-bottom:16px;color:#fff">
        <div style="font-size:11px;opacity:.7;margin-bottom:4px;text-transform:uppercase;letter-spacing:.5px">Obra ativa</div>
        <div style="font-size:14px;font-weight:800;margin-bottom:4px">${cfg.objeto || 'Obra sem nome'}</div>
        <div style="font-size:11px;opacity:.8">${cfg.contratada || '—'}</div>
        <div style="display:flex;gap:16px;margin-top:10px;font-size:11px">
          <span>📋 BM ${bms.length}</span>
          <span>💰 ${fmtBRL(cfg.valor)}</span>
          <span>📅 ${cfg.termino ? new Date(cfg.termino+'T12:00:00').toLocaleDateString('pt-BR') : '—'}</span>
        </div>
      </div>

      <!-- Grid de ações rápidas -->
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-bottom:16px">

        <!-- Check-in -->
        <button data-action="_mc_checkin"
          style="padding:20px 12px;border-radius:12px;border:2px solid ${this._checkin?'var(--color-success, #22c55e)':'var(--border)'};
          background:${this._checkin?'var(--color-success-bg, #dcfce7)':'var(--bg-surface)'};cursor:pointer;text-align:center;
          display:flex;flex-direction:column;align-items:center;gap:6px">
          <span style="font-size:28px">${this._checkin ? '✅' : '📍'}</span>
          <span style="font-size:12px;font-weight:700;color:var(--text-primary)">${this._checkin ? 'Registrado!' : 'Check-in'}</span>
          <span style="font-size:10px;color:var(--text-muted)">${this._checkin ? this._checkin.hora : 'Confirmar presença'}</span>
        </button>

        <!-- Diário rápido -->
        <button data-action="_mc_diarioRapido"
          style="padding:20px 12px;border-radius:12px;border:2px solid var(--border);
          background:var(--bg-surface);cursor:pointer;text-align:center;
          display:flex;flex-direction:column;align-items:center;gap:6px">
          <span style="font-size:28px">📝</span>
          <span style="font-size:12px;font-weight:700;color:var(--text-primary)">Diário</span>
          <span style="font-size:10px;color:var(--text-muted)">Entrada rápida</span>
        </button>

        <!-- Ocorrência rápida -->
        <button data-action="_mc_ocorrenciaRapida"
          style="padding:20px 12px;border-radius:12px;border:2px solid var(--color-danger-light, #fca5a5);
          background:var(--color-danger-surface, #fff5f5);cursor:pointer;text-align:center;
          display:flex;flex-direction:column;align-items:center;gap:6px">
          <span style="font-size:28px">⚠️</span>
          <span style="font-size:12px;font-weight:700;color:var(--color-danger-dark, #dc2626)">Ocorrência</span>
          <span style="font-size:10px;color:var(--color-danger-mid, #f87171)">Registrar problema</span>
        </button>

        <!-- Foto de medição -->
        <button data-action="_mc_fotoRapida"
          style="padding:20px 12px;border-radius:12px;border:2px solid var(--color-info-light, #93c5fd);
          background:var(--color-info-surface, #eff6ff);cursor:pointer;text-align:center;
          display:flex;flex-direction:column;align-items:center;gap:6px">
          <span style="font-size:28px">📸</span>
          <span style="font-size:12px;font-weight:700;color:var(--color-info-dark, #1d4ed8)">Foto BM</span>
          <span style="font-size:10px;color:var(--color-info-mid, #60a5fa)">Foto de medição</span>
        </button>
      </div>

      <!-- Resumo rápido -->
      <div style="background:var(--bg-surface);border:1px solid var(--border);border-radius:10px;padding:14px;margin-bottom:16px">
        <div style="font-size:11px;font-weight:700;color:var(--text-muted);text-transform:uppercase;letter-spacing:.5px;margin-bottom:10px">Resumo da Obra</div>
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px">
          <div style="text-align:center;padding:8px;background:var(--bg-card);border-radius:8px">
            <div style="font-size:18px;font-weight:800;color:var(--accent)">${bms.length}</div>
            <div style="font-size:10px;color:var(--text-muted)">BMs emitidos</div>
          </div>
          <div style="text-align:center;padding:8px;background:var(--bg-card);border-radius:8px">
            <div style="font-size:18px;font-weight:800;color:var(--color-success, #22c55e)">${fmtBRL(bms.reduce((s,b)=>s+(parseFloat(b.valorAprovado||b.valorTotal)||0),0))}</div>
            <div style="font-size:10px;color:var(--text-muted)">valor medido</div>
          </div>
        </div>
      </div>

      <!-- Painel de modais -->
      <div id="mc-overlay" data-action="if" data-arg0="event.target===this)window._mc_fecharModal("
        style="display:none;position:fixed;inset:0;background:rgba(0,0,0,.65);z-index:2000;align-items:flex-end;justify-content:center">
        <div id="mc-modal"
          style="background:var(--bg-card);border-radius:14px 14px 0 0;padding:24px;width:100%;max-width:500px;max-height:85vh;overflow-y:auto;
          box-shadow:0 -8px 40px rgba(0,0,0,.4)"></div>
      </div>
    `;
  }

  async _checkinGPS() {
    if (!navigator.geolocation) { window.toast?.('⚠️ GPS não disponível.', 'warn'); return; }
    window.toast?.('📍 Capturando localização…', 'ok');
    navigator.geolocation.getCurrentPosition(
      async pos => {
        const { latitude: lat, longitude: lng, accuracy } = pos.coords;
        this._checkin = { hora: agora(), lat, lng, acc: Math.round(accuracy), data: hoje() };
        const obraId = state.get('obraAtivaId');
        if (obraId) {
          try {
            const diario = await FirebaseService.getDiario(obraId).catch(() => []) || [];
            diario.push({
              id:   `checkin_${Date.now()}`,
              data: hoje(),
              tipo: 'checkin',
              texto: `✅ Check-in — ${agora()} — GPS: ${lat.toFixed(6)}, ${lng.toFixed(6)} (±${Math.round(accuracy)}m)`,
              fiscal: state.get('usuarioLogado')?.displayName || '',
              gps: { lat, lng, acc: Math.round(accuracy) },
              criadoEm: new Date().toISOString(),
            });
            await FirebaseService.salvarDiario(obraId, diario);
          } catch {}
        }
        window.toast?.(`✅ Check-in registrado às ${agora()}`, 'ok');
        this._render();
      },
      err => window.toast?.('⚠️ GPS: ' + err.message, 'warn'),
      { enableHighAccuracy: true, timeout: 12000 }
    );
  }

  _abrirModal(html) {
    const overlay = document.getElementById('mc-overlay');
    const modal   = document.getElementById('mc-modal');
    if (!overlay || !modal) return;
    modal.innerHTML   = html;
    overlay.style.display = 'flex';
  }

  _fecharModal() {
    const overlay = document.getElementById('mc-overlay');
    if (overlay) overlay.style.display = 'none';
  }

  _modalDiario() {
    this._abrirModal(`
      <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:16px">
        <h3 style="margin:0;font-size:15px;font-weight:800;color:var(--text-primary)">📝 Diário — Entrada Rápida</h3>
        <button data-action="_mc_fecharModal" style="background:none;border:none;font-size:22px;cursor:pointer;color:var(--text-muted)">✕</button>
      </div>
      <div style="margin-bottom:12px">
        <label style="font-size:11px;font-weight:700;color:var(--text-muted);display:block;margin-bottom:4px">Tipo de registro</label>
        <select id="mc-tipo-diario" style="width:100%;padding:10px;font-size:14px;border-radius:8px;border:1px solid var(--border);background:var(--bg-surface);color:var(--text-primary)">
          <option value="atividades">🏗️ Atividades do dia</option>
          <option value="mao_obra">👷 Mão de obra presente</option>
          <option value="equipamentos">🚛 Equipamentos em uso</option>
          <option value="materiais">📦 Recebimento de material</option>
          <option value="visita">🕵️ Visita / Fiscalização</option>
          <option value="paralisacao">⏸️ Paralisação</option>
          <option value="retomada">▶️ Retomada</option>
        </select>
      </div>
      <div style="margin-bottom:16px">
        <label style="font-size:11px;font-weight:700;color:var(--text-muted);display:block;margin-bottom:4px">Descrição *</label>
        <textarea id="mc-texto-diario" rows="4" placeholder="Descreva o registro..."
          style="width:100%;padding:10px;font-size:14px;border-radius:8px;border:1px solid var(--border);background:var(--bg-surface);color:var(--text-primary);resize:none;box-sizing:border-box"></textarea>
      </div>
      <button data-action="_mc_salvarDiario"
        style="width:100%;padding:14px;background:var(--accent);border:none;border-radius:10px;color:#fff;font-size:14px;font-weight:800;cursor:pointer">
        💾 SALVAR REGISTRO
      </button>
    `);
    setTimeout(() => document.getElementById('mc-texto-diario')?.focus(), 100);
  }

  async _salvarDiario() {
    const tipo  = document.getElementById('mc-tipo-diario')?.value || 'atividades';
    const texto = document.getElementById('mc-texto-diario')?.value?.trim();
    if (!texto) { window.toast?.('⚠️ Escreva a descrição.', 'warn'); return; }
    const obraId = state.get('obraAtivaId');
    if (!obraId) return;
    try {
      const diario = await FirebaseService.getDiario(obraId).catch(() => []) || [];
      diario.push({
        id:       `d_${Date.now()}`,
        data:     hoje(),
        tipo:     tipo,
        texto:    texto,
        fiscal:   state.get('usuarioLogado')?.displayName || '',
        criadoEm: new Date().toISOString(),
      });
      await FirebaseService.salvarDiario(obraId, diario);
      window.toast?.('✅ Diário registrado!', 'ok');
      this._fecharModal();
    } catch (e) {
      window.toast?.('❌ Erro ao salvar.', 'error');
    }
  }

  _modalOcorrenciaRapida() {
    this._abrirModal(`
      <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:16px">
        <h3 style="margin:0;font-size:15px;font-weight:800;color:var(--color-danger-dark, #dc2626)">⚠️ Ocorrência Rápida</h3>
        <button data-action="_mc_fecharModal" style="background:none;border:none;font-size:22px;cursor:pointer;color:var(--text-muted)">✕</button>
      </div>
      <div style="margin-bottom:12px">
        <label style="font-size:11px;font-weight:700;color:var(--text-muted);display:block;margin-bottom:4px">Gravidade</label>
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px">
          <button data-action="_mc_setGrav" data-arg0="this" data-arg1="baixa" data-grav="baixa"
            style="padding:10px;border-radius:8px;border:2px solid var(--color-success, #22c55e);background:var(--color-success-bg, #dcfce7);color:var(--color-success-dark, #16a34a);font-size:12px;font-weight:700;cursor:pointer">✅ Baixa</button>
          <button data-action="_mc_setGrav" data-arg0="this" data-arg1="media" data-grav="media"
            style="padding:10px;border-radius:8px;border:2px solid var(--color-warning, #f59e0b);background:var(--color-warning-bg, #fefce8);color:var(--color-warning-dark, #d97706);font-size:12px;font-weight:700;cursor:pointer">⚡ Média</button>
          <button data-action="_mc_setGrav" data-arg0="this" data-arg1="alta" data-grav="alta"
            style="padding:10px;border-radius:8px;border:2px solid var(--color-danger, #ef4444);background:var(--color-danger-bg, #fee2e2);color:var(--color-danger-dark, #dc2626);font-size:12px;font-weight:700;cursor:pointer">🔥 Alta</button>
          <button data-action="_mc_setGrav" data-arg0="this" data-arg1="critica" data-grav="critica"
            style="padding:10px;border-radius:8px;border:2px solid var(--color-purple, #7c3aed);background:var(--color-purple-bg, #f5f3ff);color:var(--color-purple, #7c3aed);font-size:12px;font-weight:700;cursor:pointer">🚨 Crítica</button>
        </div>
        <input type="hidden" id="mc-grav" value="baixa">
      </div>
      <div style="margin-bottom:12px">
        <label style="font-size:11px;font-weight:700;color:var(--text-muted);display:block;margin-bottom:4px">Descrição *</label>
        <textarea id="mc-desc-oc" rows="3" placeholder="O que aconteceu?"
          style="width:100%;padding:10px;font-size:14px;border-radius:8px;border:1px solid var(--border);background:var(--bg-surface);color:var(--text-primary);resize:none;box-sizing:border-box"></textarea>
      </div>
      <div style="margin-bottom:16px;display:flex;gap:8px;flex-wrap:wrap">
        <input type="file" id="mc-foto-oc" accept="image/*" capture="environment" style="display:none" onchange="window._mc_previewFotoOc(this)">
        <button data-action="_mcFotoOcClick"
          style="flex:1;padding:12px;border-radius:8px;border:2px dashed var(--border);background:var(--bg-surface);color:var(--text-muted);font-size:13px;cursor:pointer">
          📸 Tirar Foto
        </button>
      </div>
      <div id="mc-foto-oc-preview" style="margin-bottom:16px"></div>
      <button data-action="_mc_salvarOcorrencia"
        style="width:100%;padding:14px;background:var(--color-danger-dark, #dc2626);border:none;border-radius:10px;color:#fff;font-size:14px;font-weight:800;cursor:pointer">
        ⚠️ REGISTRAR OCORRÊNCIA
      </button>
    `);
  }

  async _salvarOcorrencia() {
    const grav = document.getElementById('mc-grav')?.value || 'baixa';
    const desc = document.getElementById('mc-desc-oc')?.value?.trim();
    if (!desc) { window.toast?.('⚠️ Descreva a ocorrência.', 'warn'); return; }
    const obraId = state.get('obraAtivaId');
    if (!obraId) return;
    try {
      // FIX-E2.1: upload foto para Storage se disponível
      let fotoFinal = this._fotoOcTemp;
      if (fotoFinal && String(fotoFinal).startsWith('data:')) {
        fotoFinal = await FirebaseService.uploadFotoStorage(
          obraId, fotoFinal, 'ocorrencias'
        ).catch(() => fotoFinal);
      }
      const fotos = fotoFinal ? [{ url: fotoFinal }] : [];
      const todas = await FirebaseService.getOcorrencias(obraId).catch(() => []) || [];
      todas.push({
        id:         `oc_${Date.now()}`,
        numero:     `OC-${String(todas.length+1).padStart(3,'0')}`,
        data:       hoje(),
        tipo:       'outra',
        gravidade:  grav,
        descricao:  desc,
        local:      'Modo Campo',
        responsavel:state.get('usuarioLogado')?.displayName || '',
        fotos:      fotos,
        resolvida:  false,
        criadoEm:   new Date().toISOString(),
        origemCampo:true,
      });
      await FirebaseService.salvarOcorrencias(obraId, todas);
      window.toast?.('✅ Ocorrência registrada!', 'ok');
      this._fotoOcTemp = null;
      this._fecharModal();
    } catch (e) {
      window.toast?.('❌ Erro ao salvar.', 'error');
    }
  }

  _bindEvents() {
    this._subs.push(EventBus.on('obra:selecionada', () => {
      if (router.current === 'modo-campo') this._render();
    }, 'modo-campo'));
  }

  _exposeGlobals() {
    window._mc_checkin           = () => this._checkinGPS();
    window._mc_diarioRapido      = () => this._modalDiario();
    window._mc_ocorrenciaRapida  = () => this._modalOcorrenciaRapida();
    window._mc_fotoRapida        = () => router.navigate('fotos-medicao');
    window._mc_fecharModal       = () => this._fecharModal();
    window._mc_salvarDiario      = () => this._salvarDiario().catch(console.error);
    window._mc_salvarOcorrencia  = () => this._salvarOcorrencia().catch(console.error);

    window._mc_setGrav = (btn, v) => {
      document.querySelectorAll('[data-grav]').forEach(b => b.style.opacity = '.4');
      btn.style.opacity = '1';
      const inp = document.getElementById('mc-grav');
      if (inp) inp.value = v;
    };

    window._mc_previewFotoOc = (input) => {
      const file = input?.files?.[0];
      if (!file) return;
      const reader = new FileReader();
      reader.onload = e => {
        this._fotoOcTemp = e.target.result;
        const prev = document.getElementById('mc-foto-oc-preview');
        if (prev) prev.innerHTML = `<img src="${e.target.result}" style="width:100%;max-height:160px;object-fit:cover;border-radius:8px">`;
      };
      reader.readAsDataURL(file);
    };
  }

  destroy() { this._subs.forEach(u => u()); this._subs = []; }
}
