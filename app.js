/* Territorios Alameda — mapa + programa (offline-first) */
const DIAS = ['domingo', 'lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado'];
const DIAS_C = ['DOM', 'LUN', 'MAR', 'MIÉ', 'JUE', 'VIE', 'SÁB'];
const MESES = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio',
  'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];

let PROG = null, TERR = null, ENV = null, CALLES = null, BOUNDS = null;
let map, capaPlano, capaMapa, capaTerr, capaDibujo, marcadorGps, marcadorPunto, circuloGps;
let dibujo = false;   // la vista que imita el plano, sin fondo
let diaSel = 1, actSel = null, terrSel = null;
let estadoLista = 'abierto';   // 'abierto' | 'oculto'
// cómo se marca el territorio: 'borde' lo envuelve entero, 'manzanas' pinta
// cada cuadra por separado
let modoTerr = 'borde';
let ocultoPorFicha = false;    // para devolverlo al cerrar la ficha
const capasTerr = {};

const $ = s => document.querySelector(s);
const el = (t, c, h) => { const n = document.createElement(t); if (c) n.className = c; if (h != null) n.innerHTML = h; return n; };

/* ---------- estado guardado (localStorage) ---------- */
const KEY = 'alameda_trabajados';
const KEY_TERR = 'alameda_modo_territorio';
const KEY_BASE = 'alameda_mapa_base';

/* mapas de calles disponibles. maxNativeZoom es hasta dónde tiene teselas
   cada uno: más allá Leaflet amplía la última en vez de dejar hueco */
const MAPAS = {
  osm: { nombre: 'OSM', maxNativeZoom: 19,
    url: 'https://tile.openstreetmap.org/{z}/{x}/{y}.png',
    attribution: '&copy; OpenStreetMap' },
  gris: { nombre: 'Gris', maxNativeZoom: 16,
    url: 'https://server.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Light_Gray_Base/MapServer/tile/{z}/{y}/{x}',
    attribution: '&copy; Esri' },
  calles: { nombre: 'Calles', maxNativeZoom: 19,
    url: 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Street_Map/MapServer/tile/{z}/{y}/{x}',
    attribution: '&copy; Esri' },
  // CARTO exige clave en las teselas raster: sin ella las marca con una
  // filigrana. Queda a la vista en el código, que es público; para limitarla
  // hay que restringirla al dominio desde el panel de CARTO.
  carto: { nombre: 'CARTO', maxNativeZoom: 20,
    url: 'https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png'
       + '?key=cb1_3ipr_1_3c531422306febfa3ff2e9d3',
    attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
               + ', &copy; <a href="https://carto.com/attributions">CARTO</a>' }
};
let mapaBase = 'osm';
function trabajados() {
  try { return JSON.parse(localStorage.getItem(KEY) || '{}'); } catch (e) { return {}; }
}
function claveMes() { return PROG ? PROG.anio + '-' + PROG.mes : 'x'; }
function estaTrabajado(t) { const d = trabajados()[claveMes()] || []; return d.includes(t); }
function alternarTrabajado(t) {
  const all = trabajados(); const k = claveMes();
  const arr = new Set(all[k] || []);
  arr.has(t) ? arr.delete(t) : arr.add(t);
  all[k] = [...arr];
  try { localStorage.setItem(KEY, JSON.stringify(all)); } catch (e) {}
  pintarTerritorios();
}

/* ---------- carga ---------- */
async function cargar() {
  const [p, t, e, c, b] = await Promise.all([
    fetch('programa.json').then(r => r.json()),
    fetch('territorios.geojson').then(r => r.json()),
    fetch('envolventes.geojson').then(r => r.json()).catch(() => null),
    fetch('calles.geojson').then(r => r.json()).catch(() => null),
    fetch('plano_bounds.json').then(r => r.json())
  ]);
  PROG = p; TERR = t; ENV = e; CALLES = c; BOUNDS = b;
  try { modoTerr = localStorage.getItem(KEY_TERR) || 'borde'; } catch (err) {}
  if (!ENV) modoTerr = 'manzanas';
  $('#mestitulo').textContent = 'Programa de ' + MESES[PROG.mes - 1] + ' ' + PROG.anio;
  iniciarMapa();
  const hoy = new Date();
  diaSel = (hoy.getFullYear() === PROG.anio && hoy.getMonth() + 1 === PROG.mes)
    ? hoy.getDate() : 1;
  render('semana');
}

