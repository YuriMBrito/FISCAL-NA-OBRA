/**
 * ╔══════════════════════════════════════════════════════════════════════╗
 * ║  FISCAL NA OBRA v15.1 — modules/diagnostico/diagnostico-controller.js║
 * ║  Painel de diagnóstico em tempo real do sistema de isolamento       ║
 * ╚══════════════════════════════════════════════════════════════════════╝
 *
 * Exibe:
 *  - Status de todos os módulos (active / failed / disabled / loading)
 *  - Estado dos Circuit Breakers
 *  - Estado dos Error Boundaries
 *  - Últimas entradas de log (tempo real via logger.onLog)
 *  - Botões de reload / disable por módulo
 */

import logger          from '../../core/logger.js';
import EventBus        from '../../core/EventBus.js';
import moduleLoader, { MODULE_STATUS } from '../../core/module-loader.js';
import moduleMonitor   from '../../core/module-monitor.js';
import { getAllBoundarySnapshots, BOUNDARY_STATUS } from '../../core/error-boundary.js';
import { createBoundary } from '../../core/error-boundary.js';

const PAGE_ID   = 'diagnostico';
const MODULE_ID = 'diagnostico';

export class DiagnosticoModule {
  constructor() {
    this._boundary   = createBoundary(MODULE_ID, PAGE_ID, { errorThreshold: 20 });
    this._subs       = [];
    this._logUnsub   = null;
    this._refreshTimer = null;
    this._logBuffer  = [];       // últimas 80 entradas para a UI
  }

  init() {
    this._exposeGlobals();
    logger.debug(MODULE_ID, 'DiagnosticoModule init OK.');
  }

  onEnter() {
    this._boundary.run(() => {
      this._render();
      this._startLiveLog();
      this._startAutoRefresh();
    }, { label: 'onEnter' });
  }

  onLeave() {
    this._stopLiveLog();
    this._stopAutoRefresh();
  }

  destroy() {
    this.onLeave();
    this._subs.forEach(u => u());
  }

  // ── Render principal ──────────────────────────────────────────────────────
  _render() {
    const page = document.getElementById(PAGE_ID);
    if (!page) return;

    page.innerHTML = `
      <div style="padding:4px 0">

        <!-- Cabeçalho -->
        <div style="display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:10px;margin-bottom:16px">
          <h2 style="margin:0;font-size:16px;color:var(--text-primary,#f1f5f9)">🔬 Diagnóstico do Sistema</h2>
          <div style="display:flex;gap:8px;flex-wrap:wrap">
            <button class="btn btn-cinza btn-sm" data-action="_FO_diagRefresh">🔄 Atualizar</button>
            <button class="btn btn-cinza btn-sm" data-action="_FO_diagDownload">📥 Exportar Logs</button>
            <button class="btn btn-vermelho btn-sm" data-action="_FO_diagClear">🗑️ Limpar Logs</button>
          </div>
        </div>

        <!-- KPIs de saúde -->
        <div id="diag-kpis" style="display:grid;grid-template-columns:repeat(auto-fill,minmax(130px,1fr));gap:10px;margin-bottom:16px">
          ${this._renderKPIs()}
        </div>

        <!-- Tabela de módulos -->
        <div class="card" style="margin:0 0 14px">
          <div class="titulo-secao">📦 Módulos do Sistema</div>
          <div class="tabela-wrap">
            <table>
              <thead>
                <tr>
                  <th>Módulo</th>
                  <th class="td-c" style="width:110px">Status</th>
                  <th class="td-c" style="width:110px">Boundary</th>
                  <th class="td-c" style="width:80px">Erros</th>
                  <th class="td-c" style="width:80px">Restarts</th>
                  <th style="width:160px">Carregado em</th>
                  <th class="td-c" style="width:160px">Ações</th>
                </tr>
              </thead>
              <tbody id="diag-modules-tbody">
                ${this._renderModuleRows()}
              </tbody>
            </table>
          </div>
        </div>

        <!-- Circuit Breakers -->
        <div class="card" style="margin:0 0 14px">
          <div class="titulo-secao">⚡ Circuit Breakers</div>
          <div id="diag-cb-grid" style="display:grid;grid-template-columns:repeat(auto-fill,minmax(240px,1fr));gap:10px">
            ${this._renderCircuitBreakers()}
          </div>
        </div>

        <!-- Log ao vivo -->
        <div class="card" style="margin:0">
          <div style="display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:8px;margin-bottom:10px">
            <div class="titulo-secao" style="margin:0;border:none;padding:0">📋 Log em Tempo Real</div>
            <div style="display:flex;gap:6px;align-items:center">
              <select id="diag-log-level" style="font-size:11px;padding:3px 6px;width:auto"
                onchange="window._FO_diag?.setLogLevel(this.value)">
                <option value="0">DEBUG (tudo)</option>
                <option value="1" selected>INFO+</option>
                <option value="2">WARN+</option>
                <option value="3">ERROR+</option>
              </select>
              <label style="font-size:11px;color:var(--text-muted);display:flex;align-items:center;gap:4px;cursor:pointer">
                <input type="checkbox" id="diag-log-autoscroll" checked style="cursor:pointer"> Auto-scroll
              </label>
            </div>
          </div>
          <div id="diag-log-container"
            style="background:#0d111a;border-radius:6px;padding:10px;font-family:monospace;font-size:11px;height:320px;overflow-y:auto;line-height:1.7">
            <div style="color:#4b5563">(aguardando entradas de log...)</div>
          </div>
        </div>

      </div>`;
  }

