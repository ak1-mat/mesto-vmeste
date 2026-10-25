/* «Место вместе» — подборка «Москва: 100 мест» и маршрут на день. */
'use strict';

const CUR_CATS = {
  eat:     { n: 'Поесть',   e: '🍜', c: '#E2553B', many: 'где поесть' },
  culture: { n: 'Культура', e: '🏛️', c: '#2B7BD6', many: 'культура' },
  photo:   { n: 'Для фото', e: '📸', c: '#9B3FD1', many: 'для фото' },
  walk:    { n: 'Прогулки', e: '🌳', c: '#18915A', many: 'прогулки' },
};
const PRICE = ['', '₽', '₽₽', '₽₽₽'];
const PRICE_HINT = ['', 'недорого', 'средний чек', 'дорого'];

const CUR = {
  list: [], byId: new Map(), loaded: false,
  on: true, cats: new Set(Object.keys(CUR_CATS)),
  pick: new Set(),            // «в маршрут»: id подборки или f:<id места друга>
  layer: null,
};

/* ---------- Загрузка данных и настроек ---------- */
async function loadCurated() {
  try {
    CUR.on = store.get('mv_cur_on') !== '0';
    const cats = store.get('mv_cur_cats'); if (cats) CUR.cats = new Set(cats.split(',').filter(k => k in CUR_CATS));
    const pick = store.get('mv_day_pick'); if (pick) CUR.pick = new Set(pick.split('|').filter(Boolean));
    const r = await fetch('moscow.json?v=20261026', { cache: 'no-cache' });
    const j = await r.json();
    CUR.list = j.places; CUR.byId = new Map(CUR.list.map(p => [p.id, p]));
    for (const p of CUR.list) if (p.photo) {   // фото из Wikimedia Commons
      const f = encodeURIComponent(p.photo);
      p.img = `https://commons.wikimedia.org/wiki/Special:FilePath/${f}?width=640`;
      p.credit = `https://commons.wikimedia.org/wiki/File:${f}`;
    }
    CUR.loaded = true;
    for (const id of [...CUR.pick]) if (!id.startsWith('f:') && !CUR.byId.has(id)) CUR.pick.delete(id);
  } catch (e) { console.error('curated', e); }
  renderCuratedControl(); renderCuratedLayer(); renderPickBar();
  if (S.tab === 'tasks') renderPanel();
}
const savePick = () => store.set('mv_day_pick', [...CUR.pick].join('|'));

/* ---------- Слой на карте ---------- */
function curIcon(p) {
  const c = CUR_CATS[p.cat], picked = CUR.pick.has(p.id);
  return L.divIcon({
    className: '', iconSize: [30, 30], iconAnchor: [15, 15],
    html: `<div class="cpin${picked ? ' picked' : ''}" style="--c:${c.c}"><span>${c.e}</span></div>`,
  });
}
function renderCuratedLayer() {
  if (!map) return;
  if (!CUR.layer) {
    CUR.layer = L.layerGroup().addTo(map);
    const zoomCls = () => map.getContainer().classList.toggle('far', map.getZoom() < 13);
    map.on('zoomend', zoomCls); zoomCls();
  }
  CUR.layer.clearLayers();
  if (!CUR.on || !CUR.loaded) return;
  for (const p of CUR.list) {
    if (!CUR.cats.has(p.cat)) continue;
    L.marker([p.lat, p.lng], { icon: curIcon(p), title: p.name, zIndexOffset: -200 })
      .on('click', () => openCurated(p.id)).addTo(CUR.layer);
  }
}
function renderCuratedControl() {
  let box = $('#curCtl');
  if (!box) {
    box = document.createElement('div'); box.id = 'curCtl'; box.className = 'curctl';
    $('.mapwrap').appendChild(box);
  }
  box.innerHTML = `
    <button type="button" class="curtoggle" aria-pressed="${CUR.on}" id="curOn" title="Показать или скрыть подборку на карте">
      <span class="star">★</span><span>Москва: 100 мест</span><span class="sw2" aria-hidden="true"></span></button>
    ${CUR.on ? `<div class="curcats">${Object.entries(CUR_CATS).map(([k, c]) => `<button type="button" class="ccat" data-k="${k}" aria-pressed="${CUR.cats.has(k)}" style="--c:${c.c}">${c.e} ${c.n}</button>`).join('')}</div>` : ''}`;
  box.querySelector('#curOn').onclick = () => { CUR.on = !CUR.on; store.set('mv_cur_on', CUR.on ? '1' : '0'); renderCuratedControl(); renderCuratedLayer(); };
  box.querySelectorAll('.ccat').forEach(b => b.onclick = () => {
    const k = b.dataset.k;
    CUR.cats.has(k) ? CUR.cats.delete(k) : CUR.cats.add(k);
    if (!CUR.cats.size) CUR.cats.add(k);
    store.set('mv_cur_cats', [...CUR.cats].join(','));
    renderCuratedControl(); renderCuratedLayer();
  });
}

