/**
 * ╔══════════════════════════════════════════════════════════════╗
 * ║  FISCAL NA OBRA — modules/fotos-medicao/fotos-medicao-controller.js ║
 * ║  Registro fotográfico vinculado ao item de BM com GPS        ║
 * ╚══════════════════════════════════════════════════════════════╝
 *
 * Cada foto é obrigatoriamente vinculada a:
 *   - Um Boletim de Medição (BM)
 *   - Um item contratual medido naquele BM
 *   - Coordenadas GPS no momento do registro
 *   - Timestamp automático
 *
 * Atende à exigência TCU/CGU de comprovação fotográfica por item.
 */

import EventBus        from '../../core/EventBus.js';
import state           from '../../core/state.js';
import router          from '../../core/router.js';
import FirebaseService from '../../firebase/firebase-service.js';
import { formatters }  from '../../utils/formatters.js';

const hoje  = () => new Date().toISOString().slice(0, 10);
const fmtDT = iso => iso ? new Date(iso).toLocaleString('pt-BR') : '—';

export class FotosMedicaoModule {
  constructor() {
    this._subs       = [];
    this._fotos      = [];
    this._filtro     = { bm: '', item: '' };
    this._fotoTemp   = [];
    this._gpsTemp    = null;
    this._modalAberto= false;
  }

  async init()    { this._bindEvents(); this._exposeGlobals(); }
  async onEnter() { await this._carregar(); this._render(); }

  async _carregar() {
    const obraId = state.get('obraAtivaId');
    if (!obraId) { this._fotos = []; return; }
    try {
      const estadoCache = state.get('fotosMedicao');
      if (estadoCache && estadoCache.length > 0) {
        this._fotos = estadoCache;
      } else {
        this._fotos = await FirebaseService.getFotosMedicao(obraId);
        state.set('fotosMedicao', this._fotos);
      }

      // v24.0 — MIGRAÇÃO: converte fotos base64 legadas para Firebase Storage.
      // Executa silenciosamente em background; não bloqueia a renderização.
      this._migrarBase64EmBackground(obraId);
    } catch (e) {
      this._fotos = [];
    }
  }

  // Detecta fotos com dataUrl base64 e faz upload para Storage, atualizando o registro.
  async _migrarBase64EmBackground(obraId) {
    const pendentes = this._fotos.filter(f => f.url && f.url.startsWith('data:'));
    if (!pendentes.length) return;

    console.log(`[FotosMedicao] Migrando ${pendentes.length} foto(s) base64 → Storage...`);
    let migraram = 0;
    for (const foto of pendentes) {
      try {
        const storageUrl = await FirebaseService.uploadFotoStorage(obraId, foto.url, 'fotos-medicao');
        if (!storageUrl.startsWith('data:')) {
          foto.url = storageUrl;
          delete foto.dataUrl; // remove campo legado se existir
          migraram++;
        }
      } catch (e) {
        console.warn('[FotosMedicao] Falha ao migrar foto:', foto.id, e?.message);
      }
    }
    if (migraram > 0) {
      await FirebaseService.salvarFotosMedicao(obraId, this._fotos).catch(() => {});
      state.set('fotosMedicao', this._fotos);
      console.log(`[FotosMedicao] ${migraram} foto(s) migrada(s) para Storage ✅`);
    }
  }

  async _salvar() {
    const obraId = state.get('obraAtivaId');
    if (!obraId) return;
    await FirebaseService.salvarFotosMedicao(obraId, this._fotos);
    state.set('fotosMedicao', this._fotos); // FIX-E2.3: manter state sincronizado
  }