  // ── Sub-renders ────────────────────────────────────────────────────────────
  _renderKPIs() {
    const all       = moduleLoader.getAllStatuses();
    const entries   = Object.values(all);
    const active    = entries.filter(m => m.status === MODULE_STATUS.ACTIVE).length;
    const failed    = entries.filter(m => m.status === MODULE_STATUS.FAILED).length;
    const disabled  = entries.filter(m => m.status === MODULE_STATUS.DISABLED).length;
    const loading   = entries.filter(m => m.status === MODULE_STATUS.LOADING || m.status === MODULE_STATUS.INITIALIZING).length;
    const total     = entries.length;
    const pct       = Math.round((active / total) * 100);

    return [
      { label: 'Módulos Ativos',    value: active,   color: '#22c55e', icon: '✅' },
      { label: 'Com Falha',         value: failed,   color: failed   > 0 ? '#dc2626' : '#6b7280', icon: '❌' },
      { label: 'Desativados',       value: disabled, color: disabled > 0 ? '#d97706' : '#6b7280', icon: '🔒' },
      { label: 'Carregando',        value: loading,  color: '#3b82f6', icon: '⏳' },
      { label: 'Saúde do Sistema',  value: pct+'%',  color: pct >= 80 ? '#22c55e' : pct >= 50 ? '#d97706' : '#dc2626', icon: '🏥' },
    ].map(k => `
      <div style="background:var(--bg-card,#1e2330);border:1px solid var(--border,#2d3748);border-radius:8px;padding:12px 14px">
        <div style="font-size:18px;margin-bottom:4px">${k.icon}</div>
        <div style="font-size:22px;font-weight:800;color:${k.color}">${k.value}</div>
        <div style="font-size:10px;color:var(--text-muted,#9ca3af);margin-top:2px">${k.label}</div>
      </div>`).join('');
  }

