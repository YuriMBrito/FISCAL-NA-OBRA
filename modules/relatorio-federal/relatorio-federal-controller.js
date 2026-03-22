/**
 * ╔══════════════════════════════════════════════════════════════╗
 * ║  FISCAL NA OBRA — modules/relatorio-federal/               ║
 * ║                   relatorio-federal-controller.js           ║
 * ║  Relatório de Fiscalização — formato CGU/TCU/IN 5-2017      ║
 * ╚══════════════════════════════════════════════════════════════╝
 *
 * Gera o Relatório Circunstanciado de Fiscalização no formato exigido
 * pela CGU (Instrução Normativa nº 5/2017) e pelo TCU, integrando:
 *   - Dados do contrato (cfg)
 *   - Boletins de Medição executados
 *   - Aditivos e versões contratuais
 *   - Ocorrências e não-conformidades
 *   - Registro de chuvas (justificativa de prazo)
 *   - Etapas PAC concluídas
 */

import EventBus        from '../../core/EventBus.js';
import state           from '../../core/state.js';
import router          from '../../core/router.js';
import { formatters }  from '../../utils/formatters.js';
import FirebaseService from '../../firebase/firebase-service.js';

const fmtBRL = v   => (parseFloat(v)||0).toLocaleString('pt-BR', { style:'currency', currency:'BRL' });
const fmtBR  = iso => iso ? new Date(iso+'T12:00:00').toLocaleDateString('pt-BR') : '—';
const fmtPct = v   => (parseFloat(v)||0).toFixed(2) + '%';

export class RelatorioFederalModule {
  constructor() {
    this._subs     = [];
    this._etapas   = [];
    this._ocorrs   = [];
  }

  async init()    { this._bindEvents(); this._exposeGlobals(); }
  async onEnter() { await this._carregarDados(); this._render(); }

  async _carregarDados() {
    const obraId = state.get('obraAtivaId');
    if (!obraId) return;
    try {
      // FIX-E2.3: ler etapasPac do state central (já populado pelo etapas-pac module)
      // Se o state estiver vazio, busca do Firebase como fallback
      const etapasDoState = state.get('etapasPac');
      const [etapasCarregadas, docOc] = await Promise.all([
        etapasDoState?.length > 0
          ? Promise.resolve(etapasDoState)
          : FirebaseService.getEtapasPac(obraId).catch(() => []),
        FirebaseService.getOcorrenciasPaginado(obraId).catch(() => []),
      ]);
      this._etapas = etapasCarregadas || [];
      this._ocorrs = (docOc || []).filter(o => !o._tipoVisitaFiscal);
    } catch { this._etapas = []; this._ocorrs = []; }
  }

  _render() {
    const el = document.getElementById('relatorio-federal-conteudo');
    if (!el) return;
    const obraId = state.get('obraAtivaId');

    if (!obraId) {
      el.innerHTML = '<div style="text-align:center;padding:40px;color:var(--text-muted);font-size:13px">Selecione uma obra para gerar o relatório federal.</div>';
      return;
    }

    el.innerHTML = `
      <div style="background:var(--bg-surface);border:1px solid var(--border);border-radius:10px;padding:20px;margin-bottom:16px">
        <div style="font-size:13px;font-weight:700;color:var(--text-primary);margin-bottom:6px">📄 Relatório Circunstanciado — Formato CGU/TCU</div>
        <div style="font-size:12px;color:var(--text-muted);margin-bottom:16px;line-height:1.6">
          Gera o relatório de fiscalização conforme a <strong>Instrução Normativa CGU nº 5/2017</strong> e os
          modelos de Relatório Circunstanciado do TCU. Integra automaticamente todos os dados registrados no sistema.
        </div>
        <div style="display:flex;gap:8px;flex-wrap:wrap">
          <button data-action="_rf_gerarHTML"
            style="padding:9px 18px;background:var(--accent);border:none;border-radius:8px;color:#fff;font-size:12px;font-weight:700;cursor:pointer">
            📋 Visualizar Relatório
          </button>
          <button data-action="_rf_imprimir"
            style="padding:9px 18px;background:#16a34a;border:none;border-radius:8px;color:#fff;font-size:12px;font-weight:700;cursor:pointer">
            🖨️ Imprimir / Salvar PDF
          </button>
        </div>
      </div>

      <div id="rf-preview" style="display:none;background:var(--bg-surface);border:1px solid var(--border);border-radius:10px;padding:20px"></div>
    `;
  }