  _render() {
    const el = document.getElementById('fotos-medicao-conteudo');
    if (!el) return;
    const obraId = state.get('obraAtivaId');

    if (!obraId) {
      el.innerHTML = '<div style="text-align:center;padding:40px;color:var(--text-muted);font-size:13px">Selecione uma obra para registrar fotos.</div>';
      return;
    }

    const bms   = state.get('bms') || [];
    const itens = (state.get('itensContrato') || []).filter(i => !i.t);
    const lista = this._filtrar();
    const kpis  = this._calcKpis();

    el.innerHTML = `
      <!-- KPIs -->
      <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(120px,1fr));gap:10px;margin-bottom:16px">
        ${this._kpi('Total de fotos', kpis.total, 'var(--accent)')}
        ${this._kpi('Com GPS', kpis.comGps, 'var(--color-success, #22c55e)')}
        ${this._kpi('Sem GPS', kpis.semGps, 'var(--color-warning, #f59e0b)')}
        ${this._kpi('BMs cobertos', kpis.bmsComFoto, 'var(--color-info-mid, #60a5fa)')}
      </div>

      <!-- Filtros + ação -->
      <div style="display:flex;gap:8px;flex-wrap:wrap;align-items:center;margin-bottom:14px">
        <select onchange="window._fm_filtro('bm', this.value)"
          style="padding:7px 10px;font-size:12px;border-radius:7px;border:1px solid var(--border);background:var(--bg-surface);color:var(--text-primary)">
          <option value="">Todos os BMs</option>
          ${bms.map(b => `<option value="${b.num}" ${this._filtro.bm==b.num?'selected':''}>${b.label}</option>`).join('')}
        </select>
        <input type="text" placeholder="🔍 Filtrar por item..." value="${this._filtro.item}"
          oninput="window._fm_filtro('item', this.value)"
          style="flex:1;min-width:140px;padding:7px 10px;font-size:12px;border-radius:7px;border:1px solid var(--border);background:var(--bg-surface);color:var(--text-primary)">
        <button data-action="_fm_abrirForm"
          style="padding:8px 16px;background:var(--accent);border:none;border-radius:8px;color:#fff;font-size:12px;font-weight:700;cursor:pointer;white-space:nowrap">
          📷 Registrar Foto
        </button>
      </div>

      <!-- Aviso sem itens -->
      ${itens.length === 0 ? '<div style="background:var(--color-warning-bg, #fefce8);border:1px solid var(--color-warning-light, #fde68a);border-radius:8px;padding:12px;font-size:12px;color:var(--color-amber-dark, #92400e);margin-bottom:14px">⚠️ Não há itens contratuais cadastrados. Importe a planilha SINAPI primeiro.</div>' : ''}

      <!-- Grade de fotos -->
      ${lista.length === 0
        ? `<div style="text-align:center;padding:48px;color:var(--text-muted);font-size:12px">${this._fotos.length===0 ? '📷 Nenhuma foto registrada. Registre a primeira foto vinculada a um item de medição.' : 'Nenhuma foto encontrada com os filtros aplicados.'}</div>`
        : `<div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(240px,1fr));gap:12px">${lista.map(f => this._cardFoto(f)).join('')}</div>`
      }

      <!-- Modal overlay -->
      <div id="fm-overlay" data-action="_fm_fecharForm"
        style="display:none;position:fixed;inset:0;background:rgba(0,0,0,.6);z-index:1000"></div>
      <div id="fm-modal"
        style="display:none;position:fixed;top:50%;left:50%;transform:translate(-50%,-50%);
        z-index:1001;background:var(--bg-card);border:1px solid var(--border);border-radius:14px;
        padding:24px;width:min(96vw,540px);max-height:92vh;overflow-y:auto;
        box-shadow:0 20px 60px rgba(0,0,0,.45)"></div>
    `;
  }

  _filtrar() {
    let lista = [...this._fotos].sort((a, b) => (b.timestamp || '').localeCompare(a.timestamp || ''));
    if (this._filtro.bm)   lista = lista.filter(f => String(f.bmNum) === String(this._filtro.bm));
    if (this._filtro.item) {
      const q = this._filtro.item.toLowerCase();
      lista = lista.filter(f => (f.itemDesc || '').toLowerCase().includes(q) || (f.itemId || '').toLowerCase().includes(q));
    }
    return lista;
  }

  _calcKpis() {
    const f = this._fotos;
    return {
      total:      f.length,
      comGps:     f.filter(x => x.gps).length,
      semGps:     f.filter(x => !x.gps).length,
      bmsComFoto: new Set(f.map(x => x.bmNum)).size,
    };
  }

  _kpi(label, valor, cor) {
    return `<div style="background:var(--bg-surface);border:1px solid var(--border);border-radius:8px;padding:12px;text-align:center">
      <div style="font-size:9px;font-weight:700;color:var(--text-muted);text-transform:uppercase;letter-spacing:.5px;margin-bottom:5px">${label}</div>
      <div style="font-size:20px;font-weight:800;color:${cor}">${valor}</div>
    </div>`;
  }

  _cardFoto(f) {
    const gpsLink = f.gps ? `https://maps.google.com/?q=${f.gps.lat},${f.gps.lng}` : null;
    return `
      <div style="background:var(--bg-surface);border:1px solid var(--border);border-radius:10px;overflow:hidden">
        <div style="position:relative">
          <img src="${f.url || f.dataUrl}" alt="Foto medição" loading="lazy"
            style="width:100%;height:160px;object-fit:cover;display:block">
          ${f.gps ? `<a href="${gpsLink}" target="_blank"
            style="position:absolute;bottom:6px;right:6px;background:rgba(0,0,0,.65);color:#fff;
            font-size:10px;padding:3px 7px;border-radius:10px;text-decoration:none">📍 GPS</a>` : ''}
        </div>
        <div style="padding:10px">
          <div style="font-size:11px;font-weight:700;color:var(--text-primary);margin-bottom:3px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis" title="${f.itemDesc||''}">
            ${f.itemDesc || 'Item não especificado'}
          </div>
          <div style="font-size:10px;color:var(--text-muted);margin-bottom:3px">${f.bmLabel || 'BM não especificado'}</div>
          <div style="font-size:10px;color:var(--text-muted);margin-bottom:6px">${fmtDT(f.timestamp)}</div>
          ${f.descricao ? `<div style="font-size:11px;color:var(--text-muted);margin-bottom:6px;font-style:italic">"${f.descricao}"</div>` : ''}
          <div style="display:flex;gap:6px">
            ${gpsLink ? `<a href="${gpsLink}" target="_blank" style="font-size:10px;padding:4px 8px;border-radius:6px;background:var(--color-info-bg, #dbeafe);color:var(--color-info-darker, #1e40af);text-decoration:none;border:1px solid var(--color-info-light, #93c5fd)">🗺️ Mapa</a>` : ''}
            <button data-action="_fm_excluir" data-arg0="${f.id}" style="font-size:10px;padding:4px 8px;border-radius:6px;background:var(--color-danger-bg, #fee2e2);color:var(--color-danger-dark, #dc2626);border:1px solid var(--color-danger-light, #fca5a5);cursor:pointer">🗑️</button>
          </div>
        </div>
      </div>
    `;
  }

  _abrirForm() {
    const modal   = document.getElementById('fm-modal');
    const overlay = document.getElementById('fm-overlay');
    if (!modal || !overlay) { this._render(); setTimeout(() => this._abrirForm(), 60); return; }

    this._fotoTemp = [];
    this._gpsTemp  = null;

    const bms   = state.get('bms') || [];
    const itens = (state.get('itensContrato') || []).filter(i => !i.t);

    modal.innerHTML = `
      <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:18px">
        <h3 style="margin:0;font-size:15px;font-weight:800;color:var(--text-primary)">📷 Registrar Foto de Medição</h3>
        <button data-action="_fm_fecharForm" style="background:none;border:none;cursor:pointer;font-size:18px;color:var(--text-muted)">✕</button>
      </div>
      <div style="display:grid;gap:12px">

        <!-- BM -->
        <div>
          <label style="font-size:11px;font-weight:700;color:var(--text-muted);display:block;margin-bottom:4px">Boletim de Medição *</label>
          <select id="fm-bm" style="width:100%;padding:8px;border-radius:7px;border:1px solid var(--border);background:var(--bg-surface);color:var(--text-primary);font-size:12px;box-sizing:border-box"
            onchange="window._fm_filtrarItens(this.value)">
            <option value="">Selecione o BM…</option>
            ${bms.map(b => `<option value="${b.num}">${b.label}</option>`).join('')}
          </select>
        </div>

        <!-- Item -->
        <div>
          <label style="font-size:11px;font-weight:700;color:var(--text-muted);display:block;margin-bottom:4px">Item Medido *</label>
          <select id="fm-item" style="width:100%;padding:8px;border-radius:7px;border:1px solid var(--border);background:var(--bg-surface);color:var(--text-primary);font-size:12px;box-sizing:border-box">
            <option value="">Selecione o BM primeiro…</option>
          </select>
          <div id="fm-item-todos" style="display:none">
            <select id="fm-item-sel" style="width:100%;padding:8px;border-radius:7px;border:1px solid var(--border);background:var(--bg-surface);color:var(--text-primary);font-size:12px;box-sizing:border-box;margin-top:4px">
              <option value="">Selecione um item…</option>
              ${itens.map(i => `<option value="${i.id}" data-desc="${i.desc}">${i.id} — ${i.desc.slice(0,60)}</option>`).join('')}
            </select>
          </div>
        </div>

        <!-- GPS -->
        <div style="display:flex;align-items:center;gap:10px;flex-wrap:wrap">
          <label style="font-size:11px;font-weight:700;color:var(--text-muted)">📍 GPS *</label>
          <button type="button" data-action="_fm_capturarGPS"
            style="padding:7px 14px;border-radius:7px;border:1px solid var(--border);background:var(--bg-surface);color:var(--text-primary);font-size:11px;cursor:pointer">
            Capturar localização
          </button>
          <span id="fm-gps-display" style="font-size:11px;color:var(--text-muted)">Não capturado</span>
        </div>

        <!-- Foto -->
        <div>
          <label style="font-size:11px;font-weight:700;color:var(--text-muted);display:block;margin-bottom:6px">Foto *</label>
          <div style="display:flex;gap:8px;flex-wrap:wrap">
            <input type="file" id="fm-foto-input" accept="image/*" style="display:none" onchange="window._fm_adicionarFoto(this)">
            <button data-action="_fmFotoClick"
              style="padding:7px 14px;border-radius:7px;border:1px solid var(--border);background:var(--bg-surface);color:var(--text-primary);font-size:11px;cursor:pointer">
              📁 Galeria
            </button>
            <button data-action="_fm_abrirCamera"
              style="padding:7px 14px;border-radius:7px;border:1px solid var(--border);background:var(--bg-surface);color:var(--text-primary);font-size:11px;cursor:pointer">
              📸 Câmera
            </button>
          </div>
          <div id="fm-foto-preview" style="margin-top:8px"></div>
        </div>

        <!-- Descrição -->
        <div>
          <label style="font-size:11px;font-weight:700;color:var(--text-muted);display:block;margin-bottom:4px">Descrição / Observação</label>
          <textarea id="fm-desc" rows="2" placeholder="Ex: Concretagem concluída, traço 1:2:3, slump 8cm..."
            style="width:100%;padding:8px;border-radius:7px;border:1px solid var(--border);background:var(--bg-surface);color:var(--text-primary);font-size:12px;resize:vertical;box-sizing:border-box"></textarea>
        </div>

      </div>
      <div style="display:flex;gap:8px;justify-content:flex-end;margin-top:20px">
        <button data-action="_fm_fecharForm"
          style="padding:9px 18px;background:var(--bg-surface);border:1px solid var(--border);border-radius:8px;font-size:12px;font-weight:700;cursor:pointer;color:var(--text-primary)">
          Cancelar
        </button>
        <button data-action="_fm_salvarForm"
          style="padding:9px 18px;background:var(--accent);border:none;border-radius:8px;color:#fff;font-size:12px;font-weight:700;cursor:pointer">
          💾 Salvar Foto
        </button>
      </div>
    `;

    overlay.style.display = 'block';
    modal.style.display   = 'block';
  }

  _fecharForm() {
    const modal   = document.getElementById('fm-modal');
    const overlay = document.getElementById('fm-overlay');
    if (modal)   modal.style.display   = 'none';
    if (overlay) overlay.style.display = 'none';
    this._fotoTemp = [];
    this._gpsTemp  = null;
  }

  async _salvarForm() {
    const g       = id => document.getElementById(id);
    const obraId  = state.get('obraAtivaId');           // v24.0: declarado aqui
    const bmNum   = g('fm-bm')?.value;
    const itemSel = g('fm-item-sel');
    const itemId  = itemSel?.value || g('fm-item')?.value;
    const desc    = g('fm-desc')?.value?.trim() || '';

    if (!obraId) { window.toast?.('⚠️ Selecione uma obra.', 'warn'); return; }

    const bms  = state.get('bms') || [];
    const bm   = bms.find(b => String(b.num) === String(bmNum));
    const itens= (state.get('itensContrato') || []).filter(i => !i.t);
    const item = itens.find(i => i.id === itemId);

    if (!bmNum)                { window.toast?.('⚠️ Selecione o BM.', 'warn'); return; }
    if (!itemId)               { window.toast?.('⚠️ Selecione o item medido.', 'warn'); return; }
    if (!this._fotoTemp.length){ window.toast?.('⚠️ Adicione pelo menos uma foto.', 'warn'); return; }
    if (!this._gpsTemp) {
      // FIX-E3.3: ConfirmComponent em vez de confirm() nativo
      const ok = await window._confirm(
        'A foto não terá localização georreferenciada.',
        { title: '📍 Continuar sem GPS?', labelOk: 'Continuar assim', labelCancel: 'Capturar GPS', danger: false }
      );
      if (!ok) return;
    }

    // FIX-E2.1: upload para Firebase Storage antes de salvar no Firestore.
    // Se Storage indisponível (offline), uploadFotoStorage devolve o dataUrl
    // como fallback — o dado não se perde.
    window.toast?.('⏳ Enviando foto...', 'ok', 8000);
    const fotoUrl = await FirebaseService.uploadFotoStorage(
      obraId, this._fotoTemp[0], 'fotos-medicao'
    );

    const registro = {
      id:        `fm_${Date.now()}`,
      bmNum:     bmNum,
      bmLabel:   bm?.label || `BM ${bmNum}`,
      itemId:    itemId,
      itemDesc:  item?.desc || itemId,
      url:       fotoUrl,       // URL do Storage (ou base64 como fallback offline)
      descricao: desc,
      gps:       this._gpsTemp || null,
      timestamp: new Date().toISOString(),
    };

    this._fotos.push(registro);
    try {
      await this._salvar();
      window.toast?.('✅ Foto registrada com sucesso!', 'ok');
      this._fecharForm();
      this._render();
    } catch (e) {
      window.toast?.('❌ Erro ao salvar foto.', 'error');
    }
  }

  async _excluir(id) {
    // FIX-E3.3: ConfirmComponent em vez de confirm() nativo
    const _okExcluirFm = await window._confirm('Excluir esta foto de medição?', { labelOk: 'Excluir', danger: true });
    if (!_okExcluirFm) return;
    this._fotos = this._fotos.filter(f => f.id !== id);
    try { await this._salvar(); window.toast?.('🗑️ Foto excluída.', 'ok'); this._render(); }
    catch (e) { window.toast?.('❌ Erro.', 'error'); }
  }

  _bindEvents() {
    this._subs.push(EventBus.on('obra:selecionada', async () => {
      try { await this._carregar(); if (router.current === 'fotos-medicao') this._render(); }
      catch (e) { console.error('[FotosMedicaoModule]', e); }
    }, 'fotos-medicao'));
  }

  _exposeGlobals() {
    window._fm_abrirForm  = ()      => this._abrirForm();
    window._fm_fecharForm = ()      => this._fecharForm();
    window._fm_salvarForm = () => {
      // FIX-E3.2: upload para Storage pode demorar — protege contra duplo clique
      const btn = document.querySelector('[data-action="_fm_salvarForm"]');
      import('../../utils/loading.js').then(({ withLoading }) => {
        withLoading(btn, () => this._salvarForm(), {
          labelLoading: 'Enviando foto...',
          labelDone: 'Foto salva!',
          labelError: 'Erro no upload',
        }).catch(e => window.toast?.('❌ Erro ao salvar foto: ' + e.message, 'error'));
      });
    };
    window._fm_excluir    = id      => this._excluir(id).catch(console.error);
    window._fm_filtro     = (k, v)  => { this._filtro[k] = v; this._render(); };

    window._fm_filtrarItens = (bmNum) => {
      const itemSel   = document.getElementById('fm-item-sel');
      const itemTodos = document.getElementById('fm-item-todos');
      if (!itemSel || !itemTodos) return;
      itemTodos.style.display = 'block';
      // Filtrar itens que foram medidos neste BM
      const medicoes = state.get('medicoes') || {};
      const bmMeds   = Object.values(medicoes).find(m => String(m.bmNum) === String(bmNum));
      const itens    = (state.get('itensContrato') || []).filter(i => !i.t);
      itemSel.innerHTML = '<option value="">Selecione um item…</option>' +
        itens.map(i => `<option value="${i.id}">${i.id} — ${i.desc.slice(0, 60)}</option>`).join('');
    };

    window._fm_adicionarFoto = (input) => {
      const file = input?.files?.[0];
      if (!file) return;
      const reader = new FileReader();
      reader.onload = e => {
        this._fotoTemp = [e.target.result];
        const prev = document.getElementById('fm-foto-preview');
        if (prev) prev.innerHTML = `<img src="${e.target.result}" style="width:100%;max-height:200px;object-fit:cover;border-radius:8px;margin-top:4px">`;
      };
      reader.readAsDataURL(file);
      if (input) input.value = '';
    };

    window._fm_abrirCamera = () => {
      const inp = document.createElement('input');
      inp.type = 'file'; inp.accept = 'image/*'; inp.capture = 'environment';
      inp.onchange = () => window._fm_adicionarFoto(inp);
      inp.click();
    };

    window._fm_capturarGPS = () => {
      if (!navigator.geolocation) { window.toast?.('⚠️ GPS não disponível neste dispositivo.', 'warn'); return; }
      const btn = document.querySelector('[data-action="_fm_capturarGPS"]');
      if (btn) { btn.textContent = '⏳ Aguardando…'; btn.disabled = true; }
      navigator.geolocation.getCurrentPosition(
        pos => {
          const { latitude: lat, longitude: lng, accuracy } = pos.coords;
          this._gpsTemp = { lat, lng, acc: Math.round(accuracy), ts: new Date().toISOString() };
          const disp = document.getElementById('fm-gps-display');
          if (disp) disp.innerHTML = `<span style="color:var(--color-success, #22c55e)">✅ ${lat.toFixed(6)}, ${lng.toFixed(6)} (±${Math.round(accuracy)}m)</span>`;
          if (btn) { btn.textContent = '✅ Capturado'; btn.disabled = false; }
        },
        err => {
          if (btn) { btn.textContent = 'Capturar localização'; btn.disabled = false; }
          window.toast?.('⚠️ GPS: ' + err.message, 'warn');
        },
        { enableHighAccuracy: true, timeout: 12000, maximumAge: 0 }
      );
    };
  }

  destroy() { this._subs.forEach(u => u()); this._subs = []; }
}
