// Teste da função que salva o PDF (app/export.js), rodando em Node.
// Cria PDFs de exemplo, aplica anotações/rotação/ordem/junção e confere o resultado com o pdf.js.
const assert = require('assert/strict');
const path = require('path');
const { pathToFileURL } = require('url');
const PDFLib = require('pdf-lib');

(async () => {
  const { buildPdf, TEXT_ASCENT } = await import(pathToFileURL(path.join(__dirname, '..', 'app', 'export.js')).href);
  const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');

  // PDF A: 2 páginas. A página 1 deixa um "cm" sem q/Q no conteúdo (desloca tudo que vier depois).
  const a = await PDFLib.PDFDocument.create();
  const pa1 = a.addPage([600, 800]);
  pa1.pushOperators(PDFLib.concatTransformationMatrix(1, 0, 0, 1, 100, 100));
  a.addPage([600, 800]).setRotation(PDFLib.degrees(90));
  const bytesA = await a.save();

  // PDF B: 1 página (para "juntar").
  const b = await PDFLib.PDFDocument.create();
  b.addPage([300, 400]);
  const bytesB = await b.save();

  const sources = [{ bytes: bytesA }, { bytes: bytesB }];
  const pages = [
    { src: 1, num: 1, rotation: 0, annots: [] },                  // página do PDF B primeiro
    { src: 0, num: 2, rotation: 180, annots: [                    // A2 com rotação alterada
      { type: 'text', x: 50, y: 700, text: 'girado', size: 12, rot: 90, color: '#000000' },
    ] },
    { src: 0, num: 1, rotation: 0, annots: [                      // A1 com tudo
      { type: 'highlight', x: 10, y: 10, w: 100, h: 20, color: '#ffeb3b' },
      { type: 'whiteout', x: 200, y: 200, w: 50, h: 50 },
      { type: 'pen', points: [[1, 1], [50, 50], [80, 20]], width: 3, color: '#e53935' },
      { type: 'pen', points: [[5, 5]], width: 3, color: '#e53935' },
      { type: 'text', x: 100, y: 500, text: 'Olá, ação ✓\nsegunda linha', size: 12, rot: 0, color: '#1e88e5' },
    ] },
  ];

  const out = await buildPdf(PDFLib, sources, pages);
  assert.ok(out.length > 500, 'PDF gerado vazio');

  const doc = await pdfjs.getDocument({ data: out, useSystemFonts: false, disableFontFace: true }).promise;
  assert.equal(doc.numPages, 3, 'número de páginas');

  const p1 = await doc.getPage(1);
  assert.deepEqual(p1.view, [0, 0, 300, 400], 'página do PDF B veio primeiro');

  const p2 = await doc.getPage(2);
  assert.equal(p2.rotate, 180, 'rotação aplicada');

  const p3 = await doc.getPage(3);
  assert.equal(p3.rotate, 0);
  const tc = await p3.getTextContent();
  const items = tc.items.filter((i) => i.str.trim());
  const first = items.find((i) => i.str.startsWith('Ol'));
  assert.ok(first, `texto não encontrado: ${JSON.stringify(items.map((i) => i.str))}`);
  assert.equal(first.str, 'Olá, ação ?', 'acentos mantidos e caractere sem suporte trocado por ?');
  // Posição exata: prova que o "cm" solto da página original não deslocou nossa anotação.
  const [, , , , x, y] = first.transform;
  assert.ok(Math.abs(x - 100) < 0.01, `x do texto = ${x}`);
  assert.ok(Math.abs(y - (500 - 12 * TEXT_ASCENT)) < 0.01, `y do texto = ${y}`);
  assert.ok(items.some((i) => i.str === 'segunda linha'), 'segunda linha');

  const p2text = (await p2.getTextContent()).items.find((i) => i.str === 'girado');
  assert.ok(p2text, 'texto na página girada');

  // Página sem anotação não deve ganhar conteúdo extra; renderização dos operadores deve funcionar.
  const ops = await p3.getOperatorList();
  assert.ok(ops.fnArray.length > 10, 'operadores de desenho presentes');

  console.log('OK: todos os testes de salvar passaram.');
})().catch((e) => { console.error('FALHOU:', e); process.exit(1); });
