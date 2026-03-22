/**
 * ╔══════════════════════════════════════════════════════════════╗
 * ║  FISCAL NA OBRA — modules/integracao-lei14133/              ║
 * ║  integracao-lei14133-controller.js                           ║
 * ║                                                              ║
 * ║  MÓDULO DE INTEGRAÇÃO — Lei 14.133/2021                      ║
 * ║  Vincula: Ocorrência → Notificação → Sanção                  ║
 * ║  Geração de PDF para Notificações, Sanções e Recebimentos    ║
 * ║  Validações de negócio                                       ║
 * ║  Auditoria com valor ANTES/DEPOIS                            ║
 * ║                                                              ║
 * ║  REGRA: NÃO modifica controllers existentes.                 ║
 * ║  Injeta comportamento via globals e EventBus.                ║
 * ╚══════════════════════════════════════════════════════════════╝
 */

import EventBus       from '../../core/EventBus.js';
import state          from '../../core/state.js';
import router         from '../../core/router.js';
import FirebaseService from '../../firebase/firebase-service.js';

const esc    = s => String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const dataBR = iso => iso ? new Date(iso + 'T12:00:00').toLocaleDateString('pt-BR') : '—';
const hoje   = () => new Date().toISOString().slice(0, 10);
const agora  = () => new Date().toISOString();

export class IntegracaoLei14133Module {
  constructor() {
    this._subs = [];
  }

  async init() {
    try {
      this._exposeGlobals();
      this._bindEvents();
      console.log('[IntegracaoLei14133] Módulo de integração inicializado.');
    } catch (e) {
      console.error('[IntegracaoLei14133] init:', e);
    }
  }

  onEnter() {}
  destroy() {
    this._subs.forEach(u => u?.());
    this._subs = [];
    EventBus.offByContext('integracao-lei14133');
  }

  // ════════════════════════════════════════════════════════════════
  //  PARTE 1 — INTEGRAÇÃO: Ocorrência → Notificação → Sanção
  // ════════════════════════════════════════════════════════════════

  /**
   * Abre pré-preenchido o formulário de notificação vinculado a uma ocorrência.
   * Navega para o módulo de notificações com dados da ocorrência.
   */
  _gerarNotificacaoDeOcorrencia(ocorrenciaId) {
    const obraId = state.get('obraAtivaId');
    if (!obraId) { window.toast?.('⚠️ Selecione uma obra.', 'warn'); return; }

    // Busca ocorrência nos dados globais já carregados
    FirebaseService.getOcorrencias(obraId).then(todas => {
      const oc = (todas || []).find(o => o.id === ocorrenciaId);
      if (!oc) { window.toast?.('⚠️ Ocorrência não encontrada.', 'warn'); return; }

      // Salva contexto de pré-preenchimento no state para ser lido pelo módulo de notificações
      state.set('_notif_prefill', {
        ocorrenciaId:  oc.id,
        ocorrenciaNum: oc.numero || oc.id,
        descricao:     oc.descricao || '',
        tipo:          this._mapOcorrenciaTipoNotif(oc.tipo),
        data:          hoje(),
        _origem:       'ocorrencia',
      });

      // Navega e abre o form
      router.navigate('notificacoes');
      setTimeout(() => {
        window._notif_novaForm?.();
        this._aplicarPrefillNotificacao();
      }, 350);

      window.auditRegistrar?.({
        modulo: 'Integração',
        tipo:   'navegacao',
        registro: `OC → Notif: ${oc.numero || ocorrenciaId}`,
        detalhe: 'Notificação gerada a partir de ocorrência',
      });
    }).catch(() => window.toast?.('❌ Erro ao buscar ocorrência.', 'error'));
  }

  _mapOcorrenciaTipoNotif(tipoOc) {
    const mapa = {
      tecnica:    'tecnica',
      seguranca:  'advertencia',
      qualidade:  'solicitacao_correcao',
      prazo:      'descumprimento',
      financeira: 'administrativa',
      ambiental:  'administrativa',
      outra:      'administrativa',
    };
    return mapa[tipoOc] || 'administrativa';
  }

