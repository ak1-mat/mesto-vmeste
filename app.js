/* «Место вместе» — карта OpenStreetMap (Leaflet) + облачный Supabase. */
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
const COLORS = ['#5B3DF5', '#15131F', '#E2553B', '#18915A', '#8B74FF', '#169C86', '#D9367A', '#2B7BD6'];
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
function plural(n, one, few, many) {
  const a = Math.abs(n) % 100, b = a % 10;
  return a > 10 && a < 20 ? many : b > 1 && b < 5 ? few : b === 1 ? one : many;
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
  if (/Failed to fetch|NetworkError|Load failed/i.test(m)) return 'Нет связи с сервером. Проверьте интернет и попробуйте ещё раз.';
  if (/Invalid login credentials/i.test(m)) return 'Неверная почта или пароль';
  if (/already registered/i.test(m)) return 'Эта почта уже зарегистрирована — войдите';
  if (/Password should be/i.test(m)) return 'Пароль слишком короткий (минимум 6 символов)';
  if (/rate limit|too many/i.test(m)) return 'Слишком много попыток. Подождите минуту и попробуйте снова.';
  if (/Email not confirmed/i.test(m)) return 'Почта не подтверждена. Напишите организатору сайта.';
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
// Основной способ — код из письма. Пароль оставлен запасным.
// Вход по коду из почты временно выключен, пока не настроена отправка писем. Вернуть: true
const OTP_ON = false;
const OTP_LEN = 6;                 // длина кода в письме (Supabase → Auth → Email OTP Length)
let authMode = 'login', otpEmail = '', resendAt = 0, resendTimer = null;
function hideBoot() { $('#boot')?.remove(); }
function setAuthBox(box) {
  if (!OTP_ON) box = 'pass';
  $('#toOtp').hidden = !OTP_ON;
  $('#otpBox').hidden = box !== 'otp';
  $('#passBox').hidden = box !== 'pass';
  $('#authTitle').textContent = box === 'otp' ? 'Вход по почте' : authMode === 'signup' ? 'Регистрация' : OTP_ON ? 'Вход с паролем' : 'Вход';
  store.set('mv_auth_box', box);
  ['#otpErr', '#codeErr', '#authErr'].forEach(id => ($(id).textContent = ''));
}
function showAuth() {
  hideBoot();
  $('#app').hidden = true; $('#auth').hidden = false;
  setAuthBox(store.get('mv_auth_box') === 'pass' ? 'pass' : 'otp');
  // Ссылка из письма устарела или уже использована
  const h = new URLSearchParams(location.hash.slice(1));
  if (h.get('error')) {
    setAuthBox('otp');
    $('#otpErr').textContent = 'Ссылка из письма устарела или уже использована. Запросите новый код.';
    history.replaceState(null, '', location.pathname + location.search);
  }
  const inv = new URLSearchParams(location.search).get('invite');
  if (inv) store.set('mv_invite', inv.toUpperCase());   // переживёт переход по ссылке из письма
  if (inv || store.get('mv_invite')) {
    $('#serverHint').textContent = 'Вас пригласил друг. Войдите или зарегистрируйтесь — и вы сразу станете друзьями.';
  }
}
// Ссылки главной страницы: плавно листаем внутри экрана входа, адрес не меняем (в нём бывают данные входа из письма)
$('#auth').addEventListener('click', e => {
  const a = e.target.closest('a[href^="#"]'); if (!a) return;
  e.preventDefault();
  const t = a.getAttribute('href') === '#auth' ? $('#auth') : $(a.getAttribute('href'));
  if (a.hasAttribute('data-go-login')) {
    $('#acard').scrollIntoView({ behavior: 'smooth', block: 'center' });
    const inp = !$('#otpBox').hidden ? (!$('#otpEmailForm').hidden ? $('#otpEmail') : $('#otpCode')) : $('#nameField').hidden ? $('#authForm [name=email]') : $('#authForm [name=name]');
    setTimeout(() => inp?.focus({ preventScroll: true }), 350);
  } else if (t === $('#auth')) $('#auth').scrollTo({ top: 0, behavior: 'smooth' });
  else t?.scrollIntoView({ behavior: 'smooth', block: 'start' });
});
$('#toPass').onclick = () => { setAuthBox('pass'); const e = $('#otpEmail').value.trim(); if (e) $('#authForm [name=email]').value = e; };
$('#toOtp').onclick = () => { setAuthBox('otp'); const e = $('#authForm [name=email]').value.trim(); if (e) $('#otpEmail').value = e; };

function otpErrText(e) {
  const m = e?.message || String(e);
  if (/only request this after (\d+)/i.test(m)) return `Код уже отправлен. Новый можно запросить через ${m.match(/after (\d+)/i)[1]} с.`;
  if (/rate limit|too many/i.test(m)) return 'Писем было слишком много. Подождите немного или войдите с паролем.';
  if (/not authorized|sending (magic link|confirmation|.*email)|smtp/i.test(m)) return 'NOMAIL';
  if (/expired|invalid|token/i.test(m)) return 'Код не подошёл или устарел. Проверьте цифры или запросите новый.';
  if (/signups? not allowed/i.test(m)) return 'Регистрация сейчас закрыта. Напишите организатору сайта.';
  return errText(e);
}
function tickResend() {
  const left = Math.ceil((resendAt - Date.now()) / 1000), b = $('#otpResend');
  b.disabled = left > 0;
  b.textContent = left > 0 ? `Отправить ещё раз через ${left} с` : 'Отправить код ещё раз';
  if (left <= 0) clearInterval(resendTimer);
}
async function sendCode(email, btn, errEl) {
  errEl.textContent = '';
  const label = btn.textContent; btn.disabled = true; btn.textContent = 'Отправляю…';
  const { error } = await sb.auth.signInWithOtp({ email, options: { shouldCreateUser: true, emailRedirectTo: location.origin + location.pathname } });
  btn.disabled = false; btn.textContent = label;
  if (error) {
    const t = otpErrText(error);
    if (t === 'NOMAIL') {
      // Почта-отправитель ещё не настроена: письмо на этот адрес не уйдёт
      setAuthBox('pass'); $('#authForm [name=email]').value = email;
      $('#authErr').textContent = 'Код на эту почту пока не отправить. Войдите с паролем или зарегистрируйтесь — это работает как раньше.';
      return false;
    }
    errEl.textContent = t; return false;
  }
  otpEmail = email; resendAt = Date.now() + 60000;
  clearInterval(resendTimer); resendTimer = setInterval(tickResend, 1000); tickResend();
  return true;
}
$('#otpEmailForm').onsubmit = async e => {
  e.preventDefault();
  const email = $('#otpEmail').value.trim().toLowerCase();
  if (!/^\S+@\S+\.\S+$/.test(email)) return ($('#otpErr').textContent = 'Введите почту, например you@mail.ru');
  if (!(await sendCode(email, $('#otpSend'), $('#otpErr')))) return;
  $('#otpTo').textContent = email;
  $('#otpEmailForm').hidden = true; $('#otpCodeForm').hidden = false;
  $('#otpCode').value = ''; $('#otpCode').focus();
};
$('#otpBack').onclick = () => { $('#otpCodeForm').hidden = true; $('#otpEmailForm').hidden = false; $('#codeErr').textContent = ''; $('#otpEmail').focus(); };
$('#otpResend').onclick = async () => { if (await sendCode(otpEmail, $('#otpResend'), $('#codeErr'))) { toast('Новый код отправлен'); tickResend(); } };
$('#otpCode').oninput = e => {
  const v = e.target.value.replace(/\D/g, '').slice(0, 10);
  if (v !== e.target.value) e.target.value = v;
  $('#codeErr').textContent = '';
  if (v.length === OTP_LEN) $('#otpCodeForm').requestSubmit();
};
$('#otpCodeForm').onsubmit = async e => {
  e.preventDefault();
  const token = $('#otpCode').value.replace(/\D/g, ''), err = $('#codeErr'), btn = $('#codeBtn');
  if (token.length < 6) return (err.textContent = 'Введите код из письма целиком');
  btn.disabled = true; btn.textContent = 'Проверяю…';
  const { error } = await sb.auth.verifyOtp({ email: otpEmail, token, type: 'email' });
  btn.disabled = false; btn.textContent = 'Войти';
  if (error) { err.textContent = otpErrText(error); $('#otpCode').select(); }
  // при успехе сработает onAuthStateChange → start()
};

document.querySelectorAll('.switch button').forEach(b => b.onclick = () => {
  authMode = b.dataset.mode;
  document.querySelectorAll('.switch button').forEach(x => x.setAttribute('aria-pressed', x === b));
  $('#nameField').hidden = authMode !== 'signup';
  $('#authTitle').textContent = authMode === 'signup' ? 'Регистрация' : OTP_ON ? 'Вход с паролем' : 'Вход';
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
  const btn = $('#authBtn'); btn.disabled = true; const label = btn.textContent; btn.textContent = authMode === 'signup' ? 'Создаю аккаунт…' : 'Вхожу…';
  try {
    const r = authMode === 'signup'
      ? await sb.auth.signUp({ email, password, options: { data: { name } } })
      : await sb.auth.signInWithPassword({ email, password });
    if (r.error) throw r.error;
    if (!r.data.session) err.textContent = 'Аккаунт создан. Подтвердите почту и войдите.';
  } catch (ex) { err.textContent = errText(ex); }
  btn.disabled = false; btn.textContent = label;
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
}
/* Первый показ: охватить все места; если мест нет — центр на пользователе */
let fitted = false;
function fitOnce() {
  if (fitted) return; fitted = true;
  if (S.places.length) {
    const b = L.latLngBounds(S.places.map(p => [p.lat, p.lng]));
    map.fitBounds(b.pad(0.15), { maxZoom: 15, animate: false });
  } else {
    navigator.geolocation?.getCurrentPosition(p => map.setView([p.coords.latitude, p.coords.longitude], 13), () => {}, { timeout: 5000 });
  }
}
// Метки в стиле айдентики: капля 48×64. Место друга — фиолетовая с его буквой (это и есть задание, +20),
// уже выполнено — «ночь» с лаймовой галочкой, своё — белая с эмодзи категории.
const PIN_D = 'M24 0C10.7 0 0 10.7 0 24c0 16 24 40 24 40s24-24 24-40C48 10.7 37.3 0 24 0z';
const PIN_OK = '<svg class="pk" viewBox="0 0 24 24" aria-hidden="true"><path d="M6.5 12.5l3.5 3.5 7.5-8"/></svg>';
function pinHtml(cls, inner, flag = '') {
  return `<div class="pin ${cls}"><svg class="pg" viewBox="0 0 48 64" aria-hidden="true"><path d="${PIN_D}"/><circle cx="24" cy="23" r="15.5"/></svg><span class="e">${inner}</span>${flag}</div>`;
}
function pinIcon(p) {
  const c = CATS[p.category] || CATS.other;
  const mine = p.author_id === S.user.id;
  const done = !mine && visitOf(p.id, S.user.id);
  const who = esc(((prof(p.author_id)?.name || '?').trim()[0] || '?').toUpperCase());
  const html = mine ? pinHtml('mine', c.e)
    : done ? pinHtml('done', PIN_OK)
    : pinHtml('task', who, `<span class="flag">+${PTS.visit}</span>`);
  return L.divIcon({ className: '', iconSize: [40, 53], iconAnchor: [20, 52], html });
}
function renderMap() {
  layer.clearLayers();
  for (const p of filteredPlaces()) {
    L.marker([p.lat, p.lng], { icon: pinIcon(p), title: p.title, zIndexOffset: 800 })
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
  layersSummary();
}

/* ---------- Телефон: все фильтры карты в одной панели снизу ---------- */
function filterOpts() {
  return [['all', 'Все места'], ['tasks', 'Задания'], ['mine', 'Мои'], ...Object.entries(CATS).filter(([k]) => S.places.some(p => p.category === k)).map(([k, c]) => [k, c.e + ' ' + c.n])];
}
function layersSummary() {
  const el = $('#layersSum'); if (!el) return;
  const parts = [];
  if (S.filter !== 'all') parts.push(((filterOpts().find(o => o[0] === S.filter) || [, ''])[1]).replace(/^[^\p{L}]+/u, ''));
  if (typeof CUR !== 'undefined') {
    const all = Object.keys(CUR_CATS).length;
    parts.push(!CUR.on ? 'без подборки' : CUR.cats.size < all ? `подборка ${CUR.cats.size}/${all}` : '');
  }
  const t = parts.filter(Boolean).join(' · ');
  el.textContent = t; el.hidden = !t;
  $('#layersBtn').classList.toggle('on', !!t);
}
function openLayers() {
  const hasCur = typeof CUR !== 'undefined';
  const curCount = k => hasCur ? CUR.list.filter(p => p.cat === k).length : 0;
  const m = modal(`
    <div class="mb layers">
      <h2>Что показать на карте</h2>
      ${hasCur ? `<div class="sec">Подборка «${esc(curTitle())}»</div>
      <button type="button" class="lsw" id="lyCur" aria-pressed="${CUR.on}"><span><b>Показывать подборку</b><small>Где поесть, что посмотреть, где погулять и снять фото</small></span><span class="sw2" aria-hidden="true"></span></button>
      ${CUR.on ? `<div class="lgrid">${Object.entries(CUR_CATS).map(([k, c]) => `<button type="button" class="lopt lcat" data-c="${k}" aria-pressed="${CUR.cats.has(k)}" style="--c:${c.c}"><span class="dot"></span>${c.e} ${c.n}<small>${curCount(k)}</small></button>`).join('')}</div>
      <p class="hint">Можно выбрать несколько. Хотя бы одна категория остаётся включённой.</p>` : ''}` : ''}
      <div class="sec">Места друзей и ваши</div>
      <div class="lgrid">${filterOpts().map(([k, n]) => `<button type="button" class="lopt" data-f="${k}" aria-pressed="${S.filter === k}">${esc(n)}</button>`).join('')}</div>
      <button type="button" class="cta" id="lyDone">Показать на карте</button>
    </div>`);
  const again = () => { const top = $('.modal')?.scrollTop || 0; openLayers(); const md = $('.modal'); if (md) md.scrollTop = top; };
  m.querySelectorAll('[data-f]').forEach(b => b.onclick = () => { S.filter = b.dataset.f; renderFilters(); renderMap(); again(); });
  m.querySelector('#lyCur')?.addEventListener('click', () => { CUR.on = !CUR.on; store.set('mv_cur_on', CUR.on ? '1' : '0'); renderCuratedControl(); renderCuratedLayer(); layersSummary(); again(); });
  m.querySelectorAll('[data-c]').forEach(b => b.onclick = () => {
    const k = b.dataset.c;
    CUR.cats.has(k) ? CUR.cats.delete(k) : CUR.cats.add(k);
    if (!CUR.cats.size) CUR.cats.add(k);
    store.set('mv_cur_cats', [...CUR.cats].join(','));
    renderCuratedControl(); renderCuratedLayer(); layersSummary(); again();
  });
  m.querySelector('#lyDone').onclick = closeModal;
}
$('#layersBtn').onclick = openLayers;

/* Добавление места */
function startAdding() {
  if (isMobile() && S.tab !== 'map') setTab('map');
  closeModal();
  S.adding = true; $('#addbar').hidden = false; $('#fab').hidden = true; $('#locBtn').hidden = true;
  $('#map').classList.add('adding');
}
function stopAdding() {
  S.adding = false; $('#addbar').hidden = true; $('#fab').hidden = false; $('#locBtn').hidden = false;
  $('#map').classList.remove('adding');
  if (newMarker) { newMarker.remove(); newMarker = null; }
}
$('#fab').onclick = startAdding;
/* ---------- Геопозиция: синяя точка «я здесь», которая двигается вместе с вами ----------
   1-е нажатие — найти меня и следить (карта едет за точкой); сдвинули карту пальцем — слежение
   выключается, точка остаётся; ещё нажатие — снова к себе. Когда вкладка скрыта, GPS отключается. */
const GEO = { watch: null, follow: false, last: null, dot: null, ring: null, wanted: false, centered: false };
function geoBtn() {
  const b = $('#locBtn'); if (!b) return;
  b.classList.toggle('on', !!GEO.last); b.classList.toggle('follow', GEO.follow);
  b.title = b.ariaLabel = GEO.follow ? 'Карта следует за вами' : GEO.last ? 'Вернуться к себе' : 'Показать, где я';
}
function geoDraw(p) {
  const ll = [p.coords.latitude, p.coords.longitude], acc = Math.round(p.coords.accuracy || 0);
  GEO.last = { lat: ll[0], lng: ll[1], acc, t: Date.now() };
  $('#locBtn')?.classList.remove('busy');
  const r = Math.min(Math.max(acc, 5), 3000);
  if (!GEO.dot) {
    GEO.ring = L.circle(ll, { radius: r, color: '#5B3DF5', weight: 1, opacity: 0.35, fillColor: '#5B3DF5', fillOpacity: 0.1, interactive: false }).addTo(map);
    GEO.dot = L.marker(ll, { icon: L.divIcon({ className: '', iconSize: [22, 22], iconAnchor: [11, 11], html: '<div class="medot"></div>' }), interactive: false, zIndexOffset: 1000, title: '' }).addTo(map);
  } else { GEO.dot.setLatLng(ll); GEO.ring.setLatLng(ll); GEO.ring.setRadius(r); }
  if (GEO.follow) {
    if (!GEO.centered) { GEO.centered = true; map.setView(ll, Math.max(map.getZoom(), acc > 500 ? 14 : 16)); }
    else map.panTo(ll);
  }
  geoBtn();
}
function geoFail(err) {
  $('#locBtn')?.classList.remove('busy');
  if (GEO.last) return;   // точка уже есть — временный сбой GPS не показываем
  geoStop(); GEO.wanted = false; GEO.follow = false;
  toast(err && err.code === 1
    ? 'Сайту запрещён доступ к геопозиции. Разрешите его в настройках браузера (значок замка у адреса) и нажмите кнопку ещё раз'
    : 'Не получилось определить, где вы. Проверьте, что геолокация включена, и попробуйте ещё раз', 5000);
  geoBtn();
}
function geoStart() {
  if (GEO.watch != null || !navigator.geolocation) return;
  GEO.wanted = true;
  GEO.watch = navigator.geolocation.watchPosition(geoDraw, geoFail, { enableHighAccuracy: true, maximumAge: 5000, timeout: 20000 });
}
function geoStop() { if (GEO.watch != null) navigator.geolocation.clearWatch(GEO.watch); GEO.watch = null; }
$('#locBtn').onclick = () => {
  if (!navigator.geolocation) return toast('Этот браузер не умеет определять местоположение');
  GEO.follow = true;
  if (GEO.last) { GEO.centered = true; map.setView([GEO.last.lat, GEO.last.lng], Math.max(map.getZoom(), 15)); }
  else { GEO.centered = false; $('#locBtn').classList.add('busy'); }
  geoStart(); geoBtn();
};
// пользователь сам двигает карту — перестаём тянуть её к точке
['pointerdown', 'wheel'].forEach(t => $('#map').addEventListener(t, () => { if (GEO.follow) { GEO.follow = false; geoBtn(); } }, { passive: true }));
document.addEventListener('visibilitychange', () => {
  if (document.hidden) geoStop(); else if (GEO.wanted) geoStart();
});
// если доступ к геопозиции уже разрешён раньше — сразу показать точку (карту не двигаем)
function geoAuto() {
  try { navigator.permissions?.query({ name: 'geolocation' }).then(s => { if (s.state === 'granted') geoStart(); }).catch(() => {}); } catch (e) { /* старые браузеры */ }
}
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
  newMarker = L.marker(latlng, { icon: L.divIcon({ className: '', iconSize: [40, 53], iconAnchor: [20, 52], html: pinHtml('newpin', '+') }) }).addTo(map);
  map.panTo(latlng);
  let cat = 'food', file = null;
  const m = modal(`
    <div class="mb">
      <h2>Новое место</h2>
      <form class="form" id="pf" novalidate>
        <label class="field"><span>Название</span><input type="text" name="title" maxlength="80" placeholder="Например: кофейня с видом на реку" required></label>
        <div class="field"><span>Что это за место</span><div class="catgrid" id="cats">${Object.entries(CATS).map(([k, c]) => `<button type="button" class="chip" data-c="${k}" aria-pressed="${k === cat}">${c.e} ${c.n}</button>`).join('')}</div></div>
        <label class="field"><span>Чем оно крутое</span><textarea name="note" maxlength="1000" placeholder="Что заказать, когда лучше идти, где сесть"></textarea></label>
        <label class="drop" id="drop"><input type="file" accept="image/*" id="pfile"><span class="thumb" id="pprev">📷</span><span class="dt"><b>Добавить фото</b>Необязательно, но с фото место заметнее</span></label>
        <label class="field"><span>Ссылка <em class="hint">· необязательно: пост, видео или Яндекс Карты</em></span><input type="text" name="link" maxlength="500" inputmode="url" placeholder="https://"></label>
        <div class="coords">Точка на карте: ${latlng.lat.toFixed(5)}, ${latlng.lng.toFixed(5)} · <button type="button" class="linkbtn" id="moveP" style="padding:0">выбрать другую</button></div>
        <div class="err" id="perr"></div>
        <button class="cta" type="submit" id="psave">Сохранить место (+${PTS.place})</button>
      </form>
    </div>`, () => { if (S.adding) stopAdding(); });
  m.querySelectorAll('#cats .chip').forEach(b => b.onclick = () => { cat = b.dataset.c; m.querySelectorAll('#cats .chip').forEach(x => x.setAttribute('aria-pressed', x === b)); });
  m.querySelector('#pfile').onchange = e => {
    file = e.target.files[0] || null;
    if (file) m.querySelector('#pprev').outerHTML = `<img id="pprev" src="${URL.createObjectURL(file)}" alt="">`;
  };
  m.querySelector('#moveP').onclick = () => { const o = $('#modalRoot .overlay'); if (o) o._onClose = null; closeModal(); if (newMarker) { newMarker.remove(); newMarker = null; } if (!S.adding) startAdding(); toast('Нажмите на карту, где находится место'); };
  if (!isMobile()) m.querySelector('[name=title]').focus();
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
      toast(`Место добавлено, +${PTS.place} баллов. Друзья увидят его как задание`, 3500);
      await refresh(false);
    } catch (ex) { errEl.textContent = errText(ex); btn.disabled = false; btn.textContent = `Сохранить место (+${PTS.place})`; }
  };
}

