/**
 * ╔══════════════════════════════════════════════════════════════╗
 * ║  FISCAL NA OBRA v15.1 — modules/boletim-medicao/bm-calculos.js ║
 * ║  Motor de cálculos de medição (portado fiel do v12)         ║
 * ╚══════════════════════════════════════════════════════════════╝
 *
 * Portado de: classUnd(), calcDimensional(), _fxCalc(),
 *   sumLinhasQtd(), getQtdAcumuladoTotalItem(),
 *   getValorAcumuladoTotal(), fmtNum() etc.
 */

import state           from '../../core/state.js';
import { formatters }  from '../../utils/formatters.js';
import FirebaseService from '../../firebase/firebase-service.js';
import MemCache        from '../../utils/mem-cache.js';
import { safe }        from '../../utils/calc-guard.js';

// ── Implementações canônicas (fonte única de verdade) ─────────
// HIGH-05: as definições locais de classUnd / calcDimensional / fxCalc
// foram removidas — o módulo agora importa e re-exporta as versões
// de utils/, eliminando divergência silenciosa entre cópias.
import { classUnd }                 from '../../utils/unit-normalizer.js';
import { calcDimensional, fxCalc }  from '../../utils/formula-engine.js';
export { classUnd, calcDimensional, fxCalc };

// ── fmtNum (portado do v12 — trunca ou arredonda) ─────────────
function fmtNum(val, decimals = 2) {
  return formatters.number(val, decimals);
}

// ── Funções de leitura/escrita de medições ────────────────────

export function getLinhasItem(med, itemId) {
  const pack = med?.[itemId];
  if (!pack || !Array.isArray(pack.lines)) return [];
  return pack.lines;
}

export function getFxFormula(med, itemId) {
  return (med && med[itemId] && typeof med[itemId].fxFormula === 'string')
    ? med[itemId].fxFormula.trim() : '';
}

export function sumLinhasQtd(und, lines, fxFormula) {
  const total = (lines || []).reduce((acc, ln) => {
    let lineResult = 0;
    if (fxFormula) {
      const { result } = fxCalc(fxFormula, ln.comp, ln.larg, ln.alt, ln.qtd);
      lineResult = isFinite(result) ? result : 0;
    } else {
      const r = calcDimensional(und, ln.comp, ln.larg, ln.alt, ln.qtd);
      lineResult = isFinite(r.qtdCalc) ? r.qtdCalc : 0;
    }
    return acc + lineResult;
  }, 0);
  return isFinite(total) ? total : 0;
}

// ── Geração de ID único ───────────────────────────────────────
export function novoId(prefix = 'ln') {
  return `${prefix}_${Math.random().toString(16).slice(2)}_${Date.now().toString(16)}`;
}

/**
 * Retorna o BDI efetivo para um item, considerando tipoBdi por item se existir.
 * Acórdão TCU 2.622/2013 e Súmula TCU 254: equipamentos, materiais e subempreitada
 * devem ter BDI diferenciado (menor) em relação a serviços normais.
 *
 * tipoBdi:
 *   'integral'     — serviços (usa cfg.bdi)
 *   'reduzido'     — equipamentos/materiais (usa cfg.bdiReduzido ou 10% como fallback)
 *   'zero'         — fornecimento direto pela Administração (BDI = 0)
 *   undefined/''   — herda cfg.bdi (comportamento original)
 *
 * @param {object} item — item da planilha ({ up, tipoBdi, ... })
 * @param {object} cfg  — configuração da obra ({ bdi, bdiReduzido, ... })
 * @returns {number}    — BDI fracionário (ex: 0.25 para 25%)
 */
export function getBdiEfetivo(item, cfg) {
  const bdiGlobal   = safe(cfg?.bdi,        0.25);
  const bdiReduzido = safe(cfg?.bdiReduzido, 0.10);
  switch (item?.tipoBdi) {
    case 'reduzido': return bdiReduzido;
    case 'zero':     return 0;
    default:         return bdiGlobal;
  }
}

// ── Cache de medições em memória ─────────────────────────────
// CRIT-03: substituído objeto simples (sem limite) por MemCache com
//   TTL de 30 min e LRU cap de 200 entradas — elimina vazamento de memória.
// MED-01: _acumCache memoriza resultados de getQtdAcumuladoTotalItem por
//   render-cycle; é invalidado sempre que os dados de medição mudam.

/** Mapa de memoização para acumulados — escopo de sessão, invalidação por obraId. */
const _acumCache = new Map();

/**
 * FIX-E3.1: cache de valor financeiro — análogo ao _acumCache de quantidade.
 * getValorAcumuladoTotal é O(n×m) sem memoização: para uma obra com 12 BMs e
 * 300 itens, cada chamada faz 3.600 operações. Com este cache, o resultado é
 * reutilizado no mesmo render-cycle e invalidado junto com _acumCache sempre
 * que medições são salvas ou injetadas.
 */