/* ---------- «В маршрут» ---------- */
function togglePick(id) {
  CUR.pick.has(id) ? CUR.pick.delete(id) : CUR.pick.add(id);
  savePick(); renderPickBar(); renderCuratedLayer();
  return CUR.pick.has(id);
}
function renderPickBar() {
  let bar = $('#pickBar');
  if (!bar) {
    bar = document.createElement('div'); bar.id = 'pickBar'; bar.className = 'pickbar';
    $('.mapwrap').appendChild(bar);
  }
  const n = CUR.pick.size;
  bar.hidden = !n;
  if (!n) return;
  bar.innerHTML = `<span class="pb-n">${n}</span><span class="pb-t">${plural(n, 'место', 'места', 'мест')} в маршруте</span>
    <button type="button" class="pb-go" id="pbGo">Построить маршрут</button><button type="button" class="pb-x" id="pbX" aria-label="Очистить маршрут">×</button>`;
  bar.querySelector('#pbGo').onclick = () => openDayPlanner();
  bar.querySelector('#pbX').onclick = () => { CUR.pick.clear(); savePick(); renderPickBar(); renderCuratedLayer(); };
}

/* ---------- Карточка места из подборки ---------- */
const yaSearch = p => `https://yandex.ru/maps/?text=${encodeURIComponent(p.name + ', ' + (p.addr || 'Москва'))}&ll=${p.lng},${p.lat}&z=17`;
function openCurated(id) {
  const p = CUR.byId.get(id); if (!p) return;
  const c = CUR_CATS[p.cat], on = CUR.pick.has(p.id);
  const m = modal(`
    ${p.img ? `<div class="herowrap" id="chero"><img class="hero" src="${esc(p.img)}" alt="${esc(p.name)}"></div>` : `<div class="cbanner" style="--c:${c.c}"><span>${c.e}</span></div>`}
    <div class="mb">
      <div class="row"><span class="cat" style="background:${c.c}">${c.e} ${c.n}</span><span class="curbadge">★ Подборка «Москва: 100 мест»</span></div>
      <h2>${esc(p.name)}</h2>
      ${p.addr ? `<div class="by">📍 ${esc(p.addr)}</div>` : ''}
      <p class="note">${esc(p.desc)}</p>
      <div class="facts">
        <span>⏱ ${fmtStay(p.mins)} на месте</span>
        ${p.price ? `<span title="${PRICE_HINT[p.price]}">${PRICE[p.price]} · ${PRICE_HINT[p.price]}</span>` : ''}
      </div>
      <button type="button" class="cta${on ? ' ghost' : ''}" id="cPick">${on ? '✓ В маршруте — убрать' : '🧭 Добавить в маршрут на день'}</button>
      <div class="links">
        <button type="button" class="lbtn" id="cMap">🗺️ Показать на карте</button>
        <a class="lbtn" href="${esc(yaSearch(p))}" target="_blank" rel="noopener noreferrer">🧭 Как добраться и часы работы</a>
      </div>
      ${p.img && p.credit ? `<p class="hint">Фото: <a href="${esc(p.credit)}" target="_blank" rel="noopener noreferrer">Wikimedia Commons</a></p>` : ''}
      ${p.cat === 'eat' ? '<p class="hint">Часы работы и цены меняются — перед визитом загляните в карточку на Яндекс Картах.</p>' : ''}
    </div>`);
  m.querySelector('#cPick').onclick = () => {
    const now = togglePick(p.id);
    toast(now ? `«${p.name}» в маршруте` : 'Убрано из маршрута');
    const st = $('.modal')?.scrollTop || 0; openCurated(p.id); const md = $('.modal'); if (md) md.scrollTop = st;
  };
  m.querySelector('#cMap').onclick = () => { closeModal(); showOnMap(p.lat, p.lng, 16); };
  m.querySelector('#chero')?.addEventListener('click', () => lightbox(p.img));
}
function fmtStay(min) { return min >= 60 ? fmtDur(min) : min + ' мин'; }

