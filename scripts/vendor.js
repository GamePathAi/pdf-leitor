// Copia as bibliotecas de node_modules para app/vendor (o app funciona offline, sem CDN).
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const out = path.join(root, 'app', 'vendor');
const nm = (...p) => path.join(root, 'node_modules', ...p);

fs.rmSync(out, { recursive: true, force: true });
fs.mkdirSync(out, { recursive: true });

const files = [
  [nm('pdfjs-dist', 'legacy', 'build', 'pdf.min.mjs'), 'pdf.min.mjs'],
  [nm('pdfjs-dist', 'legacy', 'build', 'pdf.worker.min.mjs'), 'pdf.worker.min.mjs'],
  [nm('pdf-lib', 'dist', 'pdf-lib.min.js'), 'pdf-lib.min.js'],
  // Necessário no app Android: cria Capacitor.registerPlugin (a ponte nativa sozinha não tem).
  [nm('@capacitor', 'core', 'dist', 'capacitor.js'), 'capacitor.js'],
];
for (const [src, dest] of files) fs.copyFileSync(src, path.join(out, dest));
fs.cpSync(nm('pdfjs-dist', 'cmaps'), path.join(out, 'cmaps'), { recursive: true });
fs.cpSync(nm('pdfjs-dist', 'standard_fonts'), path.join(out, 'standard_fonts'), { recursive: true });
console.log('vendor copiado para', out);
