"""Reconstruye los territorios usando las cuadras reales de la ciudad.

El `territorios.geojson` original no contenía cuadras sino el contorno trazado
a mano de las construcciones de cada manzana: polígonos de hasta 56 vértices,
con puntas, que además arrastraban errores de asignación (manzanas de un
territorio metidas en otro, y manzanas faltantes).

Este script los rehace:

1. Baja la red de calles de OpenStreetMap y la poligoniza. Cada cara encerrada
   entre calles es una cuadra real.
2. Muestrea el **color del plano** dentro de cada cuadra. El plano pinta cada
   territorio de un color, así que el color es una fuente de verdad
   independiente de los datos que se están corrigiendo.
3. Adjudica cada cuadra a un territorio combinando las dos señales: dónde caen
   las manzanas trazadas, y de qué color está pintada la cuadra en el plano.
   Cuando ambas coinciden, la cuadra queda asignada sin más. Cuando discrepan y
   el color apunta a un único territorio vecino, manda el color. Cuando el color
   no desambigua —dos territorios vecinos pintados igual— la cuadra se marca
   como dudosa y se deja como estaba, para revisión humana.
4. Donde OpenStreetMap no tiene calles interiores (el Parque O'Higgins, el Club
   Hípico, la zona de ferrocarriles) no hay cuadras que usar: ahí se conservan
   las manzanas trazadas, regularizadas.

Escribe `territorios.geojson` (las manzanas), `envolventes.geojson` (el contorno
de cada territorio) y `dudosos.json` (lo que necesita revisión).

Uso:  python territorios_desde_osm.py
"""
import collections, json, math, os, sys

import numpy as np
from PIL import Image
from shapely.affinity import scale
from shapely.geometry import LineString, Point, Polygon, mapping, shape
from shapely.ops import polygonize, unary_union
from shapely.strtree import STRtree
from shapely.validation import make_valid

import cruce
import envolventes as E

Image.MAX_IMAGE_PIXELS = None

PLANO = 'plano.webp'
BOUNDS = 'plano_bounds.json'
ORIGEN = 'territorios_trazados.geojson'   # el trazado a mano original, intacto
SALIDA_MZ = 'territorios.geojson'
SALIDA_ENV = 'envolventes.geojson'
SALIDA_DUDAS = 'dudosos.json'

MUESTRAS = 26          # rejilla de muestreo de color dentro de cada cuadra
# Dos colores del plano se consideran el mismo si están más cerca que esto.
# Redondear a cubetas fijas no sirve: T29 (#780b3c) y T46 (#74163c) son el mismo
# granate y caían en cubetas distintas, lo que inventaba correcciones.
DIST_COLOR = 34
MIN_SOLAPE = 0.10      # cuánto de una cuadra debe cubrir lo trazado para contar
SEPARACION_M = 14      # ancho de calle que se deja entre manzanas vecinas
SEPARACION_MAX = 0.35  # pero nunca más de esta fracción del lado corto
ABECEDARIO = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'


def letras_posibles(cuantas):
    """A, B, ... Z, AA, AB, … para los territorios de más de 26 manzanas."""
    salida = list(ABECEDARIO)
    i = 0
    while len(salida) < cuantas + 26:
        salida += [ABECEDARIO[i] + b for b in ABECEDARIO]
        i += 1
    return salida

