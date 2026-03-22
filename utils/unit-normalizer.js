/**
 * ╔══════════════════════════════════════════════════════════════╗
 * ║  FISCAL NA OBRA — utils/unit-normalizer.js                  ║
 * ║  Normalização centralizada de unidades de medida            ║
 * ╚══════════════════════════════════════════════════════════════╝
 *
 * Garante que todas as variações de unidade (m², M², M2, m2, m³, M³, M3, m3)
 * sejam convertidas para um formato interno padronizado.
 *
 * Formato interno:  m2 | m3 | m | un
 * Formato display:  m² | m³ | m | un (ou original)
 */

const UNIT_MAP = {
  'M2': 'm2', 'M²': 'm2', 'm2': 'm2', 'm²': 'm2',
  'M3': 'm3', 'M³': 'm3', 'm3': 'm3', 'm³': 'm3',
  'M':  'm',  'm':  'm',
};

/**
 * Classifica a unidade para uso interno no motor de cálculo.
 * @param {string} und — unidade bruta (ex: "m²", "M2", "m³", "M3", "m", "un", "vb")
 * @returns {'m2'|'m3'|'m'|'un'} — tipo normalizado
 */
export function classUnd(und) {
  const raw = String(und || '').trim();
  const u = raw.toUpperCase().replace('²', '2').replace('³', '3').replace(/\s/g, '');
  return UNIT_MAP[u] || 'un';
}

/**
 * Normaliza a string de unidade para formato limpo de exibição.
 * @param {string} und — unidade bruta
 * @returns {string} — unidade normalizada para exibição (m², m³, m, ou original)
 */
export function normalizeUnd(und) {
  const tipo = classUnd(und);
  if (tipo === 'm2') return 'm²';
  if (tipo === 'm3') return 'm³';
  if (tipo === 'm')  return 'm';
  return String(und || 'un').trim();
}

/**
 * Verifica se uma unidade é dimensional (requer comprimento/largura/altura).
 * @param {string} und
 * @returns {{ needsComp: boolean, needsLarg: boolean, needsAlt: boolean }}
 */
export function dimensionFlags(und) {
  const tipo = classUnd(und);
  return {
    needsComp: tipo === 'm' || tipo === 'm2' || tipo === 'm3',
    needsLarg: tipo === 'm2' || tipo === 'm3',
    needsAlt:  tipo === 'm3',
  };
}

export default { classUnd, normalizeUnd, dimensionFlags };
