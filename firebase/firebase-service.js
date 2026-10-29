/**
 * ╔══════════════════════════════════════════════════════════════╗
 * ║  FISCAL NA OBRA v15.1 — firebase/firebase-service.js       ║
 * ║  Camada de abstração Firebase (único ponto de acesso)       ║
 * ╚══════════════════════════════════════════════════════════════╝
 *
 * REGRA: Nenhum módulo acessa `window.firebase` diretamente.
 * Toda operação passa por FirebaseService.db.*, auth.*, storage.*
 *
 * Portado e refatorado de: DB (v12), _fbSalvarLogo, _fbSalvarAditivo,
 * firebase.auth().signIn, DB.setObraCfg, DB.setBMs, etc.
 */

import EventBus from '../core/EventBus.js';
import state    from '../core/state.js';
import MemCache from '../utils/mem-cache.js';
import IntegridadeDados from './integridade-dados.js';
import { PAPEL_PADRAO } from '../utils/rbac.js';

// ── Sanitização ────────────────────────────────────────────────
function sanitize(obj) {
  if (obj === null || obj === undefined) return null;
  if (typeof obj !== 'object' || Array.isArray(obj)) return obj;
  const out = {};
  for (const [k, v] of Object.entries(obj)) {
    if (v === undefined) continue;
    if (typeof v === 'object' && v !== null && !Array.isArray(v)) {
      out[k] = sanitize(v);
    } else if (Array.isArray(v)) {
      out[k] = v.map(i => (typeof i === 'object' && i !== null) ? sanitize(i) : i);
    } else {
      out[k] = v;
    }
  }
  return out;
}

// ── Helpers sessionStorage (apenas para configuração de bootstrap — não dados de obra) ──
// MIGRAÇÃO: localStorage removido. Dados de obra persistem exclusivamente no Firestore.
// O Firestore tem enablePersistence() ativo, que usa IndexedDB para cache offline nativo.
// sessionStorage é usado APENAS para dados de inicialização do Firebase (não dados de negócio).
const SS = {
  get(key, def = null) {
    try { const r = sessionStorage.getItem(key); return r !== null ? JSON.parse(r) : def; }
    catch { return def; }
  },
  set(key, val) {
    try { sessionStorage.setItem(key, JSON.stringify(val)); return true; }
    catch { return false; }
  },
  remove(key) {
    try { sessionStorage.removeItem(key); } catch {}
  },
};

// ═══════════════════════════════════════════════════════════════
// FirebaseService
// ═══════════════════════════════════════════════════════════════
class FirebaseServiceClass {
  constructor() {
    this._app       = null;
    this._db        = null;
    this._auth      = null;
    this._storage   = null;
    this._ready     = false;
    this._authUnsub = null;
  }

  // ── Inicialização ───────────────────────────────────────────

  init() {
    try {
      if (!window.firebase || !window.firebase.apps) {
        console.warn('[Firebase] SDK não disponível, modo offline.');
        return;
      }
      // Não re-inicializa se já existe um app
      if (window.firebase.apps.length > 0) {
        this._app     = window.firebase.apps[0];
        this._db      = window.firebase.firestore();
        this._auth    = window.firebase.auth();
        this._storage = window.firebase.storage();
        this._ready   = true;
        this._setupAuthListener();
        this._tryEnablePersistence();
        console.log('[Firebase] Conectado ao projeto:', this._app.options.projectId);
        state.set('firebaseConectado', true);
        state.set('firebaseProjectId', this._app.options.projectId || '');
        EventBus.emit('firebase:conectado', { projectId: this._app.options.projectId });
      }
    } catch (err) {
      console.error('[Firebase] Erro ao inicializar:', err);
    }
  }

  initWithConfig(config) {
    try {
      if (!window.firebase) throw new Error('SDK não carregado');
      // Remove app existente se houver
      if (window.firebase.apps.length > 0) {
        window.firebase.apps[0].delete().catch(() => {});
      }
      this._app     = window.firebase.initializeApp(config);
      this._db      = window.firebase.firestore();
      this._auth    = window.firebase.auth();
      this._storage = window.firebase.storage();
      this._ready   = true;
      this._setupAuthListener();
      this._tryEnablePersistence();

      SS.set('fo_firebase_config', config);
      console.log('[Firebase] Inicializado com config custom:', config.projectId);
      state.set('firebaseConectado', true);
      state.set('firebaseProjectId', config.projectId || '');
      EventBus.emit('firebase:conectado', { projectId: config.projectId });
    } catch (err) {
      console.error('[Firebase] initWithConfig erro:', err);
      throw err;
    }
  }

  _tryEnablePersistence() {
    // Primeiro verifica se o IndexedDB está acessível — Opera GX e browsers
    // com privacidade agressiva (GX Cleaner, modo privado, bloqueadores) podem
    // bloquear o IDBFactory, fazendo o Firebase Auth perder a sessão silenciosamente.
    this._checkIndexedDB().then(idbOk => {
      if (!idbOk) {
        console.warn('[Firebase] IndexedDB indisponível — sessão não persistida. Verifique as configurações de privacidade do browser (Opera GX: desative o GX Cleaner para este site).');
        EventBus.emit('firebase:indexeddb-bloqueado', {});
        return; // Não tenta enablePersistence — evita erro silencioso
      }
      try {
        this._db?.enablePersistence({ synchronizeTabs: true })
          .then(() => console.log('[Firebase] Persistência offline habilitada.'))
          .catch(e => {
            if (e.code === 'failed-precondition') {
              console.warn('[Firebase] Múltiplas abas abertas — persistência desativada nesta aba.');
            } else if (e.code === 'unimplemented') {
              console.warn('[Firebase] Browser não suporta IndexedDB persistência.');
              EventBus.emit('firebase:indexeddb-bloqueado', {});
            }
          });
      } catch {}
    });
  }

  // Testa se o IndexedDB está realmente acessível (Opera GX pode bloquear sem erro visível)
  _checkIndexedDB() {
    return new Promise(resolve => {
      try {
        if (typeof indexedDB === 'undefined' || indexedDB === null) { resolve(false); return; }
        const req = indexedDB.open('_fo_idb_check', 1);
        const timer = setTimeout(() => resolve(false), 1500);
        req.onsuccess = () => {
          clearTimeout(timer);
          try { req.result.close(); indexedDB.deleteDatabase('_fo_idb_check'); } catch {}
          resolve(true);
        };
        req.onerror = () => { clearTimeout(timer); resolve(false); };
        req.onblocked = () => { clearTimeout(timer); resolve(false); };
      } catch { resolve(false); }
    });
  }

  _setupAuthListener() {
    this._authUnsub?.();
    this._authUnsub = this._auth?.onAuthStateChanged(user => {
      if (user) {
        // 'perfil' é o custom claim 'role' do token — o MESMO dado que as
        // Firestore e Storage Rules leem desde 27/10/2026. Enquanto o token
        // não é lido vale PAPEL_PADRAO, igual ao papelPadrao() das rules, para
        // o UI não prometer nem negar diferente do servidor.
        const u = {
          uid:         user.uid,
          email:       user.email,
          displayName: user.displayName,
          perfil:      PAPEL_PADRAO,
          adminGlobal: false,
        };
        state.set('usuarioLogado', u);
        EventBus.emit('auth:login', { user: u });
        this.setObraAtivaId(state.get('obraAtivaId') || '');

        // Ler o claim custa uma volta a mais. Fica fora do caminho do boot de
        // propósito: atrasar o auth:login atrasaria a tela inteira.
        this._carregarPapel(user);
      } else {
        state.set('usuarioLogado', null);
        EventBus.emit('auth:logout', {});
      }
    });
  }

  /**
   * Resolve o papel da conta a partir do custom claim e atualiza o state.
   *
   * Falha aqui não bloqueia nada: o UI segue em PAPEL_PADRAO e o servidor
   * decide de todo jeito. O que não pode acontecer é o inverso — assumir um
   * papel alto que as rules recusam, que é como o modelo anterior enganava
   * o usuário com botão habilitado e "insufficient permissions" no clique.
   */
  async _carregarPapel(user) {
    try {
      const { claims } = await user.getIdTokenResult();
      const atual = state.get('usuarioLogado');
      if (!atual || atual.uid !== user.uid) return;  // sessão já trocou

      const perfil = typeof claims?.role === 'string' ? claims.role : PAPEL_PADRAO;
      state.set('usuarioLogado', {
        ...atual,
        perfil,
        adminGlobal: claims?.adminGlobal === true,
      });
      EventBus.emit('auth:papel-definido', { perfil, adminGlobal: claims?.adminGlobal === true });
    } catch (err) {
      console.warn('[Firebase] papel do token não pôde ser lido:', err?.message || err);
    }
  }

