document.querySelectorAll('.wave').forEach((w) => {
  w.innerHTML = Array.from({ length: 70 }, (_, k) => `<i style="animation-delay:${(k % 14) * 70 + Math.floor(k / 14) * 40}ms"></i>`).join('');
});
const $ = (id) => document.getElementById(id);
const WD = ['Sundays','Mondays','Tuesdays','Wednesdays','Thursdays','Fridays','Saturdays'];
const MON = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
// ---- banner: sky on a tiled character grid, drifting clouds, and wind gusts that follow the cursor ----
const banner = (() => {
  const CELL = 8;
  const PAL = {
    light: { gap: [246, 251, 254], pale: [226, 241, 250], mid: [164, 211, 240], dot: [38, 128, 206], cloud: [255, 255, 255], ink: [112, 132, 160], wind: [28, 104, 190], k: 0.35 },
    dark:  { gap: [10, 22, 52],    pale: [26, 52, 104],   mid: [44, 88, 158],   dot: [96, 156, 232], cloud: [206, 220, 242], ink: [150, 176, 220], wind: [150, 200, 255], k: 0.1 },
  };
  const mix = (a, b, k) => [a[0] + (b[0] - a[0]) * k, a[1] + (b[1] - a[1]) * k, a[2] + (b[2] - a[2]) * k];
  const rgb = (c, a = 1) => `rgba(${c[0] | 0},${c[1] | 0},${c[2] | 0},${a})`;
  const smooth = (e0, e1, v) => { const t = Math.min(1, Math.max(0, (v - e0) / (e1 - e0))); return t * t * (3 - 2 * t); };
  const hash = (x, y) => { const h = Math.sin(x * 127.1 + y * 311.7) * 43758.5453; return h - Math.floor(h); };
  const vnoise = (x, y) => {
    const xi = Math.floor(x), yi = Math.floor(y), u = x - xi, v = y - yi;
    const su = u * u * (3 - 2 * u), sv = v * v * (3 - 2 * v);
    const a = hash(xi, yi), b = hash(xi + 1, yi), c = hash(xi, yi + 1), d = hash(xi + 1, yi + 1);
    return a + (b - a) * su + (c - a) * sv + (a - b - c + d) * su * sv;
  };
  const fbm = (x, y) => (vnoise(x, y) * 0.55 + vnoise(x * 2.1 + 7, y * 2.1 + 3) * 0.3 + vnoise(x * 4.3 + 1, y * 4.3 + 9) * 0.15);
  const EDGE = ['.', ',', ':', ';', '~', ')', '(', 'o', '8', '%'];
  const MAX_GUSTS = 14, LIFE = 1200;

  let raf = 0, stop = () => {};
  return function banner() {
    stop();
    const el = document.querySelector('.banner'), c = $('bn'), ctx = c && c.getContext('2d');
    if (!el || !ctx) return;
    const still = matchMedia('(prefers-reduced-motion: reduce)').matches;
    let w = 0, h = 0, cols = 0, rows = 0, last = 0;
    const gusts = [];
    const fit = () => {
      const dpr = Math.min(devicePixelRatio || 1, 2);
      w = c.clientWidth; h = c.clientHeight;
      if (!w || !h) return false;
      c.width = Math.round(w * dpr); c.height = Math.round(h * dpr);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      cols = Math.ceil(w / CELL); rows = Math.ceil(h / CELL);
      return true;
    };
    const drawGust = (g, now, P) => {
      const age = now - g.t0, life = 1 - age / LIFE;
      if (life <= 0) return false;
      const grow = Math.min(1, age / 260), drift = age * 0.012;
      ctx.strokeStyle = rgb(P.wind, Math.min(1, life * 1.4));
      ctx.lineWidth = 2; ctx.lineCap = 'butt';
      const cs = Math.cos(g.a), sn = Math.sin(g.a);
      for (const L of g.lines) {
        const len = L.len * grow, ox = g.x - sn * L.off + cs * (L.shift + drift), oy = g.y + cs * L.off + sn * (L.shift + drift);
        ctx.beginPath();
        if (L.kind === 0) {
          ctx.moveTo(ox, oy); ctx.lineTo(ox + cs * len, oy + sn * len);
        } else if (L.kind === 1) {
          for (let s = 0; s <= len; s += 2) {
            const wv = Math.sin(s / 3 + age / 140) * 2;
            const px = ox + cs * s - sn * wv, py = oy + sn * s + cs * wv;
            s === 0 ? ctx.moveTo(px, py) : ctx.lineTo(px, py);
          }
        } else {
          // Hatch: short strokes slanted against the direction of travel.
          const sa = g.a + Math.PI / 4, hx = Math.cos(sa) * 6, hy = Math.sin(sa) * 6;
          for (let s = 0; s <= len; s += 4) { const px = ox + cs * s, py = oy + sn * s; ctx.moveTo(px - hx / 2, py - hy / 2); ctx.lineTo(px + hx / 2, py + hy / 2); }
        }
        ctx.stroke();
      }
      return true;
    };
    const draw = (now) => {
      const t = now / 1000, P = PAL[document.documentElement.dataset.theme === 'light' ? 'light' : 'dark'];
      ctx.fillStyle = rgb(P.gap); ctx.fillRect(0, 0, w, h);
      ctx.font = `${CELL + 3}px ui-monospace, Menlo, Consolas, monospace`;
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      for (let r = 0; r < rows; r++) {
        const vy = r / rows, top = Math.pow(1 - vy, 1.4);
        for (let q = 0; q < cols; q++) {
          const x = q * CELL, y = r * CELL;
          const n = fbm(q * 0.075 - t * 0.55 * 0.075, r * 0.14 + 4);
          if (n > 0.665) { ctx.fillStyle = rgb(P.cloud); ctx.fillRect(x, y, CELL, CELL); continue; }
          const m = fbm(q * 0.11 + t * 0.03, r * 0.16 + t * 0.02 + 20);
          const tint = Math.min(1, Math.max(0, (m - 0.38) * 1.1 + top * 0.4));
          if (n > 0.575) {
            // Cloud edge: pale tile with a glyph, heavier glyphs nearer the white.
            ctx.fillStyle = rgb(mix(P.pale, P.cloud, P.k)); ctx.fillRect(x + 0.5, y + 0.5, CELL - 1, CELL - 1);
            const k = (n - 0.575) / 0.09, i = Math.min(EDGE.length - 1, Math.floor(k * 7 + hash(q, r) * 3.2));
            ctx.fillStyle = rgb(P.ink, 0.55 + k * 0.4); ctx.fillText(EDGE[i], x + CELL / 2, y + CELL / 2 + 0.5);
            continue;
          }
          const near = smooth(0.5, 0.575, n);
          ctx.fillStyle = rgb(mix(mix(P.pale, P.mid, tint * 0.85), P.cloud, near * P.k));
          ctx.fillRect(x + 0.5, y + 0.5, CELL - 1, CELL - 1);
          const s = 1 + Math.round((tint * 2.4 + top * 1.2) * (1 - near)) + (hash(q, r) > 0.8 ? 1 : 0);
          ctx.fillStyle = rgb(P.dot, 0.3 + tint * 0.45);
          ctx.fillRect(x + (CELL - s) / 2, y + (CELL - s) / 2, s, s);
        }
      }
      for (let i = gusts.length - 1; i >= 0; i--) if (!drawGust(gusts[i], now, P)) gusts.splice(i, 1);
    };
    const loop = (now) => { raf = requestAnimationFrame(loop); if (now - last < 33) return; last = now; draw(now); };
    let px = -1, py = -1, acc = 0;
    const move = (e) => {
      const b = el.getBoundingClientRect(), x = e.clientX - b.left, y = e.clientY - b.top;
      if (x < 0 || y < 0 || x > b.width || y > b.height) { px = py = -1; return; }
      if (px < 0) { px = x; py = y; return; }
      const dx = x - px, dy = y - py, d = Math.hypot(dx, dy);
      acc += d; px = x; py = y;
      if (acc < 60 || d < 1) return;
      acc = 0;
      const a = Math.atan2(dy, dx), n = 2 + Math.floor(Math.random() * 2), lines = [];
      for (let i = 0; i < n; i++) lines.push({ off: (i - (n - 1) / 2) * 7 + (Math.random() - 0.5) * 3, len: 30 + Math.random() * 60, shift: -20 + Math.random() * 40, kind: Math.random() < 0.45 ? 0 : Math.random() < 0.6 ? 1 : 2 });
      gusts.push({ x, y, a, lines, t0: performance.now() });
      if (gusts.length > MAX_GUSTS) gusts.shift();
    };
    const ro = new ResizeObserver(() => { if (fit()) draw(performance.now()); });
    ro.observe(c);
    if (fit()) draw(performance.now());
    if (!still) { raf = requestAnimationFrame(loop); addEventListener('pointermove', move, { passive: true }); }
    stop = () => { cancelAnimationFrame(raf); ro.disconnect(); removeEventListener('pointermove', move); };
  };
})();

