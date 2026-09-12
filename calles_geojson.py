"""Genera `calles.geojson`: las calles con nombre, para la vista de dibujo.

La vista "Dibujo" de la app imita el plano: las manzanas pintadas sobre fondo
liso, sin foto ni mapa de fondo. Para que se pueda leer necesita los nombres de
las calles, y eso es lo que arma este script a partir de OpenStreetMap.

Uso:  python calles_geojson.py
"""
import json, math, unicodedata

from shapely.geometry import LineString, box, mapping
from shapely.ops import linemerge, unary_union

import envolventes as E

SALIDA = 'calles.geojson'
BOUNDS = 'plano_bounds.json'
# se dejan fuera los pasajes: en el dibujo no caben y estorban
CALLES = {'motorway', 'trunk', 'primary', 'secondary', 'tertiary',
          'residential', 'unclassified'}
LARGO_MINIMO_M = 90      # tramos más cortos no alcanzan a llevar etiqueta
SIMPLIFICAR_M = 4


def normaliza(nombre):
    """Quita el genérico y deja el nombre como lo usa la gente."""
    for pre in ('Avenida ', 'Avda. ', 'Calle ', 'Pasaje '):
        if nombre.startswith(pre):
            nombre = nombre[len(pre):]
    return nombre.strip()


def main():
    b = json.load(open(BOUNDS))
    (la0, lo0), (la1, lo1) = b['bounds']
    zona = box(lo0, la0, lo1, la1)
    d = E.calles_osm()
    nodos = {e['id']: (e['lon'], e['lat']) for e in d['elements'] if e['type'] == 'node'}
    por_nombre = {}
    for w in d['elements']:
        if w['type'] != 'way':
            continue
        t = w.get('tags', {})
        if t.get('highway') not in CALLES or not t.get('name'):
            continue
        pts = [nodos[n] for n in w['nodes'] if n in nodos]
        if len(pts) > 1:
            por_nombre.setdefault(normaliza(t['name']), []).append(LineString(pts))

    feats = []
    for nombre, tramos in sorted(por_nombre.items()):
        unido = unary_union(tramos)
        if unido.geom_type == 'MultiLineString':
            unido = linemerge(unido)
        for l in (unido.geoms if unido.geom_type == 'MultiLineString' else [unido]):
            l = l.intersection(zona)
            if l.is_empty:
                continue
            for parte in (l.geoms if l.geom_type == 'MultiLineString' else [l]):
                if parte.geom_type != 'LineString' or parte.length * E.M < LARGO_MINIMO_M:
                    continue
                parte = parte.simplify(SIMPLIFICAR_M / E.M)
                feats.append({'type': 'Feature',
                              'properties': {'nombre': nombre,
                                             'm': round(parte.length * E.M)},
                              'geometry': mapping(parte)})
    json.dump({'type': 'FeatureCollection', 'features': feats},
              open(SALIDA, 'w', encoding='utf-8'), ensure_ascii=False)
    import os
    print(f'calles con nombre: {len(por_nombre)}   tramos: {len(feats)}   '
          f'{os.path.getsize(SALIDA)/1024:.0f} kB')


if __name__ == '__main__':
    main()
