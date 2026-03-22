/**
 * ╔══════════════════════════════════════════════════════════════╗
 * ║  FISCAL NA OBRA v13 — modules/importacao/importacao-controller.js
 * ║  Smart Import — Excel (.xls/.xlsx) + PDF + Validação TCU    ║
 * ╚══════════════════════════════════════════════════════════════╝
 *
 * Porta COMPLETA do módulo Smart Import do v12.
 * Suporta: Excel (Prefeitura 9 colunas + genérico), PDF (PDF.js),
 *          Validação TCU, Relatório exportável, Mapeamento manual.
 * Modos: NOVA OBRA | INSERIR NA OBRA ATIVA
 *
 * CDN (index.html): SheetJS xlsx.full.min.js + PDF.js pdf.min.js
 */

import EventBus        from '../../core/EventBus.js';
import state           from '../../core/state.js';
import router          from '../../core/router.js';
import { formatters }  from '../../utils/formatters.js';
import FirebaseService from '../../firebase/firebase-service.js';
import LoadingIndicator from '../../utils/loading-indicator.js';

const SI_ALIASES = {
  item:  ['item','nitem','num','numero','número','cod.item','it','n\\.?\\s*item'],
  cod:   ['codigo','código','cod(?!.*item)','code','ref(?!.*bdi)','referencia','referência'],
  banco: ['banco','fonte','base','origem','bank','tabela'],
  desc:  ['descricao dos servicos','descricao dos serviços','descrição dos servicos',
          'descrição dos serviços','descricao','descrição','description',
          'descriminacao','descriminação','discriminacao','discriminação',
          'servico','serviço','denominacao','denominação',
          // CAIXA BM format
          'discrimina[çc][aã]o','discriminacao'],
  und:   ['und','unidade','un(?!it)','unit(?!a)','med(?!i)','medida','unid\\.?'],
  qtd:   ['quant','quantidade','qtd','qty','quantity','qtde\\.?'],
  up:    ['valor unit','vunit','v\\.unit','preco unit','preço unit',
          'unitario sem','unit sem','valor unitário','valor unit\\.',
          // CAIXA BM format
          'pre[çc]o.*unit','p\\.?\\s*unit'],
  upBdi: ['valor unit.*bdi','vunit.*bdi','v\\.unit.*bdi','unit.*bdi',
          'com bdi','\\+.*bdi','c/bdi','unit.*\\+',
          'pre[çc]o.*bdi'],
  total: ['total(?!.*acum|.*ant|.*atu|.*sald)','valor total','total geral','subtotal',
          // CAIXA BM format
          'pre[çc]o total','p\\.?\\s*total']
};

// ── Detecção de formato CAIXA BM ──────────────────────────────
// Headers típicos: Item | Discriminação | Unid. | Qtde. | Preço Unitário (R$) | Preço Total (R$)
// seguidos de colunas de evolução física/financeira (% acumulado, período etc.)
function _detectarFormatoCaixa(headers) {
  const h = headers.map(x => (x||'').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g,''));
  const temDiscriminacao = h.some(x => /discrimina|discriminac/.test(x));
  const temPrecoTotal    = h.some(x => /preco total|p\.?\s*total/.test(x));
  const temPrecoUnit     = h.some(x => /preco unit|p\.?\s*unit/.test(x));
  const temQtde          = h.some(x => /qtde|quant/.test(x));
  const temEvolucao      = h.some(x => /acum|periodo|per[íi]odo|anterior/.test(x));
  return (temDiscriminacao || temPrecoTotal) && (temQtde || temPrecoUnit) && temEvolucao;
}

export class ImportacaoModule {
  constructor() {
    this._subs           = [];
    this._modo           = 'nova';
    this._tipoImportacao = 'prefeitura'; // 'prefeitura' | 'caixa'
    this._itensExtraidos = [];
    this._colsDetectadas = null;
    this._validacao      = null;
    this._logLines       = [];
    this._headersCols    = [];
    this._rawData        = [];
    this._abaAtual       = 'preview';
  }

  async init() {
    try { this._bindEvents(); this._exposeGlobals(); }
    catch (e) { console.error('[ImportacaoModule] init:', e); }
  }

  onEnter() {
    try { this._render(); }
    catch (e) { console.error('[ImportacaoModule] onEnter:', e); }
  }

