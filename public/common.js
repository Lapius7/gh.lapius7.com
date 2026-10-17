document.querySelectorAll('.wave').forEach((w) => {
  w.innerHTML = Array.from({ length: 70 }, (_, k) => `<i style="animation-delay:${(k % 14) * 70 + Math.floor(k / 14) * 40}ms"></i>`).join('');
});
const $ = (id) => document.getElementById(id);
const WD = ['Sundays','Mondays','Tuesdays','Wednesdays','Thursdays','Fridays','Saturdays'];
const MON = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
// ---- banner: halftone dot-matrix clouds ----
function banner(){
  const c = $('bn'), x = c.getContext('2d');
  const w = c.width = c.clientWidth, h = c.height = c.clientHeight, step = 5;
  const bg = getComputedStyle(document.documentElement).getPropertyValue('--bg');
  const noise = (px, py) => {
    let v = 0, a = 1, f = 1/90;
    for (let i = 0; i < 4; i++) { v += a * (Math.sin(px*f*1.7 + i*3.1) * Math.cos(py*f*2.3 - i*1.3) + Math.sin((px+py)*f*0.9 + i)); a *= .5; f *= 2; }
    return v;
  };
  x.clearRect(0,0,w,h);
  for (let py = 0; py < h; py += step) for (let px = 0; px < w; px += step) {
    const n = noise(px, py), t = Math.min(1, Math.max(0, (n + 1.6) / 3.2));
    const sky = [28 + 40*(1-py/h), 78 + 50*t, 170 + 40*t], cloud = [214, 200, 164];
    const k = t > .62 ? (t - .62) / .38 : 0;
    const col = sky.map((s, i) => Math.round(s*(1-k) + cloud[i]*k));
    x.fillStyle = `rgb(${col})`;
    x.beginPath(); x.arc(px + step/2, py + step/2, step*0.38, 0, 6.3); x.fill();
  }
}

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
banner(); addEventListener('resize', banner);
