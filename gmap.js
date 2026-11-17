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
      this.items = new Set(); this._ev = [];
      this.zoomControl = { setPosition() {} };
      if (window.ResizeObserver) new ResizeObserver(() => this.m.invalidateSize()).observe(this.el);
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
    // Масштаб считаем сами по проекции Меркатора: так результат не зависит от тонкостей fitBounds в API
    fitBounds(b, o = {}) {
      if (!(b instanceof GBounds)) b = new GBounds(b);
      if (!b.isValid()) return this;
      const max = o.maxZoom || 18;
      if (b.s === b.n && b.w === b.e) return this.setView([b.s, b.w], Math.min(max, 15), o);
      const y = lat => { const s = Math.sin(lat * Math.PI / 180); return Math.log((1 + s) / (1 - s)) / 2; };
      const W = Math.max(this.el.clientWidth, 100), H = Math.max(this.el.clientHeight, 100);
      // ширина мира в пикселях при текущем зуме - по двум точкам экрана
      const cur = this.m.getZoom(), bnd = this.m.getBounds();
      const spanLng = Math.abs(bnd.northEast[0] - bnd.southWest[0]) || 1e-6;
      const worldNow = W / (spanLng / 360);
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
