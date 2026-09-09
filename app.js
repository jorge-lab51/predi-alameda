/* Territorios Alameda — mapa + programa (offline-first) */
const DIAS = ['domingo', 'lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado'];
const DIAS_C = ['DOM', 'LUN', 'MAR', 'MIÉ', 'JUE', 'VIE', 'SÁB'];
const MESES = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio',
  'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];

let PROG = null, TERR = null, BOUNDS = null;
let map, capaPlano, capaMapa, capaTerr, marcadorGps, marcadorPunto, circuloGps;
let diaSel = 1, actSel = null, terrSel = null, modoMes = false;
const capasTerr = {};

const $ = s => document.querySelector(s);
const el = (t, c, h) => { const n = document.createElement(t); if (c) n.className = c; if (h != null) n.innerHTML = h; return n; };

/* ---------- estado guardado (localStorage) ---------- */
const KEY = 'alameda_trabajados';
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
  const [p, t, b] = await Promise.all([
    fetch('programa.json').then(r => r.json()),
    fetch('territorios.geojson').then(r => r.json()),
    fetch('plano_bounds.json').then(r => r.json())
  ]);
  PROG = p; TERR = t; BOUNDS = b;
  $('#mestitulo').textContent = 'Programa de ' + MESES[PROG.mes - 1] + ' ' + PROG.anio;
  iniciarMapa();
  const hoy = new Date();
  diaSel = (hoy.getFullYear() === PROG.anio && hoy.getMonth() + 1 === PROG.mes)
    ? hoy.getDate() : 1;
  render();
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

  capaMapa = L.tileLayer('https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png', {
    maxZoom: 20, minZoom: 13,
    attribution: '&copy; OpenStreetMap, &copy; CARTO'
  });
  capaPlano = L.imageOverlay('plano.webp', lim, { opacity: 1, className: 'plano' });

  capaPlano.addTo(map);
  map.fitBounds(lim, { padding: [6, 6] });

  capaTerr = L.geoJSON(TERR, {
    style: estiloTerr,
    onEachFeature: (f, capa) => {
      capasTerr[f.properties.n] = capa;
      capa.on('click', () => seleccionarTerritorio(f.properties.n, false));
    }
  }).addTo(map);

  document.querySelectorAll('.layerbar button').forEach(b => {
    b.onclick = () => {
      document.querySelectorAll('.layerbar button').forEach(x => x.classList.toggle('on', x === b));
      const m = b.dataset.layer;
      if (m === 'plano') { anadir(capaPlano); quitar(capaMapa); capaPlano.setOpacity(1); }
      if (m === 'mapa') { quitar(capaPlano); anadir(capaMapa); }
      if (m === 'ambos') { anadir(capaMapa); anadir(capaPlano); capaPlano.setOpacity(0.55); }
      pintarTerritorios();
    };
  });
  $('#fabGps').onclick = ubicar;
  $('#fabFit').onclick = () => { map.fitBounds(lim, { padding: [6, 6] }); limpiarSeleccion(); };
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
function fechaDe(n) { return new Date(PROG.anio, PROG.mes - 1, n); }
function esHoy(n) {
  const h = new Date();
  return h.getDate() === n && h.getMonth() + 1 === PROG.mes && h.getFullYear() === PROG.anio;
}

