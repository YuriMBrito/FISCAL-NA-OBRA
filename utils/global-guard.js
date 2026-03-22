/**
 * ╔══════════════════════════════════════════════════════════════╗
 * ║  FISCAL NA OBRA v20 — utils/global-guard.js                ║
 * ║  Problema 1 — Funções Globais no Window                    ║
 * ╚══════════════════════════════════════════════════════════════╝
 *
 * PROPÓSITO:
 *   Garante que chamadas inline no HTML (onclick="window.fn?.()")
 *   nunca disparem ReferenceError mesmo se o módulo ainda não
 *   tiver sido inicializado. O proxy enfileira chamadas pendentes
 *   e as executa assim que a função real for registrada.
 *
 * USO:
 *   // No módulo que expõe a função:
 *   import { exposeGlobal } from '../../utils/global-guard.js';
 *   exposeGlobal('_dgAbrirObra', (id) => this._abrirObra(id));
 *
 *   // Chamadas HTML continuam idênticas:
 *   onclick="window._dgAbrirObra('abc')"
 *
 * REGRAS:
 *   - Não altera módulos que não tenham relação com o problema.
 *   - Não remove nenhuma função existente.
 *   - Apenas encapsula o registro no window com log de erro claro.
 */

const _pendingCalls = new Map(); // fnName → [[args, timestamp], ...]

/**
 * Registra uma função global no window com proteção a erros.
 * Se houver chamadas pendentes para este nome, executa-as imediatamente.
 *
 * @param {string}   name  - Nome da propriedade em window
 * @param {Function} fn    - Implementação real
 * @param {Object}   [opts]
 * @param {boolean}  [opts.override=true]  - Permite sobrescrever se já existir
 * @param {boolean}  [opts.silent=false]   - Suprime warnings no console
 */
export function exposeGlobal(name, fn, { override = true, silent = false } = {}) {
  if (!override && typeof window[name] === 'function') {
    if (!silent) console.debug(`[GlobalGuard] "${name}" já registrado, pulando.`);
    return;
  }

  // Envolve em try/catch para que erros internos nunca cheguem ao HTML
  const wrapped = (...args) => {
    try {
      return fn(...args);
    } catch (e) {
      console.error(`[GlobalGuard] Erro em window.${name}:`, e);
    }
  };

  window[name] = wrapped;

  // Drena chamadas que chegaram antes do módulo estar pronto
  if (_pendingCalls.has(name)) {
    const queue = _pendingCalls.get(name);
    _pendingCalls.delete(name);
    queue.forEach(([args]) => {
      try { wrapped(...args); } catch (e) { /* já logado internamente */ }
    });
  }
}

/**
 * Stub temporário: registra um placeholder que enfileira chamadas.
 * Útil para ser chamado no boot antes dos módulos carregarem.
 *
 * @param {...string} names - Nomes das funções a criar como stub
 */
export function stubGlobals(...names) {
  names.forEach(name => {
    if (typeof window[name] === 'function') return; // já registrado
    window[name] = (...args) => {
      if (!_pendingCalls.has(name)) _pendingCalls.set(name, []);
      _pendingCalls.get(name).push([args, Date.now()]);
      console.debug(`[GlobalGuard] Chamada enfileirada para "${name}" (módulo pendente).`);
    };
  });
}

/**
 * Verifica se há chamadas pendentes não consumidas (debug).
 * @returns {Object} mapa nome → quantidade de chamadas pendentes
 */
export function getPendingCallsReport() {
  const report = {};
  _pendingCalls.forEach((calls, name) => { report[name] = calls.length; });
  return report;
}

// ─────────────────────────────────────────────────────────────────────────
//  v24.0 — Namespace FO: alternativa ao window.* para reduzir colisões
//  Em vez de window._dgAbrirObra, use window.FO.dg.abrirObra()
//  Módulos novos devem preferir window.FO.{modulo}.{acao}
// ─────────────────────────────────────────────────────────────────────────

/**
 * Inicializa o namespace global window.FO (Fiscal na Obra).
 * Módulos novos devem registrar funções aqui em vez de diretamente em window.
 * Módulos legados continuam usando window.* via stubGlobals/exposeGlobal.
 *
 * Exemplo de uso em módulos novos:
 *   import { registerFO } from '../../utils/global-guard.js';
 *   registerFO('qualidade', 'salvar', () => this._salvar());
 *   // Chamado no HTML como: onclick="window.FO?.qualidade?.salvar()"
 */
if (!window.FO) {
  window.FO = Object.create(null);
}

export function registerFO(modulo, nome, fn) {
  if (!window.FO[modulo]) window.FO[modulo] = Object.create(null);
  window.FO[modulo][nome] = (...args) => {
    try { return fn(...args); }
    catch (e) { console.error(`[FO.${modulo}.${nome}]`, e); }
  };
}

/**
 * Lista todas as funções registradas no namespace FO (diagnóstico).
 */
export function getFORegistry() {
  const reg = {};
  for (const [mod, funcs] of Object.entries(window.FO || {})) {
    reg[mod] = Object.keys(funcs);
  }
  return reg;
}
