/**
 * ╔══════════════════════════════════════════════════════════════╗
 * ║  FISCAL NA OBRA v15 — documentos-controller.js              ║
 * ║  Módulo RECRIADO — Sistema de Documentos e Anexos           ║
 * ╚══════════════════════════════════════════════════════════════╝
 */

import EventBus       from '../../core/EventBus.js';
import state          from '../../core/state.js';
import router         from '../../core/router.js';
import FirebaseService from '../../firebase/firebase-service.js';
import storageUtils    from '../../utils/storage.js';

const TIPOS_DOC = [
  'ART / RRT',
  'Notificação',
  'Aditivo Contratual',
  'Nota Fiscal',
  'Relatório de Fiscalização',
  'Ordem de Serviço',
  'Medição Assinada',
  'Projeto / Planta',
  'Licença / Alvará',
  'Contrato',
  'Foto / Registro',
  'Outro',
];

export class DocumentosModule {
  constructor() {
    this._subs     = [];
    this._docs     = [];
    this._filtroTipo = '';
    this._busca    = '';
    this._uploading= false;
  }

  async init() {
    try { this._bindEvents(); this._exposeGlobals(); }
    catch(e) { console.error('[DocumentosModule] init:', e); }
  }

  async onEnter() {
    try { await this._carregar(); this._render(); }
    catch(e) { console.error('[DocumentosModule] onEnter:', e); }
  }

  async _carregar() {
    const obraId = state.get('obraAtivaId');
    if (!obraId) return;
    try { this._docs = await FirebaseService.getDocumentos(obraId) || []; }
    catch(e) { console.error('[DocumentosModule] _carregar:', e); this._docs = []; }
  }