# Correcciones confirmadas por la congregación, para los casos en que el plano
# pinta del mismo color a dos territorios vecinos y el color no puede decidir.
# Cada entrada dice: la cuadra que contiene este punto es de este territorio.
CORRECCIONES = [
    # la manzana bajo Blanco Encalada, entre San Alfonso y Bascuñán Guerrero:
    # el plano la pinta del mismo granate que T23, pero es de T31
    (-70.674139, -33.458974, 31),
    (-70.677215, -33.451799, 1),    # el hueco que quedaba al medio de T1
    (-70.669160, -33.449247, 4),    # la rotonda del medio de T4
    (-70.664689, -33.454145, 21),   # Latorre con Toesca, al sur de Toesca (estaba en T17)
    (-70.659132, -33.453392, 22),   # la plaza sur junto a la Autopista (estaba en T18)
    (-70.672528, -33.456222, 20),   # la manzana entre el 19 y el 20 (estaba en T34)
    (-70.672380, -33.457153, 24),   # el triángulo Unión Latinoamericana / Abate Molina / Gay
    # sector sur
    (-70.675626, -33.463599, 34),   # Fray Luis de la Peña / San Vicente / Guacolda / Conferencia (estaba en T29)
    (-70.675090, -33.465913, 34),   # San Vicente / Espiñeira / Conferencia / Antofagasta (estaba en T36)
    (-70.673873, -33.465616, 35),   # Conferencia / Espiñeira / San Alfonso / Antofagasta (estaba en T36)
    (-70.671759, -33.465612, 37),   # Bascuñán Guerrero / Espiñeira / Abate Molina (estaba en T48)
    (-70.670528, -33.467865, 41),   # el triángulo entre Mirador, El Boldo y Manuel de Amat
    (-70.670818, -33.467905, 41),   # la manzana que forman los pasajes El Sol y El Boldo
    (-70.675917, -33.465986, 33),   # la tira entre Los Suspiros y Espiñeda, en Antofagasta
                                    # con San Vicente: el crema de T33 y el de T36 son casi
                                    # el mismo y se la llevaba T36, que está a 300 m
    (-70.669635, -33.470075, 46),   # Sepúlveda Leyton / El Trigal / El Trébol / Rondizzoni
    (-70.668118, -33.472086, 55),   # al sur de San Dionisio (estaba en T54)
    (-70.672723, -33.471270, 58),   # entre Bascuñán, Rondizzoni, San Alfonso y San Dionisio
    (-70.671885, -33.471469, 58),   #   (las tres estaban en T57)
    (-70.672304, -33.471266, 58),
]

# Excepción para el territorio 58 al poniente de San Alfonso. Ahí el plano
# dibuja manzanas que en el mapa no existen: en la realidad es un solo bloque
# recorrido por pasajes, encajado entre Ramón Subercaseaux, San Alfonso y el
# patio de ferrocarriles. Se arma solo desde el mapa —la cuadra que contiene el
# punto, menos la faja de vías férreas, con los huecos interiores rellenos— y
# reemplaza a las manzanas que el plano ponía ahí. No afecta a ningún otro
# territorio ni al resto de T58.
BLOQUE_UNICO = [
    {'territorio': 58, 'punto': (-70.675057, -33.471611),
     'limite_este': -70.67293, 'margen_vias_m': 18},
]

# Territorios cuyas manzanas se rehacen con el detalle del mapa. En un parque
# las "manzanas" del plano no corresponden a nada que se pueda recorrer, pero el
# mapa sí trae los caminos interiores. El contorno del territorio no cambia:
# solo se reemplaza lo que tiene por dentro.
REMAPEAR = [
    # El parque se recorre por sus caminos de verdad, no por las sendas
    # peatonales: incluirlas lo partía en retazos que no corresponden a nada.
    {'territorio': 51, 'minimo_m2': 5000, 'vias': ('service',)},
]
CACHE_FINO = 'fino_cache.json'      # red detallada, ignorada por git

# Cuadras que no son de ningún territorio: plazas y bandejones que el plano no
# cuenta como manzana. Cada punto nombra la cuadra que hay que dejar fuera.
EXCLUIDAS = [
    (-70.655799, -33.472797),   # la plaza entre Viel y Pedro Montt
    (-70.655979, -33.473184),   # la plaza chica de al lado
]

# Zonas que no coinciden con una cuadra y hay que recortar de donde caen para
# pasarlas a otro territorio. Se buscan en OpenStreetMap por su nombre.
#
# Va vacía a propósito. Se probó con la Plaza Perpetuo Socorro y no funciona:
# lo que OSM llama así no es una plaza dentro de una manzana, sino una franja
# de 78 x 188 m tendida a lo largo de Blanco Encalada. Recortarla parte en
# astillas las manzanas de T23 y T30, porque las cruza en diagonal. Las
# manzanas deben conservar su contorno de cuadra completa; lo que cae sobre la
# calzada no es de nadie.
RECORTES = []
CACHE_RECORTES = 'recortes_cache.json'
CACHE_VIAS = 'vias_cache.json'      # vías férreas, ignorado por git

RADIOS_COLA_M = (5, 6, 8, 10)  # radios con que se intenta separar una cola
MIN_TRAZADO_M2 = 150           # trazado propio mínimo para que un trozo cuente
ASTILLA_ANCHO_M = 25    # más angosto que esto no es una cuadra
ASTILLA_RODEADA = 0.85  # cuánto de su borde debe compartir con un solo vecino


