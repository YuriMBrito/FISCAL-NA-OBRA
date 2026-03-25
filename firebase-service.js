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
    try {
      this._db?.enablePersistence({ synchronizeTabs: true })
        .then(() => console.log('[Firebase] Persistência offline habilitada.'))
        .catch(e => {
          if (e.code === 'failed-precondition') console.warn('[Firebase] Múltiplas abas abertas.');
          else if (e.code === 'unimplemented') console.warn('[Firebase] Persistência não suportada.');
        });
    } catch {}
  }

  _setupAuthListener() {
    this._authUnsub?.();
    this._authUnsub = this._auth?.onAuthStateChanged(user => {
      if (user) {
        const u = { uid: user.uid, email: user.email, displayName: user.displayName };
        state.set('usuarioLogado', u);
        EventBus.emit('auth:login', { user: u });
        this.setObraAtivaId(state.get('obraAtivaId') || '');
      } else {
        state.set('usuarioLogado', null);
        EventBus.emit('auth:logout', {});
      }
    });
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

  async getObrasLista(uidOverride) {
    // P4 — cache em memória: evita consulta repetida ao Firebase
    const cached = MemCache.get('obras', null);
    if (cached !== null) return cached;

    // FIX-SAFARI: em Safari/Firefox, currentUser pode estar null no momento exato
    // em que auth:login é emitido pelo onAuthStateChanged, pois o IndexedDB ainda
    // não completou a hidratação da sessão. Aceitamos um uid externo do evento
    // para contornar essa race condition sem alterar o fluxo de autenticação.
    const uid = uidOverride || this._auth?.currentUser?.uid;
    if (!this._ready || !uid) {
      return []; // Sem Firebase disponível: retorna lista vazia (offline usa cache Firestore nativo)
    }
    try {
      const snap = await this._db.collection('obras')
        .where('uid', '==', uid).limit(500).get();
      if (snap.empty) return [];
      // FIX-EXCLUIR: filtra obras com _excluida:true para que obras
      // em soft-delete não reapareçam após F5 ou novo login.
      const list = snap.docs
        .map(d => ({ id: d.id, ...d.data() }))
        .filter(o => !o._excluida);
      MemCache.set('obras', null, list);
      return list;
    } catch (err) {
      console.error('[Firebase] getObrasLista:', err);
      return []; // Firestore offline persistence (IndexedDB) cobre o modo offline
    }
  }

  async salvarObrasLista(lista) {
    MemCache.invalidate('obras'); // P4 — invalida cache ao escrever
    const uid = this._auth?.currentUser?.uid;
    if (!this._ready || !uid) return;
    try {
      const batch = this._db.batch();
      lista.forEach(o => {
        const ref = this._db.collection('obras').doc(o.id);
        batch.set(ref, sanitize({ ...o, uid }), { merge: true });
      });
      await batch.commit();
    } catch (err) {
      console.error('[Firebase] salvarObrasLista:', err);
    }
  }

  async criarObra(id, nome, tipo, cfg, bms, itens) {
    const uid = this._auth?.currentUser?.uid || 'local';
    const doc = sanitize({ id, nome, tipo, uid, criadoEm: new Date().toISOString() });

    // Dados persistem exclusivamente no Firebase (sem localStorage)
    if (!this._ready) return;
    try {
      await this._db.collection('obras').doc(id).set(doc);
      await this.setObraCfg(id, cfg, 'Em andamento');
      await this.setBMs(id, bms);
      await this.setItens(id, itens);
    } catch (err) {
      console.error('[Firebase] criarObra:', err);
    }
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

  // ── Config ──────────────────────────────────────────────────

  async setObraCfg(id, cfg, statusObra = 'Em andamento') {
    const data = sanitize({ ...cfg, statusObra, atualizadoEm: new Date().toISOString() });
    MemCache.invalidate('cfg', id); // P4
    if (!this._ready) return;
    try {
      await this._db.collection('obras').doc(id).collection('cfg').doc('cfg').set(data);
    } catch (err) {
      console.error('[Firebase] setObraCfg:', err);
    }
  }

  async getObraCfg(id) {
    // P4 — cache em memória
    const cached = MemCache.get('cfg', id);
    if (cached !== null) return cached;

    if (this._ready) {
      try {
        const snap = await this._db.collection('obras').doc(id).collection('cfg').doc('cfg').get();
        if (snap.exists) {
          const data = snap.data();
          MemCache.set('cfg', id, data);
          return data;
        }
      } catch (err) {
        console.error('[Firebase] getObraCfg:', err);
      }
    }
    return null; // Firestore offline persistence cobre o modo offline
  }

  // ── BMs ─────────────────────────────────────────────────────

  async setBMs(id, bms) {
    const data = sanitize({ bms, atualizadoEm: new Date().toISOString() });
    MemCache.invalidate('bms', id); // P4
    if (!this._ready) return;
    try {
      await this._db.collection('obras').doc(id).collection('bms').doc('bms').set(data);
    } catch (err) {
      console.error('[Firebase] setBMs:', err);
    }
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
      // Offline: salva em memória (Firestore persistence sincroniza depois)
      await this.setBMs(obraId, bms);
      await this.setMedicoes(obraId, bmNum, medicoes);
      return;
    }
    try {
      const batch = this._db.batch();

      // BMs
      const bmsRef = this._db
        .collection('obras').doc(obraId)
        .collection('bms').doc('bms');
      batch.set(bmsRef, sanitize({ bms, atualizadoEm: new Date().toISOString() }));

      // Medições do BM
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
    } catch (err) {
      console.error('[Firebase] setBMsComMedicoes:', err);
      throw err; // propaga para o caller exibir toast de erro
    }
  }

  async getBMs(id) {
    // P4 — cache em memória
    const cached = MemCache.get('bms', id);
    if (cached !== null) return cached;

    if (this._ready) {
      try {
        const snap = await this._db.collection('obras').doc(id).collection('bms').doc('bms').get();
        if (snap.exists) {
          const bms = snap.data().bms || [];
          MemCache.set('bms', id, bms);
          return bms;
        }
      } catch (err) {
        console.error('[Firebase] getBMs:', err);
      }
    }
    return [{ num: 1, label: 'BM 01', mes: '(a definir)', data: '' }];
  }

  // ── Itens ───────────────────────────────────────────────────

  async setItens(id, itens) {
    if (!this._ready) return;
    try {
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
    } catch (err) {
      console.error('[Firebase] setItens:', err);
    }
  }

  async getItens(id) {
    if (this._ready) {
      try {
        const metaSnap = await this._db.collection('obras').doc(id).collection('itens').doc('_meta').get();
        if (metaSnap.exists) {
          const { totalChunks } = metaSnap.data();
          const itens = [];
          for (let i = 0; i < totalChunks; i++) {
            const snap = await this._db.collection('obras').doc(id).collection('itens').doc(`chunk_${i}`).get();
            if (snap.exists) itens.push(...(snap.data().chunk || []));
          }
          return itens;
        }
      } catch (err) {
        console.error('[Firebase] getItens:', err);
      }
    }
    return []; // Firestore offline persistence cobre o modo offline
  }

  // ── Medições ────────────────────────────────────────────────

  async setMedicoes(obraId, bmNum, medicoes) {
    const data = { v: 3, data: sanitize(medicoes), atualizadoEm: new Date().toISOString() };
    if (!this._ready) return;
    try {
      await this._db.collection('obras').doc(obraId).collection('medicoes').doc(`bm${bmNum}`).set(sanitize(data));
    } catch (err) {
      console.error('[Firebase] setMedicoes:', err);
    }
  }

  async getMedicoes(obraId, bmNum) {
    if (this._ready) {
      try {
        const snap = await this._db.collection('obras').doc(obraId).collection('medicoes').doc(`bm${bmNum}`).get();
        if (snap.exists) {
          const raw = snap.data().data || {};
          return raw;
        }
      } catch (err) {
        console.error('[Firebase] getMedicoes:', err);
      }
    }
    return {}; // Firestore offline persistence (IndexedDB) cobre o modo offline
  }

  // ── Aditivos ────────────────────────────────────────────────

  async salvarAditivo(obraId, aditivo) {
    MemCache.invalidate('aditivos', obraId); // P4
    if (!this._ready) return;
    try {
      const docId = aditivo.id || `adt_${Date.now()}`;
      await this._db.collection('obras').doc(obraId).collection('aditivos').doc(docId).set(sanitize({ ...aditivo, id: docId }));
    } catch (err) {
      console.error('[Firebase] salvarAditivo:', err);
      throw err;
    }
  }

  async getAditivos(obraId) {
    // P4 — cache em memória
    const cached = MemCache.get('aditivos', obraId);
    if (cached !== null) return cached;

    if (!this._ready) return [];
    try {
      const snap = await this._db.collection('obras').doc(obraId).collection('aditivos').get();
      const result = snap.docs.map(d => ({ id: d.id, ...d.data() }));
      MemCache.set('aditivos', obraId, result);
      return result;
    } catch (err) {
      console.error('[Firebase] getAditivos:', err);
      return [];
    }
  }

  async deleteAditivo(obraId, aditivoId) {
    MemCache.invalidate('aditivos', obraId); // P4
    if (!this._ready) return;
    try {
      await this._db.collection('obras').doc(obraId).collection('aditivos').doc(aditivoId).delete();
    } catch (err) {
      console.error('[Firebase] deleteAditivo:', err);
    }
  }

  // ── Ocorrências ─────────────────────────────────────────────

  async salvarOcorrencias(obraId, ocorrencias) {
    MemCache.invalidate('ocorrencias', obraId); // P4
    if (!this._ready) return;
    try {
      await this._db.collection('obras').doc(obraId).collection('ocorrencias').doc('lista').set(sanitize({ lista: ocorrencias }));
    } catch (err) {
      console.error('[Firebase] salvarOcorrencias:', err);
    }
  }

  async getOcorrencias(obraId) {
    // P4 — cache em memória
    const cached = MemCache.get('ocorrencias', obraId);
    if (cached !== null) return cached;

    if (!this._ready) return [];
    try {
      const snap = await this._db.collection('obras').doc(obraId).collection('ocorrencias').doc('lista').get();
      const result = snap.exists ? (snap.data().lista || []) : [];
      MemCache.set('ocorrencias', obraId, result);
      return result;
    } catch (err) {
      console.error('[Firebase] getOcorrencias:', err);
      return [];
    }
  }

  // ── Chuva ───────────────────────────────────────────────────

  async salvarChuva(obraId, ano, dados) {
    if (!this._ready) return;
    try {
      await this._db.collection('obras').doc(obraId).collection('chuva').doc(String(ano)).set(sanitize({ dados }));
    } catch (err) {
      console.error('[Firebase] salvarChuva:', err);
    }
  }

  async getChuva(obraId, ano) {
    if (!this._ready) return {};
    try {
      const snap = await this._db.collection('obras').doc(obraId).collection('chuva').doc(String(ano)).get();
      return snap.exists ? (snap.data().dados || {}) : {};
    } catch (err) {
      console.error('[Firebase] getChuva:', err);
      return {};
    }
  }

  // ── Diário ──────────────────────────────────────────────────

  async salvarDiario(obraId, diario) {
    if (!this._ready) return;
    try {
      await this._db.collection('obras').doc(obraId).collection('diario').doc('lista').set(sanitize({ lista: diario }));
    } catch (err) {
      console.error('[Firebase] salvarDiario:', err);
    }
  }

  async getDiario(obraId) {
    if (!this._ready) return [];
    try {
      const snap = await this._db.collection('obras').doc(obraId).collection('diario').doc('lista').get();
      return snap.exists ? (snap.data().lista || []) : [];
    } catch (err) {
      console.error('[Firebase] getDiario:', err);
      return [];
    }
  }

  // ── Notificações ────────────────────────────────────────────

  async salvarNotificacoes(obraId, lista) {
    if (!this._ready) return;
    try {
      await this._db.collection('obras').doc(obraId).collection('notificacoes').doc('lista').set(sanitize({ lista }));
    } catch (err) {
      console.error('[Firebase] salvarNotificacoes:', err);
    }
  }

  async getNotificacoes(obraId) {
    if (!this._ready) return [];
    try {
      const snap = await this._db.collection('obras').doc(obraId).collection('notificacoes').doc('lista').get();
      return snap.exists ? (snap.data().lista || []) : [];
    } catch (err) {
      console.error('[Firebase] getNotificacoes:', err);
      return [];
    }
  }

  // ── Documentos ──────────────────────────────────────────────

  async salvarDocumentos(obraId, docs) {
    if (!this._ready) return;
    try {
      await this._db.collection('obras').doc(obraId).collection('documentos').doc('lista').set(sanitize({ lista: docs }));
    } catch (err) {
      console.error('[Firebase] salvarDocumentos:', err);
    }
  }

  async getDocumentos(obraId) {
    if (!this._ready) return [];
    try {
      const snap = await this._db.collection('obras').doc(obraId).collection('documentos').doc('lista').get();
      return snap.exists ? (snap.data().lista || []) : [];
    } catch (err) {
      console.error('[Firebase] getDocumentos:', err);
      return [];
    }
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
    if (!this._ready) return;
    try {
      await this._db.collection('obras').doc(obraId).collection('historico').doc('dados').set(sanitize(dados));
    } catch (err) { console.error('[Firebase] salvarHistorico:', err); }
  }

  async getHistorico(obraId) {
    if (!this._ready) {
      return { registros: [] }; // Firestore offline persistence cobre o modo offline
    }
    try {
      const doc = await this._db.collection('obras').doc(obraId).collection('historico').doc('dados').get();
      if (doc.exists) return doc.data();
      // fallback: try old structure
      const snap = await this._db.collection('obras').doc(obraId).collection('historico').orderBy('ts','desc').limit(200).get().catch(()=>null);
      const registros = snap ? snap.docs.map(d=>({id:d.id,...d.data()})) : [];
      return { registros };
    } catch (err) {
      console.error('[Firebase] getHistorico:', err);
      return { registros: [] };
    }
  }

  // ── Usuários ────────────────────────────────────────────────

  async salvarUsuarios(obraId, usuarios) {
    if (!this._ready) return;
    try {
      await this._db.collection('obras').doc(obraId).collection('usuarios').doc('lista').set(sanitize({ lista: usuarios }));
    } catch (err) {
      console.error('[Firebase] salvarUsuarios:', err);
    }
  }

  async getUsuarios(obraId) {
    if (!this._ready) return [];
    try {
      const snap = await this._db.collection('obras').doc(obraId).collection('usuarios').doc('lista').get();
      return snap.exists ? (snap.data().lista || []) : [];
    } catch (err) {
      console.error('[Firebase] getUsuarios:', err);
      return [];
    }
  }

  // ── Fiscais de Obras ────────────────────────────────────────
  async getFiscais(obraId) {
    if (!this._ready) return [];
    try {
      const snap = await this._db.collection('obras').doc(obraId).collection('fiscais').doc('lista').get();
      return snap.exists ? (snap.data().lista || []) : [];
    } catch (err) {
      console.error('[Firebase] getFiscais:', err);
      return [];
    }
  }

  async salvarFiscais(obraId, fiscais) {
    if (!this._ready) return;
    try {
      await this._db.collection('obras').doc(obraId).collection('fiscais').doc('lista').set(sanitize({ lista: fiscais }));
    } catch (err) {
      console.error('[Firebase] salvarFiscais:', err);
    }
  }

  // ── Acesso à Obra ────────────────────────────────────────────
  async getAcessoObra(obraId) {
    if (!this._ready) return { usuarios: [] };
    try {
      const snap = await this._db.collection('obras').doc(obraId).collection('acesso').doc('controle').get();
      return snap.exists ? snap.data() : { usuarios: [] };
    } catch (err) {
      console.error('[Firebase] getAcessoObra:', err);
      return { usuarios: [] };
    }
  }

  async salvarAcessoObra(obraId, lista) {
    if (!this._ready) return;
    try {
      await this._db.collection('obras').doc(obraId).collection('acesso').doc('controle').set(sanitize({ usuarios: lista }));
    } catch (err) {
      console.error('[Firebase] salvarAcessoObra:', err);
    }
  }

  // ── Versões Contratuais ─────────────────────────────────────

  async salvarVersaoContratual(obraId, versao) {
    if (!this._ready) return;
    try {
      await this._db.collection('obras').doc(obraId).collection('versoes')
        .doc(`v${versao.numero}`).set(sanitize(versao));
    } catch (err) {
      console.error('[Firebase] salvarVersaoContratual:', err);
    }
  }

  async getVersoesContratuais(obraId) {
    if (!this._ready) return [];
    try {
      const snap = await this._db.collection('obras').doc(obraId).collection('versoes')
        .orderBy('numero').limit(100).get();
      return snap.docs.map(d => ({ id: d.id, ...d.data() }));
    } catch (err) {
      console.error('[Firebase] getVersoesContratuais:', err);
      return [];
    }
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
    try {
      const lista = await this.getObrasLista() || [];
      const idx = lista.findIndex(o => o.id === obraId);
      if (idx >= 0) {
        lista[idx] = { ...lista[idx], ...campos };
        await this.salvarObrasLista(lista);
      }
      // Também atualiza a coleção de obras no Firebase se disponível
      if (this._ready && this._db) {
        try {
          await this._db.collection('obras').doc(obraId).update(campos);
        } catch(e) { /* ignora se doc não existir */ }
      }
    } catch (err) {
      console.error('[Firebase] atualizarObra:', err);
    }
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
      // 1. Coleta snapshot completo ANTES de mover
      let snapshot = {};
      try { snapshot = await this.sincronizarObra(obraId); } catch {}

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
    if (!this._ready || !uid) return;
    try {
      const sanitized = sanitize({ ...item, uid });
      await this._db.collection('lixeira').doc(item.id).set(sanitized);
    } catch (err) {
      console.error('[Firebase] salvarItemLixeiraFirebase:', err);
    }
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
    if (!this._ready) return;
    try {
      await this._db.collection('lixeira').doc(itemId).delete();
    } catch (err) {
      console.error('[Firebase] removerItemLixeiraFirebase:', err);
    }
  }

  /**
   * Exclusão permanente de obra: apaga do Firestore completamente.
   */
  async deletarObraPermanente(obraId) {
    return this.deleteObra(obraId);
  }

  // ── Lei 14.133/2021 — Responsáveis do Contrato ───────────────────────────
  async salvarResponsaveis(obraId, lista) {
    if (!this._ready || !this._db) { this._ss.set(`resp_${obraId}`, lista); return; }
    try { await this._db.collection('obras').doc(obraId).collection('lei14133').doc('responsaveis').set({ lista, updatedAt: new Date().toISOString() }); }
    catch (e) { console.error('[Firebase] salvarResponsaveis:', e); this._ss.set(`resp_${obraId}`, lista); }
  }
  async getResponsaveis(obraId) {
    if (!this._ready || !this._db) return this._ss.get(`resp_${obraId}`) || [];
    try { const s = await this._db.collection('obras').doc(obraId).collection('lei14133').doc('responsaveis').get(); return s.exists ? (s.data().lista || []) : []; }
    catch (e) { console.error('[Firebase] getResponsaveis:', e); return this._ss.get(`resp_${obraId}`) || []; }
  }

  // ── Lei 14.133/2021 — Sanções Administrativas ────────────────────────────
  async salvarSancoes(obraId, lista) {
    if (!this._ready || !this._db) { this._ss.set(`sanc_${obraId}`, lista); return; }
    try { await this._db.collection('obras').doc(obraId).collection('lei14133').doc('sancoes').set({ lista, updatedAt: new Date().toISOString() }); }
    catch (e) { console.error('[Firebase] salvarSancoes:', e); this._ss.set(`sanc_${obraId}`, lista); }
  }
  async getSancoes(obraId) {
    if (!this._ready || !this._db) return this._ss.get(`sanc_${obraId}`) || [];
    try { const s = await this._db.collection('obras').doc(obraId).collection('lei14133').doc('sancoes').get(); return s.exists ? (s.data().lista || []) : []; }
    catch (e) { console.error('[Firebase] getSancoes:', e); return this._ss.get(`sanc_${obraId}`) || []; }
  }

  // ── Lei 14.133/2021 — Prorrogações de Prazo ──────────────────────────────
  async salvarProrrogacoes(obraId, lista) {
    if (!this._ready || !this._db) { this._ss.set(`prorr_${obraId}`, lista); return; }
    try { await this._db.collection('obras').doc(obraId).collection('lei14133').doc('prorrogacoes').set({ lista, updatedAt: new Date().toISOString() }); }
    catch (e) { console.error('[Firebase] salvarProrrogacoes:', e); this._ss.set(`prorr_${obraId}`, lista); }
  }
  async getProrrogacoes(obraId) {
    if (!this._ready || !this._db) return this._ss.get(`prorr_${obraId}`) || [];
    try { const s = await this._db.collection('obras').doc(obraId).collection('lei14133').doc('prorrogacoes').get(); return s.exists ? (s.data().lista || []) : []; }
    catch (e) { console.error('[Firebase] getProrrogacoes:', e); return this._ss.get(`prorr_${obraId}`) || []; }
  }

  // ── Lei 14.133/2021 — Recebimento Provisório e Definitivo ───────────────
  async salvarRecebimentos(obraId, lista) {
    if (!this._ready || !this._db) { this._ss.set(`receb_${obraId}`, lista); return; }
    try { await this._db.collection('obras').doc(obraId).collection('lei14133').doc('recebimentos').set({ lista, updatedAt: new Date().toISOString() }); }
    catch (e) { console.error('[Firebase] salvarRecebimentos:', e); this._ss.set(`receb_${obraId}`, lista); }
  }
  async getRecebimentos(obraId) {
    if (!this._ready || !this._db) return this._ss.get(`receb_${obraId}`) || [];
    try { const s = await this._db.collection('obras').doc(obraId).collection('lei14133').doc('recebimentos').get(); return s.exists ? (s.data().lista || []) : []; }
    catch (e) { console.error('[Firebase] getRecebimentos:', e); return this._ss.get(`receb_${obraId}`) || []; }
  }

  // ── Lei 14.133/2021 — Matriz de Riscos ───────────────────────────────────
  async salvarRiscos(obraId, lista) {
    if (!this._ready || !this._db) { this._ss.set(`riscos_${obraId}`, lista); return; }
    try { await this._db.collection('obras').doc(obraId).collection('lei14133').doc('riscos').set({ lista, updatedAt: new Date().toISOString() }); }
    catch (e) { console.error('[Firebase] salvarRiscos:', e); this._ss.set(`riscos_${obraId}`, lista); }
  }
  async getRiscos(obraId) {
    if (!this._ready || !this._db) return this._ss.get(`riscos_${obraId}`) || [];
    try { const s = await this._db.collection('obras').doc(obraId).collection('lei14133').doc('riscos').get(); return s.exists ? (s.data().lista || []) : []; }
    catch (e) { console.error('[Firebase] getRiscos:', e); return this._ss.get(`riscos_${obraId}`) || []; }
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
  async salvarFotosMedicao(obraId, lista) {
    if (!this._ready || !this._db) { this._ss.set(`fotos_med_${obraId}`, lista); return; }
    try { await this._db.collection('obras').doc(obraId).collection('fotos-medicao').doc('lista').set({ lista, updatedAt: new Date().toISOString() }); }
    catch (e) { console.error('[Firebase] salvarFotosMedicao:', e); this._ss.set(`fotos_med_${obraId}`, lista); }
  }
  async getFotosMedicao(obraId) {
    if (!this._ready || !this._db) return this._ss.get(`fotos_med_${obraId}`) || [];
    try { const s = await this._db.collection('obras').doc(obraId).collection('fotos-medicao').doc('lista').get(); return s.exists ? (s.data().lista || []) : []; }
    catch (e) { console.error('[Firebase] getFotosMedicao:', e); return this._ss.get(`fotos_med_${obraId}`) || []; }
  }

  // ── PAC / Obras Federais — Checklist Técnico ─────────────────────────────
  async salvarChecklistTecnico(obraId, lista) {
    if (!this._ready || !this._db) { this._ss.set(`ck_tec_${obraId}`, lista); return; }
    try { await this._db.collection('obras').doc(obraId).collection('checklist-tecnico').doc('registros').set({ lista, updatedAt: new Date().toISOString() }); }
    catch (e) { console.error('[Firebase] salvarChecklistTecnico:', e); this._ss.set(`ck_tec_${obraId}`, lista); }
  }
  async getChecklistTecnico(obraId) {
    if (!this._ready || !this._db) return this._ss.get(`ck_tec_${obraId}`) || [];
    try { const s = await this._db.collection('obras').doc(obraId).collection('checklist-tecnico').doc('registros').get(); return s.exists ? (s.data().lista || []) : []; }
    catch (e) { console.error('[Firebase] getChecklistTecnico:', e); return this._ss.get(`ck_tec_${obraId}`) || []; }
  }

  // ── PAC / Obras Federais — Etapas PAC ────────────────────────────────────
  async salvarEtapasPac(obraId, etapas) {
    if (!this._ready || !this._db) { this._ss.set(`etapas_pac_${obraId}`, etapas); return; }
    try { await this._db.collection('obras').doc(obraId).collection('etapas-pac').doc('lista').set({ etapas, updatedAt: new Date().toISOString() }); }
    catch (e) { console.error('[Firebase] salvarEtapasPac:', e); this._ss.set(`etapas_pac_${obraId}`, etapas); }
  }
  async getEtapasPac(obraId) {
    if (!this._ready || !this._db) return this._ss.get(`etapas_pac_${obraId}`) || [];
    try { const s = await this._db.collection('obras').doc(obraId).collection('etapas-pac').doc('lista').get(); return s.exists ? (s.data().etapas || []) : []; }
    catch (e) { console.error('[Firebase] getEtapasPac:', e); return this._ss.get(`etapas_pac_${obraId}`) || []; }
  }

  // ── PAC / Obras Federais — Controle de Qualidade ─────────────────────────
  async salvarQualidade(obraId, lista) {
    if (!this._ready || !this._db) { this._ss.set(`qualidade_${obraId}`, lista); return; }
    try { await this._db.collection('obras').doc(obraId).collection('qualidade').doc('registros').set({ lista, updatedAt: new Date().toISOString() }); }
    catch (e) { console.error('[Firebase] salvarQualidade:', e); this._ss.set(`qualidade_${obraId}`, lista); }
  }
  async getQualidade(obraId) {
    if (!this._ready || !this._db) return this._ss.get(`qualidade_${obraId}`) || [];
    try { const s = await this._db.collection('obras').doc(obraId).collection('qualidade').doc('registros').get(); return s.exists ? (s.data().lista || []) : []; }
    catch (e) { console.error('[Firebase] getQualidade:', e); return this._ss.get(`qualidade_${obraId}`) || []; }
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
