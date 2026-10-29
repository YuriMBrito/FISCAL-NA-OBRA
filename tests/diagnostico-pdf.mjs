/**
 * ╔══════════════════════════════════════════════════════════════╗
 * ║  DIAGNÓSTICO — por que o texto de um PDF copia embaralhado   ║
 * ║  Rodar: node tests/diagnostico-pdf.mjs "<arquivo.pdf>"       ║
 * ╚══════════════════════════════════════════════════════════════╝
 *
 * Ao copiar texto de um PDF, o leitor não lê "as letras": lê os códigos dos
 * glifos e os traduz com o mapa /ToUnicode da fonte. Sem esse mapa a cópia
 * devolve os códigos crus, que aparecem como símbolos sem sentido. Na tela o
 * texto continua perfeito, porque o desenho do glifo não depende do mapa —
 * por isso o defeito só aparece ao copiar.
 *
 * Há dois jeitos de um PDF ficar assim:
 *
 *   1. Fonte embutida SEM /ToUnicode.
 *   2. Fonte Type3 — cada letra guardada como DESENHO VETORIAL, sem nenhuma
 *      semântica de caractere. Não há mapa a recuperar: o texto, para o PDF,
 *      virou rabisco. Também incha o arquivo (8× é comum).
 *
 * O caso 2 foi o do "BOLETIM DE MEDIÇÃO BM 03.pdf" (29/10/2026): gerado pelo
 * PDFCreator Free 4.4.0 sobre GPL Ghostscript 9.52, que converteu tudo em 8
 * fontes Type3. O mesmo boletim impresso pelo "Microsoft Print to PDF"
 * (BM02.pdf) saiu com CIDFontType2 + ToUnicode e copia perfeitamente. Ou
 * seja: quem decide isso é a impressora virtual escolhida, não o HTML.
 *
 * IMPORTANTE: PDFs modernos (1.5+) guardam os dicionários dentro de streams
 * comprimidos. Ler o arquivo cru não enxerga nada — a primeira versão deste
 * script dizia "0 fontes" justamente por isso. Aqui tudo é descomprimido
 * antes de analisar.
 */
import { readFileSync } from 'node:fs';
import { inflateSync } from 'node:zlib';

const arquivo = process.argv[2];
if (!arquivo) {
  console.error('\nuso: node tests/diagnostico-pdf.mjs "<arquivo.pdf>"\n');
  process.exit(1);
}

let bin;
try {
  bin = readFileSync(arquivo);
} catch (e) {
  console.error(`\n✖ não consegui ler "${arquivo}": ${e.message}\n`);
  process.exit(1);
}

const cru = bin.toString('latin1');

/** Texto do arquivo + o de todos os streams que derem para descomprimir. */
function tudoLegivel() {
  const partes = [cru];
  const re = /stream\r?\n/g;
  let m;
  while ((m = re.exec(cru))) {
    const ini = m.index + m[0].length;
    const fim = cru.indexOf('endstream', ini);
    if (fim < 0) continue;
    try { partes.push(inflateSync(bin.subarray(ini, fim)).toString('latin1')); }
    catch { /* stream não-Flate ou com filtro em cadeia: ignorar */ }
  }
  return partes.join('\n');
}

const texto = tudoLegivel();
const conta  = (re) => (texto.match(re) || []).length;
const unicos = (re) => [...new Set(texto.match(re) || [])];

const geradores = unicos(/\/(Producer|Creator)\s*\(([^)]*)\)/g)
  .map(s => s.replace(/\\(\d{3})/g, (_, o) => String.fromCharCode(parseInt(o, 8)))
             .replace(/\/(Producer|Creator)\s*\(/, '').replace(/\)$/, ''));

const paginas = conta(/\/Type\s*\/Page[^s]/g) || 1;
const imagens = conta(/\/Subtype\s*\/Image/g);

/**
 * Uma fonte aparece em VÁRIOS dicionários: a Type0 (a que o texto usa, e que
 * carrega o /ToUnicode) e a CIDFontType2 descendente, que descreve o programa
 * da fonte e corretamente não tem mapa próprio. Contar os dois juntos dava
 * "3 ToUnicode de 9 fontes" num arquivo perfeito, o que assusta à toa.
 * Só interessa a fonte que o texto referencia.
 */
