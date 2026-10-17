// OGP image (1200x630 PNG) drawn straight into a pixel buffer. No dependencies.
const zlib = require('zlib');

const W = 1200, H = 630;
const BG = [20, 20, 20], TEXT = [237, 237, 237], MUTED = [138, 138, 138];
const LEVELS = [[29, 29, 29], [14, 74, 54], [19, 115, 79], [31, 167, 116], [75, 224, 168]];

// 5x7 glyphs, one string of 7 rows per character
const FONT = {
  A: '01110 10001 10001 11111 10001 10001 10001', B: '11110 10001 10001 11110 10001 10001 11110',
  C: '01110 10001 10000 10000 10000 10001 01110', D: '11110 10001 10001 10001 10001 10001 11110',
  E: '11111 10000 10000 11110 10000 10000 11111', F: '11111 10000 10000 11110 10000 10000 10000',
  G: '01110 10001 10000 10111 10001 10001 01111', H: '10001 10001 10001 11111 10001 10001 10001',
  I: '01110 00100 00100 00100 00100 00100 01110', J: '00111 00010 00010 00010 00010 10010 01100',
  K: '10001 10010 10100 11000 10100 10010 10001', L: '10000 10000 10000 10000 10000 10000 11111',
  M: '10001 11011 10101 10101 10001 10001 10001', N: '10001 11001 10101 10011 10001 10001 10001',
  O: '01110 10001 10001 10001 10001 10001 01110', P: '11110 10001 10001 11110 10000 10000 10000',
  Q: '01110 10001 10001 10001 10101 10010 01101', R: '11110 10001 10001 11110 10100 10010 10001',
  S: '01111 10000 10000 01110 00001 00001 11110', T: '11111 00100 00100 00100 00100 00100 00100',
  U: '10001 10001 10001 10001 10001 10001 01110', V: '10001 10001 10001 10001 10001 01010 00100',
  W: '10001 10001 10001 10101 10101 11011 10001', X: '10001 10001 01010 00100 01010 10001 10001',
  Y: '10001 10001 01010 00100 00100 00100 00100', Z: '11111 00001 00010 00100 01000 10000 11111',
  0: '01110 10001 10011 10101 11001 10001 01110', 1: '00100 01100 00100 00100 00100 00100 01110',
  2: '01110 10001 00001 00010 00100 01000 11111', 3: '11110 00001 00001 01110 00001 00001 11110',
  4: '00010 00110 01010 10010 11111 00010 00010', 5: '11111 10000 11110 00001 00001 10001 01110',
  6: '00110 01000 10000 11110 10001 10001 01110', 7: '11111 00001 00010 00100 01000 01000 01000',
  8: '01110 10001 10001 01110 10001 10001 01110', 9: '01110 10001 10001 01111 00001 00010 01100',
  '.': '00 00 00 00 00 11 11', '-': '00000 00000 00000 11111 00000 00000 00000',
  ',': '00 00 00 00 11 01 10', '/': '00001 00010 00010 00100 01000 01000 10000', ' ': '000 000 000 000 000 000 000',
};

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
  const t = Buffer.from(type), len = Buffer.alloc(4), crc = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  crc.writeUInt32BE(crc32(Buffer.concat([t, data])));
  return Buffer.concat([len, t, data, crc]);
};

function canvas() {
  const px = Buffer.alloc(W * H * 3);
  for (let i = 0; i < W * H; i++) px.set(BG, i * 3);
  const rect = (x, y, w, h, col) => {
    for (let j = Math.max(0, y); j < Math.min(H, y + h); j++)
      for (let i = Math.max(0, x); i < Math.min(W, x + w); i++) px.set(col, (j * W + i) * 3);
  };
  const text = (str, x, y, s, col) => {
    for (const ch of String(str).toUpperCase()) {
      const g = (FONT[ch] || FONT[' ']).split(' ');
      g.forEach((row, r) => [...row].forEach((v, c) => v === '1' && rect(x + c * s, y + r * s, s, s, col)));
      x += (g[0].length + 1) * s;
    }
    return x;
  };
  const png = () => {
    const raw = Buffer.alloc((W * 3 + 1) * H);
    for (let j = 0; j < H; j++) px.copy(raw, j * (W * 3 + 1) + 1, j * W * 3, (j + 1) * W * 3);
    const ihdr = Buffer.alloc(13);
    ihdr.writeUInt32BE(W, 0); ihdr.writeUInt32BE(H, 4); ihdr[8] = 8; ihdr[9] = 2;
    return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw, { level: 9 })), chunk('IEND', Buffer.alloc(0))]);
  };
  return { rect, text, png };
}

function renderOg(s) {
  const c = canvas();
  const name = s.user.login;
  c.text(name, 70, 56, 10, TEXT);
  c.text('GITHUB ACTIVITY / LAST YEAR', 70, 146, 4, MUTED);

  const stats = [
    [s.year.total.toLocaleString('en-US'), '', 'CONTRIBUTIONS'],
    [`${s.streak.current}`, 'DAYS', 'CURRENT STREAK'],
    [`${s.streak.longest}`, 'DAYS', 'LONGEST STREAK'],
  ];
  stats.forEach(([n, unit, label], i) => {
    const x = 70 + i * 380;
    const end = c.text(n, x, 216, 8, TEXT);
    if (unit) c.text(unit, end + 8, 216 + 28, 4, MUTED);
    c.text(label, x, 284, 3, MUTED);
  });

  // contribution heatmap (last year)
  const days = s.year.days, max = Math.max(1, ...days.map((d) => d.count));
  const first = days[0].weekday, cols = Math.ceil((days.length + first) / 7);
  const gap = 4, left = 70, span = W - 2 * left;
  const cell = Math.floor((span + gap) / cols) - gap;
  const x0 = left + Math.round((span - (cols * (cell + gap) - gap)) / 2), y0 = 350;
  days.forEach((d, i) => {
    const lvl = d.count === 0 ? 0 : Math.min(4, Math.ceil(d.count / max * 4));
    c.rect(x0 + Math.floor((i + first) / 7) * (cell + gap), y0 + d.weekday * (cell + gap), cell, cell, LEVELS[lvl]);
  });

  c.text('GH.LAPIUS7.COM', 70, 552, 4, MUTED);
  return c.png();
}

module.exports = { renderOg };
