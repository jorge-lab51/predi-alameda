"""Agrega al programa los datos que usa el mapa: coord, terr, calles y mapsq.

Toma el JSON crudo que produce parse_programa.py y le añade, por actividad:
  terr    lista de números de territorio (la columna "Territ." del PDF)
  calles  True si la asignación es "CALLES" en vez de un territorio
  coord   [lat, lon] del punto de encuentro, o null si no se pudo ubicar
  mapsq   texto de búsqueda para Google Maps cuando no hay coordenada

Las coordenadas se reutilizan del programa anterior; los cruces de calles
nuevos se buscan en OpenStreetMap y se validan contra el centro del
territorio asignado. Las direcciones particulares nunca se geolocalizan:
quedan solo con su texto de búsqueda.
"""
import json, re, sys, unicodedata

PREV = 'programa.json'          # programa del mes anterior, como referencia
TERRITORIOS = 'territorios.geojson'

# nombres de calle del PDF -> como aparecen en OpenStreetMap
CALLES_OSM = {
    'blanco': 'Blanco Encalada', 'blanco encalada': 'Blanco Encalada',
    'abate molina': 'Abate Molina', 'conferencia': 'Conferencia',
    'avenida espana': 'Avenida España', 'av. espana': 'Avenida España',
    'espana': 'Avenida España', 'grajales': 'Grajales', 'toesca': 'Toesca',
    'bascunan': 'Bascuñán Guerrero', 'bascunan guerrero': 'Bascuñán Guerrero',
    'gorbea': 'Gorbea', 'union latinoamericana': 'Unión Americana',
    'sazie': 'Sazié', 'vergara': 'Vergara', 'antofagasta': 'Antofagasta',
    'san alfonso': 'San Alfonso', 'san vicente': 'San Vicente',
    'latorre': 'Almirante Latorre', 'almirante latorre': 'Almirante Latorre',
    'domeyko': 'Domeyko', 'gay': 'Claudio Gay', 'exposicion': 'Exposición',
    'gaspar de la barrera': 'Gaspar de la Barrera',
    'sta margarita': 'Santa Margarita', 'santa margarita': 'Santa Margarita',
    'ramon subercaseaux': 'Ramón Subercaseaux', 'longavi': 'Longaví',
    'jose miguel carrera': 'José Miguel Carrera', 'pizarro': 'Francisco Pizarro',
    'rondizzoni': 'Rondizzoni', 'av. rondizzoni': 'Rondizzoni',
    'club hipico': 'Club Hípico', 'luis cousino': 'Luis Cousiño',
    'meiggs': 'Meiggs', 'salvador sanfuentes': 'Salvador Sanfuentes',
    'puerta de vera': 'Puerta de Vera',
    'fray luis de la pena': 'Fray Luis de la Peña',
}

# lugares fijos que no son cruces de calles
PUNTOS_FIJOS = {
    'salon salvador san fuentes 2493': [-33.45174, -70.67521],
    'plaza manuel rodriguez': [-33.45139, -70.66518],
}

# el PDF viene sin tildes; se reponen para que se lean bien en la app
TILDES = {
    'Bascunan': 'Bascuñán', 'Bascuñan': 'Bascuñán', 'Hipico': 'Hípico',
    'Jose': 'José', 'Longavi': 'Longaví', 'Ramon': 'Ramón',
    'Reunion': 'Reunión', 'Rodriguez': 'Rodríguez', 'Salon': 'Salón',
    'Sazie': 'Sazié', 'Telefonicas': 'Telefónicas', 'Union': 'Unión',
    'Exposicion': 'Exposición', 'Republica': 'República',
    'Cuartin': 'Cuartín', 'cousiño': 'Cousiño', 'Pena': 'Peña',
}

def con_tildes(texto):
    return re.sub(r'[A-Za-zÁÉÍÓÚÜÑáéíóúüñ]+',
                  lambda m: TILDES.get(m.group(), m.group()), texto or '')

def norm(s):
    s = ''.join(c for c in unicodedata.normalize('NFD', s)
                if unicodedata.category(c) != 'Mn')
    return re.sub(r'\s+', ' ', s).lower().strip()