/* ---------- Окна ---------- */
function modal(html, onClose) {
  const replacing = !!$('#modalRoot .overlay');   // перерисовка того же окна — без анимации
  closeModal();
  const o = document.createElement('div');
  o.className = 'overlay';
  o.innerHTML = `<div class="modal" role="dialog" aria-modal="true"><button class="close" aria-label="Закрыть">×</button>${html}</div>`;
  if (replacing) { o.style.animation = 'none'; o.firstElementChild.style.animation = 'none'; }
  o.onclick = e => { if (e.target === o) closeModal(); };
  o.querySelector('.close').onclick = closeModal;
  o._onClose = onClose;
  $('#modalRoot').appendChild(o);
  return o.querySelector('.modal');
}
/* Своё окно подтверждения вместо confirm(): встроенные браузеры (Telegram, VK) и «приложение на экране»
   часто молча отвечают «нет» на confirm(), и кнопка будто не работает */
function ask(text, okLabel = 'Удалить') {
  return new Promise(res => {
    const o = document.createElement('div');
    o.className = 'overlay askov';
    o.innerHTML = `<div class="modal askbox" role="alertdialog" aria-modal="true"><p></p><div class="askacts"><button class="sbtn ghost" data-no>Отмена</button><button class="sbtn danger" data-yes></button></div></div>`;
    o.querySelector('p').textContent = text; o.querySelector('[data-yes]').textContent = okLabel;
    const done = v => { document.removeEventListener('keydown', key, true); o.remove(); res(v); };
    const key = e => { if (e.key === 'Escape') { e.stopPropagation(); done(false); } };
    document.addEventListener('keydown', key, true);
    o.onclick = e => { if (e.target === o) done(false); };
    o.querySelector('[data-no]').onclick = () => done(false);
    o.querySelector('[data-yes]').onclick = () => done(true);
    document.body.appendChild(o);
    o.querySelector('[data-yes]').focus();
  });
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
    return `<button class="re" data-e="${e}" aria-pressed="${on}" title="${esc(list.map(r => nameOf(r.user_id)).join(', ') || 'Поставить реакцию')}">${e}${list.length ? `<b>${list.length}</b>` : ''}</button>`;
  }).join('');
  let action;
  if (mine) action = `<div class="state info">Это ваше место. Друзья видят его как задание: придут, сфотографируют и получат +${PTS.visit}, а вы +${PTS.visited}.</div>`;
  else if (myVisit) action = `<div class="state ok">✓ Задание выполнено ${ago(myVisit.created_at)}</div>`;
  else action = `<div class="taskbox">
      <div class="tt"><span>Задание: побывать здесь</span><span class="rew">+${PTS.visit}</span></div>
      <p class="hint">Придите на место и сфотографируйте его прямо с сайта. Фото из галереи не подойдёт.</p>
      <button class="cta" id="doTask">📷 Я на месте, сфотографировать</button>
    </div>`;
  const yandex = `https://yandex.ru/maps/?pt=${p.lng},${p.lat}&z=17&l=map`;

  const m = modal(`
    ${p.photo_url ? `<div class="herowrap" id="hero"><img class="hero" src="${esc(p.photo_url)}" alt="${esc(p.title)}"></div>` : ''}
    <div class="mb">
      <div class="row"><span class="cat" style="background:${c.c}">${c.e} ${c.n}</span></div>
      <h2>${esc(p.title)}</h2>
      <div class="by">${avatar(prof(p.author_id), 'sm')}<span>Советует <b>${esc(mine ? 'вы' : nameOf(p.author_id))}</b>, ${ago(p.created_at)}</span></div>
      ${p.note ? `<p class="note">${esc(p.note)}</p>` : ''}
      <div class="links">
        <button type="button" class="lbtn" id="onMap">🗺️ Показать на карте</button>
        ${typeof togglePick === 'function' && !mine ? `<button type="button" class="lbtn" id="toDay">${CUR.pick.has('f:' + p.id) ? '✓ В маршруте на день' : '🧭 В маршрут на день'}</button>` : ''}
        <a class="lbtn" href="${esc(yandex)}" target="_blank" rel="noopener noreferrer">🧭 Как добраться</a>
        ${p.link ? `<a class="lbtn" href="${esc(p.link)}" target="_blank" rel="noopener noreferrer">🔗 ${esc(p.link.replace(/^https?:\/\/(www\.)?/, '').slice(0, 32))}</a>` : ''}
      </div>
      <div class="reacts" aria-label="Реакции">${reacts}</div>
      ${action}
      <div class="sec">Здесь побывали <span class="n">${visits.length}</span></div>
      ${visits.length ? `<div class="visits">${visits.map(v => `<div class="vis"><img src="${esc(v.photo_url)}" alt="" loading="lazy" data-src="${esc(v.photo_url)}"><div class="vi">${avatar(prof(v.user_id), 'sm')}<b>${esc(nameOf(v.user_id))}</b><span>${ago(v.created_at)}</span></div></div>`).join('')}</div>`
        : `<p class="intro">Пока никто. ${mine ? 'Позовите друзей — для них это задание.' : 'Будьте первым!'}</p>`}
      ${mine ? '<div class="arow"><button class="sbtn ghost sm" id="editPlace">✏️ Изменить</button><button class="linkbtn warn" id="delPlace">Удалить место</button></div>' : ''}
    </div>`);
  m.querySelector('#hero')?.addEventListener('click', () => lightbox(p.photo_url));
  m.querySelectorAll('.vis img').forEach(i => i.onclick = () => lightbox(i.dataset.src));
  m.querySelector('#onMap').onclick = () => { closeModal(); showOnMap(p.lat, p.lng, 16); };
  m.querySelector('#toDay')?.addEventListener('click', e => { const on = togglePick('f:' + p.id); e.target.textContent = on ? '✓ В маршруте на день' : '🧭 В маршрут на день'; toast(on ? 'Добавлено в маршрут на день' : 'Убрано из маршрута'); });
  m.querySelectorAll('.re').forEach(b => b.onclick = async () => {
    const on = b.getAttribute('aria-pressed') === 'true';
    b.disabled = true;
    const r = on
      ? await sb.from('reactions').delete().match({ place_id: p.id, user_id: S.user.id, emoji: b.dataset.e })
      : await sb.from('reactions').insert({ place_id: p.id, emoji: b.dataset.e });
    if (r.error) toast(errText(r.error));
    const st = $('.modal')?.scrollTop || 0;
    await refresh(); openPlace(p.id);
    const md = $('.modal'); if (md) md.scrollTop = st;
  });
  m.querySelector('#doTask')?.addEventListener('click', () => openCamera(p));
  m.querySelector('#editPlace')?.addEventListener('click', () => openEditPlace(p));
  m.querySelector('#delPlace')?.addEventListener('click', async () => {
    if (!(await ask('Удалить место «' + p.title + '»? Это нельзя отменить.'))) return;
    const { data, error } = await sb.from('places').delete().eq('id', p.id).select('id');
    if (error) return toast(errText(error));
    if (data && !data.length) return toast('Не получилось удалить: база не дала прав. Обновите страницу и попробуйте ещё раз', 4500);
    closeModal(); toast('Место удалено'); refresh();
  });
}