/* ---------- mapa ---------- */
function iniciarMapa() {
  const [[la0, lo0], [la1, lo1]] = BOUNDS.bounds;
  const lim = L.latLngBounds([la0, lo0], [la1, lo1]);
  map = L.map('map', {
    zoomControl: false, attributionControl: true, zoomSnap: 0.25, zoomDelta: 0.5,
    maxBounds: lim.pad(0.35), maxBoundsViscosity: 0.7
  });
  map.attributionControl.setPrefix('');

  try { mapaBase = localStorage.getItem(KEY_BASE) || 'osm'; } catch (e) {}
  if (!MAPAS[mapaBase]) mapaBase = 'osm';
  ponerMapaBase(mapaBase);
  capaPlano = L.imageOverlay('plano.webp', lim, { opacity: 1, className: 'plano' });

  capaPlano.addTo(map);
  map.fitBounds(lim, { padding: [6, 6] });

  construirTerritorios();
  construirCalles();

  document.querySelectorAll('.layerbar button').forEach(b => {
    b.onclick = () => {
      document.querySelectorAll('.layerbar button').forEach(x => x.classList.toggle('on', x === b));
      const m = b.dataset.layer;
      if (m === 'plano') { anadir(capaPlano); quitar(capaMapa); capaPlano.setOpacity(1); }
      if (m === 'mapa') { quitar(capaPlano); anadir(capaMapa); }
      if (m === 'ambos') { anadir(capaMapa); anadir(capaPlano); capaPlano.setOpacity(0.55); }
      if (m === 'dibujo') { quitar(capaPlano); quitar(capaMapa); }
      dibujo = (m === 'dibujo');
      document.body.classList.toggle('dibujo', dibujo);
      if (capaDibujo) { if (dibujo) { anadir(capaDibujo); colocarRotulos(); } else quitar(capaDibujo); }
      actualizarBarraBase();
      pintarTerritorios();
    };
  });
  document.querySelectorAll('.basebar button').forEach(b => {
    b.classList.toggle('on', b.dataset.base === mapaBase);
    b.onclick = () => {
      mapaBase = b.dataset.base;
      try { localStorage.setItem(KEY_BASE, mapaBase); } catch (e) {}
      document.querySelectorAll('.basebar button')
        .forEach(x => x.classList.toggle('on', x === b));
      ponerMapaBase(mapaBase);
    };
  });
  document.querySelectorAll('.terrbar button').forEach(b => {
    b.classList.toggle('on', b.dataset.terr === modoTerr);
    b.onclick = () => {
      modoTerr = b.dataset.terr;
      try { localStorage.setItem(KEY_TERR, modoTerr); } catch (e) {}
      document.querySelectorAll('.terrbar button')
        .forEach(x => x.classList.toggle('on', x === b));
      construirTerritorios();
    };
  });
  if (!ENV) { const tb = document.querySelector('.terrbar'); if (tb) tb.style.display = 'none'; }
  $('#fabGps').onclick = ubicar;
  $('#fabFit').onclick = () => { map.fitBounds(lim, { padding: [6, 6] }); limpiarSeleccion(); };
}
/* (re)dibuja la capa de territorios según el modo elegido */
function construirTerritorios() {
  if (capaTerr) map.removeLayer(capaTerr);
  for (const k in capasTerr) delete capasTerr[k];
  const datos = modoTerr === 'borde' && ENV ? ENV : TERR;
  capaTerr = L.geoJSON(datos, {
    style: estiloTerr,
    onEachFeature: (f, capa) => {
      capasTerr[f.properties.n] = capa;
      capa.on('click', () => seleccionarTerritorio(f.properties.n, false));
    }
  }).addTo(map);
  pintarTerritorios();
}

/* cambia el mapa de calles conservando si estaba visible o no */
function ponerMapaBase(clave) {
  const cfg = MAPAS[clave];
  const visible = capaMapa ? map.hasLayer(capaMapa) : false;
  if (capaMapa) map.removeLayer(capaMapa);
  capaMapa = L.tileLayer(cfg.url, {
    maxZoom: 20, minZoom: 13, maxNativeZoom: cfg.maxNativeZoom,
    attribution: cfg.attribution
  });
  if (visible) { capaMapa.addTo(map); if (capaPlano) capaPlano.bringToFront(); }
  if (capaTerr) capaTerr.bringToFront();
  actualizarBarraBase();
}

/* la barra del mapa base solo tiene sentido con el mapa de calles a la vista */
function actualizarBarraBase() {
  const b = document.querySelector('.basebar');
  if (b) b.classList.toggle('oculta', !(capaMapa && map.hasLayer(capaMapa)));
}