# ------------------------------------------------------- mayúsculas sostenidas
# El PDF viene todo en mayúsculas. La app no las usa: las etiquetas en español
# llevan mayúscula solo en la primera letra, y los nombres propios una por
# palabra. Las tildes NO se inventan aquí: las repone `con_tildes` con el
# diccionario TILDES, que se escribe a mano.

# partículas que van en minúscula dentro de un nombre propio
PARTICULAS = {'de', 'del', 'la', 'las', 'los', 'el', 'y', 'e', 'o', 'da', 'do'}
# palabras que conservan su mayúscula dentro de una frase; agregar aquí los
# nombres propios nuevos que aparezcan
PROPIOS = {'zoom'}
# lo que ocupa la columna del capitán sin ser el nombre de una persona
NO_SON_NOMBRES = {'sin capitan': 'Sin capitán', 'por confirmar': 'Por confirmar'}

# Tildes de los nombres de los capitanes. Va aparte de TILDES y **no se deduce**:
# cada línea la confirma alguien. Mientras el PDF venía en mayúsculas sostenidas
# daba igual —en mayúsculas nadie echa de menos la tilde—, pero al escribirlos en
# minúscula la falta se ve. Si hay duda, no se pone: 'Cristian' y 'Cristián' son
# los dos nombres reales y no hay cómo saber cuál es.
TILDES_NOMBRES = {
    'Jose': 'José', 'Raul': 'Raúl', 'Martinez': 'Martínez',
}


def _palabra(p):
    """Mayúscula inicial y el resto en minúscula. Lo que trae dígitos se deja
    como está: `408A` no puede volverse `408a`."""
    return p if any(c.isdigit() for c in p) else p[:1].upper() + p[1:].lower()


def titulo_es(texto):
    """Nombre propio: una mayúscula por palabra, salvo las partículas.
    Tras un separador fuerte (`/`, `(`) vuelve a contar como primera palabra."""
    salida, primera = [], True
    for tr in re.split(r'(\W+)', texto or '', flags=re.UNICODE):
        if not tr:
            continue
        if re.match(r'\W', tr, flags=re.UNICODE):
            salida.append(tr)
            if any(c in tr for c in '/(-'):
                primera = True
            continue
        salida.append(tr.lower() if not primera and norm(tr) in PARTICULAS else _palabra(tr))
        primera = False
    return ''.join(salida)


def frase_es(texto):
    """Etiqueta: mayúscula solo en la primera letra. Nada de `capitalize`, que
    pondría en mayúscula las preposiciones."""
    salida, primera = [], True
    for tr in re.split(r'(\W+)', texto or '', flags=re.UNICODE):
        if not tr:
            continue
        if re.match(r'\W', tr, flags=re.UNICODE):
            salida.append(tr)
            continue
        if primera or norm(tr) in PROPIOS:
            salida.append(_palabra(tr))
        else:
            salida.append(tr if any(c.isdigit() for c in tr) else tr.lower())
        primera = False
    return ''.join(salida)


def nombre_capitan(texto):
    """La columna del capitán trae nombres de persona, y a veces un aviso."""
    aviso = NO_SON_NOMBRES.get(norm(texto))
    if aviso:
        return aviso
    return re.sub(r'[A-Za-zÁÉÍÓÚÜÑáéíóúüñ]+',
                  lambda m: TILDES_NOMBRES.get(m.group(), m.group()), titulo_es(texto))

def clave(direccion):
    """Clave estable para comparar direcciones entre meses."""
    return norm(re.sub(r'\(.*?\)', '', direccion))

def partes_cruce(direccion):
    """Si la dirección es un cruce 'A / B', devuelve los dos nombres OSM."""
    d = clave(direccion)
    trozos = [t.strip() for t in re.split(r'\s*/\s*|\s+av\.\s+', d) if t.strip()]
    if len(trozos) != 2:
        return None
    osm = [CALLES_OSM.get(t) for t in trozos]
    return osm if all(osm) else None

def es_particular(direccion):
    """Casa de familia o dirección con número: no se geolocaliza."""
    return bool(re.search(r'\(FAMILIA', direccion, re.I))

