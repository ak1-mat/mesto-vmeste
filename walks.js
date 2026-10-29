/* «Место вместе» — прогулки: подбор маршрута, кого позвать и во сколько встретиться. */
'use strict';

const SIZES = {
  short: { label: 'Короткая', hint: '~2 км', n: [2, 3], radius: 1.5, hop: 1.2 },
  mid:   { label: 'Средняя',  hint: '~4 км', n: [3, 4], radius: 3,   hop: 2 },
  long:  { label: 'Длинная',  hint: '~6 км', n: [4, 5], radius: 5,   hop: 3 },
};
// Сколько минут обычно проводят в месте каждого типа
const DWELL = { food: 40, coffee: 25, walk: 15, photo: 10, culture: 45, fun: 45, other: 20 };
const WALK_KMH = 4.5, DETOUR = 1.25;
const WD = ['вс', 'пн', 'вт', 'ср', 'чт', 'пт', 'сб'];

/* ---------- Гео и время ---------- */
function hav(a, b) {
  const R = 6371, r = Math.PI / 180;
  const dLat = (b.lat - a.lat) * r, dLng = (b.lng - a.lng) * r;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * r) * Math.cos(b.lat * r) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}
const legKm = (a, b) => hav(a, b) * DETOUR;
function routeStats(stops) {
  let km = 0;
  for (let i = 1; i < stops.length; i++) km += legKm(stops[i - 1], stops[i]);
  const walk = km / WALK_KMH * 60;
  const dwell = stops.reduce((s, p) => s + (p.mins ?? DWELL[p.category] ?? 20), 0);
  return { km, minutes: Math.round(walk + dwell) };
}
const fmtKm = km => (km < 1 ? Math.round(km * 1000 / 50) * 50 + ' м' : km.toFixed(1).replace('.', ',') + ' км');
function fmtDur(min) {
  const t = Math.round(min / 5) * 5, h = Math.floor(t / 60), m = t % 60;
  return h ? `${h} ч${m ? ' ' + m + ' мин' : ''}` : `${m} мин`;
}
const pad = n => String(n).padStart(2, '0');
const hhmm = d => `${pad(d.getHours())}:${pad(d.getMinutes())}`;
const isoDate = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
function dayLabel(d) {
  const t = new Date(); t.setHours(0, 0, 0, 0);
  const x = new Date(d); x.setHours(0, 0, 0, 0);
  const diff = Math.round((x - t) / 86400000);
  const base = x.toLocaleDateString('ru-RU', { day: 'numeric', month: 'short' }).replace('.', '');
  if (diff === 0) return 'Сегодня, ' + base;
  if (diff === 1) return 'Завтра, ' + base;
  return WD[x.getDay()][0].toUpperCase() + WD[x.getDay()][1] + ', ' + base;
}
function addDays(n) { const d = new Date(); d.setHours(0, 0, 0, 0); d.setDate(d.getDate() + n); return d; }
function nextWeekday(wd) { const d = addDays(0); let add = (wd - d.getDay() + 7) % 7; if (add === 0) add = 7; d.setDate(d.getDate() + add); return d; }

// Время заката (алгоритм из «Альманаха», точность ~1–2 мин)
function sunset(day, lat, lng) {
  const r = Math.PI / 180, d = new Date(day.getFullYear(), day.getMonth(), day.getDate());
  const N = Math.floor((d - new Date(d.getFullYear(), 0, 0)) / 86400000);
  const lngHour = lng / 15, t = N + (18 - lngHour) / 24;
  const M = 0.9856 * t - 3.289;
  let L = (M + 1.916 * Math.sin(M * r) + 0.020 * Math.sin(2 * M * r) + 282.634) % 360; if (L < 0) L += 360;
  let RA = Math.atan(0.91764 * Math.tan(L * r)) / r; RA = (RA + 360) % 360;
  RA = (RA + Math.floor(L / 90) * 90 - Math.floor(RA / 90) * 90) / 15;
  const sinDec = 0.39782 * Math.sin(L * r), cosDec = Math.cos(Math.asin(sinDec));
  const cosH = (Math.cos(90.833 * r) - sinDec * Math.sin(lat * r)) / (cosDec * Math.cos(lat * r));
  if (cosH < -1 || cosH > 1) return null;
  const H = Math.acos(cosH) / r / 15;
  let UT = (H + RA - 0.06571 * t - 6.622 - lngHour) % 24; if (UT < 0) UT += 24;
  const out = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()) + UT * 3600000);
  // если из-за часовых поясов ушли на другие сутки — поправим
  if (out.getDate() !== d.getDate()) out.setDate(d.getDate());
  return out;
}

/* ---------- Линия по улицам (пешеходный OSRM от OpenStreetMap) ---------- */
const FOOT_URL = 'https://routing.openstreetmap.de/routed-foot/route/v1/foot/';
const pathCache = new Map();
const pathKey = stops => stops.map(p => p.lat.toFixed(5) + ',' + p.lng.toFixed(5)).join(';');
async function fetchFootPath(stops) {
  const key = pathKey(stops);
  if (pathCache.has(key)) return pathCache.get(key);
  const coords = stops.map(p => `${p.lng.toFixed(6)},${p.lat.toFixed(6)}`).join(';');
  const ctl = new AbortController(); const tm = setTimeout(() => ctl.abort(), 9000);
  try {
    const r = await fetch(`${FOOT_URL}${coords}?overview=full&geometries=geojson&steps=false`, { signal: ctl.signal });
    const j = await r.json();
    if (j.code !== 'Ok' || !j.routes?.[0]) throw new Error(j.code || 'route');
    const rt = j.routes[0];
    const out = {
      path: rt.geometry.coordinates.map(([lng, lat]) => [Math.round(lat * 1e5) / 1e5, Math.round(lng * 1e5) / 1e5]),
      km: rt.distance / 1000,
      legs: rt.legs.map(l => l.distance / 1000),
    };
    pathCache.set(key, out);
    return out;
  } catch (e) { return null; } finally { clearTimeout(tm); }
}
function applyPath(route, fp) {
  route.path = fp.path; route.km = fp.km; route.legs = fp.legs; route.pathKey = pathKey(route.stops);
  const dwell = route.stops.reduce((s, p) => s + (DWELL[p.category] ?? 20), 0);
  route.minutes = Math.round(fp.km / WALK_KMH * 60 + dwell);
}

