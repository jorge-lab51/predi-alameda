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
3. **Los capitanes nuevos**: si alguno queda sin su tilde, se agrega a
   `TILDES_NOMBRES` — ver *Tildes y mayúsculas*.
4. **Las direcciones sin coordenada** que también lista. Deberían ser solo las casas
   de familia (ver *Privacidad*). Si aparece un cruce de calles ahí, es que falta el
   nombre en `CALLES_OSM`.
5. Que los puntos de encuentro caigan cerca de su territorio. Dos casos son normales y
   no son errores: el Salón (punto fijo, lejos del territorio del día) y los días en
   que se juntan en una esquina para trabajar un territorio a varias cuadras.

### Antes de hacer push — obligatorio

Vale para cualquier cambio, no solo para el programa del mes:

1. `node pruebas/revisar.js` — tiene que terminar en 0 mal.
2. **Subir la versión del caché en `sw.js`** (`const CACHE = 'alameda-vN'`) si cambió
   cualquier archivo salvo `programa.json`. Sin eso, los celulares que ya tienen la app
   instalada se quedan con la versión vieja. Ver *Service worker*.
3. Actualizar el `README.md` si cambió cómo se usa la app: está escrito para la
   congregación, no para desarrolladores. Y este archivo si cambió cómo funciona.

Los mensajes de commit van en español, explican **por qué** y no solo qué.

### Después del push

GitHub Pages tarda un par de minutos. Para esperarlo y comprobar el sitio de verdad:

```bash
# esperar a que la versión nueva del caché esté arriba
until curl -s "https://jorge-lab51.github.io/predi-alameda/sw.js?cb=$(date +%s%N)" \
  | grep -q "alameda-vN"; do sleep 5; done

node pruebas/revisar.js --publicado     # las mismas 74 comprobaciones, contra el sitio
```

Comprobar los archivos con `curl` no alcanza: dicen que llegaron, no que la app
funcione. La batería contra `--publicado` la abre de verdad, con su propio service
worker.

Si solo cambió el programa del mes, basta con mirarlo:

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

## Las listas que ajustan el resultado

Todas viven en `territorios_desde_osm.py`, salvo la última, y cada entrada lleva
escrito por qué existe. **Son la forma correcta de corregir el mapa**: nunca editar
los geojson a mano, porque se regeneran.

| Lista | Para qué |
|---|---|
| `REMAPEAR` | rehace las manzanas de un territorio con el detalle del mapa, conservando su contorno. Hoy solo T51, el Parque O'Higgins: se poligoniza con `service` y **sin** sendas peatonales, que lo partían en retazos que no corresponden a nada |
| `CORRECCIONES` | "la cuadra que contiene este punto es de tal territorio". Para cuando el color no desambigua y la congregación confirma |
| `EXCLUIDAS` | cuadras que no son de nadie: plazas, bandejones |
| `PLAZAS` | cuadras que **sí** son del territorio pero no son manzana: se dibujan y se nombran, pero no reciben letra ni se cuentan, porque no hay casas que visitar. Hoy T9, T18 y T22 |
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
- **En la vista Dibujo el nombre se coloca sobre el trozo de calle que se ve**, no
  sobre la calle entera, y se recalcula con cada movimiento del mapa: si no, una calle
  que cruza la pantalla de lado a lado se queda sin nombre porque su medio quedó fuera.
  Desde el medio de lo visible el nombre se corre a lo largo de la calle hasta que cabe
  entero, no pisa otro nombre y no queda bajo las barras de botones; si no hay dónde,
  se prefiere escribirlo bajo una barra antes que no escribirlo. De cada calle partida
  en varios tramos se rotula solo el que más se ve. Ojo con el punto medio: hay que
  medirlo **por distancia, no por vértice** — tras simplificar, muchas calles quedan
  con tres puntos y el vértice del medio cae en un extremo.
- **Para el territorio 58, el plano tiene más información que el mapa.** Se midió: OSM
  solo alcanza a estructurar el 37% de ese sector. Es el caso inverso al resto.