  _gerarConteudo() {
    const cfg      = state.get('cfg')           || {};
    const bms      = state.get('bms')           || [];
    const aditivos = state.get('aditivos')      || [];
    const itens    = (state.get('itensContrato')||[]).filter(i => !i.t);
    const ocorrs   = this._ocorrs;
    const etapas   = this._etapas;
    const dadosCh  = state.get('dadosChuva')    || {};
    const hoje     = new Date().toLocaleDateString('pt-BR', { day:'2-digit', month:'long', year:'numeric' });

    // Calcular avanço financeiro
    const valorContrato = parseFloat(cfg.valor) || 0;
    const valorMedido   = bms.reduce((s, bm) => s + (parseFloat(bm.valorAprovado || bm.valorTotal) || 0), 0);
    const pctFinanceiro = valorContrato > 0 ? ((valorMedido / valorContrato) * 100).toFixed(2) : 0;

    // Avanço físico (etapas PAC)
    const pctFisico = etapas.length > 0
      ? (etapas.reduce((s, e) => s + (e.pctRealizado || 0), 0) / etapas.length).toFixed(1)
      : '—';

    // Dias chuvosos
    const diasChuvosos = Object.values(dadosCh).reduce((s, ano) => {
      // FIX-E1.3: guard completo em todos os níveis — estrutura pode ser
      // incompleta se o módulo de chuva nunca foi acessado para esta obra.
      if (!ano || typeof ano !== 'object') return s;
      return s + Object.values(ano).reduce((sm, mes) => {
        if (!Array.isArray(mes)) return sm; // ← guard adicionado
        return sm + mes.filter(d => d?.mm > 0).length;
      }, 0);
    }, 0);

    return `
      <div id="rf-documento" style="font-family:Arial,sans-serif;font-size:12pt;color:#000;line-height:1.6;max-width:800px;margin:auto">

        <!-- Cabeçalho -->
        <div style="text-align:center;border-bottom:2px solid #000;padding-bottom:12px;margin-bottom:20px">
          <div style="font-size:11pt;font-weight:700;text-transform:uppercase">RELATÓRIO CIRCUNSTANCIADO DE FISCALIZAÇÃO</div>
          <div style="font-size:10pt;margin-top:4px">Conforme Instrução Normativa CGU nº 5/2017 e Acórdão TCU nº 2.622/2015</div>
        </div>

        <!-- 1. Identificação -->
        <div style="margin-bottom:20px">
          <div style="font-size:11pt;font-weight:700;border-bottom:1px solid #666;padding-bottom:4px;margin-bottom:10px;text-transform:uppercase">
            1. Identificação do Contrato
          </div>
          <table style="width:100%;border-collapse:collapse;font-size:10pt">
            <tr><td style="padding:4px 8px;width:35%;font-weight:700;background:#f5f5f5;border:1px solid #ddd">Contratante</td>
                <td style="padding:4px 8px;border:1px solid #ddd">${cfg.contratante || '—'}</td></tr>
            <tr><td style="padding:4px 8px;font-weight:700;background:#f5f5f5;border:1px solid #ddd">Contratada</td>
                <td style="padding:4px 8px;border:1px solid #ddd">${cfg.contratada || '—'} ${cfg.cnpj ? `(CNPJ: ${cfg.cnpj})` : ''}</td></tr>
            <tr><td style="padding:4px 8px;font-weight:700;background:#f5f5f5;border:1px solid #ddd">Objeto</td>
                <td style="padding:4px 8px;border:1px solid #ddd">${cfg.objeto || '—'}</td></tr>
            <tr><td style="padding:4px 8px;font-weight:700;background:#f5f5f5;border:1px solid #ddd">N.º do Contrato</td>
                <td style="padding:4px 8px;border:1px solid #ddd">${cfg.contrato || '—'}</td></tr>
            <tr><td style="padding:4px 8px;font-weight:700;background:#f5f5f5;border:1px solid #ddd">Valor Original</td>
                <td style="padding:4px 8px;border:1px solid #ddd">${fmtBRL(cfg.valor)}</td></tr>
            <tr><td style="padding:4px 8px;font-weight:700;background:#f5f5f5;border:1px solid #ddd">Início Previsto</td>
                <td style="padding:4px 8px;border:1px solid #ddd">${fmtBR(cfg.inicioPrev)} &nbsp;|&nbsp; Início Real: ${fmtBR(cfg.inicioReal)}</td></tr>
            <tr><td style="padding:4px 8px;font-weight:700;background:#f5f5f5;border:1px solid #ddd">Término Previsto</td>
                <td style="padding:4px 8px;border:1px solid #ddd">${fmtBR(cfg.termino)} &nbsp;|&nbsp; Duração: ${cfg.duracaoDias || '—'} dias</td></tr>
            <tr><td style="padding:4px 8px;font-weight:700;background:#f5f5f5;border:1px solid #ddd">Fiscal do Contrato</td>
                <td style="padding:4px 8px;border:1px solid #ddd">${cfg.fiscal || '—'} ${cfg.creaFiscal ? `(CREA: ${cfg.creaFiscal})` : ''}</td></tr>
            <tr><td style="padding:4px 8px;font-weight:700;background:#f5f5f5;border:1px solid #ddd">Responsável Técnico</td>
                <td style="padding:4px 8px;border:1px solid #ddd">${cfg.rt || '—'} ${cfg.creaRT ? `(CREA: ${cfg.creaRT})` : ''}</td></tr>
            <tr><td style="padding:4px 8px;font-weight:700;background:#f5f5f5;border:1px solid #ddd">Data deste Relatório</td>
                <td style="padding:4px 8px;border:1px solid #ddd">${hoje}</td></tr>
          </table>
        </div>

        <!-- 2. Situação dos Aditivos -->
        ${aditivos.length > 0 ? `
        <div style="margin-bottom:20px">
          <div style="font-size:11pt;font-weight:700;border-bottom:1px solid #666;padding-bottom:4px;margin-bottom:10px;text-transform:uppercase">
            2. Termos Aditivos
          </div>
          <table style="width:100%;border-collapse:collapse;font-size:10pt">
            <thead>
              <tr style="background:#f5f5f5">
                <th style="padding:6px 8px;border:1px solid #ddd;text-align:left">N.º</th>
                <th style="padding:6px 8px;border:1px solid #ddd;text-align:left">Data</th>
                <th style="padding:6px 8px;border:1px solid #ddd;text-align:left">Tipo</th>
                <th style="padding:6px 8px;border:1px solid #ddd;text-align:right">Valor</th>
                <th style="padding:6px 8px;border:1px solid #ddd;text-align:left">Objeto</th>
              </tr>
            </thead>
            <tbody>
              ${aditivos.map(a => `
                <tr>
                  <td style="padding:4px 8px;border:1px solid #ddd">${a.numero || '—'}</td>
                  <td style="padding:4px 8px;border:1px solid #ddd">${fmtBR(a.data)}</td>
                  <td style="padding:4px 8px;border:1px solid #ddd">${a.tipo || '—'}</td>
                  <td style="padding:4px 8px;border:1px solid #ddd;text-align:right">${fmtBRL(a.valor)}</td>
                  <td style="padding:4px 8px;border:1px solid #ddd">${a.objeto || '—'}</td>
                </tr>
              `).join('')}
            </tbody>
          </table>
        </div>` : ''}

        <!-- 3. Execução Financeira -->
        <div style="margin-bottom:20px">
          <div style="font-size:11pt;font-weight:700;border-bottom:1px solid #666;padding-bottom:4px;margin-bottom:10px;text-transform:uppercase">
            3. Execução Financeira e Física
          </div>
          <table style="width:100%;border-collapse:collapse;font-size:10pt">
            <tr><td style="padding:4px 8px;width:45%;font-weight:700;background:#f5f5f5;border:1px solid #ddd">Valor Total do Contrato (com aditivos)</td>
                <td style="padding:4px 8px;border:1px solid #ddd">${fmtBRL(valorContrato)}</td></tr>
            <tr><td style="padding:4px 8px;font-weight:700;background:#f5f5f5;border:1px solid #ddd">Valor Total Medido/Aprovado</td>
                <td style="padding:4px 8px;border:1px solid #ddd">${fmtBRL(valorMedido)}</td></tr>
            <tr><td style="padding:4px 8px;font-weight:700;background:#f5f5f5;border:1px solid #ddd">Avanço Financeiro</td>
                <td style="padding:4px 8px;border:1px solid #ddd;font-weight:700;color:#1d4ed8">${pctFinanceiro}%</td></tr>
            <tr><td style="padding:4px 8px;font-weight:700;background:#f5f5f5;border:1px solid #ddd">Avanço Físico (etapas PAC)</td>
                <td style="padding:4px 8px;border:1px solid #ddd;font-weight:700;color:#16a34a">${pctFisico}%</td></tr>
            <tr><td style="padding:4px 8px;font-weight:700;background:#f5f5f5;border:1px solid #ddd">N.º de Boletins de Medição</td>
                <td style="padding:4px 8px;border:1px solid #ddd">${bms.length} BM(s) emitidos</td></tr>
            <tr><td style="padding:4px 8px;font-weight:700;background:#f5f5f5;border:1px solid #ddd">Dias com Chuva Registrados</td>
                <td style="padding:4px 8px;border:1px solid #ddd">${diasChuvosos} dias (base para prorrogação de prazo)</td></tr>
          </table>
        </div>

        <!-- 4. Boletins de Medição -->
        ${bms.length > 0 ? `
        <div style="margin-bottom:20px">
          <div style="font-size:11pt;font-weight:700;border-bottom:1px solid #666;padding-bottom:4px;margin-bottom:10px;text-transform:uppercase">
            4. Boletins de Medição Emitidos
          </div>
          <table style="width:100%;border-collapse:collapse;font-size:10pt">
            <thead>
              <tr style="background:#f5f5f5">
                <th style="padding:6px 8px;border:1px solid #ddd;text-align:left">BM</th>
                <th style="padding:6px 8px;border:1px solid #ddd;text-align:left">Período</th>
                <th style="padding:6px 8px;border:1px solid #ddd;text-align:right">Valor</th>
                <th style="padding:6px 8px;border:1px solid #ddd;text-align:center">Situação</th>
              </tr>
            </thead>
            <tbody>
              ${bms.map(bm => `
                <tr>
                  <td style="padding:4px 8px;border:1px solid #ddd">${bm.label || '—'}</td>
                  <td style="padding:4px 8px;border:1px solid #ddd">${bm.mes || '—'} / ${fmtBR(bm.data)}</td>
                  <td style="padding:4px 8px;border:1px solid #ddd;text-align:right">${fmtBRL(bm.valorAprovado || bm.valorTotal)}</td>
                  <td style="padding:4px 8px;border:1px solid #ddd;text-align:center">${bm.status || 'Emitido'}</td>
                </tr>
              `).join('')}
            </tbody>
          </table>
        </div>` : ''}

        <!-- 5. Etapas PAC -->
        ${etapas.length > 0 ? `
        <div style="margin-bottom:20px">
          <div style="font-size:11pt;font-weight:700;border-bottom:1px solid #666;padding-bottom:4px;margin-bottom:10px;text-transform:uppercase">
            5. Marcos Físicos (Etapas PAC)
          </div>
          <table style="width:100%;border-collapse:collapse;font-size:10pt">
            <thead>
              <tr style="background:#f5f5f5">
                <th style="padding:6px 8px;border:1px solid #ddd;text-align:left">Etapa</th>
                <th style="padding:6px 8px;border:1px solid #ddd;text-align:center">Mín. %</th>
                <th style="padding:6px 8px;border:1px solid #ddd;text-align:center">Realizado</th>
                <th style="padding:6px 8px;border:1px solid #ddd;text-align:center">Status</th>
                <th style="padding:6px 8px;border:1px solid #ddd;text-align:left">Vistoria</th>
              </tr>
            </thead>
            <tbody>
              ${etapas.map(e => `
                <tr>
                  <td style="padding:4px 8px;border:1px solid #ddd">${e.label}</td>
                  <td style="padding:4px 8px;border:1px solid #ddd;text-align:center">${e.pctMinimo}%</td>
                  <td style="padding:4px 8px;border:1px solid #ddd;text-align:center;font-weight:700;color:${(e.pctRealizado||0)>=(e.pctMinimo||0)?'#16a34a':'#dc2626'}">${e.pctRealizado||0}%</td>
                  <td style="padding:4px 8px;border:1px solid #ddd;text-align:center">${e.status==='concluida'?'✅ Concluída':e.status==='em_andamento'?'🔄 Em andamento':e.status==='reprovada'?'❌ Reprovada':'⏳ Pendente'}</td>
                  <td style="padding:4px 8px;border:1px solid #ddd">${fmtBR(e.dataVistoria)} ${e.fiscal?'— '+e.fiscal:''}</td>
                </tr>
              `).join('')}
            </tbody>
          </table>
        </div>` : ''}

        <!-- 6. Ocorrências e Não-Conformidades -->
        <div style="margin-bottom:20px">
          <div style="font-size:11pt;font-weight:700;border-bottom:1px solid #666;padding-bottom:4px;margin-bottom:10px;text-transform:uppercase">
            6. Ocorrências e Não-Conformidades
          </div>
          ${ocorrs.length === 0
            ? '<p style="font-size:10pt">Nenhuma ocorrência registrada no período.</p>'
            : `<table style="width:100%;border-collapse:collapse;font-size:10pt">
                <thead>
                  <tr style="background:#f5f5f5">
                    <th style="padding:6px 8px;border:1px solid #ddd;text-align:left">N.º</th>
                    <th style="padding:6px 8px;border:1px solid #ddd;text-align:left">Data</th>
                    <th style="padding:6px 8px;border:1px solid #ddd;text-align:left">Tipo / Gravidade</th>
                    <th style="padding:6px 8px;border:1px solid #ddd;text-align:left">Descrição</th>
                    <th style="padding:6px 8px;border:1px solid #ddd;text-align:center">Situação</th>
                  </tr>
                </thead>
                <tbody>
                  ${ocorrs.map(o => `
                    <tr>
                      <td style="padding:4px 8px;border:1px solid #ddd">${o.numero||'—'}</td>
                      <td style="padding:4px 8px;border:1px solid #ddd;white-space:nowrap">${fmtBR(o.data)}</td>
                      <td style="padding:4px 8px;border:1px solid #ddd">${o.tipo||'—'} / ${o.gravidade||'—'}</td>
                      <td style="padding:4px 8px;border:1px solid #ddd">${o.descricao||'—'}</td>
                      <td style="padding:4px 8px;border:1px solid #ddd;text-align:center">${o.resolvida?'✅ Resolvida':'⚠️ Aberta'}</td>
                    </tr>
                  `).join('')}
                </tbody>
              </table>`
          }
        </div>

        <!-- 7. Conclusão e Assinatura -->
        <div style="margin-bottom:20px">
          <div style="font-size:11pt;font-weight:700;border-bottom:1px solid #666;padding-bottom:4px;margin-bottom:10px;text-transform:uppercase">
            7. Conclusão do Fiscal
          </div>
          <div style="background:#f5f5f5;border:1px solid #ddd;border-radius:4px;padding:12px;font-size:10pt;min-height:80px">
            <em>[Espaço reservado para conclusão e avaliação do fiscal. Imprima e preencha manualmente ou edite o campo antes de imprimir.]</em>
          </div>
        </div>

        <!-- Assinatura -->
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:40px;margin-top:40px;font-size:10pt;text-align:center">
          <div>
            <div style="border-top:1px solid #000;padding-top:8px">
              ${cfg.fiscal || 'Fiscal do Contrato'}<br>
              ${cfg.creaFiscal ? `CREA: ${cfg.creaFiscal}` : ''}
            </div>
          </div>
          <div>
            <div style="border-top:1px solid #000;padding-top:8px">
              ${cfg.contratante || 'Órgão Contratante'}<br>
              Data: ___/___/______
            </div>
          </div>
        </div>

        <div style="margin-top:24px;font-size:8pt;color:#888;text-align:center;border-top:1px solid #ddd;padding-top:8px">
          Relatório gerado automaticamente pelo sistema Fiscal na Obra em ${hoje}. Documento sujeito a revisão pelo fiscal responsável.
        </div>
      </div>
    `;
  }

