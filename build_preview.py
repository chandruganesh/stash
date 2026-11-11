import re
p='public/'
html=open(p+'index.html').read(); css=open(p+'style.css').read(); js=open(p+'app.js').read(); data=open('data/library.json').read()
js=re.sub(r"async load\(\)\{ const r = await fetch\('data\.json'.*?return r\.json\(\); \}", "async load(){ return window.__DATA; }", js, count=1)
assert 'return window.__DATA' in js
html=html.replace('<link rel="stylesheet" href="style.css?v=5">','<style>'+css+'</style>')
html=html.replace('<script src="config.js?v=5"></script>\n<script src="app.js?v=5" type="module"></script>','<script>window.STASH_CONFIG={mode:"local"};window.__DATA='+data+';</script>\n<script type="module">'+js+'</script>')
html=re.sub(r'<link rel="(manifest|icon|apple-touch-icon)"[^>]*>\n','',html)
open('Stash-preview.html','w').write(html)
