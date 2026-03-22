/**
 * ╔══════════════════════════════════════════════════════════════╗
 * ║  FISCAL NA OBRA v15.5 — services/smartAlertsService.js      ║
 * ║  Alertas Inteligentes — Badge + Painel                      ║
 * ╠══════════════════════════════════════════════════════════════╣
 * ║  Agrega alertas de validação e análise, exibe badge na      ║
 * ║  topbar com contagem e abre painel de detalhes ao clicar.   ║
 * ║                                                              ║
 * ║  Fontes de alerta:                                          ║
 * ║    • validation:resultado  (ValidationEngine)               ║
 * ║    • analysis:resultado    (AnalysisService)                ║
 * ║    • alertas manuais via EventBus 'alerta:manual'           ║
 * ║                                                              ║
 * ║  API pública:                                               ║
 * ║    smartAlertsService.getAlertas()   → todos os alertas     ║
 * ║    smartAlertsService.limpar()       → limpa lista          ║
 * ╚══════════════════════════════════════════════════════════════╝
 */

import EventBus from '../core/EventBus.js';
import state    from '../core/state.js';
import logger   from '../core/logger.js';

// ── Mapeamento de nível → ícone e cor ─────────────────────────
const NIVEL_META = {
  critico: { icon: '🔴', label: 'Crítico',  cor: '#e53e3e' },
  alto:    { icon: '🟠', label: 'Alto',     cor: '#dd6b20' },
  error:   { icon: '🔴', label: 'Erro',     cor: '#e53e3e' },
  warn:    { icon: '🟡', label: 'Aviso',    cor: '#d69e2e' },
  medio:   { icon: '🟡', label: 'Médio',    cor: '#d69e2e' },
  baixo:   { icon: '🟢', label: 'Baixo',    cor: '#38a169' },
  info:    { icon: '🔵', label: 'Info',     cor: '#3182ce' },
};

// ── Máximo de alertas mantidos em memória ─────────────────────
const MAX_ALERTAS = 100;

