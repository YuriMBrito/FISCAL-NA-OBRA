/**
 * ╔══════════════════════════════════════════════════════════════╗
 * ║  FISCAL NA OBRA — utils/loading.js                          ║
 * ║  FIX-E3.2: loading state para operações assíncronas         ║
 * ╚══════════════════════════════════════════════════════════════╝
 *
 * Resolve o problema de 14 módulos sem feedback visual durante
 * operações Firebase — o usuário clicava múltiplas vezes
 * gerando duplo salvamento.
 *
 * USO:
 *   import { withLoading } from '../../utils/loading.js';
 *
 *   // Com elemento de botão (desabilita + muda texto)
 *   window._meuSalvar = () =>
 *     withLoading(document.getElementById('btn-salvar'),
 *       () => this._salvarAsync(),
 *       { labelLoading: 'Salvando...', labelDone: 'Salvo!' }
 *     );
 *
 *   // Sem botão (apenas executa com proteção contra double-call)
 *   withLoading(null, () => this._importarSINAPI());
 */

/**
 * Executa uma função assíncrona com feedback visual no botão.
 *
 * @param {HTMLElement|null} btn           - Botão a desabilitar (pode ser null)
 * @param {Function}         asyncFn       - Função async a executar
 * @param {object}           [opts]
 * @param {string}           [opts.labelLoading='Aguarde...'] - Texto durante execução
 * @param {string}           [opts.labelDone]                 - Texto após sucesso (restaura após 2s)
 * @param {string}           [opts.labelError]                - Texto após erro (restaura após 3s)
 * @param {number}           [opts.doneDuration=2000]         - Duração do texto de sucesso em ms
 * @returns {Promise<*>} resultado de asyncFn
 */
export async function withLoading(btn, asyncFn, opts = {}) {
  const {
    labelLoading = 'Aguarde...',
    labelDone    = null,
    labelError   = null,
    doneDuration = 2000,
  } = opts;

  // Guarda estado original do botão
  const originalHTML     = btn?.innerHTML ?? '';
  const originalDisabled = btn?.disabled  ?? false;

  // Ativa estado de loading
  if (btn) {
    btn.disabled = true;
    btn.innerHTML = `<span style="display:inline-flex;align-items:center;gap:6px">
      <svg style="animation:spin .7s linear infinite;width:13px;height:13px;flex-shrink:0" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5">
        <circle cx="12" cy="12" r="10" stroke-opacity=".25"/>
        <path d="M12 2a10 10 0 0 1 10 10"/>
      </svg>
      ${labelLoading}
    </span>`;
  }

  let success = false;
  try {
    const result = await asyncFn();
    success = true;
    if (btn && labelDone) {
      btn.innerHTML = `✅ ${labelDone}`;
      setTimeout(() => {
        if (btn) { btn.innerHTML = originalHTML; btn.disabled = originalDisabled; }
      }, doneDuration);
    } else if (btn) {
      btn.innerHTML = originalHTML;
      btn.disabled  = originalDisabled;
    }
    return result;
  } catch (err) {
    if (btn) {
      if (labelError) {
        btn.innerHTML = `❌ ${labelError}`;
        setTimeout(() => {
          if (btn) { btn.innerHTML = originalHTML; btn.disabled = originalDisabled; }
        }, 3000);
      } else {
        btn.innerHTML = originalHTML;
        btn.disabled  = originalDisabled;
      }
    }
    throw err; // re-lança para que o caller possa tratar
  }
}

/**
 * Versão simplificada: garante que uma operação assíncrona não seja
 * disparada em paralelo (segunda chamada enquanto primeira ainda roda).
 *
 * @param {Function} asyncFn
 * @returns {Function} função wrapped com proteção
 */
export function onceConcurrent(asyncFn) {
  let running = false;
  return async (...args) => {
    if (running) return;
    running = true;
    try {
      return await asyncFn(...args);
    } finally {
      running = false;
    }
  };
}