const ago = (iso) => { const m = (Date.now() - new Date(iso)) / 6e4; return m < 60 ? `${Math.max(1,Math.round(m))}m ago` : m < 1440 ? `${Math.round(m/60)}h ago` : `${Math.round(m/1440)}d ago`; };

$('theme').onclick = (e) => {
  const root = document.documentElement, btn = $('theme');
  const next = root.dataset.theme === 'light' ? 'dark' : 'light';
  const apply = () => {
    root.dataset.theme = next; root.style.colorScheme = next;
    try { localStorage.setItem('theme', next); } catch {}
    banner();
  };
  btn.classList.toggle('spin');
  const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
  if (!document.startViewTransition || reduce) {
    root.classList.add('fade'); apply(); setTimeout(() => root.classList.remove('fade'), 450); return;
  }
  const r = btn.getBoundingClientRect(), x = r.left + r.width / 2, y = r.top + r.height / 2;
  const rad = Math.hypot(Math.max(x, innerWidth - x), Math.max(y, innerHeight - y));
  document.startViewTransition(apply).ready.then(() =>
    root.animate({ clipPath: [`circle(0px at ${x}px ${y}px)`, `circle(${rad}px at ${x}px ${y}px)`] },
      { duration: 650, easing: 'ease-in-out', pseudoElement: '::view-transition-new(root)' }));
};
try { const t = localStorage.getItem('theme'); if (t) { document.documentElement.dataset.theme = t; document.documentElement.style.colorScheme = t; } } catch {}
banner();