  _aplicarPrefillNotificacao() {
    const p = state.get('_notif_prefill');
    if (!p) return;
    // Tenta preencher campos do formulário de notificação se já renderizado
    const setVal = (id, v) => { const el = document.getElementById(id); if (el) el.value = v; };
    setVal('notif-tipo', p.tipo);
    setVal('notif-data', p.data);
    // Campo de referência/ocorrência (se o form de notificação tiver)
    const refEl = document.getElementById('notif-ocorrencia-id');
    if (refEl) refEl.value = p.ocorrenciaId;
    const descEl = document.getElementById('notif-descricao') || document.getElementById('notif-objeto');
    if (descEl && p.descricao) descEl.value = p.descricao;
    state.set('_notif_prefill', null);
  }

  /**
   * Gera uma sanção vinculada a uma notificação.
   */
  _gerarSancaoDeNotificacao(notifId) {
    const obraId = state.get('obraAtivaId');
    if (!obraId) { window.toast?.('⚠️ Selecione uma obra.', 'warn'); return; }

    FirebaseService.getNotificacoes(obraId).then(todas => {
      const notif = (todas || []).find(n => n.id === notifId);
      if (!notif) { window.toast?.('⚠️ Notificação não encontrada.', 'warn'); return; }

      // Pré-preenche contexto de sanção
      state.set('_sanc_prefill', {
        notifId:    notif.id,
        notifNum:   notif.numero || notif.id,
        motivo:     `Decorrente da Notificação ${notif.numero || notifId}: ${notif.descricao || notif.objeto || ''}`,
        referencia: notif.numero || notifId,
        _origem:    'notificacao',
      });

      router.navigate('sancoes');
      setTimeout(() => {
        window._sancNovaForm?.();
        this._aplicarPrefillSancao();
      }, 350);

      window.auditRegistrar?.({
        modulo: 'Integração',
        tipo:   'navegacao',
        registro: `Notif → Sanção: ${notif.numero || notifId}`,
        detalhe: 'Sanção gerada a partir de notificação',
      });
    }).catch(() => window.toast?.('❌ Erro ao buscar notificação.', 'error'));
  }

  _aplicarPrefillSancao() {
    const p = state.get('_sanc_prefill');
    if (!p) return;
    const setVal = (id, v) => { const el = document.getElementById(id); if (el) el.value = v; };
    const motivoEl = document.getElementById('sanc-motivo');
    if (motivoEl) motivoEl.value = p.motivo;
    const refEl = document.getElementById('sanc-ref');
    if (refEl) refEl.value = p.referencia;
    state.set('_sanc_prefill', null);
  }

  // ════════════════════════════════════════════════════════════════
  //  PARTE 2 — VALIDAÇÕES DE NEGÓCIO
  // ════════════════════════════════════════════════════════════════

  /**
   * Valida se a obra tem Gestor e Fiscal Técnico designados.
   * Retorna array de alertas (vazio = ok).
   */
  async validarResponsaveisObra(obraId) {
    const alertas = [];
    try {
      const lista = await FirebaseService.getResponsaveis(obraId).catch(() => []);
      const temGestor   = lista.some(r => r.papel === 'gestor');
      const temFiscalTec = lista.some(r => r.papel === 'fiscal_tec');
      if (!temGestor)    alertas.push('⚠️ Obra sem Gestor do Contrato (Art. 117 Lei 14.133/2021)');
      if (!temFiscalTec) alertas.push('⚠️ Obra sem Fiscal Técnico (Art. 117 Lei 14.133/2021)');
    } catch (e) {}
    return alertas;
  }

  /**
   * Valida recebimento definitivo: exige pelo menos 1 provisório.
   */
  async validarRecebimentoDefinitivo(obraId) {
    try {
      const lista = await FirebaseService.getRecebimentos(obraId).catch(() => []);
      const temProvisorio = lista.some(r => r.tipo === 'provisorio');
      if (!temProvisorio) return '⚠️ Recebimento Definitivo requer ao menos 1 Provisório antes (Art. 140 Lei 14.133/2021)';
    } catch (e) {}
    return null;
  }

  // ════════════════════════════════════════════════════════════════
  //  PARTE 3 — GERAÇÃO DE PDF
  // ════════════════════════════════════════════════════════════════

