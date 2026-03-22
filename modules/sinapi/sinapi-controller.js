/**
 * ╔══════════════════════════════════════════════════════════════╗
 * ║  FISCAL NA OBRA — modules/sinapi/sinapi-controller.js       ║
 * ║  Importação de planilha SINAPI → itens do contrato          ║
 * ╚══════════════════════════════════════════════════════════════╝
 *
 * Lê planilhas Excel do SINAPI (formato CEF/Ministério) e mapeia
 * os itens diretamente para a estrutura de itensContrato do sistema.
 * Usa a biblioteca XLSX.js já carregada no index.html.
 */

import EventBus        from '../../core/EventBus.js';
import { bindActions } from '../../utils/actions.js';
import state           from '../../core/state.js';
import router          from '../../core/router.js';
import FirebaseService from '../../firebase/firebase-service.js';

const slug = s => (s||'').toString().normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().trim();

// Colunas esperadas na planilha SINAPI (variações de nome aceitas)
const COL_ALIAS = {
  codigo:   ['codigo','cód','cod','código sinapi','item','ref'],
  descricao:['descricao','descrição','serviço','item descricao','descrição do serviço'],
  unidade:  ['unidade','un','und','unid'],
  quantidade:['quantidade','qtd','quant','qtde','quantidade contratada'],
  preco:    ['preco unitario','preço unitário','preço unit.','pu','preco','valor unit'],
};

function detectarColuna(headers, aliases) {
  for (const alias of aliases) {
    const idx = headers.findIndex(h => slug(h).includes(alias));
    if (idx >= 0) return idx;
  }
  return -1;
}

function lerPlanilha(arquivo) {
  return new Promise((ok, ko) => {
    const reader = new FileReader();
    reader.onload = e => {
      try {
        const wb   = XLSX.read(e.target.result, { type: 'binary' });
        const ws   = wb.Sheets[wb.SheetNames[0]];
        const rows = XLSX.utils.sheet_to_json(ws, { header: 1, defval: '' });
        ok(rows);
      } catch (err) { ko(err); }
    };
    reader.onerror = ko;
    reader.readAsBinaryString(arquivo);
  });
}

function processarLinhas(rows) {
  // Encontrar a linha de cabeçalho (primeira com >= 3 colunas preenchidas)
  let headerIdx = -1;
  let mapa = {};

  for (let i = 0; i < Math.min(rows.length, 15); i++) {
    const row     = rows[i];
    const headers = row.map(c => slug(String(c)));
    const cols    = {};
    let encontrou = 0;
    for (const [campo, aliases] of Object.entries(COL_ALIAS)) {
      const idx = detectarColuna(headers, aliases);
      if (idx >= 0) { cols[campo] = idx; encontrou++; }
    }
    if (encontrou >= 3) { headerIdx = i; mapa = cols; break; }
  }

  if (headerIdx < 0) throw new Error('Não foi possível identificar as colunas da planilha SINAPI. Verifique se o arquivo tem colunas de Código, Descrição, Unidade, Quantidade e Preço Unitário.');

  const itens = [];
  let ordemGrupo = null;

  for (let i = headerIdx + 1; i < rows.length; i++) {
    const row = rows[i];
    if (!row || row.every(c => c === '' || c === null)) continue;

    const codigo   = String(row[mapa.codigo]   ?? '').trim();
    const descricao= String(row[mapa.descricao] ?? '').trim();
    const unidade  = String(row[mapa.unidade]   ?? '').trim();
    const qtdRaw   = row[mapa.quantidade] ?? 0;
    const precoRaw = row[mapa.preco]      ?? 0;

    if (!descricao) continue;

    // Detectar linha de grupo/subtítulo (sem código SINAPI numérico)
    const ehGrupo = !codigo || !/^\d/.test(codigo) || unidade === '';
    if (ehGrupo) {
      ordemGrupo = descricao;
      itens.push({ t: true, id: `G_${i}`, desc: descricao });
      continue;
    }

    const qtd   = parseFloat(String(qtdRaw).replace(',', '.'))   || 0;
    const preco = parseFloat(String(precoRaw).replace(',', '.')) || 0;

    itens.push({
      id:     codigo || `I_${i}`,
      desc:   descricao,
      und:    unidade || 'un',
      qtd:    qtd,
      up:     preco,
      total:  qtd * preco,
      grupo:  ordemGrupo || '',
      sinapi: codigo,
      origem: 'sinapi',
    });
  }

  return itens;
}

export class SinapiModule {
  constructor() {
    this._subs          = [];
    this._preview       = [];
    this._arquivo       = null;
    this._status        = 'idle'; // idle | loading | preview | saving
    this._unbindActions = null;   // FIX-E4.1
  }

  async init()    { this._bindEvents(); this._exposeGlobals(); }
  async onEnter() { this._render(); }

