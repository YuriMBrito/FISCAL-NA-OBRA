/**
 * ╔══════════════════════════════════════════════════════════════╗
 * ║  FISCAL NA OBRA v19 — modules/exportacao-obra/             ║
 * ║  exportacao-obra-controller.js                              ║
 * ║  Exportação completa de documentação da obra em ZIP        ║
 * ╚══════════════════════════════════════════════════════════════╝
 *
 * Usa JSZip via CDN para gerar o arquivo ZIP no navegador.
 * Reutiliza funções de CSV existentes nos outros módulos.
 */

import state          from '../../core/state.js';
import FirebaseService from '../../firebase/firebase-service.js';
import { baixarCSV, numCSV } from '../../utils/csv-export.js';
import {
  getMedicoes,
  getValorAcumuladoTotal,
  getValorAcumuladoAnterior,
  getValorMedicaoAtual,
} from '../boletim-medicao/bm-calculos.js';

export class ExportacaoObraModule {
  constructor() {}

  async init() {
    try { this._exposeGlobals(); }
    catch(e) { console.error('[ExportacaoObra] init:', e); }
  }

  // ── Carrega JSZip dinamicamente se ainda não estiver disponível
  async _carregarJSZip() {
    if (typeof window.JSZip !== 'undefined') return window.JSZip;
    return new Promise((resolve, reject) => {
      const s = document.createElement('script');
      s.src = 'https://cdnjs.cloudflare.com/ajax/libs/jszip/3.10.1/jszip.min.js';
      s.onload  = () => resolve(window.JSZip);
      s.onerror = () => reject(new Error('JSZip não carregou'));
      document.head.appendChild(s);
    });
  }

