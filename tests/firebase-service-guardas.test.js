/**
 * ╔══════════════════════════════════════════════════════════════╗
 * ║  TESTES — firebase/firebase-service.js (guardas de I/O)     ║
 * ║  O incidente do "BM que sumiu" virou teste                  ║
 * ╚══════════════════════════════════════════════════════════════╝
 *
 * Cada teste aqui corresponde a um passo do que aconteceu em 12/08/2026:
 * leitura recusada → dado fabricado na tela → gravação por cima do real.
 * Se algum deles voltar a falhar, a regressão está de volta.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';

import { FirebaseService } from '../firebase/firebase-service.js';
import IntegridadeDados from '../firebase/integridade-dados.js';
import MemCache from '../utils/mem-cache.js';

const OBRA = 'obra-ubs';
const CAMINHO_BMS   = `obras/${OBRA}/bms/bms`;
const CAMINHO_ITENS = `obras/${OBRA}/itens`;

const erroPermissao = Object.assign(
  new Error('Missing or insufficient permissions.'),
  { code: 'permission-denied' }
);

/**
 * Firestore falso: um Map de caminho → dados, mais um conjunto de caminhos
 * que devem recusar leitura/escrita (simulando as Rules).
 */
function criarDbFalso() {
  const dados     = new Map();
  const recusaLer = new Set();
  const recusaGravar = new Set();
  const gravacoes = [];

  function docRef(caminho) {
    return {
      caminho,
      async get() {
        if ([...recusaLer].some(p => caminho.startsWith(p))) throw erroPermissao;
        const existe = dados.has(caminho);
        return { exists: existe, data: () => dados.get(caminho) };
      },
      async set(valor) {
        if ([...recusaGravar].some(p => caminho.startsWith(p))) throw erroPermissao;
        gravacoes.push({ caminho, valor });
        dados.set(caminho, valor);
      },
      async delete() { dados.delete(caminho); },
      async update(campos) {
        if (!dados.has(caminho)) throw Object.assign(new Error('not found'), { code: 'not-found' });
        dados.set(caminho, { ...dados.get(caminho), ...campos });
      },
      collection: (nome) => colRef(`${caminho}/${nome}`),
    };
  }

  function colRef(caminho) {
    return {
      caminho,
      doc: (id) => docRef(`${caminho}/${id}`),
      limit() { return this; },
      orderBy() { return this; },
      where() { return this; },
      async get() {
        if ([...recusaLer].some(p => caminho.startsWith(p))) throw erroPermissao;
        const docs = [...dados.entries()]
          .filter(([k]) => k.startsWith(caminho + '/'))
          .map(([k, v]) => ({ id: k.split('/').pop(), data: () => v }));
        return { empty: docs.length === 0, docs };
      },
    };
  }

  return {
    dados, recusaLer, recusaGravar, gravacoes,
    collection: (nome) => colRef(nome),
    batch() {
      const ops = [];
      return {
        set: (ref, valor) => ops.push({ ref, valor }),
        delete: (ref) => ops.push({ ref, apagar: true }),
        async commit() {
          for (const op of ops) {
            if (op.apagar) await op.ref.delete();
            else await op.ref.set(op.valor);
          }
        },
      };
    },
  };
}

let db;

beforeEach(() => {
  db = criarDbFalso();
  FirebaseService._db    = db;
  FirebaseService._ready = true;
  FirebaseService._auth  = { currentUser: { uid: 'u1' } };
  IntegridadeDados.limpar();
  MemCache.clear();
  vi.spyOn(console, 'error').mockImplementation(() => {});
  vi.spyOn(console, 'info').mockImplementation(() => {});
});