  // ═══════════════════════════════════════════════════════════════
  //  RENDER
  // ═══════════════════════════════════════════════════════════════
  _render(modo) {
    if (modo) this._modo = modo;
    const container = document.getElementById('importacao-conteudo')
                   || document.querySelector('#importacao .card');
    if (!container) return;

    const podeInserir = !!state.get('obraAtivaId');
    const labelBtn    = this._modo === 'nova' ? '✅ Criar Obra e Importar' : '✅ Inserir Itens na Obra Ativa';
    const isPref      = this._tipoImportacao === 'prefeitura';
    const isCaixa     = this._tipoImportacao === 'caixa';

    container.innerHTML = `
      <!-- ── SELETOR DE MODO DE IMPORTAÇÃO ──────────────────── -->
      <div style="margin-bottom:16px;border:1px solid #2d3748;border-radius:10px;overflow:hidden">
        <div style="background:#0d111a;padding:10px 16px;font-size:10px;font-weight:700;
          color:#6b7280;text-transform:uppercase;letter-spacing:.5px;border-bottom:1px solid #2d3748">
          📥 Tipo de Planilha para Importação
        </div>
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:0">
          <button onclick="window._siSetTipoImportacao('prefeitura')"
            style="padding:14px 16px;border:none;border-right:1px solid #2d3748;cursor:pointer;
              text-align:left;transition:background .15s;
              background:${isPref?'#1e3a5f':'#1e2330'};
              border-bottom:3px solid ${isPref?'#3b82f6':'transparent'}">
            <div style="font-size:12px;font-weight:800;color:${isPref?'#93c5fd':'#6b7280'};margin-bottom:3px">
              🏛️ Padrão Prefeitura
            </div>
            <div style="font-size:10px;color:${isPref?'#64748b':'#374151'}">
              Planilhas do sistema da prefeitura (9 colunas padrão)
            </div>
          </button>
          <button onclick="window._siSetTipoImportacao('caixa')"
            style="padding:14px 16px;border:none;cursor:pointer;text-align:left;transition:background .15s;
              background:${isCaixa?'#1a2e1a':'#1e2330'};
              border-bottom:3px solid ${isCaixa?'#22c55e':'transparent'}">
            <div style="font-size:12px;font-weight:800;color:${isCaixa?'#86efac':'#6b7280'};margin-bottom:3px">
              🏦 Padrão CAIXA
            </div>
            <div style="font-size:10px;color:${isCaixa?'#64748b':'#374151'}">
              Boletins de Medição da Caixa Econômica Federal (BM GIGOV)
            </div>
          </button>
        </div>
        ${isCaixa ? `<div style="background:#172717;padding:8px 16px;border-top:1px solid #2d3748;
          font-size:10.5px;color:#86efac">
          ℹ️ Colunas esperadas: <strong style="color:#a7f3d0">Item · Discriminação · Unid. · Qtde. · Preço Unitário · Preço Total</strong>
          — colunas de evolução (% Acum., Período etc.) serão ignoradas automaticamente.
        </div>` : `<div style="background:#0f1a2e;padding:8px 16px;border-top:1px solid #2d3748;
          font-size:10.5px;color:#93c5fd">
          ℹ️ Colunas esperadas: <strong style="color:#bae6fd">Item · Código · Banco · Descrição · Und · Qtd · V.Unit · V.Unit+BDI · Total</strong>
        </div>`}
      </div>

      <!-- ── BOTÕES DE MODO (NOVA OBRA / INSERIR) ───────────── -->
      <div style="display:flex;align-items:center;gap:10px;margin-bottom:16px;flex-wrap:wrap">
        <button onclick="window._siSetModo('nova')"
          style="padding:5px 16px;border-radius:20px;font-size:11px;font-weight:700;border:2px solid #1e40af;
                 background:${this._modo==='nova'?'#dbeafe':'transparent'};
                 color:${this._modo==='nova'?'#1e40af':'#6b7280'};cursor:pointer">
          🏗️ NOVA OBRA
        </button>
        ${podeInserir ? `
        <button onclick="window._siSetModo('inserir')"
          style="padding:5px 16px;border-radius:20px;font-size:11px;font-weight:700;border:2px solid #059669;
                 background:${this._modo==='inserir'?'#dcfce7':'transparent'};
                 color:${this._modo==='inserir'?'#1A1A1A':'#6b7280'};cursor:pointer">
          ➕ INSERIR NA OBRA ATIVA
        </button>` : ''}
      </div>

      <div id="si-fase-upload">
        <div style="background:#1e2330;border:1px solid #2d3748;border-radius:10px;padding:20px 24px;margin-bottom:16px">
          <div style="font-size:12px;font-weight:800;color:#f1f5f9;margin-bottom:14px">📋 Dados da Obra</div>
          <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px">
            <div style="grid-column:1/-1">
              <label style="font-size:10px;color:#94a3b8;text-transform:uppercase;letter-spacing:.5px">Objeto / Nome da Obra</label>
              <input id="si-objeto" type="text" placeholder="Ex: Construção de UBS Triângulo Leal..."
                style="width:100%;margin-top:4px;padding:8px 10px;border:1px solid #2d3748;border-radius:6px;
                       background:#0d111a;color:#f1f5f9;font-size:12px;box-sizing:border-box">
            </div>
            <div>
              <label style="font-size:10px;color:#94a3b8;text-transform:uppercase;letter-spacing:.5px">Nº Contrato</label>
              <input id="si-contrato" type="text" placeholder="CE01-25"
                style="width:100%;margin-top:4px;padding:8px 10px;border:1px solid #2d3748;border-radius:6px;
                       background:#0d111a;color:#f1f5f9;font-size:12px;box-sizing:border-box">
            </div>
            <div>
              <label style="font-size:10px;color:#94a3b8;text-transform:uppercase;letter-spacing:.5px">BDI (%)</label>
              <input id="si-bdi" type="number" step="0.01" value="25"
                style="width:100%;margin-top:4px;padding:8px 10px;border:1px solid #2d3748;border-radius:6px;
                       background:#0d111a;color:#f1f5f9;font-size:12px;box-sizing:border-box">
            </div>
            <div>
              <label style="font-size:10px;color:#94a3b8;text-transform:uppercase;letter-spacing:.5px">Contratante</label>
              <input id="si-contratante" type="text" placeholder="Prefeitura Municipal de..."
                style="width:100%;margin-top:4px;padding:8px 10px;border:1px solid #2d3748;border-radius:6px;
                       background:#0d111a;color:#f1f5f9;font-size:12px;box-sizing:border-box">
            </div>
            <div>
              <label style="font-size:10px;color:#94a3b8;text-transform:uppercase;letter-spacing:.5px">Contratada</label>
              <input id="si-contratada" type="text" placeholder="Empresa Construtora Ltda"
                style="width:100%;margin-top:4px;padding:8px 10px;border:1px solid #2d3748;border-radius:6px;
                       background:#0d111a;color:#f1f5f9;font-size:12px;box-sizing:border-box">
            </div>
            <div>
              <label style="font-size:10px;color:#94a3b8;text-transform:uppercase;letter-spacing:.5px">Fiscal do Contrato</label>
              <input id="si-fiscal" type="text" placeholder="Nome do fiscal responsável"
                style="width:100%;margin-top:4px;padding:8px 10px;border:1px solid #2d3748;border-radius:6px;
                       background:#0d111a;color:#f1f5f9;font-size:12px;box-sizing:border-box">
            </div>
            <div>
              <label style="font-size:10px;color:#94a3b8;text-transform:uppercase;letter-spacing:.5px">CREA / CAU do Responsável Técnico</label>
              <input id="si-crea-fiscal" type="text" placeholder="Ex: CREA-BA 012345-D"
                style="width:100%;margin-top:4px;padding:8px 10px;border:1px solid #2d3748;border-radius:6px;
                       background:#0d111a;color:#f1f5f9;font-size:12px;box-sizing:border-box">
            </div>
            <div>
              <label style="font-size:10px;color:#94a3b8;text-transform:uppercase;letter-spacing:.5px">CNPJ da Empresa Contratada</label>
              <input id="si-cnpj-contratada" type="text" placeholder="Ex: 00.000.000/0001-00"
                style="width:100%;margin-top:4px;padding:8px 10px;border:1px solid #2d3748;border-radius:6px;
                       background:#0d111a;color:#f1f5f9;font-size:12px;box-sizing:border-box">
            </div>
            <div>
              <label style="font-size:10px;color:#94a3b8;text-transform:uppercase;letter-spacing:.5px">CNPJ da Contratante</label>
              <input id="si-cnpj-contratante" type="text" placeholder="Ex: 00.000.000/0001-00"
                style="width:100%;margin-top:4px;padding:8px 10px;border:1px solid #2d3748;border-radius:6px;
                       background:#0d111a;color:#f1f5f9;font-size:12px;box-sizing:border-box">
            </div>
            <div>
              <label style="font-size:10px;color:#94a3b8;text-transform:uppercase;letter-spacing:.5px">Nº do Processo</label>
              <input id="si-processo" type="text" placeholder="Ex: 2024/00123"
                style="width:100%;margin-top:4px;padding:8px 10px;border:1px solid #2d3748;border-radius:6px;
                       background:#0d111a;color:#f1f5f9;font-size:12px;box-sizing:border-box">
            </div>
            <div>
              <label style="font-size:10px;color:#94a3b8;text-transform:uppercase;letter-spacing:.5px">Unidade Responsável</label>
              <input id="si-unidade" type="text" placeholder="Ex: Secretaria de Obras"
                style="width:100%;margin-top:4px;padding:8px 10px;border:1px solid #2d3748;border-radius:6px;
                       background:#0d111a;color:#f1f5f9;font-size:12px;box-sizing:border-box">
            </div>
            <div>
              <label style="font-size:10px;color:#94a3b8;text-transform:uppercase;letter-spacing:.5px">Data de Início</label>
              <input id="si-inicio" type="date"
                style="width:100%;margin-top:4px;padding:8px 10px;border:1px solid #2d3748;border-radius:6px;
                       background:#0d111a;color:#f1f5f9;font-size:12px;box-sizing:border-box">
            </div>
            <div>
              <label style="font-size:10px;color:#94a3b8;text-transform:uppercase;letter-spacing:.5px">Previsão de Término</label>
              <input id="si-termino" type="date"
                style="width:100%;margin-top:4px;padding:8px 10px;border:1px solid #2d3748;border-radius:6px;
                       background:#0d111a;color:#f1f5f9;font-size:12px;box-sizing:border-box">
            </div>
            <div>
              <label style="font-size:10px;color:#94a3b8;text-transform:uppercase;letter-spacing:.5px">Prazo Contratual (dias)</label>
              <input id="si-prazo" type="number" min="1" placeholder="Ex: 180"
                style="width:100%;margin-top:4px;padding:8px 10px;border:1px solid #2d3748;border-radius:6px;
                       background:#0d111a;color:#f1f5f9;font-size:12px;box-sizing:border-box">
            </div>
          </div>
          ${isCaixa ? `
          <div style="margin-top:12px;padding-top:12px;border-top:1px solid #2d3748">
            <div style="font-size:10px;font-weight:700;color:#86efac;margin-bottom:10px;
              text-transform:uppercase;letter-spacing:.5px">📋 Dados Específicos CAIXA</div>
            <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px">
              <div>
                <label style="font-size:10px;color:#94a3b8;text-transform:uppercase;letter-spacing:.5px">Nº TC/CR (Contrato CAIXA)</label>
                <input id="si-tc-cr" type="text" placeholder="Ex: 1078702-85"
                  style="width:100%;margin-top:4px;padding:8px 10px;border:1px solid #2d3748;border-radius:6px;
                         background:#0d111a;color:#f1f5f9;font-size:12px;box-sizing:border-box">
              </div>
              <div>
                <label style="font-size:10px;color:#94a3b8;text-transform:uppercase;letter-spacing:.5px">Nº Convênio / GIGOV</label>
                <input id="si-convenio" type="text" placeholder="Ex: 916048/2021"
                  style="width:100%;margin-top:4px;padding:8px 10px;border:1px solid #2d3748;border-radius:6px;
                         background:#0d111a;color:#f1f5f9;font-size:12px;box-sizing:border-box">
              </div>
              <div>
                <label style="font-size:10px;color:#94a3b8;text-transform:uppercase;letter-spacing:.5px">Nº CTEF / CNPJ Contratada</label>
                <input id="si-ctef" type="text" placeholder="Ex: CE06-24"
                  style="width:100%;margin-top:4px;padding:8px 10px;border:1px solid #2d3748;border-radius:6px;
                         background:#0d111a;color:#f1f5f9;font-size:12px;box-sizing:border-box">
              </div>
              <div>
                <label style="font-size:10px;color:#94a3b8;text-transform:uppercase;letter-spacing:.5px">Programa / Ministério</label>
                <input id="si-programa" type="text" placeholder="Ex: Ministério do Esporte"
                  style="width:100%;margin-top:4px;padding:8px 10px;border:1px solid #2d3748;border-radius:6px;
                         background:#0d111a;color:#f1f5f9;font-size:12px;box-sizing:border-box">
              </div>
            </div>
          </div>` : ''}
        </div>
      </div>

        <div id="si-drop-zone"
          ondragover="event.preventDefault();this.style.borderColor='#60a5fa'"
          ondragleave="this.style.borderColor='#2d3748'"
          ondrop="window._siHandleDrop(event)"
          onclick="document.getElementById('si-file-input').click()"
          style="border:2px dashed ${isCaixa?'#16a34a':'#2d3748'};border-radius:12px;padding:40px;text-align:center;
                 cursor:pointer;transition:all .2s;background:#1e2330;margin-bottom:16px">
          <div style="font-size:36px;margin-bottom:8px">${isCaixa?'🏦':'📂'}</div>
          <div style="font-size:14px;font-weight:700;color:#f1f5f9;margin-bottom:4px">Arraste ou clique para selecionar</div>
          <div style="font-size:11px;color:#6b7280">${isCaixa
            ? `Planilha BM da CAIXA — <strong style="color:#86efac">.xlsx</strong> ou <strong style="color:#86efac">.xls</strong> (BM GIGOV)`
            : `Suporta <strong style="color:#94a3b8">.xlsx</strong>, <strong style="color:#94a3b8">.xls</strong> e <strong style="color:#94a3b8">.pdf</strong>`
          }</div>
          <input type="file" id="si-file-input" accept=".pdf,.xls,.xlsx" style="display:none"
            onchange="window._siProcessarArquivo(event)">
        </div>
        <div id="si-status" style="min-height:22px;font-size:12px;color:#94a3b8"></div>
      </div>

      <div id="si-fase-mapeamento" style="display:none">
        <div style="background:#1e2330;border:1px solid #2d3748;border-radius:10px;padding:20px;margin-bottom:16px">
          <div style="font-size:13px;font-weight:700;color:#f1f5f9;margin-bottom:4px">⚠️ Mapeamento manual necessário</div>
          <div style="font-size:11px;color:#94a3b8;margin-bottom:16px">Indique qual coluna corresponde a cada campo:</div>
          <div id="si-mapeamento-grid" style="display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-bottom:16px"></div>
          <div style="display:flex;gap:10px">
            <button onclick="window._siAplicarMapeamento()"
              style="background:#059669;color:#fff;border:none;padding:9px 18px;border-radius:7px;cursor:pointer;font-weight:700;font-size:12px">
              ✅ Aplicar Mapeamento
            </button>
            <button onclick="window._siVoltarUpload()"
              style="background:#374151;color:#94a3b8;border:none;padding:9px 18px;border-radius:7px;cursor:pointer;font-size:12px">
              ← Voltar
            </button>
          </div>
        </div>
      </div>

      <div id="si-fase-preview" style="display:none">
        <div id="si-resumo-validacao" style="display:grid;grid-template-columns:repeat(4,1fr);gap:10px;margin-bottom:16px"></div>
        <div style="border-bottom:1px solid #2d3748;display:flex;gap:0">
          <button id="si-tab-preview"   onclick="window._siAbaAtiva('preview')"
            style="padding:9px 16px;border:none;border-bottom:3px solid #60a5fa;background:none;font-weight:700;color:#f1f5f9;cursor:pointer;font-size:12px">📋 Preview</button>
          <button id="si-tab-relatorio" onclick="window._siAbaAtiva('relatorio')"
            style="padding:9px 16px;border:none;border-bottom:3px solid transparent;background:none;color:#6b7280;cursor:pointer;font-size:12px">📊 Relatório TCU</button>
          <button id="si-tab-log"       onclick="window._siAbaAtiva('log')"
            style="padding:9px 16px;border:none;border-bottom:3px solid transparent;background:none;color:#6b7280;cursor:pointer;font-size:12px">📄 Log</button>
        </div>
        <div id="si-aba-preview" style="max-height:380px;overflow-y:auto;border:1px solid #2d3748;border-top:none;border-radius:0 0 8px 8px">
          <table style="width:100%;border-collapse:collapse;font-size:11px">
            <thead style="position:sticky;top:0;z-index:1">
              <tr style="background:#1e3a5f">
                <th style="padding:7px 8px;color:#93c5fd">Item</th>
                <th style="padding:7px 8px;color:#93c5fd">Código</th>
                <th style="padding:7px 8px;color:#93c5fd">Banco</th>
                <th style="padding:7px 8px;color:#93c5fd;min-width:180px">Descrição</th>
                <th style="padding:7px 8px;text-align:center;color:#93c5fd">Und</th>
                <th style="padding:7px 8px;text-align:right;color:#93c5fd">Qtd</th>
                <th style="padding:7px 8px;text-align:right;color:#93c5fd">V.Unit s/BDI</th>
                <th style="padding:7px 8px;text-align:right;color:#93c5fd">V.Unit +BDI</th>
                <th style="padding:7px 8px;text-align:right;color:#93c5fd">Total</th>
                <th style="padding:7px 8px;text-align:center;color:#93c5fd">✓</th>
              </tr>
            </thead>
            <tbody id="si-preview-tbody"></tbody>
          </table>
        </div>
        <div id="si-aba-relatorio" style="display:none;max-height:380px;overflow-y:auto;border:1px solid #2d3748;border-top:none;border-radius:0 0 8px 8px;background:#1e2330"></div>
        <div id="si-aba-log" style="display:none;max-height:380px;overflow-y:auto;background:#0f172a;color:#94a3b8;font-family:monospace;font-size:10.5px;padding:12px;border-radius:0 0 8px 8px;white-space:pre-wrap;border:1px solid #2d3748;border-top:none"></div>
        <div style="display:flex;align-items:center;gap:12px;margin-top:14px;flex-wrap:wrap">
          <button id="si-btn-criar" onclick="window._siCriarObra()"
            style="background:#059669;color:#fff;border:none;padding:10px 22px;border-radius:8px;cursor:pointer;font-weight:800;font-size:13px">
            ${labelBtn}
          </button>
          <button onclick="window._siExportarRelatorioPDF()"
            style="background:#1e2330;color:#94a3b8;border:1px solid #2d3748;padding:10px 16px;border-radius:8px;cursor:pointer;font-size:12px">
            🖨️ Exportar Relatório PDF
          </button>
          <button onclick="window._siVoltarUpload()"
            style="background:#1e2330;color:#94a3b8;border:1px solid #2d3748;padding:10px 16px;border-radius:8px;cursor:pointer;font-size:12px">
            ← Novo arquivo
          </button>
          <div id="si-count-info" style="margin-left:auto;font-size:11px;color:#6b7280"></div>
        </div>
      </div>
    `;
    this._bindWindowGlobals();
  }

  // ─── Controle de fases ──────────────────────────────────────────
  _mostrarFase(fase) {
    ['upload','mapeamento','preview'].forEach(f => {
      const el = document.getElementById('si-fase-' + f);
      if (el) el.style.display = (f === fase) ? 'block' : 'none';
    });
  }

  _abaAtiva(aba) {
    this._abaAtual = aba;
    ['preview','relatorio','log'].forEach(a => {
      const btn = document.getElementById('si-tab-' + a);
      const div = document.getElementById('si-aba-' + a);
      if (btn) {
        btn.style.color            = a === aba ? '#f1f5f9' : '#6b7280';
        btn.style.borderBottomColor = a === aba ? '#60a5fa' : 'transparent';
        btn.style.fontWeight       = a === aba ? '700' : '400';
      }
      if (div) div.style.display = a === aba ? 'block' : 'none';
    });
  }

  _voltarUpload() {
    this._itensExtraidos = [];
    this._logLines       = [];
    this._mostrarFase('upload');
    const st = document.getElementById('si-status');
    if (st) st.textContent = '';
  }

  _setModo(modo) { this._modo = modo; this._render(modo); }

  // ─── Drop handler ───────────────────────────────────────────────
  _handleDrop(event) {
    event.preventDefault();
    const dz = document.getElementById('si-drop-zone');
    if (dz) dz.style.borderColor = '#2d3748';
    const file = event.dataTransfer.files[0];
    if (!file) return;
    const inp = document.getElementById('si-file-input');
    if (inp) {
      try { const dt = new DataTransfer(); dt.items.add(file); inp.files = dt.files; } catch(e) {}
    }
    this._processarArquivoDirecto(file);
  }

  // ─── Processamento central ──────────────────────────────────────
  async _processarArquivo(event) {
    const file = event.target.files[0];
    if (!file) return;
    await this._processarArquivoDirecto(file);
    if (event.target) event.target.value = '';
  }