/* ---------- Подборка в панели «Задания» и полный список ---------- */
function curatedStrip() {
  if (!CUR.loaded || !CUR.list.length) return '';
  const withImg = CUR.list.filter(p => p.img);
  const day = Math.floor(Date.now() / 86400000);
  const pickN = 8, start = (day * 7) % Math.max(1, withImg.length);
  const show = [...withImg.slice(start), ...withImg.slice(0, start)].slice(0, pickN);
  return `<section class="curstrip">
    <div class="cs-head"><div><div class="ptitle">Москва: 100 мест</div><p class="intro">Подборка, где вкусно поесть, что посмотреть и где снять красивые фото.</p></div></div>
    <div class="cs-row">${show.map(p => `<button type="button" class="cs-card" data-cur="${p.id}"><img src="${esc(p.img)}" alt="" loading="lazy"><span class="cs-cat" style="background:${CUR_CATS[p.cat].c}">${CUR_CATS[p.cat].e}</span><b>${esc(p.name)}</b></button>`).join('')}</div>
    <div class="cs-acts"><button type="button" class="sbtn" id="csAll">Все 100 мест</button><button type="button" class="sbtn ghost" id="csDay">🧭 Маршрут на день</button></div>
  </section>`;
}
function bindCuratedStrip(root) {
  root.querySelectorAll('[data-cur]').forEach(b => b.onclick = () => openCurated(b.dataset.cur));
  root.querySelector('#csAll')?.addEventListener('click', () => openCuratedList());
  root.querySelector('#csDay')?.addEventListener('click', () => openDayPlanner());
}
function openCuratedList(cat = 'all', query = '') {
  const items = CUR.list.filter(p => (cat === 'all' || p.cat === cat) &&
    (!query || (p.name + ' ' + p.desc).toLowerCase().includes(query.toLowerCase())));
  const m = modal(`
    <div class="mb">
      <h2>Москва: 100 мест</h2>
      <p class="intro">Отмечайте «+», чтобы собрать маршрут на день. Сайт расставит места в выгодном порядке.</p>
      <input class="input" id="clQ" type="search" placeholder="Найти: рамен, музей, мост…" value="${esc(query)}" aria-label="Поиск по подборке">
      <div class="seg">${[['all', 'Все'], ...Object.entries(CUR_CATS).map(([k, c]) => [k, c.e + ' ' + c.n])].map(([k, n]) =>
        `<button type="button" class="chip" data-c="${k}" aria-pressed="${k === cat}">${n} <small>${k === 'all' ? CUR.list.length : CUR.list.filter(p => p.cat === k).length}</small></button>`).join('')}</div>
      <div class="clist">${items.length ? items.map(p => `
        <div class="citem">
          <button type="button" class="ci-main" data-open="${p.id}">
            ${p.img ? `<img class="thumb" src="${esc(p.img)}" alt="" loading="lazy">` : `<span class="thumb" style="background:${CUR_CATS[p.cat].c}22">${CUR_CATS[p.cat].e}</span>`}
            <span class="ci-t"><b>${esc(p.name)}</b><small>${esc(p.desc)}</small><em>${CUR_CATS[p.cat].n} · ${fmtStay(p.mins)}${p.price ? ' · ' + PRICE[p.price] : ''}</em></span>
          </button>
          <button type="button" class="ci-add" data-add="${p.id}" aria-pressed="${CUR.pick.has(p.id)}" aria-label="В маршрут">${CUR.pick.has(p.id) ? '✓' : '+'}</button>
        </div>`).join('') : '<div class="empty">Ничего не нашлось — попробуйте другое слово.</div>'}</div>
      <button type="button" class="cta sticky-cta" id="clGo" ${CUR.pick.size ? '' : 'disabled'}>${CUR.pick.size ? `🧭 Построить маршрут · ${CUR.pick.size} ${plural(CUR.pick.size, 'место', 'места', 'мест')}` : 'Отметьте места «+», чтобы построить маршрут'}</button>
    </div>`);
  const rerender = () => { const st = $('.modal').scrollTop; openCuratedList(cat, m.querySelector('#clQ').value); $('.modal').scrollTop = st; };
  m.querySelectorAll('[data-c]').forEach(b => b.onclick = () => { cat = b.dataset.c; rerender(); });
  let t; m.querySelector('#clQ').oninput = e => { clearTimeout(t); t = setTimeout(() => { const v = e.target.value; openCuratedList(cat, v); const q = $('#clQ'); q.focus(); q.setSelectionRange(v.length, v.length); }, 250); };
  m.querySelectorAll('[data-open]').forEach(b => b.onclick = () => openCurated(b.dataset.open));
  m.querySelectorAll('[data-add]').forEach(b => b.onclick = () => { togglePick(b.dataset.add); rerender(); });
  m.querySelector('#clGo').onclick = () => openDayPlanner();
}

