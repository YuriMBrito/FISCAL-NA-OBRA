/**
 * FISCAL NA OBRA — js/pdfjs-worker.js
 * Configura o worker do PDF.js após o carregamento das bibliotecas.
 * Extraído do index.html inline.
 */
window.addEventListener('load', function () {
  if (typeof pdfjsLib !== 'undefined') {
    pdfjsLib.GlobalWorkerOptions.workerSrc =
      'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';
  }
});