  async _processarArquivoDirecto(file) {
    this._logLines       = [];
    this._itensExtraidos = [];
    const statusEl = document.getElementById('si-status');
    const ext = file.name.split('.').pop().toLowerCase();
    const tipoLabel = ext === 'pdf' ? 'PDF' : 'Excel';

    // P5 — feedback visual: spinner inline no elemento de status existente
    LoadingIndicator.inline(statusEl, `Lendo ${tipoLabel}: ${file.name} (${(file.size/1024).toFixed(1)} KB)…`);
    this._log(`Arquivo: ${file.name} (${(file.size/1024).toFixed(1)} KB)`);
    this._log(`Modo: ${this._modo}`);
    try {
      if (ext === 'pdf')                  await this._processarPDF(file);
      else if (['xls','xlsx'].includes(ext)) await this._processarExcel(file);
      else throw new Error('Formato não suportado. Use .pdf, .xlsx ou .xls');
    } catch (err) {
      if (statusEl) statusEl.innerHTML = `<span style="color:#dc2626">❌ ${this._esc(err.message)}</span>`;
      this._log('ERRO: ' + err.message);
      console.error('[SmartImport]', err);
    }
  }

  // ─── Parser PDF ─────────────────────────────────────────────────
  // ═══════════════════════════════════════════════════════════════
  //  PARSER PDF CAIXA — Reconstruído v15
  //  Algoritmo: extração posicional com zonas de coluna + tratamento
  //  de descrição multilinha e todos os campos do BM CAIXA.
  // ═══════════════════════════════════════════════════════════════

  async _processarPDF(file) {
    const statusEl = document.getElementById('si-status');
    if (statusEl) statusEl.innerHTML = '<span style="color:#94a3b8">⏳ Extraindo texto do PDF...</span>';
    if (typeof pdfjsLib === 'undefined')
      throw new Error('PDF.js não carregado. Verifique a conexão.');
    if (!pdfjsLib.GlobalWorkerOptions.workerSrc)
      pdfjsLib.GlobalWorkerOptions.workerSrc =
        'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';

    const pdf = await pdfjsLib.getDocument({ data: await file.arrayBuffer() }).promise;
    this._log(`PDF: ${pdf.numPages} página(s)`);

    // ── 1. Extrai todos os fragmentos com posição (x, y, página) ──
    const allFragments = [];
    for (let p = 1; p <= pdf.numPages; p++) {
      const pagina  = await pdf.getPage(p);
      const content = await pagina.getTextContent();
      const vp      = pagina.getViewport({ scale: 1 });
      content.items.forEach(item => {
        if (!item.str || !item.str.trim()) return;
        allFragments.push({
          str:  item.str.trim(),
          x:    Math.round(item.transform[4]),
          y:    Math.round(vp.height - item.transform[5]),
          page: p,
          w:    Math.round(item.width || 0),
          h:    Math.round(item.height || item.transform[3] || 10),
        });
      });
    }
    this._log(`Fragmentos: ${allFragments.length}`);

    // ── 2. Agrupa fragmentos em linhas (tolerância ±4px no eixo Y) ─
    allFragments.sort((a,b) => a.page !== b.page ? a.page-b.page : a.y !== b.y ? a.y-b.y : a.x-b.x);
    const linhas = [];
    let cur = null;
    for (const f of allFragments) {
      if (!cur || cur.page !== f.page || Math.abs(cur.y - f.y) > 4) {
        cur = { page: f.page, y: f.y, tokens: [{ str: f.str, x: f.x, w: f.w }] };
        linhas.push(cur);
      } else {
        cur.tokens.push({ str: f.str, x: f.x, w: f.w });
      }
    }
    linhas.forEach(l => {
      l.tokens.sort((a,b) => a.x - b.x);
      l.text = l.tokens.map(t => t.str).join(' ').replace(/\s{2,}/g,' ').trim();
    });
    const rows = linhas.filter(l => l.text.length > 0);
    this._log(`Linhas montadas: ${rows.length}`);

    // ── 3. Extrai metadados do cabeçalho do documento ──────────────
    const textoMeta = rows.slice(0, 40).map(r => r.text).join('\n');
    this._extrairMeta(textoMeta);

    // ── 4. Detecta BDI ─────────────────────────────────────────────
    const textoTotal = rows.map(r => r.text).join('\n');
    const bdiEl = document.getElementById('si-bdi');
    const mBdi  = textoTotal.match(/BDI\s*[:\-]?\s*([\d,\.]+)\s*%/i);
    if (mBdi && bdiEl) bdiEl.value = parseFloat(mBdi[1].replace(',','.')) || 25;
    const bdiPct = parseFloat(bdiEl?.value || 25);

    if (statusEl) statusEl.innerHTML = '<span style="color:#94a3b8">⏳ Detectando estrutura da tabela CAIXA...</span>';

    // ── 5. Tenta parser CAIXA especializado ─────────────────────────
    let itens = this._parseCaixaBM(rows, bdiPct);

    if (itens.length < 2) {
      // Fallback: parser de colunas genérico
      this._log('Parser CAIXA retornou poucos itens — tentando parser genérico.');
      const itensCols = this._tentarParsePDFporColunas(rows, bdiPct);
      if (itensCols && itensCols.length > itens.length) itens = itensCols;
    }

    if (itens.length < 2) {
      // Fallback final: parser posicional linha a linha
      this._log('Parser coluna também falhou — usando parser posicional.');
      const itensLinha = this._parsePDFLinhas(rows, bdiPct);
      if (itensLinha.length > itens.length) itens = itensLinha;
    }

    this._log(`Total: ${itens.filter(i=>!i.t).length} serviços + ${itens.filter(i=>i.t).length} grupos`);

    if (itens.length === 0)
      throw new Error('Nenhum item encontrado. Verifique se é uma planilha orçamentária válida.');

    this._itensExtraidos = itens;
    this._finalizarImport(bdiPct);
  }

  // ─── Parser CAIXA BM — Algoritmo de zonas de coluna ──────────────
  //
  // Estrutura esperada do BM CAIXA:
  //   Item | Discriminação | Unid. | Qtde. | Preço Unit.(R$) | Preço Total(R$)
  //         [colunas de evolução: % Período | % Acum. | Valor Período | Valor Acum.]
  //
  // Regex de item válido: ^\d+(\.\d+)*
  // Grupos: código sem unidade/qtd (ex: "1.1 SERVIÇOS PRELIMINARES")
  //
  _parseCaixaBM(rows, bdiPct) {
    const bdiF = bdiPct / 100;

    // ── 5a. Linhas que devem ser completamente ignoradas ──────────
    const IGNORAR = /^\s*(TOTAL\b|Boletim de Medi|Empreitada|Or[çc]amento Contrat|Evolu[çc][aã]o F[íi]s|Evolu[çc][aã]o Fin|Prefeito|Respons[aá]vel T[ée]cn|N[ºo°]\.?\s*Conv[êe]n|Dados da Empresa|Assinatura|MEDIÇÃO\s*N[ºo]|Página\s*\d|^\d+\s*de\s*\d+$|^R\$|^BDI|^ITEM\s*$|^Discrimina|^Descrição|^Unid|^Qtde|^Pre[çc]o|^Per[íi]odo|^Acumulado|^Anterior|^Saldo|^CNPJ|^Endere[çc]o|^Objeto|^Data\s*de|^Contrat)/i;

    // ── 5b. Localiza linha de cabeçalho da tabela ─────────────────
    //    Padrões CAIXA: "Item Discriminação Unid. Qtde. Preço Unitário Preço Total"
    const HEADER_SCORE = (txt) => {
      let s = 0;
      if (/\bITEM\b/i.test(txt))           s++;
      if (/DISCRIMINA|DESCRI/i.test(txt))   s++;
      if (/\bUNID|\bUN\b|\bUND\b/i.test(txt)) s++;
      if (/QTDE|QUANT/i.test(txt))          s++;
      if (/PRE[ÇC]O.*UNIT|UNIT.*PRE/i.test(txt)) s++;
      if (/PRE[ÇC]O.*TOTAL|P\.?\s*TOTAL/i.test(txt)) s++;
      if (/ACUMUL|PER[ÍI]ODO/i.test(txt))   s++;
      return s;
    };

    let headerRowIdx = -1;
    let bestScore    = 2;
    for (let i = 0; i < Math.min(50, rows.length); i++) {
      const sc = HEADER_SCORE(rows[i].text);
      if (sc > bestScore) { bestScore = sc; headerRowIdx = i; }
    }

    if (headerRowIdx < 0) {
      this._log('CAIXA: cabeçalho da tabela não encontrado.');
      return [];
    }
    this._log(`CAIXA: cabeçalho encontrado na linha ${headerRowIdx+1} (score=${bestScore}): "${rows[headerRowIdx].text.slice(0,80)}"`);

    // ── 5c. Mapeia cada coluna pelo seu X central ─────────────────
    // Coleta tokens do cabeçalho (e possivelmente da linha seguinte, pois
    // PDFs CAIXA às vezes quebram "Preço" na linha de cima e "Total" na de baixo)
    const hTokens = [...rows[headerRowIdx].tokens];
    if (headerRowIdx + 1 < rows.length) {
      const nextLine = rows[headerRowIdx+1];
      // Se próxima linha parece continuação do cabeçalho (sem código de item)
      if (!/^\d/.test(nextLine.text)) {
        hTokens.push(...nextLine.tokens);
      }
    }
    hTokens.sort((a,b) => a.x - b.x);

    // Agrupa tokens muito próximos (mesmo token dividido em fragmentos)
    const colHeaders = [];
    for (const tok of hTokens) {
      const last = colHeaders[colHeaders.length-1];
      if (last && Math.abs(tok.x - (last.x + last.w)) < 8) {
        last.label += ' ' + tok.str;
        last.w = tok.x + tok.w - last.x;
      } else {
        colHeaders.push({ label: tok.str, x: tok.x, w: tok.w || 40 });
      }
    }

    this._log(`CAIXA: ${colHeaders.length} colunas: ${colHeaders.map(c=>'"'+c.label.slice(0,12)+'"').join(', ')}`);

    // Identifica qual coluna-header corresponde a qual campo semântico
    const CAMPO = { item:-1, desc:-1, und:-1, qtd:-1, up:-1, total:-1, pctPer:-1, pctAcum:-1, valPer:-1, valAcum:-1 };
    colHeaders.forEach((col, i) => {
      const L = col.label.toUpperCase().normalize('NFD').replace(/[\u0300-\u036f]/g,'');
      if (CAMPO.item  < 0 && /^ITEM$/.test(L.trim()))                              CAMPO.item   = i;
      if (CAMPO.desc  < 0 && /DISCRIMINA|DESCRI/.test(L))                          CAMPO.desc   = i;
      if (CAMPO.und   < 0 && /^UND|^UNID|^UN$/.test(L.trim()))                     CAMPO.und    = i;
      if (CAMPO.qtd   < 0 && /QTDE|QUANT/.test(L))                                 CAMPO.qtd    = i;
      if (CAMPO.up    < 0 && /UNIT/.test(L) && !/TOTAL/.test(L))                   CAMPO.up     = i;
      if (CAMPO.total < 0 && /TOTAL|P\.?\s*TOTAL/.test(L) && !/ACUM/.test(L))      CAMPO.total  = i;
      if (CAMPO.pctPer  < 0 && /PER[ÍI]ODO/.test(L) && /%/.test(L))               CAMPO.pctPer  = i;
      if (CAMPO.pctAcum < 0 && /ACUM/.test(L) && /%/.test(L))                      CAMPO.pctAcum = i;
      if (CAMPO.valPer  < 0 && /VALOR.*PER|PER.*VALOR|R\$.*PERIOD/.test(L))        CAMPO.valPer  = i;
      if (CAMPO.valAcum < 0 && /VALOR.*ACUM|ACUM.*VALOR/.test(L))                  CAMPO.valAcum = i;
    });

    // Fallback: se não mapeou desc por label, usa a coluna mais larga (maior w)
    if (CAMPO.desc < 0) {
      let maxW = 0; let maxI = -1;
      colHeaders.forEach((c,i) => { if (c.w > maxW) { maxW=c.w; maxI=i; } });
      if (maxI >= 0) { CAMPO.desc = maxI; this._log('CAIXA: desc por fallback largura'); }
    }

    // Calcula fronteiras de zona de cada campo (midpoint entre colunas adjacentes)
    const zones = colHeaders.map((col, i) => {
      const prevX = i > 0 ? (colHeaders[i-1].x + colHeaders[i-1].w + col.x) / 2 : 0;
      const nextX = i < colHeaders.length-1
        ? (col.x + col.w + colHeaders[i+1].x) / 2
        : col.x + col.w + 200;
      return { idx: i, xMin: prevX, xMax: nextX, cx: col.x };
    });

    // Função: dado X de um token, retorna índice da coluna mais próxima
    const getCol = (x) => {
      for (const z of zones) if (x >= z.xMin && x < z.xMax) return z.idx;
      // fallback: coluna com X mais próximo
      let bestI = 0, bestD = Infinity;
      zones.forEach((z,i) => { const d = Math.abs(x - z.cx); if (d < bestD) { bestD=d; bestI=i; } });
      return bestI;
    };

    // ── 5d. Processa linhas de dados ──────────────────────────────
    const RE_CODIGO = /^(\d{1,3}(?:\.\d{1,3}){0,3})(?:\s|$)/;
    const RE_UNITS  = /^(M[²2³3]?|M3|M2|UN|VB|PT|CJ|KG|T|TON|H|HR|HORA|M[EÊ]S|SC|SAC|KM|L|ML|CM|DM|M3XKM|UND|CHP|CHI|FL|VG|GB|TB|DB|VERBA|LOTE|PAR|JG|PE[CÇ]A|PECA|SET|GL)$/i;

    const itens  = [];
    const vistos = new Set();

    // Rastreia item atual (para descrição multilinha)
    let itemAtual      = null; // item em construção
    let descPendente   = '';   // fragmentos de desc ainda sem und

    const commitItem = () => {
      if (!itemAtual) return;
      // Finaliza descrição
      if (descPendente) {
        itemAtual.desc = (itemAtual.desc + ' ' + descPendente).trim();
        descPendente = '';
      }
      itemAtual.desc = itemAtual.desc.toUpperCase().replace(/\s{2,}/g,' ').trim();
      itens.push(itemAtual);
      itemAtual = null;
    };

    const dataRows = rows.slice(headerRowIdx + 1);

    for (const row of dataRows) {
      const txt = row.text;
      if (!txt || txt.length < 2) continue;
      if (IGNORAR.test(txt))      { commitItem(); continue; }

      const mId = txt.match(RE_CODIGO);

      if (mId) {
        // Nova linha começa com código de item — fecha o item anterior
        commitItem();

        const codigo = mId[1].replace(/\.+$/,'');
        if (vistos.has(codigo)) continue;
        vistos.add(codigo);

        // Distribui tokens desta linha nas zonas de coluna
        const cells = {};
        row.tokens.forEach(tok => {
          const ci = getCol(tok.x);
          cells[ci] = ((cells[ci] || '') + ' ' + tok.str).trim();
        });

        // Extrai campos das células mapeadas
        const descRaw  = cells[CAMPO.desc]  || '';
        const undRaw   = cells[CAMPO.und]   || '';
        const qtdRaw   = cells[CAMPO.qtd]   || '';
        const upRaw    = cells[CAMPO.up]    || '';
        const totalRaw = cells[CAMPO.total] || '';

        // Campos de evolução do BM
        const pctPer  = CAMPO.pctPer  >= 0 ? this._parseNum(cells[CAMPO.pctPer]  || 0) : 0;
        const pctAcum = CAMPO.pctAcum >= 0 ? this._parseNum(cells[CAMPO.pctAcum] || 0) : 0;
        const valPer  = CAMPO.valPer  >= 0 ? this._parseNum(cells[CAMPO.valPer]  || 0) : 0;
        const valAcum = CAMPO.valAcum >= 0 ? this._parseNum(cells[CAMPO.valAcum] || 0) : 0;

        // Remove o próprio código da descrição
        let desc = descRaw.replace(new RegExp('^' + codigo.replace('.','\\.')+'\\s*'), '').trim();
        const und   = this._normUnit(undRaw.trim());
        const qtd   = this._parseNum(qtdRaw);
        const up    = this._parseNum(upRaw);
        const total = this._parseNum(totalRaw);

        const ehUnidade = RE_UNITS.test(und);

        // É GRUPO se: sem unidade válida E sem qtd E sem valor unitário
        const ehGrupo = !ehUnidade && !qtd && !up;

        if (ehGrupo) {
          // Pode ter descrição multilinha — acumulamos na linha seguinte
          itemAtual = {
            id: codigo, t: 'G', desc: desc, und: '', qtd: 0, up: 0, bdi: bdiPct,
            total: total, cod: '', banco: '',
            pctPeriodo: pctPer, pctAcumulado: pctAcum,
            valorPeriodo: valPer, valorAcumulado: valAcum,
          };
        } else {
          // Calcula up sem BDI se necessário
          let upSemBdi = up;
          if (!upSemBdi && total && qtd) upSemBdi = total / qtd / (1 + bdiF);
          upSemBdi = Math.round(upSemBdi * 100) / 100;

          itemAtual = {
            id: codigo, desc: desc, und, qtd, up: upSemBdi, bdi: bdiPct,
            cod: '', banco: '', _totalOriginal: total,
            pctPeriodo: pctPer, pctAcumulado: pctAcum,
            valorPeriodo: valPer, valorAcumulado: valAcum,
          };

          // Se descrição ainda não tem texto e und também veio vazia,
          // a desc pode continuar na próxima linha (PDF quebrou a célula)
          if (!desc && !und && !qtd) {
            descPendente = '';
          }
        }
      } else {
        // Linha sem código: pode ser continuação de descrição multilinha
        if (itemAtual) {
          const txtLimpo = txt.replace(IGNORAR, '').trim();
          if (txtLimpo.length > 1) {
            // Verifica se esta linha contém a unidade que fecha a descrição
            const mUnd = txtLimpo.match(new RegExp(
              '\\b(' + RE_UNITS.source.replace('/i','') + ')\\b', 'i'));
            if (mUnd) {
              // Encontrou unidade — fecha a descrição pendente
              const posUnd = txtLimpo.indexOf(mUnd[0]);
              descPendente += ' ' + txtLimpo.slice(0, posUnd);
              itemAtual.und = this._normUnit(mUnd[1]);
              // Pega qtd e valores do restante
              const dadosStr = txtLimpo.slice(posUnd + mUnd[0].length);
              const nums = [...dadosStr.matchAll(/[\d]{1,3}(?:\.[\d]{3})*,\d{2}|\d+(?:[,\.]?\d+)?/g)]
                .map(m => this._parseNum(m[0])).filter(n => n > 0);
              if (nums.length > 0) itemAtual.qtd = nums[0];
              if (nums.length > 1) {
                // upRaw não disponível neste escopo — calcula direto dos números
                let upSemBdi = nums.length >= 2 ? nums[1] / (1+bdiF) : 0;
                itemAtual.up = Math.round(upSemBdi * 100) / 100;
              }
              commitItem();
            } else {
              // Ainda é continuação de descrição
              descPendente += ' ' + txtLimpo;
            }
          }
        }
      }
    }
    commitItem(); // Fecha último item pendente

    // ── 5e. Ordena por código numérico ────────────────────────────
    itens.sort((a,b) => {
      const pa = a.id.split('.').map(Number);
      const pb = b.id.split('.').map(Number);
      for (let i=0; i<Math.max(pa.length,pb.length); i++)
        if ((pa[i]||0) !== (pb[i]||0)) return (pa[i]||0)-(pb[i]||0);
      return 0;
    });

    this._log(`CAIXA BM: ${itens.filter(i=>!i.t).length} serviços, ${itens.filter(i=>i.t==='G').length} grupos`);
    return itens;
  }