// ═══════════════════════════════════════════════════════════════
// SmartAlertsService
// ═══════════════════════════════════════════════════════════════
const SmartAlertsService = {

  _alertas: [],   // [{ id, nivel, modulo, msg, fonte, ts }]
  _badgeEl: null,
  _painelEl: null,
  _painelAberto: false,

  init() {
    try {
      this._bindEventBus();
      this._criarBadge();
      window.smartAlertsService = this;
      logger.info('SmartAlertsService', '✅ Alertas Inteligentes ativos.');
    } catch (e) {
      logger.warn('SmartAlertsService', `init: ${e.message}`);
    }
  },

  // ── Event Bus ────────────────────────────────────────────────

  _bindEventBus() {
    // Recebe alertas do ValidationEngine
    EventBus.on('validation:resultado', ({ alertas }) => {
      this._ingerirAlertas(alertas, 'validacao');
    }, 'smartAlerts');

    // Recebe riscos do AnalysisService
    EventBus.on('analysis:resultado', ({ riscos }) => {
      this._ingerirAlertas(riscos, 'analise');
    }, 'smartAlerts');

    // Alertas manuais de qualquer módulo
    EventBus.on('alerta:manual', alerta => {
      this._adicionarAlerta({ ...alerta, fonte: 'manual' });
    }, 'smartAlerts');

    // Limpa ao trocar obra
    EventBus.on('obra:selecionada', () => {
      this._alertas = [];
      this._atualizarBadge();
    }, 'smartAlerts');
  },

  _ingerirAlertas(lista, fonte) {
    if (!Array.isArray(lista)) return;

    // Remove alertas anteriores da mesma fonte
    this._alertas = this._alertas.filter(a => a.fonte !== fonte);

    lista.forEach(a => {
      this._alertas.push({
        id:     a.id || `${fonte}_${Date.now()}_${Math.random().toString(36).slice(2)}`,
        nivel:  a.nivel || a.gravidade || 'info',
        modulo: a.modulo || fonte,
        msg:    a.msg || '(sem mensagem)',
        fonte,
        ts:     a.ts || Date.now(),
      });
    });

    // Mantém limite e ordena por gravidade
    this._alertas = this._alertas
      .slice(-MAX_ALERTAS)
      .sort((a, b) => _pesoNivel(b.nivel) - _pesoNivel(a.nivel));

    this._atualizarBadge();
    EventBus.emit('smartAlerts:atualizado', { total: this._alertas.length });
  },

  _adicionarAlerta(alerta) {
    this._alertas.unshift({
      id:     alerta.id || `manual_${Date.now()}`,
      nivel:  alerta.nivel || 'info',
      modulo: alerta.modulo || 'Sistema',
      msg:    alerta.msg || '',
      fonte:  alerta.fonte || 'manual',
      ts:     Date.now(),
    });
    if (this._alertas.length > MAX_ALERTAS) this._alertas.pop();
    this._atualizarBadge();
  },

  // ── Badge na Topbar ──────────────────────────────────────────

  _criarBadge() {
    if (typeof document === 'undefined') return;

    // Aguarda DOM estar pronto
    const _tentar = () => {
      const topbar = document.querySelector('.topbar-actions, .topbar, header, nav');
      if (!topbar) { setTimeout(_tentar, 1000); return; }

      const btn = document.createElement('button');
      btn.id    = 'fo-smart-alerts-badge';
      btn.title = 'Alertas Inteligentes';
      btn.setAttribute('aria-label', 'Abrir painel de alertas');
      btn.style.cssText = [
        'position:relative', 'background:none', 'border:none',
        'cursor:pointer', 'font-size:1.3rem', 'padding:4px 8px',
        'display:flex', 'align-items:center', 'gap:4px',
        'color:inherit',
      ].join(';');
      btn.innerHTML = '🔔 <span id="fo-alerts-count" style="'
        + 'display:none;position:absolute;top:0;right:0;'
        + 'background:#e53e3e;color:#fff;border-radius:50%;'
        + 'font-size:0.65rem;font-weight:700;min-width:16px;height:16px;'
        + 'line-height:16px;text-align:center;padding:0 3px;'
        + '"></span>';

      btn.addEventListener('click', () => this._togglePainel());
      topbar.appendChild(btn);
      this._badgeEl = btn;
    };

    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', _tentar);
    } else {
      _tentar();
    }
  },

  _atualizarBadge() {
    if (!this._badgeEl) return;
    const countEl = this._badgeEl.querySelector('#fo-alerts-count');
    if (!countEl) return;

    const importantes = this._alertas.filter(a =>
      ['critico', 'alto', 'error', 'warn', 'medio'].includes(a.nivel)
    );
    if (importantes.length > 0) {
      countEl.textContent = importantes.length > 99 ? '99+' : String(importantes.length);
      countEl.style.display = 'block';
      // Cor do badge pelo alerta mais grave
      const nivelMaisGrave = importantes[0].nivel;
      const meta = NIVEL_META[nivelMaisGrave] || NIVEL_META.info;
      countEl.style.background = meta.cor;
    } else {
      countEl.style.display = 'none';
    }

    if (this._painelAberto) this._renderizarPainel();
  },

  // ── Painel de Detalhes ───────────────────────────────────────

  _togglePainel() {
    if (this._painelAberto) {
      this._fecharPainel();
    } else {
      this._abrirPainel();
    }
  },

  _abrirPainel() {
    if (typeof document === 'undefined') return;

    if (!this._painelEl) {
      const painel = document.createElement('div');
      painel.id = 'fo-smart-alerts-painel';
      painel.style.cssText = [
        'position:fixed', 'top:60px', 'right:16px',
        'width:360px', 'max-height:70vh',
        'background:#fff', 'border:1px solid #e2e8f0',
        'border-radius:8px', 'box-shadow:0 8px 24px rgba(0,0,0,0.15)',
        'z-index:9999', 'overflow:hidden',
        'display:flex', 'flex-direction:column',
        'font-family:inherit',
      ].join(';');
      document.body.appendChild(painel);
      this._painelEl = painel;

      // Fecha ao clicar fora
      document.addEventListener('click', e => {
        if (this._painelAberto
          && !this._painelEl?.contains(e.target)
          && !this._badgeEl?.contains(e.target)) {
          this._fecharPainel();
        }
      }, true);
    }

    this._painelAberto = true;
    this._renderizarPainel();
    this._painelEl.style.display = 'flex';
  },

  _fecharPainel() {
    this._painelAberto = false;
    if (this._painelEl) this._painelEl.style.display = 'none';
  },

  _renderizarPainel() {
    if (!this._painelEl) return;
    const total = this._alertas.length;

    const linhas = this._alertas.slice(0, 50).map(a => {
      const meta = NIVEL_META[a.nivel] || NIVEL_META.info;
      const hora = new Date(a.ts).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
      return `<div style="padding:8px 12px;border-bottom:1px solid #f0f0f0;font-size:0.82rem;">
        <div style="display:flex;justify-content:space-between;margin-bottom:2px;">
          <span style="font-weight:600;color:${meta.cor}">${meta.icon} ${meta.label}</span>
          <span style="color:#a0a0a0;font-size:0.75rem;">${hora} · ${a.modulo}</span>
        </div>
        <div style="color:#4a5568;">${_esc(a.msg)}</div>
      </div>`;
    }).join('');

    this._painelEl.innerHTML = `
      <div style="padding:12px 16px;background:#f7fafc;border-bottom:1px solid #e2e8f0;
                  display:flex;justify-content:space-between;align-items:center;flex-shrink:0;">
        <strong style="font-size:0.95rem;">🔔 Alertas (${total})</strong>
        <div style="display:flex;gap:8px;align-items:center;">
          ${total > 0 ? `<button onclick="window.smartAlertsService.limpar()"
            style="font-size:0.75rem;background:none;border:1px solid #cbd5e0;
                   border-radius:4px;padding:2px 8px;cursor:pointer;color:#718096;">
            Limpar
          </button>` : ''}
          <button onclick="window.smartAlertsService._fecharPainel()"
            style="background:none;border:none;cursor:pointer;font-size:1.1rem;
                   line-height:1;color:#718096;">✕</button>
        </div>
      </div>
      <div style="overflow-y:auto;flex:1;">
        ${linhas || '<div style="padding:24px;text-align:center;color:#a0a0a0;">Nenhum alerta no momento ✅</div>'}
      </div>`;
  },

  // ── API pública ──────────────────────────────────────────────

  getAlertas() {
    return this._alertas;
  },

  limpar() {
    this._alertas = [];
    this._atualizarBadge();
    if (this._painelAberto) this._renderizarPainel();
    logger.info('SmartAlertsService', 'Lista de alertas limpa.');
  },
};

// ── Helpers ──────────────────────────────────────────────────
function _pesoNivel(nivel) {
  return { critico: 5, alto: 4, error: 4, medio: 3, warn: 3, baixo: 2, info: 1 }[nivel] ?? 0;
}

function _esc(txt) {
  return String(txt)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

export default SmartAlertsService;