  get isReady() { return this._ready; }
  get db()      { return this._db; }
  get auth()    { return this._auth; }
  get storage() { return this._storage; }

  // ── Auth ────────────────────────────────────────────────────

  async login(email, password) {
    if (!this._auth) throw new Error('Firebase não inicializado');
    return this._auth.signInWithEmailAndPassword(email, password);
  }

  async logout() {
    if (!this._auth) return;
    await this._auth.signOut();
  }

  currentUser() {
    return this._auth?.currentUser || null;
  }

  // ── Obras Lista ─────────────────────────────────────────────

  setObraAtivaId(id) {
    // Persiste apenas no perfil do usuário no Firestore (sem localStorage)
    if (this._ready && this._auth?.currentUser) {
      try {
        this._db.collection('usuarios').doc(this._auth.currentUser.uid)
          .set({ obraAtivaId: id }, { merge: true }).catch(() => {});
      } catch {}
    }
  }

  async getObrasLista() {
    // P4 — cache em memória: evita consulta repetida ao Firebase
    const cached = MemCache.get('obras', null);
    if (cached !== null) return cached;

    // Antes do login não há o que ler — não é falha, é ordem natural do boot.
    if (!this._auth?.currentUser) return [];

    const list = await this._lerColecao({
      dominio: 'obras', obraId: null,
      query:   () => this._db.collection('obras').limit(500),
      // FIX-EXCLUIR: filtra obras com _excluida:true para que obras
      // em soft-delete não reapareçam após F5 ou novo login.
      extrair: snap => snap.docs
        .map(d => ({ id: d.id, ...d.data() }))
        .filter(o => !o._excluida),
    });
    if (!IntegridadeDados.degradado('obras', null)) MemCache.set('obras', null, list);
    return list;
  }

  async salvarObrasLista(lista) {
    MemCache.invalidate('obras'); // P4 — invalida cache ao escrever
    const uid = this._auth?.currentUser?.uid;
    if (!uid) throw new Error('Sem usuário autenticado — a lista de obras não foi gravada.');

    // total: false — cada obra é gravada com merge, nenhuma é substituída.
    return this._gravar({
      dominio: 'obras', obraId: null,
      fn: () => {
        const batch = this._db.batch();
        lista.forEach(o => {
          const ref = this._db.collection('obras').doc(o.id);
          // 'uid' é o DONO da obra, definido uma única vez em criarObra().
          // Aqui ele nunca é reescrito: esta função roda ao concluir, excluir,
          // restaurar e renomear obras, e injetar o uid de quem está salvando
          // transferia a propriedade de TODAS as obras do lote para a última
          // pessoa que mexeu na lista. Omitir o campo deixa o merge preservar
          // o dono gravado; um 'o.uid' vindo do próprio getObrasLista() é o
          // valor que já está lá e grava igual.
          const dados = sanitize({ ...o });
          if (!o.uid) delete dados.uid;
          batch.set(ref, dados, { merge: true });
        });
        return batch.commit();
      },
    });
  }

  async criarObra(id, nome, tipo, cfg, bms, itens) {
    const uid = this._auth?.currentUser?.uid || 'local';
    const doc = sanitize({ id, nome, tipo, uid, criadoEm: new Date().toISOString() });

    // Erro propagado: uma obra "criada" que não chegou ao Firestore some no
    // próximo F5 e leva junto tudo o que for cadastrado nela.
    return this._gravar({
      dominio: 'obras', obraId: id,
      fn: async () => {
        await this._db.collection('obras').doc(id).set(doc);
        await this.setObraCfg(id, cfg, 'Em andamento');
        await this.setBMs(id, bms);
        await this.setItens(id, itens);
      },
    });
  }

  async deleteObra(id) {
    if (!this._ready) return;
    console.log('[DELETE OBRA] Iniciando exclusão:', id);
    try {
      // 1. Invalida todos os caches relacionados à obra ANTES de qualquer operação
      MemCache.invalidate('obras');
      MemCache.invalidate('cfg',      id);
      MemCache.invalidate('bms',      id);
      MemCache.invalidate('itens',    id);
      MemCache.invalidate('medicoes', id);

      // 2. Marca como excluída atomicamente — consultas paralelas já a ignoram
      //    (getObrasLista filtra _excluida:true antes do hard-delete concluir)
      await this._db.collection('obras').doc(id).set(
        { _excluida: true, _excluidaEm: new Date().toISOString() },
        { merge: true }
      );

      // 3. Remove a obra da lista persistida no Firestore
      //    CRÍTICO: sem este passo, salvarObrasLista() chamado por outros fluxos
      //    poderia recriar o documento apagado via batch.set({ merge:true }).
      try {
        const listaAtual = await this.getObrasLista();
        const listaFiltrada = listaAtual.filter(o => o.id !== id);
        if (listaAtual.length !== listaFiltrada.length) {
          await this.salvarObrasLista(listaFiltrada);
          console.log('[DELETE OBRA] Removida da lista persistida no Firestore');
        }
      } catch (eLista) {
        // Não bloqueia a exclusão — obra marcada como _excluida já impede reaparecimento
        console.warn('[DELETE OBRA] Aviso: não foi possível atualizar lista:', eLista.message);
      }

      // 4. Apaga subcoleções em cascata — inclui todas as subcoleções conhecidas
      //    'versoes' e 'lei14133' adicionadas (estavam ausentes na lista anterior)
      const SUBCOLLECTIONS = [
        'cfg', 'bms', 'itens', 'medicoes', 'aditivos',
        'ocorrencias', 'diario', 'notificacoes', 'documentos',
        'historico', 'versoes', 'lei14133',
      ];
      for (const col of SUBCOLLECTIONS) {
        try {
          const snap = await this._db.collection('obras').doc(id).collection(col).get();
          if (!snap.empty) {
            // Firestore limita batch a 500 operações — divide se necessário
            const BATCH_SIZE = 450;
            for (let i = 0; i < snap.docs.length; i += BATCH_SIZE) {
              const batch = this._db.batch();
              snap.docs.slice(i, i + BATCH_SIZE).forEach(d => batch.delete(d.ref));
              await batch.commit();
            }
            console.log(`[DELETE OBRA] Subcoleção '${col}' removida (${snap.docs.length} docs)`);
          }
        } catch (eCol) {
          // Subcoleção pode não existir — não é erro crítico
          console.warn(`[DELETE OBRA] Subcoleção '${col}' ignorada:`, eCol.message);
        }
      }
      console.log('[DELETE OBRA] Subcoleções removidas');

      // 5. Hard-delete do documento principal (deve ser o último passo)
      await this._db.collection('obras').doc(id).delete();
      console.log('[DELETE OBRA] Documento excluído com sucesso:', id);

      // 6. Invalida novamente para garantir cache limpo em qualquer leitura posterior
      MemCache.invalidate('obras');
      MemCache.invalidate('cfg',      id);
      MemCache.invalidate('bms',      id);
      MemCache.invalidate('itens',    id);
      MemCache.invalidate('medicoes', id);

    } catch (err) {
      console.error('[DELETE OBRA] Erro fatal:', err);
      throw err; // propaga para o caller exibir toast de erro
    }
  }

  // ═══════════════════════════════════════════════════════════════
  //  Leitura e escrita guardadas — use SEMPRE estes três helpers
  //
  //  Regra da casa, aprendida na marra (BM sumido em 12/08/2026 e o
  //  histórico do Quadro de Chuvas dias antes):
  //
  //    1. Leitura que falha NUNCA vira dado na tela. Ela devolve o valor
  //       neutro e marca o domínio como degradado — a tela avisa o usuário
  //       em vez de fingir que a obra tem só um BM.
  //    2. Escrita que falha NUNCA resolve a promise. Quem chamou precisa
  //       poder mostrar erro; "✅ salvo" só aparece se salvou mesmo.
  //    3. Escrita que substitui o documento inteiro (total: true) é RECUSADA
  //       enquanto a leitura do mesmo dado estiver degradada. É esta barreira
  //       que impede o estado neutro de ser gravado por cima do dado real.
  // ═══════════════════════════════════════════════════════════════

