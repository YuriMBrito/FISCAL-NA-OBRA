/**
 * FISCAL NA OBRA — js/login-controller.js
 * Lógica da tela de login: toggle, abas, estado de loading, modo offline.
 * Extraído do index.html inline para facilitar manutenção e testes.
 *
 * Dependências: Firebase SDK (window.firebase), window.toast, window.router
 */
// ── Lógica da tela de login ──────────────────────────────────────
window._salvarLoginAtivo = true;

window._toggleSalvar = function() {
  window._salvarLoginAtivo = !window._salvarLoginAtivo;
  const thumb = document.getElementById('toggle-thumb');
  const tog   = document.getElementById('toggle-salvar');
  const label = document.getElementById('login-salvo-label');
  if (thumb) thumb.style.left       = window._salvarLoginAtivo ? '18px' : '2px';
  if (tog)   tog.style.background   = window._salvarLoginAtivo ? '#fff'  : '#333';
  if (thumb) thumb.style.background = window._salvarLoginAtivo ? '#000'  : '#fff';
  if (label) label.style.display    = window._salvarLoginAtivo ? 'block' : 'none';
};

window._abaLogin = function(aba) {
  const btnE = document.getElementById('aba-entrar');
  const btnC = document.getElementById('aba-cadastrar');
  if (aba === 'entrar') {
    if (btnE) { btnE.style.background='#fff'; btnE.style.color='#000'; btnE.style.fontWeight='700'; }
    if (btnC) { btnC.style.background='transparent'; btnC.style.color='#555'; btnC.style.fontWeight='600'; }
  } else {
    if (btnC) { btnC.style.background='#fff'; btnC.style.color='#000'; btnC.style.fontWeight='700'; }
    if (btnE) { btnE.style.background='transparent'; btnE.style.color='#555'; btnE.style.fontWeight='600'; }
    window.toast?.('Cadastro disponível apenas pelo administrador.', 'info');
  }
};

// ── Login com Google: REMOVIDO em 13/08/2026 ────────────────────
//
// A partir da abertura da escrita para qualquer conta autenticada
// (ver o cabeçalho de firestore.rules), o Authentication virou a única
// fronteira de segurança do sistema. O login do Google aceitava QUALQUER
// conta Google do mundo, sem lista de permitidos — ou seja, a fronteira
// não filtrava ninguém. Entrada agora é só por conta provisionada pelo
// administrador (criar-usuario.cjs / definir-perfil.mjs, via Admin SDK).
//
// Tirar o botão e este código NÃO desliga o provedor: enquanto ele estiver
// habilitado em Authentication → Sign-in method, dá para autenticar por
// fora do app. Desligar lá é parte da mesma tarefa.
//
// _loginGoogle e _verificarRedirectGoogle foram apagados daqui. Se um
// data-action antigo em cache ainda apontar para eles, o EventDelegate
// não acha o global e não faz nada — que é o comportamento desejado.
window._setLoginLoading = function(loading) {
  const btn = document.getElementById('login-btn');
  if (!btn) return;
  if (loading) {
    btn.disabled = true;
    btn.innerHTML = '<svg style="animation:spin .8s linear infinite;width:16px;height:16px" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10" stroke-opacity=".25"/><path d="M12 2a10 10 0 0 1 10 10"/></svg> Entrando...';
    btn.style.background = '#333';
    btn.style.color = '#999';
    btn.style.cursor = 'not-allowed';
  } else {
    btn.disabled = false;
    btn.innerHTML = '🔐 ENTRAR NO SISTEMA';
    btn.style.background = '#fff';
    btn.style.color = '#000';
    btn.style.cursor = 'pointer';
  }
};

