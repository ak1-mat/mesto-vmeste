/* «Место вместе» — «Трендовые места»: ИИ ищет в интернете и соцсетях места, которые сейчас на хайпе,
   а мастер прогулки собирает из них маршрут. Данные отдаёт функция Supabase «trends». */
'use strict';

const TR = {
  city: 'Москва',
  list: [], at: null,      // места и когда ИИ их нашёл
  loading: false, err: '', // идёт поиск / текст ошибки
  _p: null,
};

// ключ места → стабильный id вида «t-…», чтобы маршрут и сохранённые прогулки не путались после обновления
function trendId(key) {
  let h = 2166136261;
  for (const ch of key) { h ^= ch.codePointAt(0); h = Math.imul(h, 16777619); }
  return 't-' + (h >>> 0).toString(36);
}

async function loadTrends(refresh = false) {
  if (TR._p && !refresh) return TR._p;
  const CFG = window.MESTO_CONFIG || {};
  const url = CFG.TRENDS_FN || (CFG.SUPABASE_URL ? CFG.SUPABASE_URL + '/functions/v1/trends' : '');
  TR.loading = true; TR.err = '';
  TR._p = (async () => {
    for (let attempt = 0; attempt < 6; attempt++) {
      const ctl = new AbortController(), t = setTimeout(() => ctl.abort(), 120000);
      try {
        const r = await fetch(url, {
          method: 'POST', signal: ctl.signal,
          headers: { 'Content-Type': 'application/json', apikey: CFG.SUPABASE_ANON_KEY, Authorization: 'Bearer ' + CFG.SUPABASE_ANON_KEY },
          body: JSON.stringify({ city: TR.city, refresh: refresh && attempt === 0 }),
        });
        const j = await r.json().catch(() => ({}));
        if (j.busy) { await new Promise(res => setTimeout(res, 15000)); continue; }   // кто-то уже запустил поиск — ждём его
        if (!r.ok || !Array.isArray(j.places)) throw new Error(j.error || 'HTTP ' + r.status);
        TR.list = j.places.map(p => ({
          ...p, id: trendId(p.key || p.title), trend: true, author_id: null, photo_url: null,
          mins: (typeof DWELL !== 'undefined' ? DWELL[p.category] : 0) || 30,
        }));
        TR.at = j.updated_at ? new Date(j.updated_at) : new Date();
        if (j.stale) TR.err = 'Не получилось обновить — показываю прошлую подборку.';
        return TR.list;
      } catch (e) {
        TR.err = /no_key/.test(e.message) ? 'ИИ-поиск ещё не настроен: добавьте ключ ИИ в секреты функции trends.'
          : e.name === 'AbortError' ? 'ИИ искал слишком долго. Попробуйте ещё раз.'
          : 'Не получилось найти трендовые места. Попробуйте позже.';
        TR._p = null;
        return TR.list;
      } finally { clearTimeout(t); }
    }
    TR.err = 'ИИ всё ещё ищет — загляните через минуту.'; TR._p = null;
    return TR.list;
  })();
  try { return await TR._p; } finally { TR.loading = false; }
}

function trendAgo() {
  if (!TR.at) return '';
  const h = Math.round((Date.now() - TR.at.getTime()) / 3600000);
  return h < 1 ? 'обновлено только что' : `обновлено ${h} ${plural(h, 'час', 'часа', 'часов')} назад`;
}

// Карточка трендового места (из мастера, из прогулки или по нажатию на метку маршрута)
function openTrendPoint(p, onBack) {
  const c = CATS[p.category] || CATS.other;
  const m = modal(`<div class="mb">
    <div class="pl-date">🔥 Сейчас на хайпе · ${esc(c.e + ' ' + c.n)}</div>
    <h2>${esc(p.title)}</h2>
    ${p.address ? `<p class="hint">📍 ${esc(p.address)}</p>` : ''}
    ${p.why ? `<p class="note">${esc(p.why)}</p>` : ''}
    <p class="hint">Нашёл ИИ${p.source_name ? ` · источник: ${esc(p.source_name)}` : ''}. Перед походом проверьте часы работы.</p>
    ${p.source_url ? `<a class="lbtn" style="align-self:flex-start" target="_blank" rel="noopener noreferrer" href="${esc(p.source_url)}">🔗 Открыть источник</a>` : ''}
    <a class="lbtn" style="align-self:flex-start" target="_blank" rel="noopener noreferrer" href="https://yandex.ru/maps/?text=${encodeURIComponent(p.title + (p.address ? ', ' + p.address : ''))}&ll=${p.lng},${p.lat}&z=17">🗺️ Найти в Яндекс Картах</a>
    ${onBack ? '<button type="button" class="cta ghost" data-back>← Назад к маршруту</button>' : ''}
  </div>`);
  m.querySelector('[data-back]')?.addEventListener('click', onBack);
}