  /**
   * Leitura guardada de um documento.
   *
   * @param {object}        p
   * @param {string}        p.dominio  chave lógica ('bms', 'itens', 'cfg'…)
   * @param {string}        p.obraId
   * @param {() => object}  p.ref      thunk que devolve a referência Firestore
   * @param {(snap) => any} p.extrair  extrai o dado do snapshot existente
   * @param {any}   p.ausente          valor quando o documento NÃO EXISTE
   *                                   (estado legítimo — obra nova, ano sem chuva)
   * @param {any}   [p.aoFalhar]       valor quando a leitura FALHA
   *                                   (padrão: o mesmo de `ausente`)
   * @param {string}[p.escopo]         unidade dentro do domínio ('bm3', '2026')
   */
  async _lerDoc({ dominio, obraId, ref, extrair, ausente = null, aoFalhar, escopo = '' }) {
    const naFalha = aoFalhar !== undefined ? aoFalhar : ausente;

    if (!this._ready) {
      IntegridadeDados.falhaLeitura(dominio, obraId, {
        code: 'firebase-indisponivel',
        message: 'SDK do Firebase não inicializado — nada foi lido do servidor.',
      }, escopo);
      return naFalha;
    }
    try {
      const snap = await ref().get();
      IntegridadeDados.leituraOk(dominio, obraId, escopo);
      return snap.exists ? extrair(snap) : ausente;
    } catch (err) {
      IntegridadeDados.falhaLeitura(dominio, obraId, err, escopo);
      return naFalha;
    }
  }

  /** Leitura guardada de uma coleção/query. Mesmo contrato do _lerDoc. */
  async _lerColecao({ dominio, obraId, query, extrair, aoFalhar = [], escopo = '' }) {
    const mapear = extrair || (snap => snap.docs.map(d => ({ id: d.id, ...d.data() })));

    if (!this._ready) {
      IntegridadeDados.falhaLeitura(dominio, obraId, {
        code: 'firebase-indisponivel',
        message: 'SDK do Firebase não inicializado — nada foi lido do servidor.',
      }, escopo);
      return aoFalhar;
    }
    try {
      const snap = await query().get();
      IntegridadeDados.leituraOk(dominio, obraId, escopo);
      return mapear(snap);
    } catch (err) {
      IntegridadeDados.falhaLeitura(dominio, obraId, err, escopo);
      return aoFalhar;
    }
  }

  /**
   * Escrita guardada.
   *
   * @param {boolean} [p.total]  true quando a gravação SUBSTITUI o documento
   *                             inteiro do domínio (setBMs, setItens,
   *                             salvarOcorrencias…). Nesse caso a barreira de
   *                             integridade é exigida antes de gravar.
   *                             false para gravações pontuais (um aditivo, uma
   *                             entrada de diário), que não apagam o resto.
   * @throws sempre que a gravação não aconteceu — inclusive quando foi
   *         recusada pela barreira ou quando o Firebase não está disponível.
   */
  async _gravar({ dominio, obraId, fn, total = false, escopo = '' }) {
    if (total) {
      try {
        IntegridadeDados.exigirLeituraIntegra(dominio, obraId, escopo);
      } catch (err) {
        this._falhaEscrita(dominio, obraId, err);
        throw err;
      }
    }

    if (!this._ready) {
      const err = new Error(
        'Firebase indisponível — a gravação NÃO foi feita. Verifique a conexão.'
      );
      err.code = 'firebase-indisponivel';
      this._falhaEscrita(dominio, obraId, err);
      throw err;
    }

    // Sem sessão, TODA regra cai em estaAutenticado() e o servidor devolve
    // permission-denied. Barramos antes de sair da máquina para o usuário ler
    // "sua sessão expirou" em vez de "permissão insuficiente" — que mandava
    // caçar perfil e dono de obra quando o problema era estar deslogado.
    // A leitura continua funcionando nessa situação porque o SDK serve do
    // cache do IndexedDB, e é isso que faz a tela parecer normal.
    if (!this._auth?.currentUser) {
      const err = new Error(
        'Sua sessão expirou — a gravação NÃO foi feita. Entre novamente e refaça.'
      );
      err.code = 'sessao-expirada';
      this._falhaEscrita(dominio, obraId, err);
      throw err;
    }

    try {
      return await fn();
    } catch (err) {
      this._falhaEscrita(dominio, obraId, err);
      throw err;
    }
  }

  /** Ponto único de log + aviso ao usuário para gravação que não aconteceu. */
  _falhaEscrita(dominio, obraId, err) {
    console.error(`[Firebase] gravação de "${dominio}" (obra ${obraId}) NÃO foi feita:`, err);
    EventBus.emit('dados:escrita-falhou', {
      obraId,
      dominio,
      codigo:   err?.code || err?.codigo || 'desconhecido',
      mensagem: err?.message || String(err),
    });
  }

  // ── Config ──────────────────────────────────────────────────

  async setObraCfg(id, cfg, statusObra = 'Em andamento') {
    const data = sanitize({ ...cfg, statusObra, atualizadoEm: new Date().toISOString() });
    MemCache.invalidate('cfg', id); // P4
    return this._gravar({
      dominio: 'cfg', obraId: id, total: true,
      fn: () => this._db.collection('obras').doc(id).collection('cfg').doc('cfg').set(data),
    });
  }

  async getObraCfg(id) {
    // P4 — cache em memória
    const cached = MemCache.get('cfg', id);
    if (cached !== null) return cached;

    const data = await this._lerDoc({
      dominio: 'cfg', obraId: id,
      ref:     () => this._db.collection('obras').doc(id).collection('cfg').doc('cfg'),
      extrair: snap => snap.data(),
      ausente: null,
    });
    if (data) MemCache.set('cfg', id, data);
    return data;
  }

  // ── BMs ─────────────────────────────────────────────────────

  async setBMs(id, bms) {
    const data = sanitize({ bms, atualizadoEm: new Date().toISOString() });
    MemCache.invalidate('bms', id); // P4
    // total: true — este .set() substitui a lista inteira de BMs da obra.
    // Era exatamente aqui que um erro engolido virava "o BM que criei sumiu".
    return this._gravar({
      dominio: 'bms', obraId: id, total: true,
      fn: () => this._db.collection('obras').doc(id).collection('bms').doc('bms').set(data),
    });
  }

  // ── CORREÇÃO v15.1: Salvar BMs + Medições em operação atômica ────────────
  // Antes: setBMs() + setMedicoes() eram chamadas separadas. Em rede instável,
  // uma podia salvar e a outra não, deixando o estado inconsistente.
  // Agora: batch write garante que ambas persistem ou nenhuma.
  //
  // Uso: FirebaseService.setBMsComMedicoes(obraId, bms, bmNum, medicoes)
  async setBMsComMedicoes(obraId, bms, bmNum, medicoes) {
    MemCache.invalidate('bms', obraId);

    if (!this._ready) {
      // Sem SDK não há batch: cai para as duas escritas guardadas, que
      // propagam o erro em vez de fingir que gravaram.
      await this.setBMs(obraId, bms);
      await this.setMedicoes(obraId, bmNum, medicoes);
      return;
    }

    // Exige integridade dos DOIS domínios: o batch substitui a lista de BMs
    // e o documento de medições do BM.
    return this._gravar({
      dominio: 'bms', obraId, total: true,
      fn: async () => {
        IntegridadeDados.exigirLeituraIntegra('medicoes', obraId, `bm${bmNum}`);

        const batch = this._db.batch();

        const bmsRef = this._db
          .collection('obras').doc(obraId)
          .collection('bms').doc('bms');
        batch.set(bmsRef, sanitize({ bms, atualizadoEm: new Date().toISOString() }));

        const medRef = this._db
          .collection('obras').doc(obraId)
          .collection('medicoes').doc(`bm${bmNum}`);
        batch.set(medRef, sanitize({
          v: 3,
          data: sanitize(medicoes),
          atualizadoEm: new Date().toISOString(),
        }));

        await batch.commit();
        console.log(`[Firebase] setBMsComMedicoes BM${bmNum} — batch OK`);
      },
    });
  }

