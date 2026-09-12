# Territorios Alameda

App web (PWA) que junta el plano de los 58 territorios de la congregación con el
programa de predicación del mes. Se usa desde el celular, instalada en la pantalla de
inicio, y funciona sin conexión.

- **Publicada en:** https://jorge-lab51.github.io/predi-alameda/
- **Se despliega solo** con cada push a `main` (GitHub Pages, rama `main`, carpeta raíz).
  No hay build ni workflow: los archivos del repo *son* el sitio.
- Sin dependencias de npm. Leaflet viene incluido en el repo (`leaflet.js`, `leaflet.css`).

## Lo único que cambia cada mes

`programa.json`. Los territorios solo se rehacen si la congregación corrige algo.

---

# Subir el programa de un mes nuevo

Se recibe un PDF con la tabla del mes. El proceso completo:

```bash
pip install pymupdf                                        # única dependencia
python parse_programa.py MES.pdf base.json                 # PDF -> datos crudos
python enriquecer_programa.py base.json programa.json      # + territorios, coordenadas y tildes
```

`enriquecer_programa.py` lee el `programa.json` **anterior** para reutilizar
coordenadas, y escribe encima. Es correcto: carga en memoria antes de escribir.

### Después de generar, hay que revisar

1. **Los totales que imprime `parse_programa.py`** contra el PDF: número de días y de
   actividades. Si el PDF cambió de diseño, el parser no falla con error — devuelve
   *menos* días o actividades. Esa comparación es la única red de seguridad.
2. **Los cruces nuevos que buscó en OpenStreetMap**, que quedan listados en pantalla.
3. **Las direcciones sin coordenada** que también lista. Deberían ser solo las casas
   de familia (ver *Privacidad*). Si aparece un cruce de calles ahí, es que falta el
   nombre en `CALLES_OSM`.
4. Que los puntos de encuentro caigan cerca de su territorio. Dos casos son normales y
   no son errores: el Salón (punto fijo, lejos del territorio del día) y los días en
   que se juntan en una esquina para trabajar un territorio a varias cuadras.

### Antes de hacer push — obligatorio

**Subir la versión del caché en `sw.js`** (`const CACHE = 'alameda-vN'`) si cambió
cualquier archivo salvo `programa.json`. Sin eso, los celulares que ya tienen la app
instalada se quedan con la versión vieja. Ver *Service worker*.

Actualizar el `README.md` si cambió cómo se usa la app: está escrito para la
congregación, no para desarrolladores.

### Después del push

Esperar a que GitHub Pages termine de construir y comprobar contra la URL pública, con
un parámetro anti-caché:

```bash
curl -s "https://jorge-lab51.github.io/predi-alameda/programa.json?cb=$(date +%s)" | python3 -m json.tool | head
```

---

# Los territorios

`territorios.geojson` (las manzanas) y `envolventes.geojson` (el contorno de cada
territorio, de una pieza) **se generan**:

```bash
python territorios_desde_osm.py
```

La fuente es `territorios_trazados.geojson`, el trazado original a mano, que no se
edita nunca. El script lo rehace usando las cuadras reales de la ciudad: baja la red
de calles de OpenStreetMap, la poligoniza, y adjudica cada cuadra a un territorio
cruzando dos señales independientes: dónde caen las manzanas trazadas, y de qué color
está pintada la cuadra en el plano. Ver el docstring del script para el detalle.

Escribe además `dudosos.json`: los casos que el color no alcanzó a decidir porque dos
territorios vecinos están pintados igual. Esos quedan como estaban, para revisión
humana.

## Las cuatro listas que ajustan el resultado

Todas viven en `territorios_desde_osm.py`, salvo la última, y cada entrada lleva
escrito por qué existe. **Son la forma correcta de corregir el mapa**: nunca editar
los geojson a mano, porque se regeneran.