describe('getBMs — leitura recusada nunca vira dado na tela', () => {
  it('documento inexistente devolve o BM 01 em branco (obra nova)', async () => {
    const bms = await FirebaseService.getBMs(OBRA);

    expect(bms).toHaveLength(1);
    expect(bms[0].label).toBe('BM 01');
    expect(IntegridadeDados.degradado('bms', OBRA)).toBe(false);
  });

  it('devolve os BMs gravados quando a leitura funciona', async () => {
    db.dados.set(CAMINHO_BMS, { bms: [{ num: 1, label: 'BM 01' }, { num: 2, label: 'BM 02' }] });

    const bms = await FirebaseService.getBMs(OBRA);

    expect(bms).toHaveLength(2);
    expect(IntegridadeDados.degradado('bms', OBRA)).toBe(false);
  });

  it('REGRESSÃO: leitura recusada NÃO devolve o BM 01 fabricado', async () => {
    // Este era o bug: 8 BMs no servidor, rules recusando a leitura, e a tela
    // exibindo "BM 01" como se a obra fosse nova.
    db.dados.set(CAMINHO_BMS, { bms: [{ num: 1 }, { num: 2 }, { num: 3 }] });
    db.recusaLer.add(CAMINHO_BMS);

    const bms = await FirebaseService.getBMs(OBRA);

    expect(bms).toEqual([]);                                  // e não [{ label: 'BM 01' }]
    expect(IntegridadeDados.degradado('bms', OBRA)).toBe(true);
  });

  it('não guarda em cache o resultado de uma leitura recusada', async () => {
    db.recusaLer.add(CAMINHO_BMS);
    await FirebaseService.getBMs(OBRA);

    // Rules corrigidas: a próxima leitura precisa ir ao servidor de novo.
    db.recusaLer.clear();
    db.dados.set(CAMINHO_BMS, { bms: [{ num: 1 }, { num: 2 }] });

    const bms = await FirebaseService.getBMs(OBRA);
    expect(bms).toHaveLength(2);
    expect(IntegridadeDados.degradado('bms', OBRA)).toBe(false);
  });
});

describe('setBMs — gravação nunca finge que salvou', () => {
  it('grava e resolve quando o Firestore aceita', async () => {
    await expect(FirebaseService.setBMs(OBRA, [{ num: 1 }])).resolves.not.toThrow();
    expect(db.dados.get(CAMINHO_BMS).bms).toHaveLength(1);
  });

  it('REGRESSÃO: gravação recusada REJEITA em vez de resolver em silêncio', async () => {
    // Antes: catch + console.error, promise resolvida, toast "✅ BM criado".
    db.recusaGravar.add(CAMINHO_BMS);

    await expect(FirebaseService.setBMs(OBRA, [{ num: 1 }]))
      .rejects.toMatchObject({ code: 'permission-denied' });
  });

  it('REGRESSÃO: bloqueia a gravação quando a leitura do mesmo dado falhou', async () => {
    // O caminho da perda REAL: leitura recusada → state com 1 BM fabricado →
    // gravação bem-sucedida apagando os 8 BMs verdadeiros.
    db.dados.set(CAMINHO_BMS, { bms: [{ num: 1 }, { num: 2 }, { num: 3 }] });
    db.recusaLer.add(CAMINHO_BMS);
    await FirebaseService.getBMs(OBRA);

    db.recusaLer.clear(); // a escrita passaria pelas rules — mas não pode passar
    await expect(FirebaseService.setBMs(OBRA, [{ num: 1, label: 'BM 01' }]))
      .rejects.toMatchObject({ codigo: 'escrita-bloqueada' });

    // O dado verdadeiro continua intacto no servidor.
    expect(db.dados.get(CAMINHO_BMS).bms).toHaveLength(3);
  });

  it('volta a gravar depois que a leitura é bem-sucedida', async () => {
    db.recusaLer.add(CAMINHO_BMS);
    await FirebaseService.getBMs(OBRA);

    db.recusaLer.clear();
    MemCache.clear();
    await FirebaseService.getBMs(OBRA);          // leitura íntegra libera a barreira

    await expect(FirebaseService.setBMs(OBRA, [{ num: 1 }])).resolves.not.toThrow();
  });

  it('sem Firebase pronto, rejeita em vez de descartar a gravação', async () => {
    FirebaseService._ready = false;

    await expect(FirebaseService.setBMs(OBRA, [{ num: 1 }]))
      .rejects.toMatchObject({ code: 'firebase-indisponivel' });
  });

  it('REGRESSÃO: sem sessão, recusa antes de sair da máquina', async () => {
    // O caso real: sessão perdida, tela populada pelo cache do IndexedDB e
    // toda gravação recusada pelo servidor com um permission-denied genérico.
    FirebaseService._auth = { currentUser: null };

    await expect(FirebaseService.setBMs(OBRA, [{ num: 1 }]))
      .rejects.toMatchObject({ code: 'sessao-expirada' });

    expect(db.dados.has(CAMINHO_BMS)).toBe(false);
  });
});

