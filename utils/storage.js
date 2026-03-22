/**
 * ╔══════════════════════════════════════════════════════════════╗
 * ║  FISCAL NA OBRA v15.1 — utils/storage.js                     ║
 * ║  MIGRADO: localStorage removido — dados exclusivamente      ║
 * ║  no Firestore via FirebaseService                           ║
 * ╚══════════════════════════════════════════════════════════════╝
 */

import FirebaseService from '../firebase/firebase-service.js';

export const storageUtils = {

  keys: {
    obraAtivaId: ()       => 'obra_ativa_id_v1',
    obrasLista:  ()       => 'obras_lista_v1',
    cfg:         (id)     => `cfg_${id}`,
    bms:         (id)     => `bms_${id}`,
    itens:       (id)     => `itens_${id}`,
    medicoes:    (id, n)  => `med_${id}_bm${n}`,
    logo:        (id)     => `logo_${id}`,
    lixeira:     ()       => 'lixeira_v1',
    chuva:       (id, a)  => `chuva_${id}_${a}`,
    diario:      (id)     => `diario_${id}`,
    notifs:      (id)     => `notificacoes_${id}`,
    ocorrencias: (id)     => `ocorrencias_${id}`,
    historico:   (id)     => `historico_${id}`,
    documentos:  (id)     => `documentos_${id}`,
    aditivos:    (id)     => `aditivos_${id}`,
    usuarios:    (id)     => `usuarios_${id}`,
    versoes:     (id)     => `versoes_${id}`,
  },

  // noop — dados vão exclusivamente para o Firebase
  get(key, defaultValue = null) { return defaultValue; },
  set(key, value)               { return false; },
  remove(key)                   { /* noop */ },
  has(key)                      { return false; },

  // Lixeira — persiste no Firestore
  lixeiraEnviar(tipo, label, dados, meta = {}) {
    const obraId = meta.obraId || dados?.obraId || null;
    if (!obraId) return;
    const item = {
      id:           `lx_${Date.now()}`,
      tipo, label, dados,
      excluidoEm:   new Date().toISOString(),
      excluidoPor:  meta.excluidoPor  || { uid: '', email: 'desconhecido', nome: 'Usuário desconhecido' },
      moduloOrigem: meta.moduloOrigem || tipo,
      obraId,
    };
    FirebaseService.salvarItemLixeiraFirebase?.(item).catch(() => {});
  },

  lixeiraGetAll()    { return []; },
  lixeiraRemover(id) { /* delegado ao config-controller via FirebaseService */ },
  lixeiraLimpar()    { /* noop */ },
};

export default storageUtils;