| Lista | Para qué |
|---|---|
| `REMAPEAR` | rehace las manzanas de un territorio con el detalle del mapa, conservando su contorno. Hoy solo T51, el Parque O'Higgins: se poligoniza con `service` y **sin** sendas peatonales, que lo partían en retazos que no corresponden a nada |
| `CORRECCIONES` | "la cuadra que contiene este punto es de tal territorio". Para cuando el color no desambigua y la congregación confirma |
| `EXCLUIDAS` | cuadras que no son de nadie: plazas, bandejones |
| `BLOQUE_UNICO` | un territorio que en la realidad es un bloque con pasajes, no manzanas sueltas. Hoy solo T58 al poniente de San Alfonso |
| `CONEXIONES` (en `envolventes.py`) | tramos de calle que existen pero faltan en OSM, sin los cuales la manzana no cierra |

Las coordenadas se escriben aproximadas: los tramos de `CONEXIONES` se enganchan
solos a los vértices vecinos dentro de 2 m.

## Trampas de este pipeline

Cada una costó encontrarla y está resuelta; no re-descubrirlas.

- **El plano no tiene manzanas, tiene construcciones.** El trazado original dibujaba
  la planta de los edificios, no la cuadra. De ahí que salieran formas "puntudas".
  Por eso se usan las cuadras de OSM.
- **Los colores del plano no se comparan por igualdad.** T29 (`#780b3c`) y T46
  (`#74163c`) son el mismo granate. Redondear a cubetas fijas los separaba e inventaba
  correcciones. Se comparan por distancia (`DIST_COLOR`).
- **Las avenidas partidas dejan bandejones.** Al poligonizar, entre las dos calzadas
  queda una cara larga y angosta. Si se le adjudica a un territorio aparecen "cachos"
  de color sobre el asfalto. Se descartan con `es_tira`, y un hueco solo se absorbe si
  **todo su perímetro** da a un mismo territorio.
- **Algunas cuadras arrastran una lengua de asfalto** pegada por un cuello estrecho,
  donde la avenida no está mapeada pareja. `sin_cola` la separa con una apertura
  morfológica y descarta el trozo que no contiene ninguna manzana dibujada.
- **Varios pasajes están en OSM como `footway`.** Se suman los que tienen nombre y no
  son vereda ni paso de cebra. Sin ellos, manzanas enteras salen de una pieza.
- **El tamaño máximo de cuadra importa.** `CARA_MAXIMA_M2` está en 90.000 m² porque hay
  cuadras reales de 88.000. Bajarlo hace que esos territorios caigan al plan B y salgan
  deformados.
- **Las manzanas se recortan media calle por lado** (`SEPARACION_M`) para que en el
  modo "Manzanas" se vea el espacio de la calle, como en el plano. Nunca más del 35%
  del lado corto, o las manzanas angostas desaparecen. La envolvente se calcula sin
  recortar, así los territorios vecinos siguen calzando.
- **Los bandejones absorbidos no son manzanas.** Se absorben para que el territorio no
  quede partido, pero entran solo en la envolvente: si se listan como manzanas,
  aparecen tiras de color sobre la calzada.
- **En la vista Dibujo la etiqueta va al medio por distancia, no por vértice.** Tras
  simplificar, muchas calles quedan con tres puntos y el vértice del medio cae en un
  extremo: el nombre terminaba escrito sobre otra calle.
- **Para el territorio 58, el plano tiene más información que el mapa.** Se midió: OSM
  solo alcanza a estructurar el 37% de ese sector. Es el caso inverso al resto.

# Trampas conocidas

Cada una de estas costó encontrarla. No re-descubrirlas.

## El PDF cambia de diseño entre meses

Las columnas de la tabla **no están en las mismas posiciones** de un mes a otro (agosto
y septiembre de 2026 diferían ~7 px, suficiente para que la dirección cayera en la
columna de grupos). Por eso `parse_programa.py` deduce los límites de las columnas de
las **líneas verticales** que dibuja el PDF, y solo usa `COLS_FALLBACK` si no encuentra
exactamente 8.

Otras variaciones ya contempladas:

- La columna **Día** a veces repite el número del día (`"1 MARTES"`); se le quita.
- Un `-` en la columna **Hora** significa celda vacía. En las reuniones de fin de semana
  la hora real va entre paréntesis en la columna del capitán (`"Reunión de Fin de
  Semana (10:00)"`).
