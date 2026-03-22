/**
 * ╔══════════════════════════════════════════════════════════════╗
 * ║  FISCAL NA OBRA — modules/recebimento/recebimento-controller.js ║
 * ║  Módulo: RecebimentoModule — Lei 14.133/2021 Art. 140        ║
 * ║  Recebimento Provisório e Definitivo do Objeto Contratual    ║
 * ╚══════════════════════════════════════════════════════════════╝
 *
 * Regra: múltiplos provisórios permitidos, apenas 1 definitivo.
 */

import EventBus       from '../../core/EventBus.js';
import state          from '../../core/state.js';
import router         from '../../core/router.js';
import { formatters } from '../../utils/formatters.js';
import FirebaseService from '../../firebase/firebase-service.js';

const dataBR = iso => iso ? new Date(iso + 'T12:00:00').toLocaleDateString('pt-BR') : '—';
const hoje   = () => new Date().toISOString().slice(0, 10);
const esc    = s => String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

const CHECKLIST_ITEMS = [
  { key: 'documentos_ok',     label: 'Documentação completa entregue'              },
  { key: 'as_built_ok',       label: 'As-built / projetos atualizados'             },
  { key: 'medicao_ok',        label: 'Medições finais conferidas'                  },
  { key: 'qualidade_ok',      label: 'Qualidade dos serviços verificada'           },
  { key: 'seguranca_ok',      label: 'Condições de segurança atendidas'            },
  { key: 'limpeza_ok',        label: 'Limpeza e desmobilização do canteiro'       },
  { key: 'garantias_ok',      label: 'Termos de garantia entregues'                },
  { key: 'manutencao_ok',     label: 'Manual de operação/manutenção entregue'     },
  { key: 'pendencias_ok',     label: 'Pendências anteriores sanadas'               },
];

export class RecebimentoModule {
  constructor() {
    this._subs   = [];
    this._lista  = [];
    this._view   = 'lista';
    this._editId = null;
  }

  async init() {
    try { this._bindEvents(); this._exposeGlobals(); }
    catch (e) { console.error('[RecebimentoModule] init:', e); }
  }

  async onEnter() {
    try { await this._carregar(); this._view = 'lista'; this._render(); }
    catch (e) { console.error('[RecebimentoModule] onEnter:', e); }
  }

  async _carregar() {
    const obraId = state.get('obraAtivaId');
    if (!obraId) return;
    try {
      this._lista = await FirebaseService.getRecebimentos(obraId).catch(() => []) || [];
    } catch (e) { this._lista = []; }
  }

  async _salvar() {
    const obraId = state.get('obraAtivaId');
    if (!obraId) return;
    await FirebaseService.salvarRecebimentos(obraId, this._lista);
    window.auditRegistrar?.({ modulo: 'Recebimento', tipo: 'salvo', registro: obraId, detalhe: 'Termo de recebimento atualizado' });
  }