function rng(seed) { let a = seed >>> 0; return () => { a |= 0; a = a + 0x6D2B79F5 | 0; let t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; }; }

/* ---------- Подбор маршрута ---------- */
function placeBonus(p) {
  let b = 0;
  if (isTask(p)) b += 0.6;                                   // задание — за него дадут баллы
  b += Math.min(4, S.reactions.filter(r => r.place_id === p.id).length) * 0.1;
  b += Math.min(4, S.visits.filter(v => v.place_id === p.id).length) * 0.05;
  return b;
}
function buildRoute({ start, mood, size, seed, removed = [] }) {
  const cfg = SIZES[size], rand = rng(seed);
  let pool = S.places.filter(p => !removed.includes(p.id));
  let moodNote = '';
  if (mood !== 'mix') {
    const m = pool.filter(p => p.category === mood);
    if (m.length >= cfg.n[0]) pool = m;
    else moodNote = `Мест «${CATS[mood].n}» мало — добавил другие поблизости.`;
  }
  if (pool.length < 2) return null;
  let radius = cfg.radius, near = [];
  while (radius <= 40) {
    near = pool.filter(p => hav(start, p) <= radius);
    if (near.length >= cfg.n[0]) break;
    radius *= 2;
  }
  if (near.length < 2) near = pool.slice().sort((a, b) => hav(start, a) - hav(start, b)).slice(0, cfg.n[1] + 2);
  const want = Math.min(cfg.n[1], Math.max(cfg.n[0], near.length));
  const pick = (list, from, prevCat) => list
    .map(p => ({ p, s: hav(from, p) - placeBonus(p) + (prevCat && p.category === prevCat && mood === 'mix' ? 0.25 : 0) + rand() * 0.45 }))
    .sort((a, b) => a.s - b.s)[0]?.p;
  const stops = [];
  let cur = start, left = near.slice();
  while (stops.length < want && left.length) {
    let options = left.filter(p => !stops.length || hav(cur, p) <= cfg.hop);
    if (!options.length) options = left;
    const p = pick(options, cur, stops.at(-1)?.category);
    if (!p) break;
    stops.push(p); left = left.filter(x => x.id !== p.id); cur = p;
  }
  if (stops.length < 2) return null;
  const far = hav(start, stops[0]);
  return { stops, ...routeStats(stops), moodNote, farStart: far > 3 ? far : 0 };
}

/* ---------- Кого позвать ---------- */
function suggestFriends(stops) {
  return S.friends.map(f => {
    let score = 0; const why = [];
    const own = stops.filter(p => p.author_id === f.id);
    if (own.length) { score += 3 * own.length; why.push(`автор «${own[0].title}»`); }
    const reacted = S.reactions.filter(r => r.user_id === f.id && stops.some(p => p.id === r.place_id));
    if (reacted.length) {
      score += 2 * reacted.length;
      const p = stops.find(x => x.id === reacted[0].place_id);
      why.push(`${reacted[0].emoji} на «${p.title}»`);
    }
    const fresh = stops.filter(p => p.author_id !== f.id && !visitOf(p.id, f.id)).length;
    if (fresh) { score += fresh; if (!own.length && !reacted.length) why.push(`${fresh} ${fresh === 1 ? 'новое место' : fresh < 5 ? 'новых места' : 'новых мест'} — до +${fresh * PTS.visit} баллов`); }
    score += Math.min(1, (f.points || 0) / 300);
    return { f, score, why: why.join(' · ') || 'давно не гуляли вместе?' };
  }).sort((a, b) => b.score - a.score);
}

/* ---------- Во сколько встретиться ---------- */
function suggestTimes(day, minutes, at) {
  const now = new Date(), minStart = new Date(now.getTime() + 40 * 60000);
  const isToday = isoDate(day) === isoDate(now);
  const weekend = day.getDay() === 0 || day.getDay() === 6;
  const sun = sunset(day, at.lat, at.lng);
  const mk = (h, m, label) => { const d = new Date(day); d.setHours(h, m, 0, 0); return { d, label }; };
  let opts = weekend
    ? [mk(12, 0, 'Днём'), mk(15, 0, 'После обеда')]
    : [mk(18, 30, 'После учёбы'), mk(19, 30, 'Вечером')];
  if (sun) {
    const g = new Date(sun.getTime() - (minutes + 10) * 60000);
    g.setMinutes(Math.floor(g.getMinutes() / 15) * 15, 0, 0);
    if (g.getHours() >= 9 && (g.getHours() < 21 || (g.getHours() === 21 && g.getMinutes() <= 30))) opts.push({ d: g, label: 'К закату 🌅', golden: true });
  }
  if (isToday) {
    opts = opts.filter(o => o.d >= minStart);
    if (opts.length < 2) {
      const d = new Date(minStart); d.setMinutes(Math.ceil(d.getMinutes() / 15) * 15, 0, 0);
      if (d.getHours() < 23) opts.unshift({ d, label: 'Как можно скорее' });
    }
  }
  const seen = new Set();
  opts = opts.filter(o => { const k = hhmm(o.d); if (seen.has(k)) return false; seen.add(k); return true; })
    .sort((a, b) => a.d - b.d).slice(0, 4);
  return opts.map(o => {
    const end = new Date(o.d.getTime() + minutes * 60000);
    let hint = `закончите ≈ ${hhmm(end)}`;
    if (sun && o.golden) hint += ` · закат ${hhmm(sun)}`;
    else if (sun && end > new Date(sun.getTime() + 30 * 60000)) hint += ' · уже стемнеет';
    return { time: hhmm(o.d), label: o.label, hint };
  });
}

