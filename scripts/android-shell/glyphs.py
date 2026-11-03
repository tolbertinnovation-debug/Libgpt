"""Letter outlines for Android app icons (run once; output committed as server/android/glyphs.json).
Flattens Inter Bold (SIL Open Font License 1.1, (c) The Inter Project Authors) into polygons."""
import json, sys
from fontTools.ttLib import TTFont
from fontTools.pens.basePen import BasePen

class Flatten(BasePen):
    def __init__(self, glyphs):
        super().__init__(glyphs); self.contours = []; self.cur = []
    def _moveTo(self, p): self.cur = [p]
    def _lineTo(self, p): self.cur.append(p)
    def _curveToOne(self, a, b, c):
        x0, y0 = self.cur[-1]
        for i in range(1, 9):
            t = i / 8; u = 1 - t
            self.cur.append((u**3*x0 + 3*u*u*t*a[0] + 3*u*t*t*b[0] + t**3*c[0], u**3*y0 + 3*u*u*t*a[1] + 3*u*t*t*b[1] + t**3*c[1]))
    def _qCurveToOne(self, a, b):
        x0, y0 = self.cur[-1]
        for i in range(1, 7):
            t = i / 6; u = 1 - t
            self.cur.append((u*u*x0 + 2*u*t*a[0] + t*t*b[0], u*u*y0 + 2*u*t*a[1] + t*t*b[1]))
    def _closePath(self):
        if len(self.cur) > 2: self.contours.append(self.cur)
        self.cur = []
    _endPath = _closePath

font = TTFont(sys.argv[1])
cmap, glyphset = font.getBestCmap(), font.getGlyphSet()
upm = font['head'].unitsPerEm
out = {'font': 'Inter Bold, SIL Open Font License 1.1, (c) The Inter Project Authors', 'unitsPerEm': upm,
       'capHeight': getattr(font['OS/2'], 'sCapHeight', 0) or int(upm * 0.727), 'glyphs': {}}
for ch in 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789?':
    name = cmap[ord(ch)]
    pen = Flatten(glyphset); glyphset[name].draw(pen)
    out['glyphs'][ch] = {'advance': glyphset[name].width, 'contours': [[[round(x), round(y)] for x, y in c] for c in pen.contours]}
json.dump(out, open(sys.argv[2], 'w'), separators=(',', ':'))
