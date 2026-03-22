/**
 * ╔══════════════════════════════════════════════════════════════╗
 * ║  FISCAL NA OBRA — firebase-config.js                        ║
 * ║  Credenciais do projeto Firebase (carregado antes do boot)  ║
 * ╚══════════════════════════════════════════════════════════════╝
 *
 * ⚠️  SEGURANÇA — LEIA ANTES DE FAZER DEPLOY
 * ─────────────────────────────────────────────────────────────
 * A apiKey abaixo é pública por design (apps Firebase web).
 * A proteção real vem das Firestore Security Rules e Storage Rules.
 *
 * AÇÃO OBRIGATÓRIA NO CONSOLE DO GOOGLE CLOUD:
 *   1. Acesse: https://console.cloud.google.com/apis/credentials
 *   2. Localize a chave "Browser key (auto created by Firebase)"
 *   3. Em "Restrições de aplicativo" → selecione "Referenciadores HTTP (sites)"
 *   4. Adicione APENAS seus domínios:
 *        https://fiscal-nota-100.web.app/*
 *        https://fiscal-nota-100.firebaseapp.com/*
 *        http://localhost:5000/*   ← apenas para dev local
 *   5. Salve. Sem isso, qualquer pessoa pode usar sua cota Firebase.
 *
 * Documentação: https://firebase.google.com/docs/projects/api-keys
 */
(function () {
  'use strict';

  var firebaseConfig = {
    apiKey:            "AIzaSyATdXIm3QminEMvHzJEALcMZv6mdGgFFxI",
    authDomain:        "fiscal-nota-100.firebaseapp.com",
    projectId:         "fiscal-nota-100",
    storageBucket:     "fiscal-nota-100.firebasestorage.app",
    messagingSenderId: "389772418485",
    appId:             "1:389772418485:web:e25f8e60893249b6b88dfc"
  };

  // Disponibiliza para o FirebaseService via window (sem localStorage)
  window._firebaseConfig = firebaseConfig;

  window._firebaseSDKReady = window._firebaseSDKReady || Promise.resolve();
  window._firebaseSDKReady.then(function () {
    try {
      if (typeof firebase === 'undefined') return;
      if (firebase.apps && firebase.apps.length > 0) return;
      firebase.initializeApp(firebaseConfig);
      console.log('[Config] Firebase inicializado com sucesso ✅');
    } catch (e) {
      console.warn('[Config] Erro ao inicializar Firebase:', e.message);
    }
  });

}());
