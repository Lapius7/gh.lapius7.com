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
  _: '00000 00000 00000 00000 00000 00000 11111', ':': '00 11 11 00 11 11 00', ';': '00 11 11 00 11 01 10',
  '#': '01010 01010 11111 01010 11111 01010 01010', '@': '01110 10001 10111 10101 10110 10000 01110',
  '(': '00010 00100 01000 01000 01000 00100 00010', ')': '01000 00100 00010 00010 00010 00100 01000',
  '+': '00000 00100 00100 11111 00100 00100 00000', "'": '00100 00100 01000 00000 00000 00000 00000',
  '!': '00100 00100 00100 00100 00100 00000 00100', '?': '01110 10001 00001 00010 00100 00000 00100',
  '&': '01100 10010 10100 01000 10101 10010 01101', '=': '00000 00000 11111 00000 11111 00000 00000',
  '<': '00010 00100 01000 10000 01000 00100 00010', '>': '01000 00100 00010 00001 00010 00100 01000',
  '[': '01110 01000 01000 01000 01000 01000 01110', ']': '01110 00010 00010 00010 00010 00010 01110',
  '*': '00000 10101 01110 11111 01110 10101 00000', '%': '11001 11010 00010 00100 01000 01011 10011',
  '"': '01010 01010 01010 00000 00000 00000 00000', '|': '00100 00100 00100 00100 00100 00100 00100',
  '~': '00000 00000 01000 10101 00010 00000 00000', '^': '00100 01010 10001 00000 00000 00000 00000',
  '\\': '10000 01000 01000 00100 00010 00010 00001', '`': '01000 00100 00000 00000 00000 00000 00000',
  $: '00100 01111 10100 01110 00101 11110 00100',
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

// ---- drawing: anti-aliased dots over a dusk sky, same look as the page banner ----
const clamp = (v, lo = 0, hi = 1) => Math.min(hi, Math.max(lo, v));
const mix = (a, b, k) => [a[0] + (b[0] - a[0]) * k, a[1] + (b[1] - a[1]) * k, a[2] + (b[2] - a[2]) * k];
const smooth = (e0, e1, v) => { const t = clamp((v - e0) / (e1 - e0)); return t * t * (3 - 2 * t); };
const hash = (x, y) => { const h = Math.sin(x * 127.1 + y * 311.7) * 43758.5453; return h - Math.floor(h); };
const vnoise = (x, y) => {
  const xi = Math.floor(x), yi = Math.floor(y), u = x - xi, v = y - yi;
  const su = u * u * (3 - 2 * u), sv = v * v * (3 - 2 * v);
  const a = hash(xi, yi), b = hash(xi + 1, yi), c = hash(xi, yi + 1), d = hash(xi + 1, yi + 1);
  return a + (b - a) * su + (c - a) * sv + (a - b - c + d) * su * sv;
};
const fbm = (x, y) => vnoise(x, y) * 0.55 + vnoise(x * 2.1 + 7, y * 2.1 + 3) * 0.3 + vnoise(x * 4.3 + 1, y * 4.3 + 9) * 0.15;
const SKY = [[0, [8, 12, 34]], [0.4, [20, 28, 74]], [0.75, [52, 42, 102]], [1, [104, 66, 124]]];
const sample = (stops, v) => {
  for (let i = 1; i < stops.length; i++) if (v <= stops[i][0]) return mix(stops[i - 1][1], stops[i][1], (v - stops[i - 1][0]) / (stops[i][0] - stops[i - 1][0]));
  return stops[stops.length - 1][1];
};
const HEAT = [[255, 255, 255, 0.08], [96, 84, 160, 1], [156, 112, 196, 1], [226, 150, 200, 1], [255, 204, 226, 1]];