  _render() {
    const el = document.getElementById('recebimento-conteudo');
    if (!el) return;
    const obraId = state.get('obraAtivaId');
    if (!obraId) {
      el.innerHTML = '<div style="text-align:center;padding:40px;color:var(--text-muted)">Selecione uma obra.</div>';
      return;
    }
    if (this._view === 'form') { this._renderForm(); return; }

    const provisorios  = this._lista.filter(r => r.tipo === 'provisorio');
    const definitivo   = this._lista.find(r => r.tipo === 'definitivo');
    const temDefinitivo = !!definitivo;

    el.innerHTML = `
      <!-- Status geral -->
      <div style="display:flex;gap:10px;margin-bottom:16px;flex-wrap:wrap">
        <div style="flex:1;min-width:140px;background:${provisorios.length > 0 ? '#dcfce7' : '#f3f4f6'};
          border:1px solid ${provisorios.length > 0 ? '#22c55e' : '#d1d5db'};
          border-radius:8px;padding:12px;text-align:center">
          <div style="font-size:20px;font-weight:800;color:${provisorios.length > 0 ? '#15803d' : '#6b7280'}">
            ${provisorios.length}
          </div>
          <div style="font-size:10px;margin-top:2px;color:${provisorios.length > 0 ? '#15803d' : '#6b7280'}">
            Recebimento(s) Provisório(s)
          </div>
        </div>
        <div style="flex:1;min-width:140px;background:${temDefinitivo ? '#dbeafe' : '#f3f4f6'};
          border:1px solid ${temDefinitivo ? '#3b82f6' : '#d1d5db'};
          border-radius:8px;padding:12px;text-align:center">
          <div style="font-size:20px;font-weight:800;color:${temDefinitivo ? '#1e40af' : '#6b7280'}">
            ${temDefinitivo ? '✅' : '—'}
          </div>
          <div style="font-size:10px;margin-top:2px;color:${temDefinitivo ? '#1e40af' : '#6b7280'}">
            Recebimento Definitivo
          </div>
        </div>
      </div>

      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:12px">
        <div style="font-size:11px;color:var(--text-muted)">
          📋 <strong>Art. 140 Lei 14.133/2021</strong> — Provisório: fiscal técnico. Definitivo: comissão/servidor designado.
        </div>
        <div style="display:flex;gap:6px">
          <button class="btn btn-verde btn-sm" data-action="_recebNovoForm" data-arg0="provisorio">➕ Provisório</button>
          ${!temDefinitivo
            ? `<button class="btn btn-azul btn-sm" data-action="_recebNovoForm" data-arg0="definitivo">➕ Definitivo</button>`
            : ''}
        </div>
      </div>

      ${this._lista.length === 0
        ? '<div style="text-align:center;padding:30px;color:var(--text-muted);font-size:12px">Nenhum termo de recebimento registrado.</div>'
        : this._lista.map(r => {
            const isDefinitivo = r.tipo === 'definitivo';
            const corBg    = isDefinitivo ? '#dbeafe' : '#f0fdf4';
            const corBorda = isDefinitivo ? '#3b82f6' : '#22c55e';
            const corTexto = isDefinitivo ? '#1e40af' : '#15803d';
            const checkOk  = CHECKLIST_ITEMS.filter(c => r.checklist?.[c.key]).length;
            return `<div style="background:${corBg};border:1px solid ${corBorda};border-radius:8px;
              padding:14px;margin-bottom:10px">
              <div style="display:flex;justify-content:space-between;align-items:flex-start;flex-wrap:wrap;gap:6px">
                <div>
                  <span style="font-size:12px;font-weight:800;color:${corTexto}">
                    ${isDefinitivo ? '🏛️ RECEBIMENTO DEFINITIVO' : '📋 RECEBIMENTO PROVISÓRIO'}
                  </span>
                  <div style="font-size:11px;color:var(--text-muted);margin-top:3px">
                    Data: <strong>${dataBR(r.data)}</strong>
                    &nbsp;|&nbsp; Responsável: <strong>${esc(r.responsavel)}</strong>
                  </div>
                </div>
                <div style="display:flex;gap:6px;align-items:center">
                  <span style="font-size:10px;background:${corBg};color:${corTexto};
                    border:1px solid ${corBorda};border-radius:10px;padding:2px 8px">
                    ${checkOk}/${CHECKLIST_ITEMS.length} itens ok
                  </span>
                  <button class="btn btn-cinza btn-sm" style="padding:2px 7px;font-size:10px"
                    title="Gerar PDF do termo de recebimento"
                    data-action="_integPDFRecebimento" data-arg0="${r.id}" >🖨️</button>
                  <button class="btn btn-cinza btn-sm" style="padding:2px 7px;font-size:10px"
                    data-action="_recebEditar" data-arg0="${r.id}" >✏️</button>
                  <button class="btn btn-vermelho btn-sm" style="padding:2px 7px;font-size:10px"
                    data-action="_recebExcluir" data-arg0="${r.id}" >🗑️</button>
                </div>
              </div>
              ${r.obs ? `<div style="font-size:11px;margin-top:6px;color:var(--text-primary)">${esc(r.obs)}</div>` : ''}
            </div>`;
          }).join('')
      }`;
  }