# --------------------------------------------------------------- color del plano
class Plano:
    def __init__(self):
        b = json.load(open(BOUNDS))
        (self.la0, self.lo0), (self.la1, self.lo1) = b['bounds']
        self.W, self.H = b['w'], b['h']
        self.img = np.asarray(Image.open(PLANO).convert('RGB'))

    def pixel(self, lon, lat):
        return (int((lon - self.lo0) / (self.lo1 - self.lo0) * self.W),
                int((self.la1 - lat) / (self.la1 - self.la0) * self.H))

    def color(self, g):
        """Color dominante dentro de `g`, ignorando calles (blanco) y textos."""
        minx, miny, maxx, maxy = g.bounds
        vals = []
        for i in range(MUESTRAS):
            for j in range(MUESTRAS):
                x = minx + (maxx - minx) * (i + .5) / MUESTRAS
                y = miny + (maxy - miny) * (j + .5) / MUESTRAS
                if not g.contains(Point(x, y)):
                    continue
                a, b = self.pixel(x, y)
                if not (0 <= a < self.W and 0 <= b < self.H):
                    continue
                r, v, z = (int(c) for c in self.img[b, a])
                if r > 225 and v > 225 and z > 225:      # calle o fondo
                    continue
                if r < 40 and v < 40 and z < 40:          # texto
                    continue
                vals.append((r, v, z))
        if not vals:
            return None
        # la mediana por canal resiste el texto y los bordes mejor que la moda
        a = sorted(v[0] for v in vals); b = sorted(v[1] for v in vals); c = sorted(v[2] for v in vals)
        m = len(vals) // 2
        return (a[m], b[m], c[m])


# --------------------------------------------------------------- utilidades
def regularizar(g):
    """Endereza un polígono trazado a mano hacia su rectángulo mínimo."""
    r = g.minimum_rotated_rectangle
    # solo si de verdad es casi rectangular; si no, se simplifica y basta
    if r.area > 0 and g.area / r.area >= 0.86:
        return r
    return g.simplify(3 / E.M).buffer(0)


def lados(g):
    """Lado corto y lado largo del rectángulo mínimo, en metros."""
    pts = list(g.minimum_rotated_rectangle.exterior.coords)
    l = [math.hypot((pts[i + 1][0] - pts[i][0]) * E.M * E.COS,
                    (pts[i + 1][1] - pts[i][1]) * E.M) for i in range(4)]
    return min(l), max(l)


def faja_vias(bbox):
    """La superficie que ocupan las vías férreas, para usarla como borde."""
    if os.path.exists(CACHE_VIAS):
        d = json.load(open(CACHE_VIAS))
    else:
        q = (f'[out:json][timeout:150];way["railway"]({bbox});(._;>;);out body;')
        d = cruce.consulta(q)
        json.dump(d, open(CACHE_VIAS, 'w'))
    nodos = {e['id']: (e['lon'], e['lat']) for e in d['elements'] if e['type'] == 'node'}
    lineas = []
    for w in d['elements']:
        if w['type'] != 'way' or w.get('tags', {}).get('railway') in ('platform', 'turntable'):
            continue
        pts = [nodos[n] for n in w['nodes'] if n in nodos]
        if len(pts) > 1:
            lineas.append(LineString(pts))
    return lineas


def bloque_unico(caras, cfg):
    """Arma desde el mapa el bloque que reemplaza a varias manzanas."""
    p = Point(*cfg['punto'])
    cara = next((c for c in caras if c.contains(p)), None)
    if cara is None:
        return None
    b = cara.bounds
    lineas = faja_vias(f'{b[1]-0.002},{b[0]-0.002},{b[3]+0.002},{b[2]+0.002}')
    r = cfg['margen_vias_m'] / E.M
    franja = unary_union([E.a_metrico(l).buffer(r) for l in lineas]) if lineas else None
    resto = E.a_metrico(cara)
    if franja is not None:
        resto = make_valid(resto.difference(franja)).buffer(0)
    for parte in (resto.geoms if resto.geom_type != 'Polygon' else [resto]):
        if parte.geom_type != 'Polygon':
            continue
        g = E.a_grados(parte)
        if not g.contains(p):
            continue
        # las cuadras que el bloque rodea se anexan para que el contorno quede
        # entero, pero se devuelven aparte: siguen siendo manzanas propias
        dentro = []
        for otra in caras:
            if otra.equals(cara) or not otra.intersects(g.buffer(2 / E.M)):
                continue
            compartido = otra.exterior.intersection(g.buffer(2 / E.M)).length
            if compartido / otra.exterior.length >= 0.7:
                dentro.append(otra)
                g = make_valid(unary_union([g, otra])).buffer(0)
        g = max((q for q in (g.geoms if g.geom_type != 'Polygon' else [g])
                 if q.geom_type == 'Polygon'), key=lambda q: q.area)
        return Polygon(g.exterior), dentro      # con los huecos rellenos
    return None, []


