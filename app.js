/* «Место вместе» — MVP. Карта OpenStreetMap (Leaflet) + сервер Supabase на своём ПК. */
'use strict';

const CFG = window.MESTO_CONFIG || {};
const $ = (s, r = document) => r.querySelector(s);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

const CATS = {
  food:    { n: 'Поесть',    e: '🍜', c: '#E2553B' },
  coffee:  { n: 'Кофе',      e: '☕', c: '#9A6B3F' },
  walk:    { n: 'Погулять',  e: '🌳', c: '#18915A' },
  photo:   { n: 'Для фото',  e: '📸', c: '#9B3FD1' },
  culture: { n: 'Культура',  e: '🏛️', c: '#2B7BD6' },
  fun:     { n: 'Развлечения', e: '🎳', c: '#D9367A' },
  other:   { n: 'Другое',    e: '📍', c: '#5B6479' },
};
const EMOJIS = ['❤️', '🔥', '😍', '👍', '🤤'];
const AVATARS = ['🦊', '🐼', '🐸', '🐙', '🦄', '🐯', '🐨', '🐧', '🦉', '🐳', '🌻', '🍕', '⚡', '🎧', '🛹', '🚀'];
const COLORS = ['#3346F0', '#E2553B', '#18915A', '#9B3FD1', '#E2A21B', '#169C86', '#D9367A', '#2B7BD6'];
const PTS = { place: 5, visit: 20, visited: 5 };

if (!window.supabase || !window.L) {
  document.body.innerHTML = '<div style="padding:24px;font-family:sans-serif"><h2>Не загрузились библиотеки</h2><p>Проверьте интернет и обновите страницу (F5).</p></div>';
  throw new Error('libs');
}
const sb = window.supabase.createClient(CFG.SUPABASE_URL, CFG.SUPABASE_ANON_KEY);

const S = {
  user: null, me: null,
  profiles: new Map(),        // id -> профиль (я + друзья + те, кто в заявках)
  friends: [], incoming: [], outgoing: [],
  places: [], reactions: [], visits: [],
  plans: [], planMembers: [], routePlan: null,
  tab: 'tasks', filter: 'all', adding: false,
};

/* ---------- Утилиты ---------- */
function toast(msg, ms = 2600) {
  const t = $('#toast'); t.textContent = msg; t.hidden = false;
  clearTimeout(toast._t); toast._t = setTimeout(() => (t.hidden = true), ms);
}
function ago(ts) {
  const d = (Date.now() - new Date(ts)) / 1000;
  if (d < 60) return 'только что';
  if (d < 3600) return Math.floor(d / 60) + ' мин назад';
  if (d < 86400) return Math.floor(d / 3600) + ' ч назад';
  if (d < 86400 * 7) return Math.floor(d / 86400) + ' дн назад';
  return new Date(ts).toLocaleDateString('ru-RU', { day: 'numeric', month: 'short' });
}
function avatar(p, cls = '') {
  if (!p) return `<span class="av ${cls}" style="background:#999">?</span>`;
  const emo = p.avatar ? ' emo' : '';
  return `<span class="av ${cls}${emo}" style="background:${esc(p.color)}">${esc(p.avatar || (p.name || '?')[0].toUpperCase())}</span>`;
}
const prof = id => S.profiles.get(id);
const nameOf = id => (id === S.user?.id ? 'Вы' : prof(id)?.name || 'Кто-то');
const visitOf = (placeId, userId) => S.visits.find(v => v.place_id === placeId && v.user_id === userId);
const isTask = p => p.author_id !== S.user.id && !visitOf(p.id, S.user.id);
function errText(e) {
  const m = e?.message || String(e);
  if (/Failed to fetch|NetworkError|Load failed/i.test(m)) return 'Сервер не отвечает. Запущен ли Supabase (start-supabase.bat)?';
  if (/Invalid login credentials/i.test(m)) return 'Неверная почта или пароль';
  if (/already registered/i.test(m)) return 'Эта почта уже зарегистрирована — войдите';
  if (/Password should be/i.test(m)) return 'Пароль слишком короткий (минимум 6 символов)';
  return m;
}

/* Сжать фото до 1600px JPEG — быстрее грузится и меньше места на диске */
function compress(source, max = 1600, q = 0.85) {
  return new Promise((resolve, reject) => {
    const draw = img => {
      const w = img.naturalWidth || img.videoWidth, h = img.naturalHeight || img.videoHeight;
      const k = Math.min(1, max / Math.max(w, h));
      const c = document.createElement('canvas');
      c.width = Math.round(w * k); c.height = Math.round(h * k);
      c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
      c.toBlob(b => (b ? resolve(b) : reject(new Error('Не удалось обработать фото'))), 'image/jpeg', q);
    };
    if (source instanceof HTMLVideoElement) return draw(source);
    const img = new Image();
    img.onload = () => { draw(img); URL.revokeObjectURL(img.src); };
    img.onerror = () => reject(new Error('Это не похоже на фото'));
    img.src = URL.createObjectURL(source);
  });
}
async function uploadPhoto(blob) {
  const path = `${S.user.id}/${Date.now()}-${Math.random().toString(36).slice(2, 8)}.jpg`;
  const { error } = await sb.storage.from('photos').upload(path, blob, { contentType: 'image/jpeg' });
  if (error) throw error;
  // Облачный Supabase: храним полный адрес фото
  return sb.storage.from('photos').getPublicUrl(path).data.publicUrl;
}