  // ─── Tenta detectar cabeçalho genérico e extrair por colunas ────
  _tentarParsePDFporColunas(rows, bdiPct) {
    const HEADER_KEYS = /ITEM|DESCRI|UNIDAD|QUANT|UNIT|TOTAL|CÓD/i;
    let headerRowIdx = -1;
    for (let i = 0; i < Math.min(40, rows.length); i++) {
      const t = rows[i].text;
      const matches = (t.match(/ITEM|DESCRI[ÇC]/i) ? 1 : 0)
                    + (t.match(/UNID|UND/i) ? 1 : 0)
                    + (t.match(/QUANT/i) ? 1 : 0)
                    + (t.match(/UNIT|TOTAL/i) ? 1 : 0);
      if (matches >= 2) { headerRowIdx = i; break; }
    }
    if (headerRowIdx < 0) return null;

    const hTokens = rows[headerRowIdx].tokens;
    const headers = hTokens.map(t => ({ label: t.str.trim(), x: t.x, w: t.w })).filter(t => t.label);
    if (headers.length < 3) return null;

    const headerLabels = headers.map(h => h.label);
    const detected = this._detectarColunas(headerLabels);
    const xByCampo = {};
    Object.entries(detected).forEach(([campo, idx]) => {
      if (idx >= 0 && idx < headers.length) xByCampo[campo] = headers[idx].x;
    });

    if (!['desc','qtd'].every(c => xByCampo[c] !== undefined)) return null;

    const bdiF   = bdiPct / 100;
    const itens  = [];
    const vistos = new Set();
    const RE_ID  = /^(\d{1,3}(?:\.\d{1,3}){0,3})(?:\s|$)/;
    const IGNORAR= /^(ITEM|DISCRIMINA|CONTRATUAL|ACUMULADO|MEDIÇÃO|TOTAL GERAL|SALDO|CNPJ|BOLETIM|ENDEREÇO|VALOR TOTAL|OBJETO|PERÍODO|DATA|BDI:|RESUMO)/i;

    const dataRows = rows.slice(headerRowIdx + 1);
    const xFields  = Object.entries(xByCampo).sort((a,b) => a[1]-b[1]);

    for (const row of dataRows) {
      if (!row.text || row.text.length < 3 || IGNORAR.test(row.text)) continue;
      const mId = row.text.match(RE_ID);
      if (!mId) continue;
      const id = mId[1].replace(/\.+$/, '');
      if (vistos.has(id)) continue;

      const cellMap = {};
      row.tokens.forEach(tok => {
        let bestCampo = null, bestDist = Infinity;
        for (const [campo, cx] of xFields) {
          const dist = Math.abs(tok.x - cx);
          if (dist < bestDist) { bestDist = dist; bestCampo = campo; }
        }
        if (bestCampo) cellMap[bestCampo] = (cellMap[bestCampo] || '') + ' ' + tok.str;
      });
      Object.keys(cellMap).forEach(k => { cellMap[k] = cellMap[k].trim(); });

      const desc  = (cellMap.desc  || '').replace(/^\d[\d\.\s]*/,'').trim().toUpperCase();
      const und   = this._normUnit((cellMap.und || '').trim());
      const qtd   = this._parseNum(cellMap.qtd  || 0);
      const up    = this._parseNum(cellMap.up   || 0);
      const upBdi = this._parseNum(cellMap.upBdi|| 0);
      const total = this._parseNum(cellMap.total|| 0);

      if (!desc && !qtd && !up) continue;

      const RE_UNITS = /^(M[²2³3]?|UN|VB|PT|CJ|KG|CHP|CHI|HR|HORA|MÊS|MES|TON|L|ML|CM|DM|KM|VERBA|LOTE|PAR|JG|SC|SAC|UND|M3XKM|U)$/i;
      const ehGrupo = (!und || !RE_UNITS.test(und)) && !qtd && !up;

      if (ehGrupo) {
        itens.push({ id, t:'G', desc: desc||id, total:total||0, und:'', qtd:0, up:0, bdi:bdiPct, cod:'', banco:'' });
      } else {
        let upF = up;
        if (!upF && upBdi && bdiF) upF = Math.round(upBdi/(1+bdiF)*100)/100;
        if (!upF && total && qtd)  upF = Math.round(total/qtd/(1+bdiF)*100)/100;
        itens.push({ id, desc: desc||id, und, qtd, up:upF, bdi:bdiPct, cod:'', banco:'' });
      }
      vistos.add(id);
    }

    itens.sort((a,b)=>{
      const pa=a.id.split('.').map(Number), pb=b.id.split('.').map(Number);
      for(let i=0;i<Math.max(pa.length,pb.length);i++) if((pa[i]||0)!==(pb[i]||0)) return(pa[i]||0)-(pb[i]||0);
      return 0;
    });
    return itens.length >= 2 ? itens : null;
  }