/* los nombres de las calles, escritos a lo largo de cada tramo */
function construirCalles() {
  if (capaDibujo) { map.removeLayer(capaDibujo); capaDibujo = null; }
  if (!CALLES) return;
  const marcas = [];
  for (const f of CALLES.features) {
    const pts = f.geometry.coordinates;
    if (pts.length < 2) continue;
    const m = L.marker([pts[0][1], pts[0][0]], {
      interactive: false, keyboard: false,
      icon: L.divIcon({ className: '', iconSize: [0, 0],
        html: `<div class="rotulo">${f.properties.nombre}</div>` })
    });
    m.pts = pts;                       // la calle entera, para recortarla al vuelo
    m.largo = f.properties.m || 0;
    marcas.push(m);
  }
  capaDibujo = L.layerGroup(marcas);
  if (dibujo) capaDibujo.addTo(map);
  for (const ev of ['zoomend', 'moveend', 'resize'])
    map.off(ev, colocarRotulos).on(ev, colocarRotulos);
  colocarRotulos();
}

/* Cada nombre se escribe sobre el trozo de calle que se está viendo, no al
   medio de la calle entera: si no, una calle que cruza la pantalla de lado a
   lado se queda sin nombre porque su medio quedó fuera de la vista. Se parte
   del medio de lo visible y se corre a lo largo de la calle hasta que el
   nombre cabe entero y no queda debajo de las barras de botones. Se recalcula
   con cada movimiento del mapa. */
const MARGEN_ROTULO = 4;    // px de aire contra el borde de la pantalla
const TRAMO_MINIMO = 12;    // px de calle a la vista: menos que eso no se rotula
const PASO_ROTULO = 8;      // cada cuántos px se prueba correr el nombre

/* recorta un segmento contra el rectángulo visible (Liang-Barsky) */
function recortarSegmento(a, b, c) {
  const dx = b.x - a.x, dy = b.y - a.y;
  const p = [-dx, dx, -dy, dy];
  const q = [a.x - c.x0, c.x1 - a.x, a.y - c.y0, c.y1 - a.y];
  let t0 = 0, t1 = 1;
  for (let k = 0; k < 4; k++) {
    if (p[k] === 0) { if (q[k] < 0) return null; continue; }
    const r = q[k] / p[k];
    if (p[k] < 0) { if (r > t1) return null; if (r > t0) t0 = r; }
    else { if (r < t0) return null; if (r < t1) t1 = r; }
  }
  return [{ x: a.x + t0 * dx, y: a.y + t0 * dy },
          { x: a.x + t1 * dx, y: a.y + t1 * dy }];
}

/* el trozo continuo más largo de la calle que cae dentro de la vista */
function tramoVisible(px, c) {
  let mejor = null, mejorL = 0, actual = null, largo = 0;
  for (let i = 0; i < px.length - 1; i++) {
    const r = recortarSegmento(px[i], px[i + 1], c);
    if (!r) { actual = null; largo = 0; continue; }
    const u = actual && actual[actual.length - 1];
    if (u && Math.abs(u.x - r[0].x) < 0.5 && Math.abs(u.y - r[0].y) < 0.5) actual.push(r[1]);
    else { actual = [r[0], r[1]]; largo = 0; }
    largo += Math.hypot(r[1].x - r[0].x, r[1].y - r[0].y);
    if (largo > mejorL) { mejorL = largo; mejor = actual; }
  }
  return mejor && mejorL >= TRAMO_MINIMO ? { pts: mejor, largo: mejorL } : null;
}

/* el punto que está a `d` píxeles del comienzo del tramo, y hacia dónde va */
function puntoEn(v, d) {
  let anda = 0, i = 0, l = 0;
  for (; i < v.pts.length - 2; i++) {
    l = Math.hypot(v.pts[i + 1].x - v.pts[i].x, v.pts[i + 1].y - v.pts[i].y);
    if (anda + l >= d) break;
    anda += l;
  }
  const a = v.pts[i], b = v.pts[i + 1];
  l = Math.hypot(b.x - a.x, b.y - a.y);
  const f = l > 0 ? Math.min(Math.max((d - anda) / l, 0), 1) : 0.5;
  let ang = Math.atan2(b.y - a.y, b.x - a.x) * 180 / Math.PI;
  if (ang > 90) ang -= 180; else if (ang < -90) ang += 180;
  return { x: a.x + (b.x - a.x) * f, y: a.y + (b.y - a.y) * f, ang };
}