const _valorCache = new Map();

export function _clearAcumCache(obraId) {
  if (obraId) {
    for (const k of _acumCache.keys()) {
      if (k.startsWith(obraId + ':')) _acumCache.delete(k);
    }
    // FIX-E3.1: invalida cache de valor junto com cache de quantidade
    for (const k of _valorCache.keys()) {
      if (k.startsWith(obraId + ':')) _valorCache.delete(k);
    }
  } else {
    _acumCache.clear();
    _valorCache.clear(); // FIX-E3.1
  }
}

export function getMedicoes(obraId, bmNum) {
  return MemCache.get('medicoes', obraId, String(bmNum)) ?? {};
}

export function salvarMedicoes(obraId, bmNum, medicoes) {
  MemCache.set('medicoes', obraId, medicoes, String(bmNum));
  _clearAcumCache(obraId);
  // Persiste exclusivamente no Firebase
  FirebaseService.setMedicoes(obraId, bmNum, medicoes).catch(e =>
    console.error('[bm-calculos] salvarMedicoes Firebase:', e)
  );
}

/** Popula o cache em memória SEM disparar escrita no Firebase.
 *  Usado pelo controller ao carregar medições do Firestore. */
export function _injetarCacheMedicoes(obraId, bmNum, medicoes) {
  MemCache.set('medicoes', obraId, medicoes, String(bmNum));
  _clearAcumCache(obraId);
}

export function invalidarCacheMedicoes(obraId) {
  MemCache.invalidate('medicoes', obraId);
  _clearAcumCache(obraId);
}

// ── Helper: filtra linhas que originaram num BM específico ───
/**
 * Retorna apenas as linhas de um item que foram criadas/medidas
 * no BM indicado (usando o campo bmOrigem de cada linha).
 * Linhas sem bmOrigem são tratadas como pertencentes ao BM
 * em que estão armazenadas (fallbackBm).
 */
function getLinhasOriginBm(med, itemId, bmNum) {
  const pack = med?.[itemId];
  if (!pack || !Array.isArray(pack.lines)) return [];
  return pack.lines.filter(ln => {
    const origem = (typeof ln.bmOrigem === 'number' && isFinite(ln.bmOrigem))
      ? ln.bmOrigem
      : bmNum; // fallback: pertence ao BM que as armazena
    return origem === bmNum;
  });
}

// ── Medição Atual de um item em um BM específico ─────────────
/**
 * Retorna a quantidade medida APENAS no BM indicado para o item,
 * desconsiderando linhas importadas de outros BMs.
 */
export function getQtdMedicaoItemNoBm(obraId, bmNum, itemId, itensContrato) {
  const it = itensContrato.find(x => x.id === itemId && !x.t);
  if (!it) return 0;
  const med = getMedicoes(obraId, bmNum);
  const ownLines = getLinhasOriginBm(med, itemId, bmNum);
  const total = sumLinhasQtd(it.und, ownLines, getFxFormula(med, itemId));
  return isFinite(total) ? total : 0;
}

// ── Getters de quantidade ─────────────────────────────────────

/**
 * Acumulado Total = soma da Medição Atual do item em todos os BMs
 * de 1 até bmNum.
 *
 * MED-01: resultados são memoizados em _acumCache por (obraId, bmNum, itemId).
 * O cache é invalidado automaticamente ao salvar/injetar/invalidar medições,
 * eliminando o padrão O(n²) que ocorria ao renderizar todas as linhas da
 * tabela de um BM.
 */
export function getQtdAcumuladoTotalItem(obraId, bmNum, itemId, itensContrato) {
  const key = `${obraId}:${bmNum}:${itemId}`;
  if (_acumCache.has(key)) return _acumCache.get(key);

  let total = 0;
  for (let n = 1; n <= bmNum; n++) {
    total += getQtdMedicaoItemNoBm(obraId, n, itemId, itensContrato);
  }
  // FIX-4: limita acumulado a 100% da quantidade contratada do item
  const it = itensContrato.find(x => x.id === itemId && !x.t);
  const qtdContratada = it ? (it.qtd || 0) : 0;
  if (qtdContratada > 0 && total > qtdContratada) {
    total = qtdContratada;
  }
  const result = safe(total);
  _acumCache.set(key, result);
  return result;
}

export function getQtdAcumuladoAnteriorItem(obraId, bmNum, itemId, itensContrato) {
  if (bmNum <= 1) return 0;
  return getQtdAcumuladoTotalItem(obraId, bmNum - 1, itemId, itensContrato);
}

