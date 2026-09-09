import pymupdf, json, sys, re, unicodedata

PDF = sys.argv[1] if len(sys.argv) > 1 else 'programa.pdf'
OUT = sys.argv[2] if len(sys.argv) > 2 else 'programa_base.json'

# nombres de las 7 columnas de la tabla, de izquierda a derecha
COLNAMES = ['nro', 'dia', 'hora', 'capitan', 'grupo', 'direccion', 'territorio']
# posiciones de respaldo, por si el PDF no trae las líneas de la tabla
COLS_FALLBACK = [('nro', 0, 60), ('dia', 60, 150), ('hora', 150, 205),
                 ('capitan', 205, 382), ('grupo', 382, 472),
                 ('direccion', 472, 725), ('territorio', 725, 800)]

def columnas(page):
    """Deduce los límites de las columnas a partir de las líneas verticales."""
    xs = sorted({round((dr['rect'].x0 + dr['rect'].x1) / 2, 1)
                 for dr in page.get_drawings()
                 if dr['rect'].height > 50 and dr['rect'].width < 3})
    if len(xs) != len(COLNAMES) + 1:
        return COLS_FALLBACK
    return [(n, xs[i], xs[i + 1]) for i, n in enumerate(COLNAMES)]

def col_of(cols, x):
    for name, a, b in cols:
        if a <= x < b:
            return name
    return None

def norm(s):
    return ''.join(c for c in unicodedata.normalize('NFD', s)
                   if unicodedata.category(c) != 'Mn').upper()

DIAS = ['LUNES','MARTES','MIERCOLES','JUEVES','VIERNES','SABADO','DOMINGO']

doc = pymupdf.open(PDF)
blocks = []          # day blocks: {page, y0, y1}
lines_by_page = {}

for page in doc:
    cols = columnas(page)
    nx0, nx1 = next((a, b) for n, a, b in cols if n == 'nro')

    # --- day cells in the "Nro." column ------------------------------
    cells = set()
    for dr in page.get_drawings():
        r = dr['rect']
        if (dr['type'] == 'f' and abs(r.x0 - nx0) < 4 and abs(r.x1 - nx1) < 4
                and r.height > 8):
            cells.add((round(r.y0, 1), round(r.y1, 1)))
    merged = []
    for y0, y1 in sorted(cells):
        if merged and y0 < merged[-1][1] - 2:      # real overlap -> same cell
            merged[-1] = (min(merged[-1][0], y0), max(merged[-1][1], y1))
        else:
            merged.append((y0, y1))
    for y0, y1 in merged:
        blocks.append({'page': page.number, 'y0': y0, 'y1': y1})

    # --- text lines ---------------------------------------------------
    ws = sorted(page.get_text('words'), key=lambda w: (w[1], w[0]))
    lines = []
    for w in ws:
        for ln in lines:
            if abs(ln['y'] - w[1]) < 4.5:
                ln['words'].append(w)
                break
        else:
            lines.append({'y': w[1], 'words': [w]})
    out = []
    for ln in lines:
        cellsr = {name: [] for name, _, _ in cols}
        for w in sorted(ln['words'], key=lambda w: w[0]):
            c = col_of(cols, w[0])
            if c:
                cellsr[c].append(w[4])
        out.append({'y': ln['y'], **{k: ' '.join(v).strip() for k, v in cellsr.items()}})
    lines_by_page[page.number] = sorted(out, key=lambda r: r['y'])

# only cells holding a day number start a day; the rest are extra rows of it
def has_nro(b):
    return any(re.fullmatch(r'\d{1,2}', r['nro'].strip())
               for r in lines_by_page[b['page']]
               if b['y0'] - 1 <= r['y'] <= b['y1'])

day_blocks = [b for b in blocks if has_nro(b)]
for i, b in enumerate(day_blocks):
    nxt = day_blocks[i + 1] if i + 1 < len(day_blocks) else None
    b['hi'] = nxt['y0'] if nxt and nxt['page'] == b['page'] else 10 ** 6