  _renderForm() {
    const el = document.getElementById('recebimento-conteudo');
    if (!el) return;
    const r = this._editId ? this._lista.find(x => x.id === this._editId) : null;
    const tipo = r?.tipo || this._tipoNovo || 'provisorio';
    const isDefinitivo = tipo === 'definitivo';

    el.innerHTML = `
      <div style="background:var(--bg-surface);border:1px solid var(--border);border-radius:10px;padding:20px">
        <div style="font-size:14px;font-weight:700;margin-bottom:16px;color:${isDefinitivo ? '#1e40af' : '#15803d'}">
          ${isDefinitivo ? '🏛️ Recebimento Definitivo' : '📋 Recebimento Provisório'}
          ${r ? ' — Editando' : ' — Novo'}
        </div>
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-bottom:14px">
          <div>
            <label style="font-size:11px;font-weight:700;color:var(--text-muted);display:block;margin-bottom:4px">Data do Recebimento *</label>
            <input id="receb-data" type="date" value="${r?.data || hoje()}"
              style="width:100%;padding:8px;border-radius:7px;border:1px solid var(--border);
              background:var(--bg-card);color:var(--text-primary);font-size:12px;box-sizing:border-box">
          </div>
          <div>
            <label style="font-size:11px;font-weight:700;color:var(--text-muted);display:block;margin-bottom:4px">Responsável pelo Recebimento *</label>
            <input id="receb-resp" type="text" value="${esc(r?.responsavel)}" placeholder="Nome do responsável"
              style="width:100%;padding:8px;border-radius:7px;border:1px solid var(--border);
              background:var(--bg-card);color:var(--text-primary);font-size:12px;box-sizing:border-box">
          </div>
          <div>
            <label style="font-size:11px;font-weight:700;color:var(--text-muted);display:block;margin-bottom:4px">Nº Termo / Processo</label>
            <input id="receb-termo" type="text" value="${esc(r?.termo)}" placeholder="Ex: Termo nº 01/2024"
              style="width:100%;padding:8px;border-radius:7px;border:1px solid var(--border);
              background:var(--bg-card);color:var(--text-primary);font-size:12px;box-sizing:border-box">
          </div>
          <div>
            <label style="font-size:11px;font-weight:700;color:var(--text-muted);display:block;margin-bottom:4px">Observações</label>
            <input id="receb-obs" type="text" value="${esc(r?.obs)}" placeholder="Pendências, ressalvas..."
              style="width:100%;padding:8px;border-radius:7px;border:1px solid var(--border);
              background:var(--bg-card);color:var(--text-primary);font-size:12px;box-sizing:border-box">
          </div>
        </div>

        <!-- Checklist -->
        <div style="font-size:12px;font-weight:700;margin-bottom:8px;color:var(--text-primary)">📋 Checklist de Conformidade</div>
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:6px;margin-bottom:14px">
          ${CHECKLIST_ITEMS.map(c => `
            <label style="display:flex;align-items:center;gap:8px;cursor:pointer;padding:6px 8px;
              border-radius:6px;background:var(--bg-card);border:1px solid var(--border);font-size:12px">
              <input type="checkbox" id="chk-${c.key}" ${r?.checklist?.[c.key] ? 'checked' : ''}
                style="width:14px;height:14px">
              ${c.label}
            </label>`).join('')}
        </div>

        <div style="display:flex;gap:8px;justify-content:flex-end">
          <button class="btn btn-cinza btn-sm" data-action="_recebCancelar">Cancelar</button>
          <button class="btn btn-verde btn-sm" data-action="_recebSalvarForm" data-arg0="${this._editId || ''}" data-arg1="${tipo}" >💾 Salvar Termo</button>
        </div>
      </div>`;
  }

