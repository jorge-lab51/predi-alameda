# Territorios Alameda

Aplicación web para el celular que combina el **plano de los 58 territorios** con el
**programa de predicación del mes**. Funciona sin conexión una vez abierta (salvo la
capa de mapa de calles, que sí necesita datos).

## Antes de publicar: privacidad

GitHub Pages gratis exige repositorio **público**, así que cualquiera que tenga la
dirección puede abrir la app. El programa se publica completo, con los nombres de los
capitanes y las direcciones tal como vienen en el PDF, para que "cómo llegar" funcione
en todos los casos. Para reducir la exposición, la app incluye `robots.txt` y una
etiqueta *noindex*: la página no aparecerá en los resultados de Google, solo se llega
con el link.

Si más adelante prefieres que solo el grupo pueda entrar, se puede mover a Cloudflare
Pages, que permite exigir correo autorizado sin costo, o quitar del `programa.json` las
direcciones particulares.

## Publicar en GitHub Pages (gratis)

1. Entra a <https://github.com> con tu cuenta y crea un repositorio nuevo, por ejemplo
   `territorios-alameda`. Márcalo como **Public** (Pages gratis requiere repo público).
2. Descomprime el ZIP en tu computador. Abre la carpeta `site`, **selecciona todos los
   archivos que están adentro** (no la carpeta) y arrástralos a la página del
   repositorio en **Add file → Upload files**. Confirma con **Commit changes**.
   Es importante subir los archivos sueltos: si subes la carpeta, la dirección
   quedaría con `/site/` al final.
3. Ve a **Settings → Pages**. En *Source* elige **Deploy from a branch**, rama `main`
   y carpeta `/ (root)`. Guarda.
4. Espera 1–2 minutos: arriba aparecerá la dirección, del tipo
   `https://TUUSUARIO.github.io/territorios-alameda/`.
5. Abre esa dirección en el celular y usa **Compartir → Agregar a pantalla de inicio**
   (iPhone) o **⋮ → Instalar aplicación** (Android). Queda como una app más.

## Actualizar el programa cada mes

El único archivo que cambia es `programa.json`. Se genera a partir del PDF del mes en
dos pasos (hace falta Python con `pymupdf`: `pip install pymupdf`):

```bash
python parse_programa.py programa_del_mes.pdf base.json   # PDF -> datos
python enriquecer_programa.py base.json programa.json     # + mapa y "cómo llegar"
```

El primer paso lee la tabla del PDF. Detecta solo el mes, el año, el lema y las
posiciones de las columnas, así que aguanta cambios de diseño entre meses; si el PDF
viniera muy distinto, avisa dejando días o actividades de menos (compara el total que
imprime con el del PDF).

El segundo paso agrega lo que necesita el mapa: el número de territorio, y la
coordenada del punto de encuentro. Reutiliza las coordenadas del `programa.json`
anterior y busca en OpenStreetMap solo los cruces de calles nuevos, dejando un registro
en pantalla de cuáles buscó y cuáles no pudo ubicar. **Las direcciones particulares
(las marcadas con `(FAMILIA ...)`) nunca se geolocalizan**: quedan solo con el texto
para buscar en Google Maps. Si aparece una calle con un nombre que no reconoce, hay que
agregarla al diccionario `CALLES_OSM` dentro de `enriquecer_programa.py`.

Ese paso también repone las tildes que el PDF no trae (Unión, Sazié, Ramón, Reunión…).
Si aparece una palabra nueva sin tilde, se agrega al diccionario `TILDES` del mismo
archivo.

Para publicar: reemplaza `programa.json` en el repositorio → ícono del lápiz → pega el
contenido nuevo → **Commit changes**. La app se actualiza sola en unos minutos, incluso
en los celulares que ya la tienen instalada.

## Si cambian los territorios

`territorios.geojson` y `envolventes.geojson` **se generan**, no se editan a mano:

```bash
python territorios_desde_osm.py
```

Ese script parte del trazado original (`territorios_trazados.geojson`, que no se
toca nunca) y lo rehace usando las cuadras reales de OpenStreetMap. Las
correcciones que ha ido confirmando la congregación están escritas dentro del
propio script, en la lista `CORRECCIONES`, con el motivo de cada una.

El plano (`plano.webp`) solo hay que rehacerlo si cambia el dibujo original.

## Qué hay en cada archivo

| Archivo | Para qué sirve |
|---|---|
| `index.html`, `app.js` | La aplicación (interfaz y lógica) |
| `leaflet.js`, `leaflet.css` | Librería del mapa (incluida, no depende de internet) |
| `plano.webp` | El plano original rectificado y georreferenciado |
| `plano_bounds.json` | Esquinas geográficas del plano |
| `territorios.geojson` | Los 58 territorios, manzana por manzana |
| `envolventes.geojson` | El contorno de cada territorio, de una pieza |
| `territorios_trazados.geojson` | El trazado original a mano, que se conserva como fuente |
| `manzanas.geojson` | Del trazado antiguo. Ya no lo usa nadie |
| `programa.json` | El programa del mes convertido a datos |
| `parse_programa.py` | Convierte el PDF del mes en datos |
| `enriquecer_programa.py` | Le agrega territorios y coordenadas al programa |
| `territorios_desde_osm.py` | Rehace los territorios con las cuadras reales de la ciudad |
| `envolventes.py` | Saca las cuadras reales de OpenStreetMap |
| `cruce.py` | Busca cruces de calles en OpenStreetMap |
| `sw.js`, `manifest.webmanifest`, `icon-*.png` | Para que funcione sin conexión e instalada |

## Cómo se usa

- La tira de arriba muestra **el mes completo** y se desliza. **Hoy** vuelve al día
  actual y deja a la vista la semana en la que cae. Las **flechas ‹ ›**, o deslizar
  sobre la lista, cambian de día.
- Tocar una actividad: el mapa se acerca al territorio, aparece el punto de encuentro
  y se abre una ficha con el capitán, la hora y la dirección. **Cómo llegar** abre
  Google Maps con la ruta. La ficha se cierra con la **✕**.
- Tocar un territorio en el mapa: muestra sus manzanas y cómo llegar a él.
- **Borde / Manzanas**: el territorio se marca envuelto entero, o cuadra por cuadra.
- Con el mapa de calles a la vista aparece **OSM / Gris / Calles / CARTO**, para
  elegir qué mapa de fondo se usa.
- La **barra** sobre el listado lo muestra y lo oculta, para dejar el mapa a pantalla
  completa. Al apuntarla se dobla en forma de flecha, indicando qué hará. Con una
  ficha abierta el listado se recoge solo, y vuelve al cerrarla.
- **Plano / Mapa / Ambos**: cambia entre el plano original y el mapa de calles real.
- **◎**: muestra dónde estás y en qué territorio te encuentras.

## Precisión

El plano se alineó con calles reales de OpenStreetMap usando 133 cruces de referencia:
el error medio es de unos **6 metros**, suficiente para saber en qué manzana se está
parado, pero no para distinguir números de casa.