def lista_terr(t):
    return [int(x) for x in re.findall(r'\d+', t)] if not re.search(r'[A-Za-z]', t) else []

# ---------------------------------------------------------------- referencias
prev = json.load(open(PREV, encoding='utf-8'))
conocidas = {}
for d in prev['dias']:
    for a in d['actividades']:
        if a.get('direccion') and a.get('coord'):
            conocidas.setdefault(clave(a['direccion']), a['coord'])

centros = {f['properties']['n']: (f['properties']['centro'][1], f['properties']['centro'][0])
           for f in json.load(open(TERRITORIOS, encoding='utf-8'))['features']}

# ---------------------------------------------------------------- enriquecer
def enriquecer(prog, buscar_cruce=None, log=print):
    cache = {}
    for d in prog['dias']:
        if d.get('nota'):
            d['nota'] = con_tildes(frase_es(d['nota']))
        for a in d['actividades']:
            # primero las mayúsculas, después las tildes: TILDES está escrito
            # con la palabra ya capitalizada ('Bascunan', no 'BASCUNAN')
            if a.get('capitan'):
                a['capitan'] = nombre_capitan(a['capitan'])
            if a.get('direccion'):
                a['direccion'] = titulo_es(a['direccion'])
            for campo in ('grupo', 'nombre'):
                if a.get(campo):
                    a[campo] = frase_es(a[campo])
            for campo in ('direccion', 'grupo', 'nombre'):
                if a.get(campo):
                    a[campo] = con_tildes(a[campo])
            t = a.get('territorio', '')
            a['calles'] = norm(t) == 'calles'
            a['terr'] = lista_terr(t)
            dire = a.get('direccion', '')
            a['mapsq'] = ''
            a['coord'] = None
            if not dire:
                continue
            # texto de búsqueda: sin el "(FAMILIA ...)" y con la ciudad
            a['mapsq'] = re.sub(r'\s*\(.*?\)', '', dire).strip() + ', Santiago, Chile'
            k = clave(dire)
            if k in PUNTOS_FIJOS:
                a['coord'] = PUNTOS_FIJOS[k]
                continue
            if k in conocidas:
                a['coord'] = conocidas[k]
                continue
            if es_particular(dire) or buscar_cruce is None:
                continue
            par = partes_cruce(dire)
            if not par:
                continue
            if k not in cache:
                # entre los cruces posibles, el más cercano al territorio asignado
                ref = centros.get(a['terr'][0]) if a['terr'] else None
                try:
                    pts = buscar_cruce(*par)
                except Exception as e:      # sin red: queda la búsqueda en Maps
                    log('  no se pudo consultar OSM:', dire, '->', e)
                    cache[k] = None
                    continue
                if not pts:
                    log('  sin cruce en OSM:', dire, par)
                    cache[k] = None
                elif ref:
                    cache[k] = min(pts, key=lambda p: (p[0] - ref[0]) ** 2 + (p[1] - ref[1]) ** 2)
                else:
                    cache[k] = pts[0]
                if cache[k]:
                    log(f'  {dire}  ->  {cache[k]}  ({" x ".join(par)})')
            a['coord'] = list(cache[k]) if cache[k] else None
    return prog

if __name__ == '__main__':
    import cruce as osm
    entrada = sys.argv[1] if len(sys.argv) > 1 else 'programa_base.json'
    salida = sys.argv[2] if len(sys.argv) > 2 else 'programa.json'
    prog = json.load(open(entrada, encoding='utf-8'))
    print('Cruces nuevos que hubo que buscar en OpenStreetMap:')
    enriquecer(prog, osm.cruce)
    json.dump(prog, open(salida, 'w', encoding='utf-8'), ensure_ascii=False, indent=1)
    acts = [a for d in prog['dias'] for a in d['actividades']]
    sin = {a['direccion'] for a in acts if a['direccion'] and not a['coord']}
    print(f"\nActividades: {len(acts)}  con coordenada: {sum(1 for a in acts if a['coord'])}")
    print('Sin coordenada (usan búsqueda en Google Maps):')
    for s in sorted(sin):
        print('  -', s)