const dicts = texto.split(/\/Type\s*\/Font/).slice(1).map(b => {
  const d = b.slice(0, 400).replace(/\s+/g, ' ');
  return {
    nome: (d.match(/\/BaseFont\s*\/([A-Za-z0-9+#,.-]+)/) || [])[1] || null,
    sub:  (d.match(/\/Subtype\s*\/([A-Za-z0-9]+)/)       || [])[1] || '?',
    enc:  (d.match(/\/Encoding\s*\/?([A-Za-z0-9-]+)/)    || [])[1] || '(nenhuma)',
    tu:   /\/ToUnicode/.test(d),
  };
});

// Descendente de uma Type0 não é uma fonte de texto: não entra na conta.
const fontes    = dicts.filter(f => f.sub !== 'CIDFontType0' && f.sub !== 'CIDFontType2' && f.nome);
const type3     = dicts.filter(f => f.sub === 'Type3').length || conta(/\/Subtype\s*\/Type3/g);
const semMapa   = fontes.filter(f => !f.tu);
const baseFonts = [...new Set(fontes.map(f => f.nome))];
const fontesTot = fontes.length;
const toUnicode = fontes.filter(f => f.tu).length;

console.log('\n══════════════════════════════════════════════════════');
console.log('  ' + arquivo.split(/[\\/]/).pop());
console.log('══════════════════════════════════════════════════════');
console.log('  Gerado por  : ' + (geradores.length ? geradores.join(' · ') : '(não declarado)'));
console.log('  Páginas     : ' + paginas);
console.log('  Tamanho     : ' + (bin.length / 1024).toFixed(0) + ' KB  (' +
            (bin.length / paginas / 1024).toFixed(0) + ' KB por página)');
console.log('  Imagens     : ' + imagens);
console.log('──────────────────────────────────────────────────────');
if (fontes.length) {
  for (const f of fontes) {
    console.log(`  ${f.tu ? '✔' : '✖'}  ${f.nome}`);
    console.log(`      ${f.sub} · encoding ${f.enc} · ToUnicode: ${f.tu ? 'SIM' : 'NÃO'}`);
  }
} else {
  console.log('  (nenhuma fonte de texto)');
}
console.log('──────────────────────────────────────────────────────');

if (type3 > 0) {
  console.log('  ✖  TEXTO NÃO COPIÁVEL — fontes Type3.');
  console.log('');
  console.log('  Cada letra está guardada como desenho vetorial, sem nenhuma');
  console.log('  semântica de caractere. Não há conserto no arquivo: ele');
  console.log('  precisa ser gerado de novo por outra impressora virtual.');
  console.log('');
  console.log('  Quem costuma fazer isso: PDFCreator, PrimoPDF, doPDF e');
  console.log('  qualquer um que converta via Ghostscript.');
  console.log('  Use "Salvar como PDF" do próprio Chrome, ou o');
  console.log('  "Microsoft Print to PDF" do Windows.');
} else if (fontesTot > 0 && semMapa.length === fontesTot) {
  console.log('  ✖  TEXTO NÃO COPIÁVEL — nenhuma fonte tem /ToUnicode.');
  console.log('  O texto desenha certo e copia errado. Gere de novo por');
  console.log('  outra impressora virtual.');
} else if (semMapa.length) {
  console.log('  ⚠️  ' + semMapa.length + ' de ' + fontesTot + ' fonte(s) sem /ToUnicode.');
  console.log('  Parte do texto copia embaralhado e o resto copia certo —');
  console.log('  normalmente os trechos em negrito ou itálico.');
} else if (fontesTot === 0 && imagens > 0) {
  console.log('  ✖  PÁGINA RASTERIZADA — é imagem, não texto.');
  console.log('  Não há o que copiar. Só OCR recupera.');
} else if (toUnicode > 0) {
  console.log('  ✔  Texto copiável: há fonte com /ToUnicode.');
  console.log('  Se mesmo assim embaralha, teste o arquivo em outro leitor.');
} else {
  console.log('  ?  Não consegui classificar. Pode ser PDF com criptografia');
  console.log('  ou com filtro de stream não suportado aqui.');
}
console.log('══════════════════════════════════════════════════════\n');
