// router.js — client-side navigation: swaps <main> and the page script instead of reloading.
// Loaded after common.js and the page's inline <script type="text/page">, before fx.js.
(() => {
  const PANE = '(?:overview|work|activity|repos)';
  const kindOf = (p) => {
    if (p === '/' || new RegExp('^/' + PANE + '/?$').test(p)) return 'index';
    if (/^\/repos\/[^/]+/.test(p)) return 'repo';
    if (/^\/gist\/[0-9a-fA-F]+\/?$/.test(p)) return 'gist';
    if (/^\/(followers|following|stars|gists)\/?$/.test(p)) return 'list';
    if (new RegExp('^/[A-Za-z0-9-]+(?:/' + PANE + ')?/?$').test(p)) return 'org';
    return '';
  };
  const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;

  // ---- run page scripts in a private scope so they can be re-executed and torn down ----
  let ctl = null, gen = 0;
  window.SPA_PAGE = null;
  const run = (code) => {
    if (ctl) ctl.abort();
    ctl = new AbortController();
    const my = ++gen, signal = ctl.signal;
    const live = () => my === gen;
    const add = (t, fn, o) => window.addEventListener(t, fn, { ...(typeof o === 'object' && o ? o : { capture: !!o }), signal });
    // Late async work from a page we already left must not touch the new page.
    const $s = (id) => (live() ? document.getElementById(id) : document.createElement('div'));
    const doc = new Proxy(document, {
      get(t, k) {
        if (k === 'body' && !live()) return document.createElement('body');
        const v = t[k];
        return typeof v === 'function' ? v.bind(t) : v;
      },
      set(t, k, v) { if (live()) t[k] = v; return true; },
    });
    new Function('addEventListener', '$', 'document', code)(add, $s, doc);
  };

  // ---- fetching pages ----
  const cache = new Map();
  const getPage = (url) => {
    const hit = cache.get(url);
    if (hit && Date.now() - hit.t < 20000) return hit.p;
    const p = fetch(url, { headers: { Accept: 'text/html' } }).then((r) => {
      if (!r.ok || !(r.headers.get('content-type') || '').includes('text/html')) throw new Error('nav');
      return r.text();
    });
    cache.set(url, { t: Date.now(), p });
    p.catch(() => cache.delete(url));
    return p;
  };

  const syncHead = (doc) => {
    document.title = doc.title;
    doc.head.querySelectorAll('meta[name],meta[property]').forEach((m) => {
      const key = m.hasAttribute('name') ? 'name' : 'property', val = m.getAttribute(key);
      let cur = [...document.head.querySelectorAll('meta')].find((x) => x.getAttribute(key) === val);
      if (!cur) { cur = document.createElement('meta'); cur.setAttribute(key, val); document.head.append(cur); }
      cur.setAttribute('content', m.getAttribute('content') || '');
    });
    document.head.querySelectorAll('style[data-spa]').forEach((s) => s.remove());
    doc.head.querySelectorAll('style').forEach((s) => { const c = s.cloneNode(true); c.dataset.spa = '1'; document.head.append(c); });
  };

  let token = 0;
  const swap = async (url, push) => {
    const t = ++token;
    let html;
    try { html = await getPage(url); } catch { location.assign(url); return; }
    if (t !== token) return;
    const doc = new DOMParser().parseFromString(html, 'text/html');
    const main = doc.querySelector('main.wrap');
    if (!main) { location.assign(url); return; }
    if (push) history.pushState(null, '', url);
    window.SPA_PAGE = null;
    syncHead(doc);
    document.body.classList.toggle('loading', doc.body.classList.contains('loading'));
    if (doc.getElementById('tip') && !document.getElementById('tip')) document.body.prepend(doc.getElementById('tip').cloneNode(true));
    const cur = document.querySelector('main.wrap'), next = document.importNode(main, true);
    if (!reduce) next.classList.add('spa-in');
    cur.replaceWith(next);
    scrollTo(0, 0);
    document.querySelector('#cmdk.open')?.dispatchEvent(new PointerEvent('pointerdown'));
    doc.querySelectorAll('script:not([src])').forEach((s) => { if (s.type === 'text/page') run(s.textContent); });
  };

  const internal = (a) => {
    if (!a || !a.href || a.target === '_blank' || a.hasAttribute('download')) return null;
    const u = new URL(a.href, location.href);
    if (u.origin !== location.origin || !kindOf(u.pathname)) return null;
    return u;
  };
  const same = (u) => u.pathname === location.pathname && u.search === location.search;

  document.addEventListener('click', (e) => {
    if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
    const u = internal(e.target.closest && e.target.closest('a[href]'));
    if (!u || (same(u) && u.hash)) return;
    e.preventDefault();
    if (same(u)) return;
    const pg = window.SPA_PAGE;
    if (pg && pg.owns(u.pathname)) { document.body.classList.add('fx-nav'); pg.nav(u.pathname + u.search + u.hash); return; }
    swap(u.href, true);
  });

  // Warm the next page while the pointer is over a link.
  const warm = (e) => {
    const u = internal(e.target.closest && e.target.closest('a[href]'));
    if (u && !same(u) && !(window.SPA_PAGE && window.SPA_PAGE.owns(u.pathname))) getPage(u.href).catch(() => {});
  };
  document.addEventListener('pointerover', warm, { passive: true });
  document.addEventListener('touchstart', warm, { passive: true });

  // Registered before the page's own popstate handlers, so a page that can't handle the URL is replaced first.
  addEventListener('popstate', (e) => {
    const pg = window.SPA_PAGE;
    if (pg && pg.owns(location.pathname)) return;
    e.stopImmediatePropagation();
    swap(location.href, false);
  });

  // ---- boot: run the initial page script through the same sandbox ----
  document.head.querySelectorAll('style').forEach((s) => { s.dataset.spa = '1'; });
  document.querySelectorAll('script[type="text/page"]').forEach((s) => run(s.textContent));
})();
