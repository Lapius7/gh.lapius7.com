// fx2.js — light polish layer: hero entrance, magnetic buttons, press ripple. CSS in style.css ("fx2").
// No continuous animation, no blur/blend filters, no per-move DOM scans. Skipped for reduced motion.
(() => {
  if (matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  const root = document.documentElement;
  root.classList.add('fx2');
  const fine = matchMedia('(hover: hover) and (pointer: fine)').matches;


  // aurora: radial-gradient blobs moved by transform only (compositor, no blur/blend)
  const aur = document.createElement('div');
  aur.id = 'aurora'; aur.setAttribute('aria-hidden', 'true');
  aur.innerHTML = '<i></i><i></i><i></i>';
  document.body.prepend(aur);
  document.addEventListener('visibilitychange', () => aur.classList.toggle('pause', document.hidden));

  if (fine) {
    // cursor glow + card tilt: one rAF-throttled handler, no layout reads except the hovered card
    const glow = document.createElement('div');
    glow.id = 'cglow'; glow.setAttribute('aria-hidden', 'true');
    document.body.append(glow);
    let tilted = null, f = 0, pe = null;
    const reset = (el) => { el.style.removeProperty('--rx'); el.style.removeProperty('--ry'); el.classList.remove('tilt'); };
    const step = () => {
      f = 0;
      glow.style.transform = `translate3d(${pe.clientX - 160}px,${pe.clientY - 160}px,0)`;
      const t = pe.target.closest && pe.target.closest('.card,.repo');
      if (tilted && tilted !== t) { reset(tilted); tilted = null; }
      if (t) {
        const r = t.getBoundingClientRect();
        const px = (pe.clientX - r.left) / r.width, py = (pe.clientY - r.top) / r.height;
        const k = r.width > 420 ? 1.2 : 4;
        t.style.setProperty('--rx', ((0.5 - py) * k).toFixed(2) + 'deg');
        t.style.setProperty('--ry', ((px - 0.5) * k * 1.4).toFixed(2) + 'deg');
        t.style.setProperty('--gx', (px * 100).toFixed(1) + '%');
        t.style.setProperty('--gy', (py * 100).toFixed(1) + '%');
        t.classList.add('tilt'); tilted = t;
      }
    };
    addEventListener('pointermove', (e) => { pe = e; glow.classList.add('on'); if (!f) f = requestAnimationFrame(step); }, { passive: true });
    document.addEventListener('pointerleave', () => { glow.classList.remove('on'); if (tilted) { reset(tilted); tilted = null; } });
  }

  // hero entrance (runs once per element; class removed afterwards so hover transforms work)
  const hero = () => {
    document.querySelectorAll('.profile > *, .crumbs, .ptabs, .tabs').forEach((el, i) => {
      if (el.dataset.h) return; el.dataset.h = '1';
      el.style.setProperty('--hd', (i * 60) + 'ms'); el.classList.add('hero');
      el.addEventListener('animationend', (ev) => { if (ev.target === el) el.classList.remove('hero'); });
    });
  };
  hero();
  let t = 0;
  new MutationObserver(() => { if (!t) t = setTimeout(() => { t = 0; hero(); }, 100); }).observe(document.body, { childList: true, subtree: true });

  // magnetic buttons: only while the pointer is over one, throttled to a frame
  if (fine) {
    let cur = null, raf = 0, ev = null;
    const apply = () => {
      raf = 0;
      const m = ev.target.closest && ev.target.closest('.kbtn,.theme,.totop');
      if (cur && cur !== m) { cur.style.removeProperty('--mx2'); cur.style.removeProperty('--my2'); }
      cur = m;
      if (m) {
        const r = m.getBoundingClientRect();
        m.style.setProperty('--mx2', ((ev.clientX - r.left - r.width / 2) * 0.2).toFixed(1) + 'px');
        m.style.setProperty('--my2', ((ev.clientY - r.top - r.height / 2) * 0.28).toFixed(1) + 'px');
      }
    };
    addEventListener('pointermove', (e) => {
      if (!cur && !(e.target.closest && e.target.closest('.kbtn,.theme,.totop'))) return;
      ev = e; if (!raf) raf = requestAnimationFrame(apply);
    }, { passive: true });
  }

  // press ripple
  addEventListener('pointerdown', (e) => {
    const b = e.target.closest && e.target.closest('button,.tabs a,.rtabs a,.kbtn');
    if (!b || b.closest('#cmdk')) return;
    const r = b.getBoundingClientRect(), s = document.createElement('span');
    s.className = 'rip';
    s.style.cssText = `left:${e.clientX - r.left}px;top:${e.clientY - r.top}px`;
    if (getComputedStyle(b).position === 'static') b.style.position = 'relative';
    b.style.overflow = b.style.overflow || 'hidden';
    b.append(s); setTimeout(() => s.remove(), 600);
  }, { passive: true });
})();
