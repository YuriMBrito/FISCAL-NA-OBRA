/**
 * FISCAL NA OBRA — js/firebase-stub.js
 * Stub mínimo do Firebase para evitar erros enquanto o SDK real carrega.
 * Substituído automaticamente pelo SDK real quando disponível.
 * Extraído do index.html inline (PASSO 1).
 */
(function () {
  'use strict';
  if (typeof window.firebase !== 'undefined') return;

  var noop = function () { return Promise.resolve(); };
  var noopSnap = function (cb) {
    if (typeof cb === 'function') cb({ docs: [], forEach: function () {}, size: 0 });
    return function () {};
  };
  var P = {
    get:        function () { return Promise.reject(new Error('stub')); },
    set:        noop,
    update:     noop,
    delete:     noop,
    add:        noop,
    onSnapshot: noopSnap,
    where:      function () { return P; },
    collection: function () { return P; },
    doc:        function () { return P; },
    orderBy:    function () { return P; },
    limit:      function () { return P; },
  };
  var A = {
    onAuthStateChanged:          function (cb) { if (typeof cb === 'function') cb(null); return function () {}; },
    signInWithEmailAndPassword:  function () { return Promise.reject(new Error('stub')); },
    signOut:     noop,
    currentUser: null,
  };

  window.firebase = {
    apps:       [],
    SDK_VERSION: null,
    initializeApp: function (c) {
      console.warn('[Firebase] stub initializeApp');
      return { options: c || {}, delete: noop };
    },
    auth: function () { return A; },
    firestore: Object.assign(
      function () {
        return Object.assign({}, P, {
          enablePersistence: noop,
          collection: function () { return P; },
        });
      },
      {
        FieldValue: {
          serverTimestamp: function () { return new Date(); },
          delete:          function () { return null; },
        },
      }
    ),
    storage: function () {
      return {
        ref: function () {
          return {
            put:            function () { return Promise.reject(new Error('stub')); },
            getDownloadURL: function () { return Promise.reject(new Error('stub')); },
          };
        },
      };
    },
  };
}());
