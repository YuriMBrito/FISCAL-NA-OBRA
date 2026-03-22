/**
 * ╔══════════════════════════════════════════════════════════════╗
 * ║  FISCAL NA OBRA — modules/etapas-pac/etapas-pac-controller.js ║
 * ║  Controle de marcos físicos por etapa (Novo PAC / CEF)      ║
 * ╚══════════════════════════════════════════════════════════════╝
 *
 * Gerencia as etapas físicas exigidas pelo Novo PAC para liberação
 * de parcelas. Cada etapa tem:
 *   - Percentual mínimo de execução para liberação
 *   - Status: pendente / em_andamento / concluida / reprovada
 *   - Evidências (link para fotos, laudos, BM correspondente)
 *   - Data de vistoria e responsável
 */

import EventBus        from '../../core/EventBus.js';
import { bindActions } from '../../utils/actions.js';
import state           from '../../core/state.js';
import router          from '../../core/router.js';
import FirebaseService from '../../firebase/firebase-service.js';

const hoje  = () => new Date().toISOString().slice(0, 10);
const fmtBR = iso => iso ? new Date(iso + 'T12:00:00').toLocaleDateString('pt-BR') : '—';
const fmt   = v   => (v || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });

// Etapas padrão para UBS Novo PAC (adaptáveis pelo fiscal)
const ETAPAS_PADRAO_UBS = [
  { num: 1, label: '1ª Parcela — Fundação',            pctMinimo: 10, descricao: 'Serviços preliminares, terraplanagem e fundações concluídas.' },
  { num: 2, label: '2ª Parcela — Estrutura',           pctMinimo: 25, descricao: 'Estrutura (pilares, vigas, lajes) e alvenaria de fechamento.' },
  { num: 3, label: '3ª Parcela — Cobertura',           pctMinimo: 45, descricao: 'Cobertura, instalações hidráulicas e elétricas.' },
  { num: 4, label: '4ª Parcela — Revestimento',        pctMinimo: 65, descricao: 'Revestimentos internos e externos, esquadrias.' },
  { num: 5, label: '5ª Parcela — Acabamentos',         pctMinimo: 85, descricao: 'Acabamentos, louças, metais e pinturas.' },
  { num: 6, label: '6ª Parcela — Recebimento Final',   pctMinimo: 100, descricao: 'Obra concluída, recebida e habite-se emitido.' },
];

const STATUS_CONFIG = {
  pendente:     { label: 'Pendente',      cor: 'var(--text-muted)', bg: 'var(--bg-surface)' },
  em_andamento: { label: 'Em andamento',  cor: 'var(--color-warning, #f59e0b)', bg: 'var(--color-warning-bg, #fefce8)' },
  concluida:    { label: 'Concluída',     cor: 'var(--color-success, #22c55e)', bg: 'var(--color-success-bg, #dcfce7)' },
  reprovada:    { label: 'Reprovada',     cor: 'var(--color-danger, #ef4444)', bg: 'var(--color-danger-bg, #fee2e2)' },
};

export class EtapasPacModule {
  constructor() {
    this._subs          = [];
    this._etapas        = [];
    this._editId        = null;
    this._unbindActions = null; // FIX-E4.1
  }

  async init()    { this._bindEvents(); this._exposeGlobals(); }
  async onEnter() { await this._carregar(); this._render(); }

  async _carregar() {
    const obraId = state.get('obraAtivaId');
    if (!obraId) { this._etapas = []; return; }
    try {
      // FIX-E2.3: usar cache do state para evitar re-fetch ao trocar de aba
      const estadoCache = state.get('etapasPac');
      if (estadoCache && estadoCache.length > 0) {
        this._etapas = estadoCache;
        return;
      }
      const etapasCarregadas = await FirebaseService.getEtapasPac(obraId);
      if (etapasCarregadas?.length > 0) {
        this._etapas = etapasCarregadas;
        state.set('etapasPac', this._etapas); // sincroniza state
      } else {
        // Inicializar com etapas padrão UBS
        this._etapas = ETAPAS_PADRAO_UBS.map(e => ({
          ...e,
          id:           `ep_${e.num}`,
          status:       'pendente',
          pctRealizado: 0,
          dataVistoria: '',
          fiscal:       '',
          bmVinculado:  '',
          obs:          '',
          evidencias:   [],
          valorParcela: 0,
        }));
      }
    } catch { this._etapas = []; }
  }