/* dónde escribir el nombre: lo más cerca posible del medio de lo visible, pero
   sin salirse de la pantalla, sin pisar otro nombre y sin caer bajo las barras.
   Se prueba en ese orden de prioridad: antes que dejar la calle sin nombre,
   vale escribirlo debajo de una barra. */
function puntoRotulo(v, w, h, c, puestos, barras) {
  const n = Math.floor(v.largo / 2 / PASO_ROTULO);
  const choca = (p, dx, dy, rs) => rs.some(r => p.x + dx > r.x0 && p.x - dx < r.x1 &&
                                                p.y + dy > r.y0 && p.y - dy < r.y1);
  for (const evitar of [puestos.concat(barras), puestos, []]) {
    for (let k = 0; k <= n; k++) {
      for (const lado of (k ? [-1, 1] : [0])) {
        const p = puntoEn(v, v.largo / 2 + lado * k * PASO_ROTULO);
        // la caja que ocupa el nombre ya girado
        const rad = p.ang * Math.PI / 180;
        const dx = (Math.abs(w * Math.cos(rad)) + Math.abs(h * Math.sin(rad))) / 2;
        const dy = (Math.abs(w * Math.sin(rad)) + Math.abs(h * Math.cos(rad))) / 2;
        if (p.x - dx < c.x0 || p.x + dx > c.x1 || p.y - dy < c.y0 || p.y + dy > c.y1) continue;
        if (choca(p, dx, dy, evitar)) continue;
        return { x: p.x, y: p.y, ang: p.ang,
                 caja: { x0: p.x - dx, y0: p.y - dy, x1: p.x + dx, y1: p.y + dy } };
      }
    }
  }
  return null;
}

/* lo que tapa el mapa por encima: las barras y los botones redondos */
function zonasTapadas() {
  const c = map.getContainer().getBoundingClientRect();
  return [...document.querySelectorAll('.layerbar, .fabs')]
    .filter(e => e.offsetParent)
    .map(e => { const r = e.getBoundingClientRect();
      return { x0: r.left - c.left, y0: r.top - c.top,
               x1: r.right - c.left, y1: r.bottom - c.top }; });
}

function colocarRotulos() {
  if (!capaDibujo || !map.hasLayer(capaDibujo)) return;
  // alejado solo se escriben las calles largas, o no se lee nada
  const z = map.getZoom();
  const minimo = z >= 17 ? 0 : z >= 16 ? 220 : z >= 15 ? 450 : 900;
  const t = map.getSize(), m0 = MARGEN_ROTULO;
  const caja = { x0: m0, y0: m0, x1: t.x - m0, y1: t.y - m0 };
  const barras = zonasTapadas();
  const pendientes = [];
  capaDibujo.eachLayer(m => {
    if (!m._icon) return;
    const v = m.largo >= minimo &&
      tramoVisible(m.pts.map(p => map.latLngToContainerPoint([p[1], p[0]])), caja);
    if (!v) { m._icon.style.display = 'none'; return; }
    m._icon.style.display = '';            // visible para poder medirlo
    pendientes.push([m, v]);
  });
  // una calle puede venir partida en varios tramos con el mismo nombre: se
  // escribe una sola vez, sobre el trozo que más se ve
  const mejor = new Map();
  for (const p of pendientes) {
    const n = p[0]._icon.firstElementChild.textContent;
    if (!mejor.has(n) || p[1].largo > mejor.get(n)[1].largo) mejor.set(n, p);
  }
  for (const p of pendientes)
    if (mejor.get(p[0]._icon.firstElementChild.textContent) !== p) p[0]._icon.style.display = 'none';
  // las calles largas eligen primero: son las que más orientan
  const orden = [...mejor.values()].sort((a, b) => b[0].largo - a[0].largo);
  const puestos = [];
  for (const [m, v] of orden) {
    const rot = m._icon.firstElementChild;
    if (!m.ancho) { m.ancho = rot.offsetWidth; m.alto = rot.offsetHeight; }
    const p = puntoRotulo(v, m.ancho, m.alto, caja, puestos, barras);
    if (!p) { m._icon.style.display = 'none'; continue; }
    puestos.push(p.caja);
    m.setLatLng(map.containerPointToLatLng(L.point(p.x, p.y)));
    rot.style.transform = `translate(-50%,-50%) rotate(${p.ang}deg)`;
  }
}

const anadir = c => { if (!map.hasLayer(c)) c.addTo(map); };
const quitar = c => { if (map.hasLayer(c)) map.removeLayer(c); };

