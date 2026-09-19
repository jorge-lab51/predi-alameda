/* Batería de comprobaciones de la app, para correr antes de publicar.
 *
 *     node pruebas/revisar.js            # todo, contra los archivos de este repo
 *     node pruebas/revisar.js fondos     # solo los grupos cuyo nombre contenga eso
 *     node pruebas/revisar.js --publicado          # contra el sitio ya publicado
 *     node pruebas/revisar.js --url https://...    # contra otra dirección
 *
 * No necesita instalar nada: levanta él mismo un servidor sin caché, abre Chrome
 * headless por el protocolo de depuración, emula un celular y lee el DOM. Node 22
 * ya trae `WebSocket`, así que el proyecto sigue sin dependencias de npm.
 *
 * Por qué existe: casi todas las trampas anotadas en CLAUDE.md aparecieron
 * simulando el flujo completo en el navegador, no leyendo el código. Si se
 * agrega una funcionalidad, agregar aquí su comprobación.
 */
const http = require('http');
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');

const RAIZ = path.resolve(__dirname, '..');
const PUBLICADO = 'https://jorge-lab51.github.io/predi-alameda/';
const PUERTO = 8099;
const DEPURACION = 9399;
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const PERFIL = path.join(require('os').tmpdir(), 'chrome-pruebas-alameda');

const TIPOS = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css',
  '.json': 'application/json', '.geojson': 'application/json', '.webp': 'image/webp',
  '.png': 'image/png', '.webmanifest': 'application/manifest+json', '.txt': 'text/plain' };

const dormir = ms => new Promise(r => setTimeout(r, ms));

/* ---------- servidor sin caché ----------------------------------------- */
function servir() {
  const s = http.createServer((req, res) => {
    const rel = decodeURIComponent(req.url.split('?')[0]).replace(/^\/+/, '') || 'index.html';
    const f = path.join(RAIZ, rel);
    if (!f.startsWith(RAIZ) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) {
      res.writeHead(404); return res.end('no está');
    }
    res.writeHead(200, { 'Content-Type': TIPOS[path.extname(f)] || 'application/octet-stream',
      'Cache-Control': 'no-store, must-revalidate' });
    fs.createReadStream(f).pipe(res);
  });
  return new Promise(r => s.listen(PUERTO, '127.0.0.1', () => r(s)));
}

/* ---------- Chrome por el protocolo de depuración ----------------------- */
async function abrirChrome() {
  const p = spawn(CHROME, ['--headless=new', `--remote-debugging-port=${DEPURACION}`,
    `--user-data-dir=${PERFIL}`, '--disable-gpu', '--no-first-run', 'about:blank'],
    { stdio: 'ignore', detached: true });
  for (let i = 0; i < 60; i++) {
    try { await fetch(`http://127.0.0.1:${DEPURACION}/json/version`); return p; } catch (e) {}
    await dormir(500);
  }
  throw new Error('Chrome no levantó; ¿está instalado en ' + CHROME + '?');
}