  // ─── Parser posicional fallback (linha a linha) ──────────────────
  _parsePDFLinhas(rows, bdiPct) {
    const bdiF   = bdiPct / 100;
    const itens  = [];
    const vistos = new Set();
    const RE_ID    = /^(\d{1,3}(?:\.\d{1,3}){0,3})(?:\s|$)/;
    const IGNORAR  = /^(ITEM|DISCRIMINA|CONTRATUAL|ACUMULADO|MEDIÇÃO|TOTAL GERAL|SALDO|CNPJ|AV\.|BOLETIM|CONSTRUÇÃO|ENDEREÇO|CONTRATANTE|CONTRATADA|VALOR TOTAL|OBJETO|PERÍODO|DATA|BDI:|RESUMO)/i;
    const RE_UNITS = /\b(M[²2³3]?|UN|VB|PT|CJ|KG|CHP|CHI|HR|HORA|MÊS|MES|TON|L|ML|CM|DM|KM|VERBA|LOTE|PAR|JG|SC|SAC|UND|M3XKM|U(?:\s|$))\b/i;

    for (const row of rows) {
      const t = row.text;
      if (!t || t.length < 3 || IGNORAR.test(t)) continue;
      const mId = t.match(RE_ID);
      if (!mId) continue;
      const id    = mId[1];
      const resto = t.slice(mId[0].length).trim();
      if (!resto || resto.length < 2) continue;
      const mUnit = resto.match(RE_UNITS);
      if (!mUnit) {
        const vals  = [...t.matchAll(/R?\$?\s*([\d]{1,3}(?:\.[\d]{3})*,\d{2})/g)];
        const total = vals.length > 0 ? this._parseNum(vals[0][1]) : 0;
        const desc  = resto.replace(/\bR\$\s*[\d\.,]+/g,'').replace(/\b\d+%\s*/g,'').replace(/\s{2,}/g,' ').trim();
        if (!desc || desc.length < 3 || vistos.has(id)) continue;
        vistos.add(id);
        itens.push({ id, t:'G', desc:desc.toUpperCase(), total, und:'', qtd:0, up:0, bdi:bdiPct, cod:'', banco:'' });
      } else {
        const undPos  = mUnit.index;
        const undStr  = this._normUnit(mUnit[1]);
        const desc    = resto.slice(0, undPos).replace(/\s{2,}/g,' ').trim();
        if (!desc || desc.length < 2) continue;
        const dadosStr = resto.slice(undPos + mUnit[0].length);
        const nums = [...dadosStr.matchAll(/[\d]{1,3}(?:\.[\d]{3})*,\d{2}|\d+(?:[,\.]?\d+)?/g)]
          .map(m => this._parseNum(m[0])).filter(n => n > 0);
        if (nums.length < 2) continue;
        const qtdCont = nums[0];
        let upSemBdi  = 0;
        if (bdiF > 0 && nums.length >= 3) {
          let found = false;
          for (let i = 1; i < nums.length-1; i++) {
            if (Math.abs(nums[i+1]/nums[i] - (1+bdiF)) / (1+bdiF) < 0.03) { upSemBdi = nums[i]; found = true; break; }
          }
          if (!found) {
            const totalPDF = nums[nums.length-1];
            if (totalPDF > 0 && Math.abs(qtdCont*nums[1]-totalPDF)/totalPDF < 0.02) upSemBdi = nums[1]/(1+bdiF);
            else if (nums.length >= 3 && nums[1] < nums[2]) upSemBdi = nums[1];
            else upSemBdi = nums[1]/(1+bdiF);
          }
        } else if (nums.length >= 3 && nums[1] < nums[2]) upSemBdi = nums[1];
        else upSemBdi = bdiF > 0 ? nums[1]/(1+bdiF) : nums[1];
        upSemBdi = Math.round(upSemBdi*100)/100;
        if (vistos.has(id)) continue;
        vistos.add(id);
        itens.push({ id, desc:desc.toUpperCase(), und:undStr, qtd:qtdCont, up:upSemBdi, bdi:bdiPct, cod:'', banco:'' });
      }
    }
    itens.sort((a,b) => {
      const pa=a.id.split('.').map(Number), pb=b.id.split('.').map(Number);
      for (let i=0;i<Math.max(pa.length,pb.length);i++) if((pa[i]||0)!==(pb[i]||0)) return (pa[i]||0)-(pb[i]||0);
      return 0;
    });
    return itens;
  }

  // ─── Parser Excel ───────────────────────────────────────────────
  async _processarExcel(file) {
    const statusEl = document.getElementById('si-status');
    if (statusEl) statusEl.innerHTML = '<span style="color:#94a3b8">⏳ Lendo planilha...</span>';
    if (typeof XLSX === 'undefined') throw new Error('SheetJS não carregado.');

    const wb = XLSX.read(new Uint8Array(await file.arrayBuffer()), { type:'array' });
    let melhorAba = wb.SheetNames[0]; let maxLinhas = 0;
    wb.SheetNames.forEach(nome => {
      const ws = wb.Sheets[nome]; const ref = ws['!ref'];
      if (!ref) return;
      const range = XLSX.utils.decode_range(ref);
      const l = range.e.r - range.s.r;
      if (l > maxLinhas) { maxLinhas = l; melhorAba = nome; }
    });
    this._log(`Aba: "${melhorAba}" (${maxLinhas} linhas)`);

    const raw = XLSX.utils.sheet_to_json(wb.Sheets[melhorAba], {header:1,defval:'',raw:true});
    let maxCol = 0;
    for (let i = 0; i < Math.min(30, raw.length); i++)
      for (let j = raw[i].length-1; j >= 0; j--)
        if (String(raw[i][j]||'').trim() && j > maxCol) { maxCol = j; break; }
    const rawT = raw.map(row => row.slice(0, maxCol+1));
    this._log(`Colunas: ${maxCol+1}`);

    this._extrairMeta(rawT.slice(0,20).map(r=>r.join(' ')).join('\n'));

    let headerIdx = -1;
    for (let i = 0; i < Math.min(30,rawT.length); i++) {
      const row = rawT[i];
      if (row.some(c=>/^\s*ITEM\s*$/i.test(String(c||'').trim())) &&
          row.some(c=>/DESCRI[CÇ]/i.test(String(c||''))) &&
          row.some(c=>/QUANT|UNIT|UND/i.test(String(c||'')))) { headerIdx=i; break; }
    }
    if (headerIdx === -1) {
      for (let i = 0; i < Math.min(30,rawT.length); i++) {
        const j = rawT[i].map(c=>String(c||'')).join(' ').toUpperCase();
        if (/ITEM|DESCRIÇÃO|DISCRIMINA/.test(j) && /UNIT|TOTAL|QUANT/.test(j)) { headerIdx=i; break; }
      }
    }
    if (headerIdx === -1) headerIdx = rawT.findIndex(r=>r.some(c=>String(c).trim().length>0)) || 0;
    this._log(`Cabeçalho: linha ${headerIdx+1}`);

    const headers = rawT[headerIdx].map(h=>String(h||'').trim());
    this._headersCols = headers;
    this._log(`Colunas: [${headers.map((h,i)=>h?`${i+1}:"${h.slice(0,20)}"`:null).filter(Boolean).join(', ')}]`);

    const cols = this._detectarColunas(headers);
    this._log(`Detecção: ${JSON.stringify(cols)}`);

    if (!['item','desc','qtd'].every(c=>cols[c]>=0)) {
      this._log('Mapeamento incompleto — manual necessário.');
      this._colsDetectadas = cols;
      this._rawData        = rawT.slice(headerIdx+1);
      this._mostrarMapeamentoManual(headers, cols);
      if (statusEl) statusEl.innerHTML = '<span style="color:#d97706">⚠️ Mapeamento manual necessário.</span>';
      return;
    }

    this._colsDetectadas = cols;
    const bdiPct = parseFloat(document.getElementById('si-bdi')?.value || 25);
    const dataRows = rawT.slice(headerIdx+1);
    this._rawData  = dataRows;
    const itens    = this._excelRowsToItens(dataRows, cols, bdiPct);
    this._log(`Itens: ${itens.filter(i=>!i.t).length} serviços + ${itens.filter(i=>i.t).length} grupos`);
    if (itens.length === 0) throw new Error('Nenhum item encontrado. Verifique o formato.');
    this._itensExtraidos = itens;
    // Mostra badge de formato detectado
    if (statusEl) {
      const fmt = this._formatoDetectado || 'Genérico';
      const isPref = this._tipoImportacao === 'prefeitura';
      const isCaixa = this._tipoImportacao === 'caixa';
      const badgeCor = isCaixa ? '#0284c7' : '#059669';
      const modeLabel = isCaixa ? 'CAIXA BM' : (isPref ? 'Padrão Prefeitura' : fmt);
      statusEl.innerHTML = `<span style="color:${badgeCor};font-weight:700">
        ✅ Formato ${modeLabel} — ${itens.filter(i=>!i.t).length} itens encontrados</span>`;
    }
    this._finalizarImport(bdiPct);
  }

  _detectarColunas(headers) {
    const cols = {item:-1,cod:-1,banco:-1,desc:-1,und:-1,qtd:-1,up:-1,upBdi:-1,total:-1};

    // Respeita escolha manual do usuário; se 'auto', detecta automaticamente
    const forcarCaixa = this._tipoImportacao === 'caixa';
    const forcarPref  = this._tipoImportacao === 'prefeitura';

    // Detecta se é formato CAIXA BM — limita colunas antes das colunas de evolução %
    const autoDetectCaixa = _detectarFormatoCaixa(headers);
    const ehCaixa = forcarCaixa || (!forcarPref && autoDetectCaixa);
    let limiteContratual = headers.length;

    for (let i=0;i<headers.length;i++) {
      const h = String(headers[i]||'').trim();
      // Para CAIXA: parar antes das colunas de evolução física/financeira
      if (ehCaixa && i >= 5) {
        if (/^(Acum|Período|Anterior|%|\d{1,3},\d{2})/i.test(h)) { limiteContratual=i; break; }
      }
      if (!ehCaixa && /^(%|ACUMULADO|MEDI[CÇ]|SALDO)/i.test(h) && i>=5) { limiteContratual=i; break; }
    }

    const headersContr = headers.slice(0, limiteContratual);
    headersContr.forEach((h,i) => {
      if (!h) return;
      const hn = h.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g,'').replace(/[^a-z0-9\s\.\+]/g,' ').trim();
      if (!hn) return;
      let melhorCampo=null, melhorScore=0;
      for (const [campo,aliases] of Object.entries(SI_ALIASES))
        for (const alias of aliases)
          if (new RegExp(alias,'i').test(hn) && alias.length > melhorScore) { melhorScore=alias.length; melhorCampo=campo; }
      if ((/valor.?unit/i.test(hn)||/v\.?unit/i.test(hn)||/preco.?unit/i.test(hn)) && !/bdi|\+/i.test(hn)) melhorCampo='up';
      if ((/valor.?unit/i.test(hn)||/v\.?unit/i.test(hn)) && /bdi|\+/i.test(hn))  melhorCampo='upBdi';
      if (/preco.?total/i.test(hn) || /p\.?\s*total/i.test(hn)) melhorCampo='total';
      if (melhorCampo && cols[melhorCampo]===-1) cols[melhorCampo]=i;
    });