/* ---------- Маршрут на день: модель времени ---------- */
const WALK_KMH_D = 4.6, DETOUR_D = 1.3;
function legTime(a, b, mode) {
  const km = hav(a, b);
  const walk = km * DETOUR_D / WALK_KMH_D * 60;
  if (mode === 'walk') return { min: walk, how: 'walk', km: km * DETOUR_D };
  // Метро/такси: ~12 мин на дорогу до станции и ожидание + ~25 км/ч по городу
  const metro = 12 + km * 1.35 / 25 * 60;
  return walk <= metro ? { min: walk, how: 'walk', km: km * DETOUR_D } : { min: metro, how: 'metro', km: km * 1.35 };
}
// Время всего маршрута: старт → точки → финиш (если задан)
function tourTime(start, pts, end, mode) {
  let t = 0, cur = start;
  for (const p of pts) { t += legTime(cur, p, mode).min + p.mins; cur = p; }
  if (end) t += legTime(cur, end, mode).min;
  return t;
}
// «Стоимость» порядка: время + штраф, если поесть выпадает не на обед/ужин
const MEALS = [[12 * 60, 14 * 60 + 30], [18 * 60, 20 * 60 + 30]];
let PLAN_START = 600;
function tourCost(start, pts, end, mode) {
  let t = PLAN_START, cur = start, pen = 0;
  for (const p of pts) {
    t += legTime(cur, p, mode).min;
    if (p.cat === 'eat' || p.eat) pen += Math.min(...MEALS.map(([a, b]) => (t < a ? a - t : t > b ? t - b : 0))) * 0.6;
    t += p.mins; cur = p;
  }
  if (end) t += legTime(cur, end, mode).min;
  return t - PLAN_START + pen;
}
function twoOpt(start, pts, end, mode) {
  const tourTime = tourCost;   // порядок выбираем с учётом обеда и ужина
  let best = pts.slice(), bestT = tourTime(start, best, end, mode), improved = true, guard = 0;
  while (improved && guard++ < 60) {
    improved = false;
    for (let i = 0; i < best.length - 1; i++) for (let k = i + 1; k < best.length; k++) {
      const cand = [...best.slice(0, i), ...best.slice(i, k + 1).reverse(), ...best.slice(k + 1)];
      const t = tourTime(start, cand, end, mode);
      if (t < bestT - 0.01) { best = cand; bestT = t; improved = true; }
    }
    // перенос одной точки на другое место (or-opt)
    for (let i = 0; i < best.length; i++) for (let k = 0; k < best.length; k++) {
      if (i === k) continue;
      const cand = best.slice(); const [x] = cand.splice(i, 1); cand.splice(k, 0, x);
      const t = tourTime(start, cand, end, mode);
      if (t < bestT - 0.01) { best = cand; bestT = t; improved = true; }
    }
  }
  return best;
}
function cheapestInsert(start, route, p, end, mode) {
  // место вставки выбираем по «стоимости» (время + обед/ужин вовремя), а влезает ли — по чистому времени
  let bestI = 0, bestC = Infinity, bestT = Infinity;
  for (let i = 0; i <= route.length; i++) {
    const cand = [...route.slice(0, i), p, ...route.slice(i)];
    const c = tourCost(start, cand, end, mode);
    if (c < bestC) { bestC = c; bestI = i; bestT = tourTime(start, cand, end, mode); }
  }
  return { i: bestI, t: bestT, c: bestC };
}
const CAT_SCORE = { culture: 1.0, walk: 0.95, photo: 0.85, eat: 1.1, friend: 1.15 };
/**
 * Подбор маршрута. must — места, которые обязательно хочется посетить;
 * pool — из чего можно добирать, если останется время. Возвращает порядок и то, что не влезло.
 */
function planDay({ start, end, must, pool, minutes, mode, seed, startMin = 600 }) {
  const rand = rng(seed); PLAN_START = startMin;
  // 1) обязательные — в оптимальном порядке
  let route = [];
  for (const p of must.slice().sort((a, b) => hav(start, a) - hav(start, b))) route.splice(cheapestInsert(start, route, p, end, mode).i, 0, p);
  route = twoOpt(start, route, end, mode);
  const dropped = [];
  while (route.length && tourTime(start, route, end, mode) > minutes) {
    // выкидываем точку, без которой маршрут сокращается сильнее всего
    let worst = 0, gain = -1;
    route.forEach((p, i) => { const t = tourTime(start, route.filter((_, j) => j !== i), end, mode); const g = tourTime(start, route, end, mode) - t; if (g > gain) { gain = g; worst = i; } });
    dropped.push(route.splice(worst, 1)[0]);
  }
  // 2) добираем из пула по принципу «больше мест за то же время»
  const eatCap = minutes >= 540 ? 2 : 1;           // обед, а в длинный день — ещё и ужин
  const used = new Set(route.map(p => p.id));
  let left = pool.filter(p => !used.has(p.id));
  for (;;) {
    const eatN = route.filter(p => p.cat === 'eat' || p.eat).length;
    const base = tourCost(start, route, end, mode);
    let best = null;
    for (const p of left) {
      if ((p.cat === 'eat' || p.eat) && eatN >= eatCap) continue;
      const ins = cheapestInsert(start, route, p, end, mode);
      if (ins.t > minutes) continue;
      const add = Math.max(0, ins.c - base);
      const score = (CAT_SCORE[p.cat] || 1) / (add + 8) * (0.9 + rand() * 0.2);
      if (!best || score > best.score) best = { p, i: ins.i, score };
    }
    if (!best) break;
    route.splice(best.i, 0, best.p); left = left.filter(x => x.id !== best.p.id);
    route = twoOpt(start, route, end, mode);
  }
  return { route, dropped };
}
// Расписание: время прибытия и тип перехода для каждой точки
function schedule(start, route, end, mode, startMin) {
  let t = startMin, cur = start, km = 0;
  const legs = [];
  for (const p of route) {
    const l = legTime(cur, p, mode); t += l.min; km += l.km;
    legs.push({ to: p, how: l.how, min: Math.round(l.min), km: l.km, arrive: t, leave: t + p.mins });
    t += p.mins; cur = p;
  }
  let fin = null;
  if (end) { const l = legTime(cur, end, mode); t += l.min; km += l.km; fin = { how: l.how, min: Math.round(l.min), km: l.km, arrive: t }; }
  return { legs, fin, endMin: t, km };
}
const hm = m => { m = Math.round(m); const h = Math.floor(m / 60) % 24; return `${String(h).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`; };