/* ---------- Мастер «Собрать прогулку» ---------- */
let W = null;
function openWalkWizard() {
  if (S.places.length < 2) {
    modal(`<div class="mb"><h2>Собрать прогулку</h2>
      <div class="empty"><span class="ei">🗺️</span><b>Пока мало мест</b>Для маршрута нужно хотя бы 2 места на карте — ваших или друзей. Добавьте места или позовите друзей во вкладке «Друзья».</div></div>`);
    return;
  }
  const c = map.getCenter();
  const evening = new Date().getHours() >= 19;
  W = {
    start: { lat: c.lat, lng: c.lng }, startKind: 'map', mood: 'mix', size: 'mid',
    day: evening ? addDays(1) : addDays(0), seed: Date.now() % 100000, removed: [],
    route: null, picks: null, time: null, title: '', titleTouched: false, note: '',
  };
  renderWizard(true);
}
function recompute(keepPicks) {
  W.route = buildRoute(W);
  if (!W.route) return;
  const sugg = suggestFriends(W.route.stops);
  W.sugg = sugg;
  if (!keepPicks || !W.picks) W.picks = new Set(sugg.filter(x => x.score >= 1).slice(0, 3).map(x => x.f.id));
  W.times = suggestTimes(W.day, W.route.minutes, W.route.stops[0]);
  if (!W.time || !W.times.some(t => t.time === W.time) && !W.customTime) W.time = (W.times.find(t => /закат/.test(t.label)) || W.times[0])?.time || null;
  if (!W.titleTouched) {
    const names = W.route.stops.map(p => p.title);
    W.title = ('Прогулка: ' + names.join(' → ')).slice(0, 80);
  }
}
function renderWizard(fresh) {
  if (fresh) recompute(false);
  const R = W.route;
  const moods = [['mix', '🎲 Микс'], ...Object.entries(CATS).filter(([k]) => S.places.some(p => p.category === k)).map(([k, c]) => [k, c.e + ' ' + c.n])];
  const days = [['Сегодня', addDays(0)], ['Завтра', addDays(1)], ['В субботу', nextWeekday(6)], ['В воскресенье', nextWeekday(0)]];
  const dayChips = days.filter((x, i, a) => a.findIndex(y => isoDate(y[1]) === isoDate(x[1])) === i);
  const m = modal(`
    <div class="mb" id="wiz">
      <h2>Собрать прогулку</h2>
      <p class="intro">Выберите настроение и день — маршрут по местам друзей, компания и время встречи подберутся сами.</p>
      <div class="field"><span>Откуда начнём</span><div class="seg">
        <button type="button" class="chip" data-start="geo" aria-pressed="${W.startKind === 'geo'}">📍 Где я сейчас</button>
        <button type="button" class="chip" data-start="map" aria-pressed="${W.startKind === 'map'}">🗺️ Центр карты</button>
      </div></div>
      <div class="field"><span>Настроение</span><div class="seg">${moods.map(([k, l]) => `<button type="button" class="chip" data-mood="${k}" aria-pressed="${W.mood === k}">${esc(l)}</button>`).join('')}</div></div>
      <div class="field"><span>Длина</span><div class="seg">${Object.entries(SIZES).map(([k, s]) => `<button type="button" class="chip" data-size="${k}" aria-pressed="${W.size === k}">${s.label} <small>${s.hint}</small></button>`).join('')}</div></div>
      <div class="field"><span>Когда</span><div class="seg">${dayChips.map(([l, d]) => `<button type="button" class="chip" data-day="${isoDate(d)}" aria-pressed="${isoDate(W.day) === isoDate(d)}">${l}</button>`).join('')}
        <input type="date" class="input datein" id="wday" value="${isoDate(W.day)}" min="${isoDate(addDays(0))}" aria-label="Дата"></div></div>
      ${R ? `
      <div class="wsec">
        <div class="whead"><div><div class="sec">Ваш маршрут</div><div class="wsum">${R.stops.length} ${plural(R.stops.length, 'место', 'места', 'мест')} · ${fmtKm(R.km)} ${R.pathKey === pathKey(R.stops) ? 'по улицам' : 'пешком'} · ~${fmtDur(R.minutes)}</div></div>
          <button type="button" class="sbtn ghost sm" data-reroll>🔀 Другой маршрут</button></div>
        ${R.moodNote ? `<div class="hint">${esc(R.moodNote)}</div>` : ''}
        ${R.farStart ? `<div class="hint">Ближайшее подходящее место в ${fmtKm(R.farStart)} от старта.</div>` : ''}
        <ol class="rlist">${R.stops.map((p, i) => {
          const c = CATS[p.category] || CATS.other;
          return `<li class="ritem"><span class="rnum">${i + 1}</span>
            ${p.photo_url ? `<img src="${esc(p.photo_url)}" alt="">` : `<span class="thumb sm">${c.e}</span>`}
            <div style="min-width:0"><div class="t">${esc(p.title)}</div>
              <div class="s">${c.n} · ${esc(nameOf(p.author_id))}${i ? ` · ${fmtKm(R.legs && R.pathKey === pathKey(R.stops) ? R.legs[i - 1] : legKm(R.stops[i - 1], p))} от предыдущего` : ''}${isTask(p) ? ` · <b class="plusb">+${PTS.visit}</b>` : ''}</div></div>
            <button type="button" class="rx" data-drop="${p.id}" aria-label="Убрать из маршрута" title="Убрать">×</button></li>`;
        }).join('')}</ol>
        <div class="hint">Встречаемся у «${esc(R.stops[0].title)}».</div>
      </div>
      <div class="wsec">
        <div class="sec">Кого позвать</div>
        ${W.sugg.length ? `<div class="flist">${W.sugg.map(({ f, why }) => `
          <button type="button" class="fpick" data-pick="${f.id}" aria-pressed="${W.picks.has(f.id)}">
            ${avatar(f, 'sm')}<span class="fp-t"><b>${esc(f.name)}</b><small>${esc(why)}</small></span><span class="fp-c">${W.picks.has(f.id) ? '✓ Зовём' : 'Позвать'}</span>
          </button>`).join('')}</div>` : '<div class="empty">Добавьте друзей во вкладке «Друзья», чтобы звать их гулять.</div>'}
      </div>
      <div class="wsec">
        <div class="sec">Во сколько встретиться <span class="n">${esc(dayLabel(W.day))}</span></div>
        <div class="tgrid">${W.times.map(t => `<button type="button" class="tchip" data-time="${t.time}" aria-pressed="${W.time === t.time}"><b>${t.time}</b><span>${esc(t.label)}</span><small>${esc(t.hint)}</small></button>`).join('')}</div>
        <label class="field tother"><span>Другое время</span><input type="time" class="input" id="wtime" value="${W.time || ''}"></label>
      </div>
      <form class="form" id="wform">
        <label class="field"><span>Название</span><input type="text" name="title" maxlength="80" value="${esc(W.title)}"></label>
        <label class="field"><span>Заметка для друзей <em class="hint">(необязательно)</em></span><input type="text" name="note" maxlength="500" value="${esc(W.note)}" placeholder="Например: возьмите пауэрбанк и хорошее настроение"></label>
        <div class="err" id="werr"></div>
        <button class="cta" type="submit" id="wgo">${W.picks.size ? `Создать и позвать (${W.picks.size})` : 'Создать прогулку'}</button>
      </form>`
      : `<div class="empty"><b>Не получилось собрать маршрут</b>Попробуйте другое настроение, длину или старт — или добавьте больше мест.</div>`}
    </div>`);

  const reroll = keep => { recompute(keep); const st = m.scrollTop; renderWizard(); $('.modal').scrollTop = st; };
  m.querySelectorAll('[data-mood]').forEach(b => b.onclick = () => { W.mood = b.dataset.mood; W.removed = []; reroll(true); });
  m.querySelectorAll('[data-size]').forEach(b => b.onclick = () => { W.size = b.dataset.size; W.removed = []; reroll(true); });
  m.querySelectorAll('[data-day]').forEach(b => b.onclick = () => { W.day = new Date(b.dataset.day + 'T00:00'); W.customTime = false; reroll(true); });
  m.querySelector('#wday').onchange = e => { if (e.target.value) { W.day = new Date(e.target.value + 'T00:00'); W.customTime = false; reroll(true); } };
  m.querySelectorAll('[data-start]').forEach(b => b.onclick = () => {
    if (b.dataset.start === 'map') { const c = map.getCenter(); W.start = { lat: c.lat, lng: c.lng }; W.startKind = 'map'; W.removed = []; return reroll(true); }
    if (!navigator.geolocation) return toast('Геолокация недоступна');
    toast('Определяю, где вы…');
    navigator.geolocation.getCurrentPosition(p => { W.start = { lat: p.coords.latitude, lng: p.coords.longitude }; W.startKind = 'geo'; W.removed = []; reroll(true); },
      () => toast('Не удалось определить место — беру центр карты'), { enableHighAccuracy: true, timeout: 10000 });
  });
  if (!R) return;
  if (R.pathKey !== pathKey(R.stops)) {
    const want = pathKey(R.stops);
    fetchFootPath(R.stops).then(fp => {
      if (!fp || !W || W.route !== R || pathKey(R.stops) !== want || !$('#wiz')) return;
      applyPath(R, fp);
      W.times = suggestTimes(W.day, R.minutes, R.stops[0]);
      if (!W.customTime && !W.times.some(t => t.time === W.time)) W.time = (W.times.find(t => /закат/.test(t.label)) || W.times[0])?.time || null;
      const st = $('.modal').scrollTop; renderWizard(); $('.modal').scrollTop = st;
    });
  }
  m.querySelector('[data-reroll]').onclick = () => { W.seed = (W.seed * 7919 + 13) % 1000003; W.removed = []; reroll(true); };
  m.querySelectorAll('[data-drop]').forEach(b => b.onclick = () => {
    if (R.stops.length <= 2) return toast('В маршруте должно остаться хотя бы 2 места');
    const id = Number(b.dataset.drop);
    const stops = R.stops.filter(p => p.id !== id);
    W.route = { ...R, stops, ...routeStats(stops) };
    W.removed.push(id);
    W.sugg = suggestFriends(stops);
    W.times = suggestTimes(W.day, W.route.minutes, stops[0]);
    if (!W.titleTouched) W.title = ('Прогулка: ' + stops.map(p => p.title).join(' → ')).slice(0, 80);
    const st = $('.modal').scrollTop; renderWizard(); $('.modal').scrollTop = st;
  });
  m.querySelectorAll('[data-pick]').forEach(b => b.onclick = () => {
    const id = b.dataset.pick; W.picks.has(id) ? W.picks.delete(id) : W.picks.add(id);
    const on = W.picks.has(id);
    b.setAttribute('aria-pressed', on); b.querySelector('.fp-c').textContent = on ? '✓ Зовём' : 'Позвать';
    m.querySelector('#wgo').textContent = W.picks.size ? `Создать и позвать (${W.picks.size})` : 'Создать прогулку';
  });
  m.querySelectorAll('[data-time]').forEach(b => b.onclick = () => {
    W.time = b.dataset.time; W.customTime = false;
    m.querySelectorAll('[data-time]').forEach(x => x.setAttribute('aria-pressed', x === b));
    m.querySelector('#wtime').value = W.time;
  });
  m.querySelector('#wtime').onchange = e => {
    W.time = e.target.value || null; W.customTime = true;
    m.querySelectorAll('[data-time]').forEach(x => x.setAttribute('aria-pressed', x.dataset.time === W.time));
  };
  const f = m.querySelector('#wform');
  f.title.oninput = e => { W.title = e.target.value; W.titleTouched = true; };
  f.note.oninput = e => { W.note = e.target.value; };
  f.onsubmit = async e => {
    e.preventDefault();
    const err = m.querySelector('#werr'); err.textContent = '';
    const title = W.title.trim();
    if (!title) return (err.textContent = 'Напишите название');
    if (!W.time) return (err.textContent = 'Выберите время встречи');
    const [h, mi] = W.time.split(':').map(Number);
    const starts = new Date(W.day); starts.setHours(h, mi, 0, 0);
    if (starts < new Date(Date.now() - 5 * 60000)) return (err.textContent = 'Это время уже прошло — выберите другое');
    const btn = m.querySelector('#wgo'); btn.disabled = true; btn.textContent = 'Создаю…';
    try {
      const R = W.route;
      const route = R.stops.map(p => ({ id: p.id, title: p.title, lat: p.lat, lng: p.lng, category: p.category, photo_url: p.photo_url || null }));
      const ins = await sb.from('plans').insert({
        title, starts_at: starts.toISOString(), note: W.note.trim() || null, route,
        km: Math.round(R.km * 100) / 100, minutes: R.minutes,
        path: R.pathKey === pathKey(R.stops) ? R.path : null,
      }).select('id').single();
      if (ins.error) throw ins.error;
      const id = ins.data.id;
      if (W.picks.size) {
        const r2 = await sb.from('plan_members').insert([...W.picks].map(u => ({ plan_id: id, user_id: u })));
        if (r2.error) throw r2.error;
      }
      closeModal();
      toast(W.picks.size ? `Прогулка создана — ${W.picks.size === 1 ? 'другу отправлено приглашение' : 'друзьям отправлены приглашения'}` : 'Прогулка создана', 3500);
      S.tab = 'walks';
      document.querySelectorAll('.tab').forEach(x => x.setAttribute('aria-selected', x.dataset.tab === 'walks'));
      await refresh(false);
      showRoute(id);
    } catch (ex) { err.textContent = errText(ex); btn.disabled = false; btn.textContent = 'Создать прогулку'; }
  };
}