async function pestana(ancho, alto, base) {
  const t = await (await fetch(
    `http://127.0.0.1:${DEPURACION}/json/new?${base}index.html?cb=${Date.now()}`,
    { method: 'PUT' })).json();
  const ws = new WebSocket(t.webSocketDebuggerUrl);
  await new Promise(r => ws.addEventListener('open', r));
  let id = 0; const errores = [];
  const cmd = (m, p = {}) => new Promise(res => {
    const rid = ++id;
    const h = e => {
      const x = JSON.parse(e.data);
      if (x.id !== rid) return;
      ws.removeEventListener('message', h);
      if (x.error) errores.push(`${m}: ${x.error.message}`);
      res(x.result || {});          // un error del protocolo no debe tumbar la corrida
    };
    ws.addEventListener('message', h);
    ws.send(JSON.stringify({ id: rid, method: m, params: p }));
  });
  ws.addEventListener('message', e => {
    const x = JSON.parse(e.data);
    if (x.method === 'Runtime.exceptionThrown') {
      const d = x.params.exceptionDetails;
      errores.push(String(d.exception?.description || d.text).split('\n')[0]);
    }
  });
  const ev = async expr => {
    const r = await cmd('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true });
    if (r.exceptionDetails) {
      errores.push(String(r.exceptionDetails.exception?.description || '').split('\n')[0]);
      return undefined;
    }
    return r.result?.value;
  };
  await cmd('Runtime.enable');
  await cmd('Page.enable');
  await cmd('Network.enable');
  // el service worker guardaría el app.js viejo y se probaría lo que no es
  await cmd('Network.setBypassServiceWorker', { bypass: true });
  await cmd('Network.setCacheDisabled', { cacheDisabled: true });
  await cmd('Emulation.setDeviceMetricsOverride',
    { width: ancho, height: alto, deviceScaleFactor: 2, mobile: true });

  const p = {
    cmd, ev, errores,
    tema: async v => cmd('Emulation.setEmulatedMedia',
      { features: [{ name: 'prefers-color-scheme', value: v }] }),
    recargar: async () => { await cmd('Page.reload', { ignoreCache: true }); await p.listo(); },
    listo: async () => {
      for (let i = 0; i < 60; i++) {
        // `let` en el tope de un script no cuelga de `window`: hay que mirar
        // los identificadores pelados
        if (await ev("typeof PROG !== 'undefined' && !!(PROG && TERR && map && capaTerr)")) {
          await dormir(1200); errores.length = 0;   // lo de la carga anterior no cuenta
          return;
        }
        await dormir(500);
      }
      throw new Error('la app no terminó de cargar');
    },
    captura: async nombre => {
      const r = await cmd('Page.captureScreenshot', { format: 'png' });
      fs.writeFileSync(path.join(__dirname, nombre + '.png'), Buffer.from(r.data, 'base64'));
    },
    cerrar: () => ws.close()
  };
  return p;
}

/* ---------- las comprobaciones ----------------------------------------- */
let bien = 0, mal = 0, grupo = '';
const ok = (cond, q) => { if (cond) { bien++; console.log('  ok   ' + q); } else { mal++; console.log('  MAL  ' + q); } };
const titulo = t => { grupo = t; console.log('\n' + t); };

const GRUPOS = [];
const prueba = (nombre, fn) => GRUPOS.push({ nombre, fn });

prueba('datos', async p => {
  const { ev } = p;
  ok(await ev('PROG.dias.length') > 0, `el programa trae ${await ev('PROG.dias.length')} días`);
  ok(await ev('TERR.features.length') === 58, 'territorios.geojson trae los 58');
  ok(await ev('ENV && ENV.features.length') === 58, 'envolventes.geojson también');
  ok(await ev('CALLES && CALLES.features.length') > 0,
    `calles.geojson trae ${await ev('CALLES && CALLES.features.length')} tramos`);
  ok(await ev(`TERR.features.every(f => {
      const p = f.properties;
      return p.nmanzanas + (p.plazas || []).length === f.geometry.coordinates.length;
    })`), 'en cada territorio, manzanas + plazas = número de polígonos');
  ok(await ev(`TERR.features.every(f => {
      const l = f.properties.letras || '';
      return l.length === f.properties.nmanzanas && new Set(l).size === l.length;
    })`), 'las letras no se repiten y son tantas como manzanas');
  // el PDF viene en mayúsculas sostenidas y enriquecer_programa.py las baja; si
  // alguna se cuela, la interfaz deja de leerse como el resto del sistema
  const gritados = await ev(`(()=>{
    const mal = [];
    const mira = (t) => { if (!t) return;
      for (const w of String(t).match(/[A-Za-zÁÉÍÓÚÜÑ][A-Za-zÁÉÍÓÚÜÑáéíóúüñ]*/g) || [])
        if (w.length > 2 && w === w.toUpperCase()) mal.push(w); };
    for (const d of PROG.dias) { mira(d.nota);
      for (const a of d.actividades) ['capitan','grupo','nombre','direccion'].forEach(k => mira(a[k])); }
    return [...new Set(mal)];})()`);
  ok(gritados.length === 0, 'el programa no trae mayúsculas sostenidas'
    + (gritados.length ? ' -> ' + gritados.join(', ') : ''));
});

prueba('arranque', async p => {
  const { ev } = p;
  await p.tema('light'); await ev('localStorage.clear()'); await p.recargar();
  ok(await ev("document.querySelector('#barVista button.on').dataset.layer") === 'mapa', 'abre en Mapa');
  ok(await ev("document.querySelector('#barTerr button.on').dataset.terr") === 'manzanas', 'y en Manzanas');
  ok(await ev('mapaBase') === 'carto', 'con fondo CARTO si el sistema está en claro');
  ok(await ev('dibujoOscuro') === false, 'y el Dibujo sobre papel claro');
  await p.tema('dark'); await ev('localStorage.clear()'); await p.recargar();
  ok(await ev('mapaBase') === 'oscuro', 'con el sistema en oscuro, fondo Oscuro');
  ok(await ev('dibujoOscuro') === true, 'y el Dibujo sobre papel oscuro');
  await ev("document.querySelector('#popFondo [data-base=gris]').click()"); await dormir(1500);
  await p.recargar();
  ok(await ev('mapaBase') === 'gris', 'lo elegido a mano manda sobre el sistema');
  ok(await ev("document.querySelector('#barTerr button.on').dataset.terr") === 'manzanas',
    'pero Manzanas vuelve siempre, no se guarda');
  await ev('localStorage.clear()'); await p.tema('light'); await p.recargar();
});

prueba('alto: header, barras y mapa', async p => {
  const { ev } = p;
  const alto = async q => Math.round(await ev(`$('${q}').getBoundingClientRect().height`));
  ok(await alto('header') < 40, `el header mide ${await alto('header')} px`);
  ok(await ev("getComputedStyle($('.titulo')).textAlign") === 'center', 'con el título centrado');
  ok(await ev("$('#sheet').contains($('#week'))"), 'la tira de días va dentro de la hoja');
  ok(await ev("$('#datebar').getBoundingClientRect().top > $('#lista').getBoundingClientRect().top"),
    'y debajo del listado');
  ok(await alto('.mapbar') < 60, `la barra de iconos mide ${await alto('.mapbar')} px de alto`);
  ok(await ev("$('.mapbar').getBoundingClientRect().right") < await ev('innerWidth'),
    `y ${Math.round(await ev("$('.mapbar').getBoundingClientRect().width"))} px de ancho, que caben`);
  const con = await alto('#map');
  await ev("$('#grab').click()"); await dormir(900);
  const sin = await alto('#map');
  ok(sin > con && sin / (await ev('innerHeight')) > 0.85,
    `con el listado recogido el mapa ocupa ${Math.round(100 * sin / (await ev('innerHeight')))}% de la pantalla`);
  ok(!(await ev("$('#datebar').offsetParent")), 'y la tira se recoge con él');
  await ev("$('#grab').click()"); await dormir(900);
});

prueba('tira de días', async p => {
  const { ev } = p;
  const entero = () => ev(`(()=>{const c=$('#week'),s=c.querySelector('.wd.sel');
    return !!s && s.offsetLeft>=c.scrollLeft-1 && s.offsetLeft+s.offsetWidth<=c.scrollLeft+c.clientWidth+1;})()`);
  const dias = await ev('PROG.dias.map(d=>d.dia)');
  for (const d of [dias[0], dias[Math.floor(dias.length / 2)], dias[dias.length - 1]]) {
    await ev(`diaSel=${d}; render('semana')`); await dormir(900);
    ok(await entero(), `el día ${d} queda entero a la vista`);
  }
  const antes = await ev('diaSel');
  await ev("$('#prev').click()"); await dormir(800);
  await ev("$('#next').click()"); await dormir(800);
  ok(await ev('diaSel') === antes, 'las flechas van y vuelven');
  await ev("$('#btnHoy').click()"); await dormir(900);
  ok(await ev("!!document.querySelector('#week .wd.sel')"), 'Hoy deja un día marcado');
});

prueba('barra de iconos y vistas', async p => {
  const { ev } = p;
  await ev("$('#grab').click()"); await dormir(700);
  for (const [v, nombre] of [['plano', 'Plano'], ['ambos', 'Plano sobre el mapa'],
                             ['dibujo', 'Dibujo'], ['mapa', 'Mapa de calles']]) {
    await ev(`document.querySelector('#barVista [data-layer=${v}]').click()`); await dormir(1100);
    ok(await ev("document.querySelector('#barVista button.on').dataset.layer") === v &&
       await ev("$('#hint').textContent") === nombre,
      `el icono de ${v} cambia la vista y avisa "${nombre}"`);
  }
  await ev("document.querySelector('#barTerr [data-terr=borde]').click()"); await dormir(900);
  ok(await ev('modoTerr') === 'borde', 'el icono de borde cambia el marcado');
  await ev("document.querySelector('#barTerr [data-terr=manzanas]').click()"); await dormir(900);
  ok(await ev('modoTerr') === 'manzanas', 'y el de manzanas vuelve');
});

prueba('desplegable del fondo', async p => {
  const { ev } = p;
  const abierto = async () => !(await ev("$('#popFondo').classList.contains('oculta')"));
  await ev("document.querySelector('#barVista [data-layer=mapa]').click()"); await dormir(900);
  ok(!(await ev("$('#btnFondo').classList.contains('oculta')")), 'en Mapa se ve el botón de capas');
  await ev("$('#btnFondo').click()"); await dormir(400);
  ok(await abierto(), 'que abre el desplegable');
  await ev("document.querySelector('#popFondo [data-base=claro]').click()"); await dormir(2000);
  ok(await ev('mapaBase') === 'claro' && await abierto(), 'elegir un fondo no lo cierra');
  await ev("map.fire('click'); map.fire('movestart'); 1"); await dormir(400);
  ok(await abierto(), 'tocar o mover el mapa tampoco');
  await ev("$('#btnFondo').click()"); await dormir(400);
  ok(!(await abierto()), 'solo lo cierra su propio botón');
  await ev("document.querySelector('#barVista [data-layer=dibujo]').click()"); await dormir(1000);
  ok(!(await ev("$('#btnFondo').classList.contains('oculta')")) &&
     !(await ev("$('#fondosDibujo').classList.contains('oculta')")),
    'en Dibujo el mismo botón ofrece el claro/oscuro del dibujo');
  await ev("document.querySelector('#barVista [data-layer=plano]').click()"); await dormir(900);
  ok(await ev("$('#btnFondo').classList.contains('oculta')"),
    'y en Plano desaparece, que no hay nada que elegir');
  await ev("document.querySelector('#barVista [data-layer=mapa]').click()"); await dormir(900);
});

prueba('fondos de mapa', async p => {
  const { ev } = p;
  const fallos = [];
  p.cmd('Network.enable');
  for (const base of ['carto', 'osm', 'gris', 'calles', 'claro', 'oscuro']) {
    await ev(`$('#btnFondo').click(); document.querySelector('#popFondo [data-base=${base}]').click()`);
    await dormir(3000);
    const t = await ev("document.querySelectorAll('img.leaflet-tile-loaded').length");
    const rot = await ev("capaRotulos ? map.getPane('rotulosMapa').querySelectorAll('img.leaflet-tile-loaded').length : null");
    const conNombres = ['carto', 'claro', 'oscuro'].includes(base);
    if (!(t > 0) || (conNombres && !(rot > 0)) || (!conNombres && rot !== null)) fallos.push(base);
    if (base === 'carto') {
      ok(await ev("[...document.querySelectorAll('img.leaflet-tile-loaded')].some(i=>i.src.includes('key=cb1_'))"),
        'las teselas de CARTO llevan la clave, así no vienen con filigrana');
    }
  }
  ok(!fallos.length, 'los seis fondos cargan, y solo CARTO/Claro/Oscuro traen capa de nombres'
    + (fallos.length ? ' -> fallan ' + fallos.join(', ') : ''));
  ok((await ev("$('.leaflet-control-attribution').textContent")).includes('CARTO') ||
     (await ev("$('.leaflet-control-attribution').textContent")).length > 0, 'la atribución se ve');
  await ev("$('#btnFondo').click(); document.querySelector('#popFondo [data-base=carto]').click()");
  await dormir(2500);
});

prueba('nombres de calle en Dibujo', async p => {
  const { ev } = p;
  await ev("document.querySelector('#barVista [data-layer=mapa]').click()"); await dormir(900);
  const visibles = () => ev("[...document.querySelectorAll('.rotulo')].filter(e=>e.offsetParent).length");
  ok(await visibles() === 0, 'en Mapa no se escriben');
  await ev("document.querySelector('#barVista [data-layer=dibujo]').click()"); await dormir(800);
  await ev("map.setView([-33.4600,-70.6660],17); 1"); await dormir(1500);
  ok(await visibles() > 0, `en Dibujo sí (${await visibles()})`);
  await ev('map.panBy([260,180]); 1'); await dormir(1400);
  ok(await visibles() > 0, 'y siguen al desplazar el mapa');
  ok(await ev(`(()=>{const c=map.getContainer().getBoundingClientRect();
    return [...document.querySelectorAll('.rotulo')].filter(e=>e.offsetParent).every(e=>{
      const r=e.getBoundingClientRect();
      return r.left>=c.left-1 && r.right<=c.right+1 && r.top>=c.top-1 && r.bottom<=c.bottom+1;});})()`),
    'ninguno queda cortado por el borde');
  ok(await ev(`(()=>{const rs=[...document.querySelectorAll('.rotulo')].filter(e=>e.offsetParent)
      .map(e=>e.getBoundingClientRect());
    for(let i=0;i<rs.length;i++)for(let j=i+1;j<rs.length;j++){const a=rs[i],b=rs[j];
      if(a.left<b.right&&b.left<a.right&&a.top<b.bottom&&b.top<a.bottom)return false;}
    return true;})()`), 'ninguno pisa a otro');
  ok(await ev(`(()=>{const v=[...document.querySelectorAll('.rotulo')].filter(e=>e.offsetParent)
      .map(e=>e.textContent); return new Set(v).size===v.length;})()`),
    'ninguna calle se rotula dos veces');
});

prueba('números de territorio', async p => {
  const { ev } = p;
  const n = () => ev("document.querySelectorAll('.nterr').length");
  await ev("document.querySelector('#barVista [data-layer=mapa]').click()"); await dormir(900);
  await ev('map.fitBounds(L.latLngBounds(BOUNDS.bounds[0],BOUNDS.bounds[1]),{padding:[6,6],animate:false}); 1');
  await dormir(1500);
  const hoy = await ev('territoriosDelDia().length');
  ok(await n() === 58 - hoy, `en Mapa se escriben ${await n()} números (${hoy} del día llevan chapa roja)`);
  for (const v of ['ambos', 'plano']) {
    await ev(`document.querySelector('#barVista [data-layer=${v}]').click()`); await dormir(1100);
    ok(await n() === 0, `en ${v} no salen, que el plano ya trae los suyos`);
  }
  await ev("document.querySelector('#barVista [data-layer=dibujo]').click()"); await dormir(1300);
  ok(await n() > 0, 'en Dibujo sí');
  await ev('map.setZoom(13); 1'); await dormir(1400);
  ok(await n() === 0, 'alejado del todo se ocultan para no amontonarse');
  await ev('map.setZoom(15); 1'); await dormir(1400);
  ok(await n() > 0, 'y vuelven al acercar');
  await ev("document.querySelector('#barVista [data-layer=mapa]').click()"); await dormir(900);
});

prueba('letras de manzana', async p => {
  const { ev } = p;
  const letras = () => ev("[...document.querySelectorAll('.letramz')].map(e=>e.textContent).join('')");
  await ev('limpiarSeleccion()'); await dormir(700);
  ok(await letras() === '', 'sin territorio marcado no hay letras');
  // uno con plaza: la plaza no lleva letra y va al final del MultiPolygon
  const conPlaza = await ev("(TERR.features.find(f=>(f.properties.plazas||[]).length)||{}).properties?.n");
  if (conPlaza) {
    await ev(`seleccionarTerritorio(${conPlaza}, true)`); await dormir(2500);
    const esperadas = await ev(`TERR.features.find(f=>f.properties.n===${conPlaza}).properties.letras`);
    ok(await letras() === esperadas,
      `el T${conPlaza} muestra ${esperadas} y su plaza queda sin letra`);
    ok(await ev(`(()=>{
      const f=TERR.features.find(x=>x.properties.n===${conPlaza});
      const c=map.getContainer().getBoundingClientRect();
      return [...document.querySelectorAll('.letramz')].every((e,i)=>{
        const r=e.getBoundingClientRect();
        const ll=map.containerPointToLatLng(L.point(r.left+r.width/2-c.left, r.top+r.height/2-c.top));
        const b=L.polygon(f.geometry.coordinates[i][0].map(q=>[q[1],q[0]])).getBounds();
        return ll.lat<=b.getNorth()+0.00004 && ll.lat>=b.getSouth()-0.00004 &&
               ll.lng<=b.getEast()+0.00004 && ll.lng>=b.getWest()-0.00004;});})()`),
      'cada letra cae sobre su propia manzana');
  }
  await ev('limpiarSeleccion()'); await dormir(800);
  ok(await letras() === '', 'al cerrar la ficha se quitan');
});

prueba('bordes y toques', async p => {
  const { ev } = p;
  await ev('seleccionarTerritorio(TERR.features[0].properties.n, true)'); await dormir(2000);
  const anchos = [];
  for (const z of [13, 15, 17, 19]) {
    await ev(`map.setZoom(${z}); 1`); await dormir(1100);
    anchos.push(await ev(`(()=>{const c=capasTerr[terrSel];
      const p=c.getLayers?c.getLayers()[0]:c; return +p.options.weight.toFixed(2);})()`));
  }
  ok(anchos.every((w, i) => i === 0 || w >= anchos[i - 1]) && anchos[0] < anchos[3],
    `el borde se afina al alejar: ${anchos.map((w, i) => 'z' + [13, 15, 17, 19][i] + ' ' + w + 'px').join(', ')}`);
  // los botones viven dentro del mapa: si el clic se propaga, el desplegable se
  // cerraría en el mismo toque que lo abre
  await ev('terrSel=null; pintarTerritorios()'); await dormir(600);
  await ev(`(()=>{const c=capasTerr[TERR.features[0].properties.n];
    window._poli=c.getLayers?c.getLayers()[0]:c;
    map.fitBounds(_poli.getBounds(),{animate:false});
    return 1;})()`); await dormir(2000);
  await ev(`(()=>{const q=map.latLngToContainerPoint(_poli.getCenter());
    const c=map.getContainer().getBoundingClientRect();
    const e=document.elementFromPoint(c.left+q.x, c.top+q.y);
    if(e) e.dispatchEvent(new MouseEvent('click',{bubbles:true}));
    return 1;})()`); await dormir(900);
  ok(await ev('terrSel') !== null, 'tocar una manzana abre su ficha: los rótulos no roban el clic');
});

prueba('diseño', async p => {
  const { ev } = p;
  await ev('limpiarSeleccion()'); await dormir(600);
  ok(await ev(`document.fonts.check('500 15px "Space Grotesk"')`),
    'la tipografía Space Grotesk carga desde el repo');
  ok(await ev(`document.fonts.check('500 15px "Space Grotesk"', 'miércoles ñ á')`),
    'y trae las tildes y la eñe');
  // la clave de CARTO se paga con dejar su atribución a la vista: el mapa se
  // mete bajo la hoja, así que hay que comprobar que no queda tapada
  ok(await ev(`(()=>{const a=$('.leaflet-control-attribution');
    if(!a || !a.offsetParent) return false;
    const r=a.getBoundingClientRect(), s=$('#sheet').getBoundingClientRect();
    return r.width>0 && r.height>0 && r.bottom<=s.top+1 && r.right<=innerWidth+1;})()`),
    'la atribución del mapa queda por encima de la hoja, entera y visible');
  // el sistema de color: ni un color literal fuera de los tokens
  const bg = async () => ev("getComputedStyle(document.documentElement).getPropertyValue('--bg').trim()");
  const meta = () => ev("$('#metaTema').getAttribute('content')");
  await ev("$('#btnAjustes').click()"); await dormir(500);
  ok(await ev("$('#ajustes').open"), 'el botón ⋯ abre la hoja de ajustes');
  ok(/Versión/.test(await ev("$('#diag').textContent") || '') &&
     /la app termina en \d+/.test(await ev("$('#diag').textContent") || ''),
    'que trae el diagnóstico: versión, tamaños y área segura');
  await ev("document.querySelector('#segTema [data-tema=dark]').click()"); await dormir(500);
  ok(await ev('document.documentElement.dataset.theme') === 'dark' && await bg() === '#0b0b0b',
    'elegir Oscuro invierte la interfaz');
  // la barra de estado va en --surface, el color del header, no en --bg
  ok(await meta() === '#171717', 'y la barra de estado del celular lo sigue');
  await ev("document.querySelector('#segTema [data-tema=light]').click()"); await dormir(500);
  ok(await bg() === '#e6e6e6' && await meta() === '#f5f5f5', 'y Claro la devuelve');
  await p.recargar();
  ok(await ev('document.documentElement.dataset.theme') === 'light',
    'lo elegido se guarda y se aplica antes del CSS, sin parpadeo');
  await ev("$('#btnAjustes').click()"); await dormir(400);
  await ev("document.querySelector('#segTema [data-tema=auto]').click()"); await dormir(400);
  ok(!(await ev('document.documentElement.dataset.theme')), 'y Auto vuelve a seguir al sistema');
  await ev("$('#ajustes').close()"); await dormir(300);
  ok(!(await ev("$('#ajustes').open")), 'la hoja se cierra');
  // El indicador de inicio del iPhone: el navegador da 0 y la PWA instalada ~34 px.
  // Si se suma a un padding en vez de reservarse con max(), en el celular queda un
  // hueco del doble de alto bajo la tira de días. Aquí se simula el valor.
  ok(await ev("$('#app').getBoundingClientRect().bottom") === await ev('innerHeight'),
    'la app termina justo en el borde inferior de la pantalla');
  ok(await ev(`(()=>{
    const r=document.documentElement, lee=q=>getComputedStyle($(q)).paddingBottom;
    $('#grab').click();
    const sin=[lee('#datebar'), lee('#sheet.oculto .grab'), lee('dialog .hoja')];
    r.style.setProperty('--safe-b','34px');
    const con=[lee('#datebar'), lee('#sheet.oculto .grab'), lee('dialog .hoja')];
    r.style.removeProperty('--safe-b'); $('#grab').click();
    return sin.join()==='6px,8px,18px' && con.join()==='34px,34px,34px';})()`),
    'el área segura del iPhone se reserva con max(), no sumada: no se duplica el hueco');
  ok(await ev(`![...document.styleSheets].some(h => {
      try { return [...h.cssRules].some(r => /\\bdvh\\b/.test(r.cssText)); } catch (e) { return false; }
    })`), 'ninguna regla mide en dvh: la altura va en %, ver CLAUDE.md');
});

/* ---------- correr ------------------------------------------------------ */
(async () => {
  const args = process.argv.slice(2);
  const iUrl = args.indexOf('--url');
  const base = iUrl >= 0 ? args[iUrl + 1]
    : args.includes('--publicado') ? PUBLICADO
    : `http://127.0.0.1:${PUERTO}/`;
  const filtro = args.find(a => !a.startsWith('--') && a !== base);
  const local = base.includes('127.0.0.1');
  console.log('probando ' + base);
  const servidor = local ? await servir() : null;
  const chrome = await abrirChrome();
  const p = await pestana(390, 844, base);
  try {
    await p.listo();
    for (const g of GRUPOS) {
      if (filtro && !g.nombre.includes(filtro)) continue;
      titulo(g.nombre.toUpperCase());
      await g.fn(p);
      if (p.errores.length) { mal++; console.log('  MAL  errores en consola: ' + p.errores.join(' | ')); p.errores.length = 0; }
    }
    await p.captura('ultima');
  } finally {
    p.cerrar();
    if (servidor) servidor.close();
    try { process.kill(-chrome.pid); } catch (e) { try { chrome.kill(); } catch (e2) {} }
  }
  console.log(`\n${bien} bien, ${mal} mal`);
  process.exit(mal ? 1 : 0);
})();