/* ---------- Маршрут на день: окно ---------- */
let D = null;
function dayDefaults() {
  const c = map.getCenter();
  const now = new Date(), nowMin = now.getHours() * 60 + now.getMinutes();
  const st = nowMin >= 8 * 60 && nowMin <= 19 * 60 ? Math.ceil((nowMin + 15) / 15) * 15 : 10 * 60;
  return {
    start: { lat: c.lat, lng: c.lng, label: 'Центр карты' }, end: null, endKind: 'free',
    startMin: st, hours: 8, mode: 'metro', cats: new Set(['eat', 'culture', 'photo', 'walk']),
    fill: true, friends: true, seed: 7, plan: null,
  };
}
function pickItems() {
  return [...CUR.pick].map(id => {
    if (id.startsWith('f:')) {
      const p = S.places.find(x => x.id === Number(id.slice(2)));
      return p && { id, name: p.title, lat: p.lat, lng: p.lng, cat: 'friend', eat: ['food', 'coffee'].includes(p.category), mins: DWELL[p.category] ?? 30, src: p };
    }
    return CUR.byId.get(id);
  }).filter(Boolean);
}
function poolItems() {
  const cur = CUR.list.filter(p => D.cats.has(p.cat));
  const fr = D.friends ? S.places.filter(p => p.author_id !== S.user.id).map(p => ({ id: 'f:' + p.id, name: p.title, lat: p.lat, lng: p.lng, cat: 'friend', eat: ['food', 'coffee'].includes(p.category), mins: DWELL[p.category] ?? 30, src: p })) : [];
  return [...cur, ...fr];
}
function runPlan() {
  const must = pickItems();
  const pool = D.fill || !must.length ? poolItems() : [];
  const end = D.endKind === 'start' ? D.start : D.endKind === 'point' ? D.end : null;
  D.plan = planDay({ start: D.start, end, must, pool, minutes: D.hours * 60, mode: D.mode, seed: D.seed, startMin: D.startMin });
  D.plan.sched = schedule(D.start, D.plan.route, end, D.mode, D.startMin);
  D.plan.end = end;
}
function openDayPlanner(fresh = true) {
  if (!CUR.loaded) return toast('Подборка ещё загружается — попробуйте через секунду');
  if (!D || fresh) { const keep = D; D = dayDefaults(); if (keep) Object.assign(D, { start: keep.start, end: keep.end, endKind: keep.endKind, hours: keep.hours, mode: keep.mode, cats: keep.cats, fill: keep.fill, friends: keep.friends, startMin: keep.startMin }); runPlan(); }
  const P = D.plan, sc = P.sched, picked = pickItems();
  const legHtml = (l, i) => `
    <div class="tl-leg">${l.how === 'walk' ? `🚶 ${l.min} мин пешком · ${fmtKm(l.km)}` : `🚇 ~${l.min} мин на метро или такси`}</div>
    <div class="tl-stop">
      <span class="tl-time">${hm(l.arrive)}</span>
      <span class="tl-dot" style="--c:${l.to.cat === 'friend' ? 'var(--route)' : CUR_CATS[l.to.cat].c}">${i + 1}</span>
      <button type="button" class="tl-body" data-stop="${esc(l.to.id)}">
        <b>${esc(l.to.name)}</b>
        <small>${l.to.cat === 'friend' ? `место друга · ${esc(nameOf(l.to.src.author_id))}` : CUR_CATS[l.to.cat].n}${l.to.price ? ' · ' + PRICE[l.to.price] : ''} · ${fmtStay(l.to.mins)}${CUR.pick.has(l.to.id) ? ' · <span class="mine-pick">вы выбрали</span>' : ''}</small>
      </button>
    </div>`;
  const m = modal(`
    <div class="mb" id="dayp">
      <h2>Маршрут на день</h2>
      <p class="intro">${picked.length ? `Вы выбрали ${picked.length} ${plural(picked.length, 'место', 'места', 'мест')}. Расставлю их в самом выгодном порядке${D.fill ? ' и добавлю ещё, если останется время' : ''}.` : 'Выберите старт и сколько у вас времени — подберу маршрут, чтобы успеть как можно больше.'}</p>
      <details class="dp-set" ${D.setOpen ?? !isMobile() ? 'open' : ''}>
      <summary><b>Настройки</b><span>${esc(D.start.label)} · ${hm(D.startMin)} · ${D.hours} ч · ${D.mode === 'walk' ? 'пешком' : 'пешком и на метро'}</span></summary>
      <div class="dp-grid">
        <div class="field"><span>Откуда</span><div class="seg">
          <button type="button" class="chip" data-st="geo">📍 Где я</button>
          <button type="button" class="chip" data-st="center">🗺️ Центр карты</button>
          <button type="button" class="chip" data-st="pick">👆 Точка на карте</button>
        </div><small class="dp-now">Сейчас: ${esc(D.start.label)}</small></div>
        <div class="field"><span>Где закончить</span><div class="seg">
          <button type="button" class="chip" data-en="free" aria-pressed="${D.endKind === 'free'}">Где получится</button>
          <button type="button" class="chip" data-en="start" aria-pressed="${D.endKind === 'start'}">Вернуться к старту</button>
          <button type="button" class="chip" data-en="point" aria-pressed="${D.endKind === 'point'}">👆 Точка на карте</button>
        </div></div>
        <div class="field"><span>Начало и время на прогулку</span><div class="seg">
          <input type="time" class="input datein" id="dpStart" value="${hm(D.startMin)}" aria-label="Время начала">
          ${[3, 5, 8, 10, 12].map(h => `<button type="button" class="chip" data-h="${h}" aria-pressed="${D.hours === h}">${h} ч</button>`).join('')}
        </div></div>
        <div class="field"><span>Как передвигаться</span><div class="seg">
          <button type="button" class="chip" data-mode="metro" aria-pressed="${D.mode === 'metro'}">🚶+🚇 Пешком и на метро</button>
          <button type="button" class="chip" data-mode="walk" aria-pressed="${D.mode === 'walk'}">🚶 Только пешком</button>
        </div></div>
        <div class="field"><span>${picked.length ? 'Чем дополнить' : 'Что включить'}</span><div class="seg">
          ${Object.entries(CUR_CATS).map(([k, c]) => `<button type="button" class="chip" data-cat="${k}" aria-pressed="${D.cats.has(k)}">${c.e} ${c.n}</button>`).join('')}
          ${S.friends.length ? `<button type="button" class="chip" data-fr aria-pressed="${D.friends}">👥 Места друзей</button>` : ''}
          ${picked.length ? `<button type="button" class="chip" data-fill aria-pressed="${D.fill}">➕ Добавлять ещё</button>` : ''}
        </div></div>
      </div>
      </details>
      ${P.route.length ? `
        <div class="dp-sum">
          <div><b>${P.route.length}</b><span>${plural(P.route.length, 'место', 'места', 'мест')}</span></div>
          <div><b>${hm(D.startMin)}–${hm(sc.endMin)}</b><span>${fmtDur(sc.endMin - D.startMin)}</span></div>
          <div><b>${fmtKm(sc.legs.filter(l => l.how === 'walk').reduce((s, l) => s + l.km, 0) + (sc.fin?.how === 'walk' ? sc.fin.km : 0))}</b><span>пешком</span></div>
        </div>
        ${P.dropped.length ? `<div class="state warn">Не влезло по времени: ${P.dropped.map(p => '«' + esc(p.name) + '»').join(', ')}. Добавьте часов или уберите что-то.</div>` : ''}
        <div class="timeline">
          <div class="tl-stop start"><span class="tl-time">${hm(D.startMin)}</span><span class="tl-dot s">●</span><div class="tl-body"><b>Старт</b><small>${esc(D.start.label)}</small></div></div>
          ${sc.legs.map(legHtml).join('')}
          ${sc.fin ? `<div class="tl-leg">${sc.fin.how === 'walk' ? `🚶 ${sc.fin.min} мин пешком` : `🚇 ~${sc.fin.min} мин`}</div>
            <div class="tl-stop start"><span class="tl-time">${hm(sc.fin.arrive)}</span><span class="tl-dot s">⚑</span><div class="tl-body"><b>Финиш</b><small>${D.endKind === 'start' ? 'там же, где старт' : 'выбранная точка'}</small></div></div>` : ''}
        </div>
        <div class="dp-acts">
          <button type="button" class="cta" id="dpShow">🗺️ Показать на карте</button>
          <a class="cta ghost" target="_blank" rel="noopener noreferrer" href="${esc(yaRoute())}">🧭 Открыть в Яндекс Картах</a>
          <button type="button" class="cta ghost" id="dpSave">👥 Сохранить и позвать друзей</button>
          <button type="button" class="linkbtn" id="dpAlt">🔀 Другой вариант</button>
        </div>`
      : `<div class="empty"><span class="ei">🧭</span><b>Не получилось собрать маршрут</b>Добавьте времени, включите больше категорий или выберите старт ближе к центру.</div>`}
    </div>`);

  m.querySelector('.dp-set').addEventListener('toggle', e => { D.setOpen = e.target.open; });
  const again = () => { runPlan(); const st = $('.modal').scrollTop; openDayPlanner(false); $('.modal').scrollTop = st; };
  m.querySelectorAll('[data-st]').forEach(b => b.onclick = () => {
    const k = b.dataset.st;
    if (k === 'center') { const c = map.getCenter(); D.start = { lat: c.lat, lng: c.lng, label: 'Центр карты' }; return again(); }
    if (k === 'pick') return pickOnMap('start');
    if (!navigator.geolocation) return toast('Геолокация недоступна');
    toast('Определяю, где вы…');
    navigator.geolocation.getCurrentPosition(p => { D.start = { lat: p.coords.latitude, lng: p.coords.longitude, label: 'Где я сейчас' }; again(); },
      () => toast('Не удалось определить, где вы — выберите точку на карте'), { enableHighAccuracy: true, timeout: 10000 });
  });
  m.querySelectorAll('[data-en]').forEach(b => b.onclick = () => {
    if (b.dataset.en === 'point') return pickOnMap('end');
    D.endKind = b.dataset.en; again();
  });
  m.querySelectorAll('[data-h]').forEach(b => b.onclick = () => { D.hours = Number(b.dataset.h); again(); });
  m.querySelector('#dpStart').onchange = e => { const [h, mi] = (e.target.value || '10:00').split(':').map(Number); D.startMin = h * 60 + mi; again(); };
  m.querySelectorAll('[data-mode]').forEach(b => b.onclick = () => { D.mode = b.dataset.mode; again(); });
  m.querySelectorAll('[data-cat]').forEach(b => b.onclick = () => { const k = b.dataset.cat; D.cats.has(k) ? D.cats.delete(k) : D.cats.add(k); again(); });
  m.querySelector('[data-fr]')?.addEventListener('click', () => { D.friends = !D.friends; again(); });
  m.querySelector('[data-fill]')?.addEventListener('click', () => { D.fill = !D.fill; again(); });
  m.querySelectorAll('[data-stop]').forEach(b => b.onclick = () => {
    const id = b.dataset.stop;
    if (id.startsWith('f:')) openPlace(Number(id.slice(2))); else openCurated(id);
  });
  if (!P.route.length) return;
  m.querySelector('#dpShow').onclick = () => { closeModal(); showDayRoute(); };
  m.querySelector('#dpAlt').onclick = () => { D.seed = (D.seed * 31 + 7) % 10007; again(); };
  m.querySelector('#dpSave').onclick = saveDayAsWalk;
}
function yaRoute() {
  const pts = [D.start, ...D.plan.route, ...(D.plan.end ? [D.plan.end] : [])].map(p => `${p.lat.toFixed(6)},${p.lng.toFixed(6)}`);
  return `https://yandex.ru/maps/?rtext=${pts.join('~')}&rtt=${D.mode === 'walk' ? 'pd' : 'mt'}`;
}
// Выбор точки на карте: окно прячется, человек нажимает на карту
function pickOnMap(which) {
  closeModal();
  if (isMobile()) setTab('map');
  const bar = $('#addbar'), txt = bar.querySelector('.addtext'), old = txt.textContent;
  txt.textContent = which === 'start' ? 'Нажмите на карту, откуда начать маршрут' : 'Нажмите на карту, где закончить маршрут';
  bar.hidden = false; $('#fab').hidden = true; $('#addHere').hidden = true;
  $('#map').classList.add('adding');
  const done = () => { bar.hidden = true; $('#fab').hidden = false; $('#addHere').hidden = false; txt.textContent = old; $('#map').classList.remove('adding'); map.off('click', onClick); $('#addCancel').onclick = stopAdding; };
  const onClick = e => {
    done();
    const pt = { lat: e.latlng.lat, lng: e.latlng.lng, label: 'Точка на карте' };
    if (which === 'start') D.start = pt; else { D.end = pt; D.endKind = 'point'; }
    runPlan(); openDayPlanner(false);
  };
  map.once('click', onClick);
  $('#addCancel').onclick = () => { done(); openDayPlanner(false); };
}

