/* «Место вместе» — карта на Яндекс Картах (JS API 2.1).
   Прослойка повторяет те функции Leaflet, которыми пользуется сайт (L.map, L.marker, L.polyline…),
   поэтому остальной код не меняется. Если Яндекс не загрузится — сайт работает на прежней карте (Leaflet). */
'use strict';

(function () {
  const arr = x => (Array.isArray(x) ? x : [x.lat, x.lng]);
  const ll = a => ({ lat: a[0], lng: a[1] });
  let lastMap = null;

  /* ---------- Границы ---------- */
  class YBounds {
    constructor(pts) {
      this.s = Infinity; this.w = Infinity; this.n = -Infinity; this.e = -Infinity;
      for (const p of pts || []) this.extend(p);
    }
    extend(p) { const [a, b] = arr(p); this.s = Math.min(this.s, a); this.n = Math.max(this.n, a); this.w = Math.min(this.w, b); this.e = Math.max(this.e, b); return this; }
    pad(r) { const dy = (this.n - this.s) * r, dx = (this.e - this.w) * r; const b = new YBounds(); b.s = this.s - dy; b.n = this.n + dy; b.w = this.w - dx; b.e = this.e + dx; return b; }
    contains(p) { const [a, b] = arr(p); return a >= this.s && a <= this.n && b >= this.w && b <= this.e; }
    isValid() { return isFinite(this.s); }
    toArr() { return [[this.s, this.w], [this.n, this.e]]; }
    toBBoxString() { return [this.w, this.s, this.e, this.n].join(','); }
  }

  /* ---------- Слои ---------- */
  const layoutCache = new Map();
  function htmlLayout(html, w, h, ax, ay) {
    const key = html + '|' + w + '|' + h + '|' + ax + '|' + ay;
    let L = layoutCache.get(key);
    if (!L) {
      // фигурные скобки — служебные для шаблонов Яндекса, экранируем
      const safe = html.replace(/\{/g, '&#123;').replace(/\}/g, '&#125;');
      L = ymaps.templateLayoutFactory.createClass(
        `<div class="ymk" style="position:absolute;left:${-ax}px;top:${-ay}px;width:${w}px;height:${h}px">${safe}</div>`);
      layoutCache.set(key, L);
      if (layoutCache.size > 400) layoutCache.delete(layoutCache.keys().next().value);
    }
    return L;
  }

  class YObj {
    constructor() { this._parent = null; this._ev = []; }
    addTo(t) { t._add(this); return this; }
    remove() { if (this._parent) this._parent._del(this); return this; }
    on(type, fn) {
      const h = e => fn({ latlng: e && e.get && e.get('coords') ? ll(e.get('coords')) : null, target: this });
      this._ev.push([type, fn, h]); this.g.events.add(type, h); return this;
    }
    bindTooltip(text) { this.g.properties.set('hintContent', text); return this; }
  }

  class YMarker extends YObj {
    constructor(latlng, o = {}) {
      super();
      const ic = o.icon || { html: '<div class="ydot"></div>', iconSize: [16, 16], iconAnchor: [8, 8] };
      const [w, h] = ic.iconSize || [24, 24], [ax, ay] = ic.iconAnchor || [w / 2, h / 2];
      this.g = new ymaps.Placemark(arr(latlng), { hintContent: o.title || '' }, {
        iconLayout: htmlLayout(ic.html || '', w, h, ax, ay),
        iconShape: { type: 'Rectangle', coordinates: [[-ax, -ay], [w - ax, h - ay]] },
        zIndex: 600 + (o.zIndexOffset || 0) / 10, zIndexHover: 900,
        hasBalloon: false, openHintOnHover: !!o.title,
        interactivityModel: o.interactive === false ? 'default#transparent' : 'default#geoObject',
        cursor: o.interactive === false ? 'default' : 'pointer',
      });
    }
    setLatLng(p) { this.g.geometry.setCoordinates(arr(p)); return this; }
    getLatLng() { return ll(this.g.geometry.getCoordinates()); }
  }

  // Кружок нужного радиуса в пикселях: ymaps.Circle меряет в метрах — пересчитываем по зуму
  class YCircleMarker extends YObj {
    constructor(latlng, o = {}) {
      super();
      const c = arr(latlng), z = lastMap ? lastMap.getZoom() : 12;
      const mpp = 156543.03 * Math.cos(c[0] * Math.PI / 180) / Math.pow(2, z);
      this.g = new ymaps.Circle([c, (o.radius || 5) * mpp], {}, {
        fillColor: o.fillColor || '#5B3DF5', fillOpacity: o.fillOpacity ?? 0.9,
        strokeColor: o.color || '#ffffff', strokeWidth: o.weight ?? 1.5, strokeOpacity: 1,
        zIndex: 300, cursor: 'pointer', hasBalloon: false,
      });
    }
  }

  // Круг с радиусом в метрах (точность геопозиции)
  class YCircle extends YObj {
    constructor(latlng, o = {}) {
      super(); this.r = o.radius || 10;
      this.g = new ymaps.Circle([arr(latlng), this.r], {}, {
        fillColor: o.fillColor || '#5B3DF5', fillOpacity: o.fillOpacity ?? 0.15,
        strokeColor: o.color || '#5B3DF5', strokeWidth: o.weight ?? 1, strokeOpacity: o.opacity ?? 0.5,
        zIndex: 100, hasBalloon: false, hasHint: false,
        interactivityModel: o.interactive === false ? 'default#transparent' : 'default#geoObject',
      });
    }
    setLatLng(p) { this.g.geometry.setCoordinates(arr(p)); return this; }
    setRadius(r) { this.r = r; this.g.geometry.setRadius(r); return this; }
    getLatLng() { return ll(this.g.geometry.getCoordinates()); }
  }

  class YPolyline extends YObj {
    constructor(pts, o = {}) {
      super();
      this.g = new ymaps.Polyline(pts.map(arr), {}, {
        strokeColor: o.color || '#5B3DF5', strokeWidth: o.weight || 4, strokeOpacity: o.opacity ?? 1,
        strokeStyle: o.dashArray ? 'dot' : 'solid', zIndex: 200, interactivityModel: 'default#transparent',
      });
    }
    setLatLngs(pts) { this.g.geometry.setCoordinates(pts.map(arr)); return this; }
  }

  class YGroup {
    constructor() { this.g = new ymaps.GeoObjectCollection(); this.items = new Set(); this._parent = null; }
    addTo(t) { t._add(this); return this; }
    remove() { if (this._parent) this._parent._del(this); return this; }
    _add(o) { o._parent = this; this.items.add(o); this.g.add(o.g); }
    _del(o) { this.items.delete(o); this.g.remove(o.g); o._parent = null; }
    clearLayers() { for (const o of this.items) o._parent = null; this.items.clear(); this.g.removeAll(); return this; }
    getLayers() { return [...this.items]; }
    hasLayer(o) { return this.items.has(o); }
  }

  /* ---------- Карта ---------- */
  const EV = { click: 'click', moveend: 'boundschange', zoomend: 'boundschange' };
  class YMap {
    constructor(id) {
      this.el = typeof id === 'string' ? document.getElementById(id) : id;
      this.el.classList.add('ymap');
      this.m = new ymaps.Map(this.el, { center: [55.7558, 37.6173], zoom: 11, controls: [] }, {
        minZoom: 3, maxZoom: 19, avoidFractionalZoom: true, yandexMapDisablePoiInteractivity: true,
      });
      // на телефоне масштаб меняют пальцами — кнопки не нужны (как и раньше)
      if (!window.matchMedia('(max-width:860px)').matches)
        this.m.controls.add(new ymaps.control.ZoomControl({ options: { size: 'small', position: { left: 14, bottom: 38 } } }));
      this.items = new Set(); this._ev = []; lastMap = this;
      this.zoomControl = { setPosition() {} };
      // при смене размера окна/панелей карта сама подстраивается
      if (window.ResizeObserver) new ResizeObserver(() => this.m.container.fitToViewport()).observe(this.el);
    }
    _add(o) { o._parent = this; this.items.add(o); this.m.geoObjects.add(o.g); }
    _del(o) { this.items.delete(o); this.m.geoObjects.remove(o.g); o._parent = null; }
    hasLayer(o) { return this.items.has(o); }
    setView(c, z, o = {}) { this.m.setCenter(arr(c), z ?? this.m.getZoom(), { duration: o.animate === false ? 0 : 250 }); return this; }
    panTo(c) { this.m.panTo(arr(c), { duration: 250 }); return this; }
    getZoom() { return this.m.getZoom(); }
    setZoom(z) { this.m.setZoom(z, { duration: 200 }); return this; }
    getCenter() { return ll(this.m.getCenter()); }
    getBounds() { return new YBounds(this.m.getBounds()); }
    getSize() { const s = this.m.container.getSize(); return { x: s[0], y: s[1] }; }
    getContainer() { return this.el; }
    invalidateSize() { this.m.container.fitToViewport(); return this; }
    fitBounds(b, o = {}) {
      if (!(b instanceof YBounds)) b = new YBounds(b);
      if (!b.isValid()) return this;
      if (b.s === b.n && b.w === b.e) return this.setView([b.s, b.w], o.maxZoom || 15, o);
      const max = o.maxZoom || 18;
      this.m.setBounds(b.toArr(), { checkZoomRange: true, duration: o.animate === false ? 0 : 250 }).then(() => {
        if (this.m.getZoom() > max) this.m.setZoom(max);
      });
      return this;
    }
    on(type, fn) {
      const yt = EV[type]; if (!yt) return this;
      const h = type === 'click' ? e => fn({ latlng: ll(e.get('coords')) })
        : type === 'zoomend' ? e => { if (e.get('newZoom') !== e.get('oldZoom')) fn({}); }
        : () => fn({});
      this._ev.push([type, fn, h]); this.m.events.add(yt, h); return this;
    }
    once(type, fn) { const w = e => { this.off(type, w); fn(e); }; w._orig = fn; return this.on(type, w); }
    off(type, fn) {
      this._ev = this._ev.filter(([t, f, h]) => {
        if (t === type && (!fn || f === fn || f._orig === fn)) { this.m.events.remove(EV[t], h); return false; }
        return true;
      });
      return this;
    }
  }

  window.YL = {
    yandex: true,
    map: (id, o) => new YMap(id, o),
    tileLayer: () => ({ addTo() { return this; } }),
    canvas: () => ({}),
    divIcon: o => o,
    marker: (p, o) => new YMarker(p, o),
    circleMarker: (p, o) => new YCircleMarker(p, o),
    circle: (p, o) => new YCircle(p, o),
    polyline: (p, o) => new YPolyline(p, o),
    layerGroup: () => new YGroup(),
    latLngBounds: p => new YBounds(p),
    latLng: (a, b) => ({ lat: a, lng: b }),
  };
})();

/* Загрузка Яндекс Карт. Ключ — в config.js (YMAPS_KEY). Нет ключа или ошибка — остаёмся на Leaflet. */
window.MAP_READY = new Promise(res => {
  const key = (window.MESTO_CONFIG || {}).YMAPS_KEY;
  const forced = new URLSearchParams(location.search).get('map');   // ?map=osm — принудительно старая карта
  if (!key || forced === 'osm') return res('leaflet');
  const s = document.createElement('script');
  s.src = 'https://api-maps.yandex.ru/2.1/?lang=ru_RU&apikey=' + encodeURIComponent(key);
  const t = setTimeout(() => res('leaflet'), 9000);
  s.onload = () => { if (!window.ymaps) { clearTimeout(t); return res('leaflet'); } ymaps.ready(() => { clearTimeout(t); res('yandex'); }, () => { clearTimeout(t); res('leaflet'); }); };
  s.onerror = () => { clearTimeout(t); res('leaflet'); };
  document.head.appendChild(s);
});