  async _salvar() {
    const obraId = state.get('obraAtivaId');
    if (!obraId) return;
    await FirebaseService.salvarEtapasPac(obraId, this._etapas);
    state.set('etapasPac', this._etapas); // FIX-E2.3: manter state sincronizado
  }

  _render() {
    const el = document.getElementById('etapas-pac-conteudo');
    if (!el) return;
    const obraId = state.get('obraAtivaId');

    if (!obraId) {
      el.innerHTML = '<div style="text-align:center;padding:40px;color:var(--text-muted);font-size:13px">Selecione uma obra para gerenciar etapas PAC.</div>';
      return;
    }

    const cfg        = state.get('cfg') || {};
    const valorTotal = parseFloat(cfg.valor) || 0;
    const kpis       = this._calcKpis();

    this._unbindActions?.();
    el.innerHTML = `
      <!-- Header com valor e progresso geral -->
      <div style="background:var(--bg-surface);border:1px solid var(--border);border-radius:10px;padding:16px;margin-bottom:16px">
        <div style="display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:10px;margin-bottom:10px">
          <div>
            <div style="font-size:13px;font-weight:700;color:var(--text-primary)">Avanço Físico Global</div>
            <div style="font-size:11px;color:var(--text-muted)">${kpis.concluidas} de ${this._etapas.length} etapas concluídas</div>
          </div>
          <div style="text-align:right">
            <div style="font-size:20px;font-weight:800;color:var(--accent)">${kpis.pctGlobal}%</div>
            <div style="font-size:11px;color:var(--text-muted)">execução física</div>
          </div>
        </div>
        <!-- Barra de progresso por etapas -->
        <div style="display:flex;gap:2px;height:12px;border-radius:6px;overflow:hidden;background:var(--bg-card)">
          ${this._etapas.map(e => {
            const s = STATUS_CONFIG[e.status] || STATUS_CONFIG.pendente;
            const w = (100 / this._etapas.length).toFixed(1);
            return `<div style="flex:1;background:${e.status==='concluida'?'var(--color-success, #22c55e)':e.status==='reprovada'?'var(--color-danger, #ef4444)':e.status==='em_andamento'?'var(--color-warning, #f59e0b)':'var(--border)'}" title="${e.label}"></div>`;
          }).join('')}
        </div>
        <div style="display:flex;justify-content:space-between;font-size:9px;color:var(--text-muted);margin-top:4px">
          <span>Início</span><span>Conclusão</span>
        </div>
      </div>

      <!-- KPIs -->
      <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(110px,1fr));gap:10px;margin-bottom:16px">
        ${this._kpi('Concluídas', kpis.concluidas, 'var(--color-success, #22c55e)')}
        ${this._kpi('Em andamento', kpis.emAndamento, 'var(--color-warning, #f59e0b)')}
        ${this._kpi('Pendentes', kpis.pendentes, 'var(--text-muted)')}
        ${this._kpi('Reprovadas', kpis.reprovadas, 'var(--color-danger, #ef4444)')}
      </div>

      <!-- Lista de etapas -->
      <div style="display:flex;flex-direction:column;gap:10px">
        ${this._etapas.map(e => this._cardEtapa(e)).join('')}
      </div>

      <!-- Modal overlay -- o bind de abrir é feito após el.innerHTML -->
      <div id="ep-overlay"
        style="display:none;position:fixed;inset:0;background:rgba(0,0,0,.6);z-index:1000;overflow-y:auto;padding:20px;box-sizing:border-box">
        <div id="ep-modal" style="background:var(--bg-card);border:1px solid var(--border);border-radius:14px;padding:24px;
          width:min(100%,560px);margin:auto;box-shadow:0 20px 60px rgba(0,0,0,.45)"></div>
      </div>
    `;
  }

