// Gera os ícones PNG do app (folha branca sobre fundo vermelho) sem dependências.
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

const crcTable = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
const crc32 = (buf) => {
  let c = 0xffffffff;
  for (const b of buf) c = crcTable[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
};
const chunk = (type, data) => {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type), data]);
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, crc]);
};

// Cor de cada ponto em coordenadas 0..1. maskable = fundo ocupa tudo (sem cantos arredondados).
function shade(x, y, maskable) {
  const BG = [217, 48, 37], WHITE = [255, 255, 255], LINE = [200, 200, 205], FOLD = [240, 200, 196];
  if (!maskable) {
    const r = 0.2, cx = Math.min(Math.max(x, r), 1 - r), cy = Math.min(Math.max(y, r), 1 - r);
    if ((x - cx) ** 2 + (y - cy) ** 2 > r * r) return null;
  }
  const s = maskable ? 0.8 : 1; // margem de segurança do ícone maskable
  const u = (x - 0.5) / s + 0.5, v = (y - 0.5) / s + 0.5;
  const L = 0.3, R = 0.7, T = 0.2, B = 0.8, F = 0.12;
  if (u >= L && u <= R && v >= T && v <= B) {
    if (u > R - F && v < T + F) { // canto dobrado
      return (u - (R - F)) > (v - T) ? BG : FOLD;
    }
    for (const ly of [0.42, 0.52, 0.62]) {
      const right = ly === 0.62 ? 0.55 : 0.62;
      if (v > ly - 0.018 && v < ly + 0.018 && u > 0.38 && u < right) return LINE;
    }
    return WHITE;
  }
  return BG;
}

function png(size, maskable) {
  const SS = 4, rows = [];
  for (let py = 0; py < size; py++) {
    const row = Buffer.alloc(1 + size * 4);
    for (let px = 0; px < size; px++) {
      let r = 0, g = 0, b = 0, a = 0;
      for (let sy = 0; sy < SS; sy++) for (let sx = 0; sx < SS; sx++) {
        const c = shade((px + (sx + 0.5) / SS) / size, (py + (sy + 0.5) / SS) / size, maskable);
        if (c) { r += c[0]; g += c[1]; b += c[2]; a++; }
      }
      const o = 1 + px * 4;
      if (a) { row[o] = r / a; row[o + 1] = g / a; row[o + 2] = b / a; }
      row[o + 3] = Math.round((a / (SS * SS)) * 255);
    }
    rows.push(row);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0); ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; ihdr[9] = 6; // RGBA 8 bits
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(Buffer.concat(rows))), chunk('IEND', Buffer.alloc(0)),
  ]);
}

const out = path.join(__dirname, '..', 'app', 'icons');
fs.mkdirSync(out, { recursive: true });
for (const s of [192, 512]) fs.writeFileSync(path.join(out, `icon-${s}.png`), png(s, false));
fs.writeFileSync(path.join(out, 'maskable-512.png'), png(512, true));
fs.writeFileSync(path.join(out, 'apple-touch-icon.png'), png(180, true));
console.log('ícones gerados em', out);
