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

Para publicar: reemplaza `programa.json` en el repositorio → ícono del lápiz → pega el
contenido nuevo → **Commit changes**. La app se actualiza sola en unos minutos, incluso
en los celulares que ya la tienen instalada.

El plano (`plano.webp` y `territorios.geojson`) solo hay que rehacerlo si la
congregación cambia los límites de los territorios.

## Qué hay en cada archivo

| Archivo | Para qué sirve |
|---|---|
| `index.html`, `app.js` | La aplicación (interfaz y lógica) |
| `leaflet.js`, `leaflet.css` | Librería del mapa (incluida, no depende de internet) |
| `plano.webp` | El plano original rectificado y georreferenciado |
| `plano_bounds.json` | Esquinas geográficas del plano |
| `territorios.geojson` | Los 58 territorios como polígonos reales |
| `manzanas.geojson` | Cada manzana por separado, con su letra (A, B, C…) |
| `programa.json` | El programa del mes convertido a datos |
| `parse_programa.py` | Convierte el PDF del mes en datos |
| `enriquecer_programa.py` | Le agrega territorios y coordenadas al programa |
| `cruce.py` | Busca cruces de calles en OpenStreetMap |
| `sw.js`, `manifest.webmanifest`, `icon-*.png` | Para que funcione sin conexión e instalada |

## Cómo se usa

- **Flechas ‹ ›** o deslizar sobre la lista: cambiar de día. **Hoy** vuelve al día actual.
- **Mes**: muestra los 31 días en la tira superior en vez de solo la semana.
- Tocar una actividad: el mapa se acerca al territorio y aparece el punto de encuentro.
  **Cómo llegar** abre Google Maps con la ruta.
- Tocar un territorio en el mapa: muestra sus manzanas, en qué días del mes está
  asignado, y permite **marcar trabajado** (queda guardado en ese celular).
- **Plano / Mapa / Ambos**: cambia entre el plano original y el mapa de calles real.
- **◎**: muestra dónde estás y en qué territorio te encuentras.

## Precisión

El plano se alineó con calles reales de OpenStreetMap usando 133 cruces de referencia:
el error medio es de unos **6 metros**, suficiente para saber en qué manzana se está
parado, pero no para distinguir números de casa.