  _render() {
    const el = document.getElementById('sinapi-conteudo');
    if (!el) return;
    const obraId = state.get('obraAtivaId');

    if (!obraId) {
      el.innerHTML = '<div style="text-align:center;padding:40px;color:var(--text-muted);font-size:13px">Selecione uma obra antes de importar o SINAPI.</div>';
      return;
    }

    const itensCfg = state.get('itensContrato') || [];

    el.innerHTML = `
      <div style="background:var(--bg-surface);border:1px solid var(--border);border-radius:10px;padding:20px;margin-bottom:16px">
        <div style="font-size:13px;font-weight:700;color:var(--text-primary);margin-bottom:8px">📋 Importar Planilha SINAPI</div>
        <div style="font-size:12px;color:var(--text-muted);margin-bottom:14px;line-height:1.6">
          Aceita planilhas Excel do SINAPI exportadas pelo sistema CEF/CAIXA ou pelo site da CAIXA
          (<strong>sinapi.caixa.gov.br</strong>). Colunas detectadas automaticamente: Código SINAPI, Descrição, Unidade, Quantidade e Preço Unitário.
        </div>
        <div style="display:flex;gap:10px;flex-wrap:wrap;align-items:center">
          <input type="file" id="sinapi-file-input" accept=".xlsx,.xls,.csv" style="display:none" onchange="window._sinapi_carregar(this)">
          <button data-action="_sinapiClickFileInput"
            style="padding:9px 18px;background:var(--accent);border:none;border-radius:8px;color:#fff;font-size:12px;font-weight:700;cursor:pointer">
            📂 Selecionar Planilha SINAPI
          </button>
          <span id="sinapi-file-nome" style="font-size:12px;color:var(--text-muted)">Nenhum arquivo selecionado</span>
        </div>
        <div id="sinapi-aviso" style="margin-top:10px;font-size:12px;color:var(--color-warning-dark, #d97706);display:none"></div>
      </div>

      ${this._status === 'preview' && this._preview.length > 0 ? this._renderPreview() : ''}

      <div style="background:var(--bg-surface);border:1px solid var(--border);border-radius:10px;padding:16px">
        <div style="font-size:12px;font-weight:700;color:var(--text-muted);margin-bottom:8px">
          ITENS ATUAIS DO CONTRATO (${itensCfg.filter(i=>!i.t).length} itens)
        </div>
        ${itensCfg.length === 0
          ? '<div style="font-size:12px;color:var(--text-muted);padding:12px 0">Nenhum item cadastrado. Importe uma planilha SINAPI para começar.</div>'
          : `<div style="font-size:11px;color:var(--text-muted)">${itensCfg.filter(i=>!i.t).length} itens contratuais carregados. Acesse <strong>Configurações</strong> para visualizar e editar.</div>`
        }
      </div>
    `;
    // FIX-E4.1: registrar handlers delegados após montar o HTML
    this._bindActionsContainer(el);
  }

  _bindActionsContainer(el) {
    this._unbindActions = bindActions(el, {
      confirmar: () => this._confirmar().catch(console.error),
      cancelar:  () => this._cancelar(),
    });
  }

