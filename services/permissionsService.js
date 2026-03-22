/**
 * ╔══════════════════════════════════════════════════════════════╗
 * ║  FISCAL NA OBRA v15.5 — services/permissionsService.js      ║
 * ║  Controle Centralizado de Permissões por Perfil             ║
 * ╠══════════════════════════════════════════════════════════════╣
 * ║  Consolida e estende o window.requirePerfil() existente.    ║
 * ║  Define a matriz de permissões por recurso e perfil.        ║
 * ║  Emite 'permissao:negada' para UI reagir.                   ║
 * ║                                                              ║
 * ║  Perfis (crescente de acesso):                             ║
 * ║    visualizador → tecnico → engenheiro → fiscal             ║
 * ║    → administrador                                          ║
 * ║                                                              ║
 * ║  Acesso: window.permissionsService.pode('editarBM')         ║
 * ╚══════════════════════════════════════════════════════════════╝
 */

import EventBus from '../core/EventBus.js';
import state    from '../core/state.js';
import logger   from '../core/logger.js';

// ── Hierarquia de perfis (índice = nível de acesso) ───────────
const NIVEL = {
  visualizador: 0,
  tecnico:      1,
  engenheiro:   2,
  fiscal:       3,
  administrador: 4,
};

// ── Matriz de permissões: recurso → nível mínimo ──────────────
const PERMISSOES = {
  // Boletim de Medição
  visualizarBM:     'visualizador',
  editarBM:         'tecnico',
  salvarMedicao:    'tecnico',
  bloquearBM:       'fiscal',
  desbloquearBM:    'fiscal',
  excluirBM:        'fiscal',
  adicionarItemBM:  'engenheiro',
  excluirItemBM:    'fiscal',
  editarItemBM:     'engenheiro',

  // Configurações
  editarConfig:     'fiscal',
  editarBDI:        'fiscal',

  // Contrato / Aditivos
  criarAditivo:     'fiscal',
  excluirAditivo:   'administrador',

  // Usuários
  gerenciarUsuarios: 'administrador',
  adicionarUsuario:  'administrador',

  // Exportação / Impressão
  exportarCSV:      'tecnico',
  gerarPDF:         'tecnico',

  // Auditoria
  verAuditoria:     'fiscal',
  exportarAuditoria: 'administrador',
};

// ═══════════════════════════════════════════════════════════════
// PermissionsService
// ═══════════════════════════════════════════════════════════════
const PermissionsService = {

  init() {
    try {
      this._bindEvents();
      // Substitui/complementa o window.requirePerfil global existente
      const _orig = window.requirePerfil;
      window.permissionsService = this;

      // Mantém compatibilidade com requirePerfil(...perfis) existente
      window.requirePerfil = (...perfisPermitidos) => {
        // Delega para o serviço centralizado
        const ok = this._verificarPerfis(perfisPermitidos);
        if (!ok) {
          window.toast?.('🚫 Perfil sem permissão para esta ação.', 'error');
        }
        return ok;
      };

      logger.info('PermissionsService', '✅ Controle de permissões ativo.');
    } catch (e) {
      logger.warn('PermissionsService', `init: ${e.message}`);
    }
  },

  _bindEvents() {
    // Atualiza cache de perfil ao logar ou trocar de obra
    EventBus.on('obra:selecionada', () => { this._perfilCache = null; }, 'permissions');
    EventBus.on('usuario:logado',   () => { this._perfilCache = null; }, 'permissions');
  },

  // ── Perfil do usuário atual ────────────────────────────────

  _perfilCache: null,

  getPerfil() {
    if (this._perfilCache) return this._perfilCache;
    const usuarios   = state.get('usuarios') || [];
    const userLogado = state.get('usuarioLogado') || {};
    const usuario    = usuarios.find(u =>
      u.uid === userLogado.uid || u.email === userLogado.email
    );
    // Se não há usuários cadastrados, assume acesso total (sistema sem perfis configurados)
    this._perfilCache = usuario?.perfil || (usuarios.length ? 'visualizador' : 'administrador');
    return this._perfilCache;
  },

  getNivel() {
    return NIVEL[this.getPerfil()] ?? 0;
  },

  // ── Verificações ───────────────────────────────────────────

  /**
   * Verifica se o usuário tem permissão para um recurso específico.
   * @param {string} recurso — chave da matriz PERMISSOES
   * @param {boolean} [silencioso=false] — não emite toast se negado
   */
  pode(recurso, silencioso = false) {
    const nivelRequerido = NIVEL[PERMISSOES[recurso]] ?? 0;
    const nivelUsuario   = this.getNivel();
    const ok = nivelUsuario >= nivelRequerido;

    if (!ok && !silencioso) {
      const perfilReq = PERMISSOES[recurso] || '?';
      window.toast?.(
        `🚫 Ação "${recurso}" requer perfil "${perfilReq}" ou superior. Seu perfil: "${this.getPerfil()}".`,
        'error'
      );
      EventBus.emit('permissao:negada', { recurso, perfil: this.getPerfil(), perfilRequerido: perfilReq });
    }

    return ok;
  },

  /**
   * Verifica lista de perfis (compatibilidade com requirePerfil() original).
   * @param {string[]} perfisPermitidos
   */
  _verificarPerfis(perfisPermitidos) {
    if (!perfisPermitidos.length) return true;
    const perfil = this.getPerfil();
    const nivel  = this.getNivel();
    // Aceita se perfil está na lista OU se o nível é maior que todos na lista
    const nivelMax = Math.max(...perfisPermitidos.map(p => NIVEL[p] ?? 0));
    return perfisPermitidos.includes(perfil) || nivel >= nivelMax;
  },

  /**
   * Retorna a matriz de permissões completa (para exibição em tela de usuários).
   */
  getMatriz() {
    return Object.entries(PERMISSOES).map(([recurso, perfilMin]) => ({
      recurso,
      perfilMin,
      nivelMin: NIVEL[perfilMin],
    }));
  },

  /**
   * Retorna todos os recursos que o usuário atual pode acessar.
   */
  getMeusRecursos() {
    const nivel = this.getNivel();
    return Object.entries(PERMISSOES)
      .filter(([, p]) => nivel >= (NIVEL[p] ?? 0))
      .map(([r]) => r);
  },
};

export default PermissionsService;
