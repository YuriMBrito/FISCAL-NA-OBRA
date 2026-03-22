/**
 * FISCAL NA OBRA — js/login-controller.js
 * Lógica da tela de login: toggle, abas, Google Auth, estado de loading.
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

// ── Login com Google (Firebase GoogleAuthProvider) ──────────────
window._loginGoogle = async function() {
  // CORREÇÃO v15.3: botão agora usa data-action="_loginGoogle", não onclick.
  // querySelector por onclick foi removido — busca pelo data-action.
  const btnGoogle = document.querySelector('button[data-action="_loginGoogle"]');
  const erroEl    = document.getElementById('login-erro');

  if (erroEl) erroEl.innerHTML = '';

  // Verifica se o Firebase está pronto
  if (!window.firebase || !window.firebase.apps || !window.firebase.apps.length) {
    if (erroEl) erroEl.innerHTML = '❌ Firebase não inicializado. Verifique a conexão.';
    return;
  }

  // Desabilita botão durante o processo
  if (btnGoogle) {
    btnGoogle.disabled = true;
    btnGoogle.innerHTML = '<svg style="animation:spin .8s linear infinite;width:16px;height:16px" viewBox="0 0 24 24" fill="none" stroke="#ccc" stroke-width="2"><circle cx="12" cy="12" r="10" stroke-opacity=".25"/><path d="M12 2a10 10 0 0 1 10 10"/></svg> Aguardando Google...';
  }

  try {
    const provider = new window.firebase.auth.GoogleAuthProvider();
    provider.addScope('email');
    provider.addScope('profile');
    // Força seleção de conta mesmo que já esteja logado
    provider.setCustomParameters({ prompt: 'select_account' });

    // Tenta popup primeiro (melhor UX no Chrome)
    await window.firebase.auth().signInWithPopup(provider);
    // Sucesso: o onAuthStateChanged do FirebaseService dispara auth:login

  } catch (err) {
    const code = err?.code || '';

    if (code === 'auth/popup-blocked' || code === 'auth/popup-closed-by-user') {
      // Chrome bloqueou o popup → fallback para redirect
      if (erroEl) erroEl.innerHTML = '↩️ Redirecionando para login Google...';
      try {
        const provider2 = new window.firebase.auth.GoogleAuthProvider();
        provider2.setCustomParameters({ prompt: 'select_account' });
        await window.firebase.auth().signInWithRedirect(provider2);
        // Página será recarregada; o resultado é capturado em _verificarRedirectGoogle()
        return;
      } catch (e2) {
        if (erroEl) erroEl.innerHTML = '❌ Não foi possível abrir o Google. Tente novamente.';
      }
    } else if (code === 'auth/account-exists-with-different-credential') {
      if (erroEl) erroEl.innerHTML = '❌ Este e-mail já está associado a outro método de login.';
    } else if (code === 'auth/cancelled-popup-request') {
      // Usuário fechou o popup — silencioso
    } else if (code === 'auth/network-request-failed') {
      if (erroEl) erroEl.innerHTML = '🌐 Sem conexão. Verifique sua internet.';
    } else if (code === 'auth/unauthorized-domain') {
      if (erroEl) erroEl.innerHTML = '❌ Domínio não autorizado. Configure o Firebase Console.';
    } else if (err?.message) {
      if (erroEl) erroEl.innerHTML = `❌ ${err.message}`;
    }

    console.error('[LoginGoogle]', code, err?.message);
  } finally {
    // Restaura botão
    if (btnGoogle) {
      btnGoogle.disabled = false;
      btnGoogle.innerHTML = `<svg width="16" height="16" viewBox="0 0 24 24"><path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"/><path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"/><path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l3.66 2.84z"/><path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84z"/></svg> Entrar com Google`;
    }
  }
};

// ── Captura resultado do signInWithRedirect (após retornar do Google) ──
window._verificarRedirectGoogle = async function() {
  if (!window.firebase || !window.firebase.apps || !window.firebase.apps.length) return;
  try {
    const result = await window.firebase.auth().getRedirectResult();
    if (result && result.user) {
      // Autenticado via redirect — o onAuthStateChanged já vai disparar auth:login
      console.log('[LoginGoogle] Redirect OK:', result.user.email);
    }
  } catch (err) {
    const erroEl = document.getElementById('login-erro');
    if (erroEl && err?.code !== 'auth/no-auth-event') {
      erroEl.innerHTML = '❌ Falha no login com Google. Tente novamente.';
    }
    console.error('[LoginGoogle] getRedirectResult:', err?.code, err?.message);
  }
};

// Executa verificação de redirect assim que o Firebase estiver pronto
if (window._firebaseSDKReady) {
  window._firebaseSDKReady.then(() => {
    // Aguarda a inicialização do FirebaseService pelo app.js
    setTimeout(window._verificarRedirectGoogle, 1500);
  });
}

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