  /**
   * Lista de BMs da obra.
   *
   * `ausente` e `aoFalhar` são DIFERENTES de propósito — é a distinção que
   * faltava e que produziu o incidente do BM sumido:
   *   - documento não existe → obra sem BM cadastrado: devolver o BM 01 em
   *     branco é correto, é o ponto de partida de qualquer obra.
   *   - leitura recusada     → NÃO sabemos quantos BMs existem. Devolver o
   *     BM 01 aqui faz uma obra com 8 BMs parecer uma obra recém-criada.
   *     Devolvemos [] e marcamos o domínio: os callers fazem
   *     `if (bms && bms.length) state.set(...)`, então o state preserva o que
   *     já tinha, e a gravação de BMs fica bloqueada até a leitura voltar.
   */
  async getBMs(id) {
    // P4 — cache em memória
    const cached = MemCache.get('bms', id);
    if (cached !== null) return cached;

    const bms = await this._lerDoc({
      dominio:  'bms', obraId: id,
      ref:      () => this._db.collection('obras').doc(id).collection('bms').doc('bms'),
      extrair:  snap => snap.data().bms || [],
      ausente:  [{ num: 1, label: 'BM 01', mes: '(a definir)', data: '' }],
      aoFalhar: [],
    });
    if (bms.length) MemCache.set('bms', id, bms);
    return bms;
  }

  // ── Itens ───────────────────────────────────────────────────

  async setItens(id, itens) {
    return this._gravar({
      dominio: 'itens', obraId: id, total: true,
      fn: async () => {
        // Itens grandes: chunk de 400 para evitar limite Firestore
        const chunks = [];
        for (let i = 0; i < itens.length; i += 400) {
          chunks.push(itens.slice(i, i + 400));
        }
        const batch = this._db.batch();
        chunks.forEach((chunk, idx) => {
          const ref = this._db.collection('obras').doc(id).collection('itens').doc(`chunk_${idx}`);
          batch.set(ref, sanitize({ chunk, idx, total: chunks.length }));
        });
        // Marca total de chunks
        const metaRef = this._db.collection('obras').doc(id).collection('itens').doc('_meta');
        batch.set(metaRef, { totalChunks: chunks.length, atualizadoEm: new Date().toISOString() });
        await batch.commit();
      },
    });
  }

  /**
   * Itens contratuais, remontados a partir dos chunks de 400.
   *
   * Um chunk faltando é tratado como FALHA, não como "acabaram os itens":
   * devolver a planilha truncada faria o próximo setItens() gravar a versão
   * mutilada por cima da íntegra — perda real, silenciosa e irreversível.
   */
  async getItens(id) {
    if (!this._ready) {
      IntegridadeDados.falhaLeitura('itens', id, {
        code: 'firebase-indisponivel',
        message: 'SDK do Firebase não inicializado — nada foi lido do servidor.',
      });
      return [];
    }
    try {
      const col      = this._db.collection('obras').doc(id).collection('itens');
      const metaSnap = await col.doc('_meta').get();

      if (!metaSnap.exists) {
        // Obra sem itens importados — estado legítimo.
        IntegridadeDados.leituraOk('itens', id);
        return [];
      }

      const { totalChunks } = metaSnap.data();
      const itens = [];
      for (let i = 0; i < totalChunks; i++) {
        const snap = await col.doc(`chunk_${i}`).get();
        if (!snap.exists) {
          throw Object.assign(
            new Error(`chunk_${i} de ${totalChunks} não encontrado — planilha incompleta`),
            { code: 'itens-incompletos' }
          );
        }
        itens.push(...(snap.data().chunk || []));
      }

      IntegridadeDados.leituraOk('itens', id);
      return itens;
    } catch (err) {
      IntegridadeDados.falhaLeitura('itens', id, err);
      return [];
    }
  }

  // ── Medições ────────────────────────────────────────────────

  /**
   * Grava as medições de um BM. ATENÇÃO: usa .set() — substitui o documento.
   *
   * FIX-DATALOSS: última barreira contra apagamento acidental. Se o store
   * recebido está vazio, lê o documento antes de escrever: havendo dados
   * gravados, a escrita é abortada (a menos que opts.permitirVazio seja true).
   * Sem isso, um único salvamento com store vazio — cache frio, autosave fora
   * da tela, race de carregamento — apagava toda a memória de cálculo do BM.
   */
  async setMedicoes(obraId, bmNum, medicoes, opts = {}) {
    const data   = { v: 3, data: sanitize(medicoes), atualizadoEm: new Date().toISOString() };
    const escopo = `bm${bmNum}`;

    return this._gravar({
      dominio: 'medicoes', obraId, escopo, total: true,
      fn: async () => {
        const vazio = !medicoes || typeof medicoes !== 'object' || Object.keys(medicoes).length === 0;
        const ref   = this._db.collection('obras').doc(obraId).collection('medicoes').doc(`bm${bmNum}`);

        if (vazio && !opts.permitirVazio) {
          // Guarda pré-existente (FIX-DATALOSS): store vazio nunca apaga
          // medição gravada. Agora a recusa é audível — lança em vez de
          // retornar em silêncio, senão o autosave "confirma" um apagamento
          // que não aconteceu.
          const snap  = await ref.get();
          const atual = snap.exists ? (snap.data().data || {}) : {};
          if (Object.keys(atual).length > 0) {
            throw Object.assign(
              new Error(
                `Gravação vazia recusada: o BM ${bmNum} tem ${Object.keys(atual).length} ` +
                `registro(s) salvos e a tela veio sem nenhum. Recarregue antes de editar.`
              ),
              { code: 'gravacao-vazia-recusada' }
            );
          }
        }

        await ref.set(sanitize(data));
      },
    });
  }

  async getMedicoes(obraId, bmNum) {
    return this._lerDoc({
      dominio: 'medicoes', obraId, escopo: `bm${bmNum}`,
      ref:     () => this._db.collection('obras').doc(obraId).collection('medicoes').doc(`bm${bmNum}`),
      extrair: snap => snap.data().data || {},
      ausente: {},
    });
  }

  // ── Aditivos ────────────────────────────────────────────────

  async salvarAditivo(obraId, aditivo) {
    MemCache.invalidate('aditivos', obraId); // P4
    const docId = aditivo.id || `adt_${Date.now()}`;
    // total: false — grava UM aditivo; os outros documentos da coleção ficam
    // intactos, então não há o que uma leitura degradada possa destruir aqui.
    return this._gravar({
      dominio: 'aditivos', obraId,
      fn: () => this._db.collection('obras').doc(obraId).collection('aditivos')
                    .doc(docId).set(sanitize({ ...aditivo, id: docId })),
    });
  }

  async getAditivos(obraId) {
    // P4 — cache em memória
    const cached = MemCache.get('aditivos', obraId);
    if (cached !== null) return cached;

    const result = await this._lerColecao({
      dominio: 'aditivos', obraId,
      query:   () => this._db.collection('obras').doc(obraId).collection('aditivos'),
    });
    if (!IntegridadeDados.degradado('aditivos', obraId)) {
      MemCache.set('aditivos', obraId, result);
    }
    return result;
  }

  async deleteAditivo(obraId, aditivoId) {
    MemCache.invalidate('aditivos', obraId); // P4
    return this._gravar({
      dominio: 'aditivos', obraId,
      fn: () => this._db.collection('obras').doc(obraId).collection('aditivos').doc(aditivoId).delete(),
    });
  }

  // ── Ocorrências ─────────────────────────────────────────────

  async salvarOcorrencias(obraId, ocorrencias) {
    MemCache.invalidate('ocorrencias', obraId); // P4
    return this._gravar({
      dominio: 'ocorrencias', obraId, total: true,
      fn: () => this._db.collection('obras').doc(obraId).collection('ocorrencias')
                    .doc('lista').set(sanitize({ lista: ocorrencias })),
    });
  }

  async getOcorrencias(obraId) {
    // P4 — cache em memória
    const cached = MemCache.get('ocorrencias', obraId);
    if (cached !== null) return cached;

    const result = await this._lerDoc({
      dominio: 'ocorrencias', obraId,
      ref:     () => this._db.collection('obras').doc(obraId).collection('ocorrencias').doc('lista'),
      extrair: snap => snap.data().lista || [],
      ausente: [],
    });
    if (!IntegridadeDados.degradado('ocorrencias', obraId)) {
      MemCache.set('ocorrencias', obraId, result);
    }
    return result;
  }

  // ── Chuva ───────────────────────────────────────────────────

