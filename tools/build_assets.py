#!/usr/bin/env python3
"""
tools/build_assets.py - turns the supplied art into the game's assets/ folder.

The source PNGs stay exactly where the artist dropped them (the city folders
and the loose files at the project root). This script only READS them and
writes web-sized copies under assets/, so re-running it after new art arrives
is always safe.

    python3 tools/build_assets.py

What it produces:
    assets/ui/        title background, logos, journal books, world map
    assets/scenes/    every walkable scene (club gardens, floor plans, venues)
    assets/cities/    the six-plus-one city arrival cards, landscape and <id>-portrait
    assets/postcards/ one postcard front per casual venue
    assets/pieces/pixel/  12 piece sprites sliced from the piece sheet
    assets/board/     the ornate board, resampled so its 8x8 grid is square

A missing source is reported and skipped, never fatal: a jam build must still
boot with half its art.
"""
import json
import os
import sys

from PIL import Image

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(ROOT, 'assets')

# published name -> (source path relative to ROOT, max width)
UI = {
    'ui/title-bg': ('Pawn & Passport_ Matkailijan pelipöytä.png', 1672),
    # The portrait (phone held upright) title: no painted logo or menu, the game draws those.
    'ui/title-bg-portrait': ('ChatGPT Image 17.9.2026 klo 04.54.38.png', 1024),
    'ui/logo': ('Pixel Chess Travel Logo.png', 1200),
    'ui/logo-sub': ('A Chess Career RPG retrotekstilogo.png', 1100),
    'ui/world-map': ('Pikselitaiteinen maailman kartta(1).png', 1672),
    'ui/book-openings': ('Pikselitaiteinen shakki- ja matkakirja.png', 1536),
    'ui/book-album': ('Pikselityylinen matkapäiväkirja-albumi.png', 1536),
    'ui/book-settings': ('Pikselitaiteinen asetusten muistikirja UI.png', 1536),
}

SCENES = {
    'nyc-ext': 'NYC/New Yorkin shakkiklubin palatsi.png',
    'nyc-int': 'NYC/New Yorki malekerhon ylellinen pohjapiirros.png',
    'nyc-up': 'NYC/Yläkerran ylellinen shakkiklubi.png',
    'nyc-venue': 'NYC/Tyhjä Bethesda Terrace pikselitaiteena.png',
    'lon-ext': 'London/Symmetrinen shakkiklubin kartanopiha.png',
    'lon-int': 'London/Ylellinen shakkiklubin pohjapiirros(1)(1).png',
    'lon-venue': 'London/Lontoon shakkikeidas Covent Gardenissa.png',
    'vie-venue': 'Vienna/Wieniläinen shakkikahvila.png',
    'ist-venue': 'Istanbul/Istanbulin iltateen shakki_terassi vedellä.png',
    'che-venue': 'Chennai/Marinan rantabulevardin shakkikulma.png',
    'wen-venue': 'Wenzhou/Värikäs jokirannan kiinalainen shakkipaviljonki.png',
    'vie-ext': 'Vienna/Wienin elegantti shakkikerho puutarhoineen.png',
    'vie-int': 'Vienna/Wienin ylellinen shakkiklubin pohjapiirros.png',
    'vie-up': 'Vienna/Wienin shakkiklubin yläkerta.png',
    'ist-ext': 'Istanbul/Istanbulin shakkiklubin puutarha.png',
    'ist-int': 'Istanbul/Istanbulin shakkiklubin palatsimainen pohjapiirros(1).png',
    'ist-up': 'Istanbul/İstanbul Satranç Kulübü Lobisi.png',
    'che-ext': 'Chennai/Chennain shakkikerhon temppelipuutarha(1).png',
    'che-int': 'Chennai/Chennai Chess Club_ Pixel-Art Hall.png',
    'wen-ext': 'Wenzhou/Kiinan shakkiklubin temppelipiha.png',
    'wen-int': 'Wenzhou/Kiinalainen shakkiklubin pohjapiirros kartoittuna.png',
    'wen-up': 'Wenzhou/中国棋社阁楼平面图.png',
    'mad-ext': 'Spain Madrid/Kansallisen shakkimestaruuden palatsipiha.png',
    'mad-int': 'Spain Madrid/Kultainen kansainvälinen shakkimestaruussali.png',
}

