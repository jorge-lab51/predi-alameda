import pymupdf, json, sys, re, unicodedata

PDF = sys.argv[1] if len(sys.argv) > 1 else '/root/.claude/uploads/b056f69e-de77-5f32-93a1-dabfa433fcaa/826c5884-Programa_Predicacio_n_Alameda__AGOSTO.pdf'
OUT = sys.argv[2] if len(sys.argv) > 2 else '/home/claude/alameda/programa.json'

COLS = [('nro', 0, 60), ('dia', 60, 150), ('hora', 150, 205),
        ('capitan', 205, 382), ('grupo', 382, 472),
        ('direccion', 472, 725), ('territorio', 725, 800)]

def col_of(x):
    for name, a, b in COLS:
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
    # --- day cells in the "Nro." column ------------------------------
    cells = set()
    for dr in page.get_drawings():
        r = dr['rect']
        if dr['type'] == 'f' and 18 <= r.x0 <= 24 and 48 <= r.x1 <= 56 and r.height > 8:
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
        cellsr = {name: [] for name, _, _ in COLS}
        for w in sorted(ln['words'], key=lambda w: w[0]):
            c = col_of(w[0])
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
            d = next((x for x in DIAS if x in norm(dtxt)), None)
            if d:
                nombre = d
                rest = re.sub(d, '', norm(dtxt)).strip(' ·-')
                if rest:
                    notas.append(rest)
            else:
                notas.append(norm(dtxt))
        hora = r['hora'].strip()
        cap = r['capitan'].strip()
        if not hora and 'REUNION' not in norm(cap):
            continue
        tipo = 'predicacion'
        ng, nc = norm(r['grupo']), norm(cap)
        if 'REUNION' in nc:
            tipo = 'reunion'
        elif 'CARTAS' in ng or 'TELEFONICAS' in ng or 'ZOOM' in ng:
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
out = {'mes': 8, 'anio': 2026, 'titulo': 'Programa Predicación Alameda',
       'lema': '“Felices los que reconocen sus necesidades espirituales” (Mt 5:3)',
       'dias': dias}
json.dump(out, open(OUT, 'w'), ensure_ascii=False, indent=1)
print('días:', len(dias), 'actividades:', sum(len(d['actividades']) for d in dias))
for d in dias:
    print(d['dia'], d['nombre'], '|', d['nota'][:45], '|', len(d['actividades']),
          '|', ','.join(a['territorio'] or '-' for a in d['actividades']))