# El lenguaje visual

Está escrito completo en `DESIGN-PROMPT.md`, que vino de otra app y **no se edita**:
es la fuente. Resumen de lo que obliga aquí:

- **Monocromo.** Toda la interfaz sale de una escala de grises neutra. El color solo
  aparece donde significa algo: `--danger` en lo marcado y `--success` en lo hecho.
  Los territorios son la excepción y no son diseño: llevan **el color que les puso el
  plano de la congregación**, que es dato.
- **Nunca un color literal en un componente.** Siempre un token de `:root`
  (`index.html`). Lo que se dibuja en el mapa lo lee con `tok('--danger')`, porque
  Leaflet quiere colores literales y no variables CSS; por eso `ponerTema()` termina
  llamando a `restilarTerr()`.
- **El modo oscuro es el claro invertido**, y va duplicado en dos bloques: el de
  `prefers-color-scheme` y el de `[data-theme="dark"]`.
- **Tipografía Space Grotesk**, variable, en `fonts/` con licencia OFL. Peso 500 para
  casi todo, 400 para el texto secundario. **Sin `font-variant-numeric: tabular-nums`**,
  aunque el prompt lo pida: con la figura tabular esta fuente le pone al `1` un remate
  en la base que se lee como un subrayado, y aquí no hay ninguna columna de números que
  tenga que alinearse. No volver a ponerlo sin mirar cómo queda el 1.
- **Sin sombras** salvo la hoja de ajustes, sin degradados, bordes siempre de 1 px,
  sin emojis ni íconos de librería —los pocos glifos son `‹ › ⋯ ✕`, y el resto son
  SVG de trazo propios.
- **Sin mayúsculas sostenidas en la interfaz.** Lo que sí sale en mayúsculas —nombres
  de capitanes, notas del mes— viene así del PDF: es dato, no rótulo.
- El **tema de la app** (Auto/Claro/Oscuro) se guarda en `KEY_TEMA` y se aplica con un
  script *inline* en el `<head>`, antes del CSS, o la app parpadea en claro al abrir.
  Es **una cosa distinta** del fondo del mapa (`KEY_BASE`) y del papel de la vista
  Dibujo (`KEY_DIB`), que son capas y siguen eligiéndose en el botón de capas.

## Dos juegos de tokens, no uno

Lo que se escribe **encima del mapa** —los números de territorio, las letras de
manzana, los rótulos de calle y la chapa del día— no puede usar `--text` ni `--ink`:
con la app en claro se puede estar mirando el fondo **Oscuro**, y al revés. Para eso
están `--map-ink`, `--map-ink-2` y `--map-paper`, que se redefinen según
`body.fondo-oscuro` (en Mapa) o `body.dibujo-oscuro` (en Dibujo), que son cosas
distintas: hay que mirar además si `body.dibujo` está puesto. `--map-paper` es además
el fondo de la vista Dibujo, así que el papel y el halo de los rótulos salen del mismo
sitio y no se pueden desincronizar.

## Decisiones de la portada que ya se discutieron

- **La tira de días no lleva botones.** Encajonar cada día en una píldora los hacía
  parecer acciones; ahora se leen solos y lo único dibujado es el **disco tinta** del
  día elegido y un aro de 1 px alrededor de hoy.
- **El territorio del día lleva un disco tinta**, el mismo disco de la tira. El rojo
  (`--danger`) quedó para una sola cosa: el territorio que se está mirando. Antes los
  dos eran rojos y competían.
- **Las letras de manzana van en la sans del sistema**, no en la de la app: a 9,5 px
  los remates de la Space Grotesk se empastan. Son anotaciones sobre el mapa, como los
  números del plano, no interfaz.
- **La nota del día es una línea de texto**, no una tarjeta. Como bloque invertido le
  quitaba al listado más alto del que vale un aviso de dos palabras.
- El **1 de la Space Grotesk lleva un remate en la base** cuando está activo
  `tabular-nums`; por eso está apagado. Es la figura tabular de la fuente, no un
  subrayado ni un bug.