CITIES = {
    'nyc': 'NYC/ChatGPT Image 17.9.2026 klo 07.31.39.png',
    'lon': 'London/ChatGPT Image 14.9.2026 klo 23.14.07 (5).png',
    'vie': 'Vienna/ChatGPT Image 14.9.2026 klo 23.14.06 (1).png',
    'ist': 'Istanbul/ChatGPT Image 14.9.2026 klo 23.14.06 (3).png',
    'che': 'Chennai/ChatGPT Image 14.9.2026 klo 23.14.06 (2).png',
    'wen': 'Wenzhou/ChatGPT Image 14.9.2026 klo 23.17.28 (1).png',
    'mad': 'Spain Madrid/ChatGPT Image 14.9.2026 klo 23.17.28 (2).png',
}

# Portrait loading screens (phone held upright), cities/<id>-portrait.
# NYC/ also keeps an earlier portrait draft, ChatGPT Image 17.9.2026 klo 07.32.57.png.
CITIES_PORTRAIT = {
    'nyc': 'NYC/ChatGPT Image 17.9.2026 klo 07.43.28 (3).png',
    'lon': 'London/ChatGPT Image 17.9.2026 klo 07.43.27 (2).png',
    'vie': 'Vienna/ChatGPT Image 17.9.2026 klo 07.43.30 (6).png',
    'ist': 'Istanbul/ChatGPT Image 17.9.2026 klo 07.43.28 (4).png',
    'che': 'Chennai/ChatGPT Image 17.9.2026 klo 07.43.29 (5).png',
    'wen': 'Wenzhou/ChatGPT Image 17.9.2026 klo 07.35.27.png',
    'mad': 'Spain Madrid/ChatGPT Image 17.9.2026 klo 07.43.26 (1).png',
}

PIECE_SHEET = 'ChatGPT Image 14.9.2026 klo 23.20.56.png'
BOARD = 'Koristeellinen pikselitaiteen shakkilauta.png'
# The 8x8 grid inside the board art, measured from the source (1254x1254):
# squares are 120.6 px wide but 122.8 px tall, so the art is resampled until
# they are square rather than stretching pieces to fit.
BOARD_INNER = (145, 134, 1110, 1116)

report = {'written': [], 'missing': []}


def src(rel):
    path = os.path.join(ROOT, rel)
    if not os.path.exists(path):
        report['missing'].append(rel)
        return None
    return path


def save_webp(img, name, max_w=None, quality=88):
    if max_w and img.width > max_w:
        img = img.resize((max_w, round(img.height * max_w / img.width)), Image.LANCZOS)
    path = os.path.join(OUT, name + '.webp')
    os.makedirs(os.path.dirname(path), exist_ok=True)
    img.save(path, 'WEBP', quality=quality, method=6)
    report['written'].append((name + '.webp', img.size))
    return img


def build_ui():
    for name, (rel, max_w) in UI.items():
        path = src(rel)
        if path:
            save_webp(Image.open(path).convert('RGBA'), name, max_w)


def build_scenes():
    sizes = {}
    for name, rel in SCENES.items():
        path = src(rel)
        if not path:
            continue
        img = save_webp(Image.open(path).convert('RGB'), 'scenes/' + name, 1448)
        sizes[name] = img.size
    for name, rel in CITIES.items():
        path = src(rel)
        if not path:
            continue
        img = Image.open(path).convert('RGB')
        save_webp(img, 'cities/' + name, 1672)
        sizes[name + '-card'] = (min(1672, img.width), round(img.height * min(1672, img.width) / img.width))
    for name, rel in CITIES_PORTRAIT.items():
        path = src(rel)
        if path:
            save_webp(Image.open(path).convert('RGB'), 'cities/' + name + '-portrait', 941)
    return sizes