def malla_fina(bbox, extra):
    """Poligoniza un sector sumando caminos que no son calles."""
    guardado = json.load(open(CACHE_FINO)) if os.path.exists(CACHE_FINO) else {}
    if bbox not in guardado:
        guardado[bbox] = cruce.consulta(
            f'[out:json][timeout:180];way["highway"]({bbox});(._;>;);out body;')
        json.dump(guardado, open(CACHE_FINO, 'w'))
    d = guardado[bbox]
    nodos = {e['id']: (e['lon'], e['lat']) for e in d['elements'] if e['type'] == 'node'}
    tipos = set(E.CALLES) | set(extra)
    lineas = []
    for w in d['elements']:
        if w['type'] != 'way' or w.get('tags', {}).get('highway') not in tipos:
            continue
        pts = [nodos[n] for n in w['nodes'] if n in nodos]
        if len(pts) > 1:
            lineas.append(LineString(pts))
    return list(polygonize(unary_union(lineas)))


def mismo_color(a, b):
    """¿Son el mismo color del plano, admitiendo el ruido del webp?"""
    if a is None or b is None:
        return False
    return sum((x - y) ** 2 for x, y in zip(a, b)) <= DIST_COLOR ** 2


def sin_cola(c, propio):
    """Quita la cola que una cuadra tiende sobre la calzada.

    Donde una avenida partida no está mapeada de forma pareja, la cara que
    devuelve la poligonización arrastra una lengua de asfalto pegada a la
    manzana por un cuello estrecho. Se separa con una apertura morfológica y
    se descarta el trozo que no contiene ninguna manzana dibujada del propio
    territorio: si nadie dibujó nada ahí, no es parte del territorio.

    Si la apertura no llega a separar nada, la cuadra se devuelve intacta: así
    no se erosionan las manzanas angostas que sí son legítimas.
    """
    for w in RADIOS_COLA_M:
        r = w / E.M
        abierta = E.a_grados(E.a_metrico(c).buffer(-r, join_style=2)
                           .buffer(r, join_style=2)).intersection(c)
        if abierta.is_empty:
            continue
        partes = [p for p in (abierta.geoms if abierta.geom_type != 'Polygon' else [abierta])
                  if p.geom_type == 'Polygon']
        if len(partes) < 2:
            continue
        buenas = [p for p in partes
                  if E.m2(p.intersection(propio).area) >= MIN_TRAZADO_M2]
        if not buenas or len(buenas) == len(partes):
            continue
        # se devuelve cada trozo bueno a su extensión completa dentro de la cara
        entero = unary_union([c.intersection(E.a_grados(E.a_metrico(p).buffer(r, join_style=2)))
                              for p in buenas])
        if not entero.is_empty:
            return entero
    return c


def es_tira(g):
    """¿Es el bandejón de una avenida partida y no una cuadra?

    Al poligonizar, una avenida de dos calzadas deja entre ellas una cara
    larga y angosta. No es una manzana: si se le adjudica a un territorio,
    aparece un "cacho" de color sobre la calzada.
    """
    corto, largo = lados(g)
    return corto < ASTILLA_ANCHO_M and largo / max(corto, 1) > 3


