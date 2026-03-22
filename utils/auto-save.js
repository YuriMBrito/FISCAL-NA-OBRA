/**
 * ╔══════════════════════════════════════════════════════════════╗
 * ║  FISCAL NA OBRA v15.1 — utils/auto-save.js                   ║
 * ║  Sistema de salvamento automático com indicador visual      ║
 * ╚══════════════════════════════════════════════════════════════╝
 *
 * Responsabilidades:
 *  1. Debounce global de 1 000 ms em eventos input/change/blur
 *  2. Emite EventBus 'autosave:trigger' → controllers salvam seu estado
 *  3. Exibe indicador visual discreto (Salvando… / Salvo / Erro)
 *  4. Registra listener beforeunload para flush síncrono antes de sair
 */

import EventBus from '../core/EventBus.js';
import state    from '../core/state.js';

// ── Constantes ────────────────────────────────────────────────
const DEBOUNCE_MS   = 1000;      // 1 s de inatividade antes de salvar
const INDICATOR_ID  = 'fo-autosave-indicator';
const HIDE_DELAY_MS = 2500;      // Oculta indicador 2,5 s após "Salvo"

// ── Estado interno ────────────────────────────────────────────
let _timer      = null;
let _hideTimer  = null;
let _saving     = false;
let _initialized = false;

// ── Indicador visual ──────────────────────────────────────────

function _criarIndicador() {
  if (document.getElementById(INDICATOR_ID)) return;
  const el = document.createElement('div');
  el.id = INDICATOR_ID;
  el.style.cssText = `
    position: fixed;
    bottom: 18px;
    right: 18px;
    z-index: 99999;
    background: #1e293b;
    color: #f8fafc;
    font-size: 11px;
    font-family: var(--font-mono, monospace);
    font-weight: 600;
    padding: 6px 13px;
    border-radius: 20px;
    box-shadow: 0 2px 10px rgba(0,0,0,0.35);
    opacity: 0;
    transition: opacity 0.25s ease;
    pointer-events: none;
    letter-spacing: 0.3px;
  `;
  document.body.appendChild(el);
  return el;
}

function _getIndicador() {
  return document.getElementById(INDICATOR_ID) || _criarIndicador();
}

function _mostrar(estado) {
  const el = _getIndicador();
  if (!el) return;

  clearTimeout(_hideTimer);

  const configs = {
    salvando: { texto: '💾 Salvando…', bg: '#1e293b', cor: '#93c5fd' },
    salvo:    { texto: '✅ Salvo',     bg: '#14532d', cor: '#86efac' },
    erro:     { texto: '❌ Erro ao salvar', bg: '#7f1d1d', cor: '#fca5a5' },
  };

  const cfg = configs[estado] || configs.salvando;
  el.textContent    = cfg.texto;
  el.style.background = cfg.bg;
  el.style.color      = cfg.cor;
  el.style.opacity    = '1';

  if (estado === 'salvo' || estado === 'erro') {
    _hideTimer = setTimeout(() => {
      el.style.opacity = '0';
    }, HIDE_DELAY_MS);
  }
}

// ── Execução do auto-save ─────────────────────────────────────

async function _executarSave() {
  const obraId = state.get('obraAtivaId');
  if (!obraId) return;          // Sem obra ativa, nada a salvar

  if (_saving) return;          // Evita overlapping saves
  _saving = true;
  _mostrar('salvando');

  try {
    // Emite evento para que cada controller salve seu próprio estado
    // (MemoriaModule, BoletimModule etc. escutam 'autosave:trigger')
    await new Promise(resolve => {
      EventBus.emit('autosave:trigger', { obraId, resolve });
      // Dá 800 ms para os controllers responderem antes de declarar "salvo"
      setTimeout(resolve, 800);
    });
    _mostrar('salvo');
  } catch (e) {
    console.error('[AutoSave] Erro:', e);
    _mostrar('erro');
  } finally {
    _saving = false;
  }
}

// ── Disparador debounced ──────────────────────────────────────

function _disparar() {
  clearTimeout(_timer);
  _timer = setTimeout(_executarSave, DEBOUNCE_MS);
}

// ── Flush síncrono (beforeunload) ─────────────────────────────

function _flushBeforeUnload() {
  const obraId = state.get('obraAtivaId');
  if (!obraId) return;
  // Dispara imediatamente sem debounce (usuário está saindo)
  EventBus.emit('autosave:trigger', { obraId, resolve: () => {} });
}

// ── Filtro de eventos — ignora campos irrelevantes ────────────

function _ehCampoRelevante(target) {
  if (!target || !target.tagName) return false;
  const tag = target.tagName.toLowerCase();
  if (!['input', 'textarea', 'select'].includes(tag)) return false;

  // Ignora campos de busca, filtro e login
  const id    = (target.id    || '').toLowerCase();
  const name  = (target.name  || '').toLowerCase();
  const cls   = (target.className || '').toLowerCase();
  const ignorar = ['login', 'senha', 'email', 'search', 'busca', 'filtro', 'pesquis'];
  if (ignorar.some(p => id.includes(p) || name.includes(p) || cls.includes(p))) return false;

  return true;
}

// ── Inicialização ─────────────────────────────────────────────

export function initAutoSave() {
  if (_initialized) return;
  _initialized = true;

  // Cria indicador visual logo que o DOM estiver pronto
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', _criarIndicador);
  } else {
    _criarIndicador();
  }

  // ── Eventos que disparam o auto-save ────────────────────────
  ['input', 'change', 'blur'].forEach(evento => {
    document.addEventListener(evento, (e) => {
      if (_ehCampoRelevante(e.target)) _disparar();
    }, { capture: true, passive: true });
  });

  // ── Proteção beforeunload ────────────────────────────────────
  window.addEventListener('beforeunload', () => {
    clearTimeout(_timer);   // Cancela timer pendente
    _flushBeforeUnload();   // Salva imediatamente
  });

  console.log('[AutoSave] Inicializado — debounce 1 000 ms, indicador visual ativo.');
}

// ── API pública ───────────────────────────────────────────────

/** Força um save imediato (ex: ao confirmar uma edição crítica). */
export function forceSave() {
  clearTimeout(_timer);
  return _executarSave();
}

export default { initAutoSave, forceSave };