def build_postcards():
    """One 3:2 postcard front per casual venue (Madrid has none: it is the finale).

    Every postcard is cropped from its city's arrival card (the "loading
    screen"); the venue scenes themselves are walkable art, not postcards."""
    for city in ('nyc', 'lon', 'vie', 'ist', 'che', 'wen'):
        path = src(CITIES[city])
        if not path:
            continue
        img = Image.open(path).convert('RGB')
        w, h = img.size
        # The right-hand side is the view; the left carries the club sign and
        # the name banner, which a postcard front does not need.
        left = round(w * 0.34)
        crop_w = w - left
        crop_h = round(crop_w / 1.5)
        save_webp(img.crop((left, 0, w, crop_h)).resize((900, 600), Image.LANCZOS), 'postcards/' + city)


def build_pieces():
    path = src(PIECE_SHEET)
    if not path:
        return
    sheet = Image.open(path).convert('RGBA')
    alpha = sheet.getchannel('A')
    # Column and row runs of solid alpha, measured once from the sheet.
    rows = [(57, 523, 'w'), (534, 973, 'b')]
    cols = [(62, 280, 'K'), (318, 532, 'Q'), (566, 780, 'R'), (808, 1012, 'B'), (1020, 1276, 'N'), (1300, 1480, 'P')]
    out_dir = os.path.join(OUT, 'pieces', 'pixel')
    os.makedirs(out_dir, exist_ok=True)
    tallest = 0
    crops = {}
    for (r0, r1, colour) in rows:
        for (c0, c1, kind) in cols:
            piece = sheet.crop((c0, r0, c1, r1))
            # Drop the soft glow painted around each piece: on a board it reads
            # as a dirty halo. Keep anything that is actually the piece.
            px = piece.load()
            for y in range(piece.height):
                for x in range(piece.width):
                    r, g, b, a = px[x, y]
                    if a < 150:
                        px[x, y] = (0, 0, 0, 0)
                    else:
                        px[x, y] = (r, g, b, 255)
            bbox = piece.getbbox()
            piece = piece.crop(bbox)
            crops[colour + kind] = piece
            tallest = max(tallest, piece.height)
    size = 160
    for code, piece in crops.items():
        # One scale for the whole set, so a king is still taller than a pawn.
        scale = (size * 0.92) / tallest
        pw, ph = max(1, round(piece.width * scale)), max(1, round(piece.height * scale))
        if pw > size * 0.92:
            k = (size * 0.92) / pw
            pw, ph = round(pw * k), round(ph * k)
        piece = piece.resize((pw, ph), Image.LANCZOS)
        canvas = Image.new('RGBA', (size, size), (0, 0, 0, 0))
        canvas.paste(piece, ((size - pw) // 2, size - ph - round(size * 0.04)), piece)
        canvas.save(os.path.join(out_dir, code + '.png'))
        report['written'].append(('pieces/pixel/' + code + '.png', canvas.size))


def build_board():
    path = src(BOARD)
    if not path:
        return None
    img = Image.open(path).convert('RGB')
    x0, y0, x1, y1 = BOARD_INNER
    target = 800                      # inner grid, 100 px a square
    sx = target / (x1 - x0)
    sy = target / (y1 - y0)
    resized = img.resize((round(img.width * sx), round(img.height * sy)), Image.LANCZOS)
    inner = (round(x0 * sx), round(y0 * sy), round(x0 * sx) + target, round(y0 * sy) + target)
    save_webp(resized, 'board/board', None, 90)
    meta = {
        'width': resized.width, 'height': resized.height,
        'inner': {'left': inner[0] / resized.width, 'top': inner[1] / resized.height,
                  'width': target / resized.width, 'height': target / resized.height}
    }
    return meta


def main():
    build_ui()
    sizes = build_scenes()
    build_postcards()
    build_pieces()
    board = build_board()
    manifest = {'scenes': sizes, 'board': board}
    with open(os.path.join(OUT, 'manifest.json'), 'w') as fh:
        json.dump(manifest, fh, indent=2)
    for name, size in report['written']:
        print(f'  wrote {name} {size[0]}x{size[1]}')
    for rel in report['missing']:
        print(f'  MISSING {rel}', file=sys.stderr)
    print(f'{len(report["written"])} files, {len(report["missing"])} missing')
    print('board inner rect:', json.dumps(board))


if __name__ == '__main__':
    main()