  _abrirJanelaPDF(titulo, htmlBody) {
    const w = window.open('', '_blank', 'width=900,height=700');
    const agora = new Date();
    w.document.write(`<!DOCTYPE html>
<html lang="pt-BR"><head>
<meta charset="UTF-8">
<title>${titulo}</title>
<style>
  *{box-sizing:border-box;margin:0;padding:0}
  body{font-family:Arial,Helvetica,sans-serif;font-size:10pt;color:#000;background:#fff;padding:15mm 20mm}
  h1{font-size:14pt;font-weight:900;text-transform:uppercase;letter-spacing:1px;margin-bottom:6px}
  h2{font-size:11pt;font-weight:700;margin:12px 0 6px}
  .header{border-bottom:3px solid #000;padding-bottom:10px;margin-bottom:16px;display:flex;justify-content:space-between;align-items:flex-end}
  .header-left h1{font-size:13pt}
  .header-right{text-align:right;font-size:9pt;color:#555}
  .campo{margin-bottom:8px;font-size:10pt}
  .campo strong{display:inline-block;min-width:160px;font-weight:700}
  .campo .valor{color:#000}
  .bloco{border:1px solid #ccc;border-radius:4px;padding:12px;margin-bottom:12px}
  .bloco-titulo{font-size:9pt;font-weight:700;text-transform:uppercase;letter-spacing:.5px;color:#555;margin-bottom:8px;border-bottom:1px solid #eee;padding-bottom:4px}
  .destaque{background:#f5f5f5;border-left:4px solid #000;padding:10px 12px;margin:10px 0;font-size:10pt}
  .assinaturas{display:grid;grid-template-columns:1fr 1fr;gap:40px;margin-top:40mm}
  .assinatura{border-top:1px solid #000;padding-top:6px;text-align:center}
  .rodape{text-align:center;font-size:8pt;color:#888;margin-top:12px;border-top:1px solid #eee;padding-top:6px}
  @page{size:A4;margin:15mm 20mm}
  @media print{*{-webkit-print-color-adjust:exact!important;print-color-adjust:exact!important}body{padding:0}thead{display:table-header-group}}
</style>
</head><body>
${htmlBody}
<div class="rodape">
  Emitido em ${agora.toLocaleDateString('pt-BR')} às ${agora.toLocaleTimeString('pt-BR',{hour:'2-digit',minute:'2-digit'})} — Fiscal na Obra · beta teste
</div>
<script>window.onload=function(){window.print();window.onafterprint=function(){window.close();};};<\/script>
</body></html>`);
    w.document.close();
  }