- `ZOOM` en la columna **Territ.** marca una actividad por Zoom, no un territorio: se
  clasifica como `cartas`.
- Una celda de territorio puede traer varios (`"57,56,55"`).

## Tildes

El PDF viene sin tildes. `enriquecer_programa.py` las repone con el diccionario
`TILDES`, palabra por palabra. Si aparece una palabra nueva mal acentuada, se agrega
ahí — nunca se edita `programa.json` a mano, porque se regenera cada mes.

**No se tocan los nombres de los capitanes**: adivinar tildes en nombres de personas es
inventar.

## Nombres de calles en OpenStreetMap

`CALLES_OSM` traduce del nombre que usa la congregación al que tiene OSM. El caso menos
obvio: lo que el programa llama **"Unión Latinoamericana" en OSM es "Unión Americana"**.

Al agregar una calle nueva conviene verificar el nombre antes:

```bash
python cruce.py --calles "parte-del-nombre"
```

## Overpass se cae

La API de Overpass da timeouts y 504 con frecuencia. `cruce.py` rota entre tres
espejos, reintenta, y **guarda todo en `cruces_cache.json`** (ignorado por git) para no
repetir consultas entre corridas. Si una búsqueda falla igual, `enriquecer_programa.py`
no se cae: deja esa actividad sin coordenada y lo avisa. La app sigue funcionando,
usando la búsqueda por texto en Google Maps.

## Service worker

`sw.js` sirve la app con **caché primero**, así que un archivo cambiado no llega solo:
hay que subir `CACHE` a la versión siguiente. Al instalarse, la versión nueva borra la
anterior.

Dos detalles que ya están resueltos y conviene no deshacer:

- El precargado y la consulta de `programa.json` usan `cache: 'reload'`. Sin eso, el
  **caché HTTP del navegador** devuelve la copia vieja aunque el caché del service
  worker se haya renovado — el síntoma es una app que dice estar actualizada pero
  muestra el mes anterior.
- `programa.json` va con estrategia **red primero** (con el caché de respaldo), para
  que el programa del mes se actualice sin depender de la versión del caché.
- `app.js` escucha `controllerchange` y recarga una vez cuando se activa una versión
  nueva, para que el cambio se vea en la primera apertura y no en la segunda.

---

# Privacidad

El repositorio es **público** (GitHub Pages gratis lo exige) y el programa incluye
nombres de capitanes y direcciones particulares. Hay `robots.txt` y un meta `noindex`:
se llega solo con el link.

**Las direcciones de casas de familia (las marcadas `(FAMILIA ...)`) nunca se
geolocalizan.** Quedan con `coord: null` y solo con el texto de búsqueda para Google
Maps. Es deliberado, no un fallo del geocoder. No "arreglarlo".

---

# Probar los cambios

## En la red local, desde el celular

Hace falta un servidor que mande `Cache-Control: no-store`. **`python3 -m http.server`
a secas no sirve**: manda `Last-Modified` sin `Cache-Control`, el navegador aplica caché
heurístico y termina mostrando la versión anterior — es exactamente el síntoma descrito
en *Service worker*, y hace perder tiempo buscando un bug que no existe.

```python
# guardar fuera del repo y correr: python3 servidor.py 8080
import http.server, socketserver, sys
RAIZ = '/Users/jorgerock/garage/predi-alameda'
class H(http.server.SimpleHTTPRequestHandler):
    def __init__(self, *a, **k): super().__init__(*a, directory=RAIZ, **k)
    def end_headers(self):
        self.send_header('Cache-Control', 'no-store, must-revalidate')
        super().end_headers()
class S(socketserver.ThreadingTCPServer):
    allow_reuse_address = True; daemon_threads = True
with S(('0.0.0.0', int(sys.argv[1])), H) as s: s.serve_forever()
```

La IP local se obtiene con `ipconfig getifaddr en0`. El celular tiene que estar en la
misma WiFi y el firewall de macOS permitir la conexión.