  _calcKpis() {
    const es = this._etapas;
    const pcts = es.filter(e => e.status === 'concluida').length;
    const pctG = es.length > 0
      ? Math.round(es.reduce((s, e) => s + (e.pctRealizado || 0), 0) / es.length)
      : 0;
    return {
      concluidas:  es.filter(e => e.status === 'concluida').length,
      emAndamento: es.filter(e => e.status === 'em_andamento').length,
      pendentes:   es.filter(e => e.status === 'pendente').length,
      reprovadas:  es.filter(e => e.status === 'reprovada').length,
      pctGlobal:   pctG,
    };
  }

  _kpi(label, valor, cor) {
    return `<div style="background:var(--bg-surface);border:1px solid var(--border);border-radius:8px;padding:12px;text-align:center">
      <div style="font-size:9px;font-weight:700;color:var(--text-muted);text-transform:uppercase;letter-spacing:.5px;margin-bottom:5px">${label}</div>
      <div style="font-size:20px;font-weight:800;color:${cor}">${valor}</div>
    </div>`;
  }

  _cardEtapa(e) {
    const st  = STATUS_CONFIG[e.status] || STATUS_CONFIG.pendente;
    const pct = e.pctRealizado || 0;
    const ok  = pct >= e.pctMinimo;

    return `
      <div style="background:var(--bg-surface);border:1px solid var(--border);border-radius:10px;padding:16px;
        border-left:4px solid ${st.cor}">
        <div style="display:flex;align-items:flex-start;justify-content:space-between;gap:10px;flex-wrap:wrap">
          <div style="flex:1;min-width:0">
            <div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap;margin-bottom:6px">
              <span style="font-size:13px;font-weight:700;color:var(--text-primary)">${e.label}</span>
              <span style="font-size:10px;padding:2px 8px;border-radius:10px;font-weight:700;background:${st.cor}22;color:${st.cor}">${st.label}</span>
              ${e.valorParcela > 0 ? `<span style="font-size:10px;color:var(--text-muted)">${fmt(e.valorParcela)}</span>` : ''}
            </div>
            <div style="font-size:12px;color:var(--text-muted);margin-bottom:10px">${e.descricao || ''}</div>

            <!-- Barra de progresso da etapa -->
            <div style="display:flex;align-items:center;gap:8px;margin-bottom:8px">
              <div style="flex:1;background:var(--bg-card);border-radius:4px;height:8px;overflow:hidden">
                <div style="height:100%;width:${Math.min(pct,100)}%;background:${pct>=e.pctMinimo?'var(--color-success, #22c55e)':'var(--color-warning, #f59e0b)'};border-radius:4px;transition:width .3s"></div>
              </div>
              <span style="font-size:12px;font-weight:700;color:${ok?'var(--color-success, #22c55e)':'var(--color-warning, #f59e0b)'};min-width:40px">${pct}%</span>
              <span style="font-size:10px;color:var(--text-muted)">(mín: ${e.pctMinimo}%)</span>
            </div>

            <div style="display:flex;gap:12px;font-size:11px;color:var(--text-muted);flex-wrap:wrap">
              ${e.dataVistoria ? `📅 Vistoria: ${fmtBR(e.dataVistoria)}` : ''}
              ${e.fiscal ? `&nbsp;|&nbsp; 👤 ${e.fiscal}` : ''}
              ${e.bmVinculado ? `&nbsp;|&nbsp; 📋 ${e.bmVinculado}` : ''}
            </div>
          </div>
          <div style="display:flex;gap:6px;flex-shrink:0">
            <button data-action="abrir" data-id="${e.id}"
              style="padding:7px 14px;font-size:11px;background:var(--accent);border:none;border-radius:7px;color:#fff;cursor:pointer;font-weight:700">
              ✏️ Registrar
            </button>
          </div>
        </div>
      </div>
    `;
  }