const CELL = 10;
function canvas() {
  const px = new Float32Array(W * H * 3);
  // Text is built from the sky's own dot grid: glyph pixels at CELL scale light up the background dots themselves,
  // smaller text clears the dots behind it, so no letter is ever drawn on top of a background dot.
  const ops = [], lit = new Set(), masks = [];
  const blend = (x, y, col, a) => {
    if (a <= 0 || x < 0 || y < 0 || x >= W || y >= H) return;
    const o = (y * W + x) * 3;
    px[o] += (col[0] - px[o]) * a; px[o + 1] += (col[1] - px[o + 1]) * a; px[o + 2] += (col[2] - px[o + 2]) * a;
  };
  const dot = (cx, cy, r, col, a = 1) => {
    for (let y = Math.floor(cy - r - 1); y <= Math.ceil(cy + r + 1); y++)
      for (let x = Math.floor(cx - r - 1); x <= Math.ceil(cx + r + 1); x++)
        blend(x, y, col, a * clamp(r + 0.5 - Math.hypot(x + 0.5 - cx, y + 0.5 - cy)));
  };
  const rrect = (x0, y0, w, h, rad, col, a = 1) => {
    for (let y = Math.floor(y0); y < Math.ceil(y0 + h); y++)
      for (let x = Math.floor(x0); x < Math.ceil(x0 + w); x++) {
        const dx = Math.max(x0 + rad - x - 0.5, 0, x + 0.5 - (x0 + w - rad)), dy = Math.max(y0 + rad - y - 0.5, 0, y + 0.5 - (y0 + h - rad));
        blend(x, y, col, a * clamp(rad + 0.5 - Math.hypot(dx, dy)));
      }
  };
  const sky = () => {
    for (let y = 0; y < H; y++) { const c = sample(SKY, y / H); for (let x = 0; x < W; x++) px.set(c, (y * W + x) * 3); }
    // moon glow
    const gx = 0.82 * W, gy = 0.2 * H, R = 300;
    for (let y = 0; y < H; y++) for (let x = Math.max(0, gx - R | 0); x < Math.min(W, gx + R); x++) {
      const d = Math.hypot(x - gx, y - gy) / R; if (d < 1) blend(x, y, [196, 208, 255], 0.2 * (1 - d) * (1 - d));
    }
    const cols = Math.ceil(W / CELL), rows = Math.ceil(H / CELL), dens = new Float32Array(cols * rows);
    for (let r = 0; r < rows; r++) for (let q = 0; q < cols; q++) {
      const n = fbm(q * 0.05 + 8, r * 0.1 + 3), wisp = fbm(q * 0.11, r * 0.3 + 11);
      dens[r * cols + q] = clamp(smooth(0.4, 0.7, n) * (0.7 + 0.6 * wisp));
    }
    for (let r = 0; r < rows; r++) {
      const vy = r / rows, base = sample(SKY, vy);
      for (let q = 0; q < cols; q++) {
        const i = r * cols + q, d = dens[i], below = r + 1 < rows ? dens[i + cols] : d, above = r > 0 ? dens[i - cols] : d, hs = hash(q, r);
        const x = q * CELL + CELL / 2, y = r * CELL + CELL / 2;
        if (lit.has(q + ',' + r)) continue;
        // dots behind small text fade out softly instead of fighting the letters
        const dm = masks.reduce((mn, m) => Math.min(mn, Math.hypot(Math.max(m[0] - x, 0, x - m[2]), Math.max(m[1] - y, 0, y - m[3]))), 99), fade = 0.1 + 0.9 * smooth(0, 56, dm);
        if (d > 0.04) {
          let cc = mix([186, 178, 236], [255, 188, 168], vy * 0.55);
          cc = mix(cc, [236, 232, 255], clamp((d - below) * 3.5) * 0.6);
          cc = mix(cc, [26, 30, 78], clamp((d - above) * 3) * 0.4);
          dot(x, y, Math.min(0.9 + d * 3.6, CELL / 2 + 0.3), mix(base, cc, 0.5 + 0.5 * d), (0.5 + d * 0.5) * fade);
        } else if (hs > 0.982 - (1 - vy) * 0.012) {
          dot(x, y, 1.3 + hs * 1.2, [235, 240, 255], (0.5 + hs * 0.5) * fade);
        } else dot(x, y, 0.8 + hs * 0.6 + (1 - vy) * 0.4, mix(base, [255, 255, 255], 0.22), 0.45 * fade);
      }
    }
  };
  const scrim = () => {
    // Darken toward the left and the lower part so text and the heatmap stay readable.
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      const a = clamp(0.3 + 0.35 * (1 - x / W) + 0.3 * smooth(0.25, 0.7, y / H));
      blend(x, y, [6, 8, 24], a);
    }
  };
  const width = (str, s) => [...String(str).toUpperCase()].reduce((n, ch) => n + ((FONT[ch] || FONT[' ']).split(' ')[0].length + 1) * s, 0) - s;
  const text = (str, x, y, s, col, a = 1) => {
    const x0 = x, up = String(str).toUpperCase();
    ops.push({ up, x, y, s, col, a });
    if (s === CELL) {
      for (const ch of up) {
        const g = (FONT[ch] || FONT[' ']).split(' ');
        g.forEach((row, r) => [...row].forEach((v, c) => v === '1' && lit.add(`${(x + c * s) / CELL},${(y + r * s) / CELL}`)));
        x += (g[0].length + 1) * s;
      }
    } else masks.push([x0 - 4, y - 4, x0 + width(up, s) + 4, y + 7 * s + 4]);
    return x0 + width(up, s) + s;
  };
  const flush = () => {
    for (const { up, x: x0, y, s, col, a } of ops) {
      let x = x0;
      const rad = s === CELL ? CELL * 0.46 : s * (s >= 6 ? 0.44 : 0.5);
      for (const ch of up) {
        const g = (FONT[ch] || FONT[' ']).split(' ');
        g.forEach((row, r) => [...row].forEach((v, c) => v === '1' && dot(x + (c + 0.5) * s, y + (r + 0.5) * s, rad, col, a)));
        x += (g[0].length + 1) * s;
      }
    }
  };
  const png = (level = 9) => {
    const raw = Buffer.alloc((W * 3 + 1) * H);
    for (let j = 0; j < H; j++) for (let i = 0; i < W * 3; i++) raw[j * (W * 3 + 1) + 1 + i] = Math.round(clamp(px[j * W * 3 + i] / 255) * 255);
    const ihdr = Buffer.alloc(13);
    ihdr.writeUInt32BE(W, 0); ihdr.writeUInt32BE(H, 4); ihdr[8] = 8; ihdr[9] = 2;
    return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw, { level })), chunk('IEND', Buffer.alloc(0))]);
  };
  return { sky, scrim, dot, rrect, text, flush, width, png };
}