  async salvarChuva(obraId, ano, dados) {
    // Erro propagado de propósito: engolir a exceção aqui fazia o Quadro de
    // Chuvas exibir "registro salvo" mesmo quando a escrita era recusada.
    return this._gravar({
      dominio: 'chuva', obraId, escopo: String(ano), total: true,
      fn: () => this._db.collection('obras').doc(obraId).collection('chuva')
                    .doc(String(ano)).set(sanitize({ dados })),
    });
  }

  async getChuva(obraId, ano) {
    return this._lerDoc({
      dominio: 'chuva', obraId, escopo: String(ano),
      ref:     () => this._db.collection('obras').doc(obraId).collection('chuva').doc(String(ano)),
      extrair: snap => snap.data().dados || {},
      ausente: {},
    });
  }

  // ── Diário ──────────────────────────────────────────────────

  async salvarDiario(obraId, diario) {
    return this._gravar({
      dominio: 'diario', obraId, total: true,
      fn: () => this._db.collection('obras').doc(obraId).collection('diario')
                    .doc('lista').set(sanitize({ lista: diario })),
    });
  }

  async getDiario(obraId) {
    return this._lerDoc({
      dominio: 'diario', obraId,
      ref:     () => this._db.collection('obras').doc(obraId).collection('diario').doc('lista'),
      extrair: snap => snap.data().lista || [],
      ausente: [],
    });
  }

  // ── Notificações ────────────────────────────────────────────

  async salvarNotificacoes(obraId, lista) {
    return this._gravar({
      dominio: 'notificacoes', obraId, total: true,
      fn: () => this._db.collection('obras').doc(obraId).collection('notificacoes')
                    .doc('lista').set(sanitize({ lista })),
    });
  }

  async getNotificacoes(obraId) {
    return this._lerDoc({
      dominio: 'notificacoes', obraId,
      ref:     () => this._db.collection('obras').doc(obraId).collection('notificacoes').doc('lista'),
      extrair: snap => snap.data().lista || [],
      ausente: [],
    });
  }

  // ── Documentos ──────────────────────────────────────────────

  async salvarDocumentos(obraId, docs) {
    return this._gravar({
      dominio: 'documentos', obraId, total: true,
      fn: () => this._db.collection('obras').doc(obraId).collection('documentos')
                    .doc('lista').set(sanitize({ lista: docs })),
    });
  }

  async getDocumentos(obraId) {
    return this._lerDoc({
      dominio: 'documentos', obraId,
      ref:     () => this._db.collection('obras').doc(obraId).collection('documentos').doc('lista'),
      extrair: snap => snap.data().lista || [],
      ausente: [],
    });
  }

  // ── Auditoria — API pública (v24.0) ──────────────────────────
  // CORREÇÃO: substitui acesso direto a _db/_ready de módulos externos.
  // Todos os módulos devem chamar FirebaseService.registrarAuditoria()
  // em vez de acessar FirebaseService._db.collection('auditoria') diretamente.

  async registrarAuditoria(obraId, entrada) {
    if (!this._ready || !this._db) return;
    if (!obraId || obraId === '—') return;
    try {
      await this._db
        .collection('obras').doc(obraId)
        .collection('auditoria').doc(entrada.id)
        .set(sanitize(entrada));
    } catch (e) {
      console.warn('[Firebase] registrarAuditoria silenciado:', e?.message);
    }
  }

  async getAuditoria(obraId, limite = 100) {
    if (!this._ready || !this._db) return [];
    try {
      const snap = await this._db
        .collection('obras').doc(obraId)
        .collection('auditoria')
        .orderBy('iso', 'desc')
        .limit(limite)
        .get();
      return snap.docs.map(d => d.data());
    } catch (e) {
      console.warn('[Firebase] getAuditoria:', e?.message);
      return [];
    }
  }

  // Verifica se o serviço Firebase está pronto (API pública — não usar _ready)
  isReady() {
    return this._ready === true;
  }

  // ── Histórico ───────────────────────────────────────────────

  async registrarHistorico(obraId, entry) {
    if (!this._ready) return;
    try {
      await this._db.collection('obras').doc(obraId).collection('historico').add(sanitize(entry));
    } catch (err) {
      console.error('[Firebase] registrarHistorico:', err);
    }
  }

  async salvarHistorico(obraId, dados) {
    // dados = { registros: [...] } — persiste exclusivamente no Firebase
    return this._gravar({
      dominio: 'historico', obraId, total: true,
      fn: () => this._db.collection('obras').doc(obraId).collection('historico')
                    .doc('dados').set(sanitize(dados)),
    });
  }

  async getHistorico(obraId) {
    if (!this._ready) {
      IntegridadeDados.falhaLeitura('historico', obraId, {
        code: 'firebase-indisponivel',
        message: 'SDK do Firebase não inicializado — nada foi lido do servidor.',
      });
      return { registros: [] };
    }
    try {
      const col = this._db.collection('obras').doc(obraId).collection('historico');
      const doc = await col.doc('dados').get();
      if (doc.exists) {
        IntegridadeDados.leituraOk('historico', obraId);
        return doc.data();
      }
      // Estrutura antiga: registros soltos na coleção.
      const snap = await col.orderBy('ts', 'desc').limit(200).get();
      IntegridadeDados.leituraOk('historico', obraId);
      return { registros: snap.docs.map(d => ({ id: d.id, ...d.data() })) };
    } catch (err) {
      IntegridadeDados.falhaLeitura('historico', obraId, err);
      return { registros: [] };
    }
  }

  // ── Usuários ────────────────────────────────────────────────

  async salvarUsuarios(obraId, usuarios) {
    return this._gravar({
      dominio: 'usuarios', obraId, total: true,
      fn: () => this._db.collection('obras').doc(obraId).collection('usuarios')
                    .doc('lista').set(sanitize({ lista: usuarios })),
    });
  }

  async getUsuarios(obraId) {
    return this._lerDoc({
      dominio: 'usuarios', obraId,
      ref:     () => this._db.collection('obras').doc(obraId).collection('usuarios').doc('lista'),
      extrair: snap => snap.data().lista || [],
      ausente: [],
    });
  }

  // ── Fiscais de Obras ────────────────────────────────────────
  async getFiscais(obraId) {
    return this._lerDoc({
      dominio: 'fiscais', obraId,
      ref:     () => this._db.collection('obras').doc(obraId).collection('fiscais').doc('lista'),
      extrair: snap => snap.data().lista || [],
      ausente: [],
    });
  }

  async salvarFiscais(obraId, fiscais) {
    return this._gravar({
      dominio: 'fiscais', obraId, total: true,
      fn: () => this._db.collection('obras').doc(obraId).collection('fiscais')
                    .doc('lista').set(sanitize({ lista: fiscais })),
    });
  }

  // ── Acesso à Obra ────────────────────────────────────────────
  async getAcessoObra(obraId) {
    return this._lerDoc({
      dominio: 'acesso', obraId,
      ref:     () => this._db.collection('obras').doc(obraId).collection('acesso').doc('controle'),
      extrair: snap => snap.data(),
      ausente: { usuarios: [] },
    });
  }

  async salvarAcessoObra(obraId, lista) {
    return this._gravar({
      dominio: 'acesso', obraId, total: true,
      fn: () => this._db.collection('obras').doc(obraId).collection('acesso')
                    .doc('controle').set(sanitize({ usuarios: lista })),
    });
  }

  // ── Versões Contratuais ─────────────────────────────────────

  async salvarVersaoContratual(obraId, versao) {
    // total: false — cada versão é um documento próprio (v1, v2…).
    return this._gravar({
      dominio: 'versoes', obraId,
      fn: () => this._db.collection('obras').doc(obraId).collection('versoes')
                    .doc(`v${versao.numero}`).set(sanitize(versao)),
    });
  }

  async getVersoesContratuais(obraId) {
    return this._lerColecao({
      dominio: 'versoes', obraId,
      query:   () => this._db.collection('obras').doc(obraId).collection('versoes')
                         .orderBy('numero').limit(100),
    });
  }

  // ── Logo / Storage ───────────────────────────────────────────

  async salvarLogo(obraId, base64) {
    // Persiste exclusivamente no Firebase Storage
    if (!this._ready || !this._storage) return base64;
    try {
      const blob = await fetch(base64).then(r => r.blob());
      const ref  = this._storage.ref(`obras/${obraId}/logo`);
      const task = await ref.put(blob);
      const url  = await task.ref.getDownloadURL();
      return url;
    } catch (err) {
      console.error('[Firebase] salvarLogo:', err);
      return base64;
    }
  }

