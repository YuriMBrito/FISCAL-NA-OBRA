/**
 * ╔══════════════════════════════════════════════════════════════╗
 * ║  FISCAL NA OBRA v15.1 — js/lgpd-consent.js                 ║
 * ║  Lógica de consentimento LGPD — extraída do inline HTML    ║
 * ╚══════════════════════════════════════════════════════════════╝
 */
(function () {
  'use strict';
  const CHAVE = 'fo_lgpd_aceito_v1';

  function _jaAceitou() {
    try { return sessionStorage.getItem(CHAVE) === '1'; } catch { return false; }
  }

  window._lgpdAceitar = function () {
    try { sessionStorage.setItem(CHAVE, '1'); } catch {}
    const ov = document.getElementById('lgpd-overlay');
    const po = document.getElementById('lgpd-politica-overlay');
    if (ov) ov.style.display = 'none';
    if (po) po.style.display = 'none';
  };

  window._lgpdVerPolitica = function () {
    const el = document.getElementById('lgpd-politica-overlay');
    if (el) el.style.display = 'block';
  };

  window._lgpdMostrarSeNecessario = function () {
    if (_jaAceitou()) return;
    const ov = document.getElementById('lgpd-overlay');
    if (ov) ov.style.display = 'flex';
  };

  document.addEventListener('DOMContentLoaded', function () {
    // CORREÇÃO v15.3: o elemento correto é 'tela-login', não 'login-box'.
    // O ID 'login-box' não existe no index.html — o modal LGPD nunca era exibido.
    const telaLogin = document.getElementById('tela-login');
    if (telaLogin) {
      const obs = new MutationObserver(function () {
        if (telaLogin.style.display !== 'none') {
          window._lgpdMostrarSeNecessario();
          obs.disconnect();
        }
      });
      obs.observe(telaLogin, { attributes: true, attributeFilter: ['style'] });
      // Verifica imediatamente caso a tela já esteja visível
      if (telaLogin.style.display !== 'none') {
        window._lgpdMostrarSeNecessario();
      }
    }
  });
}());