def zonas_recortadas():
    """Baja de OpenStreetMap los polígonos nombrados en RECORTES."""
    if os.path.exists(CACHE_RECORTES):
        guardado = json.load(open(CACHE_RECORTES))
    else:
        guardado = {}
        for nombre, clave, _ in RECORTES:
            q = (f'[out:json][timeout:90];way["name"~"{nombre}",i]["{clave}"]'
                 f'({cruce.BBOX});(._;>;);out body;')
            d = cruce.consulta(q)
            nodos = {e['id']: (e['lon'], e['lat']) for e in d['elements'] if e['type'] == 'node'}
            for w in d['elements']:
                if w['type'] != 'way':
                    continue
                pts = [nodos[n] for n in w['nodes'] if n in nodos]
                if len(pts) > 3:
                    guardado[nombre] = pts
                    break
        json.dump(guardado, open(CACHE_RECORTES, 'w'))
    salida = []
    for nombre, _, destino in RECORTES:
        if nombre in guardado:
            g = Polygon(guardado[nombre])
            if g.is_valid and not g.is_empty:
                salida.append((nombre, g, destino))
    return salida


def adyacentes(caras):
    """Para cada cara, las caras que la tocan."""
    arbol = STRtree(caras)
    vec = collections.defaultdict(set)
    for j, c in enumerate(caras):
        for k in arbol.query(c.buffer(1 / E.M)):
            if k != j and caras[k].buffer(1 / E.M).intersects(c):
                vec[j].add(int(k))
    return vec


