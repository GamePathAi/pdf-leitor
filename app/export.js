// Monta o PDF final: ordem/rotação das páginas, páginas de outros PDFs (juntar) e anotações.
// Coordenadas das anotações estão no espaço do usuário do PDF (pontos, origem embaixo à esquerda),
// o mesmo espaço usado pelo pdf.js (convertToPdfPoint) e pelo pdf-lib.

export const TEXT_ASCENT = 0.8;   // baseline fica 0.8 × tamanho abaixo do topo do texto
export const LINE_HEIGHT = 1.2;

export function hexToRgb01(hex) {
  const n = parseInt(hex.slice(1), 16);
  return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
}

// Remove caracteres que a fonte Helvetica padrão não consegue codificar (WinAnsi).
function encodable(font, text) {
  let out = '';
  for (const ch of text) {
    try { font.encodeText(ch); out += ch; } catch { out += '?'; }
  }
  return out;
}

/**
 * @param PDFLib  módulo pdf-lib
 * @param sources [{ bytes: Uint8Array }]
 * @param pages   [{ src, num (1-based), rotation (0/90/180/270 total), annots: [] }]
 * @returns Uint8Array
 */
export async function buildPdf(PDFLib, sources, pages) {
  const { PDFDocument, StandardFonts, rgb, degrees, BlendMode, LineCapStyle } = PDFLib;

  const out = await PDFDocument.create();
  const libs = [];
  for (const s of sources) {
    libs.push(await PDFDocument.load(s.bytes, { updateMetadata: false }));
  }

  // Copia todas as páginas usadas de cada fonte numa única chamada (evita duplicar fontes/imagens).
  const copied = new Map(); // `${src}:${num}` -> PDFPage
  for (let si = 0; si < libs.length; si++) {
    const nums = [...new Set(pages.filter((p) => p.src === si).map((p) => p.num))];
    if (!nums.length) continue;
    const res = await out.copyPages(libs[si], nums.map((n) => n - 1));
    nums.forEach((n, i) => copied.set(`${si}:${n}`, res[i]));
  }

  let font = null;
  for (const p of pages) {
    const page = out.addPage(copied.get(`${p.src}:${p.num}`));
    page.setRotation(degrees(((p.rotation % 360) + 360) % 360));
    if (!p.annots.length) continue;

    // normalize() do pdf-lib envolve o conteúdo original em q/Q, então o estado gráfico
    // deixado pela página (ex.: um "cm" sem Q) não desloca nossos desenhos.
    page.node.normalize();

    for (const a of p.annots) {
      const color = rgb(...hexToRgb01(a.color || '#000000'));
      if (a.type === 'highlight' || a.type === 'whiteout') {
        page.drawRectangle({
          x: a.x, y: a.y, width: a.w, height: a.h,
          color: a.type === 'whiteout' ? rgb(1, 1, 1) : color,
          opacity: a.type === 'highlight' ? 0.4 : 1,
          blendMode: a.type === 'highlight' ? BlendMode.Multiply : BlendMode.Normal,
          borderWidth: 0,
        });
      } else if (a.type === 'pen') {
        const pts = a.points;
        if (pts.length === 1) {
          page.drawCircle({ x: pts[0][0], y: pts[0][1], size: a.width / 2, color });
        }
        for (let i = 1; i < pts.length; i++) {
          page.drawLine({
            start: { x: pts[i - 1][0], y: pts[i - 1][1] }, end: { x: pts[i][0], y: pts[i][1] },
            thickness: a.width, color, lineCap: LineCapStyle.Round,
          });
        }
      } else if (a.type === 'text') {
        if (!font) font = await out.embedFont(StandardFonts.Helvetica);
        const th = (a.rot * Math.PI) / 180;
        const down = [Math.sin(th), -Math.cos(th)];
        a.text.split('\n').forEach((line, i) => {
          if (!line) return;
          const d = a.size * TEXT_ASCENT + i * a.size * LINE_HEIGHT;
          page.drawText(encodable(font, line), {
            x: a.x + down[0] * d, y: a.y + down[1] * d,
            size: a.size, font, color, rotate: degrees(a.rot),
          });
        });
      }
    }
  }
  return out.save();
}