window._modoOffline = async function() {
  const erroEl = document.getElementById('login-erro');
  if (erroEl) erroEl.innerHTML = '';

  // ─────────────────────────────────────────────────────────────────────────
  // Funções auxiliares de leitura de sessão
  // ─────────────────────────────────────────────────────────────────────────

  // Firebase v9/v10 compat salva a sessão no IndexedDB:
  //   DB: 'firebaseLocalStorageDb', Store: 'firebaseLocalStorage'
  //   Cada registro tem { fbase_key, value }
  //   onde fbase_key = 'firebase:authUser:<apiKey>:[DEFAULT]'
  function _lerIndexedDB() {
    return new Promise(resolve => {
      try {
        const req = indexedDB.open('firebaseLocalStorageDb');
        req.onerror = () => resolve(null);
        req.onsuccess = ev => {
          try {
            const db = ev.target.result;
            if (!db.objectStoreNames.contains('firebaseLocalStorage')) {
              db.close(); return resolve(null);
            }
            const store = db.transaction('firebaseLocalStorage', 'readonly')
                            .objectStore('firebaseLocalStorage');
            const all = store.getAll();
            all.onsuccess = () => {
              db.close();
              const apiKey = window._firebaseConfig?.apiKey || '';
              const reg = (all.result || []).find(r =>
                r.fbase_key &&
                r.fbase_key.startsWith('firebase:authUser:') &&
                (!apiKey || r.fbase_key.includes(apiKey))
              );
              resolve(reg ? reg.value : null);
            };
            all.onerror = () => { db.close(); resolve(null); };
          } catch(e) { resolve(null); }
        };
      } catch(e) { resolve(null); }
    });
  }

  // Firebase v8 compat (fallback) salva no localStorage
  function _lerLocalStorage() {
    try {
      const apiKey = window._firebaseConfig?.apiKey || '';
      for (let i = 0; i < localStorage.length; i++) {
        const k = localStorage.key(i);
        if (k && k.startsWith('firebase:authUser:') && (!apiKey || k.includes(apiKey))) {
          const raw = localStorage.getItem(k);
          if (raw) return JSON.parse(raw);
        }
      }
    } catch(e) {}
    return null;
  }

  // Aguarda o SDK ter restaurado o currentUser (até 5s)
  // Útil quando o boot já terminou e o Firebase já leu o IndexedDB
  function _lerSDK() {
    return new Promise(resolve => {
      try {
        if (typeof firebase === 'undefined' || !firebase.apps?.length) return resolve(null);
        // Se currentUser já foi preenchido não precisa esperar
        if (firebase.auth().currentUser) return resolve(firebase.auth().currentUser);
        let timer;
        const unsub = firebase.auth().onAuthStateChanged(u => {
          if (u) { clearTimeout(timer); unsub(); resolve(u); }
        });
        timer = setTimeout(() => { unsub(); resolve(null); }, 5000);
      } catch(e) { resolve(null); }
    });
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Sequência de tentativas (mais rápida → mais lenta)
  // ─────────────────────────────────────────────────────────────────────────
  const cachedUser =
    (await _lerIndexedDB())   ||   // v10: IndexedDB (fonte principal)
    _lerLocalStorage()        ||   // v8:  localStorage (fallback legado)
    (await _lerSDK());             // SDK já carregado em memória

  // ─────────────────────────────────────────────────────────────────────────
  // Usuário encontrado → abre o app
  // ─────────────────────────────────────────────────────────────────────────
  if (cachedUser) {
    const uid   = cachedUser.uid   || '';
    const email = cachedUser.email || cachedUser.providerData?.[0]?.email || 'usuário offline';
    const nome  = cachedUser.displayName || email.split('@')[0] || 'Usuário';

    // Emite auth:login para que o handler em app.js/_initLogin processe
    // o login normalmente (esconde tela de login, carrega dados, etc.)
    try {
      window._appEventBus?.emit('auth:login', { user: { uid, email, displayName: nome } });
    } catch(e) {}

    // Fallback direto caso o EventBus ainda não esteja exposto
    const telaLogin = document.getElementById('tela-login');
    const shell     = document.getElementById('app-shell');
    if (telaLogin) telaLogin.style.display = 'none';
    if (shell)     shell.style.display     = 'flex';

    window.toast?.('📴 Modo Offline — bem-vindo, ' + nome + '. Dados em cache carregados.', 'info');
    return;
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Nenhuma sessão encontrada
  // ─────────────────────────────────────────────────────────────────────────
  if (erroEl) {
    erroEl.innerHTML = `
      <div style="background:#fff8e1;border:1px solid #ffc107;border-radius:8px;padding:12px 14px;margin-top:8px;font-size:12px;color:#856404;text-align:left;line-height:1.6">
        <strong>📴 Nenhuma sessão offline encontrada</strong><br>
        Para usar offline você precisa ter feito login pelo menos uma vez com internet.<br>
        <span style="font-size:11px;color:#a07400">O Firebase salva a sessão automaticamente após o primeiro login.</span>
      </div>`;
  }
};

window._abrirConfigFirebase = function() {
  // Navega direto para config sem passar pelo modo offline
  setTimeout(() => window.router?.navigate?.('config'), 100);
};

// Carrega e-mail salvo
(function() {
  try {
    const saved = sessionStorage.getItem('fo_login_email');
    if (saved) {
      const el = document.getElementById('login-email');
      if (el) el.value = saved;
      const label = document.getElementById('login-salvo-label');
      if (label) label.style.display = 'block';
    }
  } catch(e) {}
})();