  _gerarHTML() {
    const el = document.getElementById('rf-preview');
    if (!el) return;
    el.style.display = 'block';
    el.innerHTML     = this._gerarConteudo();
    el.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  _imprimir() {
    const conteudo = this._gerarConteudo();
    const win      = window.open('', '_blank');
    if (!win) { window.toast?.('⚠️ Popup bloqueado. Permita popups para imprimir.', 'warn'); return; }
    win.document.write(`<!DOCTYPE html><html lang="pt-BR"><head>
      <meta charset="UTF-8"><title>Relatório Circunstanciado — Fiscal na Obra</title>
      <style>body{margin:20px;font-family:Arial,sans-serif}@media print{body{margin:10mm}}</style>
    </head><body>${conteudo}<script>window.onload=()=>{window.print();window.onafterprint=()=>window.close();}<\/script></body></html>`);
    win.document.close();
  }

  _bindEvents() {
    this._subs.push(EventBus.on('obra:selecionada', async () => {
      try { await this._carregarDados(); if (router.current === 'relatorio-federal') this._render(); }
      catch (e) {}
    }, 'relatorio-federal'));
  }

  _exposeGlobals() {
    window._rf_gerarHTML = () => this._gerarHTML();
    window._rf_imprimir  = () => this._imprimir();
  }

  destroy() { this._subs.forEach(u => u()); this._subs = []; }
}