  _renderPreview() {
    const itens   = this._preview.filter(i => !i.t);
    const grupos  = this._preview.filter(i =>  i.t);
    const total   = itens.reduce((s, i) => s + (i.total || 0), 0);
    const fmt     = v => v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });

    return `
      <div style="background:var(--bg-surface);border:1px solid var(--color-success, #22c55e)55;border-radius:10px;padding:16px;margin-bottom:16px">
        <div style="display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:10px;margin-bottom:14px">
          <div>
            <div style="font-size:13px;font-weight:700;color:var(--color-success, #22c55e)">✅ ${itens.length} itens detectados • ${grupos.length} grupos</div>
            <div style="font-size:12px;color:var(--text-muted)">Valor total da planilha: <strong>${fmt(total)}</strong></div>
          </div>
          <div style="display:flex;gap:8px">
            <button data-action="cancelar"
              style="padding:8px 16px;background:var(--bg-card);border:1px solid var(--border);border-radius:8px;font-size:12px;font-weight:700;cursor:pointer;color:var(--text-primary)">
              Cancelar
            </button>
            <button data-action="confirmar"
              style="padding:8px 16px;background:var(--color-success-dark, #16a34a);border:none;border-radius:8px;color:#fff;font-size:12px;font-weight:700;cursor:pointer">
              💾 Importar para o Contrato
            </button>
          </div>
        </div>
        <div style="overflow-x:auto;max-height:360px;overflow-y:auto">
          <table style="width:100%;border-collapse:collapse;font-size:11px">
            <thead>
              <tr style="background:var(--bg-card);position:sticky;top:0">
                <th style="padding:8px;text-align:left;color:var(--text-muted);font-weight:700;border-bottom:1px solid var(--border);white-space:nowrap">Código SINAPI</th>
                <th style="padding:8px;text-align:left;color:var(--text-muted);font-weight:700;border-bottom:1px solid var(--border)">Descrição</th>
                <th style="padding:8px;text-align:center;color:var(--text-muted);font-weight:700;border-bottom:1px solid var(--border)">Un</th>
                <th style="padding:8px;text-align:right;color:var(--text-muted);font-weight:700;border-bottom:1px solid var(--border)">Qtd</th>
                <th style="padding:8px;text-align:right;color:var(--text-muted);font-weight:700;border-bottom:1px solid var(--border)">P.Unit</th>
                <th style="padding:8px;text-align:right;color:var(--text-muted);font-weight:700;border-bottom:1px solid var(--border)">Total</th>
              </tr>
            </thead>
            <tbody>
              ${this._preview.map(item => {
                if (item.t) return `<tr style="background:var(--color-info-dark, #1d4ed8)20"><td colspan="6" style="padding:6px 8px;font-size:11px;font-weight:700;color:var(--color-info-mid, #60a5fa)">${item.desc}</td></tr>`;
                return `<tr style="border-bottom:1px solid var(--border)20">
                  <td style="padding:6px 8px;color:var(--text-muted);font-family:monospace">${item.sinapi||'—'}</td>
                  <td style="padding:6px 8px;color:var(--text-primary)">${item.desc}</td>
                  <td style="padding:6px 8px;text-align:center;color:var(--text-muted)">${item.und}</td>
                  <td style="padding:6px 8px;text-align:right;color:var(--text-primary)">${item.qtd.toLocaleString('pt-BR')}</td>
                  <td style="padding:6px 8px;text-align:right;color:var(--text-primary)">${item.up.toLocaleString('pt-BR',{minimumFractionDigits:2})}</td>
                  <td style="padding:6px 8px;text-align:right;color:var(--color-success, #22c55e);font-weight:700">${fmt(item.total)}</td>
                </tr>`;
              }).join('')}
            </tbody>
          </table>
        </div>
      </div>
    `;
  }

  async _carregar(input) {
    const arquivo = input?.files?.[0];
    if (!arquivo) return;
    this._arquivo = arquivo;
    document.getElementById('sinapi-file-nome').textContent = arquivo.name;

    const aviso = document.getElementById('sinapi-aviso');
    if (aviso) { aviso.textContent = '⏳ Processando planilha…'; aviso.style.display = 'block'; }

    try {
      if (typeof XLSX === 'undefined') throw new Error('Biblioteca XLSX não carregada. Recarregue a página.');
      const rows   = await lerPlanilha(arquivo);
      this._preview= processarLinhas(rows);
      this._status = 'preview';
      if (aviso) aviso.style.display = 'none';
      window.toast?.(`📋 ${this._preview.filter(i=>!i.t).length} itens lidos. Confirme para importar.`, 'ok');
    } catch (err) {
      if (aviso) { aviso.textContent = '❌ ' + err.message; aviso.style.display = 'block'; }
      this._status = 'idle';
    }
    this._render();
    if (input) input.value = '';
  }

  async _confirmar() {
    const obraId = state.get('obraAtivaId');
    if (!obraId || !this._preview.length) return;

    const existentes = state.get('itensContrato') || [];
    if (existentes.length > 0) {
      // FIX-E3.3: ConfirmComponent em vez de confirm() nativo
      const ok = await window._confirm(
        `O contrato já possui <strong>${existentes.filter(i=>!i.t).length} itens</strong>. Deseja substituí-los pelos itens da planilha SINAPI importada?`,
        { title: '⚠️ Sobrescrever itens do contrato?', labelOk: 'Substituir', danger: true,
          detail: 'Esta ação não pode ser desfeita.' }
      );
      if (!ok) return;
    }

    try {
      state.set('itensContrato', this._preview);
      await FirebaseService.setItens(obraId, this._preview);
      window.toast?.(`✅ ${this._preview.filter(i=>!i.t).length} itens SINAPI importados com sucesso!`, 'ok');
      EventBus.emit('itens:atualizados', { itens: this._preview });
      this._status  = 'idle';
      this._preview = [];
      this._render();
    } catch (err) {
      window.toast?.('❌ Erro ao salvar: ' + err.message, 'error');
    }
  }

  _cancelar() { this._status = 'idle'; this._preview = []; this._arquivo = null; this._render(); }

  _bindEvents() {
    this._subs.push(EventBus.on('obra:selecionada', () => {
      if (router.current === 'sinapi') this._render();
    }, 'sinapi'));
  }

  _exposeGlobals() {
    window._sinapi_carregar  = (input) => this._carregar(input).catch(console.error);
    window._sinapi_confirmar = () => {
      // FIX-E3.2: withLoading via onceConcurrent — evita duplo clique em importação
      const btn = document.querySelector('[data-action="confirmar"]');
      import('../../utils/loading.js').then(({ withLoading }) => {
        withLoading(btn, () => this._confirmar(), {
          labelLoading: 'Importando SINAPI...',
          labelDone: 'Importado!',
          labelError: 'Erro na importação',
        }).catch(e => window.toast?.('❌ Erro ao importar: ' + e.message, 'error'));
      });
    };
    window._sinapi_cancelar  = ()      => this._cancelar();
  }

  destroy() { this._subs.forEach(u => u()); this._subs = []; this._unbindActions?.(); }
}
