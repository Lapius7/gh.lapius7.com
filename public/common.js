document.querySelectorAll('.wave').forEach((w) => {
  w.innerHTML = Array.from({ length: 70 }, (_, k) => `<i style="animation-delay:${(k % 14) * 70 + Math.floor(k / 14) * 40}ms"></i>`).join('');
});
const $ = (id) => document.getElementById(id);
const WD = ['Sundays','Mondays','Tuesdays','Wednesdays','Thursdays','Fridays','Saturdays'];
const MON = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
// ---- banner: sky and clouds drawn on a character grid, with wind streaks under the cursor ----
const banner = (() => {
  const CELL = 8, RAMP = ' .:;o(8', STREAK = ['-', '\\', '|', '/'];
  const PAL = {
    light: { skyTop: [92, 168, 226], skyBot: [196, 228, 246], dot: [64, 146, 214], cloud: [255, 255, 255], ink: [78, 104, 140], wind: [10, 80, 170] },
    dark:  { skyTop: [12, 34, 84],   skyBot: [40, 86, 152],   dot: [64, 126, 206], cloud: [196, 212, 236], ink: [34, 54, 98],  wind: [120, 180, 250] },
  };
  const mix = (a, b, k) => [a[0] + (b[0] - a[0]) * k, a[1] + (b[1] - a[1]) * k, a[2] + (b[2] - a[2]) * k];
  const rgb = (c, a = 1) => `rgba(${c[0] | 0},${c[1] | 0},${c[2] | 0},${a})`;
  const smooth = (e0, e1, v) => { const t = Math.min(1, Math.max(0, (v - e0) / (e1 - e0))); return t * t * (3 - 2 * t); };
  const hash = (x, y) => { const h = Math.sin(x * 127.1 + y * 311.7) * 43758.5453; return h - Math.floor(h); };
  // Cloud density: layered sine noise that drifts to the right over time.
  const density = (cx, cy, t) => {
    let v = 0, a = 1, f = 0.035;
    for (let i = 0; i < 4; i++) {
      v += a * (Math.sin(cx * f * 1.7 + t * 0.35 + i * 3.1) * Math.cos(cy * f * 3.1 - i * 1.3) + Math.sin((cx + cy * 0.6) * f * 0.9 - t * 0.2 + i));
      a *= 0.55; f *= 2;
    }
    return smooth(0.8, 1.7, v);
  };

  let raf = 0, stop = () => {};
  return function banner() {
    stop();
    const el = document.querySelector('.banner'), c = $('bn'), ctx = c.getContext('2d');
    if (!el || !c || !ctx) return;
    const still = matchMedia('(prefers-reduced-motion: reduce)').matches;
    let w = 0, h = 0, cols = 0, rows = 0, last = 0;
    const streaks = [];
    const fit = () => {
      const dpr = Math.min(devicePixelRatio || 1, 2);
      w = c.clientWidth; h = c.clientHeight;
      if (!w || !h) return false;
      c.width = Math.round(w * dpr); c.height = Math.round(h * dpr);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      cols = Math.ceil(w / CELL); rows = Math.ceil(h / CELL);
      return true;
    };
    const draw = (now) => {
      const t = now / 1000, P = PAL[document.documentElement.dataset.theme === 'light' ? 'light' : 'dark'];
      ctx.fillStyle = rgb(P.skyBot); ctx.fillRect(0, 0, w, h);
      ctx.font = `${CELL + 3}px ui-monospace, Menlo, Consolas, monospace`;
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      for (let r = 0; r < rows; r++) {
        const vy = r / rows, sky = mix(P.skyTop, P.skyBot, Math.pow(vy, 0.8));
        for (let q = 0; q < cols; q++) {
          const x = q * CELL, y = r * CELL, d = density(q, r, t);
          if (d < 0.04) {
            // Open sky: a small square, larger and denser toward the top.
            const s = 2 + (1 - vy) * 2.2 + hash(q, r) * 0.6;
            ctx.fillStyle = rgb(P.dot, 0.28 + (1 - vy) * 0.4);
            ctx.fillRect(x + (CELL - s) / 2, y + (CELL - s) / 2, s, s);
            continue;
          }
          ctx.fillStyle = rgb(mix(sky, P.cloud, Math.min(1, d * 1.15)));
          ctx.fillRect(x, y, CELL, CELL);
          if (d < 0.8) {
            // Cloud edge: a character picked by density, with a little per-cell variation.
            const i = Math.min(RAMP.length - 1, Math.floor(d * RAMP.length * 1.15 + hash(q, r) * 1.2));
            if (RAMP[i] !== ' ') { ctx.fillStyle = rgb(P.ink, 0.45 + d * 0.5); ctx.fillText(RAMP[i], x + CELL / 2, y + CELL / 2 + 0.5); }
          }
        }
      }
      for (let i = streaks.length - 1; i >= 0; i--) {
        const s = streaks[i], life = 1 - (now - s.t0) / 900;
        if (life <= 0) { streaks.splice(i, 1); continue; }
        ctx.fillStyle = rgb(P.wind, life * 0.9);
        for (let k = 0; k < 6; k++) ctx.fillText(s.ch, (s.q + s.dq * k) * CELL + CELL / 2, (s.r + s.dr * k) * CELL + CELL / 2);
      }
    };
    const loop = (now) => { raf = requestAnimationFrame(loop); if (now - last < 33) return; last = now; draw(now); };
    let px = -1, py = -1;
    const move = (e) => {
      const b = el.getBoundingClientRect(), x = e.clientX - b.left, y = e.clientY - b.top;
      if (px >= 0 && Math.hypot(x - px, y - py) > 14) {
        const ang = Math.atan2(y - py, x - px), oct = Math.round(ang / (Math.PI / 4));
        const dq = Math.round(Math.cos(oct * Math.PI / 4)), dr = Math.round(Math.sin(oct * Math.PI / 4));
        const ch = dq === 0 ? '|' : dr === 0 ? '-' : dq * dr > 0 ? '\\' : '/';
        streaks.push({ q: Math.floor(x / CELL), r: Math.floor(y / CELL), dq, dr, ch, t0: performance.now() });
        if (streaks.length > 60) streaks.shift();
        px = x; py = y;
      } else if (px < 0) { px = x; py = y; }
    };
    const leave = () => { px = py = -1; };
    const ro = new ResizeObserver(() => { if (fit()) draw(performance.now()); });
    ro.observe(c);
    if (fit()) draw(performance.now());
    if (!still) { raf = requestAnimationFrame(loop); el.addEventListener('pointermove', move); el.addEventListener('pointerleave', leave); }
    stop = () => { cancelAnimationFrame(raf); ro.disconnect(); el.removeEventListener('pointermove', move); el.removeEventListener('pointerleave', leave); };
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