function estiloTerr(f) {
  const n = f.properties.n;
  const soloPlano = map && map.hasLayer(capaPlano) && !map.hasLayer(capaMapa);
  const sel = terrSel === n;
  const hoy = territoriosDelDia().includes(n);
  const hecho = estaTrabajado(n);
  if (dibujo) {
    // imita el plano: cada territorio con su color, sin fondo debajo
    return { color: sel ? '#c62828' : '#ffffff', weight: sel ? 3 : 1, opacity: 1,
             fillColor: f.properties.color, fillOpacity: 1 };
  }
  return {
    color: sel ? '#c62828' : (hoy ? '#1d3b5c' : (hecho ? '#2f7d5b' : '#33414f')),
    weight: sel ? 3 : (hoy ? 2 : 0.8),
    opacity: sel || hoy ? 0.95 : 0.5,
    fillColor: hecho ? '#2f7d5b' : f.properties.color,
    fillOpacity: soloPlano ? (sel ? 0.35 : (hoy ? 0.22 : 0.02)) : (sel ? 0.62 : (hoy ? 0.55 : 0.42)),
    dashArray: hecho && !sel ? '4,3' : null
  };
}
let capaEtiquetas = null;
function pintarTerritorios() {
  if (!capaTerr) return;
  capaTerr.setStyle(estiloTerr);
  if (capaEtiquetas) { map.removeLayer(capaEtiquetas); capaEtiquetas = null; }
  const hoy = territoriosDelDia();
  if (!hoy.length) return;
  const ms = hoy.map(n => {
    const f = TERR.features.find(x => x.properties.n === n);
    if (!f) return null;
    return L.marker([f.properties.centro[1], f.properties.centro[0]], {
      interactive: true, keyboard: false,
      icon: L.divIcon({ className: '', iconSize: [30, 24], iconAnchor: [15, 12],
        html: '<div class="tlabel">' + n + '</div>' })
    }).on('click', () => seleccionarTerritorio(n, false));
  }).filter(Boolean);
  capaEtiquetas = L.layerGroup(ms).addTo(map);
}

function ubicar() {
  if (!navigator.geolocation) return aviso('Este teléfono no entrega ubicación');
  $('#fabGps').classList.add('on');
  navigator.geolocation.getCurrentPosition(pos => {
    const ll = [pos.coords.latitude, pos.coords.longitude];
    if (marcadorGps) map.removeLayer(marcadorGps);
    if (circuloGps) map.removeLayer(circuloGps);
    circuloGps = L.circle(ll, { radius: Math.max(pos.coords.accuracy, 12), color: '#1d7fd6', weight: 1, fillOpacity: .12 }).addTo(map);
    marcadorGps = L.circleMarker(ll, { radius: 7, color: '#fff', weight: 2, fillColor: '#1d7fd6', fillOpacity: 1 }).addTo(map);
    map.setView(ll, Math.max(map.getZoom(), 17));
    const dentro = quienContiene(ll);
    aviso(dentro ? 'Estás en el territorio ' + dentro : 'Estás fuera del plano');
  }, err => { $('#fabGps').classList.remove('on'); aviso('No se pudo obtener la ubicación'); },
    { enableHighAccuracy: true, timeout: 10000, maximumAge: 30000 });
}

function quienContiene(ll) {
  const pt = [ll[1], ll[0]];
  for (const f of TERR.features) {
    for (const poly of f.geometry.coordinates) {
      if (enPoligono(pt, poly[0])) return f.properties.n;
    }
  }
  return null;
}
function enPoligono(p, ring) {
  let dentro = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const xi = ring[i][0], yi = ring[i][1], xj = ring[j][0], yj = ring[j][1];
    if (((yi > p[1]) !== (yj > p[1])) && (p[0] < (xj - xi) * (p[1] - yi) / (yj - yi) + xi)) dentro = !dentro;
  }
  return dentro;
}
let avisoT;
function aviso(txt) {
  const h = $('#hint'); h.textContent = txt; h.style.display = 'block';
  clearTimeout(avisoT); avisoT = setTimeout(() => h.style.display = 'none', 3200);
}

/* ---------- programa ---------- */
const diaDe = n => PROG.dias.find(d => d.dia === n);
function territoriosDelDia() {
  const d = diaDe(diaSel); if (!d) return [];
  return [...new Set(d.actividades.flatMap(a => a.terr || []))];
}
function diasDeTerritorio(n) {
  return PROG.dias.filter(d => d.actividades.some(a => (a.terr || []).includes(n)))
    .map(d => d.dia);
}
/* "4 manzana(s) · A B C D · Plaza Manuel Rodríguez" */
function textoManzanas(p) {
  let t = `${p.nmanzanas} manzana(s)`;
  if (p.letras) t += ' · ' + p.letras.split('').join(' ');
  if (p.plazas && p.plazas.length) t += ' · ' + p.plazas.join(' · ');
  return t;
}

