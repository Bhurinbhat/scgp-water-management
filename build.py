"""Build the single-file dashboard (index.html) and copy shared code into the Vercel function.
Run:  python3 build.py
"""
import base64, json, pathlib, re, shutil
R = pathlib.Path(__file__).parent
t = (R / 'src/template.html').read_text()
LOGO = 'data:image/webp;base64,' + base64.b64encode((R / 'assets/scgp-logo.webp').read_bytes()).decode()

def svg_vars(html):
    """CSS variables only resolve inside style, not SVG presentation attributes: move fill/stroke/stop-color/font-family=var(..) into style."""
    def fix(m):
        tag, attrs, slash = m.group(1), m.group(2), m.group(3)
        st = []
        def grab(mm):
            st.append(mm.group(1) + ':' + mm.group(2)); return ''
        attrs = re.sub(r'\s(fill|stroke|stop-color|font-family)="(var\([^)]*\))"', grab, attrs)
        return '<' + tag + attrs + (' style="' + ';'.join(st) + '"' if st else '') + slash + '>'
    return re.sub(r'<(\w+)([^<>]*?)(/?)>', fix, html)

def compact(p):
    return json.dumps(json.loads((R / p).read_text()), ensure_ascii=False, separators=(',', ':'))

rep = {
    '/*LEAFLET_CSS*/': (R / 'vendor/leaflet.css').read_text(),
    '/*TRANSFORM*/': (R / 'src/transform.js').read_text(),
    '/*SITES*/': compact('data/sites.json'),
    '/*SNAPSHOT*/': compact('data/snapshot.json'),
    '/*GEO*/': compact('data/region.geo.json'),
    '/*APP*/': (R / 'src/app.js').read_text(),
    '/*LOGO*/': LOGO,
}
for k, v in rep.items():
    assert k in t, k
    t = t.replace(k, v)

head = ('<!doctype html><html lang="th"><head><meta charset="utf-8">'
        '<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">'
        '<style>:root{padding-top:env(safe-area-inset-top,0px);padding-bottom:env(safe-area-inset-bottom,0px)}'
        'body{margin:0}img{max-width:100%}[hidden]{display:none!important}</style></head><body>')
login = svg_vars((R / 'src/login.html').read_text()).replace('/*LOGO*/', LOGO)
(R / 'index.html').write_text(head + login + '</body></html>')        # sign-in page
(R / 'dashboard.html').write_text(head + t + '</body></html>')       # dashboard (after SSO)
(R / 'dist').mkdir(exist_ok=True)
(R / 'dist/artifact.html').write_text(login)      # claude.ai Artifact: sign-in page (skeleton added by the host)
(R / 'dist/dashboard.html').write_text(head + t + '</body></html>')
(R / 'api/_lib').mkdir(parents=True, exist_ok=True)
shutil.copy(R / 'src/transform.js', R / 'api/_lib/transform.js')
shutil.copy(R / 'data/sites.json', R / 'api/_lib/sites.json')
print('index.html', len(t))