/* ---------- Маршрут на карте ---------- */
let routeLayer = null;
const routeColor = () => getComputedStyle(document.documentElement).getPropertyValue('--route').trim() || '#2F4BFF';
function showRoute(planId) {
  const pl = S.plans.find(x => x.id === planId);
  if (!pl || !pl.route?.length) return;
  S.routePlan = planId;
  if (isMobile()) setTab('map');
  setTimeout(drawRoute, isMobile() ? 60 : 0);
}
function hideRoute() { S.routePlan = null; drawRoute(); }
function drawRoute() {
  if (!routeLayer) routeLayer = L.layerGroup().addTo(map);
  routeLayer.clearLayers();
  const bar = $('#routebar');
  const pl = S.plans.find(x => x.id === S.routePlan);
  if (!pl) { if (bar) bar.hidden = true; return; }
  const pts = pl.route.map(p => [p.lat, p.lng]);
  const line = Array.isArray(pl.path) && pl.path.length > 1 ? pl.path : (pathCache.get(pathKey(pl.route))?.path || pts);
  const street = line !== pts;
  L.polyline(line, { color: '#ffffff', weight: street ? 8 : 9, opacity: 0.95, lineCap: 'round', lineJoin: 'round' }).addTo(routeLayer);
  L.polyline(line, street ? { color: routeColor(), weight: 5, opacity: 0.95, lineCap: 'round', lineJoin: 'round' }
    : { color: routeColor(), weight: 5, dashArray: '2 10', lineCap: 'round', lineJoin: 'round' }).addTo(routeLayer);
  if (!street) {
    const id = pl.id;
    fetchFootPath(pl.route).then(fp => { if (fp && S.routePlan === id) drawRoute(); });
  }
  pl.route.forEach((p, i) => {
    L.marker([p.lat, p.lng], {
      icon: L.divIcon({ className: '', iconSize: [28, 28], iconAnchor: [14, 14], html: `<div class="rpin">${i + 1}</div>` }),
      zIndexOffset: 1000, title: p.title,
    }).on('click', () => { if (S.places.some(x => x.id === p.id)) openPlace(p.id); else if (typeof CUR !== 'undefined' && CUR.byId.has(p.id)) openCurated(p.id); else toast(p.title); }).addTo(routeLayer);
  });
  map.fitBounds(L.latLngBounds(pts).pad(0.25), { maxZoom: 16 });
  if (bar) {
    bar.hidden = false;
    bar.innerHTML = `<div style="min-width:0;flex:1"><div class="rb-t">${esc(pl.title)}</div>
      <div class="rb-s">${esc(dayLabel(new Date(pl.starts_at)))} · ${hhmm(new Date(pl.starts_at))} · ${fmtKm(Number(pl.km) || 0)} · ~${fmtDur(pl.minutes || 0)}</div></div>
      <button type="button" class="rb-b" id="rbOpen">Подробнее</button><button type="button" class="rb-x" id="rbX" aria-label="Скрыть маршрут">×</button>`;
    bar.querySelector('#rbOpen').onclick = () => openWalk(pl.id);
    bar.querySelector('#rbX').onclick = hideRoute;
  }
}

