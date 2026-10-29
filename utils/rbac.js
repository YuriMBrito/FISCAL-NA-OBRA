/**
 * ╔══════════════════════════════════════════════════════════════╗
 * ║  FISCAL NA OBRA — utils/rbac.js                             ║
 * ║  Controle de Acesso Baseado em Papéis (RBAC) — Cliente      ║
 * ║                                                              ║
 * ║  PRINCÍPIO: espelha exatamente as Firestore Security Rules  ║
 * ║  para dar resposta imediata no UI (ex: esconder botão).     ║
 * ║  A regra definitiva SEMPRE é o servidor — não confiar só    ║
 * ║  neste módulo para segurança real.                          ║
 * ╚══════════════════════════════════════════════════════════════╝
 *
 * DE ONDE VEM O PAPEL (mudou em 27/10/2026)
 *
 * Do custom claim 'role' do token, gravado pelo Admin SDK em
 * criar-usuario.cjs / definir-perfil.mjs. O FirebaseService lê o claim no
 * onAuthStateChanged e o deixa em state.usuarioLogado.perfil, que é o que
 * este módulo consulta.
 *
 * O que saiu daqui, e por quê:
 *
 *   • A busca do papel na lista de usuários da obra (obras/{id}/usuarios/lista,
 *     casando por e-mail ou uid). As rules não consultam mais essa lista — ela
 *     é cadastral, e casar por e-mail aqui enquanto o servidor olhava um mapa
 *     inteiro era justamente a divergência que fazia o UI liberar botão que o
 *     Firestore recusava. Além disso state.usuariosObra nunca era populado:
 *     esse caminho já estava morto.
 *
 *   • O atalho "dono da obra vale gestor". Não existe mais no servidor: as
 *     rules decidem só por papel, sem ler obras/{id}.uid. O campo 'uid' da
 *     obra continua existindo e significa o dono, mas quem o usa hoje é
 *     informativo — prometer poder aqui que o servidor não dá é o erro que
 *     este arquivo existe para não cometer.
 *
 * MANTER EM SINCRONIA com nivelExigido() em firestore.rules.
 */

import state from '../core/state.js';

// ── Hierarquia de papéis ──────────────────────────────────────
// Quanto maior o índice, mais privilegiado. Mesma tabela de nivel() nas rules.
const HIERARQUIA = {
  visualizador:  0,
  tecnico:       1,
  engenheiro:    2,
  fiscal:        3,
  gestor:        4,
  administrador: 5,
};

// Conta sem o claim 'role'. Tem de ser igual a papelPadrao() nas rules:
// se divergir, o UI promete o que o servidor nega (ou o contrário).
export const PAPEL_PADRAO = 'fiscal';

/**
 * Papel do usuário atual, lido do claim via state.usuarioLogado.perfil.
 * Não depende da obra ativa: o papel é da conta, como no servidor.
 */
function _papelAtual() {
  const userLogado = state.get('usuarioLogado') || {};
  return userLogado.perfil || PAPEL_PADRAO;
}

function _nivel(papel) {
  return HIERARQUIA[papel] ?? 0;
}

// ── API pública ────────────────────────────────────────────────

export const RBAC = {

  /** Retorna o papel atual do usuário */
  papel() { return _papelAtual(); },

  /** Retorna true se o usuário tem o papel ou superior */
  temPapelMinimo(papelMinimo) {
    return _nivel(_papelAtual()) >= _nivel(papelMinimo);
  },

  /** Pode ler dados da obra — qualquer autenticado, em qualquer obra */
  podeLer() { return true; },

  /** Operação de campo: diário, ocorrências, chuva, documentos, fotos */
  podeEscrever() {
    return _nivel(_papelAtual()) >= _nivel('tecnico');
  },

  /** Impacto financeiro: BMs, medições, itens do contrato e aditivos */
  podeGerirAditivos() {
    return _nivel(_papelAtual()) >= _nivel('engenheiro');
  },

  /**
   * Impacto jurídico e contratual: cfg, sanções, prazos, responsáveis,
   * recebimentos, riscos, versões, lei14133 — e criar/editar a obra.
   */
  podeGerirDocumentosJuridicos() {
    return _nivel(_papelAtual()) >= _nivel('gestor');
  },

  /** Gerenciar os usuários da obra e excluir a obra: só administrador */
  podeAdministrarObra() {
    return _nivel(_papelAtual()) >= _nivel('administrador');
  },

  /** É administrador global */
  eAdmin() {
    return _papelAtual() === 'administrador';
  },

  /** É somente visualizador */
  eSomenteVisualizador() {
    return _nivel(_papelAtual()) <= _nivel('visualizador');
  },

  /**
   * Retorna CSS para esconder elemento se o usuário não tem permissão.
   * Uso: el.style.display = RBAC.visibleIf(RBAC.podeGerirAditivos())
   */
  visibleIf(condicao) {
    return condicao ? '' : 'none';
  },

  /**
   * Desabilita um elemento se o usuário não tem permissão.
   * Uso: RBAC.proteger(btnSalvar, RBAC.podeGerirAditivos())
   */
  proteger(el, condicao, tooltip = 'Sem permissão para esta ação') {
    if (!el) return;
    if (!condicao) {
      el.disabled = true;
      el.title    = tooltip;
      el.style.opacity = '0.45';
      el.style.cursor  = 'not-allowed';
    } else {
      el.disabled = false;
      el.title    = '';
      el.style.opacity = '';
      el.style.cursor  = '';
    }
  },

  /**
   * Tabela de permissões para uso em templates e auditoria.
   */
  resumo() {
    const p = _papelAtual();
    return {
      papel:                      p,
      nivel:                      _nivel(p),
      podeLer:                    this.podeLer(),
      podeEscrever:               this.podeEscrever(),
      podeGerirAditivos:          this.podeGerirAditivos(),
      podeGerirDocumentosJurid:   this.podeGerirDocumentosJuridicos(),
      podeAdministrarObra:        this.podeAdministrarObra(),
    };
  },
};

export default RBAC;