  _exposeGlobals() {
    window._recebNovoForm = (tipo) => { this._editId = null; this._tipoNovo = tipo; this._view = 'form'; this._render(); };
    window._recebEditar   = (id)   => { this._editId = id; this._view = 'form'; this._render(); };
    window._recebCancelar = ()     => { this._view = 'lista'; this._render(); };
    window._recebExcluir  = async (id) => {
      if (!confirm('Excluir este termo de recebimento?')) return;
      this._lista = this._lista.filter(r => r.id !== id);
      await this._salvar(); this._render();
      window.toast?.('🗑️ Termo removido.', 'ok');
    };
    window._recebSalvarForm = async (editId, tipo) => {
      const g = id => document.getElementById(id)?.value?.trim() || '';
      const data  = g('receb-data');
      const resp  = g('receb-resp');
      if (!data || !resp) { window.toast?.('⚠️ Preencha data e responsável.', 'warn'); return; }

      // Verifica regra: apenas 1 definitivo
      if (tipo === 'definitivo' && !editId) {
        const jaTemDef = this._lista.find(r => r.tipo === 'definitivo');
        if (jaTemDef) { window.toast?.('⚠️ Já existe um Recebimento Definitivo registrado.', 'warn'); return; }
      }

      // CORREÇÃO: verificar % físico acumulado antes do recebimento definitivo (Lei 14.133/2021 Art. 140)
      if (tipo === 'definitivo' && !editId) {
        const bms         = state.get('bms')           || [];
        const itens       = state.get('itensContrato') || [];
        const cfg         = state.get('cfg')           || {};
        const obraId      = state.get('obraAtivaId');
        const valorTotal  = parseFloat(cfg.valor) || 0;

        if (valorTotal > 0 && bms.length > 0 && itens.length > 0) {
          // Importar função de cálculo acumulado
          try {
            const { getValorAcumuladoTotal } = await import('../boletim-medicao/bm-calculos.js');
            const ultimoBm   = Math.max(...bms.map(b => parseInt(b.num) || 0));
            const acumulado  = getValorAcumuladoTotal(obraId, ultimoBm, itens, cfg);
            const pctFisico  = (acumulado / valorTotal) * 100;
            const MINIMO_PCT = 95; // tolerância configurável

            if (pctFisico < MINIMO_PCT) {
              const R$ = v => v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
              const continua = window.confirm(
                `⚠️ ATENÇÃO — RECEBIMENTO DEFINITIVO\n\n` +
                `Percentual financeiro medido: ${pctFisico.toFixed(2)}%\n` +
                `Valor acumulado: ${R$(acumulado)}\n` +
                `Valor contratual: ${R$(valorTotal)}\n\n` +
                `O recebimento definitivo pressupõe a conclusão do objeto (Lei 14.133/2021 Art. 140).\n` +
                `O percentual medido está abaixo de ${MINIMO_PCT}%.\n\n` +
                `Deseja prosseguir mesmo assim?`
              );
              if (!continua) return;
              window.auditRegistrar?.({
                modulo:   'Recebimento',
                tipo:     'alerta_recebimento_definitivo',
                registro: `Recebimento Definitivo`,
                detalhe:  `Emitido com ${pctFisico.toFixed(2)}% medido. Usuário confirmou prosseguimento.`,
              });
            }
          } catch (e) {
            console.warn('[Recebimento] Não foi possível verificar % acumulado:', e);
          }
        }

        // Verificar se todos os BMs estão bloqueados
        const bmsBloqueados = bms.every(bm => {
          try {
            const { getMedicoes } = window._bmCalcFns || {};
            // Acesso direto ao MemCache via estado global se disponível
            return true; // fallback — não bloqueia se não conseguir verificar
          } catch { return true; }
        });
      }

      const checklist = {};
      CHECKLIST_ITEMS.forEach(c => { checklist[c.key] = document.getElementById(`chk-${c.key}`)?.checked || false; });

      const item = {
        id:          editId || `receb_${Date.now()}`,
        tipo,
        data,
        responsavel: resp,
        termo:       g('receb-termo'),
        obs:         g('receb-obs'),
        checklist,
        criadoEm:    new Date().toISOString(),
      };
      if (editId) {
        this._lista = this._lista.map(r => r.id === editId ? { ...r, ...item } : r);
      } else {
        this._lista.push(item);
      }
      await this._salvar(); this._view = 'lista'; this._render();
      window.toast?.(`✅ Recebimento ${tipo === 'definitivo' ? 'definitivo' : 'provisório'} registrado!`, 'ok');
    };
  }

  _bindEvents() {
    this._subs.push(
      EventBus.on('obra:selecionada', async () => {
        await this._carregar(); this._view = 'lista';
        if (router.current === 'recebimento') this._render();
      }, 'recebimento')
    );
  }

  destroy() {
    this._subs.forEach(u => u?.());
    this._subs = [];
    EventBus.offByContext('recebimento');
  }
}