## Trampas de portarlo

- **Leaflet pinta de azul todo enlace dentro del mapa** (`.leaflet-container a`) y le
  pone `margin:0` a la atribución (`.leaflet-container .leaflet-control-attribution`).
  Las dos reglas tienen más especificidad que una clase suelta: hay que igualarla.
- **El mapa se mete 18 px bajo la hoja** (`#map{margin-bottom:-18px}`) para que las
  esquinas redondeadas de `#sheet` dejen ver el mapa por detrás y no un recorte del
  fondo de página. Eso deja la **atribución de CARTO tapada**, y hay que subirla con
  `margin-bottom`. No quitarla: es la condición de usar sus teselas. La comprobación
  está en el grupo `diseño`.
- El botón de ajustes va **en absoluto** dentro del header. Si se pone en el flujo, el
  header pasa de 33 a 40+ px y se come el alto del mapa, que es el recurso escaso.
- **El área segura del iPhone se reserva con `max()`, nunca sumándola.**
  `env(safe-area-inset-bottom)` vale **0 en el navegador y ~34 px en la PWA
  instalada**, así que un `calc(6px + var(--safe-b))` se ve perfecto al probarlo en el
  navegador y en el celular deja 40 px de hueco bajo la tira de días —casi el alto de
  la tira entera— sin que se entienda de dónde sale. Con `max(6px, var(--safe-b))`
  queda lo que el sistema pide y nada más. Va en tres sitios: `.datebar`, el `.grab`
  del listado recogido y la hoja de ajustes.
- **La tira de días va sobre `--surface`, no sobre `--bg`.** Esos 34 px reservados
  tienen que leerse como el suelo de la barra —como la barra de pestañas de
  cualquier app de iPhone— y no como un vacío. Con el color de la página parecen un
  error de maquetación. Fue exactamente el síntoma que se reportó.

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

## Tildes y mayúsculas

El PDF viene **sin tildes y todo en mayúsculas sostenidas**. `enriquecer_programa.py`
arregla las dos cosas, en ese orden: primero las mayúsculas, después las tildes,
porque `TILDES` está escrito con la palabra ya capitalizada (`Bascunan`, no
`BASCUNAN`). Nunca se edita `programa.json` a mano: se regenera cada mes.

| Campo | Qué se le hace |
|---|---|
| `nota`, `grupo`, `nombre` | `frase_es`: mayúscula solo en la primera letra |
| `direccion` | `titulo_es`: una mayúscula por palabra, salvo las partículas |
| `capitan` | `titulo_es` + `TILDES_NOMBRES` (o el aviso de `NO_SON_NOMBRES`) |

Cuatro listas gobiernan esto, y cada una está para agregarle entradas a mano:

- `TILDES` — palabra por palabra, para direcciones, grupos y nombres de reunión.
- `TILDES_NOMBRES` — **aparte, y solo para los capitanes**. Mientras el programa venía
  en mayúsculas daba igual: en mayúsculas nadie echa de menos la tilde. Al escribir los
  nombres en minúscula la falta se ve, así que hay que reponerla — pero **no se deduce**:
  cada línea la confirma alguien. Si hay duda no se pone; *Cristian* y *Cristián* son
  los dos nombres reales y no hay cómo saber cuál es.
- `PROPIOS` — palabras que conservan su mayúscula dentro de una frase (hoy, `Zoom`).
- `NO_SON_NOMBRES` — lo que ocupa la columna del capitán sin ser una persona
  (`SIN CAPITAN`, `POR CONFIRMAR`).

`_palabra()` deja intacto lo que trae dígitos, o `408A` se volvería `408a`.

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

# Lo que quedó pendiente

Nada de esto bloquea nada; son decisiones que esperan confirmación de la congregación.

- **Tres cuadras sin resolver en `dudosos.json`** (`"aplicado": false`): las caras 237,
  16 y 430. El color del plano no desambigua porque varios territorios vecinos están
  pintados igual, entre el 51 y el 55. Quedaron como estaban. Para cerrarlas hay que
  preguntar de quién son y agregarlas a `CORRECCIONES`.