  _renderModuleRows() {
    const statuses   = moduleLoader.getAllStatuses();
    const boundaries = getAllBoundarySnapshots();

    return Object.entries(statuses).map(([id, m]) => {
      const b    = boundaries[id] || boundaries[m.pageId] || null;
      const st   = m.status;
      const sColor = {
        active:      '#22c55e',
        failed:      '#dc2626',
        disabled:    '#6b7280',
        loading:     '#3b82f6',
        initializing:'#3b82f6',
        restarting:  '#d97706',
        degraded:    '#d97706',
        pending:     '#4b5563',
      }[st] || '#9ca3af';

      const bStatus = b?.status || '—';
      const bColor  = {
        healthy:  '#22c55e',
        degraded: '#d97706',
        failed:   '#dc2626',
      }[bStatus] || '#6b7280';

      const loadedAt = m.loadedAt ? new Date(m.loadedAt).toLocaleTimeString('pt-BR') : '—';

      return `
        <tr>
          <td>
            <code style="font-size:11px;color:var(--text-primary,#f1f5f9)">${id}</code>
            ${m.errors?.length ? `<span style="font-size:9px;color:#ef4444;margin-left:4px">${m.errors.length} erro(s)</span>` : ''}
          </td>
          <td class="td-c">
            <span style="display:inline-flex;align-items:center;gap:4px;font-size:11px;font-weight:700;color:${sColor}">
              <span style="width:6px;height:6px;border-radius:50%;background:${sColor};flex-shrink:0"></span>
              ${st}
            </span>
          </td>
          <td class="td-c">
            <span style="font-size:11px;font-weight:600;color:${bColor}">${bStatus}</span>
          </td>
          <td class="td-c" style="font-size:11px;color:${(b?.errorCount||0) > 0 ? '#d97706' : 'var(--text-muted)'}">
            ${b?.errorCount ?? 0}
          </td>
          <td class="td-c" style="font-size:11px;color:var(--text-muted)">${m.restarts ?? 0}</td>
          <td style="font-size:11px;color:var(--text-muted)">${loadedAt}</td>
          <td class="td-c">
            <div style="display:flex;gap:4px;justify-content:center">
              ${st !== 'active' ? `
                <button class="btn btn-cinza" style="font-size:10px;padding:2px 8px"
                  data-action="_FO_reloadModule" data-arg0="${id}" >🔄</button>` : ''}
              ${st !== 'disabled' ? `
                <button class="btn btn-vermelho" style="font-size:10px;padding:2px 8px"
                  data-action="if" data-arg0="confirm('Desativar ${id}?'))window._FO_disableModule?.('${id}'">🔒</button>` : ''}
              <button class="btn btn-cinza" style="font-size:10px;padding:2px 8px"
                data-action="_FO_reportModule" data-arg0="${id}" >📋</button>
            </div>
          </td>
        </tr>`;
    }).join('');
  }

  _renderCircuitBreakers() {
    const breakers = [...(moduleMonitor._breakers?.values() || [])];
    if (breakers.length === 0) {
      return `<div style="color:var(--text-muted);font-size:12px;padding:8px">Nenhum circuit breaker ativado ainda.</div>`;
    }
    return breakers.map(b => {
      const data   = b.toJSON?.() || b;
      const isOpen = data.state === 'open';
      const isHalf = data.state === 'half_open';
      const color  = isOpen ? '#dc2626' : isHalf ? '#d97706' : '#22c55e';
      const label  = isOpen ? '🔴 ABERTO' : isHalf ? '🟡 HALF-OPEN' : '🟢 FECHADO';
      return `
        <div style="background:var(--bg-card,#1e2330);border:1px solid ${color}33;border-left:3px solid ${color};border-radius:6px;padding:10px 12px">
          <div style="font-size:11px;font-weight:700;color:var(--text-primary,#f1f5f9);margin-bottom:6px;font-family:monospace">${data.moduleId}</div>
          <div style="font-size:12px;font-weight:800;color:${color};margin-bottom:4px">${label}</div>
          <div style="font-size:10px;color:var(--text-muted,#9ca3af)">Falhas (janela): <b style="color:var(--text-primary)">${data.failures}</b></div>
          <div style="font-size:10px;color:var(--text-muted)">Tentativas: <b style="color:var(--text-primary)">${data.attempts}</b></div>
          ${data.lastFailure ? `<div style="font-size:10px;color:var(--text-muted)">Última falha: ${new Date(data.lastFailure).toLocaleTimeString('pt-BR')}</div>` : ''}
        </div>`;
    }).join('');
  }