function render() {
  const f = fechaDe(diaSel);
  const d = diaDe(diaSel);
  const sub = d && d.nota ? d.nota.toLowerCase() : MESES[PROG.mes - 1] + ' ' + PROG.anio;
  $('#fecha').innerHTML = DIAS[f.getDay()].replace(/^./, c => c.toUpperCase()) + ' ' + diaSel +
    '<span>' + sub + '</span>';
  pintarSemana();
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

function pintarSemana() {
  const cont = $('#week'); cont.innerHTML = '';
  const f = fechaDe(diaSel);
  const lunes = new Date(f); lunes.setDate(f.getDate() - ((f.getDay() + 6) % 7));
  const dias = modoMes ? PROG.dias.map(d => d.dia)
    : [...Array(7)].map((_, i) => { const x = new Date(lunes); x.setDate(lunes.getDate() + i); return x; })
      .filter(x => x.getMonth() + 1 === PROG.mes).map(x => x.getDate());
  dias.forEach(n => {
    const dd = fechaDe(n);
    const b = el('button', 'wd' + (n === diaSel ? ' sel' : '') + (esHoy(n) ? ' hoy' : ''),
      `<i>${DIAS_C[dd.getDay()]}</i><b>${n}</b>`);
    b.onclick = () => { diaSel = n; render(); };
    cont.appendChild(b);
  });
  const sel = cont.querySelector('.wd.sel');
  if (sel) sel.scrollIntoView({ block: 'nearest', inline: 'center' });
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
    if (a.direccion) {
      const dirUrl = a.coord
        ? `https://www.google.com/maps/dir/?api=1&destination=${a.coord[0]},${a.coord[1]}`
        : `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(a.mapsq || (a.direccion + ', Santiago, Chile'))}`;
      const d2 = el('a', 'dir', a.direccion);
      d2.href = dirUrl; d2.target = '_blank'; d2.rel = 'noopener';
      d2.onclick = e => e.stopPropagation();
      info.appendChild(d2);
    }
    fila.appendChild(info);

    const chip = el('div', 'terrchip');
    if (a.terr && a.terr.length) {
      chip.appendChild(el('div', 'tnum', a.terr.join(' · ')));
    } else if (a.calles) {
      chip.appendChild(el('div', 'tnum calles', 'CALLES'));
    }
    if (a.direccion) {
      const url = a.coord
        ? `https://www.google.com/maps/dir/?api=1&destination=${a.coord[0]},${a.coord[1]}`
        : `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(a.mapsq || (a.direccion + ', Santiago, Chile'))}`;
      const go = el('a', 'go', '➤ cómo llegar');
      go.href = url; go.target = '_blank'; go.rel = 'noopener';
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
    seleccionarTerritorio(a.terr[0], true);
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
}

/* ---------- panel de territorio ---------- */
function seleccionarTerritorio(n, zoom) {
  terrSel = n;
  pintarTerritorios();
  const capa = capasTerr[n];
  if (capa && zoom !== false) map.fitBounds(capa.getBounds().pad(0.45));
  const f = TERR.features.find(x => x.properties.n === n);
  const dias = diasDeTerritorio(n);
  const hecho = estaTrabajado(n);
  const p = $('#tpanel');
  const centro = f.properties.centro;
  p.innerHTML = `
    <h3><span class="dot" style="background:${f.properties.color}"></span>Territorio ${n}
      <span class="close" id="cerrarT">✕</span></h3>
    <div class="sub">${f.properties.nmanzanas} manzana(s)${f.properties.letras ? ' · ' + f.properties.letras.split('').join(' ') : ''}</div>
    <div class="sub">${dias.length ? 'Este mes: días ' + dias.join(', ') : 'Sin asignación este mes'}</div>
    <div class="row">
      <button class="btn ${hecho ? 'done' : ''}" id="btnHecho">${hecho ? '✓ Trabajado' : 'Marcar trabajado'}</button>
      <a class="btn" target="_blank" rel="noopener"
         href="https://www.google.com/maps/dir/?api=1&destination=${centro[1]},${centro[0]}">Cómo llegar</a>
    </div>`;
  p.classList.add('show');
  $('#cerrarT').onclick = () => limpiarSeleccion();
  $('#btnHecho').onclick = () => { alternarTrabajado(n); seleccionarTerritorio(n, false); };
}
function limpiarSeleccion(soloPanel) {
  terrSel = null;
  $('#tpanel').classList.remove('show');
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
  actSel = null; render();
};
$('#btnMes').onclick = () => {
  modoMes = !modoMes;
  $('#btnMes').classList.toggle('on', modoMes);
  pintarSemana();
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

/* alto de la hoja inferior: se ajusta al contenido, o se expande */
let expandida = false;
function ajustarHoja() {
  $('#sheet').style.height = expandida ? '62dvh' : 'auto';
  setTimeout(() => map && map.invalidateSize(), 200);
}
$('#grab').onclick = () => { expandida = !expandida; ajustarHoja(); };
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