    // Fallback posicional para formato CAIXA (Item, Discriminação, Und, Qtde, P.Unit, P.Total)
    if (ehCaixa) {
      const pos = headersContr.map((h,i)=>h.trim()?i:null).filter(v=>v!==null);
      if (pos.length >= 4) {
        if (cols.item ===-1) cols.item  = pos[0];
        if (cols.desc ===-1) cols.desc  = pos[1];
        if (cols.und  ===-1) cols.und   = pos[2];
        if (cols.qtd  ===-1) cols.qtd   = pos[3];
        if (cols.up   ===-1 && pos[4]) cols.up   = pos[4];
        if (cols.total===-1 && pos[5]) cols.total = pos[5];
      }
      this._formatoDetectado = 'CAIXA BM';
    } else {
      this._formatoDetectado = 'Genérico';
      const pos = headersContr.map((h,i)=>h.trim()?i:null).filter(v=>v!==null);
      if (pos.length >= 7) {
        if (cols.item  ===-1) cols.item  = pos[0];
        if (cols.cod   ===-1) cols.cod   = pos[1];
        if (cols.banco ===-1) cols.banco = pos[2];
        if (cols.desc  ===-1) cols.desc  = pos[3];
        if (cols.und   ===-1) cols.und   = pos[4];
        if (cols.qtd   ===-1) cols.qtd   = pos[5];
        if (cols.up    ===-1) cols.up    = pos[6];
        if (cols.upBdi ===-1 && pos[7]) cols.upBdi = pos[7];
        if (cols.total ===-1 && pos[8]) cols.total = pos[8];
      }
    }
    return cols;
  }

  _excelRowsToItens(dataRows, cols, bdiPct) {
    const bdiF=bdiPct/100, itens=[], vistos=new Set();
    const RE_ID    = /^(\d{1,3}(?:\.\d{1,3}){0,3})$/;
    const RE_UNITS = /^(M[²2³3]?|UN|VB|PT|CJ|KG|CHP|CHI|HR|HORA|MÊS|MES|TON|L|ML|CM|DM|KM|VERBA|LOTE|PAR|JG|SC|SAC|UND|M3XKM|U)$/i;
    for (const row of dataRows) {
      if (row.every(c=>!String(c).trim())) continue;
      const rawItem = String(row[cols.item]||'').trim();
      if (!rawItem) continue;
      const idClean = rawItem.replace(/\s+/g,'').replace(/\.+$/,'').replace(/^0+(?=\d)/,'');
      if (!RE_ID.test(idClean) || vistos.has(idClean)) continue;
      vistos.add(idClean);
      const desc  = String(cols.desc  >=0?(row[cols.desc] ||''):'').trim().toUpperCase();
      const und   = String(cols.und   >=0?(row[cols.und]  ||''):'').trim().toUpperCase();
      const cod   = String(cols.cod   >=0?(row[cols.cod]  ||''):'').trim();
      const banco = String(cols.banco >=0?(row[cols.banco]||''):'').trim();
      const qtd   = this._parseNum(cols.qtd  >=0?row[cols.qtd] :0);
      const up    = Math.round(this._parseNum(cols.up   >=0?row[cols.up]  :0)*100)/100;
      const upBdi = this._parseNum(cols.upBdi>=0?row[cols.upBdi]:0);
      const total = this._parseNum(cols.total>=0?row[cols.total]:0);
      const undValida = und && RE_UNITS.test(und);
      const ehGrupo   = (!undValida && qtd===0) || (!und && !qtd && !up);
      if (ehGrupo) {
        itens.push({id:idClean,t:'G',desc:desc||rawItem,total:total||0,und:'',qtd:0,up:0,bdi:bdiPct,cod,banco});
      } else {
        let upF = up;
        if (!upF && upBdi && bdiF) upF = Math.round(upBdi/(1+bdiF)*100)/100;
        if (!upF && total && qtd)  upF = Math.round(total/qtd/(1+bdiF)*100)/100;
        itens.push({id:idClean,desc:desc||rawItem,und:this._normUnit(und),qtd,up:upF,bdi:bdiPct,cod,banco});
      }
    }
    itens.sort((a,b)=>{
      const pa=a.id.split('.').map(Number),pb=b.id.split('.').map(Number);
      for(let i=0;i<Math.max(pa.length,pb.length);i++) if((pa[i]||0)!==(pb[i]||0)) return(pa[i]||0)-(pb[i]||0);
      return 0;
    });
    return itens;
  }

  // ─── Mapeamento manual ──────────────────────────────────────────
  _mostrarMapeamentoManual(headers, colsAuto) {
    const grid = document.getElementById('si-mapeamento-grid');
    if (!grid) return;
    const campos = [
      {key:'item',label:'1 — ITEM'},{key:'cod',label:'2 — CÓDIGO'},
      {key:'banco',label:'3 — BANCO'},{key:'desc',label:'4 — DESCRIÇÃO ★'},
      {key:'und',label:'5 — UNIDADE'},{key:'qtd',label:'6 — QUANTIDADE ★'},
      {key:'up',label:'7 — V.UNIT s/BDI'},{key:'upBdi',label:'8 — V.UNIT +BDI'},
      {key:'total',label:'9 — TOTAL'},
    ];
    const opts = headers.map((h,i)=>({idx:i,label:h.trim()})).filter(o=>o.label.length>0);
    grid.innerHTML = campos.map(({key,label}) => `
      <div>
        <label style="font-size:10px;color:#94a3b8;display:block;margin-bottom:3px;font-weight:600">${this._esc(label)}</label>
        <select id="si-map-${key}"
          style="width:100%;padding:6px 8px;border:1px solid #2d3748;border-radius:5px;font-size:11.5px;background:#0d111a;color:#f1f5f9">
          <option value="-1">— Não disponível —</option>
          ${opts.map(o=>`<option value="${o.idx}" ${colsAuto&&colsAuto[key]===o.idx?'selected':''}>${o.idx+1}: ${this._esc(o.label.slice(0,40))}</option>`).join('')}
        </select>
      </div>`).join('');
    this._mostrarFase('mapeamento');
  }

  _aplicarMapeamento() {
    const campos = ['item','cod','banco','desc','und','qtd','up','upBdi','total'];
    const cols   = {};
    campos.forEach(c => { const sel=document.getElementById('si-map-'+c); cols[c]=sel?parseInt(sel.value):-1; });
    if (cols.item<0||cols.desc<0) { if(typeof toast==='function') toast('⚠️ ITEM e DESCRIÇÃO são obrigatórios.','warn'); return; }
    this._colsDetectadas = cols;
    const bdiPct = parseFloat(document.getElementById('si-bdi')?.value||25);
    const itens  = this._excelRowsToItens(this._rawData, cols, bdiPct);
    if (!itens.length) { if(typeof toast==='function') toast('❌ Nenhum item com esse mapeamento.','err'); return; }
    this._itensExtraidos = itens;
    this._log(`Mapeamento manual: ${itens.filter(i=>!i.t).length} itens.`);
    this._finalizarImport(bdiPct);
  }

  // ─── Extrai metadados ───────────────────────────────────────────
  _extrairMeta(texto) {
    const obj=document.getElementById('si-objeto'), ctr=document.getElementById('si-contrato'),
          ctnte=document.getElementById('si-contratante'), ctda=document.getElementById('si-contratada');
    if (obj && !obj.value) {
      let m = texto.match(/OBJETO\s*[:\-]?\s*([A-ZÁÉÍÓÚÃÕÂÊÎÔÛÇ][^\n]{10,250})/i);
      if (m) obj.value = m[1].trim().split(/\s{3,}/)[0].slice(0,150).trim();
      else { m = texto.match(/BOLETIM\s+DE\s+MEDI[CÇ][AÃ]O[^]*?(CONSTRU[CÇ][AÃ]O\s+[^\n]{10,200})/i);
             if (m) obj.value = m[1].trim().split(/\s{3,}/)[0].slice(0,150).trim(); }
    }
    if (ctr && !ctr.value) { const m=texto.match(/CONTRATO\s*N[°ºO\.]\s*(?:[:\-]\s*)?([^\s\n]{3,20})/i); if(m) ctr.value=m[1].trim(); }
    if (ctnte && !ctnte.value) { const m=texto.match(/CONTRATANTE\s*[:\-]?\s*([A-ZÁÉÍÓÚÃÕ][^\n]{5,100})/i); if(m) ctnte.value=m[1].trim().split(/[.\n]/)[0].slice(0,80); }
    if (ctda && !ctda.value) { const m=texto.match(/CONTRATADA\s*[:\-]?\s*([A-ZÁÉÍÓÚÃÕ][^\n]{5,100})/i); if(m) ctda.value=m[1].trim().split(/\s{2,}|\n/)[0].replace(/\s*[\(].*/,'').slice(0,80).trim(); }
    const mBdi=texto.match(/BDI\s*[:\-]?\s*([\d,\.]+)\s*%/i);
    if (mBdi) { const el=document.getElementById('si-bdi'); if(el) el.value=parseFloat(mBdi[1].replace(',','.'))||25; }

    // ── Novos campos v13.2 ──────────────────────────────────────────────
    const fiscal   = document.getElementById('si-fiscal');
    const processo = document.getElementById('si-processo');
    const unidade  = document.getElementById('si-unidade');
    const inicio   = document.getElementById('si-inicio');
    const termino  = document.getElementById('si-termino');
    const prazo    = document.getElementById('si-prazo');

    if (fiscal && !fiscal.value) {
      const m = texto.match(/FISCAL\s*[:\-]?\s*(?:DO\s+CONTRATO)?\s*[:\-]?\s*([A-ZÁÉÍÓÚÃÕ][^\n]{3,80})/i);
      if (m) fiscal.value = m[1].trim().split(/\s{2,}|\n/)[0].slice(0,80);
    }
    if (processo && !processo.value) {
      const m = texto.match(/PROCESSO\s*N[°ºO\.]?\s*[:\-]?\s*([\d\/\-\.]{3,30})/i);
      if (m) processo.value = m[1].trim();
    }
    if (unidade && !unidade.value) {
      const m = texto.match(/UNIDADE\s+RESPONS[AÁ]VEL\s*[:\-]?\s*([A-ZÁÉÍÓÚÃÕ][^\n]{5,100})/i)
             || texto.match(/SECRET[AÁ]RIA\s+(?:DE|DE\s+ESTADO)?\s+[A-ZÁÉÍÓÚÃÕ][^\n]{5,80}/i);
      if (m) unidade.value = m[0].trim().slice(0,100);
    }
    if (inicio && !inicio.value) {
      const m = texto.match(/(?:DATA\s+DE\s+IN[IÍ]CIO|INÍCIO|INICIO)\s*[:\-]?\s*(\d{1,2}[\/-]\d{1,2}[\/-]\d{2,4})/i);
      if (m) { const parts = m[1].split(/[\/\-]/); if(parts.length===3) {
        const [d,mo,y] = parts.map(Number);
        const yr = y < 100 ? 2000+y : y;
        inicio.value = `${yr}-${String(mo).padStart(2,'0')}-${String(d).padStart(2,'0')}`;
      }}
    }
    if (termino && !termino.value) {
      const m = texto.match(/(?:PRAZO\s+DE\s+T[EÉ]RMINO|TÉRMINO|TERMINO|VENCIMENTO|FIM\s+DO\s+CONTRATO)\s*[:\-]?\s*(\d{1,2}[\/-]\d{1,2}[\/-]\d{2,4})/i);
      if (m) { const parts = m[1].split(/[\/\-]/); if(parts.length===3) {
        const [d,mo,y] = parts.map(Number);
        const yr = y < 100 ? 2000+y : y;
        termino.value = `${yr}-${String(mo).padStart(2,'0')}-${String(d).padStart(2,'0')}`;
      }}
    }
    if (prazo && !prazo.value) {
      const m = texto.match(/PRAZO\s*[:\-]?\s*(\d+)\s*(?:DIAS|dias)/i);
      if (m) prazo.value = parseInt(m[1]);
    }

    // ── Campos importados automaticamente v14 ─────────────────────────────
    const creaFiscal      = document.getElementById('si-crea-fiscal');
    const cnpjContratada  = document.getElementById('si-cnpj-contratada');
    const cnpjContratante = document.getElementById('si-cnpj-contratante');

    if (creaFiscal && !creaFiscal.value) {
      const m = texto.match(/CREA(?:[-\s]?[A-Z]{0,2})?[-\s]?(?:N[°º\.:]?\s*)?([\d]{3,10}[-/][A-Z]?)/i)
             || texto.match(/CAU[-\s]?(?:N[°º\.:]?\s*)?([A-Z0-9]{5,20})/i)
             || texto.match(/(?:CREA|CAU)\s*[:\-]?\s*([A-Z0-9][^\n]{3,30})/i);
      if (m) creaFiscal.value = m[0].trim().slice(0, 40);
    }
    if (cnpjContratada && !cnpjContratada.value) {
      // Procura CNPJ próximo à palavra CONTRATADA
      const mBloco = texto.match(/CONTRATAD[AO]\s*[:\-]?[^\n]{0,200}/i);
      const bloco  = mBloco ? mBloco[0] : texto;
      const m = bloco.match(/\d{2}\.?\d{3}\.?\d{3}\/?\d{4}-?\d{2}/);
      if (m) cnpjContratada.value = m[0].trim();
    }
    if (cnpjContratante && !cnpjContratante.value) {
      // Procura CNPJ próximo à palavra CONTRATANTE
      const mBloco = texto.match(/CONTRATANTE\s*[:\-]?[^\n]{0,200}/i);
      const bloco  = mBloco ? mBloco[0] : '';
      const m = bloco.match(/\d{2}\.?\d{3}\.?\d{3}\/?\d{4}-?\d{2}/);
      if (m) cnpjContratante.value = m[0].trim();
    }
  }

  // ─── Finalização ────────────────────────────────────────────────
  _finalizarImport(bdiPct) {
    const v = this._validarItens(this._itensExtraidos, bdiPct);
    this._validacao = v;
    this._log(`\n=== TCU ===\nTotal:${v.totalItens} Corretos:${v.corretos} Divergentes:${v.divergentes.length} Conformidade:${v.conformidade.toFixed(1)}%`);
    this._log(`Total calculado: R$ ${v.totalCalculado.toLocaleString('pt-BR',{minimumFractionDigits:2})}`);
    v.divergentes.forEach(d => this._log(`  ⚠ [${d.id}] Δ R$ ${Math.abs(d.diff).toFixed(2)}`));
    this._renderizarResumo(v);
    this._renderizarPreview(this._itensExtraidos, v, bdiPct);
    this._renderizarRelatorio(v);
    const logEl = document.getElementById('si-aba-log');
    if (logEl) logEl.textContent = this._logLines.join('\n');
    const count  = this._itensExtraidos.filter(i=>!i.t).length;
    const grupos = this._itensExtraidos.filter(i=>i.t).length;
    const ci = document.getElementById('si-count-info');
    if (ci) ci.textContent = `${count} serviços · ${grupos} grupos`;
    const st = document.getElementById('si-status');
    if (st) st.innerHTML = `<span style="color:#4ade80">✅ ${count} itens · ${v.conformidade.toFixed(1)}% conformidade TCU</span>`;
    const btn = document.getElementById('si-btn-criar');
    if (btn) btn.textContent = this._modo==='nova' ? '✅ Criar Obra e Importar' : '✅ Inserir Itens na Obra Ativa';
    this._mostrarFase('preview');
    this._abaAtiva('preview');
  }

  // ─── Validação TCU ──────────────────────────────────────────────
  _validarItens(itens, bdiPct) {
    const bdiF=bdiPct/100, itensSvc=itens.filter(i=>!i.t), divergentes=[];
    let totalCalculado = 0;
    itensSvc.forEach(it => {
      const upBdi=Math.round(it.up*(1+bdiF)*100)/100;
      const totalCalc=Math.round(it.qtd*upBdi*100)/100;
      totalCalculado += totalCalc;
      const totalPDF  = it._totalOriginal || 0;
      const problemas = [];
      if (it.qtd<=0) problemas.push('Quantidade zero');
      if (it.up<0)   problemas.push('Valor negativo');
      if (totalPDF>0 && Math.abs(totalCalc-totalPDF)>0.01)
        problemas.push(`Total: PDF=${this._R(totalPDF)} Calc=${this._R(totalCalc)}`);
      if (problemas.length) divergentes.push({id:it.id,desc:it.desc,totalPDF,totalCalc,diff:totalPDF-totalCalc,problemas});
      it._upBdi=upBdi; it._totalCalc=totalCalc; it._ok=!problemas.length;
    });
    const corretos     = itensSvc.length - divergentes.length;
    const conformidade = itensSvc.length > 0 ? corretos/itensSvc.length*100 : 100;
    return { totalItens:itensSvc.length, corretos, divergentes, conformidade, totalCalculado };
  }

  // ─── Renderização ───────────────────────────────────────────────
  _renderizarResumo(v) {
    const el = document.getElementById('si-resumo-validacao');
    if (!el) return;
    el.innerHTML = `
      <div style="background:#0f172a;border:1px solid #86efac;border-radius:8px;padding:12px;text-align:center">
        <div style="font-size:22px;font-weight:800;color:#4ade80">${v.corretos}</div>
        <div style="font-size:9px;color:#94a3b8;text-transform:uppercase;margin-top:2px">✔ CORRETOS</div>
      </div>
      <div style="background:#0f172a;border:1px solid ${v.divergentes.length?'#fca5a5':'#86efac'};border-radius:8px;padding:12px;text-align:center">
        <div style="font-size:22px;font-weight:800;color:${v.divergentes.length?'#dc2626':'#4ade80'}">${v.divergentes.length}</div>
        <div style="font-size:9px;color:#94a3b8;text-transform:uppercase;margin-top:2px">✗ DIVERGENTES</div>
      </div>
      <div style="background:#0f172a;border:1px solid #7dd3fc;border-radius:8px;padding:12px;text-align:center">
        <div style="font-size:22px;font-weight:800;color:#38bdf8">${v.conformidade.toFixed(1)}%</div>
        <div style="font-size:9px;color:#94a3b8;text-transform:uppercase;margin-top:2px">CONFORMIDADE TCU</div>
      </div>
      <div style="background:#0f172a;border:1px solid #d8b4fe;border-radius:8px;padding:12px;text-align:center">
        <div style="font-size:12px;font-weight:800;color:#a78bfa">${v.totalCalculado.toLocaleString('pt-BR',{style:'currency',currency:'BRL',minimumFractionDigits:2})}</div>
        <div style="font-size:9px;color:#94a3b8;text-transform:uppercase;margin-top:2px">TOTAL CALCULADO</div>
      </div>
    `;
  }

  _renderizarPreview(itens, v, bdiPct) {
    const tbody = document.getElementById('si-preview-tbody');
    if (!tbody) return;
    const bdiF   = bdiPct/100;
    const divSet = new Set(v.divergentes.map(d=>d.id));
    tbody.innerHTML = itens.map(it => {
      if (it.t === 'G') return `<tr style="background:#1e293b;color:#f1f5f9">
        <td colspan="9" style="padding:5px 8px;font-weight:700;font-size:10px">
          <span style="color:#60a5fa;font-family:monospace">${this._esc(it.id)}</span> ${this._esc(it.desc)}
          ${it.total>0?`<span style="float:right;color:#34d399">${this._R(it.total)}</span>`:''}
        </td><td style="background:#1e293b;color:#6b7280;padding:5px 4px;text-align:center">—</td></tr>`;
      const upBdi=Math.round(it.up*(1+bdiF)*100)/100, totCalc=Math.round(it.qtd*upBdi*100)/100, ok=!divSet.has(it.id);
      return `<tr style="border-bottom:1px solid #1e2330${ok?'':';background:#2a1515'}">
        <td style="padding:4px 6px;font-family:monospace;font-size:9.5px;color:#94a3b8">${this._esc(it.id)}</td>
        <td style="padding:4px 6px;font-size:9.5px;color:#6b7280">${this._esc(it.cod||'—')}</td>
        <td style="padding:4px 6px;font-size:9.5px">${it.banco?`<span style="background:#0c2a3a;color:#38bdf8;border-radius:3px;padding:1px 5px;font-size:9px">${this._esc(it.banco)}</span>`:'—'}</td>
        <td style="padding:4px 6px;font-size:10px;color:#f1f5f9">${this._esc(it.desc.slice(0,70))}${it.desc.length>70?'…':''}</td>
        <td style="padding:4px 6px;text-align:center;font-size:10px;color:#94a3b8">${this._esc(it.und)}</td>
        <td style="padding:4px 8px;text-align:right;font-family:monospace;font-size:10px;color:#94a3b8">${it.qtd.toLocaleString('pt-BR',{minimumFractionDigits:2})}</td>
        <td style="padding:4px 8px;text-align:right;font-family:monospace;font-size:10px;color:#cbd5e1">${this._R(it.up)}</td>
        <td style="padding:4px 8px;text-align:right;font-family:monospace;font-size:10px;color:#f1f5f9">${this._R(upBdi)}</td>
        <td style="padding:4px 8px;text-align:right;font-family:monospace;font-size:10.5px;font-weight:700;color:${ok?'#f1f5f9':'#dc2626'}">${this._R(totCalc)}</td>
        <td style="padding:4px 4px;text-align:center">${ok?'<span style="color:#4ade80;font-size:13px">✓</span>':'<span style="color:#dc2626;font-size:13px">✗</span>'}</td>
      </tr>`;
    }).join('');
  }

  _renderizarRelatorio(v) {
    const el = document.getElementById('si-aba-relatorio');
    if (!el) return;
    const now=new Date().toLocaleString('pt-BR'), bdi=parseFloat(document.getElementById('si-bdi')?.value||25);
    const obra=document.getElementById('si-objeto')?.value||'Obra';
    let html = `<div style="padding:14px;font-size:12px;color:#f1f5f9">
      <div style="font-weight:800;font-size:14px;margin-bottom:2px">📊 Relatório de Conferência — Padrão TCU</div>
      <div style="color:#6b7280;font-size:11px;margin-bottom:14px">Gerado: ${now} · BDI: ${bdi}% · ${this._esc(obra.slice(0,80))}</div>
      <div style="background:#0f1a0f;border-left:4px solid #4ade80;padding:12px;border-radius:0 6px 6px 0;margin-bottom:14px">
        <div style="font-weight:700;color:#4ade80;margin-bottom:4px">✔ CORRETOS (${v.corretos})</div>
        <div style="max-height:200px;overflow-y:auto">
          ${this._itensExtraidos.filter(i=>!i.t&&i._ok!==false).slice(0,100).map(it=>`
            <div style="display:flex;justify-content:space-between;padding:3px 0;border-bottom:1px solid #1a2a1a;font-size:11px">
              <span><code style="color:#4ade80">${this._esc(it.id)}</code> ${this._esc(it.desc.slice(0,55))}${it.desc.length>55?'…':''}</span>
              <span style="font-family:monospace;color:#94a3b8">${this._R(it._totalCalc||0)}</span>
            </div>`).join('')}
        </div>
      </div>`;
    if (v.divergentes.length) {
      html += `<div style="background:#1a0a0a;border-left:4px solid #dc2626;padding:12px;border-radius:0 6px 6px 0;margin-bottom:14px">
        <div style="font-weight:700;color:#dc2626;margin-bottom:6px">✗ DIVERGENTES (${v.divergentes.length})</div>
        ${v.divergentes.map(d=>`<div style="padding:6px 8px;background:#0f172a;border:1px solid #7f1d1d;border-radius:5px;margin-bottom:6px;font-size:11px">
          <div style="font-weight:700;color:#dc2626">[${this._esc(d.id)}] ${this._esc(d.desc.slice(0,60))}${d.desc.length>60?'…':''}</div>
          ${d.problemas.map(p=>`<div style="color:#fca5a5;margin-top:2px">• ${this._esc(p)}</div>`).join('')}
          <div style="display:flex;gap:12px;margin-top:4px;font-family:monospace;color:#94a3b8">
            ${d.totalPDF>0?`<span>PDF:${this._R(d.totalPDF)}</span>`:''}
            <span>Calc:${this._R(d.totalCalc)}</span>
            ${d.totalPDF>0?`<span style="color:#dc2626">Δ R$ ${Math.abs(d.diff).toFixed(2)}</span>`:''}
          </div></div>`).join('')}
      </div>`;
    } else {
      html += `<div style="background:#0f1a0f;border:1px solid #4ade80;border-radius:6px;padding:10px;text-align:center;color:#4ade80;font-weight:700">🎉 Todos corretos! Conformidade 100%.</div>`;
    }
    html += `<div style="margin-top:12px;background:#0d111a;border:1px solid #2d3748;border-radius:6px;padding:12px;font-size:11px;color:#94a3b8">
      <div style="font-weight:700;color:#f1f5f9;margin-bottom:6px">📋 Resumo Técnico</div>
      <div>• Total de itens: <strong style="color:#f1f5f9">${v.totalItens}</strong></div>
      <div>• Corretos: <strong style="color:#4ade80">${v.corretos}</strong></div>
      <div>• Divergentes: <strong style="color:#dc2626">${v.divergentes.length}</strong></div>
      <div>• Conformidade: <strong style="color:#38bdf8">${v.conformidade.toFixed(2)}%</strong></div>
      <div>• Total calculado: <strong style="color:#a78bfa">${v.totalCalculado.toLocaleString('pt-BR',{style:'currency',currency:'BRL',minimumFractionDigits:2})}</strong></div>
      <div>• BDI: <strong style="color:#f1f5f9">${bdi}%</strong></div>
      <div>• Fórmula: <code style="color:#60a5fa">TOTAL = QTD × (V.UNIT s/BDI × (1 + BDI%))</code></div>
    </div></div>`;
    el.innerHTML = html;
  }

  // ─── Criar Obra / Inserir ───────────────────────────────────────
  async _criarObra() {
    if (!this._itensExtraidos?.length) {
      if (typeof toast==='function') toast('⚠️ Nenhum item para importar.','warn'); return;
    }
    const objeto      = (document.getElementById('si-objeto')?.value||'Nova Obra').trim().toUpperCase()||'NOVA OBRA';
    const contrato    = (document.getElementById('si-contrato')?.value||'').trim();
    const bdiPct      = parseFloat(document.getElementById('si-bdi')?.value||25);
    const bdiF        = bdiPct/100;
    const contratante = (document.getElementById('si-contratante')?.value||'').trim();
    const contratada  = (document.getElementById('si-contratada')?.value||'').trim();

    const itensMontados = this._itensExtraidos.map(it =>
      it.t==='G'
        ? {id:it.id,t:'G',desc:it.desc,total:it.total||0}
        : {id:it.id,cod:it.cod||'',banco:it.banco||'',desc:it.desc,und:it.und||'UN',qtd:it.qtd||0,up:it.up||0,bdi:bdiPct}
    );
    const nSvc = itensMontados.filter(i=>!i.t).length;
    const nGrp = itensMontados.filter(i=>i.t).length;

    // INSERIR
    if (this._modo === 'inserir') {
      const obraAtivaId = state.get('obraAtivaId');
      if (!obraAtivaId) { if(typeof toast==='function') toast('❌ Nenhuma obra ativa.','warn'); return; }
      const obrasLista  = state.get('obrasLista')||[];
      const nomeObra    = obrasLista.find(o=>o.id===obraAtivaId)?.nome || obraAtivaId;
      if (!confirm(`INSERIR NA OBRA ATIVA\n\nObra: "${nomeObra.slice(0,60)}"\nItens: ${nSvc} + ${nGrp} grupos\n\nConfirmar?`)) return;
      const itensAtuais = state.get('itensContrato')||[];
      const idsExist    = new Set(itensAtuais.map(i=>i.id));
      const novos       = itensMontados.filter(i=>!idsExist.has(i.id));
      if (!novos.length) { if(typeof toast==='function') toast('⚠️ Todos já existem.','warn'); return; }
      const itensNovos = [...itensAtuais,...novos];
      state.set('itensContrato', itensNovos);
      await FirebaseService.setItens(obraAtivaId, itensNovos);
      EventBus.emit('itens:atualizados', {obraId:obraAtivaId});
      router.navigate('boletim');
      if (typeof toast==='function') toast(`✅ ${novos.length} item(ns) inserido(s).`);
      return;
    }

    // NOVA OBRA
    const btn = document.getElementById('si-btn-criar');
    // P5 — feedback visual: usa LoadingIndicator.button para spinner + desabilitar
    const executarCriacao = async () => {
    try {
      const valor    = itensMontados.filter(i=>!i.t).reduce((acc,it)=>acc+(it.qtd||0)*Math.round(it.up*(1+bdiF)*100)/100, 0);
      const novoId   = 'obra_'+Date.now().toString(16);
      const fiscal          = (document.getElementById('si-fiscal')?.value||'').trim();
      const creaFiscalImp   = (document.getElementById('si-crea-fiscal')?.value||'').trim();
      const cnpjContratadaImp=(document.getElementById('si-cnpj-contratada')?.value||'').trim();
      const cnpjContratanteImp=(document.getElementById('si-cnpj-contratante')?.value||'').trim();
      const processo  = (document.getElementById('si-processo')?.value||'').trim();
      const unidade   = (document.getElementById('si-unidade')?.value||'').trim();
      const inicioPrev= (document.getElementById('si-inicio')?.value||'').trim();
      const terminoPrev=(document.getElementById('si-termino')?.value||'').trim();
      const prazoD    = parseInt(document.getElementById('si-prazo')?.value||'0')||0;
      // CAIXA-specific metadata
      const tcCr     = (document.getElementById('si-tc-cr')?.value||'').trim();
      const convenio = (document.getElementById('si-convenio')?.value||'').trim();
      const ctef     = (document.getElementById('si-ctef')?.value||'').trim();
      const programa = (document.getElementById('si-programa')?.value||'').trim();
      const tipoObra = this._tipoImportacao === 'caixa' ? 'caixa' : 'prefeitura';
      const cfgNova  = { contrato, bdi:bdiF, objeto:objeto.slice(0,150), contratante, contratada,
                         cnpj:cnpjContratadaImp, valor:Math.round(valor*100)/100,
                         fiscal, creaFiscal:creaFiscalImp, rt:'', creaRT:'',
                         cnpjContratante:cnpjContratanteImp,
                         duracaoDias:prazoD, inicioPrev, inicioReal:'', termino:terminoPrev,
                         numeroProcesso:processo, unidadeResponsavel:unidade,
                         modoCalculo:'truncar', tipoObra,
                         _importadoEm: new Date().toISOString(),
                         // CAIXA
                         ...(tipoObra==='caixa' ? { tcCr, convenio, ctef, programa } : {}) };
      const bmsPadrao = [{num:1,label:'BM 01',mes:'(a definir)',data:'',contractVersion:1}];

      await FirebaseService.criarObra(novoId, objeto.slice(0,100), tipoObra, cfgNova, bmsPadrao, itensMontados);

      const obrasLista = state.get('obrasLista')||[];
      state.set('obrasLista', [...obrasLista, {id:novoId,nome:objeto.slice(0,100),tipo:tipoObra,statusObra:'Em andamento'}]);
      state.set('obraAtivaId',   novoId);
      state.set('cfg',           cfgNova);
      state.set('bms',           bmsPadrao);
      state.set('itensContrato', itensMontados);
      state.persist(['obraAtivaId']);

      EventBus.emit('obra:criada',      {obraId:novoId, nome:objeto});
      EventBus.emit('obra:selecionada', {obraId:novoId});

      this._itensExtraidos = []; this._logLines = [];
      router.navigate('boletim');
      if (typeof toast==='function') toast(`✅ Obra criada! ${nSvc} item(ns) + ${nGrp} grupo(s). BM 01 gerado.`);
    } catch (err) {
      console.error('[ImportacaoModule] _criarObra:', err);
      if (typeof toast==='function') toast(`❌ Erro: ${err.message}`,'err');
    }
    }; // fim executarCriacao

    // Chama via LoadingIndicator.button se btn existir; senão executa direto
    if (btn) {
      LoadingIndicator.button(btn, executarCriacao, 'Criando obra…');
    } else {
      executarCriacao();
    }
  }

  // ─── Exportar PDF ───────────────────────────────────────────────
  _exportarRelatorioPDF() {
    if (!this._validacao) { if(typeof toast==='function') toast('⚠️ Processe um arquivo primeiro.','warn'); return; }
    const bdi=parseFloat(document.getElementById('si-bdi')?.value||25);
    const obra=document.getElementById('si-objeto')?.value||'Obra';
    const v=this._validacao, now=new Date().toLocaleString('pt-BR');
    const w=window.open('','_blank','width=950,height=750');
    w.document.write(`<!DOCTYPE html><html><head><meta charset="UTF-8">
      <title>Relatório TCU — ${this._esc(obra)}</title>
      <style>body{font-family:Arial,sans-serif;font-size:11px;color:#1e293b;padding:20px;max-width:950px;margin:0 auto}
      h1{font-size:15px;border-bottom:3px solid #1e3a5f;padding-bottom:8px}
      h2{font-size:12px;padding:4px 8px;background:#f1f5f9;border-radius:4px;margin-top:20px}
      .meta{color:#6b7280;font-size:10px;margin-bottom:16px}
      table{width:100%;border-collapse:collapse;font-size:10px}
      th{background:#1e3a5f;color:#fff;padding:5px 6px;text-align:left}
      td{padding:4px 6px;border-bottom:1px solid #e5e7eb}
      .div-row{background:#fff5f5}.grupo-row{background:#1e293b;color:#fff}
      .badge{display:inline-block;padding:1px 6px;border-radius:10px;font-size:9px;font-weight:700}
      .ok-b{background:#dcfce7;color:#1A1A1A}.err-b{background:#fee2e2;color:#dc2626}
      .summary{display:grid;grid-template-columns:repeat(4,1fr);gap:10px;margin:14px 0}
      .kpi{text-align:center;padding:10px;border:1px solid #e5e7eb;border-radius:6px}
      .kpi .val{font-size:20px;font-weight:800}.kpi .lbl{font-size:9px;color:#6b7280;margin-top:2px}
      @media print{button{display:none}@page{size:A4 landscape}}</style>
    </head><body>
      <h1>📊 Relatório de Conferência — Padrão TCU</h1>
      <div class="meta"><strong>Obra:</strong> ${this._esc(obra)} &nbsp;|&nbsp; <strong>BDI:</strong> ${bdi}% &nbsp;|&nbsp; <strong>Gerado:</strong> ${now} &nbsp;|&nbsp;
        <strong>Total:</strong> ${v.totalCalculado.toLocaleString('pt-BR',{style:'currency',currency:'BRL',minimumFractionDigits:2})}</div>
      <div class="summary">
        <div class="kpi"><div class="val" style="color:#059669">${v.corretos}</div><div class="lbl">✔ CORRETOS</div></div>
        <div class="kpi"><div class="val" style="color:#dc2626">${v.divergentes.length}</div><div class="lbl">✗ DIVERGENTES</div></div>
        <div class="kpi"><div class="val" style="color:#0369a1">${v.conformidade.toFixed(1)}%</div><div class="lbl">CONFORMIDADE</div></div>
        <div class="kpi"><div class="val" style="color:#7c3aed;font-size:13px">${v.totalCalculado.toLocaleString('pt-BR',{style:'currency',currency:'BRL',minimumFractionDigits:2})}</div><div class="lbl">TOTAL</div></div>
      </div>
      ${v.divergentes.length?`<h2>✗ Divergentes</h2><table><thead><tr><th>Item</th><th>Descrição</th><th>PDF</th><th>Calculado</th><th>Δ</th><th>Problema</th></tr></thead><tbody>
        ${v.divergentes.map(d=>`<tr class="div-row"><td style="font-family:monospace">${this._esc(d.id)}</td><td>${this._esc(d.desc.slice(0,60))}${d.desc.length>60?'…':''}</td>
          <td style="text-align:right">${d.totalPDF>0?this._R(d.totalPDF):'—'}</td><td style="text-align:right">${this._R(d.totalCalc)}</td>
          <td style="text-align:right;color:#dc2626">R$ ${Math.abs(d.diff).toFixed(2)}</td><td>${d.problemas.join('; ')}</td></tr>`).join('')}
        </tbody></table>`
      :'<div style="padding:10px;background:#f0fdf4;border-radius:6px;color:#1A1A1A;font-weight:700;text-align:center">✅ Todos corretos.</div>'}
      <h2>Todos os Itens</h2>
      <table><thead><tr><th>Item</th><th>Código</th><th>Banco</th><th style="min-width:180px">Descrição</th><th>Und</th>
        <th style="text-align:right">Qtd</th><th style="text-align:right">V.Unit s/BDI</th><th style="text-align:right">V.Unit +BDI</th><th style="text-align:right">Total</th><th>✓</th></tr></thead>
      <tbody>${this._itensExtraidos.map(it=>{
        if(it.t==='G') return `<tr class="grupo-row"><td colspan="10" style="padding:4px 8px;font-weight:700">${this._esc(it.id)} — ${this._esc(it.desc)}</td></tr>`;
        const upBdi=Math.round(it.up*(1+bdi/100)*100)/100, tot=Math.round(it.qtd*upBdi*100)/100;
        return `<tr${it._ok===false?' class="div-row"':''}><td style="font-family:monospace">${this._esc(it.id)}</td><td>${this._esc(it.cod||'')}</td><td>${this._esc(it.banco||'')}</td>
          <td>${this._esc(it.desc.slice(0,60))}${it.desc.length>60?'…':''}</td><td style="text-align:center">${this._esc(it.und)}</td>
          <td style="text-align:right">${it.qtd.toLocaleString('pt-BR',{minimumFractionDigits:2})}</td><td style="text-align:right">${this._R(it.up)}</td>
          <td style="text-align:right">${this._R(upBdi)}</td><td style="text-align:right;font-weight:700">${this._R(tot)}</td>
          <td style="text-align:center">${it._ok!==false?'<span class="badge ok-b">OK</span>':'<span class="badge err-b">ERR</span>'}</td></tr>`;
      }).join('')}</tbody></table>
      <button onclick="window.print()" style="margin-top:20px;padding:10px 20px;background:#1e3a5f;color:#fff;border:none;border-radius:6px;cursor:pointer;font-size:12px;font-weight:700">🖨️ Imprimir / Salvar PDF</button>
    </body></html>`);
    w.document.close();
  }

  // ─── Utilitários ────────────────────────────────────────────────
  _parseNum(s) {
    if (typeof s==='number') return isNaN(s)?0:s;
    if (!s) return 0;
    const c=String(s).replace(/R\$\s*/g,'').replace(/[^\d.,\-]/g,'').trim();
    if (!c) return 0;
    if (/^\-?\d{1,3}(\.\d{3})+,\d+$/.test(c)) return parseFloat(c.replace(/\./g,'').replace(',','.'))||0;
    if (/^\-?\d+,\d+$/.test(c)&&!/\./.test(c)) return parseFloat(c.replace(',','.'))||0;
    if (/^\-?\d{1,3}(,\d{3})+\.\d+$/.test(c)) return parseFloat(c.replace(/,/g,''))||0;
    if (/^\-?\d+\.\d+$/.test(c)) return parseFloat(c)||0;
    if (/^\-?\d+$/.test(c)) return parseInt(c)||0;
    return parseFloat(c)||0;
  }
  _normUnit(s) { const u=String(s||'').toUpperCase().trim(); return ({'M2':'M²','M²':'M²','M3':'M³','M³':'M³','HORA':'H','MES':'MÊS','UND':'UN'})[u]||u; }
  _log(msg) { this._logLines.push(`[${new Date().toISOString().split('T')[1].slice(0,8)}] ${msg}`); }
  _R(v) { return (Math.round((v||0)*100)/100).toLocaleString('pt-BR',{style:'currency',currency:'BRL',minimumFractionDigits:2}); }
  _esc(s) { return String(s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;'); }

  // ─── Globals ────────────────────────────────────────────────────
  _bindWindowGlobals() {
    window._siHandleDrop          = (e)   => this._handleDrop(e);
    window._siProcessarArquivo    = (e)   => this._processarArquivo(e);
    window._siAbaAtiva            = (a)   => this._abaAtiva(a);
    window._siAplicarMapeamento   = ()    => this._aplicarMapeamento();
    window._siVoltarUpload        = ()    => this._voltarUpload();
    window._siCriarObra           = ()    => this._criarObra();
    window._siExportarRelatorioPDF= ()    => this._exportarRelatorioPDF();
    window._siSetModo             = (m)   => this._setModo(m);
    window._siSetTipoImportacao   = (t)   => { this._tipoImportacao = t; this._render(); };
  }

  _bindEvents() {
    this._subs.push(EventBus.on('obra:selecionada', () => {
      try { if (router.current==='importacao') this._render(); } catch(e) {}
    }, 'importacao'));
  }

  _exposeGlobals() {
    window.abrirSmartImport      = (modo) => { router.navigate('importacao'); if(modo) this._modo=modo; };
    window.fecharSmartImport     = ()     => router.navigate('dashboard');
    window.abrirModalImportarPDF = (modo) => { router.navigate('importacao'); if(modo) this._modo=modo; };
  }

  destroy() {
    this._subs.forEach(u=>u()); this._subs=[];
    ['_siHandleDrop','_siProcessarArquivo','_siAbaAtiva','_siAplicarMapeamento',
     '_siVoltarUpload','_siCriarObra','_siExportarRelatorioPDF','_siSetModo'].forEach(k=>{try{delete window[k];}catch(e){}});
  }
}
