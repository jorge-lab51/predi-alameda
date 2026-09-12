/* Territorios Alameda — mapa + programa (offline-first) */
const DIAS = ['domingo', 'lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado'];
const DIAS_C = ['DOM', 'LUN', 'MAR', 'MIÉ', 'JUE', 'VIE', 'SÁB'];
const MESES = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio',
  'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];

let PROG = null, TERR = null, ENV = null, BOUNDS = null;
let map, capaPlano, capaMapa, capaTerr, marcadorGps, marcadorPunto, circuloGps;
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
  carto: { nombre: 'CARTO', maxNativeZoom: 20,
    url: 'https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png',
    attribution: '&copy; OpenStreetMap, &copy; CARTO' }
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
  const [p, t, e, b] = await Promise.all([
    fetch('programa.json').then(r => r.json()),
    fetch('territorios.geojson').then(r => r.json()),
    fetch('envolventes.geojson').then(r => r.json()).catch(() => null),
    fetch('plano_bounds.json').then(r => r.json())
  ]);
  PROG = p; TERR = t; ENV = e; BOUNDS = b;
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

  document.querySelectorAll('.layerbar button').forEach(b => {
    b.onclick = () => {
      document.querySelectorAll('.layerbar button').forEach(x => x.classList.toggle('on', x === b));
      const m = b.dataset.layer;
      if (m === 'plano') { anadir(capaPlano); quitar(capaMapa); capaPlano.setOpacity(1); }
      if (m === 'mapa') { quitar(capaPlano); anadir(capaMapa); }
      if (m === 'ambos') { anadir(capaMapa); anadir(capaPlano); capaPlano.setOpacity(0.55); }
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

const anadir = c => { if (!map.hasLayer(c)) c.addTo(map); };
const quitar = c => { if (map.hasLayer(c)) map.removeLayer(c); };

function estiloTerr(f) {
  const n = f.properties.n;
  const soloPlano = map && map.hasLayer(capaPlano) && !map.hasLayer(capaMapa);
  const sel = terrSel === n;
  const hoy = territoriosDelDia().includes(n);
  const hecho = estaTrabajado(n);
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
    if (f) sub = `${f.properties.nmanzanas} manzana(s)${f.properties.letras ? ' · ' + f.properties.letras.split('').join(' ') : ''}`;
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
    <div class="sub">${f.properties.nmanzanas} manzana(s)${f.properties.letras ? ' · ' + f.properties.letras.split('').join(' ') : ''}</div>
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