  // ═══════════════════════════════════════════════════════════════
  //  RENDER
  // ═══════════════════════════════════════════════════════════════
  _render() {
    const el = document.getElementById('documentos-conteudo');
    if (!el) return;
    const obraId = state.get('obraAtivaId');
    if (!obraId) {
      el.innerHTML = `<div style="text-align:center;padding:40px;color:var(--text-muted);font-size:13px">
        Selecione uma obra para gerenciar seus documentos.</div>`;
      return;
    }

    let docs = [...this._docs];
    if (this._filtroTipo) docs = docs.filter(d => d.tipo === this._filtroTipo);
    if (this._busca) {
      const b = this._busca.toLowerCase();
      docs = docs.filter(d =>
        (d.nome||'').toLowerCase().includes(b) ||
        (d.tipo||'').toLowerCase().includes(b) ||
        (d.obs||'').toLowerCase().includes(b));
    }
    docs.sort((a,b) => (b.dataCad||'').localeCompare(a.dataCad||''));

    const tiposComContagem = TIPOS_DOC.map(t => ({
      t, n: this._docs.filter(d=>d.tipo===t).length
    }));

    el.innerHTML = `
      <!-- Cabeçalho com botão de upload -->
      <div style="display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;
        gap:10px;margin-bottom:18px">
        <div>
          <div style="font-size:12px;color:var(--text-muted)">${this._docs.length} documento(s) cadastrado(s)</div>
        </div>
        <button data-action="_doc_abrirUpload"
          style="padding:8px 18px;background:var(--accent);border:none;border-radius:8px;
          color:#fff;font-size:13px;font-weight:700;cursor:pointer">📎 Adicionar Documento</button>
      </div>

      <!-- Filtros rápidos por tipo -->
      <div style="display:flex;flex-wrap:wrap;gap:6px;margin-bottom:16px">
        <button data-action="_doc_filtroTipo" data-arg0="''"
          style="padding:4px 12px;border-radius:20px;font-size:11px;font-weight:600;border:1px solid var(--border);
          background:${!this._filtroTipo?'var(--accent)':'transparent'};
          color:${!this._filtroTipo?'#fff':'var(--text-muted)'};cursor:pointer">
          Todos (${this._docs.length})
        </button>
        ${tiposComContagem.filter(t=>t.n>0).map(({t,n}) => `
          <button data-action="_doc_filtroTipo" data-arg0="${t.replace(/'/g,"\\'")}\"
            style="padding:4px 12px;border-radius:20px;font-size:11px;font-weight:600;border:1px solid var(--border);
            background:${this._filtroTipo===t?'var(--accent)':'transparent'};
            color:${this._filtroTipo===t?'#fff':'var(--text-muted)'};cursor:pointer">
            ${t} (${n})
          </button>`).join('')}
      </div>

      <!-- Busca -->
      <div style="margin-bottom:16px">
        <input type="text" placeholder="🔍 Buscar documentos..." value="${this._busca}"
          oninput="window._doc_busca(this.value)"
          style="width:100%;box-sizing:border-box;padding:8px 12px;border:1px solid var(--border);
          border-radius:7px;background:var(--bg-card);color:var(--text-primary);font-size:12px">
      </div>

      <!-- Lista de documentos -->
      ${docs.length === 0
        ? `<div style="text-align:center;padding:40px;color:var(--text-muted);font-size:12px">
            Nenhum documento encontrado.<br>
            <span style="font-size:11px">Use o botão "📎 Adicionar Documento" para fazer upload.</span>
          </div>`
        : `<div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(280px,1fr));gap:12px">
            ${docs.map(d => this._cardDoc(d)).join('')}
          </div>`}

      <!-- Overlay e Modal -->
      <div id="doc-overlay" data-action="_doc_fecharModal"
        style="display:none;position:fixed;inset:0;background:rgba(0,0,0,.55);z-index:1000"></div>
      <div id="doc-modal"
        style="display:none;position:fixed;top:50%;left:50%;transform:translate(-50%,-50%);
        z-index:1001;background:var(--bg-card);border:1px solid var(--border);border-radius:14px;
        padding:24px;width:min(96vw,560px);max-height:90vh;overflow-y:auto;
        box-shadow:0 20px 60px rgba(0,0,0,.4)"></div>
    `;
  }

  _cardDoc(d) {
    const ext  = (d.nome||'').split('.').pop().toUpperCase();
    const isImg= ['JPG','JPEG','PNG','GIF','WEBP'].includes(ext);
    const isPdf= ext === 'PDF';
    const icone= isPdf ? '📄' : isImg ? '🖼️' : '📎';
    const dataCad = d.dataCad ? new Date(d.dataCad).toLocaleDateString('pt-BR') : '—';
    const dataDoc = d.dataDoc ? d.dataDoc : '—';
    return `
      <div style="background:var(--bg-surface);border:1px solid var(--border);border-radius:10px;
        padding:14px;display:flex;flex-direction:column;gap:8px">
        <div style="display:flex;align-items:flex-start;gap:10px">
          <div style="font-size:28px;flex-shrink:0">${icone}</div>
          <div style="flex:1;min-width:0">
            <div style="font-weight:600;font-size:12px;color:var(--text-primary);
              overflow:hidden;text-overflow:ellipsis;white-space:nowrap" title="${d.nome||''}">${d.nome||'Sem nome'}</div>
            <div style="font-size:10px;margin-top:3px">
              <span style="background:var(--bg-card);border:1px solid var(--border);padding:1px 7px;
                border-radius:10px;color:var(--text-muted);font-weight:600">${d.tipo||'Outro'}</span>
            </div>
          </div>
        </div>
        <div style="font-size:10px;color:var(--text-muted);display:grid;grid-template-columns:1fr 1fr;gap:4px">
          <span>📅 Doc: ${dataDoc}</span>
          <span>📥 Cadastro: ${dataCad}</span>
          ${d.tamanho ? `<span>📦 ${this._formatTam(d.tamanho)}</span>` : ''}
        </div>
        ${d.obs ? `<div style="font-size:11px;color:var(--text-muted);font-style:italic;
          border-top:1px solid var(--border);padding-top:6px">${d.obs}</div>` : ''}
        <div style="display:flex;gap:6px;margin-top:4px">
          ${d.url ? `
            <a href="${d.url}" target="_blank" rel="noopener"
              style="flex:1;padding:5px 8px;background:transparent;border:1px solid var(--border);
              border-radius:6px;color:var(--text-primary);font-size:11px;cursor:pointer;
              text-align:center;text-decoration:none;font-weight:600">👁️ Visualizar</a>
            <a href="${d.url}" download="${d.nome||'documento'}"
              style="flex:1;padding:5px 8px;background:transparent;border:1px solid var(--accent);
              border-radius:6px;color:var(--accent);font-size:11px;cursor:pointer;
              text-align:center;text-decoration:none;font-weight:600">⬇️ Baixar</a>
          ` : '<span style="font-size:10px;color:var(--text-muted)">Arquivo não disponível</span>'}
          <button data-action="_doc_excluir" data-arg0="${d.id}" style="padding:5px 8px;background:transparent;border:1px solid #fca5a5;
            border-radius:6px;color:#ef4444;font-size:11px;cursor:pointer;font-weight:600">🗑️</button>
        </div>
      </div>`;
  }

  _formatTam(bytes) {
    if (!bytes) return '';
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024*1024) return `${(bytes/1024).toFixed(1)} KB`;
    return `${(bytes/1024/1024).toFixed(1)} MB`;
  }

  // ═══════════════════════════════════════════════════════════════
  //  MODAL DE UPLOAD
  // ═══════════════════════════════════════════════════════════════
  _abrirUpload() {
    const modal = document.getElementById('doc-modal');
    const overlay = document.getElementById('doc-overlay');
    if (!modal || !overlay) return;
    overlay.style.display = 'block';

    modal.innerHTML = `
      <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:18px">
        <div style="font-size:15px;font-weight:800;color:var(--text-primary)">📎 Adicionar Documento</div>
        <button data-action="_doc_fecharModal"
          style="background:none;border:none;cursor:pointer;font-size:22px;color:var(--text-muted)">×</button>
      </div>

      <div style="display:grid;gap:12px">
        <!-- Tipo do documento -->
        <div>
          <label style="display:block;font-size:10px;font-weight:700;color:var(--text-muted);
            text-transform:uppercase;letter-spacing:.5px;margin-bottom:5px">Tipo de Documento *</label>
          <select id="doc-tipo"
            style="width:100%;box-sizing:border-box;padding:9px 11px;border:1px solid var(--border);
            border-radius:7px;background:var(--bg-card);color:var(--text-primary);font-size:13px">
            <option value="">— Selecione o tipo —</option>
            ${TIPOS_DOC.map(t => `<option value="${t}">${t}</option>`).join('')}
          </select>
        </div>

        <!-- Data do documento -->
        <div>
          <label style="display:block;font-size:10px;font-weight:700;color:var(--text-muted);
            text-transform:uppercase;letter-spacing:.5px;margin-bottom:5px">Data do Documento</label>
          <input type="date" id="doc-data-doc"
            style="width:100%;box-sizing:border-box;padding:9px 11px;border:1px solid var(--border);
            border-radius:7px;background:var(--bg-card);color:var(--text-primary);font-size:13px">
        </div>

        <!-- Observações -->
        <div>
          <label style="display:block;font-size:10px;font-weight:700;color:var(--text-muted);
            text-transform:uppercase;letter-spacing:.5px;margin-bottom:5px">Observações</label>
          <textarea id="doc-obs" rows="2" placeholder="Opcional..."
            style="width:100%;box-sizing:border-box;padding:9px 11px;border:1px solid var(--border);
            border-radius:7px;background:var(--bg-card);color:var(--text-primary);font-size:13px;
            resize:vertical"></textarea>
        </div>

        <!-- Arquivo -->
        <div>
          <label style="display:block;font-size:10px;font-weight:700;color:var(--text-muted);
            text-transform:uppercase;letter-spacing:.5px;margin-bottom:5px">Arquivo *</label>
          <div id="doc-drop" ondragover="event.preventDefault();this.style.borderColor='var(--accent)'"
            ondragleave="this.style.borderColor='var(--border)'"
            ondrop="window._doc_handleDrop(event)"
            data-action="_docClickFileInput"
            style="border:2px dashed var(--border);border-radius:8px;padding:28px;text-align:center;
            cursor:pointer;transition:border-color .2s">
            <div style="font-size:28px">📂</div>
            <div style="font-size:12px;color:var(--text-muted);margin-top:6px">
              Arraste ou clique para selecionar<br>
              <span style="font-size:11px">PDF, JPG, PNG</span>
            </div>
            <input type="file" id="doc-file-input" accept=".pdf,.jpg,.jpeg,.png" style="display:none"
              onchange="window._doc_fileSelected(event)">
          </div>
          <div id="doc-file-info" style="font-size:11px;color:var(--accent);margin-top:6px;display:none"></div>
        </div>
      </div>

      <div id="doc-progresso" style="display:none;margin-top:12px">
        <div style="height:6px;background:var(--border);border-radius:3px;overflow:hidden">
          <div id="doc-prog-bar" style="height:100%;width:0%;background:var(--accent);border-radius:3px;
            transition:width .3s"></div>
        </div>
        <div id="doc-prog-txt" style="font-size:11px;color:var(--text-muted);margin-top:4px"></div>
      </div>

      <div id="doc-erro" style="display:none;padding:10px;background:#fef2f2;border:1px solid #fca5a5;
        border-radius:6px;color:#dc2626;font-size:12px;margin-top:12px"></div>

      <div style="display:flex;gap:8px;justify-content:flex-end;margin-top:18px">
        <button data-action="_doc_fecharModal"
          style="padding:10px 18px;background:transparent;border:1px solid var(--border);border-radius:8px;
          color:var(--text-muted);font-size:13px;cursor:pointer">Cancelar</button>
        <button id="doc-btn-salvar" data-action="_doc_salvar"
          style="padding:10px 22px;background:var(--accent);border:none;border-radius:8px;
          color:#fff;font-size:13px;font-weight:700;cursor:pointer">💾 Salvar</button>
      </div>`;

    modal.style.display = 'block';
    this._arquivoPendente = null;
  }

  _handleDrop(e) {
    e.preventDefault();
    const file = e.dataTransfer?.files?.[0];
    if (file) this._setArquivo(file);
  }

  _fileSelected(e) {
    const file = e.target?.files?.[0];
    if (file) this._setArquivo(file);
  }

  _setArquivo(file) {
    const ext = file.name.split('.').pop().toLowerCase();
    if (!['pdf','jpg','jpeg','png'].includes(ext)) {
      const erroEl = document.getElementById('doc-erro');
      if (erroEl) { erroEl.textContent = '⚠️ Tipo de arquivo não permitido. Use PDF, JPG ou PNG.'; erroEl.style.display='block'; }
      return;
    }
    this._arquivoPendente = file;
    const info = document.getElementById('doc-file-info');
    if (info) {
      const tam = file.size < 1024*1024 ? `${(file.size/1024).toFixed(1)} KB` : `${(file.size/1024/1024).toFixed(1)} MB`;
      info.textContent = `✅ ${file.name} (${tam})`;
      info.style.display = 'block';
    }
    const drop = document.getElementById('doc-drop');
    if (drop) drop.style.borderColor = 'var(--accent)';
  }

  async _salvar() {
    const tipo    = document.getElementById('doc-tipo')?.value;
    const dataDoc = document.getElementById('doc-data-doc')?.value;
    const obs     = document.getElementById('doc-obs')?.value?.trim();
    const erroEl  = document.getElementById('doc-erro');
    const btnEl   = document.getElementById('doc-btn-salvar');
    const progEl  = document.getElementById('doc-progresso');
    const barEl   = document.getElementById('doc-prog-bar');
    const txtEl   = document.getElementById('doc-prog-txt');

    if (!tipo) {
      if (erroEl) { erroEl.textContent = '⚠️ Selecione o tipo de documento.'; erroEl.style.display='block'; }
      return;
    }
    if (!this._arquivoPendente) {
      if (erroEl) { erroEl.textContent = '⚠️ Selecione um arquivo.'; erroEl.style.display='block'; }
      return;
    }
    if (erroEl) erroEl.style.display = 'none';
    if (btnEl) { btnEl.disabled=true; btnEl.textContent='⏳ Enviando...'; }
    if (progEl) progEl.style.display = 'block';

    const obraId = state.get('obraAtivaId');
    try {
      // Upload do arquivo
      let url = '', tamanho = this._arquivoPendente.size;
      if (barEl) barEl.style.width = '10%';
      if (txtEl) txtEl.textContent = 'Enviando arquivo...';

      try {
        url = await FirebaseService.uploadDocumento(obraId, this._arquivoPendente,
          (p) => { if (barEl) barEl.style.width = `${p}%`; });
      } catch(uploadErr) {
        // Se upload falhar, salva apenas os metadados sem URL
        console.warn('[DocumentosModule] Upload falhou — salvando metadados:', uploadErr);
        url = '';
      }

      if (barEl) barEl.style.width = '90%';
      if (txtEl) txtEl.textContent = 'Salvando metadados...';

      const doc = {
        id:       `doc_${Date.now().toString(36)}`,
        tipo,
        nome:     this._arquivoPendente.name,
        url,
        tamanho,
        dataDoc:  dataDoc || '',
        dataCad:  new Date().toISOString(),
        obs:      obs || '',
      };

      const docsAtual = [...this._docs, doc];
      await FirebaseService.salvarDocumentos(obraId, docsAtual);
      this._docs = docsAtual;

      if (barEl) barEl.style.width = '100%';
      if (txtEl) txtEl.textContent = 'Concluído!';

      this._fecharModal();
      this._render();
      window.toast?.('✅ Documento adicionado com sucesso!', 'ok');
    } catch(e) {
      console.error('[DocumentosModule] _salvar:', e);
      if (erroEl) { erroEl.textContent = `❌ Erro: ${e.message}`; erroEl.style.display='block'; }
      if (btnEl) { btnEl.disabled=false; btnEl.textContent='💾 Salvar'; }
    }
  }

  async _excluir(docId) {
    const doc = this._docs.find(d => d.id === docId);
    if (!doc) return;
    if (!confirm(`🗑️ Mover "${doc.nome}" para a Lixeira?\n\nVocê poderá restaurá-lo em Configurações → Itens Excluídos.`)) return;
    const obraId = state.get('obraAtivaId');
    const user   = state.get('usuarioLogado') || {};
    const meta   = {
      excluidoPor:  { uid: user.uid||'', email: user.email||'desconhecido', nome: user.displayName||user.email||'Usuário' },
      moduloOrigem: 'documentos',
      obraId,
    };
    const lxLabel = doc.nome || docId;
    storageUtils.lixeiraEnviar('documento', lxLabel, { doc: { ...doc }, obraId }, meta);
    try {
      await FirebaseService.salvarItemLixeiraFirebase({
        id: `lx_${Date.now()}`, tipo: 'documento', label: lxLabel, obraId,
        excluidoEm: new Date().toISOString(), ...meta,
        dados: { doc: { ...doc }, obraId },
      });
    } catch {}
    try {
      const novaLista = this._docs.filter(d => d.id !== docId);
      await FirebaseService.salvarDocumentos(obraId, novaLista);
      this._docs = novaLista;
      EventBus.emit('lixeira:atualizada', {});
      this._render();
      window.toast?.('🗑️ Documento movido para a lixeira.', 'warn');
    } catch(e) {
      console.error('[DocumentosModule] _excluir:', e);
      window.toast?.('❌ Erro ao mover documento.', 'error');
    }
  }
  _fecharModal() {
    const modal   = document.getElementById('doc-modal');
    const overlay = document.getElementById('doc-overlay');
    if (modal)   modal.style.display = 'none';
    if (overlay) overlay.style.display = 'none';
    this._arquivoPendente = null;
  }

  // ═══════════════════════════════════════════════════════════════
  //  EVENTOS E GLOBALS
  // ═══════════════════════════════════════════════════════════════
  _bindEvents() {
    this._subs.push(
      EventBus.on('obra:selecionada', async () => {
        try { await this._carregar(); if (router.current==='documentos') this._render(); } catch(e) {}
      }, 'documentos'),
    );
  }

  _exposeGlobals() {
    window.renderDocumentos     = () => { try { this.onEnter(); } catch(e){} };
    window.uploadDocumento      = () => { try { this._abrirUpload(); } catch(e){} };
    window.excluirDocumento     = id => { try { this._excluir(id); } catch(e){} };
    window._doc_abrirUpload     = () => { try { this._abrirUpload(); } catch(e){} };
    window._doc_fecharModal     = () => { try { this._fecharModal(); } catch(e){} };
    window._doc_salvar          = () => { try { this._salvar(); } catch(e){} };
    window._doc_excluir         = id => { try { this._excluir(id); } catch(e){} };
    window._doc_filtroTipo      = t  => { try { this._filtroTipo=t; this._render(); } catch(e){} };
    window._doc_busca           = v  => { try { this._busca=v; this._render(); } catch(e){} };
    window._doc_handleDrop      = e  => { try { this._handleDrop(e); } catch(e){} };
    window._doc_fileSelected    = e  => { try { this._fileSelected(e); } catch(e){} };
  }

  destroy() { this._subs.forEach(u => u()); this._subs = []; }
}
