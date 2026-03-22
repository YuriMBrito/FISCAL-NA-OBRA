/**
 * ╔══════════════════════════════════════════════════════════════╗
 * ║  FISCAL NA OBRA v19 — utils/csv-export.js                  ║
 * ║  Utilitário compartilhado para exportação de CSV           ║
 * ╚══════════════════════════════════════════════════════════════╝
 */

/**
 * Gera e faz download de um arquivo CSV.
 * @param {string[][]} dados  - Matriz de dados (primeira linha = cabeçalho)
 * @param {string} nomeArquivo - Nome do arquivo sem extensão
 */
export function baixarCSV(dados, nomeArquivo = 'exportacao') {
  const csv = dados
    .map(row => row.map(cell => `"${String(cell ?? '').replace(/"/g, '""')}"`).join(';'))
    .join('\n');

  const blob = new Blob(['\uFEFF' + csv], { type: 'text/csv;charset=utf-8' });
  const url  = URL.createObjectURL(blob);
  const a    = document.createElement('a');
  a.href     = url;
  a.download = `${nomeArquivo}.csv`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

/**
 * Formata número para CSV (sem símbolo de moeda).
 */
export function numCSV(v) {
  const n = parseFloat(v) || 0;
  return n.toFixed(2).replace('.', ',');
}
