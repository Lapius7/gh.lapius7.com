// fx2.js — extra polish layer: aurora backdrop, cursor glow, 3D tilt, magnetic buttons, heatmap ripple, hero entrance.
// Purely additive: delegated pointer listeners + CSS in style.css (section "fx2"). Skipped for reduced motion / touch.
(() => {
  const root = document.documentElement;
  if (matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  const fine = matchMedia('(hover: hover) and (pointer: fine)').matches;
  root.classList.add('fx2');

  // ---- aurora backdrop + cursor glow ----
  const aur = document.createElement('div');
  aur.id = 'aurora'; aur.setAttribute('aria-hidden', 'true');
  aur.innerHTML = '<i></i><i></i><i></i>';
  const glow = document.createElement('div');
  glow.id = 'cglow'; glow.setAttribute('aria-hidden', 'true');
  document.body.prepend(aur);
  if (fine) document.body.append(glow);

  let gx = innerWidth / 2, gy = innerHeight / 3, tx = gx, ty = gy, raf = 0;
  const loop = () => {
    gx += (tx - gx) * 0.14; gy += (ty - gy) * 0.14;
    glow.style.transform = `translate3d(${gx - 160}px,${gy - 160}px,0)`;
    raf = Math.abs(tx - gx) + Math.abs(ty - gy) > 0.5 ? requestAnimationFrame(loop) : 0;
  };

  // ---- pointer-driven effects (delegated, so SPA page swaps keep working) ----
  let tilted = null;
  const reset = (el) => { el.style.removeProperty('--rx'); el.style.removeProperty('--ry'); el.classList.remove('tilt'); };
  addEventListener('pointermove', (e) => {
    if (!fine) return;
    tx = e.clientX; ty = e.clientY; glow.classList.add('on');
    if (!raf) raf = requestAnimationFrame(loop);

    const t = e.target.closest && e.target.closest('.card,.repo');
    if (tilted && tilted !== t) { reset(tilted); tilted = null; }
    if (t) {
      const r = t.getBoundingClientRect();
      const px = (e.clientX - r.left) / r.width, py = (e.clientY - r.top) / r.height;
      const big = r.width > 420; // big surfaces tilt only a little
      const k = big ? 1.2 : 4;
      t.style.setProperty('--rx', ((0.5 - py) * k).toFixed(2) + 'deg');
      t.style.setProperty('--ry', ((px - 0.5) * k * 1.4).toFixed(2) + 'deg');
      t.style.setProperty('--gx', (px * 100).toFixed(1) + '%');
      t.style.setProperty('--gy', (py * 100).toFixed(1) + '%');
      t.classList.add('tilt'); tilted = t;
    }

    const m = e.target.closest && e.target.closest('.kbtn,.theme,.totop');
    $$mag.forEach((b) => { if (b !== m) { b.style.removeProperty('--mx2'); b.style.removeProperty('--my2'); } });
    $$mag.length = 0;
    if (m) {
      const r = m.getBoundingClientRect();
      m.style.setProperty('--mx2', ((e.clientX - r.left - r.width / 2) * 0.22).toFixed(1) + 'px');
      m.style.setProperty('--my2', ((e.clientY - r.top - r.height / 2) * 0.3).toFixed(1) + 'px');
      $$mag.push(m);
    }

    // heatmap ripple: neighbours of the hovered cell swell
    const c = e.target.closest && e.target.closest('#cells > *');
    if (c) {
      const cells = c.parentElement.children, i = [...cells].indexOf(c);
      for (const d of [-8, -7, -6, -1, 1, 6, 7, 8]) { const n = cells[i + d]; if (n) { n.classList.add('near'); setTimeout(() => n.classList.remove('near'), 220); } }
    }
  }, { passive: true });
  const $$mag = [];
  document.addEventListener('pointerleave', () => { glow.classList.remove('on'); if (tilted) { reset(tilted); tilted = null; } });
  addEventListener('blur', () => glow.classList.remove('on'));

  // ---- hero entrance: avatar, name, counters rise in sequence on first paint ----
  const hero = () => {
    [...document.querySelectorAll('.profile > *, .crumbs, .ptabs, .tabs')].forEach((el, i) => {
      if (el.dataset.h) return; el.dataset.h = '1';
      el.style.setProperty('--hd', (i * 70) + 'ms'); el.classList.add('hero');
      el.addEventListener('animationend', (ev) => { if (ev.target === el) el.classList.remove('hero'); });
    });
  };
  hero();
  new MutationObserver(hero).observe(document.body, { childList: true, subtree: true });

  // ---- banner softens as you scroll ----
  const bn = document.querySelector('.banner');
  if (bn) addEventListener('scroll', () => { const k = Math.min(1, scrollY / 420); bn.style.setProperty('--bf', (k * 6).toFixed(1) + 'px'); bn.style.setProperty('--bo', (1 - k * 0.45).toFixed(2)); }, { passive: true });

  // ---- press ripple on buttons / tabs ----
  addEventListener('pointerdown', (e) => {
    const b = e.target.closest && e.target.closest('button,.tabs a,.rtabs a,.kbtn');
    if (!b || b.closest('#cmdk')) return;
    const r = b.getBoundingClientRect(), s = document.createElement('span');
    s.className = 'rip';
    s.style.cssText = `left:${e.clientX - r.left}px;top:${e.clientY - r.top}px`;
    if (getComputedStyle(b).position === 'static') b.style.position = 'relative';
    b.style.overflow = b.style.overflow || 'hidden';
    b.append(s); setTimeout(() => s.remove(), 650);
  }, { passive: true });
})();