describe('getItens — planilha truncada é falha, não resultado', () => {
  it('remonta os chunks quando estão todos lá', async () => {
    db.dados.set(`${CAMINHO_ITENS}/_meta`,  { totalChunks: 2 });
    db.dados.set(`${CAMINHO_ITENS}/chunk_0`, { chunk: [{ id: 'a' }, { id: 'b' }] });
    db.dados.set(`${CAMINHO_ITENS}/chunk_1`, { chunk: [{ id: 'c' }] });

    const itens = await FirebaseService.getItens(OBRA);

    expect(itens).toHaveLength(3);
    expect(IntegridadeDados.degradado('itens', OBRA)).toBe(false);
  });

  it('chunk faltando não devolve planilha pela metade', async () => {
    db.dados.set(`${CAMINHO_ITENS}/_meta`,  { totalChunks: 2 });
    db.dados.set(`${CAMINHO_ITENS}/chunk_0`, { chunk: [{ id: 'a' }] });
    // chunk_1 ausente

    const itens = await FirebaseService.getItens(OBRA);

    expect(itens).toEqual([]);
    expect(IntegridadeDados.degradado('itens', OBRA)).toBe(true);
  });

  it('obra sem itens importados é estado legítimo, não falha', async () => {
    const itens = await FirebaseService.getItens(OBRA);

    expect(itens).toEqual([]);
    expect(IntegridadeDados.degradado('itens', OBRA)).toBe(false);
  });
});

describe('setMedicoes — escrita vazia sobre medição existente', () => {
  it('recusa apagar e avisa, em vez de retornar em silêncio', async () => {
    db.dados.set(`obras/${OBRA}/medicoes/bm1`, { v: 3, data: { 'i1': { qtd: 10 } } });

    await expect(FirebaseService.setMedicoes(OBRA, 1, {}))
      .rejects.toMatchObject({ code: 'gravacao-vazia-recusada' });

    expect(db.dados.get(`obras/${OBRA}/medicoes/bm1`).data).toEqual({ 'i1': { qtd: 10 } });
  });

  it('permite apagar quando é a intenção declarada (permitirVazio)', async () => {
    db.dados.set(`obras/${OBRA}/medicoes/bm1`, { v: 3, data: { 'i1': { qtd: 10 } } });

    await FirebaseService.setMedicoes(OBRA, 1, {}, { permitirVazio: true });

    expect(db.dados.get(`obras/${OBRA}/medicoes/bm1`).data).toEqual({});
  });

  it('medições de um BM não bloqueiam as de outro', async () => {
    db.recusaLer.add(`obras/${OBRA}/medicoes/bm7`);
    await FirebaseService.getMedicoes(OBRA, 7);

    expect(IntegridadeDados.degradado('medicoes', OBRA, 'bm7')).toBe(true);
    await expect(FirebaseService.setMedicoes(OBRA, 1, { i1: { qtd: 5 } }))
      .resolves.not.toThrow();
  });
});