/* en qué días del mes se predica este territorio, para la ficha del mapa */
function textoDias(n) {
  const dias = diasDeTerritorio(n);
  if (!dias.length) return 'Sin asignación este mes';
  const lista = dias.map(d => d === diaSel ? `<b>${d}</b>` : d).join(', ');
  return (dias.length === 1 ? 'Este mes: día ' : 'Este mes: días ') + lista;
}

function fechaDe(n) { return new Date(PROG.anio, PROG.mes - 1, n); }
function esHoy(n) {
  const h = new Date();
  return h.getDate() === n && h.getMonth() + 1 === PROG.mes && h.getFullYear() === PROG.anio;
}

function render(enfoque) {
  const f = fechaDe(diaSel);
  const d = diaDe(diaSel);
  const sub = d && d.nota ? d.nota.toLowerCase() : MESES[PROG.mes - 1] + ' ' + PROG.anio;
  $('#fecha').innerHTML = DIAS[f.getDay()].replace(/^./, c => c.toUpperCase()) + ' ' + diaSel +
    '<span>' + sub + '</span>';
  pintarSemana(enfoque);
  pintarLista();
  pintarTerritorios();
  limpiarSeleccion(true);
  encuadrarDia();
}

/* encuadra el mapa en los territorios del día */
function encuadrarDia() {
  if (!map) return;
  const ns = territoriosDelDia();
  const capas = ns.map(n => capasTerr[n]).filter(Boolean);
  if (capas.length) {
    map.fitBounds(L.featureGroup(capas).getBounds().pad(0.18), { maxZoom: 16.5, padding: [8, 8] });
  } else {
    map.fitBounds(L.latLngBounds(BOUNDS.bounds[0], BOUNDS.bounds[1]), { padding: [6, 6] });
  }
}

/* la tira muestra siempre el mes completo; `enfoque` decide dónde queda
   posicionada: 'semana' deja a la vista la semana del día elegido, y
   cualquier otra cosa simplemente centra el día */
function pintarSemana(enfoque) {
  const cont = $('#week'); cont.innerHTML = '';
  PROG.dias.map(d => d.dia).forEach(n => {
    const dd = fechaDe(n);
    const b = el('button', 'wd' + (n === diaSel ? ' sel' : '') + (esHoy(n) ? ' hoy' : ''),
      `<i>${DIAS_C[dd.getDay()]}</i><b>${n}</b>`);
    b.dataset.dia = n;
    b.onclick = () => { diaSel = n; render(); };
    cont.appendChild(b);
  });
  posicionarTira(enfoque);
}

function posicionarTira(enfoque) {
  const cont = $('#week');
  const sel = cont.querySelector('.wd.sel');
  if (!sel) return;
  let left;
  if (enfoque === 'semana') {
    // el lunes de la semana del día elegido, pegado al borde izquierdo
    const f = fechaDe(diaSel);
    const lunes = diaSel - ((f.getDay() + 6) % 7);
    const btns = [...cont.querySelectorAll('.wd')];
    const primero = btns.find(b => +b.dataset.dia >= lunes) || sel;
    left = primero.offsetLeft - 2;
  } else {
    left = sel.offsetLeft - (cont.clientWidth - sel.offsetWidth) / 2;
  }
  cont.scrollTo({ left: Math.max(0, left), behavior: 'smooth' });
}

function urlComoLlegar(a) {
  return a.coord
    ? `https://www.google.com/maps/dir/?api=1&destination=${a.coord[0]},${a.coord[1]}`
    : `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(a.mapsq || (a.direccion + ', Santiago, Chile'))}`;
}

/* la hora tal como se muestra: "10:00" o "17:00 a 19:00" */
function horaTexto(a) {
  const h = (a.hora || '').split('-');
  return h[0] ? h[0] + (h[1] ? ' a ' + h[1] : '') : '';
}