  _abrirModal(id) {
    const overlay = document.getElementById('ep-overlay');
    const modal   = document.getElementById('ep-modal');
    if (!overlay || !modal) { this._render(); setTimeout(() => this._abrirModal(id), 60); return; }

    const e   = this._etapas.find(x => x.id === id);
    if (!e) return;
    this._editId = id;
    const bms = state.get('bms') || [];

    modal.innerHTML = `
      <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:18px">
        <h3 style="margin:0;font-size:15px;font-weight:800;color:var(--text-primary)">${e.label}</h3>
        <button data-action="fechar" style="background:none;border:none;cursor:pointer;font-size:18px;color:var(--text-muted)">✕</button>
      </div>
      <div style="display:grid;gap:12px">

        <!-- Status -->
        <div>
          <label style="font-size:11px;font-weight:700;color:var(--text-muted);display:block;margin-bottom:4px">Status</label>
          <select id="ep-status" style="width:100%;padding:8px;border-radius:7px;border:1px solid var(--border);background:var(--bg-surface);color:var(--text-primary);font-size:12px;box-sizing:border-box">
            ${Object.entries(STATUS_CONFIG).map(([k,v]) => `<option value="${k}" ${e.status===k?'selected':''}>${v.label}</option>`).join('')}
          </select>
        </div>

        <!-- Percentual realizado -->
        <div>
          <label style="font-size:11px;font-weight:700;color:var(--text-muted);display:block;margin-bottom:4px">
            % Realizado (mínimo para liberação: ${e.pctMinimo}%)
          </label>
          <input type="number" id="ep-pct" min="0" max="100" value="${e.pctRealizado||0}"
            style="width:100%;padding:8px;border-radius:7px;border:1px solid var(--border);background:var(--bg-surface);color:var(--text-primary);font-size:12px;box-sizing:border-box">
        </div>

        <!-- Data da vistoria + Fiscal -->
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px">
          <div>
            <label style="font-size:11px;font-weight:700;color:var(--text-muted);display:block;margin-bottom:4px">Data da Vistoria</label>
            <input type="date" id="ep-data" value="${e.dataVistoria||hoje()}"
              style="width:100%;padding:8px;border-radius:7px;border:1px solid var(--border);background:var(--bg-surface);color:var(--text-primary);font-size:12px;box-sizing:border-box">
          </div>
          <div>
            <label style="font-size:11px;font-weight:700;color:var(--text-muted);display:block;margin-bottom:4px">Fiscal Responsável</label>
            <input type="text" id="ep-fiscal" value="${e.fiscal||''}" placeholder="Nome do fiscal"
              style="width:100%;padding:8px;border-radius:7px;border:1px solid var(--border);background:var(--bg-surface);color:var(--text-primary);font-size:12px;box-sizing:border-box">
          </div>
        </div>

        <!-- BM vinculado -->
        <div>
          <label style="font-size:11px;font-weight:700;color:var(--text-muted);display:block;margin-bottom:4px">BM Correspondente</label>
          <select id="ep-bm" style="width:100%;padding:8px;border-radius:7px;border:1px solid var(--border);background:var(--bg-surface);color:var(--text-primary);font-size:12px;box-sizing:border-box">
            <option value="">Nenhum</option>
            ${bms.map(b => `<option value="${b.label}" ${e.bmVinculado===b.label?'selected':''}>${b.label}</option>`).join('')}
          </select>
        </div>

        <!-- Valor da parcela -->
        <div>
          <label style="font-size:11px;font-weight:700;color:var(--text-muted);display:block;margin-bottom:4px">Valor da Parcela (R$)</label>
          <input type="number" id="ep-valor" min="0" step="0.01" value="${e.valorParcela||0}"
            style="width:100%;padding:8px;border-radius:7px;border:1px solid var(--border);background:var(--bg-surface);color:var(--text-primary);font-size:12px;box-sizing:border-box">
        </div>

        <!-- Observações -->
        <div>
          <label style="font-size:11px;font-weight:700;color:var(--text-muted);display:block;margin-bottom:4px">Observações / Pendências</label>
          <textarea id="ep-obs" rows="3" placeholder="Registre pendências, condicionantes ou ressalvas da vistoria..."
            style="width:100%;padding:8px;border-radius:7px;border:1px solid var(--border);background:var(--bg-surface);color:var(--text-primary);font-size:12px;resize:vertical;box-sizing:border-box">${e.obs||''}</textarea>
        </div>
      </div>

      <div style="display:flex;gap:8px;justify-content:flex-end;margin-top:20px">
        <button data-action="fechar"
          style="padding:9px 18px;background:var(--bg-surface);border:1px solid var(--border);border-radius:8px;font-size:12px;font-weight:700;cursor:pointer;color:var(--text-primary)">
          Cancelar
        </button>
        <button data-action="salvar"
          style="padding:9px 18px;background:var(--accent);border:none;border-radius:8px;color:#fff;font-size:12px;font-weight:700;cursor:pointer">
          💾 Salvar Etapa
        </button>
      </div>
    `;

    overlay.style.display = 'block';
    // FIX-E4.1: bind delegado no modal
    this._unbindActions?.();
    this._unbindActions = bindActions(modal, {
      fechar: () => this._fecharModal(),
      salvar: () => {
        const btn = modal.querySelector('[data-action="salvar"]');
        import('../../utils/loading.js').then(({ withLoading }) => {
          withLoading(btn, () => this._salvarModal(), { labelLoading: 'Salvando...', labelDone: 'Salvo!' })
            .catch(e => window.toast?.('❌ Erro ao salvar: ' + e.message, 'error'));
        });
      },
    });
  }

