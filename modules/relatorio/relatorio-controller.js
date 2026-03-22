/**
 * ╔══════════════════════════════════════════════════════════════╗
 * ║  FISCAL NA OBRA v15 — relatorio-controller.js               ║
 * ║  Módulo RECRIADO — Relatório Mensal de Acompanhamento       ║
 * ╚══════════════════════════════════════════════════════════════╝
 */

import EventBus       from '../../core/EventBus.js';
import state          from '../../core/state.js';
import router         from '../../core/router.js';
import { formatters } from '../../utils/formatters.js';
import FirebaseService from '../../firebase/firebase-service.js';
import {
  getMedicoes,
  getLinhasItem,
  getFxFormula,
  sumLinhasQtd,
  getValorAcumuladoTotal,
  getValorAcumuladoAnterior,
  getValorMedicaoAtual,
  getQtdAcumuladoTotalItem,
  getQtdAcumuladoAnteriorItem,
} from '../boletim-medicao/bm-calculos.js';
import { baixarCSV, numCSV } from '../../utils/csv-export.js';

const R$ = v => formatters.currency(v);
const n2 = v => formatters.number(v, 2);
const pct = v => `${(parseFloat(v)||0).toFixed(2)} %`;
const dataBR = iso => iso ? new Date(iso+'T12:00:00').toLocaleDateString('pt-BR') : '—';
const MESES = ['Janeiro','Fevereiro','Março','Abril','Maio','Junho',
               'Julho','Agosto','Setembro','Outubro','Novembro','Dezembro'];

const CHECKLIST_ITEMS = [
  { id:'art',         label:'ART/RRT de execução registrada e em obra'           },
  { id:'projetos',    label:'Projetos aprovados disponíveis no canteiro'          },
  { id:'materiais',   label:'Materiais com notas fiscais e ensaios (quando exig.)'},
  { id:'cronograma',  label:'Cronograma físico sendo cumprido'                   },
  { id:'placa',       label:'Placa de obra instalada corretamente'                },
  { id:'licencas',    label:'Ligações provisórias (água/energia) regularizadas'  },
  { id:'diario',      label:'Diário de Obra em dia e assinado pelo RT'           },
  { id:'epis',        label:'EPIs sendo utilizados pelos trabalhadores'          },
  { id:'conf_proj',   label:'Conformidade com o projeto e especificações técnicas'},
  { id:'limpeza',     label:'Limpeza e organização do canteiro de obras'         },
  { id:'sinalizacao', label:'Sinalização de segurança adequada'                  },
  { id:'subcontr',    label:'Subcontratações autorizadas (se houver)'            },
];

export class RelatorioModule {
  constructor() {
    this._subs        = [];
    this._ocorrencias = [];
    this._checklist   = {};
    this._obs         = '';
    this._bmSel       = null;
    this._dataIni     = '';
    this._dataFim     = '';
  }

  async init() {
    try { this._bindEvents(); this._exposeGlobals(); }
    catch(e) { console.error('[RelatorioModule] init:', e); }
  }

  async onEnter() {
    try {
      await this._carregarDados();
      this._render();
    } catch(e) { console.error('[RelatorioModule] onEnter:', e); }
  }

  async _carregarDados() {
    const obraId = state.get('obraAtivaId');
    if (!obraId) return;
    try {
      const [ocorrs] = await Promise.all([
        FirebaseService.getOcorrencias(obraId).catch(() => []),
      ]);
      // Load saved checklist/obs from bm data if available
      const bms = state.get('bms') || [];
      const selBmNum = this._bmSel || (bms[bms.length-1]?.num) || 1;
      const bm = bms.find(b => b.num === selBmNum) || bms[0];
      this._ocorrencias = (ocorrs||[]).filter(o => !o._tipoVisitaFiscal);
      if (bm?.relChecklist) this._checklist = bm.relChecklist;
      if (bm?.relObs)       this._obs       = bm.relObs;
    } catch(e) { console.error('[RelatorioModule] _carregarDados:', e); }
  }

