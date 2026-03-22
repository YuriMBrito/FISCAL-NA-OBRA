/**
 * ╔══════════════════════════════════════════════════════════════════╗
 * ║  FISCAL NA OBRA v15 — importacao-bm-pdf-controller.js           ║
 * ║  Módulo: Importar BM a partir de PDF (Modelo Convênio / Caixa)  ║
 * ╚══════════════════════════════════════════════════════════════════╝
 *
 * OBJETIVO
 * ─────────
 * Importar Boletins de Medição no formato utilizado pela Caixa Econômica
 * Federal (BM GIGOV / Convênio). Este módulo é COMPLETAMENTE INDEPENDENTE
 * do importacao-controller.js — não altera, não substitui, não depende dele.
 *
 * REGRAS DE CÁLCULO (CAIXA)
 * ──────────────────────────
 * • Preços já incluem BDI → todos os itens são criados com bdi = 0
 * • up  = precoUnitario exatamente como no PDF
 * • total = qtd × up × (1 + 0) = qtd × up  ← cálculo correto
 * • O sistema NÃO aplica BDI adicional
 *
 * ESTRUTURA DO FIRESTORE GERADA
 * ──────────────────────────────
 *   obras/{id}/
 *     cfg/cfg          → metadados da obra (objeto, contrato, datas, etc.)
 *     bms/bms          → lista de BMs  [{ num, label, mes, data, ... }]
 *     itens/           → itens do contrato com bdi=0
 *     medicoes/bm{N}   → medições do BM importado
 *
 * MODO NOVA OBRA
 *   Cria obra, itens e o BM 01 com as medições do PDF.
 *
 * MODO REGISTRAR BM NA OBRA ATIVA
 *   Adiciona novo BM (próximo número) com as medições do PDF.
 *   Itens do PDF cujos codes existam na obra: medições criadas normalmente.
 *   Itens ausentes na obra: listados como aviso.
 */

import EventBus        from '../../core/EventBus.js';
import state           from '../../core/state.js';
import router          from '../../core/router.js';
import FirebaseService from '../../firebase/firebase-service.js';
import { exposeGlobal } from '../../utils/global-guard.js';