  async _gerarPDFNotificacao(notifId) {
    const obraId = state.get('obraAtivaId');
    const cfg = state.get('cfg') || {};
    if (!obraId) { window.toast?.('⚠️ Selecione uma obra.', 'warn'); return; }

    try {
      const todas = await FirebaseService.getNotificacoes(obraId).catch(() => []);
      const n = (todas || []).find(x => x.id === notifId);
      if (!n) { window.toast?.('⚠️ Notificação não encontrada.', 'warn'); return; }

      const TIPOS_NOTIF = {
        advertencia: 'Advertência', solicitacao_correcao: 'Solicitação de Correção',
        solicitacao_info: 'Solicitação de Informação', irregularidade: 'Irregularidade na Execução',
        descumprimento: 'Descumprimento Contratual', tecnica: 'Notificação Técnica',
        administrativa: 'Notificação Administrativa',
      };

      const html = `
        <div class="header">
          <div class="header-left">
            <div style="font-size:9pt;color:#555;text-transform:uppercase;letter-spacing:.5px">Notificação Formal — Lei 14.133/2021</div>
            <h1>${TIPOS_NOTIF[n.tipo] || n.tipo || 'Notificação'}</h1>
            <div style="font-size:10pt;font-weight:600">${esc(n.numero || notifId)}</div>
          </div>
          <div class="header-right">
            <div><strong>Data:</strong> ${dataBR(n.data || n.criadoEm?.slice(0, 10))}</div>
            <div><strong>Obra:</strong> ${esc(cfg.objeto || '—')}</div>
            <div><strong>Contrato:</strong> ${esc(cfg.contrato || '—')}</div>
          </div>
        </div>

        <div class="bloco">
          <div class="bloco-titulo">Dados do Contrato</div>
          <div class="campo"><strong>Contratante:</strong> <span class="valor">${esc(cfg.contratante || '—')}</span></div>
          <div class="campo"><strong>Contratada:</strong> <span class="valor">${esc(cfg.contratada || '—')}</span></div>
          ${cfg.cnpj ? `<div class="campo"><strong>CNPJ:</strong> <span class="valor">${esc(cfg.cnpj)}</span></div>` : ''}
          <div class="campo"><strong>Fiscal Responsável:</strong> <span class="valor">${esc(cfg.fiscal || n.emitidoPor || '—')}</span></div>
        </div>

        <div class="bloco">
          <div class="bloco-titulo">Notificação</div>
          ${n.prazo ? `<div class="campo"><strong>Prazo para Resposta:</strong> <span class="valor">${dataBR(n.prazo)}</span></div>` : ''}
          ${n.ocorrenciaRef ? `<div class="campo"><strong>Ref. Ocorrência:</strong> <span class="valor">${esc(n.ocorrenciaRef)}</span></div>` : ''}
          <div class="destaque">${esc(n.descricao || n.objeto || 'Sem descrição')}</div>
          ${n.fundamentoLegal ? `<div class="campo" style="margin-top:8px"><strong>Fundamento Legal:</strong> <span class="valor">${esc(n.fundamentoLegal)}</span></div>` : ''}
        </div>

        <div class="assinaturas">
          <div class="assinatura">
            <div style="font-weight:700">${esc(cfg.fiscal || '______________________')}</div>
            <div style="font-size:9pt;color:#555">${esc(cfg.creaFiscal || '')}</div>
            <div style="font-weight:600;margin-top:2px">Fiscal do Contrato</div>
            <div style="font-size:9pt;color:#555;margin-top:2px">Data: ___/___/______</div>
          </div>
          <div class="assinatura">
            <div style="font-weight:700">${esc(cfg.contratada || '______________________')}</div>
            <div style="font-size:9pt;color:#555">Representante da Contratada</div>
            <div style="font-weight:600;margin-top:2px">Empresa Executora</div>
            <div style="font-size:9pt;color:#555;margin-top:2px">Data: ___/___/______</div>
          </div>
        </div>`;

      this._abrirJanelaPDF(`Notificação ${n.numero || notifId}`, html);
      window.auditRegistrar?.({ modulo: 'Integração', tipo: 'pdf-notificacao', registro: n.numero || notifId, detalhe: 'PDF gerado' });
    } catch (e) {
      console.error('[Integração] _gerarPDFNotificacao:', e);
      window.toast?.('❌ Erro ao gerar PDF.', 'error');
    }
  }