- **Las cuatro manzanas chicas de Pje. Uno con Rayén** están hoy en el T29, que es lo
  que dice el color del plano, pero podrían ser del T46. Nadie lo ha confirmado.
- **Tres pedacitos del T51** en el borde oriental, contra la Autopista, podrían sobrar.
  Se dejaron porque el trazado original los tiene.

---

# Privacidad

El repositorio es **público** (GitHub Pages gratis lo exige) y el programa incluye
nombres de capitanes y direcciones particulares. Hay `robots.txt` y un meta `noindex`:
se llega solo con el link.

**Las direcciones de casas de familia (las marcadas `(FAMILIA ...)`) nunca se
geolocalizan.** Quedan con `coord: null` y solo con el texto de búsqueda para Google
Maps. Es deliberado, no un fallo del geocoder. No "arreglarlo".

## La clave de CARTO

Las teselas raster de CARTO exigen clave desde 2026: sin ella vienen con una
filigrana *API KEY REQUIRED* encima. La clave va como parámetro `key` en la URL de
`MAPAS.carto` (`app.js`), **a la vista en el código**, que es lo que permite un sitio
estático en un repo público. La congregación lo aceptó así a sabiendas. Si alguna vez
molesta, se restringe la clave a `jorge-lab51.github.io` desde el panel de CARTO
(carto.com/basemaps/apikey), que es donde también se revoca.

El plan gratis son 5.000.000 de teselas al mes, muy por encima de este uso. CARTO pide
además mantener visible la atribución suya y la de OpenStreetMap: va en el
`attribution` de la capa, no quitarla.

De CARTO se usan los tres estilos (Voyager, Positron y Dark Matter), y de cada uno las
dos mitades que publica: `_nolabels` de fondo y `_only_labels` —transparente, solo los
nombres— en el panel `rotulosMapa`, con `zIndex 450`, **por encima de los territorios
(400) y por debajo de los rótulos de la vista Dibujo (600)**. Sin ese panel el color
opaco de los territorios se traga los nombres de las calles. El panel lleva
`pointerEvents: none`, o las teselas de nombres le robarían el clic al territorio.

Esri también tiene su capa de rótulos aparte (`Canvas/World_Light_Gray_Reference`),
pero solo llega a z16 y al acercar salen gigantes y borrosos: por eso el Gris va sin
nombres.

---

# Probar los cambios

## En la red local, desde el celular

```bash
node pruebas/servir.js          # imprime la dirección para el celular
```

Manda `Cache-Control: no-store`, que es lo que importa: **`python3 -m http.server` a
secas no sirve**, manda `Last-Modified` sin `Cache-Control`, el navegador aplica caché
heurístico y termina mostrando la versión anterior — es exactamente el síntoma descrito
en *Service worker*, y hace perder tiempo buscando un bug que no existe.

El celular tiene que estar en la misma WiFi y el firewall de macOS permitir la
conexión. Sobre `http://` en una IP de la red local **no hay contexto seguro**: no se
registra el service worker y el GPS (botón ◎) no funciona. Todo lo demás sí. Para
probar esas dos cosas hace falta HTTPS.

## La batería de pruebas

```bash
node pruebas/revisar.js              # las 74 comprobaciones, con los archivos del repo
node pruebas/revisar.js fondos       # solo los grupos cuyo nombre contenga eso
node pruebas/revisar.js --publicado  # las mismas, contra el sitio ya publicado
```

**Correrla siempre antes de publicar.** Termina con código 1 si algo falla y deja una
captura en `pruebas/ultima.png`.

No hay que instalar nada: el script levanta su propio servidor sin caché, abre Chrome
headless por el protocolo de depuración, emula un iPhone y lee el DOM. Node 22 ya trae
`WebSocket`, así que el proyecto sigue sin dependencias de npm. Si Chrome no está en
`/Applications/Google Chrome.app`, hay que cambiar la constante `CHROME`.