  // ── Log ao vivo ─────────────────────────────────────────────────────────────
  _startLiveLog() {
    const LEVEL_COLORS = { 0:'#6b7280', 1:'#60a5fa', 2:'#fbbf24', 3:'#f87171', 4:'#c084fc' };
    const LEVEL_LABELS = { 0:'DEBUG', 1:'INFO', 2:'WARN', 3:'ERROR', 4:'CRIT' };

    // Carrega buffer existente
    const existing = logger.tail(60);
    this._logBuffer = existing;
    this._refreshLogView();

    // Subscreve novas entradas
    this._logUnsub = logger.onLog(entry => {
      const minLevel = parseInt(document.getElementById('diag-log-level')?.value ?? '1');
      if (entry.level < minLevel) return;

      this._logBuffer.push(entry);
      if (this._logBuffer.length > 80) this._logBuffer.shift();

      const container = document.getElementById('diag-log-container');
      if (!container) return;

      const line = document.createElement('div');
      line.style.cssText = `display:flex;gap:6px;padding:1px 0;border-bottom:1px solid #ffffff08`;
      line.innerHTML = `
        <span style="color:#4b5563;flex-shrink:0">${entry.time}</span>
        <span style="color:${LEVEL_COLORS[entry.level]||'#9ca3af'};width:42px;flex-shrink:0;font-weight:700">${LEVEL_LABELS[entry.level]||'??'}</span>
        <span style="color:#818cf8;flex-shrink:0;max-width:140px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap" title="${entry.source}">[${entry.source}]</span>
        <span style="color:${LEVEL_COLORS[entry.level]||'#e2e8f0'};flex:1;word-break:break-word">${this._esc(entry.message)}</span>
      `;
      container.appendChild(line);

      const autoScroll = document.getElementById('diag-log-autoscroll')?.checked !== false;
      if (autoScroll) container.scrollTop = container.scrollHeight;

      // Mantém máximo de 80 linhas no DOM
      while (container.children.length > 80) container.removeChild(container.firstChild);
    });
  }

  _refreshLogView() {
    const container = document.getElementById('diag-log-container');
    if (!container) return;
    const minLevel  = parseInt(document.getElementById('diag-log-level')?.value ?? '1');
    const COLORS    = { 0:'#6b7280', 1:'#60a5fa', 2:'#fbbf24', 3:'#f87171', 4:'#c084fc' };
    const LABELS    = { 0:'DEBUG', 1:'INFO', 2:'WARN', 3:'ERROR', 4:'CRIT' };

    container.innerHTML = this._logBuffer
      .filter(e => e.level >= minLevel)
      .map(e => `
        <div style="display:flex;gap:6px;padding:1px 0;border-bottom:1px solid #ffffff08">
          <span style="color:#4b5563;flex-shrink:0">${e.time}</span>
          <span style="color:${COLORS[e.level]||'#9ca3af'};width:42px;flex-shrink:0;font-weight:700">${LABELS[e.level]||'??'}</span>
          <span style="color:#818cf8;flex-shrink:0;max-width:140px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap" title="${e.source}">[${e.source}]</span>
          <span style="color:${COLORS[e.level]||'#e2e8f0'};flex:1;word-break:break-word">${this._esc(e.message)}</span>
        </div>`).join('') || `<div style="color:#4b5563">(sem entradas neste nível)</div>`;

    container.scrollTop = container.scrollHeight;
  }

  _stopLiveLog() {
    if (this._logUnsub) { this._logUnsub(); this._logUnsub = null; }
  }

  // ── Auto-refresh ──────────────────────────────────────────────────────────
  _startAutoRefresh() {
    this._refreshTimer = setInterval(() => this._refreshTables(), 5000);
  }

  _stopAutoRefresh() {
    if (this._refreshTimer) { clearInterval(this._refreshTimer); this._refreshTimer = null; }
  }

  _refreshTables() {
    const kpisEl   = document.getElementById('diag-kpis');
    const tbodyEl  = document.getElementById('diag-modules-tbody');
    const cbEl     = document.getElementById('diag-cb-grid');
    if (kpisEl)  kpisEl.innerHTML  = this._renderKPIs();
    if (tbodyEl) tbodyEl.innerHTML = this._renderModuleRows();
    if (cbEl)    cbEl.innerHTML    = this._renderCircuitBreakers();
  }

  // ── API pública / callbacks da UI ─────────────────────────────────────────
  refresh()       { this._render(); this._startLiveLog(); }
  setLogLevel(_)  { this._refreshLogView(); }

  downloadLogs() {
    const text = logger.exportText(0);
    const blob = new Blob([text], { type: 'text/plain' });
    const url  = URL.createObjectURL(blob);
    const a    = document.createElement('a');
    a.href     = url;
    a.download = `fiscal-na-obra-logs-${new Date().toISOString().slice(0,10)}.txt`;
    a.click();
    URL.revokeObjectURL(url);
  }

  clearLogs() {
    logger.clearPersisted();
    const container = document.getElementById('diag-log-container');
    if (container) container.innerHTML = '<div style="color:#4b5563">(logs limpos)</div>';
  }

  _esc(str) {
    return String(str||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
  }

  _exposeGlobals() {
    window._FO_diag = this;
  }
}

export default DiagnosticoModule;
