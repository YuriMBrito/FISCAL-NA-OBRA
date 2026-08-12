/**
 * FISCAL NA OBRA — js/vendor-loader.js
 * Carrega SheetJS (xlsx) e PDF.js com fallback de CDN.
 *
 * Extraído dos <script> inline do index.html (mesma migração que o
 * firebase-loader.js já tinha feito no PASSO 1.1). Motivo: o hosting serve
 * script-src sem 'unsafe-inline', então aqueles blocos inline nunca eram
 * executados em produção — o navegador os bloqueava antes de rodar, e as
 * duas bibliotecas simplesmente não existiam na página. Isso derrubava a
 * importação de planilha XLSX (modules/importacao, modules/sinapi) e a
 * importação de BM por PDF (modules/importacao-bm-pdf).
 *
 * Este arquivo é servido pela própria origem ('self'), então executa
 * normalmente e pode criar <script> apontando para as CDNs liberadas.
 */
(function () {
  'use strict';

  var PDF_VER  = '3.11.174';
  var XLSX_VER = '0.18.5';

  function carregar(nome, urlPrimaria, urlFallback, aoCarregar) {
    var primaria = document.createElement('script');
    primaria.src = urlPrimaria;
    primaria.crossOrigin = 'anonymous';
    primaria.onload  = function () { if (aoCarregar) aoCarregar(urlPrimaria); };
    primaria.onerror = function () {
      console.warn('[' + nome + '] CDN primária falhou — carregando fallback');
      var reserva = document.createElement('script');
      reserva.src = urlFallback;
      reserva.crossOrigin = 'anonymous';
      reserva.onload  = function () { if (aoCarregar) aoCarregar(urlFallback); };
      reserva.onerror = function () {
        console.error('[' + nome + '] nenhuma CDN respondeu — recurso indisponível');
      };
      document.head.appendChild(reserva);
    };
    document.head.appendChild(primaria);
  }

  // ── SheetJS (leitura de planilhas .xlsx) ──────────────────────────────
  carregar(
    'SheetJS',
    'https://cdnjs.cloudflare.com/ajax/libs/xlsx/' + XLSX_VER + '/xlsx.full.min.js',
    'https://cdn.jsdelivr.net/npm/xlsx@' + XLSX_VER + '/dist/xlsx.full.min.js'
  );

  // ── PDF.js (importação de BM em PDF) ──────────────────────────────────
  // O worker precisa sair da mesma CDN que serviu a biblioteca.
  carregar(
    'PDF.js',
    'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/' + PDF_VER + '/pdf.min.js',
    'https://cdn.jsdelivr.net/npm/pdfjs-dist@' + PDF_VER + '/build/pdf.min.js',
    function (urlUsada) {
      if (typeof pdfjsLib === 'undefined') return;
      pdfjsLib.GlobalWorkerOptions.workerSrc = urlUsada.indexOf('jsdelivr') !== -1
        ? 'https://cdn.jsdelivr.net/npm/pdfjs-dist@' + PDF_VER + '/build/pdf.worker.min.js'
        : 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/' + PDF_VER + '/pdf.worker.min.js';
    }
  );
})();