export function getQtdMedicaoAtualItem(obraId, bmNum, itemId, itensContrato) {
  return getQtdMedicaoItemNoBm(obraId, bmNum, itemId, itensContrato);
}

// ── Getters de valor financeiro ───────────────────────────────

/**
 * Valor Acumulado Total = soma dos valores de cada BM de 1 até bmNum,
 * considerando apenas linhas originárias de cada BM.
 */
export function getValorAcumuladoTotal(obraId, bmNum, itensContrato, cfg) {
  // FIX-E3.1: memoização — chave inclui bdi para invalidar quando cfg muda
  const cacheKey = `${obraId}:${bmNum}:${safe(cfg?.bdi, 0.25)}:${safe(cfg?.bdiReduzido, 0.10)}`;
  if (_valorCache.has(cacheKey)) return _valorCache.get(cacheKey);

  const bdi = safe(cfg.bdi, 0.25);
  // TRUNCAMENTO obrigatório para upBdi: cortar casas decimais após a segunda,
  // nunca arredondar. Usa round(v*10000)/100 antes de trunc para compensar
  // imprecisão de ponto flutuante (ex: 63.16*1.25 = 78.94999... → 78.94).
  const rnd2 = v => Math.trunc(Math.round(v * 100 * 100) / 100) / 100;
  let total = 0;
  // FIX-4: rastreia qtd acumulada por item para aplicar o limite de 100% do contratado
  const qtdAcumMap = {};
  for (let n = 1; n <= bmNum; n++) {
    const med = getMedicoes(obraId, n);
    itensContrato.forEach(it => {
      if (it.t) return;
      const ownLines = getLinhasOriginBm(med, it.id, n);
      const qtdBm    = safe(sumLinhasQtd(it.und, ownLines, getFxFormula(med, it.id)));
      const jaAcum   = qtdAcumMap[it.id] || 0;
      const cap      = it.qtd > 0 ? Math.max(0, it.qtd - jaAcum) : qtdBm;
      const safeQ    = Math.min(qtdBm, cap);
      qtdAcumMap[it.id] = jaAcum + safeQ;
      // TCU Acórdão 2.622/2013: usa BDI efetivo por tipo de item
      // Usa upBdi salvo diretamente se disponível (evita perda de precisão)
      const bdiEfetivo = getBdiEfetivo(it, cfg);
      const upBdi = it.upBdi ? it.upBdi : rnd2(it.up * (1 + bdiEfetivo));
      total += rnd2(safeQ * upBdi);
    });
  }
  // CORREÇÃO: arredondamento final do total acumulado (valor final de medição).
  // Independente do modoCalculo (truncar/arredondar), o TOTAL FINAL de medição
  // deve ser arredondado para 2 casas. Isso evita que 143030.07999... seja exibido
  // como 143030,07 em vez de 143030,08.
  const result = Math.round(safe(total) * 100) / 100;
  _valorCache.set(cacheKey, result); // FIX-E3.1: armazena resultado
  return result;
}

export function getValorAcumuladoAnterior(obraId, bmNum, itensContrato, cfg) {
  return bmNum <= 1 ? 0 : getValorAcumuladoTotal(obraId, bmNum - 1, itensContrato, cfg);
}

export function getValorMedicaoAtual(obraId, bmNum, itensContrato, cfg) {
  return getValorAcumuladoTotal(obraId, bmNum, itensContrato, cfg)
       - getValorAcumuladoAnterior(obraId, bmNum, itensContrato, cfg);
}

// ── Versão para Memória de Cálculo ──────────────────────────

/**
 * Valor da Medição Atual (apenas este BM) para a Memória de Cálculo.
 */
export function getValorMedicaoAtualMem(obraId, bmNum, itensContrato, cfg) {
  const med = getMedicoes(obraId, bmNum);
  let total = 0;
  itensContrato.forEach(it => {
    if (it.t) return;
    const ownLines = getLinhasOriginBm(med, it.id, bmNum);
    const qtd   = sumLinhasQtd(it.und, ownLines, getFxFormula(med, it.id));
    const safeQ = safe(qtd);
    // TCU Acórdão 2.622/2013: usa BDI efetivo por tipo de item
    const bdiEfetivo = getBdiEfetivo(it, cfg);
    const upBdi = fmtNum(it.up * (1 + bdiEfetivo));
    total += fmtNum(safeQ * upBdi);
  });
  return safe(total);
}

/**
 * Valor Acumulado Total para a Memória de Cálculo.
 * Usa a mesma lógica iterativa de getValorAcumuladoTotal.
 */
export function getValorAcumuladoTotalMem(obraId, bmNum, itensContrato, cfg) {
  return getValorAcumuladoTotal(obraId, bmNum, itensContrato, cfg);
}