  getLogo(obraId) {
    // Retorna logo do state (carregado durante a inicialização da obra)
    // Para persistência, o logo é armazenado no Firebase Storage.
    return state.get('logoBase64') || '';
  }

  async uploadDocumento(obraId, file, onProgress) {
    if (!this._ready || !this._storage) throw new Error('Storage não disponível.');
    const ref  = this._storage.ref(`obras/${obraId}/docs/${Date.now()}_${file.name}`);
    const task = ref.put(file);
    return new Promise((resolve, reject) => {
      task.on('state_changed',
        snap => onProgress?.(Math.round(snap.bytesTransferred / snap.totalBytes * 100)),
        reject,
        () => task.snapshot.ref.getDownloadURL().then(resolve).catch(reject)
      );
    });
  }

  // ── Atualizar campos específicos da obra ─────────────────────
  async atualizarObra(obraId, campos) {
    // Atualiza campos específicos na lista de obras (ex: statusObra, nome)
    return this._gravar({
      dominio: 'obras', obraId,
      fn: async () => {
        const lista = await this.getObrasLista() || [];
        const idx = lista.findIndex(o => o.id === obraId);
        if (idx >= 0) {
          lista[idx] = { ...lista[idx], ...campos };
          await this.salvarObrasLista(lista);
        }
        // Também atualiza o documento da obra
        try {
          await this._db.collection('obras').doc(obraId).update(campos);
        } catch (e) {
          // 'not-found' é esperado quando a obra ainda só existe na lista;
          // qualquer outro erro (permissão, rede) precisa subir.
          if (e?.code !== 'not-found') throw e;
        }
      },
    });
  }

  // ── Sincronização completa da obra ───────────────────────────

  async sincronizarObra(obraId) {
    try {
      const [cfg, bms, itens, aditivos, ocorrencias, diario, notifs, docs, historico, versoes] = await Promise.all([
        this.getObraCfg(obraId),
        this.getBMs(obraId),
        this.getItens(obraId),
        this.getAditivos(obraId),
        this.getOcorrencias(obraId),
        this.getDiario(obraId),
        this.getNotificacoes(obraId),
        this.getDocumentos(obraId),
        this.getHistorico(obraId),
        this.getVersoesContratuais(obraId),
      ]);
      return { cfg, bms, itens, aditivos, ocorrencias, diario, notificacoes: notifs, documentos: docs, historico, versoesContratuais: versoes };
    } catch (err) {
      console.error('[Firebase] sincronizarObra:', err);
      throw err;
    }
  }

  // ═══════════════════════════════════════════════════════════
  // LIXEIRA FIREBASE — exclusão segura + restauração
  // ═══════════════════════════════════════════════════════════

  /**
   * Soft-delete de obra: move para coleção 'lixeira' no Firestore
   * e marca a obra principal como _excluida:true (não apaga dados).
   * Coleta snapshot completo para restauração fiel.
   */
  async softDeleteObra(obraId, metaExclusao = {}) {
    try {
      // 1. Coleta snapshot completo ANTES de mover.
      //    Se o snapshot não puder ser coletado por inteiro, a exclusão é
      //    abortada: mandar para a lixeira sem dados de restauração é o
      //    mesmo que apagar de vez, só que parecendo reversível.
      const snapshot = await this.sincronizarObra(obraId);

      const degradados = IntegridadeDados.dominiosDegradados(obraId);
      if (degradados.length) {
        throw new Error(
          `Exclusão abortada: não foi possível ler ${degradados.map(d => d.dominio).join(', ')} ` +
          `desta obra, então a cópia de restauração ficaria incompleta. ` +
          `Recarregue a página e tente de novo.`
        );
      }

      // 2. Lê entrada da lista de obras
      const lista   = await this.getObrasLista();
      const obraRef = lista.find(o => o.id === obraId) || { id: obraId };

      // 3. Salva na coleção 'lixeira' do Firestore
      await this.salvarItemLixeiraFirebase({
        id:           `lx_${Date.now()}`,
        tipo:         'obra',
        label:        obraRef.nome || obraId,
        obraId,
        excluidoEm:   new Date().toISOString(),
        excluidoPor:  metaExclusao.excluidoPor  || {},
        moduloOrigem: metaExclusao.moduloOrigem  || 'config',
        dados: { obraRef, snapshot },
      });

      // 4. Marca obra como excluída no Firestore (soft delete — NÃO apaga)
      if (this._ready && this._db) {
        await this._db.collection('obras').doc(obraId).set(
          { _excluida: true, _excluidaEm: new Date().toISOString() },
          { merge: true }
        );
      }

      // 5. Remove da lista ativa (mas mantém dados no Firestore)
      const novaLista = lista.filter(o => o.id !== obraId);
      await this.salvarObrasLista(novaLista);

      return true;
    } catch (err) {
      console.error('[Firebase] softDeleteObra:', err);
      throw err;
    }
  }

  /**
   * Restaura uma obra a partir do snapshot salvo na lixeira.
   */
  async restaurarObra(itemLixeira) {
    try {
      const { obraId, dados } = itemLixeira;
      const { obraRef, snapshot } = dados || {};

      // 1. Reativa a obra no Firestore (remove flag _excluida)
      if (this._ready && this._db) {
        await this._db.collection('obras').doc(obraId).set(
          { _excluida: false, _restauradaEm: new Date().toISOString() },
          { merge: true }
        );
      }

      // 2. Restaura cfg e BMs se houver snapshot
      if (snapshot?.cfg)  await this.setObraCfg(obraId,  snapshot.cfg,  obraRef?.statusObra || 'Em andamento');
      if (snapshot?.bms)  await this.setBMs(obraId,  snapshot.bms);
      if (snapshot?.itens) await this.setItens(obraId, snapshot.itens);

      // 3. Readiciona à lista de obras
      const lista = await this.getObrasLista();
      if (!lista.find(o => o.id === obraId)) {
        const entrada = { id: obraId, nome: obraRef?.nome || obraId, tipo: obraRef?.tipo || 'prefeitura', statusObra: obraRef?.statusObra || 'Em andamento' };
        await this.salvarObrasLista([...lista, entrada]);
      }

      return true;
    } catch (err) {
      console.error('[Firebase] restaurarObra:', err);
      throw err;
    }
  }

  /**
   * Salva qualquer item na coleção 'lixeira' do Firestore (por usuário).
   */
  async salvarItemLixeiraFirebase(item) {
    const uid = this._auth?.currentUser?.uid;
    if (!uid) throw new Error('Sem usuário autenticado — nada foi enviado para a lixeira.');

    // Erro propagado: quem chama (softDeleteObra) precisa ABORTAR a exclusão
    // se o backup não foi gravado. Engolindo aqui, a obra era marcada como
    // excluída e a lixeira ficava sem o que restaurar.
    return this._gravar({
      dominio: 'lixeira', obraId: item.obraId || null,
      fn: () => this._db.collection('lixeira').doc(item.id).set(sanitize({ ...item, uid })),
    });
  }

  /**
   * Busca todos os itens da lixeira do usuário atual no Firestore.
   */
  async getLixeiraFirebase() {
    const uid = this._auth?.currentUser?.uid;
    if (!this._ready || !uid) return [];
    try {
      const snap = await this._db.collection('lixeira').where('uid', '==', uid).orderBy('excluidoEm', 'desc').limit(200).get();
      return snap.docs.map(d => d.data());
    } catch (err) {
      // Se não existir índice, busca sem orderBy
      try {
        const snap2 = await this._db.collection('lixeira').where('uid', '==', uid).limit(200).get();
        return snap2.docs.map(d => d.data()).sort((a, b) => (b.excluidoEm || '').localeCompare(a.excluidoEm || ''));
      } catch { return []; }
    }
  }

  /**
   * Remove um item da lixeira do Firestore (exclusão permanente).
   */
  async removerItemLixeiraFirebase(itemId) {
    return this._gravar({
      dominio: 'lixeira', obraId: null,
      fn: () => this._db.collection('lixeira').doc(itemId).delete(),
    });
  }

  /**
   * Exclusão permanente de obra: apaga do Firestore completamente.
   */
  async deletarObraPermanente(obraId) {
    return this.deleteObra(obraId);
  }