Sobre `http://` en una IP de la red local **no hay contexto seguro**: no se registra el
service worker y el GPS (botón ◎) no funciona. Todo lo demás sí. Para probar esas dos
cosas hace falta HTTPS.

## Verificar de verdad

Este proyecto no tiene tests. La forma de comprobar cambios de interfaz que ha
funcionado es abrir la app en Chrome headless por el protocolo de depuración, emular un
celular, y leer el DOM y sacar capturas:

```bash
"/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" --headless=new \
  --remote-debugging-port=9336 --user-data-dir=/tmp/chr --disable-gpu about:blank
# luego abrir pestaña con PUT a /json/new?<url> y hablar por WebSocket
```

Vale la pena para cualquier cambio de comportamiento: varias de las trampas de arriba
solo aparecieron simulando el flujo completo (celular con la versión vieja instalada →
se publica la nueva → qué ve al abrir).

---

# Estructura

| Archivo | Qué es |
|---|---|
| `index.html` | Interfaz y todos los estilos (no hay CSS aparte) |
| `app.js` | Toda la lógica |
| `sw.js`, `manifest.webmanifest`, `icon-*.png` | Offline e instalación |
| `programa.json` | El programa del mes, generado |
| `territorios.geojson` | Generado: los 58 territorios, manzana por manzana (`n`, `centro`, `color`, `letras`, `nmanzanas`) |
| `envolventes.geojson` | Generado: el contorno de cada territorio, de una pieza |
| `calles.geojson` | Generado por `calles_geojson.py`: calles con nombre, para la vista Dibujo |
| `territorios_trazados.geojson` | El trazado original a mano. Fuente, no se edita |
| `dudosos.json` | Generado: lo que necesita confirmación humana |
| `manzanas.geojson` | Del trazado antiguo. **Quedó obsoleto**, no lo carga nadie |
| `plano.webp`, `plano_bounds.json` | El plano original georreferenciado |
| `parse_programa.py` | PDF → datos crudos |
| `enriquecer_programa.py` | Agrega territorios, coordenadas y tildes |
| `territorios_desde_osm.py` | Rehace los territorios con las cuadras reales |
| `envolventes.py` | Saca las cuadras de OSM y arma los contornos |
| `calles_geojson.py` | Saca de OSM las calles con nombre |
| `cruce.py` | Busca cruces de calles en OpenStreetMap |

## Forma de `programa.json`

```jsonc
{ "mes": 9, "anio": 2026, "titulo": "...", "lema": "...",
  "dias": [ { "dia": 10, "nombre": "JUEVES", "nota": "CAMPAÑA ESPECIAL",
    "actividades": [ {
      "hora": "17:00-19:00",       // rango o instante; la app parte por el guión
      "capitan": "JORGE MORALES",
      "grupo": "GRUPO GENERAL",
      "direccion": "Blanco / Unión Latinoamericana",
      "territorio": "32",          // texto crudo del PDF
      "tipo": "predicacion",       // predicacion | cartas | reunion
      "nombre": "...",             // solo en tipo reunion
      "terr": [32],                // territorio como números, para el mapa
      "calles": false,             // true si la asignación es "CALLES"
      "coord": [-33.45847, -70.67219],   // null si no se ubicó
      "mapsq": "Blanco / Unión Latinoamericana, Santiago, Chile"
    } ] } ] }
```

`territorio` es el texto tal cual del PDF; `terr` y `calles` son su interpretación. La
app usa `terr`, `calles`, `coord` y `mapsq`; `territorio` se conserva para poder
auditar contra el PDF.

## Notas sobre el código

- El idioma del código, los comentarios y los mensajes de commit es **español**.
- La marca de "territorio trabajado" (`localStorage`, `alternarTrabajado`,
  `estaTrabajado`) sigue en `app.js` pero **ya no tiene ningún botón que la active**;
  se quitó de la ficha a pedido. El coloreado verde de trabajado tampoco se activa. Se
  dejó por si se reincorpora en otro lugar.
- La precisión del plano es de unos 6 m: sirve para saber en qué manzana se está, no
  para distinguir números de casa.
