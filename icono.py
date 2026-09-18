"""Genera los iconos de la app.

El sistema visual pide un icono monocromo: fondo tinta y, encima, el motivo de
la app en la escala de grises del sistema. El motivo aquí son cuatro manzanas
—el mismo dibujo que el botón "Marcar las manzanas"—, con una de ellas en el
gris secundario, que es el territorio del día.

    python icono.py        # reescribe icon-192.png, icon-512.png y el maskable

Proporciones del sistema: el motivo ocupa el 74% del lienzo, y la versión
maskable un 12% menos, porque Android le recorta las esquinas.
"""
from PIL import Image, ImageDraw

FONDO = (11, 11, 11)          # --ink del modo oscuro: el icono siempre va en tinta
CLARO = (236, 236, 236)       # --text oscuro
GRIS = (140, 140, 140)        # el gris secundario del sistema
MAESTRO = 1024


def dibujar(fraccion):
    """El motivo centrado, ocupando `fraccion` del lienzo maestro."""
    im = Image.new('RGB', (MAESTRO, MAESTRO), FONDO)
    d = ImageDraw.Draw(im)
    lado = MAESTRO * fraccion
    hueco = lado * 0.092                      # la calle entre manzana y manzana
    mz = (lado - hueco) / 2
    x0 = y0 = (MAESTRO - lado) / 2
    radio = mz * 0.21
    for fila in (0, 1):
        for col in (0, 1):
            x = x0 + col * (mz + hueco)
            y = y0 + fila * (mz + hueco)
            color = GRIS if (fila, col) == (1, 1) else CLARO
            d.rounded_rectangle([x, y, x + mz, y + mz], radius=radio, fill=color)
    return im


def guardar(im, nombre, tam):
    im.resize((tam, tam), Image.LANCZOS).save(nombre, optimize=True)
    print(nombre, f'{tam}x{tam}')


if __name__ == '__main__':
    normal = dibujar(0.74)
    guardar(normal, 'icon-192.png', 192)
    guardar(normal, 'icon-512.png', 512)
    guardar(dibujar(0.62), 'icon-maskable-512.png', 512)
