/* «Место вместе» - карта 2ГИС (MapGL JS API).
   Прослойка повторяет те функции Leaflet, которыми пользуется сайт (L.map, L.marker, L.polyline…),
   поэтому остальной код почти не меняется. Если 2ГИС не загрузится - сайт работает на прежней карте (Leaflet).
   В 2ГИС координаты идут в порядке [долгота, широта], в остальном коде сайта - [широта, долгота]. */
'use strict';

(function () {
  const arr = x => (Array.isArray(x) ? x : [x.lat, x.lng]);   // -> [lat, lng]
  const gl = x => { const a = arr(x); return [a[1], a[0]]; };  // -> [lng, lat] для 2ГИС
  const ll = c => ({ lat: c[1], lng: c[0] });                   // из [lng, lat]
  // цвет + прозрачность -> '#rrggbbaa': 2ГИС принимает только такой формат и не знает отдельного opacity
  const rgba = (hex, a = 1) => {
    if (!hex || hex[0] !== '#') return '#5B3DF5ff';
    let h = hex.slice(1); if (h.length === 3) h = h.replace(/./g, c => c + c);
    return '#' + h.slice(0, 6) + Math.round(Math.max(0, Math.min(1, a)) * 255).toString(16).padStart(2, '0');
  };
  // клик по метке не должен считаться кликом по карте (иначе закрывается карточка / ставится новая точка)
  let objClickAt = 0;

  /* ---------- Границы ---------- */
  class GBounds {
    constructor(pts) {
      this.s = Infinity; this.w = Infinity; this.n = -Infinity; this.e = -Infinity;
      for (const p of pts || []) this.extend(p);
    }
    extend(p) { const [a, b] = arr(p); this.s = Math.min(this.s, a); this.n = Math.max(this.n, a); this.w = Math.min(this.w, b); this.e = Math.max(this.e, b); return this; }
    pad(r) { const dy = (this.n - this.s) * r, dx = (this.e - this.w) * r; const b = new GBounds(); b.s = this.s - dy; b.n = this.n + dy; b.w = this.w - dx; b.e = this.e + dx; return b; }
    contains(p) { const [a, b] = arr(p); return a >= this.s && a <= this.n && b >= this.w && b <= this.e; }
    isValid() { return isFinite(this.s); }
    toBBoxString() { return [this.w, this.s, this.e, this.n].join(','); }
  }

  /* ---------- Объекты на карте ----------
     В 2ГИС объект создаётся сразу на конкретной карте, поэтому храним его описание
     и пересоздаём, когда объект добавляют на карту или в группу, которая уже на карте. */
  class GObj {
    constructor() { this._parent = null; this._ev = []; this.g = null; this.title = ''; }
    addTo(t) { t._add(this); return this; }
    remove() { if (this._parent) this._parent._del(this); return this; }
    _map() { let p = this._parent; while (p && !(p instanceof GMap)) p = p._parent; return p; }
    _mount(m) { this._unmount(); this.g = this._create(m.m); this._bind(); }
    _unmount() { if (this.g) { try { this.g.destroy(); } catch (e) {} this.g = null; } }
    _rebuild() { const m = this._map(); if (m && this.g) this._mount(m); }
    _bind() { if (this.g && this.g.on) for (const [type, , h] of this._ev) this.g.on(type, h); }
    on(type, fn) {
      const h = e => { if (type === 'click') objClickAt = Date.now(); fn({ latlng: e && e.lngLat ? ll(e.lngLat) : null, target: this }); };
      this._ev.push([type, fn, h]); if (this.g && this.g.on) this.g.on(type, h); return this;
    }
    bindTooltip(text) { this.title = text || ''; return this; }
  }

  // Метка с HTML-значком (L.divIcon)
  class GMarker extends GObj {
    constructor(latlng, o = {}) {
      super();
      this.p = arr(latlng); this.o = o; this.title = o.title || '';
      const ic = o.icon || { html: '<div class="ydot"></div>', iconSize: [16, 16], iconAnchor: [8, 8] };
      const [w, h] = ic.iconSize || [24, 24];
      this.anchor = ic.iconAnchor || [w / 2, h / 2];
      this.el = document.createElement('div');
      this.el.className = 'ymk' + (ic.className ? ' ' + ic.className : '');
      this.el.style.cssText = `position:relative;width:${w}px;height:${h}px`;
      this.el.innerHTML = ic.html || '';
      if (o.interactive === false) this.el.style.pointerEvents = 'none';
      this.el.addEventListener('click', e => {
        objClickAt = Date.now(); e.stopPropagation();
        for (const [t, fn] of this._ev) if (t === 'click') fn({ latlng: ll(gl(this.p)), target: this });
      });
    }
    _create(m) {
      if (this.title) this.el.title = this.title;
      return new mapgl.HtmlMarker(m, {
        coordinates: gl(this.p), html: this.el, anchor: this.anchor,
        zIndex: 1000 + (this.o.zIndexOffset || 0), interactive: this.o.interactive !== false,
      });
    }
    _bind() {}
    on(type, fn) { this._ev.push([type, fn, null]); return this; }
    bindTooltip(text) { this.title = text || ''; this.el.title = this.title; return this; }
    setLatLng(p) { this.p = arr(p); if (this.g && this.g.setCoordinates) this.g.setCoordinates(gl(this.p)); else this._rebuild(); return this; }
    getLatLng() { return ll(gl(this.p)); }
  }

  // Кружок с радиусом в пикселях
  class GCircleMarker extends GObj {
    constructor(latlng, o = {}) { super(); this.p = arr(latlng); this.o = o; }
    _create(m) {
      const o = this.o;
      return new mapgl.CircleMarker(m, {
        coordinates: gl(this.p), radius: o.radius || 5,
        color: rgba(o.fillColor || '#5B3DF5', o.fillOpacity ?? 0.9),
        strokeColor: rgba(o.color || '#ffffff', 1), strokeWidth: o.weight ?? 1.5,
        zIndex: 300, interactive: o.interactive !== false,
      });
    }
  }

  // Круг с радиусом в метрах (точность геопозиции)
  class GCircle extends GObj {
    constructor(latlng, o = {}) { super(); this.p = arr(latlng); this.o = o; this.r = o.radius || 10; }
    _create(m) {
      const o = this.o;
      return new mapgl.Circle(m, {
        coordinates: gl(this.p), radius: this.r,
        color: rgba(o.fillColor || '#5B3DF5', o.fillOpacity ?? 0.15),
        strokeColor: rgba(o.color || '#5B3DF5', o.opacity ?? 0.5), strokeWidth: o.weight ?? 1,
        zIndex: 100, interactive: o.interactive !== false,
      });
    }
    setLatLng(p) { this.p = arr(p); this._rebuild(); return this; }
    setRadius(r) { this.r = r; this._rebuild(); return this; }
    getLatLng() { return ll(gl(this.p)); }
  }

  class GPolyline extends GObj {
    constructor(pts, o = {}) { super(); this.pts = pts.map(arr); this.o = o; }
    _create(m) {
      const o = this.o, opt = {
        coordinates: this.pts.map(p => [p[1], p[0]]), width: o.weight || 4,
        color: rgba(o.color || '#5B3DF5', o.opacity ?? 1), zIndex: 200 + (this._z || 0), interactive: false,
      };
      // пунктир как на логотипе: '8 10' - штрих 8, промежуток 10
      if (o.dashArray) { const [d, g] = String(o.dashArray).split(/[ ,]+/).map(Number); opt.dashLength = d || 8; opt.gapLength = g || d || 8; opt.gapColor = '#00000000'; }
      return new mapgl.Polyline(m, opt);
    }
    setLatLngs(pts) { this.pts = pts.map(arr); this._rebuild(); return this; }
  }

  class GGroup {
    constructor() { this.items = new Set(); this._parent = null; }
    addTo(t) { t._add(this); return this; }
    remove() { if (this._parent) this._parent._del(this); return this; }
    _map() { let p = this._parent; while (p && !(p instanceof GMap)) p = p._parent; return p; }
    _mount(m) { for (const o of this.items) o._mount(m); }
    _unmount() { for (const o of this.items) o._unmount(); }
    _add(o) {
      o._parent = this; this.items.add(o);
      if (o instanceof GPolyline) o._z = this.items.size;   // линии, добавленные позже, - сверху (белая подложка под цветной)
      const m = this._map(); if (m) o._mount(m);
    }
    _del(o) { this.items.delete(o); o._unmount(); o._parent = null; }
    clearLayers() { for (const o of this.items) { o._unmount(); o._parent = null; } this.items.clear(); return this; }
    getLayers() { return [...this.items]; }
    hasLayer(o) { return this.items.has(o); }
  }

  /* ---------- Неоновый режим ----------
     Берём стандартный стиль 2ГИС, перекрашиваем его в неоновые цвета и меняем деревья на пальмы.
     Стиль собирается в браузере, поэтому всегда остаётся свежим и не хранится в репозитории. */
  const DGIS_STYLE = 'c080bb6a-8134-4993-93a1-5b4d8c36a59b';
  const ASSETS = 'https://disk.2gis.com/styles/assets/';
  const PALM = 'tree_palm_lush_crown_tall_d', PALM_FAR = 'lodpalmsummercomb';

  function parseColor(s) {
    let m = /^#([0-9a-f]{3,8})$/i.exec(s);
    if (m) {
      let h = m[1]; if (h.length <= 4) h = h.replace(/./g, c => c + c);
      return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16), h.length === 8 ? parseInt(h.slice(6, 8), 16) / 255 : 1];
    }
    m = /^rgba?\(([^)]+)\)$/i.exec(s);
    if (m) { const p = m[1].split(',').map(Number); return [p[0], p[1], p[2], p.length > 3 ? p[3] : 1]; }
    return null;
  }
  function hsl2hex(h, s, l, a) {
    h = ((h % 360) + 360) % 360;
    const k = n => (n + h / 30) % 12, f = n => l - s * Math.min(l, 1 - l) * Math.max(-1, Math.min(k(n) - 3, 9 - k(n), 1));
    const x = v => Math.round(Math.max(0, Math.min(1, v)) * 255).toString(16).padStart(2, '0');
    return '#' + x(f(0)) + x(f(8)) + x(f(4)) + (a < 1 ? x(a) : '');
  }
  // Один цвет обычной карты -> неоновый. Светлые фоны и дома - розово-сиреневые, вода - сине-фиолетовая,
  // парки - бирюзово-зелёные, жёлтые и оранжевые дороги - фиолетовые, тёмный текст - тёмно-фиолетовый.
  function neonColor(str) {
    const c = parseColor(str); if (!c) return str;
    const [r, g, b, a] = c.map((v, i) => i < 3 ? v / 255 : v);
    const max = Math.max(r, g, b), min = Math.min(r, g, b), l = (max + min) / 2, ch = max - min;
    let h = 0;
    if (ch) h = max === r ? 60 * (((g - b) / ch) % 6) : max === g ? 60 * ((b - r) / ch + 2) : 60 * ((r - g) / ch + 4);
    h = (h + 360) % 360;
    if (ch < 0.12) {                                  // серые, белые, бежевые
      if (l > 0.8) return hsl2hex(318 - (l - 0.8) * 60, 0.62, 0.72 + (l - 0.8) * 0.6, a);   // фон и дома: розовые
      if (l > 0.4) return hsl2hex(285, 0.32, l * 0.85, a);                                  // дороги, контуры: сиреневые
      return hsl2hex(268, 0.45, Math.max(l, 0.12), a);                                     // текст: тёмно-фиолетовый
    }
    if (h >= 170 && h < 255) return hsl2hex(238, 0.72, Math.min(0.58, l * 0.8), a);       // вода
    if (h >= 65 && h < 170) return hsl2hex(158, 0.42, l * 0.72, a);                         // парки, леса
    if (h >= 20 && h < 65) return hsl2hex(292, 0.68, Math.min(0.66, Math.max(0.45, l * 0.8)), a); // жёлтые дороги
    return hsl2hex(h < 20 || h >= 330 ? 335 : h, Math.min(1, 0.75), l, a);                // красное и розовое - ярче
  }
  const COLOR_RE = /^(#[0-9a-f]{3,8}|rgba?\([^)]*\))$/i;
  function recolor(v) {
    if (typeof v === 'string') return COLOR_RE.test(v) ? neonColor(v) : v;
    if (Array.isArray(v)) return v.map(recolor);
    if (v && typeof v === 'object') { const o = {}; for (const k in v) o[k] = k === 'modelSrc' || k === 'iconImage' ? v[k] : recolor(v[k]); return o; }
    return v;
  }
  // деревья -> пальмы: каждый слой моделей деревьев рисует пальму (вблизи - подробную, вдали - упрощённую)
  function palms(layers) {
    for (const l of layers) {
      if (l.layers) palms(l.layers);
      if (l.type !== 'model' || !l.style) continue;
      const f = JSON.stringify(l.filter || '') + ' ' + JSON.stringify(l.style.modelSrc || '') + ' ' + (l.name || '');
      if (/palm/i.test(f)) continue;
      if (/tree|pine|berez|sosna|listv|tuya|forest|лес|дерев|bush|porosl/i.test(f))
        l.style.modelSrc = ['step', ['distance'], PALM, 530, PALM_FAR];
    }
  }
  let neonUrl = null;
  async function neonStyleUrl(key) {
    if (neonUrl) return neonUrl;
    const res = await fetch(`https://styles.api.2gis.com/styles/${DGIS_STYLE}?key=${encodeURIComponent(key)}`).then(r => r.json());
    const st = res.result || res;
    st.layers = recolor(st.layers); palms(st.layers);
    if (st.background) st.background = recolor(st.background);
    // небо на горизонте - закат: розовый к оранжевому, дымка - розовая
    st.environment = Object.assign({}, st.environment, {
      skyColor: ['interpolate', ['linear'], ['zoom'], 7, '#2a1450', 8, '#ff7a9c'],
      fogColor: ['interpolate', ['linear'], ['zoom'], 7, '#5b2a8a', 8, '#ffb3c9'],
    });
    neonUrl = URL.createObjectURL(new Blob([JSON.stringify(st)], { type: 'application/json' }));
    return neonUrl;
  }

  /* ---------- Карта ---------- */
  const EV = { click: 'click', moveend: 'moveend', zoomend: 'zoomend' };
  class GMap {
    constructor(id) {
      this.el = typeof id === 'string' ? document.getElementById(id) : id;
      this.el.classList.add('ymap', 'gmap');
      const mobile = window.matchMedia('(max-width:860px)').matches;
      this.m = new mapgl.Map(this.el, {
        key: (window.MESTO_CONFIG || {}).DGIS_KEY,
        center: [37.6173, 55.7558], zoom: 11, minZoom: 3, maxZoom: 19,
        // на телефоне масштаб меняют пальцами - кнопки не нужны
        zoomControl: mobile ? false : 'bottomLeft',
        disableRotationByUserInteraction: true, disablePitchByUserInteraction: true,
        lang: 'ru',
      });
      this._world();
      this.items = new Set(); this._ev = [];
      this.zoomControl = { setPosition() {} };
      if (window.ResizeObserver) new ResizeObserver(() => this.m.invalidateSize()).observe(this.el);
      // Щипок двумя пальцами должен масштабировать карту, а не всю страницу (иначе в Telegram и Safari
      // после зума страница остаётся увеличенной и метки становятся огромными)
      const stop = e => e.preventDefault();
      ['gesturestart', 'gesturechange', 'gestureend'].forEach(t => this.el.addEventListener(t, stop));
      this.el.addEventListener('touchmove', e => { if (e.touches.length > 1) e.preventDefault(); }, { passive: false });
    }
    _add(o) { o._parent = this; this.items.add(o); o._mount(this); }
    _del(o) { this.items.delete(o); o._unmount(); o._parent = null; }
    hasLayer(o) { return this.items.has(o); }
    _anim(o) { return { duration: o && o.animate === false ? 0 : 250 }; }
    setView(c, z, o = {}) {
      const a = this._anim(o);
      this.m.setCenter(gl(c), a);
      if (z != null && z !== this.m.getZoom()) this.m.setZoom(z, a);
      return this;
    }
    panTo(c) { this.m.setCenter(gl(c), { duration: 250 }); return this; }
    getZoom() { return this.m.getZoom(); }
    setZoom(z) { this.m.setZoom(z, { duration: 200 }); return this; }
    getCenter() { return ll(this.m.getCenter()); }
    getBounds() {
      const b = this.m.getBounds(), r = new GBounds();
      r.extend(ll(b.southWest)); r.extend(ll(b.northEast));
      return r;
    }
    getSize() { return { x: this.el.clientWidth, y: this.el.clientHeight }; }
    getContainer() { return this.el; }
    invalidateSize() { this.m.invalidateSize(); return this; }
    // ширина мира в пикселях при текущем зуме; меряем, пока карта не наклонена (с наклоном границы искажены)
    _world() {
      const W = Math.max(this.el.clientWidth, 100), cur = this.m.getZoom();
      try {
        if (this.m.getPitch() < 1 && this.el.clientWidth > 50) {
          const bnd = this.m.getBounds(), span = Math.abs(bnd.northEast[0] - bnd.southWest[0]);
          if (span > 0 && span < 360) this._c = W / (span / 360) / Math.pow(2, cur);
        }
      } catch (e) { /* карта ещё не готова */ }
      return (this._c || 512) * Math.pow(2, cur);
    }
    // Неоновый город: свой стиль, пальмы и наклон карты. Возвращает Promise
    async setNeon(on) {
      this._world();
      const a = { duration: 400 };
      if (on) {
        const url = await neonStyleUrl((window.MESTO_CONFIG || {}).DGIS_KEY);
        await this.m.setStyleFromUrl(url, { stylePath: '', iconsPath: ASSETS + 'icons', fontsPath: 'https://mapgl.2gis.com/api/fonts', modelsPath: ASSETS + 'models' });
        this.m.setPitch(40, a);
      } else {
        await this.m.setStyleById(DGIS_STYLE);
        this.m.setPitch(0, a);
      }
      this.el.classList.toggle('neonmap', !!on);
      return on;
    }
    // Масштаб считаем сами по проекции Меркатора: так результат не зависит от тонкостей fitBounds в API
    fitBounds(b, o = {}) {
      if (!(b instanceof GBounds)) b = new GBounds(b);
      if (!b.isValid()) return this;
      const max = o.maxZoom || 18;
      if (b.s === b.n && b.w === b.e) return this.setView([b.s, b.w], Math.min(max, 15), o);
      const y = lat => { const s = Math.sin(lat * Math.PI / 180); return Math.log((1 + s) / (1 - s)) / 2; };
      const W = Math.max(this.el.clientWidth, 100), H = Math.max(this.el.clientHeight, 100);
      const cur = this.m.getZoom(), worldNow = this._world();
      const fx = (b.e - b.w) / 360, fy = Math.abs(y(b.n) - y(b.s)) / (2 * Math.PI);
      const k = Math.min(W / (fx * worldNow || 1e-9), H / (fy * worldNow || 1e-9));
      const z = Math.max(3, Math.min(max, cur + Math.log2(k)));
      const cy = (y(b.n) + y(b.s)) / 2, clat = Math.atan(Math.sinh(cy)) * 180 / Math.PI;
      return this.setView([clat, (b.w + b.e) / 2], z, o);
    }
    on(type, fn) {
      const t = EV[type]; if (!t) return this;
      const h = type === 'click'
        ? e => { const at = Date.now(), lat = e.lngLat; setTimeout(() => { if (Math.abs(objClickAt - at) > 350) fn({ latlng: ll(lat) }); }, 0); }
        : () => fn({});
      this._ev.push([type, fn, h]); this.m.on(t, h); return this;
    }
    once(type, fn) { const w = e => { this.off(type, w); fn(e); }; w._orig = fn; return this.on(type, w); }
    off(type, fn) {
      this._ev = this._ev.filter(([t, f, h]) => {
        if (t === type && (!fn || f === fn || f._orig === fn)) { this.m.off(EV[t], h); return false; }
        return true;
      });
      return this;
    }
  }

  window.GL2 = {
    dgis: true,
    map: (id, o) => new GMap(id, o),
    tileLayer: () => ({ addTo() { return this; } }),
    canvas: () => ({}),
    divIcon: o => o,
    marker: (p, o) => new GMarker(p, o),
    circleMarker: (p, o) => new GCircleMarker(p, o),
    circle: (p, o) => new GCircle(p, o),
    polyline: (p, o) => new GPolyline(p, o),
    layerGroup: () => new GGroup(),
    latLngBounds: p => new GBounds(p),
    latLng: (a, b) => ({ lat: a, lng: b }),
  };
})();

/* Загрузка 2ГИС. Ключ - в config.js (DGIS_KEY). Нет ключа или ошибка - остаёмся на Leaflet (OpenStreetMap). */
window.MAP_READY = new Promise(res => {
  const key = (window.MESTO_CONFIG || {}).DGIS_KEY;
  const forced = new URLSearchParams(location.search).get('map');   // ?map=osm - принудительно старая карта
  if (!key || forced === 'osm') return res('leaflet');
  const s = document.createElement('script');
  s.src = 'https://mapgl.2gis.com/api/js/v1';
  const t = setTimeout(() => res('leaflet'), 9000);
  s.onload = () => { clearTimeout(t); res(window.mapgl ? '2gis' : 'leaflet'); };
  s.onerror = () => { clearTimeout(t); res('leaflet'); };
  document.head.appendChild(s);
});