/* Изменить своё место */
function openEditPlace(p) {
  let cat = p.category in CATS ? p.category : 'other', file = null;
  const m = modal(`
    <div class="mb">
      <h2>Изменить место</h2>
      <form class="form" id="ef" novalidate>
        <label class="field"><span>Название</span><input type="text" name="title" maxlength="80" value="${esc(p.title)}" required></label>
        <div class="field"><span>Что это за место</span><div class="catgrid" id="ecats">${Object.entries(CATS).map(([k, c]) => `<button type="button" class="chip" data-c="${k}" aria-pressed="${k === cat}">${c.e} ${c.n}</button>`).join('')}</div></div>
        <label class="field"><span>Чем оно крутое</span><textarea name="note" maxlength="1000">${esc(p.note || '')}</textarea></label>
        <label class="drop"><input type="file" accept="image/*" id="efile">${p.photo_url ? `<img id="eprev" src="${esc(p.photo_url)}" alt="">` : '<span class="thumb" id="eprev">📷</span>'}<span class="dt"><b>${p.photo_url ? 'Заменить фото' : 'Добавить фото'}</b>Необязательно</span></label>
        <label class="field"><span>Ссылка <em class="hint">· необязательно</em></span><input type="text" name="link" maxlength="500" inputmode="url" value="${esc(p.link || '')}" placeholder="https://"></label>
        <div class="err" id="eerr"></div>
        <button class="cta" type="submit" id="esave">Сохранить изменения</button>
      </form>
    </div>`, () => openPlace(p.id));
  m.querySelectorAll('#ecats .chip').forEach(b => b.onclick = () => { cat = b.dataset.c; m.querySelectorAll('#ecats .chip').forEach(x => x.setAttribute('aria-pressed', x === b)); });
  m.querySelector('#efile').onchange = e => {
    file = e.target.files[0] || null;
    if (file) m.querySelector('#eprev').outerHTML = `<img id="eprev" src="${URL.createObjectURL(file)}" alt="">`;
  };
  m.querySelector('#ef').onsubmit = async e => {
    e.preventDefault();
    const f = new FormData(e.target), errEl = m.querySelector('#eerr');
    const title = String(f.get('title')).trim();
    let link = String(f.get('link')).trim();
    if (!title) return (errEl.textContent = 'Напишите название');
    if (link && !/^https?:\/\//i.test(link)) link = 'https://' + link;
    const btn = m.querySelector('#esave'); btn.disabled = true; btn.textContent = 'Сохраняю…';
    try {
      const upd = { title, note: String(f.get('note')).trim() || null, link: link || null, category: cat };
      if (file) upd.photo_url = await uploadPhoto(await compress(file));
      const { error } = await sb.from('places').update(upd).eq('id', p.id);
      if (error) throw error;
      $('#modalRoot .overlay')._onClose = null; closeModal();
      toast('Изменения сохранены');
      await refresh(false); openPlace(p.id);
    } catch (ex) { errEl.textContent = errText(ex); btn.disabled = false; btn.textContent = 'Сохранить изменения'; }
  };
}

/* Знакомство: новичок, вошедший по коду, называет себя и выбирает аватар */
function needsWelcome() {
  const pre = (S.user?.email || '').split('@')[0].slice(0, 40);
  return S.me && !S.me.avatar && S.me.name === pre && !store.get('mv_welcomed_' + S.user.id);
}
function openWelcome() {
  let av = AVATARS[Math.floor(Math.random() * AVATARS.length)];
  const m = modal(`
    <div class="mb">
      <h2>Добро пожаловать!</h2>
      <p class="intro">Как вас будут видеть друзья на карте и в рейтинге.</p>
      <form class="form" id="wf" novalidate>
        <label class="field"><span>Имя</span><input type="text" name="name" maxlength="40" placeholder="Например: Маша" autocomplete="given-name"></label>
        <div class="field"><span>Аватар</span><div class="emogrid">${AVATARS.map(a => `<button type="button" class="emo-o" data-a="${a}" aria-pressed="${a === av}">${a}</button>`).join('')}</div></div>
        <div class="err" id="wferr"></div>
        <button class="cta" type="submit">Готово</button>
      </form>
    </div>`, () => store.set('mv_welcomed_' + S.user.id, '1'));
  m.querySelectorAll('.emo-o').forEach(b => b.onclick = () => { av = b.dataset.a; m.querySelectorAll('.emo-o').forEach(x => x.setAttribute('aria-pressed', x === b)); });
  m.querySelector('#wf').onsubmit = async e => {
    e.preventDefault();
    const name = String(new FormData(e.target).get('name')).trim();
    if (!name) return (m.querySelector('#wferr').textContent = 'Напишите имя — так друзья вас узнают');
    const { error } = await sb.from('profiles').update({ name, avatar: av }).eq('id', S.user.id);
    if (error) return (m.querySelector('#wferr').textContent = errText(error));
    closeModal(); toast(`Приятно познакомиться, ${name}!`); refresh();
  };
}

/* Камера для задания: снимок только «вживую» */
let camStream = null;
function stopCamera() { camStream?.getTracks().forEach(t => t.stop()); camStream = null; }
async function openCamera(p) {
  const canLive = !!navigator.mediaDevices?.getUserMedia && window.isSecureContext;
  const m = modal(`
    <div class="mb">
      <h2>${esc(p.title)}</h2>
      <p class="intro">Сфотографируйте место прямо сейчас — так друзья увидят, что вы тут были.</p>
      <div class="cam${canLive ? '' : ' nocam'}" id="cam">${canLive ? '<video id="vid" autoplay playsinline muted></video>' : '<span style="font-size:44px">📷</span>'}</div>
      <div class="err" id="cerr"></div>
      <div class="camrow" id="camrow">
        ${canLive ? '<button class="cta" id="shot">📸 Сделать снимок</button>'
          : '<label class="cta" style="cursor:pointer">📷 Открыть камеру<input type="file" accept="image/*" capture="environment" id="capin" hidden></label>'}
      </div>
    </div>`, () => openPlace(p.id));
  let blob = null;
  const cam = m.querySelector('#cam'), row = m.querySelector('#camrow'), cerr = m.querySelector('#cerr');
  const showPreview = b => {
    blob = b;
    cam.classList.remove('nocam'); cam.innerHTML = `<img src="${URL.createObjectURL(b)}" alt="">`;
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
      toast(`Задание выполнено! +${PTS.visit} баллов 🎉`, 4000);
      await refresh(false); openPlace(p.id);
    } catch (ex) { cerr.textContent = errText(ex); btn.disabled = false; btn.textContent = `Отправить · +${PTS.visit}`; }
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
      cerr.textContent = ex?.name === 'NotAllowedError'
        ? 'Браузер не дал доступ к камере. Разрешите его в настройках сайта или откройте камеру телефона кнопкой ниже.'
        : 'Не получилось включить камеру здесь. Откройте камеру телефона кнопкой ниже.';
      cam.innerHTML = '<span style="font-size:44px">📷</span>'; cam.classList.add('nocam');
      row.innerHTML = '<label class="cta" style="cursor:pointer">📷 Открыть камеру<input type="file" accept="image/*" capture="environment" id="capin" hidden></label>';
      bindCapture();
    }
  } else bindCapture();
  function bindCapture() {
    m.querySelector('#capin').onchange = async e => {
      const f = e.target.files[0]; if (!f) return;
      // Защита от старых фото: снимок должен быть сделан только что
      if (Date.now() - f.lastModified > 5 * 60 * 1000) return (cerr.textContent = 'Нужно свежее фото, сделанное прямо сейчас, а не из галереи.');
      cerr.textContent = '';
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
      <div class="prof">${avatar(me, 'lg')}<div><h2>${esc(me.name)}</h2><div class="hint">Код для друзей: <span class="code">${esc(me.code)}</span></div></div></div>
      <div class="stats">
        <div class="stat"><b>${me.points}</b><span>баллов</span></div>
        <div class="stat"><b>${myPlaces}</b><span>${plural(myPlaces, 'место', 'места', 'мест')}</span></div>
        <div class="stat"><b>${myVisits}</b><span>${plural(myVisits, 'задание', 'задания', 'заданий')}</span></div>
      </div>
      <div class="sec">Настройки профиля</div>
      <form class="form" id="prf">
        <label class="field"><span>Имя</span><input type="text" name="name" maxlength="40" value="${esc(me.name)}"></label>
        <div class="field"><span>Аватар</span><div class="emogrid">
          <button type="button" class="emo-o" data-a="" aria-pressed="${!av}">${esc(me.name[0]?.toUpperCase() || 'A')}</button>
          ${AVATARS.map(a => `<button type="button" class="emo-o" data-a="${a}" aria-pressed="${a === av}">${a}</button>`).join('')}
        </div></div>
        <div class="field"><span>Цвет</span><div class="swatches">${COLORS.map(c => `<button type="button" class="sw" data-c="${c}" style="background:${c}" aria-pressed="${c === color}" aria-label="${c}"></button>`).join('')}</div></div>
        <div class="err" id="prerr"></div>
        <button class="cta" type="submit">Сохранить профиль</button>
      </form>
      <button class="linkbtn" id="logout">Выйти из аккаунта</button>
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
/* Разделы. На телефоне «Карта» — отдельный экран, на компьютере карта видна всегда. */
const mobileMQ = window.matchMedia('(max-width: 860px)');
const isMobile = () => mobileMQ.matches;
function setTab(tab) {
  if (tab === 'map' && !isMobile()) tab = 'tasks';
  S.tab = tab;
  document.body.dataset.view = tab;
  document.querySelectorAll('.tab').forEach(x => x.setAttribute('aria-selected', x.dataset.tab === tab));
  if (tab === 'map') { setTimeout(() => map?.invalidateSize(), 30); }
  else { renderPanel(); $('#pbody').scrollTop = 0; }
}
function showOnMap(lat, lng, zoom = 16) {
  if (isMobile()) setTab('map');
  setTimeout(() => map.setView([lat, lng], Math.max(map.getZoom(), zoom)), 40);
}
document.querySelectorAll('.tab').forEach(t => t.onclick = () => setTab(t.dataset.tab));
mobileMQ.addEventListener?.('change', () => { if (S.tab === 'map' && !isMobile()) setTab('tasks'); setTimeout(() => map?.invalidateSize(), 60); });

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
  const mine = p.author_id === S.user.id;
  return `<button class="item" data-id="${p.id}">
    ${p.photo_url ? `<img class="thumb" src="${esc(p.photo_url)}" alt="" loading="lazy">` : `<span class="thumb">${c.e}</span>`}
    <div><div class="t">${esc(p.title)}</div>
      <div class="s">${mine ? '' : avatar(prof(p.author_id), 'sm')}${mine ? c.e + ' ' + c.n : esc(nameOf(p.author_id))}${n ? `, ${n} ${plural(n, 'визит', 'визита', 'визитов')}` : ''}</div></div>
    ${mine ? '' : done ? '<span class="rew done">✓</span>' : `<span class="rew">+${PTS.visit}</span>`}
  </button>`;
}
function bindItems(root) {
  root.querySelectorAll('[data-id]').forEach(b => b.onclick = () => {
    const p = S.places.find(x => x.id === Number(b.dataset.id));
    if (!p) return;
    if (!isMobile()) map.setView([p.lat, p.lng], Math.max(map.getZoom(), 15));
    else map.setView([p.lat, p.lng], Math.max(map.getZoom(), 15), { animate: false });
    openPlace(p.id);
  });
}
const store = {
  get(k) { try { return localStorage.getItem(k); } catch { return null; } },
  set(k, v) { try { localStorage.setItem(k, v); } catch { /* без памяти браузера — не страшно */ } },
};
function dayKey(ts) {
  const d = new Date(ts); d.setHours(0, 0, 0, 0);
  const t = new Date(); t.setHours(0, 0, 0, 0);
  const diff = Math.round((t - d) / 86400000);
  if (diff === 0) return 'Сегодня';
  if (diff === 1) return 'Вчера';
  return d.toLocaleDateString('ru-RU', { day: 'numeric', month: 'long', ...(d.getFullYear() !== t.getFullYear() ? { year: 'numeric' } : {}) });
}
const sec = (title, n) => `<div class="sec">${title}${n != null ? ` <span class="n">${n}</span>` : ''}</div>`;

function renderPanel() {
  const body = $('#pbody');
  if (S.tab === 'map' || !S.me) return;
  if (S.tab === 'tasks') {
    const tasks = S.places.filter(isTask);
    const done = S.places.filter(p => p.author_id !== S.user.id && visitOf(p.id, S.user.id));
    const mine = S.places.filter(p => p.author_id === S.user.id);
    const howto = store.get('mv_howto_hidden') ? '' : `<div class="howto">
        <button class="x" id="howtoX" aria-label="Скрыть подсказку">×</button>
        <h3>Как это работает</h3>
        <ol>
          <li>Отмечайте на карте места, которые советуете друзьям (+${PTS.place}).</li>
          <li>Места друзей становятся вашими заданиями: придите и сфотографируйте (+${PTS.visit}).</li>
          <li>Когда друг побывал в вашем месте, вы тоже получаете баллы (+${PTS.visited}).</li>
        </ol>
      </div>`;
    const strip = typeof curatedStrip === 'function' ? curatedStrip() : '';
    if (!S.friends.length && !mine.length) {
      body.innerHTML = `${howto}${strip}
        <div class="empty"><span class="ei">🗺️</span><b>Карта пока пустая</b>Добавьте первое место и позовите друзей — их места станут вашими заданиями.
          <span class="seg" style="justify-content:center"><button class="sbtn" id="emptyAdd">Добавить место</button><button class="sbtn ghost" id="emptyFr">Позвать друзей</button></span></div>`;
    } else {
      body.innerHTML = `${howto}${strip}
        <div class="ptitle">Задания от друзей</div>
        ${tasks.length ? `<p class="intro">Места друзей, где вы ещё не были. Придите и сфотографируйте — получите +${PTS.visit}.</p>${tasks.map(placeItem).join('')}`
          : `<div class="empty"><span class="ei">🎉</span><b>Все задания выполнены</b>${S.friends.length ? 'Новые появятся, когда друзья добавят места.' : 'Добавьте друзей — их места станут заданиями.'}</div>`}
        ${mine.length ? sec('Мои места', mine.length) + mine.map(placeItem).join('') : ''}
        ${done.length ? sec('Выполнено', done.length) + done.map(placeItem).join('') : ''}`;
    }
    if (typeof bindCuratedStrip === 'function') bindCuratedStrip(body);
    body.querySelector('#howtoX')?.addEventListener('click', () => { store.set('mv_howto_hidden', '1'); renderPanel(); });
    body.querySelector('#emptyAdd')?.addEventListener('click', startAdding);
    body.querySelector('#emptyFr')?.addEventListener('click', () => setTab('friends'));
    bindItems(body);
  }
  if (S.tab === 'feed') {
    const ev = [
      ...S.places.map(p => ({ t: p.created_at, who: p.author_id, place: p, kind: 'place' })),
      ...S.visits.map(v => ({ t: v.created_at, who: v.user_id, place: S.places.find(p => p.id === v.place_id), kind: 'visit', photo: v.photo_url })),
    ].filter(e => e.place).sort((a, b) => new Date(b.t) - new Date(a.t)).slice(0, 60);
    let lastDay = '';
    body.innerHTML = `<div class="ptitle">Что нового у друзей</div>` + (ev.length ? ev.map(e => {
      const d = dayKey(e.t), head = d !== lastDay ? `<div class="daysep">${d}</div>` : ''; lastDay = d;
      const img = e.kind === 'visit' ? e.photo : e.place.photo_url;
      return `${head}<button class="ev" data-id="${e.place.id}">
        ${avatar(prof(e.who))}
        <div><div class="txt">${e.who === S.user.id
          ? (e.kind === 'place' ? `<b>Вы</b> добавили «${esc(e.place.title)}»` : `<b>Вы</b> выполнили задание «${esc(e.place.title)}» <span class="plus">+${PTS.visit}</span>`)
          : (e.kind === 'place' ? `<b>${esc(nameOf(e.who))}</b> советует «${esc(e.place.title)}»` : `<b>${esc(nameOf(e.who))}</b>: задание «${esc(e.place.title)}» выполнено <span class="plus">+${PTS.visit}</span>`)}</div>
          <div class="when">${ago(e.t)}</div></div>
        ${img ? `<img src="${esc(img)}" alt="" loading="lazy">` : '<span></span>'}
      </button>`;
    }).join('') : '<div class="empty"><span class="ei">📰</span><b>Здесь будет лента</b>Новые места и выполненные задания — ваши и друзей.</div>');
    bindItems(body);
  }
  if (S.tab === 'friends') renderFriends(body);
  if (S.tab === 'walks' && typeof renderWalks === 'function') renderWalks(body);
  if (S.tab === 'rating') {
    const list = [S.me, ...S.friends].sort((a, b) => b.points - a.points);
    const max = Math.max(1, ...list.map(p => p.points));
    const pos = list.findIndex(p => p.id === S.user.id) + 1;
    const above = list[pos - 2];
    const gap = above ? above.points - S.me.points + 1 : 0;
    body.innerHTML = `
      <div class="rkme"><div><div class="k">Ваше место</div><div class="v">${pos}<small> из ${list.length}</small></div></div>
        <div class="hint">${above ? `До «${esc(above.name)}» — ${gap} ${plural(gap, 'балл', 'балла', 'баллов')}` : list.length > 1 ? 'Вы лидер среди друзей! 🏆' : 'Добавьте друзей, чтобы соревноваться'}</div></div>
      ${list.map((p, i) => `<div class="rk ${p.id === S.user.id ? 'me' : ''}">
        <span class="pos ${i < 3 && list.length > 1 ? 'm' + (i + 1) : ''}">${i + 1}</span>${avatar(p)}
        <div><div class="nm">${esc(p.id === S.user.id ? p.name + ' (вы)' : p.name)}</div><div class="bar"><i style="width:${(p.points / max) * 100}%;background:${esc(p.color)}"></i></div></div>
        <span class="pts">${p.points}</span></div>`).join('')}
      ${list.length < 2 ? `<div class="empty"><b>Соревнуйтесь с друзьями</b>Добавьте друзей — и здесь появится общий рейтинг.<button class="sbtn" id="rkFr">Добавить друзей</button></div>` : ''}
      ${sec('Как получить баллы')}
      <div class="rules">
        <div class="r"><span>Выполнить задание друга (фото на месте)</span><span class="p pts-sticker">+${PTS.visit}</span></div>
        <div class="r"><span>Добавить место на карту</span><span class="p pts-sticker">+${PTS.place}</span></div>
        <div class="r"><span>Друг побывал в вашем месте</span><span class="p pts-sticker">+${PTS.visited}</span></div>
      </div>`;
    body.querySelector('#rkFr')?.addEventListener('click', () => setTab('friends'));
  }
}

function renderFriends(body) {
  const invite = `${location.origin}${location.pathname}?invite=${S.me.code}`;
  body.innerHTML = `
    <div class="ptitle">Друзья</div>
    <div class="myid"><div><div class="k">Ваш код для друзей</div><div class="v">${esc(S.me.code)}</div></div>
      <button class="sbtn sm" id="copyInv">${navigator.share ? 'Пригласить' : 'Скопировать ссылку'}</button></div>
    <form class="addrow" id="addf"><input class="input" name="code" maxlength="6" placeholder="Код друга, 6 символов" autocomplete="off" autocapitalize="characters" spellcheck="false" aria-label="Код друга"><button class="sbtn" type="submit">Добавить</button></form>
    <div class="err" id="ferr"></div>
    ${S.incoming.length ? sec('Хотят дружить', S.incoming.length) + S.incoming.map(r => `
      <div class="fr in">${avatar(prof(r.from_id))}<div><div class="nm">${esc(prof(r.from_id)?.name)}</div><div class="sub">хочет дружить</div></div>
      <div class="acts"><button class="sbtn ok sm" data-acc="${r.id}">Принять</button><button class="sbtn ghost sm" data-dec="${r.id}">✕</button></div></div>`).join('') : ''}
    ${sec('Мои друзья', S.friends.length)}
    ${S.friends.length ? S.friends.map(f => { const n = S.places.filter(p => p.author_id === f.id).length; return `
      <div class="fr">${avatar(f)}<div><div class="nm">${esc(f.name)}</div><div class="sub">${f.points} ${plural(f.points, 'балл', 'балла', 'баллов')}, ${n} ${plural(n, 'место', 'места', 'мест')}</div></div>
      <div class="acts"><button class="sbtn ghost sm" data-rm="${f.id}" title="Удалить из друзей" aria-label="Удалить ${esc(f.name)} из друзей">✕</button></div></div>`; }).join('')
      : '<div class="empty"><span class="ei">👋</span><b>Пока никого</b>Отправьте другу ссылку-приглашение или попросите его код.</div>'}
    ${S.outgoing.length ? sec('Ждут ответа', S.outgoing.length) + S.outgoing.map(r => `
      <div class="fr">${avatar(prof(r.to_id))}<div><div class="nm">${esc(prof(r.to_id)?.name)}</div><div class="sub">заявка отправлена</div></div>
      <div class="acts"><button class="sbtn ghost sm" data-dec="${r.id}">Отменить</button></div></div>`).join('') : ''}`;
  body.querySelector('#copyInv').onclick = async () => {
    if (navigator.share) {
      try { await navigator.share({ title: 'Место вместе', text: `Добавляйся ко мне в «Место вместе» — мой код ${S.me.code}`, url: invite }); return; }
      catch (e) { if (e?.name === 'AbortError') return; }
    }
    try { await navigator.clipboard.writeText(invite); toast('Ссылка скопирована — отправьте её другу'); }
    catch { prompt('Скопируйте ссылку и отправьте другу:', invite); }
  };
  body.querySelector('#addf').onsubmit = async e => {
    e.preventDefault();
    const code = String(new FormData(e.target).get('code')).trim().toUpperCase();
    if (code.length !== 6) return (body.querySelector('#ferr').textContent = 'В коде друга 6 символов — проверьте, всё ли скопировалось');
    await addFriend(code, body.querySelector('#ferr'));
  };
  body.querySelectorAll('[data-acc]').forEach(b => b.onclick = () => respond(b.dataset.acc, true));
  body.querySelectorAll('[data-dec]').forEach(b => b.onclick = () => respond(b.dataset.dec, false));
  body.querySelectorAll('[data-rm]').forEach(b => b.onclick = async () => {
    if (!(await ask('Удалить из друзей? Вы перестанете видеть места друг друга.'))) return;
    const { error } = await sb.rpc('remove_friend', { p_friend: b.dataset.rm });
    if (error) return toast(errText(error));
    refresh();
  });
}
async function addFriend(code, errEl) {
  const { data, error } = await sb.rpc('send_friend_request', { p_code: code });
  if (error) { const t = errText(error); errEl ? (errEl.textContent = t) : toast(t); return; }
  toast(data === 'accepted' ? 'Теперь вы друзья! Их места появились на карте' : data === 'already' ? 'Вы уже друзья' : 'Заявка отправлена — ждём, когда друг её примет');
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
  // Яндекс Карты, если ключ задан и API загрузилось; иначе — прежняя карта
  started = started || (async () => {
    const eng = window.MAP_READY ? await window.MAP_READY : 'leaflet';
    if (eng === 'yandex' && window.YL) {
      try { window.LEAFLET = window.L; window.L = window.YL; document.body.classList.add('ymaps'); initMap(); return; }
      catch (e) { console.error('ymaps', e); window.L = window.LEAFLET; document.body.classList.remove('ymaps'); $('#map').innerHTML = ''; $('#map').className = ''; }
    }
    initMap();
  })();
  await started;
  setTab(isMobile() ? 'map' : S.tab === 'map' ? 'tasks' : S.tab);
  setTimeout(() => map.invalidateSize(), 50);
  store.set('mv_seen', '1');
  try { await loadAll(); hideBoot(); renderAll(); map.invalidateSize(); fitOnce(); geoAuto(); if (typeof startLive === 'function') startLive(); if (needsWelcome()) openWelcome(); }
  catch (e) { hideBoot(); toast(errText(e), 5000); console.error(e); return; }
  // Приглашение по ссылке ?invite=КОД
  const inv = (new URLSearchParams(location.search).get('invite') || store.get('mv_invite') || '').toUpperCase();
  store.set('mv_invite', '');
  if (location.search.includes('invite')) history.replaceState(null, '', location.pathname);
  if (inv && inv !== S.me.code) addFriend(inv);
  if (typeof loadCurated === 'function' && !CUR.loaded) loadCurated();
  clearInterval(timer);
  timer = setInterval(() => { if (!document.hidden && !$('#modalRoot .overlay')) refresh(); }, 30000);
}

sb.auth.onAuthStateChange((event, session) => {
  if (session?.user && (event === 'SIGNED_IN' || event === 'INITIAL_SESSION')) {
    if (S.user?.id !== session.user.id) setTimeout(() => start(session), 0); // вне колбэка, чтобы не блокировать auth
  } else if (!session) {
    if (typeof stopLive === 'function') stopLive();
    S.user = null; clearInterval(timer); showAuth();
  }
});
// Вернулись на вкладку — сразу подтянуть новое от друзей
document.addEventListener('visibilitychange', () => { if (!document.hidden && S.user && S.me && !$('#modalRoot .overlay')) refresh(); });
// Если сеть долго молчит — не держим заставку вечно
setTimeout(() => { if ($('#boot') && !S.user) showAuth(); }, 8000);