/* ---------- Карточка прогулки ---------- */
const STATUS = { going: ['идёт', 'ok'], invited: ['думает', 'wait'], declined: ['не сможет', 'no'] };
const membersOf = id => S.planMembers.filter(m => m.plan_id === id);
const myStatus = pl => pl.author_id === S.user.id ? 'author' : membersOf(pl.id).find(m => m.user_id === S.user.id)?.status;

function openWalk(id) {
  const pl = S.plans.find(x => x.id === id);
  if (!pl) return toast('Прогулка не найдена');
  const start = new Date(pl.starts_at), mine = pl.author_id === S.user.id, st = myStatus(pl);
  const mem = membersOf(pl.id);
  const going = mem.filter(m => m.status === 'going').length + 1;
  const canInvite = mine ? S.friends.filter(f => !mem.some(m => m.user_id === f.id)) : [];
  const canEdit = mine || st === 'going' || st === 'invited';
  const m = modal(`
    <div class="mb">
      <div class="pl-date">${esc(dayLabel(start))} · ${hhmm(start)}</div>
      <h2>${esc(pl.title)}</h2>
      <div class="by">${avatar(prof(pl.author_id), 'sm')}<span>Организатор: <b>${mine ? 'вы' : esc(nameOf(pl.author_id))}</b></span></div>
      <div class="state info">📍 Встречаемся у «${esc(pl.route[0]?.title || '—')}» в ${hhmm(start)} · ${fmtKm(Number(pl.km) || 0)} · ~${fmtDur(pl.minutes || 0)}</div>
      ${pl.note ? `<p class="note">${esc(pl.note)}</p>` : ''}
      ${!mine && st ? `<div class="answer">
        <button type="button" class="cta ${st === 'going' ? '' : 'ghost'}" data-ans="going">${st === 'going' ? '✓ Я иду' : '🙋 Иду'}</button>
        <button type="button" class="cta ${st === 'declined' ? 'danger' : 'ghost'}" data-ans="declined">${st === 'declined' ? 'Не смогу ✕' : 'Не смогу'}</button></div>` : ''}
      <div class="sec">Маршрут <span class="n">${pl.route.length}</span></div>
      <ol class="rlist">${pl.route.map((p, i) => {
        const c = CATS[p.category] || CATS.other, vis = S.places.some(x => x.id === p.id) || (typeof CUR !== 'undefined' && CUR.byId.has(p.id));
        const by = p.added_by && p.added_by !== pl.author_id ? p.added_by : null;
        const canDel = pl.route.length > 1 && (mine || (by && by === S.user.id));
        return `<li class="ritem${by ? ' added' : ''}"><span class="rnum">${i + 1}</span>
          ${p.photo_url ? `<img src="${esc(p.photo_url)}" alt="">` : `<span class="thumb sm">${c.e}</span>`}
          <div style="min-width:0"><div class="t">${vis ? `<button type="button" class="rname" data-op="${p.id}">${esc(p.title)}</button>` : esc(p.title)}</div>
            <div class="s">${c.n}${i ? ` · ${fmtKm(legKm(pl.route[i - 1], p))} от предыдущего` : ' · место встречи'}${by ? ` · <span class="addby">${avatar(prof(by), 'xs')} добавил${by === S.user.id ? 'и вы' : ': ' + esc(nameOf(by))}</span>` : ''}</div></div>
          ${canDel ? `<button type="button" class="rdel" data-del="${esc(String(p.id))}" aria-label="Убрать «${esc(p.title)}» из маршрута">×</button>` : ''}</li>`;
      }).join('')}</ol>
      ${canEdit ? `<div class="addwalk">
        <button type="button" class="cta ghost" data-addpt>➕ Добавить своё место в маршрут</button>
        <p class="hint">${mine ? 'Друзья тоже могут добавлять места — маршрут пересчитается для всех.' : 'Хотите заглянуть куда-то ещё? Добавьте место — его увидят все участники.'}</p>
        ${mine && pl.route.length >= 3 ? '<button type="button" class="linkbtn" data-reorder>🔀 Пересчитать порядок, чтобы идти меньше</button>' : ''}</div>` : ''}
      <button type="button" class="cta ghost" data-show>🗺️ Показать маршрут на карте</button>
      <a class="lbtn" style="align-self:flex-start" target="_blank" rel="noopener noreferrer" href="https://yandex.ru/maps/?rtext=${pl.route.map(p => p.lat + ',' + p.lng).join('~')}&rtt=pd">🧭 Открыть маршрут в Яндекс Картах</a>
      <div class="sec">Кто идёт <span class="n">${going} из ${mem.length + 1}</span></div>
      <div class="flist">
        <div class="mrow">${avatar(prof(pl.author_id), 'sm')}<b>${mine ? 'Вы' : esc(nameOf(pl.author_id))}</b><span class="mst ok">организатор</span></div>
        ${mem.map(x => `<div class="mrow">${avatar(prof(x.user_id), 'sm')}<b>${esc(nameOf(x.user_id))}</b><span class="mst ${STATUS[x.status][1]}">${STATUS[x.status][0]}</span>
          ${mine ? `<button type="button" class="linkbtn" data-kick="${x.user_id}">убрать</button>` : ''}</div>`).join('')}
      </div>
      ${canInvite.length ? `<div class="sec">${mem.length ? 'Позвать ещё' : 'Позвать друзей'}</div>
        <p class="hint">Друзья увидят маршрут, ответят «иду» или «не смогу» и смогут добавить свои места.</p>
        <div class="seg">${canInvite.map(f => `<button type="button" class="chip" data-inv="${f.id}">${avatar(f, 'sm')} ${esc(f.name)}</button>`).join('')}</div>` : ''}
      <button type="button" class="linkbtn warn" data-leave>${mine ? 'Отменить прогулку' : 'Выйти из прогулки'}</button>
    </div>`);
  m.querySelector('[data-show]').onclick = () => { closeModal(); showRoute(pl.id); };
  m.querySelector('[data-addpt]')?.addEventListener('click', () => openAddToWalk(pl.id));
  m.querySelector('[data-reorder]')?.addEventListener('click', () => reorderWalk(pl.id));
  m.querySelectorAll('[data-del]').forEach(b => b.onclick = () => removePointFromWalk(pl.id, b.dataset.del));
  m.querySelectorAll('[data-op]').forEach(b => b.onclick = () => { const id = b.dataset.op; if (/^m-/.test(id)) openCurated(id); else openPlace(Number(id)); });
  m.querySelectorAll('[data-ans]').forEach(b => b.onclick = async () => {
    const { error } = await sb.from('plan_members').update({ status: b.dataset.ans, updated_at: new Date().toISOString() })
      .match({ plan_id: pl.id, user_id: S.user.id });
    if (error) return toast(errText(error));
    toast(b.dataset.ans === 'going' ? 'Отлично, вы идёте! 🎉' : 'Ответ отправлен');
    await refresh(); openWalk(pl.id);
  });
  m.querySelectorAll('[data-inv]').forEach(b => b.onclick = async () => {
    const { error } = await sb.from('plan_members').insert({ plan_id: pl.id, user_id: b.dataset.inv });
    if (error) return toast(errText(error));
    toast('Приглашение отправлено'); await refresh(); openWalk(pl.id);
  });
  m.querySelectorAll('[data-kick]').forEach(b => b.onclick = async () => {
    const { error } = await sb.from('plan_members').delete().match({ plan_id: pl.id, user_id: b.dataset.kick });
    if (error) return toast(errText(error));
    await refresh(); openWalk(pl.id);
  });
  m.querySelector('[data-leave]').onclick = async () => {
    if (!(await ask(mine ? 'Отменить прогулку для всех?' : 'Выйти из прогулки?', mine ? 'Отменить прогулку' : 'Выйти'))) return;
    const r = mine ? await sb.from('plans').delete().eq('id', pl.id)
      : await sb.from('plan_members').delete().match({ plan_id: pl.id, user_id: S.user.id });
    if (r.error) return toast(errText(r.error));
    if (S.routePlan === pl.id) hideRoute();
    closeModal(); toast(mine ? 'Прогулка отменена' : 'Вы вышли из прогулки'); refresh();
  };
}