/* ---------- Вход ---------- */
let authMode = 'login';
function showAuth() {
  $('#app').hidden = true; $('#auth').hidden = false;
  $('#serverHint').textContent = 'Сервер: ' + CFG.SUPABASE_URL;
}
document.querySelectorAll('.switch button').forEach(b => b.onclick = () => {
  authMode = b.dataset.mode;
  document.querySelectorAll('.switch button').forEach(x => x.setAttribute('aria-pressed', x === b));
  $('#nameField').hidden = authMode !== 'signup';
  $('#authTitle').textContent = authMode === 'signup' ? 'Регистрация' : 'Вход';
  $('#authBtn').textContent = authMode === 'signup' ? 'Создать аккаунт' : 'Войти';
  $('#authForm [name=password]').autocomplete = authMode === 'signup' ? 'new-password' : 'current-password';
  $('#authErr').textContent = '';
});
$('#authForm').onsubmit = async e => {
  e.preventDefault();
  const f = new FormData(e.target);
  const email = String(f.get('email')).trim(), password = String(f.get('password')), name = String(f.get('name') || '').trim();
  const err = $('#authErr'); err.textContent = '';
  if (!/^\S+@\S+\.\S+$/.test(email)) return (err.textContent = 'Введите почту');
  if (password.length < 6) return (err.textContent = 'Пароль — минимум 6 символов');
  if (authMode === 'signup' && !name) return (err.textContent = 'Введите имя');
  const btn = $('#authBtn'); btn.disabled = true;
  try {
    const r = authMode === 'signup'
      ? await sb.auth.signUp({ email, password, options: { data: { name } } })
      : await sb.auth.signInWithPassword({ email, password });
    if (r.error) throw r.error;
    if (!r.data.session) err.textContent = 'Аккаунт создан. Подтвердите почту и войдите.';
  } catch (ex) { err.textContent = errText(ex); }
  btn.disabled = false;
};

/* ---------- Загрузка данных ---------- */
async function loadAll() {
  const uid = S.user.id;
  const [meR, reqR] = await Promise.all([
    sb.from('profiles').select('*').eq('id', uid).single(),
    sb.from('friend_requests').select('*'),
  ]);
  if (meR.error) throw meR.error;
  if (reqR.error) throw reqR.error;
  S.me = meR.data;
  const reqs = reqR.data;
  const other = r => (r.from_id === uid ? r.to_id : r.from_id);
  const friendIds = reqs.filter(r => r.status === 'accepted').map(other);
  S.incoming = reqs.filter(r => r.status === 'pending' && r.to_id === uid);
  S.outgoing = reqs.filter(r => r.status === 'pending' && r.from_id === uid);
  const [pR, pmR] = await Promise.all([
    sb.from('plans').select('*').order('starts_at'),
    sb.from('plan_members').select('*'),
  ]);
  S.plans = pR.error ? [] : pR.data;
  S.planMembers = pmR.error ? [] : pmR.data;
  const ids = [...new Set([uid, ...reqs.map(other), ...S.plans.map(p => p.author_id), ...S.planMembers.map(m => m.user_id)])];

  const [prR, plR] = await Promise.all([
    sb.from('profiles').select('*').in('id', ids),
    sb.from('places').select('*').order('created_at', { ascending: false }),
  ]);
  if (prR.error) throw prR.error;
  if (plR.error) throw plR.error;
  S.profiles = new Map(prR.data.map(p => [p.id, p]));
  S.friends = friendIds.map(prof).filter(Boolean);
  S.places = plR.data;

  const pids = S.places.map(p => p.id);
  if (pids.length) {
    const [rR, vR] = await Promise.all([
      sb.from('reactions').select('*').in('place_id', pids),
      sb.from('visits').select('*').in('place_id', pids).order('created_at', { ascending: false }),
    ]);
    S.reactions = rR.data || []; S.visits = vR.data || [];
  } else { S.reactions = []; S.visits = []; }
}

async function refresh(quiet = true) {
  try { await loadAll(); renderAll(); }
  catch (e) { if (!quiet) toast(errText(e)); console.error(e); }
}

