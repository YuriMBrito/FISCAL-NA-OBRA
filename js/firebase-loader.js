/**
 * FISCAL NA OBRA — js/firebase-loader.js
 * Carrega o Firebase SDK da melhor CDN disponível (fallback em cascata).
 * Define window._firebaseSDKReady (Promise) para sincronização do boot.
 * Extraído do index.html inline (PASSO 1.1).
 */
(function () {
  'use strict';
  var V = '10.12.2';
  var CDNS = [
    { base: 'https://www.gstatic.com/firebasejs/' + V + '/',            sfx: '.js',     lbl: 'gstatic'  },
    { base: 'https://cdn.jsdelivr.net/npm/firebase@' + V + '/',        sfx: '.min.js', lbl: 'jsdelivr' },
    { base: 'https://unpkg.com/firebase@' + V + '/',                   sfx: '.js',     lbl: 'unpkg'    },
  ];
  var M = [
    'firebase-app-compat',
    'firebase-auth-compat',
    'firebase-firestore-compat',
    'firebase-storage-compat',
  ];

  function loadScript(url) {
    return new Promise(function (ok, ko) {
      var s = document.createElement('script');
      s.src   = url;
      s.async = false;
      s.onload  = function () { ok(url); };
      s.onerror = function () { ko(new Error(url)); };
      document.head.appendChild(s);
    });
  }

  function loadCDN(cdn) {
    return M.reduce(function (p, m) {
      return p.then(function () { return loadScript(cdn.base + m + cdn.sfx); });
    }, Promise.resolve());
  }

  function tryAll(i) {
    if (i >= CDNS.length) {
      console.error('[Firebase] Todas as CDNs falharam. Verifique sua conexão.');
      return Promise.resolve();
    }
    return loadCDN(CDNS[i])
      .then(function () {
        console.log('[Firebase] SDK v' + V + ' via ' + CDNS[i].lbl + ' ✅');
        // Garante FieldValue mesmo quando CDN retorna build incompleto
        if (typeof firebase !== 'undefined' && firebase.firestore && !firebase.firestore.FieldValue) {
          firebase.firestore.FieldValue = {
            serverTimestamp: function () { return new Date(); },
            delete:          function () { return null; },
          };
        }
        window._firebaseSDKLoaded = true;
      })
      .catch(function (e) {
        console.warn('[Firebase] Falha ' + CDNS[i].lbl + ':', e.message);
        return tryAll(i + 1);
      });
  }

  window._firebaseSDKReady = tryAll(0);
}());