  // ── Exportação principal ──────────────────────────────────────
  async exportarDocumentacaoObra() {
    const progressEl = document.getElementById('cfg-export-progress');
    const setProgress = (msg) => {
      if (progressEl) { progressEl.style.display = 'block'; progressEl.textContent = msg; }
    };

    try {
      const obraId = state.get('obraAtivaId');
      const cfg    = state.get('cfg') || {};
      const bms    = state.get('bms') || [];
      const itens  = state.get('itensContrato') || [];

      if (!obraId) {
        window.toast?.('⚠️ Selecione uma obra ativa.', 'warn');
        return;
      }

      setProgress('⏳ Carregando JSZip...');
      const JSZip = await this._carregarJSZip();
      const zip   = new JSZip();

      const nomeObra  = (cfg.objeto || cfg.contrato || obraId).replace(/[<>:"/\\|?*]/g, '_').slice(0, 60);
      const pastaRaiz = zip.folder(`Obra_${nomeObra}`);

      // ── 1. Diários de Obra (CSV) ─────────────────────────────
      setProgress('📓 Exportando Diários de Obra...');
      try {
        const pastaDiario = pastaRaiz.folder('Diarios_de_Obra');
        const diarios = await FirebaseService.getDiario(obraId).catch(() => []);
        if (diarios && diarios.length) {
          const csvDiario = this._csvDiario(diarios);
          pastaDiario.file('diario_de_obras.csv', csvDiario);
        }
      } catch(e) { console.warn('[ExportacaoObra] diarios:', e); }

      // ── 2. Relatório de BMs (CSV) ─────────────────────────────
      setProgress('📊 Exportando Boletins de Medição...');
      try {
        const pastaBM = pastaRaiz.folder('Boletins_de_Medicao');
        const csvBM   = this._csvBoletins(obraId, bms, itens, cfg);
        pastaBM.file('boletins_de_medicao.csv', csvBM);
      } catch(e) { console.warn('[ExportacaoObra] bms:', e); }

      // ── 3. Memória de Cálculo (CSV) ────────────────────────────
      setProgress('📐 Exportando Memória de Cálculo...');
      try {
        const pastaMemoria = pastaRaiz.folder('Memoria_de_Calculo');
        bms.forEach(bm => {
          const csvMem = this._csvMemoria(obraId, bm, itens, cfg);
          pastaMemoria.file(`memoria_calculo_BM${String(bm.num).padStart(2,'0')}.csv`, csvMem);
        });
      } catch(e) { console.warn('[ExportacaoObra] memoria:', e); }

      // ── 4. Painel Contratual (CSV) ─────────────────────────────
      setProgress('📋 Exportando Painel Contratual...');
      try {
        const pastaPainel = pastaRaiz.folder('Painel_Contratual');
        const csvPainel   = this._csvPainelContratual(obraId, cfg, bms, itens);
        pastaPainel.file('painel_contratual.csv', csvPainel);
      } catch(e) { console.warn('[ExportacaoObra] painel:', e); }

      // ── 5. Quadro de Chuvas (CSV) ──────────────────────────────
      setProgress('🌧️ Exportando Quadro de Chuvas...');
      try {
        const pastaChuva = pastaRaiz.folder('Quadro_de_Chuva');
        const anoAtual   = new Date().getFullYear();
        for (const ano of [anoAtual - 1, anoAtual]) {
          const dados = await FirebaseService.getChuva(obraId, ano).catch(() => null);
          if (dados) {
            const csvChuva = this._csvChuva(dados, ano);
            pastaChuva.file(`chuvas_${ano}.csv`, csvChuva);
          }
        }
      } catch(e) { console.warn('[ExportacaoObra] chuvas:', e); }

      // ── 6. README ─────────────────────────────────────────────
      const readme = this._gerarReadme(cfg, bms, nomeObra);
      pastaRaiz.file('LEIAME.txt', readme);

      // ── Gerar e baixar ZIP ────────────────────────────────────
      setProgress('📦 Gerando arquivo ZIP...');
      const content = await zip.generateAsync({
        type: 'blob',
        compression: 'DEFLATE',
        compressionOptions: { level: 6 }
      });

      const url = URL.createObjectURL(content);
      const a   = document.createElement('a');
      a.href    = url;
      a.download = `Documentacao_${nomeObra}_${new Date().toISOString().slice(0,10)}.zip`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);

      setProgress('');
      if (progressEl) progressEl.style.display = 'none';

      window.auditRegistrar?.({
        modulo: 'Config',
        tipo: 'exportação',
        registro: `Obra: ${nomeObra}`,
        detalhe: 'Exportação completa ZIP da documentação da obra'
      });

      window.toast?.('✅ Documentação exportada com sucesso!', 'ok');
    } catch(e) {
      console.error('[ExportacaoObra] exportar:', e);
      setProgress('');
      if (progressEl) progressEl.style.display = 'none';
      window.toast?.('❌ Erro ao exportar documentação: ' + e.message, 'error');
    }
  }

  // ── Helpers de geração de CSV ─────────────────────────────────

  _csvDiario(diarios) {
    const CLIMAS = { sol:'Sol', parcial:'Parcial', chuva_leve:'Chuva Leve', chuva:'Chuva', tempestade:'Tempestade' };
    const cabec = ['Data', 'Clima', 'Atividades', 'Efetivo', 'Materiais', 'Responsável', 'Observações', 'Improdutivo'];
    const linhas = diarios.map(e => [
      e.data || '', CLIMAS[e.clima] || '', e.atividades || '',
      e.efetivo || '', e.materiais || '', e.responsavel || '',
      e.observacoes || '', e.improdutivo ? 'Sim' : 'Não'
    ]);
    return this._toCSV([cabec, ...linhas]);
  }

  _csvBoletins(obraId, bms, itens, cfg) {
    const cabec = ['BM', 'Período', 'Data', 'Valor BM (R$)', 'Acumulado Anterior (R$)', 'Acumulado Total (R$)', '% Acumulado'];
    const vContr = parseFloat(cfg.valor) || 0;
    const linhas = bms.map(bm => {
      const vAcumAnt  = getValorAcumuladoAnterior(obraId, bm.num, itens, cfg);
      const vAcumTot  = getValorAcumuladoTotal(obraId, bm.num, itens, cfg);
      const vMed      = vAcumTot - vAcumAnt;
      const pctAcum   = vContr > 0 ? (vAcumTot / vContr * 100) : 0;
      return [
        bm.label || `BM ${bm.num}`,
        bm.mes   || '',
        bm.data  || '',
        numCSV(vMed),
        numCSV(vAcumAnt),
        numCSV(vAcumTot),
        numCSV(pctAcum) + '%',
      ];
    });
    return this._toCSV([cabec, ...linhas]);
  }

  _csvMemoria(obraId, bm, itens, cfg) {
    const cabec = ['Item', 'Descrição', 'Unidade', 'Qtd Contratada', 'P. Unit. (R$)', 'Qtd Anterior', 'Qtd Atual', 'Qtd Acumulada'];
    const med   = getMedicoes(obraId, bm.num);
    const linhas = (itens || []).filter(it => !it.t).map(it => {
      const m = med[it.id] || {};
      const linhas2 = Object.values(m.linhas || {});
      const qtdAtual = linhas2.reduce((s, l) => s + (parseFloat(l.qtd) || 0), 0);
      const qtdAnt  = parseFloat(m._qtdAcumAnterior || 0);
      return [
        it.id, it.desc || '', it.un || '',
        numCSV(it.qtd), numCSV(it.pu),
        numCSV(qtdAnt), numCSV(qtdAtual), numCSV(qtdAnt + qtdAtual)
      ];
    });
    return this._toCSV([cabec, ...linhas]);
  }

  _csvPainelContratual(obraId, cfg, bms, itens) {
    const cabec = ['Campo', 'Valor'];
    const vContr = parseFloat(cfg.valor) || 0;
    const ultimoBm = bms[bms.length - 1];
    const vAcumTot = ultimoBm
      ? getValorAcumuladoTotal(obraId, ultimoBm.num, itens, cfg)
      : 0;
    const saldo    = vContr - vAcumTot;
    const pct      = vContr > 0 ? (vAcumTot / vContr * 100) : 0;

    const dados = [
      ['Contrato', cfg.contrato || ''],
      ['Objeto', cfg.objeto || ''],
      ['Contratante', cfg.contratante || ''],
      ['Contratada', cfg.contratada || ''],
      ['Fiscal', cfg.fiscal || ''],
      ['Valor Contratual (R$)', numCSV(vContr)],
      ['Valor Medido Acumulado (R$)', numCSV(vAcumTot)],
      ['Saldo a Executar (R$)', numCSV(saldo)],
      ['% Executado', numCSV(pct) + '%'],
      ['Qtd de Boletins', bms.length],
      ['Início Previsto', cfg.inicioPrev || ''],
      ['Início Real', cfg.inicioReal || ''],
      ['Término Previsto', cfg.termino || ''],
    ];

    return this._toCSV([cabec, ...dados]);
  }

  _csvChuva(dados, ano) {
    const MESES = ['Janeiro','Fevereiro','Março','Abril','Maio','Junho',
                   'Julho','Agosto','Setembro','Outubro','Novembro','Dezembro'];
    const cabec = ['Mês', 'Dia', 'Clima', 'Chuva (mm)', 'Observação'];
    const linhas = [];
    for (let mes = 0; mes < 12; mes++) {
      const mesDados = dados[mes] || {};
      Object.entries(mesDados).forEach(([dia, info]) => {
        if (typeof info === 'object' && info !== null) {
          linhas.push([MESES[mes], dia, info.clima || '', info.mm || '', info.obs || '']);
        }
      });
    }
    return this._toCSV([cabec, ...linhas]);
  }

  _toCSV(matriz) {
    return matriz
      .map(row => row.map(c => `"${String(c ?? '').replace(/"/g, '""')}"`).join(';'))
      .join('\n');
  }

  _gerarReadme(cfg, bms, nomeObra) {
    const agora = new Date().toLocaleString('pt-BR');
    return `FISCAL NA OBRA — Exportação de Documentação
=============================================
Obra: ${nomeObra}
Contrato: ${cfg.contrato || '—'}
Contratante: ${cfg.contratante || '—'}
Contratada: ${cfg.contratada || '—'}
Fiscal: ${cfg.fiscal || '—'}
Valor Contratual: R$ ${numCSV(cfg.valor || 0).replace(',', '.')}
Qtd de Boletins: ${bms.length}

Exportado em: ${agora}

ESTRUTURA DO ARQUIVO ZIP
------------------------
Diarios_de_Obra/         - Registros do Diário de Obras
Boletins_de_Medicao/     - Resumo de todos os BMs
Memoria_de_Calculo/      - Detalhamento por BM
Painel_Contratual/       - Resumo contratual
Quadro_de_Chuva/         - Registros de chuva por ano

Todos os arquivos CSV estão em codificação UTF-8 com BOM
e separados por ponto-e-vírgula (;) para compatibilidade com Excel.
`;
  }

  _exposeGlobals() {
    window.exportarDocumentacaoObra = () => {
      try { this.exportarDocumentacaoObra(); } catch(e) {
        console.error('[ExportacaoObra]', e);
      }
    };
  }

  onEnter() {}
  destroy() {}
}
