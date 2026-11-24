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

const BG = [217, 48, 37], DARK = [31, 31, 35];

// Cor de cada ponto em coordenadas 0..1 (null = transparente).
// mode: 'rounded' (quadrado arredondado), 'maskable' (fundo cheio), 'round' (círculo),
//       'fg' (só a folha, para o ícone adaptativo do Android).
function shade(x, y, mode) {
  const WHITE = [255, 255, 255], LINE = [200, 200, 205], FOLD = [240, 200, 196];
  if (mode === 'rounded') {
    const r = 0.2, cx = Math.min(Math.max(x, r), 1 - r), cy = Math.min(Math.max(y, r), 1 - r);
    if ((x - cx) ** 2 + (y - cy) ** 2 > r * r) return null;
  }
  if (mode === 'round' && (x - 0.5) ** 2 + (y - 0.5) ** 2 > 0.25) return null;
  const bg = mode === 'fg' ? null : BG;
  // margem de segurança: no adaptativo só os 66% centrais aparecem com certeza
  const s = { maskable: 0.8, round: 0.85, fg: 0.6 }[mode] || 1;
  const u = (x - 0.5) / s + 0.5, v = (y - 0.5) / s + 0.5;
  const L = 0.3, R = 0.7, T = 0.2, B = 0.8, F = 0.12;
  if (u >= L && u <= R && v >= T && v <= B) {
    if (u > R - F && v < T + F) { // canto dobrado
      return (u - (R - F)) > (v - T) ? bg : FOLD;
    }
    for (const ly of [0.42, 0.52, 0.62]) {
      const right = ly === 0.62 ? 0.55 : 0.62;
      if (v > ly - 0.018 && v < ly + 0.018 && u > 0.38 && u < right) return LINE;
    }
    return WHITE;
  }
  return bg;
}

// Tela de abertura do Android: fundo escuro com o ícone no centro.
function splashShade(w, h) {
  const size = Math.min(w, h) * 0.3, x0 = (w - size) / 2, y0 = (h - size) / 2;
  return (px, py) => {
    const c = shade((px - x0) / size, (py - y0) / size, 'rounded');
    return px >= x0 && px < x0 + size && py >= y0 && py < y0 + size && c ? c : DARK;
  };
}

function png(size, mode, height = size, custom = null) {
  const SS = 4, rows = [], width = size;
  for (let py = 0; py < height; py++) {
    const row = Buffer.alloc(1 + width * 4);
    for (let px = 0; px < width; px++) {
      let r = 0, g = 0, b = 0, a = 0;
      for (let sy = 0; sy < SS; sy++) for (let sx = 0; sx < SS; sx++) {
        const fx = px + (sx + 0.5) / SS, fy = py + (sy + 0.5) / SS;
        const c = custom ? custom(fx, fy) : shade(fx / width, fy / height, mode);
        if (c) { r += c[0]; g += c[1]; b += c[2]; a++; }
      }
      const o = 1 + px * 4;
      if (a) { row[o] = r / a; row[o + 1] = g / a; row[o + 2] = b / a; }
      row[o + 3] = Math.round((a / (SS * SS)) * 255);
    }
    rows.push(row);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0); ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; ihdr[9] = 6; // RGBA 8 bits
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(Buffer.concat(rows))), chunk('IEND', Buffer.alloc(0)),
  ]);
}

const out = path.join(__dirname, '..', 'app', 'icons');
fs.mkdirSync(out, { recursive: true });
for (const s of [192, 512]) fs.writeFileSync(path.join(out, `icon-${s}.png`), png(s, 'rounded'));
fs.writeFileSync(path.join(out, 'maskable-512.png'), png(512, 'maskable'));
fs.writeFileSync(path.join(out, 'apple-touch-icon.png'), png(180, 'maskable'));

// Ícone do Windows (.ico com PNGs dentro) para o atalho da Área de Trabalho.
const sizes = [16, 32, 48, 256];
const imgs = sizes.map((s) => png(s, 'rounded'));
const head = Buffer.alloc(6 + 16 * sizes.length);
head.writeUInt16LE(1, 2);
head.writeUInt16LE(sizes.length, 4);
let offset = head.length;
sizes.forEach((s, i) => {
  const o = 6 + 16 * i;
  head[o] = s === 256 ? 0 : s;
  head[o + 1] = s === 256 ? 0 : s;
  head.writeUInt16LE(1, o + 4);
  head.writeUInt16LE(32, o + 6);
  head.writeUInt32LE(imgs[i].length, o + 8);
  head.writeUInt32LE(offset, o + 12);
  offset += imgs[i].length;
});
fs.writeFileSync(path.join(__dirname, '..', 'desktop', 'pdf-leitor.ico'), Buffer.concat([head, ...imgs]));
// Ícones e tela de abertura do app Android (substitui os padrões do Capacitor, mantendo os tamanhos).
const res = path.join(__dirname, '..', 'android', 'app', 'src', 'main', 'res');
if (fs.existsSync(res)) {
  const modes = { 'ic_launcher.png': 'rounded', 'ic_launcher_round.png': 'round', 'ic_launcher_foreground.png': 'fg' };
  for (const dir of fs.readdirSync(res)) {
    for (const name of ['ic_launcher.png', 'ic_launcher_round.png', 'ic_launcher_foreground.png', 'splash.png']) {
      const file = path.join(res, dir, name);
      if (!fs.existsSync(file)) continue;
      const head = fs.readFileSync(file).subarray(16, 24);
      const w = head.readUInt32BE(0), h = head.readUInt32BE(4);
      fs.writeFileSync(file, name === 'splash.png' ? png(w, null, h, splashShade(w, h)) : png(w, modes[name]));
    }
  }
  fs.writeFileSync(path.join(res, 'values', 'ic_launcher_background.xml'),
    '<?xml version="1.0" encoding="utf-8"?>\n<resources>\n    <color name="ic_launcher_background">#D93025</color>\n</resources>\n');
  console.log('ícones do Android gerados em', res);
}
console.log('ícones gerados em', out);