/* ── Helpers ─────────────────────────────────────────────────── */
const R$  = v => Number(v || 0).toLocaleString('pt-BR',{style:'currency',currency:'BRL'});
const pct = v => `${Number(parseFloat(v)||0).toFixed(2)}%`;
const esc = s => String(s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');

/* ── Paleta ─────────────────────────────────────────────────── */
const C = {
  blue:'#3b82f6', green:'#22c55e', amber:'#f59e0b', red:'#ef4444',
  surface:'rgba(255,255,255,.04)', border:'rgba(255,255,255,.08)',
  text:'#e2e8f0', muted:'#94a3b8', dim:'#64748b',
};

export class ImportacaoBmPdfModule {
  constructor() {
    this._subs    = [];
    this._modo    = 'nova';     // 'nova' | 'inserir'
    this._itens   = [];         // itens extraídos do PDF
    this._meta    = {};         // metadados do cabeçalho
    this._arquivo = null;
  }

  async init() {
    try { this._exposeGlobals(); }
    catch(e) { console.error('[ImportacaoBmPdf] init:', e); }
  }

  async onEnter() {
    try { this._render(); }
    catch(e) { console.error('[ImportacaoBmPdf] onEnter:', e); }
  }

  destroy() {
    this._subs.forEach(u => u());
    this._subs = [];
  }

  /* ═══════════════════════════════════════════════════════════
   *  RENDER PRINCIPAL
   * ═══════════════════════════════════════════════════════════ */
  _render() {
    const el = document.getElementById('importacao-bm-pdf-conteudo');
    if (!el) return;
    const podeInserir = !!state.get('obraAtivaId');

    el.innerHTML = `
    <!-- ── Cabeçalho ── -->
    <div style="background:linear-gradient(135deg,#0f2027,#203a43,#2c5364);
      border-radius:12px;padding:20px 24px;margin-bottom:20px">
      <div style="font-size:18px;font-weight:800;color:#fff;margin-bottom:4px">
        🏦 Importar BM — Modelo Convênio / CAIXA
      </div>
      <div style="font-size:11px;color:#94a3b8">
        Importação de Boletins de Medição em PDF gerados pelo GIGOV / Caixa Econômica Federal.
        Os preços já incluem BDI — nenhum cálculo adicional será aplicado.
      </div>
    </div>

    <!-- ── Modo ── -->
    <div style="display:flex;gap:8px;margin-bottom:18px;flex-wrap:wrap">
      <button id="bmpdf-btn-nova"
        data-action="_bmpdfSetModo" data-arg0="nova"
        style="padding:8px 18px;border-radius:20px;font-size:11px;font-weight:700;cursor:pointer;
          border:2px solid ${C.blue};
          background:${this._modo==='nova'?C.blue:'transparent'};
          color:${this._modo==='nova'?'#fff':'#94a3b8'}">
        🏗️ NOVA OBRA
      </button>
      ${podeInserir?`
      <button id="bmpdf-btn-inserir"
        data-action="_bmpdfSetModo" data-arg0="inserir"
        style="padding:8px 18px;border-radius:20px;font-size:11px;font-weight:700;cursor:pointer;
          border:2px solid ${C.green};
          background:${this._modo==='inserir'?C.green:'transparent'};
          color:${this._modo==='inserir'?'#fff':'#94a3b8'}">
        ➕ REGISTRAR BM NA OBRA ATIVA
      </button>`:''}
    </div>

    <!-- ── Dados da obra (só para nova) ── -->
    <div id="bmpdf-dados-obra" style="display:${this._modo==='nova'?'block':'none'}">
      <div style="background:#1e2330;border:1px solid #2d3748;border-radius:10px;
        padding:18px 20px;margin-bottom:16px">
        <div style="font-size:12px;font-weight:800;color:#f1f5f9;margin-bottom:14px">
          📋 Dados da Obra
        </div>
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px">
          <div style="grid-column:1/-1">
            <label style="font-size:10px;color:#94a3b8;text-transform:uppercase;letter-spacing:.5px">
              Objeto / Nome da Obra</label>
            <input id="bmpdf-objeto" type="text"
              placeholder="Ex: Pavimentação da Avenida Rio Mucuri"
              style="width:100%;margin-top:4px;padding:8px 10px;border:1px solid #2d3748;
                border-radius:6px;background:#0d111a;color:#f1f5f9;font-size:12px;box-sizing:border-box">
          </div>
          <div>
            <label style="font-size:10px;color:#94a3b8;text-transform:uppercase;letter-spacing:.5px">
              Nº TC/CR (Contrato CAIXA)</label>
            <input id="bmpdf-tc-cr" type="text" placeholder="Ex: 1032682-96"
              style="width:100%;margin-top:4px;padding:8px 10px;border:1px solid #2d3748;
                border-radius:6px;background:#0d111a;color:#f1f5f9;font-size:12px;box-sizing:border-box">
          </div>
          <div>
            <label style="font-size:10px;color:#94a3b8;text-transform:uppercase;letter-spacing:.5px">
              Nº Convênio / GIGOV</label>
            <input id="bmpdf-convenio" type="text" placeholder="Ex: 830020/2016"
              style="width:100%;margin-top:4px;padding:8px 10px;border:1px solid #2d3748;
                border-radius:6px;background:#0d111a;color:#f1f5f9;font-size:12px;box-sizing:border-box">
          </div>
          <div>
            <label style="font-size:10px;color:#94a3b8;text-transform:uppercase;letter-spacing:.5px">
              Nº CTEF</label>
            <input id="bmpdf-ctef" type="text" placeholder="Ex: CE07-24"
              style="width:100%;margin-top:4px;padding:8px 10px;border:1px solid #2d3748;
                border-radius:6px;background:#0d111a;color:#f1f5f9;font-size:12px;box-sizing:border-box">
          </div>
          <div>
            <label style="font-size:10px;color:#94a3b8;text-transform:uppercase;letter-spacing:.5px">
              Contratante (Tomador)</label>
            <input id="bmpdf-contratante" type="text" placeholder="Ex: Prefeitura Municipal de Mucuri"
              style="width:100%;margin-top:4px;padding:8px 10px;border:1px solid #2d3748;
                border-radius:6px;background:#0d111a;color:#f1f5f9;font-size:12px;box-sizing:border-box">
          </div>
          <div>
            <label style="font-size:10px;color:#94a3b8;text-transform:uppercase;letter-spacing:.5px">
              Empresa Executora (Contratada)</label>
            <input id="bmpdf-contratada" type="text" placeholder="Ex: Ambiente Serviços Urbanos Ltda"
              style="width:100%;margin-top:4px;padding:8px 10px;border:1px solid #2d3748;
                border-radius:6px;background:#0d111a;color:#f1f5f9;font-size:12px;box-sizing:border-box">
          </div>
          <div>
            <label style="font-size:10px;color:#94a3b8;text-transform:uppercase;letter-spacing:.5px">
              CNPJ Contratada</label>
            <input id="bmpdf-cnpj" type="text" placeholder="Ex: 96.818.745/0001-31"
              style="width:100%;margin-top:4px;padding:8px 10px;border:1px solid #2d3748;
                border-radius:6px;background:#0d111a;color:#f1f5f9;font-size:12px;box-sizing:border-box">
          </div>
          <div>
            <label style="font-size:10px;color:#94a3b8;text-transform:uppercase;letter-spacing:.5px">
              Programa / Ministério</label>
            <input id="bmpdf-programa" type="text" placeholder="Ex: Ministério das Cidades"
              style="width:100%;margin-top:4px;padding:8px 10px;border:1px solid #2d3748;
                border-radius:6px;background:#0d111a;color:#f1f5f9;font-size:12px;box-sizing:border-box">
          </div>
          <div>
            <label style="font-size:10px;color:#94a3b8;text-transform:uppercase;letter-spacing:.5px">
              Data Início da Obra</label>
            <input id="bmpdf-inicio" type="date"
              style="width:100%;margin-top:4px;padding:8px 10px;border:1px solid #2d3748;
                border-radius:6px;background:#0d111a;color:#f1f5f9;font-size:12px;box-sizing:border-box">
          </div>
          <div>
            <label style="font-size:10px;color:#94a3b8;text-transform:uppercase;letter-spacing:.5px">
              Fiscal do Contrato</label>
            <input id="bmpdf-fiscal" type="text" placeholder="Nome do fiscal"
              style="width:100%;margin-top:4px;padding:8px 10px;border:1px solid #2d3748;
                border-radius:6px;background:#0d111a;color:#f1f5f9;font-size:12px;box-sizing:border-box">
          </div>
        </div>
      </div>
    </div>

    <!-- ── Drop zone ── -->
    <div id="bmpdf-drop"
      ondragover="event.preventDefault();this.style.borderColor='${C.blue}'"
      ondragleave="this.style.borderColor='#16a34a'"
      ondrop="window._bmpdfDrop(event)"
      data-action="_bmpdfClickInput"
      style="border:2px dashed #16a34a;border-radius:12px;padding:36px;text-align:center;
        cursor:pointer;transition:all .2s;background:#0d1f14;margin-bottom:16px">
      <div style="font-size:36px;margin-bottom:8px">📄</div>
      <div style="font-size:14px;font-weight:700;color:#f1f5f9;margin-bottom:4px">
        Arraste o PDF aqui ou clique para selecionar
      </div>
      <div style="font-size:11px;color:#86efac">
        BM no modelo Convênio/CAIXA · somente <strong>.pdf</strong>
      </div>
      <input type="file" id="bmpdf-input" accept=".pdf" style="display:none"
        onchange="window._bmpdfArquivo(event)">
    </div>

    <div id="bmpdf-status" style="min-height:22px;font-size:12px;color:#94a3b8;
      margin-bottom:12px"></div>

    <!-- ── Preview (oculto até carregar) ── -->
    <div id="bmpdf-preview" style="display:none"></div>
    `;
  }

  /* ═══════════════════════════════════════════════════════════
   *  PROCESSAMENTO DO PDF
   * ═══════════════════════════════════════════════════════════ */
  async _processarPDF(file) {
    this._arquivo = file;
    const statusEl = document.getElementById('bmpdf-status');
    const prevEl   = document.getElementById('bmpdf-preview');
    if (prevEl) prevEl.style.display = 'none';

    const _st = msg => { if (statusEl) statusEl.innerHTML = msg; };
    _st(`<span style="color:#94a3b8">⏳ Lendo ${esc(file.name)} (${(file.size/1024).toFixed(1)} KB)...</span>`);

    try {
      if (typeof pdfjsLib === 'undefined')
        throw new Error('PDF.js não carregado. Verifique a conexão.');
      if (!pdfjsLib.GlobalWorkerOptions.workerSrc)
        pdfjsLib.GlobalWorkerOptions.workerSrc =
          'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';

      const pdf  = await pdfjsLib.getDocument({ data: await file.arrayBuffer() }).promise;

      // ── 1. Extrai fragmentos com posição (x, y) ───────────────
      const frags = [];
      for (let p = 1; p <= pdf.numPages; p++) {
        const page    = await pdf.getPage(p);
        const content = await page.getTextContent();
        const vp      = page.getViewport({ scale: 1 });
        content.items.forEach(item => {
          if (!item.str?.trim()) return;
          frags.push({
            str:  item.str.trim(),
            x:    Math.round(item.transform[4]),
            y:    Math.round(vp.height - item.transform[5]),
            w:    Math.round(item.width || 0),
            page: p,
          });
        });
      }

      // ── 2. Agrupa fragmentos em linhas (tolerância ±4px) ──────
      frags.sort((a,b) => a.page !== b.page ? a.page-b.page : a.y !== b.y ? a.y-b.y : a.x-b.x);
      const linhas = [];
      let cur = null;
      for (const f of frags) {
        if (!cur || cur.page !== f.page || Math.abs(cur.y - f.y) > 4) {
          cur = { y: f.y, page: f.page, tokens: [{ str: f.str, x: f.x, w: f.w }] };
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

      // ── 3. Extrai metadados do cabeçalho ─────────────────────
      _st(`<span style="color:#94a3b8">⏳ Extraindo metadados...</span>`);
      this._meta = this._extrairMeta(rows);

      // ── 4. Verifica se é BM CAIXA ────────────────────────────
      const textoTotal = rows.map(r => r.text).join('\n');
      const isCaixa = /BOLETIM DE MEDI[ÇC][ÃA]O|Evolu[çc][ãa]o Financeira|Evolu[çc][ãa]o F[íi]sica|GIGOV|CAIXA ECON[ÔO]MICA/i.test(textoTotal);
      if (!isCaixa)
        throw new Error('PDF não identificado como BM Convênio/CAIXA. Verifique se é o modelo correto.');

      // ── 5. Faz parse da tabela de itens ──────────────────────
      _st(`<span style="color:#94a3b8">⏳ Identificando tabela de itens...</span>`);
      this._itens = this._parseBmCaixaPDF(rows);

      if (!this._itens.length)
        throw new Error('Nenhum item encontrado na tabela do BM. Verifique o PDF.');

      // ── 6. Preenche campos da UI com metadados extraídos ─────
      this._preencherCampos();

      // ── 7. Renderiza preview ──────────────────────────────────
      this._renderPreview();

      const nSvc  = this._itens.filter(i => !i.t).length;
      const nMed  = this._itens.filter(i => !i.t && i.pctPeriodo > 0).length;
      _st(`<span style="color:#4ade80">✅ ${nSvc} itens extraídos · ${nMed} com medição neste período</span>`);

    } catch(err) {
      const statusEl2 = document.getElementById('bmpdf-status');
      if (statusEl2)
        statusEl2.innerHTML = `<span style="color:#ef4444">❌ ${esc(err.message)}</span>`;
      console.error('[ImportacaoBmPdf]', err);
    }
  }

  /* ═══════════════════════════════════════════════════════════
   *  PARSER — TABELA BM CAIXA  (reescrito: abordagem texto-stream)
   *
   *  Algoritmo:
   *  1. Filtra linhas de rodapé/cabeçalho (IGNORAR_LINHA)
   *  2. Agrupa linhas consecutivas em blocos por código de item
   *     (nova linha com RE_COD inicia novo bloco;
   *      linhas sem código são continuação do bloco anterior)
   *  3. Para cada bloco, concatena texto e parseia:
   *     a) Encontra unidade como pivô entre desc e números
   *     b) Lê 9 valores em ordem fixa após a unidade:
   *        [0]qtd [1]PU(cBDI) [2]PT [3]F%Ant [4]F%Per [5]F%Acum
   *        [6]Fin$Ant [7]Fin$Per [8]Fin$Acum
   *        ("-" conta como token com valor 0)
   *  4. BDI = 0 em todos os itens (CAIXA: preço já inclui BDI)
   * ═══════════════════════════════════════════════════════════ */
  _parseBmCaixaPDF(rows) {

    // ── Linhas que devem ser descartadas completamente ─────────
    const IGNORAR_LINHA = /^\s*(Empreitada|Or[çc]amento\s+Contrat|Evolu[çc][ãa]o\s+F[íi]s|Evolu[çc][ãa]o\s+Fin|BOLETIM\s+DE\s+MEDI|BM\s*[-–]\s*BOLETIM|Resp\.?\s*T[ée]cn|Fiscaliza[çc][ãa]o|ART\/RRT|CREA\/CAU|Local\s+e\s+Data|Nome:|Cargo:|^Obs[:\s]|Representa|Grau\s+de\s+Sigilo|#|v\d{3}\s+micro|\d{2}\/\d{2}\/\d{4}\s*[AÀ]\s*\d{2}\/\d{2}\/\d{4}|\d{2}\/\d{2}\/\d{4}$|Os\s+servi[çc]os\s+medidos|CREA\s+[A-Z]{2}\s*[-–]|BA\d{7,}|37\.587|^\s*[-–]\s+\d|TOTAL:|TOTAL\s*$|Acum\.\s+Anterior|Incluindo\s+Per[íi]odo|Orçamento\s+Contratado|Peri[oó]do:|Discrimina[çc][ãa]o|Unid\.|Qtde\.|Pre[çc]o\s+Unit|Pre[çc]o\s+Total)/i;

    // ── Regex de suporte ──────────────────────────────────────
    const RE_COD = /^(\d{1,3}(?:\.\d{1,3}){0,3})(?:\s|$)/;

    // Unidade como pivô — M2/M3 listados antes de M para evitar match parcial
    // Lookahead (?=\s+[\d-]) garante que a unidade está seguida de dados numéricos
    const RE_UNIT_PIVOT = /\b(M2|M3|M[²³]?|UN|VB|PT|CJ|KG|TON|HR|HORA|M[EÊ]S|SAC|SC|KM|ML|CM|DM|UND|CHP|CHI|VERBA|LOTE|PAR|JG|SET|GL|H|T|L)\b(?=\s+[\d-])/i;

    // ── Tokenizador de valores numéricos pt-BR ────────────────
    // Aceita: "120.814,06" → 120814.06  |  "-" → 0
    const tokenizar = str => {
      const RE = /(\d{1,3}(?:\.\d{3})*,\d{1,6}|\d+,\d+)|(-{1,2}|—)/g;
      const toks = [];
      let m;
      while ((m = RE.exec(str)) !== null)
        toks.push(m[1] ? this._parseNum(m[1]) : 0);
      return toks;
    };

    // ── Detecta linha de cabeçalho da tabela ─────────────────
    const headerScore = t => {
      let s = 0;
      if (/\bItem\b/i.test(t))               s += 2;
      if (/Discrimina|Descri/i.test(t))       s += 2;
      if (/\bUnid|\bUnd\b|\bUN\b/i.test(t))  s++;
      if (/Qtde|Quant/i.test(t))              s++;
      if (/Pre[çc]o.{0,12}Unit/i.test(t))    s += 2;
      if (/Pre[çc]o.{0,10}Total/i.test(t))   s++;
      if (/Acum|Per[íi]odo/i.test(t))         s++;
      return s;
    };

    let headerIdx = -1, bestScore = 3;
    for (let i = 0; i < Math.min(60, rows.length); i++) {
      const sc = headerScore(rows[i].text);
      if (sc > bestScore) { bestScore = sc; headerIdx = i; }
    }
    if (headerIdx < 0) return [];

    // ── Filtra e agrupa linhas de dados em blocos por código ──
    // Um bloco começa na linha com RE_COD e acumula linhas
    // subsequentes sem código (continuação de descrição, números etc.)
    const dataRows = rows
      .slice(headerIdx + 1)
      .filter(r => r.text.length > 1 && !IGNORAR_LINHA.test(r.text));

    const blocks = [];
    let cur = null;
    for (const row of dataRows) {
      const m = row.text.match(RE_COD);
      if (m) {
        cur = { codigo: m[1].replace(/\.+$/, ''), linhas: [row.text] };
        blocks.push(cur);
      } else if (cur) {
        cur.linhas.push(row.text);
      }
    }

    // ── Processa cada bloco ───────────────────────────────────
    const itens = [], vistos = new Set();

    for (const block of blocks) {
      const { codigo } = block;
      if (vistos.has(codigo)) continue;
      vistos.add(codigo);

      // Junta todas as linhas do bloco em texto único
      const full = block.linhas.join(' ').replace(/\s{2,}/g, ' ').trim();
      // Remove o código do início
      const body = full
        .replace(new RegExp('^' + codigo.replace(/\./g, '\\.') + '\\s*'), '')
        .trim();

      // Busca unidade como pivô (deve estar seguida de números ou "-")
      const mUnd = body.match(RE_UNIT_PIVOT);

      if (!mUnd) {
        // ── GRUPO: sem unidade (ex: 1, 1.1, 1.2) ───────────
        // Desc = tudo até o primeiro número
        const mFirstNum = body.match(/\d{1,3}(?:\.\d{3})*,\d{2}|\d+,\d{2}/);
        const desc = mFirstNum
          ? body.slice(0, body.indexOf(mFirstNum[0])).trim()
          : body;
        // Tokeniza a parte numérica do grupo
        // Ordem esperada: PT_grupo, evFis%Ant, evFis%Per, evFis%Acum,
        //                 evFin$Ant, evFin$Per, evFin$Acum  (7 valores)
        const toks = mFirstNum
          ? tokenizar(body.slice(body.indexOf(mFirstNum[0])))
          : [];
        itens.push({
          id:  codigo, t: 'G',
          desc: desc.toUpperCase().replace(/\s{2,}/g, ' ').trim(),
          und: '', qtd: 0, up: 0, bdi: 0,
          total:           toks[0] || 0,
          pctPeriodo:      toks[2] || 0,   // evFis%Per
          pctAcumFisico:   toks[3] || 0,   // evFis%Acum
          valorPeriodo:    toks[5] || 0,   // evFin$Per
          valorAcumFisico: toks[6] || 0,   // evFin$Acum
        });

      } else {
        // ── SERVIÇO: tem unidade ─────────────────────────────
        const undPos   = mUnd.index;  // FIX: .index do regex, não indexOf (que acha o 1º char)
        const descRaw  = body.slice(0, undPos).trim();
        const und      = this._normUnit(mUnd[1]);
        const afterUnd = body.slice(undPos + mUnd[0].length).trim();

        // Números em ordem fixa após a unidade (9 tokens):
        //  [0] qtd
        //  [1] PU com BDI  ← NÃO dividir por (1+bdi)
        //  [2] PT
        //  [3] evFis%Ant
        //  [4] evFis%Per   ← percentual medido no período
        //  [5] evFis%Acum
        //  [6] evFin$Ant
        //  [7] evFin$Per   ← valor financeiro do período
        //  [8] evFin$Acum
        const toks = tokenizar(afterUnd);

        const qtd      = toks[0] || 0;
        const up       = toks[1] || 0;    // COM BDI — não dividir
        const totalPDF = toks[2] || 0;
        const pctPer   = toks[4] || 0;
        const valPer   = toks[7] || 0;

        // Fallback: se PU não veio (extração falhou) mas temos PT e qtd
        const upFinal = up > 0
          ? up
          : (totalPDF > 0 && qtd > 0 ? Math.round(totalPDF / qtd * 100000) / 100000 : 0);

        itens.push({
          id:    codigo,
          desc:  descRaw.toUpperCase().replace(/\s{2,}/g, ' ').trim(),
          und,
          qtd,
          up:    upFinal,   // preço unitário COM BDI incluído
          bdi:   0,         // BDI = 0: sistema não aplica divisor adicional
          cod:   '',
          banco: '',
          _totalPDF: totalPDF,
          pctPeriodo:      pctPer,
          pctAcumFisico:   toks[5] || 0,
          valorPeriodo:    valPer,
          valorAcumFisico: toks[8] || 0,
        });
      }
    }

    // Ordena por código numérico
    itens.sort((a, b) => {
      const pa = a.id.split('.').map(Number);
      const pb = b.id.split('.').map(Number);
      for (let i = 0; i < Math.max(pa.length, pb.length); i++)
        if ((pa[i] || 0) !== (pb[i] || 0)) return (pa[i] || 0) - (pb[i] || 0);
      return 0;
    });

    return itens;
  }

  /* ═══════════════════════════════════════════════════════════
   *  EXTRAI METADADOS DO CABEÇALHO  (reescrito: linha por linha)
   *
   *  Atenção: no PDF CAIXA o bloco de metadados aparece no FINAL
   *  do documento (depois da tabela de itens). A label "OBJETO DO
   *  CTEF" aparece DEPOIS do seu valor — por isso a busca é feita
   *  de trás pra frente (backwards) a partir da label.
   * ═══════════════════════════════════════════════════════════ */
  _extrairMeta(rows) {
    const meta = {};
    // Texto completo para buscas por regex
    const txt = rows.map(r => r.text).join('\n');

    // ── Número da medição ─────────────────────────────────────
    const mMed = txt.match(/Medi[çc][ãa]o[:\s]*0*(\d+)/i)
              || txt.match(/Per[íi]odo[:\s]+Medi[çc][ãa]o[:\s]+0*(\d+)/i);
    meta.numBm   = mMed ? parseInt(mMed[1]) : 1;
    meta.labelBm = `BM ${String(meta.numBm).padStart(2, '0')}`;

    // ── % Acumulado ───────────────────────────────────────────
    const mPct = txt.match(/Realizado\s+Acum\.?\s*[:\s]\s*([\d,\.]+)\s*%/i);
    meta.pctAcum = mPct ? this._parseNum(mPct[1]) : 0;

    // ── OBJETO DO CTEF (valor fica NA LINHA ANTERIOR à label) ─
    // Estrutura do PDF: "...valor...\nOBJETO DO CTEF\n..."
    // Busca backwards: encontra "OBJETO DO CTEF" e pega linha anterior.
    meta.objeto = '';
    for (let i = 0; i < rows.length; i++) {
      if (/^OBJETO\s+DO\s+CTEF$/i.test(rows[i].text.trim())) {
        // Procura a linha anterior não-vazia que seja o valor
        for (let j = i - 1; j >= Math.max(0, i - 5); j--) {
          const v = rows[j].text.trim();
          // Descarta labels de seção (só maiúsculas curtas) e linhas técnicas
          if (v.length > 5 && !/^(EMPRESA\s+EXECUTORA|N[ºo°]\s*CTEF|CNPJ|IN[IÍ]CIO|AO\/MODALIDADE)/i.test(v)) {
            meta.objeto = v;
            break;
          }
        }
        break;
      }
    }
    // Fallback 1: linha após "PROPONENTE / TOMADOR" pode conter "PREFEITURA... NOME DA OBRA"
    if (!meta.objeto) {
      for (let i = 0; i < rows.length; i++) {
        if (/PROPONENTE.*TOMADOR/i.test(rows[i].text)) {
          const next = (rows[i + 1]?.text || '').trim();
          // Linha tem "PREFEITURA MUNICIPAL... NOME DA OBRA" separados por espaços
          // O nome da obra é a segunda parte (depois do nome do contratante)
          const partes = next.split(/\s{3,}/);
          if (partes.length >= 2) {
            meta.objeto = partes[partes.length - 1].trim();
          } else if (next.length > 10) {
            meta.objeto = next;
          }
          break;
        }
      }
    }
    // Fallback 2: busca por texto após "OBJETO\n"
    if (!meta.objeto) {
      const mObj = txt.match(/^OBJETO\s*\n([^\n]{10,120})/im);
      if (mObj) meta.objeto = mObj[1].trim();
    }
    meta.objeto = (meta.objeto || '').replace(/\s{2,}/g, ' ').trim();

    // ── Contratante (Proponente / Tomador) ────────────────────
    for (let i = 0; i < rows.length; i++) {
      if (/PROPONENTE.*TOMADOR/i.test(rows[i].text)) {
        const next = (rows[i + 1]?.text || '').trim();
        if (next) {
          // "PREFEITURA MUNICIPAL DE MUCURI-BA   PAVIMENTAÇÃO DA AVENIDA..."
          meta.contratante = next.split(/\s{3,}/)[0].trim();
        }
        break;
      }
    }

    // ── Empresa executora (contratada) ────────────────────────
    // No PDF CAIXA a linha de dados é:
    // "CE07-24  96.818.745/0001-31  05/12/2024  AMBIENTE SERVIÇOS URBANOS LTDA"
    // Estratégia: tudo que vem APÓS a data dd/mm/aaaa é o nome da empresa.
    for (let i = 0; i < rows.length; i++) {
      if (/N[ºo°]\s*CTEF\s+CNPJ/i.test(rows[i].text)) {
        const next = (rows[i + 1]?.text || '').trim();
        if (next) {
          // Ancora na data de início (único dd/mm/aaaa na linha)
          const mEmpDate = next.match(/\d{2}\/\d{2}\/\d{4}\s+(.+)/);
          if (mEmpDate) {
            meta.contratada = mEmpDate[1].trim();
          } else {
            // Fallback: âncora no CNPJ xx.xxx.xxx/xxxx-xx
            const mEmpCnpj = next.match(/\d{2}\.\d{3}\.\d{3}\/\d{4}-\d{2}\s+(.+)/);
            if (mEmpCnpj) meta.contratada = mEmpCnpj[1].trim();
          }
        }
        break;
      }
    }
    // Fallback: busca LTDA/S.A./EIRELI em qualquer linha do texto
    if (!meta.contratada) {
      const mEmp = txt.match(/([A-ZÁÉÍÓÚÃÕÇ][A-ZÁÉÍÓÚÃÕÇ\s]{3,}(?:LTDA|S\/A|S\.A\.|EIRELI|ME\b|EPP\b)\.?)/i);
      if (mEmp) meta.contratada = mEmp[1].trim().slice(0, 80);
    }

    // ── CNPJ ──────────────────────────────────────────────────
    const mCnpj = txt.match(/(\d{2}\.?\d{3}\.?\d{3}\/?\d{4}-?\d{2})/);
    meta.cnpj = mCnpj ? mCnpj[1] : '';

    // ── TC/CR ─────────────────────────────────────────────────
    // Padrão: 7 dígitos, traço, 2 dígitos  ex: 1032682-96
    for (let i = 0; i < rows.length; i++) {
      if (/N[ºo°]\s*TC\/CR/i.test(rows[i].text)) {
        const m2 = (rows[i + 1]?.text || '').match(/(\d{6,8}-\d{2})/);
        if (m2) { meta.tcCr = m2[1]; break; }
        const m3 = rows[i].text.match(/(\d{6,8}-\d{2})/);
        if (m3) { meta.tcCr = m3[1]; break; }
        break;
      }
    }
    if (!meta.tcCr) {
      const m2 = txt.match(/(\d{7}-\d{2})/);
      meta.tcCr = m2 ? m2[1] : '';
    }

    // ── Convênio GIGOV ────────────────────────────────────────
    // Padrão: 6 dígitos / 4 dígitos  ex: 830020/2016
    for (let i = 0; i < rows.length; i++) {
      if (/CONV[ÊE]N[IO]/i.test(rows[i].text) || /GIGOV/i.test(rows[i].text)) {
        const src = rows[i + 1]?.text || rows[i].text;
        const m2  = src.match(/(\d{6}\/\d{4})/);
        if (m2) { meta.convenio = m2[1]; break; }
        break;
      }
    }
    if (!meta.convenio) {
      const m2 = txt.match(/(\d{6}\/\d{4})/);
      meta.convenio = m2 ? m2[1] : '';
    }

    // ── CTEF ──────────────────────────────────────────────────
    // Padrão: 2-4 letras + dígitos + hífen + 2 dígitos  ex: CE07-24
    for (let i = 0; i < rows.length; i++) {
      if (/N[ºo°]\s*CTEF/i.test(rows[i].text)) {
        // O valor pode estar na mesma linha ou na próxima
        const src = rows[i].text + ' ' + (rows[i + 1]?.text || '');
        const m2  = src.match(/\b([A-Z]{2,4}\d{2}-\d{2,})\b/i);
        if (m2) { meta.ctef = m2[1]; break; }
        break;
      }
    }

    // ── Programa ──────────────────────────────────────────────
    for (let i = 0; i < rows.length; i++) {
      if (/\bGESTOR\s+PROGRAMA\b/i.test(rows[i].text)) {
        // Valor na mesma linha dos dados TC/CR — campo GESTOR PROGRAMA
        const next = rows[i + 1]?.text || '';
        // Linha de dados: "1032682-96 830020/2016 IT - ITABUNA MCID - ... 28/11/2024"
        // Programa está entre o gestor e a data
        const mProg = next.match(/(?:IT\s*[-–]\s*[A-Z]+\s+)(MCID[^\d]*|MINIST[ÉE]RIO[^0-9\n]{3,60})/i);
        if (mProg) { meta.programa = mProg[1].trim().slice(0, 60); break; }
        // Fallback: busca MCID no texto completo
        const mMcid = txt.match(/(MCID[^\n]{0,50}|MINIST[ÉE]RIO[^\n]{0,60})/i);
        if (mMcid) { meta.programa = mMcid[1].trim().slice(0, 60); break; }
        break;
      }
    }

    // ── Data da medição (ex: "13 de MARÇO de 2025") ──────────
    const mData = txt.match(/(\d{1,2})\s+de\s+([A-ZÁÉÍÓÚÃÕÇ]+)\s+de\s+(\d{4})/i);
    if (mData) {
      const MESES = { JANEIRO:1, FEVEREIRO:2, MARCO:3, MARCO_:3, ABRIL:4,
                      MAIO:5, JUNHO:6, JULHO:7, AGOSTO:8, SETEMBRO:9,
                      OUTUBRO:10, NOVEMBRO:11, DEZEMBRO:12 };
      const d  = parseInt(mData[1]);
      const mn = mData[2].toUpperCase()
        .normalize('NFD').replace(/[\u0300-\u036f]/g, '');
      const mo = MESES[mn] || 1;
      const y  = parseInt(mData[3]);
      meta.data = `${y}-${String(mo).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
      meta.mes  = `${mData[2][0].toUpperCase()}${mData[2].slice(1).toLowerCase()}/${y}`;
    } else {
      meta.data = ''; meta.mes = '';
    }

    // ── Data de início (período: "05/12/2024 À 13/03/2025") ──
    const mPer = txt.match(/(\d{2}\/\d{2}\/\d{4})\s*[AÀ]\s*\d{2}\/\d{2}\/\d{4}/i);
    if (mPer) {
      const [dd, mm, yyyy] = mPer[1].split('/');
      meta.inicioPrev = `${yyyy}-${mm}-${dd}`;
    } else {
      // Fallback: data de "INÍCIO DA OBRA"
      const mIn = txt.match(/IN[IÍ]CIO\s+DA\s+OBRA[^]*?(\d{2}\/\d{2}\/\d{4})/i);
      if (mIn) {
        const [dd, mm, yyyy] = mIn[1].split('/');
        meta.inicioPrev = `${yyyy}-${mm}-${dd}`;
      }
    }

    return meta;
  }

  /* ═══════════════════════════════════════════════════════════
   *  PREENCHE CAMPOS DA UI COM METADADOS EXTRAÍDOS
   * ═══════════════════════════════════════════════════════════ */
  _preencherCampos() {
    const m = this._meta;
    const set = (id, val) => { const el=document.getElementById(id); if(el&&!el.value&&val) el.value=val; };
    set('bmpdf-objeto',     m.objeto);
    set('bmpdf-tc-cr',      m.tcCr);
    set('bmpdf-convenio',   m.convenio);
    set('bmpdf-ctef',       m.ctef);
    set('bmpdf-contratante',m.contratante);
    set('bmpdf-contratada', m.contratada);
    set('bmpdf-cnpj',       m.cnpj);
    set('bmpdf-programa',   m.programa);
    set('bmpdf-inicio',     m.inicioPrev);
  }

  /* ═══════════════════════════════════════════════════════════
   *  RENDER PREVIEW
   * ═══════════════════════════════════════════════════════════ */
  _renderPreview() {
    const el = document.getElementById('bmpdf-preview');
    if (!el) return;
    el.style.display = 'block';

    const itens   = this._itens;
    const meta    = this._meta;
    const nSvc    = itens.filter(i => !i.t).length;
    const nMed    = itens.filter(i => !i.t && i.pctPeriodo > 0).length;
    const totContr = itens.filter(i => !i.t).reduce((s,i) => s + Number(i.qtd||0) * Number(i.up||0), 0);
    const totMed   = itens.filter(i => !i.t).reduce((s,i) => s + Number(i.valorPeriodo||0), 0);

    // KPI cards
    const kpi = (ico, label, val, cor) => `
      <div style="background:#0d111a;border:1px solid ${cor}44;border-radius:8px;padding:12px;text-align:center">
        <div style="font-size:20px;margin-bottom:4px">${ico}</div>
        <div style="font-size:14px;font-weight:800;color:${cor}">${val}</div>
        <div style="font-size:9px;color:#64748b;text-transform:uppercase;margin-top:2px">${label}</div>
      </div>`;

    // Tabela de itens
    const linhas = itens.map(it => {
      if (it.t === 'G') return `<tr style="background:#1e293b">
        <td colspan="8" style="padding:5px 8px;font-weight:700;font-size:10px;color:#60a5fa">
          ${esc(it.id)} — ${esc(it.desc)}
          ${it.total>0?`<span style="float:right;color:#34d399">${R$(it.total)}</span>`:''}
        </td></tr>`;

      const temMed = it.pctPeriodo > 0;
      return `<tr style="border-bottom:1px solid #1e293b;${temMed?'background:#0d1a11':''}">
        <td style="padding:4px 8px;font-family:monospace;font-size:10px;color:#94a3b8">${esc(it.id)}</td>
        <td style="padding:4px 8px;font-size:10px;max-width:260px;overflow:hidden;
          text-overflow:ellipsis;white-space:nowrap" title="${esc(it.desc)}">${esc(it.desc)}</td>
        <td style="padding:4px 8px;font-size:10px;text-align:center;color:#94a3b8">${esc(it.und)}</td>
        <td style="padding:4px 8px;font-size:10px;text-align:right;font-family:monospace">
          ${Number(it.qtd||0).toLocaleString('pt-BR',{maximumFractionDigits:4})}</td>
        <td style="padding:4px 8px;font-size:10px;text-align:right;font-family:monospace;color:#93c5fd">
          ${R$(it.up)}</td>
        <td style="padding:4px 8px;font-size:10px;text-align:right;font-family:monospace">
          ${R$(Number(it.qtd||0)*Number(it.up||0))}</td>
        <td style="padding:4px 8px;font-size:10px;text-align:center;
          color:${temMed?'#4ade80':'#374151'};font-weight:${temMed?'700':'400'}">
          ${temMed?pct(it.pctPeriodo):'—'}</td>
        <td style="padding:4px 8px;font-size:10px;text-align:right;font-family:monospace;
          color:${temMed?'#4ade80':'#374151'}">
          ${temMed?R$(it.valorPeriodo):'—'}</td>
      </tr>`;
    }).join('');

    const labelBtn = this._modo === 'nova'
      ? '✅ Criar Obra e Registrar BM'
      : `✅ Registrar BM na Obra Ativa`;

    el.innerHTML = `
    <div style="background:#1e2330;border:1px solid #2d3748;border-radius:10px;padding:18px;margin-bottom:16px">
      <div style="font-size:12px;font-weight:800;color:#f1f5f9;margin-bottom:14px">
        📊 Resumo do BM Extraído
      </div>
      <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(130px,1fr));gap:10px;margin-bottom:14px">
        ${kpi('📋','Itens Serviço',     nSvc,        C.blue)}
        ${kpi('📏','Com Medição',        nMed,        C.green)}
        ${kpi('💼','Valor Contratado',  R$(totContr), C.amber)}
        ${kpi('💰','Valor Medido',       R$(totMed),  C.green)}
        ${kpi('📅','Nº BM',  meta.labelBm||'BM 01',  C.blue)}
        ${kpi('🗓️','Data BM', meta.data||'—',         C.muted)}
      </div>
      <div style="font-size:10px;color:#86efac;background:#0d1a11;border:1px solid #16a34a;
        border-radius:6px;padding:8px 12px">
        ℹ️ <strong>Modelo Convênio/CAIXA:</strong> BDI = 0% — preços já incluem BDI.
        O sistema registrará os valores diretamente sem aplicar cálculo adicional.
      </div>
    </div>

    <div style="overflow-x:auto;border:1px solid #2d3748;border-radius:10px;margin-bottom:16px">
      <table style="width:100%;border-collapse:collapse;font-size:11px">
        <thead>
          <tr style="background:#0d111a;color:#64748b;text-transform:uppercase;font-size:9px">
            <th style="padding:7px 8px;text-align:left">Código</th>
            <th style="padding:7px 8px;text-align:left">Descrição</th>
            <th style="padding:7px 8px;text-align:center">Unid.</th>
            <th style="padding:7px 8px;text-align:right">Qtde.</th>
            <th style="padding:7px 8px;text-align:right">Preço Unit.</th>
            <th style="padding:7px 8px;text-align:right">Preço Total</th>
            <th style="padding:7px 8px;text-align:center">% Período</th>
            <th style="padding:7px 8px;text-align:right">Valor Período</th>
          </tr>
        </thead>
        <tbody>${linhas}</tbody>
        <tfoot>
          <tr style="background:#0d111a;font-weight:700">
            <td colspan="5" style="padding:7px 8px;color:#94a3b8;font-size:10px">
              TOTAL (${nSvc} serviços)</td>
            <td style="padding:7px 8px;text-align:right;font-family:monospace;color:#f59e0b">
              ${R$(totContr)}</td>
            <td></td>
            <td style="padding:7px 8px;text-align:right;font-family:monospace;color:#22c55e">
              ${R$(totMed)}</td>
          </tr>
        </tfoot>
      </table>
    </div>

    <div style="display:flex;gap:10px;justify-content:flex-end;flex-wrap:wrap">
      <button data-action="_bmpdfLimpar"
        style="padding:10px 20px;background:transparent;border:1px solid #4b5563;
          border-radius:8px;color:#94a3b8;font-size:12px;font-weight:700;cursor:pointer">
        🗑️ Limpar
      </button>
      <button id="bmpdf-btn-confirmar" data-action="_bmpdfConfirmar"
        style="padding:10px 26px;background:${C.green};border:none;border-radius:8px;
          color:#fff;font-size:12px;font-weight:800;cursor:pointer;
          box-shadow:0 2px 10px rgba(34,197,94,.3)">
        ${labelBtn}
      </button>
    </div>`;
  }

  /* ═══════════════════════════════════════════════════════════
   *  CONFIRMAÇÃO — CRIA OBRA OU REGISTRA BM
   * ═══════════════════════════════════════════════════════════ */
  async _confirmar() {
    if (!this._itens.length) {
      this._toast('⚠️ Nenhum item carregado. Importe um PDF primeiro.', 'warn'); return;
    }
    if (this._modo === 'nova') await this._criarObra();
    else                       await this._adicionarBM();
  }

  /* ── Modo: Nova Obra ──────────────────────────────────────── */
  async _criarObra() {
    const btn = document.getElementById('bmpdf-btn-confirmar');
    if (btn) { btn.disabled = true; btn.textContent = '⏳ Criando...'; }
    try {
      const objeto      = (document.getElementById('bmpdf-objeto')?.value || 'Nova Obra').trim().toUpperCase() || 'NOVA OBRA';
      const tcCr        = (document.getElementById('bmpdf-tc-cr')?.value || '').trim();
      const convenio    = (document.getElementById('bmpdf-convenio')?.value || '').trim();
      const ctef        = (document.getElementById('bmpdf-ctef')?.value || '').trim();
      const contratante = (document.getElementById('bmpdf-contratante')?.value || '').trim();
      const contratada  = (document.getElementById('bmpdf-contratada')?.value || '').trim();
      const cnpj        = (document.getElementById('bmpdf-cnpj')?.value || '').trim();
      const programa    = (document.getElementById('bmpdf-programa')?.value || '').trim();
      const inicioPrev  = (document.getElementById('bmpdf-inicio')?.value || this._meta.inicioPrev || '').trim();
      const fiscal      = (document.getElementById('bmpdf-fiscal')?.value || '').trim();

      // Monta itens para o contrato (bdi=0 em todos)
      const itensMontados = this._itens.map(it =>
        it.t === 'G'
          ? { id:it.id, t:'G', desc:it.desc, total:it.total||0 }
          : { id:it.id, cod:'', banco:'', desc:it.desc, und:it.und||'UN',
              qtd:it.qtd||0, up:it.up||0, bdi:0 }  // bdi=0 — preços já com BDI
      );

      // Calcula valor do contrato (qtd × up, sem BDI adicional)
      const valorContrato = itensMontados.filter(i=>!i.t)
        .reduce((s,i) => s + (i.qtd||0)*(i.up||0), 0);

      // BM
      const bmNum   = this._meta.numBm || 1;
      const bmLabel = this._meta.labelBm || `BM ${String(bmNum).padStart(2,'0')}`;
      const bmEntry = { num:bmNum, label:bmLabel, mes:this._meta.mes||'', data:this._meta.data||'', contractVersion:1 };

      const cfg = {
        objeto:           objeto.slice(0,150),
        bdi:              0,            // CAIXA: sem BDI adicional
        valor:            Math.round(valorContrato*100)/100,
        contrato:         ctef,
        contratante,
        contratada,
        cnpj,
        fiscal,
        creaFiscal:       '',
        rt:               '',
        creaRT:           '',
        inicioPrev,
        inicioReal:       '',
        termino:          '',
        duracaoDias:      0,
        numeroProcesso:   tcCr,
        unidadeResponsavel: '',
        modoCalculo:      'truncar',
        tipoObra:         'caixa',
        tcCr, convenio, ctef, programa,
        _importadoEm:     new Date().toISOString(),
        _fonteBM:         'pdf-convenio',
      };

      const novoId = 'obra_' + Date.now().toString(16);
      await FirebaseService.criarObra(novoId, objeto.slice(0,100), 'caixa', cfg, [bmEntry], itensMontados);

      // ── Grava medições do BM ────────────────────────────────
      const medicoes = this._montarMedicoes(bmNum);
      if (Object.keys(medicoes).length > 0)
        await FirebaseService.setMedicoes(novoId, bmNum, medicoes);

      // ── Atualiza state ──────────────────────────────────────
      const obrasLista    = state.get('obrasLista') || [];
      const novaEntrada   = { id:novoId, nome:objeto.slice(0,100), tipo:'caixa', statusObra:'Em andamento' };
      const listaAtualizada = [...obrasLista, novaEntrada];
      state.set('obrasLista',   listaAtualizada);
      state.set('obraAtivaId',  novoId);
      state.set('cfg',          cfg);
      state.set('bms',          [bmEntry]);
      state.set('itensContrato', itensMontados);
      state.persist(['obraAtivaId']);
      await FirebaseService.salvarObrasLista(listaAtualizada);

      EventBus.emit('obra:criada',      { obraId:novoId, nome:objeto });
      EventBus.emit('obra:selecionada', { obraId:novoId });
      EventBus.emit('boletim:atualizado', { obraId:novoId, bmNum });

      const nMed = Object.keys(medicoes).length;
      this._toast(`✅ Obra criada! ${itensMontados.filter(i=>!i.t).length} itens · BM ${bmNum} com ${nMed} medições.`);
      this._itens = [];
      router.navigate('boletim');

    } catch(err) {
      console.error('[ImportacaoBmPdf] _criarObra:', err);
      this._toast(`❌ Erro: ${err.message}`, 'err');
      if (btn) { btn.disabled=false; btn.textContent='✅ Criar Obra e Registrar BM'; }
    }
  }

  /* ── Modo: Inserir BM na Obra Ativa ──────────────────────── */
  async _adicionarBM() {
    const btn = document.getElementById('bmpdf-btn-confirmar');
    if (btn) { btn.disabled = true; btn.textContent = '⏳ Registrando BM...'; }
    try {
      const obraId = state.get('obraAtivaId');
      if (!obraId) { this._toast('❌ Nenhuma obra ativa.','warn'); return; }

      // Busca BMs existentes para determinar próximo número
      const bmsExist = state.get('bms') || await FirebaseService.getBMs(obraId) || [];
      const nextNum  = bmsExist.length > 0
        ? Math.max(...bmsExist.map(b => Number(b.num)||0)) + 1
        : 1;

      // Verifica se o usuário quer usar o número do PDF ou o próximo disponível
      const bmNum   = nextNum;
      const bmLabel = `BM ${String(bmNum).padStart(2,'0')}`;
      const bmEntry = { num:bmNum, label:bmLabel, mes:this._meta.mes||'', data:this._meta.data||'', contractVersion:1 };

      // Confere itens da obra — avisa sobre ausentes
      const itensObra = state.get('itensContrato') || await FirebaseService.getItens(obraId) || [];
      const idsObra   = new Set(itensObra.map(i => i.id));
      const ausentes  = this._itens.filter(i => !i.t && !idsObra.has(i.id));
      if (ausentes.length > 0) {
        const lista = ausentes.map(i => i.id).join(', ');
        const ok = confirm(
          `Atenção: ${ausentes.length} item(ns) do PDF não existem na obra ativa:\n${lista}\n\n` +
          `Esses itens serão ignorados na medição.\nContinuar mesmo assim?`
        );
        if (!ok) {
          if (btn) { btn.disabled=false; btn.textContent='✅ Registrar BM na Obra Ativa'; }
          return;
        }
      }

      // Adiciona novo BM à lista
      const novosBMs = [...bmsExist, bmEntry];
      await FirebaseService.setBMs(obraId, novosBMs);
      state.set('bms', novosBMs);

      // Grava medições
      const medicoes = this._montarMedicoes(bmNum);
      if (Object.keys(medicoes).length > 0)
        await FirebaseService.setMedicoes(obraId, bmNum, medicoes);

      EventBus.emit('boletim:atualizado', { obraId, bmNum });

      const nMed = Object.keys(medicoes).length;
      this._toast(`✅ BM ${bmNum} registrado com ${nMed} medições.`);
      this._itens = [];
      router.navigate('boletim');

    } catch(err) {
      console.error('[ImportacaoBmPdf] _adicionarBM:', err);
      this._toast(`❌ Erro: ${err.message}`, 'err');
      if (btn) { btn.disabled=false; btn.textContent='✅ Registrar BM na Obra Ativa'; }
    }
  }

  /* ═══════════════════════════════════════════════════════════
   *  MONTA OBJETO DE MEDIÇÕES
   *
   *  Estrutura esperada pelo bm-calculos.js:
   *    medicoes[itemId] = {
   *      lines: [{ comp, larg, alt, qtd, bmOrigem }],
   *      fxFormula: ''
   *    }
   *
   *  Para garantir compatibilidade com todos os tipos de unidade:
   *  • comp = qtdMedida   (linear: usa comp; área: comp×larg=qtdMedida×1)
   *  • larg = '1'
   *  • alt  = '1'
   *  • qtd  = qtdMedida   (fallback para unidades count)
   *
   *  Isso funciona porque calcDimensional retorna:
   *   'linear'  → comp          = qtdMedida ✓
   *   'area'    → comp×larg     = qtdMedida×1 = qtdMedida ✓
   *   'volume'  → comp×larg×alt = qtdMedida×1×1 = qtdMedida ✓
   *   'unit'    → qtd           = qtdMedida ✓
   * ═══════════════════════════════════════════════════════════ */
  _montarMedicoes(bmNum) {
    const medicoes = {};
    this._itens.forEach(it => {
      if (it.t === 'G') return;           // ignora grupos
      if (!(it.pctPeriodo > 0)) return;   // sem medição neste período

      // Calcula a quantidade medida neste período
      // qtdMedida = (% período / 100) × qtd contratada
      const qtdMedida = Math.round((it.pctPeriodo / 100) * (it.qtd || 0) * 100000) / 100000;
      if (qtdMedida <= 0) return;

      const qStr = String(qtdMedida);
      medicoes[it.id] = {
        lines: [{
          comp:      qStr,  // usado por linear e área
          larg:      '1',   // comp × 1 = comp para área
          alt:       '1',   // comp × 1 × 1 para volume
          qtd:       qStr,  // usado por unit
          bmOrigem:  bmNum, // número do BM a que esta linha pertence
        }],
        fxFormula: '',
      };
    });
    return medicoes;
  }

  /* ═══════════════════════════════════════════════════════════
   *  UTILITÁRIOS
   * ═══════════════════════════════════════════════════════════ */

  /**
   * Converte número no formato pt-BR (separador de milhar ".", decimal ",")
   * Ex: "120.814,06" → 120814.06
   */
  _parseNum(raw) {
    if (!raw && raw !== 0) return 0;
    const s = String(raw).trim();
    if (!s || s === '-' || s === '—') return 0;
    // Remove separador de milhar (ponto) e troca vírgula por ponto decimal
    const limpo = s.replace(/\./g,'').replace(',','.');
    const n = parseFloat(limpo);
    return isFinite(n) ? n : 0;
  }

  /** Normaliza abreviação de unidade */
  _normUnit(raw) {
    return (raw||'')
      .trim().toUpperCase()
      .replace('²','2').replace('³','3')
      .replace(/M\s*2/,'M2').replace(/M\s*3/,'M3')
      || 'UN';
  }

  /** Toast de notificação */
  _toast(msg, tipo = 'ok') {
    if (typeof toast === 'function') { toast(msg, tipo); return; }
    if (tipo === 'err') { alert(msg); return; }
    const el = document.getElementById('bmpdf-status');
    if (el) el.innerHTML = `<span style="color:${tipo==='warn'?'#f59e0b':'#4ade80'}">${esc(msg)}</span>`;
  }

  /* ═══════════════════════════════════════════════════════════
   *  GLOBALS EXPOSTOS
   * ═══════════════════════════════════════════════════════════ */
  _exposeGlobals() {
    exposeGlobal('_bmpdfSetModo', modo => {
      this._modo = modo;
      const dadosEl = document.getElementById('bmpdf-dados-obra');
      if (dadosEl) dadosEl.style.display = modo === 'nova' ? 'block' : 'none';
      // Re-renderiza o preview se já tiver itens
      if (this._itens.length) this._renderPreview();
      // Atualiza destaque dos botões de modo
      const bNova    = document.getElementById('bmpdf-btn-nova');
      const bInserir = document.getElementById('bmpdf-btn-inserir');
      if (bNova) {
        bNova.style.background = modo==='nova' ? C.blue : 'transparent';
        bNova.style.color      = modo==='nova' ? '#fff' : '#94a3b8';
      }
      if (bInserir) {
        bInserir.style.background = modo==='inserir' ? C.green : 'transparent';
        bInserir.style.color      = modo==='inserir' ? '#fff'  : '#94a3b8';
      }
    });

    exposeGlobal('_bmpdfDrop', async ev => {
      ev.preventDefault();
      const file = ev.dataTransfer?.files?.[0];
      if (!file) return;
      if (!file.name.toLowerCase().endsWith('.pdf')) {
        this._toast('⚠️ Selecione um arquivo .pdf', 'warn'); return;
      }
      await this._processarPDF(file);
    });

    exposeGlobal('_bmpdfArquivo', async ev => {
      const file = ev.target?.files?.[0];
      if (!file) return;
      await this._processarPDF(file);
      ev.target.value = '';
    });

    exposeGlobal('_bmpdfConfirmar', () => this._confirmar());

    exposeGlobal('_bmpdfLimpar', () => {
      this._itens = []; this._meta = {}; this._arquivo = null;
      const prev   = document.getElementById('bmpdf-preview');
      const status = document.getElementById('bmpdf-status');
      if (prev)   prev.style.display = 'none';
      if (status) status.innerHTML   = '';
    });

    // Ponto de entrada externo (ex: botão no módulo BM)
    window.abrirImportacaoBmPdf = (modo = 'inserir') => {
      router.navigate('importacao-bm-pdf');
      setTimeout(() => { if(modo) window._bmpdfSetModo?.(modo); }, 100);
    };
  }
}