# --------------------------------------------------------------- pipeline
def main():
    plano = Plano()
    orig = json.load(open(ORIGEN, encoding='utf-8'))
    props = {f['properties']['n']: dict(f['properties']) for f in orig['features']}
    trazadas = {f['properties']['n']:
                [shape({'type': 'Polygon', 'coordinates': p})
                 for p in f['geometry']['coordinates']]
                for f in orig['features']}
    propio = {n: unary_union(v) for n, v in trazadas.items()}
    print(f'territorios: {len(trazadas)}  manzanas trazadas: '
          f'{sum(len(v) for v in trazadas.values())}')

    caras = E.cuadras_reales()
    fuera = set()
    for lon, lat in EXCLUIDAS:
        p = Point(lon, lat)
        for j, c in enumerate(caras):
            if c.contains(p):
                fuera.add(j)
                break
        else:
            print(f'  !! exclusión sin cuadra: ({lon}, {lat})')
    usables = [j for j, c in enumerate(caras)
               if E.m2(c.area) <= E.CARA_MAXIMA_M2 and not es_tira(c) and j not in fuera]
    tiras = sum(1 for c in caras if E.m2(c.area) <= E.CARA_MAXIMA_M2 and es_tira(c))
    print(f'cuadras reales: {len(caras)}  utilizables: {len(usables)}  '
          f'(descartadas {tiras} tiras de bandejón)')

    color = {j: plano.color(caras[j]) for j in usables}

    # --- cada manzana trazada apunta a la cuadra donde cae -----------------
    arbol = STRtree([caras[j] for j in usables])
    reclamo = collections.defaultdict(dict)     # cara -> {territorio: area trazada}
    letra_de = {}                               # (territorio, cara) -> letra
    huerfanas = collections.defaultdict(list)   # territorio -> manzanas sin cuadra
    for n, ms in trazadas.items():
        letras = props[n].get('letras') or ''
        for i, m in enumerate(ms):
            mejor, cuanto = None, 0
            for k in arbol.query(m):
                j = usables[k]
                a = caras[j].intersection(m).area
                if a > cuanto:
                    mejor, cuanto = j, a
            if mejor is None or cuanto / m.area < 0.5:
                # si la manzana cae en una cuadra excluida a propósito, no
                # vuelve por el plan B: se descarta igual que la cuadra
                if any(caras[k].intersection(m).area / m.area > 0.5 for k in fuera):
                    continue
                huerfanas[n].append(m)
                continue
            reclamo[mejor][n] = reclamo[mejor].get(n, 0) + cuanto
            letra_de.setdefault((n, mejor), letras[i] if i < len(letras) else '')

    # --- color característico de cada territorio ---------------------------
    # se calcula solo con las cuadras que un único territorio reclama
    votos = collections.defaultdict(list)
    for j, r in reclamo.items():
        if len(r) == 1 and color.get(j):
            votos[next(iter(r))].append(color[j])
    colorT = {}
    for n, cs in votos.items():
        if not cs:
            continue
        colorT[n] = tuple(sorted(c[k] for c in cs)[len(cs) // 2] for k in range(3))

    # --- adjudicación ------------------------------------------------------
    dueno, dudas = {}, []
    for j, r in reclamo.items():
        c = color.get(j)
        candidatos = sorted(r, key=r.get, reverse=True)
        porTrazado = candidatos[0]
        mismoColor = [n for n, cc in colorT.items() if mismo_color(c, cc)] if c else []
        if c and porTrazado in mismoColor:
            dueno[j] = porTrazado                      # ambas señales de acuerdo
        elif c and len(mismoColor) == 1:
            dueno[j] = mismoColor[0]                   # manda el color
            if mismoColor[0] != porTrazado:
                dudas.append({'cara': j, 'm2': round(E.m2(caras[j].area)),
                              'de': porTrazado, 'a': mismoColor[0],
                              'motivo': 'el color del plano es de otro territorio',
                              'aplicado': True})
        else:
            dueno[j] = porTrazado                      # el color no desambigua
            if c and len(mismoColor) > 1:
                dudas.append({'cara': j, 'm2': round(E.m2(caras[j].area)),
                              'de': porTrazado, 'a': mismoColor,
                              'motivo': 'varios territorios comparten ese color',
                              'aplicado': False})

    # --- crecimiento: cuadras libres del mismo color pegadas al territorio --
    vec = adyacentes([caras[j] for j in usables])
    idx = {j: k for k, j in enumerate(usables)}
    for ronda in range(4):
        nuevas = {}
        for j in usables:
            if j in dueno or not color.get(j):
                continue
            vecinos = {dueno[usables[k]] for k in vec[idx[j]]
                       if usables[k] in dueno and mismo_color(colorT.get(dueno[usables[k]]), color[j])}
            if len(vecinos) == 1:
                nuevas[j] = next(iter(vecinos))
        if not nuevas:
            break
        for j, n in nuevas.items():
            dueno[j] = n
            dudas.append({'cara': j, 'm2': round(E.m2(caras[j].area)),
                          'de': None, 'a': n,
                          'motivo': 'cuadra vecina del mismo color que faltaba',
                          'aplicado': True})

    # --- correcciones confirmadas a mano -----------------------------------
    for lon, lat, n in CORRECCIONES:
        p = Point(lon, lat)
        # se busca entre todas las cuadras, no solo las utilizables: una
        # corrección puede rescatar a propósito una que el filtro descartó
        rescatables = [j for j, c in enumerate(caras)
                       if E.m2(c.area) <= E.CARA_MAXIMA_M2 and j not in fuera]
        for j in rescatables:
            if caras[j].contains(p):
                # ya está decidida: sale de la lista de pendientes
                dudas[:] = [d for d in dudas if not (d['cara'] == j and not d['aplicado'])]
                if dueno.get(j) != n:
                    dudas.append({'cara': j, 'm2': round(E.m2(caras[j].area)),
                                  'de': dueno.get(j), 'a': n,
                                  'motivo': 'corrección confirmada por la congregación',
                                  'aplicado': True})
                dueno[j] = n
                break
        else:
            print(f'  !! corrección sin cuadra: ({lon}, {lat}) -> T{n}')

    # --- huecos interiores: una tira sin dueño se absorbe SOLO si está rodeada
    # por un único territorio. Las que separan dos territorios son el bandejón
    # de una avenida partida —Alameda, Autopista Central, Blanco Encalada— y no
    # son manzanas: si se reparten, aparecen "cachos" de color sobre la calzada.
    porTerr = collections.defaultdict(list)
    for j, n in dueno.items():
        porTerr[n].append(caras[j])
    envTmp = {n: unary_union(v) for n, v in porTerr.items()}
    astillas = 0
    # los bandejones absorbidos sirven para que el territorio no quede partido,
    # pero no son manzanas: entran en la envolvente y no en el listado
    solo_borde = set()
    candidatas = [j for j, c in enumerate(caras)
                  if E.m2(c.area) <= E.CARA_MAXIMA_M2 and j not in fuera]
    for j in candidatas:
        if j in dueno or lados(caras[j])[0] >= ASTILLA_ANCHO_M:
            continue
        borde = caras[j].boundary
        compartido = {}
        for n, g in envTmp.items():
            if not g.buffer(1 / E.M).intersects(caras[j]):
                continue
            l = borde.intersection(g.buffer(1 / E.M)).length
            if l > 0:
                compartido[n] = l
        if not compartido:
            continue
        mejor = max(compartido, key=compartido.get)
        # se compara contra el perímetro completo, no solo contra el borde que
        # da a territorios: un bandejón tiene la otra mitad contra la calzada
        if compartido[mejor] / borde.length >= ASTILLA_RODEADA:
            dueno[j] = mejor
            solo_borde.add(j)
            astillas += 1
    print(f'huecos interiores absorbidos: {astillas}')

    # --- armar cada territorio --------------------------------------------
    por_terr = collections.defaultdict(list)
    for j, n in dueno.items():
        por_terr[n].append(j)

    recortes = zonas_recortadas()
    for nombre, g, destino in recortes:
        print(f'recorte: {nombre} -> T{destino}')

    bloques = {}
    for cfg in BLOQUE_UNICO:
        g, dentro = bloque_unico(caras, cfg)
        if g is None:
            print(f"  !! no se pudo armar el bloque de T{cfg['territorio']}")
            continue
        bloques[cfg['territorio']] = (g, cfg['limite_este'], dentro)
        print(f"bloque único de T{cfg['territorio']}: {E.m2(g.area):.0f} m2"
              + (f", con {len(dentro)} manzana(s) aparte por dentro" if dentro else ''))

    feats_mz, feats_env = [], []
    for n in sorted(trazadas):
        propias = sorted(j for j in por_terr.get(n, []) if j not in solo_borde)
        piezas = [sin_cola(caras[j], propio[n]) for j in propias]
        letras = [letra_de.get((n, j), '') for j in propias]
        # los bandejones solo rellenan la envolvente
        relleno = [caras[j] for j in por_terr.get(n, []) if j in solo_borde]
        # se quita de las cuadras lo que pertenece a otro territorio por recorte
        for nombre, g, destino in recortes:
            if destino == n:
                continue
            nuevas, nuevasL = [], []
            for pz, lt in zip(piezas, letras):
                if not pz.intersects(g):
                    nuevas.append(pz); nuevasL.append(lt); continue
                r = E.limpiar(make_valid(pz.difference(g)).buffer(0))
                for parte in ([] if r.is_empty else
                              (r.geoms if r.geom_type == 'MultiPolygon' else [r])):
                    nuevas.append(parte); nuevasL.append(lt if len(nuevas) == 1 else '')
            piezas, letras = nuevas, nuevasL
        # y se agrega al territorio que la recibe
        for nombre, g, destino in recortes:
            if destino == n:
                piezas.append(g); letras.append('')
        # las manzanas sin cuadra real se enderezan, recortadas contra todas las
        # cuadras ya adjudicadas (de cualquier territorio, el propio incluido) y
        # contra las piezas que se le van agregando, para que no se pisen
        if huerfanas.get(n):
            ocupado = unary_union([caras[j] for j in dueno] + piezas)
            for m in huerfanas[n]:
                g = E.limpiar(make_valid(regularizar(m).difference(ocupado)).buffer(0))
                if g.is_empty:
                    continue
                # si el recorte la partió en varias, cada trozo es una manzana
                for parte in (g.geoms if g.geom_type == 'MultiPolygon' else [g]):
                    if es_tira(parte):      # una tira sobre la calzada, no una manzana
                        continue
                    piezas.append(parte)
                    letras.append('')
                ocupado = unary_union([ocupado, g])
        if n in bloques:
            # el bloque reemplaza a todo lo que el plano ponía al poniente; las
            # cuadras reales que encierra se mantienen como manzanas aparte
            g, limite, dentro = bloques[n]
            juntos = [(p, l) for p, l in zip(piezas, letras)
                      if p.representative_point().x >= limite]
            if dentro:
                g = E.limpiar(make_valid(g.difference(unary_union(dentro))).buffer(0))
            piezas = [p for p, _ in juntos] + [g] + list(dentro)
            letras = [l for _, l in juntos] + [''] * (1 + len(dentro))
        # remapeo desde el mapa: se conserva el contorno y se rehace lo de dentro
        cfg = next((c for c in REMAPEAR if c['territorio'] == n), None)
        if cfg is not None and piezas:
            contorno = E.limpiar(make_valid(unary_union(piezas + relleno)).buffer(0))
            b = contorno.bounds
            bbox = f'{b[1]-0.001},{b[0]-0.001},{b[3]+0.001},{b[2]+0.001}'
            finas = []
            for c in malla_fina(bbox, cfg['vias']):
                if not c.representative_point().within(contorno):
                    continue
                t = make_valid(c.intersection(contorno)).buffer(0)
                for q in (t.geoms if t.geom_type == 'MultiPolygon' else [t]):
                    if q.geom_type == 'Polygon' and E.m2(q.area) >= cfg['minimo_m2']:
                        finas.append(q)
            if finas:
                print(f'  T{n} remapeado desde el mapa: {len(piezas)} -> {len(finas)} manzanas')
                # el contorno se mantiene: las piezas nuevas van dentro de él
                relleno = relleno + [contorno.difference(unary_union(finas))]
                piezas, letras = finas, [''] * len(finas)

        if not piezas:
            print(f'  !! T{n} se quedó sin geometría')
            continue
        # letras: se conservan las heredadas, se quitan repetidas y se rellenan
        # los huecos con las primeras libres del abecedario
        vistas, limpias = set(), []
        for l in letras:
            limpias.append(l if l and l not in vistas else '')
            if l:
                vistas.add(l)
        libres = [l for l in letras_posibles(len(piezas)) if l not in vistas]
        letras = [l if l else (libres.pop(0) if libres else '?') for l in limpias]
        orden = sorted(range(len(piezas)), key=lambda i: letras[i])
        piezas = [piezas[i] for i in orden]; letras = [letras[i] for i in orden]

        # sin simplificar: las cuadras reales ya vienen limpias, y simplificar
        # cada territorio por separado desalinea los bordes que comparten.
        # buffer(0) deja la geometría utilizable por otras herramientas, y
        # `limpiar` descarta las astillas que dejan los recortes.
        env = E.limpiar(make_valid(unary_union(piezas + relleno)).buffer(0))
        p = dict(props[n])
        p['nmanzanas'] = len(piezas)
        p['letras'] = ''.join(letras)
        rp = env.representative_point()
        p['centro'] = [round(rp.x, 6), round(rp.y, 6)]
        # las cuadras llegan hasta el eje de la calle, así que vecinas se tocan.
        # Para el modo "Manzanas" se les recorta media calle a cada lado y así
        # queda el espacio de la calle a la vista, como en el plano. La
        # envolvente se calcula sin recortar, para que el borde siga completo.
        sueltas = []
        for g in piezas:
            r = min(SEPARACION_M / 2, SEPARACION_MAX * lados(g)[0])
            h = g.buffer(-r / E.M, join_style=2)
            sueltas.append(g if h.is_empty or h.geom_type != 'Polygon' else h)
        feats_mz.append({'type': 'Feature', 'properties': p, 'geometry': {
            'type': 'MultiPolygon',
            'coordinates': [mapping(g)['coordinates'] for g in sueltas]}})
        feats_env.append({'type': 'Feature', 'properties': p, 'geometry': mapping(env)})

    json.dump({'type': 'FeatureCollection', 'features': feats_mz},
              open(SALIDA_MZ, 'w', encoding='utf-8'), ensure_ascii=False)
    json.dump({'type': 'FeatureCollection', 'features': feats_env},
              open(SALIDA_ENV, 'w', encoding='utf-8'), ensure_ascii=False)
    json.dump(dudas, open(SALIDA_DUDAS, 'w', encoding='utf-8'),
              ensure_ascii=False, indent=1)

    # --- resumen -----------------------------------------------------------
    print(f'\ncuadras adjudicadas: {len(dueno)}')
    print(f'manzanas sin cuadra real (se conserva el trazado): '
          f'{sum(len(v) for v in huerfanas.values())} en {len(huerfanas)} territorios')
    for n in sorted(huerfanas):
        print(f'   T{n}: {len(huerfanas[n])}')
    aplicados = [d for d in dudas if d['aplicado']]
    revisar = [d for d in dudas if not d['aplicado']]
    print(f'\ncorrecciones aplicadas: {len(aplicados)}')
    print(f'casos a revisar a mano : {len(revisar)}')
    print(f'\ntamaños: territorios {os.path.getsize(SALIDA_MZ)/1024:.0f} kB, '
          f'envolventes {os.path.getsize(SALIDA_ENV)/1024:.0f} kB')


if __name__ == '__main__':
    main()