function renderOg(s) {
  const c = canvas();
  const WHITE = [244, 240, 255], MUTED = [176, 170, 214], ACCENT = [255, 204, 226];
  c.text(s.user.login, 70, 40, 10, WHITE);
  c.text('GITHUB ACTIVITY / LAST YEAR', 70, 130, 4, MUTED);

  const stats = [
    [s.year.total.toLocaleString('en-US'), '', 'CONTRIBUTIONS'],
    [`${s.streak.current}`, 'DAYS', 'CURRENT STREAK'],
    [`${s.streak.longest}`, 'DAYS', 'LONGEST STREAK'],
  ];
  stats.forEach(([n, unit, label], i) => {
    const x = 70 + i * 380;
    const end = c.text(n, x, 190, 10, i === 0 ? ACCENT : WHITE);
    if (unit) c.text(unit, end + 10, 190 + 42, 4, MUTED);
    c.text(label, x, 280, 4, MUTED);
  });
  c.text('GH.LAPIUS7.COM', 70, 552, 4, MUTED);
  c.sky(); c.scrim(); c.flush();

  // contribution heatmap (last year), rounded cells in the dusk palette
  const days = s.year.days, max = Math.max(1, ...days.map((d) => d.count));
  const first = days[0].weekday, cols = Math.ceil((days.length + first) / 7);
  const gap = 4, left = 70, span = W - 2 * left;
  const cell = Math.floor((span + gap) / cols) - gap;
  const x0 = left + Math.round((span - (cols * (cell + gap) - gap)) / 2), y0 = 350;
  days.forEach((d, i) => {
    const lvl = d.count === 0 ? 0 : Math.min(4, Math.ceil(Math.sqrt(d.count / max) * 4)), [r, g, b, a] = HEAT[lvl];
    c.rrect(x0 + Math.floor((i + first) / 7) * (cell + gap), y0 + d.weekday * (cell + gap), cell, cell, cell * 0.28, [r, g, b], a);
  });

  return c.png();
}

