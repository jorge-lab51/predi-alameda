"""Busca el cruce de dos calles en OpenStreetMap (Overpass) dentro del sector."""
import json, os, sys, time, urllib.parse, urllib.request

CACHE = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'cruces_cache.json')

BBOX = '-33.478,-70.690,-33.443,-70.655'   # sur, oeste, norte, este
MIRRORS = ['https://overpass-api.de/api/interpreter',
           'https://overpass.kumi.systems/api/interpreter',
           'https://overpass.private.coffee/api/interpreter']

def consulta(q):
    ultimo = None
    for url in MIRRORS:
        for intento in range(2):
            try:
                req = urllib.request.Request(
                    url, data=urllib.parse.urlencode({'data': q}).encode(),
                    headers={'User-Agent': 'predi-alameda/1.0'})
                return json.load(urllib.request.urlopen(req, timeout=120))
            except Exception as e:
                ultimo = e
                time.sleep(4)
    raise ultimo

def cruce(a, b):
    """Nodos compartidos por una vía llamada `a` y otra llamada `b`."""
    cache = json.load(open(CACHE)) if os.path.exists(CACHE) else {}
    k = a + ' | ' + b
    if k in cache:
        return [tuple(p) for p in cache[k]]
    q = f'''[out:json][timeout:90];
way["highway"]["name"~"{a}",i]({BBOX})->.a;
way["highway"]["name"~"{b}",i]({BBOX})->.b;
node(w.a)(w.b);
out body;'''
    d = consulta(q)
    pts = [(round(e['lat'], 5), round(e['lon'], 5)) for e in d['elements']
           if e['type'] == 'node']
    cache[k] = pts
    json.dump(cache, open(CACHE, 'w'), ensure_ascii=False, indent=1)
    return pts

def calles(patron):
    """Nombres de vías que coinciden con el patrón, para verificar el nombre."""
    q = f'''[out:json][timeout:90];
way["highway"]["name"~"{patron}",i]({BBOX});
out tags;'''
    d = consulta(q)
    return sorted({e['tags'].get('name') for e in d['elements'] if 'tags' in e})

if __name__ == '__main__':
    if sys.argv[1] == '--calles':
        print(calles(sys.argv[2]))
    else:
        print(cruce(sys.argv[1], sys.argv[2]))