Los grupos que comprueba: `datos`, `arranque`, `alto` (header, barras y mapa),
`tira de días`, `barra de iconos y vistas`, `desplegable del fondo`, `fondos de mapa`,
`nombres de calle en Dibujo`, `números de territorio`, `letras de manzana`,
`bordes y toques`, `diseño` (tipografía, atribución a la vista y hoja de ajustes). **Al agregar una funcionalidad, agregarle ahí su comprobación**:
casi todas las trampas de este archivo aparecieron simulando el flujo completo en el
navegador, no leyendo el código.

Tres cosas del arnés que cuesta redescubrir:

- **Hay que pasar por encima del service worker** (`Network.setBypassServiceWorker`).
  Si no, la primera carga sirve el `app.js` viejo del caché y se prueba lo que no es.
- Las variables de `app.js` se declaran con `let` en el tope del script, así que
  **no cuelgan de `window`**: hay que evaluarlas como identificadores pelados.
- Toda expresión evaluada tiene que **terminar en un valor simple**. `map.setZoom(15)`
  devuelve el mapa y el protocolo responde *Object reference chain is too long*; por
  eso los `ev(...)` terminan en `; 1`.

---

# Estructura

| Archivo | Qué es |
|---|---|
| `index.html` | Interfaz y todos los estilos (no hay CSS aparte) |
| `app.js` | Toda la lógica |
| `sw.js`, `manifest.webmanifest`, `icon-*.png` | Offline e instalación |
| `DESIGN-PROMPT.md` | El lenguaje visual, tal como llegó de la otra app. Fuente, no se edita |
| `fonts/` | Space Grotesk variable (`woff2`) y su licencia OFL |
| `icono.py` | Genera `icon-192.png`, `icon-512.png` y `icon-maskable-512.png` |
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
| `pruebas/revisar.js` | La batería de comprobaciones en el navegador |
| `pruebas/servir.js` | Servidor sin caché para probar desde el celular |

## Por dónde anda cada cosa en `app.js`

Un solo archivo, sin módulos. De arriba a abajo:

| Zona | Qué hay |
|---|---|
| Constantes | `MAPAS` (los seis fondos), claves de `localStorage`, estado suelto (`diaSel`, `terrSel`, `modoTerr`, `dibujo`, `dibujoOscuro`) |
| `cargar()` | Baja los cinco archivos de datos y arranca todo |
| `iniciarMapa()` | Crea el mapa, el panel `rotulosMapa`, cuelga los eventos y ata **todos** los botones de las barras |
| `baseInicial()` / `dibujoInicial()` / `ponerDibujoOscuro()` | Qué fondo y qué papel al abrir |
| `ponerMapaBase()` / `actualizarBarraBase()` / `desplegarFondo()` | El fondo del mapa y su desplegable |
| `construirCalles()` / `colocarRotulos()` y ayudantes | Los nombres de calle de la vista Dibujo |
| `estiloTerr()` / `grueso()` / `restilarTerr()` | Cómo se pinta cada territorio |
| `construirTerritorios()` / `pintarTerritorios()` / `pintarNumeros()` / `pintarLetras()` | Las capas del mapa |
| `seleccionarTerritorio()` / `resaltarTerritorio()` / `limpiarSeleccion()` / `mostrarPanel()` | La ficha del territorio |
| `render()` / `pintarSemana()` / `posicionarTira()` / `pintarLista()` | El programa del día y la tira de días |
| `ajustarHoja()` | Mostrar y ocultar el listado |
| `ubicar()` | El GPS del botón ◎ |

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
- **La interfaz se comprime a propósito.** El header es **una línea** con el nombre de
  la app y el mes (33 px), con el botón de ajustes puesto encima en absoluto; la navegación por días vive **al pie de `#sheet`**, bajo el
  listado, y se recoge con él; las tres barras que había sobre el mapa son **una sola
  de iconos**, con el mapa de fondo en un desplegable que solo cierra su propio botón.
  El mapa pasó de 152 a 595 px con el listado recogido en un iPhone SE. No volver a
  apilar barras ni filas de header: el alto del mapa es el recurso escaso. El nombre de
  cada icono se muestra con `aviso()` al tocarlo.