  // ── Lei 14.133/2021 — Responsáveis do Contrato ───────────────────────────
  // Os cinco blocos abaixo (responsáveis, sanções, prorrogações, recebimentos,
  // riscos) são documentos únicos dentro de /lei14133 — .set() substitui a
  // lista inteira, então todos vão com total: true.
  //
  // CORREÇÃO: estes métodos chamavam `this._ss`, que nunca existiu na classe.
  // O rascunho local em sessionStorage era, na verdade, um TypeError em todo
  // caminho de erro — "Cannot read properties of undefined (reading 'set')" —
  // que substituía o erro real e ainda impedia o fallback de acontecer.
  // O helper correto é o SS do topo do arquivo.

  async salvarResponsaveis(obraId, lista) {
    return this._gravarLei14133(obraId, 'responsaveis', `resp_${obraId}`, lista);
  }
  async getResponsaveis(obraId) {
    return this._lerLei14133(obraId, 'responsaveis', `resp_${obraId}`);
  }

  // ── Lei 14.133/2021 — Sanções Administrativas ────────────────────────────
  async salvarSancoes(obraId, lista) {
    return this._gravarLei14133(obraId, 'sancoes', `sanc_${obraId}`, lista);
  }
  async getSancoes(obraId) {
    return this._lerLei14133(obraId, 'sancoes', `sanc_${obraId}`);
  }

  // ── Lei 14.133/2021 — Prorrogações de Prazo ──────────────────────────────
  async salvarProrrogacoes(obraId, lista) {
    return this._gravarLei14133(obraId, 'prorrogacoes', `prorr_${obraId}`, lista);
  }
  async getProrrogacoes(obraId) {
    return this._lerLei14133(obraId, 'prorrogacoes', `prorr_${obraId}`);
  }

  // ── Lei 14.133/2021 — Recebimento Provisório e Definitivo ───────────────
  async salvarRecebimentos(obraId, lista) {
    return this._gravarLei14133(obraId, 'recebimentos', `receb_${obraId}`, lista);
  }
  async getRecebimentos(obraId) {
    return this._lerLei14133(obraId, 'recebimentos', `receb_${obraId}`);
  }

  // ── Lei 14.133/2021 — Matriz de Riscos ───────────────────────────────────
  async salvarRiscos(obraId, lista) {
    return this._gravarLei14133(obraId, 'riscos', `riscos_${obraId}`, lista);
  }
  async getRiscos(obraId) {
    return this._lerLei14133(obraId, 'riscos', `riscos_${obraId}`);
  }

  // ── Documento-único-com-lista: helpers genéricos ────────────────────────
  //
  // Vários módulos (Lei 14.133, PAC, qualidade, fotos) guardam a coleção
  // inteira num único documento. O .set() substitui tudo, então são sempre
  // total: true. O rascunho em sessionStorage existe para o usuário não perder
  // o que digitou — mas nunca substitui o aviso de que a gravação falhou.

  /** Grava o documento; salva rascunho local e propaga o erro se não gravar. */
  async _gravarDocLista({ obraId, dominio, ref, dados, chaveSS, rascunho }) {
    try {
      return await this._gravar({
        dominio, obraId, total: true,
        fn: () => ref().set({ ...dados, updatedAt: new Date().toISOString() }),
      });
    } catch (err) {
      if (chaveSS) SS.set(chaveSS, rascunho);
      throw err;
    }
  }

  /** Lê o documento; só cai no rascunho local quando a leitura FALHA. */
  async _lerDocLista({ obraId, dominio, ref, campo = 'lista', chaveSS }) {
    const lista = await this._lerDoc({
      dominio, obraId, ref,
      extrair:  snap => snap.data()[campo] || [],
      ausente:  [],
      aoFalhar: null, // null distingue "falhou" de "não existe"
    });
    if (lista !== null) return lista;
    return (chaveSS ? SS.get(chaveSS) : null) || [];
  }

  _gravarLei14133(obraId, doc, chaveSS, lista) {
    return this._gravarDocLista({
      obraId, dominio: doc, chaveSS, rascunho: lista, dados: { lista },
      ref: () => this._db.collection('obras').doc(obraId).collection('lei14133').doc(doc),
    });
  }

  _lerLei14133(obraId, doc, chaveSS) {
    return this._lerDocLista({
      obraId, dominio: doc, chaveSS,
      ref: () => this._db.collection('obras').doc(obraId).collection('lei14133').doc(doc),
    });
  }

  // ── Listeners em tempo real — onSnapshot (FIX-E3.4) ─────────────────────────
  // Cada método retorna a função de unsubscribe.
  // Chamar no destroy() do módulo para evitar memory leaks.
  // O callback recebe o array de dados atualizado.
  // Usa debounce interno de 400ms para evitar re-renders excessivos
  // quando múltiplos usuários editam ao mesmo tempo.

  _watchDebounce(fn, ms = 400) {
    let t = null;
    return (...args) => {
      clearTimeout(t);
      t = setTimeout(() => fn(...args), ms);
    };
  }

  /**
   * Escuta ocorrências em tempo real.
   * FIX-E3.4: substitui o padrão poll (reload ao entrar na página)
   * por listener persistente — alterações de outros usuários aparecem
   * automaticamente sem precisar sair e voltar na tela.
   */
  watchOcorrencias(obraId, callback) {
    if (!this._ready || !this._db) return () => {};
    const debouncedCb = this._watchDebounce(callback);
    try {
      // Tenta novo formato (docs individuais)
      return this._db
        .collection('obras').doc(obraId)
        .collection('ocorrencias')
        .orderBy('data', 'desc')
        .onSnapshot(snap => {
          const docs = snap.docs
            .filter(d => d.id !== 'lista')
            .map(d => ({ id: d.id, ...d.data() }));
          // Se sem docs individuais, pode ser formato legado — não emite vazio
          if (docs.length > 0) debouncedCb(docs);
        }, err => console.warn('[Firebase] watchOcorrencias:', err));
    } catch (e) {
      console.warn('[Firebase] watchOcorrencias setup:', e);
      return () => {};
    }
  }

  /**
   * Escuta entradas do diário em tempo real.
   */
  watchDiario(obraId, callback) {
    if (!this._ready || !this._db) return () => {};
    const debouncedCb = this._watchDebounce(callback);
    try {
      return this._db
        .collection('obras').doc(obraId)
        .collection('diario')
        .orderBy('data', 'desc')
        .limit(100)
        .onSnapshot(snap => {
          const docs = snap.docs
            .filter(d => d.id !== 'lista')
            .map(d => ({ id: d.id, ...d.data() }));
          if (docs.length > 0) debouncedCb(docs);
        }, err => console.warn('[Firebase] watchDiario:', err));
    } catch (e) {
      console.warn('[Firebase] watchDiario setup:', e);
      return () => {};
    }
  }

  /**
   * Escuta configuração/contrato da obra em tempo real.
   * Útil quando o gestor altera o contrato enquanto o fiscal está na tela de BM.
   */
  watchCfg(obraId, callback) {
    if (!this._ready || !this._db) return () => {};
    const debouncedCb = this._watchDebounce(callback, 800);
    try {
      return this._db
        .collection('obras').doc(obraId)
        .collection('cfg').doc('cfg')
        .onSnapshot(snap => {
          if (snap.exists) debouncedCb(snap.data());
        }, err => console.warn('[Firebase] watchCfg:', err));
    } catch (e) {
      console.warn('[Firebase] watchCfg setup:', e);
      return () => {};
    }
  }

  // ── Diário — documentos individuais (FIX-E2.2) ──────────────────────────────
  // Nova estrutura: cada entrada é um doc separado em obras/{id}/diario/{entradaId}
  // Compatibilidade: lê o formato antigo (lista) e o novo (docs) ao mesmo tempo.

  async addDiarioEntrada(obraId, entrada) {
    if (!this._ready || !this._db) return;
    try {
      const id  = entrada.id || `d_${Date.now()}`;
      const ref = this._db.collection('obras').doc(obraId)
                    .collection('diario').doc(id);
      await ref.set(sanitize({ ...entrada, id }));
    } catch (e) { console.error('[Firebase] addDiarioEntrada:', e); throw e; }
  }

