/**
 * ╔══════════════════════════════════════════════════════════════╗
 * ║  FISCAL NA OBRA v15.1 — js/inline-entry.js                 ║
 * ║  Substitui o <script type="module"> inline do index.html   ║
 * ║  Necessário para remover 'unsafe-inline' da CSP            ║
 * ╚══════════════════════════════════════════════════════════════╝
 */
import app from '../core/app.js';

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', () => app.boot());
} else {
  app.boot();
}

// Expõe instância para debug apenas em development
if (location.hostname === 'localhost' || location.hostname === '127.0.0.1') {
  window._FO = app;
}
