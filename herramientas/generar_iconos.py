"""Genera los iconos PNG de la app sin librerías externas (solo zlib y struct).

Dibuja un plato blanco sobre fondo verde. El fondo ocupa todo el cuadrado
para que sirva también como icono "maskable" en Android.

Uso:  python herramientas/generar_iconos.py
"""

import struct
import zlib
from pathlib import Path

VERDE = (47, 125, 79)
VERDE_CLARO = (227, 241, 232)
BLANCO = (255, 255, 255)
SUBMUESTRAS = 4  # antialiasing: 4x4 muestras por píxel


def color_en(x: float, y: float) -> tuple[int, int, int]:
    """Color en un punto (x, y) de 0 a 1."""
    d = ((x - 0.5) ** 2 + (y - 0.5) ** 2) ** 0.5
    if d < 0.13:
        return VERDE_CLARO          # centro del plato
    if d < 0.16:
        return BLANCO
    if d < 0.175:
        return VERDE_CLARO          # aro interior
    if d < 0.30:
        return BLANCO               # borde del plato
    return VERDE


def pixeles(tam: int) -> bytes:
    filas = bytearray()
    paso = 1 / (tam * SUBMUESTRAS)
    for py in range(tam):
        filas.append(0)  # filtro PNG "none" al inicio de cada fila
        for px in range(tam):
            r = g = b = 0
            for sy in range(SUBMUESTRAS):
                for sx in range(SUBMUESTRAS):
                    c = color_en((px * SUBMUESTRAS + sx + 0.5) * paso, (py * SUBMUESTRAS + sy + 0.5) * paso)
                    r, g, b = r + c[0], g + c[1], b + c[2]
            n = SUBMUESTRAS ** 2
            filas += bytes((r // n, g // n, b // n))
    return bytes(filas)


def png(tam: int) -> bytes:
    def bloque(tipo: bytes, datos: bytes) -> bytes:
        return struct.pack(">I", len(datos)) + tipo + datos + struct.pack(">I", zlib.crc32(tipo + datos))

    cabecera = struct.pack(">IIBBBBB", tam, tam, 8, 2, 0, 0, 0)  # 8 bits, RGB
    return (b"\x89PNG\r\n\x1a\n"
            + bloque(b"IHDR", cabecera)
            + bloque(b"IDAT", zlib.compress(pixeles(tam), 9))
            + bloque(b"IEND", b""))


if __name__ == "__main__":
    carpeta = Path(__file__).resolve().parent.parent / "icons"
    carpeta.mkdir(exist_ok=True)
    for tam in (192, 512):
        destino = carpeta / f"icono-{tam}.png"
        destino.write_bytes(png(tam))
        print(f"Creado {destino}")