  async _gerarPDFSancao(sancaoId) {
    const obraId = state.get('obraAtivaId');
    const cfg = state.get('cfg') || {};
    if (!obraId) { window.toast?.('⚠️ Selecione uma obra.', 'warn'); return; }

    try {
      const todas = await FirebaseService.getSancoes(obraId).catch(() => []);
      const s = (todas || []).find(x => x.id === sancaoId);
      if (!s) { window.toast?.('⚠️ Sanção não encontrada.', 'warn'); return; }

      const TIPOS = {
        advertencia: 'Advertência', multa_mora: 'Multa de Mora', multa_inadimpl: 'Multa por Inadimplemento',
        suspenso: 'Suspensão Temporária', impedimento: 'Impedimento de Licitar',
        declaracao_inapta: 'Declaração de Inidoneidade',
      };
      const R$ = v => (parseFloat(v) || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });

      const html = `
        <div class="header">
          <div class="header-left">
            <div style="font-size:9pt;color:#555;text-transform:uppercase;letter-spacing:.5px">Registro de Sanção Administrativa — Art. 156 Lei 14.133/2021</div>
            <h1>${TIPOS[s.tipo] || s.tipo || 'Sanção'}</h1>
          </div>
          <div class="header-right">
            <div><strong>Data:</strong> ${dataBR(s.data)}</div>
            <div><strong>Obra:</strong> ${esc(cfg.objeto || '—')}</div>
            <div><strong>Contrato:</strong> ${esc(cfg.contrato || '—')}</div>
          </div>
        </div>

        <div class="bloco">
          <div class="bloco-titulo">Dados do Contrato</div>
          <div class="campo"><strong>Contratante:</strong> <span class="valor">${esc(cfg.contratante || '—')}</span></div>
          <div class="campo"><strong>Contratada:</strong> <span class="valor">${esc(cfg.contratada || '—')} — CNPJ: ${esc(cfg.cnpj || '—')}</span></div>
        </div>

        <div class="bloco">
          <div class="bloco-titulo">Fundamentação</div>
          <div class="campo"><strong>Tipo de Sanção:</strong> <span class="valor">${TIPOS[s.tipo] || s.tipo}</span></div>
          <div class="campo"><strong>Status:</strong> <span class="valor">${s.status || '—'}</span></div>
          ${s.valor ? `<div class="campo"><strong>Valor:</strong> <span class="valor" style="font-weight:700;color:#dc2626">${R$(s.valor)}</span></div>` : ''}
          ${s.processo ? `<div class="campo"><strong>Processo Administrativo:</strong> <span class="valor">${esc(s.processo)}</span></div>` : ''}
          ${s.referencia ? `<div class="campo"><strong>Referência:</strong> <span class="valor">${esc(s.referencia)}</span></div>` : ''}
          <div style="margin-top:10px"><strong>Motivo / Fundamento Legal:</strong></div>
          <div class="destaque">${esc(s.motivo)}</div>
        </div>

        <div style="background:#fef3c7;border:1px solid #f59e0b;border-radius:4px;padding:10px;font-size:9pt;color:#92400e;margin-top:8px">
          ⚠️ <strong>Este documento é apenas um registro documental.</strong> A aplicação formal da sanção depende de processo administrativo regular com garantia de ampla defesa e contraditório.
        </div>

        <div class="assinaturas">
          <div class="assinatura">
            <div style="font-weight:700">${esc(cfg.fiscal || '______________________')}</div>
            <div style="font-size:9pt;color:#555">Fiscal / Gestor do Contrato</div>
            <div style="font-size:9pt;color:#555;margin-top:2px">Data: ___/___/______</div>
          </div>
          <div class="assinatura">
            <div style="font-weight:700">${esc(cfg.contratante || '______________________')}</div>
            <div style="font-size:9pt;color:#555">Autoridade Competente</div>
            <div style="font-size:9pt;color:#555;margin-top:2px">Data: ___/___/______</div>
          </div>
        </div>`;

      this._abrirJanelaPDF(`Sanção Administrativa`, html);
      window.auditRegistrar?.({ modulo: 'Integração', tipo: 'pdf-sancao', registro: sancaoId, detalhe: 'PDF gerado' });
    } catch (e) {
      console.error('[Integração] _gerarPDFSancao:', e);
      window.toast?.('❌ Erro ao gerar PDF.', 'error');
    }
  }

  async _gerarPDFRecebimento(recebId) {
    const obraId = state.get('obraAtivaId');
    const cfg = state.get('cfg') || {};
    if (!obraId) { window.toast?.('⚠️ Selecione uma obra.', 'warn'); return; }

    try {
      const todos = await FirebaseService.getRecebimentos(obraId).catch(() => []);
      const r = (todos || []).find(x => x.id === recebId);
      if (!r) { window.toast?.('⚠️ Recebimento não encontrado.', 'warn'); return; }

      const isDefin = r.tipo === 'definitivo';
      const CHECKLIST = [
        { key:'documentos_ok', label:'Documentação completa entregue' },
        { key:'as_built_ok', label:'As-built / projetos atualizados' },
        { key:'medicao_ok', label:'Medições finais conferidas' },
        { key:'qualidade_ok', label:'Qualidade dos serviços verificada' },
        { key:'seguranca_ok', label:'Condições de segurança atendidas' },
        { key:'limpeza_ok', label:'Limpeza e desmobilização do canteiro' },
        { key:'garantias_ok', label:'Termos de garantia entregues' },
        { key:'manutencao_ok', label:'Manual de operação/manutenção entregue' },
        { key:'pendencias_ok', label:'Pendências anteriores sanadas' },
      ];

      const html = `
        <div class="header">
          <div class="header-left">
            <div style="font-size:9pt;color:#555;text-transform:uppercase;letter-spacing:.5px">Termo de Recebimento ${isDefin ? 'Definitivo' : 'Provisório'} — Art. 140 Lei 14.133/2021</div>
            <h1>Recebimento ${isDefin ? 'Definitivo' : 'Provisório'} do Objeto Contratual</h1>
            ${r.termo ? `<div style="font-size:10pt;font-weight:600">${esc(r.termo)}</div>` : ''}
          </div>
          <div class="header-right">
            <div><strong>Data:</strong> ${dataBR(r.data)}</div>
            <div><strong>Obra:</strong> ${esc(cfg.objeto || '—')}</div>
          </div>
        </div>

        <div class="bloco">
          <div class="bloco-titulo">Identificação</div>
          <div class="campo"><strong>Contratante:</strong> <span class="valor">${esc(cfg.contratante || '—')}</span></div>
          <div class="campo"><strong>Contratada:</strong> <span class="valor">${esc(cfg.contratada || '—')}</span></div>
          <div class="campo"><strong>Contrato:</strong> <span class="valor">${esc(cfg.contrato || '—')}</span></div>
          <div class="campo"><strong>Responsável pelo Recebimento:</strong> <span class="valor">${esc(r.responsavel)}</span></div>
        </div>

        <div class="bloco">
          <div class="bloco-titulo">Checklist de Conformidade</div>
          ${CHECKLIST.map(c => `
            <div style="display:flex;align-items:center;gap:8px;margin-bottom:6px;font-size:10pt">
              <span style="font-size:12pt;color:${r.checklist?.[c.key] ? '#22c55e' : '#ef4444'}">
                ${r.checklist?.[c.key] ? '✅' : '❌'}
              </span>
              ${c.label}
            </div>`).join('')}
        </div>

        ${r.obs ? `<div class="bloco"><div class="bloco-titulo">Observações</div><div>${esc(r.obs)}</div></div>` : ''}

        <div style="background:#dbeafe;border:1px solid #3b82f6;border-radius:4px;padding:10px;font-size:9pt;color:#1e40af;margin-top:8px">
          ${isDefin
            ? '🏛️ <strong>Recebimento Definitivo</strong> — Encerra as obrigações da contratada no período de garantia, salvo vícios ocultos. Os serviços foram verificados e aprovados.'
            : '📋 <strong>Recebimento Provisório</strong> — Os serviços foram inspecionados. Prazo de observação em curso até o recebimento definitivo.'}
        </div>

        <div class="assinaturas">
          <div class="assinatura">
            <div style="font-weight:700">${esc(r.responsavel || '______________________')}</div>
            <div style="font-size:9pt;color:#555">${isDefin ? 'Comissão de Recebimento' : 'Fiscal Técnico'}</div>
            <div style="font-size:9pt;color:#555;margin-top:2px">Data: ___/___/______</div>
          </div>
          <div class="assinatura">
            <div style="font-weight:700">${esc(cfg.contratada || '______________________')}</div>
            <div style="font-size:9pt;color:#555">Representante da Contratada</div>
            <div style="font-size:9pt;color:#555;margin-top:2px">Data: ___/___/______</div>
          </div>
        </div>`;

      this._abrirJanelaPDF(`Termo de Recebimento ${isDefin ? 'Definitivo' : 'Provisório'}`, html);
      window.auditRegistrar?.({ modulo: 'Integração', tipo: 'pdf-recebimento', registro: recebId, detalhe: 'PDF gerado' });
    } catch (e) {
      console.error('[Integração] _gerarPDFRecebimento:', e);
      window.toast?.('❌ Erro ao gerar PDF.', 'error');
    }
  }

  // ════════════════════════════════════════════════════════════════
  //  PARTE 4 — AUDITORIA APRIMORADA (valor ANTES/DEPOIS)
  // ════════════════════════════════════════════════════════════════

  /**
   * Registra auditoria com valor ANTES e DEPOIS.
   * Complementa o auditRegistrar existente sem substituí-lo.
   */
  registrarAuditoriaDiff({ modulo, tipo, registro, antes, depois, detalhe = '' }) {
    try {
      const cfg    = state.get('cfg') || {};
      const obraId = state.get('obraAtivaId') || '—';
      const usuario = cfg.fiscal || 'Usuário';
      const entrada = {
        id:        `aud_diff_${Date.now()}_${Math.random().toString(36).slice(2, 5)}`,
        usuario,
        iso:       agora(),
        data:      new Date().toLocaleDateString('pt-BR'),
        hora:      new Date().toLocaleTimeString('pt-BR'),
        modulo,
        tipo,
        registro,
        detalhe,
        obraId,
        obra:      cfg.objeto || obraId,
        _antes:    antes   != null ? JSON.stringify(antes)   : null,
        _depois:   depois  != null ? JSON.stringify(depois)  : null,
      };
      // Usa o auditRegistrar existente para persistência Firebase
      window.auditRegistrar?.({ modulo, tipo, registro, detalhe });
      // Também registra localmente com diff se precisar
      const logLocal = state.get('_audit_diff_log') || [];
      logLocal.push(entrada);
      if (logLocal.length > 200) logLocal.shift();
      state.set('_audit_diff_log', logLocal);
    } catch (e) {
      console.warn('[Integração] registrarAuditoriaDiff:', e);
    }
  }

  // ════════════════════════════════════════════════════════════════
  //  PARTE 5 — INJEÇÃO DE BOTÕES NOS MÓDULOS EXISTENTES
  // ════════════════════════════════════════════════════════════════
  // Observa navegação: quando o usuário entra em ocorrências,
  // notificações ou recebimento, injeta botões de integração.

  _bindEvents() {
    this._subs.push(
      EventBus.on('ui:pagina', ({ pageId }) => {
        if (pageId === 'ocorrencias') {
          setTimeout(() => this._injetarBotoesOcorrencias(), 400);
        }
        if (pageId === 'notificacoes') {
          setTimeout(() => this._aplicarPrefillNotificacao(), 400);
          setTimeout(() => this._injetarBotoesNotificacoes(), 600);
        }
        if (pageId === 'sancoes') {
          setTimeout(() => this._aplicarPrefillSancao(), 400);
        }
      }, 'integracao-lei14133')
    );
  }

  _injetarBotoesOcorrencias() {
    // Adiciona botão "→ Notificação" em cada card de ocorrência já renderizado
    document.querySelectorAll('[data-oc-id]').forEach(el => {
      const ocId = el.dataset.ocId;
      if (el.querySelector('.btn-gerar-notif')) return; // já injetado
      const div = el.querySelector('.btn-group-integ') || el;
      const btn = document.createElement('button');
      btn.className = 'btn-gerar-notif';
      btn.title = 'Gerar Notificação a partir desta ocorrência';
      btn.style.cssText = 'padding:4px 9px;font-size:10px;background:#dbeafe;border:1px solid #93c5fd;border-radius:6px;cursor:pointer;color:#1e40af;margin-left:4px';
      btn.textContent = '🔔 → Notificação';
      btn.onclick = (e) => { e.stopPropagation(); window._integGerarNotifDeOc(ocId); };
      div.appendChild(btn);
    });
  }

  _injetarBotoesNotificacoes() {
    // Adiciona botão "→ Sanção" nas notificações
    document.querySelectorAll('[data-notif-id]').forEach(el => {
      const nId = el.dataset.notifId;
      if (el.querySelector('.btn-gerar-sanc')) return;
      const div = el.querySelector('.btn-group-integ') || el;
      const btn = document.createElement('button');
      btn.className = 'btn-gerar-sanc';
      btn.title = 'Gerar Sanção a partir desta notificação';
      btn.style.cssText = 'padding:4px 9px;font-size:10px;background:#fee2e2;border:1px solid #fca5a5;border-radius:6px;cursor:pointer;color:#dc2626;margin-left:4px';
      btn.textContent = '⚖️ → Sanção';
      btn.onclick = (e) => { e.stopPropagation(); window._integGerarSancDeNotif(nId); };
      div.appendChild(btn);
    });
  }

  // ════════════════════════════════════════════════════════════════
  //  EXPÕE GLOBALS
  // ════════════════════════════════════════════════════════════════
  _exposeGlobals() {
    window._integGerarNotifDeOc      = (ocId)     => { try { this._gerarNotificacaoDeOcorrencia(ocId); } catch(e){ console.error(e); } };
    window._integGerarSancDeNotif    = (notifId)  => { try { this._gerarSancaoDeNotificacao(notifId); } catch(e){ console.error(e); } };
    window._integPDFNotificacao      = (notifId)  => { try { this._gerarPDFNotificacao(notifId); } catch(e){ console.error(e); } };
    window._integPDFSancao           = (sancId)   => { try { this._gerarPDFSancao(sancId); } catch(e){ console.error(e); } };
    window._integPDFRecebimento      = (recebId)  => { try { this._gerarPDFRecebimento(recebId); } catch(e){ console.error(e); } };
    window._integValidarResponsaveis = (obraId)   => this.validarResponsaveisObra(obraId);
    window._integValidarRecebDef     = (obraId)   => this.validarRecebimentoDefinitivo(obraId);
    window._integAuditDiff           = (params)   => { try { this.registrarAuditoriaDiff(params); } catch(e){} };
  }
}
