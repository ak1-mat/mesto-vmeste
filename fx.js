/* «Место вместе» — живые эффекты (без видео и WebGL, только CSS и чуть-чуть JS):
   • фон «город с высоты» на главной: по кварталам вспыхивают метки друзей;
   • заголовок собирается по буквам;
   • «Как это работает» оживает при прокрутке;
   • всплеск эмодзи при реакции на место.
   При «уменьшить движение» в системе — всё показывается спокойно, без анимации. */
'use strict';
(function () {
  const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const $ = s => document.querySelector(s);
  const PIN = 'M24 0C10.7 0 0 10.7 0 24c0 16 24 40 24 40s24-24 24-40C48 10.7 37.3 0 24 0z';
  const rnd = (a, b) => a + Math.random() * (b - a);

  /* ---------- 1. Фон «город с высоты» ---------- */
  function city() {
    const host = $('#lcity');
    if (!host) return;
    // Кварталы, улицы, река и парк рисуем один раз — получается лёгкая SVG-«карта»
    const narrow = window.innerWidth < 700;
    const W = narrow ? 700 : 1600, H = narrow ? 1800 : 900, k = W / 1600, q = H / 900;
    const P = (s) => s.replace(/(-?\d+(?:\.\d+)?) (-?\d+(?:\.\d+)?)/g, (_, a, b) => `${(a * k).toFixed(0)} ${(b * q).toFixed(0)}`);
    let blocks = '';
    for (let y = -40; y < H + 40; y += 120) {
      for (let x = -40; x < W + 40; x += 150) {
        const dx = rnd(-14, 14), dy = rnd(-10, 10), w = rnd(90, 128), h = rnd(70, 96);
        if (Math.random() < .12) continue;
        blocks += `<rect x="${(x + dx).toFixed(0)}" y="${(y + dy).toFixed(0)}" width="${w.toFixed(0)}" height="${h.toFixed(0)}" rx="10"/>`;
      }
    }
    host.innerHTML = `<svg class="lcity-map" viewBox="0 0 ${W} ${H}" preserveAspectRatio="xMidYMid slice">
      <g class="lc-blocks">${blocks}</g>
      <ellipse class="lc-park" cx="${1150 * k}" cy="${200 * q}" rx="${narrow ? 150 : 130}" ry="${narrow ? 110 : 95}"/>
      <path class="lc-river" d="${P('M-40 640 C200 560 360 720 620 660 S1000 500 1240 560 S1560 720 1660 680')}"/>
      <g class="lc-roads"><path d="${P('M-40 300 C300 260 600 360 900 300 S1400 220 1660 280')}"/><path d="${P('M420 -40 C380 200 470 520 400 960')}"/><path d="${P('M1180 -40 C1220 260 1120 560 1200 960')}"/></g>
    </svg><div class="lcity-fade"></div><div class="lcity-pins"></div>`;
    const layer = host.querySelector('.lcity-pins');
    const kinds = [
      { c: 'task', t: 'А' }, { c: 'task', t: 'Д' }, { c: 'done', t: '' }, { c: 'task', t: 'М' },
      { c: 'mine', t: '☕' }, { c: 'task', t: 'В' }, { c: 'mine', t: '🌳' }, { c: 'mine', t: '📸' },
    ];
    const notes = ['Аня: лучший раф ☕', 'Дима: закат отсюда 🔥', 'Вика: +20 за фото', 'Маша: идём в субботу?'];
    let n = 0;
    const pinHtml = k => `<svg viewBox="0 0 48 64" aria-hidden="true"><path d="${PIN}"/><circle cx="24" cy="23" r="15.5"/></svg>${k.c === 'done'
      ? '<span class="e"><svg viewBox="0 0 24 24"><path d="M6.5 12.5l3.5 3.5 7.5-8"/></svg></span>' : `<span class="e">${k.t}</span>`}`;
    function spawn(still) {
      const k = kinds[n++ % kinds.length];
      const el = document.createElement('div');
      el.className = `lcp ${k.c}${still ? ' still' : ''}`;
      // не ставим метки под заголовок слева на широких экранах — только по краям и справа
      const wide = host.clientWidth > 900;
      const x = wide ? rnd(52, 95) : rnd(8, 90);
      // на телефоне — только ниже текста, рядом с карточкой входа
      const y = wide ? rnd(8, 86) : rnd(56, 96);
      el.style.left = x + '%'; el.style.top = y + '%';
      el.innerHTML = pinHtml(k) + (!still && wide && n % 4 === 0 ? `<span class="lcn${x > 74 ? ' l' : ''}">${notes[(n / 4) % notes.length | 0]}</span>` : '');
      layer.appendChild(el);
      if (!still) setTimeout(() => el.remove(), 5200);
    }
    if (reduce) { for (let i = 0; i < 6; i++) spawn(true); return; }
    let t = null;
    const run = () => { if (!t) { spawn(); t = setInterval(spawn, 950); } };
    const stop = () => { clearInterval(t); t = null; };
    // крутим только когда главная видна
    new IntersectionObserver(es => es.forEach(e => (e.isIntersecting ? run() : stop())), { threshold: .05 }).observe(host);
    document.addEventListener('visibilitychange', () => (document.hidden ? stop() : host.getBoundingClientRect().bottom > 0 && run()));
  }

  /* ---------- 2. Заголовок собирается по буквам ---------- */
  function letters() {
    const h = $('#lh1');
    if (!h || h.dataset.fx || reduce) return;
    h.dataset.fx = '1';
    h.setAttribute('aria-label', h.textContent.replace(/\s+/g, ' ').trim());
    let i = 0;
    const walk = node => {
      [...node.childNodes].forEach(ch => {
        if (ch.nodeType === 3) {
          const frag = document.createDocumentFragment();
          ch.textContent.split(/(\s+)/).forEach(part => {
            if (!part) return;
            if (/^\s+$/.test(part)) { frag.appendChild(document.createTextNode(' ')); return; }
            const w = document.createElement('span');
            w.className = 'lw'; w.setAttribute('aria-hidden', 'true');
            [...part].forEach(c => { const s = document.createElement('span'); s.className = 'lch'; s.style.setProperty('--i', i++); s.textContent = c; w.appendChild(s); });
            frag.appendChild(w);
          });
          ch.replaceWith(frag);
        } else if (ch.nodeType === 1) walk(ch);
      });
    };
    walk(h);
    h.style.setProperty('--n', i);
    h.classList.add('lfx');
  }

  /* ---------- 3. Кнопка «Создать карту с друзьями» ---------- */
  function heroCta() {
    const b = $('#heroGo');
    if (!b) return;
    b.addEventListener('click', e => {
      const T = window.TG, C = window.MESTO_CONFIG || {};
      if (T && T.bot && C.TG_ONLY && !T.on) { e.preventDefault(); location.href = T.botLink(); }
    });
  }

  /* ---------- 4. «Как это работает»: шаги оживают при прокрутке ---------- */
  function flow() {
    const box = $('#lflow');
    if (!box) return;
    const steps = [...box.querySelectorAll('li')];
    if (reduce || !('IntersectionObserver' in window)) { steps.forEach(s => s.classList.add('in')); box.style.setProperty('--p', 1); return; }
    const io = new IntersectionObserver(es => es.forEach(e => { if (e.isIntersecting) { e.target.classList.add('in'); io.unobserve(e.target); } }), { threshold: .45 });
    steps.forEach(s => io.observe(s));
    // линия прогресса заполняется по мере прокрутки
    const scroller = $('#auth') || window;
    let raf = 0;
    const upd = () => {
      raf = 0;
      const r = box.getBoundingClientRect(), vh = window.innerHeight;
      const p = Math.min(1, Math.max(0, (vh * .75 - r.top) / (r.height * .9)));
      box.style.setProperty('--p', p.toFixed(3));
    };
    scroller.addEventListener('scroll', () => { if (!raf) raf = requestAnimationFrame(upd); }, { passive: true });
    window.addEventListener('resize', upd);
    upd();
  }

  /* ---------- 5. Всплеск эмодзи при реакции ---------- */
  window.fxBurst = function (el, emoji) {
    if (reduce || !el) return;
    const r = el.getBoundingClientRect();
    const box = document.createElement('div');
    box.className = 'fxb'; box.setAttribute('aria-hidden', 'true');
    box.style.left = r.left + r.width / 2 + 'px'; box.style.top = r.top + r.height / 2 + 'px';
    for (let i = 0; i < 9; i++) {
      const s = document.createElement('span');
      const a = (Math.PI * 2 * i) / 9 + rnd(-.3, .3), d = rnd(42, 78);
      s.textContent = emoji;
      s.style.setProperty('--x', (Math.cos(a) * d).toFixed(0) + 'px');
      s.style.setProperty('--y', (Math.sin(a) * d - 24).toFixed(0) + 'px');
      s.style.setProperty('--r', rnd(-40, 40).toFixed(0) + 'deg');
      s.style.animationDelay = (i * 14) + 'ms';
      box.appendChild(s);
    }
    document.body.appendChild(box);
    setTimeout(() => box.remove(), 1100);
  };

  /* ---------- Загрузчик карты ---------- */
  window.fxMapReady = function () {
    const l = $('#mapLoader');
    if (!l || l.classList.contains('done')) return;
    l.classList.add('done');
    setTimeout(() => l.remove(), 600);
  };

  const go = () => { city(); letters(); heroCta(); flow(); };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', go); else go();
})();