function pintarLista() {
  const cont = $('#lista'); cont.innerHTML = '';
  const d = diaDe(diaSel);
  if (!d || !d.actividades.length) {
    cont.appendChild(el('div', 'vacio', 'Sin actividades registradas para este día.'));
    return;
  }
  if (d.nota) cont.appendChild(el('div', 'nota', d.nota));
  d.actividades.forEach((a, i) => {
    const fila = el('div', 'act' + (actSel === i ? ' sel' : ''));
    const horas = (a.hora || '').split('-');
    fila.appendChild(el('div', 'hora', horas[0] + (horas[1] ? `<small>a ${horas[1]}</small>` : '')));

    const info = el('div', 'info');
    const tipo = a.tipo === 'reunion' ? '<span class="tag reunion">reunión</span>'
      : a.tipo === 'cartas' ? '<span class="tag cartas">cartas</span>' : '';
    const titulo = a.tipo === 'reunion' ? (a.nombre || 'Reunión')
      : (a.capitan || 'Sin capitán');
    info.appendChild(el('div', 'cap', titulo + tipo));
    if (a.grupo) info.appendChild(el('div', 'meta', a.grupo.toLowerCase()));
    // texto, no enlace: tocarlo abre la ficha, igual que el resto de la fila
    if (a.direccion) info.appendChild(el('div', 'dir', a.direccion));
    fila.appendChild(info);

    const chip = el('div', 'terrchip');
    if (a.terr && a.terr.length) {
      chip.appendChild(el('div', 'tnum', a.terr.join(' · ')));
    } else if (a.calles) {
      chip.appendChild(el('div', 'tnum calles', 'CALLES'));
    }
    if (a.direccion) {
      const go = el('a', 'go', '➤ cómo llegar');
      go.href = urlComoLlegar(a); go.target = '_blank'; go.rel = 'noopener';
      go.onclick = e => e.stopPropagation();
      chip.appendChild(go);
    }
    fila.appendChild(chip);

    fila.onclick = () => { actSel = i; irAActividad(a); pintarLista(); };
    cont.appendChild(fila);
  });
}

function irAActividad(a) {
  if (marcadorPunto) { map.removeLayer(marcadorPunto); marcadorPunto = null; }
  if (a.terr && a.terr.length) {
    resaltarTerritorio(a.terr[0], true);
    if (a.terr.length > 1) {
      const g = L.featureGroup(a.terr.map(n => capasTerr[n]).filter(Boolean));
      if (g.getLayers().length) map.fitBounds(g.getBounds().pad(0.35));
    }
  } else if (a.coord) {
    map.setView(a.coord, 17);
  }
  if (a.coord) {
    marcadorPunto = L.marker(a.coord, {
      icon: L.divIcon({ className: '', iconSize: [22, 22], iconAnchor: [11, 11],
        html: '<div style="width:20px;height:20px;border-radius:50%;background:#c62828;border:3px solid #fff;box-shadow:0 1px 4px rgba(0,0,0,.4)"></div>' })
    }).addTo(map).bindPopup('<b>Punto de encuentro</b><br>' + a.direccion);
  }
  panelActividad(a);
}

/* ficha de la actividad: territorio, horario y punto de encuentro */
function panelActividad(a) {
  const ns = a.terr || [];
  let titulo, sub = '';
  if (ns.length === 1) {
    const f = TERR.features.find(x => x.properties.n === ns[0]);
    titulo = `<span class="dot" style="background:${f ? f.properties.color : 'transparent'}"></span>Territorio ${ns[0]}`;
    if (f) sub = textoManzanas(f.properties);
  } else if (ns.length > 1) {
    titulo = 'Territorios ' + ns.join(' · ');
  } else if (a.calles) {
    titulo = 'Calles';
  } else {
    titulo = a.tipo === 'reunion' ? (a.nombre || 'Reunión') : (a.capitan || 'Actividad');
  }
  const hora = horaTexto(a);
  const url = a.direccion ? urlComoLlegar(a) : null;
  const nombre = a.tipo === 'reunion' ? (a.nombre || 'Reunión') : (a.capitan || 'Sin capitán');
  mostrarPanel(`
    <h3>${titulo}<span class="close" id="cerrarT">✕</span></h3>
    ${sub ? `<div class="sub">${sub}</div>` : ''}
    <div class="dato">
      ${nombre && nombre !== titulo ? `<div class="dato-nombre">${nombre}</div>` : ''}
      ${hora ? `<div class="dato-hora">${hora}</div>` : ''}
      ${url ? `<div class="dato-fila">
        <a class="dato-dir" href="${url}" target="_blank" rel="noopener">${a.direccion}</a>
        <a class="btn primary" target="_blank" rel="noopener" href="${url}">➤ Cómo llegar</a>
      </div>` : ''}
    </div>`);
}

/* ---------- ficha sobre el mapa ---------- */
/* mientras la ficha está abierta se esconde el listado de abajo, para
   dejar el mapa a la vista */