  _fecharModal() {
    const overlay = document.getElementById('ep-overlay');
    if (overlay) overlay.style.display = 'none';
    this._editId = null;
  }

  async _salvarModal() {
    const g = id => document.getElementById(id);
    const e = this._etapas.find(x => x.id === this._editId);
    if (!e) return;

    e.status       = g('ep-status')?.value  || 'pendente';
    e.pctRealizado = parseFloat(g('ep-pct')?.value)   || 0;
    e.dataVistoria = g('ep-data')?.value    || '';
    e.fiscal       = g('ep-fiscal')?.value?.trim() || '';
    e.bmVinculado  = g('ep-bm')?.value     || '';
    e.valorParcela = parseFloat(g('ep-valor')?.value) || 0;
    e.obs          = g('ep-obs')?.value?.trim() || '';

    try {
      await this._salvar();
      window.toast?.('✅ Etapa salva!', 'ok');
      this._fecharModal();
      this._render();
    } catch (err) {
      window.toast?.('❌ Erro ao salvar: ' + err.message, 'error');
    }
  }

  _bindEvents() {
    this._subs.push(EventBus.on('obra:selecionada', async () => {
      try { await this._carregar(); if (router.current === 'etapas-pac') this._render(); }
      catch (e) {}
    }, 'etapas-pac'));
  }

  _exposeGlobals() {
    window._ep_abrirEtapa  = id => this._abrirModal(id);
    window._ep_fecharModal = ()  => this._fecharModal();
    window._ep_salvar      = () => {
      // FIX-E3.2: protege contra duplo clique em salvar etapa
      const btn = document.querySelector('[data-action="_ep_salvar"]');
      import('../../utils/loading.js').then(({ withLoading }) => {
        withLoading(btn, () => this._salvarModal(), {
          labelLoading: 'Salvando etapa...',
          labelDone: 'Salvo!',
        }).catch(e => window.toast?.('❌ Erro ao salvar: ' + e.message, 'error'));
      });
    };
  }

  destroy() { this._subs.forEach(u => u()); this._subs = []; this._unbindActions?.(); }
}