  // ═══════════════════════════════════════════════════════════════
  //  RENDER
  // ═══════════════════════════════════════════════════════════════
  _render() {
    const el = document.getElementById('rel-conteudo');
    if (!el) return;

    const obraId = state.get('obraAtivaId');
    const cfg    = state.get('cfg') || {};
    const bms    = state.get('bms') || [];
    const itens  = state.get('itensContrato') || [];

    if (!obraId) {
      el.innerHTML = `<div style="text-align:center;padding:40px;color:var(--text-muted);font-size:13px">
        Selecione uma obra para gerar o relatório.</div>`;
      return;
    }
    if (!bms.length) {
      el.innerHTML = `<div style="text-align:center;padding:40px;color:var(--text-muted);font-size:12px">
        Nenhum boletim de medição cadastrado.</div>`;
      return;
    }

    // Sync BM selector from header
    const selEl = document.getElementById('sel-rel-bm');
    const bmNum = parseInt(selEl?.value) || bms[bms.length-1]?.num || 1;
    const bm    = bms.find(b => b.num === bmNum) || bms[0];
    this._bmSel = bmNum;

    // Período from header inputs
    const dataIniEl = document.getElementById('rel-data-ini');
    const dataFimEl = document.getElementById('rel-data-fim');
    const dataIni   = dataIniEl?.value || '';
    const dataFim   = dataFimEl?.value || '';

    // Cálculos financeiros
    const bdi       = parseFloat(cfg.bdi)||0.25;
    const vContr    = parseFloat(cfg.valor)||0;
    const vAcumAnt  = getValorAcumuladoAnterior(obraId, bmNum, itens, cfg);
    const vAcumTot  = getValorAcumuladoTotal(obraId, bmNum, itens, cfg);
    const vPeriodo  = vAcumTot - vAcumAnt;
    const saldo     = vContr - vAcumTot;
    const pctFisico = vContr > 0 ? Math.min(100, vAcumTot / vContr * 100) : 0;

    // Prazo
    const hoje = new Date(new Date().toDateString());
    const inicioD  = cfg.inicioPrev ? new Date(cfg.inicioPrev+'T12:00:00') : null;
    const terminoD = cfg.termino    ? new Date(cfg.termino+'T12:00:00')    : null;
    const diasDecor= inicioD ? Math.max(0, Math.round((hoje-inicioD)/86400000)) : 0;
    const diasRest = terminoD ? Math.max(0, Math.round((terminoD-hoje)/86400000)) : 0;
    const atrasada = terminoD && hoje > terminoD && cfg.status !== 'Concluída';

    // Mês de referência
    const mesRef = bm.mes || (bm.data ? (() => {
      const d = new Date(bm.data+'T12:00:00');
      return `${MESES[d.getMonth()]}/${d.getFullYear()} — BM ${String(bmNum).padStart(2,'0')}`;
    })() : `BM ${String(bmNum).padStart(2,'0')}`);

    // Serviços executados no período
    const med = getMedicoes(obraId, bmNum);
    const servicosPeriodo = itens.filter(it => {
      if (it.t) return false;
      const qtdAcumAnt = bmNum <= 1 ? 0 : (() => {
        const medAnt = getMedicoes(obraId, bmNum-1);
        return sumLinhasQtd(it.und, getLinhasItem(medAnt, it.id), getFxFormula(medAnt, it.id));
      })();
      const qtdAcumTot = sumLinhasQtd(it.und, getLinhasItem(med, it.id), getFxFormula(med, it.id));
      return (qtdAcumTot - qtdAcumAnt) > 0;
    }).map(it => {
      const qtdAcumAnt = bmNum <= 1 ? 0 : (() => {
        const medAnt = getMedicoes(obraId, bmNum-1);
        return sumLinhasQtd(it.und, getLinhasItem(medAnt, it.id), getFxFormula(medAnt, it.id));
      })();
      const qtdAcumTot = sumLinhasQtd(it.und, getLinhasItem(med, it.id), getFxFormula(med, it.id));
      const qtdPer = n2(qtdAcumTot - qtdAcumAnt);
      const upBdi  = n2((it.up||0) * (1+bdi));
      const total  = n2(qtdPer * upBdi);
      return { ...it, qtdPer, upBdi, total };
    });

    const totalPeriodo = servicosPeriodo.reduce((s,it) => s + it.total, 0);

    // Ocorrências filtradas pelo período do BM
    const ocorrsFiltradas = this._ocorrencias.filter(o => {
      if (!dataIni && !dataFim) return true;
      const d = o.data || '';
      if (dataIni && d < dataIni) return false;
      if (dataFim && d > dataFim) return false;
      return true;
    });

    el.innerHTML = `
      <!-- ── CABEÇALHO DA OBRA ──────────────────────────────── -->
      <div style="border:1px solid var(--border);border-radius:8px;overflow:hidden;margin-bottom:14px">
        <table style="width:100%;border-collapse:collapse;font-size:11.5px">
          <tbody>
            <tr>
              <td style="padding:7px 12px;border-bottom:1px solid var(--border);border-right:1px solid var(--border);
                width:130px;color:var(--text-muted);font-size:10px;font-weight:600;text-transform:uppercase">
                Contratante:</td>
              <td style="padding:7px 12px;border-bottom:1px solid var(--border);border-right:1px solid var(--border);
                font-weight:600;color:var(--text-primary)">${cfg.contratante||'—'}</td>
              <td style="padding:7px 12px;border-bottom:1px solid var(--border);border-right:1px solid var(--border);
                width:120px;color:var(--text-muted);font-size:10px;font-weight:600;text-transform:uppercase">
                Início Previsto:</td>
              <td style="padding:7px 12px;border-bottom:1px solid var(--border);
                color:var(--text-primary)">${dataBR(cfg.inicioPrev)}</td>
            </tr>
            <tr>
              <td style="padding:7px 12px;border-bottom:1px solid var(--border);border-right:1px solid var(--border);
                color:var(--text-muted);font-size:10px;font-weight:600;text-transform:uppercase">Contratada:</td>
              <td style="padding:7px 12px;border-bottom:1px solid var(--border);border-right:1px solid var(--border);
                font-weight:600;color:var(--text-primary)">${cfg.contratada||'—'}</td>
              <td style="padding:7px 12px;border-bottom:1px solid var(--border);border-right:1px solid var(--border);
                color:var(--text-muted);font-size:10px;font-weight:600;text-transform:uppercase">Início Real:</td>
              <td style="padding:7px 12px;border-bottom:1px solid var(--border);
                color:var(--text-primary)">${dataBR(cfg.inicioReal)}</td>
            </tr>
            <tr>
              <td style="padding:7px 12px;border-bottom:1px solid var(--border);border-right:1px solid var(--border);
                color:var(--text-muted);font-size:10px;font-weight:600;text-transform:uppercase">Objeto:</td>
              <td style="padding:7px 12px;border-bottom:1px solid var(--border);border-right:1px solid var(--border);
                color:var(--text-primary)">${cfg.objeto||'—'}</td>
              <td style="padding:7px 12px;border-bottom:1px solid var(--border);border-right:1px solid var(--border);
                color:var(--text-muted);font-size:10px;font-weight:600;text-transform:uppercase">Término Previsto:</td>
              <td style="padding:7px 12px;border-bottom:1px solid var(--border);color:var(--text-primary)">
                ${dataBR(cfg.termino)}
                ${atrasada?`<span style="font-size:9px;background:#fef2f2;border:1px solid #fca5a5;color:#dc2626;
                  padding:1px 6px;border-radius:10px;margin-left:6px;font-weight:700">ATRASADO</span>`:''}
              </td>
            </tr>
            <tr>
              <td style="padding:7px 12px;border-bottom:1px solid var(--border);border-right:1px solid var(--border);
                color:var(--text-muted);font-size:10px;font-weight:600;text-transform:uppercase">Contrato Nº:</td>
              <td style="padding:7px 12px;border-bottom:1px solid var(--border);border-right:1px solid var(--border);
                font-family:var(--font-mono);color:var(--text-primary)">${cfg.contrato||'—'}</td>
              <td style="padding:7px 12px;border-bottom:1px solid var(--border);border-right:1px solid var(--border);
                color:var(--text-muted);font-size:10px;font-weight:600;text-transform:uppercase">Fiscal:</td>
              <td style="padding:7px 12px;border-bottom:1px solid var(--border);color:var(--text-primary)">
                ${cfg.fiscal||'—'}${cfg.creaFiscal?` — ${cfg.creaFiscal}`:''}
              </td>
            </tr>
            <tr>
              <td style="padding:7px 12px;border-right:1px solid var(--border);
                color:var(--text-muted);font-size:10px;font-weight:600;text-transform:uppercase">Valor Contratual:</td>
              <td style="padding:7px 12px;border-right:1px solid var(--border);
                font-family:var(--font-mono);font-weight:700;font-size:13px;color:var(--text-primary);white-space:nowrap">${R$(vContr)}</td>
              <td style="padding:7px 12px;border-right:1px solid var(--border);
                color:var(--text-muted);font-size:10px;font-weight:600;text-transform:uppercase">Mês Referência:</td>
              <td style="padding:7px 12px;font-weight:600;color:var(--text-primary)">${mesRef}</td>
            </tr>
          </tbody>
        </table>
      </div>

      <!-- ── KPI CARDS ──────────────────────────────────────── -->
      <div style="display:grid;grid-template-columns:repeat(4,1fr);gap:10px;margin-bottom:14px">
        ${this._kpiCard('VALOR CONTRATUAL',    R$(vContr),   '#6b7280', '#f8fafc')}
        ${this._kpiCard('ACUMULADO TOTAL',     R$(vAcumTot), '#1e40af', '#eff6ff')}
        ${this._kpiCard('SALDO A EXECUTAR',    R$(saldo),    saldo<0?'#dc2626':'#047857', saldo<0?'#fef2f2':'#f0fdf4')}
        ${this._kpiCardSituacao(cfg.status||'Em andamento', atrasada)}
      </div>

      <!-- ── SITUAÇÃO FÍSICO-FINANCEIRA ─────────────────────── -->
      <div style="border:1px solid var(--border);border-radius:8px;margin-bottom:14px;overflow:hidden">
        <div style="background:var(--bg-surface);padding:8px 14px;font-size:10px;font-weight:700;
          color:var(--text-muted);text-transform:uppercase;letter-spacing:.5px;border-bottom:1px solid var(--border)">
          | SITUAÇÃO FÍSICO-FINANCEIRA</div>
        <div style="display:grid;grid-template-columns:repeat(5,1fr);border-collapse:collapse">
          ${this._sfCard('% FÍSICO ACUM.', pct(pctFisico),   '#1e40af', false)}
          ${this._sfCard('VALOR FIN. ACUM.', R$(vAcumTot),  '#1e40af', false)}
          ${this._sfCard('SALDO',           R$(saldo),       saldo<0?'#dc2626':'#047857', saldo<0)}
          ${this._sfCard('DIAS DECORRIDOS', diasDecor,       'var(--text-primary)', false)}
          ${this._sfCard('DIAS RESTANTES',  diasRest,        diasRest<30?'#dc2626':'var(--text-primary)', false)}
        </div>
      </div>

      <!-- ── SERVIÇOS EXECUTADOS NO PERÍODO ─────────────────── -->
      <div style="border:1px solid var(--border);border-radius:8px;margin-bottom:14px;overflow:hidden">
        <div style="background:var(--bg-surface);padding:8px 14px;font-size:10px;font-weight:700;
          color:var(--text-muted);text-transform:uppercase;letter-spacing:.5px;border-bottom:1px solid var(--border)">
          | SERVIÇOS EXECUTADOS NO PERÍODO</div>
        <table style="width:100%;border-collapse:collapse;font-size:11px">
          <thead style="background:var(--bg-surface)">
            <tr>
              ${['DESCRIÇÃO','UND','QUANT.','P.UNIT. C/BDI','TOTAL (R$)'].map((h,i) =>
                `<th style="padding:7px 12px;text-align:${i>1?'right':'left'};font-size:9.5px;font-weight:700;
                  color:var(--text-muted);text-transform:uppercase;border-bottom:1px solid var(--border)">${h}</th>`
              ).join('')}
            </tr>
          </thead>
          <tbody>
            ${servicosPeriodo.length === 0
              ? `<tr><td colspan="5" style="padding:20px;text-align:center;color:var(--text-muted);font-size:11px">
                  Nenhum serviço medido neste boletim.</td></tr>`
              : servicosPeriodo.map(it => `
                <tr style="border-bottom:1px solid var(--border)">
                  <td style="padding:6px 12px;color:var(--text-primary);max-width:280px;
                    overflow:hidden;text-overflow:ellipsis;white-space:nowrap" title="${it.desc||''}">${it.desc||''}</td>
                  <td style="padding:6px 12px;text-align:center;color:var(--text-muted)">${it.und||''}</td>
                  <td style="padding:6px 12px;text-align:right;font-family:var(--font-mono)">${it.qtdPer}</td>
                  <td style="padding:6px 12px;text-align:right;font-family:var(--font-mono);white-space:nowrap;font-size:10px">${R$(it.upBdi)}</td>
                  <td style="padding:6px 12px;text-align:right;font-family:var(--font-mono);font-weight:600;white-space:nowrap;font-size:10px">${R$(it.total)}</td>
                </tr>`).join('')}
          </tbody>
        </table>
        <div style="background:#1e293b;color:#fff;padding:8px 16px;display:flex;align-items:center;
          justify-content:flex-end;gap:20px;font-size:12px;font-weight:700">
          <span>TOTAL DO PERÍODO</span>
          <span style="font-family:var(--font-mono);font-size:14px">${R$(totalPeriodo)}</span>
        </div>
      </div>

      <!-- ── CHECKLIST DE FISCALIZAÇÃO ──────────────────────── -->
      <div style="border:1px solid var(--border);border-radius:8px;margin-bottom:14px;overflow:hidden">
        <div style="background:var(--bg-surface);padding:8px 14px;font-size:10px;font-weight:700;
          color:var(--text-muted);text-transform:uppercase;letter-spacing:.5px;border-bottom:1px solid var(--border)">
          | CHECKLIST DE FISCALIZAÇÃO</div>
        <div style="padding:14px;display:grid;grid-template-columns:1fr 1fr;gap:8px">
          ${CHECKLIST_ITEMS.map(item => `
            <label style="display:flex;align-items:center;gap:8px;cursor:pointer;font-size:11.5px;
              color:var(--text-primary)">
              <input type="checkbox" id="chk-${item.id}"
                ${this._checklist[item.id] ? 'checked' : ''}
                onchange="window._rel_checklist('${item.id}', this.checked)"
                style="width:14px;height:14px;cursor:pointer;accent-color:var(--accent)">
              ${item.label}
            </label>`).join('')}
        </div>
      </div>

      <!-- ── OCORRÊNCIAS E PENDÊNCIAS ───────────────────────── -->
      <div style="border:1px solid var(--border);border-radius:8px;margin-bottom:14px;overflow:hidden">
        <div style="background:var(--bg-surface);padding:8px 14px;font-size:10px;font-weight:700;
          color:var(--text-muted);text-transform:uppercase;letter-spacing:.5px;border-bottom:1px solid var(--border)">
          | OCORRÊNCIAS E PENDÊNCIAS</div>
        <div id="rel-ocorrs-lista" style="padding:12px 14px;min-height:40px">
          ${ocorrsFiltradas.length === 0
            ? `<div style="color:var(--text-muted);font-size:11px">Nenhuma ocorrência.</div>`
            : ocorrsFiltradas.map(o => `
              <div style="padding:8px 12px;background:var(--bg-surface);border:1px solid var(--border);
                border-radius:6px;margin-bottom:6px;font-size:11.5px">
                <div style="font-weight:600;color:var(--text-primary);margin-bottom:2px">
                  ${o.titulo||o.ocorrencia||''}</div>
                <div style="color:var(--text-muted)">${o.data||''} ${o.descricao||o.descr||''}</div>
              </div>`).join('')}
        </div>
        <div style="padding:0 14px 12px">
          <button data-action="_rel_adicionarOcorrencia"
            style="padding:6px 14px;background:transparent;border:1px solid var(--border);border-radius:6px;
            color:var(--text-muted);font-size:12px;cursor:pointer">+ Adicionar Ocorrência</button>
        </div>
      </div>

      <!-- ── OBSERVAÇÕES DO FISCAL ──────────────────────────── -->
      <div style="border:1px solid var(--border);border-radius:8px;margin-bottom:18px;overflow:hidden">
        <div style="background:var(--bg-surface);padding:8px 14px;font-size:10px;font-weight:700;
          color:var(--text-muted);text-transform:uppercase;letter-spacing:.5px;border-bottom:1px solid var(--border)">
          | OBSERVAÇÕES DO FISCAL</div>
        <div style="padding:12px 14px">
          <textarea id="rel-obs" rows="4" placeholder="Descreva as principais observações e conclusões do período..."
            onchange="window._rel_salvarObs(this.value)"
            oninput="window._rel_salvarObs(this.value)"
            style="width:100%;box-sizing:border-box;padding:8px 10px;border:1px solid var(--border);
            border-radius:6px;background:var(--bg-card);color:var(--text-primary);font-size:12px;
            resize:vertical">${this._obs}</textarea>
        </div>
      </div>

      <!-- ── ASSINATURAS ────────────────────────────────────── -->
      <div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:20px;margin-top:50px;padding-top:16px;
        border-top:1px solid var(--border)">
        ${this._assinatura(cfg.fiscal||'', 'Fiscal do Contrato', cfg.creaFiscal||'')}
        ${this._assinatura('', 'RESPONSÁVEL TÉCNICO', 'Execução / Contratada')}
        ${this._assinatura(cfg.contratante||'', cfg.contratante||'PREFEITURA MUNICIPAL', 'Gestora do Contrato')}
      </div>

      <!-- Overlay e modal de ocorrência -->
      <div id="rel-overlay" data-action="_rel_fecharModal"
        style="display:none;position:fixed;inset:0;background:rgba(0,0,0,.5);z-index:1000"></div>
      <div id="rel-modal"
        style="display:none;position:fixed;top:50%;left:50%;transform:translate(-50%,-50%);
        z-index:1001;background:var(--bg-card);border:1px solid var(--border);border-radius:12px;
        padding:22px;width:min(94vw,480px);box-shadow:0 16px 48px rgba(0,0,0,.35)"></div>
    `;
  }

  _kpiCard(label, valor, cor, bg) {
    return `<div style="background:${bg};border:1px solid var(--border);border-radius:8px;padding:16px">
      <div style="font-size:9px;font-weight:700;color:var(--text-muted);text-transform:uppercase;
        letter-spacing:.5px;margin-bottom:8px">${label}</div>
      <div style="font-size:20px;font-weight:800;font-family:var(--font-mono);color:${cor}">${valor}</div>
    </div>`;
  }

  _kpiCardSituacao(status, atrasada) {
    const cfg = { 
      'Em andamento': { bg:'#eff6ff', cor:'#1e40af', icon:'🔵' },
      'Concluída':    { bg:'#f0fdf4', cor:'#047857', icon:'✅' },
      'Paralisada':   { bg:'#fffbeb', cor:'#b45309', icon:'⏸️' },
      'Suspensa':     { bg:'#fef2f2', cor:'#b91c1c', icon:'🚫' },
    }[status] || { bg:'#eff6ff', cor:'#1e40af', icon:'🔵' };
    return `<div style="background:${cfg.bg};border:1px solid var(--border);border-radius:8px;padding:16px">
      <div style="font-size:9px;font-weight:700;color:var(--text-muted);text-transform:uppercase;
        letter-spacing:.5px;margin-bottom:8px">SITUAÇÃO</div>
      <div style="font-size:16px;font-weight:800;color:${cfg.cor}">${cfg.icon} ${atrasada?'ATRASADO':status.toUpperCase()}</div>
    </div>`;
  }

  _sfCard(label, valor, cor, negativo) {
    return `<div style="padding:12px 14px;text-align:center;border-right:1px solid var(--border)">
      <div style="font-size:9px;font-weight:700;color:var(--text-muted);text-transform:uppercase;
        letter-spacing:.4px;margin-bottom:6px">${label}</div>
      <div style="font-size:14px;font-weight:800;font-family:var(--font-mono);color:${cor};white-space:nowrap">
        ${valor}${negativo?` <span style="font-size:14px">↑</span>`:''}
      </div>
    </div>`;
  }

  _assinatura(nome, cargo, detalhe) {
    return `<div style="text-align:center;padding-top:16px">
      <div style="border-top:1px solid #555;padding-top:10px;font-size:11px;font-weight:700;
        color:var(--text-primary)">${nome||'_________________________'}</div>
      <div style="font-size:10px;color:var(--text-muted);margin-top:2px">${cargo}</div>
      ${detalhe?`<div style="font-size:10px;color:var(--text-muted)">${detalhe}</div>`:''}
      <div style="font-size:10px;color:var(--text-muted);margin-top:4px">Data: ___/___/______</div>
    </div>`;
  }

  // ═══════════════════════════════════════════════════════════════
  //  GERAR PDF — abre janela de impressão
  // ═══════════════════════════════════════════════════════════════
  _gerarPDF() {
    const obraId = state.get('obraAtivaId');
    const cfg    = state.get('cfg') || {};
    const bms    = state.get('bms') || [];
    const itens  = state.get('itensContrato') || [];

    const selEl = document.getElementById('sel-rel-bm');
    const bmNum = parseInt(selEl?.value) || bms[bms.length-1]?.num || 1;
    const bm    = bms.find(b => b.num === bmNum) || bms[0];

    const bdi      = parseFloat(cfg.bdi)||0.25;
    const vContr   = parseFloat(cfg.valor)||0;
    const vAcumAnt = getValorAcumuladoAnterior(obraId, bmNum, itens, cfg);
    const vAcumTot = getValorAcumuladoTotal(obraId, bmNum, itens, cfg);
    const vPer     = vAcumTot - vAcumAnt;
    const saldo    = vContr - vAcumTot;
    const pctFis   = vContr > 0 ? Math.min(100, vAcumTot / vContr * 100) : 0;

    const hoje      = new Date(new Date().toDateString());
    const inicioD   = cfg.inicioPrev ? new Date(cfg.inicioPrev+'T12:00:00') : null;
    const terminoD  = cfg.termino    ? new Date(cfg.termino+'T12:00:00')    : null;
    const diasDecor = inicioD  ? Math.max(0, Math.round((hoje-inicioD)/86400000))  : 0;
    const diasRest  = terminoD ? Math.max(0, Math.round((terminoD-hoje)/86400000)) : 0;
    const atrasada  = terminoD && hoje > terminoD && cfg.status !== 'Concluída';
    const mesRef    = bm?.mes || `BM ${String(bmNum).padStart(2,'0')}`;

    const med = getMedicoes(obraId, bmNum);
    const servicos = itens.filter(it => {
      if (it.t) return false;
      const qAnt = bmNum <= 1 ? 0 : (() => {
        const m2 = getMedicoes(obraId, bmNum-1);
        return sumLinhasQtd(it.und, getLinhasItem(m2, it.id), getFxFormula(m2, it.id));
      })();
      return sumLinhasQtd(it.und, getLinhasItem(med, it.id), getFxFormula(med, it.id)) - qAnt > 0;
    }).map(it => {
      const qAnt = bmNum <= 1 ? 0 : (() => {
        const m2 = getMedicoes(obraId, bmNum-1);
        return sumLinhasQtd(it.und, getLinhasItem(m2, it.id), getFxFormula(m2, it.id));
      })();
      const qtdAcum = sumLinhasQtd(it.und, getLinhasItem(med, it.id), getFxFormula(med, it.id));
      const qtdPer  = n2(qtdAcum - qAnt);
      const upBdi   = n2((it.up||0) * (1+bdi));
      return { ...it, qtdPer, upBdi, total: n2(qtdPer * upBdi) };
    });
    const totalPer = servicos.reduce((s,it) => s + it.total, 0);

    const chkRows = CHECKLIST_ITEMS.map(item => {
      const ok = this._checklist[item.id];
      return `<div class="chk-item ${ok?'chk-ok':''}">
        <span class="chk-box">${ok?'☑':'☐'}</span>
        <span>${item.label}</span>
      </div>`;
    }).join('');

    const obs = document.getElementById('rel-obs')?.value || this._obs || '';

    const html = `<!DOCTYPE html><html lang="pt-BR"><head>
<meta charset="UTF-8">
<title>Relatório Mensal — ${cfg.contrato||''}</title>
<style>
  *{box-sizing:border-box;margin:0;padding:0}
  body{font-family:Arial,sans-serif;font-size:9pt;color:#111;padding:8mm}
  h1{font-size:11pt;font-weight:800;text-align:center;margin-bottom:10px;text-transform:uppercase;letter-spacing:.5px}
  .info-table{width:100%;border-collapse:collapse;margin-bottom:10px;border:1px solid #d1d5db}
  .info-table td{padding:5px 10px;font-size:8.5pt;border-bottom:1px solid #e5e7eb}
  .info-table .lbl{color:#6b7280;font-size:8pt;font-weight:600;text-transform:uppercase;white-space:nowrap}
  .kpis{display:grid;grid-template-columns:repeat(4,1fr);gap:8px;margin-bottom:10px}
  .kpi{border:1px solid #d1d5db;border-radius:4px;padding:8px;text-align:center}
  .kpi-lbl{font-size:7.5pt;color:#6b7280;text-transform:uppercase;font-weight:600;margin-bottom:3px}
  .kpi-val{font-size:12pt;font-weight:800;font-family:'Courier New',monospace}
  .sf{display:grid;grid-template-columns:repeat(5,1fr);border:1px solid #d1d5db;border-radius:4px;margin-bottom:10px}
  .sf-item{padding:8px;text-align:center;border-right:1px solid #e5e7eb}
  .sf-lbl{font-size:7pt;color:#6b7280;text-transform:uppercase;font-weight:600;margin-bottom:3px}
  .sf-val{font-size:11pt;font-weight:800;font-family:'Courier New',monospace}
  .section-title{background:#1e293b;color:#fff;padding:5px 10px;font-size:8.5pt;font-weight:700;
    text-transform:uppercase;letter-spacing:.3px;margin-bottom:0}
  table.servicos{width:100%;border-collapse:collapse;font-size:8pt;border:1px solid #d1d5db}
  table.servicos th{background:#f1f5f9;padding:5px 8px;text-align:left;font-weight:700;
    border-bottom:2px solid #d1d5db;text-transform:uppercase;font-size:7.5pt}
  table.servicos td{padding:4px 8px;border-bottom:1px solid #e5e7eb}
  table.servicos td.td-cur{padding:4px 8px;border-bottom:1px solid #e5e7eb;text-align:right;font-family:'Courier New';white-space:nowrap;font-size:7.5pt}
  .total-row{background:#1e293b;color:#fff;padding:6px 10px;display:flex;justify-content:space-between;
    font-weight:700;font-size:9.5pt}
  .chk-grid{display:grid;grid-template-columns:1fr 1fr;gap:6px;padding:10px;border:1px solid #d1d5db;
    border-top:none;font-size:8pt}
  .chk-item{display:flex;align-items:center;gap:6px}
  .chk-box{font-size:11pt}
  .chk-ok{color:#047857}
  .obs-box{border:1px solid #d1d5db;padding:10px;min-height:50px;font-size:8.5pt;
    border-top:none;white-space:pre-wrap}
  .sigs{display:grid;grid-template-columns:1fr 1fr 1fr;gap:24px;margin-top:16px;padding-top:12px;
    border-top:1px solid #d1d5db}
  .sig{text-align:center;font-size:8.5pt}
  .sig-line{border-top:1px solid #555;padding-top:4px;font-weight:700}
  .rel-header{display:flex;align-items:center;gap:14px;border-bottom:3px solid #1e293b;padding-bottom:10px;margin-bottom:10px}
  .rel-logo{max-height:55px;max-width:90px;object-fit:contain}
  @media print{@page{size:A4;margin:8mm}}
</style></head><body>
<div class="rel-header">
  ${(state.get('logoBase64') || cfg.logo) ? `<img src="${state.get('logoBase64') || cfg.logo}" class="rel-logo" alt="Logo">` : ''}
  <div style="flex:1">
    <h1 style="text-align:left;margin-bottom:0">Relatório Mensal de Acompanhamento</h1>
    <div style="font-size:8pt;color:#6b7280">${cfg.contratante || ''} ${cfg.contrato ? '· Contrato ' + cfg.contrato : ''}</div>
  </div>
</div>
<table class="info-table">
  <tr><td class="lbl">Contratante</td><td>${cfg.contratante||'—'}</td>
      <td class="lbl">Início Previsto</td><td>${dataBR(cfg.inicioPrev)}</td></tr>
  <tr><td class="lbl">Contratada</td><td>${cfg.contratada||'—'}</td>
      <td class="lbl">Início Real</td><td>${dataBR(cfg.inicioReal)}</td></tr>
  <tr><td class="lbl">Objeto</td><td colspan="3">${cfg.objeto||'—'}</td></tr>
  <tr><td class="lbl">Contrato Nº</td><td>${cfg.contrato||'—'}</td>
      <td class="lbl">Término Previsto</td><td>${dataBR(cfg.termino)}${atrasada?' ⚠️ ATRASADO':''}</td></tr>
  <tr><td class="lbl">Valor Contratual</td><td style="font-weight:700;white-space:nowrap">${R$(vContr)}</td>
      <td class="lbl">Fiscal</td><td>${cfg.fiscal||'—'}${cfg.creaFiscal?` — ${cfg.creaFiscal}`:''}</td></tr>
  <tr><td class="lbl">Mês Referência</td><td colspan="3">${mesRef}</td></tr>
</table>

<div class="kpis">
  <div class="kpi"><div class="kpi-lbl">Valor Contratual</div><div class="kpi-val">${R$(vContr)}</div></div>
  <div class="kpi"><div class="kpi-lbl">Acumulado Total</div><div class="kpi-val" style="color:#1e40af">${R$(vAcumTot)}</div></div>
  <div class="kpi"><div class="kpi-lbl">Saldo a Executar</div><div class="kpi-val" style="color:${saldo<0?'#dc2626':'#047857'}">${R$(saldo)}</div></div>
  <div class="kpi"><div class="kpi-lbl">Situação</div><div class="kpi-val" style="font-size:10pt;color:${atrasada?'#dc2626':'#047857'}">${atrasada?'⚠️ ATRASADO':(cfg.status||'Em andamento').toUpperCase()}</div></div>
</div>

<div class="sf">
  <div class="sf-item"><div class="sf-lbl">% Físico Acum.</div><div class="sf-val" style="color:#1e40af">${pct(pctFis)} ↑</div></div>
  <div class="sf-item"><div class="sf-lbl">Valor Fin. Acum.</div><div class="sf-val" style="color:#1e40af">${R$(vAcumTot)} ↑</div></div>
  <div class="sf-item"><div class="sf-lbl">Saldo</div><div class="sf-val" style="color:${saldo<0?'#dc2626':'#047857'}">${R$(saldo)}</div></div>
  <div class="sf-item"><div class="sf-lbl">Dias Decorridos</div><div class="sf-val">${diasDecor}</div></div>
  <div class="sf-item"><div class="sf-lbl">Dias Restantes</div><div class="sf-val" style="color:${diasRest<30?'#dc2626':'#111'}">${diasRest}</div></div>
</div>

<div class="section-title">SERVIÇOS EXECUTADOS NO PERÍODO</div>
<table class="servicos">
  <thead><tr>
    <th>DESCRIÇÃO</th><th>UND</th><th style="text-align:right">QUANT.</th>
    <th style="text-align:right">P.UNIT. C/BDI</th><th style="text-align:right">TOTAL (R$)</th>
  </tr></thead>
  <tbody>
    ${servicos.length===0
      ? `<tr><td colspan="5" style="text-align:center;color:#6b7280;padding:12px">Nenhum serviço medido neste boletim.</td></tr>`
      : servicos.map(it=>`<tr>
          <td>${it.desc||''}</td><td style="text-align:center">${it.und||''}</td>
          <td style="text-align:right;font-family:'Courier New'">${it.qtdPer}</td>
          <td style="text-align:right;font-family:'Courier New';white-space:nowrap;font-size:7.5pt">${R$(it.upBdi)}</td>
          <td style="text-align:right;font-family:'Courier New';font-weight:700;white-space:nowrap;font-size:7.5pt">${R$(it.total)}</td>
        </tr>`).join('')}
  </tbody>
</table>
<div class="total-row"><span>TOTAL DO PERÍODO</span><span>${R$(totalPer)}</span></div>

<br>
<div class="section-title">CHECKLIST DE FISCALIZAÇÃO</div>
<div class="chk-grid">${chkRows}</div>

<br>
<div class="section-title">OBSERVAÇÕES DO FISCAL</div>
<div class="obs-box">${obs || 'Sem observações registradas.'}</div>

<div class="sigs">
  <div class="sig"><div class="sig-line">${cfg.fiscal||'_______________________'}</div>
    <div>Fiscal do Contrato</div>${cfg.creaFiscal?`<div>${cfg.creaFiscal}</div>`:''}
    <div>Data: ___/___/______</div></div>
  <div class="sig"><div class="sig-line">_______________________</div>
    <div>RESPONSÁVEL TÉCNICO</div><div>Execução / Contratada</div>
    <div>Data: ___/___/______</div></div>
  <div class="sig"><div class="sig-line">${cfg.contratante||'_______________________'}</div>
    <div>${cfg.contratante||'PREFEITURA MUNICIPAL'}</div><div>Gestora do Contrato</div>
    <div>Data: ___/___/______</div></div>
</div>

<br>
<button data-action="print" style="background:#1e293b;color:#fff;border:none;padding:8px 20px;
  border-radius:4px;cursor:pointer;font-size:10pt">🖨️ Imprimir / Salvar PDF</button>
</body></html>`;

    const w = window.open('','_blank','width=900,height=750');
    w.document.write(html);
    w.document.close();
  }

  // ═══════════════════════════════════════════════════════════════
  //  OCORRÊNCIAS
  // ═══════════════════════════════════════════════════════════════
  _adicionarOcorrencia() {
    const modal = document.getElementById('rel-modal');
    const overlay = document.getElementById('rel-overlay');
    if (!modal || !overlay) return;
    overlay.style.display = 'block';
    modal.innerHTML = `
      <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:16px">
        <div style="font-size:14px;font-weight:700;color:var(--text-primary)">+ Adicionar Ocorrência</div>
        <button data-action="_rel_fecharModal" style="background:none;border:none;font-size:20px;cursor:pointer;color:var(--text-muted)">×</button>
      </div>
      <div style="display:grid;gap:10px">
        <div>
          <label style="display:block;font-size:10px;font-weight:700;color:var(--text-muted);margin-bottom:4px">Data</label>
          <input type="date" id="rel-oc-data" style="width:100%;box-sizing:border-box;padding:7px 10px;border:1px solid var(--border);border-radius:6px;background:var(--bg-card);color:var(--text-primary);font-size:12px">
        </div>
        <div>
          <label style="display:block;font-size:10px;font-weight:700;color:var(--text-muted);margin-bottom:4px">Título / Tipo *</label>
          <input type="text" id="rel-oc-titulo" placeholder="Ex: Notificação, Pendência técnica..." style="width:100%;box-sizing:border-box;padding:7px 10px;border:1px solid var(--border);border-radius:6px;background:var(--bg-card);color:var(--text-primary);font-size:12px">
        </div>
        <div>
          <label style="display:block;font-size:10px;font-weight:700;color:var(--text-muted);margin-bottom:4px">Descrição</label>
          <textarea id="rel-oc-desc" rows="3" style="width:100%;box-sizing:border-box;padding:7px 10px;border:1px solid var(--border);border-radius:6px;background:var(--bg-card);color:var(--text-primary);font-size:12px;resize:vertical"></textarea>
        </div>
      </div>
      <div style="display:flex;gap:8px;justify-content:flex-end;margin-top:14px">
        <button data-action="_rel_fecharModal" style="padding:8px 16px;background:transparent;border:1px solid var(--border);border-radius:7px;color:var(--text-muted);font-size:12px;cursor:pointer">Cancelar</button>
        <button data-action="_rel_confirmarOcorrencia" style="padding:8px 18px;background:var(--accent);border:none;border-radius:7px;color:#fff;font-size:12px;font-weight:700;cursor:pointer">Salvar</button>
      </div>`;
    modal.style.display = 'block';
  }

  async _confirmarOcorrencia() {
    const titulo = document.getElementById('rel-oc-titulo')?.value?.trim();
    const desc   = document.getElementById('rel-oc-desc')?.value?.trim();
    const data   = document.getElementById('rel-oc-data')?.value;
    if (!titulo) { window.toast?.('⚠️ O título é obrigatório.','warn'); return; }
    const oc = { id:`oc_${Date.now().toString(36)}`, titulo, descricao: desc, data, criadoEm: new Date().toISOString() };
    this._ocorrencias.push(oc);
    const obraId = state.get('obraAtivaId');
    try { await FirebaseService.salvarOcorrencias(obraId, this._ocorrencias); } catch(e) {}
    this._fecharModal();
    this._render();
    window.toast?.('✅ Ocorrência registrada!','ok');
  }

  _fecharModal() {
    const modal   = document.getElementById('rel-modal');
    const overlay = document.getElementById('rel-overlay');
    if (modal)   modal.style.display = 'none';
    if (overlay) overlay.style.display = 'none';
  }

  async _salvarChecklist(id, val) {
    this._checklist[id] = val;
    await this._persistirBmData();
  }

  async _salvarObs(val) {
    this._obs = val;
    await this._persistirBmData();
  }

  async _persistirBmData() {
    const obraId = state.get('obraAtivaId');
    const bms    = state.get('bms') || [];
    const selEl  = document.getElementById('sel-rel-bm');
    const bmNum  = parseInt(selEl?.value) || bms[bms.length-1]?.num || 1;
    const bmsNew = bms.map(b => b.num === bmNum
      ? { ...b, relChecklist: this._checklist, relObs: this._obs }
      : b);
    state.set('bms', bmsNew);
    try { await FirebaseService.setBMs(obraId, bmsNew); } catch(e) {}
  }

  // ═══════════════════════════════════════════════════════════════
  //  EVENTOS E GLOBALS
  // ═══════════════════════════════════════════════════════════════
  _bindEvents() {
    this._subs.push(
      EventBus.on('obra:selecionada', async () => {
        try { await this._carregarDados(); if (router.current==='relatorio') this._render(); } catch(e) {}
      }, 'relatorio'),
      EventBus.on('boletim:atualizado', () => {
        try { if (router.current==='relatorio') this._render(); } catch(e) {}
      }, 'relatorio'),
    );
  }

  _exposeGlobals() {
    window.renderRelatorio        = () => { try { this.onEnter(); } catch(e){} };
    window.imprimirRelatorio      = () => { try { this._gerarPDF(); } catch(e){} };
    window.exportarCSVRelatorio   = () => { try { this._exportarCSV(); } catch(e){ console.error('[Relatorio] CSV:', e); } };
    window.limparFiltroRelatorio  = () => {
      try {
        const di = document.getElementById('rel-data-ini');
        const df = document.getElementById('rel-data-fim');
        if (di) di.value = '';
        if (df) df.value = '';
        this._render();
      } catch(e) {}
    };
    window._rel_checklist          = (id, v) => { try { this._salvarChecklist(id, v); } catch(e){} };
    window._rel_salvarObs          = v       => { try { this._salvarObs(v); } catch(e){} };
    window._rel_adicionarOcorrencia= ()      => { try { this._adicionarOcorrencia(); } catch(e){} };
    window._rel_confirmarOcorrencia= ()      => { try { this._confirmarOcorrencia(); } catch(e){} };
    window._rel_fecharModal        = ()      => { try { this._fecharModal(); } catch(e){} };
  }

  _exportarCSV() {
    const obraId = state.get('obraAtivaId');
    const cfg    = state.get('cfg') || {};
    const bms    = state.get('bms') || [];
    const itens  = state.get('itensContrato') || [];
    const selEl  = document.getElementById('sel-rel-bm');
    const bmNum  = parseInt(selEl?.value) || bms[bms.length-1]?.num || 1;
    const bm     = bms.find(b => b.num === bmNum) || bms[0];
    if (!bm) { window.toast?.('⚠️ Nenhum BM selecionado.', 'warn'); return; }

    const bdi      = parseFloat(cfg.bdi) || 0;
    const vContr   = parseFloat(cfg.valor) || 0;
    const vAcumAnt = getValorAcumuladoAnterior(obraId, bmNum, itens, cfg);
    const vAcumTot = getValorAcumuladoTotal(obraId, bmNum, itens, cfg);
    const vPeriodo = vAcumTot - vAcumAnt;
    const saldo    = vContr - vAcumTot;
    const pctFis   = vContr > 0 ? (vAcumTot / vContr * 100) : 0;

    // ── Replicar a lógica de "servicos" do _render ───────────────
    // (apenas itens com medição no período, igual à tabela exibida)
    const med = getMedicoes(obraId, bmNum);
    const fmtNum = v => {
      const modoCalc = cfg.modoCalculo || 'truncar';
      return modoCalc === 'truncar'
        ? Math.trunc(Math.round(parseFloat(v || 0) * 100 * 100) / 100) / 100
        : Math.round(parseFloat(v || 0) * 100) / 100;
    };

    // Constrói lista completa de itens (todos, não só os executados no período)
    // para espelhar exatamente a tabela do sistema
    const linhasServicos = [];
    let totalPeriodo = 0;

    itens.forEach(it => {
      if (it.t) {
        const tipo = it.t === 'G' ? 'GRUPO' : it.t === 'SG' ? 'SUBGRUPO' : 'MACRO';
        linhasServicos.push([it.id, it.desc || '', tipo, '', '', '', '', '', '', '', '']);
        return;
      }

      const up    = parseFloat(it.up) || 0;
      const upBdi = fmtNum(up * (1 + bdi));
      const totCont = fmtNum((it.qtd || 0) * upBdi);

      // Qtd do período (igual ao qtdPer do _render)
      const qtdAnt  = getQtdAcumuladoAnteriorItem(obraId, bmNum, it.id, itens);
      const qtdAcum = getQtdAcumuladoTotalItem(obraId, bmNum, it.id, itens);
      const qtdPer  = fmtNum(qtdAcum - qtdAnt);
      const vPer    = fmtNum(qtdPer * upBdi);
      const vAcumItem = fmtNum(qtdAcum * upBdi);
      const pctExec = it.qtd > 0 ? (qtdAcum / it.qtd * 100) : 0;
      const saldoItem = fmtNum(totCont - vAcumItem);

      totalPeriodo += vPer;

      linhasServicos.push([
        it.id,
        it.desc  || '',
        it.und   || '',
        numCSV(it.qtd || 0),
        numCSV(up),
        numCSV(upBdi),
        numCSV(totCont),
        numCSV(qtdPer),
        numCSV(vPer),
        numCSV(pctExec) + '%',
        numCSV(vAcumItem),
        numCSV(saldoItem),
      ]);
    });

    const dados = [
      // ── Cabeçalho do relatório ──────────────────────────────────
      ['RELATÓRIO MENSAL DE ACOMPANHAMENTO'],
      ['Obra',         cfg.objeto    || cfg.contrato || ''],
      ['Boletim',      bm.label      || `BM ${bmNum}`],
      ['Período',      bm.mes        || ''],
      ['Contratante',  cfg.contratante|| ''],
      ['Contratada',   cfg.contratada || ''],
      ['Fiscal',       cfg.fiscal    || ''],
      [],
      // ── Resumo financeiro ───────────────────────────────────────
      ['RESUMO FINANCEIRO'],
      ['Valor Contratual (R$)',       numCSV(vContr)],
      ['Valor Acumulado Anterior (R$)', numCSV(vAcumAnt)],
      ['Valor do Período (R$)',       numCSV(vPeriodo)],
      ['Valor Acumulado Total (R$)',  numCSV(vAcumTot)],
      ['Saldo a Executar (R$)',       numCSV(saldo)],
      ['% Executado',                 numCSV(pctFis) + '%'],
      [],
      // ── Tabela de serviços (espelha a tabela principal exibida) ─
      ['SERVIÇOS EXECUTADOS NO PERÍODO'],
      [
        'ID', 'Descrição', 'Und',
        'Qtd Contratada', 'V.Unit. (R$)', 'V.Unit+BDI (R$)', 'Total Contratado (R$)',
        'Qtd Período', 'V.Período (R$)',
        '% Executado', 'V.Acumulado (R$)', 'Saldo (R$)',
      ],
      ...linhasServicos,
      [],
      ['TOTAL DO PERÍODO', '', '', '', '', '', '', '', numCSV(totalPeriodo), '', '', ''],
      [],
      // ── Checklist ───────────────────────────────────────────────
      ['CHECKLIST DE FISCALIZAÇÃO'],
      ['Item', 'Situação'],
      ...CHECKLIST_ITEMS.map(ci => [ci.label, (this._checklist[ci.id] ? 'Conforme' : 'Não Verificado')]),
      [],
      // ── Ocorrências ─────────────────────────────────────────────
      ['OCORRÊNCIAS'],
      ['Data', 'Tipo', 'Descrição', 'Providência'],
      ...this._ocorrencias.map(o => [o.data || '', o.tipo || '', o.descricao || '', o.providencia || '']),
    ];

    baixarCSV(dados, `relatorio_mensal_BM${String(bmNum).padStart(2,'0')}_${new Date().toISOString().slice(0,10)}`);
    window.auditRegistrar?.({ modulo: 'Relatório', tipo: 'exportação', registro: bm.label || `BM ${bmNum}`, detalhe: 'Exportação CSV do Relatório Mensal' });
    window.toast?.('✅ CSV do Relatório exportado!', 'ok');
  }

  destroy() { this._subs.forEach(u => u()); this._subs = []; }
}
