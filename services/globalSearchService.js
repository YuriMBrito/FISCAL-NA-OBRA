/**
 * ╔══════════════════════════════════════════════════════════════╗
 * ║  FISCAL NA OBRA v15.5 — services/globalSearchService.js     ║
 * ║  Busca Global (Ctrl+K) — Itens, BMs, Documentos, Diário    ║
 * ╠══════════════════════════════════════════════════════════════╣
 * ║  Ativa com Ctrl+K ou pelo ícone de lupa.                   ║
 * ║  Busca em tempo real (debounce 200ms) nos dados em memória. ║
 * ║  Resultados organizados por categoria com navegação         ║
 * ║  por teclado (↑↓ Enter Esc).                               ║
 * ╚══════════════════════════════════════════════════════════════╝
 */

import EventBus from '../core/EventBus.js';
import state    from '../core/state.js';
import router   from '../core/router.js';
import logger   from '../core/logger.js';

const ESC = (s) => String(s || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');

// ── Normaliza texto para busca (remove acentos, maiúsculas) ───
function _norm(s) {
  return String(s || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
}

function _match(query, ...campos) {
  const q = _norm(query);
  return q.length >= 2 && campos.some(c => _norm(c).includes(q));
}

// ── Gera highlight da query no texto ──────────────────────────
function _hl(text, query) {
  if (!query || query.length < 2) return ESC(text);
  const safe = ESC(text);
  const re = new RegExp(`(${query.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')})`, 'gi');
  return safe.replace(re, '<mark style="background:#f59e0b33;color:inherit;border-radius:2px;padding:0 2px">$1</mark>');
}

// ═══════════════════════════════════════════════════════════════
// GlobalSearchService
// ═══════════════════════════════════════════════════════════════
const GlobalSearchService = {

  _overlay:  null,
  _input:    null,
  _results:  null,
  _debounce: null,
  _queryAtual: '',
  _idxSel: -1,
  _resultItems: [],

  init() {
    try {
      this._criarOverlay();
      this._bindKeys();
      window.globalSearchService = this;
      logger.info('GlobalSearchService', '✅ Busca global (Ctrl+K) ativa.');
    } catch (e) {
      logger.warn('GlobalSearchService', `init: ${e.message}`);
    }
  },

  // ── UI ────────────────────────────────────────────────────

  _criarOverlay() {
    if (document.getElementById('gs-overlay')) return;

    const overlay = document.createElement('div');
    overlay.id = 'gs-overlay';
    overlay.style.cssText = [
      'position:fixed','inset:0','background:rgba(0,0,0,.6)',
      'z-index:9000','display:none','align-items:flex-start',
      'justify-content:center','padding-top:12vh',
    ].join(';');
    overlay.addEventListener('click', e => { if (e.target === overlay) this.fechar(); });

    overlay.innerHTML = `
      <div style="width:min(680px,94vw);background:var(--bg-card);border:1px solid var(--border);
        border-radius:14px;overflow:hidden;box-shadow:0 24px 64px rgba(0,0,0,.5)">
        <div style="display:flex;align-items:center;gap:10px;padding:14px 16px;
          border-bottom:1px solid var(--border)">
          <span style="font-size:18px;color:var(--text-muted)">🔍</span>
          <input id="gs-input" type="text" placeholder="Buscar item, BM, documento, diário..."
            autocomplete="off" spellcheck="false"
            style="flex:1;background:none;border:none;outline:none;font-size:15px;
              color:var(--text-primary);caret-color:var(--accent)">
          <kbd style="padding:2px 7px;background:var(--bg-surface);border:1px solid var(--border);
            border-radius:5px;font-size:10px;color:var(--text-muted)">Esc</kbd>
        </div>
        <div id="gs-results" style="max-height:420px;overflow-y:auto;padding:6px 0">
          <div id="gs-hint" style="padding:24px;text-align:center;color:var(--text-muted);font-size:13px">
            Digite para buscar em itens, BMs, documentos e diário de obras.
          </div>
        </div>
        <div style="padding:8px 16px;border-top:1px solid var(--border);display:flex;gap:14px;
          font-size:10px;color:var(--text-muted)">
          <span>↑↓ navegar</span><span>Enter selecionar</span><span>Esc fechar</span>
        </div>
      </div>`;

    document.body.appendChild(overlay);
    this._overlay = overlay;
    this._input   = overlay.querySelector('#gs-input');
    this._results = overlay.querySelector('#gs-results');

    this._input.addEventListener('input', () => {
      clearTimeout(this._debounce);
      this._debounce = setTimeout(() => this._buscar(this._input.value), 200);
    });

    this._input.addEventListener('keydown', e => {
      if (e.key === 'ArrowDown') { e.preventDefault(); this._moverSel(1); }
      if (e.key === 'ArrowUp')   { e.preventDefault(); this._moverSel(-1); }
      if (e.key === 'Enter')     { e.preventDefault(); this._ativarSel(); }
      if (e.key === 'Escape')    this.fechar();
    });
  },

  _bindKeys() {
    document.addEventListener('keydown', e => {
      if ((e.ctrlKey || e.metaKey) && e.key === 'k') {
        e.preventDefault();
        this._overlay?.style.display === 'flex' ? this.fechar() : this.abrir();
      }
    });
    // Expõe globalmente
    window.abrirBuscaGlobal = () => this.abrir();
  },

  abrir() {
    if (!this._overlay) return;
    this._overlay.style.display = 'flex';
    this._idxSel = -1;
    this._queryAtual = '';
    this._input.value = '';
    this._results.innerHTML = `<div id="gs-hint" style="padding:24px;text-align:center;
      color:var(--text-muted);font-size:13px">Digite para buscar em itens, BMs, documentos e diário.</div>`;
    requestAnimationFrame(() => this._input.focus());
  },

  fechar() {
    if (!this._overlay) return;
    this._overlay.style.display = 'none';
    this._resultItems = [];
  },

  // ── Busca ─────────────────────────────────────────────────

  _buscar(query) {
    this._queryAtual = query.trim();
    if (this._queryAtual.length < 2) {
      this._results.innerHTML = `<div style="padding:20px;text-align:center;color:var(--text-muted);font-size:13px">
        Digite ao menos 2 caracteres.</div>`;
      this._resultItems = [];
      return;
    }

    const resultados = [
      ...this._buscarItens(this._queryAtual),
      ...this._buscarBMs(this._queryAtual),
      ...this._buscarDiario(this._queryAtual),
      ...this._buscarOcorrencias(this._queryAtual),
    ];

    this._resultItems = resultados;
    this._idxSel = -1;
    this._renderResultados(resultados, this._queryAtual);
  },

  _buscarItens(q) {
    const itens = state.get('itensContrato') || [];
    return itens
      .filter(it => _match(q, it.id, it.desc, it.cod, it.banco))
      .slice(0, 8)
      .map(it => ({
        tipo:    'item',
        titulo:  `${it.id} — ${it.desc}`,
        sub:     `${it.und || ''} · R$ ${(it.up||0).toLocaleString('pt-BR',{minimumFractionDigits:2})} · ${it.cod || ''}`,
        icone:   '📋',
        pagina:  'boletim',
        dados:   it,
      }));
  },

  _buscarBMs(q) {
    const bms = state.get('bms') || [];
    return bms
      .filter(bm => _match(q, bm.label, bm.mes, bm.data, bm.empenho, bm.notaFiscal))
      .map(bm => ({
        tipo:   'bm',
        titulo:  bm.label,
        sub:    `Período: ${bm.mes || '—'} · Data: ${bm.data || '—'}`,
        icone:  '📑',
        pagina: 'boletim',
        dados:  bm,
      }));
  },

  _buscarDiario(q) {
    const diario = state.get('diario') || [];
    return diario
      .filter(d => _match(q, d.descricao, d.data, d.responsavel, d.observacoes))
      .slice(0, 5)
      .map(d => ({
        tipo:   'diario',
        titulo:  `Diário ${d.data || '—'}`,
        sub:    (d.descricao || '').slice(0, 80),
        icone:  '📔',
        pagina: 'diario',
        dados:  d,
      }));
  },

  _buscarOcorrencias(q) {
    const ocs = state.get('ocorrencias') || [];
    return ocs
      .filter(oc => _match(q, oc.titulo, oc.descricao, oc.data))
      .slice(0, 5)
      .map(oc => ({
        tipo:   'ocorrencia',
        titulo:  oc.titulo || `Ocorrência ${oc.data}`,
        sub:    (oc.descricao || '').slice(0, 80),
        icone:  '⚠️',
        pagina: 'ocorrencias',
        dados:  oc,
      }));
  },

  // ── Render ────────────────────────────────────────────────

  _renderResultados(resultados, q) {
    if (!resultados.length) {
      this._results.innerHTML = `<div style="padding:28px;text-align:center;color:var(--text-muted);font-size:13px">
        Nenhum resultado para "<strong>${ESC(q)}</strong>".</div>`;
      return;
    }

    // Agrupa por tipo
    const grupos = {};
    resultados.forEach(r => {
      if (!grupos[r.tipo]) grupos[r.tipo] = [];
      grupos[r.tipo].push(r);
    });

    const LABELS = { item:'Itens do Contrato', bm:'Boletins de Medição', diario:'Diário de Obras', ocorrencia:'Ocorrências' };

    let html = '';
    let globalIdx = 0;
    Object.entries(grupos).forEach(([tipo, items]) => {
      html += `<div style="padding:6px 16px 2px;font-size:10px;font-weight:700;color:var(--text-muted);
        text-transform:uppercase;letter-spacing:.5px">${LABELS[tipo] || tipo} (${items.length})</div>`;
      items.forEach(r => {
        const idx = globalIdx++;
        html += `<div class="gs-item" data-idx="${idx}"
          style="display:flex;align-items:center;gap:10px;padding:9px 16px;cursor:pointer;
            border-radius:7px;margin:1px 6px;transition:background .1s"
          onmouseenter="this.parentElement.querySelectorAll('.gs-item').forEach(e=>e.style.background='');this.style.background='var(--bg-surface)'"
          onmouseleave="this.style.background=''"
          onclick="window.globalSearchService._ativarItem(${idx})">
          <span style="font-size:16px;flex-shrink:0">${r.icone}</span>
          <div style="flex:1;min-width:0">
            <div style="font-size:13px;font-weight:600;color:var(--text-primary);
              white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${_hl(r.titulo, q)}</div>
            <div style="font-size:11px;color:var(--text-muted);white-space:nowrap;
              overflow:hidden;text-overflow:ellipsis">${_hl(r.sub, q)}</div>
          </div>
          <span style="font-size:10px;color:var(--text-muted);flex-shrink:0">→</span>
        </div>`;
      });
    });

    this._results.innerHTML = html;
  },

  // ── Navegação teclado ─────────────────────────────────────

  _moverSel(delta) {
    const items = this._results.querySelectorAll('.gs-item');
    if (!items.length) return;
    items.forEach(el => el.style.background = '');
    this._idxSel = Math.max(0, Math.min(items.length - 1, this._idxSel + delta));
    const el = items[this._idxSel];
    if (el) { el.style.background = 'var(--bg-surface)'; el.scrollIntoView({ block: 'nearest' }); }
  },

  _ativarSel() {
    const items = this._results.querySelectorAll('.gs-item');
    if (this._idxSel >= 0 && items[this._idxSel]) {
      this._ativarItem(parseInt(items[this._idxSel].dataset.idx));
    }
  },

  _ativarItem(idx) {
    const r = this._resultItems[idx];
    if (!r) return;
    this.fechar();
    if (r.pagina) {
      try { router.navigate(r.pagina); } catch { /* silencioso */ }
    }
    // Emite evento para módulos reagirem (ex: focar item no BM)
    EventBus.emit('search:itemSelecionado', { resultado: r });
  },
};

export default GlobalSearchService;