// ---- per-page card: top label, title, description, meta line ----
// Only the glyphs above exist, so text is reduced to ASCII upper case (non-ASCII is dropped).
const asc = (v) => String(v == null ? '' : v).replace(/[{]/g, '(').replace(/[}]/g, ')').replace(/[\u2018\u2019]/g, "'").replace(/[\u201c\u201d]/g, '"')
  .replace(/[^\x20-\x7e]/g, ' ').replace(/\s+/g, ' ').trim().toUpperCase();

function renderCard({ top = '', title = '', desc = '', meta = [], single = false }) {
  const c = canvas();
  const WHITE = [244, 240, 255], MUTED = [176, 170, 214], ACCENT = [255, 204, 226];
  const MAXW = W - 140;
  const fit = (str, s, w) => { let t = str; while (t && c.width(t + '...', s) > w) t = t.slice(0, -1); return (t.trimEnd() || '') + '...'; };
  // greedy wrap that prefers breaking after spaces and / - _ .; over-long tokens are cut by characters
  const wrap = (str, s, maxLines) => {
    const toks = str.match(/[^ \/\-_.]+[ \/\-_.]*|[ \/\-_.]+/g) || [];
    const lines = [''];
    for (let t of toks) {
      const cur = () => lines[lines.length - 1];
      if (c.width((cur() + t).trimEnd(), s) <= MAXW) { lines[lines.length - 1] += t; continue; }
      if (cur()) lines.push('');
      while (c.width(t.trimEnd(), s) > MAXW) {
        let k = t.length - 1; while (k > 1 && c.width(t.slice(0, k), s) > MAXW) k--;
        lines[lines.length - 1] = t.slice(0, k); lines.push(''); t = t.slice(k);
      }
      lines[lines.length - 1] = t;
    }
    const out = lines.map((l) => l.trim()).filter(Boolean);
    if (out.length > maxLines) { const cut = out.slice(0, maxLines); cut[maxLines - 1] = fit(cut[maxLines - 1] + ' ' + out.slice(maxLines).join(' '), s, MAXW); return { lines: cut, cut: true }; }
    return { lines: out, cut: false };
  };
  const draw = (lines, y, s, gap, col) => { lines.forEach((l, i) => c.text(l, 70, y + i * (7 * s + gap), s, col)); return y + (lines.length - 1) * (7 * s + gap) + 7 * s; };

  const T = asc(title) || '-';
  const tops = (Array.isArray(top) ? top : [top]).filter(Boolean);
  tops.forEach((t, i) => c.text(wrapOne(t), 70, 40 + i * 40, 4, ACCENT));
  const ty = 100 + Math.max(0, tops.length - 1) * 40; // title starts below the label lines
  function wrapOne(v) { const t = asc(v); return c.width(t, 4) > MAXW ? fit(t, 4, MAXW) : t; }
  let w, end;
  if (single) {
    // one line: shrink the text until it fits, then drop leading directories (keep the file name)
    const sz = [10, 8, 7, 6, 5, 4].find((z) => c.width(T, z) <= MAXW) || 4;
    let t = T;
    if (c.width(t, sz) > MAXW) { while (t.length > 1 && c.width('...' + t, sz) > MAXW) t = t.slice(1); t = '...' + t; }
    end = draw([t], ty, sz, 0, WHITE);
  } else {
    w = wrap(T, 10, 2);
  }
  if (single) { /* drawn above */ } else if (w.cut) { w = wrap(T, 5, 3); end = draw(w.lines, ty, 5, 15, WHITE); } else end = draw(w.lines, ty, 10, 20, WHITE);
  const D = asc(desc).length * 2 < String(desc || '').replace(/\s+/g, ' ').trim().length ? '' : asc(desc); // mostly non-ASCII text would leave only fragments
  if (D) draw(wrap(D, 4, 2).lines, end + 40, 4, 14, MUTED);
  const M = meta.map(asc).filter(Boolean).join(' / ');
  if (M) c.text(c.width(M, 4) > MAXW ? fit(M, 4, MAXW) : M, 70, 480, 4, WHITE);
  c.text('GH.LAPIUS7.COM', 70, 552, 4, MUTED);
  c.sky(); c.scrim(); c.flush();
  return c.png(1);
}

module.exports = { renderOg, renderCard };