/* ---------- Карта ---------- */
let map, layer, newMarker;
function initMap() {
  map = L.map('map', { zoomControl: true, attributionControl: true }).setView([55.7558, 37.6173], 11);
  L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
    maxZoom: 19, attribution: '© <a href="https://www.openstreetmap.org/copyright" target="_blank">OpenStreetMap</a>',
  }).addTo(map);
  map.zoomControl.setPosition('bottomleft');
  layer = L.layerGroup().addTo(map);
  map.on('click', e => { if (S.adding) openAddForm(e.latlng); });
  // Центрируем на пользователе, если разрешит
  navigator.geolocation?.getCurrentPosition(p => map.setView([p.coords.latitude, p.coords.longitude], 13), () => {}, { timeout: 5000 });
}
function pinIcon(p) {
  const c = CATS[p.category] || CATS.other;
  const mine = p.author_id === S.user.id;
  const done = !mine && visitOf(p.id, S.user.id);
  const cls = mine ? 'mine' : done ? 'done' : 'task';
  const flag = mine ? '' : done ? '<span class="flag">✓</span>' : `<span class="flag">+${PTS.visit}</span>`;
  return L.divIcon({
    className: '', iconSize: [38, 46], iconAnchor: [19, 44],
    html: `<div class="pin ${cls}"><span class="b" style="background:${c.c}"></span><span class="e">${c.e}</span>${flag}</div>`,
  });
}
function renderMap() {
  layer.clearLayers();
  for (const p of filteredPlaces()) {
    L.marker([p.lat, p.lng], { icon: pinIcon(p), title: p.title })
      .on('click', () => openPlace(p.id)).addTo(layer);
  }
}
function filteredPlaces() {
  const f = S.filter;
  return S.places.filter(p =>
    f === 'all' ? true : f === 'tasks' ? isTask(p) : f === 'mine' ? p.author_id === S.user.id : p.category === f);
}
function renderFilters() {
  const opts = [['all', 'Все'], ['tasks', 'Задания'], ['mine', 'Мои'], ...Object.entries(CATS).filter(([k]) => S.places.some(p => p.category === k)).map(([k, c]) => [k, c.e + ' ' + c.n])];
  $('#filters').innerHTML = opts.map(([k, n]) => `<button class="chip" data-f="${k}" aria-pressed="${S.filter === k}">${esc(n)}</button>`).join('');
  $('#filters').querySelectorAll('.chip').forEach(b => b.onclick = () => { S.filter = b.dataset.f; renderFilters(); renderMap(); });
}

/* Добавление места */
function startAdding() {
  S.adding = true; $('#addbar').hidden = false; $('#fab').hidden = true;
  $('#map').classList.add('adding');
}
function stopAdding() {
  S.adding = false; $('#addbar').hidden = true; $('#fab').hidden = false;
  $('#map').classList.remove('adding');
  if (newMarker) { newMarker.remove(); newMarker = null; }
}
$('#fab').onclick = startAdding;
$('#addCancel').onclick = stopAdding;
$('#addHere').onclick = () => {
  if (!navigator.geolocation) return toast('Геолокация недоступна в этом браузере');
  toast('Определяю, где вы…');
  navigator.geolocation.getCurrentPosition(
    p => openAddForm(L.latLng(p.coords.latitude, p.coords.longitude)),
    () => toast('Не удалось определить место — нажмите на карту'),
    { enableHighAccuracy: true, timeout: 10000 });
};