dias = []
for b in day_blocks:
    rows = [r for r in lines_by_page[b['page']] if b['y0'] - 1 <= r['y'] < b['hi']]
    nro = None
    nombre = ''
    notas = []
    acts = []
    for r in rows:
        m = re.fullmatch(r'\d{1,2}', r['nro'].strip())
        if m:
            nro = int(m.group())
        dtxt = r['dia'].strip()
        if dtxt:
            # la columna "Día" a veces repite el número del día: "1 MARTES"
            dtxt = re.sub(r'^\d{1,2}\s+', '', dtxt).strip()
            d = next((x for x in DIAS if x in norm(dtxt)), None)
            if d:
                nombre = d
                # se quita el nombre del día pero se conserva la tilde del resto
                rest = re.sub(d, '', norm(dtxt)).strip(' ·-')
                if rest:
                    notas.append(dtxt[len(dtxt) - len(rest):].strip(' ·-') or rest)
            elif not re.fullmatch(r'\d{1,2}', dtxt):
                notas.append(dtxt)
        hora = r['hora'].strip()
        if hora == '-':          # celda vacía marcada con guión
            hora = ''
        cap = r['capitan'].strip()
        if not hora and 'REUNION' not in norm(cap):
            continue
        tipo = 'predicacion'
        ng, nc, nt = norm(r['grupo']), norm(cap), norm(r['territorio'])
        if 'REUNION' in nc:
            tipo = 'reunion'
        elif 'CARTAS' in ng or 'TELEFONICAS' in ng or 'ZOOM' in ng or nt == 'ZOOM':
            tipo = 'cartas'
        ent = {'hora': hora, 'capitan': cap, 'grupo': r['grupo'].strip(),
               'direccion': r['direccion'].strip(),
               'territorio': r['territorio'].strip(), 'tipo': tipo}
        if tipo == 'reunion':
            m2 = re.search(r'\((\d{1,2}:\d{2})\)', cap)
            ent['hora'] = ent['hora'] or (m2.group(1) if m2 else '')
            ent['nombre'] = re.sub(r'\s*\(\d{1,2}:\d{2}\)', '', cap).strip()
            ent['capitan'] = ''
        acts.append(ent)
    if nro is None:
        continue
    acts.sort(key=lambda e: (e['hora'] or '99:99'))
    dias.append({'dia': nro, 'nombre': nombre,
                 'nota': ' '.join(dict.fromkeys(notas)).strip(),
                 'actividades': acts})

dias.sort(key=lambda d: d['dia'])

# --- mes, año y lema desde el encabezado de la primera página -----------
MESES = ['ENERO','FEBRERO','MARZO','ABRIL','MAYO','JUNIO','JULIO',
         'AGOSTO','SEPTIEMBRE','OCTUBRE','NOVIEMBRE','DICIEMBRE']
cab = doc[0].get_text()
mes = anio = None
mm = re.search(r'(' + '|'.join(MESES) + r')\s+(\d{4})', norm(cab))
if mm:
    mes, anio = MESES.index(mm.group(1)) + 1, int(mm.group(2))
lema = next((l.strip() for l in cab.splitlines() if l.strip().startswith('“')), '')

out = {'mes': mes, 'anio': anio, 'titulo': 'Programa Predicación Alameda',
       'lema': lema, 'dias': dias}
json.dump(out, open(OUT, 'w'), ensure_ascii=False, indent=1)
print('mes:', mes, anio, '| días:', len(dias),
      '| actividades:', sum(len(d['actividades']) for d in dias))
print('lema:', lema)
for d in dias:
    print(d['dia'], d['nombre'], '|', d['nota'][:45], '|', len(d['actividades']),
          '|', ','.join(a['territorio'] or '-' for a in d['actividades']))