/* ---------- Совместный маршрут: друзья добавляют свои места ---------- */
const WALK_CAT = { eat: 'food', culture: 'culture', photo: 'photo', walk: 'walk' };
function rpcErr(e) {
  const t = (e?.message || '') + ' ' + (e?.code || '');
  if (/Could not find the function|PGRST202|does not exist|schema cache/i.test(t)) return 'Добавление мест друзьями заработает после обновления базы данных — организатору нужно один раз выполнить SQL из инструкции.';
  if (/already in route/.test(t)) return 'Это место уже есть в маршруте';
  if (/too many points/.test(t)) return 'В маршруте уже 30 мест — больше не поместится';
  if (/not a member/.test(t)) return 'Добавлять места могут только участники прогулки';
  if (/only the organizer/.test(t)) return 'Убрать место может организатор или тот, кто его добавил';
  return errText(e);
}
// Куда вставить новое место, чтобы идти меньше всего (место встречи остаётся первым)
function bestInsert(route, p) {
  let bi = route.length, best = Infinity;
  for (let i = route.length ? 1 : 0; i <= route.length; i++) {
    const r = [...route.slice(0, i), p, ...route.slice(i)];
    const k = routeStats(r).km;
    if (k < best - 1e-9) { best = k; bi = i; }
  }
  return bi;
}
function walkCandidates(pl, q) {
  const inRoute = new Set(pl.route.map(p => String(p.id)));
  const ql = (q || '').trim().toLowerCase();
  const fr = S.places.map(p => ({ id: p.id, title: p.title, lat: p.lat, lng: p.lng, category: p.category, photo_url: p.photo_url || null, mins: DWELL[p.category] ?? 30,
    src: p.author_id === S.user.id ? 'ваше место' : 'место ' + nameOf(p.author_id), txt: p.title + ' ' + (p.note || '') }));
  const cu = typeof CUR !== 'undefined' ? CUR.list.map(p => ({ id: p.id, title: p.name, lat: p.lat, lng: p.lng, category: WALK_CAT[p.cat], photo_url: p.img || null, mins: p.mins,
    src: CUR_CATS[p.cat].n.toLowerCase() + (p.price ? ' · ' + PRICE[p.price] : ''), txt: p.name + ' ' + p.desc, pop: p.pop || 0 })) : [];
  return [...fr, ...cu].filter(p => !inRoute.has(String(p.id)) && (!ql || p.txt.toLowerCase().includes(ql)))
    .map(p => ({ ...p, d: Math.min(...pl.route.map(r => hav(r, p))) })).sort((a, b) => (a.d - (a.src.startsWith('место') || a.src.startsWith('ваше') ? 0.6 : 0)) - (b.d - (b.src.startsWith('место') || b.src.startsWith('ваше') ? 0.6 : 0)));
}
function openAddToWalk(id, q = '') {
  const pl = S.plans.find(x => x.id === id); if (!pl) return;
  const list = walkCandidates(pl, q).slice(0, 40);
  const m = modal(`
    <div class="mb">
      <h2>Добавить место</h2>
      <p class="intro">Выберите, куда ещё хочется зайти. Место встанет в маршрут там, где придётся меньше всего идти, — все участники увидят изменения.</p>
      <input class="input" id="awQ" type="search" placeholder="Найти: кофе, музей, парк…" value="${esc(q)}" aria-label="Поиск места">
      <div class="clist">${list.length ? list.map(p => `
        <div class="citem">
          <div class="ci-main" style="cursor:default">
            ${p.photo_url ? `<img class="thumb" src="${esc(p.photo_url)}" alt="" loading="lazy">` : `<span class="thumb">${(CATS[p.category] || CATS.other).e}</span>`}
            <span class="ci-t"><b>${esc(p.title)}</b><em>${esc(p.src)} · ${fmtKm(p.d)} от маршрута</em></span>
          </div>
          <button type="button" class="ci-add" data-pick="${esc(String(p.id))}" aria-label="Добавить «${esc(p.title)}» в маршрут">+</button>
        </div>`).join('') : '<div class="empty">Ничего не нашлось — попробуйте другое слово.</div>'}</div>
      <button type="button" class="linkbtn" id="awBack">← Назад к прогулке</button>
    </div>`);
  let t; m.querySelector('#awQ').oninput = e => { clearTimeout(t); t = setTimeout(() => { const v = e.target.value; openAddToWalk(id, v); const i = $('#awQ'); i.focus(); i.setSelectionRange(v.length, v.length); }, 250); };
  m.querySelector('#awBack').onclick = () => openWalk(id);
  m.querySelectorAll('[data-pick]').forEach(b => b.onclick = async () => {
    const it = list.find(x => String(x.id) === b.dataset.pick); if (!it) return;
    b.disabled = true; b.textContent = '…';
    await addPointToWalk(pl, it);
  });
}
async function addPointToWalk(pl, it) {
  const p = { id: it.id, title: it.title, lat: it.lat, lng: it.lng, category: it.category, photo_url: it.photo_url, mins: it.mins };
  const i = bestInsert(pl.route, p);
  const st = routeStats([...pl.route.slice(0, i), p, ...pl.route.slice(i)]);
  const { error } = await sb.rpc('plan_add_point', { p_plan: pl.id, p_point: p, p_index: i, p_km: Math.round(st.km * 100) / 100, p_minutes: st.minutes });
  if (error) { toast(rpcErr(error), 5000); return openWalk(pl.id); }
  toast(`«${it.title}» в маршруте — ${i + 1}-я точка`, 3000);
  pathCache.delete?.(pathKey(pl.route));
  await refresh(false);
  if (S.routePlan === pl.id) drawRoute();
  openWalk(pl.id);
}
async function removePointFromWalk(id, pid) {
  const pl = S.plans.find(x => x.id === id); if (!pl) return;
  const p = pl.route.find(x => String(x.id) === pid); if (!p) return;
  if (!(await ask(`Убрать «${p.title}» из маршрута?`, 'Убрать'))) return;
  const st = routeStats(pl.route.filter(x => String(x.id) !== pid));
  const { error } = await sb.rpc('plan_remove_point', { p_plan: id, p_id: pid, p_km: Math.round(st.km * 100) / 100, p_minutes: st.minutes });
  if (error) return toast(rpcErr(error), 5000);
  toast('Место убрано из маршрута');
  await refresh(false);
  if (S.routePlan === id) drawRoute();
  openWalk(id);
}
// Организатор может переставить места, чтобы идти меньше (место встречи остаётся первым)
async function reorderWalk(id) {
  const pl = S.plans.find(x => x.id === id); if (!pl || pl.route.length < 3) return;
  const [first, ...rest] = pl.route;
  let best = rest.slice(), bestKm = routeStats([first, ...best]).km, improved = true, guard = 0;
  while (improved && guard++ < 50) {
    improved = false;
    for (let i = 0; i < best.length - 1; i++) for (let k = i + 1; k < best.length; k++) {
      const cand = [...best.slice(0, i), ...best.slice(i, k + 1).reverse(), ...best.slice(k + 1)];
      const km = routeStats([first, ...cand]).km;
      if (km < bestKm - 1e-6) { best = cand; bestKm = km; improved = true; }
    }
  }
  const route = [first, ...best], st = routeStats(route);
  if (route.every((p, i) => p === pl.route[i])) return toast('Порядок уже самый короткий 👌');
  const { error } = await sb.from('plans').update({ route, km: Math.round(st.km * 100) / 100, minutes: st.minutes, path: null }).eq('id', id);
  if (error) return toast(errText(error));
  toast(`Готово: теперь ${fmtKm(st.km)} пешком`);
  await refresh(false);
  if (S.routePlan === id) drawRoute();
  openWalk(id);
}