- **Las letras de manzana (`pintarLetras`) salen solo con un territorio marcado.** Se
  anclan en el vértice **más al noroeste** de cada manzana —el que maximiza
  `lat - lon*cos(lat)`, porque las cuadras del barrio están giradas y mirar solo la
  latitud no da la esquina de la izquierda— y el rótulo se dibuja hacia abajo y a la
  derecha, que es donde está la cuadra, así que la letra cae dentro sea cual sea la
  orientación. Se recorta con `coordinates.slice(0, letras.length)`, que
  funciona porque `territorios_desde_osm.py` escribe **las plazas al final** del
  MultiPolygon; si eso cambiara, las letras se correrían de manzana.
- **Los números de territorio (`pintarNumeros`) salen solo en Mapa y en Dibujo.** En
  Plano y en Ambos el plano ya trae los suyos impresos y salir dos veces confunde; la
  condición es `dibujo || (mapa a la vista && plano no)`. Se saltan los territorios del
  día, que ya llevan chapa roja, se ocultan bajo `ZOOM_NUMEROS` para no amontonarse, y
  van `interactive:false` para que el clic lo reciba la manzana de abajo. El color se
  invierte con `body.fondo-oscuro` (Mapa) o `body.dibujo-oscuro` (Dibujo), que son
  cosas distintas: hay que mirar además si `body.dibujo` está puesto.
- **El grosor de los bordes de territorio va con el zoom** (`grueso()`): a ancho fijo,
  alejado el borde rojo del territorio marcado es más grueso que la manzana que rodea y
  el territorio se ve como una mancha. Por eso `restilarTerr()` cuelga de `zoomend`, y
  cuelga en `iniciarMapa()` y no en `construirCalles()`, que se salta si falta
  `calles.geojson`.
- **La vista Dibujo tiene su propio claro/oscuro**, aparte del del sistema: es un
  dibujo, no una interfaz. Lo elige el mismo botón de capas, que cambia de contenido
  según la vista (`actualizarBarraBase`). Se guarda en `KEY_DIB` **solo al elegirlo a
  mano**: si se guardara el valor deducido del sistema, cambiar el celular a claro ya
  no tendría efecto. Mismo criterio que `KEY_BASE`.
- **Todo lo que va dentro de `#map` necesita `L.DomEvent.disableClickPropagation`.**
  Si no, tocar un botón cuenta además como clic en el mapa, y el desplegable del fondo
  se cierra en el mismo toque que lo abre.
- **`.week` lleva `position:relative`**, porque `posicionarTira()` usa el `offsetLeft`
  de los chips: sin eso se mide contra el header y la tira se corre el ancho de la
  flecha. Si la semana no cabe entera, se corre lo justo para que el día elegido se vea
  completo. Con el listado recogido la tira no tiene ancho y no se puede posicionar:
  `ajustarHoja()` la recoloca al volver a mostrarla.
- **Con qué abre la app**: vista `mapa`, territorios en `manzanas` y fondo `carto` —o
  `oscuro` si `prefers-color-scheme` es oscuro, ver `baseInicial()`. La vista y el modo
  de marcado se fijan en cada apertura y no se guardan; el fondo sí (`KEY_BASE`), y lo
  guardado manda sobre el modo oscuro del sistema. El orden de los botones en cada
  barra sigue ese mismo criterio: primero el que viene por defecto.
- La marca de "territorio trabajado" (`localStorage`, `alternarTrabajado`,
  `estaTrabajado`) sigue en `app.js` pero **ya no tiene ningún botón que la active**;
  se quitó de la ficha a pedido. El coloreado verde de trabajado tampoco se activa. Se
  dejó por si se reincorpora en otro lugar.
- La precisión del plano es de unos 6 m: sirve para saber en qué manzana se está, no
  para distinguir números de casa.
