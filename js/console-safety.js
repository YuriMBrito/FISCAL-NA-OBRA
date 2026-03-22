/**
 * FISCAL NA OBRA — js/console-safety.js
 * Garante que window.console existe em browsers antigos.
 * Extraído do index.html inline (PASSO 0).
 */
(function () {
  if (typeof window.console === 'undefined') window.console = {};
  var noop = function () {};
  ['log', 'info', 'warn', 'error', 'debug', 'trace', 'group', 'groupEnd', 'time', 'timeEnd']
    .forEach(function (m) {
      if (typeof window.console[m] !== 'function') window.console[m] = noop;
    });
}());
