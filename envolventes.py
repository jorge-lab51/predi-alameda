"""Genera `envolventes.geojson`: el contorno de cada territorio, de una pieza.

`territorios.geojson` guarda cada manzana por separado, así que el mapa dibuja
una mancha por manzana. Este script calcula, para cada territorio, un contorno
único que envuelve todas sus manzanas y las calles entre ellas.

Cómo lo hace:

1. Baja la red de calles de OpenStreetMap y la "poligoniza": las caras que
   quedan encerradas entre calles son las cuadras reales de la ciudad.
2. Cada cuadra real se adjudica a **un solo** territorio: aquel que más
   superficie dibujada tiene dentro de ella. Así dos territorios nunca se
   solapan, y el contorno cae exactamente sobre las calles.
3. Donde OSM no sirve —zonas sin calles interiores mapeadas, que dan caras de
   varias hectáreas, o manzanas que son parcelas sueltas— se descarta la cara y
   se usa un plan B: dilatar las manzanas dibujadas, unirlas y volver a
   contraerlas, de modo que se traguen la calle que las separa.

Uso:  python envolventes.py [salida.geojson]
"""
import json, math, os, sys
from shapely.affinity import scale
from shapely.geometry import LineString, mapping, shape
from shapely.ops import polygonize, snap, unary_union
from shapely.validation import make_valid
from shapely.strtree import STRtree

import cruce

TERRITORIOS = 'territorios.geojson'
CACHE_OSM = 'calles_cache.json'      # respuesta cruda de Overpass, ignorada por git

M = 111320.0                          # metros por grado de latitud
COS = math.cos(math.radians(-33.46))  # corrección de longitud en esta latitud

# tipos de vía que delimitan una cuadra ('service' queda fuera: son accesos y
# estacionamientos, y parten las cuadras en pedazos)
CALLES = {'motorway', 'trunk', 'primary', 'secondary', 'tertiary',
          'residential', 'unclassified', 'living_street', 'pedestrian'}
# varios pasajes del sector están en OSM como 'footway'. Se suman los que tienen
# nombre y no son vereda ni paso de cebra: son pasajes de verdad y parten la
# manzana. Sin ellos, manzanas como la de Tucapel con Rayén salen de una pieza.
PASAJES = 'footway'

# Tramos que existen en la realidad pero faltan en OpenStreetMap, y sin los
# cuales la manzana no se cierra. Cada uno es una lista de puntos (lon, lat).
CONEXIONES = [
    # Pasaje Cinco sigue hasta Raymahuida: en OSM termina al llegar a Pasaje
    # Rayén, pero en la práctica continúa, con un pequeño quiebre, hasta
    # enganchar con Tegualda, que sí llega a Raymahuida.
    [(-70.675976, -33.462807), (-70.675956, -33.462610)],
    # los pasajes El Sol y El Boldo llegan al norte de su manzana pero en OSM
    # se cortan 13 m antes de Manuel de Amat, por el sur
    [(-70.670701, -33.468208), (-70.670700, -33.468327)],
    [(-70.670917, -33.468209), (-70.670916, -33.468328)],
    # la calle peatonal que pasa por encima de la Plaza Manuel Rodríguez sí se
    # camina, pero en OSM le faltan 11 m para llegar a Almirante Latorre
    [(-70.664749, -33.451067), (-70.664652, -33.451058)],
    # la manzana del T22 que llega a Av. Manuel Rodríguez Sur, junto a la
    # Autopista, son en realidad dos: arriba la plaza (la media luna verde del
    # plano) y abajo la manzana. Nada las separa en OSM, así que el corte va
    # trazado por donde el plano deja de estar pintado de verde.
    [(-70.659441, -33.453522), (-70.658798, -33.453344)],
]

TOLERANCIA_M = 2          # cuánto se puede mover un tramo a mano para engancharse
CARA_MAXIMA_M2 = 90000    # más grande que esto no es una cuadra
CARA_MAXIMA_VECES = 4     # ni una cara 4 veces mayor que lo dibujado dentro
RADIO_CIERRE_M = 26       # medio ancho de calle a tragarse en el plan B
SUAVIZADO_M = 2


def m2(area_en_grados):
    return area_en_grados * (M ** 2) * COS


def a_metrico(g):
    """Escala en x para que un buffer circular en grados lo sea en metros."""
    return scale(g, xfact=COS, yfact=1, origin=(0, 0))


def a_grados(g):
    return scale(g, xfact=1 / COS, yfact=1, origin=(0, 0))


def calles_osm():
    if os.path.exists(CACHE_OSM):
        return json.load(open(CACHE_OSM))
    q = f'''[out:json][timeout:180];
(way["highway"~"^({"|".join(sorted(CALLES))})$"]({cruce.BBOX});
 way["highway"="{PASAJES}"]["name"]["footway"!~"sidewalk|crossing"]({cruce.BBOX}););
(._;>;);out body;'''
    d = cruce.consulta(q)
    json.dump(d, open(CACHE_OSM, 'w'))
    return d


def cuadras_reales():
    """Las caras que la red de calles encierra: las cuadras de la ciudad."""
    d = calles_osm()
    nodos = {e['id']: (e['lon'], e['lat']) for e in d['elements'] if e['type'] == 'node'}
    lineas = []
    for w in d['elements']:
        if w['type'] != 'way':
            continue
        t = w.get('tags', {})
        h = t.get('highway')
        if h not in CALLES and not (h == PASAJES and t.get('name')
                                    and t.get('footway') not in ('sidewalk', 'crossing')):
            continue
        pts = [nodos[n] for n in w['nodes'] if n in nodos]
        if len(pts) > 1:
            lineas.append(LineString(pts))
    # los tramos a mano se escriben con coordenadas redondeadas y quedan a unos
    # centímetros de la calle: `snap` los engancha a los vértices vecinos
    if CONEXIONES:
        red = unary_union(lineas)
        for c in CONEXIONES:
            lineas.append(snap(LineString(c), red, TOLERANCIA_M / M))
    return list(polygonize(unary_union(lineas)))


