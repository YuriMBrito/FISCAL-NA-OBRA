/**
 * ╔══════════════════════════════════════════════════════════════╗
 * ║  FISCAL NA OBRA v15.5 — services/backupService.js           ║
 * ║  Backup e Exportação JSON da Obra                           ║
 * ╠══════════════════════════════════════════════════════════════╣
 * ║  Gera um arquivo JSON completo com todos os dados da obra   ║
 * ║  ativa (configurações, itens, BMs, medições) para download  ║
 * ║  local, funcionando mesmo sem conexão (modo offline).       ║
 * ║                                                              ║
 * ║  API pública:                                               ║
 * ║    backupService.gerarBackupJSON()  → download automático   ║
 * ║    backupService.restaurarJSON(txt) → importa backup        ║
 * ║    window.gerarBackupJSONAtual()    → atalho global         ║
 * ╚══════════════════════════════════════════════════════════════╝
 */

import EventBus from '../core/EventBus.js';
import state    from '../core/state.js';
import logger   from '../core/logger.js';

// ── Versão do schema de backup ────────────────────────────────
const BACKUP_SCHEMA_VERSION = '15.5';

// ═══════════════════════════════════════════════════════════════
// BackupService
// ═══════════════════════════════════════════════════════════════
const BackupService = {

  init() {
    try {
      this._bindEvents();
      window.backupService      = this;
      window.gerarBackupJSONAtual = () => this.gerarBackupJSON();
      logger.info('BackupService', '✅ Backup JSON ativo.');
    } catch (e) {
      logger.warn('BackupService', `init: ${e.message}`);
    }
  },

  _bindEvents() {
    // Atalho de teclado Ctrl+Shift+B para backup imediato
    if (typeof document !== 'undefined') {
      document.addEventListener('keydown', e => {
        if (e.ctrlKey && e.shiftKey && e.key === 'B') {
          e.preventDefault();
          this.gerarBackupJSON();
        }
      });
    }

    // Backup automático ao salvar medição
    EventBus.on('medicao:salva', () => {
      this._agendarBackupAutomatico();
    }, 'backup');
  },

  _agendarBackupAutomatico() {
    // Armazena no localStorage como backup de segurança (sem download)
    try {
      const obraId = state.get('obraAtivaId');
      if (!obraId) return;
      const payload = this._montarPayload();
      const chave   = `fo_backup_auto_${obraId}`;
      localStorage.setItem(chave, JSON.stringify(payload));
      localStorage.setItem(`${chave}_ts`, new Date().toISOString());
      logger.info('BackupService', '💾 Backup automático salvo no localStorage.');
    } catch (e) {
      logger.warn('BackupService', `backup automático: ${e.message}`);
    }
  },

  /**
   * Monta o payload de backup com todos os dados da obra ativa.
   */
  _montarPayload() {
    const obraId = state.get('obraAtivaId');
    const obras  = state.get('obras') || [];
    const obra   = obras.find(o => o.id === obraId) || {};

    return {
      _schema:     BACKUP_SCHEMA_VERSION,
      _exportadoEm: new Date().toISOString(),
      _versaoApp:  '15.5.1',
      obraId,
      obra: {
        id:     obraId,
        nome:   obra.nome || state.get('cfg')?.obra || '(sem nome)',
      },
      cfg:          state.get('cfg')           || {},
      itensContrato: state.get('itensContrato') || [],
      bms:          state.get('bms')            || [],
      usuarios:     state.get('usuarios')       || [],
      ocorrencias:  state.get('ocorrencias')    || [],
    };
  },

  /**
   * Gera e dispara o download do arquivo JSON de backup.
   */
  gerarBackupJSON() {
    try {
      const payload  = this._montarPayload();
      const obraSlug = (payload.obra.nome || 'obra')
        .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
        .replace(/[^a-zA-Z0-9]/g, '_')
        .slice(0, 30);
      const dataStr  = new Date().toISOString().slice(0, 10);
      const fileName = `FO_backup_${obraSlug}_${dataStr}.json`;

      const blob = new Blob(
        [JSON.stringify(payload, null, 2)],
        { type: 'application/json;charset=utf-8' }
      );
      const url  = URL.createObjectURL(blob);
      const a    = document.createElement('a');
      a.href     = url;
      a.download = fileName;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      setTimeout(() => URL.revokeObjectURL(url), 10000);

      logger.info('BackupService', `📥 Backup gerado: ${fileName}`);
      EventBus.emit('ui:toast', {
        msg:  `✅ Backup exportado: ${fileName}`,
        tipo: 'success',
      });

      return { ok: true, fileName };
    } catch (e) {
      logger.warn('BackupService', `gerarBackupJSON: ${e.message}`);
      EventBus.emit('ui:toast', { msg: `❌ Erro ao gerar backup: ${e.message}`, tipo: 'error' });
      return { ok: false, erro: e.message };
    }
  },

  /**
   * Restaura dados a partir de um texto JSON de backup.
   * Retorna { ok, erros[] }.
   */
  restaurarJSON(texto) {
    try {
      const payload = JSON.parse(texto);

      if (!payload._schema) {
        return { ok: false, erros: ['Arquivo não parece ser um backup do Fiscal na Obra.'] };
      }

      const campos = ['cfg', 'itensContrato', 'bms'];
      const erros  = [];

      campos.forEach(campo => {
        if (payload[campo] !== undefined) {
          try { state.set(campo, payload[campo]); }
          catch (e) { erros.push(`${campo}: ${e.message}`); }
        }
      });

      if (['ocorrencias', 'usuarios'].forEach) {
        ['ocorrencias', 'usuarios'].forEach(campo => {
          if (payload[campo]) {
            try { state.set(campo, payload[campo]); } catch (e) { /* não crítico */ }
          }
        });
      }

      EventBus.emit('backup:restaurado', { obraId: payload.obraId, schema: payload._schema });
      logger.info('BackupService', `🔄 Backup restaurado (schema ${payload._schema}).`);

      if (erros.length) {
        EventBus.emit('ui:toast', { msg: `⚠️ Backup restaurado com ${erros.length} erro(s).`, tipo: 'warn' });
      } else {
        EventBus.emit('ui:toast', { msg: '✅ Backup restaurado com sucesso.', tipo: 'success' });
      }

      return { ok: !erros.length, erros };
    } catch (e) {
      logger.warn('BackupService', `restaurarJSON: ${e.message}`);
      return { ok: false, erros: [e.message] };
    }
  },

  /**
   * Retorna o último backup automático salvo no localStorage para a obra ativa.
   */
  getBackupAutomatico() {
    try {
      const obraId = state.get('obraAtivaId');
      if (!obraId) return null;
      const txt = localStorage.getItem(`fo_backup_auto_${obraId}`);
      const ts  = localStorage.getItem(`fo_backup_auto_${obraId}_ts`);
      return txt ? { payload: JSON.parse(txt), ts } : null;
    } catch (e) {
      return null;
    }
  },
};

export default BackupService;
