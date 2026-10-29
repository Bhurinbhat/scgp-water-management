"""Build the single-file dashboard (index.html) and copy shared code into the Vercel function.
Run:  python3 build.py
"""
import json, pathlib, shutil
R = pathlib.Path(__file__).parent
t = (R / 'src/template.html').read_text()

def compact(p):
    return json.dumps(json.loads((R / p).read_text()), ensure_ascii=False, separators=(',', ':'))

rep = {
    '/*LEAFLET_CSS*/': (R / 'vendor/leaflet.css').read_text(),
    '/*TRANSFORM*/': (R / 'src/transform.js').read_text(),
    '/*SITES*/': compact('data/sites.json'),
    '/*SNAPSHOT*/': compact('data/snapshot.json'),
    '/*GEO*/': compact('data/region.geo.json'),
    '/*APP*/': (R / 'src/app.js').read_text(),
}
for k, v in rep.items():
    assert k in t, k
    t = t.replace(k, v)

head = ('<!doctype html><html lang="th"><head><meta charset="utf-8">'
        '<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">'
        '<style>:root{padding-top:env(safe-area-inset-top,0px);padding-bottom:env(safe-area-inset-bottom,0px)}'
        'body{margin:0}img{max-width:100%}[hidden]{display:none!important}</style></head><body>')
(R / 'index.html').write_text(head + t + '</body></html>')
(R / 'dist').mkdir(exist_ok=True)
(R / 'dist/artifact.html').write_text(t)          # same page without the document skeleton (for claude.ai Artifact)
(R / 'api/_lib').mkdir(parents=True, exist_ok=True)
shutil.copy(R / 'src/transform.js', R / 'api/_lib/transform.js')
shutil.copy(R / 'data/sites.json', R / 'api/_lib/sites.json')
print('index.html', len(t))