function mostrarPanel(html) {
  const p = $('#tpanel');
  p.innerHTML = html;
  p.classList.add('show');
  // se recoge el listado para dejar el mapa a la vista; queda la barra
  // para volver a desplegarlo sin cerrar la ficha
  if (estadoLista === 'abierto') { estadoLista = 'oculto'; ocultoPorFicha = true; }
  ajustarHoja();
  const c = $('#cerrarT');
  if (c) c.onclick = () => limpiarSeleccion();
}

/* solo resalta y encuadra el territorio en el mapa */
function resaltarTerritorio(n, zoom) {
  terrSel = n;
  pintarTerritorios();
  const capa = capasTerr[n];
  if (capa && zoom !== false) map.fitBounds(capa.getBounds().pad(0.45));
}

/* al tocar un territorio directamente en el mapa */
function seleccionarTerritorio(n, zoom) {
  resaltarTerritorio(n, zoom);
  const f = TERR.features.find(x => x.properties.n === n);
  const centro = f.properties.centro;
  mostrarPanel(`
    <h3><span class="dot" style="background:${f.properties.color}"></span>Territorio ${n}
      <span class="close" id="cerrarT">✕</span></h3>
    <div class="sub">${textoManzanas(f.properties)}</div>
    <div class="sub dias">${textoDias(n)}</div>
    <div class="row">
      <a class="btn" target="_blank" rel="noopener"
         href="https://www.google.com/maps/dir/?api=1&destination=${centro[1]},${centro[0]}">➤ Cómo llegar</a>
    </div>`);
}

function limpiarSeleccion(soloPanel) {
  terrSel = null;
  $('#tpanel').classList.remove('show');
  // se devuelve el listado, salvo que haya sido el usuario quien lo escondió
  if (ocultoPorFicha) { ocultoPorFicha = false; estadoLista = 'abierto'; ajustarHoja(); }
  if (!soloPanel && marcadorPunto) { map.removeLayer(marcadorPunto); marcadorPunto = null; }
  if (!soloPanel) actSel = null;
  pintarTerritorios();
}

/* ---------- navegación ---------- */
function cambiarDia(delta) {
  const dias = PROG.dias.map(d => d.dia);
  const i = dias.indexOf(diaSel);
  const j = Math.min(Math.max(i + delta, 0), dias.length - 1);
  diaSel = dias[j]; actSel = null; render();
}
$('#prev').onclick = () => cambiarDia(-1);
$('#next').onclick = () => cambiarDia(1);
$('#btnHoy').onclick = () => {
  const h = new Date();
  diaSel = (h.getMonth() + 1 === PROG.mes && h.getFullYear() === PROG.anio) ? h.getDate() : 1;
  actSel = null; render('semana');
};

/* deslizar para cambiar de día */
let tx = null, ty = null;
$('#lista').addEventListener('touchstart', e => { tx = e.touches[0].clientX; ty = e.touches[0].clientY; }, { passive: true });
$('#lista').addEventListener('touchend', e => {
  if (tx === null) return;
  const dx = e.changedTouches[0].clientX - tx, dy = e.changedTouches[0].clientY - ty;
  if (Math.abs(dx) > 70 && Math.abs(dx) > Math.abs(dy) * 2) cambiarDia(dx < 0 ? 1 : -1);
  tx = ty = null;
}, { passive: true });

/* hoja inferior: 'abierto' (normal) u 'oculto' (solo el mapa).
   La barra de arriba muestra y oculta. */
function ajustarHoja() {
  const s = $('#sheet');
  s.classList.toggle('oculto', estadoLista === 'oculto');
  // la flecha apunta a lo que hará el próximo toque
  $('#grab').classList.toggle('cerrar', estadoLista === 'abierto');
  setTimeout(() => map && map.invalidateSize(), 200);
}
$('#grab').onclick = () => {
  estadoLista = estadoLista === 'abierto' ? 'oculto' : 'abierto';
  ocultoPorFicha = false;      // lo que decide el usuario manda
  ajustarHoja();
};
// en el celular no hay "mouse encima": la flecha aparece al tocar
$('#grab').addEventListener('touchstart', () => $('#grab').classList.add('tocando'), { passive: true });
$('#grab').addEventListener('touchend', () => setTimeout(() => $('#grab').classList.remove('tocando'), 250), { passive: true });
ajustarHoja();

cargar();
if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('sw.js').catch(() => {});
  // si llega una versión nueva de la app, recargar una vez para mostrarla
  // enseguida en vez de esperar a la próxima apertura
  const habiaSW = !!navigator.serviceWorker.controller;
  let recargando = false;
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (!habiaSW || recargando) return;
    recargando = true;
    location.reload();
  });
}
