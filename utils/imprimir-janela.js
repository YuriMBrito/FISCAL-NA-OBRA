/**
 * ╔══════════════════════════════════════════════════════════════╗
 * ║  FISCAL NA OBRA — utils/imprimir-janela.js                  ║
 * ║  Abre o HTML de um relatório em janela própria e imprime    ║
 * ╚══════════════════════════════════════════════════════════════╝
 *
 * POR QUE ESTE ARQUIVO EXISTE
 *
 * Treze exportações montavam o documento e pediam a impressão com um
 * <script>window.print()<\/script> escrito dentro do HTML da janela nova.
 *
 * Isso nunca funcionou em produção. A janela aberta por window.open('')
 * herda a CSP do app, que tem script-src sem 'unsafe-inline' — o script
 * inline é bloqueado, a janela abre e fica parada. Em `vite dev` funcionava,
 * porque lá não há header de CSP nenhum; só quem usasse o sistema publicado
 * via o defeito, e o sintoma era "abriu a janela e não aconteceu nada".
 *
 * A janela é da MESMA ORIGEM do app, então o opener tem acesso de script a
 * ela. Quem chama print() aqui é o opener — nenhum script atravessa a CSP.
 *
 * USO
 *   import { abrirParaImpressao } from '../../utils/imprimir-janela.js';
 *   abrirParaImpressao(html, { largura: 900, altura: 700 });
 *
 * O HTML passado NÃO deve conter <script>: ele seria bloqueado do mesmo
 * jeito. Qualquer coisa que precise rodar na janela roda aqui, de fora.
 */

/**
 * @param {string} html  documento completo (<!DOCTYPE html>…)
 * @param {Object} [opts]
 * @param {number}  [opts.largura=900]
 * @param {number}  [opts.altura=700]
 * @param {boolean} [opts.fecharDepois=false]  fecha a janela ao fim da impressão
 * @param {string}  [opts.aviso]               mensagem se o popup for bloqueado
 * @returns {Window|null} a janela aberta, ou null se o popup foi bloqueado
 */
export function abrirParaImpressao(html, opts = {}) {
  const {
    largura = 900,
    altura  = 700,
    fecharDepois = false,
    aviso = '⚠️ Permita popups para gerar o PDF.',
  } = opts;

  const w = window.open('', '_blank', `width=${largura},height=${altura}`);
  if (!w) {
    window.toast?.(aviso, 'warn');
    return null;
  }

  w.document.open();
  w.document.write(html);
  w.document.close();

  inserirAvisoDestino(w.document);

  if (fecharDepois) {
    try { w.onafterprint = () => w.close(); } catch { /* bloqueado por popup blocker */ }
  }

  // Esperar as imagens evita a folha sair sem o brasão: print() dispara de
  // imediato e o navegador não aguarda download pendente. Sem imagem, o
  // setTimeout(0) só deixa o layout assentar antes do diálogo.
  const imprimir = () => {
    if (w.closed) return;
    try { w.focus(); w.print(); }
    catch (e) { console.error('[imprimir-janela] print:', e); }
  };

  const imgs = w.document.images;
  if (!imgs || imgs.length === 0) {
    setTimeout(imprimir, 0);
    return w;
  }

  let faltam = imgs.length;
  let jaFoi  = false;
  const pronto = () => {
    if (jaFoi) return;
    if (--faltam > 0) return;
    jaFoi = true;
    setTimeout(imprimir, 50);
  };

  for (const img of imgs) {
    if (img.complete) pronto();
    else {
      img.addEventListener('load',  pronto, { once: true });
      img.addEventListener('error', pronto, { once: true });
    }
  }

  // Rede lenta ou imagem que nunca responde não pode travar a exportação.
  setTimeout(() => { if (!jaFoi) { jaFoi = true; imprimir(); } }, 3000);

  return w;
}

/**
 * Faixa de orientação no topo da janela de impressão — só na TELA, nunca no
 * papel (@media print a esconde).
 *
 * Motivo (29/10/2026): um Boletim de Medição exportado saiu com o texto
 * impossível de copiar. O HTML estava correto — o mesmo boletim impresso pelo
 * "Microsoft Print to PDF" copia perfeitamente. O arquivo problemático tinha
 * sido gerado pelo PDFCreator, que converte via Ghostscript e transforma cada
 * letra em DESENHO VETORIAL (fonte Type3, sem /ToUnicode). Na tela fica igual;
 * ao copiar, sai símbolo. Nenhuma mudança no sistema evita isso: quem decide é
 * a impressora virtual escolhida no diálogo. Daí o aviso.
 *
 * Para conferir um PDF: node tests/diagnostico-pdf.mjs "<arquivo.pdf>"
 */
export function inserirAvisoDestino(doc) {
  try {
    if (!doc || doc.getElementById('fo-aviso-destino')) return;

    const estilo = doc.createElement('style');
    estilo.textContent =
      '#fo-aviso-destino{font:13px/1.5 Arial,Helvetica,sans-serif;background:#FFF7ED;' +
      'color:#7C2D12;border-bottom:1px solid #FDBA74;padding:10px 14px;text-align:center}' +
      '#fo-aviso-destino b{color:#9A3412}' +
      '@media print{#fo-aviso-destino{display:none!important}}';
    doc.head?.appendChild(estilo);

    const faixa = doc.createElement('div');
    faixa.id = 'fo-aviso-destino';
    faixa.textContent = 'Na janela de impressão, escolha o destino ' +
      '"Salvar como PDF" (do navegador) ou "Microsoft Print to PDF". ' +
      'PDFCreator, PrimoPDF e doPDF geram um PDF cujo texto não pode ser copiado.';
    doc.body?.insertBefore(faixa, doc.body.firstChild);
  } catch { /* janela fechada antes da hora */ }
}

export default abrirParaImpressao;