  async updateDiarioEntrada(obraId, entrada) {
    if (!this._ready || !this._db) return;
    try {
      const ref = this._db.collection('obras').doc(obraId)
                    .collection('diario').doc(entrada.id);
      await ref.set(sanitize(entrada), { merge: true });
    } catch (e) { console.error('[Firebase] updateDiarioEntrada:', e); throw e; }
  }

  async deleteDiarioEntrada(obraId, entradaId) {
    if (!this._ready || !this._db) return;
    try {
      await this._db.collection('obras').doc(obraId)
               .collection('diario').doc(entradaId).delete();
    } catch (e) { console.error('[Firebase] deleteDiarioEntrada:', e); throw e; }
  }

  async getDiarioPaginado(obraId, limite = 100) {
    if (!this._ready || !this._db) return [];
    try {
      const snap = await this._db.collection('obras').doc(obraId)
        .collection('diario')
        .orderBy('data', 'desc')
        .limit(limite)
        .get();
      if (!snap.empty) {
        const docs = snap.docs.filter(d => d.id !== 'lista').map(d => ({ id: d.id, ...d.data() }));
        if (docs.length > 0) return docs;
      }
      // Fallback: formato antigo (array no doc 'lista')
      return this.getDiario(obraId);
    } catch (e) {
      console.error('[Firebase] getDiarioPaginado:', e);
      return this.getDiario(obraId);
    }
  }

  // ── Ocorrências — documentos individuais (FIX-E2.2) ──────────────────────

  async addOcorrencia(obraId, ocorrencia) {
    if (!this._ready || !this._db) return;
    try {
      const id  = ocorrencia.id || `oc_${Date.now()}`;
      const ref = this._db.collection('obras').doc(obraId)
                    .collection('ocorrencias').doc(id);
      await ref.set(sanitize({ ...ocorrencia, id }));
    } catch (e) { console.error('[Firebase] addOcorrencia:', e); throw e; }
  }

  async updateOcorrencia(obraId, ocorrencia) {
    if (!this._ready || !this._db) return;
    try {
      const ref = this._db.collection('obras').doc(obraId)
                    .collection('ocorrencias').doc(ocorrencia.id);
      await ref.set(sanitize(ocorrencia), { merge: true });
    } catch (e) { console.error('[Firebase] updateOcorrencia:', e); throw e; }
  }

  async deleteOcorrencia(obraId, ocorrenciaId) {
    if (!this._ready || !this._db) return;
    try {
      await this._db.collection('obras').doc(obraId)
               .collection('ocorrencias').doc(ocorrenciaId).delete();
    } catch (e) { console.error('[Firebase] deleteOcorrencia:', e); throw e; }
  }

  async getOcorrenciasPaginado(obraId, limite = 200) {
    if (!this._ready || !this._db) return [];
    try {
      const snap = await this._db.collection('obras').doc(obraId)
        .collection('ocorrencias')
        .orderBy('data', 'desc')
        .limit(limite)
        .get();
      if (!snap.empty) {
        const docs = snap.docs.filter(d => d.id !== 'lista').map(d => ({ id: d.id, ...d.data() }));
        if (docs.length > 0) return docs;
      }
      return this.getOcorrencias(obraId);
    } catch (e) {
      console.error('[Firebase] getOcorrenciasPaginado:', e);
      return this.getOcorrencias(obraId);
    }
  }

  // ── Upload de foto para Firebase Storage (FIX-E2.1) ─────────────────────────
  // Converte dataUrl (base64) para Blob e faz upload para Storage.
  // path: subpasta dentro de obras/{obraId}/ — ex: 'fotos-medicao', 'ocorrencias'
  // Retorna downloadURL ou o dataUrl original se Storage indisponível.
  async uploadFotoStorage(obraId, dataUrl, path = 'fotos-medicao') {
    if (!this._ready || !this._storage) return dataUrl; // fallback offline
    if (!dataUrl || !dataUrl.startsWith('data:')) return dataUrl; // já é URL
    try {
      const blob = await fetch(dataUrl).then(r => r.blob());
      const ext  = blob.type.includes('png') ? 'png' : 'jpg';
      const ref  = this._storage.ref(`obras/${obraId}/${path}/${Date.now()}.${ext}`);
      const task = await ref.put(blob);
      return await task.ref.getDownloadURL();
    } catch (err) {
      console.error('[Firebase] uploadFotoStorage:', err);
      return dataUrl; // fallback: mantém base64 se upload falhar
    }
  }

  // ── PAC / Obras Federais — Fotos de Medição ──────────────────────────────
  salvarFotosMedicao(obraId, lista) {
    return this._gravarDocLista({
      obraId, dominio: 'fotos-medicao', chaveSS: `fotos_med_${obraId}`,
      rascunho: lista, dados: { lista },
      ref: () => this._db.collection('obras').doc(obraId).collection('fotos-medicao').doc('lista'),
    });
  }
  getFotosMedicao(obraId) {
    return this._lerDocLista({
      obraId, dominio: 'fotos-medicao', chaveSS: `fotos_med_${obraId}`,
      ref: () => this._db.collection('obras').doc(obraId).collection('fotos-medicao').doc('lista'),
    });
  }

  // ── PAC / Obras Federais — Checklist Técnico ─────────────────────────────
  salvarChecklistTecnico(obraId, lista) {
    return this._gravarDocLista({
      obraId, dominio: 'checklist-tecnico', chaveSS: `ck_tec_${obraId}`,
      rascunho: lista, dados: { lista },
      ref: () => this._db.collection('obras').doc(obraId).collection('checklist-tecnico').doc('registros'),
    });
  }
  getChecklistTecnico(obraId) {
    return this._lerDocLista({
      obraId, dominio: 'checklist-tecnico', chaveSS: `ck_tec_${obraId}`,
      ref: () => this._db.collection('obras').doc(obraId).collection('checklist-tecnico').doc('registros'),
    });
  }

  // ── PAC / Obras Federais — Etapas PAC ────────────────────────────────────
  salvarEtapasPac(obraId, etapas) {
    return this._gravarDocLista({
      obraId, dominio: 'etapas-pac', chaveSS: `etapas_pac_${obraId}`,
      rascunho: etapas, dados: { etapas },
      ref: () => this._db.collection('obras').doc(obraId).collection('etapas-pac').doc('lista'),
    });
  }
  getEtapasPac(obraId) {
    return this._lerDocLista({
      obraId, dominio: 'etapas-pac', chaveSS: `etapas_pac_${obraId}`, campo: 'etapas',
      ref: () => this._db.collection('obras').doc(obraId).collection('etapas-pac').doc('lista'),
    });
  }

  // ── Prazos — Cronograma de Atividades (Curva S) ──────────────────────────
  salvarCronograma(obraId, lista) {
    return this._gravarDocLista({
      obraId, dominio: 'cronograma', chaveSS: `cronograma_${obraId}`,
      rascunho: lista, dados: { lista },
      ref: () => this._db.collection('obras').doc(obraId).collection('lei14133').doc('cronograma'),
    });
  }
  getCronograma(obraId) {
    return this._lerDocLista({
      obraId, dominio: 'cronograma', chaveSS: `cronograma_${obraId}`,
      ref: () => this._db.collection('obras').doc(obraId).collection('lei14133').doc('cronograma'),
    });
  }

  // ── PAC / Obras Federais — Controle de Qualidade ─────────────────────────
  salvarQualidade(obraId, lista) {
    return this._gravarDocLista({
      obraId, dominio: 'qualidade', chaveSS: `qualidade_${obraId}`,
      rascunho: lista, dados: { lista },
      ref: () => this._db.collection('obras').doc(obraId).collection('qualidade').doc('registros'),
    });
  }
  getQualidade(obraId) {
    return this._lerDocLista({
      obraId, dominio: 'qualidade', chaveSS: `qualidade_${obraId}`,
      ref: () => this._db.collection('obras').doc(obraId).collection('qualidade').doc('registros'),
    });
  }
}

export const FirebaseService = new FirebaseServiceClass();
export default FirebaseService;

// ── Alias global DB para compatibilidade v12 ─────────────────────
if (typeof window !== 'undefined') {
  window.DB = FirebaseService;
}
// FIX-E2.1: substitui o padrão base64-no-Firestore por URL do Storage.
// Usado por fotos-medicao, ocorrencias, diario e modo-campo.
// Retorna a downloadURL (string). Em caso de falha retorna o dataUrl original
// como fallback para não perder o dado.
