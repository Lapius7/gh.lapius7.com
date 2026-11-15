document.querySelectorAll('.wave').forEach((w) => {
  w.innerHTML = Array.from({ length: 70 }, (_, k) => `<i style="animation-delay:${(k % 14) * 70 + Math.floor(k / 14) * 40}ms"></i>`).join('');
});
const $ = (id) => document.getElementById(id);
const WD = ['Sundays','Mondays','Tuesdays','Wednesdays','Thursdays','Fridays','Saturdays'];
const MON = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
// ---- banner: a halftone dot sky with soft drifting clouds; the cursor leaves a glowing wake ----
const banner = (() => {
  const CELL = 7;
  const THEMES = {
    dark: {
      sky: [[0, [8, 12, 34]], [0.4, [20, 28, 74]], [0.75, [52, 42, 102]], [1, [104, 66, 124]]],
      cloud: [186, 178, 236], warm: [255, 188, 168], shade: [26, 30, 78], rim: [236, 232, 255],
      glow: [196, 208, 255], glowAt: [0.82, 0.2], glowA: 0.2, glowR: 240, star: true, accent: [110, 224, 255],
    },
    light: {
      sky: [[0, [112, 190, 242]], [0.45, [164, 214, 246]], [0.8, [222, 238, 250]], [1, [252, 244, 236]]],
      cloud: [255, 255, 255], warm: [255, 226, 206], shade: [150, 178, 214], rim: [255, 255, 255],
      glow: [255, 250, 236], glowAt: [0.14, 0.18], glowA: 0.45, glowR: 280, star: false, accent: [36, 128, 255],
    },
  };
  const mix = (a, b, k) => [a[0] + (b[0] - a[0]) * k, a[1] + (b[1] - a[1]) * k, a[2] + (b[2] - a[2]) * k];
  const rgb = (c, a = 1) => `rgba(${c[0] | 0},${c[1] | 0},${c[2] | 0},${a})`;
  const clamp = (v, lo = 0, hi = 1) => Math.min(hi, Math.max(lo, v));
  const smooth = (e0, e1, v) => { const t = clamp((v - e0) / (e1 - e0)); return t * t * (3 - 2 * t); };
  const hash = (x, y) => { const h = Math.sin(x * 127.1 + y * 311.7) * 43758.5453; return h - Math.floor(h); };
  const vnoise = (x, y) => {
    const xi = Math.floor(x), yi = Math.floor(y), u = x - xi, v = y - yi;
    const su = u * u * (3 - 2 * u), sv = v * v * (3 - 2 * v);
    const a = hash(xi, yi), b = hash(xi + 1, yi), c = hash(xi, yi + 1), d = hash(xi + 1, yi + 1);
    return a + (b - a) * su + (c - a) * sv + (a - b - c + d) * su * sv;
  };
  const fbm = (x, y) => vnoise(x, y) * 0.55 + vnoise(x * 2.1 + 7, y * 2.1 + 3) * 0.3 + vnoise(x * 4.3 + 1, y * 4.3 + 9) * 0.15;
  const sample = (stops, v) => {
    for (let i = 1; i < stops.length; i++) if (v <= stops[i][0]) return mix(stops[i - 1][1], stops[i][1], (v - stops[i - 1][0]) / (stops[i][0] - stops[i - 1][0]));
    return stops[stops.length - 1][1];
  };
  const WAKE_R = 5, DECAY = 0.95;

  let raf = 0, stop = () => {};
  return function banner() {
    stop();
    const el = document.querySelector('.banner'), c = $('bn'), ctx = c && c.getContext('2d');
    if (!el || !ctx) return;
    const still = matchMedia('(prefers-reduced-motion: reduce)').matches;
    let w = 0, h = 0, cols = 0, rows = 0, last = 0, dens = new Float32Array(0), wake = new Float32Array(0);
    const fit = () => {
      const dpr = Math.min(devicePixelRatio || 1, 2);
      w = c.clientWidth; h = c.clientHeight;
      if (!w || !h) return false;
      c.width = Math.round(w * dpr); c.height = Math.round(h * dpr);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      cols = Math.ceil(w / CELL); rows = Math.ceil(h / CELL);
      dens = new Float32Array(cols * rows); wake = new Float32Array(cols * rows);
      return true;
    };
    const draw = (now) => {
      const t = now / 1000, T = THEMES[document.documentElement.dataset.theme === 'light' ? 'light' : 'dark'];
      // Backdrop gradient and a soft sun/moon glow.
      const g = ctx.createLinearGradient(0, 0, 0, h);
      T.sky.forEach(([p, col]) => g.addColorStop(p, rgb(col)));
      ctx.fillStyle = g; ctx.fillRect(0, 0, w, h);
      const gx = T.glowAt[0] * w, gy = T.glowAt[1] * h, gg = ctx.createRadialGradient(gx, gy, 0, gx, gy, T.glowR);
      gg.addColorStop(0, rgb(T.glow, T.glowA)); gg.addColorStop(1, rgb(T.glow, 0));
      ctx.fillStyle = gg; ctx.fillRect(0, 0, w, h);
      // Cloud density per cell: slow drift, a fine wisp layer on top.
      for (let r = 0; r < rows; r++) for (let q = 0; q < cols; q++) {
        const n = fbm(q * 0.04 - t * 0.08, r * 0.085 + 3), wisp = fbm(q * 0.09 - t * 2.6 * 0.09, r * 0.26 + 11);
        dens[r * cols + q] = clamp(smooth(0.4, 0.7, n) * (0.7 + 0.6 * wisp));
      }
      for (let r = 0; r < rows; r++) {
        const vy = r / rows, base = sample(T.sky, vy);
        for (let q = 0; q < cols; q++) {
          const i = r * cols + q, d = dens[i], e = wake[i];
          const below = r + 1 < rows ? dens[i + cols] : d, above = r > 0 ? dens[i - cols] : d;
          const x = q * CELL + CELL / 2, y = r * CELL + CELL / 2, hs = hash(q, r);
          let rad, col, alpha;
          if (d > 0.04) {
            // Cloud: larger, lighter dots; lit rim on top edges, cooler shade underneath.
            let cc = mix(T.cloud, T.warm, vy * 0.55);
            cc = mix(cc, T.rim, clamp((d - below) * 3.5) * 0.6);
            cc = mix(cc, T.shade, clamp((d - above) * 3) * 0.4);
            col = mix(base, cc, 0.5 + 0.5 * d); rad = 0.7 + d * 2.7; alpha = 0.5 + d * 0.5;
          } else {
            col = mix(base, [255, 255, 255], 0.22); rad = 0.55 + hs * 0.5 + (1 - vy) * 0.35; alpha = 0.45;
            if (T.star && hs > 0.982 - (1 - vy) * 0.012) {
              const tw = 0.5 + 0.5 * Math.sin(t * (1 + hs * 3) + hs * 40);
              col = [235, 240, 255]; rad = 0.9 + tw * 0.9; alpha = 0.35 + tw * 0.65;
            }
          }
          if (e > 0.01) { col = mix(col, T.accent, clamp(e) * 0.85); rad += e * 2.2; alpha = Math.min(1, alpha + e * 0.5); }
          ctx.fillStyle = rgb(col, alpha);
          ctx.beginPath(); ctx.arc(x, y, Math.min(rad, CELL / 2 + 0.3), 0, 6.2832); ctx.fill();
        }
      }
      for (let i = 0; i < wake.length; i++) wake[i] *= DECAY;
    };
    const loop = (now) => { raf = requestAnimationFrame(loop); if (now - last < 33) return; last = now; draw(now); };

    // Cursor wake: each step adds energy around the pointer, which swells and tints the nearby dots, then fades.
    let pq = -1, pr = -1;
    const splat = (q, r) => {
      for (let dr = -WAKE_R; dr <= WAKE_R; dr++) for (let dq = -WAKE_R; dq <= WAKE_R; dq++) {
        const qq = q + dq, rr = r + dr;
        if (qq < 0 || rr < 0 || qq >= cols || rr >= rows) continue;
        const k = 1 - Math.hypot(dq, dr) / (WAKE_R + 0.5);
        if (k > 0) wake[rr * cols + qq] = Math.min(1.3, wake[rr * cols + qq] + k * k * 0.4);
      }
    };
    const move = (e) => {
      const b = c.getBoundingClientRect(), x = e.clientX - b.left, y = e.clientY - b.top;
      if (x < 0 || y < 0 || x >= b.width || y >= b.height) { pq = pr = -1; return; }
      const q = Math.floor(x / CELL), r = Math.floor(y / CELL);
      if (pq < 0) { pq = q; pr = r; }
      const steps = Math.max(Math.abs(q - pq), Math.abs(r - pr), 1);
      for (let i = 1; i <= steps; i++) splat(Math.round(pq + (q - pq) * i / steps), Math.round(pr + (r - pr) * i / steps));
      pq = q; pr = r;
    };
    const leave = () => { pq = pr = -1; };
    const ro = new ResizeObserver(() => { if (fit()) draw(performance.now()); });
    ro.observe(c);
    if (fit()) draw(performance.now());
    if (!still) { raf = requestAnimationFrame(loop); addEventListener('pointermove', move, { passive: true }); document.addEventListener('pointerleave', leave); }
    stop = () => { cancelAnimationFrame(raf); ro.disconnect(); removeEventListener('pointermove', move); document.removeEventListener('pointerleave', leave); };
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
