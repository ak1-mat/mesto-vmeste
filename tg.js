/* «Место вместе» внутри Telegram: мини-приложение и бот.
   Работает, только если сайт открыт из Telegram и в config.js указан бот (TG_BOT).
   В обычном браузере этот файл ничего не меняет — кроме уведомлений друзьям в Telegram. */
'use strict';
(function () {
  const CFG = window.MESTO_CONFIG || {};
  const BOT = String(CFG.TG_BOT || '').replace(/^@/, '');
  const FN = CFG.TG_FN || (CFG.SUPABASE_URL ? CFG.SUPABASE_URL + '/functions/v1/tg' : '');
  const ss = { get: k => { try { return sessionStorage.getItem(k); } catch { return null; } }, set: (k, v) => { try { v == null ? sessionStorage.removeItem(k) : sessionStorage.setItem(k, v); } catch { /* нет хранилища */ } } };

  // Telegram передаёт данные запуска в адресе после «#». Библиотеку Telegram грузим только тогда —
  // обычным посетителям сайта она не нужна и не должна тормозить загрузку.
  const launched = !!BOT && (/(^|[#&])tgWebAppData=/.test(location.hash) || !!ss.get('mv_tg'));
  let ready = Promise.resolve();
  if (launched && !(window.Telegram && window.Telegram.WebApp)) {
    ss.set('mv_tg', '1');
    ready = new Promise(res => {
      const sc = document.createElement('script');
      sc.src = 'https://telegram.org/js/telegram-web-app.js?59';
      sc.onload = sc.onerror = res;
      setTimeout(res, 8000);
      document.head.appendChild(sc);
    });
  }
  const wa = () => (window.Telegram && window.Telegram.WebApp) || null;
  const $ = s => document.querySelector(s);
  const can = v => { const w = wa(); try { return !!w && w.isVersionAtLeast(v); } catch { return false; } };

  async function api(body, withUser) {
    const headers = { 'Content-Type': 'application/json', apikey: CFG.SUPABASE_ANON_KEY, Authorization: 'Bearer ' + CFG.SUPABASE_ANON_KEY };
    if (withUser) {
      const { data } = await sb.auth.getSession();
      if (!data.session) return null;
      headers.Authorization = 'Bearer ' + data.session.access_token;
    }
    const ctl = new AbortController(), t = setTimeout(() => ctl.abort(), 15000);
    try {
      const r = await fetch(FN, { method: 'POST', headers, body: JSON.stringify(body), signal: ctl.signal });
      return await r.json();
    } finally { clearTimeout(t); }
  }

  const TG = window.TG = {
    bot: BOT,
    on: false,        // сайт открыт внутри Telegram
    busy: false,      // идёт вход через Telegram
    viaTg: false,     // в этот раз вошли через Telegram (привязка уже есть)
    name: '',

    ready,
    /* Оформление «как приложение» */
    init() { ready.then(TG._init); },
    _init() {
      if (TG.on) return;
      const w = wa();
      if (!BOT || !w || !w.initData) return;
      TG.on = true;
      TG.name = (w.initDataUnsafe && w.initDataUnsafe.user && w.initDataUnsafe.user.first_name) || '';
      document.documentElement.classList.add('tg');
      try { w.ready(); w.expand(); } catch { /* старая версия */ }
      if (can('7.7')) try { w.disableVerticalSwipes(); } catch { /* нет */ }   // чтобы карта двигалась, а окно не сворачивалось
      TG.paint();
      try { w.onEvent('themeChanged', TG.paint); } catch { /* нет */ }
      window.matchMedia('(prefers-color-scheme: dark)').addEventListener?.('change', TG.paint);
      // Системная кнопка «Назад» закрывает открытое окно
      if (can('6.1')) {
        const top = () => $('.lightbox') || $('.askov') || $('#modalRoot .overlay');
        const sync = () => { try { top() ? w.BackButton.show() : w.BackButton.hide(); } catch { /* нет */ } };
        w.BackButton.onClick(() => {
          const o = top(); if (!o) return;
          if (o.classList.contains('lightbox')) o.remove();
          else if (o.classList.contains('askov')) o.querySelector('[data-no]')?.click();
          else closeModal();
        });
        new MutationObserver(sync).observe(document.body, { childList: true, subtree: false });
        const root = $('#modalRoot'); if (root) new MutationObserver(sync).observe(root, { childList: true });
      }
    },
    // Шапка Telegram — в цвет сайта (светлая или тёмная тема)
    paint() {
      const w = wa(); if (!w) return;
      const hexOf = v => { const m = getComputedStyle(document.documentElement).getPropertyValue(v).trim(); return /^#[0-9a-f]{6}$/i.test(m) ? m : null; };
      const bg = hexOf('--paper') || (window.matchMedia('(prefers-color-scheme: dark)').matches ? '#0F0E15' : '#F2F1F7');
      try { if (can('6.1')) { w.setHeaderColor(bg); w.setBackgroundColor(bg); } if (can('7.10')) w.setBottomBarColor(bg); } catch { /* нет */ }
    },
    buzz(kind) {
      const w = wa(); if (!TG.on || !can('6.1')) return;
      try { kind === 'ok' ? w.HapticFeedback.notificationOccurred('success') : w.HapticFeedback.impactOccurred('light'); } catch { /* нет */ }
    },

    /* Вход. Возвращает true, если берёт вход на себя (экран входа пока не показываем). */
    boot() {
      if (!launched || !FN) return false;
      TG.busy = true;
      ready.then(() => {
        TG._init(); TG.busy = false;
        if (!TG.on) return showAuth();                                    // это не Telegram — обычный вход
        if (ss.get('mv_tg_out')) { showAuth(); TG.box('out'); return; }   // человек сам вышел — не входим за него
        TG.login(false);
      });
      return true;
    },
    async login(create) {
      if (TG.busy) return;
      TG.busy = true;
      const btn = $('#tgGo'), err = $('#tgErr');
      if (btn) { btn.disabled = true; btn.textContent = 'Вхожу…'; }
      if (err) err.textContent = '';
      let fail = '';
      try {
        const r = await api({ action: 'auth', initData: wa().initData, create: !!create });
        if (r && r.status === 'ok') {
          let v = await sb.auth.verifyOtp({ token_hash: r.token_hash, type: 'email' });
          if (v.error) v = await sb.auth.verifyOtp({ token_hash: r.token_hash, type: 'magiclink' });
          if (v.error) throw v.error;
          TG.viaTg = true; ss.set('mv_tg_out', null);
          // дальше сработает onAuthStateChange → start()
        } else if (r && r.status === 'new') {
          TG.name = r.name || TG.name;
          showAuth(); TG.box('new');
        } else fail = r && r.status === 'bad' ? 'Telegram не подтвердил вход. Закройте окно и откройте приложение заново.' : 'Вход через Telegram пока недоступен. Попробуйте ещё раз чуть позже.';
      } catch (e) {
        console.error('tg login', e);
        fail = 'Не получилось связаться с сервером. Проверьте интернет и попробуйте ещё раз.';
      }
      TG.busy = false;
      if (btn) { btn.disabled = false; btn.textContent = TG.goLabel(); }
      if (fail) { showAuth(); TG.box(TG._mode || 'retry'); const e2 = $('#tgErr'); if (e2) e2.textContent = fail; }
    },
    only: !!CFG.TG_ONLY,
    goLabel() { return TG._mode === 'web' ? 'Войти через Telegram' : TG._mode === 'new' ? (TG.name ? `Продолжить как ${TG.name}` : 'Продолжить с Telegram') : 'Войти через Telegram'; },
    // Блок Telegram в карточке входа: 'new' — первый запуск, 'out' — после выхода, 'retry' — после ошибки
    box(mode) {
      const b = $('#tgBox'); if (!b) return;
      TG._mode = mode;
      b.hidden = false;
      $('#tgGo').textContent = TG.goLabel();
      $('#tgLead').textContent = mode === 'web'
        ? 'Вход — через нашего бота в Telegram: без пароля и почты. Откройте бота и нажмите «Открыть карту».'
        : mode === 'new' ? 'Вход без пароля — аккаунт создастся сам, имя возьмём из Telegram.' : 'Вход без пароля, в одно нажатие.';
      $('#tgOr').textContent = TG.only ? '' : mode === 'new' ? 'Уже пользовались сайтом? Войдите с почтой и паролем — аккаунт привяжется к Telegram, и дальше вход будет сам.' : 'Или войдите с почтой и паролем';
      $('#tgOr').hidden = TG.only;
      $('#authTitle').textContent = 'Место вместе';
      $('#tgGo').onclick = mode === 'web' ? () => { location.href = TG.botLink(); } : () => TG.login(mode === 'new');
    },
    signedOut() { if (TG.on) ss.set('mv_tg_out', '1'); },

    /* После входа и загрузки данных */
    async started() {
      await ready; TG._init();
      TG.open(TG.startParam());
      if (!TG.on) return;
      const b = $('#tgBox'); if (b) b.hidden = true;
      const w = wa();
      // Вошли с почтой и паролем внутри Telegram — привязываем этот Telegram к аккаунту
      if (!TG.viaTg) {
        try {
          const r = await api({ action: 'link', initData: w.initData }, true);
          if (r && r.status === 'ok') { TG.viaTg = true; ss.set('mv_tg_out', null); toast('Telegram привязан — дальше вход будет автоматическим'); }
          else if (r && r.status === 'taken') toast('Этот Telegram уже привязан к другому аккаунту', 4500);
        } catch (e) { console.error('tg link', e); }
      }
      // Разрешение боту присылать уведомления (спрашиваем один раз)
      const u = w.initDataUnsafe && w.initDataUnsafe.user;
      if (u && !u.allows_write_to_pm && can('6.9') && !store.get('mv_tg_ask')) {
        store.set('mv_tg_ask', '1');
        setTimeout(() => { try { w.requestWriteAccess(); } catch { /* нет */ } }, 2500);
      }
    },
    // Что открыть сразу: приглашение друга, место или прогулку (из ссылки t.me/бот?startapp=… или ?open=…)
    startParam() {
      let p = '';
      try { p = new URLSearchParams(location.search).get('open') || ''; } catch { /* нет */ }
      const w = wa();
      if (!p && TG.on && w.initDataUnsafe) p = w.initDataUnsafe.start_param || '';
      if (ss.get('mv_tg_opened') === p) return '';      // уже открывали в этом запуске
      ss.set('mv_tg_opened', p);
      if (p && /[?&]open=/.test(location.search)) history.replaceState(null, '', location.pathname + location.hash);
      return /^[\w-]{1,64}$/.test(p) ? p : '';
    },
    open(p) {
      if (!p) return;
      const id = p.slice(2);
      if (p.startsWith('f_')) { const code = id.toUpperCase(); if (/^[A-Z0-9]{6}$/.test(code) && code !== S.me.code) addFriend(code); }
      else if (p.startsWith('p_')) { if (S.places.some(x => String(x.id) === id)) openPlace(Number(id)); else toast('Это место пока не видно: его автор должен быть у вас в друзьях', 4500); }
      else if (p.startsWith('w_')) { if (S.plans.some(x => String(x.id) === id)) { setTab('walks'); openWalk(Number(id)); } else toast('Прогулка не найдена — возможно, её отменили', 4000); }
      else if (p === 'friends') setTab('friends');
    },

    /* Поделиться. Возвращает true, если ссылка ушла через Telegram. */
    link(param) { return BOT ? `https://t.me/${BOT}?start=${param}` : ''; },
    // Ссылка на бота с обычного сайта; приглашение друга (?invite=КОД) не теряется
    botLink() {
      let inv = '';
      try { inv = (new URLSearchParams(location.search).get('invite') || store.get('mv_invite') || '').toUpperCase(); } catch { /* нет */ }
      return /^[A-Z0-9]{6}$/.test(inv) ? TG.link('f_' + inv) : `https://t.me/${BOT}`;
    },
    share(param, text) {
      const w = wa();
      if (!TG.on || !BOT) return false;
      try { w.openTelegramLink(`https://t.me/share/url?url=${encodeURIComponent(TG.link(param))}&text=${encodeURIComponent(text)}`); return true; }
      catch { return false; }
    },

    /* Уведомление друзьям в Telegram (сервер сам проверяет событие; ошибки молча пропускаем) */
    notify(type, extra) {
      if (!BOT || !FN) return;
      api({ action: 'notify', type, ...extra }, true).catch(() => {});
    },
  };
})();