function openAddForm(latlng) {
  if (newMarker) newMarker.remove();
  newMarker = L.marker(latlng, { icon: L.divIcon({ className: '', iconSize: [38, 46], iconAnchor: [19, 44], html: '<div class="pin newpin"><span class="b"></span><span class="e">✨</span></div>' }) }).addTo(map);
  map.panTo(latlng);
  let cat = 'food', file = null;
  const m = modal(`
    <div class="mb">
      <h2>Новое место</h2>
      <form class="form" id="pf" novalidate>
        <label class="field"><span>Название</span><input type="text" name="title" maxlength="80" placeholder="Например: Кофейня с видом на реку" required></label>
        <div class="field"><span>Что это</span><div class="seg" id="cats">${Object.entries(CATS).map(([k, c]) => `<button type="button" class="chip" data-c="${k}" aria-pressed="${k === cat}">${c.e} ${c.n}</button>`).join('')}</div></div>
        <label class="field"><span>Заметка для друзей</span><textarea name="note" maxlength="1000" placeholder="Что тут крутого, что заказать, когда лучше идти"></textarea></label>
        <label class="field"><span>Ссылка <em class="hint">(необязательно — пост, видео, Яндекс Карты)</em></span><input type="text" name="link" maxlength="500" placeholder="https://"></label>
        <label class="drop" id="drop"><input type="file" accept="image/*" id="pfile"><span class="thumb" id="pprev">📷</span><span class="dt"><b>Добавить фото</b>Необязательно, но с фото место заметнее</span></label>
        <div class="coords">📍 ${latlng.lat.toFixed(5)}, ${latlng.lng.toFixed(5)}</div>
        <div class="err" id="perr"></div>
        <button class="cta" type="submit" id="psave">Сохранить место (+${PTS.place})</button>
      </form>
    </div>`, () => { if (S.adding) stopAdding(); });
  m.querySelectorAll('#cats .chip').forEach(b => b.onclick = () => { cat = b.dataset.c; m.querySelectorAll('#cats .chip').forEach(x => x.setAttribute('aria-pressed', x === b)); });
  m.querySelector('#pfile').onchange = e => {
    file = e.target.files[0] || null;
    if (file) m.querySelector('#pprev').outerHTML = `<img id="pprev" src="${URL.createObjectURL(file)}" alt="">`;
  };
  m.querySelector('[name=title]').focus();
  m.querySelector('#pf').onsubmit = async e => {
    e.preventDefault();
    const f = new FormData(e.target);
    const title = String(f.get('title')).trim();
    let link = String(f.get('link')).trim();
    const errEl = m.querySelector('#perr');
    if (!title) return (errEl.textContent = 'Напишите название');
    if (link && !/^https?:\/\//i.test(link)) link = 'https://' + link;
    const btn = m.querySelector('#psave'); btn.disabled = true; btn.textContent = 'Сохраняю…';
    try {
      const photo_url = file ? await uploadPhoto(await compress(file)) : null;
      const { error } = await sb.from('places').insert({
        title, note: String(f.get('note')).trim() || null, link: link || null,
        category: cat, lat: latlng.lat, lng: latlng.lng, photo_url,
      });
      if (error) throw error;
      closeModal(); stopAdding();
      toast(`Место добавлено · +${PTS.place} баллов. Друзья увидят его как задание`);
      await refresh(false);
    } catch (ex) { errEl.textContent = errText(ex); btn.disabled = false; btn.textContent = 'Сохранить место'; }
  };
}

/* ---------- Окна ---------- */
function modal(html, onClose) {
  closeModal();
  const o = document.createElement('div');
  o.className = 'overlay';
  o.innerHTML = `<div class="modal" role="dialog" aria-modal="true"><button class="close" aria-label="Закрыть">×</button>${html}</div>`;
  o.onclick = e => { if (e.target === o) closeModal(); };
  o.querySelector('.close').onclick = closeModal;
  o._onClose = onClose;
  $('#modalRoot').appendChild(o);
  return o.querySelector('.modal');
}
function closeModal() {
  const o = $('#modalRoot .overlay');
  if (!o) return;
  stopCamera();
  o.remove();
  o._onClose?.();
}
document.addEventListener('keydown', e => { if (e.key === 'Escape') { if ($('.lightbox')) $('.lightbox').remove(); else closeModal(); } });
function lightbox(src) {
  const d = document.createElement('div'); d.className = 'lightbox';
  d.innerHTML = `<img src="${esc(src)}" alt="">`; d.onclick = () => d.remove();
  document.body.appendChild(d);
}

/* Карточка места */
function openPlace(id) {
  const p = S.places.find(x => x.id === id);
  if (!p) return;
  const c = CATS[p.category] || CATS.other;
  const mine = p.author_id === S.user.id;
  const myVisit = visitOf(p.id, S.user.id);
  const visits = S.visits.filter(v => v.place_id === p.id).slice().reverse();
  const reacts = EMOJIS.map(e => {
    const list = S.reactions.filter(r => r.place_id === p.id && r.emoji === e);
    const on = list.some(r => r.user_id === S.user.id);
    return `<button class="re" data-e="${e}" aria-pressed="${on}" title="${esc(list.map(r => nameOf(r.user_id)).join(', '))}">${e}${list.length ? `<b>${list.length}</b>` : ''}</button>`;
  }).join('');
  let action;
  if (mine) action = `<div class="state info">Это ваше место. Друзья получат задание: прийти и сфотографировать (+${PTS.visit} им, +${PTS.visited} вам).</div>
    <button class="cta danger" id="delPlace">Удалить место</button>`;
  else if (myVisit) action = `<div class="state ok">✓ Задание выполнено ${ago(myVisit.created_at)}</div>`;
  else action = `<button class="cta" id="doTask">📷 Выполнить задание · +${PTS.visit}</button>
    <p class="hint">Придите на место и сфотографируйте его прямо с сайта — фото из галереи не принимаются.</p>`;

  const m = modal(`
    ${p.photo_url ? `<div class="herowrap"><img class="hero" src="${esc(p.photo_url)}" alt="" id="hero"></div>` : ''}
    <div class="mb">
      <div class="row"><span class="cat" style="background:${c.c}">${c.e} ${c.n}</span></div>
      <h2>${esc(p.title)}</h2>
      <div class="by">${avatar(prof(p.author_id), 'sm')}<span><b>${esc(nameOf(p.author_id))}</b> · ${ago(p.created_at)}</span></div>
      ${p.note ? `<p class="note">${esc(p.note)}</p>` : ''}
      ${p.link ? `<a class="link" href="${esc(p.link)}" target="_blank" rel="noopener noreferrer">🔗 ${esc(p.link.replace(/^https?:\/\//, '').slice(0, 60))}</a>` : ''}
      <div class="reacts">${reacts}</div>
      ${action}
      <div class="sec">Здесь побывали · ${visits.length}</div>
      ${visits.length ? `<div class="visits">${visits.map(v => `<div class="vis"><img src="${esc(v.photo_url)}" alt="" data-src="${esc(v.photo_url)}"><div class="vi">${avatar(prof(v.user_id), 'sm')}<b>${esc(nameOf(v.user_id))}</b><span>${ago(v.created_at)}</span></div></div>`).join('')}</div>`
        : `<p class="intro">Пока никто. ${mine ? 'Позовите друзей!' : 'Будьте первым!'}</p>`}
    </div>`);
  m.querySelector('#hero')?.addEventListener('click', () => lightbox(p.photo_url));
  m.querySelectorAll('.vis img').forEach(i => i.onclick = () => lightbox(i.dataset.src));
  m.querySelectorAll('.re').forEach(b => b.onclick = async () => {
    const on = b.getAttribute('aria-pressed') === 'true';
    b.disabled = true;
    const r = on
      ? await sb.from('reactions').delete().match({ place_id: p.id, user_id: S.user.id, emoji: b.dataset.e })
      : await sb.from('reactions').insert({ place_id: p.id, emoji: b.dataset.e });
    if (r.error) toast(errText(r.error));
    await refresh(); openPlace(p.id);
  });
  m.querySelector('#doTask')?.addEventListener('click', () => openCamera(p));
  m.querySelector('#delPlace')?.addEventListener('click', async () => {
    if (!confirm('Удалить место «' + p.title + '»? Это нельзя отменить.')) return;
    const { error } = await sb.from('places').delete().eq('id', p.id);
    if (error) return toast(errText(error));
    closeModal(); toast('Место удалено'); refresh();
  });
}

/* Камера для задания: снимок только «вживую» */
let camStream = null;
function stopCamera() { camStream?.getTracks().forEach(t => t.stop()); camStream = null; }
async function openCamera(p) {
  const canLive = !!navigator.mediaDevices?.getUserMedia && window.isSecureContext;
  const m = modal(`
    <div class="mb">
      <h2>Задание: ${esc(p.title)}</h2>
      <p class="intro">Сфотографируйте место прямо сейчас. Фото увидят друзья.</p>
      <div class="cam" id="cam">${canLive ? '<video id="vid" autoplay playsinline muted></video>' : '<span class="thumb" style="background:none;font-size:40px">📷</span>'}</div>
      <div class="err" id="cerr"></div>
      <div class="camrow" id="camrow">
        ${canLive ? '<button class="cta" id="shot">Сделать снимок</button>'
          : '<label class="cta" style="cursor:pointer">Открыть камеру<input type="file" accept="image/*" capture="environment" id="capin" hidden></label>'}
      </div>
    </div>`, () => openPlace(p.id));
  let blob = null;
  const cam = m.querySelector('#cam'), row = m.querySelector('#camrow'), cerr = m.querySelector('#cerr');
  const showPreview = b => {
    blob = b;
    cam.innerHTML = `<img src="${URL.createObjectURL(b)}" alt="">`;
    row.innerHTML = `<button class="cta ghost" id="again">Переснять</button><button class="cta" id="send">Отправить · +${PTS.visit}</button>`;
    row.querySelector('#again').onclick = () => { stopCamera(); openCamera(p); };
    row.querySelector('#send').onclick = send;
  };
  async function send() {
    const btn = row.querySelector('#send'); btn.disabled = true; btn.textContent = 'Отправляю…';
    try {
      const photo_url = await uploadPhoto(blob);
      const { error } = await sb.from('visits').insert({ place_id: p.id, photo_url });
      if (error) throw error;
      stopCamera();
      $('#modalRoot .overlay')._onClose = null; closeModal();
      toast(`Задание выполнено! +${PTS.visit} баллов 🎉`, 3500);
      await refresh(false); openPlace(p.id);
    } catch (ex) { cerr.textContent = errText(ex); btn.disabled = false; btn.textContent = 'Отправить'; }
  }
  if (canLive) {
    try {
      camStream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: 'environment' }, width: { ideal: 1920 } }, audio: false });
      const v = m.querySelector('#vid'); v.srcObject = camStream;
      m.querySelector('#shot').onclick = async () => {
        if (!v.videoWidth) return;
        const b = await compress(v); stopCamera(); showPreview(b);
      };
    } catch (ex) {
      cerr.textContent = ex?.name === 'NotAllowedError' ? 'Разрешите доступ к камере в настройках браузера.' : 'Камера недоступна: ' + (ex?.message || ex);
    }
  } else {
    m.querySelector('#capin').onchange = async e => {
      const f = e.target.files[0]; if (!f) return;
      // Защита от старых фото: снимок должен быть сделан только что
      if (Date.now() - f.lastModified > 5 * 60 * 1000) return (cerr.textContent = 'Нужно свежее фото, сделанное прямо сейчас, а не из галереи.');
      showPreview(await compress(f));
    };
  }
}

/* Профиль */
function openProfile() {
  const me = S.me;
  let av = me.avatar || '', color = me.color;
  const myPlaces = S.places.filter(p => p.author_id === S.user.id).length;
  const myVisits = S.visits.filter(v => v.user_id === S.user.id).length;
  const m = modal(`
    <div class="mb">
      <div class="prof">${avatar(me, 'lg')}<div><h2>${esc(me.name)}</h2><div class="hint">Код для друзей: <b>${esc(me.code)}</b></div></div></div>
      <div class="stats">
        <div class="stat"><b>${me.points}</b><span>баллов</span></div>
        <div class="stat"><b>${myPlaces}</b><span>мест добавлено</span></div>
        <div class="stat"><b>${myVisits}</b><span>заданий</span></div>
      </div>
      <form class="form" id="prf">
        <label class="field"><span>Имя</span><input type="text" name="name" maxlength="40" value="${esc(me.name)}"></label>
        <div class="field"><span>Аватар</span><div class="emogrid">
          <button type="button" class="emo-o" data-a="" aria-pressed="${!av}">${esc(me.name[0]?.toUpperCase() || 'A')}</button>
          ${AVATARS.map(a => `<button type="button" class="emo-o" data-a="${a}" aria-pressed="${a === av}">${a}</button>`).join('')}
        </div></div>
        <div class="field"><span>Цвет</span><div class="swatches">${COLORS.map(c => `<button type="button" class="sw" data-c="${c}" style="background:${c}" aria-pressed="${c === color}" aria-label="${c}"></button>`).join('')}</div></div>
        <div class="err" id="prerr"></div>
        <button class="cta" type="submit">Сохранить</button>
      </form>
      <button class="cta ghost" id="logout">Выйти из аккаунта</button>
    </div>`);
  m.querySelectorAll('.emo-o').forEach(b => b.onclick = () => { av = b.dataset.a; m.querySelectorAll('.emo-o').forEach(x => x.setAttribute('aria-pressed', x === b)); });
  m.querySelectorAll('.sw').forEach(b => b.onclick = () => { color = b.dataset.c; m.querySelectorAll('.sw').forEach(x => x.setAttribute('aria-pressed', x === b)); });
  m.querySelector('#prf').onsubmit = async e => {
    e.preventDefault();
    const name = String(new FormData(e.target).get('name')).trim();
    if (!name) return (m.querySelector('#prerr').textContent = 'Имя не может быть пустым');
    const { error } = await sb.from('profiles').update({ name, avatar: av || null, color }).eq('id', S.user.id);
    if (error) return (m.querySelector('#prerr').textContent = errText(error));
    closeModal(); toast('Профиль сохранён'); refresh();
  };
  m.querySelector('#logout').onclick = async () => { closeModal(); await sb.auth.signOut(); };
}
$('#scoreBtn').onclick = openProfile;

/* ---------- Панель ---------- */
document.querySelectorAll('.tab').forEach(t => t.onclick = () => {
  S.tab = t.dataset.tab;
  document.querySelectorAll('.tab').forEach(x => x.setAttribute('aria-selected', x === t));
  renderPanel();
});

function renderHeader() {
  $('#meAv').outerHTML = avatar(S.me).replace('class="av', 'id="meAv" class="av');
  $('#mePts').textContent = S.me.points;
  const tasks = S.places.filter(isTask).length;
  $('#cTasks').hidden = !tasks; $('#cTasks').textContent = tasks;
  $('#cReq').hidden = !S.incoming.length; $('#cReq').textContent = S.incoming.length;
  const wi = typeof walkInvitesCount === 'function' ? walkInvitesCount() : 0;
  $('#cWalks').hidden = !wi; $('#cWalks').textContent = wi;
}

function placeItem(p) {
  const c = CATS[p.category] || CATS.other;
  const done = visitOf(p.id, S.user.id);
  const n = S.visits.filter(v => v.place_id === p.id).length;
  return `<button class="item" data-id="${p.id}">
    ${p.photo_url ? `<img class="thumb" src="${esc(p.photo_url)}" alt="" loading="lazy">` : `<span class="thumb">${c.e}</span>`}
    <div><div class="t">${esc(p.title)}</div>
      <div class="s">${avatar(prof(p.author_id), 'sm')} ${esc(nameOf(p.author_id))} · ${c.n}${n ? ` · был${n > 1 ? 'и' : ''} ${n}` : ''}</div></div>
    ${p.author_id === S.user.id ? '' : done ? '<span class="rew done">✓</span>' : `<span class="rew">+${PTS.visit}</span>`}
  </button>`;
}
function bindItems(root) {
  root.querySelectorAll('[data-id]').forEach(b => b.onclick = () => {
    const p = S.places.find(x => x.id === Number(b.dataset.id));
    if (p) { map.setView([p.lat, p.lng], Math.max(map.getZoom(), 15)); openPlace(p.id); }
  });
}

function renderPanel() {
  const body = $('#pbody');
  if (S.tab === 'tasks') {
    const tasks = S.places.filter(isTask);
    const done = S.places.filter(p => p.author_id !== S.user.id && visitOf(p.id, S.user.id));
    const mine = S.places.filter(p => p.author_id === S.user.id);
    body.innerHTML = !S.friends.length && !mine.length
      ? `<div class="empty"><b>Карта пока пустая</b>Добавьте первое место кнопкой «Добавить место» и позовите друзей во вкладке «Друзья» — их места станут вашими заданиями.</div>`
      : `<p class="intro">Места друзей, где вы ещё не были. Придите, сфотографируйте — получите <b>+${PTS.visit}</b>.</p>
        ${tasks.length ? tasks.map(placeItem).join('') : '<div class="empty">Все задания выполнены 🎉</div>'}
        ${done.length ? `<div class="sec">Выполнено · ${done.length}</div>${done.map(placeItem).join('')}` : ''}
        ${mine.length ? `<div class="sec">Мои места · ${mine.length}</div>${mine.map(placeItem).join('')}` : ''}`;
    bindItems(body);
  }
  if (S.tab === 'feed') {
    const ev = [
      ...S.places.map(p => ({ t: p.created_at, who: p.author_id, place: p, kind: 'place' })),
      ...S.visits.map(v => ({ t: v.created_at, who: v.user_id, place: S.places.find(p => p.id === v.place_id), kind: 'visit', photo: v.photo_url })),
    ].filter(e => e.place).sort((a, b) => new Date(b.t) - new Date(a.t)).slice(0, 60);
    body.innerHTML = ev.length ? ev.map(e => `
      <button class="ev" data-id="${e.place.id}">
        ${avatar(prof(e.who), 'sm')}
        <div><div class="txt"><b>${esc(nameOf(e.who))}</b> · ${e.kind === 'place'
          ? `новое место «${esc(e.place.title)}»`
          : `выполнено задание «${esc(e.place.title)}» <span class="plus">+${PTS.visit}</span>`}</div>
          <div class="when">${ago(e.t)}</div></div>
        ${(e.kind === 'visit' ? e.photo : e.place.photo_url) ? `<img src="${esc(e.kind === 'visit' ? e.photo : e.place.photo_url)}" alt="" loading="lazy">` : '<span></span>'}
      </button>`).join('') : '<div class="empty"><b>Здесь будет лента</b>Новые места и выполненные задания ваши и друзей.</div>';
    bindItems(body);
  }
  if (S.tab === 'friends') renderFriends(body);
  if (S.tab === 'walks' && typeof renderWalks === 'function') renderWalks(body);
  if (S.tab === 'rating') {
    const list = [S.me, ...S.friends].sort((a, b) => b.points - a.points);
    const max = Math.max(1, ...list.map(p => p.points));
    const pos = list.findIndex(p => p.id === S.user.id) + 1;
    const above = list[pos - 2];
    body.innerHTML = `
      <div class="rkme"><div><div class="k">Ваше место</div><div class="v">${pos}<small> из ${list.length}</small></div></div>
        <div class="hint">${above ? `До «${esc(above.name)}» — ${above.points - S.me.points + 1} балл.` : list.length > 1 ? 'Вы лидер среди друзей! 🏆' : 'Добавьте друзей, чтобы соревноваться.'}</div></div>
      ${list.map((p, i) => `<div class="rk ${p.id === S.user.id ? 'me' : ''}">
        <span class="pos ${i < 3 ? 'm' + (i + 1) : ''}">${i + 1}</span>${avatar(p)}
        <div><div class="nm">${esc(p.id === S.user.id ? p.name + ' (вы)' : p.name)}</div><div class="bar"><i style="width:${(p.points / max) * 100}%;background:${esc(p.color)}"></i></div></div>
        <span class="pts">${p.points}</span></div>`).join('')}
      <div class="sec">Как получить баллы</div>
      <div class="rules">
        <div>Выполнить задание друга (фото на месте)</div><div class="p">+${PTS.visit}</div>
        <div>Добавить место на карту</div><div class="p">+${PTS.place}</div>
        <div>Друг побывал в вашем месте</div><div class="p">+${PTS.visited}</div>
      </div>`;
  }
}

function renderFriends(body) {
  const invite = `${location.origin}${location.pathname}?invite=${S.me.code}`;
  body.innerHTML = `
    <div class="myid"><div><div class="k">Ваш код</div><div class="v">${esc(S.me.code)}</div></div>
      <button class="sbtn ghost sm" id="copyInv">Скопировать ссылку</button></div>
    <form class="addrow" id="addf"><input class="input" name="code" maxlength="6" placeholder="Код друга" autocomplete="off"><button class="sbtn" type="submit">Добавить</button></form>
    <div class="err" id="ferr"></div>
    ${S.incoming.length ? `<div class="sec">Заявки · ${S.incoming.length}</div>` + S.incoming.map(r => `
      <div class="fr in">${avatar(prof(r.from_id))}<div><div class="nm">${esc(prof(r.from_id)?.name)}</div><div class="sub">хочет дружить</div></div>
      <div class="acts"><button class="sbtn ok sm" data-acc="${r.id}">Принять</button><button class="sbtn ghost sm" data-dec="${r.id}">✕</button></div></div>`).join('') : ''}
    <div class="sec">Друзья · ${S.friends.length}</div>
    ${S.friends.length ? S.friends.map(f => `
      <div class="fr">${avatar(f)}<div><div class="nm">${esc(f.name)}</div><div class="sub">${f.points} баллов · мест: ${S.places.filter(p => p.author_id === f.id).length}</div></div>
      <div class="acts"><button class="sbtn ghost sm" data-rm="${f.id}" title="Удалить из друзей">✕</button></div></div>`).join('')
      : '<div class="empty">Пока никого. Отправьте другу свой код или ссылку.</div>'}
    ${S.outgoing.length ? `<div class="sec">Ждут ответа</div>` + S.outgoing.map(r => `
      <div class="fr">${avatar(prof(r.to_id))}<div><div class="nm">${esc(prof(r.to_id)?.name)}</div><div class="sub">заявка отправлена</div></div>
      <div class="acts"><button class="sbtn ghost sm" data-dec="${r.id}">Отменить</button></div></div>`).join('') : ''}`;
  body.querySelector('#copyInv').onclick = async () => {
    try { await navigator.clipboard.writeText(invite); toast('Ссылка скопирована'); }
    catch { prompt('Скопируйте ссылку:', invite); }
  };
  body.querySelector('#addf').onsubmit = async e => {
    e.preventDefault();
    const code = String(new FormData(e.target).get('code')).trim().toUpperCase();
    if (code.length !== 6) return (body.querySelector('#ferr').textContent = 'Код — 6 символов');
    await addFriend(code, body.querySelector('#ferr'));
  };
  body.querySelectorAll('[data-acc]').forEach(b => b.onclick = () => respond(b.dataset.acc, true));
  body.querySelectorAll('[data-dec]').forEach(b => b.onclick = () => respond(b.dataset.dec, false));
  body.querySelectorAll('[data-rm]').forEach(b => b.onclick = async () => {
    if (!confirm('Удалить из друзей? Вы перестанете видеть места друг друга.')) return;
    const { error } = await sb.rpc('remove_friend', { p_friend: b.dataset.rm });
    if (error) return toast(errText(error));
    refresh();
  });
}
async function addFriend(code, errEl) {
  const { data, error } = await sb.rpc('send_friend_request', { p_code: code });
  if (error) { const t = errText(error); errEl ? (errEl.textContent = t) : toast(t); return; }
  toast(data === 'accepted' ? 'Теперь вы друзья! Их места появились на карте' : data === 'already' ? 'Вы уже друзья' : 'Заявка отправлена');
  refresh();
}
async function respond(id, accept) {
  const { error } = await sb.rpc('respond_friend_request', { p_id: Number(id), p_accept: accept });
  if (error) return toast(errText(error));
  if (accept) toast('Теперь вы друзья!');
  refresh();
}

function renderAll() { renderHeader(); renderFilters(); renderMap(); renderPanel(); if (typeof drawRoute === 'function' && S.routePlan) drawRoute(); }

/* ---------- Старт ---------- */
let started = false, timer = null;
async function start(session) {
  S.user = session.user;
  $('#auth').hidden = true; $('#app').hidden = false;
  if (!started) { initMap(); started = true; }
  setTimeout(() => map.invalidateSize(), 50);
  try { await loadAll(); renderAll(); }
  catch (e) { toast(errText(e), 5000); console.error(e); return; }
  // Приглашение по ссылке ?invite=КОД
  const inv = new URLSearchParams(location.search).get('invite');
  if (inv && inv.toUpperCase() !== S.me.code) {
    history.replaceState(null, '', location.pathname);
    addFriend(inv.toUpperCase());
  }
  clearInterval(timer);
  timer = setInterval(() => { if (!document.hidden && !$('#modalRoot .overlay')) refresh(); }, 30000);
}

sb.auth.onAuthStateChange((event, session) => {
  if (session?.user && (event === 'SIGNED_IN' || event === 'INITIAL_SESSION')) {
    if (S.user?.id !== session.user.id) setTimeout(() => start(session), 0); // вне колбэка, чтобы не блокировать auth
  } else if (!session) {
    S.user = null; clearInterval(timer); showAuth();
  }
});