def limpiar(g, minimo_m2=200):
    """Sanea la geometría y descarta las astillas que dejan los recortes."""
    if g.is_empty:
        return g
    if not g.is_valid:
        g = make_valid(g)
    partes = [p for p in (g.geoms if hasattr(g, 'geoms') else [g])
              if p.geom_type in ('Polygon', 'MultiPolygon') and m2(p.area) >= minimo_m2]
    return unary_union(partes) if partes else g.buffer(0)


def cierre(polys, radio_m=RADIO_CIERRE_M):
    """Plan B: dilatar, unir y contraer para tragarse las calles."""
    r = radio_m / M
    juntos = unary_union([a_metrico(p) for p in polys])
    return a_grados(juntos.buffer(r, join_style=2).buffer(-r, join_style=2))


def generar(salida='envolventes.geojson', log=print):
    terr = json.load(open(TERRITORIOS, encoding='utf-8'))
    manzanas = {f['properties']['n']:
                [shape({'type': 'Polygon', 'coordinates': p})
                 for p in f['geometry']['coordinates']]
                for f in terr['features']}
    propio = {n: unary_union(v) for n, v in manzanas.items()}

    caras = cuadras_reales()
    log(f'cuadras reales encontradas en OpenStreetMap: {len(caras)}')

    # cada cuadra real, a un solo territorio: el que más superficie tiene dentro
    duenos = {}
    for j, c in enumerate(caras):
        mejor, cuanto = None, 0
        for n, g in propio.items():
            if not c.intersects(g):
                continue
            a = c.intersection(g).area
            if a > cuanto:
                mejor, cuanto = n, a
        if mejor is None:
            continue
        # se descarta la cara si es enorme o desproporcionada respecto de lo
        # que el territorio tiene dibujado dentro: ahí OSM no tiene las calles
        if m2(c.area) > CARA_MAXIMA_M2 or c.area > CARA_MAXIMA_VECES * cuanto:
            continue
        duenos.setdefault(mejor, []).append(j)

    aceptado = {n: unary_union([caras[j] for j in js]) for n, js in duenos.items()}

    # el plan B se recorta contra lo que ya es de otros, para no invadirlos
    con_plan_b = {}
    for n in sorted(manzanas):
        cub = aceptado.get(n)
        sueltas = [g for g in manzanas[n]
                   if cub is None or g.intersection(cub).area / g.area < 0.5]
        if not sueltas:
            continue
        ajeno = unary_union([g for m, g in aceptado.items() if m != n] +
                            [propio[m].buffer(3 / M) for m in manzanas if m != n])
        con_plan_b[n] = (limpiar(cierre(sueltas).difference(limpiar(ajeno, 0))), len(sueltas))

    env = {}
    for n in sorted(manzanas):
        piezas = [g for g in (aceptado.get(n), con_plan_b.get(n, (None,))[0]) if g is not None]
        env[n] = limpiar(unary_union(piezas).simplify(SUAVIZADO_M / M))

    # último repaso: si dos aún se pisan, la zona queda para el que más
    # superficie dibujada tenga dentro
    ns = sorted(env)
    for i, a in enumerate(ns):
        for b in ns[i + 1:]:
            if not env[a].intersects(env[b]):
                continue
            comun = env[a].intersection(env[b])
            if m2(comun.area) <= 50:
                continue
            perdedor = a if propio[a].intersection(comun).area < propio[b].intersection(comun).area else b
            env[perdedor] = limpiar(env[perdedor].difference(comun))

    feats = []
    for n in sorted(env):
        props = dict(next(f['properties'] for f in terr['features'] if f['properties']['n'] == n))
        feats.append({'type': 'Feature', 'properties': props, 'geometry': mapping(env[n])})
    json.dump({'type': 'FeatureCollection', 'features': feats},
              open(salida, 'w', encoding='utf-8'), ensure_ascii=False)

    log(f'\ncon plan B (OSM no alcanzó): {len(con_plan_b)} territorios')
    for n, (_, s) in sorted(con_plan_b.items()):
        log(f'   T{n}: {s} de {len(manzanas[n])} manzanas')
    return feats, manzanas, propio


if __name__ == '__main__':
    feats, manzanas, propio = generar(sys.argv[1] if len(sys.argv) > 1 else 'envolventes.geojson')

    # --- comprobaciones ---------------------------------------------------
    env = {f['properties']['n']: shape(f['geometry']) for f in feats}
    malas = []
    for n, g in env.items():
        c = propio[n].intersection(g).area / propio[n].area
        if c < 0.99:
            malas.append((round(c, 2), n))
    print(f'\ncubren sus manzanas por completo: {len(env) - len(malas)} de {len(env)}')
    if malas:
        print('   incompletas:', sorted(malas))
    ns = sorted(env)
    sol = [(a, b) for i, a in enumerate(ns) for b in ns[i + 1:]
           if env[a].intersects(env[b]) and m2(env[a].intersection(env[b]).area) > 50]
    print(f'territorios que se solapan (>50 m2): {len(sol)}' + (f' -> {sol}' if sol else ''))
    partes = [1 if g.geom_type == 'Polygon' else len(g.geoms) for g in env.values()]
    print(f'de una sola pieza: {partes.count(1)} de {len(partes)}')
    print(f'tamaño del archivo: {os.path.getsize("envolventes.geojson") / 1024:.0f} kB')