/* ---------- Маршрут на карте ---------- */
let dayLayer = null;
async function showDayRoute() {
  if (!D?.plan?.route.length) return;
  if (isMobile()) setTab('map');
  if (!dayLayer) dayLayer = L.layerGroup().addTo(map);
  dayLayer.clearLayers();
  map.getContainer().classList.add('routing');
  if (typeof hideRoute === 'function' && S.routePlan) hideRoute();
  const pts = [D.start, ...D.plan.route, ...(D.plan.end ? [D.plan.end] : [])];
  const col = getComputedStyle(document.documentElement).getPropertyValue('--route').trim() || '#2F4BFF';
  const legs = [];
  for (let i = 1; i < pts.length; i++) {
    const how = legTime(pts[i - 1], pts[i], D.mode).how;
    const line = L.polyline([[pts[i - 1].lat, pts[i - 1].lng], [pts[i].lat, pts[i].lng]], how === 'walk'
      ? { color: col, weight: 5, opacity: 0.9, lineCap: 'round' }
      : { color: col, weight: 4, opacity: 0.75, dashArray: '2 9', lineCap: 'round' }).addTo(dayLayer);
    legs.push({ how, line, a: pts[i - 1], b: pts[i] });
  }
  D.plan.route.forEach((p, i) => L.marker([p.lat, p.lng], {
    icon: L.divIcon({ className: '', iconSize: [30, 30], iconAnchor: [15, 15], html: `<div class="rpin">${i + 1}</div>` }), zIndexOffset: 1200, title: p.name,
  }).on('click', () => p.id.startsWith('f:') ? openPlace(Number(p.id.slice(2))) : openCurated(p.id)).addTo(dayLayer));
  L.marker([D.start.lat, D.start.lng], { icon: L.divIcon({ className: '', iconSize: [26, 26], iconAnchor: [13, 13], html: '<div class="spin">●</div>' }), zIndexOffset: 1100 }).addTo(dayLayer);
  if (D.plan.end && D.endKind === 'point') L.marker([D.plan.end.lat, D.plan.end.lng], { icon: L.divIcon({ className: '', iconSize: [26, 26], iconAnchor: [13, 13], html: '<div class="spin">⚑</div>' }), zIndexOffset: 1100 }).addTo(dayLayer);
  map.fitBounds(L.latLngBounds(pts.map(p => [p.lat, p.lng])).pad(0.2), { maxZoom: 16 });
  const sc = D.plan.sched, bar = $('#routebar');
  bar.hidden = false;
  bar.innerHTML = `<div style="min-width:0;flex:1"><div class="rb-t">Маршрут на день · ${D.plan.route.length} ${plural(D.plan.route.length, 'место', 'места', 'мест')}</div>
    <div class="rb-s">${hm(D.startMin)}–${hm(sc.endMin)} · ${fmtDur(sc.endMin - D.startMin)}</div></div>
    <button type="button" class="rb-b" id="rbDay">Расписание</button><button type="button" class="rb-x" id="rbDayX" aria-label="Скрыть маршрут">×</button>`;
  bar.querySelector('#rbDay').onclick = () => openDayPlanner(false);
  bar.querySelector('#rbDayX').onclick = () => { dayLayer.clearLayers(); bar.hidden = true; map.getContainer().classList.remove('routing'); };
  // Пешие отрезки — по улицам
  for (const l of legs) if (l.how === 'walk') {
    fetchFootPath([l.a, l.b]).then(fp => { if (fp && dayLayer.hasLayer(l.line)) l.line.setLatLngs(fp.path); });
  }
}

