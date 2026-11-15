// fx.js — motion and navigation extras shared by every page. Reads the DOM only; the pages' own render code is untouched.
(() => {
  const root = document.documentElement;
  const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const MAC = /Mac|iPhone|iPad/.test(navigator.platform || '');
  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => [...r.querySelectorAll(s)];
  if (!reduce) root.classList.add('fx');

  // ---- scroll progress bar, back-to-top button, banner parallax ----
  const prog = document.createElement('div');
  prog.id = 'fxprog'; prog.setAttribute('aria-hidden', 'true');
  const top = document.createElement('button');
  top.className = 'totop'; top.type = 'button'; top.setAttribute('aria-label', 'Back to top'); top.textContent = '↑';
  top.onclick = () => scrollTo({ top: 0, behavior: reduce ? 'auto' : 'smooth' });
  document.body.append(prog, top);
  const bn = $('.banner canvas');
  let ticking = false;
  const onScroll = () => {
    ticking = false;
    const y = scrollY, max = root.scrollHeight - innerHeight;
    prog.style.setProperty('--p', max > 0 ? Math.min(1, y / max).toFixed(4) : 0);
    top.classList.toggle('show', y > 640);
    if (bn && !reduce) bn.style.transform = `translate3d(0,${(Math.min(y, 700) * 0.3).toFixed(1)}px,0)`;
  };
  addEventListener('scroll', () => { if (!ticking) { ticking = true; requestAnimationFrame(onScroll); } }, { passive: true });
  addEventListener('resize', onScroll);
  onScroll();

  // ---- spotlight that follows the pointer on cards and the search box ----
  addEventListener('pointermove', (e) => {
    const t = e.target.closest && e.target.closest('.card,.search');
    if (!t) return;
    const r = t.getBoundingClientRect();
    t.style.setProperty('--mx', (e.clientX - r.left) + 'px');
    t.style.setProperty('--my', (e.clientY - r.top) + 'px');
  }, { passive: true });

  // ---- tab bars: a single underline that slides between tabs; panes fade in on switch ----
  const placeInd = (bar) => {
    const on = $('button.on,a.on', bar), ind = bar._ind;
    if (!on || !on.offsetWidth) return;
    ind.style.width = on.offsetWidth + 'px';
    ind.style.transform = `translate(${on.offsetLeft}px,${on.offsetTop + on.offsetHeight - 1}px)`;
    if (!ind._ready) requestAnimationFrame(() => requestAnimationFrame(() => { ind._ready = 1; bar.classList.add('ready'); }));
  };
  const setupBars = () => $$('.tabs:not(.fx-bar)').forEach((bar) => {
    bar.classList.add('fx-bar');
    const ind = document.createElement('i'); ind.className = 'ind'; ind.setAttribute('aria-hidden', 'true');
    bar._ind = ind; bar.append(ind);
    const upd = () => placeInd(bar);
    new ResizeObserver(upd).observe(bar);
    new MutationObserver(upd).observe(bar, { attributes: true, attributeFilter: ['class'], subtree: true });
    document.fonts && document.fonts.ready.then(upd);
    upd();
  });
  const nav = () => document.body.classList.add('fx-nav');
  document.addEventListener('click', (e) => { if (e.target.closest && e.target.closest('.ptabs button')) nav(); }, true);
  addEventListener('popstate', nav);

  // ---- reveal-on-scroll, count-up, bar growth ----
  const REVEAL = '.stat,.heatcard,.search,section.blk>h2,.two>div,.card,.repo,.item,.empty,.crumbs a.ic,.rhead,.md';
  const fmt = (n, comma) => (comma ? n.toLocaleString() : String(n));
  const countUp = (el) => {
    const m = /^(\d[\d,]*)(\.\d+)?(\s[^\d]*)?$/.exec(el.textContent.trim());
    if (!m || m[2]) return;
    const comma = m[1].includes(','), end = +m[1].replace(/,/g, ''), tail = m[3] || '';
    if (end < 10) return;
    const t0 = performance.now(), dur = Math.min(1100, 500 + Math.log10(end) * 150);
    let last = el.textContent;
    const step = (now) => {
      if (el.textContent !== last) return; // the page re-rendered this node meanwhile
      const k = Math.min(1, (now - t0) / dur), v = Math.round(end * (1 - Math.pow(2, -10 * k)) / (1 - Math.pow(2, -10)));
      last = fmt(k < 1 ? v : end, comma) + tail;
      el.textContent = last;
      if (k < 1) requestAnimationFrame(step);
    };
    el.textContent = fmt(0, comma) + tail;
    last = el.textContent;
    requestAnimationFrame(step);
  };
  const io = reduce ? null : new IntersectionObserver((entries) => {
    let i = 0;
    for (const e of entries) {
      if (!e.isIntersecting) continue;
      const el = e.target, k = el._fx;
      io.unobserve(el);
      if (k === 'rv') {
        el.style.setProperty('--rd', Math.min(i++, 8) * 45 + 'ms');
        el.classList.add('in');
        el.addEventListener('animationend', (ev) => {
          if (ev.target !== el) return;
          el.classList.remove('rv', 'in'); el.style.removeProperty('--rd');
        }, { once: false });
      } else if (k === 'go') el.classList.add('go');
      else if (k === 'num') countUp(el);
    }
  }, { rootMargin: '0px 0px -5% 0px', threshold: 0.05 });
  const seen = new WeakSet(), heatDone = new WeakSet();
  const watch = (el, k) => { if (seen.has(el)) return; seen.add(el); el._fx = k; if (k === 'rv') el.classList.add('rv'); io.observe(el); };
  const scan = () => {
    setupBars();
    if (reduce) return;
    $$(REVEAL).forEach((el) => watch(el, 'rv'));
    $$('.bars,.stack').forEach((el) => {
      if (!seen.has(el)) { [...el.children].forEach((c, i) => c.style.setProperty('--i', i)); watch(el, 'go'); }
    });
    $$('.num').forEach((el) => { if (el.textContent.trim()) watch(el, 'num'); });
    const cells = $('#cells'), first = cells && cells.firstElementChild;
    if (first && !heatDone.has(first)) {
      heatDone.add(first);
      [...cells.children].forEach((c, i) => { c.style.animationDelay = (Math.floor(i / 7) * 7 + (i % 7) * 12) + 'ms'; });
    }
  };
  new MutationObserver((ms) => {
    if (ms.some((m) => { const t = m.target.nodeType === 1 ? m.target : m.target.parentElement; return !(t && t.closest('#tip,#cmdk,.num')); })) scan();
  }).observe(document.body, { childList: true, subtree: true });
  scan();

  // ---- command palette (Ctrl/Cmd+K or "/") ----
  const kbtn = document.createElement('button');
  kbtn.className = 'kbtn'; kbtn.type = 'button'; kbtn.setAttribute('aria-label', 'Open command palette');
  kbtn.innerHTML = `Jump <kbd>${MAC ? '⌘' : 'Ctrl'} K</kbd>`;
  const ov = document.createElement('div');
  ov.id = 'cmdk'; ov.setAttribute('aria-hidden', 'true');
  ov.innerHTML = '<div class="cm-panel" role="dialog" aria-modal="true" aria-label="Command palette"><input class="cm-in" placeholder="Jump to a tab, account, repository…" autocomplete="off" spellcheck="false" role="combobox" aria-expanded="true" aria-controls="cm-list" aria-autocomplete="list"><div class="cm-list" id="cm-list" role="listbox"></div><div class="cm-foot"><span><kbd>↑</kbd><kbd>↓</kbd> move</span><span><kbd>Enter</kbd> open</span><span><kbd>Esc</kbd> close</span></div></div>';
  document.body.append(kbtn, ov);
  const inp = $('.cm-in', ov), list = $('.cm-list', ov);
  let items = [], shown = [], sel = 0, prevFocus = null;

  const collect = () => {
    const out = [];
    $$('#ptabs button[data-p]').forEach((b) => out.push({ g: 'Tabs', t: b.textContent.trim(), h: '', run: () => b.click() }));
    $$('#crumbs a').forEach((a) => out.push({ g: 'Accounts', t: a.getAttribute('title') || a.getAttribute('aria-label') || a.pathname, h: a.pathname === '/' ? 'Profile' : 'Organization', run: () => a.click() }));
    const gh = $('#link');
    if (gh && gh.href && !gh.href.endsWith('#')) out.push({ g: 'Links', t: 'Open on GitHub', h: gh.textContent.trim(), run: () => window.open(gh.href, '_blank', 'noopener') });
    out.push({ g: 'Actions', t: 'Toggle theme', h: 'Light / dark', run: () => { const b = $('#theme'); b && b.click(); } });
    out.push({ g: 'Actions', t: 'Scroll to top', h: '', run: () => top.click() });
    $$('#rtabs a').forEach((a) => out.push({ g: 'Pages', t: a.firstChild.textContent.trim(), h: 'This repository', run: () => a.click() }));
    $$('#years button').forEach((b) => out.push({ g: 'Heatmap', t: 'Show ' + b.textContent.trim(), h: 'Contributions', run: () => b.click() }));
    $$('#repos a.repo').forEach((a) => {
      const n = $('.rn', a); if (n) out.push({ g: 'Repositories', t: n.textContent.trim(), h: ($('.rd', a) || {}).textContent || '', run: () => a.click() });
    });
    return out;
  };
  const score = (it, q) => {
    const t = it.t.toLowerCase();
    if (t === q) return 0;
    if (t.startsWith(q)) return 1;
    const i = t.indexOf(q);
    if (i >= 0) return 2 + i / 100;
    if ((it.h || '').toLowerCase().includes(q)) return 4;
    let p = 0; for (const ch of q) { p = t.indexOf(ch, p); if (p < 0) return -1; p++; }
    return 5;
  };
  const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const draw = () => {
    const q = inp.value.trim().toLowerCase();
    shown = (q ? items.map((it) => [score(it, q), it]).filter((x) => x[0] >= 0).sort((a, b) => a[0] - b[0]).map((x) => x[1]) : items).slice(0, 40);
    sel = Math.min(sel, Math.max(0, shown.length - 1));
    let g = '';
    list.innerHTML = shown.length ? shown.map((it, i) => {
      const head = it.g !== g ? `<div class="cm-g">${esc(it.g)}</div>` : ''; g = it.g;
      return `${head}<div class="cm-i" role="option" id="cm-${i}" data-i="${i}" aria-selected="${i === sel}"><span class="cm-t">${esc(it.t)}</span><span class="cm-h">${esc((it.h || '').slice(0, 60))}</span></div>`;
    }).join('') : '<div class="cm-e">No matches</div>';
    inp.setAttribute('aria-activedescendant', shown.length ? 'cm-' + sel : '');
  };
  const mark = () => {
    $$('.cm-i', list).forEach((el, i) => el.setAttribute('aria-selected', i === sel));
    inp.setAttribute('aria-activedescendant', 'cm-' + sel);
    const el = $('#cm-' + sel, list); if (el) el.scrollIntoView({ block: 'nearest' });
  };
  const open = () => {
    if (ov.classList.contains('open')) return;
    prevFocus = document.activeElement; items = collect(); inp.value = ''; sel = 0; draw();
    ov.classList.add('open'); ov.setAttribute('aria-hidden', 'false'); inp.focus();
  };
  const close = () => {
    ov.classList.remove('open'); ov.setAttribute('aria-hidden', 'true');
    if (prevFocus && prevFocus.focus) prevFocus.focus();
  };
  const run = (i) => { const it = shown[i]; if (!it) return; close(); setTimeout(it.run, 60); };
  kbtn.onclick = open;
  inp.oninput = () => { sel = 0; draw(); };
  list.onclick = (e) => { const el = e.target.closest('.cm-i'); if (el) run(+el.dataset.i); };
  list.onpointermove = (e) => { const el = e.target.closest('.cm-i'); if (el && +el.dataset.i !== sel) { sel = +el.dataset.i; mark(); } };
  ov.addEventListener('pointerdown', (e) => { if (e.target === ov) close(); });
  addEventListener('keydown', (e) => {
    const isOpen = ov.classList.contains('open');
    if ((e.key === 'k' || e.key === 'K') && (e.ctrlKey || e.metaKey)) { e.preventDefault(); isOpen ? close() : open(); return; }
    if (!isOpen) {
      const tag = (e.target.tagName || '').toLowerCase();
      if (e.key === '/' && !e.ctrlKey && !e.metaKey && !e.altKey && !['input', 'textarea', 'select'].includes(tag) && !e.target.isContentEditable) { e.preventDefault(); open(); }
      return;
    }
    if (e.key === 'Escape') { e.preventDefault(); close(); }
    else if (e.key === 'ArrowDown') { e.preventDefault(); if (shown.length) { sel = (sel + 1) % shown.length; mark(); } }
    else if (e.key === 'ArrowUp') { e.preventDefault(); if (shown.length) { sel = (sel - 1 + shown.length) % shown.length; mark(); } }
    else if (e.key === 'Enter') { e.preventDefault(); run(sel); }
    else if (e.key === 'Tab') e.preventDefault();
  });
})();