/* ---------- Вкладка «Прогулки» ---------- */
function walkCard(pl, past) {
  const start = new Date(pl.starts_at), st = myStatus(pl), mem = membersOf(pl.id);
  const people = [pl.author_id, ...mem.filter(m => m.status !== 'declined').map(m => m.user_id)];
  const badge = st === 'author' ? '<span class="mst ok">вы организатор</span>'
    : st === 'invited' ? '<span class="mst wait">ответьте, пойдёте ли</span>'
    : st === 'going' ? '<span class="mst ok">вы идёте</span>' : '<span class="mst no">не пойдёте</span>';
  return `<button type="button" class="plcard${st === 'invited' && !past ? ' inv' : ''}${past ? ' past' : ''}" data-walk="${pl.id}">
    <div class="pl-date">${esc(dayLabel(start))} · ${hhmm(start)}</div>
    <div class="pl-t">${esc(pl.title)}</div>
    <div class="pl-m"><span class="stack">${people.slice(0, 6).map(id => avatar(prof(id), 'sm')).join('')}</span>
      <span>${pl.route.length} ${plural(pl.route.length, 'место', 'места', 'мест')}, ${fmtKm(Number(pl.km) || 0)}</span>${badge}</div>
  </button>`;
}
function renderWalks(body) {
  const now = Date.now();
  const list = S.plans.slice().sort((a, b) => new Date(a.starts_at) - new Date(b.starts_at));
  const upcoming = list.filter(p => new Date(p.starts_at).getTime() + (p.minutes || 120) * 60000 > now);
  const invites = upcoming.filter(p => myStatus(p) === 'invited');
  const rest = upcoming.filter(p => myStatus(p) !== 'invited');
  const past = list.filter(p => !upcoming.includes(p)).reverse().slice(0, 5);
  body.innerHTML = `
    <div class="ptitle">Прогулки</div>
    <p class="intro">Сайт соберёт маршрут по местам друзей, подскажет, кого позвать и во сколько встретиться.</p>
    <div class="wcta">
      <button type="button" class="cta" id="newWalk">🚶 Прогулка с друзьями</button>
      <button type="button" class="cta ghost" id="newDay">🧭 Маршрут по городу на день</button>
    </div>
    ${invites.length ? sec('Вас зовут', invites.length) + invites.map(walkCard).join('') : ''}
    ${sec('Ближайшие', rest.length)}
    ${rest.length ? rest.map(walkCard).join('') : '<div class="empty"><span class="ei">🌇</span><b>Пока ничего не запланировано</b>Соберите прогулку — друзья получат приглашение здесь же.</div>'}
    ${past.length ? sec('Прошедшие') + past.map(p => walkCard(p, true)).join('') : ''}`;
  body.querySelector('#newWalk').onclick = openWalkWizard;
  body.querySelector('#newDay').onclick = () => (typeof openDayPlanner === 'function' ? openDayPlanner() : null);
  body.querySelectorAll('[data-walk]').forEach(b => b.onclick = () => openWalk(Number(b.dataset.walk)));
}
function walkInvitesCount() {
  const now = Date.now();
  return S.plans.filter(p => myStatus(p) === 'invited' && new Date(p.starts_at).getTime() > now).length;
}