/* ---------- Сохранить как прогулку ---------- */
async function saveDayAsWalk() {
  const P = D.plan, sc = P.sched;
  const now = new Date(), day = new Date(); day.setHours(0, 0, 0, 0);
  let starts = new Date(day.getTime() + D.startMin * 60000);
  if (starts < now) starts = new Date(starts.getTime() + 86400000);   // время уже прошло — на завтра
  const title = ('Маршрут на день: ' + P.route.slice(0, 3).map(p => p.name).join(' → ') + (P.route.length > 3 ? '…' : '')).slice(0, 80);
  const route = P.route.map(p => ({ id: p.id.startsWith('f:') ? Number(p.id.slice(2)) : p.id, title: p.name, lat: p.lat, lng: p.lng,
    category: p.cat === 'friend' ? p.src.category : ({ eat: 'food', culture: 'culture', photo: 'photo', walk: 'walk' }[p.cat]), photo_url: p.img || p.src?.photo_url || null }));
  const btn = $('#dpSave'); if (btn) { btn.disabled = true; btn.textContent = 'Сохраняю…'; }
  const ins = await sb.from('plans').insert({
    title, starts_at: starts.toISOString(), note: `Маршрут на ${fmtDur(sc.endMin - D.startMin)}, ${P.route.length} ${plural(P.route.length, 'место', 'места', 'мест')}.`, route,
    km: Math.round(sc.km * 100) / 100, minutes: Math.round(sc.endMin - D.startMin), path: null,
  }).select('id').single();
  if (ins.error) { toast(errText(ins.error)); if (btn) { btn.disabled = false; btn.textContent = '👥 Сохранить и позвать друзей'; } return; }
  closeModal();
  toast('Маршрут сохранён в «Прогулки» — позовите друзей', 3500);
  await refresh(false);
  openWalk(ins.data.id);
}
