/**
 * ╔══════════════════════════════════════════════════════════════╗
 * ║  FISCAL NA OBRA v15.1 — utils/rbac.js                      ║
 * ║  Controle de Acesso Baseado em Papéis (RBAC) — Cliente      ║
 * ║                                                              ║
 * ║  PRINCÍPIO: Espelha exatamente as Firestore Security Rules  ║
 * ║  para feedback imediato no UI (ex: esconder botões).        ║
 * ║  A regra definitiva SEMPRE é o Firestore — não confiar só   ║
 * ║  neste módulo para segurança real.                          ║
 * ╚══════════════════════════════════════════════════════════════╝
 */

import state from '../core/state.js';

// ── Hierarquia de papéis ──────────────────────────────────────
// Quanto maior o índice, mais privilegiado o papel.
const HIERARQUIA = {
  visualizador: 0,
  tecnico:      1,
  engenheiro:   2,
  fiscal:       3,
  gestor:       4,
  administrador: 5,
};

/**
 * Retorna o papel (role) do usuário atual no contexto da obra ativa.
 * Considera: papel global (usuarios/{uid}) e papel na obra (obras/{id}/usuarios/lista).
 * O papel global é usado se o usuário for administrador.
 */
function _papelAtual() {
  const userLogado = state.get('usuarioLogado') || {};
  const perfilGlobal = userLogado.perfil || 'visualizador';
  if (perfilGlobal === 'administrador') return 'administrador';

  // Papel específico na obra (pode ser diferente do papel global)
  const obraId = state.get('obraAtivaId');
  const cfg = state.get('cfg') || {};

  // Se for o dono da obra, tem papel de gestor no mínimo
  if (cfg.uid && cfg.uid === userLogado.uid) return 'gestor';

  // Verifica na lista de usuários da obra
  const usuarios = state.get('usuariosObra') || [];
  const entry = usuarios.find(u => u.uid === userLogado.uid);
  return entry?.perfil || perfilGlobal;
}

function _nivel(papel) {
  return HIERARQUIA[papel] ?? 0;
}

// ── API pública ────────────────────────────────────────────────

export const RBAC = {

  /** Retorna o papel atual do usuário na obra ativa */
  papel() { return _papelAtual(); },

  /** Retorna true se o usuário tem o papel ou superior */
  temPapelMinimo(papelMinimo) {
    return _nivel(_papelAtual()) >= _nivel(papelMinimo);
  },

  /** Pode ler dados da obra */
  podeLer() { return true; }, // qualquer autenticado que seja membro pode ler

  /** Pode criar/editar dados gerais (ocorrências, diário, BM, fotos) */
  podeEscrever() {
    return _nivel(_papelAtual()) >= _nivel('tecnico');
  },

  /** Pode criar/editar aditivos e BMs (impacto financeiro) */
  podeGerirAditivos() {
    return _nivel(_papelAtual()) >= _nivel('engenheiro');
  },

  /** Pode criar/editar sanções, prazos, responsáveis, cfg (impacto jurídico) */
  podeGerirDocumentosJuridicos() {
    return _nivel(_papelAtual()) >= _nivel('gestor');
  },

  /** Pode gerenciar usuários da obra e excluir a obra */
  podeAdministrarObra() {
    const p = _papelAtual();
    // Dono da obra tem papel de gestor para esta verificação
    const cfg = state.get('cfg') || {};
    const user = state.get('usuarioLogado') || {};
    const eDono = cfg.uid && cfg.uid === user.uid;
    return eDono || _nivel(p) >= _nivel('administrador');
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
