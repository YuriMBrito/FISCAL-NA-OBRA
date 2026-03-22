/**
 * ╔══════════════════════════════════════════════════════════════════════╗
 * ║  FISCAL NA OBRA v15.1 — core/safe-execute.js                         ║
 * ║  Proteção de execução com timeout, retry e rastreamento de contexto ║
 * ╚══════════════════════════════════════════════════════════════════════╝
 *
 * Uso básico:
 *   const result = await safeExecute(() => module.init(), { source: 'boletim' });
 *
 * Com opções:
 *   const result = await safeExecute(fn, {
 *     source:       'boletim',       // identificação para logs
 *     timeout:      5000,            // ms (padrão: 10 000)
 *     retries:      2,               // tentativas extras
 *     retryDelay:   500,             // ms entre tentativas
 *     fallback:     () => default,   // retorno em caso de falha total
 *     onError:      (err) => ...,    // callback ao detectar erro
 *     critical:     false,           // se true: eleva nível para CRITICAL
 *     silent:       false,           // se true: suprime logs
 *   });
 */

import logger from './logger.js';

// ── Constantes ────────────────────────────────────────────────────────────
const DEFAULT_TIMEOUT     = 10_000;   // 10 s
const DEFAULT_RETRIES     = 0;
const DEFAULT_RETRY_DELAY = 300;

// ── Utilitário: promessa com timeout ─────────────────────────────────────
function withTimeout(promise, ms, label) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new TimeoutError(`Timeout de ${ms}ms atingido em "${label}"`));
    }, ms);

    promise
      .then(v  => { clearTimeout(timer); resolve(v); })
      .catch(e => { clearTimeout(timer); reject(e); });
  });
}

// ── Erro customizado ──────────────────────────────────────────────────────
export class TimeoutError extends Error {
  constructor(msg) {
    super(msg);
    this.name = 'TimeoutError';
  }
}

export class SafeExecuteError extends Error {
  constructor(msg, original) {
    super(msg);
    this.name     = 'SafeExecuteError';
    this.original = original;
  }
}

// ── safeExecute ───────────────────────────────────────────────────────────
/**
 * Executa uma função (síncrona ou assíncrona) com:
 *  - timeout automático
 *  - retry configurável
 *  - captura de erro
 *  - log estruturado
 *  - fallback opcional
 *
 * @param {Function}  fn       — função a executar
 * @param {object}    [opts]   — opções
 * @returns {Promise<{ ok: boolean, value: *, error: Error|null, attempts: number }>}
 */
export async function safeExecute(fn, opts = {}) {
  const {
    source      = 'app',
    timeout     = DEFAULT_TIMEOUT,
    retries     = DEFAULT_RETRIES,
    retryDelay  = DEFAULT_RETRY_DELAY,
    fallback    = null,
    onError     = null,
    critical    = false,
    silent      = false,
    label       = null,
  } = opts;

  const execLabel = label || source;
  let   attempts  = 0;
  let   lastError = null;

  for (let attempt = 0; attempt <= retries; attempt++) {
    attempts++;

    try {
      // Aguarda resultado com timeout
      const rawResult = fn();
      const value = rawResult instanceof Promise
        ? await withTimeout(rawResult, timeout, execLabel)
        : rawResult;

      if (!silent) {
        logger.debug(source, `✅ safeExecute OK (tentativa ${attempts})`, { execLabel });
      }

      return { ok: true, value, error: null, attempts };

    } catch (err) {
      lastError = err;

      const isTimeout = err instanceof TimeoutError;
      const isLast    = attempt === retries;
      const level     = critical || isLast ? (critical ? 'critical' : 'error') : 'warn';

      if (!silent) {
        logger[level](
          source,
          `${isTimeout ? '⏱️ Timeout' : '💥 Erro'} em safeExecute "${execLabel}" (tentativa ${attempts}/${retries + 1}): ${err.message}`,
          { stack: err.stack, isTimeout }
        );
      }

      // Chama callback de erro
      if (typeof onError === 'function') {
        try { onError(err, { attempts, isLast }); } catch {}
      }

      // Se não é a última tentativa, aguarda e repete
      if (!isLast) {
        await sleep(retryDelay * attempts); // backoff exponencial simples
        continue;
      }
    }
  }

  // Todas as tentativas falharam — executa fallback
  let fallbackValue;
  if (typeof fallback === 'function') {
    try {
      fallbackValue = await fallback(lastError);
      if (!silent) {
        logger.info(source, `🔄 Fallback executado com sucesso após ${attempts} tentativa(s)`, { execLabel });
      }
    } catch (fbErr) {
      if (!silent) {
        logger.error(source, `❌ Fallback também falhou: ${fbErr.message}`, { execLabel });
      }
    }
  }

  return { ok: false, value: fallbackValue, error: lastError, attempts };
}

// ── safeExecuteSync ────────────────────────────────────────────────────────
/**
 * Versão síncrona de safeExecute (sem timeout nem retry).
 * Ideal para eventos DOM e callbacks simples.
 */
export function safeExecuteSync(fn, opts = {}) {
  const { source = 'app', fallback = null, silent = false, critical = false } = opts;

  try {
    const value = fn();
    return { ok: true, value, error: null };
  } catch (err) {
    if (!silent) {
      const level = critical ? 'critical' : 'error';
      logger[level](source, `💥 Erro síncrono: ${err.message}`, { stack: err.stack });
    }

    let fallbackValue;
    if (typeof fallback === 'function') {
      try { fallbackValue = fallback(err); } catch {}
    }

    return { ok: false, value: fallbackValue, error: err };
  }
}

// ── Decorator de método ────────────────────────────────────────────────────
/**
 * Envolve todos os métodos de um objeto com safeExecute.
 * Uso: wrapWithSafeExecute(moduleInstance, 'boletim', ['init', 'onEnter'])
 */
export function wrapWithSafeExecute(obj, source, methodNames = [], timeoutMs = DEFAULT_TIMEOUT) {
  methodNames.forEach(name => {
    const original = obj[name];
    if (typeof original !== 'function') return;

    obj[name] = async function(...args) {
      const { ok, value, error } = await safeExecute(
        () => original.apply(obj, args),
        { source: `${source}.${name}`, timeout: timeoutMs }
      );
      if (!ok) throw error;
      return value;
    };
  });
  return obj;
}

// ── Helper ────────────────────────────────────────────────────────────────
function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}
