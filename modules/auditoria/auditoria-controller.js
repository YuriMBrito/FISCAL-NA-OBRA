/**
 * ╔══════════════════════════════════════════════════════════════╗
 * ║  FISCAL NA OBRA v15.1 — modules/auditoria/auditoria-controller.js
 * ║                                                              ║
 * ║  MELHORIAS v15.1:                                            ║
 * ║   - registrar() aceita valorAntes/valorDepois (diff TCU)    ║
 * ║   - registrarEdicao() helper para diff automático           ║
 * ║   - CSV exporta colunas Valor Antes e Valor Depois          ║
 * ║   - Tabela exibe diff visual com tachado/verde              ║
 * ║   - auditRegistrarEdicao() exposto globalmente             ║
 * ╚══════════════════════════════════════════════════════════════╝
 */

import state          from '../../core/state.js';
import FirebaseService from '../../firebase/firebase-service.js';

const MAX_LOG_MEMORIA = 500;
const esc = s => String(s || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');

export class AuditoriaModule {
  constructor() {
    this._log  = [];
    this._subs = [];
  }

  async init() {
    try { this._exposeGlobals(); }
    catch(e) { console.error('[AuditoriaModule] init:', e); }
  }

  /**
   * Registra uma entrada de auditoria.
   * @param {string}  p.modulo
   * @param {string}  p.tipo       — 'criação'|'edição'|'exclusão'|'exportação'|'importação'|'salvo'
   * @param {string}  p.registro   — identificador do objeto afetado
   * @param {string}  [p.detalhe]
   * @param {*}       [p.valorAntes]  — valor anterior (diff para TCU/CGU)
   * @param {*}       [p.valorDepois] — valor posterior (diff para TCU/CGU)
   */
  registrar({ modulo, tipo, registro = '', detalhe = '', valorAntes, valorDepois } = {}) {
    try {
      const cfg          = state.get('cfg') || {};
      const obraId       = state.get('obraAtivaId') || '—';
      const agora        = new Date();
      const userLogado   = state.get('usuarioLogado') || {};
      const usuarioUid   = userLogado.uid          || 'offline';
      const usuarioEmail = userLogado.email         || '';
      const usuarioNome  = userLogado.displayName   || cfg.fiscal || 'Usuário';

      const entrada = {
        id:           `aud_${Date.now()}_${Math.random().toString(36).slice(2,6)}`,
        usuario:      usuarioNome,
        usuarioUid,
        usuarioEmail,
        data:         agora.toLocaleDateString('pt-BR'),
        hora:         agora.toLocaleTimeString('pt-BR'),
        iso:          agora.toISOString(),
        modulo:       modulo   || '—',
        tipo:         tipo     || '—',
        registro:     registro || '—',
        detalhe:      detalhe  || '',
        obraId,
        obra:         cfg.objeto || cfg.contrato || obraId,
        // v15.1 — diff antes/depois (exigência TCU/CGU para rastreabilidade)
        ...(valorAntes  !== undefined && { valorAntes:  this._serializarValor(valorAntes)  }),
        ...(valorDepois !== undefined && { valorDepois: this._serializarValor(valorDepois) }),
      };

      this._log.push(entrada);
      if (this._log.length > MAX_LOG_MEMORIA)
        this._log = this._log.slice(-MAX_LOG_MEMORIA);

      FirebaseService.registrarAuditoria(obraId, entrada).catch(() => {});
    } catch(e) {
      console.warn('[AuditoriaModule] registrar:', e);
    }
  }

  /**
   * Registra edição com diff automático campo a campo.
   * Compara antes e depois e registra apenas os campos alterados.
   *
   * @example
   *   auditRegistrarEdicao({
   *     modulo: 'Aditivos', registro: 'Aditivo 02',
   *     antes:  { valorTotal: 100000, prazo: '2024-12-31' },
   *     depois: { valorTotal: 125000, prazo: '2025-03-31' },
   *   });
   */
  registrarEdicao({ modulo, registro, antes = {}, depois = {}, detalhe = '' } = {}) {
    const todosKeys = new Set([...Object.keys(antes), ...Object.keys(depois)]);
    const camposAlterados = [];

    for (const k of todosKeys) {
      const va = this._serializarValor(antes[k]);
      const vd = this._serializarValor(depois[k]);
      if (va !== vd) camposAlterados.push(k);
    }

    if (camposAlterados.length === 0) return; // nada mudou

    this.registrar({
      modulo,
      tipo: 'edição',
      registro,
      detalhe: detalhe || `Campos alterados: ${camposAlterados.join(', ')}`,
      valorAntes:  Object.fromEntries(camposAlterados.map(k => [k, antes[k]])),
      valorDepois: Object.fromEntries(camposAlterados.map(k => [k, depois[k]])),
    });
  }

  _serializarValor(v) {
    if (v === null || v === undefined) return '';
    if (typeof v === 'object') {
      try { return JSON.stringify(v); } catch { return String(v); }
    }
    return String(v);
  }

  // ── Renderiza o log na tela de Config ─────────────────────────
  async _render() {
    const el = document.getElementById('cfg-audit-log');
    if (!el) return;

    // Se log em memória vazio, busca via API pública
    if (!this._log.length) {
      const obraId = state.get('obraAtivaId');
      if (obraId) {
        // ✅ API pública getAuditoria() — sem _db direto
        this._log = await FirebaseService.getAuditoria(obraId, 100);
      }
    }

    const lista = [...this._log].reverse().slice(0, 100);

    if (!lista.length) {
      el.innerHTML = '<div style="text-align:center;padding:20px;color:var(--text-muted);font-size:12px">Nenhum registro de auditoria.</div>';
      return;
    }

    el.innerHTML = `
      <table style="width:100%;border-collapse:collapse;font-size:11px">
        <thead>
          <tr style="background:var(--bg-card);position:sticky;top:0">
            <th style="padding:6px 8px;text-align:left;color:var(--text-muted);font-weight:700;border-bottom:1px solid var(--border)">Data/Hora</th>
            <th style="padding:6px 8px;text-align:left;color:var(--text-muted);font-weight:700;border-bottom:1px solid var(--border)">Usuário</th>
            <th style="padding:6px 8px;text-align:left;color:var(--text-muted);font-weight:700;border-bottom:1px solid var(--border)">UID</th>
            <th style="padding:6px 8px;text-align:left;color:var(--text-muted);font-weight:700;border-bottom:1px solid var(--border)">Módulo</th>
            <th style="padding:6px 8px;text-align:left;color:var(--text-muted);font-weight:700;border-bottom:1px solid var(--border)">Tipo</th>
            <th style="padding:6px 8px;text-align:left;color:var(--text-muted);font-weight:700;border-bottom:1px solid var(--border)">Registro</th>
            <th style="padding:6px 8px;text-align:left;color:var(--text-muted);font-weight:700;border-bottom:1px solid var(--border)">Detalhe</th>
          </tr>
        </thead>
        <tbody>
          ${lista.map((e, i) => `
            <tr style="background:${i % 2 === 0 ? 'transparent' : 'rgba(255,255,255,.02)'}">
              <td style="padding:5px 8px;color:var(--text-muted);white-space:nowrap">${esc(e.data)} ${esc(e.hora)}</td>
              <td style="padding:5px 8px;color:var(--text-primary);font-weight:600">${esc(e.usuario)}</td>
              <td style="padding:5px 8px;color:var(--text-muted);font-family:monospace;font-size:9px">${esc(e.usuarioUid)}</td>
              <td style="padding:5px 8px;color:#60a5fa">${esc(e.modulo)}</td>
              <td style="padding:5px 8px">${this._badgeTipo(e.tipo)}</td>
              <td style="padding:5px 8px;color:var(--text-muted)">${esc(e.registro)}</td>
              <td style="padding:5px 8px;color:var(--text-muted);max-width:260px">
                ${esc(e.detalhe)}
                ${(e.valorAntes !== undefined || e.valorDepois !== undefined) ? this._renderDiff(e.valorAntes, e.valorDepois) : ''}
              </td>
            </tr>
          `).join('')}
        </tbody>
      </table>
    `;
  }

  _renderDiff(antes, depois) {
    try {
      const a = (antes  && typeof antes  === 'object') ? antes  : (antes  ? { valor: antes  } : {});
      const d = (depois && typeof depois === 'object') ? depois : (depois ? { valor: depois } : {});
      const keys = [...new Set([...Object.keys(a), ...Object.keys(d)])];
      if (!keys.length) return '';
      return '<div style="margin-top:4px;font-size:10px;font-family:monospace;line-height:1.8">' +
        keys.map(k => {
          const va = a[k] !== undefined ? String(a[k]) : '—';
          const vd = d[k] !== undefined ? String(d[k]) : '—';
          if (va === vd) return '';
          return `<div><span style="color:#94a3b8">${esc(k)}: </span>` +
            `<span style="color:#fca5a5;text-decoration:line-through">${esc(va)}</span>` +
            ` <span style="color:#94a3b8">→</span> ` +
            `<span style="color:#86efac">${esc(vd)}</span></div>`;
        }).join('') + '</div>';
    } catch { return ''; }
  }

  _badgeTipo(tipo = '') {
    const map = {
      'criação':    { bg: '#bbf7d0', cor: '#15803d' },
      'edição':     { bg: '#bfdbfe', cor: '#1d4ed8' },
      'exclusão':   { bg: '#fecaca', cor: '#dc2626' },
      'exportação': { bg: '#e9d5ff', cor: '#7c3aed' },
      'importação': { bg: '#fed7aa', cor: '#c2410c' },
      'salvo':      { bg: '#d1fae5', cor: '#059669' },
    };
    const t = (tipo || '').toLowerCase();
    const estilo = map[t] || { bg: '#e2e8f0', cor: '#475569' };
    return `<span style="display:inline-block;padding:2px 7px;border-radius:10px;background:${estilo.bg};color:${estilo.cor};font-weight:700;font-size:10px">${esc(tipo)}</span>`;
  }

  _exportarCSV() {
    try {
      // v15.1: inclui colunas de diff para exportação TCU/CGU
      const headers = ['Data','Hora','Usuário','UID','E-mail','Obra','Módulo','Tipo','Registro','Detalhe','Valor Antes','Valor Depois'];
      const linhas  = this._log.map(e => [
        e.data, e.hora, e.usuario, e.usuarioUid, e.usuarioEmail,
        e.obra, e.modulo, e.tipo, e.registro, e.detalhe,
        e.valorAntes  !== undefined ? this._serializarValor(e.valorAntes)  : '',
        e.valorDepois !== undefined ? this._serializarValor(e.valorDepois) : '',
      ]);
      const csv = [headers, ...linhas]
        .map(row => row.map(c => `"${String(c||'').replace(/"/g,'""')}"`).join(';'))
        .join('\n');

      const blob = new Blob(['\uFEFF' + csv], { type: 'text/csv;charset=utf-8' });
      const url  = URL.createObjectURL(blob);
      const a    = Object.assign(document.createElement('a'), { href: url, download: `auditoria_${new Date().toISOString().slice(0,10)}.csv` });
      document.body.appendChild(a); a.click(); document.body.removeChild(a);
      URL.revokeObjectURL(url);
      window.toast?.('✅ Log de auditoria exportado!', 'ok');
    } catch(e) {
      console.error('[AuditoriaModule] exportarCSV:', e);
      window.toast?.('❌ Erro ao exportar log.', 'error');
    }
  }

  _exposeGlobals() {
    window.auditRegistrar       = (p) => { try { this.registrar(p); }        catch(e) {} };
    // v15.1: expõe registrarEdicao para todos os módulos registrarem diff antes/depois
    window.auditRegistrarEdicao = (p) => { try { this.registrarEdicao(p); }  catch(e) {} };
    window.renderAuditLog       = ()  => { try { this._render().catch(()=>{}); } catch(e) {} };
    window.exportarCSVAudit     = ()  => { try { this._exportarCSV(); }      catch(e) {} };
  }

  onEnter() { try { this._render().catch(()=>{}); } catch(e) {} }
  destroy()  { this._subs.forEach(u => u()); this._subs = []; }
}
